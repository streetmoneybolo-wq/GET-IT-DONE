'use strict';

/* Module 29 "Street Smarts", lessons 7 to 12: reading a company's numbers.
 *
 * Original Academy material for a complete beginner: earnings per share, the
 * P/E ratio, price-to-book, market cap versus enterprise value, intrinsic
 * value and beta. Everything is fictional (the cast is Ava, Kofi, Zoe, Ravi
 * and Nia, and every business is made up). Educational only: no advice, no
 * guarantees, no real tickers and no real companies. Every number is one a
 * beginner can verify by hand.
 *
 * Shape matches curriculum.js's L() helper: exactly 3 steps with steps[2]
 * starting "Practice lab:", a 4-option question, and the simulation that
 * simulationFor() produces. The Foundation colour is repeated here because
 * LEVEL_COLOR is private to curriculum.js. */

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

const STREET_B = [
  L(7, 'EPS: Profit Per Slice',
    'Earnings per share is a company\'s profit split evenly across its shares, so companies of any size can be compared slice to slice.', [
      'Earnings per share, or EPS, is a company\'s profit divided by its number of shares. Say a made-up food truck company earned $600,000 last year and has 200,000 shares. Divide, and every share stands behind $3 of that profit. It works like a Cash App dinner split: the total bill means little until you know how many people are at the table.',
      'This matters because companies come in different sizes. Two wing spots can each earn $1,000,000. If one has 1,000,000 shares and the other has 4,000,000, the first earns $1 per share and the second only 25 cents. If a company issues new shares, the same profit is shared by more owners, so EPS drops even though the total did not move. Profit here means what is left after costs, interest and taxes.',
      'Practice lab: a made-up laundromat company earns $90,000 with 30,000 shares. Next year it earns the same but has 45,000 shares. Work out EPS both years, then say in one sentence what happened to each owner\'s slice.'
    ],
    'A barbershop company earns $400,000 in both years, but sells new shares in year two. What happens to its EPS?',
    {
      A: 'It rises, because a larger share count means a larger company',
      B: 'It stays put, because the total profit did not change at all',
      C: 'It rises, because the new owners bring extra profit with them',
      D: 'It falls, because each share now stands behind less of the profit'
    }, 'D',
    'EPS is profit divided by shares. With the same profit and more shares, each share gets a thinner cut. New shares bring in cash, but they do not add profit on their own.'),

  L(8, 'The P/E Ratio: What You Pay for a Dollar of Profit',
    'Price divided by EPS shows what buyers pay for each dollar of yearly profit, and why a high or low number is a question, not a verdict.', [
      'The P/E ratio is the share price divided by EPS. It tells you how many dollars buyers pay for each dollar of yearly profit. If a share trades at $30 and earns $2 per share, the P/E is 15, so buyers pay $15 for every $1 of yearly profit. Think of paying rent on a snack stand: the P/E is how many years of its profit you are handing over.',
      'A high P/E is not a verdict, and neither is a low one. Buyers may pay a lot because they expect profit to grow fast, or they may just be excited. A low P/E may mean a bargain, or it may mean buyers expect trouble. Compare a company with similar businesses and with its own past. Also check whether the EPS looks back at last year or forward at a forecast. A company with a loss has no useful P/E.',
      'Practice lab: a made-up gym chain trades at $40 with EPS of $2, and a made-up tailor shop chain trades at $30 with EPS of $3. Work out both P/E ratios, then write one reason each price could be fair.'
    ],
    'Nia sees one stock with a P/E of 40 and another with a P/E of 8. What is the sensible reading?',
    {
      A: 'The 8 is a bargain, because a lower P/E always means cheaper',
      B: 'The 40 costs more per profit dollar, so ask why before judging',
      C: 'The 40 is overpriced, because any P/E above 20 is too high',
      D: 'Both are equal, because P/E ignores how much profit there is'
    }, 'B',
    'A P/E is the price paid per dollar of profit, so 40 costs more per dollar than 8. But that is only a starting point: growth, risk and the industry can all explain the gap.'),

  L(9, 'Price-to-Book: Price vs What\'s on the Books',
    'Book value is what a company owns minus what it owes, and price-to-book compares that to the share price. Useful for some businesses, misleading for others.', [
      'Book value is a company\'s assets minus its debts. Assets are what it owns, like trucks, ovens and cash. Say a made-up van company owns $500,000 of stuff and owes $200,000. Its book value is $300,000, like a car worth $12,000 with a $5,000 loan left on it, where you own $7,000 of it. Split across 100,000 shares, that is $3 of book value per share.',
      'Price-to-book, or P/B, is the share price divided by book value per share. A $4.50 price against $3 of book value is a P/B of 1.5. It helps for businesses full of physical things, like trucks or buildings. It misleads for a hair salon brand, a software firm or a recipe-driven company. A brand and an idea barely show up on the books. Books also record what things cost, not what they would sell for today.',
      'Practice lab: a made-up laundromat company owns $80,000 of machines and cash and owes $30,000. It has 10,000 shares priced at $10. Work out book value, book value per share and P/B, then name one thing the books would miss.'
    ],
    'Ravi checks a well-loved sneaker brand whose price is far above its book value. Why might that not mean it is overpriced?',
    {
      A: 'Much of its worth is a brand that the books barely count',
      B: 'Its book value counts brand value at the full price it earns',
      C: 'Any company with a high P/B must have no debts on the books',
      D: 'Book value only shows cash, and the brand holds very little'
    }, 'A',
    'Book value counts assets like machines and cash, not a loved brand or a smart idea. So a company that runs on those can have a high price-to-book without being overpriced.'),

  L(10, 'Market Cap vs Enterprise Value',
    'Market cap is the price of all the shares; enterprise value adds the debt and subtracts the cash, like the true price of a house with a mortgage.', [
      'Market cap, short for market capitalization, is the share price times the number of shares. It is the price to buy every share. Picture a house worth $400,000 with a $250,000 mortgage. Your own stake in it is only $150,000, but anyone taking over the whole house takes on that mortgage too. The share price only covers the owners\' part.',
      'Enterprise value, or EV, is the price of the whole business. Start with market cap, add the debt a buyer would take on, and subtract the cash a buyer would get. A made-up snack company with a $1,000,000 market cap, $300,000 of debt and $100,000 of cash has an EV of $1,200,000. EV lets you compare companies with different debt and cash. It is still an estimate, since debt and cash come from the last report, and some cash is needed to keep the doors open.',
      'Practice lab: a made-up taco truck company trades at $5 with 200,000 shares, owes $150,000 and holds $50,000 in cash. Work out its market cap and its EV, then say which one a buyer of the whole business would care about.'
    ],
    'Kofi says two bakeries have the same market cap, but one carries heavy debt. Which has the higher enterprise value?',
    {
      A: 'The cash-rich one, since cash counts as something a buyer gets',
      B: 'Neither one, since market cap alone fixes enterprise value',
      C: 'The indebted one, since its debt adds to what a buyer takes on',
      D: 'They match, because debt and cash cancel out in every case'
    }, 'C',
    'Enterprise value is market cap plus debt minus cash. With equal market caps, the bakery with more debt has the higher EV, because a buyer would inherit that debt.'),

  L(11, 'Intrinsic Value: What It\'s Worth vs What It Costs',
    'Intrinsic value is an estimate of what a business is worth from the cash it may pay out over time. A margin of safety protects against estimates being wrong.', [
      'Price is what a share costs today. Intrinsic value is your estimate of what it is worth, based on the cash the business may hand its owners in the future. Money later is worth less than money now. At a 10% yearly rate, $110 next year is worth $100 today. Shrinking each future payment back to today is called discounting.',
      'To estimate, guess the cash for each coming year, discount each payment, and add them up. Then comes the honest part: it is a guess, and a small change in growth or rate can move the answer a lot. So careful people want a margin of safety. That means paying well below their estimate, leaving a cushion if the guess is wrong. It is a habit for handling uncertainty, not a promise of any result.',
      'Practice lab: a made-up car wash company may pay $11 per share one year from now and $12.10 two years from now. At 10% a year, work out what each payment is worth today and add them. Then find a price with a 30% margin of safety.'
    ],
    'Zoe estimates a share is worth $50 and it costs $48. What does that thin gap tell her?',
    {
      A: 'It is a bargain, because any price below her estimate is safe',
      B: 'There is little cushion, so a small error in her guess wipes it out',
      C: 'Her estimate is proven right, since the price landed so close',
      D: 'Worth only changes when the share price changes on the screen'
    }, 'B',
    'Intrinsic value is an estimate, not a fact. When the price sits just under it, a small mistake in the guesses erases the gap, which is why a margin of safety asks for a much wider one.'),

  L(12, 'Beta: How Wild Is This Stock Compared to the Market',
    'Beta compares how much a stock has swung relative to the whole market in the past. It describes history, not the future.', [
      'Beta measures how much a stock has tended to move compared with the market as a whole. A beta of 1 means it has moved about in step. A beta above 1 means bigger swings, and a beta below 1 means smaller ones. If the market rose 10%, a beta of 1.5 stock has tended to rise about 15%, and a beta of 0.5 stock about 5%. It goes both ways, so a market drop hurts the high beta stock more.',
      'Beta is a look in the rearview mirror. It is worked out from past prices over a chosen window, so different sites can show different betas for the same stock. It is not a forecast and does not say if the business is good. It also misses trouble that is only about the company, like a bad product launch. Think of a sneaker drop: the resale price may bounce around no matter what the wider market does.',
      'Practice lab: a made-up market rises 8% one week and falls 6% the next. Work out the likely move of a beta 1.5 stock and a beta 0.5 stock in each week, then say why those are guides and not promises.'
    ],
    'Ravi sees a stock with a beta of 0.5. What does that number tell him?',
    {
      A: 'It is half as risky as any other stock, in every way',
      B: 'It will lose only half as much as the market next year',
      C: 'The company earns half the profit of the average business',
      D: 'In its past record, it has moved about half as much as the market'
    }, 'D',
    'Beta compares past swings with the market. A 0.5 means the stock has tended to move about half as much. It is not a forecast, and it says nothing about profit or company-specific risk.')
];

module.exports = STREET_B;
