'use strict';

/* Whiteboard examples for Module 0 "Start Here", lessons 8-13 (builder b).
 *
 * Same contract as ./reference.js: every money or percent figure shown or
 * spoken comes from given/calc, so the arithmetic is computed here and checked
 * by validateExample(). Only whole numbers up to twelve may be typed into text.
 *
 * One fictional cast (Ava, Kofi, Zoe, Nia) and fictional companies only. The
 * "Town Ten" is an invented list of ten invented companies with two invented
 * wrappers. No real tickers, no real funds, no advice, no guarantees.
 *
 * Frame cues follow the voice: a non-line item may not show a number before the
 * sentence that says it, so each board number is cued to its sentence. */

const { E } = require('../examples');

module.exports = [
  /* 0.8 Dollar-cost averaging. A fixed sum buys more units cheap and fewer
   * dear, so the average COST lands under the average PRICE. The last sentence
   * refuses the "always wins" reading: a price that only climbed favours the
   * lump sum. */
  E('0.8', 'dollar_cost_averaging', {
    title: 'Same money, different prices',
    given: { amount: 600, priceOne: 10, priceTwo: 6, later: 8, lump: 1200 },
    calc: {
      unitsOne: 'amount / priceOne',
      unitsTwo: 'amount / priceTwo',
      units: 'unitsOne + unitsTwo',
      spent: 'amount * 2',
      avgCost: 'spent / units',
      avgPrice: '(priceOne + priceTwo) / 2',
      zoeUnits: 'lump / priceOne',
      kofiValue: 'units * later',
      zoeValue: 'zoeUnits * later'
    },
    say: [
      'Every month Kofi puts {amount|usd} into the Town Ten Fund, where one slice of the fund is called a unit.',
      'The first month a unit costs {priceOne|usd}, so his {amount|usd} buys {unitsOne|num} units.',
      'The next month a unit costs {priceTwo|usd}, so the same {amount|usd} buys {unitsTwo|num} units.',
      'He has paid {spent|usd} for {units|num} units, an average cost of {avgCost|usd}, below the {avgPrice|usd} average of the two prices.',
      'Zoe put her whole {lump|usd} in at {priceOne|usd} and holds {zoeUnits|num} units.',
      'At {later|usd} a unit Kofi holds {kofiValue|usd} and Zoe holds {zoeValue|usd}, though a price that only climbed would have suited Zoe.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{amount|usd}', label: 'The same amount each month', tone: 'key' },
        { k: 'line', text: 'You pick the date, not the price', tone: 'note' }
      ] },
      /* Both months are said by sentence 2, so the two columns appear there. */
      { cue: 2, items: [
        { k: 'compare',
          left: { title: 'Month one', lines: ['{priceOne|usd} a unit', '{unitsOne|num} units'], mark: null },
          right: { title: 'Month two', lines: ['{priceTwo|usd} a unit', '{unitsTwo|num} units'], mark: null } },
        { k: 'line', text: 'Paid {spent|usd} for {units|num} units', tone: 'note', cue: 3 },
        { k: 'line', text: 'Cost {avgCost|usd}, prices {avgPrice|usd}', tone: 'key', cue: 3 }
      ] },
      { cue: 5, items: [
        { k: 'bars', items: [
          { label: 'Kofi', value: 'kofiValue', text: '{kofiValue|usd} at {later|usd}', tone: 'good' },
          { label: 'Zoe', value: 'zoeValue', text: '{zoeValue|usd} at {later|usd}', tone: 'note' }
        ] },
        { k: 'stamp', text: 'No shield in a falling market', tone: 'bad' }
      ] }
    ]
  }),

  /* 0.9 One company or many. The same disaster and the same jackpot are run
   * through both shapes, so the cut to the downside and the cut to the upside
   * are visibly the same size. */
  E('0.9', 'spreading_money', {
    title: 'One company or four',
    given: { total: 1000, holdings: 4 },
    calc: {
      each: 'total / holdings',
      niaLeft: 'total - each',
      lossPct: 'each / total',
      avaGood: 'total * 2',
      niaGood: 'total + each'
    },
    say: [
      'Ava puts her whole {total|usd} into Harbor Bikes, while Nia splits the same {total|usd} across four companies, {each|usd} each.',
      'Harbor Bikes then goes to zero, so Ava has nothing left and Nia still has {niaLeft|usd}.',
      'That is a loss of {lossPct|pct} for Nia against a total loss for Ava.',
      'Run it the other way, with Harbor Bikes doubling, and Ava holds {avaGood|usd} while Nia holds {niaGood|usd}.',
      'Spreading left her a quarter of the disaster and a quarter of the jackpot, and it cannot stop every company falling together.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'compare',
          left: { title: 'Ava', lines: ['{total|usd} in one', 'Harbor Bikes'], mark: null },
          right: { title: 'Nia', lines: ['{each|usd} in each', 'Four companies'], mark: null } },
        { k: 'line', text: 'Same money, two shapes', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Harbor Bikes goes to zero', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Ava', value: 0, text: 'Nothing left', tone: 'bad' },
          { label: 'Nia', value: 'niaLeft', text: '{niaLeft|usd} left', tone: 'good' }
        ] },
        { k: 'line', text: 'Nia loses {lossPct|pct}, Ava loses all', tone: 'note', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Same company doubles instead', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Ava', value: 'avaGood', text: '{avaGood|usd}', tone: 'good' },
          { label: 'Nia', value: 'niaGood', text: '{niaGood|usd}', tone: 'note' }
        ] },
        { k: 'stamp', text: 'Smaller crash, smaller win', tone: 'key' }
      ] }
    ]
  }),

  /* 0.10 Index funds. One purchase, ten equal holdings: the big loser cannot
   * wipe the year out and the big winner cannot make it. */
  E('0.10', 'index_fund_basket', {
    title: 'Buying the whole list',
    given: { total: 1000, names: 10 },
    calc: {
      each: 'total / names',
      harborLoss: 'each / 2',
      kettleGain: 'each',
      end: 'total - harborLoss + kettleGain',
      pct: '(end - total) / total'
    },
    say: [
      'The Town Ten is a made-up list of ten companies, each one counted the same.',
      'Kofi puts {total|usd} into a fund that copies the list, so {each|usd} goes into each name.',
      'Harbor Bikes halves and costs him {harborLoss|usd}, while Bright Kettle doubles and gains him {kettleGain|usd}.',
      'The other eight names sit still, so he ends the year with {end|usd}, a gain of {pct|pct}.',
      'One name could not wipe him out, and one name could not make him rich either.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'stamp', text: 'One list, ten companies', tone: 'key' },
        { k: 'line', text: 'Each name counts the same', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'tree', root: '{total|usd} into the fund', branches: [
          { label: 'Ten names', text: '{each|usd} into each one', tone: 'note' },
          { label: 'Nobody picks', text: 'The fund just copies the list', tone: 'key' }
        ] }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'One halves', value: 'harborLoss', text: 'Costs {harborLoss|usd}', tone: 'bad' },
          { label: 'One doubles', value: 'kettleGain', text: 'Gains {kettleGain|usd}', tone: 'good' }
        ] },
        { k: 'line', text: 'Year end {end|usd}, a gain of {pct|pct}', tone: 'key', cue: 3 },
        { k: 'stamp', text: 'No wipe-out, no jackpot', tone: 'note' }
      ] }
    ]
  }),

  /* 0.11 Fund or ETF. Identical holdings, two ways to buy: one price struck
   * after the close, one price crossed mid-morning. */
  E('0.11', 'fund_versus_etf', {
    title: 'Same list, two wrappers',
    given: { units: 20, close: 50, ask: 50.2 },
    calc: {
      fundCost: 'units * close',
      etfCost: 'units * ask',
      gap: 'etfCost - fundCost',
      gapPct: 'gap / fundCost'
    },
    say: [
      'The Town Ten Fund and the Town Ten ETF hold exactly the same ten companies.',
      'At tonight\'s close the list is worth {close|usd} a unit, so Kofi\'s {units|num} units in the fund cost {fundCost|usd}.',
      'Zoe buys the ETF in the morning at an ask of {ask|usd}, so her {units|num} units cost {etfCost|usd}.',
      'The extra {gap|usd}, which is {gapPct|pct} of the purchase, came from the wrapper and the moment she chose.',
      'On a day the ETF trades a little below the list, her units would have cost less instead.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'compare',
          left: { title: 'Fund', lines: ['Priced once a day', 'Same close price'], mark: null },
          right: { title: 'ETF', lines: ['Trades all day', 'Has a bid and ask'], mark: null } },
        { k: 'line', text: 'Same ten companies inside', tone: 'key' }
      ] },
      { cue: 2, items: [
        { k: 'numberLine', marks: [
          { at: 'close', label: 'Close {close|usd}', tone: 'good' },
          { at: 'ask', label: 'Ask {ask|usd}', tone: 'bad' }
        ], dot: { from: 'close', to: 'ask' } },
        { k: 'line', text: 'Fund: {units|num} × {close|usd} = {fundCost|usd}', tone: 'note' },
        { k: 'line', text: 'ETF: {units|num} × {ask|usd} = {etfCost|usd}', tone: 'note' }
      ] },
      { cue: 3, items: [
        { k: 'compare',
          left: { title: 'Kofi, at the close', lines: ['{fundCost|usd} for {units|num}'], mark: null },
          right: { title: 'Zoe, mid-morning', lines: ['{etfCost|usd} for {units|num}'], mark: null } },
        { k: 'line', text: 'Difference {gap|usd}, or {gapPct|pct}', tone: 'key' },
        { k: 'stamp', text: 'The wrapper, not the list', tone: 'note' }
      ] }
    ]
  }),

  /* 0.12 Fees. The charge is a slice of the balance, so the gap grows with the
   * balance and is taken in falling years too. */
  E('0.12', 'fund_fee_drag', {
    title: 'The slice taken every year',
    given: { smallBalance: 1000, bigBalance: 10000, lowFee: 0.001, highFee: 0.01 },
    calc: {
      lowSmall: 'smallBalance * lowFee',
      highSmall: 'smallBalance * highFee',
      gapSmall: 'highSmall - lowSmall',
      lowBig: 'bigBalance * lowFee',
      highBig: 'bigBalance * highFee',
      gapBig: 'highBig - lowBig'
    },
    say: [
      'Two funds hold exactly the same ten companies, but one charges {lowFee|pct} a year and the other charges {highFee|pct}.',
      'On a balance of {smallBalance|usd} that is {lowSmall|usd} a year against {highSmall|usd}, a difference of {gapSmall|usd}.',
      'When Kofi\'s balance reaches {bigBalance|usd} the gap grows with it, {lowBig|usd} against {highBig|usd}.',
      'That is {gapBig|usd} every year, and he never sees a bill, because the fee comes out of the fund\'s own value.',
      'In a year the list falls, the cheap fund still takes its {lowBig|usd} and the dear one still takes its {highBig|usd}.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'compare',
          left: { title: 'Cheap fund', lines: ['{lowFee|pct} a year'], mark: null },
          right: { title: 'Dear fund', lines: ['{highFee|pct} a year'], mark: null } },
        { k: 'line', text: 'Same ten companies inside', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Balance {smallBalance|usd}', tone: 'note' },
        { k: 'bars', items: [
          { label: 'Cheap', value: 'lowSmall', text: '{lowSmall|usd} a year', tone: 'good' },
          { label: 'Dear', value: 'highSmall', text: '{highSmall|usd} a year', tone: 'bad' }
        ] },
        { k: 'line', text: 'Difference {gapSmall|usd} a year', tone: 'key' }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Balance {bigBalance|usd}', tone: 'note' },
        { k: 'bars', items: [
          { label: 'Cheap', value: 'lowBig', text: '{lowBig|usd} a year', tone: 'good' },
          { label: 'Dear', value: 'highBig', text: '{highBig|usd} a year', tone: 'bad' }
        ] },
        { k: 'line', text: 'Difference {gapBig|usd} a year', tone: 'key', cue: 3 },
        { k: 'stamp', text: 'Charged in falling years too', tone: 'bad' }
      ] }
    ]
  }),

  /* 0.13 Dividends. The payment is a transfer out of the company, so the price
   * opens lower by roughly the amount paid. */
  E('0.13', 'dividend_payout', {
    title: 'Getting paid to hold',
    given: { shares: 100, price: 40, perShare: 0.25 },
    calc: {
      stake: 'shares * price',
      perQuarter: 'shares * perShare',
      yearly: 'perQuarter * 4',
      yieldPct: 'yearly / stake',
      openLower: 'perShare',
      openPrice: 'price - perShare'
    },
    say: [
      'Nia owns {shares|num} Bright Kettle shares bought at {price|usd}, so her stake is {stake|usd}.',
      'Bright Kettle pays {perShare|usd} a share every quarter, which is {perQuarter|usd} to Nia four times a year.',
      'That is {yearly|usd} across the year, or {yieldPct|pct} of her stake.',
      'On the morning a payment goes out, the price typically opens about {openLower|usd} lower, near {openPrice|usd}.',
      'That cash has left the company, and nothing obliges Bright Kettle to keep paying it.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors',
          left: { name: 'Bright Kettle', icon: 'company' },
          right: { name: 'Nia', icon: 'person', tone: 'good' },
          flows: [{ dir: 'right', text: 'Cash every quarter' }] },
        { k: 'line', text: '{shares|num} shares at {price|usd} = {stake|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'steps', items: ['{perQuarter|usd}', '{perQuarter|usd}', '{perQuarter|usd}', '{perQuarter|usd}'] },
        { k: 'line', text: 'Four quarters at {perQuarter|usd}', tone: 'note' },
        { k: 'line', text: 'Year {yearly|usd} = {yieldPct|pct} of {stake|usd}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'numberLine', marks: [
          { at: 'openPrice', label: 'Opens {openPrice|usd}', tone: 'bad' },
          { at: 'price', label: 'Before {price|usd}', tone: 'note' }
        ], dot: { from: 'price', to: 'openPrice' } },
        { k: 'line', text: 'Cash moved out to the owners', tone: 'note' },
        { k: 'stamp', text: 'Not on top of the price', tone: 'key' }
      ] }
    ]
  })
];
