'use strict';
/* SQUEEZE RISK, rebuilt: the fuel, the spark, the accelerant and the trap, scored separately and combined non-linearly, from
 * everything the Academy gathers, with a probabilistic state read on top.
 *
 *   FUEL        how much forced buying is stored in the name, and how small the supply it must come out of: short % of float, the
 *               float's size (micro / low / small / mid / large), the cover ratio (shares owed per share freely available), float
 *               turnover today, the dollar float, days to cover, how fast today's volume could turn the whole short position over
 *               (burn), the 10-day short-volume ratio, short interest added into strength, synthetic shorts in the chain
 *   SPARK       whether the buying that lights it is here now: the 20-day high taken or reclaimed, aggressor buying on the Massive
 *               tape, sweeps bought, full-depth pressure and bid walls, CVD divergence, absorption on the bid, dark-pool buying (DIX),
 *               a worked buy order on the tape (persistence), hidden bids (icebergs), pulled asks (spoofs), toxic one-sided flow
 *               (VPIN), the flow ledger, relative volume, social chatter, a dated catalyst inside the cover window
 *   ACCELERANT  what makes a move run once it starts: negative dealer gamma, a call wall close above, 0DTE share, hedge pressure
 *   TRAP        the counter-evidence: shorts pressing successfully (heavy short volume on down days), ask walls refilling, negative
 *               CVD, large prints sold, shorts added into weakness, the 20-day low gone, high price impact on sell flow
 *
 *   squeeze     0..100 = 100 * (0.35 F + 0.35 S + 0.10 A + 0.20 sqrt(F S)) * (1 - 0.5 T) * (0.6 + 0.4 coverage)
 *               fuel alone or spark alone tops out near 35; both together is where the score lives; the trap halves it; a thin read
 *               (few sources) is discounted and says so
 *   qstate      the "Q-STATE": a probabilistic state read over four regimes {squeeze, press, chop, trap}. Every piece of evidence is
 *               a log-likelihood nudge on the regime it speaks for (a Bayesian log-odds ensemble), with one interference term for
 *               fuel x spark (they reinforce each other, they do not add). Softmax gives the probabilities, entropy (0..1) says how
 *               undecided the read is, and "collapse" names the observable that would settle it. This is a name for the math, not
 *               quantum computing; the odds are uncalibrated until outcomes accumulate.
 *
 * Pure. Every input is optional; coverage reports which ones were there. Educational only: positioning and flow, not a prediction. */

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const pctOf = (a, b) => (num(a) != null && num(b) > 0 ? (num(a) / num(b)) * 100 : null);
const big = (v) => (v == null ? '—' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(Math.round(v)));

function block(name) { const L = []; return { name, L, add(key, label, max, pts, detail, known = true) { L.push({ key, label, max, pts: Math.round(clamp(pts, -max, max) * 10) / 10, detail, known }); } }; }
/* a block scores 0..100 over the evidence it HAS; coverage is the share of its possible weight that was observed */
function settle(b) {
  const known = b.L.filter((c) => c.known), maxAll = b.L.reduce((s, c) => s + c.max, 0), maxKnown = known.reduce((s, c) => s + c.max, 0), got = known.reduce((s, c) => s + c.pts, 0);
  return { score: maxKnown > 0 ? Math.round(clamp(100 * got / maxKnown, 0, 100)) : null, coverage: maxAll > 0 ? r2(maxKnown / maxAll) : 0, components: b.L };
}

/* SUPPLY: how small the pile of shares is that shorts must buy back from. The same short % of float is a different animal on a
 * 6M float and a 600M float: the smaller the free supply, the less buying it takes to move price, and the less price has to move
 * before shorts are forced. The cover ratio is the supply-and-demand number: shares that MUST be bought back (the short
 * position) per share freely available (the float that is not already sold short); above 1 there are more shares owed than
 * exist free. Float turnover (today's volume over the float) says how fast that supply is changing hands. */
const FLOAT_BANDS = [[5e6, 'micro float', 20], [10e6, 'low float', 17], [20e6, 'low float', 13], [50e6, 'small float', 8], [150e6, 'mid float', 3], [Infinity, 'large float', 0]];
function floatBand(shares) { if (!(shares > 0)) return null; const b = FLOAT_BANDS.find((x) => shares < x[0]); return { label: b[1], pts: b[2], key: b[1].split(' ')[0] }; }

