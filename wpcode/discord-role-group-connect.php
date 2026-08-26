/**
 * SML Discord group connectors (v2).
 *
 * Adds a reusable, owner-paired Discord -> SML group role bridge without
 * altering the existing Making Easy Money bridge (sml-discord-site/v1).
 *
 * Install as a NEW WPCode PHP snippet: Auto Insert / Run Everywhere.
 * This snippet is intentionally dormant until a group manager completes the
 * owner pairing flow and maps at least one Discord role.
 *
 * Security model:
 * - Only an SML group owner/admin can create or change a connector.
 * - The group manager receives a short, one-time pairing code on the site.
 * - The code must be redeemed from the target Discord server by a person with
 *   Discord's Manage Server permission. The bot verifies that permission;
 *   WordPress never trusts a browser-supplied guild ID.
 * - The bot (via its existing administrator-scoped Application Password) is
 *   the only caller allowed to claim a guild or submit Discord role IDs.
 * - Website memberships created by this connector are tracked separately and
 *   never overwrite or revoke paid/manual memberships.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'sml_dgc_tables' ) ) {
	define( 'SML_DGC_VERSION', '1.1.0' );
	define( 'SML_DGC_DISCORD_APP_ID', '1537698927401377894' );

	function sml_dgc_tables() {
		global $wpdb;
		return array(
			'connectors' => $wpdb->prefix . 'sml_discord_group_connectors',
			'maps'       => $wpdb->prefix . 'sml_discord_group_role_maps',
			'grants'     => $wpdb->prefix . 'sml_discord_dynamic_group_grants',
			'audit'      => $wpdb->prefix . 'sml_discord_group_connector_audit',
			'links'      => $wpdb->prefix . 'sml_discord_site_links', // v1 identity table.
			'members'    => $wpdb->prefix . 'sml_group_members',
			'groups'     => $wpdb->prefix . 'sml_groups',
			'catalogs'   => $wpdb->prefix . 'sml_discord_guild_catalogs',
			'channel_maps' => $wpdb->prefix . 'sml_discord_group_channel_maps',
			'channels'   => $wpdb->prefix . 'sml_group_channels',
		);
	}

	function sml_dgc_install() {
		if ( get_option( 'sml_dgc_version' ) === SML_DGC_VERSION ) {
			return;
		}
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$t       = sml_dgc_tables();
		$charset = $wpdb->get_charset_collate();

		dbDelta( "CREATE TABLE {$t['connectors']} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			group_id BIGINT UNSIGNED NOT NULL,
			guild_id VARCHAR(32) NULL,
			state VARCHAR(20) NOT NULL DEFAULT 'pending',
			claim_hash CHAR(64) NULL,
			claim_expires_at DATETIME NULL,
			created_by_user_id BIGINT UNSIGNED NOT NULL,
			claimed_by_discord_user_id VARCHAR(32) NOT NULL DEFAULT '',
			claimed_at DATETIME NULL,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY group_id (group_id),
			UNIQUE KEY guild_id (guild_id),
			KEY state (state),
			KEY claim_expires_at (claim_expires_at)
		) $charset;" );

		dbDelta( "CREATE TABLE {$t['maps']} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			group_id BIGINT UNSIGNED NOT NULL,
			role_id VARCHAR(32) NOT NULL,
			website_role VARCHAR(20) NOT NULL,
			created_by_user_id BIGINT UNSIGNED NOT NULL,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY group_role (group_id,role_id),
			KEY group_id (group_id)
		) $charset;" );

		dbDelta( "CREATE TABLE {$t['grants']} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			group_id BIGINT UNSIGNED NOT NULL,
			user_id BIGINT UNSIGNED NOT NULL,
			discord_user_id VARCHAR(32) NOT NULL,
			applied_role VARCHAR(20) NOT NULL,
			source_role_ids LONGTEXT NULL,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY group_user (group_id,user_id),
			KEY discord_user_id (discord_user_id),
			KEY user_id (user_id)
		) $charset;" );

		dbDelta( "CREATE TABLE {$t['audit']} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			event_type VARCHAR(64) NOT NULL,
			group_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			guild_id VARCHAR(32) NOT NULL DEFAULT '',
			discord_user_id VARCHAR(32) NOT NULL DEFAULT '',
			detail LONGTEXT NULL,
			created_at DATETIME NOT NULL,
			PRIMARY KEY (id),
			KEY group_id (group_id),
			KEY guild_id (guild_id),
			KEY created_at (created_at)
		) $charset;" );

		dbDelta( "CREATE TABLE {$t['catalogs']} (
			guild_id VARCHAR(32) NOT NULL,
			guild_name VARCHAR(190) NOT NULL DEFAULT '',
			guild_icon_url TEXT NULL,
			roles_json LONGTEXT NULL,
			channels_json LONGTEXT NULL,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY (guild_id),
			KEY updated_at (updated_at)
		) $charset;" );

		dbDelta( "CREATE TABLE {$t['channel_maps']} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			group_id BIGINT UNSIGNED NOT NULL,
			discord_channel_id VARCHAR(32) NOT NULL,
			website_channel_id BIGINT UNSIGNED NOT NULL,
			minimum_role VARCHAR(20) NOT NULL DEFAULT 'member',
			permission_snapshot LONGTEXT NULL,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY (id),
			UNIQUE KEY group_discord_channel (group_id,discord_channel_id),
			UNIQUE KEY group_website_channel (group_id,website_channel_id),
			KEY website_channel_id (website_channel_id)
		) $charset;" );

		update_option( 'sml_dgc_version', SML_DGC_VERSION, false );
	}

	function sml_dgc_now() {
		return current_time( 'mysql', true );
	}

	function sml_dgc_clean_id( $value ) {
		$value = preg_replace( '/\D/', '', (string) $value );
		return preg_match( '/^\d{15,24}$/', $value ) ? $value : '';
	}

	function sml_dgc_clean_role_ids( $roles ) {
		$clean = array();
		foreach ( is_array( $roles ) ? $roles : array() as $role ) {
			$role = sml_dgc_clean_id( $role );
			if ( '' !== $role ) {
				$clean[ $role ] = true;
			}
		}
		return array_keys( $clean );
	}

	function sml_dgc_role_weight( $role ) {
		$weights = array( 'member' => 10, 'premium' => 20, 'analyst' => 30, 'mod' => 40, 'admin' => 50 );
		return $weights[ $role ] ?? 0;
	}

	function sml_dgc_allowed_roles() {
		return array( 'member', 'premium', 'analyst', 'mod', 'admin' );
	}

	function sml_dgc_audit( $event, $group_id = 0, $user_id = 0, $guild_id = '', $discord_user_id = '', $detail = array() ) {
		global $wpdb;
		$t = sml_dgc_tables();
		$wpdb->insert(
			$t['audit'],
			array(
				'event_type'      => sanitize_key( $event ),
				'group_id'        => absint( $group_id ),
				'user_id'         => absint( $user_id ),
				'guild_id'        => sml_dgc_clean_id( $guild_id ),
				'discord_user_id' => sml_dgc_clean_id( $discord_user_id ),
				'detail'          => wp_json_encode( $detail, JSON_UNESCAPED_SLASHES ),
				'created_at'      => sml_dgc_now(),
			),
			array( '%s', '%d', '%d', '%s', '%s', '%s', '%s' )
		);
	}

	/** Mirrors the existing Groups owner/admin permission model. */
	function sml_dgc_can_manage( $group_id, $user_id = 0 ) {
		global $wpdb;
		$group_id = absint( $group_id );
		$user_id  = $user_id ? absint( $user_id ) : get_current_user_id();
		if ( ! $group_id || ! $user_id ) {
			return false;
		}
		if ( function_exists( 'sml_groups_current_user_can_manage' ) && sml_groups_current_user_can_manage( $group_id, $user_id ) ) {
			return true;
		}
		$t     = sml_dgc_tables();
		$owner = (int) $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$t['groups']} WHERE id=%d", $group_id ) );
		if ( $owner === $user_id ) {
			return true;
		}
		$role = (string) $wpdb->get_var( $wpdb->prepare( "SELECT role FROM {$t['members']} WHERE group_id=%d AND user_id=%d", $group_id, $user_id ) );
		return in_array( $role, array( 'owner', 'admin' ), true );
	}

	function sml_dgc_group_exists( $group_id ) {
		global $wpdb;
		$t = sml_dgc_tables();
		return (bool) $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$t['groups']} WHERE id=%d", absint( $group_id ) ) );
	}

	function sml_dgc_connector( $group_id ) {
		global $wpdb;
		$t = sml_dgc_tables();
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['connectors']} WHERE group_id=%d", absint( $group_id ) ), ARRAY_A );
	}

	function sml_dgc_maps( $group_id ) {
		global $wpdb;
		$t = sml_dgc_tables();
		return $wpdb->get_results( $wpdb->prepare( "SELECT role_id,website_role FROM {$t['maps']} WHERE group_id=%d ORDER BY id ASC", absint( $group_id ) ), ARRAY_A ) ?: array();
	}

	function sml_dgc_is_ready( $group_id ) {
		$config = sml_dgc_connector( $group_id );
		return $config && 'active' === $config['state'] && '' !== (string) $config['guild_id'] && count( sml_dgc_maps( $group_id ) ) > 0;
	}

	function sml_dgc_public_payload( $group_id ) {
		$ready = sml_dgc_is_ready( $group_id );
		return array( 'group_id' => absint( $group_id ), 'ready' => $ready );
	}

	function sml_dgc_owner_payload( $group_id ) {
		$config = sml_dgc_connector( $group_id );
		return array(
			'group_id' => absint( $group_id ),
			'config'   => $config ? array(
				'guild_id'   => (string) $config['guild_id'],
				'state'      => (string) $config['state'],
				'claimed_at' => (string) $config['claimed_at'],
			) : null,
			'mappings' => sml_dgc_maps( $group_id ),
		);
	}

	function sml_dgc_issue_pair_code() {
		$alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
		$code     = '';
		for ( $i = 0; $i < 10; $i++ ) {
			$code .= $alphabet[ random_int( 0, strlen( $alphabet ) - 1 ) ];
		}
		return $code;
	}

	function sml_dgc_bot_permission() {
		// The existing bot authenticates with a WordPress Application Password
		// owned by an administrator. Browser users never call bot routes.
		return current_user_can( 'manage_options' );
	}

	function sml_dgc_rest_owner_get( WP_REST_Request $request ) {
		$group_id = absint( $request['group_id'] );
		if ( ! sml_dgc_group_exists( $group_id ) ) {
			return new WP_Error( 'sml_dgc_group_missing', 'This group no longer exists.', array( 'status' => 404 ) );
		}
		if ( ! sml_dgc_can_manage( $group_id ) ) {
			return new WP_Error( 'sml_dgc_forbidden', 'Only this group’s owner or admin can manage its Discord connection.', array( 'status' => 403 ) );
		}
		return rest_ensure_response( sml_dgc_owner_payload( $group_id ) );
	}

	function sml_dgc_rest_public_get( WP_REST_Request $request ) {
		$group_id = absint( $request['group_id'] );
		if ( ! sml_dgc_group_exists( $group_id ) ) {
			return new WP_Error( 'sml_dgc_group_missing', 'This group no longer exists.', array( 'status' => 404 ) );
		}
		return rest_ensure_response( sml_dgc_public_payload( $group_id ) );
	}

	function sml_dgc_rest_start( WP_REST_Request $request ) {
		global $wpdb;
		$group_id = absint( $request['group_id'] );
		if ( ! sml_dgc_group_exists( $group_id ) ) {
			return new WP_Error( 'sml_dgc_group_missing', 'This group no longer exists.', array( 'status' => 404 ) );
		}
		if ( ! sml_dgc_can_manage( $group_id ) ) {
			return new WP_Error( 'sml_dgc_forbidden', 'Only this group’s owner or admin can start Discord setup.', array( 'status' => 403 ) );
		}
		$current = sml_dgc_connector( $group_id );
		if ( $current && 'active' === $current['state'] && '' !== (string) $current['guild_id'] ) {
			return new WP_Error( 'sml_dgc_already_connected', 'This group already has a connected Discord server. Disconnect it before pairing a different server.', array( 'status' => 409 ) );
		}
		$code   = sml_dgc_issue_pair_code();
		$now    = sml_dgc_now();
		$expire = gmdate( 'Y-m-d H:i:s', time() + ( 10 * MINUTE_IN_SECONDS ) );
		$t      = sml_dgc_tables();
		$data   = array(
			'guild_id'                => null,
			'state'                   => 'pending',
			'claim_hash'              => hash( 'sha256', $code ),
			'claim_expires_at'        => $expire,
			'created_by_user_id'      => get_current_user_id(),
			'claimed_by_discord_user_id' => '',
			'claimed_at'              => null,
			'updated_at'              => $now,
		);
		if ( $current ) {
			$wpdb->update( $t['connectors'], $data, array( 'group_id' => $group_id ) );
		} else {
			$data['group_id']   = $group_id;
			$data['created_at'] = $now;
			$wpdb->insert( $t['connectors'], $data );
		}
		sml_dgc_audit( 'pairing_started', $group_id, get_current_user_id(), '', '', array( 'expires_at' => $expire ) );
		return rest_ensure_response( array(
			'code'        => $code,
			'expires_at'  => gmdate( 'c', strtotime( $expire . ' UTC' ) ),
			'command'     => '/connect-sml-group code:' . $code,
			'invite_url'  => 'https://discord.com/oauth2/authorize?client_id=' . rawurlencode( SML_DGC_DISCORD_APP_ID ) . '&scope=bot%20applications.commands&permissions=0',
		) );
	}

	function sml_dgc_rest_save_maps( WP_REST_Request $request ) {
		global $wpdb;
		$group_id = absint( $request['group_id'] );
		if ( ! sml_dgc_can_manage( $group_id ) ) {
			return new WP_Error( 'sml_dgc_forbidden', 'Only this group’s owner or admin can change Discord role mappings.', array( 'status' => 403 ) );
		}
		$config = sml_dgc_connector( $group_id );
		if ( ! $config || 'active' !== $config['state'] || '' === (string) $config['guild_id'] ) {
			return new WP_Error( 'sml_dgc_not_connected', 'Connect a Discord server before mapping its roles.', array( 'status' => 409 ) );
		}
		$input = $request->get_param( 'mappings' );
		$input = is_array( $input ) ? $input : array();
		if ( count( $input ) > 20 ) {
			return new WP_Error( 'sml_dgc_too_many_maps', 'Use no more than 20 Discord role mappings per group.', array( 'status' => 400 ) );
		}
		$maps = array();
		foreach ( $input as $row ) {
			$role_id = sml_dgc_clean_id( is_array( $row ) ? ( $row['role_id'] ?? '' ) : '' );
			$role    = sanitize_key( is_array( $row ) ? ( $row['website_role'] ?? '' ) : '' );
			if ( '' === $role_id || ! in_array( $role, sml_dgc_allowed_roles(), true ) ) {
				return new WP_Error( 'sml_dgc_invalid_map', 'Every mapping needs a valid Discord Role ID and website role. Owner roles cannot be granted by Discord.', array( 'status' => 400 ) );
			}
			$maps[ $role_id ] = $role; // a role can map once; the last row wins deterministically.
		}
		$t   = sml_dgc_tables();
		$now = sml_dgc_now();
		$wpdb->delete( $t['maps'], array( 'group_id' => $group_id ), array( '%d' ) );
		foreach ( $maps as $role_id => $role ) {
			$wpdb->insert( $t['maps'], array(
				'group_id'          => $group_id,
				'role_id'           => $role_id,
				'website_role'      => $role,
				'created_by_user_id'=> get_current_user_id(),
				'created_at'        => $now,
				'updated_at'        => $now,
			) );
		}
		sml_dgc_audit( 'mappings_saved', $group_id, get_current_user_id(), $config['guild_id'], '', array( 'count' => count( $maps ) ) );
		return rest_ensure_response( sml_dgc_owner_payload( $group_id ) );
	}

	function sml_dgc_rest_bot_claim( WP_REST_Request $request ) {
		global $wpdb;
		$code            = strtoupper( preg_replace( '/[^A-Z0-9]/', '', (string) $request->get_param( 'code' ) ) );
		$guild_id        = sml_dgc_clean_id( $request->get_param( 'guild_id' ) );
		$discord_user_id = sml_dgc_clean_id( $request->get_param( 'discord_user_id' ) );
		if ( strlen( $code ) !== 10 || '' === $guild_id || '' === $discord_user_id ) {
			return new WP_Error( 'sml_dgc_invalid_claim', 'That group connection code is invalid or expired.', array( 'status' => 400 ) );
		}
		$t   = sml_dgc_tables();
		$now = sml_dgc_now();
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['connectors']} WHERE claim_hash=%s AND state='pending' AND claim_expires_at >= %s", hash( 'sha256', $code ), $now ), ARRAY_A );
		if ( ! $row ) {
			return new WP_Error( 'sml_dgc_invalid_claim', 'That group connection code is invalid or expired.', array( 'status' => 400 ) );
		}
		$other = $wpdb->get_row( $wpdb->prepare( "SELECT group_id FROM {$t['connectors']} WHERE guild_id=%s AND group_id<>%d", $guild_id, (int) $row['group_id'] ), ARRAY_A );
		if ( $other ) {
			return new WP_Error( 'sml_dgc_guild_in_use', 'This Discord server is already connected to another StockMarketLoop group.', array( 'status' => 409 ) );
		}
		$wpdb->update( $t['connectors'], array(
			'guild_id'                    => $guild_id,
			'state'                       => 'active',
			'claim_hash'                  => null,
			'claim_expires_at'            => null,
			'claimed_by_discord_user_id'  => $discord_user_id,
			'claimed_at'                  => $now,
			'updated_at'                  => $now,
		), array( 'id' => (int) $row['id'] ) );
		sml_dgc_audit( 'discord_server_claimed', (int) $row['group_id'], (int) $row['created_by_user_id'], $guild_id, $discord_user_id );
		return rest_ensure_response( array( 'connected' => true, 'group_id' => (int) $row['group_id'], 'guild_id' => $guild_id ) );
	}

	function sml_dgc_rest_bot_configured_guilds() {
		global $wpdb;
		$t = sml_dgc_tables();
		$ids = $wpdb->get_col( "SELECT guild_id FROM {$t['connectors']} WHERE state='active' AND guild_id<>''" ) ?: array();
		return rest_ensure_response( array( 'guild_ids' => array_values( array_unique( array_filter( array_map( 'sml_dgc_clean_id', $ids ) ) ) ) ) );
	}

	function sml_dgc_desired_role( $group_id, $role_ids ) {
		$role_set = array_flip( sml_dgc_clean_role_ids( $role_ids ) );
		$desired  = '';
		foreach ( sml_dgc_maps( $group_id ) as $map ) {
			$role = sanitize_key( $map['website_role'] );
			if ( isset( $role_set[ (string) $map['role_id'] ] ) && sml_dgc_role_weight( $role ) > sml_dgc_role_weight( $desired ) ) {
				$desired = $role;
			}
		}
		return $desired;
	}

	function sml_dgc_sync_one_group( $group_id, $user_id, $discord_user_id, $desired_role, $source_role_ids ) {
		global $wpdb;
		$t            = sml_dgc_tables();
		$group_id     = absint( $group_id );
		$user_id      = absint( $user_id );
		$desired_role  = sanitize_key( $desired_role );
		$now          = sml_dgc_now();
		$membership   = $wpdb->get_row( $wpdb->prepare( "SELECT id,role FROM {$t['members']} WHERE group_id=%d AND user_id=%d", $group_id, $user_id ), ARRAY_A );
		$grant        = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['grants']} WHERE group_id=%d AND user_id=%d", $group_id, $user_id ), ARRAY_A );

		if ( '' === $desired_role ) {
			if ( ! $grant ) {
				return array( 'group_id' => $group_id, 'action' => 'none' );
			}
			if ( $membership && (string) $membership['role'] === (string) $grant['applied_role'] ) {
				$wpdb->delete( $t['members'], array( 'group_id' => $group_id, 'user_id' => $user_id ), array( '%d', '%d' ) );
				$action = 'revoked';
			} else {
				$action = 'protected_manual_membership';
			}
			$wpdb->delete( $t['grants'], array( 'id' => (int) $grant['id'] ), array( '%d' ) );
			sml_dgc_audit( 'role_' . $action, $group_id, $user_id, '', $discord_user_id, array( 'previous_role' => $grant['applied_role'] ) );
			return array( 'group_id' => $group_id, 'action' => $action );
		}

		if ( ! $membership ) {
			$wpdb->insert( $t['members'], array( 'group_id' => $group_id, 'user_id' => $user_id, 'role' => $desired_role, 'joined_at' => $now ), array( '%d', '%d', '%s', '%s' ) );
			$action = 'granted';
		} elseif ( $grant && (string) $membership['role'] === (string) $grant['applied_role'] ) {
			if ( (string) $membership['role'] !== $desired_role ) {
				$wpdb->update( $t['members'], array( 'role' => $desired_role ), array( 'group_id' => $group_id, 'user_id' => $user_id ), array( '%s' ), array( '%d', '%d' ) );
				$action = 'updated';
			} else {
				$action = 'unchanged';
			}
		} elseif ( $grant ) {
			return array( 'group_id' => $group_id, 'action' => 'protected_manual_membership' );
		} else {
			return array( 'group_id' => $group_id, 'action' => 'protected_existing_membership' );
		}

		$grant_data = array(
			'discord_user_id' => $discord_user_id,
			'applied_role'    => $desired_role,
			'source_role_ids' => wp_json_encode( array_values( sml_dgc_clean_role_ids( $source_role_ids ) ) ),
			'updated_at'      => $now,
		);
		if ( $grant ) {
			$wpdb->update( $t['grants'], $grant_data, array( 'id' => (int) $grant['id'] ) );
		} else {
			$grant_data += array( 'group_id' => $group_id, 'user_id' => $user_id, 'created_at' => $now );
			$wpdb->insert( $t['grants'], $grant_data );
		}
		if ( 'unchanged' !== $action ) {
			sml_dgc_audit( 'role_' . $action, $group_id, $user_id, '', $discord_user_id, array( 'role' => $desired_role ) );
		}
		return array( 'group_id' => $group_id, 'action' => $action, 'role' => $desired_role );
	}

	function sml_dgc_rest_bot_sync( WP_REST_Request $request ) {
		global $wpdb;
		$guild_id        = sml_dgc_clean_id( $request->get_param( 'guild_id' ) );
		$discord_user_id = sml_dgc_clean_id( $request->get_param( 'discord_user_id' ) );
		$role_ids        = sml_dgc_clean_role_ids( $request->get_param( 'role_ids' ) );
		$t               = sml_dgc_tables();
		$config          = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['connectors']} WHERE guild_id=%s AND state='active'", $guild_id ), ARRAY_A );
		if ( '' === $guild_id || '' === $discord_user_id || ! $config ) {
			return new WP_Error( 'sml_dgc_unmapped_guild', 'This Discord server is not configured for website group access.', array( 'status' => 404 ) );
		}
		$links_exists = (string) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $t['links'] ) ) === $t['links'];
		if ( ! $links_exists ) {
			return new WP_Error( 'sml_dgc_identity_unavailable', 'The Discord identity-link service is unavailable; no access was changed.', array( 'status' => 503 ) );
		}
		$link = $wpdb->get_row( $wpdb->prepare( "SELECT user_id FROM {$t['links']} WHERE discord_user_id=%s", $discord_user_id ), ARRAY_A );
		if ( ! $link ) {
			return rest_ensure_response( array( 'linked' => false, 'changed' => false, 'results' => array() ) );
		}
		$desired = sml_dgc_desired_role( (int) $config['group_id'], $role_ids );
		$result  = sml_dgc_sync_one_group( (int) $config['group_id'], (int) $link['user_id'], $discord_user_id, $desired, $role_ids );
		return rest_ensure_response( array(
			'linked'  => true,
			'changed' => in_array( $result['action'] ?? '', array( 'granted', 'updated', 'revoked' ), true ),
			'results' => array( $result ),
		) );
	}

	function sml_dgc_catalog( $guild_id ) {
		global $wpdb;
		$t = sml_dgc_tables();
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['catalogs']} WHERE guild_id=%s", sml_dgc_clean_id( $guild_id ) ), ARRAY_A );
		if ( ! $row ) {
			return null;
		}
		return array(
			'guild_id'       => (string) $row['guild_id'],
			'guild_name'     => (string) $row['guild_name'],
			'guild_icon_url' => esc_url_raw( $row['guild_icon_url'] ),
			'roles'          => json_decode( (string) $row['roles_json'], true ) ?: array(),
			'channels'       => json_decode( (string) $row['channels_json'], true ) ?: array(),
			'updated_at'     => (string) $row['updated_at'],
		);
	}

	function sml_dgc_channel_maps( $group_id ) {
		global $wpdb;
		$t = sml_dgc_tables();
		return $wpdb->get_results( $wpdb->prepare( "SELECT discord_channel_id,website_channel_id,minimum_role,permission_snapshot FROM {$t['channel_maps']} WHERE group_id=%d ORDER BY id ASC", absint( $group_id ) ), ARRAY_A ) ?: array();
	}

	function sml_dgc_rest_bot_catalog( WP_REST_Request $request ) {
		global $wpdb;
		$guild_id = sml_dgc_clean_id( $request->get_param( 'guild_id' ) );
		$t = sml_dgc_tables();
		$config = $wpdb->get_row( $wpdb->prepare( "SELECT group_id FROM {$t['connectors']} WHERE guild_id=%s AND state='active'", $guild_id ), ARRAY_A );
		if ( '' === $guild_id || ! $config ) {
			return new WP_Error( 'sml_dgc_unmapped_guild', 'This Discord server is not connected to a StockMarketLoop group.', array( 'status' => 404 ) );
		}
		$roles_in = $request->get_param( 'roles' );
		$channels_in = $request->get_param( 'channels' );
		$roles = array();
		foreach ( array_slice( is_array( $roles_in ) ? $roles_in : array(), 0, 250 ) as $role ) {
			$id = sml_dgc_clean_id( $role['id'] ?? '' );
			if ( ! $id ) { continue; }
			$roles[] = array(
				'id' => $id,
				'name' => sanitize_text_field( $role['name'] ?? '' ),
				'position' => intval( $role['position'] ?? 0 ),
				'color' => absint( $role['color'] ?? 0 ),
				'managed' => ! empty( $role['managed'] ),
			);
		}
		$channels = array();
		foreach ( array_slice( is_array( $channels_in ) ? $channels_in : array(), 0, 500 ) as $channel ) {
			$id = sml_dgc_clean_id( $channel['id'] ?? '' );
			if ( ! $id ) { continue; }
			$overwrites = array();
			foreach ( array_slice( is_array( $channel['permission_overwrites'] ?? null ) ? $channel['permission_overwrites'] : array(), 0, 250 ) as $overwrite ) {
				$oid = sml_dgc_clean_id( $overwrite['id'] ?? '' );
				if ( $oid ) {
					$overwrites[] = array( 'id' => $oid, 'type' => absint( $overwrite['type'] ?? 0 ), 'allow' => (string) ( $overwrite['allow'] ?? '0' ), 'deny' => (string) ( $overwrite['deny'] ?? '0' ) );
				}
			}
			$channels[] = array(
				'id' => $id,
				'name' => sanitize_text_field( $channel['name'] ?? '' ),
				'type' => absint( $channel['type'] ?? 0 ),
				'position' => intval( $channel['position'] ?? 0 ),
				'parent_id' => sml_dgc_clean_id( $channel['parent_id'] ?? '' ),
				'permission_overwrites' => $overwrites,
			);
		}
		$data = array(
			'guild_name' => sanitize_text_field( $request->get_param( 'guild_name' ) ),
			'guild_icon_url' => esc_url_raw( $request->get_param( 'guild_icon_url' ) ),
			'roles_json' => wp_json_encode( $roles ),
			'channels_json' => wp_json_encode( $channels ),
			'updated_at' => sml_dgc_now(),
		);
		$exists = $wpdb->get_var( $wpdb->prepare( "SELECT guild_id FROM {$t['catalogs']} WHERE guild_id=%s", $guild_id ) );
		if ( $exists ) {
			$wpdb->update( $t['catalogs'], $data, array( 'guild_id' => $guild_id ) );
		} else {
			$data['guild_id'] = $guild_id;
			$wpdb->insert( $t['catalogs'], $data );
		}
		sml_dgc_audit( 'guild_catalog_updated', (int) $config['group_id'], 0, $guild_id, '', array( 'roles' => count( $roles ), 'channels' => count( $channels ) ) );
		return rest_ensure_response( array( 'saved' => true, 'roles' => count( $roles ), 'channels' => count( $channels ) ) );
	}

	function sml_dgc_rest_channel_sync_get( WP_REST_Request $request ) {
		$group_id = absint( $request['group_id'] );
		if ( ! sml_dgc_can_manage( $group_id ) ) {
			return new WP_Error( 'sml_dgc_forbidden', 'Only this group’s owner or admin can manage Discord channel sync.', array( 'status' => 403 ) );
		}
		$config = sml_dgc_connector( $group_id );
		if ( ! $config || 'active' !== $config['state'] ) {
			return new WP_Error( 'sml_dgc_not_connected', 'Connect a Discord server first.', array( 'status' => 409 ) );
		}
		return rest_ensure_response( array( 'catalog' => sml_dgc_catalog( $config['guild_id'] ), 'mappings' => sml_dgc_maps( $group_id ), 'channel_mappings' => sml_dgc_channel_maps( $group_id ) ) );
	}

	function sml_dgc_save_role_maps_array( $group_id, $input ) {
		global $wpdb;
		$t = sml_dgc_tables();
		$maps = array();
		foreach ( array_slice( is_array( $input ) ? $input : array(), 0, 50 ) as $row ) {
			$id = sml_dgc_clean_id( $row['role_id'] ?? '' );
			$role = sanitize_key( $row['website_role'] ?? '' );
			if ( $id && in_array( $role, sml_dgc_allowed_roles(), true ) ) { $maps[ $id ] = $role; }
		}
		$wpdb->delete( $t['maps'], array( 'group_id' => $group_id ), array( '%d' ) );
		foreach ( $maps as $id => $role ) {
			$wpdb->insert( $t['maps'], array( 'group_id' => $group_id, 'role_id' => $id, 'website_role' => $role, 'created_by_user_id' => get_current_user_id(), 'created_at' => sml_dgc_now(), 'updated_at' => sml_dgc_now() ) );
		}
		return $maps;
	}

	function sml_dgc_rest_channel_sync_save( WP_REST_Request $request ) {
		global $wpdb;
		$group_id = absint( $request['group_id'] );
		if ( ! sml_dgc_can_manage( $group_id ) ) {
			return new WP_Error( 'sml_dgc_forbidden', 'Only this group’s owner or admin can sync Discord channels.', array( 'status' => 403 ) );
		}
		$config = sml_dgc_connector( $group_id );
		$catalog = $config ? sml_dgc_catalog( $config['guild_id'] ) : null;
		if ( ! $catalog ) {
			return new WP_Error( 'sml_dgc_catalog_missing', 'The Discord bot has not supplied this server’s channel list yet. Run /sync-sml-channels in that Discord server and try again.', array( 'status' => 409 ) );
		}
		$role_maps = sml_dgc_save_role_maps_array( $group_id, $request->get_param( 'role_mappings' ) );
		$by_id = array();
		foreach ( $catalog['channels'] as $channel ) { $by_id[ (string) $channel['id'] ] = $channel; }
		$selected = is_array( $request->get_param( 'channels' ) ) ? $request->get_param( 'channels' ) : array();
		if ( count( $selected ) > 100 ) {
			return new WP_Error( 'sml_dgc_too_many_channels', 'Select no more than 100 channels at once.', array( 'status' => 400 ) );
		}
		$t = sml_dgc_tables();
		$saved = array();
		foreach ( $selected as $choice ) {
			$discord_id = sml_dgc_clean_id( $choice['discord_channel_id'] ?? '' );
			if ( ! $discord_id || empty( $by_id[ $discord_id ] ) ) { continue; }
			$source = $by_id[ $discord_id ];
			$type = sanitize_key( $choice['website_type'] ?? 'text' );
			if ( ! in_array( $type, array( 'text', 'alerts', 'education', 'voice', 'live' ), true ) ) { $type = 'text'; }
			$minimum_role = sanitize_key( $choice['minimum_role'] ?? 'member' );
			if ( ! in_array( $minimum_role, sml_dgc_allowed_roles(), true ) ) { $minimum_role = 'member'; }
			$name = sanitize_text_field( $source['name'] ?? '' );
			if ( '' === $name ) { continue; }
			$existing = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['channel_maps']} WHERE group_id=%d AND discord_channel_id=%s", $group_id, $discord_id ), ARRAY_A );
			$website_id = $existing ? absint( $existing['website_channel_id'] ) : 0;
			if ( ! $website_id ) {
				$website_id = absint( $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$t['channels']} WHERE group_id=%d AND LOWER(name)=LOWER(%s) LIMIT 1", $group_id, $name ) ) );
			}
			if ( ! $website_id ) {
				$order = 1 + absint( $wpdb->get_var( $wpdb->prepare( "SELECT MAX(order_index) FROM {$t['channels']} WHERE group_id=%d", $group_id ) ) );
				$wpdb->insert( $t['channels'], array( 'group_id' => $group_id, 'name' => $name, 'type' => $type, 'is_locked' => 'member' === $minimum_role ? 0 : 1, 'order_index' => $order, 'created_at' => sml_dgc_now() ) );
				$website_id = absint( $wpdb->insert_id );
			} else {
				$wpdb->update( $t['channels'], array( 'name' => $name, 'type' => $type, 'is_locked' => 'member' === $minimum_role ? 0 : 1 ), array( 'id' => $website_id, 'group_id' => $group_id ) );
			}
			if ( ! $website_id ) { continue; }
			$data = array( 'website_channel_id' => $website_id, 'minimum_role' => $minimum_role, 'permission_snapshot' => wp_json_encode( $source['permission_overwrites'] ?? array() ), 'updated_at' => sml_dgc_now() );
			if ( $existing ) { $wpdb->update( $t['channel_maps'], $data, array( 'id' => absint( $existing['id'] ) ) ); }
			else { $data += array( 'group_id' => $group_id, 'discord_channel_id' => $discord_id, 'created_at' => sml_dgc_now() ); $wpdb->insert( $t['channel_maps'], $data ); }
			$saved[] = array( 'discord_channel_id' => $discord_id, 'website_channel_id' => $website_id, 'minimum_role' => $minimum_role );
		}
		sml_dgc_audit( 'channels_synced', $group_id, get_current_user_id(), $config['guild_id'], '', array( 'channels' => count( $saved ), 'role_maps' => count( $role_maps ) ) );
		return rest_ensure_response( array( 'saved' => true, 'channels' => $saved, 'role_mappings' => sml_dgc_maps( $group_id ) ) );
	}

	function sml_dgc_current_group_role( $group_id ) {
		if ( sml_dgc_can_manage( $group_id ) ) { return 'admin'; }
		global $wpdb;
		$t = sml_dgc_tables();
		return sanitize_key( $wpdb->get_var( $wpdb->prepare( "SELECT role FROM {$t['members']} WHERE group_id=%d AND user_id=%d", absint( $group_id ), get_current_user_id() ) ) );
	}

	function sml_dgc_can_view_channel( $channel_id ) {
		global $wpdb;
		$t = sml_dgc_tables();
		$map = $wpdb->get_row( $wpdb->prepare( "SELECT group_id,minimum_role FROM {$t['channel_maps']} WHERE website_channel_id=%d", absint( $channel_id ) ), ARRAY_A );
		if ( ! $map ) { return true; }
		return sml_dgc_role_weight( sml_dgc_current_group_role( (int) $map['group_id'] ) ) >= sml_dgc_role_weight( $map['minimum_role'] );
	}

	function sml_dgc_guard_channel_requests( $result, $server, $request ) {
		$route = $request->get_route();
		if ( ! in_array( $route, array( '/sml/v1/group/channel/messages', '/sml/v1/group/channel/message/send' ), true ) ) { return $result; }
		if ( ! sml_dgc_can_view_channel( absint( $request->get_param( 'channel_id' ) ) ) ) {
			return new WP_Error( 'sml_dgc_channel_forbidden', 'Your synced Discord role does not allow access to this channel.', array( 'status' => 403 ) );
		}
		return $result;
	}

	function sml_dgc_filter_channel_list( $response, $server, $request ) {
		if ( '/sml/v1/group/channels' !== $request->get_route() || is_wp_error( $response ) ) { return $response; }
		$data = $response instanceof WP_REST_Response ? $response->get_data() : $response;
		if ( ! is_array( $data ) || ! isset( $data['channels'] ) || ! is_array( $data['channels'] ) ) { return $response; }
		$data['channels'] = array_values( array_filter( $data['channels'], static function( $channel ) { return sml_dgc_can_view_channel( absint( $channel['id'] ?? 0 ) ); } ) );
		if ( $response instanceof WP_REST_Response ) { $response->set_data( $data ); return $response; }
		return rest_ensure_response( $data );
	}

	function sml_dgc_register_routes() {
		register_rest_route( 'sml-discord-site/v2', '/group/(?P<group_id>\d+)', array(
			'methods' => 'GET', 'callback' => 'sml_dgc_rest_owner_get', 'permission_callback' => 'is_user_logged_in',
		) );
		register_rest_route( 'sml-discord-site/v2', '/group/(?P<group_id>\d+)/public', array(
			'methods' => 'GET', 'callback' => 'sml_dgc_rest_public_get', 'permission_callback' => '__return_true',
		) );
		register_rest_route( 'sml-discord-site/v2', '/group/(?P<group_id>\d+)/start', array(
			'methods' => 'POST', 'callback' => 'sml_dgc_rest_start', 'permission_callback' => 'is_user_logged_in',
		) );
		register_rest_route( 'sml-discord-site/v2', '/group/(?P<group_id>\d+)/mappings', array(
			'methods' => 'POST', 'callback' => 'sml_dgc_rest_save_maps', 'permission_callback' => 'is_user_logged_in',
		) );
		register_rest_route( 'sml-discord-site/v2', '/bot/claim-group', array(
			'methods' => 'POST', 'callback' => 'sml_dgc_rest_bot_claim', 'permission_callback' => 'sml_dgc_bot_permission',
		) );
		register_rest_route( 'sml-discord-site/v2', '/bot/configured-guilds', array(
			'methods' => 'GET', 'callback' => 'sml_dgc_rest_bot_configured_guilds', 'permission_callback' => 'sml_dgc_bot_permission',
		) );
		register_rest_route( 'sml-discord-site/v2', '/bot/sync-roles', array(
			'methods' => 'POST', 'callback' => 'sml_dgc_rest_bot_sync', 'permission_callback' => 'sml_dgc_bot_permission',
		) );
		register_rest_route( 'sml-discord-site/v2', '/bot/guild-catalog', array(
			'methods' => 'POST', 'callback' => 'sml_dgc_rest_bot_catalog', 'permission_callback' => 'sml_dgc_bot_permission',
		) );
		register_rest_route( 'sml-discord-site/v2', '/group/(?P<group_id>\d+)/channel-sync', array(
			array( 'methods' => 'GET', 'callback' => 'sml_dgc_rest_channel_sync_get', 'permission_callback' => 'is_user_logged_in' ),
			array( 'methods' => 'POST', 'callback' => 'sml_dgc_rest_channel_sync_save', 'permission_callback' => 'is_user_logged_in' ),
		) );
	}

	function sml_dgc_group_ui() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return;
		}
		$path = wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '', PHP_URL_PATH );
		if ( ! preg_match( '#^/groups/[^/]+/?$#i', (string) $path ) ) {
			return;
		}
		$config = array(
			'api'   => esc_url_raw( rest_url( 'sml-discord-site/v2/' ) ),
			'v1api' => esc_url_raw( rest_url( 'sml-discord-site/v1/' ) ),
			'nonce' => wp_create_nonce( 'wp_rest' ),
		);
		?>
		<style id="sml-dgc-ui-css">
		.sml-dgc-connect{display:inline-flex!important;align-items:center;gap:7px;margin-left:8px!important;background:#5865f2!important;border-color:#7480ff!important;color:#fff!important;text-decoration:none!important}.sml-dgc-owner{margin-left:8px!important;background:#182036!important;border:1px solid #6571f7!important;color:#dce0ff!important}.sml-dgc-modal{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(1,5,13,.76);backdrop-filter:blur(7px)}.sml-dgc-card{width:min(820px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:24px;border:1px solid #4959d9;border-radius:18px;background:#09111f;color:#eaf0ff;box-shadow:0 26px 90px #000b}.sml-dgc-card h2{margin:0 38px 8px 0;color:#fff}.sml-dgc-card p,.sml-dgc-card li{color:#b9c7db;line-height:1.55}.sml-dgc-card code{display:block;overflow-wrap:anywhere;margin:12px 0;padding:12px;border-radius:9px;background:#020714;color:#8ba0ff;font-weight:800}.sml-dgc-close{float:right;border:0;border-radius:8px;padding:7px 10px;background:#24324b;color:#fff;cursor:pointer}.sml-dgc-primary{border:0;border-radius:9px;padding:11px 14px;background:#5865f2;color:#fff;font-weight:800;cursor:pointer}.sml-dgc-secondary{display:inline-block;margin:8px 8px 8px 0;border:1px solid #6371f8;border-radius:9px;padding:10px 12px;background:transparent;color:#dce2ff;text-decoration:none;font-weight:700}.sml-dgc-map{display:grid;grid-template-columns:minmax(0,1fr) 145px auto;gap:8px;margin:8px 0}.sml-dgc-map input,.sml-dgc-map select,.sml-dgc-sync-row select{min-width:0;padding:10px;border:1px solid #31415e;border-radius:8px;background:#060c16;color:#fff}.sml-dgc-map button{border:0;border-radius:8px;padding:9px;background:#632f42;color:#fff;cursor:pointer}.sml-dgc-note{font-size:13px;color:#9eb0c8}.sml-dgc-state{margin:14px 0;padding:10px;border-radius:8px;background:#12253a;color:#c4e0ff}.sml-dgc-error{margin:10px 0;color:#ffabb3;font-weight:700}.sml-dgc-sync-button{width:100%;margin-top:12px!important;background:#5865f2!important;color:#fff!important}.sml-dgc-sync-row{display:grid;grid-template-columns:minmax(170px,1fr) 135px 135px;align-items:center;gap:9px;padding:10px;border-bottom:1px solid #1d2b42}.sml-dgc-sync-row label{display:flex;align-items:center;gap:8px;color:#eef3ff;font-weight:700}.sml-dgc-role-row{display:grid;grid-template-columns:minmax(0,1fr) 160px;gap:9px;margin:7px 0}.sml-dgc-role-row select{padding:9px;border:1px solid #31415e;border-radius:8px;background:#060c16;color:#fff}@media(max-width:650px){.sml-dgc-sync-row{grid-template-columns:1fr}.sml-dgc-map{grid-template-columns:1fr}}.sml-dgc-page-card{max-width:720px;margin:38px auto;padding:28px;border:1px solid #5061dc;border-radius:18px;background:#09111f;color:#ebf1ff}.sml-dgc-page-card h1{color:#fff}.sml-dgc-page-card .sml-dgc-code{font:800 28px/1.2 ui-monospace,monospace;letter-spacing:.1em;color:#99a9ff}.sml-dgc-page-card button{border:0;border-radius:9px;padding:11px 14px;background:#5865f2;color:#fff;font-weight:800;cursor:pointer}
		</style>
		<script id="sml-dgc-ui-js">(function(){
			var C=<?php echo wp_json_encode( $config ); ?>, root, gid, ownerData;
			function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
			function api(path,opt){opt=opt||{};opt.credentials='same-origin';opt.headers=Object.assign({'X-WP-Nonce':C.nonce},opt.headers||{});if(opt.body&&!opt.headers['Content-Type'])opt.headers['Content-Type']='application/json';return fetch(C.api+path,opt).then(function(r){return r.json().catch(function(){return {};}).then(function(j){if(!r.ok)throw new Error(j.message||'Request failed.');return j;});});}
			function legacy(path,opt){opt=opt||{};opt.credentials='same-origin';opt.headers=Object.assign({'X-WP-Nonce':C.nonce},opt.headers||{});if(opt.body&&!opt.headers['Content-Type'])opt.headers['Content-Type']='application/json';return fetch(C.v1api+path,opt).then(function(r){return r.json().catch(function(){return {};}).then(function(j){if(!r.ok)throw new Error(j.message||'Request failed.');return j;});});}
			function groupUrl(){var u=new URL(location.href);u.searchParams.set('sml_discord_group_connect','1');u.searchParams.set('group_id',gid);return u.pathname+'?'+u.searchParams.toString();}
			function closeModal(){var m=document.querySelector('.sml-dgc-modal');if(m)m.remove();}
			function modal(html){closeModal();var m=document.createElement('div');m.className='sml-dgc-modal';m.innerHTML='<section class="sml-dgc-card" role="dialog" aria-modal="true"><button class="sml-dgc-close" type="button">Close</button>'+html+'</section>';m.querySelector('.sml-dgc-close').onclick=closeModal;document.body.appendChild(m);return m;}
			function mapRow(map){map=map||{};return '<div class="sml-dgc-map"><input inputmode="numeric" maxlength="24" placeholder="Discord Role ID" value="'+esc(map.role_id)+'"><select><option value="member">Member</option><option value="premium">Premium</option><option value="analyst">Analyst</option><option value="mod">Moderator</option><option value="admin">Admin</option></select><button type="button" aria-label="Remove mapping">Remove</button></div>';}
			function selectValue(row,value){var s=row.querySelector('select');if(s)s.value=value||'member';}
			function ownerPanel(data,pair){ownerData=data||ownerData||{};var cfg=ownerData.config,maps=ownerData.mappings||[];if(cfg&&cfg.state==='active'){var ownerButton=document.querySelector('[data-sml-dgc-owner]');if(ownerButton)ownerButton.remove();}var h='<h2>Discord access</h2><p>Connect one Discord server to this group. Only a person with <strong>Manage Server</strong> permission can finish the secure pairing inside Discord.</p>';
				if(!cfg||cfg.state!=='active'){h+='<div class="sml-dgc-state">No Discord server is connected yet.</div><button class="sml-dgc-primary" type="button" data-start>Start secure setup</button>';}
				else{h+='<div class="sml-dgc-state">Connected Discord server: <strong>'+esc(cfg.guild_id)+'</strong></div><h3>Discord role mappings</h3><p class="sml-dgc-note">Turn on Discord Developer Mode, right-click each role in your Discord server, and choose <em>Copy Role ID</em>. Discord roles can grant Member, Premium, Analyst, Moderator, or Admin—never group owner.</p><div data-rows></div><button class="sml-dgc-secondary" type="button" data-add>Add another role</button><button class="sml-dgc-primary" type="button" data-save>Save role mappings</button>';}
				var m=modal(h);if(pair){var box=document.createElement('div');box.innerHTML='<hr><h3>Finish in Discord</h3><ol><li><a class="sml-dgc-secondary" target="_blank" rel="noopener" href="'+esc(pair.invite_url)+'">Add StockMarketLoop Connect to your Discord server</a></li><li>Inside that Discord server, use this command before it expires:</li></ol><code>'+esc(pair.command)+'</code><button class="sml-dgc-secondary" type="button" data-copy>Copy command</button><p class="sml-dgc-note">The bot checks that the person running this command has Manage Server permission. Then return here to map your roles.</p>';m.querySelector('.sml-dgc-card').appendChild(box);box.querySelector('[data-copy]').onclick=function(){navigator.clipboard&&navigator.clipboard.writeText(pair.command);this.textContent='Copied';};}
				if(!cfg||cfg.state!=='active'){var start=m.querySelector('[data-start]');if(start)start.onclick=function(){start.disabled=true;api('group/'+gid+'/start',{method:'POST',body:'{}'}).then(function(p){return api('group/'+gid).then(function(d){ownerPanel(d,p);});}).catch(function(e){start.disabled=false;start.insertAdjacentHTML('afterend','<div class="sml-dgc-error">'+esc(e.message)+'</div>');});};return;}
				var rows=m.querySelector('[data-rows]');maps.forEach(function(x){var wrap=document.createElement('div');wrap.innerHTML=mapRow(x);selectValue(wrap,x.website_role);rows.appendChild(wrap.firstChild);});if(!maps.length){var first=document.createElement('div');first.innerHTML=mapRow();rows.appendChild(first.firstChild);}function bindRemove(){rows.querySelectorAll('.sml-dgc-map button').forEach(function(b){b.onclick=function(){var all=rows.querySelectorAll('.sml-dgc-map');if(all.length>1)this.parentNode.remove();else this.parentNode.querySelector('input').value='';};});}bindRemove();m.querySelector('[data-add]').onclick=function(){var w=document.createElement('div');w.innerHTML=mapRow();rows.appendChild(w.firstChild);bindRemove();};m.querySelector('[data-save]').onclick=function(){var btn=this, out=[];rows.querySelectorAll('.sml-dgc-map').forEach(function(row){var id=row.querySelector('input').value.replace(/\D/g,'');if(id)out.push({role_id:id,website_role:row.querySelector('select').value});});btn.disabled=true;api('group/'+gid+'/mappings',{method:'POST',body:JSON.stringify({mappings:out})}).then(function(d){ownerData=d;ownerPanel(d);}).catch(function(e){btn.disabled=false;btn.insertAdjacentHTML('afterend','<div class="sml-dgc-error">'+esc(e.message)+'</div>');});};}
			function roleOptions(value,none){var out=none?'<option value="">Do not migrate</option>':'';['member','premium','analyst','mod','admin'].forEach(function(r){out+='<option value="'+r+'" '+(value===r?'selected':'')+'>'+({'member':'Member','premium':'Premium','analyst':'Analyst','mod':'Moderator','admin':'Admin'}[r])+'</option>';});return out;}
			function channelTypeOptions(value){return ['text','alerts','education','voice','live'].map(function(t){return '<option value="'+t+'" '+(value===t?'selected':'')+'>'+t.charAt(0).toUpperCase()+t.slice(1)+'</option>';}).join('');}
			function discordChannelSync(){api('group/'+gid+'/channel-sync').then(function(d){var c=d.catalog;if(!c)throw new Error('The Discord channel list is not ready. In Discord, run /sync-sml-channels, then reopen this panel.');var saved={};(d.channel_mappings||[]).forEach(function(x){saved[String(x.discord_channel_id)]=x;});var roleSaved={};(d.mappings||[]).forEach(function(x){roleSaved[String(x.role_id)]=x.website_role;});var roles=(c.roles||[]).filter(function(r){return !r.managed&&String(r.id)!==String(c.guild_id);});var channels=(c.channels||[]).filter(function(ch){return [0,2,5,13,15].indexOf(Number(ch.type))>=0;});var h='<h2>Discord Server Channel Sync</h2><div class="sml-dgc-state">Connected to <strong>'+esc(c.guild_name||c.guild_id)+'</strong></div><p>Select the Discord roles and channels to migrate. Private-channel permissions are enforced on the website; owners and admins always retain management access.</p><h3>Role migration</h3><div data-sync-roles>'+roles.map(function(r){return '<div class="sml-dgc-role-row" data-role-id="'+esc(r.id)+'"><strong>'+esc(r.name)+'</strong><select>'+roleOptions(roleSaved[String(r.id)]||'',true)+'</select></div>';}).join('')+'</div><h3>Channels</h3><div data-sync-channels>'+channels.map(function(ch){var s=saved[String(ch.id)]||{},type=s.website_channel_id?(Number(ch.type)===2?'voice':Number(ch.type)===13?'live':'text'):(Number(ch.type)===2?'voice':Number(ch.type)===13?'live':'text'),min=s.minimum_role||'member';try{var everyone=(ch.permission_overwrites||[]).filter(function(o){return String(o.id)===String(c.guild_id);})[0];if(!s.minimum_role&&everyone&&(BigInt(everyone.deny)&1024n)!==0n)min='premium';}catch(e){}return '<div class="sml-dgc-sync-row" data-channel-id="'+esc(ch.id)+'"><label><input type="checkbox" '+(s.website_channel_id?'checked':'')+'> # '+esc(ch.name)+'</label><select data-channel-type>'+channelTypeOptions(type)+'</select><select data-min-role>'+roleOptions(min,false)+'</select></div>';}).join('')+'</div><button class="sml-dgc-primary" type="button" data-sync-save>Build &amp; Sync Selected Channels</button><p class="sml-dgc-note">Sync is repeat-safe: rerunning it updates mapped channels instead of creating duplicates. Channels you did not select are not changed or deleted.</p>';var m=modal(h),btn=m.querySelector('[data-sync-save]');btn.onclick=function(){var roleMaps=[],channelMaps=[];m.querySelectorAll('[data-role-id]').forEach(function(row){var v=row.querySelector('select').value;if(v)roleMaps.push({role_id:row.dataset.roleId,website_role:v});});m.querySelectorAll('[data-channel-id]').forEach(function(row){if(row.querySelector('input').checked)channelMaps.push({discord_channel_id:row.dataset.channelId,website_type:row.querySelector('[data-channel-type]').value,minimum_role:row.querySelector('[data-min-role]').value});});btn.disabled=true;btn.textContent='Syncing…';api('group/'+gid+'/channel-sync',{method:'POST',body:JSON.stringify({role_mappings:roleMaps,channels:channelMaps})}).then(function(result){btn.textContent='Synced '+result.channels.length+' channel'+(result.channels.length===1?'':'s');setTimeout(closeModal,1000);}).catch(function(e){btn.disabled=false;btn.textContent='Build & Sync Selected Channels';btn.insertAdjacentHTML('afterend','<div class="sml-dgc-error">'+esc(e.message)+'</div>');});};}).catch(function(e){modal('<h2>Discord Server Channel Sync</h2><p class="sml-dgc-error">'+esc(e.message)+'</p>');});}
			function addChannelSyncControl(){if(!ownerData||!ownerData.config||ownerData.config.state!=='active')return;var box=document.querySelector('.sml-manage-mini');if(!box||box.querySelector('[data-sml-dgc-channel-sync]'))return;var b=document.createElement('button');b.type='button';b.className='sml-group-btn sml-dgc-sync-button';b.dataset.smlDgcChannelSync='1';b.textContent='Discord Server Channel Sync';b.onclick=discordChannelSync;box.appendChild(b);}
			function addOwnerControl(){api('group/'+gid).then(function(d){ownerData=d;if(d.config&&d.config.state==='active'){var old=document.querySelector('[data-sml-dgc-owner]');if(old)old.remove();addChannelSyncControl();return;}var head=document.querySelector('.sml-gshell__main-head,.sml-group-head,.sml-group-header');if(!head||head.querySelector('[data-sml-dgc-owner]'))return;var b=document.createElement('button');b.type='button';b.className='sml-gshell__edit sml-dgc-owner';b.dataset.smlDgcOwner='1';b.textContent='Discord Access';b.onclick=function(){ownerPanel(ownerData);};var edit=head.querySelector('[data-smlgs-edit],.sml-gshell__edit');if(edit)edit.insertAdjacentElement('afterend',b);else head.appendChild(b);}).catch(function(){});}
			function removeMemberControl(){var b=document.querySelector('[data-sml-dgc-connect]');if(b)b.remove();}
			function watchMemberConnection(){var attempts=0,timer=setInterval(function(){attempts++;legacy('status').then(function(s){if(s&&s.connected){clearInterval(timer);removeMemberControl();}}).catch(function(){});if(attempts>=90)clearInterval(timer);},5000);}
			function addMemberControl(){api('group/'+gid+'/public').then(function(d){if(!d.ready)return;return legacy('status').catch(function(){return {connected:false};});}).then(function(s){if(!s||s.connected){removeMemberControl();return;}var actions=document.querySelector('.sml-group-actions,.sml-gshell__group-actions,[data-group-actions]');if(!actions||actions.querySelector('[data-sml-dgc-connect],[data-sml-mem-discord-connect]'))return;var a=document.createElement('a');a.className='sml-group-btn sml-dgc-connect';a.dataset.smlDgcConnect='1';a.href=groupUrl();a.textContent='🔗 Connect Discord';var join=actions.querySelector('[data-join],.sml-group-btn');if(join)join.insertAdjacentElement('afterend',a);else actions.appendChild(a);watchMemberConnection();}).catch(function(){});}
			function memberConnectPage(){var q=new URLSearchParams(location.search);if(q.get('sml_discord_group_connect')!=='1'||String(q.get('group_id')||'')!==String(gid))return;api('group/'+gid+'/public').then(function(d){if(!d.ready)throw new Error('Discord access is not configured for this group yet.');return legacy('status').then(function(s){if(s&&s.connected)return {already:true};return legacy('link-code',{method:'POST',body:'{}'});});}).then(function(code){var host=document.querySelector('main,.sml-gshell__main')||root,card=document.createElement('section');card.className='sml-dgc-page-card';if(code.already){card.innerHTML='<h1>Discord connected</h1><p>Your Discord account is already connected. Group access is kept in sync with your mapped Discord role.</p>';removeMemberControl();host.prepend(card);return;}card.innerHTML='<h1>Connect Discord</h1><p>Use this one-time command in the Discord server connected to this group. It expires in 10 minutes and links your Discord account to your StockMarketLoop account.</p><code class="sml-dgc-code">/link-sml code:'+esc(code.code)+'</code><button type="button">Copy command</button><p class="sml-dgc-note">After Discord confirms the link, your mapped Discord role controls this group’s website access. Paid or manually managed access is never replaced.</p>';host.prepend(card);card.querySelector('button').onclick=function(){navigator.clipboard&&navigator.clipboard.writeText('/link-sml code:'+code.code);this.textContent='Copied — paste it in Discord';};var tries=0,poll=setInterval(function(){tries++;legacy('status').then(function(s){if(s&&s.connected){clearInterval(poll);removeMemberControl();card.innerHTML='<h1>Discord connected</h1><p>Your Discord account is now connected. Group access will follow your mapped Discord role.</p>';}}).catch(function(){});if(tries>=120)clearInterval(poll);},5000);}).catch(function(e){var host=document.querySelector('main,.sml-gshell__main')||root;var card=document.createElement('section');card.className='sml-dgc-page-card';card.innerHTML='<h1>Connect Discord</h1><p class="sml-dgc-error">'+esc(e.message||'Please sign in before connecting Discord.')+'</p>';host.prepend(card);});}
			function boot(){root=document.getElementById('sml-group-root');gid=root&&String(root.dataset.groupId||'').replace(/\D/g,'');if(!root||!gid)return false;addMemberControl();addOwnerControl();memberConnectPage();new MutationObserver(function(){addChannelSyncControl();}).observe(root,{childList:true,subtree:true});return true;}
			if(!boot())[100,500,1200,2600].forEach(function(ms){setTimeout(boot,ms);});
		})();</script>
		<?php
	}

	add_action( 'init', 'sml_dgc_install', 1 );
	add_action( 'rest_api_init', 'sml_dgc_register_routes' );
	add_filter( 'rest_pre_dispatch', 'sml_dgc_guard_channel_requests', 10, 3 );
	add_filter( 'rest_post_dispatch', 'sml_dgc_filter_channel_list', 10, 3 );
	add_action( 'wp_footer', 'sml_dgc_group_ui', 99 );
}
