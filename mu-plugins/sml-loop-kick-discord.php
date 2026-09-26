<?php
/**
 * Plugin Name: SML LOOP-KICK Discord Bridge
 * Description: (1) Mints short-lived LOOP-KICK sessions for linked, verified Discord members — HMAC-guarded, called only by sml-platform-api; no WordPress credential leaves the site. (2) Forwards new LOOP-KICK notifications of members who turned phone alerts ON to the hosted phone's web-push sender.
 * Version: 1.1.0
 *
 * Session route: POST /wp-json/sml-loop-kick/v1/discord-session
 *   HMAC-SHA256 (SML_LOOP_KICK_BRIDGE_SECRET constant, or AES-encrypted option
 *   sml_lk_bridge_secret — Academy-bridge crypto) over "{ts}.{/wp-json route}.{sha256(body)}",
 *   headers x-sml-lk-timestamp / x-sml-lk-signature, 60 s window, every signature
 *   single-use. The member id is read ONLY from the signed body bytes. Requires a row
 *   in wp_sml_discord_site_links AND sml_email_verified === '1' (fails closed), then
 *   mints into the LOOP-KICK Bridge's own transient family
 *   ('sml_lk_session_' . sha256(token)) with a 15-minute TTL, so the hosted app's
 *   existing introspection accepts it unchanged. The site popup's 12 h session is
 *   never touched.
 *
 * Push: members opt in on the phone (/enable-alerts.html); the phone app mirrors that
 * choice here through the signed /push-optin route (usermeta sml_lk_push_optin). Only
 * opted-in members' new notifications leave the site: new rows are diffed in the
 * update_user_metadata filter (the only hook that sees old AND new), throttled per
 * member (45 s), and shipped as ONE signed, non-blocking batch per request to
 * /api/push/send. Logging out of the site drops that member's phone subscriptions
 * (signed /api/push/revoke) and clears the opt-in.
 *
 * ROLLBACK: delete this file. It writes transients, its own replay-guard option rows
 * (swept hourly) and the sml_lk_push_optin usermeta; it reads existing tables.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SML_LKD_VERSION', '1.1.0' );
define( 'SML_LKD_APP_URL', 'https://stockmarketloop-loop-kick.onrender.com' );
define( 'SML_LKD_SESSION_TTL', 15 * MINUTE_IN_SECONDS );
define( 'SML_LKD_BATCH_CAP', 200 );

/* ---------- secrets: constant first, then AES-encrypted option (Academy-bridge crypto) ---------- */

function sml_lkd_decrypt_option( $option_name ) {
	$stored = (string) get_option( $option_name, '' );
	if ( '' === $stored || ! function_exists( 'openssl_decrypt' ) ) {
		return '';
	}
	$raw    = base64_decode( $stored, true );
	$method = 'aes-256-cbc';
	$iv_len = openssl_cipher_iv_length( $method );
	if ( false === $raw || strlen( $raw ) <= $iv_len ) {
		return '';
	}
	return (string) openssl_decrypt( substr( $raw, $iv_len ), $method, hash( 'sha256', wp_salt( 'auth' ), true ), OPENSSL_RAW_DATA, substr( $raw, 0, $iv_len ) );
}

function sml_lkd_encrypt_for_option( $secret ) {
	$method = 'aes-256-cbc';
	$iv     = random_bytes( openssl_cipher_iv_length( $method ) );
	$value  = openssl_encrypt( $secret, $method, hash( 'sha256', wp_salt( 'auth' ), true ), OPENSSL_RAW_DATA, $iv );
	return false === $value ? '' : base64_encode( $iv . $value );
}

function sml_lkd_bridge_secret() {
	if ( defined( 'SML_LOOP_KICK_BRIDGE_SECRET' ) ) {
		return trim( (string) SML_LOOP_KICK_BRIDGE_SECRET );
	}
	return trim( sml_lkd_decrypt_option( 'sml_lk_bridge_secret' ) );
}

function sml_lkd_push_secret() {
	if ( defined( 'SML_LOOP_KICK_PUSH_SECRET' ) ) {
		return trim( (string) SML_LOOP_KICK_PUSH_SECRET );
	}
	return trim( sml_lkd_decrypt_option( 'sml_lk_push_secret' ) );
}

/* ---------- shared HMAC verification with single-use signatures ---------- */

