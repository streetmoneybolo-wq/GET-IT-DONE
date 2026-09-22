'use strict';

/* Authored whiteboard examples for modules 1 to 13 (1.1, 7.1 and 9.1 live in
 * reference.js). Original Academy material: fictional people and fictional
 * companies, and every number shown or spoken is a given or a calc result
 * (the validator rejects any other number above 12). Educational only: no
 * advice, no guarantees, no real tickers and no real market events. */

const { E, B } = require('../examples');

module.exports = [
  /* 1.2 Market, limit and stop orders; a triggered stop becomes a market order. */
  E('1.2', 'order_types', {
    title: 'Fast, safe price, or a trigger?',
    given: { price: 20, limit: 19.5, shares: 100, stop: 18, before: 18.4, fill: 17.6 },
    calc: {
      plannedLoss: '(price - stop) * shares',
      actualLoss: '(price - fill) * shares',
      slip: 'stop - fill',
      slipTotal: 'slip * shares',
      plannedSigned: '-plannedLoss',
      actualSigned: '-actualLoss'
    },
    say: [
      'Leo wants Sunny Juice shares at {price|usd}, and a market order buys right away at whatever sellers ask.',
      'A limit order at {limit|usd} never pays more than that, but if no seller comes down, Leo gets nothing.',
      'Maya owns {shares|num} shares bought at {price|usd} with a stop at {stop|usd}, so she plans to lose at most {plannedLoss|usd}.',
      'Bad news makes the price gap down from {before|usd} straight to {fill|usd}, and her triggered stop turns into a market order that sells there.',
      'She loses {actualLoss|usd}, not {plannedLoss|usd}, because a stop picks when to sell, not the price.'
    ],
    frames: [
      /* Each order type appears with the sentence that explains it. */
      { cue: 0, items: [
        { k: 'line', text: 'Market: fills now, price unknown', tone: 'note' },
        { k: 'line', text: 'Limit {limit|usd}: never pays more', tone: 'key', cue: 1 },
        { k: 'line', text: 'Limit: may never fill', tone: 'bad', cue: 1 },
        { k: 'line', text: 'Maya: stop {stop|usd}, max loss {plannedLoss|usd}', tone: 'note', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'numberLine', marks: [
          { at: 'fill', label: 'Sold {fill|usd}', tone: 'bad' },
          { at: 'stop', label: 'Stop {stop|usd}', tone: 'key' },
          { at: 'before', label: 'Was {before|usd}', tone: 'note' }
        ], dot: { from: 'before', to: 'fill' } },
        { k: 'line', text: 'Triggered stop = market order', tone: 'key' },
        /* The $0.40 is how far the fill landed below the stop (the slippage
         * on the next frame), not the $0.80 gap from $18.40 to $17.60. */
        { k: 'line', text: 'Below stop: {stop|usd} − {fill|usd} = {slip|usd}', tone: 'bad' }
      ] },
      { cue: 4, items: [
        { k: 'bars', items: [
          { label: 'Planned', value: 'plannedSigned', text: '{plannedSigned|susd}', tone: 'note' },
          { label: 'Actual', value: 'actualSigned', text: '{actualSigned|susd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Slippage: {slip|usd} × {shares|num} = {slipTotal|usd}', tone: 'bad' },
        { k: 'stamp', text: 'Stop sets when, not the price', tone: 'key' }
      ] }
    ]
  }),

  /* 2.1 A candle keeps open, high, low, close and volume but drops the path. */
  E('2.1', 'candle_ohlc', {
    title: 'Two days, one candle',
    given: { open: 10, high: 12, low: 9, close: 11, volume: 1000 },
    calc: {
      body: 'close - open',
      range: 'high - low',
      upper: 'high - close',
      lower: 'open - low'
    },
    say: [
      'Rocket Rolls Bakery had two days that drew the exact same candle: open {open|usd}, high {high|usd}, low {low|usd}, close {close|usd}, with {volume|num} shares traded.',
      'The green body runs {body|usd} from open to close, and the whole range is {range|usd}.',
      'On Monday the price hit {high|usd} first, crashed to {low|usd}, then climbed back to {close|usd}.',
      'On Tuesday it sank to {low|usd} first, then rallied to {high|usd} and settled at {close|usd}.',
      'A candle keeps four prices and the volume but throws away the path, so zoom into smaller bars to see how the day moved.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'candle', open: 'open', high: 'high', low: 'low', close: 'close' },
        { k: 'line', text: 'O {open|usd} · H {high|usd} · L {low|usd} · C {close|usd}', tone: 'note' },
        { k: 'line', text: 'Volume: {volume|num} shares', tone: 'note' },
        { k: 'line', text: 'Body: {close|usd} − {open|usd} = {body|usd}', tone: 'good', cue: 1 },
        { k: 'line', text: 'Range: {high|usd} − {low|usd} = {range|usd}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Monday: {high|usd} → {low|usd} → {close|usd}', tone: 'bad' },
        { k: 'line', text: 'Tuesday: {low|usd} → {high|usd} → {close|usd}', tone: 'good', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'stamp', text: 'Same candle, different path', tone: 'key' },
        { k: 'line', text: 'Zoom in: small bars show the path', tone: 'note' }
      ] }
    ]
  }),

  /* 2.2 Percent moves multiply; volatility is how far returns swing, not loss.
   * Up 20% then down 20% (not the knowledge check's 10% and 10%, which the
   * learner still has to work out). */
  E('2.2', 'returns_volatility', {
    title: 'Up {up|pct}, down {down|pct}, not even',
    given: { start: 100, up: 0.2, down: 0.2, leoDay: 0.01, mayaA: 0.05, mayaB: -0.04, mayaC: 0.02 },
    calc: {
      after1: 'start * (1 + up)',
      drop: 'after1 * down',
      after2: 'after1 - drop',
      growUp: '1 + up',
      growDown: '1 - down',
      total: 'after2 / start - 1',
      totalAbs: 'abs(total)',
      mayaBAbs: 'abs(mayaB)',
      mean: '(mayaA + mayaB + mayaC) / 3',
      sd: 'sqrt(((mayaA - mean)^2 + (mayaB - mean)^2 + (mayaC - mean)^2) / 2)'
    },
    say: [
      'Maya puts {start|usd} into Cloudberry Games, and it rises {up|pct} to {after1|usd}.',
      'Then it falls {down|pct}, but {down|pct} of {after1|usd} is {drop|usd}, so she ends at {after2|usd}: a loss of {totalAbs|pct}, not break-even.',
      'Next, Leo\'s shares rise {leoDay|pct} three days in a row, while Maya\'s rise {mayaA|pct}, fall {mayaBAbs|pct}, then rise {mayaC|pct}.',
      'Both average {mean|pct} a day, but Maya\'s days swing from minus {mayaBAbs|pct} to plus {mayaA|pct}, while Leo\'s never change.',
      'That swinging is volatility: it measures how widely returns scatter, not how much you lose.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: '{start|usd} × {growUp|num} = {after1|usd}', tone: 'good' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{after1|usd} × {growDown|num} = {after2|usd}', tone: 'bad' },
        { k: 'big', text: '{total|spct}', label: 'Total return', tone: 'bad' }
      ] },
      /* Only the raw daily returns at cue 2; the averages and Maya's swing
       * range appear with sentence 3, which says them. */
      { cue: 2, items: [
        { k: 'compare',
          left: { title: 'Leo', lines: ['{leoDay|spct}, {leoDay|spct}, {leoDay|spct}'], mark: null },
          right: { title: 'Maya', lines: ['{mayaA|spct}, {mayaB|spct}, {mayaC|spct}'], mark: null } },
        { k: 'line', text: 'Both average {mean|spct} a day', tone: 'note', cue: 3 },
        { k: 'line', text: 'Maya swings {mayaB|spct} to {mayaA|spct}', tone: 'bad', cue: 3 },
        { k: 'line', text: 'Volatility = swings, not loss', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* 3.1 A support line is a hypothesis: wait for evidence and set invalidation. */
  E('3.1', 'support_hypothesis', {
    title: 'A line on a chart is a question',
    given: { level: 20, visits: 10, bounces: 6, trigger: 21, stop: 19, shares: 50 },
    calc: {
      breaks: 'visits - bounces',
      bounceRate: 'bounces / visits',
      risk: 'trigger - stop',
      riskTotal: 'risk * shares'
    },
    say: [
      'Omar draws a support line at {level|usd} on Lantern Labs: in his notes, the price bounced there {bounces|num} times and broke through {breaks|num} times.',
      'That is {visits|num} visits, so the line held {bounceRate|pct} of the time, not always.',
      'Back at {level|usd}, Omar plans ahead: he buys only on a close above {trigger|usd}, and a close below {stop|usd} cancels the idea.',
      /* The exit fires after a close below the stop, so the fill can be lower:
       * the risk is at least, not exactly, the gap to the stop. */
      'If he buys at {trigger|usd}, a close below {stop|usd} is his exit, so he risks at least {risk|usd} a share, or {riskTotal|usd} on {shares|num} shares.',
      'A chart shape is a question to test, not an answer.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Support line: {level|usd}', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Bounced', value: 'bounces', text: '{bounces|num} times', tone: 'good' },
          { label: 'Broke', value: 'breaks', text: '{breaks|num} times', tone: 'bad' }
        ] },
        { k: 'line', text: '{bounces|num} ÷ {visits|num} = {bounceRate|pct}, not always', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'tree', root: 'Price back at {level|usd}', branches: [
          { label: 'Closes above {trigger|usd}', text: 'Buy, exit below {stop|usd}', tone: 'good' },
          { label: 'Closes below {stop|usd}', text: 'Idea wrong: stay out', tone: 'bad' }
        ] },
        { k: 'line', text: 'Risk: at least {risk|usd} × {shares|num} = {riskTotal|usd}', tone: 'bad', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'stamp', text: 'A shape is a question', tone: 'key' },
        { k: 'line', text: 'Plan the trigger and exit first', tone: 'note' }
      ] }
    ]
  }),

  /* 3.2 Confirmation: volume against normal and price acceptance. The story
   * ends inside the example; the RSI lookback question is left to the check.
   * The false break happened last month, BEFORE Monday's confirmed breakout:
   * told as the next day, it would have to fall back under $30 first, so the
   * confirmed breakout would be heard failing a day later. */
  E('3.2', 'breakout_confirmation', {
    title: 'Same line, different evidence',
    given: { normal: 10000, level: 30, monVol: 30000, pastVol: 8000, poke: 30.2, back: 29.5 },
    calc: {
      monRel: 'monVol / normal',
      pastRel: 'pastVol / normal',
      pokeAbove: 'poke - level',
      fellBack: 'level - back'
    },
    say: [
      'Tiny Turtle Toys usually trades {normal|num} shares in its first hour, and the chart has a line at {level|usd}.',
      /* Both occasions are measured over the same first hour as "normal", so
       * the ratios compare like with like (the time-of-day normalization). */
      'In Monday\'s first hour, price pushes above {level|usd} on {monVol|num} shares, {monRel|num} times normal, and stays there: a confirmed breakout.',
      'Last month, it poked to {poke|usd} in the first hour on {pastVol|num} shares, {pastRel|num} times normal, then slid back to {back|usd}: a false break.',
      'Same line, different evidence, and volume only means something next to what is normal.',
      'Before trusting a break, ask: did price stay above the line, and was volume above normal?'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Normal first hour: {normal|num} shares', tone: 'note' },
        { k: 'line', text: 'Breakout line: {level|usd}', tone: 'key' },
        { k: 'line', text: 'Monday: {monVol|num} ÷ {normal|num} = {monRel|x}', tone: 'good', cue: 1 },
        { k: 'line', text: 'Price stays above {level|usd}: accepted', tone: 'good', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'numberLine', marks: [
          { at: 'back', label: 'Back to {back|usd}', tone: 'bad' },
          { at: 'level', label: 'Line {level|usd}', tone: 'key' },
          { at: 'poke', label: 'Poke {poke|usd}', tone: 'note' }
        ], dot: { from: 'poke', to: 'back' } },
        { k: 'line', text: 'Last month: {pastVol|num} ÷ {normal|num} = {pastRel|x}', tone: 'bad' }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Normal', value: 'normal', text: '{normal|num}', tone: 'note' },
          { label: 'Monday', value: 'monVol', text: '{monRel|x} normal', tone: 'good' },
          { label: 'Last month', value: 'pastVol', text: '{pastRel|x} normal', tone: 'bad' }
        ] },
        { k: 'stamp', text: 'Same line, different evidence', tone: 'key' },
        { k: 'line', text: 'Held the line? Volume vs normal?', tone: 'note', cue: 4 }
      ] }
    ]
  }),

  /* 4.1 Profit versus cash: a rise in receivables lowers operating cash flow. */
  E('4.1', 'cash_vs_profit', {
    title: 'Profit is not cash',
    given: { sales: 1000, costs: 600, paid: 700 },
    calc: {
      profit: 'sales - costs',
      owed: 'sales - paid',
      cash: 'profit - owed',
      cashCheck: 'paid - costs'
    },
    say: [
      'Maya\'s smoothie stand sells {sales|usd} of drinks this month and pays {costs|usd} in cash for fruit and cups, so her profit is {profit|usd}.',
      'But the school cafe has paid only {paid|usd} so far and still owes her {owed|usd}.',
      'That IOU is called a receivable: it counts in profit and sits on the balance sheet as an asset, but it is not cash yet.',
      'On the cash-flow statement, {profit|usd} of profit minus the {owed|usd} rise in receivables leaves {cash|usd} of cash.',
      'Profit grew by {profit|usd}, but her cash box grew by only {cash|usd}.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Maya', icon: 'person' }, right: { name: 'School cafe', icon: 'shop' }, flows: [
          { dir: 'right', text: 'Drinks worth {sales|usd}' },
          { dir: 'left', text: 'Pays for the drinks' }
        ] },
        { k: 'line', text: 'Profit: {sales|usd} − {costs|usd} = {profit|usd}', tone: 'key' },
        { k: 'line', text: 'Cafe paid {paid|usd}, still owes {owed|usd}', tone: 'note', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'IOU = receivable, an asset', tone: 'key' },
        { k: 'line', text: 'Counts in profit, not yet cash', tone: 'note' }
      ] },
      { cue: 3, items: [
        { k: 'steps', items: ['Profit {profit|usd}', '− IOU {owed|usd}', '= Cash {cash|usd}'] },
        { k: 'line', text: 'Check: {paid|usd} in − {costs|usd} out = {cashCheck|usd}', tone: 'note' },
        { k: 'big', text: '{cash|usd}', label: 'Cash box grew only this', tone: 'bad' },
        { k: 'line', text: 'Profit is not cash', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* 4.2 Margins and cash conversion: profit backed by cash is higher quality. */
  E('4.2', 'earnings_quality', {
    title: 'Same profit, different quality',
    given: { sales: 1000, profit: 100, cashA: 95, cashB: 40 },
    calc: {
      margin: 'profit / sales',
      convA: 'cashA / profit',
      convB: 'cashB / profit',
      gapB: 'profit - cashB'
    },
    say: [
      'Lagoon Lane Lemonade and Fizz Town Soda each sell {sales|usd} and report {profit|usd} of profit, a {margin|pct} margin.',
      'Lagoon Lane actually collects {cashA|usd} of cash from that profit, which is {convA|pct}.',
      'Fizz Town collects only {cashB|usd}, which is {convB|pct}, and year after year its customers owe it more with no clear reason.',
      'Same profit on paper, but a {gapB|usd} gap between profit and cash that keeps coming back is a warning sign.',
      'Profit you can trust keeps turning into real cash.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'compare',
          left: { title: 'Lagoon Lane', lines: ['Sales {sales|usd}', 'Profit {profit|usd}', 'Margin {margin|pct}'], mark: null },
          right: { title: 'Fizz Town', lines: ['Sales {sales|usd}', 'Profit {profit|usd}', 'Margin {margin|pct}'], mark: null } },
        { k: 'line', text: '{profit|usd} ÷ {sales|usd} = {margin|pct} margin', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Lagoon Lane: {cashA|usd} ÷ {profit|usd} = {convA|pct}', tone: 'good' },
        { k: 'line', text: 'Fizz Town: {cashB|usd} ÷ {profit|usd} = {convB|pct}', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Lagoon Lane', value: 'cashA', text: 'Cash {cashA|usd}', tone: 'good' },
          { label: 'Fizz Town', value: 'cashB', text: 'Cash {cashB|usd}', tone: 'bad' }
        ] },
        { k: 'big', text: '{gapB|usd}', label: 'Profit not backed by cash', tone: 'bad' },
        { k: 'stamp', text: 'Cash backs good profit', tone: 'key' }
      ] }
    ]
  }),

  /* 5.1 Present value: a higher discount rate lowers value today. */
  B('5.1', 'present_value', 'presentValue', {
    receiver: 'Leo',
    amount: 110,
    rate: 0.1,
    years: 1,
    compareRate: 0.2,
    title: 'What a promise is worth today'
  }),

  /* 5.2 A low P/E can reflect shrinking earnings, not a bargain. */
  E('5.2', 'multiples', {
    title: 'Is a low P/E a bargain?',
    given: { priceA: 50, epsA: 5, priceB: 100, epsB: 4, nextA: 2.5, nextB: 5 },
    calc: {
      peA: 'priceA / epsA',
      peB: 'priceB / epsB',
      fwdA: 'priceA / nextA',
      fwdB: 'priceB / nextB',
      growB: '(nextB - epsB) / epsB'
    },
    say: [
      'Crumb Bakery costs {priceA|usd} a share and earns {epsA|usd} a share a year, so its price-to-earnings ratio is {peA|num}.',
      'Rise Up Bakery costs {priceB|usd} and earns {epsB|usd}, a ratio of {peB|num}, so Crumb looks cheaper.',
      'But next year Crumb\'s earnings are expected to fall to {nextA|usd}, while Rise Up\'s grow to {nextB|usd}.',
      'On next year\'s numbers both ratios become {fwdA|num}: Crumb\'s doubles because its earnings halve, and Rise Up\'s falls because its earnings grow {growB|pct}.',
      'A low price-to-earnings ratio can be a warning about shrinking profits, not a bargain.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Crumb: {priceA|usd} ÷ {epsA|usd} = P/E {peA|num}', tone: 'note' },
        { k: 'line', text: 'Rise Up: {priceB|usd} ÷ {epsB|usd} = P/E {peB|num}', tone: 'note', cue: 1 },
        { k: 'line', text: 'Crumb looks cheaper?', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Crumb earnings: {epsA|usd} → {nextA|usd}', tone: 'bad' },
        { k: 'line', text: 'Rise Up earnings: {epsB|usd} → {nextB|usd}', tone: 'good' },
        { k: 'line', text: 'Crumb: {priceA|usd} ÷ {nextA|usd} = P/E {fwdA|num}', tone: 'key', cue: 3 },
        { k: 'line', text: 'Rise Up: {priceB|usd} ÷ {nextB|usd} = P/E {fwdB|num}', tone: 'key', cue: 3 },
        { k: 'line', text: 'Crumb halves, Rise Up grows {growB|pct}', tone: 'note', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'stamp', text: 'Low P/E can be a warning', tone: 'bad' }
      ] }
    ]
  }),

  /* 6.1 Rate changes hit faraway cash flows harder (more discounting periods). */
  E('6.1', 'rates_duration', {
    title: 'Far-away money feels rates more',
    given: { amount: 100, r1: 0.05, r2: 0.06, far: 10 },
    calc: {
      grow1: '1 + r1',
      nearLow: 'amount / (1 + r1)',
      farLow: 'amount / (1 + r1)^far',
      nearHigh: 'amount / (1 + r2)',
      farHigh: 'amount / (1 + r2)^far',
      nearChange: 'nearHigh / nearLow - 1',
      farChange: 'farHigh / farLow - 1',
      nearDrop: 'abs(nearChange)',
      farDrop: 'abs(farChange)'
    },
    say: [
      'Quick Snack owes Maya {amount|usd} next year, and Far Orchard owes Leo {amount|usd} in ten years.',
      'At a {r1|pct} rate, Maya\'s promise is worth about {nearLow|usdr} today and Leo\'s about {farLow|usdr}: money is discounted once per year of waiting.',
      'Now rates rise to {r2|pct}.',
      'Maya\'s value slips to about {nearHigh|usdr}, down less than 1%, but Leo\'s falls to about {farHigh|usdr}, down about {farDrop|pctr}.',
      'The higher rate hits Maya once and Leo ten times, so faraway cash feels rate changes the most.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'numberLine', marks: [
          { at: 0, label: 'Today', tone: 'note' },
          { at: 1, label: 'Maya: year 1', tone: 'good' },
          { at: 'far', label: 'Leo: year {far|num}', tone: 'key' }
        ], dot: { from: 'far', to: 0 } },
        { k: 'line', text: 'Maya: {amount|usd} ÷ {grow1|num} = {nearLow|usd}', tone: 'good', cue: 1 },
        { k: 'line', text: 'Leo: ÷ {grow1|num} ten times = {farLow|usd}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Rate: {r1|pct} → {r2|pct}', tone: 'bad' },
        { k: 'line', text: 'Maya: {nearLow|usd} → {nearHigh|usd}', tone: 'note', cue: 3 },
        { k: 'line', text: 'Leo: {farLow|usd} → {farHigh|usd}', tone: 'bad', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'bars', items: [
          { label: 'Maya', value: 'nearChange', text: '{nearChange|spct}', tone: 'note' },
          { label: 'Leo', value: 'farChange', text: '{farChange|spct}', tone: 'bad' }
        ] },
        { k: 'stamp', text: 'Once vs ten times', tone: 'key' },
        { k: 'line', text: 'Far cash feels rate changes most', tone: 'note' }
      ] }
    ]
  }),

  /* 6.2 Correlation is conditional: opposites can fall together under stress. */
  E('6.2', 'correlation_regime', {
    title: 'Opposites until the panic',
    given: { total: 100, juiceUp: 0.02, umbDown: 0.01, panic: 0.1 },
    calc: {
      half: 'total / 2',
      juiceGain: 'half * juiceUp',
      umbLoss: 'half * umbDown',
      calmNet: 'juiceGain - umbLoss',
      umbMove: '-umbDown',
      umbSigned: '-umbLoss',
      panicLoss: 'half * panic',
      panicTotal: 'panicLoss * 2',
      panicMove: '-panic',
      panicSigned: '-panicLoss',
      panicTotalSigned: '-panicTotal'
    },
    say: [
      'Maya splits {total|usd} between Sunny Juice and Cozy Umbrella, because they usually move in opposite directions.',
      'In a sunny week, juice gains {juiceUp|pct}, or {juiceGain|usd}, and umbrellas slip {umbDown|pct}, or {umbLoss|usd}, so she nets a gain of {calmNet|usd}.',
      'Then a panic week hits and people sell everything at once.',
      'Both fall {panic|pct}, so she loses {panicLoss|usd} plus {panicLoss|usd}, which is {panicTotal|usd}.',
      'Correlation is not a fixed rule: things that move apart in calm times can move together under stress.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Maya: {half|usd} juice, {half|usd} umbrellas', tone: 'note' },
        { k: 'line', text: 'Usually they move opposite ways', tone: 'key' },
        { k: 'line', text: 'Juice {juiceUp|spct}: {juiceGain|susd}', tone: 'good', cue: 1 },
        { k: 'line', text: 'Umbrella {umbMove|spct}: {umbSigned|susd}', tone: 'bad', cue: 1 },
        { k: 'line', text: 'Calm week: {calmNet|susd}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'stamp', text: 'Panic week', tone: 'bad' },
        { k: 'line', text: 'Both {panicMove|spct}', tone: 'bad', cue: 3 },
        { k: 'line', text: '{panicSigned|susd} + {panicSigned|susd} = {panicTotalSigned|susd}', tone: 'bad', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'bars', items: [
          { label: 'Calm week', value: 'calmNet', text: '{calmNet|susd}', tone: 'good' },
          { label: 'Panic week', value: 'panicTotalSigned', text: '{panicTotalSigned|susd}', tone: 'bad' }
        ] },
        { k: 'stamp', text: 'Correlation shifts in stress', tone: 'key' }
      ] }
    ]
  }),

  /* 7.2 Diversification needs low correlation; drawdowns need bigger gains back. */
  E('7.2', 'diversification_drawdown', {
    title: 'Ten stocks, one bet',
    given: { total: 1000, drop: 0.3 },
    calc: {
      keep: '1 - drop',
      mayaAfter: 'total * keep',
      mayaLost: 'total - mayaAfter',
      recover: 'mayaLost / mayaAfter',
      half: 'total / 2',
      leoSpace: 'half * keep',
      leoAfter: 'leoSpace + half',
      leoLost: 'total - leoAfter',
      leoDip: 'leoLost / total',
      mayaSigned: '-mayaLost',
      leoSigned: '-leoLost'
    },
    say: [
      'Maya spreads {total|usd} across ten space-tourism stocks, but all ten ride the same idea.',
      'Bad space news hits, all ten drop {drop|pct} together, and {total|usd} becomes {mayaAfter|usd}.',
      'To climb back she needs {mayaLost|usd} on {mayaAfter|usd}, a gain of about {recover|pctr}.',
      'Leo puts {half|usd} in space stocks and {half|usd} in a steady soup company that holds still, so he ends at {leoAfter|usd}, down {leoDip|pct}.',
      'Diversification works when the pieces do not all move together.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Maya: ten stocks, one idea', tone: 'bad' },
        { k: 'line', text: '{total|usd} × {keep|num} = {mayaAfter|usd}', tone: 'bad', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: '{mayaLost|usd} ÷ {mayaAfter|usd} = {recover|pct}', tone: 'key' },
        { k: 'big', text: '{recover|spct}', label: 'Gain needed to get back', tone: 'key' }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Leo: {leoSpace|usd} + {half|usd} = {leoAfter|usd}', tone: 'good' },
        { k: 'bars', items: [
          { label: 'Maya {mayaAfter|usd}', value: 'mayaSigned', text: 'Down {drop|pct}', tone: 'bad' },
          { label: 'Leo {leoAfter|usd}', value: 'leoSigned', text: 'Down {leoDip|pct}', tone: 'good' }
        ] },
        { k: 'line', text: 'Pieces moving apart soften a fall', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* 8.1 Base rate first, then update by how diagnostic the signal is. */
  E('8.1', 'base_rate_bayes', {
    title: 'Start with the base rate',
    given: { total: 100, real: 20, hitsReal: 15, hitsFake: 20 },
    calc: {
      fake: 'total - real',
      base: 'real / total',
      catchRate: 'hitsReal / real',
      falseRate: 'hitsFake / fake',
      flashes: 'hitsReal + hitsFake',
      post: 'hitsReal / flashes',
      postRound: 'round(post, 2)'
    },
    say: [
      'Maya\'s notebook has {total|num} breakouts: only {real|num} kept going and {fake|num} faded, so the base rate is {base|pct}.',
      'Her volume-spike signal showed up on {hitsReal|num} of the {real|num} real ones, which is {catchRate|pct}.',
      'But it also showed up on {hitsFake|num} of the {fake|num} fakes, which is {falseRate|pct}.',
      'So when the signal flashes, {hitsReal|num} of the {flashes|num} flashes are real, about {postRound|pct}.',
      'That is more than double the {base|pct} start but still less than half, so the signal helps without settling the question.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Kept going', value: 'real', text: '{real|num} real', tone: 'good' },
          { label: 'Faded', value: 'fake', text: '{fake|num} fakes', tone: 'note' }
        ] },
        { k: 'big', text: '{base|pct}', label: 'Base rate', tone: 'key' },
        { k: 'line', text: 'Flashed on {hitsReal|num} of {real|num} real: {catchRate|pct}', tone: 'good', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'tree', root: 'Signal flashes on', branches: [
          { label: 'Real: {hitsReal|num} of {real|num}', text: '{catchRate|pct} caught', tone: 'good' },
          { label: 'Fake: {hitsFake|num} of {fake|num}', text: '{falseRate|pct} false alarms', tone: 'bad' }
        ] }
      ] },
      { cue: 3, items: [
        { k: 'line', text: '{hitsReal|num} + {hitsFake|num} = {flashes|num} flashes', tone: 'note' },
        { k: 'line', text: '{hitsReal|num} ÷ {flashes|num} ≈ {postRound|pct}', tone: 'key' },
        { k: 'big', text: '{postRound|pct}', label: 'Real, given a flash', tone: 'key' },
        { k: 'line', text: 'Up from {base|pct}, still under half', tone: 'note', cue: 4 }
      ] }
    ]
  }),

  /* 8.2 Many tries make lucky winners; a true walk-forward test fits on past
   * years, tests on the next unseen year, then rolls forward and repeats. */
  E('8.2', 'backtest_overfit', {
    title: 'The lucky rule trap',
    given: { rules: 20, luck: 0.05 },
    calc: {
      expectedLucky: 'rules * luck',
      noLucky: '(1 - luck)^rules',
      atLeastOne: '1 - noLucky',
      atLeastOneRound: 'round(atLeastOne, 2)'
    },
    say: [
      'Iris tests {rules|num} trading rules that are really coin flips on old prices, and each has a {luck|pct} chance of looking great by luck.',
      'So she should expect about {expectedLucky|num} fake winner, and the chance that at least one looks great is about {atLeastOneRound|pct}.',
      'To stay honest, she picks a rule using years one to three, then tests it on unseen year four.',
      'Then she walks forward: pick again on years two to four, test on year five, and repeat.',
      'A fair test uses only what was known at the time, and it counts the companies that failed, too.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: '{rules|num} coin-flip rules, {luck|pct} luck each', tone: 'note' },
        /* An expected count, not a sure one: no lucky winner at all is still
         * possible (1 minus the at-least-one chance). */
        { k: 'line', text: '{rules|num} × {luck|pct} = {expectedLucky|num} expected, on average', tone: 'bad', cue: 1 },
        { k: 'line', text: 'Chance of at least one: {atLeastOneRound|pct}', tone: 'bad', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'steps', items: ['Fit years 1–3', 'Test on year 4'] },
        { k: 'line', text: 'Roll on: fit years 2–4, test 5', tone: 'note', cue: 3 },
        { k: 'line', text: 'Walk forward, never peek', tone: 'key', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'compare',
          left: { title: 'Unfair test', lines: ['Peeks ahead', 'Only survivors', 'Best of many tries'], mark: 'cross' },
          right: { title: 'Fair test', lines: ['Data known then', 'Failures included', 'Tests unseen years'], mark: 'check' } }
      ] }
    ]
  }),

  /* 9.2 Greeks as speedometers; gamma is large near the strike close to expiry. */
  E('9.2', 'greeks_delta', {
    title: 'Speedometers for an option',
    given: { price: 3, delta: 0.5, gamma: 0.05, theta: 0.05, vega: 0.1, move: 1, shares: 100, gammaNear: 0.3 },
    calc: {
      deltaGain: 'delta * move',
      deltaTotal: 'deltaGain * shares',
      thetaSigned: '-theta',
      newDelta: 'delta + gamma * move',
      nearDelta: 'delta + gammaNear * move',
      avgDelta: '(delta + nearDelta) / 2',
      nearGain: 'avgDelta * move'
    },
    /* Vega is spoken with its direction (a rise adds, a drop removes), and
     * the high-gamma averaging step is spoken, not only drawn. */
    say: [
      'Leo\'s call on Moonbeam Motors costs {price|usd} a share; its Greeks act like speedometers.',
      /* "stock rise": the $1 move is in the stock, not in the $3 option. */
      'Delta is {delta|num}, so a {move|usd} stock rise adds about {deltaGain|usd} a share, or {deltaTotal|usd} a contract.',
      'Theta takes {theta|usd} a day; vega adds {vega|usd} per one-point rise in implied volatility, the market\'s guess of future swings, and a drop removes it.',
      'Gamma is how fast delta changes: at {gamma|num}, the rise lifts delta to {newDelta|num}.',
      'Near expiry, a call at the strike can have gamma {gammaNear|num}.',
      'Its delta climbs from {delta|num} to {nearDelta|num} during the rise, averaging about {avgDelta|num}, a gain near {nearGain|usd}.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{price|usd}', label: 'Call option, per share', tone: 'note' },
        { k: 'line', text: 'Delta {delta|num}: stock {move|usd} up ≈ {deltaGain|susd}', tone: 'good', cue: 1 },
        { k: 'line', text: '{deltaGain|usd} × {shares|num} = {deltaTotal|usd} a contract', tone: 'good', cue: 1 },
        { k: 'line', text: 'Theta: {thetaSigned|susd} a day', tone: 'key', cue: 2 },
        { k: 'line', text: 'Vega: +{vega|usd} per 1-pt IV rise', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Gamma = how fast delta changes', tone: 'key' },
        { k: 'line', text: 'Leo: {delta|num} + {gamma|num} × {move|num} = {newDelta|num}', tone: 'good' },
        { k: 'line', text: 'Near expiry, at strike: gamma {gammaNear|num}', tone: 'key', cue: 4 }
      ] },
      { cue: 5, items: [
        { k: 'line', text: 'Delta: {delta|num} + {gammaNear|num} × {move|num} = {nearDelta|num}', tone: 'key' },
        { k: 'line', text: 'Average: ({delta|num} + {nearDelta|num}) ÷ 2 = {avgDelta|num}', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Delta only', value: 'deltaGain', text: '{deltaGain|usd}', tone: 'note' },
          { label: 'With gamma', value: 'nearGain', text: '{nearGain|usd}', tone: 'key' }
        ] },
        { k: 'stamp', text: 'Estimates for small moves', tone: 'note' }
      ] }
    ]
  }),

  /* 10.1 Buying without price progress can mean absorption: a clue, not proof.
   * The knowledge check's own label ("possible absorption") is not used; the
   * example describes the mechanism in plain words (a big seller soaking up
   * the buying), so the learner still maps it to the answer. */
  E('10.1', 'tape_reading', {
    title: 'Lots of buying, no progress',
    given: { shown: 1000, price: 10, trades: 12, size: 500, trigger: 10.05, wrong: 9.9 },
    calc: {
      bought: 'trades * size',
      refill: 'bought / shown',
      progress: 'price - price'
    },
    say: [
      'On Glowbug Gadgets, the screen shows only {shown|num} shares for sale at {price|usd}.',
      'Buyers lift that offer, paying {price|usd} in {trades|num} trades of {size|num} shares, {bought|num} shares in one minute, yet the price does not move.',
      'The offer keeps refilling, {refill|num} times what was showing, so a big seller may be soaking up the buying.',
      /* The thesis is named: below the floor it is the buy idea that is dropped
       * (a drop there would fit absorption, not disprove it). */
      'Leo waits instead of chasing: he trusts the buyers only if trades print above {trigger|usd}, and he drops the buy idea below {wrong|usd}.',
      'The tape shows what traded, which is a clue to confirm, not a prediction.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Buyers', icon: 'crowd', tone: 'good' }, right: { name: 'Seller at {price|usd}', icon: 'person2' }, flows: [
          { dir: 'right', text: 'Buy orders at {price|usd}' },
          { dir: 'left', text: 'Shares sold at {price|usd}' }
        ] },
        { k: 'line', text: 'Showing: {shown|num} shares at {price|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{trades|num} × {size|num} = {bought|num} shares', tone: 'key' },
        { k: 'line', text: 'Price moved: {progress|usd}', tone: 'bad' },
        { k: 'line', text: '{bought|num} ÷ {shown|num} = {refill|x} what showed', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'numberLine', marks: [
          { at: 'wrong', label: 'Drop buy {wrong|usd}', tone: 'bad' },
          { at: 'price', label: 'Wall {price|usd}', tone: 'note' },
          { at: 'trigger', label: 'Trust {trigger|usd}', tone: 'good' }
        ] },
        { k: 'stamp', text: 'Big buying, no progress: wait', tone: 'key' },
        { k: 'line', text: 'A clue to confirm, not a forecast', tone: 'note', cue: 4 }
      ] }
    ]
  }),

  /* 10.2 A checklist counts clues; acceptance matters; clues are not odds. */
  E('10.2', 'rally_checklist', {
    title: 'Five boxes are not a promise',
    given: { level: 15, vol: 3000, normal: 1000, ticked: 5, boxes: 6, slipped: 14.8, trigger: 15.1, exit: 14.7, shares: 100 },
    calc: {
      rel: 'vol / normal',
      share: 'ticked / boxes',
      shareRound: 'round(share, 2)',
      risk: 'trigger - exit',
      riskTotal: 'risk * shares'
    },
    say: [
      'Leo\'s rally checklist for Comet Fizz has six boxes, and the key level is {level|usd}.',
      'The level, fresh news, volume at {rel|num} times normal, eager buyers, and steady buy orders tick five of six boxes.',
      'But the most important box, holding above {level|usd}, failed: price slipped back to {slipped|usd}, so he waits.',
      'Five of six is {shareRound|pct} of the clues, not an {shareRound|pct} chance of a rally.',
      'If price later holds above {trigger|usd}, he could buy there with a {exit|usd} exit, risking {risk|usd} a share, or {riskTotal|usd} on {shares|num} shares.',
      'A checklist counts clues; it never promises a rally.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Key level: {level|usd}', tone: 'key' },
        { k: 'line', text: 'Volume: {vol|num} ÷ {normal|num} = {rel|x}', tone: 'good', cue: 1 },
        { k: 'line', text: 'Ticked: {ticked|num} of {boxes|num} boxes', tone: 'good', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'numberLine', marks: [
          { at: 'slipped', label: 'Slipped {slipped|usd}', tone: 'bad' },
          { at: 'level', label: 'Level {level|usd}', tone: 'key' }
        ], dot: { from: 'level', to: 'slipped' } },
        { k: 'stamp', text: 'Acceptance failed: wait', tone: 'bad' },
        { k: 'line', text: '{ticked|num} ÷ {boxes|num} ≈ {shareRound|pct} of clues', tone: 'key', cue: 3 },
        { k: 'line', text: 'Not an {shareRound|pct} chance', tone: 'bad', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'line', text: 'Buy above {trigger|usd}, exit {exit|usd}', tone: 'note' },
        { k: 'line', text: 'Risk: {risk|usd} × {shares|num} = {riskTotal|usd}', tone: 'bad' },
        { k: 'line', text: 'Clues, not a promise', tone: 'key', cue: 5 }
      ] }
    ]
  }),

  /* 11.1 The company's own filing beats a post; check what the news changes.
   * The knowledge check's words (filed prospectus, repost) are not used, so
   * the learner has to map "official filing for the sale" to the answer. */
  E('11.1', 'catalyst_evidence', {
    title: 'Rumor versus the filing',
    given: { rumorShares: 5, rumorPrice: 4, fileShares: 2, filePrice: 5, outstanding: 20 },
    calc: {
      raise: 'fileShares * filePrice',
      after: 'outstanding + fileShares',
      newPart: 'fileShares / after',
      newPartRound: 'round(newPart, 2)',
      rumorAfter: 'outstanding + rumorShares',
      rumorPart: 'rumorShares / rumorAfter'
    },
    say: [
      'A post shouts that Starfish Snacks is selling {rumorShares|num} million new shares at {rumorPrice|usd}.',
      'Maya ignores the post and opens the company\'s official filing, the legal document for the sale.',
      'It says {fileShares|num} million shares at {filePrice|usd}, raising {raise|usd} million before fees.',
      /* "million" is said with each share count, so the voice never reads
       * "2 of 22 million" as two shares. */
      'With {outstanding|num} million shares already out, the {fileShares|num} million new ones are about {newPartRound|pct} of the {after|num} million total, not the {rumorPart|pct} the rumor implied.',
      'Go to the primary source first, and check what the news really changes.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Rumor: {rumorShares|num}M shares at {rumorPrice|usd}', tone: 'bad' },
        { k: 'line', text: 'Source check: official filing', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Filing: {fileShares|num}M shares at {filePrice|usd}', tone: 'good' },
        { k: 'line', text: '{fileShares|num}M × {filePrice|usd} = {raise|usd}M raised', tone: 'key' }
      ] },
      /* Both shares of the company are worked out (the rumor's 5 of 25, not
       * 5 of 20), and the takeaway appears with sentence 4, which says it. */
      { cue: 3, items: [
        { k: 'line', text: 'Filing: {fileShares|num} ÷ ({outstanding|num} + {fileShares|num}) ≈ {newPartRound|pct}', tone: 'key' },
        { k: 'line', text: 'Rumor: {rumorShares|num} ÷ ({outstanding|num} + {rumorShares|num}) = {rumorPart|pct}', tone: 'bad' },
        { k: 'bars', items: [
          { label: 'Rumor', value: 'rumorPart', text: '{rumorPart|pct}', tone: 'bad' },
          { label: 'Filing', value: 'newPart', text: 'About {newPartRound|pct}', tone: 'good' }
        ] },
        { k: 'line', text: 'Primary source wins', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* 11.2 Review an alert with the real fill, the worst dip and the losers,
   * and state in advance what would prove the idea wrong. */
  E('11.2', 'alert_review', {
    title: 'Grade the alert honestly',
    given: { entry: 2, target: 2.5, wrongAt: 1.8, fill: 2.05, dip: 1.7, peak: 2.6, shares: 100 },
    calc: {
      slip: 'fill - entry',
      exitLoss: 'fill - wrongAt',
      exitTotal: 'exitLoss * shares',
      exitSigned: '-exitTotal',
      worstDip: 'round(dip / fill - 1, 2)',
      worstDipAbs: 'abs(worstDip)',
      brag: 'peak / entry - 1'
    },
    say: [
      'A chat alert says Kite Kitchen: entry {entry|usd}, target {target|usd}, wrong below {wrongAt|usd}.',
      'Maya\'s real fill is {fill|usd}, so she gave up {slip|usd} a share to slippage.',
      'The stock first sinks to {dip|usd}, so her rule says exit near {wrongAt|usd}, a loss of {exitTotal|usd} on {shares|num} shares.',
      'Only later does it spike to {peak|usd}, and a screenshot brags about a {brag|pct} gain.',
      'An honest review uses only what was known then, notes the worst dip, about {worstDipAbs|pct} below her fill, and counts the losers too.',
      'A testable idea says in advance what would prove it wrong.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Alert: entry {entry|usd}, target {target|usd}', tone: 'note' },
        { k: 'line', text: 'Wrong below {wrongAt|usd}', tone: 'bad' },
        { k: 'line', text: 'Real fill {fill|usd}: slippage {slip|usd}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'numberLine', marks: [
          { at: 'dip', label: 'Dip {dip|usd}', tone: 'bad' },
          { at: 'wrongAt', label: 'Wrong {wrongAt|usd}', tone: 'bad' },
          { at: 'fill', label: 'Fill {fill|usd}', tone: 'note' }
        ], dot: { from: 'fill', to: 'dip' } },
        { k: 'line', text: 'Rule exit: {exitSigned|susd}', tone: 'bad' },
        { k: 'line', text: 'Later peak {peak|usd}: {brag|spct}?', tone: 'note', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'compare',
          left: { title: 'Brag', lines: ['Peak {brag|spct}', 'Hides the dip'], mark: 'cross' },
          right: { title: 'Honest review', lines: ['Fill {fill|usd}', 'Worst dip {worstDip|spct}', 'Rule result {exitSigned|susd}'], mark: 'check' } },
        { k: 'line', text: 'Say first what proves it wrong', tone: 'key', cue: 5 }
      ] }
    ]
  }),

  /* 12.1 Outcome bias: a rule-breaking win is luck, not good process. */
  E('12.1', 'outcome_bias', {
    title: 'Grade the decision, not the dice',
    given: { limit: 50, leoShares: 500, price: 10, pop: 10.4, drop: 0.2, mayaShares: 100, stop: 9.5 },
    calc: {
      leoPos: 'leoShares * price',
      popGain: 'pop - price',
      leoGain: 'popGain * leoShares',
      dip: 'price - stop',
      paper: 'dip * leoShares',
      paperSigned: '-paper',
      whatIf: 'leoPos * drop',
      multiple: 'whatIf / limit',
      mayaRisk: 'dip * mayaShares',
      mayaSigned: '-mayaRisk'
    },
    say: [
      'Leo\'s rule says risk at most {limit|usd} a trade, but he buys {leoShares|num} shares of Neon Noodle at {price|usd} with no exit plan.',
      'Maya buys {mayaShares|num} shares at {price|usd} with an exit at {stop|usd}, risking {mayaRisk|usd}.',
      'The stock first dips to {stop|usd}, stopping Maya out, then pops to {pop|usd}.',
      'Leo sat through a {paper|usd} paper loss and ends {leoGain|usd} ahead.',
      'But a {drop|pct} drop on his {leoPos|usd} of stock would have cost {whatIf|usd}, {multiple|num} times his limit.',
      'Leo got the better outcome and Maya made the better decision, so grade the process, not the result.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Rule: risk at most {limit|usd}', tone: 'key' },
        { k: 'line', text: 'Leo: {leoShares|num} shares, no exit plan', tone: 'bad' },
        { k: 'line', text: 'Maya: {mayaShares|num} shares, exit {stop|usd}', tone: 'good', cue: 1 },
        { k: 'line', text: 'Maya risk: {mayaShares|num} × {dip|usd} = {mayaRisk|usd}', tone: 'note', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'numberLine', marks: [
          { at: 'stop', label: 'Dip {stop|usd}', tone: 'bad' },
          { at: 'price', label: 'Buy {price|usd}', tone: 'note' },
          { at: 'pop', label: 'Pop {pop|usd}', tone: 'good' }
        ], dot: { from: 'price', to: 'stop' } },
        { k: 'line', text: 'Maya: stopped out, {mayaSigned|susd}', tone: 'bad' },
        { k: 'line', text: 'Leo: {paperSigned|susd} on paper, then {leoGain|susd}', tone: 'good', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'line', text: 'What if: {leoPos|usd} × {drop|pct} = {whatIf|usd}', tone: 'bad' },
        { k: 'big', text: '{multiple|x}', label: 'Leo\'s limit, blown', tone: 'bad' },
        { k: 'line', text: 'Leo: lucky outcome, poor decision', tone: 'note', cue: 5 },
        { k: 'line', text: 'Maya: bad outcome, good decision', tone: 'good', cue: 5 }
      ] }
    ]
  }),

  /* 12.2 A crowded story means few buyers left and a congested exit. */
  E('12.2', 'crowded_exit', {
    title: 'Crowded story, crowded exit',
    given: { club: 100, owners: 90, perOwner: 100, normalVol: 1000 },
    calc: {
      left: 'club - owners',
      crowd: 'owners / club',
      sellPressure: 'owners * perOwner',
      days: 'sellPressure / normalVol'
    },
    say: [
      'In a club of {club|num} traders, {owners|num} already own Dragon Drinks, so only {left|num} could still buy.',
      'On a normal day, {normalVol|num} shares trade.',
      'When bad news hits, the {owners|num} owners each try to sell {perOwner|num} shares, which is {sellPressure|num} shares all at once.',
      'That is {days|num} normal days of selling squeezed through one door, so the price has to drop until new buyers show up.',
      'A popular story can feel safe, but when almost everyone is already in, the exit gets crowded.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Own it', value: 'owners', text: '{owners|num} of {club|num}', tone: 'bad' },
          { label: 'Could buy', value: 'left', text: '{left|num} left', tone: 'note' }
        ] },
        { k: 'big', text: '{crowd|pct}', label: 'Already in', tone: 'bad' },
        { k: 'line', text: 'Normal day: {normalVol|num} shares', tone: 'note', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'actors', left: { name: '{owners|num} sellers', icon: 'crowd', tone: 'bad' }, right: { name: 'Few buyers', icon: 'person2' }, flows: [
          { dir: 'right', text: 'Sell {sellPressure|num} shares' }
        ] },
        { k: 'line', text: '{owners|num} × {perOwner|num} = {sellPressure|num} shares', tone: 'key' },
        { k: 'line', text: '{sellPressure|num} ÷ {normalVol|num} = {days|num} days of volume', tone: 'bad', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'stamp', text: 'Crowded story, crowded exit', tone: 'bad' }
      ] }
    ]
  }),

  /* 13.1 Paper edge minus real costs, plus a written kill switch. */
  E('13.1', 'strategy_costs', {
    title: 'Paper edge, real costs',
    given: { edge: 0.05, size: 1000, trades: 100, cost: 0.03, fee: 1, killLoss: 200 },
    calc: {
      paperPer: 'edge * size',
      paperTotal: 'paperPer * trades',
      spreadPer: 'cost * size',
      costPer: 'spreadPer + fee',
      netPer: 'paperPer - costPer',
      netTotal: 'netPer * trades',
      eaten: 'costPer / paperPer'
    },
    say: [
      'Maya\'s strategy earns {edge|usd} a share on paper, on {trades|num} trades of {size|num} shares each, which is {paperTotal|usd}.',
      'In real trading, spread and slippage cost {cost|usd} a share, or {spreadPer|usd} a trade, plus a {fee|usd} fee.',
      'So each trade nets {paperPer|usd} minus {costPer|usd}, which is {netPer|usd}, or {netTotal|usd} in total: costs ate {eaten|pct} of the paper edge.',
      'Her written rules also include a kill switch that stops trading for the day if losses pass {killLoss|usd} or the price feed freezes.',
      'A strategy is only real after costs, with rules that say when to stop.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Paper: {edge|usd} × {size|num} = {paperPer|usd} a trade', tone: 'note' },
        { k: 'line', text: '{paperPer|usd} × {trades|num} trades = {paperTotal|usd}', tone: 'good' },
        { k: 'line', text: 'Costs: {spreadPer|usd} + {fee|usd} fee = {costPer|usd}', tone: 'bad', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: '{paperPer|usd} − {costPer|usd} = {netPer|usd} a trade', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Paper', value: 'paperTotal', text: '{paperTotal|usd}', tone: 'note' },
          { label: 'Real', value: 'netTotal', text: '{netTotal|usd}', tone: 'good' }
        ] },
        { k: 'line', text: 'Costs ate {eaten|pct}', tone: 'bad' }
      ] },
      { cue: 3, items: [
        { k: 'stamp', text: 'Kill switch', tone: 'bad' },
        { k: 'line', text: 'Loss over {killLoss|usd} today: stop', tone: 'bad' },
        { k: 'line', text: 'Price feed frozen: stop', tone: 'bad' },
        { k: 'line', text: 'Count costs, write the stop rules', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* 13.2 A defended thesis: sourced scenarios, weighted value, falsification. */
  E('13.2', 'scenario_tree', {
    title: 'Defend it like a committee',
    given: { price: 10, pBear: 0.25, bear: 6, pBase: 0.5, base: 10, pBull: 0.25, bull: 16 },
    calc: {
      cBear: 'pBear * bear',
      cBase: 'pBase * base',
      cBull: 'pBull * bull',
      weighted: 'cBear + cBase + cBull',
      change: 'weighted / price - 1',
      pTotal: 'pBear + pBase + pBull'
    },
    say: [
      'Leo defends Harbor Bikes, at {price|usd} a share, to a pretend committee where Maya plays the tough reviewer.',
      'He shows three sourced scenarios: worst case {bear|usd} with a {pBear|pct} chance, middle case {base|usd} with {pBase|pct}, and best case {bull|usd} with {pBull|pct}.',
      'Weighted by chance, that is {cBear|usd} plus {cBase|usd} plus {cBull|usd}, or {weighted|usd}, only {change|pct} above today and not a promise.',
      'When Maya asks what would prove him wrong, he says he drops the idea if bike orders fall six months in a row.',
      'A strong defense shows sources, chances, risks, and a way to be wrong.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Leo', icon: 'person' }, right: { name: 'Maya', icon: 'judge' }, flows: [
          { dir: 'right', text: 'Thesis: Harbor Bikes' },
          { dir: 'left', text: 'Show me your sources' }
        ] }
      ] },
      { cue: 1, items: [
        { k: 'tree', root: 'Today {price|usd}', branches: [
          { label: 'Worst {pBear|pct}', text: '{bear|usd}', tone: 'bad' },
          { label: 'Middle {pBase|pct}', text: '{base|usd}', tone: 'note' },
          { label: 'Best {pBull|pct}', text: '{bull|usd}', tone: 'good' }
        ] },
        { k: 'line', text: '{cBear|usd} + {cBase|usd} + {cBull|usd} = {weighted|usd}', tone: 'key', cue: 2 },
        { k: 'line', text: '{change|spct} vs today, not a promise', tone: 'note', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'What would prove you wrong?', tone: 'note' },
        { k: 'line', text: 'Orders fall 6 months: drop it', tone: 'bad' },
        { k: 'line', text: 'Sources ✓ Chances ✓ Risks ✓', tone: 'good', cue: 4 }
      ] }
    ]
  })
];
