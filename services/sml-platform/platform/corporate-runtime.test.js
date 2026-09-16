/* Corporate runtime + route.  Run: node --test  (services/sml-platform/platform)
 *
 * What matters most here is money: a signed admin request is only a CLAIM that
 * a payment happened, so every test around fees, ad purchases and refunds
 * checks that Stripe's own record — status, currency, amount, and whether the
 * payment was already used — decides, not the request body.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('./server');
const { hmac } = require('./wordpress-gateway');
const R = require('./corporate-runtime');

const NOW = 1_700_000_000_000;
const now = () => NOW;
const SECRET = 'billing-api-secret';

const CONFIG = Object.freeze({
  corporateEnabled: true,
  corporateVerificationSecret: 'corporate-verification-secret-0123',
  evidenceEncryptionKeys: ['1:evidence-key-material-0123456789'],
  wordpressUrl: 'https://stockmarketloop.com',
  wordpressBillingBridgeSecret: 'bridge-secret'
});

/* ----------------------------------------------------------------- fakes */

function fakePool(routes = []) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [needle, rows] of routes) {
        if (sql.includes(needle)) {
          if (rows instanceof Error) throw rows;
          return { rows: typeof rows === 'function' ? rows(params) : rows };
        }
      }
      return { rows: [] };
    },
    release() {}
  };
  return { calls, connect: async () => client, query: (sql, params) => client.query(sql, params) };
}

function fakeStripe({ intents = {}, refunds = {} } = {}) {
  return {
    paymentIntents: { retrieve: async (id) => { if (!intents[id]) throw new Error('No such payment_intent'); return intents[id]; } },
    refunds: { retrieve: async (id) => { if (!refunds[id]) throw new Error('No such refund'); return refunds[id]; } }
  };
}

const PAID_FEE = { id: 'pi_fee00000001', status: 'succeeded', currency: 'usd', amount_received: 1000000, latest_charge: 'ch_fee00000001' };

function runtime(opts = {}) {
  return R.createCorporateRuntime({
    config: CONFIG, pool: fakePool(), now, logger: () => {},
    fetchImpl: async () => ({ ok: true, status: 200 }), ...opts
  });
}

/* ------------------------------------------------------------ enablement */

test('the runtime is off unless every prerequisite is configured', () => {
  const cases = [
    [{ ...CONFIG, corporateEnabled: false }, 'flag_off'],
    [{ ...CONFIG, corporateVerificationSecret: 'short' }, 'missing_verification_secret'],
    [{ ...CONFIG, evidenceEncryptionKeys: [] }, 'missing_encryption_key']
  ];
  for (const [config, reason] of cases) {
    const r = R.createCorporateRuntime({ config, pool: fakePool() });
    assert.equal(r.enabled, false);
    assert.equal(r.reason, reason);
    assert.equal(r.actions, null, 'no actions exist while disabled');
  }
  assert.equal(R.createCorporateRuntime({ config: CONFIG, pool: null }).reason, 'missing_database');
  assert.equal(runtime().enabled, true);
});

/* ------------------------------------------------------------ refund math */

test('a full refund reverses the purchase exactly', () => {
  assert.deepEqual(R.refundSplit({ refundCents: 80000, grossCents: 100000, discountCents: 20000, netCents: 80000 }),
    { grossCents: -100000, discountCents: -20000, netCents: -80000 });
});

test('a partial refund returns discount pro rata, rounded down, and keeps the ledger identity', () => {
  const s = R.refundSplit({ refundCents: 33333, grossCents: 100000, discountCents: 20000, netCents: 80000 });
  assert.equal(s.netCents, -33333);
  assert.equal(s.discountCents, -8333, 'floor(33333 * 20000 / 80000) = 8333');
  assert.equal(s.grossCents - s.discountCents, s.netCents, 'net = gross - discount');
  assert.ok(s.discountCents >= s.grossCents && s.discountCents <= 0, 'the schema CHECK holds');
});

test('a refund larger than the charge is refused', () => {
  assert.throws(() => R.refundSplit({ refundCents: 80001, grossCents: 100000, discountCents: 20000, netCents: 80000 }),
    (e) => e.code === 'refund_exceeds_charge');
});

/* ------------------------------------------------------------------ fees */

function feePool(extra = []) {
  return fakePool([
    ['SELECT onboarding_fee_cents', [{ onboarding_fee_cents: '1000000', onboarding_paid_at: null }]],
    ['UPDATE corporate_billing', [{ id: '7' }]],
    ...extra
  ]);
}

