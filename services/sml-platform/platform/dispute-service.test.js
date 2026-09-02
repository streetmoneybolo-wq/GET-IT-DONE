'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  REVIEW_TOKEN_TTL_MS,
  createDisputeService,
  hashReviewToken,
  submissionIdempotencyKey
} = require('./dispute-service');

const NOW = 1_756_800_000_000; // fixed clock; the service never reads Date.now
const PACKET_SHA = 'ab'.repeat(32);

function iso(ms) { return new Date(ms).toISOString(); }

// ---------------------------------------------------------------------------
// In-memory fake database. It emulates exactly the guarantees the service
// relies on: the FOR UPDATE row lock on dispute_cases (per-case mutex,
// released at COMMIT/ROLLBACK) and the partial unique index on
// dispute_submissions (case_id, response_cycle) WHERE status IN
// ('submitting','submitted') (synchronous check-and-insert -> 23505).
// ---------------------------------------------------------------------------
function fakeDb(options = {}) {
  const state = {
    cases: new Map(),
    packets: new Map(),
    submissions: [],
    tokens: new Map(),
    outbox: new Map(),
    evidenceItems: new Map(),
    terms: new Map(),
    policies: new Map(),
    nextId: 1000
  };
  const calls = [];
  const locks = new Map();
  const locking = options.locking !== false;

  async function acquireLock(held, key) {
    while (locks.has(key)) await locks.get(key);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    locks.set(key, gate);
    held.push(() => { locks.delete(key); release(); });
  }

  function releaseAll(held) {
    while (held.length) held.pop()();
  }

  function makeClient() {
    const held = [];
    return {
      async query(sql, values = []) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        calls.push({ text, values });

        if (text === 'BEGIN') return { rows: [], rowCount: 0 };
        if (text === 'COMMIT' || text === 'ROLLBACK') { releaseAll(held); return { rows: [], rowCount: 0 }; }

        if (text.startsWith('SELECT * FROM dispute_cases WHERE id = $1 FOR UPDATE')) {
          const caseId = Number(values[0]);
          if (locking) await acquireLock(held, `case:${caseId}`);
          const row = state.cases.get(caseId);
          return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('SELECT * FROM dispute_cases WHERE id = $1')) {
          const row = state.cases.get(Number(values[0]));
          return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('SELECT * FROM dispute_cases WHERE case_state')) {
          const wanted = new Set(values[0]);
          const rows = [...state.cases.values()].filter((row) => wanted.has(row.case_state));
          return { rows: rows.slice(0, Number(values[1])), rowCount: rows.length };
        }
        if (text.startsWith('SELECT * FROM dispute_packets WHERE id = $1')) {
          const row = state.packets.get(Number(values[0]));
          return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('SELECT COALESCE(MAX(version), 0) AS max_version FROM dispute_packets')) {
          const versions = [...state.packets.values()]
            .filter((row) => Number(row.case_id) === Number(values[0]))
            .map((row) => Number(row.version));
          return { rows: [{ max_version: versions.length ? Math.max(...versions) : 0 }], rowCount: 1 };
        }
        if (text.startsWith('INSERT INTO dispute_packets')) {
          const id = state.nextId++;
          state.packets.set(id, {
            id, case_id: Number(values[0]), version: Number(values[1]), response_cycle: Number(values[2]),
            manifest: JSON.parse(values[3]), warnings: JSON.parse(values[4]), pdf_sha256: values[5],
            pdf_bytes: values[6], packet_sha256: values[7], generator_version: values[8], created_at: values[9]
          });
          return { rows: [{ id }], rowCount: 1 };
        }
        if (text.startsWith('INSERT INTO dispute_submissions')) {
          const caseId = Number(values[0]);
          const cycle = Number(values[2]);
          // Partial unique (case_id, response_cycle) WHERE status IN ('submitting','submitted').
          const conflict = state.submissions.some((row) =>
            Number(row.case_id) === caseId && Number(row.response_cycle) === cycle &&
            (row.status === 'submitting' || row.status === 'submitted'));
          if (conflict) {
            throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
          }
          const id = state.nextId++;
          state.submissions.push({
            id, case_id: caseId, packet_id: Number(values[1]), response_cycle: cycle,
            approved_by_wp_user: Number(values[3]), approved_at: values[4],
            confirmation: JSON.parse(values[5]), status: 'submitting',
            provider_request_id: null, provider_response: null, submitted_at: null, created_at: values[6]
          });
          return { rows: [{ id }], rowCount: 1 };
        }
        if (text.startsWith('UPDATE dispute_submissions SET status')) {
          const row = state.submissions.find((item) => item.id === Number(values[0]));
          if (!row) return { rows: [], rowCount: 0 };
          row.status = values[1];
          row.provider_request_id = values[2];
          row.provider_response = JSON.parse(values[3]);
          row.submitted_at = values[4];
          row.confirmation = { ...row.confirmation, ...JSON.parse(values[5]) };
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith('UPDATE dispute_cases SET case_state')) {
          if (!options.ignoreCaseStateUpdates) {
            const row = state.cases.get(Number(values[0]));
            if (row) row.case_state = values[1];
          }
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith('INSERT INTO billing_outbox')) {
          if (!state.outbox.has(values[0])) {
            state.outbox.set(values[0], { source_key: values[0], intent_type: 'dispute_alert', payload: JSON.parse(values[1]) });
          }
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith('INSERT INTO dispute_review_tokens')) {
          const id = state.nextId++;
          state.tokens.set(values[0], {
            id, token_hash: values[0], case_id: Number(values[1]), issued_to_discord_user: values[2],
            issued_to_identity: values[3], issued_at: values[4], expires_at: values[5],
            used_at: null, used_by_wp_user: null
          });
          return { rows: [{ id }], rowCount: 1 };
        }
        if (text.startsWith('UPDATE dispute_review_tokens')) {
          const row = state.tokens.get(values[0]);
          // Synchronous single-use claim: UPDATE ... WHERE used_at IS NULL AND expires_at > $2.
          if (!row || row.used_at !== null || Date.parse(row.expires_at) <= Date.parse(values[1])) {
            return { rows: [], rowCount: 0 };
          }
          row.used_at = values[1];
          row.used_by_wp_user = Number(values[2]);
          return {
            rows: [{ id: row.id, case_id: row.case_id, issued_to_discord_user: row.issued_to_discord_user }],
            rowCount: 1
          };
        }
        if (text.startsWith('SELECT id, file_name, file_bytes FROM dispute_evidence_items')) {
          const row = state.evidenceItems.get(Number(values[0]));
          const match = row && Number(row.case_id) === Number(values[1]) ? [{ ...row }] : [];
          return { rows: match, rowCount: match.length };
        }
        if (text.startsWith('INSERT INTO terms_versions')) {
          if (state.terms.has(values[2])) return { rows: [], rowCount: 0 };
          const id = state.nextId++;
          state.terms.set(values[2], { id, content_sha256: values[2], version_label: values[0] });
          return { rows: [{ id }], rowCount: 1 };
        }
        if (text.startsWith('SELECT id FROM terms_versions')) {
          const row = state.terms.get(values[0]);
          return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
        }
        if (text.startsWith('INSERT INTO dispute_access_policies')) {
          const existing = state.policies.get(values[0]);
          const id = existing ? existing.id : state.nextId++;
          state.policies.set(values[0], {
            id, merchant_scope: values[0], on_dispute: values[1],
            disclosed_at: values[2], policy_terms_version_id: values[3], updated_at: values[4]
          });
          return { rows: [{ id }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release() { releaseAll(held); }
    };
  }

  const shared = makeClient();
  return {
    state,
    calls,
    pool: {
      async connect() { return makeClient(); },
      async query(sql, values) { return shared.query(sql, values); }
    }
  };
}

function fakeStore() {
  const audits = [];
  const appendedRows = [];
  return {
    audits,
    appendedRows,
    async appendChained(_client, { table, scopeKey, fields }) {
      audits.push({ table, scopeKey, fields });
      return { id: audits.length, integrityHash: `hash_${audits.length}` };
    },
    async appendRow(_client, { table, fields }) {
      appendedRows.push({ table, fields });
      return { id: appendedRows.length, integrityHash: `hash_r${appendedRows.length}` };
    },
    encryptValue(plaintext) { return Buffer.concat([Buffer.from([1, 1]), Buffer.from(String(plaintext))]); },
    activeKeyVersion: 1
  };
}

function fakeStripe(options = {}) {
  const updates = [];
  return {
    updates,
    disputes: {
      async update(id, params, opts) {
        updates.push({ id, params, opts });
        if (options.fail) throw Object.assign(new Error('stripe rejected the submission'), { code: 'dispute_evidence_rejected' });
        return { id: 'du_1', status: 'under_review', evidence_details: { submission_count: 1 } };
      }
    }
  };
}

function fakeStripeFiles() {
  const batches = [];
  return {
    batches,
    async uploadAll(files, opts) {
      batches.push({ files, opts });
      const fieldFileIds = {};
      files.forEach((file, index) => { fieldFileIds[file.field] = `file_${index + 1}`; });
      return { fieldFileIds };
    },
    async upload() { throw new Error('unexpected single upload'); }
  };
}

function fakePayPal() {
  const calls = [];
  return {
    calls,
    async provideEvidence(id, body) {
      calls.push({ id, body });
      return { requestId: 'pp_req_1', links: [] };
    }
  };
}

function okLimits() {
  const calls = { stripe: [], paypal: [] };
  return {
    calls,
    validateStripeEvidence(reason, fieldsObj, files) {
      calls.stripe.push({ reason, fieldsObj, files });
      return { ok: true, violations: [] };
    },
    validatePayPalEvidence(requested, allowed, items) {
      calls.paypal.push({ requested, allowed, items });
      return { ok: true, violations: [] };
    }
  };
}

function seedCase(db, overrides = {}) {
  const row = {
    id: 1, provider: 'stripe', provider_dispute_id: 'dp_1', reason: 'subscription_canceled',
    provider_status: 'needs_response', lifecycle_stage: null, amount_cents: 1999, currency: 'usd',
    due_by: iso(NOW + 5 * 24 * 3600 * 1000), allowed_actions: [], requested_evidence: [],
    transaction_id: null, subscription_id: null, identity_id: null, merchant_account: 'acct_seller_1',
    stripe_dispute_ref: null, case_state: 'ready_for_review', response_cycle: 1, last_event_at: null,
    ...overrides
  };
  db.state.cases.set(row.id, row);
  return row;
}

function seedPacket(db, overrides = {}) {
  const row = {
    id: 11, case_id: 1, version: 3, response_cycle: 1,
    manifest: {
      stripeEvidence: {
        fieldsObj: { product_description: 'Monthly group subscription with member access records' },
        filesPlan: []
      }
    },
    warnings: [], pdf_sha256: 'c1'.repeat(32), pdf_bytes: Buffer.from('%PDF-1.4 test'),
    packet_sha256: PACKET_SHA, generator_version: 'g1', created_at: iso(NOW - 3600_000),
    ...overrides
  };
  db.state.packets.set(row.id, row);
  return row;
}

function makeService(db, overrides = {}) {
  return createDisputeService({
    pool: db.pool,
    store: overrides.store || fakeStore(),
    stripe: overrides.stripe || fakeStripe(),
    stripeFiles: overrides.stripeFiles || fakeStripeFiles(),
    paypalClient: overrides.paypalClient || fakePayPal(),
    limits: overrides.limits || okLimits(),
    engine: overrides.engine,
    packetGenerator: overrides.packetGenerator,
    randomBytes: overrides.randomBytes || crypto.randomBytes,
    now: overrides.now || (() => NOW)
  });
}

function approvalInput(overrides = {}) {
  return {
    caseId: 1, packetId: 11, wpUserId: 7, packetSha256: PACKET_SHA,
    confirmation: {
      confirmed: true,
      checkboxLabel: 'I reviewed this evidence packet and approve its submission.'
    },
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// approveAndSubmit
// ---------------------------------------------------------------------------

test('approveAndSubmit claims, submits to Stripe with the contract idempotency key, and records the result', async () => {
  const db = fakeDb();
  seedCase(db);
  seedPacket(db);
  const store = fakeStore();
  const stripe = fakeStripe();
  const service = makeService(db, { store, stripe });

  const result = await service.approveAndSubmit(approvalInput());

  assert.equal(result.status, 'submitted');
  assert.equal(result.idempotencyKey, 'dispute-submit:1:1:3');
  assert.equal(submissionIdempotencyKey(1, 1, 3), 'dispute-submit:1:1:3');

  assert.equal(stripe.updates.length, 1);
  assert.equal(stripe.updates[0].id, 'dp_1');
  assert.equal(stripe.updates[0].params.submit, true);
  assert.equal(stripe.updates[0].params.evidence.product_description,
    'Monthly group subscription with member access records');
  assert.equal(stripe.updates[0].opts.idempotencyKey, 'dispute-submit:1:1:3');

  assert.equal(db.state.submissions.length, 1);
  assert.equal(db.state.submissions[0].status, 'submitted');
  assert.equal(db.state.submissions[0].provider_request_id, 'du_1');
  assert.equal(db.state.submissions[0].submitted_at, iso(NOW));
  assert.equal(db.state.cases.get(1).case_state, 'submitted');

  const actions = store.audits.map((entry) => entry.fields.action);
  assert.ok(actions.includes('submission_claimed'));
  assert.ok(actions.includes('submission_submitted'));

  const alerts = [...db.state.outbox.values()];
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].source_key, /^dispute-alert:stripe:dp_1:submission_result:1:/);
  assert.equal(alerts[0].payload.noticeType, 'submission_result');
  assert.equal(alerts[0].payload.result, 'submitted');
});

test('two concurrent approvals produce exactly one submission (row lock path)', async () => {
  const db = fakeDb();
  seedCase(db);
  seedPacket(db);
  const stripe = fakeStripe();
  const service = makeService(db, { stripe });

  const outcomes = await Promise.allSettled([
    service.approveAndSubmit(approvalInput()),
    service.approveAndSubmit(approvalInput())
  ]);

  const fulfilled = outcomes.filter((entry) => entry.status === 'fulfilled');
  const rejected = outcomes.filter((entry) => entry.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof TypeError);
  assert.equal(db.state.submissions.length, 1);
  assert.equal(db.state.submissions[0].status, 'submitted');
  assert.equal(stripe.updates.length, 1);
});

test('when both clicks pass re-validation, the partial unique index still makes the second impossible', async () => {
  // locking:false + ignoreCaseStateUpdates simulates the worst interleaving:
  // both claims pass the case_state re-check, so only the partial unique
  // index on (case_id, response_cycle) WHERE status IN ('submitting',
  // 'submitted') stands between the two INSERTs.
  const db = fakeDb({ locking: false, ignoreCaseStateUpdates: true });
  seedCase(db);
  seedPacket(db);
  const service = makeService(db);

  const outcomes = await Promise.allSettled([
    service.approveAndSubmit(approvalInput()),
    service.approveAndSubmit(approvalInput())
  ]);

  const rejected = outcomes.filter((entry) => entry.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof TypeError);
  assert.equal(rejected[0].reason.message, 'submission_already_in_progress');
  assert.equal(db.state.submissions.filter((row) => row.status !== 'failed').length, 1);
});

test('a provider-limit validation failure refuses before claiming anything', async () => {
  const db = fakeDb();
  seedCase(db);
  seedPacket(db);
  const stripe = fakeStripe();
  const limits = {
    validateStripeEvidence: () => ({ ok: false, violations: ['combined text over the 150000 character cap'] }),
    validatePayPalEvidence: () => ({ ok: true, violations: [] })
  };
  const service = makeService(db, { stripe, limits });

  await assert.rejects(
    () => service.approveAndSubmit(approvalInput()),
    (error) => error instanceof TypeError && /provider validation/.test(error.message)
  );
  assert.equal(db.state.submissions.length, 0);
  assert.equal(stripe.updates.length, 0);
  assert.equal(db.calls.some((call) => call.text.includes('FOR UPDATE')), false);
  assert.equal(db.calls.some((call) => call.text.startsWith('INSERT INTO dispute_submissions')), false);
  assert.equal(db.state.cases.get(1).case_state, 'ready_for_review');
});

test('a retry after a failed submission is allowed within the same cycle', async () => {
  const db = fakeDb();
  seedCase(db);
  seedPacket(db);
  db.state.submissions.push({
    id: 900, case_id: 1, packet_id: 11, response_cycle: 1, approved_by_wp_user: 7,
    approved_at: iso(NOW - 7200_000), confirmation: {}, status: 'failed',
    provider_request_id: null, provider_response: { error: 'timeout' }, submitted_at: null,
    created_at: iso(NOW - 7200_000)
  });
  const service = makeService(db);

  const result = await service.approveAndSubmit(approvalInput());
  assert.equal(result.status, 'submitted');
  assert.equal(db.state.submissions.length, 2);
  assert.equal(db.state.submissions[1].status, 'submitted');
});

test('a provider failure marks the submission failed, reopens the case, alerts, and rethrows', async () => {
  const db = fakeDb();
  seedCase(db);
  seedPacket(db);
  const store = fakeStore();
  const service = makeService(db, { store, stripe: fakeStripe({ fail: true }) });

  await assert.rejects(() => service.approveAndSubmit(approvalInput()), /stripe rejected/);

  assert.equal(db.state.submissions.length, 1);
  assert.equal(db.state.submissions[0].status, 'failed');
  assert.equal(db.state.submissions[0].submitted_at, null);
  assert.equal(db.state.submissions[0].provider_response.error, 'dispute_evidence_rejected');
  assert.equal(db.state.cases.get(1).case_state, 'ready_for_review');
  assert.ok(store.audits.some((entry) => entry.fields.action === 'submission_failed'));
  const alert = [...db.state.outbox.values()][0];
  assert.equal(alert.payload.result, 'failed');
});

test('a second response cycle is allowed after an audited escalation bump', async () => {
  const db = fakeDb();
  seedCase(db, { response_cycle: 2, case_state: 'ready_for_review' });
  seedPacket(db, { id: 12, version: 4, response_cycle: 2 });
  db.state.submissions.push({
    id: 901, case_id: 1, packet_id: 11, response_cycle: 1, approved_by_wp_user: 7,
    approved_at: iso(NOW - 30 * 24 * 3600 * 1000), confirmation: {}, status: 'submitted',
    provider_request_id: 'du_0', provider_response: {}, submitted_at: iso(NOW - 30 * 24 * 3600 * 1000),
    created_at: iso(NOW - 30 * 24 * 3600 * 1000)
  });
  const service = makeService(db);

  const result = await service.approveAndSubmit(approvalInput({ packetId: 12 }));
  assert.equal(result.status, 'submitted');
  assert.equal(result.responseCycle, 2);
  assert.equal(result.idempotencyKey, 'dispute-submit:1:2:4');
  assert.equal(db.state.submissions.length, 2);
});

test('a packet built for a different cycle is refused', async () => {
  const db = fakeDb();
  seedCase(db, { response_cycle: 2 });
  seedPacket(db); // cycle 1
  const service = makeService(db);
  await assert.rejects(
    () => service.approveAndSubmit(approvalInput()),
    (error) => error instanceof TypeError && /different response cycle/.test(error.message)
  );
  assert.equal(db.state.submissions.length, 0);
});

test('a packet hash mismatch is refused: the admin must approve the exact packet', async () => {
  const db = fakeDb();
  seedCase(db);
  seedPacket(db);
  const service = makeService(db);
  await assert.rejects(
    () => service.approveAndSubmit(approvalInput({ packetSha256: 'cd'.repeat(32) })),
    (error) => error instanceof TypeError && /does not match/.test(error.message)
  );
  assert.equal(db.state.submissions.length, 0);
});

test('planned files upload to Stripe first and land in the evidence and confirmation', async () => {
  const db = fakeDb();
  seedCase(db);
  seedPacket(db, {
    manifest: {
      stripeEvidence: {
        fieldsObj: { product_description: 'Subscription service records' },
        filesPlan: [{ field: 'cancellation_policy', source: 'packet_pdf', fileName: 'policy.pdf' }]
      }
    }
  });
  const stripe = fakeStripe();
  const stripeFiles = fakeStripeFiles();
  const service = makeService(db, { stripe, stripeFiles });

  await service.approveAndSubmit(approvalInput());

  assert.equal(stripeFiles.batches.length, 1);
  assert.equal(stripeFiles.batches[0].files[0].field, 'cancellation_policy');
  assert.equal(stripeFiles.batches[0].opts.idempotencyKeyBase, 'dispute-submit:1:1:3');
  assert.equal(stripe.updates[0].params.evidence.cancellation_policy, 'file_1');
  assert.deepEqual(db.state.submissions[0].confirmation.stripe_file_ids, { cancellation_policy: 'file_1' });
});

test('a PayPal case validates against requested types and calls provideEvidence', async () => {
  const db = fakeDb();
  seedCase(db, {
    provider: 'paypal', provider_dispute_id: 'PP-D-1', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    requested_evidence: ['PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED'],
    allowed_actions: [{ rel: 'provide_evidence' }]
  });
  seedPacket(db, {
    manifest: {
      paypalEvidence: {
        evidences: [{ evidence_type: 'PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED', notes: 'Access records attached.' }],
        notes: 'Service access records for the disputed period.'
      }
    }
  });
  const paypalClient = fakePayPal();
  const limits = okLimits();
  const service = makeService(db, { paypalClient, limits });

  const result = await service.approveAndSubmit(approvalInput());

  assert.equal(result.status, 'submitted');
  assert.equal(limits.calls.paypal.length, 1);
  assert.deepEqual(limits.calls.paypal[0].requested, ['PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED']);
  assert.equal(paypalClient.calls.length, 1);
  assert.equal(paypalClient.calls[0].id, 'PP-D-1');
  assert.equal(paypalClient.calls[0].body.evidences[0].evidence_type, 'PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED');
});

test('a case that is not ready for review cannot be submitted', async () => {
  const db = fakeDb();
  seedCase(db, { case_state: 'submitted' });
  seedPacket(db);
  const service = makeService(db);
  await assert.rejects(
    () => service.approveAndSubmit(approvalInput()),
    (error) => error instanceof TypeError && /not ready for submission/.test(error.message)
  );
});

// ---------------------------------------------------------------------------
// Review tokens
// ---------------------------------------------------------------------------

test('issueReviewToken stores only the sha256 of the raw token with a 15 minute TTL', async () => {
  const db = fakeDb();
  seedCase(db);
  const store = fakeStore();
  const service = makeService(db, { store });

  const issued = await service.issueReviewToken({ caseId: 1, discordUserId: '123456789012345678' });

  assert.equal(typeof issued.token, 'string');
  assert.ok(issued.token.length >= 40); // 32 random bytes base64url
  assert.equal(issued.expiresAt, iso(NOW + REVIEW_TOKEN_TTL_MS));
  assert.equal(REVIEW_TOKEN_TTL_MS, 15 * 60 * 1000);

  assert.equal(db.state.tokens.has(issued.token), false); // raw never stored
  const stored = db.state.tokens.get(hashReviewToken(issued.token));
  assert.ok(stored);
  assert.equal(stored.case_id, 1);
  assert.ok(store.audits.some((entry) => entry.fields.action === 'review_token_issued'));
});

test('a review token is single-use: two concurrent redeems -> exactly one wins', async () => {
  const db = fakeDb();
  seedCase(db);
  const service = makeService(db);
  const issued = await service.issueReviewToken({ caseId: 1, discordUserId: '123456789012345678' });

  const outcomes = await Promise.allSettled([
    service.redeemReviewToken({ token: issued.token, wpUserId: 7 }),
    service.redeemReviewToken({ token: issued.token, wpUserId: 8 })
  ]);

  const fulfilled = outcomes.filter((entry) => entry.status === 'fulfilled');
  const rejected = outcomes.filter((entry) => entry.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof TypeError);
  assert.match(rejected[0].reason.message, /invalid, expired, or already used/);
  assert.equal(fulfilled[0].value.case.caseId, 1);
  assert.equal(fulfilled[0].value.case.providerDisputeId, 'dp_1');
});

test('an expired review token is refused', async () => {
  const db = fakeDb();
  seedCase(db);
  const issuer = makeService(db);
  const issued = await issuer.issueReviewToken({ caseId: 1, discordUserId: '123456789012345678' });

  const later = makeService(db, { now: () => NOW + REVIEW_TOKEN_TTL_MS + 1000 });
  await assert.rejects(
    () => later.redeemReviewToken({ token: issued.token, wpUserId: 7 }),
    (error) => error instanceof TypeError && /invalid, expired, or already used/.test(error.message)
  );
  const stored = db.state.tokens.get(hashReviewToken(issued.token));
  assert.equal(stored.used_at, null);
});

test('a garbage token is refused without touching case data', async () => {
  const db = fakeDb();
  seedCase(db);
  const service = makeService(db);
  await assert.rejects(
    () => service.redeemReviewToken({ token: 'not-a-real-token', wpUserId: 7 }),
    TypeError
  );
});

// ---------------------------------------------------------------------------
// Packet building and records
// ---------------------------------------------------------------------------

test('buildPacket versions the packet, moves the case to ready_for_review, and audits', async () => {
  const db = fakeDb();
  seedCase(db, { case_state: 'evidence_building' });
  seedPacket(db, { id: 50, version: 2, packet_sha256: 'ee'.repeat(32) });
  const store = fakeStore();
  const engine = {
    buildPacketModel(args) {
      assert.equal(args.now, NOW);
      assert.equal(args.caseRow.id, 1);
      return { warnings: [{ code: 'origin_not_provable' }], checklist: [], assertions: [], timeline: [] };
    }
  };
  const packetGenerator = {
    generatePacket({ model, version, generatedAt }) {
      assert.equal(version, 3);
      assert.equal(generatedAt, iso(NOW));
      return {
        manifest: { assertions: [], warnings: model.warnings },
        pdfBuffer: Buffer.from('%PDF-1.4 generated'),
        pdfSha256: 'dd'.repeat(32), manifestSha256: 'cc'.repeat(32),
        packetSha256: 'ff'.repeat(32), generatorVersion: 'evidence-1'
      };
    }
  };
  const service = makeService(db, { store, engine, packetGenerator });

  const result = await service.buildPacket({ caseId: 1, wpUserId: 7 });

  assert.equal(result.version, 3);
  assert.equal(result.packetSha256, 'ff'.repeat(32));
  assert.deepEqual(result.warnings, [{ code: 'origin_not_provable' }]);
  const inserted = db.state.packets.get(result.packetId);
  assert.equal(inserted.version, 3);
  assert.equal(inserted.response_cycle, 1);
  assert.equal(db.state.cases.get(1).case_state, 'ready_for_review');
  assert.ok(store.audits.some((entry) => entry.fields.action === 'packet_built'));
});

test('recordPolicy refuses suspend_access without a disclosed policy', async () => {
  const db = fakeDb();
  const service = makeService(db);
  await assert.rejects(
    () => service.recordPolicy({ merchantScope: 'acct_seller_1', onDispute: 'suspend_access', wpUserId: 7 }),
    (error) => error instanceof TypeError && /disclosed/.test(error.message)
  );
  const ok = await service.recordPolicy({
    merchantScope: 'acct_seller_1', onDispute: 'suspend_access', wpUserId: 7,
    disclosedAt: iso(NOW - 1000), policyTermsVersionId: 4
  });
  assert.equal(ok.onDispute, 'suspend_access');
  assert.equal(db.state.policies.get('acct_seller_1').on_dispute, 'suspend_access');
});

test('recordConsent stores the purchase IP encrypted only and never in the audit trail', async () => {
  const db = fakeDb();
  const store = fakeStore();
  const service = makeService(db, { store });

  const result = await service.recordConsent({
    identityId: 5, termsVersionId: 2,
    controlLabel: 'Start subscription — $19.99/month, renews monthly until canceled',
    acceptedAt: iso(NOW - 1000), purchaseIp: '203.0.113.9', source: 'stripe'
  });

  assert.ok(result.consentId >= 1);
  const appended = store.appendedRows[0];
  assert.equal(appended.table, 'customer_consents');
  assert.ok(Buffer.isBuffer(appended.fields.purchase_ip_enc));
  assert.equal(appended.fields.key_version, 1);
  const auditJson = JSON.stringify(store.audits);
  assert.equal(auditJson.includes('203.0.113.9'), false);
});

test('validation failures are TypeErrors so the handler maps them to 400', async () => {
  const db = fakeDb();
  const service = makeService(db);
  await assert.rejects(() => service.caseDetail({ caseId: 'nope' }), TypeError);
  await assert.rejects(() => service.approveAndSubmit(approvalInput({ packetSha256: 'short' })), TypeError);
  await assert.rejects(() => service.approveAndSubmit(approvalInput({ confirmation: { confirmed: false, checkboxLabel: 'x' } })), TypeError);
  await assert.rejects(() => service.issueReviewToken({ caseId: 1, discordUserId: 'abc' }), TypeError);
  await assert.rejects(() => service.recordTermsVersion({ versionLabel: 'v1', content: '', effectiveFrom: iso(NOW), wpUserId: 7, docKind: 'terms' }), TypeError);
});

// ---------------------------------------------------------------------------
// Neutral language (DESIGN.md §3): no template or string in this package may
// characterize a customer or assert bad intent.
// ---------------------------------------------------------------------------

test('no accusatory or characterizing strings exist anywhere in the package source', () => {
  const forbidden = /(lying|\bliar\b|scammer|dishonest|deadbeat|fraudster|fraudulent\s+customer|customer\s+is\s+(?:lying|fraudulent)|bad\s+faith|thief|steal)/i;
  for (const name of ['dispute-service.js', 'stripe-files.js']) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
    assert.equal(forbidden.test(source), false, `${name} must stay neutral and factual`);
  }
});
