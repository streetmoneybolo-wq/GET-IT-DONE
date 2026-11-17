<?php
/**
 * Plugin Name: SML Discord Group Message Relay
 * Description: Feeds owner-selected channels of connected Discord servers into their mapped website group channels. Site-side WP-cron poller against the Discord REST API — no bot process required; the Connect bot only needs to be a member of the guild.
 * Version: 1.2.0 (per-channel account/persona attribution, opt-in bot and webhook imports, forgery-proof provenance, durable dedup, quotas, and stream-route gating)
 *
 * How a server joins the network (all pre-existing): a server owner runs
 * /connect-sml-group with a one-time code from their group's Discord Access
 * panel, then /sync-sml-channels; the group owner picks channels under
 * Edit Group → Discord Server Channel Sync, which creates real website group
 * channels (wp_sml_group_channels) and maps (wp_sml_discord_group_channel_maps).
 * THIS plugin relays new Discord messages in mapped channels into the mapped
 * website channels. Each group owner/admin can keep the neutral Discord
 * identity, attribute imports to a real group member account, or create a
 * named non-login alert persona with its own avatar and description.
 *
 * Config (options, no UI):
 *   sml_dgc_relay_bot_token        — token of the Connect bot (member of every connected guild).
 *   sml_dgc_relay_enabled          — '1' (default) / '0'.
 *   sml_dgc_relay_disabled_guilds  — array of guild ids to pause.
 *   sml_dgc_relay_blocked_authors  — array of Discord user ids to drop.
 * State: sml_dgc_relay_cursors, sml_dgc_relay_status, sml_dgc_relay_backoff,
 * sml_dgc_relay_quota, sml_dgc_relay_rr; durable dedup + moderation provenance
 * in table wp_sml_dgc_relay_log (discord_message_id UNIQUE, author id per row).
 * ROLLBACK: delete this file; it writes only its own options/table + chat rows.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SML_DGC_RELAY_VERSION', '1.2.0' );
define( 'SML_DGC_RELAY_DB', '1.2.0' );

function sml_dgc_relay_log_table() {
	global $wpdb;
	return $wpdb->prefix . 'sml_dgc_relay_log';
}

add_action( 'init', function () {
	if ( get_option( 'sml_dgc_relay_db_version' ) !== SML_DGC_RELAY_DB ) {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = sml_dgc_relay_log_table();
		$charset = $wpdb->get_charset_collate();
		dbDelta( "CREATE TABLE {$table} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			discord_message_id VARCHAR(32) NOT NULL,
			guild_id VARCHAR(32) NOT NULL DEFAULT '',
			discord_channel_id VARCHAR(32) NOT NULL DEFAULT '',
			discord_author_id VARCHAR(32) NOT NULL DEFAULT '',
			map_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			identity_mode VARCHAR(16) NOT NULL DEFAULT 'relay',
			site_user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			source_is_automated TINYINT(1) NOT NULL DEFAULT 0,
			site_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (id),
			UNIQUE KEY discord_message (discord_message_id),
			KEY author_recent (discord_author_id, created_at)
		) {$charset};" );
		if ( function_exists( 'sml_dgc_tables' ) ) {
			$tables = sml_dgc_tables();
			$maps   = (string) ( $tables['channel_maps'] ?? '' );
			if ( $maps && $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $maps ) ) === $maps ) {
				$columns = array(
					'author_mode'        => "VARCHAR(16) NOT NULL DEFAULT 'relay'",
					'author_user_id'     => 'BIGINT UNSIGNED NOT NULL DEFAULT 0',
					'persona_user_id'    => 'BIGINT UNSIGNED NOT NULL DEFAULT 0',
					'persona_name'       => "VARCHAR(80) NOT NULL DEFAULT ''",
					'persona_description'=> "VARCHAR(280) NOT NULL DEFAULT ''",
					'persona_avatar_url' => 'TEXT NULL',
					'allow_automated'    => 'TINYINT(1) NOT NULL DEFAULT 0',
					'identity_updated_at'=> 'DATETIME NULL',
				);
				foreach ( $columns as $name => $definition ) {
					$exists = $wpdb->get_var( $wpdb->prepare( "SHOW COLUMNS FROM {$maps} LIKE %s", $name ) );
					if ( ! $exists ) {
						$wpdb->query( "ALTER TABLE {$maps} ADD COLUMN {$name} {$definition}" );
					}
				}
			}
		}
		update_option( 'sml_dgc_relay_db_version', SML_DGC_RELAY_DB, false );
	}
}, 4 );

function sml_dgc_relay_enabled() {
	return '0' !== (string) get_option( 'sml_dgc_relay_enabled', '1' ) && '' !== (string) get_option( 'sml_dgc_relay_bot_token', '' );
}

/** The site identity relayed messages are posted under (display name "Discord").
 *  Only the option is trusted; a pre-existing login of the same name is never
 *  adopted (review: pre-registering the login must not hijack the relay). */
function sml_dgc_relay_user_id() {
	$uid = absint( get_option( 'sml_dgc_relay_user_id', 0 ) );
	if ( $uid && get_userdata( $uid ) ) {
		return $uid;
	}
	$login = 'sml-discord-relay';
	if ( get_user_by( 'login', $login ) ) {
		$login .= '-' . strtolower( wp_generate_password( 6, false, false ) );
	}
	$uid = wp_insert_user( array(
		'user_login'   => $login,
		'user_pass'    => wp_generate_password( 48, true, true ),
		'display_name' => 'Discord',
		'role'         => 'subscriber',
	) );
	if ( is_wp_error( $uid ) ) {
		return 0;
	}
	update_user_meta( (int) $uid, 'sml_dgc_relay_identity', '1' );
	update_option( 'sml_dgc_relay_user_id', (int) $uid, false );
	return (int) $uid;
}

function sml_dgc_relay_can_manage_group( $group_id, $user_id = 0 ) {
	global $wpdb;
	$group_id = absint( $group_id );
	$user_id  = $user_id ? absint( $user_id ) : get_current_user_id();
	if ( ! $group_id || ! $user_id ) {
		return false;
	}
	if ( function_exists( 'sml_dgc_can_manage' ) ) {
		return (bool) sml_dgc_can_manage( $group_id, $user_id );
	}
	$owner_id = (int) $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$wpdb->prefix}sml_groups WHERE id=%d", $group_id ) );
	if ( $owner_id === $user_id ) {
		return true;
	}
	$role = (string) $wpdb->get_var( $wpdb->prepare( "SELECT role FROM {$wpdb->prefix}sml_group_members WHERE group_id=%d AND user_id=%d", $group_id, $user_id ) );
	return in_array( $role, array( 'owner', 'admin' ), true );
}

