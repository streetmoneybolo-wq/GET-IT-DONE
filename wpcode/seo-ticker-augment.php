/**
 * SML SEO — ticker canonical fix + real structured data + AI-readable summary.
 * Part 1 (Day-1 step) + Part 4 + Part 5 of the entity-graph architecture.
 *
 * v2, 2026-08-22: ALL render paths are now READ-ONLY — they consult only the
 * cache/state the sitemap snippet's background sweep maintains, and never
 * fetch inline. (v1 fetched synchronously inside wp_head with a
 * crawler-controllable ?symbol=, which was an unauthenticated self-HTTP
 * amplification vector and blocked renders for seconds.) Consequence, stated
 * honestly: schema/summary/index signals currently appear only on tickers the
 * sweep covers (the seed list in seo-sitemaps.php); everything else fails
 * closed to noindex with no augment. Expanding coverage = extending the
 * sweep's seed, never re-adding render-time fetching. Also v2: 404-page
 * guards (verified live: /stocks/ko/ 404s yet KO's data is valid), and an
 * outage grace on robots mirroring the sitemap's keep-last-good, so a data
 * blip can't bake noindex into Batcache for pages the sitemap still lists.
 *
 * Uses Rank Math's own developer hooks wherever one exists, instead of
 * regex-editing its rendered HTML — safer, and Rank Math is confirmed active
 * (it generates this site's sitemap footer + robots.txt Sitemap lines).
 * Falls back to a raw output-buffer body-open injection ONLY for the one
 * thing that has no hook: new visible page content (the AI-summary block).
 *
 * Depends on wpcode/seo-ege-core.php AND wpcode/seo-sitemaps.php (whose cron
 * sweep feeds the cache this reads) — load this snippet AFTER both. Fails
 * closed (adds nothing, noindex) if either isn't active.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet — both URLs return to their prior,
 * already-live behavior; nothing here is destructive or stateful.
 */
