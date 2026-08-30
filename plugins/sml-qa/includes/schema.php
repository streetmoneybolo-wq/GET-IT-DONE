<?php
/**
 * SML Q&A — QAPage structured data (Phase 2).
 *
 * QAPage JSON-LD is still live and maintained (verified 2026; FAQPage is dead —
 * we deliberately do NOT emit that). Requirements honored here: emit ONLY on
 * questions with >= 1 answer (unanswered ones are noindex anyway and are
 * structurally ineligible); the Question carries name + text + answerCount;
 * each Answer carries text, a per-answer #anchor url, upvoteCount, author and
 * date; the accepted answer maps to acceptedAnswer, the rest to suggestedAnswer.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

add_action( 'wp_head', function () {
	if ( ! is_singular( 'sml_question' ) ) { return; }
	$qid = get_queried_object_id();
	$accepted_id = (int) get_post_meta( $qid, '_sml_qa_accepted', true );
	$answers = sml_qa_answer_sort( sml_qa_answers( $qid ), $accepted_id );
	if ( empty( $answers ) ) { return; } /* QAPage requires an answer */

	$q = get_post( $qid );
	$permalink = get_permalink( $qid );

	$person = function ( $user_id, $fallback ) {
		$u = get_userdata( (int) $user_id );
		$name = $u ? ( $u->display_name ?: $u->user_login ) : (string) $fallback;
		return array( '@type' => 'Person', 'name' => $name );
	};
	$mk_answer = function ( $c ) use ( $permalink, $person ) {
		$text = trim( wp_strip_all_tags( $c->comment_content ) );
		return array(
			'@type'         => 'Answer',
			'text'          => $text,
			'url'           => $permalink . '#answer-' . (int) $c->comment_ID,
			'upvoteCount'   => (int) get_comment_meta( $c->comment_ID, '_sml_qa_upvotes', true ),
			'datePublished' => mysql2date( 'c', $c->comment_date_gmt, false ),
			'author'        => $person( $c->user_id, $c->comment_author ),
		);
	};

	$qtext = trim( wp_strip_all_tags( $q->post_content ) );
	if ( '' === $qtext ) { $qtext = wp_strip_all_tags( get_the_title( $qid ) ); }

	$question = array(
		'@type'         => 'Question',
		'name'          => wp_strip_all_tags( get_the_title( $qid ) ),
		'text'          => $qtext,
		'answerCount'   => count( $answers ),
		'datePublished' => mysql2date( 'c', $q->post_date_gmt, false ),
		'author'        => $person( $q->post_author, get_bloginfo( 'name' ) ),
	);

	$suggested = array();
	foreach ( $answers as $c ) {
		$a = $mk_answer( $c );
		if ( (int) $c->comment_ID === $accepted_id ) { $question['acceptedAnswer'] = $a; }
		else { $suggested[] = $a; }
	}
	if ( ! empty( $suggested ) ) { $question['suggestedAnswer'] = $suggested; }

	$ld = array( '@context' => 'https://schema.org', '@type' => 'QAPage', 'mainEntity' => $question );
	echo "\n" . '<script type="application/ld+json">' . wp_json_encode( $ld, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . '</script>' . "\n";
}, 5 );
