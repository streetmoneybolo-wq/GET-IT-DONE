<?php
/**
 * Q&A: the member's credit choice, who actually accepted an answer, and the detect → wait
 * 24 h → re-check → pay/score pipeline.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

/* ------------------------------------------------------ capture the choice */

/** 'self' or 'group:{id}' from the request, validated against the author's groups now. */
function sml_gs_parse_credit( $raw, $uid ) {
	if ( preg_match( '/^group:(\d+)$/', (string) $raw, $m ) && isset( sml_gs_memberships( $uid )[ (int) $m[1] ] ) ) {
		return array( 'kind' => 'group', 'group_id' => (int) $m[1] );
	}
	return array( 'kind' => 'self', 'group_id' => 0 );
}

function sml_gs_save_credit( $type, $object_id, $uid, $credit ) {
	global $wpdb;
	$wpdb->query( $wpdb->prepare(
		"INSERT INTO " . sml_gs_t( 'qa_credit' ) . " (object_type, object_id, user_id, kind, group_id, posted_at) VALUES (%s, %d, %d, %s, %d, %s)
		 ON DUPLICATE KEY UPDATE kind = VALUES(kind), group_id = VALUES(group_id)",
		$type, (int) $object_id, (int) $uid, $credit['kind'], (int) $credit['group_id'], sml_gs_utc()
	) );
}

add_filter( 'rest_request_after_callbacks', function ( $response, $handler, $request ) {
	if ( ! $request instanceof WP_REST_Request || is_wp_error( $response ) ) return $response;
	$route = $request->get_route();
	if ( ! in_array( $route, array( '/sml-qa/v1/ask', '/sml-qa/v1/answer', '/sml-qa/v1/accept' ), true ) ) return $response;
	$data = $response instanceof WP_REST_Response ? $response->get_data() : $response;
	if ( ! is_array( $data ) || empty( $data['ok'] ) ) return $response;
	$uid = get_current_user_id();

	if ( '/sml-qa/v1/ask' === $route && ! empty( $data['id'] ) ) {
		sml_gs_save_credit( 'question', (int) $data['id'], $uid, sml_gs_parse_credit( $request->get_param( 'credit' ), $uid ) );
	} elseif ( '/sml-qa/v1/answer' === $route && ! empty( $data['comment_id'] ) ) {
		sml_gs_save_credit( 'answer', (int) $data['comment_id'], $uid, sml_gs_parse_credit( $request->get_param( 'credit' ), $uid ) );
	} elseif ( '/sml-qa/v1/accept' === $route ) {
		/* the Q&A plugin lets admins accept too; only the asker's own acceptance can pay */
		$qid = absint( $request->get_param( 'question_id' ) );
		if ( ! empty( $data['accepted'] ) ) {
			update_post_meta( $qid, '_sml_gs_accepted_by', $uid );
			update_post_meta( $qid, '_sml_gs_accepted_cid', (int) $data['accepted'] );
		} else {
			delete_post_meta( $qid, '_sml_gs_accepted_by' );
			delete_post_meta( $qid, '_sml_gs_accepted_cid' );
		}
	}
	return $response;
}, 10, 3 );

function sml_gs_credit_row( $type, $object_id ) {
	global $wpdb;
	return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM " . sml_gs_t( 'qa_credit' ) . " WHERE object_type = %s AND object_id = %d", $type, (int) $object_id ), ARRAY_A );
}

function sml_gs_resolved_credit( $type, $object_id, $author_id ) {
	$row = sml_gs_credit_row( $type, $object_id );
	if ( ! $row ) return array( 'kind' => 'self', 'group_id' => 0 );
	return sml_gs_resolve_credit( array( 'kind' => $row['kind'], 'group_id' => (int) $row['group_id'], 'posted_ts' => (int) strtotime( $row['posted_at'] . ' UTC' ) ), sml_gs_memberships( $author_id ), sml_gs_settings() );
}

/* ---------------------------------------------------------- build contexts */

/** Did the question's own author accept this answer (and is it still accepted)? */
function sml_gs_accepted_by_asker( $question, $cid ) {
	$qid = (int) $question->ID;
	return (int) get_post_meta( $qid, '_sml_qa_accepted', true ) === (int) $cid
		&& (int) get_post_meta( $qid, '_sml_gs_accepted_cid', true ) === (int) $cid
		&& (int) get_post_meta( $qid, '_sml_gs_accepted_by', true ) === (int) $question->post_author;
}

