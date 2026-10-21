'use strict';

/* The Article Desk's voice. The reader we write for has read a finance syllabus and a group chat in the same afternoon:
 * graduate-level on the mechanism (what forces what, and why), modern and urban in the delivery (short lines after long ones,
 * trader vernacular used sparingly, a dry joke now and then that never claims certainty), and honest about limits (every piece
 * argues against itself before it closes). Deterministic: each function picks among variants by a seed, so two pieces on the
 * same angle do not read alike, and nothing here adds a number the data did not already give the draft. */

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const px = (v) => (v >= 1 ? '$' + Number(v).toFixed(2) : '$' + Number(v).toFixed(4));
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

const KICKER = { gamma: 'OPTIONS POSITIONING', short: 'SHORT INTEREST', earnings: 'EARNINGS', tape: 'TAPE READING', structure: 'MARKET STRUCTURE', narrative: 'MARKET WATCH' };

/* the standfirst under the headline: one sentence, no number the page does not already carry */
function dek(st, c, seed = 0) {
  const S = '$' + c.symbol;
  const v = {
    gamma: [`When dealers are short gamma, hedging stops being background noise and becomes the move. A read on ${S}.`, `The options book can push a stock further than opinion can. Here is the mechanism behind ${S}, and where it breaks.`],
    short: [`Short volume is a clue, not a confession. What the FINRA tape does and does not say about ${S}.`, `A crowded short is a coiled spring only if the stock refuses to fall. A read on ${S}.`],
    earnings: [`The print is binary. The positioning going into it is not. A read on ${S} before the report.`, `Consensus is a number. Positioning is a story. What the tape did ahead of ${S} earnings.`],
    tape: [`Prints are the receipts. A look at who is actually trading ${S}, and what the size implies.`, `Retail reads candles; the prints show who is in the stock. A read on ${S}.`],
    narrative: [`No loud signal, and that is the point. What the price, the range and the volume say about ${S}, and what would prove the read wrong.`, `A stock does not need a headline to have a story. A skeptical read on ${S}.`],
    structure: [`A liquidity sweep followed by a structural break is a sequence with a logic. A read on ${S}.`, `The stops got taken and the structure turned. What that sequence implies for ${S}, and what would undo it.`]
  }[st.angle] || [`A data-driven read on ${S}.`];
  return pick(v, seed + 3);
}

