/* Trigger orchestrator tests. Run: node --test  (from this directory)
 * Fixtures mirror the response shapes verified live on 2026-08-22. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('./index.js');

const scannerRows = [
  { sym: 'RFAI', last: 41.56, chg: 28.83, chgPct: 22.6 },
  { sym: 'NVDA', last: 214.72, chg: 3.1, chgPct: 1.5 },      // too quiet
  { sym: 'PENNY', last: 0.04, chg: 0.02, chgPct: 80 },        // sub-penny, excluded
  { sym: 'AMD', last: 160.2, chg: -18.4, chgPct: -11.5 },
  { sym: 'BIGV', last: 22.1, chg: 1.9, chgPct: 9.4, relVol: 6.2 }
];

/* ---------- universe selection ---------- */

test('selects only real movers above the price floor', () => {
  const u = T.selectUniverse(scannerRows, { minAbsPct: 5, minPrice: 0.10, limit: 10 });
  const syms = u.map((x) => x.symbol);
  assert.ok(syms.includes('RFAI'));
  assert.ok(syms.includes('AMD'), 'downside moves count too');
  assert.ok(!syms.includes('NVDA'), '1.5% is not news');
  assert.ok(!syms.includes('PENNY'), 'sub-penny should be excluded');
});

test('the limit is respected — this is the budget guard', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ sym: 'S' + i, last: 10, chgPct: 20 + i }));
  assert.equal(T.selectUniverse(many, { limit: 12 }).length, 12);
});

test('relative volume breaks ties toward genuinely busy names', () => {
  const u = T.selectUniverse([
    { sym: 'QUIET', last: 10, chgPct: 10 },
    { sym: 'BUSY', last: 10, chgPct: 10, relVol: 8 }
  ], { limit: 2 });
  assert.equal(u[0].symbol, 'BUSY');
});

test('an empty or malformed scanner payload yields an empty universe, not a throw', () => {
  assert.deepEqual(T.selectUniverse(null), []);
  assert.deepEqual(T.selectUniverse([{}, { sym: '' }]), []);
});

/* ---------- budget ---------- */

test('budget refuses to overspend', () => {
  const b = T.createBudget({ massive: 3 });
  assert.equal(b.spend('massive'), true);
  assert.equal(b.spend('massive', 2), true);
  assert.equal(b.spend('massive'), false, 'budget was exceeded');
  assert.equal(b.remaining('massive'), 0);
});

test('budgets are independent per provider', () => {
  const b = T.createBudget({ massive: 1, moomoo: 5 });
  b.spend('massive');
  assert.equal(b.spend('massive'), false);
  assert.equal(b.spend('moomoo'), true);
});

/* ---------- short interest ---------- */

test('a high short share of tape fires', () => {
  const out = T.detectShortTriggers(
    { available: true, volume: [{ date: '2026-08-17', short: 13567620, total: 35455409, ratio: 38.3 }] },
    'NVDA', { highShortRatio: 35 });
  assert.equal(out[0].type, 'high_short_volume');
  assert.match(out[0].headline_facts[0], /38\.3% of 2026-08-17/);
});

test('an ordinary short ratio does not fire', () => {
  const out = T.detectShortTriggers(
    { available: true, volume: [{ date: '2026-08-17', ratio: 22 }] }, 'NVDA', { highShortRatio: 45 });
  assert.equal(out.length, 0);
});

test('three sessions of rising short share fires as a trend', () => {
  const out = T.detectShortTriggers({ available: true, volume: [
    { date: '2026-08-19', ratio: 41 }, { date: '2026-08-18', ratio: 37 }, { date: '2026-08-17', ratio: 33 }
  ] }, 'GME', { highShortRatio: 99 });
  assert.equal(out[0].type, 'short_interest_rising');
});

test('unavailable short data is skipped quietly', () => {
  assert.equal(T.detectShortTriggers({ available: false }, 'X').length, 0);
  assert.equal(T.detectShortTriggers(null, 'X').length, 0);
});

