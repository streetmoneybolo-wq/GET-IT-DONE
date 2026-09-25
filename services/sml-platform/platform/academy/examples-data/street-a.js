'use strict';

/* Whiteboard examples for module 29 "Street Smarts", lessons 1 to 6.
 *
 * Original Academy material: fictional people from the usual cast and fictional companies. Every number shown or spoken is a
 * given or a calc result. Educational only: no advice, no guarantees, no real tickers and no real market events. */

const { E } = require('../examples');

module.exports = [
  /* 29.1 Nobody sets a price: a bid meets an ask, and the last trade is the latest handshake. */
  E('29.1', 'bid_meets_ask', {
    title: 'Where a bid meets an ask',
    given: { bid: 20, ask: 21, shares: 100, nextAsk: 22 },
    calc: {
      gap: 'ask - bid',
      cost: 'shares * ask',
      rise: 'nextAsk - ask'
    },
    say: [
      'Bright Kettle is a made-up coffee company, and Zoe bids {bid|usd} a share to buy.',
      'Ravi wants to sell at {ask|usd}, so nothing happens, because the two are {gap|usd} apart.',
      'Zoe gives in and raises her bid to {ask|usd}, and {shares|num} shares change hands for {cost|usd}.',
      'That trade becomes the last price, which is just a receipt for a handshake.',
      'Then Nia shows up, but the next seller wants {nextAsk|usd}, so she pays it and the last price ticks up by {rise|usd}.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Zoe, buyer', icon: 'person', tone: 'good' }, right: { name: 'Bright Kettle', icon: 'company', tone: 'note' },
          flows: [{ dir: 'right', text: 'Bids {bid|usd}' }] },
        { k: 'line', text: 'Buyers bid, sellers ask', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'numberLine', marks: [
          { at: 'bid', label: 'Bid {bid|usd}', tone: 'good' },
          { at: 'ask', label: 'Ask {ask|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'No match, no trade', tone: 'note' },
        { k: 'line', text: 'Zoe moves to {ask|usd}', tone: 'key', cue: 2 },
        { k: 'line', text: '{shares|num} × {ask|usd} = {cost|usd}', tone: 'good', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'steps', items: ['Bid meets ask', 'Trade happens', 'Last price set'] },
        { k: 'numberLine', marks: [
          { at: 'ask', label: 'Last {ask|usd}', tone: 'key' },
          { at: 'nextAsk', label: 'Next ask', tone: 'good' }
        ], dot: { from: 'ask', to: 'nextAsk' } },
        { k: 'stamp', text: 'Nobody sets it', tone: 'key' }
      ] }
    ]
  }),

  /* 29.2 The market looks ahead: bad news that is better than feared can lift prices. */
  E('29.2', 'better_than_feared', {
    title: 'Bad news, better than feared',
    given: { lastYear: 4, thisYear: 2, feared: 1, priceBefore: 30, priceAfter: 33 },
    calc: {
      beat: 'thisYear - feared',
      rise: 'priceAfter - priceBefore',
      risePct: 'rise / priceBefore'
    },
    say: [
      'Comet Cafe is a made-up chain, and its profit falls from {lastYear|usd} a share to {thisYear|usd} in a rough year.',
      'That sounds bad, and the headlines say so, but investors had feared just {feared|usd} a share.',
      'The result beats the fear by {beat|usd}, so buyers step in and the price moves from {priceBefore|usd} to {priceAfter|usd}.',
      'That is a rise of {risePct|pct}, on the same day the news called the year a disaster.',
      'The economy felt bad, yet the price rose, because prices chase what comes next.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Last year', value: 'lastYear', text: '{lastYear|usd} profit', tone: 'note' },
          { label: 'This year', value: 'thisYear', text: '{thisYear|usd} profit', tone: 'bad' }
        ] },
        { k: 'line', text: 'A rough year on paper', tone: 'bad' }
      ] },
      { cue: 1, items: [
        { k: 'compare',
          left: { title: 'What people feared', lines: ['{feared|usd} a share'], mark: 'cross' },
          right: { title: 'What arrived', lines: ['{thisYear|usd} a share'], mark: 'check' } },
        { k: 'line', text: 'Beat the fear by {beat|usd}', tone: 'good' }
      ] },
      { cue: 2, items: [
        { k: 'numberLine', marks: [
          { at: 'priceBefore', label: 'Before {priceBefore|usd}', tone: 'note' },
          { at: 'priceAfter', label: 'After {priceAfter|usd}', tone: 'good' }
        ], dot: { from: 'priceBefore', to: 'priceAfter' } },
        { k: 'line', text: 'Up {risePct|pct} that day', tone: 'good', cue: 3 },
        { k: 'stamp', text: 'Market is not the economy', tone: 'key' }
      ] }
    ]
  }),

  /* 29.3 A crash is mostly paper value; only a sale makes a loss real, and the cash just changes hands. */
  E('29.3', 'paper_vs_real_loss', {
    title: 'Paper loss or real loss?',
    given: { shares: 1000, before: 10, after: 6, sold: 100 },
    calc: {
      valueBefore: 'shares * before',
      valueAfter: 'shares * after',
      paper: 'valueBefore - valueAfter',
      cash: 'sold * after',
      realized: 'sold * (before - after)',
      stillPaper: 'paper - realized'
    },
    say: [
      'Harbor Bikes has {shares|num} shares, and at {before|usd} each the company is priced at {valueBefore|usd}.',
      'A bad week drags the last price down to {after|usd}, so the company is now priced at {valueAfter|usd}.',
      'On paper that is {paper|usd} gone, yet not one dollar left anyone\'s account when the price moved.',
      'Ravi needs cash for rent and sells {sold|num} shares at {after|usd} to Kofi, so {cash|usd} moves from Kofi to Ravi.',
      'Ravi now has a real loss of {realized|usd}, while everyone still holding has {stillPaper|usd} of loss on paper.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{valueBefore|usd}', label: 'Priced at', tone: 'good' },
        { k: 'line', text: '{shares|num} shares at {before|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Before', value: 'valueBefore', text: '{valueBefore|usd}', tone: 'note' },
          { label: 'After', value: 'valueAfter', text: '{valueAfter|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Paper gone: {paper|usd}', tone: 'bad', cue: 2 },
        { k: 'stamp', text: 'No cash left the room', tone: 'key' }
      ] },
      { cue: 3, items: [
        { k: 'actors', left: { name: 'Ravi, seller', icon: 'person', tone: 'bad' }, right: { name: 'Kofi, buyer', icon: 'person2', tone: 'good' },
          flows: [{ dir: 'left', text: '{cash|usd} cash' }, { dir: 'right', text: '{sold|num} shares' }] },
        { k: 'line', text: 'Ravi\'s real loss: {realized|usd}', tone: 'bad', cue: 4 },
        { k: 'line', text: 'Still on paper: {stillPaper|usd}', tone: 'note', cue: 4 }
      ] }
    ]
  }),

  /* 29.4 One story for the market words: bull, gap, correction, bear, volume, spread, liquidity. */
  E('29.4', 'market_words_story', {
    title: 'One story, seven market words',
    given: { high: 50, open: 46, corrLevel: 0.1, bearLevel: 0.2, calmSpread: 0.1, stormSpread: 0.5 },
    calc: {
      gap: 'high - open',
      corrPrice: 'high * (1 - corrLevel)',
      bearPrice: 'high * (1 - bearLevel)'
    },
    say: [
      'Taco Tide is a made-up food truck company, and after a long bull run it closes at {high|usd}.',
      'Overnight bad news hits, and it opens at {open|usd}, so it gapped down {gap|usd} with no trades in between.',
      'At {corrPrice|usd} it sits {corrLevel|pct} under its high, and that is called a correction.',
      'If it slides to {bearPrice|usd}, it is {bearLevel|pct} under the high, and the gloomy mood is called a bear market.',
      'Volume jumps on the way down, and the spread between bid and ask grows from {calmSpread|usd} to {stormSpread|usd}.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{high|usd}', label: 'Bull run high', tone: 'good' },
        { k: 'line', text: 'Prices up, everyone brave', tone: 'good' }
      ] },
      { cue: 1, items: [
        { k: 'compare',
          left: { title: 'Yesterday close', lines: ['{high|usd}'], mark: 'check' },
          right: { title: 'Today open', lines: ['{open|usd}'], mark: 'cross' } },
        { k: 'line', text: 'A gap of {gap|usd}', tone: 'bad' },
        { k: 'line', text: 'Correction: {corrLevel|pct} off', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'numberLine', marks: [
          { at: 'bearPrice', label: 'Bear {bearPrice|usd}', tone: 'bad' },
          { at: 'corrPrice', label: 'Dip {corrPrice|usd}', tone: 'key' },
          { at: 'high', label: 'High {high|usd}', tone: 'good' }
        ], dot: { from: 'high', to: 'bearPrice' } },
        { k: 'line', text: 'Spread {calmSpread|usd} to {stormSpread|usd}', tone: 'bad', cue: 4 }
      ] }
    ]
  }),

  /* 29.5 A short sale: capped gain, open-ended loss. */
  E('29.5', 'short_sale_shape', {
    title: 'Borrow, sell, buy back',
    given: { shares: 100, sellPrice: 20, low: 15, high: 30, fee: 50 },
    calc: {
      proceeds: 'shares * sellPrice',
      buyLow: 'shares * low',
      gainLow: 'proceeds - buyLow',
      buyHigh: 'shares * high',
      lossHigh: 'buyHigh - proceeds'
    },
    say: [
      'Nia borrows {shares|num} shares of Pixel Pops and sells them at {sellPrice|usd}, which brings in {proceeds|usd}.',
      'If the price falls to {low|usd}, she buys them back for {buyLow|usd} and keeps {gainLow|usd}.',
      'If it climbs to {high|usd} instead, buying back costs {buyHigh|usd}, a loss of {lossHigh|usd}.',
      'Her best case is a price of zero, which would leave her {proceeds|usd}, but a rising price has no top.',
      'The broker also charges a borrowing fee, say {fee|usd}, and that comes off whatever she makes.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'steps', items: ['Borrow', 'Sell', 'Buy back', 'Return'] },
        { k: 'line', text: '{shares|num} × {sellPrice|usd} = {proceeds|usd}', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'numberLine', marks: [
          { at: 'low', label: 'Falls {low|usd}', tone: 'good' },
          { at: 'sellPrice', label: 'Sold {sellPrice|usd}', tone: 'key' }
        ], dot: { from: 'sellPrice', to: 'low' } },
        { k: 'line', text: 'Buy back: {buyLow|usd}', tone: 'note' },
        { k: 'line', text: 'Gain: {gainLow|usd}', tone: 'good' }
      ] },
      { cue: 2, items: [
        { k: 'tree', root: 'Sold at {sellPrice|usd}', branches: [
          { label: 'Falls to {low|usd}', text: 'Gain {gainLow|usd}', tone: 'good' },
          { label: 'Rises to {high|usd}', text: 'Loss {lossHigh|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Best case: {proceeds|usd}', tone: 'good', cue: 3 },
        { k: 'stamp', text: 'Gain capped, loss open', tone: 'bad' }
      ] }
    ]
  }),

  /* 29.6 Arbitrage: a price gap, shrunk by crowds and eaten by costs. */
  E('29.6', 'gap_shrinks_costs_bite', {
    title: 'One share, two prices',
    given: { cheap: 20, pricey: 21, shares: 100, feeEach: 30, cheapNow: 20.25, priceyNow: 20.75 },
    calc: {
      gross: 'shares * (pricey - cheap)',
      fees: 'feeEach * 2',
      net: 'gross - fees',
      grossLater: 'shares * (priceyNow - cheapNow)',
      lossLater: 'fees - grossLater'
    },
    say: [
      'Bright Kettle shares cost {cheap|usd} on one trading board and {pricey|usd} on another, at the same moment.',
      'Ravi buys {shares|num} on the cheap board and sells {shares|num} on the pricey one, a gross gap of {gross|usd}.',
      'Each trade costs {feeEach|usd} in fees, so two trades cost {fees|usd} and he keeps {net|usd}.',
      'Word spreads and others pile in, so the two prices drift together to {cheapNow|usd} and {priceyNow|usd}.',
      'Now the same trade earns {grossLater|usd} against {fees|usd} of fees, which is a loss of {lossLater|usd}.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'compare',
          left: { title: 'Board One', lines: ['{cheap|usd} a share'], mark: null },
          right: { title: 'Board Two', lines: ['{pricey|usd} a share'], mark: null } },
        { k: 'line', text: 'Same share, two prices', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'steps', items: ['Buy cheap', 'Sell higher'] },
        { k: 'line', text: 'Gross gap: {gross|usd}', tone: 'good' },
        { k: 'line', text: 'Fees {fees|usd}, kept {net|usd}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'numberLine', marks: [
          { at: 'cheapNow', label: 'Now {cheapNow|usd}', tone: 'note' },
          { at: 'priceyNow', label: 'Now {priceyNow|usd}', tone: 'note' }
        ] },
        { k: 'line', text: 'Earns {grossLater|usd}, fees {fees|usd}', tone: 'bad', cue: 4 },
        { k: 'stamp', text: 'Crowds and fees eat the gap', tone: 'bad' }
      ] }
    ]
  })
];
