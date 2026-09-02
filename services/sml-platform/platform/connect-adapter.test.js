'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_RECONCILE_ROWS,
  createConnectAuthorizer,
  createConnectDisputeService,
  createConnectRoleHandlers,
  createConnectRoleTools,
  toSnakeCase
} = require('./connect-adapter');

const NOW = 1_756_900_000_000;
const GUILD = '938894329076940820';
const USER = '1051212765475377172';

function fakePool(handlers) {
  const queries = [];
  const pool = {
    async query(text, values = []) {
      const sql = String(text).replace(/\s+/g, ' ').trim();
      queries.push({ sql, values });
      for (const [prefix, handler] of handlers) {
        if (sql.startsWith(prefix)) return handler(values, sql);
      }
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      throw new Error(`unexpected SQL ${sql.slice(0, 60)}`);
    },
    async connect() { return { query: pool.query, release() {} }; }
  };
  return { pool, queries };
}

const store = {
  decryptValue(buf) {
    const text = buf.toString('utf8');
    if (text === 'garbage') throw new Error('bad blob');
    return text;
  },
  async appendChained() { return { id: 1 }; }
};

/* ---------------------------------------------------------------------------
 * Authorization
 * ------------------------------------------------------------------------- */

test('an identity without a verified merchant ref is refused', async () => {
  const { pool } = fakePool([['SELECT ref_value_enc FROM billing_identity_refs', () => ({ rows: [] })]]);
  const authorize = createConnectAuthorizer({ pool, store });
  assert.deepEqual(await authorize({ identityId: 5, guildId: GUILD }), { ok: false });
  assert.deepEqual(await authorize({ identityId: 'x' }), { ok: false });
});

test('the guild-linked seller scope wins when the admin holds it; otherwise platform, otherwise the first scope', async () => {
  const refs = [Buffer.from('acct_b'), Buffer.from('acct_a'), Buffer.from('garbage')];
  let linked = 'acct_b';
  const { pool } = fakePool([
    ['SELECT ref_value_enc FROM billing_identity_refs', () => ({ rows: refs.map((r) => ({ ref_value_enc: r })) })],
    ['SELECT s.connected_account_id FROM discord_guild_links g', () => ({ rows: linked ? [{ connected_account_id: linked }] : [] })]
  ]);
  const authorize = createConnectAuthorizer({ pool, store });
  assert.deepEqual(await authorize({ identityId: 5, guildId: GUILD }), { ok: true, merchantScope: 'acct_b' });
  linked = 'acct_other';
  assert.deepEqual(await authorize({ identityId: 5, guildId: GUILD }), { ok: true, merchantScope: 'acct_a' });
  refs.push(Buffer.from('platform'));
  assert.deepEqual(await authorize({ identityId: 5, guildId: GUILD }), { ok: true, merchantScope: 'platform' });
});

/* ---------------------------------------------------------------------------
 * Dispute service reshaping
 * ------------------------------------------------------------------------- */

test('the adapter reshapes camelCase summaries into the snake_case rows the renderers whitelist and forwards the actor', async () => {
  const calls = [];
  const service = {
    async listCases(input) { calls.push(['list', input]); return { cases: [{ caseId: 3, provider: 'stripe', reason: 'fraudulent', amountCents: 500, currency: 'usd', dueBy: 'd', caseState: 'open', responseCycle: 1 }] }; },
    async caseDetail(input) { calls.push(['detail', input]); return { case: { caseId: 3, provider: 'stripe' }, checklist: [{ kind: 'receipt', state: 'missing' }] }; },
    async buildPacket(input) { calls.push(['build', input]); return { version: 2, warnings: [] }; },
    async issueReviewToken(input) { calls.push(['token', input]); return { token: 'raw token', expiresAt: 'x' }; }
  };
  const adapter = createConnectDisputeService({ disputeService: service, reviewUrlBase: 'https://stockmarketloop.com/connect-review/' });
  const rows = await adapter.listCases({ merchantScope: 'acct_1' });
  assert.deepEqual(rows[0], toSnakeCase({ caseId: 3, provider: 'stripe', reason: 'fraudulent', amountCents: 500, currency: 'usd', dueBy: 'd', caseState: 'open', responseCycle: 1 }));
  assert.equal(rows[0].amount_cents, 500);
  assert.deepEqual(calls[0][1], { merchantScope: 'acct_1', limit: 50 });
  const detail = await adapter.caseDetail({ caseId: 3, merchantScope: 'acct_1' });
  assert.equal(detail.caseRow.id, 3);
  assert.equal(detail.checklist[0].kind, 'receipt');
  await adapter.buildPacket({ caseId: 3, merchantScope: 'acct_1', requestedByDiscordUser: USER });
  assert.deepEqual(calls[2][1], { caseId: 3, merchantScope: 'acct_1', discordUserId: USER });
  const issued = await adapter.issueReviewToken({ caseId: 3, discordUserId: USER });
  assert.equal(issued.url, 'https://stockmarketloop.com/connect-review/?t=raw%20token');
  assert.deepEqual(await adapter.summarizePayments({}), []);
  assert.deepEqual(await adapter.customerHistory({}), {});
});

