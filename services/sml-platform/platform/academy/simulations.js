'use strict';

/* Every drill is educational and probabilistic. Pattern names describe shapes,
 * not promises; tape events can be spoofed, hidden, delayed, or misclassified. */
const PATTERN_GROUPS = Object.freeze({
  'Continuation patterns': ['Bull Flag','Bear Flag','Bull Pennant','Bear Pennant','Ascending Triangle','Descending Triangle','Rectangle / Channel','Rising Channel','Falling Channel','Cup and Handle','Rising Wedge','Falling Wedge'],
  'Reversal patterns': ['Head and Shoulders','Inverse Head and Shoulders','Double Top','Double Bottom','Triple Top','Triple Bottom','Rounding Bottom','Rounding Top','Diamond Top','Diamond Bottom','Broadening Top'],
  'Bullish candlestick patterns': ['Hammer','Inverted Hammer','Bullish Engulfing','Morning Star','Piercing Line','Three White Soldiers','Dragonfly Doji','Tweezer Bottom','Bullish Harami','Rising Three Methods'],
  'Bearish candlestick patterns': ['Shooting Star','Hanging Man','Bearish Engulfing','Evening Star','Dark Cloud Cover','Three Black Crows','Gravestone Doji','Tweezer Top','Bearish Harami','Falling Three Methods'],
  'Neutral or indecision patterns': ['Doji','Spinning Top','Long-Legged Doji','Inside Bar','Outside Bar','Symmetrical Triangle'],
  'Market structure and levels': ['Higher highs / higher lows','Lower highs / lower lows','Break of Structure','Support & Resistance Zones','Supply & Demand Zones','Trendline Breaks','Gap Up / Gap Down','Island Reversal','Consolidation / Base','Measured Move','Fibonacci 23.6 / 38.2 / 50 / 61.8 / 78.6','VWAP reclaim / rejection'],
  'Momentum and breakout conditions': ['Flat Top Breakout','TTM Squeeze','Volume Climax','Running Halt / Circuit Breaker','First Red Day','Parabolic Move']
});

const PATTERN_LIBRARY = Object.freeze(Object.entries(PATTERN_GROUPS).flatMap(([family, names]) =>
  names.map((name) => ({
    name, family,
    teaching: `${name} is a visual hypothesis in the ${family.toLowerCase()} family. Validate it with location, prior trend, volume, liquidity, timeframe, confirmation, and a defined invalidation; the shape alone has no predictive guarantee.`
  }))));

const OPTION_STRATEGIES = Object.freeze([
  ['Long call','Defined-risk bullish exposure','Premium can expire worthless; volatility and time decay matter'],
  ['Long put','Defined-risk bearish or hedge exposure','Premium can expire worthless; timing and volatility matter'],
  ['Covered call','Shares plus a short call for premium','Caps upside; stock downside remains'],
  ['Cash-secured put','Short put backed by cash for possible assignment','Large downside and assignment risk; not passive or guaranteed income'],
  ['Protective put','Shares plus a long put','Insurance costs premium and creates drag'],
  ['Collar','Shares, long put, short call','Defines a range but caps upside'],
  ['Bull call debit spread','Long lower-strike call, short higher-strike call','Defined loss and capped gain'],
  ['Bear put debit spread','Long higher-strike put, short lower-strike put','Defined loss and capped gain'],
  ['Bull put credit spread','Short higher-strike put, long lower-strike put','Assignment and gap risk remain within defined width'],
  ['Bear call credit spread','Short lower-strike call, long higher-strike call','Defined but potentially rapid loss near expiration'],
  ['Iron condor','Put credit spread plus call credit spread','Range thesis; short-gamma and gap risk'],
  ['Long straddle','Long call and put at the same strike','Needs a large move or volatility repricing to overcome two premiums'],
  ['Long strangle','Long out-of-the-money call and put','Cheaper than a straddle but needs a larger move'],
  ['Calendar spread','Long later expiry, short nearer expiry','Term-structure, assignment, and volatility risks'],
  ['Diagonal spread','Different strikes and expiries','Directional, time, volatility, and assignment risks interact'],
  ['Butterfly','Two spreads centered near a target strike','Narrow payoff zone and execution complexity'],
  ['Ratio spread','Unequal option quantities','Can introduce undefined or unexpectedly large tail risk']
].map(([name, use, risk]) => ({ name, use, risk })));

