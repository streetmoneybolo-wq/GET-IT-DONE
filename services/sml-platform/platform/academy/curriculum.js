'use strict';

/* Original StockMarketLoop Academy material. It never ingests the legacy
 * Investing Essentials category and is educational, not financial advice. */
const LEVEL_COLOR = { Foundation: 0x00E676, Intermediate: 0xFFB400, Advanced: 0xFF3D3D };
function L(moduleId, lessonId, title, description, level, steps, prompt, options, correct, explanation, duration = '20 min') {
  return { moduleId, lessonId, title, description, duration, level, color: LEVEL_COLOR[level], steps,
    question: { prompt, options, correct, explanation } };
}

const SEED_LESSONS = [
  L(1, 1, 'Market Structure and Price Discovery', 'Model the continuous auction that produces observable prices.', 'Foundation', [
    'Limit orders supply displayed liquidity; marketable orders consume it. The last price records a completed agreement, not a forecast.',
    'The national best bid and offer aggregates displayed venues, but hidden orders, odd lots, latency, and routing leave the visible book incomplete.',
    'Chart lab: compare spreads and top-of-book size for a liquid large-cap and a thin small-cap; explain the cost of immediacy.'
  ], 'What does the last traded price represent?', { A: 'A guaranteed next price', B: 'The most recent completed transaction', C: 'Intrinsic value', D: 'Every venue midpoint' }, 'B', 'It is historical evidence of one trade; the next order can transact elsewhere.'),
  L(1, 2, 'Order Types, Routing, and Execution Quality', 'Evaluate certainty, price control, speed, slippage, and market impact.', 'Foundation', [
    'Market orders prioritize execution, while limit orders control the worst acceptable price but may not fill. Stops activate only after a trigger.',
    'Execution quality includes effective spread, improvement, fill probability, latency, adverse selection, and impact. Commission-free is not cost-free.',
    'Chart lab: inspect a fast candle and explain why a triggered stop can fill away from the displayed quote.'
  ], 'Which order provides price control but no execution guarantee?', { A: 'Market', B: 'Limit', C: 'Unpriced stop', D: 'Market-on-close' }, 'B', 'The limit defines an acceptable boundary, but sufficient contra-side liquidity may never arrive.'),

  L(2, 1, 'OHLCV, Candles, and Sampling', 'Interpret candles as interval summaries with path information removed.', 'Foundation', [
    'A candle compresses trades into open, high, low, close, and volume. Its body spans open to close; wicks show observed extremes.',
    'Aggregation changes apparent patterns. A daily candle can conceal the sequence visible in five-minute or one-minute data.',
    'Chart lab: compare one symbol across three intervals and list conclusions that disappear when the sampling window changes.'
  ], 'Why can identical daily candles hide different behavior?', { A: 'OHLC omits the path between summary points', B: 'The close is estimated', C: 'The open never trades', D: 'Volume has no units' }, 'A', 'OHLC preserves endpoints and extremes but discards the order of most trades.'),
  L(2, 2, 'Returns, Volatility, and Distribution Shape', 'Compute returns and assess dispersion, tails, skew, and regime dependence.', 'Intermediate', [
    'Simple return is ending value divided by starting value minus one. Log returns add through time but are not simple portfolio returns.',
    'Volatility measures dispersion, not loss. Returns often have fat tails, skew, clustering, and regime changes that weaken normal assumptions.',
    'Quant lab: calculate three bar returns, their mean, and sample deviation; show how one outlier changes both.'
  ], 'A price rises 10% and then falls 10%. What is the total return?', { A: '0%', B: '-1%', C: '+1%', D: '-10%' }, 'B', '1.10 multiplied by 0.90 equals 0.99, a 1% loss.'),

  L(3, 1, 'Trend, Support, Resistance, and Regime', 'Treat technical levels as probabilistic zones conditioned on regime.', 'Foundation', [
    'Trend is persistent direction, not a straight line. Support and resistance are zones of prior order-flow change, not guaranteed barriers.',
    'Breakouts require context: range duration, participation, volatility, liquidity, and follow-through. False breaks are normal.',
    'Chart lab: mark a zone with three prior interactions, define invalidation, and compare trending with range-bound behavior.'
  ], 'What is disciplined when price revisits support?', { A: 'Assume a bounce', B: 'Wait for evidence and define invalidation', C: 'Assume a break', D: 'Remove risk controls' }, 'B', 'Historical reactions focus attention but do not guarantee the next outcome.'),
  L(3, 2, 'Volume, Momentum, and Indicator Construction', 'Understand indicator formulas, information loss, and parameter sensitivity.', 'Intermediate', [
    'Moving averages smooth weighted observations. RSI transforms average gains and losses. Indicators reorganize inputs; they do not create information.',
    'Volume needs normalization for time of day, float, and usual activity. Raw comparisons across securities can mislead.',
    'Chart lab: add two indicators, state each formula in plain language, and name a regime in which each will lag.'
  ], 'Why do two RSI lookbacks disagree?', { A: 'RSI is random', B: 'Lookback changes the sample and sensitivity', C: 'Price has two closes', D: 'Volume replaces price' }, 'B', 'Shorter samples react faster and usually contain more noise.'),

  L(4, 1, 'Financial Statements and Accounting Linkages', 'Connect the income statement, balance sheet, and cash-flow statement.', 'Intermediate', [
    'Income measures a period, the balance sheet a point in time, and cash flow reconciles earnings with cash movement.',
    'Net income affects retained earnings; non-cash expenses and working capital reconcile earnings to operating cash flow.',
    'Filings lab: trace one material 10-Q change through all three statements and classify recurring versus financing effects.'
  ], 'An increase in receivables, all else equal, does what to operating cash flow?', { A: 'Raises it', B: 'Lowers it', C: 'Has no effect', D: 'Doubles it' }, 'B', 'Recognized but uncollected revenue increases receivables and is subtracted in the cash-flow reconciliation.'),
  L(4, 2, 'Earnings Quality and Ratio Analysis', 'Use margins, returns, leverage, and cash conversion as a connected system.', 'Intermediate', [
    'Margins describe economics at different layers. Return on invested capital compares after-tax operating profit with required capital.',
    'Quality improves when repeatable cash supports profit; accruals, stock compensation, one-time items, and capitalization need scrutiny.',
    'Filings lab: build a five-year table of growth, margin, free cash flow, dilution, and debt and explain the economic story.'
  ], 'Which most challenges earnings quality?', { A: 'Cash persistently trails profit without explanation', B: 'Revenue and cash both grow', C: 'Debt falls', D: 'Margins stabilize' }, 'A', 'A persistent profit-to-cash gap may signal aggressive accruals or weakening working-capital economics.'),

  L(5, 1, 'Time Value of Money and Discounted Cash Flow', 'Translate uncertain future cash flows into present-value scenarios.', 'Intermediate', [
    'Discounting reflects time, opportunity cost, and risk. Present value divides each expected cash flow by a compounded required return.',
    'DCF results depend on growth, margins, reinvestment, discount rate, and terminal assumptions; the model is conditional, not objective truth.',
    'Valuation lab: build bear, base, and bull paths plus a discount-rate and terminal-growth sensitivity table.'
  ], 'If the discount rate rises and forecasts do not change, present value generally?', { A: 'Rises', B: 'Falls', C: 'Stays fixed', D: 'Becomes revenue' }, 'B', 'A higher required return applies a larger discount to future cash flows.'),
  L(5, 2, 'Multiples, Expectations, and Reverse Valuation', 'Normalize comparisons and infer assumptions embedded in market prices.', 'Intermediate', [
    'Multiples compress models: P/E uses equity earnings, EV/EBITDA uses enterprise value and an operating proxy, and sales ignores costs.',
    'Comparability requires aligned accounting, mix, growth, margin, cyclicality, intensity, and risk. A low multiple can reflect deterioration.',
    'Valuation lab: reverse-engineer the growth and margin path required by today’s enterprise value.'
  ], 'Why is a lower P/E not automatically cheaper?', { A: 'P/E excludes price', B: 'It can reflect weaker growth or higher risk', C: 'All earnings are cash', D: 'Exchanges fix it' }, 'B', 'A multiple reflects expectations and risk, not merely arithmetic cheapness.'),

  L(6, 1, 'Rates, Inflation, and Liquidity Transmission', 'Trace monetary conditions through financing, currencies, cash flows, and valuation.', 'Intermediate', [
    'Policy rates shape short funding and the yield curve; real rates approximate nominal yields minus expected inflation.',
    'Inflation contains demand, wages, shelter, energy, supply, and expectations. Firms differ in pricing power and input sensitivity.',
    'Macro lab: map a rate shock through a bank, leveraged small-cap, long-duration growth firm, and commodity producer.'
  ], 'Why are distant cash flows often more rate-sensitive?', { A: 'They face more discounting periods', B: 'They are already cash', C: 'Rates only affect banks', D: 'Inflation guarantees growth' }, 'A', 'The rate effect compounds over more periods.'),
  L(6, 2, 'Business Cycles, Correlation, and Regime Shifts', 'Analyze growth, inflation, credit, and liquidity as changing regimes.', 'Advanced', [
    'Cycles affect sales, defaults, inventories, labor, and policy with different lags; markets can anticipate turns before official data.',
    'Correlation is conditional. Diversifiers can converge during deleveraging and liquidity stress.',
    'Macro lab: build a growth-inflation regime matrix and define evidence that would trigger a transition.'
  ], 'What weakens a fixed historical correlation assumption?', { A: 'Correlation has no units', B: 'Relationships change across regimes', C: 'Prices never co-move', D: 'Only bonds correlate' }, 'B', 'Correlation is sample-dependent and can shift sharply under new policy or volatility.'),

  L(7, 1, 'Position Sizing, Expectancy, and Risk of Ruin', 'Connect loss limits and payoff distributions to long-run survival.', 'Intermediate', [
    'Size follows a loss budget and invalidation point: maximum dollar risk divided by planned risk per share, before gaps and slippage.',
    'Expectancy equals win probability times average win minus loss probability times average loss; positive expectancy still has drawdowns.',
    'Risk lab: simulate 100 trades and compare fixed-dollar, fixed-fractional, and oversized exposure paths.'
  ], 'A system wins 40% at 2R and loses 60% at 1R. Expectancy is?', { A: '-0.2R', B: '0R', C: '+0.2R', D: '+1.4R' }, 'C', '0.40×2 minus 0.60×1 equals +0.20R before costs.'),
  L(7, 2, 'Portfolio Risk, Diversification, and Drawdown', 'Measure covariance, concentration, beta, tracking error, and stress loss.', 'Advanced', [
    'Portfolio variance depends on weights, individual variance, and covariance. Ten tickers with one factor can be one concentrated bet.',
    'Beta, tracking error, and peak-to-trough drawdown answer different questions and should not be treated as substitutes.',
    'Risk lab: group exposures by factor and stress simultaneous equity, rate, volatility, and liquidity shocks.'
  ], 'When is diversification most helpful, all else equal?', { A: 'Perfect positive correlation', B: 'Lower correlation', C: 'Every weight above 100%', D: 'Ignored volatility' }, 'B', 'Lower covariance reduces total variance, though correlations can rise during stress.'),

  L(8, 1, 'Probability, Base Rates, and Bayesian Updating', 'Replace binary calls with conditional probabilities updated by evidence.', 'Advanced', [
    'A base rate is the prior frequency in a relevant reference class. Ignoring it makes vivid but weak evidence look decisive.',
    'Bayesian updating weighs evidence by its likelihood under competing hypotheses; diagnostic evidence changes beliefs more.',
    'Statistics lab: estimate a breakout base rate and update it with a defined confirmation signal.'
  ], 'To update after a noisy signal, what is essential?', { A: 'Only the ticker', B: 'Signal likelihood under event and non-event cases', C: 'Candle color', D: 'An opinion' }, 'B', 'True- and false-positive behavior determine how diagnostic a signal is.'),
  L(8, 2, 'Backtesting, Inference, and Research Bias', 'Design tests resistant to leakage, overfitting, survivorship, and false discovery.', 'Advanced', [
    'Valid backtests need point-in-time data, delistings, realistic execution, costs, and rules fixed before evaluation.',
    'Look-ahead uses unavailable information; survivorship removes failures; repeated searches inflate lucky results.',
    'Statistics lab: separate train, validation, and untouched test periods and report confidence, turnover, and drawdown.'
  ], 'What does walk-forward testing approximate?', { A: 'Using future data', B: 'Sequential fitting and out-of-sample evaluation', C: 'Removing losses', D: 'Guaranteed significance' }, 'B', 'It preserves time order and tests on observations not used in the immediately preceding fit.'),

  L(9, 1, 'Options Payoffs and No-Arbitrage Foundations', 'Analyze calls, puts, parity, moneyness, and expiration payoffs.', 'Advanced', [
    'Calls grant a right to buy and puts a right to sell at the strike; buyers pay premium and sellers accept contingent obligations.',
    'Intrinsic and time value differ. Put-call parity links European options, stock, strike, rates, and dividends under no-arbitrage.',
    'Options lab: draw payoffs for a long call, long put, covered call, and vertical spread with break-even and maximum loss.'
  ], 'A $50-strike call expires with stock at $57. Intrinsic value?', { A: '$0', B: '$5', C: '$7', D: '$57' }, 'C', 'Call intrinsic value is max(stock minus strike, zero).'),
  L(9, 2, 'Greeks, Implied Volatility, and Volatility Surfaces', 'Explain nonlinear option sensitivities and volatility pricing.', 'Advanced', [
    'Delta measures underlying sensitivity, gamma delta curvature, theta time decay, vega implied-volatility sensitivity, and rho rate sensitivity.',
    'Greeks change with price, time, and volatility. Implied volatility is the input consistent with price, not guaranteed realized volatility.',
    'Options lab: compare strikes and expirations and explain skew using event risk, crash demand, supply, and leverage.'
  ], 'Why can a short-dated at-the-money option have high gamma?', { A: 'Delta changes rapidly with small moves', B: 'It has no theta', C: 'Its strike changes', D: 'It owns shares' }, 'A', 'Near strike and expiration, small moves materially change exercise probability and delta.'),

  L(10, 1, 'Short Selling, Borrow, and Squeeze Mechanics', 'Study borrow constraints and feedback loops without assuming a squeeze.', 'Advanced', [
    'Short sellers borrow, sell, and later repurchase shares; risks include unbounded price loss, fees, recalls, dividends, and forced liquidation.',
    'Price increases can pressure risk limits, covering adds demand, options hedging can amplify flow, and thin liquidity magnifies orders.',
    'Microstructure lab: separate short interest, days-to-cover, borrow cost, float, options, and volume; no one metric proves a squeeze.'
  ], 'Why can rising price accelerate a squeeze?', { A: 'Losses can force covering into limited liquidity', B: 'Shorts become dividends', C: 'Asks are canceled', D: 'Float becomes infinite' }, 'A', 'Risk limits can turn covering into new demand, creating feedback.'),
  L(10, 2, 'Capital Structure, Dilution, and Financing Risk', 'Map senior claims and quantify changes to per-share economics.', 'Advanced', [
    'Enterprise value spans equity, debt, cash, preferred claims, and obligations; common equity is residual.',
    'ATM programs, warrants, convertibles, options, and acquisitions can increase diluted shares even if financing creates value.',
    'Filings lab: reconcile basic and diluted shares, authorized shares, warrants, convertibles, and financing documents.'
  ], 'New shares are issued while total equity value is unchanged. Per-share value?', { A: 'Rises', B: 'Falls', C: 'Becomes debt', D: 'Cannot change' }, 'B', 'The same aggregate value is divided among more shares.'),

  L(11, 1, 'Filings, Catalysts, and Evidence Hierarchy', 'Build research from primary documents and timestamped evidence.', 'Intermediate', [
    'Primary evidence includes filings, audited statements, court records, exchange notices, and company releases.',
    'A catalyst must connect an event to cash flow, risk, positioning, or constraints and may already be priced.',
    'Research lab: table each claim, source, publication time, uncertainty, and thesis variable affected.'
  ], 'Strongest source for registered offering terms?', { A: 'Anonymous repost', B: 'Filed prospectus', C: 'Price chart', D: 'Uncited thread' }, 'B', 'The filed prospectus is the primary legal disclosure.'),
  L(11, 2, 'Thesis Construction, Scenarios, and Falsification', 'Write a testable causal argument with explicit failure conditions.', 'Advanced', [
    'A thesis defines variant perception, mechanism, milestones, valuation, horizon, and risk. A story without falsification is not analysis.',
    'Bear, base, and bull cases require internally consistent operations and valuation, not just different price targets.',
    'Research lab: write the strongest rebuttal and observable disconfirming evidence before reviewing price action.'
  ], 'What makes a thesis falsifiable?', { A: 'It explains everything', B: 'It states evidence that would show it wrong', C: 'It sounds confident', D: 'It has a target' }, 'B', 'Falsification specifies conditions requiring rejection or revision.'),

  L(12, 1, 'Behavioral Bias and Decision Architecture', 'Design processes that reduce confirmation, anchoring, loss, and recency bias.', 'Intermediate', [
    'Confirmation favors support, anchoring overweights first numbers, loss aversion delays exits, and recency extrapolates the latest regime.',
    'Checklists, base rates, precommitment, independent review, and limits alter the decision environment more than awareness alone.',
    'Process lab: grade three decisions using only information available at the time, separating decision quality from outcome.'
  ], 'A profitable rule-breaking trade demonstrates?', { A: 'Good process', B: 'A favorable outcome that may follow poor process', C: 'Guaranteed skill', D: 'No risk' }, 'B', 'Outcome bias can mistake luck for decision quality.'),
  L(12, 2, 'Crowds, Narratives, and Strategic Interaction', 'Analyze incentives, positioning, reflexivity, and crowded exits.', 'Advanced', [
    'Participants respond to fundamentals and expectations about others. Crowding can create momentum and fragility simultaneously.',
    'Reflexivity occurs when price influences financing and behavior, which alters fundamentals and feeds back into price.',
    'Behavior lab: map investors, dealers, insiders, lenders, and management by incentives and response to three price paths.'
  ], 'Why can a popular bullish narrative increase fragility?', { A: 'Crowding leaves fewer buyers and congested exits', B: 'Narratives remove risk', C: 'Horizons become identical', D: 'Prices stop' }, 'A', 'Aligned exposure can make reversal sharper when evidence or liquidity changes.'),

  L(13, 1, 'Strategy Design, Execution, and Monitoring', 'Convert a hypothesis into rules, controls, measurement, and governance.', 'Advanced', [
    'A specification defines universe, signal, entry, exit, sizing, constraints, costs, timing, exceptions, and shutdown conditions.',
    'Latency, spread, partial fills, borrow, capacity, impact, outages, and regime drift can erase paper edge.',
    'Systems lab: write a versioned strategy card and separate research metrics from live risk controls.'
  ], 'Purpose of a strategy kill switch?', { A: 'Increase leverage', B: 'Halt when safety or validity conditions fail', C: 'Hide losses', D: 'Optimize history' }, 'B', 'It limits damage when data, execution, risk, or assumptions become unreliable.'),
  L(13, 2, 'Capstone: Investment Committee Defense', 'Integrate evidence, valuation, risk, execution, and ethics in a defended analysis.', 'Advanced', [
    'Submit primary sources, market-structure review, financial model, scenarios, catalyst timeline, risk map, and falsification rules.',
    'Present the thesis and strongest rebuttal; quantify uncertainty, disclose conflicts, distinguish fact from inference, and promise no returns.',
    'Capstone lab: defend the work before a mock risk committee, answer adversarial questions, revise weak claims, and grade process.'
  ], 'Which satisfies the capstone standard?', { A: 'Unsourced target', B: 'Sourced scenario thesis with risks and falsification', C: 'Viral screenshot', D: 'Guaranteed return' }, 'B', 'College-level analysis is sourced, conditional, numerate, transparent, and open to disconfirmation.', '30 min')
];

module.exports = { SEED_LESSONS };
