'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./academy-article-chart');

function daily(n, start = 10) { const out = []; let p = start; for (let i = 0; i < n; i++) { const o = p, c = p * (1 + Math.sin(i / 4) * 0.02); out.push({ t: Date.UTC(2026, 8, 1) + i * 86_400_000, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c, v: 1e6 + i * 1000 }); p = c; } return out; }

test('the candle chart draws every candle, the levels, the path, the target and a movable live line, all escaped', () => {
  const bars = daily(80);
  const r = C.candleChart({ symbol: 'AB<CD', bars, price: 10.4, target: 12, stop: 9.5, levels: [{ label: 'CALL WALL', price: 11.5, kind: 'resistance' }, { label: 'x"y', price: 9.8, kind: 'support' }], path: [{ label: 'TRIGGER', price: 10.7 }, { label: 'CONFIRM', price: 11.3 }], lean: 'bullish', count: 60, title: 'Title <b>', subtitle: 'sub' });
  assert.equal(r.ok, true); assert.equal(r.bars, 60);
  assert.equal((r.svg.match(/<rect /g) || []).length >= 60 * 2 + 1, true, 'candle bodies and volume bars');
  assert.match(r.svg, /CALL WALL \$11\.50/); assert.match(r.svg, /x&quot;y/); assert.match(r.svg, /TARGET \$12\.00/); assert.match(r.svg, /INVALIDATION \$9\.50/);
  assert.match(r.svg, /<polyline points="[^"]+" fill="none" stroke="#19c37d"/); assert.match(r.svg, />TRIGGER</); assert.match(r.svg, />CONFIRM</);
  assert.match(r.svg, /class="mem-live" data-price="10\.4"/); assert.match(r.svg, /data-ymin="[\d.]+" data-ymax="[\d.]+" data-top="46" data-h="[\d.]+"/);
  assert.ok(!/<script|AB<CD|Title <b>/.test(r.svg), 'escaped, no script');
  assert.ok(r.lo < 9.5 && r.hi > 12, 'the scale covers the stop and the target');
  assert.equal(C.candleChart({ bars: daily(3) }).ok, false);
});

test('gauge, bars and sparkline render small SVGs with their values', () => {
  const g = C.gauge({ score: 72, label: 'SQUEEZE RISK', caption: 'high' });
  assert.match(g, /class="mem-gauge"/); assert.match(g, />72</); assert.match(g, /SQUEEZE RISK/); assert.match(g, /stroke="#19c37d"/);
  const b = C.bars({ items: [{ label: 'Mon', value: 55 }, { label: 'Tue', value: 61, color: '#f00' }], max: 100, baseline: 45, format: (v) => v + '%' });
  assert.match(b, /class="mem-bars"/); assert.match(b, />61%</); assert.match(b, /stroke-dasharray="4 4"/);
  assert.equal(C.bars({ items: [] }), '');
  const s = C.sparkline([1, 2, 3, 2.5, 4]);
  assert.match(s, /class="mem-spark"/); assert.match(s, /polyline/);
  assert.equal(C.sparkline([1]), '');
});
