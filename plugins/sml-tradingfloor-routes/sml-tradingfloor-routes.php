<?php
/**
 * Plugin Name: SML TradingFloor Routes
 * Description: Separates indexable company pages from interactive ticker terminals.
 * Version: 1.0.2
 * Author: Stock Market Loop
 */

defined( 'ABSPATH' ) || exit;

define( 'SML_TFR_VERSION', '1.0.2' );
define( 'SML_TFR_TERMINAL_PAGE_ID', 1929 );

function sml_tfr_normalize_symbol( $value ) {
	$symbol = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $value ) );
	return ( '' !== $symbol && strlen( $symbol ) <= 16 ) ? $symbol : '';
}

function sml_tfr_slug( $symbol ) {
	return strtolower( str_replace( '.', '-', sml_tfr_normalize_symbol( $symbol ) ) );
}

function sml_tfr_path_symbol( $prefix ) {
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	$re   = '#^/' . preg_quote( trim( $prefix, '/' ), '#' ) . '/([A-Za-z0-9.\-]{1,16})/?$#';
	return preg_match( $re, $path, $match ) ? sml_tfr_normalize_symbol( $match[1] ) : '';
}

/* The legacy "Stocks Canonical" snippet mounts the interactive V2 terminal
 * below every /stocks/{ticker}/ entity card unless this option is enabled.
 * Scope the override to company routes only: legacy terminal redirects and
 * the new /tradingfloor/{ticker}/ renderer remain fully active. */
add_filter( 'pre_option_sml_stocks_tv2_off', static function ( $pre ) {
	return sml_tfr_path_symbol( 'stocks' ) ? 1 : $pre;
}, 1 );

function sml_tfr_tradingfloor_symbol() {
	$symbol = sml_tfr_path_symbol( 'tradingfloor' );
	if ( $symbol ) { return $symbol; }
	return sml_tfr_normalize_symbol( get_query_var( 'sml_tradingfloor_symbol', '' ) );
}

function sml_tfr_symbol_exists( $symbol ) {
	$symbol = sml_tfr_normalize_symbol( $symbol );
	if ( ! $symbol ) { return false; }
	$cache_key = 'sml_tfr_symbol_' . md5( $symbol );
	$cached    = get_transient( $cache_key );
	if ( 'valid' === $cached ) { return true; }
	if ( 'invalid' === $cached ) { return false; }
	if ( function_exists( 'sml_usd_directory_data' ) && class_exists( 'WP_REST_Request' ) ) {
		$request = new WP_REST_Request( 'GET', '/sml/v1/symbol-directory' );
		$request->set_param( 'q', $symbol );
		$request->set_param( 'limit', 12 );
		$request->set_param( 'type', 'all' );
		$data = sml_usd_directory_data( $request );
		if ( ! empty( $data['available'] ) ) {
			foreach ( (array) ( $data['results'] ?? array() ) as $row ) {
				if ( $symbol === sml_tfr_normalize_symbol( $row['symbol'] ?? '' ) ) {
					set_transient( $cache_key, 'valid', DAY_IN_SECONDS );
					return true;
				}
			}
			set_transient( $cache_key, 'invalid', HOUR_IN_SECONDS );
			return false;
		}
	}
	if ( class_exists( 'SML_KG_DB' ) && method_exists( 'SML_KG_DB', 'ticker_by_slug' ) ) {
		return is_array( SML_KG_DB::ticker_by_slug( sml_tfr_slug( $symbol ) ) );
	}
	$state = get_option( 'sml_seo_stocks_state', array() );
	return is_array( $state ) && isset( $state[ $symbol ] ) && is_array( $state[ $symbol ] ) && ! empty( $state[ $symbol ]['eligible'] );
}

function sml_tfr_floor_url( $symbol ) {
	return home_url( '/tradingfloor/' . rawurlencode( sml_tfr_slug( $symbol ) ) . '/' );
}

