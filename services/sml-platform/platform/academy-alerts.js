'use strict';

/* The Academy alerts desk service.
 *
 * Reads the trader's alert channels from Discord, parses each alert, and keeps a live picture of every recent alert: price, risk grade, company checklist (long term),
 * MEM ALGO view, order-book pressure, chatter, and an auto-updating plan (hold / raise target / take partial profits / sell).
 *
 * Two channels: "swings" (GrandMaster Swings) and "longterm" (GrandMaster LongTerm). Discord is polled with a bot token that can read them; if the
 * main channel is unreadable the mirror copy in the new server is tried. Every outside call is cached, rate-limited and failure-tolerant: an alert always
 * shows what is known, and says what is missing. Read-only: nothing here trades and nothing is posted back to Discord. */

const { parseAlertMessage } = require('./academy-alerts-parse');
const risk = require('./academy-alert-risk');
const algo = require('./academy-mem-algo');
const optionsCalc = require('./academy-alert-options');

const DISCORD = 'https://discord.com/api/v10';
const SECTORS = [
  [/SEMICONDUCTOR/i, 'Semiconductors', 'SMH'], [/PHARMACEUTICAL|BIOLOGICAL|BIOTECH/i, 'Biotech', 'XBI'], [/MEDICAL|SURGICAL|HEALTH|HOSPITAL/i, 'Health care', 'XLV'],
  [/BANK|SAVINGS|CREDIT|FINANCE|INSURANCE|BROKER|INVESTMENT/i, 'Financials', 'XLF'], [/PETROLEUM|OIL|GAS\b/i, 'Energy', 'XLE'], [/PREPACKAGED SOFTWARE|COMPUTER PROGRAMMING|SOFTWARE|DATA PROCESSING/i, 'Software', 'IGV'],
  [/ELECTRONIC|COMPUTER|COMMUNICATIONS EQUIP/i, 'Technology', 'XLK'], [/RETAIL|EATING|RESTAURANT|WHOLESALE/i, 'Retail', 'XRT'], [/REAL ESTATE|REIT/i, 'Real estate', 'XLRE'],
  [/MINING|GOLD|METAL|MINERAL/i, 'Metals & mining', 'XME'], [/AIR|AEROSPACE|TRANSPORT|TRUCKING|RAIL/i, 'Industrials', 'XLI'], [/ELECTRIC|UTILIT|WATER SUPPLY/i, 'Utilities', 'XLU'],
  [/CHEMICAL|PLASTIC|PAPER/i, 'Materials', 'XLB'], [/TELEPHONE|CABLE|BROADCAST|MOTION PICTURE|ENTERTAINMENT|PUBLISHING/i, 'Communications', 'XLC'], [/MOTOR VEHICLE|AUTO/i, 'Autos', 'XLY']
];
const sectorFor = (company) => { const text = company && company.sic_description; if (!text) return null; const hit = SECTORS.find(([re]) => re.test(text)); return hit ? { name: hit[1], etf: hit[2] } : null; };

const TTL = { quotes: 12_000, daily: 600_000, intraday: 60_000, fundamentals: 6 * 3_600_000, short: 6 * 3_600_000, sentiment: 600_000, filings: 6 * 3_600_000, company: 24 * 3_600_000 };
const WINDOW_DAYS = { swings: 7, longterm: 150 };
/* The desk starts at a chosen alert in each stream (GLND for swings, INTC for long-term) and shows everything posted after it, newest first.
   ACADEMY_ALERTS_START="swings:GLND,longterm:INTC" changes the starting alerts (empty = the normal recent window). ACADEMY_ALERTS_MAX caps how many show per stream. */
const START_DEFAULT = 'swings:GLND,longterm:INTC';
const parseStart = (raw) => { const out = {}; for (const part of String(raw == null ? START_DEFAULT : raw).split(',')) { const [k, v] = part.trim().split(':'); if (k && v) out[k.trim()] = v.trim().toUpperCase(); } return out; };
const START = parseStart(process.env.ACADEMY_ALERTS_START);
const ENV_MAX = Math.max(1, Math.min(40, Number(process.env.ACADEMY_ALERTS_MAX) || 25));
const MAX_ACTIVE = { swings: ENV_MAX, longterm: ENV_MAX };

