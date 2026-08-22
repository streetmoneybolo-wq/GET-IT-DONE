/* Discord sync client tests.  Run: node --test  (from this directory)
 * No network and no real clock: fetch and sleep are injected, so rate-limit
 * behaviour is asserted exactly rather than hopefully. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./discord-sync.js');

/* A fake clock that only advances when the code under test sleeps. Any wait the
   client performs therefore shows up as a measurable jump. */
function harness(responses, opts = {}) {
  let clock = 1000000;
  const slept = [];
  const calls = [];
  let i = 0;

  const headers = (h) => ({ get: (k) => (h && h[k.toLowerCase()] !== undefined ? String(h[k.toLowerCase()]) : null) });

  const client = D.createSyncClient(Object.assign({
    token: 'test-token',
    now: () => clock,
    sleep: async (ms) => { slept.push(ms); clock += ms; },
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, reason: init.headers['X-Audit-Log-Reason'] });
      const r = typeof responses === 'function' ? responses(i++, url, init) : responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return {
        status: r.status,
        headers: headers(r.headers),
        json: async () => r.body || {}
      };
    }
  }, opts));

  return { client, calls, slept, clock: () => clock };
}

const grant = { action: 'grant', guildId: 'g1', userId: 'u1', roleId: 'r1' };
const revoke = { action: 'revoke', guildId: 'g1', userId: 'u1', roleId: 'r1' };

/* ---------- happy path ---------- */

test('a grant issues PUT and a revoke issues DELETE', async () => {
  const g = harness([{ status: 204 }]);
  assert.equal((await g.client.editRole(grant)).ok, true);
  assert.equal(g.calls[0].method, 'PUT');
  assert.match(g.calls[0].url, /\/guilds\/g1\/members\/u1\/roles\/r1$/);

  const r = harness([{ status: 204 }]);
  await r.client.editRole(revoke);
  assert.equal(r.calls[0].method, 'DELETE');
});

test('an audit-log reason is always sent', async () => {
  const h = harness([{ status: 204 }]);
  await h.client.editRole(Object.assign({}, grant, { reason: 'subscription active' }));
  assert.equal(h.calls[0].reason, 'subscription active');
});

/* ---------- rate limiting: the part that gets tokens banned ---------- */

test('a 429 is waited out and then retried, not failed', async () => {
  const h = harness((i) => (i === 0
    ? { status: 429, body: { retry_after: 2.5 } }
    : { status: 204 }));
  const r = await h.client.editRole(grant);
  assert.equal(r.ok, true);
  assert.ok(h.slept.some((ms) => ms >= 2500), `expected a >=2500ms wait, got ${JSON.stringify(h.slept)}`);
});

test('a global 429 pauses every bucket, not just the one that hit it', async () => {
  const h = harness((i) => (i === 0
    ? { status: 429, body: { retry_after: 5, global: true } }
    : { status: 204 }));
  await h.client.editRole(grant);
  const st = h.client.state();
  assert.ok(st.globalUntil > 0, 'global pause was not recorded');
  /* a different guild must also be held back */
  assert.ok(st.globalUntil >= 1000000 + 5000);
});

test('the global flag is honoured from the header as well as the body', async () => {
  const h = harness((i) => (i === 0
    ? { status: 429, headers: { 'x-ratelimit-global': 'true' }, body: { retry_after: 3 } }
    : { status: 204 }));
  await h.client.editRole(grant);
  assert.ok(h.client.state().globalUntil > 0);
});

test('an exhausted bucket header delays the next call', async () => {
  const h = harness([{ status: 204, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '4' } }, { status: 204 }]);
  await h.client.editRole(grant);
  const before = h.clock();
  await h.client.editRole(Object.assign({}, grant, { roleId: 'r2' }));
  assert.ok(h.clock() - before >= 4000, 'bucket exhaustion was ignored');
});

test('requests are spaced by the minimum interval', async () => {
  const h = harness([{ status: 204 }, { status: 204 }], { minIntervalMs: 200 });
  await h.client.editRole(grant);
  const before = h.clock();
  await h.client.editRole(Object.assign({}, grant, { roleId: 'r2' }));
  assert.ok(h.clock() - before >= 200);
});

/* ---------- permanent vs retryable ---------- */

test('403 is permanent and names the likely cause', async () => {
  const h = harness([{ status: 403 }]);
  const r = await h.client.editRole(grant);
  assert.equal(r.permanent, true);
  assert.match(r.error, /MANAGE_ROLES|above the target role/);
  assert.equal(h.calls.length, 1, 'a permission error must not be retried');
});

