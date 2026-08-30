<?php
/**
 * SML Q&A - seed content data (Phase 5).
 *
 * Evergreen editorial Q&A: slug, title, ticker (optional), question_body,
 * answer_body. Each entry was drafted and adversarially fact-checked for accuracy
 * before inclusion (workflows qa-seed-content + qa-seed-content-2). Consumed by
 * includes/seed.php (idempotent: existing slugs are skipped on re-seed).
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_qa_seed_data() {
	return array(
		array(
			'slug'          => 'stock-halted-volatility-luld-pause',
			'title'         => 'Why did my stock get halted for volatility, and what should I do during the pause?',
			'ticker'        => '',
			'question_body' => 'I was watching a stock spike hard and suddenly it froze with a "volatility trading pause" message for a few minutes. I\'ve seen people call this an LULD halt, but I don\'t really understand why it triggers or how long it lasts. What\'s actually going on, and is there anything I should be doing while it\'s paused?',
			'answer_body'   => 'An LULD pause comes from the Limit Up-Limit Down mechanism, a national system built to stop an individual stock from trading at prices far away from where it was moments earlier. Throughout the session the mechanism continuously calculates a reference price, roughly the average of recent qualifying trades, and sets a price band above and below it. Trades cannot execute outside that band.

When buying or selling pressure pushes the national best bid up to the upper band, or the best offer down to the lower band, the stock enters what is called a limit state. If the market does not move back inside the band within a short window of about fifteen seconds, the listing exchange declares a trading pause, normally lasting five minutes, during which the stock is halted across all venues.

The percentage bands are wider for lower-priced stocks and for less-liquid names, and they widen further near the open and close when volatility is naturally higher. That is why a fast-moving small cap halts more easily than a large, heavily traded one.

During the pause you cannot trade, but you can place, modify, or cancel orders. The listing exchange then runs a reopening auction to set a new price, and that reopening can be volatile with wide spreads. A market order left resting can fill at a surprising level. Many traders prefer limit orders, smaller size, and watching the reopening print before acting rather than chasing the first tick.',
		),
		array(
			'slug'          => 'how-dealer-gamma-pins-stocks-at-expiration',
			'title'         => 'Why do stocks seem to \'pin\' to certain strikes on options expiration day?',
			'ticker'        => 'SPY',
			'question_body' => 'I keep hearing that stocks get "pinned" to a strike price on expiration Friday, and other times options names make moves way bigger than usual. People blame "dealer gamma" for both. How does market-maker hedging actually pull a stock toward a strike, and when does it do the opposite and push it around?',
			'answer_body'   => 'Dealers who make markets in options take the opposite side of what customers trade, then hedge the resulting directional risk by buying or selling the underlying. Gamma measures how fast an option\'s delta changes as the stock moves, so it governs how much dealers must re-hedge and, combined with the sign of their position, in which direction.

When dealers are net long gamma, their hedging is stabilizing. As the stock rises their delta grows and they sell; as it falls their delta shrinks and they buy. That buy-low, sell-high pattern absorbs flow and compresses ranges. If dealers are long the options clustered at a high-open-interest strike, gamma there spikes into expiration, so their hedging tightens around that price and the stock tends to gravitate toward it, the pin, especially once price already sits near the strike late on expiration day.

When dealers are net short gamma, the mechanics reverse. They buy as price rises and sell as it falls, adding fuel instead of damping it. The same crowded strike then repels rather than attracts, and you get trends, air pockets, and sharper swings.

So a big open-interest strike is not automatically a magnet; the pull depends on who is long or short that gamma. That positioning is inferred from assumptions about who holds what, not observed directly, so estimates can be wrong. Pinning is a tendency in heavily-optioned names at large expirations, not a rule. Charm and vanna flows add further complexity.',
		),
		array(
			'slug'          => 'is-unusual-options-volume-bullish-or-bearish',
			'title'         => 'How do I tell if unusual options volume is actually bullish or bearish?',
			'ticker'        => '',
			'question_body' => 'I keep seeing alerts about "unusual options activity" and huge call or put volume on a stock, and people instantly label it bullish or bearish. But how can anyone read direction from a volume number alone? What actually separates aggressive buying from aggressive selling, and why do experienced traders say this flow gets misread so often?',
			'answer_body'   => 'Start with the core fact: every option contract traded has both a buyer and a seller, so raw volume only counts contracts changing hands. It tells you activity happened, not which way anyone is positioned.

To infer intent, traders look at where a trade printed relative to the quote. A fill at or above the ask suggests an aggressive buyer lifting the offer; a fill at or below the bid suggests an aggressive seller hitting the bid. This trade-side read is a probabilistic heuristic, not proof, and it degrades in wide or fast-moving markets where the quote itself is unreliable.

Sweeps versus blocks add context. A sweep is one order split across multiple exchanges to fill immediately, often read as urgency. A block is a single large negotiated print, frequently tied to spreads, hedges, or institutional positioning rather than a naked directional bet.

Why volume stays ambiguous: a bought call could open a bullish bet, close a short call, or hedge a short stock position. It may be one leg of a spread, collar, or roll that is neutral or even bearish on net. And the counterparty is often a market maker who delta-hedges, so the print reflects no view at all.

Corroborate before concluding. Compare volume to open interest to judge opening versus closing, check whether both legs of a structure printed together, and weigh strike, expiration, and the spot price. Treat flow as a hypothesis, not a signal.',
		),
		array(
			'slug'          => 'what-high-short-interest-tells-you',
			'title'         => 'What does high short interest actually tell me about a stock, and does it mean a squeeze is coming?',
			'ticker'        => 'GME',
			'question_body' => 'I keep seeing traders point to a stock\'s high short interest as proof it\'s about to rip higher, but plenty of times the short sellers turn out to be dead right and the thing just keeps bleeding. How am I supposed to read short interest and days-to-cover without fooling myself? I don\'t want to chase a squeeze that never shows up.',
			'answer_body'   => 'Short interest is the number of shares sold short and not yet bought back. It is most useful as a percentage of the float, the freely tradable shares, because that measures how much of the real supply is committed to a bearish bet. In the US it is reported on a lag, roughly twice a month, so the figure you see is a stale snapshot rather than a live reading.

Days-to-cover divides short interest by average daily volume, estimating how many normal trading days shorts would need to buy back. A high number matters because covering means buying: if a catalyst forces many shorts to exit into thin liquidity, their purchases push price up, triggering more covering, the squeeze feedback loop. That loop contributed to episodes like GME, though options gamma and coordinated retail buying were just as central there.

High short interest alone predicts no squeeze. Shorts are often informed, and heavily shorted stocks tend to underperform on average, so elevated readings can persist for months while the bearish thesis plays out. A squeeze needs a trigger, such as news, sustained buying pressure, or options gamma, not just crowded positioning.

Common misreadings: treating short interest as a buy signal on its own; confusing percent-of-float with percent-of-shares-outstanding; ignoring the reporting lag; and assuming readings above 100 percent imply fraud, since legitimate share lending can produce that. For real-time pressure, borrow fees and utilization reveal far more than the semi-monthly figure.',
		),
		array(
			'slug'          => 'implied-vs-realized-volatility-gap',
			'title'         => 'What\'s the difference between implied volatility and realized volatility, and why does the gap matter?',
			'ticker'        => 'SPY',
			'question_body' => 'I keep seeing options called "expensive" or "cheap" based on implied volatility, but the stock\'s actual price swings often look nothing like that number. How is implied volatility different from the historical or realized volatility I can measure straight off the chart? And why do traders obsess over the spread between the two before deciding to buy or sell premium?',
			'answer_body'   => 'Realized volatility, often called historical volatility, measures how much a stock actually moved over some past window. You compute it from the standard deviation of past price returns and then annualize it. It is backward-looking and observed.

Implied volatility is different in kind. It is not measured from price history; it is backed out of current option prices. Given an option\'s market price, you ask what volatility input, fed into a pricing model, reproduces that price. That number is IV, and it reflects the market\'s collective expectation of how much the underlying will move over the option\'s remaining life. It is forward-looking and set by supply and demand for the options themselves.

Because they answer different questions, what happened versus what is expected, they routinely diverge. That gap is the crux of options trading. Implied vol tends to sit above the vol that later gets realized; this persistent premium compensates sellers for bearing risk. When IV is high relative to your estimate of future movement, options are richly priced, favoring sellers. When IV is low relative to what likely unfolds, options look cheap, favoring buyers.

The discipline is to compare IV against your forecast of future realized vol, not just past realized, which is only a proxy. Tools like IV rank place current IV in its own historical context. No gap is a free lunch, though: the premium exists precisely because the seller absorbs tail risk.',
		),
		array(
			'slug'          => 'what-is-vwap-and-how-to-use-it',
			'title'         => 'What exactly is VWAP and how do I use it for intraday entries?',
			'ticker'        => 'SPY',
			'question_body' => 'I keep seeing VWAP plotted on other traders\' charts, and people say price is "above VWAP" or "below VWAP" like it means something important. I get that it\'s some kind of average, but I don\'t understand why big funds and scalpers both seem to care about the same line. Can you explain what it actually measures and how traders use it to time entries or judge whether a price is fair during the day?',
			'answer_body'   => 'VWAP stands for volume-weighted average price. Through a single session it tracks the average price at which a security has changed hands, with each trade weighted by its size. Mechanically, a platform multiplies price by volume for each interval, keeps a running sum, and divides by cumulative volume. Because it accumulates from the opening bell and resets the next morning, VWAP is an intraday, single-day reference that grows steadier as the day\'s volume builds.

Institutions watch VWAP because it is an execution benchmark. A desk filling a large order judges the result against the day\'s VWAP: buying below it or selling above it means beating the volume-weighted average price everyone paid. Execution algorithms deliberately slice orders to track VWAP, spreading fills across time to reduce market impact.

Day traders treat VWAP as a rough proxy for intraday fair value and a gauge of who is in control. Price holding above VWAP suggests buyers dominate; sustained trade below suggests sellers do. Some enter on pullbacks toward VWAP in the direction of the trend, or fade stretched moves back to it, partly because so many participants and algorithms reference the same line. That pull is a tendency, not a rule: on strong-trend or gap days price can stay extended from VWAP the whole session and never return.

VWAP is descriptive, not predictive. It lags because it reflects trades already done, whipsaws early when little volume has accumulated, and says nothing by itself about news or longer-term value.',
		),
		array(
			'slug'          => 'stock-gaps-up-earnings-then-sells-off',
			'title'         => 'Why did my stock gap up on great earnings but then sell off the same day?',
			'ticker'        => 'NFLX',
			'question_body' => 'I held into an earnings report and the numbers looked fantastic, revenue and profit both beat. The stock even spiked at the open. But by the afternoon it was red on the day. How can a company crush earnings and still fall on the same session? I don\'t understand what I\'m missing.',
			'answer_body'   => 'The number that actually matters going into a report is not the analyst consensus everyone quotes; it is the expectation already embedded in the price. Ahead of the print the market often prices in an unofficial bar, sometimes called a whisper number, that can sit above the published estimate. A beat that clears consensus but falls short of that higher bar behaves like a miss, so buyers who chase the open get sold into by traders who positioned early and are now taking profits. This is the classic buy the rumor, sell the news.

Options activity can add noise. Before earnings, implied volatility is elevated because the outcome is uncertain, and once results are out that uncertainty collapses, an effect called IV crush. IV crush mainly deflates option premiums rather than pushing the stock in any set direction, and as dealers unwind earnings hedges the resulting flow can move the shares either way, adding to the churn.

Guidance is often decisive. Markets are forward looking, so a strong quarter paired with cautious guidance, softening margins, or a shaky call can flip sentiment mid session as traders read past the headline beat.

Positioning matters too. If a stock ran up hard into the print, much of the good news was already owned, and profit taking or fading short covering can turn an opening spike into a red close. None of these guarantee direction; they explain why good numbers and a falling price routinely coexist.',
		),
		array(
			'slug'          => 'options-open-interest-support-resistance',
			'title'         => 'Do big options strikes actually act as support and resistance?',
			'ticker'        => 'QQQ',
			'question_body' => 'I keep seeing traders point at strikes with huge open interest and call them support or resistance, and there\'s all the talk about price getting "pinned" to max pain into expiration. Is there a real mechanism behind that, or is it just chart astrology? I mostly trade liquid names and ETFs like QQQ and want to know when to take these levels seriously.',
			'answer_body'   => 'Large open interest can influence price, but through dealer hedging, not because the strikes themselves are magic. Market makers take the other side of customer option flow and hedge in the underlying to stay delta-neutral, so what matters is their aggregate gamma. When dealers are net long gamma, they buy dips and sell rallies to rehedge, which dampens moves and can pull price toward heavily owned strikes as expiration nears. That is the pinning effect, and it is strongest for single stocks with share settlement and concentrated open interest at a nearby round strike. When dealers are net short gamma, the same hedging runs in reverse: they buy strength and sell weakness, accelerating moves through levels instead of holding them.

Max pain, the strike where the most total option value expires worthless, is a related folk indicator. Price sometimes drifts toward it into expiration, but the evidence is weak and easily overwhelmed.

The limits matter, especially for your case. You cannot directly observe dealer positioning; retail gamma estimates only guess which side the dealer holds. Pinning concentrates in the final day or two and barely touches cash-settled index options. Note that ETFs like QQQ settle into shares, not cash, so the mechanism technically applies, but QQQ is so large, liquid, and arbitraged against its basket and futures that reliable pinning is rare. Any catalyst, like earnings or a macro print, erases it. Treat concentrated strikes as areas where hedging flow may cluster, not as guaranteed floors or ceilings.',
		),
		array(
			'slug'          => 'bid-ask-spread-hidden-cost',
			'title'         => 'Why does the bid-ask spread cost me even when the stock doesn\'t move?',
			'ticker'        => 'SPY',
			'question_body' => 'I keep seeing a gap between the bid and the ask when I pull up a quote, and sometimes it\'s a penny and sometimes it\'s much wider. I\'ve noticed I\'m often down a little the instant my order fills, before the stock has even moved. Is that spread actually costing me, and what makes it get so wide on some tickers?',
			'answer_body'   => 'The bid is the highest price buyers are currently willing to pay; the ask, or offer, is the lowest price sellers will accept, and the spread is the gap between them. It exists because whoever posts those quotes, typically market makers, earns that gap as payment for standing ready to trade and for carrying inventory they may not want.

You pay it because you buy at the ask and sell at the bid. Buy and instantly sell and you lose the full round-trip spread before the price moves. A market order crosses the spread at once, so a wide spread means you start underwater and pay again on the exit. The mid-price shown is a reference point, not a guaranteed fill.

Several things widen the quoted spread. Low liquidity: fewer resting shares and fewer competing makers mean a bigger gap, which is why a thin small cap trades far wider than a heavily traded name like SPY. Volatility: when prices jump, makers widen quotes to avoid being picked off, which is why spreads also balloon around the open and the close. A separate cost is order size: a large order can exceed what sits at the best price and walk the book into worse levels, called slippage, on top of the spread. Thin sessions like pre-market and after-hours widen quotes too.

Because the cost is baked into the fill price rather than billed as a fee, it hides easily. Limit orders, liquid names, and sizing to available depth all shrink what it quietly takes.',
		),
		array(
			'slug'          => 'market-vs-limit-order-when-each-hurts',
			'title'         => 'Market order vs limit order — when does each one actually hurt me?',
			'ticker'        => '',
			'question_body' => 'I keep seeing people say to never use market orders, but sometimes my limit orders just sit there and I miss the whole move. I trade a mix of big liquid names, some thinner small caps, and a few options. When does it actually matter which order type I pick, and what is the real downside of each one?',
			'answer_body'   => 'A market order and a limit order differ in what they guarantee. A market order guarantees execution but not price: it tells the exchange to fill immediately at the best available price, crossing the spread and consuming resting liquidity one price level at a time. A limit order guarantees price but not execution: it fills only at your stated price or better, and otherwise sits in the order book waiting.

That trade-off defines each one\'s failure mode. A market order\'s risk is slippage. In a wide spread, a thin book, or a fast market, your fill can land well past the last quote because the order walks the book until your whole size is filled. Overnight news and the opening auction make this worse, because price can gap far from where you last looked. Market orders punish you most in illiquid stocks, low-volume options, and volatile moments.

A limit order\'s risk is the opposite: a missed fill or a partial fill. If price never reaches your limit, you simply do not get in, and if it then runs, that is real opportunity cost. If only part of your size trades at your price, the remainder keeps resting. Limits hurt when you must be in or out right now, chasing a breakout or needing an exit, and the market moves without you.

A marketable limit order splits the difference: priced at or slightly through the current market, it usually fills like a market order but caps how bad the price can get.',
		),
		array(
			'slug'          => 'what-is-stock-float-low-float-moves',
			'title'         => 'What is a stock\'s \'float,\' and why do low-float stocks move so violently?',
			'ticker'        => '',
			'question_body' => 'I keep hearing traders talk about "low-float" stocks that rip 100% in a day on what seems like small news. I get that float is different from shares outstanding, but I don\'t really understand why a smaller float makes a stock so much more explosive. What\'s actually happening under the hood that makes these things spike and get halted?',
			'answer_body'   => 'Float is the number of shares actually available for the public to trade. Start with shares outstanding, then subtract shares that are closely held or restricted: insider stakes, holdings under lockups, and large strategic owners who aren\'t selling. What\'s left is the tradable supply that changes hands on the open market.

Price is set at the margin, by whoever is most willing to transact right now. A larger float tends to come with deeper resting orders, so buying pressure gets absorbed and moves are gradual. When the tradable supply is small, there often aren\'t many shares or resting sell orders near the current price, so eager buyers have to walk up the order book, paying higher and higher prices to get filled. The same dollar demand can produce a far bigger percentage move.

This also feeds squeezes. Short sellers borrow shares to sell them; if short interest is large relative to a tiny float, their buying-to-cover competes with fresh buyers for the same scarce shares, creating a self-reinforcing spike. Thin floats also carry wide bid-ask spreads, so slippage is severe.

Exchanges limit how fast a single stock can move using volatility bands, often called limit up-limit down. Trades can\'t execute outside the band; if the price presses against it and doesn\'t retreat within a short window, trading pauses briefly and then reopens. Low-float runners hit these limits easily, which is why they gap, halt, and reopen repeatedly.',
		),
		array(
			'slug'          => 'why-stocks-drop-on-ex-dividend-date',
			'title'         => 'Why does a stock drop by about the dividend amount on the ex-dividend date?',
			'ticker'        => 'KO',
			'question_body' => 'I noticed one of my dividend stocks opened lower on the ex-dividend date by almost exactly what the dividend pays. It didn\'t look like bad news or heavy selling — it just gapped down at the open. Is this a real drop I should worry about, and does it mean I can buy right before the ex-date, collect the dividend, and sell for a quick gain?',
			'answer_body'   => 'When a company pays a cash dividend, that cash leaves the business and goes to shareholders. Each share afterward represents a claim on slightly less cash than it did the day before. The ex-dividend date is the cutoff for who receives the payment: buy before it and you collect the dividend, buy on or after it and you do not. Because a new buyer on the ex-date is giving up that upcoming cash, the share is worth roughly one dividend less to them, and the stock opens lower to reflect it.

This adjustment is mechanical, not a wave of selling. Before the open on the ex-date, brokers and pricing feeds show an adjusted prior close, and exchanges reduce standing buy limit orders by the dividend amount. No one has to sell for the drop to appear; it is built into the opening price.

That is why dividend capture, buying just before the ex-date to grab the payout and then selling, is not free money. In theory the price decline offsets the dividend you receive, leaving total return roughly unchanged before costs. Commissions and the bid-ask spread, paid on both trades, chip away at it, and taxes often make it worse: a dividend captured over just a few days can fail the holding-period test for the lower qualified rate and be taxed as ordinary income.

In practice the drop is approximately, not exactly, the dividend, and ordinary daily price swings easily swamp it on any single stock.',
		),
		array(
			'slug'          => 'how-do-share-buybacks-affect-stock-price',
			'title'         => 'How does a share buyback actually affect the stock price?',
			'ticker'        => 'AAPL',
			'question_body' => 'I keep hearing that when a company like AAPL announces a buyback, the stock is supposed to go up. But I don\'t really get why buying back shares would make each share worth more, or whether that\'s just a talking point. Is a buyback actually returning value to me, or is it financial engineering that mostly helps executives? What are the real ways it moves the price versus the myths?',
			'answer_body'   => 'A buyback is a company using its own cash to purchase its shares on the open market and retire them, shrinking the share count. It is one of two main ways to return cash to owners, the other being dividends.

The clearest real mechanism is EPS math. Net income stays the same, but it is now divided across fewer shares, so earnings per share rises purely arithmetically. If the price-to-earnings multiple holds, a higher EPS supports a higher price. This is not created value, it is concentration: each remaining share owns a larger slice of the same business.

Second is signaling. Management authorizing a buyback can signal that leadership believes shares are undervalued and that cash flow is stable enough to spend. Markets sometimes reward that confidence, though a signal is only as good as the judgment behind it.

Third is simple supply and demand. A steady buyer in the market can provide price support, especially during selloffs.

The myths: a buyback does not directly hand you cash the way a dividend does, and an announced authorization is not a guarantee, companies can announce and not execute. It does not raise the intrinsic value of the business, and overpaying for shares destroys value. It also does not fix weak fundamentals. Watch whether buybacks are funded by real free cash flow or by debt, and whether they merely offset shares issued to employees.',
		),
		array(
			'slug'          => 'does-a-high-vix-predict-a-crash',
			'title'         => 'Does a high VIX actually mean a crash is coming, and what is it really measuring?',
			'ticker'        => 'VIX',
			'question_body' => 'I keep seeing traders freak out when the VIX jumps and call it the "fear index." I get that it\'s supposed to measure volatility, but what is it actually calculated from? And if it spikes to a high reading, does that mean a market crash is about to happen, or is treating it as a warning signal just a myth?',
			'answer_body'   => 'The VIX is the Cboe Volatility Index, and it estimates how much the S&P 500 is expected to move over the next 30 days. Crucially, it is not measured from past prices. It is calculated from the live prices of a wide strip of SPX index options, puts and calls across many strikes. Option prices embed implied volatility: the more traders pay for options, the larger the moves they are bracing for. The VIX blends those prices into one number, annualized and expressed in percentage points. A reading of 20 implies roughly 20 percent annualized volatility. Divide by about 3.46 (the square root of 12) to approximate the expected one-month move.

It earns the "fear index" nickname because it usually spikes when stocks fall. Selloffs trigger a rush to buy downside protection, which bids up put prices and lifts implied volatility, so the VIX tends to move opposite to the S&P 500.

The honest limits matter. The VIX measures the expected size of moves, not their direction, so a high reading never says which way the market will go. It is largely coincident, not predictive: it typically rises during or after a decline rather than before one, making it more thermometer than crystal ball. It also runs above realized volatility on average, because option sellers charge a risk premium. Extreme highs often mark peak fear near bottoms, not the beginning of fresh crashes.',
		),
		array(
			'slug'          => 'short-squeeze-vs-gamma-squeeze',
			'title'         => 'How do I tell a short squeeze from a gamma squeeze?',
			'ticker'        => 'GME',
			'question_body' => 'People throw around "short squeeze" and "gamma squeeze" like they\'re the same thing whenever a heavily shorted name rockets. I get that both send the price flying, but I don\'t actually understand what\'s mechanically different under the hood. What\'s the real distinction, and why should I care which one is driving a move?',
			'answer_body'   => 'Both are self-reinforcing buying loops, but they originate in different markets and run on different fuel.

A short squeeze lives in the stock itself. Short sellers have borrowed shares and sold them, so a rising price creates mounting losses and margin calls. To cap the damage they buy shares back to close positions, and that buy-to-cover demand pushes the price higher, pressuring the remaining shorts into covering too. The loop\'s fuel is short interest; it is largest when short interest and days-to-cover (short interest divided by average daily volume) are high and borrow is expensive.

A gamma squeeze lives in the options market. When traders buy heavy call volume, the dealers who sold those calls are short them and hedge by buying the underlying. As the stock rises, each call\'s delta grows, and the rate of that growth is gamma, forcing dealers to buy still more shares to stay hedged, which lifts the price again. This is sharpest near strikes just above spot and close to expiration.

They compound: dealer hedging can lift price enough to trigger covering, and covering can lift price enough to force more hedging.

The distinction matters because the fuel exhausts differently. Short-covering pressure vanishes once shorts are out, so watch short interest and borrow rates. Gamma pressure is tied to positioning and the calendar, and can reverse violently as options expire, roll, or fall out-of-the-money and dealers sell the hedges they no longer need.',
		),
		array(
			'slug'          => 'market-wide-circuit-breaker-vs-stock-halt',
			'title'         => 'What\'s the difference between a market-wide circuit breaker and a single-stock halt?',
			'ticker'        => 'SPY',
			'question_body' => 'During a fast sell-off I keep hearing people say the market might "hit a circuit breaker," but I\'ve also watched individual stocks I own get paused on their own during big moves. Are those the same mechanism? I want to understand what actually triggers a market-wide halt versus a single name getting frozen, and how long each one keeps me from trading.',
			'answer_body'   => 'Market-wide circuit breakers and single-stock LULD pauses solve different problems. Market-wide circuit breakers halt every security on U.S. exchanges at once, and they key off one number: the percentage decline in the S&P 500 Index from the prior trading day\'s closing value. There are three thresholds. A Level 1 halt triggers at a 7 percent decline, Level 2 at 13 percent, and Level 3 at 20 percent. Level 1 and Level 2 each pause the whole market for 15 minutes, but only if the drop happens before 3:25 p.m. Eastern; after that cutoff, trading continues to the close. Each of those two levels can fire only once per day. A Level 3 breach halts trading for the remainder of the session, whenever it occurs.

Limit Up-Limit Down works on one stock at a time. Each security has price bands set a percentage above and below a rolling reference price, roughly its recent five-minute average. Band width depends on the stock\'s tier and price, and it widens during the opening and closing periods. When the best quote reaches a band, the stock enters a limit state in which trades cannot print through it; if price does not move back inside within 15 seconds, a five-minute trading pause follows. In a sell-off the lower band binds; in a spike, the upper one.

So the differences are scope (the whole market versus one name), trigger (a broad index decline versus a single stock\'s own price band), and duration (15 minutes or the day versus five minutes).',
		),
	);
}
