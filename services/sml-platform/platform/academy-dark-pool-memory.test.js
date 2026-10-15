'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDarkPoolMemory } = require('./academy-dark-pool-memory');

const summary = (notional, size, price, share = 45) => ({ available: true, offSharePct: share, typicalSharePct: 40, offVolume: 1e6, lean: { offExchange: 0.1 }, blocks: { count: 1, volume: size, sharePct: 5, rule: '10,000+ shares or $1M+', list: [{ t: 1, price, size, notional, dir: 'B' }] }, largest: [{ t: 1, price, size, notional, dir: 'B' }], window: { full: true } });

test('remembers the biggest print per session, keeps ten sessions, and reads today against yesterday', async () => {
  let saved = null, t = 0;
  const store = { read: async () => saved, write: async (v) => { saved = JSON.parse(JSON.stringify(v)); } };
  const m = createDarkPoolMemory({ store, now: () => t, saveEveryMs: 1000 });
  const d1 = await m.annotate('SPY', summary(97e6, 126_000, 777), { date: '2026-10-14', price: 777 });
  assert.match(d1.read.steps[1].text, /No earlier session on record/);
  await m.annotate('SPY', summary(60e6, 80_000, 778), { date: '2026-10-14', price: 778 }); // a later, smaller read the same day keeps the bigger print
  assert.equal(m.history('SPY')[0].largest.notional, 97e6);
  t = 5000;
  const d2 = await m.annotate('SPY', summary(384e6, 500_000, 769.12, 52), { date: '2026-10-15', price: 769.4 });
  assert.equal(d2.vsYesterday.date, '2026-10-14'); assert.equal(d2.vsYesterday.largestRatio, 3.96);
  assert.match(d2.read.headline, /4x yesterday's biggest/);
  await m.save(true);
  assert.ok(saved && saved.symbols.SPY.length === 2, 'persisted');
  for (let i = 1; i <= 12; i++) await m.annotate('SPY', summary(1e6 * i, 10_000, 100), { date: '2026-11-' + String(i).padStart(2, '0') });
  assert.equal(m.history('SPY').length, 10);
  const fresh = createDarkPoolMemory({ store });
  await fresh.load();
  assert.ok(fresh.history('SPY').length >= 2, 'loads what was saved');
  assert.deepEqual(await m.annotate('X', { available: false }, { date: '2026-10-15' }), { available: false });
});

test("a block reported before 4:00 AM ET belongs to yesterday: it leaves today's blocks, largest prints, footprint and read", async () => {
  const m = createDarkPoolMemory({});
  const late = { t: 100, price: 777, size: 500_000, notional: 388_500_000, dir: 'S' }, today = { t: 5000, price: 769, size: 40_000, notional: 30_760_000, dir: 'B' };
  const sum = { ...summary(388_500_000, 500_000, 777), offVolume: 2e6, blocks: { count: 2, volume: 540_000, sharePct: 27, rule: '10,000+ shares or $1M+', list: [late, today] }, largest: [late, today] };
  const d = await m.annotate('SPY', sum, { date: '2026-10-15', price: 769, sinceMs: 1000 });
  assert.deepEqual(d.largest, [today]); assert.equal(d.blocks.count, 1); assert.equal(d.blocks.volume, 40_000); assert.match(d.blocks.note, /before 4:00 AM ET/);
  assert.match(d.read.headline, /\$30\.8M block at \$769\.00/);
  assert.equal(m.history('SPY', '2026-10-15')[0].date, '2026-10-14', 'the dropped print is remembered as yesterday');
  assert.deepEqual([m.history('SPY', '2026-10-15')[0].largest.size, m.history('SPY', '2026-10-15')[0].afterHours], [500_000, true]);
  assert.equal(m.history('SPY')[1].largest.size, 40_000);
  assert.equal(d.afterHours.count, 1); assert.equal(d.afterHours.largest[0].size, 500_000); assert.match(d.afterHours.note, /benchmark/);
  assert.match(d.read.steps[1].text, /Yesterday's biggest was 500,000 shares at \$777\.00 \(\$389M, reported after the close\)\. Today's is under half smaller/);
  assert.equal(m.prevTradingDate('2026-10-19'), '2026-10-16', 'Monday looks back to Friday');
  const same = await m.annotate('QQQ', { ...sum, blocks: { ...sum.blocks, list: [today] }, largest: [today] }, { date: '2026-10-15', sinceMs: 1000 });
  assert.ok(!same.blocks.note, 'nothing removed, nothing said');
});