/**
 * Verify "{ts}.{/wp-json route}.{sha256(raw body)}" and burn the signature so a
 * captured request can never be replayed, even inside the 60 s window. The burn is
 * an INSERT IGNORE on a unique option_name — atomic on the database, independent of
 * any object cache.
 */
function sml_lkd_verify_signed( WP_REST_Request $request, $secret, $ts_header, $sig_header ) {
	if ( strlen( (string) $secret ) < 32 ) {
		return new WP_Error( 'sml_lkd_unconfigured', 'Not configured.', array( 'status' => 503 ) );
	}
	$timestamp = (string) $request->get_header( $ts_header );
	$provided  = (string) $request->get_header( $sig_header );
	if ( ! preg_match( '/^\d{10,12}$/', $timestamp ) || ! preg_match( '/^sha256=[a-f0-9]{64}$/', $provided ) ) {
		return new WP_Error( 'sml_lkd_unauthorized', 'Unauthorized.', array( 'status' => 401 ) );
	}
	if ( abs( time() - (int) $timestamp ) > 60 ) {
		return new WP_Error( 'sml_lkd_expired', 'Unauthorized.', array( 'status' => 401 ) );
	}
	$path     = '/wp-json' . $request->get_route();
	$expected = 'sha256=' . hash_hmac( 'sha256', $timestamp . '.' . $path . '.' . hash( 'sha256', (string) $request->get_body() ), $secret );
	if ( ! hash_equals( $expected, $provided ) ) {
		return new WP_Error( 'sml_lkd_signature', 'Unauthorized.', array( 'status' => 401 ) );
	}
	global $wpdb;
	$burned = $wpdb->query( $wpdb->prepare(
		"INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'no')",
		'sml_lkd_seen_' . substr( hash( 'sha256', $provided ), 0, 40 ),
		(string) time()
	) );
	if ( 1 !== (int) $burned ) {
		return new WP_Error( 'sml_lkd_replay', 'Unauthorized.', array( 'status' => 401 ) );
	}
	return true;
}

/** Hourly sweep of burned-signature rows older than the acceptance window. */
add_action( 'init', static function () {
	if ( ! wp_next_scheduled( 'sml_lkd_sweep_seen' ) ) {
		wp_schedule_event( time() + 300, 'hourly', 'sml_lkd_sweep_seen' );
	}
} );
add_action( 'sml_lkd_sweep_seen', static function () {
	global $wpdb;
	$wpdb->query( $wpdb->prepare(
		"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s AND CAST(option_value AS UNSIGNED) < %d",
		$wpdb->esc_like( 'sml_lkd_seen_' ) . '%',
		time() - 600
	) );
} );

/** The signed body, decoded — handlers read ONLY these bytes, never get_param(). */
function sml_lkd_signed_json( WP_REST_Request $request ) {
	$data = json_decode( (string) $request->get_body(), true );
	return is_array( $data ) ? $data : array();
}

/* ---------- session mint ---------- */

function sml_lkd_handle_display( $user_id ) {
	foreach ( array( 'sml_members_public_handle', 'sml_members_handle' ) as $fn ) {
		if ( function_exists( $fn ) ) {
			$handle = (string) call_user_func( $fn, $user_id );
			if ( '' !== $handle ) {
				return $handle;
			}
		}
	}
	$user = get_userdata( $user_id );
	return $user ? (string) $user->user_nicename : '';
}

