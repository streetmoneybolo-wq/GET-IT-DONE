'use strict';

/* Reddit mentions for one symbol, folded into the social leg of the sentiment composite next to StockTwits. Posts from the
 * trading subreddits are searched for the ticker, kept only when the ticker really appears in the title or body, and tagged
 * bull / bear with the same headline scorer the news leg uses, weighted by upvotes. Uses Reddit's official OAuth API when
 * SML_REDDIT_CLIENT_ID / SML_REDDIT_CLIENT_SECRET are set (a script app, client-credentials grant), else the public JSON
 * listing, best effort. Public posts only; nothing is posted, voted or messaged. Educational context, not a trade signal. */

const { scoreHeadline } = require('./academy-sentiment');

const SUBS = ['wallstreetbets', 'stocks', 'options', 'investing', 'StockMarket', 'Daytrading', 'swingtrading', 'pennystocks'];
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

function mentions(text, symbol) {
  const s = String(symbol || '').toUpperCase(); if (!s) return false;
  const re = new RegExp(`(?:^|[^A-Za-z0-9])\\$?${s.replace(/[.\-]/g, '\\$&')}(?![A-Za-z0-9])`);
  return re.test(String(text || ''));
}

function tagPost(p, symbol) {
  const d = p && p.data ? p.data : p; if (!d) return null;
  const title = String(d.title || ''), body = String(d.selftext || '').slice(0, 1500);
  if (!mentions(`${title}\n${body}`, symbol)) return null;
  const s = scoreHeadline(`${title} ${body.slice(0, 400)}`).score;
  const ups = Math.max(0, num(d.ups ?? d.score)), weight = 1 + Math.min(4, Math.log10(1 + ups));
  const created = num(d.created_utc) * 1000;
  return { source: 'reddit', sub: String(d.subreddit || ''), title: title.slice(0, 160), url: d.permalink ? `https://www.reddit.com${d.permalink}` : String(d.url || ''),
    sentiment: s >= 0.15 ? 'bullish' : s <= -0.15 ? 'bearish' : '', score: Math.round(s * 100) / 100, ups, comments: num(d.num_comments), weight,
    timestamp: created > 0 ? new Date(created).toISOString() : '' };
}

/* StockTwits' feed and Reddit's, as one social input: scoreSocial reads `posts`; `sources` is carried through for the panel. */
function mergeSocial(stocktwits, reddit) {
  const st = stocktwits && Array.isArray(stocktwits.posts) ? stocktwits.posts.map((p) => ({ ...p, source: p.source || 'stocktwits' })) : [];
  const rd = reddit && Array.isArray(reddit.posts) ? reddit.posts : [];
  if (!st.length && !rd.length) return stocktwits || reddit || null;
  return { ...(stocktwits && typeof stocktwits === 'object' ? stocktwits : {}), posts: st.concat(rd), sources: { stocktwits: st.length, reddit: rd.length } };
}

function createRedditService({ fetchImpl = fetch, clientId = '', clientSecret = '', userAgent = 'web:stockmarketloop-academy:1.0 (by /u/stockmarketloop)', now = Date.now, ttlMs = 10 * 60_000, subreddits = SUBS, logger = () => {}, enabled = true } = {}) {
  const cache = new Map(), inflight = new Map();
  const oauth = Boolean(clientId && clientSecret);
  let token = null, tokenUntil = 0, lastReq = 0, backoffUntil = 0;
  async function bearer() {
    if (token && tokenUntil > now() + 60_000) return token;
    const res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded', 'user-agent': userAgent }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`reddit_token_${res.status}`);
    const j = await res.json(); token = String(j.access_token || ''); tokenUntil = now() + Math.max(60, num(j.expires_in, 3600)) * 1000;
    if (!token) throw new Error('reddit_token_empty'); return token;
  }
  async function search(symbol) {
    if (backoffUntil > now()) throw new Error('reddit_backoff');
    const wait = Math.max(0, lastReq + 1_100 - now()); if (wait) await new Promise((r) => setTimeout(r, wait)); lastReq = now();
    const q = encodeURIComponent(`$${symbol} OR ${symbol}`), subs = subreddits.join('+');
    const base = oauth ? 'https://oauth.reddit.com' : 'https://www.reddit.com';
    const url = `${base}/r/${subs}/search${oauth ? '' : '.json'}?q=${q}&restrict_sr=1&sort=new&t=week&limit=100&raw_json=1`;
    const headers = { 'user-agent': userAgent, accept: 'application/json' }; if (oauth) headers.authorization = `Bearer ${await bearer()}`;
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(8_000) });
    if (res.status === 429 || res.status === 403) { backoffUntil = now() + 5 * 60_000; throw new Error(`reddit_${res.status}`); }
    if (!res.ok) throw new Error(`reddit_${res.status}`);
    const j = await res.json();
    return (j && j.data && Array.isArray(j.data.children)) ? j.data.children : [];
  }
  async function compute(symbol) {
    const t = now();
    const children = await search(symbol);
    const posts = children.map((c) => tagPost(c, symbol)).filter(Boolean).filter((p) => !p.timestamp || t - Date.parse(p.timestamp) <= 7 * 86_400_000);
    const bull = posts.filter((p) => p.sentiment === 'bullish'), bear = posts.filter((p) => p.sentiment === 'bearish');
    const w = (a) => a.reduce((s, p) => s + p.weight, 0);
    const subsSeen = [...new Set(posts.map((p) => p.sub))];
    return { ok: true, symbol, source: 'reddit', asOf: t, posts, n: posts.length, bull: bull.length, bear: bear.length, weightedBull: Math.round(w(bull)), weightedBear: Math.round(w(bear)), subreddits: subsSeen, top: posts.slice().sort((a, b) => b.ups - a.ups).slice(0, 5).map(({ weight, ...p }) => p), mode: oauth ? 'oauth' : 'public' };
  }
  async function posts(symbol) {
    if (!enabled) return null;
    const key = String(symbol || '').toUpperCase();
    const hit = cache.get(key); if (hit && hit.until > now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = compute(key).catch((error) => { logger('warn', 'reddit_failed', { symbol: key, error: String(error && error.message || error) }); return null; })
      .then((v) => { cache.set(key, { until: now() + (v ? ttlMs : 2 * 60_000), value: v }); if (cache.size > 300) cache.delete(cache.keys().next().value); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  }
  return { posts, mode: oauth ? 'oauth' : 'public' };
}

module.exports = { createRedditService, mergeSocial, tagPost, mentions, SUBS };