function fuel({ it, svp, float: fl, scanner, chain }) {
  const F = block('fuel');
  const si = it && num(it.shortInterest), shares = fl && (num(fl.sharesFloat) || num(fl.sharesOutstanding)), floatKind = fl && num(fl.sharesFloat) ? 'float' : fl && num(fl.sharesOutstanding) ? 'shares outstanding' : null;
  const pctFloat = si != null && shares > 0 ? pctOf(si, shares) : null;
  if (pctFloat != null) F.add('pctFloat', 'Short % of ' + floatKind, 30, pctFloat >= 30 ? 30 : pctFloat >= 20 ? 24 : pctFloat >= 12 ? 16 : pctFloat >= 6 ? 8 : pctFloat >= 3 ? 3 : 0, r1(pctFloat) + '% of the ' + floatKind + ' is sold short (' + big(si) + ' of ' + big(shares) + ')');
  else F.add('pctFloat', 'Short % of float', 30, 0, si != null ? 'short interest ' + big(si) + ', float unknown' : 'short interest unknown', false);
  const band = floatBand(shares);
  if (band) F.add('floatSize', 'Float size', 20, band.pts, big(shares) + ' shares (' + band.label + ')' + (band.pts >= 13 ? ': thin supply, little buying moves it' : band.pts >= 8 ? ': modest supply' : ''));
  else F.add('floatSize', 'Float size', 20, 0, 'float unknown', false);
  const free = si != null && shares > 0 ? shares - si : null, coverRatio = free != null && free > 0 ? si / free : free != null && si > 0 ? 9.99 : null;
  if (coverRatio != null) F.add('coverRatio', 'Cover ratio (owed per free share)', 15, coverRatio >= 1 ? 15 : coverRatio >= 0.5 ? 11 : coverRatio >= 0.3 ? 7 : coverRatio >= 0.15 ? 3 : 0, r2(coverRatio) + ' shares must be bought back for every share freely available' + (coverRatio >= 1 ? ': more owed than exist free' : coverRatio >= 0.5 ? ': supply is tight against the demand to cover' : ''));
  else F.add('coverRatio', 'Cover ratio (owed per free share)', 15, 0, 'needs short interest and the float', false);
  const todayVol0 = scanner && num(scanner.volume), floatTurn = todayVol0 > 0 && shares > 0 ? todayVol0 / shares : null;
  if (floatTurn != null) F.add('floatTurn', 'Float turnover today', 10, floatTurn >= 1 ? 10 : floatTurn >= 0.5 ? 7 : floatTurn >= 0.25 ? 4 : floatTurn >= 0.1 ? 1 : 0, 'the ' + floatKind + ' traded ' + r2(floatTurn) + 'x today' + (floatTurn >= 1 ? ': the whole supply changed hands' : ''));
  else F.add('floatTurn', 'Float turnover today', 10, 0, 'needs the float and today\'s volume', false);
  const price = scanner && (num(scanner.price) ?? num(scanner.last) ?? num(scanner.close)), dollarFloat = shares > 0 && price > 0 ? shares * price : null;
  if (dollarFloat != null) F.add('dollarFloat', 'Dollar float', 5, dollarFloat < 50e6 ? 5 : dollarFloat < 200e6 ? 3 : dollarFloat < 1e9 ? 1 : 0, '$' + big(dollarFloat) + ' buys the whole ' + floatKind + (dollarFloat < 200e6 ? ': cheap to move' : ''));
  else F.add('dollarFloat', 'Dollar float', 5, 0, 'needs the float and a price', false);
  const dtc = it && num(it.daysToCover);
  if (dtc != null) F.add('dtc', 'Days to cover', 25, dtc >= 10 ? 25 : dtc >= 7 ? 20 : dtc >= 5 ? 15 : dtc >= 3 ? 8 : dtc >= 1.5 ? 3 : 0, dtc + ' days of average volume to cover');
  else F.add('dtc', 'Days to cover', 25, 0, 'unknown', false);
  const todayVol = scanner && num(scanner.volume);
  if (si != null && todayVol > 0) { const burn = todayVol / si; F.add('burn', 'Burn rate (today vs the short position)', 10, burn >= 1 ? 10 : burn >= 0.5 ? 7 : burn >= 0.25 ? 4 : burn >= 0.1 ? 1 : 0, "today's volume is " + r2(burn) + 'x the whole short position' + (burn >= 0.5 ? ': shorts can be forced through fast' : '')); }
  else F.add('burn', 'Burn rate', 10, 0, 'needs short interest and today\'s volume', false);
  const ratio = svp && num(svp.avgRatio);
  if (ratio != null) F.add('ratio', 'Short volume ratio (10d)', 10, clamp((ratio - 40) / 2, 0, 10), ratio + '% of daily volume sold short');
  else F.add('ratio', 'Short volume ratio (10d)', 10, 0, 'no FINRA daily short volume', false);
  if (it && it.label) F.add('siTrend', 'Short interest vs price', 15, it.tone === 'up' && /fighting/.test(it.label) ? 15 : it.tone === 'up' ? 8 : it.tone === 'down' ? -5 : 0, it.label);
  else F.add('siTrend', 'Short interest vs price', 15, 0, 'no settlements to compare', false);
  if (chain && num(chain.putCallOi) != null) { const pc = num(chain.putCallOi), skew = num(chain.putSkewPts); F.add('synthetic', 'Synthetic shorts in the chain', 10, clamp((pc - 1) * 8, -4, 8) + (skew != null && skew >= 2 ? 2 : 0), 'put/call open interest ' + pc + (skew != null ? ', put skew ' + skew + ' pts' : '') + (pc >= 1.3 ? ': puts to unwind if it runs' : '')); }
  else F.add('synthetic', 'Synthetic shorts in the chain', 10, 0, 'no chain', false);
  return { ...settle(F), pctFloat: r1(pctFloat), floatKind, burn: si != null && todayVol > 0 ? r2(todayVol / si) : null,
    floatShares: shares > 0 ? Math.round(shares) : null, floatBand: band ? band.label : null, floatKey: band ? band.key : null, coverRatio: r2(coverRatio), floatTurn: r2(floatTurn), dollarFloat: dollarFloat != null ? Math.round(dollarFloat) : null };
}

