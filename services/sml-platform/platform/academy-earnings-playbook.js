'use strict';

/* Earnings playbook: the best upcoming reports and, for each, what the options market is pricing versus what the stock
 * has actually done on past reports, MEM ALGO's read into the print, and concrete stock and options plays with the
 * hedge for each. Data already on the platform: the moomoo earnings calendar (through the site bridge), the options
 * chain, daily candles, the per-symbol earnings history, and the Hedge & Income planner.
 *
 * Nothing here predicts a beat or a miss. It measures the price of the move, the size of past moves, and the trend
 * going in, then lays out the standard structures for each case with their risk spelled out. Educational only. */

const algo = require('./academy-mem-algo');

const DAY = 86_400_000;
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ history: past report dates and the stock's reaction */
const DATE_KEYS = ['date', 'reportDate', 'report_date', 'earningsDate', 'earnings_date', 'fiscalDateEnding'];
const ACTUAL_KEYS = ['epsActual', 'eps_actual', 'actualEPS', 'actual', 'reportedEPS'];
function pastReportDates(payload, now = Date.now()) {
  const out = new Set();
  const walk = (node, depth) => {
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) { node.slice(0, 200).forEach((x) => walk(x, depth + 1)); return; }
    if (typeof node !== 'object') return;
    const dk = DATE_KEYS.find((k) => typeof node[k] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(node[k]));
    if (dk && dk !== 'fiscalDateEnding') {
      const d = node[dk].slice(0, 10), reported = ACTUAL_KEYS.some((k) => node[k] != null && node[k] !== '');
      if (reported || Date.parse(d + 'T00:00:00Z') < now - DAY) out.add(d);
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  walk(payload, 0);
  return [...out].sort().reverse();
}

/* the close-to-close move across each past report (AMC: the next session; BMO or unknown: that session) */
function reactionHistory(bars, dates, timing = 'UNSPECIFIED', max = 8) {
  const list = Array.isArray(bars) ? bars : [];
  if (list.length < 5) return { n: 0, moves: [] };
  const moves = [];
  for (const d of dates) {
    const t = Date.parse(d + 'T00:00:00Z'); if (!Number.isFinite(t)) continue;
    let j = list.findIndex((b) => b.t >= t); if (j < 1) continue;
    if (timing === 'AMC') j += 1;
    if (j >= list.length) continue;
    const prev = num(list[j - 1].c), next = num(list[j].c), gapOpen = num(list[j].o);
    if (!(prev > 0) || !(next > 0)) continue;
    moves.push({ date: d, movePct: r2((next / prev - 1) * 100), gapPct: gapOpen > 0 ? r2((gapOpen / prev - 1) * 100) : null });
    if (moves.length >= max) break;
  }
  const abs = moves.map((m) => Math.abs(m.movePct));
  const avg = abs.length ? abs.reduce((a, b) => a + b, 0) / abs.length : null;
  return { n: moves.length, moves, avgAbsPct: r2(avg), maxAbsPct: abs.length ? r2(Math.max(...abs)) : null, up: moves.filter((m) => m.movePct > 0).length, down: moves.filter((m) => m.movePct < 0).length };
}

/* ------------------------------------------------------------------ chain: the expiry that covers the report and the ATM straddle */
function expiryOf(r) { return String(r.expiry || r.expiration || '').slice(0, 10); }
function mid(leg) { const b = num(leg && leg.bid), a = num(leg && leg.ask); if (b != null && a != null && a >= b && a > 0) return (a + b) / 2; const l = num(leg && leg.last); return l > 0 ? l : null; }
function coveringExpiry(rows, eventDate, timing) {
  const need = Date.parse(eventDate + 'T00:00:00Z') + (timing === 'AMC' ? DAY : 0);
  const exps = [...new Set(rows.map(expiryOf).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)))].sort();
  return exps.find((e) => Date.parse(e + 'T00:00:00Z') >= need) || null;
}
function impliedMove(rows, price, eventDate, timing) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length || !(price > 0)) return null;
  const exp = coveringExpiry(list, eventDate, timing); if (!exp) return null;
  const at = list.filter((r) => expiryOf(r) === exp && num(r.strike) > 0 && r.call && r.put);
  if (!at.length) return null;
  const atm = at.reduce((m, r) => (Math.abs(num(r.strike) - price) < Math.abs(num(m.strike) - price) ? r : m));
  const c = mid(atm.call), p = mid(atm.put); if (c == null || p == null) return null;
  const straddle = c + p, dte = Math.max(1, Math.round((Date.parse(exp + 'T00:00:00Z') - Date.now()) / DAY));
  // the straddle prices the whole life of the contract; the event's share of it is what is left after ordinary daily drift
  const ivAtm = num(atm.call.iv) || num(atm.put.iv) || null;
  const evPct = (straddle / price) * 100;
  return { expiry: exp, dte, strike: num(atm.strike), straddle: r2(straddle), straddlePct: r2(evPct), impliedPct: r2(evPct * 0.85), ivAtm: ivAtm != null ? r2(ivAtm > 3 ? ivAtm : ivAtm * 100) : null, callOi: num(atm.call.oi ?? atm.call.open_interest, 0), putOi: num(atm.put.oi ?? atm.put.open_interest, 0) };
}
function strikeNear(rows, exp, level, type) {
  const at = rows.filter((r) => expiryOf(r) === exp && num(r.strike) > 0 && r[type]);
  if (!at.length) return null;
  const r = at.reduce((m, x) => (Math.abs(num(x.strike) - level) < Math.abs(num(m.strike) - level) ? x : m));
  return { strike: num(r.strike), mid: mid(r[type]), oi: num(r[type].oi ?? r[type].open_interest, 0), iv: num(r[type].iv) };
}

