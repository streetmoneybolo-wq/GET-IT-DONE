<?php
/**
 * Plugin Name: SML Live Control Room
 * Description: Go Live command hub back end — promo scheduler on top of Distribute (before/during the stream, clicks, times, intervals, milestones), group announcements, superchat totals, and the "Next Best Move" engine.
 * Version: 1.0.0
 *
 * REST  /wp-json/sml-live-control/v1/
 *   GET  /state?stream=      accounts, jetpack, promos, groups, superchats, boost/poll/Q&A snapshot
 *   POST /promo              create a promo (scheduled / interval / milestone / now)
 *   POST /promo/{id}/cancel
 *   POST /preview            dry-run: the exact post text per account, nothing queued
 *   POST /group-announce     post into a writable channel of a group the creator owns / belongs to
 *   GET  /moves?stream=      ranked Next Best Moves
 *
 * A promo is always created by the creator's own click, so a queued row is explicit permission
 * for those accounts. Guard rails: min gap between fired promos, per-hour cap, active cap.
 * ROLLBACK: delete this file. The table stays (wp_sml_live_promos) and is inert without it.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

const SML_LC_DB        = 1;
const SML_LC_MIN_GAP   = 900;   /* seconds between two fired promos to the same account */
const SML_LC_PER_HOUR  = 8;     /* fired promos per creator per hour, all accounts together */
const SML_LC_ACTIVE    = 30;    /* active promo rows per creator */
const SML_LC_MAX_RUNS  = 12;

function sml_lc_t() { global $wpdb; return $wpdb->prefix . 'sml_live_promos'; }

function sml_lc_install() {
	if ( (int) get_option( 'sml_lc_db', 0 ) >= SML_LC_DB ) { return; }
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$c = $wpdb->get_charset_collate();
	dbDelta( "CREATE TABLE " . sml_lc_t() . " (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		user_id BIGINT UNSIGNED NOT NULL,
		stream_id VARCHAR(64) NOT NULL DEFAULT '',
		kind VARCHAR(16) NOT NULL DEFAULT 'custom',
		text TEXT NULL,
		ctx LONGTEXT NULL,
		platforms LONGTEXT NULL,
		groups LONGTEXT NULL,
		fire_at DATETIME NULL,
		repeat_every INT UNSIGNED NOT NULL DEFAULT 0,
		repeat_until DATETIME NULL,
		max_runs SMALLINT UNSIGNED NOT NULL DEFAULT 1,
		runs SMALLINT UNSIGNED NOT NULL DEFAULT 0,
		min_viewers INT UNSIGNED NOT NULL DEFAULT 0,
		cond VARCHAR(16) NOT NULL DEFAULT 'any',
		status VARCHAR(12) NOT NULL DEFAULT 'active',
		last_run DATETIME NULL,
		last_note VARCHAR(190) NOT NULL DEFAULT '',
		created_at DATETIME NOT NULL,
		PRIMARY KEY  (id),
		KEY due (status, fire_at),
		KEY owner (user_id, stream_id)
	) $c;" );
	update_option( 'sml_lc_db', SML_LC_DB, false );
}
add_action( 'init', 'sml_lc_install', 20 );

/* ------------------------------------------------------------------ helpers */

function sml_lc_handle( $uid ) {
	$u = get_userdata( (int) $uid );
	return $u ? sanitize_key( (string) ( $u->user_nicename ?: $u->user_login ) ) : '';
}

function sml_lc_can() { return is_user_logged_in(); }

function sml_lc_dist_ready() { return function_exists( 'sml_dist_enqueue' ) && function_exists( 'sml_dist_accounts_for' ); }

/** Direct-rail accounts the creator has connected (active first). */
function sml_lc_accounts( $uid ) {
	if ( ! sml_lc_dist_ready() ) { return array(); }
	$out = array();
	foreach ( (array) sml_dist_accounts_for( $uid ) as $a ) {
		$out[] = array(
			'id'       => (int) $a['id'],
			'platform' => (string) $a['platform'],
			'handle'   => (string) ( $a['handle'] ?? '' ),
			'status'   => (string) $a['status'],
			'ok'       => 'active' === (string) $a['status'] && function_exists( 'sml_dist_driver' ) && (bool) sml_dist_driver( $a['platform'] ),
		);
	}
	return $out;
}

/** Groups the creator owns or belongs to, with the roles that decide where they can write. */
function sml_lc_groups( $uid ) {
	global $wpdb;
	$g = $wpdb->prefix . 'sml_groups';
	$m = $wpdb->prefix . 'sml_group_members';
	$rows = $wpdb->get_results( $wpdb->prepare(
		"SELECT g.id, g.name, g.slug, g.type, g.icon_url, g.owner_id, m.role
		   FROM $g g LEFT JOIN $m m ON m.group_id = g.id AND m.user_id = %d
		  WHERE g.owner_id = %d OR m.user_id IS NOT NULL ORDER BY g.owner_id = %d DESC, g.name ASC LIMIT 40",
		$uid, $uid, $uid ), ARRAY_A ) ?: array();
	$out = array();
	foreach ( $rows as $r ) {
		$owner = (int) $r['owner_id'] === (int) $uid;
		$out[] = array(
			'id'    => (int) $r['id'],
			'name'  => wp_strip_all_tags( (string) $r['name'] ),
			'slug'  => (string) $r['slug'],
			'icon'  => (string) $r['icon_url'],
			'role'  => $owner ? 'owner' : (string) $r['role'],
			'owned' => $owner,
			'url'   => home_url( '/groups/' . rawurlencode( (string) $r['slug'] ) . '/' ),
		);
	}
	return $out;
}

