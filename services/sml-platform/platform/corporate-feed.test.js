/* Corporate feed placement.  Run: node --test  (services/sml-platform/platform)
 *
 * The rules that cost money if they break are the ones about NOT showing
 * something: fail-closed on empty inventory, the frequency cap, the hide
 * suppression, and the holdout. Those get the most tests here.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./corporate-feed.js');

const NOW = Date.parse('2026-09-15T12:00:00Z');
const now = () => NOW;
const ago = (ms) => new Date(NOW - ms).toISOString();
const HOUR = 3600 * 1000;

const CORP = 42;

function item(over = {}) {
  return {
    id: 'c1', corporateId: CORP, score: 10, category: 'finance',
    tickers: ['AAPL'], engagementRate7d: 0.5, publishedAt: ago(HOUR), ...over
  };
}

function user(over = {}) {
  return {
    id: 258457500, watchlist: ['AAPL', 'TSLA'],
    onboardingProfile: { categoryAffinity: { finance: 1 } }, ...over
  };
}

function context(over = {}) {
  return {
    activeCorporateIds: new Set([CORP]),
    hiddenSources: new Map(),
    slotsShownToday: new Map(),
    slotEligibleUsedToday: new Map(),
    accounts: new Map([[CORP, { active: true, metrics: {} }]]),
    ...over
  };
}

/* ------------------------------------------------------------- relevance */

test('the four relevance terms sum to at most 1 and stay in range', () => {
  const perfect = F.relevance(item({ engagementRate7d: 1, publishedAt: ago(0) }), user(), { now });
  assert.ok(perfect <= 1 && perfect > 0.99, `got ${perfect}`);

  const nothing = F.relevance(
    { tickers: [], category: 'news', engagementRate7d: 0, publishedAt: ago(365 * 24 * HOUR) },
    { watchlist: [] }, { now }
  );
  assert.equal(nothing, 0);
});

test('ticker overlap is the heaviest term', () => {
  const withOverlap = F.relevance(item({ engagementRate7d: 0 }), user(), { now });
  const without = F.relevance(item({ tickers: ['NVDA'], engagementRate7d: 0 }), user(), { now });
  assert.ok(withOverlap - without > 0.4, 'overlap is worth ~0.45');
});

test('overlap is case-insensitive and fractional', () => {
  assert.equal(F.tickerOverlap(['aapl'], ['AAPL']), 1);
  assert.equal(F.tickerOverlap(['AAPL', 'NVDA'], new Set(['AAPL'])), 0.5);
  assert.equal(F.tickerOverlap([], ['AAPL']), 0);
  assert.equal(F.tickerOverlap(['AAPL'], []), 0, 'an empty watchlist is not an error');
  assert.equal(F.tickerOverlap(null, null), 0);
});

test('recency halves every six hours and never goes negative', () => {
  assert.equal(F.recencyDecay(0), 1);
  assert.ok(Math.abs(F.recencyDecay(6 * HOUR) - 0.5) < 1e-9);
  assert.equal(F.recencyDecay(-1), 0, 'a future timestamp scores zero, not >1');
  assert.equal(F.recencyDecay(Infinity), 0);
});

test('a malformed engagement rate cannot inflate relevance', () => {
  /* A bad metrics row must not become a ranking advantage. */
  const r = F.relevance(item({ engagementRate7d: 99, tickers: [], category: null,
    publishedAt: ago(365 * 24 * HOUR) }), { watchlist: [] }, { now });
  assert.ok(r <= 0.2, `clamped, got ${r}`);
});

/* ----------------------------------------------------------- eligibility */

test('a relevant, fresh item from an active account is eligible', () => {
  assert.equal(F.slotRejection(item(), user(), context(), { now }), null);
});

test('each gate reports itself by name', () => {
  const cases = [
    ['not_corporate', item({ corporateId: null }), context()],
    ['not_active', item(), context({ activeCorporateIds: new Set() })],
    ['stale', item({ publishedAt: ago(25 * HOUR) }), context()],
    ['user_hid_source', item(), context({ hiddenSources: new Map([[CORP, NOW - HOUR]]) })],
    ['user_frequency_cap', item(), context({ slotsShownToday: new Map([[CORP, 2]]) })],
    ['account_daily_cap', item(), context({ slotEligibleUsedToday: new Map([[CORP, 5]]) })],
    ['below_relevance_floor', item({ tickers: ['NVDA'], category: 'news', engagementRate7d: 0,
      publishedAt: ago(20 * HOUR) }), context()]
  ];
  for (const [expected, it, ctx] of cases) {
    assert.equal(F.slotRejection(it, user(), ctx, { now }), expected);
  }
});