function sml_tfr_stock_url( $symbol ) {
	return home_url( '/stocks/' . rawurlencode( sml_tfr_slug( $symbol ) ) . '/' );
}

add_filter( 'query_vars', static function ( $vars ) {
	$vars[] = 'sml_tradingfloor_symbol';
	return $vars;
} );

add_action( 'init', static function () {
	add_rewrite_rule( '^tradingfloor/([A-Za-z0-9.\-]{1,16})/?$', 'index.php?page_id=' . SML_TFR_TERMINAL_PAGE_ID . '&sml_tradingfloor_symbol=$matches[1]', 'top' );
}, 7 );

register_activation_hook( __FILE__, static function () {
	add_rewrite_rule( '^tradingfloor/([A-Za-z0-9.\-]{1,16})/?$', 'index.php?page_id=' . SML_TFR_TERMINAL_PAGE_ID . '&sml_tradingfloor_symbol=$matches[1]', 'top' );
	flush_rewrite_rules( false );
} );

register_deactivation_hook( __FILE__, static function () {
	flush_rewrite_rules( false );
} );

add_action( 'parse_request', static function ( $wp ) {
	if ( empty( $wp->query_vars['sml_tradingfloor_symbol'] ) ) { return; }
	$symbol = sml_tfr_normalize_symbol( $wp->query_vars['sml_tradingfloor_symbol'] );
	if ( $symbol ) { $_GET['symbol'] = $symbol; }
}, 1 );

add_filter( 'redirect_canonical', static function ( $redirect ) {
	return sml_tfr_path_symbol( 'tradingfloor' ) ? false : $redirect;
}, 99 );

function sml_tfr_legacy_stock_chart_symbol() {
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$path = '/' . trim( (string) wp_parse_url( $uri, PHP_URL_PATH ), '/' ) . '/';
	if ( '/stock-chart/' !== $path ) { return ''; }
	return sml_tfr_normalize_symbol( isset( $_GET['symbol'] ) ? wp_unslash( $_GET['symbol'] ) : 'SPY' );
}

function sml_tfr_terminal_name( $symbol ) {
	if ( class_exists( 'SML_KG_DB' ) && method_exists( 'SML_KG_DB', 'ticker_by_slug' ) ) {
		$ticker = SML_KG_DB::ticker_by_slug( sml_tfr_slug( $symbol ) );
		if ( is_array( $ticker ) && ! empty( $ticker['name'] ) ) { return sanitize_text_field( $ticker['name'] ); }
	}
	return $symbol;
}

function sml_tfr_terminal_title() {
	$symbol = sml_tfr_tradingfloor_symbol();
	if ( ! $symbol ) { return ''; }
	return sprintf( '%s TradingFloor: Live Chart, Alerts and Trader Discussion | Stock Market Loop', $symbol );
}

function sml_tfr_terminal_description() {
	$symbol = sml_tfr_tradingfloor_symbol();
	if ( ! $symbol ) { return ''; }
	$name = sml_tfr_terminal_name( $symbol );
	return sprintf( 'Open the %s (%s) TradingFloor for interactive charts, market alerts, technical tools and real-time trader discussion on Stock Market Loop.', $name, $symbol );
}