/* ---------- filings ---------- */

const filings = { provider: 'massive', symbol: 'NVDA', filings: [
  { form_type: '8-K', filing_date: '2026-08-17', issuer_name: 'NVIDIA CORP' },
  { form_type: '10-Q', filing_date: '2026-08-10', issuer_name: 'NVIDIA CORP' }
] };

test('filings fire with form-appropriate weight', () => {
  const out = T.detectFilingTriggers(filings, 'NVDA');
  assert.equal(out.length, 2);
  const eightK = out.find((t) => t.evidence.form_type === '8-K');
  const tenQ = out.find((t) => t.evidence.form_type === '10-Q');
  assert.ok(eightK.strength > tenQ.strength, '8-K should outrank a routine 10-Q');
});

test('a shelf registration is marked as dilution risk', () => {
  const out = T.detectFilingTriggers(
    { filings: [{ form_type: 'S-3', filing_date: '2026-08-20', issuer_name: 'TINYCO' }] }, 'TINY');
  assert.equal(out[0].evidence.dilution_risk, true);
  assert.ok(out[0].headline_facts.some((f) => /dilution/.test(f)));
});

test('already-seen filings do not fire again', () => {
  const seen = new Set(['NVDA:8-K:2026-08-17']);
  const out = T.detectFilingTriggers(filings, 'NVDA', { seenFilings: seen });
  assert.equal(out.length, 1);
  assert.equal(out[0].evidence.form_type, '10-Q');
});

/* ---------- sentiment ---------- */

test('a heat spike needs a baseline to compare against', () => {
  const rows = [{ symbol: 'NVDA', heat: 90, sentiment: 'bullish', sentiment_score: 0.8 }];
  assert.equal(T.detectSentimentTriggers(rows, {}).length, 0, 'first read is not a spike');
  assert.equal(T.detectSentimentTriggers(rows, { NVDA: 50 }, { heatJump: 20 }).length, 1);
});

/* ---------- earnings ---------- */

test('an EPS beat fires with the surprise quantified', () => {
  const out = T.detectEarningsTriggers({ eps_actual: 1.2, eps_estimate: 1.0, report_date: '2026-08-20' }, 'NVDA');
  assert.equal(out[0].evidence.beat, true);
  assert.equal(out[0].evidence.surprise_pct, 20);
});

test('earnings without both numbers is skipped rather than guessed', () => {
  assert.equal(T.detectEarningsTriggers({ eps_actual: 1.2 }, 'X').length, 0);
  assert.equal(T.detectEarningsTriggers({}, 'X').length, 0);
});

/* ---------- cooldown: the anti-spam guarantee ---------- */

test('the same filing never fires twice', () => {
  const t = T.detectFilingTriggers(filings, 'NVDA')[0];
  const seen = new Map();
  const first = T.filterCooled([t], seen, 0, 72e6, 'd1');
  assert.equal(first.kept.length, 1);
  seen.set(first.kept[0].cooldown_key, 0);
  const second = T.filterCooled([t], seen, 1000, 72e6, 'd1');
  assert.equal(second.kept.length, 0);
  assert.equal(second.suppressed.length, 1);
});

test('cooldown expires so a genuinely new day can publish', () => {
  const t = T.detectFilingTriggers(filings, 'NVDA')[0];
  const key = T.cooldownKey(t, 'd1');
  const seen = new Map([[key, 0]]);
  assert.equal(T.filterCooled([t], seen, 80e6, 72e6, 'd1').kept.length, 1);
});

test('a gamma regime flip is allowed to publish again same-day', () => {
  const pos = { type: 'gamma_positioning', symbol: 'NVDA', evidence: { regime: 'positive_gamma' } };
  const neg = { type: 'gamma_positioning', symbol: 'NVDA', evidence: { regime: 'negative_gamma' } };
  assert.notEqual(T.cooldownKey(pos, 'd1'), T.cooldownKey(neg, 'd1'));
});

