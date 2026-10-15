<?php
/**
 * Storage. Four tables: a daily row per player (spins, streak), raffle rounds, raffle
 * tickets, and a points table per game and period for the ladders. Prizes themselves
 * never live here: they are Loop Bucks and move through the ledger in bank.php.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_arc_table( $name ) { global $wpdb; return $wpdb->prefix . 'sml_arcade_' . $name; }

function sml_arc_install() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$c = $wpdb->get_charset_collate();
	dbDelta( 'CREATE TABLE ' . sml_arc_table( 'daily' ) . " (
		user_id BIGINT UNSIGNED NOT NULL,
		day CHAR(8) NOT NULL,
		spins_used TINYINT UNSIGNED NOT NULL DEFAULT 0,
		won INT UNSIGNED NOT NULL DEFAULT 0,
		streak SMALLINT UNSIGNED NOT NULL DEFAULT 0,
		last_spin_at DATETIME NULL,
		PRIMARY KEY  (user_id, day)
	) $c;" );
	dbDelta( 'CREATE TABLE ' . sml_arc_table( 'rounds' ) . " (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		kind VARCHAR(16) NOT NULL DEFAULT 'jackpot',
		room VARCHAR(80) NOT NULL,
		host_id BIGINT UNSIGNED NOT NULL,
		status VARCHAR(12) NOT NULL DEFAULT 'live',
		prize INT UNSIGNED NOT NULL DEFAULT 0,
		funded TINYINT UNSIGNED NOT NULL DEFAULT 0,
		starts_at DATETIME NOT NULL,
		ends_at DATETIME NOT NULL,
		winner_id BIGINT UNSIGNED NULL,
		drawn_at DATETIME NULL,
		title VARCHAR(120) NOT NULL DEFAULT '',
		PRIMARY KEY  (id),
		KEY room_status (room, status),
		KEY ends (status, ends_at)
	) $c;" );
	dbDelta( 'CREATE TABLE ' . sml_arc_table( 'tickets' ) . " (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		round_id BIGINT UNSIGNED NOT NULL,
		user_id BIGINT UNSIGNED NOT NULL,
		n SMALLINT UNSIGNED NOT NULL DEFAULT 1,
		ref VARCHAR(96) NOT NULL,
		created_at DATETIME NOT NULL,
		PRIMARY KEY  (id),
		UNIQUE KEY ref (ref),
		KEY round_user (round_id, user_id)
	) $c;" );
	dbDelta( 'CREATE TABLE ' . sml_arc_table( 'calls' ) . " (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		user_id BIGINT UNSIGNED NOT NULL,
		room VARCHAR(80) NOT NULL DEFAULT '',
		symbol VARCHAR(8) NOT NULL,
		dir CHAR(4) NOT NULL,
		p0 DECIMAL(14,4) NOT NULL,
		p1 DECIMAL(14,4) NULL,
		placed_at DATETIME NOT NULL,
		resolves_at DATETIME NOT NULL,
		result VARCHAR(6) NULL,
		points SMALLINT NOT NULL DEFAULT 0,
		PRIMARY KEY  (id),
		KEY user_open (user_id, result),
		KEY room_time (room, placed_at)
	) $c;" );
	dbDelta( 'CREATE TABLE ' . sml_arc_table( 'points' ) . " (
		user_id BIGINT UNSIGNED NOT NULL,
		game VARCHAR(16) NOT NULL,
		period CHAR(8) NOT NULL,
		points INT NOT NULL DEFAULT 0,
		wins INT UNSIGNED NOT NULL DEFAULT 0,
		plays INT UNSIGNED NOT NULL DEFAULT 0,
		streak SMALLINT UNSIGNED NOT NULL DEFAULT 0,
		best_streak SMALLINT UNSIGNED NOT NULL DEFAULT 0,
		updated_at DATETIME NOT NULL,
		PRIMARY KEY  (user_id, game, period),
		KEY ladder (game, period, points)
	) $c;" );
	/* Product decisions the owner approved in session: free tables for everyone, staking on for skill games. */
	update_option( 'sml_wager_master', 1 );
	if ( ! wp_next_scheduled( 'sml_arc_daily' ) ) { wp_schedule_event( strtotime( 'tomorrow 00:10 UTC' ), 'daily', 'sml_arc_daily' ); }
	update_option( 'sml_arc_db_version', SML_ARC_VERSION, false );
}

function sml_arc_day( $ts = 0 ) { return gmdate( 'Ymd', $ts ?: time() ); }
function sml_arc_month( $ts = 0 ) { return gmdate( 'Ym', $ts ?: time() ); }
function sml_arc_now() { return gmdate( 'Y-m-d H:i:s' ); }

