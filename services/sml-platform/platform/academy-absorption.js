'use strict';

/* Absorption meter. Absorption is aggressive volume that fails to move price: sellers hit the bid hard and price holds (buyers are absorbing), or buyers lift
 * the offer hard and price stalls (sellers are absorbing). Two independent reads are combined:
 *   - the tape: aggressor volume classified by the tick rule (up-tick = buy, down-tick = sell) against how far price actually moved in the window
 *   - the order book: the Level 2 reader's own absorption state, when it is tracking the symbol
 * Output is -100 (sellers absorbing a push up) .. +100 (buyers absorbing selling), with how long it has persisted, the volume-weighted price of the window, and, when recorded,
 * how often this order-flow signal was followed by a move in its direction five minutes later.
 * Needs live prints; with too few it says so instead of showing a number. Educational context, not a signal to trade. */

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const r1 = (v) => Math.round(v * 10) / 10;

function classifyTicks(ticks) {
  const out = []; let last = 0, dir = 0;
  for (const row of ticks) {
    const t = Number(row[0]), p = Number(row[1]), s = Number(row[2]) || 0;
    if (!(p > 0) || !Number.isFinite(t)) continue;
    if (last > 0) { if (p > last) dir = 1; else if (p < last) dir = -1; }
    out.push({ t, p, s, d: last > 0 ? dir : 0 });
    last = p;
  }
  return out;
}

function windowStats(rows) {
  let buy = 0, sell = 0, vol = 0, hi = -Infinity, lo = Infinity, notional = 0;
  for (const r of rows) { vol += r.s; notional += r.p * r.s; if (r.d > 0) buy += r.s; else if (r.d < 0) sell += r.s; if (r.p > hi) hi = r.p; if (r.p < lo) lo = r.p; }
  return { buy, sell, vol, hi, lo, vwap: vol > 0 ? notional / vol : null, first: rows[0] ? rows[0].p : null, last: rows.length ? rows[rows.length - 1].p : null, n: rows.length };
}

/* score one window: positive = buyers absorbing */
function scoreWindow(st, expectedMovePct) {
  if (!st || st.n < 8 || st.vol <= 0 || !(st.first > 0)) return null;
  const tagged = st.buy + st.sell; if (tagged <= 0) return null;
  const net = (st.buy - st.sell) / tagged;            // -1 all selling .. +1 all buying (aggressor imbalance)
  const move = (st.last - st.first) / st.first;       // actual price change
  const exp = Math.max(0.0004, expectedMovePct || 0.001);
  // price "should" move with the aggressors; the part that did not is what was absorbed
  const should = net * exp * 2, shortfall = should - move;
  const absorbed = clamp(-shortfall / (exp * 2), -1, 1); // + when selling was not followed by a fall (or buying by a rise): sign flips below
  // aggressive selling (net<0) with price holding/rising -> buyers absorbing -> positive ; aggressive buying (net>0) with price holding/falling -> sellers absorbing -> negative
  const imbalanceWeight = Math.min(1, Math.abs(net) / 0.35);
  const s = net < 0 ? clamp((move - should) / (exp * 2), 0, 1) * imbalanceWeight : -clamp((should - move) / (exp * 2), 0, 1) * imbalanceWeight;
  void absorbed;
  return { score: s, net, move };
}

