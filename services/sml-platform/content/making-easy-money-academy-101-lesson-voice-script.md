# Making Easy Money Academy: 101-Lesson Voice Script

## Voice-generation directions — do not read this section aloud

Use only a voice that the account owner has supplied or has permission to use. Read the spoken script naturally in a confident, conversational teaching voice. Do not imitate any third party. Target 125 to 140 words per minute. Pause briefly at headings, after questions, and between lessons. Emphasize definitions without sounding theatrical. Say ticker symbols one letter at a time when applicable. Never imply guaranteed returns. Preserve the educational-risk statements.

## Spoken script

Welcome to Making Easy Money Academy.

This is a complete guided tour through 101 interactive lessons organized across 28 modules. The purpose is not to hand you predictions. It is to teach you how markets work, how evidence should be tested, how risk should be controlled, and how professional decisions are made when the future is uncertain.

Nothing in this program is financial, legal, tax, or investment advice. Markets can move quickly. Options can expire worthless. Short positions can create substantial losses. Leverage can magnify mistakes. Every example is educational, and every simulated trade should be treated as a process exercise rather than a promise.

As you listen, pause when a question is presented. State your answer before the explanation. In the interactive Academy, complete the matching decision lab and record what evidence would change your conclusion.

## Module 1

We are beginning module 1. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 1.1: Market Structure and Price Discovery

Model the continuous auction that produces observable prices.

Here is the simple version. Maya offers to buy Pixel Pops shares at $9, her bid, and Leo offers to sell at $10, his ask. The gap between them, $1, is the spread. Maya is in a hurry, so she pays Leo's $10 ask instead of waiting, and the screen's last price becomes $10. That $10 is only a receipt for their deal, not a promise about the next trade. The middle was $9.50, so not waiting cost Maya $0.50 a share, or $50 on 100 shares.

Point 1. Limit orders supply displayed liquidity; marketable orders consume it. The last price records a completed agreement, not a forecast.

Point 2. The national best bid and offer aggregates displayed venues, but hidden orders, odd lots, latency, and routing leave the visible book incomplete.

Point 3. Chart lab: compare spreads and top-of-book size for a liquid large-cap and a thin small-cap; explain the cost of immediacy. Indicator lab: Quote-statistics panel: High, Open, Volume, Low, Prev Close, Turnover, Avg. Price, P/E (TTM), Market Cap, Amplitude, P/E LYR, Shares, Turnover Ratio, P/B, Float Cap, 52wk High, Bid/Ask Ratio, Shs Float, 52wk Low, % Volume, Min Trading Unit, Historical High, Dividend TTM, Post-Mkt Price, Historical Low, Div Yield TTM, Post-Mkt %. Distinguish intraday price fields, liquidity measures, valuation ratios, share structure, historical ranges, dividends, and post-market fields; a missing verified field remains blank rather than being estimated.

Knowledge check. What does the last traded price represent?

Option A. A guaranteed next price

Option B. The most recent completed transaction

Option C. Intrinsic value

Option D. Every venue midpoint

The best answer is option B. The most recent completed transaction. It is historical evidence of one trade; the next order can transact elsewhere.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 1.2: Order Types, Routing, and Execution Quality

Evaluate certainty, price control, speed, slippage, and market impact.

Here is the simple version. Leo wants Sunny Juice shares at $20, and a market order buys right away at whatever sellers ask. A limit order at $19.50 never pays more than that, but if no seller comes down, Leo gets nothing. Maya owns 100 shares bought at $20 with a stop at $18, so she plans to lose at most $200. Bad news makes the price gap down from $18.40 straight to $17.60, and her triggered stop turns into a market order that sells there. She loses $240, not $200, because a stop picks when to sell, not the price.

Point 1. Market orders prioritize execution, while limit orders control the worst acceptable price but may not fill. Stops activate only after a trigger.

Point 2. Execution quality includes effective spread, improvement, fill probability, latency, adverse selection, and impact. Commission-free is not cost-free.

Point 3. Chart lab: inspect a fast candle and explain why a triggered stop can fill away from the displayed quote.

Knowledge check. Which order provides price control but no execution guarantee?

Option A. Market

Option B. Limit

Option C. Unpriced stop

Option D. Market-on-close

The best answer is option B. Limit. The limit defines an acceptable boundary, but sufficient contra-side liquidity may never arrive.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 2

We are beginning module 2. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 2.1: OHLCV, Candles, and Sampling

Interpret candles as interval summaries with path information removed.

Here is the simple version. Rocket Rolls Bakery had two days that drew the exact same candle: open $10, high $12, low $9, close $11, with 1,000 shares traded. The green body runs $1 from open to close, and the whole range is $3. On Monday the price hit $12 first, crashed to $9, then climbed back to $11. On Tuesday it sank to $9 first, then rallied to $12 and settled at $11. A candle keeps four prices and the volume but throws away the path, so zoom into smaller bars to see how the day moved.

Point 1. A candle compresses trades into open, high, low, close, and volume. Its body spans open to close; wicks show observed extremes.

Point 2. Aggregation changes apparent patterns. A daily candle can conceal the sequence visible in five-minute or one-minute data.

Point 3. Chart lab: compare one symbol across three intervals and list conclusions that disappear when the sampling window changes.

Knowledge check. Why can identical daily candles hide different behavior?

Option A. OHLC omits the path between summary points

Option B. The close is estimated

Option C. The open never trades

Option D. Volume has no units

The best answer is option A. OHLC omits the path between summary points. OHLC preserves endpoints and extremes but discards the order of most trades.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 2.2: Returns, Volatility, and Distribution Shape

Compute returns and assess dispersion, tails, skew, and regime dependence.

Here is the simple version. Maya puts $100 into Cloudberry Games, and it rises 20% to $120. Then it falls 20%, but 20% of $120 is $24, so she ends at $96: a loss of 4%, not break-even. Next, Leo's shares rise 1% three days in a row, while Maya's rise 5%, fall 4%, then rise 2%. Both average 1% a day, but Maya's days swing from minus 4% to plus 5%, while Leo's never change. That swinging is volatility: it measures how widely returns scatter, not how much you lose.

Point 1. Simple return is ending value divided by starting value minus one. Log returns add through time but are not simple portfolio returns.

Point 2. Volatility measures dispersion, not loss. Returns often have fat tails, skew, clustering, and regime changes that weaken normal assumptions.

Point 3. Quant lab: calculate three bar returns, their mean, and sample deviation; show how one outlier changes both. Indicator lab: Volatility Indicators: ATR, Bollinger Bands, Keltner Channels, Standard Deviation, VIX (fear index), Historical Volatility, Implied Volatility, Chaikin Volatility, Donchian Volatility, Ulcer Index, Volatility Stop, Volatility Ratio, Range Indicator, Amplitude, True Range, Garman-Klass Volatility, Parkinson Volatility, Hurst Exponent. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed.

Knowledge check. A price rises 10% and then falls 10%. What is the total return?

Option A. 0%

Option B. -1%

Option C. +1%

Option D. -10%

The best answer is option B. -1%. 1.10 multiplied by 0.90 equals 0.99, a 1% loss.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 3

We are beginning module 3. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 3.1: Chart Patterns, Candlesticks, and Market Structure

Recognize every submitted pattern while treating each as a conditional hypothesis.

Here is the simple version. Omar draws a support line at $20 on Lantern Labs: in his notes, the price bounced there 6 times and broke through 4 times. That is 10 visits, so the line held 60% of the time, not always. Back at $20, Omar plans ahead: he buys only on a close above $21, and a close below $19 cancels the idea. If he buys at $21, a close below $19 is his exit, so he risks at least $2 a share, or $100 on 50 shares. A chart shape is a question to test, not an answer.

Point 1. The lab covers continuation, reversal, bullish, bearish, and indecision formations plus structure, Fibonacci, VWAP, squeeze, halt, climax, and parabolic conditions.

Point 2. A named shape is never a signal by itself. Location, prior trend, volume, float, liquidity, timeframe, confirmation, and invalidation determine whether it is useful.

Point 3. Chart lab: classify the complete pattern library, explain what would confirm each setup, and identify the evidence that would invalidate it. Indicator lab: Pattern & Structure Indicators: Pivot Points (Classic, Camarilla, Woodie), Fibonacci Retracement, Fibonacci Extension, Harmonic Patterns, Chart Patterns (Head & Shoulders, Triangles, Flags), Support/Resistance Zones, Market Structure Breaks, Order Blocks, Supply/Demand Zones, Price Channels, Trendlines, Wolfe Waves, Elliott Wave Counts. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed.

Knowledge check. What is disciplined when price revisits support?

Option A. Assume a bounce

Option B. Wait for evidence and define invalidation

Option C. Assume a break

Option D. Remove risk controls

The best answer is option B. Wait for evidence and define invalidation. Historical reactions focus attention but do not guarantee the next outcome.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 3.2: Pattern Confirmation, Volume, and False Breaks

Separate visual recognition from evidence-based execution.

Here is the simple version. Tiny Turtle Toys usually trades 10,000 shares in its first hour, and the chart has a line at $30. In Monday's first hour, price pushes above $30 on 30,000 shares, 3 times normal, and stays there: a confirmed breakout. Last month, it poked to $30.20 in the first hour on 8,000 shares, 0.8 times normal, then slid back to $29.50: a false break. Same line, different evidence, and volume only means something next to what is normal. Before trusting a break, ask: did price stay above the line, and was volume above normal?

Point 1. Candles and chart patterns compress auction history. Confirmation asks whether volume, price acceptance, relative strength, and liquidity agree with the visual hypothesis.

Point 2. Volume needs normalization for time of day, float, and usual activity. Indicators reorganize inputs; they do not create information or guarantee direction.

Point 3. Chart lab: compare a confirmed breakout, a failed breakout, and an ambiguous setup; define the trigger and invalidation before revealing the next bars. Indicator lab: Trend Indicators: SMA, EMA, WMA, HMA, KAMA, MACD, ADX, Parabolic SAR, SuperTrend, Ichimoku Cloud, Moving Average Ribbon, Trendlines, Linear Regression, Donchian Channels, MA Crossovers, Price Channels, Gann Trend, Heikin-Ashi Trend Bias, MA Envelopes, Adaptive Moving Average, Zero-Lag MA, Triangular MA, Fractal Trend, DEMA, TEMA, McGinley Dynamic, Chande TrendScore, Trend Intensity Index, Trend Confirmation Index, Trend Direction Force. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed. Momentum Indicators: RSI, Stochastic (%K/%D), CCI, Williams %R, ROC, TRIX, Ultimate Oscillator, Chande Momentum Oscillator, KDJ, BIAS, PSY, Momentum (Rate of Change), Elder Force Index, Connors RSI, QQE, Fisher Transform, Stochastic RSI, Awesome Oscillator, Coppock Curve, DPO, Relative Vigor Index, Balance of Power, Price Momentum Oscillator, True Strength Index, McClellan Oscillator, McClellan Summation Index. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed. Volume Indicators: OBV, Volume Ratio, VWAP, Accumulation/Distribution (A/D), Chaikin Money Flow (CMF), Money Flow Index (MFI), Volume Profile, Volume Delta, Volume Spread Analysis, Ease of Movement, Force Index, Negative Volume Index, Positive Volume Index, Volume Oscillator, Intraday Intensity, Klinger Volume Oscillator, Volume Zone Oscillator, Price-Volume Trend, Volume Weighted Momentum, Turnover Rate. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed.

Knowledge check. Why do two RSI lookbacks disagree?

Option A. RSI is random

Option B. Lookback changes the sample and sensitivity

Option C. Price has two closes

Option D. Volume replaces price

The best answer is option B. Lookback changes the sample and sensitivity. Shorter samples react faster and usually contain more noise.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 4

We are beginning module 4. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 4.1: Financial Statements and Accounting Linkages

Connect the income statement, balance sheet, and cash-flow statement.

Here is the simple version. Maya's smoothie stand sells $1,000 of drinks this month and pays $600 in cash for fruit and cups, so her profit is $400. But the school cafe has paid only $700 so far and still owes her $300. That IOU is called a receivable: it counts in profit and sits on the balance sheet as an asset, but it is not cash yet. On the cash-flow statement, $400 of profit minus the $300 rise in receivables leaves $100 of cash. Profit grew by $400, but her cash box grew by only $100.

Point 1. Income measures a period, the balance sheet a point in time, and cash flow reconciles earnings with cash movement.

Point 2. Net income affects retained earnings; non-cash expenses and working capital reconcile earnings to operating cash flow.

Point 3. Filings lab: trace one material 10-Q change through all three statements and classify recurring versus financing effects.

Knowledge check. An increase in receivables, all else equal, does what to operating cash flow?

Option A. Raises it

Option B. Lowers it

Option C. Has no effect

Option D. Doubles it

The best answer is option B. Lowers it. Recognized but uncollected revenue increases receivables and is subtracted in the cash-flow reconciliation.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 4.2: Earnings Quality and Ratio Analysis

Use margins, returns, leverage, and cash conversion as a connected system.

Here is the simple version. Lagoon Lane Lemonade and Fizz Town Soda each sell $1,000 and report $100 of profit, a 10% margin. Lagoon Lane actually collects $95 of cash from that profit, which is 95%. Fizz Town collects only $40, which is 40%, and year after year its customers owe it more with no clear reason. Same profit on paper, but a $60 gap between profit and cash that keeps coming back is a warning sign. Profit you can trust keeps turning into real cash.

Point 1. Margins describe economics at different layers. Return on invested capital compares after-tax operating profit with required capital.

Point 2. Quality improves when repeatable cash supports profit; accruals, stock compensation, one-time items, and capitalization need scrutiny.

Point 3. Filings lab: build a five-year table of growth, margin, free cash flow, dilution, and debt and explain the economic story. Indicator lab: Per-Share & Fundamental Indicators: EPS, Diluted EPS, Operating Cash Flow Per Share, Revenue Growth, Net Income Growth, EBIT, EBITDA, ROIC, Operating Profit Margin, Asset Turnover, Inventory Turnover, Current Ratio, Quick Ratio. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed.

Knowledge check. Which most challenges earnings quality?

