'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAlertRecord, settleAlert, summarize, movePct, WINDOW_MS } = require('./academy-alert-record');

const DAY = 86_400_000, H = 3_600_000;
const T0 = Date.parse('2026-10-06T14:00:00Z');
const OWNER = '1087769175453339648', ANA = '200000000000000001', BEN = '200000000000000002';
const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 1000 });

test('settleAlert: a long is a WIN when the target trades, STOPPED when the stop trades first, MISSED when the horizon runs out', () => {
  const a = { side: 'long', entry: 10, target: 12, stop: 9, horizon: 'swing', alertedAt: T0, status: 'open' };
  const win = settleAlert(a, [bar(T0 + H, 10, 11, 9.5, 10.8), bar(T0 + 2 * H, 10.8, 12.4, 10.5, 12.1)], T0 + DAY);
  assert.equal(win.result, 'win'); assert.equal(win.status, 'closed'); assert.equal(win.closePct, 20); assert.equal(win.peakPct, 24); assert.equal(win.peakAt, T0 + 2 * H); assert.equal(win.lastPct, 21);
  const stopped = settleAlert(a, [bar(T0 + H, 10, 10.5, 8.9, 9.2)], T0 + DAY);
  assert.equal(stopped.result, 'stopped'); assert.equal(stopped.closePct, -10); assert.equal(stopped.peakPct, 5);
  const both = settleAlert(a, [bar(T0 + H, 10, 12.5, 8.5, 11)], T0 + DAY);
  assert.equal(both.result, 'stopped', 'a bar through both counts the stop first');
  const missed = settleAlert(a, Array.from({ length: 16 }, (_, i) => bar(T0 + (i + 1) * DAY, 10, 11, 9.5, 10.5)), T0 + 20 * DAY);
  assert.equal(missed.result, 'missed'); assert.equal(missed.closePct, 5); assert.equal(missed.peakPct, 10);
  const open = settleAlert(a, [bar(T0 + H, 10, 11, 9.5, 10.5)], T0 + DAY);
  assert.equal(open.status, 'open'); assert.equal(open.lastPct, 5); assert.equal(open.peakPct, 10);
  assert.equal(settleAlert(a, [bar(T0 - H, 10, 15, 5, 10)], T0 + DAY).peakPct, null, 'bars before the alert do not count');
  assert.equal(settleAlert(a, [], T0 + 401 * DAY).result, 'abandoned');
});

test('settleAlert: a short wins on the way down and the peak is the low', () => {
  const a = { side: 'short', entry: 20, target: 16, stop: 22, horizon: 'day', alertedAt: T0, status: 'open' };
  const s = settleAlert(a, [bar(T0 + H, 20, 20.5, 17, 18), bar(T0 + 2 * H, 18, 18.5, 15.8, 16.5)], T0 + DAY);
  assert.equal(s.result, 'win'); assert.equal(s.peakPct, 21); assert.equal(s.closePct, 20); assert.equal(s.lastPct, 17.5);
  assert.equal(settleAlert(a, [bar(T0 + H, 20, 22.1, 19, 21)], T0 + DAY).result, 'stopped');
  assert.equal(movePct('short', 20, 18), 10); assert.equal(movePct('long', 20, 18), -10); assert.equal(movePct('long', 0, 18), null);
});

