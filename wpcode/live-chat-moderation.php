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
 * Also adds mod tools the live-chat plugin lacks: GET sml-lcm/v1/room/{room}/me and
 * DELETE sml-lcm/v1/room/{room}/message/{id} (author / creator / channel mod).
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

	/* ---- mod tools on top of the live-chat plugin (its table: {prefix}sml_live_chat_messages,
	   room_key = 'room-' . sanitize_key(room); it only exposes GET/POST) ----
	   GET    /sml-lcm/v1/room/{room}/me            → who am I in this room (creator / mod / member)
	   DELETE /sml-lcm/v1/room/{room}/message/{id}  → author, creator or a channel mod removes a message */
	function sml_lcm_can_moderate( $owner, $uid ) {
		if ( ! $owner || ! $uid ) { return false; }
		if ( (int) $owner === (int) $uid ) { return true; }
		return function_exists( 'sml_channel_is_mod' ) ? (bool) sml_channel_is_mod( $owner, $uid ) : false;
	}
	function sml_lcm_rest_me( WP_REST_Request $r ) {
		$uid   = get_current_user_id();
		$owner = sml_lcm_owner_for_room( $r['room'] );
		return rest_ensure_response( array(
			'uid'          => (int) $uid,
			'owner_uid'    => (int) $owner,
			'is_creator'   => (bool) ( $uid && $owner && (int) $uid === (int) $owner ),
			'can_moderate' => (bool) sml_lcm_can_moderate( $owner, $uid ),
		) );
	}
	function sml_lcm_rest_delete( WP_REST_Request $r ) {
		global $wpdb;
		$uid = get_current_user_id();
		if ( ! $uid ) { return new WP_Error( 'sml_login_required', 'Sign in first.', array( 'status' => 401 ) ); }
		$table = $wpdb->prefix . 'sml_live_chat_messages';
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
			return new WP_Error( 'sml_chat_store_unknown', 'Live chat storage is not available.', array( 'status' => 501 ) );
		}
		$id   = absint( $r['id'] );
		$room = sanitize_key( (string) $r['room'] );
		$keys = array_values( array_unique( array( substr( 'room-' . $room, 0, 190 ), $room, (string) $r['room'] ) ) );
		$ph   = implode( ',', array_fill( 0, count( $keys ), '%s' ) );
		$row  = $wpdb->get_row( $wpdb->prepare( "SELECT id, user_id, room_key FROM {$table} WHERE id = %d AND room_key IN ({$ph}) LIMIT 1", array_merge( array( $id ), $keys ) ) );
		if ( ! $row ) { return new WP_Error( 'sml_chat_not_found', 'That message is gone already.', array( 'status' => 404 ) ); }
		$owner = sml_lcm_owner_for_room( $r['room'] );
		if ( (int) $row->user_id !== (int) $uid && ! sml_lcm_can_moderate( $owner, $uid ) ) {
			return new WP_Error( 'sml_chat_forbidden', 'Only the author, the creator or a channel mod can remove this.', array( 'status' => 403 ) );
		}
		$ok = $wpdb->delete( $table, array( 'id' => (int) $row->id ), array( '%d' ) );
		if ( false === $ok ) { return new WP_Error( 'sml_chat_delete_failed', 'Could not remove the message.', array( 'status' => 500 ) ); }
		return rest_ensure_response( array( 'deleted' => true, 'id' => (int) $row->id ) );
	}
	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-lcm/v1', '/room/(?P<room>[A-Za-z0-9_-]+)/me', array(
			'methods' => 'GET', 'callback' => 'sml_lcm_rest_me', 'permission_callback' => '__return_true',
		) );
		register_rest_route( 'sml-lcm/v1', '/room/(?P<room>[A-Za-z0-9_-]+)/message/(?P<id>\d+)', array(
			'methods' => 'DELETE', 'callback' => 'sml_lcm_rest_delete', 'permission_callback' => 'is_user_logged_in',
		) );
	} );
}
