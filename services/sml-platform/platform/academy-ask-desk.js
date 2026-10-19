'use strict';

/* The desk read that rides with an Ask Obi question about a stock (academy-ask.js): the numbers Obi needs to answer
 * "is X worth entering still" with a price instead of a lecture. Everything comes from what the Academy already computes:
 *   - the daily tape: last, day / 5-day / 20-day change, the 20-day high and low and how far price sits from each, the 10
 *     and 20-day averages, ATR (the typical daily move), relative volume, consecutive up days
 *   - extension: how far above the 10-day low and the 20-day average the move is, in ATRs, so "chasing" is a number
 *   - MEM ALGO (academy-mem-algo.js): the swing bias and the latest signal with its entry, stop and target; the day read too
 *   - the smart-money map (academy-smart-money.js): the last break of structure, premium / discount, nearest imbalance, equal highs / lows
 *   - the intraday tape when the market is open: VWAP, high and low of day, where price sits against them
 *   - chart patterns forming (academy-patterns.js), the float and short picture, sentiment, the next earnings date
 * Each source is optional and time-boxed; a source that fails is left out, never guessed. Pure text out, under maxChars. */

const DAY_MS = 86_400_000;
const fin = Number.isFinite;
const px = (v) => (fin(v) ? (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4)) : '–');
const pct = (v, d = 1) => (fin(v) ? (v > 0 ? '+' : '') + v.toFixed(d) + '%' : '–');
const big = (v) => (!fin(v) ? '–' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)));
const clean = (bars) => (Array.isArray(bars) ? bars : []).map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 })).filter((b) => fin(b.t) && fin(b.o) && fin(b.h) && fin(b.l) && fin(b.c));
const sma = (arr, n) => (arr.length >= n ? arr.slice(-n).reduce((s, v) => s + v, 0) / n : null);
function atr14(b) {
  if (b.length < 15) return null;
  let s = 0; for (let i = b.length - 14; i < b.length; i++) { const p = b[i - 1].c; s += Math.max(b[i].h - b[i].l, Math.abs(b[i].h - p), Math.abs(b[i].l - p)); }
  return s / 14;
}

/** the daily-tape block, pure: lines of text plus the numbers the other blocks lean on */
function dailyRead(symbol, dailyBars) {
  const b = clean(dailyBars); const out = []; if (b.length < 2) return { lines: out, last: null };
  const n = b.length, L = b[n - 1], P = b[n - 2], closes = b.map((x) => x.c);
  const chg = (k) => (n > k ? (L.c / b[n - 1 - k].c - 1) * 100 : null);
  const win = b.slice(-20), hi20 = Math.max(...win.map((x) => x.h)), lo20 = Math.min(...win.map((x) => x.l)), lo10 = Math.min(...b.slice(-10).map((x) => x.l));
  const s10 = sma(closes, 10), s20 = sma(closes, 20), s50 = sma(closes, 50), atr = atr14(b);
  const vol20 = n > 21 ? b.slice(-21, -1).reduce((s, x) => s + x.v, 0) / 20 : null, rvol = vol20 ? L.v / vol20 : null;
  let ups = 0; for (let i = n - 1; i > 0 && b[i].c > b[i - 1].c; i--) ups += 1;
  let downs = 0; for (let i = n - 1; i > 0 && b[i].c < b[i - 1].c; i--) downs += 1;
  out.push(symbol + ' last ' + px(L.c) + ' (' + pct((L.c / P.c - 1) * 100) + ' on the day' + (fin(chg(5)) ? ', ' + pct(chg(5)) + ' in 5 days' : '') + (fin(chg(20)) ? ', ' + pct(chg(20)) + ' in 20 days' : '') + '). Day range ' + px(L.l) + ' to ' + px(L.h) + '.');
  out.push('20-day high ' + px(hi20) + ' (' + pct((L.c / hi20 - 1) * 100) + ' from it), 20-day low ' + px(lo20) + ' (' + pct((L.c / lo20 - 1) * 100) + ' above it). 10-day low ' + px(lo10) + '.');
  if (s10 != null && s20 != null) out.push('10-day average ' + px(s10) + ', 20-day average ' + px(s20) + (s50 != null ? ', 50-day ' + px(s50) : '') + ': price is ' + pct((L.c / s20 - 1) * 100) + ' from the 20-day' + (s50 != null ? ' and ' + pct((L.c / s50 - 1) * 100) + ' from the 50-day' : '') + '.');
  if (atr) out.push('ATR(14) ' + (L.c >= 1 ? atr.toFixed(2) : atr.toFixed(4)) + ' (' + (atr / L.c * 100).toFixed(1) + '% a day is a normal move). Extension: ' + ((L.c - lo10) / atr).toFixed(1) + ' ATRs above the 10-day low' + (s20 != null ? ', ' + ((L.c - s20) / atr).toFixed(1) + ' ATRs from the 20-day average' : '') + '.');
  if (rvol != null) out.push('Volume ' + big(L.v) + ' vs ' + big(vol20) + ' average (' + rvol.toFixed(1) + 'x relative volume).');
  if (ups >= 2) out.push(ups + ' up days in a row.'); else if (downs >= 2) out.push(downs + ' down days in a row.');
  return { lines: out, last: L.c, atr, s20, hi20, lo20, lo10, rvol };
}

