<?php
/**
 * Plugin Name: SML Q&A
 * Description: First-party Questions & Answers built on WordPress core — CPT questions, answers as native comments, votes, accepted answers. Content is created server-side via first-party REST routes (this Atomic site gates the core /wp/v2/{cpt} routes). Unanswered questions are noindex from day one.
 * Version: 0.6.1
 * Author: StockMarketLoop
 *
 * Phase 1 of SML/QA-PLATFORM-HANDOFF.md. Routing confirmed in Phase 0 (§5.2):
 * pretty /q/{slug}/ permalinks persist via this plugin's activation hook.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_QA_VER', '0.6.1' );
define( 'SML_QA_DIR', plugin_dir_path( __FILE__ ) );
define( 'SML_QA_URL', plugin_dir_url( __FILE__ ) );
define( 'SML_QA_ANSWER_TYPE', 'sml_answer' );

require_once SML_QA_DIR . 'includes/rest.php';
require_once SML_QA_DIR . 'includes/render.php';
require_once SML_QA_DIR . 'includes/schema.php';
require_once SML_QA_DIR . 'includes/sitemap.php';
if ( is_admin() ) { require_once SML_QA_DIR . 'includes/seed.php'; }

/* ---------------------------------------------------------------------------
 * Custom post type — the question. Registration lives in a function so the
 * activation hook can call it before flushing (the Phase-0 requirement).
 * ------------------------------------------------------------------------- */
function sml_qa_register_cpt() {
	register_post_type( 'sml_question', array(
		'labels' => array(
			'name'          => 'Questions',
			'singular_name' => 'Question',
			'add_new_item'  => 'Add New Question',
			'edit_item'     => 'Edit Question',
			'search_items'  => 'Search Questions',
			'menu_name'     => 'Q&A',
		),
		'public'              => true,
		'publicly_queryable'  => true,
		'exclude_from_search' => false,
		'has_archive'         => true,
		'rewrite'             => array( 'slug' => 'q', 'with_front' => false ),
		'supports'            => array( 'title', 'editor', 'author' ),
		'show_in_rest'        => false, /* core CPT REST is gated on this site; we use our own routes and manage editing server-side */
		'menu_icon'           => 'dashicons-editor-help',
		'show_in_menu'        => true,
		'map_meta_cap'        => true,
	) );
}
add_action( 'init', 'sml_qa_register_cpt' );

register_activation_hook( __FILE__, function () {
	sml_qa_register_cpt();
	flush_rewrite_rules();
} );
register_deactivation_hook( __FILE__, function () {
	flush_rewrite_rules();
} );

/* ---------------------------------------------------------------------------
 * Answers = native comments with a custom type, kept out of every default
 * comment query and the dashboard count so they never leak into normal streams.
 * ------------------------------------------------------------------------- */
add_action( 'pre_get_comments', function ( $q ) {
	/* Keep answers visible on the real wp-admin Comments screen so admins can
	   moderate them; hide them from every front-end query INCLUDING admin-ajax
	   (front-end stream/group-reply features often fetch via ajax). */
	if ( is_admin() && ! wp_doing_ajax() ) { return; }
	$type = $q->query_vars['type'] ?? '';
	$type_in = $q->query_vars['type__in'] ?? '';
	if ( '' === $type && '' === $type_in ) {
		$not = $q->query_vars['type__not_in'] ?? array();
		$not = is_array( $not ) ? $not : (array) $not;
		if ( ! in_array( SML_QA_ANSWER_TYPE, $not, true ) ) { $not[] = SML_QA_ANSWER_TYPE; }
		$q->query_vars['type__not_in'] = $not;
	}
} );

/* Question helpers ---------------------------------------------------------- */
function sml_qa_answers( $question_id ) {
	return get_comments( array(
		'post_id' => (int) $question_id,
		'type'    => SML_QA_ANSWER_TYPE,
		'status'  => 'approve',
		'orderby' => 'comment_karma', /* placeholder; we re-sort by votes in PHP */
		'order'   => 'DESC',
	) );
}
function sml_qa_answer_count( $question_id ) {
	$c = get_post_meta( (int) $question_id, '_sml_qa_answer_count', true );
	if ( '' !== $c ) { return (int) $c; }
	$n = get_comments( array( 'post_id' => (int) $question_id, 'type' => SML_QA_ANSWER_TYPE, 'status' => 'approve', 'count' => true ) );
	update_post_meta( (int) $question_id, '_sml_qa_answer_count', (int) $n );
	return (int) $n;
}
function sml_qa_recount( $question_id ) {
	delete_post_meta( (int) $question_id, '_sml_qa_answer_count' );
	return sml_qa_answer_count( $question_id );
}

/* Keep the count meta (and the noindex gate) honest when an answer is removed,
   unapproved, spammed, or restored — not just when one is added. Also drop the
   accepted-answer pointer if the accepted answer is no longer an approved one. */
function sml_qa_on_answer_change( $comment_id, $comment ) {
	if ( ! is_object( $comment ) || SML_QA_ANSWER_TYPE !== ( $comment->comment_type ?? '' ) ) { return; }
	$qid = (int) $comment->comment_post_ID;
	if ( ! $qid ) { return; }
	sml_qa_recount( $qid );
	if ( (int) get_post_meta( $qid, '_sml_qa_accepted', true ) === (int) $comment_id ) {
		$fresh = get_comment( $comment_id );
		if ( ! $fresh || '1' !== (string) $fresh->comment_approved ) { delete_post_meta( $qid, '_sml_qa_accepted' ); }
	}
}
add_action( 'transition_comment_status', function ( $new, $old, $comment ) { sml_qa_on_answer_change( (int) $comment->comment_ID, $comment ); }, 10, 3 );
add_action( 'deleted_comment', function ( $cid, $comment ) { sml_qa_on_answer_change( (int) $cid, $comment ); }, 10, 2 );