function sml_dgc_relay_group_member( $group_id, $user_id ) {
	global $wpdb;
	$group_id = absint( $group_id );
	$user_id  = absint( $user_id );
	if ( ! $group_id || ! $user_id || ! get_userdata( $user_id ) ) {
		return false;
	}
	$owner_id = (int) $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$wpdb->prefix}sml_groups WHERE id=%d", $group_id ) );
	if ( $owner_id === $user_id ) {
		return true;
	}
	return (bool) $wpdb->get_var( $wpdb->prepare( "SELECT 1 FROM {$wpdb->prefix}sml_group_members WHERE group_id=%d AND user_id=%d LIMIT 1", $group_id, $user_id ) );
}

function sml_dgc_relay_persona_user( $group_id, $map_id, $existing_user_id, $name, $description, $avatar_url ) {
	$group_id         = absint( $group_id );
	$map_id           = absint( $map_id );
	$existing_user_id = absint( $existing_user_id );
	$name             = trim( sanitize_text_field( $name ) );
	$description      = trim( sanitize_textarea_field( $description ) );
	$avatar_url       = esc_url_raw( $avatar_url );
	if ( '' === $name ) {
		return new WP_Error( 'sml_dgc_persona_name', 'Enter a name for the alert bot or persona.', array( 'status' => 422 ) );
	}
	$user = $existing_user_id ? get_userdata( $existing_user_id ) : false;
	if ( $user && (int) get_user_meta( $user->ID, 'sml_dgc_persona_map_id', true ) !== $map_id ) {
		return new WP_Error( 'sml_dgc_persona_owner', 'That alert persona does not belong to this channel mapping.', array( 'status' => 409 ) );
	}
	if ( ! $user ) {
		$base  = 'sml-alert-' . $group_id . '-' . $map_id;
		$login = $base;
		if ( get_user_by( 'login', $login ) ) {
			$login .= '-' . strtolower( wp_generate_password( 6, false, false ) );
		}
		$user_id = wp_insert_user( array(
			'user_login'   => $login,
			'user_pass'    => wp_generate_password( 64, true, true ),
			'display_name' => $name,
			'description'  => $description,
			'role'         => 'subscriber',
		) );
		if ( is_wp_error( $user_id ) ) {
			return $user_id;
		}
		$user = get_userdata( $user_id );
	}
	$updated = wp_update_user( array( 'ID' => $user->ID, 'display_name' => $name, 'description' => $description ) );
	if ( is_wp_error( $updated ) ) {
		return $updated;
	}
	update_user_meta( $user->ID, 'sml_dgc_persona_identity', '1' );
	update_user_meta( $user->ID, 'sml_dgc_persona_group_id', $group_id );
	update_user_meta( $user->ID, 'sml_dgc_persona_map_id', $map_id );
	update_user_meta( $user->ID, 'sml_dgc_persona_avatar_url', $avatar_url );
	update_user_meta( $user->ID, 'sml_avatar_url', $avatar_url );
	return (int) $user->ID;
}

function sml_dgc_relay_identity_for_map( $map ) {
	$mode = sanitize_key( (string) ( $map['author_mode'] ?? 'relay' ) );
	if ( 'account' === $mode ) {
		$user_id = absint( $map['author_user_id'] ?? 0 );
		if ( $user_id && get_userdata( $user_id ) && sml_dgc_relay_group_member( $map['group_id'] ?? 0, $user_id ) ) {
			return array( 'mode' => 'account', 'user_id' => $user_id );
		}
	}
	if ( 'persona' === $mode ) {
		$user_id = absint( $map['persona_user_id'] ?? 0 );
		if ( $user_id && get_userdata( $user_id ) && (int) get_user_meta( $user_id, 'sml_dgc_persona_map_id', true ) === absint( $map['map_id'] ?? $map['id'] ?? 0 ) ) {
			return array( 'mode' => 'persona', 'user_id' => $user_id );
		}
	}
	return array( 'mode' => 'relay', 'user_id' => sml_dgc_relay_user_id() );
}

add_filter( 'get_avatar_data', function ( $args, $id_or_email ) {
	$user = false;
	if ( $id_or_email instanceof WP_User ) {
		$user = $id_or_email;
	} elseif ( is_numeric( $id_or_email ) ) {
		$user = get_userdata( absint( $id_or_email ) );
	} elseif ( $id_or_email instanceof WP_Post ) {
		$user = get_userdata( (int) $id_or_email->post_author );
	}
	if ( ! $user || '1' !== (string) get_user_meta( $user->ID, 'sml_dgc_persona_identity', true ) ) {
		return $args;
	}
	$url = esc_url_raw( (string) get_user_meta( $user->ID, 'sml_dgc_persona_avatar_url', true ) );
	if ( $url ) {
		$args['url']          = $url;
		$args['found_avatar'] = true;
	}
	return $args;
}, 30, 2 );

function sml_dgc_relay_identity_payload( $group_id ) {
	global $wpdb;
	$tables = function_exists( 'sml_dgc_tables' ) ? sml_dgc_tables() : array();
	$maps   = (string) ( $tables['channel_maps'] ?? '' );
	if ( ! $maps ) {
		return new WP_Error( 'sml_dgc_unavailable', 'Discord channel mapping is not available.', array( 'status' => 503 ) );
	}
	$rows = $wpdb->get_results( $wpdb->prepare(
		"SELECT m.id,m.discord_channel_id,m.website_channel_id,m.author_mode,m.author_user_id,m.persona_user_id,m.persona_name,m.persona_description,m.persona_avatar_url,m.allow_automated,c.name website_channel_name
		 FROM {$maps} m LEFT JOIN {$wpdb->prefix}sml_group_channels c ON c.id=m.website_channel_id
		 WHERE m.group_id=%d ORDER BY c.order_index ASC,m.id ASC",
		$group_id
	), ARRAY_A ) ?: array();
	$owner_id = (int) $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$wpdb->prefix}sml_groups WHERE id=%d", $group_id ) );
	$member_ids = $wpdb->get_col( $wpdb->prepare( "SELECT user_id FROM {$wpdb->prefix}sml_group_members WHERE group_id=%d ORDER BY FIELD(role,'owner','admin','mod','analyst','premium','member'),user_id LIMIT 300", $group_id ) ) ?: array();
	$member_ids[] = $owner_id;
	$members = array();
	foreach ( array_values( array_unique( array_filter( array_map( 'absint', $member_ids ) ) ) ) as $user_id ) {
		$user = get_userdata( $user_id );
		if ( ! $user ) {
			continue;
		}
		$members[] = array(
			'id'          => (int) $user->ID,
			'name'        => (string) $user->display_name,
			'avatar_url'  => get_avatar_url( $user->ID, array( 'size' => 72 ) ),
			'profile_url' => get_author_posts_url( $user->ID ),
			'is_owner'    => (int) $user->ID === $owner_id,
		);
	}
	foreach ( $rows as &$row ) {
		$row['id']                = (int) $row['id'];
		$row['website_channel_id']= (int) $row['website_channel_id'];
		$row['author_user_id']    = (int) $row['author_user_id'];
		$row['persona_user_id']   = (int) $row['persona_user_id'];
		$row['allow_automated']   = (bool) $row['allow_automated'];
	}
	return array( 'group_id' => (int) $group_id, 'mappings' => $rows, 'members' => $members, 'current_user_id' => get_current_user_id() );
}

