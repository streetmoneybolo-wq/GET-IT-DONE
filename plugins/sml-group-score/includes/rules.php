<?php
/**
 * The rules, with no database access — every anti-gaming decision lives here so it can be
 * tested exhaustively. Callers pass plain arrays describing people and content.
 *
 * A "person" array: [id, registered_ts, email_verified(bool), persona(bool)].
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_gs_defaults() {
	return array(
		/* Loop Bucks for whoever keeps the credit (owner choice: Standard) */
		'lb_answer_accepted'   => 25,
		'lb_answer_voted'      => 10,
		'lb_question_good'     => 5,
		'lb_qa_daily_cap'      => 100,
		/* group score points */
		'pts_answer_accepted'  => 15,
		'pts_answer_voted'     => 8,
		'pts_question_good'    => 5,
		'pts_target_hit'       => 25,
		'pts_share'            => 3,
		/* daily points ("earn a little every day"), diminishing returns via sqrt */
		'daily_members_k'      => 2,
		'daily_dau_k'          => 5,
		'daily_badges_k'       => 3,
		'daily_channel_each'   => 4,
		'daily_letter_each'    => 4,
		'daily_creator_max'    => 5,     /* creators counted per kind, per day */
		/* caps */
		'cap_target_hits_day'  => 10,    /* per group */
		'cap_shares_group_day' => 20,
		'cap_shares_member_day'=> 5,
		/* thresholds */
		'min_account_days_earn'=> 7,
		'min_account_days_vote'=> 3,
		'min_member_hours'     => 24,
		'min_votes'            => 3,
		'min_share_visitors'   => 2,
		'share_window_days'    => 7,
		'settle_hours'         => 24,
		'cap_retry_days'       => 7,
	);
}

function sml_gs_settings() {
	$saved = get_option( 'sml_gs_settings', array() );
	return array_merge( sml_gs_defaults(), is_array( $saved ) ? array_intersect_key( $saved, sml_gs_defaults() ) : array() );
}

/** A real, established person: old enough, verified email, not an automated desk account. */
function sml_gs_person_qualifies( $person, $min_days, $now ) {
	if ( ! is_array( $person ) || empty( $person['id'] ) ) return false;
	if ( ! empty( $person['persona'] ) ) return false;
	if ( empty( $person['email_verified'] ) ) return false;
	return (int) $person['registered_ts'] > 0 && ( $now - (int) $person['registered_ts'] ) >= $min_days * DAY_IN_SECONDS;
}

/**
 * Where a question/answer's credit goes.
 * $credit: ['kind' => 'self'|'group', 'group_id' => int, 'posted_ts' => int]
 * $membership: group_id => joined_ts for the author's CURRENT memberships.
 * A group credit only stands if the author joined that group at least min_member_hours
 * before posting and is still a member; otherwise the credit falls back to the author.
 */
function sml_gs_resolve_credit( $credit, array $membership, array $s ) {
	if ( ! is_array( $credit ) || 'group' !== ( $credit['kind'] ?? '' ) ) return array( 'kind' => 'self', 'group_id' => 0 );
	$gid = (int) ( $credit['group_id'] ?? 0 );
	if ( $gid <= 0 || ! isset( $membership[ $gid ] ) ) return array( 'kind' => 'self', 'group_id' => 0 );
	$joined = (int) $membership[ $gid ];
	if ( $joined <= 0 || (int) ( $credit['posted_ts'] ?? 0 ) - $joined < $s['min_member_hours'] * HOUR_IN_SECONDS ) return array( 'kind' => 'self', 'group_id' => 0 );
	return array( 'kind' => 'group', 'group_id' => $gid );
}

/**
 * What an answer has earned.
 * $ctx: answer [id, author(person), approved(bool)], asker(person),
 *       accepted(bool — accepted by the asker themself), voters[person...],
 *       credit (resolved), group_member_ids (int[] members of the credited group),
 *       asker_in_credited_group(bool), now
 * Returns a list of ['kind' => 'answer_accepted'|'answer_voted'].
 */
function sml_gs_answer_verdict( array $ctx, array $s ) {
	$now    = (int) $ctx['now'];
	$author = $ctx['author'] ?? null;
	$asker  = $ctx['asker'] ?? null;
	if ( empty( $ctx['approved'] ) || ! sml_gs_person_qualifies( $author, $s['min_account_days_earn'], $now ) ) return array();
	$out     = array();
	$group   = 'group' === ( $ctx['credit']['kind'] ?? 'self' );
	/* collusion guard: a group earns nothing from questions its own members asked */
	$blocked = $group && ! empty( $ctx['asker_in_credited_group'] );

	if ( ! empty( $ctx['accepted'] ) && $asker && (int) $asker['id'] !== (int) $author['id']
		&& sml_gs_person_qualifies( $asker, $s['min_account_days_vote'], $now ) && ! $blocked ) {
		$out[] = array( 'kind' => 'answer_accepted' );
	}

	$members = array_flip( array_map( 'intval', (array) ( $ctx['group_member_ids'] ?? array() ) ) );
	$counted = array();
	foreach ( (array) ( $ctx['voters'] ?? array() ) as $v ) {
		$vid = (int) ( $v['id'] ?? 0 );
		if ( ! $vid || $vid === (int) $author['id'] || isset( $counted[ $vid ] ) ) continue;
		if ( $group && isset( $members[ $vid ] ) ) continue;               /* the group can't upvote itself up */
		if ( ! sml_gs_person_qualifies( $v, $s['min_account_days_vote'], $now ) ) continue;
		$counted[ $vid ] = true;
	}
	if ( count( $counted ) >= $s['min_votes'] && ! $blocked ) $out[] = array( 'kind' => 'answer_voted' );
	return $out;
}

