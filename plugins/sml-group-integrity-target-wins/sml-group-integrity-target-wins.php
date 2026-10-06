<?php
/**
 * Plugin Name: SML Group Integrity - Target Hit Wins
 * Description: A group alert whose price target is hit settles as a win right away (it no longer waits for the end of the tracking window). Works on top of StockMarketLoop Group Integrity.
 * Version: 1.0.0
 * Requires PHP: 7.4
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_GITW_VERSION', '1.0.0' );

/* Pure helpers (unit-tested). */

/** Did a bar series, starting at the alert, reach the target? $bars are [t(ms),h,l,c]. */
function sml_gitw_target_hit( array $bars, array $row ): bool {
	$target = (float) ( $row['target_price'] ?? 0 );
	if ( $target <= 0 ) { return false; }
	$short    = 'short' === ( $row['direction'] ?? 'long' );
	$start_ms = strtotime( ( $row['alert_at_utc'] ?? '' ) . ' UTC' ) * 1000;
	foreach ( $bars as $bar ) {
		if ( ! isset( $bar['t'], $bar['h'], $bar['l'] ) || (float) $bar['t'] < $start_ms ) { continue; }
		if ( $short ? (float) $bar['l'] <= $target : (float) $bar['h'] >= $target ) { return true; }
	}
	return false;
}

/** The return the alert banked by reaching its target, in percent. */
function sml_gitw_target_return( array $row ): ?float {
	$entry = (float) ( $row['entry_price'] ?? 0 );
	$target = (float) ( $row['target_price'] ?? 0 );
	if ( $entry <= 0 || $target <= 0 ) { return null; }
	return 'short' === ( $row['direction'] ?? 'long' ) ? ( $entry - $target ) / $entry * 100 : ( $target - $entry ) / $entry * 100;
}

/* WordPress side. */

/* Only act when the main plugin's table has the columns this relies on, so a different version can never be damaged. */
function sml_gitw_ready(): bool {
	static $ok = null;
	if ( null !== $ok ) { return $ok; }
	global $wpdb;
	$ok = false;
	if ( ! function_exists( 'sml_gi_table' ) || ! isset( $wpdb ) ) { return $ok; }
	$cols = (array) $wpdb->get_col( 'SHOW COLUMNS FROM ' . sml_gi_table(), 0 );
	$ok = ! array_diff( array( 'status', 'outcome', 'target_hit', 'target_price', 'entry_price', 'direction', 'final_return_pct', 'settled_at_utc', 'group_id' ), $cols );
	return $ok;
}

/** Settle every still-tracking alert (optionally of one group) that has reached its target as a win. */
function sml_gitw_settle( int $group_id = 0 ): int {
	global $wpdb;
	if ( ! sml_gitw_ready() ) { return 0; }
	$table = sml_gi_table();
	$where = "status='tracking' AND target_hit=1 AND target_price > 0" . ( $group_id ? $wpdb->prepare( ' AND group_id=%d', $group_id ) : '' );
	$rows  = $wpdb->get_results( "SELECT id, direction, entry_price, target_price FROM {$table} WHERE {$where} LIMIT 500", ARRAY_A );
	$n = 0;
	foreach ( (array) $rows as $row ) {
		$ret = sml_gitw_target_return( $row );
		$ok  = $wpdb->update( $table, array(
			'status' => 'settled', 'outcome' => 'win', 'final_return_pct' => $ret,
			'settled_at_utc' => current_time( 'mysql', true ), 'updated_at' => current_time( 'mysql', true ),
		), array( 'id' => (int) $row['id'], 'status' => 'tracking' ) );
		if ( $ok ) { $n++; }
	}
	return $n;
}

/** Look at tracking alerts the main plugin has not flagged yet, a few at a time, so a target hit is caught within minutes. */
function sml_gitw_scan( int $group_id = 0, int $limit = 20 ): void {
	global $wpdb;
	if ( ! sml_gitw_ready() || ! function_exists( 'sml_gi_history' ) ) { return; }
	$table = sml_gi_table();
	$where = "status='tracking' AND target_hit=0 AND target_price > 0" . ( $group_id ? $wpdb->prepare( ' AND group_id=%d', $group_id ) : '' );
	$rows  = $wpdb->get_results( "SELECT * FROM {$table} WHERE {$where} ORDER BY alert_at_utc DESC LIMIT 200", ARRAY_A );
	$seen = 0;
	foreach ( (array) $rows as $row ) {
		if ( $seen >= $limit ) { break; }
		$tkey = 'sml_gitw_' . (int) $row['id'];
		if ( get_transient( $tkey ) ) { continue; }
		set_transient( $tkey, 1, 300 );
		$seen++;
		if ( sml_gitw_target_hit( (array) sml_gi_history( $row['symbol'] ), $row ) ) {
			$wpdb->update( $table, array( 'target_hit' => 1, 'updated_at' => current_time( 'mysql', true ) ), array( 'id' => (int) $row['id'] ) );
		}
	}
}

function sml_gitw_run( int $group_id = 0 ): int {
	sml_gitw_scan( $group_id );
	$n = sml_gitw_settle( $group_id );
	if ( $n && $group_id && function_exists( 'sml_gi_update_summary' ) ) { sml_gi_update_summary( $group_id ); }
	return $n;
}

/* Every five minutes, after the main plugin's own refresh. */
add_action( 'sml_gi_refresh_performance', static function () { sml_gitw_run( 0 ); }, 30 );

/* When the record is read: settle first, then rebuild the numbers so the card is right on this very request. */
add_filter( 'rest_post_dispatch', static function ( $response, $server, $request ) {
	if ( ! $request instanceof WP_REST_Request || ! $response instanceof WP_REST_Response ) { return $response; }
	if ( ! in_array( $request->get_route(), array( '/sml/v1/group/performance', '/sml/v1/group/performance-v2' ), true ) || ! sml_gitw_ready() ) { return $response; }
	$group_id = absint( $request->get_param( 'group_id' ) );
	if ( ! $group_id || $response->get_status() >= 300 ) { return $response; }
	sml_gitw_run( $group_id );
	if ( ! function_exists( 'sml_gi_stats' ) ) { return $response; }
	$data = $response->get_data();
	if ( ! is_array( $data ) || ! isset( $data['performance'] ) || ! is_array( $data['performance'] ) ) { return $response; }
	$channel_id = absint( $request->get_param( 'channel_id' ) );
	$fresh = sml_gi_stats( $group_id, $channel_id );
	$old   = $data['performance'];
	$perf  = array_merge( $old, array_intersect_key( $fresh, array_flip( array( 'sample_size', 'wins', 'losses', 'win_rate', 'open_alerts', 'average_final_return_pct', 'best_peak_gain_pct', 'recent_loss', 'recent_alerts' ) ) ) );
	$perf['methodology'] = ( isset( $old['methodology'] ) ? (string) $old['methodology'] . ' ' : '' ) . 'An alert whose price target is hit settles as a win as soon as the target is reached.';
	$data['performance'] = $perf;
	$response->set_data( $data );
	return $response;
}, 40, 3 );