function sml_dgc_relay_identity_rest( WP_REST_Request $request ) {
	global $wpdb;
	$group_id = absint( $request['group_id'] );
	if ( ! sml_dgc_relay_can_manage_group( $group_id ) ) {
		return new WP_Error( 'sml_dgc_forbidden', 'Only this group’s owner or admin can manage Discord alert identities.', array( 'status' => 403 ) );
	}
	if ( 'GET' === $request->get_method() ) {
		return rest_ensure_response( sml_dgc_relay_identity_payload( $group_id ) );
	}
	$tables = function_exists( 'sml_dgc_tables' ) ? sml_dgc_tables() : array();
	$maps   = (string) ( $tables['channel_maps'] ?? '' );
	$input  = (array) $request->get_param( 'mappings' );
	if ( ! $maps || ! $input ) {
		return new WP_Error( 'sml_dgc_identity_empty', 'Choose at least one mapped channel.', array( 'status' => 422 ) );
	}
	$owned = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$maps} WHERE group_id=%d", $group_id ), OBJECT_K ) ?: array();
	$updates = array();
	foreach ( $input as $choice ) {
		$map_id = absint( is_array( $choice ) ? ( $choice['id'] ?? 0 ) : 0 );
		if ( ! $map_id || empty( $owned[ $map_id ] ) ) {
			return new WP_Error( 'sml_dgc_identity_map', 'A selected channel mapping does not belong to this group.', array( 'status' => 403 ) );
		}
		$mode = sanitize_key( (string) ( $choice['author_mode'] ?? 'relay' ) );
		if ( ! in_array( $mode, array( 'relay', 'account', 'persona' ), true ) ) {
			return new WP_Error( 'sml_dgc_identity_mode', 'Choose a valid alert identity.', array( 'status' => 422 ) );
		}
		$data = array(
			'author_mode'         => $mode,
			'author_user_id'      => 0,
			'allow_automated'     => rest_sanitize_boolean( $choice['allow_automated'] ?? false ) ? 1 : 0,
			'identity_updated_at' => current_time( 'mysql', true ),
		);
		if ( 'account' === $mode ) {
			$user_id = absint( $choice['author_user_id'] ?? 0 );
			if ( ! sml_dgc_relay_group_member( $group_id, $user_id ) ) {
				return new WP_Error( 'sml_dgc_identity_member', 'The selected author must be a current member of this group.', array( 'status' => 422 ) );
			}
			$data['author_user_id'] = $user_id;
		}
		if ( 'persona' === $mode ) {
			$persona_id = sml_dgc_relay_persona_user(
				$group_id,
				$map_id,
				absint( $owned[ $map_id ]->persona_user_id ?? 0 ),
				(string) ( $choice['persona_name'] ?? '' ),
				(string) ( $choice['persona_description'] ?? '' ),
				(string) ( $choice['persona_avatar_url'] ?? '' )
			);
			if ( is_wp_error( $persona_id ) ) {
				return $persona_id;
			}
			$data['persona_user_id']     = $persona_id;
			$data['persona_name']        = sanitize_text_field( (string) ( $choice['persona_name'] ?? '' ) );
			$data['persona_description'] = sanitize_textarea_field( (string) ( $choice['persona_description'] ?? '' ) );
			$data['persona_avatar_url']  = esc_url_raw( (string) ( $choice['persona_avatar_url'] ?? '' ) );
		}
		$updates[ $map_id ] = $data;
	}
	foreach ( $updates as $map_id => $data ) {
		$wpdb->update( $maps, $data, array( 'id' => $map_id, 'group_id' => $group_id ) );
	}
	if ( function_exists( 'sml_dgc_audit' ) ) {
		sml_dgc_audit( 'relay_identity_saved', $group_id, get_current_user_id(), '', '', array( 'mapping_ids' => array_keys( $updates ) ) );
	}
	return rest_ensure_response( array( 'saved' => true, 'settings' => sml_dgc_relay_identity_payload( $group_id ) ) );
}

function sml_dgc_relay_avatar_rest( WP_REST_Request $request ) {
	$group_id = absint( $request['group_id'] );
	if ( ! sml_dgc_relay_can_manage_group( $group_id ) ) {
		return new WP_Error( 'sml_dgc_forbidden', 'Only this group’s owner or admin can upload an alert avatar.', array( 'status' => 403 ) );
	}
	$files = $request->get_file_params();
	if ( empty( $files['avatar'] ) || ! is_array( $files['avatar'] ) ) {
		return new WP_Error( 'sml_dgc_avatar_missing', 'Choose an avatar image.', array( 'status' => 400 ) );
	}
	if ( (int) ( $files['avatar']['size'] ?? 0 ) > 2 * MB_IN_BYTES ) {
		return new WP_Error( 'sml_dgc_avatar_size', 'Alert avatars are limited to 2 MB.', array( 'status' => 413 ) );
	}
	if ( ! function_exists( 'media_handle_upload' ) ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
	}
	$attachment_id = media_handle_upload( 'avatar', 0, array( 'post_author' => get_current_user_id() ), array(
		'test_form' => false,
		'mimes' => array( 'jpg|jpeg|jpe' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif' ),
	) );
	if ( is_wp_error( $attachment_id ) ) {
		return $attachment_id;
	}
	$url = wp_get_attachment_url( $attachment_id );
	return rest_ensure_response( array( 'attachment_id' => (int) $attachment_id, 'url' => esc_url_raw( $url ) ) );
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-discord-relay/v1', '/group/(?P<group_id>\d+)/identities', array(
		array( 'methods' => 'GET', 'callback' => 'sml_dgc_relay_identity_rest', 'permission_callback' => 'is_user_logged_in' ),
		array( 'methods' => 'POST', 'callback' => 'sml_dgc_relay_identity_rest', 'permission_callback' => 'is_user_logged_in' ),
	) );
	register_rest_route( 'sml-discord-relay/v1', '/group/(?P<group_id>\d+)/avatar', array(
		'methods' => 'POST', 'callback' => 'sml_dgc_relay_avatar_rest', 'permission_callback' => 'is_user_logged_in',
	) );
} );

