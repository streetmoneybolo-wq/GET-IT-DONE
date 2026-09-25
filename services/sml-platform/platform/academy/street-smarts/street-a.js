'use strict';

/* Street Smarts lessons (module 29), file a: lessons 1 to 6. Authored by the Street Smarts team; see street-smarts/index.js.
 *
 * Plain-words lessons for a complete beginner, read aloud by the Academy voice. Original scenarios and numbers, fictional
 * businesses and the usual cast (Ava, Kofi, Zoe, Ravi, Nia). Educational only: no advice, no guarantees, no real companies.
 * Where a rule differs by country the lesson says so instead of quoting one number. */

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
  L(1, 'How a Stock Price Actually Gets Set',
    'Nobody sets a price: buyers and sellers meet in the middle, and the last trade is only the latest handshake.', [
      'Nobody sits in an office and sets a stock\'s price. Think of haggling at a flea market. The seller wants a high number, the buyer wants a low one, and a deal only happens where they meet. Buyers post bids, the most they will pay. Sellers post asks, the least they will accept. Line them all up and you have what is called the order book.',
      'A trade happens only when a bid and an ask match. The price of that trade shows on your screen as the last price. It is just the latest handshake, not a rule. If more buyers than sellers show up, buyers raise their bids to win, so the price drifts up. If sellers crowd in, it drifts down. Prices move because people change their minds, not because a company pressed a button.',
      'Practice lab: a sneaker drop has 5 pairs and 8 people who want one. Write down who bids what, and say what happens to the price as the sellers keep asking for more. Then flip it to 8 pairs and 5 buyers, and say which way the price drifts.'
    ],
    'Kofi sees that a stock\'s last price is $50. What does that number really tell him?',
    {
      A: 'What the company officially says one share is worth today',
      B: 'The price the exchange promises for the very next trade',
      C: 'The price where a buyer and a seller last agreed to deal',
      D: 'Whatever the biggest shareholder decides it should be that day'
    }, 'C',
    'The last price is a record of one completed trade. It does not promise the next trade will match it, because bids and asks keep changing.'),

  L(2, 'Why the Market Can Rise When the Economy Feels Bad',
    'Stock prices look ahead at profits, interest rates and expectations, so the market is not the economy.', [
      'The stock market and the economy are cousins, not twins. The economy is everything people make, buy and sell: jobs, rent, grocery bills. The market is a scoreboard of share prices. Those prices are set by people betting on what comes next, not by the mood in your group chat today. So the chat can be gloomy about rent while prices climb, and neither is lying.',
      'Three things push prices. First, company profits: what businesses are expected to earn in the years ahead. Second, interest rates: when borrowing gets cheaper, businesses can grow and future profits look better today. Third, expectations: prices already hold what people think will happen, so a surprise moves them more than old news. A bad month everyone saw coming may already be in the price.',
      'Practice lab: picture a made-up car wash chain with a rough year ahead. Investors feared its profit would collapse, and it only dipped. Say why its shares might rise on the day of the bad headline, and what would have to happen for them to fall instead.'
    ],
    'Zoe asks why shares rose the day a rough economic report came out. What is the best answer?',
    {
      A: 'Prices held the fear already, and the report beat what people expected',
      B: 'Every piece of bad news makes investors rush to buy more shares',
      C: 'The exchange lifts prices whenever the economy feels weak, to calm people',
      D: 'Shares mirror the economy day by day, so the report must have been wrong'
    }, 'A',
    'Prices move on what people expect versus what arrives. A report that is bad but better than feared can lift shares, because the market was already looking ahead.'),

  L(3, 'Where the Money Goes When the Market Crashes',
    'Most crash losses are paper value that fades as prices fall, and only selling makes them real.', [
      'When the market crashes, headlines say billions vanished. Where did it go? Mostly nowhere, because it was never cash in a drawer. It was paper value: the last price times the number of shares. If one share drops from $10 to $6, every share of that company loses $4 on paper, even the shares nobody touched.',
      'Cash only changes hands when someone sells, and every sale has a buyer. No one carried a suitcase of money out the back door. The seller takes a real loss, and the buyer now owns the share at the lower price. Everyone who holds on has a loss that only exists on a screen. It can shrink, grow or stay put. If a company truly earns less, though, the old price may not come back.',
      'Practice lab: a made-up hair salon chain has 100 shares at $10 each. The price falls to $6. Work out the paper loss on all 100 shares. Then say what changes for the one owner who sells to pay rent, and what changes for the buyer.'
    ],
    'Ava owns shares and does nothing while the price drops sharply. What is her loss?',
    {
      A: 'Fully real already, because the cash was taken out of her account',
      B: 'Cancelled out completely, since every seller is matched by a buyer',
      C: 'None at all, since numbers on a screen cannot cost anything',
      D: 'Still only a paper loss, which turns real if she sells at the low price'
    }, 'D',
    'Falling prices shrink the value of shares on paper. Money only leaves the picture for someone who sells lower than they paid, so Ava\'s loss stays unrealized until she decides.'),

  L(4, 'Market Talk Decoder',
    'Bull, bear, volume, spread, liquidity, gap and correction, told as one small story.', [
      'Here is one story that uses every word. A made-up food truck company, Taco Tide, is on a roll. Its price climbs week after week. That is a bull market: prices rising and everyone feeling brave. Volume, the number of shares traded in a day, is high because everyone wants in. So many buyers and sellers are around that the market is liquid, meaning you can trade fast without moving the price. The spread, the gap between bid and ask, is tiny.',
      'Then bad news lands overnight. The stock opens far below yesterday\'s close, skipping every price in the middle. That jump is a gap. Prices keep sliding until they sit ten percent under the recent high, which traders call a correction. Past twenty percent, and with a gloomy mood, people say bear market. Volume spikes, liquidity thins and the spread widens, because buyers step back and sellers rush the door.',
      'Practice lab: write bull, bear, volume, spread, liquidity, gap and correction on seven cards. Match each card to one line of the Taco Tide story. Then tell the same story again with a barbershop chain, using every word once.'
    ],
    'Zoe hears that a stock gapped down overnight. What just happened?',
    {
      A: 'Its price slid slowly, one small trade at a time, all through the night',
      B: 'It opened far under the last close and skipped the prices in between',
      C: 'Its bid and ask drifted apart while the market was still open',
      D: 'It fell ten percent below its high, which is a normal pullback'
    }, 'B',
    'A gap is a jump between one close and the next open with no trades in between. Sliding slowly, a wide spread and a correction are different ideas.'),

  L(5, 'Short Selling: Betting on the Drop',
    'How borrow, sell and buy back works, why the gain is capped and the loss is not, and what a squeeze is.', [
      'Short selling is a bet that a price will fall. Picture Nia borrowing Kofi\'s sneakers and selling them today for $200. Later she buys the same pair back for $150 and returns it. She keeps the $50 difference. That is a short: borrow, sell, buy back later. With shares, the broker arranges the borrowing. This is education only, and the rules differ by country and by broker.',
      'The catch is the shape of the bet. A price cannot fall below zero, so the most a short seller can gain is what the shares sold for. A price can climb with no ceiling, so the possible loss has no limit. Borrowing also costs a fee. If the price jumps and shorts rush to buy back, that rush pushes it even higher. That scramble is called a squeeze.',
      'Practice lab: say Nia sells 10 borrowed shares at $20. Work out her gain if she buys back at $15 and her loss if she buys back at $30. Then write down why the best case has a ceiling and the worst case does not.'
    ],
    'Kofi shorts a share. What is unusual about his possible gain and loss?',
    {
      A: 'His most possible gain is limited, but his possible loss has no top',
      B: 'His loss is limited to the fee, because the broker owns the share',
      C: 'His gain is unlimited, while his loss stops at the price he sold',
      D: 'He is protected from losing money, since he sold before the move'
    }, 'A',
    'A share can only fall to zero, so a short can gain at most the sale price. A share can rise without a ceiling, so a short can lose far more than that.'),

  L(6, 'Arbitrage: One Thing, Two Prices',
    'When the same item sells for two prices at once, and why crowds and costs shrink the gap.', [
      'Arbitrage means the same thing is priced differently in two places at the same moment. Picture a flea market where one stall sells a lamp for $30 and another sells the identical lamp for $40, both open today. Someone can buy at the cheap stall and sell at the pricey one. That gap is the whole idea, and it is a small hustle, not a jackpot.',
      'It is not free money. Once people notice, they pile in. Buying at the cheap stall pushes that price up, and selling at the pricey one pushes that price down, so the gap shrinks. Then costs eat what is left: fees, shipping, taxes and the chance a price moves before the second trade. Fast firms with powerful computers usually grab these gaps first, and even they can lose.',
      'Practice lab: buy 100 shares of a made-up company at $20 on one board and sell them at $21 on another. Work out the gap, then take off $30 in fees for each trade. Now shrink the gap to 50 cents and see what is left.'
    ],
    'Nia spots one item priced two ways in two places. Why can she not count on keeping the whole gap?',
    {
      A: 'Exchanges refuse to let anyone trade the same item twice in one day',
      B: 'Gaps only ever show up on items that nobody actually wants to buy',
      C: 'Others close the gap fast, and fees can swallow whatever remains',
      D: 'The two prices always move together, so no gap can ever appear'
    }, 'C',
    'A price gap draws traders who buy the cheap side and sell the dear side until it narrows. Fees and delays take a bite too, so the gap on the screen is not what ends up in her pocket.')
];
