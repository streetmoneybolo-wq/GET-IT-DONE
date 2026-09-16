<?php
/**
 * Plugin Name: SML Group Score & Q&A Rewards
 * Description: Lifetime Group Score (verified price-target hits, Q&A credited to the group, outside shares that real people open, daily active members, members, badge holders, Loop Channel creators, Loop Letter writers) and Loop Bucks for good answers and questions — with the member choosing to keep the Loop Bucks or give their group the credit.
 * Version: 1.1.1
 * Author: StockMarketLoop
 *
 * OWNER RULES (2026-09-16): Q&A should matter to every creator, group owner and member who
 * wants attention. Answers and good questions earn Loop Bucks, unless a group member lists
 * the answer/question for their group, in which case the GROUP earns Q&A credit instead.
 * The group score is lifetime-tracked and grows from price targets hit in group alerts,
 * Q&A, good questions, daily active users, members, outside shares, members with badges,
 * Loop Channel creators and Loop Letter writers. "Use logic to make it bulletproof."
 *
 * HOW IT STAYS HONEST
 *  - Every point is a row in an append-only ledger with a UNIQUE reference, so nothing can
 *    be counted twice, whatever retries, crons or races happen. Loop Bucks use the site
 *    ledger's own unique reference the same way.
 *  - Rewards are not paid when something first qualifies. They wait 24 hours and are
 *    re-checked; if the vote was withdrawn, the acceptance removed or the answer deleted,
 *    nothing is paid.
 *  - Only established, verified, human accounts earn or count (7-day accounts to earn,
 *    3-day accounts to vote, verified email, never the automated news desks).
 *  - Collusion guards: a group earns nothing from questions its own members asked, group
 *    members' upvotes don't count for a group-credited answer, you can't join a group and
 *    credit it the same day (24 h), shares only count when 2+ different outside visitors
 *    open the link, and crowd numbers use square roots so stuffing a group with accounts
 *    doesn't pay.
 *  - Price targets only count once the alert tracker has settled them as verified hits.
 *  - Daily caps: Q&A Loop Bucks 100/day per member (inside the site's 400/day ceiling),
 *    10 target hits and 20 shares per group per day, 5 shares per member per day.
 * All numbers live in option sml_gs_settings (defaults in rules.php).
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

const SML_GS_VERSION = '1.1.1';
const SML_GS_DB      = 1;

require_once __DIR__ . '/includes/rules.php';

/* ================================================================== schema */

function sml_gs_t( $name ) { global $wpdb; return $wpdb->prefix . 'sml_gs_' . $name; }

function sml_gs_install() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$c = $wpdb->get_charset_collate();
	dbDelta( "CREATE TABLE " . sml_gs_t( 'events' ) . " (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		group_id bigint(20) unsigned NOT NULL,
		source varchar(32) NOT NULL,
		ref varchar(140) NOT NULL,
		points int(11) NOT NULL,
		user_id bigint(20) unsigned NOT NULL DEFAULT 0,
		day date NOT NULL,
		meta text NULL,
		created_at datetime NOT NULL,
		PRIMARY KEY  (id),
		UNIQUE KEY ref (ref),
		KEY group_day (group_id, day),
		KEY group_source (group_id, source)
	) $c;" );
	dbDelta( "CREATE TABLE " . sml_gs_t( 'member_days' ) . " (
		day date NOT NULL,
		group_id bigint(20) unsigned NOT NULL,
		user_id bigint(20) unsigned NOT NULL,
		PRIMARY KEY  (day, group_id, user_id)
	) $c;" );
	dbDelta( "CREATE TABLE " . sml_gs_t( 'qa_credit' ) . " (
		object_type varchar(10) NOT NULL,
		object_id bigint(20) unsigned NOT NULL,
		user_id bigint(20) unsigned NOT NULL,
		kind varchar(8) NOT NULL,
		group_id bigint(20) unsigned NOT NULL DEFAULT 0,
		posted_at datetime NOT NULL,
		PRIMARY KEY  (object_type, object_id)
	) $c;" );
	dbDelta( "CREATE TABLE " . sml_gs_t( 'qa_rewards' ) . " (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		kind varchar(24) NOT NULL,
		object_id bigint(20) unsigned NOT NULL,
		beneficiary varchar(8) NOT NULL DEFAULT '',
		user_id bigint(20) unsigned NOT NULL DEFAULT 0,
		group_id bigint(20) unsigned NOT NULL DEFAULT 0,
		amount int(11) NOT NULL DEFAULT 0,
		status varchar(12) NOT NULL DEFAULT 'pending',
		attempts smallint(5) unsigned NOT NULL DEFAULT 0,
		settle_after datetime NOT NULL,
		created_at datetime NOT NULL,
		settled_at datetime NULL,
		PRIMARY KEY  (id),
		UNIQUE KEY kind_object (kind, object_id),
		KEY status_settle (status, settle_after),
		KEY user_settled (user_id, settled_at)
	) $c;" );
	update_option( 'sml_gs_db', SML_GS_DB, false );
}
register_activation_hook( __FILE__, 'sml_gs_install' );
add_action( 'plugins_loaded', function () { if ( (int) get_option( 'sml_gs_db' ) < SML_GS_DB ) sml_gs_install(); } );

/* ================================================================= helpers */

