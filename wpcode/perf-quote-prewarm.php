/**
 * SML Performance — cache pre-warming cron.
 *
 * Measured live, 2026-08-22: sml/v1/quote (and market-position, ticker-alerts)
 * cost ~1.8-2.9s on a cache MISS vs ~0.1s on a HIT at the same edge node
 * (server-timing confirms: cache;desc=MISS;dur=1899.0 -> dur=2.0; the response
 * also carries x-nananana: Batcache-Set, confirming Batcache — a whole-
 * response cache keyed by the OUTER request URL — is the layer doing this).
 * That's why this warms via a real outbound wp_remote_get() to the site's own
 * public URL, not an internal rest_do_request(): Batcache only sees requests
 * that come through the actual front door. An in-process internal dispatch
 * would run the REST callback fine but never touch Batcache at all, since it
 * isn't a new HTTP request — for pre-warming specifically, only a real
 * request does the job. (2026-08-22: the seo-*.php snippets ALSO moved to
 * front-door fetching, for a second reason — internal dispatch was verified
 * live to fail for the sml/v1 endpoints in contexts where front-door HTTP
 * works. Do not reintroduce rest_do_request for those endpoints.)
 *
 * HONEST LIMITATION: cache warmth appeared to differ by edge datacenter in
 * testing (two consecutive requests for the same symbol landed on different
 * a8c-cdn nodes — yyz then mdw — and the second was cold again). This cron
 * runs from wherever WordPress executes it and can only warm whichever
 * node(s) it reaches — it reduces how often a real visitor hits a true cold
 * path, it does not guarantee every edge node stays warm. The durable fix is
 * a hosting-tier/caching-strategy conversation (see the handoff doc).
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet, then once (only once, to clear the
 * scheduled event) run wp_clear_scheduled_hook('sml_perf_prewarm_tick') from
 * anywhere authenticated — otherwise WordPress keeps trying to fire an event
 * whose callback no longer exists, which is harmless (it just no-ops) but
 * unnecessary. Not required for a normal rollback; nothing here is
 * destructive either way.
 */
if ( ! function_exists( 'sml_perf_prewarm_tickers' ) ) {

	/** Trimmed 2026-08-22 from 40+ tickers to the 12 highest-traffic ones.
	 *  Measured live: the site's quotes were returning provider_rate_limited —
	 *  Massive (the anonymous-session fallback provider) was throttling, and
	 *  keeping N symbols warm on a 5-min cache inherently costs ~N/5 upstream
	 *  calls per minute. 40 tickers ≈ 8/min from this cron alone; 12 ≈ 2.4/min,
	 *  leaving budget for the SEO scoring sweep and real users. Re-expand ONLY
	 *  after confirming the Massive plan's actual rate limit. */
	function sml_perf_prewarm_tickers() {
		return array(
			'SPY', 'QQQ',
			'NVDA', 'AAPL', 'MSFT', 'TSLA', 'AMD', 'META', 'AMZN', 'GOOGL',
			'PLTR', 'COIN',
		);
	}

	add_filter( 'cron_schedules', static function ( $s ) {
		if ( ! isset( $s['sml_4min'] ) ) { $s['sml_4min'] = array( 'interval' => 4 * MINUTE_IN_SECONDS, 'display' => 'Every 4 minutes (SML cache pre-warm)' ); }
		return $s;
	} );

	function sml_perf_prewarm_run() {
		$tickers = sml_perf_prewarm_tickers();
		// non-blocking: fire every request through the front door, don't wait on
		// any of them — pre-warming only needs the request to LAND, not its result.
		//
		// quote ONLY, deliberately, not also market-position/ticker-alerts:
		// 40 tickers x 3 endpoints x every 4 minutes = 120 synthetic requests/4min
		// hitting the SAME upstream market-data provider (moomoo/massive) real user
		// traffic also depends on — with no visibility into that provider's rate
		// limits, adding that much load without checking first is the wrong
		// tradeoff. quote is both the endpoint measured as highest-traffic and the
		// one every ticker page depends on immediately. Once this is confirmed
		// live and safe, extending the $endpoints array below is a one-line change.
		$endpoints = array( '/wp-json/sml/v1/quote?symbol=' );
		$args = array( 'timeout' => 1, 'blocking' => false, 'sslverify' => true );
		foreach ( $tickers as $sym ) {
			foreach ( $endpoints as $ep ) {
				wp_remote_get( home_url( $ep . rawurlencode( $sym ) ), $args );
			}
		}

		// Page-HTML warming (the useful part of what "cache preloader" plugins
		// do, without installing one — redundant/conflicting on WordPress.com
		// Atomic where Batcache is built in). A handful of high-traffic,
		// anonymous-cacheable STATIC URLs only; per-user/per-group pages can't
		// be enumerated cheaply and are skipped on purpose. Each URL is hit
		// TWICE per tick because Batcache's default policy only caches a page
		// it has seen more than once within its window — a single lonely
		// request would never populate it.
		$pages = array( '/', '/markets/', '/stock-chart/', '/groups/' );
		foreach ( $pages as $p ) {
			wp_remote_get( home_url( $p ), $args );
			wp_remote_get( home_url( $p ), $args );
		}

		// Flagship profile page + its data endpoints. Measured live 2026-08-22:
		// an anonymous /grandmasterobi/ visit blocks on ~a dozen REST calls at
		// ~2s each cold (profile media was 4.5s) — these are same-origin only,
		// no upstream market-data provider cost, so warming them is free of the
		// rate-limit budget. Extend the list per profile when more top profiles
		// deserve it (user id from sml-social-profile/v1/public/{id} on the page).
		$profile_urls = array(
			'/grandmasterobi/',
			'/wp-json/sml-social-profile/v1/public/258456581',
			'/wp-json/sml-profile/v2/profile/258456581/media',
			'/wp-json/sml-profile/v2/profile/258456581/customization',
		);
		foreach ( $profile_urls as $p ) {
			wp_remote_get( home_url( $p ), $args );
			wp_remote_get( home_url( $p ), $args ); // 2 hits: Batcache caches pages only after repeat visits in-window
		}
	}
	add_action( 'sml_perf_prewarm_tick', 'sml_perf_prewarm_run' );

	add_action( 'init', static function () {
		if ( ! wp_next_scheduled( 'sml_perf_prewarm_tick' ) ) {
			wp_schedule_event( time() + 60, 'sml_4min', 'sml_perf_prewarm_tick' );
		}
	} );
}