const TAPE_EVENTS = Object.freeze([
  ['Offers repeatedly lift while prints accelerate','Aggressive buyers are accepting higher prices','Bullish evidence only if price advances and supply does not replenish'],
  ['Large selling prints but price stops falling','Possible bid absorption','Could be hidden liquidity or temporary support; wait for reclaim/follow-through'],
  ['Bid size flashes and cancels before trades','Possible spoofing or ordinary quote updates','Displayed size is not executed demand and must not be trusted alone'],
  ['Fast green prints with no price progress','Possible buyer exhaustion or heavy offer absorption','Momentum can fail despite impressive tape speed'],
  ['Breakout prints above a level, then immediate trade back inside','Failed break or liquidity sweep','Treat acceptance back in range as contrary evidence'],
  ['Spread tightens, bids replenish, offers thin near a known level','Improving short-term auction conditions','A rally remains conditional on executed buying and confirmation'],
  ['Spread widens after a halt or news shock','Price discovery is impaired','Reduce size or wait; fills and stops may be far from quotes'],
  ['Repeated same-price prints without displayed size','Possible iceberg or fragmented/hidden execution','Infer cautiously; venue and reporting rules obscure intent']
].map(([snapshot, reading, caveat]) => ({ snapshot, reading, caveat })));

const special = {
  '3:1': { type: 'pattern-lab', title: 'Full Pattern Recognition Lab', rounds: PATTERN_LIBRARY.map((item) => ({
    prompt: `Classify: ${item.name}`,
    display: item.teaching,
    options: Object.fromEntries(Object.keys(PATTERN_GROUPS).map((family, index) => [String.fromCharCode(65 + index), family])),
    correct: String.fromCharCode(65 + Object.keys(PATTERN_GROUPS).indexOf(item.family)),
    explanation: `${item.name} belongs to ${item.family}. Context and confirmation matter more than the label.`
  })) },
  '7:1': { type: 'trade-box', title: 'Box the Trade', rounds: [
    { prompt: 'Before entry, what belongs inside the trade box?', display: 'Thesis → trigger → entry zone → invalidation → target(s) → time stop → size → maximum dollar loss → catalyst/liquidity risks.', options: { A:'Only a price target', B:'A complete precommitted plan', C:'A social-media consensus', D:'Averaging-down permission' }, correct:'B', explanation:'A boxed trade defines the decision and its boundaries before emotion arrives.' },
    { prompt: 'Account $10,000; max risk 0.5%; entry $5.00; invalidation $4.75. Maximum theoretical shares before slippage?', display: 'Dollar risk = account × risk fraction. Shares = dollar risk ÷ planned loss per share.', options: { A:'50', B:'100', C:'200', D:'400' }, correct:'C', explanation:'$50 risk divided by $0.25 equals 200 shares; real size may be lower for gaps, spread, and slippage.' },
    { prompt: 'The thesis depends on same-day follow-through, but price stalls until the close. Which box rule applies?', display: 'Price stops and time stops answer different failure modes.', options: { A:'Ignore the clock', B:'Use the preplanned time stop', C:'Double size', D:'Move invalidation lower' }, correct:'B', explanation:'A time-dependent thesis can fail even without touching the price invalidation.' }
  ] },
  '9:1': { type: 'options-builder', title: 'Options Strategy Builder', rounds: OPTION_STRATEGIES.map((item, index) => ({
    prompt: `Which description best matches ${item.name}?`,
    display: `${item.use}. Risk: ${item.risk}. Options premium is not guaranteed or passive income.`,
    options: { A:item.use, B:'Guaranteed monthly income', C:'No assignment or tail risk', D:'A strategy whose outcome ignores volatility and time' },
    correct:'A', explanation:`${item.name}: ${item.use}. ${item.risk}.`
  })) },
  '9:2': { type: 'greeks-lab', title: 'Greeks and Volatility Lab', rounds: [
    { prompt:'A near-expiry option sits near its strike. Which sensitivity can change delta fastest?', display:'Price, time, and implied volatility jointly change the Greeks.', options:{ A:'Gamma', B:'Dividend yield only', C:'Book value', D:'Revenue growth' }, correct:'A', explanation:'Gamma measures how delta changes with the underlying.' },
    { prompt:'Implied volatility rises while price and time are held roughly constant. Which long-option sensitivity is most direct?', display:'Vega is model sensitivity to implied volatility, not a promised P&L.', options:{ A:'Theta', B:'Vega', C:'Rho only', D:'Inventory turnover' }, correct:'B', explanation:'Positive vega generally benefits a long option when implied volatility rises.' },
    { prompt:'Why can short-premium “income” suffer abrupt losses?', display:'Premium collection exchanges frequent small credits for contingent obligations.', options:{ A:'Tail moves and short gamma', B:'Premium is guaranteed', C:'Assignment is impossible', D:'Spreads never gap' }, correct:'A', explanation:'Gap, volatility, liquidity, and assignment risks can overwhelm many small credits.' }
  ] },
  '10:1': { type: 'tape-replay', title: 'Day-Trading Tape Reading Replay', rounds: TAPE_EVENTS.map((item) => ({
    prompt:'What is the disciplined reading of this tape event?', display:item.snapshot,
    options:{ A:item.reading, B:'A guaranteed next move', C:'Proof that displayed orders cannot cancel', D:'A reason to ignore price and risk limits' },
    correct:'A', explanation:`${item.reading}. Caveat: ${item.caveat}.`
  })) },
  '10:2': { type: 'rally-checklist', title: 'Probabilistic Rally Setup Lab', rounds: [
    { prompt:'Which combination is stronger evidence than green prints alone?', display:'Known level + catalyst/context + relative volume + offers lifting + bid replenishment + tight spread + price acceptance.', options:{ A:'One large displayed bid', B:'Confluence with executed buying and follow-through', C:'A chat message', D:'A single uptick' }, correct:'B', explanation:'Confluence improves a hypothesis but never guarantees a rally.' },
    { prompt:'Offers lift rapidly, but price cannot clear resistance and green prints slow. Best interpretation?', display:'Read the response to aggression, not merely its color.', options:{ A:'Guaranteed breakout', B:'Possible absorption/exhaustion; wait or reduce', C:'Buy because prints are green', D:'Ignore the level' }, correct:'B', explanation:'Aggressive buying without progress can reveal supply.' },
    { prompt:'Which event invalidates a long scalp built on acceptance above VWAP?', display:'The setup needs sustained trade above VWAP with supportive order flow.', options:{ A:'Clean loss of VWAP with failed reclaim', B:'One trade at the ask', C:'A wider watchlist', D:'A bullish emoji' }, correct:'A', explanation:'Loss and failed reclaim contradict the stated setup.' }
  ] },
  '11:2': { type: 'case-study', title: 'Grandmaster-Obi Alert Audit', rounds: [
    { prompt:'How should a timestamped Grandmaster-Obi alert be evaluated without hindsight bias?', display:'Freeze information at alert time: timestamp, quoted entry, spread, liquidity, float, catalyst, target, invalidation, and available size.', options:{ A:'Use only the later high', B:'Use contemporaneous evidence and executable prices', C:'Assume every follower filled', D:'Discard losing/open alerts' }, correct:'B', explanation:'An alert is not an execution; evaluation needs the information and liquidity available then.' },
    { prompt:'Which scorecard is complete?', display:'Track maximum favorable excursion, maximum adverse excursion, time to each, slippage, halt exposure, outcome rule, and open/closed status.', options:{ A:'Peak gain only', B:'Full path plus predeclared rules', C:'Screenshots without timestamps', D:'Only winners' }, correct:'B', explanation:'Path and rules prevent cherry-picking and separate alert quality from fill quality.' },
    { prompt:'A target is reached after a severe drawdown and thin trading. What must the review say?', display:'Process evaluation must include feasibility and risk, not only the final peak.', options:{ A:'Only report the peak', B:'Report drawdown, liquidity, time, and execution constraints', C:'Call it guaranteed', D:'Remove the adverse period' }, correct:'B', explanation:'Transparent analysis reports both favorable and adverse excursion.' }
  ] }
};

