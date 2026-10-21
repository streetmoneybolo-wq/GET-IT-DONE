'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./academy-auto-live');
const NOW = Date.UTC(2026, 9, 21, 15);

test('stocks named by several sources float up, fresh signals beat old, cooled-down and open ones are skipped', () => {
  const q = L.buildQueue({
    signals: [{ symbol: 'AAA', at: NOW - 600_000, grade: 'A', label: 'breakout' }, { symbol: 'OLD', at: NOW - 50 * 3_600_000, grade: 'A' }, { symbol: 'CCC', at: NOW - 3_600_000, grade: 'C' }],
    unusual: [{ sym: 'AAA', ratio: 12, chg: 4 }, { sym: 'BBB', ratio: 3, chg: -2 }], fda: [{ symbol: 'FDAX', daysAway: 1 }], earnings: [{ symbol: 'ERN', daysAway: 0 }],
    movers: [{ sym: 'BBB', chg: 6 }]
  }, { now: NOW, seen: { CCC: NOW - 60_000 }, skip: ['ERN'] });
  assert.equal(q[0].sym, 'AAA'); assert.ok(q[0].kinds.length === 2 && q[0].why.length === 2);
  const syms = q.map((c) => c.sym);
  assert.ok(!syms.includes('OLD') && !syms.includes('CCC') && !syms.includes('ERN'), syms.join());
  assert.ok(syms.includes('FDAX') && syms.includes('BBB'));
});

const call = (o) => ({ id: 'x', sym: 'AAA', side: 'long', entry: 100, targets: [102, 104, 106], stop: 98, at: NOW, hit: 0, status: 'open', ...o });

test('a call takes targets in order, can pass several at once, and is done after the last', () => {
  const c = call(); assert.deepEqual(L.judge(c, 101, NOW), []);
  assert.deepEqual(L.judge(c, 102.1, NOW).map((e) => e.n), [1]);
  assert.deepEqual(L.judge(c, 106.5, NOW).map((e) => e.type), ['target', 'target', 'done']); assert.equal(c.status, 'done');
});
test('a stop ends the call, before or after a target, and shorts work the other way', () => {
  const a = call(); assert.equal(L.judge(a, 97.9, NOW)[0].type, 'stop'); assert.equal(a.status, 'stopped');
  const b = call(); L.judge(b, 103, NOW); L.judge(b, 97, NOW); assert.equal(b.status, 'stopped_after_target');
  const s = call({ side: 'short', targets: [98, 96, 94], stop: 102 }); assert.equal(L.judge(s, 97.5, NOW)[0].n, 1); assert.equal(L.judge(s, 102.2, NOW)[0].type, 'stop');
  const late = call({ at: NOW - L.CALL_LIFE_MS - 1 }); assert.equal(L.judge(late, 100.5, NOW)[0].type, 'expired');
  assert.deepEqual(L.judge(a, 120, NOW), [], 'a closed call never changes');
});
test('the scoreboard is honest: stopped calls count, a win needs target 1', () => {
  const calls = [call({ hit: 2, status: 'stopped_after_target' }), call({ status: 'stopped' }), call({ status: 'stopped' }), call({ hit: 3, status: 'done' }), call(), call({ status: 'expired', exit: 100 })];
  const b = L.scoreboard(calls);
  assert.deepEqual([b.calls, b.open, b.wins, b.losses, b.flat, b.t2, b.t3, b.rate], [6, 1, 2, 2, 1, 2, 1, 50]);
  assert.ok(b.avgPct < 2 && b.avgPct != null);
});
test('the trade script points at the levels, names the odds and the stop, and says it is not advice', () => {
  const t = { direction: 'long', price: 100, confidence: 'medium', targets: [{ price: 102, pct: 2, prob: 61 }, { price: 104, pct: 4, prob: 40 }, { price: 106, pct: 6, prob: 22 }], stop: { price: 98, pct: 2, basis: 'just under VWAP at 98' }, rr: [1, 2, 3], notes: ['n'] };
  const s = L.setupScript({ sym: 'AAA', why: ['volume is 12x'] }, t, null);
  const pts = s.map((x) => x.point).filter(Boolean); assert.ok(pts.filter((p) => p.kind === 'price').length >= 5);
  const text = s.map((x) => x.say).join(' '); assert.match(text, /61 percent/); assert.match(text, /not advice/); assert.match(text, /Targets tool/);
});
test('market and catalyst scripts speak only what the data says', () => {
  const m = L.marketScript({ ok: true, bias: 40, label: 'Bullish', confidence: 70, components: [{ label: 'Tape' }] }, { level: 27 });
  assert.match(m.map((x) => x.say).join(' '), /bullish.*70 percent|70 percent/s); assert.match(m[m.length - 1].say, /27\.0.*elevated/);
  assert.equal(L.catalystScript([], []).length, 0);
  assert.match(L.catalystScript([{ kind: 'scheduled', symbol: 'ABCD', daysAway: 2 }], [])[0].say, /ABCD in 2 days/);
});
test('the desk speaks in the owner voice with the browser voice as the fallback, is owner-only and places no orders', () => {
  const src = fs.readFileSync(path.join(__dirname, 'academy-auto-live.js'), 'utf8');
  assert.match(src, /\/academy-activity\/desk-speech/); assert.match(src, /speechSynthesis/, 'the free browser voice is still the fallback');
  assert.match(src, /owner_only/); assert.match(src, /signals\?limit=1/);
  assert.deepEqual([...src.matchAll(/method:\s*'POST'/g)].length, 1, 'the only POST is the voice line');
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'); assert.match(server, /autoLiveUi \? '<script>'/);
  assert.match(fs.readFileSync(path.join(__dirname, 'academy-desktop-compact.js'), 'utf8'), /'auto-live-btn'/);
});
