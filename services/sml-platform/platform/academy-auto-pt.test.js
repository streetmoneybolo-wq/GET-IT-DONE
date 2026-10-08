'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./academy-auto-pt');

const base = { side: 'long', price: 2.0, alignment: 0.5, sentiment: 0.3, market: 0.2, volPct: 4, levels: [], updates: 0 };

test('a new target is always between 12% and 40% beyond the live price', () => {
  for (const alignment of [-0.2, 0, 0.3, 0.6, 1]) for (const sentiment of [null, -0.3, 0.4, 1]) for (const market of [null, -0.2, 0.5, 1]) for (const volPct of [0.5, 3, 12]) for (const updates of [0, 1, 2]) {
    const r = A.proposeTarget({ ...base, alignment, sentiment, market, volPct, updates });
    if (!r.post) continue;
    assert.ok(r.target >= 2 * 1.12 - 0.006 && r.target <= 2 * 1.40 + 0.006, JSON.stringify({ alignment, sentiment, market, volPct, updates, r }));
    assert.ok(r.pct >= 11.9 && r.pct <= 40.1);
  }
});

test('shorts mirror it: 12% to 40% below the live price', () => {
  for (const alignment of [0, 0.5, 1]) {
    const r = A.proposeTarget({ ...base, side: 'short', price: 10, alignment, sentiment: -0.4, market: -0.3 });
    assert.equal(r.post, true); assert.ok(r.target <= 8.8 + 0.006 && r.target >= 6 - 0.006, String(r.target));
  }
});

test('stronger evidence gives a bigger target, weaker a smaller one', () => {
  const weak = A.proposeTarget({ ...base, alignment: 0.05, sentiment: 0, market: 0 });
  const strong = A.proposeTarget({ ...base, alignment: 1, sentiment: 0.9, market: 0.8 });
  assert.ok(strong.target > weak.target); assert.ok(weak.pct >= 12 && strong.pct <= 40);
});

test('evidence against the move means no update, never a smaller target', () => {
  const r = A.proposeTarget({ ...base, alignment: -0.8, sentiment: -0.6, market: -0.5 });
  assert.equal(r.post, false); assert.equal(r.reason, 'evidence_against');
  assert.equal(A.proposeTarget({ side: 'long', price: 2 }).post, false, 'no data at all');
  assert.equal(A.proposeTarget({ ...base, price: 0 }).post, false);
});

test('a target stops just short of a level inside the band but never leaves it', () => {
  const r = A.proposeTarget({ ...base, alignment: 1, sentiment: 1, market: 1, levels: [{ price: 2.5 }] });
  assert.ok(r.snappedTo === 2.5 && r.target < 2.5 && r.target >= 2.24, JSON.stringify(r));
  const out = A.proposeTarget({ ...base, alignment: 1, sentiment: 1, market: 1, levels: [{ price: 2.1 }, { price: 3.5 }] });
  assert.equal(out.snappedTo, null, 'levels outside the 12 to 40 percent band are ignored');
});

test('later updates are a little more conservative', () => {
  const a = A.proposeTarget({ ...base, updates: 0 }), b = A.proposeTarget({ ...base, updates: 2 });
  assert.ok(b.target <= a.target);
});

test('market outlook reads SPY, QQQ and the VIX', () => {
  assert.ok(A.marketOutlook({ spy: { changePct: 1.2 }, qqq: { changePct: 1.5 }, vix: { level: 14 } }) > 0.4);
  assert.ok(A.marketOutlook({ spy: { changePct: -1.5 }, qqq: { changePct: -2 }, vix: { level: 32 } }) < -0.4);
  assert.equal(A.marketOutlook(null), null); assert.equal(A.marketOutlook({}), null);
});

test('targetReached uses the high for a long and the low for a short', () => {
  assert.equal(A.targetReached({ side: 'long', target: 2.4, range: { high: 2.41, low: 1.9 } }), true);
  assert.equal(A.targetReached({ side: 'long', target: 2.4, range: { high: 2.39, low: 1.9 } }), false);
  assert.equal(A.targetReached({ side: 'short', target: 9, range: { high: 11, low: 8.9 } }), true);
  assert.equal(A.targetReached({ side: 'long', target: 2.4, range: null }), false);
});

