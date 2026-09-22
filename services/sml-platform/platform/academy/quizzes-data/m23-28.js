'use strict';

/* Knowledge checks for modules 23-28. Each one must be answerable from the lesson's
 * principle and its whiteboard example, with wrong options that are the mistakes a
 * beginner actually makes. Vary which letter is correct. Do not reuse the example's
 * own numbers as the answer: test the idea, not recall. */

module.exports = {
  /* Module 23 - derivatives */
  '23.1': {
    prompt: 'Coffee costs $200 today, a year of storage costs $6, and $10 of interest is given up. Everyone expects $190 next year. What is the fair one-year futures price?',
    options: { A: '$190', B: '$216', C: '$206', D: '$200' },
    correct: 'B',
    explanation: 'Carry is added to today\'s price: $200 + $10 of interest + $6 of storage = $216. The $190 forecast does not set the futures price, and $206 forgets the interest given up.',
  },
  '23.2': {
    prompt: 'Nadia owes $2,000 at a floating rate and swapped into a fixed 4%. Rates rise to 9% and her swap partner fails. What does the loan cost her a year now?',
    options: {
      A: '$80, because the fixed rate is locked in',
      B: '$260, because she pays both the fixed and the floating',
      C: '$180, the floating cost with no swap to offset it',
      D: '$100, the extra the swap had been covering',
    },
    correct: 'C',
    explanation: 'The swap held her cost at $80 only while the partner paid the floating leg. With the partner gone she owes 9% of $2,000, or $180, on the loan itself.',
  },
  '23.3': {
    prompt: 'A stock is $68 with a $65 strike, so call minus put should be $3. The market shows $4, and trading every leg costs $0.60. What is left?',
    options: {
      A: '$4, the market call minus the market put',
      B: '$1, the full size of the mispricing',
      C: '$0.40, the $1 gap minus $0.60 of costs',
      D: 'Nothing worth doing, a $1 gap never beats costs',
    },
    correct: 'C',
    explanation: 'Parity says call minus put should be $68 - $65 = $3, so the market\'s $4 is $1 too big, and $1 - $0.60 of costs leaves $0.40. The $4 is the raw difference, not the mispricing.',
  },
  '23.4': {
    prompt: 'Priya is hedging calls on 200 shares. The price drops to $26 so she sells 40 shares, then it returns to $30 and she buys them back. What did that cost?',
    options: {
      A: '$160 lost, sold 40 at $26 and bought back at $30',
      B: 'Nothing, the price ended where it started',
      C: '$160 gained, since the hedge sold high and bought low',
      D: '$800 lost, all 200 shares times the $4 move',
    },
    correct: 'A',
    explanation: 'Rebalancing forced her to sell 40 shares at $26 and buy them back at $30, so 40 x $4 = $160 went out. The price returning to $30 does not undo trades already made.',
  },
  '23.5': {
    prompt: 'A straddle sells for $6. There is an 80% chance the stock moves $3 and a 20% chance it jumps $15. What is the seller\'s average result?',
    options: {
      A: 'Down $9, the jump is bigger than the premium collected',
      B: 'Up $3, the $6 premium minus the likely $3 move',
      C: 'Up $6, the seller keeps the whole premium',
      D: 'Up $0.60, the $6 premium minus a $5.40 average payout',
    },
    correct: 'D',
    explanation: 'The average payout is 0.8 x $3 plus 0.2 x $15, which is $5.40, so the seller nets $0.60. Looking only at the $15 jump ignores how rarely it happens.',
  },

  /* Module 24 - market microstructure */
  '24.1': {
    prompt: 'At $8, Ana bids for 200 first, then Ben for 400 and Cleo for 400. A seller sells 600. What does Cleo get under price-time versus pro-rata?',
    options: {
      A: '400 either way, since everyone bid the same price',
      B: 'Nothing under price-time, 240 under pro-rata',
      C: '240 under price-time, nothing under pro-rata',
      D: '200 each way, the 600 split evenly between the three',
    },
    correct: 'B',
    explanation: 'Price-time fills Ana\'s 200 and Ben\'s 400 first, leaving Cleo nothing. Pro-rata gives everyone 600 out of the 1,000 wanted, or 60%, so Cleo gets 240.',
  },
  '24.2': {
    prompt: 'A market maker keeps $0.15 from an ordinary customer and loses $0.90 to an informed one. Of 20 customers, 4 are informed. How does the day end?',
    options: {
      A: 'Down $1.20, $3.60 of losses against $2.40 of spread',
      B: 'Up $2.40, the spread kept from the other 16 customers',
      C: 'Up $3.00, $0.15 from each of the 20 customers',
      D: 'Behind by $0.75, the $0.90 loss minus the $0.15 earned',
    },
    correct: 'A',
    explanation: '16 ordinary customers pay 16 x $0.15 = $2.40, while 4 informed ones cost 4 x $0.90 = $3.60, so he is $1.20 down. That is why more informed flow forces a wider spread.',
  },
  '24.3': {
    prompt: 'The screen shows 200 shares for sale at $15, and buyers take 200 five times as a fresh 200 keeps appearing. What does that support?',
    options: {
      A: 'Exactly 1,000 shares were for sale, and the seller is now finished',
      B: 'At least 1,000 were for sale, and the seller is probably nearly done',
      C: 'A hidden seller is trapped, so the price has to fall from here',
      D: 'At least 1,000 were for sale, though the size left stays unknown',
    },
    correct: 'D',
    explanation: 'Five refills of 200 prove at least 1,000 shares were available, 800 more than the screen showed. Refills say nothing about how much is left, so guessing the seller is done goes past the evidence.',
  },
  '24.4': {
    prompt: 'Lena decides to buy 2,000 shares at $25. Rushing averages $25.30. Going slow adds $0.10 on 1,500 but misses 500 as the price hits $26. Which cost more, and by how much?',
    options: {
      A: 'The rushed path, by $450: $600 against $150 of patient impact',
      B: 'The patient path, by $500, the price run on the shares it missed',
      C: 'They cost the same once everything is measured from the $25 decision',
      D: 'The patient path, by $50, since $650 beats the rushed $600',
    },
    correct: 'D',
    explanation: 'Rushing cost 2,000 x $0.30 = $600. Going slow cost 1,500 x $0.10 = $150 plus 500 missed shares x $1 = $500, or $650 in all, so it cost $50 more. Missed trades are a real cost.',
  },
  '24.5': {
    prompt: 'Broker Maple charges no commission and fills 400 shares at $20.03. Broker Pine charges $6 and fills at $20.00. Which is cheaper, and by how much?',
    options: {
      A: 'Maple, since a zero commission cannot be beaten',
      B: 'Pine, by $6, once the price and the commission are added up',
      C: 'Maple, by $6, since the commission is the only real cost',
      D: 'Pine, by $12, the three-cent better price on 400 shares',
    },
    correct: 'B',
    explanation: 'Maple costs 400 x $20.03 = $8,012, and Pine costs 400 x $20 plus $6 = $8,006, so Pine saves $6. The $12 price edge is real, but the commission takes half of it back.',
  },

  /* Module 25 - behavioural finance */
  '25.1': {
    prompt: 'Ana rose from $300 to $400 this month and Ben fell from $500 to $400. If losses weigh about twice as much, how do their months compare?',
    options: {
      A: 'They match, since both end the month holding $400',
      B: 'Ana feels a $100 gain and Ben a loss that weighs like $50',
      C: 'Ana feels a $100 gain and Ben a loss that weighs like $200',
      D: 'Ben feels a $100 gain too, since $400 is more than Ana started with',
    },
    correct: 'C',
    explanation: 'Each judges the change from their own start, and a loss weighs about double, so Ben\'s $100 drop feels like roughly $200. Halving it instead of doubling flips the idea the wrong way.',
  },
  '25.2': {
    prompt: 'Theo made 50 calls and said he was 80% sure of each one. Thirty came true. What does that say about his confidence?',
    options: {
      A: 'Overconfident, 80% confidence produced only 60% accuracy',
      B: 'Well calibrated, since he was right more often than not',
      C: 'Underconfident, he should have claimed more than 80%',
      D: 'Just bad luck, 30 right is close enough to the 40 expected',
    },
    correct: 'A',
    explanation: 'Being 80% sure 50 times should produce about 40 hits, and 30 out of 50 is 60%, so his confidence ran 20 points above his accuracy.',
  },
  '25.3': {
    prompt: 'Shares traded at $120 last year and $60 now. The firm earns $3 a share and similar firms trade at 12 times earnings. Is $60 a bargain?',
    options: {
      A: 'Yes, half the old price is a clear discount',
      B: 'No, the yardstick says about $36, so $60 is $24 above it',
      C: 'Yes, $3 of earnings against a $60 price is already cheap',
      D: 'No, but only because the price fell so fast recently',
    },
    correct: 'B',
    explanation: 'The yardstick is $3 x 12 = $36, and $60 sits $24 above it. The old $120 is a sticky memory, not a measure of what the shares are worth.',
  },
  '25.4': {
    prompt: 'A firm plans to sell 2 million new shares. A buying rush lifts the price from $12 to $30 before the sale. What does that change?',
    options: {
      A: 'Nothing real, since a share price cannot touch the business',
      B: 'The sale still raises $24 million, because the plan was set at $12 a share',
      C: 'The sale raises $60 million instead of $24 million, funding more shops',
      D: 'The sale raises $42 million, the average of the two prices',
    },
    correct: 'C',
    explanation: '2 million shares at $30 raise $60 million instead of $24 million at $12, so the price feeds real cash into the business. A falling price runs the same loop backwards.',
  },
  '25.5': {
    prompt: 'Before each of 20 trades Omar wrote down a 60% chance. Twelve of them worked. What does comparing the two show?',
    options: {
      A: 'His 60% matched the 12 of 20 that actually worked',
      B: 'He was too hopeful, since 12 of 20 is under the 60% he wrote',
      C: 'He was too cautious, since 12 of 20 beats the 60% he wrote',
      D: 'The eight losses show the plans behind them were wrong',
    },
    correct: 'A',
    explanation: '12 of 20 is 60%, the very chance he wrote down, so his odds held up. Writing the odds before the result is what makes that check possible, because a note already made cannot be edited later.',
  },

  /* Module 26 - law, ethics and governance */
  '26.1': {
    prompt: 'A filing shows sales of $24 million, up from $20 million, but a footnote says $3 million came from a one-time settlement. What growth repeats?',
    options: {
      A: '20%, since $24 million is what the company really sold',
      B: 'Minus 12.5%, sales fell once the $3 million is removed',
      C: '15%, the one-time $3 million as a share of last year\'s $20 million',
      D: '5%, since $21 million against $20 million is the repeatable part',
    },
    correct: 'D',
    explanation: 'Strip the one-time $3 million and sales are $21 million against $20 million, which is 5%. Comparing $21 million with this year\'s own $24 million is the wrong pair.',
  },
  '26.2': {
    prompt: 'A friend says his firm will be bought next month at $45, with shares at $36. A neighbour repeats a figure from last week\'s published report. Which one is a stop sign?',
    options: {
      A: 'The neighbour\'s, because passing a figure along makes it a secret',
      B: 'Any tip about a company has to be treated as secret, so both',
      C: 'Neither, because neither of them works in the markets business',
      D: 'The friend\'s tip, because a 25% takeover price is not yet public',
    },
    correct: 'D',
    explanation: 'A takeover price the public does not know is both material and nonpublic, so it is the stop sign. A figure already printed in a published report is public, and repeating it cannot make it secret.',
  },
  '26.3': {
    prompt: 'Dana posts a 9,000-share bid though real interest is 400, sells into the tick up, then pulls it a second later. Raj pulls his bid after a headline. Which would regulators question?',
    options: {
      A: 'Both, because each of them cancelled a bid that others could see',
      B: 'Dana\'s, because the bid was far larger than any interest behind it',
      C: 'Raj\'s, because he acted on a headline before others could read it',
      D: 'Neither, since every venue lets a trader cancel a resting order',
    },
    correct: 'B',
    explanation: 'A bid more than twenty times the real interest, pulled the moment the sale is done, shows an order never meant to fill. Raj cancelled because news changed his plan, which is ordinary.',
  },
  '26.4': {
    prompt: 'A boss earns a $2M bonus only above $20M of profit. The safe plan makes a sure $18M. The risky plan is half a chance of $26M, half of losing $2M. Who prefers what?',
    options: {
      A: 'Both prefer the safe plan, since $18M beats an $11M average',
      B: 'Each prefers the risky plan, the only path to the $20M target',
      C: 'Owners prefer the safe $18M, but the bonus pushes her to the risky plan',
      D: 'Owners prefer the risky plan, since its $26M upside outweighs the $2M loss',
    },
    correct: 'C',
    explanation: 'The safe plan hands owners a sure $18M. The risky one averages half of $24M left after her bonus plus half of minus $2M, or $11M, yet only it can pay the bonus.',
  },
  '26.5': {
    prompt: 'On $20,000, Fund P charges 0.3% and Fund Q charges 1.3% and pays the adviser a bonus. He discloses the bonus. What does that settle?',
    options: {
      A: 'Nothing on its own, Fund Q still costs $200 more a year and must suit her',
      B: 'It cures the conflict, because she was told and chose to stay',
      C: 'The gap is small, since $200 on $20,000 is only a rounding cost',
      D: 'Fund Q is fine, since a higher fee usually buys better management and service',
    },
    correct: 'A',
    explanation: '0.3% of $20,000 is $60 and 1.3% is $260, so Fund Q costs $200 more every year. Telling the client about the bonus does not make the costlier fund right for her.',
  },

  /* Module 27 - quantitative research */
  '27.1': {
    prompt: 'A quarter ends June 30, the results publish August 10, and a revision from $2 to $2.40 lands in October. What may a backtest use in September?',
    options: {
      A: 'From July 1, and $2.40, the figure that turned out to be right',
      B: 'From August 10, and $2, the only figure anyone knew in September',
      C: 'From June 30, and $2.40, since the quarter was already over',
      D: 'From August 10, and $2.40, because tables should hold corrected data',
    },
    correct: 'B',
    explanation: 'Nobody could know the results before they were published on August 10, and the revision to $2.40 only arrived in October, so September\'s record still reads $2.',
  },
  '27.2': {
    prompt: 'Zoe tries 10 useless ideas on her held-out data, and each has a 10% chance of looking good by luck. What is the chance at least one does?',
    options: {
      A: '10%, the chance that any one of the ten ideas looks good',
      B: '100%, since ten tries at 10% cover every possibility',
      C: 'About 65%, since 0.9 to the tenth power is about 0.35',
      D: 'About 35%, which is the chance that every idea fails',
    },
    correct: 'C',
    explanation: 'All ten failing has probability 0.9 to the tenth, about 0.35, so a fake winner turns up about 65% of the time. Adding 10% ten times to reach 100% double counts.',
  },
  '27.3': {
    prompt: 'Signal Willow earns 12% raw and turns over 8 times a year. Signal Fern earns 9% and turns over 3 times. Each turn costs 0.4%. Which keeps more?',
    options: {
      A: 'Willow, 8.8% against 7.8% once turnover costs are taken out',
      B: 'Willow, 12% against 9%, since costs hit both the same way',
      C: 'Fern, because lower turnover always nets more in the end',
      D: 'Fern, since Willow keeps only 3.2% once its costs are out',
    },
    correct: 'A',
    explanation: 'Willow pays 8 x 0.4% = 3.2% and keeps 8.8%, while Fern pays 3 x 0.4% = 1.2% and keeps 7.8%. Low turnover helps, but it does not win on its own.',
  },
  '27.4': {
    prompt: 'A model scored 96% until an audit removed a leaked input, and it now gets 810 of 1,500 days right. How much edge over a coin flip is left?',
    options: {
      A: '42 points, the score it lost when the leak was removed',
      B: '54 points, the share of the days it now gets right',
      C: '46 points, what is left of the original 96%',
      D: '4 points, 54% against a coin flip at 50%',
    },
    correct: 'D',
    explanation: '810 of 1,500 is 54%, only 4 points above a coin flip. The 96% came mostly from an input nobody could have known that day, so it was never a real edge.',
  },
  '27.5': {
    prompt: 'A live model has a safe band of 55% to 65%, and its rule pauses it below 55% over 50 calls. It just got 26 of 50 right. What happens?',
    options: {
      A: 'Keep trading, 52% still beats a coin flip',
      B: 'Keep trading and widen the band, since 52% is close to 55%',
      C: 'Pause, alert a human and roll back: 52% is under the floor',
      D: 'Pause only if the next 50 calls also land below the floor',
    },
    correct: 'C',
    explanation: '26 of 50 is 52%, three points under the 55% floor the rule set in advance, so the switch fires now. Beating a coin flip was never the standard this model was held to.',
  },

  /* Module 28 - the trading desk */
  '28.1': {
    prompt: 'A plan buys 200 shares above $42 with an exit at $41. The stock opens at $43 and fills there. What is the risk on the trade?',
    options: {
      A: '$200, since the plan set the trigger at $42 and the exit at $41',
      B: '$400, because she filled at $43 and her exit is $41',
      C: 'Nothing, because the exit order guarantees a sale at $41',
      D: '$8,600, the 200 shares bought at the $43 fill price',
    },
    correct: 'B',
    explanation: 'Risk runs from the fill to the exit: $43 - $41 = $2 on 200 shares, or $400. The $200 assumed a fill right at the trigger, and $8,600 is the size of the position, not the amount at risk.',
  },
  '28.2': {
    prompt: 'Leo buys 300 shares at $8 with a stop at $7.60. News halts trading and the stock reopens at $6.80. What does the trade cost him?',
    options: {
      A: '$360, since it sold at $6.80, a $1.20 loss on 300 shares',
      B: '$120, the stop sold at $7.60 exactly as it was set to do',
      C: '$1.20 a share, the gap between the $8 buy and the $6.80 reopen',
      D: '$240, the distance between the stop and the reopening price',
    },
    correct: 'A',
    explanation: 'A stop decides when to sell, not at what price, and a halt does not hold the price there. It filled at the $6.80 reopen, so $1.20 a share on 300 shares is $360, three times the planned $120.',
  },
  '28.3': {
    prompt: 'Earlier 2,000 shares of buying lifted the price 8 cents. Now buyers keep taking 12,000 shares at $25 over three minutes and the price never moves. What does that suggest?',
    options: {
      A: 'Buyers have given up, since the price stopped rising',
      B: 'Nothing, because only the price itself carries information',
      C: 'Proof the price must fall, since sellers are clearly winning',
      D: 'A large seller may be meeting the buying, so the climb may stall',
    },
    correct: 'D',
    explanation: 'Six times the earlier buying with no price progress points to a big seller on the other side. That is evidence to weigh, which is why calling it proof of a fall goes too far.',
  },
  '28.4': {
    prompt: 'Nia planned 200 shares at $30 with a $29 stop. She bought 500 at $30.40 and sold at $30.90 for $250. How should the review score it?',
    options: {
      A: 'Good trade, the $250 made beats the $200 the plan risked',
      B: 'A win that carried $700 of real risk against the $200 planned',
      C: 'A bad trade, since selling at $30.90 left more money on the table',
      D: 'A win of $250 on $200 of risk, exactly as the plan intended',
    },
    correct: 'B',
    explanation: 'Result and process are separate. 500 shares from $30.40 down to the $29 stop is 500 x $1.40 = $700 at risk, three and a half times the $200 the plan allowed.',
  },
  '28.5': {
    prompt: 'Maya risks $3 a share to try to make $6 a share. How often must she be right for the idea to pay off on average?',
    options: {
      A: 'More than 50%, since being right has to happen more often than not',
      B: 'More than 67%, the $6 gain as a share of the $9 range',
      C: 'More than about 33%, the $3 risk as a share of the $9 total',
      D: 'Any odds will do, because the $6 gain is twice the $3 risk',
    },
    correct: 'C',
    explanation: 'Break-even is risk divided by gain plus risk, so $3 out of $9, about 33%. Flipping it to $6 out of $9 gives 67% and makes a sound idea look hopeless.',
  },
};
