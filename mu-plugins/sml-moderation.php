<?php
/**
 * Plugin Name: SML Moderation Monitor
 * Description: Admin-only moderation intelligence for the Analytics dashboard: who shares an IP or a device fingerprint, how accounts post (bursts, copy-paste, link drops, bot-like rhythm) and what kind of content they post. Read from the site's own tables; new activity is also stamped with IP + device fingerprint.
 * Version: 1.0.0
 *
 * REST /wp-json/sml-moderation/v1/   (every route except /fp requires manage_options)
 *   GET  /overview?days=      content mix, hourly rhythm, top posters, cluster counts
 *   GET  /users?days=&sort=   per-account posting-pattern stats + transparent risk score
 *   GET  /clusters?days=      IPs and device fingerprints shared by 2+ accounts
 *   GET  /user/{id}?days=     one account: IPs, devices, sessions, timeline, mix
 *   GET  /feed?limit=&type=&user=   latest activity, newest first
 *   POST /fp                  signed-in members: their browser's device fingerprint (stored against their account)
 *
 * Nothing here is shown to creators or members. A score is a prompt to look, never a verdict: shared networks (offices, phone carriers, family) are labelled as such.
 * Events older than 120 days are pruned daily. ROLLBACK: delete this file (tables stay, inert).
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

const SML_MOD_DB = 1;
const SML_MOD_KEEP_DAYS = 120;

function sml_mod_t( $n ) { global $wpdb; return $wpdb->prefix . 'sml_mod_' . $n; }

function sml_mod_install() {
	if ( (int) get_option( 'sml_mod_db', 0 ) >= SML_MOD_DB ) { return; }
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$c = $wpdb->get_charset_collate();
	dbDelta( 'CREATE TABLE ' . sml_mod_t( 'events' ) . " (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		user_id BIGINT UNSIGNED NOT NULL,
		ctype VARCHAR(24) NOT NULL,
		target VARCHAR(80) NOT NULL DEFAULT '',
		ip VARBINARY(45) NULL,
		server_fp CHAR(64) NOT NULL DEFAULT '',
		client_fp CHAR(64) NOT NULL DEFAULT '',
		text_hash CHAR(40) NOT NULL DEFAULT '',
		text_len INT UNSIGNED NOT NULL DEFAULT 0,
		has_link TINYINT(1) NOT NULL DEFAULT 0,
		snippet VARCHAR(160) NOT NULL DEFAULT '',
		created_at DATETIME NOT NULL,
		PRIMARY KEY  (id),
		KEY user_time (user_id, created_at),
		KEY created (created_at),
		KEY ip (ip),
		KEY client_fp (client_fp)
	) $c;" );
	dbDelta( 'CREATE TABLE ' . sml_mod_t( 'devices' ) . " (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		user_id BIGINT UNSIGNED NOT NULL,
		client_fp CHAR(64) NOT NULL,
		server_fp CHAR(64) NOT NULL DEFAULT '',
		ip VARBINARY(45) NULL,
		country_code CHAR(2) NOT NULL DEFAULT '',
		region VARCHAR(120) NOT NULL DEFAULT '',
		city VARCHAR(120) NOT NULL DEFAULT '',
		ua VARCHAR(400) NOT NULL DEFAULT '',
		fp_json LONGTEXT NULL,
		hits INT UNSIGNED NOT NULL DEFAULT 1,
		first_seen DATETIME NOT NULL,
		last_seen DATETIME NOT NULL,
		PRIMARY KEY  (id),
		UNIQUE KEY user_device (user_id, client_fp, server_fp),
		KEY client_fp (client_fp),
		KEY ip (ip)
	) $c;" );
	update_option( 'sml_mod_db', SML_MOD_DB, false );
}
add_action( 'init', 'sml_mod_install', 25 );

add_action( 'sml_mod_prune', function () {
	global $wpdb;
	$cut = gmdate( 'Y-m-d H:i:s', time() - SML_MOD_KEEP_DAYS * DAY_IN_SECONDS );
	$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . sml_mod_t( 'events' ) . ' WHERE created_at < %s', $cut ) );
	$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . sml_mod_t( 'devices' ) . ' WHERE last_seen < %s', $cut ) );
} );
add_action( 'init', function () { if ( ! wp_next_scheduled( 'sml_mod_prune' ) ) { wp_schedule_event( time() + 3600, 'daily', 'sml_mod_prune' ); } } );

/* ------------------------------------------------------------------ helpers */

function sml_mod_admin() { return current_user_can( 'manage_options' ); }

function sml_mod_ip() {
	if ( function_exists( 'sml_gl_client_ip' ) ) { $ip = sml_gl_client_ip(); if ( $ip ) { return $ip; } }
	$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) wp_unslash( $_SERVER['REMOTE_ADDR'] ) : '';
	return filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '';
}

