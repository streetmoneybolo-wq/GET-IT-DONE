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
