<?php
/**
 * Plugin Name: SML Live Insights
 * Description: The creator's real-time analytics feed for a live or scheduled stream (Go Live hub -> "Live Insights"). Everything comes from real heartbeats (sml-live-viewers), the live chat store, the reaction engine and subscription events; nothing is estimated or invented, and small samples are labelled as such. Adds where viewers come from (referrer, campaign, in-site surface) with the QUALITY of each source (time watched, chat rate, bounce, subscribers), country / city (city only when 3+ viewers), device, signed-in vs guest, new vs returning, a per-minute audience curve with the moments that moved it, a same-minute comparison with the creator's previous stream, and plain-language insights. 2026-09-23.
 * Version: 1.0.0
 * Author: StockMarketLoop
 *
 * Privacy: aggregates only. Nobody is named; a city is shown only once at least 3 viewers share it.
 * REST: GET /wp-json/sml-live-insights/v1/stream?stream=<id>|current   (the creator, or an admin with &host=)
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

/* ------------------------------------------------------------------ helpers */

/** Same hash the Watch Page uses to like ONE stream (js/live-watch.js likeTarget): 1e13 + fnv32(kind:key) * 65536 + 16 more bits. */
function sml_li_fnv( $s ) {
	$h = 0x811c9dc5;
	$n = strlen( $s );
	for ( $i = 0; $i < $n; $i++ ) { $h ^= ord( $s[ $i ] ); $h = ( $h * 16777619 ) & 0xffffffff; }
	return $h;
}
function sml_li_like_target( $kind, $key ) {
	$k = $kind . ':' . strtolower( (string) $key );
	return 10000000000000 + sml_li_fnv( $k ) * 65536 + ( sml_li_fnv( strrev( $k ) ) & 0xffff );
}

function sml_li_source_label( $src, $surf, $refhost ) {
	$names = array(
		'x' => 'X (Twitter)', 'facebook' => 'Facebook', 'linkedin' => 'LinkedIn', 'reddit' => 'Reddit', 'discord' => 'Discord', 'telegram' => 'Telegram',
		'tiktok' => 'TikTok', 'instagram' => 'Instagram', 'youtube' => 'YouTube', 'bluesky' => 'Bluesky', 'threads' => 'Threads', 'tumblr' => 'Tumblr',
		'whatsapp' => 'WhatsApp', 'stocktwits' => 'StockTwits', 'search' => 'Search engines', 'email' => 'Email', 'direct' => 'Direct / bookmarks',
	);
	$surfs = array(
		'home' => 'Home feed', 'channel' => 'Your channel page', 'live_hub' => 'Live page', 'group' => 'A group', 'video' => 'A video page', 'profile' => 'A profile',
		'qa' => 'Q&A', 'ticker' => 'A ticker page', 'terminal' => 'Trading Floor', 'letters' => 'Loop Letters', 'search' => 'Site search', 'notify' => 'A notification', 'other' => 'Elsewhere on the site',
	);
	if ( 'site' === $src ) { return 'On site · ' . ( $surfs[ $surf ] ?? 'Elsewhere on the site' ); }
	if ( 'other' === $src ) { return '' !== $refhost ? $refhost : 'Other websites'; }
	return $names[ $src ] ?? ucfirst( (string) $src );
}
function sml_li_source_group( $src ) {
	if ( in_array( $src, array( 'x', 'facebook', 'linkedin', 'reddit', 'discord', 'telegram', 'tiktok', 'instagram', 'youtube', 'bluesky', 'threads', 'tumblr', 'whatsapp', 'stocktwits' ), true ) ) { return 'social'; }
	return in_array( $src, array( 'site', 'search', 'email', 'direct' ), true ) ? $src : 'other';
}

function sml_li_country_name( $cc ) {
	if ( '' === $cc ) { return 'Unknown'; }
	if ( class_exists( 'Locale' ) ) { $n = Locale::getDisplayRegion( '-' . $cc, 'en' ); if ( $n && $n !== $cc && '-' . $cc !== $n ) { return $n; } }
	return $cc;
}

function sml_li_dur( $secs ) {
	$secs = max( 0, (int) round( $secs ) );
	if ( $secs < 60 ) { return $secs . 's'; }
	$m = intdiv( $secs, 60 );
	if ( $m < 60 ) { return $m . 'm ' . str_pad( (string) ( $secs % 60 ), 2, '0', STR_PAD_LEFT ) . 's'; }
	return intdiv( $m, 60 ) . 'h ' . str_pad( (string) ( $m % 60 ), 2, '0', STR_PAD_LEFT ) . 'm';
}