function spark({ svp, bars, depth, l2, tape, flowDays, intent, scanner, sentiment, earnings, marketOpen }) {
  const S = block('spark');
  const list = Array.isArray(bars) ? bars.filter((b) => b && num(b.c) != null) : [], last = list[list.length - 1], close = last ? num(last.c) : null;
  const hi20 = list.length >= 21 ? Math.max(...list.slice(-21, -1).map((b) => num(b.h, num(b.c)))) : null, lo20 = list.length >= 21 ? Math.min(...list.slice(-21, -1).map((b) => num(b.l, num(b.c)))) : null;
  if (close != null && hi20 != null) S.add('breakout', 'Price vs the 20-day range', 15, close > hi20 ? 15 : close >= hi20 * 0.99 ? 8 : close < lo20 ? -15 : 0, close > hi20 ? 'closing above the 20-day high ' + r2(hi20) : close >= hi20 * 0.99 ? 'within 1% of the 20-day high ' + r2(hi20) : close < lo20 ? 'closing under the 20-day low ' + r2(lo20) : 'inside the 20-day range');
  else S.add('breakout', 'Price vs the 20-day range', 15, 0, 'not enough daily candles', false);
  const tot = tape ? num(tape.buy, 0) + num(tape.sell, 0) : 0;
  if (tape && num(tape.count) > 20 && tot > 0) { const net = (tape.buy - tape.sell) / tot; S.add('tape', 'Aggressor volume (Massive tape)', 15, 15 * Math.tanh(2 * net), Math.round(tape.buy / tot * 100) + '% of the tape lifted the offer' + (marketOpen === false ? ' (last session)' : '')); }
  else if (flowDays && flowDays.available && num(flowDays.deltaRatioAvg) != null) S.add('tape', 'Aggressor volume (ledger)', 15, 15 * Math.tanh(2 * flowDays.deltaRatioAvg), 'tape closed; the ledger\'s delta ratio is ' + flowDays.deltaRatioAvg);
  else S.add('tape', 'Aggressor volume', 15, 0, 'no tape yet', false);
  if (tape && num(tape.sweepN, 0) >= 2) S.add('sweeps', 'Sweeps', 10, (num(tape.sweepBuy, 0) - num(tape.sweepSell, 0)) * 3, tape.sweepBuy + ' bought, ' + tape.sweepSell + ' sold');
  else S.add('sweeps', 'Sweeps', 10, 0, 'no sweeps', !!(tape && num(tape.count) > 20));
  if (depth && depth.ready && depth.pressure) S.add('pressure', 'Full-depth pressure now', 15, num(depth.pressure.score, 0) * 0.15, depth.pressure.label || '');
  else S.add('pressure', 'Full-depth pressure now', 15, 0, 'no Level 3 book', false);
  if (depth && depth.ready && Array.isArray(depth.walls)) { const ask = depth.walls.filter((w) => w.side === 'ask').length, bid = depth.walls.filter((w) => w.side === 'bid').length; S.add('walls', 'Walls in the book', 8, (bid - ask) * 4, bid + ' bid wall' + (bid === 1 ? '' : 's') + ', ' + ask + ' ask wall' + (ask === 1 ? '' : 's')); }
  else S.add('walls', 'Walls in the book', 8, 0, 'no book', false);
  if (depth && depth.ready && depth.flow && depth.flow.divergence) S.add('cvd', 'CVD vs price', 8, depth.flow.divergence === 'bullish' ? 8 : -8, depth.flow.divergence + ' divergence');
  else S.add('cvd', 'CVD vs price', 8, 0, 'no divergence read', !!(depth && depth.ready));
  if (l2 && l2.ready && l2.absorption && l2.absorption.state && l2.absorption.state !== 'none') { const bull = l2.absorption.state === 'bull', st = num(l2.absorption.strength, 0); S.add('absorb', 'Absorption at the touch', 8, bull ? 5 + 3 * st : -(5 + 3 * st), (bull ? 'bids' : 'asks') + ' are absorbing'); }
  else S.add('absorb', 'Absorption at the touch', 8, 0, 'none', !!(l2 && l2.ready));
  const f = intent && intent.formulas ? intent.formulas : null;
  if (f && f.darkPool && f.darkPool.ok && num(f.darkPool.dix) != null) S.add('dix', 'Dark pool DIX', 8, (f.darkPool.dix - 0.5) * 40, Math.round(f.darkPool.dix * 100) + '% of off-exchange volume bought' + (f.darkPool.heavy ? ', dark share heavy' : ''));
  else S.add('dix', 'Dark pool DIX', 8, 0, 'no off-exchange prints', false);
  if (f && f.persistence && f.persistence.ok) S.add('persist', 'Worked order on the tape', 8, f.persistence.side === 'buy' ? (f.persistence.band === 'worked order' ? 8 : f.persistence.band === 'some slicing' ? 4 : 0) : f.persistence.side === 'sell' ? (f.persistence.band === 'worked order' ? -8 : f.persistence.band === 'some slicing' ? -4 : 0) : 0, 'trade signs autocorrelate ' + f.persistence.acf + ' (' + f.persistence.band + ', ' + f.persistence.side + ' side)');
  else S.add('persist', 'Worked order on the tape', 8, 0, 'too few prints', false);
  if (f && f.iceberg && f.iceberg.ok) S.add('iceberg', 'Hidden size', 8, f.iceberg.side === 'buyer' ? 8 : f.iceberg.side === 'seller' ? -8 : 0, f.iceberg.side === 'none' ? 'nothing hidden' : 'hidden ' + f.iceberg.side + (f.iceberg.levels[0] ? ' at ' + f.iceberg.levels[0].price : ''));
  else S.add('iceberg', 'Hidden size', 8, 0, 'no book window', false);
  if (f && f.spoof && f.spoof.ok) S.add('spoof', 'Pulled orders', 5, /buyer/.test(f.spoof.intent) ? 5 : /seller/.test(f.spoof.intent) ? -5 : 0, f.spoof.intent);
  else S.add('spoof', 'Pulled orders', 5, 0, 'no book window', false);
  if (f && f.vpin && f.vpin.ok) { const dir = f.persistence && f.persistence.ok && f.persistence.side !== 'mixed' ? (f.persistence.side === 'buy' ? 1 : -1) : (tot > 0 ? Math.sign(tape.buy - tape.sell) : 0); S.add('vpin', 'VPIN (one-sided flow)', 6, (f.vpin.band === 'toxic' ? 6 : f.vpin.band === 'informed' ? 4 : 0) * dir, 'VPIN ' + f.vpin.vpin + ' (' + f.vpin.band + ')'); }
  else S.add('vpin', 'VPIN (one-sided flow)', 6, 0, 'too few buckets', false);
  if (flowDays && flowDays.available && num(flowDays.days) >= 2 && num(flowDays.score) != null) S.add('week', 'Multi-day flow ledger', 8, flowDays.score / 12.5, flowDays.label || (flowDays.days + ' days'));
  else S.add('week', 'Multi-day flow ledger', 8, 0, 'no ledger yet', false);
  const rvol = scanner && (num(scanner.rvol) ?? num(scanner.relVol) ?? num(scanner.volumeRatio));
  if (rvol != null) S.add('rvol', 'Relative volume', 10, rvol >= 3 ? 10 : rvol >= 2 ? 7 : rvol >= 1.5 ? 4 : rvol >= 1 ? 1 : 0, r2(rvol) + 'x normal volume');
  else S.add('rvol', 'Relative volume', 10, 0, 'unknown', false);
  const so = sentiment && sentiment.social && sentiment.social.available !== false ? sentiment.social : null;
  if (so) { const rate = num(so.postsPerHour), base = num(so.baseline) || num(so.baselinePerHour), mult = rate != null && base > 0 ? rate / base : num(so.rateMult); const spike = so.spike === true || (mult != null && mult >= 2); S.add('chatter', 'Social chatter', 6, spike ? 6 : mult != null && mult >= 1.4 ? 3 : 0, mult != null ? r1(mult) + 'x the usual post rate' : rate != null ? rate + ' posts/hour' : (so.label || 'social read')); }
  else S.add('chatter', 'Social chatter', 6, 0, 'no social read', false);
  const days = earnings && (num(earnings.daysUntil) ?? num(earnings.days));
  if (days != null) S.add('catalyst', 'Dated catalyst', 6, days >= 0 && days <= 5 ? 6 : days <= 10 ? 3 : 0, days >= 0 ? 'earnings in ' + days + ' day' + (days === 1 ? '' : 's') + (days <= 5 ? ': a binary event inside the cover window' : '') : 'no date inside the window');
  else S.add('catalyst', 'Dated catalyst', 6, 0, 'no earnings date', false);
  return { ...settle(S), hi20: r2(hi20), lo20: r2(lo20), close: r2(close) };
}