function sml_dgc_relay_identity_ui() {
	global $wpdb;
	if ( is_admin() || ! is_user_logged_in() ) {
		return;
	}
	$path = trim( (string) wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ), '/' );
	if ( ! preg_match( '#^groups/([^/]+)$#i', $path, $match ) ) {
		return;
	}
	$slug     = sanitize_title( rawurldecode( $match[1] ) );
	$group_id = (int) $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$wpdb->prefix}sml_groups WHERE slug=%s LIMIT 1", $slug ) );
	if ( ! $group_id || ! sml_dgc_relay_can_manage_group( $group_id ) ) {
		return;
	}
	$config = array(
		'groupId' => $group_id,
		'api'     => esc_url_raw( rest_url( 'sml-discord-relay/v1/group/' . $group_id . '/' ) ),
		'nonce'   => wp_create_nonce( 'wp_rest' ),
	);
	?>
	<style id="sml-dgc-identity-css">
	.sml-dgci-open{border:0;border-radius:9px;background:#19c37d;color:#07150f;padding:10px 14px;font-weight:800;cursor:pointer;margin:8px 0}.sml-dgci-float{position:fixed;right:18px;bottom:84px;z-index:9991;box-shadow:0 10px 30px rgba(0,0,0,.35)}
	.sml-dgci-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(3,7,18,.82);display:flex;align-items:center;justify-content:center;padding:18px}.sml-dgci-modal{width:min(940px,100%);max-height:90vh;overflow:auto;background:#101827;color:#eef4ff;border:1px solid #34445f;border-radius:18px;padding:22px;box-shadow:0 28px 90px rgba(0,0,0,.55)}
	.sml-dgci-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.sml-dgci-head h2{margin:0 0 6px}.sml-dgci-close{background:transparent;color:#d9e4f5;border:1px solid #52617a;border-radius:8px;padding:7px 11px;cursor:pointer}.sml-dgci-list{display:grid;gap:14px;margin:18px 0}.sml-dgci-row{border:1px solid #31415b;border-radius:14px;padding:16px;background:#151f31}.sml-dgci-row h3{margin:0 0 12px}.sml-dgci-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.sml-dgci-field{display:grid;gap:6px;color:#b9c7db}.sml-dgci-field input,.sml-dgci-field select,.sml-dgci-field textarea{width:100%;box-sizing:border-box;background:#0b1220;color:#f3f7ff;border:1px solid #42516a;border-radius:8px;padding:10px}.sml-dgci-field textarea{min-height:76px;resize:vertical}.sml-dgci-persona[hidden],.sml-dgci-account[hidden]{display:none}.sml-dgci-check{display:flex;gap:9px;align-items:flex-start;margin-top:12px;color:#d4deed}.sml-dgci-note{color:#9fb0c8;font-size:.9rem}.sml-dgci-actions{display:flex;align-items:center;gap:12px}.sml-dgci-save{border:0;border-radius:9px;background:#19c37d;color:#07150f;padding:11px 18px;font-weight:900;cursor:pointer}.sml-dgci-status{color:#a9bad1}.sml-dgci-status.bad{color:#ff9aab}.sml-dgci-avatar{display:flex;gap:10px;align-items:center}.sml-dgci-avatar img{width:46px;height:46px;border-radius:50%;object-fit:cover;background:#26354d}@media(max-width:700px){.sml-dgci-grid{grid-template-columns:1fr}.sml-dgci-modal{padding:16px}}
	</style>
	<script id="sml-dgc-identity-js">
	(function(){
	var C=<?php echo wp_json_encode( $config ); ?>;
	function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];});}
	async function api(path,opt){opt=opt||{};var headers=opt.headers||{};headers['X-WP-Nonce']=C.nonce;if(!(opt.body instanceof FormData))headers['Content-Type']='application/json';var r=await fetch(C.api+path,Object.assign({credentials:'same-origin',headers:headers},opt));var p=await r.json().catch(function(){return {};});if(!r.ok||p.code)throw new Error(p.message||'Request failed.');return p;}
	function memberOptions(members,current){return members.map(function(m){return '<option value="'+m.id+'" '+(Number(m.id)===Number(current)?'selected':'')+'>'+esc(m.name)+(m.is_owner?' (owner)':'')+'</option>';}).join('');}
	function rowHtml(m,members,current){var mode=['relay','account','persona'].indexOf(m.author_mode)>=0?m.author_mode:'relay';var selected=m.author_user_id||current;var avatar=m.persona_avatar_url||'';return '<section class="sml-dgci-row" data-map="'+m.id+'"><h3>'+esc(m.website_channel_name||('Website channel '+m.website_channel_id))+'</h3><div class="sml-dgci-grid"><label class="sml-dgci-field"><span>Who should these Discord alerts appear from?</span><select data-mode><option value="account" '+(mode==='account'?'selected':'')+'>A StockMarketLoop account</option><option value="persona" '+(mode==='persona'?'selected':'')+'>A custom alert bot/profile</option><option value="relay" '+(mode==='relay'?'selected':'')+'>Neutral “Discord” account</option></select></label><label class="sml-dgci-field sml-dgci-account" '+(mode==='account'?'':'hidden')+'><span>Account</span><select data-account>'+memberOptions(members,selected)+'</select></label></div><div class="sml-dgci-persona" '+(mode==='persona'?'':'hidden')+'><div class="sml-dgci-grid"><label class="sml-dgci-field"><span>Bot/profile name</span><input data-persona-name maxlength="80" value="'+esc(m.persona_name||'')+'" placeholder="Grandmaster-Obi Alerts"></label><label class="sml-dgci-field"><span>Short description</span><textarea data-persona-description maxlength="280" placeholder="Daily options alerts and trade updates.">'+esc(m.persona_description||'')+'</textarea></label></div><label class="sml-dgci-field"><span>Profile photo</span><div class="sml-dgci-avatar"><img data-avatar-preview src="'+esc(avatar)+'" alt=""><input data-avatar-url type="hidden" value="'+esc(avatar)+'"><input data-avatar-file type="file" accept="image/jpeg,image/png,image/webp,image/gif"></div></label></div><label class="sml-dgci-check"><input data-automated type="checkbox" '+(m.allow_automated?'checked':'')+'><span>Allow messages sent by Discord bots or webhooks in this channel. <small class="sml-dgci-note">Off by default to prevent bot loops.</small></span></label><p class="sml-dgci-note">The original Discord message ID and author stay in the private audit log even when the public card uses an account or custom persona.</p></section>';}
	async function open(){var shell=document.createElement('div');shell.className='sml-dgci-backdrop';shell.innerHTML='<div class="sml-dgci-modal" role="dialog" aria-modal="true" aria-labelledby="sml-dgci-title"><div class="sml-dgci-head"><div><h2 id="sml-dgci-title">Discord alert identity</h2><p class="sml-dgci-note">Choose how imports appear in each mapped group channel.</p></div><button class="sml-dgci-close" type="button">Close</button></div><div class="sml-dgci-list"><p>Loading channel mappings…</p></div><div class="sml-dgci-actions"><button class="sml-dgci-save" type="button">Save identities</button><span class="sml-dgci-status"></span></div></div>';document.body.appendChild(shell);shell.querySelector('.sml-dgci-close').onclick=function(){shell.remove();};shell.addEventListener('click',function(e){if(e.target===shell)shell.remove();});var list=shell.querySelector('.sml-dgci-list'),status=shell.querySelector('.sml-dgci-status');try{var d=await api('identities');list.innerHTML=d.mappings.length?d.mappings.map(function(m){return rowHtml(m,d.members,d.current_user_id);}).join(''):'<p>No Discord channels are mapped yet. Use Discord Server Channel Sync first.</p>';list.addEventListener('change',async function(e){var row=e.target.closest('[data-map]');if(!row)return;if(e.target.matches('[data-mode]')){var mode=e.target.value;row.querySelector('.sml-dgci-account').hidden=mode!=='account';row.querySelector('.sml-dgci-persona').hidden=mode!=='persona';}if(e.target.matches('[data-avatar-file]')&&e.target.files&&e.target.files[0]){status.textContent='Uploading profile photo…';status.classList.remove('bad');var fd=new FormData();fd.append('avatar',e.target.files[0]);try{var up=await api('avatar',{method:'POST',body:fd});row.querySelector('[data-avatar-url]').value=up.url;row.querySelector('[data-avatar-preview]').src=up.url;status.textContent='Profile photo uploaded. Save identities to apply it.';}catch(err){status.textContent=err.message;status.classList.add('bad');}}});}catch(err){list.innerHTML='<p>'+esc(err.message)+'</p>';status.classList.add('bad');}
		shell.querySelector('.sml-dgci-save').onclick=async function(){var btn=this;var mappings=[];list.querySelectorAll('[data-map]').forEach(function(row){mappings.push({id:Number(row.dataset.map),author_mode:row.querySelector('[data-mode]').value,author_user_id:Number(row.querySelector('[data-account]').value||0),persona_name:row.querySelector('[data-persona-name]').value,persona_description:row.querySelector('[data-persona-description]').value,persona_avatar_url:row.querySelector('[data-avatar-url]').value,allow_automated:row.querySelector('[data-automated]').checked});});btn.disabled=true;status.textContent='Saving…';status.classList.remove('bad');try{await api('identities',{method:'POST',body:JSON.stringify({mappings:mappings})});status.textContent='Saved. New Discord alerts will use these identities.';}catch(err){status.textContent=err.message;status.classList.add('bad');}finally{btn.disabled=false;}};
	}
	function mount(){if(document.querySelector('[data-sml-dgci-open]'))return;var b=document.createElement('button');b.type='button';b.className='sml-dgci-open';b.dataset.smlDgciOpen='1';b.textContent='Discord alert identity';b.onclick=open;var card=document.querySelector('.sml-discord-group-card');if(card){card.appendChild(b);}else{b.classList.add('sml-dgci-float');document.body.appendChild(b);}}
	mount();new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});
	})();
	</script>
	<?php
}
add_action( 'wp_footer', 'sml_dgc_relay_identity_ui', 101 );

