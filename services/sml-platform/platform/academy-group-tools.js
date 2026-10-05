'use strict';

/* Group Pro Tools service: the Academy's live analytics, offered to StockMarketLoop groups. One entry point per tool, all gathering their inputs from the same
 * engines the Academy uses (candles, live stream, Level 2, short data, options chain, sentiment) and degrading honestly when an input is missing.
 * Access is decided upstream by the WordPress group plugin (member, premium, or preview); `preview` here only trims what is returned. */
const { buildSetups } = require('./academy-setups');
const { absorptionMeter } = require('./academy-absorption');
const { buildStrategies } = require('./academy-strategies');
const { darkPoolSummary } = require('./academy-dark-pool-summary');

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const fin = Number.isFinite;

function cleanSymbol(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(s)) throw new TypeError('invalid_symbol');
  return s;
}

function createGroupTools({ candles, stream = null, orderFlow = null, orderFlowStore = null, alerts = null, sentiment = null, now = Date.now, ttlMs = 25_000, logger = () => {} } = {}) {
  if (typeof candles !== 'function') throw new TypeError('candles_required');
  const cache = new Map(), inflight = new Map();
  function memo(key, ms, fn) {
    const hit = cache.get(key); if (hit && hit.until > now()) return Promise.resolve(hit.value);
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve().then(fn).then((v) => { cache.set(key, { until: now() + ms, value: v }); if (cache.size > 600) cache.delete(cache.keys().next().value); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  }
  const soft = async (name, fn, fallback = null) => { try { const v = await fn(); return v === undefined ? fallback : v; } catch (error) { logger('warn', 'group_tools_input_failed', { input: name, error }); return fallback; } };
  const barsOf = async (symbol, tf) => { const r = await soft('candles:' + tf, () => candles(symbol, tf)); return r && Array.isArray(r.bars) ? r.bars : null; };

  async function priceOf(symbol, daily) {
    const live = stream && stream.peek ? stream.peek(symbol) : null;
    if (live && fin(live.last) && live.last > 0) return { price: live.last, source: 'live' };
    if (daily && daily.length) return { price: daily[daily.length - 1].c, source: 'last-close' };
    return { price: null, source: 'none' };
  }
  function flowOf(symbol) {
    if (!orderFlow) return null;
    try { if (orderFlow.touch) orderFlow.touch(symbol); const e = orderFlow.engines && orderFlow.engines.get(symbol); return e ? e.flow.analyze(now()) : null; } catch (_) { return null; }
  }
  function atrPct(daily, price) {
    if (!daily || daily.length < 16 || !(price > 0)) return null;
    let s = 0; const n = 14;
    for (let i = daily.length - n; i < daily.length; i++) { const b = daily[i], p = daily[i - 1]; s += Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)); }
    return s / n / price;
  }
  async function history() { if (!orderFlowStore || !orderFlowStore.configured) return null; return soft('absorb-history', () => orderFlowStore.summary(30)); }

  async function absorption(symbolRaw) {
    const symbol = cleanSymbol(symbolRaw);
    return memo('abs:' + symbol, 8_000, async () => {
      if (stream && stream.watch) stream.watch(symbol);
      const daily = await barsOf(symbol, '1D');
      const { price } = await priceOf(symbol, daily);
      const dAtr = atrPct(daily, price);
      const expected = dAtr ? dAtr / Math.sqrt(78) : null; // typical 5-minute move: the daily range spread over 78 five-minute bars
      const out = absorptionMeter({ ticks: stream && stream.ticks ? stream.ticks(symbol, 6000) : [], now: now(), expectedMovePct: expected, flow: flowOf(symbol), history: await history() });
      return { ok: true, symbol, asOf: now(), ...out };
    });
  }

  async function darkPool(symbolRaw) {
    const symbol = cleanSymbol(symbolRaw);
    return memo('dp:' + symbol, 6_000, async () => {
      if (stream && stream.watch) stream.watch(symbol);
      const live = stream && stream.peek ? stream.peek(symbol) : null;
      return { ok: true, symbol, asOf: now(), ...darkPoolSummary(live && live.stats, { price: live && live.last }) };
    });
  }

  async function shortRatio(symbol) {
    if (!alerts || !alerts.shortData) return null;
    const d = await soft('short', () => alerts.shortData(symbol));
    const avg = d && d.summary && Number(d.summary.avg_ratio);
    return fin(avg) ? { avgRatio: avg } : null;
  }

  async function setups(symbolRaw) {
    const symbol = cleanSymbol(symbolRaw);
    return memo('set:' + symbol, ttlMs, async () => {
      const [daily, weekly, m15, m5] = await Promise.all([barsOf(symbol, '1D'), barsOf(symbol, '1W'), barsOf(symbol, '15m'), barsOf(symbol, '5m')]);
      const { price, source } = await priceOf(symbol, daily);
      const [abs, sent, sh, er] = await Promise.all([
        soft('absorption', () => absorption(symbol)),
        sentiment ? soft('sentiment', () => sentiment.get(symbol)) : null,
        shortRatio(symbol),
        alerts && alerts.nextEarnings ? soft('earnings', () => alerts.nextEarnings(symbol)) : null
      ]);
      const r = buildSetups({ symbol, price, bars: { daily, weekly, m15, m5 }, flow: flowOf(symbol), absorption: abs && abs.available ? abs : null, shortData: sh, sentiment: sent && sent.available ? sent : null, earnings: er });
      return { ...r, priceSource: source };
    });
  }

  async function strategies(symbolRaw, params = {}) {
    const symbol = cleanSymbol(symbolRaw);
    const view = ['bullish', 'bearish', 'neutral'].includes(params.view) ? params.view : null;
    const horizonDays = Math.max(7, Math.min(400, Number(params.horizonDays) || 30));
    const shares = Number(params.shares) > 0 ? Math.min(1_000_000, Math.floor(Number(params.shares))) : 0;
    const cost = Number(params.cost) > 0 ? Number(params.cost) : null;
    const key = `str:${symbol}:${view}:${horizonDays}:${shares}:${cost}`;
    return memo(key, 20_000, async () => {
      const daily = await barsOf(symbol, '1D');
      const { price } = await priceOf(symbol, daily);
      let chosen = view;
      if (!chosen) { const s = await soft('setups-for-view', () => setups(symbol)); const side = s && s.bestFit ? s.bestFit.side : null; chosen = side === 'short' ? 'bearish' : side === 'long' ? 'bullish' : 'neutral'; }
      const rows = alerts && alerts.chainFor ? await soft('chain', () => alerts.chainFor(symbol)) : null;
      const out = buildStrategies({ symbol, spot: price, rows: rows || [], view: chosen, horizonDays, shares, cost, now: now() });
      return { ok: true, symbol, asOf: now(), viewSource: view ? 'chosen' : 'from the best-fit setup', ...out };
    });
  }

  async function sentimentFor(symbolRaw) {
    const symbol = cleanSymbol(symbolRaw);
    if (!sentiment) return { ok: false, available: false, reason: 'not_configured', symbol };
    return sentiment.get(symbol);
  }

  /* compact row per ticker for dashboards and watchlists */
  async function row(symbol) {
    return memo('row:' + symbol, 20_000, async () => {
      const daily = await barsOf(symbol, '1D');
      const { price, source } = await priceOf(symbol, daily);
      const prev = daily && daily.length > 1 ? daily[daily.length - 2].c : null;
      const [set, abs, dp, sent, er] = await Promise.all([
        soft('row-setups', () => setups(symbol)), soft('row-abs', () => absorption(symbol)), soft('row-dp', () => darkPool(symbol)),
        sentiment ? soft('row-sent', () => sentiment.get(symbol)) : null, alerts && alerts.nextEarnings ? soft('row-er', () => alerts.nextEarnings(symbol)) : null
      ]);
      return {
        symbol, price: fin(price) ? Math.round(price * 100) / 100 : null, priceSource: source,
        changePct: fin(price) && prev > 0 ? Math.round((price / prev - 1) * 10000) / 100 : null,
        sentiment: sent && sent.available ? { score: sent.scorePct, label: sent.label, coverage: sent.coverage } : null,
        absorption: abs && abs.available ? { score: abs.score, state: abs.state } : null,
        darkPool: dp && dp.available ? { offSharePct: dp.offSharePct } : null,
        setup: set && set.bestFit ? { horizon: set.bestFit.horizon, side: set.bestFit.side, grade: set.bestFit.grade, score: set.bestFit.score } : null,
        earnings: er && fin(er.daysAway) ? { date: er.date, daysAway: er.daysAway } : null
      };
    });
  }

  async function dashboard(symbolsRaw) {
    const list = [...new Set((Array.isArray(symbolsRaw) ? symbolsRaw : []).map((s) => { try { return cleanSymbol(s); } catch (_) { return null; } }).filter(Boolean))].slice(0, 12);
    if (!list.length) throw new TypeError('symbols_required');
    const rows = []; const lanes = 3;
    for (let i = 0; i < list.length; i += lanes) rows.push(...await Promise.all(list.slice(i, i + lanes).map((s) => row(s).catch(() => ({ symbol: s, error: 'unavailable' })))));
    return { ok: true, asOf: now(), rows, disclaimer: 'Educational context from live data, not a trade signal.' };
  }

  async function leaders(symbolsRaw) {
    const list = [...new Set((Array.isArray(symbolsRaw) ? symbolsRaw : []).map((s) => { try { return cleanSymbol(s); } catch (_) { return null; } }).filter(Boolean))].slice(0, 20);
    const all = await Promise.all(list.map((s) => darkPool(s).catch(() => null)));
    const rows = all.filter((d) => d && d.available).map((d) => ({ symbol: d.symbol, offSharePct: d.offSharePct, offVolume: d.offVolume, prints: d.prints, lean: d.lean ? d.lean.label : null })).sort((a, b) => b.offSharePct - a.offSharePct);
    return { ok: true, asOf: now(), rows, missing: list.length - rows.length, caveat: 'Off-exchange share varies by stock; compare a ticker with its own normal, not with others.' };
  }

  /* what a non-member of the paid tier sees: the headline, not the plan */
  function preview(tool, data) {
    if (!data || data.ok === false) return data;
    const note = 'Preview: join the group Premium tier for the full breakdown.';
    if (tool === 'setups') return { ...data, preview: true, note, cards: (data.cards || []).map((c) => (c.available && c.side !== 'neutral' ? { horizon: c.horizon, label: c.label, span: c.span, available: true, side: c.side, scoreGrade: c.scoreGrade, summary: c.summary.split('. ')[0] + '.' } : c)) };
    if (tool === 'strategies') return { ...data, preview: true, note, strategies: (data.strategies || []).map((s) => ({ id: s.id, name: s.name, kind: s.kind, why: s.why })) };
    if (tool === 'darkpool') return { ...data, preview: true, note, levels: [], largest: [] };
    if (tool === 'absorption') return { ...data, preview: true, note, tape: null, orderBook: null, history: undefined };
    if (tool === 'dashboard') return { ...data, preview: true, note, rows: (data.rows || []).slice(0, 3) };
    return { ...data, preview: true, note };
  }

  async function run(tool, input = {}) {
    const p = input.params || {};
    const map = {
      setups: () => setups(input.symbol), absorption: () => absorption(input.symbol), darkpool: () => darkPool(input.symbol), strategies: () => strategies(input.symbol, p),
      sentiment: () => sentimentFor(input.symbol), dashboard: () => dashboard(input.symbols), leaders: () => leaders(input.symbols)
    };
    if (!map[tool]) throw new TypeError('unknown_tool');
    const data = await map[tool]();
    return input.preview ? preview(tool, data) : data;
  }

  return { run, setups, absorption, darkPool, strategies, dashboard, leaders, row, TOOLS: ['setups', 'absorption', 'darkpool', 'strategies', 'sentiment', 'dashboard', 'leaders'] };
}

module.exports = { createGroupTools, cleanSymbol };
