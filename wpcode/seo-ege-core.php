/**
 * SML Index Eligibility Engine (EGE) — core scoring, shared by every SEO route
 * this architecture adds. Ships FIRST; every other seo-*.php snippet depends
 * on it and fails closed (never indexes, never publishes) if it isn't loaded.
 *
 * v2, 2026-08-22 — two live-verified fixes over v1:
 *
 *  1. FETCHES THROUGH THE FRONT DOOR, not rest_do_request(). Verified live:
 *     internal in-process dispatch fails for these endpoints in contexts where
 *     the exact same routes answer fine over real HTTP — the stocks sitemap
 *     generation logged ALL 67 seed tickers as unavailable via internal
 *     dispatch while front-door curl for the same symbols returned real data;
 *     a fresh /stocks/ko/ render scored 39 because company2/market-position
 *     failed internally while both returned full data front-door. Front-door
 *     is also what crawlers and users actually see — the engine now judges
 *     the same reality Google does — and it rides the app-level cache
 *     (x-sml-cache) plus the prewarm cron's warmed entries.
 *
 *  2. "CONFIRMED NONEXISTENT" NEEDS company2, not the quote. The quote
 *     endpoint returns the IDENTICAL 200 body for "this symbol doesn't
 *     exist" and "the upstream provider is down right now" (verified live:
 *     garbage symbol ZZZZ and real SPY both returned source:"none" +
 *     error.code:"provider_unavailable" during the same outage window). v1
 *     would have banned SPY as confirmed-nonexistent during any provider
 *     outage. company2 is the tiebreaker: reference data, with a distinct
 *     "no results" upstream error only for genuinely unknown symbols (KO ->
 *     200 full profile; ZZZZ -> 500 {"code":"upstream","message":"no results"}).
 *
 * Endpoints used (all confirmed real and publicly readable, live):
 *   sml/v1/quote           — price/volume/freshness. NOT a validity oracle on
 *                             its own (see fix 2 above).
 *   sml/v1/company2        — real company profile AND the existence oracle.
 *                             NOTE: sml/v1/company (no "2") returns
 *                             {"error":"Invalid API key"} for every request —
 *                             a pre-existing, unrelated bug in that endpoint's
 *                             own upstream key config. Not touched here.
 *   sml/v1/market-position — StockMarketLoop's own proprietary metric
 *                             (profitRatio/support/resistance).
 *   sml/v1/ticker-alerts   — real per-symbol alert count (activity proxy).
 * options-chain and earnings/calendar are NOT wired in: both are behind real,
 * server-enforced access restrictions (403/401 anonymous) on this site's own
 * data plan — not something a snippet can or should route around.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere. Load this snippet
 * ABOVE (earlier in the WPCode list than) every other seo-*.php snippet.
 * ROLLBACK: deactivate this snippet — every consumer fails closed to noindex.
 */