function accelerant({ gamma }) {
  const A = block('accelerant');
  if (!gamma || !gamma.available) { A.add('gex', 'Dealer gamma', 15, 0, 'no chain', false); A.add('callWall', 'Call wall above', 10, 0, 'no chain', false); A.add('zeroDte', '0DTE share', 5, 0, 'no chain', false); A.add('hedge', 'Hedge pressure', 5, 0, 'no chain', false); return settle(A); }
  A.add('gex', 'Dealer gamma', 15, gamma.regime === 'negative' ? 15 : 3, gamma.regime === 'negative' ? 'negative net gamma: dealers buy as it rises, moves run' : 'positive net gamma: dealers sell into strength, moves dampen');
  const cw = gamma.callWall && num(gamma.callWall.distancePct);
  A.add('callWall', 'Call wall above', 10, cw != null ? (cw >= 0 && cw <= 3 ? 10 : cw > 3 && cw <= 7 ? 6 : cw < 0 ? 8 : 2) : 0, cw != null ? 'call wall at ' + gamma.callWall.strike + ' (' + (cw >= 0 ? '+' : '') + cw + '%)' + (cw >= 0 && cw <= 3 ? ': a magnet within reach' : cw < 0 ? ': already above it, dealers chasing' : '') : 'no call wall', cw != null);
  const z = num(gamma.zeroDteShare);
  A.add('zeroDte', '0DTE share', 5, z != null ? (z >= 0.3 ? 5 : z >= 0.15 ? 3 : 0) : 0, z != null ? Math.round(z * 100) + '% of open interest expires today' : 'unknown', z != null);
  const hp = num(gamma.pressurePct);
  A.add('hedge', 'Hedge pressure', 5, hp != null ? (hp >= 20 ? 5 : hp >= 10 ? 3 : hp >= 5 ? 1 : 0) : 0, hp != null ? 'dealer hedge shares are ' + hp + '% of average volume' : 'unknown', hp != null);
  return settle(A);
}

