'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoopStallProfiler } = require('./loop-stall-profiler');

function burnTheLoopForAWhile(ms) { const end = Date.now() + ms; let x = 0; while (Date.now() < end) { x += Math.sqrt(x + 1); } return x; }

test('a synchronous block shows up by name with its self time when a stall is reported', async () => {
  const logs = [];
  const p = createLoopStallProfiler({ logger: (level, event, data) => logs.push({ level, event, data }), thresholdMs: 100, windowMs: 60_000 });
  assert.equal(p.enabled, true);
  assert.equal(await p.start(), true); assert.equal(p.running(), true);
  burnTheLoopForAWhile(250);
  const r = await p.onSample({ loopMax: 250, loopP99: 250 });
  assert.ok(r && r.top.length, 'a ranking came back');
  const hit = r.top.find((t) => t.fn === 'burnTheLoopForAWhile');
  assert.ok(hit, JSON.stringify(r.top)); assert.ok(hit.selfMs >= 150, 'self time ' + hit.selfMs); assert.match(hit.file, /loop-stall-profiler\.test\.js$/);
  const logged = logs.find((l) => l.event === 'loop_stall_profile');
  assert.equal(logged.level, 'warn'); assert.equal(logged.data.loopMaxMs, 250); assert.equal(logged.data.top[0].fn, hit.fn);
  assert.equal(p.running(), true, 'still inside the window: re-armed');
  await p.stop(); assert.equal(p.running(), false);
});

test('outside a window it idles, and a slow minute re-arms it; a quiet minute inside the window reports nothing', async () => {
  let clock = 1_000_000;
  const logs = [];
  const p = createLoopStallProfiler({ logger: (l, e) => logs.push(e), thresholdMs: 3_000, windowMs: 1_000, now: () => clock });
  await p.start();
  assert.equal(await p.onSample({ loopMax: 40, loopP99: 30 }), null); assert.equal(p.running(), true);
  clock += 2_000;
  await p.onSample({ loopMax: 40, loopP99: 30 }); assert.equal(p.running(), false, 'the window closed');
  await p.onSample({ loopMax: 40, loopP99: 900 }); assert.equal(p.running(), true, 'a slow minute opens another window');
  assert.ok(!logs.includes('loop_stall_profile'));
  await p.stop();
});

test('without an inspector it is harmlessly disabled', async () => {
  const p = createLoopStallProfiler({ inspector: { Session: class { connect() {} post(m, a, cb) { cb(new Error('nope')); } disconnect() {} } }, logger: () => {} });
  assert.equal(await p.start(), false); assert.equal(p.running(), false);
  assert.equal(await p.onSample({ loopMax: 9000, loopP99: 9000 }), null);
});
