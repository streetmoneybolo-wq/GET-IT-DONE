'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SM = require('./academy-smart-money');
const EX = require('./academy-smc-explain');

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function series(n) {
  const out = []; let p = 100; const t0 = Date.UTC(2026, 8, 1, 13, 30);
  for (let i = 0; i < n; i++) {
    const o = p, c = p + Math.sin(i / 18) * 0.25 + (rnd() - 0.5) * 0.8;
    out.push({ t: t0 + i * 3e5, o, h: Math.max(o, c) + rnd() * 0.4, l: Math.min(o, c) - rnd() * 0.4, c, v: 1000 + rnd() * 900 + (i % 37 === 0 ? 3000 : 0) });
    p = c;
  }
  return out;
}
const bars = series(400);
const a = SM.analyze(bars);
const KINDS = [['ob', a.structure.orderBlocks], ['fvg', a.fvg], ['liq', a.liquidity], ['structure', a.structure.events], ['gap', a.gaps]];

test('every smart-money item can be explained with facts, evidence and a conclusion', () => {
  let count = 0;
  for (const [kind, list] of KINDS) {
    list.forEach((_, i) => {
      const r = EX.explain(a, bars, kind, i, { flow: { buy: 60, sell: 40 } });
      assert.ok(r, kind + ' ' + i);
      assert.ok(r.title && r.headline, 'title and headline');
      assert.ok(r.facts.length >= 2, 'facts');
      assert.ok(Array.isArray(r.evidence) && r.evidence.length >= 1, 'evidence');
      assert.ok(['bullish', 'bearish', 'neutral'].includes(r.conclusion.bias));
      assert.ok(['low', 'medium', 'high'].includes(r.conclusion.confidence));
      assert.ok(r.conclusion.summary.length > 30);
      assert.ok(r.notes.some((n) => /not a prediction|Educational/.test(n)), 'carries the educational note');
      count++;
    });
  }
  assert.ok(count > 20, 'the synthetic history produces many items to check: ' + count);
});

test('bad input is refused quietly', () => {
  assert.equal(EX.explain(null, bars, 'ob', 0), null);
  assert.equal(EX.explain(a, bars, 'nope', 0), null);
  assert.equal(EX.explain(a, bars, 'ob', 9999), null);
  assert.equal(EX.explain(a, null, 'ob', 0), null);
});

test('a sweep is described as a stop run and is judged by what followed it', () => {
  const i = a.liquidity.findIndex((l) => l.sweptAt != null);
  assert.ok(i >= 0, 'fixture has a sweep');
  const r = EX.explain(a, bars, 'liq', i, {});
  assert.equal(r.kind, 'sweep');
  assert.match(r.headline, /Liquidity sweep/);
  assert.ok(r.facts.some(([k]) => /Wick beyond level/.test(k)));
  assert.ok(r.evidence.some((e) => /CLOSED back/.test(e.text)), 'names the close back inside');
  assert.match(r.conclusion.summary, /liquidity grab|taken/);
});

test('an unswept equal-high pool is a liquidity pool, not a signal', () => {
  const i = a.liquidity.findIndex((l) => l.sweptAt == null && l.takenAt == null);
  if (i < 0) return; // fixture-dependent
  const r = EX.explain(a, bars, 'liq', i, {});
  assert.match(r.title, /liquidity pool/);
  assert.match(r.conclusion.summary, /pool of resting orders/);
});

test('live order flow moves the conclusion in the direction of the flow', () => {
  const live = a.structure.orderBlocks.findIndex((o) => o.invalidAt == null && o.dir > 0);
  if (live < 0) return;
  const up = EX.explain(a, bars, 'ob', live, { flow: { buy: 90, sell: 10 } });
  const down = EX.explain(a, bars, 'ob', live, { flow: { buy: 10, sell: 90 } });
  assert.ok(up.conclusion.score > down.conclusion.score, 'buyer flow supports a demand block more than seller flow');
  assert.ok(up.evidence.some((e) => /order flow/i.test(e.text)));
});

test('an invalidated zone is never described as defended', () => {
  const i = a.structure.orderBlocks.findIndex((o) => o.invalidAt != null);
  if (i < 0) return;
  const r = EX.explain(a, bars, 'ob', i, {});
  assert.match(r.conclusion.summary, /failed/);
  assert.ok(r.facts.some(([k, v]) => k === 'Status' && /invalidated/.test(v)));
});

test('the whole-map conclusion weighs structure, location, VWAP, sweeps and flow', () => {
  const o = EX.overall(a, bars, { flow: { buy: 70, sell: 30 } });
  assert.ok(['bullish', 'bearish', 'neutral'].includes(o.bias));
  assert.ok(o.evidence.length >= 3);
  assert.ok(o.evidence.some((e) => /order flow/.test(e.text)));
  assert.match(o.purpose, /accumulation|distribution|mixed/);
  assert.match(o.note, /not a prediction/);
  assert.equal(EX.overall(null, bars), null);
});