/* ------------------------------------------------------------------ a creator's streams */

/** All of the creator's known streams, newest first: [ id => { id, title, status, scheduled_at, started_at, ended_at } ]. */
function sml_li_streams( $uid ) {
	$rows = function_exists( 'sml_scheduled_live_library' ) ? (array) sml_scheduled_live_library( $uid ) : array();
	$cur  = function_exists( 'sml_scheduled_live_row' ) ? sml_scheduled_live_row( $uid ) : array();
	if ( is_array( $cur ) && ! empty( $cur['id'] ) ) { $rows[ $cur['id'] ] = $rows[ $cur['id'] ] ?? $cur; }
	$out = array();
	foreach ( $rows as $r ) {
		if ( ! is_array( $r ) || empty( $r['id'] ) || 'cancelled' === ( $r['status'] ?? '' ) ) { continue; }
		$out[ $r['id'] ] = array(
			'id'           => (string) $r['id'],
			'title'        => (string) ( $r['title'] ?? '' ),
			'status'       => (string) ( $r['status'] ?? '' ),
			'scheduled_at' => (string) ( $r['scheduled_at'] ?? '' ),
			'started_at'   => (string) ( $r['started_at'] ?? '' ),
			'ended_at'     => (string) ( $r['ended_at'] ?? '' ),
		);
	}
	uasort( $out, function ( $a, $b ) { return strtotime( $b['started_at'] ?: $b['scheduled_at'] ?: '1970-01-01' ) <=> strtotime( $a['started_at'] ?: $a['scheduled_at'] ?: '1970-01-01' ); } );
	return $out;
}

/** Which stream the panel shows: the live one, else the scheduled current one, else the latest with data. */
function sml_li_pick( $uid, array $streams, $wanted ) {
	if ( $wanted && 'current' !== $wanted ) { return isset( $streams[ $wanted ] ) ? $wanted : ''; }
	foreach ( $streams as $id => $s ) { if ( 'live' === $s['status'] ) { return $id; } }
	foreach ( $streams as $id => $s ) { if ( 'scheduled' === $s['status'] && strtotime( $s['scheduled_at'] ?: '1970-01-01' ) > time() - 6 * HOUR_IN_SECONDS ) { return $id; } }
	global $wpdb;
	foreach ( $streams as $id => $s ) {
		if ( (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . sml_lv_t() . ' WHERE stream_key = %s', 's:' . $id ) ) > 0 ) { return $id; }
	}
	return (string) array_key_first( $streams );
}

/* ------------------------------------------------------------------ the report */

function sml_li_series( $key, $from_min, $to_min ) {
	global $wpdb;
	$rows = (array) $wpdb->get_results( $wpdb->prepare( 'SELECT minute, viewers, joins FROM ' . sml_lv_tm() . ' WHERE stream_key = %s AND minute BETWEEN %d AND %d ORDER BY minute', $key, $from_min, $to_min ), ARRAY_A );
	$by = array();
	foreach ( $rows as $r ) { $by[ (int) $r['minute'] ] = array( (int) $r['viewers'], (int) $r['joins'] ); }
	return $by;
}

/** Cap a long series to $max points (max of each bucket, so a spike is never averaged away). */
function sml_li_shrink( array $vals, $max = 240 ) {
	$n = count( $vals );
	if ( $n <= $max ) { return array( array_values( $vals ), 1 ); }
	$step = (int) ceil( $n / $max );
	$out  = array();
	for ( $i = 0; $i < $n; $i += $step ) { $out[] = max( array_slice( $vals, $i, $step ) ); }
	return array( $out, $step );
}