function sml_mod_server_fp() {
	if ( function_exists( 'sml_lit_server_fp' ) ) { return sml_lit_server_fp(); }
	$p = array();
	foreach ( array( 'HTTP_USER_AGENT', 'HTTP_ACCEPT_LANGUAGE', 'HTTP_ACCEPT_ENCODING', 'HTTP_SEC_CH_UA', 'HTTP_SEC_CH_UA_PLATFORM' ) as $h ) { $p[] = isset( $_SERVER[ $h ] ) ? (string) wp_unslash( $_SERVER[ $h ] ) : ''; }
	return hash( 'sha256', implode( '|', $p ) );
}

function sml_mod_cookie_fp() {
	$v = isset( $_COOKIE['sml_dfp'] ) ? strtolower( (string) $_COOKIE['sml_dfp'] ) : '';
	return preg_match( '/^[a-f0-9]{64}$/', $v ) ? $v : '';
}

function sml_mod_geo( $ip ) {
	static $memo = array();
	if ( ! $ip ) { return array( 'country_code' => '', 'region' => '', 'city' => '' ); }
	if ( isset( $memo[ $ip ] ) ) { return $memo[ $ip ]; }
	$g = function_exists( 'sml_lit_geo' ) ? sml_lit_geo( $ip ) : array();
	return $memo[ $ip ] = array( 'country_code' => (string) ( $g['country_code'] ?? '' ), 'region' => (string) ( $g['region'] ?? '' ), 'city' => (string) ( $g['city'] ?? '' ) );
}

function sml_mod_norm( $t ) { return trim( preg_replace( '/\s+/u', ' ', mb_strtolower( wp_strip_all_tags( (string) $t ) ) ) ); }
function sml_mod_has_link( $t ) { return (bool) preg_match( '~https?://|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|gg|ly|me|xyz|app|link)\b~i', (string) $t ); }

function sml_mod_user_public( $uid ) {
	static $c = array();
	$uid = (int) $uid;
	if ( isset( $c[ $uid ] ) ) { return $c[ $uid ]; }
	$u = get_userdata( $uid );
	return $c[ $uid ] = $u ? array( 'id' => $uid, 'name' => $u->display_name ?: $u->user_login, 'handle' => $u->user_nicename, 'registered' => $u->user_registered, 'avatar' => get_avatar_url( $uid, array( 'size' => 48 ) ) ) : array( 'id' => $uid, 'name' => 'User #' . $uid, 'handle' => '', 'registered' => '', 'avatar' => '' );
}

/* ------------------------------------------------------------------ stamping new activity with IP + device */

function sml_mod_route_type( $route, $method ) {
	if ( 'POST' !== $method && 'PUT' !== $method ) { return null; }
	$map = array(
		'#^/sml-live-chat/v1/room/([A-Za-z0-9_-]+)/messages/?$#' => 'chat',
		'#^/sml-voice/v1/chat/?$#'                                  => 'chat',
		'#^/sml/v1/group/channel/message/send/?$#'                  => 'group_msg',
		'#^/sml/v1/group/post/?$#'                                  => 'group_post',
		'#^/sml-live-chat-threads/v1/room/([A-Za-z0-9_-]+)/message/\d+/replies/?$#' => 'chat_reply',
		'#^/sml-engage/v1/ask/([A-Za-z0-9_-]+)/?$#'                 => 'qa',
	);
	foreach ( $map as $rx => $type ) { if ( preg_match( $rx, $route, $m ) ) { return array( $type, $m[1] ?? '' ); } }
	return null;
}

add_filter( 'rest_post_dispatch', function ( $result, $server, $request ) {
	$uid = get_current_user_id();
	if ( ! $uid || ! $result instanceof WP_REST_Response || $result->is_error() || $result->get_status() >= 300 ) { return $result; }
	$hit = sml_mod_route_type( $request->get_route(), $request->get_method() );
	if ( ! $hit ) { return $result; }
	$text = '';
	foreach ( array( 'body', 'message', 'text', 'content' ) as $f ) { $v = $request->get_param( $f ); if ( is_string( $v ) && '' !== trim( $v ) ) { $text = $v; break; } }
	if ( '' === trim( $text ) ) { return $result; }
	global $wpdb;
	$ip = sml_mod_ip();
	$norm = sml_mod_norm( $text );
	$target = $hit[1] ?: (string) $request->get_param( 'channel_id' );
	$wpdb->insert( sml_mod_t( 'events' ), array(
		'user_id' => $uid, 'ctype' => $hit[0], 'target' => substr( (string) $target, 0, 80 ), 'ip' => $ip ?: null,
		'server_fp' => sml_mod_server_fp(), 'client_fp' => sml_mod_cookie_fp(),
		'text_hash' => sha1( $norm ), 'text_len' => mb_strlen( $text ), 'has_link' => sml_mod_has_link( $text ) ? 1 : 0,
		'snippet' => mb_substr( wp_strip_all_tags( $text ), 0, 160 ), 'created_at' => gmdate( 'Y-m-d H:i:s' ),
	) );
	return $result;
}, 30, 3 );

