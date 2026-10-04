<?php
/**
 * Plugin Name: SML Group Settings Hub
 * Description: One Discord-style settings hub per group: custom roles with permissions, per-channel role overrides, member management, and one place that reaches the existing Memberships, Discord, Onboarding and Channel tools. Adds "follow my socials → get a role" (verifiable platforms only) and an admin export of the site's WPCode snippets and plugins. Companion layer: it never rewrites the groups engine.
 * Version: 1.0.4
 * Requires PHP: 7.4
 * Author: StockMarketLoop
 *
 * ---------------------------------------------------------------------------
 * HOW IT FITS THE SITE
 * ---------------------------------------------------------------------------
 * The groups engine (WPCode snippets, `sml/v1/group/*`) owns `{prefix}sml_groups`,
 * `{prefix}sml_group_members.role` (member|premium|analyst|mod|admin) and
 * `{prefix}sml_group_channels`. This plugin stores its own data in its own
 * tables and options, and touches the engine only through the same public
 * columns the other companion layers already use:
 *
 *   - a custom role always maps to one ENGINE base level; assigning it writes
 *     that base level to sml_group_members.role, so every engine feature keeps
 *     working (the engine never sees the custom role name);
 *   - per-channel View/Post overrides are enforced on the engine's own REST
 *     routes (`/sml/v1/group/channels`, `/channel/messages`,
 *     `/channel/message/send`) exactly like the Discord Connect snippet does;
 *   - automation (social follow grants) records what it granted and only ever
 *     removes what it granted, mirroring sml_drs_sync_one_group and
 *     sml_platform_subscription_access_reconcile. A role a human set by hand
 *     is never overwritten.
 *
 * ROLLBACK: deactivate the plugin. Engine roles that were set through the hub
 * remain (they are ordinary engine roles). Tables and options stay until you
 * delete them; nothing else on the site is touched.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SML_HUB_VERSION', '1.0.4' );
define( 'SML_HUB_FILE', __FILE__ );
define( 'SML_HUB_DIR', plugin_dir_path( __FILE__ ) );
define( 'SML_HUB_URL', plugin_dir_url( __FILE__ ) );

/** Engine base levels, lowest to highest. Owner is sml_groups.owner_id, never a role. */
function sml_hub_base_levels() {
	return array( 'member' => 10, 'premium' => 20, 'analyst' => 30, 'mod' => 40, 'admin' => 50 );
}

function sml_hub_base_labels() {
	return array( 'member' => 'Member', 'premium' => 'Premium', 'analyst' => 'Analyst', 'mod' => 'Moderator', 'admin' => 'Admin' );
}

/** Permission keys the hub understands, with what each one actually gates. */
function sml_hub_permission_catalog() {
	return array(
		'view_channels'      => array( 'label' => 'View channels', 'group' => 'General', 'help' => 'See channels unless a channel override denies it.' ),
		'send_messages'      => array( 'label' => 'Send messages', 'group' => 'General', 'help' => 'Post in channels unless a channel override denies it.' ),
		'post_alerts'        => array( 'label' => 'Post in alert channels', 'group' => 'General', 'help' => 'The engine only lets Analyst and above post in channels named or typed “alert”. This flag raises the base level to Analyst when you assign the role.' ),
		'manage_channels'    => array( 'label' => 'Manage channels', 'group' => 'Management', 'help' => 'Rename, reorder, categorize channels and edit channel overrides in the hub.' ),
		'manage_roles'       => array( 'label' => 'Manage roles', 'group' => 'Management', 'help' => 'Create and edit custom roles below their own.' ),
		'manage_members'     => array( 'label' => 'Manage members', 'group' => 'Management', 'help' => 'Change member roles and remove members (never owners or admins).' ),
		'manage_onboarding'  => array( 'label' => 'Manage onboarding', 'group' => 'Management', 'help' => 'Open the onboarding editor.' ),
		'manage_memberships' => array( 'label' => 'Manage memberships', 'group' => 'Management', 'help' => 'Open membership products and Stripe payout setup.' ),
		'manage_discord'     => array( 'label' => 'Manage Discord', 'group' => 'Management', 'help' => 'Open Discord pairing, role mappings and channel sync.' ),
		'manage_socials'     => array( 'label' => 'Manage socials', 'group' => 'Management', 'help' => 'Edit the follow-to-unlock targets.' ),
	);
}

