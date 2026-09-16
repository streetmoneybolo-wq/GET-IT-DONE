/* Corporate billing.  Run: node --test  (services/sml-platform/platform)
 *
 * The pricing function is pure, so every rounding corner is exercised here
 * rather than discovered on an invoice.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('./corporate-billing.js');

const NOW = Date.parse('2026-09-15T12:00:00Z');
const now = () => NOW;

const CYCLE = Object.freeze({
  id: 7,
  annual_cap_cents: 10000000,    // $100,000
  discount_bps: 2000,            // 20%
  discount_cap_cents: 2000000,   // $20,000
  cycle_end: '2027-09-15'
});

const price = (over = {}) => B.priceAdPurchase({
  grossCents: 100000, spentNetCents: 0, discountUsedCents: 0, billing: CYCLE, ...over
});

/* ------------------------------------------------------------- the maths */

test('a normal purchase gets the full rate discount', () => {
  const r = price({ grossCents: 100000 });          // $1,000
  assert.equal(r.discountCents, 20000);             // $200
  assert.equal(r.netCents, 80000);                  // $800
  assert.equal(r.grossCents - r.discountCents, r.netCents, 'the schema CHECK must hold');
});

test('the discount rounds DOWN, so rounding never costs revenue', () => {
  /* 999 * 2000 / 10000 = 199.8 */
  const r = price({ grossCents: 999 });
  assert.equal(r.discountCents, 199);
  assert.equal(r.netCents, 800);
});

test('the discount stops at its own cap, and the purchase still completes', () => {
  const r = price({ grossCents: 100000, discountUsedCents: 1995000 });   // $50 headroom
  assert.equal(r.discountCents, 5000, 'capped at the remaining headroom');
  assert.equal(r.netCents, 95000, 'the rest is charged at list');
});

test('with the discount cap fully used, purchases price at list', () => {
  const r = price({ grossCents: 100000, discountUsedCents: 2000000 });
  assert.equal(r.discountCents, 0);
  assert.equal(r.netCents, 100000);
});

test('a discount can never exceed the purchase it discounts', () => {
  const cheap = B.priceAdPurchase({
    grossCents: 1, spentNetCents: 0, discountUsedCents: 0,
    billing: { ...CYCLE, discount_bps: 10000 }        // 100% off
  });
  assert.equal(cheap.discountCents, 1);
  assert.equal(cheap.netCents, 0);
  assert.ok(cheap.netCents >= 0, 'never negative');
});

test('the cap is on what is CHARGED, so a discount buys more inventory', () => {
  /* A cap applied to GROSS would cancel the discount's value. Applied to net,
   * $120,000 of list price: the discount cap ($20,000) binds, leaving exactly
   * $100,000 to charge — the whole annual cap, spent on more inventory than an
   * undiscounted cap would have bought. */
  const r = price({ grossCents: 12000000 });
  assert.equal(r.discountCents, 2000000, 'the discount cap binds before the rate');
  assert.equal(r.netCents, 10000000, 'exactly the annual cap');

  /* One cent more of list price and the charge would exceed the cap. */
  assert.throws(() => price({ grossCents: 12000100 }), /exceeds the remaining annual cap/);
});

/* ------------------------------------------------------------ the caps */

test('a purchase beyond the cap is REJECTED with what remains, not clamped', () => {
  /* Clamping would charge them a different number than they asked for. */
  try {
    price({ grossCents: 5000000, spentNetCents: 9900000 });   // $1,000 left
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.code, 'cap_exceeded');
    assert.equal(error.remainingCents, 100000);
  }
});

test('an exhausted cap refuses before any arithmetic', () => {
  /* assert.throws returns undefined — capture the error to inspect it. */
  try {
    price({ spentNetCents: 10000000 });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.code, 'cap_exceeded');
    assert.equal(error.remainingCents, 0);
  }
});

test('a purchase landing exactly on the cap is allowed', () => {
  const r = price({ grossCents: 125000, spentNetCents: 9900000 });
  assert.equal(r.netCents, 100000, 'exactly the remaining $1,000');
});

test('over-refunding cannot mint headroom above the cap', () => {
  /* Corrections can drive the sums negative; clamping means a heavily refunded
   * cycle still cannot spend more than the cap ever allowed. */
  const r = price({ grossCents: 100000, spentNetCents: -5000000, discountUsedCents: -900000 });
  assert.equal(r.discountCents, 20000, 'headroom is not inflated by refunds');
  assert.equal(r.netCents, 80000);
});

