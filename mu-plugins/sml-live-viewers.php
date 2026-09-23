<?php
/**
 * Plugin Name: SML Live Viewers
 * Description: Real viewer counts and per-viewer facts for live and scheduled-live streams. The Watch Page sends a heartbeat (POST /sml-lw/v1/presence {handle, stream, ctx}); every real viewer counts, signed in or not. 1.1.0 keeps, per viewer, where they came from (referrer / campaign / in-site surface), device, country + city, time actually watched, and a per-minute audience series, which the Go Live "Live Insights" panel (sml-live-insights) reads in real time.
 * Version: 1.1.0
 * Author: StockMarketLoop
 *
 * Privacy: anonymous viewers are a one-way hash of IP + browser + the day, never the raw values. No IP address is stored; the
 * location is reduced to country + city at the moment of the first heartbeat. Creators only ever see aggregates.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

const SML_LV_DB     = 2;
const SML_LV_WINDOW = 60;   /* seconds a heartbeat counts as "watching now" (the page beats every 20 s; older cached pages beat every 45 s) */

function sml_lv_t()  { global $wpdb; return $wpdb->prefix . 'sml_live_viewers'; }
function sml_lv_tm() { global $wpdb; return $wpdb->prefix . 'sml_live_minutes'; }
function sml_lv_te() { global $wpdb; return $wpdb->prefix . 'sml_live_events'; }

function sml_lv_install() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$cc = $wpdb->get_charset_collate();
	dbDelta( 'CREATE TABLE ' . sml_lv_t() . " (
		stream_key varchar(80) NOT NULL,
		viewer char(40) NOT NULL,
		host bigint(20) unsigned NOT NULL DEFAULT 0,
		user_id bigint(20) unsigned NOT NULL DEFAULT 0,
		first_seen int(10) unsigned NOT NULL,
		last_seen int(10) unsigned NOT NULL,
		beats int(10) unsigned NOT NULL DEFAULT 1,
		watch_secs int(10) unsigned NOT NULL DEFAULT 0,
		last_min int(10) unsigned NOT NULL DEFAULT 0,
		src varchar(24) NOT NULL DEFAULT '',
		refhost varchar(80) NOT NULL DEFAULT '',
		surf varchar(24) NOT NULL DEFAULT '',
		dev char(1) NOT NULL DEFAULT '',
		country char(2) NOT NULL DEFAULT '',
		city varchar(64) NOT NULL DEFAULT '',
		returning_v tinyint(1) NOT NULL DEFAULT 0,
		PRIMARY KEY  (stream_key, viewer),
		KEY key_seen (stream_key, last_seen),
		KEY host_key (host, stream_key)
	) $cc;" );
	dbDelta( 'CREATE TABLE ' . sml_lv_tm() . " (
		stream_key varchar(80) NOT NULL,
		minute int(10) unsigned NOT NULL,
		viewers int(10) unsigned NOT NULL DEFAULT 0,
		joins int(10) unsigned NOT NULL DEFAULT 0,
		PRIMARY KEY  (stream_key, minute)
	) $cc;" );
	dbDelta( 'CREATE TABLE ' . sml_lv_te() . " (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		stream_key varchar(80) NOT NULL,
		ts int(10) unsigned NOT NULL,
		type varchar(16) NOT NULL,
		user_id bigint(20) unsigned NOT NULL DEFAULT 0,
		val varchar(64) NOT NULL DEFAULT '',
		PRIMARY KEY  (id),
		KEY stream_ts (stream_key, ts)
	) $cc;" );
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

/** True when $stream_id is one of $uid's own streams (live, scheduled, ended or otherwise). */
function sml_lv_owns_stream( $uid, $stream_id ) {
	if ( ! $uid || '' === $stream_id || ! function_exists( 'sml_scheduled_live_library' ) ) { return false; }
	$rows = (array) sml_scheduled_live_library( $uid );
	if ( isset( $rows[ $stream_id ] ) ) { return true; }
	$cur = function_exists( 'sml_scheduled_live_row' ) ? sml_scheduled_live_row( $uid ) : array();
	return is_array( $cur ) && (string) ( $cur['id'] ?? '' ) === $stream_id;
}

