/* Corporate accounts.  Run: node --test  (services/sml-platform/platform)
 *
 * The domain-verification path is an SSRF sink by construction — it fetches a
 * URL derived from user input. Most of what follows is about what it refuses.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CA = require('./corporate-accounts.js');

const NOW = Date.parse('2026-09-15T12:00:00Z');
const SECRET = 'a-verification-secret-long-enough';

function fakePool(routes = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [needle, rows] of routes) {
        if (sql.includes(needle)) return { rows: typeof rows === 'function' ? rows(params) : rows };
      }
      return { rows: [] };
    }
  };
}

const svc = (over = {}) => CA.createCorporateAccountService({
  pool: fakePool([['INSERT INTO corporate_accounts', [{ id: 42 }]]]),
  verificationSecret: SECRET,
  now: () => NOW,
  resolveTxt: async () => [],
  lookup: async () => [{ address: '93.184.216.34' }],
  fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }),
  ...over
});

/* ------------------------------------------------------------ construction */

test('the service refuses a weak or missing verification secret', () => {
  assert.throws(() => CA.createCorporateAccountService({ pool: {} }), /verificationSecret/);
  assert.throws(() => CA.createCorporateAccountService({ pool: {}, verificationSecret: 'short' }), /verificationSecret/);
  assert.throws(() => CA.createCorporateAccountService({ verificationSecret: SECRET }), /database pool/);
});

/* ------------------------------------------------------------ domain rules */

test('a normal https URL reduces to its host', () => {
  assert.equal(CA.normalizeDomain('https://www.bloomberg.com/markets?x=1'), 'www.bloomberg.com');
  assert.equal(CA.normalizeDomain('https://CNN.com/'), 'cnn.com');
  assert.equal(CA.normalizeDomain('https://example.com.'), 'example.com');   // trailing root dot
});

test('http is refused — an http proof can be rewritten in transit', () => {
  assert.throws(() => CA.normalizeDomain('http://cnn.com'), /https/);
});

test('embedded credentials are refused', () => {
  /* https://cnn.com@evil.example is parser-confusion bait: it reads as cnn.com
   * to a human and resolves to evil.example. */
  assert.throws(() => CA.normalizeDomain('https://cnn.com@evil.example/'), /credentials/);
});

test('IP literals, ports, localhost and .local are refused', () => {
  assert.throws(() => CA.normalizeDomain('https://127.0.0.1/'), /IP address/);
  assert.throws(() => CA.normalizeDomain('https://[::1]/'), /IP address/);
  assert.throws(() => CA.normalizeDomain('https://example.com:8443/'), /port/);
  assert.throws(() => CA.normalizeDomain('https://localhost/'), /public domain/);
  assert.throws(() => CA.normalizeDomain('https://printer.local/'), /public domain/);
});

test('a bare word is not a domain', () => {
  assert.throws(() => CA.normalizeDomain('https://intranet/'), /valid domain/);
  assert.throws(() => CA.normalizeDomain('not-a-url'), /absolute URL/);
});

/* --------------------------------------------------------- address filter */

test('public addresses pass', () => {
  assert.equal(CA.isPublicAddress('93.184.216.34'), true);
  assert.equal(CA.isPublicAddress('2606:2800:220:1:248:1893:25c8:1946'), true);
});

test('cloud metadata and every private range are blocked', () => {
  /* 169.254.169.254 is the one that matters: on Render it hands out instance
   * credentials to anything that can reach it. */
  for (const addr of [
    '169.254.169.254', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '0.0.0.0', '100.64.0.1', '224.0.0.1'
  ]) {
    assert.equal(CA.isPublicAddress(addr), false, `${addr} must be blocked`);
  }
  for (const addr of ['::1', '::', 'fd00::1', 'fe80::1']) {
    assert.equal(CA.isPublicAddress(addr), false, `${addr} must be blocked`);
  }
});

test('an IPv4 private address wearing an IPv6 coat is still blocked', () => {
  assert.equal(CA.isPublicAddress('::ffff:169.254.169.254'), false);
  assert.equal(CA.isPublicAddress('::ffff:10.0.0.1'), false);
});

test('garbage is not treated as public', () => {
  for (const bad of ['', 'not-an-ip', null, undefined, '999.999.999.999']) {
    assert.equal(CA.isPublicAddress(bad), false);
  }
});

/* ------------------------------------------------------------------ token */

test('the token is derived, stable, and scoped to the domain', () => {
  const s = svc();
  const a = s.verificationToken(42, 'cnn.com');
  assert.equal(s.verificationToken(42, 'cnn.com'), a, 'stable across calls — no storage needed');
  assert.notEqual(s.verificationToken(43, 'cnn.com'), a, 'scoped to the account');
  assert.notEqual(s.verificationToken(42, 'evil.example'), a,
    'scoped to the domain, so a proof cannot be replayed elsewhere');
  assert.match(a, /^sml-verification=[0-9a-f]{32}$/);
});