Option A. Cash persistently trails profit without explanation

Option B. Revenue and cash both grow

Option C. Debt falls

Option D. Margins stabilize

The best answer is option A. Cash persistently trails profit without explanation. A persistent profit-to-cash gap may signal aggressive accruals or weakening working-capital economics.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 5

We are beginning module 5. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 5.1: Time Value of Money and Discounted Cash Flow

Translate uncertain future cash flows into present-value scenarios.

Here is the simple version. Leo is promised $110, to be paid one year from now. If money can earn 10% a year, that promise is worth $110 divided by 1.1, which is $100 today. Check it: $100 growing at 10% for one year becomes $110 again. At 20%, the same promise is worth about $92 today, so a higher rate shrinks its value now. Money later is worth less than money now, because money now can start earning.

Point 1. Discounting reflects time, opportunity cost, and risk. Present value divides each expected cash flow by a compounded required return.

Point 2. DCF results depend on growth, margins, reinvestment, discount rate, and terminal assumptions; the model is conditional, not objective truth.

Point 3. Valuation lab: build bear, base, and bull paths plus a discount-rate and terminal-growth sensitivity table.

Knowledge check. If the discount rate rises and forecasts do not change, present value generally?

Option A. Rises

Option B. Falls

Option C. Stays fixed

Option D. Becomes revenue

The best answer is option B. Falls. A higher required return applies a larger discount to future cash flows.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 5.2: Multiples, Expectations, and Reverse Valuation

Normalize comparisons and infer assumptions embedded in market prices.

Here is the simple version. Crumb Bakery costs $50 a share and earns $5 a share a year, so its price-to-earnings ratio is 10. Rise Up Bakery costs $100 and earns $4, a ratio of 25, so Crumb looks cheaper. But next year Crumb's earnings are expected to fall to $2.50, while Rise Up's grow to $5. On next year's numbers both ratios become 20: Crumb's doubles because its earnings halve, and Rise Up's falls because its earnings grow 25%. A low price-to-earnings ratio can be a warning about shrinking profits, not a bargain.

Point 1. Multiples compress models: P/E uses equity earnings, EV/EBITDA uses enterprise value and an operating proxy, and sales ignores costs.

Point 2. Comparability requires aligned accounting, mix, growth, margin, cyclicality, intensity, and risk. A low multiple can reflect deterioration.

Point 3. Valuation lab: reverse-engineer the growth and margin path required by today’s enterprise value. Indicator lab: Valuation Indicators: P/E (LYR, TTM, Forward), PEG Ratio, Shiller CAPE, Price-to-Book, Price-to-Sales, Dividend Yield, EV/EBITDA, EV/Revenue, ROE, ROA, Net Margin, Gross Margin, Cash Flow Yield, Free Cash Flow, Enterprise Value Multiples. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed.

Knowledge check. Why is a lower P/E not automatically cheaper?

Option A. P/E excludes price

Option B. It can reflect weaker growth or higher risk

Option C. All earnings are cash

Option D. Exchanges fix it

The best answer is option B. It can reflect weaker growth or higher risk. A multiple reflects expectations and risk, not merely arithmetic cheapness.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 6

We are beginning module 6. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 6.1: Rates, Inflation, and Liquidity Transmission

Trace monetary conditions through financing, currencies, cash flows, and valuation.

Here is the simple version. Quick Snack owes Maya $100 next year, and Far Orchard owes Leo $100 in ten years. At a 5% rate, Maya's promise is worth about $95 today and Leo's about $61: money is discounted once per year of waiting. Now rates rise to 6%. Maya's value slips to about $94, down less than 1%, but Leo's falls to about $56, down about 9%. The higher rate hits Maya once and Leo ten times, so faraway cash feels rate changes the most.

Point 1. Policy rates shape short funding and the yield curve; real rates approximate nominal yields minus expected inflation.

Point 2. Inflation contains demand, wages, shelter, energy, supply, and expectations. Firms differ in pricing power and input sensitivity.

Point 3. Macro lab: map a rate shock through a bank, leveraged small-cap, long-duration growth firm, and commodity producer.

Knowledge check. Why are distant cash flows often more rate-sensitive?

Option A. They face more discounting periods

Option B. They are already cash

Option C. Rates only affect banks

Option D. Inflation guarantees growth

The best answer is option A. They face more discounting periods. The rate effect compounds over more periods.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 6.2: Business Cycles, Correlation, and Regime Shifts

Analyze growth, inflation, credit, and liquidity as changing regimes.

Here is the simple version. Maya splits $100 between Sunny Juice and Cozy Umbrella, because they usually move in opposite directions. In a sunny week, juice gains 2%, or $1, and umbrellas slip 1%, or $0.50, so she nets a gain of $0.50. Then a panic week hits and people sell everything at once. Both fall 10%, so she loses $5 plus $5, which is $10. Correlation is not a fixed rule: things that move apart in calm times can move together under stress.

Point 1. Cycles affect sales, defaults, inventories, labor, and policy with different lags; markets can anticipate turns before official data.

Point 2. Correlation is conditional. Diversifiers can converge during deleveraging and liquidity stress.

Point 3. Macro lab: build a growth-inflation regime matrix and define evidence that would trigger a transition. Indicator lab: Market Breadth Indicators: Advance/Decline Line, Advance/Decline Ratio, TRIN (Arms Index), McClellan Oscillator, McClellan Summation Index, High-Low Index, New Highs/New Lows, % of Stocks Above MA, Breadth Thrust, Zweig Breadth Thrust, Market Breadth Momentum, Sector Breadth, Equal-Weight Breadth, Up/Down Volume Ratio. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed. Economic Indicators: GDP Growth, CPI Inflation, PPI, Unemployment Rate, Non-Farm Payrolls, PMI (Manufacturing & Services), Consumer Confidence Index, Retail Sales, Housing Starts, Interest Rates (Fed Funds), Yield Curve Spread, Money Supply (M2), Industrial Production. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed.

Knowledge check. What weakens a fixed historical correlation assumption?

Option A. Correlation has no units

Option B. Relationships change across regimes

Option C. Prices never co-move

Option D. Only bonds correlate

The best answer is option B. Relationships change across regimes. Correlation is sample-dependent and can shift sharply under new policy or volatility.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 7

We are beginning module 7. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 7.1: Box the Trade: Plan, Size, and Invalidation

Turn an idea into a bounded decision before money and emotion are involved.

Here is the simple version. Leo has a $2,000 practice account and will risk at most 1% per trade, which is $20. He plans to buy at $10 and admits he is wrong at $9.50, so each share risks $0.50. $20 divided by $0.50 is 40 shares, or $400 of stock. Suppose his setups win 50% of the time for $30 and lose 50% of the time for $20. The average trade is then $5 before costs, or 0.25 R, where one R is his planned $20 loss.

Point 1. A complete trade box contains thesis, catalyst, trigger, entry zone, invalidation, targets, time stop, size, maximum dollar loss, and execution/liquidity risks.

Point 2. Size follows the loss budget divided by planned risk per share, then is reduced for spread, slippage, gaps, halts, and correlated exposure.

Point 3. Risk lab: build and stress-test a complete trade box, then compare fixed-dollar, fixed-fractional, and oversized exposure paths.

Knowledge check. A system wins 40% at 2R and loses 60% at 1R. Expectancy is?

Option A. -0.2R

Option B. 0R

Option C. +0.2R

Option D. +1.4R

The best answer is option C. +0.2R. 0.40×2 minus 0.60×1 equals +0.20R before costs.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 7.2: Portfolio Risk, Diversification, and Drawdown

Measure covariance, concentration, beta, tracking error, and stress loss.

Here is the simple version. Maya spreads $1,000 across ten space-tourism stocks, but all ten ride the same idea. Bad space news hits, all ten drop 30% together, and $1,000 becomes $700. To climb back she needs $300 on $700, a gain of about 43%. Leo puts $500 in space stocks and $500 in a steady soup company that holds still, so he ends at $850, down 15%. Diversification works when the pieces do not all move together.

Point 1. Portfolio variance depends on weights, individual variance, and covariance. Ten tickers with one factor can be one concentrated bet.

Point 2. Beta, tracking error, and peak-to-trough drawdown answer different questions and should not be treated as substitutes.

Point 3. Risk lab: group exposures by factor and stress simultaneous equity, rate, volatility, and liquidity shocks.

Knowledge check. When is diversification most helpful, all else equal?

Option A. Perfect positive correlation

Option B. Lower correlation

Option C. Every weight above 100%

Option D. Ignored volatility

The best answer is option B. Lower correlation. Lower covariance reduces total variance, though correlations can rise during stress.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 8

We are beginning module 8. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 8.1: Probability, Base Rates, and Bayesian Updating

Replace binary calls with conditional probabilities updated by evidence.

Here is the simple version. Maya's notebook has 100 breakouts: only 20 kept going and 80 faded, so the base rate is 20%. Her volume-spike signal showed up on 15 of the 20 real ones, which is 75%. But it also showed up on 20 of the 80 fakes, which is 25%. So when the signal flashes, 15 of the 35 flashes are real, about 43%. That is more than double the 20% start but still less than half, so the signal helps without settling the question.

Point 1. A base rate is the prior frequency in a relevant reference class. Ignoring it makes vivid but weak evidence look decisive.

Point 2. Bayesian updating weighs evidence by its likelihood under competing hypotheses; diagnostic evidence changes beliefs more.

Point 3. Statistics lab: estimate a breakout base rate and update it with a defined confirmation signal.

Knowledge check. To update after a noisy signal, what is essential?

Option A. Only the ticker

Option B. Signal likelihood under event and non-event cases

Option C. Candle color

Option D. An opinion

The best answer is option B. Signal likelihood under event and non-event cases. True- and false-positive behavior determine how diagnostic a signal is.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 8.2: Backtesting, Inference, and Research Bias

Design tests resistant to leakage, overfitting, survivorship, and false discovery.

Here is the simple version. Iris tests 20 trading rules that are really coin flips on old prices, and each has a 5% chance of looking great by luck. So she should expect about 1 fake winner, and the chance that at least one looks great is about 64%. To stay honest, she picks a rule using years one to three, then tests it on unseen year four. Then she walks forward: pick again on years two to four, test on year five, and repeat. A fair test uses only what was known at the time, and it counts the companies that failed, too.

Point 1. Valid backtests need point-in-time data, delistings, realistic execution, costs, and rules fixed before evaluation.

Point 2. Look-ahead uses unavailable information; survivorship removes failures; repeated searches inflate lucky results.

Point 3. Statistics lab: separate train, validation, and untouched test periods and report confidence, turnover, and drawdown.

Knowledge check. What does walk-forward testing approximate?

Option A. Using future data

Option B. Sequential fitting and out-of-sample evaluation

Option C. Removing losses

Option D. Guaranteed significance

The best answer is option B. Sequential fitting and out-of-sample evaluation. It preserves time order and tests on observations not used in the immediately preceding fit.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 9

We are beginning module 9. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 9.1: Put Options: The Right to Sell, Protection, and Premium

Learn puts with one simple contract before comparing advanced strategies.

Here is the simple version. Pebblestone Phones stock is at $50, and Leo pays Maya $200 for one put: the right to sell 100 shares at $45. That premium is $2 a share, so Leo breaks even at $45 minus $2, which is $43. If the stock ends at $40, the put is worth $5 a share, so Leo nets $3 a share, or $300, and Maya loses $300. If it ends at $55, the put expires worthless: Leo loses his $200 and Maya keeps it. The strike only acts like a price floor for someone who also owns the shares.

Point 1. A put buyer pays a premium for the right—not the obligation—to sell 100 shares at the strike price before expiration. For someone who also owns the shares, the strike works like a temporary price floor. The buyer can lose the premium, and the contract loses time value as expiration approaches.

Point 2. Payoff rules at expiration: a put is worth the strike minus the stock price when the stock finishes below the strike, and nothing otherwise. The buyer breaks even at the strike minus the premium, and the most the buyer can lose is the premium paid. Before expiration the put also holds time value, so its price moves with the stock, time, and volatility.

Point 3. Options lab: compare the other side. A cash-secured put seller receives the premium but accepts the obligation to buy 100 shares at $45 if assigned. The $2 credit makes the effective entry $43, but the downside below $43 remains real. Premium is payment for taking risk—not guaranteed passive income. Protective puts, covered calls, spreads, collars, straddles, and other structures should be learned only after this basic payoff is clear.

Knowledge check. A $30-strike put costs $1.50. The stock finishes at $26 at expiration. What is the buyer’s net profit per share before fees?

Option A. $0

Option B. $1.50

Option C. $2.50

Option D. $4

The best answer is option C. $2.50. The put has $30 − $26 = $4 of intrinsic value. Subtract the $1.50 premium: $4 − $1.50 = $2.50 per share, or $250 for one standard 100-share contract.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 9.2: Greeks, Implied Volatility, and Volatility Surfaces

Explain nonlinear option sensitivities and volatility pricing.

Here is the simple version. Leo's call on Moonbeam Motors costs $3 a share; its Greeks act like speedometers. Delta is 0.5, so a $1 stock rise adds about $0.50 a share, or $50 a contract. Theta takes $0.05 a day; vega adds $0.10 per one-point rise in implied volatility, the market's guess of future swings, and a drop removes it. Gamma is how fast delta changes: at 0.05, the rise lifts delta to 0.55. Near expiry, a call at the strike can have gamma 0.3. Its delta climbs from 0.5 to 0.8 during the rise, averaging about 0.65, a gain near $0.65.

Point 1. Delta measures underlying sensitivity, gamma delta curvature, theta time decay, vega implied-volatility sensitivity, and rho rate sensitivity.

Point 2. Greeks change with price, time, and volatility. Implied volatility is the input consistent with price, not guaranteed realized volatility.

Point 3. Options lab: compare strikes and expirations and explain skew using event risk, crash demand, supply, and leverage. Indicator lab: Options-Derived Indicators: Implied Volatility, Skew, Kurtosis, Gamma Exposure (GEX), Delta Positioning, Open Interest, Max Pain, Volatility Surface, Put Wall / Call Wall, Option Flow, Dealer Positioning Models. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed.

