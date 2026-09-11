'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNewsFlow, canClaimNewsJob, GAP_MS } = require('./news-flow');

function harness(runOnce) {
  const timers = new Map(); let next = 0; const results = []; const errors = [];
  const flow = createNewsFlow({ runOnce, onResult: r => results.push(r), onError: e => errors.push(e),
    schedule: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; }, cancel: id => timers.delete(id) });
  async function fire() { const [id, entry] = timers.entries().next().value; timers.delete(id); return entry.fn(); }
  return { flow, timers, results, errors, fire };
}
test('one job per cycle, full 20 second gap after completion, no batch', async () => {
  let calls = 0; const h = harness(async () => { calls++; return true; });
  h.flow.start(); h.flow.start();
  assert.equal(h.timers.size, 1); assert.equal(calls, 0);
  assert.equal(h.timers.values().next().value.ms, 20000);
  await h.fire(); assert.equal(calls, 1); assert.deepEqual(h.results, [true]);
  assert.equal(h.timers.size, 1); assert.equal(h.timers.values().next().value.ms, GAP_MS);
  await h.fire(); assert.equal(calls, 2); await h.flow.stop(); assert.equal(h.timers.size, 0);
});
test('a long job cannot overlap or queue a catch-up burst', async () => {
  let release; let calls = 0;
  const h = harness(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  h.flow.start(); const pending = h.fire(); await Promise.resolve();
  assert.equal(calls, 1); assert.equal(h.timers.size, 0);
  release(true); await pending;
  assert.equal(h.timers.size, 1); assert.equal(h.timers.values().next().value.ms, GAP_MS);
  await h.flow.stop();
});
test('empty queue and errors retain pacing, not a tight loop', async () => {
  const empty = harness(async () => false); empty.flow.start(); await empty.fire();
  assert.deepEqual(empty.results, [false]); assert.equal(empty.timers.size, 1); await empty.flow.stop();
  const bad = harness(async () => { throw new Error('test'); }); bad.flow.start(); await bad.fire();
  assert.equal(bad.errors.length, 1); assert.equal(bad.timers.values().next().value.ms, GAP_MS); await bad.flow.stop();
});
test('shutdown drains existing job without scheduling another', async () => {
  let release; const h = harness(() => new Promise(resolve => { release = resolve; }));
  h.flow.start(); const pending = h.fire(); await Promise.resolve();
  const stopped = h.flow.stop(); release(true); await Promise.all([pending, stopped]);
  assert.equal(h.timers.size, 0);
});
test('competing database claim fails closed before recovery/query work', async () => {
  const sql = []; const client = { query: async q => { sql.push(q); return { rows: [{ acquired: false }] }; } };
  assert.equal(await canClaimNewsJob(client), false); assert.equal(sql.length, 1);
  assert.match(sql[0], /pg_try_advisory_xact_lock/);
});
for (const blocked of [true, false, undefined]) {
  test(`database respects global processing/cooldown state ${blocked}`, async () => {
    const sql = []; const client = { query: async q => {
      sql.push(q); return { rows: [sql.length === 1 ? { acquired: true } : sql.length === 3 ? { blocked } : {}] };
    } };
    assert.equal(await canClaimNewsJob(client), blocked === false);
    assert.match(sql[1], /15 minutes/); assert.match(sql[2], /20 seconds/);
    assert.match(sql[2], /status='processing'/); assert.match(sql[2], /'rejected','failed','retry'/);
  });
}