/** Writable announcement channels of one group, asked of the group system itself as the creator. */
function sml_lc_group_channels( $group_id ) {
	$req = new WP_REST_Request( 'GET', '/sml/v1/group/channels' );
	$req->set_param( 'group_id', (int) $group_id );
	$res = rest_do_request( $req );
	if ( $res->is_error() ) { return array(); }
	$d = $res->get_data();
	$out = array();
	foreach ( (array) ( $d['channels'] ?? array() ) as $c ) {
		if ( empty( $c['can_write'] ) ) { continue; }
		$out[] = array(
			'id'     => (int) $c['id'],
			'name'   => wp_strip_all_tags( (string) $c['name'] ),
			'alerts' => ! empty( $c['is_alert_channel'] ),
			'live'   => (bool) preg_match( '/live|alert|announce/i', (string) $c['name'] ),
		);
	}
	return $out;
}

function sml_lc_group_post( $uid, $channel_id, $text ) {
	$prev = get_current_user_id();
	wp_set_current_user( $uid );
	$req = new WP_REST_Request( 'POST', '/sml/v1/group/channel/message/send' );
	$req->set_param( 'channel_id', (int) $channel_id );
	$req->set_param( 'message', $text );
	$res = rest_do_request( $req );
	wp_set_current_user( $prev );
	if ( $res->is_error() ) {
		$e = $res->as_error();
		return new WP_Error( $e->get_error_code(), $e->get_error_message() );
	}
	return true;
}

/** Stream context the promo needs, taken from the creator's own library; never trusted from the client. */
function sml_lc_stream( $uid, $stream_id ) {
	$row = array();
	if ( $stream_id && function_exists( 'sml_scheduled_live_library' ) ) {
		$lib = (array) sml_scheduled_live_library( $uid );
		if ( isset( $lib[ $stream_id ] ) && is_array( $lib[ $stream_id ] ) ) { $row = $lib[ $stream_id ]; }
	}
	if ( ! $row && function_exists( 'sml_scheduled_live_row' ) ) {
		$cur = sml_scheduled_live_row( $uid );
		if ( is_array( $cur ) && (string) ( $cur['id'] ?? '' ) === (string) $stream_id ) { $row = $cur; }
	}
	$handle = sml_lc_handle( $uid );
	return array(
		'id'            => (string) ( $row['id'] ?? $stream_id ),
		'author_id'     => (int) $uid,
		'title'         => (string) ( $row['title'] ?? 'Live on StockMarketLoop' ),
		'description'   => (string) ( $row['description'] ?? '' ),
		'ticker'        => strtoupper( preg_replace( '/[^A-Z]/', '', (string) ( $row['ticker'] ?? '' ) ) ),
		'thumbnail_url' => (string) ( $row['thumbnail_url'] ?? $row['thumbnail'] ?? '' ),
		'watch_url'     => (string) ( $row['watch_url'] ?? home_url( '/live/?room=' . rawurlencode( $handle ) ) ),
		'started_at'    => (string) ( $row['started_at'] ?? '' ),
		'scheduled_at'  => (string) ( $row['scheduled_at'] ?? '' ),
		'status'        => (string) ( $row['status'] ?? '' ),
		'visibility'    => 'public',
	);
}

function sml_lc_viewers_now( $uid, $stream_id ) {
	if ( ! function_exists( 'sml_lv_count' ) ) { return 0; }
	return $stream_id ? (int) sml_lv_count( 's:' . $stream_id ) : 0;
}

function sml_lc_is_live( $uid, $stream_id ) {
	$s = sml_lc_stream( $uid, $stream_id );
	return 'live' === $s['status'];
}

function sml_lc_kind_event( $kind ) {
	$map = array( 'start' => 'stream.start', 'soon' => 'stream.soon', 'update' => 'stream.update', 'milestone' => 'stream.milestone', 'custom' => 'stream.custom' );
	return $map[ $kind ] ?? 'stream.custom';
}

/** Bundle + the promo fields the variant builders read. */
function sml_lc_bundle( $promo, $viewers = 0 ) {
	$uid    = (int) $promo['user_id'];
	$stream = sml_lc_stream( $uid, (string) $promo['stream_id'] );
	$bundle = sml_dist_bundle_from_stream( $stream );
	$mins   = 0;
	if ( $stream['scheduled_at'] && 'live' !== $stream['status'] ) { $mins = max( 0, (int) round( ( strtotime( $stream['scheduled_at'] ) - time() ) / 60 ) ); }
	if ( $mins > 180 ) { $mins = 0; }
	$bundle['promo'] = array( 'text' => (string) $promo['text'], 'minutes' => $mins, 'viewers' => (int) $viewers );
	return $bundle;
}

/** What each account would post, without queueing anything. */
function sml_lc_preview( $promo, $account_ids ) {
	if ( ! sml_lc_dist_ready() || ! function_exists( 'sml_dist_build_variant' ) ) { return array(); }
	$bundle = sml_lc_bundle( $promo, sml_lc_viewers_now( $promo['user_id'], $promo['stream_id'] ) );
	$seo    = sml_dist_seo( $bundle );
	$event  = sml_lc_kind_event( $promo['kind'] );
	$out    = array();
	foreach ( $account_ids as $aid ) {
		$a = sml_dist_account( (int) $aid );
		if ( ! $a || (int) $a['user_id'] !== (int) $promo['user_id'] ) { continue; }
		$v = sml_dist_build_variant( $bundle, $seo, $a['platform'], $event, (int) sml_dist_preferred_seed( $promo['user_id'], $a['platform'] ), sml_dist_share_link( 'preview' ) );
		$out[] = array( 'account_id' => (int) $a['id'], 'platform' => $a['platform'], 'handle' => $a['handle'], 'ok' => 'active' === $a['status'], 'variant' => $v );
	}
	return $out;
}

/* ------------------------------------------------------------------ firing */