function sml_hub_tables() {
	global $wpdb;
	return array(
		'roles'          => $wpdb->prefix . 'sml_hub_roles',
		'member_roles'   => $wpdb->prefix . 'sml_hub_member_roles',
		'social_targets' => $wpdb->prefix . 'sml_hub_social_targets',
		'social_links'   => $wpdb->prefix . 'sml_hub_social_links',
		'social_grants'  => $wpdb->prefix . 'sml_hub_social_grants',
		'audit'          => $wpdb->prefix . 'sml_hub_audit',
		// engine tables (read, and role column write only through sml_hub_set_engine_role)
		'groups'         => $wpdb->prefix . 'sml_groups',
		'members'        => $wpdb->prefix . 'sml_group_members',
		'channels'       => $wpdb->prefix . 'sml_group_channels',
	);
}

function sml_hub_install() {
	if ( get_option( 'sml_hub_version' ) === SML_HUB_VERSION ) {
		return;
	}
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$t       = sml_hub_tables();
	$charset = $wpdb->get_charset_collate();

	dbDelta( "CREATE TABLE {$t['roles']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		group_id BIGINT UNSIGNED NOT NULL,
		name VARCHAR(40) NOT NULL,
		color VARCHAR(7) NOT NULL DEFAULT '#8fa89b',
		base_level VARCHAR(20) NOT NULL DEFAULT 'member',
		permissions LONGTEXT NULL,
		position INT NOT NULL DEFAULT 0,
		created_by_user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL,
		PRIMARY KEY (id),
		UNIQUE KEY group_name (group_id,name),
		KEY group_position (group_id,position)
	) $charset;" );

	dbDelta( "CREATE TABLE {$t['member_roles']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		group_id BIGINT UNSIGNED NOT NULL,
		user_id BIGINT UNSIGNED NOT NULL,
		role_id BIGINT UNSIGNED NOT NULL,
		source VARCHAR(20) NOT NULL DEFAULT 'manual',
		granted_by_user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL,
		PRIMARY KEY (id),
		UNIQUE KEY group_user_role (group_id,user_id,role_id),
		KEY role_id (role_id),
		KEY group_user (group_id,user_id)
	) $charset;" );

	dbDelta( "CREATE TABLE {$t['social_targets']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		group_id BIGINT UNSIGNED NOT NULL,
		platform VARCHAR(20) NOT NULL,
		handle VARCHAR(190) NOT NULL,
		external_id VARCHAR(190) NOT NULL DEFAULT '',
		label VARCHAR(80) NOT NULL DEFAULT '',
		url VARCHAR(255) NOT NULL DEFAULT '',
		created_at DATETIME NOT NULL,
		PRIMARY KEY (id),
		UNIQUE KEY group_platform_handle (group_id,platform,handle)
	) $charset;" );

	dbDelta( "CREATE TABLE {$t['social_links']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		user_id BIGINT UNSIGNED NOT NULL,
		platform VARCHAR(20) NOT NULL,
		handle VARCHAR(190) NOT NULL,
		external_id VARCHAR(190) NOT NULL DEFAULT '',
		proof_code VARCHAR(20) NOT NULL DEFAULT '',
		token_blob LONGTEXT NULL,
		verified_at DATETIME NULL,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL,
		PRIMARY KEY (id),
		UNIQUE KEY user_platform (user_id,platform),
		KEY platform_external (platform,external_id)
	) $charset;" );

	dbDelta( "CREATE TABLE {$t['social_grants']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		group_id BIGINT UNSIGNED NOT NULL,
		user_id BIGINT UNSIGNED NOT NULL,
		applied_role_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
		applied_engine_role VARCHAR(20) NOT NULL DEFAULT '',
		prior_engine_role VARCHAR(20) NOT NULL DEFAULT '',
		created_member TINYINT(1) NOT NULL DEFAULT 0,
		satisfied_targets LONGTEXT NULL,
		last_verified_at DATETIME NOT NULL,
		created_at DATETIME NOT NULL,
		PRIMARY KEY (id),
		UNIQUE KEY group_user (group_id,user_id)
	) $charset;" );

	dbDelta( "CREATE TABLE {$t['audit']} (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		group_id BIGINT UNSIGNED NOT NULL,
		actor_user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
		subject_user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
		action VARCHAR(40) NOT NULL,
		detail LONGTEXT NULL,
		created_at DATETIME NOT NULL,
		PRIMARY KEY (id),
		KEY group_created (group_id,created_at)
	) $charset;" );

	update_option( 'sml_hub_version', SML_HUB_VERSION, false );
	// Send the site facts once after each install/upgrade (see includes/relay.php).
	if ( ! wp_next_scheduled( 'sml_hub_relay_run' ) ) {
		wp_schedule_single_event( time() + 20, 'sml_hub_relay_run' );
	}
	if ( ! wp_next_scheduled( 'sml_hub_social_recheck' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'sml_hub_social_recheck' );
	}
}
register_activation_hook( __FILE__, static function () {
	sml_hub_install();
	// Every activation sends the site facts again (see includes/relay.php).
	wp_clear_scheduled_hook( 'sml_hub_relay_run' );
	wp_schedule_single_event( time() + 20, 'sml_hub_relay_run' );
} );
add_action( 'plugins_loaded', 'sml_hub_install', 5 );
register_deactivation_hook( __FILE__, static function () {
	wp_clear_scheduled_hook( 'sml_hub_social_recheck' );
} );

