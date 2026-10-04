'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PLANS, parsePrices, createPassStore, createPassService, createWalletClient, withPasses } = require('./academy-passes.js');

const U = '300000000000000001';
const PRICES = { daily: 50, weekly: 250, monthly: 800, quarterly: 2100, semiannual: 3800, yearly: 6800, lifetime: 20000 };
function fakeWallet(opts = {}) {
  const w = { balance: opts.balance ?? 1000, blocked: opts.blocked || '', charges: new Map(), refunds: [], calls: 0 };
  w.status = async () => ({ ok: true, linked: true, eligible: !w.blocked, blocked: w.blocked, balance: w.balance });
  w.spend = async ({ amount, ref }) => {
    w.calls++;
    if (w.charges.has(ref)) return { ok: true, balance: w.balance, status: 'duplicate' };
    if (w.blocked) return { ok: false, status: 403, error: w.blocked, url: 'https://x.test/fix' };
    if (w.balance < amount) return { ok: false, status: 402, error: 'insufficient_funds', balance: w.balance, needed: amount };
    w.balance -= amount; w.charges.set(ref, amount); return { ok: true, balance: w.balance };
  };
  w.refund = async ({ ref }) => { w.refunds.push(ref); w.balance += w.charges.get(ref) || 0; return { ok: true }; };
  return w;
}
const clock = (iso) => { let t = new Date(iso); return { now: () => new Date(t), set: (v) => { t = new Date(v); } }; };

