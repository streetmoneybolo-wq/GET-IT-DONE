'use strict';

const { randomUUID } = require('node:crypto');
const { fetchPublicBuffer } = require('./safe-fetch');

const MODELS = new Set(['claude', 'codex']);
const STATUSES = new Set(['queued', 'processing', 'in_progress', 'retry', 'done', 'needs_human', 'failed_max_hops', 'failed_budget']);

const HANDOFF_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['run_id', 'task_complete', 'next_model', 'confidence', 'verification', 'handoff_payload', 'history_entry'],
  properties: {
    run_id: { type: 'string', minLength: 1, maxLength: 200 },
    task_complete: { type: 'boolean' },
    next_model: { anyOf: [{ type: 'string', enum: ['claude', 'codex'] }, { type: 'null' }] },
    confidence: { type: 'string', enum: ['high', 'low'] },
    verification: {
      type: 'object', additionalProperties: false,
      required: ['type', 'url', 'expect_status', 'expect_body_contains'],
      properties: {
        type: { type: 'string', enum: ['http', 'none'] },
        url: { type: 'string', maxLength: 2048 },
        expect_status: { type: 'integer', minimum: 100, maximum: 599 },
        expect_body_contains: { type: 'string', maxLength: 500 }
      }
    },
    handoff_payload: {
      type: 'object', additionalProperties: false,
      required: ['instructions', 'meta'],
      properties: {
        instructions: { type: 'string', maxLength: 12000 },
        meta: { type: 'object', additionalProperties: false, properties: {} }
      }
    },
    history_entry: {
      type: 'object', additionalProperties: false,
      required: ['model', 'summary', 'at'],
      properties: {
        model: { type: 'string', enum: ['claude', 'codex'] },
        summary: { type: 'string', maxLength: 4000 },
        at: { type: 'string', maxLength: 100 }
      }
    }
  }
});

const SHARED_PROMPT = `You are one bounded hop in the StockMarketLoop automated task loop.
Return one JSON object and nothing else. Never emit markdown fences or secrets.
The immutable goal and complete prior history are provided by the router.

Rules:
1. A claim of completion is not evidence. Set task_complete true only with a narrow HTTPS verification that independently tests the work you claim changed.
2. If you cannot express that verification, keep task_complete false or report low confidence.
3. If task_complete is false, next_model must be claude or codex.
4. Use handoff_payload.instructions for the next model. Do not replace or restate the immutable goal.
5. Read history and do not repeat completed work.
6. Never include passwords, tokens, API keys, private identifiers, or model credentials.
7. You have no shell, filesystem, browser, payment, publishing, or deployment tools in this call. Never claim you performed an external action.

Required JSON shape:
{"run_id":"unique string","task_complete":false,"next_model":"claude","confidence":"high","verification":{"type":"none","url":"","expect_status":200,"expect_body_contains":""},"handoff_payload":{"instructions":"","meta":{}},"history_entry":{"model":"claude","summary":"","at":"ISO8601"}}`;

const CLAUDE_PROMPT = `${SHARED_PROMPT}\nYour role is architecture, failure analysis, and a precise implementation handoff. If the goal is ambiguous, report low confidence.`;
const CODEX_PROMPT = `${SHARED_PROMPT}\nYour role is to produce a precise implementation result from the handoff. Because this API call has no execution tools, never claim files were changed or tests were run unless the supplied history contains independent proof.`;

function jsonText(raw) {
  let text = String(raw || '').trim();
  if (text.startsWith('```')) text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('model output is not a JSON object'), { code: 'invalid_contract' });
  return parsed;
}

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, label) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw Object.assign(new Error(`${label} contains an unknown field`), { code: 'invalid_contract' });
  }
}

