<?php
/* Staged end-to-end Q&A reward test on live data, fully rolled back. */
global $wpdb;
$P = $wpdb->prefix;
$fails = 0;
function t_ok( $cond, $label ) { global $fails; echo ( $cond ? 'PASS ' : 'FAIL ' ) . $label . PHP_EOL; if ( ! $cond ) $fails++; }

/* author: verified, 7d+, not persona, member of a group joined 24h+ ago; asker: verified 7d+, not in that group */
$verified = $wpdb->get_col( "SELECT user_id FROM {$wpdb->usermeta} WHERE meta_key='sml_email_verified' AND meta_value<>'' AND meta_value<>'0'" );
$verified = array_values( array_filter( array_map( 'intval', $verified ), function ( $u ) {
	$p = sml_gs_person( $u ); return sml_gs_person_qualifies( $p, 8, time() );
} ) );
$A = 0; $G = 0; $B = 0;
foreach ( $verified as $u ) {
	foreach ( sml_gs_memberships( $u ) as $gid => $joined ) {
		if ( $joined && time() - $joined > 2 * DAY_IN_SECONDS ) { $A = $u; $G = $gid; break 2; }
	}
}
foreach ( $verified as $u ) { if ( $u !== $A && ! in_array( $u, sml_gs_group_member_ids( $G ), true ) ) { $B = $u; break; } }
echo "author=$A asker=$B group=$G verified_pool=" . count( $verified ) . PHP_EOL;
if ( ! $A || ! $B || ! $G ) { echo "no suitable users\n"; return; }
$due = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$P}sml_gs_qa_rewards WHERE status='pending' AND settle_after <= UTC_TIMESTAMP()" );
if ( $due ) { echo "real rewards are due; aborting so none are touched\n"; return; }

$bal0A = (int) sml_lb_balance( $A );
$notes0 = count( (array) get_user_meta( $A, 'sml_notifications', true ) );
$maxLedger = (int) $wpdb->get_var( "SELECT MAX(id) FROM " . sml_lb_table( 'ledger' ) );
$maxEvent  = (int) $wpdb->get_var( "SELECT COALESCE(MAX(id),0) FROM {$P}sml_gs_events" );

$wpdb->query( 'START TRANSACTION' );
$made_posts = array(); $made_comments = array();
$mk = function ( $title, $accept ) use ( $wpdb, $A, $B, &$made_posts, &$made_comments ) {
	$now = current_time( 'mysql' ); $gmt = current_time( 'mysql', true );
	$wpdb->insert( $wpdb->posts, array( 'post_author' => $B, 'post_title' => $title, 'post_name' => 'gs-payout-test-' . wp_generate_password( 6, false ), 'post_type' => 'sml_question', 'post_status' => 'publish', 'post_date' => $now, 'post_date_gmt' => $gmt, 'post_modified' => $now, 'post_modified_gmt' => $gmt, 'post_content' => 'staged test', 'post_excerpt' => '', 'to_ping' => '', 'pinged' => '', 'post_content_filtered' => '' ) );
	$q = (int) $wpdb->insert_id; $made_posts[] = $q;
	$wpdb->insert( $wpdb->comments, array( 'comment_post_ID' => $q, 'user_id' => $A, 'comment_type' => SML_QA_ANSWER_TYPE, 'comment_approved' => '1', 'comment_date' => $now, 'comment_date_gmt' => $gmt, 'comment_content' => 'staged answer', 'comment_author' => 'test', 'comment_author_email' => '', 'comment_author_url' => '', 'comment_author_IP' => '', 'comment_agent' => '' ) );
	$c = (int) $wpdb->insert_id; $made_comments[] = $c;
	if ( $accept ) {
		foreach ( array( '_sml_qa_accepted' => $c, '_sml_gs_accepted_cid' => $c, '_sml_gs_accepted_by' => $B ) as $k => $v ) $wpdb->insert( $wpdb->postmeta, array( 'post_id' => $q, 'meta_key' => $k, 'meta_value' => $v ) );
	}
	clean_post_cache( $q ); clean_comment_cache( $c ); wp_cache_delete( $q, 'post_meta' );
	return array( $q, $c );
};
$R = $P . 'sml_gs_qa_rewards';
/* only the staged objects become due, so no real member's reward is touched */
$due_now = function () use ( $wpdb, $R, &$made_posts, &$made_comments ) {
	$ids = implode( ',', array_map( 'intval', array_merge( $made_posts, $made_comments ) ) );
	$wpdb->query( "UPDATE $R SET settle_after = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE status='pending' AND object_id IN ($ids)" );
};

