<?php
/**
 * Signed server-to-server call to the Academy platform. Uses the same base URL and secret as the billing bridge
 * (SML_PLATFORM_BILLING_API_SECRET / SML_PLATFORM_BILLING_BASE_URL), so nothing new has to be configured on the site.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sml_gpro_base_url() {
	if ( function_exists( 'sml_platform_billing_base_url' ) ) {
		return rtrim( (string) sml_platform_billing_base_url(), '/' );
	}
	return defined( 'SML_PLATFORM_BILLING_BASE_URL' ) ? rtrim( (string) SML_PLATFORM_BILLING_BASE_URL, '/' ) : '';
}

function sml_gpro_secret() {
	if ( function_exists( 'sml_platform_billing_api_secret' ) ) {
		return trim( (string) sml_platform_billing_api_secret() );
	}
	return defined( 'SML_PLATFORM_BILLING_API_SECRET' ) ? trim( (string) SML_PLATFORM_BILLING_API_SECRET ) : '';
}

/** Pure: the signature the platform checks, `timestamp.body` under HMAC-SHA256. */
function sml_gpro_signature( $timestamp, $body, $secret ) {
	return hash_hmac( 'sha256', $timestamp . '.' . $body, $secret );
}

/** Pure: shapes the request body, whitelisting what is sent. */
function sml_gpro_payload( $tool, $group_id, $symbol, $symbols, $params, $preview ) {
	$payload = array(
		'tool'    => sanitize_key( $tool ),
		'groupId' => absint( $group_id ),
		'preview' => (bool) $preview,
		'params'  => new stdClass(),
	);
	if ( '' !== $symbol ) {
		$payload['symbol'] = $symbol;
	}
	if ( is_array( $symbols ) && $symbols ) {
		$payload['symbols'] = array_values( $symbols );
	}
	$clean = array();
	foreach ( array( 'view' ) as $k ) {
		if ( isset( $params[ $k ] ) && in_array( $params[ $k ], array( 'bullish', 'bearish', 'neutral' ), true ) ) {
			$clean[ $k ] = $params[ $k ];
		}
	}
	foreach ( array( 'horizonDays', 'shares', 'cost' ) as $k ) {
		if ( isset( $params[ $k ] ) && is_numeric( $params[ $k ] ) && (float) $params[ $k ] > 0 ) {
			$clean[ $k ] = (float) $params[ $k ];
		}
	}
	if ( $clean ) {
		$payload['params'] = $clean;
	}
	return $payload;
}

function sml_gpro_call( $payload ) {
	$base   = sml_gpro_base_url();
	$secret = sml_gpro_secret();
	if ( '' === $base || '' === $secret ) {
		return new WP_Error( 'gpro_unconfigured', 'The Academy data service is not connected to this site yet.', array( 'status' => 503 ) );
	}
	$body      = wp_json_encode( $payload );
	$timestamp = (string) time();
	$response  = wp_remote_post( $base . '/v1/group-tools/run', array(
		'timeout' => 25,
		'headers' => array(
			'Content-Type'    => 'application/json',
			'X-SML-Timestamp' => $timestamp,
			'X-SML-Signature' => sml_gpro_signature( $timestamp, $body, $secret ),
		),
		'body'    => $body,
	) );
	if ( is_wp_error( $response ) ) {
		return new WP_Error( 'gpro_unreachable', 'The Academy data service did not answer. Try again in a moment.', array( 'status' => 503 ) );
	}
	$code   = (int) wp_remote_retrieve_response_code( $response );
	$result = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( 429 === $code ) {
		return new WP_Error( 'gpro_busy', 'Too many requests right now. Try again in a few seconds.', array( 'status' => 429 ) );
	}
	if ( $code >= 300 || ! is_array( $result ) || empty( $result['ok'] ) ) {
		$msg = 400 === $code ? 'That request was not valid.' : 'The tool is temporarily unavailable.';
		return new WP_Error( 'gpro_failed', $msg, array( 'status' => 400 === $code ? 400 : 503 ) );
	}
	return $result;
}
