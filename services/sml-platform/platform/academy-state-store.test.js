'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPgStateStore } = require('./academy-state-store');

function fakePool() {
  const rows = new Map(); let fail = false;
  return { rows, setFail: (v) => { fail = v; }, async query(sql, params) {
    if (fail) throw new Error('db down');
    if (/^SELECT/i.test(sql)) return { rows: rows.has(params[0]) ? [{ value: rows.get(params[0]) }] : [] };
    rows.set(params[0], JSON.parse(params[1])); return { rows: [] };
  } };
}
const def = () => ({ champion: null, pending: null, runs: [] });

test('persists and reads back, surviving a new store instance (a restart)', async () => {
  const pool = fakePool();
  await createPgStateStore({ pool, key: 'mem-lab', defaultValue: def }).write({ champion: { id: 7 }, pending: null, runs: [1] });
  const again = createPgStateStore({ pool, key: 'mem-lab', defaultValue: def });
  assert.deepEqual(await again.read(), { champion: { id: 7 }, pending: null, runs: [1] });
});

test('first run adopts the old file store content, then the table is the source of truth', async () => {
  const pool = fakePool();
  const file = { data: { champion: { id: 3 }, pending: null, runs: [] }, async read() { return this.data; }, async write(n) { this.data = n; } };
  const s = createPgStateStore({ pool, key: 'k', fallback: file, defaultValue: def });
  assert.equal((await s.read()).champion.id, 3);
  assert.equal(pool.rows.get('k').champion.id, 3);
});

test('a database outage never loses the in-memory copy and never throws', async () => {
  const pool = fakePool(), logs = [];
  const s = createPgStateStore({ pool, key: 'k', defaultValue: def, logger: (...a) => logs.push(a) });
  await s.write({ champion: { id: 1 }, pending: null, runs: [] });
  pool.setFail(true);
  await s.write({ champion: { id: 2 }, pending: null, runs: [] });
  assert.equal((await s.read()).champion.id, 2);
  assert.ok(logs.some((l) => l[1] === 'academy_state_write_failed'));
});

test('without a pool it behaves like the fallback / default', async () => {
  const s = createPgStateStore({ pool: null, key: 'k', defaultValue: def });
  assert.deepEqual(await s.read(), def());
  assert.equal(s.durable, false);
});