function sml_lc_fired_recently( $uid, $seconds ) {
	global $wpdb;
	return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . sml_lc_t() . ' WHERE user_id = %d AND last_run >= %s', $uid, gmdate( 'Y-m-d H:i:s', time() - $seconds ) ) );
}

/**
 * Queue one run of a promo through Distribute and post to groups. Returns array( queued, groups, note ).
 * Distribute owns the retries and the per-platform rules; this only decides who and when.
 */
function sml_lc_fire( $promo ) {
	global $wpdb;
	$uid      = (int) $promo['user_id'];
	$platforms = json_decode( (string) $promo['platforms'], true ) ?: array();
	$groups    = json_decode( (string) $promo['groups'], true ) ?: array();
	$viewers   = sml_lc_viewers_now( $uid, $promo['stream_id'] );
	$bundle    = sml_lc_bundle( $promo, $viewers );
	$event     = sml_lc_kind_event( $promo['kind'] );
	$queued    = array();
	$note      = array();

	if ( ! empty( $platforms['accounts'] ) && sml_lc_dist_ready() ) {
		$seo   = sml_dist_seo( $bundle );
		$stag  = 0;
		foreach ( (array) $platforms['accounts'] as $aid ) {
			$a = sml_dist_account( (int) $aid );
			if ( ! $a || (int) $a['user_id'] !== $uid ) { $note[] = 'account ' . (int) $aid . ' not yours'; continue; }
			if ( 'active' !== $a['status'] ) { $note[] = $a['platform'] . ' is ' . $a['status']; continue; }
			$r = sml_dist_enqueue( array(
				'user_id'     => $uid,
				'account_id'  => (int) $a['id'],
				'platform'    => $a['platform'],
				'bundle'      => $bundle,
				'seo'         => $seo,
				'event'       => $event,
				'seed'        => sml_dist_preferred_seed( $uid, $a['platform'] ),
				'delay'       => 0,
				'stagger'     => $stag,
				'quiet_start' => null,
				'quiet_end'   => null,
				'idem_suffix' => 'lc' . (int) $promo['id'] . 'r' . (int) $promo['runs'],
			) );
			if ( $r ) { $queued[] = $r; $stag += 90; } else { $note[] = $a['platform'] . ' skipped'; }
		}
	}

	if ( ! empty( $platforms['jetpack'] ) && function_exists( 'sml_dist_jetpack_publish' ) ) {
		$seo = sml_dist_seo( $bundle );
		$j   = sml_dist_jetpack_publish( $bundle, $seo, $event, (int) sml_dist_preferred_seed( $uid, 'facebook' ) );
		$note[] = is_wp_error( $j ) ? 'network: ' . $j->get_error_message() : 'network shared';
	}

	$posted = 0;
	if ( $groups ) {
		$stream = sml_lc_stream( $uid, $promo['stream_id'] );
		$line   = trim( (string) $promo['text'] ) ?: ( 'soon' === $promo['kind'] ? '⏰ Going live soon' : '🔴 Live now' ) . ' — ' . $stream['title'];
		$msg    = $line . "\n" . $stream['watch_url'];
		foreach ( $groups as $cid ) {
			$res = sml_lc_group_post( $uid, (int) $cid, $msg );
			if ( true === $res ) { $posted++; } else { $note[] = 'group: ' . $res->get_error_message(); }
		}
	}

	return array( 'queued' => $queued, 'groups' => $posted, 'note' => implode( '; ', array_slice( $note, 0, 4 ) ) );
}

/** One scheduler pass. Cheap when nothing is due; runs from cron and on every hub state poll. */
function sml_lc_tick( $only_user = 0 ) {
	global $wpdb;
	$t   = sml_lc_t();
	$now = gmdate( 'Y-m-d H:i:s' );
	$where = $only_user ? $wpdb->prepare( ' AND user_id = %d', $only_user ) : '';
	$due = $wpdb->get_results( "SELECT * FROM $t WHERE status = 'active' AND ( ( fire_at IS NOT NULL AND fire_at <= '$now' ) OR ( min_viewers > 0 AND fire_at IS NULL ) ) $where ORDER BY id ASC LIMIT 20", ARRAY_A ) ?: array();
	$fired = 0;
	foreach ( $due as $p ) {
		$uid = (int) $p['user_id'];
		if ( $p['repeat_until'] && $p['repeat_until'] < $now ) {
			$wpdb->update( $t, array( 'status' => 'done', 'last_note' => 'window ended' ), array( 'id' => $p['id'] ) );
			continue;
		}
		$live = sml_lc_is_live( $uid, $p['stream_id'] );
		if ( 'live' === $p['cond'] && ! $live ) { $wpdb->update( $t, array( 'fire_at' => gmdate( 'Y-m-d H:i:s', time() + 120 ), 'last_note' => 'waiting for the stream to be live' ), array( 'id' => $p['id'] ) ); continue; }
		if ( 'before_start' === $p['cond'] && $live ) { $wpdb->update( $t, array( 'status' => 'done', 'last_note' => 'stream already live' ), array( 'id' => $p['id'] ) ); continue; }

		if ( (int) $p['min_viewers'] > 0 && null === $p['fire_at'] ) {
			if ( sml_lc_viewers_now( $uid, $p['stream_id'] ) < (int) $p['min_viewers'] || ! $live ) { continue; }
		}
		/* guard rails: spacing and hourly cap are deferrals, never silent drops */
		if ( sml_lc_fired_recently( $uid, SML_LC_MIN_GAP ) && ! empty( $p['runs'] ) ) {
			$wpdb->update( $t, array( 'fire_at' => gmdate( 'Y-m-d H:i:s', time() + 300 ), 'last_note' => 'spaced out (15 min between posts)' ), array( 'id' => $p['id'] ) );
			continue;
		}
		if ( sml_lc_fired_recently( $uid, 3600 ) >= SML_LC_PER_HOUR ) {
			$wpdb->update( $t, array( 'fire_at' => gmdate( 'Y-m-d H:i:s', time() + 600 ), 'last_note' => 'hourly cap reached' ), array( 'id' => $p['id'] ) );
			continue;
		}

		$res  = sml_lc_fire( $p );
		$runs = (int) $p['runs'] + 1;
		$data = array( 'runs' => $runs, 'last_run' => $now, 'last_note' => substr( ( count( $res['queued'] ) . ' queued' ) . ( $res['groups'] ? ', ' . $res['groups'] . ' group' : '' ) . ( $res['note'] ? ' · ' . $res['note'] : '' ), 0, 190 ) );
		$again = (int) $p['repeat_every'] > 0 && $runs < (int) $p['max_runs'];
		if ( $again ) {
			$data['fire_at'] = gmdate( 'Y-m-d H:i:s', time() + (int) $p['repeat_every'] * 60 );
		} else {
			$data['status'] = 'done';
		}
		$wpdb->update( $t, $data, array( 'id' => $p['id'] ) );
		$fired++;
	}
	return $fired;
}
add_action( 'sml_lc_cron', function () { sml_lc_tick( 0 ); } );
add_action( 'init', function () {
	if ( ! wp_next_scheduled( 'sml_lc_cron' ) ) { wp_schedule_event( time() + 60, 'sml_lc_minute', 'sml_lc_cron' ); }
} );
add_filter( 'cron_schedules', function ( $s ) { $s['sml_lc_minute'] = array( 'interval' => 60, 'display' => 'Every minute' ); return $s; } );