Knowledge check. Why can a short-dated at-the-money option have high gamma?

Option A. Delta changes rapidly with small moves

Option B. It has no theta

Option C. Its strike changes

Option D. It owns shares

The best answer is option A. Delta changes rapidly with small moves. Near strike and expiration, small moves materially change exercise probability and delta.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 10

We are beginning module 10. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 10.1: Day Trading: Read the Tape and the Auction

Interpret time-and-sales, spread, pace, size, and replenishment without pretending the tape predicts the future.

Here is the simple version. On Glowbug Gadgets, the screen shows only 1,000 shares for sale at $10. Buyers lift that offer, paying $10 in 12 trades of 500 shares, 6,000 shares in one minute, yet the price does not move. The offer keeps refilling, 6 times what was showing, so a big seller may be soaking up the buying. Leo waits instead of chasing: he trusts the buyers only if trades print above $10.05, and he drops the buy idea below $9.90. The tape shows what traded, which is a clue to confirm, not a prediction.

Point 1. Read executed prints relative to bid and ask, pace, spread, price progress, and replenishment. Absorption, exhaustion, failed breaks, sweeps, and hidden liquidity are inferences—not certainties.

Point 2. Displayed orders can cancel or be spoofed; odd lots, dark pools, aggregation, and latency hide intent. Never place deceptive orders, and never trade from one tape clue alone.

Point 3. Tape lab: replay executed trades around a level, classify aggression versus response, and decide enter, wait, reduce, or exit under a predeclared risk box. Indicator lab: Institutional & Flow Indicators: Dark Pool Index, Block Trade Flow, Institutional Ownership, Insider Transactions, Broker Positions, Smart Money Index, Liquidity Heatmaps, Order Flow Imbalance, Market Depth, Bid/Ask Pressure. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed.

Knowledge check. Fast green prints appear but price cannot advance. What is the disciplined reading?

Option A. Guaranteed rally

Option B. Possible offer absorption or buyer exhaustion

Option C. Proof of no sellers

Option D. Ignore resistance

The best answer is option B. Possible offer absorption or buyer exhaustion. Aggressive buying without price progress can reveal supply; confirmation is still required.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 10.2: Spotting Rally Conditions Before Confirmation

Build a probabilistic rally checklist from confluence and market response.

Here is the simple version. Leo's rally checklist for Comet Fizz has six boxes, and the key level is $15. The level, fresh news, volume at 3 times normal, eager buyers, and steady buy orders tick five of six boxes. But the most important box, holding above $15, failed: price slipped back to $14.80, so he waits. Five of six is 83% of the clues, not an 83% chance of a rally. If price later holds above $15.10, he could buy there with a $14.70 exit, risking $0.40 a share, or $40 on 100 shares. A checklist counts clues; it never promises a rally.

Point 1. Stronger conditions combine a meaningful level, catalyst/context, elevated relative volume, offers lifting, bids replenishing, a controlled spread, and acceptance above the trigger.

Point 2. The response matters: buying that produces no progress can signal absorption; a breakout that immediately trades back inside can be a liquidity sweep or failed break.

Point 3. Replay lab: pause before each bar and choose a hypothesis, trigger, invalidation, size, and no-trade condition; then grade process rather than outcome.

Knowledge check. Which best supports a rally hypothesis?

Option A. One flashing bid

Option B. Executed buying plus price acceptance and supportive liquidity

Option C. A rumor alone

Option D. One green print

The best answer is option B. Executed buying plus price acceptance and supportive liquidity. Confluence and follow-through improve evidence, but no checklist guarantees a rally.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 11

We are beginning module 11. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 11.1: Filings, Catalysts, and Evidence Hierarchy

Build research from primary documents and timestamped evidence.

Here is the simple version. A post shouts that Starfish Snacks is selling 5 million new shares at $4. Maya ignores the post and opens the company's official filing, the legal document for the sale. It says 2 million shares at $5, raising $10 million before fees. With 20 million shares already out, the 2 million new ones are about 9% of the 22 million total, not the 20% the rumor implied. Go to the primary source first, and check what the news really changes.

Point 1. Primary evidence includes filings, audited statements, court records, exchange notices, and company releases.

Point 2. A catalyst must connect an event to cash flow, risk, positioning, or constraints and may already be priced.

Point 3. Research lab: table each claim, source, publication time, uncertainty, and thesis variable affected.

Knowledge check. Strongest source for registered offering terms?

Option A. Anonymous repost

Option B. Filed prospectus

Option C. Price chart

Option D. Uncited thread

The best answer is option B. Filed prospectus. The filed prospectus is the primary legal disclosure.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 11.2: Grandmaster-Obi Alert Analysis and Falsification

Audit timestamped alerts with executable data, full-path risk, and no hindsight.

Here is the simple version. A chat alert says Kite Kitchen: entry $2, target $2.50, wrong below $1.80. Maya's real fill is $2.05, so she gave up $0.05 a share to slippage. The stock first sinks to $1.70, so her rule says exit near $1.80, a loss of $25 on 100 shares. Only later does it spike to $2.60, and a screenshot brags about a 30% gain. An honest review uses only what was known then, notes the worst dip, about 17% below her fill, and counts the losers too. A testable idea says in advance what would prove it wrong.

Point 1. Freeze the information available at the alert: timestamp, stated entry and target, spread, liquidity, float, catalyst, market regime, and feasible size. An alert is not proof that every follower received the same fill.

Point 2. Measure maximum favorable and adverse excursion, time to each, slippage, halt exposure, target/invalidation rules, and open or closed status. Report every qualifying alert, not only winners.

Point 3. Research lab: reconstruct a Grandmaster-Obi alert from timestamped evidence, write the strongest rebuttal, and grade decision quality separately from the later peak.

Knowledge check. What makes a thesis falsifiable?

Option A. It explains everything

Option B. It states evidence that would show it wrong

Option C. It sounds confident

Option D. It has a target

The best answer is option B. It states evidence that would show it wrong. Falsification specifies conditions requiring rejection or revision.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 12

We are beginning module 12. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 12.1: Behavioral Bias and Decision Architecture

Design processes that reduce confirmation, anchoring, loss, and recency bias.

Here is the simple version. Leo's rule says risk at most $50 a trade, but he buys 500 shares of Neon Noodle at $10 with no exit plan. Maya buys 100 shares at $10 with an exit at $9.50, risking $50. The stock first dips to $9.50, stopping Maya out, then pops to $10.40. Leo sat through a $250 paper loss and ends $200 ahead. But a 20% drop on his $5,000 of stock would have cost $1,000, 20 times his limit. Leo got the better outcome and Maya made the better decision, so grade the process, not the result.

Point 1. Confirmation favors support, anchoring overweights first numbers, loss aversion delays exits, and recency extrapolates the latest regime.

Point 2. Checklists, base rates, precommitment, independent review, and limits alter the decision environment more than awareness alone.

Point 3. Process lab: grade three decisions using only information available at the time, separating decision quality from outcome.

Knowledge check. A profitable rule-breaking trade demonstrates?

Option A. Good process

Option B. A favorable outcome that may follow poor process

Option C. Guaranteed skill

Option D. No risk

The best answer is option B. A favorable outcome that may follow poor process. Outcome bias can mistake luck for decision quality.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 12.2: Crowds, Narratives, and Strategic Interaction

Analyze incentives, positioning, reflexivity, and crowded exits.

Here is the simple version. In a club of 100 traders, 90 already own Dragon Drinks, so only 10 could still buy. On a normal day, 1,000 shares trade. When bad news hits, the 90 owners each try to sell 100 shares, which is 9,000 shares all at once. That is 9 normal days of selling squeezed through one door, so the price has to drop until new buyers show up. A popular story can feel safe, but when almost everyone is already in, the exit gets crowded.

Point 1. Participants respond to fundamentals and expectations about others. Crowding can create momentum and fragility simultaneously.

Point 2. Reflexivity occurs when price influences financing and behavior, which alters fundamentals and feeds back into price.

Point 3. Behavior lab: map investors, dealers, insiders, lenders, and management by incentives and response to three price paths. Indicator lab: Sentiment Indicators: VIX, Put/Call Ratio, AAII Sentiment Survey, Fear & Greed Index, Short Interest Ratio, Margin Debt, Insider Buying/Selling, Commitment of Traders (COT), Social Media Sentiment, Options Skew, Volatility Risk Premium, Equity Hedging Pressure. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed.

Knowledge check. Why can a popular bullish narrative increase fragility?

Option A. Crowding leaves fewer buyers and congested exits

Option B. Narratives remove risk

Option C. Horizons become identical

Option D. Prices stop

The best answer is option A. Crowding leaves fewer buyers and congested exits. Aligned exposure can make reversal sharper when evidence or liquidity changes.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 13

We are beginning module 13. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 13.1: Strategy Design, Execution, and Monitoring

Convert a hypothesis into rules, controls, measurement, and governance.

Here is the simple version. Maya's strategy earns $0.05 a share on paper, on 100 trades of 1,000 shares each, which is $5,000. In real trading, spread and slippage cost $0.03 a share, or $30 a trade, plus a $1 fee. So each trade nets $50 minus $31, which is $19, or $1,900 in total: costs ate 62% of the paper edge. Her written rules also include a kill switch that stops trading for the day if losses pass $200 or the price feed freezes. A strategy is only real after costs, with rules that say when to stop.

Point 1. A specification defines universe, signal, entry, exit, sizing, constraints, costs, timing, exceptions, and shutdown conditions.

Point 2. Latency, spread, partial fills, borrow, capacity, impact, outages, and regime drift can erase paper edge.

Point 3. Systems lab: write a versioned strategy card and separate research metrics from live risk controls. Indicator lab: Featured / Composite Indicators: Penny Stock Filters, High Dividend Filters, Blue Chip Filters, Buffett Strategy Screens, Undervalued Stock Screens, Growth Stock Screens, Low P/E Screens, High P/E Screens, RSI < 30 Screens, Junk Stock Filters. For every item, identify its inputs, formula or source, valid use, lag, failure modes, and whether it is price-derived or requires a verified external feed.

Knowledge check. Purpose of a strategy kill switch?

Option A. Increase leverage

Option B. Halt when safety or validity conditions fail

Option C. Hide losses

Option D. Optimize history

The best answer is option B. Halt when safety or validity conditions fail. It limits damage when data, execution, risk, or assumptions become unreliable.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 13.2: Capstone: Investment Committee Defense

Integrate evidence, valuation, risk, execution, and ethics in a defended analysis.

Here is the simple version. Leo defends Harbor Bikes, at $10 a share, to a pretend committee where Maya plays the tough reviewer. He shows three sourced scenarios: worst case $6 with a 25% chance, middle case $10 with 50%, and best case $16 with 25%. Weighted by chance, that is $1.50 plus $5 plus $4, or $10.50, only 5% above today and not a promise. When Maya asks what would prove him wrong, he says he drops the idea if bike orders fall six months in a row. A strong defense shows sources, chances, risks, and a way to be wrong.

Point 1. Submit primary sources, market-structure review, financial model, scenarios, catalyst timeline, risk map, and falsification rules.

Point 2. Present the thesis and strongest rebuttal; quantify uncertainty, disclose conflicts, distinguish fact from inference, and promise no returns.

Point 3. Capstone lab: defend the work before a mock risk committee, answer adversarial questions, revise weak claims, and grade process.

Knowledge check. Which satisfies the capstone standard?

Option A. Unsourced target

Option B. Sourced scenario thesis with risks and falsification

Option C. Viral screenshot

Option D. Guaranteed return

The best answer is option B. Sourced scenario thesis with risks and falsification. College-level analysis is sourced, conditional, numerate, transparent, and open to disconfirmation.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 14

We are beginning module 14. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 14.1: Compounding, Logarithms, and Growth

Mathematical Foundations: Compounding is multiplicative; logarithms convert repeated growth into additive terms.

Here is the simple version. Maya's $100 grows to $121 in 2 years, while Leo's $100 grows to $144 in 4 years. Leo's gain of $44 looks bigger than Maya's $21, but he took twice as long. Growth multiplies: 10% a year means times 1.1 each year, and 1.1 times 1.1 is 1.21. Leo's money grew 1.44 times, but spread over 4 years that is only about 9.5% a year. Logs turn that multiplying into adding, so equal percent steps look like equal steps on a log chart. Turn a total gain into a per-year rate before comparing.

Point 1. Compounding is multiplicative; logarithms convert repeated growth into additive terms.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Calculate annualized returns across unequal holding periods.

Knowledge check. Which statement is most defensible?

Option A. Annualized growth must account for both total return and elapsed time.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Annualized growth must account for both total return and elapsed time.. Annualized growth must account for both total return and elapsed time. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 14.2: Present Value, Annuities, and Perpetuities

Mathematical Foundations: Present value discounts future cash flows using a rate consistent with timing and risk.

Here is the simple version. Say Sam is promised $100 every year, forever, from renting out a lemonade cart. A promise that never ends is worth the payment divided by the yearly rate Sam needs: at 5%, that is $2,000 today. If Sam needs 10% instead, the same promise is worth only $1,000. A promise that stops is worth less: just two payments of $100 at 10% are worth only about $174 today. Same money later, higher rate, lower value today.

Point 1. Present value discounts future cash flows using a rate consistent with timing and risk.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Price a level annuity and stress its discount rate.

Knowledge check. Which statement is most defensible?

Option A. A higher discount rate lowers present value when cash flows are unchanged.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A higher discount rate lowers present value when cash flows are unchanged.. A higher discount rate lowers present value when cash flows are unchanged. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 14.3: Linear Algebra for Portfolios

Mathematical Foundations: Portfolio return is a weighted vector product and portfolio variance uses the covariance matrix.

Here is the simple version. Say Ava splits her money half and half between an umbrella stand and an ice-cream cart. The umbrella stand makes $20 on rainy days and nothing on sunny days, and the cart is the opposite. Her mix makes half of $20 plus half of zero, which is $10, rain or shine. With two ice-cream carts instead, she still averages $10 if rain and sun are equally likely, but swings between zero and $20. Each part is just as bumpy alone; how the parts move together decides how bumpy the mix is.

