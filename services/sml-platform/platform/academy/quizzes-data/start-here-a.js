'use strict';

/* Knowledge checks for module 0 "Start Here", lessons 1 to 7.
 *
 * Each one is answerable from its lesson and its whiteboard example, copies no
 * sentence from either, and its wrong options are the mistakes a first-time
 * trader actually makes (a share mistaken for a loan, a high share price
 * mistaken for a big company, a protection scheme mistaken for insurance
 * against losses, a limit order mistaken for a guaranteed fill, "no
 * commission" mistaken for "no cost", a percentage loss mistaken for a mirror
 * of the gain that undoes it, and compounding mistaken for a bonus).
 *
 * These are the same objects the lessons carry inline in
 * start-here/starter-a.js, because curriculum.js's L() helper takes its
 * question directly and never consults quizFor(). Keep the two in step: if a
 * prompt changes here it must change there too.
 *
 * Correct letters run B, C, D, A, B, C, A across these seven. */

module.exports = {
  '0.1': {
    prompt: 'Ava owns 10 of a bakery\'s 1,000 shares. What does she own?',
    options: {
      A: 'Money lent to the bakery that it must pay back with interest',
      B: 'One hundredth of the business, its profits and its losses',
      C: 'Her broker\'s promise to buy the shares back at what she paid',
      D: 'The right to a fixed payment from the bakery every year',
    },
    correct: 'B',
    explanation: 'A share is ownership, not a loan and not a promise. Ten slices out of a thousand is one hundredth of the bakery, so they stand behind one hundredth of any profit and one hundredth of any loss.',
  },
  '0.2': {
    prompt: 'Fizz Town trades at $4 and Lagoon Lane at $400. Which is the bigger business?',
    options: {
      A: 'Lagoon Lane, because one of its shares costs a lot more',
      B: 'Fizz Town, because more buyers can afford a cheap share',
      C: 'Neither, until each price is multiplied by its share count',
      D: 'They match, because price and share count always balance',
    },
    correct: 'C',
    explanation: 'The size of a business is its share price multiplied by how many shares exist. A four dollar share can belong to a far bigger company than a four hundred dollar one if there are many more of them.',
  },
  '0.3': {
    prompt: 'Ava\'s shares fall from $20 to $15. What does a broker protection scheme cover here?',
    options: {
      A: 'Her whole $100 loss, because the account itself is protected',
      B: 'The loss, but only up to the scheme\'s limit for the year',
      C: 'Everything she paid, since the shares were bought inside it',
      D: 'Nothing; it replaces missing cash and shares if the firm fails',
    },
    correct: 'D',
    explanation: 'A protection scheme steps in when the brokerage firm fails and a customer\'s cash or shares go missing. A price that simply fell is an ordinary investment loss, and no scheme anywhere refunds that.',
  },
  '0.4': {
    prompt: 'What does a limit order to buy at $25 actually promise?',
    options: {
      A: 'That no more than $25 a share will ever be paid',
      B: 'That the shares will be owned before the day ends',
      C: 'That the price paid will come in below $25 a share',
      D: 'That the price will fall back to $25 before long',
    },
    correct: 'A',
    explanation: 'A limit sets the worst price that is acceptable and nothing else. It cannot make a seller appear, so the order may never fill, and it is neither a discount nor a forecast that the price will come back.',
  },
  '0.5': {
    prompt: 'Zoe\'s broker charges no commission. Where does the cost of her twelve round trips come from?',
    options: {
      A: 'From a monthly account fee she has not noticed on her statement',
      B: 'From the gap between the price she buys at and the price she sells at',
      C: 'Nowhere, because commission-free trades really are free to make',
      D: 'Only from the tax she will owe later on any gain she makes',
    },
    correct: 'B',
    explanation: 'She buys at the higher of the two quoted prices and sells at the lower one, so each round trip hands over that gap. A broker that charges no commission is paid in other ways instead.',
  },
  '0.6': {
    prompt: 'A practice account falls 80 percent. What gain brings it back to where it started?',
    options: {
      A: '80 percent, the same figure that was lost on the way down',
      B: '100 percent, because doubling always undoes a halving',
      C: '400 percent, because a fifth has to become a whole again',
      D: '180 percent, the fall itself plus a doubling on top',
    },
    correct: 'C',
    explanation: 'An 80 percent fall leaves a fifth of the money. Turning a fifth back into a whole means multiplying it by five, which is a gain of 400 percent. Matching the percentage back works only when nothing was lost.',
  },
  '0.7': {
    prompt: 'Why does three years of ten percent growth on $1,000 end above $1,300?',
    options: {
      A: 'Each year\'s ten percent is taken on a bigger amount than the last',
      B: 'The real rate must have been higher than the ten percent stated',
      C: 'Growth was added every month instead of once at the year\'s end',
      D: 'The final year pays an extra bonus for having held on so long',
    },
    correct: 'A',
    explanation: 'The first year of ten percent is taken on $1,000, the second on $1,100 and the third on $1,210. The pile grows each time, so the gains grow too and the total passes three flat gains of $100.',
  },
};
