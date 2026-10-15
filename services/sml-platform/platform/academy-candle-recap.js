'use strict';

/* Candle recap: one higher-timeframe candle (a day, week, month, quarter or year) read in full.
 *
 * Everything comes from real records: the daily and intraday bars (Massive), the FINRA Reg SHO daily short-volume files
 * (short volume and the total volume reported off-exchange — the dark pool / internalized share — per session), the live
 * off-exchange tape for today, the symbol's short-data feed when the plan has it, the smart-money map (structure, imbalances,
 * liquidity, order blocks, VWAP), the candle and chart pattern detector, and the sentiment service. The master read at the end
 * scores those parts together into a bias, a confidence, the levels that matter and two scenarios. Educational, never advice. */

const FINRA_BASE = 'https://cdn.finra.org/equity/regsho/daily/';
const TYPICAL_OFF_SHARE = 0.42; // share of US equity volume that prints off-exchange on a normal session (FINRA TRF share, 2024-2026)
const MAX_FINRA_DAYS = 25;

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- New York calendar ---------- */
const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
function etParts(ms) {
  const p = {}; for (const x of ET.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const key = (p) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
const etDate = (ms) => key(etParts(ms));
const dayNum = (p) => Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000); // calendar day index, for week arithmetic

/* The period a bar of this timeframe covers, as a predicate on New York dates, plus a label. */
function periodOf(tf, t) {
  const p = etParts(t);
  if (tf === '1D') return { kind: 'day', test: (q) => q.y === p.y && q.m === p.m && q.d === p.d, label: key(p), from: key(p), to: key(p) };
  if (tf === '1W') {
    const start = dayNum(p) - ((p.wd + 6) % 7); // Monday
    const inWeek = (q) => { const n = dayNum(q); return n >= start && n < start + 7; };
    const d0 = new Date(start * 86400000), d1 = new Date((start + 4) * 86400000);
    const f = (d) => d.toISOString().slice(0, 10);
    return { kind: 'week', test: inWeek, label: 'Week of ' + f(d0), from: f(d0), to: f(d1) };
  }
  if (tf === '1M') return { kind: 'month', test: (q) => q.y === p.y && q.m === p.m, label: new Date(Date.UTC(p.y, p.m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), from: `${p.y}-${String(p.m).padStart(2, '0')}-01`, to: `${p.y}-${String(p.m).padStart(2, '0')}-31` };
  if (tf === '1Q') { const q0 = Math.floor((p.m - 1) / 3); return { kind: 'quarter', test: (q) => q.y === p.y && Math.floor((q.m - 1) / 3) === q0, label: `Q${q0 + 1} ${p.y}`, from: `${p.y}-${String(q0 * 3 + 1).padStart(2, '0')}-01`, to: `${p.y}-${String(q0 * 3 + 3).padStart(2, '0')}-31` }; }
  if (tf === '1Y') return { kind: 'year', test: (q) => q.y === p.y, label: String(p.y), from: `${p.y}-01-01`, to: `${p.y}-12-31` };
  return null;
}
const RECAP_TFS = ['1D', '1W', '1M', '1Q', '1Y'];

/* ---------- period statistics from daily bars ---------- */
function sma(arr, n, end) { if (end + 1 < n) return null; let s = 0; for (let i = end - n + 1; i <= end; i++) s += arr[i]; return s / n; }
function atr14(days, end) {
  const n = 14; if (end < n) return null;
  let s = 0; for (let i = end - n + 1; i <= end; i++) { const d = days[i], pc = days[i - 1].c; s += Math.max(d.h - d.l, Math.abs(d.h - pc), Math.abs(d.l - pc)); }
  return s / n;
}
function periodStats(days, idx0, idx1, bar) {
  const inside = days.slice(idx0, idx1 + 1);
  if (!inside.length) return null;
  const o = num(bar && bar.o, inside[0].o), h = num(bar && bar.h, Math.max(...inside.map((d) => d.h))), l = num(bar && bar.l, Math.min(...inside.map((d) => d.l)));
  const c = num(bar && bar.c, inside[inside.length - 1].c), v = num(bar && bar.v, inside.reduce((s, d) => s + (d.v || 0), 0));
  const prev = idx0 > 0 ? days[idx0 - 1] : null, next = idx1 + 1 < days.length ? days[idx1 + 1] : null;
  const range = h - l, body = Math.abs(c - o);
  const closeLoc = range > 0 ? (c - l) / range : 0.5;
  const upperWick = range > 0 ? (h - Math.max(o, c)) / range : 0, lowerWick = range > 0 ? (Math.min(o, c) - l) / range : 0;
  const closes = days.map((d) => d.c);
  const s20 = sma(closes, 20, idx1), s50 = sma(closes, 50, idx1), s200 = sma(closes, 200, idx1);
  const atrBefore = atr14(days, Math.max(14, idx0 - 1)) || atr14(days, idx1);
  const avgVol20 = idx0 >= 20 ? days.slice(idx0 - 20, idx0).reduce((s, d) => s + (d.v || 0), 0) / 20 : null;
  const avgDayVol = v / inside.length;
  const ups = inside.filter((d) => d.c > d.o).length, downs = inside.filter((d) => d.c < d.o).length;
  const best = inside.reduce((a, d) => ((d.c / (d.o || d.c) - 1) > (a.c / (a.o || a.c) - 1) ? d : a), inside[0]);
  const worst = inside.reduce((a, d) => ((d.c / (d.o || d.c) - 1) < (a.c / (a.o || a.c) - 1) ? d : a), inside[0]);
  let peak = -Infinity, dd = 0; for (const d of inside) { peak = Math.max(peak, d.h); dd = Math.min(dd, d.l / peak - 1); }
  let streak = 0; if (prev) { const dir = Math.sign(prev.c - prev.o); for (let i = idx0 - 1; i >= 0 && Math.sign(days[i].c - days[i].o) === dir && dir !== 0; i--) streak += 1; streak *= dir; }
  const yearStart = Math.max(0, idx1 - 251), hi52 = Math.max(...days.slice(yearStart, idx1 + 1).map((d) => d.h)), lo52 = Math.min(...days.slice(yearStart, idx1 + 1).map((d) => d.l));
  const slope20 = idx1 >= 25 && s20 != null ? (s20 / sma(closes, 20, idx1 - 5) - 1) : null;
  return {
    sessions: inside.length, o: r2(o), h: r2(h), l: r2(l), c: r2(c), v: Math.round(v),
    prevClose: prev ? r2(prev.c) : null, nextClose: next ? r2(next.c) : null,
    changePct: prev ? r2((c / prev.c - 1) * 100) : null, bodyPct: r2((c / o - 1) * 100), rangePct: r2(range / (prev ? prev.c : o) * 100),
    gapPct: prev ? r2((o / prev.c - 1) * 100) : null, nextChangePct: next ? r2((next.c / c - 1) * 100) : null,
    closeLoc: r3(closeLoc), bodyRatio: range > 0 ? r3(body / range) : 0, upperWick: r3(upperWick), lowerWick: r3(lowerWick),
    rangeAtr: atrBefore ? r2(range / atrBefore) : null, atr: atrBefore ? r2(atrBefore) : null,
    rvol: avgVol20 ? r2(avgDayVol / avgVol20) : null, avgDayVol: Math.round(avgDayVol),
    ups, downs, bestDay: { date: etDate(best.t), pct: r2((best.c / best.o - 1) * 100) }, worstDay: { date: etDate(worst.t), pct: r2((worst.c / worst.o - 1) * 100) },
    maxDrawdownPct: r2(dd * 100), streakBefore: streak,
    sma20: s20 != null ? r2(s20) : null, sma50: s50 != null ? r2(s50) : null, sma200: s200 != null ? r2(s200) : null, slope20Pct: slope20 != null ? r2(slope20 * 100) : null,
    hi52: r2(hi52), lo52: r2(lo52), pos52: hi52 > lo52 ? r3((c - lo52) / (hi52 - lo52)) : null,
    relation: prev ? (h > prev.h && l < prev.l ? 'outside' : h <= prev.h && l >= prev.l ? 'inside' : body > Math.abs(prev.c - prev.o) && ((c > o && c > prev.h) || (c < o && c < prev.l)) ? 'engulfing' : 'overlap') : null
  };
}

/* ---------- FINRA Reg SHO daily short volume (off-exchange prints) ---------- */
function parseFinra(text) {
  const out = new Map();
  for (const line of String(text || '').split('\n')) {
    const f = line.split('|'); if (f.length < 5 || f[0] === 'Date') continue;
    const sym = f[1].trim(); if (!sym) continue;
    const s = num(f[2], 0), e = num(f[3], 0), t = num(f[4], 0);
    const prev = out.get(sym) || [0, 0, 0];
    out.set(sym, [prev[0] + s, prev[1] + e, prev[2] + t]); // several markets per symbol in the CNMS file: sum them
  }
  return out;
}
function createFinraShortVolume({ fetchImpl = fetch, logger = () => {}, maxDates = 40 } = {}) {
  const cache = new Map(); // date -> Map(symbol -> [short, exempt, total]) | null (no file)
  async function day(date) {
    if (cache.has(date)) return cache.get(date);
    const url = FINRA_BASE + 'CNMSshvol' + date.replace(/-/g, '') + '.txt';
    let map = null;
    try {
      const res = await fetchImpl(url, { headers: { accept: 'text/plain' }, signal: AbortSignal.timeout(9000) });
      if (res.ok) map = parseFinra(await res.text());
    } catch (error) { logger('warn', 'finra_shvol_failed', { date, error: String(error && error.message || error) }); }
    cache.set(date, map); if (cache.size > maxDates) cache.delete(cache.keys().next().value);
    return map;
  }
  async function forSymbol(symbol, dates) {
    const out = [];
    for (let i = 0; i < dates.length; i += 4) {
      const chunk = dates.slice(i, i + 4);
      const maps = await Promise.all(chunk.map(day));
      chunk.forEach((date, k) => { const m = maps[k]; const row = m && m.get(symbol); if (row) out.push({ date, short: row[0], exempt: row[1], offExchange: row[2], shortRatio: row[2] > 0 ? r3(row[0] / row[2]) : null }); });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return { day, forSymbol, parseFinra };
}

/* ---------- the master read ---------- */
function masterRead({ stats, candle, smc, offExchange, shortSale, sentiment, period }) {
  const f = []; // factors: { w: weight (-3..3), text, tone }
  const add = (w, text) => f.push({ w, text, tone: w > 0 ? 'up' : w < 0 ? 'down' : 'warn' });
  const s = stats;
  const up = s.changePct != null ? s.changePct > 0 : s.c > s.o;
  // the candle itself
  if (s.closeLoc >= 0.75) add(up ? 2 : 1, `Closed in the top ${Math.round((1 - s.closeLoc) * 100)}% of its range: buyers held the close.`);
  else if (s.closeLoc <= 0.25) add(up ? -1 : -2, `Closed in the bottom ${Math.round(s.closeLoc * 100)}% of its range: sellers held the close.`);
  else add(0, `Closed mid-range (${Math.round(s.closeLoc * 100)}% up from the low): neither side finished in control.`);
  if (s.upperWick >= 0.4) add(-1, `Long upper wick (${Math.round(s.upperWick * 100)}% of the range): the high was rejected.`);
  if (s.lowerWick >= 0.4) add(1, `Long lower wick (${Math.round(s.lowerWick * 100)}% of the range): the low was bought.`);
  if (s.bodyRatio >= 0.7) add(up ? 1 : -1, `Full-bodied candle (${Math.round(s.bodyRatio * 100)}% body): one-directional ${period.kind}.`);
  if (s.bodyRatio <= 0.15) add(0, `Doji-like body (${Math.round(s.bodyRatio * 100)}%): indecision at this level.`);
  // conviction
  if (s.rvol != null) { if (s.rvol >= 1.5) add(up ? 2 : -2, `Volume ${s.rvol.toFixed(2)}x the 20-session average: conviction behind the move.`); else if (s.rvol <= 0.7) add(0, `Volume only ${s.rvol.toFixed(2)}x average: a quiet ${period.kind}, easier to reverse.`); }
  if (s.rangeAtr != null) { if (s.rangeAtr >= 1.6) add(up ? 1 : -1, `Range ${s.rangeAtr.toFixed(1)}x the average true range: expansion.`); else if (s.rangeAtr <= 0.6) add(0, `Range ${s.rangeAtr.toFixed(1)}x ATR: compression, which usually precedes expansion.`); }
  if (s.gapPct != null && Math.abs(s.gapPct) >= 1) add(s.gapPct > 0 ? 1 : -1, `Gapped ${s.gapPct > 0 ? 'up' : 'down'} ${Math.abs(s.gapPct).toFixed(2)}% at the open; the gap closes at ${s.prevClose}.`);
  // context
  if (s.sma20 != null && s.sma50 != null) { const above = s.c > s.sma20 && s.sma20 > s.sma50; const below = s.c < s.sma20 && s.sma20 < s.sma50; if (above) add(1, `Trend aligned up: close above the 20-session average, 20 above the 50.`); else if (below) add(-1, `Trend aligned down: close below the 20-session average, 20 below the 50.`); else add(0, `Averages are crossed: a trend in transition.`); }
  if (s.pos52 != null) { if (s.pos52 >= 0.95) add(up ? 1 : -1, `At the top of the 52-week range (${Math.round(s.pos52 * 100)}%): breakout territory, and where profit-taking lives.`); else if (s.pos52 <= 0.05) add(up ? 1 : -1, `At the bottom of the 52-week range: capitulation territory, and where bounces start.`); }
  if (Math.abs(s.streakBefore) >= 5) add(s.streakBefore > 0 ? -1 : 1, `${Math.abs(s.streakBefore)} ${s.streakBefore > 0 ? 'up' : 'down'} sessions in a row going in: stretched.`);
  if (candle && candle.names.length) for (const n of candle.names.slice(0, 2)) add(n.dir > 0 ? 1 : n.dir < 0 ? -1 : 0, `${n.name} pattern (${Math.round(n.strength * 100)}% strength).`);
  if (s.relation === 'engulfing') add(up ? 2 : -2, `Engulfs the prior ${period.kind}: a reversal-grade candle.`);
  if (s.relation === 'inside') add(0, `Inside the prior ${period.kind}'s range: a pause; the break of this range sets direction.`);
  // smart money
  if (smc) {
    for (const e of smc.events) add(e.type === 'BOS' ? (e.dir > 0 ? 2 : -2) : (e.dir > 0 ? 1 : -1), `${e.type === 'BOS' ? 'Break of structure' : 'Change of character'} ${e.dir > 0 ? 'up' : 'down'} through ${e.level}.`);
    for (const sw of smc.sweeps) add(sw.kind === 'EQL' ? 2 : -2, `Swept the ${sw.kind === 'EQL' ? 'lows' : 'highs'} at ${sw.level} and closed back inside: liquidity taken, reversal fuel.`);
    for (const g of smc.fvgs) add(g.dir > 0 ? 1 : -1, `Left a ${g.dir > 0 ? 'bullish' : 'bearish'} imbalance ${g.bottom} to ${g.top}: a magnet if price returns.`);
    if (smc.range) add(smc.range.pos > 0.5 ? -1 : 1, `Closed in ${smc.range.pos > 0.5 ? 'PREMIUM' : 'DISCOUNT'} of the swing range (${Math.round(clamp(smc.range.pos, 0, 1) * 100)}%).`);
    if (smc.vwap) add(smc.vwap.above ? 1 : -1, `Closed ${smc.vwap.above ? 'above' : 'below'} the anchored VWAP ${smc.vwap.level}.`);
  }
  // off-exchange / short sale
  if (offExchange && offExchange.share != null) {
    if (offExchange.share >= TYPICAL_OFF_SHARE + 0.1) add(up ? 1 : -1, `${Math.round(offExchange.share * 100)}% of the volume printed off-exchange (typical ~${Math.round(TYPICAL_OFF_SHARE * 100)}%): institutions working the ${period.kind} quietly.`);
    else if (offExchange.share <= TYPICAL_OFF_SHARE - 0.12) add(0, `Only ${Math.round(offExchange.share * 100)}% off-exchange: a lit, retail-driven tape.`);
  }
  if (shortSale && shortSale.ratio != null) {
    const base = shortSale.baselineRatio;
    if (base != null && shortSale.ratio >= base + 0.08) add(up ? 2 : -1, `Short volume ${Math.round(shortSale.ratio * 100)}% of off-exchange prints vs ${Math.round(base * 100)}% normally: ${up ? 'shorts leaning into strength, squeeze fuel' : 'shorts pressing the move'}.`);
    else if (base != null && shortSale.ratio <= base - 0.08) add(up ? 1 : -1, `Short volume light (${Math.round(shortSale.ratio * 100)}% vs ${Math.round(base * 100)}% normally): ${up ? 'little short pressure against the rise' : 'the drop came from long selling, not shorts'}.`);
  }
  if (sentiment && sentiment.score != null) {
    const sc = sentiment.score;
    if (Math.abs(sc) >= 0.3) { const agrees = (sc > 0) === up; add(agrees ? (up ? 1 : -1) : 0, `Sentiment ${sc > 0 ? 'bullish' : 'bearish'} (${Math.round(sc * 100)}) ${agrees ? 'agrees with' : 'diverges from'} the candle${agrees ? '' : ': crowd and price disagree, a warning'}.`); }
    if (sentiment.crowdedLong) add(-1, `Crowded long positioning: the upside has fewer new buyers left.`);
  }
  const score = f.reduce((a, x) => a + x.w, 0), maxAbs = f.reduce((a, x) => a + Math.abs(x.w), 0) || 1;
  const bias = score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral';
  const confidence = Math.round(clamp(Math.abs(score) / maxAbs, 0, 1) * 60 + Math.min(40, f.length * 3));
  const levels = [];
  levels.push({ label: `${period.kind} high`, price: s.h, why: up ? 'acceptance above continues the move' : 'reclaiming it would negate the drop' });
  levels.push({ label: `${period.kind} low`, price: s.l, why: up ? 'losing it would negate the candle' : 'acceptance below continues the drop' });
  levels.push({ label: 'mid-range', price: r2((s.h + s.l) / 2), why: 'control line: above it buyers own the candle' });
  if (s.gapPct != null && Math.abs(s.gapPct) >= 0.5) levels.push({ label: 'gap fill', price: s.prevClose, why: 'where the gap closes' });
  if (smc && smc.fvgs[0]) levels.push({ label: 'imbalance', price: r2((smc.fvgs[0].top + smc.fvgs[0].bottom) / 2), why: 'unfilled gap in price, a magnet' });
  if (s.sma20 != null) levels.push({ label: '20-session average', price: s.sma20, why: 'trend line in the sand' });
  const headline = bias === 'bullish' ? `Buyers own this ${period.kind}` : bias === 'bearish' ? `Sellers own this ${period.kind}` : `This ${period.kind} is a coin flip`;
  const scenarios = {
    bull: `Hold above ${r2((s.h + s.l) / 2)} and take out ${s.h}: continuation toward ${r2(s.h + (s.h - s.l))} (a measured move of the ${period.kind}'s range).`,
    bear: `Lose ${s.l} with volume: the ${period.kind}'s buyers are trapped and ${r2(s.l - (s.h - s.l))} is the measured target.`
  };
  return { bias, score, confidence, headline, factors: f, levels, scenarios, note: 'Educational read of recorded data, not advice. Nothing here predicts; it describes what happened and what would change the picture.' };
}

/* ---------- service ---------- */
function createCandleRecap({ barsFor, fetchImpl = fetch, smc = null, patterns = null, shortData = null, sentiment = null, darkPoolToday = null, now = Date.now, logger = () => {}, ttlMs = 120_000 } = {}) {
  const finra = createFinraShortVolume({ fetchImpl, logger });
  const cache = new Map();
  async function recap({ symbol, tf, t, bar = null }) {
    symbol = String(symbol || '').toUpperCase(); t = Number(t);
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol) || !RECAP_TFS.includes(tf) || !Number.isFinite(t)) return { ok: false, error: 'invalid_request' };
    const period = periodOf(tf, t);
    const ck = symbol + ':' + tf + ':' + period.label;
    const hit = cache.get(ck); if (hit && hit.until > now()) return hit.payload;
    const daily = (await barsFor(symbol, '1D').catch(() => [])).filter((d) => d && Number.isFinite(d.t)).sort((a, b) => a.t - b.t);
    if (!daily.length) return { ok: false, error: 'bars_unavailable' };
    const idxs = []; daily.forEach((d, i) => { if (period.test(etParts(d.t))) idxs.push(i); });
    if (!idxs.length) return { ok: false, error: 'period_not_found', detail: 'No sessions recorded for ' + period.label + '.' };
    const idx0 = idxs[0], idx1 = idxs[idxs.length - 1];
    const stats = periodStats(daily, idx0, idx1, bar);
    const today = etDate(now()), includesToday = period.test(etParts(now())) && idxs.some((i) => etDate(daily[i].t) === today);
    // the timeframe series this candle belongs to, for the pattern and smart-money reads
    const series = tf === '1D' ? daily : (await barsFor(symbol, tf).catch(() => [])).sort((a, b) => a.t - b.t);
    let sIdx = -1; for (let i = series.length - 1; i >= 0; i--) if (period.test(etParts(series[i].t))) { sIdx = i; break; }
    const upTo = sIdx >= 0 ? series.slice(0, sIdx + 1) : [];
    let candle = null;
    if (patterns && upTo.length >= 20) {
      try { const r = patterns.detect(upTo, { maxAgeBars: 3 }); const last = upTo.length - 1; candle = { names: (r.candles || []).filter((c) => c.i === last).map((c) => ({ name: c.name, dir: c.dir, strength: c.strength, note: c.note || '' })), charts: (r.charts || []).filter((p) => p.endIdx >= last - 2).map((p) => ({ name: p.name, dir: p.dir, status: p.status, confidence: p.confidence, target: p.target })) }; }
      catch (error) { logger('warn', 'candle_recap_patterns_failed', { error: String(error && error.message || error) }); }
    }
    let smcOut = null, intraday = null;
    if (smc && upTo.length >= 20) {
      try {
        const a = smc.analyze(upTo); const last = upTo.length - 1;
        if (a) {
          smcOut = {
            events: a.structure.events.filter((e) => e.idx === last).map((e) => ({ type: e.type, dir: e.dir, level: r2(e.level) })),
            sweeps: a.liquidity.filter((l) => l.sweptAt === last).map((l) => ({ kind: l.kind, level: r2(l.level) })),
            fvgs: a.fvg.filter((g) => g.i === last || g.i === last - 1).map((g) => ({ dir: g.dir, top: r2(g.top), bottom: r2(g.bottom), filled: g.filledAt != null })),
            orderBlocks: a.structure.orderBlocks.filter((o) => o.invalidAt == null).slice(-2).map((o) => ({ dir: o.dir, top: r2(o.top), bottom: r2(o.bottom) })),
            range: a.range ? { hi: r2(a.range.hi), lo: r2(a.range.lo), pos: r3(a.range.pos) } : null,
            vwap: a.vwap[last] ? { level: r2(a.vwap[last].vwap), above: upTo[last].c >= a.vwap[last].vwap } : null,
            openLiquidity: a.liquidity.filter((l) => l.takenAt == null && l.sweptAt == null).slice(-4).map((l) => ({ kind: l.kind, level: r2(l.level), count: l.count })),
            read: smc.read(a).slice(0, 8)
          };
        }
      } catch (error) { logger('warn', 'candle_recap_smc_failed', { error: String(error && error.message || error) }); }
      if (tf === '1D') { // the day's own intraday map, when the 5-minute record still covers it
        try {
          const five = (await barsFor(symbol, '5m').catch(() => [])).filter((b) => period.test(etParts(b.t))).sort((a, b) => a.t - b.t);
          if (five.length >= 20) {
            const a = smc.analyze(five);
            const hiBar = five.reduce((x, b) => (b.h > x.h ? b : x), five[0]), loBar = five.reduce((x, b) => (b.l < x.l ? b : x), five[0]);
            const tm = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
            const firstHour = five.filter((b) => b.t < five[0].t + 3600_000).reduce((s, b) => s + (b.v || 0), 0), total = five.reduce((s, b) => s + (b.v || 0), 0);
            const lastHour = five.filter((b) => b.t >= five[five.length - 1].t - 3600_000).reduce((s, b) => s + (b.v || 0), 0);
            intraday = { bars: five.length, highAt: tm(hiBar.t), lowAt: tm(loBar.t), firstHourShare: total ? r3(firstHour / total) : null, lastHourShare: total ? r3(lastHour / total) : null, vwap: a && a.vwap[five.length - 1] ? r2(a.vwap[five.length - 1].vwap) : null, read: a ? smc.read(a).slice(0, 6) : [] };
          }
        } catch (_) { intraday = null; }
      }
    }
    // off-exchange and short volume per session (FINRA), the feed's baseline, today's live prints
    const dates = idxs.map((i) => etDate(daily[i].t));
    const finraDates = dates.slice(-MAX_FINRA_DAYS);
    let rows = [];
    try { rows = await finra.forSymbol(symbol, finraDates); } catch (_) { rows = []; }
    const volByDate = Object.fromEntries(idxs.map((i) => [etDate(daily[i].t), daily[i].v || 0]));
    const days = rows.map((r) => ({ ...r, volume: volByDate[r.date] || null, share: volByDate[r.date] ? r3(Math.min(1, r.offExchange / volByDate[r.date])) : null }));
    const offSum = days.reduce((s, d) => s + d.offExchange, 0), volSum = days.reduce((s, d) => s + (d.volume || 0), 0), shortSum = days.reduce((s, d) => s + d.short, 0);
    let baselineRatio = null, feed = null;
    if (shortData) {
      try {
        feed = await shortData(symbol);
        const hist = feed && Array.isArray(feed.volume) ? feed.volume.filter((x) => x && x.date && x.date < period.from).slice(-20) : [];
        const ratios = hist.map((x) => num(x.ratio) != null ? (num(x.ratio) > 1 ? num(x.ratio) / 100 : num(x.ratio)) : (num(x.total) > 0 ? num(x.short) / num(x.total) : null)).filter((x) => x != null);
        if (ratios.length >= 5) baselineRatio = r3(ratios.reduce((a, b) => a + b, 0) / ratios.length);
      } catch (_) { feed = null; }
    }
    if (baselineRatio == null && days.length >= 5) baselineRatio = r3(days.slice(0, Math.floor(days.length / 2)).reduce((a, d) => a + (d.shortRatio || 0), 0) / Math.floor(days.length / 2));
    const offExchange = { days, share: volSum > 0 ? r3(Math.min(1, offSum / volSum)) : null, typical: TYPICAL_OFF_SHARE, covered: days.length, of: dates.length, source: 'FINRA Reg SHO daily files (off-exchange prints)', today: null };
    if (includesToday && darkPoolToday) { try { offExchange.today = await darkPoolToday(symbol); } catch (_) { offExchange.today = null; } }
    const shortSale = { ratio: offSum > 0 ? r3(shortSum / offSum) : null, shortVolume: shortSum, baselineRatio, days: days.map((d) => ({ date: d.date, ratio: d.shortRatio })), interest: feed && feed.summary ? { avgRatio: num(feed.summary.avg_ratio), daysToCover: feed.interest && feed.interest[0] ? num(feed.interest[0].days_to_cover) : null } : null, source: 'FINRA Reg SHO daily short volume' + (feed ? ' + short-data feed' : '') };
    let sent = null;
    if (sentiment) {
      try {
        const cur = await sentiment.get(symbol);
        if (cur && cur.ok) {
          const from = Date.parse(period.from + 'T00:00:00-04:00'), to = Date.parse(period.to + 'T23:59:59-04:00');
          const pts = (cur.history || []).filter((p) => p.t >= from && p.t <= to);
          const comps = cur.components || cur.parts || null;
          sent = { score: num(cur.score), label: cur.label || null, coverage: num(cur.coverage), components: comps, crowdedLong: !!(comps && comps.options && comps.options.crowdedLong), periodAvg: pts.length ? r3(pts.reduce((a, p) => a + p.s, 0) / pts.length) : null, periodPoints: pts.length, asOf: cur.asOf, ai: cur.ai || null, note: pts.length ? 'Period average from the sentiment memory; current read as of now.' : 'Sentiment memory does not reach back to this period; the read is the current one.' };
        }
      } catch (_) { sent = null; }
    }
    const read = masterRead({ stats, candle, smc: smcOut, offExchange, shortSale, sentiment: sent, period });
    const payload = { ok: true, symbol, tf, period: { kind: period.kind, label: period.label, from: period.from, to: period.to, sessions: stats.sessions, includesToday }, stats, candle, smc: smcOut, intraday, offExchange, shortSale, sentiment: sent, read, asOf: now(), disclaimer: 'Recorded market data read for education. Not advice.' };
    cache.set(ck, { until: now() + (includesToday ? 60_000 : ttlMs * 30), payload }); if (cache.size > 200) cache.delete(cache.keys().next().value);
    return payload;
  }
  return { recap, finra };
}

module.exports = { createCandleRecap, createFinraShortVolume, parseFinra, periodOf, periodStats, masterRead, etParts, etDate, RECAP_TFS, TYPICAL_OFF_SHARE };
