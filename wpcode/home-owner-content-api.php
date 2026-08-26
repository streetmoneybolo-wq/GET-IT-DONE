/**
 * SML homepage owner content controls.
 *
 * Gives a signed-in creator one permanent-delete endpoint for the content
 * types that can appear in the homepage feed:
 *   wp-{post_id}       WordPress articles/posts
 *   chart-{uid}-{id}   profile Chart posts stored in user meta
 *   stream-{id}        ticker-stream comments
 *
 * Ownership is always re-checked server-side. A client-supplied owner id is
 * never trusted. Deactivate this snippet to remove deletion immediately.
 *
 * STATUS 2026-08-26: NOT INSTALLED — superseded by the "SML Home Owner
 * Controls" plugin (sml_hoc_*), which owns the sml-home-owner/v1/content
 * route in production (verified live: error codes come back sml_hoc_*).
 * This file is kept only as a break-glass fallback: the guard below now
 * also checks for the plugin, so even if this is pasted as a snippet while
 * the plugin is active it registers nothing (single-owner rule).
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere.
 */
if ( ! function_exists( 'sml_home_owner_delete_content' ) && ! function_exists( 'sml_hoc_rest_delete' ) ) {
	function sml_home_owner_delete_error( $code, $message, $status ) {
		return new WP_Error( $code, $message, array( 'status' => (int) $status ) );
	}

	function sml_home_owner_delete_wp_post( $post_id, $user_id ) {
		$post = get_post( $post_id );
		if ( ! $post ) {
			return sml_home_owner_delete_error( 'sml_home_missing_post', 'That article or post no longer exists.', 404 );
		}
		$is_owner = (int) $post->post_author === (int) $user_id;
		if ( ! $is_owner && ! current_user_can( 'manage_options' ) ) {
			return sml_home_owner_delete_error( 'sml_home_not_owner', 'You can only delete content you own.', 403 );
		}
		if ( ! current_user_can( 'delete_post', $post_id ) && ! current_user_can( 'manage_options' ) ) {
			return sml_home_owner_delete_error( 'sml_home_delete_denied', 'Your account cannot delete this content.', 403 );
		}
		$deleted = wp_delete_post( $post_id, true );
		if ( ! $deleted ) {
			return sml_home_owner_delete_error( 'sml_home_delete_failed', 'The article or post could not be deleted.', 500 );
		}
		return array( 'deleted' => true, 'type' => 'wordpress', 'id' => (int) $post_id );
	}

	function sml_home_owner_delete_chart_post( $item_id, $user_id ) {
		global $wpdb;
		if ( ! preg_match( '/^chart-(\d+)-(.+)$/', $item_id, $match ) ) {
			return sml_home_owner_delete_error( 'sml_home_bad_chart_id', 'That Chart post identifier is invalid.', 400 );
		}
		$claimed_author = absint( $match[1] );
		$post_id        = sanitize_key( $match[2] );
		if ( ! $claimed_author || '' === $post_id ) {
			return sml_home_owner_delete_error( 'sml_home_bad_chart_id', 'That Chart post identifier is invalid.', 400 );
		}
		$rows = $wpdb->get_results(
			$wpdb->prepare( "SELECT user_id, meta_value FROM {$wpdb->usermeta} WHERE meta_key = %s", 'sml_profile_chart_posts' ),
			ARRAY_A
		);
		foreach ( (array) $rows as $row ) {
			$posts = maybe_unserialize( $row['meta_value'] ?? '' );
			if ( ! is_array( $posts ) ) { continue; }
			$next = array();
			$found = false;
			foreach ( $posts as $post ) {
				if ( ! is_array( $post ) ) { $next[] = $post; continue; }
				$row_id     = sanitize_key( (string) ( $post['id'] ?? '' ) );
				$row_author = absint( $post['author_id'] ?? $post['user_id'] ?? $row['user_id'] );
				if ( $row_id === $post_id && $row_author === $claimed_author ) {
					if ( $row_author !== (int) $user_id && ! current_user_can( 'manage_options' ) ) {
						return sml_home_owner_delete_error( 'sml_home_not_owner', 'You can only delete content you own.', 403 );
					}
					$found = true;
					continue;
				}
				$next[] = $post;
			}
			if ( $found ) {
				update_user_meta( absint( $row['user_id'] ), 'sml_profile_chart_posts', array_values( $next ) );
				if ( function_exists( 'sml_members_increment_stat' ) ) {
					sml_members_increment_stat( $claimed_author, 'posts', -1, false );
				}
				return array( 'deleted' => true, 'type' => 'chart', 'id' => $post_id );
			}
		}
		return sml_home_owner_delete_error( 'sml_home_missing_chart', 'That Chart post no longer exists.', 404 );
	}

	function sml_home_owner_delete_stream_post( $item_id, $user_id ) {
		if ( ! preg_match( '/^stream-(\d+)$/', $item_id, $match ) ) {
			return sml_home_owner_delete_error( 'sml_home_bad_stream_id', 'That market post identifier is invalid.', 400 );
		}
		$comment_id = absint( $match[1] );
		$comment    = get_comment( $comment_id );
		if ( ! $comment ) {
			return sml_home_owner_delete_error( 'sml_home_missing_stream', 'That market post no longer exists.', 404 );
		}
		$author_id = (int) $comment->user_id;
		if ( function_exists( 'sml_members_parse_stream_comment' ) ) {
			$parsed = sml_members_parse_stream_comment( $comment );
			if ( is_array( $parsed ) ) { $author_id = absint( $parsed['user_id'] ?? $author_id ); }
		}
		if ( $author_id !== (int) $user_id && ! current_user_can( 'manage_options' ) ) {
			return sml_home_owner_delete_error( 'sml_home_not_owner', 'You can only delete content you own.', 403 );
		}
		if ( ! wp_delete_comment( $comment_id, true ) ) {
			return sml_home_owner_delete_error( 'sml_home_delete_failed', 'The market post could not be deleted.', 500 );
		}
		return array( 'deleted' => true, 'type' => 'stream', 'id' => $comment_id );
	}

	function sml_home_owner_delete_content( WP_REST_Request $request ) {
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return sml_home_owner_delete_error( 'sml_home_sign_in', 'Sign in to delete your content.', 401 );
		}
		$item_id = sanitize_text_field( (string) $request->get_param( 'item_id' ) );
		if ( preg_match( '/^wp-(\d+)$/', $item_id, $match ) ) {
			$result = sml_home_owner_delete_wp_post( absint( $match[1] ), $user_id );
		} elseif ( 0 === strpos( $item_id, 'chart-' ) ) {
			$result = sml_home_owner_delete_chart_post( $item_id, $user_id );
		} elseif ( 0 === strpos( $item_id, 'stream-' ) ) {
			$result = sml_home_owner_delete_stream_post( $item_id, $user_id );
		} else {
			$result = sml_home_owner_delete_error( 'sml_home_bad_item', 'This feed item cannot be deleted here.', 400 );
		}
		if ( is_wp_error( $result ) ) { return $result; }
		$response = rest_ensure_response( $result );
		$response->header( 'Cache-Control', 'private, no-store' );
		return $response;
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-home-owner/v1', '/content', array(
			'methods'             => WP_REST_Server::DELETABLE,
			'callback'            => 'sml_home_owner_delete_content',
			'permission_callback' => 'is_user_logged_in',
			'args'                => array(
				'item_id' => array( 'required' => true, 'type' => 'string' ),
			),
		) );
	} );
}
