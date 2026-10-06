<?php
/**
 * Plugin Name: SML Group Extras
 * Description: Channel descriptions (180 characters, for discovery), rich message formatting (bold, headers, sizes, colours) and a tidier owner menu on group pages.
 * Version: 1.0.0
 * Requires PHP: 7.4
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_GEX_VERSION', '1.0.0' );
define( 'SML_GEX_DESC_MAX', 180 );

/** One clean description: no tags, one line of spaces, at most 180 characters. */
function sml_gex_clean_description( $text ): string {
	$text = is_string( $text ) ? wp_strip_all_tags( $text ) : '';
	$text = trim( (string) preg_replace( '/\s+/u', ' ', $text ) );
	$text = preg_replace( '/[\x00-\x1F\x7F]/u', '', $text );
	if ( function_exists( 'mb_substr' ) ) { $text = mb_substr( $text, 0, SML_GEX_DESC_MAX ); } else { $text = substr( $text, 0, SML_GEX_DESC_MAX ); }
	return trim( (string) $text );
}

function sml_gex_tables(): array {
	global $wpdb;
	$engine = function_exists( 'sml_groups_tables' ) ? sml_groups_tables() : array();
	return array(
		'groups'   => $engine['groups'] ?? $wpdb->prefix . 'sml_groups',
		'members'  => $engine['members'] ?? $wpdb->prefix . 'sml_group_members',
		'channels' => $engine['channels'] ?? $wpdb->prefix . 'sml_group_channels',
	);
}

function sml_gex_can_manage( int $group_id, int $user_id = 0 ): bool {
	global $wpdb;
	$user_id = $user_id ?: get_current_user_id();
	if ( ! $group_id || ! $user_id ) { return false; }
	if ( user_can( $user_id, 'manage_options' ) ) { return true; }
	if ( function_exists( 'sml_groups_current_user_can_manage' ) && sml_groups_current_user_can_manage( $group_id, $user_id ) ) { return true; }
	$t = sml_gex_tables();
	if ( (int) $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$t['groups']} WHERE id=%d", $group_id ) ) === $user_id ) { return true; }
	$role = strtolower( trim( (string) $wpdb->get_var( $wpdb->prepare( "SELECT role FROM {$t['members']} WHERE group_id=%d AND user_id=%d", $group_id, $user_id ) ) ) );
	return in_array( $role, array( 'owner', 'admin', 'administrator' ), true );
}

function sml_gex_channel_in_group( int $channel_id, int $group_id ): bool {
	global $wpdb;
	$t = sml_gex_tables();
	return (int) $wpdb->get_var( $wpdb->prepare( "SELECT group_id FROM {$t['channels']} WHERE id=%d", $channel_id ) ) === $group_id && $group_id > 0;
}

function sml_gex_descriptions( int $group_id ): array {
	$all = get_option( 'sml_channel_desc_' . $group_id, array() );
	$out = array();
	foreach ( is_array( $all ) ? $all : array() as $cid => $text ) {
		$clean = sml_gex_clean_description( $text );
		if ( '' !== $clean ) { $out[ (string) absint( $cid ) ] = $clean; }
	}
	return $out;
}

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml-gextras/v1', '/groups/(?P<group_id>\d+)/descriptions', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => static function ( WP_REST_Request $request ) {
			$group_id = absint( $request['group_id'] );
			$response = rest_ensure_response( array( 'descriptions' => sml_gex_descriptions( $group_id ), 'can_manage' => sml_gex_can_manage( $group_id ), 'max' => SML_GEX_DESC_MAX ) );
			$response->header( 'Cache-Control', is_user_logged_in() ? 'private, no-cache' : 'public, max-age=60' );
			return $response;
		},
	) );
	register_rest_route( 'sml-gextras/v1', '/description', array(
		'methods'             => 'POST',
		'permission_callback' => static function () { return is_user_logged_in(); },
		'callback'            => static function ( WP_REST_Request $request ) {
			$group_id   = absint( $request->get_param( 'group_id' ) );
			$channel_id = absint( $request->get_param( 'channel_id' ) );
			if ( ! sml_gex_channel_in_group( $channel_id, $group_id ) ) { return new WP_Error( 'sml_gex_channel', 'That channel does not belong to this group.', array( 'status' => 400 ) ); }
			if ( ! sml_gex_can_manage( $group_id ) ) { return new WP_Error( 'sml_gex_forbidden', 'Only this group’s owner or admin can change channel descriptions.', array( 'status' => 403 ) ); }
			$text = sml_gex_clean_description( (string) $request->get_param( 'description' ) );
			$all  = get_option( 'sml_channel_desc_' . $group_id, array() );
			$all  = is_array( $all ) ? $all : array();
			if ( '' === $text ) { unset( $all[ (string) $channel_id ] ); } else { $all[ (string) $channel_id ] = $text; }
			update_option( 'sml_channel_desc_' . $group_id, $all, false );
			return rest_ensure_response( array( 'ok' => true, 'channel_id' => $channel_id, 'description' => $text ) );
		},
	) );
} );

/* Every consumer of the channel list (the group shell, discovery, search) gets each channel's description. */
add_filter( 'rest_post_dispatch', static function ( $result, $server, $request ) {
	if ( ! ( $result instanceof WP_REST_Response ) || ! ( $request instanceof WP_REST_Request ) ) { return $result; }
	if ( 'GET' !== $request->get_method() || '/sml/v1/group/channels' !== $request->get_route() ) { return $result; }
	$data = $result->get_data();
	if ( ! is_array( $data ) || empty( $data['channels'] ) || ! is_array( $data['channels'] ) ) { return $result; }
	$cache = array();
	foreach ( $data['channels'] as &$channel ) {
		if ( ! is_array( $channel ) ) { continue; }
		$gid = absint( $channel['group_id'] ?? $request->get_param( 'group_id' ) );
		if ( ! $gid ) { continue; }
		if ( ! isset( $cache[ $gid ] ) ) { $cache[ $gid ] = sml_gex_descriptions( $gid ); }
		$channel['description'] = $cache[ $gid ][ (string) absint( $channel['id'] ?? 0 ) ] ?? '';
	}
	unset( $channel );
	$result->set_data( $data );
	return $result;
}, 101, 3 );

add_action( 'wp_enqueue_scripts', static function () {
	if ( is_admin() ) { return; }
	$path = wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH );
	if ( ! preg_match( '#^/groups/[^/]+/?$#i', (string) $path ) ) { return; }
	wp_enqueue_style( 'sml-group-extras', plugins_url( 'assets/gextras.css', __FILE__ ), array(), SML_GEX_VERSION );
	wp_enqueue_script( 'sml-group-extras', plugins_url( 'assets/gextras.js', __FILE__ ), array(), SML_GEX_VERSION, true );
	wp_localize_script( 'sml-group-extras', 'SMLGroupExtras', array(
		'api'   => esc_url_raw( rest_url( 'sml-gextras/v1/' ) ),
		'nonce' => is_user_logged_in() ? wp_create_nonce( 'wp_rest' ) : '',
		'max'   => SML_GEX_DESC_MAX,
	) );
}, 60 );
