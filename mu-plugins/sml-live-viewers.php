<?php
/**
 * Plugin Name: SML Live Viewers
 * Description: Real viewer counts for live streams. The Watch Page already sends a heartbeat every 45 s (POST /sml-lw/v1/presence {handle}); it only counted signed-in viewers and kept nothing per stream. This counts every real viewer (signed in or not, bots excluded, the host excluded), keeps per-stream peak and unique viewers for Creator Studio, and gives the Go Live studio the Watch Page audience for channel streams (which showed 0). 2026-09-19.
 * Version: 1.0.0
 * Author: StockMarketLoop
 *
 * Privacy: anonymous viewers are a one-way hash of IP + browser + the day, never the raw values.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

const SML_LV_DB     = 1;
const SML_LV_WINDOW = 90;   /* seconds a heartbeat counts as "watching now" (the page beats every 45 s) */

function sml_lv_t() { global $wpdb; return $wpdb->prefix . 'sml_live_viewers'; }

function sml_lv_install() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta( 'CREATE TABLE ' . sml_lv_t() . " (
		stream_key varchar(80) NOT NULL,
		viewer char(40) NOT NULL,
		user_id bigint(20) unsigned NOT NULL DEFAULT 0,
		first_seen int(10) unsigned NOT NULL,
		last_seen int(10) unsigned NOT NULL,
		beats int(10) unsigned NOT NULL DEFAULT 1,
		PRIMARY KEY  (stream_key, viewer),
		KEY key_seen (stream_key, last_seen)
	) " . $wpdb->get_charset_collate() . ';' );
	update_option( 'sml_lv_db', SML_LV_DB, false );
}
add_action( 'init', function () { if ( (int) get_option( 'sml_lv_db' ) < SML_LV_DB ) { sml_lv_install(); } }, 5 );

function sml_lv_clean_handle( $raw ) { return preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $raw ); }

/** The creator behind a Watch Page handle. */
function sml_lv_host( $handle ) {
	if ( '' === $handle ) { return 0; }
	if ( function_exists( 'sml_scheduled_live_user_for_handle' ) ) {
		$u = sml_scheduled_live_user_for_handle( $handle );
		if ( $u instanceof WP_User ) { return (int) $u->ID; }
		if ( is_numeric( $u ) ) { return (int) $u; }
	}
	$u = get_user_by( 'slug', $handle );
	return $u ? (int) $u->ID : 0;
}

/** The creator's stream that is live right now ('' when none). */
function sml_lv_live_stream( $uid ) {
	if ( ! $uid || ! function_exists( 'sml_scheduled_live_library' ) ) { return ''; }
	$best = ''; $best_t = 0;
	$rows = (array) sml_scheduled_live_library( $uid );
	$cur  = function_exists( 'sml_scheduled_live_row' ) ? sml_scheduled_live_row( $uid ) : array();
	if ( is_array( $cur ) && ! empty( $cur['id'] ) ) { $rows[ $cur['id'] ] = $rows[ $cur['id'] ] ?? $cur; }
	foreach ( $rows as $r ) {
		if ( ! is_array( $r ) || empty( $r['id'] ) || 'live' !== (string) ( $r['status'] ?? '' ) ) { continue; }
		$t = (int) strtotime( (string) ( $r['started_at'] ?? $r['scheduled_at'] ?? '' ) );
		if ( $t >= $best_t ) { $best = (string) $r['id']; $best_t = $t; }
	}
	return $best;
}

/** Viewers are counted against the live stream when one is on air, otherwise against the page. */
function sml_lv_key( $handle, $uid ) {
	$sid = sml_lv_live_stream( $uid );
	return $sid ? 's:' . $sid : 'h:' . strtolower( $handle );
}

function sml_lv_is_bot() {
	$ua = (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' );
	return '' === $ua || (bool) preg_match( '/bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor|curl|wget|python|httpclient/i', $ua );
}

function sml_lv_viewer_id() {
	$uid = get_current_user_id();
	if ( ! $uid && defined( 'LOGGED_IN_COOKIE' ) && ! empty( $_COOKIE[ LOGGED_IN_COOKIE ] ) ) {
		$uid = (int) wp_validate_auth_cookie( $_COOKIE[ LOGGED_IN_COOKIE ], 'logged_in' );
	}
	if ( $uid ) { return array( sha1( 'u:' . $uid ), $uid ); }
	$ip = (string) ( $_SERVER['REMOTE_ADDR'] ?? '' );
	$ua = (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' );
	return array( sha1( 'a:' . $ip . '|' . $ua . '|' . gmdate( 'Y-m-d' ) . '|' . wp_salt( 'nonce' ) ), 0 );
}

function sml_lv_count( $key ) {
	global $wpdb;
	return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . sml_lv_t() . ' WHERE stream_key = %s AND last_seen >= %d', $key, time() - SML_LV_WINDOW ) );
}

/** Peak + unique viewers of a stream (tracked = any heartbeat was ever recorded for it). */
function sml_lv_stream_stats( $uid, $stream_id ) {
	global $wpdb;
	$stats = get_user_meta( (int) $uid, '_sml_live_viewer_stats', true );
	$s     = is_array( $stats ) && isset( $stats[ $stream_id ] ) && is_array( $stats[ $stream_id ] ) ? $stats[ $stream_id ] : array();
	$uniq  = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . sml_lv_t() . ' WHERE stream_key = %s', 's:' . $stream_id ) );
	return array(
		'tracked' => $uniq > 0 || ! empty( $s ),
		'now'     => sml_lv_count( 's:' . $stream_id ),
		'peak'    => (int) ( $s['peak'] ?? 0 ),
		'peak_at' => (string) ( $s['peak_at'] ?? '' ),
		'unique'  => $uniq,
	);
}