add_filter( 'cron_schedules', function ( $schedules ) {
	if ( ! isset( $schedules['sml_discord_minute'] ) ) {
		$schedules['sml_discord_minute'] = array( 'interval' => 60, 'display' => 'Every minute' );
	}
	return $schedules;
} );

add_action( 'init', function () {
	if ( ! wp_next_scheduled( 'sml_dgc_relay_tick' ) ) {
		wp_schedule_event( time() + 20, 'sml_discord_minute', 'sml_dgc_relay_tick' );
	}
} );

/* The group page's live poll route serves channel messages but predates dgc's
   role gating (review: minimum_role was not enforced there). Guard it the same
   way dgc guards the plain read/send routes. */
add_filter( 'rest_request_before_callbacks', function ( $result, $server, $request ) {
	if ( '/sml/v1/group/channel/stream' !== $request->get_route() || is_wp_error( $result ) ) {
		return $result;
	}
	if ( function_exists( 'sml_dgc_can_view_channel' ) && ! sml_dgc_can_view_channel( absint( $request->get_param( 'channel_id' ) ) ) ) {
		return new WP_Error( 'sml_dgc_channel_forbidden', 'Your synced Discord role does not allow access to this channel.', array( 'status' => 403 ) );
	}
	return $result;
}, 20, 3 );

/** Minimal Discord REST GET with 429-aware backoff persisted across runs. */
function sml_dgc_relay_discord_get( $path ) {
	$hold = (int) get_option( 'sml_dgc_relay_backoff', 0 );
	if ( $hold > time() ) {
		return new WP_Error( 'sml_dgc_relay_backoff', 'Holding off after a Discord rate limit.' );
	}
	$token = trim( (string) get_option( 'sml_dgc_relay_bot_token', '' ) );
	$res   = wp_remote_get( 'https://discord.com/api/v10' . $path, array(
		'timeout' => 15,
		'headers' => array(
			'Authorization' => 'Bot ' . $token,
			'User-Agent'    => 'StockMarketLoopRelay (https://stockmarketloop.com, ' . SML_DGC_RELAY_VERSION . ')',
		),
	) );
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = (int) wp_remote_retrieve_response_code( $res );
	$body = json_decode( (string) wp_remote_retrieve_body( $res ), true );
	if ( 429 === $code ) {
		$retry = is_array( $body ) && isset( $body['retry_after'] ) ? (float) $body['retry_after'] : 30;
		update_option( 'sml_dgc_relay_backoff', time() + max( 5, (int) ceil( $retry ) ), false );
		return new WP_Error( 'sml_dgc_relay_429', 'Discord rate limited the relay.' );
	}
	if ( $code >= 400 ) {
		return new WP_Error( 'sml_dgc_relay_http', 'Discord answered HTTP ' . $code . ' for ' . $path, array( 'status' => $code ) );
	}
	return is_array( $body ) ? $body : array();
}

function sml_dgc_relay_snowflake_lt( $a, $b ) {
	$a = (string) $a; $b = (string) $b;
	if ( strlen( $a ) !== strlen( $b ) ) {
		return strlen( $a ) < strlen( $b );
	}
	return strcmp( $a, $b ) < 0;
}

/** A snowflake for "right now" — the baseline when a channel shows no history
 *  (empty channel and missing READ_MESSAGE_HISTORY look identical; both must
 *  baseline at NOW so history can never flood in later). */
function sml_dgc_relay_now_snowflake() {
	return (string) ( ( (int) floor( microtime( true ) * 1000 ) - 1420070400000 ) << 22 );
}