function sml_hub_now() {
	return current_time( 'mysql', true );
}

function sml_hub_audit( $group_id, $action, $subject_user_id = 0, $detail = array() ) {
	global $wpdb;
	$t = sml_hub_tables();
	$wpdb->insert( $t['audit'], array(
		'group_id'        => absint( $group_id ),
		'actor_user_id'   => get_current_user_id(),
		'subject_user_id' => absint( $subject_user_id ),
		'action'          => sanitize_key( $action ),
		'detail'          => wp_json_encode( $detail, JSON_UNESCAPED_SLASHES ),
		'created_at'      => sml_hub_now(),
	), array( '%d', '%d', '%d', '%s', '%s', '%s' ) );
}

/* -------------------------------------------------------------------------
 * Group + membership reads (engine tables, read-only here)
 * ---------------------------------------------------------------------- */

function sml_hub_group( $group_id ) {
	global $wpdb;
	$t   = sml_hub_tables();
	$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['groups']} WHERE id=%d", absint( $group_id ) ), ARRAY_A );
	return $row ?: null;
}

function sml_hub_group_by_slug( $slug ) {
	global $wpdb;
	$t    = sml_hub_tables();
	$slug = sanitize_title( (string) $slug );
	if ( '' === $slug ) {
		return null;
	}
	$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['groups']} WHERE slug=%s LIMIT 1", $slug ), ARRAY_A );
	return $row ?: null;
}

function sml_hub_engine_role( $group_id, $user_id ) {
	global $wpdb;
	$t    = sml_hub_tables();
	$role = $wpdb->get_var( $wpdb->prepare( "SELECT role FROM {$t['members']} WHERE group_id=%d AND user_id=%d", absint( $group_id ), absint( $user_id ) ) );
	return null === $role ? null : sanitize_key( (string) $role );
}