/** Viewers are counted against the stream (live, or scheduled and named by the page) when there is one, otherwise against the page. */
function sml_lv_key( $handle, $uid, $stream_hint = '' ) {
	$sid = sml_lv_live_stream( $uid );
	if ( ! $sid && '' !== $stream_hint && sml_lv_owns_stream( $uid, $stream_hint ) ) { $sid = $stream_hint; }
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

/* ------------------------------------------------------------------ where a viewer came from */

function sml_lv_host_is( $host, array $domains ) {
	foreach ( $domains as $d ) { if ( $host === $d || ( strlen( $host ) > strlen( $d ) && '.' . $d === substr( $host, -strlen( $d ) - 1 ) ) ) { return true; } }
	return false;
}

/** Source buckets. Keys are stable; sml-live-insights turns them into labels. */
function sml_lv_source_domains() {
	return array(
		'x'         => array( 'x.com', 'twitter.com', 't.co' ),
		'facebook'  => array( 'facebook.com', 'fb.com', 'fb.me', 'messenger.com' ),
		'linkedin'  => array( 'linkedin.com', 'lnkd.in' ),
		'reddit'    => array( 'reddit.com', 'redd.it' ),
		'discord'   => array( 'discord.com', 'discordapp.com', 'discord.gg' ),
		'telegram'  => array( 't.me', 'telegram.org', 'telegram.me' ),
		'tiktok'    => array( 'tiktok.com' ),
		'instagram' => array( 'instagram.com' ),
		'youtube'   => array( 'youtube.com', 'youtu.be' ),
		'bluesky'   => array( 'bsky.app', 'bsky.social' ),
		'threads'   => array( 'threads.net', 'threads.com' ),
		'tumblr'    => array( 'tumblr.com' ),
		'whatsapp'  => array( 'whatsapp.com', 'wa.me' ),
		'stocktwits'=> array( 'stocktwits.com' ),
		'search'    => array( 'bing.com', 'duckduckgo.com', 'yahoo.com', 'brave.com', 'ecosia.org', 'yandex.com', 'yandex.ru', 'baidu.com', 'startpage.com' ),
		'email'     => array( 'mail.google.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com' ),
	);
}

function sml_lv_surfaces() { return array( 'home', 'channel', 'live_hub', 'group', 'video', 'profile', 'qa', 'ticker', 'terminal', 'letters', 'search', 'notify', 'other' ); }

/** [ source, referrer host, in-site surface ] from what the page sent. Nothing here is trusted beyond a whitelist. */
function sml_lv_classify( $ctx ) {
	$ctx  = is_array( $ctx ) ? $ctx : array();
	$ref  = strtolower( preg_replace( '/^www\./', '', preg_replace( '/[^a-z0-9.\-]/i', '', (string) ( $ctx['ref'] ?? '' ) ) ) );
	$ref  = substr( $ref, 0, 80 );
	$utm  = substr( sanitize_key( (string) ( $ctx['utm'] ?? '' ) ), 0, 24 );
	$surf = sanitize_key( (string) ( $ctx['surf'] ?? '' ) );
	$surf = in_array( $surf, sml_lv_surfaces(), true ) ? $surf : '';
	$home = strtolower( preg_replace( '/^www\./', '', (string) wp_parse_url( home_url(), PHP_URL_HOST ) ) );

	/* a campaign tag or a notification link beats the referrer (referrers are often stripped) */
	if ( in_array( $utm, array( 'notify', 'notification', 'push', 'loopkick', 'loop-kick' ), true ) ) { return array( 'site', $ref, 'notify' ); }
	if ( in_array( $utm, array( 'email', 'newsletter', 'mail' ), true ) ) { return array( 'email', $ref, '' ); }
	$domains = sml_lv_source_domains();
	if ( '' !== $utm ) {
		if ( isset( $domains[ $utm ] ) ) { return array( $utm, $ref, '' ); }
		if ( 'twitter' === $utm ) { return array( 'x', $ref, '' ); }
		if ( in_array( $utm, array( 'google', 'bing', 'duckduckgo' ), true ) ) { return array( 'search', $ref, '' ); }
	}
	if ( '' === $ref ) { return array( 'direct', '', '' ); }
	if ( $ref === $home || sml_lv_host_is( $ref, array( $home ) ) ) { return array( 'site', $ref, $surf ?: 'other' ); }
	foreach ( $domains as $key => $list ) { if ( sml_lv_host_is( $ref, $list ) ) { return array( $key, $ref, '' ); } }
	if ( preg_match( '#(^|\.)google\.[a-z.]{2,6}$#', $ref ) ) { return array( 'search', $ref, '' ); }
	return array( 'other', $ref, '' );
}

function sml_lv_device() {
	$ua = (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' );
	if ( preg_match( '/ipad|tablet|kindle|silk|playbook/i', $ua ) ) { return 't'; }
	if ( preg_match( '/mobi|iphone|ipod|android.*mobile|windows phone|blackberry/i', $ua ) ) { return 'm'; }
	return 'd';
}

/** [ country code, city ] — from the local DB-IP file, at the first heartbeat only. No IP is stored. */
function sml_lv_geo() {
	if ( ! function_exists( 'sml_gl_client_ip' ) || ! function_exists( 'sml_gl_mmdb_lookup' ) ) { return array( '', '' ); }
	$ip = sml_gl_client_ip();
	if ( '' === $ip ) { return array( '', '' ); }
	$g = sml_gl_mmdb_lookup( $ip );
	return is_array( $g ) ? array( strtoupper( substr( (string) ( $g['country'] ?? '' ), 0, 2 ) ), substr( (string) ( $g['city'] ?? '' ), 0, 64 ) ) : array( '', '' );
}

/* ------------------------------------------------------------------ counting */

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

/**
 * One heartbeat. Returns the number watching now (the host is never counted).
 * $ctx (first heartbeat only is used): { ref: referrer host, utm: campaign tag, surf: in-site surface the viewer came from }.
 */
function sml_lv_beat( $handle, $stream_hint = '', $ctx = array() ) {
	global $wpdb;
	$host = sml_lv_host( $handle );
	if ( ! $host ) { return 0; }
	$key = sml_lv_key( $handle, $host, $stream_hint );
	list( $viewer, $uid ) = sml_lv_viewer_id();
	if ( $uid !== $host && ! sml_lv_is_bot() ) {
		$now = time();
		$min = intdiv( $now, 60 );
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT last_seen, last_min FROM ' . sml_lv_t() . ' WHERE stream_key = %s AND viewer = %s', $key, $viewer ), ARRAY_A );
		if ( ! $row ) {
			list( $src, $refhost, $surf ) = sml_lv_classify( $ctx );
			list( $country, $city )       = sml_lv_geo();
			$returning = 0;
			if ( $uid ) {
				$returning = (int) (bool) $wpdb->get_var( $wpdb->prepare( 'SELECT 1 FROM ' . sml_lv_t() . ' WHERE host = %d AND viewer = %s AND stream_key <> %s LIMIT 1', $host, $viewer, $key ) );
			}
			$wpdb->query( $wpdb->prepare(
				'INSERT IGNORE INTO ' . sml_lv_t() . ' (stream_key, viewer, host, user_id, first_seen, last_seen, beats, watch_secs, last_min, src, refhost, surf, dev, country, city, returning_v)
				 VALUES (%s, %s, %d, %d, %d, %d, 1, 0, %d, %s, %s, %s, %s, %s, %s, %d)',
				$key, $viewer, $host, $uid, $now, $now, $min, $src, $refhost, $surf, sml_lv_device(), $country, $city, $returning
			) );
			$wpdb->query( $wpdb->prepare( 'INSERT INTO ' . sml_lv_tm() . ' (stream_key, minute, viewers, joins) VALUES (%s, %d, 1, 1) ON DUPLICATE KEY UPDATE viewers = viewers + 1, joins = joins + 1', $key, $min ) );
		} else {
			$delta = $now - (int) $row['last_seen'];
			$add   = ( $delta > 0 && $delta <= 60 ) ? $delta : 0;   /* continuous watching only: a long gap is time away, not time watched */
			$wpdb->query( $wpdb->prepare(
				'UPDATE ' . sml_lv_t() . ' SET beats = beats + IF(last_seen < %d, 1, 0), watch_secs = watch_secs + %d, last_seen = GREATEST(last_seen, %d), last_min = %d, host = IF(host = 0, %d, host), user_id = IF(user_id = 0, %d, user_id) WHERE stream_key = %s AND viewer = %s',
				$now - 10, $add, $now, $min, $host, $uid, $key, $viewer
			) );
			if ( (int) $row['last_min'] !== $min ) {
				$wpdb->query( $wpdb->prepare( 'INSERT INTO ' . sml_lv_tm() . ' (stream_key, minute, viewers, joins) VALUES (%s, %d, 1, 0) ON DUPLICATE KEY UPDATE viewers = viewers + 1', $key, $min ) );
			}
		}
	}
	$count = sml_lv_count( $key );
	sml_lv_note_peak( $host, $key, $count );
	return $count;
}

/** The viewer closed the page: stop counting them at once instead of after the heartbeat window. */
function sml_lv_leave( $handle, $stream_hint = '' ) {
	global $wpdb;
	$host = sml_lv_host( $handle );
	if ( ! $host ) { return; }
	list( $viewer ) = sml_lv_viewer_id();
	$key = sml_lv_key( $handle, $host, $stream_hint );
	$wpdb->query( $wpdb->prepare( 'UPDATE ' . sml_lv_t() . ' SET last_seen = LEAST(last_seen, %d) WHERE stream_key = %s AND viewer = %s', time() - SML_LV_WINDOW - 1, $key, $viewer ) );
}

/* The Watch Page's presence route: every real viewer counts, not only signed-in ones.
   Same request/response shape as WPCode #6611 ({handle} -> {ok, count}); `stream`, `ctx` and `leave` are optional extras. */
add_filter( 'rest_pre_dispatch', function ( $result, $server, $request ) {
	if ( null !== $result || ! $request instanceof WP_REST_Request || '/sml-lw/v1/presence' !== $request->get_route() ) { return $result; }
	$handle = sml_lv_clean_handle( $request->get_param( 'handle' ) );
	if ( '' === $handle ) { return new WP_Error( 'sml_lv_handle', 'Missing stream handle.', array( 'status' => 400 ) ); }
	$stream = preg_replace( '/[^A-Za-z0-9]/', '', (string) $request->get_param( 'stream' ) );
	$stream = substr( $stream, 0, 32 );
	if ( 'POST' === strtoupper( $request->get_method() ) ) {
		if ( $request->get_param( 'leave' ) ) { sml_lv_leave( $handle, $stream ); $count = 0; }
		else { $count = sml_lv_beat( $handle, $stream, $request->get_param( 'ctx' ) ); }
	} else {
		$host  = sml_lv_host( $handle );
		$count = $host ? sml_lv_count( sml_lv_key( $handle, $host, $stream ) ) : 0;
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

/** Log something that happened during a stream (a new subscriber, ...). $when defaults to now. */
function sml_lv_log_event( $stream_key, $type, $user_id = 0, $val = '', $when = 0 ) {
	global $wpdb;
	if ( '' === $stream_key ) { return; }
	$wpdb->insert( sml_lv_te(), array( 'stream_key' => substr( $stream_key, 0, 80 ), 'ts' => $when ?: time(), 'type' => substr( sanitize_key( $type ), 0, 16 ), 'user_id' => (int) $user_id, 'val' => substr( (string) $val, 0, 64 ) ) );
}

/* Housekeeping: heartbeat rows older than 180 days (stream stats keep peak + unique in user meta
   only for the peak; unique counts come from these rows, so they are kept for half a year). */
add_action( 'init', function () { if ( ! wp_next_scheduled( 'sml_lv_prune' ) ) { wp_schedule_event( time() + 900, 'daily', 'sml_lv_prune' ); } } );
add_action( 'sml_lv_prune', function () {
	global $wpdb;
	$cut = time() - 180 * DAY_IN_SECONDS;
	$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . sml_lv_t() . ' WHERE last_seen < %d', $cut ) );
	$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . sml_lv_tm() . ' WHERE minute < %d', intdiv( $cut, 60 ) ) );
	$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . sml_lv_te() . ' WHERE ts < %d', $cut ) );
} );