test('a hide expires after seven days, and outranks a perfect score', () => {
  const hidden = context({ hiddenSources: new Map([[CORP, NOW - 6 * 24 * HOUR]]) });
  assert.equal(F.slotRejection(item({ engagementRate7d: 1 }), user(), hidden, { now }),
    'user_hid_source', 'no relevance score overrides an explicit hide');

  const expired = context({ hiddenSources: new Map([[CORP, NOW - 8 * 24 * HOUR]]) });
  assert.equal(F.slotRejection(item(), user(), expired, { now }), null);
});

test('a future-dated item is refused rather than scored as brand new', () => {
  assert.equal(F.slotRejection(item({ publishedAt: ago(-HOUR) }), user(), context(), { now }), 'stale');
  assert.equal(F.slotRejection(item({ publishedAt: 'not a date' }), user(), context(), { now }), 'stale');
  assert.equal(F.slotRejection(item({ publishedAt: null }), user(), context(), { now }), 'stale');
});

test('the item at exactly 24h is out, one second under is in', () => {
  assert.equal(F.slotRejection(item({ publishedAt: ago(24 * HOUR) }), user(), context(), { now }), 'stale');
  assert.equal(F.slotRejection(item({ publishedAt: ago(24 * HOUR - 1000) }), user(), context(), { now }), null);
});

/* -------------------------------------------------------------- selection */

test('the highest-relevance eligible item wins', () => {
  const pick = F.selectSlotItem([
    item({ id: 'a', tickers: ['NVDA'], engagementRate7d: 0.1 }),
    item({ id: 'b', tickers: ['AAPL'], engagementRate7d: 1 })
  ], user(), context(), { now });
  assert.equal(pick.id, 'b');
});

test('selection is stable when relevance ties', () => {
  const args = [[item({ id: 'zz' }), item({ id: 'aa' })], user(), context(), { now }];
  assert.equal(F.selectSlotItem(...args).id, 'aa');
  assert.equal(F.selectSlotItem(...args).id, 'aa', 'same inputs, same pick, every time');
});

test('no eligible inventory returns null, never a substitute', () => {
  assert.equal(F.selectSlotItem([], user(), context(), { now }), null);
  assert.equal(F.selectSlotItem([item({ corporateId: 999 })], user(), context(), { now }), null);
  assert.equal(F.selectSlotItem(null, user(), context(), { now }), null);
});

/* ------------------------------------------------------------- the holdout */

test('the holdout is about a tenth of users and perfectly stable', () => {
  let held = 0;
  for (let id = 1; id <= 20000; id += 1) if (F.isHeldOut(id)) held += 1;
  const share = held / 20000;
  assert.ok(share > 0.085 && share < 0.115, `expected ~10%, got ${(share * 100).toFixed(2)}%`);

  for (const id of [1, 7, 258457500, 999999]) {
    assert.equal(F.isHeldOut(id), F.isHeldOut(id), 'the same user forever');
  }
});

test('an unknown user is held out, so a broken session id cannot burn inventory', () => {
  for (const bad of [null, undefined, 0, -1, 'abc', NaN, 1.5]) {
    assert.equal(F.isHeldOut(bad), true, `${String(bad)} must not be served a slot`);
  }
});

test('a different salt produces a different assignment', () => {
  const a = [];
  const b = [];
  for (let id = 1; id <= 200; id += 1) {
    a.push(F.isHeldOut(id));
    b.push(F.isHeldOut(id, { salt: 'other' }));
  }
  assert.notDeepEqual(a, b, 'which is exactly why the salt is not a tunable');
});

/* --------------------------------------------------------------- the boost */

test('an active corporate account ranks at 1.5x', () => {
  assert.equal(F.boostFor({ active: true }, {}), 1.5);
});

test('promo does not stack on top of the corporate boost', () => {
  assert.equal(F.boostFor({ active: true, promoted: true }, {}), 1.5,
    '1.5 and 1.5 is 1.5 here, not 2.25');
});

test('a suspended account gets no boost at all', () => {
  assert.equal(F.boostFor({ active: false, promoted: true }, {}), 1);
});

test('a hide rate over 8% demotes to 1.0 without anyone deciding', () => {
  const metrics = { slotImpressions: 1000, organicImpressions: 0, hides: 81 };
  assert.equal(F.boostFor({ active: true }, metrics), 1);
  assert.equal(F.boostFor({ active: true }, { ...metrics, hides: 80 }), 1.5, 'exactly 8% is not over');
});

test('a new account cannot be demoted by a couple of hides on a handful of views', () => {
  assert.equal(F.boostFor({ active: true }, { slotImpressions: 10, hides: 10 }), 1.5);
});

/* ---------------------------------------------------------------- the feed */

