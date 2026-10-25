'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('./academy-option-mini-tools');
const smartMoney = require('./academy-smart-money');
const levels = require('./academy-session-levels');
const patterns = require('./academy-patterns');

/* a contract's premium: 160 five-minute candles that trend up then range, with volume */
function bars(n = 160) {
  const out = []; let p = 3.2; const t0 = Date.parse('2026-10-23T13:30:00Z');
  for (let i = 0; i < n; i++) {
    const o = p, c = +(p + Math.sin(i / 7) * 0.08 + ((i * 7919) % 13 - 6) * 0.01).toFixed(2);
    const h = +(Math.max(o, c) + 0.03).toFixed(2), l = +(Math.min(o, c) - 0.03).toFixed(2);
    out.push({ t: t0 + i * 300000, o: +o.toFixed(2), h, l, c, v: 50 + ((i * 31) % 400) });
    p = c;
  }
  return out;
}
const deps = { smartMoney, levels, patterns };

/* a canvas stand-in that counts what gets drawn */
function fakeCtx() {
  const calls = { stroke: 0, fillRect: 0, fillText: 0 };
  return { calls, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, setLineDash() {}, stroke() { calls.stroke++; }, fillRect() { calls.fillRect++; }, fillText() { calls.fillText++; } };
}
const geo = { padL: 4, padR: 46, padT: 8, pw: 230, ph: 104, lo: 3.0, hi: 5.0 };

test('the logic table: candle-based tools apply to a contract, book-based ones do not, stock-level ones hand off', () => {
  const ids = T.TOOLS.map((t) => t.id);
  assert.deepEqual(ids, ['smc', 'levels', 'patterns', 'flow', 'walls', 'heat', 'cost', 'intent', 'darkpool', 'shortsale', 'sentiment']);
  for (const id of ['smc', 'levels', 'patterns', 'flow']) assert.equal(T.byId(id).ok, true, id + ' runs on the contract\'s candles');
  for (const id of ['walls', 'heat', 'cost']) { assert.equal(T.byId(id).ok, false, id + ' cannot exist for a contract'); assert.ok(T.byId(id).why.length > 20, 'and says why'); }
  for (const id of ['intent', 'darkpool', 'shortsale', 'sentiment']) { assert.equal(T.byId(id).group, 'stock'); assert.match(T.byId(id).target, /^#/, id + ' opens the stock\'s tool on the main chart'); }
  /* only overlays can be switched on; hand-offs and refusals never become enabled state */
  assert.deepEqual(T.normalizeEnabled(['walls', 'smc', 'darkpool', 'flow', 'nope', 'smc']), ['smc', 'flow']);
  assert.deepEqual(T.DEFAULTS, ['smc']);
});

test('flow from candles: all closes at the high is all buying, at the low all selling, and a flat bar follows its direction', () => {
  const up = T.flowFromBars([{ o: 1, h: 2, l: 1, c: 2, v: 100 }, { o: 2, h: 3, l: 2, c: 3, v: 100 }]);
  assert.equal(up.share, 1); assert.equal(up.read, 'buyers have had it');
  const down = T.flowFromBars([{ o: 2, h: 2, l: 1, c: 1, v: 100 }]);
  assert.equal(down.share, 0); assert.equal(down.read, 'sellers have had it');
  const mid = T.flowFromBars([{ o: 1, h: 3, l: 1, c: 2, v: 100 }]);
  assert.equal(mid.share, 0.5); assert.equal(mid.read, 'two-sided');
  const flat = T.flowFromBars([{ o: 1, h: 1, l: 1, c: 1, v: 10 }]);
  assert.equal(flat.share, 1, 'a doji at its open counts as holding, not selling');
  assert.equal(T.flowFromBars([]).share, null);
  assert.equal(T.flowFromBars([{ o: 1, h: 2, l: 1, c: 2 }]).share, null, 'no volume, no read');
});

test('plan runs the real engines on the contract\'s candles and never lets one failure take the others down', () => {
  const p = T.plan(bars(), ['smc', 'levels', 'patterns', 'flow'], deps);
  assert.equal(p.n, 160);
  assert.ok(p.smc && p.smc.structure && Array.isArray(p.smc.fvg) && Array.isArray(p.smc.vwap), 'SMC ran');
  assert.ok(p.levels && p.levels.ib && p.levels.profile && Array.isArray(p.levels.vwap), 'Levels ran');
  assert.ok(p.patterns && Array.isArray(p.patterns.charts), 'Patterns ran');
  assert.ok(p.flow && p.flow.share > 0 && p.flow.share < 1, 'Flow ran');
  const line = T.readLine(p);
  assert.match(line, /structure|Break of structure|Change of character/i);
  assert.match(line, /VWAP|IB|POC/);
  assert.match(line, /% buy volume/);

  const broken = T.plan(bars(), ['smc', 'flow'], { smartMoney: { analyze() { throw new Error('boom'); } } });
  assert.equal(broken.smc, null);
  assert.ok(broken.flow && broken.flow.share != null, 'flow still ran');
  assert.deepEqual(broken.notes, ['SMC unavailable']);
  assert.match(T.readLine(broken), /SMC unavailable/);

  const few = T.plan(bars(8), ['smc'], deps);
  assert.equal(few.smc, null, 'the engine answers null under 20 candles');
  assert.match(T.readLine(few), /more candles/);
  assert.equal(T.plan([], ['smc'], deps).n, 0);
  assert.equal(T.readLine(T.plan([], ['smc'], deps)), '');
});

test('draw puts the overlays on the mini canvas in the mini chart\'s own geometry, and draws nothing when nothing is on', () => {
  const b = bars(); const visible = b.slice(-120); const offset = b.length - visible.length;
  const on = T.plan(b, ['smc', 'levels', 'patterns', 'flow'], deps);
  const ctx = fakeCtx();
  const drawn = T.draw(ctx, geo, visible, offset, on);
  assert.ok(drawn > 0, 'something was drawn');
  assert.ok(ctx.calls.stroke > 0 && ctx.calls.fillRect > 0, 'lines and boxes');
  const off = T.plan(b, [], deps);
  assert.equal(T.draw(fakeCtx(), geo, visible, offset, off), 0);
  assert.equal(T.draw(null, geo, visible, offset, on), 0);
  assert.equal(T.draw(fakeCtx(), geo, [], 0, on), 0);
  /* a level outside the visible price range is skipped, not drawn off-canvas */
  const tight = Object.assign({}, geo, { lo: 100, hi: 101 });
  const ctx2 = fakeCtx(); T.draw(ctx2, tight, visible, offset, T.plan(b, ['levels'], deps));
  assert.equal(ctx2.calls.fillText, 0, 'no labels for levels that are not in view');
});
