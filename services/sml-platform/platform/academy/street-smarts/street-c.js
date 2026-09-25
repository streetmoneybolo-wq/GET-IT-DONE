'use strict';

/* Street Smarts lessons (module 29), file c: lessons 13-18.
 *
 * Stocks vs bonds, bond basics, the yield curve, ranking assets by how much
 * they swing, the fund family (index, mutual, ETF, hedge) and the ways an
 * index fund can still lose. Education only: no advice, no promises, no real
 * companies, funds or indexes. Where a rule differs by country the lesson says
 * so. Same L() shape as the other tracks (exactly 3 steps, steps[2] is the
 * Practice lab, a 4-option question, the default simulation). */

const { simulationFor } = require('../simulations');

const FOUNDATION_COLOR = 0x00E676; // LEVEL_COLOR.Foundation in curriculum.js
const DURATION = '10 min';
const MODULE_ID = 29;

function L(lessonId, title, description, steps, prompt, options, correct, explanation) {
  const lesson = {
    moduleId: MODULE_ID,
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

const STREET_C = [
  L(13, 'Stocks vs Bonds',
    'Owning a slice of a business versus lending it money, and why many people hold both.', [
      'A stock is a slice of a business. Say you own a slice of a wing spot. When the place packs out, your slice is worth more, and when the fryer breaks, it is worth less. Nobody promises you a payout, and if the business fails, the owners get paid last. A bond is the opposite deal. You lend money to a company or a government, and they promise set payments plus your money back on a fixed date.',
      'Each one can lose in its own way. A stock can fall hard, even to zero. A bond can lose if the borrower cannot pay, which is called a default, or if you sell early after rates rose. Bond payments are usually smaller and steadier than what a stock can swing. Many people hold some of each, like a corner store that sells hot food and shelf goods. One side leans toward growth, the other toward steadier income.',
      'Practice lab: take 1,000 practice dollars and split it in half. Then write one way the stock half could lose money and one way the bond half could lose money, in your own words.'
    ],
    'Kofi buys $500 of a wing spot\'s stock and Zoe lends the city $500 through a bond. What is true about the two?',
    {
      A: 'Kofi owns a slice with no promised payout; Zoe is owed set payments',
      B: 'Zoe owns a slice of the city, so she shares in whatever it earns',
      C: 'Both of them are lenders, so both are owed the same fixed payments',
      D: 'Kofi is shielded from loss because owning a slice means owning real stuff'
    }, 'A',
    'A stock is ownership with no promised payout, while a bond is a loan with promised payments. Owners take the swings of the business; lenders take the risk that the borrower cannot pay.'),

  L(14, 'Bond Basics: Lending Money for a Coupon',
    'Face value, coupon and maturity, plus the see-saw between interest rates and bond prices.', [
      'A bond is a loan you can trade. Picture a friend who borrows money for a food truck and writes down a deal. The face value is the amount to be repaid, like 1,000 dollars. The coupon is the yearly interest, quoted as a percent of face value. The maturity is the date the loan ends and the face value comes back.',
      'Yield is what a buyer earns at today\'s price. The quick version is the yearly coupon divided by the price paid. Now the see-saw. If you hold a 4 percent bond and new bonds start paying 5 percent, nobody pays full price for yours. Its price falls until a new buyer gets a fair deal. If rates fall, your older coupon looks better and the price rises. Longer bonds swing more. A borrower who pays still returns the full face value at maturity.',
      'Practice lab: write a bond with a 1,000 dollar face value and a 4 percent coupon. Work out the yearly coupon, then say what happens to its price when new bonds start paying 5 percent.'
    ],
    'A bond pays a 4 percent coupon. Rates rise and new bonds pay 5 percent. What usually happens to the older bond\'s price?',
    {
      A: 'It rises, because steady payments become more valuable to buyers',
      B: 'It stays put, since the face value and the coupon are both fixed',
      C: 'It only changes if the borrower misses a payment along the way',
      D: 'It falls, so a new buyer\'s yield lines up with the newer bonds'
    }, 'D',
    'Buyers can get 5 percent on new bonds, so the older bond has to get cheaper until its yield catches up. The coupon and face value never change, but the price does. That is the see-saw.'),

  L(15, 'The Yield Curve: Why Short and Long Rates Disagree',
    'What a normal and an inverted yield curve look like, and why a signal is not a promise.', [
      'A yield curve lines up what a government pays to borrow for different lengths of time, from a few months up to thirty years. Think of the price list at a car wash: quick wash, full wash, deluxe. Normally the longer you lend, the more you are paid, because tying your money up for years is a bigger ask. That upward slope is a normal curve.',
      'Sometimes the slope flips, and short loans pay more than long ones. That is called an inverted curve. One common reading is that lenders expect rates and growth to fall later, so they lock in long loans now. Inverted curves have often come before slowdowns, but that is a signal, not a promise, and it can be early or wrong. Rules, markets and history differ by country, so a curve in one place says little about another.',
      'Practice lab: write three made-up rates for one year, five years and ten years. Draw them once as a normal curve and once as an inverted one, and say what each shape seems to tell you about lenders.'
    ],
    'Ravi sees that one-year government bonds pay more than ten-year ones. What is the best way to describe that?',
    {
      A: 'Normal shape, since long loans always pay less than short ones',
      B: 'A default, because the ten-year borrower has stopped paying anyone',
      C: 'An inverted curve, which has often come before slowdowns but proves nothing',
      D: 'A sure crash signal within the year, which works like a countdown clock'
    }, 'C',
    'When short rates beat long rates the curve is inverted. It has often come before slowdowns, yet it is only a signal, and the record differs from country to country.'),

  L(16, 'Ranking Assets From Calm to Wild',
    'A rough order of how much value can swing, and why risk is not the same as reward.', [
      'Line up places to park money from calm to wild by how much the value can swing. Cash sits at the calm end, though rising prices slowly shrink what it can buy. Next come short bonds, then long bonds, which swing more when rates move. Then broad stock funds, which hold many companies at once. Single stocks swing harder because one business carries all the weight. At the wild end sit speculative bets, like flipping sneakers from a hyped drop.',
      'This is a rough order, not a law. A long bond can have a worse year than a stock fund. A single stock in a steady business can be calmer than you would guess. Also, risk is not the same as reward. A wilder ride can pay more over time, or it can just hurt more. Nobody gets paid extra for every bit of risk. Time horizon and comfort with swings shape what suits a person.',
      'Practice lab: rank six made-up holdings from calmest to wildest. Then write one sentence about a situation where your order could turn out wrong.'
    ],
    'Nia ranks four places to park money by how much the value can swing. Which order runs from calmest to wildest?',
    {
      A: 'Cash, a single stock, short bonds, then a broad stock fund',
      B: 'Cash, short bonds, a broad stock fund, then a single stock',
      C: 'Short bonds, cash, a single stock, then a broad stock fund',
      D: 'A broad stock fund, cash, short bonds, then a single stock'
    }, 'B',
    'Cash swings least, short bonds a bit more, and a broad fund spreads its risk across many businesses. One stock carries all of its own risk. The order is rough, and a wilder ride is no promise of more reward.'),

  L(17, 'Index Funds, Mutual Funds, ETFs and Hedge Funds',
    'What each kind of fund is, who runs it, what it costs and who is allowed to buy it.', [
      'Four names, four different tools. An index fund follows a list of companies, like the biggest hundred, and holds them all with almost no picking. A mutual fund pools many people\'s money and is priced once a day. It can be run by a manager who picks holdings or by a simple rule. An ETF is a fund that trades on an exchange all day like a share, and many ETFs follow an index too.',
      'A hedge fund is a private pool for qualified investors, free to use tactics ordinary funds skip. It often charges a yearly fee plus a cut of profits. Costs differ a lot, and a pricier fund is not automatically better or worse. Who may buy hedge funds, and how they are regulated, differs by country. None of the four is good or bad. They are different tools, like a barbershop, a nail salon and a car wash.',
      'Practice lab: make a small table with the four fund types. For each one write who runs it, how you buy it, and the yearly cost you would look up before buying.'
    ],
    'Ava asks how a hedge fund differs from an index fund. Which description is accurate?',
    {
      A: 'It trades on an exchange all day and any beginner can buy it',
      B: 'It follows a public list of companies and charges the lowest fees',
      C: 'It is a bank product backed by the government against any loss',
      D: 'It is a private pool, usually for qualified investors, with higher fees'
    }, 'D',
    'A hedge fund is a private pool that is usually limited to qualified investors, with more flexible tactics and higher fees. An index fund follows a public list and is open to almost anyone.'),

  L(18, 'Ways an Index Fund Can Still Lose Money',
    'Market drops, concentration, bad timing, fees and panic selling: diversified does not mean protected.', [
      'A broad index fund holds hundreds of companies, so one company failing hardly dents it. That is diversification. It does not shield the fund from the whole market falling. If everything drops in a rough year, the fund drops with it. Some funds also lean on a few giant names or one industry, so when those stumble, the whole fund feels it.',
      'Bad timing, fees and panic finish the job. Buying right before a fall, then selling at the bottom, turns a paper loss into a real one. Fees come out every year, up or down, like a subscription that never pauses. A fund that fell 30 percent needs about a 43 percent gain to get back, because the gain is measured on a smaller balance. No rule says a recovery arrives on a set schedule.',
      'Practice lab: put 10,000 practice dollars in a made-up fund and drop it 30 percent. Work out the gain needed to get back, then write what selling at the bottom would do to the result.'
    ],
    'Nia owns a broad index fund and the whole market drops 30 percent. Which statement is accurate?',
    {
      A: 'Her fund drops too, since owning many companies cannot shield it from a broad fall',
      B: 'Her fund holds up, since hundreds of holdings cancel out any loss it might have',
      C: 'Her fund is insured against the drop, so the loss is refunded to her in time',
      D: 'Only funds run by a manager fall, while index funds stay level in a big drop'
    }, 'A',
    'Diversification spreads out the risk of one company failing, but it cannot remove the risk of the whole market falling. A broad fund falls with the market, and no insurance refunds that.')
];

module.exports = STREET_C;
