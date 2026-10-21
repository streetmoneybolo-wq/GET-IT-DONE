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
  'alert-scenarios': { name: 'SCENARIO CHARTS', group: 'SHARE', what: 'Two pictures drawn with every Click to Alert: the base case from entry to target, and what to watch if the idea fails.',
    use: ['Build an alert with ALERT, or click a contract in the options chain.', 'Look at both pictures before you send.', 'Leave Attach the two scenario charts ticked so followers see the plan.'],
    edge: 'You see how the trade could play out, and exactly where it is wrong, before any money or any follower is involved.', watch: 'A scenario is a plan, not a forecast. Price is free to ignore it.', pairs: ['click-alert-toggle', 'options-alert'], playbook: 'alerts',
    say: 'Every Click to Alert draws two scenario charts on the stock\'s own chart. The first is the base case, from your entry to your target. The second is what to watch, where the idea fails and where the stop sits. Look at both before you send, and leave them attached so your followers see the plan. A scenario is a plan, not a forecast.' },
  'options-alert': { name: 'OPTIONS ALERT', group: 'SHARE', what: 'An alert on one options contract, built from a single click in the chain.',
    use: ['Open the options chain.', 'Click the contract you like.', 'Press Alert this contract, read the target and the reasoning, then send.'],
    edge: 'The contract\'s target, stop and reasoning are worked out for you, so an options alert is as easy as a stock alert.', watch: 'Options can lose most of their value fast. Size the position so the whole premium is a loss you can take.', pairs: ['chain-toggle', 'alert-scenarios'], playbook: 'alerts',
    say: 'Options alerts are as easy as stock alerts. Open the chain, click the contract you like, and press Alert this contract. The target and the stop are worked out for you with the reasoning written out, and the same two scenario charts are drawn. You can also switch any alert between stock and options. Size it so the whole premium is a loss you can take.' },
  'pt-smashed': { name: 'PT SMASHED', group: 'SHARE', what: 'The update posted when an alert hits its first target: hold for more, bank part, or close.',
    use: ['Post an alert with a first target.', 'When price reaches it, read the update on the alert.', 'Follow the plan it gives for the rest of the position.'],
    edge: 'You are told what to do after the win, which is where most gains are given back.', watch: 'It reads the chart at that moment. A new high target is a plan, not a promise.', pairs: ['click-alert-toggle', 'academy-alerts-fab'], playbook: 'alerts',
    say: 'When an alert reaches its first target, a P T smashed update is posted. It reads the chart right then and tells you whether to hold for a higher target, bank part of the position, or close. Your edge is knowing what to do after the win, which is where most gains are given back.' },
  'catalyst-radar': { name: 'SURPRISE RADAR', group: 'DESK', what: 'Moving names scored on the footprints that often come before unannounced news, including biotech approvals.',
    use: ['Open CATALYSTS, then the RADAR tab.', 'Look at names with several signs at once.', 'Click a row for the evidence, then plan with a hedge.'],
    edge: 'You hear about a stock the market is acting on before the headline lands.', watch: 'The radar cannot know the news. It only sees the market acting as if there is some.', pairs: ['catalysts-toggle', 'fda-scanner'], playbook: 'fda',
    say: 'The surprise radar scores moving stocks on the footprints that often come before unannounced news. Open catalysts, then radar, look for names showing several signs at once, and click a row for the evidence. It cannot know the news, it only sees the market acting as if there is some, so hedge what you hold.' },
  'trading-room': { name: 'TRADING ROOM', group: 'SHARE', what: 'A trader\'s own room behind their profile: free channels for followers and paid channels for subscribers.',
    use: ['Open a trader\'s profile and press Enter the room.', 'Join free to unlock the free channels, or pick a paid tier for the rest.', 'If it is your room, open Room settings: pick a template, then set each channel public, free or paid, and your prices.'],
    edge: 'One easy place for a trader\'s alerts, chat and lessons, and a clear way to be paid for them.', watch: 'What members post is opinion, not advice. Paid tiers are sold on stockmarketloop.com.', pairs: ['click-alert-toggle', 'academy-profile-btn'],
    say: 'The trading room is a trader\'s own room behind their profile. Join free to unlock the free channels, or choose a paid tier for the premium alerts and chat. If it is your room, open room settings, pick a template, and decide for each channel whether it is public, free, or paid, and what you charge. What members post is opinion, not advice.' },
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
    edge: 'You stop staring at the screen. The market comes to you when your level hits.', watch: 'Alerts tell you price arrived. They do not tell you what to do.', pairs: ['snap-toggle', 'targets-toggle'], playbook: 'alerts',
    say: 'Alert lets you click a price on the chart to set a target, then post the alert to Discord. It works for stocks, and for options: click a contract in the chain and the target is worked out for you. Before you send, it draws two scenario charts of how the trade could play out, and a pre alert check warns you if the idea is late. When the first target hits, you get a P T smashed update. Your edge is a clear plan anyone can check, and not staring at the screen.' },
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

