'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('./academy-article-outcomes');

const DAY = 86_400_000, T0 = Date.UTC(2026, 9, 1, 20);
const bar = (i, o, h, l, c) => ({ t: T0 + i * DAY, o, h, l, c, v: 1 });

test('horizons follow the timeframe the piece claimed', () => {
  assert.equal(O.horizonDays('days'), 5); assert.equal(O.horizonDays('1 to 2 weeks'), 10); assert.equal(O.horizonDays('1 to 3 weeks'), 15); assert.equal(O.horizonDays('through the print', 3), 5); assert.equal(O.horizonDays(''), 7);
});

test('a bullish entry is hit when the target trades first, stopped when the stop trades first, expired at the horizon; a bar through both is a stop', () => {
  const e = O.openEntry({ id: '1', symbol: 'abcd', angle: 'gamma', lean: 'bullish', price: 10, pt: 11, stop: 9.5, timeframe: 'days', at: T0 });
  assert.equal(e.horizonDays, 5); assert.equal(e.status, 'open');
  const hit = O.settleEntry(e, [bar(0, 10, 10.2, 9.9, 10), bar(1, 10, 10.6, 9.8, 10.4), bar(2, 10.4, 11.2, 10.3, 11)], T0 + 3 * DAY);
  assert.equal(hit.result, 'hit'); assert.equal(hit.returnPct, 10); assert.equal(hit.days, 2); assert.equal(hit.maxAdvPct, 2);
  const stopped = O.settleEntry(e, [bar(1, 10, 10.3, 9.4, 9.6)], T0 + 2 * DAY); assert.equal(stopped.result, 'stopped'); assert.equal(stopped.returnPct, -5);
  const both = O.settleEntry(e, [bar(1, 10, 11.5, 9.3, 10)], T0 + 2 * DAY); assert.equal(both.result, 'stopped');
  const expired = O.settleEntry(e, [1, 2, 3, 4, 5].map((i) => bar(i, 10, 10.4, 9.7, 10.2)), T0 + 6 * DAY); assert.equal(expired.result, 'expired'); assert.equal(expired.returnPct, 2); assert.equal(expired.days, 5);
  const open = O.settleEntry(e, [bar(1, 10, 10.4, 9.7, 10.2)], T0 + 2 * DAY); assert.equal(open.status, 'open'); assert.equal(open.maxFavPct, 4);
  const bear = O.settleEntry(O.openEntry({ id: '2', symbol: 'X', angle: 'tape', lean: 'bearish', price: 10, pt: 9, stop: 10.5, timeframe: 'days', at: T0 }), [bar(1, 10, 10.2, 8.9, 9.1)], T0 + 2 * DAY);
  assert.equal(bear.result, 'hit'); assert.equal(bear.returnPct, 10);
  assert.equal(O.openEntry({ id: '3', symbol: 'X', price: 0, pt: 1, at: T0 }), null);
  const stale = O.settleEntry(e, [], T0 + 50 * DAY); assert.equal(stale.result, 'abandoned');
});

test('the record counts, rates and averages, is gated until ten pieces resolved, and the sentence reads honestly', () => {
  const mk = (i, result, ret) => ({ id: String(i), symbol: 'S' + i, angle: i % 2 ? 'gamma' : 'short', lean: 'bullish', pt: 1, status: result ? 'resolved' : 'open', result, returnPct: ret, at: i, url: '' });
  const few = [mk(1, 'hit', 10), mk(2, 'stopped', -5), mk(3, null, null)];
  const r1 = O.record(few); assert.equal(r1.total, 3); assert.equal(r1.open, 1); assert.equal(r1.resolved, 2); assert.equal(r1.hitRate, 50); assert.equal(r1.avgReturnPct, 2.5); assert.equal(r1.showable, false); assert.equal(O.recordLine(r1), '');
  const many = Array.from({ length: 12 }, (_, i) => mk(i, i < 7 ? 'hit' : i < 10 ? 'stopped' : 'expired', i < 7 ? 8 : i < 10 ? -6 : 1));
  const r2 = O.record(many); assert.equal(r2.showable, true); assert.equal(r2.hit, 7); assert.equal(r2.stopped, 3); assert.equal(r2.expired, 2); assert.equal(r2.hitRate, 58); assert.equal(r2.byAngle.gamma.total, 6); assert.equal(r2.recent.length, 12);
  assert.match(O.recordLine(r2), /^Desk record: 7 of 12 scenario targets traded before their invalidation \(58%\), 3 stopped out, 2 ran out of time, average outcome \+3\.33% per piece\. Past pieces say nothing about this one\.$/);
  const abandoned = O.record([...many, { ...mk(99, 'abandoned', null) }]); assert.equal(abandoned.resolved, 12, 'abandoned entries are not scored');
});
