<?php
/**
 * Plugin Name: SML Channel Banners
 * Description: Owner/admin controlled visual banners for individual SML group channels.
 * Version: 1.0.6
 * Author: Stock Market Loop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_CBANNER_VERSION', '1.0.6' );
define( 'SML_CBANNER_MAX_GIF', 50 * MB_IN_BYTES );
define( 'SML_CBANNER_MAX_IMAGE', 5 * MB_IN_BYTES );

function sml_cbanner_tables(): array {
	global $wpdb;
	$engine = function_exists( 'sml_groups_tables' ) ? sml_groups_tables() : array();
	return array(
		'groups'   => $engine['groups'] ?? $wpdb->prefix . 'sml_groups',
		'members'  => $engine['members'] ?? $wpdb->prefix . 'sml_group_members',
		'channels' => $engine['channels'] ?? $wpdb->prefix . 'sml_group_channels',
	);
}

function sml_cbanner_group_payload( int $group_id ): array {
	$request = new WP_REST_Request( 'GET', '/sml/v1/group' );
	$request->set_param( 'group_id', $group_id );
	$response = rest_do_request( $request );
	if ( is_wp_error( $response ) || $response->get_status() >= 400 ) { return array(); }
	$data = $response->get_data();
	if ( isset( $data['group'] ) && is_array( $data['group'] ) ) { return $data['group']; }
	return is_array( $data ) ? $data : array();
}

function sml_cbanner_can_manage( int $group_id, int $user_id = 0 ): bool {
	global $wpdb;
	$user_id = $user_id ?: get_current_user_id();
	if ( ! $group_id || ! $user_id ) { return false; }
	if ( user_can( $user_id, 'manage_options' ) ) { return true; }
	if ( function_exists( 'sml_groups_current_user_can_manage' ) && sml_groups_current_user_can_manage( $group_id, $user_id ) ) {
		return true;
	}
	$group = sml_cbanner_group_payload( $group_id );
	if ( ! empty( $group['can_manage'] ) || ! empty( $group['can_edit_owner_tools'] ) ) { return true; }
	$tables = sml_cbanner_tables();
	$owner = (int) $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$tables['groups']} WHERE id=%d", $group_id ) );
	if ( $owner === $user_id ) { return true; }
	$role = strtolower( trim( (string) $wpdb->get_var( $wpdb->prepare(
		"SELECT role FROM {$tables['members']} WHERE group_id=%d AND user_id=%d", $group_id, $user_id
	) ) ) );
	return in_array( $role, array( 'owner', 'admin', 'administrator' ), true );
}

function sml_cbanner_channel( int $channel_id, int $group_id ): array {
	global $wpdb;
	$tables = sml_cbanner_tables();
	$row = $wpdb->get_row( $wpdb->prepare(
		"SELECT id, group_id, name FROM {$tables['channels']} WHERE id=%d AND group_id=%d",
		$channel_id,
		$group_id
	), ARRAY_A );
	return is_array( $row ) ? $row : array();
}

function sml_cbanner_channel_by_id( int $channel_id ): array {
	global $wpdb;
	$tables = sml_cbanner_tables();
	$row = $wpdb->get_row( $wpdb->prepare(
		"SELECT id, group_id, name FROM {$tables['channels']} WHERE id=%d",
		$channel_id
	), ARRAY_A );
	return is_array( $row ) ? $row : array();
}

function sml_cbanner_get_all( int $group_id ): array {
	$value = get_option( 'sml_channel_banners_' . $group_id, array() );
	return is_array( $value ) ? $value : array();
}

function sml_cbanner_public_map( int $group_id ): array {
	$map = array();
	foreach ( sml_cbanner_get_all( $group_id ) as $channel_id => $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['url'] ) ) { continue; }
		$map[ (string) absint( $channel_id ) ] = array(
			'url'   => esc_url_raw( (string) $entry['url'] ),
			'zoom'  => max( 100, min( 300, (int) ( $entry['zoom'] ?? 100 ) ) ),
			'pos_x' => max( 0, min( 100, (int) ( $entry['pos_x'] ?? 50 ) ) ),
			'pos_y' => max( 0, min( 100, (int) ( $entry['pos_y'] ?? 50 ) ) ),
		);
	}
	return $map;
}

function sml_cbanner_upload( string $field ) {
	if ( empty( $_FILES[ $field ] ) || ! is_array( $_FILES[ $field ] ) ) {
		return new WP_Error( 'sml_cbanner_missing_file', 'Choose a banner image.', array( 'status' => 400 ) );
	}
	$file = $_FILES[ $field ];
	if ( ! empty( $file['error'] ) ) {
		return new WP_Error( 'sml_cbanner_upload_error', 'The banner upload could not be completed.', array( 'status' => 400 ) );
	}
	$check = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'] );
	$allowed = array( 'image/jpeg', 'image/png', 'image/gif', 'image/webp' );
	if ( empty( $check['type'] ) || ! in_array( $check['type'], $allowed, true ) ) {
		return new WP_Error( 'sml_cbanner_type', 'Choose a JPG, PNG, GIF, or WebP image.', array( 'status' => 415 ) );
	}
	$is_gif = 'image/gif' === $check['type'];
	$limit = $is_gif ? SML_CBANNER_MAX_GIF : SML_CBANNER_MAX_IMAGE;
	if ( (int) ( $file['size'] ?? 0 ) > $limit ) {
		return new WP_Error(
			'sml_cbanner_large',
			$is_gif ? 'GIF banners must be 50 MB or smaller.' : 'JPG, PNG, and WebP banners must be 5 MB or smaller.',
			array( 'status' => 413 )
		);
	}
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';
	$attachment_id = media_handle_upload( $field, 0, array(), array( 'test_form' => false ) );
	if ( is_wp_error( $attachment_id ) ) { return $attachment_id; }
	$url = (string) wp_get_attachment_url( $attachment_id );
	if ( ! $url ) {
		wp_delete_attachment( $attachment_id, true );
		return new WP_Error( 'sml_cbanner_no_url', 'The banner was stored without a usable URL.', array( 'status' => 500 ) );
	}
	return array( 'attachment_id' => (int) $attachment_id, 'url' => esc_url_raw( $url ) );
}

function sml_cbanner_rest_get( WP_REST_Request $request ) {
	$group_id = absint( $request['group_id'] );
	if ( ! $group_id ) { return new WP_Error( 'sml_cbanner_group', 'Group is required.', array( 'status' => 400 ) ); }
	$response = rest_ensure_response( array(
		'banners'    => sml_cbanner_public_map( $group_id ),
		'can_manage' => sml_cbanner_can_manage( $group_id ),
	) );
	$response->header( 'Cache-Control', is_user_logged_in() ? 'private, no-cache' : 'public, max-age=60' );
	return $response;
}

function sml_cbanner_rest_save( WP_REST_Request $request ) {
	$group_id = absint( $request->get_param( 'group_id' ) );
	$channel_id = absint( $request->get_param( 'channel_id' ) );
	if ( ! $group_id || ! $channel_id || ! sml_cbanner_channel( $channel_id, $group_id ) ) {
		return new WP_Error( 'sml_cbanner_channel', 'That channel does not belong to this group.', array( 'status' => 400 ) );
	}
	if ( ! sml_cbanner_can_manage( $group_id ) ) {
		return new WP_Error( 'sml_cbanner_forbidden', 'Only this group’s owner or admin can change channel banners.', array( 'status' => 403 ) );
	}
	$all = sml_cbanner_get_all( $group_id );
	$key = (string) $channel_id;
	$current = isset( $all[ $key ] ) && is_array( $all[ $key ] ) ? $all[ $key ] : array();
	$old_attachment = (int) ( $current['attachment_id'] ?? 0 );
	$remove = (bool) $request->get_param( 'remove' );
	$new_attachment = 0;

	if ( $remove ) {
		unset( $all[ $key ] );
	} else {
		if ( ! empty( $_FILES['banner'] ) ) {
			$uploaded = sml_cbanner_upload( 'banner' );
			if ( is_wp_error( $uploaded ) ) { return $uploaded; }
			$current['attachment_id'] = $uploaded['attachment_id'];
			$current['url'] = $uploaded['url'];
			$new_attachment = (int) $uploaded['attachment_id'];
		}
		if ( empty( $current['url'] ) ) {
			return new WP_Error( 'sml_cbanner_missing_file', 'Choose a banner image first.', array( 'status' => 400 ) );
		}
		$current['zoom'] = max( 100, min( 300, (int) ( $request->get_param( 'zoom' ) ?: 100 ) ) );
		$current['pos_x'] = max( 0, min( 100, (int) ( $request->get_param( 'pos_x' ) ?? 50 ) ) );
		$current['pos_y'] = max( 0, min( 100, (int) ( $request->get_param( 'pos_y' ) ?? 50 ) ) );
		$current['updated_by'] = get_current_user_id();
		$current['updated_at'] = current_time( 'mysql', true );
		$all[ $key ] = $current;
	}

	if ( ! update_option( 'sml_channel_banners_' . $group_id, $all, false ) && get_option( 'sml_channel_banners_' . $group_id, null ) !== $all ) {
		if ( $new_attachment ) { wp_delete_attachment( $new_attachment, true ); }
		return new WP_Error( 'sml_cbanner_store', 'The banner could not be saved.', array( 'status' => 500 ) );
	}
	if ( $old_attachment && $old_attachment !== $new_attachment ) { wp_delete_attachment( $old_attachment, true ); }
	return rest_ensure_response( array(
		'ok' => true,
		'channel_id' => $channel_id,
		'banner' => $remove ? null : sml_cbanner_public_map( $group_id )[ $key ],
	) );
}

/**
 * Compatibility save handler for the established Channel Background control.
 * The legacy plugin used a separate membership lookup that could disagree with
 * the group engine. This route deliberately uses the canonical manage decision.
 */
