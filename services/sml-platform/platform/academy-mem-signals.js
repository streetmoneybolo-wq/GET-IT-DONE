'use strict';

/* The signal library behind MEM LAB: well-known trading models, each reduced to one number per candle between -1 (clearly bearish) and +1 (clearly bullish).
 *
 * Every component is CAUSAL: its value at candle i uses only candles 0..i, never anything later. The test suite proves it for each one (the value at candle k computed on
 * the whole series equals the value computed on the series cut at k), because a backtest that peeks forward looks brilliant and is worthless.
 *
 * Components: Supertrend, ADX / directional movement, MACD histogram, RSI regime, Bollinger squeeze breakout, Donchian channel breakout (the Turtle rule),
 * Ichimoku cloud, a Kalman-filter trend slope, an efficiency-weighted trend-quality read, On-Balance Volume trend, a mean-reversion z-score, and Kaufman's efficiency ratio.
 * MEM LAB measures what each one adds to the MEM ALGO crossover and keeps only what survives out-of-sample testing (academy-mem-lab.js).
 * Educational: nothing here places a trade. */

const algo = require('./academy-mem-algo');

const fin = Number.isFinite;
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

const closeOf = (bars) => bars.map((b) => b.c);
const sumWindow = (arr, i, n) => { let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j]; return s; };

/* ---------- Supertrend: an ATR band that flips side when price closes through it ---------- */
function supertrend(bars, { period = 10, mult = 3 } = {}) {
  const n = bars.length, a = algo.atr(bars, period), out = new Array(n).fill(0);
  let fu = NaN, fl = NaN, dir = 0;
  for (let i = 0; i < n; i++) {
    if (!(a[i] > 0)) continue;
    const hl2 = (bars[i].h + bars[i].l) / 2, bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
    const pc = i > 0 ? bars[i - 1].c : bars[i].c;
    fu = !fin(fu) || bu < fu || pc > fu ? bu : fu;
    fl = !fin(fl) || bl > fl || pc < fl ? bl : fl;
    if (dir === 0) dir = bars[i].c >= hl2 ? 1 : -1;
    else if (dir === 1 && bars[i].c < fl) dir = -1;
    else if (dir === -1 && bars[i].c > fu) dir = 1;
    out[i] = dir;
  }
  return out;
}

/* ---------- ADX with +DI / -DI (Wilder): direction from the DI lines, conviction from how strong the trend is ---------- */
function adx(bars, { period = 14 } = {}) {
  const n = bars.length, out = new Array(n).fill(0), adxv = new Array(n).fill(NaN);
  if (n < period * 2 + 2) return { votes: out, adx: adxv };
  let tr = 0, pdm = 0, ndm = 0, dxAcc = 0, dxCount = 0, adxPrev = NaN;
  for (let i = 1; i < n; i++) {
    const up = bars[i].h - bars[i - 1].h, dn = bars[i - 1].l - bars[i].l;
    const t = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
    const p = up > dn && up > 0 ? up : 0, m = dn > up && dn > 0 ? dn : 0;
    if (i <= period) { tr += t; pdm += p; ndm += m; if (i < period) continue; }
    else { tr = tr - tr / period + t; pdm = pdm - pdm / period + p; ndm = ndm - ndm / period + m; }
    const pdi = tr > 0 ? 100 * pdm / tr : 0, ndi = tr > 0 ? 100 * ndm / tr : 0, dx = pdi + ndi > 0 ? 100 * Math.abs(pdi - ndi) / (pdi + ndi) : 0;
    if (dxCount < period) { dxAcc += dx; dxCount++; if (dxCount === period) adxPrev = dxAcc / period; }
    else adxPrev = (adxPrev * (period - 1) + dx) / period;
    if (fin(adxPrev)) { adxv[i] = adxPrev; out[i] = sign(pdi - ndi) * clamp((adxPrev - 15) / 25, 0, 1); }
  }
  return { votes: out, adx: adxv };
}

/* ---------- MACD line and histogram, scaled by volatility so they compare across stocks ---------- */
function macd(bars, { fast = 12, slow = 26, signal = 9 } = {}) {
  const c = closeOf(bars), f = algo.ema(c, fast), s = algo.ema(c, slow), line = c.map((_, i) => f[i] - s[i]), sig = algo.ema(line, signal), a = algo.atr(bars, 14);
  // the line says where momentum stands, the histogram says whether it is building: both count
  return c.map((_, i) => (i < slow + signal || !(a[i] > 0) ? 0 : clamp(0.5 * Math.tanh(line[i] / (0.5 * a[i])) + 0.5 * Math.tanh((line[i] - sig[i]) / (0.25 * a[i])))));
}

/* ---------- RSI regime: above 55 is a bullish regime, below 45 bearish; an exhausted reading (over 78 or under 22) is not trusted ---------- */
function rsiRegime(bars, { period = 14 } = {}) {
  const r = algo.rsi(closeOf(bars), period);
  return r.map((v, i) => {
    if (i < period * 2 || !fin(v)) return 0;
    if (v > 78 || v < 22) return 0;
    return clamp((v - 50) / 20);
  });
}

