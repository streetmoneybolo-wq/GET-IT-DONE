/* Corporate promotions.  Run: node --test  (services/sml-platform/platform)
 *
 * The rules worth testing are the ones that would hand out a boost nobody paid
 * for: a promotion against another account's purchase, against a refund, on a
 * suspended account, or one that keeps delivering after its window closed.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./corporate-promo.js');

const NOW = Date.parse('2026-09-15T12:00:00Z');
const now = () => NOW;
const HOUR = 3600 * 1000;
const at = (ms) => new Date(NOW + ms).toISOString();

/* ------------------------------------------------------------ item refs */

test('the feed\'s mixed id shapes survive unchanged', () => {
  /* chart-* and stream-* are real ids on this feed; parsing them as numbers
   * has broken it before. */
  for (const ref of ['12345', 'chart-98f2', 'stream-2026-09-15:3', 'letter.441']) {
    assert.equal(P.normalizeItemRef(ref), ref);
  }
  assert.equal(P.normalizeItemRef('  chart-1  '), 'chart-1');
});

test('an item ref that the feed would never emit is refused', () => {
  for (const bad of ['', '   ', null, undefined, 'a b', '<script>', 'x'.repeat(200), 'drop;--']) {
    assert.throws(() => P.normalizeItemRef(bad), TypeError, `accepted ${JSON.stringify(bad)}`);
  }
});

/* -------------------------------------------------------------- windows */

test('a normal forward window validates', () => {
  const w = P.validateWindow({ startsAt: at(HOUR), endsAt: at(25 * HOUR) }, { now });
  assert.equal(w.startsAt, new Date(NOW + HOUR).toISOString());
});

test('a window that already ended is refused, not stored as finished', () => {
  /* Storing it would record a campaign as complete before it ran — an
   * advertiser charged for nothing, silently. */
  assert.throws(() => P.validateWindow({ startsAt: at(-48 * HOUR), endsAt: at(-HOUR) }, { now }),
    /already ended/);
});

test('an inverted or zero-length window is refused', () => {
  assert.throws(() => P.validateWindow({ startsAt: at(HOUR), endsAt: at(HOUR) }, { now }), /after startsAt/);
  assert.throws(() => P.validateWindow({ startsAt: at(5 * HOUR), endsAt: at(HOUR) }, { now }), /after startsAt/);
});

test('an unparseable date is refused rather than becoming NaN', () => {
  assert.throws(() => P.validateWindow({ startsAt: 'soon', endsAt: at(HOUR) }, { now }), /parseable/);
  assert.throws(() => P.validateWindow({ startsAt: at(0), endsAt: null }, { now }), /parseable/);
});

test('a promotion cannot run for a year', () => {
  assert.throws(() => P.validateWindow({ startsAt: at(0), endsAt: at(200 * 24 * HOUR) }, { now }),
    /may not run longer than 90 days/);
  assert.doesNotThrow(() => P.validateWindow({ startsAt: at(0), endsAt: at(89 * 24 * HOUR) }, { now }));
});

test('a window already underway is fine — only an ENDED one is refused', () => {
  assert.doesNotThrow(() => P.validateWindow({ startsAt: at(-HOUR), endsAt: at(HOUR) }, { now }));
});

/* --------------------------------------------------------------- status */

test('status is derived from the clock, not from the stored column', () => {
  /* A failed sweep leaves rows stuck 'running' after they were paid to stop,
   * and a boost nobody is paying for is never reported by the advertiser. */
  const promo = { status: 'running', starts_at: at(-2 * HOUR), ends_at: at(-HOUR) };
  assert.equal(P.statusAt(promo, NOW), 'finished');
  assert.equal(P.isLive(promo, NOW), false);
});

test('scheduled, running and finished each resolve from the window', () => {
  const p = (s, e) => ({ status: 'scheduled', starts_at: at(s), ends_at: at(e) });
  assert.equal(P.statusAt(p(HOUR, 2 * HOUR), NOW), 'scheduled');
  assert.equal(P.statusAt(p(-HOUR, HOUR), NOW), 'running');
  assert.equal(P.statusAt(p(-2 * HOUR, -HOUR), NOW), 'finished');
});

test('cancelled stays cancelled whatever the window says', () => {
  assert.equal(P.statusAt({ status: 'cancelled', starts_at: at(-HOUR), ends_at: at(HOUR) }, NOW), 'cancelled');
  assert.equal(P.isLive({ status: 'cancelled', starts_at: at(-HOUR), ends_at: at(HOUR) }, NOW), false);
});