function sml_li_report( $host, $stream_id ) {
	global $wpdb;
	$streams = sml_li_streams( $host );
	$sid     = sml_li_pick( $host, $streams, $stream_id );
	$handle  = function_exists( 'sml_scheduled_live_handle_for_user' ) ? sml_lv_clean_handle( sml_scheduled_live_handle_for_user( $host ) ) : '';
	$key     = $sid ? 's:' . $sid : ( $handle ? 'h:' . strtolower( $handle ) : '' );
	$now     = time();
	$win     = SML_LV_WINDOW;
	$T       = sml_lv_t();
	$meta    = $sid ? $streams[ $sid ] : array( 'id' => '', 'title' => '', 'status' => '', 'scheduled_at' => '', 'started_at' => '', 'ended_at' => '' );

	$agg = $key ? $wpdb->get_row( $wpdb->prepare(
		"SELECT COUNT(*) unique_v, SUM(last_seen >= %d) now_v, MIN(first_seen) first_seen, MAX(last_seen) last_seen, AVG(watch_secs) avg_ws,
		        SUM(user_id > 0) members, SUM(returning_v) returning_v,
		        SUM(last_seen < %d) finished, SUM(last_seen < %d AND watch_secs < 30) bounced, SUM(watch_secs >= 60) stayed_1m, SUM(watch_secs >= 300) stayed_5m
		   FROM {$T} WHERE stream_key = %s", $now - $win, $now - $win, $now - $win, $key ), ARRAY_A ) : array();
	$unique = (int) ( $agg['unique_v'] ?? 0 );
	$now_v  = (int) ( $agg['now_v'] ?? 0 );

	/* the time window the curve covers */
	$t_start = $meta['started_at'] ? strtotime( $meta['started_at'] ) : 0;
	if ( ! $t_start ) { $t_start = (int) ( $agg['first_seen'] ?? 0 ); }
	$live_now = 'live' === $meta['status'];
	$t_end    = $meta['ended_at'] && ! $live_now ? min( $now, strtotime( $meta['ended_at'] ) + 600 ) : $now;
	if ( ! $t_start ) { $t_start = $now; }
	$m0 = intdiv( $t_start, 60 ); $m1 = max( $m0, intdiv( $t_end, 60 ) );
	if ( $m1 - $m0 > 720 ) { $m0 = $m1 - 720; }   /* the last 12 hours is plenty for a curve */
	$series = $key ? sml_li_series( $key, $m0, $m1 ) : array();
	$vals = array(); $joins = array();
	for ( $m = $m0; $m <= $m1; $m++ ) { $vals[] = $series[ $m ][0] ?? 0; $joins[] = $series[ $m ][1] ?? 0; }
	$peak = $vals ? max( $vals ) : 0; $peak_i = $vals ? array_search( $peak, $vals, true ) : 0;
	$peak = max( $peak, $now_v );
	list( $curve, $step ) = sml_li_shrink( $vals );

	/* the creator's previous stream, aligned by minutes since ITS start */
	$prev = null;
	foreach ( $streams as $pid => $ps ) {
		if ( $pid === $sid || 'ended' !== $ps['status'] ) { continue; }
		$pk = 's:' . $pid;
		$pn = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$T} WHERE stream_key = %s", $pk ) );
		if ( $pn < 1 ) { continue; }
		$ps_start = strtotime( $ps['started_at'] ?: $ps['scheduled_at'] ?: '' ) ?: (int) $wpdb->get_var( $wpdb->prepare( "SELECT MIN(first_seen) FROM {$T} WHERE stream_key = %s", $pk ) );
		$pm0 = intdiv( $ps_start, 60 );
		$ps_series = sml_li_series( $pk, $pm0, $pm0 + max( 60, $m1 - $m0 ) );
		$pv = array();
		for ( $i = 0; $i <= $m1 - $m0; $i++ ) { $pv[] = $ps_series[ $pm0 + $i ][0] ?? 0; }
		$prev = array( 'id' => $pid, 'title' => $ps['title'], 'unique' => $pn, 'peak' => $pv ? max( $pv ) : 0, 'vals' => $pv );
		break;
	}
	$prev_curve = null; $vs_prev = null;
	if ( $prev ) {
		list( $prev_curve ) = sml_li_shrink( $prev['vals'] );
		$idx = count( $vals ) - 1;
		if ( $idx >= 0 && ( $prev['vals'][ $idx ] ?? 0 ) > 0 ) { $vs_prev = array( 'minute' => $idx, 'now' => $vals[ $idx ], 'then' => $prev['vals'][ $idx ], 'pct' => round( ( $vals[ $idx ] - $prev['vals'][ $idx ] ) / $prev['vals'][ $idx ] * 100 ) ); }
	}

	/* sources: one row per (source, surface, referrer host) then folded into display rows */
	$src_rows = array();
	if ( $key ) {
		$rows = (array) $wpdb->get_results( $wpdb->prepare(
			"SELECT src, surf, refhost, COUNT(*) total, SUM(last_seen >= %d) nowc, AVG(watch_secs) avg_ws, SUM(user_id > 0) members,
			        SUM(last_seen < %d) finished, SUM(last_seen < %d AND watch_secs < 30) bounced
			   FROM {$T} WHERE stream_key = %s GROUP BY src, surf, refhost", $now - $win, $now - $win, $now - $win, $key ), ARRAY_A );
		$chat_by = array();
		$room    = $sid ? 'stream-' . strtolower( $sid ) : $handle;
		$ct      = $wpdb->prefix . 'sml_live_chat_messages';
		foreach ( (array) $wpdb->get_results( $wpdb->prepare(
			"SELECT v.src, v.surf, v.refhost, COUNT(DISTINCT c.user_id) chatters
			   FROM {$ct} c JOIN {$T} v ON v.user_id = c.user_id AND v.stream_key = %s
			  WHERE c.room_key = %s AND c.user_id > 0 GROUP BY v.src, v.surf, v.refhost", $key, $room ), ARRAY_A ) as $r ) {
			$chat_by[ $r['src'] . '|' . $r['surf'] . '|' . $r['refhost'] ] = (int) $r['chatters'];
		}
		$subs_by = array();
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( 'SELECT val, COUNT(*) c FROM ' . sml_lv_te() . " WHERE stream_key = %s AND type = 'sub' GROUP BY val", $key ), ARRAY_A ) as $r ) { $subs_by[ $r['val'] ] = (int) $r['c']; }
		foreach ( $rows as $r ) {
			$src = (string) $r['src']; $src = '' === $src ? 'direct' : $src;
			$surf = 'site' === $src ? (string) $r['surf'] : ''; $rh = 'other' === $src ? (string) $r['refhost'] : '';
			$label = sml_li_source_label( $src, $surf, $rh );
			$k = $src . '|' . $surf . '|' . $rh;
			if ( ! isset( $src_rows[ $k ] ) ) { $src_rows[ $k ] = array( 'key' => $k, 'src' => $src, 'group' => sml_li_source_group( $src ), 'label' => $label, 'total' => 0, 'now' => 0, 'ws_sum' => 0.0, 'members' => 0, 'finished' => 0, 'bounced' => 0, 'chatters' => 0, 'subs' => 0 ); }
			$a = &$src_rows[ $k ];
			$a['total'] += (int) $r['total']; $a['now'] += (int) $r['nowc']; $a['ws_sum'] += (float) $r['avg_ws'] * (int) $r['total'];
			$a['members'] += (int) $r['members']; $a['finished'] += (int) $r['finished']; $a['bounced'] += (int) $r['bounced'];
			$a['chatters'] += $chat_by[ $r['src'] . '|' . $r['surf'] . '|' . $r['refhost'] ] ?? 0;
			$a['subs'] = $subs_by[ $src . ( 'site' === $src && '' !== $surf ? ':' . $surf : '' ) ] ?? ( $subs_by[ $src ] ?? 0 );
			unset( $a );
		}
	}
	$sources = array();
	foreach ( $src_rows as $a ) {
		$sources[] = array(
			'key' => $a['key'], 'label' => $a['label'], 'group' => $a['group'], 'total' => $a['total'], 'now' => $a['now'],
			'share' => $unique ? round( $a['total'] / $unique * 100, 1 ) : 0,
			'avg_watch' => (int) round( $a['total'] ? $a['ws_sum'] / $a['total'] : 0 ),
			'members' => $a['members'],
			'chat_pct' => $a['members'] ? round( $a['chatters'] / $a['total'] * 100, 1 ) : 0,
			'bounce_pct' => $a['finished'] >= 3 ? round( $a['bounced'] / $a['finished'] * 100 ) : null,
			'subs' => $a['subs'],
		);
	}
	usort( $sources, function ( $a, $b ) { return $b['total'] <=> $a['total']; } );

	/* where in the world (a city is shown only when 3+ viewers share it) */
	$countries = array(); $cities = array();
	if ( $key ) {
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT country, city, COUNT(*) total, SUM(last_seen >= %d) nowc FROM {$T} WHERE stream_key = %s GROUP BY country, city", $now - $win, $key ), ARRAY_A ) as $r ) {
			$cc = (string) $r['country'];
			if ( ! isset( $countries[ $cc ] ) ) { $countries[ $cc ] = array( 'code' => $cc, 'name' => sml_li_country_name( $cc ), 'total' => 0, 'now' => 0 ); }
			$countries[ $cc ]['total'] += (int) $r['total']; $countries[ $cc ]['now'] += (int) $r['nowc'];
			if ( (int) $r['total'] >= 3 && '' !== $r['city'] ) { $cities[] = array( 'city' => (string) $r['city'], 'code' => $cc, 'total' => (int) $r['total'], 'now' => (int) $r['nowc'] ); }
		}
	}
	$countries = array_values( $countries );
	usort( $countries, function ( $a, $b ) { return $b['total'] <=> $a['total']; } );
	usort( $cities, function ( $a, $b ) { return $b['total'] <=> $a['total']; } );

	$devices = array( 'm' => 0, 'd' => 0, 't' => 0 );
	if ( $key ) { foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT dev, COUNT(*) c FROM {$T} WHERE stream_key = %s GROUP BY dev", $key ), ARRAY_A ) as $r ) { if ( isset( $devices[ $r['dev'] ] ) ) { $devices[ $r['dev'] ] = (int) $r['c']; } } }

	/* chat */
	$chat = array( 'total' => 0, 'chatters' => 0, 'per_min' => 0.0, 'last' => array(), 'superchats' => 0 );
	$room = $sid ? 'stream-' . strtolower( $sid ) : $handle;
	$ct   = $wpdb->prefix . 'sml_live_chat_messages';
	$chat_minutes = array();
	if ( '' !== $room ) {
		$since = gmdate( 'Y-m-d H:i:s', $m0 * 60 );
		$c = $wpdb->get_row( $wpdb->prepare( "SELECT COUNT(*) total, COUNT(DISTINCT IF(user_id > 0, user_id, NULL)) chatters, SUM(message_type = 'superchat') sc FROM {$ct} WHERE room_key = %s AND created_at >= %s", $room, $since ), ARRAY_A );
		$chat['total'] = (int) ( $c['total'] ?? 0 ); $chat['chatters'] = (int) ( $c['chatters'] ?? 0 ); $chat['superchats'] = (int) ( $c['sc'] ?? 0 );
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT DATE_FORMAT(created_at, '%%Y-%%m-%%d %%H:%%i') m, COUNT(*) c FROM {$ct} WHERE room_key = %s AND created_at >= %s GROUP BY m", $room, $since ), ARRAY_A ) as $r ) { $chat_minutes[ intdiv( (int) strtotime( $r['m'] . ' UTC' ), 60 ) ] = (int) $r['c']; }
		$last = array();
		for ( $m = $m1 - 9; $m <= $m1; $m++ ) { $last[] = $chat_minutes[ $m ] ?? 0; }
		$chat['last'] = $last; $chat['per_min'] = round( array_sum( array_slice( $last, -5 ) ) / 5, 1 );
	}

	/* likes for THIS stream (the Watch Page likes a hashed id per stream) */
	$likes = array( 'total' => 0, 'last10' => 0 );
	$like_minutes = array();
	if ( $sid ) {
		$rt  = $wpdb->prefix . 'sml_reactions';
		$tid = sml_li_like_target( 'stream', $sid );
		$likes['total'] = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$rt} WHERE content_type = 'long_video' AND content_id = %d AND reaction_type = 'like'", $tid ) );
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT DATE_FORMAT(created_at, '%%Y-%%m-%%d %%H:%%i') m, COUNT(*) c FROM {$rt} WHERE content_type = 'long_video' AND content_id = %d AND reaction_type = 'like' AND created_at >= %s GROUP BY m", $tid, gmdate( 'Y-m-d H:i:s', $m0 * 60 ) ), ARRAY_A ) as $r ) { $like_minutes[ intdiv( (int) strtotime( $r['m'] . ' UTC' ), 60 ) ] = (int) $r['c']; }
		for ( $m = $m1 - 9; $m <= $m1; $m++ ) { $likes['last10'] += $like_minutes[ $m ] ?? 0; }
	}

	/* subscribers gained while this stream was open */
	$sub_minutes = array(); $subs_total = 0;
	if ( $key ) {
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( 'SELECT FLOOR(ts / 60) m, COUNT(*) c FROM ' . sml_lv_te() . " WHERE stream_key = %s AND type = 'sub' GROUP BY m", $key ), ARRAY_A ) as $r ) { $sub_minutes[ (int) $r['m'] ] = (int) $r['c']; $subs_total += (int) $r['c']; }
	}

	/* the moments that moved the curve */
	$moments = array();
	foreach ( $sub_minutes as $m => $n ) { if ( $m >= $m0 ) { $moments[] = array( 'm' => $m - $m0, 'type' => 'sub', 'n' => $n ); } }
	foreach ( $like_minutes as $m => $n ) { if ( $n >= max( 3, (int) ceil( $unique * 0.05 ) ) && $m >= $m0 ) { $moments[] = array( 'm' => $m - $m0, 'type' => 'likes', 'n' => $n ); } }
	if ( $chat_minutes ) {
		$avg_chat = array_sum( $chat_minutes ) / max( 1, count( $chat_minutes ) );
		foreach ( $chat_minutes as $m => $n ) { if ( $n >= max( 6, $avg_chat * 2.5 ) && $m >= $m0 ) { $moments[] = array( 'm' => $m - $m0, 'type' => 'chat', 'n' => $n ); } }
	}
	if ( $peak > 2 ) { $moments[] = array( 'm' => (int) $peak_i, 'type' => 'peak', 'n' => $peak ); }
	usort( $moments, function ( $a, $b ) { return $a['m'] <=> $b['m']; } );

	$avg_ws  = (int) round( (float) ( $agg['avg_ws'] ?? 0 ) );
	$finished = (int) ( $agg['finished'] ?? 0 ); $bounced = (int) ( $agg['bounced'] ?? 0 );
	$members  = (int) ( $agg['members'] ?? 0 );
	$followers = array_map( 'intval', (array) get_user_meta( $host, 'sml_followers', true ) );
	$subs_watching = 0;
	if ( $members && $followers ) {
		$ids = array_slice( array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( "SELECT user_id FROM {$T} WHERE stream_key = %s AND user_id > 0 AND last_seen >= %d", $key, $now - $win ) ) ), 0, 5000 );
		$subs_watching = count( array_intersect( $ids, $followers ) );
	}

	$report = array(
		'generated'  => $now,
		'stream'     => array( 'id' => $sid, 'key' => $key, 'title' => $meta['title'], 'status' => $meta['status'], 'scheduled_at' => $meta['scheduled_at'], 'started_at' => $meta['started_at'], 'ended_at' => $meta['ended_at'], 'handle' => $handle, 'elapsed' => $live_now && $t_start ? $now - $t_start : 0 ),
		'streams'    => array_values( array_map( function ( $s ) { return array( 'id' => $s['id'], 'title' => $s['title'], 'status' => $s['status'], 'when' => $s['started_at'] ?: $s['scheduled_at'] ); }, array_slice( $streams, 0, 8 ) ) ),
		'tracked'    => $unique > 0,
		'now'        => $now_v,
		'peak'       => array( 'n' => $peak, 'at_minute' => (int) $peak_i, 'at' => $vals && $peak_i !== false ? gmdate( 'c', ( $m0 + (int) $peak_i ) * 60 ) : '' ),
		'unique'     => $unique,
		'avg_watch'  => $avg_ws,
		'bounce_pct' => $finished >= 5 ? round( $bounced / $finished * 100 ) : null,
		'stayed_1m'  => (int) ( $agg['stayed_1m'] ?? 0 ),
		'stayed_5m'  => (int) ( $agg['stayed_5m'] ?? 0 ),
		'audience'   => array( 'members' => $members, 'guests' => max( 0, $unique - $members ), 'returning' => (int) ( $agg['returning_v'] ?? 0 ), 'subscribers_watching' => $subs_watching ),
		'curve'      => array( 'vals' => $curve, 'step' => $step, 'start' => $m0 * 60, 'prev' => $prev_curve, 'prev_title' => $prev ? $prev['title'] : '', 'joins' => sml_li_shrink( $joins )[0] ),
		'vs_prev'    => $vs_prev,
		'moments'    => $moments,
		'sources'    => array_slice( $sources, 0, 12 ),
		'geo'        => array( 'countries' => array_slice( $countries, 0, 10 ), 'cities' => array_slice( $cities, 0, 8 ) ),
		'devices'    => $devices,
		'chat'       => $chat,
		'likes'      => $likes,
		'subs'       => array( 'gained' => $subs_total ),
		'insights'   => array(),
	);
	$report['insights'] = sml_li_insights( $report, $prev );
	return $report;
}

