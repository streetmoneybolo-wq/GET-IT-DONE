<?php
/**
 * Plugin Name: SML Channel Emotes
 * Description: Custom emotes for Loop channels. A creator uploads up to 25 (limit is one function, so pricing can hook it later); only the creator and Premium members of that channel can use them in the channel's live chat.
 * Version: 1.0.0
 *
 * REST /wp-json/sml-emotes/v1/
 *   GET    /list/{handle}   public: the channel's emotes + whether the current viewer may use them + where to join Premium
 *   GET    /mine            creator: own emotes, used / limit
 *   POST   /upload          creator: multipart file + name -> one emote (png/gif/webp, <=512 KB, <=512 px)
 *   DELETE /{id}            creator: remove one
 *
 * "Premium member of the channel" = member of a PAID group owned by that creator (same rule the group system uses for Premium), or the creator.
 * Enforcement is at SEND: a message in that creator's live chat containing :name: for one of their emotes keeps the token only when the sender may use it;
 * otherwise the colons are removed ("pog") so nothing renders for a non-Premium sender. Filters: sml_channel_emote_limit, sml_channel_emote_can_use.
 * ROLLBACK: delete this file. The table and uploaded images stay; chat tokens then simply show as text.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

const SML_CE_DB      = 1;
const SML_CE_DEFAULT = 25;
const SML_CE_MAX_KB  = 512;
const SML_CE_MAX_PX  = 512;

function sml_ce_t() { global $wpdb; return $wpdb->prefix . 'sml_channel_emotes'; }

function sml_ce_install() {
	if ( (int) get_option( 'sml_ce_db', 0 ) >= SML_CE_DB ) { return; }
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta( 'CREATE TABLE ' . sml_ce_t() . " (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		creator_id BIGINT UNSIGNED NOT NULL,
		name VARCHAR(24) NOT NULL,
		image_url TEXT NOT NULL,
		attachment_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL,
		PRIMARY KEY  (id),
		UNIQUE KEY creator_name (creator_id, name)
	) " . $wpdb->get_charset_collate() . ';' );
	update_option( 'sml_ce_db', SML_CE_DB, false );
}
add_action( 'init', 'sml_ce_install', 20 );

/** The one place the cap lives. Per-creator override in usermeta, then the filter (a future paid tier hooks here). */
function sml_ce_limit( $creator ) {
	$n = (int) get_user_meta( (int) $creator, 'sml_ce_limit', true );
	$n = $n > 0 ? $n : SML_CE_DEFAULT;
	return max( 0, (int) apply_filters( 'sml_channel_emote_limit', $n, (int) $creator ) );
}

function sml_ce_is_creator( $uid ) { return $uid && '' !== (string) get_user_meta( (int) $uid, 'sml_channel_handle', true ); }

function sml_ce_creator_from_handle( $raw ) {
	$h = sanitize_key( (string) $raw );
	if ( '' === $h ) { return 0; }
	global $wpdb;
	/* the live room key is the watch-page handle; it must win over a channel handle that happens to spell the same */
	if ( function_exists( 'sml_scheduled_live_user_for_handle' ) ) {
		$u = sml_scheduled_live_user_for_handle( $h );
		if ( $u instanceof WP_User ) { return (int) $u->ID; }
		if ( is_numeric( $u ) && (int) $u ) { return (int) $u; }
	}
	$uid = (int) $wpdb->get_var( $wpdb->prepare( "SELECT user_id FROM {$wpdb->usermeta} WHERE meta_key = 'sml_channel_handle' AND meta_value = %s LIMIT 1", $h ) );
	if ( $uid ) { return $uid; }
	$u = get_user_by( 'slug', $h );
	return $u ? (int) $u->ID : 0;
}

/** creator for a live-chat room key: a handle, or "stream-{id}" */
function sml_ce_creator_from_room( $room ) {
	$room = (string) $room;
	if ( 0 === strpos( $room, 'stream-' ) && function_exists( 'sml_cu_find_stream_owner' ) ) {
		$o = sml_cu_find_stream_owner( substr( $room, 7 ) );
		if ( is_array( $o ) ) { return (int) ( $o['user_id'] ?? $o['uid'] ?? reset( $o ) ); }
		return (int) $o;
	}
	return sml_ce_creator_from_handle( $room );
}

/** The creator's Premium (paid) groups. */
function sml_ce_paid_groups( $creator ) {
	global $wpdb;
	return $wpdb->get_results( $wpdb->prepare( "SELECT id, name, slug FROM {$wpdb->prefix}sml_groups WHERE owner_id = %d AND access_model = 'paid' ORDER BY id ASC", (int) $creator ), ARRAY_A ) ?: array();
}

