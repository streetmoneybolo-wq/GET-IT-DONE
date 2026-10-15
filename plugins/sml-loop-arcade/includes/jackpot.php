<?php
/**
 * Stream Jackpot: the host funds a prize from their own Loop Bucks, sets a clock,
 * and viewers earn tickets by being there (one on joining, one a minute while it
 * runs). When the clock ends the next request draws a weighted winner and pays
 * them from the vault; the host's stake was absorbed into the vault when the round
 * opened, so the economy nets to zero. No ticket is ever sold.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_arc_round_live( $room ) {
	global $wpdb;
	return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . sml_arc_table( 'rounds' ) . " WHERE room = %s AND status = 'live' ORDER BY id DESC LIMIT 1", $room ), ARRAY_A );
}
function sml_arc_round_last( $room ) {
	global $wpdb;
	return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . sml_arc_table( 'rounds' ) . " WHERE room = %s AND status = 'done' ORDER BY id DESC LIMIT 1", $room ), ARRAY_A );
}
function sml_arc_round_tickets( $round_id, $uid = 0 ) {
	global $wpdb;
	$t = sml_arc_table( 'tickets' );
	if ( $uid ) { return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(n),0) FROM $t WHERE round_id = %d AND user_id = %d", (int) $round_id, (int) $uid ) ); }
	return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(n),0) FROM $t WHERE round_id = %d", (int) $round_id ) );
}
function sml_arc_round_players( $round_id ) {
	global $wpdb;
	return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(DISTINCT user_id) FROM ' . sml_arc_table( 'tickets' ) . ' WHERE round_id = %d', (int) $round_id ) );
}

function sml_arc_jackpot_start( $host_id, $room, $prize, $minutes, $title = '' ) {
	global $wpdb;
	$t = sml_arc_tuning();
	$prize = (int) $prize; $minutes = (int) $minutes;
	if ( $prize < (int) $t['jackpot_min'] || $prize > (int) $t['jackpot_max'] ) { return new WP_Error( 'sml_arc_prize', 'Prize must be between ' . $t['jackpot_min'] . ' and ' . number_format( $t['jackpot_max'] ) . ' Loop Bucks.', array( 'status' => 400 ) ); }
	if ( ! in_array( $minutes, (array) $t['jackpot_minutes'], true ) ) { $minutes = 10; }
	if ( sml_arc_round_live( $room ) ) { return new WP_Error( 'sml_arc_running', 'A jackpot is already running in this room.', array( 'status' => 409 ) ); }
	$wpdb->insert( sml_arc_table( 'rounds' ), array( 'kind' => 'jackpot', 'room' => $room, 'host_id' => (int) $host_id, 'status' => 'live', 'prize' => $prize, 'funded' => 0, 'starts_at' => sml_arc_now(), 'ends_at' => gmdate( 'Y-m-d H:i:s', time() + $minutes * 60 ), 'title' => sanitize_text_field( $title ) ) );
	$id = (int) $wpdb->insert_id;
	$take = sml_arc_take( $host_id, $prize, 'jackpot:' . $id . ':fund', array( 'round' => $id, 'room' => $room ) );
	if ( is_wp_error( $take ) ) { $wpdb->delete( sml_arc_table( 'rounds' ), array( 'id' => $id ) ); return $take; }
	$wpdb->update( sml_arc_table( 'rounds' ), array( 'funded' => 1 ), array( 'id' => $id ) );
	return sml_arc_round_public( $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . sml_arc_table( 'rounds' ) . ' WHERE id = %d', $id ), ARRAY_A ) );
}

/** A watch ticket: one per minute, keyed so a replay adds nothing. */
function sml_arc_jackpot_tick( $uid, $round ) {
	global $wpdb;
	if ( ! $round || $round['status'] !== 'live' ) { return 0; }
	if ( strtotime( $round['ends_at'] . ' UTC' ) <= time() ) { return 0; }
	$t = sml_arc_tuning();
	$tt = sml_arc_table( 'tickets' );
	$have = sml_arc_round_tickets( (int) $round['id'], $uid );
	if ( ! $have ) {
		$wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO $tt (round_id, user_id, n, ref, created_at) VALUES (%d, %d, %d, %s, %s)", (int) $round['id'], (int) $uid, (int) $t['join_tickets'], 'join:' . $round['id'] . ':' . $uid, sml_arc_now() ) );
	}
	$slot = (int) floor( ( time() - strtotime( $round['starts_at'] . ' UTC' ) ) / (int) $t['ticket_gap'] );
	$wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO $tt (round_id, user_id, n, ref, created_at) VALUES (%d, %d, 1, %s, %s)", (int) $round['id'], (int) $uid, 'watch:' . $round['id'] . ':' . $uid . ':' . $slot, sml_arc_now() ) );
	return sml_arc_round_tickets( (int) $round['id'], $uid );
}

