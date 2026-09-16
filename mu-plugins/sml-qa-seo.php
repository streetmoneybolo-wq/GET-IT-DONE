<?php
/**
 * Plugin Name: SML Q&A SEO Layer
 * Description: Search title, meta description, snippet controls, OG text and Bing IndexNow for /q/ questions — layered on the sml-qa plugin without modifying it.
 * Version: 1.0.1
 *
 * Why a separate mu-plugin: sml-qa is deployed via ZIP (live 0.7.3) and WP.com
 * does not reliably persist raw writes into plugin dirs; mu-plugins do. Nothing
 * here changes indexability rules (unanswered stays noindex — that lives in sml-qa).
 *
 * NOTE: no function_exists() early-return guard at file scope — PHP hoists the
 * unconditional function declarations below, so such a guard is always true and
 * would return before any add_filter() ran (that exact bug shipped in 1.0.0).
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_qaseo_is_question() { return is_singular( 'sml_question' ); }

function sml_qaseo_answer_count( $qid ) { return (int) get_post_meta( (int) $qid, '_sml_qa_answer_count', true ); }

/** The accepted answer if approved, else the newest approved answer. */
function sml_qaseo_best_answer( $qid ) {
	$aid = (int) get_post_meta( (int) $qid, '_sml_qa_accepted', true );
	if ( $aid ) {
		$c = get_comment( $aid );
		if ( $c && '1' === (string) $c->comment_approved ) { return $c; }
	}
	$cs = get_comments( array( 'post_id' => (int) $qid, 'status' => 'approve', 'number' => 1, 'orderby' => 'comment_date_gmt', 'order' => 'DESC' ) );
	return $cs ? $cs[0] : null;
}

/** Collapse whitespace, strip tags, cut at a word boundary with an ellipsis. */
function sml_qaseo_clip( $txt, $max ) {
	$txt = preg_replace( '/\s+/', ' ', trim( wp_strip_all_tags( (string) $txt ) ) );
	if ( mb_strlen( $txt ) <= $max ) { return $txt; }
	$cut = rtrim( mb_substr( $txt, 0, $max - 1 ) );
	$cut = preg_replace( '/\s+\S*$/u', '', $cut );
	return $cut . "\xE2\x80\xA6";
}

/** Title = the question as written (sentence case, not Title Case), ticker early, no site suffix. */
function sml_qaseo_title( $title ) {
	if ( ! sml_qaseo_is_question() ) { return $title; }
	$q = get_queried_object();
	if ( ! $q || empty( $q->post_title ) ) { return $title; }
	$t      = trim( wp_strip_all_tags( $q->post_title ) );
	$ticker = strtoupper( trim( (string) get_post_meta( $q->ID, '_sml_qa_ticker', true ) ) );
	if ( '' !== $ticker && false === stripos( $t, $ticker ) ) { $t = '$' . $ticker . ': ' . $t; }
	return sml_qaseo_clip( $t, 90 );
}
add_filter( 'pre_get_document_title', 'sml_qaseo_title', 999 );
add_filter( 'rank_math/frontend/title', 'sml_qaseo_title', 999 );
add_filter( 'rank_math/opengraph/facebook/title', 'sml_qaseo_title', 999 );
add_filter( 'rank_math/opengraph/twitter/title', 'sml_qaseo_title', 999 );

/** Description = first ~150 chars of the best answer (fallback: the question) + answer count. */
function sml_qaseo_description_for( $qid ) {
	$q = get_post( (int) $qid );
	if ( ! $q ) { return ''; }
	$a    = sml_qaseo_best_answer( $q->ID );
	$n    = sml_qaseo_answer_count( $q->ID );
	$txt  = sml_qaseo_clip( $a ? $a->comment_content : $q->post_content, 150 );
	$tail = $n > 0 ? ' · ' . $n . ' answer' . ( $n > 1 ? 's' : '' ) . ' · Stock Market Loop Q&A' : ' · Stock Market Loop Q&A';
	return $txt . $tail;
}
function sml_qaseo_description( $desc ) {
	if ( ! sml_qaseo_is_question() ) { return $desc; }
	$q = get_queried_object();
	return $q ? sml_qaseo_description_for( $q->ID ) : $desc;
}
add_filter( 'rank_math/frontend/description', 'sml_qaseo_description', 999 );
add_filter( 'rank_math/opengraph/facebook/description', 'sml_qaseo_description', 999 );
add_filter( 'rank_math/opengraph/twitter/description', 'sml_qaseo_description', 999 );

