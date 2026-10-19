'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const DI = require('./academy-depth-insights');

const T0 = 1_800_000_000_000;
/* a book around 100.00 / 100.01: bids descending, asks ascending; sizes and order counts given per level */
function book(t, { bid = [], ask = [], bidOrders = null, askOrders = null } = {}) {
  const side = (sizes, orders, start, dir) => sizes.map((size, i) => ({ price: +(start + dir * i * 0.01).toFixed(2), size, orders: orders ? orders[i] : 0 }));
  return { t, bids: side(bid, bidOrders, 100.0, -1), asks: side(ask, askOrders, 100.01, 1) };
}
const flat = (n, v) => Array.from({ length: n }, () => v);
const prints = (list) => list.map(([dt, price, size, dir]) => ({ t: T0 + dt, price, size, dir }));

test('the book is read: imbalance at every depth, microprice tilt, bands, walls with their average order, thin zones and order sizes', () => {
  const bids = flat(20, 300), asks = flat(20, 300);
  bids[0] = 900; asks[0] = 300;           // heavy touch on the bid: microprice leans to the ask
  bids[6] = 3000; asks[12] = 2600;        // walls
  asks[3] = 20; asks[4] = 20; asks[5] = 20; // an air pocket just above
  const bo = flat(20, 6), ao = flat(20, 6); bo[6] = 2; ao[12] = 26;
  const ins = DI.depthInsights({ snaps: [book(T0, { bid: bids, ask: asks, bidOrders: bo, askOrders: ao })], prints: [], now: T0 + 500 });
  assert.equal(ins.ready, true);
  assert.equal(ins.book.tick, 0.01); assert.equal(ins.book.spreadTicks, 1); assert.equal(ins.book.mid, 100.005);
  assert.ok(ins.book.imbalance.top1 > 0.4 && ins.book.imbalance.top1 < 0.6, 'top of book leans to the bid: ' + ins.book.imbalance.top1);
  assert.ok(ins.book.imbalance.weighted > 0, 'the heavy bid near the touch outweighs the ask wall far away');
  assert.ok(ins.book.microTilt > 0.2, 'microprice sits above the mid when the bid is the heavier side: ' + ins.book.microTilt);
  assert.equal(Math.abs(ins.book.microprice - (100.0 * 300 + 100.01 * 900) / 1200) < 1e-6, true, 'microprice formula');
  assert.ok(ins.book.depth.bid.p10 >= 900 && ins.book.depth.bid.p100 > ins.book.depth.bid.p10, 'bands grow with distance');
  const bw = ins.walls.find((w) => w.kind === 'bid'), aw = ins.walls.find((w) => w.kind === 'ask');
  assert.equal(bw.price, 99.94); assert.equal(bw.size, 3000); assert.equal(bw.avgOrder, 1500, 'two orders hold the bid wall: large resting orders');
  assert.equal(aw.price, 100.13); assert.equal(aw.avgOrder, 100, 'twenty-six small orders make the ask wall');
  assert.ok(bw.distTicks >= 6 && aw.distTicks >= 12);
  assert.equal(ins.thin.length, 1); assert.equal(ins.thin[0].kind, 'ask'); assert.equal(ins.thin[0].from, 100.04); assert.equal(ins.thin[0].to, 100.06); assert.equal(ins.thin[0].ticks, 3);
  assert.equal(ins.book.orders.available, true); assert.ok(ins.book.orders.bid.avgOrder > ins.book.orders.ask.avgOrder);
  assert.ok(ins.read.lines.some((l) => /Bid wall 3,000/.test(l.text)) && ins.read.lines.some((l) => /Thin book above/.test(l.text)));
  assert.ok(ins.pressure.components.find((c) => c.key === 'weighted').pts > 0);
});

