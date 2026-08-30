<?php
/**
 * Plugin Name: SML Platform Billing Bridge
 * Description: Signed bridge between WordPress, the Render billing service, Loop Bucks, and group access.
 * Version: 0.2.0
 * Author: Stock Market Loop
 */

defined( 'ABSPATH' ) || exit;

function sml_platform_billing_table() {
	global $wpdb;
	return $wpdb->prefix . 'sml_platform_billing_events';
}

register_activation_hook( __FILE__, function () {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$table = sml_platform_billing_table();
	$charset = $wpdb->get_charset_collate();
	dbDelta( "CREATE TABLE {$table} (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		source_key varchar(191) NOT NULL,
		intent_type varchar(80) NOT NULL,
		processed_at datetime NOT NULL,
		PRIMARY KEY (id),
		UNIQUE KEY source_key (source_key)
	) {$charset};" );
} );

function sml_platform_billing_secret() {
	return defined( 'SML_PLATFORM_BILLING_BRIDGE_SECRET' )
		? trim( (string) SML_PLATFORM_BILLING_BRIDGE_SECRET ) : '';
}

function sml_platform_billing_api_secret() {
	return defined( 'SML_PLATFORM_BILLING_API_SECRET' )
		? trim( (string) SML_PLATFORM_BILLING_API_SECRET ) : '';
}

function sml_platform_billing_base_url() {
	return defined( 'SML_PLATFORM_API_URL' )
		? untrailingslashit( (string) SML_PLATFORM_API_URL ) : '';
}

function sml_platform_billing_signature( $timestamp, $body, $secret ) {
	return hash_hmac( 'sha256', $timestamp . '.' . $body, $secret );
}

function sml_platform_billing_verify_request( WP_REST_Request $request ) {
	$secret = sml_platform_billing_secret();
	if ( '' === $secret ) return new WP_Error( 'billing_unconfigured', 'Billing bridge is not configured.', array( 'status' => 503 ) );
	$timestamp = (string) $request->get_header( 'x-sml-timestamp' );
	$signature = strtolower( (string) $request->get_header( 'x-sml-signature' ) );
	if ( ! ctype_digit( $timestamp ) || abs( time() - (int) $timestamp ) > 300 ) {
		return new WP_Error( 'billing_timestamp', 'Expired billing request.', array( 'status' => 401 ) );
	}
	$expected = sml_platform_billing_signature( $timestamp, $request->get_body(), $secret );
	if ( ! preg_match( '/^[a-f0-9]{64}$/', $signature ) || ! hash_equals( $expected, $signature ) ) {
		return new WP_Error( 'billing_signature', 'Invalid billing signature.', array( 'status' => 401 ) );
	}
	return true;
}