test('a succeeded USD payment of the full fee is recorded', async () => {
  const pool = feePool();
  const r = runtime({ pool, stripe: fakeStripe({ intents: { [PAID_FEE.id]: PAID_FEE } }) });
  const result = await r.actions['record-fee']({ billingId: 7, paymentIntentId: PAID_FEE.id });
  assert.equal(result.applied, true);
});

test('the fee is refused unless Stripe says it succeeded, in USD, for the full amount', async () => {
  const bad = [
    [{ ...PAID_FEE, status: 'processing' }, 'payment_not_succeeded'],
    [{ ...PAID_FEE, currency: 'cad' }, 'payment_currency_mismatch'],
    [{ ...PAID_FEE, amount_received: 999999 }, 'payment_amount_mismatch']
  ];
  for (const [intent, code] of bad) {
    const pool = feePool();
    const r = runtime({ pool, stripe: fakeStripe({ intents: { [intent.id]: intent } }) });
    await assert.rejects(() => r.actions['record-fee']({ billingId: 7, paymentIntentId: intent.id }), (e) => e.code === code, code);
    assert.ok(!pool.calls.some((c) => c.sql.includes('UPDATE corporate_billing')), `${code}: nothing written`);
  }
});

test('a payment already booked as ad spend cannot also pay the fee', async () => {
  const pool = feePool([["SELECT 'fee' AS kind", [{ kind: 'ad' }]]]);
  const r = runtime({ pool, stripe: fakeStripe({ intents: { [PAID_FEE.id]: PAID_FEE } }) });
  await assert.rejects(() => r.actions['record-fee']({ billingId: 7, paymentIntentId: PAID_FEE.id }),
    (e) => e.code === 'payment_already_recorded');
  assert.ok(!pool.calls.some((c) => c.sql.includes('UPDATE corporate_billing')));
});

test('an already-paid cycle is a no-op, and Stripe is not even asked', async () => {
  let asked = false;
  const pool = fakePool([['SELECT onboarding_fee_cents', [{ onboarding_fee_cents: '1000000', onboarding_paid_at: new Date(NOW) }]]]);
  const stripe = { paymentIntents: { retrieve: async () => { asked = true; return PAID_FEE; } } };
  const result = await runtime({ pool, stripe }).actions['record-fee']({ billingId: 7, paymentIntentId: PAID_FEE.id });
  assert.deepEqual(result, { applied: false, alreadyPaid: true });
  assert.equal(asked, false);
});

test('malformed Stripe ids are refused before any call', async () => {
  const r = runtime({ stripe: fakeStripe() });
  for (const id of ['', 'ch_123456789', 'pi_', 'pi_abc', 'pi_12345678; DROP']) {
    await assert.rejects(() => r.actions['record-fee']({ billingId: 7, paymentIntentId: id }), TypeError, id);
  }
});

test('without Stripe configured, money routes refuse rather than trust the body', async () => {
  const r = runtime({ pool: feePool(), stripe: null });
  await assert.rejects(() => r.actions['record-fee']({ billingId: 7, paymentIntentId: PAID_FEE.id }),
    (e) => e.code === 'stripe_unconfigured');
});

/* ------------------------------------------------------------- ad spend */

const AD_INTENT = { id: 'pi_ad000000001', status: 'succeeded', currency: 'usd', amount_received: 80000, latest_charge: { id: 'ch_ad000000001' } };

test('an ad payment is recorded at the amount Stripe collected, against its charge id', async () => {
  const appended = [];
  const pool = fakePool([
    ['FROM corporate_billing WHERE id = $1 AND corporate_id', [{ id: 7, annual_cap_cents: '10000000', discount_bps: 2000, discount_cap_cents: '2000000', cycle_end: '2099-01-01' }]],
    ['SUM(net_cents)', [{ net: '0', discount: '0' }]],
    ['SELECT integrity_hash FROM corporate_ad_spend', []],
    ['INSERT INTO corporate_ad_spend', (params) => { appended.push(params); return [{ id: '55' }]; }]
  ]);
  const r = runtime({ pool, stripe: fakeStripe({ intents: { [AD_INTENT.id]: AD_INTENT } }) });
  const result = await r.actions['ad-record']({ corporateId: 1, billingId: 7, grossCents: 100000, paymentIntentId: AD_INTENT.id });
  assert.equal(result.netCents, 80000);
  assert.ok(appended[0].includes('ch_ad000000001'), 'the charge id is what gets recorded');
});