function sml_cbanner_rest_save_conversation_background( WP_REST_Request $request ) {
	$channel = sml_cbanner_channel_by_id( absint( $request->get_param( 'channel_id' ) ) );
	if ( ! $channel ) {
		return new WP_Error( 'sml_cwm_missing', 'Channel not found.', array( 'status' => 404 ) );
	}
	$group_id = (int) $channel['group_id'];
	if ( ! sml_cbanner_can_manage( $group_id ) ) {
		return new WP_Error( 'sml_cwm_forbidden', 'You cannot change this channel background.', array( 'status' => 403 ) );
	}
	$key = (string) $channel['id'];
	$option_key = 'sml_channel_watermarks_' . $group_id;
	$all = get_option( $option_key, array() );
	$all = is_array( $all ) ? $all : array();
	$current = isset( $all[ $key ] ) && is_array( $all[ $key ] ) ? $all[ $key ] : array();
	if ( null !== $request->get_param( 'analyst_allowed' ) ) {
		$current['analyst_allowed'] = (bool) $request->get_param( 'analyst_allowed' );
	}
	if ( (bool) $request->get_param( 'remove' ) ) {
		unset( $current['attachment_id'], $current['url'] );
	} elseif (
		! empty( $_FILES['watermark'] )
		&& is_array( $_FILES['watermark'] )
		&& UPLOAD_ERR_NO_FILE !== (int) ( $_FILES['watermark']['error'] ?? UPLOAD_ERR_NO_FILE )
	) {
		$uploaded = sml_cbanner_upload( 'watermark' );
		if ( is_wp_error( $uploaded ) ) { return $uploaded; }
		$current['attachment_id'] = $uploaded['attachment_id'];
		$current['url'] = $uploaded['url'];
	}
	$current['opacity'] = max( 0, min( 100, (int) ( $request->get_param( 'opacity' ) ?? ( $current['opacity'] ?? 15 ) ) ) );
	$current['updated_by'] = get_current_user_id();
	$current['updated_at'] = current_time( 'mysql', true );
	$all[ $key ] = $current;
	update_option( $option_key, $all, false );
	return rest_ensure_response( array( 'ok' => true, 'watermark' => $current ) );
}

