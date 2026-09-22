'use strict';

/* Knowledge checks for Module 0 "Start Here", lessons 8-13 (builder b).
 *
 * House rules from ../quizzes.js, applied by hand: the prompt ends with a
 * question mark, the four options are distinct, no option starts with its own
 * letter, the answer's length sits inside the spread of the wrong ones, and the
 * explanation is 20-260 characters. Options stay under ~70 characters because
 * commands.js renders them as Discord buttons.
 *
 * Each check must be answerable from its lesson and its whiteboard example, but
 * must not repeat a sentence from either, and must not be guessable: every wrong
 * option is a mistake a first-time investor actually makes. The correct letter
 * follows the module plan's sequence (8-13: D A B C A B).
 *
 * Educational only. Fictional people and fictional companies, no real tickers,
 * no advice, no guarantees. */

module.exports = {
  /* 0.8 Dollar-cost averaging. Tests whether the learner averages the MONEY or
   * the price list. $600 at $12 is 50 units, $600 at $4 is 150 units. */
  '0.8': {
    prompt: 'Someone puts $600 in at $12 a unit and $600 in at $4 a unit. What is the average cost per unit?',
    options: {
      A: '$8, the middle of the two prices paid',
      B: '$4, since most of the units came at that price',
      C: 'It cannot be known until the price is checked later',
      D: '$6, because the low price bought far more of the units',
    },
    correct: 'D',
    explanation: 'The same money buys 50 units at $12 and 150 units at $4, so $1,200 buys 200 units, which is $6 each. The money spent, not the list of prices, sets the average, and no later price is needed.',
  },

  /* 0.9 Spreading money. The trap is treating diversification as a guarantee
   * (B) or as a one-sided benefit (C). */
  '0.9': {
    prompt: 'Nia holds four companies instead of one. What has she actually changed?',
    options: {
      A: 'The size of her worst outcome and of her best one',
      B: 'Her chance of losing money, which is now zero',
      C: 'Only the worst outcome, since her best is untouched',
      D: 'Nothing, because the same money is invested either way',
    },
    correct: 'A',
    explanation: 'Spreading changes how big the outcomes are, not whether a loss can happen. It cut her collapse to a quarter of her money and cut her doubling to a quarter as well, and four companies can still fall together.',
  },

  /* 0.10 Index funds. The trap is thinking someone steps in to sell the bad
   * name (A), or that the fund moves like the one company (C). */
  '0.10': {
    prompt: 'A fund copies a ten-name list and one name on it collapses. What happens to the fund?',
    options: {
      A: 'It sells that name before the fall, since someone manages it',
      B: 'It drops by that name\'s share and keeps holding the other nine',
      C: 'It drops by the same percentage the name itself dropped',
      D: 'Nothing, because funds are protected from a company failing',
    },
    correct: 'B',
    explanation: 'A fund that copies a list holds every name on it, so one collapse takes only its own slice of the money. The rest keep their value, and nothing promises the list itself will hold up.',
  },

  /* 0.11 Two wrappers. The trap is inventing a difference in what is held (A)
   * or reading "priced once a day" as safety (B). */
  '0.11': {
    prompt: 'Two products hold exactly the same ten companies, one as a fund and one as an ETF. What differs for a buyer?',
    options: {
      A: 'The ETF holds extra companies picked for easy trading',
      B: 'The fund is safer, because it is priced only once a day',
      C: 'When the purchase happens and at what price it is filled',
      D: 'An ETF has to be sold on the same day it is bought',
    },
    correct: 'C',
    explanation: 'Both wrappers hold the same list. One fills everybody at a single end-of-day value, while the other is filled at a market price that moves all day and can sit a little above or below what it holds.',
  },

  /* 0.12 Fees. The trap is believing the charge comes out of gains (B) or
   * shrinks with the fund (C). */
  '0.12': {
    prompt: 'A fund charges one percent a year. In a year when the fund falls ten percent, what does the fee cost?',
    options: {
      A: 'One percent of the balance, taken even though the fund fell',
      B: 'Nothing, since a fund only charges a fee out of gains',
      C: 'One percent of the loss, so the fee shrinks with the fund',
      D: 'Ten percent of the balance, because the fee follows results',
    },
    correct: 'A',
    explanation: 'The yearly charge is a slice of everything held, not a slice of profit, so it is taken in losing years too. It comes out of the fund\'s own value, which is why no bill ever arrives.',
  },

  /* 0.13 Dividends. The trap is treating the payment as money on top of the
   * price (A and C), or as a signal of a coming rise (D). */
  '0.13': {
    prompt: 'A company pays its dividend. What usually happens to the share price on the morning it goes out?',
    options: {
      A: 'It rises by the payment, since the shares just earned cash',
      B: 'It opens roughly the payment lower, as that cash has left',
      C: 'It does not move, because the payment is separate from it',
      D: 'It climbs over the next week by twice the payment',
    },
    correct: 'B',
    explanation: 'The cash leaves the company on its way to the owners, so the shares are worth that much less the moment they trade without the next payment attached. It is a transfer, not an extra.',
  },
};
