'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reddit = require('./academy-reddit');
const { scoreSocial } = require('./academy-sentiment');

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const child = (o) => ({ kind: 't3', data: { subreddit: 'stocks', title: 'x', selftext: '', ups: 10, num_comments: 2, created_utc: (NOW - 3_600_000) / 1000, permalink: '/r/stocks/1', ...o } });

test('ticker must appear as a word or cashtag; posts are tagged by the headline scorer and weighted by upvotes', () => {
  assert.equal(reddit.mentions('I love $NVDA calls', 'NVDA'), true);
  assert.equal(reddit.mentions('NVDAX is a fund', 'NVDA'), false);
  assert.equal(reddit.mentions('Bought nvda', 'NVDA'), false, 'case matters: lowercase words are not tickers');
  const bull = reddit.tagPost(child({ title: 'NVDA beats estimates, record revenue, upgraded' }), 'NVDA');
  assert.equal(bull.sentiment, 'bullish'); assert.equal(bull.source, 'reddit'); assert.ok(bull.weight > 1);
  const bear = reddit.tagPost(child({ title: '$NVDA misses, guidance cut, downgraded', ups: 0 }), 'NVDA');
  assert.equal(bear.sentiment, 'bearish'); assert.equal(bear.weight, 1);
  assert.equal(reddit.tagPost(child({ title: 'AMD is great' }), 'NVDA'), null);
});

test('merged StockTwits + Reddit posts score as one social leg with per-source counts', () => {
  const st = { posts: [{ sentiment: 'Bullish', timestamp: new Date(NOW - 1e6).toISOString() }, { sentiment: 'Bullish', timestamp: new Date(NOW - 2e6).toISOString() }] };
  const rd = { posts: [reddit.tagPost(child({ title: 'NVDA record revenue beat' }), 'NVDA'), reddit.tagPost(child({ title: 'NVDA plunges on miss', created_utc: (NOW - 2 * 3_600_000) / 1000 }), 'NVDA')] };
  const merged = reddit.mergeSocial(st, rd);
  assert.deepEqual(merged.sources, { stocktwits: 2, reddit: 2 });
  const s = scoreSocial(merged, { now: NOW });
  assert.equal(s.available, true); assert.equal(s.bull, 3); assert.equal(s.bear, 1); assert.deepEqual(s.sources, { stocktwits: 2, reddit: 2 });
  assert.equal(reddit.mergeSocial(null, null), null);
  assert.equal(reddit.mergeSocial({ posts: [] }, null).posts.length, 0);
});

test('service: public JSON mode, filtering, caching, and a 429 backs off instead of hammering', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (calls.length >= 3) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ data: { children: [child({ title: 'TSLA to the moon, record deliveries' }), child({ title: 'unrelated' }), child({ title: 'TSLA weak demand, cut', created_utc: (NOW - 30 * 86_400_000) / 1000 })] } }) };
  };
  const svc = reddit.createRedditService({ fetchImpl, now: () => NOW });
  assert.equal(svc.mode, 'public');
  const r = await svc.posts('tsla');
  assert.equal(r.n, 1, 'unrelated and month-old posts are dropped'); assert.equal(r.bull, 1); assert.ok(calls[0].includes('/search.json?q=%24TSLA%20OR%20TSLA'));
  assert.equal(await svc.posts('TSLA'), r, 'cached');
  const svc2 = reddit.createRedditService({ fetchImpl, now: () => NOW });
  await svc2.posts('AMD'); // second real call ok
  assert.equal(await svc2.posts('MSFT'), null, '429 => null, never a throw');
  const before = calls.length; await svc2.posts('GOOG'); assert.equal(calls.length, before, 'in backoff: no request made');
});

test('service: OAuth mode fetches a token once and uses oauth.reddit.com', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, auth: opts.headers.authorization || '' }); if (url.includes('access_token')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }; return { ok: true, status: 200, json: async () => ({ data: { children: [] } }) }; };
  const svc = reddit.createRedditService({ fetchImpl, clientId: 'id', clientSecret: 'sec', now: () => NOW });
  await svc.posts('AAPL'); await svc.posts('MSFT');
  assert.equal(calls.filter((c) => c.url.includes('access_token')).length, 1);
  assert.ok(calls.filter((c) => c.url.startsWith('https://oauth.reddit.com/')).every((c) => c.auth === 'Bearer tok'));
});

test('a 403 is a block: half an hour off, and the backoff is logged once a minute rather than once per symbol', async () => {
  let clock = NOW; const logs = [];
  let status = 403;
  const svc = reddit.createRedditService({ now: () => clock, logger: (l, e, x) => logs.push(x), fetchImpl: async () => ({ ok: status === 200, status, json: async () => ({ data: { children: [] } }) }) });
  assert.equal(await svc.posts('NVDA'), null);
  assert.equal(logs[0].error, 'reddit_403');
  for (const s of ['AMD', 'TSLA', 'AAPL']) await svc.posts(s);
  assert.equal(logs.filter((x) => x.error === 'reddit_backoff').length, 1, 'three symbols in backoff: one line');
  clock += 61_000; await svc.posts('MSFT');
  assert.equal(logs.filter((x) => x.error === 'reddit_backoff').length, 2, 'a minute later: one more');
  clock += 20 * 60_000; status = 200;
  await svc.posts('GOOG');
  assert.equal(logs[logs.length - 1].error, 'reddit_backoff', 'still blocked at 21 minutes');
  clock += 10 * 60_000;
  assert.deepEqual(logs.filter((x) => x.error === 'reddit_200'), [], 'sanity');
  const after = await svc.posts('META');
  assert.notEqual(after, null, 'after half an hour the request goes out again');
});
