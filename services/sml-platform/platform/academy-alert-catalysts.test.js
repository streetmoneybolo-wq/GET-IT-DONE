'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessCatalysts, toneOf } = require('./academy-alert-catalysts');

const NOW = Date.UTC(2026, 9, 9, 15, 0); // Oct 9 2026, 11 am ET
const day = (n) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10);
const news = (title, daysAgo = 1) => ({ title, url: 'https://example.com/' + encodeURIComponent(title), date: new Date(NOW - daysAgo * 86_400_000).toISOString() });

test('headline tone: bullish, bearish, neutral, and red-flag wording always reads bearish', () => {
  assert.equal(toneOf('Acme beats on revenue and raises guidance'), 1);
  assert.equal(toneOf('Acme misses estimates, cuts outlook'), -1);
  assert.equal(toneOf('Acme to present at a conference'), 0);
  assert.equal(toneOf('Acme announces $200M stock offering after record quarter'), -1);
});

test('earnings before an option expires cut against the alert, raise the risk and write the reason into the alert notes', () => {
  const c = assessCatalysts({ symbol: 'ACME', side: 'long', horizon: 'swing', expectedDays: { low: 2, mid: 4, high: 8 }, dte: 20, earnings: { date: day(12), daysAway: 12 }, news: [], now: NOW });
  assert.equal(c.available, true);
  assert.equal(c.earnings.beforeExpiry, true);
  assert.equal(c.riskBump, true);
  assert.deepEqual(c.warnings, ['earnings_before_expiry']);
  assert.match(c.riskNote, /Earnings Oct 21 \(in 12 days\) before expiry/);
  assert.match(c.reasons[0], /before this contract expires/);
  assert.ok(['caution', 'against'].includes(c.verdict));
  assert.match(c.note, /before expiry/);
});

test('earnings outside the window with news leaning the same way as the alert supports it', () => {
  const c = assessCatalysts({ symbol: 'ACME', side: 'long', horizon: 'swing', expectedDays: { low: 2, mid: 4, high: 8 }, earnings: { date: day(45), daysAway: 45 },
    news: [news('Acme beats on revenue and raises guidance'), news('Analyst upgrades Acme to buy', 2), news('Acme names new CFO', 3)], now: NOW });
  assert.equal(c.verdict, 'supports');
  assert.equal(c.riskBump, false);
  assert.equal(c.earnings.inWindow, false);
  assert.equal(c.news.positive, 2); assert.equal(c.news.negative, 0); assert.equal(c.news.tone, 'positive');
  assert.match(c.setupNote, /^News leans with the trade this week: Acme beats/);
  assert.match(c.note, /Next earnings Nov 23, outside the window\. News leans with the trade/);
  assert.ok(c.reasons.some((r) => /No earnings inside the window/.test(r)));
  assert.match(c.headline, /back this alert/);
});

test('news that leans the other way counts against a short just as it does a long, and red flags always bump the risk', () => {
  const bullishWeek = [news('Acme beats on revenue'), news('Acme wins Pentagon contract', 2)];
  const short = assessCatalysts({ symbol: 'ACME', side: 'short', horizon: 'swing', news: bullishWeek, now: NOW });
  assert.equal(short.news.tone, 'positive');
  assert.deepEqual(short.warnings, ['news_against']);
  assert.match(short.setupNote, /against the trade/);
  const long = assessCatalysts({ symbol: 'ACME', side: 'long', horizon: 'swing', news: bullishWeek, now: NOW });
  assert.equal(long.verdict, 'supports');
  const flagged = assessCatalysts({ symbol: 'ACME', side: 'long', horizon: 'swing', news: [news('Acme prices $50M registered direct offering')], now: NOW });
  assert.equal(flagged.riskBump, true);
  assert.equal(flagged.news.tone, 'red_flag');
  assert.match(flagged.setupNote, /^Red-flag news this week/);
});

test('earnings inside a stock alert\'s window is a caution; within a week it also raises the risk', () => {
  const soon = assessCatalysts({ symbol: 'ACME', side: 'long', horizon: 'swing', expectedDays: { low: 3, mid: 6, high: 12 }, earnings: { date: day(3), daysAway: 3 }, now: NOW });
  assert.equal(soon.earnings.inWindow, true); assert.equal(soon.riskBump, true); assert.equal(soon.verdict, 'caution');
  assert.match(soon.riskNote, /inside the window/);
  const later = assessCatalysts({ symbol: 'ACME', side: 'long', horizon: 'swing', expectedDays: { low: 3, mid: 6, high: 12 }, earnings: { date: day(14), daysAway: 14 }, now: NOW });
  assert.equal(later.earnings.inWindow, true); assert.equal(later.riskBump, false); assert.equal(later.verdict, 'caution');
});

test('a raw earnings payload is read the same way the earnings panel reads it, and old news is ignored', () => {
  const payload = { results: [{ reportDate: day(-80), epsActual: 1.2 }, { reportDate: day(10), epsEstimate: 1.3 }] };
  const c = assessCatalysts({ symbol: 'ACME', side: 'long', horizon: 'mid', earnings: payload, news: [news('Acme misses estimates', 30)], now: NOW });
  assert.equal(c.earnings.date, day(10)); assert.equal(c.earnings.daysAway, 10); assert.equal(c.earnings.confirmedEstimate, true);
  assert.equal(c.news.count, 0, 'a month-old headline is not this week\'s news');
});

test('with nothing known the check says so instead of claiming the coast is clear', () => {
  const c = assessCatalysts({ symbol: 'ACME', side: 'long', horizon: 'swing', earnings: null, news: null, now: NOW });
  assert.equal(c.available, false); assert.equal(c.verdict, 'quiet'); assert.equal(c.riskBump, false);
  assert.ok(c.reasons.some((r) => /cannot be ruled out/.test(r)));
  assert.equal(c.note, '');
});
