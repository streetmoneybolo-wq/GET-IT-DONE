/**
 * SML Recs — "Traders you may want to connect with" (self-contained).
 *
 * A transparent, trading-affinity recommender that runs entirely on live data —
 * no external plugin, no new tables. It suggests members who share your WATCHLIST
 * tickers, ranked by overlap (plus a nudge for people who already follow you), and
 * every suggestion carries a plain reason ("You both follow $NVDA"). It only ever
 * surfaces real signal; there is no "match %", no romantic/relationship logic, and
 * anyone can opt out (usermeta `sml_recs_optout`).
 *
 * Route:  GET /wp-json/sml-recs/v1/suggest?surface=ticker_match&limit=6  (auth only)
 * Reply:  { surface, items:[ { user_id, name, avatar, profile_url, reason } ] }
 *
 * Signals (all read-only, all already stored by the site):
 *   - sml_watchlist_tickers  (usermeta, array of tickers)  -> overlap + reason
 *   - sml_following / sml_followers (usermeta, id arrays)   -> exclude already-followed, boost followers
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. Guarded functions, no
 * dynamic-code calls, no top-level return. Kill switch: deactivate the snippet.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! function_exists( 'sml_recs_watchlist' ) ) {

	/** A user's watchlist as a flat array of lowercase ticker strings. */
	function sml_recs_watchlist( $uid ) {
		$flat = get_user_meta( (int) $uid, 'sml_watchlist_tickers', true );
		if ( is_array( $flat ) && ! empty( $flat ) ) {
			$out = array();
			foreach ( $flat as $t ) {
				$t = strtolower( trim( (string) $t ) );
				if ( '' !== $t && preg_match( '/^[a-z0-9.\-]{1,12}$/', $t ) ) { $out[] = $t; }
			}
			return array_values( array_unique( $out ) );
		}
		$structured = get_user_meta( (int) $uid, 'sml_watchlist', true );
		if ( is_array( $structured ) ) {
			$out = array();
			foreach ( $structured as $it ) {
				if ( is_array( $it ) && isset( $it['symbol'] ) ) {
					$s = strtolower( trim( (string) $it['symbol'] ) );
					if ( '' !== $s ) { $out[] = $s; }
				}
			}
			return array_values( array_unique( $out ) );
		}
		return array();
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

	/** Candidate members who share >=1 of $tickers, mapped to overlap count. */
	function sml_recs_neighbors( $tickers, $cap ) {
		global $wpdb;
		$tickers = array_slice( array_values( array_unique( (array) $tickers ) ), 0, 25 );
		if ( empty( $tickers ) ) { return array(); }
		$cap = (int) $cap;
		if ( $cap < 1 ) { $cap = 80; }
		if ( $cap > 300 ) { $cap = 300; }

		$overlap = array();
		$where   = array();
		$args    = array();
		// LOWER() so the match is case-insensitive whatever the stored case / column collation.
		foreach ( $tickers as $t ) { $overlap[] = '( LOWER( meta_value ) LIKE %s )'; $args[] = '%"' . $wpdb->esc_like( $t ) . '"%'; }
		foreach ( $tickers as $t ) { $where[]   = 'LOWER( meta_value ) LIKE %s';     $args[] = '%"' . $wpdb->esc_like( $t ) . '"%'; }
		$args[] = $cap;

		$sql = "SELECT user_id, ( " . implode( ' + ', $overlap ) . " ) AS ov "
			. "FROM {$wpdb->usermeta} "
			. "WHERE meta_key = 'sml_watchlist_tickers' AND ( " . implode( ' OR ', $where ) . " ) "
			. "GROUP BY user_id ORDER BY ov DESC, user_id DESC LIMIT %d";

		$rows = $wpdb->get_results( $wpdb->prepare( $sql, $args ) ); // phpcs:ignore WordPress.DB
		$map  = array();
		if ( is_array( $rows ) ) {
			foreach ( $rows as $r ) {
				$uid = isset( $r->user_id ) ? absint( $r->user_id ) : 0;
				if ( $uid > 0 ) { $map[ $uid ] = (int) $r->ov; }
			}
		}
		return $map;
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

	/** Plain, honest reason line from the shared tickers. */
	function sml_recs_reason( $shared ) {
		$tk = array();
		foreach ( array_slice( $shared, 0, 2 ) as $t ) { $tk[] = '$' . strtoupper( $t ); }
		$str = 'You both follow ' . implode( ', ', $tk );
		$more = count( $shared ) - count( $tk );
		if ( $more > 0 ) { $str .= ' +' . $more . ' more'; }
		return $str;
	}

	function sml_recs_suggest( WP_REST_Request $request ) {
		$viewer = get_current_user_id();
		$empty  = array( 'surface' => 'ticker_match', 'items' => array() );
		if ( $viewer <= 0 || get_user_meta( $viewer, 'sml_recs_optout', true ) ) {
			return rest_ensure_response( $empty );
		}

		$limit = (int) $request->get_param( 'limit' );
		if ( $limit < 1 ) { $limit = 6; }
		if ( $limit > 20 ) { $limit = 20; }

		$watch = sml_recs_watchlist( $viewer );
		if ( empty( $watch ) ) { return rest_ensure_response( $empty ); }
		$watchset = array_flip( $watch );

		$neighbors = sml_recs_neighbors( $watch, 80 );
		unset( $neighbors[ $viewer ] );
		if ( empty( $neighbors ) ) { return rest_ensure_response( $empty ); }

		$following = sml_recs_idset( $viewer, 'sml_following' );
		$followers = sml_recs_idset( $viewer, 'sml_followers' );

		$scored = array();
		$seen   = 0;
		foreach ( $neighbors as $uid => $ov ) {
			if ( $seen >= 40 ) { break; }
			$seen++;
			if ( isset( $following[ $uid ] ) ) { continue; }               // already following -> Follow must be actionable
			if ( get_user_meta( $uid, 'sml_recs_optout', true ) ) { continue; }
			$u = get_userdata( $uid );
			if ( ! $u ) { continue; }

			$shared = array();
			foreach ( sml_recs_watchlist( $uid ) as $t ) {
				if ( isset( $watchset[ $t ] ) ) { $shared[] = $t; }
			}
			if ( empty( $shared ) ) { continue; }

			$follows_you = isset( $followers[ $uid ] );
			$scored[] = array(
				'uid'    => (int) $uid,
				'u'      => $u,
				'shared' => $shared,
				'score'  => count( $shared ) * 10 + ( $follows_you ? 4 : 0 ),
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
				'reason'      => sml_recs_reason( $s['shared'] ),
			);
		}

		$resp = rest_ensure_response( array( 'surface' => 'ticker_match', 'items' => $items ) );
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
					'surface' => array( 'default' => 'ticker_match' ),
					'limit'   => array( 'default' => 6, 'sanitize_callback' => 'absint' ),
				),
			)
		);
	} );
}