/* device fingerprint from the member's own browser (signed-in only) */
add_action( 'wp_footer', function () {
	if ( ! is_user_logged_in() || is_admin() ) { return; }
	$cfg = wp_json_encode( array( 'u' => esc_url_raw( rest_url( 'sml-moderation/v1/fp' ) ), 'n' => wp_create_nonce( 'wp_rest' ) ) );
	?>
<script id="sml-dfp">(function(){try{var k="sml_dfp_ts",now=Date.now();try{var t=+localStorage.getItem(k)||0;if(now-t<864e5)return;localStorage.setItem(k,String(now))}catch(e){}
var C=<?php echo $cfg; ?>,n=navigator,s=screen,f={};
f.tz=(Intl.DateTimeFormat().resolvedOptions().timeZone)||"";f.lang=(n.languages||[n.language]).join(",");f.plat=n.platform||"";f.sw=s.width;f.sh=s.height;f.dpr=window.devicePixelRatio||1;f.cd=s.colorDepth;f.hc=n.hardwareConcurrency||0;f.dm=n.deviceMemory||0;f.tp=n.maxTouchPoints||0;
try{var c=document.createElement("canvas");c.width=200;c.height=40;var x=c.getContext("2d");x.textBaseline="top";x.font="14px Arial";x.fillStyle="#f60";x.fillRect(10,5,80,20);x.fillStyle="#069";x.fillText("SML fp é中😀",4,12);f.cv=c.toDataURL().slice(-64)}catch(e){}
try{var g=document.createElement("canvas").getContext("webgl");if(g){var e2=g.getExtension("WEBGL_debug_renderer_info");f.gr=e2?g.getParameter(e2.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)}}catch(e){}
var st=[f.plat,f.sw,f.sh,f.dpr,f.cd,f.hc,f.dm,f.tp,f.tz,f.lang,f.cv,f.gr].join("|");
function send(h){f.h=h;if(h){document.cookie="sml_dfp="+h+"; path=/; max-age=31536000; SameSite=Lax; Secure"}
fetch(C.u,{method:"POST",credentials:"same-origin",keepalive:true,headers:{"Content-Type":"application/json","X-WP-Nonce":C.n},body:JSON.stringify({f:f})}).catch(function(){})}
if(window.crypto&&crypto.subtle&&window.TextEncoder){crypto.subtle.digest("SHA-256",new TextEncoder().encode(st)).then(function(a){send(Array.prototype.map.call(new Uint8Array(a),function(b){return("0"+b.toString(16)).slice(-2)}).join(""))}).catch(function(){})}}catch(e){}})();</script>
	<?php
}, 99 );

/* ------------------------------------------------------------------ activity from the site's own tables (works retroactively) */

