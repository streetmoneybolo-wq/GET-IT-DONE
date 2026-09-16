<?php
/**
 * Plugin Name: SML TradingFloor Options Feed
 * Description: Makes the TradingFloor / Ticker Terminal "Options" tab load: /sml-members/v1/market-data/options is answered from the live moomoo option chain (sml-options-intelligence) instead of Massive, whose plan does not include options. Also sends the bare /tradingfloor URL to a ticker.
 * Version: 1.0.0
 * Author: StockMarketLoop
 *
 * WHY (2026-09-16): the Options tab (GET-IT-DONE js/terminal-options.js) calls
 * /sml-members/v1/market-data/options. Snippet #5784 tries a push-synced moomoo cache first
 * ("Moomoo options have not been synced for this symbol yet" — the pusher no longer runs),
 * then the route falls through to Massive, which answers 403 "The market-data plan does not
 * authorize this dataset". Every symbol, every time: the tab never showed a chain.
 *
 * The site's working chain is /sml-options-intelligence/v1/chain (moomoo OpenD via the
 * bridge, used by the Analyst Dashboard). It already returns the same shape the tab reads
 * — underlying, expiration, expirations[], contracts[{type, strike, bid, ask, last, volume,
 * open_interest, iv}] with IV already a decimal (0.54 = 54%), exactly what the tab reads.
 * If it ever hands back an expired expiration while future ones exist (a stale cache), the
 * nearest future expiration is requested instead. That chain is for signed-in members, so it stays that way here; signed-out
 * visitors get a clear sign-in message (the tab already adds "Signed-in members may have
 * access to this chain").
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

add_filter( 'rest_pre_dispatch', function ( $result, $server, $request ) {
	if ( null !== $result || ! $request instanceof WP_REST_Request ) return $result;
	if ( '/sml-members/v1/market-data/options' !== $request->get_route() ) return $result;

	$key = spl_object_id( $request );
	/* The tab fetches with the login cookie but no REST nonce, so WordPress treats the
	   request as signed out. For this read-only data, a valid logged-in cookie is enough. */
	$uid = get_current_user_id();
	if ( ! $uid && defined( 'LOGGED_IN_COOKIE' ) && ! empty( $_COOKIE[ LOGGED_IN_COOKIE ] ) ) {
		$uid = (int) wp_validate_auth_cookie( $_COOKIE[ LOGGED_IN_COOKIE ], 'logged_in' );
	}
	if ( ! $uid ) {
		return $GLOBALS['sml_tfo_responses'][ $key ] = new WP_Error( 'sml_tfo_signin', 'Sign in to see the live options chain.', array( 'status' => 401 ) );
	}
	$previous_user = get_current_user_id();
	if ( $previous_user !== $uid ) wp_set_current_user( $uid );

	$chain = new WP_REST_Request( 'GET', '/sml-options-intelligence/v1/chain' );
	$chain->set_param( 'symbol', strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $request->get_param( 'symbol' ) ) ) ?: 'SPY' );
	$exp = (string) $request->get_param( 'expiration' );
	if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $exp ) ) $chain->set_param( 'expiration', $exp );

	$res  = rest_do_request( $chain );
	$data = $res->get_data();
	$today = ( new DateTimeImmutable( 'now', new DateTimeZone( 'America/New_York' ) ) )->format( 'Y-m-d' );
	/* A cold chain cache can hand back an old fallback payload (expired date, zero prices).
	   Ask for a real upcoming expiration instead: one the payload lists, else the next
	   trading day, else the next Friday. Never show an expired chain. */
	$stale = function ( $d ) use ( $today ) {
		return ! is_array( $d ) || empty( $d['expiration'] ) || $d['expiration'] < $today || empty( $d['underlying'] ) || (float) $d['underlying'] <= 0;
	};
	if ( ! $res->is_error() && $stale( $data ) ) {
		$candidates = array();
		foreach ( (array) ( is_array( $data ) ? ( $data['expirations'] ?? array() ) : array() ) as $candidate ) {
			if ( is_string( $candidate ) && $candidate >= $today ) { $candidates[] = $candidate; break; }
		}
		$et = new DateTimeImmutable( 'now', new DateTimeZone( 'America/New_York' ) );
		$day = $et;
		while ( (int) $day->format( 'N' ) >= 6 ) $day = $day->modify( '+1 day' );
		$candidates[] = $day->format( 'Y-m-d' );
		$candidates[] = $et->modify( 'Friday this week' )->format( 'Y-m-d' ) >= $today ? $et->modify( 'Friday this week' )->format( 'Y-m-d' ) : $et->modify( 'next Friday' )->format( 'Y-m-d' );
		foreach ( array_slice( array_values( array_unique( $candidates ) ), 0, 3 ) as $candidate ) {
			$chain->set_param( 'expiration', $candidate );
			$res  = rest_do_request( $chain );
			$data = $res->get_data();
			if ( ! $res->is_error() && ! $stale( $data ) && ! empty( $data['contracts'] ) ) break;
		}
		if ( $stale( $data ) ) {
			if ( $previous_user !== $uid ) wp_set_current_user( $previous_user );
			return $GLOBALS['sml_tfo_responses'][ $key ] = new WP_Error( 'sml_tfo_unavailable', 'The live options chain is reconnecting. Try again in a moment.', array( 'status' => 503 ) );
		}
	}
	if ( $previous_user !== $uid ) wp_set_current_user( $previous_user );
	if ( $res->is_error() || ! is_array( $data ) || empty( $data['contracts'] ) ) {
		$message = is_array( $data ) && ! empty( $data['message'] ) ? (string) $data['message'] : 'The live options chain is reconnecting. Try again in a moment.';
		return $GLOBALS['sml_tfo_responses'][ $key ] = new WP_Error( 'sml_tfo_unavailable', $message, array( 'status' => 503 ) );
	}

	$contracts = array();
	foreach ( $data['contracts'] as $c ) {
		if ( ! is_array( $c ) || empty( $c['strike'] ) ) continue;
		$c['iv'] = isset( $c['iv'] ) && is_numeric( $c['iv'] ) && (float) $c['iv'] > 0 ? (float) $c['iv'] : 0;
		$contracts[] = $c;
	}

	$out = array(
		'symbol'      => (string) ( $data['symbol'] ?? '' ),
		'underlying'  => isset( $data['underlying'] ) ? (float) $data['underlying'] : null,
		'expiration'  => (string) ( $data['expiration'] ?? '' ),
		'expirations' => array_values( (array) ( $data['expirations'] ?? array() ) ),
		'contracts'   => $contracts,
		'count'       => count( $contracts ),
		'freshness'   => (string) ( $data['freshness'] ?? '' ),
		'updated_iso' => (string) ( $data['updated_iso'] ?? '' ),
		'notice'      => 'Market data only. Not investment advice.',
	);
	$response = rest_ensure_response( $out );
	$response->header( 'Cache-Control', 'no-store, private' );
	$GLOBALS['sml_tfo_responses'][ $key ] = $response;
	return $response;
}, -100, 3 );   /* before the legacy moomoo push-cache handlers */

