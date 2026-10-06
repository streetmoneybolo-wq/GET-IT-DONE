<?php
/**
 * sml-hub/v1 REST routes.
 *
 * All group routes take the numeric engine group id; permission callbacks
 * enforce cookie auth + X-WP-Nonce for writes (core does that for logged-in
 * requests) and the hub permission each action needs.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sml_hub_rest_error( $code, $message, $status = 400 ) {
	return new WP_Error( $code, $message, array( 'status' => $status ) );
}

function sml_hub_perm( $perm ) {
	return static function ( $request ) use ( $perm ) {
		$gid = absint( $request->get_param( 'group_id' ) );
		if ( ! $gid || ! is_user_logged_in() ) {
			return false;
		}
		return sml_hub_is_manager( $gid ) || sml_hub_can( $gid, $perm );
	};
}

function sml_hub_prefs( $group_id ) {
	$p = get_option( 'sml_hub_prefs_' . absint( $group_id ), array() );
	$p = is_array( $p ) ? $p : array();
	return array(
		'hide_legacy' => array_key_exists( 'hide_legacy', $p ) ? (bool) $p['hide_legacy'] : true,
	);
}

/** Which companion features are installed on this site, so the hub only shows real buttons. */
function sml_hub_features() {
	$namespaces = array();
	if ( function_exists( 'rest_get_server' ) ) {
		$namespaces = rest_get_server()->get_namespaces();
	}
	return array(
		'discord'    => function_exists( 'sml_dgc_connector' ),
		'billing'    => function_exists( 'sml_platform_group_plans' ),
		'categories' => in_array( 'sml-gcat/v1', $namespaces, true ) || function_exists( 'sml_gcat_read' ),
		'onboarding' => in_array( 'sml-onboard/v1', $namespaces, true ),
		'visuals'    => function_exists( 'sml_gvz_get' ),
		'socials'    => true,
	);
}

function sml_hub_channels( $group_id ) {
	global $wpdb;
	$t    = sml_hub_tables();
	$rows = $wpdb->get_results( $wpdb->prepare( "SELECT id, name, type, order_index, is_locked FROM {$t['channels']} WHERE group_id=%d ORDER BY order_index ASC, id ASC", absint( $group_id ) ), ARRAY_A );
	$cats = function_exists( 'sml_gcat_read' ) ? sml_gcat_read( $group_id ) : array( 'categories' => array(), 'assignments' => array() );
	$out  = array();
	foreach ( (array) $rows as $r ) {
		$out[] = array(
			'id'          => (int) $r['id'],
			'name'        => (string) $r['name'],
			'type'        => (string) $r['type'],
			'order_index' => (int) $r['order_index'],
			'is_locked'   => (int) $r['is_locked'],
			'category'    => isset( $cats['assignments'][ (string) $r['id'] ] ) ? (string) $cats['assignments'][ (string) $r['id'] ] : '',
		);
	}
	return $out;
}

function sml_hub_member_count( $group_id ) {
	global $wpdb;
	$t = sml_hub_tables();
	return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t['members']} WHERE group_id=%d", absint( $group_id ) ) );
}

function sml_hub_discord_state( $group_id ) {
	if ( ! function_exists( 'sml_dgc_connector' ) ) {
		return null;
	}
	$cfg  = sml_dgc_connector( $group_id );
	$maps = function_exists( 'sml_dgc_maps' ) ? sml_dgc_maps( $group_id ) : array();
	return array(
		'state'    => $cfg ? (string) $cfg['state'] : 'none',
		'guild_id' => $cfg ? (string) $cfg['guild_id'] : '',
		'mappings' => array_values( (array) $maps ),
	);
}

function sml_hub_plans( $group_id ) {
	if ( ! function_exists( 'sml_platform_group_plans' ) ) {
		return array();
	}
	$plans = sml_platform_group_plans( $group_id );
	return is_array( $plans ) ? array_values( $plans ) : array();
}

