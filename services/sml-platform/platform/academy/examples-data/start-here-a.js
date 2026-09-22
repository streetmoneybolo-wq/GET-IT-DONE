'use strict';

/* Whiteboard examples for module 0 "Start Here", lessons 1 to 7.
 *
 * Original Academy material: fictional people from the cast in ../examples and
 * fictional companies, and every number shown or spoken is a given or a calc
 * result (the validator rejects any other number above 12). Educational only:
 * no advice, no guarantees, no real tickers and no real market events.
 *
 * The cast is the same in every Start Here lesson, so a beginner never meets a
 * new stranger: Ava is the complete beginner, Kofi is the patient one and Zoe
 * is the impatient one. */

const { E } = require('../examples');

module.exports = [
  /* 0.1 A share is a slice of a business: ownership, not a loan. */
  E('0.1', 'share_is_a_slice', {
    title: 'One bakery, a thousand slices',
    given: { shares: 1000, price: 20, bought: 10, profit: 2000 },
    calc: {
      cost: 'bought * price',
      others: 'shares - bought',
      ownership: 'bought / shares',
      perShare: 'profit / shares',
      avaProfit: 'perShare * bought'
    },
    say: [
      'Orbit Oats is a made-up bakery cut into {shares|num} equal slices called shares.',
      'Ava buys {bought|num} of them at {price|usd} each and pays {cost|usd}.',
      'Ten slices out of a thousand is {ownership|pct} of the bakery.',
      'Last year the bakery earned {profit|usd}, which is {perShare|usd} for every share.',
      'So Ava\'s slices stand behind {avaProfit|usd} of it, and nobody owes her the {cost|usd} back.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{shares|num}', label: 'Equal slices', tone: 'note' },
        { k: 'line', text: 'One bakery, cut up', tone: 'note' },
        { k: 'line', text: '{bought|num} slices cost {cost|usd}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'Ava', value: 'bought', text: '{bought|num} slices', tone: 'good' },
          { label: 'Others', value: 'others', text: 'The rest', tone: 'note' }
        ] },
        { k: 'line', text: 'Ava owns {ownership|pct}', tone: 'key' }
      ] },
      { cue: 3, items: [
        { k: 'line', text: '{profit|usd} ÷ {shares|num} = {perShare|usd}', tone: 'key' },
        { k: 'line', text: '{perShare|usd} × {bought|num} = {avaProfit|usd}', tone: 'good', cue: 4 },
        { k: 'stamp', text: 'No refund if it fails', tone: 'bad' }
      ] }
    ]
  }),

  /* 0.2 Price per share is not company size; the share count decides that. */
  E('0.2', 'price_is_not_size', {
    title: 'Which one is the bigger business?',
    given: { priceA: 5, sharesA: 200000, priceB: 200, sharesB: 4000 },
    calc: {
      valueA: 'priceA * sharesA',
      valueB: 'priceB * sharesB',
      gap: 'valueA - valueB'
    },
    say: [
      'Tidewater Toys trades at {priceA|usd} a share and has {sharesA|num} shares.',
      'Multiply them and the whole business is priced at {valueA|usd}.',
      'Maple Mill trades at {priceB|usd} a share but has only {sharesB|num} shares, which is {valueB|usd}.',
      'The cheaper share belongs to the bigger company, by {gap|usd}.',
      'A price tag on one slice only tells you how finely a company was cut.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Price of one slice', tone: 'note' },
        { k: 'line', text: '{priceA|usd} × {sharesA|num} shares', tone: 'key' },
        { k: 'line', text: 'Whole business: {valueA|usd}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'compare',
          left: { title: 'Tidewater Toys', lines: ['{priceA|usd} a share', '{sharesA|num} shares', '{valueA|usd}'], mark: 'check' },
          right: { title: 'Maple Mill', lines: ['{priceB|usd} a share', '{sharesB|num} shares', '{valueB|usd}'], mark: null } },
        { k: 'line', text: 'Bigger by {gap|usd}', tone: 'good', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'stamp', text: 'A high price is not size', tone: 'key' },
        { k: 'line', text: 'It only shows slice size', tone: 'note' }
      ] }
    ]
  }),

  /* 0.3 One order from money in to settled, and what protection does not cover. */
  E('0.3', 'first_order_settles', {
    title: 'From money in to settled',
    given: { deposit: 500, shares: 20, price: 20, fallen: 15 },
    calc: {
      cost: 'shares * price',
      cash: 'deposit - cost',
      fallenValue: 'shares * fallen',
      loss: 'cost - fallenValue'
    },
    say: [
      'Ava moves {deposit|usd} into a brand new brokerage account on Monday.',
      'On Tuesday she buys {shares|num} shares of Orbit Oats at {price|usd}, which costs {cost|usd}.',
      'That leaves {cash|usd} in cash, and one business day later the trade settles.',
      'If her broker collapsed, a protection scheme would look for those shares and her {cash|usd}.',
      'If Orbit Oats instead slid to {fallen|usd}, the shares are worth {fallenValue|usd} and nothing covers that {loss|usd}.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'steps', items: ['Money in', 'Order sent', 'Filled', 'Settled'] },
        { k: 'line', text: 'Monday: {deposit|usd} in', tone: 'note' },
        { k: 'line', text: 'Tuesday: {shares|num} at {price|usd}', tone: 'key', cue: 1 },
        { k: 'line', text: 'Costs {cost|usd}, leaves {cash|usd}', tone: 'note', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'If the broker collapses', tone: 'note' },
        { k: 'line', text: 'A scheme looks for the {cash|usd}', tone: 'good' }
      ] },
      { cue: 4, items: [
        { k: 'compare',
          left: { title: 'Broker collapses', lines: ['Shares back', '{cash|usd} cash back'], mark: 'check' },
          right: { title: 'Price slides to {fallen|usd}', lines: ['Worth {fallenValue|usd}', 'Down {loss|usd}'], mark: 'cross' } },
        { k: 'stamp', text: 'Not insurance on losses', tone: 'bad' }
      ] }
    ]
  }),

  /* 0.4 Market order buys certainty of shares; limit order buys price control. */
  E('0.4', 'market_or_limit', {
    title: 'Take the price, or name it?',
    given: { bid: 24, ask: 25, fastFill: 26, shares: 50 },
    calc: {
      zoeCost: 'fastFill * shares',
      avaCost: 'ask * shares',
      saved: 'zoeCost - avaCost'
    },
    say: [
      'Harbor Bikes shows a bid of {bid|usd} and an ask of {ask|usd}.',
      'Zoe sends a market order for {shares|num} shares as prices move, and it fills at {fastFill|usd}, costing {zoeCost|usd}.',
      'Ava sends a limit order at {ask|usd}, but the ask has moved to {fastFill|usd}, so her order waits all day.',
      'The next morning it fills, so she pays {avaCost|usd}, which is {saved|usd} less.',
      'Had the stock kept climbing, Ava would own nothing at all.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'numberLine', marks: [
          { at: 'bid', label: 'Bid {bid|usd}', tone: 'good' },
          { at: 'ask', label: 'Ask {ask|usd}', tone: 'key' }
        ] },
        { k: 'line', text: 'Two prices, never one', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'numberLine', marks: [
          { at: 'bid', label: 'Bid {bid|usd}', tone: 'good' },
          { at: 'ask', label: 'Ask {ask|usd}', tone: 'key' },
          { at: 'fastFill', label: 'Zoe paid {fastFill|usd}', tone: 'bad' }
        ], dot: { from: 'ask', to: 'fastFill' } },
        { k: 'line', text: 'Market order: fills now', tone: 'note' },
        { k: 'line', text: '{shares|num} × {fastFill|usd} = {zoeCost|usd}', tone: 'bad' }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Zoe, market', value: 'zoeCost', text: 'Paid {zoeCost|usd}', tone: 'bad' },
          { label: 'Ava, limit', value: 'avaCost', text: 'Paid {avaCost|usd}', tone: 'good' }
        ] },
        { k: 'line', text: 'Ava paid {saved|usd} less', tone: 'good' },
        { k: 'line', text: 'But it might never fill', tone: 'bad', cue: 4 }
      ] }
    ]
  }),

  /* 0.5 The spread is charged on every round trip, commission or no commission. */
  E('0.5', 'spread_every_trip', {
    title: 'The cost with no line on the bill',
    given: { bid: 19.9, ask: 20.1, shares: 100, trips: 12, account: 2000 },
    calc: {
      gap: 'ask - bid',
      perTrip: 'gap * shares',
      total: 'perTrip * trips',
      share: 'total / account'
    },
    say: [
      'Pixel Pops has a bid of {bid|usd} and an ask of {ask|usd}, a gap of {gap|usd}.',
      'Zoe pays the ask to get in and takes the bid to get out, all in one week.',
      'On {shares|num} shares that is {perTrip|usd} gone before the price has done anything.',
      'She goes in and out {trips|num} times in a year, which adds up to {total|usd}.',
      'Her account holds {account|usd}, so the gap alone took {share|pct} of it.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{gap|usd}', label: 'The spread', tone: 'bad' },
        { k: 'line', text: 'Buy {ask|usd}, sell {bid|usd}', tone: 'note' }
      ] },
      { cue: 2, items: [
        { k: 'line', text: '{gap|usd} × {shares|num} shares = {perTrip|usd}', tone: 'bad' },
        { k: 'line', text: '{trips|num} round trips a year', tone: 'note', cue: 3 },
        { k: 'line', text: 'Total gone: {total|usd}', tone: 'bad', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'bars', items: [
          { label: 'Account', value: 'account', text: '{account|usd}', tone: 'note' },
          { label: 'Gap paid', value: 'total', text: '{total|usd} gone', tone: 'bad' }
        ] },
        { k: 'line', text: 'That is {share|pct} of it', tone: 'bad' },
        { k: 'stamp', text: 'No commission, still a cost', tone: 'key' }
      ] }
    ]
  }),

  /* 0.6 A percentage loss needs a bigger percentage gain to get back to even. */
  E('0.6', 'loss_then_climb', {
    title: 'The climb back is steeper',
    given: { start: 1000, bigDrop: 0.5, smallDrop: 0.2, wrongGain: 0.5 },
    calc: {
      afterBig: 'start * (1 - bigDrop)',
      wrongEnd: 'afterBig * (1 + wrongGain)',
      neededBig: '(start - afterBig) / afterBig',
      afterSmall: 'start * (1 - smallDrop)',
      neededSmall: '(start - afterSmall) / afterSmall'
    },
    say: [
      'Zoe\'s practice account of {start|usd} falls by half, which leaves {afterBig|usd}.',
      'She thinks a gain of {wrongGain|pct} puts her back, but that only reaches {wrongEnd|usd}.',
      'Getting from {afterBig|usd} to {start|usd} means doubling her money, a gain of {neededBig|pct}.',
      'A smaller fall is kinder: {smallDrop|pct} off {start|usd} leaves {afterSmall|usd} and needs only {neededSmall|pct}.',
      'The deeper the hole, the more the climb out costs.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Started', value: 'start', text: '{start|usd}', tone: 'note' },
          { label: 'After fall', value: 'afterBig', text: '{afterBig|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Half of it is gone', tone: 'bad' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'A gain of {wrongGain|pct}? {wrongEnd|usd}', tone: 'bad' },
        { k: 'line', text: 'Still short of {start|usd}', tone: 'note' },
        { k: 'line', text: 'Needs {neededBig|pct}, a double', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'compare',
          left: { title: 'Down {smallDrop|pct}', lines: ['Left with {afterSmall|usd}', 'Needs {neededSmall|pct}'], mark: 'check' },
          right: { title: 'Down {bigDrop|pct}', lines: ['Left with {afterBig|usd}', 'Needs {neededBig|pct}'], mark: 'cross' } },
        { k: 'stamp', text: 'Deep holes cost more', tone: 'key' }
      ] }
    ]
  }),

  /* 0.7 Each year's growth is taken on a base that last year's growth enlarged. */
  E('0.7', 'growth_on_growth', {
    title: 'Growth taken on a bigger pile',
    given: { start: 1000, rate: 0.1 },
    calc: {
      gain1: 'start * rate',
      y1: 'start + gain1',
      gain2: 'y1 * rate',
      y2: 'y1 + gain2',
      y3: 'y2 * (1 + rate)',
      flat: 'start + 3 * gain1',
      extra: 'y3 - flat'
    },
    say: [
      'Suppose Kofi\'s {start|usd} grows {rate|pct} a year for three years.',
      'The first year adds {gain1|usd}, so he holds {y1|usd}.',
      'The second year takes {rate|pct} of {y1|usd}, which adds {gain2|usd} and reaches {y2|usd}.',
      'The third year ends at {y3|usd}.',
      'Three flat gains of {gain1|usd} would end at {flat|usd}, so {extra|usd} came from growth that grew.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Start {start|usd}, {rate|pct} a year', tone: 'note' },
        { k: 'steps', items: ['Year one', 'Year two', 'Year three'] }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Year one: {gain1|usd} to {y1|usd}', tone: 'good' },
        { k: 'line', text: 'Year two: {gain2|usd} to {y2|usd}', tone: 'good', cue: 2 },
        { k: 'line', text: 'Year three: to {y3|usd}', tone: 'good', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'bars', items: [
          { label: 'Flat gains', value: 'flat', text: '{flat|usd}', tone: 'note' },
          { label: 'Stacked', value: 'y3', text: '{y3|usd}', tone: 'good' }
        ] },
        { k: 'big', text: '{extra|usd}', label: 'Growth on growth', tone: 'good' },
        { k: 'stamp', text: 'Suppose, not a promise', tone: 'note' }
      ] }
    ]
  })
];
