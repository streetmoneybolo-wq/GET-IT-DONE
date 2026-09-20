'use strict';

/* Original Academy material.  It intentionally does not ingest, reproduce, or
 * summarise messages from the legacy Investing Essentials category. */
const SEED_LESSONS = [
  {
    moduleId: 1, lessonId: 1, title: 'What a Market Does',
    description: 'Learn how buyers, sellers, exchanges, and price discovery work before using a chart.',
    duration: '7 min', level: 'Beginner', color: 0x00E676,
    steps: [
      'A market is a meeting place for buyers and sellers. The displayed price is the most recent agreement, not a promise of the next price.',
      'Bid prices show what buyers currently offer. Ask prices show what sellers currently request. The difference is the spread.',
      'Educational rule: a quote explains the current market conversation; it does not tell you what to buy or sell.'
    ],
    question: {
      prompt: 'What does the last traded price represent?',
      options: { A: 'A guaranteed future value', B: 'The most recent agreement between a buyer and seller', C: 'The company’s cash balance', D: 'A target price' },
      correct: 'B',
      explanation: 'The last price records a completed transaction. Supply, demand, news, and orders can change the next traded price.'
    }
  },
  {
    moduleId: 2, lessonId: 1, title: 'Reading Candlestick Bodies',
    description: 'Understand what a candlestick body records about price during one selected time period.',
    duration: '8 min', level: 'Beginner', color: 0x00E676,
    steps: [
      'A candle has four reference points: open, high, low, and close. Its body spans the open and close; wicks show the extremes reached during that period.',
      'When the close is above the open, the body is commonly shown green. When the close is below the open, it is commonly shown red. Color alone is not a trading signal.',
      'Always read a candle in context: trend, volume, nearby levels, and risk matter more than one shape.'
    ],
    question: {
      prompt: 'Which pattern is commonly associated with a possible bullish reversal only when it appears after a decline and has confirmation?',
      options: { A: 'Doji', B: 'Shooting star', C: 'Hammer', D: 'Hanging man' },
      correct: 'C',
      explanation: 'A hammer has a small body near its upper range and a longer lower wick. Context and confirmation are required; it is never a guarantee.'
    }
  },
  {
    moduleId: 3, lessonId: 1, title: 'Support and Resistance as Zones',
    description: 'Identify areas where buyers or sellers previously showed interest without treating any level as certain.',
    duration: '9 min', level: 'Beginner', color: 0xFFB400,
    steps: [
      'Support is an area where buying previously slowed a decline. Resistance is an area where selling previously slowed an advance.',
      'Use zones rather than a single magic line. Price can pierce a level, react, or fail without warning.',
      'A thoughtful plan defines invalidation before an entry. Historical reactions do not guarantee a future bounce.'
    ],
    question: {
      prompt: 'Price is approaching an area that held several times before. What is the most disciplined conclusion?',
      options: { A: 'It must bounce', B: 'It may draw attention, so define risk and wait for evidence', C: 'It will gap down', D: 'It will remain there forever' },
      correct: 'B',
      explanation: 'Repeated reactions can make an area relevant, but no support or resistance zone is guaranteed to hold.'
    }
  },
  {
    moduleId: 7, lessonId: 1, title: 'Risk, Reward, and Position Size',
    description: 'Use simple math to define maximum loss before deciding a position size.',
    duration: '10 min', level: 'Intermediate', color: 0xFF3D3D,
    steps: [
      'Risk management starts before a trade. Define the point where the idea is invalid and the maximum amount you can afford to lose.',
      'A simple educational sizing formula is: shares = maximum dollar risk ÷ (entry price − stop price). It does not account for gaps, slippage, or all product risks.',
      'Smaller size can preserve decision quality. No formula eliminates risk.'
    ],
    question: {
      prompt: 'For a $50,000 educational example using 1% maximum risk, $180 entry, and $176 stop, what is the maximum share count before costs?',
      options: { A: '100', B: '125', C: '150', D: '200' },
      correct: 'B',
      explanation: 'Maximum risk is $500. Risk per share is $4. $500 ÷ $4 = 125 shares before considering costs and execution risk.'
    }
  }
];

module.exports = { SEED_LESSONS };
