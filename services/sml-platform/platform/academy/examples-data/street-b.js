'use strict';

/* Whiteboard examples for module 29 "Street Smarts", lessons 7 to 12.
 *
 * Original Academy material: fictional people from the cast in ../examples and
 * fictional companies, and every number shown or spoken is a given or a calc
 * result. Educational only: no advice, no guarantees, no real tickers and no
 * real market events. */

const { E } = require('../examples');

module.exports = [
  /* 29.7 EPS: the same profit spread over different share counts. */
  E('29.7', 'eps_profit_per_slice', {
    title: 'Same profit, different slices',
    given: { profit: 1200000, sharesA: 400000, sharesB: 1200000 },
    calc: {
      epsA: 'profit / sharesA',
      epsB: 'profit / sharesB',
      ratio: 'epsA / epsB'
    },
    say: [
      'Rooftop Wings and Corner Crisp are two made-up companies, and each earned {profit|usd} last year.',
      'Rooftop has {sharesA|num} shares, so its earnings per share come to {epsA|usd}.',
      'Corner Crisp has {sharesB|num} shares, so each of its shares stands behind only {epsB|usd}.',
      'Same profit, but a Rooftop share carries {ratio|num} times as much of it.',
      'That is why a big profit alone tells you little until you divide it by the shares.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{profit|usd}', label: 'Profit at each company', tone: 'note' },
        { k: 'line', text: 'Rooftop Wings', tone: 'key' },
        { k: 'line', text: 'Corner Crisp', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Rooftop: {profit|usd} ÷ {sharesA|num}', tone: 'key' },
        { k: 'line', text: 'EPS = {epsA|usd}', tone: 'good' },
        { k: 'line', text: 'Crisp: {profit|usd} ÷ {sharesB|num}', tone: 'key', cue: 2 },
        { k: 'line', text: 'EPS = {epsB|usd}', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Rooftop', value: 'epsA', text: '{epsA|usd} a share', tone: 'good' },
          { label: 'Crisp', value: 'epsB', text: '{epsB|usd} a share', tone: 'bad' }
        ] },
        { k: 'stamp', text: 'Divide by the shares first', tone: 'key' }
      ] }
    ]
  }),

  /* 29.8 P/E: the price paid per dollar of profit, and why it is context. */
  E('29.8', 'pe_price_per_profit_dollar', {
    title: 'What you pay per profit dollar',
    given: { eps: 2, priceA: 30, priceB: 60 },
    calc: {
      peA: 'priceA / eps',
      peB: 'priceB / eps',
      gap: 'peB / peA'
    },
    say: [
      'Two made-up companies, Loop Laundry and Glow Nails, each earn {eps|usd} per share.',
      'Loop Laundry trades at {priceA|usd}, so its price to earnings ratio is {peA|num}, meaning {peA|usd} for each dollar of yearly profit.',
      'Glow Nails trades at {priceB|usd}, so its ratio is {peB|num}.',
      'Buyers pay {gap|num} times as much per profit dollar for Glow, and the number alone cannot say why.',
      'Maybe they expect faster growth, or maybe they are just excited, so you compare before judging.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors',
          left: { name: 'Loop Laundry', icon: 'shop' },
          right: { name: 'Glow Nails', icon: 'shop' },
          flows: [] },
        { k: 'line', text: 'Both earn {eps|usd} a share', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Loop: {priceA|usd} ÷ {eps|usd} = {peA|num}', tone: 'key' },
        { k: 'line', text: 'Glow: {priceB|usd} ÷ {eps|usd} = {peB|num}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Loop P/E', value: 'peA', text: '{peA|usd} per $1', tone: 'good' },
          { label: 'Glow P/E', value: 'peB', text: '{peB|usd} per $1', tone: 'note' }
        ] },
        { k: 'stamp', text: 'A question, not a verdict', tone: 'key' }
      ] }
    ]
  }),

  /* 29.9 Price-to-book: assets minus debts, per share, against the price. */
  E('29.9', 'price_to_book', {
    title: 'What is left on the books',
    given: { assets: 500000, debts: 200000, shares: 100000, price: 4.5 },
    calc: {
      book: 'assets - debts',
      bvps: 'book / shares',
      pb: 'price / bvps'
    },
    say: [
      'Bolt Vans is a made-up company that owns {assets|usd} of vans and gear but owes {debts|usd}, which leaves a book value of {book|usd}.',
      'Spread over {shares|num} shares, that is {bvps|usd} of book value per share.',
      'The shares trade at {price|usd}, so the price-to-book ratio is {pb|num}.',
      'The books count vans well, but they would barely count a famous brand.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Owns', value: 'assets', text: '{assets|usd}', tone: 'good' },
          { label: 'Owes', value: 'debts', text: '{debts|usd}', tone: 'bad' },
          { label: 'Left over', value: 'book', text: '{book|usd}', tone: 'key' }
        ] }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{book|usd} ÷ {shares|num} shares', tone: 'key' },
        { k: 'line', text: 'Book per share: {bvps|usd}', tone: 'good' }
      ] },
      { cue: 2, items: [
        { k: 'numberLine', marks: [
          { at: 'bvps', label: 'Book {bvps|usd}', tone: 'note' },
          { at: 'price', label: 'Price {price|usd}', tone: 'key' }
        ], dot: { from: 'bvps', to: 'price' } },
        { k: 'line', text: 'P/B = {price|usd} ÷ {bvps|usd} = {pb|num}', tone: 'key' },
        { k: 'stamp', text: 'Brands hide off the books', tone: 'note' }
      ] }
    ]
  }),

  /* 29.10 Market cap versus enterprise value. */
  E('29.10', 'market_cap_vs_ev', {
    title: 'Market cap versus the whole price',
    given: { price: 10, shares: 100000, debt: 300000, cash: 100000 },
    calc: {
      cap: 'price * shares',
      ev: 'cap + debt - cash',
      net: 'debt - cash'
    },
    say: [
      'Sunny Side Foods is a made-up snack company with {shares|num} shares at {price|usd} each.',
      'Price times shares gives a market cap of {cap|usd}.',
      'But a buyer of the whole company also takes on {debt|usd} of debt, and gets {cash|usd} of cash.',
      'Add the debt and take away the cash, and the enterprise value is {ev|usd}.',
      'That is {net|usd} above the market cap, like a mortgage a house buyer cannot ignore.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors',
          left: { name: 'Sunny Side', icon: 'company' },
          right: { name: 'Buyers', icon: 'crowd', tone: 'good' },
          flows: [{ dir: 'left', text: '{shares|num} shares at {price|usd}' }] }
      ] },
      { cue: 1, items: [
        { k: 'steps', items: ['Price × shares', 'Add debt', 'Minus cash', 'Total price'] },
        { k: 'line', text: 'Market cap: {cap|usd}', tone: 'key' },
        { k: 'line', text: 'Debt: {debt|usd}', tone: 'bad', cue: 2 },
        { k: 'line', text: 'Cash: {cash|usd}', tone: 'good', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Market cap', value: 'cap', text: '{cap|usd}', tone: 'note' },
          { label: 'EV', value: 'ev', text: '{ev|usd}', tone: 'key' }
        ] },
        { k: 'line', text: '{net|usd} above market cap', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* 29.11 Intrinsic value: discounted future cash, and a margin of safety. */
  E('29.11', 'intrinsic_margin_of_safety', {
    title: 'What it is worth vs what it costs',
    given: { cash1: 11, cash2: 12.1, rate: 0.1, margin: 0.3, price: 19 },
    calc: {
      pv1: 'cash1 / (1 + rate)',
      pv2: 'cash2 / (1 + rate) / (1 + rate)',
      worth: 'pv1 + pv2',
      limit: 'worth * (1 - margin)'
    },
    say: [
      'Nia thinks a made-up car wash company will pay {cash1|usd} per share next year and {cash2|usd} the year after.',
      'Money later is worth less, so at {rate|pct} a year, the first payment is worth {pv1|usd} today.',
      'The second shrinks to {pv2|usd}, so her estimate of worth is {worth|usd}.',
      'She wants a margin of safety of {margin|pct}, so she pays at most {limit|usd}, and a share at {price|usd} is above that.',
      'It is only an estimate, so her guesses could be off in either direction.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Next year: {cash1|usd}', tone: 'note' },
        { k: 'line', text: 'Year after: {cash2|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{cash1|usd} now worth {pv1|usd}', tone: 'key' },
        { k: 'line', text: '{cash2|usd} now worth {pv2|usd}', tone: 'key', cue: 2 },
        { k: 'line', text: 'Worth today: {worth|usd}', tone: 'good', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'numberLine', marks: [
          { at: 'limit', label: 'Limit {limit|usd}', tone: 'good' },
          { at: 'price', label: 'Price {price|usd}', tone: 'note' },
          { at: 'worth', label: 'Worth {worth|usd}', tone: 'key' }
        ], dot: { from: 'limit', to: 'price' } },
        { k: 'stamp', text: 'An estimate, not a fact', tone: 'bad' }
      ] }
    ]
  }),

  /* 29.12 Beta: past swings relative to the market. */
  E('29.12', 'beta_swings_vs_market', {
    title: 'Beta: swings versus the market',
    given: { betaHigh: 1.5, betaLow: 0.5, up: 0.08, down: 0.06 },
    calc: {
      upHigh: 'betaHigh * up',
      upLow: 'betaLow * up',
      downHigh: 'betaHigh * down',
      downLow: 'betaLow * down'
    },
    say: [
      'Ravi tracks two made-up stocks, Ember Gym with a beta of {betaHigh|num} and Still Water Tea with a beta of {betaLow|num}.',
      'In a week the market rises {up|pct}, Ember has tended to rise about {upHigh|pct} and Still Water about {upLow|pct}.',
      'When the market falls {down|pct}, it works the same way, with Ember down {downHigh|pct} and Still Water down {downLow|pct}.',
      'Beta only shows how they moved in the past, so it is a look back and never a forecast.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors',
          left: { name: 'Ember Gym', icon: 'chart', tone: 'bad' },
          right: { name: 'Still Water Tea', icon: 'chart', tone: 'good' },
          flows: [{ dir: 'right', text: 'Beta {betaHigh|num}' }, { dir: 'left', text: 'Beta {betaLow|num}' }] }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Market', value: 'up', text: 'Up {up|pct}', tone: 'note' },
          { label: 'Ember', value: 'upHigh', text: 'Up {upHigh|pct}', tone: 'good' },
          { label: 'Still Water', value: 'upLow', text: 'Up {upLow|pct}', tone: 'good' }
        ] }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'Market', value: 'down', text: 'Down {down|pct}', tone: 'note' },
          { label: 'Ember', value: 'downHigh', text: 'Down {downHigh|pct}', tone: 'bad' },
          { label: 'Still Water', value: 'downLow', text: 'Down {downLow|pct}', tone: 'bad' }
        ] },
        { k: 'stamp', text: 'A look back, not a forecast', tone: 'key' }
      ] }
    ]
  })
];
