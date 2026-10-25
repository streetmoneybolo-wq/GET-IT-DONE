<?php
/**
 * Server-side capture: PHP warnings and fatals, REST failures and latency, 404s, and the time, queries and memory each
 * request took. Nothing here changes how a request is answered; every hook records and steps aside.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

$GLOBALS['sml_wd_req'] = array( 'php_errors' => 0, 'rest_route' => '', 'rest_t0' => 0.0 );

/* PHP warnings, notices and deprecations: recorded with the file and line, then handed back to PHP (return false keeps the default handling). */
set_error_handler( 'sml_wd_php_error_handler', E_WARNING | E_NOTICE | E_USER_WARNING | E_USER_NOTICE | E_DEPRECATED | E_USER_DEPRECATED | E_RECOVERABLE_ERROR );
function sml_wd_php_error_handler( $errno, $errstr, $errfile = '', $errline = 0 ) {
	if ( ! ( error_reporting() & $errno ) ) { return false; }
	if ( $GLOBALS['sml_wd_req']['php_errors'] >= 12 ) { return false; }
	if ( false !== strpos( (string) $errfile, 'sml-website-dev' ) ) { return false; }
	$GLOBALS['sml_wd_req']['php_errors']++;
	$file = sml_wd_short_file( $errfile );
	$level = in_array( $errno, array( E_DEPRECATED, E_USER_DEPRECATED, E_NOTICE, E_USER_NOTICE ), true ) ? 'warn' : 'error';
	sml_wd_record( array( 'kind' => 'php_error', 'level' => $level, 'url' => sml_wd_current_path(), 'route' => sml_wd_current_route(), 'message' => $file . ':' . (int) $errline . ' ' . $errstr, 'meta' => array( 'errno' => $errno, 'file' => $file, 'line' => (int) $errline ) ) );
	return false;
}
function sml_wd_short_file( $f ) {
	$f = (string) $f;
	foreach ( array( WP_PLUGIN_DIR . '/', WPMU_PLUGIN_DIR . '/', get_theme_root() . '/', ABSPATH ) as $root ) { if ( $root && 0 === strpos( $f, $root ) ) { return substr( $f, strlen( $root ) ); } }
	return basename( $f );
}
function sml_wd_current_path() { return sml_wd_path( isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '/' ); }
function sml_wd_current_route() {
	if ( ! empty( $GLOBALS['sml_wd_req']['rest_route'] ) ) { return $GLOBALS['sml_wd_req']['rest_route']; }
	if ( wp_doing_cron() ) { return 'cron'; }
	if ( wp_doing_ajax() ) { return 'admin-ajax' . ( isset( $_REQUEST['action'] ) ? ':' . sanitize_key( (string) $_REQUEST['action'] ) : '' ); } // phpcs:ignore
	return sml_wd_route_key( sml_wd_current_path() );
}

/* REST: the route key is set as dispatch starts, the outcome and latency are recorded after the callback. */
add_filter( 'rest_pre_dispatch', function ( $result, $server, $request ) {
	$GLOBALS['sml_wd_req']['rest_route'] = sml_wd_route_key( '/wp-json' . $request->get_route() );
	$GLOBALS['sml_wd_req']['rest_t0'] = microtime( true );
	return $result;
}, 1, 3 );
add_filter( 'rest_request_after_callbacks', function ( $response, $handler, $request ) {
	$route = sml_wd_route_key( '/wp-json' . $request->get_route() );
	if ( 0 === strpos( $route, SML_WD_NS ) ) { return $response; }
	$ms = $GLOBALS['sml_wd_req']['rest_t0'] ? (int) round( ( microtime( true ) - $GLOBALS['sml_wd_req']['rest_t0'] ) * 1000 ) : 0;
	$status = 200; $code = ''; $msg = '';
	if ( is_wp_error( $response ) ) { $d = $response->get_error_data(); $status = is_array( $d ) && isset( $d['status'] ) ? (int) $d['status'] : 500; $code = (string) $response->get_error_code(); $msg = (string) $response->get_error_message(); }
	elseif ( $response instanceof WP_REST_Response ) { $status = (int) $response->get_status(); if ( $status >= 400 ) { $d = $response->get_data(); $code = is_array( $d ) && isset( $d['code'] ) ? (string) $d['code'] : ''; $msg = is_array( $d ) && isset( $d['message'] ) ? (string) $d['message'] : ''; } }
	/* 401/403/404 are the API saying no, not the API breaking; 5xx and anything slow are recorded */
	if ( $status >= 500 || ( $status >= 400 && ! in_array( $status, array( 401, 403, 404 ), true ) ) ) {
		sml_wd_record( array( 'kind' => 'rest_error', 'level' => $status >= 500 ? 'error' : 'warn', 'url' => sml_wd_current_path(), 'route' => $route, 'message' => 'HTTP ' . $status . ( $code ? ' ' . $code : '' ) . ( $msg ? ': ' . $msg : '' ), 'meta' => array( 'status' => $status, 'method' => $request->get_method(), 'ms' => $ms ) ) );
	}
	if ( $ms > 0 && ( $status >= 500 || $ms > 400 || sml_wd_sampled() ) ) {
		sml_wd_record( array( 'kind' => 'rest_timing', 'level' => 'info', 'url' => sml_wd_current_path(), 'route' => $route, 'message' => 'rest', 'meta' => array( 'ms' => $ms, 'status' => $status, 'method' => $request->get_method() ) ) );
	}
	return $response;
}, 99, 3 );

