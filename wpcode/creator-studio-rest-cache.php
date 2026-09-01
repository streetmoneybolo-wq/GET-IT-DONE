<?php
/**
 * SML Creator Studio — short per-user REST response cache (perf).
 *
 * Install as ONE WPCode PHP snippet: Auto Insert / Run Everywhere.
 *
 * The Creator Studio / analyst dashboard fires several authenticated REST reads
 * that each take ~2–3s server-side (creator-dashboard, stripe/status, creator-gate
 * status, and the Loop Bucks panel reads). This caches their JSON for a short TTL
 * so repeat loads return instantly instead of recomputing every time.
 *
 * SAFETY (this is the whole point — read before editing the allowlist):
 *  - Cache key ALWAYS includes get_current_user_id(), so one user can never be
 *    served another user's data. Guests are never cached.
 *  - ONLY GET requests, ONLY the exact routes in ROUTES, ONLY 200 responses.
 *  - Never caches writes, /me (balance must stay fresh), or anything with errors.
 *  - TTL is short; stale-by-at-most-TTL is fine for dashboards/leaderboards.
 *
 * NO GLOBAL FUNCTIONS (guarded class). No dynamic-code or encoding calls. No top-level return.
 * Kill switch: deactivate the snippet (caching simply stops).
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! class_exists( 'SML_Studio_REST_Cache' ) ) {

	final class SML_Studio_REST_Cache {

		/** Seconds to cache. Dashboards/leaderboards tolerate this staleness. */
		const TTL = 60;

		/**
		 * Exact REST routes to cache (leading slash, no namespace prefix stripped).
		 * Read-only, per-user, expensive. NOTE: /sml-lb/v1/me is deliberately absent
		 * — the balance must stay fresh (and the client already caches it).
		 */
		private static function routes() {
			return array(
				'/sml-video-upload-studio/v1/creator-dashboard',
				'/sml-live/v1/stripe/status',
				'/sml-creator-gate/v1/status',
				'/sml-lb/v1/earn',
				'/sml-lb/v1/gates',
				'/sml-lb/v1/leaderboard',
				'/sml-lbm/v1/state',
			);
		}

		public function __construct() {
			// rest_request_before_callbacks fires AFTER the route's permission_callback
			// has already run and passed (unlike rest_pre_dispatch, which short-circuits
			// BEFORE it). Serving the cache here means every hit is still permission-checked
			// live, so a revoked/changed permission is enforced immediately — never up to
			// TTL seconds stale.
			add_filter( 'rest_request_before_callbacks', array( $this, 'serve' ), 8, 3 );
			add_filter( 'rest_post_dispatch', array( $this, 'store' ), 8, 3 );
		}

		/** Whether this exact request is one we cache. */
		private function eligible( WP_REST_Request $request ) {
			if ( 'GET' !== $request->get_method() ) { return false; }
			$uid = get_current_user_id();
			if ( ! $uid ) { return false; }
			return in_array( $request->get_route(), self::routes(), true );
		}

		/** Per-USER cache key — the user id is what keeps this safe. */
		private function key( WP_REST_Request $request ) {
			return 'sml_csc_' . md5(
				$request->get_route() . '|' .
				wp_json_encode( $request->get_query_params() ) . '|u' .
				get_current_user_id()
			);
		}

		/**
		 * Serve a fresh cached copy INSTEAD of the slow route callback — but only
		 * after the route's permission_callback has already passed (this runs on
		 * rest_request_before_callbacks). $result is null on a normal request; if a
		 * prior filter or a failed permission produced a value/WP_Error we leave it.
		 */
		public function serve( $result, $handler, $request ) {
			if ( null !== $result || ! ( $request instanceof WP_REST_Request ) || ! $this->eligible( $request ) ) {
				return $result;
			}
			$hit = get_transient( $this->key( $request ) );
			if ( is_array( $hit ) && isset( $hit['data'] ) ) {
				$resp = new WP_REST_Response( $hit['data'], 200 );
				$resp->header( 'X-SML-Cache', 'HIT' );
				return $resp;
			}
			return $result;
		}

		/** Cache a fresh 200 response for next time. */
		public function store( $response, $server, $request ) {
			if ( ! ( $response instanceof WP_REST_Response ) || ! $this->eligible( $request ) ) { return $response; }
			$headers = $response->get_headers();
			if ( isset( $headers['X-SML-Cache'] ) && 'HIT' === $headers['X-SML-Cache'] ) { return $response; } // already from cache
			if ( 200 !== (int) $response->get_status() ) { return $response; } // exactly 200 — never errors/redirects/other 2xx
			$data = $response->get_data();
			if ( is_array( $data ) ) { // only plain serialisable array payloads
				set_transient( $this->key( $request ), array( 'data' => $data ), self::TTL );
			}
			return $response;
		}
	}

	new SML_Studio_REST_Cache();
}