test('non-integer or non-positive amounts are refused', () => {
  /* '100' is in this list deliberately: a string amount must be refused, not
   * coerced — see requireCents. */
  for (const bad of [0, -1, 1.5, NaN, '100', null, undefined]) {
    assert.throws(() => price({ grossCents: bad }), TypeError);
  }
});

test('a cycle with broken caps is refused rather than priced', () => {
  assert.throws(() => B.priceAdPurchase({
    grossCents: 1000, spentNetCents: 0, discountUsedCents: 0,
    billing: { ...CYCLE, annual_cap_cents: 'lots' }
  }), /non-integer caps/);
  assert.throws(() => B.priceAdPurchase({
    grossCents: 1000, spentNetCents: 0, discountUsedCents: 0, billing: null
  }), /billing cycle is required/);
});

/* ------------------------------------------------------------ proration */

test('a full cycle is not prorated', () => {
  const r = B.prorateCaps({
    annualCapCents: 10000000, discountCapCents: 2000000,
    cycleStart: '2026-01-01', cycleEnd: '2027-01-01', activeFrom: '2026-01-01'
  });
  assert.equal(r.annualCapCents, 10000000);
});

test('a mid-cycle start prorates DOWN', () => {
  /* Half a year in, and rounding down: a full year of cap for six months is the
   * expensive direction to be wrong in. */
  const r = B.prorateCaps({
    annualCapCents: 10000000, discountCapCents: 2000000,
    cycleStart: '2026-01-01', cycleEnd: '2027-01-01', activeFrom: '2026-07-02'
  });
  assert.ok(r.annualCapCents < 5100000 && r.annualCapCents > 4900000, `got ${r.annualCapCents}`);
  assert.ok(r.discountCapCents < r.annualCapCents);
  assert.ok(Number.isSafeInteger(r.annualCapCents), 'cents stay integers');
});

test('activating before the cycle starts does not grant more than a full cycle', () => {
  const r = B.prorateCaps({
    annualCapCents: 10000000, discountCapCents: 2000000,
    cycleStart: '2026-01-01', cycleEnd: '2027-01-01', activeFrom: '2025-06-01'
  });
  assert.equal(r.annualCapCents, 10000000, 'ratio is clamped at 1');
});

test('activating after the cycle ends grants nothing', () => {
  const r = B.prorateCaps({
    annualCapCents: 10000000, discountCapCents: 2000000,
    cycleStart: '2026-01-01', cycleEnd: '2027-01-01', activeFrom: '2028-01-01'
  });
  assert.equal(r.annualCapCents, 0);
});

test('unparseable or inverted dates are refused', () => {
  assert.throws(() => B.prorateCaps({ annualCapCents: 1, discountCapCents: 1, cycleStart: 'x', cycleEnd: 'y' }), TypeError);
  assert.throws(() => B.prorateCaps({
    annualCapCents: 1, discountCapCents: 1, cycleStart: '2027-01-01', cycleEnd: '2026-01-01'
  }), /after cycleStart/);
});

/* -------------------------------------------------------------- service */

function harness(routes = []) {
  const calls = [];
  const appended = [];
  const client = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [needle, rows] of routes) {
        if (sql.includes(needle)) return { rows: typeof rows === 'function' ? rows(params) : rows };
      }
      return { rows: [] };
    },
    release() {}
  };
  const pool = { connect: async () => client, query: client.query.bind(client) };
  const store = {
    appendChained: async (_c, row) => { appended.push(row); return { id: 99 }; }
  };
  return { pool, store, client, calls, appended };
}

const cycleRow = (over = {}) => [['FROM corporate_billing WHERE id', [{ ...CYCLE, ...over }]]];

test('a purchase locks, sums, prices and appends in one transaction', async () => {
  const h = harness([...cycleRow(), ['SUM(net_cents)', [{ net: '0', discount: '0' }]]]);
  const svc = B.createCorporateBillingService({ pool: h.pool, store: h.store, now });
  const r = await svc.purchaseAd({ corporateId: 1, billingId: 7, grossCents: 100000 });

  const sql = h.calls.map((c) => c.sql).join(' | ');
  assert.match(sql, /BEGIN/);
  assert.match(sql, /pg_advisory_xact_lock/, 'the sums must be read under the lock');
  assert.match(sql, /COMMIT/);
  assert.equal(r.netCents, 80000);
  assert.equal(h.appended.length, 1);
  assert.equal(h.appended[0].scopeKey, 7, 'chained per billing cycle');
  assert.equal(h.appended[0].table, 'corporate_ad_spend');
});

