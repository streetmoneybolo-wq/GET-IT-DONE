'use strict';

/* What the Academy says about itself, in one place. Two consumers:
 *   - the server voices `say` in the Academy's own ElevenLabs voice (getTourAudio looks the text up by id, so a request can
 *     only ever ask for a line written here, never for arbitrary text);
 *   - the page (academy-auto-tour.js) shows the same entry as a short coach card the first time a member uses a control:
 *     what it is, how to use it, the edge it gives, and what to watch out for.
 * `sel` is the control's selector; `pairs` names the tools worth opening next. Everything is educational: it describes what the
 * data shows, never a promise of a result. */

const TOOLS = {
  'depth-walls': { name: 'WALLS', group: 'CHART', what: 'The big resting orders sitting on the bid and the ask, drawn as bars on the chart.',
    use: ['Switch it on and look for the thickest bars above and below the price.', 'A big bar below price is support that people are defending; above is a ceiling.', 'Watch whether a wall holds or vanishes when price reaches it.'],
    edge: 'You see where size is waiting before price gets there, so you can plan entries and exits near real levels instead of guesses.', watch: 'Walls can be pulled in a blink. Treat them as a hint, and confirm with the tape.', pairs: ['depth-cost', 'heat-toggle'],
    say: 'Walls show the big resting orders on the bid and the ask. A thick bar under the price is support people are defending, and one above is a ceiling. Your edge is seeing where size is waiting before price arrives. Watch whether a wall holds when price touches it, because walls can disappear fast.' },
  'depth-cost': { name: 'COST', group: 'CHART', what: 'Where holders of this stock bought, with the average cost and the share who are in profit.',
    use: ['Turn it on and find the tallest cost area near the price.', 'If price is above most holders, they are happy. If it is below, they may sell the first bounce.', 'Use the profit ratio to judge how much overhead supply there is.'],
    edge: 'You learn where trapped buyers are likely to sell, and where holders are comfortable enough to hold.', watch: 'It is an estimate built from volume, not a list of real accounts.', pairs: ['depth-walls', 'smc-toggle'],
    say: 'Cost shows where holders of this stock bought, plus the average cost and how many are in profit. If price is under most holders, they may sell the first bounce. If it is above them, they are comfortable. Your edge is knowing where trapped buyers are likely to sell. It is an estimate, so use it as context.' },
  'heat-toggle': { name: 'HEAT', group: 'CHART', what: 'An order-book heat map: bright bands are prices where lots of liquidity sat over the last twenty minutes.',
    use: ['Use it on a one or five minute chart.', 'Bright bands near price are magnets or barriers.', 'When price slices through a band, that liquidity was consumed.'],
    edge: 'You see the hidden shape of the book behind the candles and can tell a real barrier from empty space.', watch: 'Only intraday charts have it, and only for the recent past.', pairs: ['depth-walls', 'buysell-toggle'],
    say: 'Heat is an order book heat map. The bright bands are prices where a lot of liquidity sat in the last twenty minutes. Bands near the price act like magnets or barriers, and when price cuts through one, that liquidity was used up. It works on intraday charts only.' },
  'smc-toggle': { name: 'SMC', group: 'CHART', what: 'The smart-money map: gaps, structure breaks, order blocks, liquidity pools and VWAP drawn as zones.',
    use: ['Switch it on, then tap any zone on the chart.', 'A panel opens with what the zone is, the evidence for it and a plain conclusion.', 'Prefer zones that line up with a wall or heavy cost area.'],
    edge: 'You stop guessing which lines matter. Each zone explains itself, so you learn the pattern while you trade it.', watch: 'Zones show where activity happened, not where price must go.', pairs: ['depth-walls', 'intent-btn'],
    say: 'S M C is the smart money map. It draws gaps, structure breaks, order blocks and liquidity as zones. Switch it on and tap any zone, and a panel explains what it is, the evidence, and a plain conclusion. Your edge is that every line explains itself. Zones show where activity happened, not where price must go.' },
  'intent-btn': { name: 'INTENT', group: 'CHART', what: 'A read on what the big money is doing: pressure, hidden icebergs, spoof orders, dark pool and a liquidity map.',
    use: ['Open it and read the headline first. It says the likely aim in plain words.', 'Check the evidence rows underneath to see why.', 'Look for agreement between several signals before you trust it.'],
    edge: 'It turns a pile of order-flow stats into one readable verdict, so you can judge the flow in seconds.', watch: 'Intent is inferred from data. It can be wrong when news hits.', pairs: ['buysell-toggle', 'darkpool-toggle'],
    say: 'Intent reads what the big money is doing. It combines buying pressure, hidden iceberg orders, spoofing and dark pool prints into one plain verdict. Read the headline first, then check the evidence under it. Your edge is judging the flow in seconds. It is inferred from data, so news can change everything.' },
  'targets-toggle': { name: 'TARGETS', group: 'CHART', what: 'Three price targets with odds and a stop, for the direction and time horizon you pick.',
    use: ['Pick bullish or bearish and a horizon.', 'Read the three targets and the odds on each.', 'Use the stop as the point where the idea is wrong.'],
    edge: 'You get a plan with defined risk before you enter: where to take profit and exactly where you are wrong.', watch: 'The odds are estimates from past behavior, not guarantees.', pairs: ['mem-algo-toggle', 'smc-toggle'],
    say: 'Targets gives you three price targets with odds and a stop for the direction and time frame you choose. Read the targets, then use the stop as the price where your idea is wrong. Your edge is a plan with defined risk before you enter. The odds are estimates, never guarantees.' },
  'buysell-toggle': { name: 'BUY/SELL', group: 'FLOW', what: 'Active buying against active selling over the last minute and five minutes.',
    use: ['Open it and compare the buy and sell bars.', 'When price rises on mostly buying, the move has support.', 'If price rises while selling dominates, be careful.'],
    edge: 'It shows whether a move is backed by real buyers or is just drifting.', watch: 'It is short term. Check it again after a few minutes.', pairs: ['darkpool-toggle', 'intent-btn'],
    say: 'Buy and sell shows who is hitting the ask and who is hitting the bid over the last minute and five minutes. When price rises on mostly buying, the move has support. When price rises while selling dominates, be careful. Your edge is knowing if a move has real buyers behind it.' },
  'darkpool-toggle': { name: 'DARK POOL', group: 'FLOW', what: 'Large trades done off the public exchanges, with where they printed and how much of today\'s volume they are.',
    use: ['Open it and look at the biggest prints and their prices.', 'Clusters of big prints near one price mark a level institutions care about.', 'Compare that level with the chart.'],
    edge: 'You can see where large players quietly trade, which often turns into support or resistance later.', watch: 'A print does not say if it was a buy or a sell, so look for a pattern.', pairs: ['intent-btn', 'depth-walls'],
    say: 'Dark pool shows large trades done off the public exchanges, where they printed and how much of the day\'s volume they are. A cluster of big prints at one price marks a level institutions care about. Your edge is spotting levels that often become support or resistance. A print alone does not tell you buy or sell.' },
  'shortsale-toggle': { name: 'SHORT SALE', group: 'FLOW', what: 'Daily short-sale volume and short-interest analysis for this stock.',
    use: ['Check the short volume ratio against its recent average.', 'A high ratio with a rising price means shorts are being squeezed or are wrong.', 'Read the short-interest block for days to cover.'],
    edge: 'You learn whether a stock is crowded on the short side, which is the fuel for squeezes.', watch: 'Short volume includes market makers hedging, so it is a clue, not a confession.', pairs: ['squeeze-btn', 'sentiment-toggle'],
    say: 'Short sale shows daily short selling volume and short interest. Compare the ratio to the recent average, and read days to cover. A crowded short with a rising price is how squeezes start. Remember that short volume includes market makers hedging, so it is a clue and not a confession.' },
  'sentiment-toggle': { name: 'SENTIMENT', group: 'FLOW', what: 'The mood around this stock: how traders and news are talking about it.',
    use: ['Open it and read the overall score.', 'Extreme optimism often shows up near tops, and extreme fear near bottoms.', 'Compare it with what price is actually doing.'],
    edge: 'It tells you when the crowd is leaning one way so you can think about the other side.', watch: 'Mood follows price as often as it leads.', pairs: ['shortsale-toggle', 'talk-btn'],
    say: 'Sentiment shows the mood around this stock. Extreme optimism often appears near tops, and extreme fear near bottoms. Your edge is noticing when the crowd is all leaning the same way. Always compare it with what price is doing, because mood often follows price.' },
  'squeeze-btn': { name: 'SQUEEZE', group: 'FLOW', what: 'The top one hundred squeeze-risk names across the market, for short squeezes and gamma squeezes.',
    use: ['Open the list and sort by the score.', 'Click a name to load it on the chart.', 'Confirm with short sale data and the options chain before acting.'],
    edge: 'You find the setups where forced buying could amplify a move, before the crowd notices.', watch: 'High risk does not mean it will squeeze. It means the fuel is there.', pairs: ['shortsale-toggle', 'chain-toggle'],
    say: 'Squeeze lists the top one hundred names with squeeze risk, both short squeezes and gamma squeezes. Click a name to load it, then confirm with short sale data and the options chain. Your edge is finding setups where forced buying could amplify a move. High risk means the fuel is there, not that it will ignite.' },
  'chain-toggle': { name: 'CHAIN', group: 'DESK', what: 'The options chain for this stock, shown where the chart is.',
    use: ['Pick an expiration, then scan calls on one side and puts on the other.', 'Look for strikes with large open interest and volume.', 'Click again to bring the candles back.'],
    edge: 'The strikes with the most interest are levels the market is watching, and they shape how price behaves near expiration.', watch: 'Options lose value over time. Size positions small while you learn.', pairs: ['squeeze-btn', 'earnings-toggle'],
    say: 'Chain opens the options chain for this stock right where the chart is. Pick an expiration, then look for strikes with high open interest and volume. Those are levels the market is watching. Click it again to return to the candles. Options lose value with time, so keep your size small while you learn.' },
  'mem-algo-toggle': { name: 'MEM ALGO', group: 'DESK', what: 'Five trade plans with entry, stop and targets, from a day and swing trading model.',
    use: ['Open it and pick the style that fits your time frame.', 'Read the entry, the stop and the targets together.', 'Check that the plan agrees with SMC and the flow tools.'],
    edge: 'You get a complete, risk-defined plan to study, and you learn how a rules-based model thinks.', watch: 'It is an educational simulation. Practice it on paper first.', pairs: ['targets-toggle', 'paper-toggle'],
    say: 'Mem Algo shows five trade plans, each with an entry, a stop and targets. Pick the style that fits your time frame and read the three numbers together. Your edge is a complete risk defined plan to study, and you see how a rules based model thinks. It is an educational simulation, so practice on paper first.' },
  'sire-toggle': { name: 'SIRE', group: 'DESK', what: 'A ranking of the day\'s movers so you can see where the action is.',
    use: ['Open it and scan the top of the list.', 'Click a name to load it.', 'Pick the ones with a clear reason to move, like news or volume.'],
    edge: 'You spend your time on stocks that are actually moving instead of hunting one by one.', watch: 'A mover is not an opportunity by itself. Check the chart first.', pairs: ['catalysts-toggle', 'buysell-toggle'],
    say: 'Sire ranks the day\'s movers. Scan the top of the list, click a name to load it, and favor the ones with a clear reason to move, like news or heavy volume. Your edge is spending time only on stocks that are really moving. A mover is not an opportunity until the chart agrees.' },
  'earnings-toggle': { name: 'EARNINGS', group: 'DESK', what: 'The earnings calendar and history for this stock.',
    use: ['Check the next report date.', 'Look at how the stock moved after past reports.', 'Decide before the report whether you want that risk.'],
    edge: 'You will never be surprised by a report date, and you know how big the typical move has been.', watch: 'Past moves do not cap future ones.', pairs: ['catalysts-toggle', 'chain-toggle'],
    say: 'Earnings shows the report calendar and history for this stock. Check the next report date and how the stock moved after past reports, then decide before the report whether you want that risk. Your edge is never being surprised by a date. Past moves do not limit future ones.' },
  'catalysts-toggle': { name: 'CATALYSTS', group: 'DESK', what: 'The earnings playbook, upcoming FDA decisions and the surprise news radar.',
    use: ['Open it to see what is coming and what just hit.', 'Click an item to load the stock.', 'Plan around the event time instead of trading through it blind.'],
    edge: 'Events move prices more than patterns do. Knowing the calendar puts you ahead of most traders.', watch: 'Event outcomes are binary. Smaller size is wiser.', pairs: ['earnings-toggle', 'sire-toggle'],
    say: 'Catalysts gathers the earnings playbook, F D A decisions, and a radar for surprise news. Open it to see what is coming, click an item to load the stock, and plan around the event time. Your edge is knowing the calendar. Event outcomes can go either way, so smaller size is wiser.' },
  'paper-toggle': { name: 'PAPER TRADE', group: 'DESK', what: 'A simulated brokerage account on real prices, with a trade ticket, a portfolio and a profit and loss calendar.',
    use: ['Place a practice trade from the ticket.', 'Set your stop before you enter.', 'Review the calendar at the end of the week to see what worked.'],
    edge: 'You build skill and a track record with zero risk, then you know which of your habits make money.', watch: 'Paper fills are easier than real ones. Expect real trading to feel harder.', pairs: ['mem-algo-toggle', 'challenge-toggle'],
    say: 'Paper trade is a simulated brokerage account on real prices. Place a practice trade, set your stop before you enter, and review your calendar at the end of the week. Your edge is building skill and a track record with no risk. Paper fills are easier than real ones, so expect real trading to feel harder.' },
  'challenge-toggle': { name: 'CHALLENGE', group: 'DESK', what: 'The one thousand to one hundred thousand dollar paper portfolio challenge.',
    use: ['Follow the plan ideas and take them by hand.', 'Log every trade and why you took it.', 'Compare your results with the plan.'],
    edge: 'A clear goal and a visible scoreboard keep you disciplined and teach you position sizing.', watch: 'It is simulated. Real fills and emotions differ.', pairs: ['paper-toggle', 'mem-algo-toggle'],
    say: 'Challenge is the one thousand to one hundred thousand dollar paper portfolio challenge. Take the plan ideas by hand, log why you took each one, and compare yourself to the plan. Your edge is discipline and learning position sizing. It is simulated, so real fills and emotions will feel different.' },
  'talk-btn': { name: 'TALK', group: 'SHARE', what: 'Ticker Talk, the comment section for this ticker.',
    use: ['Read what other members are saying.', 'Post your own read with the reason behind it.', 'Come back after the move to see who was right and why.'],
    edge: 'Explaining your idea in words sharpens it, and other views show what you missed.', watch: 'Comments are opinions. Verify before you act.', pairs: ['sentiment-toggle', 'snap-toggle'],
    say: 'Talk opens Ticker Talk, the comment section for this ticker. Read what others say, post your own read with the reason behind it, and come back after the move to see who was right. Your edge is that explaining an idea sharpens it. Comments are opinions, so verify before you act.' },
  'snap-toggle': { name: 'SNAP', group: 'SHARE', what: 'Takes a snapshot of the chart and posts it to your Discord channel.',
    use: ['Set up the chart the way you want to show it.', 'Press Snap.', 'Hold Shift while clicking to choose the channel.'],
    edge: 'It is the fastest way to share a setup with your group, and to keep a record of what you saw.', watch: 'Snapshots go to Discord, so check what is on screen first.', pairs: ['click-alert-toggle', 'talk-btn'],
    say: 'Snap takes a picture of the chart and posts it to your Discord channel. Set the chart up the way you want, then press Snap. Hold Shift while clicking to choose a channel. Your edge is a fast way to share a setup and keep a record. It goes to Discord, so check what is on screen first.' },
  'click-alert-toggle': { name: 'ALERT', group: 'SHARE', what: 'Click-to-alert: click a price on the chart to set a target, then post the alert to Discord.',
    use: ['Turn it on and click the price you care about.', 'Confirm the alert.', 'You will be told when price gets there.'],
    edge: 'You stop staring at the screen. The market comes to you when your level hits.', watch: 'Alerts tell you price arrived. They do not tell you what to do.', pairs: ['snap-toggle', 'targets-toggle'],
    say: 'Alert lets you click a price on the chart to set a target, then post the alert to Discord. Turn it on, click the price you care about, and confirm. Your edge is not staring at the screen, because the market comes to you. An alert tells you price arrived, not what to do.' },
  'article-btn': { name: 'ARTICLE', group: 'SHARE', what: 'The Article Desk, which writes a market news piece from Academy data with a live chart.',
    use: ['Pick a ticker or a topic.', 'Review the draft it writes.', 'Publish it to the Loop Letters.'],
    edge: 'It turns your data into a finished piece in minutes.', watch: 'Always read the draft before it goes out.', pairs: ['talk-btn'],
    say: 'Article opens the Article Desk, which writes a market news piece from Academy data with its live chart. Pick a ticker or topic, review the draft, and publish it. Your edge is turning data into a finished piece in minutes. Always read the draft before it goes out.' },
  'lesson-toggle': { name: 'LESSONS', group: 'LEARN', what: 'Short narrated lessons that teach each concept on a live chart.',
    use: ['Start at lesson one and go in order.', 'Listen, then answer the quick quiz.', 'Replay any lesson you want to hear again.'],
    edge: 'You learn the reason behind every tool, so you use them with confidence instead of copying signals.', watch: 'Do the quiz. Remembering beats recognizing.', pairs: ['mem-algo-toggle', 'smc-toggle'],
    say: 'Lessons are short narrated lessons that teach each concept on a live chart. Start at lesson one, listen, then answer the quick quiz. Your edge is understanding why each tool works, so you use it with confidence instead of copying signals. Do the quiz, because remembering beats recognizing.' },
  'academy-alerts-fab': { name: 'ALERTS DESK', group: 'LEARN', what: 'Trade alerts from your servers and traders you follow, scored and tracked.',
    use: ['Open it to see the newest alerts.', 'Read the entry, the target and the stop.', 'Check how past alerts played out before trusting a source.'],
    edge: 'Every alert is scored, so you learn whose calls are worth your attention.', watch: 'An alert is somebody\'s idea, not advice.', pairs: ['click-alert-toggle'],
    say: 'The alerts desk shows trade alerts from your servers and traders you follow, scored and tracked. Open it, read the entry, target and stop, and check how past alerts played out. Your edge is knowing whose calls deserve your attention. An alert is someone\'s idea, never advice.' }
};