test('the tape is read: delta, CVD, a bearish divergence (price up on net selling), large-print bias and velocity; the composite turns negative', () => {
  const snaps = [book(T0, { bid: flat(10, 300), ask: flat(10, 300) })];
  const rows = [];
  // ten minutes of quiet two-sided trade, then a five-minute window where price drifts up while far more is sold than bought
  for (let i = 0; i < 60; i++) rows.push([-600_000 + i * 10_000, 99.9, 100, i % 2 ? 'B' : 'S']);
  for (let i = 0; i < 40; i++) rows.push([-290_000 + i * 7_000, 99.95 + i * 0.004, i % 4 === 0 ? 150 : 400, i % 4 === 0 ? 'B' : 'S']);
  rows.push([-5_000, 100.12, 5000, 'S'], [-4_000, 100.12, 4500, 'S'], [-3_000, 100.12, 4000, 'S']); // large prints, sold
  const ins = DI.depthInsights({ snaps, prints: prints(rows), now: T0 });
  assert.ok(ins.flow.delta300.sell > ins.flow.delta300.buy, 'net selling in the window');
  assert.ok(ins.flow.cvd.length >= 5 && ins.flow.cvd.every((c) => Number.isFinite(c.cvd)), 'a CVD series in one-minute steps');
  assert.ok(ins.flow.priceChangePct > 0.08, 'price rose over the window: ' + ins.flow.priceChangePct);
  assert.equal(ins.flow.divergence, 'bearish');
  assert.ok(ins.flow.large && ins.flow.large.bias < -0.8, 'the big prints were sold: ' + JSON.stringify(ins.flow.large));
  assert.ok(ins.flow.velocity && ins.flow.velocity.ratio > 1.5, 'the last minute ran hot against the ten-minute average');
  assert.ok(ins.pressure.score < -25, 'selling pressure: ' + ins.pressure.score);
  assert.equal(ins.read.bias, 'bearish');
  assert.ok(ins.read.lines.some((l) => /Divergence: price rose while net selling grew/.test(l.text)));
  // the mirror image is bullish
  const mirror = rows.map(([dt, p, s, d]) => [dt, 200 - p, s, d === 'B' ? 'S' : 'B']);
  const ins2 = DI.depthInsights({ snaps: [book(T0, { bid: flat(10, 300), ask: flat(10, 300) })], prints: prints(mirror), now: T0 });
  assert.equal(ins2.flow.divergence, 'bullish'); assert.ok(ins2.pressure.score > 25);
});

test('replenishment: size put back at the touch beyond what the tape took is refill; who refills decides the sign', () => {
  const s0 = book(T0, { bid: flat(10, 500), ask: flat(10, 500) });
  const s1 = book(T0 + 2500, { bid: flat(10, 500), ask: flat(10, 500) });
  const s2 = book(T0 + 5000, { bid: flat(10, 500), ask: flat(10, 500) });
  const s3 = book(T0 + 7500, { bid: [500, 500, 500, ...flat(7, 500)], ask: [200, 500, 500, ...flat(7, 500)] }); // bid intact after 900 sold into it; ask down 300 after 100 lifted
  const rows = prints([[1000, 100.0, 400, 'S'], [3000, 100.0, 500, 'S'], [6000, 100.01, 100, 'B']]);
  const ins = DI.depthInsights({ snaps: [s0, s1, s2, s3], prints: rows, now: T0 + 8000 });
  assert.equal(ins.flow.replenish.bid, 1, '900 hit the bid and 900 came back: refill 1.0x');
  assert.equal(ins.flow.replenish.ask, 0, '100 lifted the ask and 300 more left: nothing refilled');
  const refill = ins.pressure.components.find((c) => c.key === 'refill');
  assert.ok(refill && refill.pts > 0, 'buyers defending the bid is buying pressure');
  // a touch that moved is not comparable
  const moved = book(T0 + 10000, { bid: flat(10, 500), ask: flat(10, 500) }); moved.bids = moved.bids.map((l) => ({ ...l, price: +(l.price + 0.05).toFixed(2) })); moved.asks = moved.asks.map((l) => ({ ...l, price: +(l.price + 0.05).toFixed(2) }));
  const ins2 = DI.depthInsights({ snaps: [s1, s2, s3, moved], prints: rows, now: T0 + 11000 });
  assert.equal(ins2.flow.replenish.bid, null); assert.match(ins2.flow.replenish.note, /price moved/);
});

