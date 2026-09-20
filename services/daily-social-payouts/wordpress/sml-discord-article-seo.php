<?php
/**
 * Plugin Name: SML Discord Article SEO Bridge
 * Description: Applies validated Rank Math, taxonomy, image, social-package and NewsArticle metadata before Discord-bot articles are published.
 * Version: 1.0.0
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-discord-articles/v1', '/apply/(?P<id>\d+)', array(
		'methods'             => 'POST',
		'permission_callback' => function ( WP_REST_Request $request ) {
			return current_user_can( 'edit_post', (int) $request['id'] );
		},
		'callback'            => 'sml_discord_article_apply_package',
		'args'                => array( 'id' => array( 'validate_callback' => function ( $value ) { return (int) $value > 0; } ) ),
	) );
} );

function sml_discord_article_apply_package( WP_REST_Request $request ) {
	$post_id = (int) $request['id'];
	$post    = get_post( $post_id );
	if ( ! $post || 'post' !== $post->post_type ) {
		return new WP_Error( 'sml_article_missing', 'The target article was not found.', array( 'status' => 404 ) );
	}
	$data = (array) $request->get_json_params();
	$seo_title = sanitize_text_field( $data['seoTitle'] ?? '' );
	$description = sanitize_text_field( $data['metaDescription'] ?? '' );
	$keyword = sanitize_text_field( $data['focusKeyword'] ?? '' );
	if ( '' === $seo_title || '' === $description || '' === $keyword ) {
		return new WP_Error( 'sml_article_invalid', 'SEO title, meta description and focus keyword are required.', array( 'status' => 400 ) );
	}
	update_post_meta( $post_id, 'rank_math_title', $seo_title );
	update_post_meta( $post_id, 'rank_math_description', $description );
	update_post_meta( $post_id, 'rank_math_focus_keyword', $keyword );
	update_post_meta( $post_id, '_sml_secondary_keywords', array_map( 'sanitize_text_field', (array) ( $data['secondaryKeywords'] ?? array() ) ) );
	update_post_meta( $post_id, '_sml_jetpack_social_posts', sml_discord_article_sanitize_deep( (array) ( $data['socialPosts'] ?? array() ) ) );
	update_post_meta( $post_id, '_sml_newsarticle_schema', sml_discord_article_sanitize_deep( (array) ( $data['schema'] ?? array() ) ) );
	update_post_meta( $post_id, '_sml_discord_article_optimized', gmdate( 'c' ) );

	$categories = array_values( array_filter( array_map( 'sanitize_text_field', (array) ( $data['categories'] ?? array() ) ) ) );
	$tags       = array_values( array_filter( array_map( 'sanitize_text_field', (array) ( $data['tags'] ?? array() ) ) ) );
	if ( $categories ) { wp_set_object_terms( $post_id, $categories, 'category', false ); }
	if ( $tags ) { wp_set_object_terms( $post_id, $tags, 'post_tag', false ); }

	$thumbnail_id = get_post_thumbnail_id( $post_id );
	if ( $thumbnail_id && ! empty( $data['imageAltText'] ) ) {
		update_post_meta( $thumbnail_id, '_wp_attachment_image_alt', sanitize_text_field( $data['imageAltText'] ) );
	}

	// Jetpack exposes one reliable per-post Publicize message through REST. Store
	// every per-network variant above, while Facebook supplies the shared fallback.
	$default_social = trim( (string) ( $data['socialPosts']['facebook']['text'] ?? '' ) . ' ' . (string) ( $data['socialPosts']['facebook']['hashtags'] ?? '' ) );
	if ( '' !== $default_social ) {
		update_post_meta( $post_id, 'jetpack_publicize_message', sanitize_textarea_field( $default_social ) );
		update_post_meta( $post_id, '_wpas_customize_per_network', true );
	}
	clean_post_cache( $post_id );
	return rest_ensure_response( array(
		'applied' => true, 'postId' => $post_id,
		'categories' => wp_get_post_terms( $post_id, 'category', array( 'fields' => 'names' ) ),
		'tags' => wp_get_post_terms( $post_id, 'post_tag', array( 'fields' => 'names' ) ),
	) );
}

function sml_discord_article_sanitize_deep( $value ) {
	if ( is_array( $value ) ) { return array_map( 'sml_discord_article_sanitize_deep', $value ); }
	return is_scalar( $value ) ? sanitize_text_field( (string) $value ) : '';
}

// If Rank Math is unavailable, emit the stored NewsArticle graph. When Rank Math
// is active it owns the page graph, preventing duplicate NewsArticle entities.
add_action( 'wp_head', function () {
	if ( defined( 'RANK_MATH_VERSION' ) || ! is_singular( 'post' ) ) { return; }
	$schema = get_post_meta( get_queried_object_id(), '_sml_newsarticle_schema', true );
	if ( is_array( $schema ) && ! empty( $schema['headline'] ) ) {
		echo '<script type="application/ld+json">' . wp_json_encode( $schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . '</script>' . "\n";
	}
}, 30 );

add_filter( 'rank_math/json_ld', function ( $data ) {
	if ( ! is_singular( 'post' ) ) { return $data; }
	$schema = get_post_meta( get_queried_object_id(), '_sml_newsarticle_schema', true );
	if ( ! is_array( $schema ) || empty( $schema['headline'] ) ) { return $data; }
	foreach ( $data as $key => $entity ) {
		$type = isset( $entity['@type'] ) ? (array) $entity['@type'] : array();
		if ( array_intersect( $type, array( 'Article', 'NewsArticle', 'BlogPosting' ) ) ) {
			$data[ $key ] = array_merge( $entity, array_diff_key( $schema, array( '@context' => true ) ) );
			return $data;
		}
	}
	$data['smlDiscordNewsArticle'] = array_diff_key( $schema, array( '@context' => true ) );
	return $data;
}, 99 );