if ( ! function_exists( 'sml_sta_symbol_from_stocks_path' ) ) {

	function sml_sta_symbol_from_stocks_path() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		if ( preg_match( '#^/stocks/([a-zA-Z0-9.\-]{1,12})/?$#', $path, $m ) ) {
			return strtoupper( $m[1] );
		}
		return '';
	}
	function sml_sta_symbol_from_stock_chart() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		if ( '/stock-chart/' !== rtrim( $path, '/' ) . '/' ) { return ''; }
		$s = isset( $_GET['symbol'] ) ? sanitize_text_field( wp_unslash( $_GET['symbol'] ) ) : '';
		$s = strtoupper( preg_replace( '/[^a-zA-Z0-9.\-]/', '', $s ) );
		return strlen( $s ) > 12 ? '' : $s; // real tickers are <= ~10 chars — cap crawler-controllable input
	}

	/** Cron-maintained sitemap state entry for a symbol, or null. Read-only —
	 *  render paths must NEVER fetch (see sml_ege_cached_score in the engine). */
	function sml_sta_state_entry( $symbol ) {
		$state = get_option( 'sml_seo_stocks_state', array() );
		if ( ! is_array( $state ) || ! isset( $state[ $symbol ] ) || ! is_array( $state[ $symbol ] ) ) { return null; }
		$st = $state[ $symbol ];
		// same 26h staleness bound the sitemap render applies — a dead cron
		// must not keep vouching for pages forever
		if ( ! isset( $st['checked'] ) || ( time() - (int) $st['checked'] ) > 26 * HOUR_IN_SECONDS ) { return null; }
		return $st;
	}

	/* ---------- Day-1: /stock-chart/?symbol=X canonicalizes to /stocks/{ticker}/ ----------
	   Uses Rank Math's own canonical filter — no HTML surgery. READ-ONLY: the
	   ?symbol= parameter is crawler/attacker-controllable, so this must never
	   trigger a fetch (a fetching version would be a 4-5x self-HTTP amplifier
	   against this site's own worker pool and the upstream data provider).
	   Rewrites ONLY for symbols the background sweep has already verified as
	   eligible — which also guarantees the /stocks/{x}/ target page exists
	   (the sweep gates eligibility on a real page check; verified live: KO has
	   valid data yet /stocks/ko/ 404s). Everything else keeps self-canonical,
	   exactly today's live behavior. */
	add_filter( 'rank_math/frontend/canonical', function ( $canonical ) {
		$symbol = sml_sta_symbol_from_stock_chart();
		if ( '' === $symbol ) { return $canonical; }
		$st = sml_sta_state_entry( $symbol );
		if ( null === $st || empty( $st['eligible'] ) ) { return $canonical; }
		return home_url( '/stocks/' . strtolower( $symbol ) . '/' );
	} );

	/* ---------- /stocks/{ticker}/: eligibility-driven robots + real JSON-LD ----------
	   READ-ONLY: render paths consult only the cache the background sweep
	   maintains (sml_ege_cached_score) — never fetch inline. A symbol the
	   sweep doesn't cover simply gets no schema/summary and fails closed on
	   robots (unless the sweep's state vouches for it, below). */
	function sml_sta_current_stocks_ticker_score() {
		static $done = false, $score = null;
		if ( $done ) { return $score; }
		$done = true;
		$symbol = sml_sta_symbol_from_stocks_path();
		if ( '' === $symbol || ! function_exists( 'sml_ege_cached_score' ) ) { return null; }
		$score = sml_ege_cached_score( $symbol );
		if ( null === $score ) { return null; }
		$score['symbol'] = $symbol;
		return $score;
	}

	add_filter( 'rank_math/frontend/robots', function ( $robots ) {
		// Fail CLOSED, not open: distinguish "not a /stocks/ page" (leave Rank
		// Math's own default alone) from "IS a /stocks/ page but the scoring
		// engine is unreachable" (force noindex — this is the documented
		// rollback contract from seo-ege-core.php: deactivating that snippet
		// must never make a previously-suppressed thin page indexable again).
		$symbol = sml_sta_symbol_from_stocks_path();
		if ( '' === $symbol ) { return $robots; }
		// a /stocks/{x}/ path whose page doesn't actually exist (real 404 —
		// verified live: /stocks/ko/ serves Page Not Found with status 404
		// even for a perfectly valid ticker) must never carry an index signal
		if ( is_404() ) {
			$robots['index']  = 'noindex';
			$robots['follow'] = 'follow';
			return $robots;
		}
		$s = sml_sta_current_stocks_ticker_score();
		if ( is_array( $s ) && ! empty( $s['valid'] ) ) {
			// fresh cached score is the authority when we have one
			if ( 'noindex' === $s['verdict'] ) {
				$robots['index']  = 'noindex';
				$robots['follow'] = 'follow';
			}
			return $robots;
		}
		// No fresh score (cache expired, provider outage, or engine off). The
		// sweep's stored state carries the same keep-last-good grace the
		// sitemap honors — a page the sweep recently vouched for must not flip
		// to noindex mid-outage while the sitemap still lists it (Batcache
		// would persist that noindex to Googlebot long after the blip).
		$st = sml_sta_state_entry( $symbol );
		if ( null !== $st && ! empty( $st['eligible'] ) ) { return $robots; }
		// nothing vouches for this page — fail closed
		$robots['index']  = 'noindex';
		$robots['follow'] = 'follow';
		return $robots;
	} );

	add_filter( 'rank_math/json_ld', function ( $data, $jsonld ) {
		if ( is_404() ) { return $data; } // never describe an entity on a Page Not Found
		$s = sml_sta_current_stocks_ticker_score();
		if ( null === $s || ! $s['valid'] ) { return $data; }

		$symbol  = $s['symbol'];
		$company = is_array( $s['company'] ) ? $s['company'] : array();
		$quote   = is_array( $s['quote'] ) ? $s['quote'] : array();
		$name    = ! empty( $company['name'] ) ? $company['name'] : $symbol;
		$url     = home_url( '/stocks/' . strtolower( $symbol ) . '/' );

		$data['smlOrg'] = array(
			'@type'       => 'Corporation',
			'@id'         => $url . '#entity',
			'name'        => $name,
			'tickerSymbol' => $symbol,
			'url'         => $url,
		);
		if ( ! empty( $company['website'] ) ) { $data['smlOrg']['sameAs'] = array( $company['website'] ); }
		if ( ! empty( $company['description'] ) ) { $data['smlOrg']['description'] = wp_strip_all_tags( $company['description'] ); }

		$data['smlBreadcrumb'] = array(
			'@type'           => 'BreadcrumbList',
			'itemListElement' => array(
				array( '@type' => 'ListItem', 'position' => 1, 'name' => 'Markets', 'item' => home_url( '/markets/' ) ),
				array( '@type' => 'ListItem', 'position' => 2, 'name' => $symbol, 'item' => $url ),
			),
		);

		// Price only when the quote is not stale — a stale number printed as current
		// is exactly the failure mode this whole architecture exists to prevent.
		// No priceValidUntil: the quote's timestamp is an OBSERVATION time (in the
		// past — Google flags a past priceValidUntil), and inventing a future
		// validity window would be fabricating a claim the data doesn't make.
		if ( isset( $quote['current'] ) && null !== $quote['current'] && empty( $quote['stale'] ) && ! empty( $quote['timestamp'] ) ) {
			$data['smlOffer'] = array(
				'@type'          => 'Offer',
				'price'          => $quote['current'],
				'priceCurrency'  => 'USD',
				'url'            => $url,
			);
			$data['smlOrg']['makesOffer'] = array( '@id' => $url . '#offer' );
			$data['smlOffer']['@id'] = $url . '#offer';
		}

		return $data;
	}, 10, 2 );

	/* ---------- AI-readable summary block: no schema hook exists for new visible
	   content, so this is the one place that still needs output buffering.
	   Injected immediately after <body ...> — guarantees above-the-fold
	   placement regardless of the existing template's own markup. ---------- */
	function sml_sta_summary_html( $s ) {
		$symbol   = $s['symbol'];
		$company  = is_array( $s['company'] ) ? $s['company'] : array();
		$quote    = is_array( $s['quote'] ) ? $s['quote'] : array();
		$position = is_array( $s['position'] ) ? $s['position'] : array();
		$name     = ! empty( $company['name'] ) ? $company['name'] : $symbol;
		$market   = ! empty( $company['market'] ) ? $company['market'] : '';

		$has_ts   = ! empty( $quote['timestamp'] ); // never substitute render-time "now" for a real observation time
		$has_px   = isset( $quote['current'] ) && null !== $quote['current'];
		$delayed  = $has_px && ! empty( $quote['stale'] ); // the live normal case for anonymous sessions — label it, don't hide the price

		$lead = $has_ts
			? 'As of ' . esc_html( wp_date( 'F j, Y g:ia T', (int) ( $quote['timestamp'] / 1000 ) ) ) . ', '
			: '';
		$sentences   = array();
		$sentences[] = $lead . esc_html( $symbol ) . ' (' . esc_html( $name ) . ( $market ? ', ' . esc_html( $market ) : '' ) . ')'
			. ( $has_px
				? ' traded at $' . esc_html( number_format_i18n( (float) $quote['current'], 2 ) )
					. ( isset( $quote['change'] ) && null !== $quote['change']
						? ', ' . ( $quote['change'] >= 0 ? '+' : '' ) . esc_html( number_format_i18n( (float) $quote['change'], 2 ) )
							. ( isset( $quote['percentChange'] ) && null !== $quote['percentChange']
								? ' (' . ( $quote['percentChange'] >= 0 ? '+' : '' ) . esc_html( number_format_i18n( (float) $quote['percentChange'], 2 ) ) . '%)'
								: '' )
							. ' on the day'
						: '' )
					. ( $delayed ? ' (delayed quote).' : '.' )
				: ' has no current trading data available.' );

		if ( isset( $position['profitRatio'] ) ) {
			$sentences[] = 'StockMarketLoop\'s Market Position model puts the current profit ratio at '
				. esc_html( number_format_i18n( (float) $position['profitRatio'], 2 ) ) . '%'
				. ( isset( $position['support'], $position['resistance'] )
					? ', with support near $' . esc_html( number_format_i18n( (float) $position['support'], 2 ) )
						. ' and resistance near $' . esc_html( number_format_i18n( (float) $position['resistance'], 2 ) ) . '.'
					: '.' );
		}

		if ( ! empty( $company['marketCap'] ) ) {
			$sentences[] = 'Market capitalization: $' . esc_html( number_format_i18n( round( $company['marketCap'] / 1e9, 1 ), 1 ) ) . 'B.';
		}

		$html  = '<section id="sml-seo-summary" style="max-width:820px;margin:20px auto 0;padding:16px 20px;background:#f6f5f3;border:1px solid #d2d8d2;border-radius:10px;font:15px/1.6 -apple-system,Segoe UI,sans-serif;color:#14191c">';
		$html .= '<p style="margin:0">' . implode( ' ', $sentences ) . '</p>';
		$html .= '<p style="margin:8px 0 0;font-size:12px;color:#7c8785">Source: StockMarketLoop real-time market data'
			. ( ! empty( $quote['source'] ) ? ' (' . esc_html( $quote['source'] ) . ')' : '' ) . '. Not investment advice.</p>';
		$html .= '</section>';
		return $html;
	}

	function sml_sta_ob( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '<body' ) ) { return $html; }
		if ( false !== strpos( $html, 'id="sml-seo-summary"' ) ) { return $html; } // idempotent
		// never inject a "traded at $X" summary into an error page (verified
		// live: /stocks/ko/ 404s yet the ticker itself scores valid)
		$code = http_response_code();
		if ( is_int( $code ) && $code >= 400 ) { return $html; }
		$s = sml_sta_current_stocks_ticker_score();
		if ( null === $s || ! $s['valid'] ) { return $html; }
		if ( ! preg_match( '/<body\b[^>]*>/i', $html, $m, PREG_OFFSET_CAPTURE ) ) { return $html; }
		$at = $m[0][1] + strlen( $m[0][0] );
		return substr( $html, 0, $at ) . sml_sta_summary_html( $s ) . substr( $html, $at );
	}

	add_action( 'init', static function () {
		$symbol = sml_sta_symbol_from_stocks_path();
		if ( '' === $symbol ) { return; }
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return; }
		ob_start( 'sml_sta_ob' );
	}, 0 );
}
