<?php
/**
 * Plugin Name: SML Super Chat gift in live chat (mu)
 * Description: Viewers send the creator a Super Chat from inside the live chat: a Gift button left of the chat box (js/live-watch.js) opens the options exactly as the creator set them in Go Live → Monetization (Super Chat on/off, minimum and maximum Loop Bucks, message length). Two ways to give: a MESSAGE gift at any amount inside the creator's range (Loop Bucks debit through the voice wallet, recorded in the same superchats table the creator's Monetization tab reads), or a SPEAK gift that buys one of the voice passes (sml_voice_rest_superchat: tier validation, limits, debit, superchat + token) so the viewer can talk on the creator's mic queue. Every gift lands in the live chat as a highlighted message_type=superchat row (the row type the stream overlay shows). REST: GET /sml-superchat/v1/options?room_id, POST /sml-superchat/v1/gift. Owner calls 2026-09-10.
 * Version: 1.1.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_scg_balance( int $uid ): int {
	if ( function_exists( 'sml_voice_wallet_balance' ) ) { $b = sml_voice_wallet_balance( $uid ); if ( is_numeric( $b ) ) { return (int) $b; } }
	if ( function_exists( 'sml_lb_balance' ) ) { return (int) sml_lb_balance( $uid ); }
	return 0;
}
function sml_scg_host( string $room ): int { return function_exists( 'sml_voice_room_host' ) ? (int) sml_voice_room_host( $room ) : 0; }
function sml_scg_settings( int $host ): array {
	$s = $host && function_exists( 'sml_gl_get_monetization_settings' ) ? (array) sml_gl_get_monetization_settings( $host ) : array();
	$min = max( 1, (int) ( $s['superchat_min_loop_bucks'] ?? 5 ) ); $max = max( $min, (int) ( $s['superchat_max_loop_bucks'] ?? 500 ) );
	return array( 'enabled' => ! isset( $s['superchat_enabled'] ) || ! empty( $s['superchat_enabled'] ), 'min' => $min, 'max' => $max, 'message_limit' => max( 40, min( 500, (int) ( $s['superchat_message_limit'] ?? 200 ) ) ), 'stickers' => ! empty( $s['stickers_enabled'] ) );
}
function sml_scg_quick( int $min, int $max ): array {
	$out = array( $min );
	foreach ( array( 10, 25, 50, 100, 250, 500, 1000, 2500 ) as $v ) { if ( $v > $min && $v < $max ) { $out[] = $v; } }
	$out[] = $max;
	return array_values( array_unique( $out ) );
}
function sml_scg_tiers( string $room, int $uid, int $host ): array {
	if ( ! function_exists( 'sml_voice_tiers' ) ) { return array(); }
	$member = $host && $uid && function_exists( 'sml_gl_user_has_content_access' ) ? (bool) sml_gl_user_has_content_access( $uid, $host ) : false;
	$out = array();
	/* creator-priced durations with levels (voice-api sml_voice_tiers_for_room, 2026-09-15); the old global tiers are the fallback */
	$tiers = function_exists( 'sml_voice_tiers_for_room' ) ? (array) sml_voice_tiers_for_room( $room ) : (array) sml_voice_tiers();
	foreach ( $tiers as $t ) { if ( (int) $t['loop_bucks'] <= 0 ) { continue; } $t['locked'] = ! empty( $t['members_only'] ) && ! $member; $out[] = $t; }
	return $out;
}
function sml_scg_levels( int $host ): array {
	if ( $host && function_exists( 'sml_gl_get_monetization_settings' ) ) { $s = sml_gl_get_monetization_settings( $host ); if ( ! empty( $s['superchat_levels'] ) ) { return (array) $s['superchat_levels']; } }
	return function_exists( 'sml_gl_default_levels' ) ? sml_gl_default_levels() : array();
}
function sml_scg_level( int $host, int $lb ): array {
	$pick = array( 'min' => 1, 'label' => 'Blue', 'color' => '#1e88e5' );
	foreach ( sml_scg_levels( $host ) as $lv ) { if ( $lb >= (int) $lv['min'] ) { $pick = $lv; } }
	return $pick;
}
function sml_scg_voice_enabled( int $host ): bool {
	if ( $host && function_exists( 'sml_gl_get_monetization_settings' ) ) { $s = sml_gl_get_monetization_settings( $host ); return ! isset( $s['voice_enabled'] ) || ! empty( $s['voice_enabled'] ); }
	return true;
}
function sml_scg_chat_row( string $room, int $uid, string $body ): int {
	global $wpdb; $user = wp_get_current_user();
	$wpdb->insert( $wpdb->prefix . 'sml_live_chat_messages', array( 'room_key' => substr( 'room-' . sanitize_key( $room ), 0, 190 ), 'user_id' => $uid, 'display_name' => sanitize_text_field( $user->display_name ?: $user->user_login ), 'body' => $body, 'message_type' => 'superchat', 'created_at' => current_time( 'mysql', true ) ), array( '%s', '%d', '%s', '%s', '%s', '%s' ) );
	return (int) $wpdb->insert_id;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-superchat/v1', '/options', array( 'methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function ( WP_REST_Request $r ) {
		$room = sanitize_text_field( (string) $r->get_param( 'room_id' ) ); $uid = get_current_user_id(); $host = sml_scg_host( $room );
		$s = sml_scg_settings( $host ); $hu = $host ? get_userdata( $host ) : null;
		$res = rest_ensure_response( array( 'ok' => true, 'logged_in' => (bool) $uid, 'balance' => $uid ? sml_scg_balance( $uid ) : 0, 'settings' => $s, 'quick' => sml_scg_quick( $s['min'], $s['max'] ), 'levels' => sml_scg_levels( $host ), 'voice_enabled' => sml_scg_voice_enabled( $host ), 'tiers' => sml_scg_tiers( $room, $uid, $host ), 'creator' => $hu ? ( $hu->display_name ?: $hu->user_login ) : '', 'store_url' => home_url( '/wallet/' ) ) );
		$res->header( 'Cache-Control', 'no-store' );
		return $res;
	} ) );
	register_rest_route( 'sml-superchat/v1', '/gift', array( 'methods' => 'POST', 'permission_callback' => 'is_user_logged_in', 'callback' => function ( WP_REST_Request $r ) {
		global $wpdb;
		$room = sanitize_text_field( (string) $r->get_param( 'room_id' ) ); $uid = get_current_user_id(); $host = sml_scg_host( $room );
		if ( '' === $room ) { return new WP_Error( 'sml_scg_room', 'Missing room.', array( 'status' => 400 ) ); }
		if ( $host <= 0 || ! get_userdata( $host ) ) { return new WP_Error( 'sml_scg_no_host', 'This room has no creator to receive a gift.', array( 'status' => 409 ) ); } // no creator, no charge: with host 0 the gift was debited and recorded for nobody (2026-09-19)
		if ( $host && $host === $uid ) { return new WP_Error( 'sml_scg_self', 'You cannot gift your own stream.', array( 'status' => 400 ) ); }
		$s = sml_scg_settings( $host );
		if ( ! $s['enabled'] ) { return new WP_Error( 'sml_scg_off', 'Super Chat is off for this stream.', array( 'status' => 409 ) ); }
		$mode = 'voice' === (string) $r->get_param( 'mode' ) ? 'voice' : 'message';
		$message = mb_substr( sanitize_text_field( (string) $r->get_param( 'message' ) ), 0, $s['message_limit'] );
		$user = wp_get_current_user();

		if ( 'voice' === $mode ) {
			if ( ! function_exists( 'sml_voice_rest_superchat' ) ) { return new WP_Error( 'sml_scg_unavailable', 'Voice passes are not available right now.', array( 'status' => 503 ) ); }
			if ( ! sml_scg_voice_enabled( $host ) ) { return new WP_Error( 'sml_scg_voice_off', 'This creator has Voice Super Chat turned off.', array( 'status' => 423 ) ); }
			$tier = sanitize_key( (string) $r->get_param( 'tier' ) ); $picked = null;
			foreach ( sml_scg_tiers( $room, $uid, $host ) as $t ) { if ( $t['slug'] === $tier ) { $picked = $t; } }
			if ( ! $picked ) { return new WP_Error( 'sml_scg_tier', 'Pick a voice pass.', array( 'status' => 400 ) ); }
			if ( ! empty( $picked['locked'] ) ) { return new WP_Error( 'sml_scg_members', 'That pass is for this creator\'s members.', array( 'status' => 403 ) ); }
			if ( sml_scg_balance( $uid ) < (int) $picked['loop_bucks'] ) { return new WP_Error( 'sml_scg_balance', 'Not enough Loop Bucks for that pass — top up in your wallet.', array( 'status' => 402 ) ); }
			$req = new WP_REST_Request( 'POST', '/sml-voice/v1/superchat' );
			$req->set_param( 'room_id', $room ); $req->set_param( 'tier', $tier ); $req->set_param( 'message', $message );
			$paid = sml_voice_rest_superchat( $req );
			if ( is_wp_error( $paid ) ) { return $paid; }
			$paid = $paid instanceof WP_REST_Response ? $paid->get_data() : $paid;
			if ( ! is_array( $paid ) || empty( $paid['ok'] ) ) { return new WP_Error( 'sml_scg_failed', 'The gift did not go through.', array( 'status' => 500 ) ); }
			$lvl = sml_scg_level( $host, (int) $picked['loop_bucks'] );
			$body = '🎤 Voice Super Chat · ' . number_format( (int) $picked['loop_bucks'] ) . ' LB · ' . strtoupper( (string) $lvl['label'] ) . ' — ' . $picked['label'] . ', recording a message for the host' . ( '' !== $message ? ': ' . $message : '' );
			$mid = sml_scg_chat_row( $room, $uid, $body );
			return rest_ensure_response( array( 'ok' => true, 'mode' => 'voice', 'superchat_id' => (int) ( $paid['superchat_id'] ?? 0 ), 'token' => (string) ( $paid['token'] ?? '' ), 'seconds' => (int) ( $paid['seconds'] ?? 0 ), 'balance' => (int) ( $paid['balance'] ?? sml_scg_balance( $uid ) ), 'loop_bucks' => (int) $picked['loop_bucks'], 'message_id' => $mid ) );
		}

		/* message gift: any amount inside the creator's range */
		$amount = (int) $r->get_param( 'amount' );
		if ( $amount < $s['min'] || $amount > $s['max'] ) { return new WP_Error( 'sml_scg_amount', sprintf( 'Gifts on this stream are %s–%s Loop Bucks.', number_format( $s['min'] ), number_format( $s['max'] ) ), array( 'status' => 400 ) ); }
		if ( ! function_exists( 'sml_voice_wallet_debit' ) ) { return new WP_Error( 'sml_scg_unavailable', 'Gifts are not available right now.', array( 'status' => 503 ) ); }
		if ( sml_scg_balance( $uid ) < $amount ) { return new WP_Error( 'sml_scg_balance', 'Not enough Loop Bucks — top up in your wallet.', array( 'status' => 402 ) ); }
		$idem = 'gift:' . $uid . ':' . $room . ':' . wp_generate_password( 10, false, false );
		$left = sml_voice_wallet_debit( $uid, $amount, $idem );
		if ( is_wp_error( $left ) ) { return $left; }
		$wpdb->insert( $wpdb->prefix . 'sml_voice_superchats', array( 'user_id' => $uid, 'room_id' => $room, 'streamer_id' => $host, 'tier_id' => 0, 'rail' => 'loop_bucks', 'amount_cents' => $amount, 'loop_bucks' => $amount, 'currency' => 'USD', 'message' => $message ?: null, 'idempotency_key' => $idem, 'status' => 'paid', 'paid_at' => gmdate( 'Y-m-d H:i:s' ), 'created_at' => gmdate( 'Y-m-d H:i:s' ) ) );
		$sid = (int) $wpdb->insert_id;
		if ( function_exists( 'sml_voice_log' ) ) { try { sml_voice_log( $room, null, $uid, 'superchat', array( 'tier' => 'gift', 'loop_bucks' => $amount, 'rail' => 'loop_bucks' ) ); } catch ( \Throwable $e ) {} }
		do_action( 'sml_superchat_gift', $sid, $uid, $host, $room, $amount, $message );
		$body = '🎁 ' . number_format( $amount ) . ' LB gift · ' . strtoupper( (string) sml_scg_level( $host, $amount )['label'] ) . ( '' !== $message ? ' — ' . $message : '' );
		$mid = sml_scg_chat_row( $room, $uid, $body );
		return rest_ensure_response( array( 'ok' => true, 'mode' => 'message', 'superchat_id' => $sid, 'balance' => (int) $left, 'loop_bucks' => $amount, 'message_id' => $mid ) );
	} ) );
} );
