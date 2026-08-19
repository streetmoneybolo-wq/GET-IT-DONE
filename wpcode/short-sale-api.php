/**
 * SML Short sale analysis — REAL FINRA short volume + short interest for the ticker terminal.
 * WPCode: PHP Snippet / Auto Insert / Run Everywhere. ROLLBACK: deactivate.
 *
 * Data: the site's market-data provider (Massive / Polygon) via the Members plugin's
 * server-side helper `sml_members_massive_request( $path, $query, $ttl, $stale_ttl )`
 * (key never leaves the server):
 *   /stocks/v1/short-volume    — FINRA daily short volume per ticker
 *   /stocks/v1/short-interest  — FINRA bi-monthly short interest (settlement dates)
 * Routes: GET /wp-json/sml-short/v1/short?symbol=SPY[&days=20]
 *         GET /wp-json/sml-short/v1/financials?symbol=AAPL[&timeframe=quarterly|annual&limit=8]  (statements newest-first)
 *   → { symbol, available, volume:[{date, short, total, ratio}], interest:[{date, short_interest, avg_daily_volume, days_to_cover}], summary:{avg_ratio, peak_ratio, peak_date, sessions} }
 * If the provider does not return either dataset (plan / symbol), available=false — the
 * terminal then leaves the card hidden. Nothing is ever invented.
 *
 * WPCode rules: no top-level return/exit; no base64-decode / eval / ini-set / error-reporting.
 */