/* ------------------------------------------------------------------ plain-language insights (real numbers only) */

function sml_li_insights( array $r, $prev ) {
	$out = array();
	$add = function ( $tone, $text ) use ( &$out ) { $out[] = array( 'tone' => $tone, 'text' => $text ); };
	$u   = (int) $r['unique'];
	$now = (int) $r['now'];
	if ( $u < 1 ) { return array( array( 'tone' => 'info', 'text' => 'No viewers yet. As soon as someone opens your Watch Page you will see where they came from, live.' ) ); }
	if ( $u < 10 ) { $add( 'info', 'Small sample so far (' . $u . ' viewer' . ( 1 === $u ? '' : 's' ) . '): treat percentages as a first read, not a trend.' ); }

	/* momentum: now vs the average of the previous 5 minutes */
	$v = $r['curve']['vals']; $n = count( $v );
	if ( 1 === (int) $r['curve']['step'] && $n >= 8 ) {
		$base = array_sum( array_slice( $v, $n - 7, 5 ) ) / 5;
		if ( $base >= 5 ) {
			$chg = ( $v[ $n - 1 ] - $base ) / $base * 100;
			if ( $chg >= 20 ) { $add( 'good', 'Audience is climbing: ' . $v[ $n - 1 ] . ' watching in the last minute, ' . round( $chg ) . '% above the previous five minutes.' ); }
			elseif ( $chg <= -25 ) { $add( 'warn', 'Viewers are dropping: ' . $v[ $n - 1 ] . ' now vs about ' . round( $base ) . ' over the previous five minutes. A poll, a giveaway of a level, or a chat question is the fastest way to bring people back.' ); }
		}
	}
	if ( $r['vs_prev'] && $r['vs_prev']['then'] >= 5 ) {
		$p = $r['vs_prev'];
		$add( $p['pct'] >= 0 ? 'good' : 'info', 'At minute ' . $p['minute'] . ' you have ' . $p['now'] . ' watching vs ' . $p['then'] . ' at the same point of your last stream (' . ( $p['pct'] >= 0 ? '+' : '' ) . $p['pct'] . '%).' );
	}

	/* best source by attention, then by volume */
	$good = array_values( array_filter( $r['sources'], function ( $s ) { return $s['total'] >= 3; } ) );
	if ( count( $good ) >= 2 ) {
		usort( $good, function ( $a, $b ) { return $b['avg_watch'] <=> $a['avg_watch']; } );
		$top = $good[0]; $avg = max( 1, (int) $r['avg_watch'] );
		if ( $top['avg_watch'] >= $avg * 1.3 ) { $add( 'good', $top['label'] . ' viewers stay the longest: ' . sml_li_dur( $top['avg_watch'] ) . ' on average, ' . round( $top['avg_watch'] / $avg, 1 ) . '× your overall ' . sml_li_dur( $avg ) . '. ' . ( 'site' === $top['group'] ? 'That placement is working.' : 'Share your next link there first.' ) ); }
		$vol = $r['sources'][0];
		if ( $vol['share'] >= 40 && $vol['label'] !== $top['label'] ) { $add( 'info', $vol['label'] . ' sends the most people (' . $vol['share'] . '% of viewers), but ' . $top['label'] . ' sends the most engaged ones.' ); }
		$weak = array_values( array_filter( $good, function ( $s ) { return null !== $s['bounce_pct'] && $s['bounce_pct'] >= 60 && $s['total'] >= 5; } ) );
		if ( $weak ) { $add( 'warn', $weak[0]['label'] . ': ' . $weak[0]['bounce_pct'] . '% left within 30 seconds. The title or thumbnail that brings them may promise something the first minute does not deliver.' ); }
	} elseif ( $r['sources'] && $u >= 5 ) {
		$add( 'info', ( $r['sources'][0]['share'] >= 70 ? 'Nearly all viewers (' . $r['sources'][0]['share'] . '%) come from ' . $r['sources'][0]['label'] . '.' : 'Top source: ' . $r['sources'][0]['label'] . ' (' . $r['sources'][0]['share'] . '%).' ) );
	}

	/* the sign-in opportunity: guests can watch and read but not chat or like */
	$g = (int) $r['audience']['guests'];
	if ( $u >= 8 && $g / $u >= 0.5 ) { $add( 'info', round( $g / $u * 100 ) . '% of your viewers are not signed in, so they cannot chat or like. Telling people in your first minute that chat is one free sign-up away lifts both.' ); }

	/* chat conversion */
	$m = (int) $r['audience']['members'];
	if ( $m >= 8 ) {
		$pct = round( $r['chat']['chatters'] / $m * 100 );
		if ( $pct >= 25 ) { $add( 'good', $pct . '% of signed-in viewers have chatted: a very talkative room.' ); }
		elseif ( $pct <= 8 ) { $add( 'info', 'Only ' . $pct . '% of signed-in viewers have chatted. Asking a direct question ("which level do you trust, A or B?") usually moves this fastest.' ); }
	}

	/* retention */
	if ( null !== $r['bounce_pct'] && $u >= 10 ) {
		if ( $r['bounce_pct'] >= 55 ) { $add( 'warn', $r['bounce_pct'] . '% of viewers leave within 30 seconds. Open with what they will get in the next 10 minutes.' ); }
		elseif ( $r['bounce_pct'] <= 25 ) { $add( 'good', 'Strong first minute: only ' . $r['bounce_pct'] . '% leave in the first 30 seconds.' ); }
	}
	if ( $u >= 10 && $r['stayed_5m'] > 0 ) { $add( 'info', round( $r['stayed_5m'] / $u * 100 ) . '% of viewers have watched 5+ minutes; the average viewer stays ' . sml_li_dur( $r['avg_watch'] ) . '.' ); }

	/* geography */
	if ( $u >= 8 && $r['geo']['countries'] ) {
		$c0 = $r['geo']['countries'][0];
		if ( '' !== $c0['code'] && $c0['total'] / $u >= 0.5 ) { $add( 'info', round( $c0['total'] / $u * 100 ) . '% of viewers are in ' . $c0['name'] . '. ' . ( 'US' === $c0['code'] ? 'US market hours are the ones that matter most for them.' : 'Their local trading hours may differ from yours.' ) ); }
		elseif ( count( $r['geo']['countries'] ) >= 3 ) { $add( 'info', 'Your audience is international: ' . $r['geo']['countries'][0]['name'] . ', ' . $r['geo']['countries'][1]['name'] . ' and ' . $r['geo']['countries'][2]['name'] . ' lead.' ); }
	}
	$dv = $r['devices']; $dt = array_sum( $dv );
	if ( $dt >= 10 && $dv['m'] / $dt >= 0.6 ) { $add( 'info', round( $dv['m'] / $dt * 100 ) . '% are on a phone. Keep chart text large and say the ticker out loud, not only on screen.' ); }

	/* people who come back */
	if ( $m >= 10 && $r['audience']['returning'] > 0 ) { $add( 'good', round( $r['audience']['returning'] / $m * 100 ) . '% of signed-in viewers have watched your streams before.' ); }
	if ( $r['subs']['gained'] > 0 ) { $add( 'good', $r['subs']['gained'] . ' new subscriber' . ( 1 === $r['subs']['gained'] ? '' : 's' ) . ' during this stream' . ( $u ? ' (' . round( $r['subs']['gained'] / $u * 100, 1 ) . '% of viewers)' : '' ) . '.' ); }
	return array_slice( $out, 0, 8 );
}

