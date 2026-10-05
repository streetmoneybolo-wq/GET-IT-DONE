<?php
/**
 * Who may use the tools inside a group, and at what level.
 *   none     - not a member (or not logged in)
 *   preview  - a member on the free level: sees the headline of each tool
 *   full     - Premium, analyst, moderator, admin, the group owner, and site admins
 * Reads the groups engine tables (sml_groups, sml_group_members) and never writes them.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sml_gpro_tables() {
	global $wpdb;
	return array(
		'groups'  => $wpdb->prefix . 'sml_groups',
		'members' => $wpdb->prefix . 'sml_group_members',
	);
}

function sml_gpro_group_by_slug( $slug ) {
	global $wpdb;
	$slug = sanitize_title( (string) $slug );
	if ( '' === $slug ) {
		return null;
	}
	$t   = sml_gpro_tables();
	$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['groups']} WHERE slug=%s LIMIT 1", $slug ), ARRAY_A );
	return $row ?: null;
}

function sml_gpro_group( $group_id ) {
	global $wpdb;
	$group_id = absint( $group_id );
	if ( ! $group_id ) {
		return null;
	}
	$t   = sml_gpro_tables();
	$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['groups']} WHERE id=%d", $group_id ), ARRAY_A );
	return $row ?: null;
}

function sml_gpro_engine_role( $group_id, $user_id ) {
	global $wpdb;
	$t    = sml_gpro_tables();
	$role = $wpdb->get_var( $wpdb->prepare( "SELECT role FROM {$t['members']} WHERE group_id=%d AND user_id=%d", absint( $group_id ), absint( $user_id ) ) );
	return null === $role ? null : sanitize_key( (string) $role );
}

/** Pure decision, separated so it can be tested without WordPress. */
function sml_gpro_level_for( $is_site_admin, $is_owner, $role ) {
	if ( $is_site_admin || $is_owner ) {
		return 'full';
	}
	if ( null === $role || '' === $role ) {
		return 'none';
	}
	return in_array( $role, array( 'premium', 'analyst', 'mod', 'admin', 'owner' ), true ) ? 'full' : 'preview';
}

/** Pure: may this role curate the group's watchlist? */
function sml_gpro_can_curate( $is_site_admin, $is_owner, $role ) {
	return (bool) ( $is_site_admin || $is_owner || in_array( $role, array( 'analyst', 'mod', 'admin', 'owner' ), true ) );
}

function sml_gpro_viewer( $group_id, $user_id = 0 ) {
	$user_id = $user_id ? absint( $user_id ) : get_current_user_id();
	$group   = sml_gpro_group( $group_id );
	if ( ! $group || ! $user_id ) {
		return array( 'level' => 'none', 'role' => null, 'can_curate' => false );
	}
	$is_admin = user_can( $user_id, 'manage_options' );
	$is_owner = (int) $group['owner_id'] === $user_id;
	$role     = sml_gpro_engine_role( $group_id, $user_id );
	return array(
		'level'      => sml_gpro_level_for( $is_admin, $is_owner, $role ),
		'role'       => $role,
		'can_curate' => sml_gpro_can_curate( $is_admin, $is_owner, $role ),
	);
}

/* ---- group watchlist (the dashboard's tickers), curated by analysts and managers ---- */

function sml_gpro_clean_symbols( $list ) {
	$out = array();
	foreach ( (array) $list as $s ) {
		$s = strtoupper( trim( (string) $s ) );
		if ( preg_match( '/^[A-Z][A-Z0-9.\-]{0,9}$/', $s ) ) {
			$out[ $s ] = $s;
		}
		if ( count( $out ) >= 12 ) {
			break;
		}
	}
	return array_values( $out );
}

function sml_gpro_watchlist( $group_id ) {
	$list = get_option( 'sml_gpro_watch_' . absint( $group_id ), array() );
	return sml_gpro_clean_symbols( is_array( $list ) ? $list : array() );
}

function sml_gpro_save_watchlist( $group_id, $list ) {
	$clean = sml_gpro_clean_symbols( $list );
	update_option( 'sml_gpro_watch_' . absint( $group_id ), $clean, false );
	return $clean;
}
