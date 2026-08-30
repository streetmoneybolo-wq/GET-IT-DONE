<?php
/**
 * Plugin Name: SML Q&A
 * Description: First-party Questions & Answers built on WordPress core — CPT questions, answers as native comments, votes, accepted answers. Content is created server-side via first-party REST routes (this Atomic site gates the core /wp/v2/{cpt} routes). Unanswered questions are noindex from day one.
 * Version: 0.1.0
 * Author: StockMarketLoop
 *
 * Phase 1 of SML/QA-PLATFORM-HANDOFF.md. Routing confirmed in Phase 0 (§5.2):
 * pretty /q/{slug}/ permalinks persist via this plugin's activation hook.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_QA_VER', '0.1.0' );
define( 'SML_QA_DIR', plugin_dir_path( __FILE__ ) );
define( 'SML_QA_URL', plugin_dir_url( __FILE__ ) );
define( 'SML_QA_ANSWER_TYPE', 'sml_answer' );

require_once SML_QA_DIR . 'includes/rest.php';
require_once SML_QA_DIR . 'includes/render.php';

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
	$type = $q->query_vars['type'] ?? '';
	$type_in = $q->query_vars['type__in'] ?? '';
	if ( '' === $type && '' === $type_in ) {
		$not = $q->query_vars['type__not_in'] ?? array();
		$not = is_array( $not ) ? $not : (array) $not;
		if ( ! in_array( SML_QA_ANSWER_TYPE, $not, true ) ) { $not[] = SML_QA_ANSWER_TYPE; }
		$q->query_vars['type__not_in'] = $not;
	}
} );

add_filter( 'wp_count_comments', function ( $stats, $post_id ) {
	if ( $post_id ) { return $stats; } /* only adjust the global dashboard total */
	global $wpdb;
	$n = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->comments} WHERE comment_type = %s AND comment_approved = '1'", SML_QA_ANSWER_TYPE ) );
	if ( $n && is_object( $stats ) ) {
		foreach ( array( 'approved', 'all', 'total_comments' ) as $k ) {
			if ( isset( $stats->$k ) ) { $stats->$k = max( 0, (int) $stats->$k - $n ); }
		}
	}
	return $stats;
}, 10, 2 );

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

/* ---------------------------------------------------------------------------
 * Index hygiene: noindex any question with zero approved answers. On this
 * WPCOM/Atomic site the robots meta comes from a layer Rank Math/wp_robots
 * filters miss (proven with #7680), so force it in the output buffer — scoped
 * ONLY to unanswered single questions, so there is no cost elsewhere.
 * ------------------------------------------------------------------------- */
function sml_qa_should_noindex() {
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return false; }
	if ( ! is_singular( 'sml_question' ) ) { return false; }
	return sml_qa_answer_count( get_queried_object_id() ) < 1;
}
add_action( 'template_redirect', function () {
	if ( ! sml_qa_should_noindex() ) { return; }
	ob_start( function ( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '<meta' ) ) { return $html; }
		$tag = '<meta name="robots" content="noindex, follow">';
		if ( preg_match( '/<meta[^>]+name=["\']robots["\'][^>]*>/i', $html ) ) {
			$new = preg_replace( '/<meta[^>]+name=["\']robots["\'][^>]*>/i', $tag, $html, 1 );
		} else {
			$new = preg_replace( '/<head(\s[^>]*)?>/i', '$0' . "\n" . $tag, $html, 1 );
		}
		return is_string( $new ) ? $new : $html;
	} );
}, 0 );

/* Front-end assets on question pages + any page carrying the ask shortcode. */
add_action( 'wp_enqueue_scripts', function () {
	if ( ! is_singular( 'sml_question' ) && ! is_post_type_archive( 'sml_question' ) && ! sml_qa_page_has_ask() ) { return; }
	wp_enqueue_style( 'sml-qa', SML_QA_URL . 'assets/qa.css', array(), SML_QA_VER );
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