/* modules that are not a toolbar button: the page raises their card from a selector or from scrolling them into view (academy-auto-tour.js MODULES) */
Object.assign(TOOLS, {
  'academy-indicator-toggle': { name: 'INDICATOR ENGINE', group: 'LEARN', what: 'A searchable library of every indicator the Academy teaches. The live ones are calculated from your chart and can be switched on.',
    use: ['Search by name or pick a category: trend, momentum, volume, volatility.', 'Tap a live chip to draw it. Up to six can be on.', 'Pair one trend, one momentum and one volume indicator.'],
    edge: 'Three indicators from different families that agree are far stronger than six that say the same thing.', watch: 'Feed chips are taught but not estimated. Indicators describe, they do not predict.', pairs: ['academy-screener-toggle', 'targets-toggle'], playbook: 'indicators',
    say: 'This is the indicator engine, a searchable library of every indicator the Academy teaches. The live ones are calculated from your chart and you can switch them on, up to six at a time. Pair one trend, one momentum and one volume indicator, because three that agree beat six that say the same thing. Indicators describe, they do not predict.' },
  'academy-screener-toggle': { name: 'SCREENER', group: 'LEARN', what: 'Finds stocks where an indicator is bullish or bearish, or where MEM ALGO leans long or short, by horizon.',
    use: ['Pick By indicator or By horizon.', 'Choose a timeframe and click a ticker to load it.', 'Tap CALL or PUT beside a name, then tap a suggested contract to open it in the chain and calculator.'],
    edge: 'It does the scanning, so you only study names where the evidence already lines up.', watch: 'Options can lose their whole value. Test a contract in the calculator before you ever trade it.', pairs: ['targets-toggle', 'chain-toggle'], playbook: 'indicators',
    say: 'The screener finds stocks where an indicator is bullish or bearish, or where MEM ALGO leans long or short. Click a ticker to load it, tap call or put to see suggested contracts, then tap one to open it in the chain and the calculator. Your edge is that it does the scanning, so you only study names where the evidence already lines up. Test it in the calculator first, because options can lose their whole value.' },
  'fda-scanner': { name: 'FDA SCANNER', group: 'DESK', what: 'Upcoming FDA decision dates with an approval estimate, an impact score and the move options already expect.',
    use: ['Open CATALYSTS, then the FDA tab.', 'Sort your eye by days until the date and the impact score.', 'Click a row for the filing, the short interest and the plays.'],
    edge: 'You see biotech events weeks ahead and can plan a defined-risk structure instead of gambling on the day.', watch: 'Approval odds are base rates, and the FDA can delay or surprise either way.', pairs: ['catalysts-toggle', 'chain-toggle'], playbook: 'fda',
    say: 'The F D A scanner has two lists. Scheduled decisions have an exact date, an approval estimate, an impact score, and the move options already expect. Could land any day holds names whose date passed with no news, so an approval or rejection can arrive with no warning. Click a row for the filing and ideas. Odds are base rates, and the F D A can surprise either way.' },
  'hedge-income': { name: 'HEDGE AND INCOME', group: 'DESK', what: 'Options structures around a position: protection, income, or a defined-risk directional play, each with its payoff.',
    use: ['Enter your shares, entry, target and stop, then press Update.', 'Read the pill: hedges first or income first.', 'Compare the cards by cost, protected level, yield and payoff sketch.'],
    edge: 'You see what protection costs and what income pays before you act, and every card shows its worst case.', watch: 'Selling options carries obligations. Nothing here places a trade.', pairs: ['mem-algo-toggle', 'chain-toggle'], playbook: 'hedge',
    say: 'Hedge and income builds options structures around a position, protection if it falls, income while you wait, or a defined risk directional play. Enter your shares and levels, read whether hedges or income come first, then compare the cards by cost, protected level, yield, and payoff. Your edge is seeing the worst case before you act. Selling options carries obligations, and nothing here places a trade.' },
  'market-direction': { name: 'MARKET DIRECTION', group: 'DESK', what: 'A read on SPY and the whole tape: a bias, the evidence behind it, key levels, dealer gamma, volatility and catalysts.',
    use: ['Use the Day trading tab for same-day options.', 'Read the label, then the percent of evidence that agrees.', 'Check key levels, gamma, VIX and catalysts, in that order.'],
    edge: 'You decide direction from the market, not from one stock, which is where most daily option losses begin.', watch: 'Near zero bias means no edge. No read is certain.', pairs: ['chain-toggle', 'mem-algo-toggle'], playbook: 'spy',
    say: 'Market direction reads SPY and the whole tape. It gives a bias, the evidence behind it, key levels, dealer gamma, volatility, and catalysts. Use the day trading tab for same day options, and read it in the same order every morning. Your edge is deciding direction from the market, not from one stock. A bias near zero means no edge, and no read is certain.' },
  'options-chain-lab': { name: 'OPTIONS CHAIN LAB', group: 'DESK', what: 'The full options chain with prices, volume, open interest and the greeks, for every strike and expiration.',
    use: ['Pick an expiration, then how many strikes to show.', 'Click a call or put to load it into the price calculator.', 'Double click a contract for its own mini chart.'],
    edge: 'You can compare cost, breakeven and liquidity across every strike in seconds and pick the contract that fits the plan.', watch: 'A wide bid and ask spread is a hidden cost. Open interest is not direction.', pairs: ['chain-toggle', 'targets-toggle'], playbook: 'cheap',
    say: 'The options chain lab shows every strike and expiration with prices, volume, open interest, and the greeks. Pick an expiration, click a call or put to load it into the price calculator, and double click a contract for its own mini chart. Your edge is comparing cost, breakeven, and liquidity across every strike in seconds. A wide spread is a hidden cost.' },
  'price-calculator': { name: 'PRICE CALCULATOR', group: 'DESK', what: 'Shows what an option is worth and what it pays if the stock moves, before you risk anything.',
    use: ['Change the stock price, days or volatility and watch every number update.', 'Read the scenario table for the move you expect.', 'Press Solve IV to back out the volatility from the market price.'],
    edge: 'You know the breakeven, the chance of finishing in the money and the max loss before you pay a cent.', watch: 'It is a model estimate, not a quote. Real options trade at their own bid and ask.', pairs: ['options-chain-lab', 'paper-toggle'], playbook: 'cheap',
    say: 'The price calculator shows what an option is worth and what it pays if the stock moves. Change the price, days, or volatility and every number updates. Read the scenario table for the move you expect, and use solve I V to back out volatility from the market price. Your edge is knowing the breakeven, the chance of finishing in the money, and the max loss before you pay. It is a model estimate, not a quote.' },
  'live-chat': { name: 'LIVE CHAT ROOMS', group: 'SHARE', what: 'Real-time rooms for global talk, day trading, swing trading, short selling and options.',
    use: ['Pick the room that matches your style.', 'Reply in threads, vote, and mute anyone.', 'Click a name to see their record and follow them.'],
    edge: 'You get questions answered while the market moves and learn how experienced traders think.', watch: 'Treat every claim as an opinion and check it against the tools.', pairs: ['talk-btn', 'academy-profile-btn'], playbook: 'social',
    say: 'These are the live chat rooms, global, day trade, swing trade, short sale, and options. Pick the room that matches your style, reply in threads, and click a name to see their record and follow them. Your edge is getting questions answered while the market moves. Treat every claim as an opinion and check it against the tools.' },
  'academy-profile-btn': { name: 'YOUR PROFILE', group: 'SHARE', what: 'Your public trader page: your record, your posts, your style and your followers.',
    use: ['Press Customize my profile to edit it.', 'Choose what to show: paper rank, links, posts, followers.', 'Use Premium Alert Charts to sell access to your alerts.'],
    edge: 'A clear record and a page that is yours is what turns viewers into followers, and followers into income.', watch: 'Only the owner of a page sees Customize and the chart settings.', pairs: ['talk-btn'], playbook: 'profile',
    say: 'This is your profile, your public trader page with your record, your posts, your style, and your followers. Press customize to make it yours, choose what to show, and set up premium alert charts to sell access to your alerts. Your edge is that a clear record and a page that is yours turns viewers into followers, and followers into income.' },
  'profile-customize': { name: 'CUSTOMIZE PROFILE', group: 'SHARE', what: 'Name, tagline, bio, layout, colors, fonts, lighting, 3D modules, a song, links and what to show.',
    use: ['Fill in your name, tagline and bio first.', 'Pick a layout, colors and an immersion level.', 'Add a song and links, then choose what to show and press Save.'],
    edge: 'A page with a clear identity gets followed. A good bio says what you trade and what followers get.', watch: 'Song links must be direct MP3 or M4A files. YouTube and Spotify are not supported.', pairs: ['academy-profile-btn'], playbook: 'profile',
    say: 'Customize lets you set your name, tagline, bio, layout, colors, fonts, lighting, three D modules, a song, links, and what to show. Fill in the basics first, then the look, then press save. Your edge is a page with a clear identity, because a good bio says what you trade and what followers get. Song links must be direct M P 3 or M 4 A files.' }
});

