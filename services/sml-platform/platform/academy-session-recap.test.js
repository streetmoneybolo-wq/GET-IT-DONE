'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('./academy-session-recap');
const C = require('./academy-session-recap-chart');

const MIN = 60000;
const OPEN = Date.UTC(2026, 9, 14, 13, 30); // 09:30 New York, 14 October 2026
const at = (hh, mm, dayOffset = 0) => OPEN + ((hh * 60 + mm) - (9 * 60 + 30)) * MIN + dayOffset * 24 * 60 * MIN;
/* a 5-minute day shaped like a sellers' session: a gap down, a pop to the morning high, a flush through the put wall to the day low after 13:00, a covering bounce into the close */
function sellersDay() {
  const b = [];
  const push = (t, o, c, v = 50000) => b.push({ t, o, h: Math.max(o, c) + 0.3, l: Math.min(o, c) - 0.3, c, v });
  for (let i = 0; i < 20; i++) push(at(9, 30 - 100 + i * 5, -1), 660 + i * 0.2, 660 + (i + 1) * 0.2);           // yesterday's close at 664
  for (let i = 0; i < 18; i++) push(at(8, 0) + i * 5 * MIN, 661 - i * 0.05, 661 - (i + 1) * 0.05);          // pre-market drifts to 660.1
  let p = 659;
  const leg = (n, step) => { for (let i = 0; i < n; i++) { push(b[b.length - 1].t + 5 * MIN, p, p + step); p += step; } };
  push(at(9, 30), 659, 659.5); p = 659.5;
  leg(8, 0.45);    // 09:35 to 10:15 up to the morning high ~663.1
  leg(14, -0.5);   // down through the IB low to ~656
  leg(10, 0.2);    // bounce into 13:00 ~658
  leg(12, -0.6);   // afternoon flush to the day low ~650.8 (through the put wall at 652)
  leg(14, 0.25);   // covering rally into ~654.3
  const rest = Math.floor((at(16, 0) - b[b.length - 1].t) / (5 * MIN)) - 1;
  leg(Math.max(0, rest), 0.05);
  return b;
}
const GAMMA = { available: true, regime: 'negative', callWall: { strike: 670 }, putWall: { strike: 652 }, flipStrike: 666 };

