'use strict';

/*
 * Reading the daily flow ledger (academy_flow_days): the week for the swing, mid-term and long-term MEM ALGO models.
 * Pure functions over the rows the ledger returns, with no requires, so the same file runs on the server and inline in the page
 * (window.SmlFlowRead). Formulas:
 *
 *   delta ratio (a day)   (buy - sell) / (buy + sell)                            -1 all selling .. +1 all buying
 *   CVD (the window)      running sum of (buy - sell) across the days
 *   large-print bias      (largeBuy - largeSell) / (largeBuy + largeSell)       prints of 1,000+ shares or $50,000+
 *   sweep / block bias    the same for intermarket sweeps and 10,000+ share prints (Massive tape)
 *   institutional share   sum(instNet) / sum(|instNet| + |retailNet|)           moomoo's order-size capital distribution
 *   pressure              the day's average full-depth pressure (-100..+100), sampled once a minute
 *   divergence            price up over the window on a negative CVD = bearish (the rise is being sold); the mirror is bullish
 *   flow score            30 tanh(2.5 avg delta ratio) + 20 large bias + 15 (sweep + block bias) / 2 + 20 institutional share
 *                         + 15 tanh(avg pressure / 40) + 10 divergence, scaled over the components that have data, -100..+100
 *
 * Educational: it describes what the tape did over those days; it does not predict the next one.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fin = Number.isFinite;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => { const n = Number(v); return fin(n) ? n : 0; };
const bias = (a, b) => (a + b > 0 ? (a - b) / (a + b) : null);

/** One ledger row -> the day's readings. */
function readDay(row) {
  const buy = num(row.buy_vol != null ? row.buy_vol : row.buy), sell = num(row.sell_vol != null ? row.sell_vol : row.sell), neu = num(row.neu_vol != null ? row.neu_vol : row.neu);
  const vol = buy + sell + neu, notional = num(row.notional);
  const lb = num(row.large_buy), ls = num(row.large_sell), sb = num(row.sweep_buy), ss = num(row.sweep_sell), bb = num(row.block_buy), bs = num(row.block_sell);
  const pn = num(row.pressure_n);
  const inst = row.inst_net == null ? null : num(row.inst_net), retail = row.retail_net == null ? null : num(row.retail_net);
  return {
    day: String(row.day instanceof Date ? row.day.toISOString().slice(0, 10) : row.day).slice(0, 10), source: row.tape_source || row.source || 'moomoo', partial: Boolean(row.partial),
    buy, sell, neu, vol, prints: num(row.prints), delta: buy - sell, deltaRatio: buy + sell > 0 ? r2((buy - sell) / (buy + sell)) : null,
    vwap: vol > 0 && notional > 0 ? r2(notional / vol) : null, hi: row.hi == null ? null : num(row.hi), lo: row.lo == null ? null : num(row.lo), last: row.last_px == null ? null : num(row.last_px != null ? row.last_px : row.last),
    large: { buy: lb, sell: ls, n: num(row.large_n), bias: bias(lb, ls) == null ? null : r2(bias(lb, ls)) },
    sweeps: { buy: sb, sell: ss, bias: bias(sb, ss) == null ? null : r2(bias(sb, ss)) },
    blocks: { buy: bb, sell: bs, bias: bias(bb, bs) == null ? null : r2(bias(bb, bs)) },
    offShare: vol > 0 ? r2(num(row.off_vol) / vol) : null,
    pressure: pn > 0 ? Math.round(num(row.pressure_sum) / pn) : null, bullMinutes: num(row.bull_minutes), bearMinutes: num(row.bear_minutes),
    events: { bull: num(row.ev_bull), bear: num(row.ev_bear) },
    instNet: inst, retailNet: retail
  };
}