test('an ad payment that no longer matches the price records nothing', async () => {
  const pool = fakePool([
    ['FROM corporate_billing WHERE id = $1 AND corporate_id', [{ id: 7, annual_cap_cents: '10000000', discount_bps: 2000, discount_cap_cents: '2000000', cycle_end: '2099-01-01' }]],
    ['SUM(net_cents)', [{ net: '0', discount: '2000000' }]]      // discount already used up: price is now 100000
  ]);
  const r = runtime({ pool, stripe: fakeStripe({ intents: { [AD_INTENT.id]: AD_INTENT } }) });
  await assert.rejects(
    () => r.actions['ad-record']({ corporateId: 1, billingId: 7, grossCents: 100000, paymentIntentId: AD_INTENT.id }),
    (e) => e.code === 'price_changed' && /refund the payment and re-quote/.test(e.message));
  assert.ok(!pool.calls.some((c) => c.sql.includes('INSERT INTO corporate_ad_spend')));
});

test('the onboarding fee payment cannot be booked again as ad spend', async () => {
  const pool = fakePool([["SELECT 'fee' AS kind", [{ kind: 'fee' }]]]);
  const r = runtime({ pool, stripe: fakeStripe({ intents: { [PAID_FEE.id]: PAID_FEE } }) });
  await assert.rejects(
    () => r.actions['ad-record']({ corporateId: 1, billingId: 7, grossCents: 1250000, paymentIntentId: PAID_FEE.id }),
    (e) => e.code === 'payment_already_recorded' && /as fee/.test(e.message));
});

/* --------------------------------------------------------------- refunds */

function refundPool({ prior = { refunded: '0', same: '0' }, purchase = { gross_cents: '100000', discount_cents: '20000', net_cents: '80000' } } = {}) {
  return fakePool([
    ['FROM corporate_ad_spend\n        WHERE stripe_charge_id', purchase ? [purchase] : []],
    ["provenance->>'reverses_charge'", [prior]],
    ['SELECT integrity_hash FROM corporate_ad_spend', []],
    ['INSERT INTO corporate_ad_spend', [{ id: '56' }]]
  ]);
}
const REFUND = { id: 're_ad000000001', status: 'succeeded', amount: 40000, charge: 'ch_ad000000001' };

test('a succeeded refund of a recorded charge appends a proportional correction', async () => {
  const r = runtime({ pool: refundPool(), stripe: fakeStripe({ refunds: { [REFUND.id]: REFUND } }) });
  const result = await r.actions['ad-refund']({ corporateId: 1, billingId: 7, refundId: REFUND.id, reason: 'campaign cancelled' });
  assert.deepEqual([result.grossCents, result.discountCents, result.netCents], [-50000, -10000, -40000]);
});

test('refunds are refused when unsucceeded, unknown, duplicated, or larger than what remains', async () => {
  const stripe = (refund) => fakeStripe({ refunds: { [refund.id]: refund } });
  const cases = [
    [refundPool(), { ...REFUND, status: 'pending' }, 'refund_not_succeeded'],
    [refundPool({ purchase: null }), REFUND, 'charge_not_recorded'],
    [refundPool({ prior: { refunded: '40000', same: '1' } }), REFUND, 'refund_already_recorded'],
    [refundPool({ prior: { refunded: '60000', same: '0' } }), REFUND, 'refund_exceeds_charge']
  ];
  for (const [pool, refund, code] of cases) {
    const r = runtime({ pool, stripe: stripe(refund) });
    await assert.rejects(() => r.actions['ad-refund']({ corporateId: 1, billingId: 7, refundId: refund.id, reason: 'x' }),
      (e) => e.code === code, code);
    assert.ok(!pool.calls.some((c) => c.sql.includes('INSERT INTO corporate_ad_spend')), `${code}: nothing written`);
  }
});

test('a refund must state a reason', async () => {
  const r = runtime({ pool: refundPool(), stripe: fakeStripe({ refunds: { [REFUND.id]: REFUND } }) });
  await assert.rejects(() => r.actions['ad-refund']({ corporateId: 1, billingId: 7, refundId: REFUND.id }), TypeError);
});

/* ------------------------------------------------------------ projection */

test('activate and suspend push the projection immediately', async () => {
  const pushes = [];
  const pool = fakePool([
    ['SELECT a.status, a.verified_at', [{ status: 'pending', verified_at: new Date(NOW), onboarding_paid_at: new Date(NOW) }]],
    ["WHERE status = 'active'", [{ wp_user_id: '900001', brand_handle: 'bloomberg', company_name: 'Bloomberg', category: 'finance' }]]
  ]);
  const r = runtime({ pool, fetchImpl: async (url, opts) => { pushes.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200 }; } });
  const a = await r.actions.activate({ corporateId: 1 });
  assert.equal(a.projectionPublished, true);
  const s = await r.actions.suspend({ corporateId: 1, reason: 'breach' });
  assert.equal(s.projectionPublished, true, 'forced even though the list did not change in this fake');
  assert.equal(pushes.length, 2);
  assert.equal(pushes[0].url, 'https://stockmarketloop.com/wp-json/sml-corporate/v1/projection');
});