test('hold read: a day trade exits on a stacked book, a swing trims, a long hold only ever trims, and the same book read for a short is the mirror', () => {
  const bearish = { ready: true, pressure: { score: -62, label: 'strong selling pressure' }, flow: { divergence: 'bearish', replenish: { bid: 0.3, ask: 2.4 }, large: { n: 6, bias: -0.7 } }, walls: [{ kind: 'ask', price: 100.2, size: 8000, avgOrder: 2000 }], thin: [] };
  const day = DI.holdRead('day', 1, bearish, { price: 100.1, atr: 0.5 });
  assert.equal(day.verdict, 'exit'); assert.ok(day.against >= 3);
  assert.ok(day.reasons.some((r) => /sold into/.test(r.text)) && day.reasons.some((r) => /Ask wall 8,000/.test(r.text)) && day.reasons.some((r) => /refill the ask/.test(r.text)));
  assert.equal(DI.holdRead('swing', 1, bearish, { price: 100.1, atr: 0.5 }).verdict, 'trim');
  const long = DI.holdRead('long', 1, bearish, { price: 100.1, atr: 0.5 });
  assert.ok(['hold', 'trim'].includes(long.verdict) && long.verdict !== 'exit', 'a long hold never exits on minutes of order flow');
  assert.match(long.note, /never exits/);
  const short = DI.holdRead('short', -1, bearish, { price: 100.1, atr: 0.5 });
  assert.equal(short.against, 0); assert.ok(short.withCount >= 3); assert.equal(short.verdict, 'add');
  const none = DI.holdRead('day', 1, { ready: false }); assert.equal(none.verdict, 'none');
  const balanced = DI.holdRead('day', 1, { ready: true, pressure: { score: 5, label: 'balanced' }, flow: { divergence: null, replenish: null, large: null }, walls: [], thin: [] }, { price: 100 });
  assert.equal(balanced.verdict, 'hold'); assert.equal(balanced.reasons.length, 0);
});

test('options timing: a wide spread and a book against the side is poor; tight spread, pressure, microprice and tape all with it is good', () => {
  const good = { ready: true, book: { spreadTicks: 1, microTilt: 0.4 }, pressure: { score: 45 }, flow: { divergence: 'bullish', velocity: null } };
  assert.equal(DI.optionsRead(good, 1).timing, 'good');
  assert.equal(DI.optionsRead(good, -1).timing, 'poor', 'the same book is poor for a put');
  const wide = { ready: true, book: { spreadTicks: 4, microTilt: 0 }, pressure: { score: 0 }, flow: { divergence: null, velocity: { ratio: 2.5 } } };
  const r = DI.optionsRead(wide, 1); assert.equal(r.timing, 'poor'); assert.ok(r.why.some((w) => /work a limit/.test(w)) && r.why.some((w) => /size down/.test(w)));
  assert.equal(DI.optionsRead(null, 1).timing, 'unknown');
});

test('bad input is refused plainly, rows and objects are both accepted, and nothing throws on a thin or one-sided book', () => {
  assert.deepEqual(DI.depthInsights({ snaps: [] }), { ready: false, reason: 'no_book' });
  assert.equal(DI.depthInsights({ snaps: [{ t: T0, bids: [], asks: [[100.01, 10, 1]] }] }).reason, 'empty_book');
  assert.equal(DI.depthInsights({ snaps: [{ t: T0, bids: [[100.02, 10, 1]], asks: [[100.01, 10, 1]] }] }).reason, 'crossed_book');
  const rows = DI.depthInsights({ snaps: [{ t: T0, bids: [[100, 500, 5], [99.99, 400, 4]], asks: [[100.01, 300, 3], [100.02, 200, 2]] }], prints: [[T0 - 1000, 100, 100, 'B']], now: T0 });
  assert.equal(rows.ready, true); assert.equal(rows.prints, 1); assert.equal(rows.flow.replenish, null, 'fewer than four snapshots: no refill read');
  assert.equal(rows.book.orders.available, false, 'two levels a side is too few to read order sizes');
  assert.ok(rows.read.headline.length > 10 && rows.pressure.components.length >= 2);
});
