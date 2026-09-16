<?php
/**
 * Plugin Name: SML Analyst Live Scanner
 * Description: Full-market directory search and animated live feed for the Analyst Dashboard scanner.
 * Version: 2.0.1
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sml_als_clean_symbol( $value ) {
	return strtoupper( preg_replace( '/[^A-Z0-9.\-]/', '', (string) $value ) );
}

function sml_als_finite_number_or_null( $value ) {
	if ( null === $value || '' === $value || ! is_numeric( $value ) ) {
		return null;
	}
	$number = (float) $value;
	return is_finite( $number ) ? $number : null;
}

function sml_als_positive_number_or_null( $value ) {
	$number = sml_als_finite_number_or_null( $value );
	return null !== $number && $number > 0 ? $number : null;
}

function sml_als_massive( $path, $params = array(), $ttl = 5 ) {
	if ( function_exists( 'sml_members_massive_request' ) ) {
		return sml_members_massive_request( $path, $params, $ttl, max( 30, $ttl * 6 ) );
	}
	$key = (string) get_option( 'sml_massive_key', '' );
	if ( '' === $key ) {
		return new WP_Error( 'sml_als_no_provider', 'Market-data provider is not configured.' );
	}
	$params['apiKey'] = $key;
	$url              = 'https://api.massive.com' . $path . '?' . http_build_query( $params, '', '&', PHP_QUERY_RFC3986 );
	$response         = wp_remote_get( $url, array( 'timeout' => 20 ) );
	if ( is_wp_error( $response ) ) {
		return $response;
	}
	if ( wp_remote_retrieve_response_code( $response ) >= 400 ) {
		return new WP_Error( 'sml_als_provider_error', 'Market-data provider request failed.' );
	}
	$body = json_decode( wp_remote_retrieve_body( $response ), true );
	return is_array( $body ) ? $body : new WP_Error( 'sml_als_bad_provider_data', 'Market-data response was invalid.' );
}

function sml_als_snapshot_row( $ticker ) {
	$day   = is_array( $ticker['day'] ?? null ) ? $ticker['day'] : array();
	$prev  = is_array( $ticker['prevDay'] ?? null ) ? $ticker['prevDay'] : array();
	$trade = is_array( $ticker['lastTrade'] ?? null ) ? $ticker['lastTrade'] : array();
	$quote = is_array( $ticker['lastQuote'] ?? null ) ? $ticker['lastQuote'] : array();
	$min   = is_array( $ticker['min'] ?? null ) ? $ticker['min'] : array();
	$trade_price = sml_als_positive_number_or_null( $trade['p'] ?? null );
	$minute_close = sml_als_positive_number_or_null( $min['c'] ?? null );
	$minute_open = sml_als_positive_number_or_null( $min['o'] ?? null );
	$previous_close = sml_als_positive_number_or_null( $prev['c'] ?? null );
	$last  = null !== $trade_price ? $trade_price : $minute_close;
	$close = sml_als_positive_number_or_null( $day['c'] ?? null );
	$post  = ( null !== $last && null !== $close ) ? ( ( $last - $close ) / $close * 100 ) : null;
	$baseline_ratio = ( null !== $minute_open && null !== $previous_close )
		? max( $minute_open, $previous_close ) / min( $minute_open, $previous_close )
		: 1.0;
	$baseline_valid = $baseline_ratio < 1000;
	return array(
		'sym'     => sml_als_clean_symbol( $ticker['ticker'] ?? '' ),
		'last'    => $last,
		'ltime'   => isset( $trade['t'] ) ? (float) $trade['t'] : null,
		'chg'     => $baseline_valid ? sml_als_finite_number_or_null( $ticker['todaysChange'] ?? null ) : null,
		'chgPct'  => $baseline_valid ? sml_als_finite_number_or_null( $ticker['todaysChangePerc'] ?? null ) : null,
		'o'       => sml_als_positive_number_or_null( $day['o'] ?? null ),
		'h'       => sml_als_positive_number_or_null( $day['h'] ?? null ),
		'l'       => sml_als_positive_number_or_null( $day['l'] ?? null ),
		'c'       => $close,
		'v'       => sml_als_finite_number_or_null( $day['v'] ?? null ),
		'mo'      => $minute_open,
		'pc'      => $baseline_valid ? $previous_close : null,
		'pv'      => sml_als_positive_number_or_null( $prev['v'] ?? null ),
		'bid'     => sml_als_positive_number_or_null( $quote['p'] ?? null ),
		'bs'      => isset( $quote['s'] ) ? (int) $quote['s'] : null,
		'ask'     => sml_als_positive_number_or_null( $quote['P'] ?? null ),
		'as'      => isset( $quote['S'] ) ? (int) $quote['S'] : null,
		'postPct' => $post,
		'quality' => $baseline_valid ? 'verified_snapshot' : 'unadjusted_corporate_action',
	);
}

function sml_als_live_feed() {
	$cached = get_transient( 'sml_als_live_feed_v3' );
	if ( is_array( $cached ) ) {
		return $cached;
	}
	$sets = array(
		sml_als_massive( '/v2/snapshot/locale/us/markets/stocks/gainers', array(), 4 ),
		sml_als_massive( '/v2/snapshot/locale/us/markets/stocks/losers', array(), 4 ),
	);
	$rows = array();
	foreach ( $sets as $set ) {
		if ( is_wp_error( $set ) ) {
			continue;
		}
		foreach ( (array) ( $set['tickers'] ?? array() ) as $ticker ) {
			$row = sml_als_snapshot_row( $ticker );
			if ( $row['sym'] ) {
				$rows[ $row['sym'] ] = $row;
			}
		}
	}
	$rows = array_values( $rows );
	usort(
		$rows,
		static function ( $a, $b ) {
			$a_change = sml_als_finite_number_or_null( $a['chgPct'] ?? null );
			$b_change = sml_als_finite_number_or_null( $b['chgPct'] ?? null );
			if ( null === $a_change || null === $b_change ) {
				if ( null === $a_change && null === $b_change ) {
					return strcmp( (string) ( $a['sym'] ?? '' ), (string) ( $b['sym'] ?? '' ) );
				}
				return null === $a_change ? 1 : -1;
			}
			$change_order = $b_change <=> $a_change;
			return 0 !== $change_order ? $change_order : strcmp( (string) ( $a['sym'] ?? '' ), (string) ( $b['sym'] ?? '' ) );
		}
	);
	$out = array(
		'available' => ! empty( $rows ),
		'rows'      => array_slice( $rows, 0, 100 ),
		'asof'      => time(),
		'source'    => 'live_market_snapshot',
	);
	set_transient( 'sml_als_live_feed_v3', $out, 4 );
	return $out;
}

function sml_als_directory_search( WP_REST_Request $request ) {
	$query = strtoupper( sanitize_text_field( (string) $request->get_param( 'q' ) ) );
	$query = trim( preg_replace( '/[^A-Z0-9.\-\s]/', '', $query ) );
	$limit = max( 1, min( 50, absint( $request->get_param( 'limit' ) ?: 50 ) ) );

	$moomoo = get_option( 'sml_moomoo_scanner_universe', array() );
	if ( is_array( $moomoo ) && ! empty( $moomoo ) ) {
		$matches = array();
		foreach ( $moomoo as $item ) {
			$symbol = sml_als_clean_symbol( is_array( $item ) ? ( $item['symbol'] ?? $item['code'] ?? '' ) : $item );
			$name   = is_array( $item ) ? sanitize_text_field( $item['name'] ?? '' ) : '';
			if ( '' === $query || false !== strpos( $symbol . ' ' . strtoupper( $name ), $query ) ) {
				$matches[] = array( 'symbol' => $symbol, 'name' => $name, 'source' => 'moomoo_opend' );
			}
			if ( count( $matches ) >= $limit ) {
				break;
			}
		}
		return array( 'available' => true, 'results' => $matches, 'count' => count( $matches ), 'source' => 'moomoo_opend' );
	}

	if ( function_exists( 'sml_members_massive_ticker_search_rows' ) ) {
		$source_rows = sml_members_massive_ticker_search_rows( $query, $limit );
		$results     = array();
		foreach ( $source_rows as $row ) {
			$results[] = array(
				'symbol' => sml_als_clean_symbol( $row['symbol'] ?? '' ),
				'name'   => sanitize_text_field( $row['name'] ?? '' ),
				'type'   => sanitize_text_field( $row['type'] ?? 'STOCK' ),
				'source' => 'verified_us_directory',
			);
		}
		return array( 'available' => true, 'results' => $results, 'count' => count( $results ), 'source' => 'verified_us_directory' );
	}

	// The members helper may be loaded only on its own REST route. Keep this
	// scanner self-contained so company-name lookup works on every request.
	$directory = sml_als_massive(
		'/v3/reference/tickers',
		array(
			'search' => $query,
			'active' => 'true',
			'market' => 'stocks',
			'limit'  => $limit,
			'sort'   => 'ticker',
			'order'  => 'asc',
		),
		300
	);
	if ( ! is_wp_error( $directory ) ) {
		$results = array();
		foreach ( (array) ( $directory['results'] ?? array() ) as $row ) {
			$symbol = sml_als_clean_symbol( $row['ticker'] ?? '' );
			if ( ! $symbol ) {
				continue;
			}
			$results[] = array(
				'symbol' => $symbol,
				'name'   => sanitize_text_field( $row['name'] ?? '' ),
				'type'   => sanitize_text_field( $row['type'] ?? 'STOCK' ),
				'source' => 'verified_us_directory',
			);
		}
		return array( 'available' => true, 'results' => $results, 'count' => count( $results ), 'source' => 'verified_us_directory' );
	}

	return array( 'available' => false, 'results' => array(), 'count' => 0, 'source' => 'unavailable' );
}

function sml_als_quotes( WP_REST_Request $request ) {
	$symbols = array_filter( array_unique( array_map( 'sml_als_clean_symbol', explode( ',', (string) $request->get_param( 'symbols' ) ) ) ) );
	$symbols = array_slice( $symbols, 0, 50 );
	if ( ! $symbols ) {
		return array( 'available' => false, 'rows' => array(), 'reason' => 'No symbols supplied.' );
	}
	$data = sml_als_massive(
		'/v2/snapshot/locale/us/markets/stocks/tickers',
		array( 'tickers' => implode( ',', $symbols ) ),
		4
	);
	if ( is_wp_error( $data ) ) {
		return array( 'available' => false, 'rows' => array(), 'reason' => $data->get_error_message() );
	}
	$rows = array();
	foreach ( (array) ( $data['tickers'] ?? array() ) as $ticker ) {
		$row = sml_als_snapshot_row( $ticker );
		if ( $row['sym'] ) {
			$rows[] = $row;
		}
	}
	return array( 'available' => ! empty( $rows ), 'rows' => $rows, 'asof' => time() );
}

function sml_als_moomoo_timestamp_ms( $value ) {
	$timestamp = sml_als_finite_number_or_null( $value );
	if ( null === $timestamp || $timestamp <= 0 ) {
		return null;
	}
	return $timestamp < 1000000000000 ? $timestamp * 1000 : $timestamp;
}

function sml_als_validate_moomoo_payload( $data, $symbol ) {
	if ( ! is_array( $data ) || empty( $data['available'] ) ) {
		return new WP_Error( 'sml_moomoo_unavailable', 'The live feed did not return an available market snapshot.' );
	}
	$incoming = sml_als_clean_symbol( $data['symbol'] ?? $symbol );
	if ( $incoming && $incoming !== $symbol ) {
		return new WP_Error( 'sml_moomoo_symbol_mismatch', 'The live feed returned data for a different symbol.' );
	}
	$snapshot = is_array( $data['snapshot'] ?? null ) ? $data['snapshot'] : array();
	$book     = is_array( $data['book'] ?? null ) ? $data['book'] : array();
	$bids     = is_array( $book['bids'] ?? null ) ? $book['bids'] : array();
	$asks     = is_array( $book['asks'] ?? null ) ? $book['asks'] : array();
	$current  = sml_als_positive_number_or_null( $snapshot['current'] ?? $snapshot['last_price'] ?? null );
	$best_bid = sml_als_positive_number_or_null( $bids[0]['price'] ?? $snapshot['bid_price'] ?? null );
	$best_ask = sml_als_positive_number_or_null( $asks[0]['price'] ?? $snapshot['ask_price'] ?? null );
	$asof_ms  = sml_als_moomoo_timestamp_ms( $data['asof'] ?? null );
	$age_ms   = null === $asof_ms ? null : round( microtime( true ) * 1000 - $asof_ms );

	if ( null === $current || empty( $bids ) || empty( $asks ) || null === $best_bid || null === $best_ask ) {
		return new WP_Error( 'sml_moomoo_missing_layers', 'Quote and order-book layers did not reach quorum.' );
	}
	if ( $best_bid > $best_ask ) {
		return new WP_Error( 'sml_moomoo_crossed_book', 'The live feed returned a crossed order book.' );
	}
	if ( null === $age_ms || $age_ms < -5000 || $age_ms > 15000 ) {
		return new WP_Error( 'sml_moomoo_stale_payload', 'The live feed returned an expired market snapshot.' );
	}

	$data['symbol'] = $symbol;
	$data['source'] = 'moomoo_opend';
	$data['asof']   = $asof_ms;
	$data['health'] = array(
		'mode'       => 'live',
		'age_ms'     => max( 0, $age_ms ),
		'quote'      => true,
		'order_book' => true,
		'ticks'      => ! empty( $data['ticks'] ) && is_array( $data['ticks'] ),
		'quorum'     => 2 + ( ! empty( $data['ticks'] ) && is_array( $data['ticks'] ) ? 1 : 0 ),
	);
	return $data;
}

function sml_als_moomoo_market( WP_REST_Request $request ) {
	$symbol = sml_als_clean_symbol( $request->get_param( 'symbol' ) ?: 'SPY' );
	$depth  = max( 1, min( 40, absint( $request->get_param( 'depth' ) ?: 20 ) ) );
	$ticks  = max( 0, min( 100, absint( $request->get_param( 'ticks' ) ) ) );
	$bridge = untrailingslashit( trim( (string) get_option( 'sml_moomoo_bridge', '' ) ) );
	$secret = (string) get_option( 'sml_moomoo_secret', '' );
	if ( ! $symbol || ! wp_http_validate_url( $bridge ) ) {
		return array( 'available' => false, 'symbol' => $symbol, 'source' => 'moomoo_opend', 'reason' => 'The live-data bridge is not configured.' );
	}

	/* One upstream fetch per symbol/depth/tick tuple. All dashboard consumers
	 * share this one-second verified payload instead of multiplying OpenD work. */
	$cache_group = 'sml_moomoo_market';
	$cache_key   = 'current_' . md5( $symbol . '|' . $depth . '|' . $ticks );
	$last_key    = 'last_good_' . md5( $symbol . '|' . $depth . '|' . $ticks );
	$lock_key    = 'lock_' . md5( $symbol . '|' . $depth . '|' . $ticks );
	$cached      = wp_cache_get( $cache_key, $cache_group );
	if ( is_array( $cached ) ) {
		$cached_age = round( microtime( true ) * 1000 - (float) ( $cached['asof'] ?? 0 ) );
		if ( $cached_age >= 0 && $cached_age <= 1500 ) {
			$cached['health']['shared'] = true;
			return $cached;
		}
	}

	$has_lock = wp_cache_add( $lock_key, 1, $cache_group, 12 );
	if ( ! $has_lock ) {
		/* A concurrent request is already refreshing this symbol. Wait briefly
		 * for its result, then use a clearly-labelled last-good hold if needed. */
		for ( $attempt = 0; $attempt < 4; $attempt++ ) {
			usleep( 75000 );
			$shared = wp_cache_get( $cache_key, $cache_group );
			if ( is_array( $shared ) ) {
				$shared['health']['shared'] = true;
				return $shared;
			}
		}
		$last_good = wp_cache_get( $last_key, $cache_group );
		$last_age  = is_array( $last_good ) ? round( microtime( true ) * 1000 - (float) ( $last_good['asof'] ?? 0 ) ) : PHP_INT_MAX;
		if ( is_array( $last_good ) && $last_age >= 0 && $last_age <= 30000 ) {
			$last_good['health']['mode']   = $last_age <= 1500 ? 'live' : 'holding';
			$last_good['health']['age_ms'] = $last_age;
			$last_good['health']['shared'] = true;
			return $last_good;
		}
		return array( 'available' => false, 'symbol' => $symbol, 'source' => 'moomoo_opend', 'reason' => 'A live-data refresh is already in progress.', 'retry_after_ms' => 500 );
	}
	/* Every bridge request must be unique. The bridge and the WordPress edge
	 * are both capable of caching GETs; a cached order book is not live data. */
	$url      = add_query_arg(
		array(
			'symbol'  => $symbol,
			'depth'   => $depth,
			'ticks'   => $ticks,
			'_sml_ts' => (string) round( microtime( true ) * 1000 ),
		),
		$bridge . '/market'
	);
	$response = wp_remote_get(
		$url,
		array(
			'timeout' => 8,
			'headers' => array(
				'Accept'        => 'application/json',
				'Cache-Control' => 'no-cache, no-store, max-age=0',
				'Pragma'        => 'no-cache',
				'X-SML-Key'     => $secret,
			),
		)
	);
	if ( is_wp_error( $response ) ) {
		wp_cache_delete( $lock_key, $cache_group );
		return array( 'available' => false, 'symbol' => $symbol, 'source' => 'moomoo_opend', 'reason' => 'The live-data bridge is reconnecting.' );
	}
	$status = wp_remote_retrieve_response_code( $response );
	$data   = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( $status >= 400 || ! is_array( $data ) ) {
		wp_cache_delete( $lock_key, $cache_group );
		return array( 'available' => false, 'symbol' => $symbol, 'source' => 'moomoo_opend', 'reason' => 'The live-data bridge returned an invalid response.' );
	}
	$verified = sml_als_validate_moomoo_payload( $data, $symbol );
	wp_cache_delete( $lock_key, $cache_group );
	if ( is_wp_error( $verified ) ) {
		return array( 'available' => false, 'symbol' => $symbol, 'source' => 'moomoo_opend', 'reason' => $verified->get_error_message(), 'code' => $verified->get_error_code() );
	}
	wp_cache_set( $cache_key, $verified, $cache_group, 2 );
	wp_cache_set( $last_key, $verified, $cache_group, 35 );
	return $verified;
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'sml-scanner/v1',
			'/live',
			array( 'methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => 'sml_als_live_feed' )
		);
		register_rest_route(
			'sml-scanner/v1',
			'/directory',
			array( 'methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => 'sml_als_directory_search' )
		);
		register_rest_route(
			'sml-scanner/v1',
			'/quotes',
			array( 'methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => 'sml_als_quotes' )
		);
		register_rest_route(
			'sml-scanner/v1',
			'/market',
			array( 'methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => 'sml_als_moomoo_market' )
		);
		register_rest_route(
			'sml-scanner/v1',
			'/market-v2',
			array( 'methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => 'sml_als_moomoo_market' )
		);
	}
);

/* The market route is intentionally public so group members can stream it,
 * but public GET routes are otherwise eligible for WordPress.com edge cache.
 * Explicit no-store headers are mandatory for quote/order-book correctness. */
add_filter(
	'rest_post_dispatch',
	static function ( $response, $server, $request ) {
		if ( ! in_array( $request->get_route(), array( '/sml-scanner/v1/market', '/sml-scanner/v1/market-v2' ), true ) || ! $response instanceof WP_REST_Response ) {
			return $response;
		}
		$response->header( 'Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0' );
		$response->header( 'Pragma', 'no-cache' );
		$response->header( 'Expires', 'Wed, 11 Jan 1984 05:00:00 GMT' );
		$response->header( 'X-SML-Market-Cache', 'BYPASS' );
		return $response;
	},
	10,
	3
);

function sml_als_is_dashboard() {
	$path = wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH );
	return is_string( $path ) && preg_match( '#^/analyst-dashboard/?$#', $path );
}

function sml_als_inject_dashboard( $html ) {
	if ( false === stripos( $html, 'id="scanner"' ) || false !== stripos( $html, 'id="sml-als-runtime"' ) ) {
		return $html;
	}
	$options_markup = shortcode_exists( 'sml_options_intelligence' ) ? do_shortcode( '[sml_options_intelligence]' ) : '';
	$options_css    = '';
	$options_js     = '';
	if ( '' !== trim( $options_markup ) && false === stripos( $html, 'id="sml-als-options-host"' ) ) {
		$needle = '<div id="scanwrap">';
		$offset = strpos( $html, $needle );
		if ( false !== $offset ) {
			$host = '<div id="sml-als-options-host" hidden aria-hidden="true">' . $options_markup . '</div>';
			$html = substr_replace( $html, $host, $offset, 0 );
		}
		if ( class_exists( 'SML_Options_Intelligence_V2' ) ) {
			$reflection = new ReflectionClass( 'SML_Options_Intelligence_V2' );
			$base_url   = plugin_dir_url( $reflection->getFileName() );
			$version    = defined( 'SML_Options_Intelligence_V2::VERSION' ) ? SML_Options_Intelligence_V2::VERSION : '0.1.6';
			if ( false === stripos( $html, 'options-intelligence.css' ) ) {
				$options_css = '<link id="sml-options-intelligence-v2-css" rel="stylesheet" href="' . esc_url( $base_url . 'assets/options-intelligence.css?ver=' . rawurlencode( $version ) ) . '">';
			}
			if ( false === stripos( $html, 'options-intelligence.js' ) ) {
				$options_js = '<script id="sml-options-intelligence-v2-js-extra">window.SMLOptionsIntelligence=' . wp_json_encode( array(
					'chainUrl'       => esc_url_raw( rest_url( 'sml-options-intelligence/v1/chain' ) ),
					'historyUrl'     => esc_url_raw( rest_url( 'sml-options-intelligence/v1/contract-history' ) ),
					'nonce'          => wp_create_nonce( 'wp_rest' ),
					'riskFreeRate'   => 0.045,
					'pollOpenMs'     => 15000,
					'pollClosedMs'   => 0,
					'enhanceSelector'=> '.sml-mde-widget[data-sml-mde-module="option-chain"]',
					'isAdminPreview' => current_user_can( 'manage_options' ),
				) ) . ';</script><script id="sml-options-intelligence-v2-js" src="' . esc_url( $base_url . 'assets/options-intelligence.js?ver=' . rawurlencode( $version ) ) . '"></script>';
			}
		}
	}
	$css = <<<'CSS'
<style id="sml-als-css">#scanflash.sml-mmt{display:flex;align-items:center;gap:10px;min-height:38px;padding:0 0 0 10px;overflow:hidden;position:relative}.sml-mmt-label{flex:none;display:inline-flex;align-items:center;gap:6px;font:800 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;color:#f5c95c;text-decoration:none;white-space:nowrap}.sml-mmt-label:hover{color:#ffe08f}.sml-mmt-label:focus-visible,.sml-mmt-item:focus-visible{outline:2px solid #f5c95c;outline-offset:2px;border-radius:6px}.sml-mmt-dot{width:7px;height:7px;border-radius:50%;background:#5b6b7c}#scanflash.is-live .sml-mmt-dot{background:#3dff8f;box-shadow:0 0 0 0 rgba(61,255,143,.6);animation:smlMmtPulse 2s infinite}@keyframes smlMmtPulse{70%{box-shadow:0 0 0 6px rgba(61,255,143,0)}100%{box-shadow:0 0 0 0 rgba(61,255,143,0)}}.sml-mmt-counts{flex:none;display:inline-flex;gap:8px;font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;white-space:nowrap}.sml-mmt-counts .up{color:#3dff8f}.sml-mmt-counts .dn{color:#ff5a6a}.sml-mmt-viewport{flex:1;min-width:0;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 24px),transparent)}.sml-mmt-track{display:flex;width:max-content}.sml-mmt-track.is-rolling{animation:smlMmtRoll var(--mmt-dur,60s) linear infinite}.sml-mmt-viewport:hover .sml-mmt-track,.sml-mmt-viewport:focus-within .sml-mmt-track{animation-play-state:paused}@keyframes smlMmtRoll{from{transform:translateX(0)}to{transform:translateX(-50%)}}.sml-mmt-set{display:flex;gap:8px;padding-right:8px}.sml-mmt-item{display:inline-flex;align-items:baseline;gap:6px;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#dce6f0;font:600 12.5px/1.1 system-ui,-apple-system,Segoe UI,sans-serif;white-space:nowrap;cursor:pointer}.sml-mmt-item:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.22)}.sml-mmt-item b{font:800 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff}.sml-mmt-item.up .sml-mmt-arrow,.sml-mmt-item.up .sml-mmt-num{color:#3dff8f}.sml-mmt-item.dn .sml-mmt-arrow,.sml-mmt-item.dn .sml-mmt-num{color:#ff5a6a}.sml-mmt-num{font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}.sml-mmt-fam{color:#c7d3de}.sml-mmt-time{color:#7f90a2;font-size:11px;font-variant-numeric:tabular-nums}.sml-mmt-empty{padding:0 6px;color:#8fa3b5;font:500 12px/38px system-ui,-apple-system,Segoe UI,sans-serif;white-space:nowrap}@media (prefers-reduced-motion:reduce){.sml-mmt-track.is-rolling{animation:none}.sml-mmt-viewport{overflow-x:auto;-webkit-mask-image:none;mask-image:none}.sml-mmt-set[aria-hidden]{display:none}}@media (max-width:640px){.sml-mmt-counts{display:none}.sml-mmt-fam{display:none}}html.sml-mmt-open{overflow:hidden}.sml-mmt-backdrop{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(3,6,10,.72);backdrop-filter:blur(3px)}.sml-mmt-card{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:18px 20px 16px;border-radius:14px;background:#0b1118;border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 60px rgba(0,0,0,.55);color:#dce6f0;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}.sml-mmt-card.up{border-top:3px solid #3dff8f}.sml-mmt-card.dn{border-top:3px solid #ff5a6a}.sml-mmt-head{display:flex;align-items:center;gap:10px}.sml-mmt-badge{font:800 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;padding:4px 8px;border-radius:999px}.sml-mmt-card.up .sml-mmt-badge{color:#3dff8f;background:rgba(61,255,143,.1)}.sml-mmt-card.dn .sml-mmt-badge{color:#ff5a6a;background:rgba(255,90,106,.1)}.sml-mmt-when{color:#8fa3b5;font-size:12px;font-variant-numeric:tabular-nums}.sml-mmt-x{margin-left:auto;width:32px;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#dce6f0;font-size:20px;line-height:1;cursor:pointer}.sml-mmt-x:hover{background:rgba(255,255,255,.08)}.sml-mmt-x:focus-visible,.sml-mmt-actions button:focus-visible,.sml-mmt-actions a:focus-visible{outline:2px solid #f5c95c;outline-offset:2px}.sml-mmt-card h3{margin:12px 0 6px;font:800 20px/1.25 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff}.sml-mmt-what{margin:0 0 12px;font-size:15px;color:#fff}.sml-mmt-sec{margin:0 0 10px}.sml-mmt-sec h4{margin:0 0 3px;font:800 11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.07em;text-transform:uppercase;color:#f5c95c}.sml-mmt-sec p{margin:0}.sml-mmt-sec ul{margin:0;padding-left:18px}.sml-mmt-sec li{margin:2px 0}.sml-mmt-rule{margin:12px 0;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.04);color:#b8c6d3;font-size:12.5px}.sml-mmt-actions{display:flex;flex-wrap:wrap;gap:8px}.sml-mmt-actions button,.sml-mmt-actions a{padding:8px 12px;border-radius:8px;font:700 13px/1 system-ui,-apple-system,Segoe UI,sans-serif;text-decoration:none;cursor:pointer}.sml-mmt-actions button{border:0;background:#3dff8f;color:#04110a}.sml-mmt-actions a{border:1px solid rgba(255,255,255,.18);color:#dce6f0}.sml-mmt-note{margin:10px 0 0;color:#7f90a2;font-size:11.5px}.sml-als-r5{white-space:nowrap;font-variant-numeric:tabular-nums}.sml-als-r5 b{color:#8cc9ff}.sml-als-r5 .sml-als-sire-pct{margin-left:3px}
#scanner[data-sml-live="1"]{overflow:hidden}#scanner[data-sml-live="1"] .ph{position:relative}
#sml-als-options-host{display:none;min-width:0;width:100%;padding:10px;box-sizing:border-box;background:#070b13}#scanner.sml-als-options-open{overflow:visible}#scanner.sml-als-options-open #sml-als-options-host{display:block}#scanner.sml-als-options-open #scanwrap,#scanner.sml-als-options-open #scanft,#scanner.sml-als-options-open #scanhd>.tools,#scanner.sml-als-options-open #sml-als-status{display:none!important}#scanner.sml-als-options-open #scanhd{border-bottom:1px solid #1d2b41}#scanner.sml-als-options-open .sml-oi-root{max-width:none;width:100%;margin:0}
#sml-als-status{display:inline-flex;align-items:center;gap:7px;margin-left:9px;padding:4px 8px;border:1px solid rgba(61,255,143,.35);border-radius:999px;background:rgba(61,255,143,.08);color:#7affae;font-size:9px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
#sml-als-status:before{content:"";width:6px;height:6px;border-radius:50%;background:#3dff8f;box-shadow:0 0 12px #3dff8f;animation:smlAlsPulse 1.2s ease-in-out infinite}
#sml-als-status.paused{color:#91a1b8;border-color:#34435c;background:#101827}#sml-als-status.paused:before{background:#718199;box-shadow:none;animation:none}
#scanbody tr{will-change:transform;transition:transform .42s cubic-bezier(.2,.8,.2,1),background-color .5s ease,opacity .3s ease}
#scanbody tr.sml-als-new{animation:smlAlsEnter .42s ease both}#scanbody td.sml-als-up{animation:smlAlsUp .75s ease}#scanbody td.sml-als-down{animation:smlAlsDown .75s ease}
#scan-count .sml-als-source{color:#5dbdff;font-weight:900}#scanner .sml-als-name{display:block;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7187a8;font-size:8px;font-weight:700}
#scanner .sml-als-sire{white-space:nowrap;font-variant-numeric:tabular-nums}#scanner .sml-als-sire b{color:#f5c95c}#scanner .sml-als-sire .sml-als-sire-pct{margin-left:3px}#scanner .sml-als-sire .sml-als-sire-up{color:#3dff8f}#scanner .sml-als-sire .sml-als-sire-down{color:#ff6675}#scanner .sml-als-sire .sml-als-sire-flat{color:#7f93b5}
#scanner th[data-sml-column-sort]{cursor:pointer;user-select:none}#scanner th[data-sml-column-sort]:focus-visible{outline:2px solid #f5c95c;outline-offset:-2px}#scanner th[data-sml-column-sort] .sml-als-sort-mark{display:inline-block;min-width:10px;margin-left:3px;color:#f5c95c}
#sml-mm-book-state{display:inline-flex;align-items:center;gap:5px;margin-left:8px;color:#6f819d;font-size:8px;font-weight:900;letter-spacing:.08em}#sml-mm-book-state.live{color:#3dff8f}#sml-mm-book-state.live:before{content:"";width:5px;height:5px;border-radius:50%;background:#3dff8f;box-shadow:0 0 8px #3dff8f}
#sml-mm-book-state.fallback{color:#f5c95c;border-color:#6f5520}#sml-mm-book-state.verifying{color:#5dbdff}#sml-mm-book-state.closed{color:#c4cfdf;border-color:#536179}
#sml-mm-depth-toggle{margin-left:auto;border:1px solid #2a3b56;border-radius:6px;background:#0d1625;color:#9fb2d2;padding:3px 7px;font-size:8px;font-weight:900;letter-spacing:.06em;cursor:pointer}#sml-mm-depth-toggle:hover{color:#fff;border-color:#4a6a96}#sml-mm-book-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;margin:0 10px 8px;border:1px solid #1d2b41;border-radius:8px;overflow:hidden;background:#1d2b41}#sml-mm-book-summary>span{min-width:0;padding:7px 8px;background:#0b121e;color:#7185a3;font-size:8px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}#sml-mm-book-summary b{display:block;margin-top:2px;color:#e7eefc;font-size:11px;letter-spacing:0;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}#sml-mm-book-summary .bid b{color:#3dff8f}#sml-mm-book-summary .ask b{color:#ff6675}#sml-mm-book-summary .imbalance.bid-heavy b{color:#3dff8f}#sml-mm-book-summary .imbalance.ask-heavy b{color:#ff6675}
#l2 tbody tr.sml-mm-depth-row{position:relative;background:linear-gradient(90deg,var(--depth-color) 0 var(--depth),transparent var(--depth) 100%);transition:background-size .18s ease}#l2 tbody tr.sml-mm-depth-row.sml-mm-best td{font-weight:900;color:#fff;border-top:1px solid rgba(93,189,255,.2);border-bottom:1px solid rgba(93,189,255,.2)}#l2 tbody tr.sml-mm-changed{animation:smlMmBookFlash .42s ease}#l2 .note.sml-mm-note{display:flex;justify-content:space-between;gap:8px;color:#7185a3}#l2 .note.sml-mm-note strong{color:#9fb2d2;font-weight:900}
@keyframes smlMmBookFlash{0%{filter:brightness(1.8)}100%{filter:brightness(1)}}
@keyframes smlAlsPulse{50%{opacity:.35;transform:scale(.72)}}@keyframes smlAlsEnter{from{opacity:0;transform:translateY(-16px)}}@keyframes smlAlsUp{0%,100%{background:transparent}35%{background:rgba(61,255,143,.24);color:#78ffb2}}@keyframes smlAlsDown{0%,100%{background:transparent}35%{background:rgba(255,68,85,.24);color:#ff8d98}}
@media(max-width:700px){#sml-mm-book-summary{grid-template-columns:repeat(3,minmax(0,1fr))}#sml-mm-book-summary .imbalance{grid-column:span 2}}
@media(prefers-reduced-motion:reduce){#sml-als-status:before,#scanbody tr,#scanbody td,#l2 tbody tr{animation:none!important;transition:none!important}}
</style>
CSS;
	$js = <<<'JS'
<script id="sml-als-runtime">
(function(){'use strict';
var root=document.getElementById('scanner'),body=document.getElementById('scanbody'),input=document.getElementById('scanq'),count=document.getElementById('scan-count'),pages=document.getElementById('scan-pages'),refresh=document.getElementById('scan-refresh'),tabs=document.getElementById('scantabs'),optionsHost=document.getElementById('sml-als-options-host'),optionsRoot=optionsHost&&optionsHost.querySelector('[data-sml-options-intelligence]');
if(!root||!body||!input||!count||!pages)return;root.dataset.smlLive='1';
var api='/wp-json/sml-scanner/v1/',rows=[],previous={},page=1,per=15,tab='stocks',query='',timer=0,abort=null,visible=true,hidden=document.hidden,requestId=0,rendering=false,repaintPending=false,lastSource='LIVE MARKET FEED',sireHistory={},sireRanks={},sireGeneration={},feedGeneration=0,columnSortByTab={},optionsOpen=false,lastOptionsSymbol='',symbolTimer=0;
var status=document.createElement('span');status.id='sml-als-status';status.textContent='Live stream';var title=root.querySelector('.ttl');if(title)title.appendChild(status);
var sortableKeys={sym:1,name:1,last:1,price:1,chgAbs:1,chgPct:1,gapPct:1,prePct:1,rank5:1,sireRank:1,postPct:1,postChg:1,v:1,turnover:1,volPct:1,relV:1,mcap:1,bid:1,bs:1,ask:1,as:1,last2:1,lchg:1,rank5d:1,rank10d:1,rank20d:1,ytdPct:1};Array.prototype.forEach.call(root.querySelectorAll('thead th[data-k]'),function(th){var key=th.dataset.k;if(!sortableKeys[key])return;th.dataset.smlColumnSort=key;th.dataset.smlSortLabel=key==='rank5'||key==='sireRank'?'SIRE':th.textContent.trim();th.setAttribute('tabindex','0');th.setAttribute('role','button')});
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v,d){return v==null||!isFinite(Number(v))?'--':Number(v).toFixed(d==null?2:d)}
function signed(v){return v==null||!isFinite(Number(v))?'--':(Number(v)>=0?'+':'')+Number(v).toFixed(2)}
function compact(v){v=Number(v);if(!isFinite(v))return'--';if(v>=1e12)return(v/1e12).toFixed(2)+'T';if(v>=1e9)return(v/1e9).toFixed(2)+'B';if(v>=1e6)return(v/1e6).toFixed(2)+'M';if(v>=1e3)return(v/1e3).toFixed(1)+'K';return String(Math.round(v))}
function finiteNumber(v){if(v==null||v===''||!isFinite(Number(v)))return null;return Number(v)}
function positiveNumber(v){var n=finiteNumber(v);return n!=null&&n>0?n:null}
function cls(v){var n=finiteNumber(v);return n==null?'mut':n>=0?'gpos':'gneg'}
function compareSigned(av,bv,descending){var an=av==null||av===''||!isFinite(Number(av)),bn=bv==null||bv===''||!isFinite(Number(bv));if(an!==bn)return an?1:-1;if(an&&bn)return 0;return descending?Number(bv)-Number(av):Number(av)-Number(bv)}
function marketSession(){var parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date()),map={};parts.forEach(function(p){map[p.type]=p.value});if(map.weekday==='Sat'||map.weekday==='Sun')return'CLOSED';var mins=Number(map.hour)*60+Number(map.minute);if(mins>=240&&mins<570)return'PRE';if(mins>=570&&mins<960)return'REGULAR';if(mins>=960&&mins<1200)return'AFTER';return'CLOSED'}
function selectSessionTab(){var session=marketSession(),wanted=session==='PRE'?'premarket':session==='AFTER'?'afterhours':'stocks',button=tabs.querySelector('button[data-tab="'+wanted+'"]');if(!button)return;Array.prototype.forEach.call(tabs.querySelectorAll('button'),function(x){x.classList.remove('on');x.setAttribute('aria-selected','false')});button.classList.add('on');button.setAttribute('aria-selected','true');tab=wanted}
function enrich(r){if(r.full){r.marketSession=marketSession();return r}var session=marketSession(),last=positiveNumber(r.last),previousClose=positiveNumber(r.pc),open=positiveNumber(r.o),regularClose=positiveNumber(r.c),volume=finiteNumber(r.v),previousVolume=positiveNumber(r.pv),extendedFromPrevious=last!=null&&previousClose!=null?(last-previousClose)/previousClose*100:null;r.last=last;r.pc=previousClose;r.o=open;r.c=regularClose;r.gapPct=open!=null&&previousClose!=null?(open-previousClose)/previousClose*100:null;r.prePct=session==='PRE'?extendedFromPrevious:r.gapPct;if(session==='AFTER')r.postPct=last!=null&&regularClose!=null?(last-regularClose)/regularClose*100:null;else if(finiteNumber(r.postPct)==null)r.postPct=null;r.relV=volume!=null&&volume>=0&&previousVolume!=null?volume/previousVolume:null;r.marketSession=session;return r}
function sourceTimeMs(value,fallback){var n=finiteNumber(value);if(n==null)return fallback;if(n>1e17)return n/1e6;if(n>1e14)return n/1e3;if(n>1e11)return n;if(n>1e8)return n*1000;return fallback}
function trackSire(list){var now=Date.now(),cut=now-300000;list.forEach(function(r){var price=positiveNumber(r.last);if(price==null){r.sireMomentum=null;return}var observed=sourceTimeMs(r.ltime,now),h=(sireHistory[r.sym]||[]).filter(function(x){return x.t>=cut});if(h.length&&h[h.length-1].sourceT===observed)h[h.length-1]={t:now,sourceT:observed,p:price};else h.push({t:now,sourceT:observed,p:price});if(h.length>80)h=h.slice(-80);sireHistory[r.sym]=h;var base=h.length>1?positiveNumber(h[0].p):positiveNumber(r.mo);r.sireMomentum=finiteNumber(r.chg5mPct)!=null?finiteNumber(r.chg5mPct):(base!=null?(price-base)/base*100:null)})}
function sireSessionPct(mode,r){if(mode==='premarket')return r.prePct;if(mode==='afterhours')return r.postPct;if(r.marketSession==='PRE')return r.prePct;if(r.marketSession==='AFTER')return r.postPct;return r.chgPct}
function sireScore(mode,r){var momentum=finiteNumber(r.sireMomentum),sessionMove=finiteNumber(sireSessionPct(mode,r)),relativeVolume=finiteNumber(r.relV);if(positiveNumber(r.last)==null||sessionMove==null)return null;momentum=momentum==null?0:momentum;var volume=relativeVolume==null||relativeVolume<0?0:Math.min(12,Math.log(1+relativeVolume)*2);return momentum*12+sessionMove*.3+volume}
function updateSire(mode){if(sireGeneration[mode]===feedGeneration)return;var prior=sireRanks[mode]||{},ranked=rows.map(function(r){return{row:r,score:sireScore(mode,r),session:finiteNumber(sireSessionPct(mode,r)),momentum:finiteNumber(r.sireMomentum),relV:finiteNumber(r.relV)}}).filter(function(x){return x.score!=null}).sort(function(a,b){var order=compareSigned(a.score,b.score,true);if(order)return order;order=compareSigned(a.session,b.session,true);if(order)return order;order=compareSigned(a.momentum,b.momentum,true);if(order)return order;order=compareSigned(a.relV,b.relV,true);return order||String(a.row.sym).localeCompare(String(b.row.sym))}),next={};ranked.forEach(function(item,i){var r=item.row,rank=i+1,old=prior[r.sym]&&prior[r.sym].rank;next[r.sym]={rank:rank,move:old?old-rank:0,pct:item.momentum,sessionPct:item.session,score:item.score}});sireRanks[mode]=next;sireGeneration[mode]=feedGeneration}
function sireCell(r){updateSire(tab);var s=(sireRanks[tab]||{})[r.sym];if(!s)return'<td class="sml-als-sire mut" title="S.I.R.E unavailable: verified session data is missing"><b>--</b></td>';var arrow=s.move>0?'&#8593;'+s.move:s.move<0?'&#8595;'+Math.abs(s.move):'&#8226;',arrowClass=s.move>0?'sml-als-sire-up':s.move<0?'sml-als-sire-down':'sml-als-sire-flat';return'<td class="sml-als-sire" title="S.I.R.E rank · rolling five-minute momentum · extended-hours aware"><b>#'+s.rank+'</b><span class="sml-als-sire-pct '+cls(s.pct)+'">'+(s.pct==null?'--':signed(s.pct)+'%')+'</span><span class="'+arrowClass+'">'+arrow+'</span></td>'}
function syncSortHeaders(){var active=columnSortByTab[tab]||null;Array.prototype.forEach.call(root.querySelectorAll('th[data-sml-column-sort]'),function(th){var key=th.dataset.smlColumnSort,label=th.dataset.smlSortLabel||th.textContent.trim(),direction=active&&active.key===key?active.direction:0,ascendingBest=key==='rank5'||key==='sireRank'||key==='sym';th.setAttribute('aria-sort',direction===1?(ascendingBest?'ascending':'descending'):direction===-1?(ascendingBest?'descending':'ascending'):'none');th.setAttribute('aria-label',direction===1?label+', best to worst. Activate for worst to best.':direction===-1?label+', worst to best. Activate to reset.':'Sort '+label+' best to worst.');th.innerHTML=esc(label)+'<span class="sml-als-sort-mark" aria-hidden="true">'+(direction===1?(ascendingBest?'&#9650;':'&#9660;'):direction===-1?(ascendingBest?'&#9660;':'&#9650;'):'')+'</span>'})}
function toggleColumnSort(key){var current=columnSortByTab[tab];if(!current||current.key!==key)columnSortByTab[tab]={key:key,direction:1};else if(current.direction===1)columnSortByTab[tab]={key:key,direction:-1};else delete columnSortByTab[tab];page=1;syncSortHeaders();render(query?'DIRECTORY SEARCH':'LIVE '+marketSession()+' FEED')}
function visibleScanColumns(){var heads=Array.prototype.slice.call(root.querySelectorAll('#scanhead th[data-k],thead th[data-k]'));if(!heads.length)return[{k:'star'},{k:'rank'},{k:'sym'},{k:'last'},{k:'chgPct'},{k:'gapPct'},{k:'rank5'},{k:'postPct'},{k:'v'},{k:'relV'},{k:'mcap'},{k:'bid'},{k:'bs'},{k:'ask'},{k:'as'},{k:'last2'},{k:'lchg'},{k:'yield'}];return heads.map(function(th){return{k:th.dataset.k,label:th.textContent.trim(),l:th.classList.contains('l')}})}
function pct(v){return v==null||!isFinite(Number(v))?'--':signed(v)+'%'}
function field(r,key){if(key==='rank5')return fiveRank(r.sym);if(key==='rank'||key==='sireRank')return((sireRanks[tab]||{})[r.sym]||{}).rank;if(key==='name')return r.name||'';if(key==='last2'||key==='price')return r.last;if(key==='lchg')return r.chgPct;if(key==='gapPct')return r.prePct;if(key==='chgAbs')return finiteNumber(r.chgAbs)!=null?r.chgAbs:(r.last!=null&&r.pc!=null?r.last-r.pc:null);if(key==='turnover')return finiteNumber(r.turnover)!=null?r.turnover:(r.last!=null&&r.v!=null?r.last*r.v:null);if(key==='volPct')return r.volPct!==undefined?r.volPct:(r.v!=null&&r.pv?((r.v-r.pv)/r.pv*100):null);if(key==='postChg')return r.postChg!==undefined?r.postChg:(r.postPct!=null&&r.c!=null?r.c*r.postPct/100:null);if(key==='peTtm')return r.peTtm||r.peTTM||r.pe||null;if(key==='pb')return r.pb||r.pbRatio||null;if(key==='peLyr')return r.peLyr||r.staticPe||null;return r[key]}
function td(html,klass,extra){return'<td'+(klass?' class="'+klass+'"':'')+(extra||'')+'>'+html+'</td>'}
function scannerCell(r,col,idx,tick){var key=col.k,v=field(r,key);if(key==='star')return'<td class="l"><span class="star" data-w="'+esc(r.sym)+'">&#9734;</span></td>';if(key==='rank')return'<td class="l mut">'+idx+'</td>';if(key==='sym')return'<td class="l symb">'+esc(r.sym)+(r.name?'<small class="sml-als-name">'+esc(r.name)+'</small>':'')+'</td>';if(key==='name')return'<td class="l">'+(r.name?esc(r.name):'--')+'</td>';if(key==='sireRank')return sireCell(r);if(key==='rank5')return fiveCell(r);if(key==='last'||key==='price'||key==='last2')return td(num(r.last),tick);if(key==='chgAbs'||key==='postChg'||key==='macd')return td(v==null?'--':signed(v),cls(v));if(key==='chgPct'||key==='lchg'||key==='gapPct'||key==='prePct'||key==='postPct'||key==='volPct'||key==='chg5mPct'||key==='chg5dPct'||key==='chg10dPct'||key==='chg20dPct'||key==='chg60dPct'||key==='chg120dPct'||key==='chg250dPct'||key==='ytdPct'||key==='roe'||key==='roa'||key==='netMargin'||key==='grossMargin'||key==='revenueGrowth'||key==='epsGrowth'||key==='institutionalHoldings'||key==='insiderHoldings'||key==='profitRatio'||key==='overlapDegree')return td(pct(v),cls(v));if(key==='handTurnover'||key==='amplitude'||key==='divYield')return td(v==null||!isFinite(Number(v))?'--':num(v)+'%');if(key==='v'||key==='turnover'||key==='mcap')return td(v==null?'--':(key==='turnover'||key==='mcap'?'$':'')+compact(v));if(key==='relV')return td(v==null?'--':num(v));if(key==='bid'||key==='ask')return td(num(v));if(key==='bs'||key==='as')return td(v==null?'--':(v*100).toLocaleString());if(key==='rank5d'||key==='rank10d'||key==='rank20d')return td(v||'--','mut');return td(v==null?'--':(isFinite(Number(v))?num(v):esc(v)),'mut')}
function sortValue(r,key){if(key==='rank5')return fiveRank(r.sym);if(key==='sireRank')return((sireRanks[tab]||{})[r.sym]||{}).rank;if(key==='last2')return r.last;if(key==='lchg')return r.chgPct;if(key==='gapPct')return r.prePct;return field(r,key)}
function sorted(){updateSire(tab);var out=rows.slice(),active=columnSortByTab[tab]||null;if(active){out.sort(function(a,b){var av=sortValue(a,active.key),bv=sortValue(b,active.key),an=av==null||av===''||!isFinite(Number(av)),bn=bv==null||bv===''||!isFinite(Number(bv));if(active.key==='sym')return active.direction===1?String(a.sym).localeCompare(String(b.sym)):String(b.sym).localeCompare(String(a.sym));if(an!==bn)return an?1:-1;if(an&&bn)return String(a.sym).localeCompare(String(b.sym));if(active.key==='rank5'||active.key==='sireRank')return active.direction===1?Number(av)-Number(bv):Number(bv)-Number(av);return compareSigned(av,bv,active.direction===1)});return out}if(tab==='premarket')out.sort(function(a,b){return compareSigned(a.prePct,b.prePct,true)});else if(tab==='afterhours')out.sort(function(a,b){return compareSigned(a.postPct,b.postPct,true)});else if(tab==='options')out.sort(function(a,b){return compareSigned(a.v,b.v,true)});else out.sort(function(a,b){return compareSigned(a.chgPct,b.chgPct,true)});return out}
function renderLegacy(source){rendering=true;lastSource=source||lastSource;var all=sorted(),total=all.length,max=Math.max(1,Math.ceil(total/per));if(page>max)page=max;var start=(page-1)*per,vis=all.slice(start,start+per),oldPos={};Array.prototype.forEach.call(body.querySelectorAll('tr[data-sym]'),function(tr){oldPos[tr.dataset.sym]=tr.getBoundingClientRect().top});var html='';
vis.forEach(function(r,i){var old=previous[r.sym]||{},tick=old.last==null||r.last==null?'':(r.last>old.last?' sml-als-up':r.last<old.last?' sml-als-down':'');html+='<tr data-sym="'+esc(r.sym)+'" class="'+(!previous[r.sym]?'sml-als-new':'')+'"><td class="l"><span class="star" data-w="'+esc(r.sym)+'">☆</span></td><td class="l mut">'+(start+i+1)+'</td><td class="l symb">'+esc(r.sym)+(r.name?'<small class="sml-als-name">'+esc(r.name)+'</small>':'')+'</td><td class="'+tick+'">'+num(r.last)+'</td><td class="'+cls(r.chgPct)+'">'+signed(r.chgPct)+'%</td><td class="'+cls(r.gapPct)+'">'+(r.gapPct==null?'--':signed(r.gapPct)+'%')+'</td><td class="mut">LIVE</td><td class="'+cls(r.postPct)+'">'+(r.postPct==null?'--':signed(r.postPct)+'%')+'</td><td>'+compact(r.v)+'</td><td>'+(r.relV==null?'--':num(r.relV))+'</td><td>--</td><td>'+num(r.bid)+'</td><td>'+(r.bs==null?'--':(r.bs*100).toLocaleString())+'</td><td>'+num(r.ask)+'</td><td>'+(r.as==null?'--':(r.as*100).toLocaleString())+'</td><td class="'+tick+'">'+num(r.last)+'</td><td class="'+cls(r.chgPct)+'">'+signed(r.chgPct)+'%</td><td class="mut">--</td></tr>'});body.innerHTML=html||'<tr><td colspan="18" class="unavail">No verified matches.</td></tr>';
Array.prototype.forEach.call(body.querySelectorAll('tr[data-sym]'),function(tr){var before=oldPos[tr.dataset.sym],after=tr.getBoundingClientRect().top;if(before!=null&&Math.abs(before-after)>1){tr.style.transform='translateY('+(before-after)+'px)';requestAnimationFrame(function(){requestAnimationFrame(function(){tr.style.transform=''})})}});
previous={};rows.forEach(function(r){previous[r.sym]=Object.assign({},r)});count.innerHTML='Showing '+(total?start+1:0)+' to '+Math.min(start+per,total)+' of '+total+' live results · <span class="sml-als-source">'+esc(lastSource||'MARKET FEED')+'</span>';var ph='';for(var p=1;p<=max&&p<=7;p++)ph+='<button class="pg'+(p===page?' on':'')+'" data-als-page="'+p+'">'+p+'</button>';pages.innerHTML=ph;queueMicrotask(function(){rendering=false})}
function render(source){
  rendering=true;lastSource=source||lastSource;
  var all=sorted(),total=all.length,max=Math.max(1,Math.ceil(total/per));
  if(page>max)page=max;
  var start=(page-1)*per,vis=all.slice(start,start+per),oldPos={};
  Array.prototype.forEach.call(body.querySelectorAll('tr[data-sym]'),function(tr){oldPos[tr.dataset.sym]=tr.getBoundingClientRect().top});
  var html='',cols=visibleScanColumns();
  vis.forEach(function(r,i){
    var old=previous[r.sym]||{},tick=old.last==null||r.last==null?'':(r.last>old.last?' sml-als-up':r.last<old.last?' sml-als-down':'');
    html+='<tr data-sym="'+esc(r.sym)+'" class="'+(!previous[r.sym]?'sml-als-new':'')+'">'+cols.map(function(col){return scannerCell(r,col,start+i+1,tick)}).join('')+'</tr>';
  });
  body.innerHTML=html||'<tr><td colspan="'+cols.length+'" class="unavail">No verified matches.</td></tr>';
  Array.prototype.forEach.call(body.querySelectorAll('tr[data-sym]'),function(tr){var before=oldPos[tr.dataset.sym],after=tr.getBoundingClientRect().top;if(before!=null&&Math.abs(before-after)>1){tr.style.transform='translateY('+(before-after)+'px)';requestAnimationFrame(function(){requestAnimationFrame(function(){tr.style.transform=''})})}});
  previous={};rows.forEach(function(r){previous[r.sym]=Object.assign({},r)});
  count.innerHTML='Showing '+(total?start+1:0)+' to '+Math.min(start+per,total)+' of '+total+' live results · <span class="sml-als-source">'+esc(lastSource||'MARKET FEED')+'</span>';
  var ph='';for(var p=1;p<=max&&p<=7;p++)ph+='<button class="pg'+(p===page?' on':'')+'" data-als-page="'+p+'">'+p+'</button>';pages.innerHTML=ph;
  titleRankHeads();
  queueMicrotask(function(){rendering=false});
}
function setStatus(text,paused){status.textContent=text;status.classList.toggle('paused',!!paused)}
function fetchJson(url){if(abort)abort.abort();abort=new AbortController();return fetch(url,{credentials:'same-origin',cache:'no-store',signal:abort.signal}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})}
/* ===== MARKET MONITOR alert ticker (the strip above the scanner) =====
   Real alerts from the Market Monitor tape engine (GET /api/tape: detected from live quote
   snapshots of the tracked universe during the regular session). They roll by like a ticker;
   hover or keyboard focus pauses it; clicking one explains what happened, what it usually
   means and what it can lead to. Nothing here is simulated. */
var MMT_TAPE='https://stockmarketloop-loop-kick.onrender.com/api/tape';
var MMT_INFO={
  SHARP_RISE:{label:'Sharp Rise',up:true,
    rule:'The day change rose by at least 0.5 percentage points within about 5 minutes.',
    means:'Buyers stepped in fast. Common causes are a headline, a large buy order, or price breaking above a level traders were watching.',
    leads:['The move can keep going if volume stays heavy and price holds the new level.','Quick pops often give part of the gain back once the burst of buying stops.','A second Sharp Rise soon after is a sign the momentum is real.'],
    watch:'Volume Ratio and whether price holds above where the burst started.'},
  SHARP_FALL:{label:'Sharp Fall',up:false,
    rule:'The day change fell by at least 0.5 percentage points within about 5 minutes.',
    means:'Sellers hit the stock fast. Common causes are a headline, a large sell order, or price breaking below a level traders were watching.',
    leads:['The drop can extend if selling volume stays heavy.','Fast drops often bounce part of the way back once the selling burst ends.','If the stock is still green on the day, this can be profit-taking rather than bad news.'],
    watch:'Whether price holds or loses the low of the drop, and the day change.'},
  SKYROCKET:{label:'Skyrocket',up:true,
    rule:'The day change rose by at least 2 percentage points within about 10 minutes.',
    means:'Unusually strong buying for this short a time. It is usually news-driven: earnings, an upgrade, a deal, or a trading halt lifting.',
    leads:['Volatility and bid/ask spreads usually widen.','Momentum traders pile in, which can extend the run.','Sharp pullbacks are common after vertical moves, and small caps can be paused by volatility (LULD) halts.'],
    watch:'News on the ticker, Volume Ratio, and whether the first pullback holds.'},
  NOSEDIVE:{label:'Nosedive',up:false,
    rule:'The day change fell by at least 2 percentage points within about 10 minutes.',
    means:'Unusually heavy selling for this short a time. It is usually news-driven: a miss, a downgrade, an offering, or a market-wide drop.',
    leads:['Volatility and spreads usually widen.','Selling can cascade as stops trigger.','Oversold bounces are common, and small caps can be paused by volatility (LULD) halts.'],
    watch:'News on the ticker and whether buyers defend the low.'},
  RISE7:{label:'Rise 7%+',up:true,
    rule:'The stock crossed +7% on the day (versus the previous close).',
    means:'A big day move, usually tied to a catalyst. It puts the stock on day-trader and options-trader radars.',
    leads:['Strong names can keep trending into the close.','Late-day fades back under 7% are common when the catalyst is weak.','Options volume and implied volatility often jump.'],
    watch:'Whether it holds above +7% and the volume behind it.'},
  FALL7:{label:'Fall 7%+',up:false,
    rule:'The stock crossed -7% on the day (versus the previous close).',
    means:'A big day drop, usually tied to a catalyst such as earnings, guidance, or a downgrade.',
    leads:['Weak names can keep sliding into the close.','Dip-buyers may step in, causing a relief bounce.','Put volume and implied volatility often rise.'],
    watch:'Whether it keeps making new lows or starts building a base.'},
  HVOL_UP:{label:'Huge Volume ↑',up:true,
    rule:'Shares traded in the latest check ran at 4× or more the stock\'s recent pace (at least 25,000 shares) while the price ticked up.',
    means:'A burst of buying well above normal activity: often a large participant, a news hit, or a breakout attracting orders.',
    leads:['Volume behind a move makes it more likely to hold.','A huge spike with no price follow-through can mark exhaustion.'],
    watch:'Whether the next minutes keep the elevated volume and higher prices.'},
  HVOL_DN:{label:'Huge Volume ↓',up:false,
    rule:'Shares traded in the latest check ran at 4× or more the stock\'s recent pace (at least 25,000 shares) while the price ticked down.',
    means:'A burst of selling well above normal activity: often a large holder exiting, a news hit, or a breakdown triggering stops.',
    leads:['Heavy selling volume often leads to further weakness in the short term.','A climactic spike on a big drop can also mark a selling low.'],
    watch:'Whether price keeps falling on continued volume or stabilises.'},
  TOP_REV:{label:'Top Reversal',up:false,
    rule:'The stock touched its day high in the last 30 minutes, is now at least 0.5% below that high, and has fallen over the last 5 minutes.',
    means:'Buyers could not hold the high and sellers pushed it back. The high is acting as resistance.',
    leads:['A pullback toward the day\'s average price or earlier support is common.','If price climbs back through the high, the reversal has failed and the uptrend can resume.'],
    watch:'The day high: staying under it keeps the reversal valid.'},
  BOT_REB:{label:'Bottom Rebound',up:true,
    rule:'The stock touched its day low in the last 30 minutes, is now at least 0.5% above that low, and has risen over the last 5 minutes.',
    means:'Sellers could not push it lower and buyers defended the low. The low is acting as support.',
    leads:['A bounce toward the day\'s average price or earlier resistance is common.','If price breaks back under the low, the rebound has failed and the downtrend can resume.'],
    watch:'The day low: holding above it keeps the rebound valid.'}
};
var mmt={events:[],byId:{},counts:null,session:null,sig:'',pending:false,timer:0,built:false,lastFocus:null};
function mmtPct(v,d){v=Number(v);return isFinite(v)?(v>0?'+':v<0?'−':'')+Math.abs(v).toFixed(d==null?2:d)+'%':'--'}
function mmtShares(v){v=Number(v);if(!isFinite(v))return'--';return v>=1e6?(v/1e6).toFixed(2)+'M':v>=1e3?(v/1e3).toFixed(1)+'K':String(Math.round(v))}
function mmtTime(ts){try{return new Date(ts).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',timeZone:'America/New_York'})}catch(e){return''}}
function mmtDetail(e){
  var f=e.family;
  if(f==='SHARP_RISE'||f==='SHARP_FALL')return mmtPct(e.move)+' in 5m';
  if(f==='SKYROCKET'||f==='NOSEDIVE')return mmtPct(e.move)+' in 10m';
  if(f==='RISE7'||f==='FALL7')return mmtPct(e.pct)+' today';
  if(f==='HVOL_UP'||f==='HVOL_DN')return mmtShares(e.vol)+' sh burst';
  if(f==='TOP_REV')return mmtPct(e.move)+' in 5m from high';
  if(f==='BOT_REB')return mmtPct(e.move)+' in 5m from low';
  return '';
}
function mmtHappened(e){
  var i=MMT_INFO[e.family],s='$'+e.sym,day=isFinite(Number(e.pct))?' It is '+(e.pct>=0?'up ':'down ')+Math.abs(e.pct).toFixed(2)+'% on the day.':'';
  switch(e.family){
    case 'SHARP_RISE':return s+' rose '+Math.abs(e.move).toFixed(2)+'% in about 5 minutes.'+day;
    case 'SHARP_FALL':return s+' fell '+Math.abs(e.move).toFixed(2)+'% in about 5 minutes.'+day;
    case 'SKYROCKET':return s+' jumped '+Math.abs(e.move).toFixed(2)+'% in about 10 minutes.'+day;
    case 'NOSEDIVE':return s+' dropped '+Math.abs(e.move).toFixed(2)+'% in about 10 minutes.'+day;
    case 'RISE7':return s+' crossed +7% on the day and is at '+mmtPct(e.pct)+'.';
    case 'FALL7':return s+' crossed −7% on the day and is at '+mmtPct(e.pct)+'.';
    case 'HVOL_UP':return mmtShares(e.vol)+' shares of '+s+' traded in one check, 4× or more its recent pace, while the price ticked up.'+day;
    case 'HVOL_DN':return mmtShares(e.vol)+' shares of '+s+' traded in one check, 4× or more its recent pace, while the price ticked down.'+day;
    case 'TOP_REV':return s+' pulled back from its day high and fell '+Math.abs(e.move).toFixed(2)+'% over the last 5 minutes.'+day;
    case 'BOT_REB':return s+' bounced off its day low and rose '+Math.abs(e.move).toFixed(2)+'% over the last 5 minutes.'+day;
  }
  return s+' triggered '+(i?i.label:e.family)+'.';
}
function mmtItem(e,dup){
  var i=MMT_INFO[e.family];
  return '<button type="button" class="sml-mmt-item '+(i.up?'up':'dn')+'" data-mmt="'+esc(e.id)+'"'+(dup?' tabindex="-1" aria-hidden="true"':' aria-label="'+esc('$'+e.sym+' '+i.label+', '+mmtDetail(e)+', '+mmtTime(e.ts)+'. Open explanation')+'"')+'>'+
    '<span class="sml-mmt-arrow" aria-hidden="true">'+(i.up?'▲':'▼')+'</span><b>'+esc(e.sym)+'</b><span class="sml-mmt-fam">'+esc(i.label)+'</span><span class="sml-mmt-num">'+esc(mmtDetail(e))+'</span><span class="sml-mmt-time">'+esc(mmtTime(e.ts))+'</span></button>';
}
function mmtShell(el){
  if(mmt.built&&el.querySelector('.sml-mmt-viewport'))return;
  el.className='sml-mmt';el.setAttribute('role','region');el.setAttribute('aria-label','Market Monitor alerts');
  el.innerHTML='<a class="sml-mmt-label" href="/market-monitor/" title="Open Market Monitor"><span class="sml-mmt-dot" aria-hidden="true"></span>MARKET MONITOR</a>'+
    '<span class="sml-mmt-counts" aria-live="off"></span><div class="sml-mmt-viewport"><div class="sml-mmt-track"></div></div>';
  mmt.built=true;
  el.querySelector('.sml-mmt-track').addEventListener('animationiteration',function(){if(mmt.pending){mmt.pending=false;mmtFill()}});
}
function mmtFill(){
  var el=document.getElementById('scanflash');if(!el)return;mmtShell(el);
  var track=el.querySelector('.sml-mmt-track'),counts=el.querySelector('.sml-mmt-counts'),open=mmt.session&&mmt.session.open;
  el.classList.toggle('is-live',!!open);
  counts.innerHTML=mmt.counts?'<span class="up" title="Bullish alerts today">▲ '+Number(mmt.counts.bull||0).toLocaleString()+'</span><span class="dn" title="Bearish alerts today">▼ '+Number(mmt.counts.bear||0).toLocaleString()+'</span>':'';
  if(!mmt.events.length){
    track.classList.remove('is-rolling');track.style.removeProperty('--mmt-dur');
    track.innerHTML='<span class="sml-mmt-empty">'+(mmt.session?(open?'Watching for unusual activity… alerts roll here as they are detected.':'Market closed. Alerts roll here 9:30 AM–4:00 PM ET, Mon–Fri.'):'Connecting to Market Monitor…')+'</span>';
    return;
  }
  var one=mmt.events.map(function(e){return mmtItem(e,false)}).join('');
  track.innerHTML='<div class="sml-mmt-set">'+one+'</div><div class="sml-mmt-set" aria-hidden="true">'+mmt.events.map(function(e){return mmtItem(e,true)}).join('')+'</div>';
  var w=track.firstChild.scrollWidth||1200;
  track.style.setProperty('--mmt-dur',Math.max(20,Math.round(w/55))+'s');   /* ~55 px per second, readable */
  track.classList.add('is-rolling');
}
function mmtLoad(){
  if(document.hidden)return;
  fetch(MMT_TAPE,{cache:'no-store',credentials:'omit'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(d){
    if(!d||!d.ok)return;
    var date=(d.counts&&d.counts.date)||'';
    var list=(d.events||[]).filter(function(e){return MMT_INFO[e.family]&&(!date||e.d===date)}).sort(function(a,b){return b.ts-a.ts||b.id-a.id}).slice(0,30);
    mmt.session=d.session||null;mmt.counts=d.counts||null;
    var sig=list.map(function(e){return e.id}).join(',')+'|'+(mmt.session&&mmt.session.open?1:0);
    mmt.byId={};list.forEach(function(e){mmt.byId[String(e.id)]=e});
    if(sig===mmt.sig){var c=document.querySelector('#scanflash .sml-mmt-counts');if(c&&mmt.counts)c.innerHTML='<span class="up" title="Bullish alerts today">▲ '+Number(mmt.counts.bull||0).toLocaleString()+'</span><span class="dn" title="Bearish alerts today">▼ '+Number(mmt.counts.bear||0).toLocaleString()+'</span>';return}
    mmt.sig=sig;mmt.events=list;
    var track=document.querySelector('#scanflash .sml-mmt-track');
    /* swap content at the end of a loop so the ticker never jumps under the reader */
    if(track&&track.classList.contains('is-rolling')&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)mmt.pending=true;
    else mmtFill();
  }).catch(function(){
    if(!mmt.events.length){var el=document.getElementById('scanflash');if(el){mmtShell(el);var t=el.querySelector('.sml-mmt-track');if(t)t.innerHTML='<span class="sml-mmt-empty">Market Monitor is reconnecting…</span>'}}
  });
}
function mmtClose(){
  var pop=document.getElementById('sml-mmt-pop');if(!pop)return;pop.remove();
  document.documentElement.classList.remove('sml-mmt-open');
  if(mmt.lastFocus&&mmt.lastFocus.focus)try{mmt.lastFocus.focus()}catch(e){}
}
function mmtOpen(e,from){
  mmtClose();var i=MMT_INFO[e.family];if(!i)return;
  mmt.lastFocus=from||document.activeElement;
  var pop=document.createElement('div');pop.id='sml-mmt-pop';pop.className='sml-mmt-backdrop';
  pop.innerHTML='<div class="sml-mmt-card '+(i.up?'up':'dn')+'" role="dialog" aria-modal="true" aria-labelledby="sml-mmt-h">'+
    '<div class="sml-mmt-head"><span class="sml-mmt-badge">'+(i.up?'▲ Bullish':'▼ Bearish')+'</span><span class="sml-mmt-when">'+esc(mmtTime(e.ts))+' ET</span>'+
    '<button type="button" class="sml-mmt-x" aria-label="Close">×</button></div>'+
    '<h3 id="sml-mmt-h">$'+esc(e.sym)+' · '+esc(i.label)+'</h3>'+
    '<p class="sml-mmt-what">'+esc(mmtHappened(e))+'</p>'+
    '<div class="sml-mmt-sec"><h4>What it means</h4><p>'+esc(i.means)+'</p></div>'+
    '<div class="sml-mmt-sec"><h4>What it can lead to</h4><ul>'+i.leads.map(function(x){return'<li>'+esc(x)+'</li>'}).join('')+'</ul></div>'+
    '<div class="sml-mmt-sec"><h4>What to watch next</h4><p>'+esc(i.watch)+'</p></div>'+
    '<p class="sml-mmt-rule"><b>Alert rule:</b> '+esc(i.rule)+' Checked on live quotes about every 45 seconds.</p>'+
    '<div class="sml-mmt-actions"><button type="button" class="sml-mmt-go">Show $'+esc(e.sym)+' chart</button><a href="/market-monitor/">Open Market Monitor</a></div>'+
    '<p class="sml-mmt-note">Alerts describe a move that already happened. They are not predictions or investment advice.</p></div>';
  document.body.appendChild(pop);document.documentElement.classList.add('sml-mmt-open');
  pop.addEventListener('click',function(ev){
    if(ev.target===pop||ev.target.closest('.sml-mmt-x')){mmtClose();return}
    if(ev.target.closest('.sml-mmt-go')){
      var f=document.getElementById('csym');mmtClose();
      if(f){f.value=e.sym;f.dispatchEvent(new Event('change',{bubbles:true}));var chart=f.closest('.card,section')||f;try{chart.scrollIntoView({behavior:'smooth',block:'start'})}catch(x){}}
      else location.href='/stock-chart/?symbol='+encodeURIComponent(e.sym);
    }
  });
  pop.querySelector('.sml-mmt-x').focus();
}
document.addEventListener('click',function(ev){var b=ev.target.closest&&ev.target.closest('#scanflash .sml-mmt-item[data-mmt]');if(!b)return;var e=mmt.byId[b.getAttribute('data-mmt')];if(e)mmtOpen(e,b)});
document.addEventListener('keydown',function(ev){
  var pop=document.getElementById('sml-mmt-pop');if(!pop)return;
  if(ev.key==='Escape'){ev.preventDefault();mmtClose();return}
  if(ev.key==='Tab'){var f=pop.querySelectorAll('button,a[href]'),first=f[0],last=f[f.length-1];if(ev.shiftKey&&document.activeElement===first){ev.preventDefault();last.focus()}else if(!ev.shiftKey&&document.activeElement===last){ev.preventDefault();first.focus()}}
});
(function mmtStart(){
  var el=document.getElementById('scanflash');if(!el)return;
  mmtShell(el);mmtFill();mmtLoad();
  /* the dashboard's older flash-strip code can rewrite this element; put the ticker straight back */
  if('MutationObserver' in window)new MutationObserver(function(){if(!el.querySelector('.sml-mmt-viewport')){mmt.built=false;mmt.pending=false;mmtFill()}}).observe(el,{childList:true});
  setInterval(mmtLoad,15000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)mmtLoad()});
})();
/* ===== 5M Ranking: rank by the real five-minute change (biggest gain = #1) ===== */
var fiveRankCache={gen:-1,tab:'',map:{}};
function fiveRank(sym){
  if(fiveRankCache.gen!==feedGeneration||fiveRankCache.tab!==tab){
    var list=rows.filter(function(r){return finiteNumber(r.chg5mPct)!=null&&positiveNumber(r.last)!=null}).sort(function(a,b){return compareSigned(a.chg5mPct,b.chg5mPct,true)||String(a.sym).localeCompare(String(b.sym))}),map={};
    list.forEach(function(r,i){map[r.sym]=i+1});
    fiveRankCache={gen:feedGeneration,tab:tab,map:map};
  }
  return fiveRankCache.map[sym];
}
function fiveCell(r){var n=fiveRank(r.sym),p=finiteNumber(r.chg5mPct);if(!n)return'<td class="sml-als-r5 mut" title="5M Ranking unavailable: no five-minute change yet"><b>--</b></td>';return'<td class="sml-als-r5" title="5M Ranking · biggest five-minute gain is #1"><b>#'+n+'</b><span class="sml-als-sire-pct '+cls(p)+'">'+signed(p)+'%</span></td>'}
function titleRankHeads(){
  var s=root.querySelector('th[data-k="sireRank"]'),f=root.querySelector('th[data-k="rank5"]');
  if(s)s.title='S.I.R.E ranking: rolling five-minute momentum weighted with today\'s session move and volume ratio. #1 = strongest right now. Arrows show places gained or lost since the last update.';
  if(f)f.title='5M Ranking: stocks ranked by their price change over the last five minutes. #1 = biggest five-minute gain.';
}
function loadLive(){if(hidden){setStatus('Paused',true);return}var id=++requestId;setStatus('Live stream',false);fetchJson(api+'live?tab='+encodeURIComponent(tab)+'&ts='+Date.now()).then(function(d){if(id!==requestId||!d.available)return;rows=(d.rows||[]).map(enrich);window.__smlScannerRows=rows;trackSire(rows);feedGeneration++;render('LIVE '+marketSession()+' FEED · '+new Date((d.asof||Date.now()/1000)*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'}))}).catch(function(e){if(e.name!=='AbortError')setStatus('Reconnecting',true)}).finally(schedule)}
function search(){var q=input.value.trim();query=q;page=1;if(!q){loadLive();return}if(timer)clearTimeout(timer);timer=setTimeout(function(){var id=++requestId;setStatus('Searching full market',true);fetchJson(api+'directory?q='+encodeURIComponent(q)+'&limit=50&ts='+Date.now()).then(function(d){if(id!==requestId)return;var found=d.results||[],map={};found.forEach(function(x){map[x.symbol]=x});if(!found.length){rows=[];feedGeneration++;render('FULL U.S. DIRECTORY');return}return fetchJson(api+'quotes?symbols='+encodeURIComponent(found.map(function(x){return x.symbol}).join(','))+'&ts='+Date.now()).then(function(qd){if(id!==requestId)return;rows=(qd.rows||[]).map(function(r){r.name=(map[r.sym]||{}).name||'';return enrich(r)});trackSire(rows);feedGeneration++;render((d.source==='moomoo_opend'?'LIVE MARKET DATA':'VERIFIED U.S. DIRECTORY')+' SEARCH');setStatus('Search results',true)})}).catch(function(e){if(e.name!=='AbortError')setStatus('Search unavailable',true)})},240)}
function schedule(){if(timer)clearTimeout(timer);if(!query&&!hidden&&!optionsOpen)timer=setTimeout(loadLive,visible?3000:20000)}
input.placeholder='Search any U.S. symbol or company...';
var scannerLoadLive=loadLive;
loadLive=function(){if(optionsOpen)return;return scannerLoadLive()};
function dashboardSymbol(){var field=document.getElementById('csym'),symbol=String(field&&field.value||'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g,'');return symbol||'SPY'}
function notifyOptions(name,detail){if(!optionsRoot)return;window.dispatchEvent(new CustomEvent(name,{detail:Object.assign({root:optionsRoot},detail||{})}))}
function syncOptionsSymbol(){if(!optionsOpen)return;var symbol=dashboardSymbol();if(symbol===lastOptionsSymbol)return;lastOptionsSymbol=symbol;notifyOptions('sml:options-symbol-change',{symbol:symbol})}
function showOptions(){if(!optionsHost||!optionsRoot)return false;optionsOpen=true;requestId++;rows=[];if(timer)clearTimeout(timer);if(abort)abort.abort();visible=false;root.classList.add('sml-als-options-open');optionsHost.hidden=false;optionsHost.setAttribute('aria-hidden','false');lastOptionsSymbol='';syncOptionsSymbol();notifyOptions('sml:options-visibility',{visible:true});if(symbolTimer)clearInterval(symbolTimer);symbolTimer=setInterval(syncOptionsSymbol,600);return true}
function hideOptions(){if(!optionsOpen)return;optionsOpen=false;if(symbolTimer)clearInterval(symbolTimer);symbolTimer=0;notifyOptions('sml:options-visibility',{visible:false});if(optionsHost){optionsHost.hidden=true;optionsHost.setAttribute('aria-hidden','true')}root.classList.remove('sml-als-options-open');visible=true}
document.addEventListener('input',function(e){if(e.target===input){e.stopImmediatePropagation();search()}},true);
document.addEventListener('click',function(e){var b=e.target.closest('#scantabs button');if(!b)return;var next=b.dataset.tab||'stocks';if(next==='options'&&showOptions()){e.preventDefault();e.stopImmediatePropagation();Array.prototype.forEach.call(tabs.querySelectorAll('button'),function(x){x.classList.remove('on');x.setAttribute('aria-selected','false')});b.classList.add('on');b.setAttribute('aria-selected','true');tab='options';page=1;return}if(optionsOpen)hideOptions()},true);
document.addEventListener('click',function(e){var sh=e.target.closest('[data-sml-column-sort]');if(sh){e.preventDefault();e.stopImmediatePropagation();toggleColumnSort(sh.dataset.smlColumnSort);return}var p=e.target.closest('[data-als-page]');if(p){e.preventDefault();e.stopImmediatePropagation();page=Number(p.dataset.alsPage)||1;render(query?'DIRECTORY SEARCH':'LIVE MARKET FEED');return}var tr=e.target.closest('#scanbody tr[data-sym]');if(tr){var sym=tr.dataset.sym,field=document.getElementById('csym'),go=document.getElementById('csym-go');if(field&&go){field.value=sym;go.click()}return}if(e.target===refresh){e.preventDefault();e.stopImmediatePropagation();query?search():loadLive()}var b=e.target.closest('#scantabs button');if(b){e.preventDefault();e.stopImmediatePropagation();Array.prototype.forEach.call(tabs.querySelectorAll('button'),function(x){x.classList.remove('on');x.setAttribute('aria-selected','false')});b.classList.add('on');b.setAttribute('aria-selected','true');tab=b.dataset.tab||'stocks';page=1;syncSortHeaders();query?search():loadLive()}},true);
document.addEventListener('keydown',function(e){if((e.key==='Enter'||e.key===' ')&&e.target&&e.target.matches('[data-sml-column-sort]')){e.preventDefault();e.stopImmediatePropagation();toggleColumnSort(e.target.dataset.smlColumnSort)}},true);
document.addEventListener('visibilitychange',function(){hidden=document.hidden;if(hidden){if(abort)abort.abort();setStatus('Paused',true)}else{query?search():loadLive()}});
if('IntersectionObserver'in window)new IntersectionObserver(function(entries){var was=visible;visible=entries[0].isIntersecting;if(visible&&!was&&!hidden){query?search():loadLive()}},{rootMargin:'120px'}).observe(root);
if('MutationObserver'in window)new MutationObserver(function(){if(rendering||repaintPending||!rows.length)return;repaintPending=true;requestAnimationFrame(function(){repaintPending=false;if(!rendering)render(lastSource)})}).observe(root,{childList:true,subtree:true});
selectSessionTab();
syncSortHeaders();
loadLive();
}());
</script>
JS;
	$market_js = <<<'JS'
<script id="sml-mm-market-runtime">
(function(){'use strict';
var panel=document.getElementById('l2'),bidsBody=document.getElementById('l2-bids'),asksBody=document.getElementById('l2-asks');
if(!panel||!bidsBody||!asksBody)return;
if(window.__smlMoomooController&&window.__smlMoomooController.running){window.__smlMoomooController.duplicateStarts++;return}
var controller={version:'2.0.1',running:true,inFlight:false,activeRequests:0,maxActiveRequests:0,duplicateStarts:0,duplicateRequestsPrevented:0,requestSeq:0,generation:0};window.__smlMoomooController=controller;
var api='/wp-json/sml-scanner/v1/market-v2',timer=0,abort=null,visible=true,hidden=document.hidden,lastSymbol='',depth=20,lastData=null,previousRows={},closedBaselineSet=false;
function marketSessionOpen(){try{var parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),clock={};parts.forEach(function(p){clock[p.type]=p.value});var minutes=Number(clock.hour)*60+Number(clock.minute),weekday=clock.weekday;return weekday!=='Sat'&&weekday!=='Sun'&&minutes>=240&&minutes<1200}catch(e){return false}}
var arbiter=(function(){var owner='idle',symbolName='',lastMoomooAt=0,pendingSince=0,successes=0,failures=0,quote=null,circuitUntil=0,reconnects=0,accepted=0,rejected=0,lastFailure='';function same(sym){return String(sym||'').toUpperCase()===symbolName}function asofMs(v){v=Number(v||0);return v>0&&v<1000000000000?v*1000:v}return{
recordMoomoo:function(data){var snap=data&&data.snapshot||{},book=data&&data.book||{},bids=book.bids||[],asks=book.asks||[],current=Number(snap.current!=null?snap.current:snap.last_price),incoming=String(data&&data.symbol||'').toUpperCase(),asof=asofMs(data&&data.asof),age=Math.abs(Date.now()-asof),mode=String(data&&data.health&&data.health.mode||'live'),bestBid=Number(bids[0]&&bids[0].price),bestAsk=Number(asks[0]&&asks[0].price);if(!incoming||!same(incoming)||!data.available||!isFinite(current)||current<=0||!bids.length||!asks.length||!isFinite(bestBid)||!isFinite(bestAsk)||bestBid>bestAsk||!asof||age>20000){rejected++;this.recordFailure('invalid-or-stale-payload');return false}if(mode==='holding'){lastMoomooAt=asof;quote={current:current,bid:bestBid,ask:bestAsk,timestamp:asof,source:'moomoo_holding',book:book,ticks:Array.isArray(data.ticks)?data.ticks:[]};owner='moomoo-holding';failures++;return'holding'}lastMoomooAt=Date.now();quote={current:current,bid:bestBid,ask:bestAsk,timestamp:asof,source:'moomoo_opend',book:book,ticks:Array.isArray(data.ticks)?data.ticks:[]};failures=0;successes++;accepted++;circuitUntil=0;if(owner!=='moomoo-live'&&owner!=='moomoo-connecting')reconnects++;owner='moomoo-live';return'live'},
freezeClosed:function(data){var snap=data&&data.snapshot||{},current=Number(snap.current!=null?snap.current:snap.last_price),incoming=String(data&&data.symbol||symbolName).toUpperCase();if(!same(incoming))return false;owner='closed';lastMoomooAt=Date.now();pendingSince=0;successes=0;failures=0;circuitUntil=0;if(isFinite(current)&&current>0)quote={current:current,bid:snap.bid_price,ask:snap.ask_price,timestamp:asofMs(data.asof)||Date.now(),source:'market_closed'};return!!quote},
recordFailure:function(reason){var now=Date.now(),age=lastMoomooAt?now-lastMoomooAt:Infinity;successes=0;failures++;lastFailure=String(reason||'request-failed');if(!marketSessionOpen())return owner;if(quote&&age<=30000)owner='moomoo-holding';else owner='moomoo-reconnecting';if(failures>=6)circuitUntil=now+Math.min(10000,1000*Math.pow(2,Math.min(3,failures-6)));return owner},
ownsLive:function(sym){var age=lastMoomooAt?Date.now()-lastMoomooAt:Infinity;return same(sym)&&((owner==='moomoo-live'&&age<20000)||(owner==='moomoo-holding'&&age<=30000)||owner==='moomoo-connecting'||owner==='closed'||owner==='closed-pending')},
blocksFallback:function(sym){return same(sym)&&owner!=='idle'},
getLiveQuote:function(sym){return same(sym)&&quote?quote:null},
resetSymbol:function(sym){symbolName=String(sym||'').toUpperCase();owner=marketSessionOpen()?'moomoo-connecting':'closed-pending';lastMoomooAt=0;pendingSince=Date.now();successes=0;failures=0;quote=null;circuitUntil=0;lastFailure=''},
isPending:function(){return owner==='moomoo-connecting'||owner==='closed-pending'},
isMarketClosed:function(){return!marketSessionOpen()},
canProbe:function(){return Date.now()>=circuitUntil},
nextDelay:function(){return Math.max(1000,circuitUntil-Date.now())},
owner:function(){return owner},
health:function(){return{version:'2.0.1',symbol:symbolName,state:owner,last_moomoo_at:lastMoomooAt,age_ms:lastMoomooAt?Date.now()-lastMoomooAt:null,failures:failures,accepted:accepted,rejected:rejected,reconnects:reconnects,circuit_until:circuitUntil,last_failure:lastFailure,has_last_good:!!quote,active_requests:controller.activeRequests,max_active_requests:controller.maxActiveRequests,duplicate_starts:controller.duplicateStarts,duplicate_requests_prevented:controller.duplicateRequestsPrevented}}
}})();window.__smlMarketArbiter=arbiter;controller.arbiter=arbiter;window.__smlMoomooHealth=function(){return arbiter.health()};
var heading=panel.querySelector('.ttl')||panel.querySelector('.ph')||panel.firstElementChild;
var badge=document.createElement('span');badge.id='sml-mm-book-state';badge.textContent='LIVE FEED CONNECTING';if(heading)heading.appendChild(badge);
var depthButton=document.createElement('button');depthButton.type='button';depthButton.id='sml-mm-depth-toggle';depthButton.textContent='SHOW 10';depthButton.setAttribute('aria-label','Show 10 order-book levels');if(heading)heading.appendChild(depthButton);
var summary=document.createElement('div');summary.id='sml-mm-book-summary';summary.innerHTML='<span class="bid">Inside bid<b id="sml-mm-best-bid">--</b></span><span>Spread<b id="sml-mm-spread">--</b></span><span>Midpoint<b id="sml-mm-mid">--</b></span><span class="ask">Inside ask<b id="sml-mm-best-ask">--</b></span><span class="imbalance">Depth balance<b id="sml-mm-balance">--</b></span>';
var columns=panel.querySelector('.cols');if(columns)panel.insertBefore(summary,columns);else panel.appendChild(summary);
Array.prototype.forEach.call(panel.querySelectorAll('thead th:first-child'),function(th){th.textContent='LEVEL'});
var note=panel.querySelector('.note');if(note){note.classList.add('sml-mm-note');note.innerHTML='<span><strong>LIVE MARKET DATA</strong> verified depth and cumulative shares</span><span id="sml-mm-asof">Waiting...</span>'}
function clean(v){return String(v||'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g,'').slice(0,15)||'SPY'}
function symbol(){var field=document.getElementById('csym'),label=document.getElementById('l2-sym');return clean(field&&field.value||label&&label.textContent||'SPY')}
function num(v){v=Number(v);return isFinite(v)?v.toFixed(v<1?4:2):'--'}
function whole(v){v=Number(v);return isFinite(v)?Math.max(0,Math.round(v)).toLocaleString():'--'}
function setState(text,mode){badge.textContent=text;badge.classList.toggle('live',mode==='live');badge.classList.toggle('fallback',mode==='fallback');badge.classList.toggle('verifying',mode==='verifying');badge.classList.toggle('closed',mode==='closed')}
function sumSize(list){return(list||[]).slice(0,depth).reduce(function(total,r){return total+Math.max(0,Number(r.size)||0)},0)}
function renderBook(id,list,side){var visibleRows=(list||[]).slice(0,depth),total=0,maxSize=visibleRows.reduce(function(m,r){return Math.max(m,Number(r.size)||0)},1),html='',nextRows={};visibleRows.forEach(function(r,i){var size=Math.max(0,Number(r.size)||0),price=Number(r.price),key=side+'|'+i,signature=price+'|'+size;total+=size;nextRows[key]=signature;var changed=previousRows[key]&&previousRows[key]!==signature,pct=Math.max(2,Math.round(size/maxSize*100)),shade=side==='bid'?'rgba(61,255,143,.13)':'rgba(255,68,85,.13)';html+='<tr class="sml-mm-depth-row '+(i===0?'sml-mm-best ':'')+(changed?'sml-mm-changed':'')+'" style="--depth:'+pct+'%;--depth-color:'+shade+'"><td>'+side.toUpperCase()+' '+(i+1)+'</td><td class="'+(side==='bid'?'gpos':'gneg')+'">'+num(price)+'</td><td>'+whole(size)+'</td><td>'+whole(total)+'</td></tr>'});Object.keys(nextRows).forEach(function(k){previousRows[k]=nextRows[k]});if(html)document.getElementById(id).innerHTML=html;return total}
function renderSummary(book){var bids=(book.bids||[]).slice(0,depth),asks=(book.asks||[]).slice(0,depth),bestBid=bids[0]||{},bestAsk=asks[0]||{},bidTotal=sumSize(bids),askTotal=sumSize(asks),all=bidTotal+askTotal,bidPct=all?Math.round(bidTotal/all*100):50,spread=isFinite(Number(bestAsk.price))&&isFinite(Number(bestBid.price))?Number(bestAsk.price)-Number(bestBid.price):null,mid=spread==null?null:(Number(bestAsk.price)+Number(bestBid.price))/2;
document.getElementById('sml-mm-best-bid').textContent=num(bestBid.price)+' x '+whole(bestBid.size);document.getElementById('sml-mm-best-ask').textContent=num(bestAsk.price)+' x '+whole(bestAsk.size);document.getElementById('sml-mm-spread').textContent=spread==null?'--':num(spread);document.getElementById('sml-mm-mid').textContent=mid==null?'--':num(mid);var balance=document.getElementById('sml-mm-balance');balance.textContent=bidPct+'% bid / '+(100-bidPct)+'% ask';balance.parentNode.classList.toggle('bid-heavy',bidPct>55);balance.parentNode.classList.toggle('ask-heavy',bidPct<45);var bidBar=document.getElementById('l2-bbar'),askBar=document.getElementById('l2-abar');if(bidBar&&askBar){bidBar.textContent=bidPct+'%';askBar.textContent=(100-bidPct)+'%';bidBar.style.width=bidPct+'%';askBar.style.width=(100-bidPct)+'%'}var spreadEl=document.getElementById('l2-spread');if(spreadEl&&spread!=null)spreadEl.textContent=num(spread)}
function emitHealth(){window.dispatchEvent(new CustomEvent('sml:moomoo-health',{detail:arbiter.health()}))}
function paint(data,closed){lastData=data;var book=data.book||{},snap=data.snapshot||{},bestBid=(book.bids||[])[0]||{},bestAsk=(book.asks||[])[0]||{};renderBook('l2-bids',book.bids,'bid');renderBook('l2-asks',book.asks,'ask');renderSummary(book);var last=snap.current!=null?snap.current:snap.last_price,lastEl=document.getElementById('l2-last'),chgEl=document.getElementById('l2-chg');if(lastEl&&last!=null)lastEl.textContent=num(last);var highEl=document.getElementById('l2-high'),volEl=document.getElementById('l2-vol');if(highEl&&Number(snap.high)>0)highEl.textContent=num(snap.high);if(volEl&&Number(snap.volume)>0){var vv=Number(snap.volume);volEl.textContent=vv>=1e9?(vv/1e9).toFixed(2)+'B':vv>=1e6?(vv/1e6).toFixed(2)+'M':vv>=1e3?(vv/1e3).toFixed(2)+'K':String(Math.round(vv))}if(chgEl&&snap.change!=null){chgEl.className=Number(snap.change)>=0?'gpos':'gneg';chgEl.textContent=(Number(snap.change)>=0?'+':'')+Number(snap.change).toFixed(2)+' ('+(Number(snap.change_pct)>=0?'+':'')+Number(snap.change_pct).toFixed(2)+'%)'}var chipBid=document.getElementById('chip-bid'),chipAsk=document.getElementById('chip-ask');if(chipBid)chipBid.textContent=num(bestBid.price!=null?bestBid.price:snap.bid_price);if(chipAsk)chipAsk.textContent=num(bestAsk.price!=null?bestAsk.price:snap.ask_price);var asof=document.getElementById('sml-mm-asof');if(asof)asof.textContent=(closed?'Frozen ':'Updated ')+new Date(data.asof||Date.now()).toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'})+' · Q'+Number(data.health&&data.health.quorum||2);setState(closed?'MARKET CLOSED / FROZEN':'LIVE / 1 SEC',closed?'closed':'live');window.dispatchEvent(new CustomEvent('sml:moomoo-market',{detail:{symbol:data.symbol,snapshot:snap,book:book,ticks:Array.isArray(data.ticks)?data.ticks:[],asof:data.asof,source:closed?'market_closed':'moomoo_opend',closed:!!closed,health:data.health||{}}}));emitHealth()}
function apply(data){if(!data||!data.available){var failedOwner=arbiter.recordFailure(data&&data.reason||'unavailable');setState(failedOwner==='moomoo-holding'?'LIVE FEED HOLDING / RECONNECTING':'LIVE FEED RECONNECTING',failedOwner==='moomoo-holding'?'verifying':'fallback');emitHealth();return}var accepted=arbiter.recordMoomoo(data);if(accepted==='live'){paint(data,false);return}if(accepted==='holding'){setState('LIVE FEED HOLDING / VERIFIED','verifying');emitHealth();return}setState(arbiter.isPending()?'LIVE FEED SWITCHING':'LIVE FEED RECONNECTING','verifying');emitHealth()}
function applyClosed(data){if(!data||!data.available||!arbiter.freezeClosed(data)){setState('MARKET CLOSED / SNAPSHOT RETRY','closed');return}closedBaselineSet=true;paint(data,true)}
function schedule(delay){clearTimeout(timer);if(!hidden&&visible&&controller.running)timer=setTimeout(load,delay==null?arbiter.nextDelay():delay)}
function load(){if(hidden||!visible||!controller.running)return;var sym=symbol();if(sym!==lastSymbol){lastSymbol=sym;controller.generation++;previousRows={};closedBaselineSet=false;if(abort)abort.abort();arbiter.resetSymbol(sym);setState(arbiter.isMarketClosed()?'MARKET CLOSED / SWITCHING':'LIVE FEED SWITCHING',arbiter.isMarketClosed()?'closed':'verifying');emitHealth()}var closed=arbiter.isMarketClosed();if(closed&&closedBaselineSet){setState('MARKET CLOSED / FROZEN','closed');schedule(30000);return}if(!arbiter.canProbe()){setState('LIVE FEED HOLDING / CIRCUIT RETRY','verifying');schedule();return}if(controller.inFlight){controller.duplicateRequestsPrevented++;schedule(250);return}var generation=controller.generation,requestSymbol=sym,seq=++controller.requestSeq;abort=new AbortController();controller.inFlight=true;controller.activeRequests++;controller.maxActiveRequests=Math.max(controller.maxActiveRequests,controller.activeRequests);fetch(api+'?symbol='+encodeURIComponent(sym)+'&depth=20&ticks='+(closed?0:50)+'&_='+Date.now(),{credentials:'same-origin',cache:'no-store',signal:abort.signal,headers:{Accept:'application/json','X-SML-Feed-Version':'2.0.1'}}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(data){if(generation!==controller.generation||requestSymbol!==symbol()||seq!==controller.requestSeq)return;closed?applyClosed(data):apply(data)}).catch(function(e){if(e.name!=='AbortError'&&generation===controller.generation){var failedOwner=arbiter.recordFailure(e.message||'request-error');if(closed)setState('MARKET CLOSED / SNAPSHOT RETRY','closed');else setState(failedOwner==='moomoo-holding'?'LIVE FEED HOLDING / RECONNECTING':'LIVE FEED RECONNECTING',failedOwner==='moomoo-holding'?'verifying':'fallback');emitHealth()}}).finally(function(){controller.activeRequests=Math.max(0,controller.activeRequests-1);controller.inFlight=false;schedule(closed?30000:null)})}
document.addEventListener('visibilitychange',function(){hidden=document.hidden;if(hidden){clearTimeout(timer);if(abort)abort.abort();setState('FEED PAUSED','verifying')}else{controller.generation++;lastSymbol='';load()}});
var symbolField=document.getElementById('csym');if(symbolField)symbolField.addEventListener('change',function(){controller.generation++;lastSymbol='';if(abort)abort.abort();load()});
depthButton.addEventListener('click',function(){depth=depth===20?10:20;this.textContent=depth===20?'SHOW 10':'SHOW 20';this.setAttribute('aria-label','Show '+(depth===20?10:20)+' order-book levels');if(lastData)paint(lastData,arbiter.owner()==='closed')});
controller.stop=function(){controller.running=false;clearTimeout(timer);if(abort)abort.abort()};window.addEventListener('pagehide',controller.stop,{once:true});
load();
}());
</script>
JS;
	$html = preg_replace( '#</head>#i', $options_css . $css . '</head>', $html, 1 );
	$html = preg_replace( '#</body>#i', $options_js . $js . $market_js . '</body>', $html, 1 );
	return is_string( $html ) ? $html : '';
}

add_action(
	'template_redirect',
	static function () {
		if ( sml_als_is_dashboard() ) {
			ob_start( 'sml_als_inject_dashboard' );
		}
	},
	-1000000
);