test('the flag off means no slot, and organic ranking still applies', () => {
  const r = F.buildFeed({ user: user(), items: [item(), { id: 'x', score: 12 }],
    context: context(), enabled: false }, { now });
  assert.equal(r.slot, null);
  assert.equal(r.reason, 'disabled');
  assert.equal(r.items[0].id, 'c1', '10 * 1.5 outranks 12');
  assert.equal(r.items[0].rank, 15);
});

test('a held-out user never sees the slot, and the reason says so', () => {
  let heldId = null;
  for (let id = 1; heldId === null && id < 500; id += 1) if (F.isHeldOut(id)) heldId = id;
  const r = F.buildFeed({ user: user({ id: heldId }), items: [item()],
    context: context(), enabled: true }, { now });
  assert.equal(r.slot, null);
  assert.equal(r.reason, 'holdout');
});

test('with no eligible inventory the feed is returned unpromoted', () => {
  const r = F.buildFeed({ user: user(), items: [{ id: 'x', score: 5 }],
    context: context(), enabled: true }, { now });
  assert.equal(r.slot, null);
  assert.equal(r.reason, 'no_candidates');
  assert.equal(r.items.length, 1);
  assert.ok(!r.items.some((i) => i.promoted), 'nothing is ever dressed as promoted to fill the slot');
});

test('the slot lands at index 4 and the item is not duplicated', () => {
  const organic = Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, score: 100 - i }));
  const r = F.buildFeed({ user: user(), items: [...organic, item()],
    context: context(), enabled: true }, { now });

  assert.equal(r.items[F.SLOT_INDEX].id, 'c1');
  assert.equal(r.items[F.SLOT_INDEX].promoted, true);
  assert.equal(r.items.filter((i) => i.id === 'c1').length, 1, 'inserted once, not twice');
  assert.equal(r.items.length, 11);
});

test('a short feed puts the slot at the end rather than past it', () => {
  const r = F.buildFeed({ user: user(), items: [{ id: 'o1', score: 100 }, item()],
    context: context(), enabled: true }, { now });
  assert.equal(r.items.length, 2);
  assert.equal(r.items[1].id, 'c1');
  assert.equal(r.items[1].promoted, true);
});

test('only the promoted copy carries the promoted flag', () => {
  const r = F.buildFeed({ user: user(), items: [item(), { id: 'o1', score: 1 }],
    context: context(), enabled: true }, { now });
  assert.equal(r.items.filter((i) => i.promoted).length, 1);
});

test('a demoted account loses its organic advantage too, not just the slot', () => {
  const ctx = context({
    accounts: new Map([[CORP, { active: true, metrics: { slotImpressions: 1000, hides: 200 } }]])
  });
  const r = F.buildFeed({ user: user(), items: [item(), { id: 'x', score: 12 }],
    context: ctx, enabled: false }, { now });
  assert.equal(r.items[0].id, 'x', 'no boost, so 12 beats 10');
});

test('a feed with no corporate content is passed through ranked', () => {
  const r = F.buildFeed({ user: user(), items: [{ id: 'a', score: 1 }, { id: 'b', score: 9 }],
    context: context(), enabled: true }, { now });
  assert.deepEqual(r.items.map((i) => i.id), ['b', 'a']);
  assert.equal(r.items[0].rank, 9, 'an ordinary post is multiplied by 1');
});

test('empty and malformed input does not throw', () => {
  assert.deepEqual(F.buildFeed({}, { now }), { items: [], slot: null, reason: 'disabled' });
  const r = F.buildFeed({ user: user(), items: [null, undefined], context: context(), enabled: true }, { now });
  assert.equal(r.items.length, 0);
});

/* ---------------------------------------------------------- the reach rate */

test('reach counts sessions with a corporate card inside the first 20', () => {
  const r = F.reachRate([
    { corporatePositions: [4] },
    { corporatePositions: [19] },
    { corporatePositions: [20] },      // outside the window
    { corporatePositions: [] }
  ]);
  assert.equal(r.measuredSessions, 4);
  assert.equal(r.exposedSessions, 2);
  assert.equal(r.rate, 0.5);
});

test('held-out sessions are reported separately, not averaged in', () => {
  /* Counting the control arm as unexposed would understate reach AND destroy
   * the comparison the holdout exists to provide. */
  const r = F.reachRate([
    { corporatePositions: [4] },
    { heldOut: true, corporatePositions: [] },
    { heldOut: true, corporatePositions: [] }
  ]);
  assert.equal(r.rate, 1);
  assert.equal(r.measuredSessions, 1);
  assert.equal(r.heldOutSessions, 2);
});

test('no sessions is a rate of zero, not a divide by zero', () => {
  assert.equal(F.reachRate([]).rate, 0);
  assert.equal(F.reachRate(null).rate, 0);
  assert.equal(F.reachRate([{ heldOut: true }]).rate, 0);
});
