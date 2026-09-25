'use strict';

/* Street Smarts lessons (module 29), file d: lessons 19 to 24.
 *
 * Value vs index, active vs passive, dividends vs index funds, the dividend
 * trap, lump sum vs dollar-cost averaging, and buying the dip vs steady buying.
 * Original Academy material with made-up people and businesses. Educational
 * only: no advice, no promises, no real companies, funds or indexes. Where a
 * rule differs by country the lesson says so. Same lesson shape as start-here. */

const { simulationFor } = require('../simulations');

const FOUNDATION_COLOR = 0x00E676; // LEVEL_COLOR.Foundation in curriculum.js
const DURATION = '10 min';

function L(lessonId, title, description, steps, prompt, options, correct, explanation) {
  const lesson = {
    moduleId: 29,
    lessonId,
    title,
    description,
    duration: DURATION,
    level: 'Foundation',
    color: FOUNDATION_COLOR,
    steps,
    question: { prompt, options, correct, explanation }
  };
  lesson.simulation = simulationFor(lesson);
  return lesson;
}

module.exports = [
  L(19, 'Value Investing vs Index Investing',
    'Two ways to shop for shares: hunt for bargains or buy the whole list.', [
      'Picture two shoppers. One digs through a thrift store rack for a jacket priced far below what it is worth. That is a value investor: someone who hunts for a company priced under what they think it is really worth, then waits. The other shopper buys the whole rack, duds included. That is an index investor. An index is a list of companies, and an index fund buys everything on the list, so you get the average result.',
      'Each way asks something different of you. The bargain hunter needs homework, since a fair price is only an estimate, plus the nerve to hold while the crowd disagrees. A cheap price can also be cheap for a good reason. The list buyer needs far less homework and gets the average, never more. Neither way is promised to work, because a whole list can drop and stay low for years.',
      'Practice lab: Ravi finds a laundromat company priced at $60 a share that he judges is worth $90, and Nia buys a fund holding 100 companies. Write down what Ravi must be right about, what Nia must accept, and one way each could lose.'
    ],
    'Ravi buys shares he believes are priced under their worth. Nia buys a fund of a whole list. What does Ravi\'s way rely on that Nia\'s does not?',
    {
      A: 'Confirmation from the market that cheap shares must bounce back',
      B: 'His own estimate of fair worth, which could turn out to be wrong',
      C: 'Owning fewer companies so that one bad result cannot hurt him',
      D: 'Payment from the fund if his shares stay cheap for years'
    }, 'B',
    'Value investing rests on your own estimate of what a business is worth, and estimates can be wrong. The list buyer skips that judgment and accepts the average, with no promise either way.'),

  L(20, 'Active vs Passive: The Cost of Trying',
    'Fees, taxes and trading costs are the price of trying to beat a list.', [
      'Passive means buying a fund that copies a list of companies and mostly leaving it alone. Active means a manager picks shares and trades often, trying to beat that list. Trying has a price tag. There are fees, a yearly slice of your pile taken by the fund. There are trading costs each time shares change hands. In many countries, selling at a profit can also trigger tax, and the rules differ by country.',
      'These costs come out whether the manager is right or wrong. They are like a landlord collecting on the first of the month, however the week went. So the manager must beat the list by at least the costs just to tie. Over long stretches, many active managers trail their list after costs. Some do not, and it is hard to spot them beforehand. A great past run is no promise.',
      'Practice lab: take $10,000 in two funds that both earn 8 percent before costs. Give the manager\'s fund total costs of 2 percent and the list-copying fund 0.2 percent. Work out what each holds after one year and the gap between them.'
    ],
    'Two funds each earn 6 percent before costs. The manager\'s fund charges 1.4 percent all in, and the list copier 0.1 percent. Which ends the year ahead, ignoring tax?',
    {
      A: 'The manager\'s fund, since active work always earns its cost',
      B: 'Neither, since equal returns before costs mean equal results',
      C: 'The copier, since the manager\'s costs took more out first',
      D: 'Nobody can say, since fees only apply in years with losses'
    }, 'C',
    'Both earned the same before costs, but the manager\'s costs were bigger, so less was left. Fees and trading costs are charged in good years and bad, which is why trying has to clear a bar first.'),

  L(21, 'Dividend Investing vs Index Funds',
    'Cash paid to you now versus growth mixed in, and why yield is not return.', [
      'A dividend is a company\'s profit paid out to its owners in cash, often every three months. Think of a food truck crew splitting the night\'s takings. Dividend investing means leaning on companies that pay them, so cash lands in your account along the way. An index fund holds a whole list, with some companies paying a lot and some paying little because they keep their profit to grow.',
      'Yield is the yearly payout divided by the price, so a share that costs $80 and pays $4 has a yield of 5 percent. But yield is not return. Total return is the payout plus any rise or fall in the price. A high yield with a falling price can still lose. Tax on payouts and on price gains differs by country, so check the rule where you live. Payouts can be cut, and no approach is promised to win.',
      'Practice lab: a share costs $60 and pays $3 a year. Work out its yield. Then find its total return if the price ends the year at $54, and compare it with a fund that pays nothing but rises 5 percent.'
    ],
    'A share yields 4 percent and its price falls 6 percent in the same year. Ignoring tax, what was its total return for the year?',
    {
      A: 'Higher by 4 percent, since only the payout counts as return',
      B: 'Lower by 6 percent, since a payout never changes the total',
      C: 'Higher by 10 percent, since the payout adds to the price',
      D: 'Lower by 2 percent, as the payout cushioned the fall'
    }, 'D',
    'Total return adds the payout to the price change. A 4 percent payout and a 6 percent price fall leave a 2 percent loss. Yield alone never tells you how a share did.'),

  L(22, 'The Dividend Trap',
    'Why a huge yield can be a warning sign, and the check that shows it.', [
      'Yield is the yearly payout divided by the price. So yield jumps when the price crashes, even if the company pays not one cent more. A share paying $2 at $50 yields 4 percent. If the price falls to $20, the same $2 yields 10 percent. That fat number can be a warning. Like a sneaker listing at a suspiciously low price, a giant yield makes you ask why. Often sellers doubt the payout will last.',
      'So check whether profits cover the payout. Divide the payout per share by the profit per share. Under 100 percent, the payout comes out of profit. Over 100 percent, it is being paid from savings or borrowing, and that cannot go on forever. When a payout is cut, the price often falls too. Some high yielders do hold up, so this is a check, not a verdict.',
      'Practice lab: a made-up company earns $2 a share and pays $3. Work out the share of profit it pays out. Then work out the yield at a $30 price, and again if the payout is cut to $1.50.'
    ],
    'A share\'s price crashes and its yield leaps to 12 percent. Which check says the most about whether that payout can last?',
    {
      A: 'Whether the company\'s earnings per share cover what it hands out',
      B: 'Whether the yield tops what other shares on the list pay',
      C: 'Whether the payout dates on the calendar are close together',
      D: 'Whether people in the group chat are all buying it'
    }, 'A',
    'A payout that profit does not cover has to come from savings or borrowing, and that cannot last. Comparing yields, payout dates or crowd chatter says nothing about whether the cash is really there.'),

  L(23, 'Lump Sum vs Dollar-Cost Averaging',
    'Invest it all today or split it into equal parts over time.', [
      'You have money to invest. A lump sum means putting all of it in today. Dollar-cost averaging means splitting it into equal parts and investing one part on each date. It works like a streaming subscription that bills the same amount every month. The total is the same either way. Only the timing is different.',
      'Markets have tended to rise over long stretches, so cash waiting on the sidelines often misses some of the climb. In many long-history studies, lump sum came out ahead more often than not. It does not win every time. If the price falls soon after, the split buyer picks up shares cheaper and can finish ahead. Splitting can also feel calmer, and both plans can lose money.',
      'Practice lab: take $1,200 and a share that costs $10, then $8, $10 and $12 over four months. Compare buying 120 shares at the start with four buys of $300. Then try a price that rises every month.'
    ],
    'Ava has $1,200. The share price climbs a little every month for a year. Which plan ends with more shares?',
    {
      A: 'Splitting it up, since smaller buys always cost less per share',
      B: 'They tie, since the same total money goes in either way',
      C: 'Investing it all on day one, since it buys at the lowest price',
      D: 'Neither, since a steady rise leaves no room for any gain'
    }, 'C',
    'With prices rising every month, the lump sum bought everything at the lowest price and the split buyer paid more with each later part. If prices had fallen, the answer could flip, so neither plan wins every time.'),

  L(24, 'Buying the Dip vs Steady Buying',
    'Why the bottom is only obvious afterwards, and why a plan you can keep beats a guess.', [
      'A dip is a fall in price. Buying the dip means holding cash until the price drops, then jumping in, like waiting for a sneaker markdown. It sounds smart. The catch is that a bottom is only obvious afterwards. On the way down every price looks like a dip, and a fall of 10 percent can turn into 30 percent. No sign on the road says the floor is here.',
      'Waiting has a cost too. If the price rises instead of dipping, the buyer holding cash misses the climb and may end up chasing a higher price. Steady buying is the plain alternative: the same amount on the same day, like payday, whatever the price is doing. It needs no guessing. A lucky dip buyer can beat it, and both can lose. A plan you can stick to beats a guess you cannot repeat.',
      'Practice lab: a share sits at $80 and Zoe waits for a drop to $72. Write what happens to her if it falls to $72 and keeps sliding to $50, and if it never falls and climbs to $100. Then write Kofi\'s payday plan.'
    ],
    'Zoe holds cash waiting for a dip. The price never falls to her target and instead climbs all year. What did waiting cost her?',
    {
      A: 'Zero, because cash held back can never lose anything',
      B: 'Part of the rise, since her cash sat out while it climbed',
      C: 'Her whole savings, because the dip she wanted has vanished',
      D: 'Nothing, since prices always drop back to where she waited'
    }, 'B',
    'While she waited, the price rose and her cash missed that climb. Nobody can count on a dip arriving, and a fixed plan for when to buy takes the guessing out of it.')
];