/** The window: rows oldest first (the ledger gives trading days only). */
function readWindow(rows, { symbol = '' } = {}) {
  const days = (rows || []).map(readDay).filter((d) => d.vol > 0 || d.instNet != null);
  if (!days.length) return { ok: true, symbol, days: [], window: { days: 0, available: false, reason: 'no_days' } };
  let cvd = 0; for (const d of days) { cvd += d.delta; d.cvd = cvd; }
  const withRatio = days.filter((d) => d.deltaRatio != null);
  const avgRatio = withRatio.length ? withRatio.reduce((s, d) => s + d.deltaRatio, 0) / withRatio.length : null;
  const up = withRatio.filter((d) => d.deltaRatio > 0.05).length, down = withRatio.filter((d) => d.deltaRatio < -0.05).length;
  const sumBias = (pick) => { let a = 0, b = 0; for (const d of days) { const x = pick(d); a += x.buy; b += x.sell; } return bias(a, b); };
  const largeBias = sumBias((d) => d.large), sweepBias = sumBias((d) => d.sweeps), blockBias = sumBias((d) => d.blocks);
  const instDays = days.filter((d) => d.instNet != null);
  const instNet = instDays.length ? instDays.reduce((s, d) => s + d.instNet, 0) : null;
  const instGross = instDays.reduce((s, d) => s + Math.abs(d.instNet) + Math.abs(d.retailNet || 0), 0);
  const instShare = instNet != null && instGross > 0 ? r2(instNet / instGross) : null;
  const pDays = days.filter((d) => d.pressure != null);
  const pressureAvg = pDays.length ? Math.round(pDays.reduce((s, d) => s + d.pressure, 0) / pDays.length) : null;
  const first = days.find((d) => d.last != null), last = days.slice().reverse().find((d) => d.last != null);
  const priceChangePct = first && last && first !== last && first.last > 0 ? r2((last.last - first.last) / first.last * 100) : null;
  const totalVol = days.reduce((s, d) => s + d.buy + d.sell, 0);
  let divergence = null;
  if (priceChangePct != null && totalVol > 0 && Math.abs(cvd) >= 0.05 * totalVol && Math.abs(priceChangePct) >= 0.5) {
    if (priceChangePct > 0 && cvd < 0) divergence = 'bearish'; else if (priceChangePct < 0 && cvd > 0) divergence = 'bullish';
  }
  /* the score, over what has data */
  const C = [];
  const add = (key, label, max, pts, detail) => C.push({ key, label, max, pts: Math.round(clamp(pts, -max, max) * 10) / 10, detail });
  if (avgRatio != null) add('delta', 'Aggressor delta (avg of the days)', 30, 30 * Math.tanh(2.5 * avgRatio), Math.round(avgRatio * 100) + '% average delta ratio, ' + up + ' up day' + (up === 1 ? '' : 's') + ' and ' + down + ' down');
  if (largeBias != null) add('large', 'Large prints', 20, 20 * largeBias, Math.round((largeBias + 1) / 2 * 100) + '% of large-print shares were bought');
  if (sweepBias != null || blockBias != null) { const sbk = ((sweepBias || 0) + (blockBias || 0)) / ((sweepBias != null) + (blockBias != null)); add('institutionalTape', 'Sweeps and blocks', 15, 15 * sbk, (sweepBias != null ? 'sweeps ' + Math.round((sweepBias + 1) / 2 * 100) + '% bought' : '') + (blockBias != null ? (sweepBias != null ? ', ' : '') + 'blocks ' + Math.round((blockBias + 1) / 2 * 100) + '% bought' : '')); }
  if (instShare != null) add('institutional', 'Institutional net (moomoo size buckets)', 20, 20 * instShare, (instNet >= 0 ? '+' : '-') + '$' + fmtMoney(Math.abs(instNet)) + ' net over ' + instDays.length + ' day' + (instDays.length === 1 ? '' : 's'));
  if (pressureAvg != null) add('pressure', 'Book pressure (daily averages)', 15, 15 * Math.tanh(pressureAvg / 40), 'average pressure ' + (pressureAvg > 0 ? '+' : '') + pressureAvg);
  if (divergence) add('divergence', 'CVD vs price over the window', 10, divergence === 'bullish' ? 10 : -10, divergence === 'bullish' ? 'price fell while the tape net bought: the drop is being accumulated' : 'price rose while the tape net sold: the rise is being distributed');
  const max = C.reduce((s, c) => s + c.max, 0), got = C.reduce((s, c) => s + c.pts, 0);
  const score = max > 0 ? Math.round(100 * got / max) : 0;
  const label = score >= 50 ? 'strong accumulation' : score >= 25 ? 'accumulation' : score <= -50 ? 'strong distribution' : score <= -25 ? 'distribution' : 'balanced';
  const lines = [];
  lines.push('Over ' + days.length + ' trading day' + (days.length === 1 ? '' : 's') + ' the tape net ' + (cvd >= 0 ? 'bought ' : 'sold ') + fmtShares(Math.abs(cvd)) + ' shares' + (priceChangePct != null ? ' while price moved ' + (priceChangePct >= 0 ? '+' : '') + priceChangePct + '%' : '') + '.');
  if (divergence) lines.push(divergence === 'bullish' ? 'That is a bullish divergence: the drop was bought.' : 'That is a bearish divergence: the rise was sold into.');
  if (largeBias != null) lines.push('Large prints leaned ' + (largeBias > 0.15 ? 'to buying' : largeBias < -0.15 ? 'to selling' : 'neither way') + ' (' + Math.round((largeBias + 1) / 2 * 100) + '% bought).');
  if (instShare != null) lines.push('moomoo\'s size buckets show institutions net ' + (instNet >= 0 ? 'buying' : 'selling') + ' $' + fmtMoney(Math.abs(instNet)) + (days.some((d) => d.retailNet != null) ? ', retail net ' + (days.reduce((s, d) => s + (d.retailNet || 0), 0) >= 0 ? 'buying' : 'selling') : '') + '.');
  if (pressureAvg != null) lines.push('The full-depth book averaged ' + (pressureAvg > 0 ? '+' : '') + pressureAvg + ' pressure across those days.');
  return {
    ok: true, symbol, days,
    window: { available: true, days: days.length, cvd, deltaRatioAvg: avgRatio == null ? null : r2(avgRatio), up, down, largeBias: largeBias == null ? null : r2(largeBias), sweepBias: sweepBias == null ? null : r2(sweepBias), blockBias: blockBias == null ? null : r2(blockBias), instNet, instShare, pressureAvg, priceChangePct, divergence, score, label, components: C, lines, partial: Boolean(days[days.length - 1].partial) }
  };
}

