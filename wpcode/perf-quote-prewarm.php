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
 * (the technique every other seo-*.php snippet correctly uses to READ data
 * cheaply) would run the REST callback fine but never touch Batcache at all,
 * since it isn't a new HTTP request — for pre-warming specifically, only a
 * real request does the job.
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

	/** Same real, liquid, well-known seed used by the stocks sitemap
	 *  (wpcode/seo-sitemaps.php) — kept as its own local copy here so this
	 *  snippet has no load-order dependency on that one. */
	function sml_perf_prewarm_tickers() {
		return array(
			'SPY', 'QQQ', 'DIA', 'IWM', 'SMH',
			'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'AMD',
			'NFLX', 'ADBE', 'CRM', 'ORCL', 'CSCO', 'INTC', 'QCOM',
			'PLTR', 'SOFI', 'COIN', 'RBLX', 'UBER', 'ABNB', 'SHOP',
			'JPM', 'BAC', 'V', 'MA',
			'JNJ', 'UNH', 'LLY',
			'XOM', 'CVX',
			'WMT', 'COST', 'HD', 'NKE', 'DIS',
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
	}
	add_action( 'sml_perf_prewarm_tick', 'sml_perf_prewarm_run' );

	add_action( 'init', static function () {
		if ( ! wp_next_scheduled( 'sml_perf_prewarm_tick' ) ) {
			wp_schedule_event( time() + 60, 'sml_4min', 'sml_perf_prewarm_tick' );
		}
	} );
}