/** MEM ALGO's read in one or two lines: the bias and the latest signal with its levels */
function memRead(memAlgo, bars, mode, tf) {
  try {
    if (!memAlgo || typeof memAlgo.analyze !== 'function') return [];
    const r = memAlgo.analyze(bars, mode, {}, tf, {});
    if (!r || !r.enoughData) return [];
    const out = ['MEM ALGO ' + mode + ' read (' + tf + '): bias ' + String(r.bias || 'warming').toUpperCase() + '.'];
    const s = r.latest;
    if (s && fin(s.price)) {
      const age = r.bars - 1 - s.i, grade = s.conf && s.conf.grade ? ' grade ' + s.conf.grade + (fin(s.conf.score) ? ' (' + s.conf.score + ')' : '') : '';
      out.push('Latest MEM signal: ' + (s.dir > 0 ? 'LONG' : 'SHORT') + ' at ' + px(s.price) + ', ' + age + ' bar' + (age === 1 ? '' : 's') + ' ago' + grade + '; stop ' + px(s.stop) + (fin(s.target) ? ', target ' + px(s.target) : '') + (r.open ? ' (still open)' : '') + '.');
    }
    const st = r.stats; if (st && fin(st.trades) && st.trades >= 8 && fin(st.winRate)) out.push('This setup on this chart: ' + st.trades + ' past signals, ' + Math.round(st.winRate * 100) + '% won' + (fin(st.profitFactor) ? ', profit factor ' + Number(st.profitFactor).toFixed(2) : '') + '.');
    return out;
  } catch (_) { return []; }
}

/** the smart-money map in plain lines */
function smcRead(smartMoney, bars) {
  try {
    if (!smartMoney || typeof smartMoney.analyze !== 'function') return [];
    const a = smartMoney.analyze(bars); if (!a) return [];
    const lines = (typeof smartMoney.read === 'function' ? smartMoney.read(a) : []).slice(0, 4).map((x) => (x && x.text ? String(x.text) : '')).filter(Boolean);
    return lines.length ? ['Smart money map: ' + lines.join(' ')] : [];
  } catch (_) { return []; }
}

/** today's intraday tape: VWAP, high / low of day */
function intradayRead(smartMoney, intraBars, last) {
  const b = clean(intraBars); if (b.length < 10) return [];
  const dayKey = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const today = dayKey(b[b.length - 1].t), td = b.filter((x) => dayKey(x.t) === today); if (td.length < 3) return [];
  const hod = Math.max(...td.map((x) => x.h)), lod = Math.min(...td.map((x) => x.l)), L = td[td.length - 1].c;
  let vw = null; try { const a = smartMoney && typeof smartMoney.analyze === 'function' ? smartMoney.analyze(td) : null; const s = a && a.vwap && (a.vwap.vwap || a.vwap.values || a.vwap); if (Array.isArray(s) && fin(s[s.length - 1])) vw = s[s.length - 1]; } catch (_) { vw = null; }
  if (vw == null) { let pv = 0, vv = 0; for (const x of td) { const tp = (x.h + x.l + x.c) / 3; pv += tp * x.v; vv += x.v; } vw = vv > 0 ? pv / vv : null; }
  return ['Today: high of day ' + px(hod) + ' (' + pct((L / hod - 1) * 100) + ' from it), low of day ' + px(lod) + (vw != null ? ', VWAP ' + px(vw) + ' (price ' + pct((L / vw - 1) * 100) + ' from VWAP)' : '') + '.'];
}