function sml_cbanner_rest_upload_group_background( WP_REST_Request $request ) {
	$group_id = absint( $request->get_param( 'group_id' ) );
	if ( ! $group_id ) {
		return new WP_Error( 'sml_cwm_missing_group', 'Group not found.', array( 'status' => 404 ) );
	}
	if ( ! sml_cbanner_can_manage( $group_id ) ) {
		return new WP_Error( 'sml_cwm_forbidden', 'Only group owners and admins can change the group background.', array( 'status' => 403 ) );
	}
	$uploaded = sml_cbanner_upload( 'watermark' );
	if ( is_wp_error( $uploaded ) ) { return $uploaded; }
	return rest_ensure_response( array( 'ok' => true ) + $uploaded );
}

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml-channel-visuals/v1', '/groups/(?P<group_id>\d+)/visuals', array(
		'methods' => 'GET',
		'callback' => 'sml_cbanner_rest_get',
		'permission_callback' => '__return_true',
	) );
	register_rest_route( 'sml-channel-visuals/v1', '/visual', array(
		'methods' => 'POST',
		'callback' => 'sml_cbanner_rest_save',
		'permission_callback' => static function () { return is_user_logged_in(); },
	) );
	// Replace only the callbacks for the two legacy routes. Their data shape and
	// option keys stay unchanged, so existing backgrounds continue to work.
	register_rest_route( 'sml/v1', '/group/channel/watermark', array(
		'methods' => 'POST',
		'callback' => 'sml_cbanner_rest_save_conversation_background',
		'permission_callback' => static function () { return is_user_logged_in(); },
		'args' => array( 'channel_id' => array( 'required' => true, 'sanitize_callback' => 'absint' ) ),
	), true );
	register_rest_route( 'sml/v1', '/group/watermark-upload', array(
		'methods' => 'POST',
		'callback' => 'sml_cbanner_rest_upload_group_background',
		'permission_callback' => static function () { return is_user_logged_in(); },
		'args' => array( 'group_id' => array( 'required' => true, 'sanitize_callback' => 'absint' ) ),
	), true );
}, 99 );