test('the recap reads a sellers\' day in order: gap, morning high, IB loss, put wall, day low, close, with lettered markers in time order', () => {
  const r = R.compose({ symbol: 'SPY', bars: sellersDay(), now: at(16, 30), gamma: GAMMA, events: [{ label: 'Jobs report 8:30 am ET', date: '2026-10-15' }] });
  assert.equal(r.ok, true); assert.equal(r.day, '2026-10-14'); assert.equal(r.closed, true);
  assert.equal(r.prevClose, 664);
  const letters = r.events.map((e) => e.letter).join('');
  assert.equal(letters, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, r.events.length));
  for (let i = 1; i < r.events.length; i++) assert.ok(r.events[i].t > r.events[i - 1].t, 'markers in time order');
  const kinds = r.events.map((e) => e.kind);
  assert.equal(kinds[0], 'open'); assert.equal(kinds[kinds.length - 1], 'close');
  assert.ok(kinds.includes('dayHigh') || kinds.includes('mornHigh')); assert.ok(kinds.includes('dayLow')); assert.ok(kinds.includes('ibBreak')); assert.ok(kinds.includes('putWall'));
  const m = r.sections.morning, a = r.sections.afternoon, t = r.sections.tomorrow;
  assert.match(m, /The pre-market ranged/); assert.match(m, /Dealer gamma was negative with the call wall at 670\.00 and the put wall at 652\.00, the flip at 666\.00/);
  assert.match(m, /We opened at 659\.00, 5\.00 points below yesterday's close/); assert.match(m, /Initial Balance set up/); assert.match(m, /lost the Initial Balance low/); assert.match(m, /Into 13:00 we were at/);
  assert.match(a, /put wall at 652\.00 \(/); assert.match(a, /the day low at 65\d\.\d\d \(/); assert.match(a, /We closed at/); assert.match(a, /Sellers had the day/);
  assert.match(t, /^We close at/); assert.match(t, /negative gamma, so moves stay fast/); assert.match(t, /Above, /); assert.match(t, /Below, /); assert.match(t, /Tomorrow brings Jobs report 8:30 am ET\./);
  assert.ok(r.chartInput.bars.length > 90 && r.chartInput.markers.length === r.events.length, 'the chart gets every marker');
  assert.ok(r.chartInput.regime.every((x) => x === 'negative'), 'every bar below the flip is negative gamma');
});

test('before 13:00 the recap says the afternoon has not started, and before the open it says there is no session yet', () => {
  const r = R.compose({ symbol: 'SPY', bars: sellersDay(), now: at(11, 0), gamma: null });
  assert.equal(r.ok, true); assert.equal(r.closed, false);
  assert.equal(r.sections.afternoon, 'The afternoon session has not started.');
  assert.ok(!r.events.some((e) => e.kind === 'close'));
  assert.match(r.sections.tomorrow, /Nothing scheduled on the calendar for tomorrow\./);
  const early = R.compose({ symbol: 'SPY', bars: sellersDay(), now: at(9, 0) });
  assert.equal(early.ok, false); assert.equal(early.error, 'no_session_yet');
  assert.equal(R.compose({ symbol: 'SPY', bars: [] }).error, 'bars_unavailable');
});

test('the chart is one SVG with the candles, VWAP, bands, the Initial Balance, the walls and every letter, and never a script', () => {
  const r = R.compose({ symbol: 'SPY', bars: sellersDay(), now: at(16, 30), gamma: GAMMA });
  const pic = R.svgFor(r);
  assert.equal(pic.ok, true); assert.ok(pic.svg.startsWith('<svg')); assert.ok(!/<script/i.test(pic.svg));
  for (const e of r.events) assert.ok(pic.svg.includes('>' + e.letter + '</text>'), 'letter ' + e.letter);
  assert.match(pic.svg, /CALL WALL 670\.00/); assert.match(pic.svg, /PUT WALL 652\.00/); assert.match(pic.svg, /GAMMA FLIP 666\.00/);
  assert.match(pic.svg, /IB 6\d\d\.\d\d to 6\d\d\.\d\d/); assert.match(pic.svg, /PREV CLOSE 664\.00/); assert.match(pic.svg, /stroke="#ffd166" stroke-width="2.6"/);
  assert.match(pic.svg, />09:30</); assert.match(pic.svg, />15:30</);
  assert.equal(C.intradaySvg({ bars: [] }).ok, false);
});

test('the service builds from injected bars and gamma, posts once per trading day after the close, and never twice', async () => {
  const posts = []; let state = { posted: {} };
  const svc = R.createSessionRecap({
    barsFor: async () => sellersDay(), gamma: async () => GAMMA, calendar: () => [{ date: '2026-10-15', label: 'Jobs report 8:30 am ET', daysAway: 1 }],
    dayInfo: (y, m, d) => ({ tradingDay: true }), png: () => Buffer.from('png'), post: async (channelId, body, files) => { posts.push({ channelId, body, files }); return { id: '1' }; },
    store: { read: async () => state, write: async (v) => { state = v; } }, channelId: '1551968149132279908', symbol: 'SPY', now: () => at(16, 10)
  });
  const r = await svc.build({ symbol: 'SPY', t: at(16, 10) });
  assert.equal(r.ok, true); assert.ok(r.svg.startsWith('<svg')); assert.match(r.sections.tomorrow, /Jobs report/);
  assert.deepEqual(await svc.tick(at(15, 0)), { ok: false, error: 'outside_window' });
  const first = await svc.tick(at(16, 10)); assert.equal(first.ok, true); assert.equal(posts.length, 1);
  assert.equal(posts[0].channelId, '1551968149132279908'); assert.equal(posts[0].files[0].contentType, 'image/png'); assert.match(posts[0].files[0].name, /^spy-session-recap-2026-10-14\.png$/);
  assert.equal(posts[0].body.embeds[0].fields.length, 3); assert.equal(posts[0].body.embeds[0].image.url, 'attachment://' + posts[0].files[0].name);
  assert.deepEqual(await svc.tick(at(16, 20)), { ok: false, error: 'already_posted' }); assert.equal(posts.length, 1);
  assert.ok(state.posted['2026-10-14']);
  const noChannel = R.createSessionRecap({ barsFor: async () => [], post: async () => {} });
  assert.deepEqual(await noChannel.tick(at(16, 10)), { ok: false, error: 'no_channel' });
});

test('tomorrow skips the weekend and holidays when picking the calendar day', () => {
  const up = [{ date: '2026-10-16', label: 'Opex' }, { date: '2026-10-19', label: 'Monday thing' }, { date: '2026-10-17', label: 'Saturday thing' }];
  const friday = Date.UTC(2026, 9, 16, 21, 0);
  assert.deepEqual(R.nextTradingDayEvents(up, null, friday).map((e) => e.label), ['Monday thing']);
  const holidayMonday = (y, m, d) => ({ tradingDay: !(m === 10 && d === 19) && ![0, 6].includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay()) });
  assert.deepEqual(R.nextTradingDayEvents(up.concat([{ date: '2026-10-20', label: 'Tuesday thing' }]), holidayMonday, friday).map((e) => e.label), ['Tuesday thing']);
});
