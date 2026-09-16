/**
 * SML Meet Traders — opt-in trader networking directory (self-contained).
 *
 * A TRANSPARENT, consent-first way for members to find and connect with other
 * traders. Nobody is listed or shown to anyone until they explicitly opt in, and:
 *   - opt-in is OFF by default and requires an 18+ attestation
 *   - only opted-in, 18+ members are ever returned; minors are never listed
 *   - location is city-level only and only if the member chooses to share it
 *   - viewers can block; blocked pairs never see each other (both directions)
 * No romantic/relationship logic, no "match %", no precise location.
 *
 * Routes (all auth-only):
 *   GET  /wp-json/sml-meet/v1/prefs                      -> { optin, adult, bio, city }
 *   POST /wp-json/sml-meet/v1/prefs {optin,adult,bio,city}
 *   GET  /wp-json/sml-meet/v1/directory?city=&limit=&offset=
 *        -> { items:[ {user_id,name,avatar,profile_url,bio,city,mutual_groups,follows_you,following} ], total, has_more }
 *   POST /wp-json/sml-meet/v1/block {user_id, action:"block"|"unblock"}
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. Guarded functions, no
 * dynamic-code calls, no top-level return. Kill switch: deactivate the snippet.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! function_exists( 'sml_meet_idset' ) ) {

	/** A raw usermeta value (id-array or CSV) as an O(1) set { id => true }. */
	function sml_meet_parse_ids( $raw ) {
		if ( is_string( $raw ) && '' !== $raw ) { $raw = array_map( 'trim', explode( ',', $raw ) ); }
		$out = array();
		if ( is_array( $raw ) ) {
			foreach ( $raw as $v ) { $v = absint( $v ); if ( $v > 0 ) { $out[ $v ] = true; } }
		}
		return $out;
	}

	/** usermeta id-array (or CSV) as an O(1) set { id => true }. */
	function sml_meet_idset( $uid, $key ) {
		return sml_meet_parse_ids( get_user_meta( (int) $uid, $key, true ) );
	}

	/**
	 * Of the given candidate ids, which ones have blocked $viewer — in ONE query.
	 * Avoids an O(N) get_user_meta() call per candidate on every directory load.
	 * Returns { candidate_id => true } for candidates whose blocklist contains $viewer.
	 */
	function sml_meet_blockers_of( $cand_ids, $viewer ) {
		global $wpdb;
		$cand_ids = array_values( array_filter( array_map( 'absint', (array) $cand_ids ) ) );
		if ( empty( $cand_ids ) ) { return array(); }
		$viewer = (int) $viewer;
		$in   = implode( ',', array_fill( 0, count( $cand_ids ), '%d' ) );
		$sql  = "SELECT user_id, meta_value FROM {$wpdb->usermeta} WHERE meta_key='sml_meet_blocked' AND user_id IN ({$in})";
		$rows = $wpdb->get_results( $wpdb->prepare( $sql, $cand_ids ) ); // fixed key; ids bound
		$out  = array();
		if ( is_array( $rows ) ) {
			foreach ( $rows as $r ) {
				$set = sml_meet_parse_ids( $r->meta_value );
				if ( isset( $set[ $viewer ] ) ) { $out[ absint( $r->user_id ) ] = true; }
			}
		}
		return $out;
	}

	/** Resolve the group-memberships table + its user/group columns once. */
	function sml_meet_mem() {
		static $m = null;
		if ( null !== $m ) { return $m; }
		global $wpdb;
		$m = array( 't' => '', 'u' => '', 'g' => '' );
		foreach ( array( $wpdb->prefix . 'sml_group_memberships', $wpdb->prefix . 'sml_group_members' ) as $t ) {
			if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $t ) ) === $t ) { $m['t'] = $t; break; }
		}
		if ( '' === $m['t'] ) { return $m; }
		$byLc = array();
		foreach ( (array) $wpdb->get_col( 'SHOW COLUMNS FROM `' . $m['t'] . '`' ) as $c ) { $byLc[ strtolower( $c ) ] = $c; }
		foreach ( array( 'user_id', 'uid', 'member_id', 'wp_user_id' ) as $c ) { if ( isset( $byLc[ $c ] ) ) { $m['u'] = $byLc[ $c ]; break; } }
		foreach ( array( 'group_id', 'gid', 'group' ) as $c ) { if ( isset( $byLc[ $c ] ) ) { $m['g'] = $byLc[ $c ]; break; } }
		return $m;
	}

	/** Shared-group counts between the viewer and a set of candidate ids. */
	function sml_meet_shared_groups( $viewer, $ids ) {
		global $wpdb;
		$ids = array_values( array_filter( array_map( 'absint', (array) $ids ) ) );
		if ( empty( $ids ) ) { return array(); }
		$m = sml_meet_mem();
		if ( '' === $m['t'] || '' === $m['u'] || '' === $m['g'] ) { return array(); }
		$t = $m['t']; $u = $m['u']; $g = $m['g'];
		$in  = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		$args = array_merge( array( (int) $viewer ), $ids );
		$sql = "SELECT m2.`{$u}` AS uid, COUNT(*) AS mutual "
			. "FROM `{$t}` m1 INNER JOIN `{$t}` m2 ON m2.`{$g}` = m1.`{$g}` AND m2.`{$u}` <> m1.`{$u}` "
			. "WHERE m1.`{$u}` = %d AND m2.`{$u}` IN ({$in}) GROUP BY m2.`{$u}`";
		$rows = $wpdb->get_results( $wpdb->prepare( $sql, $args ) ); // identifiers resolved above; values bound
		$out = array();
		if ( is_array( $rows ) ) { foreach ( $rows as $r ) { $out[ absint( $r->uid ) ] = (int) $r->mutual; } }
		return $out;
	}

	function sml_meet_profile_url( $uid ) {
		$uid = (int) $uid;
		if ( function_exists( 'sml_profile_url_for' ) ) { return sml_profile_url_for( $uid ); }
		if ( function_exists( 'sml_public_handle' ) ) { $h = sml_public_handle( $uid ); if ( $h ) { return home_url( '/' . rawurlencode( $h ) . '/' ); } }
		return get_author_posts_url( $uid );
	}

	function sml_meet_clean_city( $s ) {
		$s = sanitize_text_field( (string) $s );
		$s = preg_replace( '/[^A-Za-z0-9 ,.\-]/', '', $s );
		return trim( mb_substr( $s, 0, 60 ) );
	}

	function sml_meet_prefs_get( WP_REST_Request $request ) {
		$uid = get_current_user_id();
		return rest_ensure_response( array(
			'optin' => (bool) get_user_meta( $uid, 'sml_meet_optin', true ),
			'adult' => (bool) get_user_meta( $uid, 'sml_meet_adult', true ),
			'bio'   => (string) get_user_meta( $uid, 'sml_meet_bio', true ),
			'city'  => (string) get_user_meta( $uid, 'sml_meet_city', true ),
		) );
	}

	function sml_meet_prefs_set( WP_REST_Request $request ) {
		$uid   = get_current_user_id();
		$optin = (bool) $request->get_param( 'optin' );
		$adult = (bool) $request->get_param( 'adult' );
		$bio   = trim( wp_strip_all_tags( (string) $request->get_param( 'bio' ) ) );
		$bio   = mb_substr( $bio, 0, 160 );
		$city  = sml_meet_clean_city( $request->get_param( 'city' ) );

		// Opting in REQUIRES an 18+ attestation. Without it, force opt-out.
		if ( $optin && ! $adult ) {
			return new WP_REST_Response( array( 'code' => 'sml_meet_needs_adult', 'message' => __( 'You must confirm you are 18 or older to be listed.', 'sml-meet' ) ), 400 );
		}
		if ( $adult ) { update_user_meta( $uid, 'sml_meet_adult', 1 ); }
		update_user_meta( $uid, 'sml_meet_optin', $optin ? 1 : 0 );
		update_user_meta( $uid, 'sml_meet_bio', $bio );
		update_user_meta( $uid, 'sml_meet_city', $city );
		return sml_meet_prefs_get( $request );
	}

	function sml_meet_block( WP_REST_Request $request ) {
		$uid    = get_current_user_id();
		$target = (int) $request->get_param( 'user_id' );
		$action = (string) $request->get_param( 'action' );
		if ( $target <= 0 || $target === $uid ) {
			return new WP_REST_Response( array( 'code' => 'sml_meet_bad_target', 'message' => 'Invalid user.' ), 400 );
		}
		$set = sml_meet_idset( $uid, 'sml_meet_blocked' );
		if ( 'unblock' === $action ) { unset( $set[ $target ] ); } else { $set[ $target ] = true; }
		update_user_meta( $uid, 'sml_meet_blocked', implode( ',', array_map( 'intval', array_keys( $set ) ) ) );
		return rest_ensure_response( array( 'blocked' => ( 'unblock' !== $action ), 'user_id' => $target ) );
	}

	function sml_meet_directory( WP_REST_Request $request ) {
		global $wpdb;
		$viewer = get_current_user_id();
		$limit  = (int) $request->get_param( 'limit' );  if ( $limit < 1 ) { $limit = 20; } if ( $limit > 50 ) { $limit = 50; }
		$offset = (int) $request->get_param( 'offset' ); if ( $offset < 0 ) { $offset = 0; }
		$city   = sml_meet_clean_city( $request->get_param( 'city' ) );

		// Pool: opted-in + 18+ members, with their bio/city, in one pivot query.
		// Capped so the scan + affinity self-join stay bounded no matter how large the
		// opted-in set grows (opt-in is off by default, so the cap only bites well
		// beyond any realistic browse depth). $cap is an int we control, not input.
		$cap = 500;
		$um  = $wpdb->usermeta;
		$sql = "SELECT p.user_id AS uid,
				MAX(CASE WHEN x.meta_key='sml_meet_adult' THEN x.meta_value END) AS adult,
				MAX(CASE WHEN x.meta_key='sml_meet_bio'   THEN x.meta_value END) AS bio,
				MAX(CASE WHEN x.meta_key='sml_meet_city'  THEN x.meta_value END) AS city
			FROM (SELECT user_id FROM {$um} WHERE meta_key='sml_meet_optin' AND meta_value='1') p
			INNER JOIN {$um} x ON x.user_id = p.user_id
			WHERE x.meta_key IN ('sml_meet_adult','sml_meet_bio','sml_meet_city')
			GROUP BY p.user_id
			HAVING adult = '1'
			ORDER BY p.user_id DESC
			LIMIT " . (int) $cap;
		$rows = (array) $wpdb->get_results( $sql ); // no user input; fixed keys + int cap

		// Pass 1: drop self, viewer's own blocks, and city mismatches.
		$my_blocked = sml_meet_idset( $viewer, 'sml_meet_blocked' );
		$prelim = array();
		foreach ( $rows as $r ) {
			$id = absint( $r->uid );
			if ( $id <= 0 || $id === $viewer || isset( $my_blocked[ $id ] ) ) { continue; }
			if ( '' !== $city && strtolower( trim( (string) $r->city ) ) !== strtolower( $city ) ) { continue; }
			$prelim[ $id ] = array( 'bio' => (string) $r->bio, 'city' => (string) $r->city );
		}

		// Pass 2: drop candidates who blocked the viewer (one batched query, not O(N)).
		$blockers = sml_meet_blockers_of( array_keys( $prelim ), $viewer );
		$pool = array();
		foreach ( $prelim as $id => $data ) {
			if ( isset( $blockers[ $id ] ) ) { continue; }
			$pool[ $id ] = $data;
		}
		$total = count( $pool );
		if ( 0 === $total ) { return rest_ensure_response( array( 'items' => array(), 'total' => 0, 'has_more' => false ) ); }

		// Order by shared-group affinity (desc), then by id (stable).
		$ids     = array_keys( $pool );
		$shared  = sml_meet_shared_groups( $viewer, $ids );
		usort( $ids, function ( $a, $b ) use ( $shared ) {
			$sa = isset( $shared[ $a ] ) ? $shared[ $a ] : 0;
			$sb = isset( $shared[ $b ] ) ? $shared[ $b ] : 0;
			if ( $sa === $sb ) { return $b - $a; }
			return $sb - $sa;
		} );

		$page      = array_slice( $ids, $offset, $limit );
		$following = sml_meet_idset( $viewer, 'sml_following' );
		$followers = sml_meet_idset( $viewer, 'sml_followers' );

		$items = array();
		foreach ( $page as $id ) {
			$u = get_userdata( $id );
			if ( ! $u ) { continue; }
			$items[] = array(
				'user_id'       => (int) $id,
				'name'          => $u->display_name,
				'avatar'        => get_avatar_url( $id, array( 'size' => 96 ) ),
				'profile_url'   => sml_meet_profile_url( $id ),
				'bio'           => $pool[ $id ]['bio'],
				'city'          => $pool[ $id ]['city'],
				'mutual_groups' => isset( $shared[ $id ] ) ? (int) $shared[ $id ] : 0,
				'follows_you'   => isset( $followers[ $id ] ),
				'following'     => isset( $following[ $id ] ),
			);
		}

		// Advance the cursor by the slice WIDTH (not the count of resolved items) so a
		// skipped deleted/unresolvable user can't desync the client's offset and
		// duplicate a card on the next page.
		$next_offset = $offset + count( $page );
		$resp = rest_ensure_response( array(
			'items'       => $items,
			'total'       => $total,
			'has_more'    => $next_offset < $total,
			'next_offset' => $next_offset,
		) );
		$resp->header( 'Cache-Control', 'private, no-store' );
		return $resp;
	}

	add_action( 'rest_api_init', function () {
		$auth = function () { return is_user_logged_in(); };
		register_rest_route( 'sml-meet/v1', '/prefs', array(
			array( 'methods' => 'GET',  'callback' => 'sml_meet_prefs_get', 'permission_callback' => $auth ),
			array( 'methods' => 'POST', 'callback' => 'sml_meet_prefs_set', 'permission_callback' => $auth ),
		) );
		register_rest_route( 'sml-meet/v1', '/directory', array(
			'methods' => 'GET', 'callback' => 'sml_meet_directory', 'permission_callback' => $auth,
		) );
		register_rest_route( 'sml-meet/v1', '/block', array(
			'methods' => 'POST', 'callback' => 'sml_meet_block', 'permission_callback' => $auth,
		) );
	} );
}