function absorptionMeter({ ticks = [], now = Date.now(), expectedMovePct = null, flow = null, history = null, windowMs = 5 * 60_000, buckets = 5 } = {}) {
  const rows = classifyTicks(Array.isArray(ticks) ? ticks : []).filter((r) => now - r.t <= windowMs * 3);
  const win = rows.filter((r) => now - r.t <= windowMs);
  const st = windowStats(win);
  const l2 = flow && flow.ready && flow.absorption ? flow.absorption : null;
  if (st.n < 15 && !l2) return { available: false, reason: 'too_few_prints', prints: st.n };

  // expected 1-window move: a quarter of the symbol's typical 1-minute range scaled to the window, or the window's own realised range as a floor
  const ownRange = st.hi > 0 && st.lo > 0 ? (st.hi - st.lo) / st.last : 0.001;
  const exp = Math.max(expectedMovePct || 0, ownRange * 0.6, 0.0005);
  const main = scoreWindow(st, exp);
  // persistence: count consecutive trailing sub-windows with the same sign of absorption
  const step = windowMs / buckets; let streak = 0, sign = 0;
  for (let b = 0; b < buckets; b++) {
    const to = now - b * step, from = to - step * 1.6;
    const sc = scoreWindow(windowStats(rows.filter((r) => r.t > from && r.t <= to)), exp);
    if (!sc || Math.abs(sc.score) < 0.2) break;
    const sg = sc.score > 0 ? 1 : -1;
    if (b === 0) sign = sg; else if (sg !== sign) break;
    streak += 1;
  }
  let score = main ? main.score * 100 : 0;
  let l2Score = null;
  if (l2 && l2.state && l2.state !== 'none' && l2.state !== 'neutral') {
    const dir = /buy|bull|bid/i.test(l2.state) ? 1 : /sell|bear|ask/i.test(l2.state) ? -1 : 0;
    l2Score = dir * clamp(Number(l2.strength) || 0.5, 0, 1) * 100;
  }
  if (l2Score != null) score = main ? score * 0.6 + l2Score * 0.4 : l2Score;
  score = Math.round(clamp(score, -100, 100));

  let state = 'none';
  if (score >= 55) state = 'buyers_absorbing'; else if (score >= 25) state = 'buyers_leaning'; else if (score <= -55) state = 'sellers_absorbing'; else if (score <= -25) state = 'sellers_leaning';
  const label = { buyers_absorbing: 'Buyers are absorbing the selling', buyers_leaning: 'Buyers are starting to absorb', sellers_absorbing: 'Sellers are absorbing the buying', sellers_leaning: 'Sellers are starting to absorb', none: 'No clear absorption' }[state];
  // where: the volume-weighted price of the aggressive volume against the move
  const where = st.vwap ? Math.round(st.vwap * 100) / 100 : null;
  const agree = l2Score != null && main ? Math.sign(l2Score) === Math.sign(main.score) || Math.sign(main.score) === 0 : null;
  const meter = {
    available: true, score, state, label, windowMin: windowMs / 60_000, prints: st.n, persistedWindows: streak,
    tape: main ? { aggressiveBuyPct: st.buy + st.sell > 0 ? r1((st.buy / (st.buy + st.sell)) * 100) : null, buyVol: Math.round(st.buy), sellVol: Math.round(st.sell), priceChangePct: r1(main.move * 10000) / 100, netImbalance: Math.round(main.net * 100) / 100, rule: 'tick rule' } : null,
    orderBook: l2 ? { state: l2.state, strength: l2.strength || 0, buyVol: l2.buyVol, sellVol: l2.sellVol, iceberg: l2.iceberg || null } : null,
    level: where, agreement: agree,
    explain: explainText({ state, st, main, l2, streak })
  };
  const hits = outcomeFor(history, state);
  if (hits) meter.history = hits;
  return meter;
}

function explainText({ state, st, main, l2, streak }) {
  if (state === 'none') return 'Aggressive volume is moving price about as much as expected, so nothing is being soaked up right now.';
  const buy = state.startsWith('buyers');
  const bits = [];
  if (main) bits.push(buy ? `Aggressive selling dominated (${Math.round((st.sell / Math.max(1, st.buy + st.sell)) * 100)}% of tagged volume) but price moved ${(main.move * 100).toFixed(2)}%` : `Aggressive buying dominated (${Math.round((st.buy / Math.max(1, st.buy + st.sell)) * 100)}% of tagged volume) but price moved ${(main.move * 100).toFixed(2)}%`);
  if (l2 && l2.state && l2.state !== 'none') bits.push('the order book shows the same behaviour');
  if (streak >= 2) bits.push(`and it has held for ${streak} consecutive windows`);
  return bits.join(', ') + '. Absorption shows who is willing to take the other side; it does not guarantee a reversal.';
}

/* history: rows from the order-flow store summary [{ kind, side, events, measured, avg_pct, hit_rate }] */
function outcomeFor(history, state) {
  if (!Array.isArray(history) || state === 'none') return null;
  const side = state.startsWith('buyers') ? 'bull' : 'bear';
  const row = history.find((h) => h.kind === 'absorb' && h.side === side);
  if (!row || !(Number(row.measured) >= 20)) return null;
  return { signals: Number(row.events), measured: Number(row.measured), hitRatePct: Math.round(Number(row.hit_rate) * 100), avgMoveAfter5mPct: Number(row.avg_pct) };
}

module.exports = { absorptionMeter, classifyTicks, scoreWindow, windowStats };