/* ------------------------------------------------------------------ Next Best Move */

/**
 * Quantum-inspired ranking. Every candidate move starts with a prior amplitude; live signals push
 * it up or down (constructive / destructive interference); the squared, normalised amplitudes are
 * the odds shown as "confidence". The creator sees the top few, each with the reason that moved it.
 */
function sml_lc_moves( $uid, $stream_id, array $x ) {
	$m = array();
	$add = function ( $key, $label, $prior, $why, $act ) use ( &$m ) {
		$m[ $key ] = array( 'key' => $key, 'label' => $label, 'amp' => $prior, 'why' => array(), 'act' => $act );
		if ( $why ) { $m[ $key ]['why'][] = $why; }
	};
	$push = function ( $key, $delta, $reason ) use ( &$m ) {
		if ( ! isset( $m[ $key ] ) ) { return; }
		$m[ $key ]['amp'] += $delta;
		if ( $reason ) { $m[ $key ]['why'][] = $reason; }
	};

	$now = (int) $x['now']; $peak = (int) $x['peak']; $live = ! empty( $x['live'] );
	$trend = (float) $x['trend']; /* -1..1 : last 5 min vs the 5 before */
	$guest = (float) $x['guest_pct'];

	$add( 'promote', 'Send a "still live" post now', 0.35, '', array( 'type' => 'promo', 'kind' => 'update' ) );
	$add( 'ride', 'Share the surge — the room is at its peak', 0.15, '', array( 'type' => 'promo', 'kind' => 'milestone' ) );
	$add( 'answer', 'Answer the next question', 0.30, '', array( 'type' => 'tab', 'tab' => 'qa' ) );
	$add( 'poll', 'Run a quick poll', 0.25, '', array( 'type' => 'tab', 'tab' => 'qa' ) );
	$add( 'boost', 'Open a Boost round', 0.20, '', array( 'type' => 'tab', 'tab' => 'boost' ) );
	$add( 'groups', 'Tell your groups you are live', 0.30, '', array( 'type' => 'tab', 'tab' => 'groups' ) );
	$add( 'signup', 'Tell guests chat is free with sign-up', 0.15, '', array( 'type' => 'say' ) );
	$add( 'countdown', 'Schedule the countdown posts', 0.40, '', array( 'type' => 'countdown' ) );
	$add( 'orbit', 'Add photos to your orbit', 0.10, '', array( 'type' => 'tab', 'tab' => 'orbit' ) );
	$add( 'thanks', 'Thank your latest Super Chat', 0.20, '', array( 'type' => 'tab', 'tab' => 'money' ) );

	if ( ! $live ) {
		foreach ( array( 'promote', 'ride', 'poll', 'boost', 'signup', 'thanks', 'answer' ) as $k ) { $m[ $k ]['amp'] *= 0.25; }
		$mins = (int) $x['mins_to_start'];
		if ( $mins > 0 && $mins <= 90 && empty( $x['has_soon'] ) ) { $push( 'countdown', 0.7, 'Starts in ' . $mins . ' min and no countdown post is scheduled.' ); }
		elseif ( $mins > 90 && empty( $x['has_soon'] ) ) { $push( 'countdown', 0.25, 'Nothing is scheduled to announce this stream yet.' ); }
		elseif ( ! empty( $x['has_soon'] ) ) { $m['countdown']['amp'] *= 0.2; }
		if ( $mins > 0 && $mins <= 30 ) { $push( 'groups', 0.35, 'Your groups can be told before you start.' ); }
	} else {
		$m['countdown']['amp'] = 0;
		if ( $trend < -0.15 ) { $push( 'promote', 0.55, 'Viewers are down ' . round( abs( $trend ) * 100 ) . '% over the last 5 minutes.' ); }
		if ( $now > 0 && $now < 8 ) { $push( 'promote', 0.25, 'Only ' . $now . ' watching — a post brings people in.' ); }
		if ( $x['mins_since_promo'] < 15 ) { $m['promote']['amp'] *= 0.15; $m['promote']['why'][] = 'You posted ' . (int) $x['mins_since_promo'] . ' min ago — give it room.'; }
		if ( $now >= 10 && $peak > 0 && $now >= 0.9 * $peak && $trend > 0.1 ) { $push( 'ride', 0.6, $now . ' watching, at your peak and climbing.' ); }
		if ( (int) $x['unanswered'] > 0 ) { $push( 'answer', 0.25 + min( 0.6, 0.12 * (int) $x['unanswered'] ), (int) $x['unanswered'] . ' question' . ( 1 === (int) $x['unanswered'] ? '' : 's' ) . ' waiting.' ); }
		else { $m['answer']['amp'] = 0; }
		if ( ! $x['poll_live'] && $now >= 5 && (float) $x['chat_per_viewer'] < 0.08 ) { $push( 'poll', 0.4, 'Chat is quiet for this many viewers — a poll gets people typing.' ); }
		if ( $x['poll_live'] ) { $m['poll']['amp'] = 0; }
		if ( ! $x['boost_open'] && $now >= 10 && $trend > 0 ) { $push( 'boost', 0.35, 'Growing room with no Boost round: viewers share for Loop Bucks.' ); }
		if ( $x['boost_open'] ) { $m['boost']['amp'] = 0; }
		if ( $guest >= 55 && $now >= 5 ) { $push( 'signup', 0.5, round( $guest ) . '% of viewers are not signed in and cannot chat or like.' ); }
		if ( ! empty( $x['group_owned'] ) && empty( $x['groups_told'] ) ) { $push( 'groups', 0.4, 'You own a group that has not been told about this stream.' ); }
		else { $m['groups']['amp'] *= 0.3; }
		if ( (int) $x['superchats_10m'] > 0 ) { $push( 'thanks', 0.7, (int) $x['superchats_10m'] . ' Super Chat' . ( 1 === (int) $x['superchats_10m'] ? '' : 's' ) . ' in the last 10 minutes.' ); }
		else { $m['thanks']['amp'] = 0; }
		if ( empty( $x['accounts_ok'] ) ) { $m['promote']['amp'] *= 0.2; $m['ride']['amp'] *= 0.2; }
	}
	if ( (int) $x['orbit_count'] < 1 ) { $push( 'orbit', 0.2, 'Nothing on your watch-page orbit yet.' ); } else { $m['orbit']['amp'] = 0; }
	if ( empty( $x['group_owned'] ) && empty( $x['groups_member'] ) ) { $m['groups']['amp'] = 0; }

	$sum = 0;
	foreach ( $m as $k => &$mv ) { $mv['amp'] = max( 0, $mv['amp'] ); $mv['p'] = $mv['amp'] * $mv['amp']; $sum += $mv['p']; }
	unset( $mv );
	$out = array();
	foreach ( $m as $mv ) {
		if ( $mv['amp'] <= 0.12 || ! $mv['why'] ) { continue; }
		$mv['confidence'] = $sum > 0 ? (int) round( 100 * $mv['p'] / $sum ) : 0;
		unset( $mv['p'], $mv['amp'] );
		$mv['why'] = array_slice( $mv['why'], 0, 2 );
		$out[] = $mv;
	}
	usort( $out, function ( $a, $b ) { return $b['confidence'] <=> $a['confidence']; } );
	return array_slice( $out, 0, 4 );
}

