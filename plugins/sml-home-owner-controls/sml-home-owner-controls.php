<?php
/**
 * Plugin Name: SML Home Owner Controls
 * Description: Keeps homepage feed identities current and lets owners permanently delete their own articles and posts.
 * Version: 1.0.1
 * Author: Stock Market Loop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

/**
 * Apply the requested SML News identity once without changing the account
 * login, nicename, public handle, or stable /stockmarketloop/ profile URL.
 */
function sml_hoc_migrate_news_identity() {
	if ( '1.0.1' === get_option( 'sml_hoc_identity_version' ) ) { return; }
	$user_id = 258456543;
	if ( get_userdata( $user_id ) ) {
		update_user_meta( $user_id, 'sml_display_handle', 'SML News' );
		update_user_meta( $user_id, 'sml_avatar_url', 'https://stockmarketloop.com/wp-content/uploads/2026/08/Untitled-design-90.png' );
		wp_update_user( array( 'ID' => $user_id, 'display_name' => 'SML News' ) );
	}
	update_option( 'sml_hoc_identity_version', '1.0.1', false );
}
add_action( 'init', 'sml_hoc_migrate_news_identity', 1 );

function sml_hoc_owner_for_item( $item_id ) {
	$item_id = sanitize_text_field( (string) $item_id );
	if ( preg_match( '/^wp-(\d+)$/', $item_id, $match ) ) {
		return absint( get_post_field( 'post_author', absint( $match[1] ) ) );
	}
	if ( preg_match( '/^chart-(\d+)-/', $item_id, $match ) ) { return absint( $match[1] ); }
	if ( preg_match( '/^stream-(\d+)$/', $item_id, $match ) ) {
		$comment = get_comment( absint( $match[1] ) );
		if ( ! $comment ) { return 0; }
		$owner = absint( $comment->user_id );
		if ( function_exists( 'sml_members_parse_stream_comment' ) ) {
			$row = sml_members_parse_stream_comment( $comment );
			if ( is_array( $row ) ) { $owner = absint( $row['user_id'] ?? $owner ); }
		}
		return $owner;
	}
	return 0;
}

function sml_hoc_identity( $user_id ) {
	$user = get_userdata( absint( $user_id ) );
	if ( ! $user ) { return null; }
	$name = sanitize_text_field( (string) get_user_meta( $user->ID, 'sml_display_handle', true ) );
	if ( ! $name ) { $name = sanitize_text_field( $user->display_name ?: $user->user_login ); }
	$avatar = esc_url_raw( (string) get_user_meta( $user->ID, 'sml_avatar_url', true ) );
	if ( ! $avatar ) { $avatar = get_avatar_url( $user->ID, array( 'size' => 96 ) ); }
	$url = function_exists( 'sml_sth_profile_url' ) ? sml_sth_profile_url( $user->ID ) : get_author_posts_url( $user->ID );
	return array(
		'id'     => (int) $user->ID,
		'name'   => $name,
		'avatar' => esc_url_raw( (string) $avatar ),
		'url'    => esc_url_raw( (string) $url ),
	);
}

function sml_hoc_patch_home( $html ) {
	if ( ! is_string( $html ) || false === strpos( $html, 'id="sml-optimized-home"' ) ) { return $html; }
	$current = get_current_user_id();
	$pattern = '~(<article\b[^>]*\bdata-hfe-item="([^"]+)"[^>]*>)(\s*<a\b[^>]*class="oh-post-author"[^>]*>.*?</a>)~is';
	$html = preg_replace_callback( $pattern, static function ( $match ) use ( $current ) {
		$item_id  = html_entity_decode( (string) $match[2], ENT_QUOTES, 'UTF-8' );
		$owner_id = sml_hoc_owner_for_item( $item_id );
		$identity = sml_hoc_identity( $owner_id );
		if ( ! $identity ) { return $match[0]; }
		$opening = $match[1];
		if ( false === strpos( $opening, 'data-sml-owner-id=' ) ) {
			$opening = preg_replace( '/>$/', ' data-sml-owner-id="' . esc_attr( (string) $owner_id ) . '">', $opening, 1 );
		}
		$stable_url = $identity['url'];
		if ( preg_match( '/\bhref="([^"]*)"/i', $match[3], $href_match ) ) {
			$stable_url = html_entity_decode( $href_match[1], ENT_QUOTES, 'UTF-8' );
		}
		$author = '<a class="oh-post-author" data-sml-user-id="' . esc_attr( (string) $owner_id ) . '" href="' . esc_url( $stable_url ) . '"><img class="oh-post-avatar" src="' . esc_url( $identity['avatar'] ) . '" alt="' . esc_attr( $identity['name'] ) . '"><span class="oh-post-author-name">' . esc_html( $identity['name'] ) . '</span></a>';
		$button = '';
		if ( $current && ( (int) $current === (int) $owner_id || current_user_can( 'manage_options' ) ) ) {
			$button = '<button type="button" class="sml-owner-delete" data-sml-delete-item="' . esc_attr( $item_id ) . '" aria-label="Delete this post permanently" title="Delete this post permanently">Delete</button>';
		}
		return $opening . $author . $button;
	}, $html );
	return $html;
}