/* ---------- Bollinger squeeze: a breakout from an unusually tight band counts; otherwise only a gentle lean to the side of the middle line ---------- */
function bbSqueeze(bars, { period = 20, k = 2, look = 100 } = {}) {
  const n = bars.length, c = closeOf(bars), out = new Array(n).fill(0), bw = new Array(n).fill(NaN), mid = new Array(n).fill(NaN), up = new Array(n).fill(NaN), lo = new Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    const m = sumWindow(c, i, period) / period; let v = 0; for (let j = i - period + 1; j <= i; j++) v += (c[j] - m) ** 2;
    const sd = Math.sqrt(v / period); mid[i] = m; up[i] = m + k * sd; lo[i] = m - k * sd; bw[i] = m > 0 ? (2 * k * sd) / m : NaN;
  }
  for (let i = period + look; i < n; i++) {
    if (!fin(bw[i])) continue;
    let rank = 0, cnt = 0; for (let j = i - look; j < i; j++) if (fin(bw[j])) { cnt++; if (bw[j] < bw[i]) rank++; }
    const tight = cnt ? rank / cnt : 1;
    const recentTight = Math.min(...bw.slice(i - 5, i).filter(fin)) ;
    let rankPrev = 0, cntPrev = 0; for (let j = i - look; j < i; j++) if (fin(bw[j])) { cntPrev++; if (bw[j] < recentTight) rankPrev++; }
    const wasSqueezed = cntPrev ? rankPrev / cntPrev < 0.2 : false;
    if (wasSqueezed && c[i] > up[i]) out[i] = 1;
    else if (wasSqueezed && c[i] < lo[i]) out[i] = -1;
    else out[i] = clamp(0.3 * sign(c[i] - mid[i]) * (1 - tight * 0.5));
  }
  return out;
}

/* ---------- Donchian channel (Turtle): a close above the prior N-bar high is bullish, below the prior low bearish, otherwise where price sits in the channel ---------- */
function donchian(bars, { period = 20 } = {}) {
  const n = bars.length, out = new Array(n).fill(0);
  for (let i = period; i < n; i++) {
    let hi = -Infinity, lo = Infinity; for (let j = i - period; j < i; j++) { if (bars[j].h > hi) hi = bars[j].h; if (bars[j].l < lo) lo = bars[j].l; }
    if (bars[i].c > hi) out[i] = 1; else if (bars[i].c < lo) out[i] = -1; else if (hi > lo) out[i] = clamp(((bars[i].c - lo) / (hi - lo) - 0.5), -0.5, 0.5);
  }
  return out;
}

/* ---------- Ichimoku: price against the cloud (the spans as they stood 26 candles ago), with the tenkan / kijun cross ---------- */
function ichimoku(bars, { tenkan = 9, kijun = 26, senkouB = 52, shift = 26 } = {}) {
  const n = bars.length, out = new Array(n).fill(0);
  const mid = (i, len) => { let hi = -Infinity, lo = Infinity; for (let j = i - len + 1; j <= i; j++) { if (bars[j].h > hi) hi = bars[j].h; if (bars[j].l < lo) lo = bars[j].l; } return (hi + lo) / 2; };
  const t = new Array(n).fill(NaN), k = new Array(n).fill(NaN), sa = new Array(n).fill(NaN), sb = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (i >= tenkan - 1) t[i] = mid(i, tenkan);
    if (i >= kijun - 1) k[i] = mid(i, kijun);
    if (fin(t[i]) && fin(k[i])) sa[i] = (t[i] + k[i]) / 2;
    if (i >= senkouB - 1) sb[i] = mid(i, senkouB);
  }
  for (let i = senkouB + shift; i < n; i++) {
    const a = sa[i - shift], b = sb[i - shift]; if (!fin(a) || !fin(b) || !fin(t[i]) || !fin(k[i])) continue;
    const top = Math.max(a, b), bot = Math.min(a, b), c = bars[i].c;
    const cross = sign(t[i] - k[i]);
    if (c > top) out[i] = cross > 0 ? 1 : 0.5; else if (c < bot) out[i] = cross < 0 ? -1 : -0.5; else out[i] = 0.15 * cross;
  }
  return out;
}

/* ---------- Kalman filter (local linear trend): the filtered slope of price in ATRs per candle, a smoother trend read than any moving average ---------- */
function kalman(bars, { q = 0.0005, r = 0.25 } = {}) {
  const n = bars.length, a = algo.atr(bars, 14), out = new Array(n).fill(0);
  let level = NaN, slope = 0, p00 = 1, p01 = 0, p11 = 1;
  for (let i = 0; i < n; i++) {
    const z = bars[i].c;
    if (!fin(level)) { level = z; continue; }
    // predict
    const lp = level + slope, sp = slope;
    const P00 = p00 + 2 * p01 + p11 + q, P01 = p01 + p11, P11 = p11 + q;
    // update with the observation z (observation noise r, in price units scaled by the price)
    const R = r * (z * 0.01) ** 2 + 1e-12, S = P00 + R, K0 = P00 / S, K1 = P01 / S, innov = z - lp;
    level = lp + K0 * innov; slope = sp + K1 * innov;
    p00 = (1 - K0) * P00; p01 = (1 - K0) * P01; p11 = P11 - K1 * P01;
    if (i >= 30 && a[i] > 0) out[i] = clamp(Math.tanh(slope / (0.12 * a[i])));
  }
  return out;
}

