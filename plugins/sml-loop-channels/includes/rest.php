<?php
/**
 * REST: sml-channel-design/v1
 *   GET  /design/{handle}        the creator's design (public; what the page uses)
 *   POST /design                 owner: save a patch
 *   POST /media                  owner: multipart file + kind (banner|background|poster); or JSON {kind, remove:true}
 * Also: shareable cache headers on the public channel payload for signed-out readers.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

add_action( 'rest_api_init', function () {
	register_rest_route( SML_LC_NS, '/design/(?P<handle>[A-Za-z0-9_.]+)', array( 'methods' => 'GET', 'callback' => 'sml_lc_rest_get', 'permission_callback' => '__return_true' ) );
	register_rest_route( SML_LC_NS, '/design', array( 'methods' => 'POST', 'callback' => 'sml_lc_rest_save', 'permission_callback' => 'sml_lc_rest_owner' ) );
	register_rest_route( SML_LC_NS, '/media', array( 'methods' => 'POST', 'callback' => 'sml_lc_rest_media', 'permission_callback' => 'sml_lc_rest_owner' ) );
} );

function sml_lc_owner_uid() {
	$uid = get_current_user_id();
	if ( ! $uid ) { return 0; }
	if ( function_exists( 'sml_channel_owner_uid' ) ) { return (int) sml_channel_owner_uid(); }
	return (string) get_user_meta( $uid, 'sml_channel_handle', true ) !== '' ? $uid : 0;
}
function sml_lc_rest_owner() {
	if ( ! is_user_logged_in() ) { return new WP_Error( 'sml_lc_auth', 'Sign in first.', array( 'status' => 401 ) ); }
	if ( ! sml_lc_owner_uid() ) { return new WP_Error( 'sml_lc_no_channel', 'Create a Loop Channel first.', array( 'status' => 403 ) ); }
	return true;
}

function sml_lc_rest_get( $request ) {
	$user = function_exists( 'sml_channel_user_by_handle' ) ? sml_channel_user_by_handle( $request['handle'] ) : false;
	if ( ! $user ) { return new WP_Error( 'sml_lc_missing', 'Channel not found.', array( 'status' => 404 ) ); }
	$res = rest_ensure_response( array( 'ok' => true, 'design' => sml_lc_get( $user->ID ) ) );
	if ( ! is_user_logged_in() ) { $res->header( 'Cache-Control', 'public, max-age=60, s-maxage=300' ); }
	return $res;
}

function sml_lc_rest_save( $request ) {
	$uid   = sml_lc_owner_uid();
	$patch = sml_lc_sanitize( $request->get_json_params() ?: $request->get_params() );
	$d     = sml_lc_put( $uid, $patch );
	return array( 'ok' => true, 'design' => $d );
}

function sml_lc_rest_media( $request ) {
	$uid  = sml_lc_owner_uid();
	$kind = sanitize_key( (string) $request->get_param( 'kind' ) );
	if ( ! in_array( $kind, array( 'banner', 'background', 'poster' ), true ) ) { return new WP_Error( 'sml_lc_kind', 'Unknown slot.', array( 'status' => 400 ) ); }
	if ( $request->get_param( 'remove' ) ) {
		$patch = $kind === 'poster' ? array( 'banner' => array( 'poster' => '' ) ) : array( $kind => array( 'url' => '', 'id' => 0, 'mode' => 'none' ) );
		return array( 'ok' => true, 'design' => sml_lc_put( $uid, $patch ) );
	}
	$files = $request->get_file_params();
	$file  = $files['file'] ?? null;
	if ( ! $file || empty( $file['tmp_name'] ) ) { return new WP_Error( 'sml_lc_nofile', 'Choose a file.', array( 'status' => 400 ) ); }
	$image = array( 'jpg|jpeg|jpe' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif' );
	$video = array( 'mp4|m4v' => 'video/mp4', 'webm' => 'video/webm' );
	$mimes = $kind === 'poster' ? $image : $image + $video;
	$max   = $kind === 'poster' ? 8 * MB_IN_BYTES : 40 * MB_IN_BYTES;
	if ( (int) $file['size'] > $max ) { return new WP_Error( 'sml_lc_big', 'Keep it under ' . size_format( $max ) . '.', array( 'status' => 413 ) ); }
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';
	$check = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'], $mimes );
	if ( empty( $check['type'] ) ) { return new WP_Error( 'sml_lc_type', 'JPG, PNG, WebP, GIF, MP4 or WebM only.', array( 'status' => 415 ) ); }
	$up = wp_handle_upload( $file, array( 'test_form' => false, 'mimes' => $mimes, 'unique_filename_callback' => function ( $dir, $name, $ext ) use ( $uid, $kind ) { return 'loop-channel-' . $uid . '-' . $kind . '-' . substr( md5( $name . microtime() ), 0, 8 ) . $ext; } ) );
	if ( ! empty( $up['error'] ) ) { return new WP_Error( 'sml_lc_upload', $up['error'], array( 'status' => 400 ) ); }
	$att = wp_insert_attachment( array( 'post_mime_type' => $up['type'], 'post_title' => 'Loop Channel ' . $kind, 'post_status' => 'inherit', 'post_author' => $uid ), $up['file'] );
	$att = is_wp_error( $att ) ? 0 : (int) $att;
	if ( $att && strpos( $up['type'], 'image/' ) === 0 ) { wp_update_attachment_metadata( $att, wp_generate_attachment_metadata( $att, $up['file'] ) ); }
	$is_video = strpos( $up['type'], 'video/' ) === 0;
	if ( $kind === 'poster' ) { $patch = array( 'banner' => array( 'poster' => $up['url'] ) ); }
	else { $patch = array( $kind => array( 'url' => $up['url'], 'id' => $att, 'mode' => $is_video ? 'video' : 'image' ) ); }
	return array( 'ok' => true, 'url' => $up['url'], 'id' => $att, 'type' => $up['type'], 'design' => sml_lc_put( $uid, $patch ) );
}

/* The channel payload is identical for every signed-out reader; let the edge share it. Runs after the legacy no-store filter. */
add_filter( 'rest_post_dispatch', function ( $response, $server, $request ) {
	if ( is_user_logged_in() || 'GET' !== $request->get_method() ) { return $response; }
	$route = $request->get_route();
	if ( preg_match( '#^/sml-channel/v1/channel/[A-Za-z0-9_.]+(/community)?$#', $route ) ) {
		$response = rest_ensure_response( $response );
		$response->header( 'Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120' );
		$response->header( 'Pragma', 'cache' );
	}
	return $response;
}, 20, 3 );