function sml_lc_signals( $uid, $stream_id ) {
	global $wpdb;
	$handle = sml_lc_handle( $uid );
	$stream = sml_lc_stream( $uid, $stream_id );
	$live   = 'live' === $stream['status'];
	$x = array( 'live' => $live, 'now' => 0, 'peak' => 0, 'trend' => 0, 'guest_pct' => 0, 'chat_per_viewer' => 0, 'mins_to_start' => 0 );
	if ( $stream['scheduled_at'] && ! $live ) { $x['mins_to_start'] = max( 0, (int) round( ( strtotime( $stream['scheduled_at'] ) - time() ) / 60 ) ); }

	if ( function_exists( 'sml_li_report' ) && $stream_id ) {
		$r = sml_li_report( $uid, $stream_id );
		if ( is_array( $r ) ) {
			$x['now']  = (int) ( $r['now'] ?? 0 );
			$x['peak'] = (int) ( $r['peak']['n'] ?? 0 );
			$v = (array) ( $r['curve']['vals'] ?? array() );
			$n = count( $v );
			if ( $n >= 10 ) {
				$a = array_sum( array_slice( $v, -5 ) ) / 5;
				$b = array_sum( array_slice( $v, -10, 5 ) ) / 5;
				$x['trend'] = $b > 0 ? max( -1, min( 1, ( $a - $b ) / $b ) ) : ( $a > 0 ? 1 : 0 );
			}
			$aud = (array) ( $r['audience'] ?? array() );
			$tot = (int) ( $r['unique'] ?? 0 );
			$x['guest_pct'] = $tot > 0 ? 100 * (int) ( $aud['guests'] ?? 0 ) / $tot : 0;
			$x['chat_per_viewer'] = $x['now'] > 0 ? (float) ( $r['chat']['per_min'] ?? 0 ) / $x['now'] : 0;
		}
	}

	$q = $wpdb->prefix . 'sml_engage_qa';
	$x['unanswered'] = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $q WHERE user_id = %d AND status = 'queued'", $uid ) );
	$p = $wpdb->prefix . 'sml_engage_polls';
	$x['poll_live'] = (bool) $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $p WHERE user_id = %d AND status = 'live' LIMIT 1", $uid ) );
	$b = get_option( 'sml_lw_boost_' . $handle, null );
	$x['boost_open'] = is_array( $b ) && ! empty( $b['ends'] ) && time() < (int) $b['ends'];

	$t = sml_lc_t();
	$last = $wpdb->get_var( $wpdb->prepare( "SELECT MAX(last_run) FROM $t WHERE user_id = %d", $uid ) );
	$x['mins_since_promo'] = $last ? (int) floor( ( time() - strtotime( $last . ' UTC' ) ) / 60 ) : 999;
	$x['has_soon'] = (bool) $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE user_id = %d AND stream_id = %s AND kind = 'soon' AND status IN ('active','done') LIMIT 1", $uid, $stream_id ) );
	$x['groups_told'] = (bool) $wpdb->get_var( $wpdb->prepare( "SELECT id FROM $t WHERE user_id = %d AND stream_id = %s AND groups IS NOT NULL AND groups NOT IN ('','[]') AND runs > 0 LIMIT 1", $uid, $stream_id ) );

	$acc = sml_lc_accounts( $uid );
	$x['accounts_ok'] = (bool) array_filter( $acc, function ( $a ) { return $a['ok']; } );
	$grp = sml_lc_groups( $uid );
	$x['group_owned']  = (bool) array_filter( $grp, function ( $g ) { return $g['owned']; } );
	$x['groups_member'] = count( $grp ) > 0;

	$sc = $wpdb->prefix . 'sml_voice_superchats';
	$x['superchats_10m'] = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $sc WHERE room_id = %s AND status NOT IN ('refunded','failed','pending') AND created_at >= %s", $handle, gmdate( 'Y-m-d H:i:s', time() - 600 ) ) );

	$x['orbit_count'] = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_title LIKE %s", $wpdb->esc_like( 'sml-orbit-' . $handle ) . '%' ) );
	return $x;
}

