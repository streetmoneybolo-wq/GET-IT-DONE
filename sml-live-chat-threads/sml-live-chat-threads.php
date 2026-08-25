<?php
/**
 * Plugin Name: SML Live Chat Threads
 * Description: Adds durable one-level reply threads to StockMarketLoop Live Watch chat.
 * Version: 1.0.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 *
 * A reply is stored separately from the main live-chat plugin, so this never
 * changes or risks its message table.  Replies always belong to an existing
 * message in the same live room and are returned with the same Loop Channel /
 * StockMarketLoop identity used on the Watch page.
 */

defined( 'ABSPATH' ) || exit;

function sml_lct_table_name() {
	global $wpdb;
	return $wpdb->prefix . 'sml_live_chat_thread_replies';
}

function sml_lct_activate() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$table           = sml_lct_table_name();
	$charset_collate = $wpdb->get_charset_collate();
	$sql             = "CREATE TABLE {$table} (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		room_key varchar(191) NOT NULL,
		parent_message_id bigint(20) unsigned NOT NULL,
		user_id bigint(20) unsigned NOT NULL,
		body text NOT NULL,
		created_at datetime NOT NULL,
		PRIMARY KEY  (id),
		KEY room_parent_id (room_key, parent_message_id, id),
		KEY user_id (user_id)
	) {$charset_collate};";
	dbDelta( $sql );
}
register_activation_hook( __FILE__, 'sml_lct_activate' );

function sml_lct_room_key_candidates( $room ) {
	$room = sanitize_key( (string) $room );
	return array_values( array_unique( array_filter( array(
		substr( 'room-' . $room, 0, 190 ),
		$room,
	) ) ) );
}

function sml_lct_existing_message( $room, $message_id ) {
	global $wpdb;
	$message_id = absint( $message_id );
	$keys       = sml_lct_room_key_candidates( $room );
	if ( ! $message_id || empty( $keys ) ) {
		return null;
	}
	$table        = $wpdb->prefix . 'sml_live_chat_messages';
	$placeholders = implode( ',', array_fill( 0, count( $keys ), '%s' ) );
	$sql          = "SELECT id FROM {$table} WHERE id = %d AND room_key IN ({$placeholders}) LIMIT 1";
	return $wpdb->get_row( $wpdb->prepare( $sql, array_merge( array( $message_id ), $keys ) ) );
}

function sml_lct_owner_for_room( $room ) {
	if ( function_exists( 'sml_lcm_owner_for_room' ) ) {
		return absint( sml_lcm_owner_for_room( $room ) );
	}
	$room = sanitize_key( (string) $room );
	if ( '' === $room ) {
		return 0;
	}
	$query = new WP_User_Query( array(
		'number'      => 1,
		'count_total' => false,
		'meta_key'    => 'sml_public_handle',
		'meta_value'  => $room,
		'fields'      => 'ID',
	) );
	$users = $query->get_results();
	if ( ! empty( $users[0] ) ) {
		return absint( $users[0] );
	}
	$user = get_user_by( 'slug', $room );
	if ( ! $user ) {
		$user = get_user_by( 'login', $room );
	}
	return $user ? absint( $user->ID ) : 0;
}

function sml_lct_identity( $user_id ) {
	$user_id = absint( $user_id );
	$user    = $user_id ? get_user_by( 'id', $user_id ) : false;
	if ( ! $user ) {
		return array(
			'display_name' => 'StockMarketLoop User',
			'avatar'       => '',
		);
	}
	$channel_name      = trim( (string) get_user_meta( $user_id, 'sml_channel_name', true ) );
	$channel_avatar_id = absint( get_user_meta( $user_id, 'sml_channel_avatar_id', true ) );
	$channel_avatar    = $channel_avatar_id ? wp_get_attachment_image_url( $channel_avatar_id, 'thumbnail' ) : '';
	return array(
		'display_name' => '' !== $channel_name ? $channel_name : (string) $user->display_name,
		'avatar'       => $channel_avatar ? $channel_avatar : get_avatar_url( $user_id, array( 'size' => 96 ) ),
	);
}

function sml_lct_reply_payload( $row ) {
	$identity = sml_lct_identity( $row['user_id'] ?? 0 );
	return array(
		'id'                => absint( $row['id'] ?? 0 ),
		'parent_message_id' => absint( $row['parent_message_id'] ?? 0 ),
		'user_id'           => absint( $row['user_id'] ?? 0 ),
		'display_name'      => $identity['display_name'],
		'avatar'            => $identity['avatar'],
		'body'              => wp_strip_all_tags( (string) ( $row['body'] ?? '' ) ),
		'created_at'        => (string) ( $row['created_at'] ?? '' ),
	);
}

function sml_lct_rest_counts( WP_REST_Request $request ) {
	global $wpdb;
	$room = sanitize_key( (string) $request['room'] );
	$ids  = preg_split( '/[^0-9]+/', (string) $request->get_param( 'ids' ) );
	$ids  = array_values( array_unique( array_filter( array_map( 'absint', $ids ) ) ) );
	$ids  = array_slice( $ids, 0, 50 );
	if ( ! $room || empty( $ids ) ) {
		return rest_ensure_response( array( 'counts' => array() ) );
	}
	$table        = sml_lct_table_name();
	$keys         = sml_lct_room_key_candidates( $room );
	$key_slots    = implode( ',', array_fill( 0, count( $keys ), '%s' ) );
	$id_slots     = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	$sql          = "SELECT parent_message_id, COUNT(*) AS reply_count FROM {$table} WHERE room_key IN ({$key_slots}) AND parent_message_id IN ({$id_slots}) GROUP BY parent_message_id";
	$rows         = $wpdb->get_results( $wpdb->prepare( $sql, array_merge( $keys, $ids ) ), ARRAY_A );
	$counts       = array_fill_keys( array_map( 'strval', $ids ), 0 );
	foreach ( $rows ?: array() as $row ) {
		$counts[ (string) absint( $row['parent_message_id'] ) ] = absint( $row['reply_count'] );
	}
	return rest_ensure_response( array( 'counts' => $counts ) );
}