test('summarize: the 90-day win rate counts closed alerts in the window only, the top ten are the best peaks of all time', () => {
  const now = T0 + 100 * DAY;
  const rows = [];
  for (let i = 0; i < 14; i++) rows.push({ id: String(i), symbol: 'S' + i, side: 'long', entry: 10, alertedAt: T0 + i * DAY + 20 * DAY, status: 'closed', result: i % 3 === 0 ? 'stopped' : 'win', peakPct: i * 2, peakAt: T0 + i * DAY + 20 * DAY + H * (i + 1) });
  rows.push({ id: 'old', symbol: 'OLD', side: 'long', entry: 10, alertedAt: T0, status: 'closed', result: 'win', peakPct: 99, peakAt: T0 + 3 * H });
  rows.push({ id: 'open', symbol: 'OPN', side: 'long', entry: 10, alertedAt: now - DAY, status: 'open', result: null, peakPct: 1, peakAt: now - H });
  const s = summarize(rows, now);
  assert.equal(s.ninetyDay.alerts, 15, 'the old alert is outside the window'); assert.equal(s.ninetyDay.open, 1);
  assert.equal(s.ninetyDay.closed, 14); assert.equal(s.ninetyDay.wins, 9); assert.equal(s.ninetyDay.stopped, 5); assert.equal(s.ninetyDay.winRatePct, 64);
  assert.equal(s.allTime.closed, 15); assert.equal(s.allTime.wins, 10); assert.equal(s.allTime.winRatePct, 67);
  assert.equal(s.top.length, 10); assert.equal(s.top[0].symbol, 'OLD'); assert.equal(s.top[0].timeToPeakMs, 3 * H); assert.equal(s.top[1].symbol, 'S13');
  assert.equal(s.firstAt, T0); assert.equal(s.ninetyDay.sinceMs, now - WINDOW_MS);
  assert.equal(summarize([], now).ninetyDay.winRatePct, null);
});

function harness({ now = () => T0 + 3 * DAY, quote = null } = {}) {
  const bars = { ABC: [bar(T0 + H, 10, 10.5, 9.8, 10.2), bar(T0 + 2 * H, 10.2, 12.2, 10.1, 12), bar(T0 + 3 * H, 12, 12.5, 11.5, 12.3)], XYZ: [bar(T0 + H, 5, 5.2, 4.4, 4.5)], OLD: [] };
  const clicks = [
    { userId: ANA, messageId: '9001', symbol: 'ABC', side: 'long', entry: 10, target: 12, stop: 9, horizon: 'swing', at: T0 },
    { userId: ANA, messageId: '9002', symbol: 'XYZ', side: 'long', entry: 5, target: 6, stop: 4.5, horizon: 'day', at: T0 + 10 * 60_000 },
    { userId: BEN, messageId: '9003', symbol: 'ABC', side: 'long', entry: 10.5, target: 11, stop: 10, horizon: 'swing', at: T0 + H },
    { userId: ANA, messageId: '8000', symbol: 'OLD', side: 'long', entry: 1, target: 2, stop: 0.5, horizon: 'swing', at: T0 - 60 * DAY }
  ];
  const desk = [
    { id: '7001', symbol: 'ABC', entry: 10, target: 12, at: T0 + 2 * 60_000, authorId: OWNER, channel: 'swings' },
    { id: '7002', symbol: 'ABC', entry: 10, target: 12, at: T0 + 3 * 60_000, authorId: '', channel: 'longterm' },
    { id: '9001', symbol: 'ABC', entry: 10, target: 12, at: T0, authorId: ANA, channel: 'swings', via: 'academy' },
    { id: '7003', symbol: 'ABC', entry: 10, target: 12, at: T0 - 5 * DAY, authorId: OWNER, channel: 'swings' }
  ];
  const logs = [];
  const svc = createAlertRecord({ candles: async (s) => ({ bars: bars[s] || [] }), quote, clickAlerts: async () => clicks, deskAlerts: async () => desk, backfill: async (since) => { logs.push(['backfill', since]); return 3; }, ownerIds: [OWNER], since: '2026-10-05', now, logger: (l, e, d) => logs.push([l, e, d]), timers: { setTimeout: () => ({ unref() {} }), clearTimeout() {}, setInterval: () => ({ unref() {} }), clearInterval() {} } });
  return { svc, logs, clicks, desk };
}