/* ------------------------------------------------------------------ REST */

add_action( 'rest_api_init', function () {
	$ns = 'sml-live-control/v1';
	$p  = 'sml_lc_can';
	register_rest_route( $ns, '/state', array( 'methods' => 'GET', 'permission_callback' => $p, 'callback' => 'sml_lc_rest_state' ) );
	register_rest_route( $ns, '/moves', array( 'methods' => 'GET', 'permission_callback' => $p, 'callback' => 'sml_lc_rest_moves' ) );
	register_rest_route( $ns, '/promo', array( 'methods' => 'POST', 'permission_callback' => $p, 'callback' => 'sml_lc_rest_promo' ) );
	register_rest_route( $ns, '/promo/(?P<id>\d+)/cancel', array( 'methods' => 'POST', 'permission_callback' => $p, 'callback' => 'sml_lc_rest_cancel' ) );
	register_rest_route( $ns, '/arm', array( 'methods' => 'POST', 'permission_callback' => $p, 'callback' => 'sml_lc_rest_arm' ) );
	register_rest_route( $ns, '/preview', array( 'methods' => 'POST', 'permission_callback' => $p, 'callback' => 'sml_lc_rest_preview' ) );
	register_rest_route( $ns, '/group-channels', array( 'methods' => 'GET', 'permission_callback' => $p, 'callback' => 'sml_lc_rest_group_channels' ) );
} );

function sml_lc_own_stream_id( $uid, $raw ) {
	$sid = sanitize_text_field( (string) $raw );
	if ( 'current' === $sid || '' === $sid ) {
		if ( function_exists( 'sml_lv_live_stream' ) ) { $sid = sml_lv_live_stream( $uid ); }
		if ( '' === $sid && function_exists( 'sml_scheduled_live_row' ) ) { $cur = sml_scheduled_live_row( $uid ); $sid = is_array( $cur ) ? (string) ( $cur['id'] ?? '' ) : ''; }
	}
	if ( '' !== $sid && function_exists( 'sml_lv_owns_stream' ) && ! sml_lv_owns_stream( $uid, $sid ) ) { return ''; }
	return $sid;
}

function sml_lc_promo_public( $r ) {
	return array(
		'id' => (int) $r['id'], 'kind' => $r['kind'], 'text' => (string) $r['text'], 'status' => $r['status'],
		'fire_at' => $r['fire_at'] ? gmdate( 'c', strtotime( $r['fire_at'] . ' UTC' ) ) : null,
		'repeat_every' => (int) $r['repeat_every'], 'max_runs' => (int) $r['max_runs'], 'runs' => (int) $r['runs'],
		'min_viewers' => (int) $r['min_viewers'], 'cond' => $r['cond'],
		'accounts' => (array) ( json_decode( (string) $r['platforms'], true )['accounts'] ?? array() ),
		'network' => ! empty( json_decode( (string) $r['platforms'], true )['jetpack'] ),
		'groups' => (array) json_decode( (string) $r['groups'], true ),
		'last_run' => $r['last_run'] ? gmdate( 'c', strtotime( $r['last_run'] . ' UTC' ) ) : null,
		'note' => (string) $r['last_note'],
	);
}

