'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./academy-alert-routing');

test('channel names are read for options, stocks, free, paid and the time frame', () => {
  const o = R.classifyChannel('🔥│free-options-flow', 'FREE ALERTS');
  assert.ok(o.options && o.free && !o.paid);
  const s = R.classifyChannel('stock-picks', '');
  assert.ok(s.stocks && !s.options);
  assert.ok(R.classifyChannel('vip-calls', 'PREMIUM').paid);
  assert.deepEqual(R.classifyChannel('day-trade-alerts').horizons, ['day']);
  assert.deepEqual(R.classifyChannel('swing-trades').horizons, ['swing']);
  assert.ok(R.classifyChannel('free-alerts').general);
  assert.ok(R.classifyChannel('rules').skip);
});

test('options alerts rank options channels first, stock alerts rank stock channels first, a free open channel fits either', () => {
  const ch = [{ id: '1', name: 'options-alerts' }, { id: '2', name: 'stock-alerts' }, { id: '3', name: 'free-alerts' }, { id: '4', name: 'rules' }];
  assert.equal(R.suggest(ch, { kind: 'option' })[0].id, '1');
  assert.equal(R.suggest(ch, { kind: 'stock' })[0].id, '2');
  const o = R.suggest(ch, { kind: 'option' });
  assert.ok(o.find((c) => c.id === '3').score > o.find((c) => c.id === '2').score, 'an open free channel beats a stocks-only one for an option');
  assert.equal(o.find((c) => c.id === '4').suggested, false);
});

test('the time to reach the target picks the matching day or swing channel; a paid channel loses to a free one', () => {
  const ch = [{ id: '1', name: 'day-trade-alerts' }, { id: '2', name: 'swing-trade-alerts' }, { id: '3', name: 'vip-alerts' }, { id: '4', name: 'free-alerts' }];
  assert.equal(R.suggest(ch, { kind: 'stock', horizon: 'day' })[0].id, '1');
  assert.equal(R.suggest(ch, { kind: 'stock', horizon: 'swing' })[0].id, '2');
  const r = R.suggest(ch, { kind: 'stock', horizon: 'long' });
  assert.ok(r.findIndex((c) => c.id === '4') < r.findIndex((c) => c.id === '3'));
});

test('a channel the member used for this stock is favoured, and at most three are suggested', () => {
  const ch = Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), name: 'stock-alerts-' + i }));
  assert.ok(R.suggest(ch, { kind: 'stock' }).filter((c) => c.suggested).length <= 3);
  assert.equal(R.suggest(ch, { kind: 'stock', saved: ['6'] })[0].id, '6');
});

test('an alert is tracked for 5 trading days, over weekends too, and not after it is sold', () => {
  const fri = Date.UTC(2026, 9, 23, 15), mon = Date.UTC(2026, 9, 26, 15), nextFri = Date.UTC(2026, 9, 30, 15);
  assert.equal(new Date(R.trackingSince(nextFri)).toISOString().slice(0, 10), '2026-10-23', '5 trading days before Fri Oct 30 is Fri Oct 23');
  assert.equal(R.isTracked(fri, nextFri), true);
  assert.equal(R.isTracked(fri - 86_400_000, nextFri), false);
  assert.equal(R.isTracked(fri, mon), true);
  assert.equal(R.isTracked(fri, mon, mon), false, 'sold after the alert');
  assert.equal(R.isTracked(fri, mon, fri - 1), true, 'a sale before the alert does not close it');
});

test('the alerts desk has a Midday button that previews, then posts, through the midday route', () => {
  const fs = require('node:fs'), path = require('node:path');
  const ui = fs.readFileSync(path.join(__dirname, 'academy-alerts-ui.js'), 'utf8'), server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.match(ui, /data-act=\\?"midday\\?"/); assert.match(ui, /click-alert\/midday/); assert.match(ui, /post: false/); assert.match(ui, /post: true/);
  assert.match(server, /path === '\/academy-activity\/click-alert\/midday'/); assert.match(server, /trialLink: academyTrial/);
});
