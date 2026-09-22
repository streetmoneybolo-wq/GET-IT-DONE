'use strict';

/* Authored whiteboard examples for modules 14-20 (35 lessons).
 * Original Academy material: fictional people and fictional companies only.
 * Every number shown or spoken comes from given/calc, so the math is computed
 * here and checked by validateExample(). Educational only: no advice, no
 * guarantees, no real tickers and no real market events. */

const { E } = require('../examples');

module.exports = [
  /* ---------------- Module 14: Mathematical Foundations ---------------- */

  E('14.1', 'compounding', {
    title: 'Per year, not in total',
    given: { mStart: 100, mEnd: 121, mYears: 2, lStart: 100, lEnd: 144, lYears: 4 },
    calc: {
      mGain: 'mEnd - mStart',
      lGain: 'lEnd - lStart',
      mTotal: 'mEnd / mStart',
      lTotal: 'lEnd / lStart',
      mFactor: 'mTotal ^ (1 / mYears)',
      mRate: 'mFactor - 1',
      lFactor: 'lTotal ^ (1 / lYears)',
      lRate: 'lFactor - 1',
      mStep1: 'mStart * mFactor',
      lStep1: 'lStart * lFactor',
      lStep2: 'lStart * lFactor ^ 2',
      lStep3: 'lStart * lFactor ^ 3'
    },
    say: [
      'Maya\'s {mStart|usd} grows to {mEnd|usd} in {mYears} years, while Leo\'s {lStart|usd} grows to {lEnd|usd} in {lYears} years.',
      'Leo\'s gain of {lGain|usd} looks bigger than Maya\'s {mGain|usd}, but he took twice as long.',
      'Growth multiplies: {mRate|pct} a year means times {mFactor} each year, and {mFactor} times {mFactor} is {mTotal}.',
      'Leo\'s money grew {lTotal} times, but spread over {lYears} years that is only about {lRate|pctr} a year.',
      'Logs turn that multiplying into adding, so equal percent steps look like equal steps on a log chart.',
      'Turn a total gain into a per-year rate before comparing.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'compare', left: { title: 'Maya', lines: ['{mStart|usd} → {mEnd|usd}', '{mYears} years'], mark: null },
          right: { title: 'Leo', lines: ['{lStart|usd} → {lEnd|usd}', '{lYears} years'], mark: null } },
        { k: 'line', text: 'Gains: Maya {mGain|usd}, Leo {lGain|usd}', tone: 'note', cue: 1 },
        { k: 'line', text: 'Bigger gain = faster growth?', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'steps', items: ['{mStart|usd}', '×{mFactor} → {mStep1|usd}', '×{mFactor} → {mEnd|usd}'] },
        { k: 'line', text: '{mFactor} × {mFactor} = {mTotal} → {mRate|pct} a year', tone: 'key' },
        { k: 'line', text: 'Leo: {lStep1|usd}, {lStep2|usd}, {lStep3|usd}, {lEnd|usd}', tone: 'note', cue: 3 },
        { k: 'line', text: 'Per year: Maya {mRate|pct}, Leo {lRate|pct}', tone: 'good', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'line', text: 'log {mTotal} = log {mFactor} + log {mFactor}', tone: 'note' },
        { k: 'line', text: 'Equal % steps = equal steps', tone: 'key' },
        { k: 'stamp', text: 'Compare per year, not total', tone: 'key' }
      ] }
    ]
  }),

  E('14.2', 'present_value', {
    title: 'Money later, worth less now',
    given: { pay: 100, r1: 0.05, r2: 0.1 },
    calc: {
      pv1: 'pay / r1',
      pv2: 'pay / r2',
      d1: '1 + r2',
      d2: '(1 + r2) ^ 2',
      a1: 'pay / d1',
      a2: 'pay / d2',
      ann: 'a1 + a2'
    },
    say: [
      'Say Sam is promised {pay|usd} every year, forever, from renting out a lemonade cart.',
      'A promise that never ends is worth the payment divided by the yearly rate Sam needs: at {r1|pct}, that is {pv1|usd} today.',
      'If Sam needs {r2|pct} instead, the same promise is worth only {pv2|usd}.',
      'A promise that stops is worth less: just two payments of {pay|usd} at {r2|pct} are worth only about {ann|usdr} today.',
      'Same money later, higher rate, lower value today.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Sam', icon: 'person' }, right: { name: 'Cart renter', icon: 'shop' }, flows: [
          { dir: 'left', text: '{pay|usd} every year, forever' }
        ] },
        { k: 'line', text: 'Worth today = payment ÷ rate', tone: 'note' },
        { k: 'line', text: '{pay|usd} ÷ {r1|pts} = {pv1|usd}', tone: 'good', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: '{pay|usd} ÷ {r2|pts} = {pv2|usd}', tone: 'bad' },
        { k: 'bars', items: [
          { label: 'At {r1|pct}', value: 'pv1', text: '{pv1|usd} today', tone: 'good' },
          { label: 'At {r2|pct}', value: 'pv2', text: '{pv2|usd} today', tone: 'bad' }
        ] }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Year 1: {pay|usd} ÷ {d1} = {a1|usd}' },
        { k: 'line', text: 'Year 2: {pay|usd} ÷ {d2} = {a2|usd}' },
        { k: 'big', text: '{ann|usd}', label: 'Two payments at {r2|pct}', tone: 'key' },
        { k: 'line', text: 'Higher rate → lower value today', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('14.3', 'portfolio_mix', {
    title: 'How the parts move together',
    given: { hi: 20, lo: 0, w: 0.5, rainChance: 0.5 },
    calc: {
      mixRain: 'w * hi + (1 - w) * lo',
      mixSun: 'w * lo + (1 - w) * hi',
      cartsRain: 'w * lo + (1 - w) * lo',
      cartsSun: 'w * hi + (1 - w) * hi',
      cartsAvg: 'rainChance * cartsRain + (1 - rainChance) * cartsSun'
    },
    say: [
      'Say Ava splits her money half and half between an umbrella stand and an ice-cream cart.',
      'The umbrella stand makes {hi|usd} on rainy days and nothing on sunny days, and the cart is the opposite.',
      'Her mix makes half of {hi|usd} plus half of zero, which is {mixRain|usd}, rain or shine.',
      'With two ice-cream carts instead, she still averages {cartsAvg|usd} if rain and sun are equally likely, but swings between zero and {cartsSun|usd}.',
      'Each part is just as bumpy alone; how the parts move together decides how bumpy the mix is.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Ava: {w|pct} umbrellas, {w|pct} ice cream', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'compare', left: { title: 'Umbrella stand', lines: ['Rain: {hi|usd}', 'Sun: {lo|usd}'], mark: null },
          right: { title: 'Ice-cream cart', lines: ['Rain: {lo|usd}', 'Sun: {hi|usd}'], mark: null } },
        { k: 'line', text: 'Rain: {w} × {hi|usd} + {w} × {lo|usd} = {mixRain|usd}', tone: 'key', cue: 2 },
        { k: 'line', text: 'Sun: {w} × {lo|usd} + {w} × {hi|usd} = {mixSun|usd}', tone: 'key', cue: 2 },
        { k: 'line', text: 'Opposites cancel: {mixRain|usd} every day', tone: 'good', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Mix, rain', value: 'mixRain', text: '{mixRain|usd}', tone: 'good' },
          { label: 'Mix, sun', value: 'mixSun', text: '{mixSun|usd}', tone: 'good' },
          { label: 'Carts, rain', value: 'cartsRain', text: '{cartsRain|usd}', tone: 'bad' },
          { label: 'Carts, sun', value: 'cartsSun', text: '{cartsSun|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: 'Same average, very different ride', tone: 'note' },
        { k: 'stamp', text: 'Moving together = bumpy', tone: 'key' },
        { k: 'line', text: 'Risk depends on how parts co-move', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('14.4', 'constrained_allocation', {
    title: 'Put the limits inside the math',
    given: { cash: 1000, rA: 0.12, rB: 0.08, rC: 0.06, capA: 200, maxPct: 0.4 },
    calc: {
      paper: 'cash * rA',
      maxAmt: 'maxPct * cash',
      inA: 'min(capA, maxAmt)',
      inB: 'min(maxAmt, cash - inA)',
      inC: 'cash - inA - inB',
      gA: 'inA * rA',
      gB: 'inB * rB',
      gC: 'inC * rC',
      best: 'gA + gB + gC',
      idle: 'cash - inA'
    },
    say: [
      'Iris has {cash|usd} and three pretend shops that hope to earn {rA|pct}, {rB|pct} and {rC|pct} a year.',
      'On paper, the best plan is all {cash|usd} in the {rA|pct} shop, for a hoped {paper|usd}.',
      'Here\'s the catch: only {capA|usd} of that shop is for sale, and her rule is at most {maxPct|pct}, or {maxAmt|usd}, in any one shop.',
      'Solving with the limits inside gives {inA|usd}, {inB|usd} and {inC|usd}, for a hoped {gA|usd} plus {gB|usd} plus {gC|usd}, or {best|usd}.',
      'Chopping the paper plan afterward hopes for just {gA|usd} with {idle|usd} idle, so the limits belong inside the math.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{cash|usd}', label: 'Iris\'s money', tone: 'key' },
        { k: 'line', text: 'Hoped: {rA|pct}, {rB|pct}, {rC|pct} a year', tone: 'note' },
        { k: 'line', text: 'Paper plan: all in one = {paper|usd}', tone: 'note', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'stamp', text: 'Only {capA|usd} for sale', tone: 'bad' },
        { k: 'line', text: '{maxPct|pct} × {cash|usd} = {maxAmt|usd} max each', tone: 'key' }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Shop A', value: 'inA', text: '{inA|usd} → {gA|usd}', tone: 'good' },
          { label: 'Shop B', value: 'inB', text: '{inB|usd} → {gB|usd}', tone: 'good' },
          { label: 'Shop C', value: 'inC', text: '{inC|usd} → {gC|usd}', tone: 'good' }
        ] },
        { k: 'line', text: '{gA|usd} + {gB|usd} + {gC|usd} = {best|usd} hoped', tone: 'key' },
        { k: 'line', text: 'Fix afterward: {gA|usd}, {idle|usd} idle', tone: 'bad', cue: 4 },
        { k: 'stamp', text: 'Limits go inside the math', tone: 'key' }
      ] }
    ]
  }),

  E('14.5', 'duration_convexity', {
    title: 'A ruler and a curve',
    given: { price: 100, dur: 10, conv: 100, dy1: 0.01, dy3: 0.03 },
    calc: {
      lin1: 'dur * dy1',
      lin3: 'dur * dy3',
      p1lin: 'price * (1 - lin1)',
      p3lin: 'price * (1 - lin3)',
      c1: '0.5 * conv * dy1 ^ 2',
      c3: '0.5 * conv * dy3 ^ 2',
      p1: 'price * (1 - lin1 + c1)',
      p3: 'price * (1 - lin3 + c3)',
      gap3: 'p3 - p3lin',
      ch1lin: 'p1lin - price',
      ch1: 'p1 - price',
      ch3lin: 'p3lin - price',
      ch3: 'p3 - price'
    },
    say: [
      'Leo\'s pretend bond is worth {price|usd}, and its duration of {dur} says it drops about {dur}% for each 1% rise in rates.',
      'That straight-line rule says a {dy1|pct} rise costs {lin1|pct}, to {p1lin|usd}, and a {dy3|pct} rise costs {lin3|pct}, to {p3lin|usd}.',
      /* Convexity's value is spoken and labelled, so the 100 in the fix is
       * not mistaken for the $100 bond price. */
      'But real bond prices curve, so a second fix called convexity, {conv} for this bond, adds some value back, growing fast for bigger moves.',
      'For a 1% rise, that adds only {c1|pct}, to {p1|usd}, but for 3% it adds {c3|pct}, to {p3|usd}.',
      'For plain bonds, the straight line is fine for small moves and too gloomy for big ones.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Rates', icon: 'bank' }, right: { name: 'Leo\'s bond', icon: 'coin' }, flows: [
          { dir: 'right', text: 'Rates up {dy1|pct}' },
          { dir: 'left', text: 'Price down about {lin1|pct}' }
        ] },
        { k: 'line', text: 'Duration {dur}: a straight ruler', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{dur} × {dy1|pct} = {lin1|pct} → {p1lin|usd}', tone: 'key' },
        { k: 'line', text: '{dur} × {dy3|pct} = {lin3|pct} → {p3lin|usd}', tone: 'key' },
        { k: 'line', text: 'Convexity {conv}: the curve fix', tone: 'note', cue: 2 },
        { k: 'line', text: '0.5 × convexity × change × change', tone: 'note', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: '1%: ruler', value: 'ch1lin', text: '{p1lin|usd}', tone: 'note' },
          { label: '1%: curve', value: 'ch1', text: '{p1|usd}', tone: 'good' },
          { label: '3%: ruler', value: 'ch3lin', text: '{p3lin|usd}', tone: 'bad' },
          { label: '3%: curve', value: 'ch3', text: '{p3|usd}', tone: 'good' }
        ] },
        { k: 'line', text: '0.5 × {conv} × 3% × 3% = {c3|pct}', tone: 'key' },
        { k: 'big', text: '{gap3|usd}', label: 'Curve fix at a 3% jump', tone: 'good' },
        { k: 'line', text: 'Ruler: fine small, gloomy big', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* ------------- Module 15: Microeconomics and Strategic Behavior ------------- */

  E('15.1', 'supply_demand', {
    title: 'A shift, then a slide',
    given: { a: 100, b: 10, c: 20, d: 10, cut: 40 },
    calc: {
      p0: '(a - c) / (b + d)',
      q0: 'a - b * p0',
      p1: '(a - c + cut) / (b + d)',
      q1: 'a - b * p1',
      qs0: 'c - cut + d * p0',
      qs1: 'c - cut + d * p1',
      drop: 'q0 - q1'
    },
    /* The frost cuts supply by 40 at every price (not 40 lemons in total):
     * at $4 growers now bring 20, and at $6 they bring 40, a movement along
     * the new supply curve. The amount buyers take at one price is always
     * "asked for"; "demand" is only their whole plan across prices, so the
     * example never says both "want 40" and "same wants". */
    say: [
      'In Lemon Town, at {p0|usd} a lemon, buyers ask for {q0} lemons and growers bring {q0}, so the price sits at {p0|usd}.',
      'Then a frost cuts what growers can bring by {cut} lemons at every price: supply itself has shifted.',
      'At {p0|usd}, growers now bring only {qs0}, so buyers compete and the price climbs to {p1|usd}, where growers bring {qs1} and buyers ask for {q1}.',
      'Buyers asking for {drop} fewer lemons does not mean demand shifted; they are just reacting to the higher price.',
      'A shift changes the amounts at every price; a reaction just follows a new price.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Buyers', icon: 'crowd' }, right: { name: 'Growers', icon: 'house' }, flows: [
          { dir: 'right', text: 'Ask for {q0} at {p0|usd}' },
          { dir: 'left', text: 'Bring {q0} at {p0|usd}' }
        ] },
        { k: 'big', text: '{p0|usd}', label: 'Balance: {q0} lemons', tone: 'key' },
        { k: 'line', text: 'Frost: {cut} fewer at every price', tone: 'bad', cue: 1 },
        { k: 'line', text: 'That is a supply SHIFT', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'At {p0|usd}: {qs0} brought, {q0} asked for', tone: 'bad' },
        { k: 'numberLine', marks: [
          { at: 'p0', label: 'Old {p0|usd}', tone: 'note' },
          { at: 'p1', label: 'New {p1|usd}', tone: 'bad' }
        ], dot: { from: 'p0', to: 'p1' } },
        { k: 'line', text: 'At {p1|usd}: {q1} asked for, {qs1} brought', tone: 'note' }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Buyers: {q0} → {q1} lemons', tone: 'key' },
        { k: 'line', text: 'Same demand, higher price', tone: 'key' },
        /* A shift changes the amounts at every price, not the prices. */
        { k: 'compare', left: { title: 'Shift', lines: ['Frost, new crop', 'Amounts change', 'at every price'], mark: null },
          right: { title: 'Reaction', lines: ['Price changed', 'Same demand'], mark: null } }
      ] }
    ]
  }),

  E('15.2', 'elasticity', {
    title: 'Same price rise, two endings',
    given: { p0: 2, p1: 2.2, q0: 100, qs: 95, qf: 80, rent: 100, vc: 0.5 },
    calc: {
      dp: 'p1 / p0 - 1',
      dqs: '1 - qs / q0',
      dqf: '1 - qf / q0',
      r0: 'p0 * q0',
      rs: 'p1 * qs',
      rf: 'p1 * qf',
      es: '-dqs / dp',
      ef: '-dqf / dp',
      vc0: 'vc * q0',
      vcs: 'vc * qs',
      pr0: 'r0 - rent - vc0',
      pr1: 'rs - rent - vcs',
      drs: 'rs / r0 - 1',
      dpr: 'pr1 / pr0 - 1'
    },
    say: [
      'Sunny Juice raises a cup from {p0|usd} to {p1|usd}, a {dp|pct} rise, and cups sold slip from {q0} to {qs}, only {dqs|pct} fewer.',
      'Cups moved less than price, so demand is inelastic, and money in rises from {r0|usd} to {rs|usd}.',
      'Fizz Pop tries the same rise, loses {dqf|pct} of its cups, and takes in just {rf|usd}, down from {r0|usd}: elastic demand.',
      'Sunny pays a fixed {rent|usd} rent plus {vc|usd} a cup, so profit jumps from {pr0|usd} to {pr1|usd}, up {dpr|pct} on {drs|pct} more money in.',
      'Fixed costs make profit swing harder than money in.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Price {p0|usd} → {p1|usd} = {dp|spct}', tone: 'note' },
        { k: 'line', text: 'Sunny cups: {q0} → {qs} = -{dqs|pct}', tone: 'note' },
        { k: 'line', text: '{qs} × {p1|usd} = {rs|usd} (was {r0|usd})', tone: 'good', cue: 1 },
        { k: 'line', text: 'Elasticity: -{dqs|pct} ÷ {dp|pct} = {es}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'compare', left: { title: 'Sunny: inelastic', lines: ['Cups -{dqs|pct}', 'Money in {rs|usd}'], mark: 'check' },
          right: { title: 'Fizz Pop: elastic', lines: ['Cups -{dqf|pct}', 'Money in {rf|usd}'], mark: 'cross' } },
        { k: 'line', text: 'Fizz: -{dqf|pct} ÷ {dp|pct} = {ef}', tone: 'bad' }
      ] },
      { cue: 3, items: [
        { k: 'line', text: '{rs|usd} − {rent|usd} − {vcs|usd} = {pr1|usd}', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Money in', value: 'drs', text: '{drs|spct}', tone: 'note' },
          { label: 'Profit', value: 'dpr', text: '{dpr|spct}', tone: 'good' }
        ] },
        { k: 'big', text: '{dpr|spct}', label: 'Profit, on {drs|spct} money in', tone: 'good' },
        { k: 'line', text: 'Fixed costs = bigger profit swings', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('15.3', 'competition_moat', {
    title: 'Fat margins attract copycats',
    given: { p0: 3, cost: 1, p1: 2, p2: 1.5 },
    calc: {
      m0: 'p0 - cost',
      m1: 'p1 - cost',
      m2: 'p2 - cost',
      mg0: 'm0 / p0',
      mg1: 'm1 / p1',
      mg2: 'm2 / p2'
    },
    say: [
      'Maya sells cookies for {p0|usd} that cost her {cost|usd} to make, so she keeps {m0|usd} a cookie, a fat margin.',
      'Nothing stops copycats, so Leo opens next door at {p1|usd}, and Maya has to match him and keeps just {m1|usd}.',
      'Then a third stand sells at {p2|usd}, and her profit shrinks to {m2|usd} a cookie.',
      'Omar\'s ice rink holds the town\'s only permit, so no one can easily copy it, and that barrier is a moat.',
      'A high margin today is not a moat; ask what stops rivals from copying.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Customer', icon: 'person2' }, right: { name: 'Maya', icon: 'shop', tone: 'good' }, flows: [
          { dir: 'right', text: 'Pays {p0|usd} a cookie' }
        ] },
        { k: 'line', text: '{p0|usd} − {cost|usd} = {m0|usd} ({mg0|pct} margin)', tone: 'good' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: '{p1|usd} − {cost|usd} = {m1|usd} ({mg1|pct} margin)', tone: 'note' },
        { k: 'line', text: '{p2|usd} − {cost|usd} = {m2|usd} ({mg2|pct} margin)', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Alone', value: 'm0', text: '{m0|usd} a cookie', tone: 'good' },
          { label: '1 rival', value: 'm1', text: '{m1|usd}', tone: 'note' },
          { label: '2 rivals', value: 'm2', text: '{m2|usd}', tone: 'bad' }
        ] },
        { k: 'compare', left: { title: 'Cookie stand', lines: ['Easy to copy', 'Margin melts'], mark: 'cross' },
          right: { title: 'Ice rink', lines: ['Only permit', 'Hard to copy'], mark: 'check' } },
        { k: 'stamp', text: 'High margin ≠ moat', tone: 'key' }
      ] }
    ]
  }),

  E('15.4', 'game_theory', {
    title: 'Best either way',
    given: { ss: 10, bb: 8, bs: 12, sb: 6 },
    calc: { lost: 'ss - bb' },
    say: [
      'Zoe and Omar run the only two pizza shops in town, and each picks a small or a big oven.',
      'Both small earns {ss|usd} a day each and both big earns {bb|usd}; if only one goes big, it earns {bs|usd} and the other {sb|usd}.',
      'For Zoe, big wins either way: {bs|usd} beats {ss|usd} if Omar stays small, and {bb|usd} beats {sb|usd} if he goes big.',
      'That makes big a dominant strategy, so both go big and earn {bb|usd}, though {ss|usd} each was possible.',
      'If they face off every day for years, staying small together can become worth it.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Zoe', icon: 'shop' }, right: { name: 'Omar', icon: 'shop' }, flows: [
          { dir: 'right', text: 'Small or big oven?' },
          { dir: 'left', text: 'Small or big oven?' }
        ] },
        { k: 'line', text: 'Both small: {ss|usd} each. Both big: {bb|usd}', tone: 'note', cue: 1 },
        { k: 'line', text: 'One big: big {bs|usd}, small {sb|usd}', tone: 'note', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'compare', left: { title: 'If Omar picks small', lines: ['Zoe small: {ss|usd}', 'Zoe big: {bs|usd}'], mark: null },
          right: { title: 'If Omar picks big', lines: ['Zoe small: {sb|usd}', 'Zoe big: {bb|usd}'], mark: null } },
        { k: 'line', text: 'Big wins: {bs|usd} vs {ss|usd}, {bb|usd} vs {sb|usd}', tone: 'key' },
        { k: 'big', text: 'BIG', label: 'Best for Zoe either way', tone: 'key' }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Both big', value: 'bb', text: '{bb|usd} each', tone: 'bad' },
          { label: 'Both small', value: 'ss', text: '{ss|usd} each', tone: 'good' }
        ] },
        { k: 'stamp', text: 'Best either way = dominant', tone: 'key' },
        { k: 'line', text: '{lost|usd} a day each left on the table', tone: 'note' },
        { k: 'line', text: 'Every day for years → trust?', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('15.5', 'signaling', {
    title: 'A promise that fakers can\'t afford',
    given: { good: 100, dud: 40, share: 0.5, cg: 5, cd: 80 },
    calc: {
      pool: 'share * good + (1 - share) * dud',
      netG: 'good - cg',
      netD: 'good - cd'
    },
    /* Once the promise exists, a bike sold without it is taken for a dud, so
     * both sellers are measured against that same $40 (not the good seller
     * against the old $70 average and the dud against $40). */
    say: [
      'In Bike Town, half the used bikes are good, worth {good|usd}, and half are duds, worth {dud|usd}, but buyers can\'t tell which.',
      'So buyers pay the average, {pool|usd}, and owners of good bikes start walking away.',
      'Ravi, who has a good bike, offers a year of free repairs, costing about {cg|usd} on his bike but {cd|usd} on a dud.',
      'Buyers now take a bike without the promise for a dud, worth {dud|usd}.',
      'A good seller nets {good|usd} minus {cg|usd}, or {netG|usd}, but a dud seller who copies nets only {netD|usd}, less than {dud|usd}.',
      'A signal works when it is too costly for fakers to copy.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'compare', left: { title: 'Good bike', lines: ['Worth {good|usd}'], mark: null },
          right: { title: 'Dud bike', lines: ['Worth {dud|usd}'], mark: null } },
        { k: 'line', text: 'They look the same to buyers', tone: 'note' },
        { k: 'line', text: '{share} × {good|usd} + {share} × {dud|usd} = {pool|usd}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'actors', left: { name: 'Buyer', icon: 'person' }, right: { name: 'Ravi, good bike', icon: 'person2' }, flows: [
          { dir: 'left', text: 'Free repairs for a year' }
        ] },
        { k: 'line', text: 'Repairs cost: good {cg|usd}, dud {cd|usd}', tone: 'note' },
        { k: 'line', text: 'No promise? Taken as a dud: {dud|usd}', tone: 'bad', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'compare', left: { title: 'Good seller signals', lines: ['{good|usd} − {cg|usd}', '= {netG|usd} vs {dud|usd}'], mark: 'check' },
          right: { title: 'Dud seller copies', lines: ['{good|usd} − {cd|usd}', '= {netD|usd} vs {dud|usd}'], mark: 'cross' } },
        /* The gap in cost by type is what makes the signal credible; a signal
         * that cost everyone the same would not separate good from dud. */
        { k: 'stamp', text: 'Fakers can\'t afford to copy', tone: 'key' },
        { k: 'line', text: 'Too costly to fake = credible', tone: 'key', cue: 5 }
      ] }
    ]
  }),

  /* ------------- Module 16: Macroeconomics and Global Markets ------------- */

  E('16.1', 'gdp_real_nominal', {
    title: 'More pizza, or pricier pizza?',
    given: { q0: 100, p0: 10, q1: 105, p1: 12, cons: 800, inv: 200, gov: 300, nx: -40 },
    calc: {
      n0: 'q0 * p0',
      n1: 'q1 * p1',
      gN: 'n1 / n0 - 1',
      real1: 'q1 * p0',
      gR: 'real1 / n0 - 1',
      gP: 'n1 / real1 - 1',
      total: 'cons + inv + gov + nx',
      nxAbs: 'abs(nx)'
    },
    say: [
      'Pizza Island makes only pizza: last year {q0} pizzas at {p0|usd}, or {n0|usd}, and this year {q1} at {p1|usd}, or {n1|usd}.',
      'That total, the value of all it makes, is its GDP: up {gN|pct} in dollars, but prices alone rose {gP|pct}.',
      'To see real growth, use last year\'s price: {q1} times {p0|usd} is {real1|usd}, only {gR|pct} more.',
      'The same {n1|usd} is spent by families, businesses and government, minus {nxAbs|usd} because more was bought from abroad than sold.',
      'Real GDP uses fixed prices, so it counts how much more stuff was actually made.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Last year: {q0} × {p0|usd} = {n0|usd}', tone: 'note' },
        { k: 'line', text: 'This year: {q1} × {p1|usd} = {n1|usd}', tone: 'key' },
        { k: 'line', text: 'GDP: {n1|usd} ÷ {n0|usd} → {gN|spct}', tone: 'note', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Same old price: {q1} × {p0|usd} = {real1|usd}', tone: 'key' },
        { k: 'bars', items: [
          { label: 'Dollar GDP', value: 'gN', text: '{gN|spct}', tone: 'note' },
          { label: 'Real GDP', value: 'gR', text: '{gR|spct}', tone: 'good' }
        ] },
        { k: 'stamp', text: 'Real GDP: last year\'s prices', tone: 'key' }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Families', value: 'cons', text: '{cons|usd}', tone: 'key' },
          { label: 'Businesses', value: 'inv', text: '{inv|usd}', tone: 'key' },
          { label: 'Government', value: 'gov', text: '{gov|usd}', tone: 'key' },
          { label: 'Trade', value: 'nx', text: '{nx|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: '{cons|usd} + {inv|usd} + {gov|usd} − {nxAbs|usd} = {total|usd}', tone: 'note' },
        { k: 'line', text: 'Real GDP: stuff, not price tags', tone: 'good', cue: 4 }
      ] }
    ]
  }),

  E('16.2', 'inflation_breakeven', {
    title: 'Looking back, peeking forward',
    given: { bread0: 4, bus0: 10, movie0: 6, bread1: 4.2, bus1: 10.5, movie1: 6.3, nom: 0.04, real: 0.01 },
    calc: {
      b0: 'bread0 + bus0 + movie0',
      b1: 'bread1 + bus1 + movie1',
      inf: 'b1 / b0 - 1',
      be: 'nom - real'
    },
    say: [
      'Lena\'s basket of bread, a bus pass and a movie cost {b0|usd} last year and {b1|usd} this year, so her basket inflation was {inf|pct}.',
      'That looks back; to peek forward, compare a regular bond paying {nom|pct} with a protected bond paying {real|pct} plus inflation.',
      'They tie if inflation averages {be|pct}, so {be|pct} is called the breakeven.',
      'But it mixes the crowd\'s guess with extra pay for inflation worry, minus a bit because protected bonds are harder to sell.',
      'A breakeven is a clue, not a clean forecast.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Bread {bread0|usd} → {bread1|usd}', tone: 'note' },
        { k: 'line', text: 'Bus pass {bus0|usd} → {bus1|usd}', tone: 'note' },
        { k: 'line', text: 'Movie {movie0|usd} → {movie1|usd}', tone: 'note' },
        { k: 'big', text: '{inf|spct}', label: 'Basket {b0|usd} → {b1|usd}', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'compare', left: { title: 'Regular bond', lines: ['Pays {nom|pct}'], mark: null },
          right: { title: 'Protected bond', lines: ['Pays {real|pct}', 'plus inflation'], mark: null } },
        { k: 'line', text: '{nom|pct} − {real|pct} = {be|pct} breakeven', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'tree', root: 'What is inside the {be|pct}?', branches: [
          { label: 'Inflation guess', text: 'The main part', tone: 'key' },
          { label: 'Worry pay', text: 'Adds a bit', tone: 'bad' },
          { label: 'Harder to sell', text: 'Takes a bit off', tone: 'good' }
        ] },
        { k: 'stamp', text: 'A clue, not a forecast', tone: 'key' }
      ] }
    ]
  }),

  E('16.3', 'labor_market_rates', {
    title: 'More jobs, higher jobless rate',
    given: { e0: 190, u0: 10, jobs: 45, newLook: 50 },
    calc: {
      lf0: 'e0 + u0',
      ur0: 'u0 / lf0',
      e1: 'e0 + jobs',
      lf1: 'lf0 + newLook',
      u1: 'lf1 - e1',
      ur1: 'u1 / lf1'
    },
    say: [
      'Pine Town has {lf0} people in its workforce: {e0} working and {u0} looking, so unemployment is {ur0|pct}.',
      'This summer, businesses add {jobs} jobs, but {newLook} students also start looking for work.',
      'Now {e1} work out of {lf1}, so {u1} are looking, and unemployment rises to {ur1|pct}, even though jobs went up.',
      'The job count comes from asking businesses, while the rate comes from asking households and divides by everyone in the workforce.',
      'More jobs and a higher jobless rate can both be true.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Working', value: 'e0', text: '{e0}', tone: 'good' },
          { label: 'Looking', value: 'u0', text: '{u0}', tone: 'bad' }
        ] },
        { k: 'line', text: '{u0} ÷ {lf0} = {ur0|pct} unemployed', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'actors', left: { name: 'Businesses', icon: 'company' }, right: { name: 'Job seekers', icon: 'crowd' }, flows: [
          { dir: 'right', text: '{jobs} new jobs' },
          { dir: 'left', text: '{newLook} students start looking' }
        ] },
        { k: 'line', text: 'Working: {e0} + {jobs} = {e1}', tone: 'good', cue: 2 },
        { k: 'line', text: 'Workforce: {lf0} + {newLook} = {lf1}', tone: 'note', cue: 2 },
        { k: 'line', text: 'Looking: {lf1} − {e1} = {u1}', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'big', text: '{ur1|pct}', label: '{u1} ÷ {lf1}, up from {ur0|pct}', tone: 'bad' },
        { k: 'compare', left: { title: 'Job count', lines: ['Asks businesses'], mark: null },
          right: { title: 'Jobless rate', lines: ['Asks households', 'Divides by all'], mark: null } },
        { k: 'stamp', text: 'Both can rise at once', tone: 'key' }
      ] }
    ]
  }),

  E('16.4', 'expectations_surprise', {
    title: 'Only the surprise moves prices',
    given: { expected: 0.0025, actual: 0.005, sens: 5, p0: 100 },
    calc: {
      surprise: 'actual - expected',
      drop: 'sens * surprise',
      p1: 'p0 * (1 - drop)',
      noSurprise: 'actual - actual'
    },
    say: [
      'Everyone expects the Island Central Bank to raise its rate by {expected|pct}, and bond prices already reflect that.',
      'Instead it raises by {actual|pct}, so the surprise is {actual|pct} minus {expected|pct}, which is {surprise|pct}.',
      'Leo\'s pretend bond loses about {sens}% for each 1% of surprise, so it drops about {drop|pct}, from {p0|usd} to {p1|usd}.',
      'Had everyone expected {actual|pct}, the same raise would be no surprise, and the bond would barely move.',
      'Markets move on the surprise, not the headline.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Crowd', icon: 'crowd' }, right: { name: 'Central bank', icon: 'bank' }, flows: [
          { dir: 'right', text: 'We expect {expected|spct}' },
          { dir: 'left', text: 'Decides the rate' }
        ] },
        { k: 'line', text: 'Actual raise: {actual|spct}', tone: 'bad', cue: 1 },
        { k: 'line', text: '{actual|pct} − {expected|pct} = {surprise|pct} surprise', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: '{sens} × {surprise|pct} = {drop|pct} drop', tone: 'key' },
        { k: 'numberLine', marks: [
          { at: 'p1', label: 'After {p1|usd}', tone: 'bad' },
          { at: 'p0', label: 'Before {p0|usd}', tone: 'note' }
        ], dot: { from: 'p0', to: 'p1' } }
      ] },
      { cue: 3, items: [
        { k: 'compare', left: { title: 'Expected {expected|pct}', lines: ['Raise {actual|pct}', 'Surprise {surprise|pct}', 'Bond -{drop|pct}'], mark: null },
          right: { title: 'Expected {actual|pct}', lines: ['Raise {actual|pct}', 'Surprise {noSurprise|pct}', 'Bond about flat'], mark: null } },
        { k: 'stamp', text: 'Surprise moves prices', tone: 'key' }
      ] }
    ]
  }),

  E('16.5', 'fx_translation', {
    title: 'Same sales, fewer dollars',
    given: { crowns: 1000, r0: 1, r1: 0.8, toy: 100 },
    calc: {
      d0: 'crowns * r0',
      d1: 'crowns * r1',
      fall: '1 - d1 / d0',
      t0: 'toy * r0',
      t1: 'toy * r1'
    },
    say: [
      'Comet Cocoa sells cocoa abroad and earns {crowns|num} Crowns, and last year each Crown was worth {r0|usd}, so that was {d0|usd}.',
      'This year the dollar is stronger, and one Crown buys only {r1|usd}, so the same sales bring home just {d1|usd}.',
      'Nothing changed abroad, yet its dollar earnings fell {fall|pct}.',
      'Meanwhile Nia, who imports toys costing {toy} Crowns, now pays {t1|usd} instead of {t0|usd}.',
      'A strong home currency squeezes exporters and helps importers, all else equal.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Comet Cocoa', icon: 'company' }, right: { name: 'Buyers abroad', icon: 'crowd' }, flows: [
          { dir: 'right', text: 'Cocoa' },
          { dir: 'left', text: '{crowns|num} Crowns' }
        ] },
        { k: 'line', text: '{crowns|num} × {r0|usd} = {d0|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'numberLine', marks: [
          { at: 'r1', label: 'Now {r1|usd}', tone: 'bad' },
          { at: 'r0', label: 'Before {r0|usd}', tone: 'note' }
        ], dot: { from: 'r0', to: 'r1' } },
        { k: 'line', text: '{crowns|num} × {r1|usd} = {d1|usd}', tone: 'key' },
        { k: 'line', text: 'Same sales, {fall|pct} fewer dollars', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'compare', left: { title: 'Exporter', lines: ['{d0|usd} → {d1|usd}'], mark: 'cross' },
          right: { title: 'Importer Nia', lines: ['Toy: {t0|usd} → {t1|usd}'], mark: 'check' } },
        { k: 'stamp', text: 'Strong dollar: exporter frowns', tone: 'key' }
      ] }
    ]
  }),

  /* ---------------- Module 17: Statistics and Econometrics ---------------- */

  E('17.1', 'fat_tails', {
    title: 'The tails are fatter than the bell',
    given: { sd: 0.01, k: 3, days: 1000, pTail: 0.00135, obs: 8 },
    calc: {
      big3: 'k * sd',
      expDays: 'pTail * days',
      ratio: 'obs / expDays',
      ratioR: 'round(ratio)'
    },
    say: [
      'Leo\'s pretend fund has a standard wiggle, which statisticians call the standard deviation, of {sd|pct} a day.',
      'A bell-curve model says a drop three of those wiggles big, {big3|pct} or worse, comes only about {expDays} times in {days|num} days.',
      'Leo counts his fund\'s record of {days|num} days and finds {obs} drops that big, about {ratioR} times as many as the model expected.',
      'The typical day looked normal, but the tails were fat.',
      'Averages can hide how often the really bad days come.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Standard wiggle (SD): {sd|pct} a day', tone: 'note' },
        { k: 'line', text: 'Big drop: {k} SDs = {big3|pct} or worse', tone: 'bad', cue: 1 },
        { k: 'line', text: 'Model: {expDays} in {days|num} days', tone: 'note', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'Model', value: 'expDays', text: '{expDays} days', tone: 'note' },
          { label: 'Leo counted', value: 'obs', text: '{obs} days', tone: 'bad' }
        ] },
        { k: 'line', text: '{obs} ÷ {expDays} ≈ {ratioR} times as many', tone: 'key' },
        { k: 'big', text: 'About {ratioR}×', label: 'More big drops than the bell said', tone: 'bad' }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Middle looked normal; tails fat', tone: 'note' },
        { k: 'stamp', text: 'Averages hide the tails', tone: 'bad' }
      ] }
    ]
  }),

  E('17.2', 'confidence_interval', {
    title: 'A range around a guess',
    given: { n1: 25, n2: 100, mean: 0.01, sd: 0.05, conf: 0.95, z: 2, reps: 100 },
    calc: {
      root1: 'sqrt(n1)',
      root2: 'sqrt(n2)',
      se1: 'sd / root1',
      lo1: 'mean - z * se1',
      lo1abs: 'abs(lo1)',
      hi1: 'mean + z * se1',
      se2: 'sd / root2',
      lo2: 'mean - z * se2',
      hi2: 'mean + z * se2',
      hits: 'conf * reps'
    },
    say: [
      'Nia tracks a pretend fund for {n1} months: it averages {mean|pct} a month, with a standard wiggle, or standard deviation, of {sd|pct}.',
      /* The range is spoken as two errors either side, so a listener does not
       * take one error either side (0% to 2%, the 100-month answer). The
       * error is named once as the average's own wiggle, the standard error,
       * so "her error" is never heard as a mistake Nia made. */
      'The average itself wiggles less: its standard error is {sd|pct} divided by the square root of {n1}, or {se1|pct}.',
      'Her {conf|pct} range spans about two errors either side of {mean|pct}: minus {lo1abs|pct} to {hi1|pct}.',
      'With {n2} months, the error halves to {se2|pct} and the range tightens to {lo2|pct} to {hi2|pct}.',
      'The {conf|pct} describes the method: it catches the true average in about {hits} of {reps} repeats.',
      'More data narrows the range, and a bigger wiggle widens it.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{mean|pct}', label: 'Average month, {n1} months', tone: 'key' },
        { k: 'line', text: 'Standard wiggle (SD): {sd|pct}', tone: 'note' },
        { k: 'line', text: 'Standard error: {sd|pct} ÷ √{n1} = {se1|pct}', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Range: {mean|pct} ± {z} × {se1|pct}', tone: 'key' },
        { k: 'numberLine', marks: [
          { at: 'lo1', label: '{lo1|pct}', tone: 'bad' },
          { at: 'mean', label: 'Average {mean|pct}', tone: 'key' },
          { at: 'hi1', label: '{hi1|pct}', tone: 'good' }
        ] }
      ] },
      { cue: 3, items: [
        { k: 'line', text: '{n2} months: {sd|pct} ÷ √{n2} = {se2|pct}', tone: 'key' },
        { k: 'numberLine', marks: [
          { at: 'lo1', label: 'Old {lo1|pct}', tone: 'note' },
          { at: 'lo2', label: 'New {lo2|pct}', tone: 'good' },
          { at: 'hi2', label: 'New {hi2|pct}', tone: 'good' },
          { at: 'hi1', label: 'Old {hi1|pct}', tone: 'note' }
        ] },
        { k: 'line', text: '{conf|pct} = the method\'s hit rate', tone: 'key', cue: 4 },
        { k: 'stamp', text: 'More data, narrower range', tone: 'good' }
      ] }
    ]
  }),

  E('17.3', 'economic_significance', {
    title: 'Real, but not worth it',
    given: { n: 10000, size: 1000, edge: 0.0002, sdPct: 0.005, costPct: 0.0005 },
    calc: {
      gain: 'size * edge',
      sdT: 'size * sdPct',
      root: 'sqrt(n)',
      se: 'sdT / root',
      t: 'gain / se',
      cost: 'size * costPct',
      net: 'gain - cost',
      netAbs: 'abs(net)',
      tot: 'net * n',
      totAbs: 'abs(tot)'
    },
    say: [
      'Leo tests a trading rule on {n|num} trades of {size|usd} each, and it beats chance by just {gain|usd} a trade.',
      'Each trade has a standard wiggle of {sdT|usd}, so the average\'s error is {sdT|usd} divided by {root}, the square root of {n|num}, or {se|usd}.',
      'The edge is {t} times that error, so a result this strong would be very rare if the rule had no real edge.',
      'Here\'s the catch: fees and the spread cost {cost|usd} a trade, so he loses {netAbs|usd} a trade, or {totAbs|usd} in all.',
      'Statistically real is not the same as worth trading.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{gain|susd}', label: 'Edge per {size|usd} trade ({edge|pct})', tone: 'note' },
        { k: 'line', text: 'Tested on {n|num} trades', tone: 'note' },
        { k: 'line', text: 'Error: {sdT|usd} ÷ √{n|num} = {se|usd}', tone: 'key', cue: 1 },
        { k: 'line', text: '{gain|usd} ÷ {se|usd} = {t} → rare by luck', tone: 'good', cue: 2 }
      ] },
      { cue: 3, items: [
        /* Money only flows one way: costs are taken out of Leo's edge. */
        { k: 'actors', left: { name: 'Leo', icon: 'person' }, right: { name: 'Fees + spread', icon: 'bank' }, flows: [
          { dir: 'right', text: 'Pays {cost|usd} a trade' }
        ] },
        { k: 'line', text: 'Edge {gain|usd} − costs {cost|usd} = {net|usd}', tone: 'bad' },
        { k: 'line', text: '{n|num} × {net|usd} = {tot|usd}', tone: 'bad' },
        { k: 'stamp', text: 'Real, but not worth it', tone: 'key' }
      ] }
    ]
  }),

  E('17.4', 'omitted_variable', {
    title: 'The hidden third factor',
    given: { sSmall: 20, sBig: 60, salesSmall: 200, salesBig: 600, b1: 50, b2: 70, sales50: 600, sales70: 600 },
    calc: {
      spotDiff: 'sBig - sSmall',
      salesDiff: 'salesBig - salesSmall',
      slope: 'salesDiff / spotDiff',
      spotDiff2: 'b2 - b1',
      salesDiff2: 'sales70 - sales50',
      slope2: 'salesDiff2 / spotDiff2'
    },
    say: [
      'Omar sees juice stores with {sBig} parking spots selling {salesBig|usd} a day, and stores with {sSmall} spots selling {salesSmall|usd}.',
      'A straight line says each extra spot adds {salesDiff|usd} divided by {spotDiff} spots, or {slope|usd} a spot.',
      'Here\'s the catch: the big-lot stores are all in big towns, where there are simply more shoppers.',
      'Compare two big-town stores with {b1} and {b2} spots: both sell {sales50|usd}, so the extra spots add {slope2|usd}.',
      'Town size was the hidden factor; going together is not the same as causing.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: '{sSmall} spots', value: 'salesSmall', text: '{salesSmall|usd} a day', tone: 'note' },
          { label: '{sBig} spots', value: 'salesBig', text: '{salesBig|usd} a day', tone: 'key' }
        ] },
        { k: 'line', text: '{salesDiff|usd} ÷ {spotDiff} = {slope|usd} a spot?', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'actors', left: { name: 'Town size', icon: 'city' }, right: { name: 'Spots, sales', icon: 'shop' }, flows: [
          { dir: 'right', text: 'Drives both' }
        ] },
        { k: 'line', text: 'Big towns: more spots AND shoppers', tone: 'note' }
      ] },
      { cue: 3, items: [
        { k: 'compare', left: { title: '{b1} spots', lines: ['{sales50|usd} a day'], mark: null },
          right: { title: '{b2} spots', lines: ['{sales70|usd} a day'], mark: null } },
        { k: 'line', text: '({sales70|usd} − {sales50|usd}) ÷ {spotDiff2} = {slope2|usd} a spot', tone: 'bad' },
        { k: 'stamp', text: 'Together ≠ causes', tone: 'key' }
      ] }
    ]
  }),

  E('17.5', 'data_leakage', {
    title: 'Test forward, never shuffled',
    given: { c1: 20, c2: 50, d1: 60, dAll: 100 },
    calc: {
      d61: 'd1 + 1',
      miss: 'c2 - c1',
      missPct: 'miss / c2'
    },
    say: [
      'Maya\'s stand sold about {c1} cups a day for {d1} days, then a heat wave pushed it to about {c2} cups.',
      'If she shuffles all {dAll} days before testing, the model peeks at heat-wave days and looks almost perfect.',
      'Walking forward instead, she trains on days 1 to {d1} and predicts day {d61}.',
      'The model guesses {c1} cups, the real answer is {c2}, so it misses by {miss} cups, a {missPct|pct} error.',
      'When times change, test the way you would really use it: past to future, never shuffled.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Normal days', value: 'c1', text: '{c1} cups', tone: 'note' },
          { label: 'Heat wave', value: 'c2', text: '{c2} cups', tone: 'key' }
        ] },
        { k: 'stamp', text: 'Heat wave: the rules changed', tone: 'bad' }
      ] },
      { cue: 1, items: [
        { k: 'compare', left: { title: 'Shuffled test', lines: ['Sees the future', 'Looks perfect'], mark: 'cross' },
          right: { title: 'Walk-forward test', lines: ['Past only', 'Honest error'], mark: 'check' } },
        { k: 'line', text: 'Train days 1–{d1} → predict day {d61}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Guess {c1}, real {c2}', tone: 'note' },
        { k: 'line', text: '{c2} − {c1} = {miss} cups off', tone: 'bad' },
        { k: 'big', text: '{missPct|pct}', label: 'Honest error: {miss} ÷ {c2}', tone: 'bad' },
        { k: 'line', text: 'Past → future, never shuffled', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* ---------------- Module 18: Financial Reporting and Forensics ---------------- */

  E('18.1', 'revenue_recognition', {
    title: 'Cash day is not revenue day',
    given: { cash: 120, months: 12, m3: 3 },
    calc: {
      per: 'cash / months',
      owed1: 'cash - per',
      rev3: 'm3 * per',
      owed3: 'cash - rev3'
    },
    say: [
      'Leo pays Maya\'s Comic Club {cash|usd} up front for {months} monthly comics.',
      'Maya has all {cash|usd} in cash on day one, but she hasn\'t earned it yet: each comic is worth {per|usd}.',
      'After January\'s comic, she counts {per|usd} as revenue and still owes {owed1|usd} of comics, called deferred revenue.',
      'After three months, revenue so far is {rev3|usd}, and {owed3|usd} is still owed.',
      'Revenue is counted as the work is delivered, not when the cash arrives.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Leo', icon: 'person' }, right: { name: 'Comic Club', icon: 'shop' }, flows: [
          { dir: 'right', text: '{cash|usd} up front' },
          { dir: 'left', text: '{months} comics, one a month' }
        ] },
        { k: 'line', text: '{cash|usd} ÷ {months} = {per|usd} a comic', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Cash in hand: {cash|usd}', tone: 'note' },
        { k: 'bars', items: [
          { label: 'Earned', value: 'per', text: '{per|usd} revenue', tone: 'good' },
          { label: 'Deferred', value: 'owed1', text: '{owed1|usd} owed', tone: 'note' }
        ] },
        { k: 'line', text: '{m3} × {per|usd} = {rev3|usd} earned', tone: 'good', cue: 3 },
        { k: 'line', text: '{cash|usd} − {rev3|usd} = {owed3|usd} still owed', tone: 'note', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'bars', items: [
          { label: 'Earned', value: 'rev3', text: '{rev3|usd} revenue', tone: 'good' },
          { label: 'Deferred', value: 'owed3', text: '{owed3|usd} owed', tone: 'note' }
        ] },
        { k: 'stamp', text: 'Cash day ≠ revenue day', tone: 'key' }
      ] }
    ]
  }),

  E('18.2', 'inventory_working_capital', {
    title: 'Toys piling up on the shelf',
    given: { s0: 1000, s1: 1100, i0: 200, i1: 300 },
    calc: {
      gs: 's1 / s0 - 1',
      gi: 'i1 / i0 - 1',
      stuck: 'i1 - i0'
    },
    say: [
      'Kite Corner Toys grew sales from {s0|usd} to {s1|usd}, up {gs|pct}, but its unsold toys grew from {i0|usd} to {i1|usd}, up {gi|pct}.',
      'That extra {stuck|usd} of toys is {stuck|usd} of cash sitting on shelves instead of in the bank.',
      'Nia asks why before judging.',
      'Stocking up for a holiday rush can be fine, but toys nobody wants may be marked down later, and that cuts profit.',
      'Inventory racing ahead of sales is a question, not an answer.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Sales: {s0|usd} → {s1|usd}', tone: 'note' },
        { k: 'line', text: 'Unsold toys: {i0|usd} → {i1|usd}', tone: 'note' },
        { k: 'bars', items: [
          { label: 'Sales', value: 'gs', text: '{gs|spct}', tone: 'note' },
          { label: 'Inventory', value: 'gi', text: '{gi|spct}', tone: 'bad' }
        ] }
      ] },
      { cue: 1, items: [
        { k: 'actors', left: { name: 'Cash', icon: 'coin' }, right: { name: 'Toy shelves', icon: 'shop' }, flows: [
          { dir: 'right', text: '{stuck|usd} stuck as toys' }
        ] },
        { k: 'line', text: '{i1|usd} − {i0|usd} = {stuck|usd} tied up', tone: 'key' },
        { k: 'line', text: 'Nia asks why before judging', tone: 'note', cue: 2 }
      ] },
      /* The two possible answers appear with the sentence that gives them,
       * and the takeaway with its own sentence. */
      { cue: 3, items: [
        { k: 'tree', root: 'Why did toys pile up?', branches: [
          { label: 'Holiday stock-up', text: 'Could be fine', tone: 'good' },
          { label: 'Nobody wants them', text: 'Markdown cuts profit', tone: 'bad' }
        ] },
        { k: 'line', text: 'A question, not an answer', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('18.3', 'capitalize_vs_expense', {
    title: 'Profit now, bill later',
    given: { earn: 2000, oven: 3000, life: 3 },
    calc: {
      dep: 'oven / life',
      y1Exp: 'earn - oven',
      lossAbs: 'abs(y1Exp)',
      cap: 'earn - dep',
      total: 'y1Exp + earn * (life - 1)',
      bv1: 'oven - dep'
    },
    say: [
      'Omar\'s bakery earns {earn|usd} a year and buys a {oven|usd} oven that lasts {life} years.',
      'Count the oven as a cost right away, and year one shows a loss of {lossAbs|usd}, then {earn|usd} in each later year.',
      /* The yearly cost and the yearly profit are both $1,000, so the
       * subtraction is spoken and the board labels which is which. */
      'Spread the cost at {dep|usd} a year instead, and each year\'s profit is {earn|usd} minus {dep|usd}, or {cap|usd}.',
      /* The $3,000 is total profit over the years (the oven's price is also
       * $3,000), so the sentence names what is being totalled. */
      'Both ways, the {life} years\' profit totals {total|usd}, but spreading leaves {bv1|usd} on the books, written off at once if the oven breaks early.',
      'Spreading lifts this year\'s profit and pushes the cost into later years.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{oven|usd}', label: 'Oven that lasts {life} years', tone: 'key' },
        { k: 'line', text: 'Bakery earns {earn|usd} a year', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Yr 1 profit', value: 'y1Exp', text: '{y1Exp|usd}', tone: 'bad' },
          { label: 'Yr 2 profit', value: 'earn', text: '{earn|usd}', tone: 'good' },
          { label: 'Yr 3 profit', value: 'earn', text: '{earn|usd}', tone: 'good' }
        ] },
        { k: 'line', text: '{earn|usd} − {oven|usd} = {y1Exp|usd}', tone: 'bad' }
      ] },
      { cue: 2, items: [
        { k: 'bars', items: [
          { label: 'Yr 1 profit', value: 'cap', text: '{cap|usd}', tone: 'good' },
          { label: 'Yr 2 profit', value: 'cap', text: '{cap|usd}', tone: 'good' },
          { label: 'Yr 3 profit', value: 'cap', text: '{cap|usd}', tone: 'good' }
        ] },
        { k: 'line', text: 'Cost: {oven|usd} ÷ {life} = {dep|usd} a year', tone: 'key' },
        { k: 'line', text: 'Both ways: {total|usd} profit in {life} yrs', tone: 'note', cue: 3 },
        { k: 'line', text: 'Breaks early: {bv1|usd} written off', tone: 'bad', cue: 3 },
        { k: 'line', text: 'Higher profit now, cost later', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('18.4', 'hidden_leverage', {
    title: 'Debts that hide off the loan line',
    /* Lease-adjusted (EBITDAR-style) leverage: once future rent counts as
     * debt, the yearly rent is added back to earnings, so the rent is not
     * counted twice. */
    given: { debt: 100, earn: 100, rent: 20, lease: 150, pension: 50 },
    calc: {
      lev1: 'debt / earn',
      claims: 'debt + lease + pension',
      beforeRent: 'earn + rent',
      lev2: 'claims / beforeRent'
    },
    say: [
      'Bright Kettle shows just {debt|usd} of bank debt and earns {earn|usd} a year after rent, so its debt looks like only {lev1} year of earnings.',
      'But it also signed ten years of store rent at {rent|usd} a year, worth {lease|usd} in today\'s money, and owes workers pensions worth {pension|usd}.',
      'Add them up: {debt|usd} plus {lease|usd} plus {pension|usd} is {claims|usd} of promises to pay.',
      'Since rent now counts as debt, add the {rent|usd} rent back to earnings: {claims|usd} divided by {beforeRent|usd} is {lev2} years, not {lev1}.',
      'Count every promise to pay, not just the loans.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Bank debt: {debt|usd}', tone: 'note' },
        { k: 'line', text: 'Earnings after rent: {earn|usd}', tone: 'note' },
        { k: 'big', text: '{lev1|x}', label: 'Debt ÷ earnings: looks light', tone: 'good' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Bank debt', value: 'debt', text: '{debt|usd}', tone: 'note' },
          { label: 'Rent', value: 'lease', text: '{lease|usd}', tone: 'bad' },
          { label: 'Pensions', value: 'pension', text: '{pension|usd}', tone: 'bad' }
        ] },
        { k: 'line', text: '{debt|usd} + {lease|usd} + {pension|usd} = {claims|usd}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Add back rent: {earn|usd} + {rent|usd} = {beforeRent|usd}', tone: 'note' },
        { k: 'big', text: '{lev2|x}', label: '{claims|usd} ÷ {beforeRent|usd} a year', tone: 'bad' },
        { k: 'line', text: '{lev1|x} on the page → {lev2|x} for real', tone: 'key' },
        { k: 'stamp', text: 'Count every promise to pay', tone: 'key' }
      ] }
    ]
  }),

  E('18.5', 'forensic_red_flag', {
    title: 'A red flag is a question',
    given: { profit: 500, cash: -100, ar0: 200, ar1: 800 },
    calc: {
      gap: 'profit - cash',
      cashAbs: 'abs(cash)',
      arUp: 'ar1 - ar0'
    },
    say: [
      'Glow Lamp reports {profit|usd} of profit this year, yet its operating cash flow was minus {cashAbs|usd}, a gap of {gap|usd}.',
      'Unpaid customer bills jumped from {ar0|usd} to {ar1|usd}, which is exactly that {gap|usd}.',
      'Nia doesn\'t shout fraud; she checks who the customers are and whether they paid after the year ended.',
      'If real customers paid in January, it was timing; a buyer that exists only on paper is a real problem.',
      /* A takeaway in the example's own words, not the knowledge check's. */
      'The gap tells Nia where to look, not what happened.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Profit', value: 'profit', text: '{profit|susd}', tone: 'good' },
          { label: 'Cash flow', value: 'cash', text: '{cash|susd}', tone: 'bad' }
        ] },
        { k: 'line', text: '{profit|usd} − ({cash|usd}) = {gap|usd} gap', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Unpaid bills: {ar0|usd} → {ar1|usd}', tone: 'note' },
        { k: 'line', text: '{ar1|usd} − {ar0|usd} = {arUp|usd} = the gap', tone: 'key' },
        { k: 'big', text: '{gap|usd}', label: 'Profit not yet collected', tone: 'bad' },
        { k: 'line', text: 'Nia checks: who, and did they pay?', tone: 'note', cue: 2 }
      ] },
      /* The two possible answers appear with the sentence that gives them. */
      { cue: 3, items: [
        { k: 'tree', root: 'Nia checks the {gap|usd}', branches: [
          { label: 'Paid in January', text: 'Just timing', tone: 'good' },
          { label: 'Paper-only buyer', text: 'Real problem', tone: 'bad' }
        ] },
        { k: 'line', text: 'Where to look, not what happened', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* ---------------- Module 19: Corporate Finance and Capital Allocation ---------------- */

  E('19.1', 'sunk_cost_npv', {
    title: 'Sunk money stays sunk',
    given: { sunk: 500, cost: 1000, cf: 600, years: 2, r: 0.1 },
    calc: {
      d1: '1 + r',
      d2: '(1 + r) ^ 2',
      pv1: 'cf / d1',
      pv2: 'cf / d2',
      pv: 'pv1 + pv2',
      npv: 'pv - cost',
      wrong: 'npv - sunk',
      wrongAbs: 'abs(wrong)'
    },
    say: [
      'Maya already paid {sunk|usd} for a food-truck study, and that money is gone whatever she decides.',
      'Now a truck costs {cost|usd} and is expected to bring in {cf|usd} a year for {years} years, with money worth {r|pct} a year to her.',
      'In today\'s money, those payments are worth about {pv|usdr}, so the truck adds about {npv|usdr} of value.',
      'Subtracting the old {sunk|usd} would show a loss of about {wrongAbs|usdr} and scare her away from a project that adds value.',
      'Only future cash that changes with the decision counts.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'stamp', text: 'Sunk: {sunk|usd} already gone', tone: 'note' },
        { k: 'line', text: 'Not part of the decision', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'actors', left: { name: 'Maya', icon: 'person' }, right: { name: 'Food truck', icon: 'shop' }, flows: [
          { dir: 'right', text: '{cost|usd} today' },
          { dir: 'left', text: '{cf|usd} a year for {years} years' }
        ] },
        { k: 'line', text: '{cf|usd} ÷ {d1} = {pv1|usd}', tone: 'key', cue: 2 },
        { k: 'line', text: '{cf|usd} ÷ {d2} = {pv2|usd}', tone: 'key', cue: 2 },
        { k: 'line', text: '{pv|usd} − {cost|usd} = {npv|susd}', tone: 'good', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'compare', left: { title: 'Future cash only', lines: ['{pv|usd}', '− {cost|usd}', '= {npv|susd}'], mark: 'check' },
          right: { title: 'Counting the study', lines: ['{npv|susd}', '− {sunk|usd}', '= {wrong|usd}'], mark: 'cross' } },
        { k: 'big', text: '{npv|susd}', label: 'Value the truck adds', tone: 'good' },
        { k: 'line', text: 'Only cash the decision changes', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('19.2', 'wacc', {
    title: 'One rate does not fit every project',
    given: { we: 0.6, re: 0.1, wd: 0.4, rd: 0.05, tax: 0.2, cost: 102, pay: 112, rp: 0.12 },
    calc: {
      rdAt: 'rd * (1 - tax)',
      wacc: 'we * re + wd * rdAt',
      d1: '1 + wacc',
      v1: 'pay / d1',
      g1: 'v1 - cost',
      d2: '1 + rp',
      v2: 'pay / d2',
      n2: 'v2 - cost',
      l2: 'abs(n2)'
    },
    say: [
      'Harbor Bikes gets {we|pct} of its money from owners who want {re|pct} a year.',
      'The other {wd|pct} is loans at {rd|pct}, but with a {tax|pct} tax rate, interest cuts taxes, so they really cost {rdAt|pct}.',
      'Blended, that is {we|pct} of {re|pct} plus {wd|pct} of {rdAt|pct}, or {wacc|pct}.',
      'A risky scooter project costs {cost|usd} and hopes to pay {pay|usd} in a year.',
      'At {wacc|pct} it seems worth about {v1|usdr}, but at a {rp|pct} rate that fits its risk, it is worth {v2|usd}, a loss of {l2|usd}.',
      'Riskier projects need their own, higher rate.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: 'Owners {we|pct}: want {re|pct}', tone: 'key' },
        { k: 'line', text: 'Loans {wd|pct}: {rd|pct} → {rdAt|pct} after tax', tone: 'note', cue: 1 },
        { k: 'line', text: '{rd|pct} × (1 − {tax|pct}) = {rdAt|pct}', tone: 'note', cue: 1 },
        { k: 'line', text: '{we} × {re|pct} + {wd} × {rdAt|pct} = {wacc|pct}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'actors', left: { name: 'Harbor Bikes', icon: 'company' }, right: { name: 'Scooters', icon: 'shop' }, flows: [
          { dir: 'right', text: '{cost|usd} today' },
          { dir: 'left', text: 'Hoped {pay|usd} in a year' }
        ] },
        { k: 'line', text: 'Riskier than the average project', tone: 'note' }
      ] },
      { cue: 4, items: [
        { k: 'compare', left: { title: 'Company rate {wacc|pct}', lines: ['{pay|usd} ÷ (1 + {wacc|pct})', '= {v1|usd}', 'Looks like {g1|susd}'], mark: 'cross' },
          right: { title: 'Risk rate {rp|pct}', lines: ['{pay|usd} ÷ (1 + {rp|pct})', '= {v2|usd}', 'Really {n2|usd}'], mark: 'check' } },
        { k: 'stamp', text: 'Match the rate to the risk', tone: 'key' }
      ] }
    ]
  }),

  E('19.3', 'leverage_scenarios', {
    title: 'Debt makes the swings bigger',
    given: { need: 1000, loan: 500, rate: 0.1, good: 150, bad: 30 },
    calc: {
      eqB: 'need - loan',
      interest: 'loan * rate',
      aGood: 'good / need',
      bGoodAmt: 'good - interest',
      bGood: 'bGoodAmt / eqB',
      aBad: 'bad / need',
      bBadAmt: 'bad - interest',
      bBad: 'bBadAmt / eqB',
      bBadAbs: 'abs(bBad)'
    },
    say: [
      'Sunny Juice needs {need|usd}: plan A uses only owners\' money, and plan B borrows {loan|usd} at {rate|pct}, or {interest|usd} of interest a year.',
      'In a good year the business makes {good|usd}, so plan A owners earn {aGood|pct}, but plan B owners keep {bGoodAmt|usd} on their {eqB|usd}, or {bGood|pct}.',
      'In a bad year it makes only {bad|usd}: plan A still earns {aBad|pct}, but plan B can\'t cover its {interest|usd} of interest and loses {bBadAbs|pct}.',
      'Debt makes good years better and bad years worse, so the right amount balances both.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'compare', left: { title: 'Plan A', lines: ['Owners {need|usd}', 'No loan'], mark: null },
          right: { title: 'Plan B', lines: ['Owners {eqB|usd}', 'Loan {loan|usd} at {rate|pct}', 'Interest {interest|usd}/yr'], mark: null } }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'A: {good|usd} ÷ {need|usd} = {aGood|pct}', tone: 'good' },
        { k: 'line', text: 'B: ({good|usd} − {interest|usd}) ÷ {eqB|usd} = {bGood|pct}', tone: 'good' },
        { k: 'line', text: 'B: ({bad|usd} − {interest|usd}) ÷ {eqB|usd} = {bBad|pct}', tone: 'bad', cue: 2 },
        { k: 'bars', items: [
          { label: 'A, good', value: 'aGood', text: '{aGood|pct}', tone: 'good' },
          { label: 'B, good', value: 'bGood', text: '{bGood|pct}', tone: 'good' }
        ] }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'A, good', value: 'aGood', text: '{aGood|pct}', tone: 'good' },
          { label: 'B, good', value: 'bGood', text: '{bGood|pct}', tone: 'good' },
          { label: 'A, bad', value: 'aBad', text: '{aBad|pct}', tone: 'note' },
          { label: 'B, bad', value: 'bBad', text: '{bBad|pct}', tone: 'bad' }
        ] },
        { k: 'stamp', text: 'Balance, not maximum debt', tone: 'key' }
      ] }
    ]
  }),

  E('19.4', 'buyback_dilution', {
    title: 'A buyback that adds shares',
    given: { s0: 1000, bb: 50, px: 20, newS: 60, mine: 100 },
    calc: {
      spend: 'bb * px',
      s1: 's0 - bb + newS',
      net: 's1 - s0',
      own0: 'mine / s0',
      own1: 'mine / s1'
    },
    say: [
      'Willow Books has {s0|num} shares and spends {spend|usd} buying back {bb} of them at {px|usd} each.',
      'Sounds like fewer shares, but it also hands employees {newS} new shares as pay.',
      'So the count goes {s0|num} minus {bb} plus {newS}, which is {s1|num}, or {net} more than before.',
      'Maya\'s {mine} shares slip from owning {own0|pct} of the company to {own1|pct}.',
      'Check the net share count, not just the buyback headline.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'actors', left: { name: 'Willow Books', icon: 'company' }, right: { name: 'Sellers', icon: 'crowd' }, flows: [
          { dir: 'right', text: '{spend|usd} cash' },
          { dir: 'left', text: '{bb} shares back' }
        ] },
        { k: 'line', text: '{bb} × {px|usd} = {spend|usd}', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'actors', left: { name: 'Willow Books', icon: 'company' }, right: { name: 'Employees', icon: 'crowd' }, flows: [
          { dir: 'right', text: '{newS} new shares as pay' }
        ] },
        { k: 'line', text: '{s0|num} − {bb} + {newS} = {s1|num} shares', tone: 'key', cue: 2 },
        { k: 'line', text: 'Net change: {net|snum} shares', tone: 'bad', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'bars', items: [
          { label: 'Before', value: 'own0', text: '{own0|pct}', tone: 'note' },
          { label: 'After', value: 'own1', text: '{own1|pct}', tone: 'bad' }
        ] },
        { k: 'line', text: '{mine} ÷ {s1|num} = {own1|pct}', tone: 'key' },
        { k: 'stamp', text: 'Check the NET share count', tone: 'key' }
      ] }
    ]
  }),

  E('19.5', 'accretion_vs_value', {
    title: 'Earnings up, value down',
    given: { e0: 100, sh: 100, price: 200, rd: 0.03, ec: 10, req: 0.08 },
    calc: {
      eps0: 'e0 / sh',
      interest: 'price * rd',
      e1: 'e0 + ec - interest',
      eps1: 'e1 / sh',
      val: 'ec / req',
      lost: 'price - val'
    },
    /* $10 divided by 8% values the cafe only if the $10 comes every year
     * forever with no growth, so that condition is spoken. */
    say: [
      'Big Bakery earns {e0|usd} a year with {sh} shares, so {eps0|usd} a share.',
      'It borrows {price|usd} at {rd|pct} to buy Tiny Cafe, which earns {ec|usd}: {e0|usd} plus {ec|usd} minus {interest|usd} of interest is {e1|usd}.',
      'Earnings per share rise to {eps1|usd}, which looks like a win.',
      'But owners need {req|pct} a year, so if the cafe earns {ec|usd} every year forever, it is worth {ec|usd} divided by {req|pct}, or {val|usd}.',
      'So paying {price|usd} wastes {lost|usd}: higher earnings per share do not mean more value, and taxes are ignored here.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: '{e0|usd} ÷ {sh} shares = {eps0|usd} a share', tone: 'note' }
      ] },
      { cue: 1, items: [
        { k: 'actors', left: { name: 'Big Bakery', icon: 'company' }, right: { name: 'Tiny Cafe', icon: 'shop' }, flows: [
          { dir: 'right', text: '{price|usd}, borrowed at {rd|pct}' },
          { dir: 'left', text: '{ec|usd} a year of earnings' }
        ] },
        { k: 'line', text: '{e0|usd} + {ec|usd} − {interest|usd} = {e1|usd}', tone: 'key' },
        { k: 'line', text: '{e1|usd} ÷ {sh} = {eps1|usd} a share', tone: 'good', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'compare', left: { title: 'Worth', lines: ['{ec|usd} ÷ {req|pct}', '= {val|usd}'], mark: null },
          right: { title: 'Paid', lines: ['{price|usd}'], mark: null } },
        { k: 'line', text: 'Forever, no growth: a simple case', tone: 'note' },
        { k: 'line', text: '{price|usd} − {val|usd} = {lost|usd} thrown away', tone: 'bad', cue: 4 },
        { k: 'line', text: 'EPS up ≠ value up (no taxes)', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  /* ---------------- Module 20: Asset Pricing and Valuation ---------------- */

  E('20.1', 'capm_beta', {
    title: 'Beta is a sensitivity',
    given: { mMove: 0.04, kMove: 0.06, rf: 0.03, rm: 0.08, beta2: 0.5 },
    calc: {
      beta: 'kMove / mMove',
      prem: 'rm - rf',
      capm: 'rf + beta * prem',
      capm2: 'rf + beta2 * prem'
    },
    say: [
      'When the whole market moves {mMove|pct}, Zoom Kite tends to move {kMove|pct}, so its beta, its sensitivity to the market, is {beta}.',
      'With a safe rate of {rf|pct} and the market expected to earn {rm|pct}, the extra pay for market risk is {prem|pct}.',
      'The model expects Zoom Kite to earn {rf|pct} plus {beta} times {prem|pct}, or {capm|pct}.',
      'Pillow Mills has a beta of only {beta2}, for {capm2|pct}, but if its only factory floods, it can still fall hard.',
      'Beta measures moving with the market, not every way to lose money.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'bars', items: [
          { label: 'Market', value: 'mMove', text: 'Moves {mMove|pct}', tone: 'note' },
          { label: 'Zoom Kite', value: 'kMove', text: 'Moves {kMove|pct}', tone: 'key' }
        ] },
        { k: 'line', text: '{kMove|pct} ÷ {mMove|pct} = beta {beta}', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Market extra: {rm|pct} − {rf|pct} = {prem|pct}', tone: 'note' },
        { k: 'line', text: '{rf|pct} + {beta} × {prem|pct} = {capm|pct}', tone: 'key', cue: 2 }
      ] },
      { cue: 3, items: [
        { k: 'line', text: 'Pillow: {rf|pct} + {beta2} × {prem|pct} = {capm2|pct}', tone: 'note' },
        { k: 'compare', left: { title: 'Pillow Mills', lines: ['Beta {beta2}', 'Model: {capm2|pct}'], mark: null },
          right: { title: 'Its one factory', lines: ['Flood risk', 'Not in beta'], mark: 'cross' } },
        { k: 'stamp', text: 'Low beta ≠ low risk of loss', tone: 'bad' },
        { k: 'line', text: 'Beta = moves with the market', tone: 'key', cue: 4 }
      ] }
    ]
  }),

  E('20.2', 'factor_attribution', {
    title: 'Splitting a gain into pieces',
    given: { total: 0.12, mkt: 0.08, bM: 1, size: 0.02, bS: 0.5, value: 0.04, bV: 0.5 },
    calc: {
      pMkt: 'bM * mkt',
      pSize: 'bS * size',
      pValue: 'bV * value',
      expl: 'pMkt + pSize + pValue',
      resid: 'total - expl'
    },
    say: [
      'Nia\'s pretend portfolio gained {total|pct}, and a factor model splits it into pieces.',
      'It moves one for one with the market, which rose {mkt|pct}, so that piece is {pMkt|pct}.',
      'Small companies beat big ones by {size|pct}, and her half tilt toward them adds {pSize|pct}.',
      'Cheap stocks beat pricey ones by {value|pct}, and her half tilt toward them adds {pValue|pct}.',
      'That explains {expl|pct}, leaving {resid|pct} that could be skill or luck.',
      'If crowds pile into cheap stocks, that piece can flip negative: labels describe exposure, not a promise.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{total|pct}', label: 'Nia\'s gain this year', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'line', text: 'Market: {bM} × {mkt|pct} = {pMkt|pct}', tone: 'key' },
        { k: 'line', text: 'Small: {bS} × {size|pct} = {pSize|pct}', tone: 'key', cue: 2 },
        { k: 'line', text: 'Cheap: {bV} × {value|pct} = {pValue|pct}', tone: 'key', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'bars', items: [
          { label: 'Market', value: 'pMkt', text: '{pMkt|pct}', tone: 'key' },
          { label: 'Small', value: 'pSize', text: '{pSize|pct}', tone: 'key' },
          { label: 'Cheap', value: 'pValue', text: '{pValue|pct}', tone: 'key' },
          { label: 'Leftover', value: 'resid', text: '{resid|pct}', tone: 'note' }
        ] },
        { k: 'line', text: '{total|pct} − {expl|pct} = {resid|pct}: skill or luck?', tone: 'note' },
        { k: 'stamp', text: 'Labels, not promises', tone: 'key' },
        { k: 'line', text: 'Crowded tilts can flip', tone: 'bad', cue: 5 }
      ] }
    ]
  }),

  E('20.3', 'residual_income', {
    title: 'Clearing the owners\' bar',
    given: { book: 1000, re: 0.1, e1: 80, e2: 150 },
    calc: {
      charge: 'book * re',
      ri1: 'e1 - charge',
      shortAbs: 'abs(ri1)',
      pvShort: 'ri1 / re',
      pvShortAbs: 'abs(pvShort)',
      v1: 'book + pvShort',
      ri2: 'e2 - charge',
      pv2: 'ri2 / re',
      v2: 'book + pv2'
    },
    say: [
      'Maya\'s bakery uses {book|usd} of the owners\' money, and they want {re|pct} a year: a bar of {charge|usd}.',
      'This year it earns {e1|usd}, a real profit but {shortAbs|usd} below the bar: residual income of minus {shortAbs|usd}.',
      'Falling {shortAbs|usd} short every year, forever, costs {shortAbs|usd} divided by {re|pct}, or {pvShortAbs|usd}, in today\'s money.',
      'So the bakery is worth {book|usd} minus {pvShortAbs|usd}, or just {v1|usd}.',
      'Earning {e2|usd} instead would clear the bar by {ri2|usd}, making it worth {v2|usd}.',
      'Profit creates value only when it beats what the owners\' money could earn elsewhere.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'line', text: '{book|usd} × {re|pct} = {charge|usd} a year', tone: 'key' },
        { k: 'big', text: '{charge|usd}', label: 'The bar: profit owners need', tone: 'key' }
      ] },
      { cue: 1, items: [
        { k: 'bars', items: [
          { label: 'Profit', value: 'e1', text: '{e1|usd}', tone: 'good' },
          { label: 'The bar', value: 'charge', text: '{charge|usd}', tone: 'key' }
        ] },
        { k: 'line', text: '{e1|usd} − {charge|usd} = {ri1|usd} a year', tone: 'bad' },
        { k: 'line', text: '{ri1|usd} ÷ {re|pct} = {pvShort|usd} forever', tone: 'bad', cue: 2 },
        { k: 'line', text: '{book|usd} − {pvShortAbs|usd} = {v1|usd}', tone: 'bad', cue: 3 }
      ] },
      { cue: 4, items: [
        { k: 'compare', left: { title: 'Earns {e1|usd}', lines: ['{ri1|usd} a year', 'Worth {v1|usd}'], mark: 'cross' },
          right: { title: 'Earns {e2|usd}', lines: ['{ri2|susd} a year', 'Worth {v2|usd}'], mark: 'check' } },
        { k: 'stamp', text: 'Profit ≠ value created', tone: 'key' },
        { k: 'line', text: 'Forever, no growth: a simple case', tone: 'note' }
      ] }
    ]
  }),

  E('20.4', 'real_option', {
    title: 'The value of being able to stop',
    given: { test: 100, build: 200, vGood: 500, vBad: 100, half: 0.5 },
    calc: {
      spend: 'test + build',
      ev: 'half * vGood + (1 - half) * vBad',
      committed: 'ev - spend',
      goodNet: 'vGood - build',
      flex: '-test + half * goodNet + (1 - half) * 0',
      optVal: 'flex - committed'
    },
    say: [
      'Leo can test a pretend fun park for {test|usd}, then build it fully for {build|usd} more.',
      'Half the time the town loves it and the park is worth {vGood|usd}; half the time it is worth only {vBad|usd}.',
      'Building no matter what gives {half|pct} of {vGood|usd} plus {half|pct} of {vBad|usd}, or {ev|usd}, minus {spend|usd} spent, which is {committed|usd}.',
      'If he can stop after the test, he builds only in the good case and expects a gain of {flex|usd}.',
      'That {optVal|usd} is the value of the choice to stop, ignoring the time value of money.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'steps', items: ['Test {test|usd}', 'See demand', 'Build {build|usd}?'] },
        { k: 'line', text: 'Loves it ({half|pct}): worth {vGood|usd}', tone: 'good', cue: 1 },
        { k: 'line', text: 'Meh ({half|pct}): worth {vBad|usd}', tone: 'bad', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Must build: all {spend|usd} spent', tone: 'note' },
        { k: 'line', text: '{half|pct} × {vGood|usd} + {half|pct} × {vBad|usd} = {ev|usd}', tone: 'note' },
        { k: 'line', text: '{ev|usd} − {spend|usd} = {committed|usd}', tone: 'bad' }
      ] },
      { cue: 3, items: [
        { k: 'tree', root: 'Can stop after the test', branches: [
          { label: 'Loves it: build', text: '{vGood|usd} − {build|usd} = {goodNet|usd}', tone: 'good' },
          { label: 'Meh: stop', text: 'Spend nothing more', tone: 'note' }
        ] },
        { k: 'line', text: '-{test|usd} + {half|pct} × {goodNet|usd} = {flex|usd}', tone: 'key' },
        { k: 'big', text: '{optVal|susd}', label: 'Value of the choice to stop', tone: 'good' },
        { k: 'line', text: 'No discounting, to keep it simple', tone: 'note', cue: 4 }
      ] }
    ]
  }),

  /* 20.5 The buyers' 8% return and the 10% profit margin differ, and so do
   * the $1,250 price and the $1,000 sales road, so no sum on the board is
   * printed twice with two meanings. */
  E('20.5', 'reverse_valuation', {
    title: 'What is the price assuming?',
    given: { price: 1250, req: 0.08, sales: 500, margin: 0.1 },
    calc: {
      need: 'price * req',
      now: 'sales * margin',
      mult: 'need / now',
      sales2: 'need / margin',
      margin2: 'need / sales'
    },
    say: [
      'Say all of Seashell Snacks is priced at {price|usd}, and buyers want {req|pct} a year back.',
      /* "Flat" would mean today's $50; the case is a steady $100 a year. */
      'To be worth {price|usd} with the same profit every year forever, it needs {price|usd} times {req|pct}, or {need|usd} a year.',
      'Today it earns {now|usd}, a {margin|pct} profit margin on {sales|usd} of sales, so the price quietly assumes profit doubles.',
      'That could mean sales growing to {sales2|usd} at the same margin, or the margin rising to {margin2|pct}.',
      'Working backward shows what the price expects; the real question is whether that is believable.'
    ],
    frames: [
      { cue: 0, items: [
        { k: 'big', text: '{price|usd}', label: 'Price for the whole business', tone: 'note' },
        { k: 'line', text: '{price|usd} × {req|pct} = {need|usd} a year', tone: 'key', cue: 1 }
      ] },
      { cue: 2, items: [
        { k: 'line', text: 'Today: {sales|usd} × {margin|pct} = {now|usd}', tone: 'note' },
        { k: 'bars', items: [
          { label: 'Today', value: 'now', text: '{now|usd} profit', tone: 'note' },
          { label: 'Price needs', value: 'need', text: '{need|usd} profit', tone: 'key' }
        ] },
        { k: 'big', text: '{mult|x}', label: 'Profit the price assumes', tone: 'key' }
      ] },
      { cue: 3, items: [
        { k: 'tree', root: 'Two roads to {need|usd}', branches: [
          { label: 'Double sales', text: '{sales2|usd} × {margin|pct} = {need|usd}', tone: 'key' },
          { label: 'Double margin', text: '{sales|usd} × {margin2|pct} = {need|usd}', tone: 'key' }
        ] },
        { k: 'line', text: 'Same profit forever: a simple case', tone: 'note' },
        { k: 'line', text: 'Is that believable?', tone: 'key', cue: 4 }
      ] }
    ]
  })
];