function sml_lc_rest_state( WP_REST_Request $req ) {
	global $wpdb;
	$uid = get_current_user_id();
	sml_lc_tick( $uid );
	$sid    = sml_lc_own_stream_id( $uid, $req->get_param( 'stream' ) );
	$handle = sml_lc_handle( $uid );
	$rows   = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . sml_lc_t() . " WHERE user_id = %d AND ( stream_id = %s OR stream_id = '' ) AND status <> 'cancelled' ORDER BY FIELD(status,'active','done'), fire_at ASC, id DESC LIMIT 40", $uid, $sid ), ARRAY_A ) ?: array();
	$sc     = $wpdb->prefix . 'sml_voice_superchats';
	$since  = $sid ? gmdate( 'Y-m-d H:i:s', strtotime( ( sml_lc_stream( $uid, $sid )['started_at'] ?: sml_lc_stream( $uid, $sid )['scheduled_at'] ?: 'now' ) ) ) : gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS );
	$agg    = $wpdb->get_row( $wpdb->prepare( "SELECT COUNT(*) n, COALESCE(SUM(loop_bucks),0) lb FROM $sc WHERE room_id = %s AND status NOT IN ('refunded','failed','pending') AND created_at >= %s", $handle, $since ), ARRAY_A );
	$recent = $wpdb->get_results( $wpdb->prepare( "SELECT user_id, loop_bucks, message, created_at FROM $sc WHERE room_id = %s AND status NOT IN ('refunded','failed','pending') AND created_at >= %s ORDER BY id DESC LIMIT 8", $handle, $since ), ARRAY_A ) ?: array();
	foreach ( $recent as &$r ) { $u = get_userdata( (int) $r['user_id'] ); $r['name'] = $u ? $u->display_name : 'Viewer'; unset( $r['user_id'] ); $r['at'] = gmdate( 'c', strtotime( $r['created_at'] . ' UTC' ) ); unset( $r['created_at'] ); }
	unset( $r );

	$groups = sml_lc_groups( $uid );
	$orbit  = $wpdb->get_results( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_title LIKE %s", $wpdb->esc_like( 'sml-orbit-' . $handle ) . '%' ) );

	return array(
		'stream_id' => $sid,
		'handle'    => $handle,
		'entitled'  => function_exists( 'sml_dist_can_autoshare' ) ? (bool) sml_dist_can_autoshare( $uid ) : false,
		'accounts'  => sml_lc_accounts( $uid ),
		'network'   => function_exists( 'sml_dist_jetpack_publish' ),
		'promos'    => array_map( 'sml_lc_promo_public', $rows ),
		'groups'    => $groups,
		'money'     => array( 'n' => (int) $agg['n'], 'lb' => (int) $agg['lb'], 'recent' => $recent ),
		'orbit'     => array( 'count' => count( $orbit ), 'max' => 5 ),
		'limits'    => array( 'gap_min' => SML_LC_MIN_GAP / 60, 'per_hour' => SML_LC_PER_HOUR, 'max_runs' => SML_LC_MAX_RUNS ),
	);
}

function sml_lc_rest_moves( WP_REST_Request $req ) {
	$uid = get_current_user_id();
	$sid = sml_lc_own_stream_id( $uid, $req->get_param( 'stream' ) );
	$key = 'sml_lc_moves_' . $uid . '_' . md5( $sid );
	$hit = get_transient( $key );
	if ( is_array( $hit ) ) { return $hit; }
	$out = array( 'stream_id' => $sid, 'moves' => sml_lc_moves( $uid, $sid, sml_lc_signals( $uid, $sid ) ) );
	set_transient( $key, $out, 20 );
	return $out;
}

function sml_lc_rest_group_channels( WP_REST_Request $req ) {
	$uid = get_current_user_id();
	$gid = (int) $req->get_param( 'group_id' );
	$ok  = false;
	foreach ( sml_lc_groups( $uid ) as $g ) { if ( $g['id'] === $gid ) { $ok = true; } }
	if ( ! $ok ) { return new WP_Error( 'sml_lc_group', 'You are not in that group.', array( 'status' => 403 ) ); }
	return array( 'channels' => sml_lc_group_channels( $gid ) );
}

/** Parse + validate the body shared by /promo and /preview. */
function sml_lc_read_promo( WP_REST_Request $req, $uid ) {
	$kind = sanitize_key( (string) $req->get_param( 'kind' ) );
	if ( ! in_array( $kind, array( 'start', 'soon', 'update', 'milestone', 'custom' ), true ) ) { $kind = 'custom'; }
	$sid  = sml_lc_own_stream_id( $uid, $req->get_param( 'stream' ) );
	if ( '' === $sid ) { return new WP_Error( 'sml_lc_stream', 'That stream is not yours.', array( 'status' => 403 ) ); }

	$owned = array();
	foreach ( sml_lc_accounts( $uid ) as $a ) { $owned[ $a['id'] ] = $a; }
	$accounts = array();
	foreach ( (array) $req->get_param( 'accounts' ) as $aid ) { if ( isset( $owned[ (int) $aid ] ) ) { $accounts[] = (int) $aid; } }

	$channels = array();
	$myg = array(); foreach ( sml_lc_groups( $uid ) as $g ) { $myg[ $g['id'] ] = true; }
	foreach ( (array) $req->get_param( 'group_channels' ) as $cid ) {
		global $wpdb;
		$gid = (int) $wpdb->get_var( $wpdb->prepare( "SELECT group_id FROM {$wpdb->prefix}sml_group_channels WHERE id = %d", (int) $cid ) );
		if ( $gid && isset( $myg[ $gid ] ) ) { $channels[] = (int) $cid; }
	}

	return array(
		'user_id'   => $uid,
		'stream_id' => $sid,
		'kind'      => $kind,
		'text'      => mb_substr( sanitize_textarea_field( (string) $req->get_param( 'text' ) ), 0, 240 ),
		'accounts'  => array_slice( $accounts, 0, 10 ),
		'network'   => (bool) $req->get_param( 'network' ),
		'groups'    => array_slice( array_unique( $channels ), 0, 10 ),
	);
}

function sml_lc_rest_preview( WP_REST_Request $req ) {
	$uid = get_current_user_id();
	$in  = sml_lc_read_promo( $req, $uid );
	if ( is_wp_error( $in ) ) { return $in; }
	return array( 'previews' => sml_lc_preview( $in, $in['accounts'] ) );
}

/**
 * Body: kind, text, accounts[], network, group_channels[], stream, and one timing mode:
 *   when: now | at (iso) | before (minutes before scheduled start) | milestone (min_viewers)
 *   every (minutes), runs, until (iso), only_live (bool)
 */