add_filter( 'rest_post_dispatch', static function ( $result, $server, $request ) {
	if ( ! ( $result instanceof WP_REST_Response ) || ! ( $request instanceof WP_REST_Request ) ) { return $result; }
	if ( 'GET' !== $request->get_method() || '/sml/v1/group/channels' !== $request->get_route() ) { return $result; }
	$data = $result->get_data();
	if ( ! is_array( $data ) || empty( $data['channels'] ) || ! is_array( $data['channels'] ) ) { return $result; }
	$request_group_id = absint( $request->get_param( 'group_id' ) );
	foreach ( $data['channels'] as &$channel ) {
		if ( ! is_array( $channel ) ) { continue; }
		$group_id = absint( $channel['group_id'] ?? $request_group_id );
		if ( $group_id && sml_cbanner_can_manage( $group_id ) ) {
			$channel['can_manage_watermark'] = true;
			$channel['can_delegate_watermark'] = true;
		}
	}
	unset( $channel );
	$result->set_data( $data );
	return $result;
}, 100, 3 );

add_action( 'wp_enqueue_scripts', static function () {
	if ( is_admin() ) { return; }
	$path = wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH );
	if ( ! preg_match( '#^/groups/[^/]+/?$#i', (string) $path ) ) { return; }
	wp_enqueue_style( 'sml-channel-banners', plugins_url( 'assets/channel-banners.css', __FILE__ ), array(), SML_CBANNER_VERSION );
	wp_enqueue_script( 'sml-channel-banners', plugins_url( 'assets/channel-banners.js', __FILE__ ), array(), SML_CBANNER_VERSION, true );
	wp_localize_script( 'sml-channel-banners', 'SMLChannelBanners', array(
		'api' => esc_url_raw( rest_url( 'sml-channel-visuals/v1/' ) ),
		'nonce' => is_user_logged_in() ? wp_create_nonce( 'wp_rest' ) : '',
	) );
}, 99 );