test('rotating the secret invalidates every outstanding challenge', () => {
  const a = svc().verificationToken(42, 'cnn.com');
  const b = CA.createCorporateAccountService({
    pool: fakePool(), verificationSecret: 'a-completely-different-secret!!', now: () => NOW
  }).verificationToken(42, 'cnn.com');
  assert.notEqual(a, b);
});

/* --------------------------------------------------------------- register */

test('registration derives the domain and returns the token to publish', async () => {
  const pool = fakePool([['INSERT INTO corporate_accounts', [{ id: 42 }]]]);
  const s = svc({ pool });
  const r = await s.register({
    wpUserId: 258457001, companyName: 'Bloomberg', brandHandle: 'bloomberg',
    websiteUrl: 'https://www.bloomberg.com/markets', category: 'finance'
  });
  assert.equal(r.corporateId, 42);
  assert.equal(r.domain, 'www.bloomberg.com');
  assert.equal(r.token, s.verificationToken(42, 'www.bloomberg.com'));

  const insert = pool.calls.find((c) => c.sql.includes('INSERT INTO corporate_accounts'));
  assert.equal(insert.params[7], 'www.bloomberg.com', 'the demanded domain is stored at registration');
  assert.ok(insert.sql.includes("'pending'"), 'never inserted active');
});

test('the handle is lowercased and validated', async () => {
  const s = svc();
  const r = await s.register({
    wpUserId: 1, companyName: 'CNN', brandHandle: 'CNN', websiteUrl: 'https://cnn.com'
  });
  assert.equal(r.corporateId, 42);
  for (const bad of ['a', 'has space', 'x'.repeat(40), '-leading']) {
    await assert.rejects(() => s.register({
      wpUserId: 1, companyName: 'X', brandHandle: bad, websiteUrl: 'https://cnn.com'
    }), TypeError);
  }
});

test('an unknown category is refused rather than defaulted', async () => {
  await assert.rejects(() => svc().register({
    wpUserId: 1, companyName: 'X', brandHandle: 'xx', websiteUrl: 'https://x.com', category: 'sponsor'
  }), /category must be one of/);
});

/* ----------------------------------------------------------------- verify */

const acct = (over = {}) => [['SELECT id, status, verified_domain', [{
  id: 42, status: 'pending', verified_domain: 'cnn.com', verified_at: null, ...over
}]]];

test('a matching TXT record verifies, and HTTP is never touched', async () => {
  let fetched = false;
  const pool = fakePool(acct());
  const s = svc({
    pool,
    resolveTxt: async () => [['sml-verification=' + 'x']],   // replaced below
    fetchImpl: async () => { fetched = true; throw new Error('should not fetch'); }
  });
  const token = s.verificationToken(42, 'cnn.com');
  const s2 = svc({
    pool,
    resolveTxt: async () => [[token]],
    fetchImpl: async () => { fetched = true; throw new Error('should not fetch'); }
  });
  const r = await s2.verifyDomain(42);
  assert.equal(r.verified, true);
  assert.equal(r.method, 'dns_txt');
  assert.equal(fetched, false, 'DNS success must not fall through to the HTTP path');
});

test('a TXT record split into 255-byte chunks is joined before comparison', async () => {
  const pool = fakePool(acct());
  const s = svc({ pool });
  const token = s.verificationToken(42, 'cnn.com');
  const mid = Math.floor(token.length / 2);
  const s2 = svc({ pool, resolveTxt: async () => [[token.slice(0, mid), token.slice(mid)]] });
  assert.equal((await s2.verifyDomain(42)).verified, true);
});

test('a wrong TXT record does not verify', async () => {
  const s = svc({ pool: fakePool(acct()), resolveTxt: async () => [['sml-verification=deadbeef']] });
  const r = await s.verifyDomain(42);
  assert.equal(r.verified, false);
});

test('the well-known file verifies when DNS has nothing', async () => {
  const pool = fakePool(acct());
  const token = svc({ pool }).verificationToken(42, 'cnn.com');
  const s = svc({
    pool,
    resolveTxt: async () => [],
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => `${token}\n` })
  });
  const r = await s.verifyDomain(42);
  assert.equal(r.verified, true);
  assert.equal(r.method, 'well_known');
});

test('a domain resolving to cloud metadata is refused before any fetch', async () => {
  /* The attack: register evil.example, point its A record at 169.254.169.254,
   * and let our verifier read the instance credentials for us. */
  let fetched = false;
  const s = svc({
    pool: fakePool(acct()),
    resolveTxt: async () => [],
    lookup: async () => [{ address: '169.254.169.254' }],
    fetchImpl: async () => { fetched = true; return { ok: true, status: 200, text: async () => 'x' }; }
  });
  const r = await s.verifyDomain(42);
  assert.equal(r.verified, false);
  assert.match(r.reason, /non-public address/);
  assert.equal(fetched, false, 'nothing may be fetched once an address is rejected');
});

