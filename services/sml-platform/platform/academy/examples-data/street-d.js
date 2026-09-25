'use strict';

/* Whiteboard examples for Street Smarts (module 29), file d. Keys are '29.<lessonId>'.
 *
 * Original Academy material: fictional people from the cast in ../examples and
 * fictional businesses. Every number shown or spoken is a given or a calc result.
 * Educational only: no advice, no guarantees, no real tickers or market events. */

const { E } = require('../examples');

module.exports = [
  /* 29.19 Bargain hunting is a judgment that can be wrong; the list just follows the average. */
  E('29.19', 'value_vs_list', {
    title: 'One guess against the whole list',
    given: { price: 60, estimate: 90, shares: 10, worse: 45, companies: 100, listRise: 0.08 },
    calc: {
      cost: 'price * shares',
      rightValue: 'estimate * shares',
      rightGain: 'rightValue - cost',
      wrongValue: 'worse * shares',
      wrongLoss: 'cost - wrongValue',
      listGain: 'cost * listRise'
    },
    say: [
      'Ravi shops the market like a thrift store and spots Suds Corner Laundry at {price|usd} a share.',
      'He figures it is worth {estimate|usd}, so he buys {shares|num} shares for {cost|usd}.',
      'If he is right, the shares reach {rightValue|usd}, a gain of {rightGain|usd}.',
      'If he is wrong and it slides to {worse|usd}, he holds {wrongValue|usd}, a loss of {wrongLoss|usd}.',
      'Nia puts the same {cost|usd} into a fund of {companies|num} companies, and when the list rises {listRise|pct}, she gains {listGain|usd}.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Ravi', icon: 'person', tone: 'key' }, right: { name: 'Suds Laundry', icon: 'shop', tone: 'note' }, flows: [{ dir: 'right', text: 'Sees it at {price|usd}' }] }
      ] },
      { cue: 1, items: [
        { k: 'numberLine', marks: [
          { at: 'price', label: 'Price {price|usd}', tone: 'note' },
          { at: 'estimate', label: 'His guess {estimate|usd}', tone: 'key' }
        ] },
        { k: 'line', text: '{shares|num} shares cost {cost|usd}', tone: 'note' },
        { k: 'line', text: 'Right: worth {rightValue|usd}', tone: 'good', cue: 2 },
        { k: 'line', text: 'Wrong: worth {wrongValue|usd}', tone: 'bad', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'bars', items: [
          { label: 'Ravi right', value: 'rightGain', text: 'Gains {rightGain|usd}', tone: 'good' },
          { label: 'Ravi wrong', value: 'wrongLoss', text: 'Loses {wrongLoss|usd}', tone: 'bad' },
          { label: 'Nia, list', value: 'listGain', text: 'Gains {listGain|usd}', tone: 'key' }
        ] },
        { k: 'stamp', text: 'Neither is a promise', tone: 'note' }
      ] }
    ]
  }),

  /* 29.20 Costs come out first, so the manager has to beat the list by the cost gap just to tie. */
  E('29.20', 'cost_of_trying', {
    title: 'The cost of trying',
    given: { start: 10000, gross: 0.06, feeM: 0.012, tradeM: 0.003, feeI: 0.001 },
    calc: {
      grossGain: 'start * gross',
      costM: 'start * (feeM + tradeM)',
      costI: 'start * feeI',
      netM: 'grossGain - costM',
      netI: 'grossGain - costI',
      gap: 'netI - netM',
      needed: 'feeM + tradeM - feeI'
    },
    say: [
      'Nia\'s manager fund and Zoe\'s list copier each start with {start|usd}, and both earn {gross|pct} before costs, which is {grossGain|usd}.',
      'Nia\'s manager charges {feeM|pct} plus {tradeM|pct} in trading costs, so {costM|usd} leaves no matter what.',
      'Zoe\'s copier charges only {feeI|pct}, which is {costI|usd}.',
      'Nia keeps {netM|usd} of the gain and Zoe keeps {netI|usd}, a gap of {gap|usd}.',
      'So the manager must beat the list by {needed|pct} just to tie, like a food truck covering the generator before counting profit.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{grossGain|usd}', label: 'Both earn it, before costs', tone: 'note' },
        { k: 'line', text: 'Each starts with {start|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Manager: {feeM|pct} + {tradeM|pct} trading', tone: 'bad' },
        { k: 'line', text: 'Costs {costM|usd} either way', tone: 'bad' },
        { k: 'line', text: 'Copier: {feeI|pct} = {costI|usd}', tone: 'good', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Manager', value: 'netM', text: 'Keeps {netM|usd}', tone: 'bad' },
          { label: 'Copier', value: 'netI', text: 'Keeps {netI|usd}', tone: 'good' }
        ] },
        { k: 'line', text: 'Gap: {gap|usd}', tone: 'key' },
        { k: 'line', text: 'Must beat the list by {needed|pct}', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* 29.21 Yield is not return: a smaller yield with more growth can end at the same total. */
  E('29.21', 'yield_vs_total', {
    title: 'Same total, different shape',
    given: { start: 100, divK: 3, endK: 102, divN: 1, endN: 104 },
    calc: {
      yieldK: 'divK / start',
      gainK: 'endK - start',
      totalK: 'divK + gainK',
      retK: 'totalK / start',
      yieldN: 'divN / start',
      gainN: 'endN - start',
      totalN: 'divN + gainN',
      retN: 'totalN / start'
    },
    say: [
      'Kofi puts {start|usd} into a dividend share that pays {divK|usd} a year, a yield of {yieldK|pct}, and the price ends at {endK|usd}.',
      'His total return is the {divK|usd} in cash plus a price rise of {gainK|usd}, so {totalK|usd} on {start|usd}, or {retK|pct}.',
      'Nia puts {start|usd} into an index fund that pays only {divN|usd}, a yield of {yieldN|pct}, and its price ends at {endN|usd}.',
      'Her total is {totalN|usd}, also {retN|pct}, so a smaller yield gave the same return.',
      'Kofi holds more of it as cash to spend at the corner store, and Nia\'s sits inside the price until she sells.',
      'Tax on each part can differ by country, so check the local rule.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Kofi', icon: 'person', tone: 'key' }, right: { name: 'Dividend share', icon: 'company', tone: 'note' }, flows: [{ dir: 'right', text: 'Puts in {start|usd}' }, { dir: 'left', text: 'Pays {divK|usd}' }] },
        { k: 'line', text: 'Yield {yieldK|pct}, price ends {endK|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{divK|usd} cash + {gainK|usd} rise', tone: 'key' },
        { k: 'line', text: 'Total {totalK|usd} = {retK|pct}', tone: 'good' },
        { k: 'line', text: 'Nia: yield {yieldN|pct}, ends {endN|usd}', tone: 'note', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'compare',
          left: { title: 'Kofi, dividend', lines: ['Yield {yieldK|pct}', 'Total {retK|pct}'], mark: 'check' },
          right: { title: 'Nia, index fund', lines: ['Yield {yieldN|pct}', 'Total {retN|pct}'], mark: 'check' } },
        { k: 'stamp', text: 'Yield is not return', tone: 'key' }
      ] }
    ]
  }),

  /* 29.22 A price crash inflates the yield; profit that does not cover the payout points to a cut. */
  E('29.22', 'dividend_trap_check', {
    title: 'When a big yield is a warning',
    given: { before: 50, payout: 2, after: 20, profit: 1, cut: 0.5, shares: 100 },
    calc: {
      yieldBefore: 'payout / before',
      yieldNow: 'payout / after',
      ratio: 'payout / profit',
      expected: 'shares * payout',
      afterCutIncome: 'shares * cut',
      missing: 'expected - afterCutIncome'
    },
    say: [
      'Kettle Cart Foods paid {payout|usd} a year when its shares cost {before|usd}, a yield of {yieldBefore|pct}.',
      'Then the price crashed to {after|usd}, so the same {payout|usd} now shows a yield of {yieldNow|pct}, and Zoe gets excited.',
      'But the company earns only {profit|usd} a share, so it pays out {ratio|pct} of its profit, which cannot go on.',
      'If the payout is cut to {cut|usd}, her {shares|num} shares pay {afterCutIncome|usd} instead of the {expected|usd} she counted on.',
      'That is {missing|usd} missing, and the price often drops on the news too.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{yieldBefore|pct}', label: 'Yield at {before|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Price then', value: 'before', text: '{before|usd}', tone: 'note' },
          { label: 'Price now', value: 'after', text: '{after|usd}', tone: 'bad' }
        ] },
        { k: 'big', text: '{yieldNow|pct}', label: 'Same payout, cheaper share', tone: 'key' }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'Earns', value: 'profit', text: '{profit|usd} a share', tone: 'good' },
          { label: 'Pays out', value: 'payout', text: '{payout|usd} a share', tone: 'bad' }
        ] },
        { k: 'line', text: 'Pays {ratio|pct} of its profit', tone: 'bad' },
        { k: 'line', text: 'Cut: {afterCutIncome|usd}, not {expected|usd}', tone: 'bad', cue: 3 },
        { k: 'line', text: 'Missing {missing|usd}', tone: 'bad', cue: 4 },
        { k: 'stamp', text: 'Check profit covers payout', tone: 'key' }
      ] }
    ]
  }),

  /* 29.23 Lump sum wins when prices rise, splitting wins when they fall; both can lose. */
  E('29.23', 'lump_vs_split', {
    title: 'All at once or in four parts',
    given: { money: 1200, parts: 4, start: 10, up2: 12, up3: 15, up4: 20, dn2: 6, dn3: 5, dn4: 4 },
    calc: {
      part: 'money / parts',
      lumpShares: 'money / start',
      dcaUpShares: 'part / start + part / up2 + part / up3 + part / up4',
      lumpUp: 'lumpShares * up4',
      dcaUp: 'dcaUpShares * up4',
      dcaDownShares: 'part / start + part / dn2 + part / dn3 + part / dn4',
      lumpDown: 'lumpShares * dn4',
      dcaDown: 'dcaDownShares * dn4'
    },
    say: [
      'Ava has {money|usd} to invest, and she compares putting it all in today with {parts|num} equal buys of {part|usd}, one a month.',
      'In a made-up rising market the price climbs from {start|usd} to {up4|usd}, so lump sum owns {lumpShares|num} shares and the split plan {dcaUpShares|num}.',
      'At {up4|usd} that is {lumpUp|usd} against {dcaUp|usd}, so waiting cost her.',
      'In a made-up falling market the price drops from {start|usd} to {dn4|usd}, and the split plan holds {dcaDown|usd} against {lumpDown|usd}.',
      'Both plans lost money there, because neither got back the {money|usd}.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{money|usd}', label: 'To invest', tone: 'note' },
        { k: 'steps', items: ['All today', 'Or 4 buys'] }
      ] },
      { cue: 1, items: [
        { k: 'compare',
          left: { title: 'Lump sum', lines: ['{lumpShares|num} shares'], mark: null },
          right: { title: 'Split in four', lines: ['{dcaUpShares|num} shares'], mark: null } },
        { k: 'line', text: 'Rising: {lumpUp|usd} vs {dcaUp|usd}', tone: 'good', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Lump sum', value: 'lumpDown', text: 'Worth {lumpDown|usd}', tone: 'bad' },
          { label: 'Split plan', value: 'dcaDown', text: 'Worth {dcaDown|usd}', tone: 'key' }
        ] },
        { k: 'line', text: 'Both below {money|usd}', tone: 'bad', cue: 4 },
        { k: 'stamp', text: 'Neither plan always wins', tone: 'note' }
      ] }
    ]
  }),

  /* 29.24 The bottom shows up later; waiting for a dip can miss the rise. */
  E('29.24', 'dip_or_steady', {
    title: 'The bottom shows up later',
    given: { cash: 900, top: 50, dip: 45, low: 30, near: 47, high: 60 },
    calc: {
      zoeShares: 'cash / dip',
      zoeValue: 'zoeShares * low',
      zoeLoss: 'cash - zoeValue',
      shares50: 'cash / top',
      wouldBe: 'shares50 * high',
      missed: 'wouldBe - cash'
    },
    say: [
      'Zoe holds {cash|usd} and waits for a sale, so when the price drops from {top|usd} to {dip|usd}, she buys {zoeShares|num} shares.',
      'It keeps sliding to {low|usd}, so her shares are worth {zoeValue|usd}, a loss of {zoeLoss|usd}, and only now is the bottom clear.',
      'In another made-up year she waits for {dip|usd}, but the price only falls to {near|usd} and then climbs to {high|usd}.',
      'Buying at {top|usd} would have given {shares50|num} shares worth {wouldBe|usd}, so the wait cost her {missed|usd} of gain.',
      'Kofi just buys a set amount every payday and never has to guess the floor.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'numberLine', marks: [
          { at: 'dip', label: 'Dip {dip|usd}', tone: 'key' },
          { at: 'top', label: 'Was {top|usd}', tone: 'note' }
        ], dot: { from: 'top', to: 'dip' } },
        { k: 'line', text: 'Buys {zoeShares|num} shares', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'numberLine', marks: [
          { at: 'low', label: 'Slides {low|usd}', tone: 'bad' },
          { at: 'dip', label: 'Bought {dip|usd}', tone: 'key' }
        ], dot: { from: 'dip', to: 'low' } },
        { k: 'line', text: 'Worth {zoeValue|usd}, down {zoeLoss|usd}', tone: 'bad' }
      ] },
      { cue: 2, items: [
        { k: 'numberLine', marks: [
          { at: 'near', label: 'Low {near|usd}', tone: 'note' },
          { at: 'high', label: 'Rose to {high|usd}', tone: 'good' }
        ], dot: { from: 'near', to: 'high' } },
        { k: 'line', text: 'At {top|usd}: worth {wouldBe|usd}', tone: 'good', cue: 3 },
        { k: 'line', text: 'Waiting cost {missed|usd}', tone: 'bad', cue: 3 },
        { k: 'line', text: 'Set amount, set day', tone: 'key', cue: 4 },
        { k: 'stamp', text: 'Bottoms show up later', tone: 'note' }
      ] }
    ]
  })
];
