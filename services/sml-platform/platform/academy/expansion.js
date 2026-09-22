'use strict';

const { simulationFor } = require('./simulations');
const { quizFor } = require('./quizzes');

const LEVEL_COLOR = { Foundation: 0x00E676, Intermediate: 0xFFB400, Advanced: 0xFF3D3D };

/* Original Academy lessons benchmarked to the public topic coverage of Harvard
 * and Yale finance/economics curricula. No university course text is copied. */
const MODULES = [
  [14, 'Mathematical Foundations', 'Foundation', [
    ['Compounding, Logarithms, and Growth', 'Compounding is multiplicative; logarithms convert repeated growth into additive terms.', 'Calculate annualized returns across unequal holding periods.', 'Annualized growth must account for both total return and elapsed time.'],
    ['Present Value, Annuities, and Perpetuities', 'Present value discounts future cash flows using a rate consistent with timing and risk.', 'Price a level annuity and stress its discount rate.', 'A higher discount rate lowers present value when cash flows are unchanged.'],
    ['Linear Algebra for Portfolios', 'Portfolio return is a weighted vector product and portfolio variance uses the covariance matrix.', 'Compute return and variance for a three-asset weight vector.', 'Covariances, not just individual volatilities, drive portfolio risk.'],
    ['Optimization and Constraints', 'An unconstrained mathematical optimum may be untradeable once leverage, liquidity, turnover, and concentration limits apply.', 'Solve a simple allocation first without and then with position limits.', 'Constraints belong inside the optimization rather than being checked afterward.'],
    ['Calculus, Sensitivity, and Convexity', 'First derivatives measure local sensitivity while second derivatives describe curvature.', 'Approximate a bond price move with duration and convexity.', 'Convexity improves a linear duration estimate for larger yield changes.']
  ]],
  [15, 'Microeconomics and Strategic Behavior', 'Intermediate', [
    ['Supply, Demand, and Equilibrium', 'Prices coordinate scarce supply and demand, but shifts in either curve change equilibrium.', 'Map a commodity supply shock into price and quantity effects.', 'A movement along a curve differs from a shift of the curve itself.'],
    ['Elasticity and Operating Leverage', 'Elasticity measures proportional responsiveness and helps explain pricing power and revenue sensitivity.', 'Estimate demand elasticity from a price-and-volume scenario.', 'Inelastic demand changes quantity less proportionally than price.'],
    ['Competition, Moats, and Market Power', 'Industry structure influences margins, investment, innovation, and the durability of excess returns.', 'Compare competitive, oligopoly, and monopoly economics.', 'High current margins alone do not prove a durable moat.'],
    ['Game Theory and Repeated Interaction', 'Strategic outcomes depend on incentives, information, credible commitments, and repeated play.', 'Build a payoff matrix for two firms choosing capacity.', 'A dominant strategy is optimal regardless of the rival action.'],
    ['Information Asymmetry and Signaling', 'Managers, lenders, and investors hold unequal information, creating adverse selection and moral hazard.', 'Classify a financing choice as signal, screening device, or incentive.', 'A costly signal is credible only when weaker types find it harder to imitate.']
  ]],
  [16, 'Macroeconomics and Global Markets', 'Intermediate', [
    ['National Accounts and GDP', 'GDP measures final production, while nominal and real measures separate price and quantity changes.', 'Reconcile consumption, investment, government, and net exports.', 'Real GDP removes the effect of changing prices with a price index.'],
    ['Inflation Measurement and Expectations', 'CPI, PCE, headline, core, and market-implied inflation answer different questions.', 'Compare an inflation surprise with breakeven changes.', 'Breakevens include inflation expectations plus risk and liquidity premia.'],
    ['Labor Markets and the Business Cycle', 'Employment, participation, wages, productivity, and vacancies describe different parts of labor-market health.', 'Interpret a payroll gain alongside rising unemployment.', 'Payrolls and unemployment can diverge because they use different surveys and denominators.'],
    ['Central Banks and Monetary Transmission', 'Policy affects markets through expected rate paths, credit, liquidity, currencies, and confidence.', 'Trace a hawkish surprise across bonds, banks, growth stocks, and FX.', 'Asset prices react to the surprise relative to expectations, not the announcement alone.'],
    ['Currencies, Trade, and Balance of Payments', 'Exchange rates connect relative prices, capital flows, trade, policy, and risk appetite.', 'Map a currency appreciation into exporters and importers.', 'A stronger home currency can reduce translated foreign earnings, all else equal.']
  ]],
  [17, 'Statistics and Econometrics', 'Advanced', [
    ['Probability Distributions and Tail Risk', 'Mean and variance are incomplete when returns are skewed, fat-tailed, or state-dependent.', 'Compare normal loss estimates with an empirical tail.', 'Fat tails make extreme observations more frequent than a normal model predicts.'],
    ['Sampling, Estimation, and Confidence Intervals', 'An estimate is uncertain and its interval depends on variation, sample size, and assumptions.', 'Construct and interpret a confidence interval for mean return.', 'A confidence interval describes a repeated-sampling procedure, not a probability that a fixed parameter moved.'],
    ['Hypothesis Tests and Economic Significance', 'Statistical significance does not establish causality, stability, profitability, or economic importance.', 'Test a mean return and subtract estimated trading costs.', 'A tiny effect can be statistically significant yet economically useless.'],
    ['Regression, Omitted Variables, and Causality', 'Regression measures conditional association unless identification supports a causal interpretation.', 'Diagnose omitted-variable bias in a valuation regression.', 'Correlation after controls is not automatically causal evidence.'],
    ['Time Series, Stationarity, and Forecast Error', 'Trends, autocorrelation, seasonality, volatility clustering, and structural breaks require time-aware methods.', 'Run a walk-forward forecast across a regime break.', 'Random train-test shuffling can leak future regimes into financial models.']
  ]],
  [18, 'Financial Reporting and Forensics', 'Advanced', [
    ['Revenue Recognition and Contract Economics', 'Revenue timing depends on performance obligations, control transfer, estimates, and contract terms.', 'Reconcile bookings, billings, revenue, and deferred revenue.', 'Cash collection and revenue recognition can occur in different periods.'],
    ['Inventory, Costing, and Working Capital', 'Inventory methods and write-downs affect margins, taxes, assets, and cash conversion.', 'Trace an inventory build through all three statements.', 'Inventory growth faster than sales can indicate stocking, slowdown, or strategy and needs context.'],
    ['Long-Lived Assets, Intangibles, and Impairment', 'Capitalization shifts expense recognition across periods and can alter apparent profitability.', 'Compare expensing with capitalization for the same investment.', 'Capitalizing a cost raises current profit but creates future amortization or impairment risk.'],
    ['Debt, Leases, Pensions, and Hidden Claims', 'Contractual obligations can create leverage beyond headline borrowings.', 'Build an adjusted leverage bridge including leases and pensions.', 'Enterprise risk depends on economic claims, not only the debt line item.'],
    ['Fraud Signals and Forensic Accounting', 'No ratio proves fraud; investigators triangulate incentives, anomalies, disclosures, cash, counterparties, and governance.', 'Create a forensic checklist for a profit-to-cash divergence.', 'A red flag is a reason to investigate, not a verdict.']
  ]],
  [19, 'Corporate Finance and Capital Allocation', 'Advanced', [
    ['Capital Budgeting and Incremental Cash Flow', 'Project value uses incremental after-tax cash flows including opportunity costs and working capital.', 'Build an NPV model that excludes sunk costs.', 'Sunk costs are already incurred and are not incremental to the decision.'],
    ['Cost of Capital and WACC', 'WACC blends required returns using market-value financing weights and matching risk.', 'Estimate WACC and stress beta, credit spread, and tax rate.', 'A corporate WACC should not discount every project regardless of project risk.'],
    ['Capital Structure and Financial Flexibility', 'Debt can add tax benefits and discipline while increasing distress, agency, and refinancing risk.', 'Compare financing plans under recession and expansion cases.', 'Optimal leverage balances benefits against expected distress and constraint costs.'],
    ['Payout Policy, Buybacks, and Dilution', 'Dividends, repurchases, issuance, and stock compensation redistribute cash and ownership differently.', 'Reconcile gross buybacks with net share-count change.', 'A repurchase may fail to reduce shares when issuance and compensation offset it.'],
    ['Mergers, Synergies, and Restructuring', 'Deal value depends on standalone value, credible synergies, price paid, financing, integration, and incentives.', 'Build an accretion and value-creation bridge.', 'EPS accretion can occur even when an acquisition destroys economic value.']
  ]],
  [20, 'Asset Pricing and Valuation', 'Advanced', [
    ['Risk, Return, and the CAPM', 'CAPM links expected excess return to market beta under restrictive assumptions.', 'Estimate beta and separate total from systematic risk.', 'Beta measures market covariance, not the full probability of loss.'],
    ['Multifactor Models and Factor Crowding', 'Factor models attribute returns to common exposures plus residuals, but definitions and premia can drift.', 'Decompose a portfolio into market, size, value, quality, and momentum.', 'Factor labels describe modeled exposure rather than guaranteed causal engines.'],
    ['Residual Income and Economic Profit', 'Residual-income valuation adds current book value to discounted future profits above the equity charge.', 'Value a firm whose accounting book value is informative.', 'Positive accounting profit can coexist with negative residual income.'],
    ['Real Options and Strategic Flexibility', 'Management flexibility to delay, expand, contract, or abandon can have option value.', 'Value a staged investment with an abandonment decision.', 'Flexibility is valuable when uncertainty exists and decisions can adapt.'],
    ['Scenario Valuation and Expectations Investing', 'A market price can be translated into the operating path required to justify it.', 'Reverse-engineer revenue growth and margins from enterprise value.', 'Reverse valuation exposes embedded expectations rather than declaring one true value.']
  ]],
  [21, 'Portfolio and Institutional Investing', 'Advanced', [
    ['Mean-Variance Frontiers and Their Limits', 'Efficient frontiers are sensitive to estimated returns, covariances, constraints, and regime changes.', 'Build a frontier and perturb one expected-return input.', 'Small input errors can cause extreme changes in optimized weights.'],
    ['Asset Allocation and Rebalancing', 'Strategic allocation sets long-run risk while rebalancing restores exposures and imposes discipline.', 'Compare calendar, threshold, and cash-flow rebalancing.', 'Rebalancing controls allocation; it does not guarantee higher returns.'],
    ['Endowments, Liquidity, and Private Assets', 'Long horizons can support illiquidity, but spending needs, capital calls, valuation lags, and governance constrain allocations.', 'Stress an endowment during a simultaneous drawdown and capital call.', 'A long horizon does not eliminate near-term liquidity obligations.'],
    ['Performance Attribution and Benchmarking', 'Attribution separates allocation, selection, interaction, factor, currency, and implementation effects.', 'Explain active return against a stated benchmark.', 'A benchmark must reflect the mandate before performance can be judged fairly.'],
    ['Manager Selection, Fees, and Persistence', 'Manager evaluation requires philosophy, process, people, portfolio, performance, price, and capacity.', 'Compare gross alpha with net, risk-adjusted, capacity-aware results.', 'Past outperformance alone is weak evidence of persistent skill.']
  ]],
  [22, 'Fixed Income and Credit', 'Advanced', [
    ['Bond Pricing and Yield Measures', 'Bond price is discounted contractual cash flow; yield measures compress assumptions and can mislead.', 'Price a coupon bond and compare current yield with yield to maturity.', 'Yield to maturity assumes reinvestment and holding conditions that may not occur.'],
    ['Duration, Convexity, and Curve Risk', 'Parallel duration misses twists, butterflies, optionality, and changing credit spreads.', 'Estimate key-rate exposures across the yield curve.', 'Two bonds with equal duration can respond differently to a curve twist.'],
    ['Credit Analysis and Default Probability', 'Credit work links business resilience, cash flow, covenants, collateral, seniority, recovery, and refinancing.', 'Build a downside debt-service and recovery waterfall.', 'A high yield can compensate for risk or signal expected impairment; it is not free return.'],
    ['Securitization and Structured Credit', 'Structured products redistribute cash-flow priority and risk through pools, tranches, triggers, and credit support.', 'Allocate losses across an example capital structure.', 'Seniority changes loss timing and probability but does not eliminate underlying asset risk.'],
    ['Repo, Funding Liquidity, and Leverage Cycles', 'Short-term secured funding can amplify shocks when haircuts rise and collateral prices fall.', 'Simulate a margin spiral after a collateral decline.', 'Forced deleveraging can create feedback between prices and funding constraints.']
  ]],
  [23, 'Derivatives and Risk Transfer', 'Advanced', [
    ['Forwards, Futures, and Basis', 'Forward prices reflect carry, income, financing, storage, and constraints rather than a simple price forecast.', 'Calculate fair value and diagnose a basis difference.', 'Futures price and expected spot price are distinct concepts.'],
    ['Swaps and Counterparty Exposure', 'Swaps exchange cash-flow rules while creating market, collateral, liquidity, legal, and counterparty risks.', 'Map fixed-versus-floating payments after a rate shock.', 'A swap can hedge rate exposure while adding counterparty and basis risk.'],
    ['Put-Call Parity and No-Arbitrage', 'Put-call parity links European options, stock, strike present value, and dividends.', 'Find the mispriced leg in a parity table.', 'A parity violation must exceed transaction, funding, borrow, and execution costs to be actionable.'],
    ['Dynamic Hedging and Gamma Risk', 'Delta hedges are local and require rebalancing as price, time, and volatility change.', 'Rehedge a short-gamma position across a volatile path.', 'Short gamma often forces buying after rises and selling after falls.'],
    ['Volatility Trading and Event Risk', 'Option prices reflect distributions, supply-demand, jumps, skew, term structure, and event uncertainty.', 'Compare implied move with a scenario distribution around earnings.', 'Selling high implied volatility can still lose when realized moves or skew dynamics are larger.']
  ]],
  [24, 'Market Microstructure and Execution', 'Advanced', [
    ['Venue Design and Order Priority', 'Price-time, pro-rata, auctions, maker-taker fees, and tick sizes shape order behavior.', 'Compare queue outcomes under two priority rules.', 'Execution priority depends on the venue rulebook, not just displayed price.'],
    ['Liquidity, Spread, and Adverse Selection', 'Spreads compensate liquidity providers for processing, inventory, and informed-flow risks.', 'Decompose quoted and effective spread in a trade sample.', 'A wider spread can reflect greater adverse-selection or inventory risk.'],
    ['Hidden Liquidity, Dark Pools, and Auctions', 'Not all interest is displayed, so the visible book is an incomplete map of supply and demand.', 'Infer hidden replenishment without claiming certainty.', 'Repeated fills at a level may suggest hidden interest but do not reveal its full size or intent.'],
    ['Transaction Costs and Market Impact', 'Implementation shortfall includes delay, spread, fees, price impact, opportunity cost, and missed trades.', 'Estimate cost for urgent versus patient execution.', 'Larger and faster orders usually consume more liquidity and increase impact.'],
    ['Best Execution and Routing Conflicts', 'Best execution is a process balancing price, speed, likelihood, size, and total circumstances.', 'Audit two routing outcomes including rebates and improvement.', 'The lowest explicit commission does not prove best execution.']
  ]],
  [25, 'Behavioral Finance and Decision Science', 'Intermediate', [
    ['Prospect Theory and Loss Aversion', 'People often evaluate gains and losses relative to a reference point and weight losses more heavily.', 'Reframe the same payoff around two reference points.', 'Changing a reference point can change choice without changing final wealth.'],
    ['Overconfidence and Calibration', 'Confidence should match empirical accuracy; narrow ranges and excessive trading often reveal miscalibration.', 'Record probability forecasts and build a calibration curve.', 'A calibrated 70% forecast should occur roughly 70% of the time over many comparable cases.'],
    ['Anchoring, Recency, and Availability', 'Salient prices and recent events can distort estimates even when they lack predictive value.', 'Make a forecast before and after exposing an irrelevant anchor.', 'An old high is psychologically salient but not automatically fair value.'],
    ['Herding, Bubbles, and Reflexivity', 'Social proof, career incentives, leverage, narratives, and feedback can separate price from fundamentals.', 'Map a reflexive financing loop during a boom.', 'Price can influence fundamentals when it changes financing access or behavior.'],
    ['Debiasing and Trading Journals', 'Precommitment, checklists, base rates, decision journals, and independent review create auditable process.', 'Score a decision before its outcome is revealed.', 'A journal is useful when it records contemporaneous reasoning rather than hindsight.']
  ]],
  [26, 'Regulation, Governance, and Ethics', 'Intermediate', [
    ['Securities Law and Disclosure Architecture', 'Public markets rely on registration, periodic reporting, antifraud rules, and material disclosure.', 'Classify primary filings for a hypothetical issuer event.', 'A filing is primary evidence but still requires careful interpretation.'],
    ['Insider Trading and Material Nonpublic Information', 'Trading duties depend on information, materiality, nonpublic status, relationship, and jurisdiction-specific law.', 'Identify when to stop and escalate an information scenario.', 'When MNPI may be present, the safe process is to stop, preserve facts, and seek qualified compliance advice.'],
    ['Manipulation, Spoofing, and Market Integrity', 'Deceptive orders, false rumors, wash trades, and coordinated manipulation harm price discovery and can be unlawful.', 'Separate legitimate order cancellation from deceptive intent indicators.', 'A trading strategy must not rely on creating a false appearance of supply, demand, or activity.'],
    ['Governance, Agency, and Executive Incentives', 'Boards, voting, compensation, control rights, and disclosure shape conflicts between stakeholders.', 'Evaluate a compensation plan for risk-shifting incentives.', 'Incentive design can change behavior even when headline targets appear aligned.'],
    ['Fiduciary Duty, Conflicts, and Suitability', 'Advice and asset management require identifying duties, clients, conflicts, constraints, and required disclosures.', 'Write a conflict disclosure and mitigation plan.', 'Disclosure alone may not cure a conflict when avoidance or control is required.']
  ]],
  [27, 'Quantitative and Systematic Research', 'Advanced', [
    ['Data Engineering and Point-in-Time Truth', 'Research data needs lineage, timestamps, corporate actions, delistings, revisions, and availability dates.', 'Build a point-in-time feature table without future leakage.', 'The date a fact became knowable matters more than the period it describes.'],
    ['Signal Design and Cross-Validation', 'A signal needs an economic rationale, precise definition, robust validation, and separation from the test set.', 'Use nested or walk-forward validation for a time-series signal.', 'Repeatedly checking the test set turns it into training data.'],
    ['Portfolio Construction and Turnover Control', 'Signal strength must be translated through risk, costs, capacity, constraints, and turnover.', 'Compare rank weighting with cost-aware optimization.', 'A stronger raw signal can produce a worse net portfolio when turnover and impact dominate.'],
    ['Machine Learning Without Leakage', 'Financial ML faces nonstationarity, weak signal, dependence, selection bias, and explainability constraints.', 'Audit a feature pipeline for target and timestamp leakage.', 'High validation accuracy can be meaningless when labels or future information leak into features.'],
    ['Monitoring, Drift, and Model Governance', 'Production models need data checks, performance bands, drift tests, human escalation, versions, and kill switches.', 'Design a dashboard and shutdown rule for a live model.', 'A model that worked historically still requires ongoing validity and safety monitoring.']
  ]],
  [28, 'Applied Trading and Professional Practice', 'Advanced', [
    ['Pre-Market Planning and Scenario Trees', 'A plan defines catalysts, levels, liquidity, scenarios, triggers, invalidations, size, and no-trade conditions before volatility.', 'Build a three-branch opening scenario tree.', 'Planning multiple paths reduces the urge to force one prediction.'],
    ['Intraday Risk, Halts, and Gap Exposure', 'Day-trade risk includes spread expansion, volatility halts, gaps, borrow changes, platform failure, and correlated positions.', 'Stress a small-cap plan through a halt and reopening auction.', 'A stop order cannot guarantee a fill price through a gap or halt.'],
    ['Tape Replay and Evidence Scoring', 'Tape reading is a probabilistic synthesis of executed flow, price response, pace, spread, depth, and context.', 'Score a replay before revealing subsequent trades.', 'Executed aggression without price progress may indicate absorption rather than continuation.'],
    ['Trade Review and Performance Decomposition', 'Professional review separates setup, selection, sizing, execution, risk, market regime, and luck.', 'Decompose one trade into planned and unplanned P&L.', 'A winning trade can reflect poor process and a losing trade can follow sound process.'],
    ['Master Capstone: Research, Trade, and Defend', 'A complete decision joins primary evidence, valuation, market structure, probability, execution, risk, ethics, and falsification.', 'Present a thesis and strongest rebuttal to a mock risk committee.', 'Professional analysis is sourced, conditional, numerate, reproducible, and open to being wrong.']
  ]]
];