function sml_lv_note_peak( $uid, $key, $count ) {
	if ( 0 !== strpos( $key, 's:' ) || $count <= 0 ) { return; }
	$sid   = substr( $key, 2 );
	$stats = get_user_meta( (int) $uid, '_sml_live_viewer_stats', true );
	$stats = is_array( $stats ) ? $stats : array();
	if ( $count > (int) ( $stats[ $sid ]['peak'] ?? 0 ) ) {
		$stats[ $sid ] = array( 'peak' => $count, 'peak_at' => gmdate( 'c' ) );
		if ( count( $stats ) > 300 ) { $stats = array_slice( $stats, -300, null, true ); }
		update_user_meta( (int) $uid, '_sml_live_viewer_stats', $stats );
	}
}

/** One heartbeat. Returns the number watching now (the host is never counted). */
function sml_lv_beat( $handle ) {
	global $wpdb;
	$host = sml_lv_host( $handle );
	if ( ! $host ) { return 0; }
	$key = sml_lv_key( $handle, $host );
	list( $viewer, $uid ) = sml_lv_viewer_id();
	if ( $uid !== $host && ! sml_lv_is_bot() ) {
		$now = time();
		$wpdb->query( $wpdb->prepare(
			'INSERT INTO ' . sml_lv_t() . ' (stream_key, viewer, user_id, first_seen, last_seen, beats) VALUES (%s, %s, %d, %d, %d, 1)
			 ON DUPLICATE KEY UPDATE beats = beats + IF(last_seen < %d, 1, 0), last_seen = GREATEST(last_seen, VALUES(last_seen))',
			$key, $viewer, $uid, $now, $now, $now - 20
		) );
	}
	$count = sml_lv_count( $key );
	sml_lv_note_peak( $host, $key, $count );
	return $count;
}

/* The Watch Page's presence route: every real viewer counts, not only signed-in ones.
   Same request/response shape as WPCode #6611 ({handle} -> {ok, count}). */
add_filter( 'rest_pre_dispatch', function ( $result, $server, $request ) {
	if ( null !== $result || ! $request instanceof WP_REST_Request || '/sml-lw/v1/presence' !== $request->get_route() ) { return $result; }
	$handle = sml_lv_clean_handle( $request->get_param( 'handle' ) );
	if ( '' === $handle ) { return new WP_Error( 'sml_lv_handle', 'Missing stream handle.', array( 'status' => 400 ) ); }
	if ( 'POST' === strtoupper( $request->get_method() ) ) {
		$count = sml_lv_beat( $handle );
	} else {
		$host  = sml_lv_host( $handle );
		$count = $host ? sml_lv_count( sml_lv_key( $handle, $host ) ) : 0;
	}
	$res = rest_ensure_response( array( 'ok' => true, 'count' => $count ) );
	$res->header( 'Cache-Control', 'no-store' );
	return $res;
}, -10, 3 );

/* Go Live studio: its Viewers tile read group-room presence only, so a channel stream showed 0 while
   people watched the Watch Page. The host's rooms now report the larger of the two. */
add_filter( 'rest_request_after_callbacks', function ( $response, $handler, $request ) {
	if ( ! $request instanceof WP_REST_Request || '/sml-group-live/v1/rooms' !== $request->get_route() || is_wp_error( $response ) ) { return $response; }
	$uid = get_current_user_id();
	if ( ! $uid ) { return $response; }
	$is_obj = $response instanceof WP_REST_Response;
	$data   = $is_obj ? $response->get_data() : $response;
	if ( ! is_array( $data ) || empty( $data['rooms'] ) ) { return $response; }
	$handle = function_exists( 'sml_scheduled_live_handle_for_user' ) ? sml_lv_clean_handle( sml_scheduled_live_handle_for_user( $uid ) ) : '';
	$watch  = $handle ? sml_lv_count( sml_lv_key( $handle, $uid ) ) : 0;
	if ( ! $watch ) { return $response; }
	foreach ( $data['rooms'] as &$room ) {
		if ( (int) ( $room['host_id'] ?? 0 ) !== $uid ) { continue; }
		$room['watch_viewers']  = $watch;
		$room['viewer_count']   = max( (int) ( $room['viewer_count'] ?? 0 ), $watch );
		$room['audience_count'] = max( (int) ( $room['audience_count'] ?? 0 ), $watch );
	}
	unset( $room );
	if ( $is_obj ) { $response->set_data( $data ); return $response; }
	return $data;
}, 20, 3 );

/* Housekeeping: heartbeat rows older than 180 days (stream stats keep peak + unique in user meta
   only for the peak; unique counts come from these rows, so they are kept for half a year). */
add_action( 'init', function () { if ( ! wp_next_scheduled( 'sml_lv_prune' ) ) { wp_schedule_event( time() + 900, 'daily', 'sml_lv_prune' ); } } );
add_action( 'sml_lv_prune', function () { global $wpdb; $wpdb->query( $wpdb->prepare( 'DELETE FROM ' . sml_lv_t() . ' WHERE last_seen < %d', time() - 180 * DAY_IN_SECONDS ) ); } );
