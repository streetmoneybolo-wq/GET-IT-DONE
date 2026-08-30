<?php
/**
 * SML Q&A — discovery (Phase 3).
 *
 * A self-contained XML sitemap of the ANSWERED (indexable) questions, plus the
 * /q/ archive landing page. Served by intercepting the request path at
 * template_redirect — the same no-rewrite, no-flush pattern the entity-graph
 * sitemaps use (wpcode/seo-sitemaps.php), which is proven on this WPCOM/Atomic
 * stack. Discovery is wired two ways: a robots.txt Sitemap: line (always works)
 * and an entry in Rank Math's sitemap index (better crawl discovery).
 *
 * Only answered questions are listed — an unanswered question is noindex (see
 * sml_qa_should_noindex), so listing it would put a noindex URL in the sitemap,
 * a self-contradictory signal. The list is built from the maintained answer-count
 * meta, so it grows and shrinks automatically as questions are answered/emptied.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_QA_SITEMAP_PATH', '/sml-qa-sitemap.xml' );

function sml_qa_xml_esc( $s ) {
	return htmlspecialchars( (string) $s, ENT_XML1 | ENT_QUOTES, 'UTF-8' );
}

/** Cheap boolean: is there at least one answered (indexable) question? Used to
 *  keep the /q/ archive out of the index while it is empty. */
function sml_qa_has_indexable_questions() {
	$q = get_posts( array(
		'post_type'      => 'sml_question',
		'post_status'    => 'publish',
		'posts_per_page' => 1,
		'fields'         => 'ids',
		'no_found_rows'  => true,
		'meta_query'     => array(
			array( 'key' => '_sml_qa_answer_count', 'value' => 0, 'compare' => '>', 'type' => 'NUMERIC' ),
		),
	) );
	return ! empty( $q );
}

/** IDs of published questions with at least one approved answer (indexable). */
function sml_qa_indexable_question_ids() {
	return get_posts( array(
		'post_type'      => 'sml_question',
		'post_status'    => 'publish',
		'posts_per_page' => 2000, /* bounded; revisit with real scale */
		'fields'         => 'ids',
		'no_found_rows'  => true,
		'orderby'        => 'modified',
		'order'          => 'DESC',
		'meta_query'     => array(
			array( 'key' => '_sml_qa_answer_count', 'value' => 0, 'compare' => '>', 'type' => 'NUMERIC' ),
		),
	) );
}

function sml_qa_render_sitemap() {
	$ids = sml_qa_indexable_question_ids();
	/* Collapse the per-id get_permalink()/get_post_modified_time() N+1 into one
	   batched load. Posts only — the loop reads no post meta. */
	if ( ! empty( $ids ) ) { _prime_post_caches( $ids, false, false ); }
	$xml  = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
	$xml .= '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";

	/* The section landing page (the /q/ archive) — indexable once it has content. */
	$archive = get_post_type_archive_link( 'sml_question' );
	if ( $archive && ! empty( $ids ) ) {
		$xml .= '<url><loc>' . sml_qa_xml_esc( $archive ) . '</loc><changefreq>daily</changefreq><priority>0.6</priority></url>' . "\n";
	}

	foreach ( $ids as $id ) {
		$loc = get_permalink( $id );
		if ( ! $loc ) { continue; }
		$mod = get_post_modified_time( 'c', true, $id );
		$xml .= '<url><loc>' . sml_qa_xml_esc( $loc ) . '</loc>';
		if ( $mod ) { $xml .= '<lastmod>' . sml_qa_xml_esc( $mod ) . '</lastmod>'; }
		$xml .= '<changefreq>weekly</changefreq><priority>0.7</priority></url>' . "\n";
	}

	$xml .= '<!-- ' . count( $ids ) . " answered questions -->\n";
	$xml .= '</urlset>';
	return $xml;
}

/* Serve the sitemap by path interception — no rewrite rule, so no flush needed. */
add_action( 'init', function () {
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return; }
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	if ( SML_QA_SITEMAP_PATH !== $path ) { return; }
	add_action( 'template_redirect', function () {
		global $wp_query;
		if ( $wp_query ) { $wp_query->is_404 = false; }
		status_header( 200 );
		header( 'Content-Type: application/xml; charset=UTF-8' );
		/* Short public cache so the edge absorbs repeat/crawler hits (the render is
		   already bounded + cache-primed); 15 min of staleness is fine for a sitemap. */
		header( 'Cache-Control: public, max-age=900, s-maxage=900' );
		echo sml_qa_render_sitemap(); // phpcs:ignore WordPress.Security.EscapeOutput
		exit;
	}, 0 );
}, 1 );

/* Discovery #1 — robots.txt Sitemap: line (additive + idempotent). */
add_filter( 'robots_txt', function ( $output, $public ) {
	if ( ! $public ) { return $output; }
	if ( false !== strpos( (string) $output, 'sml-qa-sitemap.xml' ) ) { return $output; }
	return rtrim( (string) $output ) . "\nSitemap: " . home_url( SML_QA_SITEMAP_PATH ) . "\n";
}, 22, 2 );

/* Discovery #2 — add to Rank Math's sitemap index (if Rank Math is present). */
add_filter( 'rank_math/sitemap/index', function ( $links ) {
	$loc = home_url( SML_QA_SITEMAP_PATH );
	if ( is_string( $links ) && false !== strpos( $links, 'sml-qa-sitemap.xml' ) ) { return $links; }
	$entry = '<sitemap><loc>' . sml_qa_xml_esc( $loc ) . '</loc><lastmod>' . sml_qa_xml_esc( gmdate( 'c' ) ) . '</lastmod></sitemap>' . "\n";
	return (string) $links . $entry;
} );
