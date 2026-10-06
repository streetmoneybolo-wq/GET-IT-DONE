<?php
/**
 * Plugin Name: SML Onboarding - Up To 9 Featured Channels
 * Description: Lets group owners feature up to 9 channels in the onboarding flow. The onboarding service keeps only the first 5, so this keeps the owner's full list (up to 9) beside it and puts it back into the editor and the member flow. Works with the existing onboarding service without changing it. Deactivate to return to 5.
 * Version: 1.1.0
 * Requires PHP: 7.4
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_OF9_MAX', 9 );

/* ---------- pure helpers (unit-tested) ---------- */

/** Unique positive channel ids, in order, at most 9, only those in $valid (when given). */
function sml_of9_clean( $ids, $valid = null ): array {
	$out = array();
	foreach ( is_array( $ids ) ? $ids : array() as $id ) {
		$id = (int) $id;
		if ( $id <= 0 || in_array( $id, $out, true ) ) { continue; }
		if ( is_array( $valid ) && ! in_array( $id, $valid, true ) ) { continue; }
		$out[] = $id;
		if ( count( $out ) >= SML_OF9_MAX ) { break; }
	}
	return $out;
}

/**
 * Move channels between the featured and the other list so the featured list is exactly $ids, in that order.
 * Both lists hold channel objects with an 'id'. Anything that does not look like that is left alone.
 */
function sml_of9_partition( $featured, $other, array $ids ): ?array {
	$all = array();
	foreach ( array_merge( is_array( $featured ) ? $featured : array(), is_array( $other ) ? $other : array() ) as $ch ) {
		if ( ! is_array( $ch ) || ! isset( $ch['id'] ) ) { return null; }
		$all[ (int) $ch['id'] ] = $ch;
	}
	$feat = array(); $rest = array();
	foreach ( $ids as $id ) { if ( isset( $all[ $id ] ) ) { $c = $all[ $id ]; if ( array_key_exists( 'featured', $c ) ) { $c['featured'] = true; } $feat[] = $c; unset( $all[ $id ] ); } }
	foreach ( $all as $c ) { if ( array_key_exists( 'featured', $c ) ) { $c['featured'] = false; } $rest[] = $c; }
	return array( $feat, $rest );
}

/**
 * The locked-channel overlay lists overlay.featured as [{id,name}]. Make it exactly $ids (in that order, never an open channel), reusing the names it
 * already has and taking the rest from $names (id => name). Returns null when the list does not look like that.
 */
function sml_of9_overlay_featured( $featured, array $ids, array $open_ids, array $names ): ?array {
	if ( ! is_array( $featured ) ) { return null; }
	$have = array();
	foreach ( $featured as $c ) { if ( ! is_array( $c ) || ! isset( $c['id'] ) ) { return null; } $have[ (int) $c['id'] ] = $c; }
	$out = array();
	foreach ( $ids as $id ) {
		if ( in_array( $id, $open_ids, true ) ) { continue; }
		if ( isset( $have[ $id ] ) ) { $out[] = $have[ $id ]; }
		elseif ( isset( $names[ $id ] ) ) { $out[] = array( 'id' => $id, 'name' => $names[ $id ] ); }
	}
	return $out;
}

/* ---------- WordPress side ---------- */

function sml_of9_group_id( string $slug ): int {
	global $wpdb;
	$slug = sanitize_title( $slug );
	return '' === $slug ? 0 : (int) $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$wpdb->prefix}sml_groups WHERE slug = %s LIMIT 1", $slug ) );
}
function sml_of9_group_channel_ids( int $group_id ): array {
	global $wpdb;
	return array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( "SELECT id FROM {$wpdb->prefix}sml_group_channels WHERE group_id = %d", $group_id ) ) );
}
function sml_of9_saved( int $group_id ): array {
	$v = get_option( 'sml_onboard_feat9_' . $group_id, array() );
	return sml_of9_clean( is_array( $v ) ? $v : array() );
}

add_filter( 'rest_post_dispatch', static function ( $response, $server, $request ) {
	if ( ! $request instanceof WP_REST_Request || ! $response instanceof WP_REST_Response || $response->get_status() >= 300 ) { return $response; }
	$route = $request->get_route();
	if ( ! in_array( $route, array( '/sml-onboard/v1/config', '/sml-onboard/v1/flow', '/sml-onboard/v1/access' ), true ) ) { return $response; }
	$group_id = sml_of9_group_id( (string) $request->get_param( 'slug' ) );
	if ( ! $group_id ) { return $response; }
	$data = $response->get_data();
	if ( ! is_array( $data ) ) { return $response; }

	if ( '/sml-onboard/v1/config' === $route && 'POST' === $request->get_method() ) {
		/* the service already checked that this person manages the group; keep the full list beside its own */
		$body = $request->get_json_params();
		$ids  = sml_of9_clean( is_array( $body ) ? ( $body['featured_channels'] ?? array() ) : array(), sml_of9_group_channel_ids( $group_id ) );
		update_option( 'sml_onboard_feat9_' . $group_id, $ids, false );
		if ( count( $ids ) > 5 ) {
			if ( isset( $data['config'] ) && is_array( $data['config'] ) ) { $data['config']['featured_channels'] = $ids; }
			elseif ( array_key_exists( 'featured_channels', $data ) ) { $data['featured_channels'] = $ids; }
			$response->set_data( $data );
		}
		return $response;
	}

	$ids = sml_of9_saved( $group_id );
	if ( count( $ids ) <= 5 ) { return $response; }

	if ( '/sml-onboard/v1/config' === $route ) {
		if ( isset( $data['config'] ) && is_array( $data['config'] ) ) { $data['config']['featured_channels'] = $ids; $response->set_data( $data ); }
		return $response;
	}
	/* member flow / access: featured_channels and other_channels, at the top level or inside 'flow' */
	if ( isset( $data['overlay'] ) && is_array( $data['overlay'] ) && array_key_exists( 'featured', $data['overlay'] ) ) {
		global $wpdb;
		$rows  = $wpdb->get_results( $wpdb->prepare( "SELECT id, name FROM {$wpdb->prefix}sml_group_channels WHERE group_id = %d", $group_id ), ARRAY_A );
		$names = array();
		foreach ( (array) $rows as $r ) { $names[ (int) $r['id'] ] = (string) $r['name']; }
		$open  = array_map( 'intval', (array) ( $data['open_channels'] ?? array() ) );
		$f = sml_of9_overlay_featured( $data['overlay']['featured'], $ids, $open, $names );
		if ( null !== $f ) { $data['overlay']['featured'] = $f; $response->set_data( $data ); }
		return $response;
	}
	$apply = static function ( array $h ) use ( $ids ) {
		if ( ! array_key_exists( 'featured_channels', $h ) || ! array_key_exists( 'other_channels', $h ) ) { return $h; }
		$p = sml_of9_partition( $h['featured_channels'], $h['other_channels'], $ids );
		if ( null === $p ) { return $h; }
		$h['featured_channels'] = $p[0]; $h['other_channels'] = $p[1];
		return $h;
	};
	$data = $apply( $data );
	if ( isset( $data['flow'] ) && is_array( $data['flow'] ) ) { $data['flow'] = $apply( $data['flow'] ); }
	$response->set_data( $data );
	return $response;
}, 40, 3 );
