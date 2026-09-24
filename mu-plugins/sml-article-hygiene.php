<?php
/**
 * Plugin Name: SML Article Hygiene
 * Description: Keeps the publishing pipeline out of sight. Internal pipeline comments never stay in a post body (their SEO values move to Rank Math), internal _sml_* post meta is not served to the public REST API, and known boilerplate lines that describe how a piece was produced are dropped at render time.
 * Version: 1.0.0
 *
 * Rendering never touches stored content except the SMLN_META comments (moved to Rank Math on save). Filters only. ROLLBACK: delete this file.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

/* 1. Pipeline comments left in post bodies by the external news flow: keep their SEO values, drop the comment. */
global $sml_ah_pending;
$sml_ah_pending = array();

add_filter( 'wp_insert_post_data', function ( $data, $postarr ) {
	global $sml_ah_pending;
	$c = isset( $data['post_content'] ) ? (string) $data['post_content'] : '';
	if ( false === strpos( $c, 'SMLN_META_' ) ) { return $data; }
	$meta = array();
	if ( preg_match( '/<!--\s*SMLN_META_TITLE:\s*(.*?)\s*-->/s', $c, $t ) ) { $meta['rank_math_title'] = trim( $t[1] ); }
	if ( preg_match( '/<!--\s*SMLN_META_DESCRIPTION:\s*(.*?)\s*-->/s', $c, $d ) ) { $meta['rank_math_description'] = trim( $d[1] ); }
	$key = md5( ( $data['post_title'] ?? '' ) . ( $data['post_name'] ?? '' ) . ( $data['post_date_gmt'] ?? '' ) );
	$sml_ah_pending[ $key ] = $meta;
	$data['post_content'] = preg_replace( '/(?:<br\s*\/?>\s*)?<!--\s*SMLN_META_[A-Z_]+:.*?-->\s*(?:<br\s*\/?>)?/s', '', $c );
	return $data;
}, 5, 2 );

add_action( 'save_post', function ( $post_id, $post ) {
	global $sml_ah_pending;
	if ( ! $sml_ah_pending || ! $post ) { return; }
	$key = md5( $post->post_title . $post->post_name . $post->post_date_gmt );
	if ( empty( $sml_ah_pending[ $key ] ) ) { return; }
	foreach ( $sml_ah_pending[ $key ] as $k => $v ) { if ( '' === (string) get_post_meta( $post_id, $k, true ) ) { update_post_meta( $post_id, $k, $v ); } }
	unset( $sml_ah_pending[ $key ] );
}, 20, 2 );

/* 2. Internal meta is not part of the public API. Editors of the post still see everything. */
function sml_ah_is_internal_meta( $key ) {
	return 0 === strpos( (string) $key, '_sml_' ) || 0 === strpos( (string) $key, '_wpcom_ai' ) || 'big_sky_generated' === $key || 'big_sky_generated_logo' === $key;
}
foreach ( array( 'post', 'page' ) as $sml_ah_type ) {
	add_filter( 'rest_prepare_' . $sml_ah_type, function ( $response, $post ) {
		$data = $response->get_data();
		if ( empty( $data['meta'] ) || ! is_array( $data['meta'] ) || current_user_can( 'edit_post', $post->ID ) ) { return $response; }
		foreach ( array_keys( $data['meta'] ) as $k ) { if ( sml_ah_is_internal_meta( $k ) ) { unset( $data['meta'][ $k ] ); } }
		$response->set_data( $data );
		return $response;
	}, 20, 2 );
}

/* 3. Boilerplate that describes the production process never renders (exact, known lines only). */
add_filter( 'the_content', function ( $html ) {
	if ( ! is_string( $html ) || '' === $html ) { return $html; }
	if ( false !== strpos( $html, 'SMLN_META_' ) ) {
		$html = preg_replace( '/(?:<br\s*\/?>\s*)?<!--\s*SMLN_META_[A-Z_]+:.*?-->\s*(?:<br\s*\/?>)?/s', '', $html );
	}
	if ( preg_match( '/AI[- ](assisted|generated|written)|generated (by|with) (AI|an? (language|ai) model)|this (article|letter|analysis) was (auto-?)?generated/i', $html ) ) {
		$html = preg_replace( '#<p[^>]*>\s*(?:AI[- ](?:assisted|generated|written)|Generated (?:by|with) (?:AI|an? (?:language|AI) model)|This (?:article|letter|analysis) was (?:auto-?)?generated)[^<]*</p>#i', '', $html );
	}
	return $html;
}, 1 );