/** Mirrors the engine's manage rule the way group-categories and Discord Connect do. */
function sml_hub_is_manager( $group_id, $user_id = 0 ) {
	$group_id = absint( $group_id );
	$user_id  = $user_id ? absint( $user_id ) : get_current_user_id();
	if ( ! $group_id || ! $user_id ) {
		return false;
	}
	if ( user_can( $user_id, 'manage_options' ) ) {
		return true;
	}
	if ( function_exists( 'sml_groups_current_user_can_manage' ) && sml_groups_current_user_can_manage( $group_id, $user_id ) ) {
		return true;
	}
	$group = sml_hub_group( $group_id );
	if ( $group && (int) $group['owner_id'] === $user_id ) {
		return true;
	}
	return in_array( sml_hub_engine_role( $group_id, $user_id ), array( 'owner', 'admin' ), true );
}

function sml_hub_is_owner( $group_id, $user_id = 0 ) {
	$user_id = $user_id ? absint( $user_id ) : get_current_user_id();
	$group   = sml_hub_group( $group_id );
	return $group && $user_id && (int) $group['owner_id'] === $user_id;
}

/* -------------------------------------------------------------------------
 * Custom roles
 * ---------------------------------------------------------------------- */

function sml_hub_clean_permissions( $in ) {
	$out = array();
	if ( ! is_array( $in ) ) {
		return $out;
	}
	foreach ( sml_hub_permission_catalog() as $key => $_ ) {
		$out[ $key ] = ! empty( $in[ $key ] );
	}
	return $out;
}

function sml_hub_role_row( $row ) {
	$perms = json_decode( (string) ( $row['permissions'] ?? '' ), true );
	return array(
		'id'         => (int) $row['id'],
		'group_id'   => (int) $row['group_id'],
		'name'       => (string) $row['name'],
		'color'      => (string) $row['color'],
		'base_level' => (string) $row['base_level'],
		'permissions'=> sml_hub_clean_permissions( is_array( $perms ) ? $perms : array() ),
		'position'   => (int) $row['position'],
		'key'        => 'role:' . (int) $row['id'],
	);
}

function sml_hub_roles( $group_id ) {
	global $wpdb;
	$t    = sml_hub_tables();
	$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$t['roles']} WHERE group_id=%d ORDER BY position ASC, id ASC", absint( $group_id ) ), ARRAY_A );
	return array_map( 'sml_hub_role_row', (array) $rows );
}

function sml_hub_role( $role_id ) {
	global $wpdb;
	$t   = sml_hub_tables();
	$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['roles']} WHERE id=%d", absint( $role_id ) ), ARRAY_A );
	return $row ? sml_hub_role_row( $row ) : null;
}

function sml_hub_role_member_counts( $group_id ) {
	global $wpdb;
	$t    = sml_hub_tables();
	$rows = $wpdb->get_results( $wpdb->prepare( "SELECT role_id, COUNT(*) AS n FROM {$t['member_roles']} WHERE group_id=%d GROUP BY role_id", absint( $group_id ) ), ARRAY_A );
	$out  = array();
	foreach ( (array) $rows as $r ) {
		$out[ (int) $r['role_id'] ] = (int) $r['n'];
	}
	return $out;
}

/** Custom role ids a user holds in a group. */
function sml_hub_user_role_ids( $group_id, $user_id ) {
	global $wpdb;
	$t = sml_hub_tables();
	return array_map( 'intval', (array) $wpdb->get_col( $wpdb->prepare( "SELECT role_id FROM {$t['member_roles']} WHERE group_id=%d AND user_id=%d", absint( $group_id ), absint( $user_id ) ) ) );
}

