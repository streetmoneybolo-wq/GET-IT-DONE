'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fromRecord, fromChart, merge, createAlertLevels, HIT_KEEP_MS } = require('./academy-alert-levels');
const { linkFollowUps } = require('./academy-alert-record');

const NOW = Date.UTC(2026, 9, 21, 15, 0, 0), H = 3_600_000, ME = '111111111111111111';
const row = (o) => ({ id: String(o.id), ref: String(o.id), userId: ME, source: 'click', symbol: 'AHT', side: 'long', entry: 100, target: 110, stop: 95, horizon: 'swing', alertedAt: NOW - 5 * H, status: 'open', result: null, closedAt: null, ...o });

test('an open alert shows its current target, entry and stop as a live line', () => {
  const l = fromRecord(linkFollowUps([row({ id: 1 })]), { symbol: 'AHT', now: NOW });
  assert.equal(l.length, 1); assert.deepEqual([l[0].state, l[0].entry, l[0].target, l[0].stop, l[0].side], ['live', 100, 110, 95, 'long']);
  assert.equal(fromRecord(linkFollowUps([row({ id: 1 })]), { symbol: 'NVDA', now: NOW }).length, 0, 'only the ticker on the chart');
});

test('a stopped, missed or abandoned trade shows nothing; a reached target shows as HIT for a day, then goes', () => {
  for (const result of ['stopped', 'missed', 'abandoned']) assert.equal(fromRecord(linkFollowUps([row({ id: 2, result, status: 'closed', closedAt: NOW - H })]), { now: NOW }).length, 0, result);
  const hit = fromRecord(linkFollowUps([row({ id: 3, result: 'win', closedAt: NOW - 2 * H })]), { now: NOW });
  assert.equal(hit.length, 1); assert.equal(hit[0].state, 'hit');
  assert.equal(fromRecord(linkFollowUps([row({ id: 3, result: 'win', closedAt: NOW - HIT_KEEP_MS - H })]), { now: NOW }).length, 0, 'a day later the win is out of the way');
});

test('a PT SMASHED follow-up moves the line to the new target and the old one is only remembered', () => {
  const first = row({ id: 10, alertedAt: NOW - 20 * H, result: 'win', closedAt: NOW - 10 * H, peakPct: 11 });
  const follow = row({ id: 11, alertedAt: NOW - 9 * H, entry: 110, target: 120, stop: 106 });
  const l = fromRecord(linkFollowUps([first, follow]), { symbol: 'AHT', now: NOW });
  assert.equal(l.length, 1, 'one trade, one line'); assert.deepEqual([l[0].state, l[0].target, l[0].entry, l[0].stop, l[0].smashed], ['live', 120, 100, 106, 1]);
});

test('the Alert Chart: the first target not yet hit is the line; all hit means HIT; closed or locked alerts show nothing', () => {
  const a = (o) => ({ id: 5, status: 'open', locked: false, symbol: 'NVDA', side: 'long', entry: 100, stop: 96, createdAt: new Date(NOW - H).toISOString(), targets: [{ price: 104, hit: true }, { price: 108, hit: false }, { price: 112, hit: false }], ...o });
  assert.deepEqual([fromChart([a()])[0].state, fromChart([a()])[0].target, fromChart([a()])[0].smashed], ['live', 108, 1]);
  assert.equal(fromChart([a({ targets: [{ price: 104, hit: true }] })])[0].state, 'hit');
  assert.equal(fromChart([a({ status: 'closed' })]).length, 0); assert.equal(fromChart([a({ locked: true })]).length, 0);
  assert.equal(fromChart([a()], { symbol: 'AAPL' }).length, 0);
});

test('merge shows the same trade once and the service answers for one member and symbol', async () => {
  const dup = [{ symbol: 'AHT', side: 'long', target: 110, alertedAt: 2 }, { symbol: 'AHT', side: 'long', target: 110.001, alertedAt: 1 }, { symbol: 'AHT', side: 'long', target: 120, alertedAt: 3 }];
  assert.equal(merge(dup, []).length, 2);
  const svc = createAlertLevels({ record: { rowsOf: async () => [row({ id: 1 }), row({ id: 2, symbol: 'NVDA' })] }, traderAlerts: { list: async () => ({ ok: true, alerts: [{ id: 9, status: 'open', locked: false, symbol: 'AHT', side: 'short', entry: 100, stop: 105, createdAt: new Date(NOW).toISOString(), targets: [{ price: 90, hit: false }] }] }) }, now: () => NOW });
  const r = await svc.forMember(ME, 'aht'); assert.equal(r.ok, true); assert.equal(r.levels.length, 2); assert.deepEqual(r.levels.map((x) => x.source).sort(), ['chart', 'record']);
  assert.equal((await svc.forMember('x', 'AHT')).error, 'invalid_user');
});

test('the chart layer: weight by distance, colours by role, edge chips, smart-range registration, refresh after a post', () => {
  const fs = require('fs'), path = require('path');
  const ui = fs.readFileSync(path.join(__dirname, 'academy-alert-levels-ui.js'), 'utf8'), srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(ui, /dist <= 0\.004 \? 3/); assert.match(ui, /#ffd166/); assert.match(ui, /#ffb04a/); assert.match(ui, /#4dc3ff/); assert.match(ui, /smlChartLevels\.register\('my-alerts'/); assert.match(ui, /ALERT TARGET /);
  assert.match(srv, /\/academy-activity\/my-alert-levels/); assert.match(srv, /alertLevelsUi/);
  assert.match(fs.readFileSync(path.join(__dirname, 'academy-click-alert-ui.js'), 'utf8'), /smlAlertLevels\.refresh/);
});