test('unusual options activity is capped at one per symbol per day', () => {
  const a = { type: 'unusual_options_activity', symbol: 'NVDA', evidence: {} };
  assert.equal(T.cooldownKey(a, 'd1'), T.cooldownKey(a, 'd1'));
  assert.notEqual(T.cooldownKey(a, 'd1'), T.cooldownKey(a, 'd2'));
});

/* ---------- full cycle ---------- */

function fetchersFor(overrides = {}) {
  return Object.assign({
    scanner: async () => ({ rows: scannerRows }),
    trending: async () => [{ symbol: 'RFAI', heat: 80, sentiment: 'bullish', sentiment_score: 0.7 }],
    chain: async () => ({ symbol: 'X', underlying: 100, stale: false, freshness: 'live', contracts: [] }),
    shortData: async () => ({ available: true, volume: [{ date: '2026-08-21', ratio: 55 }] }),
    filings: async () => ({ filings: [] }),
    earnings: async () => ({})
  }, overrides);
}

test('a cycle fans in from one scanner call and returns ranked triggers', async () => {
  const r = await T.runCycle(fetchersFor(), { previousHeat: { RFAI: 40 } },
    { now: 0, dayStamp: 'd1', limits: { massive: 40, moomoo: 30, internal: 20 } });
  assert.ok(r.universe.length > 0);
  assert.ok(r.triggers.length > 0);
  for (let i = 1; i < r.triggers.length; i++) {
    assert.ok(r.triggers[i - 1].strength >= r.triggers[i].strength, 'not sorted by strength');
  }
});

test('the budget caps per-symbol calls — this is the rate-limit guarantee', async () => {
  let chainCalls = 0;
  const r = await T.runCycle(
    fetchersFor({ chain: async () => { chainCalls++; return { contracts: [], stale: false }; } }),
    {}, { limits: { moomoo: 2, massive: 2, internal: 20 }, dayStamp: 'd1' });
  assert.ok(chainCalls <= 2, `moomoo budget exceeded: ${chainCalls} calls`);
  assert.ok(r.exhausted.includes('moomoo'));
});

test('one failing symbol does not abort the cycle', async () => {
  let ok = 0;
  const r = await T.runCycle(fetchersFor({
    shortData: async (s) => { if (s === 'RFAI') throw new Error('upstream 500'); ok++; return { available: false }; }
  }), {}, { dayStamp: 'd1' });
  assert.ok(r.errors.some((e) => e.stage === 'short' && e.symbol === 'RFAI'));
  assert.ok(ok > 0, 'other symbols should still have been fetched');
  assert.ok(r.triggers.length > 0, 'cycle still produced output');
});

test('a scanner failure ends the cycle cleanly instead of throwing', async () => {
  const r = await T.runCycle(fetchersFor({ scanner: async () => { throw new Error('scanner down'); } }), {}, {});
  assert.deepEqual(r.triggers, []);
  assert.equal(r.errors[0].stage, 'scanner');
});

test('a second identical cycle publishes nothing new', async () => {
  const state = { cooldowns: new Map(), previousHeat: { RFAI: 40 } };
  const opts = { now: 0, dayStamp: 'd1', limits: { massive: 40, moomoo: 30, internal: 20 } };
  const first = await T.runCycle(fetchersFor(), state, opts);
  for (const t of first.triggers) state.cooldowns.set(t.cooldown_key, 0);

  const second = await T.runCycle(fetchersFor(), state, Object.assign({}, opts, { now: 60000 }));
  assert.equal(second.triggers.length, 0, 'duplicate articles would have been generated');
  assert.ok(second.suppressed.length > 0);
});

test('runCycle rejects missing fetchers rather than silently doing nothing', async () => {
  await assert.rejects(() => T.runCycle({}, {}, {}), TypeError);
});