test('an unchanged projection is not re-pushed on every worker tick', async () => {
  let pushes = 0;
  const pool = fakePool([["WHERE status = 'active'", []]]);
  const r = runtime({ pool, fetchImpl: async () => { pushes += 1; return { ok: true, status: 200 }; } });
  await r.publishProjection();
  await r.publishProjection();
  await r.publishProjection();
  assert.equal(pushes, 1);
});

test('a failing push is logged once per distinct error, never thrown into the worker', async () => {
  const logs = [];
  const pool = fakePool([["WHERE status = 'active'", []]]);
  const r = runtime({ pool, logger: (level, event) => logs.push(event), fetchImpl: async () => ({ ok: false, status: 404 }) });
  for (let i = 0; i < 5; i += 1) {
    const result = await r.publishProjection();
    assert.equal(result.published, false);
  }
  assert.equal(logs.filter((e) => e === 'corporate_projection_failed').length, 1, 'an uninstalled plugin must not flood the log');
});

test('with no WordPress bridge secret, publishing is skipped rather than unsigned', async () => {
  const r = runtime({ config: { ...CONFIG, wordpressBillingBridgeSecret: '' } });
  assert.deepEqual(await r.publishProjection(), { published: false, skipped: 'publisher_unconfigured' });
});

/* ------------------------------------------------------------------ route */

async function withServer(options, run) {
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted',
    logger: () => {}, now, billingApiSecret: SECRET, corporateConflictCodes: R.CONFLICT_CODES, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function post(base, action, body, { secret = SECRET } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(NOW / 1000));
  return fetch(`${base}/v1/corporate/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sml-timestamp': timestamp, 'x-sml-signature': `sha256=${hmac(secret, timestamp, raw)}` },
    body: raw
  });
}

const stubRuntime = (actions) => ({ enabled: true, actions });

test('the route is signed: a wrong secret never reaches an action', async () => {
  let called = false;
  await withServer({ corporate: stubRuntime({ register: async () => { called = true; return {}; } }) }, async (base) => {
    const res = await post(base, 'register', {}, { secret: 'wrong' });
    assert.equal(res.status, 401);
    assert.equal(called, false);
  });
});

test('the route 503s while the runtime is disabled', async () => {
  await withServer({ corporate: { enabled: false, actions: null } }, async (base) => {
    const res = await post(base, 'register', {});
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'integration_unconfigured');
  });
  await withServer({ corporate: null }, async (base) => {
    assert.equal((await post(base, 'register', {})).status, 503);
  });
});

test('an unknown action is a 404, including prototype keys', async () => {
  await withServer({ corporate: stubRuntime(Object.freeze({ register: async () => ({}) })) }, async (base) => {
    assert.equal((await post(base, 'drop-tables', {})).status, 404);
    assert.equal((await post(base, 'toString', {})).status, 404);
    assert.equal((await post(base, 'constructor', {})).status, 404);
  });
});

test('refusals are 409 with their code; bad input 400; malfunctions 503 without detail', async () => {
  const capped = Object.assign(new Error('purchase exceeds the remaining annual cap'), { code: 'cap_exceeded', remainingCents: 100 });
  await withServer({ corporate: stubRuntime({
    capped: async () => { throw capped; },
    bad: async () => { throw new TypeError('grossCents must be positive'); },
    broken: async () => { throw new Error('connection terminated: password=hunter2'); },
    nostripe: async () => { throw Object.assign(new Error('x'), { code: 'stripe_unconfigured' }); },
    ok: async () => ({ id: 1 })
  }) }, async (base) => {
    let res = await post(base, 'capped', {});
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { ok: false, error: 'cap_exceeded', message: capped.message, remainingCents: 100 });

    res = await post(base, 'bad', {});
    assert.equal(res.status, 400);
    assert.equal((await res.json()).message, 'grossCents must be positive');

    res = await post(base, 'broken', {});
    assert.equal(res.status, 503);
    assert.doesNotMatch(await res.text(), /hunter2/, 'internal error text never reaches the response');

    assert.equal((await post(base, 'nostripe', {})).status, 503);
    res = await post(base, 'ok', {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, id: 1 });
  });
});

test('an array result is wrapped rather than spread into the response', async () => {
  await withServer({ corporate: stubRuntime({ list: async () => [1, 2] }) }, async (base) => {
    assert.deepEqual(await (await post(base, 'list', {})).json(), { ok: true, result: [1, 2] });
  });
});