Point 1. Portfolio return is a weighted vector product and portfolio variance uses the covariance matrix.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Compute return and variance for a three-asset weight vector.

Knowledge check. Which statement is most defensible?

Option A. Covariances, not just individual volatilities, drive portfolio risk.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Covariances, not just individual volatilities, drive portfolio risk.. Covariances, not just individual volatilities, drive portfolio risk. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 14.4: Optimization and Constraints

Mathematical Foundations: An unconstrained mathematical optimum may be untradeable once leverage, liquidity, turnover, and concentration limits apply.

Here is the simple version. Iris has $1,000 and three pretend shops that hope to earn 12%, 8% and 6% a year. On paper, the best plan is all $1,000 in the 12% shop, for a hoped $120. Here's the catch: only $200 of that shop is for sale, and her rule is at most 40%, or $400, in any one shop. Solving with the limits inside gives $200, $400 and $400, for a hoped $24 plus $32 plus $24, or $80. Chopping the paper plan afterward hopes for just $24 with $800 idle, so the limits belong inside the math.

Point 1. An unconstrained mathematical optimum may be untradeable once leverage, liquidity, turnover, and concentration limits apply.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Solve a simple allocation first without and then with position limits.

Knowledge check. Which statement is most defensible?

Option A. Constraints belong inside the optimization rather than being checked afterward.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Constraints belong inside the optimization rather than being checked afterward.. Constraints belong inside the optimization rather than being checked afterward. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 14.5: Calculus, Sensitivity, and Convexity

Mathematical Foundations: First derivatives measure local sensitivity while second derivatives describe curvature.

Here is the simple version. Leo's pretend bond is worth $100, and its duration of 10 says it drops about 10% for each 1% rise in rates. That straight-line rule says a 1% rise costs 10%, to $90, and a 3% rise costs 30%, to $70. But real bond prices curve, so a second fix called convexity, 100 for this bond, adds some value back, growing fast for bigger moves. For a 1% rise, that adds only 0.5%, to $90.50, but for 3% it adds 4.5%, to $74.50. For plain bonds, the straight line is fine for small moves and too gloomy for big ones.

Point 1. First derivatives measure local sensitivity while second derivatives describe curvature.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Approximate a bond price move with duration and convexity.

Knowledge check. Which statement is most defensible?

Option A. Convexity improves a linear duration estimate for larger yield changes.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Convexity improves a linear duration estimate for larger yield changes.. Convexity improves a linear duration estimate for larger yield changes. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 15

We are beginning module 15. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 15.1: Supply, Demand, and Equilibrium

Microeconomics and Strategic Behavior: Prices coordinate scarce supply and demand, but shifts in either curve change equilibrium.

Here is the simple version. In Lemon Town, at $4 a lemon, buyers ask for 60 lemons and growers bring 60, so the price sits at $4. Then a frost cuts what growers can bring by 40 lemons at every price: supply itself has shifted. At $4, growers now bring only 20, so buyers compete and the price climbs to $6, where growers bring 40 and buyers ask for 40. Buyers asking for 20 fewer lemons does not mean demand shifted; they are just reacting to the higher price. A shift changes the amounts at every price; a reaction just follows a new price.

Point 1. Prices coordinate scarce supply and demand, but shifts in either curve change equilibrium.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Map a commodity supply shock into price and quantity effects.

Knowledge check. Which statement is most defensible?

Option A. A movement along a curve differs from a shift of the curve itself.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A movement along a curve differs from a shift of the curve itself.. A movement along a curve differs from a shift of the curve itself. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 15.2: Elasticity and Operating Leverage

Microeconomics and Strategic Behavior: Elasticity measures proportional responsiveness and helps explain pricing power and revenue sensitivity.

Here is the simple version. Sunny Juice raises a cup from $2 to $2.20, a 10% rise, and cups sold slip from 100 to 95, only 5% fewer. Cups moved less than price, so demand is inelastic, and money in rises from $200 to $209. Fizz Pop tries the same rise, loses 20% of its cups, and takes in just $176, down from $200: elastic demand. Sunny pays a fixed $100 rent plus $0.50 a cup, so profit jumps from $50 to $61.50, up 23% on 4.5% more money in. Fixed costs make profit swing harder than money in.

Point 1. Elasticity measures proportional responsiveness and helps explain pricing power and revenue sensitivity.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Estimate demand elasticity from a price-and-volume scenario.

Knowledge check. Which statement is most defensible?

Option A. Inelastic demand changes quantity less proportionally than price.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Inelastic demand changes quantity less proportionally than price.. Inelastic demand changes quantity less proportionally than price. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 15.3: Competition, Moats, and Market Power

Microeconomics and Strategic Behavior: Industry structure influences margins, investment, innovation, and the durability of excess returns.

Here is the simple version. Maya sells cookies for $3 that cost her $1 to make, so she keeps $2 a cookie, a fat margin. Nothing stops copycats, so Leo opens next door at $2, and Maya has to match him and keeps just $1. Then a third stand sells at $1.50, and her profit shrinks to $0.50 a cookie. Omar's ice rink holds the town's only permit, so no one can easily copy it, and that barrier is a moat. A high margin today is not a moat; ask what stops rivals from copying.

Point 1. Industry structure influences margins, investment, innovation, and the durability of excess returns.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Compare competitive, oligopoly, and monopoly economics.

Knowledge check. Which statement is most defensible?

Option A. High current margins alone do not prove a durable moat.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. High current margins alone do not prove a durable moat.. High current margins alone do not prove a durable moat. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 15.4: Game Theory and Repeated Interaction

Microeconomics and Strategic Behavior: Strategic outcomes depend on incentives, information, credible commitments, and repeated play.

Here is the simple version. Zoe and Omar run the only two pizza shops in town, and each picks a small or a big oven. Both small earns $10 a day each and both big earns $8; if only one goes big, it earns $12 and the other $6. For Zoe, big wins either way: $12 beats $10 if Omar stays small, and $8 beats $6 if he goes big. That makes big a dominant strategy, so both go big and earn $8, though $10 each was possible. If they face off every day for years, staying small together can become worth it.

Point 1. Strategic outcomes depend on incentives, information, credible commitments, and repeated play.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Build a payoff matrix for two firms choosing capacity.

Knowledge check. Which statement is most defensible?

Option A. A dominant strategy is optimal regardless of the rival action.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A dominant strategy is optimal regardless of the rival action.. A dominant strategy is optimal regardless of the rival action. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 15.5: Information Asymmetry and Signaling

Microeconomics and Strategic Behavior: Managers, lenders, and investors hold unequal information, creating adverse selection and moral hazard.

Here is the simple version. In Bike Town, half the used bikes are good, worth $100, and half are duds, worth $40, but buyers can't tell which. So buyers pay the average, $70, and owners of good bikes start walking away. Ravi, who has a good bike, offers a year of free repairs, costing about $5 on his bike but $80 on a dud. Buyers now take a bike without the promise for a dud, worth $40. A good seller nets $100 minus $5, or $95, but a dud seller who copies nets only $20, less than $40. A signal works when it is too costly for fakers to copy.

Point 1. Managers, lenders, and investors hold unequal information, creating adverse selection and moral hazard.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Classify a financing choice as signal, screening device, or incentive.

Knowledge check. Which statement is most defensible?

Option A. A costly signal is credible only when weaker types find it harder to imitate.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A costly signal is credible only when weaker types find it harder to imitate.. A costly signal is credible only when weaker types find it harder to imitate. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 16

We are beginning module 16. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 16.1: National Accounts and GDP

Macroeconomics and Global Markets: GDP measures final production, while nominal and real measures separate price and quantity changes.

Here is the simple version. Pizza Island makes only pizza: last year 100 pizzas at $10, or $1,000, and this year 105 at $12, or $1,260. That total, the value of all it makes, is its GDP: up 26% in dollars, but prices alone rose 20%. To see real growth, use last year's price: 105 times $10 is $1,050, only 5% more. The same $1,260 is spent by families, businesses and government, minus $40 because more was bought from abroad than sold. Real GDP uses fixed prices, so it counts how much more stuff was actually made.

Point 1. GDP measures final production, while nominal and real measures separate price and quantity changes.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Reconcile consumption, investment, government, and net exports.

Knowledge check. Which statement is most defensible?

Option A. Real GDP removes the effect of changing prices with a price index.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Real GDP removes the effect of changing prices with a price index.. Real GDP removes the effect of changing prices with a price index. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 16.2: Inflation Measurement and Expectations

Macroeconomics and Global Markets: CPI, PCE, headline, core, and market-implied inflation answer different questions.

Here is the simple version. Lena's basket of bread, a bus pass and a movie cost $20 last year and $21 this year, so her basket inflation was 5%. That looks back; to peek forward, compare a regular bond paying 4% with a protected bond paying 1% plus inflation. They tie if inflation averages 3%, so 3% is called the breakeven. But it mixes the crowd's guess with extra pay for inflation worry, minus a bit because protected bonds are harder to sell. A breakeven is a clue, not a clean forecast.

Point 1. CPI, PCE, headline, core, and market-implied inflation answer different questions.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Compare an inflation surprise with breakeven changes.

Knowledge check. Which statement is most defensible?

Option A. Breakevens include inflation expectations plus risk and liquidity premia.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Breakevens include inflation expectations plus risk and liquidity premia.. Breakevens include inflation expectations plus risk and liquidity premia. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 16.3: Labor Markets and the Business Cycle

Macroeconomics and Global Markets: Employment, participation, wages, productivity, and vacancies describe different parts of labor-market health.

Here is the simple version. Pine Town has 200 people in its workforce: 190 working and 10 looking, so unemployment is 5%. This summer, businesses add 45 jobs, but 50 students also start looking for work. Now 235 work out of 250, so 15 are looking, and unemployment rises to 6%, even though jobs went up. The job count comes from asking businesses, while the rate comes from asking households and divides by everyone in the workforce. More jobs and a higher jobless rate can both be true.

Point 1. Employment, participation, wages, productivity, and vacancies describe different parts of labor-market health.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Interpret a payroll gain alongside rising unemployment.

Knowledge check. Which statement is most defensible?

Option A. Payrolls and unemployment can diverge because they use different surveys and denominators.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Payrolls and unemployment can diverge because they use different surveys and denominators.. Payrolls and unemployment can diverge because they use different surveys and denominators. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 16.4: Central Banks and Monetary Transmission

Macroeconomics and Global Markets: Policy affects markets through expected rate paths, credit, liquidity, currencies, and confidence.

Here is the simple version. Everyone expects the Island Central Bank to raise its rate by 0.25%, and bond prices already reflect that. Instead it raises by 0.5%, so the surprise is 0.5% minus 0.25%, which is 0.25%. Leo's pretend bond loses about 5% for each 1% of surprise, so it drops about 1.25%, from $100 to $98.75. Had everyone expected 0.5%, the same raise would be no surprise, and the bond would barely move. Markets move on the surprise, not the headline.

Point 1. Policy affects markets through expected rate paths, credit, liquidity, currencies, and confidence.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Trace a hawkish surprise across bonds, banks, growth stocks, and FX.

Knowledge check. Which statement is most defensible?

Option A. Asset prices react to the surprise relative to expectations, not the announcement alone.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Asset prices react to the surprise relative to expectations, not the announcement alone.. Asset prices react to the surprise relative to expectations, not the announcement alone. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 16.5: Currencies, Trade, and Balance of Payments

Macroeconomics and Global Markets: Exchange rates connect relative prices, capital flows, trade, policy, and risk appetite.

Here is the simple version. Comet Cocoa sells cocoa abroad and earns 1,000 Crowns, and last year each Crown was worth $1, so that was $1,000. This year the dollar is stronger, and one Crown buys only $0.80, so the same sales bring home just $800. Nothing changed abroad, yet its dollar earnings fell 20%. Meanwhile Nia, who imports toys costing 100 Crowns, now pays $80 instead of $100. A strong home currency squeezes exporters and helps importers, all else equal.

Point 1. Exchange rates connect relative prices, capital flows, trade, policy, and risk appetite.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Map a currency appreciation into exporters and importers.

Knowledge check. Which statement is most defensible?

Option A. A stronger home currency can reduce translated foreign earnings, all else equal.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A stronger home currency can reduce translated foreign earnings, all else equal.. A stronger home currency can reduce translated foreign earnings, all else equal. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 17

We are beginning module 17. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 17.1: Probability Distributions and Tail Risk

Statistics and Econometrics: Mean and variance are incomplete when returns are skewed, fat-tailed, or state-dependent.

Here is the simple version. Leo's pretend fund has a standard wiggle, which statisticians call the standard deviation, of 1% a day. A bell-curve model says a drop three of those wiggles big, 3% or worse, comes only about 1.35 times in 1,000 days. Leo counts his fund's record of 1,000 days and finds 8 drops that big, about 6 times as many as the model expected. The typical day looked normal, but the tails were fat. Averages can hide how often the really bad days come.

Point 1. Mean and variance are incomplete when returns are skewed, fat-tailed, or state-dependent.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Compare normal loss estimates with an empirical tail.

Knowledge check. Which statement is most defensible?

Option A. Fat tails make extreme observations more frequent than a normal model predicts.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Fat tails make extreme observations more frequent than a normal model predicts.. Fat tails make extreme observations more frequent than a normal model predicts. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 17.2: Sampling, Estimation, and Confidence Intervals

Statistics and Econometrics: An estimate is uncertain and its interval depends on variation, sample size, and assumptions.

Here is the simple version. Nia tracks a pretend fund for 25 months: it averages 1% a month, with a standard wiggle, or standard deviation, of 5%. The average itself wiggles less: its standard error is 5% divided by the square root of 25, or 1%. Her 95% range spans about two errors either side of 1%: minus 1% to 3%. With 100 months, the error halves to 0.5% and the range tightens to 0% to 2%. The 95% describes the method: it catches the true average in about 95 of 100 repeats. More data narrows the range, and a bigger wiggle widens it.

Point 1. An estimate is uncertain and its interval depends on variation, sample size, and assumptions.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Construct and interpret a confidence interval for mean return.

Knowledge check. Which statement is most defensible?

