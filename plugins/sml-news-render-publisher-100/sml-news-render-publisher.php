<?php
/**
 * Plugin Name: SML News Render Publisher
 * Description: Registers audited SML NEWS pipeline metadata and blocks duplicate source articles at WordPress.
 * Version: 1.0.0
 * Author: Stock Market Loop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! function_exists( 'sml_nrp_meta_auth' ) ) {
    function sml_nrp_meta_auth() {
        return current_user_can( 'edit_posts' );
    }

    add_action( 'init', static function () {
        $fields = array(
            '_sml_pipeline_version'      => 'string',
            '_sml_source_url_hash'       => 'string',
            '_sml_source_url'            => 'string',
            '_sml_subtitle'              => 'string',
            'rank_math_title'            => 'string',
            'rank_math_description'      => 'string',
            'rank_math_focus_keyword'    => 'string',
        );
        foreach ( $fields as $key => $type ) {
            register_post_meta( 'post', $key, array(
                'single'            => true,
                'type'              => $type,
                'show_in_rest'      => true,
                'sanitize_callback' => ( '_sml_source_url' === $key ) ? 'esc_url_raw' : 'sanitize_text_field',
                'auth_callback'     => 'sml_nrp_meta_auth',
            ) );
        }
    } );

    add_filter( 'rest_pre_insert_post', static function ( $prepared, $request ) {
        $meta = $request->get_param( 'meta' );
        if ( ! is_array( $meta ) || 'render-v1' !== ( $meta['_sml_pipeline_version'] ?? '' ) ) {
            return $prepared;
        }

        $user = wp_get_current_user();
        if ( ! $user || 'stockmarketloop' !== strtolower( (string) $user->user_nicename ) ||
            'sml news' !== strtolower( trim( (string) $user->display_name ) ) ) {
            return new WP_Error(
                'sml_news_author_mismatch',
                'Render article publishing is restricted to the SML NEWS account.',
                array( 'status' => 403 )
            );
        }

        $hash = strtolower( (string) ( $meta['_sml_source_url_hash'] ?? '' ) );
        if ( ! preg_match( '/^[a-f0-9]{64}$/', $hash ) ) {
            return new WP_Error( 'sml_invalid_source_hash', 'A valid source hash is required.', array( 'status' => 422 ) );
        }

        $existing = get_posts( array(
            'post_type'        => 'post',
            'post_status'      => array( 'publish', 'draft', 'pending', 'private', 'future' ),
            'posts_per_page'   => 1,
            'fields'           => 'ids',
            'meta_key'         => '_sml_source_url_hash',
            'meta_value'       => $hash,
            'suppress_filters' => false,
        ) );
        if ( $existing ) {
            return new WP_Error(
                'sml_duplicate_article',
                'This source article was already processed.',
                array( 'status' => 409, 'existing_post_id' => (int) $existing[0] )
            );
        }

        return $prepared;
    }, 10, 2 );

    add_filter( 'the_content', static function ( $content ) {
        if ( ! is_singular( 'post' ) ) { return $content; }
        $subtitle = get_post_meta( get_the_ID(), '_sml_subtitle', true );
        if ( ! $subtitle || false !== strpos( $content, 'sml-news-subtitle' ) ) { return $content; }
        return '<p class="sml-news-subtitle">' . esc_html( $subtitle ) . '</p>' . $content;
    }, 8 );
}