function sml_gs_answer_context( $c ) {
	$q      = get_post( (int) $c->comment_post_ID );
	$author = (int) $c->user_id;
	$credit = sml_gs_resolved_credit( 'answer', (int) $c->comment_ID, $author );
	$voters = get_comment_meta( (int) $c->comment_ID, '_sml_qa_voters', true );
	$gm     = 'group' === $credit['kind'] ? sml_gs_group_member_ids( $credit['group_id'] ) : array();
	return array(
		'approved'                => '1' === (string) $c->comment_approved && $q && 'publish' === $q->post_status,
		'author'                  => sml_gs_person( $author ),
		'asker'                   => $q ? sml_gs_person( (int) $q->post_author ) : null,
		'accepted'                => $q ? sml_gs_accepted_by_asker( $q, (int) $c->comment_ID ) : false,
		'voters'                  => array_values( array_filter( array_map( 'sml_gs_person', is_array( $voters ) ? $voters : array() ) ) ),
		'credit'                  => $credit,
		'group_member_ids'        => $gm,
		'asker_in_credited_group' => $q && in_array( (int) $q->post_author, $gm, true ),
		'now'                     => sml_gs_now(),
	);
}

function sml_gs_question_context( $q ) {
	$s       = sml_gs_settings();
	$credit  = sml_gs_resolved_credit( 'question', (int) $q->ID, (int) $q->post_author );
	$answers = array();
	foreach ( get_comments( array( 'post_id' => (int) $q->ID, 'type' => SML_QA_ANSWER_TYPE, 'status' => 'approve', 'number' => 100 ) ) as $c ) {
		$voters = get_comment_meta( (int) $c->comment_ID, '_sml_qa_voters', true );
		$qualified = 0;
		foreach ( is_array( $voters ) ? $voters : array() as $vid ) {
			if ( (int) $vid !== (int) $c->user_id && sml_gs_person_qualifies( sml_gs_person( $vid ), $s['min_account_days_vote'], sml_gs_now() ) ) $qualified++;
		}
		$answers[] = array( 'author' => sml_gs_person( (int) $c->user_id ), 'approved' => true, 'accepted' => sml_gs_accepted_by_asker( $q, (int) $c->comment_ID ), 'qualified_votes' => $qualified );
	}
	return array(
		'asker'                     => sml_gs_person( (int) $q->post_author ),
		'answers'                   => $answers,
		'credit'                    => $credit,
		'credited_group_member_ids' => 'group' === $credit['kind'] ? sml_gs_group_member_ids( $credit['group_id'] ) : array(),
		'now'                       => sml_gs_now(),
	);
}

/** What an object has earned right now: list of reward kinds. */
function sml_gs_current_verdict( $kind, $object_id ) {
	$s = sml_gs_settings();
	if ( 'question_good' === $kind ) {
		$q = get_post( (int) $object_id );
		return ( $q && 'sml_question' === $q->post_type && 'publish' === $q->post_status && sml_gs_question_verdict( sml_gs_question_context( $q ), $s ) ) ? array( 'question_good' ) : array();
	}
	$c = get_comment( (int) $object_id );
	if ( ! $c || SML_QA_ANSWER_TYPE !== $c->comment_type ) return array();
	return array_column( sml_gs_answer_verdict( sml_gs_answer_context( $c ), $s ), 'kind' );
}

/* ----------------------------------------------------------------- detect */

function sml_gs_qa_detect() {
	global $wpdb;
	if ( ! defined( 'SML_QA_ANSWER_TYPE' ) ) return;
	$s     = sml_gs_settings();
	$since = sml_gs_utc( sml_gs_now() - 45 * DAY_IN_SECONDS );
	$open  = function ( $kind, $object_id ) use ( $wpdb, $s ) {
		$wpdb->query( $wpdb->prepare(
			"INSERT IGNORE INTO " . sml_gs_t( 'qa_rewards' ) . " (kind, object_id, status, settle_after, created_at) VALUES (%s, %d, 'pending', %s, %s)",
			$kind, (int) $object_id, sml_gs_utc( sml_gs_now() + $s['settle_hours'] * HOUR_IN_SECONDS ), sml_gs_utc()
		) );
	};
	$questions = array();
	foreach ( get_comments( array( 'type' => SML_QA_ANSWER_TYPE, 'status' => 'approve', 'date_query' => array( array( 'after' => $since, 'column' => 'comment_date_gmt' ) ), 'number' => 600 ) ) as $c ) {
		foreach ( array_column( sml_gs_answer_verdict( sml_gs_answer_context( $c ), $s ), 'kind' ) as $kind ) $open( $kind, (int) $c->comment_ID );
		$questions[ (int) $c->comment_post_ID ] = true;
	}
	foreach ( array_keys( $questions ) as $qid ) {
		$q = get_post( $qid );
		if ( $q && 'publish' === $q->post_status && sml_gs_question_verdict( sml_gs_question_context( $q ), $s ) ) $open( 'question_good', $qid );
	}
}

