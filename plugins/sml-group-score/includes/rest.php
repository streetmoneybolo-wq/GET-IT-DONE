<?php
/**
 * REST: group scores + leaderboard (public), the member's credit options, Q&A credit chips,
 * and changing a credit choice before anything has been paid or scored for it.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_gs_group_card( $gid ) {
	global $wpdb;
	$g = $wpdb->get_row( $wpdb->prepare( "SELECT id, name, slug, icon_url FROM {$wpdb->prefix}sml_groups WHERE id = %d", (int) $gid ) );
	if ( ! $g ) return null;
	return array( 'id' => (int) $g->id, 'name' => (string) $g->name, 'slug' => (string) $g->slug, 'url' => home_url( '/groups/' . rawurlencode( $g->slug ) . '/' ), 'icon' => esc_url_raw( (string) $g->icon_url ) );
}

/** When a question/answer was posted (credit timing is measured from this). */
function sml_gs_object_posted_ts( $type, $oid ) {
	$row = sml_gs_credit_row( $type, $oid );
	if ( $row ) return (int) strtotime( $row['posted_at'] . ' UTC' );
	if ( 'question' === $type ) { $q = get_post( $oid ); return $q ? (int) strtotime( $q->post_date_gmt . ' UTC' ) : 0; }
	$c = get_comment( $oid );
	return $c ? (int) strtotime( $c->comment_date_gmt . ' UTC' ) : 0;
}

/** Credit is locked once anything was paid, scored or is being settled for it. */
function sml_gs_credit_locked( $type, $oid ) {
	global $wpdb;
	$kinds = 'question' === $type ? "'question_good'" : "'answer_accepted','answer_voted'";
	return (bool) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM " . sml_gs_t( 'qa_rewards' ) . " WHERE object_id = %d AND kind IN ($kinds) AND status <> 'pending'", (int) $oid ) );
}

/** The author's view of one of their own objects: current credit, lock, and the groups it can go to. */
function sml_gs_credit_state( $type, $oid, $uid ) {
	$s      = sml_gs_settings();
	$posted = sml_gs_object_posted_ts( $type, $oid );
	$cred   = sml_gs_resolved_credit( $type, $oid, $uid );
	$groups = array();
	foreach ( sml_gs_memberships( $uid ) as $gid => $joined ) {
		$card = sml_gs_group_card( $gid );
		if ( ! $card ) continue;
		/* same rule the payout uses: a member for 24 h before this was posted */
		$ok = sml_gs_resolve_credit( array( 'kind' => 'group', 'group_id' => $gid, 'posted_ts' => $posted ), array( $gid => $joined ), $s );
		$groups[] = array( 'id' => $gid, 'name' => $card['name'], 'eligible' => 'group' === $ok['kind'] );
	}
	return array(
		'credit' => $cred['kind'],
		'group'  => $cred['group_id'] ? sml_gs_group_card( $cred['group_id'] ) : null,
		'locked' => sml_gs_credit_locked( $type, $oid ),
		'groups' => $groups,
	);
}