function sml_hub_bootstrap( $group_id ) {
	$group = sml_hub_group( $group_id );
	if ( ! $group ) {
		return sml_hub_rest_error( 'sml_hub_no_group', 'Unknown group.', 404 );
	}
	$uid     = get_current_user_id();
	$perms   = sml_hub_effective_permissions( $group_id, $uid );
	$manager = sml_hub_is_manager( $group_id, $uid );
	$owner   = get_userdata( (int) $group['owner_id'] );
	$out     = array(
		'group'       => array(
			'id'         => (int) $group['id'],
			'name'       => (string) ( $group['name'] ?? $group['title'] ?? '' ),
			'slug'       => (string) ( $group['slug'] ?? '' ),
			'owner_id'   => (int) $group['owner_id'],
			'owner_name' => $owner ? $owner->display_name : '',
			'members'    => sml_hub_member_count( $group_id ),
			'url'        => home_url( '/groups/' . rawurlencode( (string) ( $group['slug'] ?? '' ) ) . '/' ),
		),
		'viewer'      => array(
			'user_id'     => $uid,
			'is_owner'    => sml_hub_is_owner( $group_id, $uid ),
			'is_manager'  => $manager,
			'engine_role' => sml_hub_engine_role( $group_id, $uid ),
			'role_ids'    => sml_hub_user_role_ids( $group_id, $uid ),
			'permissions' => $perms,
		),
		'features'    => sml_hub_features(),
		'prefs'       => sml_hub_prefs( $group_id ),
		'base_levels' => sml_hub_base_labels(),
		'catalog'     => sml_hub_permission_catalog(),
		'socials'     => sml_hub_social_public_state( $group_id, $uid ),
	);
	$can_any = $manager;
	foreach ( $perms as $k => $v ) {
		if ( $v && 0 === strpos( $k, 'manage_' ) ) {
			$can_any = true;
		}
	}
	$out['viewer']['can_open_hub'] = $can_any;
	if ( $can_any ) {
		$out['roles']       = sml_hub_roles( $group_id );
		$out['role_counts'] = sml_hub_role_member_counts( $group_id );
		$out['channels']    = sml_hub_channels( $group_id );
		$out['overrides']   = sml_hub_overrides( $group_id );
		$out['discord']     = sml_hub_discord_state( $group_id );
		$out['plans']       = sml_hub_plans( $group_id );
		$out['socials']     = sml_hub_social_owner_state( $group_id );
	}
	return $out;
}

function sml_hub_members_page( $group_id, $search, $page ) {
	global $wpdb;
	$t      = sml_hub_tables();
	$per    = 50;
	$offset = max( 0, ( absint( $page ) - 1 ) ) * $per;
	$where  = 'm.group_id=%d';
	$args   = array( absint( $group_id ) );
	if ( '' !== $search ) {
		$like   = '%' . $wpdb->esc_like( $search ) . '%';
		$where .= ' AND (u.display_name LIKE %s OR u.user_login LIKE %s OR u.user_email LIKE %s)';
		array_push( $args, $like, $like, $like );
	}
	$sql  = "SELECT m.user_id, m.role, m.joined_at, u.display_name, u.user_login FROM {$t['members']} m LEFT JOIN {$wpdb->users} u ON u.ID=m.user_id WHERE {$where} ORDER BY FIELD(m.role,'admin','mod','analyst','premium','member'), m.joined_at DESC LIMIT %d OFFSET %d";
	$args[] = $per;
	$args[] = $offset;
	$rows = $wpdb->get_results( $wpdb->prepare( $sql, $args ), ARRAY_A );
	$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$t['members']} m LEFT JOIN {$wpdb->users} u ON u.ID=m.user_id WHERE {$where}", array_slice( $args, 0, -2 ) ) );
	$ids   = array();
	foreach ( (array) $rows as $r ) {
		$ids[] = (int) $r['user_id'];
	}
	$custom = array();
	if ( $ids ) {
		$in = implode( ',', array_map( 'intval', $ids ) );
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT user_id, role_id, source FROM {$t['member_roles']} WHERE group_id=%d AND user_id IN ($in)", absint( $group_id ) ), ARRAY_A ) as $mr ) {
			$custom[ (int) $mr['user_id'] ][] = array( 'role_id' => (int) $mr['role_id'], 'source' => (string) $mr['source'] );
		}
	}
	$group = sml_hub_group( $group_id );
	$out   = array();
	foreach ( (array) $rows as $r ) {
		$uid   = (int) $r['user_id'];
		$out[] = array(
			'user_id'     => $uid,
			'name'        => (string) ( $r['display_name'] ?: $r['user_login'] ?: ( 'User #' . $uid ) ),
			'avatar'      => get_avatar_url( $uid, array( 'size' => 48 ) ),
			'engine_role' => sanitize_key( (string) $r['role'] ),
			'is_owner'    => $group && (int) $group['owner_id'] === $uid,
			'joined_at'   => (string) $r['joined_at'],
			'roles'       => isset( $custom[ $uid ] ) ? $custom[ $uid ] : array(),
		);
	}
	return array( 'members' => $out, 'total' => $total, 'page' => max( 1, absint( $page ) ), 'per_page' => $per );
}