/* 404s on the front end, with the page that linked here when the browser says. */
add_action( 'template_redirect', function () {
	if ( ! is_404() ) { return; }
	$path = sml_wd_current_path();
	if ( preg_match( '~\.(php|env|git|sql|bak|zip|aspx|asp|cgi|xmlrpc)~i', $path ) || preg_match( '~^/(wp-admin|wp-includes|\.well-known|cgi-bin|vendor)~', $path ) ) { return; }
	$ref = isset( $_SERVER['HTTP_REFERER'] ) ? (string) $_SERVER['HTTP_REFERER'] : '';
	$ref_host = $ref ? wp_parse_url( $ref, PHP_URL_HOST ) : '';
	sml_wd_record( array( 'kind' => 'http_404', 'level' => 'warn', 'url' => $path, 'route' => sml_wd_route_key( $path ), 'message' => '404 ' . $path, 'meta' => array( 'referer' => $ref_host && $ref_host === wp_parse_url( home_url(), PHP_URL_HOST ) ? sml_wd_path( $ref ) : ( $ref_host ? 'external:' . $ref_host : '' ) ) ) );
}, 1 );

/* Fatal errors and request timing, on shutdown. */
register_shutdown_function( 'sml_wd_shutdown' );
function sml_wd_shutdown() {
	$err = error_get_last();
	if ( $err && in_array( $err['type'], array( E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR ), true ) ) {
		$file = sml_wd_short_file( $err['file'] );
		sml_wd_record( array( 'kind' => 'php_fatal', 'level' => 'error', 'url' => sml_wd_current_path(), 'route' => sml_wd_current_route(), 'message' => $file . ':' . (int) $err['line'] . ' ' . substr( (string) $err['message'], 0, 400 ), 'meta' => array( 'file' => $file, 'line' => (int) $err['line'] ) ) );
	}
	if ( wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || wp_doing_ajax() ) { return; }
	if ( is_admin() && ! sml_wd_can() ) { return; }
	$ms = (int) round( (float) timer_stop( 0, 4 ) * 1000 );
	if ( $ms <= 0 ) { return; }
	/* every admin page view, every slow page, and a sample of the rest */
	if ( ! ( $ms > 1500 || sml_wd_can() || sml_wd_sampled() ) ) { return; }
	$path = sml_wd_current_path();
	sml_wd_record( array( 'kind' => 'timing', 'level' => 'info', 'url' => $path, 'route' => is_admin() ? 'wp-admin' : sml_wd_route_key( $path ), 'message' => 'page', 'meta' => array( 'ms' => $ms, 'queries' => (int) get_num_queries(), 'mem' => (int) memory_get_peak_usage( true ), 'is404' => function_exists( 'is_404' ) && is_404(), 'logged' => is_user_logged_in() ) ) );
}

/** One in N requests, N from the beacon sample-rate knob. */
function sml_wd_sampled() {
	$rate = (int) sml_wd_knob( 'beaconSampleRate' );
	return wp_rand( 1, 100 ) <= max( 1, $rate );
}