Option A. A confidence interval describes a repeated-sampling procedure, not a probability that a fixed parameter moved.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A confidence interval describes a repeated-sampling procedure, not a probability that a fixed parameter moved.. A confidence interval describes a repeated-sampling procedure, not a probability that a fixed parameter moved. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 17.3: Hypothesis Tests and Economic Significance

Statistics and Econometrics: Statistical significance does not establish causality, stability, profitability, or economic importance.

Here is the simple version. Leo tests a trading rule on 10,000 trades of $1,000 each, and it beats chance by just $0.20 a trade. Each trade has a standard wiggle of $5, so the average's error is $5 divided by 100, the square root of 10,000, or $0.05. The edge is 4 times that error, so a result this strong would be very rare if the rule had no real edge. Here's the catch: fees and the spread cost $0.50 a trade, so he loses $0.30 a trade, or $3,000 in all. Statistically real is not the same as worth trading.

Point 1. Statistical significance does not establish causality, stability, profitability, or economic importance.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Test a mean return and subtract estimated trading costs.

Knowledge check. Which statement is most defensible?

Option A. A tiny effect can be statistically significant yet economically useless.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A tiny effect can be statistically significant yet economically useless.. A tiny effect can be statistically significant yet economically useless. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 17.4: Regression, Omitted Variables, and Causality

Statistics and Econometrics: Regression measures conditional association unless identification supports a causal interpretation.

Here is the simple version. Omar sees juice stores with 60 parking spots selling $600 a day, and stores with 20 spots selling $200. A straight line says each extra spot adds $400 divided by 40 spots, or $10 a spot. Here's the catch: the big-lot stores are all in big towns, where there are simply more shoppers. Compare two big-town stores with 50 and 70 spots: both sell $600, so the extra spots add $0. Town size was the hidden factor; going together is not the same as causing.

Point 1. Regression measures conditional association unless identification supports a causal interpretation.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Diagnose omitted-variable bias in a valuation regression.

Knowledge check. Which statement is most defensible?

Option A. Correlation after controls is not automatically causal evidence.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Correlation after controls is not automatically causal evidence.. Correlation after controls is not automatically causal evidence. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 17.5: Time Series, Stationarity, and Forecast Error

Statistics and Econometrics: Trends, autocorrelation, seasonality, volatility clustering, and structural breaks require time-aware methods.

Here is the simple version. Maya's stand sold about 20 cups a day for 60 days, then a heat wave pushed it to about 50 cups. If she shuffles all 100 days before testing, the model peeks at heat-wave days and looks almost perfect. Walking forward instead, she trains on days 1 to 60 and predicts day 61. The model guesses 20 cups, the real answer is 50, so it misses by 30 cups, a 60% error. When times change, test the way you would really use it: past to future, never shuffled.

Point 1. Trends, autocorrelation, seasonality, volatility clustering, and structural breaks require time-aware methods.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Run a walk-forward forecast across a regime break.

Knowledge check. Which statement is most defensible?

Option A. Random train-test shuffling can leak future regimes into financial models.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Random train-test shuffling can leak future regimes into financial models.. Random train-test shuffling can leak future regimes into financial models. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 18

We are beginning module 18. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 18.1: Revenue Recognition and Contract Economics

Financial Reporting and Forensics: Revenue timing depends on performance obligations, control transfer, estimates, and contract terms.

Here is the simple version. Leo pays Maya's Comic Club $120 up front for 12 monthly comics. Maya has all $120 in cash on day one, but she hasn't earned it yet: each comic is worth $10. After January's comic, she counts $10 as revenue and still owes $110 of comics, called deferred revenue. After three months, revenue so far is $30, and $90 is still owed. Revenue is counted as the work is delivered, not when the cash arrives.

Point 1. Revenue timing depends on performance obligations, control transfer, estimates, and contract terms.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Reconcile bookings, billings, revenue, and deferred revenue.

Knowledge check. Which statement is most defensible?

Option A. Cash collection and revenue recognition can occur in different periods.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Cash collection and revenue recognition can occur in different periods.. Cash collection and revenue recognition can occur in different periods. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 18.2: Inventory, Costing, and Working Capital

Financial Reporting and Forensics: Inventory methods and write-downs affect margins, taxes, assets, and cash conversion.

Here is the simple version. Kite Corner Toys grew sales from $1,000 to $1,100, up 10%, but its unsold toys grew from $200 to $300, up 50%. That extra $100 of toys is $100 of cash sitting on shelves instead of in the bank. Nia asks why before judging. Stocking up for a holiday rush can be fine, but toys nobody wants may be marked down later, and that cuts profit. Inventory racing ahead of sales is a question, not an answer.

Point 1. Inventory methods and write-downs affect margins, taxes, assets, and cash conversion.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Trace an inventory build through all three statements.

Knowledge check. Which statement is most defensible?

Option A. Inventory growth faster than sales can indicate stocking, slowdown, or strategy and needs context.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Inventory growth faster than sales can indicate stocking, slowdown, or strategy and needs context.. Inventory growth faster than sales can indicate stocking, slowdown, or strategy and needs context. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 18.3: Long-Lived Assets, Intangibles, and Impairment

Financial Reporting and Forensics: Capitalization shifts expense recognition across periods and can alter apparent profitability.

Here is the simple version. Omar's bakery earns $2,000 a year and buys a $3,000 oven that lasts 3 years. Count the oven as a cost right away, and year one shows a loss of $1,000, then $2,000 in each later year. Spread the cost at $1,000 a year instead, and each year's profit is $2,000 minus $1,000, or $1,000. Both ways, the 3 years' profit totals $3,000, but spreading leaves $2,000 on the books, written off at once if the oven breaks early. Spreading lifts this year's profit and pushes the cost into later years.

Point 1. Capitalization shifts expense recognition across periods and can alter apparent profitability.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Compare expensing with capitalization for the same investment.

Knowledge check. Which statement is most defensible?

Option A. Capitalizing a cost raises current profit but creates future amortization or impairment risk.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Capitalizing a cost raises current profit but creates future amortization or impairment risk.. Capitalizing a cost raises current profit but creates future amortization or impairment risk. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 18.4: Debt, Leases, Pensions, and Hidden Claims

Financial Reporting and Forensics: Contractual obligations can create leverage beyond headline borrowings.

Here is the simple version. Bright Kettle shows just $100 of bank debt and earns $100 a year after rent, so its debt looks like only 1 year of earnings. But it also signed ten years of store rent at $20 a year, worth $150 in today's money, and owes workers pensions worth $50. Add them up: $100 plus $150 plus $50 is $300 of promises to pay. Since rent now counts as debt, add the $20 rent back to earnings: $300 divided by $120 is 2.5 years, not 1. Count every promise to pay, not just the loans.

Point 1. Contractual obligations can create leverage beyond headline borrowings.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Build an adjusted leverage bridge including leases and pensions.

Knowledge check. Which statement is most defensible?

Option A. Enterprise risk depends on economic claims, not only the debt line item.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Enterprise risk depends on economic claims, not only the debt line item.. Enterprise risk depends on economic claims, not only the debt line item. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 18.5: Fraud Signals and Forensic Accounting

Financial Reporting and Forensics: No ratio proves fraud; investigators triangulate incentives, anomalies, disclosures, cash, counterparties, and governance.

Here is the simple version. Glow Lamp reports $500 of profit this year, yet its operating cash flow was minus $100, a gap of $600. Unpaid customer bills jumped from $200 to $800, which is exactly that $600. Nia doesn't shout fraud; she checks who the customers are and whether they paid after the year ended. If real customers paid in January, it was timing; a buyer that exists only on paper is a real problem. The gap tells Nia where to look, not what happened.

Point 1. No ratio proves fraud; investigators triangulate incentives, anomalies, disclosures, cash, counterparties, and governance.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Create a forensic checklist for a profit-to-cash divergence.

Knowledge check. Which statement is most defensible?

Option A. A red flag is a reason to investigate, not a verdict.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A red flag is a reason to investigate, not a verdict.. A red flag is a reason to investigate, not a verdict. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 19

We are beginning module 19. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 19.1: Capital Budgeting and Incremental Cash Flow

Corporate Finance and Capital Allocation: Project value uses incremental after-tax cash flows including opportunity costs and working capital.

Here is the simple version. Maya already paid $500 for a food-truck study, and that money is gone whatever she decides. Now a truck costs $1,000 and is expected to bring in $600 a year for 2 years, with money worth 10% a year to her. In today's money, those payments are worth about $1,041, so the truck adds about $41 of value. Subtracting the old $500 would show a loss of about $459 and scare her away from a project that adds value. Only future cash that changes with the decision counts.

Point 1. Project value uses incremental after-tax cash flows including opportunity costs and working capital.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Build an NPV model that excludes sunk costs.

Knowledge check. Which statement is most defensible?

Option A. Sunk costs are already incurred and are not incremental to the decision.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Sunk costs are already incurred and are not incremental to the decision.. Sunk costs are already incurred and are not incremental to the decision. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 19.2: Cost of Capital and WACC

Corporate Finance and Capital Allocation: WACC blends required returns using market-value financing weights and matching risk.

Here is the simple version. Harbor Bikes gets 60% of its money from owners who want 10% a year. The other 40% is loans at 5%, but with a 20% tax rate, interest cuts taxes, so they really cost 4%. Blended, that is 60% of 10% plus 40% of 4%, or 7.6%. A risky scooter project costs $102 and hopes to pay $112 in a year. At 7.6% it seems worth about $104, but at a 12% rate that fits its risk, it is worth $100, a loss of $2. Riskier projects need their own, higher rate.

Point 1. WACC blends required returns using market-value financing weights and matching risk.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Estimate WACC and stress beta, credit spread, and tax rate.

Knowledge check. Which statement is most defensible?

Option A. A corporate WACC should not discount every project regardless of project risk.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A corporate WACC should not discount every project regardless of project risk.. A corporate WACC should not discount every project regardless of project risk. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 19.3: Capital Structure and Financial Flexibility

Corporate Finance and Capital Allocation: Debt can add tax benefits and discipline while increasing distress, agency, and refinancing risk.

Here is the simple version. Sunny Juice needs $1,000: plan A uses only owners' money, and plan B borrows $500 at 10%, or $50 of interest a year. In a good year the business makes $150, so plan A owners earn 15%, but plan B owners keep $100 on their $500, or 20%. In a bad year it makes only $30: plan A still earns 3%, but plan B can't cover its $50 of interest and loses 4%. Debt makes good years better and bad years worse, so the right amount balances both.

Point 1. Debt can add tax benefits and discipline while increasing distress, agency, and refinancing risk.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Compare financing plans under recession and expansion cases.

Knowledge check. Which statement is most defensible?

Option A. Optimal leverage balances benefits against expected distress and constraint costs.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Optimal leverage balances benefits against expected distress and constraint costs.. Optimal leverage balances benefits against expected distress and constraint costs. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 19.4: Payout Policy, Buybacks, and Dilution

Corporate Finance and Capital Allocation: Dividends, repurchases, issuance, and stock compensation redistribute cash and ownership differently.

Here is the simple version. Willow Books has 1,000 shares and spends $1,000 buying back 50 of them at $20 each. Sounds like fewer shares, but it also hands employees 60 new shares as pay. So the count goes 1,000 minus 50 plus 60, which is 1,010, or 10 more than before. Maya's 100 shares slip from owning 10% of the company to 9.9%. Check the net share count, not just the buyback headline.

Point 1. Dividends, repurchases, issuance, and stock compensation redistribute cash and ownership differently.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Reconcile gross buybacks with net share-count change.

Knowledge check. Which statement is most defensible?

Option A. A repurchase may fail to reduce shares when issuance and compensation offset it.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A repurchase may fail to reduce shares when issuance and compensation offset it.. A repurchase may fail to reduce shares when issuance and compensation offset it. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 19.5: Mergers, Synergies, and Restructuring

Corporate Finance and Capital Allocation: Deal value depends on standalone value, credible synergies, price paid, financing, integration, and incentives.

Here is the simple version. Big Bakery earns $100 a year with 100 shares, so $1 a share. It borrows $200 at 3% to buy Tiny Cafe, which earns $10: $100 plus $10 minus $6 of interest is $104. Earnings per share rise to $1.04, which looks like a win. But owners need 8% a year, so if the cafe earns $10 every year forever, it is worth $10 divided by 8%, or $125. So paying $200 wastes $75: higher earnings per share do not mean more value, and taxes are ignored here.

Point 1. Deal value depends on standalone value, credible synergies, price paid, financing, integration, and incentives.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Build an accretion and value-creation bridge.

Knowledge check. Which statement is most defensible?

Option A. EPS accretion can occur even when an acquisition destroys economic value.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. EPS accretion can occur even when an acquisition destroys economic value.. EPS accretion can occur even when an acquisition destroys economic value. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 20

We are beginning module 20. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 20.1: Risk, Return, and the CAPM

Asset Pricing and Valuation: CAPM links expected excess return to market beta under restrictive assumptions.

Here is the simple version. When the whole market moves 4%, Zoom Kite tends to move 6%, so its beta, its sensitivity to the market, is 1.5. With a safe rate of 3% and the market expected to earn 8%, the extra pay for market risk is 5%. The model expects Zoom Kite to earn 3% plus 1.5 times 5%, or 10.5%. Pillow Mills has a beta of only 0.5, for 5.5%, but if its only factory floods, it can still fall hard. Beta measures moving with the market, not every way to lose money.

Point 1. CAPM links expected excess return to market beta under restrictive assumptions.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Estimate beta and separate total from systematic risk.

Knowledge check. Which statement is most defensible?

Option A. Beta measures market covariance, not the full probability of loss.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Beta measures market covariance, not the full probability of loss.. Beta measures market covariance, not the full probability of loss. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 20.2: Multifactor Models and Factor Crowding

Asset Pricing and Valuation: Factor models attribute returns to common exposures plus residuals, but definitions and premia can drift.

Here is the simple version. Nia's pretend portfolio gained 12%, and a factor model splits it into pieces. It moves one for one with the market, which rose 8%, so that piece is 8%. Small companies beat big ones by 2%, and her half tilt toward them adds 1%. Cheap stocks beat pricey ones by 4%, and her half tilt toward them adds 2%. That explains 11%, leaving 1% that could be skill or luck. If crowds pile into cheap stocks, that piece can flip negative: labels describe exposure, not a promise.

