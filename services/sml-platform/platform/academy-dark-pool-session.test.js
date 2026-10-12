'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionDarkPool } = require('./academy-dark-pool-session');

const T0 = Date.UTC(2026, 9, 12, 14, 0, 0); // 10:00 ET
test('a session read from the trade record: share, blocks, hourly profile, levels and a plain window label', () => {
  const rows = [];
  let p = 100;
  for (let i = 0; i < 400; i++) { p += (i % 7 === 0 ? 0.05 : i % 5 === 0 ? -0.05 : 0); rows.push([T0 + i * 15_000, p, 200, i % 3 === 0 ? 1 : 0]); } // every third print off-exchange
  rows.push([T0 + 400 * 15_000, p, 25_000, 1]); // one block
  rows.push([T0 + 401 * 15_000, p + 0.01, 300, 0]);
  const d = sessionDarkPool(rows, { price: p, now: 1, sessionOpenMs: T0 - 30 * 60_000 });
  assert.equal(d.available, true); assert.equal(d.source, 'trade-record');
  assert.equal(d.prints, 402); assert.equal(d.offPrints, 135);
  assert.ok(d.offSharePct > 40 && d.offSharePct < 60, String(d.offSharePct));
  assert.deepEqual([d.blocks.count, d.blocks.list[0].size, d.blocks.rule], [1, 25000, '10,000+ shares or $1M+']);
  assert.ok(d.blocks.sharePct > 40);
  assert.equal(d.window.full, false); assert.match(d.window.label, /^the last 100 minutes of prints \(402 trades\)$/);
  assert.deepEqual(d.byHour.map((h) => h.hour), ['10:00 ET', '11:00 ET']);
  assert.ok(d.byHour.every((h) => h.offSharePct > 0));
  assert.ok(d.levels.length >= 1 && d.largest[0].size === 25000);
  assert.match(d.levelsNote, /every off-exchange print in this window/);
  assert.equal(sessionDarkPool([]).reason, 'no_prints');
  assert.equal(sessionDarkPool(rows.slice(0, 10), { price: p }).reason, 'too_few_prints');
  assert.equal(sessionDarkPool(rows, { price: p, sessionOpenMs: T0 }).window.full, true, 'first print within a minute of the open: the whole session');
});