/* the first-use cards that mention a walkthrough carry `playbook`; these older cards get one too */
Object.assign(TOOLS['mem-algo-toggle'], { playbook: 'together' });
Object.assign(TOOLS['intent-btn'], { playbook: 'together' });
Object.assign(TOOLS['catalysts-toggle'], { playbook: 'fda' });
Object.assign(TOOLS['chain-toggle'], { playbook: 'cheap' });
Object.assign(TOOLS['talk-btn'], { playbook: 'social' });
Object.assign(TOOLS['click-alert-toggle'], {
  what: 'Click-to-alert: click a price on the chart to set a target, run the pre-alert check, then post the alert to Discord.',
  use: ['Turn it on and click the price you care about.', 'Read the pre-alert check: go, caution or wait, and the suggested first target.', 'Pick the server and channel, then send.'],
  watch: 'The check advises and never blocks. An alert tells you price arrived, not what to do.',
  say: 'Alert lets you click a price on the chart to set a target, then runs the pre alert check before you post to Discord. The check tells you go, caution, or wait, whether this is a chase, whether the first target is realistic, and whether the stop makes sense. Your edge is catching a bad alert before you send it. It advises and never blocks.' });

const { PLAYBOOKS, stepKey, sayFor } = require('./tour-playbooks');
for (const [name, pb] of Object.entries(PLAYBOOKS)) for (const s of pb.steps) STEPS[stepKey(name, s.k)] = sayFor(s);

