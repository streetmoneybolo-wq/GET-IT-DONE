/**
 * SML SEO — ticker canonical fix + real structured data + AI-readable summary.
 * Part 1 (Day-1 step) + Part 4 + Part 5 of the entity-graph architecture.
 *
 * Uses Rank Math's own developer hooks wherever one exists, instead of
 * regex-editing its rendered HTML — safer, and Rank Math is confirmed active
 * (it generates this site's sitemap footer + robots.txt Sitemap lines).
 * Falls back to a raw output-buffer body-open injection ONLY for the one
 * thing that has no hook: new visible page content (the AI-summary block).
 *
 * Depends on wpcode/seo-ege-core.php — load this snippet AFTER it. Fails
 * closed (adds nothing) if the engine snippet isn't active.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet — both URLs return to their prior,
 * already-live behavior; nothing here is destructive or stateful.
 */
if ( ! function_exists( 'sml_sta_symbol_from_stocks_path' ) ) {

	function sml_sta_symbol_from_stocks_path() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		if ( preg_match( '#^/stocks/([a-zA-Z0-9.\-]+)/?$#', $path, $m ) ) {
			return strtoupper( $m[1] );
		}
		return '';
	}
	function sml_sta_symbol_from_stock_chart() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		if ( '/stock-chart/' !== rtrim( $path, '/' ) . '/' ) { return ''; }
		$s = isset( $_GET['symbol'] ) ? sanitize_text_field( wp_unslash( $_GET['symbol'] ) ) : '';
		return strtoupper( preg_replace( '/[^a-zA-Z0-9.\-]/', '', $s ) );
	}

	/* ---------- Day-1: /stock-chart/?symbol=X canonicalizes to /stocks/{ticker}/ ----------
	   Uses Rank Math's own canonical filter — no HTML surgery. Only rewrites for
	   a symbol the eligibility engine confirms is real: an invalid/typo'd/garbage
	   symbol would otherwise get canonicalized to a URL that 404s (/stocks/{x}/
	   genuinely 404s on unknown tickers) — self-canonical is the correct fallback
	   for those, matching today's live behavior. */
	add_filter( 'rank_math/frontend/canonical', function ( $canonical ) {
		$symbol = sml_sta_symbol_from_stock_chart();
		if ( '' === $symbol || ! function_exists( 'sml_ege_score_ticker' ) ) { return $canonical; }
		$s = sml_ege_score_ticker( $symbol );
		if ( empty( $s['valid'] ) ) { return $canonical; }
		return home_url( '/stocks/' . strtolower( $symbol ) . '/' );
	} );

	/* ---------- /stocks/{ticker}/: eligibility-driven robots + real JSON-LD ---------- */
	function sml_sta_current_stocks_ticker_score() {
		static $done = false, $score = null;
		if ( $done ) { return $score; }
		$done = true;
		$symbol = sml_sta_symbol_from_stocks_path();
		if ( '' === $symbol || ! function_exists( 'sml_ege_score_ticker' ) ) { return null; }
		$score = sml_ege_score_ticker( $symbol );
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
		$s = sml_sta_current_stocks_ticker_score();
		if ( null === $s || ! $s['valid'] ) {
			$robots['index']  = 'noindex';
			$robots['follow'] = 'follow';
			return $robots;
		}
		// invalid tickers already 404 on this path today — this covers the
		// scored-but-thin case (40-59): crawlable, never indexed.
		if ( 'noindex' === $s['verdict'] ) {
			$robots['index']  = 'noindex';
			$robots['follow'] = 'follow';
		}
		return $robots;
	} );

	add_filter( 'rank_math/json_ld', function ( $data, $jsonld ) {
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
		if ( isset( $quote['current'] ) && null !== $quote['current'] && empty( $quote['stale'] ) && ! empty( $quote['timestamp'] ) ) {
			$data['smlOffer'] = array(
				'@type'          => 'Offer',
				'price'          => $quote['current'],
				'priceCurrency'  => 'USD',
				'priceValidUntil'=> gmdate( 'Y-m-d\TH:i:s\Z', (int) ( $quote['timestamp'] / 1000 ) ),
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
			$sentences[] = 'Market capitalization: $' . esc_html( number_format_i18n( round( $company['marketCap'] / 1e9, 1 ) ) ) . 'B.';
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
