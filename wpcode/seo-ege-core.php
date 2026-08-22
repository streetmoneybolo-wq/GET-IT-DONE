/**
 * SML Index Eligibility Engine (EGE) — core scoring, shared by every SEO route
 * this architecture adds. Ships FIRST; every other seo-*.php snippet depends
 * on it and fails closed (never indexes, never publishes) if it isn't loaded.
 *
 * Scoring is deliberately built ONLY from data confirmed real and publicly
 * readable today (verified live, 2026-08-22):
 *   sml/v1/quote           — validity oracle: source==="none" + current===null
 *                             means the symbol has no real market data at all.
 *   sml/v1/company2        — real company profile (name, market cap, etc.)
 *                             NOTE: sml/v1/company (no "2") returns
 *                             {"error":"Invalid API key"} for every request —
 *                             a pre-existing, unrelated bug in that endpoint's
 *                             own upstream key config. Not touched here; company2
 *                             is the working endpoint and is what this uses.
 *   sml/v1/market-position — StockMarketLoop's own proprietary metric
 *                             (profitRatio/support/resistance), real named
 *                             fields, not something this recomputes itself.
 *   sml/v1/ticker-alerts   — real per-symbol alert count, used as a coarse
 *                             user-activity proxy.
 * options-chain and earnings/calendar are NOT wired into this engine: the
 * options endpoint returned 403 "the market-data plan does not authorize this
 * dataset" and earnings/calendar returned 401 on every anonymous request
 * during verification — both are real, server-enforced access restrictions on
 * this site's own data plan, not something a WPCode snippet can or should
 * route around. Any SEO surface for those data types waits until they are
 * confirmed to be intentionally public.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere. Load this snippet
 * ABOVE (earlier in the WPCode list than) every other seo-*.php snippet.
 * ROLLBACK: deactivate this snippet — every consumer fails closed to noindex.
 */
if ( ! function_exists( 'sml_ege_internal_get' ) ) {

	function sml_ege_internal_get( $route, $params ) {
		$req = new WP_REST_Request( 'GET', $route );
		foreach ( (array) $params as $k => $v ) { $req->set_param( $k, $v ); }
		$res = rest_do_request( $req );
		if ( is_wp_error( $res ) || $res->get_status() >= 400 ) { return null; }
		return (array) $res->get_data();
	}

	/**
	 * Score a ticker 0-100 across 8 factors, weighted to what THIS site can
	 * actually measure today (see file header). Cached 10 minutes per symbol —
	 * matches the site's own quote-poll cadence and keeps this cheap to call
	 * from a sitemap generator iterating hundreds of symbols.
	 *
	 * Returns: array(
	 *   'valid'   => bool,               // false => the symbol has no real market data; caller must 404/absent, never publish a page
	 *   'score'   => int 0-100,
	 *   'verdict' => 'index'|'selective'|'noindex',
	 *   'factors' => array( 8 named sub-scores, for debugging/tuning ),
	 *   'quote', 'company', 'position'   // raw fetched data, reused by callers so they don't refetch
	 * )
	 */
	function sml_ege_score_ticker( $symbol ) {
		$symbol = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $symbol ) );
		if ( '' === $symbol ) { return array( 'valid' => false, 'score' => 0, 'verdict' => 'noindex', 'factors' => array() ); }

		$cache_key = 'sml_ege_' . $symbol;
		$cached    = get_transient( $cache_key );
		if ( is_array( $cached ) ) { return $cached; }

		$quote    = sml_ege_internal_get( '/sml/v1/quote', array( 'symbol' => $symbol ) );
		$company  = sml_ege_internal_get( '/sml/v1/company2', array( 'symbol' => $symbol ) );
		$position = sml_ege_internal_get( '/sml/v1/market-position', array( 'symbol' => $symbol ) );
		$alerts   = sml_ege_internal_get( '/sml/v1/ticker-alerts', array( 'symbol' => $symbol ) );

		$valid = is_array( $quote ) && isset( $quote['current'] ) && null !== $quote['current']
			&& isset( $quote['source'] ) && 'none' !== $quote['source'];

		if ( ! $valid ) {
			$out = array( 'valid' => false, 'score' => 0, 'verdict' => 'noindex', 'factors' => array(), 'quote' => $quote, 'company' => $company, 'position' => $position );
			set_transient( $cache_key, $out, 10 * MINUTE_IN_SECONDS );
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
		// the delayed "massive-snapshot" fallback (stale=true even when recent) —
		// age is the honest signal, not the ambiguous stale flag.
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
		// Refine once GA4/engagement analytics exists (see the architecture doc's tunables).
		$alert_n = is_array( $alerts ) && isset( $alerts['alerts'] ) && is_array( $alerts['alerts'] ) ? count( $alerts['alerts'] ) : 0;
		$f['userActivity'] = $alert_n >= 5 ? 13 : ( $alert_n >= 1 ? 8 : 3 );

		// searchUsefulness (12): real, currently-traded volume
		$f['searchUsefulness'] = ( isset( $quote['volume'] ) && (int) $quote['volume'] > 0 ) ? 12 : 8;

		// internalLinkSupport (11): flat baseline for any valid ticker today — a real
		// per-page link-graph count needs the hub/sector cross-linking this same
		// architecture adds; until then every valid ticker gets credit for the
		// site nav/watchlist links it already has. Documented simplification.
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
		// once real backlink/citation data exists. See the architecture doc.
		$f['externalCitations'] = 0;

		$score = array_sum( $f );
		$verdict = $score >= 80 ? 'index' : ( $score >= 60 ? 'selective' : 'noindex' );

		$out = array(
			'valid' => true, 'score' => $score, 'verdict' => $verdict, 'factors' => $f,
			'quote' => $quote, 'company' => $company, 'position' => $position,
		);
		set_transient( $cache_key, $out, 10 * MINUTE_IN_SECONDS );
		return $out;
	}

	/** Convenience: does this ticker clear the sitemap-inclusion bar (index or selective)? */
	function sml_ege_ticker_sitemap_eligible( $symbol ) {
		$s = sml_ege_score_ticker( $symbol );
		return $s['valid'] && in_array( $s['verdict'], array( 'index', 'selective' ), true );
	}
}
