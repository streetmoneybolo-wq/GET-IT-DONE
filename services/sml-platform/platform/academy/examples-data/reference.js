'use strict';

/* Canonical authored examples for 1.1, 7.1 and 9.1: the pattern to copy.
 * Original Academy material with fictional people (Maya, Leo) and fictional
 * companies. Every number shown or spoken is a given or a calc result; the
 * validator rejects any other number above 12. Educational only. */

const { E } = require('../examples');

module.exports = [
  E('1.1', 'bid_ask_spread', {
    title: 'Bid, ask, and the last price',
    given: { bid: 9, ask: 10, shares: 100 },
    calc: {
      spread: 'ask - bid',
      mid: '(bid + ask) / 2',
      hurry: 'ask - mid',
      hurryTotal: 'hurry * shares'
    },
    say: [
      'Maya offers to buy Pixel Pops shares at {bid|usd}, her bid, and Leo offers to sell at {ask|usd}, his ask.',
      'The gap between them, {spread|usd}, is the spread.',
      'Maya is in a hurry, so she pays Leo\'s {ask|usd} ask instead of waiting, and the screen\'s last price becomes {ask|usd}.',
      'That {ask|usd} is only a receipt for their deal, not a promise about the next trade.',
      'The middle was {mid|usd}, so not waiting cost Maya {hurry|usd} a share, or {hurryTotal|usd} on {shares|num} shares.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Maya', icon: 'person', tone: 'good' }, right: { name: 'Leo', icon: 'person2', tone: 'bad' }, flows: [
          { dir: 'right', text: 'Bid: I\'d buy at {bid|usd}' },
          { dir: 'left', text: 'Ask: I\'d sell at {ask|usd}' }
        ] },
        { k: 'line', text: 'Spread: {ask|usd} − {bid|usd} = {spread|usd}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'stamp', text: 'Last price: {ask|usd}', tone: 'key' },
        { k: 'line', text: 'A receipt, not a promise', tone: 'note', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'numberLine', marks: [
          { at: 'bid', label: 'Bid {bid|usd}', tone: 'good' },
          { at: 'mid', label: 'Middle {mid|usd}', tone: 'note' },
          { at: 'ask', label: 'Paid {ask|usd}', tone: 'bad' }
        ], dot: { from: 'mid', to: 'ask' } },
        { k: 'line', text: '{ask|usd} − {mid|usd} = {hurry|usd} a share' },
        { k: 'line', text: '× {shares|num} shares = {hurryTotal|usd}', tone: 'key' },
        { k: 'stamp', text: 'The price of being in a hurry', tone: 'bad' }
      ] }
    ]
  }),

  /* The expectancy half uses 50% at 1.5R against 50% at 1R, not the
   * knowledge check's 40% at 2R against 60% at 1R, so the learner still
   * works the check's numbers out. */
  E('7.1', 'position_sizing', {
    title: 'Box the trade before you buy',
    given: { account: 2000, riskPct: 0.01, entry: 10, stop: 9.5, winRate: 0.5, winR: 1.5 },
    calc: {
      budget: 'account * riskPct',
      perShare: 'entry - stop',
      shares: 'floor(budget / perShare)',
      position: 'shares * entry',
      lossRate: '1 - winRate',
      winAmount: 'budget * winR',
      winPart: 'winRate * winAmount',
      lossPart: 'lossRate * budget',
      budgetLoss: '-budget',
      lossSigned: '-lossPart',
      average: 'winPart - lossPart',
      averageR: 'average / budget'
    },
    say: [
      'Leo has a {account|usd} practice account and will risk at most {riskPct|pct} per trade, which is {budget|usd}.',
      'He plans to buy at {entry|usd} and admits he is wrong at {stop|usd}, so each share risks {perShare|usd}.',
      '{budget|usd} divided by {perShare|usd} is {shares|num} shares, or {position|usd} of stock.',
      'Suppose his setups win {winRate|pct} of the time for {winAmount|usd} and lose {lossRate|pct} of the time for {budget|usd}.',
      'The average trade is then {average|usd} before costs, or {averageR|pts} R, where one R is his planned {budget|usd} loss.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Account {account|usd} × {riskPct|pct}', tone: 'note' },
        { k: 'big', text: '{budget|usd}', label: 'Max loss per trade', tone: 'bad' }
      ] },
      { cue: 1, items: [
        { k: 'numberLine', marks: [
          { at: 'stop', label: 'Wrong at {stop|usd}', tone: 'bad' },
          { at: 'entry', label: 'Entry {entry|usd}', tone: 'key' }
        ], dot: { from: 'entry', to: 'stop' } },
        { k: 'line', text: 'Risk per share: {perShare|usd}' },
        { k: 'line', text: '{budget|usd} ÷ {perShare|usd} = {shares|num} shares', tone: 'key', cue: 2 },
        { k: 'line', text: '{shares|num} × {entry|usd} = {position|usd} of stock', tone: 'note', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'tree', root: 'Same trade, many times', branches: [
          { label: 'Win {winRate|pct}', text: '{winRate|pct} × {winAmount|usd} = {winPart|susd}', tone: 'good' },
          { label: 'Lose {lossRate|pct}', text: '{lossRate|pct} × {budgetLoss|susd} = {lossSigned|susd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Average: {average|susd} = {averageR|pts}R', tone: 'good', cue: 4 },
        { k: 'line', text: 'One R = planned loss = {budget|usd}', tone: 'note', cue: 4 }
      ] }
    ]
  }),

  E('9.1', 'option_put_payoff', {
    title: 'One put, two endings',
    given: { stock: 50, strike: 45, premium: 2, shares: 100, low: 40, high: 55 },
    calc: {
      cost: 'premium * shares',
      breakEven: 'strike - premium',
      intrinsicLow: 'max(strike - low, 0)',
      netLowShare: 'intrinsicLow - premium',
      netLow: 'netLowShare * shares',
      intrinsicHigh: 'max(strike - high, 0)',
      netHigh: '(intrinsicHigh - premium) * shares',
      lossHigh: 'abs(netHigh)',
      sellerLow: '-netLow',
      sellerHigh: '-netHigh'
    },
    say: [
      'Pebblestone Phones stock is at {stock|usd}, and Leo pays Maya {cost|usd} for one put: the right to sell {shares|num} shares at {strike|usd}.',
      'That premium is {premium|usd} a share, so Leo breaks even at {strike|usd} minus {premium|usd}, which is {breakEven|usd}.',
      'If the stock ends at {low|usd}, the put is worth {intrinsicLow|usd} a share, so Leo nets {netLowShare|usd} a share, or {netLow|usd}, and Maya loses {netLow|usd}.',
      'If it ends at {high|usd}, the put expires worthless: Leo loses his {lossHigh|usd} and Maya keeps it.',
      'The strike only acts like a price floor for someone who also owns the shares.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Leo', icon: 'person' }, right: { name: 'Maya', icon: 'person2' }, flows: [
          { dir: 'right', text: '{cost|usd} premium' },
          { dir: 'left', text: 'Right to sell at {strike|usd}' }
        ] },
        { k: 'line', text: 'Stock today: {stock|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{premium|usd} × {shares|num} shares = {cost|usd}', tone: 'key' },
        { k: 'numberLine', marks: [
          { at: 'breakEven', label: 'Break-even {breakEven|usd}', tone: 'key' },
          { at: 'strike', label: 'Strike {strike|usd}' },
          { at: 'stock', label: 'Today {stock|usd}', tone: 'note' }
        ], dot: { from: 'stock', to: 'breakEven' } },
        { k: 'line', text: '{strike|usd} − {premium|usd} = {breakEven|usd}', tone: 'key' }
      ] },
      /* Each ending appears with the sentence that says it: the $40 ending
       * (both sides of the bet) now, the $55 ending as its own cued line. */
      { cue: 2, items: [
        { k: 'line', text: '{strike|usd} − {low|usd} = {intrinsicLow|usd}, minus {premium|usd} = {netLowShare|usd}', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Put buyer', value: 'netLow', text: 'Leo {netLow|susd}', tone: 'good' },
          { label: 'Put seller', value: 'sellerLow', text: 'Maya {sellerLow|susd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Ends {high|usd}: Leo {netHigh|susd}, Maya {sellerHigh|susd}', tone: 'note', cue: 3 },
        { k: 'line', text: 'Floor only if you own shares', tone: 'key', cue: 4 }
      ] }
    ]
  })
];