add_action( 'rest_api_init', function () {
	$ns = 'sml-group-score/v1';

	register_rest_route( $ns, '/group/(?P<id>\d+)', array(
		'methods' => 'GET', 'permission_callback' => '__return_true',
		'callback' => function ( WP_REST_Request $r ) {
			$card = sml_gs_group_card( (int) $r['id'] );
			if ( ! $card ) return new WP_Error( 'sml_gs_group', 'Group not found.', array( 'status' => 404 ) );
			$res = rest_ensure_response( array_merge( array( 'group' => $card ), sml_gs_group_score( (int) $r['id'] ) ) );
			$res->header( 'Cache-Control', 'public, max-age=120' );
			return $res;
		},
	) );

	register_rest_route( $ns, '/leaderboard', array(
		'methods' => 'GET', 'permission_callback' => '__return_true',
		'callback' => function ( WP_REST_Request $r ) {
			global $wpdb;
			$limit = max( 1, min( 50, (int) ( $r->get_param( 'limit' ) ?: 20 ) ) );
			$all   = sml_gs_all_scores();
			$out   = array();
			foreach ( (array) $wpdb->get_results( "SELECT id, slug, type FROM {$wpdb->prefix}sml_groups", ARRAY_A ) as $g ) {
				$gid = (int) $g['id'];
				if ( ! sml_gs_listable( $g ) || empty( $all[ $gid ]['rank'] ) ) continue;
				$out[] = array_merge( sml_gs_group_card( $gid ), array( 'rank' => $all[ $gid ]['rank'], 'lifetime' => $all[ $gid ]['lifetime'], 'last_30_days' => $all[ $gid ]['last_30_days'] ) );
			}
			usort( $out, function ( $a, $b ) { return $a['rank'] <=> $b['rank']; } );
			$out = array_slice( $out, 0, $limit );
			$res = rest_ensure_response( array( 'groups' => $out ) );
			$res->header( 'Cache-Control', 'public, max-age=120' );
			return $res;
		},
	) );

	register_rest_route( $ns, '/me', array(
		'methods' => 'GET', 'permission_callback' => 'is_user_logged_in',
		'callback' => function () {
			global $wpdb;
			$uid = get_current_user_id(); $s = sml_gs_settings();
			$groups = array();
			foreach ( sml_gs_memberships( $uid ) as $gid => $joined ) {
				$card = sml_gs_group_card( $gid );
				if ( ! $card ) continue;
				$card['can_credit']    = $joined > 0 && sml_gs_now() - $joined >= $s['min_member_hours'] * HOUR_IN_SECONDS;
				$card['credit_from']   = $joined > 0 ? gmdate( 'c', $joined + $s['min_member_hours'] * HOUR_IN_SECONDS ) : null;
				$groups[] = $card;
			}
			$t = sml_gs_t( 'qa_rewards' );
			$res = rest_ensure_response( array(
				'groups'        => $groups,
				'earning'       => sml_gs_person_qualifies( sml_gs_person( $uid ), $s['min_account_days_earn'], sml_gs_now() ),
				'paid_today'    => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(amount),0) FROM $t WHERE beneficiary='user' AND user_id=%d AND status='paid' AND settled_at >= UTC_DATE()", $uid ) ),
				'paid_lifetime' => (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(SUM(amount),0) FROM $t WHERE beneficiary='user' AND user_id=%d AND status='paid'", $uid ) ),
				'daily_cap'     => (int) $s['lb_qa_daily_cap'],
				'amounts'       => array( 'answer_accepted' => (int) $s['lb_answer_accepted'], 'answer_voted' => (int) $s['lb_answer_voted'], 'question_good' => (int) $s['lb_question_good'] ),
			) );
			$res->header( 'Cache-Control', 'no-store, private' );
			return $res;
		},
	) );

	register_rest_route( $ns, '/qa-credits', array(
		'methods' => 'GET', 'permission_callback' => '__return_true',
		'callback' => function ( WP_REST_Request $r ) {
			global $wpdb;
			$qid = absint( $r->get_param( 'question_id' ) );
			$q   = $qid ? get_post( $qid ) : null;
			if ( ! $q || 'sml_question' !== $q->post_type || 'publish' !== $q->post_status ) return new WP_Error( 'sml_gs_q', 'Question not found.', array( 'status' => 404 ) );
			$uid  = get_current_user_id();
			$out  = array( 'question' => null, 'answers' => array(), 'mine' => array( 'question' => null, 'answers' => array() ) );
			$cred = sml_gs_resolved_credit( 'question', $qid, (int) $q->post_author );
			if ( 'group' === $cred['kind'] ) $out['question'] = sml_gs_group_card( $cred['group_id'] );
			if ( $uid && (int) $q->post_author === $uid ) $out['mine']['question'] = sml_gs_credit_state( 'question', $qid, $uid );
			$ids = array_map( 'intval', get_comments( array( 'post_id' => $qid, 'type' => SML_QA_ANSWER_TYPE, 'status' => 'approve', 'fields' => 'ids', 'number' => 200 ) ) );
			foreach ( $ids as $cid ) {
				$c = get_comment( $cid );
				$cred = sml_gs_resolved_credit( 'answer', $cid, (int) $c->user_id );
				if ( 'group' === $cred['kind'] ) $out['answers'][ (string) $cid ] = sml_gs_group_card( $cred['group_id'] );
				if ( $uid && (int) $c->user_id === $uid ) $out['mine']['answers'][ (string) $cid ] = sml_gs_credit_state( 'answer', $cid, $uid );
			}
			$res = rest_ensure_response( $out );
			if ( $uid ) $res->header( 'Cache-Control', 'no-store, private' );
			return $res;
		},
	) );

	register_rest_route( $ns, '/qa-credit', array(
		'methods' => 'POST', 'permission_callback' => 'is_user_logged_in',
		'callback' => function ( WP_REST_Request $r ) {
			global $wpdb;
			$uid  = get_current_user_id();
			$type = 'question' === $r->get_param( 'object_type' ) ? 'question' : 'answer';
			$oid  = absint( $r->get_param( 'object_id' ) );
			$owner = 0;
			if ( 'question' === $type ) { $q = get_post( $oid ); $owner = ( $q && 'sml_question' === $q->post_type ) ? (int) $q->post_author : 0; }
			else { $c = get_comment( $oid ); $owner = ( $c && SML_QA_ANSWER_TYPE === $c->comment_type ) ? (int) $c->user_id : 0; }
			if ( ! $owner || $owner !== $uid ) return new WP_Error( 'sml_gs_owner', 'You can only change the credit on your own questions and answers.', array( 'status' => 403 ) );
			if ( sml_gs_credit_locked( $type, $oid ) ) {
				return new WP_Error( 'sml_gs_locked', 'This already earned its reward, so the credit is locked.', array( 'status' => 409 ) );
			}
			$raw    = (string) $r->get_param( 'credit' );
			$credit = sml_gs_parse_credit( $raw, $uid );
			if ( 'self' !== $raw && 'group' !== $credit['kind'] ) {
				return new WP_Error( 'sml_gs_group', 'You are not a member of that group.', array( 'status' => 422 ) );
			}
			$posted = sml_gs_object_posted_ts( $type, $oid );
			if ( 'group' === $credit['kind'] ) {
				/* never save a choice the payout would quietly ignore */
				$joined = sml_gs_memberships( $uid );
				$ok = sml_gs_resolve_credit( array( 'kind' => 'group', 'group_id' => $credit['group_id'], 'posted_ts' => $posted ), $joined, sml_gs_settings() );
				if ( 'group' !== $ok['kind'] ) {
					return new WP_Error( 'sml_gs_too_new', 'You joined that group less than 24 hours before posting this, so it can’t take the credit.', array( 'status' => 422 ) );
				}
			}
			if ( sml_gs_credit_row( $type, $oid ) ) {
				$wpdb->update( sml_gs_t( 'qa_credit' ), array( 'kind' => $credit['kind'], 'group_id' => $credit['group_id'] ), array( 'object_type' => $type, 'object_id' => $oid ) );
			} else {
				/* keep the original posting time, so changing the credit later can't dodge the 24 h rule */
				$wpdb->insert( sml_gs_t( 'qa_credit' ), array( 'object_type' => $type, 'object_id' => $oid, 'user_id' => $uid, 'kind' => $credit['kind'], 'group_id' => $credit['group_id'], 'posted_at' => gmdate( 'Y-m-d H:i:s', $posted ?: sml_gs_now() ) ) );
			}
			return rest_ensure_response( array_merge( array( 'ok' => true ), sml_gs_credit_state( $type, $oid, $uid ) ) );
		},
	) );
} );

/* ------------------------------------------------ Q&A pages: the credit picker */

add_action( 'wp_enqueue_scripts', function () {
	if ( ! wp_script_is( 'sml-qa', 'enqueued' ) ) return;
	wp_enqueue_style( 'sml-gs-qa', plugins_url( 'assets/qa-credit.css', dirname( __FILE__ ) ), array(), SML_GS_VERSION );
	wp_enqueue_script( 'sml-gs-qa', plugins_url( 'assets/qa-credit.js', dirname( __FILE__ ) ), array( 'sml-qa' ), SML_GS_VERSION, true );
	wp_localize_script( 'sml-gs-qa', 'SML_GS', array(
		'rest'       => esc_url_raw( rest_url( 'sml-group-score/v1/' ) ),
		'nonce'      => wp_create_nonce( 'wp_rest' ),
		'loggedIn'   => is_user_logged_in(),
		'questionId' => is_singular( 'sml_question' ) ? get_queried_object_id() : 0,
	) );
}, 30 );