if ( ! function_exists( 'sml_short_fetch' ) ) {
	function sml_short_fetch( $path, $query, $ttl, $stale ) {
		if ( function_exists( 'sml_members_massive_request' ) ) { return sml_members_massive_request( $path, $query, $ttl, $stale ); }
		if ( function_exists( 'sml_mte_request' ) ) { return sml_mte_request( $path, $query, $ttl, $stale ); }
		if ( function_exists( 'sml_tdc_massive' ) ) { return sml_tdc_massive( $path, $query, $ttl, $stale ); }
		return new WP_Error( 'sml_short_no_provider', 'No market-data provider helper is available.' );
	}
	function sml_short_rows( $raw ) {
		if ( is_wp_error( $raw ) || ! is_array( $raw ) ) { return array(); }
		$rows = isset( $raw['results'] ) && is_array( $raw['results'] ) ? $raw['results'] : ( isset( $raw['data'] ) && is_array( $raw['data'] ) ? $raw['data'] : array() );
		return array_values( array_filter( $rows, 'is_array' ) );
	}
	function sml_short_rest( WP_REST_Request $r ) {
		$symbol = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $r->get_param( 'symbol' ) ) );
		if ( '' === $symbol ) { return new WP_Error( 'sml_short_symbol', 'symbol is required', array( 'status' => 400 ) ); }
		$days = max( 5, min( 60, (int) ( $r->get_param( 'days' ) ?: 20 ) ) );
		$vol_raw = sml_short_fetch( '/stocks/v1/short-volume', array( 'ticker' => $symbol, 'limit' => $days, 'sort' => 'date.desc' ), 3600, DAY_IN_SECONDS );
		$int_raw = sml_short_fetch( '/stocks/v1/short-interest', array( 'ticker' => $symbol, 'limit' => 8, 'sort' => 'settlement_date.desc' ), 6 * HOUR_IN_SECONDS, 3 * DAY_IN_SECONDS );
		$vol = array(); $int = array();
		foreach ( sml_short_rows( $vol_raw ) as $row ) {
			$short = (float) ( $row['short_volume'] ?? 0 ); $total = (float) ( $row['total_volume'] ?? 0 );
			$ratio = isset( $row['short_volume_ratio'] ) ? (float) $row['short_volume_ratio'] : ( $total > 0 ? $short / $total * 100 : 0 );
			if ( $ratio > 0 && $ratio <= 1 && $total > 0 && $short / $total * 100 > 1 ) { $ratio = $ratio * 100; } /* provider may return 0..1 */
			$vol[] = array( 'date' => (string) ( $row['date'] ?? '' ), 'short' => (int) $short, 'total' => (int) $total, 'ratio' => round( $ratio, 2 ) );
		}
		foreach ( sml_short_rows( $int_raw ) as $row ) {
			$int[] = array( 'date' => (string) ( $row['settlement_date'] ?? '' ), 'short_interest' => (int) ( $row['short_interest'] ?? 0 ), 'avg_daily_volume' => (int) ( $row['avg_daily_volume'] ?? 0 ), 'days_to_cover' => isset( $row['days_to_cover'] ) ? (float) $row['days_to_cover'] : null );
		}
		usort( $vol, static function ( $a, $b ) { return strcmp( $a['date'], $b['date'] ); } ); /* oldest → newest for charting */
		usort( $int, static function ( $a, $b ) { return strcmp( $b['date'], $a['date'] ); } ); /* newest first */
		$summary = null;
		if ( $vol ) {
			$sum = 0; $peak = null;
			foreach ( $vol as $v ) { $sum += $v['ratio']; if ( null === $peak || $v['ratio'] > $peak['ratio'] ) { $peak = $v; } }
			$summary = array( 'sessions' => count( $vol ), 'avg_ratio' => round( $sum / count( $vol ), 1 ), 'peak_ratio' => round( $peak['ratio'], 1 ), 'peak_date' => $peak['date'] );
		}
		$errs = array();
		if ( is_wp_error( $vol_raw ) ) { $errs[] = 'volume: ' . $vol_raw->get_error_message(); }
		if ( is_wp_error( $int_raw ) ) { $errs[] = 'interest: ' . $int_raw->get_error_message(); }
		$res = rest_ensure_response( array( 'symbol' => $symbol, 'available' => (bool) ( $vol || $int ), 'volume' => $vol, 'interest' => $int, 'summary' => $summary, 'source' => 'FINRA via Massive', 'errors' => $errs ) );
		$res->header( 'Cache-Control', 'public, max-age=900' );
		return $res;
	}
	/* Financial statements, newest first. The Members plugin's market-data/fundamentals
	   route returns a single, oldest record per dataset (its provider call has no sort /
	   limit), so the terminal's Research tab uses this route instead — same provider, same
	   helper, explicit limit + sort. Nothing is invented: empty datasets stay empty. */
	function sml_short_rest_financials( WP_REST_Request $r ) {
		$symbol = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $r->get_param( 'symbol' ) ) );
		if ( '' === $symbol ) { return new WP_Error( 'sml_fin_symbol', 'symbol is required', array( 'status' => 400 ) ); }
		$tf    = 'annual' === (string) $r->get_param( 'timeframe' ) ? 'annual' : 'quarterly';
		$limit = max( 1, min( 12, (int) ( $r->get_param( 'limit' ) ?: 8 ) ) );
		$sets  = array(
			'income_statement' => array( '/stocks/financials/v1/income-statements', 'period_end.desc' ),
			'balance_sheet'    => array( '/stocks/financials/v1/balance-sheets', 'period_end.desc' ),
			'cash_flow'        => array( '/stocks/financials/v1/cash-flow-statements', 'period_end.desc' ),
			'ratios'           => array( '/stocks/financials/v1/ratios', 'date.desc' ),
		);
		$out = array(); $errs = array();
		foreach ( $sets as $key => $spec ) {
			/* the financials API filters by `tickers` (plural) — `ticker` is silently ignored and
			   returns every issuer sorted by period; ratios use `ticker` + `date` sort */
			$q = ( 'ratios' === $key ) ? array( 'ticker' => $symbol, 'limit' => $limit ) : array( 'tickers' => $symbol, 'limit' => $limit, 'sort' => $spec[1], 'timeframe' => $tf );
			$raw = sml_short_fetch( $spec[0], $q, 6 * HOUR_IN_SECONDS, 3 * DAY_IN_SECONDS );
			if ( is_wp_error( $raw ) ) { $errs[] = $key . ': ' . $raw->get_error_message(); $out[ $key ] = array(); continue; }
			$rows = sml_short_rows( $raw );
			/* belt and braces: keep only rows that name this symbol when the row carries tickers */
			$rows = array_values( array_filter( $rows, static function ( $row ) use ( $symbol ) {
				if ( isset( $row['tickers'] ) && is_array( $row['tickers'] ) && $row['tickers'] ) { return in_array( $symbol, array_map( 'strtoupper', array_map( 'strval', $row['tickers'] ) ), true ); }
				if ( isset( $row['ticker'] ) && '' !== (string) $row['ticker'] ) { return strtoupper( (string) $row['ticker'] ) === $symbol; }
				return true;
			} ) );
			$out[ $key ] = $rows;
		}
		$res = rest_ensure_response( array( 'symbol' => $symbol, 'timeframe' => $tf, 'datasets' => $out, 'errors' => $errs, 'source' => 'Massive' ) );
		$res->header( 'Cache-Control', 'public, max-age=1800' );
		return $res;
	}
	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-short/v1', '/short', array( 'methods' => 'GET', 'callback' => 'sml_short_rest', 'permission_callback' => '__return_true', 'args' => array( 'symbol' => array( 'required' => true ), 'days' => array() ) ) );
		register_rest_route( 'sml-short/v1', '/financials', array( 'methods' => 'GET', 'callback' => 'sml_short_rest_financials', 'permission_callback' => '__return_true', 'args' => array( 'symbol' => array( 'required' => true ), 'timeframe' => array(), 'limit' => array() ) ) );
	} );
}
