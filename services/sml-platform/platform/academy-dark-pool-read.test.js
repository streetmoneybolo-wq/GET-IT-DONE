'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readDarkPool, footprint, xText } = require('./academy-dark-pool-read');

const session = (over = {}) => ({
  available: true, offSharePct: 52, typicalSharePct: 40, offVolume: 9_000_000, lean: { offExchange: 0.31, lit: 0.1 },
  blocks: { count: 3, volume: 640_000, sharePct: 7.1, rule: '10,000+ shares or $1M+', list: [{ t: 1, price: 769.12, size: 500_000, notional: 384_560_000, dir: 'B' }, { t: 2, price: 770, size: 100_000, notional: 77_000_000, dir: 'S' }, { t: 3, price: 768.5, size: 40_000, notional: 30_740_000, dir: 'B' }] },
  largest: [{ t: 1, price: 769.12, size: 500_000, notional: 384_560_000, dir: 'B' }], window: { full: true }, ...over
});

test('the SPY case: a $384M block against yesterday\'s $96M reads as UNUSUAL with numbered, plain steps', () => {
  const yesterday = footprint(session({ offSharePct: 44, blocks: { count: 2, volume: 150_000, sharePct: 3, rule: '10,000+ shares or $1M+', list: [{ t: 1, price: 777, size: 126_000, notional: 97_902_000, dir: 'S' }] } }), { date: '2026-10-14' });
  assert.equal(yesterday.largest.size, 126_000);
  const older = [{ date: '2026-10-12', largest: { notional: 20e6, size: 26000, price: 760 }, blockVolume: 60_000, blockCount: 1 }, { date: '2026-10-13', largest: { notional: 35e6, size: 45000, price: 765 }, blockVolume: 90_000, blockCount: 2 }];
  const r = readDarkPool(session(), { history: [...older, yesterday], price: 769.4 });
  assert.equal(r.verdict, 'UNUSUAL');
  assert.match(r.headline, /\$385M block at \$769\.12, 3\.9x yesterday's biggest, high off-exchange share/);
  assert.deepEqual(r.steps.map((s) => s.k), ['WHAT PRINTED', 'VS YESTERDAY', 'WHERE', 'THE SESSION', 'WHAT TO DO']);
  assert.match(r.steps[0].text, /500,000 shares at \$769\.12, about \$385M, on an uptick/);
  assert.match(r.steps[1].text, /Yesterday's biggest was 126,000 shares at \$777\.00 \(\$97\.9M\)\. Today's is 3\.9x bigger, and the largest print in the last 3 sessions/);
  assert.match(r.steps[2].text, /right at the current price/);
  assert.match(r.steps[3].text, /52% of today's volume printed off-exchange, high against a typical 40%\. 3 blocks make up 7% of that off-exchange volume\. By the tick rule the off-exchange prints lean buy side \(\+31\)/);
  assert.match(r.steps[4].text, /treat the print price as a level/);
  assert.equal(r.vsYesterday.largestRatio, 3.93); assert.equal(r.biggestInWindow, true); assert.equal(r.sessionsOnRecord, 3);
  assert.ok(r.glossary.length === 4);
});

test('no blocks and a normal share is QUIET; a lone block at the market with no history is NORMAL; prints above the market are explained', () => {
  const q = readDarkPool(session({ offSharePct: 41, lean: { offExchange: 0.05 }, blocks: { count: 0, volume: 0, sharePct: null, rule: '10,000+ shares or $1M+', list: [] }, largest: [] }), { history: [], price: 100 });
  assert.equal(q.verdict, 'QUIET'); assert.match(q.steps[0].text, /No block-size prints/); assert.match(q.steps[1].text, /No earlier session on record/);
  const n = readDarkPool(session({ offSharePct: 41, lean: { offExchange: 0.05 }, blocks: { count: 1, volume: 20_000, sharePct: 1, rule: '10,000+ shares or $1M+', list: [{ t: 1, price: 101.5, size: 20_000, notional: 2_030_000, dir: 'S' }] } }), { history: [], price: 100 });
  assert.equal(n.verdict, 'NORMAL'); assert.match(n.steps.find((s) => s.k === 'WHERE').text, /1\.5% above the current price .* seller finding a buyer/);
  assert.equal(readDarkPool({ available: false }), null);
  assert.equal(xText(3.93), '3.9x'); assert.equal(xText(1.3), '+30%'); assert.equal(xText(0.4), 'under half'); assert.equal(xText(12.4), '12x');
});