Point 1. Factor models attribute returns to common exposures plus residuals, but definitions and premia can drift.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Decompose a portfolio into market, size, value, quality, and momentum.

Knowledge check. Which statement is most defensible?

Option A. Factor labels describe modeled exposure rather than guaranteed causal engines.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Factor labels describe modeled exposure rather than guaranteed causal engines.. Factor labels describe modeled exposure rather than guaranteed causal engines. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 20.3: Residual Income and Economic Profit

Asset Pricing and Valuation: Residual-income valuation adds current book value to discounted future profits above the equity charge.

Here is the simple version. Maya's bakery uses $1,000 of the owners' money, and they want 10% a year: a bar of $100. This year it earns $80, a real profit but $20 below the bar: residual income of minus $20. Falling $20 short every year, forever, costs $20 divided by 10%, or $200, in today's money. So the bakery is worth $1,000 minus $200, or just $800. Earning $150 instead would clear the bar by $50, making it worth $1,500. Profit creates value only when it beats what the owners' money could earn elsewhere.

Point 1. Residual-income valuation adds current book value to discounted future profits above the equity charge.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Value a firm whose accounting book value is informative.

Knowledge check. Which statement is most defensible?

Option A. Positive accounting profit can coexist with negative residual income.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Positive accounting profit can coexist with negative residual income.. Positive accounting profit can coexist with negative residual income. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 20.4: Real Options and Strategic Flexibility

Asset Pricing and Valuation: Management flexibility to delay, expand, contract, or abandon can have option value.

Here is the simple version. Leo can test a pretend fun park for $100, then build it fully for $200 more. Half the time the town loves it and the park is worth $500; half the time it is worth only $100. Building no matter what gives 50% of $500 plus 50% of $100, or $300, minus $300 spent, which is $0. If he can stop after the test, he builds only in the good case and expects a gain of $50. That $50 is the value of the choice to stop, ignoring the time value of money.

Point 1. Management flexibility to delay, expand, contract, or abandon can have option value.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Value a staged investment with an abandonment decision.

Knowledge check. Which statement is most defensible?

Option A. Flexibility is valuable when uncertainty exists and decisions can adapt.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Flexibility is valuable when uncertainty exists and decisions can adapt.. Flexibility is valuable when uncertainty exists and decisions can adapt. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 20.5: Scenario Valuation and Expectations Investing

Asset Pricing and Valuation: A market price can be translated into the operating path required to justify it.

Here is the simple version. Say all of Seashell Snacks is priced at $1,250, and buyers want 8% a year back. To be worth $1,250 with the same profit every year forever, it needs $1,250 times 8%, or $100 a year. Today it earns $50, a 10% profit margin on $500 of sales, so the price quietly assumes profit doubles. That could mean sales growing to $1,000 at the same margin, or the margin rising to 20%. Working backward shows what the price expects; the real question is whether that is believable.

Point 1. A market price can be translated into the operating path required to justify it.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Reverse-engineer revenue growth and margins from enterprise value.

Knowledge check. Which statement is most defensible?

Option A. Reverse valuation exposes embedded expectations rather than declaring one true value.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Reverse valuation exposes embedded expectations rather than declaring one true value.. Reverse valuation exposes embedded expectations rather than declaring one true value. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 21

We are beginning module 21. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 21.1: Mean-Variance Frontiers and Their Limits

Portfolio and Institutional Investing: Efficient frontiers are sensitive to estimated returns, covariances, constraints, and regime changes.

Here is the simple version. Maya's robot splits $100 between two twin funds that move almost together, and it leans toward whichever fund has the higher guessed return. She guesses 6% for both, so the robot puts $50 in each. Now she nudges one guess up to 7%, just one point higher. The robot flips to $100 and $0, so a tiny guess moved $50. An optimizer is only as good as its guesses, so test other guesses and add limits.

Point 1. Efficient frontiers are sensitive to estimated returns, covariances, constraints, and regime changes.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Build a frontier and perturb one expected-return input.

Knowledge check. Which statement is most defensible?

Option A. Small input errors can cause extreme changes in optimized weights.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Small input errors can cause extreme changes in optimized weights.. Small input errors can cause extreme changes in optimized weights. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 21.2: Asset Allocation and Rebalancing

Portfolio and Institutional Investing: Strategic allocation sets long-run risk while rebalancing restores exposures and imposes discipline.

Here is the simple version. Leo wants 60% stocks and 40% bonds, so he splits $1,000 into $600 and $400. Stocks jump 50% to $900, so now about 69% of his $1,300 is in stocks, more risk than he chose. To get back on plan he needs 60% of $1,300, which is $780, so he moves $120 from stocks to bonds. Now he has $780 in stocks and $520 in bonds, back to his mix. Rebalancing keeps the risk he chose, but it does not promise more money.

Point 1. Strategic allocation sets long-run risk while rebalancing restores exposures and imposes discipline.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Compare calendar, threshold, and cash-flow rebalancing.

Knowledge check. Which statement is most defensible?

Option A. Rebalancing controls allocation; it does not guarantee higher returns.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Rebalancing controls allocation; it does not guarantee higher returns.. Rebalancing controls allocation; it does not guarantee higher returns. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 21.3: Endowments, Liquidity, and Private Assets

Portfolio and Institutional Investing: Long horizons can support illiquidity, but spending needs, capital calls, valuation lags, and governance constrain allocations.

Here is the simple version. Oakview School's fund has $100 million: $60 million locked in private funds, $40 million it can sell. In a bad year, the sellable part drops 25% to $30 million; the locked part's drop shows up later. That year it owes $5 million for scholarships, and a private fund it promised money to calls for $10 million. Paying both leaves $15 million to sell; the $10 million joins the locked part, now $70 million. So only $15 million of $85 million, about 18%, can still be sold, and bills due soon cannot wait for the long run.

Point 1. Long horizons can support illiquidity, but spending needs, capital calls, valuation lags, and governance constrain allocations.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Stress an endowment during a simultaneous drawdown and capital call.

Knowledge check. Which statement is most defensible?

Option A. A long horizon does not eliminate near-term liquidity obligations.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A long horizon does not eliminate near-term liquidity obligations.. A long horizon does not eliminate near-term liquidity obligations. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 21.4: Performance Attribution and Benchmarking

Portfolio and Institutional Investing: Attribution separates allocation, selection, interaction, factor, currency, and implementation effects.

Here is the simple version. Nia's fund may only buy small companies, and it returned 12% this year. She compares it to a big-company index that returned 8% and cheers about beating it by 4 points. But the right ruler for a small-company fund is a small-company index, which returned 14%. 12% minus 14% means she actually trailed by 2 points, and that gap is what attribution tries to explain. Measured with the right ruler, Nia's 12% is a 2-point shortfall, not a 4-point win.

Point 1. Attribution separates allocation, selection, interaction, factor, currency, and implementation effects.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Explain active return against a stated benchmark.

Knowledge check. Which statement is most defensible?

Option A. A benchmark must reflect the mandate before performance can be judged fairly.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A benchmark must reflect the mandate before performance can be judged fairly.. A benchmark must reflect the mandate before performance can be judged fairly. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 21.5: Manager Selection, Fees, and Persistence

Portfolio and Institutional Investing: Manager evaluation requires philosophy, process, people, portfolio, performance, price, and capacity.

Here is the simple version. Say 64 pretend managers each flip a coin every year, and heads means they beat the market. After three years, 64 halves to 32, then 16, then 8 with perfect streaks from pure luck. One lucky star, Theo, earned 10% but charges a 2% fee, so investors keep 8%. A plain index fund earned 9% and charges 0.1%, so investors keep 8.9%. A hot streak alone is weak proof of skill, and fees come out every year.

Point 1. Manager evaluation requires philosophy, process, people, portfolio, performance, price, and capacity.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Compare gross alpha with net, risk-adjusted, capacity-aware results.

Knowledge check. Which statement is most defensible?

Option A. Past outperformance alone is weak evidence of persistent skill.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Past outperformance alone is weak evidence of persistent skill.. Past outperformance alone is weak evidence of persistent skill. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 22

We are beginning module 22. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 22.1: Bond Pricing and Yield Measures

Fixed Income and Credit: Bond price is discounted contractual cash flow; yield measures compress assumptions and can mislead.

Here is the simple version. Maple Town's one-year bond pays $5 of interest plus the $100 back, so $105 in all. Valued at 10% a year, that is $105 divided by 1.1, so Leo pays about $95 today. Current yield only counts the interest: $5 a year on that price is about 5.2%. Yield to maturity also counts the climb back to $100, so it is 10%, if Leo holds to the end and Maple Town pays. Price is future cash valued in today's money, and each yield counts different things.

Point 1. Bond price is discounted contractual cash flow; yield measures compress assumptions and can mislead.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Price a coupon bond and compare current yield with yield to maturity.

Knowledge check. Which statement is most defensible?

Option A. Yield to maturity assumes reinvestment and holding conditions that may not occur.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Yield to maturity assumes reinvestment and holding conditions that may not occur.. Yield to maturity assumes reinvestment and holding conditions that may not occur. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 22.2: Duration, Convexity, and Curve Risk

Fixed Income and Credit: Parallel duration misses twists, butterflies, optionality, and changing credit spreads.

Here is the simple version. Omar has two bond piles, each with a duration of 5, so each drops about 5% if every rate rises 1%. Pile A is one five-year bond; pile B is half a one-year and half a nine-year bond, each paying only at the end. Now the rates twist: the one-year rate rises 1%, the nine-year rate falls 1%, and the five-year rate holds. Pile A barely moves, but pile B's short half drops 1% and its long half gains 9%, so the whole pile gains about 4%. Duration assumes every rate moves alike, so it could not tell these two piles apart.

Point 1. Parallel duration misses twists, butterflies, optionality, and changing credit spreads.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Estimate key-rate exposures across the yield curve.

Knowledge check. Which statement is most defensible?

Option A. Two bonds with equal duration can respond differently to a curve twist.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Two bonds with equal duration can respond differently to a curve twist.. Two bonds with equal duration can respond differently to a curve twist. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 22.3: Credit Analysis and Default Probability

Fixed Income and Credit: Credit work links business resilience, cash flow, covenants, collateral, seniority, recovery, and refinancing.

Here is the simple version. Zoe can lend $100 for a year to Steady Bakery at 4% or to Shaky Shoes at 12%. Say Shaky pays back $112 nine times in ten, but one time in ten it goes broke and Zoe gets only $40. On average that is $100.80 plus $4, or $104.80, just a 4.8% return. Most of that 12% is pay for the risk of loss, not extra return for nothing.

Point 1. Credit work links business resilience, cash flow, covenants, collateral, seniority, recovery, and refinancing.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Build a downside debt-service and recovery waterfall.

Knowledge check. Which statement is most defensible?

Option A. A high yield can compensate for risk or signal expected impairment; it is not free return.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A high yield can compensate for risk or signal expected impairment; it is not free return.. A high yield can compensate for risk or signal expected impairment; it is not free return. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 22.4: Securitization and Structured Credit

Fixed Income and Credit: Structured products redistribute cash-flow priority and risk through pools, tranches, triggers, and credit support.

Here is the simple version. Ten lemonade-stand loans of $10 each make a $100 pool, sliced into Senior $70, Middle $20, and Junior $10. Losses eat from the bottom up, so Junior loses first and Senior loses last. If two loans fail, the $20 loss wipes out Junior and takes $10 from Middle, while Senior is untouched. If four fail, the $40 loss wipes out Junior and Middle, and Senior still loses $10, about 14%. Layers change who loses first, but the loan risk is still there.

Point 1. Structured products redistribute cash-flow priority and risk through pools, tranches, triggers, and credit support.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Allocate losses across an example capital structure.

Knowledge check. Which statement is most defensible?

Option A. Seniority changes loss timing and probability but does not eliminate underlying asset risk.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Seniority changes loss timing and probability but does not eliminate underlying asset risk.. Seniority changes loss timing and probability but does not eliminate underlying asset risk. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 22.5: Repo, Funding Liquidity, and Leverage Cycles

Fixed Income and Credit: Short-term secured funding can amplify shocks when haircuts rise and collateral prices fall.

Here is the simple version. Leo owns $100 of bonds, but only $10 is his money: he borrowed $90, and the lender keeps a 10% cushion called a haircut. The bonds dip 5% to $95, and the nervous lender raises the haircut to 20%. Now it will lend only $76, but Leo owes $90, a $14 gap. Selling $1 of bonds repays $1 of loan but cuts his borrowing limit by $0.80, closing only $0.20 of the gap. So he must sell $70 of bonds, leaving a $20 loan on $25 of bonds. When many borrowers are forced to sell at once, prices fall further and lenders get stricter.

Point 1. Short-term secured funding can amplify shocks when haircuts rise and collateral prices fall.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Simulate a margin spiral after a collateral decline.

Knowledge check. Which statement is most defensible?

Option A. Forced deleveraging can create feedback between prices and funding constraints.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Forced deleveraging can create feedback between prices and funding constraints.. Forced deleveraging can create feedback between prices and funding constraints. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 23

We are beginning module 23. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 23.1: Forwards, Futures, and Basis

Derivatives and Risk Transfer: Forward prices reflect carry, income, financing, storage, and constraints rather than a simple price forecast.

Here is the simple version. A ton of wheat costs $100 today. If Iris buys it now, a year in a silo costs her $2, and she gives up $5 of interest at 5%. So a one-year futures deal, an agreement today to buy later at a set price, should cost about $107, even if everyone expects $100. That $7 gap between the futures price and today's price is the basis, and here it is just the cost of carrying the wheat. The $107 is today's price plus carrying costs, not anyone's forecast.

Point 1. Forward prices reflect carry, income, financing, storage, and constraints rather than a simple price forecast.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Calculate fair value and diagnose a basis difference.

Knowledge check. Which statement is most defensible?

Option A. Futures price and expected spot price are distinct concepts.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Futures price and expected spot price are distinct concepts.. Futures price and expected spot price are distinct concepts. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 23.2: Swaps and Counterparty Exposure

