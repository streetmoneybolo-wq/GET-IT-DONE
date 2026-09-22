'use strict';

/* Module 0 "Start Here", lessons 1-7: the first-time trader's track.
 *
 * Written for someone who has never bought a share. Short sentences, every
 * term defined in the sentence that first uses it, and no lesson assumes
 * anything beyond the ones before it in this module. Educational only: no
 * advice, no "you should", no guarantees, no real tickers and no real
 * companies. Where a rule differs by country or changes over time, the lesson
 * teaches the mechanism and says so out loud instead of quoting a number.
 *
 * Shape matches curriculum.js's L() helper exactly: exactly 3 steps with
 * steps[2] starting "Practice lab:", a 4-option question, and the simulation
 * that simulationFor() produces (module 0 has no special case, so every
 * lesson gets defaultSimulation's three rounds).
 *
 * LEVEL_COLOR is private to curriculum.js, so the Foundation colour is
 * repeated here. If the integrator exports LEVEL_COLOR, import it instead. */

const { simulationFor } = require('../simulations');

const FOUNDATION_COLOR = 0x00E676; // LEVEL_COLOR.Foundation in curriculum.js
const DURATION = '10 min';

function L(lessonId, title, description, steps, prompt, options, correct, explanation) {
  const lesson = {
    moduleId: 0,
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

const START_HERE_A = [
  L(1, 'What a Share Actually Is',
    'A share is a slice of a real business, not just a number on a screen.', [
      'A company can be cut into equal slices, and one slice is called a share. If a bakery is cut into 1,000 shares and you own 10 of them, you own 10 slices out of 1,000. Those slices are a piece of the company that owns the ovens and the recipes. If it makes a profit, your slices stand behind their share of it. You only see cash if the company decides to hand some out.',
      'You usually buy your slice from another owner who wants to sell, not from the company itself. Your broker, the firm that handles the trade, holds the slice for you. If the business does well your slice is worth more to the next buyer. If it does badly it is worth less, and nobody owes you your money back.',
      'Practice lab: take a made-up shop, cut it into 1,000 shares, buy 10 of them, and work out what share of one year of profit those 10 slices stand behind.'
    ],
    'Ava owns 10 of a bakery\'s 1,000 shares. What does she own?',
    {
      A: 'Money lent to the bakery that it must pay back with interest',
      B: 'One hundredth of the business, its profits and its losses',
      C: 'Her broker\'s promise to buy the shares back at what she paid',
      D: 'The right to a fixed payment from the bakery every year'
    }, 'B',
    'A share is ownership, not a loan and not a promise. Ten slices out of a thousand is one hundredth of the bakery, so they stand behind one hundredth of any profit and one hundredth of any loss.'),

  L(2, 'Reading a Stock\'s Numbers',
    'What the numbers beside a company\'s name mean, and which one is not the size of the company.', [
      'The price on the screen is the price of one slice. Multiply it by how many slices exist and you get what the whole company is priced at. The ticker is the short code for a company. The volume is how many shares changed hands today. The day range is the highest and the lowest price traded today.',
      'There is never one price, there are two. The bid is the best price someone will pay for your shares right now. The ask is the best price someone will sell to you right now. The last price on the screen is only a receipt for a trade that already happened.',
      'Practice lab: take two made-up companies with very different share prices, multiply each price by its share count, and say which company is actually bigger. Module 1 Lesson 1 works through the bid and the ask, and Module 2 Lesson 1 explains a candle.'
    ],
    'Fizz Town trades at $4 and Lagoon Lane at $400. Which is the bigger business?',
    {
      A: 'Lagoon Lane, because one of its shares costs a lot more',
      B: 'Fizz Town, because more buyers can afford a cheap share',
      C: 'Neither, until each price is multiplied by its share count',
      D: 'They match, because price and share count always balance'
    }, 'C',
    'The size of a business is its share price multiplied by how many shares exist. A four dollar share can belong to a far bigger company than a four hundred dollar one if there are many more of them.'),

  L(3, 'Opening an Account and What Happens After You Press Buy',
    'The account, the order, the fill, and the day the trade actually becomes final.', [
      'A brokerage account is where your money and your shares sit. A broker is the firm that holds them and sends your order to the market. You move money in, you place an order, and when somebody takes the other side your order is filled. Filled means the trade happened.',
      'Settling is the day the shares and the cash actually change hands. In the United States that is one business day after the trade. In the European Union and the United Kingdom it is still two business days, so check the rule where you live. Many brokers now charge nothing to trade a share and let you buy a fraction of one. If a brokerage firm itself failed, many countries have a scheme that returns your missing cash and shares up to a limit. No scheme anywhere refunds a price that fell.',
      'Practice lab: walk one order from money in to settled, name the day the cash actually leaves the account, and say which of the two, a broker that collapses or a price that slides, a protection scheme would not cover.'
    ],
    'Ava\'s shares fall from $20 to $15. What does a broker protection scheme cover here?',
    {
      A: 'Her whole $100 loss, because the account itself is protected',
      B: 'The loss, but only up to the scheme\'s limit for the year',
      C: 'Everything she paid, since the shares were bought inside it',
      D: 'Nothing; it replaces missing cash and shares if the firm fails'
    }, 'D',
    'A protection scheme steps in when the brokerage firm fails and a customer\'s cash or shares go missing. A price that simply fell is an ordinary investment loss, and no scheme anywhere refunds that.'),

  L(4, 'Placing Your First Order: Market or Limit',
    'Two ways to ask for shares: take the price that is there, or name the price you will pay.', [
      'A market order says buy me the shares now, at whatever the best price is. A limit order says buy me the shares only at this price or better. That is the whole difference between them.',
      'A market order almost always fills, but in a fast-moving stock it can fill above the price you saw a second ago. A limit order protects you from that and may never fill at all, and a stock that keeps climbing leaves the limit buyer holding nothing. Module 1 Lesson 2 goes deeper into order types and what a good fill actually costs.',
      'Practice lab: place one market order and one limit order on the same practice stock, then write down what each one cost you, the price or the shares.'
    ],
    'What does a limit order to buy at $25 actually promise?',
    {
      A: 'That no more than $25 a share will ever be paid',
      B: 'That the shares will be owned before the day ends',
      C: 'That the price paid will come in below $25 a share',
      D: 'That the price will fall back to $25 before long'
    }, 'A',
    'A limit sets the worst price that is acceptable and nothing else. It cannot make a seller appear, so the order may never fill, and it is neither a discount nor a forecast that the price will come back.'),

  /* Titled for what it teaches. It is a cost of TRADING, charged on the way in
   * and the way out; the cost of OWNING, the yearly fee a fund takes while you
   * sit still, is Lesson 12. The old title promised the second and delivered
   * the first, so the two fee lessons read as the same lesson twice. */
  L(5, 'The Cost Nobody Bills You For',
    'The cost you pay on every trade even when the commission is zero.', [
      'Buying takes the ask, the price a seller wants, and selling takes the bid, the price a buyer offers. The gap between the two is called the spread. You pay that gap every time you buy and sell again, and no statement ever shows it as a line.',
      'Brokers in many countries now charge no commission on a share trade. In the United States a broker can be paid by the firm that fills your order. In the United Kingdom and the European Union that payment is banned. Brokers there earn from interest on your cash, from currency conversion, or from a plain commission. The gap itself goes to whoever takes the other side of your trade, and that is usually not your broker. It is narrow on a heavily traded share, wide on a thinly traded one, and charged on every trip.',
      'Practice lab: take one made-up stock\'s bid and ask, multiply the gap by your share count, then multiply that by how many times you went in and out last month.'
    ],
    'Zoe\'s broker charges no commission. Where does the cost of her twelve round trips come from?',
    {
      A: 'From a monthly account fee she has not noticed on her statement',
      B: 'From the gap between the price she buys at and the price she sells at',
      C: 'Nowhere, because commission-free trades really are free to make',
      D: 'Only from the tax she will owe later on any gain she makes'
    }, 'B',
    'She buys at the higher of the two quoted prices and sells at the lower one, so each round trip hands over that gap. A broker that charges no commission is paid in other ways instead.'),

  L(6, 'Why a Big Loss Is Harder to Undo Than It Looks',
    'Losses and gains are not mirror images of each other.', [
      'A fall takes a percentage of everything you have, which leaves a smaller pile behind. The recovery then has to grow that smaller pile all the way back up to the bigger one. That is why the two percentages never match.',
      'This is why somebody can be right several times, be badly wrong once, and still end the year behind. It is also why putting everything into one exciting idea is a bigger risk than the size of the position makes it look. Module 7 Lesson 2 measures peak-to-trough loss properly, and Module 2 Lesson 2 covers returns and how much they move.',
      'Practice lab: take three practice accounts that fall 20 percent, 50 percent and 80 percent, and work out the gain each one needs just to get back to where it started.'
    ],
    'A practice account falls 80 percent. What gain brings it back to where it started?',
    {
      A: '80 percent, the same figure that was lost on the way down',
      B: '100 percent, because doubling always undoes a halving',
      C: '400 percent, because a fifth has to become a whole again',
      D: '180 percent, the fall itself plus a doubling on top'
    }, 'C',
    'An 80 percent fall leaves a fifth of the money. Turning a fifth back into a whole means multiplying it by five, which is a gain of 400 percent. Matching the percentage back works only when nothing was lost.'),

  L(7, 'Compounding: Growth on Top of Growth',
    'Why money left alone grows more in later years than in early ones.', [
      'Ten percent of $1,000 is $100. The next ten percent is taken on $1,100, so it is $110. The gain gets bigger because the pile it is taken from got bigger. That is all compounding is.',
      'Real returns are not a steady number. Some years are negative, and a year that falls resets the pile downward. That is why the shape only shows up over long stretches, and never on a schedule. Compounding describes how growth stacks, not what any investment will do. Module 14 Lesson 1 does the mathematics behind it.',
      'Practice lab: grow a made-up $1,000 at a made-up ten percent a year for three years by hand, add up three flat $100 gains instead, and explain where the difference came from.'
    ],
    'Why does three years of ten percent growth on $1,000 end above $1,300?',
    {
      A: 'Each year\'s ten percent is taken on a bigger amount than the last',
      B: 'The real rate must have been higher than the ten percent stated',
      C: 'Growth was added every month instead of once at the year\'s end',
      D: 'The final year pays an extra bonus for having held on so long'
    }, 'A',
    'The first year of ten percent is taken on $1,000, the second on $1,100 and the third on $1,210. The pile grows each time, so the gains grow too and the total passes three flat gains of $100.')
];

module.exports = START_HERE_A;
