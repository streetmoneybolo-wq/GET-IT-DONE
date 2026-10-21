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

const bar = (min, h, l, c) => ({ t: NOW + min * 60_000, o: c, h, l, c });
test('candles decide a call: a spike between polls counts, bars before the call do not, and a candle that touches both stop and target counts the stop', () => {
  const c = call({ at: NOW });
  const ev = L.judgeBars(c, [bar(-1, 130, 50, 100), bar(1, 101, 99, 100), bar(2, 104.5, 100, 104), bar(3, 105, 103, 104)], NOW + 5 * 60_000);
  assert.deepEqual(ev.map((e) => e.type + (e.n || '')), ['target1', 'target2']); assert.equal(c.hit, 2);
  assert.deepEqual(L.judgeBars(c, [bar(2, 104.5, 100, 104)], NOW + 6 * 60_000), [], 'a candle is never counted twice');
  const d = call({ at: NOW }); const e2 = L.judgeBars(d, [bar(1, 102.5, 97.5, 100)], NOW + 120_000);
  assert.equal(e2[0].type, 'stop'); assert.equal(e2[0].cautious, true); assert.equal(d.hit, 0);
  const s = call({ at: NOW, side: 'short', targets: [98, 96, 94], stop: 102 }); assert.equal(L.judgeBars(s, [bar(1, 100, 97.9, 99)], NOW + 120_000)[0].n, 1);
  const old = call({ at: NOW - L.CALL_LIFE_MS - 1 }); assert.equal(L.judgeBars(old, [], NOW)[0].type, 'expired');
});
const tt = (o = {}) => ({ ok: true, direction: 'long', price: 100, targets: [{ price: 102, pct: 2, prob: 55 }, { price: 104, pct: 4, prob: 35 }, { price: 106, pct: 6, prob: 20 }], stop: { price: 98 }, ...o });
test('the desk passes on stale, thin or already-moved ladders and says why', () => {
  assert.equal(L.vetCall(tt(), 100.2).ok, true); assert.equal(L.vetCall(tt(), 100.2).entry, 100.2);
  assert.match(L.vetCall(tt(), 101).reason, /stale/); assert.match(L.vetCall(tt(), 102.5).reason, /moved through/);
  assert.match(L.vetCall(tt({ targets: [{ price: 102, prob: 12 }, { price: 104 }, { price: 106 }] })).reason, /12 percent/);
  assert.match(L.vetCall(tt({ stop: { price: 90 } })).reason, /pays too little/); assert.equal(L.vetCall(tt({ targets: [] })).ok, false);
  assert.equal(L.vetCall(tt({ direction: 'short', targets: [{ price: 98, prob: 50 }, { price: 96 }, { price: 94 }], stop: { price: 102 } }), 99.9).ok, true);
});
test('progress reads in R and percent for either side; speech is split into short sentences', () => {
  const c = call(); assert.deepEqual(L.progress(c, 101), { r: 0.5, pct: 1, frac: 0.75 }); assert.equal(L.progress(call({ side: 'short', targets: [98, 96, 94], stop: 102 }), 99).r, 0.5);
  const parts = L.chunk('One short sentence. ' + 'word '.repeat(80) + 'end. Another one!'); assert.ok(parts.every((p) => p.length <= 175), parts.map((p) => p.length).join());
  assert.equal(parts[0], 'One short sentence.'); assert.ok(parts.length >= 4);
  const a = L.setupScript({ sym: 'A', why: [] }, tt({ confidence: 'low' }), null, { n: 1 }).map((x) => x.say).join(' '); assert.match(a, /Walls/); assert.doesNotMatch(a, /not advice/);
});

test('the desk says only short tags out loud: a ticker and a phrase from a small fixed bank, never the full read', () => {
  const all = [...L.OPENERS.long, ...L.OPENERS.short, ...Object.values(L.TARGET_SAY)];
  assert.ok(all.every((p) => p.length <= 28), 'every phrase is a few words');
  assert.ok(L.OPENERS.long.includes('Check this stock out.') && L.OPENERS.long.includes('This stock is running.'));
  const seen = new Set(); for (let i = 0; i < 40; i++) seen.add(L.opener('long')); assert.ok(seen.size > 1 && [...seen].every((p) => L.OPENERS.long.includes(p)));
  let prev = null; for (let i = 0; i < 40; i++) { const o = L.opener('long'); assert.notEqual(o, prev, 'never the same opener twice in a row'); prev = o; }
  assert.ok(L.OPENERS.short.includes(L.opener('short')));
  const src = fs.readFileSync(path.join(__dirname, 'academy-auto-live.js'), 'utf8');
  assert.doesNotMatch(src, /await speak\(s\.say\);/, 'no step reads its full text aloud');
});
