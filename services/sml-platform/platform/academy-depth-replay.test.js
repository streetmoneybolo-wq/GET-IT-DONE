'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { replayDepth, runReader, summarize, dayBoundsNewYork } = require('./academy-depth-replay');

/* Synthetic session: a 60-level book where the ask side gets pulled and the bid side stacked over a few seconds, which the reader reads as
   bullish momentum, followed by price drifting up so the 5-minute outcome is positive. */
function side(p1, dir, sizes) { return sizes.map((s, i) => [+(p1 + dir * i * 0.01).toFixed(2), s, 2]); }
function rows() {
  const out = []; const t0 = 1_800_000_000_000;
  const base = Array.from({ length: 60 }, (_, i) => 200 + (i % 7) * 10);
  for (let i = 0; i < 160; i++) {
    const t = t0 + i * 2500;
    const drift = i >= 60 ? (i - 60) * 0.01 : 0;          // price walks up after the stacking phase
    const bids = base.slice(); const asks = base.slice();
    if (i >= 45 && i < 60) { for (let k = 0; k < 3; k++) { bids[k] = 1800; asks[k] = 40; } } // stacking the bid, pulling the ask
    // a deep wall only the full book can see
    bids[40] = 9000;
    out.push({ t, bids: side(100 + drift, -1, bids), asks: side(100.01 + drift, 1, asks), prints: i % 4 === 0 ? [[t, 100.01 + drift, 50, 'B']] : [] });
  }
  return out;
}

test('runReader emits events and scores them five minutes later', () => {
  const events = runReader(rows(), 10);
  assert.ok(events.length > 0, 'the stacking phase produces at least one event');
  assert.ok(events.every((e) => ['stack', 'pull', 'absorb', 'iceberg', 'flip'].includes(e.kind)));
  const measured = events.filter((e) => e.outcome5mPct != null);
  assert.ok(measured.length > 0);
  for (const e of measured) assert.equal(typeof e.outcome5mPct, 'number');
});

test('summarize groups by kind and side with a hit rate', () => {
  const s = summarize([
    { kind: 'stack', side: 'bull', outcome5mPct: 0.2 }, { kind: 'stack', side: 'bull', outcome5mPct: -0.1 }, { kind: 'stack', side: 'bull', outcome5mPct: null },
    { kind: 'pull', side: 'bear', outcome5mPct: 0.3 }
  ]);
  assert.deepEqual(s, [
    { kind: 'pull', side: 'bear', events: 1, measured: 1, hitRate: 1, avgPct: 0.3 },
    { kind: 'stack', side: 'bull', events: 3, measured: 2, hitRate: 0.5, avgPct: 0.05 }
  ]);
});

test('replayDepth compares the ten-level view with the full book', async () => {
  async function* gen() { for (const r of rows()) yield r; }
  const out = await replayDepth(gen());
  assert.equal(out.rows, 160);
  assert.deepEqual(Object.keys(out.views), ['top10', 'full']);
  assert.equal(out.views.top10.depth, 10); assert.equal(out.views.full.depth, 'full');
  assert.ok(out.views.top10.events >= 1 && out.views.full.events >= 1);
  assert.ok(Array.isArray(out.views.full.summary));
});

test('day bounds follow New York time, with and without daylight saving', () => {
  const summer = dayBoundsNewYork('2026-07-01');   // UTC-4
  assert.equal(new Date(summer.fromMs).toISOString(), '2026-07-01T08:00:00.000Z');
  assert.equal(new Date(summer.toMs).toISOString(), '2026-07-02T00:00:00.000Z');
  const winter = dayBoundsNewYork('2026-01-15', '2026-01-16'); // UTC-5, two-day range
  assert.equal(new Date(winter.fromMs).toISOString(), '2026-01-15T09:00:00.000Z');
  assert.equal(new Date(winter.toMs).toISOString(), '2026-01-17T01:00:00.000Z');
});
