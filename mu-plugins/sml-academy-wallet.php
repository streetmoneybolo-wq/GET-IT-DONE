<?php
/**
 * Plugin Name: SML Academy Wallet (Loop Bucks for the Academy)
 * Description: Lets sml-platform-api charge a member's Loop Bucks for an Academy pass. HMAC-guarded (same secret and signature as the LOOP-KICK bridge), one signed route with three actions: status, spend, refund. Only a linked StockMarketLoop account that is email-verified, has a complete profile and has two-step sign-in on may spend. Every spend and refund is keyed by a unique ref, so a retry never charges or refunds twice.
 * Version: 1.0.0
 *
 * Depends on the Loop Bucks vault (sml_lb_balance / sml_lb_move / sml_lb_table) and on sml-loop-kick-discord.php
 * (sml_lkd_verify_signed / sml_lkd_signed_json / sml_lkd_bridge_secret). If either is missing every action fails closed (503).
 *
 * Site hooks (all optional):
 *   apply_filters( 'sml_academy_user_two_step', null, $user_id )   true/false when a 2FA system says so
 *   apply_filters( 'sml_academy_profile_complete', null, $user_id ) true/false from your profile rules
 *   apply_filters( 'sml_academy_security_url', $url )               where a member turns two-step on
 *   apply_filters( 'sml_academy_profile_url', $url )                where a member completes their profile
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_aw_ready() {
	return function_exists( 'sml_lb_move' ) && function_exists( 'sml_lb_balance' ) && function_exists( 'sml_lb_table' )
		&& function_exists( 'sml_lkd_verify_signed' ) && function_exists( 'sml_lkd_signed_json' ) && function_exists( 'sml_lkd_bridge_secret' );
}

/** true / false. Fails closed: no signal means NOT enabled. */
function sml_aw_two_step( $user_id ) {
	$hint = apply_filters( 'sml_academy_user_two_step', null, $user_id );
	if ( null !== $hint ) { return (bool) $hint; }
	if ( class_exists( 'Two_Factor_Core' ) && is_callable( array( 'Two_Factor_Core', 'is_user_using_two_factor' ) ) ) {
		return (bool) Two_Factor_Core::is_user_using_two_factor( $user_id );
	}
	return '1' === (string) get_user_meta( $user_id, 'sml_two_step_enabled', true );
}

function sml_aw_profile_complete( $user_id, $user ) {
	$hint = apply_filters( 'sml_academy_profile_complete', null, $user_id );
	if ( null !== $hint ) { return (bool) $hint; }
	if ( '1' === (string) get_user_meta( $user_id, 'sml_profile_complete', true ) ) { return true; }
	$name = trim( (string) $user->display_name );
	return '' !== $name && 0 !== strcasecmp( $name, (string) $user->user_login );
}

/** The StockMarketLoop account behind a Discord id, and what still blocks it from spending. */
function sml_aw_member( $discord_id ) {
	global $wpdb;
	$links = $wpdb->prefix . 'sml_discord_site_links';
	$row   = $wpdb->get_row( $wpdb->prepare( "SELECT user_id FROM {$links} WHERE discord_user_id=%s", $discord_id ), ARRAY_A );
	$uid   = $row ? absint( $row['user_id'] ) : 0;
	$user  = $uid ? get_userdata( $uid ) : false;
	if ( ! $user ) {
		return array( 'uid' => 0, 'blocked' => 'not_linked', 'url' => home_url( '/connect-discord/' ) );
	}
	if ( '1' !== (string) get_user_meta( $uid, 'sml_email_verified', true ) ) {
		return array( 'uid' => $uid, 'blocked' => 'not_verified', 'url' => home_url( '/register/' ) );
	}
	if ( ! sml_aw_profile_complete( $uid, $user ) ) {
		return array( 'uid' => $uid, 'blocked' => 'profile_incomplete', 'url' => apply_filters( 'sml_academy_profile_url', home_url( '/' ) ) );
	}
	if ( ! sml_aw_two_step( $uid ) ) {
		return array( 'uid' => $uid, 'blocked' => 'two_step_required', 'url' => apply_filters( 'sml_academy_security_url', home_url( '/' ) ) );
	}
	return array( 'uid' => $uid, 'blocked' => '' );
}

function sml_aw_ledger_row( $ref ) {
	global $wpdb;
	$ledger = sml_lb_table( 'ledger' );
	return $wpdb->get_row( $wpdb->prepare( "SELECT id, user_id, delta FROM {$ledger} WHERE ref = %s LIMIT 1", substr( $ref, 0, 96 ) ), ARRAY_A );
}

