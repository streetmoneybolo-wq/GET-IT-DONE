'use strict';

/* Module 0 "Start Here", lessons 8-13 (builder b).
 *
 * Written for someone who has never bought a share: short sentences, every term
 * defined in the sentence that uses it, and nothing assumed beyond the lessons
 * before it in this module (0.8 needs 0.1-0.7; 0.11 needs 0.10 and the bid and
 * ask from 0.2; 0.12 needs a fund to charge a fee).
 *
 * Educational only. No advice, no "you should", no guarantees, no return
 * promises, no urgency, no real tickers and no real companies. Rules that
 * differ by country or change over time are taught as concepts, with the
 * country named when a stated fact is country-specific.
 *
 * Shape copied from curriculum.js: the L() helper there builds
 * { moduleId, lessonId, title, description, duration, level, color, steps,
 *   question, simulation }. LEVEL_COLOR.Foundation is 0x00E676; it is repeated
 * here rather than imported, because curriculum.js is what loads this file.
 * simulationFor() has no special case for module 0, so defaultSimulation gives
 * the three rounds the tests require.
 *
 * The knowledge checks live in ../quizzes-data/start-here-b.js and are pulled
 * in here, so the inline question and the authored check can never drift. */

const { simulationFor } = require('../simulations');
const CHECKS = require('../quizzes-data/start-here-b');

const FOUNDATION_COLOR = 0x00E676;
const MODULE_ID = 0;

function L(lessonId, title, description, steps, duration = '10 min') {
  const check = CHECKS[`${MODULE_ID}.${lessonId}`];
  if (!check) throw new Error(`Start Here lesson ${lessonId} has no knowledge check`);
  const lesson = {
    moduleId: MODULE_ID,
    lessonId,
    title,
    description,
    duration,
    level: 'Foundation',
    color: FOUNDATION_COLOR,
    steps,
    question: {
      prompt: check.prompt,
      options: { A: check.options.A, B: check.options.B, C: check.options.C, D: check.options.D },
      correct: check.correct,
      explanation: check.explanation
    }
  };
  lesson.simulation = simulationFor(lesson);
  return lesson;
}

