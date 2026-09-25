'use strict';

/* Whiteboard examples for Street Smarts (module 29), file e. Keys are '29.<lessonId>'.
 * Original scenarios with made-up companies and a made-up currency. Every number
 * shown or spoken is a given or a calc result. Educational only. */

const { E } = require('../examples');

module.exports = [
  /* 29.25 Small vs large: more room and bigger swings against steadier moves. */
  E('29.25', 'small_vs_large_swings', {
    title: 'The corner store and the giant',
    given: { stake: 100, smallUp: 150, smallDown: 60, largeUp: 110, largeDown: 92 },
    calc: {
      smallDrop: '(stake - smallDown) / stake',
      largeDrop: '(stake - largeDown) / stake'
    },
    say: [
      'Nia follows a made-up corner store chain and a made-up grocery giant, with {stake|usd} in each.',
      'In a great year the small chain climbs to {smallUp|usd}, while the giant only reaches {largeUp|usd}.',
      'In a rough year the small chain sinks to {smallDown|usd}, a fall of {smallDrop|pct}.',
      'The giant slips to {largeDown|usd}, a fall of {largeDrop|pct}, so its ride is calmer.',
      'Calmer is not safe, since giants stumble too, and holding some of each is one way to spread the bumps.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors',
          left: { name: 'Corner chain', icon: 'shop', tone: 'key' },
          right: { name: 'Grocery giant', icon: 'company', tone: 'note' },
          flows: [{ dir: 'right', text: '{stake|usd} in each' }] },
        { k: 'line', text: 'Small: room to grow', tone: 'key' },
        { k: 'line', text: 'Large: fewer new blocks', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Small up', value: 'smallUp', text: '{smallUp|usd}', tone: 'good' },
          { label: 'Giant up', value: 'largeUp', text: '{largeUp|usd}', tone: 'good' }
        ] },
        { k: 'line', text: 'Great year: small climbs more', tone: 'note' }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'Start', value: 'stake', text: '{stake|usd}', tone: 'note' },
          { label: 'Small down', value: 'smallDown', text: '{smallDown|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Small fell {smallDrop|pct}', tone: 'bad' },
        { k: 'line', text: 'Giant fell {largeDrop|pct}', tone: 'note', cue: 3 },
        { k: 'stamp', text: 'Neither size is safe', tone: 'key' }
      ] }
    ]
  }),

  /* 29.26 Growth keeps the profit; a dividend company pays part of it out. */
  E('29.26', 'growth_vs_dividend_cash', {
    title: 'Keep the profit or hand it out',
    given: { shares: 100, price: 50, dividend: 2, grown: 56 },
    calc: {
      stake: 'shares * price',
      income: 'shares * dividend',
      grownValue: 'shares * grown',
      gain: 'grownValue - stake'
    },
    say: [
      'Nia holds {shares|num} shares of two made-up companies, each priced at {price|usd}, so each stake is {stake|usd}.',
      'Pixel Pops keeps its profit to build new shops, so it pays nothing out.',
      'Comet Cafe pays {dividend|usd} a share, which puts {income|usd} of cash in her account.',
      'This year Pixel Pops climbs to {grown|usd}, so that stake is worth {grownValue|usd}, a gain of {gain|usd} on paper.',
      'Had it stalled, she would have received nothing, and Comet Cafe could cut its payout too.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'compare',
          left: { title: 'Pixel Pops', lines: ['Builds new shops', 'Pays nothing out'], mark: null },
          right: { title: 'Comet Cafe', lines: ['Pays profit out', 'Cash to holders'], mark: null } },
        { k: 'line', text: 'Each stake: {stake|usd}', tone: 'note' }
      ] },
      { cue: 2, items: [
        { k: 'actors',
          left: { name: 'Comet Cafe', icon: 'shop', tone: 'key' },
          right: { name: 'Nia', icon: 'person', tone: 'good' },
          flows: [{ dir: 'right', text: '{income|usd} in cash' }] }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Pixel gain', value: 'gain', text: '{gain|usd}', tone: 'good' },
          { label: 'Comet cash', value: 'income', text: '{income|usd}', tone: 'key' }
        ] },
        { k: 'stamp', text: 'Neither is promised', tone: 'note' }
      ] }
    ]
  }),

  /* 29.27 A rate rise reaches a car loan and a savings balance. */
  E('29.27', 'rate_rise_reaches_wallet', {
    title: 'A rate rise, block by block',
    given: { loan: 12000, rateBefore: 0.06, rateAfter: 0.08, savings: 2000, earnBefore: 20, earnAfter: 60 },
    calc: {
      interestBefore: 'loan * rateBefore',
      interestAfter: 'loan * rateAfter',
      extra: 'interestAfter - interestBefore'
    },
    say: [
      'The central bank raises its rate, and the banks pass some of it down the block.',
      'Nia\'s car loan of {loan|usd} moves from {rateBefore|pct} to {rateAfter|pct}, so a year of interest grows from {interestBefore|usd} to {interestAfter|usd}.',
      'That is {extra|usd} more a year, a lot of wing spot dinners.',
      'Kofi\'s savings of {savings|usd} earn more too, going from {earnBefore|usd} to {earnAfter|usd} a year.',
      'With loans pricey, people spend less and the economy cools a little.',
      'Other countries may pass the change on faster or slower.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'steps', items: ['Central bank', 'Banks', 'Loans', 'Spending'] },
        { k: 'line', text: 'Rate goes up', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'compare',
          left: { title: 'Loan before', lines: ['{rateBefore|pct} rate', '{interestBefore|usd} a year'], mark: null },
          right: { title: 'Loan after', lines: ['{rateAfter|pct} rate', '{interestAfter|usd} a year'], mark: 'cross' } },
        { k: 'line', text: '{extra|usd} more a year', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Saves before', value: 'earnBefore', text: '{earnBefore|usd} a year', tone: 'note' },
          { label: 'Saves after', value: 'earnAfter', text: '{earnAfter|usd} a year', tone: 'good' }
        ] },
        { k: 'stamp', text: 'Borrowers pay, savers earn', tone: 'key' }
      ] }
    ]
  }),

  /* 29.28 A trip abroad: the exchange rate moves what the same jacket costs. */
  E('29.28', 'exchange_rate_trip', {
    title: 'The jacket abroad',
    given: { dollars: 500, rate1: 4, jacket: 800, rate2: 5 },
    calc: {
      zubs: 'dollars * rate1',
      cost1: 'jacket / rate1',
      cost2: 'jacket / rate2'
    },
    say: [
      'Zoe plans a trip and swaps {dollars|usd} at {rate1|num} zubs per dollar, which gets her {zubs|num} zubs.',
      'A jacket at the flea market there costs {jacket|num} zubs, which is {cost1|usd} to her.',
      'Weeks later the zub weakens, because the country cut its interest rates and confidence dipped.',
      'Now a dollar gets {rate2|num} zubs, so the same {jacket|num} zub jacket is only {cost2|usd}.',
      'A stronger home currency makes trips cheaper, and a weaker one makes them pricier.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors',
          left: { name: 'Zoe', icon: 'person2', tone: 'key' },
          right: { name: 'Money swap', icon: 'bank', tone: 'note' },
          flows: [{ dir: 'right', text: '{dollars|usd} in' }, { dir: 'left', text: '{zubs|num} zubs back' }] }
      ] },
      { cue: 1, items: [
        { k: 'big', text: '{cost1|usd}', label: 'Jacket at {rate1|num} zubs per dollar', tone: 'key' },
        { k: 'line', text: '{jacket|num} zubs is the tag', tone: 'note' }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Before', value: 'cost1', text: '{cost1|usd}', tone: 'note' },
          { label: 'After', value: 'cost2', text: '{cost2|usd}', tone: 'good' }
        ] },
        { k: 'stamp', text: 'Strong home money, cheap trip', tone: 'key' }
      ] }
    ]
  }),

  /* 29.29 Banks earn deal fees; a hedge fund earns a fee plus a share of gains. */
  E('29.29', 'bank_and_fund_fees', {
    title: 'Who gets paid, and when',
    given: { raise: 2000000, bankRate: 0.05, fund: 1000000, feeRate: 0.02, shareRate: 0.2, gain: 100000, loss: 50000 },
    calc: {
      bankFee: 'raise * bankRate',
      feeAmt: 'fund * feeRate',
      shareAmt: 'gain * shareRate',
      kept: 'gain - feeAmt - shareAmt',
      badTotal: 'loss + feeAmt'
    },
    say: [
      'Comet Cafe raises {raise|usd} by selling new shares, and the investment bank arranging it charges {bankRate|pct}, which is {bankFee|usd}.',
      'That fee comes whether or not the shares do well later.',
      'A hedge fund manages {fund|usd} and charges {feeRate|pct}, which is {feeAmt|usd}, plus {shareRate|pct} of any gain.',
      'In a good year the fund gains {gain|usd}, its share is {shareAmt|usd}, and clients keep {kept|usd}.',
      'In a bad year it loses {loss|usd}, still charges the {feeAmt|usd}, and clients are down {badTotal|usd}.',
      'So the manager\'s pay leans on assets and gains, while clients carry losses.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors',
          left: { name: 'Comet Cafe', icon: 'shop', tone: 'key' },
          right: { name: 'Deal bank', icon: 'bank', tone: 'note' },
          flows: [{ dir: 'right', text: '{raise|usd} raised' }, { dir: 'left', text: 'Fee {bankFee|usd}' }] }
      ] },
      { cue: 2, items: [
        { k: 'steps', items: ['Assets', 'Yearly fee', 'Gain share'] },
        { k: 'line', text: 'Fee: {feeAmt|usd}', tone: 'key' },
        { k: 'line', text: 'Gain share: {shareRate|pct}', tone: 'note' }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Yearly fee', value: 'feeAmt', text: '{feeAmt|usd}', tone: 'key' },
          { label: 'Gain share', value: 'shareAmt', text: '{shareAmt|usd}', tone: 'key' },
          { label: 'Clients keep', value: 'kept', text: '{kept|usd}', tone: 'good' }
        ] },
        { k: 'line', text: 'Bad year: clients down {badTotal|usd}', tone: 'bad' },
        { k: 'stamp', text: 'Ask whose pay depends on what', tone: 'note' }
      ] }
    ]
  }),

  /* 29.30 Panic-selling locks in the loss; waiting is not a promise; needing cash soon is the risk. */
  E('29.30', 'recession_stay_or_sell', {
    title: 'Two holders, one recession',
    given: { start: 10000, drop: 0.3, later: 10500 },
    calc: {
      fallValue: 'start * (1 - drop)',
      paperLoss: 'start - fallValue'
    },
    say: [
      'Kofi and Zoe each hold {start|usd} of shares when a recession hits and prices fall {drop|pct}.',
      'That leaves each stake at {fallValue|usd}, a paper loss of {paperLoss|usd}.',
      'Zoe panics and sells, so the loss becomes real, and she holds {fallValue|usd} in cash.',
      'In this made-up story Kofi waits, the recession ends, and his stake climbs back to {later|usd}.',
      'Nothing promises that ending, and if Kofi needed the cash during the fall, he would have been stuck selling low.',
      'Records are common, so the real danger is needing the money soon.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{drop|pct}', label: 'Prices fall in a recession', tone: 'bad' },
        { k: 'line', text: 'Both start at {start|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Start', value: 'start', text: '{start|usd}', tone: 'note' },
          { label: 'After fall', value: 'fallValue', text: '{fallValue|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Paper loss {paperLoss|usd}', tone: 'bad' }
      ] },
      { cue: 3, items: [
        { k: 'compare',
          left: { title: 'Zoe sold', lines: ['Cash {fallValue|usd}', 'Loss made real'], mark: 'cross' },
          right: { title: 'Kofi waited', lines: ['Worth {later|usd}', 'Not a promise'], mark: 'check' } },
        { k: 'stamp', text: 'Real risk: needing it soon', tone: 'key' }
      ] }
    ]
  })
];
