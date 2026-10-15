<?php
/**
 * Market Spin: a free wheel, once a day, plus a spin while a stream is live and one
 * more on a seven-day streak. Entry is never bought, so it is a sweepstakes-style
 * free play; prizes are small Loop Bucks issued from the vault and capped per day.
 * The outcome is drawn on the server with random_int(); the client only animates it.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** The twelve segments, in wheel order. weight = chance share. */
function sml_arc_wheel() {
	return array(
		array( 'label' => '5 LB',      'lb' => 5,   'weight' => 18, 'kind' => 'lb' ),
		array( 'label' => 'Tape slip', 'lb' => 0,   'weight' => 14, 'kind' => 'miss' ),
		array( 'label' => '10 LB',     'lb' => 10,  'weight' => 14, 'kind' => 'lb' ),
		array( 'label' => '25 LB',     'lb' => 25,  'weight' => 9,  'kind' => 'lb' ),
		array( 'label' => 'Extra spin','lb' => 0,   'weight' => 8,  'kind' => 'spin' ),
		array( 'label' => '5 LB',      'lb' => 5,   'weight' => 14, 'kind' => 'lb' ),
		array( 'label' => '100 LB',    'lb' => 100, 'weight' => 2,  'kind' => 'lb' ),
		array( 'label' => 'Tape slip', 'lb' => 0,   'weight' => 10, 'kind' => 'miss' ),
		array( 'label' => '10 LB',     'lb' => 10,  'weight' => 12, 'kind' => 'lb' ),
		array( 'label' => '50 LB',     'lb' => 50,  'weight' => 4,  'kind' => 'lb' ),
		array( 'label' => '5 LB',      'lb' => 5,   'weight' => 12, 'kind' => 'lb' ),
		array( 'label' => '250 LB',    'lb' => 250, 'weight' => 1,  'kind' => 'lb' ),
	);
}

function sml_arc_daily_row( $uid, $day = '' ) {
	global $wpdb;
	$day = $day ?: sml_arc_day();
	$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . sml_arc_table( 'daily' ) . ' WHERE user_id = %d AND day = %s', (int) $uid, $day ), ARRAY_A );
	if ( $row ) { return $row; }
	/* streak: yesterday's row carries it forward */
	$y = $wpdb->get_row( $wpdb->prepare( 'SELECT streak, spins_used FROM ' . sml_arc_table( 'daily' ) . ' WHERE user_id = %d AND day = %s', (int) $uid, sml_arc_day( time() - 86400 ) ), ARRAY_A );
	$streak = ( $y && (int) $y['spins_used'] > 0 ) ? (int) $y['streak'] : 0;
	$wpdb->insert( sml_arc_table( 'daily' ), array( 'user_id' => (int) $uid, 'day' => $day, 'spins_used' => 0, 'won' => 0, 'streak' => $streak ) );
	return array( 'user_id' => $uid, 'day' => $day, 'spins_used' => 0, 'won' => 0, 'streak' => $streak, 'last_spin_at' => null, 'bonus' => 0 );
}

/** Spins available today for this player, given the room they are in. */
function sml_arc_spin_allowance( $uid, $room_live ) {
	$t = sml_arc_tuning();
	$row = sml_arc_daily_row( $uid );
	$total = (int) $t['spin_base'] + ( $room_live ? (int) $t['spin_live_bonus'] : 0 ) + ( (int) $row['streak'] + 1 >= (int) $t['spin_streak_days'] ? 1 : 0 ) + (int) get_user_meta( $uid, 'sml_arc_extra_' . $row['day'], true );
	return array( 'total' => $total, 'used' => (int) $row['spins_used'], 'left' => max( 0, $total - (int) $row['spins_used'] ), 'streak' => (int) $row['streak'], 'won' => (int) $row['won'] );
}

function sml_arc_spin( $uid, $room_live ) {
	global $wpdb;
	$a = sml_arc_spin_allowance( $uid, $room_live );
	if ( $a['left'] <= 0 ) { return new WP_Error( 'sml_arc_nospin', 'No spins left today. Come back tomorrow, or watch a live stream for one more.', array( 'status' => 409 ) ); }
	$day = sml_arc_day();
	/* take the spin first, atomically: a double tap cannot spin twice */
	$ok = $wpdb->query( $wpdb->prepare( 'UPDATE ' . sml_arc_table( 'daily' ) . ' SET spins_used = spins_used + 1, last_spin_at = %s, streak = CASE WHEN spins_used = 0 THEN streak + 1 ELSE streak END WHERE user_id = %d AND day = %s AND spins_used < %d', sml_arc_now(), (int) $uid, $day, (int) $a['total'] ) );
	if ( ! $ok ) { return new WP_Error( 'sml_arc_nospin', 'That spin was already used.', array( 'status' => 409 ) ); }
	$row = sml_arc_daily_row( $uid );
	$n = (int) $row['spins_used'];
	/* weighted draw */
	$wheel = sml_arc_wheel(); $sum = 0; foreach ( $wheel as $s ) { $sum += $s['weight']; }
	$r = random_int( 1, $sum ); $idx = 0; $acc = 0;
	foreach ( $wheel as $i => $s ) { $acc += $s['weight']; if ( $r <= $acc ) { $idx = $i; break; } }
	$seg = $wheel[ $idx ];
	$paid = 0; $note = '';
	if ( $seg['kind'] === 'lb' ) {
		$room_left = sml_arc_room_left( $uid );
		$paid = min( (int) $seg['lb'], $room_left );
		if ( $paid > 0 ) { $res = sml_arc_pay( $uid, $paid, 'spin:' . $uid . ':' . $day . ':' . $n, array( 'game' => 'spin', 'segment' => $idx ) ); if ( is_wp_error( $res ) ) { $paid = 0; $note = $res->get_error_message(); } }
		if ( $paid < (int) $seg['lb'] && ! $note ) { $note = 'Daily arcade cap reached; the rest is on the house tomorrow.'; }
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . sml_arc_table( 'daily' ) . ' SET won = won + %d WHERE user_id = %d AND day = %s', $paid, (int) $uid, $day ) );
	} elseif ( $seg['kind'] === 'spin' ) {
		update_user_meta( $uid, 'sml_arc_extra_' . $day, (int) get_user_meta( $uid, 'sml_arc_extra_' . $day, true ) + 1 );
	}
	sml_arc_points( $uid, 'spin', $paid > 0 ? $paid : 1, $paid > 0 );
	return array( 'ok' => true, 'index' => $idx, 'segment' => $seg, 'paid' => $paid, 'note' => $note, 'allowance' => sml_arc_spin_allowance( $uid, $room_live ), 'balance' => sml_arc_balance( $uid ) );
}