/** Attacker-text neutralizer: em/en dashes become plain hyphens everywhere in
 *  relayed author names, guild names and content, so the relay's own em-dash
 *  attribution line ("Name — from X Discord") cannot be forged by body text;
 *  Discord-side pings can never read as site-wide pings. */
function sml_dgc_relay_neutral( $text ) {
	$text = str_replace( array( "\xE2\x80\x94", "\xE2\x80\x93" ), '-', (string) $text );
	$text = preg_replace( '/@(everyone|here)/i', '@\'$1', $text );
	return $text;
}

/** Author display names that would read as the site itself get demoted. */
function sml_dgc_relay_author_label( $message ) {
	$author = sanitize_text_field( sml_dgc_relay_neutral( (string) ( $message['author']['global_name'] ?? $message['author']['username'] ?? 'member' ) ) );
	$author = trim( preg_replace( '/\s+/', ' ', $author ) );
	if ( function_exists( 'mb_substr' ) ) {
		$author = mb_substr( $author, 0, 48 );
	} else {
		$author = substr( $author, 0, 48 );
	}
	$aid        = preg_replace( '/\D+/', '', (string) ( $message['author']['id'] ?? '' ) );
	$normalized = strtolower( preg_replace( '/[^a-z0-9]+/i', '', $author ) );
	$reserved   = apply_filters( 'sml_dgc_relay_reserved_names', array( 'discord', 'ben', 'grandmasterobi', 'smlnews', 'stockmarketloop', 'sml', 'admin', 'moderator', 'smlanalyst', 'makingeasymoney' ) );
	if ( '' === $author || in_array( $normalized, $reserved, true ) ) {
		$author = 'member ' . substr( $aid ?: '0000', -4 );
	}
	return $author;
}

function sml_dgc_relay_guild_label( $catalog ) {
	$name = is_array( $catalog ) ? sanitize_text_field( sml_dgc_relay_neutral( (string) ( $catalog['guild_name'] ?? '' ) ) ) : '';
	$name = trim( preg_replace( '/\s+/', ' ', $name ) );
	if ( function_exists( 'mb_substr' ) ) {
		$name = mb_substr( $name, 0, 64 );
	} else {
		$name = substr( $name, 0, 64 );
	}
	if ( '' !== $name && preg_match( '/stock\s*market\s*loop|official\s*sml|sml\s*official/i', $name ) ) {
		$name = ''; // a guild may not dress up as the site itself
	}
	return $name;
}

/**
 * Turn a raw Discord message into site-safe chat text. Mentions/channels/roles
 * resolve to readable names; custom emoji collapse to :name:; URLs from
 * third-party servers are reduced to "[link: host]" unless the host is
 * allowlisted — relayed rows skip the normal send-path moderation, so links
 * do not get to ride along as clickable phishing bait.
 */
function sml_dgc_relay_clean_content( $message, $catalog ) {
	$text = sml_dgc_relay_neutral( (string) ( $message['content'] ?? '' ) );
	$mention_names = array();
	foreach ( (array) ( $message['mentions'] ?? array() ) as $m ) {
		$mid = preg_replace( '/\D+/', '', (string) ( $m['id'] ?? '' ) );
		if ( $mid ) {
			$mention_names[ $mid ] = sml_dgc_relay_neutral( (string) ( $m['global_name'] ?? $m['username'] ?? 'member' ) );
		}
	}
	$channel_names = array();
	$role_names    = array();
	if ( is_array( $catalog ) ) {
		foreach ( (array) ( $catalog['channels'] ?? array() ) as $c ) {
			$channel_names[ (string) ( $c['id'] ?? '' ) ] = (string) ( $c['name'] ?? 'channel' );
		}
		foreach ( (array) ( $catalog['roles'] ?? array() ) as $r ) {
			$role_names[ (string) ( $r['id'] ?? '' ) ] = (string) ( $r['name'] ?? 'role' );
		}
	}
	$text = preg_replace_callback( '/<@!?(\d+)>/', function ( $m ) use ( $mention_names ) {
		return '@' . ( $mention_names[ $m[1] ] ?? 'member' );
	}, $text );
	$text = preg_replace_callback( '/<#(\d+)>/', function ( $m ) use ( $channel_names ) {
		return '#' . ( $channel_names[ $m[1] ] ?? 'channel' );
	}, $text );
	$text = preg_replace_callback( '/<@&(\d+)>/', function ( $m ) use ( $role_names ) {
		return '@' . ( $role_names[ $m[1] ] ?? 'role' );
	}, $text );
	$text = preg_replace( '/<a?(:[a-zA-Z0-9_]+:)\d+>/', '$1', $text );
	$allowed_hosts = apply_filters( 'sml_dgc_relay_allowed_link_hosts', array( 'stockmarketloop.com' ) );
	$text = preg_replace_callback( '#https?://[^\s<>"\']+#i', function ( $m ) use ( $allowed_hosts ) {
		$host = strtolower( (string) wp_parse_url( $m[0], PHP_URL_HOST ) );
		foreach ( $allowed_hosts as $allowed ) {
			$suffix = '.' . $allowed;
			if ( $host === $allowed || substr( $host, -strlen( $suffix ) ) === $suffix ) {
				return $m[0];
			}
		}
		return '[link: ' . ( $host ?: 'unknown' ) . ']';
	}, $text );
	$text = trim( preg_replace( '/\n{3,}/', "\n\n", $text ) );
	if ( function_exists( 'mb_substr' ) ) {
		$text = mb_substr( $text, 0, 1800 );
	} else {
		$text = substr( $text, 0, 1800 );
	}
	return $text;
}

/** Sideload the first image attachment into the media library — the signed
 *  Discord CDN URL expires within a day, so storing it would strand broken
 *  images in channel history. Non-image or oversized attachments relay as text. */
function sml_dgc_relay_media_url( $message, &$sideload_budget ) {
	foreach ( (array) ( $message['attachments'] ?? array() ) as $attachment ) {
		$url  = (string) ( $attachment['url'] ?? '' );
		$mime = (string) ( $attachment['content_type'] ?? '' );
		$size = (int) ( $attachment['size'] ?? 0 );
		if ( ! preg_match( '#^https://(cdn|media)\.discordapp\.(com|net)/#', $url ) ) {
			continue;
		}
		if ( 0 !== strpos( $mime, 'image/' ) || $size < 1 || $size > 4 * 1024 * 1024 || $sideload_budget < 1 ) {
			return array( '', true ); // attachment existed but is not relayable inline
		}
		$sideload_budget--;
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$local = media_sideload_image( esc_url_raw( $url ), 0, null, 'src' );
		return array( is_wp_error( $local ) ? '' : esc_url_raw( (string) $local ), true );
	}
	return array( '', false );
}