function sml_tfr_rewrite_terminal_html( $html ) {
	$symbol = sml_tfr_tradingfloor_symbol();
	if ( ! is_string( $html ) || ! $symbol ) { return $html; }
	$search = '?symbol=' . rawurlencode( $symbol );
	/* location["search"] (not location.search) inside the shim: the rewrite below turns every bare location.search into the routed one, which made this check fail for any URL with a query string (?utm_source, ?cb) and the Options tab fell back to SPY. The path symbol is added to the real query instead of replacing it. */
	$shim   = '<script id="sml-tradingfloor-path-symbol">(function(){var symbol=' . wp_json_encode( $symbol ) . ',search=' . wp_json_encode( $search ) . ';window.__smlTradingFloorSymbol=symbol;window.__smlTradingFloorSearch=search;var Native=window.URLSearchParams;if(!Native||window.__smlTradingFloorParamsWrapped)return;window.__smlTradingFloorParamsWrapped=1;function RoutedParams(init){if((init===location["search"]||init==="")&&String(init||"").indexOf("symbol=")<0){var p=new Native(init);p.set("symbol",symbol);return p;}return new Native(init);}RoutedParams.prototype=Native.prototype;try{Object.setPrototypeOf(RoutedParams,Native);}catch(e){}window.URLSearchParams=RoutedParams;}());</script>';
	if ( false === strpos( $html, 'id="sml-tradingfloor-path-symbol"' ) ) {
		$html = preg_replace( '/<head(\s[^>]*)?>/i', '$0' . $shim, $html, 1 );
	}
	$html = str_replace( 'window.location.search', '(window.__smlTradingFloorSearch||window.location.search)', $html );
	$html = preg_replace( '/(?<![A-Za-z0-9_.])location\.search/', '(window.__smlTradingFloorSearch||location.search)', $html );
	$html = preg_replace_callback(
		'#(?:https?://stockmarketloop\.com)?/stock-chart/\?symbol=([A-Za-z0-9.\-]{1,16})#i',
		static function ( $match ) { return esc_url( sml_tfr_floor_url( $match[1] ) ); },
		$html
	);
	return $html;
}

function sml_tfr_tv2_clean_active() {
	if ( ! sml_tfr_tradingfloor_symbol() ) { return false; }
	if ( isset( $_GET['tv2'] ) && '0' === (string) $_GET['tv2'] ) { return false; }
	if ( isset( $_GET['tv2clean'] ) && '0' === (string) $_GET['tv2clean'] ) { return false; }
	return true;
}

/* The existing V2 loader intentionally recognizes only /stock-chart/. Mirror
 * its proven hooks for clean /tradingfloor/{ticker}/ requests without changing
 * the legacy loader or running either path twice. */
add_filter( 'the_content', static function ( $html ) {
	if ( ! sml_tfr_tv2_clean_active() || ! in_the_loop() || ! function_exists( 'sml_tv2_strip_terminal' ) ) { return $html; }
	return sml_tv2_strip_terminal( $html );
}, 100 );

add_filter( 'sml_pp_strip_script_ids', static function ( $ids ) {
	if ( ! sml_tfr_tv2_clean_active() || ! function_exists( 'sml_tv2_clean_strip_ids' ) ) { return $ids; }
	return array_merge( (array) $ids, sml_tv2_clean_strip_ids() );
}, 100 );

add_filter( 'body_class', static function ( $classes ) {
	if ( sml_tfr_tradingfloor_symbol() ) {
		$classes[] = 'sml-tradingfloor-route';
		$classes[] = 'tv2-live';
		if ( sml_tfr_tv2_clean_active() ) { $classes[] = 'tv2-clean'; }
	}
	return array_values( array_unique( $classes ) );
}, 100 );

add_action( 'wp_enqueue_scripts', static function () {
	if ( ! sml_tfr_tradingfloor_symbol() ) { return; }
	$ref  = function_exists( 'sml_tv2_live_ref' ) ? sml_tv2_live_ref() : 'main';
	$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( $ref ) . '/';
	wp_enqueue_style( 'sml-tv2', $base . 'css/terminal-v2.css', array(), null );
	wp_enqueue_script( 'sml-tv2-shell', $base . 'js/terminal-shell.js', array(), null, true );
}, 21 );

add_action( 'wp_footer', static function () {
	if ( ! sml_tfr_tradingfloor_symbol() ) { return; }
	echo '<script>window.SML_TV2_LIVE=1;' . ( sml_tfr_tv2_clean_active() ? 'window.SML_TV2_CLEAN=1;' : '' ) . '</script>';
	echo '<div id="sml-tv2-root" aria-label="Ticker Terminal"></div>';
}, 5 );

