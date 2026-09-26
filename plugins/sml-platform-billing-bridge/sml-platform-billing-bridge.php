<?php
/**
 * Plugin Name: SML Platform Billing Bridge
 * Description: Signed bridge between WordPress, the Render billing service, Loop Bucks, and group access.
 * Version: 0.5.0
 * Author: Stock Market Loop
 */

defined( 'ABSPATH' ) || exit;

function sml_platform_billing_table() {
	global $wpdb;
	return $wpdb->prefix . 'sml_platform_billing_events';
}

function sml_platform_billing_grants_table() {
	global $wpdb;
	return $wpdb->prefix . 'sml_platform_membership_grants';
}

function sml_platform_billing_install() {
	if ( '0.4.1' === get_option( 'sml_platform_billing_bridge_version' ) ) return;
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
	$grants = sml_platform_billing_grants_table();
	dbDelta( "CREATE TABLE {$grants} (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		user_id bigint(20) unsigned NOT NULL,
		group_id bigint(20) unsigned NOT NULL,
		applied_role varchar(32) NOT NULL,
		prior_role varchar(32) NOT NULL DEFAULT '',
		created_member tinyint(1) NOT NULL DEFAULT 0,
		subscription_id bigint(20) unsigned NOT NULL,
		updated_at datetime NOT NULL,
		PRIMARY KEY (id),
		UNIQUE KEY group_user (group_id,user_id),
		KEY subscription_id (subscription_id)
	) {$charset};" );
	update_option( 'sml_platform_billing_bridge_version', '0.4.1', false );
}
register_activation_hook( __FILE__, 'sml_platform_billing_install' );
add_action( 'init', 'sml_platform_billing_install', 1 );

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
	} elseif ( 'dispute_notify' === $intent ) {
		if ( ! has_action( 'sml_platform_dispute_notify' ) ) {
			return new WP_Error( 'dispute_notify_adapter_missing', 'Dispute notification adapter unavailable.', array( 'status' => 503 ) );
		}
		do_action( 'sml_platform_dispute_notify', $data, $source );
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
		$message = isset( $result['message'] ) ? sanitize_text_field( $result['message'] ) : 'Billing service could not complete the request.';
		return new WP_Error( 'billing_api_failed', $message );
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

function sml_platform_group_plan_map() {
	if ( ! defined( 'SML_PLATFORM_GROUP_PLAN_MAP' ) ) return array();
	$map = json_decode( (string) SML_PLATFORM_GROUP_PLAN_MAP, true );
	if ( ! is_array( $map ) ) return array();
	return array_map( 'absint', $map );
}

function sml_platform_group_plan_id( $group_id ) {
	$map = sml_platform_group_plan_map();
	if ( isset( $map[ (string) absint( $group_id ) ] ) ) return absint( $map[ (string) absint( $group_id ) ] );
	// Owner-created products: the cheapest active one stands in for the legacy single plan.
	return sml_platform_first_active_plan_id( $group_id );
}

/** The group's owner (the marketplace seller whose Stripe account receives the payments). */
function sml_platform_group_owner_user_id( $group_id ) {
	global $wpdb;
	if ( ! function_exists( 'sml_dgc_tables' ) ) return 0;
	$tables = sml_dgc_tables();
	return absint( $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$tables['groups']} WHERE id=%d", absint( $group_id ) ) ) );
}

/** Owner-created membership products for a group, from the platform (array of plans, or WP_Error). */
function sml_platform_group_plans( $group_id, $include_archived = false ) {
	$result = sml_platform_billing_call( '/v1/billing/plans/list', array(
		'groupId' => absint( $group_id ), 'includeArchived' => (bool) $include_archived,
	) );
	if ( is_wp_error( $result ) ) return $result;
	return isset( $result['plans'] ) && is_array( $result['plans'] ) ? $result['plans'] : array();
}

function sml_platform_first_active_plan_id( $group_id ) {
	$group_id = absint( $group_id );
	if ( ! $group_id ) return 0;
	$key = 'sml_platform_plan_' . $group_id;
	$cached = get_transient( $key );
	if ( false !== $cached ) return absint( $cached );
	$plans = sml_platform_group_plans( $group_id );
	$id = 0;
	if ( ! is_wp_error( $plans ) ) {
		foreach ( $plans as $plan ) {
			if ( ! empty( $plan['active'] ) ) { $id = absint( $plan['id'] ); break; }
		}
	}
	set_transient( $key, $id, MINUTE_IN_SECONDS );
	return $id;
}

function sml_platform_group_context( $group_id ) {
	global $wpdb;
	$group_id = absint( $group_id );
	if ( ! $group_id || ! function_exists( 'sml_dgc_tables' ) || ! function_exists( 'sml_dgc_connector' ) ) return null;
	$tables = sml_dgc_tables();
	$connector = sml_dgc_connector( $group_id );
	if ( ! $connector || 'active' !== $connector['state'] ) return null;
	$link = $wpdb->get_row( $wpdb->prepare( "SELECT discord_user_id FROM {$tables['links']} WHERE user_id=%d", get_current_user_id() ), ARRAY_A );
	$owner_id = absint( $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$tables['groups']} WHERE id=%d", $group_id ) ) );
	if ( ! $link || ! $owner_id ) return null;
	return array(
		'group_id' => $group_id,
		'guild_id' => preg_replace( '/\D/', '', (string) $connector['guild_id'] ),
		'discord_user_id' => preg_replace( '/\D/', '', (string) $link['discord_user_id'] ),
		'owner_user_id' => $owner_id,
		'plan_id' => sml_platform_group_plan_id( $group_id ),
	);
}

function sml_platform_can_manage_group_billing( $group_id ) {
	if ( current_user_can( 'manage_options' ) ) return true;
	if ( function_exists( 'sml_dgc_can_manage' ) && sml_dgc_can_manage( absint( $group_id ) ) ) return true;
	global $wpdb;
	if ( ! function_exists( 'sml_dgc_tables' ) ) return false;
	$tables = sml_dgc_tables();
	$owner_id = absint( $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$tables['groups']} WHERE id=%d", absint( $group_id ) ) ) );
	return $owner_id && get_current_user_id() === $owner_id;
}

function sml_platform_migration_status( WP_REST_Request $request ) {
	$context = sml_platform_group_context( $request['group_id'] );
	return rest_ensure_response( array(
		'eligible' => (bool) ( $context && $context['plan_id'] ),
		'connected' => (bool) $context,
		'canManageBilling' => sml_platform_can_manage_group_billing( $request['group_id'] ),
		'platformFeePercent' => 6,
	) );
}

function sml_platform_start_seller_onboarding( WP_REST_Request $request ) {
	$group_id = absint( $request['group_id'] );
	if ( ! sml_platform_can_manage_group_billing( $group_id ) ) {
		return new WP_Error( 'billing_forbidden', 'Only this group owner or an administrator can manage membership billing.', array( 'status' => 403 ) );
	}
	if ( true !== $request->get_param( 'acceptFee' ) ) {
		return new WP_Error( 'billing_fee_consent', 'You must explicitly accept the 6% platform fee.', array( 'status' => 400 ) );
	}
	$context = sml_platform_group_context( $group_id );
	if ( ! $context ) return new WP_Error( 'discord_required', 'Connect your Discord account and server to this group first.', array( 'status' => 409 ) );
	$user = wp_get_current_user();
	$group_url = wp_validate_redirect( wp_get_referer(), home_url( '/' ) );
	$result = sml_platform_seller_onboarding( array(
		'ownerUserId' => get_current_user_id(),
		'email' => sanitize_email( $user->user_email ),
		'country' => 'US',
		'acceptedSellerTerms' => true,
		'acceptedDisputeDebits' => true,
		'acceptedMembershipFeeBps' => 600,
		'refreshUrl' => add_query_arg( 'billing', 'onboarding-refresh', $group_url ),
		'returnUrl' => add_query_arg( 'billing', 'onboarding-complete', $group_url ),
	) );
	if ( is_wp_error( $result ) ) return $result;
	return rest_ensure_response( array( 'onboardingUrl' => esc_url_raw( $result['onboardingUrl'] ?? '' ) ) );
}

/* ---- Owner-created membership products ---------------------------------- */

function sml_platform_rest_group_plans( WP_REST_Request $request ) {
	$group_id = absint( $request['group_id'] );
	$manage = sml_platform_can_manage_group_billing( $group_id );
	$plans = sml_platform_group_plans( $group_id, $manage );
	if ( is_wp_error( $plans ) ) return $plans;
	if ( ! $manage ) $plans = array_values( array_filter( $plans, function ( $plan ) { return ! empty( $plan['active'] ); } ) );
	return rest_ensure_response( array( 'plans' => $plans, 'canManage' => $manage, 'ownerUserId' => sml_platform_group_owner_user_id( $group_id ) ) );
}

function sml_platform_rest_create_group_plan( WP_REST_Request $request ) {
	$group_id = absint( $request['group_id'] );
	if ( ! sml_platform_can_manage_group_billing( $group_id ) ) {
		return new WP_Error( 'billing_forbidden', 'Only this group owner or an administrator can manage membership products.', array( 'status' => 403 ) );
	}
	$owner_id = sml_platform_group_owner_user_id( $group_id );
	if ( ! $owner_id ) return new WP_Error( 'group_owner_missing', 'This group has no owner on record.', array( 'status' => 409 ) );
	$price = $request->get_param( 'priceCents' );
	if ( null === $price && null !== $request->get_param( 'price' ) ) {
		$price = (int) round( (float) str_replace( array( '$', ',' ), '', (string) $request->get_param( 'price' ) ) * 100 );
	}
	$result = sml_platform_billing_call( '/v1/billing/plans/create', array(
		'groupId'     => $group_id,
		'ownerUserId' => $owner_id,
		'name'        => sanitize_text_field( (string) $request->get_param( 'name' ) ),
		'description' => sanitize_textarea_field( (string) $request->get_param( 'description' ) ),
		'priceCents'  => (int) $price,
		'currency'    => 'usd',
		'intervalKey' => sanitize_key( (string) $request->get_param( 'intervalKey' ) ),
		'grantsRole'  => sanitize_key( (string) ( $request->get_param( 'grantsRole' ) ?: 'premium' ) ),
	) );
	if ( is_wp_error( $result ) ) return $result;
	delete_transient( 'sml_platform_plan_' . $group_id );
	return rest_ensure_response( array( 'plan' => $result['plan'] ?? null ) );
}

function sml_platform_rest_archive_group_plan( WP_REST_Request $request ) {
	$group_id = absint( $request['group_id'] );
	if ( ! sml_platform_can_manage_group_billing( $group_id ) ) {
		return new WP_Error( 'billing_forbidden', 'Only this group owner or an administrator can manage membership products.', array( 'status' => 403 ) );
	}
	$result = sml_platform_billing_call( '/v1/billing/plans/archive', array(
		'groupId' => $group_id, 'planId' => absint( $request['plan_id'] ),
	) );
	if ( is_wp_error( $result ) ) return $result;
	delete_transient( 'sml_platform_plan_' . $group_id );
	return rest_ensure_response( array( 'plan' => $result['plan'] ?? null ) );
}

/** A member joins a product: Stripe Checkout, with the 6% platform fee disclosed on the button. */
function sml_platform_rest_plan_checkout( WP_REST_Request $request ) {
	$group_id = absint( $request['group_id'] );
	$plan_id  = absint( $request['plan_id'] );
	$owner_id = sml_platform_group_owner_user_id( $group_id );
	if ( ! $owner_id ) return new WP_Error( 'group_owner_missing', 'This group has no owner on record.', array( 'status' => 409 ) );
	if ( get_current_user_id() === $owner_id ) return new WP_Error( 'owner_cannot_join', 'You own this group; members join it.', array( 'status' => 409 ) );
	$group_url = wp_validate_redirect( wp_get_referer(), home_url( '/' ) );
	$result = sml_platform_membership_checkout( array(
		'planId'      => $plan_id,
		'groupId'     => $group_id,
		'ownerUserId' => $owner_id,
		'userId'      => get_current_user_id(),
		'successUrl'  => add_query_arg( 'billing', 'joined', $group_url ),
		'cancelUrl'   => $group_url,
	) );
	if ( is_wp_error( $result ) ) return $result;
	return rest_ensure_response( array( 'checkoutUrl' => esc_url_raw( $result['checkoutUrl'] ?? '' ) ) );
}

function sml_platform_start_upgrade_chat_migration( WP_REST_Request $request ) {
	$context = sml_platform_group_context( $request['group_id'] );
	if ( ! $context ) return new WP_Error( 'discord_required', 'Connect Discord to this group first.', array( 'status' => 409 ) );
	if ( ! $context['plan_id'] ) return new WP_Error( 'plan_unavailable', 'This group has not enabled billing migration yet.', array( 'status' => 409 ) );
	$group_url = wp_validate_redirect( wp_get_referer(), home_url( '/' ) );
	$group_url = remove_query_arg( 'billing', $group_url );
	$result = sml_platform_billing_call( '/v1/billing/migrations/upgrade-chat', array(
		'userId' => get_current_user_id(),
		'groupId' => $context['group_id'],
		'ownerUserId' => $context['owner_user_id'],
		'planId' => $context['plan_id'],
		'discordUserId' => $context['discord_user_id'],
		'guildId' => $context['guild_id'],
		'successUrl' => add_query_arg( 'billing', 'migration-complete', $group_url ),
		'cancelUrl' => add_query_arg( 'billing', 'migration-canceled', $group_url ),
	) );
	if ( is_wp_error( $result ) ) return $result;
	return rest_ensure_response( array(
		'checkoutUrl' => esc_url_raw( $result['checkoutUrl'] ?? '' ),
		'renewalAt' => sanitize_text_field( $result['renewalAt'] ?? '' ),
	) );
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-platform/v1', '/group/(?P<group_id>\d+)/migration-status', array(
		'methods' => 'GET', 'callback' => 'sml_platform_migration_status', 'permission_callback' => 'is_user_logged_in',
	) );
	register_rest_route( 'sml-platform/v1', '/group/(?P<group_id>\d+)/migrate-upgrade-chat', array(
		'methods' => 'POST', 'callback' => 'sml_platform_start_upgrade_chat_migration', 'permission_callback' => 'is_user_logged_in',
	) );
	register_rest_route( 'sml-platform/v1', '/group/(?P<group_id>\d+)/seller-onboarding', array(
		'methods' => 'POST', 'callback' => 'sml_platform_start_seller_onboarding', 'permission_callback' => 'is_user_logged_in',
	) );
	register_rest_route( 'sml-platform/v1', '/group/(?P<group_id>\d+)/plans', array(
		array( 'methods' => 'GET', 'callback' => 'sml_platform_rest_group_plans', 'permission_callback' => 'is_user_logged_in' ),
		array( 'methods' => 'POST', 'callback' => 'sml_platform_rest_create_group_plan', 'permission_callback' => 'is_user_logged_in' ),
	) );
	register_rest_route( 'sml-platform/v1', '/group/(?P<group_id>\d+)/plans/(?P<plan_id>\d+)/archive', array(
		'methods' => 'POST', 'callback' => 'sml_platform_rest_archive_group_plan', 'permission_callback' => 'is_user_logged_in',
	) );
	register_rest_route( 'sml-platform/v1', '/group/(?P<group_id>\d+)/plans/(?P<plan_id>\d+)/checkout', array(
		'methods' => 'POST', 'callback' => 'sml_platform_rest_plan_checkout', 'permission_callback' => 'is_user_logged_in',
	) );
} );