test('one private address among several is enough to refuse', async () => {
  /* DNS round-robin with a poisoned entry — checking only the first would let
   * it through on the next attempt. */
  let fetched = false;
  const s = svc({
    pool: fakePool(acct()),
    resolveTxt: async () => [],
    lookup: async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }],
    fetchImpl: async () => { fetched = true; return { ok: true, status: 200, text: async () => 'x' }; }
  });
  assert.equal((await s.verifyDomain(42)).verified, false);
  assert.equal(fetched, false);
});

test('redirects are refused, not followed', async () => {
  /* The address check ran against the ORIGINAL host only, so following a 302
   * would step straight past it. */
  let opts = null;
  const s = svc({
    pool: fakePool(acct()),
    resolveTxt: async () => [],
    fetchImpl: async (_u, o) => { opts = o; return { ok: true, status: 200, text: async () => 'nope' }; }
  });
  await s.verifyDomain(42);
  assert.equal(opts.redirect, 'error');
});

test('an oversized verification file is refused', async () => {
  const pool = fakePool(acct());
  const token = svc({ pool }).verificationToken(42, 'cnn.com');
  const s = svc({
    pool,
    resolveTxt: async () => [],
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => token + 'z'.repeat(1000) })
  });
  const r = await s.verifyDomain(42);
  assert.equal(r.verified, false);
  assert.match(r.reason, /too large/);
});

test('the well-known path can be disabled, leaving DNS as the only proof', async () => {
  let fetched = false;
  const s = svc({
    pool: fakePool(acct()),
    resolveTxt: async () => [],
    fetchImpl: async () => { fetched = true; return { ok: true, status: 200, text: async () => 'x' }; }
  });
  const r = await s.verifyDomain(42, { allowWellKnown: false });
  assert.equal(r.verified, false);
  assert.equal(fetched, false);
});

test('an already-verified account is idempotent and re-checks nothing', async () => {
  let looked = false;
  const s = svc({
    pool: fakePool(acct({ verified_at: new Date(NOW), verified_method: 'dns_txt' })),
    resolveTxt: async () => { looked = true; return []; }
  });
  const r = await s.verifyDomain(42);
  assert.equal(r.verified, true);
  assert.equal(r.alreadyVerified, true);
  assert.equal(looked, false);
});

test('verification only ever writes when it was previously null', async () => {
  const pool = fakePool(acct());
  const token = svc({ pool }).verificationToken(42, 'cnn.com');
  const s = svc({ pool, resolveTxt: async () => [[token]] });
  await s.verifyDomain(42);
  const update = pool.calls.find((c) => c.sql.includes('UPDATE corporate_accounts'));
  assert.match(update.sql, /verified_at IS NULL/, 'a race must not overwrite an earlier proof');
});

/* --------------------------------------------------------------- activate */

const activateRow = (over = {}) => [['LEFT JOIN corporate_billing', [{
  status: 'pending', verified_at: new Date(NOW), onboarding_paid_at: new Date(NOW), ...over
}]]];

test('activation needs both a proven domain and a settled fee', async () => {
  await assert.rejects(
    () => svc({ pool: fakePool(activateRow({ verified_at: null })) }).activate(42),
    /not verified/
  );
  await assert.rejects(
    () => svc({ pool: fakePool(activateRow({ onboarding_paid_at: null })) }).activate(42),
    /fee is not paid/
  );
});

test('the fee is read from the billing row, never from the caller', async () => {
  const pool = fakePool(activateRow());
  await svc({ pool }).activate(42);
  const read = pool.calls.find((c) => c.sql.includes('LEFT JOIN corporate_billing'));
  assert.ok(read, 'activation must consult billing');
  const update = pool.calls.find((c) => c.sql.includes("status = 'active'"));
  assert.ok(update);
});

test('activating an active account is a no-op, not an error', async () => {
  const r = await svc({ pool: fakePool(activateRow({ status: 'active' })) }).activate(42);
  assert.equal(r.activated, false);
});

test('an unknown account is refused', async () => {
  await assert.rejects(() => svc({ pool: fakePool() }).activate(42), /unknown corporate account/);
});

/* -------------------------------------------------- suspend & projection */

test('suspension records a reason and never touches closed accounts', async () => {
  const pool = fakePool();
  await svc({ pool }).suspend(42, 'chargeback');
  const q = pool.calls[0];
  assert.match(q.sql, /status = 'suspended'/);
  assert.match(q.sql, /status <> 'closed'/);
  assert.equal(q.params[2], 'chargeback');
  await assert.rejects(() => svc({ pool }).suspend(42, ''), /reason/);
});

test('the projection carries active accounts only', async () => {
  const pool = fakePool([['FROM corporate_accounts', [
    { wp_user_id: '258457001', brand_handle: 'bloomberg', company_name: 'Bloomberg', category: 'finance' }
  ]]]);
  const rows = await svc({ pool }).projection();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].wpUserId, 258457001);
  assert.equal(typeof rows[0].wpUserId, 'number', 'BIGINT arrives as a string and must be coerced');
  assert.equal(rows[0].active, true);
  assert.equal(rows[0].badge, 'corporate');
  assert.match(pool.calls[0].sql, /status = 'active'/);
});