Derivatives and Risk Transfer: Swaps exchange cash-flow rules while creating market, collateral, liquidity, legal, and counterparty risks.

Here is the simple version. Maya's bakery owes $1,000 at a floating rate that can move up or down. In a swap with Otterbrook Bank, she pays a fixed 5%, or $50 a year, and the bank pays her the floating rate. Rates jump to 8%, so her loan costs $80, but the bank sends her $80 and she still pays just $50. If the bank fails, though, she is stuck paying $80, which is $30 more a year. The swap fixed Maya's $50 cost, but only as long as the bank keeps paying.

Point 1. Swaps exchange cash-flow rules while creating market, collateral, liquidity, legal, and counterparty risks.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Map fixed-versus-floating payments after a rate shock.

Knowledge check. Which statement is most defensible?

Option A. A swap can hedge rate exposure while adding counterparty and basis risk.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A swap can hedge rate exposure while adding counterparty and basis risk.. A swap can hedge rate exposure while adding counterparty and basis risk. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 23.3: Put-Call Parity and No-Arbitrage

Derivatives and Risk Transfer: Put-call parity links European options, stock, strike present value, and dividends.

Here is the simple version. For options used only at expiration, with no dividends and zero interest, a call minus a put should equal the stock minus the strike. Button Toys is at $52 and the strike is $50, so the call minus the put should be $2. The market shows a call at $5 and a put at $2, a $3 gap, so it is $1 too big. But trading all the pieces costs $1.20 in fees and borrowing, so the free-looking $1 becomes a loss of $0.20. A gap only matters if it beats the costs of trading it.

Point 1. Put-call parity links European options, stock, strike present value, and dividends.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Find the mispriced leg in a parity table.

Knowledge check. Which statement is most defensible?

Option A. A parity violation must exceed transaction, funding, borrow, and execution costs to be actionable.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A parity violation must exceed transaction, funding, borrow, and execution costs to be actionable.. A parity violation must exceed transaction, funding, borrow, and execution costs to be actionable. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 23.4: Dynamic Hedging and Gamma Risk

Derivatives and Risk Transfer: Delta hedges are local and require rebalancing as price, time, and volatility change.

Here is the simple version. Ravi sold call options on 100 shares of Juniper Kites; at $50 they act like 50 shares, so he owns 50 shares to balance. The price rises to $55, the options now act like 70 shares, so he buys 20 more at $55. Then it falls back to $50, and he sells those 20 shares at $50. Buying high and selling low cost him 20 times $5, which is $100. That is short gamma risk, and the option premium he collected is what has to pay for it.

Point 1. Delta hedges are local and require rebalancing as price, time, and volatility change.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Rehedge a short-gamma position across a volatile path.

Knowledge check. Which statement is most defensible?

Option A. Short gamma often forces buying after rises and selling after falls.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Short gamma often forces buying after rises and selling after falls.. Short gamma often forces buying after rises and selling after falls. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 23.5: Volatility Trading and Event Risk

Derivatives and Risk Transfer: Option prices reflect distributions, supply-demand, jumps, skew, term structure, and event uncertainty.

Here is the simple version. Before Glowworm Games reports earnings, a straddle, a call plus a put, costs $8 on its $100 stock. So the market is pricing a move of about $8, and Lena sells the straddle, owing the size of the move. Say there is a 70% chance of a $4 move and a 30% chance of a $20 jump. Her average payout is $2.80 plus $6, or $8.80, more than the $8 she collected. Selling pricey-looking options can still lose when the real moves are bigger.

Point 1. Option prices reflect distributions, supply-demand, jumps, skew, term structure, and event uncertainty.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Compare implied move with a scenario distribution around earnings.

Knowledge check. Which statement is most defensible?

Option A. Selling high implied volatility can still lose when realized moves or skew dynamics are larger.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Selling high implied volatility can still lose when realized moves or skew dynamics are larger.. Selling high implied volatility can still lose when realized moves or skew dynamics are larger. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 24

We are beginning module 24. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 24.1: Venue Design and Order Priority

Market Microstructure and Execution: Price-time, pro-rata, auctions, maker-taker fees, and tick sizes shape order behavior.

Here is the simple version. Three buyers wait at $10: Iris wants 100 shares and came first, Kofi wants 300, and Zoe wants 600. A seller sells 500 shares at that price. First come, first served gives Iris 100, Kofi 300, and Zoe only 100. Sharing by size gives each buyer half of what they asked for: 50, 150, and 300. Same price, different rulebook, different fills.

Point 1. Price-time, pro-rata, auctions, maker-taker fees, and tick sizes shape order behavior.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Compare queue outcomes under two priority rules.

Knowledge check. Which statement is most defensible?

Option A. Execution priority depends on the venue rulebook, not just displayed price.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Execution priority depends on the venue rulebook, not just displayed price.. Execution priority depends on the venue rulebook, not just displayed price. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 24.2: Liquidity, Spread, and Adverse Selection

Market Microstructure and Execution: Spreads compensate liquidity providers for processing, inventory, and informed-flow risks.

Here is the simple version. Ravi, a market maker, buys at $9.90 and sells at $10.10, so he earns about $0.10 a share from each ordinary customer. Some customers know news he does not, and each of them costs him $0.50. With nine ordinary customers and one who knows news, he nets $0.40. With seven ordinary customers and three who know news, he loses $0.80. So when more traders know more than he does, Ravi has to widen his spread.

Point 1. Spreads compensate liquidity providers for processing, inventory, and informed-flow risks.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Decompose quoted and effective spread in a trade sample.

Knowledge check. Which statement is most defensible?

Option A. A wider spread can reflect greater adverse-selection or inventory risk.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A wider spread can reflect greater adverse-selection or inventory risk.. A wider spread can reflect greater adverse-selection or inventory risk. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 24.3: Hidden Liquidity, Dark Pools, and Auctions

Market Microstructure and Execution: Not all interest is displayed, so the visible book is an incomplete map of supply and demand.

Here is the simple version. The screen shows just 100 shares for sale at $20. Buyers take those 100 shares eight times in a row, and each time a fresh 100 appears. So at least 800 shares were for sale, at least 700 more than the screen showed. That hints at a hidden seller, but nobody can see its full size or why it is selling. The visible order book is an incomplete map, so refills are hints, not proof.

Point 1. Not all interest is displayed, so the visible book is an incomplete map of supply and demand.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Infer hidden replenishment without claiming certainty.

Knowledge check. Which statement is most defensible?

Option A. Repeated fills at a level may suggest hidden interest but do not reveal its full size or intent.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Repeated fills at a level may suggest hidden interest but do not reveal its full size or intent.. Repeated fills at a level may suggest hidden interest but do not reveal its full size or intent. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 24.4: Transaction Costs and Market Impact

Market Microstructure and Execution: Implementation shortfall includes delay, spread, fees, price impact, opportunity cost, and missed trades.

Here is the simple version. Lena decides to buy 1,000 shares at $50, and every cost is measured from that decision price. Buying all at once pushes her average to $50.40, so the rush costs $0.40 a share, or $400. Buying slowly costs only $0.15 extra on 800 shares, which is $120. But the price runs to $51 before she gets the last 200, and missing them costs $200, so $320 in all. Fast buying pays in price impact, slow buying risks missed trades, and both are real costs.

Point 1. Implementation shortfall includes delay, spread, fees, price impact, opportunity cost, and missed trades.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Estimate cost for urgent versus patient execution.

Knowledge check. Which statement is most defensible?

Option A. Larger and faster orders usually consume more liquidity and increase impact.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Larger and faster orders usually consume more liquidity and increase impact.. Larger and faster orders usually consume more liquidity and increase impact. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 24.5: Best Execution and Routing Conflicts

Market Microstructure and Execution: Best execution is a process balancing price, speed, likelihood, size, and total circumstances.

Here is the simple version. Sam buys 100 shares, and Broker A charges no commission but fills him at $10.05, so he pays $1,005. Broker B charges a $1 commission but gets a better fill at $10, so he pays $1,001. The free trade actually cost $4 more. A broker may also be paid for where it sends orders, so it is fair to ask how routing is decided. Best execution means judging the total cost, not the sticker.

Point 1. Best execution is a process balancing price, speed, likelihood, size, and total circumstances.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Audit two routing outcomes including rebates and improvement.

Knowledge check. Which statement is most defensible?

Option A. The lowest explicit commission does not prove best execution.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. The lowest explicit commission does not prove best execution.. The lowest explicit commission does not prove best execution. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 25

We are beginning module 25. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 25.1: Prospect Theory and Loss Aversion

Behavioral Finance and Decision Science: People often evaluate gains and losses relative to a reference point and weight losses more heavily.

Here is the simple version. Maya and Leo both end the week with $150. Maya started at $100, so she feels a happy gain of $50. Leo had $200 last week, so he feels a loss of $50. For many people, losses feel about twice as strong as gains, so his $50 stings like $100. Same $150, different starting points, and that alone can change what people choose.

Point 1. People often evaluate gains and losses relative to a reference point and weight losses more heavily.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Reframe the same payoff around two reference points.

Knowledge check. Which statement is most defensible?

Option A. Changing a reference point can change choice without changing final wealth.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Changing a reference point can change choice without changing final wealth.. Changing a reference point can change choice without changing final wealth. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 25.2: Overconfidence and Calibration

Behavioral Finance and Decision Science: Confidence should match empirical accuracy; narrow ranges and excessive trading often reveal miscalibration.

Here is the simple version. Leo made 20 predictions and said he was 70% sure each time. If he were well calibrated, about 70% of them, or 14, would come true. Only 10 did, which is 50%. So his confidence ran 20 points too high. Being 70% sure should mean being right about 70% of the time over many tries.

Point 1. Confidence should match empirical accuracy; narrow ranges and excessive trading often reveal miscalibration.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Record probability forecasts and build a calibration curve.

Knowledge check. Which statement is most defensible?

Option A. A calibrated 70% forecast should occur roughly 70% of the time over many comparable cases.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A calibrated 70% forecast should occur roughly 70% of the time over many comparable cases.. A calibrated 70% forecast should occur roughly 70% of the time over many comparable cases. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 25.3: Anchoring, Recency, and Availability

Behavioral Finance and Decision Science: Salient prices and recent events can distort estimates even when they lack predictive value.

Here is the simple version. Sparrow Pets traded at $80 last year and trades at $40 now, so Zoe says it is half off. But the company earns $2 a share, and similar companies trade at about 15 times earnings. $2 times 15 is $30, so by that yardstick, $40 is still $10 above it, not a bargain. The old $80 is just a sticky memory, and a recent drop can feel more meaningful than it is. An old price is a memory, not a measure of value.

Point 1. Salient prices and recent events can distort estimates even when they lack predictive value.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Make a forecast before and after exposing an irrelevant anchor.

Knowledge check. Which statement is most defensible?

Option A. An old high is psychologically salient but not automatically fair value.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. An old high is psychologically salient but not automatically fair value.. An old high is psychologically salient but not automatically fair value. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 25.4: Herding, Bubbles, and Reflexivity

Behavioral Finance and Decision Science: Social proof, career incentives, leverage, narratives, and feedback can separate price from fundamentals.

Here is the simple version. As a crowd rushes into Zip Scooters, its shares climb from $10 to $20. At $20, selling one million new shares raises $20 million instead of $10 million. That extra cash opens more shops, profits grow, and the rising price has changed the business itself. If the price falls to $5, the same sale raises only $5 million, and new shops get canceled. Price can feed back into the business in both directions, which is how booms and busts grow.

Point 1. Social proof, career incentives, leverage, narratives, and feedback can separate price from fundamentals.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Map a reflexive financing loop during a boom.

Knowledge check. Which statement is most defensible?

Option A. Price can influence fundamentals when it changes financing access or behavior.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Price can influence fundamentals when it changes financing access or behavior.. Price can influence fundamentals when it changes financing access or behavior. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 25.5: Debiasing and Trading Journals

Behavioral Finance and Decision Science: Precommitment, checklists, base rates, decision journals, and independent review create auditable process.

Here is the simple version. Before each trade, Iris writes her reason, her exit point, and the chance she thinks it works: 60%. After 10 trades, 6 worked, which is 60%, right in line with her notes. When one trade lost, a hindsight voice said she knew it was weak all along. But her journal showed what she really thought beforehand, so she judged the plan, not just the ending. Writing reasons before the result keeps hindsight from rewriting the story.

Point 1. Precommitment, checklists, base rates, decision journals, and independent review create auditable process.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Score a decision before its outcome is revealed.

Knowledge check. Which statement is most defensible?

Option A. A journal is useful when it records contemporaneous reasoning rather than hindsight.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A journal is useful when it records contemporaneous reasoning rather than hindsight.. A journal is useful when it records contemporaneous reasoning rather than hindsight. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 26

We are beginning module 26. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 26.1: Securities Law and Disclosure Architecture

Regulation, Governance, and Ethics: Public markets rely on registration, periodic reporting, antifraud rules, and material disclosure.

Here is the simple version. Maple Robotics files its quarterly report: sales were $10 million, up from $8 million, a 25% jump. Public companies must file reports like this, and antifraud rules forbid misleading statements, so a filing is primary evidence. But a footnote says $1.5 million came from one big order that will not happen again. Without it, sales were $8.5 million, growth of only about 6%. A filing is the best place to start, but it still needs careful reading.

Point 1. Public markets rely on registration, periodic reporting, antifraud rules, and material disclosure.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Classify primary filings for a hypothetical issuer event.

Knowledge check. Which statement is most defensible?

Option A. A filing is primary evidence but still requires careful interpretation.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A filing is primary evidence but still requires careful interpretation.. A filing is primary evidence but still requires careful interpretation. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 26.2: Insider Trading and Material Nonpublic Information

Regulation, Governance, and Ethics: Trading duties depend on information, materiality, nonpublic status, relationship, and jurisdiction-specific law.