/** Apply only the website role owned by billing; manual owner/admin access is never overwritten. */
add_action( 'sml_platform_subscription_access_reconcile', function ( $data ) {
	global $wpdb;
	$user_id = absint( $data['userId'] ?? $data['user_id'] ?? 0 );
	$group_id = absint( $data['groupId'] ?? $data['group_id'] ?? 0 );
	$subscription_id = absint( $data['subscriptionId'] ?? $data['subscription_id'] ?? 0 );
	if ( ! $user_id || ! $group_id || ! function_exists( 'sml_dgc_tables' ) ) return;
	$active = ! empty( $data['active'] );
	$native_roles = array();
	foreach ( (array) ( $data['grants'] ?? array() ) as $grant ) {
		if ( 'native_group_role' === ( $grant['target'] ?? '' ) ) $native_roles[] = sanitize_key( $grant['roleRef'] ?? $grant['role_ref'] ?? '' );
	}
	$weights = array( 'member' => 10, 'premium' => 20, 'analyst' => 30, 'mod' => 40, 'admin' => 50 );
	$role = 'member';
	foreach ( $native_roles as $candidate ) if ( isset( $weights[ $candidate ] ) && $weights[ $candidate ] > $weights[ $role ] ) $role = $candidate;
	$tables = sml_dgc_tables();
	$owned = sml_platform_billing_grants_table();
	$current = sanitize_key( $wpdb->get_var( $wpdb->prepare( "SELECT role FROM {$tables['members']} WHERE group_id=%d AND user_id=%d", $group_id, $user_id ) ) );
	if ( $active ) {
		$created_member = $current ? 0 : 1;
		$prior_role = $current;
		if ( ! in_array( $current, array( 'owner', 'admin' ), true ) ) {
			if ( $current ) $wpdb->update( $tables['members'], array( 'role' => $role ), array( 'group_id' => $group_id, 'user_id' => $user_id ) );
			else $wpdb->insert( $tables['members'], array( 'group_id' => $group_id, 'user_id' => $user_id, 'role' => $role, 'joined_at' => current_time( 'mysql', true ) ) );
		}
		$existing_owned = $wpdb->get_row( $wpdb->prepare( "SELECT prior_role,created_member FROM {$owned} WHERE group_id=%d AND user_id=%d", $group_id, $user_id ), ARRAY_A );
		if ( $existing_owned ) {
			$prior_role = sanitize_key( $existing_owned['prior_role'] );
			$created_member = absint( $existing_owned['created_member'] );
		}
		$wpdb->replace( $owned, array( 'user_id' => $user_id, 'group_id' => $group_id, 'applied_role' => $role, 'prior_role' => $prior_role, 'created_member' => $created_member, 'subscription_id' => $subscription_id, 'updated_at' => current_time( 'mysql', true ) ) );
	} else {
		$grant = $wpdb->get_row( $wpdb->prepare( "SELECT applied_role,prior_role,created_member FROM {$owned} WHERE group_id=%d AND user_id=%d", $group_id, $user_id ), ARRAY_A );
		if ( $grant && $current === sanitize_key( $grant['applied_role'] ) ) {
			if ( ! empty( $grant['created_member'] ) ) $wpdb->delete( $tables['members'], array( 'group_id' => $group_id, 'user_id' => $user_id ) );
			elseif ( $grant['prior_role'] ) $wpdb->update( $tables['members'], array( 'role' => sanitize_key( $grant['prior_role'] ) ), array( 'group_id' => $group_id, 'user_id' => $user_id ) );
		}
		$wpdb->delete( $owned, array( 'group_id' => $group_id, 'user_id' => $user_id ) );
	}
}, 10, 1 );

