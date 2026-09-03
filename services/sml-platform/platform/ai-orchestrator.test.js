'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAiOrchestrator,
  createAnthropicOrchestratorClient,
  createOpenAIOrchestratorClient,
  createVerifier,
  estimateMicrousd,
  jsonText,
  validateHandoff
} = require('./ai-orchestrator');
const { validInput } = require('../scripts/ai-orchestrator');

function handoff(overrides = {}) {
  return {
    run_id: 'run-1',
    task_complete: false,
    next_model: 'codex',
    confidence: 'high',
    verification: { type: 'none', url: '', expect_status: 200, expect_body_contains: '' },
    handoff_payload: { instructions: 'Inspect the next bounded step.', meta: {} },
    history_entry: { model: 'claude', summary: 'Reviewed the goal.', at: '2026-09-02T00:00:00Z' },
    ...overrides
  };
}

function task(overrides = {}) {
  return {
    id: 7,
    invocation_id: '11111111-1111-4111-8111-111111111111',
    next_model: 'claude',
    goal: 'Safely verify the production canary.',
    context: {}, payload: {}, history: [],
    max_hops_remaining: 4, retry_count: 0, max_retries: 2,
    budget_microusd: 1_000_000, spent_microusd: 0,
    ...overrides
  };
}

function fakeStore(claimed) {
  const calls = [];
  return {
    calls,
    async claim() { return claimed; },
    async transition(...args) { calls.push(['transition', ...args]); },
    async fail(...args) { calls.push(['fail', ...args]); return 'needs_human'; }
  };
}

test('JSON parser accepts a fenced object but rejects prose', () => {
  assert.equal(jsonText('```json\n{"ok":true}\n```').ok, true);
  assert.throws(() => jsonText('not json'), SyntaxError);
});

test('handoff contract requires a next model for unfinished work', () => {
  assert.throws(() => validateHandoff(handoff({ next_model: null }), 'claude'), /must name next_model/);
  assert.throws(() => validateHandoff(handoff({ history_entry: { model: 'codex', summary: '', at: '' } }), 'claude'), /history_entry/);
  assert.equal(validateHandoff(handoff(), 'claude').run_id, 'run-1');
});

test('estimated cost uses per-million rates and rounds up microusd', () => {
  assert.equal(estimateMicrousd({ inputTokens: 500, outputTokens: 250 }, { inputPerMillion: 2, outputPerMillion: 8 }), 3000);
});

test('enqueue CLI rejects unsafe or unbounded input', () => {
  assert.throws(() => validInput({ idempotencyKey: 'short', goal: 'This goal is long enough.' }), /idempotencyKey/);
  assert.throws(() => validInput({ idempotencyKey: 'safe-key-123', goal: 'This goal is long enough.', maxHops: 21 }), /maxHops/);
  assert.throws(() => validInput({ idempotencyKey: 'safe-key-123', goal: 'This goal is long enough.', maxRetries: 11 }), /maxRetries/);
  assert.equal(validInput({ idempotencyKey: 'safe-key-123', goal: 'This goal is long enough.' }).idempotencyKey, 'safe-key-123');
});

test('OpenAI client uses strict Responses JSON schema without persistence', async () => {
  let request;
  const client = createOpenAIOrchestratorClient({
    apiKey: 'hidden', model: 'test-model',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 200, async json() { return { id: 'resp_1', output_text: JSON.stringify({ ok: true }), usage: { input_tokens: 11, output_tokens: 5 } }; } };
    }
  });
  const result = await client.run({ invocationId: 'inv-1', input: { goal: 'x' } });
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.body.store, false);
  assert.equal(request.body.text.format.strict, true);
  assert.equal(request.options.headers['x-client-request-id'], 'inv-1');
  assert.deepEqual({ inputTokens: result.inputTokens, outputTokens: result.outputTokens }, { inputTokens: 11, outputTokens: 5 });
});

test('OpenAI 429 is explicitly retryable but other failures are not', async () => {
  for (const [status, retryable] of [[429, true], [500, false]]) {
    const client = createOpenAIOrchestratorClient({ apiKey: 'hidden', fetchImpl: async () => ({ ok: false, status, async json() { return {}; } }) });
    await assert.rejects(client.run({ invocationId: 'inv', input: {} }), (error) => error.safeToRetry === retryable);
  }
});

