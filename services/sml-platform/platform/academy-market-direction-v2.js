'use strict';

/* Market Direction v2: wraps the existing market direction read (sectors, tape, options, SML VIX, levels, checklist) and
 * adds what it lacked — the heavyweight stocks inside SPY read one by one and cap-weighted, breadth from the whole-market
 * snapshot, regime-aware scoring with SPY's own base rates, dealer gamma, cross-asset risk appetite, the catalyst calendar
 * (FOMC, jobs, expiration, rebalancing, heavyweight earnings) and a track record (every read is scored against what SPY then
 * did). The payload keeps every field the panel, MEM ALGO and the challenge already read (ok, bias, label, confidence,
 * coverage, components, levels, options, vol, checklist, flips) and adds `v2` and `calibration`. */

const engine = require('./academy-spy-engine');
const calendar = require('./academy-market-calendar');

/* The index's heavyweights: the names whose moves set SPY's direction. Weighted live by market capitalization. */
const HEAVY = ['NVDA', 'MSFT', 'AAPL', 'AMZN', 'META', 'AVGO', 'GOOGL', 'GOOG', 'TSLA', 'BRK.B', 'JPM', 'LLY', 'V', 'XOM', 'MA', 'COST', 'NFLX', 'WMT', 'JNJ', 'PG', 'HD', 'ABBV', 'BAC', 'ORCL', 'CVX', 'KO', 'CRM', 'AMD', 'PLTR', 'CSCO', 'WFC', 'GE', 'MRK', 'PEP', 'LIN', 'TMO', 'MCD', 'ACN', 'ADBE', 'PM', 'ISRG', 'IBM', 'ABT', 'TXN', 'CAT', 'GS', 'QCOM', 'INTU', 'DIS', 'AMGN'];
const ASSETS = ['SPY', 'QQQ', 'IWM', 'DIA', 'RSP', 'XLK', 'XLY', 'XLC', 'XLF', 'XLI', 'XLB', 'XLE', 'XLV', 'XLP', 'XLU', 'XLRE', 'TLT', 'HYG', 'LQD', 'UUP', 'GLD', 'CPER', 'IBIT'];
const LABEL = (b) => (b >= 55 ? 'Bullish' : b >= 20 ? 'Lean bullish' : b > -20 ? 'Neutral' : b > -55 ? 'Lean bearish' : 'Bearish');
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function etNow(ms) { const p = {}; for (const x of ET.formatToParts(new Date(ms))) p[x.type] = x.value; return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour === '24' ? 0 : p.hour) * 60 + Number(p.minute) }; }
const etDate = (ms) => etNow(ms).date;

function quoteFromSnapshot(r) {
  const last = num(r.lastTrade && r.lastTrade.p) || num(r.day && r.day.c) || num(r.min && r.min.c) || null;
  const prevClose = num(r.prevDay && r.prevDay.c), changePct = num(r.todaysChangePerc) != null ? Number(r.todaysChangePerc) : (last && prevClose ? (last / prevClose - 1) * 100 : null);
  return { last, changePct: changePct != null ? Math.round(changePct * 100) / 100 : null, prevClose, volume: num(r.day && r.day.v) || num(r.min && r.min.av) || null, prevVolume: num(r.prevDay && r.prevDay.v), vwap: num(r.day && r.day.vw) };
}

