'use strict';

// Dispute service (DESIGN.md v2 §2, API-CONTRACTS.md P5): admin endpoint
// logic behind POST /v1/billing/disputes/*. Handler style mirrors
// billing-service.js: validation failures throw TypeError (mapped to 400
// by the server); everything else surfaces as a 5xx.
//
// All cross-module dependencies are injected: no sibling new module is
// required from here. Neutral, factual language only — templates never
// characterize a customer and never assert facts without cited records.

const crypto = require('node:crypto');

const REVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;
const DEFAULT_LIST_STATES = [
  'open', 'evidence_building', 'ready_for_review', 'approved', 'submitting', 'provider_review'
];
const CASE_STATES = new Set([
  'open', 'evidence_building', 'ready_for_review', 'approved', 'submitting', 'submitted',
  'provider_review', 'won', 'lost', 'warning_closed', 'accepted', 'expired'
]);
const SUBMITTABLE_STATES = new Set(['ready_for_review', 'approved']);
const PACKET_BUILDABLE_STATES = new Set(['open', 'evidence_building', 'ready_for_review']);
const DOC_KINDS = new Set(['terms', 'refund_policy', 'cancellation_policy', 'privacy_policy']);
const ON_DISPUTE_POLICIES = new Set(['keep_access', 'suspend_access']);
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const DISCORD_ID_RE = /^\d{15,24}$/;

function invalid(message) { return new TypeError(message); }

function requireId(value, name) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw invalid(`${name} must be a positive integer`);
  return id;
}

function requireText(value, name, maximum = 240) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maximum) throw invalid(`${name} must be a non-empty string of at most ${maximum} characters`);
  return text;
}

function requireIso(value, name) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) throw invalid(`${name} must be a valid timestamp`);
  return new Date(ms).toISOString();
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function submissionIdempotencyKey(caseId, responseCycle, packetVersion) {
  return `dispute-submit:${caseId}:${responseCycle}:${packetVersion}`;
}

function hashReviewToken(rawToken) {
  return sha256Hex(Buffer.from(String(rawToken), 'utf8'));
}

function caseSummary(row) {
  return {
    caseId: Number(row.id),
    provider: row.provider,
    providerDisputeId: row.provider_dispute_id,
    reason: row.reason,
    providerStatus: row.provider_status,
    lifecycleStage: row.lifecycle_stage,
    amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
    currency: row.currency,
    dueBy: row.due_by,
    caseState: row.case_state,
    responseCycle: Number(row.response_cycle),
    merchantAccount: row.merchant_account
  };
}

function parseManifest(packetRow) {
  const manifest = packetRow.manifest;
  if (manifest && typeof manifest === 'object') return manifest;
  if (typeof manifest === 'string') {
    try { return JSON.parse(manifest); } catch (_) { /* fall through */ }
  }
  throw new Error('dispute packet manifest is unreadable');
}

