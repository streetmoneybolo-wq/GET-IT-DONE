<?php
/**
 * REST: sml-gpro/v1
 *   POST /run        { group_id, tool, symbol|symbols, params }   -> the tool's result (full or preview)
 *   GET  /watchlist  ?group_id=                                   -> the group's dashboard tickers
 *   POST /watchlist  { group_id, symbols[] }                      -> analysts, moderators, admins and the owner only
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sml_gpro_tools() {
	return array( 'setups', 'absorption', 'darkpool', 'strategies', 'sentiment', 'dashboard', 'leaders' );
}

function sml_gpro_perm_member( $request ) {
	if ( ! is_user_logged_in() ) {
		return false;
	}
	$viewer = sml_gpro_viewer( absint( $request->get_param( 'group_id' ) ) );
	return 'none' !== $viewer['level'];
}

function sml_gpro_rest_run( WP_REST_Request $request ) {
	$group_id = absint( $request->get_param( 'group_id' ) );
	$viewer   = sml_gpro_viewer( $group_id );
	if ( 'none' === $viewer['level'] ) {
		return new WP_Error( 'gpro_forbidden', 'Join the group to use its tools.', array( 'status' => 403 ) );
	}
	$tool = sanitize_key( (string) $request->get_param( 'tool' ) );
	if ( ! in_array( $tool, sml_gpro_tools(), true ) ) {
		return new WP_Error( 'gpro_tool', 'Unknown tool.', array( 'status' => 400 ) );
	}
	$symbol = strtoupper( trim( (string) $request->get_param( 'symbol' ) ) );
	if ( '' !== $symbol && ! preg_match( '/^[A-Z][A-Z0-9.\-]{0,9}$/', $symbol ) ) {
		return new WP_Error( 'gpro_symbol', 'That ticker does not look right.', array( 'status' => 400 ) );
	}
	$symbols = $request->get_param( 'symbols' );
	if ( 'dashboard' === $tool && ( ! is_array( $symbols ) || ! $symbols ) ) {
		$symbols = sml_gpro_watchlist( $group_id ); // the dashboard defaults to the group's list
	}
	$symbols = is_array( $symbols ) ? sml_gpro_clean_symbols( $symbols ) : array();
	if ( in_array( $tool, array( 'dashboard', 'leaders' ), true ) ) {
		if ( ! $symbols ) {
			return array( 'ok' => true, 'rows' => array(), 'empty' => true, 'note' => 'No tickers on this group\'s list yet.', 'level' => $viewer['level'], 'can_curate' => $viewer['can_curate'] );
		}
	} elseif ( '' === $symbol ) {
		return new WP_Error( 'gpro_symbol', 'Enter a ticker.', array( 'status' => 400 ) );
	}
	$params  = $request->get_param( 'params' );
	$preview = 'preview' === $viewer['level'];
	$payload = sml_gpro_payload( $tool, $group_id, get_current_user_id(), $symbol, $symbols, is_array( $params ) ? $params : array(), $preview );

	// A short shared cache keeps a busy group from sending one platform call per member per refresh.
	$key = 'sml_gpro_' . md5( wp_json_encode( $payload ) );
	$hit = get_transient( $key );
	if ( is_array( $hit ) ) {
		$hit['level']      = $viewer['level'];
		$hit['can_curate'] = $viewer['can_curate'];
		return $hit;
	}
	$result = sml_gpro_call( $payload );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$ttl = in_array( $tool, array( 'absorption', 'darkpool' ), true ) ? 6 : 20;
	set_transient( $key, $result, $ttl );
	$result['level']      = $viewer['level'];
	$result['can_curate'] = $viewer['can_curate'];
	return $result;
}

function sml_gpro_rest_watchlist_get( WP_REST_Request $request ) {
	$group_id = absint( $request->get_param( 'group_id' ) );
	$viewer   = sml_gpro_viewer( $group_id );
	return array( 'ok' => true, 'symbols' => sml_gpro_watchlist( $group_id ), 'can_curate' => $viewer['can_curate'] );
}

function sml_gpro_rest_watchlist_post( WP_REST_Request $request ) {
	$group_id = absint( $request->get_param( 'group_id' ) );
	$viewer   = sml_gpro_viewer( $group_id );
	if ( ! $viewer['can_curate'] ) {
		return new WP_Error( 'gpro_forbidden', 'Only analysts, moderators and the group owner can change the list.', array( 'status' => 403 ) );
	}
	$symbols = $request->get_param( 'symbols' );
	if ( is_string( $symbols ) ) {
		$symbols = preg_split( '/[\s,]+/', $symbols );
	}
	return array( 'ok' => true, 'symbols' => sml_gpro_save_watchlist( $group_id, is_array( $symbols ) ? $symbols : array() ), 'can_curate' => true );
}

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml-gpro/v1', '/run', array(
		'methods'             => 'POST',
		'callback'            => 'sml_gpro_rest_run',
		'permission_callback' => 'sml_gpro_perm_member',
	) );
	register_rest_route( 'sml-gpro/v1', '/watchlist', array(
		array( 'methods' => 'GET', 'callback' => 'sml_gpro_rest_watchlist_get', 'permission_callback' => 'sml_gpro_perm_member' ),
		array( 'methods' => 'POST', 'callback' => 'sml_gpro_rest_watchlist_post', 'permission_callback' => 'sml_gpro_perm_member' ),
	) );
} );
