<?php
/**
 * Plugin Name: StockMarketLoop Home Feed Visibility Gates
 * Description: Supplies real content-diversity counts used by optional home-feed sections.
 * Version: 1.0.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Add the number of distinct Loop channels represented in the visible video library.
 *
 * The rail endpoint intentionally returns only a small card sample, so the browser
 * cannot derive the full channel count from the response items alone.
 *
 * @param WP_REST_Response|WP_HTTP_Response|WP_Error|mixed $response REST response.
 * @param array                                            $handler  Route handler.
 * @param WP_REST_Request                                  $request  REST request.
 * @return WP_REST_Response|WP_HTTP_Response|WP_Error|mixed
 */
function sml_home_feed_add_video_channel_count( $response, $handler, $request ) {
	if ( ! $request instanceof WP_REST_Request || '/sml-video-upload-studio/v1/rail' !== $request->get_route() ) {
		return $response;
	}

	if ( is_wp_error( $response ) || ! function_exists( 'sml_vus_visible_videos' ) ) {
		return $response;
	}

	$rest_response = rest_ensure_response( $response );
	$data          = $rest_response->get_data();
	if ( ! is_array( $data ) ) {
		return $response;
	}

	$exclude_id = sanitize_key( (string) $request->get_param( 'video_id' ) );
	$channels   = array();
	foreach ( (array) sml_vus_visible_videos( $exclude_id ) as $video ) {
		$author_id = is_array( $video ) ? absint( $video['author_id'] ?? 0 ) : 0;
		if ( $author_id ) {
			$channels[ $author_id ] = true;
		}
	}

	$data['channel_count'] = count( $channels );
	$rest_response->set_data( $data );

	return $rest_response;
}
add_filter( 'rest_request_after_callbacks', 'sml_home_feed_add_video_channel_count', 10, 3 );