try {
	/* 1) member keeps the Loop Bucks */
	list( $q1, $c1 ) = $mk( 'GS payout test self', true );
	sml_gs_qa_detect();
	$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $R WHERE kind='answer_accepted' AND object_id=%d", $c1 ), ARRAY_A );
	t_ok( $row && 'pending' === $row['status'], 'accepted answer detected and held (pending)' );
	t_ok( $row && strtotime( $row['settle_after'] . ' UTC' ) > time() + 23 * HOUR_IN_SECONDS, 'held for 24 hours before paying' );
	sml_gs_qa_settle();
	t_ok( 'pending' === $wpdb->get_var( $wpdb->prepare( "SELECT status FROM $R WHERE id=%d", $row['id'] ) ), 'not paid before the hold ends' );
	$due_now(); sml_gs_qa_settle();
	$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $R WHERE id=%d", $row['id'] ), ARRAY_A );
	t_ok( 'paid' === $row['status'] && 'user' === $row['beneficiary'] && 25 === (int) $row['amount'], 'paid 25 LB to the member after the hold' );
	wp_cache_delete( $A, 'user_meta' );
	t_ok( (int) sml_lb_balance( $A ) === $bal0A + 25, 'wallet balance +25 (' . $bal0A . ' -> ' . sml_lb_balance( $A ) . ')' );
	$ref = 'earn:qa_reward:' . $A . ':answer_accepted:' . $c1;
	$led = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM " . sml_lb_table( 'ledger' ) . " WHERE ref=%s", $ref ), ARRAY_A );
	t_ok( $led && 25 === (int) $led['delta'] && 'earn' === $led['reason'] && (int) $led['balance_after'] === $bal0A + 25, 'ledger row with unique ref, reason earn, balance_after' );
	$n = (array) get_user_meta( $A, 'sml_notifications', true );
	t_ok( count( $n ) === min( 80, $notes0 + 1 ) && false !== strpos( $n[0]['message'] ?? '', '+25 Loop Bucks' ), 'LOOP-KICK notification: ' . ( $n[0]['message'] ?? '' ) );
	/* idempotency */
	$wpdb->query( $wpdb->prepare( "UPDATE $R SET status='pending', settle_after=UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id=%d", $row['id'] ) );
	sml_gs_qa_settle(); sml_gs_qa_detect(); $due_now(); sml_gs_qa_settle();
	wp_cache_delete( $A, 'user_meta' );
	t_ok( (int) sml_lb_balance( $A ) === $bal0A + 25, 'replaying settle/detect never pays twice' );
	t_ok( 1 === (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM " . sml_lb_table( 'ledger' ) . " WHERE ref=%s", $ref ) ), 'exactly one ledger row' );

	/* 2) member gives the credit to their group */
	list( $q2, $c2 ) = $mk( 'GS payout test group', true );
	$wpdb->insert( $P . 'sml_gs_qa_credit', array( 'object_type' => 'answer', 'object_id' => $c2, 'user_id' => $A, 'kind' => 'group', 'group_id' => $G, 'posted_at' => gmdate( 'Y-m-d H:i:s' ) ) );
	$before = sml_gs_group_score( $G );
	sml_gs_qa_detect(); $due_now(); sml_gs_qa_settle();
	$row2 = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $R WHERE kind='answer_accepted' AND object_id=%d", $c2 ), ARRAY_A );
	t_ok( $row2 && 'scored' === $row2['status'] && 'group' === $row2['beneficiary'] && (int) $row2['group_id'] === $G, 'group-credited answer scored for the group' );
	$ev = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$P}sml_gs_events WHERE ref=%s", 'qa:answer_accepted:' . $c2 ), ARRAY_A );
	t_ok( $ev && (int) $ev['group_id'] === $G && (int) $ev['points'] > 0, 'score event recorded (+' . ( $ev['points'] ?? 0 ) . ' pts)' );
	wp_cache_delete( 'score_' . $G, 'sml_gs' );
	$after = sml_gs_group_score( $G );
	t_ok( (int) $after['lifetime'] === (int) $before['lifetime'] + (int) ( $ev['points'] ?? 0 ), 'group lifetime score ' . $before['lifetime'] . ' -> ' . $after['lifetime'] );
	wp_cache_delete( $A, 'user_meta' );
	t_ok( (int) sml_lb_balance( $A ) === $bal0A + 25, 'no Loop Bucks for a group-credited answer' );

	/* 3) acceptance withdrawn during the hold */
	list( $q3, $c3 ) = $mk( 'GS payout test withdrawn', true );
	sml_gs_qa_detect();
	$wpdb->delete( $wpdb->postmeta, array( 'post_id' => $q3, 'meta_key' => '_sml_qa_accepted' ) ); wp_cache_delete( $q3, 'post_meta' );
	$due_now(); sml_gs_qa_settle();
	t_ok( 0 === (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM $R WHERE object_id=%d", $c3 ) ), 'withdrawn acceptance: reward dropped' );
	t_ok( 0 === (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM " . sml_lb_table( 'ledger' ) . " WHERE ref LIKE %s", '%:' . $c3 ) ), 'withdrawn acceptance: nothing paid' );

	/* 4) daily cap: 100 LB per day */
	$wpdb->query( $wpdb->prepare( "UPDATE $R SET amount=100 WHERE id=%d", $row['id'] ) );
	list( $q4, $c4 ) = $mk( 'GS payout test cap', true );
	sml_gs_qa_detect(); $due_now(); sml_gs_qa_settle();
	$row4 = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM $R WHERE kind='answer_accepted' AND object_id=%d", $c4 ), ARRAY_A );
	t_ok( $row4 && 'pending' === $row4['status'] && 1 === (int) $row4['attempts'], 'over the daily cap: deferred to tomorrow, not paid' );
} catch ( Throwable $e ) {
	echo 'ERROR ' . $e->getMessage() . PHP_EOL; $fails++;
} finally {
	$wpdb->query( 'ROLLBACK' );
	foreach ( $made_posts as $id ) { clean_post_cache( $id ); wp_cache_delete( $id, 'post_meta' ); }
	foreach ( $made_comments as $id ) clean_comment_cache( $id );
	clean_user_cache( $A ); wp_cache_delete( $A, 'user_meta' ); wp_cache_delete( $B, 'user_meta' );
	wp_cache_delete( 'score_' . $G, 'sml_gs' ); wp_cache_delete( 'all_scores', 'sml_gs' ); delete_transient( 'sml_lb_vault' );
}

/* nothing leaked */
t_ok( (int) sml_lb_balance( $A ) === $bal0A, 'after rollback: balance restored (' . sml_lb_balance( $A ) . ')' );
t_ok( (int) $wpdb->get_var( "SELECT COALESCE(MAX(id),0) FROM " . sml_lb_table( 'ledger' ) . " WHERE id > $maxLedger" ) === 0 || 0 === (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM " . sml_lb_table( 'ledger' ) . " WHERE id > %d AND ref LIKE %s", $maxLedger, 'earn:qa_reward:%' ) ), 'after rollback: no qa_reward ledger rows' );
t_ok( 0 === (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$P}sml_gs_events WHERE id > %d AND source LIKE %s", $maxEvent, 'qa\_%' ) ), 'after rollback: no score events' );
t_ok( 0 === (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE BINARY post_name LIKE 'gs-payout-test-%'" ), 'after rollback: no test questions' );
t_ok( count( (array) get_user_meta( $A, 'sml_notifications', true ) ) === $notes0, 'after rollback: notifications restored' );
echo $fails ? "FAILURES: $fails\n" : "ALL PASS\n";