function sml_lct_rest_replies( WP_REST_Request $request ) {
	global $wpdb;
	$room       = sanitize_key( (string) $request['room'] );
	$message_id = absint( $request['message_id'] );
	if ( ! sml_lct_existing_message( $room, $message_id ) ) {
		return new WP_Error( 'sml_lct_parent_not_found', 'That chat message is unavailable.', array( 'status' => 404 ) );
	}
	$table = sml_lct_table_name();
	$keys  = sml_lct_room_key_candidates( $room );
	$slots = implode( ',', array_fill( 0, count( $keys ), '%s' ) );
	$sql   = "SELECT id, parent_message_id, user_id, body, created_at FROM {$table} WHERE room_key IN ({$slots}) AND parent_message_id = %d ORDER BY id ASC LIMIT 100";
	$rows  = $wpdb->get_results( $wpdb->prepare( $sql, array_merge( $keys, array( $message_id ) ) ), ARRAY_A );
	return rest_ensure_response( array(
		'parent_message_id' => $message_id,
		'replies'           => array_map( 'sml_lct_reply_payload', $rows ?: array() ),
	) );
}

function sml_lct_rest_post_reply( WP_REST_Request $request ) {
	global $wpdb;
	$uid        = get_current_user_id();
	$room       = sanitize_key( (string) $request['room'] );
	$message_id = absint( $request['message_id'] );
	$body       = '';
	foreach ( array( 'body', 'message', 'text' ) as $field ) {
		$value = $request->get_param( $field );
		if ( is_string( $value ) && '' !== trim( $value ) ) {
			$body = trim( $value );
			break;
		}
	}
	$body = sanitize_textarea_field( $body );
	if ( '' === $body ) {
		return new WP_Error( 'sml_lct_empty_reply', 'Write a reply before sending.', array( 'status' => 400 ) );
	}
	if ( strlen( $body ) > 500 ) {
		return new WP_Error( 'sml_lct_reply_too_long', 'Replies can be up to 500 characters.', array( 'status' => 400 ) );
	}
	if ( ! sml_lct_existing_message( $room, $message_id ) ) {
		return new WP_Error( 'sml_lct_parent_not_found', 'That chat message is unavailable.', array( 'status' => 404 ) );
	}
	$rate_key = 'sml_lct_reply_rate_' . absint( $uid );
	if ( get_transient( $rate_key ) ) {
		return new WP_Error( 'sml_lct_rate_limited', 'Please wait a moment before sending another reply.', array( 'status' => 429 ) );
	}
	$owner = sml_lct_owner_for_room( $room );
	if ( $owner && function_exists( 'sml_channel_mod_check' ) ) {
		$is_mod = function_exists( 'sml_channel_is_mod' ) && sml_channel_is_mod( $owner, $uid );
		if ( ! $is_mod ) {
			$why = sml_channel_mod_check( $owner, $body );
			if ( '' !== (string) $why ) {
				return new WP_Error( 'sml_chat_blocked', (string) $why, array( 'status' => 403 ) );
			}
		}
	}
	$table = sml_lct_table_name();
	$ok    = $wpdb->insert(
		$table,
		array(
			'room_key'          => substr( 'room-' . $room, 0, 190 ),
			'parent_message_id' => $message_id,
			'user_id'           => $uid,
			'body'              => $body,
			'created_at'        => current_time( 'mysql', true ),
		),
		array( '%s', '%d', '%d', '%s', '%s' )
	);
	if ( false === $ok ) {
		return new WP_Error( 'sml_lct_reply_failed', 'The reply could not be saved.', array( 'status' => 500 ) );
	}
	set_transient( $rate_key, 1, 2 );
	$row = array(
		'id'                => (int) $wpdb->insert_id,
		'parent_message_id' => $message_id,
		'user_id'           => $uid,
		'body'              => $body,
		'created_at'        => current_time( 'mysql', true ),
	);
	return rest_ensure_response( array( 'reply' => sml_lct_reply_payload( $row ) ) );
}

add_action( 'rest_api_init', function() {
	$pattern = '/room/(?P<room>[A-Za-z0-9_-]+)/message/(?P<message_id>\\d+)/replies';
	register_rest_route( 'sml-live-chat-threads/v1', $pattern, array(
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'sml_lct_rest_replies',
			'permission_callback' => '__return_true',
		),
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'sml_lct_rest_post_reply',
			'permission_callback' => 'is_user_logged_in',
		),
	) );
	register_rest_route( 'sml-live-chat-threads/v1', '/room/(?P<room>[A-Za-z0-9_-]+)/threads', array(
		'methods'             => WP_REST_Server::READABLE,
		'callback'            => 'sml_lct_rest_counts',
		'permission_callback' => '__return_true',
	) );
} );
