'use strict';

/* Knowledge checks for Start Here (module 0), lessons 14-20.
 *
 * Each check is answerable from its lesson and its whiteboard example, but
 * never by copying a sentence out of either: where the example uses one set of
 * numbers the check uses another, so a learner who only remembers the figures
 * cannot pass. The wrong options are the mistakes a first-time trader actually
 * makes - taxing a gain that has not been sold, reading an option's value as
 * profit, counting the winner and forgetting the losers.
 *
 * platform/academy/start-here/starter-c.js imports this file, so these objects
 * are the single source for both the lesson's inline question and the authored
 * quiz data. Integrator: see openIssues before wiring this into
 * quizzes-data/index.js - assertQuizzes/quizzes.test.js count only 14-28. */

module.exports = {
  '0.14': {
    prompt: 'Nia\'s shares are worth $600 more than she paid and she has not sold. What is taxed?',
    options: {
      A: 'The $600, because the gain already exists on her screen',
      B: 'The $600, at the lighter treatment a long hold can get',
      C: 'Usually nothing yet, since most systems tax a gain on sale',
      D: 'Nothing ever, because gains on shares are never taxed',
    },
    correct: 'C',
    explanation: 'In most systems a gain is taxed when it is sold, not while it sits on a screen. Choosing a long-hold treatment for a sale that has not happened skips that step, and a delay is not the same as an exemption.',
  },
  '0.15': {
    prompt: 'Ava can clear a card charging 18% a year or invest the same money. What makes the card different?',
    options: {
      A: 'Its cost is known in advance, while the return is not',
      B: 'The card charges more than any investment could return',
      C: 'Nothing, since both come to 18% and cancel out',
      D: 'Investing always wins, because money grows over time',
    },
    correct: 'A',
    explanation: 'The card\'s interest happens whatever markets do, so its cost is knowable today. The investment might return more, less or nothing, and a rate on a debt is not a forecast for a fund.',
  },
  '0.16': {
    prompt: 'A year of growth leaves one slice much bigger than the rest. What does selling some of it to buy the laggards do?',
    options: {
      A: 'Locks in the winner\'s gains so they can never be lost',
      B: 'Raises the expected return by buying whatever is cheap',
      C: 'Removes any need to hold bonds or cash in the mix',
      D: 'Puts the mix back to the proportions that were chosen',
    },
    correct: 'D',
    explanation: 'Rebalancing restores the proportions you picked and nothing more. It is not a way to bank a winner, it makes no promise about future returns, and the bond and cash slices stay because you chose them.',
  },
  '0.17': {
    prompt: 'A calendar rule has worked four times out of five. Why is that weak evidence?',
    options: {
      A: 'Eighty percent is below the 95% that real proof needs',
      B: 'Five cases are few enough that luck often looks like this',
      C: 'Past results in markets never repeat, so no rule holds',
      D: 'Nobody has tested the rule with a proper computer',
    },
    correct: 'B',
    explanation: 'Flip one of the five and the record falls to three out of five. A fair coin gives a record that good in roughly one run in five. The weakness is the tiny sample, not a missing percentage threshold and not some law that patterns never repeat.',
  },
  '0.18': {
    prompt: 'A $30-strike call costs $3 a share and the stock finishes at $31. What does the buyer end up with?',
    options: {
      A: 'Profit of $100, since it finished above the $30 strike',
      B: 'Nothing at all, because break-even at $33 was not reached',
      C: '$100 back on the contract, so a $200 loss after the premium',
      D: 'The $300 premium refunded, since it finished above the strike',
    },
    correct: 'C',
    explanation: 'The call is worth $31 minus $30, which is $1 a share, so 100 shares return $100. She paid $300, so she is down $200. Finishing above the strike is not the same as making money, and there is no refund.',
  },
  '0.19': {
    prompt: 'Nia sells a covered call and the stock jumps far above the strike. What has she given up?',
    options: {
      A: 'Everything the shares gained above the strike, for the premium',
      B: 'Nothing, since she keeps the premium whatever the stock does',
      C: 'Her shares, which she must now buy back at the higher price',
      D: 'Only the gain above her own break-even price on the shares',
    },
    correct: 'A',
    explanation: 'The premium was payment for capping her upside at the strike. She already owned the shares, so nothing has to be bought back, and the whole fall below her own cost still belongs to her.',
  },
  /* 0.20 "return $400" had two defensible readings - $400 back, or $400 of
   * profit - and the old option C was written in the wording of the second
   * one, so a learner who reasoned correctly could still be marked wrong.
   * "Sold for $400" can only mean money back, and C is now the mistake of
   * counting the winners and leaving the losers out. */
  '0.20': {
    prompt: 'Eight of ten $100 option bets expire worthless. The other two are each sold for $400. How did the year go?',
    options: {
      A: 'Up $700, the two winners minus the single loser they cover',
      B: 'Up 300 percent, because each winner quadrupled what it cost',
      C: 'Up $600, counting the two sales and ignoring the eight that failed',
      D: 'Short by $200, since the winners returned less than the bets cost',
    },
    correct: 'D',
    explanation: 'Ten bets at $100 cost $1,000 and the two sales bring back $800, so the year is down $200. Sold for $400 means $400 comes back, not $400 of profit, and one big multiple is not a year.',
  },
};
