<?php
/**
 * Group score sources other than Q&A: verified price-target hits, outside shares that real
 * visitors opened, and the daily standing (members, daily actives, badge holders, Loop
 * Channel creators, Loop Letter writers).
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_gs_table_exists( $table ) {
	global $wpdb;
	static $seen = array();
	if ( ! isset( $seen[ $table ] ) ) $seen[ $table ] = ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) === $table );
	return $seen[ $table ];
}

function sml_gs_events_on( $gid, $source, $day ) {
	global $wpdb;
	return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM " . sml_gs_t( 'events' ) . " WHERE group_id = %d AND source = %s AND day = %s", (int) $gid, $source, $day ) );
}

/* ------------------------------------------------------- price targets hit */

/**
 * Only alerts the integrity tracker (sml-group-integrity) has SETTLED with target_hit = 1
 * count — never an open, excluded or deleted alert — and only when the author belongs to
 * the group. 10 per group per day.
 */
function sml_gs_score_target_hits() {
	global $wpdb;
	$table = $wpdb->prefix . 'sml_group_alert_performance';
	if ( ! sml_gs_table_exists( $table ) ) return;
	$s = sml_gs_settings();
	$rows = $wpdb->get_results( $wpdb->prepare(
		"SELECT alert_key, group_id, author_id, symbol, settled_at_utc FROM $table
		  WHERE status = 'settled' AND target_hit = 1 AND source_deleted = 0 AND settled_at_utc >= %s
		  ORDER BY settled_at_utc ASC LIMIT 500",
		sml_gs_utc( sml_gs_now() - 30 * DAY_IN_SECONDS )
	), ARRAY_A );
	foreach ( (array) $rows as $r ) {
		$gid = (int) $r['group_id'];
		if ( ! in_array( (int) $r['author_id'], sml_gs_group_member_ids( $gid ), true ) ) continue;
		$day = sml_gs_et_day( strtotime( $r['settled_at_utc'] . ' UTC' ) );
		if ( sml_gs_events_on( $gid, 'target_hit', $day ) >= $s['cap_target_hits_day'] ) continue;
		sml_gs_record( $gid, 'target_hit', 'alert:' . $r['alert_key'], $s['pts_target_hit'], (int) $r['author_id'], $day, array( 'symbol' => $r['symbol'] ) );
	}
}

/* ----------------------------------------------------------- outside shares */

/**
 * Distribute shares (a member's link posted to an outside platform). A share counts when
 * 2+ different visitor sessions opened it within 7 days. It credits the groups the sharer
 * already belonged to when sharing (split across them), capped per member and per group.
 * One piece of content counts once per member — posting the same letter to nine platforms
 * is one share, so connecting more accounts can't farm points; the visitors of all its
 * platform links are pooled.
 */
function sml_gs_score_shares() {
	global $wpdb;
	$queue = $wpdb->prefix . 'sml_dist_queue';
	$clicks = $wpdb->prefix . 'sml_dist_clicks';
	if ( ! sml_gs_table_exists( $queue ) || ! sml_gs_table_exists( $clicks ) ) return;
	$s = sml_gs_settings();
	$rows = $wpdb->get_results( $wpdb->prepare(
		"SELECT q.user_id, q.entity_type, q.entity_id, MIN(q.created_at) shared_at, GROUP_CONCAT(DISTINCT q.share_token) tokens FROM $queue q
		  WHERE q.status IN ('sent','handoff') AND q.share_token <> '' AND q.created_at >= %s
		  GROUP BY q.user_id, q.entity_type, q.entity_id LIMIT 500",
		sml_gs_utc( sml_gs_now() - ( $s['share_window_days'] + 7 ) * DAY_IN_SECONDS )
	), ARRAY_A );
	foreach ( (array) $rows as $r ) {
		$uid = (int) $r['user_id'];
		if ( ! sml_gs_person_qualifies( sml_gs_person( $uid ), $s['min_account_days_vote'], sml_gs_now() ) ) continue;
		$shared_ts = (int) strtotime( $r['shared_at'] . ' UTC' );
		$click_rows = array();
		$tokens = array_values( array_filter( array_map( 'sanitize_text_field', explode( ',', (string) $r['tokens'] ) ) ) );
		if ( ! $tokens ) continue;
		$ph = implode( ',', array_fill( 0, count( $tokens ), '%s' ) );
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT session_key, ua_class, created_at FROM $clicks WHERE share_token IN ($ph) LIMIT 1000", $tokens ), ARRAY_A ) as $c ) {
			$click_rows[] = array( 'session' => $c['session_key'], 'ua_class' => $c['ua_class'], 'ts' => (int) strtotime( $c['created_at'] . ' UTC' ) );
		}
		if ( ! sml_gs_share_counts( $shared_ts, $click_rows, $s ) ) continue;
		$groups = array();
		foreach ( sml_gs_memberships( $uid ) as $gid => $joined ) if ( $joined > 0 && $joined <= $shared_ts ) $groups[] = $gid;
		if ( ! $groups ) continue;
		$day  = sml_gs_et_day( $shared_ts );
		$entity = sanitize_key( $r['entity_type'] ) . '-' . (int) $r['entity_id'];
		$mine = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(DISTINCT SUBSTRING_INDEX(ref, ':', 3)) FROM " . sml_gs_t( 'events' ) . " WHERE source = 'share' AND user_id = %d AND day = %s", $uid, $day ) );
		if ( $mine >= $s['cap_shares_member_day'] ) continue;
		$each = sml_gs_share_points_each( count( $groups ), $s );
		foreach ( $groups as $gid ) {
			if ( sml_gs_events_on( $gid, 'share', $day ) >= $s['cap_shares_group_day'] ) continue;
			sml_gs_record( $gid, 'share', 'share:' . $uid . ':' . $entity . ':' . $gid, $each, $uid, $day, array( 'entity' => $r['entity_type'] . ':' . $r['entity_id'], 'platforms' => count( $tokens ) ) );
		}
	}
}