Here is the simple version. At dinner, Leo's aunt, who works at Tidepool Foods, says it will be bought next week for $30 a share; it trades at $20 today. That is a 50% jump the public does not know about, so it is material, meaning important, and nonpublic, meaning secret. Buying 100 shares to pocket $1,000 would be wrong and can be illegal in many places. So Leo does not trade or tell anyone, writes down what he heard and when, and asks a compliance expert. Important secret news is a stop sign, not a trade idea.

Point 1. Trading duties depend on information, materiality, nonpublic status, relationship, and jurisdiction-specific law.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Identify when to stop and escalate an information scenario.

Knowledge check. Which statement is most defensible?

Option A. When MNPI may be present, the safe process is to stop, preserve facts, and seek qualified compliance advice.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. When MNPI may be present, the safe process is to stop, preserve facts, and seek qualified compliance advice.. When MNPI may be present, the safe process is to stop, preserve facts, and seek qualified compliance advice. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 26.3: Manipulation, Spoofing, and Market Integrity

Regulation, Governance, and Ethics: Deceptive orders, false rumors, wash trades, and coordinated manipulation harm price discovery and can be unlawful.

Here is the simple version. Theo owns 1,000 shares and wants a higher price, so he posts a fake buy order for 10,000 shares, 20 times the real 500. He never plans to let it fill. Others see huge demand, the price ticks from $9.99 to $10.05, and Theo sells there, then cancels the fake order. His extra $60 came from tricking people, which is spoofing and can be illegal. Lena cancels an order because news changed her plan, and that is normal, but faking supply or demand is not.

Point 1. Deceptive orders, false rumors, wash trades, and coordinated manipulation harm price discovery and can be unlawful.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Separate legitimate order cancellation from deceptive intent indicators.

Knowledge check. Which statement is most defensible?

Option A. A trading strategy must not rely on creating a false appearance of supply, demand, or activity.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A trading strategy must not rely on creating a false appearance of supply, demand, or activity.. A trading strategy must not rely on creating a false appearance of supply, demand, or activity. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 26.4: Governance, Agency, and Executive Incentives

Regulation, Governance, and Ethics: Boards, voting, compensation, control rights, and disclosure shape conflicts between stakeholders.

Here is the simple version. Ava runs Birchwood Bikes and gets a $1 million bonus only if profit reaches $10 million. A safe plan makes a sure $9 million, so she gets no bonus. A risky plan has a 50% chance of $12 million and a 50% chance of losing $4 million. After her bonus in the good case, that averages only $3.5 million for the owners. But only the risky plan gives Ava a shot at her bonus. Pay rules can steer a boss toward choices that hurt the owners.

Point 1. Boards, voting, compensation, control rights, and disclosure shape conflicts between stakeholders.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Evaluate a compensation plan for risk-shifting incentives.

Knowledge check. Which statement is most defensible?

Option A. Incentive design can change behavior even when headline targets appear aligned.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Incentive design can change behavior even when headline targets appear aligned.. Incentive design can change behavior even when headline targets appear aligned. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 26.5: Fiduciary Duty, Conflicts, and Suitability

Regulation, Governance, and Ethics: Advice and asset management require identifying duties, clients, conflicts, constraints, and required disclosures.

Here is the simple version. Adviser Omar can suggest Fund X, with a 0.2% yearly fee, or Fund Y, which holds similar things, charges 1.2%, and pays Omar a bonus. On Nia's $10,000, X costs $20 a year and Y costs $120, so $100 more every year. Over ten years that is about $1,000, before any growth. Telling Nia about his bonus does not make Fund Y right for her. An adviser must put Nia's interests ahead of his own bonus.

Point 1. Advice and asset management require identifying duties, clients, conflicts, constraints, and required disclosures.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Write a conflict disclosure and mitigation plan.

Knowledge check. Which statement is most defensible?

Option A. Disclosure alone may not cure a conflict when avoidance or control is required.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Disclosure alone may not cure a conflict when avoidance or control is required.. Disclosure alone may not cure a conflict when avoidance or control is required. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 27

We are beginning module 27. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 27.1: Data Engineering and Point-in-Time Truth

Quantitative and Systematic Research: Research data needs lineage, timestamps, corporate actions, delistings, revisions, and availability dates.

Here is the simple version. Sunny Juice's quarter ends on March 31, but it does not publish results until April 25. A backtest that uses those results on April first is peeking 24 days into the future. In July, the company revises its earnings from $1 to $1.20 a share. A point-in-time table shows $1 from April 25 until July, because that is all anyone knew then. So a fair backtest may use Sunny Juice's results only from April 25, not from April first.

Point 1. Research data needs lineage, timestamps, corporate actions, delistings, revisions, and availability dates.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Build a point-in-time feature table without future leakage.

Knowledge check. Which statement is most defensible?

Option A. The date a fact became knowable matters more than the period it describes.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. The date a fact became knowable matters more than the period it describes.. The date a fact became knowable matters more than the period it describes. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 27.2: Signal Design and Cross-Validation

Quantitative and Systematic Research: A signal needs an economic rationale, precise definition, robust validation, and separation from the test set.

Here is the simple version. Theo has a final exam dataset he promised to open only once. Instead, he tries 20 random signal ideas on it, and each useless idea still has a 5% chance to look good by luck. If the tries are independent, the chance that at least one fake winner shows up is about 64%. Peeking again and again turned the exam into practice; the fix is to learn on older years and test on the next one. Keep the test set unseen until the very end.

Point 1. A signal needs an economic rationale, precise definition, robust validation, and separation from the test set.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Use nested or walk-forward validation for a time-series signal.

Knowledge check. Which statement is most defensible?

Option A. Repeatedly checking the test set turns it into training data.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Repeatedly checking the test set turns it into training data.. Repeatedly checking the test set turns it into training data. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 27.3: Portfolio Construction and Turnover Control

Quantitative and Systematic Research: Signal strength must be translated through risk, costs, capacity, constraints, and turnover.

Here is the simple version. Before costs, Signal A earns 10% a year and Signal B only 7%, but A trades the whole portfolio ten times a year. At 0.5% per full turnover, that costs 5%, leaving 5%. Signal B trades only twice a year, costing 1% and leaving 6%. The weaker-looking signal comes out 1 point ahead after costs. Judge a signal by what it keeps after costs, not by what it earns before them.

Point 1. Signal strength must be translated through risk, costs, capacity, constraints, and turnover.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Compare rank weighting with cost-aware optimization.

Knowledge check. Which statement is most defensible?

Option A. A stronger raw signal can produce a worse net portfolio when turnover and impact dominate.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A stronger raw signal can produce a worse net portfolio when turnover and impact dominate.. A stronger raw signal can produce a worse net portfolio when turnover and impact dominate. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 27.4: Machine Learning Without Leakage

Quantitative and Systematic Research: Financial ML faces nonstationarity, weak signal, dependence, selection bias, and explainability constraints.

Here is the simple version. Zoe's model guesses whether a stock rises tomorrow, and it scores 99% on 1,000 test days. An audit finds a sneaky input: tomorrow's closing price, which nobody knows today. With that leak removed, it gets 520 of 1,000 right, which is 52%, barely above a coin flip's 50%. So 47 points of that score came from leaked future information. High test accuracy means nothing if the future sneaks into the inputs.

Point 1. Financial ML faces nonstationarity, weak signal, dependence, selection bias, and explainability constraints.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Audit a feature pipeline for target and timestamp leakage.

Knowledge check. Which statement is most defensible?

Option A. High validation accuracy can be meaningless when labels or future information leak into features.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. High validation accuracy can be meaningless when labels or future information leak into features.. High validation accuracy can be meaningless when labels or future information leak into features. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 27.5: Monitoring, Drift, and Model Governance

Quantitative and Systematic Research: Production models need data checks, performance bands, drift tests, human escalation, versions, and kill switches.

Here is the simple version. A live model usually gets about 55% of its calls right, and its safe band is 50% to 60%. Its rule says if the last 40 calls score below 50%, pause trading and alert a human. This week it got 18 of 40 right, which is 45%. So the switch pauses it, and the team rolls back to the last good version while they check the data. A model that worked before still needs a scoreboard and an off switch.

Point 1. Production models need data checks, performance bands, drift tests, human escalation, versions, and kill switches.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Design a dashboard and shutdown rule for a live model.

Knowledge check. Which statement is most defensible?

Option A. A model that worked historically still requires ongoing validity and safety monitoring.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A model that worked historically still requires ongoing validity and safety monitoring.. A model that worked historically still requires ongoing validity and safety monitoring. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Module 28

We are beginning module 28. Take a breath, clear any assumptions from the previous section, and focus on the decision process in front of you.

### Lesson 28.1: Pre-Market Planning and Scenario Trees

Applied Trading and Professional Practice: A plan defines catalysts, levels, liquidity, scenarios, triggers, invalidations, size, and no-trade conditions before volatility.

Here is the simple version. Before the opening bell, Maya writes three paths for Orbit Oats, now at $20: above $21, between $19 and $21, or below $19. If it opens above $21 and holds, her plan buys 100 shares with an exit at $20.50, risking at least 100 times $0.50, or $50. If it chops between $19 and $21, no trade, and if it drops below $19, no buying at all. She guesses the paths at 30%, 50%, and 20%, which add up to 100%. When the bell rings, she follows the branch instead of forcing one prediction.

Point 1. A plan defines catalysts, levels, liquidity, scenarios, triggers, invalidations, size, and no-trade conditions before volatility.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Build a three-branch opening scenario tree.

Knowledge check. Which statement is most defensible?

Option A. Planning multiple paths reduces the urge to force one prediction.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Planning multiple paths reduces the urge to force one prediction.. Planning multiple paths reduces the urge to force one prediction. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 28.2: Intraday Risk, Halts, and Gap Exposure

Applied Trading and Professional Practice: Day-trade risk includes spread expansion, volatility halts, gaps, borrow changes, platform failure, and correlated positions.

Here is the simple version. Leo buys 200 shares of Nova Rockets at $5 with a stop at $4.80, planning to risk $40. News hits, trading halts, and the stock reopens at $4. His stop triggers, but it becomes a market order and fills at $4, not $4.80. He loses $1 a share, or $200, five times his plan. His stop only decided when to sell, not the price he got.

Point 1. Day-trade risk includes spread expansion, volatility halts, gaps, borrow changes, platform failure, and correlated positions.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Stress a small-cap plan through a halt and reopening auction.

Knowledge check. Which statement is most defensible?

Option A. A stop order cannot guarantee a fill price through a gap or halt.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A stop order cannot guarantee a fill price through a gap or halt.. A stop order cannot guarantee a fill price through a gap or halt. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 28.3: Tape Replay and Evidence Scoring

Applied Trading and Professional Practice: Tape reading is a probabilistic synthesis of executed flow, price response, pace, spread, depth, and context.

Here is the simple version. Earlier, just 1,000 shares of buying pushed the price up 5 cents to $10. Now buyers keep buying from sellers at $10, and 5,000 shares trade in two minutes. But the price never gets even one cent higher. Five times the buying with zero progress suggests a big seller is soaking it up, which traders call absorption. It warns that the climb may be over, but it is a clue to weigh, not proof of what comes next.

Point 1. Tape reading is a probabilistic synthesis of executed flow, price response, pace, spread, depth, and context.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Score a replay before revealing subsequent trades.

Knowledge check. Which statement is most defensible?

Option A. Executed aggression without price progress may indicate absorption rather than continuation.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Executed aggression without price progress may indicate absorption rather than continuation.. Executed aggression without price progress may indicate absorption rather than continuation. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 28.4: Trade Review and Performance Decomposition

Applied Trading and Professional Practice: Professional review separates setup, selection, sizing, execution, risk, market regime, and luck.

Here is the simple version. Nia planned to buy 100 shares at $10 with a stop at $9.50, risking $50. Instead she bought 300 shares late at $10.20 and sold at $10.80, making $180. Split it up: the planned trade would have made $80, the extra size added $160, and the late entry cost $60. It was a win, but her real risk was $210 instead of $50. A good result can hide a poor process, so review the parts, not just the total.

Point 1. Professional review separates setup, selection, sizing, execution, risk, market regime, and luck.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Decompose one trade into planned and unplanned P&L.

Knowledge check. Which statement is most defensible?

Option A. A winning trade can reflect poor process and a losing trade can follow sound process.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. A winning trade can reflect poor process and a losing trade can follow sound process.. A winning trade can reflect poor process and a losing trade can follow sound process. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

### Lesson 28.5: Master Capstone: Research, Trade, and Defend

Applied Trading and Professional Practice: A complete decision joins primary evidence, valuation, market structure, probability, execution, risk, ethics, and falsification.

Here is the simple version. To a pretend risk committee, Maya defends Harbor Bikes: a filing shows sales up 20%, and she values it at $25 versus $20 today. She is wrong below $18, so with 20 shares she risks $2 each, or $40, to try to make $5 each. Winning $5 against losing $2 only pays on average if she is right more than two times in seven, about 29%. A committee member pushes back that bike sales are seasonal, which could lower her odds. A strong idea is sourced, does the math, and stays open to being wrong.

Point 1. A complete decision joins primary evidence, valuation, market structure, probability, execution, risk, ethics, and falsification.

Point 2. Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.

Point 3. Interactive lab: Present a thesis and strongest rebuttal to a mock risk committee.

Knowledge check. Which statement is most defensible?

Option A. Professional analysis is sourced, conditional, numerate, reproducible, and open to being wrong.

Option B. One observation proves the conclusion in every market regime.

Option C. Uncertainty and implementation costs can be ignored.

Option D. The model guarantees the future outcome.

The best answer is option A. Professional analysis is sourced, conditional, numerate, reproducible, and open to being wrong.. Professional analysis is sourced, conditional, numerate, reproducible, and open to being wrong. The result remains conditional on data quality, assumptions, and context.

Before continuing, explain the idea in your own words. Name the evidence you would need, the uncertainty you cannot remove, and the condition that would invalidate your conclusion. Then continue to the next lesson.

## Closing

You have reached the end of the Making Easy Money Academy voice curriculum. Completion is not the same thing as mastery. Return to the simulations, work through the calculations, review primary sources, and grade the quality of your process rather than the luck of one outcome. The strongest market student is not the person who sounds most certain. It is the person who can state the evidence, quantify the risk, recognize what is unknown, and change course when the facts change.