function trap({ svp, it, depth, tape, intent, bars }) {
  const T = block('trap');
  if (svp && svp.tone) T.add('pressDays', 'Shorts pressing on down days', 20, svp.tone === 'down' ? 12 + Math.min(8, num(svp.downOnHigh, 0) * 2) : 0, svp.label || '');
  else T.add('pressDays', 'Shorts pressing on down days', 20, 0, 'no daily short volume', false);
  if (it && it.label) T.add('siDown', 'Shorts added into weakness', 15, it.tone === 'down' ? 15 : 0, it.label);
  else T.add('siDown', 'Shorts added into weakness', 15, 0, 'no settlements', false);
  if (depth && depth.ready && Array.isArray(depth.walls)) { const ask = depth.walls.filter((w) => w.side === 'ask').length, bid = depth.walls.filter((w) => w.side === 'bid').length; T.add('askWalls', 'Ask walls refilling', 15, Math.max(0, ask - bid) * 7, ask + ' ask walls vs ' + bid + ' bid walls'); }
  else T.add('askWalls', 'Ask walls refilling', 15, 0, 'no book', false);
  if (depth && depth.ready && depth.flow && depth.flow.divergence) T.add('cvdDown', 'Bearish CVD divergence', 10, depth.flow.divergence === 'bearish' ? 10 : 0, depth.flow.divergence + ' divergence');
  else T.add('cvdDown', 'Bearish CVD divergence', 10, 0, 'no divergence read', !!(depth && depth.ready));
  const f = intent && intent.formulas ? intent.formulas : null;
  if (f && f.footprint && f.footprint.ok) T.add('bigSold', 'Large prints sold', 10, f.footprint.side === 'sell' ? 10 : 0, 'big prints lean ' + f.footprint.side);
  else T.add('bigSold', 'Large prints sold', 10, 0, 'too few prints', false);
  if (f && f.lambda && f.lambda.ok) { const tot = tape ? num(tape.buy, 0) + num(tape.sell, 0) : 0, sellFlow = tot > 0 && tape.sell > tape.buy; T.add('impact', 'Sell flow moving price', 10, f.lambda.band === 'high impact' && sellFlow ? 10 : f.lambda.band === 'inverted' ? 6 : 0, 'Kyle lambda ' + f.lambda.lambda + ' (' + f.lambda.band + ')'); }
  else T.add('impact', 'Sell flow moving price', 10, 0, 'too few bins', false);
  const list = Array.isArray(bars) ? bars.filter((b) => b && num(b.c) != null) : [], last = list[list.length - 1];
  const lo20 = list.length >= 21 ? Math.min(...list.slice(-21, -1).map((b) => num(b.l, num(b.c)))) : null;
  if (last && lo20 != null) T.add('breakdown', '20-day low gone', 20, num(last.c) < lo20 ? 20 : 0, num(last.c) < lo20 ? 'closing under ' + r2(lo20) : 'holding above the 20-day low ' + r2(lo20));
  else T.add('breakdown', '20-day low gone', 20, 0, 'not enough daily candles', false);
  return settle(T);
}

