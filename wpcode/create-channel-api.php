/**
 * SML Create Channel — API for the /create-channel/ page (design: "Create Loop
 * Channel"). Route base: /wp-json/sml-create-channel/v1
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere. Requires the Loop
 * Channel data API snippet (sml-channel/v1, handle namespace) to be active —
 * handle availability + the claim itself go through it via internal REST
 * dispatch so there is exactly one source of truth for handle rules.
 *
 * DECISION 2026-08-18: creation collects ONLY a code-verified email, channel
 * name, handle, about, links and agreements. No name/DOB/phone/city/state here
 * (that belongs to a future monetization Settings/KYC screen).
 *
 * Owns (user meta): sml_cg_email_verified / _at (email code verification),
 * sml_channel_name / _tagline / _about / _links / _avatar_id / _banner_id,
 * sml_channel_terms_at / sml_channel_created_at. Nothing else.
 * ROLLBACK: deactivate this snippet.
 */
if ( ! function_exists( 'sml_cc_uid' ) ) {

	function sml_cc_uid() { return get_current_user_id(); }
	function sml_cc_err( $code, $msg, $status ) { return new WP_Error( $code, $msg, array( 'status' => $status ) ); }

	function sml_cc_clean_handle( $h ) {
		if ( function_exists( 'sml_channel_clean_handle' ) ) { return sml_channel_clean_handle( $h ); }
		$h = strtolower( ltrim( sanitize_text_field( (string) $h ), '@' ) );
		return substr( preg_replace( '/[^a-z0-9_.]/', '', $h ), 0, 30 );
	}
	function sml_cc_media_url( $id ) {
		$id = (int) $id; if ( ! $id ) { return ''; }
		$u = wp_get_attachment_image_url( $id, 'large' );
		return $u ? $u : (string) wp_get_attachment_url( $id );
	}
	function sml_cc_internal( $method, $route, $params ) {
		$req = new WP_REST_Request( $method, $route );
		foreach ( $params as $k => $v ) { $req->set_param( $k, $v ); }
		if ( 'POST' === $method ) { $req->set_header( 'Content-Type', 'application/json' ); }
		$res = rest_do_request( $req );
		if ( is_wp_error( $res ) ) { return $res; }
		$data = (array) $res->get_data();
		if ( $res->get_status() >= 400 ) {
			$msg = isset( $data['message'] ) ? (string) $data['message'] : 'The request was rejected.';
			return sml_cc_err( isset( $data['code'] ) ? (string) $data['code'] : 'sml_cc_upstream', $msg, (int) $res->get_status() );
		}
		return $data;
	}

	/* ---------- GET /state ---------- */
	function sml_cc_rest_state( WP_REST_Request $request ) {
		$uid = sml_cc_uid();
		if ( ! $uid ) { return sml_cc_err( 'sml_cc_login_required', 'Sign in required.', 401 ); }
		$user = wp_get_current_user();
		$verified = (string) get_user_meta( $uid, 'sml_cg_email_verified', true );
		$handle = sml_cc_clean_handle( get_user_meta( $uid, 'sml_channel_handle', true ) );
		$links = get_user_meta( $uid, 'sml_channel_links', true );
		return rest_ensure_response( array(
			// prefill only — still must be verified by code before creating
			'email'         => $verified ?: (string) $user->user_email,
			'verifiedEmail' => $verified,
			'hasChannel'    => '' !== $handle,
			'channelHandle' => $handle,
			'channelUrl'    => '' !== $handle ? home_url( '/channel/' . rawurlencode( $handle ) . '/' ) : '',
			'displayName'   => (string) $user->display_name,
			'channel'       => array(
				'name'    => (string) get_user_meta( $uid, 'sml_channel_name', true ),
				'tagline' => (string) get_user_meta( $uid, 'sml_channel_tagline', true ),
				'about'   => (string) get_user_meta( $uid, 'sml_channel_about', true ),
				'links'   => is_array( $links ) ? $links : array(),
				'avatar'  => sml_cc_media_url( get_user_meta( $uid, 'sml_channel_avatar_id', true ) ),
				'banner'  => sml_cc_media_url( get_user_meta( $uid, 'sml_channel_banner_id', true ) ),
			),
			'next'          => home_url( '/go-live/' ),
		) );
	}

	/* ---------- POST /email-code  {email} ---------- */
	function sml_cc_rest_email_code( WP_REST_Request $request ) {
		$uid = sml_cc_uid();
		if ( ! $uid ) { return sml_cc_err( 'sml_cc_login_required', 'Sign in required.', 401 ); }
		$email = strtolower( sanitize_email( (string) $request->get_param( 'email' ) ) );
		if ( ! is_email( $email ) ) { return sml_cc_err( 'sml_cc_bad_email', 'Enter a valid email address.', 400 ); }
		if ( get_transient( 'sml_cc_esend_' . $uid ) ) { return sml_cc_err( 'sml_cc_too_soon', 'A code was just sent — wait a minute before requesting another.', 429 ); }
		try { $code = str_pad( (string) random_int( 0, 999999 ), 6, '0', STR_PAD_LEFT ); }
		catch ( Exception $e ) { $code = str_pad( (string) wp_rand( 0, 999999 ), 6, '0', STR_PAD_LEFT ); }
		$subject = 'Your StockMarketLoop verification code';
		$body = "Your StockMarketLoop verification code is: {$code}\n\nEnter it on the Create your Loop Channel page. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.";
		$sent = wp_mail( $email, $subject, $body );
		if ( ! $sent ) { return sml_cc_err( 'sml_cc_mail_failed', 'We could not send the code email right now. Try again in a moment.', 502 ); }
		set_transient( 'sml_cc_ecode_' . $uid, array( 'hash' => wp_hash_password( $code ), 'email' => $email, 'attempts' => 0 ), 10 * MINUTE_IN_SECONDS );
		set_transient( 'sml_cc_esend_' . $uid, 1, MINUTE_IN_SECONDS );
		return rest_ensure_response( array( 'sent' => true, 'email' => $email, 'expiresIn' => 600 ) );
	}

	/* ---------- POST /email-verify  {email, code} ---------- */
	function sml_cc_rest_email_verify( WP_REST_Request $request ) {
		$uid = sml_cc_uid();
		if ( ! $uid ) { return sml_cc_err( 'sml_cc_login_required', 'Sign in required.', 401 ); }
		$email = strtolower( sanitize_email( (string) $request->get_param( 'email' ) ) );
		$code = preg_replace( '/\D/', '', (string) $request->get_param( 'code' ) );
		$rec = get_transient( 'sml_cc_ecode_' . $uid );
		if ( ! is_array( $rec ) || empty( $rec['hash'] ) ) { return sml_cc_err( 'sml_cc_no_code', 'That code has expired — send a new one.', 400 ); }
		if ( $rec['email'] !== $email ) { return sml_cc_err( 'sml_cc_email_changed', 'The email changed since the code was sent — send a new code.', 400 ); }
		if ( (int) $rec['attempts'] >= 5 ) { delete_transient( 'sml_cc_ecode_' . $uid ); return sml_cc_err( 'sml_cc_too_many', 'Too many attempts — send a new code.', 429 ); }
		if ( 6 !== strlen( $code ) || ! wp_check_password( $code, $rec['hash'] ) ) {
			$rec['attempts'] = (int) $rec['attempts'] + 1;
			set_transient( 'sml_cc_ecode_' . $uid, $rec, 10 * MINUTE_IN_SECONDS );
			return sml_cc_err( 'sml_cc_code_mismatch', "That code doesn't match — check the email and try again.", 400 );
		}
		delete_transient( 'sml_cc_ecode_' . $uid );
		update_user_meta( $uid, 'sml_cg_email_verified', $email );
		update_user_meta( $uid, 'sml_cg_email_verified_at', gmdate( 'c' ) );
		return rest_ensure_response( array( 'verified' => true, 'email' => $email ) );
	}

	/* ---------- POST /media  multipart {file, kind=avatar|banner} ---------- */
	function sml_cc_rest_media( WP_REST_Request $request ) {
		$uid = sml_cc_uid();
		if ( ! $uid ) { return sml_cc_err( 'sml_cc_login_required', 'Sign in required.', 401 ); }
		$kind = (string) $request->get_param( 'kind' );
		if ( ! in_array( $kind, array( 'avatar', 'banner' ), true ) ) { return sml_cc_err( 'sml_cc_bad_kind', 'Unknown image slot.', 400 ); }
		$files = $request->get_file_params();
		if ( empty( $files['file'] ) || empty( $files['file']['tmp_name'] ) ) { return sml_cc_err( 'sml_cc_no_file', 'Choose an image to upload.', 400 ); }
		$f = $files['file'];
		if ( ! empty( $f['error'] ) ) { return sml_cc_err( 'sml_cc_upload_error', 'The upload failed — try a smaller image.', 400 ); }
		if ( (int) $f['size'] > 4 * MB_IN_BYTES ) { return sml_cc_err( 'sml_cc_too_big', 'Images must be 4 MB or smaller.', 400 ); }
		$check = wp_check_filetype_and_ext( $f['tmp_name'], $f['name'], array( 'jpg|jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp' ) );
		if ( empty( $check['type'] ) ) { return sml_cc_err( 'sml_cc_bad_type', 'Use a PNG, JPG or WebP image.', 400 ); }
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$_FILES['file'] = $f;
		$id = media_handle_upload( 'file', 0, array( 'post_title' => 'Loop Channel ' . $kind ), array( 'test_form' => false, 'mimes' => array( 'jpg|jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp' ) ) );
		if ( is_wp_error( $id ) ) { return sml_cc_err( 'sml_cc_upload_failed', 'Upload failed: ' . $id->get_error_message(), 500 ); }
		wp_update_post( array( 'ID' => (int) $id, 'post_author' => $uid ) );
		update_user_meta( $uid, 'sml_channel_' . $kind . '_id', (int) $id );
		return rest_ensure_response( array( 'ok' => true, 'kind' => $kind, 'id' => (int) $id, 'url' => sml_cc_media_url( $id ) ) );
	}

	/* ---------- POST /create ---------- */
	function sml_cc_rest_create( WP_REST_Request $request ) {
		$uid = sml_cc_uid();
		if ( ! $uid ) { return sml_cc_err( 'sml_cc_login_required', 'Sign in required.', 401 ); }
		$existing = sml_cc_clean_handle( get_user_meta( $uid, 'sml_channel_handle', true ) );
		if ( '' !== $existing ) {
			return rest_ensure_response( array( 'ok' => true, 'already' => true, 'handle' => $existing, 'url' => home_url( '/channel/' . rawurlencode( $existing ) . '/' ), 'next' => home_url( '/go-live/' ) ) );
		}
		if ( ! $request->get_param( 'agreeTerms' ) || ! $request->get_param( 'agreeDisclaimer' ) ) {
			return sml_cc_err( 'sml_cc_agreements', 'Accept the Creator Terms and the disclaimer to continue.', 400 );
		}
		$email = strtolower( sanitize_email( (string) $request->get_param( 'email' ) ) );
		$verified = strtolower( (string) get_user_meta( $uid, 'sml_cg_email_verified', true ) );
		if ( ! is_email( $email ) || '' === $verified || $verified !== $email ) {
			return sml_cc_err( 'sml_cc_email_unverified', 'Verify your email with the code we sent before creating your channel.', 400 );
		}
		$channel_name = sanitize_text_field( (string) $request->get_param( 'channelName' ) );
		if ( mb_strlen( $channel_name ) < 2 || mb_strlen( $channel_name ) > 60 ) { return sml_cc_err( 'sml_cc_bad_channel_name', 'Enter a channel name (2–60 characters).', 400 ); }
		$about = sanitize_textarea_field( (string) $request->get_param( 'about' ) );
		if ( '' === trim( $about ) ) { return sml_cc_err( 'sml_cc_bad_about', 'Tell people what your channel is about.', 400 ); }
		if ( mb_strlen( $about ) > 280 ) { $about = mb_substr( $about, 0, 280 ); }
		$tagline = mb_substr( sanitize_text_field( (string) $request->get_param( 'tagline' ) ), 0, 120 );
		$raw_links = (array) $request->get_param( 'links' );
		$links = array();
		foreach ( array( 'site', 'x', 'youtube' ) as $k ) {
			$v = isset( $raw_links[ $k ] ) ? trim( (string) $raw_links[ $k ] ) : '';
			if ( '' === $v ) { continue; }
			if ( preg_match( '#^https?://#i', $v ) ) { $v = esc_url_raw( $v, array( 'http', 'https' ) ); if ( '' === $v ) { continue; } }
			else { $v = mb_substr( sanitize_text_field( $v ), 0, 120 ); }
			$links[ $k ] = $v;
		}
		$handle = sml_cc_clean_handle( $request->get_param( 'handle' ) );
		if ( strlen( $handle ) < 3 ) { return sml_cc_err( 'sml_cc_bad_handle', 'Pick a handle: letters, numbers, underscores or periods, at least 3 characters.', 400 ); }

		// 1) availability first (no writes yet) — the channel API is the authority
		$avail = sml_cc_internal( 'GET', '/sml-channel/v1/handle-availability', array( 'handle' => $handle ) );
		if ( is_wp_error( $avail ) ) { return $avail; }
		$is_avail = isset( $avail['available'] ) ? (bool) $avail['available'] : ( isset( $avail['is_available'] ) ? (bool) $avail['is_available'] : false );
		if ( ! $is_avail ) { return sml_cc_err( 'sml_cc_handle_taken', '@' . $handle . ' is taken. Try another.', 409 ); }

		// 2) claim the handle through the channel API (namespace rules live there)
		$saved = sml_cc_internal( 'POST', '/sml-channel/v1/handle', array( 'handle' => $handle ) );
		if ( is_wp_error( $saved ) ) { return $saved; }

		// 3) channel profile (new fields this page introduces)
		update_user_meta( $uid, 'sml_channel_name', $channel_name );
		update_user_meta( $uid, 'sml_channel_tagline', $tagline );
		update_user_meta( $uid, 'sml_channel_about', $about );
		update_user_meta( $uid, 'sml_channel_links', $links );
		update_user_meta( $uid, 'sml_channel_terms_at', gmdate( 'c' ) );
		update_user_meta( $uid, 'sml_channel_created_at', gmdate( 'c' ) );

		$url = isset( $saved['url'] ) && $saved['url'] ? (string) $saved['url'] : home_url( '/channel/' . rawurlencode( $handle ) . '/' );
		return rest_ensure_response( array( 'ok' => true, 'handle' => $handle, 'url' => $url, 'next' => home_url( '/go-live/' ) ) );
	}

	add_action( 'rest_api_init', static function () {
		$ns = 'sml-create-channel/v1';
		register_rest_route( $ns, '/state', array( 'methods' => WP_REST_Server::READABLE, 'callback' => 'sml_cc_rest_state', 'permission_callback' => 'is_user_logged_in' ) );
		register_rest_route( $ns, '/email-code', array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => 'sml_cc_rest_email_code', 'permission_callback' => 'is_user_logged_in' ) );
		register_rest_route( $ns, '/email-verify', array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => 'sml_cc_rest_email_verify', 'permission_callback' => 'is_user_logged_in' ) );
		register_rest_route( $ns, '/media', array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => 'sml_cc_rest_media', 'permission_callback' => 'is_user_logged_in' ) );
		register_rest_route( $ns, '/create', array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => 'sml_cc_rest_create', 'permission_callback' => 'is_user_logged_in' ) );
	} );
	add_filter( 'rest_post_dispatch', static function ( $response, $server, $request ) {
		if ( 0 === strpos( $request->get_route(), '/sml-create-channel/v1/' ) ) {
			$response = rest_ensure_response( $response );
			$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
		}
		return $response;
	}, 10, 3 );
}