function createMarketDirectionV2({ base = null, snapshotAll = null, snapshotTickers = null, candles = null, volIndex = null, gamma = null, sentiment = null, company = null, earningsWindow = null, calendarExtra = null, store = null, now = Date.now, logger = () => {}, heavy = HEAVY } = {}) {
  const cal = engine.createCalibration({ store, now });
  const caches = new Map();
  const cached = async (key, ms, fn) => { const hit = caches.get(key); if (hit && hit.until > now()) return hit.value; if (hit && hit.pending) return hit.pending; let hung = null; const pending = Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { hung = setTimeout(() => reject(new Error('direction_source_timeout')), 60_000); if (hung.unref) hung.unref(); })]).finally(() => clearTimeout(hung)).then((v) => { caches.set(key, { value: v, until: now() + ms }); return v; }, (error) => { logger('warn', 'direction_v2_source_failed', { key, error: String(error && error.message || error) }); const old = caches.get(key); const v = old ? old.value : null; caches.set(key, { value: v, until: now() + Math.min(ms, 30_000) }); return v; }); caches.set(key, { ...(hit || {}), pending, until: hit ? hit.until : 0 }); return pending; };
  const timed = (fn, ms) => Promise.race([Promise.resolve().then(fn), new Promise((r) => { const t = setTimeout(() => r(null), ms); if (t.unref) t.unref(); })]).catch(() => null);
  const barsOf = async (symbol, tf) => { if (!candles) return []; const p = await candles(symbol, tf); return p && Array.isArray(p.bars) ? p.bars : (Array.isArray(p) ? p : []); };

  /* live market caps for the heavyweights, refreshed daily; without a company lookup the names are weighted equally */
  const weights = () => cached('weights', 24 * 3_600_000, async () => {
    const out = {};
    if (company) {
      await Promise.all(heavy.map(async (s) => { const c = await timed(() => company(s), 8_000); const cap = c && num(c.market_cap ?? c.marketCap); if (cap > 0) out[s] = cap; }));
    }
    const caps = Object.values(out); const total = caps.reduce((a, b) => a + b, 0);
    if (caps.length >= heavy.length * 0.6 && total > 0) return { source: 'market capitalization', map: Object.fromEntries(Object.entries(out).map(([s, c]) => [s, c / total])) };
    return { source: 'equal weight (market caps unavailable)', map: Object.fromEntries(heavy.map((s) => [s, 1 / heavy.length])) };
  });
  const earningsMap = () => cached('earnings', 3_600_000, async () => { if (!earningsWindow) return {}; const list = await timed(() => earningsWindow(10), 12_000); const m = {}; for (const e of list || []) if (e && e.symbol && e.date) m[String(e.symbol).toUpperCase()] = e.date; return m; });

  async function gather(mode) {
    const t = now(), et = etNow(t), today = et.date;
    const open = et.minutes >= 570 && et.minutes < 960;
    const quotesTtl = open ? 15_000 : 60_000;
    const [spyDailyRaw, spy5Raw, snap, all, vix, gx, sent, w, em] = await Promise.all([
      cached('spy1d', 120_000, () => barsOf('SPY', '1D')),
      cached('spy5m', open ? 30_000 : 120_000, () => barsOf('SPY', '5m')),
      cached('quotes', quotesTtl, async () => (snapshotTickers ? await snapshotTickers([...ASSETS, ...heavy]) : [])),
      cached('all', open ? 60_000 : 300_000, async () => (snapshotAll ? await snapshotAll() : [])),
      cached('vix', 60_000, async () => { if (!volIndex) return null; const v = await volIndex.get(); if (!v || !v.ok) return null; let change = null; try { const openMs = Date.parse(today + 'T09:30:00-04:00'); const c = volIndex.changeSince(openMs); change = c && num(c.pct) != null ? Number(c.pct) : null; } catch (_) { change = null; } return { level: v.level, change }; }),
      cached('gamma', 120_000, () => (gamma ? timed(() => gamma.get('SPY'), 15_000) : null)),
      cached('sentiment', 120_000, () => (sentiment ? timed(() => sentiment.get('SPY'), 10_000) : null)),
      weights(), earningsMap()
    ]);
    const spyDaily = (spyDailyRaw || []).filter((b) => etDate(Number(b.t)) < today);
    const spyIntraday = (spy5Raw || []).filter((b) => etDate(Number(b.t)) === today);
    const quotes = {}; for (const r of snap || []) if (r && r.ticker) quotes[String(r.ticker).toUpperCase()] = quoteFromSnapshot(r);
    const dayOf = (iso) => Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86_400_000);
    const constituents = heavy.map((s) => { const q = quotes[s]; if (!q || q.changePct == null) return null; const ed = em && em[s] ? dayOf(em[s]) : null; return { symbol: s, weight: w.map[s] || 0, changePct: q.changePct, rvol: open && q.volume && q.prevVolume ? q.volume / q.prevVolume : null, aboveVwap: q.last != null && q.vwap != null ? q.last >= q.vwap : null, earningsDays: ed, catalyst: ed != null && ed >= 0 && ed <= 7 ? `earnings in ${ed} day${ed === 1 ? '' : 's'}` : null }; }).filter(Boolean);
    let breadth = null;
    try { const it = require('./market-direction').internalsFrom(all || []); if (it && it.universe > 500) breadth = { n: it.universe, advancing: it.adv, declining: it.dec, upVolume: it.upVol, downVolume: it.downVol, newHighs: it.nearHigh, newLows: it.nearLow }; } catch (_) { breadth = null; }
    const macro = calendar.upcoming({ now: t, days: 7, extra: calendarExtra });
    const heavyEarnings = constituents.filter((c) => c.earningsDays != null && c.earningsDays >= 0 && c.earningsDays <= 7).sort((a, b) => b.weight - a.weight).map((c) => ({ date: em[c.symbol], label: `${c.symbol} earnings`, kind: 'earnings', impact: c.weight >= 0.05 ? 3 : c.weight >= 0.02 ? 2 : 1, daysAway: c.earningsDays, note: `${Math.round(c.weight * 100)}% of the tracked heavyweights' capitalization.` }));
    const events = [...macro, ...heavyEarnings].sort((a, b) => (a.daysAway - b.daysAway) || (b.impact - a.impact));
    const risk = calendar.eventRisk({ now: t, extra: calendarExtra });
    const heavyRisk = heavyEarnings.reduce((m, e) => Math.max(m, (e.impact / 3) * (e.daysAway === 0 ? 0.8 : e.daysAway === 1 ? 0.5 : 0.2)), 0);
    const gammaIn = gx && gx.available ? { gex: num(gx.netGex), flip: num(gx.flipStrike), callWall: gx.callWall ? num(gx.callWall.strike) : null, putWall: gx.putWall ? num(gx.putWall.strike) : null } : null;
    const sentIn = sent && sent.ok && sent.available !== false ? { score: num(sent.score), label: sent.label || null, crowdedLong: !!(sent.components && sent.components.options && sent.components.options.crowdedLong) } : null;
    return { t, today, open, spyDaily, spyIntraday, quotes, constituents, breadth, vix, gamma: gammaIn, sentiment: sentIn, calendar: { risk: Math.max(risk.score, heavyRisk), events: events.slice(0, 12), macro: risk.events }, weightSource: w.source };
  }

  let lastRecordAt = 0;
  async function get(mode = 'day') {
    const m = mode === 'swing' ? 'swing' : 'day';
    return cached('result:' + m, m === 'day' ? 20_000 : 120_000, async () => {
      const [v1, d] = await Promise.all([base ? timed(() => base.get(m), 25_000) : null, gather(m)]);
      const v2 = engine.compose({ now: d.t, spyDaily: d.spyDaily, spyIntraday: d.spyIntraday, quotes: d.quotes, vix: d.vix, gamma: d.gamma, constituents: d.constituents, breadth: d.breadth, calendar: d.calendar, sentiment: d.sentiment });
      const pick = m === 'day' ? v2.day : v2.swing;
      // track record: the day's latest read is kept (a few writes an hour), scored against the next closes
      try { if (d.t - lastRecordAt > 5 * 60_000) { lastRecordAt = d.t; await cal.record({ date: d.today, dayBias: v2.day.bias, swingBias: v2.swing.bias, dayConfidence: v2.day.confidence, swingConfidence: v2.swing.confidence, spyClose: d.quotes.SPY ? d.quotes.SPY.last : null }); await cal.settle(d.spyDaily); } } catch (_) { /* best effort */ }
      const calibration = await cal.summary().catch(() => null);
      const wkey = m === 'day' ? 'wDay' : 'wSwing';
      const components = v2.signals.filter((s) => s[wkey] > 0).sort((a, b) => b[wkey] - a[wkey]).map((s) => ({ key: s.key, label: s.label, score: Math.max(-2, Math.min(2, Math.round(s.score * 2))), weight: Math.round(s[wkey] * 10), available: true, reasons: [s.detail] }));
      const legacy = v1 && v1.ok ? v1 : {};
      const flips = [...(v2.flips || []), ...((legacy.flips || []).slice(0, 2))];
      return {
        ...legacy, ok: true, mode: m, asOf: d.t, session: legacy.session || (d.open ? 'open' : 'closed'),
        bias: pick.bias, label: LABEL(pick.bias), confidence: pick.confidence, coverage: legacy.coverage != null ? legacy.coverage : Math.min(100, components.length * 8),
        components, flips, checklist: legacy.checklist || [], levels: legacy.levels || {}, options: legacy.options || null, vol: legacy.vol || null, unusualVolume: legacy.unusualVolume || [],
        v2: { regime: v2.regime, day: v2.day, swing: v2.swing, constituents: v2.constituents, breadth: v2.breadth, rotation: v2.rotation, volatility: v2.volatility, gamma: v2.gamma, crossAsset: v2.crossAsset, intraday: v2.intraday, baseRates: v2.baseRates, calendar: d.calendar, sentiment: v2.sentiment, expectedMove: v2.expectedMove, weightSource: d.weightSource },
        calibration,
        proxies: (legacy.proxies || '') + ' Heavyweights are the 50 largest S&P names weighted by ' + d.weightSource + '; breadth is the whole US stock snapshot; catalysts are the FOMC, jobs, expiration and rebalancing calendar plus heavyweight earnings.',
        disclaimer: 'Educational market read built from recorded conditions and their historical base rates. Not advice; no read is certain and nothing here places a trade.'
      };
    });
  }
  const unusualVolume = () => (base && base.unusualVolume ? base.unusualVolume() : { ok: false, rows: [] });
  return { get, unusualVolume, calibration: cal, HEAVY: heavy };
}

module.exports = { createMarketDirectionV2, quoteFromSnapshot, HEAVY, ASSETS, LABEL };