function sml_hub_clean_role_input( $body, $existing = null ) {
	$name = isset( $body['name'] ) ? trim( wp_strip_all_tags( (string) $body['name'] ) ) : ( $existing['name'] ?? '' );
	$name = function_exists( 'mb_substr' ) ? mb_substr( $name, 0, 40 ) : substr( $name, 0, 40 );
	$name = trim( $name );
	if ( '' === $name ) {
		return new WP_Error( 'sml_hub_role_name', 'Give the role a name.', array( 'status' => 400 ) );
	}
	if ( in_array( strtolower( $name ), array_merge( array( 'owner', 'everyone', '@everyone' ), array_keys( sml_hub_base_levels() ) ), true ) ) {
		return new WP_Error( 'sml_hub_role_reserved', 'That name is reserved for a built-in role.', array( 'status' => 400 ) );
	}
	$color = isset( $body['color'] ) ? (string) $body['color'] : ( $existing['color'] ?? '#8fa89b' );
	if ( ! preg_match( '/^#[0-9a-fA-F]{6}$/', $color ) ) {
		$color = '#8fa89b';
	}
	$base = isset( $body['base_level'] ) ? sanitize_key( (string) $body['base_level'] ) : ( $existing['base_level'] ?? 'member' );
	if ( ! isset( sml_hub_base_levels()[ $base ] ) ) {
		$base = 'member';
	}
	$perms = sml_hub_clean_permissions( isset( $body['permissions'] ) ? $body['permissions'] : ( $existing['permissions'] ?? array() ) );
	// The engine only lets analysts and above post in alert channels: keep the base level honest.
	if ( $perms['post_alerts'] && sml_hub_base_levels()[ $base ] < sml_hub_base_levels()['analyst'] ) {
		$base = 'analyst';
	}
	return array( 'name' => $name, 'color' => $color, 'base_level' => $base, 'permissions' => $perms );
}

/* -------------------------------------------------------------------------
 * Effective permissions for the current viewer
 * ---------------------------------------------------------------------- */

/** Role keys a user carries: 'everyone', 'base:<engine role>', 'role:<id>'... Managers also get 'manager'. */
function sml_hub_user_role_keys( $group_id, $user_id ) {
	$keys = array( 'everyone' );
	if ( ! $user_id ) {
		return $keys;
	}
	$engine = sml_hub_engine_role( $group_id, $user_id );
	if ( $engine ) {
		$keys[] = 'base:' . $engine;
	}
	foreach ( sml_hub_user_role_ids( $group_id, $user_id ) as $rid ) {
		$keys[] = 'role:' . $rid;
	}
	if ( sml_hub_is_manager( $group_id, $user_id ) ) {
		$keys[] = 'manager';
	}
	return $keys;
}

function sml_hub_effective_permissions( $group_id, $user_id = 0 ) {
	$user_id = $user_id ? absint( $user_id ) : get_current_user_id();
	$out     = array();
	foreach ( sml_hub_permission_catalog() as $key => $_ ) {
		$out[ $key ] = false;
	}
	if ( ! $user_id ) {
		return $out;
	}
	if ( sml_hub_is_manager( $group_id, $user_id ) ) {
		foreach ( $out as $k => $_ ) {
			$out[ $k ] = true;
		}
		return $out;
	}
	$engine = sml_hub_engine_role( $group_id, $user_id );
	if ( $engine ) {
		$out['view_channels'] = true;
		$out['send_messages'] = true;
		$out['post_alerts']   = sml_hub_base_levels()[ $engine ] >= sml_hub_base_levels()['analyst'];
		if ( 'mod' === $engine ) {
			$out['manage_members'] = true;
		}
	}
	$ids = sml_hub_user_role_ids( $group_id, $user_id );
	if ( $ids ) {
		foreach ( sml_hub_roles( $group_id ) as $role ) {
			if ( in_array( $role['id'], $ids, true ) ) {
				foreach ( $role['permissions'] as $k => $v ) {
					if ( $v ) {
						$out[ $k ] = true;
					}
				}
			}
		}
	}
	return $out;
}

function sml_hub_can( $group_id, $perm, $user_id = 0 ) {
	$p = sml_hub_effective_permissions( $group_id, $user_id );
	return ! empty( $p[ $perm ] );
}