/** Poll mapped channels of active connectors, round-robin so no map starves. */
function sml_dgc_relay_poll() {
	global $wpdb;
	if ( ! sml_dgc_relay_enabled() || ! function_exists( 'sml_dgc_tables' ) ) {
		return;
	}
	/* one runner at a time; the lock value is a unique run token so takeover and
	   release are compare-and-swap — a slow run can never free a successor's lock */
	$token = time() . ':' . wp_generate_uuid4();
	$wpdb->query( $wpdb->prepare(
		"INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'no')",
		'sml_dgc_relay_lock', $token
	) );
	if ( ! $wpdb->rows_affected ) {
		$held = (string) $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", 'sml_dgc_relay_lock' ) );
		if ( (int) $held > time() - 600 ) {
			return; // an earlier run is still inside its healthy window
		}
		$took = $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s", $token, 'sml_dgc_relay_lock', $held ) );
		if ( 1 !== (int) $took ) {
			return; // lost the takeover race
		}
	}
	wp_cache_delete( 'sml_dgc_relay_lock', 'options' );

	try {
		return sml_dgc_relay_poll_locked();
	} finally {
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s", 'sml_dgc_relay_lock', $token ) );
		wp_cache_delete( 'sml_dgc_relay_lock', 'options' );
	}
}
add_action( 'sml_dgc_relay_tick', 'sml_dgc_relay_poll' );

