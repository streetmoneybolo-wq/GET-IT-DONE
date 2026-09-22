'use strict';

/* Start Here (module 0), lessons 14-20: the tax shape, the first $1,000, a
 * four-part mix, small samples, and options told honestly.
 *
 * Written for someone who has never bought a share. Short sentences, every
 * term defined in the sentence that first uses it, and no lesson assumes
 * anything past the Start Here lessons before it. Educational only: no advice,
 * no "you should", no guarantees, no real tickers and no real companies.
 *
 * Tax and market rules differ by country and change, so these lessons teach
 * the mechanism and never a rate, a bracket or a threshold. The one US rule
 * named (a holding period longer than a year, and the wash-sale window) is
 * named as a US rule and immediately marked as country-specific.
 *
 * Shape matches the L() helper in ../curriculum.js exactly:
 *   { moduleId, lessonId, title, description, duration, level, color,
 *     steps: [3], question: { prompt, options, correct, explanation },
 *     simulation }
 * The 3-step rule and steps[2] matching /lab:/i are enforced by
 * ../commands.test.js, so every third step here opens "Practice lab:".
 *
 * The knowledge checks live in ../quizzes-data/start-here-c.js and are used
 * from there, so the authored quiz data and the lesson's inline question can
 * never drift apart. */

const { simulationFor } = require('../simulations');
const QUIZZES = require('../quizzes-data/start-here-c');

/* Same value as LEVEL_COLOR.Foundation in ../curriculum.js, which does not
 * export the table. If that constant ever changes, change it here too. */
const FOUNDATION_COLOR = 0x00E676;
const DURATION = '10 min';

function lesson(lessonId, title, description, steps) {
  const quiz = QUIZZES[`0.${lessonId}`];
  if (!quiz) throw new Error(`start-here/starter-c: no knowledge check for 0.${lessonId}`);
  const built = {
    moduleId: 0,
    lessonId,
    title,
    description,
    duration: DURATION,
    level: 'Foundation',
    color: FOUNDATION_COLOR,
    steps,
    question: { prompt: quiz.prompt, options: quiz.options, correct: quiz.correct, explanation: quiz.explanation },
  };
  built.simulation = simulationFor(built);
  return built;
}