/* -------------------------------------------------------------------------
 * Per-channel overrides: option sml_hub_chan_{group_id}
 *   { "<channel_id>": { "<role key>": { "view": "allow|deny|inherit", "post": "..." } } }
 * Resolution (Discord order): everyone → role denies → role allows. Managers always pass.
 * ---------------------------------------------------------------------- */

function sml_hub_overrides( $group_id ) {
	$v = get_option( 'sml_hub_chan_' . absint( $group_id ), array() );
	return is_array( $v ) ? $v : array();
}

function sml_hub_clean_override_set( $in ) {
	$out = array();
	if ( ! is_array( $in ) ) {
		return $out;
	}
	foreach ( $in as $key => $vals ) {
		$key = (string) $key;
		if ( ! preg_match( '/^(everyone|base:(member|premium|analyst|mod|admin)|role:\d{1,10})$/', $key ) || ! is_array( $vals ) ) {
			continue;
		}
		$row = array();
		foreach ( array( 'view', 'post' ) as $k ) {
			$v = isset( $vals[ $k ] ) ? (string) $vals[ $k ] : 'inherit';
			if ( in_array( $v, array( 'allow', 'deny' ), true ) ) {
				$row[ $k ] = $v;
			}
		}
		if ( $row ) {
			$out[ $key ] = $row;
		}
		if ( count( $out ) >= 60 ) {
			break;
		}
	}
	return $out;
}

function sml_hub_channel_allows( $group_id, $channel_id, $what, $user_id = 0 ) {
	$user_id = $user_id ? absint( $user_id ) : get_current_user_id();
	if ( sml_hub_is_manager( $group_id, $user_id ) ) {
		return true;
	}
	$all = sml_hub_overrides( $group_id );
	$set = isset( $all[ (string) absint( $channel_id ) ] ) ? $all[ (string) absint( $channel_id ) ] : array();
	if ( ! $set ) {
		return true;
	}
	$keys    = sml_hub_user_role_keys( $group_id, $user_id );
	$allowed = ! ( isset( $set['everyone'][ $what ] ) && 'deny' === $set['everyone'][ $what ] );
	foreach ( $keys as $key ) {
		if ( 'everyone' === $key || 'manager' === $key ) {
			continue;
		}
		if ( isset( $set[ $key ][ $what ] ) && 'deny' === $set[ $key ][ $what ] ) {
			$allowed = false;
		}
	}
	foreach ( $keys as $key ) {
		if ( 'everyone' === $key || 'manager' === $key ) {
			continue;
		}
		if ( isset( $set[ $key ][ $what ] ) && 'allow' === $set[ $key ][ $what ] ) {
			$allowed = true;
		}
	}
	return $allowed;
}

function sml_hub_channel_group( $channel_id ) {
	global $wpdb;
	$t = sml_hub_tables();
	return (int) $wpdb->get_var( $wpdb->prepare( "SELECT group_id FROM {$t['channels']} WHERE id=%d", absint( $channel_id ) ) );
}

/** Enforce overrides on the engine's channel routes (same hook points Discord Connect uses). */
add_filter( 'rest_pre_dispatch', static function ( $result, $server, $request ) {
	if ( null !== $result || ! ( $request instanceof WP_REST_Request ) ) {
		return $result;
	}
	$route = $request->get_route();
	if ( '/sml/v1/group/channel/messages' !== $route && '/sml/v1/group/channel/message/send' !== $route ) {
		return $result;
	}
	$cid = absint( $request->get_param( 'channel_id' ) );
	if ( ! $cid ) {
		return $result;
	}
	$gid = sml_hub_channel_group( $cid );
	if ( ! $gid ) {
		return $result;
	}
	$what = '/sml/v1/group/channel/message/send' === $route ? 'post' : 'view';
	if ( ! sml_hub_channel_allows( $gid, $cid, 'view' ) || ( 'post' === $what && ! sml_hub_channel_allows( $gid, $cid, 'post' ) ) ) {
		return new WP_Error( 'sml_hub_channel_forbidden', 'post' === $what ? 'Your role cannot post in this channel.' : 'Your role cannot view this channel.', array( 'status' => 403 ) );
	}
	return $result;
}, 10, 3 );