function sml_dgc_relay_poll_locked() {
	global $wpdb;
	$t        = sml_dgc_tables();
	$log      = sml_dgc_relay_log_table();
	$started  = time();
	$status   = array( 'last_run' => gmdate( DATE_ATOM ), 'channels' => array() );
	$cursors  = get_option( 'sml_dgc_relay_cursors', array() );
	$cursors  = is_array( $cursors ) ? $cursors : array();
	$relay_id = sml_dgc_relay_user_id();
	if ( ! $relay_id ) {
		return;
	}
	$paused_guilds   = array_map( 'strval', (array) get_option( 'sml_dgc_relay_disabled_guilds', array() ) );
	$blocked_authors = array_flip( array_map( 'strval', (array) get_option( 'sml_dgc_relay_blocked_authors', array() ) ) );
	$quota           = get_option( 'sml_dgc_relay_quota', array() );
	$today           = gmdate( 'Ymd' );
	$quota           = array( $today => (array) ( is_array( $quota ) ? ( $quota[ $today ] ?? array() ) : array() ) );
	$per_channel_day = (int) apply_filters( 'sml_dgc_relay_channel_daily_quota', 1000 );

	/* round-robin over maps so LIMIT can never starve later rows (review) */
	$rr       = absint( get_option( 'sml_dgc_relay_rr', 0 ) );
	$map_sql  = "SELECT m.id map_id, c.guild_id, m.group_id, m.discord_channel_id, m.website_channel_id,
		 m.author_mode,m.author_user_id,m.persona_user_id,m.persona_name,m.persona_description,m.persona_avatar_url,m.allow_automated
		 FROM {$t['channel_maps']} m
		 INNER JOIN {$t['connectors']} c ON c.group_id = m.group_id AND c.state = 'active'
		 INNER JOIN {$t['channels']} sc ON sc.id = m.website_channel_id" . ( get_option( 'sml_dgc_out_db_version' ) ? " AND m.direction <> 'out'" : '' );
	$only = isset( $GLOBALS['sml_dgc_relay_only'] ) ? preg_replace( '/\D+/', '', (string) $GLOBALS['sml_dgc_relay_only'] ) : '';
	if ( '' !== $only ) {
		$maps = $wpdb->get_results( $wpdb->prepare( $map_sql . ' WHERE m.discord_channel_id = %s ORDER BY m.id ASC LIMIT 10', $only ), ARRAY_A );
	} else {
		$maps = $wpdb->get_results( $wpdb->prepare( $map_sql . ' WHERE m.id > %d ORDER BY m.id ASC LIMIT 40', $rr ), ARRAY_A );
	}
	if ( '' === $only && count( $maps ) < 40 ) {
		$maps = array_merge( $maps, $wpdb->get_results( $wpdb->prepare( $map_sql . ' WHERE m.id <= %d ORDER BY m.id ASC LIMIT %d', $rr, 40 - count( $maps ) ), ARRAY_A ) );
	}

	$imported_total  = 0;
	$sideload_budget = 4;
	foreach ( (array) $maps as $map ) {
		if ( time() - $started > 40 || $imported_total >= 150 ) {
			$status['stopped'] = $imported_total >= 150 ? 'insert_budget' : 'time_budget';
			break;
		}
		if ( '' === $only ) { update_option( 'sml_dgc_relay_rr', absint( $map['map_id'] ), false ); }
		$guild_id   = preg_replace( '/\D+/', '', (string) $map['guild_id'] );
		$channel_id = preg_replace( '/\D+/', '', (string) $map['discord_channel_id'] );
		$site_ch    = absint( $map['website_channel_id'] );
		$group_id   = absint( $map['group_id'] );
		$identity   = sml_dgc_relay_identity_for_map( $map );
		$post_user  = absint( $identity['user_id'] ?? 0 );
		if ( '' === $channel_id || ! $site_ch || ! $group_id ) {
			continue;
		}
		if ( ! $post_user ) {
			$status['channels'][ $guild_id . ':' . $channel_id ] = array( 'status' => 'identity_unavailable' );
			continue;
		}
		$key = $guild_id . ':' . $channel_id;
		if ( in_array( $guild_id, $paused_guilds, true ) ) {
			$status['channels'][ $key ] = array( 'status' => 'guild_paused' );
			continue;
		}
		$cursor = preg_replace( '/\D+/', '', (string) ( $cursors[ $key ] ?? '' ) );

		if ( '' === $cursor ) {
			/* first sight of this map: baseline to NOW, import nothing — the network
			   relays what happens AFTER a channel is shared, never history. An empty
			   answer (empty channel, or missing read-history permission — Discord
			   returns 200 [] for both) baselines to a now-snowflake for the same reason. */
			$latest = sml_dgc_relay_discord_get( '/channels/' . $channel_id . '/messages?limit=1' );
			if ( is_wp_error( $latest ) ) {
				$status['channels'][ $key ] = array( 'status' => 'baseline_failed', 'error' => $latest->get_error_message() );
				continue;
			}
			$cursors[ $key ] = preg_replace( '/\D+/', '', (string) ( $latest[0]['id'] ?? '' ) ) ?: sml_dgc_relay_now_snowflake();
			update_option( 'sml_dgc_relay_cursors', $cursors, false );
			$status['channels'][ $key ] = array( 'status' => 'baselined', 'cursor' => $cursors[ $key ] );
			continue;
		}

		$messages = sml_dgc_relay_discord_get( '/channels/' . $channel_id . '/messages?limit=50&after=' . rawurlencode( $cursor ) );
		if ( is_wp_error( $messages ) ) {
			$status['channels'][ $key ] = array( 'status' => 'poll_failed', 'error' => $messages->get_error_message() );
			if ( in_array( $messages->get_error_code(), array( 'sml_dgc_relay_backoff', 'sml_dgc_relay_429' ), true ) ) {
				break; // whole-run hold-off
			}
			continue; // 401/403/404 etc: keep the cursor, the owner can re-sync later
		}
		if ( ! $messages ) {
			$status['channels'][ $key ] = array( 'status' => 'quiet', 'cursor' => $cursor );
			continue;
		}
		usort( $messages, function ( $a, $b ) {
			$ai = (string) ( $a['id'] ?? '' ); $bi = (string) ( $b['id'] ?? '' );
			if ( $ai === $bi ) { return 0; }
			return sml_dgc_relay_snowflake_lt( $ai, $bi ) ? -1 : 1;
		} );
		$catalog    = function_exists( 'sml_dgc_catalog' ) ? sml_dgc_catalog( $guild_id ) : null;
		$guild_name = sml_dgc_relay_guild_label( $catalog );
		$used_today = (int) ( $quota[ $today ][ $key ] ?? 0 );
		$imported   = 0;
		foreach ( $messages as $message ) {
			$mid = preg_replace( '/\D+/', '', (string) ( $message['id'] ?? '' ) );
			if ( '' === $mid ) {
				continue;
			}
			$cursors[ $key ] = $mid;
			$is_automated = ! empty( $message['author']['bot'] ) || ! empty( $message['webhook_id'] );
			if ( $is_automated && empty( $map['allow_automated'] ) ) {
				continue;
			}
			$aid = preg_replace( '/\D+/', '', (string) ( $message['author']['id'] ?? '' ) );
			if ( isset( $blocked_authors[ $aid ] ) ) {
				continue;
			}
			$type = absint( $message['type'] ?? 0 );
			if ( ! in_array( $type, array( 0, 19 ), true ) ) {
				continue; // only ordinary messages and replies; no joins/pins/boost notices
			}
			if ( $used_today >= $per_channel_day ) {
				/* over quota: keep advancing the cursor so a spam backlog drains
				   into nowhere instead of trickling onto the site for hours */
				$status['channels'][ $key ]['quota'] = 'paused_quota';
				continue;
			}
			if ( $imported_total >= 150 ) {
				/* insert budget exhausted mid-channel: do NOT advance past this
				   message — rewind the cursor so the next run resumes here */
				$cursors[ $key ] = (string) ( (int) $mid - 1 );
				break;
			}
			/* durable idempotency: claim the Discord message id in the relay log
			   FIRST (UNIQUE key) — survives option rollbacks and cron overlap */
			$wpdb->query( $wpdb->prepare(
				"INSERT IGNORE INTO {$log} (discord_message_id, guild_id, discord_channel_id, discord_author_id, map_id, identity_mode, site_user_id, source_is_automated, created_at) VALUES (%s, %s, %s, %s, %d, %s, %d, %d, %s)",
				$mid, $guild_id, $channel_id, $aid, absint( $map['map_id'] ), (string) $identity['mode'], $post_user, $is_automated ? 1 : 0, current_time( 'mysql', true )
			) );
			if ( ! $wpdb->rows_affected ) {
				continue; // already imported by an earlier run
			}
			$content = sml_dgc_relay_clean_content( $message, $catalog );
			list( $media, $had_attachment ) = sml_dgc_relay_media_url( $message, $sideload_budget );
			if ( '' === $content && '' === $media && $had_attachment ) {
				$content = '[shared an attachment on Discord]';
			}
			if ( '' === $content && '' === $media ) {
				continue; // nothing relayable (claim row stays: nothing to import later either)
			}
			$author = sml_dgc_relay_author_label( $message );
			$body   = 'relay' === $identity['mode']
				? trim( $author . ' — from ' . ( $guild_name ?: 'a connected' ) . ' Discord' . "\n" . $content )
				: trim( $content );
			$body   = sanitize_textarea_field( $body );
			$body   = apply_filters( 'sml_dgc_relay_message_body', $body, $message, $map );
			if ( '' === (string) $body && '' === $media ) {
				$wpdb->delete( $log, array( 'discord_message_id' => $mid ) );
				continue; // vetoed by moderation filter
			}
			$tags = function_exists( 'sml_groups_extract_tickers' ) ? sml_groups_extract_tickers( (string) $body ) : array();
			$done = $wpdb->insert(
				$wpdb->prefix . 'sml_group_channel_messages',
				array(
					'channel_id'  => $site_ch,
					'group_id'    => $group_id,
					'user_id'     => $post_user,
					'message'     => (string) $body,
					'ticker_tags' => wp_json_encode( $tags ),
					'reactions'   => wp_json_encode( array() ),
					'media_url'   => $media,
					'pinned'      => 0,
					'created_at'  => current_time( 'mysql' ),
				),
				array( '%d', '%d', '%d', '%s', '%s', '%s', '%s', '%d', '%s' )
			);
			if ( $done ) {
				$wpdb->update( $log, array( 'site_message_id' => (int) $wpdb->insert_id ), array( 'discord_message_id' => $mid ) );
				$imported++;
				$imported_total++;
				$used_today++;
			} else {
				/* chat insert failed: release the claim so the next run retries */
				$wpdb->delete( $log, array( 'discord_message_id' => $mid ) );
			}
		}
		$quota[ $today ][ $key ] = $used_today;
		$status['channels'][ $key ] = array_merge( (array) ( $status['channels'][ $key ] ?? array() ), array( 'status' => 'ok', 'fetched' => count( $messages ), 'imported' => $imported, 'cursor' => $cursors[ $key ] ) );
		/* persist per channel so a mid-run failure never replays a processed channel */
		update_option( 'sml_dgc_relay_cursors', $cursors, false );
	}
	update_option( 'sml_dgc_relay_cursors', $cursors, false );
	update_option( 'sml_dgc_relay_quota', $quota, false );
	$status['imported'] = $imported_total;
	if ( '' !== $only ) { // a nudge updates its own channel in the status, not the whole picture
		$prev = get_option( 'sml_dgc_relay_status', array() );
		$prev = is_array( $prev ) ? $prev : array();
		$prev['channels'] = array_merge( (array) ( $prev['channels'] ?? array() ), $status['channels'] );
		$prev['last_nudge'] = gmdate( DATE_ATOM );
		$status = $prev;
	}
	update_option( 'sml_dgc_relay_status', $status, false );
	return $imported_total;
}
