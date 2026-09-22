'use strict';

/* Knowledge checks for modules 18-22. Each one must be answerable from the lesson's
 * principle and its whiteboard example, with wrong options that are the mistakes a
 * beginner actually makes. Vary which letter is correct. Do not reuse the example's
 * own numbers as the answer: test the idea, not recall. */

module.exports = {
  // Module 18 - Financial statement analysis
  '18.1': {
    prompt: 'A gym collects $600 up front for 10 months of classes and has run 4 of them. What has it earned so far?',
    options: {
      A: '$600, because all of the cash is already in the bank',
      B: '$240, the four months already delivered',
      C: '$360, the part of the plan not yet delivered',
      D: '$60, one month of classes',
    },
    correct: 'B',
    explanation: '$600 divided by 10 months is $60 a month, and 4 months delivered is $240 earned. The other $360 is still owed as classes, so cash day and revenue day are not the same day.',
  },
  '18.2': {
    prompt: 'Sales grew 8% while unsold stock rose from $400 to $580. What has that done to the cash the shop is holding this year?',
    options: {
      A: 'Nothing: stock is an asset, so the shop is exactly as well off',
      B: 'Cash rose $180, because stock on the shelf counts as cash',
      C: '$180 of cash now sits in goods on the shelf, not in the bank',
      D: 'Profit fell $180, because goods that have not sold are a loss',
    },
    correct: 'C',
    explanation: '$580 less $400 is $180 more tied up in goods, so that money sits on the shelf rather than in the bank. Nothing is a loss yet and profit is untouched until the goods sell or are marked down.',
  },
  '18.3': {
    prompt: 'A $2,000 machine lasting 4 years is spread over its life instead of charged all at once. Over the 4 years together, what changes?',
    options: {
      A: 'Total profit is $2,000 higher, because the cost is spread out',
      B: 'Nothing changes in any year: the two ways look identical',
      C: 'Total profit is lower, since the machine is charged four times over',
      D: 'Total profit is the same; only which year carries the cost moves',
    },
    correct: 'D',
    explanation: 'Either way the machine costs $2,000 in total. Spreading charges $500 a year, so it lifts year one by $1,500 and pushes that cost into later years, leaving value on the books to write off if the machine dies early.',
  },
  '18.4': {
    prompt: 'A shop owes $100 to the bank, $200 on store leases and $100 in pensions, and earns $80 a year after $20 of rent. Promises to earnings?',
    options: {
      A: '5 times: $400 of promises divided by $80',
      B: '4 times: $400 of promises divided by $100',
      C: '1.25 times: only the $100 bank loan counts as debt',
      D: '3 times: $300 divided by $100, leaving the pensions out',
    },
    correct: 'B',
    explanation: 'Leases and pensions are promises to pay too, so the total is $400. Because rent is now counted as debt, add the $20 of rent back to earnings: $400 divided by $100 is 4 times, not the 1.25 times the loan line suggests.',
  },
  '18.5': {
    prompt: 'Profit is $400 but operating cash is only $100, and unpaid customer bills rose $300. Which finding would show the gap was only timing?',
    options: {
      A: 'The gap is smaller than the one the shop reported last year',
      B: 'An auditor signed the accounts, so the figures were checked',
      C: 'The buyers paid up in January, once the year had closed',
      D: 'One new buyer owes the whole $300 and nobody can trace it',
    },
    correct: 'C',
    explanation: 'Money arriving in January means the sales were real and simply landed after the year end, which is timing. An untraceable single buyer points the other way, and a signature settles nothing.',
  },

  // Module 19 - Corporate finance decisions
  '19.1': {
    prompt: 'A $200 survey is already paid for. A cart costs $500 today and brings $660 in a year, and money is worth 10%. What value does the cart add?',
    options: {
      A: 'Plus $100, the $600 value today less the $500 spent now',
      B: 'Minus $100, once the $200 survey is subtracted',
      C: 'Plus $160: $660 minus $500, with no discounting',
      D: 'Minus $40: $660 minus the $500 cart and the $200 survey',
    },
    correct: 'A',
    explanation: '$660 divided by 1.1 is $600, and $600 minus the $500 spent now is plus $100. The $200 survey is gone whatever is decided, so subtracting it would hide a project that adds value.',
  },
  '19.2': {
    prompt: 'Owners supply 70% of the money and want 10%; loans supply 30% at 8%, and the tax rate is 25%. What is the blended cost of money?',
    options: {
      A: '9.4%, using the 8% loan rate before any tax saving',
      B: '9%, the plain average of 10% and 8%',
      C: '8.8%, blending the owners and the loans after tax',
      D: '10%, the return the owners want',
    },
    correct: 'C',
    explanation: 'Interest cuts the tax bill, so the loans really cost 8% times 0.75, or 6%. Then 0.7 times 10% plus 0.3 times 6% is 8.8%. Using 8% before tax overstates what borrowing costs.',
  },
  '19.3': {
    prompt: "A plan puts in $1,000 of the owners' money and borrows $1,000 at 8%. In a bad year the business earns $60. What do the owners earn?",
    options: {
      A: "6%: $60 divided by the $1,000 of owners' money",
      B: '3%, the same as a plan with no loan at all',
      C: 'Minus 8%, because the loan charges 8%',
      D: 'Minus 2%, once the $80 of interest is paid first',
    },
    correct: 'D',
    explanation: 'Interest of $80 is paid first, so owners are left with $60 minus $80, or minus $20 on their $1,000. With no loan the same $60 would be a small gain of 3%: borrowing stretches both good and bad years.',
  },
  '19.4': {
    prompt: 'A firm with 2,000 shares buys back 100 of them and hands staff 130 new shares as pay. What is the net change?',
    options: {
      A: 'Plus 30 shares, so every holder owns a slightly smaller slice',
      B: 'Minus 100 shares, the size of the buyback',
      C: 'Minus 230 shares, since buybacks and grants both remove shares',
      D: 'No change, because the buyback cash paid for the grants',
    },
    correct: 'A',
    explanation: '2,000 minus 100 plus 130 is 2,030 shares, which is 30 more than before. The buyback headline hides the grants, so a holder ends up with a smaller share of the company even though cash went out.',
  },
  '19.5': {
    prompt: 'After a deal, earnings per share rise from $1.50 to $1.60, but the target was worth $250 and cost $400. What really happened?',
    options: {
      A: 'Value was created, because earnings per share went up',
      B: 'Value was destroyed by $150, even though earnings per share rose',
      C: 'Nothing changed: earnings per share and value always move together',
      D: 'Value was created by $150, the premium paid over the target\'s worth',
    },
    correct: 'B',
    explanation: 'Cheap borrowing can lift earnings per share while the buyer still overpays. Paying $400 for something worth $250 throws away $150, and earnings per share say nothing about the price paid.',
  },

  // Module 20 - Valuation and risk models
  '20.1': {
    prompt: 'A share tends to move 8% when the market moves 4%. With a 2% safe rate and an expected 7% market return, what does the model expect?',
    options: {
      A: '12%: 2% safe plus 2 times the 5% market premium',
      B: '14%: sensitivity of 2 times the 7% market return',
      C: '16%: the 2% safe rate plus 2 times 7%',
      D: "8%, the size of the share's own move",
    },
    correct: 'A',
    explanation: 'Sensitivity is 8% divided by 4%, or 2, and the extra pay for market risk is 7% minus 2%, or 5%. So 2% plus 2 times 5% is 12%. Multiplying by the whole 7% counts the safe rate twice.',
  },
  '20.2': {
    prompt: 'A fund gained 15%. Market exposure explains 9%, its small tilt 2% and its cheap tilt 3%. What does the rest tell you?',
    options: {
      A: 'That the manager has real skill, since the factors cannot explain it',
      B: 'That the model is broken, because the pieces must add to the total',
      C: '1% the chosen factors miss, which one year cannot pin on skill',
      D: 'That the fee was 1%, the only thing left to explain the gap',
    },
    correct: 'C',
    explanation: '9% plus 2% plus 3% is 14%, so 1% of the 15% is left. That leftover is whatever the chosen factors do not capture, and a single year of it cannot separate skill from luck.',
  },
  '20.3': {
    prompt: "A shop uses $3,000 of the owners' money that has to earn 10% a year, and it earns $240 a year forever. What is the shop worth?",
    options: {
      A: 'More than $3,000, because the profit is positive',
      B: "Exactly $3,000: the owners' money is all still in the shop",
      C: 'Less: about $2,940, the $3,000 minus one year of the shortfall',
      D: 'Less: about $2,400, since it misses the bar by $60 every year',
    },
    correct: 'D',
    explanation: 'The bar is $3,000 times 10%, or $300 a year, and $240 falls $60 short. Missing by $60 forever costs $60 divided by 10%, or $600, so the shop is worth $2,400. Real profit can still destroy value.',
  },
  '20.4': {
    prompt: 'A $40 test comes before a $300 build that is worth $700 half the time and $100 half the time. What is it worth if he can stop after the test?',
    options: {
      A: 'Plus $160, once the $40 test and the good half are counted',
      B: 'Plus $60, the same as building no matter what',
      C: 'Plus $400, the average value of the finished project',
      D: 'Plus $360: $700 minus the $300 build and the $40 test',
    },
    correct: 'A',
    explanation: 'He pays $40, then builds only in the good half: minus $40 plus 50% of ($700 minus $300) is $160. Building regardless averages $400 against $340 spent, just $60, so the freedom to stop is worth $100.',
  },
  '20.5': {
    prompt: 'A business priced at $900 must return 10% a year, and today it earns $60 on $600 of sales. What does that price quietly assume?',
    options: {
      A: 'That sales stay at $600 and the margin stays at 10%',
      B: 'That profit reaches $90, say sales of $900 at the same margin',
      C: 'That the business is really worth $600, the level of its sales',
      D: 'That profit doubles, to $120 a year',
    },
    correct: 'B',
    explanation: '$900 times 10% is $90 a year, up from $60, a rise of half. That could come from sales of $900 at the same 10% margin or a 15% margin on the sales it already has, not from a doubling.',
  },

  // Module 21 - Portfolio construction and evaluation
  '21.1': {
    prompt: 'An optimizer splits $90 evenly across three funds that move almost together. One guessed return is nudged up half a point. What happens?',
    options: {
      A: 'Nothing: the funds are near twins, so the even split holds',
      B: 'That fund gains a little, perhaps a dollar or two',
      C: 'The split can swing hard toward that fund, up to the whole $90',
      D: 'The optimizer moves money away from it, to hold the risk down',
    },
    correct: 'C',
    explanation: 'When holdings move almost together the optimizer sees nearly the same risk everywhere, so it chases the highest guess and a tiny input change can move most of the money. Test other guesses and add limits.',
  },
  '21.2': {
    prompt: 'A 50/50 split of $1,000 has drifted to $700 in stocks and $500 in bonds. How much moves to get back to plan?',
    options: {
      A: '$100 from stocks to bonds, back to an even split',
      B: '$200 from stocks to bonds, the whole gain',
      C: '$100 from bonds to stocks, to follow the winner',
      D: 'Nothing: selling the winner gives up future profit',
    },
    correct: 'A',
    explanation: 'The pot is now $1,200, so half of it is $600 and $100 of stocks moves across. Moving the whole $200 gain would overshoot to $500 of stocks, below the plan rather than on it.',
  },
  '21.3': {
    prompt: 'A fund can sell $60M of its holdings. That slice falls 20%, then $8M of bills and a $20M call come due. What can still be sold?',
    options: {
      A: '$32M: $60M minus the $28M paid out',
      B: '$48M, the value before the bills are paid',
      C: '$20M, once the fall and both payments are taken out',
      D: '$28M, because a long horizon lets the $8M of bills wait',
    },
    correct: 'C',
    explanation: '$60M times 80% is $48M after the fall, and $48M less $8M less $20M leaves $20M. Starting from $60M forgets the drop, and a long horizon does not let bills due this year wait.',
  },
  '21.4': {
    prompt: 'A fund allowed to buy only bonds returned 5%. A stock index returned 3% and the bond index returned 7%. How did it do?',
    options: {
      A: 'It beat the market by 2 points, since the stock index is the market',
      B: 'It trailed by 2 points, judged against the index it was allowed to buy',
      C: 'It is level, judged against the average of the two indexes at 5%',
      D: 'It beat one and trailed the other, so the two results cancel out',
    },
    correct: 'B',
    explanation: 'A bond-only fund is judged against bonds, so 5% against 7% is a 2-point shortfall. The stock index is the wrong yardstick, and averaging the two invents a benchmark nobody set.',
  },
  '21.5': {
    prompt: 'A manager returns 11% and charges a 1.5% fee; an index returns 10% and charges 0.1%. Where does an investor keep more?',
    options: {
      A: 'With the manager: 11% beats the index return of 10%',
      B: 'The same either way: the extra 1% covers the 1.5% fee',
      C: 'It cannot be compared, since fees and returns are separate things',
      D: 'With the index: 9.9% kept a year against the manager\'s 9.5%',
    },
    correct: 'D',
    explanation: '11% minus 1.5% leaves 9.5%, while 10% minus 0.1% leaves 9.9%. The 1-point lead is smaller than the fee gap, and the fee is charged every single year.',
  },

  // Module 22 - Fixed income and funding
  '22.1': {
    prompt: 'A one-year bond costs $90 today and pays $8 of interest plus the $100 back. What is its yield to maturity?',
    options: {
      A: '8.9%, the $8 of interest divided by the $90 paid today',
      B: '20%, the $18 gained measured against the $90 actually paid',
      C: '8%, the interest measured against the $100 face value',
      D: '18%, the $18 gained divided by the $100 face value',
    },
    correct: 'B',
    explanation: '$108 comes back for the $90 paid, an $18 gain on that $90, which is 20%. Current yield counts only the $8 of interest, so it misses the $10 climb from $90 back up to $100.',
  },
  '22.2': {
    prompt: 'Pile A is one 4-year bond; pile B is half a 1-year and half a 7-year bond, so both have duration 4. Short rates rise 1%, long rates fall 1%, middle rates hold. What happens to pile B?',
    options: {
      A: 'It falls about 4%, the drop its duration of 4 implies',
      B: 'Nothing, because the 1% rise and the 1% fall cancel out',
      C: 'It gains about 3%, once both halves are counted',
      D: 'It loses about 1%, the move of its short half alone',
    },
    correct: 'C',
    explanation: 'The short half loses about 1% and the long half gains about 7%, so half of each is near plus 3%. Pile A sits on the middle rate and barely moves, although duration says the two should match.',
  },
  '22.3': {
    prompt: 'A $100 loan promises 15%, but 2 times in 10 the borrower fails and returns only $50. What return can the lender expect?',
    options: {
      A: '15%, the rate the borrower promised',
      B: '12%: the 15% cut back by the one-in-five failure rate',
      C: '7.5%, the average of 15% and nothing',
      D: '2%, once one failure in five is averaged in',
    },
    correct: 'D',
    explanation: '0.8 times $115 plus 0.2 times $50 is $102, a 2% return on the $100 lent. Trimming the 15% to 12% forgets that a failure also loses part of the $100 itself, not just the interest.',
  },
  '22.4': {
    prompt: 'A $200 loan pool is sliced Senior $150, Middle $30 and Junior $20, and $60 of loans fail. What does the Senior slice lose?',
    options: {
      A: '$10, the loss the two lower slices could not absorb',
      B: 'Nothing, because seniority removes the risk of loss',
      C: '$45, its three-quarters share of the $60 lost',
      D: '$40, the loss left over once Junior is gone',
    },
    correct: 'A',
    explanation: 'Losses climb from the bottom: Junior absorbs $20 and Middle $30, so the last $10 hits Senior, about 7% of its $150. Being senior delays and shrinks a loss; it does not remove it.',
  },
  '22.5': {
    prompt: 'Bonds fall to $190 and the haircut rises to 20%, so the lender will fund only $152 while $180 is owed. How much must be sold?',
    options: {
      A: '$28, the size of the gap the lender will not fund',
      B: '$35, the gap divided by the 80% funding rate',
      C: '$152, the new borrowing limit',
      D: '$140, since each $1 sold closes only $0.20 of the gap',
    },
    correct: 'D',
    explanation: 'Selling $1 of bonds repays $1 but also cuts the borrowing limit by $0.80, closing only $0.20 of the gap, so $28 divided by $0.20 is $140. Selling just the $28 leaves the loan still too big.',
  },
};
