<?php
/**
 * The arcade's tap into the Loop Bucks ledger, plus the three product fixes
 * (free tables for everyone, CPU off the scoreboard, staking on for skill games).
 *
 * Two ledger reasons are registered: 'arcade' issues from the vault (a prize), and
 * 'arcade_fund' absorbs into the vault (a host funding a jackpot). Every movement
 * carries a deterministic reference, so a retried request pays nobody twice.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

add_filter( 'sml_lb_reasons', function ( $reasons ) {
	$reasons['arcade']      = array( 'flow' => 'issue',  'label' => 'Arcade prize' );
	$reasons['arcade_fund'] = array( 'flow' => 'absorb', 'label' => 'Jackpot funded' );
	return $reasons;
} );

function sml_arc_ledger_ready() { return function_exists( 'sml_lb_move' ) && function_exists( 'sml_lb_balance' ); }
function sml_arc_balance( $uid ) { return sml_arc_ledger_ready() ? (int) sml_lb_balance( (int) $uid ) : 0; }

/** Pays a prize from the vault. Returns true, or a WP_Error. */
function sml_arc_pay( $uid, $amount, $ref, $meta = array() ) {
	if ( ! sml_arc_ledger_ready() ) { return new WP_Error( 'sml_arc_ledger', 'Loop Bucks are not available right now.' ); }
	$amount = (int) $amount;
	if ( $amount <= 0 ) { return true; }
	$r = sml_lb_move( (int) $uid, $amount, 'arcade', 'arcade:' . $ref, $meta );
	return is_wp_error( $r ) ? $r : true;
}
/** Takes Loop Bucks from a player into the vault (jackpot funding). */
function sml_arc_take( $uid, $amount, $ref, $meta = array() ) {
	if ( ! sml_arc_ledger_ready() ) { return new WP_Error( 'sml_arc_ledger', 'Loop Bucks are not available right now.' ); }
	if ( sml_arc_balance( $uid ) < (int) $amount ) { return new WP_Error( 'sml_arc_funds', 'Not enough Loop Bucks to fund that prize.', array( 'status' => 409 ) ); }
	$r = sml_lb_move( (int) $uid, -1 * (int) $amount, 'arcade_fund', 'arcade:' . $ref, $meta );
	return is_wp_error( $r ) ? $r : true;
}

/** How much a player has taken from the arcade today, against the daily cap. */
function sml_arc_taken_today( $uid ) {
	global $wpdb;
	if ( ! function_exists( 'sml_lb_table' ) ) { return 0; }
	$t = sml_lb_table( 'ledger' );
	return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(delta),0) FROM $t WHERE user_id = %d AND reason = 'arcade' AND created_at >= %s", (int) $uid, gmdate( 'Y-m-d 00:00:00' ) ) );
}
function sml_arc_room_left( $uid ) { return max( 0, (int) sml_arc_tuning()['arcade_daily_cap'] - sml_arc_taken_today( $uid ) ); }

/* ---- fix 1: free tables need no held balance; staked tables keep the threshold ---- */
add_filter( 'sml_lb_gates', function ( $gates ) {
	if ( isset( $gates['games'] ) ) {
		$gates['games']['need'] = 0;
		$gates['games']['why']  = 'Free tables are open to everyone. Staked tables need the Loop Bucks you put on the table.';
	}
	return $gates;
}, 20 );

/* ---- fix 2: CPU players never appear on the public scoreboard ---- */
add_filter( 'rest_post_dispatch', function ( $response, $server, $request ) {
	if ( '/sml-games/v1/scores' !== $request->get_route() ) { return $response; }
	$response = rest_ensure_response( $response );
	$data = $response->get_data();
	if ( is_array( $data ) && ! empty( $data['leaderboard'] ) && is_array( $data['leaderboard'] ) ) {
		$data['leaderboard'] = array_values( array_filter( $data['leaderboard'], function ( $row ) { $p = $row['player'] ?? array(); return empty( $p['cpu'] ) && (int) ( $p['id'] ?? 0 ) < 999999900; } ) );
		$response->set_data( $data );
	}
	return $response;
}, 20, 3 );

/* ---- the live-stream room: who hosts it, and is it live ---- */
function sml_arc_room_host( $handle ) {
	$handle = strtolower( preg_replace( '/[^a-z0-9_.-]/i', '', (string) $handle ) );
	if ( '' === $handle ) { return 0; }
	if ( function_exists( 'sml_members_user_by_handle' ) ) { $u = sml_members_user_by_handle( $handle ); if ( $u ) { return (int) ( is_object( $u ) ? $u->ID : $u ); } }
	$ids = get_users( array( 'meta_key' => 'sml_public_handle', 'meta_value' => $handle, 'fields' => 'ID', 'number' => 1 ) );
	if ( $ids ) { return (int) $ids[0]; }
	$u = get_user_by( 'slug', $handle );
	return $u ? (int) $u->ID : 0;
}
function sml_arc_room_live( $handle ) {
	$key = 'sml_arc_live_' . md5( $handle );
	$hit = get_transient( $key );
	if ( $hit !== false ) { return (bool) $hit; }
	$live = false;
	$req = new WP_REST_Request( 'GET', '/sml-live/v1/feeds/' . $handle );
	$res = rest_do_request( $req );
	if ( ! is_wp_error( $res ) && $res->get_status() < 400 ) { $d = $res->get_data(); $live = ! empty( $d['live'] ); }
	set_transient( $key, $live ? 1 : 0, 45 );
	return $live;
}
