'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('./academy-scenario-gif');

const bars = []; let px = 10; for (let i = 0; i < 50; i++) { const o = px, c = px * (1 + Math.sin(i / 4) * 0.02 + 0.002); bars.push({ t: i, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c }); px = c; }

test('the path starts at the last close, passes the waypoints in order and ends at the target', () => {
  const pts = G.pathPoints({ last: 10, waypoints: [{ label: 'TRIGGER', price: 10.6 }, { label: 'CONFIRM', price: 11.2 }], target: 12.5, slots: 16, seed: 3 });
  assert.equal(pts.length, 17); assert.equal(pts[0].p, 10); assert.equal(pts[16].p, 12.5); assert.equal(pts[16].label, 'TARGET');
  const labels = pts.filter((q) => q.label).map((q) => q.label);
  assert.deepEqual(labels, ['TRIGGER', 'CONFIRM', 'TARGET']);
});

test('frames are valid SVG, one per step, the last one holds the whole path and the step strip lights up', () => {
  const fr = G.frames({ symbol: 'ABCD', bars, target: 13.5, stop: 10.2, levels: [{ label: 'Call wall', price: 13 }], waypoints: [{ label: 'TRIGGER', price: 11.9 }, { label: 'CONFIRM', price: 12.6 }], count: 12 });
  assert.equal(fr.length, 13);
  assert.ok(fr.every((s) => s.startsWith('<svg') && s.endsWith('</svg>')));
  assert.match(fr[0], /TARGET \$13\.50/); assert.match(fr[0], /INVALIDATION \$10\.20/); assert.match(fr[0], /Call wall \$13\.00/);
  assert.ok((fr[12].match(/<circle/g) || []).length > (fr[0].match(/<circle/g) || []).length, 'more waypoints lit at the end');
  const r = G.gif({ symbol: 'ABCD', bars, target: 13.5, waypoints: [{ label: 'TRIGGER', price: 11.9 }], count: 8 });
  assert.equal(r.frames, 9);
  if (G.available()) { assert.ok(Buffer.isBuffer(r.gif) && r.gif.subarray(0, 6).toString('ascii') === 'GIF89a'); } else assert.equal(r.gif, null);
});