/** Draws when the clock has run out. Safe to call from anyone, any number of times. */
function sml_arc_jackpot_settle( $round, $force = false ) {
	global $wpdb;
	if ( ! $round || $round['status'] !== 'live' ) { return $round; }
	if ( ! $force && strtotime( $round['ends_at'] . ' UTC' ) > time() ) { return $round; }
	$rt = sml_arc_table( 'rounds' );
	/* claim the draw: only one request wins this UPDATE */
	$claimed = $wpdb->query( $wpdb->prepare( "UPDATE $rt SET status = 'drawing' WHERE id = %d AND status = 'live'", (int) $round['id'] ) );
	if ( ! $claimed ) { return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $rt WHERE id = %d", (int) $round['id'] ), ARRAY_A ); }
	$rows = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT user_id, SUM(n) AS n FROM ' . sml_arc_table( 'tickets' ) . ' WHERE round_id = %d GROUP BY user_id', (int) $round['id'] ), ARRAY_A );
	$winner = 0;
	if ( $rows ) {
		$total = 0; foreach ( $rows as $r ) { $total += (int) $r['n']; }
		$pick = random_int( 1, max( 1, $total ) ); $acc = 0;
		foreach ( $rows as $r ) { $acc += (int) $r['n']; if ( $pick <= $acc ) { $winner = (int) $r['user_id']; break; } }
	}
	if ( $winner ) {
		sml_arc_pay( $winner, (int) $round['prize'], 'jackpot:' . $round['id'] . ':win', array( 'round' => (int) $round['id'], 'room' => $round['room'] ) );
		sml_arc_points( $winner, 'jackpot', (int) $round['prize'], true );
	} elseif ( ! empty( $round['funded'] ) ) {
		/* nobody showed: the host gets the stake back */
		sml_arc_pay( (int) $round['host_id'], (int) $round['prize'], 'jackpot:' . $round['id'] . ':refund', array( 'round' => (int) $round['id'] ) );
	}
	$wpdb->update( $rt, array( 'status' => 'done', 'winner_id' => $winner ?: null, 'drawn_at' => sml_arc_now() ), array( 'id' => (int) $round['id'] ) );
	return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $rt WHERE id = %d", (int) $round['id'] ), ARRAY_A );
}

function sml_arc_round_public( $round, $uid = 0 ) {
	if ( ! $round ) { return null; }
	$out = array(
		'id' => (int) $round['id'], 'room' => $round['room'], 'status' => $round['status'], 'prize' => (int) $round['prize'], 'title' => $round['title'],
		'host' => sml_arc_person( (int) $round['host_id'] ), 'startsAt' => gmdate( 'c', strtotime( $round['starts_at'] . ' UTC' ) ), 'endsAt' => gmdate( 'c', strtotime( $round['ends_at'] . ' UTC' ) ),
		'secondsLeft' => max( 0, strtotime( $round['ends_at'] . ' UTC' ) - time() ), 'tickets' => sml_arc_round_tickets( (int) $round['id'] ), 'players' => sml_arc_round_players( (int) $round['id'] ),
		'mine' => $uid ? sml_arc_round_tickets( (int) $round['id'], $uid ) : 0,
	);
	if ( $round['status'] === 'done' ) { $out['winner'] = $round['winner_id'] ? sml_arc_person( (int) $round['winner_id'] ) : null; $out['drawnAt'] = $round['drawn_at'] ? gmdate( 'c', strtotime( $round['drawn_at'] . ' UTC' ) ) : null; }
	return $out;
}

/** Recent winners across every room, for the ladder tab. */
function sml_arc_jackpot_recent( $limit = 10 ) {
	global $wpdb;
	$rows = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . sml_arc_table( 'rounds' ) . " WHERE status = 'done' AND winner_id IS NOT NULL ORDER BY id DESC LIMIT %d", (int) $limit ), ARRAY_A );
	return array_map( function ( $r ) { return sml_arc_round_public( $r ); }, $rows );
}

/* any round whose clock ran out while nobody was looking gets drawn by cron */
add_action( 'sml_arc_daily', function () {
	global $wpdb;
	$rows = (array) $wpdb->get_results( 'SELECT * FROM ' . sml_arc_table( 'rounds' ) . " WHERE status = 'live' AND ends_at < UTC_TIMESTAMP()", ARRAY_A );
	foreach ( $rows as $r ) { sml_arc_jackpot_settle( $r ); }
} );
