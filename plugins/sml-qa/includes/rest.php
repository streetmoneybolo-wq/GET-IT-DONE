<?php
/**
 * SML Q&A — first-party REST routes.
 *
 * The core /wp/v2/{cpt} routes are gated on this Atomic site (Phase 0 §5.2), so
 * questions and answers are created through these namespaced routes instead.
 * All are logged-in only; WordPress verifies the X-WP-Nonce (wp_rest) cookie
 * nonce via the standard REST auth, and each callback re-checks capability.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

add_action( 'rest_api_init', function () {

	$logged_in = function () {
		return is_user_logged_in() ? true : new WP_Error( 'sml_qa_auth', 'You must be signed in.', array( 'status' => 401 ) );
	};

	/* Ask a question ------------------------------------------------------- */
	register_rest_route( 'sml-qa/v1', '/ask', array(
		'methods'             => 'POST',
		'permission_callback' => $logged_in,
		'callback'            => function ( WP_REST_Request $r ) {
			$title = sanitize_text_field( (string) $r->get_param( 'title' ) );
			$body  = (string) $r->get_param( 'body' );
			$ticker = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $r->get_param( 'ticker' ) ) );
			$title = trim( $title );
			if ( mb_strlen( $title ) < 12 ) { return new WP_Error( 'sml_qa_title', 'Give your question a clear title (at least 12 characters).', array( 'status' => 400 ) ); }
			if ( mb_strlen( $title ) > 180 ) { $title = mb_substr( $title, 0, 180 ); }
			if ( mb_strlen( wp_strip_all_tags( $body ) ) > 8000 ) { return new WP_Error( 'sml_qa_body', 'Question detail is too long.', array( 'status' => 400 ) ); }

			$id = wp_insert_post( array(
				'post_type'      => 'sml_question',
				'post_title'     => $title,
				'post_content'   => wp_kses_post( $body ),
				'post_status'    => 'publish',
				'post_author'    => get_current_user_id(),
				'comment_status' => 'closed', /* answers are our own comment type, rendered by us */
				'ping_status'    => 'closed',
			), true );
			if ( is_wp_error( $id ) || ! $id ) { return new WP_Error( 'sml_qa_insert', 'Could not save the question.', array( 'status' => 500 ) ); }
			if ( '' !== $ticker && strlen( $ticker ) <= 12 ) { update_post_meta( $id, '_sml_qa_ticker', $ticker ); }
			update_post_meta( $id, '_sml_qa_answer_count', 0 );
			return rest_ensure_response( array( 'ok' => true, 'id' => (int) $id, 'url' => get_permalink( $id ) ) );
		},
	) );

	/* Answer a question ---------------------------------------------------- */
	register_rest_route( 'sml-qa/v1', '/answer', array(
		'methods'             => 'POST',
		'permission_callback' => $logged_in,
		'callback'            => function ( WP_REST_Request $r ) {
			$qid  = absint( $r->get_param( 'question_id' ) );
			$body = trim( (string) $r->get_param( 'body' ) );
			$q = $qid ? get_post( $qid ) : null;
			if ( ! $q || 'sml_question' !== $q->post_type || 'publish' !== $q->post_status ) { return new WP_Error( 'sml_qa_q', 'Question not found.', array( 'status' => 404 ) ); }
			if ( mb_strlen( wp_strip_all_tags( $body ) ) < 15 ) { return new WP_Error( 'sml_qa_short', 'An answer needs a bit more detail (at least 15 characters).', array( 'status' => 400 ) ); }
			if ( mb_strlen( wp_strip_all_tags( $body ) ) > 8000 ) { return new WP_Error( 'sml_qa_long', 'Answer is too long.', array( 'status' => 400 ) ); }

			$user = wp_get_current_user();
			$cid = wp_insert_comment( array(
				'comment_post_ID'      => $qid,
				'comment_content'      => wp_kses_post( $body ),
				'comment_type'         => SML_QA_ANSWER_TYPE,
				'user_id'              => $user->ID,
				'comment_author'       => $user->display_name,
				'comment_author_email' => $user->user_email,
				'comment_approved'     => 1,
			) );
			if ( ! $cid ) { return new WP_Error( 'sml_qa_answer', 'Could not save the answer.', array( 'status' => 500 ) ); }
			$count = sml_qa_recount( $qid );
			return rest_ensure_response( array( 'ok' => true, 'comment_id' => (int) $cid, 'answer_count' => $count ) );
		},
	) );

	/* Toggle an upvote on an answer --------------------------------------- */
	register_rest_route( 'sml-qa/v1', '/vote', array(
		'methods'             => 'POST',
		'permission_callback' => $logged_in,
		'callback'            => function ( WP_REST_Request $r ) {
			$cid = absint( $r->get_param( 'comment_id' ) );
			$c = $cid ? get_comment( $cid ) : null;
			if ( ! $c || SML_QA_ANSWER_TYPE !== $c->comment_type ) { return new WP_Error( 'sml_qa_c', 'Answer not found.', array( 'status' => 404 ) ); }
			$uid = get_current_user_id();
			if ( (int) $c->user_id === (int) $uid ) { return new WP_Error( 'sml_qa_self', 'You cannot vote on your own answer.', array( 'status' => 403 ) ); }
			$voters = get_comment_meta( $cid, '_sml_qa_voters', true );
			$voters = is_array( $voters ) ? $voters : array();
			$has = in_array( $uid, $voters, true );
			if ( $has ) { $voters = array_values( array_diff( $voters, array( $uid ) ) ); }
			else { $voters[] = $uid; }
			update_comment_meta( $cid, '_sml_qa_voters', $voters );
			update_comment_meta( $cid, '_sml_qa_upvotes', count( $voters ) );
			return rest_ensure_response( array( 'ok' => true, 'upvotes' => count( $voters ), 'voted' => ! $has ) );
		},
	) );

	/* Accept an answer (question author or admin only) -------------------- */
	register_rest_route( 'sml-qa/v1', '/accept', array(
		'methods'             => 'POST',
		'permission_callback' => $logged_in,
		'callback'            => function ( WP_REST_Request $r ) {
			$qid = absint( $r->get_param( 'question_id' ) );
			$cid = absint( $r->get_param( 'comment_id' ) );
			$q = $qid ? get_post( $qid ) : null;
			$c = $cid ? get_comment( $cid ) : null;
			if ( ! $q || 'sml_question' !== $q->post_type ) { return new WP_Error( 'sml_qa_q', 'Question not found.', array( 'status' => 404 ) ); }
			if ( ! $c || SML_QA_ANSWER_TYPE !== $c->comment_type || (int) $c->comment_post_ID !== $qid ) { return new WP_Error( 'sml_qa_c', 'Answer not found on this question.', array( 'status' => 404 ) ); }
			$uid = get_current_user_id();
			if ( (int) $q->post_author !== (int) $uid && ! current_user_can( 'manage_options' ) ) { return new WP_Error( 'sml_qa_perm', 'Only the person who asked can accept an answer.', array( 'status' => 403 ) ); }
			$current = (int) get_post_meta( $qid, '_sml_qa_accepted', true );
			if ( $current === $cid ) { delete_post_meta( $qid, '_sml_qa_accepted' ); return rest_ensure_response( array( 'ok' => true, 'accepted' => 0 ) ); }
			update_post_meta( $qid, '_sml_qa_accepted', $cid );
			return rest_ensure_response( array( 'ok' => true, 'accepted' => $cid ) );
		},
	) );
} );