function sml_lc_rest_promo( WP_REST_Request $req ) {
	global $wpdb;
	$uid = get_current_user_id();
	if ( ! sml_lc_dist_ready() ) { return new WP_Error( 'sml_lc_dist', 'Distribute is not available.', array( 'status' => 503 ) ); }
	$in = sml_lc_read_promo( $req, $uid );
	if ( is_wp_error( $in ) ) { return $in; }
	if ( ! $in['accounts'] && ! $in['network'] && ! $in['groups'] ) { return new WP_Error( 'sml_lc_none', 'Pick at least one account, the network or a group.', array( 'status' => 400 ) ); }
	if ( $in['accounts'] && function_exists( 'sml_dist_can_autoshare' ) && ! sml_dist_can_autoshare( $uid ) ) { return new WP_Error( 'sml_lc_plan', 'Auto-posting is not enabled on your plan.', array( 'status' => 403 ) ); }

	$active = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . sml_lc_t() . " WHERE user_id = %d AND status = 'active'", $uid ) );
	if ( $active >= SML_LC_ACTIVE ) { return new WP_Error( 'sml_lc_cap', 'Too many scheduled posts — cancel some first.', array( 'status' => 429 ) ); }

	/* a double click must not double post */
	$dupe = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . sml_lc_t() . ' WHERE user_id = %d AND stream_id = %s AND kind = %s AND text = %s AND platforms = %s AND groups = %s AND created_at >= %s',
		$uid, $in['stream_id'], $in['kind'], $in['text'], wp_json_encode( array( 'accounts' => $in['accounts'], 'jetpack' => $in['network'] ) ), wp_json_encode( $in['groups'] ), gmdate( 'Y-m-d H:i:s', time() - 45 ) ) );
	if ( $dupe ) { return new WP_Error( 'sml_lc_dupe', 'That post was just scheduled.', array( 'status' => 409 ) ); }

	$when   = sanitize_key( (string) $req->get_param( 'when' ) ) ?: 'now';
	$stream = sml_lc_stream( $uid, $in['stream_id'] );
	$fire   = time();
	$minv   = 0;
	if ( 'at' === $when ) {
		$fire = strtotime( (string) $req->get_param( 'at' ) );
		if ( ! $fire || $fire < time() - 60 ) { return new WP_Error( 'sml_lc_time', 'Pick a time in the future.', array( 'status' => 400 ) ); }
	} elseif ( 'before' === $when ) {
		$mins = max( 1, min( 1440, (int) $req->get_param( 'minutes' ) ) );
		$start = $stream['scheduled_at'] ? strtotime( $stream['scheduled_at'] ) : 0;
		if ( ! $start ) { return new WP_Error( 'sml_lc_nostart', 'This stream has no scheduled start time.', array( 'status' => 400 ) ); }
		$fire = $start - $mins * 60;
		if ( $fire < time() - 60 ) { return new WP_Error( 'sml_lc_late', 'That moment has already passed.', array( 'status' => 400 ) ); }
	} elseif ( 'milestone' === $when ) {
		$minv = max( 5, min( 100000, (int) $req->get_param( 'min_viewers' ) ) );
	}
	$every = max( 0, min( 720, (int) $req->get_param( 'every' ) ) );
	if ( $every && $every < 15 ) { $every = 15; }
	$runs  = $every ? max( 1, min( SML_LC_MAX_RUNS, (int) $req->get_param( 'runs' ) ?: 3 ) ) : 1;
	$until = $req->get_param( 'until' ) ? strtotime( (string) $req->get_param( 'until' ) ) : 0;

	$cond = $req->get_param( 'only_live' ) || in_array( $in['kind'], array( 'update', 'milestone' ), true ) ? 'live' : ( in_array( $in['kind'], array( 'soon' ), true ) ? 'before_start' : 'any' );

	$wpdb->insert( sml_lc_t(), array(
		'user_id' => $uid, 'stream_id' => $in['stream_id'], 'kind' => $in['kind'], 'text' => $in['text'],
		'platforms' => wp_json_encode( array( 'accounts' => $in['accounts'], 'jetpack' => $in['network'] ) ),
		'groups' => wp_json_encode( $in['groups'] ),
		'fire_at' => $minv ? null : gmdate( 'Y-m-d H:i:s', $fire ),
		'repeat_every' => $every, 'repeat_until' => $until ? gmdate( 'Y-m-d H:i:s', $until ) : null,
		'max_runs' => $runs, 'min_viewers' => $minv, 'cond' => $cond, 'status' => 'active',
		'created_at' => gmdate( 'Y-m-d H:i:s' ),
	) );
	$id = (int) $wpdb->insert_id;
	if ( 'now' === $when ) { sml_lc_tick( $uid ); }
	$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . sml_lc_t() . ' WHERE id = %d', $id ), ARRAY_A );
	return array( 'ok' => true, 'promo' => sml_lc_promo_public( $row ) );
}

function sml_lc_rest_cancel( WP_REST_Request $req ) {
	global $wpdb;
	$n = $wpdb->update( sml_lc_t(), array( 'status' => 'cancelled', 'last_note' => 'cancelled' ), array( 'id' => (int) $req['id'], 'user_id' => get_current_user_id() ) );
	return array( 'ok' => (bool) $n );
}

/** Make one of the creator's own not-yet-ended streams the current record, so starting the stream flips that one live. */
function sml_lc_rest_arm( WP_REST_Request $req ) {
	$uid = get_current_user_id();
	$sid = sanitize_text_field( (string) $req->get_param( 'stream' ) );
	if ( '' === $sid || ! function_exists( 'sml_scheduled_live_row' ) || ! function_exists( 'sml_scheduled_live_store' ) ) { return new WP_Error( 'sml_lc_arm', 'Stream not available.', array( 'status' => 400 ) ); }
	$row = sml_scheduled_live_row( $uid, $sid );
	if ( ! is_array( $row ) || empty( $row['id'] ) || ! in_array( (string) ( $row['status'] ?? '' ), array( 'scheduled', 'live' ), true ) ) { return new WP_Error( 'sml_lc_arm', 'That stream cannot be started.', array( 'status' => 404 ) ); }
	sml_scheduled_live_store( $uid, $row, true );
	return array( 'ok' => true, 'stream_id' => (string) $row['id'] );
}
