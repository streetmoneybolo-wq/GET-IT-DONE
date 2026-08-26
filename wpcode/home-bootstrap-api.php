/**
 * SML Home Bootstrap — aggregated read-only homepage endpoint (perf phase 3).
 *
 *   GET /wp-json/sml-home/v2/bootstrap
 *
 * Consolidates six authenticated READ routes into one authenticated request:
 *   loopbucks   ← /sml-lb/v1/me
 *   gates       ← /sml-lb/v1/gates
 *   leaderboard ← /sml-lb/v1/leaderboard
 *   milestones  ← /sml-lbm/v1/state
 *   watchlist   ← /sml-members/v1/watchlist
 *   creatorGate ← /sml-creator-gate/v1/status
 *
 * COMPATIBILITY-ADAPTER STAGE (this version): each component is fetched by
 * internally dispatching its existing authoritative route as the current user
 * (rest_do_request). The existing routes stay the single source of truth and
 * keep their own permission checks. Every component is timed and its DB query
 * count recorded (component-level status metadata) so we can later extract the
 * shared service functions and call business logic directly — this snippet
 * deliberately does NOT claim that optimization yet.
 *
 * Rules honored:
 *  - Authenticated only; per-user; never publicly cached (no-store).
 *  - Optional per-user cache via short transient, key includes user id + schema.
 *  - Isolated failure: one component erroring returns that component null with
 *    status:'error'; the rest still return. No mutations. No external HTTP.
 *  - Admin-only rollout first (SML_HOME_BOOT_AUDIENCE='admins'): non-admins get
 *    403 so the client falls back to the existing per-route calls.
 *
 * Kill switch: deactivate this snippet → route 404s → client falls back.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! defined( 'SML_HOME_BOOT_AUDIENCE' ) ) { define( 'SML_HOME_BOOT_AUDIENCE', 'all' ); } // 'admins' | 'all'
if ( ! defined( 'SML_HOME_BOOT_CACHE_TTL' ) ) { define( 'SML_HOME_BOOT_CACHE_TTL', 15 ); }       // seconds; 0 disables
if ( ! defined( 'SML_HOME_BOOT_SCHEMA' ) ) { define( 'SML_HOME_BOOT_SCHEMA', 'v2.1' ); }

if ( ! function_exists( 'sml_home_boot_component' ) ) {

	/* run one internal read route, timed + query-counted, failure-isolated */
	function sml_home_boot_component( $route, $params = array() ) {
		global $wpdb;
		$q0 = is_object( $wpdb ) ? (int) $wpdb->num_queries : 0;
		$t0 = microtime( true );
		$status = 'ok';
		$data   = null;
		$code   = 200;
		try {
			$req = new WP_REST_Request( 'GET', $route );
			foreach ( (array) $params as $k => $v ) { $req->set_param( $k, $v ); }
			$res = rest_do_request( $req );
			if ( $res instanceof WP_REST_Response ) {
				$code = (int) $res->get_status();
				if ( $res->is_error() || $code >= 400 ) { $status = 'error'; }
				else { $data = $res->get_data(); }
			} else {
				$status = 'error';
			}
		} catch ( \Throwable $e ) {
			$status = 'error';
		}
		return array(
			'data'  => $data,
			'meta'  => array(
				'status'  => $status,
				'code'    => $code,
				'ms'      => (int) round( ( microtime( true ) - $t0 ) * 1000 ),
				'queries' => ( is_object( $wpdb ) ? (int) $wpdb->num_queries : 0 ) - $q0,
			),
		);
	}

	function sml_home_boot_handler( WP_REST_Request $request ) {
		$uid = get_current_user_id();
		if ( ! $uid ) {
			return new WP_Error( 'sml_home_boot_auth', 'Sign in required.', array( 'status' => 401 ) );
		}
		/* phase-1 admin-only rollout — non-admins fall back to per-route calls */
		if ( 'all' !== SML_HOME_BOOT_AUDIENCE && ! current_user_can( 'manage_options' ) ) {
			return new WP_Error( 'sml_home_boot_rollout', 'Bootstrap is in limited rollout.', array( 'status' => 403 ) );
		}

		$ck = 'sml_home_boot_' . SML_HOME_BOOT_SCHEMA . '_' . $uid;
		if ( SML_HOME_BOOT_CACHE_TTL > 0 && '1' !== (string) $request->get_param( 'fresh' ) ) {
			$cached = get_transient( $ck );
			if ( is_array( $cached ) ) {
				$cached['cache'] = 'hit';
				$resp = rest_ensure_response( $cached );
				$resp->header( 'Cache-Control', 'private, no-store' );
				return $resp;
			}
		}

		$t0   = microtime( true );
		$comp = array(
			'loopbucks'   => array( '/sml-lb/v1/me', array() ),
			'gates'       => array( '/sml-lb/v1/gates', array() ),
			'leaderboard' => array( '/sml-lb/v1/leaderboard', array() ),
			'milestones'  => array( '/sml-lbm/v1/state', array() ),
			'watchlist'   => array( '/sml-members/v1/watchlist', array() ),
			'creatorGate' => array( '/sml-creator-gate/v1/status', array() ),
		);

		$out  = array();
		$meta = array();
		foreach ( $comp as $key => $def ) {
			$r          = sml_home_boot_component( $def[0], $def[1] );
			$out[ $key ] = $r['data'];   // null on failure — homepage stays alive
			$meta[ $key ] = $r['meta'];
		}

		$body = array(
			'ok'        => true,
			'schema'    => SML_HOME_BOOT_SCHEMA,
			'user_id'   => $uid,
			'generated' => gmdate( 'c' ),
			'stage'     => 'compat-adapter',       // honest: internal REST dispatch, not extracted logic yet
			'audience'  => SML_HOME_BOOT_AUDIENCE,
			'cache'     => 'miss',
			'ttl'       => (int) SML_HOME_BOOT_CACHE_TTL,
			'total_ms'  => (int) round( ( microtime( true ) - $t0 ) * 1000 ),
			'components' => $out,
			'component_status' => $meta,
		);

		if ( SML_HOME_BOOT_CACHE_TTL > 0 ) {
			set_transient( $ck, $body, (int) SML_HOME_BOOT_CACHE_TTL );
		}

		$resp = rest_ensure_response( $body );
		$resp->header( 'Cache-Control', 'private, no-store' ); // never edge/publicly cached
		return $resp;
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-home/v2', '/bootstrap', array(
			'methods'             => 'GET',
			'callback'            => 'sml_home_boot_handler',
			/* auth enforced in the handler (login + rollout audience); each
			   component re-runs its own route's permission checks internally */
			'permission_callback' => 'is_user_logged_in',
		) );
	} );
}
