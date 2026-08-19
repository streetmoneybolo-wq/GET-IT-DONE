/**
 * SML Live chat — Loop Channel moderation carry-over.
 * WPCode: PHP Snippet / Auto Insert / Run Everywhere. ROLLBACK: deactivate (owns no data).
 *
 * The creator's moderation rules (Channel Studio → sml_channel_settings.moderation:
 * banned words, banned link patterns, mods) already apply to channel chat and
 * community posts (snippet #7107). This carries the SAME rules into the live-stream
 * chat room: POST /sml-live-chat/v1/room/{room}/messages is checked BEFORE the
 * live-chat plugin stores the message. The room id is the streamer's profile
 * handle (js/live-watch.js ?s=handle → sml-live/v1/feeds/{handle}), resolved with
 * the channel API's own profile-handle lookup. Creator + listed mods are exempt.
 *
 * WPCode rules (see wpcode-merged-eval-trap): no top-level return/exit, no
 * base64-decode / eval / ini-set / error-reporting calls anywhere in this file.
 */
if ( ! function_exists( 'sml_lcm_owner_for_room' ) ) {
	function sml_lcm_owner_for_room( $room ) {
		$room = strtolower( trim( (string) $room ) );
		if ( '' === $room ) { return 0; }
		$uid = 0;
		if ( function_exists( 'sml_channel_profile_handle_owner' ) ) {
			$u = sml_channel_profile_handle_owner( $room );
			if ( $u && ! empty( $u->ID ) ) { $uid = (int) $u->ID; }
		}
		if ( ! $uid ) {
			$q = new WP_User_Query( array( 'number' => 1, 'count_total' => false, 'meta_key' => 'sml_public_handle', 'meta_value' => $room, 'fields' => 'ID' ) );
			$r = $q->get_results();
			if ( ! empty( $r[0] ) ) { $uid = (int) $r[0]; }
		}
		if ( ! $uid ) {
			$u = get_user_by( 'slug', $room );
			if ( ! $u ) { $u = get_user_by( 'login', $room ); }
			if ( $u ) { $uid = (int) $u->ID; }
		}
		return $uid;
	}

	function sml_lcm_pre_dispatch( $result, $server, $request ) {
		if ( null !== $result || ! ( $request instanceof WP_REST_Request ) ) { return $result; }
		if ( 'POST' !== strtoupper( (string) $request->get_method() ) ) { return $result; }
		$route = (string) $request->get_route();
		if ( ! preg_match( '#^/sml-live-chat/v1/room/([A-Za-z0-9_-]+)/messages/?$#', $route, $m ) ) { return $result; }
		if ( ! function_exists( 'sml_channel_mod_check' ) ) { return $result; } /* channel API (#7107) not active → nothing to enforce */
		$owner = sml_lcm_owner_for_room( $m[1] );
		if ( ! $owner ) { return $result; }
		$uid = get_current_user_id();
		if ( $uid && function_exists( 'sml_channel_is_mod' ) && sml_channel_is_mod( $owner, $uid ) ) { return $result; } /* creator + mods exempt */
		$text = '';
		foreach ( array( 'message', 'text', 'body', 'content' ) as $k ) {
			$v = $request->get_param( $k );
			if ( is_string( $v ) && '' !== trim( $v ) ) { $text = $v; break; }
		}
		if ( '' === $text ) { return $result; }
		$why = sml_channel_mod_check( $owner, $text );
		if ( '' !== (string) $why ) {
			return new WP_Error( 'sml_chat_blocked', (string) $why, array( 'status' => 403 ) );
		}
		return $result;
	}
	add_filter( 'rest_pre_dispatch', 'sml_lcm_pre_dispatch', 10, 3 );
}