test('the record keeps each click alert once, attributes desk alerts to the owner and skips the Academy copies, then scores them', async () => {
  const { svc, logs } = harness();
  assert.equal(svc.sinceMs, Date.parse('2026-10-05T00:00:00-04:00'));
  const r = await svc.sweep();
  assert.deepEqual(r.added, { click: 3, desk: 2 }, 'the pre-start click alert and the pre-start desk alert stay out; the academy copy is one alert, not two');
  assert.equal(r.settled, 5); assert.equal(r.closed, 5, 'ABC hit 12 for everyone, XYZ stopped');
  const again = await svc.sweep(); assert.deepEqual(again.added, { click: 0, desk: 0 }, 'idempotent');
  const ana = await svc.summary(ANA);
  assert.equal(ana.ninetyDay.alerts, 2); assert.equal(ana.ninetyDay.wins, 1); assert.equal(ana.ninetyDay.stopped, 1); assert.equal(ana.ninetyDay.winRatePct, 50);
  assert.equal(ana.top[0].symbol, 'ABC'); assert.equal(ana.top[0].peakPct, 22, 'the peak is the bar that closed the alert; the later high does not count'); assert.equal(ana.top[0].timeToPeakMs, 2 * H); assert.equal(ana.top[0].result, 'win');
  assert.equal(ana.top[1].symbol, 'XYZ'); assert.equal(ana.top[1].result, 'stopped');
  const owner = await svc.summary(OWNER);
  assert.equal(owner.allTime.alerts, 2); assert.deepEqual(owner.top.map((x) => [x.symbol, x.horizon, x.side]), [['ABC', 'swing', 'long'], ['ABC', 'long', 'long']]);
  const ben = await svc.summary(BEN);
  assert.equal(ben.ninetyDay.open, 0); assert.equal(ben.ninetyDay.wins, 1, 'BEN\'s target of 11 traded in the 2nd bar');
  assert.equal(await svc.summary('nope'), null);
  assert.ok(logs.some((l) => l[1] === 'alert_record_sweep'));
  await svc.backfillDesk(); await svc.backfillDesk();
  assert.equal(logs.filter((l) => l[0] === 'backfill').length, 1, 'the desk history is read once per process');
  assert.deepEqual(logs.find((l) => l[1] === 'alert_record_backfill')[2], { since: '2026-10-05', read: 3 });
});

test('the summary refreshes the top rows from the live quote and remembers the result for two minutes', async () => {
  let t = T0 + 3 * DAY, quotes = 0;
  const { svc } = harness({ now: () => t, quote: async (s) => { quotes += 1; return s === 'ABC' ? { last: 15 } : null; } });
  await svc.sweep();
  const a = await svc.summary(ANA);
  assert.equal(a.top[0].lastPct, 50); assert.equal(a.top[0].live, true); assert.equal(a.top[1].live, undefined); assert.equal(a.top[1].lastPct, -10);
  const n = quotes; await svc.summary(ANA); assert.equal(quotes, n, 'cached');
  t += 3 * 60_000; await svc.summary(ANA); assert.ok(quotes > n, 'refreshed after two minutes');
});

test('keep() rejects bad rows and the horizon falls back to swing', async () => {
  const { svc } = harness();
  assert.equal(await svc.keep({ userId: 'x', source: 'click', ref: '1', symbol: 'ABC', entry: 10, alertedAt: T0 }), false);
  assert.equal(await svc.keep({ userId: ANA, source: 'click', ref: '2', symbol: '', entry: 10, alertedAt: T0 }), false);
  assert.equal(await svc.keep({ userId: ANA, source: 'click', ref: '3', symbol: 'ABC', entry: 0, alertedAt: T0 }), false);
  assert.equal(await svc.keep({ userId: ANA, source: 'click', ref: '4', symbol: 'abc', entry: 10, horizon: 'weird', alertedAt: T0 }), true);
  assert.equal(await svc.keep({ userId: ANA, source: 'click', ref: '4', symbol: 'ABC', entry: 10, alertedAt: T0 }), false, 'same (source, ref) once');
  const rows = await svc.rowsOf(ANA); assert.equal(rows.length, 1); assert.equal(rows[0].symbol, 'ABC'); assert.equal(rows[0].horizon, 'swing'); assert.equal(rows[0].side, 'long');
});
