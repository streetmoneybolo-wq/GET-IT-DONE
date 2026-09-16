/* Corporate projection push.  Run: node --test  (services/sml-platform/platform) */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const P = require('./corporate-projection.js');

const NOW = Date.parse('2026-09-15T12:00:00Z');
const now = () => NOW;
const SECRET = 'bridge-secret';
const URL_ = 'https://stockmarketloop.com/wp-json/sml-corporate/v1/projection';

const rows = [
  { wpUserId: 258457002, handle: 'CNN', name: 'CNN', category: 'news' },
  { wpUserId: 258457001, handle: 'bloomberg', name: 'Bloomberg', category: 'finance' }
];

function capture(response = { ok: true, status: 200 }) {
  const seen = [];
  return { seen, fetchImpl: async (url, opts) => { seen.push({ url, opts }); return response; } };
}

/* ------------------------------------------------------------ build shape */

test('the projection carries only what WordPress needs', () => {
  const p = P.buildProjection(rows, { now });
  assert.deepEqual(Object.keys(p.accounts[0]).sort(),
    ['active', 'badge', 'category', 'handle', 'name', 'wpUserId']);
  /* No billing, spend or verification detail — every extra field is one that
   * can leak from a slower-moving surface. */
  assert.equal(JSON.stringify(p).includes('cents'), false);
});

test('accounts are ordered deterministically and handles lowercased', () => {
  const p = P.buildProjection(rows, { now });
  assert.deepEqual(p.accounts.map((a) => a.wpUserId), [258457001, 258457002]);
  assert.equal(p.accounts[1].handle, 'cnn');
});

test('count and the empty flag describe the list honestly', () => {
  assert.equal(P.buildProjection(rows, { now }).count, 2);
  assert.equal(P.buildProjection(rows, { now }).empty, false);
  const none = P.buildProjection([], { now });
  assert.equal(none.count, 0);
  assert.equal(none.empty, true, 'zero must assert it MEANT zero');
});

test('rows without a user id are dropped, not projected as null', () => {
  const p = P.buildProjection([...rows, { handle: 'ghost' }, null], { now });
  assert.equal(p.count, 2);
});

/* ---------------------------------------------------------------- digest */

test('the digest ignores key order', () => {
  const a = P.buildProjection(rows, { now });
  const reordered = {
    ...a,
    accounts: a.accounts.map((x) => ({
      active: x.active, badge: x.badge, wpUserId: x.wpUserId,
      name: x.name, category: x.category, handle: x.handle
    }))
  };
  assert.equal(P.projectionDigest(a), P.projectionDigest(reordered));
});

test('the digest ignores generatedAt but tracks content', () => {
  const a = P.buildProjection(rows, { now });
  const later = P.buildProjection(rows, { now: () => NOW + 86400000 });
  assert.equal(P.projectionDigest(a), P.projectionDigest(later),
    'a clock tick is not a content change');

  const changed = P.buildProjection([...rows, {
    wpUserId: 258457003, handle: 'reuters', name: 'Reuters', category: 'news'
  }], { now });
  assert.notEqual(P.projectionDigest(a), P.projectionDigest(changed));
});

/* -------------------------------------------------------------- publisher */

test('an unconfigured publisher is null, not a throwing stub', () => {
  assert.equal(P.createProjectionPublisher({ secret: SECRET }), null);
  assert.equal(P.createProjectionPublisher({ url: URL_ }), null);
  assert.equal(P.createProjectionPublisher({}), null);
  assert.ok(P.createProjectionPublisher({ url: URL_, secret: SECRET }));
});

test('the signature matches what the WordPress receiver computes', async () => {
  /* WP does hash_hmac('sha256', $timestamp . '.' . $body, $secret) and compares
   * lowercase hex. If this ever diverges, every sync 401s silently. */
  const cap = capture();
  const pub = P.createProjectionPublisher({ url: URL_, secret: SECRET, fetchImpl: cap.fetchImpl, now });
  await pub.publish(P.buildProjection(rows, { now }));

  const { opts } = cap.seen[0];
  const ts = opts.headers['x-sml-timestamp'];
  const expected = crypto.createHmac('sha256', SECRET).update(`${ts}.${opts.body}`, 'utf8').digest('hex');
  assert.equal(opts.headers['x-sml-signature'], expected);
  assert.match(opts.headers['x-sml-signature'], /^[a-f0-9]{64}$/, 'bare lowercase hex, no sha256= prefix');
});

