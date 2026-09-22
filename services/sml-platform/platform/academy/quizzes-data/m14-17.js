'use strict';

/* Knowledge checks for modules 14-17. Each one must be answerable from the lesson's
 * principle and its whiteboard example, with wrong options that are the mistakes a
 * beginner actually makes. Vary which letter is correct. Do not reuse the example's
 * own numbers as the answer: test the idea, not recall. */

module.exports = {
  '14.1': {
    prompt: 'A cart\'s yearly takings grow from $200 to $288 over two years. What is the growth per year?',
    options: {
      A: '44%, the total growth across the two years',
      B: '22%, half of the 44% total',
      C: '20%, because 1.2 times 1.2 is 1.44',
      D: '31%, the $88 gain measured against the $288 it ended at',
    },
    correct: 'C',
    explanation: '1.44 is 1.2 times 1.2, so each year multiplies by 1.2, which is 20% a year. The 44% is the two-year total, and halving it to 22% ignores that the second year grows on a bigger base.',
  },
  '14.2': {
    prompt: 'A stand pays $60 every year forever. What is it worth today to someone who needs 4% a year?',
    options: {
      A: '$1,500, since 4% of $1,500 is exactly the $60 a year',
      B: 'Unlimited, because the payments never stop',
      C: '$2.40, the $60 payment multiplied by 0.04',
      D: '$600, ten years of payments, since later ones hardly matter',
    },
    correct: 'A',
    explanation: 'A payment that never ends is worth the payment divided by the rate: $60 divided by 0.04 is $1,500. Later payments are worth less and less but never nothing, so the total is finite, not unlimited.',
  },
  '14.3': {
    prompt: 'Stand A pays $40 when it rains and $0 when it is sunny; stand B is the opposite. What does a mix of 75% A and 25% B pay?',
    options: {
      A: '$20 whatever the weather, since opposite stands always cancel out',
      B: '$30 on rainy days and $10 on sunny days, steadier but not flat',
      C: '$40 on rainy days and $0 on sunny days, following the bigger share',
      D: '$30 every day, three quarters of the $40 that either stand can pay',
    },
    correct: 'B',
    explanation: 'Rain pays 0.75 times $40 plus 0.25 times $0, which is $30, and sun pays $10. Opposite stands flatten into one figure only when the two shares are equal, so an uneven mix still swings.',
  },
  '14.4': {
    prompt: 'Dev has $600. Stall A hopes for 10% but sells only $100; B hopes 7% and C hopes 5%, and no stall may take over $300. What is the best hoped gain?',
    options: {
      A: '$60, the paper plan of all $600 at 10%',
      B: '$10, since only $100 of the best stall can be bought',
      C: '$31, filling the 10% and 7% stalls and stopping there',
      D: '$41, spreading $100, $300 and $200 across the three',
    },
    correct: 'D',
    explanation: '$100 at 10% plus $300 at 7% plus $200 at 5% is $10 + $21 + $10 = $41. Chopping the paper plan afterwards leaves $500 idle for only $10, so the $300 cap and the $100 supply belong inside the plan.',
  },
  '14.5': {
    prompt: 'A $200 bond has duration 5 and convexity 50. Rates rise 2%, so the straight-line drop is $20. What does convexity add back?',
    options: {
      A: 'Nothing, because duration already allows for the curve',
      B: 'Another $20 of loss, doubling the drop to $40',
      C: '$0.50, the same fix a 1% rise would give',
      D: '$2, lifting the estimate to about $182',
    },
    correct: 'D',
    explanation: 'Half of 50 times 2% times 2% is 1%, and 1% of $200 is $2, so the drop is nearer $18 than $20. The fix grows with the square of the move, so a 1% rise would add only $0.50.',
  },
  '15.1': {
    prompt: 'A new machine lets growers bring 30 more baskets at every price, so the price drops from $3 to $2 and buyers take 15 more. Has demand shifted?',
    options: {
      A: 'Yes, because more baskets are bought than before',
      B: 'Yes, because the balancing price moved',
      C: 'No, buyers are responding to a lower price along the same demand',
      D: 'No, demand shifts only when buyer incomes change, not when supply does',
    },
    correct: 'C',
    explanation: 'The machine changed how much growers bring at every price, so supply shifted. Buyers taking 15 more is a movement along the same demand curve, a reaction to the lower price, not a shift of demand.',
  },
  '15.2': {
    prompt: 'A stand raises a cup from $5 to $5.50 and weekly cups fall from 200 to 160. What happens to the money it takes in?',
    options: {
      A: 'It falls from $1,000 to $880, since cups fell more than price rose',
      B: 'It rises from $1,000 to $1,100, since the price went up 10%',
      C: 'It rises a little, because a higher price always brings in more',
      D: 'It stays at $1,000, since the price rise offsets the lost cups',
    },
    correct: 'A',
    explanation: '160 cups at $5.50 is $880, down from 200 at $5, or $1,000. Cups fell 20% while price rose only 10%, so demand is elastic and the rise loses money. Assuming the two percentages cancel is the trap.',
  },
  '15.3': {
    prompt: 'Two carts each keep $4 of every $6. One sits on a street anyone can rent a pitch on; the other holds the pier\'s only licence. Which margin is likelier to last?',
    options: {
      A: 'Neither, because $4 of $6 is too wide a margin for any cart to hold',
      B: 'The pier cart, because the licence keeps new carts from copying it',
      C: 'The street cart, since its margin proves it is already winning there',
      D: 'Both, since they keep the same $4 today and start from the same place',
    },
    correct: 'B',
    explanation: 'Both carts keep the same $4 today, so the size of the margin settles nothing. Only the pier licence stops a rival opening alongside, and a barrier like that is what makes a margin last.',
  },
  '15.4': {
    prompt: 'Two cafes each choose once, with no deal beforehand. Both plain pays $20 each, both fancy pays $14 each, and going fancy alone pays $24 while the other gets $8. What will each pick?',
    options: {
      A: 'Plain, because $20 each beats the $14 each if both go fancy',
      B: 'Plain, because going fancy risks dropping to $8',
      C: 'Fancy, because it pays more whatever the other cafe does',
      D: 'Fancy, but only if the other cafe is expected to stay plain',
    },
    correct: 'C',
    explanation: 'Fancy pays $24 against a plain rival and $14 against a fancy one, beating plain at $20 and $8, so it wins either way and is dominant. Both end on $14 although both plain paid $20 each.',
  },
  '15.5': {
    prompt: 'Good scooters are worth $200 and duds $80. A guarantee costs a good seller $30 but a dud seller $40. Does it separate them?',
    options: {
      A: 'Yes, since it still costs a dud seller more than a good one',
      B: 'Yes, because $30 is a real cost the good seller has to pay',
      C: 'No, because buyers cannot check the repair work themselves',
      D: 'No, a dud seller nets $160 by copying it, well above $80',
    },
    correct: 'D',
    explanation: 'Copying pays a dud seller $200 minus $40, or $160, far more than the $80 he gets without the promise, so every dud copies and buyers learn nothing. Costing more for duds is not enough on its own.',
  },
  '16.1': {
    prompt: 'An island made 200 pairs of socks at $5 last year and 220 pairs at $6 this year. How much did its real GDP grow?',
    options: {
      A: '32%, because $1,320 is 32% above $1,000',
      B: '10%, because 220 pairs at last year\'s $5 is $1,100',
      C: '20%, because prices rose from $5 to $6, a fifth more',
      D: '12%, the 32% rise less the 20% price rise',
    },
    correct: 'B',
    explanation: 'Real GDP counts this year\'s 220 pairs at last year\'s $5, or $1,100, a 10% rise. The $1,320 total is up 32%, but most of that is bigger price tags, and subtracting 20% from 32% is not the answer.',
  },
  '16.2': {
    prompt: 'A regular bond pays 5% and a protected one 1.5% plus inflation. The regular bond then moves to 5.5% and the protected one does not. What is the new gap, and what does it mean?',
    options: {
      A: '4%, though the rise may be more pay for inflation risk, not a forecast',
      B: '4%, and inflation will now average exactly 4% over the bonds\' life',
      C: '0.5%, since the gap is the size of the move in the regular bond',
      D: '3.5%, because only the protected bond\'s rate can move the gap',
    },
    correct: 'A',
    explanation: '5.5% less 1.5% is a 4% gap, half a point wider than before. That extra half point may be a higher inflation guess or simply more pay for taking inflation risk, so a breakeven is a clue, not a forecast.',
  },
  '16.3': {
    prompt: 'A town has 285 of its 300 workers employed. Firms add 30 jobs and 50 more people start looking. What is the new jobless rate?',
    options: {
      A: 'Still 5%, because the new jobs roughly match the new seekers',
      B: 'Under 5%, since 30 more people are working than before',
      C: '10%, because 35 of the 350 in the workforce are looking',
      D: 'About 12%, the 35 looking divided by the old workforce of 300',
    },
    correct: 'C',
    explanation: 'Working rises to 315 and the workforce to 350, so 35 are looking: 35 divided by 350 is 10%, up from 5%. The job count comes from firms while the rate divides by a workforce that grew too.',
  },
  '16.4': {
    prompt: 'Everyone expects a 0.75% rate rise, but the bank raises only 0.25%. A bond moves 4% for each 1% of surprise. What happens to it?',
    options: {
      A: 'It falls about 1%, since rates still went up by 0.25%',
      B: 'It rises about 2%, since the rise was 0.5% smaller than expected',
      C: 'It falls about 3%, since 4 times 0.75% is 3%',
      D: 'It barely moves, because a quarter-point rise is too small to matter',
    },
    correct: 'B',
    explanation: 'The surprise is 0.25% minus 0.75%, or half a percent less tightening than was priced in, so the bond gains about 4 times 0.5%, or 2%. Marking it down because the headline says rates rose is the trap.',
  },
  '16.5': {
    prompt: 'A firm earns 500 Marks abroad. A Mark was worth $2 and is now worth $2.50. What happens to its dollar earnings?',
    options: {
      A: 'They fall to $200, dividing the 500 Marks by the new $2.50 rate',
      B: 'They stay at $1,000, because nothing changed abroad',
      C: 'They rise to $1,250 only if the firm also sells more goods abroad',
      D: 'They rise to $1,250, a 25% gain with no change in sales',
    },
    correct: 'D',
    explanation: '500 Marks at $2.50 is $1,250, up from $1,000, a 25% gain with no change in sales. Dividing by the rate instead of multiplying is the usual slip, and a weaker home currency helps an exporter.',
  },
  '17.1': {
    prompt: 'A model says a 6% daily drop should come about 1 day in 1,000. Over 2,000 days a fund had 8. What does that suggest?',
    options: {
      A: 'Roughly four times as many big drops as the bell curve expected',
      B: 'About six times as many, the usual gap when tails are fat',
      C: 'The model held up, since 8 days out of 2,000 is still rare',
      D: 'The model expected about 1 such day, so it was off by 7',
    },
    correct: 'A',
    explanation: 'About 1 day in 1,000 means roughly 2 days in 2,000, and 8 divided by 2 is 4, so extreme drops arrived about four times as often as the bell curve allowed. That is what a fat tail looks like.',
  },
  '17.2': {
    prompt: 'A fund averages 2% a month over 36 months with a standard wiggle of 6%. What is the rough 95% range for its true average?',
    options: {
      A: '-10% to 14%, the average give or take two standard wiggles',
      B: '1.67% to 2.33%, dividing the 6% wiggle by the 36 months',
      C: '0% to 4%, since the 2% could be out by about 2% in either direction',
      D: 'Exactly 2%, since 36 months is enough data to settle the question',
    },
    correct: 'C',
    explanation: 'The average wiggles less than a single month does: its standard error is 6% divided by the square root of 36, or 1%, and two errors either side of 2% gives 0% to 4%. Using the 6% wiggle itself is far too wide.',
  },
  '17.3': {
    prompt: 'A rule beats chance by $0.40 a trade with a standard error of $0.10, but fees cost $0.60 a trade. Over 2,500 trades, what happens?',
    options: {
      A: 'It makes $1,000, since $0.40 across 2,500 trades is a tested gain',
      B: 'It breaks even, because the test showed the edge is real',
      C: 'It makes $500, since the edge is 4 times its own error',
      D: 'It loses $500, since $0.40 less $0.60 leaves minus $0.20 a trade',
    },
    correct: 'D',
    explanation: 'The edge is 4 times its $0.10 error, so it is unlikely to be luck, yet costs of $0.60 swallow it: minus $0.20 a trade across 2,500 trades is minus $500. Statistically real is not the same as worth doing.',
  },
  '17.4': {
    prompt: 'Shops with 10 staff take $500 a day and shops with 30 take $1,500. Two shops on one busy street both take $1,500, with 20 and 25 staff. What does that show?',
    options: {
      A: 'Each extra staff member adds $50 a day, as the first comparison showed',
      B: 'The busy street drives both staff numbers and sales, so staff may add nothing',
      C: 'Five more staff adds $1,500 a day once a shop is on a busy street',
      D: 'Staff and sales are unrelated, so the first comparison was pure chance',
    },
    correct: 'B',
    explanation: 'On one busy street, 5 extra staff added nothing, so the $50 a head came from busy streets having both more staff and more shoppers. Going together is not causing, but it does not mean unrelated either.',
  },
  '17.5': {
    prompt: 'A stand sold about 30 cups a day until a festival lifted it to 50. A walk-forward test trained on the quiet days predicts the first festival day. What error does it report?',
    options: {
      A: 'Roughly 40%, a 20-cup gap between the guess of 30 and the true 50',
      B: 'Near zero, because walk-forward tests are more accurate than shuffled ones',
      C: 'About 67%, comparing the 20-cup miss with the 30 cups it guessed',
      D: 'None, since the festival days were never in the training data',
    },
    correct: 'A',
    explanation: 'It guesses 30 against a real 50, a 20-cup miss, and 20 divided by 50 is 40%. Walk-forward does not make the model better; it reports the honest error that a shuffled test would hide.',
  },
};