/* ---------- the watcher ---------- */
const NOW = 1_800_000_000_000, DAY = 86_400_000;
function harness(over = {}) {
  const posts = [], saved = { v: { alerts: {} } };
  let range = { high: 2.5, low: 1.9 };
  const svc = A.createAutoPtService({
    mode: 'on', now: () => NOW,
    listAlerts: async () => over.alerts || [{ key: 'c:1', symbol: 'AIXI', side: 'long', entry: 1.8, target: 2.2, at: NOW - 2 * DAY, channelId: '444444444444444444' }],
    range: async () => over.range || range,
    evidence: async () => over.evidence || { price: 2.3, alignment: 0.6, levels: [], volPct: 5 },
    sentiment: async () => over.sentiment === undefined ? { available: true, score: 0.4 } : over.sentiment,
    market: async () => ({ spy: { changePct: 0.8 }, qqq: { changePct: 1 }, vix: { level: 16 } }),
    post: async (p) => { posts.push(p); return { messageId: 'm' + posts.length }; },
    store: { read: async () => saved.v, write: async (x) => { saved.v = JSON.parse(JSON.stringify(x)); } }, ...over.deps
  });
  return { svc, posts, saved, setRange: (r) => { range = r; over.range = r; } };
}

test('an alert whose target is hit gets one PT update to its own channel, 12-40% above the live price', async () => {
  const h = harness();
  const r = await h.svc.tick();
  assert.equal(r.posted, 1); assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0].channelId, '444444444444444444'); assert.equal(h.posts[0].previousTarget, 2.2);
  assert.ok(h.posts[0].target >= 2.3 * 1.12 - 0.01 && h.posts[0].target <= 2.3 * 1.4 + 0.01);
  assert.equal(h.saved.v.alerts['c:1'].updates.length, 1);
  const again = await h.svc.tick();
  assert.equal(h.posts.length, 1, 'not twice for the same target');
  assert.equal(again.posted, 0);
});

test('nothing is posted before the target is hit, after the five days, or when switched off or dry', async () => {
  const early = harness({ range: { high: 2.0, low: 1.8 } }); await early.svc.tick(); assert.equal(early.posts.length, 0);
  const old = harness({ alerts: [{ key: 'c:1', symbol: 'AIXI', side: 'long', entry: 1.8, target: 2.2, at: NOW - 6 * DAY, channelId: '444444444444444444' }] }); await old.svc.tick(); assert.equal(old.posts.length, 0);
  const off = harness({ deps: { mode: 'off' } }); assert.equal((await off.svc.tick()).ran, false); assert.equal(off.posts.length, 0);
  const dry = harness({ deps: { mode: 'dry' } }); const r = await dry.svc.tick(); assert.equal(r.dry, 1); assert.equal(dry.posts.length, 0);
});

test('weak evidence holds the update and is rechecked, then given up a day after the hit', async () => {
  const h = harness({ evidence: { price: 2.3, alignment: -0.9, levels: [], volPct: 4 }, sentiment: { available: true, score: -0.7 } });
  const r = await h.svc.tick(); assert.equal(r.held, 1); assert.equal(h.posts.length, 0);
  assert.match(h.saved.v.alerts['c:1'].note, /evidence_against/);
});

test('a newer alert with a higher target on the same channel supersedes the automatic update', async () => {
  const h = harness({ alerts: [
    { key: 'c:1', symbol: 'AIXI', side: 'long', entry: 1.8, target: 2.2, at: NOW - 2 * DAY, channelId: '444444444444444444' },
    { key: 'c:2', symbol: 'AIXI', side: 'long', entry: 2.3, target: 2.9, at: NOW - 1 * DAY, channelId: '444444444444444444' }
  ], range: { high: 2.2, low: 1.9 } });
  await h.svc.tick();
  assert.equal(h.saved.v.alerts['c:1'].status, 'done'); assert.match(h.saved.v.alerts['c:1'].note, /superseded/);
});

test('a failure to post is recorded and retried, never lost or doubled', async () => {
  let fail = true;
  const h = harness({ deps: { post: async (p) => { if (fail) throw new Error('discord_post_500'); return { messageId: 'x' }; } } });
  const r = await h.svc.tick(); assert.equal(r.errors, 1);
  assert.equal(h.saved.v.alerts['c:1'].updates.length, 0);
  fail = false; const r2 = await h.svc.tick(); assert.equal(r2.posted, 1);
  assert.equal(h.saved.v.alerts['c:1'].updates.length, 1);
});

test('desk mode: the new target and its write-up are recorded for the alerts desk, nothing is posted', async () => {
  const composed = [];
  const { svc, posts } = harness({ deps: { mode: 'desk', compose: async (p) => { composed.push(p); return { text: '🔥 AIXI PT SMASHED — NEW PT SET $2.80 🔥', stop: 2.05 }; } } });
  await svc.tick();
  assert.equal(posts.length, 0, 'desk mode never posts');
  const ladder = svc.forKey('c:1');
  assert.ok(ladder && ladder.target > 2.3, 'a new target above the live price');
  assert.equal(ladder.updates[0].n, 1); assert.equal(ladder.updates[0].previous, 2.2); assert.equal(ladder.updates[0].posted, false);
  assert.match(ladder.updates[0].text, /PT SMASHED/); assert.equal(composed[0].previousTarget, 2.2);
});

