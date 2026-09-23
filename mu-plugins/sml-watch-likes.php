<?php
/**
 * Plugin Name: SML Watch Likes
 * Description: Makes the like button on live, scheduled-live and (premiere) video watch pages show its real count. The reaction engine answers /summary with { items: { id: { counts, mine } } } and only for `ids=`, but the watch pages send `content_id=` (and, for uploads, a video slug that sml-creator-comments turns into a numeric id). This folds content_id into ids and stops the edge caching the per-viewer `mine` flag. 2026-09-23.
 * Version: 1.0.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

/* priority 6: after sml-creator-comments (5) has turned a video slug into its numeric index id */
add_filter( 'rest_pre_dispatch', function ( $result, $server, $request ) {
	if ( null !== $result || '/sml-reactions/v1/summary' !== $request->get_route() ) { return $result; }
	$ids = $request->get_param( 'ids' );
	$has = is_array( $ids ) ? (bool) array_filter( $ids ) : '' !== trim( (string) $ids );
	if ( $has ) { return $result; }
	$cid = absint( $request->get_param( 'content_id' ) );
	if ( $cid ) { $request->set_param( 'ids', (string) $cid ); }
	return $result;
}, 6, 3 );

add_filter( 'rest_post_dispatch', function ( $response, $server, $request ) {
	if ( $response instanceof WP_REST_Response && '/sml-reactions/v1/summary' === $request->get_route() ) {
		$response->header( 'Cache-Control', 'no-store, private' );   /* `mine` differs per viewer and a like must show at once */
	}
	return $response;
}, 10, 3 );

/* Live and scheduled-live streams have no row in wp_sml_video_index (which is what the engine's long_video store checks), so
   live-watch.js likes a stream through a stable hash id in this reserved range: 1e13 + fnv32 * 65536 + 16 more bits.
   Answer "exists" for that range only, ahead of the engine's own store check (priority 5). */
add_filter( 'sml_reaction_content_exists_long_video', function ( $answer, $content_id ) {
	$id = (int) $content_id;
	return ( $id >= 10000000000000 && $id < 10000000000000 + 4294967296 * 65536 ) ? true : $answer;
}, 4, 2 );