/** Managers can change anyone but the owner; mods (manage_members) only members below mod. */
function sml_hub_may_touch_member( $group_id, $target_uid ) {
	$group = sml_hub_group( $group_id );
	if ( ! $group || (int) $group['owner_id'] === (int) $target_uid ) {
		return false;
	}
	if ( sml_hub_is_manager( $group_id ) ) {
		return true;
	}
	$levels = sml_hub_base_levels();
	$target = sml_hub_engine_role( $group_id, $target_uid );
	return null === $target || $levels[ $target ] < $levels['mod'];
}

function sml_hub_rest_update_member( WP_REST_Request $request ) {
	global $wpdb;
	$t    = sml_hub_tables();
	$gid  = absint( $request->get_param( 'group_id' ) );
	$uid  = absint( $request->get_param( 'user_id' ) );
	$body = $request->get_json_params();
	$body = is_array( $body ) ? $body : array();
	if ( ! $uid || ! sml_hub_may_touch_member( $gid, $uid ) ) {
		return sml_hub_rest_error( 'sml_hub_member_protected', 'You cannot change that member.', 403 );
	}
	$manager = sml_hub_is_manager( $gid );
	$levels  = sml_hub_base_levels();

	if ( ! empty( $body['remove'] ) ) {
		$wpdb->delete( $t['members'], array( 'group_id' => $gid, 'user_id' => $uid ), array( '%d', '%d' ) );
		$wpdb->delete( $t['member_roles'], array( 'group_id' => $gid, 'user_id' => $uid ), array( '%d', '%d' ) );
		sml_hub_audit( $gid, 'member_removed', $uid );
		return array( 'removed' => true );
	}

	if ( isset( $body['engine_role'] ) ) {
		$role = sanitize_key( (string) $body['engine_role'] );
		if ( ! isset( $levels[ $role ] ) ) {
			return sml_hub_rest_error( 'sml_hub_bad_role', 'Unknown role.' );
		}
		if ( ! $manager && $levels[ $role ] >= $levels['mod'] ) {
			return sml_hub_rest_error( 'sml_hub_role_too_high', 'Only owners and admins can grant Moderator or Admin.', 403 );
		}
		$r = sml_hub_set_engine_role( $gid, $uid, $role, 'manual' );
		if ( is_wp_error( $r ) ) {
			return $r;
		}
	}

	if ( ! empty( $body['add_role_id'] ) ) {
		$role = sml_hub_role( absint( $body['add_role_id'] ) );
		if ( ! $role || $role['group_id'] !== $gid ) {
			return sml_hub_rest_error( 'sml_hub_no_role', 'Unknown role.', 404 );
		}
		if ( ! $manager && $levels[ $role['base_level'] ] >= $levels['mod'] ) {
			return sml_hub_rest_error( 'sml_hub_role_too_high', 'Only owners and admins can grant a role at Moderator level or above.', 403 );
		}
		$wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$t['member_roles']} (group_id,user_id,role_id,source,granted_by_user_id,created_at) VALUES (%d,%d,%d,'manual',%d,%s)", $gid, $uid, $role['id'], get_current_user_id(), sml_hub_now() ) );
		$current = sml_hub_engine_role( $gid, $uid );
		if ( null === $current || $levels[ $current ] < $levels[ $role['base_level'] ] ) {
			sml_hub_set_engine_role( $gid, $uid, $role['base_level'], 'custom_role:' . $role['id'] );
		}
		sml_hub_audit( $gid, 'custom_role_added', $uid, array( 'role_id' => $role['id'] ) );
	}

	if ( ! empty( $body['remove_role_id'] ) ) {
		$role = sml_hub_role( absint( $body['remove_role_id'] ) );
		if ( $role && $role['group_id'] === $gid ) {
			$wpdb->delete( $t['member_roles'], array( 'group_id' => $gid, 'user_id' => $uid, 'role_id' => $role['id'] ), array( '%d', '%d', '%d' ) );
			// Lower the engine level only when this role was what gave it, and never below what other roles still imply.
			$current = sml_hub_engine_role( $gid, $uid );
			if ( $current === $role['base_level'] && $levels[ $current ] < $levels['mod'] ) {
				$implied = sml_hub_implied_engine_role( $gid, $uid );
				$next    = $implied ?: 'member';
				if ( $next !== $current ) {
					sml_hub_set_engine_role( $gid, $uid, $next, 'custom_role_removed:' . $role['id'] );
				}
			}
			sml_hub_audit( $gid, 'custom_role_removed', $uid, array( 'role_id' => $role['id'] ) );
		}
	}

	$page = sml_hub_members_page( $gid, '', 1 );
	foreach ( $page['members'] as $m ) {
		if ( $m['user_id'] === $uid ) {
			return array( 'member' => $m );
		}
	}
	return array( 'member' => null );
}