/* ---------------------------------------------------------------------------
 * Role tools reuse the existing reconcile pipeline
 * ------------------------------------------------------------------------- */

test('role tools enqueue outbox intents with a per-minute source key and report duplicates', async () => {
  const inserted = new Set();
  const { pool, queries } = fakePool([
    ['INSERT INTO billing_outbox', (values) => { const dup = inserted.has(values[0]); inserted.add(values[0]); return { rowCount: dup ? 0 : 1, rows: [] }; }]
  ]);
  const tools = createConnectRoleTools({ pool, now: () => NOW });
  const first = await tools.enqueueRoleReconcile({ guildId: GUILD, merchantScope: 'acct_1', requestedByDiscordUser: USER });
  const second = await tools.enqueueRoleReconcile({ guildId: GUILD, merchantScope: 'acct_1', requestedByDiscordUser: USER });
  assert.equal(first.queued, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(queries[0].values[1], 'connect_role_reconcile');
  assert.match(queries[0].values[0], /^connect-role-reconcile:938894329076940820:1051212765475377172:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  await assert.rejects(tools.enqueueRoleStatus({ guildId: 'nope', requestedByDiscordUser: USER }), TypeError);
});

test('reconcile handler enqueues bounded subscription_access_reconcile rows keyed per day and audits; unlinked guilds only notify', async () => {
  const subs = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, stripe_subscription_id: `sub_${i + 1}` }));
  const outbox = [];
  const audits = [];
  const dms = [];
  const { pool, queries } = fakePool([
    ['SELECT group_id FROM discord_guild_links', (values) => ({ rows: values[0] === GUILD ? [{ group_id: 9 }] : [] })],
    ['SELECT id, stripe_subscription_id FROM subscriptions', (values) => { assert.equal(values[2], MAX_RECONCILE_ROWS); return { rows: subs }; }],
    ['INSERT INTO billing_outbox', (values) => { if (outbox.includes(values[0])) return { rowCount: 0 }; outbox.push(values[0]); return { rowCount: 1 }; }]
  ]);
  const auditStore = { async appendChained(_c, { scopeKey, fields }) { audits.push({ scopeKey, fields }); return { id: audits.length }; } };
  const handlers = createConnectRoleHandlers({ pool, store: auditStore, dm: { async send(u, c) { dms.push({ u, c }); return { ok: true }; } }, now: () => NOW });
  const result = await handlers.connect_role_reconcile({ guildId: GUILD, merchantScope: 'acct_1', requestedByDiscordUser: USER });
  assert.deepEqual(result, { linked: true, queued: 5, candidates: 5 });
  assert.match(outbox[0], /^connect-reconcile:938894329076940820:1:\d{4}-\d{2}-\d{2}$/);
  const insert = queries.find((q) => q.sql.startsWith('INSERT INTO billing_outbox'));
  assert.match(insert.sql, /'subscription_access_reconcile'/);
  assert.equal(JSON.parse(insert.values[1]).reason, 'connect_role_reconcile');
  assert.equal(audits[0].scopeKey, 0);
  assert.equal(audits[0].fields.action, 'role_reconcile_queued');
  assert.equal(audits[0].fields.actor_kind, 'discord_user');
  assert.equal(dms.length, 1);
  assert.match(dms[0].c, /5 of 5/);

  const unlinked = await handlers.connect_role_reconcile({ guildId: '100000000000000000', merchantScope: null, requestedByDiscordUser: USER });
  assert.deepEqual(unlinked, { linked: false, queued: 0 });
  assert.equal(outbox.length, 5, 'nothing enqueued for an unlinked guild');
});

test('status handler reports counts only and never issues a role write', async () => {
  const { pool, queries } = fakePool([
    ['SELECT group_id FROM discord_guild_links', () => ({ rows: [{ group_id: 9 }] })],
    ['SELECT status, COUNT(*)::int AS n FROM subscriptions', () => ({ rows: [{ status: 'active', n: 3 }, { status: 'canceled', n: 1 }] })],
    ['SELECT g.state, COUNT(*)::int AS n FROM role_grants g', () => ({ rows: [{ state: 'granted', n: 3 }] })],
    ['SELECT COUNT(*)::int AS n FROM billing_outbox', () => ({ rows: [{ n: 0 }] })]
  ]);
  const dms = [];
  const handlers = createConnectRoleHandlers({ pool, store, dm: { async send(u, c) { dms.push(c); return { ok: true }; } }, now: () => NOW });
  const result = await handlers.connect_role_status({ guildId: GUILD, merchantScope: 'acct_1', requestedByDiscordUser: USER });
  assert.equal(result.linked, true);
  assert.equal(result.reconcile_queue, 0);
  assert.match(dms[0], /active 3, canceled 1/);
  assert.equal(queries.some((q) => /^(UPDATE|DELETE)/.test(q.sql)), false);
});