/** Snippet controls: never starve the snippet on Q&A (the site option is patched too; this is belt-and-braces). */
add_filter( 'rank_math/frontend/robots', function ( $robots ) {
	if ( ! sml_qaseo_is_question() || ! is_array( $robots ) ) { return $robots; }
	$robots['max-snippet']       = 'max-snippet:-1';
	$robots['max-video-preview'] = 'max-video-preview:-1';
	$robots['max-image-preview'] = 'max-image-preview:large';
	return $robots;
}, 999 );

/* Output-buffer fallback on /q/ pages: this stack has a robots layer that can
   override filters, and Rank Math prints no description when its template is empty. */
add_action( 'template_redirect', function () {
	if ( ! sml_qaseo_is_question() ) { return; }
	$q = get_queried_object();
	if ( ! $q ) { return; }
	$desc = sml_qaseo_description_for( $q->ID );
	ob_start( function ( $html ) use ( $desc ) {
		if ( ! is_string( $html ) || false === stripos( $html, '<head' ) ) { return $html; }
		$html = preg_replace( '/max-snippet:\d+/i', 'max-snippet:-1', $html );
		$html = preg_replace( '/max-video-preview:\d+/i', 'max-video-preview:-1', $html );
		if ( '' !== $desc && ! preg_match( '/<meta[^>]+name=["\']description["\']/i', $html ) ) {
			$html = preg_replace( '/<head(\s[^>]*)?>/i', '$0' . "\n" . '<meta name="description" content="' . esc_attr( $desc ) . '">', $html, 1 );
		}
		return $html;
	} );
}, 1 );

/* ---- Bing IndexNow: submit a question the moment it becomes indexable (first
   approved answer) and when an answer is accepted. Rank Math only submits on
   post updates, and an answer is a comment, so it never fires for Q&A. ---- */
function sml_qaseo_indexnow( $qid ) {
	$qid = (int) $qid;
	if ( ! $qid || 'sml_question' !== get_post_type( $qid ) || 'publish' !== get_post_status( $qid ) ) { return; }
	if ( sml_qaseo_answer_count( $qid ) < 1 ) { return; } // still noindex: do not ping
	$opts = get_option( 'rank-math-options-instant-indexing' );
	$key  = ( is_array( $opts ) && ! empty( $opts['indexnow_api_key'] ) ) ? (string) $opts['indexnow_api_key'] : '';
	if ( '' === $key ) { return; }
	$tk = 'sml_qaseo_inx_' . $qid;
	if ( get_transient( $tk ) ) { return; }
	set_transient( $tk, 1, 10 * MINUTE_IN_SECONDS );
	$body = array(
		'host'        => wp_parse_url( home_url(), PHP_URL_HOST ),
		'key'         => $key,
		'keyLocation' => home_url( '/' . $key . '.txt' ),
		'urlList'     => array( get_permalink( $qid ), home_url( '/sml-qa-sitemap.xml' ) ),
	);
	wp_remote_post( 'https://api.indexnow.org/indexnow', array(
		'timeout'  => 8,
		'blocking' => false,
		'headers'  => array( 'Content-Type' => 'application/json; charset=utf-8' ),
		'body'     => wp_json_encode( $body ),
	) );
}
add_action( 'comment_post', function ( $cid, $approved ) {
	if ( 1 !== (int) $approved ) { return; }
	$c = get_comment( $cid );
	if ( $c ) { sml_qaseo_indexnow( $c->comment_post_ID ); }
}, 20, 2 );
add_action( 'transition_comment_status', function ( $new, $old, $c ) {
	if ( 'approved' === $new && 'approved' !== $old && $c ) { sml_qaseo_indexnow( $c->comment_post_ID ); }
}, 20, 3 );
add_action( 'updated_post_meta', function ( $mid, $pid, $key ) { if ( '_sml_qa_accepted' === $key ) { sml_qaseo_indexnow( $pid ); } }, 20, 3 );
add_action( 'added_post_meta', function ( $mid, $pid, $key ) { if ( '_sml_qa_accepted' === $key ) { sml_qaseo_indexnow( $pid ); } }, 20, 3 );