function sml_lkd_rest_discord_session( WP_REST_Request $request ) {
	global $wpdb;
	$body            = sml_lkd_signed_json( $request );
	$discord_user_id = preg_replace( '/\D/', '', (string) ( $body['discord_user_id'] ?? '' ) );
	if ( ! preg_match( '/^\d{15,24}$/', $discord_user_id ) ) {
		return new WP_Error( 'sml_lkd_bad_discord_id', 'A Discord user id is required.', array( 'status' => 400 ) );
	}

	$rate_key = 'sml_lkd_rate_' . $discord_user_id;
	$rate     = (int) get_transient( $rate_key );
	if ( $rate >= 20 ) {
		return new WP_Error( 'sml_lkd_rate', 'Too many session requests - try again in a minute.', array( 'status' => 429 ) );
	}
	set_transient( $rate_key, $rate + 1, MINUTE_IN_SECONDS );

	$links_table = $wpdb->prefix . 'sml_discord_site_links';
	$link        = $wpdb->get_row( $wpdb->prepare( "SELECT user_id FROM {$links_table} WHERE discord_user_id=%s", $discord_user_id ), ARRAY_A );
	$user_id     = $link ? absint( $link['user_id'] ) : 0;
	$user        = $user_id ? get_userdata( $user_id ) : false;
	if ( ! $user ) {
		return new WP_REST_Response( array(
			'ok'          => false,
			'error'       => 'not_linked',
			'connect_url' => home_url( '/connect-discord/' ),
		), 403 );
	}

	/* strict: only a completed email-code verification counts (fails closed) */
	if ( '1' !== (string) get_user_meta( $user_id, 'sml_email_verified', true ) ) {
		return new WP_REST_Response( array(
			'ok'         => false,
			'error'      => 'not_verified',
			'verify_url' => home_url( '/register/' ),
		), 403 );
	}

	$token = bin2hex( random_bytes( 32 ) );
	set_transient(
		'sml_lk_session_' . hash( 'sha256', $token ),
		array( 'userId' => 'wp-' . $user_id, 'wpUserId' => $user_id ),
		SML_LKD_SESSION_TTL
	);

	$response = new WP_REST_Response( array(
		'ok'         => true,
		'token'      => $token,
		'expires_at' => time() + SML_LKD_SESSION_TTL,
		'user'       => array(
			'id'           => $user_id,
			'handle'       => sml_lkd_handle_display( $user_id ),
			'display_name' => (string) $user->display_name,
			'avatar'       => (string) get_avatar_url( $user_id, array( 'size' => 96 ) ),
		),
		'app_url'    => SML_LKD_APP_URL,
	), 200 );
	$response->header( 'Cache-Control', 'no-store, private' );
	return $response;
}

/* ---------- push opt-in mirror (called by the phone app) ---------- */

function sml_lkd_rest_push_optin( WP_REST_Request $request ) {
	$body    = sml_lkd_signed_json( $request );
	$user_id = preg_match( '/^wp-(\d{1,12})$/', (string) ( $body['user_id'] ?? '' ), $m ) ? absint( $m[1] ) : 0;
	if ( ! $user_id || ! get_userdata( $user_id ) ) {
		return new WP_Error( 'sml_lkd_bad_user', 'Unknown member.', array( 'status' => 400 ) );
	}
	if ( ! empty( $body['optin'] ) ) {
		update_user_meta( $user_id, 'sml_lk_push_optin', '1' );
	} else {
		delete_user_meta( $user_id, 'sml_lk_push_optin' );
	}
	return new WP_REST_Response( array( 'ok' => true ), 200 );
}

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml-loop-kick/v1', '/discord-session', array(
		'methods'             => 'POST',
		'permission_callback' => static function ( WP_REST_Request $request ) {
			return sml_lkd_verify_signed( $request, sml_lkd_bridge_secret(), 'x-sml-lk-timestamp', 'x-sml-lk-signature' );
		},
		'callback'            => 'sml_lkd_rest_discord_session',
	) );
	register_rest_route( 'sml-loop-kick/v1', '/push-optin', array(
		'methods'             => 'POST',
		'permission_callback' => static function ( WP_REST_Request $request ) {
			return sml_lkd_verify_signed( $request, sml_lkd_push_secret(), 'x-sml-push-timestamp', 'x-sml-push-signature' );
		},
		'callback'            => 'sml_lkd_rest_push_optin',
	) );
} );

/* ---------- outbound signed calls to the phone app ---------- */

function sml_lkd_post_to_app( $path, array $payload ) {
	$secret = sml_lkd_push_secret();
	if ( strlen( $secret ) < 32 ) {
		return;
	}
	$body      = wp_json_encode( $payload );
	$timestamp = (string) time();
	$signature = 'sha256=' . hash_hmac( 'sha256', $timestamp . '.' . $path . '.' . hash( 'sha256', $body ), $secret );
	wp_remote_post( SML_LKD_APP_URL . $path, array(
		'timeout'  => 2,
		'blocking' => false,
		'headers'  => array(
			'Content-Type'         => 'application/json',
			'x-sml-push-timestamp' => $timestamp,
			'x-sml-push-signature' => $signature,
		),
		'body'     => $body,
	) );
}