/**
 * Whether a question was a good one.
 * $ctx: asker(person), answers[[author(person), approved, accepted(bool), qualified_votes(int)]], credit, asker_group_member_ids, now
 * Good = 2+ approved answers from different qualified people other than the asker, AND
 * (the asker accepted one of them OR those answers have 3+ qualified upvotes in total).
 */
function sml_gs_question_verdict( array $ctx, array $s ) {
	$now   = (int) $ctx['now'];
	$asker = $ctx['asker'] ?? null;
	if ( ! sml_gs_person_qualifies( $asker, $s['min_account_days_earn'], $now ) ) return false;
	$group   = 'group' === ( $ctx['credit']['kind'] ?? 'self' );
	$members = array_flip( array_map( 'intval', (array) ( $ctx['credited_group_member_ids'] ?? array() ) ) );
	$people  = array(); $accepted = false; $votes = 0;
	foreach ( (array) ( $ctx['answers'] ?? array() ) as $a ) {
		$au = $a['author'] ?? null;
		if ( empty( $a['approved'] ) || ! $au || (int) $au['id'] === (int) $asker['id'] ) continue;
		if ( ! sml_gs_person_qualifies( $au, $s['min_account_days_vote'], $now ) ) continue;
		if ( $group && isset( $members[ (int) $au['id'] ] ) ) continue;    /* answers from the same group don't make its question "good" */
		$people[ (int) $au['id'] ] = true;
		if ( ! empty( $a['accepted'] ) ) $accepted = true;
		$votes += max( 0, (int) ( $a['qualified_votes'] ?? 0 ) );
	}
	return count( $people ) >= 2 && ( $accepted || $votes >= $s['min_votes'] );
}

/**
 * Whether a share counts: 2+ different visitor sessions (not bots) opened the link within
 * the window after it was shared.
 * $clicks: [[session, ua_class, ts]...]
 */
function sml_gs_share_counts( $shared_ts, array $clicks, array $s ) {
	$end = (int) $shared_ts + $s['share_window_days'] * DAY_IN_SECONDS;
	$sessions = array();
	foreach ( $clicks as $c ) {
		$ua = strtolower( (string) ( $c['ua_class'] ?? '' ) );
		$ts = (int) ( $c['ts'] ?? 0 );
		$sk = (string) ( $c['session'] ?? '' );
		if ( '' === $sk || in_array( $ua, array( 'bot', 'crawler', 'spider', 'preview' ), true ) ) continue;
		if ( $ts < (int) $shared_ts || $ts > $end ) continue;
		$sessions[ $sk ] = true;
	}
	return count( $sessions ) >= $s['min_share_visitors'];
}

/** Share points per group: a member in N groups spreads a share across them (at least 1 each). */
function sml_gs_share_points_each( $group_count, array $s ) {
	$n = max( 1, (int) $group_count );
	return max( 1, (int) round( $s['pts_share'] / $n ) );
}

/**
 * A group's points for one day from its standing (diminishing returns so stuffing a group
 * with accounts doesn't pay).
 * $counts: members, dau, badges, channels, letters (all already limited to qualified people)
 */
function sml_gs_daily_points( array $counts, array $s ) {
	$sq = function ( $n, $k ) { return (int) round( $k * sqrt( max( 0, (int) $n ) ) ); };
	return array(
		'members'  => $sq( $counts['members'] ?? 0, $s['daily_members_k'] ),
		'dau'      => $sq( $counts['dau'] ?? 0, $s['daily_dau_k'] ),
		'badges'   => $sq( $counts['badges'] ?? 0, $s['daily_badges_k'] ),
		'channels' => min( (int) ( $counts['channels'] ?? 0 ), $s['daily_creator_max'] ) * $s['daily_channel_each'],
		'letters'  => min( (int) ( $counts['letters'] ?? 0 ), $s['daily_creator_max'] ) * $s['daily_letter_each'],
	);
}

/** Loop Bucks for one reward, given what the person already got from Q&A today. */
function sml_gs_lb_amount( $kind, $already_today, array $s ) {
	$map = array( 'answer_accepted' => 'lb_answer_accepted', 'answer_voted' => 'lb_answer_voted', 'question_good' => 'lb_question_good' );
	if ( ! isset( $map[ $kind ] ) ) return 0;
	$left = (int) $s['lb_qa_daily_cap'] - max( 0, (int) $already_today );
	return max( 0, min( (int) $s[ $map[ $kind ] ], $left ) );
}

function sml_gs_group_points_for( $kind, array $s ) {
	$map = array( 'answer_accepted' => 'pts_answer_accepted', 'answer_voted' => 'pts_answer_voted', 'question_good' => 'pts_question_good' );
	return isset( $map[ $kind ] ) ? (int) $s[ $map[ $kind ] ] : 0;
}