/** Unified recent activity: array of [uid, ctype, target, text, ts]. Bounded. */
function sml_mod_activity( $days, $only_user = 0, $limit = 12000 ) {
	global $wpdb;
	$p = $wpdb->prefix; $days = max( 1, min( 120, (int) $days ) );
	$since_utc = gmdate( 'Y-m-d H:i:s', time() - $days * DAY_IN_SECONDS );
	$since_loc = get_date_from_gmt( $since_utc );
	$who = $only_user ? $wpdb->prepare( ' AND user_id = %d', $only_user ) : '';
	$rows = array();
	$add = function ( $r, $type, $tk, $tx, $tsk, $local ) use ( &$rows ) {
		foreach ( (array) $r as $x ) {
			$ts = strtotime( $x[ $tsk ] . ( $local ? ' ' . wp_timezone_string() : ' UTC' ) );
			$rows[] = array( (int) $x['uid'], $type, (string) ( $x[ $tk ] ?? '' ), (string) $x[ $tx ], (int) $ts );
		}
	};
	$add( $wpdb->get_results( $wpdb->prepare( "SELECT user_id uid, room_key t, body b, created_at c FROM {$p}sml_live_chat_messages WHERE user_id > 0 AND created_at >= %s $who ORDER BY id DESC LIMIT %d", $since_utc, $limit ), ARRAY_A ), 'chat', 't', 'b', 'c', false );
	$add( $wpdb->get_results( $wpdb->prepare( "SELECT user_id uid, channel_id t, message b, created_at c FROM {$p}sml_group_channel_messages WHERE user_id > 0 AND created_at >= %s $who ORDER BY id DESC LIMIT %d", $since_loc, $limit ), ARRAY_A ), 'group_msg', 't', 'b', 'c', true );
	$add( $wpdb->get_results( $wpdb->prepare( "SELECT user_id uid, group_id t, content b, created_at c FROM {$p}sml_group_posts WHERE user_id > 0 AND created_at >= %s $who ORDER BY id DESC LIMIT %d", $since_loc, $limit ), ARRAY_A ), 'group_post', 't', 'b', 'c', true );
	$add( $wpdb->get_results( $wpdb->prepare( "SELECT user_id uid, comment_post_ID t, comment_content b, comment_date_gmt c FROM {$wpdb->comments} WHERE user_id > 0 AND comment_type IN ('comment','sml_answer') AND comment_approved IN ('1','0') AND comment_date_gmt >= %s $who ORDER BY comment_ID DESC LIMIT %d", $since_utc, $limit ), ARRAY_A ), 'comment', 't', 'b', 'c', false );
	$add( $wpdb->get_results( $wpdb->prepare( "SELECT post_author uid, ID t, post_title b, post_date_gmt c FROM {$wpdb->posts} WHERE post_type IN ('sml_question','sml_qa_question') AND post_status IN ('publish','pending') AND post_author > 0 AND post_date_gmt >= %s " . ( $only_user ? $wpdb->prepare( ' AND post_author = %d', $only_user ) : '' ) . ' ORDER BY ID DESC LIMIT %d', $since_utc, $limit ), ARRAY_A ), 'qa', 't', 'b', 'c', false );
	if ( function_exists( 'sml_letters_table' ) ) {
		$lp = sml_letters_table( 'posts' );
		$add( $wpdb->get_results( $wpdb->prepare( "SELECT author_id uid, id t, title b, created_at c FROM $lp WHERE author_id > 0 AND created_at >= %s " . ( $only_user ? $wpdb->prepare( ' AND author_id = %d', $only_user ) : '' ) . ' ORDER BY id DESC LIMIT %d', $since_utc, $limit ), ARRAY_A ), 'letter', 't', 'b', 'c', false );
	}
	usort( $rows, function ( $a, $b ) { return $b[4] <=> $a[4]; } );
	return array_slice( $rows, 0, $limit );
}

/** Service accounts (desk authors, SML News) are publishing tools, not members to police. */
function sml_mod_is_service( $uid ) {
	$u = get_userdata( $uid );
	if ( ! $u ) { return false; }
	return in_array( (int) $uid, array( 258456587 ), true ) || (bool) get_user_meta( $uid, 'sml_desk_author', true );
}

function sml_mod_stats( array $ev ) {
	$by = array();
	foreach ( $ev as $e ) { $by[ $e[0] ][] = $e; }
	$out = array();
	foreach ( $by as $uid => $list ) {
		usort( $list, function ( $a, $b ) { return $a[4] <=> $b[4]; } );
		$n = count( $list ); $types = array(); $links = 0; $hashes = array(); $targets = array(); $night = 0; $times = array();
		foreach ( $list as $e ) {
			$types[ $e[1] ] = ( $types[ $e[1] ] ?? 0 ) + 1;
			if ( sml_mod_has_link( $e[3] ) ) { $links++; }
			$h = sha1( sml_mod_norm( $e[3] ) );
			if ( mb_strlen( $e[3] ) >= 12 ) { $hashes[ $h ]['n'] = ( $hashes[ $h ]['n'] ?? 0 ) + 1; $hashes[ $h ]['t'][ $e[1] . ':' . $e[2] ] = 1; }
			$targets[ $e[1] . ':' . $e[2] ] = 1;
			$hr = (int) wp_date( 'G', $e[4] ); if ( $hr < 5 ) { $night++; }
			$times[] = $e[4];
		}
		$dups = 0; $cross = 0;
		foreach ( $hashes as $h ) { if ( $h['n'] >= 2 ) { $dups += $h['n']; } if ( count( $h['t'] ) >= 3 ) { $cross++; } }
		$b60 = 0; $b5 = 0; $j = 0; $k = 0;
		for ( $i = 0; $i < $n; $i++ ) {
			while ( $times[ $i ] - $times[ $j ] > 60 ) { $j++; }
			while ( $times[ $i ] - $times[ $k ] > 300 ) { $k++; }
			$b60 = max( $b60, $i - $j + 1 ); $b5 = max( $b5, $i - $k + 1 );
		}
		$cv = null;
		if ( $n >= 8 ) {
			$gaps = array(); for ( $i = 1; $i < $n; $i++ ) { $gaps[] = $times[ $i ] - $times[ $i - 1 ]; }
			$mean = array_sum( $gaps ) / count( $gaps );
			if ( $mean > 0 ) { $var = 0; foreach ( $gaps as $g ) { $var += ( $g - $mean ) ** 2; } $cv = sqrt( $var / count( $gaps ) ) / $mean; }
		}
		$u = sml_mod_user_public( $uid );
		$age = $u['registered'] ? floor( ( time() - strtotime( $u['registered'] . ' UTC' ) ) / DAY_IN_SECONDS ) : null;
		$flags = array(); $risk = 0;
		if ( $b60 >= 8 ) { $flags[] = $b60 . ' posts in one minute'; $risk += 25; }
		if ( $b5 >= 20 ) { $flags[] = $b5 . ' posts in five minutes'; $risk += 20; }
		if ( $n >= 5 && $dups / $n >= 0.4 ) { $flags[] = round( 100 * $dups / $n ) . '% repeated text'; $risk += 20; }
		if ( $cross ) { $flags[] = 'same text in 3+ places'; $risk += 20; }
		if ( $n >= 4 && $links / $n >= 0.5 ) { $flags[] = round( 100 * $links / $n ) . '% of posts carry links'; $risk += 15; }
		if ( null !== $cv && $cv < 0.15 ) { $flags[] = 'machine-regular rhythm'; $risk += 15; }
		if ( null !== $age && $age < 7 && $n >= 10 ) { $flags[] = 'account ' . $age . 'd old, ' . $n . ' posts'; $risk += 10; }
		if ( $n >= 12 && $night / $n >= 0.6 ) { $flags[] = 'mostly overnight'; $risk += 5; }
		$out[ $uid ] = array( 'user' => $u, 'posts' => $n, 'types' => $types, 'links' => $links, 'dup_ratio' => $n ? round( $dups / $n, 2 ) : 0, 'cross_room' => $cross, 'burst60' => $b60, 'burst5m' => $b5,
			'rooms' => count( $targets ), 'night_ratio' => $n ? round( $night / $n, 2 ) : 0, 'cadence_cv' => null === $cv ? null : round( $cv, 2 ), 'account_age_days' => $age,
			'last' => wp_date( 'c', end( $times ) ), 'flags' => $flags, 'risk' => min( 100, $risk ), 'service' => sml_mod_is_service( $uid ) );
	}
	return $out;
}

