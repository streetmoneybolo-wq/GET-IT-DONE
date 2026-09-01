/* ===========================================================================
 * SML Auth Portal reskin  —  js/auth-portal.js
 * Loaded on /register/ (staged behind ?authv2=1) by wpcode/auth-portal-loader.php.
 *
 * PURE FRONT-END RESKIN. It does NOT touch authentication: the hardened
 * sml-members/v1 flow (register / login / verify / handle-availability / oauth)
 * and its own inline auth JS + the anti-bot /__challenge handshake keep running
 * exactly as before. This script only:
 *   1. paints the new marketing landing (design markup, verbatim copy),
 *   2. RELOCATES the existing, live .sml-auth-card (the real form — with the
 *      required handle field, the email-verify step, and Google/Facebook) out of
 *      its modal and into the hero, so the same hardened form shows inline,
 *   3. hides the old guest landing + the now-empty modal shell,
 *   4. wires the NEW landing-only widgets (persona tabs, scroll-to-form).
 *
 * If there is no .sml-auth-card (e.g. already signed in), it does nothing and
 * leaves the original page as-is. Idempotent. Kill switch = deactivate the
 * loader snippet, or drop ?authv2=1.
 * ======================================================================== */
(function () {
  "use strict";
  if (window.__smlAuthPortalV2) { return; }
  window.__smlAuthPortalV2 = 1;

  var LANDING = `<main class="sml-auth" id="sml-auth-portal">
		<div class="sml-auth-tape" aria-label="Stock Market Loop features">
			<div><span>LIVE MARKETS</span><span>TRADINGFLOOR</span><span>GROUPS</span><span>MARKET Q&amp;A</span><span>LOOP LETTERS</span><span>LIVE VIDEO</span><span>CREATOR REVENUE</span><span>LOOP BUCKS</span></div>
		</div>
		<section class="sml-auth-hero">
			<div class="sml-auth-story">
				<p class="sml-auth-eyebrow"><i></i> THE FINANCIAL SOCIAL NETWORK</p>
				<h1>The stock market community that <em>rewards participation.</em></h1>
				<p class="sml-auth-lede">Connect with traders. Build an audience. Publish market content. Grow a community—all through one account built for the market.</p>
				<div class="sml-auth-proof" aria-label="Platform highlights">
					<span>Real-time market conversations</span><span>Creator-owned communities</span><span>Searchable market knowledge</span>
				</div>
				<!--LITE_VISUAL-->
			</div>

			<!--CARD_SLOT-->
		</section>

		<section class="sml-auth-one-account">
			<p class="sml-auth-eyebrow">ONE ACCOUNT. EVERY PART OF YOUR MARKET JOURNEY.</p>
			<h2>Choose what you want to build.</h2>
			<div class="sml-auth-personas" role="tablist" aria-label="Reasons to join">
									<button type="button" role="tab" aria-selected="true" data-persona="trader">Traders &amp; investors</button>
									<button type="button" role="tab" aria-selected="false" data-persona="community">Community owners</button>
									<button type="button" role="tab" aria-selected="false" data-persona="creator">Market creators</button>
									<button type="button" role="tab" aria-selected="false" data-persona="journalist">Newsletters &amp; journalists</button>
									<button type="button" role="tab" aria-selected="false" data-persona="qa">Market Q&amp;A contributors</button>
							</div>
							<article class="sml-auth-persona-copy" data-persona-panel="trader" >
					<h3>Traders &amp; investors</h3><p>Follow tickers, discuss price action, build watchlists, and keep charts, news, filings, alerts, and market conversations together.</p><button type="button" data-scroll-register>Create your account →</button>
				</article>
							<article class="sml-auth-persona-copy" data-persona-panel="community" hidden>
					<h3>Community owners</h3><p>Create branded groups, channels, roles, memberships, live sessions, and connected Discord or Telegram distribution.</p><button type="button" data-scroll-register>Create your account →</button>
				</article>
							<article class="sml-auth-persona-copy" data-persona-panel="creator" hidden>
					<h3>Market creators</h3><p>Publish analysis, stream live, upload replays, build followers, offer memberships, and organize every part of your creator brand.</p><button type="button" data-scroll-register>Create your account →</button>
				</article>
							<article class="sml-auth-persona-copy" data-persona-panel="journalist" hidden>
					<h3>Newsletters &amp; journalists</h3><p>Launch a Loop Letter, publish searchable reporting, connect coverage to tickers, and grow subscribers inside the market conversation.</p><button type="button" data-scroll-register>Create your account →</button>
				</article>
							<article class="sml-auth-persona-copy" data-persona-panel="qa" hidden>
					<h3>Market Q&amp;A contributors</h3><p>Ask durable finance questions, share useful answers, build subject authority, and continue discussions through groups and live content.</p><button type="button" data-scroll-register>Create your account →</button>
				</article>
					</section>

		<section class="sml-auth-capabilities">
			<header><p class="sml-auth-eyebrow">WHY STOCK MARKET LOOP</p><h2>Stop splitting your market life across disconnected platforms.</h2></header>
			<div class="sml-auth-feature-grid">
				<article class="sml-auth-feature"><span aria-hidden="true">⌁</span><div><h3>Ticker-first conversations</h3><p>Follow stocks and market events instead of sorting through unrelated social noise.</p></div></article><article class="sml-auth-feature"><span aria-hidden="true">⌁</span><div><h3>TradingFloor</h3><p>Bring interactive charts, market data, alerts, news, and trader discussion onto one ticker destination.</p></div></article><article class="sml-auth-feature"><span aria-hidden="true">◎</span><div><h3>Groups you can own</h3><p>Build branded public or private communities with channels, roles, permissions, and memberships.</p></div></article><article class="sml-auth-feature"><span aria-hidden="true">◉</span><div><h3>Live and replayable video</h3><p>Schedule live broadcasts, talk with viewers, upload videos, and keep permanent replay pages.</p></div></article><article class="sml-auth-feature"><span aria-hidden="true">✎</span><div><h3>Loop Letters</h3><p>Publish a branded newsletter where readers already follow and discuss the market.</p></div></article><article class="sml-auth-feature"><span aria-hidden="true">?</span><div><h3>Durable market Q&amp;A</h3><p>Build searchable financial knowledge and subject authority beyond a disappearing chat timeline.</p></div></article><article class="sml-auth-feature"><span aria-hidden="true">↗</span><div><h3>Cross-platform distribution</h3><p>Connect eligible Stock Market Loop activity with Discord and Telegram workflows.</p></div></article><article class="sml-auth-feature"><span aria-hidden="true">◇</span><div><h3>Creator identity</h3><p>Unify articles, newsletters, videos, groups, alerts, followers, and live sessions on one profile.</p></div></article><article class="sml-auth-feature"><span aria-hidden="true">★</span><div><h3>Creator opportunities</h3><p>Eligible creators and community owners can participate in supported subscription, reward, and advertising programs.</p></div></article><article class="sml-auth-feature"><span aria-hidden="true">∞</span><div><h3>Permanent content URLs</h3><p>Give market reporting, videos, questions, and streams shareable destinations that can remain discoverable.</p></div></article>			</div>
		</section>

		<section class="sml-auth-audiences">
			<header><p class="sml-auth-eyebrow">BUILT FOR EVERY SIDE OF THE MARKET CONVERSATION</p><h2>See exactly what your account can unlock.</h2><p>Explore the path that fits you now. Your account can grow into every other path later.</p></header>
			<div class="sml-auth-audience-grid">
				<details open><summary><span>01</span><strong>Traders &amp; investors</strong><i>+</i></summary><ul>
					<li>Follow the tickers and market topics you care about.</li><li>Discuss price action beside relevant market data.</li><li>Find unusual activity, breaking developments, filings, and community insight.</li><li>Join public or private trading communities.</li><li>Build watchlists and discover ticker-specific conversations.</li><li>Ask questions and learn from experienced market participants.</li><li>Follow creators without losing alerts inside a general-purpose feed.</li><li>Reach live streams, replays, articles, and newsletters from one account.</li>
				</ul></details>
				<details><summary><span>02</span><strong>Trading-community owners</strong><i>+</i></summary><ul>
					<li>Create branded groups with dedicated channels.</li><li>Offer free or paid membership access.</li><li>Manage roles, permissions, and private conversations.</li><li>Connect eligible Discord and Telegram community workflows.</li><li>Route supported alerts between your group and connected platforms.</li><li>Schedule live sessions and maintain permanent replay pages.</li><li>Publish announcements, alerts, education, and community updates.</li><li>Build a discoverable presence beyond a closed chat server.</li><li>Participate in supported subscriptions, gifts, content, and eligible advertising programs.</li><li>Keep your brand, content, followers, and monetization connected.</li>
				</ul></details>
				<details><summary><span>03</span><strong>Market creators &amp; influencers</strong><i>+</i></summary><ul>
					<li>Publish market updates, ticker analysis, education, and breaking-news commentary.</li><li>Host live shows and preserve broadcasts for later viewing.</li><li>Upload videos with unique, shareable URLs.</li><li>Build followers through a unified creator profile.</li><li>Promote groups, newsletters, videos, and streams from one destination.</li><li>Engage through comments, reactions, shares, Q&amp;A, and discussions.</li><li>Create paid memberships and subscriber-only experiences where supported.</li><li>Earn Loop Bucks and participate in eligible creator-revenue programs.</li><li>Reach people searching for specific stocks beyond an algorithmic feed.</li>
				</ul></details>
				<details><summary><span>04</span><strong>Newsletter writers &amp; journalists</strong><i>+</i></summary><ul>
					<li>Launch a branded Loop Letter publication.</li><li>Customize your publication identity, imagery, and typography.</li><li>Publish SEO-ready articles with titles, subtitles, metadata, and permanent URLs.</li><li>Connect stories to relevant tickers, charts, filings, and related coverage.</li><li>Grow subscribers from an audience already following the market.</li><li>Turn reporting into live discussions and Q&amp;A.</li><li>Distribute supported content through connected social channels.</li><li>Build a searchable reporting archive.</li><li>Establish clear attribution through a dedicated author profile.</li><li>Monetize without separating the publication from its community.</li>
				</ul></details>
				<details><summary><span>05</span><strong>Market Q&amp;A contributors</strong><i>+</i></summary><ul>
					<li>Ask about stocks, options, terminology, market mechanics, and investing.</li><li>Give detailed answers and build subject authority.</li><li>Follow questions and topics that match your experience.</li><li>Connect explanations to ticker pages and current market information.</li><li>Build a searchable public profile around your expertise.</li><li>Continue discussions through groups, articles, newsletters, and live broadcasts.</li><li>Earn recognition and available platform rewards for useful participation.</li><li>Keep finance questions from being buried among unrelated topics.</li>
				</ul></details>
			</div>
		</section>

		<section class="sml-auth-final">
			<div><p class="sml-auth-eyebrow">THE MARKET NEVER STOPS. NEITHER SHOULD YOUR NETWORK.</p><h2>Trade. Teach. Publish. Stream. Build.</h2><p>Connect what you know with the people looking for it.</p></div>
			<button class="sml-auth-primary" type="button" data-scroll-register>Create your free account <span>→</span></button>
		</section>
	</main>`;

  function ready(fn) {
    if (document.readyState !== "loading") { fn(); }
    else { document.addEventListener("DOMContentLoaded", fn); }
  }

  function boot() {
    if (document.getElementById("sml-auth-portal")) { return; }   // already reskinned
    var card = document.querySelector(".sml-auth-card");
    if (!card) { return; }                                         // no live form (logged in / not rendered) -> leave page untouched

    // Build the landing. Drop the decorative visual (was a 166KB PNG); put a real
    // slot where the LIVE card will live.
    var html = LANDING
      .replace("<!--LITE_VISUAL-->", "")
      .replace("<!--CARD_SLOT-->", '<aside class="sml-auth-cardslot" aria-label="Stock Market Loop account access"></aside>');

    var holder = document.createElement("div");
    holder.innerHTML = html;
    var portal = holder.querySelector("#sml-auth-portal");
    if (!portal) { return; }

    // Move the real card into the hero slot (event listeners travel with the nodes).
    var slot = portal.querySelector(".sml-auth-cardslot");
    slot.appendChild(card);
    // Force it visible/interactive inline (it was styled as a closed modal child).
    card.removeAttribute("aria-hidden");
    card.style.removeProperty("display");
    card.style.opacity = "1";
    card.style.transform = "none";
    card.style.pointerEvents = "auto";

    // Insert the new landing and hide the old surfaces.
    var oldLanding = document.getElementById("sml-guest-landing");
    var modal = document.querySelector("[data-sml-auth-modal]");
    var anchor = oldLanding || modal || document.body.firstChild;
    anchor.parentNode.insertBefore(portal, anchor);
    if (oldLanding) { oldLanding.style.display = "none"; }
    if (modal) { modal.style.display = "none"; }          // shell is now empty (card moved out)

    wire(portal);
  }

  function wire(root) {
    // Persona tablist (new landing widget).
    var pBtns = Array.prototype.slice.call(root.querySelectorAll("[data-persona]"));
    var pPanels = Array.prototype.slice.call(root.querySelectorAll("[data-persona-panel]"));
    pBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-persona");
        pBtns.forEach(function (x) { x.setAttribute("aria-selected", x === b ? "true" : "false"); });
        pPanels.forEach(function (p) { p.hidden = (p.getAttribute("data-persona-panel") !== key); });
      });
    });

    // "Create your account" buttons -> focus the real signup form.
    Array.prototype.slice.call(root.querySelectorAll("[data-scroll-register]")).forEach(function (b) {
      b.addEventListener("click", function () {
        var card = root.querySelector(".sml-auth-card");
        if (!card) { return; }
        var signupTab = card.querySelector('[data-auth-tab="signup"]');
        if (signupTab) { signupTab.click(); }               // hardened JS switches to signup
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        var first = card.querySelector('[data-signup-form] input:not([type=hidden])');
        setTimeout(function () { if (first) { try { first.focus(); } catch (e) {} } }, 420);
      });
    });
    // Audience accordion uses native <details> — no JS needed.
  }

  // Small delay so the plugin's own auth JS finishes binding before we move nodes.
  ready(function () { setTimeout(boot, 80); });
})();
