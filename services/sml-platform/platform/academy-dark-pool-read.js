'use strict';

/* The plain-English read of a session's off-exchange prints, written for a member who sees "$769.12 × 500,000 · $384M"
 * and asks what it means. It turns the session summary (academy-dark-pool-session.js) and the memory of recent
 * sessions into a headline, a verdict, and numbered steps a member can follow, and it compares today's biggest print
 * with yesterday's. It never claims to know who traded: a block is a block, the direction is the tick rule, and the
 * caveat stays attached. */

const fin = Number.isFinite;
const money = (v) => (!fin(v) ? '–' : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + Math.round(v));
const whole = (v) => (fin(v) ? Math.round(v).toLocaleString('en-US') : '–');
const px = (v) => (fin(v) ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–');
const times = (a, b) => (fin(a) && fin(b) && b > 0 ? a / b : null);
const xText = (r) => (r == null ? '' : r >= 10 ? Math.round(r) + 'x' : r >= 1.95 ? r.toFixed(1).replace(/\.0$/, '') + 'x' : r >= 1.15 ? '+' + Math.round((r - 1) * 100) + '%' : r <= 0.5 ? 'under half' : r <= 0.87 ? '-' + Math.round((1 - r) * 100) + '%' : 'about the same as');

/* one session's footprint, the part worth remembering for tomorrow's comparison */
function footprint(d, { date, price = null } = {}) {
  if (!d || !d.available) return null;
  const big = d.blocks && d.blocks.list && d.blocks.list[0] ? d.blocks.list[0] : (d.largest && d.largest[0]) || null;
  return {
    date, offSharePct: fin(d.offSharePct) ? d.offSharePct : null, offVolume: fin(d.offVolume) ? d.offVolume : null,
    blockCount: d.blocks ? d.blocks.count || 0 : 0, blockVolume: d.blocks ? d.blocks.volume || 0 : 0, blockNotional: d.blocks && d.blocks.list ? d.blocks.list.reduce((n, b) => n + (b.notional || 0), 0) : 0,
    largest: big ? { price: big.price, size: big.size, notional: big.notional, dir: big.dir } : null,
    lean: d.lean && fin(d.lean.offExchange) ? d.lean.offExchange : null, price: fin(price) ? price : null, full: d.window ? d.window.full : null
  };
}

function readDarkPool(d, { history = [], price = null, vwap = null } = {}) {
  if (!d || !d.available) return null;
  const prior = (history || []).filter((h) => h && h.largest).slice(-10);
  const y = prior.length ? prior[prior.length - 1] : null;
  const big = d.blocks && d.blocks.list && d.blocks.list[0] ? d.blocks.list[0] : (d.largest && d.largest[0]) || null;
  const share = fin(d.offSharePct) ? d.offSharePct : null, typical = fin(d.typicalSharePct) ? d.typicalSharePct : 40;
  const lean = d.lean && fin(d.lean.offExchange) ? d.lean.offExchange : null;
  const ref = fin(price) && price > 0 ? price : (fin(vwap) && vwap > 0 ? vwap : null);
  const blockVol = d.blocks ? d.blocks.volume || 0 : 0, blockN = d.blocks ? d.blocks.count || 0 : 0;
  const bigVsY = y && y.largest ? times(big && big.notional, y.largest.notional) : null;
  const blocksVsY = y ? times(blockVol, y.blockVolume) : null;
  const maxPrior = prior.reduce((m, h) => Math.max(m, h.largest ? h.largest.notional : 0), 0);
  const biggestInWindow = big && prior.length >= 3 && big.notional > maxPrior;

  /* 1. what printed */
  const steps = [];
  if (big) steps.push({ k: 'WHAT PRINTED', text: `Biggest single off-exchange print: ${whole(big.size)} shares at ${px(big.price)}, about ${money(big.notional)}, ${big.dir === 'B' ? 'on an uptick (buyer lifted)' : big.dir === 'S' ? 'on a downtick (seller hit)' : 'with no tick direction'}. A print that size is one order being crossed away from the public book, not a crowd of small trades.` });
  else steps.push({ k: 'WHAT PRINTED', text: `No block-size prints (${d.blocks ? d.blocks.rule : '10,000+ shares or $1M+'}) in this window. Off-exchange volume is spread across small prints, which is what internalized retail flow looks like.` });
  /* 2. versus yesterday */
  if (y && y.largest && big) {
    const r = bigVsY;
    steps.push({ k: 'VS YESTERDAY', text: `Yesterday's biggest was ${whole(y.largest.size)} shares at ${px(y.largest.price)} (${money(y.largest.notional)}). Today's is ${r >= 1.15 || r <= 0.87 ? xText(r) + (r >= 1.15 ? ' bigger' : ' smaller') : 'about the same size'}${biggestInWindow ? ', and the largest print in the last ' + prior.length + ' sessions' : ''}. Block volume for the session is ${blocksVsY == null ? 'not comparable yet' : xText(blocksVsY) + (blocksVsY >= 1.15 ? ' more' : blocksVsY <= 0.87 ? ' less' : ' yesterday\'s')}.` });
  } else if (!y) steps.push({ k: 'VS YESTERDAY', text: 'No earlier session on record for this symbol yet; the comparison starts tomorrow.' });
  /* 3. the price it printed at */
  if (big && ref) {
    const diff = (big.price - ref) / ref * 100;
    steps.push({ k: 'WHERE', text: `It printed ${Math.abs(diff) < 0.15 ? 'right at' : diff > 0 ? Math.abs(diff).toFixed(1) + '% above' : Math.abs(diff).toFixed(1) + '% below'} the current price (${px(ref)}). ${Math.abs(diff) < 0.15 ? 'Size crossing at the market is the normal way a block gets done; it says little about direction on its own.' : diff > 0 ? 'A block above the market is usually a seller finding a buyer willing to pay up, or an earlier print being reported late.' : 'A block below the market is usually a buyer getting size at a discount, or an earlier print being reported late.'}` });
  }
  /* 4. the session's lean and share */
  const shareWord = share == null ? null : share >= typical + 10 ? 'high' : share <= typical - 15 ? 'low' : 'normal';
  const leanWord = lean == null ? 'unreadable' : lean > 0.25 ? 'buy side' : lean < -0.25 ? 'sell side' : 'balanced';
  steps.push({ k: 'THE SESSION', text: `${share == null ? 'Off-exchange share is not readable yet' : share.toFixed(0) + '% of today\'s volume printed off-exchange, ' + shareWord + ' against a typical ' + typical.toFixed(0) + '%'}. ${blockN ? blockN + ' block' + (blockN === 1 ? '' : 's') + ' make up ' + (d.blocks.sharePct != null ? d.blocks.sharePct.toFixed(0) + '% of that off-exchange volume' : whole(blockVol) + ' shares') + '. ' : ''}By the tick rule the off-exchange prints lean ${leanWord}${lean != null ? ' (' + (lean >= 0 ? '+' : '') + Math.round(lean * 100) + ')' : ''}.` });
  /* 5. what to do with it */
  let verdict, action;
  if (big && (bigVsY >= 3 || biggestInWindow) && shareWord === 'high') { verdict = 'UNUSUAL'; action = 'Size is stepping up and the share is high: treat the print price as a level. If price holds above it, the size was likely accumulation; if it loses it and cannot reclaim, the size was distribution. Do not front-run the print; let the next hour of lit volume confirm the side.'; }
  else if (big && (bigVsY >= 2 || biggestInWindow)) { verdict = 'HEAVY'; action = 'Bigger size than yesterday at a readable price. Mark the print price on the chart; a hold above it with buy-side lean supports longs, a break below it with sell-side lean says the size was leaving.'; }
  else if (shareWord === 'high' && lean != null && Math.abs(lean) > 0.25) { verdict = 'HEAVY'; action = `High off-exchange share with a ${leanWord} lean: the flow has a side today. Trade with it on the lit chart, not against it, and watch for the lean to flip.`; }
  else if (!big && shareWord !== 'high') { verdict = 'QUIET'; action = 'Nothing here changes a plan. Off-exchange activity is ordinary; use the structure map and the lit tape instead.'; }
  else { verdict = 'NORMAL'; action = `Normal footprint for this window: ${blockN === 1 ? 'one block' : blockN + ' blocks'} with a ${leanWord} lean${d.blocks && fin(d.blocks.sharePct) && d.blocks.sharePct >= 60 ? ', and most of the off-exchange volume is block-sized (working orders, not internalized retail)' : ''}. Nothing out of line for a liquid name. Note the biggest print's price as a level and move on.`; }
  steps.push({ k: 'WHAT TO DO', text: action });
  const headline = big
    ? `${verdict}: ${money(big.notional)} block at ${px(big.price)}${bigVsY != null && (bigVsY >= 1.15 || bigVsY <= 0.87) ? ', ' + xText(bigVsY) + (bigVsY >= 1.15 ? ' yesterday\'s biggest' : ' yesterday\'s biggest') : ''}${shareWord === 'high' ? ', high off-exchange share' : ''}`
    : `${verdict}: no block prints${share != null ? ', ' + share.toFixed(0) + '% off-exchange' : ''}`;
  return {
    verdict, headline, steps,
    vsYesterday: y ? { date: y.date, largest: y.largest, blockVolume: y.blockVolume, blockCount: y.blockCount, offSharePct: y.offSharePct, largestRatio: bigVsY == null ? null : Math.round(bigVsY * 100) / 100, blockVolumeRatio: blocksVsY == null ? null : Math.round(blocksVsY * 100) / 100 } : null,
    sessionsOnRecord: prior.length, biggestInWindow: !!biggestInWindow,
    glossary: [
      'Off-exchange print: a trade matched away from the public exchanges (dark pool, wholesaler or broker internalizer) and reported to the tape afterwards.',
      'Block: one print of ' + (d.blocks ? d.blocks.rule : '10,000+ shares or $1M+') + '. Blocks are how institutions move size without showing it on the book.',
      'Tick rule (▲ ▼): the print traded above or below the previous print. It hints at who was the aggressor; it does not prove it.',
      'Share: off-exchange volume as a share of all volume. Liquid names normally run 35-45%; a jump matters more than the level.'
    ]
  };
}

module.exports = { readDarkPool, footprint, money, xText };