const START_HERE_C = [
  lesson(14, 'How Long You Held It Changes the Tax',
    'Why the date you sell, and not only the profit, decides what a gain costs you.', [
      'A gain is the money you make when you sell something for more than you paid. While you still own the shares, that gain only exists on your screen, and in most countries nothing is owed until you actually sell. A loss you take can usually be set against gains, so selling something at a loss is not simply wasted.',
      /* The wash-sale sentence used to be 47 words and carried a rule name, a
       * thirty-day window on both sides and a cost-basis adjustment into a
       * step that promises "the shape, not the numbers". The concept survives;
       * the mechanics go with the rest of the country-specific detail. */
      'Many countries treat a long hold differently from a short one. In the United States, holding for more than one year makes the gain long-term, and one year or less is short-term. Other countries draw that line somewhere else, or nowhere at all. Some countries also ignore a loss if you buy the same thing straight back soon after selling it. The loss is not gone; it just moves onto the new shares. Rates, holding periods and rules all differ by country and change over time, so look up your own.',
      'Practice lab: take one gain sold at month eight and the same gain sold at month fourteen, say which one could be treated differently, and do it without naming a single rate. This lesson teaches the shape, not the numbers, and it is not tax advice.',
    ]),

  lesson(15, 'Your First $1,000: What Goes First',
    'The order money usually goes in, and why clearing a debt can beat an investment.', [
      'Before you invest anything, look at what your money is already doing. A debt you carry charges you interest every month, and that cost is certain: it happens whether markets rise or fall. An investment might return more than the debt costs, or less, or nothing at all, and nobody knows which in advance.',
      /* The first line states a consequence rather than an instruction: this
       * is the lesson closest to personal-finance advice, so the rule is shown
       * as what a bad month does to you, not as an order. Payment for order
       * flow is named as a United States arrangement because the United
       * Kingdom has effectively banned it since 2012 (FSA/FCA FG12/13) and the
       * European Union bans it under MiFIR Article 39a, whose last national
       * exemption expired on 30 June 2026. And the spread is not the broker's
       * money: it goes to whoever takes the other side. */
      'Money you might need next month is money a bad month could force you to sell at a low price. Once expensive debt is gone and some cash is set aside, small amounts still work. A fractional share is part of one share, so fifty dollars can buy part of a five-hundred-dollar share. Commission-free is not cost-free. Firms still earn from interest on idle cash and from currency conversion. In the United States a firm can also be paid for routing your order, which the United Kingdom and the European Union ban.',
      'Practice lab: write a certain debt cost next to an uncertain investment return and say out loud which of the two numbers you actually know today. The sensible order depends on your own rates and your own life, so this is education, not advice about your debts.',
    ]),

  lesson(16, 'A Simple Four-Part Mix and Keeping It That Way',
    'A portfolio is a set of proportions, and proportions drift.', [
      'A mix is a set of slices that add up to one whole. Picture four of them. One broad fund holds many companies from your own country, and another holds companies from the rest of the world. The third is a bond fund, which lends money out rather than buying companies. The fourth is plain cash. Four slices is already a plan, and choosing the sizes is the real decision.',
      'The parts grow at different speeds, so after a year the slices are no longer the ones you picked. The mix is now riskier, or duller, than you intended. Rebalancing means selling a little of what grew and buying what lagged until the proportions are back where you set them. It restores the shape you chose, and it is not a way to make the mix earn more. Selling can cost trading fees and can trigger tax. Module 21 Lesson 2 studies allocation and rebalancing in depth.',
      'Practice lab: set four slices that add up to a whole, grow two of them and shrink one, then work out exactly what to sell and what to buy to get the shape back.',
    ]),

  lesson(17, 'A Pattern in the Past Is Not a Promise',
    'Why a rule that worked every time may rest on almost no evidence at all.', [
      'Someone tells you a rule has worked nearly every time. The first question is how many times that actually is. Say something has only happened five times and the rule held in four of them. One different outcome would have made it three out of five. Five is not many, and a rule built on five cases is one case away from falling apart.',
      'Calendar rules, such as a month, a season or an election year, collect very few separate cases. The person repeating one usually found it by testing many rules and keeping the one that fitted. Acting on it costs you the gap between buy and sell prices every time, and possibly tax, while the edge may never have existed. Ask three things: how many cases there were, who counted them, and what else was tested and quietly dropped. Module 8 Lesson 2 and Module 17 Lesson 2 cover this properly.',
      'Practice lab: count how many separate cases a calendar rule really rests on, then work out how many of them would have to flip before the rule disappears.',
    ]),

  lesson(18, 'Options, Plainly: A Right With a Deadline',
    'What a call and a put are, what they cost, and how fast the money can be gone.', [
      /* Both break-evens are stated here, because this track prices a call and
       * never a put: a first-timer should see both rights priced once. "Out of
       * the money" is glossed on its only appearance, and "US" is spelled out
       * so the voice cannot read it as the pronoun "us". */
      'A call is the right to buy shares at a set price, called the strike, up to a set date. A put is the right to sell at the strike, up to that date. The money you pay for the right is called the premium. You are buying a right, not an obligation, and not the shares. A call buyer needs the price above the strike plus the premium to break even. A put buyer needs it below the strike minus the premium. One contract usually covers one hundred shares, though that differs by market.',
      'The right expires. If the move has not happened by the deadline, the option is worth nothing and the whole premium is gone. FINRA, which oversees brokerage firms in the United States, puts it plainly. An option that expires out of the money, meaning the price never reached the strike, loses the entire premium paid. Owning shares and owning a call are not the same, because shares have no deadline and the call does. A call can lose everything in a week that leaves the share owner fine.',
      'Practice lab: price one call, work out the break-even, then mark the price at which the buyer loses every cent paid. Module 9 Lesson 1 works through puts in depth. This lesson explains how these contracts work; it is not a suggestion that you trade them.',
    ]),

  lesson(19, 'The Other Side: Selling a Call You Cover, Selling a Put You Fund',
    'What you are agreeing to when you take the premium instead of paying it.', [
      /* Step two used to run 172 words and eight ideas, including a 43-word
       * regulator quote and three terms it never defined ("assigned",
       * "exercised", "American-style"). One idea per breath now: step one
       * defines the two trades and sizes the put's risk, step two says what
       * the premium actually buys, and the contract-style aside is gone. */
      'Every option has two sides. The seller takes the premium up front and then has to do whatever the buyer decides. A covered call means you already own one hundred shares and sell someone the right to buy them at the strike. A cash-secured put means you hold the cash ready and sell someone the right to sell you shares at the strike. Say you sell a put at a thirty dollar strike for two hundred dollars and hold three thousand dollars ready. If the shares fall to fifteen you still buy at thirty.',
      'The premium is payment for taking on risk, not income that turns up for free. A covered call swaps an unlimited climb for a fixed ceiling and leaves the whole fall with you. On the put side the premium barely covers a drop like that one. You can also be assigned before the deadline. Being assigned means the buyer uses their right, on their day and not yours. Whether that can happen early depends on the contract, so it is worth checking.',
      'Practice lab: sell one covered call and run both endings, the shares taken away at the strike and the stock falling while you keep the premium. Module 9 Lesson 1 goes deeper. This lesson explains how these contracts work; it is not a suggestion that you trade them.',
    ]),

  lesson(20, 'The Get-Rich Math, Checked',
    'The arithmetic behind the big option win, and behind the other nine tries.', [
      'An option can turn a small move into a large percentage gain, because you only paid the premium and not the price of the shares. That is leverage: a small amount of money controlling a much larger position. The same multiplier works downward, and the floor for a buyer is zero rather than some smaller loss.',
      'A screenshot shows one trade. The honest question is what the same bet did across every attempt. A winner only means something once the losing tries are counted beside it. Remember too that the person on the other side was paid to take that risk and chose to. Nothing here predicts how often any real option pays. Every frequency in this lesson is a made-up example, and a result you cannot count is not a strategy.',
      'Practice lab: take ten identical option bets where one wins big and nine expire worthless, then work out the total for the year. Module 7 Lesson 1 shows how an average trade is worked out, and Module 8 Lesson 1 covers base rates.',
    ]),
];

module.exports = START_HERE_C;