add_action( 'template_redirect', static function () {
	$stock_symbol = sml_tfr_path_symbol( 'stocks' );
	if ( $stock_symbol && isset( $_GET['symbol'] ) ) {
		wp_safe_redirect( sml_tfr_stock_url( $stock_symbol ), 301, 'SML TradingFloor Routes' );
		exit;
	}

	$legacy = sml_tfr_legacy_stock_chart_symbol();
	if ( $legacy ) {
		wp_safe_redirect( sml_tfr_floor_url( $legacy ), 301, 'SML TradingFloor Routes' );
		exit;
	}

	$symbol = sml_tfr_tradingfloor_symbol();
	if ( ! $symbol ) { return; }
	if ( ! sml_tfr_symbol_exists( $symbol ) ) {
		global $wp_query;
		$wp_query->set_404();
		status_header( 404 );
		nocache_headers();
		return;
	}
	if ( sml_tfr_tv2_clean_active() && function_exists( 'sml_tv2_clean_ob' ) ) {
		ob_start( 'sml_tv2_clean_ob' );
	}
	ob_start( 'sml_tfr_rewrite_terminal_html' );
}, 0 );

add_filter( 'document_title_parts', static function ( $parts ) {
	$title = sml_tfr_terminal_title();
	if ( $title ) {
		$parts['title'] = preg_replace( '/\s*\|\s*Stock Market Loop$/', '', $title );
		unset( $parts['tagline'] );
	}
	return $parts;
}, 99 );

add_filter( 'rank_math/frontend/title', static function ( $title ) {
	return sml_tfr_terminal_title() ?: $title;
}, 99 );

add_filter( 'rank_math/frontend/description', static function ( $description ) {
	return sml_tfr_terminal_description() ?: $description;
}, 99 );

add_filter( 'rank_math/frontend/canonical', static function ( $canonical ) {
	$symbol = sml_tfr_tradingfloor_symbol();
	return $symbol ? sml_tfr_floor_url( $symbol ) : $canonical;
}, 99 );

add_filter( 'rank_math/opengraph/facebook/title', static function ( $title ) {
	return sml_tfr_terminal_title() ?: $title;
}, 99 );
add_filter( 'rank_math/opengraph/facebook/description', static function ( $description ) {
	return sml_tfr_terminal_description() ?: $description;
}, 99 );
add_filter( 'rank_math/opengraph/facebook/url', static function ( $url ) {
	$symbol = sml_tfr_tradingfloor_symbol();
	return $symbol ? sml_tfr_floor_url( $symbol ) : $url;
}, 99 );
add_filter( 'rank_math/opengraph/twitter/title', static function ( $title ) {
	return sml_tfr_terminal_title() ?: $title;
}, 99 );
add_filter( 'rank_math/opengraph/twitter/description', static function ( $description ) {
	return sml_tfr_terminal_description() ?: $description;
}, 99 );

add_filter( 'rank_math/json_ld', static function ( $data ) {
	$symbol = sml_tfr_tradingfloor_symbol();
	if ( ! $symbol || is_404() ) { return $data; }
	$url  = sml_tfr_floor_url( $symbol );
	$name = sml_tfr_terminal_name( $symbol );
	$data['smlTradingFloor'] = array(
		'@type'               => 'WebApplication',
		'@id'                 => $url . '#application',
		'name'                => $symbol . ' TradingFloor',
		'url'                 => $url,
		'description'         => sml_tfr_terminal_description(),
		'applicationCategory' => 'FinanceApplication',
		'operatingSystem'     => 'Web',
		'isAccessibleForFree' => true,
		'about'               => array(
			'@type'        => 'Corporation',
			'name'         => $name,
			'tickerSymbol' => $symbol,
			'url'          => sml_tfr_stock_url( $symbol ),
		),
	);
	return $data;
}, 99 );