function createAlertsService({
  tokens = [], channels = [], origin = '', fetchImpl = globalThis.fetch, candles = null, orderFlow = null, patterns = null,
  optionsChain = null, logger = () => {}, now = Date.now, pollMs = 20_000, refreshMs = 15_000, timers = { setTimeout, clearTimeout, setInterval, clearInterval }
} = {}) {
  const alerts = new Map(); // discord message id -> alert record
  const feed = {}; for (const c of channels) feed[c.key] = { ok: false, error: 'not polled yet', lastPollAt: 0, tokenLabel: '', via: 'channel' };
  const cacheStore = new Map(), inflight = new Map();
  const patternCache = new Map();
  let running = false, pollTimer = null, refreshTimer = null, refreshing = false, loggedAt = 0;
  let semaphore = 0; const waiters = [];
  const acquire = () => new Promise((resolve) => { if (semaphore < 3) { semaphore += 1; resolve(); } else waiters.push(resolve); });
  const release = () => { const next = waiters.shift(); if (next) next(); else semaphore -= 1; };

  const cached = async (key, ttl, fn) => {
    const hit = cacheStore.get(key);
    if (hit && hit.until > now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => { await acquire(); try { const value = await fn(); cacheStore.set(key, { value, until: now() + ttl }); return value; } catch (error) { if (hit) return hit.value; return null; } finally { release(); } })();
    inflight.set(key, p); try { return await p; } finally { inflight.delete(key); }
  };
  const wp = async (path) => {
    const res = await fetchImpl(`${origin}${path}`, { headers: { accept: 'application/json', 'user-agent': 'StockMarketLoop-Academy-Alerts/1.0' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`wp_${res.status}`);
    return res.json();
  };

  /* ---------- Discord ---------- */
  async function readChannel(channelId, after) {
    let lastError = 'no token';
    for (const t of tokens) {
      try {
        const res = await fetchImpl(`${DISCORD}/channels/${channelId}/messages?limit=${after ? 50 : 100}${after ? `&after=${after}` : ''}`, { headers: { authorization: `Bot ${t.token}`, 'user-agent': 'StockMarketLoop-Academy-Alerts/1.0' }, signal: AbortSignal.timeout(15_000) });
        if (res.status === 429) { lastError = 'rate limited'; continue; }
        if (!res.ok) { lastError = `discord_${res.status}`; continue; }
        const list = await res.json();
        if (!Array.isArray(list)) { lastError = 'unexpected reply'; continue; }
        return { ok: true, list, label: t.label };
      } catch (error) { lastError = String(error && error.message || error).slice(0, 60); }
    }
    return { ok: false, error: lastError };
  }

  function ingest(channelKey, message) {
    const parsed = parseAlertMessage(message.content, message.timestamp);
    if (!parsed || parsed.kind !== 'equity') return false;
    const at = Date.parse(message.timestamp);
    if (!Number.isFinite(at)) return false;
    const id = String(message.id);
    const existing = alerts.get(id);
    alerts.set(id, Object.assign(existing || { planLog: [], addedAt: now() }, {
      id, channel: channelKey, symbol: parsed.symbol, kind: 'equity', entry: parsed.entryPrice, target: parsed.targetPrice, targetIsMinimum: parsed.targetIsMinimum,
      riskFlag: parsed.riskFlag, raw: parsed.raw, at, author: (message.author && (message.author.global_name || message.author.username)) || 'trader', edited: Boolean(message.edited_timestamp),
      authorId: message.author && /^\d{5,25}$/.test(String(message.author.id)) ? String(message.author.id) : '', avatarHash: message.author && /^(a_)?[0-9a-f]{6,64}$/i.test(String(message.author.avatar || '')) ? String(message.author.avatar) : ''
    }));
    return true;
  }

  async function poll() {
    for (const c of channels) {
      const state = feed[c.key];
      const last = c.lastId;
      let got = await readChannel(c.id, last);
      state.via = 'channel';
      if (!got.ok && c.mirrorId) { const mirror = await readChannel(c.mirrorId, c.lastMirrorId); if (mirror.ok) { got = mirror; state.via = 'mirror'; } }
      state.lastPollAt = now();
      if (!got.ok) { state.ok = false; state.error = got.error; if (now() - loggedAt > 300_000) { loggedAt = now(); logger('warn', 'academy_alerts_feed_unreadable', { channel: c.key, error: got.error, tokens: tokens.map((t) => t.label) }); } continue; }
      // a bot without the Message Content intent gets every message back with empty text: say so instead of silently showing nothing
      if (got.list.length > 0 && got.list.every((m) => !m.content && !(m.embeds && m.embeds.length))) { state.ok = false; state.error = 'message content is blocked: the bot needs the Message Content intent'; if (now() - loggedAt > 300_000) { loggedAt = now(); logger('warn', 'academy_alerts_no_message_content', { channel: c.key, tokenLabel: got.label }); } continue; }
      state.ok = true; state.error = ''; state.tokenLabel = got.label;
      const list = got.list.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      let newest = null;
      for (const m of list) { ingest(c.key, m); newest = m.id; }
      if (newest) { if (state.via === 'channel') c.lastId = newest; else c.lastMirrorId = newest; }
    }
  }

  /* ---------- data ---------- */
  const active = () => {
    const out = [];
    for (const c of channels) {
      const cutoff = now() - WINDOW_DAYS[c.key] * 86_400_000;
      const all = [...alerts.values()].filter((a) => a.channel === c.key).sort((a, b) => b.at - a.at);
      const anchor = START[c.key] ? all.findIndex((a) => a.symbol === START[c.key]) : -1;
      // from the starting alert up to the newest; when that alert is not in the feed (yet), fall back to the normal recent window
      const list = (anchor >= 0 ? all.slice(0, anchor + 1) : all.filter((a) => a.at >= cutoff)).slice(0, MAX_ACTIVE[c.key]);
      out.push(...list);
    }
    return out;
  };
  const candlesFor = (symbol, tf) => (candles ? cached(`c:${symbol}:${tf}`, tf === '1D' ? TTL.daily : TTL.intraday, async () => (await candles(symbol, tf)).bars) : Promise.resolve(null));

  async function loadQuotes(symbols) {
    const list = [...new Set(symbols)].filter(Boolean);
    const out = new Map();
    for (let i = 0; i < list.length; i += 25) {
      const chunk = list.slice(i, i + 25);
      const data = await cached(`q:${chunk.join(',')}`, TTL.quotes, async () => wp(`/wp-json/sml-scanner/v1/quotes?symbols=${chunk.map(encodeURIComponent).join(',')}`));
      for (const row of (data && data.rows) || []) if (row && row.sym) out.set(String(row.sym).toUpperCase(), row);
    }
    return out;
  }
  const fundamentals = (s) => cached(`f:${s}`, TTL.fundamentals, async () => { const d = await wp(`/wp-json/sml-short/v1/financials?symbol=${encodeURIComponent(s)}`); return d && d.datasets ? d.datasets : null; });
  const company = (s) => cached(`co:${s}`, TTL.company, async () => wp(`/wp-json/sml-massive/v1/market-data/company?symbol=${encodeURIComponent(s)}`));
  const shortData = (s) => cached(`s:${s}`, TTL.short, async () => wp(`/wp-json/sml-short/v1/short?symbol=${encodeURIComponent(s)}&days=10`));
  const sentiment = (s) => cached(`st:${s}`, TTL.sentiment, async () => wp(`/wp-json/sml-stocktwits/v1/feed?symbol=${encodeURIComponent(s)}`));
  const news = (s) => cached(`n:${s}`, 900_000, async () => { const d = await wp(`/wp-json/sml-ticker-news/v1/feed?symbol=${encodeURIComponent(s)}`); return d && Array.isArray(d.articles) ? d.articles : null; });
  const chainFor = (s) => (optionsChain ? cached(`oc:${s}`, 600_000, async () => { const d = await optionsChain(s); const rows = d ? optionsCalc.normalizeChain(d) : []; return rows; }) : Promise.resolve(null));
  const filings = (s) => cached(`fi:${s}`, TTL.filings, async () => { const d = await wp(`/wp-json/sml-massive/v1/market-data/filings?symbol=${encodeURIComponent(s)}&limit=30`); return d && d.filings ? d.filings : null; });

  const algoMemo = new Map();
  function algoView(alert, daily, intraday) {
    if (!daily || daily.length < 60) return null;
    const mk = `${alert.symbol}:${alert.channel}:${daily.length}:${daily[daily.length - 1].t}:${daily[daily.length - 1].c}:${intraday ? intraday.length + ':' + intraday[intraday.length - 1].c : 0}`;
    if (algoMemo.has(mk)) return algoMemo.get(mk);
    const view = algoViewCompute(alert, daily, intraday);
    algoMemo.set(mk, view); if (algoMemo.size > 200) algoMemo.delete(algoMemo.keys().next().value);
    return view;
  }
  function algoViewCompute(alert, daily, intraday) {
    const mode = alert.channel === 'longterm' ? 'mid' : 'swing';
    let a;
    // newer listings do not have the ~230 daily candles the swing model warms up on: fall back to faster averages so they still get a read
    const short = mode === 'swing' && daily.length < 231;
    try { a = algo.analyze(daily, mode, short ? { fast: 9, slow: 21, trend: 50 } : {}, '1D', { patterns: patterns ? (b) => patterns(b) : null, patternCache }); } catch (_) { return null; }
    const latest = a.latest ? { dir: a.latest.dir, recent: a.bars - 1 - a.latest.i <= 10, t: a.latest.t, grade: a.latest.conf && a.latest.conf.grade } : null;
    const view = { mode, bias: a.bias, label: `${mode === 'mid' ? 'mid-term' : short ? 'short-term' : 'swing'} model is ${a.bias === 'long' ? 'bullish' : a.bias === 'short' ? 'bearish' : a.bias === 'pullback' ? 'in a pullback' : a.bias === 'bounce' ? 'in a bounce' : a.bias}`, latestSignal: latest, exitLevel: a.confluence && a.confluence.exitWatch ? a.confluence.exitWatch.level : null, trades: a.stats ? a.stats.trades : 0 };
    if (channels && alert.channel === 'swings' && intraday && intraday.length >= 130) {
      try { const d = algo.analyze(intraday, 'day', {}, '5m', {}); view.day = { bias: d.bias, latestSignal: d.latest ? { dir: d.latest.dir, recent: d.bars - 1 - d.latest.i <= 24 } : null }; if (d.latest && d.latest.dir < 0 && d.bars - 1 - d.latest.i <= 24) view.latestSignal = view.latestSignal && view.latestSignal.recent && view.latestSignal.dir > 0 ? view.latestSignal : { dir: -1, recent: true, t: d.latest.t }; } catch (_) { /* optional */ }
    }
    return view;
  }

  function flowFor(quote, symbol) {
    let reading = null;
    if (orderFlow) { try { reading = orderFlow(symbol); } catch (_) { reading = null; } }
    if (reading && reading.ready) return { bias: reading.bias, score: reading.score, source: 'level2' };
    if (quote && Number(quote.bs) > 0 && Number(quote.as) > 0) { const r = Number(quote.bs) / Number(quote.as); return { bias: r >= 1.6 ? 'bullish' : r <= 0.625 ? 'bearish' : 'neutral', ratio: r, source: 'top of book' }; }
    return null;
  }

  async function evaluate(alert, quotes, market, sectorQuotes, detail = false) {
    const symbol = alert.symbol;
    const q = quotes.get(symbol) || null;
    const young = now() - alert.at < 3 * 86_400_000;
    const [daily, intraday, fin, co, sh, sent, fil, nws, chain] = await Promise.all([
      candlesFor(symbol, '1D'), young ? candlesFor(symbol, '5m') : Promise.resolve(null), fundamentals(symbol), company(symbol), shortData(symbol), sentiment(symbol), filings(symbol), news(symbol), q && Number(q.last) >= 1 ? chainFor(symbol) : Promise.resolve(null)
    ]);
    const spreadPct = q && q.bid > 0 && q.ask > 0 ? (q.ask - q.bid) / ((q.ask + q.bid) / 2) : null;
    const sector = sectorFor(co); const sq = sector && sectorQuotes.get(sector.etf) ? { name: sector.name, etf: sector.etf, chgPct: sectorQuotes.get(sector.etf).chgPct } : (sector ? { name: sector.name, etf: sector.etf, chgPct: null } : null);
    const view = algoView(alert, daily, intraday);
    const flow = flowFor(q, symbol);
    const chk = alert.channel === 'longterm' || detail ? risk.checklist({ fin, company: co, daily, quote: q }) : null;
    const g = risk.gradeRisk({ alert, quote: q, daily, fin, company: co, short: sh, sentiment: sent, news: nws, filings: fil, market, sector: sq, algoView: view, spreadPct, now: now() });
    const since = risk.sinceAlert(alert, intraday, daily, q ? Number(q.last) : null);
    const plan = risk.planFor({ alert, quote: q, daily, since, risk: g, algoView: view, flow, sentiment: sent, news: nws, checklist: chk, now: now() });
    const last = alert.planLog[alert.planLog.length - 1];
    if (!last || last.action !== plan.action || Math.abs((last.target || 0) - plan.target) > 1e-9) { alert.planLog.push({ t: now(), action: plan.action, target: plan.target, price: q ? Number(q.last) : null }); if (alert.planLog.length > 12) alert.planLog.shift(); }
    let opt = null;
    if (chain && chain.length) { try { opt = optionsCalc.considerOptions({ alert, price: q ? Number(q.last) : null, atrPct: g.atrPct || (daily && risk.dailyStats(daily) ? risk.dailyStats(daily).atrPct : null), plan, algoView: view, flow, rows: chain, riskBand: g.band, now: now() }); } catch (_) { opt = null; } }
    else if (chain) opt = { verdict: 'NONE', available: false, reason: 'No listed options were found for this stock.', channel: alert.channel };
    return { options: opt, alert, quote: q, risk: g, plan, since, checklist: chk, sector: sq, flow, algo: view, sentiment: sent, news: nws, company: co, daily: daily ? daily.length : 0 };
  }

  const evaluated = new Map();
  let lastContext = { market: { spyChgPct: null }, sectorQuotes: new Map() };
  async function refresh() {
    if (refreshing) return; refreshing = true;
    try {
      const list = active(); if (!list.length) return;
      const sectorEtfs = new Set();
      // sectors need each company's SIC first (cached for a day), so read them lazily before quoting
      await Promise.all(list.map(async (a) => { const co = await company(a.symbol); const s = sectorFor(co); if (s) sectorEtfs.add(s.etf); }));
      const quotes = await loadQuotes([...list.map((a) => a.symbol), 'SPY', 'QQQ', ...sectorEtfs]);
      const spyDaily = await candlesFor('SPY', '1D');
      const spy = quotes.get('SPY');
      let spyBelow50 = null; if (spyDaily && spyDaily.length > 55) { const st = risk.dailyStats(spyDaily); spyBelow50 = st ? st.close < st.ema50 : null; }
      const market = { spyChgPct: spy ? spy.chgPct : null, qqqChgPct: quotes.get('QQQ') ? quotes.get('QQQ').chgPct : null, spyBelow50 };
      const sectorQuotes = new Map([...sectorEtfs].map((e) => [e, quotes.get(e)]).filter(([, v]) => v));
      lastContext = { market, sectorQuotes };
      for (const a of list) { try { evaluated.set(a.id, await evaluate(a, quotes, market, sectorQuotes)); } catch (error) { logger('warn', 'academy_alert_eval_failed', { symbol: a.symbol, error }); } }
    } finally { refreshing = false; }
  }

  /* ---------- output ---------- */
  const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
  function publicAlert(ev, full) {
    const a = ev.alert, q = ev.quote;
    const out = {
      id: a.id, channel: a.channel, symbol: a.symbol, entry: a.entry, target0: a.target, at: a.at, raw: a.raw, author: a.author, avatar: a.authorId ? `/academy-activity/alerts/avatar?a=${a.id}` : '', authorId: a.authorId || '', riskFlag: a.riskFlag,
      price: q ? r4(Number(q.last)) : null, chgPct: q ? r4(Number(q.chgPct)) : null, sincePct: ev.since && ev.since.pct != null ? r4(ev.since.pct) : null, high: r4(ev.since && ev.since.high), low: r4(ev.since && ev.since.low),
      risk: { score: ev.risk.score, band: ev.risk.band, label: ev.risk.label, top: ev.risk.top, flags: ev.risk.flags, coverage: ev.risk.coverage },
      plan: { action: ev.plan.action, target: ev.plan.target, stop: ev.plan.stop, reasons: full ? ev.plan.reasons : ev.plan.reasons.slice(0, 2), progress: r4(ev.plan.progress) },
      sector: ev.sector, flow: ev.flow ? { bias: ev.flow.bias, source: ev.flow.source } : null, algo: ev.algo ? { bias: ev.algo.bias, label: ev.algo.label } : null,
      options: ev.options ? (full ? ev.options : { verdict: ev.options.verdict, available: ev.options.available, side: ev.options.side || null, strength: ev.options.strength || null, label: ev.options.contract ? `${ev.options.contract.dte}d ${ev.options.contract.strike} ${ev.options.side}` : null }) : null,
      checklist: ev.checklist ? { yes: ev.checklist.yes, no: ev.checklist.no, unknown: ev.checklist.unknown, items: ev.checklist.items.map((i) => ({ k: i.key, l: i.label, ok: i.ok, d: full ? i.detail : undefined })) } : null
    };
    if (full) {
      out.factors = ev.risk.factors.map((f) => ({ key: f.key, label: f.label, weight: f.weight, risk: r4(f.risk), detail: f.detail, available: f.available }));
      out.planLog = ev.alert.planLog.slice(-6);
      out.chatter = ev.sentiment && Array.isArray(ev.sentiment.posts) ? ev.sentiment.posts.slice(0, 3).map((p) => ({ text: String(p.comment || '').slice(0, 160), sentiment: p.sentiment || '', at: p.timestamp })) : [];
      out.news = Array.isArray(ev.news) ? ev.news.slice(0, 3).map((n) => ({ title: String(n.title || '').slice(0, 140), url: String(n.url || ''), date: n.date || '' })) : [];
      out.company = ev.company ? { name: ev.company.name, marketCap: ev.company.market_cap, industry: ev.company.sic_description, employees: ev.company.total_employees } : null;
    }
    return out;
  }
  function snapshot({ detailId = null } = {}) {
    const list = active().map((a) => evaluated.get(a.id)).filter(Boolean).map((ev) => publicAlert(ev, ev.alert.id === detailId));
    const pending = active().length - list.length;
    return { ok: true, asOf: now(), feed, alerts: list, pending, disclaimer: 'Educational analysis of posted alerts. Not advice; nothing here places a trade.' };
  }
  async function detail(id) { const a = alerts.get(String(id)); if (!a) return null; if (!evaluated.has(a.id)) await refresh(); const ev = evaluated.get(a.id); if (!ev) return null; const quotes = await loadQuotes([a.symbol]); const fresh = await evaluate(a, quotes, lastContext.market, lastContext.sectorQuotes, true).catch(() => ev); evaluated.set(a.id, fresh); return publicAlert(fresh, true); }

  const avatarCache = new Map();
  /* the Activity's CSP blocks images from other hosts, so the poster's Discord avatar is fetched here and served from our own origin */
  async function avatar(alertId) {
    const a = alerts.get(String(alertId));
    if (!a || !a.authorId) return null;
    const key = a.authorId + ':' + (a.avatarHash || 'd');
    const hit = avatarCache.get(key);
    if (hit && hit.until > now()) return hit.value;
    let value = null;
    try {
      const url = a.avatarHash ? `https://cdn.discordapp.com/avatars/${a.authorId}/${a.avatarHash}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(a.authorId) >> 22n) % 6n)}.png`;
      const res = await fetchImpl(url, { headers: { 'user-agent': 'StockMarketLoop-Academy-Alerts/1.0' }, signal: AbortSignal.timeout(10_000) });
      if (res.ok) value = { type: 'image/png', body: Buffer.from(await res.arrayBuffer()) };
    } catch (_) { value = null; }
    avatarCache.set(key, { value, until: now() + (value ? 6 * 3600_000 : 300_000) });
    if (avatarCache.size > 100) avatarCache.delete(avatarCache.keys().next().value);
    return value;
  }

  function start() {
    if (running) return; running = true;
    const tick = async () => { try { await poll(); await refresh(); } catch (error) { logger('warn', 'academy_alerts_tick_failed', { error }); } };
    void tick();
    pollTimer = timers.setInterval(() => { void poll().catch(() => {}); }, pollMs); if (pollTimer && pollTimer.unref) pollTimer.unref();
    refreshTimer = timers.setInterval(() => { void refresh().catch(() => {}); }, refreshMs); if (refreshTimer && refreshTimer.unref) refreshTimer.unref();
  }
  function stop() { running = false; if (pollTimer) timers.clearInterval(pollTimer); if (refreshTimer) timers.clearInterval(refreshTimer); }

  return { start, stop, poll, refresh, snapshot, detail, avatar, alerts, feed, evaluated, ingest, active, sectorFor };
}

/** Channels the desk watches: the two GrandMaster streams, each with its mirror in the new server. */
function defaultChannels(env = process.env) {
  const parse = String(env.SML_ACADEMY_ALERT_CHANNELS || '').trim();
  if (parse) return parse.split(',').map((x) => x.trim().split(':')).filter((p) => p[0] && p[1]).map(([id, key, mirrorId]) => ({ id, key, mirrorId: mirrorId || '' }));
  return [
    { key: 'swings', id: '938944129348558848', mirrorId: '1547569293510705242' },
    { key: 'longterm', id: '1509325055849529455', mirrorId: '1547569298497867786' }
  ];
}

module.exports = { createAlertsService, defaultChannels, sectorFor, SECTORS };