function validateHandoff(value, expectedModel) {
  const h = plainObject(value) ? value : jsonText(value);
  const required = ['run_id', 'task_complete', 'next_model', 'confidence', 'verification', 'handoff_payload', 'history_entry'];
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(h, key)) throw Object.assign(new Error(`missing ${key}`), { code: 'invalid_contract' });
  exactKeys(h, required, 'handoff');
  if (typeof h.run_id !== 'string' || !h.run_id.trim() || h.run_id.length > 200) throw Object.assign(new Error('invalid run_id'), { code: 'invalid_contract' });
  if (typeof h.task_complete !== 'boolean') throw Object.assign(new Error('task_complete must be boolean'), { code: 'invalid_contract' });
  if (h.next_model !== null && !MODELS.has(h.next_model)) throw Object.assign(new Error('invalid next_model'), { code: 'invalid_contract' });
  if (!h.task_complete && !MODELS.has(h.next_model)) throw Object.assign(new Error('incomplete task must name next_model'), { code: 'invalid_contract' });
  if (!['high', 'low'].includes(h.confidence)) throw Object.assign(new Error('invalid confidence'), { code: 'invalid_contract' });
  if (!plainObject(h.verification) || !['http', 'none'].includes(h.verification.type)) throw Object.assign(new Error('invalid verification'), { code: 'invalid_contract' });
  exactKeys(h.verification, ['type', 'url', 'expect_status', 'expect_body_contains'], 'verification');
  if (typeof h.verification.url !== 'string' || typeof h.verification.expect_status !== 'number' || typeof h.verification.expect_body_contains !== 'string') throw Object.assign(new Error('invalid verification fields'), { code: 'invalid_contract' });
  if (h.verification.type === 'http') {
    if (typeof h.verification.url !== 'string' || h.verification.url.length > 2048 || h.verification.expect_status !== 200 || typeof h.verification.expect_body_contains !== 'string' || h.verification.expect_body_contains.length > 500) {
      throw Object.assign(new Error('invalid HTTP verification'), { code: 'invalid_contract' });
    }
  }
  if (!plainObject(h.handoff_payload) || typeof h.handoff_payload.instructions !== 'string' || h.handoff_payload.instructions.length > 12000 || !plainObject(h.handoff_payload.meta)) throw Object.assign(new Error('invalid handoff_payload'), { code: 'invalid_contract' });
  exactKeys(h.handoff_payload, ['instructions', 'meta'], 'handoff_payload');
  if (!plainObject(h.history_entry) || h.history_entry.model !== expectedModel || typeof h.history_entry.summary !== 'string' || h.history_entry.summary.length > 4000 || typeof h.history_entry.at !== 'string' || h.history_entry.at.length > 100) throw Object.assign(new Error('invalid history_entry'), { code: 'invalid_contract' });
  exactKeys(h.history_entry, ['model', 'summary', 'at'], 'history_entry');
  return h;
}

function extractOpenAIText(payload) {
  if (typeof payload.output_text === 'string' && payload.output_text) return payload.output_text;
  for (const item of payload.output || []) for (const part of item.content || []) if (part.type === 'output_text' && part.text) return part.text;
  throw Object.assign(new Error('OpenAI response contained no output text'), { code: 'model_empty_output' });
}

function modelError(provider, status, payload) {
  const error = new Error(`${provider} request failed with HTTP ${status}`);
  error.code = status === 429 ? 'model_rate_limited' : 'model_request_failed';
  error.statusCode = status;
  error.safeToRetry = status === 429;
  error.providerType = payload && payload.error && payload.error.type ? String(payload.error.type).slice(0, 100) : '';
  return error;
}