if ( ! function_exists( 'sml_ege_front_fetch_many' ) ) {

	/**
	 * Fetch several of this site's OWN public REST endpoints through the real
	 * front door, in parallel where the WP-bundled Requests library allows it
	 * (WP >= 6.2), sequentially otherwise. Server-to-self requests carry no
	 * cookies, so they hit the same anonymous cached variant crawlers get —
	 * intended, and the same pattern perf-quote-prewarm.php already uses.
	 *
	 * Returns: key => array( 'status' => int (0 = transport error), 'data' => array|null )
	 */
	function sml_ege_front_fetch_many( $paths ) {
		$out = array();
		foreach ( $paths as $k => $p ) { $out[ $k ] = array( 'status' => 0, 'data' => null ); }

		if ( class_exists( '\WpOrg\Requests\Requests' ) ) {
			$reqs = array();
			foreach ( $paths as $k => $p ) {
				$reqs[ $k ] = array( 'url' => home_url( $p ), 'type' => 'GET', 'headers' => array( 'Accept' => 'application/json' ) );
			}
			try {
				// short timeouts on purpose: this only ever runs from the cron
				// sweep (render paths are read-only, see sml_ege_cached_score),
				// and a slow provider must not push a tick past exec limits
				$responses = \WpOrg\Requests\Requests::request_multiple( $reqs, array( 'timeout' => 3, 'connect_timeout' => 2 ) );
			} catch ( \Exception $e ) {
				$responses = array();
			}
			foreach ( $responses as $k => $r ) {
				// per-request transport failures come back as Exception objects
				// in the results array — those keep their status-0 default
				if ( is_object( $r ) && isset( $r->status_code ) ) {
					$body = json_decode( (string) $r->body, true );
					$out[ $k ] = array( 'status' => (int) $r->status_code, 'data' => is_array( $body ) ? $body : null );
				}
			}
			return $out;
		}

		foreach ( $paths as $k => $p ) {
			$res = wp_remote_get( home_url( $p ), array( 'timeout' => 3, 'sslverify' => true, 'headers' => array( 'Accept' => 'application/json' ) ) );
			if ( is_wp_error( $res ) ) { continue; }
			$body = json_decode( wp_remote_retrieve_body( $res ), true );
			$out[ $k ] = array( 'status' => (int) wp_remote_retrieve_response_code( $res ), 'data' => is_array( $body ) ? $body : null );
		}
		return $out;
	}

	/**
	 * READ-ONLY score accessor for render paths (robots/JSON-LD/summary/canonical
	 * filters). Never fetches: a page render that fetched would turn every
	 * crawler-controllable ?symbol= URL into a 4-request self-HTTP amplifier
	 * against this site's own worker pool and the upstream data provider.
	 * Returns the cached score array, or null when nothing is cached — callers
	 * fail closed (no index signal, no schema, no summary). The sitemap cron
	 * sweep is what keeps this cache warm for the covered symbols.
	 */
	function sml_ege_cached_score( $symbol ) {
		$symbol = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $symbol ) );
		if ( '' === $symbol || strlen( $symbol ) > 12 ) { return null; }
		$c = get_transient( 'sml_ege_' . $symbol );
		return is_array( $c ) ? $c : null;
	}

	/**
	 * Score a ticker 0-100 across 8 factors, weighted to what THIS site can
	 * actually measure today (see file header). Cached 10 minutes per symbol.
	 * $force=true skips the cache read (used by the sitemap's background
	 * scoring cron so its sweeps always re-measure); the fresh result is still
	 * written back to the cache either way, so page renders right after a
	 * sweep are instant.
	 *
	 * Returns: array(
	 *   'valid'   => bool,   // false => no real market data this check; see confirmed_invalid for WHY
	 *   'confirmed_invalid' => bool (only when !valid), // true => company2 positively said "no results" (symbol does not exist); false => data was just unavailable this check — retry soon, don't punish
	 *   'score'   => int 0-100,
	 *   'verdict' => 'index'|'selective'|'noindex',
	 *   'factors' => array( 8 named sub-scores ),
	 *   'quote', 'company', 'position'   // raw fetched data, reused by callers
	 * )
	 */
	function sml_ege_score_ticker( $symbol, $force = false ) {
		$symbol = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $symbol ) );
		// length cap: real tickers are <= ~10 chars; an unbounded symbol would
		// also overflow transient key limits and silently lose negative caching
		if ( '' === $symbol || strlen( $symbol ) > 12 ) { return array( 'valid' => false, 'confirmed_invalid' => false, 'score' => 0, 'verdict' => 'noindex', 'factors' => array() ); }

		$cache_key = 'sml_ege_' . $symbol;
		if ( ! $force ) {
			$cached = get_transient( $cache_key );
			if ( is_array( $cached ) ) { return $cached; }
		}

		$fetched = sml_ege_front_fetch_many( array(
			'quote'    => '/wp-json/sml/v1/quote?symbol=' . rawurlencode( $symbol ),
			'company'  => '/wp-json/sml/v1/company2?symbol=' . rawurlencode( $symbol ),
			'position' => '/wp-json/sml/v1/market-position?symbol=' . rawurlencode( $symbol ),
			'alerts'   => '/wp-json/sml/v1/ticker-alerts?symbol=' . rawurlencode( $symbol ),
		) );
		$quote    = ( 200 === $fetched['quote']['status'] )    ? $fetched['quote']['data']    : null;
		$company  = ( 200 === $fetched['company']['status'] )  ? $fetched['company']['data']  : null;
		$position = ( 200 === $fetched['position']['status'] ) ? $fetched['position']['data'] : null;
		$alerts   = ( 200 === $fetched['alerts']['status'] )   ? $fetched['alerts']['data']   : null;

		$valid = is_array( $quote ) && isset( $quote['current'] ) && null !== $quote['current']
			&& isset( $quote['source'] ) && 'none' !== $quote['source'];

		if ( ! $valid ) {
			// Confirmed nonexistence requires POSITIVE evidence from company2
			// ("no results" for this symbol) AND no company record — the quote's
			// no-data body alone is ambiguous between "fake symbol" and
			// "provider outage" (see file header). A company2 record for the
			// symbol means it's real regardless of what the quote said, so a
			// real ticker in an outage window is never confirmed-banned; it's
			// cached only briefly and retried.
			$quote_answered     = is_array( $quote );
			$company_has_rec    = is_array( $company ) && ! empty( $company['name'] );
			$company_no_results = ( $fetched['company']['status'] >= 400 )
				&& is_array( $fetched['company']['data'] )
				&& isset( $fetched['company']['data']['message'] )
				&& false !== stripos( (string) $fetched['company']['data']['message'], 'no result' );
			// second independent confirmation path (merged from the live v1.1
			// hardening): a CLEAN no-data quote body — source:"none" with no
			// upstream error and not quality:"unavailable". An outage body always
			// carries error.code:"provider_unavailable" + quality:"unavailable"
			// (verified live on SPY during a real outage window), so a clean
			// "none" is the endpoint genuinely saying the symbol has nothing.
			$quote_clean_none = $quote_answered
				&& isset( $quote['source'] ) && 'none' === $quote['source']
				&& ( ! isset( $quote['quality'] ) || 'unavailable' !== $quote['quality'] )
				&& empty( $quote['error'] );
			// either positive-evidence path confirms — but NEVER while company2
			// holds a real record for the symbol (a real ticker is never banned)
			$confirmed = ! $company_has_rec
				&& ( ( $quote_answered && $company_no_results ) || $quote_clean_none );

			$out = array(
				'valid' => false, 'confirmed_invalid' => $confirmed, 'score' => 0, 'verdict' => 'noindex',
				'factors' => array(), 'quote' => $quote, 'company' => $company, 'position' => $position,
			);
			set_transient( $cache_key, $out, $confirmed ? 10 * MINUTE_IN_SECONDS : 60 );
			return $out;
		}

		$f = array();

		// dataCompleteness (20): real quote (10) + real company name (5) + real market-position (5)
		$f['dataCompleteness'] = 10
			+ ( is_array( $company ) && ! empty( $company['name'] ) ? 5 : 0 )
			+ ( is_array( $position ) && isset( $position['profitRatio'] ) ? 5 : 0 );

		// uniqueInformation (17): the site's OWN proprietary metric, not a generic price wrapper
		$f['uniqueInformation'] = ( is_array( $position ) && isset( $position['profitRatio'] ) ) ? 17 : 0;

		// freshness (15): age of quote.timestamp (epoch ms). Anonymous sessions get
		// the delayed fallback (stale=true even when recent) — age is the honest
		// signal, not the ambiguous stale flag. Weekends make every ticker's last
		// trade > 4h old; the verdict bands tolerate that (index AND selective
		// both reach the sitemap), so no special-casing of market hours here.
		$age_min = null;
		if ( is_array( $quote ) && ! empty( $quote['timestamp'] ) ) {
			$age_min = max( 0, ( time() - ( (int) $quote['timestamp'] / 1000 ) ) / 60 );
		}
		if ( null === $age_min ) { $f['freshness'] = 3; }
		elseif ( $age_min <= 20 ) { $f['freshness'] = 15; }
		elseif ( $age_min <= 60 ) { $f['freshness'] = 10; }
		elseif ( $age_min <= 240 ) { $f['freshness'] = 5; }
		else { $f['freshness'] = 2; }

		// userActivity (13): real alert count — coarse proxy, documented as such.
		$alert_n = is_array( $alerts ) && isset( $alerts['alerts'] ) && is_array( $alerts['alerts'] ) ? count( $alerts['alerts'] ) : 0;
		$f['userActivity'] = $alert_n >= 5 ? 13 : ( $alert_n >= 1 ? 8 : 3 );

		// searchUsefulness (12): real, currently-traded volume
		$f['searchUsefulness'] = ( isset( $quote['volume'] ) && (int) $quote['volume'] > 0 ) ? 12 : 8;

		// internalLinkSupport (11): flat baseline for any valid ticker today — a real
		// per-page link-graph count needs the hub/sector cross-linking this same
		// architecture adds. Documented simplification.
		$f['internalLinkSupport'] = 11;

		// historicalSignificance (8): market-cap tier from real company data
		$mcap = is_array( $company ) && isset( $company['marketCap'] ) ? (float) $company['marketCap'] : 0;
		if ( $mcap >= 200e9 ) { $f['historicalSignificance'] = 8; }
		elseif ( $mcap >= 10e9 ) { $f['historicalSignificance'] = 6; }
		elseif ( $mcap >= 2e9 ) { $f['historicalSignificance'] = 4; }
		elseif ( $mcap > 0 ) { $f['historicalSignificance'] = 2; }
		else { $f['historicalSignificance'] = 1; }

		// externalCitations (4): not instrumented yet (no GA4/Search Console
		// confirmed live) — always 0 today, present so the rubric sums to 100
		// once real backlink/citation data exists.
		$f['externalCitations'] = 0;

		$score = array_sum( $f );
		$verdict = $score >= 80 ? 'index' : ( $score >= 60 ? 'selective' : 'noindex' );

		// degraded = the quote answered but an aux endpoint FAILED (transport,
		// rate-limit, 5xx) rather than answering. The score above is then
		// artificially depressed, not a real measurement — consumers (the
		// sitemap cron) must not treat it as authoritative for DEMOTING a
		// previously-good ticker. A real 4xx answer ("no data for symbol") is
		// an answer, not degradation.
		$aux_failed = static function ( $st ) { $st = (int) $st; return 0 === $st || 429 === $st || $st >= 500; };
		$degraded   = $aux_failed( $fetched['company']['status'] ) || $aux_failed( $fetched['position']['status'] );

		$out = array(
			'valid' => true, 'confirmed_invalid' => false, 'degraded' => $degraded,
			'score' => $score, 'verdict' => $verdict, 'factors' => $f,
			'quote' => $quote, 'company' => $company, 'position' => $position,
		);
		// 2h TTL, deliberately longer than the cron rotation (~70 min per
		// symbol): render paths are read-only (sml_ege_cached_score) and must
		// nearly always find this cache warm; the sweep refreshes it long
		// before expiry. All timestamps shown downstream are the quote's own,
		// so a rotation-old price still reads honestly as "As of <real time>".
		set_transient( $cache_key, $out, 2 * HOUR_IN_SECONDS );
		return $out;
	}

	/**
	 * Does the /stocks/{ticker}/ page itself exist? Ticker validity does NOT
	 * imply it does (verified live: KO has full real market+company data yet
	 * /stocks/ko/ returns HTTP 404) — so anything that advertises that URL
	 * (canonical rewrites, sitemap entries) must check the page, not just the
	 * data. Front-door status check, cached: exists 12h, missing 1h; a
	 * transport error is NOT cached and returns null — callers treat unknown
	 * as "don't advertise". Side effect worth having: the check is a real
	 * front-door GET, so it also warms Batcache for the page it verifies.
	 */
	function sml_ege_stocks_page_exists( $symbol ) {
		$symbol = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $symbol ) );
		if ( '' === $symbol ) { return false; }
		$key = 'sml_ege_pg_' . $symbol;
		$c   = get_transient( $key );
		if ( 'yes' === $c ) { return true; }
		if ( 'no' === $c ) { return false; }
		$res = wp_remote_get( home_url( '/stocks/' . strtolower( $symbol ) . '/' ), array( 'timeout' => 3, 'sslverify' => true, 'limit_response_size' => 2048, 'redirection' => 0 ) );
		if ( is_wp_error( $res ) ) { return null; }
		$code = (int) wp_remote_retrieve_response_code( $res );
		// only a direct 200 proves the page; only a definitive 404/410 proves
		// its absence. Everything else (3xx, 429, 5xx, Cloudflare hiccups) is
		// UNKNOWN — uncached null, so callers keep last good state instead of
		// evicting a real page off a transient error.
		if ( 200 === $code ) { set_transient( $key, 'yes', 12 * HOUR_IN_SECONDS ); return true; }
		if ( 404 === $code || 410 === $code ) { set_transient( $key, 'no', HOUR_IN_SECONDS ); return false; }
		return null;
	}

	/** Convenience: does this ticker clear the sitemap-inclusion bar (index or selective)? */
	function sml_ege_ticker_sitemap_eligible( $symbol ) {
		$s = sml_ege_score_ticker( $symbol );
		return $s['valid'] && in_array( $s['verdict'], array( 'index', 'selective' ), true );
	}
}
