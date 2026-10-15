<?php
/**
 * Tape Call: call a ticker up or down for the next sixty seconds. Nothing is staked:
 * a call earns points on a monthly ladder and the top three of each day get a small
 * Loop Bucks prize from the vault by cron. Prices come from the site's own quotes feed
 * and the entry price is fixed on the server when the call is placed.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_arc_quotes( $symbols ) {
	$symbols = array_values( array_unique( array_filter( array_map( function ( $s ) { return strtoupper( preg_replace( '/[^A-Z.]/i', '', (string) $s ) ); }, (array) $symbols ) ) ) );
	if ( ! $symbols ) { return array(); }
	$key = 'sml_arc_q_' . md5( implode( ',', $symbols ) );
	$hit = get_transient( $key );
	if ( is_array( $hit ) ) { return $hit; }
	$out = array();
	$r = wp_remote_get( 'https://stockmarketloop-loop-kick.onrender.com/api/quotes?symbols=' . rawurlencode( implode( ',', $symbols ) ), array( 'timeout' => 6 ) );
	if ( ! is_wp_error( $r ) ) {
		$j = json_decode( wp_remote_retrieve_body( $r ), true );
		foreach ( (array) ( $j['quotes'] ?? array() ) as $sym => $q ) { if ( ! empty( $q['last'] ) ) { $out[ strtoupper( $sym ) ] = array( 'last' => (float) $q['last'], 'pct' => (float) ( $q['pct'] ?? 0 ), 'chg' => (float) ( $q['chg'] ?? 0 ) ); } }
	}
	set_transient( $key, $out, 8 );
	return $out;
}

function sml_arc_call_open( $uid ) {
	global $wpdb;
	return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . sml_arc_table( 'calls' ) . ' WHERE user_id = %d AND result IS NULL ORDER BY id DESC LIMIT 1', (int) $uid ), ARRAY_A );
}
function sml_arc_calls_today( $uid ) {
	global $wpdb;
	return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . sml_arc_table( 'calls' ) . ' WHERE user_id = %d AND placed_at >= %s', (int) $uid, gmdate( 'Y-m-d 00:00:00' ) ) );
}

function sml_arc_call_place( $uid, $room, $symbol, $dir ) {
	global $wpdb;
	$t = sml_arc_tuning();
	$symbol = strtoupper( preg_replace( '/[^A-Z.]/i', '', (string) $symbol ) );
	$dir = $dir === 'down' ? 'down' : 'up';
	if ( strlen( $symbol ) < 1 || strlen( $symbol ) > 6 ) { return new WP_Error( 'sml_arc_symbol', 'Pick a ticker.', array( 'status' => 400 ) ); }
	if ( sml_arc_call_open( $uid ) ) { return new WP_Error( 'sml_arc_open', 'You already have a call running.', array( 'status' => 409 ) ); }
	if ( sml_arc_calls_today( $uid ) >= (int) $t['tape_daily_max'] ) { return new WP_Error( 'sml_arc_max', 'That is the daily limit of calls. Back tomorrow.', array( 'status' => 409 ) ); }
	$q = sml_arc_quotes( array( $symbol ) );
	if ( empty( $q[ $symbol ]['last'] ) ) { return new WP_Error( 'sml_arc_quote', 'No live price for $' . $symbol . ' right now.', array( 'status' => 400 ) ); }
	$wpdb->insert( sml_arc_table( 'calls' ), array( 'user_id' => (int) $uid, 'room' => substr( (string) $room, 0, 80 ), 'symbol' => $symbol, 'dir' => $dir, 'p0' => $q[ $symbol ]['last'], 'placed_at' => sml_arc_now(), 'resolves_at' => gmdate( 'Y-m-d H:i:s', time() + (int) $t['tape_seconds'] ) ) );
	return sml_arc_call_public( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . sml_arc_table( 'calls' ) . ' WHERE id = %d', (int) $wpdb->insert_id ), ARRAY_A ) );
}

/** Resolves a call whose minute has passed. Idempotent: the UPDATE only lands while result is NULL. */
function sml_arc_call_resolve( $call ) {
	global $wpdb;
	if ( ! $call || $call['result'] !== null ) { return $call; }
	if ( strtotime( $call['resolves_at'] . ' UTC' ) > time() ) { return $call; }
	$t = sml_arc_tuning();
	$q = sml_arc_quotes( array( $call['symbol'] ) );
	$p1 = $q[ $call['symbol'] ]['last'] ?? null;
	if ( $p1 === null ) { return $call; } /* feed down: leave it open and try again on the next look */
	$p0 = (float) $call['p0'];
	$res = abs( $p1 - $p0 ) < 0.00001 ? 'push' : ( ( $p1 > $p0 ) === ( $call['dir'] === 'up' ) ? 'win' : 'loss' );
	$ct = sml_arc_table( 'calls' );
	$claimed = $wpdb->query( $wpdb->prepare( "UPDATE $ct SET p1 = %f, result = %s WHERE id = %d AND result IS NULL", (float) $p1, $res, (int) $call['id'] ) );
	if ( ! $claimed ) { return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $ct WHERE id = %d", (int) $call['id'] ), ARRAY_A ); }
	$points = 0;
	$mine = sml_arc_my_rank( (int) $call['user_id'], 'tape', sml_arc_month() );
	$streak_before = $mine ? (int) $mine['streak'] : 0;
	if ( $res === 'win' ) {
		$points = (int) $t['tape_win'] + ( $streak_before + 1 >= 3 ? (int) $t['tape_streak_bonus'] : 0 );
		sml_arc_points( (int) $call['user_id'], 'tape', $points, true );
	} elseif ( $res === 'push' ) { $points = (int) $t['tape_push']; sml_arc_points( (int) $call['user_id'], 'tape', $points, null ); }
	else { sml_arc_points( (int) $call['user_id'], 'tape', 0, false ); }
	$wpdb->update( $ct, array( 'points' => $points ), array( 'id' => (int) $call['id'] ) );
	return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $ct WHERE id = %d", (int) $call['id'] ), ARRAY_A );
}

function sml_arc_call_public( $c ) {
	if ( ! $c ) { return null; }
	return array( 'id' => (int) $c['id'], 'symbol' => $c['symbol'], 'dir' => $c['dir'], 'p0' => (float) $c['p0'], 'p1' => $c['p1'] !== null ? (float) $c['p1'] : null, 'placedAt' => gmdate( 'c', strtotime( $c['placed_at'] . ' UTC' ) ), 'resolvesAt' => gmdate( 'c', strtotime( $c['resolves_at'] . ' UTC' ) ), 'secondsLeft' => max( 0, strtotime( $c['resolves_at'] . ' UTC' ) - time() ), 'result' => $c['result'], 'points' => (int) $c['points'] );
}

/** The last few calls in a room, so the stream sees the crowd's lean. */
function sml_arc_room_calls( $room, $limit = 12 ) {
	global $wpdb;
	$rows = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . sml_arc_table( 'calls' ) . ' WHERE room = %s ORDER BY id DESC LIMIT %d', $room, (int) $limit ), ARRAY_A );
	$out = array();
	foreach ( $rows as $r ) { $r = sml_arc_call_resolve( $r ); $p = sml_arc_call_public( $r ); $p['player'] = sml_arc_person( (int) $r['user_id'] ); $out[] = $p; }
	return $out;
}
function sml_arc_my_calls( $uid, $limit = 8 ) {
	global $wpdb;
	$rows = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . sml_arc_table( 'calls' ) . ' WHERE user_id = %d ORDER BY id DESC LIMIT %d', (int) $uid, (int) $limit ), ARRAY_A );
	return array_map( function ( $r ) { return sml_arc_call_public( sml_arc_call_resolve( $r ) ); }, $rows );
}

/* yesterday's top three on the daily tape ladder get paid, once, by cron */
add_action( 'sml_arc_daily', function () {
	global $wpdb;
	$t = sml_arc_tuning();
	$y = gmdate( 'Y-m-d', time() - 86400 );
	$rows = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT user_id, SUM(points) AS pts FROM ' . sml_arc_table( 'calls' ) . " WHERE placed_at >= %s AND placed_at < %s AND result IS NOT NULL AND user_id < 999999900 GROUP BY user_id HAVING pts > 0 ORDER BY pts DESC LIMIT 3", $y . ' 00:00:00', $y . ' 23:59:59' ), ARRAY_A );
	foreach ( $rows as $i => $r ) { $prize = (int) ( $t['tape_daily_prizes'][ $i ] ?? 0 ); if ( $prize ) { sml_arc_pay( (int) $r['user_id'], $prize, 'tape:' . str_replace( '-', '', $y ) . ':rank' . ( $i + 1 ), array( 'day' => $y, 'rank' => $i + 1 ) ); } }
} );