function createOpenAIOrchestratorClient({ apiKey, model = 'gpt-5.4-mini', maxOutputTokens = 3000, timeoutMs = 90_000, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  return {
    async run(task) {
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-client-request-id': task.invocationId },
        body: JSON.stringify({
          model, store: false, max_output_tokens: maxOutputTokens,
          input: [
            { role: 'system', content: [{ type: 'input_text', text: CODEX_PROMPT }] },
            { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(task.input) }] }
          ],
          text: { format: { type: 'json_schema', name: 'sml_ai_handoff', strict: true, schema: HANDOFF_SCHEMA } }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw modelError('OpenAI', response.status, payload);
      return {
        text: extractOpenAIText(payload), providerRunId: String(payload.id || ''),
        inputTokens: Number(payload.usage && payload.usage.input_tokens) || 0,
        outputTokens: Number(payload.usage && payload.usage.output_tokens) || 0
      };
    }
  };
}

function createAnthropicOrchestratorClient({ apiKey, model = 'claude-sonnet-5', maxOutputTokens = 3000, timeoutMs = 90_000, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required');
  return {
    async run(task) {
      const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: maxOutputTokens,
          system: CLAUDE_PROMPT,
          messages: [{ role: 'user', content: JSON.stringify(task.input) }]
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw modelError('Anthropic', response.status, payload);
      const text = (payload.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('');
      if (!text) throw Object.assign(new Error('Anthropic response contained no output text'), { code: 'model_empty_output' });
      return {
        text, providerRunId: String(payload.id || ''),
        inputTokens: Number(payload.usage && payload.usage.input_tokens) || 0,
        outputTokens: Number(payload.usage && payload.usage.output_tokens) || 0
      };
    }
  };
}

function estimateMicrousd(usage, rate) {
  return Math.max(0, Math.ceil((Number(usage.inputTokens) || 0) * rate.inputPerMillion + (Number(usage.outputTokens) || 0) * rate.outputPerMillion));
}

function createAiTaskStore(pool) {
  if (!pool || typeof pool.query !== 'function') throw new Error('Postgres pool is required');
  return {
    async enqueue(input) {
      const result = await pool.query(
        `INSERT INTO ai_orchestrator_tasks
           (idempotency_key, goal, context, payload, next_model, max_hops_remaining, max_retries, budget_microusd)
         VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8)
         ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
         RETURNING id,status`,
        [input.idempotencyKey, input.goal, JSON.stringify(input.context || {}), JSON.stringify(input.payload || {}), input.nextModel || 'claude', input.maxHops || 4, input.maxRetries == null ? 2 : input.maxRetries, input.budgetMicrousd == null ? 1000000 : input.budgetMicrousd]
      );
      return result.rows[0];
    },
    async claim(workerId, leaseSeconds = 300) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE ai_orchestrator_tasks
              SET status='needs_human', last_error_code='ambiguous_expired_claim',
                  last_error_detail='A model invocation may have completed after the worker lost its lease; automatic replay is disabled.',
                  lease_owner=NULL, lease_expires_at=NULL, updated_at=now()
            WHERE status='processing' AND lease_expires_at < now()`
        );
        const selected = await client.query(
          `SELECT * FROM ai_orchestrator_tasks
            WHERE status IN ('queued','in_progress','retry') AND run_after <= now()
            ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`
        );
        if (!selected.rowCount) { await client.query('COMMIT'); return null; }
        const invocationId = randomUUID();
        const claimed = await client.query(
          `UPDATE ai_orchestrator_tasks SET status='processing', invocation_id=$2, lease_owner=$3,
             lease_expires_at=now()+make_interval(secs=>$4), updated_at=now()
           WHERE id=$1 RETURNING *`,
          [selected.rows[0].id, invocationId, workerId, leaseSeconds]
        );
        await client.query('COMMIT');
        return claimed.rows[0];
      } catch (error) {
        await client.query('ROLLBACK'); throw error;
      } finally { client.release(); }
    },
    async transition(task, hop, next) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO ai_orchestrator_hops
             (task_id,invocation_id,model,provider_run_id,summary,handoff_payload,verification,input_tokens,output_tokens,estimated_cost_microusd)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)
           ON CONFLICT (task_id,invocation_id) DO NOTHING`,
          [task.id, task.invocation_id, task.next_model, hop.providerRunId || null, hop.summary || '', JSON.stringify(hop.payload || {}), JSON.stringify(hop.verification || null), hop.inputTokens || 0, hop.outputTokens || 0, hop.costMicrousd || 0]
        );
        await client.query(
          `UPDATE ai_orchestrator_tasks SET status=$3,next_model=$4,payload=$5::jsonb,history=$6::jsonb,
             max_hops_remaining=$7,retry_count=$8,spent_microusd=spent_microusd+$9,
             verification=$10::jsonb,verification_note=$11,last_error_code=$12,last_error_detail=$13,
             run_after=COALESCE($14::timestamptz,now()),lease_owner=NULL,lease_expires_at=NULL,invocation_id=NULL,
             completed_at=CASE WHEN $3='done' THEN now() ELSE completed_at END,updated_at=now()
           WHERE id=$1 AND invocation_id=$2`,
          [task.id, task.invocation_id, next.status, next.nextModel, JSON.stringify(next.payload || {}), JSON.stringify(next.history || []), next.hopsLeft, next.retryCount || 0, hop.costMicrousd || 0, JSON.stringify(next.verification || null), next.verificationNote || null, next.errorCode || null, next.errorDetail || null, next.runAfter || null]
        );
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    async fail(task, error, safeToRetry) {
      const retries = Number(task.retry_count || 0) + 1;
      const retry = safeToRetry && retries <= Number(task.max_retries || 0) && Number(task.max_hops_remaining || 0) > 1;
      await pool.query(
        `UPDATE ai_orchestrator_tasks SET status=$3,retry_count=$4,max_hops_remaining=GREATEST(0,max_hops_remaining-1),
           run_after=CASE WHEN $3='retry' THEN now()+make_interval(secs=>LEAST(3600,30*power(2::numeric,$4::integer)::integer)) ELSE run_after END,
           last_error_code=$5,last_error_detail=$6,lease_owner=NULL,lease_expires_at=NULL,invocation_id=NULL,updated_at=now()
         WHERE id=$1 AND invocation_id=$2`,
        [task.id, task.invocation_id, retry ? 'retry' : 'needs_human', retries, String(error.code || 'model_call_failed').slice(0, 100), String(error.message || error).slice(0, 1000)]
      );
      return retry ? 'retry' : 'needs_human';
    },
    async list(limit = 50) {
      const result = await pool.query(
        `SELECT id,idempotency_key,status,next_model,max_hops_remaining,retry_count,budget_microusd,spent_microusd,
                verification_note,last_error_code,created_at,updated_at,completed_at
           FROM ai_orchestrator_tasks ORDER BY created_at DESC LIMIT $1`,
        [Math.max(1, Math.min(Number(limit) || 50, 200))]
      );
      return result.rows;
    }
  };
}

function createVerifier({ allowedHosts, fetchBuffer = fetchPublicBuffer }) {
  const hosts = new Set((allowedHosts || []).map((host) => String(host).toLowerCase()));
  return async function verify(spec) {
    if (!spec || spec.type !== 'http') return { ok: false, note: 'completion requires HTTP verification' };
    let url;
    try { url = new URL(spec.url); } catch (_) { return { ok: false, note: 'verification URL is invalid' }; }
    if (url.protocol !== 'https:' || url.username || url.password || !hosts.has(url.hostname.toLowerCase())) return { ok: false, note: 'verification host is not approved' };
    if (spec.expect_status !== 200) return { ok: false, note: 'only HTTP 200 verification is allowed' };
    try {
      const result = await fetchBuffer(url, { timeoutMs: 10_000, maxBytes: 256 * 1024, maxRedirects: 0, accept: 'application/json,text/plain;q=0.9,*/*;q=0.1' });
      const body = result.body.toString('utf8');
      const needle = String(spec.expect_body_contains || '');
      if (needle && !body.includes(needle)) return { ok: false, note: 'verification response did not contain expected text' };
      return { ok: true, note: 'verified: HTTPS 200' };
    } catch (error) { return { ok: false, note: `verification failed: ${String(error.code || 'request_failed').slice(0, 80)}` }; }
  };
}

function createAiOrchestrator({ store, clients, verifier, rates, logger = () => {}, workerId = `ai-${process.pid}` }) {
  return {
    async runOnce() {
      const task = await store.claim(workerId, 300);
      if (!task) return false;
      const model = task.next_model;
      const client = clients[model];
      if (!client) {
        await store.fail(task, Object.assign(new Error(`${model} provider is not configured`), { code: 'provider_unconfigured' }), false);
        return true;
      }
      if (Number(task.max_hops_remaining) <= 0) {
        await store.transition(task, {}, { status: 'failed_max_hops', nextModel: null, payload: task.payload, history: task.history, hopsLeft: 0, errorCode: 'max_hops_exhausted' });
        return true;
      }
      if (Number(task.spent_microusd) >= Number(task.budget_microusd)) {
        await store.transition(task, {}, { status: 'failed_budget', nextModel: null, payload: task.payload, history: task.history, hopsLeft: task.max_hops_remaining, errorCode: 'budget_exhausted' });
        return true;
      }
      let output;
      try {
        output = await client.run({
          invocationId: task.invocation_id,
          input: { goal: task.goal, context: task.context || {}, payload: task.payload || {}, history: task.history || [] }
        });
      } catch (error) {
        const status = await store.fail(task, error, !!error.safeToRetry);
        logger('warn', 'ai_orchestrator_model_failed', { taskId: task.id, model, status, code: error.code || 'model_call_failed' });
        return true;
      }
      const rate = rates[model] || { inputPerMillion: 0, outputPerMillion: 0 };
      const costMicrousd = estimateMicrousd(output, rate);
      const hopsLeft = Math.max(0, Number(task.max_hops_remaining) - 1);
      let handoff;
      try { handoff = validateHandoff(output.text, model); } catch (error) {
        const retries = Number(task.retry_count || 0) + 1;
        const retry = retries <= Number(task.max_retries || 0) && hopsLeft > 0;
        await store.transition(task, {
          providerRunId: output.providerRunId, summary: 'Model returned an invalid handoff contract.', payload: {}, verification: null,
          inputTokens: output.inputTokens, outputTokens: output.outputTokens, costMicrousd
        }, {
          status: retry ? 'retry' : 'needs_human', nextModel: model, payload: task.payload, history: task.history, hopsLeft,
          retryCount: retries, errorCode: 'invalid_contract', errorDetail: String(error.message).slice(0, 1000),
          runAfter: retry ? new Date(Date.now() + Math.min(3600, 30 * (2 ** retries)) * 1000).toISOString() : null
        });
        return true;
      }
      const history = [...(Array.isArray(task.history) ? task.history : []), {
        model, summary: handoff.history_entry.summary, at: new Date().toISOString(), run_id: handoff.run_id
      }];
      const totalCost = Number(task.spent_microusd) + costMicrousd;
      let next = {
        status: 'in_progress', nextModel: handoff.next_model, payload: handoff.handoff_payload, history,
        hopsLeft, verification: handoff.verification, retryCount: 0
      };
      if (totalCost > Number(task.budget_microusd)) next = { ...next, status: 'failed_budget', nextModel: null, errorCode: 'budget_exhausted' };
      else if (handoff.confidence === 'low') next = { ...next, status: 'needs_human', nextModel: null, errorCode: 'model_low_confidence' };
      else if (handoff.task_complete) {
        const checked = await verifier(handoff.verification);
        next = checked.ok
          ? { ...next, status: 'done', nextModel: null, verificationNote: checked.note }
          : { ...next, status: 'needs_human', nextModel: null, verificationNote: checked.note, errorCode: 'verification_failed' };
      } else if (hopsLeft <= 0) next = { ...next, status: 'failed_max_hops', nextModel: null, errorCode: 'max_hops_exhausted' };
      await store.transition(task, {
        providerRunId: output.providerRunId, summary: handoff.history_entry.summary, payload: handoff.handoff_payload,
        verification: handoff.verification, inputTokens: output.inputTokens, outputTokens: output.outputTokens, costMicrousd
      }, next);
      logger('info', 'ai_orchestrator_hop_complete', { taskId: task.id, model, status: next.status, hopsLeft, costMicrousd });
      return true;
    }
  };
}

module.exports = {
  HANDOFF_SCHEMA, SHARED_PROMPT, CODEX_PROMPT, CLAUDE_PROMPT,
  createAiOrchestrator, createAiTaskStore, createAnthropicOrchestratorClient,
  createOpenAIOrchestratorClient, createVerifier, estimateMicrousd, jsonText, validateHandoff
};