/* the spoken script for the guided tour, by step id (academy-tour.js carries the same ids) */
const STEPS = {
  welcome: 'Welcome to the Academy. This is a live trading lab with real time charts, order flow, dark pool prints, short sale data, options, and a signal engine, all in one place. I will walk you through it in about a minute.',
  symbol: 'First, pick any stock. Type a ticker and press Enter. The whole page follows the stock you choose, the chart, the quote column, and every tool.',
  timeframe: 'Choose your time frame here. One minute is for day trades, and one year is for the big picture. The chart keeps your zoom when you switch.',
  chart: 'This is the live chart. Drag to scan the past, scroll to zoom, and drag the price axis to stretch the scale. Hover to see the exact open, high, low, and close.',
  'group-chart': 'These are the chart tools. They draw what the big players are doing right on the candles. Walls are big resting orders, cost is where holders are underwater, heat is the order book heat map, S M C is the smart money zones, and intent is the likely aim of the flow.',
  smc: 'Switch on S M C, then click any zone on the chart. A full breakdown opens beside the chart, with what the zone is, the evidence, and a plain conclusion.',
  'group-flow': 'Flow tools show who is buying and selling. Buy and sell pressure, dark pool block prints, short sale data, and sentiment. This is the money behind the move, not just the price.',
  'group-desk': 'Desk panels. Chain opens the options chain. Mem Algo shows five trade plans with entries, stops, and targets. Sire ranks the movers, and earnings and catalysts show what is coming.',
  side: 'The quote column has the live price, the bid and ask, depth, and the top of the scanner. Click a scanner row to load that stock on the chart.',
  scanner: 'The live market scanner covers stocks, E T Fs, options, and premarket movers. Sort by change or volume, then click any row.',
  lessons: 'Lessons are short narrated lessons that teach each concept on a live chart, from how a candle works to reading order flow.',
  alerts: 'The alerts desk collects trade alerts from your servers and traders you follow, scored and tracked, so you can see how they played out.',
  ready: 'You are ready. Everything here is educational. It shows what the market did and what the data says, never a promise. And from now on, the first time you use a tool, I will explain it. You can reopen this tour any time from the tour button.',
  'p-welcome': 'Welcome to the Academy, a live trading lab in your pocket. Real time charts, order flow, dark pool prints, options, and a signal engine. Here is a one minute tour.',
  'p-chart': 'This is your chart. Drag to scan, pinch to zoom, and drag the price axis to stretch it. It stays on top while you read everything else.',
  'p-symbol': 'Type a ticker and press Go. The chart and every tab follow it, and the Academy remembers it for next time.',
  'p-timeframe': 'Your time frame is right under the chart, from one minute up to one year.',
  'p-tools': 'These are the chart tools. Walls, cost, heat, S M C, and intent draw what the big players are doing straight on the candles. Tap one to switch it on.',
  'p-tabs': 'Stock tabs. Chart, flow, options, algo, and comments. Each tab keeps its related tools together, and the chart stays visible above them.',
  'p-flow': 'The flow tab shows buy and sell pressure, dark pool prints, short sale data, and sentiment for this stock.',
  'p-algo': 'The algo tab has Mem Algo trade plans and the smart money map. Tap a zone on the chart and its full breakdown opens right under it.',
  'p-talk': 'The comments tab shows what other traders are saying about this stock.',
  'p-quotes': 'Quotes and chat. The live market scanner is on top and the Academy chat is below. Tap a row to put that stock on the chart.',
  'p-nav': 'Alerts opens the alerts desk, and lessons teaches each concept on a live chart.',
  'p-more': 'More holds settings, your profile, appearance, and this tour, any time you want it.',
  'p-ready': 'You are ready. Everything here is educational and never a promise. And from now on, the first time you use a tool, I will explain it. Replay this from More.'
};

const SIGNOFF_OK = /^[\x20-\x7e]+$/;
const lines = () => [...Object.entries(TOOLS).map(([id, t]) => ['tool:' + id, t.say]), ...Object.entries(STEPS).map(([id, say]) => ['step:' + id, say])];

/** The text the voice may speak for a request, or null. `kind` is 'tool' or 'step'; anything not written above is refused. */
function lineFor(kind, id) {
  const table = kind === 'tool' ? TOOLS : kind === 'step' ? STEPS : null;
  if (!table || typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(table, id)) return null;
  const text = kind === 'tool' ? table[id].say : table[id];
  return typeof text === 'string' && text && SIGNOFF_OK.test(text) ? text : null;
}

/** What the page needs: the tool cards without the spoken text (it fetches audio by id), and the step ids that have a voice. */
function catalogForPage() {
  const tools = {};
  for (const [id, t] of Object.entries(TOOLS)) tools[id] = { name: t.name, group: t.group, what: t.what, use: t.use, edge: t.edge, watch: t.watch, pairs: t.pairs };
  return { tools, steps: Object.keys(STEPS) };
}

module.exports = { TOOLS, STEPS, lines, lineFor, catalogForPage };
