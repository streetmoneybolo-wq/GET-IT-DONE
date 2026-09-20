<?php
/**
 * Plugin Name: SML Academy Data Bridge
 * Description: Private, signed Academy access to existing Options and Earnings REST data. It never exposes those feeds to site visitors.
 * Version: 0.1.0
 * Requires PHP: 7.4
 */

defined( 'ABSPATH' ) || exit;

/**
 * Configuration belongs in wp-config.php or a host-level secret manager:
 * SML_ACADEMY_BRIDGE_SECRET: same 32+ character secret stored in Render.
 * SML_ACADEMY_SERVICE_USER_ID: a dedicated read-only site user allowed to read
 * the existing private market endpoints. Do not use an administrator account.
 */

if ( ! function_exists( 'sml_academy_bridge_secret' ) ) {
	function sml_academy_bridge_secret() {
		return defined( 'SML_ACADEMY_BRIDGE_SECRET' ) ? trim( (string) SML_ACADEMY_BRIDGE_SECRET ) : '';
	}
}

if ( ! function_exists( 'sml_academy_bridge_service_user_id' ) ) {
	function sml_academy_bridge_service_user_id() {
		return defined( 'SML_ACADEMY_SERVICE_USER_ID' ) ? absint( SML_ACADEMY_SERVICE_USER_ID ) : 0;
	}
}

if ( ! function_exists( 'sml_academy_bridge_authorize' ) ) {
	function sml_academy_bridge_authorize( WP_REST_Request $request ) {
		$secret    = sml_academy_bridge_secret();
		$timestamp = (string) $request->get_header( 'x-sml-academy-timestamp' );
		$provided  = (string) $request->get_header( 'x-sml-academy-signature' );
		$symbol    = strtoupper( preg_replace( '/[^A-Z0-9.:-]/', '', (string) $request->get_param( 'symbol' ) ) );
		if ( strlen( $secret ) < 32 || ! preg_match( '/^\d{10,12}$/', $timestamp ) || '' === $symbol ) {
			return new WP_Error( 'sml_academy_bridge_unauthorized', 'Unauthorized.', array( 'status' => 401 ) );
		}
		if ( abs( time() - (int) $timestamp ) > 60 ) {
			return new WP_Error( 'sml_academy_bridge_expired', 'Unauthorized.', array( 'status' => 401 ) );
		}
		$path     = '/wp-json' . $request->get_route() . '?symbol=' . rawurlencode( $symbol );
		$expected = 'sha256=' . hash_hmac( 'sha256', $timestamp . '.' . $path, $secret );
		if ( ! hash_equals( $expected, $provided ) ) {
			return new WP_Error( 'sml_academy_bridge_signature', 'Unauthorized.', array( 'status' => 401 ) );
		}
		return true;
	}
}

if ( ! function_exists( 'sml_academy_bridge_subrequest' ) ) {
	function sml_academy_bridge_subrequest( $route, $symbol ) {
		$service_user_id = sml_academy_bridge_service_user_id();
		if ( ! $service_user_id || ! get_user_by( 'id', $service_user_id ) ) {
			return new WP_Error( 'sml_academy_bridge_service_user', 'Academy data bridge is not configured.', array( 'status' => 503 ) );
		}
		$previous_user_id = get_current_user_id();
		wp_set_current_user( $service_user_id );
		try {
			$subrequest = new WP_REST_Request( WP_REST_Server::READABLE, $route );
			$subrequest->set_param( 'symbol', $symbol );
			$response = rest_do_request( $subrequest );
		} finally {
			wp_set_current_user( $previous_user_id );
		}
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$response = rest_ensure_response( $response );
		$status   = (int) $response->get_status();
		if ( $status < 200 || $status > 299 ) {
			return new WP_Error( 'sml_academy_bridge_source', 'Academy data is temporarily unavailable.', array( 'status' => 503 ) );
		}
		return $response->get_data();
	}
}

if ( ! function_exists( 'sml_academy_bridge_options' ) ) {
	function sml_academy_bridge_options( WP_REST_Request $request ) {
		$symbol = strtoupper( preg_replace( '/[^A-Z0-9.:-]/', '', (string) $request->get_param( 'symbol' ) ) );
		$data   = sml_academy_bridge_subrequest( '/sml-options-intelligence/v1/chain', $symbol );
		if ( is_wp_error( $data ) ) {
			return $data;
		}
		return new WP_REST_Response( array( 'ok' => true, 'symbol' => $symbol, 'data' => $data ), 200 );
	}
}

if ( ! function_exists( 'sml_academy_bridge_earnings' ) ) {
	function sml_academy_bridge_earnings( WP_REST_Request $request ) {
		$symbol = strtoupper( preg_replace( '/[^A-Z0-9.:-]/', '', (string) $request->get_param( 'symbol' ) ) );
		$data   = sml_academy_bridge_subrequest( '/sml/v1/earnings/symbol', $symbol );
		if ( is_wp_error( $data ) ) {
			// Older site builds expose the same data from this route.
			$data = sml_academy_bridge_subrequest( '/sml/v1/earnings/calendar', $symbol );
		}
		if ( is_wp_error( $data ) ) {
			return new WP_Error( 'sml_academy_bridge_earnings', 'Academy earnings data is temporarily unavailable.', array( 'status' => 503 ) );
		}
		return new WP_REST_Response( array( 'ok' => true, 'symbol' => $symbol, 'data' => $data ), 200 );
	}
}

add_action( 'rest_api_init', static function() {
	$arguments = array(
		'methods'             => WP_REST_Server::READABLE,
		'permission_callback' => 'sml_academy_bridge_authorize',
		'args'                => array(
			'symbol' => array(
				'required'          => true,
				'sanitize_callback' => static function( $value ) { return strtoupper( preg_replace( '/[^A-Z0-9.:-]/', '', (string) $value ) ); },
				'validate_callback' => static function( $value ) { return 1 === preg_match( '/^[A-Z0-9.:-]{1,12}$/', (string) $value ); },
			),
		),
	);
	register_rest_route( 'sml-academy-bridge/v1', '/options', array_merge( $arguments, array( 'callback' => 'sml_academy_bridge_options' ) ) );
	register_rest_route( 'sml-academy-bridge/v1', '/earnings', array_merge( $arguments, array( 'callback' => 'sml_academy_bridge_earnings' ) ) );
} );