/* ------------------------------------------------------------------ identities: IPs and devices per account */

/** [ 'ips' => ip => [uid => info], 'devs' => fp => [uid => info] ] from sessions, stamped events, stored devices and signed-in link clicks. */
function sml_mod_identities( $days ) {
	global $wpdb;
	$since = gmdate( 'Y-m-d H:i:s', time() - max( 1, (int) $days ) * DAY_IN_SECONDS );
	$ips = array(); $devs = array();
	$bump = function ( &$bucket, $key, $uid, $src, $when ) { if ( ! $key || ! $uid ) { return; } $r =& $bucket[ $key ][ $uid ]; $r['n'] = ( $r['n'] ?? 0 ) + 1; $r['src'][ $src ] = 1; if ( ! isset( $r['last'] ) || $when > $r['last'] ) { $r['last'] = $when; } };
	foreach ( $wpdb->get_results( "SELECT user_id, meta_value FROM {$wpdb->usermeta} WHERE meta_key = 'session_tokens'", ARRAY_A ) as $r ) {
		$tok = maybe_unserialize( $r['meta_value'] );
		foreach ( (array) $tok as $s ) { if ( ! empty( $s['ip'] ) && (int) ( $s['login'] ?? 0 ) >= strtotime( $since . ' UTC' ) ) { $bump( $ips, (string) $s['ip'], (int) $r['user_id'], 'login', (int) $s['login'] ); } }
	}
	foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT user_id, CONVERT(ip USING utf8mb4) i, client_fp, server_fp, created_at FROM ' . sml_mod_t( 'events' ) . ' WHERE created_at >= %s', $since ), ARRAY_A ) as $r ) {
		$w = strtotime( $r['created_at'] . ' UTC' ); $bump( $ips, (string) $r['i'], (int) $r['user_id'], 'activity', $w );
		if ( $r['client_fp'] ) { $bump( $devs, $r['client_fp'], (int) $r['user_id'], 'activity', $w ); }
	}
	foreach ( $wpdb->get_results( $wpdb->prepare( 'SELECT user_id, CONVERT(ip USING utf8mb4) i, client_fp, last_seen FROM ' . sml_mod_t( 'devices' ) . ' WHERE last_seen >= %s', $since ), ARRAY_A ) as $r ) {
		$w = strtotime( $r['last_seen'] . ' UTC' ); $bump( $devs, $r['client_fp'], (int) $r['user_id'], 'browser', $w ); $bump( $ips, (string) $r['i'], (int) $r['user_id'], 'browser', $w );
	}
	if ( function_exists( 'sml_lit_tables' ) ) {
		$t = sml_lit_tables();
		foreach ( $wpdb->get_results( $wpdb->prepare( "SELECT visitor_user_id uid, raw_ip, client_fp, created_at FROM {$t['clicks']} WHERE visitor_user_id > 0 AND is_bot = 0 AND created_at >= %s", get_date_from_gmt( $since ) ), ARRAY_A ) as $r ) {
			$w = strtotime( $r['created_at'] ); $bump( $ips, (string) $r['raw_ip'], (int) $r['uid'], 'link', $w );
			if ( $r['client_fp'] ) { $bump( $devs, $r['client_fp'], (int) $r['uid'], 'link', $w ); }
		}
	}
	return array( 'ips' => $ips, 'devs' => $devs );
}