/* ------------------------------------------------------------------ REST */

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-live-insights/v1', '/stream', array(
		'methods'             => 'GET',
		'permission_callback' => 'is_user_logged_in',
		'callback'            => function ( WP_REST_Request $request ) {
			if ( ! function_exists( 'sml_lv_t' ) ) { return new WP_Error( 'sml_li_deps', 'Viewer tracking is not available.', array( 'status' => 503 ) ); }
			$uid  = get_current_user_id();
			$host = $uid;
			if ( current_user_can( 'manage_options' ) && $request->get_param( 'host' ) ) { $host = absint( $request->get_param( 'host' ) ); }
			$want = preg_replace( '/[^A-Za-z0-9]/', '', (string) $request->get_param( 'stream' ) );
			$ck   = 'sml_li_' . $host . '_' . ( $want ?: 'cur' );
			$hit  = wp_cache_get( $ck, 'sml_li' );
			if ( is_array( $hit ) ) { $res = rest_ensure_response( $hit ); $res->header( 'Cache-Control', 'no-store, private' ); return $res; }
			$rep = sml_li_report( $host, $want );
			wp_cache_set( $ck, $rep, 'sml_li', 3 );
			$res = rest_ensure_response( $rep );
			$res->header( 'Cache-Control', 'no-store, private' );
			return $res;
		},
	) );
} );

/* a new subscriber, attributed to where they were watching from */
add_action( 'sml_csub_new_subscriber', function ( $viewer, $creator ) {
	if ( ! function_exists( 'sml_lv_log_event' ) ) { return; }
	$handle = function_exists( 'sml_scheduled_live_handle_for_user' ) ? sml_lv_clean_handle( sml_scheduled_live_handle_for_user( $creator ) ) : '';
	$key    = sml_lv_key( $handle, (int) $creator );
	global $wpdb;
	$row = $wpdb->get_row( $wpdb->prepare( 'SELECT src, surf FROM ' . sml_lv_t() . ' WHERE stream_key = %s AND viewer = %s', $key, sha1( 'u:' . (int) $viewer ) ), ARRAY_A );
	$val = $row ? ( 'site' === $row['src'] && '' !== $row['surf'] ? 'site:' . $row['surf'] : $row['src'] ) : '';
	sml_lv_log_event( $key, 'sub', (int) $viewer, $val );
}, 10, 2 );