/* the Q-STATE: four regimes, log-odds nudged by the blocks, an interference term for fuel x spark, softmax, entropy */
function qstate({ F, S, A, T, coverage }) {
  const f = (F.score ?? 0) / 100, s = (S.score ?? 0) / 100, a = (A.score ?? 0) / 100, t = (T.score ?? 0) / 100;
  const inter = Math.sqrt(f * s); // fuel and spark reinforce: this is the cross term, it is what makes a squeeze more than "heavily shorted"
  /* squeeze needs BOTH fuel and spark (the product), the accelerant adds, the trap subtracts; press is the trap winning;
     chop is a two-sided tape with nothing loaded; trap is buying with no short fuel behind it, which gets sold into */
  const logit = {
    squeeze: 5.0 * f * s + 0.8 * a - 2.0 * t - 0.9,
    press: 3.0 * t + 0.6 * (1 - s) - 0.6,
    chop: 1.0 * (1 - Math.abs(s - 0.5) * 2) + 0.6 * (1 - t) - 0.5 * a,
    trap: 2.0 * s * (1 - f) + 1.5 * t * s - 0.5
  };
  const keys = Object.keys(logit), mx = Math.max(...keys.map((k) => logit[k]));
  const w = keys.map((k) => Math.exp(logit[k] - mx)), z = w.reduce((x, y) => x + y, 0);
  const probs = {}; keys.forEach((k, i) => { probs[k] = r3(w[i] / z); });
  const entropy = r3(-keys.reduce((e, k, i) => { const p = w[i] / z; return e + (p > 0 ? p * Math.log(p) : 0); }, 0) / Math.log(keys.length));
  const dominant = keys.reduce((b, k) => (probs[k] > probs[b] ? k : b), keys[0]);
  const collapse = dominant === 'squeeze' ? 'A close back under the 20-day high with the tape turning net sold collapses this to PRESS or TRAP.'
    : dominant === 'press' ? 'A close above the 20-day high on net buying with the bid walls holding collapses this to SQUEEZE.'
    : dominant === 'trap' ? 'Sellers stepping aside (asks pulled, CVD turning up, hidden bids) collapses this to SQUEEZE; a lower high on heavy short volume collapses it to PRESS.'
    : 'A break of either end of the 20-day range with one-sided flow collapses this to SQUEEZE or PRESS.';
  return { probs, entropy, dominant, collapse, interference: r3(inter), coverage: r2(coverage), note: 'Q-STATE is a probabilistic state read (a Bayesian log-odds ensemble with an interference term for fuel x spark), not quantum computing. The odds are uncalibrated until outcomes accumulate.' };
}