function sml_mod_cluster_rows( array $bucket, $kind ) {
	$out = array();
	foreach ( $bucket as $key => $users ) {
		if ( count( $users ) < 2 ) { continue; }
		$row = array( 'key' => $key, 'kind' => $kind, 'accounts' => count( $users ), 'users' => array() );
		foreach ( $users as $uid => $i ) { $u = sml_mod_user_public( $uid ); $u['n'] = $i['n']; $u['seen_via'] = array_keys( $i['src'] ); $u['last'] = wp_date( 'c', $i['last'] ); $row['users'][] = $u; }
		if ( 'ip' === $kind ) { $g = sml_mod_geo( $key ); $row['geo'] = trim( implode( ', ', array_filter( array( $g['city'], $g['region'], $g['country_code'] ) ) ) ); }
		$out[] = $row;
	}
	usort( $out, function ( $a, $b ) { return $b['accounts'] <=> $a['accounts']; } );
	return $out;
}

/* ------------------------------------------------------------------ REST */

add_action( 'rest_api_init', function () {
	$ns = 'sml-moderation/v1'; $adm = 'sml_mod_admin';
	register_rest_route( $ns, '/overview', array( 'methods' => 'GET', 'permission_callback' => $adm, 'callback' => 'sml_mod_rest_overview' ) );
	register_rest_route( $ns, '/users', array( 'methods' => 'GET', 'permission_callback' => $adm, 'callback' => 'sml_mod_rest_users' ) );
	register_rest_route( $ns, '/clusters', array( 'methods' => 'GET', 'permission_callback' => $adm, 'callback' => 'sml_mod_rest_clusters' ) );
	register_rest_route( $ns, '/user/(?P<id>\d+)', array( 'methods' => 'GET', 'permission_callback' => $adm, 'callback' => 'sml_mod_rest_user' ) );
	register_rest_route( $ns, '/feed', array( 'methods' => 'GET', 'permission_callback' => $adm, 'callback' => 'sml_mod_rest_feed' ) );
	register_rest_route( $ns, '/fp', array( 'methods' => 'POST', 'permission_callback' => 'is_user_logged_in', 'callback' => 'sml_mod_rest_fp' ) );
} );

function sml_mod_days( WP_REST_Request $r, $def = 7 ) { return max( 1, min( 120, (int) ( $r->get_param( 'days' ) ?: $def ) ) ); }

function sml_mod_rest_overview( WP_REST_Request $req ) {
	$days = sml_mod_days( $req );
	$key = 'sml_mod_ov_' . $days; $hit = get_transient( $key ); if ( is_array( $hit ) ) { return $hit; }
	$ev = sml_mod_activity( $days );
	$types = array(); $hours = array_fill( 0, 24, 0 ); $daily = array();
	foreach ( $ev as $e ) { $types[ $e[1] ] = ( $types[ $e[1] ] ?? 0 ) + 1; $hours[ (int) wp_date( 'G', $e[4] ) ]++; $d = wp_date( 'Y-m-d', $e[4] ); $daily[ $d ] = ( $daily[ $d ] ?? 0 ) + 1; }
	ksort( $daily );
	$stats = sml_mod_stats( $ev );
	$members = array_filter( $stats, function ( $s ) { return ! $s['service']; } );
	uasort( $members, function ( $a, $b ) { return $b['posts'] <=> $a['posts']; } );
	$ident = sml_mod_identities( max( $days, 30 ) );
	$flagged = count( array_filter( $members, function ( $s ) { return $s['risk'] >= 25; } ) );
	$out = array( 'days' => $days, 'total' => count( $ev ), 'types' => $types, 'hours' => $hours, 'daily' => $daily, 'active_accounts' => count( $members ), 'flagged' => $flagged,
		'shared_ips' => count( sml_mod_cluster_rows( $ident['ips'], 'ip' ) ), 'shared_devices' => count( sml_mod_cluster_rows( $ident['devs'], 'device' ) ),
		'top' => array_slice( array_values( $members ), 0, 8 ), 'stamped_events' => (int) $GLOBALS['wpdb']->get_var( 'SELECT COUNT(*) FROM ' . sml_mod_t( 'events' ) ),
		'known_devices' => (int) $GLOBALS['wpdb']->get_var( 'SELECT COUNT(*) FROM ' . sml_mod_t( 'devices' ) ), 'generated' => gmdate( 'c' ) );
	set_transient( $key, $out, 60 );
	return $out;
}