test('Anthropic client extracts text and usage', async () => {
  let body;
  const client = createAnthropicOrchestratorClient({
    apiKey: 'hidden', model: 'test-claude',
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, status: 200, async json() { return { id: 'msg_1', content: [{ type: 'text', text: JSON.stringify(handoff()) }], usage: { input_tokens: 8, output_tokens: 4 } }; } };
    }
  });
  const result = await client.run({ invocationId: 'inv', input: {} });
  assert.equal(body.model, 'test-claude');
  assert.equal(result.providerRunId, 'msg_1');
  assert.equal(result.outputTokens, 4);
});

test('verifier only permits HTTPS 200 on an exact approved host', async () => {
  let fetched = false;
  const verify = createVerifier({ allowedHosts: ['stockmarketloop.com'], fetchBuffer: async () => { fetched = true; return { body: Buffer.from('canary healthy') }; } });
  assert.equal((await verify({ type: 'none' })).ok, false);
  assert.equal((await verify({ type: 'http', url: 'https://evil.example/', expect_status: 200, expect_body_contains: '' })).ok, false);
  assert.equal(fetched, false);
  assert.equal((await verify({ type: 'http', url: 'https://stockmarketloop.com/health', expect_status: 200, expect_body_contains: 'healthy' })).ok, true);
});

test('verified completion is the only route to done', async () => {
  const store = fakeStore(task());
  const complete = handoff({
    task_complete: true, next_model: null,
    verification: { type: 'http', url: 'https://stockmarketloop.com/health', expect_status: 200, expect_body_contains: 'ok' }
  });
  const runner = createAiOrchestrator({
    store, clients: { claude: { async run() { return { text: JSON.stringify(complete), providerRunId: 'm1', inputTokens: 10, outputTokens: 10 }; } } },
    verifier: async () => ({ ok: true, note: 'verified' }),
    rates: { claude: { inputPerMillion: 1, outputPerMillion: 1 } }
  });
  assert.equal(await runner.runOnce(), true);
  assert.equal(store.calls[0][3].status, 'done');
});

test('unverified completion and low confidence park for human review', async () => {
  for (const output of [handoff({ task_complete: true, next_model: null }), handoff({ confidence: 'low' })]) {
    const store = fakeStore(task());
    const runner = createAiOrchestrator({
      store, clients: { claude: { async run() { return { text: JSON.stringify(output), inputTokens: 1, outputTokens: 1 }; } } },
      verifier: async () => ({ ok: false, note: 'not independently verified' }), rates: { claude: { inputPerMillion: 0, outputPerMillion: 0 } }
    });
    await runner.runOnce();
    assert.equal(store.calls[0][3].status, 'needs_human');
  }
});

test('invalid model contract retries within limits and charges the hop', async () => {
  const store = fakeStore(task());
  const runner = createAiOrchestrator({
    store, clients: { claude: { async run() { return { text: '{}', providerRunId: 'bad', inputTokens: 2, outputTokens: 3 }; } } },
    verifier: async () => ({ ok: false }), rates: { claude: { inputPerMillion: 1, outputPerMillion: 1 } }
  });
  await runner.runOnce();
  assert.equal(store.calls[0][3].status, 'retry');
  assert.equal(store.calls[0][3].retryCount, 1);
  assert.equal(store.calls[0][2].providerRunId, 'bad');
});

test('missing provider parks the claimed task and empty queue returns false', async () => {
  const store = fakeStore(task());
  const runner = createAiOrchestrator({ store, clients: {}, verifier: async () => ({ ok: false }), rates: {} });
  assert.equal(await runner.runOnce(), true);
  assert.equal(store.calls[0][0], 'fail');
  const empty = createAiOrchestrator({ store: fakeStore(null), clients: {}, verifier: async () => ({}), rates: {} });
  assert.equal(await empty.runOnce(), false);
});

test('estimated spend over the hard budget fails closed', async () => {
  const store = fakeStore(task({ budget_microusd: 1 }));
  const runner = createAiOrchestrator({
    store, clients: { claude: { async run() { return { text: JSON.stringify(handoff()), inputTokens: 10, outputTokens: 10 }; } } },
    verifier: async () => ({ ok: false }), rates: { claude: { inputPerMillion: 100000, outputPerMillion: 100000 } }
  });
  await runner.runOnce();
  assert.equal(store.calls[0][3].status, 'failed_budget');
});