test('on mode posts only to the owner\'s channels; a long watch window keeps long-term alerts watched', async () => {
  const NOW2 = NOW;
  const { svc, posts } = harness({ alerts: [
    { key: 'd:own', symbol: 'AIXI', side: 'long', entry: 1.8, target: 2.2, at: NOW2 - 2 * DAY, channelId: '444444444444444444', postable: true },
    { key: 'd:theirs', symbol: 'BBBB', side: 'long', entry: 1.8, target: 2.2, at: NOW2 - 2 * DAY, channelId: '555555555555555555', postable: false },
    { key: 'd:long', symbol: 'CCCC', side: 'long', entry: 1.8, target: 2.2, at: NOW2 - 40 * DAY, channelId: '444444444444444444', postable: true, windowMs: 90 * DAY }
  ], deps: { compose: async () => ({ text: 'x' }) } });
  await svc.tick();
  assert.deepEqual(posts.map((p) => p.symbol).sort(), ['AIXI', 'CCCC'], 'never posts into a channel the owner does not run; a 40-day-old long-term alert is still watched');
  assert.equal(svc.forKey('d:theirs').updates[0].posted, false, 'the other channel still gets the desk update');
});

test('no new target after a pull-back under the smashed target, and the live price wins over stale bars', async () => {
  const { svc, posts } = harness({ alerts: [{ key: 'd:1', symbol: 'BIAF', side: 'long', entry: 7.38, target: 8.47, at: NOW - 2 * DAY, channelId: '444444444444444444', postable: true, price: 7.58 }],
    range: { high: 8.6, low: 7.3 }, evidence: { price: 8.43, alignment: 0.6, levels: [], volPct: 5 }, deps: { mode: 'desk', compose: async () => ({ text: 'x' }) } });
  await svc.tick();
  assert.equal(svc.forKey('d:1'), null, 'held: price 7.58 is back under the 8.47 target');
  assert.equal(posts.length, 0);
});

test('old desk-only updates (before these checks) are dropped on load; posted ones stay', async () => {
  const { svc, saved } = harness({ deps: { mode: 'desk' } });
  saved.v = { alerts: { 'd:x': { symbol: 'X', side: 'long', status: 'done', updates: [{ at: 1, target: 2, posted: false }] }, 'd:y': { symbol: 'Y', side: 'long', status: 'watching', updates: [{ at: 1, target: 3, posted: true, messageId: 'm1' }] } } };
  await svc.load();
  assert.equal(svc.forKey('d:x'), null);
  assert.equal(svc.forKey('d:y').target, 3);
});

test('one message, one update: a Click-to-Alert copy of a desk alert is not updated twice', async () => {
  const { svc, posts } = harness({ alerts: [
    { key: 'd:777', symbol: 'AIXI', side: 'long', entry: 1.8, target: 2.2, at: NOW - 2 * DAY, channelId: '444444444444444444', postable: true },
    { key: 'c:777', symbol: 'AIXI', side: 'long', entry: 1.8, target: 2.2, at: NOW - 2 * DAY, channelId: '444444444444444444' }
  ], deps: { compose: async () => ({ text: 'x' }) } });
  await svc.tick();
  assert.equal(posts.length, 1);
  assert.equal(svc.forKey('c:777'), null);
});

test('insight lines come from the decision, not stock sentences', () => {
  const { insightFor } = require('./academy-auto-pt.js');
  const a = insightFor({ side: 'long', prop: { alignment: 1, sentiment: 0.6, market: -0.5, volPct: 9, pct: 12.4, snappedTo: 11 }, updates: 0 });
  assert.match(a.status, /MEM ALGO lined up/);
  assert.match(a.targetNote, /12\.4% above/);
  assert.match(a.targetNote, /\$11 level/);
  assert.match(a.targetNote, /Sentiment is behind it/);
  assert.match(a.targetNote, /risk-off/);
  assert.match(a.riskNote, /about 9% a day/);
  const b = insightFor({ side: 'short', prop: { alignment: 0, sentiment: null, market: null, volPct: 2, pct: 8 }, updates: 1 });
  assert.match(b.status, /mixed/);
  assert.match(b.targetNote, /below here/);
  assert.match(b.riskNote, /^Third target now/);
});