/* ---------------------------------------------------------------------------
 * Index hygiene: noindex any question with zero approved answers. On this
 * WPCOM/Atomic site the robots meta comes from a layer Rank Math/wp_robots
 * filters miss (proven with #7680), so force it in the output buffer — scoped
 * ONLY to unanswered single questions, so there is no cost elsewhere.
 * ------------------------------------------------------------------------- */
function sml_qa_should_noindex() {
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return false; }
	/* Phase 3: the /q/ archive is a real landing page once it has answered
	   questions — index it then, but keep the guard so an empty archive (every
	   question removed or still unanswered) never gets indexed as a thin page. */
	if ( is_post_type_archive( 'sml_question' ) ) {
		/* Page 2+ of the archive are browse-only: every question is already in the
		   sitemap as its own URL, so keep paginated listings out of the index
		   rather than let them accrue as thin, duplicate-framed pages. */
		if ( is_paged() ) { return true; }
		return ! sml_qa_has_indexable_questions();
	}
	if ( ! is_singular( 'sml_question' ) ) { return false; }
	return sml_qa_answer_count( get_queried_object_id() ) < 1;
}
add_action( 'template_redirect', function () {
	if ( ! sml_qa_should_noindex() ) { return; }
	ob_start( function ( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '<head' ) ) { return $html; }
		/* strip EVERY robots meta (whitespace-tolerant), then inject one noindex */
		$stripped = preg_replace( '/<meta[^>]+name\s*=\s*["\']robots["\'][^>]*>\s*/i', '', $html );
		$out = preg_replace( '/<head(\s[^>]*)?>/i', '$0' . "\n" . '<meta name="robots" content="noindex, follow">', is_string( $stripped ) ? $stripped : $html, 1 );
		return is_string( $out ) ? $out : $html;
	} );
}, 0 );

/* Give the /q/ archive a real identity instead of the theme's "Archives:
   Questions" default — a clean title + an intro that frames the section. */
add_filter( 'get_the_archive_title', function ( $title ) {
	if ( is_post_type_archive( 'sml_question' ) ) { return 'Community Q&amp;A'; }
	return $title;
} );
add_filter( 'get_the_archive_description', function ( $desc ) {
	/* Standard path (themes that render the archive description). Intro only on
	   page 1 — never repeat the framing paragraph on /q/page/N/. */
	if ( is_post_type_archive( 'sml_question' ) && ! is_paged() ) {
		return sml_qa_archive_intro_html();
	}
	return $desc;
} );

function sml_qa_archive_intro_html() {
	return '<p>Real questions from traders about how the market actually works — halts and circuit breakers, options flow and dealer hedging, volatility, short interest and more. Every answer is written to be specific and evergreen.</p>';
}

/* Block themes commonly render the archive title but not the archive description,
   so the filter above never surfaces. Echo the intro right before the main
   archive loop instead — main query, page 1, once. */
add_action( 'loop_start', function ( $query ) {
	if ( is_admin() || ! ( $query instanceof WP_Query ) || ! $query->is_main_query() ) { return; }
	if ( ! is_post_type_archive( 'sml_question' ) || is_paged() ) { return; }
	static $shown = false;
	if ( $shown ) { return; }
	$shown = true;
	echo '<div class="sml-qa sml-qa-archive-intro">' . wp_kses_post( sml_qa_archive_intro_html() ) . '</div>';
} );

/* Sitewide: a tiny script that adds a "Q&A" item to the global header nav so the
   knowledge base is reachable from every page. Additive + reversible; loads in
   the footer so it never blocks render. */
add_action( 'wp_enqueue_scripts', function () {
	if ( is_admin() ) { return; }
	wp_enqueue_script( 'sml-qa-nav', SML_QA_URL . 'assets/nav.js', array(), SML_QA_VER, true );
}, 20 );

/* Front-end assets on question pages + any page carrying the ask shortcode. */
add_action( 'wp_enqueue_scripts', function () {
	if ( ! is_singular( 'sml_question' ) && ! is_post_type_archive( 'sml_question' ) && ! sml_qa_page_has_ask() ) { return; }
	/* The design uses Archivo (UI/headings, incl. a 650 weight → variable axis)
	   and IBM Plex Mono (data/labels). Load both from Google Fonts; qa.css falls
	   back to Helvetica/system-mono if the request is blocked. */
	wp_enqueue_style( 'sml-qa-fonts', 'https://fonts.googleapis.com/css2?family=Archivo:wght@400..800&family=IBM+Plex+Mono:wght@400;500;600&display=swap', array(), null );
	wp_enqueue_style( 'sml-qa', SML_QA_URL . 'assets/qa.css', array( 'sml-qa-fonts' ), SML_QA_VER );
	wp_enqueue_script( 'sml-qa', SML_QA_URL . 'assets/qa.js', array(), SML_QA_VER, true );
	wp_localize_script( 'sml-qa', 'SML_QA', array(
		'rest'    => esc_url_raw( rest_url( 'sml-qa/v1' ) ),
		'nonce'   => wp_create_nonce( 'wp_rest' ),
		'me'      => get_current_user_id(),
		'loginUrl'=> wp_login_url( is_singular() ? get_permalink() : home_url( '/' ) ),
	) );
} );

function sml_qa_page_has_ask() {
	if ( ! is_singular() ) { return false; }
	$p = get_post();
	return $p && has_shortcode( (string) $p->post_content, 'sml_qa_ask' );
}