function buildLesson(moduleId, lessonId, moduleTitle, level, row) {
  const [title, principle, lab, answer] = row;
  const lesson = {
    moduleId, lessonId, title,
    description: `${moduleTitle}: ${principle}`,
    duration: moduleId >= 17 ? '30 min' : '25 min', level, color: LEVEL_COLOR[level],
    steps: [principle, `Method: define the variables, assumptions, evidence, uncertainty, and conditions that would overturn the conclusion.`, `Interactive lab: ${lab}`],
    /* A real knowledge check when one is authored (platform/academy/quizzes-data), otherwise the
       original generated one. The generated form asks the same question in every lesson with the
       same three wrong options and the answer always at A, so it tests nothing. */
    question: quizFor(moduleId, lessonId) || {
      prompt: 'Which statement is most defensible?',
      options: { A: answer, B: 'One observation proves the conclusion in every market regime.', C: 'Uncertainty and implementation costs can be ignored.', D: 'The model guarantees the future outcome.' },
      correct: 'A', explanation: `${answer} The result remains conditional on data quality, assumptions, and context.`
    }
  };
  lesson.simulation = simulationFor(lesson);
  return lesson;
}

const EXPANSION_LESSONS = MODULES.flatMap(([moduleId, moduleTitle, level, rows]) =>
  rows.map((row, index) => buildLesson(moduleId, index + 1, moduleTitle, level, row))
);

module.exports = { EXPANSION_LESSONS };