function computeSqueeze(inputs = {}) {
  const F = fuel(inputs), S = spark(inputs), A = accelerant(inputs), T = trap(inputs);
  const blocks = [F, S, A, T], coverage = r2(blocks.reduce((s, b) => s + (b.coverage || 0), 0) / blocks.length);
  const f = (F.score ?? 0) / 100, s = (S.score ?? 0) / 100, a = (A.score ?? 0) / 100, t = (T.score ?? 0) / 100;
  const raw = 100 * (0.35 * f + 0.35 * s + 0.10 * a + 0.20 * Math.sqrt(f * s));
  const score = F.score == null && S.score == null ? null : Math.round(clamp(raw * (1 - 0.5 * t) * (0.6 + 0.4 * coverage), 0, 100));
  const q = qstate({ F, S, A, T, coverage });
  const band = score == null ? 'unknown' : score >= 70 ? 'squeeze candidate' : score >= 50 ? 'loaded' : score >= 35 ? 'some fuel' : 'ordinary';
  const missing = [];
  if ((F.score ?? 0) >= 55 && (S.score ?? 0) < 45) missing.push('the spark: fuel is there, buying is not yet');
  if ((S.score ?? 0) >= 55 && (F.score ?? 0) < 40) missing.push('the fuel: buying is there, the short position is ordinary');
  if ((T.score ?? 0) >= 50) missing.push('a clean tape: shorts are still winning on the down days');
  const lines = [];
  lines.push(score == null ? 'Not enough data to score a squeeze.' : 'SQUEEZE RISK ' + score + ' (' + band + '): fuel ' + (F.score ?? '–') + ', spark ' + (S.score ?? '–') + ', accelerant ' + (A.score ?? '–') + ', trap ' + (T.score ?? '–') + '.');
  if (F.pctFloat != null) lines.push(F.pctFloat + '% of the ' + F.floatKind + ' is short' + (F.burn != null ? ' and today\'s volume is ' + F.burn + 'x the whole position' : '') + '.');
  if (F.floatShares != null) lines.push('Supply: ' + big(F.floatShares) + ' shares (' + F.floatBand + ')' + (F.coverRatio != null ? ', ' + F.coverRatio + ' owed per free share' : '') + (F.floatTurn != null ? ', the ' + F.floatKind + ' turned ' + F.floatTurn + 'x today' : '') + '.');
  if (missing.length) lines.push('What is missing: ' + missing.join('; ') + '.');
  lines.push('Q-STATE: ' + q.dominant.toUpperCase() + ' ' + Math.round(q.probs[q.dominant] * 100) + '% (squeeze ' + Math.round(q.probs.squeeze * 100) + '%, press ' + Math.round(q.probs.press * 100) + '%, chop ' + Math.round(q.probs.chop * 100) + '%, trap ' + Math.round(q.probs.trap * 100) + '%), entropy ' + q.entropy + '. ' + q.collapse);
  const top = (b) => b.components.filter((c) => c.known && c.pts > 0).sort((x, y) => y.pts - x.pts).slice(0, 3).map((c) => c.label + ': ' + c.detail);
  return { score, band, coverage, fuel: F, spark: S, accelerant: A, trap: T, qstate: q, missing, read: lines.join(' '), why: { fuel: top(F), spark: top(S), accelerant: top(A), trap: top(T) },
    formula: 'squeeze = 100 x (0.35 fuel + 0.35 spark + 0.10 accelerant + 0.20 sqrt(fuel x spark)) x (1 - 0.5 trap) x (0.6 + 0.4 coverage)' };
}

