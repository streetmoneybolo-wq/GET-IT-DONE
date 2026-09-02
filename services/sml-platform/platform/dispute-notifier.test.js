'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDisputeNotifier, createDiscordDmClient, noticeTypeFor, renderMessage } = require('./dispute-notifier');

const NOW = 1_756_900_000_000;
const PII = { email: 'buyer@example.com', name: 'Pat Example' };

function caseRow(overrides = {}) {
  return {
    id: 12, provider: 'stripe', provider_dispute_id: 'dp_12', reason: 'subscription_canceled',
    provider_status: 'needs_response', lifecycle_stage: null, amount_cents: 1999, currency: 'usd',
    due_by: new Date(NOW + 3 * 86_400_000).toISOString(), case_state: 'open', merchant_account: 'acct_seller',
    ...overrides
  };
}

function fakeDb(rows) {
  const deliveries = [];
  const audits = [];
  function client() {
    return {
      async query(text, values = []) {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.startsWith('SELECT * FROM dispute_cases WHERE id')) {
          const row = rows.find((r) => Number(r.id) === Number(values[0]));
          return { rows: row ? [row] : [] };
        }
        if (sql.startsWith('SELECT id FROM notification_delivery_events')) {
          const hit = deliveries.find((d) => d.source_event_id === values[0] && d.delivery_status === 'sent');
          return { rows: hit ? [{ id: 1 }] : [] };
        }
        throw new Error(`unexpected SQL ${sql.slice(0, 50)}`);
      },
      release() {}
    };
  }
  const store = {
    async appendRow(_c, { table, fields }) { assert.equal(table, 'notification_delivery_events'); deliveries.push(fields); return { id: deliveries.length }; },
    async appendChained(_c, { table, fields }) { assert.equal(table, 'dispute_audit_log'); audits.push(fields); return { id: audits.length }; }
  };
  return { deliveries, audits, store, pool: { async connect() { return client(); }, async query(t, v) { return client().query(t, v); } } };
}

function fakeGraph(admins) {
  return { async resolveMerchantAdmins(_pool, scope) { return admins.filter((a) => a.scope === scope); } };
}

function fakeDm(script = {}) {
  const sent = [];
  return {
    sent,
    async send(userId, content) {
      sent.push({ userId, content });
      const outcome = script[userId];
      if (outcome === 'closed') return { ok: false, code: 50007, retryable: false };
      if (outcome === 'ratelimit') return { ok: false, code: 429, retryable: true };
      return { ok: true, messageId: `m_${sent.length}` };
    }
  };
}

const admins = [
  { identityId: 1, wordpress_user_id: 7, discord_user_id: '100000000000000001', scope: 'acct_seller' },
  { identityId: 2, wordpress_user_id: 8, discord_user_id: '100000000000000002', scope: 'acct_seller' },
  { identityId: 3, wordpress_user_id: 9, discord_user_id: '100000000000000003', scope: 'platform' }
];

test('notice types follow the intent and the case outcome', () => {
  assert.equal(noticeTypeFor('dispute_deadline', {}, caseRow()), 'deadline_warning');
  assert.equal(noticeTypeFor('dispute_alert', { noticeType: 'submission_result' }, caseRow()), 'submission_result');
  assert.equal(noticeTypeFor('dispute_alert', {}, caseRow({ case_state: 'won' })), 'final_outcome');
  assert.equal(noticeTypeFor('dispute_alert', {}, caseRow()), 'dispute_alert');
});