function sml_platform_billing_process_outbox( WP_REST_Request $request ) {
	$verified = sml_platform_billing_verify_request( $request );
	if ( is_wp_error( $verified ) ) return $verified;
	$payload = json_decode( $request->get_body(), true );
	$source = isset( $payload['sourceKey'] ) ? sanitize_text_field( $payload['sourceKey'] ) : '';
	$intent = isset( $payload['intentType'] ) ? sanitize_key( $payload['intentType'] ) : '';
	$data = isset( $payload['data'] ) && is_array( $payload['data'] ) ? $payload['data'] : array();
	if ( '' === $source || '' === $intent ) return new WP_Error( 'billing_payload', 'Invalid billing payload.', array( 'status' => 400 ) );

	global $wpdb;
	$table = sml_platform_billing_table();
	$seen = $wpdb->get_var( $wpdb->prepare( "SELECT source_key FROM {$table} WHERE source_key = %s", $source ) );
	if ( $seen ) return rest_ensure_response( array( 'ok' => true, 'status' => 'duplicate' ) );

	if ( 'loop_bucks_credit' === $intent ) {
		if ( ! function_exists( 'sml_lb_move' ) ) return new WP_Error( 'wallet_unavailable', 'Loop Bucks engine unavailable.', array( 'status' => 503 ) );
		$user_id = isset( $data['userId'] ) ? absint( $data['userId'] ) : 0;
		$amount = isset( $data['loopBucks'] ) ? absint( $data['loopBucks'] ) : 0;
		if ( ! $user_id || ! $amount ) return new WP_Error( 'wallet_payload', 'Invalid wallet credit.', array( 'status' => 400 ) );
		$moved = sml_lb_move( $user_id, $amount, 'store_topup', $source, array(
			'order_key' => isset( $data['orderKey'] ) ? sanitize_text_field( $data['orderKey'] ) : '',
			'provider' => 'stripe',
		) );
		if ( false === $moved || is_wp_error( $moved ) ) return new WP_Error( 'wallet_failed', 'Wallet credit failed.', array( 'status' => 503 ) );
	} elseif ( 'subscription_access_reconcile' === $intent ) {
		if ( ! has_action( 'sml_platform_subscription_access_reconcile' ) ) {
			return new WP_Error( 'membership_adapter_missing', 'Membership adapter unavailable.', array( 'status' => 503 ) );
		}
		do_action( 'sml_platform_subscription_access_reconcile', $data, $source );
	} elseif ( 'cancel_external_subscription' === $intent ) {
		if ( ! has_action( 'sml_platform_cancel_external_subscription' ) ) {
			return new WP_Error( 'external_cancel_adapter_missing', 'External subscription adapter unavailable.', array( 'status' => 503 ) );
		}
		do_action( 'sml_platform_cancel_external_subscription', $data, $source );
	} elseif ( 'subscription_notify' === $intent ) {
		if ( ! has_action( 'sml_platform_subscription_notify' ) ) {
			return new WP_Error( 'subscription_notify_adapter_missing', 'Subscription notification adapter unavailable.', array( 'status' => 503 ) );
		}
		do_action( 'sml_platform_subscription_notify', $data, $source );
	} else {
		return new WP_Error( 'billing_intent', 'Unsupported billing intent.', array( 'status' => 400 ) );
	}

	$inserted = $wpdb->query( $wpdb->prepare(
		"INSERT IGNORE INTO {$table} (source_key, intent_type, processed_at) VALUES (%s,%s,%s)",
		$source, $intent, current_time( 'mysql', true )
	) );
	if ( false === $inserted ) return new WP_Error( 'billing_ledger', 'Could not record billing event.', array( 'status' => 503 ) );
	return rest_ensure_response( array( 'ok' => true, 'status' => 'processed' ) );
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-platform/v1', '/billing-outbox', array(
		'methods' => 'POST',
		'callback' => 'sml_platform_billing_process_outbox',
		'permission_callback' => '__return_true',
	) );
} );

/** Server-to-server billing call. Do not invoke this directly from browser JS. */
function sml_platform_billing_call( $path, array $data ) {
	$base = sml_platform_billing_base_url();
	$secret = sml_platform_billing_api_secret();
	if ( '' === $base || '' === $secret ) return new WP_Error( 'billing_unconfigured', 'Billing API is not configured.' );
	$body = wp_json_encode( $data );
	$timestamp = (string) time();
	$response = wp_remote_post( $base . $path, array(
		'timeout' => 20,
		'headers' => array(
			'Content-Type' => 'application/json',
			'X-SML-Timestamp' => $timestamp,
			'X-SML-Signature' => sml_platform_billing_signature( $timestamp, $body, $secret ),
		),
		'body' => $body,
	) );
	if ( is_wp_error( $response ) ) return $response;
	$result = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( wp_remote_retrieve_response_code( $response ) >= 300 || empty( $result['ok'] ) ) {
		return new WP_Error( 'billing_api_failed', 'Billing service could not complete the request.' );
	}
	return $result;
}

function sml_platform_loop_bucks_checkout( $user_id, $package_slug, $success_url, $cancel_url ) {
	return sml_platform_billing_call( '/v1/billing/loop-bucks/checkout', array(
		'userId' => absint( $user_id ), 'packageSlug' => sanitize_key( $package_slug ),
		'successUrl' => esc_url_raw( $success_url ), 'cancelUrl' => esc_url_raw( $cancel_url ),
	) );
}

function sml_platform_membership_checkout( array $data ) {
	return sml_platform_billing_call( '/v1/billing/memberships/checkout', $data );
}

function sml_platform_seller_onboarding( array $data ) {
	return sml_platform_billing_call( '/v1/billing/sellers/onboard', $data );
}

function sml_platform_verify_imported_renewal( array $provider_verified_data ) {
	return sml_platform_billing_call( '/v1/billing/migrations/verify-renewal', $provider_verified_data );
}