function sml_hoc_start_buffer() {
	if ( is_admin() || ! is_user_logged_in() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return; }
	$path = trim( (string) parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	if ( '' === $path ) { ob_start( 'sml_hoc_patch_home' ); }
}
add_action( 'init', 'sml_hoc_start_buffer', 0 );

function sml_hoc_error( $code, $message, $status ) {
	return new WP_Error( $code, $message, array( 'status' => (int) $status ) );
}

function sml_hoc_delete_wp( $post_id, $user_id ) {
	$post = get_post( $post_id );
	if ( ! $post ) { return sml_hoc_error( 'sml_hoc_missing', 'That article or post no longer exists.', 404 ); }
	if ( (int) $post->post_author !== (int) $user_id && ! current_user_can( 'manage_options' ) ) { return sml_hoc_error( 'sml_hoc_owner', 'You can only delete content you own.', 403 ); }
	if ( ! current_user_can( 'delete_post', $post_id ) && ! current_user_can( 'manage_options' ) ) { return sml_hoc_error( 'sml_hoc_denied', 'Your account cannot delete this content.', 403 ); }
	if ( ! wp_delete_post( $post_id, true ) ) { return sml_hoc_error( 'sml_hoc_failed', 'The article or post could not be deleted.', 500 ); }
	return array( 'deleted' => true, 'type' => 'wordpress', 'id' => $post_id );
}

function sml_hoc_delete_chart( $item_id, $user_id ) {
	global $wpdb;
	if ( ! preg_match( '/^chart-(\d+)-(.+)$/', $item_id, $match ) ) { return sml_hoc_error( 'sml_hoc_bad_id', 'That Chart post identifier is invalid.', 400 ); }
	$claimed = absint( $match[1] );
	$post_id = sanitize_key( $match[2] );
	$rows = $wpdb->get_results( $wpdb->prepare( "SELECT user_id, meta_value FROM {$wpdb->usermeta} WHERE meta_key=%s", 'sml_profile_chart_posts' ), ARRAY_A );
	foreach ( (array) $rows as $row ) {
		$posts = maybe_unserialize( $row['meta_value'] ?? '' );
		if ( ! is_array( $posts ) ) { continue; }
		$next = array(); $found = false;
		foreach ( $posts as $post ) {
			if ( ! is_array( $post ) ) { $next[] = $post; continue; }
			$row_id = sanitize_key( (string) ( $post['id'] ?? '' ) );
			$author = absint( $post['author_id'] ?? $post['user_id'] ?? $row['user_id'] );
			if ( $row_id === $post_id && $author === $claimed ) {
				if ( $author !== (int) $user_id && ! current_user_can( 'manage_options' ) ) { return sml_hoc_error( 'sml_hoc_owner', 'You can only delete content you own.', 403 ); }
				$found = true; continue;
			}
			$next[] = $post;
		}
		if ( $found ) {
			update_user_meta( absint( $row['user_id'] ), 'sml_profile_chart_posts', array_values( $next ) );
			if ( function_exists( 'sml_members_increment_stat' ) ) { sml_members_increment_stat( $claimed, 'posts', -1, false ); }
			return array( 'deleted' => true, 'type' => 'chart', 'id' => $post_id );
		}
	}
	return sml_hoc_error( 'sml_hoc_missing', 'That Chart post no longer exists.', 404 );
}

function sml_hoc_delete_stream( $item_id, $user_id ) {
	if ( ! preg_match( '/^stream-(\d+)$/', $item_id, $match ) ) { return sml_hoc_error( 'sml_hoc_bad_id', 'That market post identifier is invalid.', 400 ); }
	$comment_id = absint( $match[1] );
	$owner_id = sml_hoc_owner_for_item( $item_id );
	if ( ! $owner_id ) { return sml_hoc_error( 'sml_hoc_missing', 'That market post no longer exists.', 404 ); }
	if ( $owner_id !== (int) $user_id && ! current_user_can( 'manage_options' ) ) { return sml_hoc_error( 'sml_hoc_owner', 'You can only delete content you own.', 403 ); }
	if ( ! wp_delete_comment( $comment_id, true ) ) { return sml_hoc_error( 'sml_hoc_failed', 'The market post could not be deleted.', 500 ); }
	return array( 'deleted' => true, 'type' => 'stream', 'id' => $comment_id );
}

function sml_hoc_rest_delete( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	if ( ! $user_id ) { return sml_hoc_error( 'sml_hoc_sign_in', 'Sign in to delete your content.', 401 ); }
	$item_id = sanitize_text_field( (string) $request->get_param( 'item_id' ) );
	if ( preg_match( '/^wp-(\d+)$/', $item_id, $match ) ) { $result = sml_hoc_delete_wp( absint( $match[1] ), $user_id ); }
	elseif ( 0 === strpos( $item_id, 'chart-' ) ) { $result = sml_hoc_delete_chart( $item_id, $user_id ); }
	elseif ( 0 === strpos( $item_id, 'stream-' ) ) { $result = sml_hoc_delete_stream( $item_id, $user_id ); }
	else { $result = sml_hoc_error( 'sml_hoc_bad_item', 'This feed item cannot be deleted here.', 400 ); }
	if ( is_wp_error( $result ) ) { return $result; }
	$response = rest_ensure_response( $result );
	$response->header( 'Cache-Control', 'private, no-store' );
	return $response;
}

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml-home-owner/v1', '/content', array(
		'methods'             => WP_REST_Server::DELETABLE,
		'callback'            => 'sml_hoc_rest_delete',
		'permission_callback' => 'is_user_logged_in',
		'args'                => array( 'item_id' => array( 'required' => true, 'type' => 'string' ) ),
	) );
} );