/* logging out drops the member's phone subscriptions everywhere + clears the opt-in */
add_action( 'wp_logout', static function ( $user_id = 0 ) {
	$user_id = absint( $user_id );
	if ( ! $user_id || '1' !== (string) get_user_meta( $user_id, 'sml_lk_push_optin', true ) ) {
		return;
	}
	delete_user_meta( $user_id, 'sml_lk_push_optin' );
	sml_lkd_post_to_app( '/api/push/revoke', array( 'user_id' => 'wp-' . $user_id ) );
}, 20 );

/* ---------- push fan-out (opted-in members only) ---------- */

function sml_lkd_push_queue( $add = null ) {
	static $queue = array();
	if ( is_array( $add ) && count( $queue ) < SML_LKD_BATCH_CAP ) {
		$queue[] = $add;
	}
	return $queue;
}

function sml_lkd_row_id( $row ) {
	if ( is_array( $row ) && isset( $row['id'] ) && '' !== (string) $row['id'] ) {
		return (string) $row['id'];
	}
	return md5( wp_json_encode( $row ) );
}

function sml_lkd_watch_notifications( $check, $object_id, $meta_key, $meta_value ) {
	if ( 'sml_notifications' !== $meta_key || ! is_array( $meta_value ) ) {
		return $check;
	}
	$user_id = absint( $object_id );
	/* opt-in is mirrored from the phone app; no opt-in means nothing leaves the site */
	if ( ! $user_id || '1' !== (string) get_user_meta( $user_id, 'sml_lk_push_optin', true ) ) {
		return $check;
	}
	$old     = get_user_meta( $user_id, 'sml_notifications', true );
	$old_ids = array();
	foreach ( (array) ( is_array( $old ) ? $old : array() ) as $row ) {
		$old_ids[ sml_lkd_row_id( $row ) ] = true;
	}
	$fresh = null;
	foreach ( $meta_value as $row ) {
		if ( is_array( $row ) && ! isset( $old_ids[ sml_lkd_row_id( $row ) ] ) ) {
			$fresh = $row; // read-marking rewrites keep every id, so they add nothing here
		}
	}
	if ( $fresh ) {
		sml_lkd_push_queue( array( 'user_id' => $user_id, 'row' => $fresh ) );
	}
	return $check;
}
add_filter( 'update_user_metadata', 'sml_lkd_watch_notifications', 10, 4 );
add_filter( 'add_user_metadata', 'sml_lkd_watch_notifications', 10, 4 );

function sml_lkd_push_title( $type ) {
	$titles = array(
		'dm'              => 'New message',
		'comment'         => 'New comment',
		'like'            => 'New like',
		'share'           => 'Your post was shared',
		'gift'            => 'You received a gift',
		'video'           => 'New video',
		'live'            => 'Going live',
		'follow'          => 'New follower',
		'mention'         => 'You were mentioned',
		'action_required' => 'Action needed',
	);
	$type = sanitize_key( (string) $type );
	return $titles[ $type ] ?? 'LOOP-KICK';
}

/** ONE signed, non-blocking batch per request, however many members it touched. */
function sml_lkd_flush_push_queue() {
	$queue = sml_lkd_push_queue();
	if ( ! $queue ) {
		return;
	}
	$items = array();
	$seen  = array();
	foreach ( $queue as $entry ) {
		$user_id = absint( $entry['user_id'] );
		if ( ! $user_id || isset( $seen[ $user_id ] ) ) {
			continue;
		}
		$seen[ $user_id ] = true;
		$throttle_key     = 'sml_lkd_pushed_' . $user_id;
		if ( get_transient( $throttle_key ) ) {
			continue; // newest alert wins on-device anyway (constant tag)
		}
		set_transient( $throttle_key, 1, 45 );
		$row     = (array) $entry['row'];
		$items[] = array(
			'user_id' => 'wp-' . $user_id,
			'title'   => sml_lkd_push_title( $row['type'] ?? '' ),
			'body'    => mb_substr( wp_strip_all_tags( (string) ( $row['message'] ?? '' ) ), 0, 140 ),
			'url'     => esc_url_raw( (string) ( $row['link'] ?? '' ) ) ?: home_url( '/#loop-kick' ),
			'tag'     => 'loop-kick',
		);
	}
	if ( $items ) {
		sml_lkd_post_to_app( '/api/push/send', array( 'items' => array_slice( $items, 0, SML_LKD_BATCH_CAP ) ) );
	}
}
add_action( 'shutdown', 'sml_lkd_flush_push_queue', 5 );
