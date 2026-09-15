<?php
/*
Plugin Name: SML Rail Shorts Tagger
Description: Tags short / non-index uploads in the sml-video-upload-studio /rail REST response so the homepage "Shorts & Profile Uploads" feed rail populates. Non-invasive: it never modifies the sml-video-upload-studio plugin or any stored upload record — it only decorates the read-only /rail response. Reversible by deactivation.
Version: 1.0.0
Author: StockMarketLoop
*/

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Decorate each /rail card with short / is_short / noindex / type so the home
 * feed's shorts filter (x.short || x.is_short || x.noindex || type~short|clip|
 * profile|noindex) can route it into the Shorts rail.
 *
 * IMPORTANT (verified live): rest_request_after_callbacks receives the RAW value
 * the route callback returned. sml_vus_rest_rail() returns a bare PHP array
 * (array('up_next'=>..,'related'=>..,'ticker'=>..)), NOT yet wrapped in a
 * WP_REST_Response. So we must handle BOTH the bare-array and the response-object
 * cases — an `instanceof WP_REST_Response` early-return would make this a no-op.
 *
 * The /rail card intentionally drops `visibility` and emits `duration` as a
 * formatted label string, so we re-hydrate the raw record by id (card id ===
 * library array key) to read the true numeric duration + enum visibility.
 *
 * @param mixed           $response Raw callback return (array) or WP_REST_Response.
 * @param array           $handler  Matched route handler.
 * @param WP_REST_Request $request  The request.
 * @return mixed Decorated response (same type as received).
 */
function sml_rail_shorts_tag( $response, $handler, $request ) {
	if ( ! ( $request instanceof WP_REST_Request ) ) {
		return $response;
	}
	if ( strpos( (string) $request->get_route(), '/sml-video-upload-studio/v1/rail' ) === false ) {
		return $response;
	}
	if ( is_wp_error( $response ) ) {
		return $response;
	}
	if ( ! function_exists( 'sml_video_upload_studio_library' ) ) {
		return $response;
	}

	$is_obj = ( $response instanceof WP_REST_Response );
	$data   = $is_obj ? $response->get_data() : $response;
	if ( ! is_array( $data ) ) {
		return $response;
	}

	$lib = sml_video_upload_studio_library();
	if ( ! is_array( $lib ) ) {
		return $response;
	}

	$decorate = function ( $items ) use ( $lib ) {
		if ( ! is_array( $items ) ) {
			return $items;
		}
		foreach ( $items as $idx => $card ) {
			if ( ! is_array( $card ) || empty( $card['title'] ) ) {
				// Uploads still require a title — untitled cards are never shorts.
				continue;
			}
			$id  = isset( $card['id'] ) ? (string) $card['id'] : '';
			$rec = ( '' !== $id && isset( $lib[ $id ] ) && is_array( $lib[ $id ] ) ) ? $lib[ $id ] : array();

			// short: authoritative stored flag first, else numeric duration 1..60s.
			$dur   = (int) ( isset( $rec['duration'] ) ? $rec['duration'] : 0 );
			$short = ! empty( $rec['short'] ) || ! empty( $rec['is_short'] ) || ( $dur > 0 && $dur <= 60 );

			// non-index: stored flag first, else any non-public visibility.
			$vis     = isset( $rec['visibility'] ) ? (string) $rec['visibility'] : 'public';
			$noindex = ! empty( $rec['noindex'] ) || in_array( $vis, array( 'unlisted', 'private', 'members', 'premium', 'scheduled' ), true );

			// profile / feed upload: stored origin if present, else unlisted (also
			// non-index). Deliberately NOT the surfaces 'profile' token — that is a
			// distribution target, not an upload origin.
			$profile = ! empty( $rec['profile_upload'] )
				|| ( isset( $rec['source'] ) && in_array( (string) $rec['source'], array( 'profile', 'feed' ), true ) )
				|| ( 'unlisted' === $vis );

			$card['short']    = (bool) $short;
			$card['is_short'] = (bool) $short;
			$card['noindex']  = (bool) $noindex;
			$card['type']     = $short ? 'short' : ( ( $noindex || $profile ) ? 'profile' : 'upload' );

			$items[ $idx ] = $card;
		}
		return $items;
	};

	if ( isset( $data['up_next'] ) ) {
		$data['up_next'] = $decorate( $data['up_next'] );
	}
	if ( isset( $data['related'] ) ) {
		$data['related'] = $decorate( $data['related'] );
	}

	if ( $is_obj ) {
		$response->set_data( $data );
		return $response;
	}
	// WP re-wraps a returned array via rest_ensure_response().
	return $data;
}
add_filter( 'rest_request_after_callbacks', 'sml_rail_shorts_tag', 20, 3 );
