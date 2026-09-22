'use strict';

/* Start Here (module 0) whiteboard examples, lessons 14-20.
 *
 * Original Academy material for a first-time trader. Every person is from the
 * cast in ../examples (Ava, Kofi, Nia, Zoe, Ravi), every company is fictional,
 * and the "Town Ten" is an invented index. Every money or percent figure is a
 * given or a calc result, so nothing shown or spoken is typed in by hand.
 * Educational only: no advice, no guarantees, no real tickers, no real events,
 * and no tax rate, bracket or threshold anywhere.
 *
 * The integrator adds './start-here-c' to the MODULES list in ./index.js. */

const { E } = require('../examples');

module.exports = [
  /* 0.14 - a holding period changes the treatment, never a rate. Two-path
   * tree: one purchase, two selling dates, the same gain. */
  E('0.14', 'holding_period_tax', {
    title: 'One gain, two sale dates',
    given: { shares: 100, buy: 30, sell: 36, shortMonths: 8, longMonths: 14 },
    calc: {
      cost: 'shares * buy',
      proceeds: 'shares * sell',
      gain: 'proceeds - cost'
    },
    say: [
      'Nia buys {shares|num} shares of Maple Mill at {buy|usd} and spends {cost|usd}.',
      'The price reaches {sell|usd}, so her screen shows a gain of {gain|usd}, and in most systems nothing is owed while she holds.',
      'She sells in month {shortMonths|num}, a short hold, which many countries tax at the rate on ordinary income.',
      'Kofi bought the same day and sells in month {longMonths|num}, a long hold, which many countries tax more lightly.',
      'Same company, same {gain|usd}, but the calendar changed the treatment, and how much depends on where each of them lives.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: '{shares|num} × {buy|usd} = {cost|usd}', tone: 'note' },
        { k: 'line', text: 'Gain on paper: {gain|usd}', tone: 'key', cue: 1 },
        { k: 'line', text: 'Nothing owed while held', tone: 'note', cue: 1 }
      ] },
      { cue: 3, items: [
        { k: 'tree', root: 'Same gain, two sale dates', branches: [
          { label: 'Month {shortMonths|num}', text: 'Short hold', tone: 'bad' },
          { label: 'Month {longMonths|num}', text: 'Long hold', tone: 'good' }
        ] }
      ] },
      { cue: 4, items: [
        { k: 'line', text: 'Same {gain|usd}, other treatment', tone: 'key' },
        { k: 'stamp', text: 'Depends on where you live', tone: 'note' }
      ] }
    ]
  }),

  /* 0.15 - a known cost against an unknown return. Priority ladder, then the
   * two figures side by side: only one of them is knowable in advance. */
  E('0.15', 'first_money_order', {
    title: 'Which number do you know?',
    given: { cash: 1000, debt: 1000, cardRate: 0.18, monthly: 50, months: 12 },
    calc: {
      interestSaved: 'debt * cardRate',
      yearlyInvested: 'monthly * months'
    },
    say: [
      'Ava has {cash|usd} spare and a card balance of {debt|usd} that charges {cardRate|pct} a year.',
      'Clearing the card saves about {interestSaved|usd} of interest, a little more in practice, and the saving is certain.',
      'Putting the same {cash|usd} into the Town Ten Fund might return more than {interestSaved|usd}, or it might lose money.',
      'Nobody knows which, so she clears the card, then adds {monthly|usd} a month, which is {yearlyInvested|usd} over the year.',
      'Because she can buy a fraction of a share, the whole {monthly|usd} goes to work instead of sitting as leftover cash.'
    ],
    frames: [
      /* The ladder describes what Ava did, rather than telling the learner the
       * order to put their own money in, and the hedge is on screen from the
       * first frame instead of arriving at the end. */
      { cue: 0, items: [
        { k: 'steps', items: ['What Ava owes', 'What Ava knows', 'What Ava chose'] },
        { k: 'line', text: 'Card: {debt|usd} at {cardRate|pct}', tone: 'bad' },
        { k: 'stamp', text: 'One cost known, one not', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'big', text: '{interestSaved|usd}', label: 'Saving she can know', tone: 'good' },
        { k: 'line', text: 'Charged monthly, not once', tone: 'note' },
        { k: 'line', text: 'Fund return: nobody knows', tone: 'note', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Debt saved', value: 'interestSaved', text: '{interestSaved|usd} certain', tone: 'good' },
          { label: 'Invested', value: 'yearlyInvested', text: '{yearlyInvested|usd} a year', tone: 'note' }
        ] },
        { k: 'stamp', text: 'Ava chose the known one', tone: 'key' }
      ] }
    ]
  }),

  /* 0.16 - the mix drifts, so rebalancing puts the chosen shape back. Four
   * slices before and after; the fractions are what the learner chose.
   *
   * The practice lab asks the learner to work out the trades themselves, so
   * the arithmetic has to close: world already sits on target, the sale of
   * home funds the purchase of bond, and the leftover lands in the cash slice,
   * which is itself part of the mix. All four then finish on {target}. Any
   * change to the given values must keep world === target and the total a
   * multiple of four, or "back to {target} each" stops being true. */
  E('0.16', 'four_slice_rebalance', {
    title: 'Four slices, one year later',
    given: { start: 1000, home: 1600, world: 1150, bond: 850, cash: 1000 },
    calc: {
      startTotal: 'start * 4',
      total: 'home + world + bond + cash',
      target: 'total / 4',
      homeShare: 'home / total',
      sellHome: 'home - target',
      buyBond: 'target - bond',
      leftover: 'sellHome - buyBond'
    },
    say: [
      'Kofi splits {startTotal|usd} into four equal slices of {start|usd}: home fund, world fund, bond fund and cash.',
      'A year later home is {home|usd}, world {world|usd}, bond {bond|usd}, and cash is still {cash|usd}.',
      'He holds {total|usd}, so the home slice he chose as a quarter is now about {homeShare|pctr} of it.',
      'Equal quarters would be {target|usd}, so he sells {sellHome|usd} of home and puts {buyBond|usd} into bond.',
      'The {leftover|usd} left over stays in the cash slice, so all four land on {target|usd}.',
      'He never picked a winner; he picked the shape and put it back.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Home', value: 'start', text: '{start|usd}' },
          { label: 'World', value: 'start', text: '{start|usd}' },
          { label: 'Bond', value: 'start', text: '{start|usd}' },
          { label: 'Cash', value: 'start', text: '{start|usd}' }
        ] },
        { k: 'line', text: 'Four equal quarters', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Home', value: 'home', text: '{home|usd}', tone: 'good' },
          { label: 'World', value: 'world', text: '{world|usd}' },
          { label: 'Bond', value: 'bond', text: '{bond|usd}', tone: 'bad' },
          { label: 'Cash', value: 'cash', text: '{cash|usd}' }
        ] },
        { k: 'line', text: 'Home now about {homeShare|pctr}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Sell {sellHome|usd} of home', tone: 'bad' },
        { k: 'line', text: 'Buy {buyBond|usd} of bond', tone: 'good' },
        { k: 'line', text: 'Rest {leftover|usd} into cash', tone: 'note', cue: 4 },
        { k: 'line', text: 'All four on {target|usd}', tone: 'key', cue: 4 },
        { k: 'stamp', text: 'The shape, not the winner', tone: 'note' }
      ] }
    ]
  }),

  /* 0.17 - five cases cannot tell you whether a rule is real. The town, the
   * election, the index and the record are all invented. */
  E('0.17', 'small_sample_pattern', {
    title: 'Four out of five is five',
    given: { hits: 4, cases: 5, flipped: 3, coinWays: 6, coinTotal: 32 },
    calc: {
      rate: 'hits / cases',
      flippedRate: 'flipped / cases',
      coinChance: 'coinWays / coinTotal'
    },
    say: [
      'A made-up rule says the Town Ten rises after a town election, and it has been right {hits|num} times out of {cases|num}.',
      'That is {rate|pct}, which sounds strong.',
      'Flip one of those {cases|num} and it becomes {flipped|num} out of {cases|num}, or {flippedRate|pct}.',
      'Five coin flips can land {coinTotal|num} different ways, and {coinWays|num} of those ways give four or more heads.',
      'That is about {coinChance|pctr} of coin runs, so {cases|num} cases cannot tell you which this rule is.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'tree', root: 'Five past elections', branches: [
          { label: 'Rule held', text: '{hits|num} cases', tone: 'good' },
          { label: 'Rule failed', text: 'One case', tone: 'bad' }
        ] },
        { k: 'line', text: '{hits|num} of {cases|num} is {rate|pct}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Flip one: {flipped|num} of {cases|num}', tone: 'bad' },
        { k: 'line', text: 'The record is now {flippedRate|pct}', tone: 'bad' }
      ] },
      /* A hit rate and a probability are not the same kind of number, so they
       * cannot share a bar chart: drawn together, the rule's 80% towers over
       * the coin's 19% and the picture says the opposite of the lesson. One
       * count of coin runs, on its own, says it properly. */
      { cue: 3, items: [
        { k: 'big', text: '{coinWays|num} of {coinTotal|num}', label: 'Coin runs that look this good', tone: 'key' },
        { k: 'line', text: 'That is about {coinChance|pctr}', tone: 'note' },
        { k: 'stamp', text: 'Count the cases first', tone: 'key' }
      ] }
    ]
  }),

  /* 0.18 - one call, one deadline. The numbers differ from the canonical put
   * example in 9.1 on purpose, so neither lesson answers the other's check.
   *
   * The underlying is deliberately not a cafe and the strike deliberately not
   * $45: a restaurant business under a $45 strike is the shape of the outside
   * material this module only takes its TOPICS from, and matching it on both
   * at once is a resemblance worth nothing and cheap to avoid. */
  E('0.18', 'call_option_basics', {
    title: 'One call, two endings',
    given: { stock: 36, strike: 40, premium: 3, shares: 100, high: 48, low: 39 },
    calc: {
      cost: 'premium * shares',
      costNeg: '-cost',
      breakEven: 'strike + premium',
      intrinsicHigh: 'high - strike',
      netShare: 'intrinsicHigh - premium',
      netHigh: 'netShare * shares'
    },
    say: [
      'Pebblestone Phones is at {stock|usd}, and Ava pays Ravi {premium|usd} a share for a call with a {strike|usd} strike.',
      'One contract covers {shares|num} shares, so the call costs {cost|usd} and she breaks even at {breakEven|usd}.',
      'Break-even is the {strike|usd} strike plus the {premium|usd} premium.',
      'Ending at {high|usd}, the call is worth {intrinsicHigh|usd} a share, so she nets {netHigh|usd}.',
      'Ending at {low|usd}, above the start but under the strike, the call is worthless and her {cost|usd} is gone.',
      'The shares rose and she still lost every cent.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Ava', icon: 'person' }, right: { name: 'Ravi', icon: 'person2' }, flows: [
          { dir: 'right', text: '{premium|usd} a share' },
          { dir: 'left', text: 'Right to buy at {strike|usd}' }
        ] },
        { k: 'line', text: 'Pebblestone today: {stock|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{premium|usd} × {shares|num} = {cost|usd}', tone: 'key' },
        { k: 'numberLine', marks: [
          { at: 'stock', label: 'Today {stock|usd}', tone: 'note' },
          { at: 'strike', label: 'Strike {strike|usd}' },
          { at: 'breakEven', label: 'Even {breakEven|usd}', tone: 'key' }
        ], dot: { from: 'stock', to: 'breakEven' } }
      ] },
      { cue: 4, items: [
        { k: 'bars', items: [
          { label: 'Ends {high|usd}', value: 'netHigh', text: 'Ava {netHigh|susd}', tone: 'good' },
          { label: 'Ends {low|usd}', value: 'costNeg', text: 'Ava {costNeg|susd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Under {strike|usd}: worth nothing', tone: 'bad' },
        { k: 'stamp', text: 'Shares rose, call still zero', tone: 'bad' }
      ] }
    ]
  }),

  /* 0.19 - the seller's side, measured from ONE baseline: simply holding the
   * shares with no call sold. An earlier version set the climb's forgone gain
   * (versus holding) beside the fall's loss (versus her purchase price), found
   * them equal for those inputs, and captioned it "both endings cost $800".
   * They are not the same quantity, the equality was an accident of the
   * numbers, and the picture taught a beginner that a covered call loses both
   * ways. Against holding, the ceiling costs her in the climb and the premium
   * pays her in the fall; the loss from her own start is said, not drawn.
   *
   * The underlying and the strike avoid the restaurant-at-$45 shape for the
   * same reason as 0.18. */
  E('0.19', 'covered_call_sides', {
    title: 'Taking the premium',
    given: { shares: 100, entry: 36, strike: 40, premium: 2, high: 50, low: 28 },
    calc: {
      stake: 'shares * entry',
      credit: 'premium * shares',
      calledValue: 'strike * shares',
      upTotal: 'calledValue + credit',
      holdValue: 'high * shares',
      givenUp: 'holdValue - upTotal',
      lowValue: 'low * shares',
      downTotal: 'lowValue + credit',
      downLoss: 'stake - downTotal'
    },
    say: [
      'Nia owns {shares|num} Pebblestone shares bought at {entry|usd}, so {stake|usd}, and sells Ravi a {strike|usd} call for {credit|usd}.',
      'It climbs to {high|usd}, her shares go at {strike|usd}, and she holds {upTotal|usd} rather than the {holdValue|usd} holding would have left.',
      'She is still ahead of her {stake|usd} start, but the ceiling gave up {givenUp|usd} of the climb.',
      'Other ending: it falls to {low|usd}, so holding alone leaves {lowValue|usd} and the premium makes it {downTotal|usd}.',
      'Against holding she is {credit|usd} better off, and still {downLoss|usd} below her start.',
      'The premium softened the fall, never stopped it.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Nia', icon: 'person' }, right: { name: 'Ravi', icon: 'person2' }, flows: [
          { dir: 'left', text: '{credit|usd} premium' },
          { dir: 'right', text: 'Right to buy at {strike|usd}' }
        ] },
        { k: 'line', text: 'Owns {shares|num} at {entry|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Called away: {upTotal|usd}', tone: 'note' },
        { k: 'line', text: 'Simply holding: {holdValue|usd}', tone: 'key', cue: 2 },
        { k: 'line', text: 'Ceiling cost {givenUp|usd}', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Climb', value: 'givenUp', text: '{givenUp|usd} given up', tone: 'bad' },
          { label: 'Fall', value: 'credit', text: '{credit|usd} kept', tone: 'good' }
        ] },
        { k: 'line', text: 'Both against simply holding', tone: 'key' },
        { k: 'line', text: 'The fall leaves {downTotal|usd}', tone: 'note', cue: 4 },
        { k: 'stamp', text: 'Paid to take an obligation', tone: 'key' }
      ] }
    ]
  }),

  /* 0.20 - the winner only means something with the losers beside it. The
   * frequencies are invented; nothing here says how often real options pay. */
  E('0.20', 'option_bet_totals', {
    title: 'One winner, nine losers',
    given: { bets: 10, each: 200, winners: 1, winReturn: 1000 },
    calc: {
      spent: 'bets * each',
      losers: 'bets - winners',
      lost: 'losers * each',
      netLoss: 'spent - winReturn',
      lossPct: 'netLoss / spent'
    },
    say: [
      'Zoe buys {bets|num} calls over a year at {each|usd} each, so she spends {spent|usd}.',
      'One works and is sold for {winReturn|usd}, five times what that single bet cost her.',
      'The other {losers|num} expire worthless, so {lost|usd} is gone.',
      'She spent {spent|usd} and holds {winReturn|usd}, so she is down {netLoss|usd}, or {lossPct|pct} of her money.',
      'The year held a winner worth five times its cost, and the winners still have to cover every loser.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: '{bets|num} bets × {each|usd} = {spent|usd}', tone: 'note' }
      ] },
      { cue: 2, items: [
        { k: 'tree', root: '{bets|num} identical bets', branches: [
          { label: 'One wins', text: 'Returns {winReturn|usd}', tone: 'good' },
          { label: '{losers|num} expire', text: '{lost|usd} gone', tone: 'bad' }
        ] }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Paid in', value: 'spent', text: '{spent|usd} spent', tone: 'bad' },
          { label: 'Came back', value: 'winReturn', text: '{winReturn|usd} back', tone: 'note' }
        ] },
        { k: 'line', text: 'Down {netLoss|usd}, or {lossPct|pct}', tone: 'bad' },
        { k: 'stamp', text: 'Count the losers too', tone: 'key' }
      ] }
    ]
  })
];
