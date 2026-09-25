'use strict';

/* Street Smarts (module 29), file e: lessons 25 to 30.
 * Small vs large companies, growth vs dividend stocks, how a central bank rate
 * reaches a wallet, how currencies work, what investment banks and hedge funds
 * earn, and staying invested through recessions and record highs. Original
 * scenarios, educational only: no advice, no promises, no real companies. */

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
  L(25, 'Small Companies vs Large Companies',
    'Small caps and large caps trade growth room against steadiness, and neither one is safe.', [
      'Every company has a total price tag: its share price times its share count. Investors call the smaller ones small caps and the giants large caps, where cap is short for capitalization. Cap describes size, not quality. Where the lines fall is a habit of the industry, and it shifts by country and over the years.',
      'Picture a corner store with one location. It has room to open ten more, so it can grow fast. But one lost supplier or one broken freezer can make it wobble hard. A chain with a store on every block has fewer new blocks left, so it tends to grow slower and move steadier. Steadier is not safe. Giants stumble too, and some fall apart. Some investors hold a mix of both sizes to spread the bumps. That is one option, not a rule.',
      'Practice lab: take a made-up laundromat company with a small total price and a made-up grocery giant with a huge one, list one way each could grow and one way each could get hurt, and say why neither size is safe.'
    ],
    'Zoe says big companies never fall and small ones always soar. What is the fairer way to put it?',
    {
      A: 'Big companies swing more, since they have more customers to lose',
      B: 'Small companies are safer, since a low total price limits the damage',
      C: 'Both sizes behave alike, because size does not change how they move',
      D: 'Small ones can grow faster and swing harder, and neither size is safe'
    }, 'D',
    'Small companies often have more room to grow and bigger swings, while large ones tend to be steadier, but any company can fail. Size is a trade-off, not a safety rating.'),

  L(26, 'Growth Stocks vs Dividend Stocks',
    'One kind of company reinvests its profit to grow, the other pays part of it out as cash.', [
      'A growth company keeps its profit and pours it back into the business: more locations, more ovens, more staff. It pays out little or nothing. The hope is that a bigger business is worth a higher price later, so the share price does the work. It is the friend who puts every tip back into a bigger food truck. Hope is not a promise, and plans can miss.',
      'A dividend company sends part of its profit to shareholders as cash, often every three months, like a small payday. The price usually moves less wildly, but the payout is not fixed. The board can trim it or drop it. When the cash goes out, the price usually dips by about that amount. Tax on dividends differs by country. One gives cash along the way, the other hopes for a bigger business later.',
      'Practice lab: take two made-up companies with the same profit, let one keep it and the other pay half out as cash, and write down what a holder of each has after one year: cash in hand, or a price that moved.'
    ],
    'Ravi holds a company that pays out much of its profit as cash. Zoe holds one that keeps its profit to build new shops. What is the main difference?',
    {
      A: 'Ravi gets cash along the way, while Zoe\'s gain depends on the price rising',
      B: 'Zoe is owed a fixed payment every year, while Ravi is owed nothing',
      C: 'Ravi\'s price cannot fall since cash arrives, while Zoe\'s price can',
      D: 'Zoe\'s company owes tax on its profit and Ravi\'s company never does'
    }, 'A',
    'A dividend stock hands some profit to holders as cash, while a growth stock keeps it to expand, so its holders rely on the price. Neither is promised: dividends can be cut and prices can fall.'),

  L(27, 'How the Central Bank\'s Interest Rate Reaches Your Wallet',
    'From the central bank to a car loan, a card balance, a business loan and your savings.', [
      'A central bank is the official bank that sets a country\'s base interest rate. Regular banks price their own loans and savings accounts off that rate. When it goes up, borrowing costs more and saving pays more. When it goes down, the reverse. Systems differ by country: who sets the rate, how often, and how fast banks pass it on.',
      'Follow a rate rise down the block. A bank pays more to borrow, so it charges more on car loans. A card balance usually floats with rates, so it gets dearer fast. A business owner pricing a loan for a new oven may wait. Savers earn a bit more. With borrowing pricey, people spend less, demand cools, and rising prices slow. It takes months, and fixed-rate loans already signed usually stay put.',
      'Practice lab: take a made-up loan, raise its rate by two points, and work out the extra interest per year, then do the same for a savings balance to see who gains and who pays.'
    ],
    'The central bank raises its rate. Which chain of effects is most likely over the following months?',
    {
      A: 'Loans get cheaper and saving pays less, so spending heats up',
      B: 'Loans cost more and savings earn more, so spending cools a little',
      C: 'Only banks notice, since shoppers and firms never see the change',
      D: 'Prices everywhere drop overnight, and old loans get cheaper too'
    }, 'B',
    'A higher central bank rate is passed along: loans cost more, savings pay more, and people and firms tend to spend a little less. It builds up over months, and how fast varies by country.'),

  L(28, 'How Currencies Work',
    'What gives a currency its value, and why an exchange rate moves.', [
      'A currency is a country\'s money. Its value is not the number printed on the bill. It is what the money buys at home, and what other people will swap for it. The exchange rate is the price of one currency in another. Say a dollar swaps for four zubs, where the zub is a made-up currency.',
      'Three forces push the rate around. Interest rates: a country paying savers more can attract money from abroad, which lifts demand for its currency. Trade: if the world buys a lot from a country, buyers need its money. Confidence: if people doubt a country\'s future, they swap out and its currency weakens. Usually it is a mix, and nobody times it reliably. The same souvenir can cost you a different amount from one month to the next.',
      'Practice lab: pick a made-up exchange rate, swap some dollars into foreign money, price one souvenir there, then move the rate and see how the same souvenir costs a different number of dollars.'
    ],
    'Ava\'s home currency weakens against the money of the country she is visiting. What happens to her trip?',
    {
      A: 'Prices there fall for her, so the whole trip gets cheaper for her',
      B: 'Her home money stops working there, so shops turn it down flat',
      C: 'Local prices cost her more home money, so the trip gets pricier',
      D: 'Nothing changes, because a price tag abroad is a fixed number'
    }, 'C',
    'When the home currency weakens, each unit of it buys less foreign money. The same local price then costs more home money, so a trip abroad gets pricier.'),

  L(29, 'How Investment Banks and Hedge Funds Make Money',
    'Fees for arranging deals, and fees plus a share of gains for running a fund.', [
      'An investment bank is not the bank that holds your paycheck. It helps companies raise money and do big deals: selling new shares or bonds, or merging with another company. It earns a fee, often a percentage of the money raised or the deal value. The fee is paid when the deal happens, whether or not the new shares do well later.',
      'A hedge fund is a private pool of money from wealthy people and big institutions, run by managers who use many trading styles. A common pay setup is a yearly fee on the assets plus a share of the gains, though terms vary. Managers gain from more assets and bigger profits. Clients carry the losses, and the fee still applies. Rules differ by country. It helps to ask whose pay depends on what.',
      'Practice lab: take a made-up fund with a yearly fee and a profit share, run one good year and one bad year, and compare what the manager collects with what the clients keep.'
    ],
    'A hedge fund charges a yearly fee on its assets plus a share of any gains. What does that pay setup reward?',
    {
      A: 'Growing the assets and producing gains, since both raise the manager\'s pay',
      B: 'Keeping the assets small, since fewer clients means less paperwork',
      C: 'Refunding losses to clients, since the profit share works both ways',
      D: 'Trading as little as possible, since the fee is charged in quiet years'
    }, 'A',
    'A fee on assets plus a share of gains pays the manager more when the fund is larger and the gains are bigger. Losses fall on the clients, which is why it helps to know how a manager is paid.'),

  L(30, 'Investing Through a Recession and at All-Time Highs',
    'Recessions are part of the cycle, records are common, and the real risk is needing the money soon.', [
      'A recession is a stretch when the economy shrinks: less spending, fewer new hires, weaker company profits. Recessions come and go as part of the business cycle, though nobody can time one. Share prices often fall during or before them, sometimes a lot. Recoveries have followed in the past, but the wait varies and nothing is promised.',
      'An all-time high is just the highest price so far. When an economy grows over the years, new highs happen often, so a record is not a doom sign. The real risk is needing the money soon. If rent, tuition or a house deposit is due next year, a fall can force a sale at a loss. Money with years to wait has more room to ride out a rough patch. Selling in a panic locks the loss in, like leaving the cookout before the food comes out.',
      'Practice lab: take a made-up stake, drop it by a third, and compare a holder who sells with one who waits for a recovery, then ask what changes if the cash is needed next month.'
    ],
    'Ravi needs his house deposit in one year, and the market sits at an all-time high. What is his biggest risk?',
    {
      A: 'The record itself, since prices always fall right after a high',
      B: 'Missing out, since prices stop climbing once a record is set',
      C: 'Nothing at all, since a record proves the economy keeps growing',
      D: 'Prices dipping right when the cash is due, leaving him to sell low'
    }, 'D',
    'Records are common and are not a doom sign. The danger is a fall arriving just when the money is needed, which can force a sale at a loss. Money with time to wait has more room to recover.')
];