function patternsRead(patterns, bars) {
  try {
    if (!patterns || typeof patterns.detect !== 'function') return [];
    const r = patterns.detect(bars, {}); if (!r || !r.ok) return [];
    const forming = (r.charts || []).filter((p) => p && (p.status === 'forming' || p.status === 'confirmed')).slice(0, 2).map((p) => (p.name || p.type) + ' (' + p.dir + ', ' + p.status + ')');
    const lv = (r.levels || []).slice(0, 3).map((l) => l.kind + ' ' + px(l.p) + ' (' + l.touches + ' touches)');
    const out = []; if (forming.length) out.push('Chart patterns: ' + forming.join('; ') + '.'); if (lv.length) out.push('Levels on the daily: ' + lv.join(', ') + '.');
    return out;
  } catch (_) { return []; }
}

function createAskDesk({ candles = null, memAlgo = null, smartMoney = null, patterns = null, scannerRow = null, shortQuick = null, sentiment = null, earnings = null, marketDirection = null, smlVix = null, now = Date.now, logger = () => {}, timeoutMs = 4_000, maxChars = 6_000 } = {}) {
  const within = (fn, ms) => Promise.race([Promise.resolve().then(fn), new Promise((r) => setTimeout(() => r(null), ms || timeoutMs))]).catch((error) => { logger('warn', 'academy_ask_desk_source_failed', { error: String(error && error.message || error) }); return null; });

  async function marketLines(horizon) {
    const lines = [];
    if (marketDirection && typeof marketDirection.get === 'function') {
      const d = await within(() => marketDirection.get(horizon === 'week' || horizon === 'month' || horizon === 'longer' ? 'swing' : 'day'));
      if (d && d.ok) {
        lines.push('Market Direction (' + d.mode + ' read, ' + (d.session || '') + '): ' + d.label + ', bias ' + d.bias + ', confidence ' + d.confidence + '/100.');
        const v2 = d.v2 || {};
        if (v2.regime && v2.regime.label) lines.push('Regime: ' + v2.regime.label + '.');
        if (v2.day && v2.swing) lines.push('Day bias ' + v2.day.bias + ' (' + v2.day.confidence + ') · swing bias ' + v2.swing.bias + ' (' + v2.swing.confidence + ').');
        if (v2.breadth && fin(v2.breadth.advancing)) lines.push('Breadth: ' + v2.breadth.advancing + ' of ' + (v2.breadth.total || '?') + ' stocks advancing.');
        if (v2.expectedMove && fin(v2.expectedMove.pct)) lines.push('Options expected move: ±' + v2.expectedMove.pct.toFixed(2) + '%.');
        const spy = v2.constituents && v2.constituents.quotes ? v2.constituents.quotes.SPY : null;
        if (d.levels && (d.levels.support || d.levels.resistance)) lines.push('SPY levels: support ' + px(Number(d.levels.support)) + ', resistance ' + px(Number(d.levels.resistance)) + '.');
        if (spy && fin(spy.last)) lines.push('SPY ' + px(spy.last) + (fin(spy.changePct) ? ' (' + pct(spy.changePct, 2) + ' today)' : '') + '.');
        for (const c of (d.components || []).slice(0, 6)) lines.push('- ' + c.label + ': ' + (c.score > 0 ? '+' : '') + c.score + (c.reasons && c.reasons[0] ? ' (' + String(c.reasons[0]).slice(0, 120) + ')' : ''));
        const ev = v2.calendar && v2.calendar.events ? v2.calendar.events.slice(0, 4).map((e) => e.label || e.name || e.title).filter(Boolean) : [];
        if (ev.length) lines.push('Catalysts ahead: ' + ev.join('; ') + '.');
        if (d.calibration && d.calibration.hitRate != null) lines.push('This read\'s own track record: ' + d.calibration.hitRate + '% of past calls right.');
      }
    }
    if (smlVix && typeof smlVix.get === 'function') { const v = await within(() => smlVix.get(), 2_500); if (v && v.ok && fin(v.level)) lines.push('SML VIX ' + v.level.toFixed(1) + '.'); }
    return lines;
  }

  async function tickerLines(symbol, horizon) {
    const sym = String(symbol || '').toUpperCase(); if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym) || typeof candles !== 'function') return [];
    const [d1, m5] = await Promise.all([within(() => candles(sym, '1D')), within(() => candles(sym, '5m'), 3_000)]);
    const daily = clean(d1 && d1.bars), intra = clean(m5 && m5.bars);
    if (!daily.length && !intra.length) return [sym + ': no price history came back from the feed.'];
    const lines = [];
    const D = dailyRead(sym, daily); lines.push(...D.lines);
    if (daily.length) lines.push(...memRead(memAlgo, daily, horizon === 'today' || horizon === 'tomorrow' ? 'day' : 'swing', '1D'));
    if (intra.length >= 60) lines.push(...memRead(memAlgo, intra, 'day', '5m').slice(0, 2));
    if (daily.length >= 20) lines.push(...smcRead(smartMoney, daily));
    lines.push(...intradayRead(smartMoney, intra, D.last));
    if (daily.length >= 40) lines.push(...patternsRead(patterns, daily));
    const [row, sq, se, er] = await Promise.all([
      typeof scannerRow === 'function' ? within(() => scannerRow(sym), 2_500) : null,
      typeof shortQuick === 'function' ? within(() => shortQuick(sym), 3_000) : null,
      typeof sentiment === 'function' ? within(() => sentiment(sym), 3_000) : null,
      typeof earnings === 'function' ? within(() => earnings(sym), 3_000) : null
    ]);
    if (row) { const parts = []; if (fin(+row.sharesFloat) && +row.sharesFloat > 0) parts.push('float ' + big(+row.sharesFloat)); if (fin(+row.marketCap) && +row.marketCap > 0) parts.push('market cap ' + big(+row.marketCap)); if (fin(+row.rvol) && !D.rvol) parts.push('relative volume ' + (+row.rvol).toFixed(1) + 'x'); if (row.name) parts.unshift(String(row.name).slice(0, 60)); if (parts.length) lines.push('Scanner: ' + parts.join(', ') + '.'); }
    if (sq && sq.available) lines.push('Short picture: ' + (fin(sq.pctFloat) ? sq.pctFloat + '% of the float short' : 'short % unknown') + (fin(sq.daysToCover) ? ', ' + sq.daysToCover + ' days to cover' : '') + (fin(sq.fuel) ? ', squeeze fuel ' + sq.fuel + '/100' : '') + '.');
    if (se && se.available) lines.push('Sentiment: ' + (se.scorePct != null ? (se.scorePct >= 0 ? '+' : '') + se.scorePct : '') + ' ' + String(se.label || '') + (se.coverage != null ? ' (' + se.coverage + '% of sources)' : '') + '.');
    if (er) { const when = nextEarnings(er, now()); if (when) lines.push('Next earnings: ' + when.date + (fin(when.days) ? ' (' + when.days + ' days away)' : '') + '.'); }
    return lines;
  }

  async function read({ subject = null, horizon = null, question = '' } = {}) {
    const market = await marketLines(horizon);
    const ticker = subject && subject !== 'market' ? await tickerLines(subject, horizon) : [];
    const out = [];
    if (ticker.length) { out.push('THE STOCK ASKED ABOUT (' + String(subject).toUpperCase() + '):'); out.push(...ticker); out.push(''); }
    if (market.length) { out.push('THE MARKET:'); out.push(...market); }
    return out.join('\n').trim().slice(0, maxChars);
  }

  return { read, tickerLines, marketLines };
}

const DATE_KEYS = ['date', 'reportDate', 'report_date', 'earningsDate', 'earnings_date', 'nextEarningsDate', 'next_earnings_date'];
/** the next report date in an earnings payload of any of the shapes the bridge returns */
function nextEarnings(data, nowMs) {
  const rows = Array.isArray(data) ? data : (data && (data.events || data.rows || data.data || data.earnings || data.items)) || (data && typeof data === 'object' ? [data] : []);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  let best = null;
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r || typeof r !== 'object') continue;
    for (const k of DATE_KEYS) { const v = r[k]; if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const d = v.slice(0, 10); if (d >= today && (!best || d < best)) best = d; } }
  }
  if (!best) return null;
  return { date: best, days: Math.round((Date.parse(best + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY_MS) };
}

module.exports = { createAskDesk, dailyRead, memRead, smcRead, intradayRead, patternsRead, nextEarnings };