test('the lock is taken BEFORE the sums are read', async () => {
  /* Reading first and locking second leaves the cap check unprotected, which is
   * the exact race the lock exists to prevent. */
  const h = harness([...cycleRow(), ['SUM(net_cents)', [{ net: '0', discount: '0' }]]]);
  const svc = B.createCorporateBillingService({ pool: h.pool, store: h.store, now });
  await svc.purchaseAd({ corporateId: 1, billingId: 7, grossCents: 1000 });

  const order = h.calls.map((c) => c.sql);
  const lockAt = order.findIndex((s) => s.includes('pg_advisory_xact_lock'));
  const sumAt = order.findIndex((s) => s.includes('SUM(net_cents)'));
  assert.ok(lockAt >= 0 && sumAt >= 0);
  assert.ok(lockAt < sumAt, `lock (${lockAt}) must precede the sums (${sumAt})`);
});

test('a cap breach rolls back and appends nothing', async () => {
  const h = harness([...cycleRow(), ['SUM(net_cents)', [{ net: '10000000', discount: '0' }]]]);
  const svc = B.createCorporateBillingService({ pool: h.pool, store: h.store, now });
  await assert.rejects(
    () => svc.purchaseAd({ corporateId: 1, billingId: 7, grossCents: 1000 }),
    (e) => e.code === 'cap_exceeded'
  );
  assert.equal(h.appended.length, 0);
  assert.match(h.calls.map((c) => c.sql).join(' '), /ROLLBACK/);
});

test('an expired cycle cannot be spent against', async () => {
  const h = harness([...cycleRow({ cycle_end: '2026-01-01' })]);
  const svc = B.createCorporateBillingService({ pool: h.pool, store: h.store, now });
  await assert.rejects(() => svc.purchaseAd({ corporateId: 1, billingId: 7, grossCents: 1000 }), /cycle has ended/);
  assert.equal(h.appended.length, 0);
});

test('a cycle belonging to another account is not found', async () => {
  const h = harness();   // the WHERE includes corporate_id, so no row comes back
  const svc = B.createCorporateBillingService({ pool: h.pool, store: h.store, now });
  await assert.rejects(() => svc.purchaseAd({ corporateId: 2, billingId: 7, grossCents: 1000 }), /unknown billing cycle/);
});

test('the fee is recorded once and a retry is a no-op', async () => {
  const h = harness([['UPDATE corporate_billing', [{ id: 7 }]]]);
  const svc = B.createCorporateBillingService({ pool: h.pool, store: h.store, now });
  const r = await svc.markOnboardingFeePaid({ billingId: 7, stripePaymentIntent: 'pi_123' });
  assert.equal(r.applied, true);
  assert.match(h.calls[0].sql, /onboarding_paid_at IS NULL/, 'a retry must not move the timestamp');

  const h2 = harness();   // no row updated
  const svc2 = B.createCorporateBillingService({ pool: h2.pool, store: h2.store, now });
  assert.equal((await svc2.markOnboardingFeePaid({ billingId: 7, stripePaymentIntent: 'pi_123' })).applied, false);
});

test('a correction must be negative and must say why', async () => {
  const h = harness();
  const svc = B.createCorporateBillingService({ pool: h.pool, store: h.store, now });
  await assert.rejects(() => svc.recordCorrection({
    corporateId: 1, billingId: 7, grossCents: 1000, reason: 'refund'
  }), /must be negative/);
  await assert.rejects(() => svc.recordCorrection({
    corporateId: 1, billingId: 7, grossCents: -1000, reason: ''
  }), /must state a reason/);
});

test('a correction appends a negative row, never an update', async () => {
  const h = harness();
  const svc = B.createCorporateBillingService({ pool: h.pool, store: h.store, now });
  await svc.recordCorrection({
    corporateId: 1, billingId: 7, grossCents: -100000, discountCents: -20000, reason: 'chargeback'
  });
  const row = h.appended[0].fields;
  assert.equal(row.gross_cents, -100000);
  assert.equal(row.net_cents, -80000, 'net = gross - discount still holds for corrections');
  assert.equal(row.provenance.reason, 'chargeback');
  assert.ok(!h.calls.some((c) => /UPDATE corporate_ad_spend|DELETE FROM corporate_ad_spend/.test(c.sql)),
    'the ledger is append-only');
});

