<?php
/**
 * SML Q&A - seed content data (Phase 5).
 *
 * Evergreen editorial Q&A: slug, title, ticker (optional), question_body,
 * answer_body. Each entry was drafted and adversarially fact-checked for accuracy
 * (6 corrected, 2 clean, 0 rejected) before inclusion. Consumed by includes/seed.php.
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
	);
}