/* ----------------------------------------------------------- daily standing */

function sml_gs_user_has_badge( $uid ) {
	$has = ( function_exists( 'sml_members_primary_badge' ) && sml_members_primary_badge( $uid ) ) || '' !== (string) get_user_meta( $uid, 'sml_founder_rank', true );
	return (bool) apply_filters( 'sml_gs_user_has_badge', $has, $uid );
}

function sml_gs_user_has_channel( $uid ) {
	return '' !== trim( (string) get_user_meta( $uid, 'sml_channel_handle', true ) );
}

/** The counts one group earns daily points for, on a given ET day. Only qualified people. */
function sml_gs_daily_counts( $gid, $day ) {
	global $wpdb;
	$s       = sml_gs_settings();
	$day_end = ( new DateTimeImmutable( $day . ' 23:59:59', new DateTimeZone( 'America/New_York' ) ) )->getTimestamp();
	$members = array();
	foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT user_id, MIN(joined_at) joined FROM {$wpdb->prefix}sml_group_members WHERE group_id = %d GROUP BY user_id", (int) $gid ) ) as $r ) {
		$joined = sml_gs_local_ts( $r->joined );
		if ( $joined <= 0 || $day_end - $joined < $s['min_member_hours'] * HOUR_IN_SECONDS ) continue;
		if ( ! sml_gs_person_qualifies( sml_gs_person( (int) $r->user_id ), $s['min_account_days_vote'], $day_end ) ) continue;
		$members[] = (int) $r->user_id;
	}
	$counts = array( 'members' => count( $members ), 'dau' => 0, 'badges' => 0, 'channels' => 0, 'letters' => 0 );
	if ( ! $members ) return $counts;
	$in = implode( ',', $members );
	$counts['dau'] = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(DISTINCT user_id) FROM " . sml_gs_t( 'member_days' ) . " WHERE group_id = %d AND day = %s AND user_id IN ($in)", (int) $gid, $day ) );
	$letters = $wpdb->prefix . 'sml_letter_posts';
	$writers = sml_gs_table_exists( $letters ) ? array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare(
		"SELECT DISTINCT author_id FROM $letters WHERE status = 'published' AND author_id IN ($in) AND updated_at >= %s",
		gmdate( 'Y-m-d H:i:s', $day_end - 30 * DAY_IN_SECONDS )
	) ) ) : array();
	foreach ( $members as $uid ) {
		if ( sml_gs_user_has_badge( $uid ) ) $counts['badges']++;
		if ( sml_gs_user_has_channel( $uid ) ) $counts['channels']++;
	}
	$counts['letters'] = count( $writers );
	return $counts;
}

/** Once per ET day, for the day that just ended. */
function sml_gs_score_daily() {
	global $wpdb;
	$yesterday = sml_gs_et_day( sml_gs_now() - DAY_IN_SECONDS );
	if ( get_option( 'sml_gs_daily_done' ) === $yesterday ) return;
	$s = sml_gs_settings();
	foreach ( array_map( 'intval', (array) $wpdb->get_col( "SELECT id FROM {$wpdb->prefix}sml_groups" ) ) as $gid ) {
		$counts = sml_gs_daily_counts( $gid, $yesterday );
		foreach ( sml_gs_daily_points( $counts, $s ) as $component => $points ) {
			if ( $points > 0 ) sml_gs_record( $gid, 'daily_' . $component, 'daily:' . $component . ':' . $gid . ':' . $yesterday, $points, 0, $yesterday, array( 'count' => $counts[ $component ] ) );
		}
	}
	update_option( 'sml_gs_daily_done', $yesterday, false );
	/* activity rows older than 120 days are no longer needed */
	$wpdb->query( $wpdb->prepare( "DELETE FROM " . sml_gs_t( 'member_days' ) . " WHERE day < %s", sml_gs_et_day( sml_gs_now() - 120 * DAY_IN_SECONDS ) ) );
}

/* ------------------------------------------------------------------ reading */

function sml_gs_group_score( $gid ) {
	global $wpdb;
	$gid = (int) $gid;
	$hit = wp_cache_get( 'score_' . $gid, 'sml_gs' );
	if ( is_array( $hit ) ) return $hit;
	$t = sml_gs_t( 'events' );
	$by = array();
	foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT source, SUM(points) pts, COUNT(*) n FROM $t WHERE group_id = %d GROUP BY source", $gid ) ) as $r ) {
		$by[ $r->source ] = array( 'points' => (int) $r->pts, 'events' => (int) $r->n );
	}
	$lifetime = array_sum( array_column( $by, 'points' ) );
	$last30   = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(points),0) FROM $t WHERE group_id = %d AND day >= %s", $gid, sml_gs_et_day( sml_gs_now() - 30 * DAY_IN_SECONDS ) ) );
	$rank     = 1 + (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM (SELECT group_id, SUM(points) s FROM $t GROUP BY group_id) x WHERE x.s > %d", $lifetime ) );
	$out = array( 'group_id' => $gid, 'lifetime' => $lifetime, 'last_30_days' => $last30, 'rank' => $rank, 'breakdown' => $by );
	wp_cache_set( 'score_' . $gid, $out, 'sml_gs', 300 );
	return $out;
}
