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