/* ------------------------------------------------------------------ the plays */
function strategiesFor({ price, implied, hist, mem, rows, atr, timing, date, sentimentScore = null }) {
  const out = [];
  const m = implied && implied.impliedPct != null ? implied.impliedPct / 100 : null, h = hist && hist.avgAbsPct != null ? hist.avgAbsPct / 100 : null;
  const exp = implied ? implied.expiry : null;
  const bias = mem ? mem.bias : 'warming', grade = mem && mem.latest && mem.latest.conf ? mem.latest.conf.grade : null;
  const up = bias === 'long', down = bias === 'short';
  const lean = sentimentScore == null ? 0 : sentimentScore;
  const ratio = m && h ? m / h : null;
  const legs = (specs) => specs.map((s) => { const k = strikeNear(rows, exp, s.level, s.type); return k ? { action: s.action, type: s.type, strike: k.strike, mid: r2(k.mid), oi: k.oi, expiry: exp } : null; }).filter(Boolean);
  const cost = (L) => L.reduce((a, l) => a + (l.mid == null ? 0 : (l.action === 'buy' ? 1 : -1) * l.mid), 0);

  if (ratio != null && ratio >= 1.2 && exp) {
    const L = legs([{ action: 'sell', type: 'call', level: price * (1 + m) }, { action: 'buy', type: 'call', level: price * (1 + 1.6 * m) }, { action: 'sell', type: 'put', level: price * (1 - m) }, { action: 'buy', type: 'put', level: price * (1 - 1.6 * m) }]);
    if (L.length === 4) {
      const credit = -cost(L), width = Math.max(L[1].strike - L[0].strike, L[2].strike - L[3].strike);
      out.push({ key: 'iron_condor', style: 'options', stance: 'neutral', name: 'Iron condor outside the priced move',
        why: `The market is pricing about ${r1(m * 100)}% but this stock has averaged ${r1(h * 100)}% on its last ${hist.n} reports: the premium is rich. Sell the move, buy the wings for defined risk.`,
        legs: L, credit: r2(credit), maxGain: r2(credit), maxLoss: r2(width - credit), breakevens: [r2(L[2].strike - credit), r2(L[0].strike + credit)],
        hedge: 'The long wings are the hedge: the most this can lose is the width minus the credit, known before the print. Size so that loss is one you accept.',
        risks: ['One report can be the outlier: the max loss is real.', 'Implied volatility collapses after the print, which helps this trade; a gap beyond a short strike does not.'] });
    }
  }
  if (ratio != null && ratio <= 0.8 && exp) {
    const L = legs([{ action: 'buy', type: 'call', level: price }, { action: 'buy', type: 'put', level: price }]);
    if (L.length === 2) {
      const debit = cost(L);
      out.push({ key: 'long_straddle', style: 'options', stance: 'neutral', name: 'Long straddle: buy the move',
        why: `The market is pricing about ${r1(m * 100)}% but this stock has averaged ${r1(h * 100)}% on past reports: the move is cheap relative to history.`,
        legs: L, debit: r2(debit), maxLoss: r2(debit), maxGain: null, breakevens: [r2(price - debit), r2(price + debit)],
        hedge: 'Defined risk: the debit is the most this can lose. Take half off on the first move; the rest decays fast once volatility drops.',
        risks: ['Implied volatility collapses after the print, so a move smaller than the straddle still loses.', 'Both legs decay every day you hold before the report.'] });
    }
  }
  if ((up || down) && exp && m) {
    const d = up ? 1 : -1, type = up ? 'call' : 'put';
    const L = legs([{ action: 'buy', type, level: price }, { action: 'sell', type, level: price * (1 + d * m) }]);
    if (L.length === 2) {
      const debit = cost(L), width = Math.abs(L[1].strike - L[0].strike);
      out.push({ key: up ? 'call_spread' : 'put_spread', style: 'options', stance: up ? 'bullish' : 'bearish', name: (up ? 'Call' : 'Put') + ' debit spread to the priced move',
        why: `MEM ALGO reads ${bias}${grade ? ' (grade ' + grade + ')' : ''} going in${lean ? (lean * d > 0 ? ' and sentiment agrees' : ' but sentiment disagrees') : ''}. The short strike at the priced move pays for part of the long one and caps the cost of being wrong.`,
        legs: L, debit: r2(debit), maxLoss: r2(debit), maxGain: r2(width - debit), breakevens: [r2(L[0].strike + d * debit)],
        hedge: 'The sold leg is the hedge against volatility collapse; the debit is the full risk. Do not add the opposite spread "to hedge" — that just rebuilds a condor at worse prices.',
        risks: ['A beat can still sell off and a miss can rally: the direction read is the trend into the print, not the result.', lean * d < 0 ? 'Sentiment leans the other way: size smaller.' : 'Capped upside beyond the short strike.'] });
    }
  }
  if (m && exp) {
    const L = legs([{ action: 'buy', type: 'put', level: price * (1 - m) }, { action: 'sell', type: 'call', level: price * (1 + m) }]);
    if (L.length === 2) {
      const net = cost(L);
      out.push({ key: 'collar', style: 'stock', stance: 'hold', name: 'Hold the shares through the print with a collar',
        why: 'For a position you already own: the put is the floor at the priced move, the sold call pays for it and sets the cap. Near-zero cost, no gap risk below the floor.',
        legs: L, debit: r2(net), floor: L[0].strike, cap: L[1].strike, maxLossPct: r2((price - L[0].strike) / price * 100 + Math.max(0, net) / price * 100),
        hedge: 'This is the hedge. Per 100 shares: one put, one call.',
        risks: ['Upside above the call strike is given away.', 'Assignment on the call if the stock gaps well above it.'] });
    }
  }
  const atrPct = atr > 0 ? atr / price : 0.025;
  out.push({ key: 'post_drift', style: 'stock', stance: 'either', name: 'Post-earnings drift: trade the reaction, not the guess',
    why: `Wait for the print. If the stock gaps more than half the priced move (about ${r1((m || h || 0.05) * 50)}%) on at least twice its normal volume and holds the first 30 minutes, enter in the gap direction.`,
    plan: { entry: 'first 30-minute high (long) or low (short) after the open', stop: 'the pre-report close: a full gap fill says the reaction failed', target: `about ${r1(atrPct * 300)}% (3 ATR) or the next MEM ALGO exit`, hold: '3-10 sessions' },
    hedge: 'The stop is the hedge; if you want a floor instead, buy a put one ATR below entry for the hold period.',
    risks: ['Fades on day two are common when the gap is on light volume.', 'No position before the print means no event risk, and no event reward.'] });
  if (up && mem && mem.latest && mem.latest.dir > 0) {
    out.push({ key: 'pre_runup', style: 'stock', stance: 'bullish', name: 'Pre-earnings run-up, flat before the print',
      why: `The trend is up and MEM ALGO's last signal was a BUY${grade ? ' (grade ' + grade + ')' : ''}. Stocks in uptrends often drift higher into a report; the play is to be out before it.`,
      plan: { entry: 'now, or the next pullback to the fast EMA', stop: `${r1(atrPct * 150)}% (1.5 ATR) below entry`, exit: `the close before the report (${date}${timing === 'BMO' ? ', so the session before' : ''})`, hold: 'until the day before' },
      hedge: 'Flat before the print is the hedge. If you keep a piece through it, collar that piece (above).',
      risks: ['Pre-announcements and peer reports can move it early.', 'Short hold: costs and slippage matter.'] });
  }
  return out;
}