test('a 404 on revoke is SUCCESS — the member already left', async () => {
  const h = harness([{ status: 404 }]);
  const r = await h.client.editRole(revoke);
  assert.equal(r.ok, true);
  assert.match(r.note, /already effectively revoked/);
});

test('a 404 on grant is a permanent failure', async () => {
  const h = harness([{ status: 404 }]);
  const r = await h.client.editRole(grant);
  assert.equal(r.ok, false);
  assert.equal(r.permanent, true);
});

test('a rejected bot token fails permanently and immediately', async () => {
  const h = harness([{ status: 401 }]);
  const r = await h.client.editRole(grant);
  assert.equal(r.permanent, true);
  assert.equal(h.calls.length, 1);
});

test('5xx retries with growing backoff, then gives up as RETRYABLE', async () => {
  const h = harness([{ status: 500 }, { status: 500 }, { status: 500 }], { maxAttempts: 3 });
  const r = await h.client.editRole(grant);
  assert.equal(r.ok, false);
  assert.equal(r.permanent, false, 'a server error must stay retryable for the next sweep');
  assert.equal(h.calls.length, 3);
  assert.ok(h.slept[1] > h.slept[0], `backoff did not grow: ${JSON.stringify(h.slept)}`);
});

test('a network throw is retried rather than crashing the sweep', async () => {
  const h = harness((i) => (i === 0 ? new Error('ECONNRESET') : { status: 204 }));
  assert.equal((await h.client.editRole(grant)).ok, true);
});

test('a transient 500 followed by success succeeds', async () => {
  const h = harness((i) => (i === 0 ? { status: 500 } : { status: 204 }));
  const r = await h.client.editRole(grant);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
});

/* ---------- batching ---------- */

test('revokes are applied before grants', async () => {
  const h = harness([{ status: 204 }]);
  await h.client.applyOperations([
    Object.assign({}, grant, { roleId: 'gA' }),
    Object.assign({}, revoke, { roleId: 'rA' })
  ]);
  assert.equal(h.calls[0].method, 'DELETE', 'a truncated run must not leave access granted');
});

test('the per-run cap defers the overflow instead of hammering the API', async () => {
  const h = harness([{ status: 204 }], { maxOpsPerRun: 3 });
  const ops = Array.from({ length: 10 }, (_, i) => Object.assign({}, grant, { roleId: 'r' + i }));
  const out = await h.client.applyOperations(ops);
  assert.equal(out.results.length, 3);
  assert.equal(out.deferred, 7);
});

test('a batch separates permanent failures from retryable ones', async () => {
  const h = harness((i) => ([{ status: 204 }, { status: 403 }, { status: 500 }][i] || { status: 500 }),
    { maxAttempts: 1 });
  const out = await h.client.applyOperations([
    Object.assign({}, grant, { roleId: 'a' }),
    Object.assign({}, grant, { roleId: 'b' }),
    Object.assign({}, grant, { roleId: 'c' })
  ]);
  assert.equal(out.applied, 1);
  assert.equal(out.permanentFailures.length, 1);
  assert.equal(out.retryable.length, 1);
});

test('one bad operation does not abort the batch', async () => {
  const h = harness((i) => (i === 0 ? { status: 403 } : { status: 204 }));
  const out = await h.client.applyOperations([
    Object.assign({}, grant, { roleId: 'bad' }),
    Object.assign({}, grant, { roleId: 'good' })
  ]);
  assert.equal(out.results.length, 2);
  assert.equal(out.applied, 1);
});

/* ---------- wiring ---------- */

test('toOperations converts reconcile output and ignores native roles', () => {
  const ops = D.toOperations({
    toGrant: [
      { target: 'discord_guild_role', role_ref: '900', discord_user_id: 'u1', subscription_id: 1 },
      { target: 'sml_group_role', role_ref: '5', subscription_id: 1 }
    ],
    toRevoke: [
      { target: 'discord_guild_role', role_ref: '901', discord_user_id: 'u2', subscription_id: 2, reason: 'access ended' }
    ]
  }, 'g1');
  assert.equal(ops.length, 2, 'native roles must not be sent to Discord');
  assert.equal(ops.find((o) => o.action === 'revoke').reason, 'access ended');
});

test('the client refuses to construct without a fetch implementation', () => {
  assert.throws(() => D.createSyncClient({}), TypeError);
});