/* why the thing the data shows moves price: the mechanism, in two short paragraphs */
function mechanism(st, c, seed = 0) {
  const S = '$' + c.symbol, g = c.gamma || {}, sh = c.short || {}, t = c.tape || {}, e = c.earnings || {};
  const paras = [];
  if (st.angle === 'gamma') {
    paras.push(pick([
      `Start with who sits on the other side of the calls. Customers buy them; dealers sell them, then hedge by holding shares. As the stock rises, a call's delta rises with it, so the hedge must grow: dealers buy more stock into strength. When price falls, the same arithmetic runs in reverse and they sell into weakness. Economists call that procyclical, and the sign of the dealers' net gamma decides whether the book damps a move or feeds it.`,
      `Options look like side bets until you ask who has to hedge them. A dealer who sold calls is short gamma: the stock goes up, the hedge ratio goes up, and buying becomes mandatory rather than optional. That is not a view on ${S}. It is inventory management with a risk desk watching, and it tends to arrive at the least convenient price.`
    ], seed));
    paras.push(`${g.regime === 'negative' ? 'Here the regime reads short gamma' : 'Here the regime reads long gamma, which pins rather than propels'}${g.pressurePct != null ? `, with hedging pressure at ${g.pressurePct}% of the book` : ''}${g.callWall && g.callWall.strike ? `, and the call wall at ${px(g.callWall.strike)} is where the hedging flow concentrates` : ''}. ${pick([`Think of the wall as a magnet with a deadline.`, `Walls are where the arithmetic gets loud.`, `That is the strike where the dealers' homework is due.`], seed + 1)}`);
  } else if (st.angle === 'short') {
    paras.push(pick([
      `Short volume and short interest are cousins who do not speak. Short volume counts shares sold short in a session, and a lot of it is market makers hedging or flipping inventory intraday. Short interest is the stock of positions still open. The squeeze logic lives in the second number, scaled by how long it takes to exit: days to cover is open short interest divided by average daily volume.`,
      `The asymmetry does the work. A long can lose at most what was paid; a short's loss has no ceiling, and margin rules force a decision at the worst moment. A crowded short against a stock that will not fall is a position with a clock on it, and exits are made by buying.`
    ], seed));
    paras.push(`${sh.ratio != null ? `Off-exchange short volume ran ${Math.round(sh.ratio * 100)}% of prints${sh.baselineRatio != null ? ` against a ${Math.round(sh.baselineRatio * 100)}% baseline` : ''}` : 'The short-volume read is thin'}${sh.daysToCover != null ? `, and the days-to-cover figure is ${Number(sh.daysToCover).toFixed(1)}` : ''}. ${pick([`High short volume alone is the market doing its ordinary job. The tell is pressure that persists while price refuses to cooperate.`, `Shorting into strength is a bet that the move is a mistake. Strength that holds is the market disagreeing.`], seed + 1)}`);
  } else if (st.angle === 'earnings') {
    paras.push(pick([
      `Options price the report as a distribution, and the implied move is its width. The variance risk premium, the long-observed tendency for implied volatility to exceed what is later realized, means the straddle is usually a little expensive. What the chart can add is context: where price sits against its anchored VWAP, which gaps remain unfilled, and where resting stops sit below equal lows.`,
      `Nobody can forecast the number. What can be read is the posture going in: who accumulated, where the unfilled imbalances sit, and whether the last sweep took the obvious liquidity. Those do not predict the print; they shape how the market behaves in the first hour after it.`
    ], seed));
    paras.push(`${e.impliedPct != null ? `The options market is pricing a move of roughly ${e.impliedPct}%${e.histAvgMovePct != null ? `, against a historical average of ${e.histAvgMovePct}%` : ''}.` : 'The options market has not given a clean implied move.'} ${pick([`If the move comes in under that, the straddle sellers eat well. If not, they learn about tails.`, `A binary event is the one place where being right about structure still loses to being wrong about guidance.`], seed + 1)}`);
  } else if (st.angle === 'tape') {
    paras.push(pick([
      `A trade that prints off an exchange is reported through a trade reporting facility, and it covers dark pools, broker internalizers and retail wholesalers alike. That is why a high off-exchange share is common and says little by itself. The signal is in deviations: block-sized prints, sweeps (orders that hit several venues at once because the buyer values speed over price), and absorption, where resting size soaks up aggressive flow without letting price move.`,
      `Size leaves fingerprints. An institution working an order has to choose between patience, which leaks information, and urgency, which pays for it. Sweeps are the urgency; blocks and absorption are the patience. The direction is inferred from the tick, which is a hint and not a confession.`
    ], seed));
    paras.push(`${t.offSharePct != null ? `Off-exchange share sits near ${Math.round(t.offSharePct)}%${t.typicalSharePct != null ? ` against a typical ${Math.round(t.typicalSharePct)}%` : ''}` : 'The off-exchange share is not clean here'}${t.sweepBuy != null || t.sweepSell != null ? `, with ${t.sweepBuy || 0} buy sweeps to ${t.sweepSell || 0} sell sweeps` : ''}${t.absorption ? ', and the book shows absorption' : ''}. ${pick([`The chart shows the story. The prints show the cast.`, `Candles are the headline; the tape is the byline.`], seed + 1)}`);
  } else if (st.angle === 'narrative') {
    paras.push(pick([
      `A range is a negotiation. Buyers and sellers keep agreeing on a price band until one side runs out of patience, and the edge of the band is where the argument gets settled. Volatility tends to shrink before that happens and expand after, which is why a quiet stretch is often the setup rather than the absence of one.`,
      `Markets price information before most people hear it, and the first sign is rarely a headline. It is usually a change in how the stock behaves: ranges tighten, volume shifts, price starts leaning on a level. None of that proves a story. It is the reason to go looking for one.`
    ], seed));
    paras.push(`${c.relVol != null ? `Volume is running ${Number(c.relVol).toFixed(1)}x normal, which matters because a break on thin volume is easy to fade and a break on real volume is harder to argue with.` : 'Volume is the tiebreaker: a break on thin trading is easy to fade, and a break on real trading is harder to argue with.'} What follows is a scenario built from the stock's own range, not a forecast.`);
  } else {
    paras.push(pick([
      `Equal highs and equal lows look like support and resistance to a retail trader and like an invoice to everyone else: they mark where stop orders cluster, and a stop is just resting liquidity. A sweep trades through that cluster, fills the orders, and then price closes back inside. When the next candle breaks structure in the opposite direction, the sequence reads as liquidity taken, then direction chosen.`,
      `Auction logic helps here. Price moves toward liquidity and away from it. A stop run is price visiting liquidity; a break of structure is it leaving. The sequence is common enough to be a pattern and uncommon enough to be worth a headline.`
    ], seed));
    const bos = c.smc && c.smc.structure && c.smc.structure[0];
    paras.push(`${bos ? `The break registered at ${px(bos.level)}, ${bos.dir > 0 ? 'upward' : 'downward'}` : 'The structure read is recent'}${c.smc && c.smc.sweeps && c.smc.sweeps[0] ? `, after the sweep at ${px(c.smc.sweeps[0].level)}` : ''}. ${pick([`Patterns are only patterns until they cost somebody money, so the invalidation level matters more than the story.`, `A sequence is a hypothesis with a stop attached, nothing more.`], seed + 1)}`);
  }
  return paras;
}

/* the steelman: every piece argues against itself before it closes */
function counter(st, c, seed = 0) {
  const S = '$' + c.symbol;
  const v = {
    gamma: [`The honest objection: open interest shows contracts, not who holds which side, so every gamma map is an inference. Flows also get absorbed by liquidity, and the strongest-looking wall can be passed without a ripple. Treat the model as a probability tilt rather than a mechanism you can set your watch by.`, `Skeptics will say dealer positioning is a story told after the fact. Fair: the data cannot see the hedges themselves. The test is whether price behaves as the map implies near the walls, and the invalidation below says how long to wait for that.`],
    short: [`The honest objection: short volume is not a position. A high ratio is routine for liquid names, and shorts are sometimes simply right. A stock that fails at resistance with the same volume turns this whole read into a normal Tuesday.`, `Fair challenge: days to cover is a lagging, twice-a-month number, and borrow costs, not just price, decide who has to leave. Without a catalyst the spring stays compressed.`],
    earnings: [`The honest objection: one binary event outweighs any structure. Guidance can gap through every level on this page, and positioning read from price is circumstantial at best. The setup tilts odds; it does not underwrite the outcome.`, `Skeptics will point out that earnings reactions are dominated by guidance and tone, which no chart contains. They are right, which is why the invalidation here is about price behavior after the print, not a forecast of it.`],
    tape: [`The honest objection: prints do not carry intent. Off-exchange volume includes ordinary retail flow and hedges, and the tick rule misreads direction often enough to matter. A busy tape can mean a decision or a rebalance.`, `Fair challenge: size can be a hedge, a transition trade or a mistake. The read is a tilt toward accumulation, not a purchase order with a name on it.`],
    narrative: [`The honest objection: a build-up is visible in hindsight and ambiguous in real time. Plenty of quiet ranges simply stay quiet, and a stock that leans on a level can lean on it for weeks before it does anything. The read is a hypothesis with a stop attached, not a conclusion.`, `The honest objection: nothing here is a catalyst. There is no event on the page that forces the move, only a stock behaving in a way that sometimes comes before one.`],
    structure: [`The honest objection: structure-based reads suffer from selection bias, because the sweeps that worked are remembered and the ones that failed are not. The pattern is a hypothesis with a defined cost of being wrong, and that cost is the point.`, `Fair challenge: any chart can be annotated to tell any story after the fact. The discipline is to commit to the level that proves the read wrong before the move, not after it.`]
  }[st.angle] || [`Every read has limits, and this one is no exception.`];
  return pick(v, seed + 5);
}

/* one line of dry humor per piece, never about a person, never a number, never a promise */
function humor(st, c, seed = 0) {
  const v = {
    gamma: [`Dealers do not have a thesis. They have inventory and a risk manager who has not slept since Tuesday.`, `Nobody asked the dealers if they wanted to buy here. The math did, politely, then not so politely.`],
    short: [`Short sellers can be right and still get run over; the market has never once refunded a margin call.`, `Being early and being wrong look identical on a statement.`],
    earnings: [`Earnings previews are astrology with ticker symbols, so this one at least shows its work.`, `Consensus is the number everyone agrees on right up until the number prints.`],
    tape: [`The chart is a rumor. The tape is the receipt.`, `Candles are the headline. The prints are the fine print nobody scrolls to.`],
    narrative: [`A quiet stock is just a stock between opinions.`, `Nobody scheduled the breakout, which is exactly why it keeps surprising people who wait for the invitation.`],
    structure: [`Stops are just IOUs with a trigger price, and sometimes the market comes to collect.`, `Support and resistance are the market's way of leaving a note for itself.`]
  }[st.angle] || [`The market is allowed to be funny. It rarely is on purpose.`];
  return pick(v, seed + 9);
}

/* the data behind the headline, for the stat tiles: label + value, nothing the draft does not already contain */
function keyStat(st, c) {
  const g = c.gamma || {}, sh = c.short || {}, t = c.tape || {}, e = c.earnings || {};
  if (st.angle === 'gamma' && g.callWall && g.callWall.strike) return { label: 'CALL WALL', value: px(g.callWall.strike) };
  if (st.angle === 'short' && sh.ratio != null) return { label: 'SHORT VOLUME', value: Math.round(sh.ratio * 100) + '%' };
  if (st.angle === 'earnings' && e.impliedPct != null) return { label: 'IMPLIED MOVE', value: '±' + e.impliedPct + '%' };
  if (st.angle === 'earnings' && e.date) return { label: 'REPORTS', value: String(e.date).slice(5) };
  if (st.angle === 'tape' && t.offSharePct != null) return { label: 'OFF-EXCHANGE', value: Math.round(t.offSharePct) + '%' };
  const bos = c.smc && c.smc.structure && c.smc.structure[0];
  if (bos) return { label: 'STRUCTURE', value: px(bos.level) };
  return null;
}

module.exports = { dek, mechanism, counter, humor, keyStat, KICKER };