test('the boundaries are half-open: live at the start instant, done at the end', () => {
  const p = { status: 'running', starts_at: at(0), ends_at: at(HOUR) };
  assert.equal(P.statusAt(p, NOW), 'running');
  assert.equal(P.statusAt(p, NOW + HOUR), 'finished', 'the end instant is not still running');
});

test('a corrupt row reads as finished rather than delivering forever', () => {
  assert.equal(P.statusAt({ status: 'running', starts_at: 'x', ends_at: 'y' }, NOW), 'finished');
});

/* -------------------------------------------------------------- harness */

function harness(routes = []) {
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
  return {
    calls,
    pool: { connect: async () => client, query: client.query }
  };
}

const ACTIVE = [['FROM corporate_accounts WHERE id', [{ id: 7, status: 'active' }]]];
const PAID = [['FROM corporate_ad_spend WHERE id', [{ id: 55, corporate_id: 7, net_cents: 80000 }]]];
const INSERTED = [['INSERT INTO corporate_promotions', [{ id: 1, item_ref: 'chart-1' }]]];

const GOOD = { corporateId: 7, spendId: 55, itemRef: 'chart-1', startsAt: at(HOUR), endsAt: at(25 * HOUR) };

/* ------------------------------------------------------------- scheduling */

test('a paid placement on an active account is scheduled', async () => {
  const h = harness([...ACTIVE, ...PAID, ...INSERTED]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  const row = await svc.schedule(GOOD);
  assert.equal(row.id, 1);
  assert.ok(h.calls.some((c) => c.sql === 'COMMIT'));
});

test('a placement starting now is inserted as running, not scheduled', async () => {
  const h = harness([...ACTIVE, ...PAID, ...INSERTED]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  await svc.schedule({ ...GOOD, startsAt: at(-HOUR) });
  const insert = h.calls.find((c) => c.sql.includes('INSERT INTO corporate_promotions'));
  assert.equal(insert.params[5], 'running');
});

test('a suspended account cannot queue a placement for its reinstatement', async () => {
  const h = harness([['FROM corporate_accounts WHERE id', [{ id: 7, status: 'suspended' }]], ...PAID]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  await assert.rejects(() => svc.schedule(GOOD), (e) => e.code === 'not_active');
  assert.ok(h.calls.some((c) => c.sql === 'ROLLBACK'));
});

test('a promotion against another account\'s purchase is refused', async () => {
  /* The foreign key alone does not check ownership — this would be a free
   * boost paid for by someone else. */
  const h = harness([...ACTIVE, ['FROM corporate_ad_spend WHERE id', [{ id: 55, corporate_id: 999, net_cents: 80000 }]]]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  await assert.rejects(() => svc.schedule(GOOD), (e) => e.code === 'spend_mismatch');
});

test('a promotion backed by a refund is refused', async () => {
  /* Corrections are appended as negative rows; promoting against one is a
   * placement paid for by a refund. */
  const h = harness([...ACTIVE, ['FROM corporate_ad_spend WHERE id', [{ id: 55, corporate_id: 7, net_cents: -80000 }]]]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  await assert.rejects(() => svc.schedule(GOOD), (e) => e.code === 'spend_not_a_purchase');

  const zero = harness([...ACTIVE, ['FROM corporate_ad_spend WHERE id', [{ id: 55, corporate_id: 7, net_cents: 0 }]]]);
  await assert.rejects(
    () => P.createCorporatePromoService({ pool: zero.pool, now }).schedule(GOOD),
    (e) => e.code === 'spend_not_a_purchase'
  );
});

test('a placement with no purchase behind it is refused', async () => {
  const h = harness([...ACTIVE, ['FROM corporate_ad_spend WHERE id', []]]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  await assert.rejects(() => svc.schedule(GOOD), (e) => e.code === 'spend_not_found');
});

test('a double-booked item is refused by the index, not by a prior read', async () => {
  /* Two concurrent schedules would both pass a SELECT check. */
  const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
  const h = harness([...ACTIVE, ...PAID, ['INSERT INTO corporate_promotions', dup]]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  await assert.rejects(() => svc.schedule(GOOD), (e) => e.code === 'already_promoted');
});

test('an unknown account is refused before anything is read about money', async () => {
  const h = harness([['FROM corporate_accounts WHERE id', []]]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  await assert.rejects(() => svc.schedule(GOOD), (e) => e.code === 'not_found');
  assert.ok(!h.calls.some((c) => c.sql.includes('corporate_ad_spend')));
});

test('bad input is refused before a connection is taken', async () => {
  const h = harness([...ACTIVE, ...PAID, ...INSERTED]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  for (const bad of [{}, { ...GOOD, corporateId: 0 }, { ...GOOD, spendId: null },
    { ...GOOD, itemRef: '' }, { ...GOOD, endsAt: at(-HOUR) }]) {
    await assert.rejects(() => svc.schedule(bad));
  }
  assert.equal(h.calls.length, 0, 'nothing touched the database');
});

test('the account row is locked before its status is trusted', async () => {
  const h = harness([...ACTIVE, ...PAID, ...INSERTED]);
  await P.createCorporatePromoService({ pool: h.pool, now }).schedule(GOOD);
  const read = h.calls.find((c) => c.sql.includes('FROM corporate_accounts WHERE id'));
  assert.match(read.sql, /FOR UPDATE/, 'otherwise a concurrent suspend races the insert');
});

/* ----------------------------------------------------------- cancellation */

test('a cancellation records its reason', async () => {
  const h = harness([['UPDATE corporate_promotions', [{ id: 1, status: 'cancelled' }]]]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  const row = await svc.cancel({ promotionId: 1, reason: 'advertiser request' });
  assert.equal(row.status, 'cancelled');
  const call = h.calls.find((c) => c.sql.includes('UPDATE'));
  assert.equal(call.params[2], 'advertiser request');
});

test('a cancellation without a reason is refused', async () => {
  const h = harness([['UPDATE corporate_promotions', [{ id: 1 }]]]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  for (const reason of [undefined, '', '   ', null]) {
    await assert.rejects(() => svc.cancel({ promotionId: 1, reason }), /reason is required/);
  }
  assert.equal(h.calls.length, 0);
});

test('cancelling twice is refused rather than silently succeeding', async () => {
  const h = harness([['UPDATE corporate_promotions', []]]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  await assert.rejects(() => svc.cancel({ promotionId: 1, reason: 'again' }),
    (e) => e.code === 'not_cancellable');
});

test('cancelling moves no money', async () => {
  /* Refunds go through billing\'s recordCorrection. Two systems in charge of
   * one number is how ledgers stop reconciling. */
  const h = harness([['UPDATE corporate_promotions', [{ id: 1 }]]]);
  await P.createCorporatePromoService({ pool: h.pool, now }).cancel({ promotionId: 1, reason: 'x' });
  assert.ok(!h.calls.some((c) => /ad_spend|cents|stripe/i.test(c.sql)));
});

/* ------------------------------------------------------------------ live */

test('live promotions are filtered by the clock as well as by status', async () => {
  const rows = [
    { id: 1, corporate_id: 7, item_ref: 'a', status: 'running', starts_at: at(-HOUR), ends_at: at(HOUR) },
    { id: 2, corporate_id: 7, item_ref: 'b', status: 'running', starts_at: at(-3 * HOUR), ends_at: at(-HOUR) },
    { id: 3, corporate_id: 8, item_ref: 'c', status: 'scheduled', starts_at: at(HOUR), ends_at: at(2 * HOUR) }
  ];
  const h = harness([['FROM corporate_promotions p', rows]]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  const live = await svc.livePromotions();

  assert.deepEqual([...live.items], ['a'], 'the expired row is dropped despite saying running');
  assert.deepEqual([...live.corporateIds], [7]);
});

test('the live query joins on an active account', async () => {
  const h = harness([['FROM corporate_promotions p', []]]);
  await P.createCorporatePromoService({ pool: h.pool, now }).livePromotions();
  const call = h.calls[0];
  assert.match(call.sql, /a\.status = 'active'/, 'a suspended advertiser stops delivering');
});

test('no live promotions is an empty set, not a throw', async () => {
  const h = harness([['FROM corporate_promotions p', []]]);
  const live = await P.createCorporatePromoService({ pool: h.pool, now }).livePromotions();
  assert.equal(live.items.size, 0);
  assert.equal(live.promotions.length, 0);
});

/* --------------------------------------------------------------- history */

test('history answers what a purchase bought, with its charge attached', async () => {
  const h = harness([['JOIN corporate_ad_spend', [
    { id: 1, item_ref: 'a', status: 'running', starts_at: at(-HOUR), ends_at: at(HOUR), net_cents: 80000 }
  ]]]);
  const svc = P.createCorporatePromoService({ pool: h.pool, now });
  const rows = await svc.purchaseHistory(7);
  assert.equal(rows[0].effectiveStatus, 'running');
  assert.equal(rows[0].net_cents, 80000, 'what it cost sits beside what it ran');
});

test('a service needs a pool', () => {
  assert.throws(() => P.createCorporatePromoService({}), /database pool/);
});