/* ----------------------------------------------------------------- settle */

function sml_gs_qa_settle() {
	global $wpdb;
	$s    = sml_gs_settings();
	$t    = sml_gs_t( 'qa_rewards' );
	$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM $t WHERE status = 'pending' AND settle_after <= %s ORDER BY id LIMIT 200", sml_gs_utc() ), ARRAY_A );
	foreach ( (array) $rows as $row ) {
		$kind = $row['kind']; $oid = (int) $row['object_id']; $id = (int) $row['id'];

		/* still true after the wait? if not, forget it (it can qualify again later) */
		if ( ! in_array( $kind, sml_gs_current_verdict( $kind, $oid ), true ) ) {
			$wpdb->delete( $t, array( 'id' => $id, 'status' => 'pending' ) );
			continue;
		}
		if ( 'question_good' === $kind ) {
			$q = get_post( $oid ); $author = (int) $q->post_author; $credit = sml_gs_resolved_credit( 'question', $oid, $author );
		} else {
			$c = get_comment( $oid ); $author = (int) $c->user_id; $credit = sml_gs_resolved_credit( 'answer', $oid, $author );
		}

		/* claim it before doing anything irreversible */
		if ( 1 !== (int) $wpdb->query( $wpdb->prepare( "UPDATE $t SET status = 'settling' WHERE id = %d AND status = 'pending'", $id ) ) ) continue;

		if ( 'group' === $credit['kind'] ) {
			$points = sml_gs_group_points_for( $kind, $s );
			sml_gs_record( $credit['group_id'], 'qa_' . $kind, 'qa:' . $kind . ':' . $oid, $points, $author, null, array( 'object' => $oid ) );
			$wpdb->update( $t, array( 'status' => 'scored', 'beneficiary' => 'group', 'user_id' => $author, 'group_id' => $credit['group_id'], 'amount' => $points, 'settled_at' => sml_gs_utc() ), array( 'id' => $id ) );
			continue;
		}

		$today   = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(amount),0) FROM $t WHERE beneficiary = 'user' AND user_id = %d AND status = 'paid' AND settled_at >= UTC_DATE()", $author ) );
		$amount  = sml_gs_lb_amount( $kind, $today, $s );
		$ceiling = function_exists( 'sml_lb_earn_daily_ceiling' ) ? (int) sml_lb_earn_daily_ceiling() : 0;
		if ( $ceiling > 0 && function_exists( 'sml_lb_earned_today' ) ) $amount = min( $amount, max( 0, $ceiling - (int) sml_lb_earned_today( $author ) ) );

		if ( $amount <= 0 || ! function_exists( 'sml_lb_move' ) ) {
			/* today's cap is used up: try again tomorrow, for up to a week */
			$attempts = (int) $row['attempts'] + 1;
			$wpdb->update( $t, array(
				'status' => $attempts >= $s['cap_retry_days'] ? 'capped' : 'pending',
				'attempts' => $attempts,
				'settle_after' => sml_gs_utc( sml_gs_now() + DAY_IN_SECONDS ),
			), array( 'id' => $id ) );
			continue;
		}
		$moved = sml_lb_move( $author, $amount, 'earn', 'earn:qa_reward:' . $author . ':' . $kind . ':' . $oid, array( 'source' => 'qa', 'kind' => $kind, 'object' => $oid ) );
		if ( is_wp_error( $moved ) ) {
			$wpdb->update( $t, array( 'status' => 'pending', 'settle_after' => sml_gs_utc( sml_gs_now() + HOUR_IN_SECONDS ) ), array( 'id' => $id ) );
			continue;
		}
		$wpdb->update( $t, array( 'status' => 'paid', 'beneficiary' => 'user', 'user_id' => $author, 'amount' => $amount, 'settled_at' => sml_gs_utc() ), array( 'id' => $id ) );
		if ( function_exists( 'sml_qa_kick_alert' ) ) {
			$label = array( 'answer_accepted' => 'your answer was accepted', 'answer_voted' => 'your answer got 3+ upvotes', 'question_good' => 'you asked a great question' );
			sml_qa_kick_alert( $author, '+' . $amount . ' Loop Bucks — ' . $label[ $kind ], get_permalink( 'question_good' === $kind ? $oid : (int) $c->comment_post_ID ), 0 );
		}
	}
}