function sml_mod_rest_users( WP_REST_Request $req ) {
	$days = sml_mod_days( $req );
	$stats = array_values( array_filter( sml_mod_stats( sml_mod_activity( $days ) ), function ( $s ) { return ! $s['service']; } ) );
	$ident = sml_mod_identities( max( $days, 30 ) );
	$ipc = array(); $dvc = array();
	foreach ( $ident['ips'] as $users ) { if ( count( $users ) > 1 ) { foreach ( array_keys( $users ) as $u ) { $ipc[ $u ] = max( $ipc[ $u ] ?? 0, count( $users ) - 1 ); } } }
	foreach ( $ident['devs'] as $users ) { if ( count( $users ) > 1 ) { foreach ( array_keys( $users ) as $u ) { $dvc[ $u ] = max( $dvc[ $u ] ?? 0, count( $users ) - 1 ); } } }
	foreach ( $stats as &$s ) {
		$id = $s['user']['id'];
		$s['shared_ip_accounts'] = $ipc[ $id ] ?? 0; $s['shared_device_accounts'] = $dvc[ $id ] ?? 0;
		if ( $s['shared_ip_accounts'] ) { $s['flags'][] = 'shares an IP with ' . $s['shared_ip_accounts'] . ' other account' . ( 1 === $s['shared_ip_accounts'] ? '' : 's' ); $s['risk'] = min( 100, $s['risk'] + min( 20, 10 * $s['shared_ip_accounts'] ) ); }
		if ( $s['shared_device_accounts'] ) { $s['flags'][] = 'same device as ' . $s['shared_device_accounts'] . ' other account' . ( 1 === $s['shared_device_accounts'] ? '' : 's' ); $s['risk'] = min( 100, $s['risk'] + 20 ); }
	}
	unset( $s );
	$sort = (string) $req->get_param( 'sort' );
	usort( $stats, function ( $a, $b ) use ( $sort ) { return 'volume' === $sort ? $b['posts'] <=> $a['posts'] : ( 'new' === $sort ? ( $a['account_age_days'] ?? 9999 ) <=> ( $b['account_age_days'] ?? 9999 ) : $b['risk'] <=> $a['risk'] ); } );
	return array( 'days' => $days, 'users' => array_slice( $stats, 0, 150 ), 'total' => count( $stats ) );
}

function sml_mod_rest_clusters( WP_REST_Request $req ) {
	$days = max( 7, sml_mod_days( $req, 30 ) );
	$id = sml_mod_identities( $days );
	return array( 'days' => $days, 'ips' => array_slice( sml_mod_cluster_rows( $id['ips'], 'ip' ), 0, 80 ), 'devices' => array_slice( sml_mod_cluster_rows( $id['devs'], 'device' ), 0, 80 ),
		'note' => 'Shared networks (offices, phone carriers, households) also show up here. A cluster is a reason to look, not proof.' );
}

