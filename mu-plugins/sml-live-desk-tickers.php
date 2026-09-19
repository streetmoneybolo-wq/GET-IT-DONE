<?php
/**
 * Plugin Name: SML Live Desk Tickers
 * Description: Persists the creator's chosen desk tickers (PRIMARY + related, picked at go-live) so the
 *   live "DESK FOCUS" module can show exactly those — never a generic/global list. Captures the ticker list
 *   from whichever start route the creator used and stores it, ordered, in usermeta _sml_live_desk_tickers.
 *   The live feed (sml-video-upload-studio-v381/live-slots.php: sml_slots_rest_feeds) reads it back.
 * Version: 1.0.0
 *
 * WHY A SIDECAR: the scheduled-live record (_sml_scheduled_live) only stores a single `ticker` and is written
 *   by a helper we don't own; the related tickers the creator picks in Go Live never reached it. Rather than
 *   edit that writer, we capture the list from the REST request after the start route succeeds. This works no
 *   matter where the route is defined (plugin, mu-plugin or WPCode) because it hooks the dispatch pipeline.
 *
 * ROUTES CAPTURED (both send `ticker` + `tickers` from js/golive-script.php):
 *   POST /sml-scheduled-live/v1/creator   — scheduleWatchPage() (schedule / watch page)
 *   POST /sml-group-live/v1/start          — goLive() (go live now)
 *
 * To disable: delete this file. The feed then falls back to the scheduled-live primary ticker alone.
 * 2026-09-19.
 */

defined( 'ABSPATH' ) || exit;

if ( ! function_exists( 'sml_ldt_capture' ) ) {
	/**
	 * Build the ordered, sanitized desk-ticker list from a start request and store it for the acting creator.
	 * PRIMARY (the `ticker` param) is always first; related tickers follow, de-duplicated, A-Z only, <=5 chars,
	 * capped at 5 total (the desk shows at most 5).
	 */
	function sml_ldt_capture( WP_REST_Request $request ) {
		$uid = get_current_user_id();
		if ( $uid <= 0 ) {
			return;
		}

		// Only act when this request actually carried the picker fields. A start/create POST that omits all of
		// them is some other flow (e.g. a metadata-only update) and must not wipe the creator's desk tickers.
		// A field that is present but empty ('' or array()) is a deliberate "no tickers" and DOES clear.
		$has_ticker  = ( null !== $request->get_param( 'ticker' ) );
		$has_tickers = ( null !== $request->get_param( 'tickers' ) );
		$has_related = ( null !== $request->get_param( 'related' ) );
		if ( ! $has_ticker && ! $has_tickers && ! $has_related ) {
			return;
		}

		$list = array();

		$add = function ( $raw ) use ( &$list ) {
			// Guard non-scalars: (string) array yields "Array" (a bogus "ARRAY" ticker) and a PHP warning.
			if ( ! is_scalar( $raw ) ) {
				return;
			}
			$sym = strtoupper( preg_replace( '/[^A-Za-z]/', '', (string) $raw ) );
			if ( '' === $sym || strlen( $sym ) > 5 ) {
				return;
			}
			if ( ! in_array( $sym, $list, true ) ) {
				$list[] = $sym;
			}
		};

		// PRIMARY first so it is always index 0.
		$add( $request->get_param( 'ticker' ) );

		foreach ( array( 'tickers', 'related' ) as $param ) {
			$vals = $request->get_param( $param );
			if ( ! is_array( $vals ) ) {
				continue;
			}
			// Cap the number of elements EXAMINED (not just accepted) so a huge array of junk symbols that never
			// accumulate 5 valid entries cannot force an unbounded preg_replace loop on the request thread.
			foreach ( array_slice( $vals, 0, 50 ) as $val ) {
				if ( count( $list ) >= 5 ) {
					break;
				}
				$add( $val );
			}
		}

		$list = array_slice( $list, 0, 5 );

		// Write on every qualifying start — an empty list clears a previous stream's related tickers.
		update_user_meta( $uid, '_sml_live_desk_tickers', $list );
	}
}

add_filter(
	'rest_request_after_callbacks',
	function ( $response, $handler, $request ) {
		if ( ! ( $request instanceof WP_REST_Request ) ) {
			return $response;
		}
		if ( 'POST' !== strtoupper( (string) $request->get_method() ) ) {
			return $response;
		}

		$route = rtrim( (string) $request->get_route(), '/' );
		if ( '/sml-scheduled-live/v1/creator' !== $route && '/sml-group-live/v1/start' !== $route ) {
			return $response;
		}

		// Only persist when the start actually succeeded.
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$status = ( $response instanceof WP_HTTP_Response ) ? (int) $response->get_status() : 200;
		if ( $status < 200 || $status >= 300 ) {
			return $response;
		}

		sml_ldt_capture( $request );

		return $response;
	},
	20,
	3
);