const SIGNOFF_OK = /^[\x20-\x7e]+$/;
const lines = () => [...Object.entries(TOOLS).map(([id, t]) => ['tool:' + id, t.say]), ...Object.entries(STEPS).map(([id, say]) => ['step:' + id, say])];

/** The text the voice may speak for a request, or null. `kind` is 'tool' or 'step'; anything not written above is refused. */
function lineFor(kind, id) {
  const table = kind === 'tool' ? TOOLS : kind === 'step' ? STEPS : null;
  if (!table || typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(table, id)) return null;
  const text = kind === 'tool' ? table[id].say : table[id];
  return typeof text === 'string' && text && SIGNOFF_OK.test(text) ? text : null;
}

/** Tools only the owner account may see or hear. The page hides them, and the speech route refuses them for anyone else. */
const OWNER_ONLY = new Set(['challenge-toggle', 'squeeze-btn']);
const isOwnerOnly = (kind, id) => kind === 'tool' && OWNER_ONLY.has(id);

/** What the page needs: the tool cards without the spoken text (it fetches audio by id), and the step ids that have a voice. */
function catalogForPage() {
  const tools = {};
  for (const [id, t] of Object.entries(TOOLS)) tools[id] = { name: t.name, group: t.group, what: t.what, use: t.use, edge: t.edge, watch: t.watch, pairs: t.pairs, playbook: t.playbook || '', ownerOnly: OWNER_ONLY.has(id) };
  const playbooks = {};
  for (const [name, pb] of Object.entries(PLAYBOOKS)) playbooks[name] = { title: pb.title, mins: pb.mins, blurb: pb.blurb, steps: pb.steps.map((s) => ({ id: stepKey(name, s.k), k: s.k, t: s.t, b: s.b })) };
  return { tools, playbooks, steps: Object.keys(STEPS) };
}

module.exports = { TOOLS, STEPS, lines, lineFor, catalogForPage, OWNER_ONLY, isOwnerOnly };