function sml_mod_rest_user( WP_REST_Request $req ) {
	global $wpdb;
	$uid = (int) $req['id']; $days = sml_mod_days( $req, 30 );
	if ( ! get_userdata( $uid ) ) { return new WP_Error( 'sml_mod_user', 'No such user.', array( 'status' => 404 ) ); }
	$ev = sml_mod_activity( $days, $uid, 3000 );
	$stats = sml_mod_stats( $ev );
	$tok = maybe_unserialize( get_user_meta( $uid, 'session_tokens', true ) );
	$sessions = array();
	foreach ( (array) $tok as $s ) { $g = sml_mod_geo( (string) ( $s['ip'] ?? '' ) ); $sessions[] = array( 'ip' => (string) ( $s['ip'] ?? '' ), 'ua' => substr( (string) ( $s['ua'] ?? '' ), 0, 200 ), 'login' => wp_date( 'c', (int) ( $s['login'] ?? 0 ) ), 'geo' => trim( implode( ', ', array_filter( array( $g['city'], $g['region'], $g['country_code'] ) ) ) ) ); }
	$devices = $wpdb->get_results( $wpdb->prepare( 'SELECT client_fp, server_fp, CONVERT(ip USING utf8mb4) ip, country_code, region, city, ua, fp_json, hits, first_seen, last_seen FROM ' . sml_mod_t( 'devices' ) . ' WHERE user_id = %d ORDER BY last_seen DESC LIMIT 30', $uid ), ARRAY_A ) ?: array();
	foreach ( $devices as &$d ) { $d['fp'] = json_decode( (string) $d['fp_json'], true ); unset( $d['fp_json'] ); }
	unset( $d );
	$stamped = $wpdb->get_results( $wpdb->prepare( 'SELECT ctype, target, CONVERT(ip USING utf8mb4) ip, client_fp, snippet, has_link, created_at FROM ' . sml_mod_t( 'events' ) . ' WHERE user_id = %d ORDER BY id DESC LIMIT 50', $uid ), ARRAY_A ) ?: array();
	$timeline = array(); foreach ( array_slice( $ev, 0, 60 ) as $e ) { $timeline[] = array( 'type' => $e[1], 'target' => $e[2], 'text' => mb_substr( wp_strip_all_tags( $e[3] ), 0, 200 ), 'at' => wp_date( 'c', $e[4] ), 'link' => sml_mod_has_link( $e[3] ) ); }
	$id = sml_mod_identities( max( $days, 30 ) ); $shared_ips = array(); $shared_devs = array();
	foreach ( $id['ips'] as $ip => $users ) { if ( isset( $users[ $uid ] ) && count( $users ) > 1 ) { $shared_ips[ $ip ] = array_map( 'sml_mod_user_public', array_diff( array_keys( $users ), array( $uid ) ) ); } }
	foreach ( $id['devs'] as $fp => $users ) { if ( isset( $users[ $uid ] ) && count( $users ) > 1 ) { $shared_devs[ $fp ] = array_map( 'sml_mod_user_public', array_diff( array_keys( $users ), array( $uid ) ) ); } }
	return array( 'user' => sml_mod_user_public( $uid ), 'stats' => $stats[ $uid ] ?? null, 'sessions' => $sessions, 'devices' => $devices, 'stamped' => $stamped, 'timeline' => $timeline, 'shared_ips' => $shared_ips, 'shared_devices' => $shared_devs );
}

function sml_mod_rest_feed( WP_REST_Request $req ) {
	$days = sml_mod_days( $req, 3 ); $limit = max( 10, min( 300, (int) ( $req->get_param( 'limit' ) ?: 100 ) ) );
	$type = sanitize_key( (string) $req->get_param( 'type' ) ); $uid = (int) $req->get_param( 'user' );
	$ev = sml_mod_activity( $days, $uid, 4000 ); $out = array();
	foreach ( $ev as $e ) {
		if ( $type && $e[1] !== $type ) { continue; }
		$out[] = array( 'user' => sml_mod_user_public( $e[0] ), 'type' => $e[1], 'target' => $e[2], 'text' => mb_substr( wp_strip_all_tags( $e[3] ), 0, 220 ), 'at' => wp_date( 'c', $e[4] ), 'link' => sml_mod_has_link( $e[3] ) );
		if ( count( $out ) >= $limit ) { break; }
	}
	return array( 'days' => $days, 'events' => $out );
}

function sml_mod_rest_fp( WP_REST_Request $req ) {
	global $wpdb;
	$uid = get_current_user_id(); $f = $req->get_param( 'f' );
	if ( ! $uid || ! is_array( $f ) ) { return new WP_REST_Response( array( 'ok' => false ), 202 ); }
	$h = strtolower( (string) ( $f['h'] ?? '' ) );
	if ( ! preg_match( '/^[a-f0-9]{64}$/', $h ) ) { return new WP_REST_Response( array( 'ok' => false ), 202 ); }
	$clean = array();
	foreach ( $f as $k => $v ) { $k = preg_replace( '/[^a-z0-9]/i', '', (string) $k ); if ( '' !== $k && strlen( $k ) <= 6 ) { $clean[ $k ] = is_scalar( $v ) ? substr( (string) $v, 0, 160 ) : ''; } }
	$ip = sml_mod_ip(); $g = sml_mod_geo( $ip ); $now = gmdate( 'Y-m-d H:i:s' );
	$wpdb->query( $wpdb->prepare(
		'INSERT INTO ' . sml_mod_t( 'devices' ) . ' (user_id, client_fp, server_fp, ip, country_code, region, city, ua, fp_json, hits, first_seen, last_seen) VALUES (%d,%s,%s,%s,%s,%s,%s,%s,%s,1,%s,%s)
		 ON DUPLICATE KEY UPDATE hits = hits + 1, last_seen = VALUES(last_seen), ip = VALUES(ip), fp_json = VALUES(fp_json)',
		$uid, $h, sml_mod_server_fp(), $ip, $g['country_code'], $g['region'], $g['city'], substr( isset( $_SERVER['HTTP_USER_AGENT'] ) ? (string) wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) : '', 0, 400 ), wp_json_encode( $clean ), $now, $now
	) );
	return new WP_REST_Response( array( 'ok' => true ), 200 );
}
