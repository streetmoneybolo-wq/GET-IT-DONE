'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const inst = require('./academy-institutional');

const dist = (o = {}) => ({ distribution: { capital_in_super: 5_000_000, capital_out_super: 1_000_000, capital_in_big: 3_000_000, capital_out_big: 2_000_000, capital_in_mid: 1_000_000, capital_out_mid: 2_000_000, capital_in_small: 500_000, capital_out_small: 1_500_000, ...o } });
const tape = (o = {}) => ({ vol: 1_000_000, sweepBuy: 60_000, sweepSell: 20_000, sweepN: 7, blockBuy: 50_000, blockSell: 10_000, blockN: 3, sweeps: [{ t: 1, dir: 'B', size: 9000 }], blocks: [], ...o });

test('moomoo size buckets split institutional (super+large) from retail (medium+small)', () => {
  const d = inst.readDistribution(dist().distribution);
  assert.equal(d.institutionalNet, 5_000_000); assert.equal(d.retailNet, -2_000_000);
  assert.ok(d.institutionalShare > 0.6);
  assert.equal(inst.readDistribution({}), null);
  assert.equal(inst.readDistribution({ in_super: 10, out_super: 4 }).institutionalNet, 6, 'alternate column spelling');
});

test('tape sweeps and blocks give a volume-weighted bias and a share of session volume', () => {
  const t = inst.readTape(tape());
  assert.equal(t.available, true); assert.ok(t.bias > 50); assert.equal(t.shareOfVolume, 0.14);
  assert.equal(inst.readTape({ vol: 100 }).available, false);
});

test('composite: institutions buying what retail sells, with both sources', () => {
  const r = inst.analyzeInstitutional({ capital: dist(), stats: tape() });
  assert.equal(r.available, true); assert.ok(r.bias > 40); assert.equal(r.label, 'institutions buying');
  assert.equal(r.coverage, 100); assert.equal(r.retailVsInstitutional, 'institutions buying what retail sells');
  assert.equal(r.notes.length, 0);
  assert.ok(/not a trade signal/.test(r.note));
});

test('one source alone still reads, disagreement is flagged, nothing => unavailable', () => {
  const only = inst.analyzeInstitutional({ capital: dist() });
  assert.equal(only.available, true); assert.equal(only.coverage, 60);
  const dis = inst.analyzeInstitutional({ capital: dist(), stats: tape({ sweepBuy: 5_000, sweepSell: 80_000, blockBuy: 0, blockSell: 90_000 }) });
  assert.ok(dis.notes.some((n) => /disagree/.test(n)));
  assert.equal(inst.analyzeInstitutional({}).available, false);
  assert.equal(inst.analyzeInstitutional({ stats: { vol: 10 } }).available, false);
});

test('service caches and tolerates a failing input', async () => {
  let calls = 0;
  const svc = inst.createInstitutionalService({ capital: async () => { calls++; throw new Error('bridge down'); }, tape: async () => tape(), now: () => 5 });
  const a = await svc.get('nvda'); const b = await svc.get('NVDA');
  assert.equal(a.ok, true); assert.equal(a.symbol, 'NVDA'); assert.equal(a.available, true); assert.equal(a.coverage, 40); assert.equal(calls, 1); assert.equal(a, b);
});