test('messages carry only case id, provider, reason token, amount, deadline, and state — never customer data', () => {
  const text = renderMessage('dispute_alert', {}, caseRow({ reason: `${PII.email} ${PII.name}` }));
  assert.doesNotMatch(text, /example\.com|Pat/);
  assert.match(text, /case #12/);
  assert.match(text, /19\.99 USD/);
  assert.match(text, /reason unknown/);
});

test('each merchant admin of the case scope gets one DM, WordPress gets one bridge intent, and deliveries are recorded', async () => {
  const db = fakeDb([caseRow()]);
  const dm = fakeDm();
  const wp = [];
  const notifier = createDisputeNotifier({
    pool: db.pool, store: db.store, graph: fakeGraph(admins), dm,
    wordpress: async (payload, row) => { wp.push({ payload, row }); }, now: () => NOW
  });
  const result = await notifier.disputeAlert({ caseId: 12 }, { source_key: 'dispute-alert:stripe:dp_12:needs_response' });
  assert.deepEqual({ sent: result.sent, skipped: result.skipped, failed: result.failed }, { sent: 2, skipped: 0, failed: 0 });
  assert.deepEqual(dm.sent.map((s) => s.userId), ['100000000000000001', '100000000000000002']);
  assert.equal(db.deliveries.length, 2);
  assert.equal(db.deliveries[0].channel, 'discord_dm');
  assert.equal(db.deliveries[0].delivery_status, 'sent');
  assert.equal(db.deliveries[0].source_event_id, 'dispute-alert:stripe:dp_12:needs_response:discord:100000000000000001');
  assert.equal(wp.length, 1);
  assert.equal(wp[0].row.intent_type, 'dispute_notify');
  assert.equal(wp[0].row.source_key, 'dispute-alert:stripe:dp_12:needs_response:wp');
  assert.equal(wp[0].payload.noticeType, 'dispute_alert');
  assert.equal(JSON.stringify(wp[0].payload).includes('@'), false);
});

test('a WordPress bridge failure rethrows for the outbox retry, and the retry never re-sends delivered DMs', async () => {
  const db = fakeDb([caseRow()]);
  const dm = fakeDm();
  let wpCalls = 0;
  const notifier = createDisputeNotifier({
    pool: db.pool, store: db.store, graph: fakeGraph(admins), dm,
    wordpress: async () => { wpCalls += 1; if (wpCalls === 1) throw new Error('WordPress billing bridge returned 503'); }, now: () => NOW
  });
  const row = { source_key: 'dispute-alert:stripe:dp_12:needs_response' };
  await assert.rejects(notifier.disputeAlert({ caseId: 12 }, row), /503/);
  assert.equal(dm.sent.length, 2);
  const retry = await notifier.disputeAlert({ caseId: 12 }, row);
  assert.equal(dm.sent.length, 2, 'no duplicate DMs on retry');
  assert.equal(retry.skipped, 2);
  assert.equal(wpCalls, 2);
});

test('a closed-DM admin is recorded as failed and does not block the others; a rate limit throws so the outbox retries', async () => {
  const db = fakeDb([caseRow()]);
  const dm = fakeDm({ '100000000000000001': 'closed' });
  const notifier = createDisputeNotifier({ pool: db.pool, store: db.store, graph: fakeGraph(admins), dm, now: () => NOW });
  const result = await notifier.disputeDeadline({ caseId: 12, bucket: '24h' }, { source_key: 'dispute-deadline:stripe:dp_12:24h' });
  assert.deepEqual({ sent: result.sent, failed: result.failed }, { sent: 1, failed: 1 });
  assert.equal(db.deliveries[0].delivery_status, 'failed');
  assert.equal(db.deliveries[0].provenance.discord_code, 50007);
  assert.equal(db.deliveries[0].notice_type, 'deadline_warning');

  const limited = createDisputeNotifier({ pool: fakeDb([caseRow()]).pool, store: db.store, graph: fakeGraph(admins), dm: fakeDm({ '100000000000000001': 'ratelimit' }), now: () => NOW });
  await assert.rejects(limited.disputeAlert({ caseId: 12 }, { source_key: 'k' }), /temporarily unavailable/);
});

test('a scope with no verified admins is audited instead of silently dropped', async () => {
  const db = fakeDb([caseRow({ merchant_account: null })]);
  const notifier = createDisputeNotifier({ pool: db.pool, store: db.store, graph: fakeGraph([]), dm: fakeDm(), now: () => NOW });
  await notifier.disputeAlert({ caseId: 12 }, { source_key: 'k2' });
  assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0].action, 'alert_no_recipients');
  assert.equal(db.audits[0].detail.merchant_scope, 'platform');
});

test('the DM client opens a DM channel, sends with mentions disabled, and maps Discord errors', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/users/@me/channels')) return { status: 200, async json() { return { id: 'dm_1' }; } };
    if (url.endsWith('/channels/dm_1/messages')) return { status: 403, async json() { return { code: 50007 }; } };
    return { status: 500, async json() { return {}; } };
  };
  const client = createDiscordDmClient({ token: 'bot-token', fetchImpl });
  const result = await client.send('100000000000000009', 'hello');
  assert.deepEqual(result, { ok: false, code: 50007, retryable: false });
  assert.equal(calls[0].options.headers.authorization, 'Bot bot-token');
  assert.equal(JSON.parse(calls[1].options.body).allowed_mentions.parse.length, 0);
  assert.equal(createDiscordDmClient({ token: '' }), null);
});