test('plans cover daily through lifetime and prices parse strictly', () => {
  assert.deepEqual(Object.keys(PLANS), ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly', 'lifetime']);
  assert.deepEqual(parsePrices('{"daily":50,"weekly":"250","bogus":5,"monthly":-1,"yearly":1.5}'), { daily: 50, weekly: 250 });
  assert.equal(parsePrices('not json'), null); assert.equal(parsePrices(''), null);
});

test('nothing is for sale until prices are configured', async () => {
  const svc = createPassService({ wallet: fakeWallet(), prices: null });
  assert.equal(svc.configured, false);
  assert.equal((await svc.buy({ discordId: U, plan: 'daily', orderKey: 'abcdefgh1' })).code, 'passes_not_configured');
});

test('a purchase charges once, grants access for the plan length, and a retry never double-charges', async () => {
  const c = clock('2026-01-01T00:00:00Z'), wallet = fakeWallet(), store = createPassStore();
  const svc = createPassService({ store, wallet, prices: PRICES, now: c.now });
  const a = await svc.buy({ discordId: U, plan: 'weekly', orderKey: 'order-0001' });
  assert.ok(a.ok); assert.equal(a.pass.expiresAt, '2026-01-08T00:00:00.000Z'); assert.equal(wallet.balance, 750);
  const again = await svc.buy({ discordId: U, plan: 'weekly', orderKey: 'order-0001' });
  assert.ok(again.ok && again.duplicate); assert.equal(wallet.balance, 750);
  assert.equal(await svc.hasActive(U), true);
  c.set('2026-01-09T00:00:00Z'); assert.equal(await svc.hasActive(U), false, 'expired');
});

test('buying again while active extends from the current end; lifetime never expires and blocks more buying', async () => {
  const c = clock('2026-01-01T00:00:00Z'), svc = createPassService({ store: createPassStore(), wallet: fakeWallet({ balance: 100000 }), prices: PRICES, now: c.now });
  await svc.buy({ discordId: U, plan: 'monthly', orderKey: 'order-0001' });
  const b = await svc.buy({ discordId: U, plan: 'monthly', orderKey: 'order-0002' });
  assert.equal(b.pass.expiresAt, '2026-03-02T00:00:00.000Z');
  const l = await svc.buy({ discordId: U, plan: 'lifetime', orderKey: 'order-0003' });
  assert.equal(l.pass.expiresAt, null);
  c.set('2040-01-01T00:00:00Z'); assert.equal(await svc.hasActive(U), true);
  assert.equal((await svc.buy({ discordId: U, plan: 'daily', orderKey: 'order-0004' })).code, 'already_lifetime');
});

test('insufficient funds and unmet account requirements charge nothing and say what to fix', async () => {
  const poor = fakeWallet({ balance: 10 }), svc = createPassService({ wallet: poor, prices: PRICES });
  const r = await svc.buy({ discordId: U, plan: 'daily', orderKey: 'order-0001' });
  assert.deepEqual([r.ok, r.code, r.balance, r.needed], [false, 'insufficient_funds', 10, 50]);
  const locked = fakeWallet({ blocked: 'two_step_required' });
  const r2 = await createPassService({ wallet: locked, prices: PRICES }).buy({ discordId: U, plan: 'daily', orderKey: 'order-0002' });
  assert.equal(r2.code, 'two_step_required'); assert.equal(r2.url, 'https://x.test/fix'); assert.equal(locked.balance, 1000);
  assert.equal((await svc.buy({ discordId: U, plan: 'nope', orderKey: 'order-0003' })).code, 'unknown_plan');
  assert.equal((await svc.buy({ discordId: U, plan: 'daily', orderKey: 'x' })).code, 'order_key_required');
});

test('if the pass cannot be recorded after the charge, the Loop Bucks are refunded automatically', async () => {
  const wallet = fakeWallet(), store = createPassStore(); store.add = async () => { throw new Error('db down'); };
  const r = await createPassService({ store, wallet, prices: PRICES }).buy({ discordId: U, plan: 'daily', orderKey: 'order-0001' });
  assert.equal(r.code, 'temporarily_unavailable_refunded'); assert.equal(wallet.balance, 1000); assert.equal(wallet.refunds.length, 1);
});

test('an operator refund ends the pass and returns the Loop Bucks', async () => {
  const wallet = fakeWallet(), svc = createPassService({ wallet, prices: PRICES });
  const b = await svc.buy({ discordId: U, plan: 'monthly', orderKey: 'order-0001' });
  assert.ok((await svc.refund({ ref: b.pass.ref })).ok);
  assert.equal(wallet.balance, 1000); assert.equal(await svc.hasActive(U), false);
});

test('access: a member without the Discord role gets in on a live pass, as the academy tier; otherwise the refusal stands', async () => {
  const svc = createPassService({ wallet: fakeWallet(), prices: PRICES });
  const refused = { ok: false, status: 403, code: 'academy_role_required', userId: U };
  const access = withPasses({ verify: async () => refused }, svc);
  assert.deepEqual(await access.verify('Bearer x'), refused);
  await svc.buy({ discordId: U, plan: 'daily', orderKey: 'order-0001' });
  assert.deepEqual(await access.verify('Bearer x'), { ok: true, userId: U, tier: 'academy' });
  const other = { ok: false, status: 401, code: 'authorization_required' };
  assert.deepEqual(await withPasses({ verify: async () => other }, svc).verify('x'), other);
  assert.deepEqual(await withPasses({ verify: async () => ({ ok: true, userId: U, tier: 'member' }) }, svc).verify('x'), { ok: true, userId: U, tier: 'member' });
});

test('the wallet client signs each request the way the site verifies it and maps refusals', async () => {
  const secret = 's'.repeat(40), seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: false, status: 402, json: async () => ({ ok: false, error: 'insufficient_funds', balance: 1, needed: 5 }) }; };
  const w = createWalletClient({ baseUrl: 'https://site.test/', secret, fetchImpl, now: () => 1_700_000_000_000 });
  const r = await w.spend({ discordId: U, amount: 5, ref: 'acad-lb:1:abcdefgh', plan: 'daily' });
  assert.equal(r.error, 'insufficient_funds');
  const { url, init } = seen[0], path = '/wp-json/sml-loop-kick/v1/academy-wallet';
  assert.equal(url, 'https://site.test' + path);
  const want = crypto.createHmac('sha256', secret).update('1700000000.' + path + '.' + crypto.createHash('sha256').update(init.body).digest('hex')).digest('hex');
  assert.equal(init.headers['x-sml-lk-signature'], 'sha256=' + want);
  assert.equal((await createWalletClient({ baseUrl: 'http://insecure', secret }).status(U)).error, 'wallet_unconfigured');
});