function defaultSimulation(lesson) {
  return { type: 'scenario', title: `${lesson.title} Decision Lab`, rounds: [
    { prompt: lesson.question.prompt, display: lesson.steps[2], options: lesson.question.options, correct: lesson.question.correct, explanation: lesson.question.explanation },
    { prompt: 'Which research habit best applies this lesson?', display: lesson.description, options: { A:'Define evidence, uncertainty, and invalidation', B:'Treat one observation as proof', C:'Ignore execution and costs', D:'Promise an outcome' }, correct:'A', explanation:'College-level market work is conditional, sourced, and falsifiable.' },
    { prompt: 'What should happen when new evidence contradicts the setup?', display: 'A simulation is successful when the learner follows process, including when the best action is no trade.', options: { A:'Increase conviction automatically', B:'Reassess or exit under the predeclared rule', C:'Hide the evidence', D:'Move every risk limit' }, correct:'B', explanation:'Predeclared invalidation protects the process from outcome bias.' }
  ] };
}

function simulationFor(lesson) { return special[`${lesson.moduleId}:${lesson.lessonId}`] || defaultSimulation(lesson); }

module.exports = { PATTERN_GROUPS, PATTERN_LIBRARY, OPTION_STRATEGIES, TAPE_EVENTS, simulationFor };