/* ---- the AI brief: a short read written only from these numbers ---- */
const AI_SYSTEM = 'You are the short-squeeze analyst of the Making Easy Money Academy, writing for retail traders. Use ONLY the figures given; never invent numbers, names, catalysts or events. '
  + 'Explain what the positioning and the flow set up, in plain English, like a desk head talking to a junior: fuel, spark, accelerant, trap. Do not predict; say what would prove the squeeze case and what would kill it. '
  + 'Answer with one JSON object only, no prose around it: headline (one sentence), read (3 to 5 short sentences), proves (2 to 3 observables that would confirm the squeeze), kills (2 to 3 observables that would end it), plan (2 sentences on how a long would manage it and how a short should treat it), confidence (low, medium or high, with a short reason).';
function aiPrompt(symbol, m, extra = {}) {
  const c = (b) => b.components.filter((x) => x.known).map((x) => x.label + ' = ' + x.pts + '/' + x.max + ' (' + x.detail + ')').join('; ');
  return 'SYMBOL: ' + symbol + '\nSQUEEZE RISK ' + m.score + ' (' + m.band + '); coverage ' + Math.round(m.coverage * 100) + '% of sources present' + (extra.price != null ? '; price ' + extra.price : '')
    + '\nFUEL ' + m.fuel.score + ': ' + c(m.fuel) + '\nSPARK ' + m.spark.score + ': ' + c(m.spark) + '\nACCELERANT ' + m.accelerant.score + ': ' + c(m.accelerant) + '\nTRAP ' + m.trap.score + ': ' + c(m.trap)
    + '\nQ-STATE probabilities: squeeze ' + m.qstate.probs.squeeze + ', press ' + m.qstate.probs.press + ', chop ' + m.qstate.probs.chop + ', trap ' + m.qstate.probs.trap + '; entropy ' + m.qstate.entropy
    + (extra.hi20 != null ? '\n20-day high ' + extra.hi20 + ', 20-day low ' + extra.lo20 : '') + (extra.marketOpen === false ? '\nThe market is closed; the tape figures are from the last session.' : '');
}
function parseBrief(text) {
  const s = String(text || '').trim(), a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b <= a) return null;
  let j; try { j = JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; } if (!j || typeof j !== 'object') return null;
  const list = (v, max) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max);
  return { headline: String(j.headline || '').trim().slice(0, 300), read: list(j.read, 5), proves: list(j.proves, 3), kills: list(j.kills, 3), plan: list(j.plan, 2), confidence: String(j.confidence || '').trim().slice(0, 160) };
}
function createSqueezeBrief({ ai = null, fetchImpl = globalThis.fetch, now = Date.now, ttlMs = 10 * 60_000, logger = () => {} } = {}) {
  const on = !!(ai && String(ai.apiKey || '').trim()), briefs = new Map(), inflight = new Map();
  async function brief(symbol, m, extra = {}) {
    if (!on) return { available: false, reason: 'ai_unconfigured' };
    if (!m || m.score == null) return { available: false, reason: 'no_score' };
    const key = symbol + ':' + Math.round(m.score / 5) + ':' + m.qstate.dominant;
    const hit = briefs.get(key); if (hit && now() - hit.at < ttlMs) return hit.v;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      let v;
      try {
        const res = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: ai.model || 'claude-sonnet-5-5', max_tokens: 700, system: AI_SYSTEM, messages: [{ role: 'user', content: aiPrompt(symbol, m, extra) }] }), signal: AbortSignal.timeout(45_000) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error('anthropic_' + res.status);
        const parsed = parseBrief((data.content || []).filter((x) => x.type === 'text').map((x) => x.text).join(''));
        v = parsed ? { available: true, model: data.model || ai.model, at: now(), ...parsed } : { available: false, reason: 'unreadable_answer' };
      } catch (error) { logger('warn', 'squeeze_brief_failed', { symbol, error: String(error && error.message || error) }); v = { available: false, reason: 'ai_error' }; }
      briefs.set(key, { at: now(), v }); if (briefs.size > 400) briefs.delete(briefs.keys().next().value);
      return v;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  }
  return { brief, on };
}

module.exports = { computeSqueeze, fuel, spark, accelerant, trap, qstate, floatBand, createSqueezeBrief, aiPrompt, parseBrief, AI_SYSTEM };