function sml_gs_now() { return time(); }
function sml_gs_utc( $ts = null ) { return gmdate( 'Y-m-d H:i:s', null === $ts ? sml_gs_now() : (int) $ts ); }
function sml_gs_et_day( $ts = null ) { return ( new DateTimeImmutable( '@' . ( null === $ts ? sml_gs_now() : (int) $ts ) ) )->setTimezone( new DateTimeZone( 'America/New_York' ) )->format( 'Y-m-d' ); }
/** Group tables store site-local times (current_time('mysql')). */
function sml_gs_local_ts( $mysql ) { $g = get_gmt_from_date( (string) $mysql ); return $g ? (int) strtotime( $g . ' UTC' ) : 0; }

function sml_gs_person( $uid ) {
	static $cache = array();
	$uid = (int) $uid;
	if ( $uid <= 0 ) return null;
	if ( array_key_exists( $uid, $cache ) ) return $cache[ $uid ];
	$u = get_userdata( $uid );
	if ( ! $u ) return $cache[ $uid ] = null;
	return $cache[ $uid ] = array(
		'id'             => $uid,
		'registered_ts'  => (int) strtotime( $u->user_registered . ' UTC' ),
		'email_verified' => (bool) get_user_meta( $uid, 'sml_email_verified', true ),
		'persona'        => metadata_exists( 'user', $uid, 'sml_author_persona' ),
	);
}

/** group_id => joined_ts for a member's current groups. */
function sml_gs_memberships( $uid ) {
	global $wpdb;
	static $cache = array();
	$uid = (int) $uid;
	if ( isset( $cache[ $uid ] ) ) return $cache[ $uid ];
	$out = array();
	foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT group_id, MIN(joined_at) joined FROM {$wpdb->prefix}sml_group_members WHERE user_id = %d GROUP BY group_id", $uid ) ) as $r ) {
		$out[ (int) $r->group_id ] = sml_gs_local_ts( $r->joined );
	}
	return $cache[ $uid ] = $out;
}

function sml_gs_group_member_ids( $gid ) {
	global $wpdb;
	static $cache = array();
	$gid = (int) $gid;
	if ( ! isset( $cache[ $gid ] ) ) $cache[ $gid ] = array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( "SELECT DISTINCT user_id FROM {$wpdb->prefix}sml_group_members WHERE group_id = %d", $gid ) ) );
	return $cache[ $gid ];
}

/** Append one scoring event. Returns true only when it was newly recorded. */
function sml_gs_record( $gid, $source, $ref, $points, $user_id = 0, $day = null, $meta = array() ) {
	global $wpdb;
	if ( (int) $gid <= 0 || (int) $points === 0 ) return false;
	$n = $wpdb->query( $wpdb->prepare(
		"INSERT IGNORE INTO " . sml_gs_t( 'events' ) . " (group_id, source, ref, points, user_id, day, meta, created_at) VALUES (%d, %s, %s, %d, %d, %s, %s, %s)",
		(int) $gid, $source, substr( $ref, 0, 140 ), (int) $points, (int) $user_id, $day ?: sml_gs_et_day(), wp_json_encode( $meta ), sml_gs_utc()
	) );
	if ( $n ) { wp_cache_delete( 'score_' . (int) $gid, 'sml_gs' ); wp_cache_delete( 'all_scores', 'sml_gs' ); }
	return (bool) $n;
}

/* ======================================================= activity (DAU) */

add_action( 'init', function () {
	if ( ! is_user_logged_in() || wp_doing_cron() || ( defined( 'WP_CLI' ) && WP_CLI ) ) return;
	$uid = get_current_user_id();
	$day = sml_gs_et_day();
	if ( get_user_meta( $uid, 'sml_gs_active_day', true ) === $day ) return;
	update_user_meta( $uid, 'sml_gs_active_day', $day );
	global $wpdb;
	foreach ( array_keys( sml_gs_memberships( $uid ) ) as $gid ) {
		$wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO " . sml_gs_t( 'member_days' ) . " (day, group_id, user_id) VALUES (%s, %d, %d)", $day, $gid, $uid ) );
	}
}, 20 );

require_once __DIR__ . '/includes/qa.php';
require_once __DIR__ . '/includes/score.php';
require_once __DIR__ . '/includes/rest.php';
require_once __DIR__ . '/includes/surfaces.php';

/* =================================================================== cron */

add_filter( 'cron_schedules', function ( $s ) {
	$s['sml_gs_30min'] = array( 'interval' => 1800, 'display' => 'Every 30 minutes (Group Score)' );
	return $s;
} );
add_action( 'init', function () {
	if ( ! wp_next_scheduled( 'sml_gs_tick' ) ) wp_schedule_event( time() + 120, 'sml_gs_30min', 'sml_gs_tick' );
} );
add_action( 'sml_gs_tick', function () {
	if ( get_transient( 'sml_gs_tick_lock' ) ) return;
	set_transient( 'sml_gs_tick_lock', 1, 25 * MINUTE_IN_SECONDS );
	try {
		sml_gs_qa_detect();
		sml_gs_qa_settle();
		sml_gs_score_target_hits();
		sml_gs_score_shares();
		sml_gs_score_daily();
	} finally {
		delete_transient( 'sml_gs_tick_lock' );
	}
} );
register_deactivation_hook( __FILE__, function () { wp_clear_scheduled_hook( 'sml_gs_tick' ); } );