test('the summary derives every balance and caches nothing', async () => {
  const h = harness([
    ['FROM corporate_billing WHERE id', [{ ...CYCLE, cycle_start: '2026-09-15', onboarding_paid_at: new Date(NOW) }]],
    ['SUM(net_cents)', [{ net: '2500000', discount: '500000' }]]
  ]);
  const svc = B.createCorporateBillingService({ pool: h.pool, store: h.store, now });
  const s = await svc.cycleSummary(7);
  assert.equal(s.spentNetCents, 2500000);
  assert.equal(s.remainingCents, 7500000);
  assert.equal(s.discountUsedCents, 500000);
  assert.equal(s.discountRemainingCents, 1500000);
  assert.equal(s.onboardingPaid, true);
});

test('the service refuses to start without a chaining store', () => {
  assert.throws(() => B.createCorporateBillingService({ pool: {} }), /appendChained/);
  assert.throws(() => B.createCorporateBillingService({ store: { appendChained() {} } }), /database pool/);
});

/* ------------------------------------------------ ledger rows vs the schema */

/* The harness store above accepts anything, which is how real bugs got past
 * this file: rows missing the provenance block evidence-store requires, and a
 * column omitted from the hash. Either makes a real append throw or a real
 * verifyChain fail. These tests read the column list from migration 017
 * itself, so a column added there without being written here fails loudly.
 * (BIGINT spelling is normalized inside evidence-store and tested there.) */

const fs = require('node:fs');
const path = require('node:path');

function spendColumns() {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'group-subs', 'migrations', '017_corporate_accounts_up.sql'), 'utf8');
  const body = sql.slice(sql.indexOf('CREATE TABLE corporate_ad_spend ('));
  /* CRLF-tolerant: a Windows checkout rewrites line endings. */
  const block = body.slice(0, body.search(/\r?\n\);/));
  const columns = new Map();
  for (const line of block.split(/\r?\n/).slice(1)) {
    const m = /^\s{2}([a-z_]+)\s+([A-Z]+)/.exec(line);
    if (m && m[1] !== 'CONSTRAINT') columns.set(m[1], m[2]);
  }
  return columns;
}

async function writtenRows() {
  const purchase = harness([
    ['FROM corporate_billing WHERE id', [CYCLE]],
    ['SUM(net_cents)', [{ net: '0', discount: '0' }]]
  ]);
  await B.createCorporateBillingService({ pool: purchase.pool, store: purchase.store, now })
    .purchaseAd({ corporateId: 1, billingId: 7, grossCents: 100000, stripeChargeId: 'ch_1' });

  const correction = harness();
  await B.createCorporateBillingService({ pool: correction.pool, store: correction.store, now })
    .recordCorrection({ corporateId: 1, billingId: 7, grossCents: -100000, discountCents: -20000,
      reason: 'refund', stripeChargeId: 'ch_1', stripeRefundId: 're_1' });

  return { purchase: purchase.appended[0].fields, correction: correction.appended[0].fields };
}

test('both ledger writers supply every column of corporate_ad_spend', async () => {
  /* verifyChain hashes SELECT *, so a column the writer omits reads back as
   * null and the chain never verifies. */
  const columns = spendColumns();
  assert.ok(columns.size >= 14, `parsed ${columns.size} columns — the migration parser is broken`);
  const rows = await writtenRows();
  for (const [kind, fields] of Object.entries(rows)) {
    for (const column of columns.keys()) {
      if (['id', 'integrity_hash', 'prev_hash'].includes(column)) continue;
      assert.ok(Object.prototype.hasOwnProperty.call(fields, column), `${kind} row omits ${column}`);
    }
  }
});

test('both ledger writers carry the provenance evidence-store requires', async () => {
  const rows = await writtenRows();
  for (const [kind, fields] of Object.entries(rows)) {
    for (const required of ['source', 'occurred_at', 'received_at']) {
      assert.ok(fields[required] != null, `${kind} row is missing ${required}`);
    }
  }
});

test('a refund never reuses the UNIQUE charge id of the purchase it refunds', async () => {
  const { purchase, correction } = await writtenRows();
  assert.equal(purchase.stripe_charge_id, 'ch_1');
  assert.equal(correction.stripe_charge_id, null, 'would collide with the purchase row');
  assert.equal(correction.provenance.reverses_charge, 'ch_1', 'the link is kept in provenance');
  assert.equal(correction.source_event_id, 're_1');
});