/* WPCode #5784 ("Moomoo Market Bridge") also answers this route on rest_pre_dispatch at
   priority 9 WITHOUT checking whether it was already answered, replacing the live chain with
   its old push-synced snapshot (SPY, 2026-07-20, zero prices). Re-assert right after it, and
   once more at the very end of dispatch for real HTTP requests. */
$sml_tfo_reassert = function ( $response, $server, $request ) {
	if ( ! $request instanceof WP_REST_Request || '/sml-members/v1/market-data/options' !== $request->get_route() ) return $response;
	$key = spl_object_id( $request );
	if ( ! empty( $GLOBALS['sml_tfo_responses'][ $key ] ) ) {
		$mine = $GLOBALS['sml_tfo_responses'][ $key ];
		unset( $GLOBALS['sml_tfo_responses'][ $key ] );
		return is_wp_error( $mine ) ? rest_convert_error_to_response( $mine ) : $mine;
	}
	return $response;
};
add_filter( 'rest_pre_dispatch', function ( $result, $server, $request ) use ( $sml_tfo_reassert ) {
	if ( ! $request instanceof WP_REST_Request || '/sml-members/v1/market-data/options' !== $request->get_route() ) return $result;
	$key = spl_object_id( $request );
	return ! empty( $GLOBALS['sml_tfo_responses'][ $key ] ) ? $GLOBALS['sml_tfo_responses'][ $key ] : $result;
}, 10, 3 );
add_filter( 'rest_post_dispatch', $sml_tfo_reassert, PHP_INT_MAX, 3 );

/* The bare /tradingfloor URL has no route (pages are /tradingfloor/{ticker}/). */
add_action( 'template_redirect', function () {
	$path = trim( (string) wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ), '/' );
	if ( 'tradingfloor' === $path ) {
		wp_safe_redirect( home_url( '/tradingfloor/SPY/' ), 302 );
		exit;
	}
}, -1000 );
