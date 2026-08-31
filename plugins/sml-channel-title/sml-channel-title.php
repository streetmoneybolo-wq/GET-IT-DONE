<?php
/**
 * Plugin Name: SML Channel Title
 * Description: Per-channel custom TITLE overlay for group channels (/groups/{slug}/). Owner, admin, or analyst can set a custom title image (e.g. a design exported from Canva) that renders over the channel banner — matching the "WOLFPACK_PORTFOLIO" glowing-title look. Ships the storage + a properly gated REST API; the render + ⋮-menu setter live in js/group-categories.js. Additive + reversible.
 * Version: 1.0.0
 * Author: StockMarketLoop
 *
 * Context: SML/ memory group-header-timer + group-channel-categories. The channel
 * banner (.sml-gshell__header-banner) has no manager-settable image in the Group
 * Shell v11 plugin — only the center watermark (Channel Background) is settable.
 * This plugin adds a per-channel title-image slot, gated with the SAME owner/admin
 * model the groups engine uses (mirrored from the Discord connector's
 * sml_dgc_can_manage), widened to also allow ANALYST per the product ask.
 * Intake is an uploaded image file only (no server-side URL fetch — that would be
 * an SSRF/DoS surface); managers export their design from Canva and upload it.
 *
 * Data model (owned by the Group Shell engine, read-only here):
 *   {prefix}sml_groups          : id, owner_id
 *   {prefix}sml_group_members   : group_id, user_id, role (member|premium|analyst|mod|admin)
 *   {prefix}sml_group_channels  : id, group_id, name
 * Our own store:
 *   {prefix}sml_channel_titles  : channel_id (PK), group_id, image_url, attachment_id, updated_by, updated_at
 *
 * Kill switch: deactivate this plugin (titles simply stop rendering; rows are kept).
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! defined( 'SML_CTITLE_VERSION' ) ) {
	define( 'SML_CTITLE_VERSION', '1.0.0' );
	define( 'SML_CTITLE_MAX_BYTES', 6 * 1024 * 1024 ); // 6MB ceiling for a title graphic.

	/* ------------------------------------------------------------------ *
	 * Storage
	 * ------------------------------------------------------------------ */

	function sml_ctitle_table() {
		global $wpdb;
		return $wpdb->prefix . 'sml_channel_titles';
	}

	function sml_ctitle_install() {
		if ( get_option( 'sml_ctitle_version' ) === SML_CTITLE_VERSION ) {
			return;
		}
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$t       = sml_ctitle_table();
		$charset = $wpdb->get_charset_collate();
		dbDelta( "CREATE TABLE {$t} (
			channel_id BIGINT UNSIGNED NOT NULL,
			group_id BIGINT UNSIGNED NOT NULL,
			image_url TEXT NULL,
			attachment_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
			updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
			updated_at DATETIME NOT NULL,
			PRIMARY KEY (channel_id),
			KEY group_id (group_id)
		) $charset;" );
		update_option( 'sml_ctitle_version', SML_CTITLE_VERSION, false );
	}
	add_action( 'init', 'sml_ctitle_install', 1 );

	function sml_ctitle_now() {
		return current_time( 'mysql', true );
	}

	/* ------------------------------------------------------------------ *
	 * Group data model (read-only mirror of the groups engine)
	 * ------------------------------------------------------------------ */

	function sml_ctitle_groups_table()   { global $wpdb; return $wpdb->prefix . 'sml_groups'; }
	function sml_ctitle_members_table()  { global $wpdb; return $wpdb->prefix . 'sml_group_members'; }
	function sml_ctitle_channels_table() { global $wpdb; return $wpdb->prefix . 'sml_group_channels'; }

	/**
	 * Owner, admin, OR analyst of the group may manage its channel titles.
	 * Mirrors the engine's own permission model (sml_dgc_can_manage in the Discord
	 * connector), then widens it to include 'analyst' per the product requirement.
	 * Site admins (manage_options) always pass.
	 */
	function sml_ctitle_can_manage( $group_id, $user_id = 0 ) {
		global $wpdb;
		$group_id = absint( $group_id );
		$user_id  = $user_id ? absint( $user_id ) : get_current_user_id();
		if ( ! $group_id || ! $user_id ) {
			return false;
		}
		if ( user_can( $user_id, 'manage_options' ) ) {
			return true;
		}
		// Engine's canonical owner/admin check, when the groups plugin exposes it.
		if ( function_exists( 'sml_groups_current_user_can_manage' )
			&& sml_groups_current_user_can_manage( $group_id, $user_id ) ) {
			return true;
		}
		// Fallback: direct owner, or a member row with a managing role (incl. analyst).
		$owner = (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT owner_id FROM " . sml_ctitle_groups_table() . " WHERE id=%d", $group_id ) );
		if ( $owner === $user_id ) {
			return true;
		}
		$role = (string) $wpdb->get_var( $wpdb->prepare(
			"SELECT role FROM " . sml_ctitle_members_table() . " WHERE group_id=%d AND user_id=%d",
			$group_id, $user_id ) );
		return in_array( $role, array( 'owner', 'admin', 'analyst' ), true );
	}

	/** True only when the channel genuinely belongs to the group. */
	function sml_ctitle_channel_in_group( $channel_id, $group_id ) {
		global $wpdb;
		$channel_id = absint( $channel_id );
		$found      = (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT id FROM " . sml_ctitle_channels_table() . " WHERE id=%d AND group_id=%d",
			$channel_id, absint( $group_id ) ) );
		return $found === $channel_id && $channel_id > 0;
	}

	/** Map of channel_id => title image URL for one group (only rows with an image). */
	function sml_ctitle_get_map( $group_id ) {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT channel_id, image_url FROM " . sml_ctitle_table() . " WHERE group_id=%d",
			absint( $group_id ) ), ARRAY_A ) ?: array();
		$map = array();
		foreach ( $rows as $r ) {
			if ( ! empty( $r['image_url'] ) ) {
				$map[ (string) $r['channel_id'] ] = esc_url_raw( $r['image_url'] );
			}
		}
		return $map;
	}

	function sml_ctitle_store( $channel_id, $group_id, $url, $attachment_id ) {
		global $wpdb;
		$t          = sml_ctitle_table();
		$channel_id = absint( $channel_id );
		$old_att    = (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT attachment_id FROM {$t} WHERE channel_id=%d", $channel_id ) );
		$data = array(
			'group_id'      => absint( $group_id ),
			'image_url'     => esc_url_raw( $url ),
			'attachment_id' => absint( $attachment_id ),
			'updated_by'    => get_current_user_id(),
			'updated_at'    => sml_ctitle_now(),
		);
		$exists = (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT channel_id FROM {$t} WHERE channel_id=%d", $channel_id ) );
		if ( $exists ) {
			$wpdb->update( $t, $data, array( 'channel_id' => $channel_id ), null, array( '%d' ) );
		} else {
			$data['channel_id'] = $channel_id;
			$wpdb->insert( $t, $data );
		}
		// Reap the previous attachment when it was replaced by a new one.
		if ( $old_att && $old_att !== absint( $attachment_id ) ) {
			wp_delete_attachment( $old_att, true );
		}
	}

	/* ------------------------------------------------------------------ *
	 * Media intake (upload OR https URL sideload) — gated callers only.
	 * ------------------------------------------------------------------ */

	function sml_ctitle_allowed_mimes() {
		return array(
			'png'  => 'image/png',
			'jpg'  => 'image/jpeg',
			'jpeg' => 'image/jpeg',
			'webp' => 'image/webp',
			'gif'  => 'image/gif',
		);
	}

	function sml_ctitle_sniff_mime( $path ) {
		if ( function_exists( 'finfo_open' ) ) {
			$fi = finfo_open( FILEINFO_MIME_TYPE );
			if ( $fi ) {
				$m = finfo_file( $fi, $path );
				finfo_close( $fi );
				return (string) $m;
			}
		}
		if ( function_exists( 'mime_content_type' ) ) {
			return (string) mime_content_type( $path );
		}
		$info = @getimagesize( $path );
		return $info && ! empty( $info['mime'] ) ? (string) $info['mime'] : '';
	}

	/**
	 * Resolve the request's UPLOADED image into a WP attachment. Returns
	 * [attachment_id, url] or a WP_Error. Trusts NOTHING from the client for the
	 * mime — sniffs the real bytes.
	 *
	 * Multipart file upload ONLY. We deliberately do NOT fetch a client-supplied
	 * URL server-side: that path (download_url on arbitrary input) is an SSRF /
	 * blind-oracle + unbounded-download DoS surface, and the size ceiling could
	 * only be checked after the whole body was already on disk. A future Canva
	 * Connect flow will sideload from an ALLOWLISTED Canva export host inside the
	 * OAuth exchange — never from free-form request input.
	 */
	function sml_ctitle_ingest( WP_REST_Request $request, $group_id, $channel_id ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$allowed = array_values( sml_ctitle_allowed_mimes() );
		$files   = $request->get_file_params();
		if ( empty( $files['file'] ) || ! empty( $files['file']['error'] ) ) {
			return new WP_Error( 'sml_ctitle_no_image', 'Upload a PNG, JPG, WEBP, or GIF image file.', array( 'status' => 400 ) );
		}
		$f = $files['file'];
		if ( (int) $f['size'] > SML_CTITLE_MAX_BYTES ) {
			return new WP_Error( 'sml_ctitle_too_big', 'Title image must be 6MB or smaller.', array( 'status' => 400 ) );
		}
		$mime = sml_ctitle_sniff_mime( $f['tmp_name'] );
		if ( ! in_array( $mime, $allowed, true ) ) {
			return new WP_Error( 'sml_ctitle_bad_type', 'Use a PNG, JPG, WEBP, or GIF image.', array( 'status' => 400 ) );
		}
		$moved = wp_handle_upload( $f, array( 'test_form' => false, 'mimes' => sml_ctitle_allowed_mimes() ) );
		if ( isset( $moved['error'] ) ) {
			return new WP_Error( 'sml_ctitle_upload_failed', (string) $moved['error'], array( 'status' => 400 ) );
		}
		$att = wp_insert_attachment( array(
			'post_mime_type' => $moved['type'],
			'post_title'     => sanitize_file_name( 'channel-title-' . $group_id . '-' . $channel_id ),
			'post_content'   => '',
			'post_status'    => 'inherit',
		), $moved['file'] );
		if ( is_wp_error( $att ) || ! $att ) {
			@unlink( $moved['file'] ); // no attachment row was created — don't leave an orphan file
			return new WP_Error( 'sml_ctitle_attach_failed', 'Could not store the image.', array( 'status' => 400 ) );
		}
		wp_update_attachment_metadata( $att, wp_generate_attachment_metadata( $att, $moved['file'] ) );
		return array( (int) $att, (string) $moved['url'] );
	}

	/* ------------------------------------------------------------------ *
	 * REST API — sml-ctitle/v1
	 * ------------------------------------------------------------------ */

	function sml_ctitle_register_routes() {
		register_rest_route( 'sml-ctitle/v1', '/titles', array(
			'methods'             => 'GET',
			'callback'            => 'sml_ctitle_rest_get',
			'permission_callback' => '__return_true',
			'args'                => array( 'group_id' => array( 'required' => true ) ),
		) );
		register_rest_route( 'sml-ctitle/v1', '/title', array(
			array( 'methods' => 'POST',   'callback' => 'sml_ctitle_rest_set',    'permission_callback' => 'is_user_logged_in' ),
			array( 'methods' => 'DELETE', 'callback' => 'sml_ctitle_rest_delete', 'permission_callback' => 'is_user_logged_in' ),
		) );
	}
	add_action( 'rest_api_init', 'sml_ctitle_register_routes' );

	function sml_ctitle_rest_get( WP_REST_Request $request ) {
		$group_id = absint( $request['group_id'] );
		if ( ! $group_id ) {
			return new WP_Error( 'sml_ctitle_bad', 'group_id is required.', array( 'status' => 400 ) );
		}
		$payload = array( 'titles' => sml_ctitle_get_map( $group_id ) );
		$response = rest_ensure_response( $payload );
		if ( is_user_logged_in() ) {
			$payload['can_manage'] = sml_ctitle_can_manage( $group_id );
			$response = rest_ensure_response( $payload );
			$response->header( 'Cache-Control', 'private, no-cache' );
		} else {
			// Anonymous render can be cached briefly at the edge.
			$response->header( 'Cache-Control', 'public, max-age=60' );
		}
		return $response;
	}

	function sml_ctitle_rest_set( WP_REST_Request $request ) {
		$group_id   = absint( $request->get_param( 'group_id' ) );
		$channel_id = absint( $request->get_param( 'channel_id' ) );
		if ( ! $group_id || ! $channel_id ) {
			return new WP_Error( 'sml_ctitle_bad', 'group_id and channel_id are required.', array( 'status' => 400 ) );
		}
		if ( ! sml_ctitle_can_manage( $group_id ) ) {
			return new WP_Error( 'sml_ctitle_forbidden', 'Only this group’s owner, admin, or analyst can set a channel title.', array( 'status' => 403 ) );
		}
		if ( ! sml_ctitle_channel_in_group( $channel_id, $group_id ) ) {
			return new WP_Error( 'sml_ctitle_bad_channel', 'That channel is not part of this group.', array( 'status' => 400 ) );
		}
		$result = sml_ctitle_ingest( $request, $group_id, $channel_id );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		list( $attachment_id, $url ) = $result;
		if ( ! $url ) {
			return new WP_Error( 'sml_ctitle_no_url', 'Stored image had no URL.', array( 'status' => 500 ) );
		}
		sml_ctitle_store( $channel_id, $group_id, $url, $attachment_id );
		return rest_ensure_response( array( 'ok' => true, 'channel_id' => $channel_id, 'url' => esc_url_raw( $url ) ) );
	}

	function sml_ctitle_rest_delete( WP_REST_Request $request ) {
		global $wpdb;
		$group_id   = absint( $request->get_param( 'group_id' ) );
		$channel_id = absint( $request->get_param( 'channel_id' ) );
		if ( ! $group_id || ! $channel_id ) {
			return new WP_Error( 'sml_ctitle_bad', 'group_id and channel_id are required.', array( 'status' => 400 ) );
		}
		if ( ! sml_ctitle_can_manage( $group_id ) ) {
			return new WP_Error( 'sml_ctitle_forbidden', 'Only this group’s owner, admin, or analyst can remove a channel title.', array( 'status' => 403 ) );
		}
		$t   = sml_ctitle_table();
		$att = (int) $wpdb->get_var( $wpdb->prepare(
			"SELECT attachment_id FROM {$t} WHERE channel_id=%d AND group_id=%d", $channel_id, $group_id ) );
		$wpdb->delete( $t, array( 'channel_id' => $channel_id, 'group_id' => $group_id ), array( '%d', '%d' ) );
		if ( $att ) {
			wp_delete_attachment( $att, true );
		}
		return rest_ensure_response( array( 'ok' => true, 'channel_id' => $channel_id ) );
	}

	/* ------------------------------------------------------------------ *
	 * Front-end config — expose the API base + a REST nonce on group pages.
	 * The render + ⋮-menu setter live in js/group-categories.js and read this.
	 * ------------------------------------------------------------------ */

	function sml_ctitle_footer_config() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return;
		}
		$path = wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '', PHP_URL_PATH );
		if ( ! preg_match( '#^/groups/[^/]+/?$#i', (string) $path ) ) {
			return;
		}
		$cfg = array(
			'api'   => esc_url_raw( rest_url( 'sml-ctitle/v1/' ) ),
			'nonce' => is_user_logged_in() ? wp_create_nonce( 'wp_rest' ) : '',
		);
		echo '<script id="sml-ctitle-config">window.SMLChannelTitle=Object.assign(window.SMLChannelTitle||{},' . wp_json_encode( $cfg ) . ');</script>' . "\n";
	}
	add_action( 'wp_footer', 'sml_ctitle_footer_config', 5 );
}