function createDisputeService(deps) {
  const {
    pool,
    store,               // evidence-store: appendChained/appendRow/encryptValue/activeKeyVersion
    stripe,              // stripe SDK-shaped client: disputes.update(id, params, opts)
    stripeFiles,         // stripe-files client: upload/uploadAll
    paypalClient,        // paypal client: provideEvidence(id, body)
    limits,              // provider-limits: validateStripeEvidence/validatePayPalEvidence
    engine,              // evidence-engine: buildPacketModel (pure)
    packetGenerator,     // packet-generator: generatePacket (pure)
    randomBytes = crypto.randomBytes,
    now = Date.now
  } = deps || {};
  if (!pool || !store) throw new Error('dispute service requires a pool and an evidence store');

  const nowIso = () => new Date(now()).toISOString();

  async function withTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { /* original error wins */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async function audit(client, caseId, actorKind, actorRef, action, detail) {
    const at = nowIso();
    return store.appendChained(client, {
      table: 'dispute_audit_log',
      scopeKey: caseId == null ? 0 : Number(caseId),
      fields: {
        case_id: caseId == null ? null : Number(caseId),
        actor_kind: actorKind,
        actor_ref: actorRef == null ? null : String(actorRef),
        action,
        detail: detail || {},
        source: 'sml_platform',
        source_event_id: null,
        provider_account: null,
        occurred_at: at,
        received_at: at,
        provenance: {}
      }
    });
  }

  async function enqueueAlert(client, sourceKey, payload) {
    await client.query(
      `INSERT INTO billing_outbox (source_key, intent_type, payload)
       VALUES ($1, 'dispute_alert', $2::jsonb)
       ON CONFLICT (source_key) DO NOTHING`,
      [sourceKey, JSON.stringify(payload)]
    );
  }

  async function loadCase(caseId) {
    const result = await pool.query(`SELECT * FROM dispute_cases WHERE id = $1`, [caseId]);
    const row = result.rows[0];
    if (!row) throw invalid('dispute case not found');
    return row;
  }

  async function listCases(input = {}) {
    let states = DEFAULT_LIST_STATES;
    if (input.states != null) {
      if (!Array.isArray(input.states) || !input.states.length) throw invalid('states must be a non-empty array');
      states = input.states.map((state) => {
        if (!CASE_STATES.has(state)) throw invalid(`unknown case state: ${String(state).slice(0, 40)}`);
        return state;
      });
    }
    let limit = 50;
    if (input.limit != null) {
      limit = Number(input.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw invalid('limit must be between 1 and 200');
    }
    const result = await pool.query(
      `SELECT * FROM dispute_cases
        WHERE case_state = ANY($1)
        ORDER BY due_by ASC NULLS LAST, id ASC
        LIMIT $2`,
      [states, limit]
    );
    return { cases: result.rows.map(caseSummary) };
  }

  async function caseDetail(input) {
    const caseId = requireId(input && input.caseId, 'caseId');
    const caseRow = await loadCase(caseId);
    const [evidence, packets, submissions, auditRows] = await Promise.all([
      pool.query(
        `SELECT id, kind, body_text, body_json, file_name, file_sha256, cited_records, superseded_by, occurred_at
           FROM dispute_evidence_items WHERE case_id = $1 ORDER BY id ASC`, [caseId]
      ),
      pool.query(
        `SELECT id, version, response_cycle, warnings, pdf_sha256, packet_sha256, generator_version, created_at
           FROM dispute_packets WHERE case_id = $1 ORDER BY version ASC`, [caseId]
      ),
      pool.query(
        `SELECT id, packet_id, response_cycle, approved_by_wp_user, approved_at, status,
                provider_request_id, submitted_at, created_at
           FROM dispute_submissions WHERE case_id = $1 ORDER BY id ASC`, [caseId]
      ),
      pool.query(
        `SELECT id, actor_kind, actor_ref, action, detail, occurred_at
           FROM dispute_audit_log WHERE case_id = $1 ORDER BY id DESC LIMIT 50`, [caseId]
      )
    ]);
    return {
      case: caseSummary(caseRow),
      allowedActions: caseRow.allowed_actions,
      requestedEvidence: caseRow.requested_evidence,
      evidenceItems: evidence.rows,
      packets: packets.rows,
      submissions: submissions.rows,
      auditLog: auditRows.rows
    };
  }

  async function loadRegistryRows(caseRow) {
    const identityId = caseRow.identity_id == null ? null : Number(caseRow.identity_id);
    const byIdentity = async (sql) => identityId == null
      ? { rows: [] }
      : pool.query(sql, [identityId]);

    const subscriptionRow = caseRow.subscription_id == null ? null : (await pool.query(
      `SELECT * FROM billing_subscriptions WHERE id = $1`, [Number(caseRow.subscription_id)]
    )).rows[0] || null;

    const transactionRows = identityId != null
      ? (await pool.query(`SELECT * FROM billing_transactions WHERE identity_id = $1 ORDER BY id ASC`, [identityId])).rows
      : caseRow.transaction_id != null
        ? (await pool.query(`SELECT * FROM billing_transactions WHERE id = $1`, [Number(caseRow.transaction_id)])).rows
        : [];

    const identityRow = identityId == null ? null : (await pool.query(
      `SELECT * FROM billing_identities WHERE id = $1`, [identityId]
    )).rows[0] || null;

    const [refunds, cancellations, consents, usage, entitlements, notifications, terms] = await Promise.all([
      pool.query(`SELECT * FROM refund_events WHERE transaction_id = ANY($1) ORDER BY id ASC`,
        [transactionRows.map((row) => Number(row.id))]),
      byIdentity(`SELECT * FROM cancellation_requests WHERE identity_id = $1 ORDER BY id ASC`),
      byIdentity(`SELECT * FROM customer_consents WHERE identity_id = $1 ORDER BY id ASC`),
      byIdentity(`SELECT * FROM service_usage_events WHERE identity_id = $1 ORDER BY id ASC`),
      byIdentity(`SELECT * FROM entitlement_events WHERE identity_id = $1 ORDER BY id ASC`),
      byIdentity(`SELECT * FROM notification_delivery_events WHERE identity_id = $1 ORDER BY id ASC`),
      pool.query(`SELECT * FROM terms_versions ORDER BY effective_from ASC`, [])
    ]);

    const upgradeChatRows = identityRow && identityRow.discord_user_id
      ? (await pool.query(`SELECT * FROM upgrade_chat_records WHERE discord_user_id = $1 ORDER BY id ASC`,
          [identityRow.discord_user_id])).rows
      : [];

    return {
      subscriptionRow,
      transactionRows,
      refundRows: refunds.rows,
      cancellationRows: cancellations.rows,
      consentRows: consents.rows,
      termsRows: terms.rows,
      usageRows: usage.rows,
      entitlementRows: entitlements.rows,
      notificationRows: notifications.rows,
      upgradeChatRows
    };
  }

  async function buildPacket(input) {
    if (!engine || !packetGenerator) throw new Error('packet building is unconfigured');
    const caseId = requireId(input && input.caseId, 'caseId');
    const wpUserId = requireId(input && input.wpUserId, 'wpUserId');
    const caseRow = await loadCase(caseId);
    if (!PACKET_BUILDABLE_STATES.has(caseRow.case_state)) {
      throw invalid(`a packet cannot be built while the case is in state ${caseRow.case_state}`);
    }
    const evidenceItems = (await pool.query(
      `SELECT * FROM dispute_evidence_items WHERE case_id = $1 AND superseded_by IS NULL ORDER BY id ASC`,
      [caseId]
    )).rows;
    const registry = await loadRegistryRows(caseRow);
    const model = engine.buildPacketModel({ now: now(), caseRow, evidenceItems, ...registry });

    return withTransaction(async (client) => {
      const locked = await client.query(`SELECT * FROM dispute_cases WHERE id = $1 FOR UPDATE`, [caseId]);
      const current = locked.rows[0];
      if (!current) throw invalid('dispute case not found');
      if (!PACKET_BUILDABLE_STATES.has(current.case_state)) {
        throw invalid(`a packet cannot be built while the case is in state ${current.case_state}`);
      }
      const versionResult = await client.query(
        `SELECT COALESCE(MAX(version), 0) AS max_version FROM dispute_packets WHERE case_id = $1`, [caseId]
      );
      const version = Number(versionResult.rows[0] ? versionResult.rows[0].max_version : 0) + 1;
      const generated = packetGenerator.generatePacket({
        model, caseRow: current, version, generatedAt: nowIso()
      });
      const inserted = await client.query(
        `INSERT INTO dispute_packets (
           case_id, version, response_cycle, manifest, warnings, pdf_sha256, pdf_bytes,
           packet_sha256, generator_version, created_at
         ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10) RETURNING id`,
        [caseId, version, Number(current.response_cycle), JSON.stringify(generated.manifest),
          JSON.stringify(model.warnings || []), generated.pdfSha256, generated.pdfBuffer,
          generated.packetSha256, generated.generatorVersion || 'unknown', nowIso()]
      );
      if (current.case_state !== 'ready_for_review') {
        await client.query(`UPDATE dispute_cases SET case_state = $2 WHERE id = $1`, [caseId, 'ready_for_review']);
      }
      await audit(client, caseId, 'wp_admin', wpUserId, 'packet_built', {
        packet_id: Number(inserted.rows[0].id),
        version,
        response_cycle: Number(current.response_cycle),
        packet_sha256: generated.packetSha256,
        warning_count: (model.warnings || []).length
      });
      return {
        packetId: Number(inserted.rows[0].id),
        version,
        responseCycle: Number(current.response_cycle),
        packetSha256: generated.packetSha256,
        warnings: model.warnings || [],
        checklist: model.checklist || []
      };
    });
  }

  async function issueReviewToken(input) {
    const caseId = requireId(input && input.caseId, 'caseId');
    const discordUserId = String(input && input.discordUserId || '');
    if (!DISCORD_ID_RE.test(discordUserId)) throw invalid('a valid Discord user id is required');
    const identityId = input && input.identityId != null ? requireId(input.identityId, 'identityId') : null;

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = hashReviewToken(rawToken);
    const issuedAt = nowIso();
    const expiresAt = new Date(now() + REVIEW_TOKEN_TTL_MS).toISOString();

    await withTransaction(async (client) => {
      const found = await client.query(`SELECT * FROM dispute_cases WHERE id = $1`, [caseId]);
      if (!found.rows[0]) throw invalid('dispute case not found');
      const inserted = await client.query(
        `INSERT INTO dispute_review_tokens (
           token_hash, case_id, issued_to_discord_user, issued_to_identity, issued_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tokenHash, caseId, discordUserId, identityId, issuedAt, expiresAt]
      );
      await audit(client, caseId, 'discord_user', discordUserId, 'review_token_issued', {
        token_id: Number(inserted.rows[0].id),
        expires_at: expiresAt
      });
    });
    // The raw token is returned to the caller once and never stored or logged.
    return { token: rawToken, expiresAt };
  }

  /**
   * Redeem a single-use review token and return the case summary scope for
   * the WordPress /connect-review/ page.
   *
   * SECURITY: the token alone grants nothing. The caller (the WordPress
   * plugin behind the signed admin API) MUST have already re-authorized the
   * WordPress user server-side — logged in, with the required capability
   * for the case's merchant scope — before calling this. This function only
   * consumes the token (single-use, 15 minute TTL) and records who redeemed
   * it; it does not perform WordPress authorization itself.
   */
  async function redeemReviewToken(input) {
    const rawToken = typeof (input && input.token) === 'string' ? input.token.trim() : '';
    if (!rawToken || rawToken.length > 128) throw invalid('a review token is required');
    const wpUserId = requireId(input && input.wpUserId, 'wpUserId');
    const tokenHash = hashReviewToken(rawToken);
    const at = nowIso();

    return withTransaction(async (client) => {
      const claimed = await client.query(
        `UPDATE dispute_review_tokens
            SET used_at = $2, used_by_wp_user = $3
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
          RETURNING id, case_id, issued_to_discord_user`,
        [tokenHash, at, wpUserId]
      );
      const token = claimed.rows[0];
      if (!token) throw invalid('review token is invalid, expired, or already used');
      const found = await client.query(`SELECT * FROM dispute_cases WHERE id = $1`, [Number(token.case_id)]);
      const caseRow = found.rows[0];
      if (!caseRow) throw invalid('dispute case not found');
      await audit(client, Number(token.case_id), 'wp_admin', wpUserId, 'review_token_redeemed', {
        token_id: Number(token.id),
        issued_to_discord_user: token.issued_to_discord_user
      });
      return { case: caseSummary(caseRow) };
    });
  }

  function validateAgainstProviderLimits(caseRow, manifest) {
    if (!limits) throw new Error('provider limit validation is unconfigured');
    if (caseRow.provider === 'stripe') {
      const evidence = manifest.stripeEvidence;
      if (!evidence || typeof evidence !== 'object' || !evidence.fieldsObj) {
        throw invalid('packet has no Stripe evidence mapping');
      }
      const result = limits.validateStripeEvidence(caseRow.reason, evidence.fieldsObj, evidence.filesPlan || []);
      if (!result || !result.ok) {
        const violations = (result && result.violations || ['unknown violation']).map(String).join('; ');
        throw invalid(`evidence failed provider validation: ${violations.slice(0, 400)}`);
      }
      return { kind: 'stripe', evidence };
    }
    if (caseRow.provider === 'paypal') {
      const evidence = manifest.paypalEvidence;
      if (!evidence || typeof evidence !== 'object' || !Array.isArray(evidence.evidences)) {
        throw invalid('packet has no PayPal evidence mapping');
      }
      const result = limits.validatePayPalEvidence(
        caseRow.requested_evidence, caseRow.allowed_actions, evidence.evidences
      );
      if (!result || !result.ok) {
        const violations = (result && result.violations || ['unknown violation']).map(String).join('; ');
        throw invalid(`evidence failed provider validation: ${violations.slice(0, 400)}`);
      }
      return { kind: 'paypal', evidence };
    }
    throw invalid(`unsupported dispute provider: ${String(caseRow.provider).slice(0, 40)}`);
  }

  async function resolvePlannedFileBytes(caseId, packetRow, filesPlan) {
    const files = [];
    for (const plan of filesPlan) {
      if (plan.source === 'packet_pdf') {
        files.push({
          field: plan.field,
          fileName: plan.fileName || `dispute-packet-v${packetRow.version}.pdf`,
          contentType: 'application/pdf',
          bytes: Buffer.isBuffer(packetRow.pdf_bytes) ? packetRow.pdf_bytes : Buffer.from(packetRow.pdf_bytes || '')
        });
        continue;
      }
      const evidenceItemId = requireId(plan.evidenceItemId, 'filesPlan evidenceItemId');
      const found = await pool.query(
        `SELECT id, file_name, file_bytes FROM dispute_evidence_items WHERE id = $1 AND case_id = $2`,
        [evidenceItemId, caseId]
      );
      const item = found.rows[0];
      if (!item || item.file_bytes == null) throw invalid('planned evidence file is missing its stored bytes');
      files.push({
        field: plan.field,
        fileName: plan.fileName || item.file_name || `evidence-${evidenceItemId}.pdf`,
        contentType: plan.contentType || 'application/pdf',
        bytes: Buffer.isBuffer(item.file_bytes) ? item.file_bytes : Buffer.from(item.file_bytes)
      });
    }
    return files;
  }

  async function recordSubmissionOutcome({ caseRow, submissionId, responseCycle, outcome, providerRequestId, providerResponse, confirmationExtra }) {
    const at = nowIso();
    const failed = outcome !== 'submitted';
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE dispute_submissions
            SET status = $2, provider_request_id = $3, provider_response = $4::jsonb,
                submitted_at = $5, confirmation = confirmation || $6::jsonb
          WHERE id = $1`,
        [submissionId, failed ? 'failed' : 'submitted', providerRequestId || null,
          JSON.stringify(providerResponse || {}), failed ? null : at,
          JSON.stringify(confirmationExtra || {})]
      );
      await client.query(
        `UPDATE dispute_cases SET case_state = $2 WHERE id = $1`,
        [Number(caseRow.id), failed ? 'ready_for_review' : 'submitted']
      );
      await audit(client, Number(caseRow.id), 'system', null,
        failed ? 'submission_failed' : 'submission_submitted', {
          submission_id: submissionId,
          response_cycle: responseCycle,
          provider_request_id: providerRequestId || null
        });
      await enqueueAlert(client,
        `dispute-alert:${caseRow.provider}:${caseRow.provider_dispute_id}:submission_result:${responseCycle}:${submissionId}`,
        {
          noticeType: 'submission_result',
          caseId: Number(caseRow.id),
          submissionId,
          responseCycle,
          result: failed ? 'failed' : 'submitted'
        });
    });
  }

  // approveAndSubmit: the only code path that sends evidence to a provider.
  //
  // Phase 1 (no claim): load case + packet, verify the approving admin saw
  //   the exact packet (input.packetSha256 must equal the stored hash and
  //   the stored hash must re-derive from the stored bytes), then run
  //   provider-limit validation. A validation failure throws before any
  //   claim is taken.
  // Phase 2 (claim txn): SELECT the case row FOR UPDATE, re-validate
  //   case_state + response_cycle, INSERT the dispute_submissions row with
  //   status 'submitting'. The partial unique index on (case_id,
  //   response_cycle) WHERE status IN ('submitting','submitted') makes a
  //   concurrent second click impossible (unique violation -> TypeError
  //   'submission_already_in_progress'). COMMIT before any provider call.
  // Phase 3 (provider, outside the claim txn): Stripe file uploads first
  //   (purpose=dispute_evidence, files.stripe.com), then disputes.update
  //   with evidence + submit:true and idempotency key
  //   dispute-submit:{caseId}:{cycle}:{packetVersion}; or PayPal
  //   provideEvidence. A crash here leaves the row 'submitting' for the
  //   worker's stuck-submission sweep (never a blind retry).
  // Phase 4 (record txn): provider response + status + audit + outbox
  //   'dispute_alert' submission_result.
  async function approveAndSubmit(input) {
    const caseId = requireId(input && input.caseId, 'caseId');
    const packetId = requireId(input && input.packetId, 'packetId');
    const wpUserId = requireId(input && input.wpUserId, 'wpUserId');
    const packetSha256 = String(input && input.packetSha256 || '').toLowerCase();
    if (!SHA256_HEX_RE.test(packetSha256)) throw invalid('packetSha256 must be the sha256 of the reviewed packet');
    const confirmation = input && input.confirmation;
    if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation) ||
        confirmation.confirmed !== true || typeof confirmation.checkboxLabel !== 'string' ||
        !confirmation.checkboxLabel.trim()) {
      throw invalid('an explicit confirmation with its displayed checkbox text is required');
    }

    // Phase 1: read + validate. Nothing is claimed yet.
    const caseRow = await loadCase(caseId);
    if (!SUBMITTABLE_STATES.has(caseRow.case_state)) {
      throw invalid(`the case is not ready for submission (state ${caseRow.case_state})`);
    }
    const packetResult = await pool.query(`SELECT * FROM dispute_packets WHERE id = $1`, [packetId]);
    const packetRow = packetResult.rows[0];
    if (!packetRow || Number(packetRow.case_id) !== caseId) throw invalid('dispute packet not found for this case');
    if (Number(packetRow.response_cycle) !== Number(caseRow.response_cycle)) {
      throw invalid('the packet was built for a different response cycle; rebuild the packet');
    }
    if (String(packetRow.packet_sha256).toLowerCase() !== packetSha256) {
      throw invalid('packetSha256 does not match the stored packet; review the current packet');
    }
    const manifest = parseManifest(packetRow);
    const mapping = validateAgainstProviderLimits(caseRow, manifest);
    const responseCycle = Number(caseRow.response_cycle);
    const idempotencyKey = submissionIdempotencyKey(caseId, responseCycle, Number(packetRow.version));

    // Resolve file bytes before claiming so a missing file never strands a claim.
    const plannedFiles = mapping.kind === 'stripe'
      ? await resolvePlannedFileBytes(caseId, packetRow, mapping.evidence.filesPlan || [])
      : [];

    // Phase 2: claim.
    const submissionId = await withTransaction(async (client) => {
      const locked = await client.query(`SELECT * FROM dispute_cases WHERE id = $1 FOR UPDATE`, [caseId]);
      const current = locked.rows[0];
      if (!current) throw invalid('dispute case not found');
      if (!SUBMITTABLE_STATES.has(current.case_state)) {
        throw invalid(`the case is not ready for submission (state ${current.case_state})`);
      }
      if (Number(current.response_cycle) !== responseCycle) {
        throw invalid('the case response cycle changed; rebuild the packet');
      }
      let inserted;
      try {
        inserted = await client.query(
          `INSERT INTO dispute_submissions (
             case_id, packet_id, response_cycle, approved_by_wp_user, approved_at,
             confirmation, status, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'submitting',$7) RETURNING id`,
          [caseId, packetId, responseCycle, wpUserId, nowIso(),
            JSON.stringify(confirmation), nowIso()]
        );
      } catch (error) {
        if (error && error.code === '23505') throw invalid('submission_already_in_progress');
        throw error;
      }
      const id = Number(inserted.rows[0].id);
      await client.query(`UPDATE dispute_cases SET case_state = $2 WHERE id = $1`, [caseId, 'submitting']);
      await audit(client, caseId, 'wp_admin', wpUserId, 'submission_claimed', {
        submission_id: id,
        packet_id: packetId,
        packet_version: Number(packetRow.version),
        response_cycle: responseCycle,
        packet_sha256: packetSha256
      });
      return id;
    });

    // Phase 3: provider calls, outside the claim transaction.
    let providerRequestId = null;
    let providerResponse = null;
    let confirmationExtra = {};
    try {
      if (mapping.kind === 'stripe') {
        if (!stripe || !stripeFiles) throw new Error('stripe submission is unconfigured');
        let fileFields = {};
        if (plannedFiles.length) {
          const uploaded = await stripeFiles.uploadAll(plannedFiles, { idempotencyKeyBase: idempotencyKey });
          fileFields = uploaded.fieldFileIds;
          confirmationExtra = { stripe_file_ids: fileFields };
        }
        const response = await stripe.disputes.update(
          caseRow.provider_dispute_id,
          { evidence: { ...mapping.evidence.fieldsObj, ...fileFields }, submit: true },
          { idempotencyKey }
        );
        providerRequestId = response && typeof response.id === 'string' ? response.id : null;
        providerResponse = {
          id: providerRequestId,
          status: response && response.status || null,
          submission_count: response && response.evidence_details
            ? response.evidence_details.submission_count : null
        };
      } else {
        if (!paypalClient) throw new Error('paypal submission is unconfigured');
        const response = await paypalClient.provideEvidence(caseRow.provider_dispute_id, {
          evidences: mapping.evidence.evidences,
          notes: mapping.evidence.notes,
          files: mapping.evidence.files || []
        });
        providerRequestId = response && response.requestId ? String(response.requestId) : null;
        providerResponse = { links: response && response.links || null };
      }
    } catch (error) {
      const summary = String((error && (error.code || error.message)) || 'provider_error').slice(0, 240);
      await recordSubmissionOutcome({
        caseRow, submissionId, responseCycle, outcome: 'failed',
        providerRequestId: null, providerResponse: { error: summary }, confirmationExtra
      });
      throw error;
    }

    // Phase 4: record success.
    await recordSubmissionOutcome({
      caseRow, submissionId, responseCycle, outcome: 'submitted',
      providerRequestId, providerResponse, confirmationExtra
    });
    return {
      submissionId,
      caseId,
      responseCycle,
      status: 'submitted',
      idempotencyKey,
      providerRequestId
    };
  }

  async function recordPolicy(input) {
    const merchantScope = requireText(input && input.merchantScope, 'merchantScope', 191);
    const onDispute = String(input && input.onDispute || '');
    if (!ON_DISPUTE_POLICIES.has(onDispute)) {
      throw invalid('onDispute must be keep_access or suspend_access');
    }
    const disclosedAt = input && input.disclosedAt != null ? requireIso(input.disclosedAt, 'disclosedAt') : null;
    const termsVersionId = input && input.policyTermsVersionId != null
      ? requireId(input.policyTermsVersionId, 'policyTermsVersionId') : null;
    if (onDispute === 'suspend_access' && (!disclosedAt || !termsVersionId)) {
      throw invalid('suspend_access requires a disclosed policy: disclosedAt and policyTermsVersionId');
    }
    const wpUserId = requireId(input && input.wpUserId, 'wpUserId');

    return withTransaction(async (client) => {
      const upserted = await client.query(
        `INSERT INTO dispute_access_policies (merchant_scope, on_dispute, disclosed_at, policy_terms_version_id, updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (merchant_scope) DO UPDATE
           SET on_dispute = EXCLUDED.on_dispute,
               disclosed_at = EXCLUDED.disclosed_at,
               policy_terms_version_id = EXCLUDED.policy_terms_version_id,
               updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [merchantScope, onDispute, disclosedAt, termsVersionId, nowIso()]
      );
      await audit(client, null, 'wp_admin', wpUserId, 'access_policy_recorded', {
        merchant_scope: merchantScope,
        on_dispute: onDispute,
        policy_terms_version_id: termsVersionId
      });
      return { policyId: Number(upserted.rows[0].id), merchantScope, onDispute };
    });
  }

  async function recordTermsVersion(input) {
    const versionLabel = requireText(input && input.versionLabel, 'versionLabel', 120);
    const content = typeof (input && input.content) === 'string' ? input.content : '';
    if (!content) throw invalid('content is required');
    const docKind = String(input && input.docKind || 'terms');
    if (!DOC_KINDS.has(docKind)) throw invalid('unknown docKind');
    const effectiveFrom = requireIso(input && input.effectiveFrom, 'effectiveFrom');
    const url = input && input.url != null ? requireText(input.url, 'url', 500) : null;
    const wpUserId = requireId(input && input.wpUserId, 'wpUserId');
    const contentSha256 = sha256Hex(Buffer.from(content, 'utf8'));

    return withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO terms_versions (version_label, url, content_sha256, content, doc_kind, effective_from, captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (content_sha256) DO NOTHING
         RETURNING id`,
        [versionLabel, url, contentSha256, content, docKind, effectiveFrom, nowIso()]
      );
      let termsVersionId;
      let duplicate = false;
      if (inserted.rows[0]) {
        termsVersionId = Number(inserted.rows[0].id);
      } else {
        duplicate = true;
        const existing = await client.query(
          `SELECT id FROM terms_versions WHERE content_sha256 = $1`, [contentSha256]
        );
        if (!existing.rows[0]) throw new Error('terms version insert did not land and no existing row was found');
        termsVersionId = Number(existing.rows[0].id);
      }
      await audit(client, null, 'wp_admin', wpUserId, 'terms_version_recorded', {
        terms_version_id: termsVersionId,
        doc_kind: docKind,
        content_sha256: contentSha256,
        duplicate
      });
      return { termsVersionId, contentSha256, duplicate };
    });
  }

  async function recordConsent(input) {
    const identityId = requireId(input && input.identityId, 'identityId');
    const termsVersionId = requireId(input && input.termsVersionId, 'termsVersionId');
    const controlLabel = requireText(input && input.controlLabel, 'controlLabel', 500);
    const acceptedAt = requireIso(input && input.acceptedAt, 'acceptedAt');
    let displayedPriceCents = null;
    if (input.displayedPriceCents != null) {
      displayedPriceCents = Number(input.displayedPriceCents);
      if (!Number.isSafeInteger(displayedPriceCents) || displayedPriceCents < 0) {
        throw invalid('displayedPriceCents must be a non-negative integer number of cents');
      }
    }
    const displayedCurrency = input.displayedCurrency != null ? requireText(input.displayedCurrency, 'displayedCurrency', 8) : null;
    const displayedInterval = input.displayedInterval != null ? requireText(input.displayedInterval, 'displayedInterval', 24) : null;
    const trialDisclosure = input.trialDisclosure != null ? requireText(input.trialDisclosure, 'trialDisclosure', 2000) : null;
    const checkoutSessionRef = input.checkoutSessionRef != null ? requireText(input.checkoutSessionRef, 'checkoutSessionRef', 191) : null;
    const source = input.source != null ? String(input.source) : 'sml_platform';
    const occurredAt = input.occurredAt != null ? requireIso(input.occurredAt, 'occurredAt') : acceptedAt;

    // The purchase IP is stored encrypted only (never logged, never echoed).
    let purchaseIpEnc = null;
    let keyVersion = null;
    if (input.purchaseIp != null) {
      const ip = requireText(input.purchaseIp, 'purchaseIp', 64);
      purchaseIpEnc = store.encryptValue(ip);
      keyVersion = store.activeKeyVersion;
    }

    return withTransaction(async (client) => {
      const appended = await store.appendRow(client, {
        table: 'customer_consents',
        fields: {
          identity_id: identityId,
          terms_version_id: termsVersionId,
          control_label: controlLabel,
          displayed_price_cents: displayedPriceCents,
          displayed_currency: displayedCurrency,
          displayed_interval: displayedInterval,
          trial_disclosure: trialDisclosure,
          accepted_at: acceptedAt,
          checkout_session_ref: checkoutSessionRef,
          purchase_ip_enc: purchaseIpEnc,
          key_version: keyVersion,
          source,
          source_event_id: input.sourceEventId != null ? String(input.sourceEventId) : null,
          provider_account: null,
          occurred_at: occurredAt,
          received_at: nowIso(),
          provenance: input.provenance && typeof input.provenance === 'object' ? input.provenance : {}
        }
      });
      await audit(client, null, 'system', null, 'consent_recorded', {
        consent_id: Number(appended.id),
        identity_id: identityId,
        terms_version_id: termsVersionId,
        has_purchase_ip: purchaseIpEnc != null
      });
      return { consentId: Number(appended.id) };
    });
  }

  return {
    listCases,
    caseDetail,
    buildPacket,
    issueReviewToken,
    redeemReviewToken,
    approveAndSubmit,
    recordPolicy,
    recordTermsVersion,
    recordConsent
  };
}

module.exports = {
  REVIEW_TOKEN_TTL_MS,
  createDisputeService,
  hashReviewToken,
  submissionIdempotencyKey
};