const START_HERE_B = [
  L(8, 'Dollar-Cost Averaging: Same Money, Different Prices',
    'Buying a fixed amount on a schedule, and what that does to your average cost.', [
      /* "Unit" is counted all the way through this lesson and its example, and
       * pooled funds are not introduced until 0.10 or priced until 0.11, so a
       * learner meets the word here first. It is defined on first use, against
       * the share they already have from 0.1. */
      'Dollar-cost averaging means putting the same amount of money in on the same day each month, whatever the price is that day. You can buy shares with it, or units of a fund, which is a pot of money many people buy into. One unit is one slice of that pot, just as one share is one slice of a company. You choose the amount and the date, and you never choose the price.',
      'The same money buys more units when the price is low and fewer when it is high. So your average cost per unit lands below the plain average of the prices you paid. That is arithmetic, not protection. It does not assure a profit and it does not protect you in a falling market. If the price had only ever risen, putting the whole amount in at the start would have bought more units. This is a way to keep buying without guessing, not a way to win.',
      'Practice lab: buy the same dollar amount at two different prices, work out your average cost per unit, and explain why it sits below the plain average of the two prices.'
    ]),

  L(9, 'One Company or Many',
    'What changes when the same money is spread across several businesses.', [
      'Buying shares in one company ties your money to that one business. A company can fail for reasons nobody outside it could see coming: a lost contract, a fire, a fraud. Nothing about owning the shares protects you from that.',
      'Spreading the same money across several different businesses shrinks the worst case, because four companies rarely collapse on the same day. It shrinks the best case by exactly as much, since the one that doubles now moves only a quarter of your money. Spreading helps least when the things you hold rise and fall together. Four bakeries in one town are closer to one bet than four different kinds of business are. It never removes the risk of losing. Module 7 Lesson 2 measures this properly.',
      'Practice lab: put $1,000 into one company and the same $1,000 across four, then run the same collapse and the same doubling through both and compare what is left.'
    ]),

  L(10, 'Index Funds: Buying the Whole List',
    'One purchase that holds every company on a list.', [
      /* Five Start Here lessons buy a broad fund in their worked example and
       * nothing else, which by repetition alone reads as a recommendation. The
       * vehicle is labelled as a vehicle once, here, where it is introduced. */
      'An index is a named list of companies plus a rule for how much of each one counts. An index fund is a pot of money that buys that whole list and keeps itself matching it. Nobody inside it is choosing which name will do well. These lessons use a made-up broad fund because it is simple to price and easy to follow. It is not being put forward as the thing to buy.',
      'One purchase spreads your money over every company on the list, which means you own the ones that do badly too. Your result is the list\'s result, less whatever the fund charges, and Lesson 12 of this module takes that charge apart. Owning every name on a list does nothing to stop the list itself falling, so an index fund can drop hard. Set against picking one company, it trades away the chance of a huge single win for a much smaller chance of losing everything.',
      'Practice lab: build a made-up ten-name list, work out what $1,000 buys of each name, and say what happens to the fund when one name halves.'
    ]),

  L(11, 'Index Fund or ETF: Same List, Two Wrappers',
    'The same list of companies, bought two different ways.', [
      /* The cut-off is the one thing a beginner placing a first fund order
       * actually runs into: under forward pricing an order is filled at the
       * next value the fund strikes after it arrives, so a late order gets
       * tomorrow's price. And the value is what the fund holds MINUS what it
       * owes, divided by the units. */
      'A mutual fund is a pot of money priced once a day, after the market closes. That one price is the value of everything the fund holds, minus what it owes, divided by the number of units. Everyone whose order arrives before the fund\'s daily cut-off is filled at that price. An order sent after the cut-off waits and is filled at the next day\'s price.',
      'An exchange-traded fund, or ETF, trades on the exchange all day like a share. It has a bid, an ask, and a price that moves minute to minute. So you cross that gap each time, and its price can sit a little above or below the value of what it holds. The mutual fund fills you at the closing value, so you cannot pick your moment. Neither wrapper improves the list inside it. The questions are the same for both: which list, and what charge?',
      'Practice lab: buy the same list twice, once at the end-of-day value and once at a mid-morning ask, and compare what the two purchases cost.'
    ]),

  L(12, 'Fees: The Small Number That Never Stops',
    'What a fund\'s yearly charge is taken from, and why a small difference is not small.', [
      'A fund\'s expense ratio is the slice it keeps each year, written as a percentage of whatever you hold in it. A tenth of one percent on $1,000 is one dollar a year. A full one percent on the same $1,000 is ten dollars a year.',
      /* Both ICI figures are ASSET-WEIGHTED: what the average dollar pays, not
       * what the average fund charges. Quoted as plain averages they told a
       * beginner that a typical equity mutual fund costs 0.40 percent, which
       * made this lesson's own one-percent fund look like a freak. Counting
       * every fund equally, ICI's simple average was about 1.1 percent.
       * Sources: ici.org/files/2026/per32-01.pdf (2025 data, "Expense ratios
       * are measured as asset-weighted averages") and the Fact Book's US Fund
       * Expenses and Fees chapter for the simple average. */
      'No bill ever arrives. The charge comes out of the fund\'s own value, so the price just grows a little more slowly. It is taken from your whole balance, not from your gain, so a falling year still costs you the fee. For scale, the Investment Company Institute reported that in 2025 the average dollar in an index equity ETF paid 0.14 percent a year. The average dollar in an equity mutual fund paid 0.40 percent. Count every fund equally instead of every dollar and the average is far higher, around 1.1 percent.',
      'Practice lab: take two funds holding the same list, one charging a tenth of a percent and one charging a full percent, and work out the yearly cost on $1,000 and again on $10,000. Read the fund\'s own page: no single fund is the average. Module 21 Lesson 5 looks at fees and results together.'
    ]),

  L(13, 'Dividends: Getting Paid to Hold',
    'Cash a company hands to its owners, and what that cash is not.', [
      'Some companies hand part of their cash to the people who own the shares, usually a few times a year. That payment is called a dividend. Twenty-five cents a share, paid four times a year on a hundred shares, is a hundred dollars over the year.',
      'The cash leaves the company, so a dividend is not money on top of the share price. On the first morning the shares trade without the next payment attached, the price typically opens lower by roughly the amount being paid. That morning is called the ex-dividend day, and when it falls depends on the local settlement rule. The company decides the payment and can cut it or stop it whenever it likes. A payment that looks unusually large next to the price often means the price has fallen, not that the business is strong.',
      'Practice lab: count a year of quarterly payments on a made-up holding, then take one payment off the share price on the morning it goes out. Module 19 Lesson 4 studies payout policy.'
    ])
];

/* A plain array, in lesson order: the integrator spreads it into the module 0
 * block of curriculum.js alongside the other Start Here builders. */
module.exports = START_HERE_B;
