'use strict';

/* Guided walkthroughs ("playbooks"): one per module family plus the one that ties everything together. Each step is
 * { k, t, b, say? }: the card shows t and b, and the Academy voice reads `say` (default: t + '. ' + b). The page matches a step to a
 * control by its id (academy-playbooks.js), so this file holds words only. Every claim here describes what the module on screen
 * actually shows; nothing promises a result. */

const PLAYBOOKS = {
  together: {
    title: 'How it all ties together', mins: 3, blurb: 'The six questions every trade should answer, and how to combine the tools into one decision.',
    steps: [
      { k: 'intro', t: 'One decision, six questions', b: 'Every tool answers one question: which way is the market leaning, who is behind the move, where will price react, what is the plan, which contract fits, and what proves me wrong. Strong ideas line up on several answers. Weak ones lean on one.' },
      { k: 'direction', t: '1. Direction', b: 'Market Direction reads SPY and the whole tape. It tells you whether you are swimming with the current or against it before you look at any single stock.' },
      { k: 'flow', t: '2. Flow', b: 'BUY/SELL, DARK POOL, SHORT SALE and INTENT show who is behind the move. Real buyers behind a rising price is confirmation. A rising price on selling is a warning.' },
      { k: 'levels', t: '3. Levels', b: 'WALLS, COST and SMC mark where price is likely to react: resting orders, trapped holders, and smart money zones. Entries and stops belong at levels, not in the air.' },
      { k: 'plan', t: '4. The plan', b: 'TARGETS and MEM ALGO turn the read into numbers: an entry, a stop, and three targets with odds. If the reward is not at least twice the risk, skip it.' },
      { k: 'contract', t: '5. The contract', b: 'The options chain and price calculator show what the idea costs, where it breaks even, and what it pays at each target. Choose the contract after the plan, never before.' },
      { k: 'risk', t: '6. The risk check', b: 'Click to Alert runs the pre-alert check: is this a chase, is the first target realistic, is the stop sane, is earnings close. It advises and never blocks, so listen to it.' },
      { k: 'rule', t: 'The confluence rule', b: 'Give one point each for direction, flow, levels, plan and risk when they agree. Four or five points is a setup worth studying. Two or fewer means wait. Size every trade so the stop costs an amount you can accept.' },
      { k: 'squeeze', t: 'Combination: the squeeze', b: 'SHORT SALE shows a crowded short. SQUEEZE ranks the risk. BUY/SELL shows buyers stepping in. A break through a wall is the trigger. All four together is how squeezes are spotted early. One alone is just noise.' },
      { k: 'bounce', t: 'Combination: the support bounce', b: 'COST shows holders defending a price. A WALL sits under it. DARK POOL prints cluster at it. When price touches that zone and BUY/SELL turns up, you have three independent reasons for a bounce and a tight stop just below.' },
      { k: 'event', t: 'Combination: the event play', b: 'CATALYSTS shows the date. The chain shows the priced move. HEDGE and INCOME shows structures with defined risk. Together they let you plan an event instead of gambling on it.' },
      { k: 'ready', t: 'Now you try it', b: 'Pick one stock and walk the six questions in order. Write the answers down. After a week, check which questions were right most often. That is how your own edge gets built.' }
    ]
  },
  spy: {
    title: 'SPY daily options with Market Direction', mins: 3, blurb: 'Read the Market Direction module in order and turn it into a plan for same-day SPY options.',
    steps: [
      { k: 'intro', t: 'Why start here', b: 'Daily options on SPY live and die by the market, not by company news. Market Direction packs the evidence into one page. Use the Day trading tab, and read it top to bottom in the same order every morning.' },
      { k: 'tabs', t: 'Day or swing', b: 'Day trading refreshes every twenty seconds and is built for same-day options. Swing trading refreshes every two minutes and looks days ahead. For daily options, stay on Day.' },
      { k: 'bias', t: 'The label and the bias', b: 'The big label runs from Bullish to Bearish, and the bias is a number from minus one hundred to plus one hundred. Next to it, the percent of evidence that agrees tells you how much to trust it. Near zero means no edge, so wait.' },
      { k: 'built', t: 'What it is built from', b: 'Each row is one piece of evidence scored from minus two to plus two, with how live its source is. Look for agreement across rows, not one loud row.' },
      { k: 'checklist', t: 'The checklist', b: 'The pre-market and intraday checklist lists what has to be true for the read to hold. Each box you can tick lowers the chance you are surprised.' },
      { k: 'levels', t: 'Key levels for SPY', b: 'Previous day high and low, pre-market range, the open, the opening range, VWAP, the call wall and the put wall. Price above VWAP and the opening range high favors calls. Below favors puts. The walls are where moves often stall.' },
      { k: 'gamma', t: 'Dealer gamma and the walls', b: 'Positive gamma means dealers dampen moves, so price tends to pin near big strikes. Negative gamma means dealers amplify moves, so trends run. Note the gamma flip price. Crossing it changes the personality of the day.' },
      { k: 'vix', t: 'SML VIX and the expected move', b: 'Under fifteen is calm, fifteen to twenty is normal, twenty to twenty five is elevated, and over twenty five is high fear. The options implied daily move versus the average true range tells you if options are cheap or expensive today.' },
      { k: 'catalysts', t: 'Catalysts and who is pulling SPY', b: 'Check the next seven days for events and the table of heavyweights pulling SPY. A big event today raises risk. If five names are doing all the work, the move is fragile.' },
      { k: 'record', t: 'Base rates and track record', b: 'Base rates show what SPY did before in similar conditions. The track record shows how often this module was right. Trust it in proportion to that record, and remember no read is certain.' },
      { k: 'chain', t: 'From read to contract', b: 'With a direction and levels, open the options chain on SPY, choose today\'s expiration, and look at strikes near the money. Click a strike to load it into the price calculator and see the breakeven before you ever place a trade.' },
      { k: 'rules', t: 'Rules for daily options', b: 'Take only trades where the bias and the levels agree. Place your stop where the read is wrong, not where the loss feels big. A daily option can lose all of its value in hours, so size small. This is education, not advice.' }
    ]
  },
  cheap: {
    title: 'Options chain lab and price calculator', mins: 3, blurb: 'Find options that are cheap for what they can pay, and test them in the calculator before you risk anything.',
    steps: [
      { k: 'intro', t: 'Cheap is not the same as good', b: 'A cheap option is cheap because it needs a big move. The goal is options where the price is low compared to the chance and the size of the payoff. The chain and the calculator let you measure exactly that.' },
      { k: 'expiry', t: 'Pick the expiration', b: 'Choose how much time you are buying. Too little time and a correct idea still expires worthless. Give the idea at least as long as it needs to play out, then add a little more.' },
      { k: 'range', t: 'Strikes around the money', b: 'Show twelve, twenty, or forty strikes around the current price, or all of them. Calls are on the left, puts on the right, and the strike is in the middle.' },
      { k: 'columns', t: 'Read the columns', b: 'Mid is the fair price. Bid and ask show the spread: a wide spread is a hidden cost. Open interest and volume show if anyone trades it. Delta is roughly the odds and the speed. Theta is the daily cost of waiting.' },
      { k: 'click', t: 'Click a contract', b: 'Click any call or put and it loads into the price calculator with its strike, days, implied volatility and market price filled in. Double click it to open that contract\'s own mini chart.' },
      { k: 'calc', t: 'The price calculator', b: 'Change the stock price, days, volatility or the number of contracts and everything recalculates. Use Live to refill from the market. Solve IV back-solves the implied volatility from the price you see.' },
      { k: 'scenario', t: 'The scenario table', b: 'This table shows the profit or loss at expiry if the stock moves from minus ten to plus ten percent. Find the move you actually expect and read what the option pays. If you need a miracle to make money, skip it.' },
      { k: 'breakeven', t: 'Breakeven and chance', b: 'Breakeven is the price the stock must reach at expiry. Chance of finishing in the money is the model\'s odds. Compare the move needed with how far the stock moves in a typical week. Max loss is the premium you pay, and nothing more.' },
      { k: 'screen', t: 'Let the screener suggest', b: 'In the Screener, click CALL or PUT next to a name and a card appears: best fit, also consider, the cost per contract, the move needed, delta, and the return at the first target. The card is for reading, so find the same strike in the chain and click it to test.' },
      { k: 'checks', t: 'The cheap and big checklist', b: 'Tight spread, real open interest, breakeven inside a move the stock has made before, enough time, and a return at the first target that beats the cost. Fewer boxes ticked means a lottery ticket. Treat those as small bets.' },
      { k: 'ready', t: 'Practice first', b: 'Use PAPER TRADE to place the contract with no risk, and watch how theta and volatility change its value. Options can lose their entire value, so learn the pace before you use real money.' }
    ]
  },
  indicators: {
    title: 'Indicator engine and screener', mins: 5, blurb: 'A hands-on tour of every control: search, categories, the catalog, live and feed chips, intervals, the screener, and the contract suggestions.',
    steps: [
      { k: 'intro', t: 'Where it lives and how it connects', b: 'The indicator engine is the panel under the chart, titled INDICATOR ENGINE. Everything you switch on here is drawn on the chart above it, and the interval you pick on the chart or in the screener is the same interval everywhere. It has three parts: the top bar with search, a category list and the Browse button, the row of indicators that are on, and the Screener.' },
      { k: 'active', t: 'Your active indicators', b: 'Right under the title bar you see the indicators that are on right now. SMA and VWAP start switched on. Up to six can be on at once, and each is drawn in its own colour over the candles. To turn one off, find its chip in the catalog and click it again.' },
      { k: 'search', t: 'Search', b: 'Click the search box and type part of a name, such as RSI, VWAP or Bollinger. The catalog filters as you type. If nothing matches it says so, and fewer letters usually finds it.' },
      { k: 'category', t: 'Categories', b: 'The list beside the search box filters by family: trend, momentum, volume, volatility, breadth, patterns, sentiment, valuation, economic, options derived, institutional flow and per share. Pick one family when you have a question, such as is the trend up, or is this move running out of steam.' },
      { k: 'browse', t: 'Browse indicators', b: 'Press Browse indicators to open the full catalog, grouped by family, and press it again to close it. Every indicator is a chip. This is the place to explore: scroll the groups, read the names, and click the ones you want to see on the chart.' },
      { k: 'chips', t: 'Green chips and amber chips', b: 'A green live chip is calculated from the candles on your chart, so clicking it draws it at once, and it lights up while it is on. An amber feed chip needs a data field that is not on the chart, such as market breadth or economic data. Clicking one tells you what is missing, and nothing is guessed or made up.' },
      { k: 'interval', t: 'Indicators follow the interval', b: 'Every indicator is calculated on the interval the chart is showing. Change the interval with the buttons above the chart, or pick one in the screener, and everything recalculates. A fifteen minute reading and a daily reading can disagree, and the longer interval carries more weight.' },
      { k: 'combo', t: 'How to combine them', b: 'Use one indicator from each family: a trend one such as an average, a momentum one such as RSI or MACD, and a volume one such as VWAP or OBV. Three that agree are stronger than six from the same family, which only repeat each other.' },
      { k: 'reading', t: 'Reading what you drew', b: 'Averages and VWAP are lines on the price: look at whether price is above or below them and which way they slope. Oscillators such as RSI measure stretch: a high reading means a strong run that may be tiring, not an automatic sell. An indicator describes what price has done. It never predicts.' },
      { k: 'screener', t: 'Open the screener', b: 'Press Screener, next to Browse. It scans the stocks the Academy tracks and has two tabs: By indicator, and By horizon for long and short ideas. Selecting an indicator chip in the catalog also sets the screener to that indicator.' },
      { k: 'byind', t: 'Tab one: by indicator', b: 'Pick an indicator and a timeframe: one hour, one day, one week, one month, one quarter or one year. Two columns appear, bullish on the left and bearish on the right, with the price and the day change. Choosing a timeframe also switches the chart to it, so you can check the stock with your own eyes.' },
      { k: 'byhorizon', t: 'Tab two: by horizon', b: 'Pick day, swing, mid term or long term. The left column is where M.E.M Algo leans long, and the right column is where it leans short, each with a grade, the bias and any chart pattern, strongest first. Picking a horizon moves the chart to that horizon\'s interval too.' },
      { k: 'rows', t: 'Load a stock', b: 'Click a ticker in any list to load it on the chart. The chart, the quote column and every tool then follow that stock, so you can check the screener\'s idea against the candles, the levels and the flow before you do anything.' },
      { k: 'suggest', t: 'CALL and PUT suggestions', b: 'Beside every name in the horizon lists is a CALL or PUT button. Rest on it and the read starts early, so the click is quick. Press it and a card opens under that row with the contract the engine likes: the best fit and two alternatives, the cost per contract, the breakeven, delta, open interest and the return at the first and second targets. Press the button again to fold it away.' },
      { k: 'shares', t: 'No options, or a thin chain', b: 'If a stock has no listed options, the card says so and shows a plan for the shares instead: three targets with odds and a stop. If the chain is thin, the card says that too, and warns you to use limit orders. If the options feed is busy it retries once by itself.' },
      { k: 'targets', t: 'Targets close the loop', b: 'TARGETS turns the pick into three targets and a stop, with odds taken from the stock\'s own history. Check the odds and the reward against the risk before you decide, and judge the contract against the first target, not the last.' },
      { k: 'limits', t: 'What it will not do', b: 'It does not predict, and it never places a trade. Ranges such as ATR measure how much price moves, not which way, so the screener does not use them. Everything here is education, not advice.' },
      { k: 'routine', t: 'A routine you can repeat', b: 'Search or browse, switch on one trend, one momentum and one volume indicator, and check the interval. Open the screener and look for stocks where they agree. Load one, press TARGETS, and run the pre-alert check before you send any alert. Do it the same way every time, and keep notes.' }
    ]
  },
  fda: {
    title: 'The FDA scanner', mins: 2, blurb: 'Read PDUFA dates, approval odds, impact and the priced move, then plan an event with defined risk.',
    steps: [
      { k: 'intro', t: 'Why FDA dates matter', b: 'A drug decision can move a small biotech by half in one day. The FDA scanner lists upcoming decision dates, called PDUFA dates, so you can plan instead of being surprised.' },
      { k: 'open', t: 'Open CATALYSTS, then FDA', b: 'CATALYSTS has three tabs: earnings, FDA and radar. Pick FDA. Only companies that disclosed their date in an official filing are listed, and the first load can take a minute.' },
      { k: 'columns', t: 'The columns', b: 'Ticker, the PDUFA date, days until it, the review type, the approval estimate, the impact score, and the priced move. Review tags tell you if it is priority, breakthrough, a resubmission, or has an advisory committee.' },
      { k: 'approval', t: 'Approval estimate', b: 'It is a base rate, adjusted for the review type and committee outcome. Above eighty five is likely, seventy is leaning approval, fifty five is uncertain, and below that is at risk. It is a prior, not a prediction about the data.' },
      { k: 'impact', t: 'Impact and priced move', b: 'Impact is zero to one hundred: how much a decision could move this stock, from the size of the options move, the market cap and the short interest. Priced move is what options traders already expect through the date.' },
      { k: 'detail', t: 'Open a row', b: 'Click a row for the price, the size, the short interest, the source sentence from the filing, and the inputs behind each score. Click the ticker to load its chart, and use the release link to read the filing yourself.' },
      { k: 'plan', t: 'Plan the event', b: 'The detail ties into the Hedge and Income planner: a collar, protective put, call spread, straddle or a sell the news spread. If the priced move is already large, buying options is expensive, so look at spreads that cap the cost.' },
      { k: 'risk', t: 'Delays and gaps', b: 'The FDA can miss its date, and a surprise either way gaps the price past any stop. Keep size small enough that a gap does not hurt. This is educational context, not a trade signal.' }
    ]
  },
  hedge: {
    title: 'Hedge and Income', mins: 3, blurb: 'Protect what you own, earn income on it, and see every payoff before you act.',
    steps: [
      { k: 'intro', t: 'What it is for', b: 'Hedge and Income builds options structures around a position you hold or plan: protection if it falls, income while you wait, or a directional play with defined risk. Nothing here places a trade.' },
      { k: 'open', t: 'Where it opens', b: 'Turn on MEM ALGO, then press Hedge and income ideas, or it appears by itself under the chart. It reads the MEM ALGO lean and your own latest alert on the stock to set sensible levels.' },
      { k: 'form', t: 'Tell it your position', b: 'Enter shares, entry, target, stop, and whether you are long or short, then press Update. Your share count is remembered. Without your levels, it falls back to the average true range.' },
      { k: 'context', t: 'Hedges first or income first', b: 'A pill says which comes first and why. Hedges first means risk is high, so protect. Income first means the stock is calm, so get paid to wait.' },
      { k: 'cards', t: 'The strategy cards', b: 'Protective put is insurance. Put debit spread is cheaper insurance with a floor on the payout. Collar pays for the put by selling a call. Covered call and cash secured put earn income. Each card has a fit score from zero to one hundred.' },
      { k: 'numbers', t: 'Read the numbers on a card', b: 'Cost or credit, protected below, upside capped at, yield and annualized yield, the chance it expires worthless, max loss, max gain and breakeven. Also the greeks and a liquidity grade from A to C. Prefer A and B.' },
      { k: 'payoff', t: 'The payoff sketch', b: 'The small chart shows profit or loss at expiry with your entry, target and stop marked, and a dot for today\'s price. If the shape does not match what you want, pick another card.' },
      { k: 'act', t: 'Chart and broker buttons', b: 'Chart opens that contract\'s own mini chart. The broker button opens your broker\'s quote page and copies the contract symbol. It never places an order for you.' },
      { k: 'risk', t: 'The honest risks', b: 'Options can lose all of what you pay. Selling options carries obligations, including assignment. Prices are mid-market estimates and real fills can be worse. Educational analysis only.' }
    ]
  },
  social: {
    title: 'Ticker comments and live chat', mins: 2, blurb: 'Use the comment section on every ticker and the live chat rooms to sharpen your ideas.',
    steps: [
      { k: 'intro', t: 'Two places to talk', b: 'Every stock has its own comment section, called Ticker Talk, for ideas that stay attached to the stock. The live chat rooms are for fast talk while the market moves.' },
      { k: 'talk', t: 'Ticker Talk', b: 'Open TALK to read the comments for the stock on your chart, or switch to Following to see only the traders you follow. Reply, like, expand a comment, or double click to read it full size.' },
      { k: 'post', t: 'Posting a good comment', b: 'Press the compose bar. Use the dollar sign to tag a stock, the at sign to tag a member, and add up to four pictures. Paste a link and it becomes a card. State the idea, the level, and what would prove you wrong.' },
      { k: 'follow', t: 'Traders to follow', b: 'The strip at the top suggests traders to follow. Open their profile, check the alert record and the win rate over ninety days, and follow the ones whose record you respect.' },
      { k: 'rooms', t: 'The chat rooms', b: 'Global chat, day trade, swing trade, short sale and options trading. Pick the room that matches your style. Messages are limited to five hundred characters.' },
      { k: 'chat', t: 'Chat tools', b: 'Reply in threads, vote up or down, and mute anyone. Report a message to the moderators. Click a name to see a profile card with their latest posts, their paper rank and a Follow button.' },
      { k: 'use', t: 'Use it to your advantage', b: 'Chat is for ideas and questions, not for orders. Treat every claim as an opinion, check it against the tools, and share your own analysis with the reason behind it. That is how you build a following.' }
    ]
  },
  profile: {
    title: 'Your profile: customize and monetize', mins: 3, blurb: 'Make your page yours, show your record, and sell access to your alerts with Premium Alert Charts.',
    steps: [
      { k: 'intro', t: 'Your page is your storefront', b: 'Your profile shows who you are as a trader: your record, your posts, and your style. People who follow you start here, so make it clear and make it yours.' },
      { k: 'open', t: 'Open your profile', b: 'Press Profile, then Customize my profile. Changes appear on the page as you make them, and Save keeps them on your Academy account.' },
      { k: 'basics', t: 'Name, tagline and bio', b: 'Pick the name shown on the page, a tagline up to ninety characters, and a bio up to six hundred. Say what you trade, how you trade, and what followers will get.' },
      { k: 'look', t: 'Layout, colors and font', b: 'Choose a layout, an accent and second color, a font, and how immersive the page feels, from off to full. Keep contrast readable.' },
      { k: 'fx', t: 'Backgrounds, lighting and 3D', b: 'Stack background effects, add lighting such as lasers or a disco ball, choose flat or 3D modules, pick textures for each module, and show up to twelve pictures in the 3D gallery.' },
      { k: 'song', t: 'Song and links', b: 'Add one song with an MP3 or M4A upload or direct link. Add links to your social accounts, your Loop channel or your Loop Letter. YouTube and Spotify links are not supported for the song.' },
      { k: 'show', t: 'What to show', b: 'Toggles let you show or hide your paper account and rank, your main server, links, your comments and chat posts, follower counts, and the Trading Wall where members can leave comments.' },
      { k: 'record', t: 'Your record is the product', b: 'Your alert record shows your ninety day win rate. A good record is the thing that makes people follow, and later pay.' },
      { k: 'money', t: 'Monetize with Premium Alert Charts', b: 'Open the alert chart on your profile, then Channels and prices. Up to six channels, each can be premium. Set prices for one day, one week, one month, one year or lifetime. Zero means not offered.' },
      { k: 'paid', t: 'Getting paid', b: 'Link your Discord to your Stock Market Loop account, accept the seller terms, then press Get paid with Stripe. Stock Market Loop keeps six percent, and handles checkout, subscriptions and refunds.' },
      { k: 'rules', t: 'Rules that protect you', b: 'Keep the chart active, because a chart with no post for thirty days counts as not delivering. Non subscribers see your gains but not the ticker or levels. Everything you post is educational, never advice.' }
    ]
  }
};

const stepKey = (playbook, k) => 'pb-' + playbook + '-' + k;
const sayFor = (s) => s.say || (s.t + '. ' + s.b);

module.exports = { PLAYBOOKS, stepKey, sayFor };