function setupScore(e) {
  let s = 0;
  const ov = num(e.optionVolume, 0), mc = num(e.marketCap, 0);
  s += clamp(Math.log10(1 + ov) * 5, 0, 25);
  s += clamp(Math.log10(1 + mc / 1e9) * 7, 0, 15);
  if (e.implied && e.implied.impliedPct != null) s += 10;
  if (e.history && e.history.n >= 4) s += 10;
  if (e.edge != null) s += clamp(Math.abs(e.edge - 1) * 40, 0, 20);
  if (e.mem && (e.mem.bias === 'long' || e.mem.bias === 'short')) s += 10;
  if (e.ivRank != null) s += 5;
  if (e.strategies && e.strategies.length >= 3) s += 5;
  return Math.round(clamp(s, 0, 100));
}

function createEarningsPlaybook({ calendar, history, chain, candles, hedge = null, sentiment = null, now = Date.now, listTtlMs = 15 * 60_000, detailTtlMs = 10 * 60_000, concurrency = 3, perSymbolMs = 15_000, logger = () => {} } = {}) {
  const cache = new Map(), inflight = new Map();
  const safe = async (name, fn, ms = perSymbolMs) => { try { return await Promise.race([fn(), new Promise((r) => { const t = setTimeout(() => r(null), ms); if (t.unref) t.unref(); })]); } catch (error) { logger('warn', 'earnings_playbook_input_failed', { input: name, error: String(error && error.message || error) }); return null; } };
  const memo = (key, ttl, fn) => {
    const hit = cache.get(key); if (hit && hit.until > now()) return Promise.resolve(hit.value);
    if (inflight.has(key)) return inflight.get(key);
    const p = fn().then((v) => { cache.set(key, { until: now() + ttl, value: v }); if (cache.size > 400) cache.delete(cache.keys().next().value); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  };

  async function enrich(ev) {
    const symbol = ev.symbol, t = now();
    const [daily, rows, hist, sent] = await Promise.all([
      safe('candles', () => candles(symbol, '1D')), safe('chain', () => chain(symbol)), safe('history', () => (history ? history(symbol) : null)),
      sentiment ? safe('sentiment', () => sentiment(symbol), 6_000) : null
    ]);
    const bars = daily && Array.isArray(daily.bars) ? daily.bars : Array.isArray(daily) ? daily : [];
    const price = bars.length ? num(bars[bars.length - 1].c) : num(ev.price);
    if (!(price > 0)) return { ...ev, available: false, reason: 'no_price' };
    const chainRows = Array.isArray(rows) ? rows : [];
    const implied = impliedMove(chainRows, price, ev.date, ev.timing);
    const reaction = reactionHistory(bars, pastReportDates(hist, t), ev.timing);
    const atrArr = bars.length > 20 ? algo.atr(bars, 14) : [], atr = atrArr.length ? num(atrArr[atrArr.length - 1]) : null;
    let mem = null; try { if (bars.length > 220) { const a = algo.analyze(bars, 'swing', {}, '1D', {}); mem = { bias: a.bias, latest: a.latest ? { dir: a.latest.dir, t: a.latest.t, conf: a.latest.conf ? { score: a.latest.conf.score, grade: a.latest.conf.grade } : null } : null, winRate: a.stats.winRate, expectancyR: a.stats.expectancyR }; } } catch (_) { mem = null; }
    const sentimentScore = sent && sent.ok && sent.available ? num(sent.score) : null;
    const adv = bars.slice(-20).reduce((a, b) => a + num(b.v, 0), 0) / Math.max(1, Math.min(20, bars.length));
    const e = { ...ev, available: true, price: r2(price), atr: r2(atr), adv: Math.round(adv), implied, history: reaction, mem, sentiment: sentimentScore,
      edge: implied && implied.impliedPct > 0 && reaction.avgAbsPct != null && reaction.n >= 2 ? r2(reaction.avgAbsPct / implied.impliedPct) : null };
    e.read = e.edge == null ? 'not enough data to compare the priced move with history' : e.edge >= 1.25 ? 'the move is cheap versus history' : e.edge <= 0.8 ? 'the move is expensive versus history' : 'the move is priced about in line with history';
    e.strategies = strategiesFor({ price, implied, hist: reaction, mem, rows: chainRows, atr, timing: ev.timing, date: ev.date, sentimentScore });
    e.score = setupScore(e);
    if (hedge && typeof hedge.plan === 'function') {
      const dir = mem && mem.latest ? mem.latest.dir : 0;
      const plan = await safe('hedge', () => hedge.plan({ symbol, horizon: 'swing', side: dir < 0 ? 'short' : 'long', dir, strength: mem && mem.latest && mem.latest.conf ? mem.latest.conf.score : null, noAlerts: true }), 10_000);
      if (plan && plan.ok && Array.isArray(plan.ideas) && plan.ideas.length) e.hedgeIdeas = plan.ideas.slice(0, 2);
    }
    return e;
  }

  async function calendarWindow(days) {
    const t = now(), start = iso(t), end = iso(t + days * DAY);
    const months = [...new Set([start.slice(0, 7), end.slice(0, 7)])];
    const got = await Promise.all(months.map((m) => safe('calendar:' + m, () => calendar(m), 20_000)));
    const events = [];
    for (const g of got) for (const ev of (g && Array.isArray(g.events) ? g.events : [])) {
      if (!ev || !ev.symbol || !/^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || ''))) continue;
      if (ev.date < start || ev.date > end || ev.status === 'reported') continue;
      events.push({ symbol: String(ev.symbol).toUpperCase(), name: ev.name || ev.symbol, date: ev.date, timing: ev.timing || 'UNSPECIFIED', period: ev.period || '', epsEstimate: num(ev.eps_estimate), revenueEstimate: num(ev.revenue_estimate), ivRank: num(ev.iv_rank ?? ev.iv_percentile), optionVolume: num(ev.option_volume), marketCap: num(ev.market_cap), price: num(ev.price) });
    }
    return { start, end, events, months: got.filter(Boolean).length };
  }

  async function list({ days = 14, limit = 10 } = {}) {
    const d = clamp(Math.round(num(days, 14)), 1, 45), n = clamp(Math.round(num(limit, 10)), 1, 25);
    return memo(`list:${d}:${n}`, listTtlMs, async () => {
      const win = await calendarWindow(d);
      if (!win.months) return { ok: true, available: false, reason: 'calendar_unavailable', asOf: now() };
      // the names worth a member's attention first: real option volume, real size
      const ranked = win.events.filter((e) => e.optionVolume > 0 || e.marketCap > 2e9).sort((a, b) => (num(b.optionVolume, 0) - num(a.optionVolume, 0)) || (num(b.marketCap, 0) - num(a.marketCap, 0))).slice(0, n);
      const out = []; let i = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, ranked.length) }, async () => { while (i < ranked.length) { const ev = ranked[i++]; out.push(await enrich(ev)); } }));
      const events = out.filter((e) => e.available).sort((a, b) => b.score - a.score);
      return { ok: true, available: true, asOf: now(), window: { start: win.start, end: win.end, days: d }, considered: win.events.length, events,
        note: 'Priced move = ATM straddle at the expiry that covers the report (about 85% of it is the event). History = close-to-close moves on past reports. Educational context, not a trade signal.' };
    });
  }

  async function detail(symbol) {
    const sym = String(symbol || '').toUpperCase();
    return memo('detail:' + sym, detailTtlMs, async () => {
      const win = await calendarWindow(45);
      let ev = win.events.find((e) => e.symbol === sym);
      if (!ev) {
        // not on the calendar window: fall back to the symbol's own history for the next date
        const hist = await safe('history', () => (history ? history(sym) : null));
        const { extractNextEarnings } = require('./academy-earnings-date');
        const next = extractNextEarnings(hist, now());
        if (!next) return { ok: true, available: false, reason: 'no_upcoming_report', symbol: sym, asOf: now() };
        ev = { symbol: sym, name: sym, date: next.date, timing: 'UNSPECIFIED', period: '' };
      }
      const e = await enrich(ev);
      return { ok: true, asOf: now(), ...e, note: 'Priced move = ATM straddle at the expiry that covers the report. Educational context, not a trade signal.' };
    });
  }

  return { list, detail };
}

module.exports = { createEarningsPlaybook, impliedMove, reactionHistory, pastReportDates, strategiesFor, setupScore, coveringExpiry };