function fmtMoney(v) { const a = Math.abs(v); return a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : String(Math.round(a)); }
function fmtShares(v) { return v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)); }

/**
 * What the week says about a position. mode: day / swing / mid / long / short; dir +1 long, -1 short.
 * Days of flow are the right timescale for a swing or a hold, so they may act on it: a swing exits when the week is firmly against it,
 * a mid-term hold trims, a long-term hold trims only when nearly everything lines up against it. A day trade or an intraday short reads
 * it as context only. Returns { verdict: hold | add | trim | exit | none, reasons, against, withCount, note, horizon }.
 */
function weekRead(mode, dir, summary) {
  const w = summary && summary.window;
  if (!w || !w.available || w.days < 2) return { verdict: 'none', reasons: [], against: 0, withCount: 0, note: w && w.days === 1 ? 'one day of flow is not a week yet' : 'no daily flow recorded yet', horizon: '' };
  const d = dir < 0 ? -1 : 1, side = d > 0 ? 'long' : 'short', R = [];
  const against = (t) => R.push({ tone: 'against', text: t }), withT = (t) => R.push({ tone: 'for', text: t });
  const s = w.score * d;
  if (s <= -40) against('The week is firmly against the ' + side + ': ' + w.label + ' (' + (w.score > 0 ? '+' : '') + w.score + ')');
  else if (s <= -20) against('The week leans against the ' + side + ' (' + (w.score > 0 ? '+' : '') + w.score + ')');
  else if (s >= 25) withT('The week is with the ' + side + ': ' + w.label + ' (' + (w.score > 0 ? '+' : '') + w.score + ')');
  if (w.divergence) { const bad = d > 0 ? w.divergence === 'bearish' : w.divergence === 'bullish'; (bad ? against : withT)(bad ? (d > 0 ? 'The rise is being sold into (price up, CVD down)' : 'The drop is being bought (price down, CVD up)') : (d > 0 ? 'Dips are being accumulated (price down, CVD up)' : 'Rallies are being distributed (price up, CVD down)')); }
  const total = w.up + w.down;
  if (total >= 3) { const badDays = d > 0 ? w.down : w.up, goodDays = d > 0 ? w.up : w.down; if (badDays >= Math.ceil(total * 0.6)) against(badDays + ' of ' + total + ' days net ' + (d > 0 ? 'sold' : 'bought')); else if (goodDays >= Math.ceil(total * 0.6)) withT(goodDays + ' of ' + total + ' days net ' + (d > 0 ? 'bought' : 'sold')); }
  if (w.instShare != null) { const is = w.instShare * d; if (is <= -0.25) against('Institutions net ' + (d > 0 ? 'selling' : 'buying') + ' $' + fmtMoney(Math.abs(w.instNet)) + ' (moomoo size buckets)'); else if (is >= 0.25) withT('Institutions net ' + (d > 0 ? 'buying' : 'selling') + ' $' + fmtMoney(Math.abs(w.instNet))); }
  if (w.largeBias != null) { const lb = w.largeBias * d; if (lb <= -0.3) against('Large prints are ' + (d > 0 ? 'selling' : 'buying') + ' (' + Math.round((w.largeBias + 1) / 2 * 100) + '% bought)'); else if (lb >= 0.3) withT('Large prints are ' + (d > 0 ? 'buying' : 'selling') + ' (' + Math.round((w.largeBias + 1) / 2 * 100) + '% bought)'); }
  if (w.pressureAvg != null) { const p = w.pressureAvg * d; if (p <= -30) against('The book averaged ' + (w.pressureAvg > 0 ? '+' : '') + w.pressureAvg + ' pressure, against the ' + side); else if (p >= 30) withT('The book averaged ' + (w.pressureAvg > 0 ? '+' : '') + w.pressureAvg + ' pressure, with the ' + side); }
  const n = R.filter((r) => r.tone === 'against').length, k = R.filter((r) => r.tone === 'for').length;
  const horizon = mode === 'swing' ? 'swing' : mode === 'mid' ? 'mid' : mode === 'long' ? 'long' : 'fast';
  let verdict = 'hold';
  if (horizon === 'swing') { if (n >= 3 && s <= -40) verdict = 'exit'; else if (n >= 2) verdict = 'trim'; else if (k >= 3 && n === 0) verdict = 'add'; }
  else if (horizon === 'mid') { if (n >= 3) verdict = 'trim'; else if (k >= 3 && n === 0) verdict = 'add'; }
  else if (horizon === 'long') { if (n >= 4) verdict = 'trim'; else if (k >= 4 && n === 0) verdict = 'add'; }
  const note = horizon === 'swing' ? 'Days of flow are a swing trade\'s own timescale: a week firmly against it closes it, two things against it take some off.'
    : horizon === 'mid' ? 'A mid-term hold trims when three things in the week line up against it; it adds when the week is clearly with it.'
      : horizon === 'long' ? 'A long-term hold reads one week as one week: it trims only when nearly everything is against it, and never exits on it.'
        : 'For a day trade or an intraday short the week is context, not a trigger: it says which way the easier move has been.';
  return { verdict, reasons: R, against: n, withCount: k, note, horizon, days: w.days, partial: Boolean(w.partial) };
}

module.exports = { readDay, readWindow, weekRead, fmtMoney, fmtShares };