/** Tunables, overridable from the option sml_arc_tuning without a deploy. */
function sml_arc_tuning() {
	$d = array(
		'spin_base'        => 1,     /* free spins per day */
		'spin_live_bonus'  => 1,     /* extra spin while watching a live stream */
		'spin_streak_days' => 7,     /* streak length that earns one more spin */
		'arcade_daily_cap' => 300,   /* most Loop Bucks one player can take from the arcade in a day */
		'jackpot_min'      => 25,
		'jackpot_max'      => 5000,
		'jackpot_minutes'  => array( 5, 10, 15, 30, 60 ),
		'ticket_gap'       => 55,    /* seconds between watch tickets */
		'join_tickets'     => 3,
		'tape_seconds'     => 60,
		'tape_daily_max'   => 60,
		'tape_win'         => 10,
		'tape_streak_bonus'=> 5,
		'tape_push'        => 2,
		'tape_daily_prizes'=> array( 50, 25, 10 ),
	);
	$o = get_option( 'sml_arc_tuning', array() );
	return is_array( $o ) ? array_merge( $d, $o ) : $d;
}

/** Adds points to a player's ladder row for a game, for the month and for all time. */
function sml_arc_points( $user_id, $game, $points, $won = null ) {
	global $wpdb;
	$t = sml_arc_table( 'points' );
	foreach ( array( sml_arc_month(), 'all' ) as $period ) {
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $t WHERE user_id = %d AND game = %s AND period = %s", (int) $user_id, $game, $period ), ARRAY_A );
		$streak = (int) ( $row['streak'] ?? 0 );
		if ( $won === true ) { $streak++; } elseif ( $won === false ) { $streak = 0; }
		$best = max( (int) ( $row['best_streak'] ?? 0 ), $streak );
		$wpdb->query( $wpdb->prepare( "INSERT INTO $t (user_id, game, period, points, wins, plays, streak, best_streak, updated_at) VALUES (%d, %s, %s, %d, %d, 1, %d, %d, %s)
			ON DUPLICATE KEY UPDATE points = points + VALUES(points), wins = wins + VALUES(wins), plays = plays + 1, streak = VALUES(streak), best_streak = VALUES(best_streak), updated_at = VALUES(updated_at)",
			(int) $user_id, $game, $period, (int) $points, $won === true ? 1 : 0, $streak, $best, sml_arc_now() ) );
	}
	return $streak;
}

function sml_arc_ladder( $game, $period, $limit = 10 ) {
	global $wpdb;
	$rows = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT user_id, points, wins, plays, streak, best_streak FROM ' . sml_arc_table( 'points' ) . ' WHERE game = %s AND period = %s AND user_id < 999999900 ORDER BY points DESC, wins DESC LIMIT %d', $game, $period, (int) $limit ), ARRAY_A );
	$out = array();
	foreach ( $rows as $i => $r ) { $out[] = array( 'rank' => $i + 1, 'player' => sml_arc_person( (int) $r['user_id'] ), 'points' => (int) $r['points'], 'wins' => (int) $r['wins'], 'plays' => (int) $r['plays'], 'streak' => (int) $r['streak'], 'best' => (int) $r['best_streak'] ); }
	return $out;
}

function sml_arc_person( $uid ) {
	$u = get_userdata( $uid );
	if ( ! $u ) { return array( 'id' => $uid, 'name' => 'Member', 'handle' => '', 'avatar' => '' ); }
	$handle = function_exists( 'sml_members_public_handle' ) ? sml_members_public_handle( $uid ) : ( get_user_meta( $uid, 'sml_public_handle', true ) ?: $u->user_nicename );
	return array( 'id' => $uid, 'name' => $u->display_name, 'handle' => (string) $handle, 'avatar' => get_avatar_url( $uid, array( 'size' => 64 ) ) );
}

/** A player's own row on a ladder. */
function sml_arc_my_rank( $uid, $game, $period ) {
	global $wpdb;
	$t = sml_arc_table( 'points' );
	$row = $wpdb->get_row( $wpdb->prepare( "SELECT points, wins, plays, streak, best_streak FROM $t WHERE user_id = %d AND game = %s AND period = %s", (int) $uid, $game, $period ), ARRAY_A );
	if ( ! $row ) { return null; }
	$rank = 1 + (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $t WHERE game = %s AND period = %s AND user_id < 999999900 AND points > %d", $game, $period, (int) $row['points'] ) );
	return array( 'rank' => $rank, 'points' => (int) $row['points'], 'wins' => (int) $row['wins'], 'plays' => (int) $row['plays'], 'streak' => (int) $row['streak'], 'best' => (int) $row['best_streak'] );
}