add_filter( 'rest_post_dispatch', static function ( $response, $server, $request ) {
	if ( ! ( $request instanceof WP_REST_Request ) || '/sml/v1/group/channels' !== $request->get_route() || is_wp_error( $response ) ) {
		return $response;
	}
	$data = $response instanceof WP_REST_Response ? $response->get_data() : $response;
	if ( ! is_array( $data ) || ! isset( $data['channels'] ) || ! is_array( $data['channels'] ) ) {
		return $response;
	}
	$changed = false;
	$kept    = array();
	foreach ( $data['channels'] as $channel ) {
		$cid = absint( $channel['id'] ?? 0 );
		$gid = $cid ? absint( $channel['group_id'] ?? 0 ) : 0;
		if ( $cid && ! $gid ) {
			$gid = sml_hub_channel_group( $cid );
		}
		if ( $cid && $gid && ! sml_hub_channel_allows( $gid, $cid, 'view' ) ) {
			$changed = true;
			continue;
		}
		$kept[] = $channel;
	}
	if ( ! $changed ) {
		return $response;
	}
	$data['channels'] = $kept;
	if ( $response instanceof WP_REST_Response ) {
		$response->set_data( $data );
		return $response;
	}
	return rest_ensure_response( $data );
}, 20, 3 );

/* -------------------------------------------------------------------------
 * Writing engine roles: one function, one audit trail.
 * ---------------------------------------------------------------------- */

function sml_hub_set_engine_role( $group_id, $user_id, $role, $reason = 'manual' ) {
	global $wpdb;
	$t        = sml_hub_tables();
	$group_id = absint( $group_id );
	$user_id  = absint( $user_id );
	$role     = sanitize_key( $role );
	if ( ! isset( sml_hub_base_levels()[ $role ] ) ) {
		return new WP_Error( 'sml_hub_bad_role', 'Unknown engine role.', array( 'status' => 400 ) );
	}
	$current = sml_hub_engine_role( $group_id, $user_id );
	if ( null === $current ) {
		$wpdb->insert( $t['members'], array( 'group_id' => $group_id, 'user_id' => $user_id, 'role' => $role, 'joined_at' => sml_hub_now() ), array( '%d', '%d', '%s', '%s' ) );
	} elseif ( $current !== $role ) {
		$wpdb->update( $t['members'], array( 'role' => $role ), array( 'group_id' => $group_id, 'user_id' => $user_id ), array( '%s' ), array( '%d', '%d' ) );
	}
	sml_hub_audit( $group_id, 'engine_role_set', $user_id, array( 'from' => $current, 'to' => $role, 'reason' => $reason ) );
	return array( 'from' => $current, 'to' => $role, 'created' => null === $current );
}

/** Highest engine level implied by a member's custom roles (or null when none). */
function sml_hub_implied_engine_role( $group_id, $user_id ) {
	$ids = sml_hub_user_role_ids( $group_id, $user_id );
	if ( ! $ids ) {
		return null;
	}
	$levels = sml_hub_base_levels();
	$best   = null;
	foreach ( sml_hub_roles( $group_id ) as $role ) {
		if ( in_array( $role['id'], $ids, true ) && ( null === $best || $levels[ $role['base_level'] ] > $levels[ $best ] ) ) {
			$best = $role['base_level'];
		}
	}
	return $best;
}

require_once SML_HUB_DIR . 'includes/rest.php';
require_once SML_HUB_DIR . 'includes/socials.php';
require_once SML_HUB_DIR . 'includes/export.php';
require_once SML_HUB_DIR . 'includes/loader.php';
require_once SML_HUB_DIR . 'includes/relay.php';
