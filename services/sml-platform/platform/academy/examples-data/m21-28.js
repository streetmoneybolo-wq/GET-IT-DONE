'use strict';

/* Authored whiteboard examples for modules 21-28 (lessons 21.1 to 28.5).
 *
 * Original Academy material: fictional people (Maya, Leo, Zoe, Omar, Priya,
 * Nia, Theo, ...) and fictional companies. Every number shown or spoken
 * above 12 is a given, a calc result or a literal, so the math is computed
 * here, never typed by hand. Educational only: no advice, no promises, no
 * real tickers and no real market events.
 *
 * Exported as an object keyed 'moduleId.lessonId'; examples-data/index.js
 * reads the records with Object.values(). */

const { E } = require('../examples');

const RECORDS = [
  /* ---------------- Module 21: Portfolio and Institutional Investing ---------------- */

  E('21.1', 'optimizer_sensitivity', {
    title: 'A tiny guess, a giant swing',
    given: { pot: 100, guessB: 0.06, guessA: 0.07, aversion: 2.5, variance: 0.04, corr: 0.9 },
    calc: {
      denom: '2 * aversion * variance * (1 - corr)',
      wEqual: '0.5 + (guessB - guessB) / denom',
      wTilt: 'min(max(0.5 + (guessA - guessB) / denom, 0), 1)',
      aLow: 'pot * wEqual',
      aHigh: 'pot * wTilt',
      bHigh: 'pot - aHigh',
      moved: 'aHigh - aLow'
    },
    say: [
      'Maya\'s robot splits {pot|usd} between two twin funds that move almost together, and it leans toward whichever fund has the higher guessed return.',
      'She guesses {guessB|pct} for both, so the robot puts {aLow|usd} in each.',
      'Now she nudges one guess up to {guessA|pct}, just one point higher.',
      'The robot flips to {aHigh|usd} and {bHigh|usd}, so a tiny guess moved {moved|usd}.',
      'An optimizer is only as good as its guesses, so test other guesses and add limits.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Maya', icon: 'person' }, right: { name: 'Robot', icon: 'robot' }, flows: [
          { dir: 'right', text: 'Guessed returns' },
          { dir: 'left', text: 'Split of {pot|usd}' }
        ] },
        { k: 'line', text: 'Twin funds move almost together', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Fund A', value: 'aLow', text: '{aLow|usd}', tone: 'key' },
          { label: 'Fund B', value: 'aLow', text: '{aLow|usd}', tone: 'key' }
        ] },
        { k: 'line', text: 'Guesses: {guessB|pct} and {guessB|pct}' },
        { k: 'line', text: 'Nudge A: {guessB|pct} → {guessA|pct}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Fund A', value: 'aHigh', text: '{aHigh|usd}', tone: 'bad' },
          { label: 'Fund B', value: 'bHigh', text: '{bHigh|usd}', tone: 'note' }
        ] },
        { k: 'line', text: 'Fund A: {wEqual|pct} → {wTilt|pct} of the pot', tone: 'key' },
        { k: 'line', text: '{moved|usd} moved by a one-point guess', tone: 'bad' },
        { k: 'line', text: 'Only as good as its guesses', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('21.2', 'rebalancing', {
    title: 'Drift, then back to the plan',
    given: { total: 1000, stockPct: 0.6, jump: 0.5 },
    calc: {
      bondPct: '1 - stockPct',
      stocks0: 'total * stockPct',
      bonds0: 'total - stocks0',
      stocks1: 'stocks0 * (1 + jump)',
      total1: 'stocks1 + bonds0',
      drift: 'round(stocks1 / total1, 2)',
      target: 'total1 * stockPct',
      move: 'stocks1 - target',
      bonds1: 'bonds0 + move'
    },
    say: [
      'Leo wants {stockPct|pct} stocks and {bondPct|pct} bonds, so he splits {total|usd} into {stocks0|usd} and {bonds0|usd}.',
      'Stocks jump {jump|pct} to {stocks1|usd}, so now about {drift|pct} of his {total1|usd} is in stocks, more risk than he chose.',
      'To get back on plan he needs {stockPct|pct} of {total1|usd}, which is {target|usd}, so he moves {move|usd} from stocks to bonds.',
      'Now he has {target|usd} in stocks and {bonds1|usd} in bonds, back to his mix.',
      'Rebalancing keeps the risk he chose, but it does not promise more money.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Stocks', value: 'stocks0', text: '{stocks0|usd}', tone: 'key' },
          { label: 'Bonds', value: 'bonds0', text: '{bonds0|usd}', tone: 'note' }
        ] },
        { k: 'line', text: '{total|usd} → {stockPct|pct} / {bondPct|pct}', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Stocks', value: 'stocks1', text: '{stocks1|usd}', tone: 'bad' },
          { label: 'Bonds', value: 'bonds0', text: '{bonds0|usd}', tone: 'note' }
        ] },
        { k: 'line', text: '{stocks1|usd} ÷ {total1|usd} ≈ {drift|pct} stocks', tone: 'key' },
        { k: 'line', text: 'More risk than planned', tone: 'bad' },
        { k: 'line', text: '{stockPct|pct} × {total1|usd} = {target|usd}: move {move|usd}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'actors', left: { name: 'Stocks', icon: 'chart' }, right: { name: 'Bonds', icon: 'bank' }, flows: [
          { dir: 'right', text: 'Move {move|usd}' }
        ] },
        { k: 'bars', items: [
          { label: 'Stocks', value: 'target', text: '{target|usd}', tone: 'good' },
          { label: 'Bonds', value: 'bonds1', text: '{bonds1|usd}', tone: 'good' }
        ] },
        { k: 'line', text: 'Back to plan, not extra profit', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('21.3', 'liquidity_stress', {
    title: 'Long horizon, bills due now',
    given: { locked: 60, liquid: 40, drop: 0.25, scholarships: 5, call: 10 },
    calc: {
      total0: 'locked + liquid',
      keep: '1 - drop',
      liquid1: 'liquid * keep',
      due: 'scholarships + call',
      left: 'liquid1 - due',
      locked1: 'locked + call',
      total1: 'left + locked1',
      share0: 'liquid / total0',
      share1: 'left / total1',
      share1R: 'round(share1, 2)'
    },
    say: [
      'Oakview School\'s fund has {total0|usd} million: {locked|usd} million locked in private funds, {liquid|usd} million it can sell.',
      /* Private assets fall too, but their values are updated later (the
       * valuation lag), so the locked part still reads $60 million now. */
      'In a bad year, the sellable part drops {drop|pct} to {liquid1|usd} million; the locked part\'s drop shows up later.',
      'That year it owes {scholarships|usd} million for scholarships, and a private fund it promised money to calls for {call|usd} million.',
      'Paying both leaves {left|usd} million to sell; the {call|usd} million joins the locked part, now {locked1|usd} million.',
      /* "million" after both amounts, so the voice does not read "$15" as
       * fifteen dollars. */
      'So only {left|usd} million of {total1|usd} million, about {share1R|pct}, can still be sold, and bills due soon cannot wait for the long run.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Locked', value: 'locked', text: '{locked|usd}M', tone: 'note' },
          { label: 'Sellable', value: 'liquid', text: '{liquid|usd}M', tone: 'key' }
        ] },
        { k: 'line', text: 'Total: {total0|usd}M', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Sellable: {liquid|usd}M × {keep|pct} = {liquid1|usd}M', tone: 'bad' },
        { k: 'line', text: 'Locked: {locked|usd}M, drop shows later', tone: 'note' },
        /* One $15M on the board, the amount left to sell that the voice says;
         * the equal $15M due is shown as its two parts. */
        { k: 'line', text: 'Due: {scholarships|usd}M + {call|usd}M call', tone: 'bad', cue: 2 },
        { k: 'line', text: 'Left: {liquid1|usd}M − {scholarships|usd}M − {call|usd}M = {left|usd}M', tone: 'key', cue: 3 },
        { k: 'line', text: 'Locked: {locked|usd}M + {call|usd}M = {locked1|usd}M', tone: 'note', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'line', text: '{left|usd}M ÷ {total1|usd}M ≈ {share1R|pct}', tone: 'key' },
        { k: 'big', text: '{share1R|pct}', label: 'Sellable now, down from {share0|pct}', tone: 'bad' },
        { k: 'stamp', text: 'Bills are due this year', tone: 'key' }
      ] }
    ]
  }),

  E('21.4', 'benchmark_attribution', {
    title: 'Pick the right ruler',
    given: { fund: 0.12, bigIndex: 0.08, smallIndex: 0.14 },
    calc: {
      wrongPts: '(fund - bigIndex) * 100',
      fairPts: '(fund - smallIndex) * 100',
      fairPtsAbs: 'abs(fairPts)'
    },
    say: [
      'Nia\'s fund may only buy small companies, and it returned {fund|pct} this year.',
      'She compares it to a big-company index that returned {bigIndex|pct} and cheers about beating it by {wrongPts|num} points.',
      /* One metaphor throughout: the ruler. */
      'But the right ruler for a small-company fund is a small-company index, which returned {smallIndex|pct}.',
      '{fund|pct} minus {smallIndex|pct} means she actually trailed by {fairPtsAbs|num} points, and that gap is what attribution tries to explain.',
      /* Closing from Nia's own numbers, not the knowledge check's wording. */
      'Measured with the right ruler, Nia\'s {fund|pct} is a {fairPtsAbs}-point shortfall, not a {wrongPts}-point win.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Rule: small companies only', tone: 'note' },
        { k: 'big', text: '{fund|pct}', label: 'Nia\'s return this year', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Nia\'s fund', value: 'fund', text: '{fund|pct}', tone: 'key' },
          { label: 'Big index', value: 'bigIndex', text: '{bigIndex|pct}', tone: 'note' }
        ] },
        /* Neutral here: the verdict on this ruler comes with sentence 2. */
        { k: 'line', text: 'Big index: {fund|pct} − {bigIndex|pct} = {wrongPts|snum} pts', tone: 'note' }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'Nia\'s fund', value: 'fund', text: '{fund|pct}', tone: 'key' },
          { label: 'Small index', value: 'smallIndex', text: '{smallIndex|pct}', tone: 'good' }
        ] },
        { k: 'line', text: 'Right ruler: small-company index', tone: 'key' },
        { k: 'line', text: 'Small index: {fund|pct} − {smallIndex|pct} = {fairPts|snum} pts', tone: 'bad', cue: 3 },
        { k: 'line', text: 'A {fairPtsAbs}-point miss, not a {wrongPts}-point win', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('21.5', 'manager_persistence', {
    title: 'Lucky streaks and fees',
    given: { managers: 64, years: 3, starGross: 0.1, starFee: 0.02, indexGross: 0.09, indexFee: 0.001 },
    calc: {
      y1: 'managers / 2',
      y2: 'y1 / 2',
      lucky: 'managers * 0.5 ^ years',
      starNet: 'starGross - starFee',
      indexNet: 'indexGross - indexFee'
    },
    say: [
      'Say {managers|num} pretend managers each flip a coin every year, and heads means they beat the market.',
      'After three years, {managers|num} halves to {y1|num}, then {y2|num}, then {lucky|num} with perfect streaks from pure luck.',
      'One lucky star, Theo, earned {starGross|pct} but charges a {starFee|pct} fee, so investors keep {starNet|pct}.',
      'A plain index fund earned {indexGross|pct} and charges {indexFee|pct}, so investors keep {indexNet|pct}.',
      'A hot streak alone is weak proof of skill, and fees come out every year.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: '{managers|num} managers', icon: 'crowd' }, right: { name: 'Coin', icon: 'coin' }, flows: [
          { dir: 'right', text: 'Heads = beat the market' }
        ] }
      ] },
      { cue: 1, items: [
        { k: 'steps', items: ['{managers|num} start', 'Year 1: {y1|num}', 'Year 2: {y2|num}', 'Year 3: {lucky|num}'] },
        { k: 'line', text: '{managers|num} × ½ × ½ × ½ = {lucky|num}', tone: 'key' },
        { k: 'big', text: '{lucky|num}', label: 'Perfect streaks from luck alone', tone: 'bad' },
        { k: 'line', text: 'Theo: {starGross|pct} − {starFee|pct} fee = {starNet|pct}', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Index: {indexGross|pct} − {indexFee|pct} fee = {indexNet|pct}', tone: 'good' },
        { k: 'bars', items: [
          { label: 'Theo keeps', value: 'starNet', text: '{starNet|pct}', tone: 'bad' },
          { label: 'Index keeps', value: 'indexNet', text: '{indexNet|pct}', tone: 'good' }
        ] },
        { k: 'line', text: 'A hot streak is not proof of skill', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* ---------------- Module 22: Fixed Income and Credit ---------------- */

  E('22.1', 'bond_price_yield', {
    title: 'One bond, two yields',
    given: { coupon: 5, face: 100, rate: 0.1 },
    calc: {
      total: 'face + coupon',
      growth: '1 + rate',
      price: 'total / growth',
      gain: 'face - price',
      currentYield: 'round(coupon / price, 3)',
      ytm: 'total / price - 1'
    },
    say: [
      'Maple Town\'s one-year bond pays {coupon|usd} of interest plus the {face|usd} back, so {total|usd} in all.',
      'Valued at {rate|pct} a year, that is {total|usd} divided by {growth|pts}, so Leo pays about {price|usdr} today.',
      'Current yield only counts the interest: {coupon|usd} a year on that price is about {currentYield|pct}.',
      'Yield to maturity also counts the climb back to {face|usd}, so it is {ytm|pct}, if Leo holds to the end and Maple Town pays.',
      'Price is future cash valued in today\'s money, and each yield counts different things.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Leo', icon: 'person' }, right: { name: 'Maple Town', icon: 'city' }, flows: [
          { dir: 'right', text: 'Price today?' },
          { dir: 'left', text: '{total|usd} next year' }
        ] },
        { k: 'line', text: '{coupon|usd} interest + {face|usd} back', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{total|usd} ÷ {growth|pts} = {price|usd}', tone: 'key' },
        { k: 'big', text: '{price|usd}', label: 'Price today', tone: 'key' }
      ] },
      { cue: 2, items: [
        { k: 'compare',
          left: { title: 'Current yield', lines: ['Interest only', '{coupon|usd} ÷ {price|usd}', '≈ {currentYield|pct}'], mark: null },
          right: { title: 'Yield to maturity', lines: ['Interest + gain', '{total|usd} ÷ {price|usd} − 1', '= {ytm|pct}'], mark: null } },
        { k: 'line', text: 'Only if held to the end and paid', tone: 'note', cue: 3 },
        { k: 'line', text: 'Price = future cash, discounted', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* 22.2 Both piles get the same twist and react differently, so the title
   * and closing line say "different result", not "different twist". */
  E('22.2', 'duration_curve', {
    title: 'Same duration, different result',
    given: { durA: 5, durShort: 1, durLong: 9, half: 0.5, shift: 0.01 },
    calc: {
      durB: 'half * durShort + half * durLong',
      parallelA: '-durA * shift',
      parallelAbs: 'abs(parallelA)',
      twistA: '-durA * 0',
      /* Each bond moves by its own duration times its own rate move; the
       * pile is the half-and-half average of the two. */
      shortMove: '-durShort * shift',
      shortAbs: 'abs(shortMove)',
      longMove: 'durLong * shift',
      twistB: 'half * shortMove + half * longMove'
    },
    say: [
      'Omar has two bond piles, each with a duration of {durA|num}, so each drops about {parallelAbs|pct} if every rate rises {shift|pct}.',
      'Pile A is one five-year bond; pile B is half a one-year and half a nine-year bond, each paying only at the end.',
      'Now the rates twist: the one-year rate rises {shift|pct}, the nine-year rate falls {shift|pct}, and the five-year rate holds.',
      'Pile A barely moves, but pile B\'s short half drops {shortAbs|pct} and its long half gains {longMove|pct}, so the whole pile gains about {twistB|pct}.',
      /* Closing in the example's own words, not the knowledge check's. */
      'Duration assumes every rate moves alike, so it could not tell these two piles apart.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Both piles: duration {durA|num}', tone: 'key' },
        { k: 'line', text: 'All rates {shift|spct} → about {parallelA|spct}', tone: 'bad' },
        { k: 'line', text: 'A: one 5-year bond', tone: 'note', cue: 1 },
        { k: 'line', text: 'B: half 1-year, half 9-year', tone: 'note', cue: 1 },
        { k: 'line', text: 'B: ½×1 + ½×9 = {durB|num}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'numberLine', marks: [
          { at: 'durShort', label: '1-yr rate {shift|spct}', tone: 'bad' },
          { at: 'durA', label: '5-yr rate flat', tone: 'note' },
          { at: 'durLong', label: '9-yr rate −1%', tone: 'good' }
        ] }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Pile A', value: 'twistA', text: 'About 0%', tone: 'note' },
          { label: 'Pile B', value: 'twistB', text: '{twistB|spct}', tone: 'good' }
        ] },
        { k: 'line', text: 'B: 1-yr bond {shortMove|spct}, 9-yr {longMove|spct}', tone: 'note' },
        { k: 'line', text: '½ × ({shortMove|pct}) + ½ × {longMove|pct} = {twistB|pct}', tone: 'key' },
        { k: 'line', text: 'Duration can\'t tell A from B', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('22.3', 'credit_default', {
    title: 'A high yield has a reason',
    given: { loan: 100, safeRate: 0.04, riskyRate: 0.12, pDefault: 0.1, recovery: 40 },
    calc: {
      safeBack: 'loan * (1 + safeRate)',
      riskyBack: 'loan * (1 + riskyRate)',
      pPay: '1 - pDefault',
      payPart: 'pPay * riskyBack',
      defaultPart: 'pDefault * recovery',
      avgBack: 'payPart + defaultPart',
      avgReturn: 'avgBack / loan - 1'
    },
    say: [
      'Zoe can lend {loan|usd} for a year to Steady Bakery at {safeRate|pct} or to Shaky Shoes at {riskyRate|pct}.',
      'Say Shaky pays back {riskyBack|usd} nine times in ten, but one time in ten it goes broke and Zoe gets only {recovery|usd}.',
      'On average that is {payPart|usd} plus {defaultPart|usd}, or {avgBack|usd}, just a {avgReturn|pct} return.',
      'Most of that {riskyRate|pct} is pay for the risk of loss, not extra return for nothing.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'compare',
          left: { title: 'Steady Bakery', lines: ['Promises {safeRate|pct}', 'Pays {safeBack|usd}'], mark: null },
          right: { title: 'Shaky Shoes', lines: ['Promises {riskyRate|pct}', 'Might go broke'], mark: null } }
      ] },
      { cue: 1, items: [
        { k: 'tree', root: 'Lend {loan|usd} to Shaky', branches: [
          { label: 'Pays: 9 in 10', text: '{riskyBack|usd}', tone: 'good' },
          { label: 'Broke: 1 in 10', text: '{recovery|usd}', tone: 'bad' }
        ] }
      ] },
      { cue: 2, items: [
        { k: 'line', text: '{pPay|pts} × {riskyBack|usd} = {payPart|usd}', tone: 'key' },
        { k: 'line', text: '{pDefault|pts} × {recovery|usd} = {defaultPart|usd}', tone: 'key' },
        { k: 'big', text: '{avgBack|usd}', label: 'Average back = {avgReturn|pct} return', tone: 'key' },
        { k: 'line', text: 'Promised {riskyRate|pct}, expected {avgReturn|pct}', tone: 'bad' },
        { k: 'line', text: 'High yield = pay for risk', tone: 'key', cue: 3 }
      ] }
    ]
  }),

  E('22.4', 'tranche_waterfall', {
    title: 'Who loses first?',
    given: { loans: 10, size: 10, senior: 70, middle: 20, junior: 10, fail1: 2, fail2: 4 },
    calc: {
      pool: 'loans * size',
      loss1: 'fail1 * size',
      mLoss1: 'min(max(loss1 - junior, 0), middle)',
      mLeft1: 'middle - mLoss1',
      sLoss1: 'max(loss1 - junior - middle, 0)',
      loss2: 'fail2 * size',
      jLeft2: 'junior - min(loss2, junior)',
      mLeft2: 'middle - min(max(loss2 - junior, 0), middle)',
      sLoss2: 'max(loss2 - junior - middle, 0)',
      sLeft2: 'senior - sLoss2',
      sLossPct: 'round(sLoss2 / senior, 2)'
    },
    say: [
      'Ten lemonade-stand loans of {size|usd} each make a {pool|usd} pool, sliced into Senior {senior|usd}, Middle {middle|usd}, and Junior {junior|usd}.',
      'Losses eat from the bottom up, so Junior loses first and Senior loses last.',
      'If two loans fail, the {loss1|usd} loss wipes out Junior and takes {mLoss1|usd} from Middle, while Senior is untouched.',
      'If four fail, the {loss2|usd} loss wipes out Junior and Middle, and Senior still loses {sLoss2|usd}, about {sLossPct|pct}.',
      'Layers change who loses first, but the loan risk is still there.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: '{loans|num} loans × {size|usd} = {pool|usd} pool', tone: 'note' },
        { k: 'bars', items: [
          { label: 'Senior', value: 'senior', text: '{senior|usd}', tone: 'key' },
          { label: 'Middle', value: 'middle', text: '{middle|usd}', tone: 'note' },
          { label: 'Junior', value: 'junior', text: '{junior|usd}', tone: 'bad' }
        ] }
      ] },
      { cue: 1, items: [
        { k: 'steps', items: ['Junior first', 'Then Middle', 'Senior last'] },
        { k: 'line', text: 'Two fail: {loss1|usd} loss', tone: 'bad', cue: 2 },
        { k: 'line', text: 'Junior $0, Middle {mLeft1|usd}, Senior {senior|usd}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Four fail: {loss2|usd} loss', tone: 'bad' },
        { k: 'bars', items: [
          { label: 'Senior', value: 'sLeft2', text: '{sLeft2|usd}', tone: 'bad' },
          { label: 'Middle', value: 'mLeft2', text: '{mLeft2|usd}', tone: 'note' },
          { label: 'Junior', value: 'jLeft2', text: '{jLeft2|usd}', tone: 'note' }
        ] },
        { k: 'line', text: '{sLoss2|usd} ÷ {senior|usd} ≈ {sLossPct|pct} of Senior', tone: 'key' },
        { k: 'line', text: 'Risk moved, not removed', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('22.5', 'margin_spiral', {
    title: 'When the cushion grows',
    given: { bonds: 100, own: 10, haircut1: 0.1, dip: 0.05, haircut2: 0.2 },
    calc: {
      loan: 'bonds - own',
      bonds1: 'bonds * (1 - dip)',
      lendPct: '1 - haircut2',
      maxLoan: 'bonds1 * lendPct',
      shortfall: 'loan - maxLoan',
      /* Each $1 of bonds sold repays $1 of loan but also cuts the allowed
       * loan by $0.80, so it closes only $0.20 of the gap. */
      limitCut: 'lendPct',
      closes: '1 - limitCut',
      sell: 'shortfall / closes',
      bondsLeft: 'bonds1 - sell',
      loanLeft: 'loan - sell'
    },
    say: [
      'Leo owns {bonds|usd} of bonds, but only {own|usd} is his money: he borrowed {loan|usd}, and the lender keeps a {haircut1|pct} cushion called a haircut.',
      'The bonds dip {dip|pct} to {bonds1|usd}, and the nervous lender raises the haircut to {haircut2|pct}.',
      'Now it will lend only {maxLoan|usd}, but Leo owes {loan|usd}, a {shortfall|usd} gap.',
      'Selling $1 of bonds repays $1 of loan but cuts his borrowing limit by {limitCut|usd}, closing only {closes|usd} of the gap.',
      'So he must sell {sell|usd} of bonds, leaving a {loanLeft|usd} loan on {bondsLeft|usd} of bonds.',
      'When many borrowers are forced to sell at once, prices fall further and lenders get stricter.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Leo', icon: 'person' }, right: { name: 'Lender', icon: 'bank' }, flows: [
          { dir: 'right', text: 'Bonds as collateral' },
          { dir: 'left', text: '{loan|usd} loan' }
        ] },
        { k: 'line', text: '{bonds|usd} bonds = {own|usd} his + {loan|usd} loan', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Bonds: {bonds|usd} → {bonds1|usd}', tone: 'bad' },
        { k: 'line', text: 'Haircut: {haircut1|pct} → {haircut2|pct}', tone: 'bad' },
        { k: 'line', text: '{lendPct|pct} × {bonds1|usd} = {maxLoan|usd}', tone: 'key', cue: 2 },
        { k: 'line', text: 'Owes {loan|usd}, may borrow {maxLoan|usd}: {shortfall|usd} gap', tone: 'bad', cue: 2 },
        { k: 'line', text: 'Sell $1: loan −$1, limit −{limitCut|usd}', tone: 'note', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'big', text: 'Sell {sell|usd}', label: 'Forced sale', tone: 'bad' },
        { k: 'line', text: '{shortfall|usd} gap ÷ {closes|usd} = {sell|usd}', tone: 'key' },
        { k: 'line', text: 'New: {loanLeft|usd} loan on {bondsLeft|usd} bonds', tone: 'note' },
        { k: 'line', text: 'Sell → prices fall → sell more', tone: 'bad', cue: 5 }
      ] }
    ]
  }),

  /* ---------------- Module 23: Derivatives and Risk Transfer ---------------- */

  E('23.1', 'futures_basis', {
    title: 'Carry, not a forecast',
    /* A storable good (wheat in a silo) keeps the cost-of-carry story clean. */
    given: { spot: 100, rate: 0.05, storage: 2 },
    calc: {
      interest: 'spot * rate',
      fair: 'spot + interest + storage',
      gap: 'fair - spot'
    },
    say: [
      'A ton of wheat costs {spot|usd} today.',
      'If Iris buys it now, a year in a silo costs her {storage|usd}, and she gives up {interest|usd} of interest at {rate|pct}.',
      'So a one-year futures deal, an agreement today to buy later at a set price, should cost about {fair|usd}, even if everyone expects {spot|usd}.',
      'That {gap|usd} gap between the futures price and today\'s price is the basis, and here it is just the cost of carrying the wheat.',
      /* Closing drawn from the example's numbers, not the knowledge check's wording. */
      'The {fair|usd} is today\'s price plus carrying costs, not anyone\'s forecast.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Iris', icon: 'person' }, right: { name: 'Wheat farm', icon: 'house' }, flows: [
          { dir: 'right', text: '{spot|usd} today' },
          { dir: 'left', text: 'One ton of wheat' }
        ] }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Interest: {rate|pct} × {spot|usd} = {interest|usd}', tone: 'note' },
        { k: 'line', text: 'Silo storage: {storage|usd}', tone: 'note' },
        { k: 'line', text: '{spot|usd} + {interest|usd} + {storage|usd} = {fair|usd}', tone: 'key', cue: 2 },
        { k: 'line', text: 'Expected price next year: {spot|usd}', tone: 'note', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'numberLine', marks: [
          { at: 'spot', label: 'Today {spot|usd}', tone: 'note' },
          { at: 'fair', label: 'Futures {fair|usd}', tone: 'key' }
        ], dot: { from: 'spot', to: 'fair' } },
        { k: 'big', text: '{gap|usd}', label: 'The basis: cost of carry', tone: 'key' },
        { k: 'line', text: '{fair|usd} = {spot|usd} + carry, not a guess', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('23.2', 'swap', {
    title: 'Swap the rule, keep a risk',
    given: { loan: 1000, fixed: 0.05, floatNew: 0.08 },
    calc: {
      fixedPay: 'loan * fixed',
      floatPay: 'loan * floatNew',
      net: 'floatPay - floatPay + fixedPay',
      extra: 'floatPay - fixedPay'
    },
    say: [
      'Maya\'s bakery owes {loan|usd} at a floating rate that can move up or down.',
      'In a swap with Otterbrook Bank, she pays a fixed {fixed|pct}, or {fixedPay|usd} a year, and the bank pays her the floating rate.',
      'Rates jump to {floatNew|pct}, so her loan costs {floatPay|usd}, but the bank sends her {floatPay|usd} and she still pays just {fixedPay|usd}.',
      'If the bank fails, though, she is stuck paying {floatPay|usd}, which is {extra|usd} more a year.',
      /* Closing from Maya's own numbers, not the knowledge check's wording. */
      'The swap fixed Maya\'s {fixedPay|usd} cost, but only as long as the bank keeps paying.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Loan: {loan|usd} at a floating rate', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'actors', left: { name: 'Maya', icon: 'shop' }, right: { name: 'Otterbrook', icon: 'bank' }, flows: [
          { dir: 'right', text: 'Fixed {fixed|pct} = {fixedPay|usd} a year' },
          { dir: 'left', text: 'Floating rate' }
        ] }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Rates at {floatNew|pct}: loan costs {floatPay|usd}', tone: 'bad' },
        { k: 'line', text: 'Bank pays Maya {floatPay|usd}', tone: 'good' },
        { k: 'big', text: 'Net {net|usd}', label: 'Her cost with the swap', tone: 'key' },
        { k: 'line', text: 'Bank fails: {extra|susd} a year', tone: 'bad', cue: 3 },
        { k: 'line', text: 'Fixed {fixedPay|usd} only if the bank pays', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('23.3', 'put_call_parity', {
    title: 'A balance rule, then costs',
    given: { stock: 52, strike: 50, call: 5, put: 2, costs: 1.2 },
    calc: {
      fairDiff: 'stock - strike',
      mktDiff: 'call - put',
      misprice: 'mktDiff - fairDiff',
      net: 'misprice - costs',
      netAbs: 'abs(net)'
    },
    say: [
      'For options used only at expiration, with no dividends and zero interest, a call minus a put should equal the stock minus the strike.',
      'Button Toys is at {stock|usd} and the strike is {strike|usd}, so the call minus the put should be {fairDiff|usd}.',
      'The market shows a call at {call|usd} and a put at {put|usd}, a {mktDiff|usd} gap, so it is {misprice|usd} too big.',
      'But trading all the pieces costs {costs|usd} in fees and borrowing, so the free-looking {misprice|usd} becomes a loss of {netAbs|usd}.',
      'A gap only matters if it beats the costs of trading it.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Call − Put = Stock − Strike', tone: 'key' },
        { k: 'line', text: 'Expiry-only options, zero rates', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{stock|usd} − {strike|usd} = {fairDiff|usd}', tone: 'key' },
        { k: 'line', text: 'Market: {call|usd} − {put|usd} = {mktDiff|usd}', cue: 2 },
        { k: 'line', text: 'Gap too big by {misprice|usd}', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Should be', value: 'fairDiff', text: '{fairDiff|usd}', tone: 'note' },
          { label: 'Market', value: 'mktDiff', text: '{mktDiff|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: '{misprice|usd} gap − {costs|usd} costs = {net|susd}', tone: 'key' },
        { k: 'big', text: '{net|susd}', label: 'After costs', tone: 'bad' },
        { k: 'line', text: 'A gap must beat the costs', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('23.4', 'gamma_hedging', {
    title: 'Buy high, sell low, on repeat',
    given: { shares: 100, price1: 50, price2: 55, delta1: 0.5, delta2: 0.7 },
    calc: {
      hedge1: 'delta1 * shares',
      hedge2: 'delta2 * shares',
      buy: 'hedge2 - hedge1',
      move: 'price2 - price1',
      loss: 'buy * move',
      lossSigned: '-loss'
    },
    say: [
      'Ravi sold call options on {shares|num} shares of Juniper Kites; at {price1|usd} they act like {hedge1|num} shares, so he owns {hedge1|num} shares to balance.',
      'The price rises to {price2|usd}, the options now act like {hedge2|num} shares, so he buys {buy|num} more at {price2|usd}.',
      'Then it falls back to {price1|usd}, and he sells those {buy|num} shares at {price1|usd}.',
      'Buying high and selling low cost him {buy|num} times {move|usd}, which is {loss|usd}.',
      'That is short gamma risk, and the option premium he collected is what has to pay for it.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Ravi', icon: 'person' }, right: { name: 'Option buyer', icon: 'person2' }, flows: [
          { dir: 'right', text: 'Calls on {shares|num} shares' },
          { dir: 'left', text: 'Premium' }
        ] },
        { k: 'line', text: 'Delta {delta1|pts} × {shares|num} = {hedge1|num} shares', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'numberLine', marks: [
          { at: 'price1', label: '{price1|usd}: own {hedge1|num}', tone: 'note' },
          { at: 'price2', label: '{price2|usd}: own {hedge2|num}', tone: 'key' }
        ], dot: { from: 'price1', to: 'price2' } },
        { k: 'line', text: 'Buy {buy|num} at {price2|usd}', tone: 'bad' },
        { k: 'line', text: 'Sell {buy|num} at {price1|usd}', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: '{buy|num} × {move|usd} = {loss|usd}', tone: 'key' },
        { k: 'big', text: '{lossSigned|susd}', label: 'Bought high, sold low', tone: 'bad' },
        { k: 'line', text: 'Short gamma: buy high, sell low', tone: 'bad', cue: 4 },
        { k: 'line', text: 'The premium has to cover this', tone: 'note', cue: 4 }
      ] }
    ]
  }),

  E('23.5', 'implied_move', {
    title: 'The move the price expects',
    given: { stock: 100, straddle: 8, pSmall: 0.7, small: 4, pBig: 0.3, big: 20 },
    calc: {
      impliedMove: 'straddle / stock',
      keepSmall: 'straddle - small',
      loseBig: 'big - straddle',
      partSmall: 'pSmall * small',
      partBig: 'pBig * big',
      avgPay: 'partSmall + partBig',
      sellerAvg: 'straddle - avgPay'
    },
    say: [
      'Before Glowworm Games reports earnings, a straddle, a call plus a put, costs {straddle|usd} on its {stock|usd} stock.',
      'So the market is pricing a move of about {straddle|usd}, and Lena sells the straddle, owing the size of the move.',
      'Say there is a {pSmall|pct} chance of a {small|usd} move and a {pBig|pct} chance of a {big|usd} jump.',
      'Her average payout is {partSmall|usd} plus {partBig|usd}, or {avgPay|usd}, more than the {straddle|usd} she collected.',
      'Selling pricey-looking options can still lose when the real moves are bigger.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Lena', icon: 'person' }, right: { name: 'Buyer', icon: 'person2' }, flows: [
          { dir: 'left', text: '{straddle|usd} for the straddle' },
          { dir: 'right', text: 'Pays the size of the move' }
        ] },
        { k: 'line', text: '{straddle|usd} ÷ {stock|usd} = {impliedMove|pct} move priced', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'tree', root: 'Earnings day', branches: [
          { label: '{pSmall|pct}: moves {small|usd}', text: 'Lena keeps {keepSmall|usd}', tone: 'good' },
          { label: '{pBig|pct}: jumps {big|usd}', text: 'Lena loses {loseBig|usd}', tone: 'bad' }
        ] }
      ] },
      { cue: 3, items: [
        { k: 'line', text: '{pSmall|pct} × {small|usd} = {partSmall|usd}', tone: 'note' },
        { k: 'line', text: '{pBig|pct} × {big|usd} = {partBig|usd}', tone: 'note' },
        { k: 'big', text: '{avgPay|usd}', label: 'Average payout vs {straddle|usd} collected', tone: 'bad' },
        { k: 'line', text: 'Lena: {sellerAvg|susd} a share on average', tone: 'bad' },
        { k: 'line', text: 'Pricey can still be too cheap', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* ---------------- Module 24: Market Microstructure and Execution ---------------- */

  E('24.1', 'queue_priority', {
    title: 'Same price, different rulebook',
    given: { price: 10, iris: 100, kofi: 300, zoe: 600, sell: 500 },
    calc: {
      timeIris: 'min(iris, sell)',
      timeKofi: 'min(kofi, sell - timeIris)',
      timeZoe: 'min(zoe, sell - timeIris - timeKofi)',
      book: 'iris + kofi + zoe',
      share: 'sell / book',
      proIris: 'iris * share',
      proKofi: 'kofi * share',
      proZoe: 'zoe * share'
    },
    say: [
      'Three buyers wait at {price|usd}: Iris wants {iris|num} shares and came first, Kofi wants {kofi|num}, and Zoe wants {zoe|num}.',
      'A seller sells {sell|num} shares at that price.',
      'First come, first served gives Iris {timeIris|num}, Kofi {timeKofi|num}, and Zoe only {timeZoe|num}.',
      'Sharing by size gives each buyer half of what they asked for: {proIris|num}, {proKofi|num}, and {proZoe|num}.',
      'Same price, different rulebook, different fills.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'steps', items: ['1. Iris {iris|num}', '2. Kofi {kofi|num}', '3. Zoe {zoe|num}'] },
        { k: 'line', text: 'Everyone bids {price|usd}', tone: 'note' },
        { k: 'line', text: 'Seller: {sell|num} shares', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Price-time: first in line first', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Iris', value: 'timeIris', text: '{timeIris|num}', tone: 'good' },
          { label: 'Kofi', value: 'timeKofi', text: '{timeKofi|num}', tone: 'good' },
          { label: 'Zoe', value: 'timeZoe', text: '{timeZoe|num}', tone: 'bad' }
        ] }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Pro-rata: {sell|num} ÷ {book|num} = half each', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Iris', value: 'proIris', text: '{proIris|num}', tone: 'note' },
          { label: 'Kofi', value: 'proKofi', text: '{proKofi|num}', tone: 'note' },
          { label: 'Zoe', value: 'proZoe', text: '{proZoe|num}', tone: 'good' }
        ] },
        { k: 'line', text: 'Same price, different fills', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('24.2', 'adverse_selection', {
    title: 'Why spreads widen',
    given: { bid: 9.9, ask: 10.1, informedCost: 0.5, crowd: 10, informed1: 1, informed2: 3 },
    calc: {
      spread: 'ask - bid',
      half: 'spread / 2',
      normal1: 'crowd - informed1',
      net1: 'normal1 * half - informed1 * informedCost',
      normal2: 'crowd - informed2',
      net2: 'normal2 * half - informed2 * informedCost',
      net2Abs: 'abs(net2)'
    },
    say: [
      'Ravi, a market maker, buys at {bid|usd} and sells at {ask|usd}, so he earns about {half|usd} a share from each ordinary customer.',
      'Some customers know news he does not, and each of them costs him {informedCost|usd}.',
      'With nine ordinary customers and one who knows news, he nets {net1|usd}.',
      'With seven ordinary customers and three who know news, he loses {net2Abs|usd}.',
      'So when more traders know more than he does, Ravi has to widen his spread.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Ravi', icon: 'shop' }, right: { name: 'Customers', icon: 'crowd' }, flows: [
          { dir: 'right', text: 'I sell at {ask|usd}' },
          { dir: 'left', text: 'I buy at {bid|usd}' }
        ] },
        { k: 'line', text: 'Spread {spread|usd}, half = {half|usd}', tone: 'key' }
      ] },
      { cue: 2, items: [
        { k: 'line', text: '{normal1|num} × {half|usd} − {informedCost|usd} = {net1|susd}', tone: 'good' }
      ] },
      { cue: 3, items: [
        { k: 'line', text: '{normal2|num} × {half|usd} − {informed2|num} × {informedCost|usd} = {net2|susd}', tone: 'bad' },
        { k: 'bars', items: [
          { label: '1 informed', value: 'net1', text: '{net1|susd}', tone: 'good' },
          { label: '3 informed', value: 'net2', text: '{net2|susd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'More informed flow → wider spread', tone: 'key', cue: 4 },
        { k: 'line', text: 'The spread pays for the risk', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('24.3', 'hidden_liquidity', {
    title: 'The book shows only the tip',
    given: { shown: 100, fills: 8, price: 20 },
    calc: {
      traded: 'shown * fills',
      hidden: 'traded - shown'
    },
    say: [
      'The screen shows just {shown|num} shares for sale at {price|usd}.',
      'Buyers take those {shown|num} shares eight times in a row, and each time a fresh {shown|num} appears.',
      'So at least {traded|num} shares were for sale, at least {hidden|num} more than the screen showed.',
      'That hints at a hidden seller, but nobody can see its full size or why it is selling.',
      'The visible order book is an incomplete map, so refills are hints, not proof.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{shown|num}', label: 'Shares shown at {price|usd}', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'steps', items: ['Take {shown|num}', 'Refills', 'Again', '{fills|num} times'] },
        { k: 'line', text: '{fills|num} × {shown|num} = {traded|num} traded', tone: 'key', cue: 2 },
        { k: 'line', text: 'Hidden: at least {hidden|num}', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'compare',
          left: { title: 'What we know', lines: ['At least {traded|num}', 'A seller refills'], mark: 'check' },
          right: { title: 'What we cannot know', lines: ['Full size', 'Why they sell'], mark: 'cross' } },
        { k: 'line', text: 'Hints, not certainty', tone: 'note', cue: 4 }
      ] }
    ]
  }),

  E('24.4', 'market_impact', {
    title: 'Fast costs, slow costs',
    given: { shares: 1000, decision: 50, urgentAvg: 50.4, patientFilled: 800, patientExtra: 0.15, runaway: 51 },
    calc: {
      impact: 'urgentAvg - decision',
      urgentCost: 'shares * impact',
      patientCost: 'patientFilled * patientExtra',
      missed: 'shares - patientFilled',
      runUp: 'runaway - decision',
      missCost: 'missed * runUp',
      patientTotal: 'patientCost + missCost'
    },
    say: [
      'Lena decides to buy {shares|num} shares at {decision|usd}, and every cost is measured from that decision price.',
      'Buying all at once pushes her average to {urgentAvg|usd}, so the rush costs {impact|usd} a share, or {urgentCost|usd}.',
      'Buying slowly costs only {patientExtra|usd} extra on {patientFilled|num} shares, which is {patientCost|usd}.',
      'But the price runs to {runaway|usd} before she gets the last {missed|num}, and missing them costs {missCost|usd}, so {patientTotal|usd} in all.',
      'Fast buying pays in price impact, slow buying risks missed trades, and both are real costs.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Buy {shares|num} shares, decided at {decision|usd}', tone: 'note' },
        { k: 'line', text: 'Rush: average {urgentAvg|usd}', tone: 'bad', cue: 1 },
        { k: 'line', text: '{shares|num} × {impact|usd} = {urgentCost|usd}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Slow: {patientFilled|num} × {patientExtra|usd} = {patientCost|usd}', tone: 'note' },
        { k: 'line', text: 'Missed {missed|num} × {runUp|usd} = {missCost|usd}', tone: 'bad', cue: 3 },
        { k: 'line', text: '{patientCost|usd} + {missCost|usd} = {patientTotal|usd}', tone: 'key', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'bars', items: [
          { label: 'Urgent', value: 'urgentCost', text: '{urgentCost|usd}', tone: 'bad' },
          { label: 'Patient', value: 'patientTotal', text: '{patientTotal|usd}', tone: 'note' }
        ] },
        { k: 'stamp', text: 'Impact vs missed trades', tone: 'key' }
      ] }
    ]
  }),

  E('24.5', 'best_execution', {
    title: 'The free trade that cost more',
    given: { shares: 100, fillA: 10.05, feeA: 0, fillB: 10, feeB: 1 },
    calc: {
      totalA: 'shares * fillA + feeA',
      totalB: 'shares * fillB + feeB',
      diff: 'totalA - totalB'
    },
    say: [
      'Sam buys {shares|num} shares, and Broker A charges no commission but fills him at {fillA|usd}, so he pays {totalA|usd}.',
      'Broker B charges a {feeB|usd} commission but gets a better fill at {fillB|usd}, so he pays {totalB|usd}.',
      'The free trade actually cost {diff|usd} more.',
      'A broker may also be paid for where it sends orders, so it is fair to ask how routing is decided.',
      'Best execution means judging the total cost, not the sticker.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Broker A: {feeA|usd} commission', tone: 'note' },
        { k: 'line', text: '{shares|num} × {fillA|usd} = {totalA|usd}', tone: 'bad' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Broker B: {feeB|usd} commission', tone: 'note' },
        { k: 'line', text: '{shares|num} × {fillB|usd} + {feeB|usd} = {totalB|usd}', tone: 'good' }
      ] },
      { cue: 2, items: [
        { k: 'big', text: '{diff|usd} more', label: 'Cost of the free trade', tone: 'bad' },
        { k: 'line', text: '{totalA|usd} − {totalB|usd} = {diff|usd}', tone: 'key' },
        { k: 'line', text: 'Ask who pays for the routing', tone: 'note', cue: 3 },
        { k: 'line', text: 'Judge total cost, not the sticker', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* ---------------- Module 25: Behavioral Finance and Decision Science ---------------- */

  E('25.1', 'bias_loss_aversion', {
    title: 'Same money, different feelings',
    given: { end: 150, mayaStart: 100, leoStart: 200, lossWeight: 2 },
    calc: {
      mayaGain: 'end - mayaStart',
      leoChange: 'end - leoStart',
      leoLoss: 'abs(leoChange)',
      leoFelt: 'lossWeight * leoLoss',
      leoFeltSigned: '-leoFelt'
    },
    say: [
      'Maya and Leo both end the week with {end|usd}.',
      'Maya started at {mayaStart|usd}, so she feels a happy gain of {mayaGain|usd}.',
      'Leo had {leoStart|usd} last week, so he feels a loss of {leoLoss|usd}.',
      'For many people, losses feel about twice as strong as gains, so his {leoLoss|usd} stings like {leoFelt|usd}.',
      'Same {end|usd}, different starting points, and that alone can change what people choose.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Maya', value: 'end', text: '{end|usd}', tone: 'note' },
          { label: 'Leo', value: 'end', text: '{end|usd}', tone: 'note' }
        ] },
        { k: 'line', text: 'Same money: {end|usd} each', tone: 'key' },
        { k: 'line', text: 'Maya: {end|usd} − {mayaStart|usd} = {mayaGain|susd}', tone: 'good', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'numberLine', marks: [
          { at: 'mayaStart', label: 'Maya {mayaStart|usd}', tone: 'good' },
          { at: 'end', label: 'End {end|usd}', tone: 'key' },
          { at: 'leoStart', label: 'Leo {leoStart|usd}', tone: 'bad' }
        ], dot: { from: 'leoStart', to: 'end' } },
        { k: 'line', text: 'Leo: {end|usd} − {leoStart|usd} = {leoChange|susd}', tone: 'bad' }
      ] },
      { cue: 3, items: [
        { k: 'line', text: '{leoLoss|usd} loss × {lossWeight|num} ≈ feels like {leoFelt|usd}', tone: 'bad' },
        { k: 'big', text: '{leoFeltSigned|susd}', label: 'How Leo\'s loss feels', tone: 'bad' },
        { k: 'line', text: 'Start point shapes the feeling', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('25.2', 'calibration', {
    title: 'Does 70% sure mean 70%?',
    given: { calls: 20, stated: 0.7, hits: 10 },
    calc: {
      expected: 'calls * stated',
      actual: 'hits / calls',
      gapPts: '(stated - actual) * 100'
    },
    say: [
      'Leo made {calls|num} predictions and said he was {stated|pct} sure each time.',
      'If he were well calibrated, about {stated|pct} of them, or {expected|num}, would come true.',
      'Only {hits|num} did, which is {actual|pct}.',
      'So his confidence ran {gapPts|num} points too high.',
      'Being {stated|pct} sure should mean being right about {stated|pct} of the time over many tries.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: '{calls|num} calls, each "{stated|pct} sure"', tone: 'note' },
        { k: 'line', text: '{stated|pct} × {calls|num} = {expected|num} expected', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Came true: {hits|num} of {calls|num} = {actual|pct}', tone: 'bad' },
        { k: 'bars', items: [
          { label: 'Said', value: 'stated', text: '{stated|pct}', tone: 'key' },
          { label: 'Got', value: 'actual', text: '{actual|pct}', tone: 'bad' }
        ] }
      ] },
      { cue: 3, items: [
        { k: 'numberLine', marks: [
          { at: 'actual', label: 'Right {actual|pct}', tone: 'bad' },
          { at: 'stated', label: 'Said {stated|pct}', tone: 'key' }
        ], dot: { from: 'stated', to: 'actual' } },
        { k: 'big', text: '{gapPts|num} points', label: 'Overconfident by', tone: 'bad' },
        { k: 'line', text: 'Match confidence to results', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('25.3', 'bias_anchoring', {
    title: 'Half off of what?',
    given: { oldHigh: 80, price: 40, eps: 2, multiple: 15 },
    calc: {
      yardstick: 'eps * multiple',
      above: 'price - yardstick'
    },
    say: [
      'Sparrow Pets traded at {oldHigh|usd} last year and trades at {price|usd} now, so Zoe says it is half off.',
      'But the company earns {eps|usd} a share, and similar companies trade at about {multiple|num} times earnings.',
      '{eps|usd} times {multiple|num} is {yardstick|usd}, so by that yardstick, {price|usd} is still {above|usd} above it, not a bargain.',
      'The old {oldHigh|usd} is just a sticky memory, and a recent drop can feel more meaningful than it is.',
      /* An old high is not evidence of value (it could still match it). */
      'An old price is a memory, not a measure of value.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'numberLine', marks: [
          { at: 'price', label: 'Now {price|usd}', tone: 'key' },
          { at: 'oldHigh', label: 'Last year {oldHigh|usd}', tone: 'note' }
        ], dot: { from: 'oldHigh', to: 'price' } },
        { k: 'line', text: '"Half off!" says Zoe', tone: 'bad' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Earns {eps|usd} a share', tone: 'note' },
        { k: 'line', text: 'Similar firms: about {multiple|num} × earnings', tone: 'note' },
        { k: 'line', text: '{eps|usd} × {multiple|num} = {yardstick|usd}', tone: 'key', cue: 2 },
        { k: 'line', text: '{price|usd} − {yardstick|usd} = {above|usd} above it', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Old high', value: 'oldHigh', text: '{oldHigh|usd}', tone: 'note' },
          { label: 'Price now', value: 'price', text: '{price|usd}', tone: 'bad' },
          { label: 'Yardstick', value: 'yardstick', text: '{yardstick|usd}', tone: 'key' }
        ] },
        { k: 'line', text: 'Old {oldHigh|usd} = sticky memory', tone: 'note' },
        { k: 'line', text: 'A memory, not a measure of value', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('25.4', 'reflexivity_loop', {
    title: 'When price changes the business',
    given: { newShares: 1, low: 10, high: 20, crash: 5 },
    calc: {
      raiseLow: 'newShares * low',
      raiseHigh: 'newShares * high',
      raiseCrash: 'newShares * crash'
    },
    say: [
      'As a crowd rushes into Zip Scooters, its shares climb from {low|usd} to {high|usd}.',
      'At {high|usd}, selling one million new shares raises {raiseHigh|usd} million instead of {raiseLow|usd} million.',
      'That extra cash opens more shops, profits grow, and the rising price has changed the business itself.',
      'If the price falls to {crash|usd}, the same sale raises only {raiseCrash|usd} million, and new shops get canceled.',
      'Price can feed back into the business in both directions, which is how booms and busts grow.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Crowd', icon: 'crowd' }, right: { name: 'Zip Scooters', icon: 'company' }, flows: [
          { dir: 'right', text: 'Buying rush: {low|usd} → {high|usd}' }
        ] },
        { k: 'line', text: '1M new shares × {high|usd} = {raiseHigh|usd}M', tone: 'key', cue: 1 }
      ] },
      /* The feedback loop appears with sentence 2, which explains it. */
      { cue: 2, items: [
        { k: 'steps', items: ['Price up', 'Raise more', 'More shops', 'Profit up'] },
        { k: 'line', text: 'Rising price changed the business', tone: 'good' }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'At {high|usd}', value: 'raiseHigh', text: '{raiseHigh|usd}M', tone: 'good' },
          { label: 'At {low|usd}', value: 'raiseLow', text: '{raiseLow|usd}M', tone: 'note' },
          { label: 'At {crash|usd}', value: 'raiseCrash', text: '{raiseCrash|usd}M', tone: 'bad' }
        ] },
        { k: 'line', text: 'Falls to {crash|usd}: shops canceled', tone: 'bad' },
        { k: 'line', text: 'The loop runs both ways', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('25.5', 'decision_journal', {
    title: 'Write it down before',
    given: { trades: 10, chance: 0.6, wins: 6 },
    calc: {
      expected: 'trades * chance',
      rate: 'wins / trades',
      losses: 'trades - wins'
    },
    say: [
      'Before each trade, Iris writes her reason, her exit point, and the chance she thinks it works: {chance|pct}.',
      'After {trades|num} trades, {wins|num} worked, which is {rate|pct}, right in line with her notes.',
      'When one trade lost, a hindsight voice said she knew it was weak all along.',
      'But her journal showed what she really thought beforehand, so she judged the plan, not just the ending.',
      'Writing reasons before the result keeps hindsight from rewriting the story.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'steps', items: ['Reason', 'Exit point', 'Chance {chance|pct}'] },
        { k: 'line', text: 'Written before the trade', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{wins|num} ÷ {trades|num} = {rate|pct}', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Wrote', value: 'chance', text: '{chance|pct}', tone: 'key' },
          { label: 'Happened', value: 'rate', text: '{rate|pct}', tone: 'good' }
        ] },
        { k: 'line', text: '{expected|num} expected, {wins|num} worked, {losses|num} lost', tone: 'note' },
        { k: 'line', text: 'Hindsight: "I knew it!"', tone: 'bad', cue: 2 }
      ] },
      /* The journal column appears with sentence 3, which settles it. */
      { cue: 3, items: [
        { k: 'compare',
          left: { title: 'Hindsight', lines: ['"I knew it!"', 'Story rewritten'], mark: 'cross' },
          right: { title: 'Journal', lines: ['Reason in ink', 'Judge the plan'], mark: 'check' } },
        { k: 'line', text: 'Write reasons before the result', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* ---------------- Module 26: Regulation, Governance, and Ethics ---------------- */

  E('26.1', 'disclosure_filing', {
    title: 'Read the footnote',
    given: { sales: 10, prior: 8, oneTime: 1.5 },
    calc: {
      growth: '(sales - prior) / prior',
      core: 'sales - oneTime',
      coreGrowth: '(core - prior) / prior',
      coreGrowthR: 'round(coreGrowth, 2)'
    },
    say: [
      'Maple Robotics files its quarterly report: sales were {sales|usd} million, up from {prior|usd} million, a {growth|pct} jump.',
      'Public companies must file reports like this, and antifraud rules forbid misleading statements, so a filing is primary evidence.',
      'But a footnote says ${oneTime|pts} million came from one big order that will not happen again.',
      'Without it, sales were ${core|pts} million, growth of only about {coreGrowthR|pct}.',
      'A filing is the best place to start, but it still needs careful reading.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Quarterly report: Maple Robotics', tone: 'note' },
        { k: 'line', text: 'Sales {sales|usd}M vs {prior|usd}M', tone: 'note' },
        { k: 'big', text: '{growth|spct}', label: 'Headline growth', tone: 'good' }
      ] },
      { cue: 1, items: [
        { k: 'stamp', text: 'Filed: primary evidence', tone: 'key' },
        { k: 'line', text: 'Footnote: ${oneTime|pts}M one-time order', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: '${sales|pts}M − ${oneTime|pts}M = ${core|pts}M', tone: 'note' },
        { k: 'line', text: '(${core|pts}M − ${prior|pts}M) ÷ ${prior|pts}M = {coreGrowth|pct}', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Headline', value: 'growth', text: '{growth|pct}', tone: 'note' },
          { label: 'Repeatable', value: 'coreGrowth', text: '{coreGrowth|pct}', tone: 'key' }
        ] },
        { k: 'line', text: 'Read the footnotes too', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('26.2', 'law_insider', {
    title: 'A secret is a stop sign',
    given: { offer: 30, price: 20, shares: 100 },
    calc: {
      jump: '(offer - price) / price',
      gain: 'offer - price',
      tempting: 'shares * gain'
    },
    say: [
      'At dinner, Leo\'s aunt, who works at Tidepool Foods, says it will be bought next week for {offer|usd} a share; it trades at {price|usd} today.',
      'That is a {jump|pct} jump the public does not know about, so it is material, meaning important, and nonpublic, meaning secret.',
      'Buying {shares|num} shares to pocket {tempting|usd} would be wrong and can be illegal in many places.',
      /* The steps in Leo's own actions, not the knowledge check's wording. */
      'So Leo does not trade or tell anyone, writes down what he heard and when, and asks a compliance expert.',
      'Important secret news is a stop sign, not a trade idea.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Leo', icon: 'person' }, right: { name: 'His aunt', icon: 'person2' }, flows: [
          { dir: 'left', text: '"Bought next week at {offer|usd}!"' }
        ] },
        { k: 'line', text: 'Price today: {price|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '({offer|usd} − {price|usd}) ÷ {price|usd} = {jump|pct}', tone: 'key' },
        { k: 'line', text: 'Material? Yes. Public? No.', tone: 'bad' },
        { k: 'line', text: '{shares|num} × {gain|usd} = {tempting|usd} tempting', tone: 'bad', cue: 2 },
        { k: 'line', text: 'Trading on it: can be illegal', tone: 'bad', cue: 2 }
      ] },
      /* The safe steps appear with sentence 3, which says them. */
      { cue: 3, items: [
        { k: 'compare',
          left: { title: 'Trade on it', lines: ['Uses secret news', 'Can be illegal'], mark: 'cross' },
          right: { title: 'Stop and escalate', lines: ['Don\'t trade', 'Don\'t share', 'Write it down'], mark: 'check' } },
        { k: 'line', text: 'Ask a compliance expert', tone: 'key' },
        { k: 'line', text: 'Secret news = stop sign', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('26.3', 'law_manipulation', {
    title: 'Fake orders, real harm',
    given: { real: 500, fake: 10000, held: 1000, before: 9.99, after: 10.05 },
    calc: {
      ratio: 'fake / real',
      tick: 'after - before',
      gain: 'held * tick'
    },
    say: [
      'Theo owns {held|num} shares and wants a higher price, so he posts a fake buy order for {fake|num} shares, {ratio|num} times the real {real|num}.',
      'He never plans to let it fill.',
      'Others see huge demand, the price ticks from {before|usd} to {after|usd}, and Theo sells there, then cancels the fake order.',
      'His extra {gain|usd} came from tricking people, which is spoofing and can be illegal.',
      'Lena cancels an order because news changed her plan, and that is normal, but faking supply or demand is not.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Real bids', value: 'real', text: '{real|num}', tone: 'note' },
          { label: 'Fake order', value: 'fake', text: '{fake|num} fake', tone: 'bad' }
        ] },
        { k: 'line', text: '{fake|num} ÷ {real|num} = {ratio|num} times', tone: 'key' },
        { k: 'line', text: 'Never meant to fill', tone: 'bad', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'numberLine', marks: [
          { at: 'before', label: 'Before {before|usd}', tone: 'note' },
          { at: 'after', label: 'Sold {after|usd}', tone: 'bad' }
        ], dot: { from: 'before', to: 'after' } },
        { k: 'line', text: 'Fake order canceled', tone: 'note' },
        { k: 'line', text: '{held|num} × {tick|usd} = {gain|usd} by deception', tone: 'bad', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'compare',
          left: { title: 'Theo: fake intent', lines: ['Fake demand', 'Cancel after sale'], mark: 'cross' },
          right: { title: 'Lena: plan changed', lines: ['Real order', 'News changed plan'], mark: 'check' } },
        { k: 'stamp', text: 'Never fake supply or demand', tone: 'key' }
      ] }
    ]
  }),

  E('26.4', 'governance_agency', {
    title: 'A bonus that bends choices',
    given: { bonus: 1, target: 10, safe: 9, pWin: 0.5, win: 12, lossAmt: 4 },
    calc: {
      pLose: '1 - pWin',
      keptWin: 'win - bonus',
      riskyAvg: 'pWin * win - pLose * lossAmt',
      ownersRisky: 'pWin * keptWin - pLose * lossAmt',
      riskyLoss: '-lossAmt'
    },
    say: [
      'Ava runs Birchwood Bikes and gets a {bonus|usd} million bonus only if profit reaches {target|usd} million.',
      'A safe plan makes a sure {safe|usd} million, so she gets no bonus.',
      'A risky plan has a {pWin|pct} chance of {win|usd} million and a {pLose|pct} chance of losing {lossAmt|usd} million.',
      'After her bonus in the good case, that averages only ${ownersRisky|pts} million for the owners.',
      'But only the risky plan gives Ava a shot at her bonus.',
      'Pay rules can steer a boss toward choices that hurt the owners.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Ava', icon: 'person' }, right: { name: 'Owners', icon: 'crowd' }, flows: [
          { dir: 'left', text: '{bonus|usd}M bonus if profit ≥ {target|usd}M' }
        ] },
        { k: 'line', text: 'Safe plan: {safe|usd}M for sure, no bonus', tone: 'note', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'tree', root: 'Risky plan', branches: [
          { label: '{pWin|pct}: {win|usd}M', text: 'Bonus paid, {keptWin|usd}M kept', tone: 'good' },
          { label: '{pLose|pct}: a loss', text: '{riskyLoss|susd}M', tone: 'bad' }
        ] },
        { k: 'line', text: '{pWin|pct} × {keptWin|usd}M − {pLose|pct} × {lossAmt|usd}M = ${ownersRisky|pts}M', tone: 'key', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'bars', items: [
          { label: 'Safe plan', value: 'safe', text: '{safe|usd}M', tone: 'good' },
          { label: 'Risky plan', value: 'ownersRisky', text: '${ownersRisky|pts}M', tone: 'bad' }
        ] },
        { k: 'line', text: 'Owners\' average, after the bonus', tone: 'note' },
        { k: 'line', text: 'Bonus chance: 0% vs {pWin|pct}', tone: 'bad' },
        { k: 'line', text: 'Incentives steer behavior', tone: 'key', cue: 5 }
      ] }
    ]
  }),

  E('26.5', 'fiduciary_conflict', {
    title: 'Client first, not just disclosed',
    given: { balance: 10000, feeX: 0.002, feeY: 0.012, years: 10 },
    calc: {
      costX: 'balance * feeX',
      costY: 'balance * feeY',
      extra: 'costY - costX',
      decade: 'extra * years'
    },
    say: [
      'Adviser Omar can suggest Fund X, with a {feeX|pct} yearly fee, or Fund Y, which holds similar things, charges {feeY|pct}, and pays Omar a bonus.',
      'On Nia\'s {balance|usd}, X costs {costX|usd} a year and Y costs {costY|usd}, so {extra|usd} more every year.',
      'Over ten years that is about {decade|usd}, before any growth.',
      'Telling Nia about his bonus does not make Fund Y right for her.',
      /* Closing in the example's own terms, not the knowledge check's. */
      'An adviser must put Nia\'s interests ahead of his own bonus.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Nia', icon: 'person' }, right: { name: 'Omar, adviser', icon: 'person2' }, flows: [
          { dir: 'left', text: 'Fund X or Fund Y?' }
        ] },
        { k: 'compare',
          left: { title: 'Fund X', lines: ['Fee {feeX|pct}', 'No bonus'], mark: null },
          right: { title: 'Fund Y', lines: ['Fee {feeY|pct}', 'Bonus for Omar'], mark: null } }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{balance|usd} × {feeX|pct} = {costX|usd}', tone: 'good' },
        { k: 'line', text: '{balance|usd} × {feeY|pct} = {costY|usd}', tone: 'bad' },
        { k: 'big', text: '{extra|usd}', label: 'Extra cost every year', tone: 'bad' },
        { k: 'line', text: '{extra|usd} × {years|num} years ≈ {decade|usd}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'stamp', text: 'Disclosed, but still costly', tone: 'bad' },
        { k: 'line', text: 'Her interests before his bonus', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* ---------------- Module 27: Quantitative and Systematic Research ---------------- */

  E('27.1', 'point_in_time', {
    title: 'Use it when it was known',
    given: { quarterEndDay: 31, publishDay: 25, useDay: 1, eps: 1, revised: 1.2 },
    calc: {
      peek: 'publishDay - useDay'
    },
    say: [
      'Sunny Juice\'s quarter ends on March {quarterEndDay|num}, but it does not publish results until April {publishDay|num}.',
      'A backtest that uses those results on April first is peeking {peek|num} days into the future.',
      'In July, the company revises its earnings from {eps|usd} to {revised|usd} a share.',
      /* The $1 belongs from April 25 (when it became public) until the July
       * revision; before April 25 the quarter's figure is not there at all. */
      'A point-in-time table shows {eps|usd} from April {publishDay} until July, because that is all anyone knew then.',
      /* Closing from the example's own dates, not the knowledge check's
       * wording, with the same wrong date (April first) as sentence 1. */
      'So a fair backtest may use Sunny Juice\'s results only from April {publishDay}, not from April first.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Quarter ends: Mar {quarterEndDay|num}', tone: 'note' },
        { k: 'line', text: 'Results public: Apr {publishDay|num}', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'numberLine', marks: [
          { at: 'useDay', label: 'Apr 1: test uses', tone: 'bad' },
          { at: 'publishDay', label: 'Apr {publishDay|num}: public', tone: 'good' }
        ], dot: { from: 'useDay', to: 'publishDay' } },
        { k: 'big', text: '{peek|num} days', label: 'Peeking into the future', tone: 'bad' }
      ] },
      /* Only the two facts at sentence 2; which figure the table shows (the
       * verdict) comes with sentence 3. */
      { cue: 2, items: [
        { k: 'compare',
          left: { title: 'Public Apr {publishDay}', lines: ['Earnings {eps|usd}'], mark: null },
          right: { title: 'Revised in July', lines: ['Earnings {revised|usd}'], mark: null } },
        { k: 'line', text: 'Table, Apr {publishDay} to July: {eps|usd}', tone: 'key', cue: 3 },
        { k: 'line', text: 'Usable from Apr {publishDay}, not Apr {useDay}', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('27.2', 'cross_validation', {
    title: 'The exam you open once',
    given: { ideas: 20, falsePass: 0.05 },
    calc: {
      noneFool: '(1 - falsePass) ^ ideas',
      atLeastOne: '1 - noneFool',
      atLeastOneR: 'round(atLeastOne, 2)',
      noneFoolR: 'round(noneFool, 2)'
    },
    say: [
      'Theo has a final exam dataset he promised to open only once.',
      'Instead, he tries {ideas|num} random signal ideas on it, and each useless idea still has a {falsePass|pct} chance to look good by luck.',
      'If the tries are independent, the chance that at least one fake winner shows up is about {atLeastOneR|pct}.',
      'Peeking again and again turned the exam into practice; the fix is to learn on older years and test on the next one.',
      'Keep the test set unseen until the very end.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: 'Open once', label: 'The final exam data', tone: 'key' },
        { k: 'line', text: '{ideas|num} ideas × {falsePass|pct} luck each', tone: 'note', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: '1 − 0.95^{ideas|num} ≈ {atLeastOneR|pct}', tone: 'key' },
        { k: 'bars', items: [
          { label: 'All fail', value: 'noneFoolR', text: '{noneFoolR|pct}', tone: 'note' },
          { label: 'Fake winner', value: 'atLeastOneR', text: '{atLeastOneR|pct}', tone: 'bad' }
        ] }
      ] },
      { cue: 3, items: [
        { k: 'steps', items: ['Learn yrs 1-3', 'Test yr 4', 'Learn yrs 1-4', 'Test yr 5'] },
        { k: 'line', text: 'Keep the test set unseen', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('27.3', 'turnover_cost', {
    title: 'Net beats raw',
    given: { grossA: 0.1, turnsA: 10, grossB: 0.07, turnsB: 2, costPerTurn: 0.005 },
    calc: {
      costA: 'turnsA * costPerTurn',
      netA: 'grossA - costA',
      costB: 'turnsB * costPerTurn',
      netB: 'grossB - costB',
      edgePts: '(netB - netA) * 100'
    },
    say: [
      'Before costs, Signal A earns {grossA|pct} a year and Signal B only {grossB|pct}, but A trades the whole portfolio ten times a year.',
      'At {costPerTurn|pct} per full turnover, that costs {costA|pct}, leaving {netA|pct}.',
      'Signal B trades only twice a year, costing {costB|pct} and leaving {netB|pct}.',
      'The weaker-looking signal comes out {edgePts|num} point ahead after costs.',
      /* Closing from the example, not the knowledge check's wording. */
      'Judge a signal by what it keeps after costs, not by what it earns before them.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'A raw', value: 'grossA', text: '{grossA|pct}', tone: 'key' },
          { label: 'B raw', value: 'grossB', text: '{grossB|pct}', tone: 'note' }
        ] },
        { k: 'line', text: 'A trades {turnsA|num} times a year', tone: 'bad' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'A: {turnsA|num} × {costPerTurn|pct} = {costA|pct} cost', tone: 'bad' },
        { k: 'line', text: 'A keeps {grossA|pct} − {costA|pct} = {netA|pct}', tone: 'note' },
        { k: 'line', text: 'B: {turnsB|num} × {costPerTurn|pct} = {costB|pct} cost', tone: 'note', cue: 2 },
        { k: 'line', text: 'B keeps {grossB|pct} − {costB|pct} = {netB|pct}', tone: 'good', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'A net', value: 'netA', text: '{netA|pct}', tone: 'bad' },
          { label: 'B net', value: 'netB', text: '{netB|pct}', tone: 'good' }
        ] },
        { k: 'big', text: '{edgePts|snum} point', label: 'B ahead after costs', tone: 'good' },
        { k: 'line', text: 'Net beats raw', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('27.4', 'data_leakage', {
    title: 'Too good to be true',
    given: { days: 1000, leakyAcc: 0.99, cleanHits: 520, coin: 0.5 },
    calc: {
      leakyHits: 'days * leakyAcc',
      cleanAcc: 'cleanHits / days',
      leakPts: '(leakyAcc - cleanAcc) * 100'
    },
    say: [
      'Zoe\'s model guesses whether a stock rises tomorrow, and it scores {leakyAcc|pct} on {days|num} test days.',
      'An audit finds a sneaky input: tomorrow\'s closing price, which nobody knows today.',
      'With that leak removed, it gets {cleanHits|num} of {days|num} right, which is {cleanAcc|pct}, barely above a coin flip\'s {coin|pct}.',
      'So {leakPts|num} points of that score came from leaked future information.',
      'High test accuracy means nothing if the future sneaks into the inputs.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Zoe', icon: 'person' }, right: { name: 'Model', icon: 'robot' }, flows: [
          { dir: 'left', text: 'Test score: {leakyAcc|pct}!' }
        ] },
        { k: 'line', text: '{leakyHits|num} of {days|num} right', tone: 'good' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Hidden input: tomorrow\'s close', tone: 'bad' },
        { k: 'line', text: 'Nobody knows it today', tone: 'note' }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'With leak', value: 'leakyAcc', text: '{leakyAcc|pct}', tone: 'bad' },
          { label: 'Leak removed', value: 'cleanAcc', text: '{cleanAcc|pct}', tone: 'key' },
          { label: 'Coin flip', value: 'coin', text: '{coin|pct}', tone: 'note' }
        ] },
        { k: 'line', text: '{cleanHits|num} ÷ {days|num} = {cleanAcc|pct}', tone: 'key' },
        { k: 'line', text: '{leakyAcc|pct} − {cleanAcc|pct} = {leakPts|num} points leaked', tone: 'bad', cue: 3 },
        { k: 'line', text: 'Leaked future = fake accuracy', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('27.5', 'model_monitoring', {
    title: 'A scoreboard and an off switch',
    given: { usual: 0.55, bandLow: 0.5, bandHigh: 0.6, window: 40, hits: 18 },
    calc: {
      rate: 'hits / window',
      belowPts: '(bandLow - rate) * 100'
    },
    say: [
      'A live model usually gets about {usual|pct} of its calls right, and its safe band is {bandLow|pct} to {bandHigh|pct}.',
      'Its rule says if the last {window|num} calls score below {bandLow|pct}, pause trading and alert a human.',
      'This week it got {hits|num} of {window|num} right, which is {rate|pct}.',
      'So the switch pauses it, and the team rolls back to the last good version while they check the data.',
      'A model that worked before still needs a scoreboard and an off switch.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'numberLine', marks: [
          { at: 'bandLow', label: 'Floor {bandLow|pct}', tone: 'bad' },
          { at: 'usual', label: 'Usual {usual|pct}', tone: 'good' },
          { at: 'bandHigh', label: 'Top {bandHigh|pct}', tone: 'note' }
        ] },
        { k: 'line', text: 'Safe band: {bandLow|pct} to {bandHigh|pct}', tone: 'key' },
        { k: 'line', text: 'Under {bandLow|pct} on {window|num} calls: pause', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: '{hits|num} ÷ {window|num} = {rate|pct}', tone: 'bad' },
        { k: 'numberLine', marks: [
          { at: 'rate', label: 'Now {rate|pct}', tone: 'bad' },
          { at: 'bandLow', label: 'Floor {bandLow|pct}', tone: 'note' },
          { at: 'usual', label: 'Usual {usual|pct}', tone: 'good' }
        ], dot: { from: 'usual', to: 'rate' } }
      ] },
      { cue: 3, items: [
        { k: 'big', text: 'PAUSE', label: 'Alert a human, roll back', tone: 'bad' },
        { k: 'line', text: '{belowPts|num} points below the floor', tone: 'bad' },
        { k: 'line', text: 'Worked before? Check it now', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* ---------------- Module 28: Applied Trading and Professional Practice ---------------- */

  E('28.1', 'scenario_tree', {
    title: 'Three paths before the bell',
    given: { price: 20, upper: 21, lower: 19, shares: 100, exit: 20.5, pUp: 0.3, pChop: 0.5, pDown: 0.2 },
    calc: {
      riskPerShare: 'upper - exit',
      risk: 'shares * riskPerShare',
      pSum: 'pUp + pChop + pDown'
    },
    say: [
      'Before the opening bell, Maya writes three paths for Orbit Oats, now at {price|usd}: above {upper|usd}, between {lower|usd} and {upper|usd}, or below {lower|usd}.',
      'If it opens above {upper|usd} and holds, her plan buys {shares|num} shares with an exit at {exit|usd}, risking at least {shares|num} times {riskPerShare|usd}, or {risk|usd}.',
      'If it chops between {lower|usd} and {upper|usd}, no trade, and if it drops below {lower|usd}, no buying at all.',
      'She guesses the paths at {pUp|pct}, {pChop|pct}, and {pDown|pct}, which add up to {pSum|pct}.',
      'When the bell rings, she follows the branch instead of forcing one prediction.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'tree', root: 'Orbit Oats: {price|usd} before open', branches: [
          { label: 'Above {upper|usd}', text: 'Plan A: buy, set an exit', tone: 'good' },
          { label: '{lower|usd} to {upper|usd}', text: 'No trade', tone: 'note' },
          { label: 'Below {lower|usd}', text: 'Stand aside', tone: 'bad' }
        ] }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Risk: at least {shares|num} × {riskPerShare|usd} = {risk|usd}', tone: 'key' },
        { k: 'line', text: 'Fill above {upper|usd} = more risk', tone: 'note' },
        { k: 'line', text: 'No-trade zone: {lower|usd} to {upper|usd}', tone: 'note', cue: 2 },
        { k: 'line', text: '{pUp|pct} + {pChop|pct} + {pDown|pct} = {pSum|pct}', tone: 'key', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'stamp', text: 'Follow the branch, not a guess', tone: 'key' }
      ] }
    ]
  }),

  E('28.2', 'gap_risk', {
    title: 'A stop is not a promise',
    given: { shares: 200, entry: 5, stop: 4.8, reopen: 4 },
    calc: {
      planPerShare: 'entry - stop',
      planRisk: 'shares * planPerShare',
      actualPerShare: 'entry - reopen',
      actualLoss: 'shares * actualPerShare',
      multiple: 'actualLoss / planRisk'
    },
    say: [
      'Leo buys {shares|num} shares of Nova Rockets at {entry|usd} with a stop at {stop|usd}, planning to risk {planRisk|usd}.',
      'News hits, trading halts, and the stock reopens at {reopen|usd}.',
      'His stop triggers, but it becomes a market order and fills at {reopen|usd}, not {stop|usd}.',
      'He loses {actualPerShare|usd} a share, or {actualLoss|usd}, five times his plan.',
      /* Closing from Leo's own trade, not the knowledge check's wording. */
      'His stop only decided when to sell, not the price he got.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'numberLine', marks: [
          { at: 'stop', label: 'Stop {stop|usd}', tone: 'bad' },
          { at: 'entry', label: 'Buy {entry|usd}', tone: 'key' }
        ], dot: { from: 'entry', to: 'stop' } },
        { k: 'line', text: '{shares|num} × {planPerShare|usd} = {planRisk|usd} planned', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'big', text: 'HALTED', label: 'Trading paused on news', tone: 'bad' },
        { k: 'numberLine', marks: [
          { at: 'reopen', label: 'Reopens {reopen|usd}', tone: 'bad' },
          { at: 'stop', label: 'Stop {stop|usd}', tone: 'note' },
          { at: 'entry', label: 'Buy {entry|usd}', tone: 'key' }
        ], dot: { from: 'entry', to: 'reopen' } },
        { k: 'line', text: 'Stop fills at {reopen|usd}, not {stop|usd}', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: '{shares|num} × {actualPerShare|usd} = {actualLoss|usd}', tone: 'bad' },
        { k: 'bars', items: [
          { label: 'Planned', value: 'planRisk', text: '{planRisk|usd}', tone: 'note' },
          { label: 'Actual', value: 'actualLoss', text: '{actualLoss|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: '{actualLoss|usd} ÷ {planRisk|usd} = {multiple|num} times the plan', tone: 'key' },
        { k: 'line', text: 'Stop = when to sell, not the price', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('28.3', 'tape_reading', {
    title: 'Pushing without progress',
    given: { earlyShares: 1000, nowShares: 5000, price: 10 },
    calc: {
      ratio: 'nowShares / earlyShares'
    },
    say: [
      'Earlier, just {earlyShares|num} shares of buying pushed the price up 5 cents to {price|usd}.',
      /* Buyers take (lift) the offer; sellers would hit the bid. */
      'Now buyers keep buying from sellers at {price|usd}, and {nowShares|num} shares trade in two minutes.',
      'But the price never gets even one cent higher.',
      'Five times the buying with zero progress suggests a big seller is soaking it up, which traders call absorption.',
      'It warns that the climb may be over, but it is a clue to weigh, not proof of what comes next.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: '{earlyShares|num} shares → up 5¢', tone: 'good' },
        { k: 'line', text: '{nowShares|num} shares in 2 minutes', tone: 'note', cue: 1 }
      ] },
      /* "Up 0¢" appears with sentence 2, which reveals it. */
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: '{earlyShares|num} early', value: 'earlyShares', text: 'Up 5¢', tone: 'good' },
          { label: '{nowShares|num} now', value: 'nowShares', text: 'Up 0¢', tone: 'bad' }
        ] },
        { k: 'line', text: 'Price stuck at {price|usd}', tone: 'bad' },
        { k: 'line', text: '{ratio|num} times the buying, no progress', tone: 'key', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'compare',
          left: { title: 'Evidence', lines: ['Buying: heavy', 'Progress: none', 'Read: absorption?'], mark: null },
          right: { title: 'Still unknown', lines: ['Seller\'s full size', 'What comes next'], mark: null } },
        { k: 'stamp', text: 'Effort without progress', tone: 'bad' }
      ] }
    ]
  }),

  E('28.4', 'trade_review', {
    title: 'A win with a bad process',
    given: { planShares: 100, planEntry: 10, stop: 9.5, actualShares: 300, actualEntry: 10.2, exit: 10.8 },
    calc: {
      actualPnl: 'actualShares * (exit - actualEntry)',
      planPnl: 'planShares * (exit - planEntry)',
      oversize: '(actualShares - planShares) * (exit - planEntry)',
      lateCost: 'actualShares * (actualEntry - planEntry)',
      lateSigned: '-lateCost',
      total: 'planPnl + oversize - lateCost',
      planRisk: 'planShares * (planEntry - stop)',
      actualRisk: 'actualShares * (actualEntry - stop)'
    },
    say: [
      'Nia planned to buy {planShares|num} shares at {planEntry|usd} with a stop at {stop|usd}, risking {planRisk|usd}.',
      'Instead she bought {actualShares|num} shares late at {actualEntry|usd} and sold at {exit|usd}, making {actualPnl|usd}.',
      'Split it up: the planned trade would have made {planPnl|usd}, the extra size added {oversize|usd}, and the late entry cost {lateCost|usd}.',
      'It was a win, but her real risk was {actualRisk|usd} instead of {planRisk|usd}.',
      'A good result can hide a poor process, so review the parts, not just the total.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Plan: {planShares|num} at {planEntry|usd}, stop {stop|usd}', tone: 'note' },
        { k: 'line', text: 'Planned risk: {planRisk|usd}', tone: 'note' },
        { k: 'line', text: 'Did: {actualShares|num} at {actualEntry|usd}, sold {exit|usd}', tone: 'bad', cue: 1 },
        { k: 'line', text: 'Made {actualPnl|usd}', tone: 'good', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'Plan', value: 'planPnl', text: '{planPnl|susd}', tone: 'good' },
          { label: 'Extra size', value: 'oversize', text: '{oversize|susd}', tone: 'good' },
          { label: 'Late entry', value: 'lateSigned', text: '{lateSigned|susd}', tone: 'bad' }
        ] },
        { k: 'line', text: '{planPnl|usd} + {oversize|usd} − {lateCost|usd} = {total|usd}', tone: 'key' }
      ] },
      { cue: 3, items: [
        { k: 'big', text: '{actualRisk|usd}', label: 'Real risk vs {planRisk|usd} planned', tone: 'bad' },
        { k: 'line', text: '{actualShares|num} × ({actualEntry|usd} − {stop|usd}) = {actualRisk|usd}', tone: 'key' },
        { k: 'line', text: 'A win can hide a bad process', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('28.5', 'capstone_breakeven', {
    title: 'Defend the idea with numbers',
    given: { price: 20, value: 25, stopPrice: 18, shares: 20, salesGrowth: 0.2 },
    calc: {
      upside: 'value - price',
      downside: 'price - stopPrice',
      risk: 'shares * downside',
      spots: 'upside + downside',
      breakEven: 'round(downside / spots, 2)'
    },
    say: [
      'To a pretend risk committee, Maya defends Harbor Bikes: a filing shows sales up {salesGrowth|pct}, and she values it at {value|usd} versus {price|usd} today.',
      'She is wrong below {stopPrice|usd}, so with {shares|num} shares she risks {downside|usd} each, or {risk|usd}, to try to make {upside|usd} each.',
      'Winning {upside|usd} against losing {downside|usd} only pays on average if she is right more than two times in seven, about {breakEven|pct}.',
      'A committee member pushes back that bike sales are seasonal, which could lower her odds.',
      'A strong idea is sourced, does the math, and stays open to being wrong.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Maya', icon: 'person' }, right: { name: 'Committee', icon: 'judge' }, flows: [
          { dir: 'right', text: 'Filing: sales {salesGrowth|spct}' },
          { dir: 'left', text: 'How could you be wrong?' }
        ] },
        { k: 'line', text: 'Value {value|usd} vs price {price|usd}', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'numberLine', marks: [
          { at: 'stopPrice', label: 'Wrong {stopPrice|usd}', tone: 'bad' },
          { at: 'price', label: 'Price {price|usd}', tone: 'key' },
          { at: 'value', label: 'Value {value|usd}', tone: 'good' }
        ] },
        { k: 'line', text: '{shares|num} × {downside|usd} = {risk|usd} at risk', tone: 'bad' },
        { k: 'line', text: 'Gain {upside|usd} vs risk {downside|usd} a share', tone: 'note' }
      ] },
      { cue: 2, items: [
        { k: 'line', text: '{downside|usd} ÷ ({upside|usd} + {downside|usd}) ≈ {breakEven|pct}', tone: 'key' },
        { k: 'big', text: '{breakEven|pct}+', label: 'Chance needed to pay off', tone: 'key' },
        { k: 'line', text: 'Rebuttal: sales are seasonal', tone: 'note', cue: 3 },
        { k: 'line', text: 'Show sources, math, and doubts', tone: 'key', cue: 4 }
      ] }
    ]
  })
];

const BY_ID = {};
for (const record of RECORDS) {
  if (Object.prototype.hasOwnProperty.call(BY_ID, record.id)) throw new Error(`m21-28: ${record.id} is authored twice`);
  BY_ID[record.id] = record;
}

module.exports = Object.freeze(BY_ID);
