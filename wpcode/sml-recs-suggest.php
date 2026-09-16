/**
 * SML Recs — "Traders you may want to connect with" (self-contained).
 *
 * A transparent, trading-affinity recommender on live data — no external plugin,
 * no new tables. It suggests members you SHARE COMMUNITIES with: other people in
 * your groups, ranked by how many groups you have in common (with a nudge for
 * people who already follow you). Every suggestion carries a plain reason
 * ("You're in 3 groups together"). No "match %", no romantic/relationship logic,
 * and anyone can opt out (usermeta `sml_recs_optout`).
 *
 * Group co-membership is used because it is the reliable, indexed signal already
 * proven by the live per-ticker "trader you may know" tile (same self-join). The
 * watchlist is owned by the external Members plugin and does not reliably persist
 * to queryable usermeta, so it is intentionally not used here.
 *
 * Route: GET /wp-json/sml-recs/v1/suggest?surface=connect&limit=6  (auth only)
 * Reply: { surface, items:[ { user_id, name, avatar, profile_url, reason } ] }
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. Guarded functions, no
 * dynamic-code calls, no top-level return. Kill switch: deactivate the snippet.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! function_exists( 'sml_recs_mem' ) ) {

	/** Resolve the group-memberships table + its user/group columns once. */
	function sml_recs_mem() {
		static $m = null;
		if ( null !== $m ) { return $m; }
		global $wpdb;
		$m = array( 't' => '', 'u' => '', 'g' => '' );

		foreach ( array( $wpdb->prefix . 'sml_group_memberships', $wpdb->prefix . 'sml_group_members' ) as $t ) {
			if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $t ) ) === $t ) { $m['t'] = $t; break; }
		}
		if ( '' === $m['t'] ) { return $m; }

		$cols = (array) $wpdb->get_col( 'SHOW COLUMNS FROM `' . $m['t'] . '`' ); // fixed, resolved identifier
		$byLc = array();
		foreach ( $cols as $c ) { $byLc[ strtolower( $c ) ] = $c; }
		foreach ( array( 'user_id', 'uid', 'member_id', 'wp_user_id' ) as $c ) { if ( isset( $byLc[ $c ] ) ) { $m['u'] = $byLc[ $c ]; break; } }
		foreach ( array( 'group_id', 'gid', 'group' ) as $c ) { if ( isset( $byLc[ $c ] ) ) { $m['g'] = $byLc[ $c ]; break; } }
		return $m;
	}

	/** Co-members of the viewer, mapped { user_id => shared_group_count }. */
	function sml_recs_group_neighbors( $viewer, $cap ) {
		global $wpdb;
		$m = sml_recs_mem();
		if ( '' === $m['t'] || '' === $m['u'] || '' === $m['g'] ) { return array(); }
		$cap = (int) $cap;
		if ( $cap < 1 ) { $cap = 60; }
		if ( $cap > 200 ) { $cap = 200; }

		$t = $m['t']; $u = $m['u']; $g = $m['g'];
		$sql = "SELECT m2.`{$u}` AS uid, COUNT(*) AS mutual "
			. "FROM `{$t}` m1 INNER JOIN `{$t}` m2 ON m2.`{$g}` = m1.`{$g}` AND m2.`{$u}` <> m1.`{$u}` "
			. "WHERE m1.`{$u}` = %d GROUP BY m2.`{$u}` ORDER BY mutual DESC, m2.`{$u}` DESC LIMIT %d";

		$rows = $wpdb->get_results( $wpdb->prepare( $sql, $viewer, $cap ) ); // identifiers resolved above; values bound
		$out  = array();
		if ( is_array( $rows ) ) {
			foreach ( $rows as $r ) {
				$uid = isset( $r->uid ) ? absint( $r->uid ) : 0;
				if ( $uid > 0 ) { $out[ $uid ] = (int) $r->mutual; }
			}
		}
		return $out;
	}

	/** A usermeta id-array as an O(1) lookup set { id => true }. */
	function sml_recs_idset( $uid, $key ) {
		$raw = get_user_meta( (int) $uid, $key, true );
		if ( function_exists( 'sml_members_id_list' ) ) { $raw = sml_members_id_list( $raw ); }
		$out = array();
		if ( is_array( $raw ) ) {
			foreach ( $raw as $v ) {
				$v = absint( $v );
				if ( $v > 0 ) { $out[ $v ] = true; }
			}
		}
		return $out;
	}

	/** Public profile URL for a user, best available resolver. */
	function sml_recs_profile_url( $uid ) {
		$uid = (int) $uid;
		if ( function_exists( 'sml_profile_url_for' ) ) { return sml_profile_url_for( $uid ); }
		if ( function_exists( 'sml_public_handle' ) ) {
			$h = sml_public_handle( $uid );
			if ( $h ) { return home_url( '/' . rawurlencode( $h ) . '/' ); }
		}
		return get_author_posts_url( $uid );
	}

	/** Plain, honest reason from the shared-group count. */
	function sml_recs_reason( $mutual ) {
		$mutual = (int) $mutual;
		if ( $mutual <= 1 ) { return "You're in a group together"; }
		return "You're in " . $mutual . ' groups together';
	}

	function sml_recs_suggest( WP_REST_Request $request ) {
		$viewer = get_current_user_id();
		$empty  = array( 'surface' => 'connect', 'items' => array() );
		if ( $viewer <= 0 || get_user_meta( $viewer, 'sml_recs_optout', true ) ) {
			return rest_ensure_response( $empty );
		}

		$limit = (int) $request->get_param( 'limit' );
		if ( $limit < 1 ) { $limit = 6; }
		if ( $limit > 20 ) { $limit = 20; }

		$neighbors = sml_recs_group_neighbors( $viewer, 80 );
		unset( $neighbors[ $viewer ] );
		if ( empty( $neighbors ) ) { return rest_ensure_response( $empty ); }

		$following = sml_recs_idset( $viewer, 'sml_following' );
		$followers = sml_recs_idset( $viewer, 'sml_followers' );

		$scored = array();
		$seen   = 0;
		foreach ( $neighbors as $uid => $mutual ) {
			if ( $seen >= 40 ) { break; }
			$seen++;
			if ( isset( $following[ $uid ] ) ) { continue; }               // already following -> Follow must be actionable
			if ( get_user_meta( $uid, 'sml_recs_optout', true ) ) { continue; }
			$u = get_userdata( $uid );
			if ( ! $u ) { continue; }

			$follows_you = isset( $followers[ $uid ] );
			$scored[] = array(
				'uid'    => (int) $uid,
				'u'      => $u,
				'mutual' => (int) $mutual,
				'score'  => (int) $mutual * 10 + ( $follows_you ? 4 : 0 ),
			);
		}

		usort( $scored, function ( $a, $b ) { return $b['score'] - $a['score']; } );
		$scored = array_slice( $scored, 0, $limit );

		$items = array();
		foreach ( $scored as $s ) {
			$items[] = array(
				'user_id'     => $s['uid'],
				'name'        => $s['u']->display_name,
				'avatar'      => get_avatar_url( $s['uid'], array( 'size' => 64 ) ),
				'profile_url' => sml_recs_profile_url( $s['uid'] ),
				'reason'      => sml_recs_reason( $s['mutual'] ),
			);
		}

		$resp = rest_ensure_response( array( 'surface' => 'connect', 'items' => $items ) );
		$resp->header( 'Cache-Control', 'private, no-store' );
		return $resp;
	}

	add_action( 'rest_api_init', function () {
		register_rest_route(
			'sml-recs/v1',
			'/suggest',
			array(
				'methods'             => 'GET',
				'callback'            => 'sml_recs_suggest',
				'permission_callback' => function () { return is_user_logged_in(); },
				'args'                => array(
					'surface' => array( 'default' => 'connect' ),
					'limit'   => array( 'default' => 6, 'sanitize_callback' => 'absint' ),
				),
			)
		);
	} );
}
