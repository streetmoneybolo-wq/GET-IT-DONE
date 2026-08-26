/**
 * SML Profile Photo — member avatar upload + site-wide avatar override.
 *
 * Members could not change their profile image anywhere: every surface calls
 * get_avatar/get_avatar_url, which resolves to Gravatar, and nothing on the
 * site ever wrote `sml_avatar_url` (only the SML News migration did). This
 * snippet closes that gap:
 *
 *   GET    /wp-json/sml-avatar/v1/me   current avatar {avatar, custom}
 *   POST   /wp-json/sml-avatar/v1/me   set it — multipart `file` (jpeg/png/
 *                                      webp/gif ≤ 8MB), or {attachment_id} of
 *                                      an image the caller owns (admins may
 *                                      pass any), or admin-only {url} restore
 *   DELETE /wp-json/sml-avatar/v1/me   remove override (back to Gravatar)
 *
 * plus a `pre_get_avatar_data` filter so a stored `sml_avatar_url` wins over
 * Gravatar EVERYWHERE (feed identity cards already read the same meta first).
 * The uploader UI is js/profile-photo.js, injected only on /customize-profile/
 * via the commit-pinned CDN (resolver-aware, like every other loader).
 *
 * Auth: logged-in users, self-service only (the route always acts on the
 * CURRENT user). Uploads are sideloaded server-side so subscribers without
 * the upload_files capability can still set a photo; type and size are
 * validated here regardless of what the client claims.
 * Rollback: deactivate this snippet — avatars fall back to Gravatar, the UI
 * card disappears, stored metas stay harmless.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_av_user_from_ref' ) ) {

	/* resolve the many shapes get_avatar accepts into a user id (0 = unknown) */
	function sml_av_user_from_ref( $ref ) {
		if ( is_numeric( $ref ) ) { return absint( $ref ); }
		if ( $ref instanceof WP_User ) { return (int) $ref->ID; }
		if ( $ref instanceof WP_Post ) { return (int) $ref->post_author; }
		if ( $ref instanceof WP_Comment ) {
			/* guest comments (user_id 0) keep Gravatar: resolving their unverified
			   email would let an impostor wear a member's photo AND issue an
			   uncached users-table lookup per guest comment */
			return (int) $ref->user_id;
		}
		if ( is_string( $ref ) && is_email( $ref ) ) {
			$user = get_user_by( 'email', $ref );
			return $user ? (int) $user->ID : 0;
		}
		return 0;
	}

	/* site-wide override: a member's uploaded photo beats Gravatar everywhere */
	add_filter( 'pre_get_avatar_data', static function ( $args, $id_or_email ) {
		$uid = sml_av_user_from_ref( $id_or_email );
		if ( ! $uid ) { return $args; }
		$url = (string) get_user_meta( $uid, 'sml_avatar_url', true );
		if ( '' === $url ) { return $args; }
		$args['url']          = $url;
		$args['found_avatar'] = true;
		return $args;
	}, 10, 2 );

	function sml_av_state( $uid ) {
		$url = (string) get_user_meta( $uid, 'sml_avatar_url', true );
		return array(
			'ok'     => true,
			'custom' => '' !== $url,
			'avatar' => '' !== $url ? $url : get_avatar_url( $uid, array( 'size' => 192 ) ),
		);
	}

	/* delete a superseded avatar file — but ONLY one this flow created for this
	   same user (tagged _sml_avatar_for). Referenced library images (e.g. the
	   SML News artwork) never carry the tag and can never be reaped. */
	function sml_av_reap( $uid, $old_id, $keep_id ) {
		$old_id = absint( $old_id );
		if ( ! $old_id || $old_id === absint( $keep_id ) ) { return; }
		if ( absint( get_post_meta( $old_id, '_sml_avatar_for', true ) ) === (int) $uid ) {
			wp_delete_attachment( $old_id, true );
		}
	}

	function sml_av_apply( $uid, $url, $attachment_id ) {
		$attachment_id = absint( $attachment_id );
		$old = absint( get_user_meta( $uid, 'sml_avatar_attachment_id', true ) );
		update_user_meta( $uid, 'sml_avatar_url', esc_url_raw( $url ) );
		if ( $attachment_id ) { update_user_meta( $uid, 'sml_avatar_attachment_id', $attachment_id ); }
		else { delete_user_meta( $uid, 'sml_avatar_attachment_id' ); } // stale id must never point at someone else's file
		sml_av_reap( $uid, $old, $attachment_id );
		return sml_av_state( $uid );
	}

	function sml_av_handle_upload( $uid ) {
		if ( empty( $_FILES['file'] ) || ! is_array( $_FILES['file'] ) ) { return null; }
		/* cheap per-user throttle: a photo is not something you change 6× in 10 min */
		$tkey = 'sml_av_rate_' . $uid;
		$hits = (int) get_transient( $tkey );
		if ( $hits >= 5 ) {
			return new WP_Error( 'sml_av_rate', 'Too many photo changes — try again in a few minutes.', array( 'status' => 429 ) );
		}
		set_transient( $tkey, $hits + 1, 600 );
		$file = $_FILES['file'];
		if ( ! empty( $file['error'] ) ) {
			return new WP_Error( 'sml_av_upload', 'The upload did not arrive intact — try again.', array( 'status' => 400 ) );
		}
		if ( (int) $file['size'] > 8 * 1024 * 1024 ) {
			return new WP_Error( 'sml_av_size', 'Profile photos can be at most 8 MB.', array( 'status' => 413 ) );
		}
		$check = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'] );
		$allowed = array( 'image/jpeg', 'image/png', 'image/webp', 'image/gif' );
		if ( empty( $check['type'] ) || ! in_array( $check['type'], $allowed, true ) ) {
			return new WP_Error( 'sml_av_type', 'Use a JPEG, PNG, WebP, or GIF image.', array( 'status' => 415 ) );
		}
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		$moved = wp_handle_sideload( $file, array( 'test_form' => false, 'mimes' => array(
			'jpg|jpeg|jpe' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif',
		) ) );
		if ( ! is_array( $moved ) || empty( $moved['file'] ) || ! empty( $moved['error'] ) ) {
			return new WP_Error( 'sml_av_move', 'The image could not be stored — try again.', array( 'status' => 500 ) );
		}
		/* content sniff on the stored bytes: the extension check above keeps the
		   extension honest, but unidentifiable bytes named .jpg would pass it */
		$real = function_exists( 'wp_get_image_mime' ) ? wp_get_image_mime( $moved['file'] ) : $moved['type'];
		if ( ! in_array( $real, $allowed, true ) ) {
			@unlink( $moved['file'] );
			return new WP_Error( 'sml_av_type', 'Use a JPEG, PNG, WebP, or GIF image.', array( 'status' => 415 ) );
		}
		$att_id = wp_insert_attachment( array(
			'post_mime_type' => $moved['type'],
			'post_title'     => 'Profile photo — user ' . $uid,
			'post_status'    => 'inherit',
			'post_author'    => $uid,
		), $moved['file'] );
		if ( is_wp_error( $att_id ) || ! $att_id ) {
			@unlink( $moved['file'] );
			return new WP_Error( 'sml_av_attach', 'The image could not be registered — try again.', array( 'status' => 500 ) );
		}
		update_post_meta( $att_id, '_sml_avatar_for', $uid ); // reap-eligible: created BY this flow FOR this user
		wp_update_attachment_metadata( $att_id, wp_generate_attachment_metadata( $att_id, $moved['file'] ) );
		/* GIF keeps the original file — the medium intermediate is single-frame.
		   Key off the SNIFFED type too: a real GIF named .png must not freeze. */
		$sized = ( 'image/gif' === $real || 'image/gif' === $moved['type'] ) ? false : image_downsize( $att_id, 'medium' );
		$url   = is_array( $sized ) && ! empty( $sized[0] ) ? $sized[0] : $moved['url'];
		return sml_av_apply( $uid, $url, $att_id );
	}

	function sml_av_route( WP_REST_Request $request ) {
		$uid = get_current_user_id();
		if ( ! $uid ) { return new WP_Error( 'sml_av_auth', 'Sign in to change your profile photo.', array( 'status' => 401 ) ); }
		$method = $request->get_method();
		$result = null;

		if ( 'DELETE' === $method ) {
			$old = absint( get_user_meta( $uid, 'sml_avatar_attachment_id', true ) );
			delete_user_meta( $uid, 'sml_avatar_url' );
			delete_user_meta( $uid, 'sml_avatar_attachment_id' );
			sml_av_reap( $uid, $old, 0 );
			$result = sml_av_state( $uid );
		} elseif ( 'POST' === $method ) {
			$result = sml_av_handle_upload( $uid );
			if ( null === $result ) {
				$att = absint( $request->get_param( 'attachment_id' ) );
				$raw = (string) $request->get_param( 'url' );
				if ( $att ) {
					$post = get_post( $att );
					/* not-owned answers exactly like not-found — no existence oracle */
					if ( ! $post || 'attachment' !== $post->post_type || 0 !== strpos( (string) $post->post_mime_type, 'image/' )
						|| ( (int) $post->post_author !== $uid && ! current_user_can( 'manage_options' ) ) ) {
						$result = new WP_Error( 'sml_av_missing', 'That image could not be found.', array( 'status' => 404 ) );
					} else {
						$sized  = image_downsize( $att, 'medium' );
						$url    = is_array( $sized ) && ! empty( $sized[0] ) ? $sized[0] : wp_get_attachment_url( $att );
						$result = sml_av_apply( $uid, $url, $att );
					}
				} elseif ( '' !== $raw && current_user_can( 'manage_options' ) ) {
					/* admin-only escape hatch: restore a known-good URL verbatim */
					$result = sml_av_apply( $uid, $raw, 0 );
				} else {
					$result = new WP_Error( 'sml_av_input', 'Attach an image file to change your photo.', array( 'status' => 400 ) );
				}
			}
		} else {
			$result = sml_av_state( $uid );
		}

		if ( is_wp_error( $result ) ) { return $result; }
		$response = rest_ensure_response( $result );
		$response->header( 'Cache-Control', 'private, no-store' );
		return $response;
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-avatar/v1', '/me', array(
			'methods'             => 'GET, POST, DELETE',
			'callback'            => 'sml_av_route',
			'permission_callback' => 'is_user_logged_in',
		) );
	} );

	/* uploader UI — only on the customize-profile page, via commit-pinned CDN */
	add_action( 'wp_footer', static function () {
		if ( ! is_user_logged_in() ) { return; }
		$path = trim( (string) parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
		if ( 'customize-profile' !== $path ) { return; }
		/* fail closed: without the commit-pinning resolver, load no UI at all —
		   never fall back to @main on a page that holds a live REST nonce */
		if ( ! function_exists( 'sml_cdn_resolve_ref' ) ) { return; }
		$ref = sml_cdn_resolve_ref();
		$cfg  = array( 'nonce' => wp_create_nonce( 'wp_rest' ), 'endpoint' => '/wp-json/sml-avatar/v1/me' );
		echo '<script id="sml-avatar-cfg">window.SML_AVATAR=' . wp_json_encode( $cfg ) . ';</script>';
		echo '<script id="sml-avatar-js" src="https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . esc_attr( $ref ) . '/js/profile-photo.js"></script>';
	}, 20 );
}