function sml_ce_can_use( $viewer, $creator ) {
	$viewer = (int) $viewer; $creator = (int) $creator;
	$ok = false;
	if ( $viewer && $creator ) {
		if ( $viewer === $creator || user_can( $viewer, 'manage_options' ) ) { $ok = true; }
		else {
			global $wpdb;
			$ok = (bool) $wpdb->get_var( $wpdb->prepare(
				"SELECT m.id FROM {$wpdb->prefix}sml_group_members m INNER JOIN {$wpdb->prefix}sml_groups g ON g.id = m.group_id
				  WHERE m.user_id = %d AND g.owner_id = %d AND g.access_model = 'paid' LIMIT 1", $viewer, $creator ) );
		}
	}
	return (bool) apply_filters( 'sml_channel_emote_can_use', $ok, $viewer, $creator );
}

function sml_ce_emotes( $creator ) {
	global $wpdb;
	$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT id, name, image_url FROM ' . sml_ce_t() . ' WHERE creator_id = %d ORDER BY name ASC', (int) $creator ), ARRAY_A ) ?: array();
	return array_map( function ( $r ) { return array( 'id' => (int) $r['id'], 'name' => $r['name'], 'url' => $r['image_url'] ); }, $rows );
}

/* ------------------------------------------------------------------ send gate */

function sml_ce_gate_text( $text, $creator, $viewer ) {
	if ( false === strpos( (string) $text, ':' ) || ! $creator ) { return $text; }
	static $names = array();
	if ( ! isset( $names[ $creator ] ) ) { $names[ $creator ] = array_column( sml_ce_emotes( $creator ), 'name' ); }
	if ( ! $names[ $creator ] || sml_ce_can_use( $viewer, $creator ) ) { return $text; }
	return preg_replace_callback( '/:([a-z0-9_]{2,24}):/i', function ( $m ) use ( $creator, $names ) {
		return in_array( strtolower( $m[1] ), $names[ $creator ], true ) ? $m[1] : $m[0];
	}, (string) $text );
}

add_filter( 'rest_pre_dispatch', function ( $result, $server, $request ) {
	if ( 'POST' !== $request->get_method() ) { return $result; }
	$route = $request->get_route();
	if ( preg_match( '#^/sml-live-chat/v1/room/([A-Za-z0-9_-]+)/messages/?$#', $route, $m ) ) { $room = $m[1]; }
	elseif ( preg_match( '#^/sml-voice/v1/chat/?$#', $route ) ) { $room = (string) $request->get_param( 'room' ); if ( '' === $room ) { $room = (string) $request->get_param( 'handle' ); } }
	else { return $result; }
	$creator = sml_ce_creator_from_room( $room );
	if ( ! $creator ) { return $result; }
	$viewer = get_current_user_id();
	foreach ( array( 'body', 'message', 'text', 'content' ) as $f ) {
		$v = $request->get_param( $f );
		if ( is_string( $v ) && '' !== $v ) { $request->set_param( $f, sml_ce_gate_text( $v, $creator, $viewer ) ); }
	}
	return $result;
}, 5, 3 );

/* ------------------------------------------------------------------ REST */

add_action( 'rest_api_init', function () {
	$ns = 'sml-emotes/v1';
	register_rest_route( $ns, '/list/(?P<handle>[A-Za-z0-9_-]+)', array( 'methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => 'sml_ce_rest_list' ) );
	register_rest_route( $ns, '/mine', array( 'methods' => 'GET', 'permission_callback' => 'is_user_logged_in', 'callback' => 'sml_ce_rest_mine' ) );
	register_rest_route( $ns, '/upload', array( 'methods' => 'POST', 'permission_callback' => 'is_user_logged_in', 'callback' => 'sml_ce_rest_upload' ) );
	register_rest_route( $ns, '/(?P<id>\d+)', array( 'methods' => 'DELETE', 'permission_callback' => 'is_user_logged_in', 'callback' => 'sml_ce_rest_delete' ) );
} );

function sml_ce_rest_list( WP_REST_Request $req ) {
	$creator = sml_ce_creator_from_handle( $req['handle'] );
	if ( ! $creator ) { return array( 'emotes' => array(), 'can_use' => false ); }
	$viewer = get_current_user_id();
	$groups = sml_ce_paid_groups( $creator );
	$join   = $groups ? home_url( '/groups/' . rawurlencode( $groups[0]['slug'] ) . '/' ) : '';
	$res = rest_ensure_response( array(
		'creator'   => $creator,
		'emotes'    => sml_ce_emotes( $creator ),
		'can_use'   => sml_ce_can_use( $viewer, $creator ),
		'signed_in' => (bool) $viewer,
		'join_url'  => $join,
		'channel'   => (string) get_user_meta( $creator, 'sml_channel_name', true ),
	) );
	$res->header( 'Cache-Control', 'private, no-store' );
	return $res;
}

function sml_ce_rest_mine() {
	$uid = get_current_user_id();
	if ( ! sml_ce_is_creator( $uid ) ) { return new WP_Error( 'sml_ce_creator', 'Create your Loop channel first to add emotes.', array( 'status' => 403 ) ); }
	$e = sml_ce_emotes( $uid );
	return array( 'emotes' => $e, 'used' => count( $e ), 'limit' => sml_ce_limit( $uid ), 'max_kb' => SML_CE_MAX_KB, 'max_px' => SML_CE_MAX_PX, 'premium_groups' => count( sml_ce_paid_groups( $uid ) ) );
}

function sml_ce_rest_upload( WP_REST_Request $req ) {
	return sml_ce_store( get_current_user_id(), (string) $req->get_param( 'name' ), $req->get_file_params()['file'] ?? null, 'wp_handle_upload' );
}

function sml_ce_store( $uid, $raw_name, $f, $handler ) {
	global $wpdb;
	if ( ! sml_ce_is_creator( $uid ) ) { return new WP_Error( 'sml_ce_creator', 'Create your Loop channel first to add emotes.', array( 'status' => 403 ) ); }
	$name = strtolower( trim( (string) $raw_name ) );
	$name = trim( preg_replace( '/[^a-z0-9_]+/', '_', $name ), '_' );
	if ( strlen( $name ) < 2 || strlen( $name ) > 24 ) { return new WP_Error( 'sml_ce_name', 'Name it with 2 to 24 letters, numbers or underscores.', array( 'status' => 400 ) ); }
	if ( (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . sml_ce_t() . ' WHERE creator_id = %d AND name = %s', $uid, $name ) ) ) { return new WP_Error( 'sml_ce_dupe', 'You already have an emote with that name.', array( 'status' => 409 ) ); }
	$used = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM ' . sml_ce_t() . ' WHERE creator_id = %d', $uid ) );
	$limit = sml_ce_limit( $uid );
	if ( $used >= $limit ) { return new WP_Error( 'sml_ce_limit', 'You have used all ' . $limit . ' of your emote slots. Remove one to add another.', array( 'status' => 403 ) ); }

	if ( ! $f || ! empty( $f['error'] ) || empty( $f['tmp_name'] ) ) { return new WP_Error( 'sml_ce_file', 'Choose an image to upload.', array( 'status' => 400 ) ); }
	if ( (int) $f['size'] > SML_CE_MAX_KB * 1024 ) { return new WP_Error( 'sml_ce_size', 'Keep emotes under ' . SML_CE_MAX_KB . ' KB.', array( 'status' => 400 ) ); }
	$info = @getimagesize( $f['tmp_name'] );
	$allowed = array( IMAGETYPE_PNG => 'png', IMAGETYPE_GIF => 'gif', IMAGETYPE_WEBP => 'webp' );
	if ( ! $info || ! isset( $allowed[ $info[2] ] ) ) { return new WP_Error( 'sml_ce_type', 'Emotes must be PNG, GIF or WebP images.', array( 'status' => 400 ) ); }
	if ( $info[0] > SML_CE_MAX_PX || $info[1] > SML_CE_MAX_PX ) { return new WP_Error( 'sml_ce_dims', 'Emotes can be at most ' . SML_CE_MAX_PX . ' x ' . SML_CE_MAX_PX . ' pixels.', array( 'status' => 400 ) ); }

	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	$f['name'] = 'emote-' . $uid . '-' . $name . '.' . $allowed[ $info[2] ];
	$opts = array( 'test_form' => false, 'mimes' => array( 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp' ) );
	$up = 'wp_handle_sideload' === $handler ? wp_handle_sideload( $f, $opts ) : wp_handle_upload( $f, $opts );
	if ( ! empty( $up['error'] ) ) { return new WP_Error( 'sml_ce_upload', 'The upload failed. Try again.', array( 'status' => 500 ) ); }
	$aid = wp_insert_attachment( array( 'post_mime_type' => $up['type'], 'post_title' => 'sml-emote-' . $uid . '-' . $name, 'post_status' => 'inherit', 'post_author' => $uid ), $up['file'] );
	if ( is_wp_error( $aid ) || ! $aid ) { return new WP_Error( 'sml_ce_upload', 'The upload failed. Try again.', array( 'status' => 500 ) ); }
	$ok = $wpdb->insert( sml_ce_t(), array( 'creator_id' => $uid, 'name' => $name, 'image_url' => esc_url_raw( $up['url'] ), 'attachment_id' => (int) $aid, 'created_at' => gmdate( 'Y-m-d H:i:s' ) ) );
	if ( ! $ok ) { wp_delete_attachment( $aid, true ); return new WP_Error( 'sml_ce_dupe', 'That name was just taken. Pick another.', array( 'status' => 409 ) ); }
	return array( 'ok' => true, 'emote' => array( 'id' => (int) $wpdb->insert_id, 'name' => $name, 'url' => $up['url'] ), 'used' => $used + 1, 'limit' => $limit );
}

function sml_ce_rest_delete( WP_REST_Request $req ) {
	global $wpdb;
	$uid = get_current_user_id();
	$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . sml_ce_t() . ' WHERE id = %d', (int) $req['id'] ), ARRAY_A );
	if ( ! $row || ( (int) $row['creator_id'] !== $uid && ! current_user_can( 'manage_options' ) ) ) { return new WP_Error( 'sml_ce_forbidden', 'That emote is not yours.', array( 'status' => 403 ) ); }
	$wpdb->delete( sml_ce_t(), array( 'id' => (int) $row['id'] ) );
	if ( (int) $row['attachment_id'] ) { wp_delete_attachment( (int) $row['attachment_id'], true ); }
	return array( 'ok' => true );
}