/** Upgrade.Chat was already provider-confirmed as canceled before Checkout opened. */
add_action( 'sml_platform_cancel_external_subscription', function ( $data ) {
	if ( 'upgrade_chat' !== sanitize_key( $data['external_platform'] ?? '' ) ) throw new RuntimeException( 'No external cancellation adapter is installed for this provider.' );
	if ( empty( $data['external_reference'] ) ) throw new RuntimeException( 'Upgrade.Chat cancellation acknowledgement is missing its order reference.' );
	error_log( sprintf( 'SML billing migration completed for canceled Upgrade.Chat order %s.', sanitize_text_field( $data['external_reference'] ?? '' ) ) );
}, 10, 1 );

add_action( 'wp_footer', function () {
	if ( ! is_user_logged_in() ) return;
	$nonce = wp_create_nonce( 'wp_rest' );
	?>
	<style>.sml-billing-action{display:inline-flex!important;align-items:center;gap:7px;margin-left:8px!important;font-weight:900!important}.sml-billing-migrate{border:1px solid #f5c84b!important;background:linear-gradient(135deg,#fff3a3,#d69b00)!important;color:#251600!important;box-shadow:0 0 18px #f5c84b66;animation:smlBillingGlow 1.8s ease-in-out infinite}.sml-billing-setup{border:1px solid #19f28b!important;background:#071b14!important;color:#66ffb1!important}@keyframes smlBillingGlow{50%{transform:translateY(-1px);box-shadow:0 0 28px #f5c84baa}}
.sml-billing-join{border:1px solid #19f28b!important;background:#071b14!important;color:#66ffb1!important}.sml-billing-join small{font-weight:600;opacity:.8}
.sml-billing-plans{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.sml-billing-modal{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;background:rgba(1,5,13,.78);backdrop-filter:blur(7px)}
.sml-billing-card{width:min(720px,100%);max-height:calc(100dvh - 32px);overflow:auto;padding:22px;border:1px solid #1f8f5a;border-radius:18px;background:#09111f;color:#eaf0ff;box-shadow:0 26px 90px #000b;font-size:15px}
.sml-billing-card h2{margin:0 38px 8px 0;color:#fff}.sml-billing-card h3{margin:18px 0 6px;color:#9df5c9}.sml-billing-card p{color:#b9c7db;line-height:1.55;margin:6px 0}
.sml-billing-close{float:right;border:0;border-radius:8px;padding:7px 10px;background:#24324b;color:#fff;cursor:pointer}
.sml-billing-plan{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;align-items:center;margin:8px 0;padding:10px 12px;border:1px solid #1e2c44;border-radius:10px;background:#0b1626}
.sml-billing-plan b{color:#fff}.sml-billing-plan small{display:block;color:#9eb0c8}.sml-billing-plan.is-archived{opacity:.55}
.sml-billing-plan button{border:0;border-radius:8px;padding:8px 10px;background:#632f42;color:#fff;cursor:pointer;font-weight:700}
.sml-billing-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px}.sml-billing-form label{display:flex;flex-direction:column;gap:4px;color:#9eb0c8;font-size:13px;font-weight:700}.sml-billing-form label.wide{grid-column:1/-1}
.sml-billing-form input,.sml-billing-form select,.sml-billing-form textarea{min-width:0;padding:10px;border:1px solid #31415e;border-radius:8px;background:#060c16;color:#fff;font:inherit}.sml-billing-form textarea{min-height:70px;resize:vertical}
.sml-billing-primary{grid-column:1/-1;border:0;border-radius:9px;padding:12px 14px;background:#19c37d;color:#04160d;font-weight:800;cursor:pointer}.sml-billing-primary:disabled{opacity:.6;cursor:default}
.sml-billing-msg{grid-column:1/-1;color:#ffabb3;font-weight:700}.sml-billing-msg.ok{color:#8ff5c0}
@media(max-width:640px){.sml-billing-form{grid-template-columns:1fr}.sml-billing-form label.wide{grid-column:auto}.sml-billing-primary,.sml-billing-msg{grid-column:auto}.sml-billing-plan{grid-template-columns:1fr}}
</style>
	<script>(function(){var nonce=<?php echo wp_json_encode( $nonce ); ?>;function call(url,body){return fetch(url,{method:'POST',headers:{'X-WP-Nonce':nonce,'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.message||'Billing request failed.');return j;});});}function boot(){var root=document.getElementById('sml-group-root'),gid=root&&String(root.dataset.groupId||'').replace(/\D/g,'');if(!gid||root.dataset.smlBillingReady==='1'||root.dataset.smlBillingLoading==='1')return;root.dataset.smlBillingLoading='1';fetch('/wp-json/sml-platform/v1/group/'+gid+'/migration-status',{headers:{'X-WP-Nonce':nonce}}).then(function(r){return r.json();}).then(function(s){var actions=root.querySelector('.sml-gshell__owner-menu');if(!actions){delete root.dataset.smlBillingLoading;return;}delete root.dataset.smlBillingLoading;root.dataset.smlBillingReady='1';if(s.canManageBilling){var setup=document.createElement('button');setup.type='button';setup.className='sml-group-btn sml-billing-action sml-billing-setup';setup.textContent='⚙ Membership Billing · 6%';setup.onclick=function(){if(!confirm('Enable StockMarketLoop membership billing? I accept the 6% platform fee deducted from each subscription payment and authorize dispute recovery under the seller terms.'))return;setup.disabled=true;setup.textContent='Opening secure setup…';call('/wp-json/sml-platform/v1/group/'+gid+'/seller-onboarding',{acceptFee:true}).then(function(j){location.href=j.onboardingUrl;}).catch(function(e){setup.disabled=false;setup.textContent='⚙ Membership Billing · 6%';alert(e.message);});};actions.appendChild(setup);}if(s.eligible){var b=document.createElement('button');b.type='button';b.className='sml-group-btn sml-billing-action sml-billing-migrate';b.dataset.smlBillingMigrate='1';b.textContent='💳 Move Membership Billing';b.onclick=function(){if(!confirm('Move this membership to StockMarketLoop? Stripe will collect your payment method now but will not charge until your verified Upgrade.Chat renewal date. The group creator receives the payment after StockMarketLoop\'s disclosed 6% platform fee.'))return;b.disabled=true;b.textContent='Verifying membership…';call('/wp-json/sml-platform/v1/group/'+gid+'/migrate-upgrade-chat',{}).then(function(j){location.href=j.checkoutUrl;}).catch(function(e){b.disabled=false;b.textContent='💳 Move Membership Billing';alert(e.message);});};actions.appendChild(b);}}).catch(function(){delete root.dataset.smlBillingLoading;});}boot();[400,1000,2200].forEach(function(ms){setTimeout(boot,ms);});})();</script>
	<script>(function(){
	/* Membership products: owners create them (name, description, price, interval, granted role);
	   members see one Join button per product. The platform creates the Stripe product + price. */
	var nonce=<?php echo wp_json_encode( $nonce ); ?>,API='/wp-json/sml-platform/v1/group/';
	function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
	function req(url,opt){opt=opt||{};opt.credentials='same-origin';opt.headers=Object.assign({'X-WP-Nonce':nonce},opt.headers||{});if(opt.body&&!opt.headers['Content-Type'])opt.headers['Content-Type']='application/json';return fetch(url,opt).then(function(r){return r.json().catch(function(){return {};}).then(function(j){if(!r.ok)throw new Error(j.message||'Request failed.');return j;});});}
	function money(c){return '$'+(Number(c||0)/100).toFixed(2);}
	function every(p){return p.intervalLabel||p.intervalKey;}
	function gid(){var root=document.getElementById('sml-group-root');return root&&String(root.dataset.groupId||'').replace(/\D/g,'');}
	var INTERVALS=[['weekly','Weekly'],['monthly','Monthly'],['quarterly','Every 3 months'],['yearly','Yearly']],ROLES=[['member','Member'],['premium','Premium'],['analyst','Analyst'],['mod','Moderator'],['admin','Admin']];
	function options(list,value){return list.map(function(o){return '<option value="'+o[0]+'"'+(o[0]===value?' selected':'')+'>'+o[1]+'</option>';}).join('');}
	function closeModal(){var m=document.querySelector('.sml-billing-modal');if(m)m.remove();}
	function modal(html){closeModal();var m=document.createElement('div');m.className='sml-billing-modal';m.innerHTML='<section class="sml-billing-card" role="dialog" aria-modal="true" aria-label="Membership products"><button class="sml-billing-close" type="button">Close</button>'+html+'</section>';m.querySelector('.sml-billing-close').onclick=closeModal;m.addEventListener('click',function(e){if(e.target===m)closeModal();});document.body.appendChild(m);return m;}
	function planRow(p){return '<div class="sml-billing-plan'+(p.active?'':' is-archived')+'" data-plan="'+esc(p.id)+'"><div><b>'+esc(p.name)+'</b> · '+money(p.priceCents)+' / '+esc(every(p))+' · grants <b>'+esc(p.grantsRole||'premium')+'</b>'+(p.description?'<small>'+esc(p.description)+'</small>':'')+'<small>'+(p.active?'Live in Stripe':'Archived')+(p.stripeProductId?' · '+esc(p.stripeProductId):'')+'</small></div>'+(p.active?'<button type="button" data-archive="'+esc(p.id)+'">Archive</button>':'<span></span>')+'</div>';}
	function render(m,d){var g=gid(),plans=d.plans||[];var h='<h2>Membership products</h2><p>Name a product, set its price and how often members pay, and pick the website access it grants. Saving creates the product and price in Stripe automatically; members pay through Stripe Checkout and the payout lands in your connected account after the disclosed 6% platform fee.</p><h3>Your products</h3><div data-list>'+(plans.length?plans.map(planRow).join(''):'<p>No products yet.</p>')+'</div><h3>Add a product</h3><form class="sml-billing-form" data-form><label>Name<input name="name" maxlength="80" required placeholder="Premium Alerts"></label><label>Price (USD)<input name="price" type="number" min="1" max="100000" step="0.01" required placeholder="29.99"></label><label>Members pay<select name="intervalKey">'+options(INTERVALS,'monthly')+'</select></label><label>Grants website role<select name="grantsRole">'+options(ROLES,'premium')+'</select></label><label class="wide">Description<textarea name="description" maxlength="500" placeholder="What members get. Shown in Stripe Checkout."></textarea></label><div class="sml-billing-msg" data-msg hidden></div><button class="sml-billing-primary" type="submit">Create in Stripe</button></form>';
	  var card=m.querySelector('.sml-billing-card');card.innerHTML='<button class="sml-billing-close" type="button">Close</button>'+h;card.querySelector('.sml-billing-close').onclick=closeModal;
	  var form=card.querySelector('[data-form]'),msg=card.querySelector('[data-msg]');
	  function say(text,ok){msg.hidden=false;msg.textContent=text;msg.classList.toggle('ok',!!ok);}
	  form.onsubmit=function(e){e.preventDefault();var btn=form.querySelector('button[type=submit]');btn.disabled=true;say('Creating in Stripe…',true);
	    var body={name:form.name.value,description:form.description.value,priceCents:Math.round(parseFloat(form.price.value||'0')*100),intervalKey:form.intervalKey.value,grantsRole:form.grantsRole.value};
	    req(API+g+'/plans',{method:'POST',body:JSON.stringify(body)}).then(function(j){return req(API+g+'/plans').then(function(d2){render(m,d2);var mm=m.querySelector('[data-msg]');if(mm){mm.hidden=false;mm.classList.add('ok');mm.textContent='Created '+(j.plan&&j.plan.name?j.plan.name:'the product')+' in Stripe.';}});}).catch(function(err){btn.disabled=false;var t=String(err.message||err);if(/not ready/i.test(t))t='Finish “⚙ Membership Billing” (your Stripe payout setup) first, then create products.';say(t,false);});};
	  card.querySelectorAll('[data-archive]').forEach(function(b){b.onclick=function(){if(!confirm('Archive this product? Current subscribers keep their subscription; nobody new can buy it.'))return;b.disabled=true;req(API+g+'/plans/'+b.getAttribute('data-archive')+'/archive',{method:'POST',body:'{}'}).then(function(){return req(API+g+'/plans');}).then(function(d2){render(m,d2);}).catch(function(err){b.disabled=false;alert(err.message);});};});}
	function openProducts(){var g=gid();if(!g)return;var m=modal('<h2>Membership products</h2><p>Loading…</p>');req(API+g+'/plans').then(function(d){render(m,d);}).catch(function(err){m.querySelector('.sml-billing-card').insertAdjacentHTML('beforeend','<p class="sml-billing-msg">'+esc(err.message)+'</p>');});}
	window.smlPlatformOpenProducts=openProducts;
	function host(root){return root.querySelector('.sml-gshell__owner-menu')||root.querySelector('.sml-gshell__actions')||(function(){var d=root.querySelector('.sml-billing-plans');if(!d){d=document.createElement('div');d.className='sml-billing-plans';root.insertBefore(d,root.firstChild);}return d;})();}
	function boot(){var root=document.getElementById('sml-group-root'),g=gid();if(!root||!g||root.dataset.smlPlansReady==='1'||root.dataset.smlPlansLoading==='1')return;root.dataset.smlPlansLoading='1';
	  req(API+g+'/plans').then(function(d){root.dataset.smlPlansReady='1';delete root.dataset.smlPlansLoading;var box=host(root);
	    if(d.canManage){if(box.querySelector('[data-sml-products]'))return;var o=document.createElement('button');o.type='button';o.className='sml-group-btn sml-billing-action sml-billing-setup';o.setAttribute('data-sml-products','1');o.textContent='🛍 Membership products';o.onclick=openProducts;box.appendChild(o);return;}
	    (d.plans||[]).forEach(function(p){if(!p.active||box.querySelector('[data-sml-join="'+p.id+'"]'))return;var b=document.createElement('button');b.type='button';b.className='sml-group-btn sml-billing-action sml-billing-join';b.setAttribute('data-sml-join',p.id);b.innerHTML='💳 Join · '+esc(p.name)+' <small>'+money(p.priceCents)+' / '+esc(every(p))+'</small>';
	      b.onclick=function(){if(!confirm('Join '+p.name+' for '+money(p.priceCents)+' per '+every(p)+'? Stripe Checkout opens next. The group creator receives the payment after StockMarketLoop\'s disclosed 6% platform fee.'))return;b.disabled=true;req(API+g+'/plans/'+p.id+'/checkout',{method:'POST',body:'{}'}).then(function(j){location.href=j.checkoutUrl;}).catch(function(err){b.disabled=false;alert(err.message);});};box.appendChild(b);});
	  }).catch(function(){delete root.dataset.smlPlansLoading;});}
	boot();[600,1500,3000].forEach(function(ms){setTimeout(boot,ms);});
	})();</script>
	<?php
}, 100 );