/* ---------- trend quality: the direction of the last 20 candles, trusted in proportion to how clean the move was (Kaufman's efficiency ratio: 1 is a straight line, 0 is noise) ---------- */
function trendQuality(bars, { period = 20 } = {}) {
  const n = bars.length, out = new Array(n).fill(0), er = efficiency(bars, { period });
  for (let i = period; i < n; i++) if (fin(er[i])) out[i] = sign(bars[i].c - bars[i - period].c) * clamp((er[i] - 0.15) / 0.4, 0, 1);
  return out;
}

/* ---------- On-Balance Volume: money flowing in (OBV above its own average) agrees with an up move ---------- */
function obv(bars, { period = 20 } = {}) {
  const n = bars.length, o = new Array(n).fill(0);
  for (let i = 1; i < n; i++) o[i] = o[i - 1] + (bars[i].c > bars[i - 1].c ? bars[i].v : bars[i].c < bars[i - 1].c ? -bars[i].v : 0);
  const avg = algo.ema(o, period), a = algo.sma(bars.map((b) => b.v), 50);
  return o.map((v, i) => (i < period * 2 || !(a[i] > 0) ? 0 : clamp(Math.tanh((v - avg[i]) / (4 * a[i])))));
}

/* ---------- mean-reversion z-score: a stretched price in a non-trending market leans back toward its average (so the vote is AGAINST the stretch) ---------- */
function zscore(bars, { period = 20, stretch = 1.5 } = {}) {
  const n = bars.length, c = closeOf(bars), out = new Array(n).fill(0), er = efficiency(bars, { period });
  for (let i = period + 1; i < n; i++) {
    const m = sumWindow(c, i, period) / period; let v = 0; for (let j = i - period + 1; j <= i; j++) v += (c[j] - m) ** 2;
    // a quiet, choppy market: the 20 candles BEFORE this one did not trend (efficiency under 0.5)
    const sd = Math.sqrt(v / period); if (!(sd > 0) || !fin(er[i - 1]) || er[i - 1] >= 0.5) continue;
    const z = (c[i] - m) / sd; if (Math.abs(z) >= stretch) out[i] = clamp(-z / 3);
  }
  return out;
}

/* ---------- Kaufman efficiency ratio: not a direction but a QUALITY read: 1 is a clean trend, 0 is noise. Returned as a number between 0 and 1. ---------- */
function efficiency(bars, { period = 20 } = {}) {
  const n = bars.length, out = new Array(n).fill(NaN);
  for (let i = period; i < n; i++) { let path = 0; for (let j = i - period + 1; j <= i; j++) path += Math.abs(bars[j].c - bars[j - 1].c); out[i] = path > 0 ? Math.abs(bars[i].c - bars[i - period].c) / path : 0; }
  return out;
}

const COMPONENTS = {
  supertrend: { label: 'Supertrend', family: 'trend', run: (b, p) => supertrend(b, p) },
  adx: { label: 'ADX / directional movement', family: 'trend', run: (b, p) => adx(b, p).votes },
  macd: { label: 'MACD histogram', family: 'momentum', run: (b, p) => macd(b, p) },
  rsi: { label: 'RSI regime', family: 'momentum', run: (b, p) => rsiRegime(b, p) },
  squeeze: { label: 'Bollinger squeeze breakout', family: 'volatility', run: (b, p) => bbSqueeze(b, p) },
  donchian: { label: 'Donchian breakout', family: 'breakout', run: (b, p) => donchian(b, p) },
  ichimoku: { label: 'Ichimoku cloud', family: 'trend', run: (b, p) => ichimoku(b, p) },
  kalman: { label: 'Kalman trend slope', family: 'trend', run: (b, p) => kalman(b, p) },
  quality: { label: 'Trend quality (efficiency-weighted)', family: 'regime', run: (b, p) => trendQuality(b, p) },
  obv: { label: 'On-Balance Volume', family: 'volume', run: (b, p) => obv(b, p) },
  reversion: { label: 'Mean-reversion z-score', family: 'reversion', run: (b, p) => zscore(b, p) }
};
const NAMES = Object.keys(COMPONENTS);

/* every component's votes for these candles: { name: number[] } */
function allVotes(bars, only = NAMES) {
  const out = {};
  for (const k of only) { const c = COMPONENTS[k]; if (c) out[k] = c.run(bars, {}).map((v) => (fin(v) ? clamp(v) : 0)); }
  return out;
}

module.exports = { COMPONENTS, NAMES, allVotes, supertrend, adx, macd, rsiRegime, bbSqueeze, donchian, ichimoku, kalman, trendQuality, obv, zscore, efficiency };