test('the timestamp is seconds and inside the replay window', async () => {
  const cap = capture();
  const pub = P.createProjectionPublisher({ url: URL_, secret: SECRET, fetchImpl: cap.fetchImpl, now });
  await pub.publish(P.buildProjection(rows, { now }));
  const ts = Number(cap.seen[0].opts.headers['x-sml-timestamp']);
  assert.equal(ts, Math.floor(NOW / 1000));
  assert.ok(Math.abs(Math.floor(NOW / 1000) - ts) < P.MAX_SKEW_SECONDS);
});

test('an identical projection is skipped rather than re-pushed', async () => {
  const cap = capture();
  const pub = P.createProjectionPublisher({ url: URL_, secret: SECRET, fetchImpl: cap.fetchImpl, now });
  const p = P.buildProjection(rows, { now });
  const first = await pub.publish(p);
  const second = await pub.publish(p, { lastDigest: first.digest });

  assert.equal(first.published, true);
  assert.equal(second.published, false);
  assert.equal(second.skipped, 'unchanged');
  assert.equal(cap.seen.length, 1, 'only one request went out');
});

test('a changed projection is not skipped', async () => {
  const cap = capture();
  const pub = P.createProjectionPublisher({ url: URL_, secret: SECRET, fetchImpl: cap.fetchImpl, now });
  const first = await pub.publish(P.buildProjection(rows, { now }));
  const next = P.buildProjection(rows.slice(0, 1), { now });
  const second = await pub.publish(next, { lastDigest: first.digest });
  assert.equal(second.published, true);
  assert.equal(cap.seen.length, 2);
});

test('the idempotency key is the content digest', async () => {
  const cap = capture();
  const pub = P.createProjectionPublisher({ url: URL_, secret: SECRET, fetchImpl: cap.fetchImpl, now });
  const p = P.buildProjection(rows, { now });
  const r = await pub.publish(p);
  assert.equal(cap.seen[0].opts.headers['idempotency-key'], `corporate-projection-${r.digest}`);
});

test('a tampered payload is refused before it is signed', async () => {
  /* WordPress applies the projection WHOLESALE. A count that disagrees with the
   * list means something other than buildProjection assembled it, and pushing
   * it would wipe or corrupt every badge on the site. */
  const cap = capture();
  const pub = P.createProjectionPublisher({ url: URL_, secret: SECRET, fetchImpl: cap.fetchImpl, now });
  const bad = { ...P.buildProjection(rows, { now }), count: 9 };
  await assert.rejects(() => pub.publish(bad), /count does not match/);
  assert.equal(cap.seen.length, 0, 'nothing may be sent');
});

test('a non-projection is refused', async () => {
  const pub = P.createProjectionPublisher({ url: URL_, secret: SECRET, fetchImpl: capture().fetchImpl, now });
  for (const bad of [null, undefined, {}, { accounts: 'no' }]) {
    await assert.rejects(() => pub.publish(bad), TypeError);
  }
});

test('a non-2xx response throws rather than reporting success', async () => {
  const cap = capture({ ok: false, status: 401 });
  const pub = P.createProjectionPublisher({ url: URL_, secret: SECRET, fetchImpl: cap.fetchImpl, now });
  await assert.rejects(() => pub.publish(P.buildProjection(rows, { now })), /failed: 401/);
});

test('an empty projection still publishes, carrying its empty flag', async () => {
  /* Genuinely zero corporate accounts is a legitimate state — the receiver is
   * what distinguishes it from a broken query, using this flag. */
  const cap = capture();
  const pub = P.createProjectionPublisher({ url: URL_, secret: SECRET, fetchImpl: cap.fetchImpl, now });
  const r = await pub.publish(P.buildProjection([], { now }));
  assert.equal(r.published, true);
  assert.equal(JSON.parse(cap.seen[0].opts.body).empty, true);
});
