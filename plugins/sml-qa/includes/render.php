<?php
/**
 * SML Q&A — front-end rendering. Appended to the question body via the_content
 * (the theme renders the page shell); the ask form is a shortcode. No inline
 * JS — every control carries data-* attributes that assets/qa.js binds.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_qa_answer_sort( $answers, $accepted_id ) {
	usort( $answers, function ( $a, $b ) use ( $accepted_id ) {
		if ( (int) $a->comment_ID === $accepted_id ) { return -1; }
		if ( (int) $b->comment_ID === $accepted_id ) { return 1; }
		$va = (int) get_comment_meta( $a->comment_ID, '_sml_qa_upvotes', true );
		$vb = (int) get_comment_meta( $b->comment_ID, '_sml_qa_upvotes', true );
		if ( $va !== $vb ) { return $vb <=> $va; }
		return strcmp( (string) $a->comment_date_gmt, (string) $b->comment_date_gmt );
	} );
	return $answers;
}

function sml_qa_render_answer( $c, $question_id, $accepted_id ) {
	$cid = (int) $c->comment_ID;
	$votes = (int) get_comment_meta( $cid, '_sml_qa_upvotes', true );
	$voters = get_comment_meta( $cid, '_sml_qa_voters', true );
	$voters = is_array( $voters ) ? $voters : array();
	$me = get_current_user_id();
	$voted = $me && in_array( $me, $voters, true );
	$is_accepted = ( $cid === $accepted_id );
	$is_owner = $me && ( (int) get_post_field( 'post_author', $question_id ) === $me || current_user_can( 'manage_options' ) );
	$can_vote = $me && (int) $c->user_id !== $me;

	$author = get_userdata( (int) $c->user_id );
	$name = $author ? ( $author->display_name ?: $author->user_login ) : $c->comment_author;
	$avatar = get_avatar( (int) $c->user_id, 40, '', esc_attr( $name ), array( 'class' => 'sml-qa-av' ) );

	$h  = '<article class="sml-qa-answer' . ( $is_accepted ? ' is-accepted' : '' ) . '" id="answer-' . $cid . '" data-answer="' . $cid . '">';
	$h .= '<div class="sml-qa-answer-vote">';
	$h .= '<button type="button" class="sml-qa-vote' . ( $voted ? ' voted' : '' ) . '" data-vote="' . $cid . '"' . ( $can_vote ? '' : ' disabled' ) . ' aria-pressed="' . ( $voted ? 'true' : 'false' ) . '" aria-label="Upvote this answer">&#9650;</button>';
	$h .= '<span class="sml-qa-votecount" data-votecount="' . $cid . '">' . esc_html( (string) $votes ) . '</span>';
	$h .= '</div>';
	$h .= '<div class="sml-qa-answer-main">';
	if ( $is_accepted ) { $h .= '<div class="sml-qa-accepted-badge">&#10003; Accepted answer</div>'; }
	$h .= '<div class="sml-qa-answer-body">' . wp_kses_post( wpautop( $c->comment_content ) ) . '</div>';
	$h .= '<div class="sml-qa-answer-meta">' . $avatar . '<span class="sml-qa-answer-by">' . esc_html( $name ) . '</span><span class="sml-qa-answer-date">' . esc_html( get_comment_date( '', $cid ) ) . '</span>';
	if ( $is_owner ) {
		$h .= '<button type="button" class="sml-qa-accept' . ( $is_accepted ? ' active' : '' ) . '" data-accept="' . $cid . '" data-question="' . (int) $question_id . '">' . ( $is_accepted ? 'Unaccept' : 'Accept answer' ) . '</button>';
	}
	$h .= '</div></div></article>';
	return $h;
}

add_filter( 'the_content', function ( $content ) {
	if ( ! is_singular( 'sml_question' ) || ! in_the_loop() || ! is_main_query() ) { return $content; }
	$qid = get_the_ID();
	$accepted_id = (int) get_post_meta( $qid, '_sml_qa_accepted', true );
	$ticker = (string) get_post_meta( $qid, '_sml_qa_ticker', true );
	$answers = sml_qa_answer_sort( sml_qa_answers( $qid ), $accepted_id );
	$count = count( $answers );

	$out = '<div class="sml-qa" data-question="' . (int) $qid . '">';

	if ( '' !== $ticker ) {
		$out .= '<p class="sml-qa-ticker"><a href="' . esc_url( home_url( '/stock-chart/?symbol=' . rawurlencode( $ticker ) ) ) . '">$' . esc_html( $ticker ) . '</a></p>';
	}

	$out .= '<h2 class="sml-qa-answers-head">' . esc_html( $count === 1 ? '1 Answer' : $count . ' Answers' ) . '</h2>';
	if ( $count ) {
		$out .= '<div class="sml-qa-answers">';
		foreach ( $answers as $c ) { $out .= sml_qa_render_answer( $c, $qid, $accepted_id ); }
		$out .= '</div>';
	} else {
		$out .= '<p class="sml-qa-empty">No answers yet. Know this one? Be the first to answer.</p>';
	}

	/* Answer composer */
	if ( is_user_logged_in() ) {
		$out .= '<div class="sml-qa-form" data-answer-form>';
		$out .= '<h3>Your answer</h3>';
		$out .= '<textarea class="sml-qa-answer-input" rows="5" maxlength="8000" placeholder="Share what you know — be specific and cite what you saw."></textarea>';
		$out .= '<div class="sml-qa-form-row"><button type="button" class="sml-qa-submit-answer">Post your answer</button><span class="sml-qa-msg" role="status"></span></div>';
		$out .= '</div>';
	} else {
		$out .= '<p class="sml-qa-signin"><a href="' . esc_url( wp_login_url( get_permalink( $qid ) ) ) . '">Sign in</a> to answer this question.</p>';
	}

	$out .= '</div>';
	return $content . $out;
}, 20 );

/* Ask form — shortcode [sml_qa_ask] ---------------------------------------- */
add_shortcode( 'sml_qa_ask', function () {
	if ( ! is_user_logged_in() ) {
		return '<div class="sml-qa"><p class="sml-qa-signin"><a href="' . esc_url( wp_login_url() ) . '">Sign in</a> to ask a question.</p></div>';
	}
	$h  = '<div class="sml-qa sml-qa-ask" data-ask-form>';
	$h .= '<h3>Ask the community</h3>';
	$h .= '<label class="sml-qa-label">Question</label>';
	$h .= '<input type="text" class="sml-qa-ask-title" maxlength="180" placeholder="e.g. Why did $CRE halt twice before 10am?">';
	$h .= '<label class="sml-qa-label">Ticker (optional)</label>';
	$h .= '<input type="text" class="sml-qa-ask-ticker" maxlength="12" placeholder="NVDA">';
	$h .= '<label class="sml-qa-label">Details</label>';
	$h .= '<textarea class="sml-qa-ask-body" rows="5" maxlength="8000" placeholder="Add context: what you saw, when, and what you have already checked."></textarea>';
	$h .= '<div class="sml-qa-form-row"><button type="button" class="sml-qa-submit-ask">Post your question</button><span class="sml-qa-msg" role="status"></span></div>';
	$h .= '</div>';
	return $h;
} );
