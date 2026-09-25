'use strict';

/* Whiteboard examples for Street Smarts (module 29), file c: lessons 13-18. Keys are '29.<lessonId>'.
 *
 * Original Academy material: fictional people from the shared cast and made-up
 * businesses, cities and funds. Every number shown or spoken is a given or a calc
 * result. Educational only: no advice, no guarantees, no real companies. */

const { E } = require('../examples');

module.exports = [
  /* 29.13 Stocks vs Bonds: ownership swings, a loan pays set money. */
  E('29.13', 'stock_versus_bond', {
    title: 'Own a slice or lend the cash',
    given: { money: 1000, price: 50, rate: 0.05, goodPrice: 65, badPrice: 40 },
    calc: {
      shares: 'money / price',
      interest: 'money * rate',
      goodValue: 'shares * goodPrice',
      goodGain: 'goodValue - money',
      badValue: 'shares * badPrice',
      badLoss: 'money - badValue'
    },
    say: [
      'Nia has {money|usd} to place.',
      'She can buy {shares|num} shares of Fresh Kicks, a made-up sneaker shop, at {price|usd} each, or lend it to the city as a bond.',
      'The bond pays {rate|pct} a year, so she collects {interest|usd}, and gets her {money|usd} back at the end if the city pays.',
      'If Fresh Kicks has a hot year and the share hits {goodPrice|usd}, she is up {goodGain|usd}, but at {badPrice|usd} she is down {badLoss|usd}.',
      'Through both years the bond keeps paying its {interest|usd}, which is why many people hold a bit of each.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{money|usd}', label: 'Nia has', tone: 'note' },
        { k: 'line', text: 'Stock: {shares|num} × {price|usd}', tone: 'key', cue: 1 },
        { k: 'line', text: 'Bond: lend it to the city', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: '{money|usd} × {rate|pct} = {interest|usd} a year', tone: 'good' },
        { k: 'stamp', text: 'Paid back if the city pays', tone: 'note' }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Hot year', value: 'goodGain', text: 'Up {goodGain|usd}', tone: 'good' },
          { label: 'Cold year', value: 'badLoss', text: 'Down {badLoss|usd}', tone: 'bad' },
          { label: 'Bond', value: 'interest', text: 'Pays {interest|usd}', tone: 'key' }
        ] },
        { k: 'line', text: 'Own the swings, lend the steady', tone: 'note', cue: 4 }
      ] }
    ]
  }),

  /* 29.14 Bond basics: coupon fixed, price moves opposite to new rates. */
  E('29.14', 'bond_price_see_saw', {
    title: 'When rates rise, bond prices fall',
    given: { face: 1000, couponRate: 0.04, newRate: 0.05 },
    calc: {
      coupon: 'face * couponRate',
      price2: 'coupon / (1 + newRate) + (face + coupon) / pow(1 + newRate, 2)',
      price10: 'coupon * (1 - 1 / pow(1 + newRate, 10)) / newRate + face / pow(1 + newRate, 10)',
      drop2: 'face - price2',
      drop10: 'face - price10'
    },
    say: [
      'Ava buys a made-up city bond with a {face|usd} face value and a {couponRate|pct} coupon, so it pays {coupon|usd} every year.',
      'Then rates rise, and brand new bonds pay {newRate|pct}, so nobody pays full price for her {couponRate|pct} bond.',
      'Buyers would pay about {price2|usdr} for the two-year version, but only about {price10|usdr} for a ten-year one.',
      'The longer bond falls more, because it is stuck on the lower coupon for longer.',
      'If she holds to the end and the city pays, she still collects the {face|usd}.',
      'Rates up, prices down. Rates down, prices up.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{face|usd}', label: 'Face value', tone: 'note' },
        { k: 'line', text: 'Coupon {couponRate|pct} = {coupon|usd} a year', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'numberLine', marks: [
          { at: 'couponRate', label: 'Hers {couponRate|pct}', tone: 'bad' },
          { at: 'newRate', label: 'New {newRate|pct}', tone: 'good' }
        ], dot: { from: 'couponRate', to: 'newRate' } },
        { k: 'line', text: 'Her coupon now looks small', tone: 'note' }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'Two-year', value: 'drop2', text: '{price2|usd}', tone: 'note' },
          { label: 'Ten-year', value: 'drop10', text: '{price10|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Longer bond, bigger drop', tone: 'key', cue: 3 },
        { k: 'line', text: 'Hold to the end: {face|usd} back', tone: 'good', cue: 4 },
        { k: 'line', text: 'Rates up, price down', tone: 'note', cue: 5 }
      ] }
    ]
  }),

  /* 29.15 Yield curve: normal versus inverted, a signal and not a promise. */
  E('29.15', 'yield_curve_shapes', {
    title: 'Normal curve, flipped curve',
    given: { shortA: 0.03, midA: 0.04, longA: 0.05, shortB: 0.05, midB: 0.04, longB: 0.03 },
    calc: {
      gapA: 'longA - shortA',
      gapB: 'shortB - longB'
    },
    say: [
      'A yield curve lists what a government pays to borrow for one year, five years and ten years, side by side.',
      'Normally longer means more: {shortA|pct} for one year, {midA|pct} for five and {longA|pct} for ten, a gap of {gapA|pct}.',
      'Sometimes it flips. One year pays {shortB|pct}, five pay {midB|pct} and ten pay only {longB|pct}, so the curve is inverted by {gapB|pct}.',
      'That shape has often come before slowdowns, but it is a signal, not a promise, and the record differs by country.',
      'Treat it like a weather app: worth a look, never a verdict.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'steps', items: ['1 year', '5 years', '10 years'] },
        { k: 'line', text: 'A price list for borrowing', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: '1 year', value: 'shortA', text: '{shortA|pct}', tone: 'note' },
          { label: '5 years', value: 'midA', text: '{midA|pct}', tone: 'note' },
          { label: '10 years', value: 'longA', text: '{longA|pct}', tone: 'good' }
        ] },
        { k: 'line', text: 'Normal: gap of {gapA|pct}', tone: 'good' }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: '1 year', value: 'shortB', text: '{shortB|pct}', tone: 'bad' },
          { label: '5 years', value: 'midB', text: '{midB|pct}', tone: 'note' },
          { label: '10 years', value: 'longB', text: '{longB|pct}', tone: 'note' }
        ] },
        { k: 'line', text: 'Inverted by {gapB|pct}', tone: 'bad' },
        { k: 'line', text: 'A signal, not a promise', tone: 'key', cue: 3 },
        { k: 'line', text: 'Like a weather app', tone: 'note', cue: 4 }
      ] }
    ]
  }),

  /* 29.16 Ranking assets: a made-up rough year across four holdings. */
  E('29.16', 'calm_to_wild_ladder', {
    title: 'Four holdings, one rough year',
    given: { start: 1000, shortDrop: 0.02, fundDrop: 0.25, singleDrop: 0.5 },
    calc: {
      shortLoss: 'start * shortDrop',
      fundLoss: 'start * fundDrop',
      singleLoss: 'start * singleDrop',
      shortLeft: 'start - shortLoss',
      fundLeft: 'start - fundLoss',
      singleLeft: 'start - singleLoss'
    },
    say: [
      'Ava pictures one rough year for {start|usd} parked in four made-up places, from the calm end to the wild end.',
      'In her rough year, cash stays at {start|usd} and short bonds slip {shortDrop|pct} to {shortLeft|usd}.',
      'The broad fund drops {fundDrop|pct} to {fundLeft|usd}, and the single stock drops {singleDrop|pct} to {singleLeft|usd}.',
      'Wilder swings can pay more over time, or just hurt more, so risk is not the same as reward.',
      'Even calm cash has a catch: rising prices quietly shrink what it can buy.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{start|usd}', label: 'Each one starts with', tone: 'note' },
        { k: 'steps', items: ['Cash', 'Short bonds', 'Stock fund', 'One stock'] }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Cash: {start|usd}', tone: 'good' },
        { k: 'line', text: 'Short bonds: {shortLeft|usd}', tone: 'note' }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'Cash', value: 0, text: 'Left {start|usd}', tone: 'good' },
          { label: 'Short bond', value: 'shortLoss', text: 'Left {shortLeft|usd}', tone: 'note' },
          { label: 'Stock fund', value: 'fundLoss', text: 'Left {fundLeft|usd}', tone: 'bad' },
          { label: 'One stock', value: 'singleLoss', text: 'Left {singleLeft|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Risk is not the same as reward', tone: 'key', cue: 3 },
        { k: 'line', text: 'Cash slowly buys less', tone: 'note', cue: 4 }
      ] }
    ]
  }),

  /* 29.17 The fund family: what each costs on the same balance. */
  E('29.17', 'fund_family_costs', {
    title: 'Three funds, three bills',
    given: { bal: 10000, feeIdx: 0.001, feeMut: 0.01, feeHedge: 0.02, perfShare: 0.2, profit: 1000 },
    calc: {
      costIdx: 'bal * feeIdx',
      costMut: 'bal * feeMut',
      hedgeMgmt: 'bal * feeHedge',
      hedgePerf: 'profit * perfShare',
      hedgeTotal: 'hedgeMgmt + hedgePerf'
    },
    say: [
      'Kofi has {bal|usd} to put in a fund, and he compares three bills.',
      'An index fund follows a list and charges {feeIdx|pct} a year, so {costIdx|usd} on his balance.',
      'A managed mutual fund pays a team to pick, and at {feeMut|pct} a year it takes {costMut|usd}.',
      'A hedge fund might charge {feeHedge|pct} plus {perfShare|pct} of profit, so a {profit|usd} gain leaves a bill of {hedgeTotal|usd}.',
      'Hedge funds are usually open only to qualified investors, and the rules differ by country.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{bal|usd}', label: 'Kofi has', tone: 'note' },
        { k: 'line', text: 'Three bills to compare', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Index fund: {feeIdx|pct} = {costIdx|usd}', tone: 'good' },
        { k: 'line', text: 'Managed fund: {feeMut|pct} = {costMut|usd}', tone: 'note', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Index', value: 'costIdx', text: '{costIdx|usd} a year', tone: 'good' },
          { label: 'Managed', value: 'costMut', text: '{costMut|usd} a year', tone: 'note' },
          { label: 'Hedge', value: 'hedgeTotal', text: '{hedgeTotal|usd} bill', tone: 'bad' }
        ] },
        { k: 'line', text: 'Hedge funds: qualified only', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* 29.18 Ways an index fund can still lose: the drop, the climb back, panic, fees. */
  E('29.18', 'index_fund_still_loses', {
    title: 'Diversified is not protected',
    given: { start: 10000, fall: 0.3, fee: 0.002 },
    calc: {
      after: 'start * (1 - fall)',
      loss: 'start - after',
      need: 'loss / after',
      feeAmt: 'after * fee'
    },
    say: [
      'Nia puts {start|usd} in a broad index fund, and diversified sounds safe.',
      'Then the whole market falls {fall|pct}, so her {start|usd} becomes {after|usd}, a loss of {loss|usd}.',
      'To get back to {start|usd} she needs a gain of about {need|pctr}, because it is measured on the smaller {after|usd}.',
      'If she panics and sells at {after|usd}, the loss becomes real. If she stays, the {fee|pct} yearly fee still takes {feeAmt|usd}.',
      'Diversified spreads out the risk of one bad company, but it is no seatbelt against a market-wide fall.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{start|usd}', label: 'Broad index fund', tone: 'note' },
        { k: 'line', text: 'Hundreds of companies inside', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Start', value: 'start', text: '{start|usd}', tone: 'note' },
          { label: 'After fall', value: 'after', text: '{after|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Loss of {loss|usd}', tone: 'bad' }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Back to {start|usd}: gain {need|pct}', tone: 'key' },
        { k: 'line', text: 'Sell at {after|usd}: loss is real', tone: 'bad', cue: 3 },
        { k: 'line', text: 'Stay: fee takes {feeAmt|usd}', tone: 'note', cue: 3 },
        { k: 'stamp', text: 'Diversified is not protected', tone: 'key', }
      ] }
    ]
  })
];