function sml_aw_rest( WP_REST_Request $request ) {
	if ( ! sml_aw_ready() ) { return new WP_Error( 'sml_aw_unavailable', 'Wallet unavailable.', array( 'status' => 503 ) ); }
	$ok = sml_lkd_verify_signed( $request, sml_lkd_bridge_secret(), 'x-sml-lk-timestamp', 'x-sml-lk-signature' );
	if ( is_wp_error( $ok ) ) { return $ok; }
	global $wpdb;
	$body   = sml_lkd_signed_json( $request );
	$action = sanitize_key( (string) ( $body['action'] ?? '' ) );
	$did    = preg_replace( '/\D/', '', (string) ( $body['discord_user_id'] ?? '' ) );
	if ( ! preg_match( '/^\d{15,24}$/', $did ) ) { return new WP_Error( 'sml_aw_bad_id', 'A Discord user id is required.', array( 'status' => 400 ) ); }
	$m = sml_aw_member( $did );

	if ( 'status' === $action ) {
		$out = array( 'ok' => true, 'linked' => $m['uid'] > 0, 'eligible' => '' === $m['blocked'], 'blocked' => $m['blocked'], 'url' => $m['url'] ?? '' );
		if ( $m['uid'] ) { $out['balance'] = (int) sml_lb_balance( $m['uid'] ); }
		return rest_ensure_response( $out );
	}

	$ref = preg_replace( '/[^A-Za-z0-9:_-]/', '', (string) ( $body['ref'] ?? '' ) );
	if ( strlen( $ref ) < 12 || strlen( $ref ) > 80 ) { return new WP_Error( 'sml_aw_bad_ref', 'A unique ref is required.', array( 'status' => 400 ) ); }

	if ( 'spend' === $action ) {
		$amount = absint( $body['amount'] ?? 0 );
		if ( $amount < 1 || $amount > 1000000 ) { return new WP_Error( 'sml_aw_bad_amount', 'Invalid amount.', array( 'status' => 400 ) ); }
		$prior = sml_aw_ledger_row( $ref );
		if ( $prior ) { // a retry of a spend that already went through
			return rest_ensure_response( array( 'ok' => true, 'status' => 'duplicate', 'balance' => (int) sml_lb_balance( (int) $prior['user_id'] ) ) );
		}
		if ( '' !== $m['blocked'] ) {
			return new WP_REST_Response( array( 'ok' => false, 'error' => $m['blocked'], 'url' => $m['url'] ?? '' ), 403 );
		}
		$lock = 'sml_aw_' . $m['uid'];
		if ( 1 !== (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 5)', $lock ) ) ) {
			return new WP_Error( 'sml_aw_busy', 'Try again.', array( 'status' => 409 ) );
		}
		try {
			$balance = (int) sml_lb_balance( $m['uid'] );
			if ( $balance < $amount ) {
				return new WP_REST_Response( array( 'ok' => false, 'error' => 'insufficient_funds', 'balance' => $balance, 'needed' => $amount ), 402 );
			}
			$moved = sml_lb_move( $m['uid'], -$amount, 'academy_pass', $ref, array( 'plan' => sanitize_key( (string) ( $body['plan'] ?? '' ) ) ) );
			if ( false === $moved || is_wp_error( $moved ) ) { return new WP_Error( 'sml_aw_failed', 'Charge failed.', array( 'status' => 503 ) ); }
		} finally {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock ) );
		}
		return rest_ensure_response( array( 'ok' => true, 'status' => 'charged', 'balance' => (int) sml_lb_balance( $m['uid'] ) ) );
	}

	if ( 'refund' === $action ) {
		$spent = sml_aw_ledger_row( $ref );
		if ( ! $spent || (int) $spent['delta'] >= 0 || ( $m['uid'] && (int) $spent['user_id'] !== $m['uid'] ) ) {
			return new WP_Error( 'sml_aw_no_spend', 'Nothing to refund.', array( 'status' => 404 ) );
		}
		$refund_ref = 'refund:' . $ref;
		if ( sml_aw_ledger_row( $refund_ref ) ) { return rest_ensure_response( array( 'ok' => true, 'status' => 'duplicate' ) ); }
		$moved = sml_lb_move( (int) $spent['user_id'], -(int) $spent['delta'], 'academy_refund', $refund_ref, array() );
		if ( false === $moved || is_wp_error( $moved ) ) { return new WP_Error( 'sml_aw_failed', 'Refund failed.', array( 'status' => 503 ) ); }
		return rest_ensure_response( array( 'ok' => true, 'status' => 'refunded', 'balance' => (int) sml_lb_balance( (int) $spent['user_id'] ) ) );
	}
	return new WP_Error( 'sml_aw_action', 'Unknown action.', array( 'status' => 400 ) );
}

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml-loop-kick/v1', '/academy-wallet', array(
		'methods'             => 'POST',
		'callback'            => 'sml_aw_rest',
		'permission_callback' => '__return_true',
	) );
} );
