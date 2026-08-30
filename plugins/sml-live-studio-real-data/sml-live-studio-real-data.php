<?php
/**
 * Plugin Name: SML Live Studio Real Data
 * Description: Replaces Creator Studio overlay demo content with the creator's real subscriber count and shared Watch Page chat.
 * Version: 1.1.2
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_lsrd_is_go_live_page() {
	if ( is_admin() ) { return false; }
	if ( is_page( 'go-live' ) ) { return true; }
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	return 'go-live' === $path;
}

function sml_lsrd_enqueue() {
	if ( ! sml_lsrd_is_go_live_page() ) { return; }
	wp_enqueue_script(
		'sml-live-studio-real-data',
		plugins_url( 'assets/live-studio-real-data.js', __FILE__ ),
		array(),
		'1.1.2',
		true
	);
}
add_action( 'wp_enqueue_scripts', 'sml_lsrd_enqueue', 9999 );

/*
 * /go-live/ is rendered by a standalone plugin template that does not call
 * wp_head() or wp_footer(). Keep the normal enqueue for compatibility, then
 * inject the same asset into that standalone response at the final boundary.
 */
function sml_lsrd_inject_standalone_asset( $html ) {
	if ( false !== strpos( $html, 'sml-live-studio-real-data.js' ) ) { return $html; }
	$src = esc_url( plugins_url( 'assets/live-studio-real-data.js', __FILE__ ) ) . '?ver=1.1.2';
	$tag = '<script src="' . $src . '" defer></script>';
	if ( false !== stripos( $html, '</body>' ) ) {
		return preg_replace( '/<\/body>/i', $tag . '</body>', $html, 1 );
	}
	return $html . $tag;
}

function sml_lsrd_buffer_go_live() {
	if ( ! sml_lsrd_is_go_live_page() ) { return; }
	ob_start( 'sml_lsrd_inject_standalone_asset' );
}
add_action( 'template_redirect', 'sml_lsrd_buffer_go_live', -9999 );

function sml_lsrd_can_read_creator_status( WP_REST_Request $request ) {
	if ( ! is_user_logged_in() ) { return false; }
	$creator_id = absint( $request->get_param( 'creator_id' ) );
	return $creator_id && ( get_current_user_id() === $creator_id || current_user_can( 'manage_options' ) );
}

function sml_lsrd_creator_status( WP_REST_Request $request ) {
	$creator_id = absint( $request->get_param( 'creator_id' ) );
	$count = function_exists( 'sml_creator_subscription_count' )
		? max( 0, (int) sml_creator_subscription_count( $creator_id ) )
		: 0;
	return rest_ensure_response( array( 'subscriber_count' => $count ) );
}

function sml_lsrd_delete_upcoming( WP_REST_Request $request ) {
	$current_user_id = get_current_user_id();
	$owner_id       = absint( $request->get_param( 'owner_id' ) );
	$user_id        = $owner_id ? $owner_id : $current_user_id;
	$stream_id = sanitize_key( (string) $request->get_param( 'stream_id' ) );
	if ( ! $current_user_id || ! $user_id || ! $stream_id || ! function_exists( 'sml_scheduled_live_row' ) || ! function_exists( 'sml_scheduled_live_store' ) ) {
		return new WP_Error( 'sml_lsrd_stream_unavailable', 'That upcoming stream could not be found.', array( 'status' => 404 ) );
	}
	if ( $user_id !== $current_user_id && ! current_user_can( 'manage_options' ) ) {
		return new WP_Error( 'sml_lsrd_stream_not_owned', 'That upcoming stream does not belong to this creator.', array( 'status' => 404 ) );
	}
	$row = sml_scheduled_live_row( $user_id, $stream_id );
	if ( empty( $row['id'] ) ) {
		return new WP_Error( 'sml_lsrd_stream_not_owned', 'That upcoming stream does not belong to this creator.', array( 'status' => 404 ) );
	}
	/* A missed scheduled time is not the same as a stream that actually
	 * started. Keep stale, never-started schedules removable; only the real
	 * lifecycle status can close this creator action. */
	if ( 'scheduled' !== ( $row['status'] ?? '' ) ) {
		return new WP_Error( 'sml_lsrd_stream_started', 'A stream can only be deleted before it starts.', array( 'status' => 409 ) );
	}
	$row['status']     = 'cancelled';
	$row['updated_at'] = gmdate( 'c' );
	sml_scheduled_live_store( $user_id, $row, false );
	if ( function_exists( 'sml_scheduled_live_read' ) && function_exists( 'sml_scheduled_live_set_next_current' ) ) {
		$current = sml_scheduled_live_read( $user_id );
		if ( ! empty( $current['id'] ) && sanitize_key( (string) $current['id'] ) === $stream_id ) {
			sml_scheduled_live_set_next_current( $user_id );
		}
	}
	return rest_ensure_response( array( 'ok' => true, 'cancelled' => true, 'stream_id' => $stream_id ) );
}

function sml_lsrd_admin_upcoming() {
	if ( ! current_user_can( 'manage_options' ) || ! function_exists( 'sml_scheduled_live_library_key' ) || ! function_exists( 'sml_scheduled_live_creator_library' ) ) {
		return new WP_Error( 'sml_lsrd_admin_forbidden', 'Administrator access is required.', array( 'status' => 403 ) );
	}
	$owner_ids = get_users( array(
		'fields'   => 'ID',
		'meta_key' => sml_scheduled_live_library_key(),
		'number'   => 2000,
	) );
	$streams = array();
	foreach ( $owner_ids as $owner_id ) {
		foreach ( sml_scheduled_live_creator_library( absint( $owner_id ) ) as $row ) {
			if ( 'scheduled' !== ( $row['status'] ?? '' ) ) { continue; }
			$row['owner_id'] = absint( $owner_id );
			$streams[] = $row;
		}
	}
	return rest_ensure_response( array( 'streams' => $streams ) );
}

function sml_lsrd_register_routes() {
	register_rest_route( 'sml-live-studio-real-data/v1', '/creator-status', array(
		'methods'             => WP_REST_Server::READABLE,
		'callback'            => 'sml_lsrd_creator_status',
		'permission_callback' => 'sml_lsrd_can_read_creator_status',
		'args'                => array( 'creator_id' => array( 'required' => true, 'type' => 'integer' ) ),
	) );
	register_rest_route( 'sml-live-studio-real-data/v1', '/upcoming/(?P<stream_id>[A-Za-z0-9]{8,32})', array(
		'methods'             => WP_REST_Server::DELETABLE,
		'callback'            => 'sml_lsrd_delete_upcoming',
		'permission_callback' => 'is_user_logged_in',
	) );
	register_rest_route( 'sml-live-studio-real-data/v1', '/admin-upcoming', array(
		'methods'             => WP_REST_Server::READABLE,
		'callback'            => 'sml_lsrd_admin_upcoming',
		'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
	) );
}
add_action( 'rest_api_init', 'sml_lsrd_register_routes' );