add_action( 'rest_api_init', static function () {
	$ns = 'sml-hub/v1';
	$g  = '/group/(?P<group_id>\d+)';

	register_rest_route( $ns, $g, array(
		'methods'             => 'GET',
		'permission_callback' => 'is_user_logged_in',
		'callback'            => static function ( $request ) {
			return rest_ensure_response( sml_hub_bootstrap( absint( $request->get_param( 'group_id' ) ) ) );
		},
	) );

	register_rest_route( $ns, $g . '/prefs', array(
		'methods'             => 'POST',
		'permission_callback' => static function ( $request ) {
			return sml_hub_is_manager( absint( $request->get_param( 'group_id' ) ) );
		},
		'callback'            => static function ( $request ) {
			$gid  = absint( $request->get_param( 'group_id' ) );
			$body = $request->get_json_params();
			$p    = sml_hub_prefs( $gid );
			if ( is_array( $body ) && array_key_exists( 'hide_legacy', $body ) ) {
				$p['hide_legacy'] = ! empty( $body['hide_legacy'] );
			}
			update_option( 'sml_hub_prefs_' . $gid, $p, false );
			return array( 'prefs' => $p );
		},
	) );

	/* Names and icons for the group page: every member who holds a custom role with a colour or an icon, with the style of their top role (first in the list). */
	register_rest_route( $ns, $g . '/role-styles', array(
		'methods'             => 'GET',
		'permission_callback' => static function ( $request ) {
			$gid = absint( $request->get_param( 'group_id' ) );
			return $gid && is_user_logged_in() && ( sml_hub_is_manager( $gid ) || null !== sml_hub_engine_role( $gid, get_current_user_id() ) );
		},
		'callback'            => static function ( $request ) {
			$gid   = absint( $request->get_param( 'group_id' ) );
			$cache = 'sml_hub_rs_' . $gid;
			$out   = get_transient( $cache );
			if ( false === $out ) {
				$out = sml_hub_role_styles( $gid );
				set_transient( $cache, $out, 15 );
			}
			$response = rest_ensure_response( array( 'styles' => $out ) );
			$response->header( 'Cache-Control', 'private, max-age=20' );
			return $response;
		},
	) );

	register_rest_route( $ns, $g . '/roles', array(
		'methods'             => 'POST',
		'permission_callback' => sml_hub_perm( 'manage_roles' ),
		'callback'            => static function ( $request ) {
			global $wpdb;
			$t    = sml_hub_tables();
			$gid  = absint( $request->get_param( 'group_id' ) );
			$body = $request->get_json_params();
			$in   = sml_hub_clean_role_input( is_array( $body ) ? $body : array() );
			if ( is_wp_error( $in ) ) {
				return $in;
			}
			if ( ! sml_hub_is_manager( $gid ) && sml_hub_base_levels()[ $in['base_level'] ] >= sml_hub_base_levels()['mod'] ) {
				return sml_hub_rest_error( 'sml_hub_role_too_high', 'Only owners and admins can create roles at Moderator level or above.', 403 );
			}
			if ( count( sml_hub_roles( $gid ) ) >= 40 ) {
				return sml_hub_rest_error( 'sml_hub_role_limit', 'A group can have up to 40 custom roles.' );
			}
			$pos = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(MAX(position),0)+1 FROM {$t['roles']} WHERE group_id=%d", $gid ) );
			$ok  = $wpdb->insert( $t['roles'], array(
				'group_id'           => $gid,
				'name'               => $in['name'],
				'color'              => $in['color'],
				'icon'               => $in['icon'],
				'base_level'         => $in['base_level'],
				'permissions'        => wp_json_encode( $in['permissions'] ),
				'position'           => $pos,
				'created_by_user_id' => get_current_user_id(),
				'created_at'         => sml_hub_now(),
				'updated_at'         => sml_hub_now(),
			), array( '%d', '%s', '%s', '%s', '%s', '%s', '%d', '%d', '%s', '%s' ) );
			if ( ! $ok ) {
				return sml_hub_rest_error( 'sml_hub_role_exists', 'A role with that name already exists.', 409 );
			}
			$role = sml_hub_role( $wpdb->insert_id );
			sml_hub_audit( $gid, 'role_created', 0, $role );
			return array( 'role' => $role, 'roles' => sml_hub_roles( $gid ) );
		},
	) );

	register_rest_route( $ns, $g . '/roles/reorder', array(
		'methods'             => 'POST',
		'permission_callback' => sml_hub_perm( 'manage_roles' ),
		'callback'            => static function ( $request ) {
			global $wpdb;
			$t    = sml_hub_tables();
			$gid  = absint( $request->get_param( 'group_id' ) );
			$body = $request->get_json_params();
			$ids  = ( is_array( $body ) && isset( $body['order'] ) && is_array( $body['order'] ) ) ? array_map( 'absint', $body['order'] ) : array();
			foreach ( array_values( array_unique( $ids ) ) as $i => $rid ) {
				$wpdb->update( $t['roles'], array( 'position' => $i ), array( 'id' => $rid, 'group_id' => $gid ), array( '%d' ), array( '%d', '%d' ) );
			}
			return array( 'roles' => sml_hub_roles( $gid ) );
		},
	) );

	register_rest_route( $ns, $g . '/roles/(?P<role_id>\d+)', array(
		array(
			'methods'             => 'POST',
			'permission_callback' => sml_hub_perm( 'manage_roles' ),
			'callback'            => static function ( $request ) {
				global $wpdb;
				$t    = sml_hub_tables();
				$gid  = absint( $request->get_param( 'group_id' ) );
				$role = sml_hub_role( absint( $request->get_param( 'role_id' ) ) );
				if ( ! $role || $role['group_id'] !== $gid ) {
					return sml_hub_rest_error( 'sml_hub_no_role', 'Unknown role.', 404 );
				}
				$body = $request->get_json_params();
				$in   = sml_hub_clean_role_input( is_array( $body ) ? $body : array(), $role );
				if ( is_wp_error( $in ) ) {
					return $in;
				}
				if ( ! sml_hub_is_manager( $gid ) && sml_hub_base_levels()[ $in['base_level'] ] >= sml_hub_base_levels()['mod'] ) {
					return sml_hub_rest_error( 'sml_hub_role_too_high', 'Only owners and admins can set a role to Moderator level or above.', 403 );
				}
				$ok = $wpdb->update( $t['roles'], array(
					'name'        => $in['name'],
					'color'       => $in['color'],
					'icon'        => $in['icon'],
					'base_level'  => $in['base_level'],
					'permissions' => wp_json_encode( $in['permissions'] ),
					'updated_at'  => sml_hub_now(),
				), array( 'id' => $role['id'] ), array( '%s', '%s', '%s', '%s', '%s', '%s' ), array( '%d' ) );
				if ( false === $ok ) {
					return sml_hub_rest_error( 'sml_hub_role_exists', 'A role with that name already exists.', 409 );
				}
				// Base level changed: raise holders whose engine role is below it (never lower anyone here).
				if ( $in['base_level'] !== $role['base_level'] ) {
					$levels = sml_hub_base_levels();
					foreach ( (array) $wpdb->get_col( $wpdb->prepare( "SELECT user_id FROM {$t['member_roles']} WHERE role_id=%d", $role['id'] ) ) as $uid ) {
						$cur = sml_hub_engine_role( $gid, (int) $uid );
						if ( null === $cur || $levels[ $cur ] < $levels[ $in['base_level'] ] ) {
							sml_hub_set_engine_role( $gid, (int) $uid, $in['base_level'], 'custom_role_changed:' . $role['id'] );
						}
					}
				}
				sml_hub_audit( $gid, 'role_updated', 0, array( 'role_id' => $role['id'], 'changes' => $in ) );
				return array( 'role' => sml_hub_role( $role['id'] ), 'roles' => sml_hub_roles( $gid ) );
			},
		),
		array(
			'methods'             => 'DELETE',
			'permission_callback' => sml_hub_perm( 'manage_roles' ),
			'callback'            => static function ( $request ) {
				global $wpdb;
				$t    = sml_hub_tables();
				$gid  = absint( $request->get_param( 'group_id' ) );
				$role = sml_hub_role( absint( $request->get_param( 'role_id' ) ) );
				if ( ! $role || $role['group_id'] !== $gid ) {
					return sml_hub_rest_error( 'sml_hub_no_role', 'Unknown role.', 404 );
				}
				$holders = (array) $wpdb->get_col( $wpdb->prepare( "SELECT user_id FROM {$t['member_roles']} WHERE role_id=%d", $role['id'] ) );
				$wpdb->delete( $t['member_roles'], array( 'role_id' => $role['id'] ), array( '%d' ) );
				$wpdb->delete( $t['roles'], array( 'id' => $role['id'] ), array( '%d' ) );
				// Drop the role key from every channel override.
				$all = sml_hub_overrides( $gid );
				foreach ( $all as $cid => $set ) {
					unset( $all[ $cid ][ $role['key'] ] );
					if ( empty( $all[ $cid ] ) ) {
						unset( $all[ $cid ] );
					}
				}
				update_option( 'sml_hub_chan_' . $gid, $all, false );
				// Holders keep their engine role (a human may have relied on it); the audit records who held it.
				sml_hub_audit( $gid, 'role_deleted', 0, array( 'role' => $role, 'holders' => array_map( 'intval', $holders ) ) );
				sml_hub_social_targets_role_deleted( $gid, $role['id'] );
				return array( 'deleted' => true, 'roles' => sml_hub_roles( $gid ), 'overrides' => $all );
			},
		),
	) );

	register_rest_route( $ns, $g . '/members', array(
		'methods'             => 'GET',
		'permission_callback' => sml_hub_perm( 'manage_members' ),
		'callback'            => static function ( $request ) {
			return sml_hub_members_page( absint( $request->get_param( 'group_id' ) ), sanitize_text_field( (string) $request->get_param( 'search' ) ), absint( $request->get_param( 'page' ) ?: 1 ) );
		},
	) );

	register_rest_route( $ns, $g . '/members/(?P<user_id>\d+)', array(
		'methods'             => 'POST',
		'permission_callback' => sml_hub_perm( 'manage_members' ),
		'callback'            => 'sml_hub_rest_update_member',
	) );

	register_rest_route( $ns, $g . '/channels/(?P<channel_id>\d+)/overrides', array(
		'methods'             => 'POST',
		'permission_callback' => sml_hub_perm( 'manage_channels' ),
		'callback'            => static function ( $request ) {
			$gid = absint( $request->get_param( 'group_id' ) );
			$cid = absint( $request->get_param( 'channel_id' ) );
			if ( sml_hub_channel_group( $cid ) !== $gid ) {
				return sml_hub_rest_error( 'sml_hub_wrong_group', 'That channel is not in this group.', 404 );
			}
			$body = $request->get_json_params();
			$set  = sml_hub_clean_override_set( is_array( $body ) && isset( $body['overrides'] ) ? $body['overrides'] : array() );
			$all  = sml_hub_overrides( $gid );
			if ( $set ) {
				$all[ (string) $cid ] = $set;
			} else {
				unset( $all[ (string) $cid ] );
			}
			update_option( 'sml_hub_chan_' . $gid, $all, false );
			sml_hub_audit( $gid, 'channel_overrides_set', 0, array( 'channel_id' => $cid, 'overrides' => $set ) );
			return array( 'channel_id' => $cid, 'overrides' => $set, 'all' => $all );
		},
	) );

	register_rest_route( $ns, $g . '/audit', array(
		'methods'             => 'GET',
		'permission_callback' => static function ( $request ) {
			return sml_hub_is_manager( absint( $request->get_param( 'group_id' ) ) );
		},
		'callback'            => static function ( $request ) {
			global $wpdb;
			$t    = sml_hub_tables();
			$gid  = absint( $request->get_param( 'group_id' ) );
			$rows = $wpdb->get_results( $wpdb->prepare( "SELECT id, actor_user_id, subject_user_id, action, detail, created_at FROM {$t['audit']} WHERE group_id=%d ORDER BY id DESC LIMIT 100", $gid ), ARRAY_A );
			foreach ( $rows as &$r ) {
				$r['detail'] = json_decode( (string) $r['detail'], true );
			}
			return array( 'audit' => $rows );
		},
	) );
} );
