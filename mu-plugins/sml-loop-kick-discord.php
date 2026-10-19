<?php
/**
 * Plugin Name: SML LOOP-KICK Discord Bridge
 * Description: (1) Mints short-lived LOOP-KICK sessions for linked, verified Discord members — HMAC-guarded, called only by sml-platform-api; no WordPress credential leaves the site. (2) Forwards new LOOP-KICK notifications of members who turned phone alerts ON to the hosted phone's web-push sender.
 * Version: 1.2.0
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
 * Connect (1.2.0): two ways to store Discord id ↔ member without a link code or a slash command.
 *   POST /wp-json/sml-loop-kick/v1/discord-link  signed like discord-session; body {discord_user_id,
 *     wp_user_id, discord_tag}. sml-platform-api calls it right after the member signed in with their
 *     site password through the app identity plugin (so the member proved the account), from the
 *     Academy's LOOP-KICK panel. Same table + conflict rule as /sml-discord-site/v1/bot/link.
 *   /connect-discord/?lk=<token>  a signed single-use link the platform mints for members who still
 *     need an account: HMAC-SHA256(bridge secret, "lk-connect.<payload>") over
 *     v1.<base64url({d,t,e,n})>.<hex>, 10-minute expiry, nonce burned. Signed-out visitors are sent
 *     to log in / register and come back to the same URL; signed-in visitors are linked and land on
 *     the plain connect page, which then shows "Connected".
 *
 * ROLLBACK: delete this file. It writes transients, its own replay-guard option rows
 * (swept hourly) and the sml_lk_push_optin usermeta; it reads existing tables.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SML_LKD_VERSION', '1.2.0' );
define( 'SML_LKD_CONNECT_PATH', 'connect-discord' );
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

/* ---------- Discord ↔ member link (no code, no slash command) ---------- */

function sml_lkd_links_table() {
	global $wpdb;
	return $wpdb->prefix . 'sml_discord_site_links';
}

/**
 * Store (or move) the link for a member. Mirrors sml_drs_rest_bot_link in the site-access snippet:
 * one Discord account belongs to one member (409 otherwise); a member's existing link is replaced.
 * Returns array( 'linked' => true, 'user_id' => int, 'verified' => bool ) or WP_Error.
 */
function sml_lkd_upsert_link( $user_id, $discord_user_id, $discord_tag = '' ) {
	global $wpdb;
	$user_id         = absint( $user_id );
	$discord_user_id = preg_replace( '/\D/', '', (string) $discord_user_id );
	$discord_tag     = sanitize_text_field( (string) $discord_tag );
	if ( ! $user_id || ! get_userdata( $user_id ) ) {
		return new WP_Error( 'sml_lkd_bad_user', 'Unknown member.', array( 'status' => 400 ) );
	}
	if ( ! preg_match( '/^\d{15,24}$/', $discord_user_id ) ) {
		return new WP_Error( 'sml_lkd_bad_discord_id', 'A Discord user id is required.', array( 'status' => 400 ) );
	}
	$table = sml_lkd_links_table();
	if ( (string) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
		return new WP_Error( 'sml_lkd_links_missing', 'Discord linking is not set up on this site.', array( 'status' => 503 ) );
	}
	$existing = $wpdb->get_row( $wpdb->prepare( "SELECT user_id FROM {$table} WHERE discord_user_id=%s", $discord_user_id ), ARRAY_A );
	if ( $existing && (int) $existing['user_id'] !== $user_id ) {
		return new WP_Error( 'sml_lkd_discord_already_linked', 'This Discord account is already connected to a different StockMarketLoop account.', array( 'status' => 409 ) );
	}
	$now  = current_time( 'mysql', true );
	$mine = $wpdb->get_row( $wpdb->prepare( "SELECT id FROM {$table} WHERE user_id=%d", $user_id ), ARRAY_A );
	if ( $mine ) {
		$done = $wpdb->update( $table, array( 'discord_user_id' => $discord_user_id, 'discord_tag' => $discord_tag, 'updated_at' => $now ), array( 'user_id' => $user_id ), array( '%s', '%s', '%s' ), array( '%d' ) );
	} else {
		$done = $wpdb->insert( $table, array( 'user_id' => $user_id, 'discord_user_id' => $discord_user_id, 'discord_tag' => $discord_tag, 'created_at' => $now, 'updated_at' => $now ), array( '%d', '%s', '%s', '%s', '%s' ) );
	}
	if ( false === $done ) {
		return new WP_Error( 'sml_lkd_link_failed', 'Could not save the Discord link.', array( 'status' => 500 ) );
	}
	if ( function_exists( 'sml_drs_audit' ) ) {
		sml_drs_audit( 'identity_linked', 0, $user_id, $discord_user_id, array( 'discord_tag' => $discord_tag, 'via' => 'academy_connect' ) );
	}
	do_action( 'sml_lkd_discord_linked', $user_id, $discord_user_id );
	return array(
		'linked'   => true,
		'user_id'  => $user_id,
		'verified' => '1' === (string) get_user_meta( $user_id, 'sml_email_verified', true ),
	);
}

/* signed by sml-platform-api after the member signed in with their site password */
function sml_lkd_rest_discord_link( WP_REST_Request $request ) {
	$body   = sml_lkd_signed_json( $request );
	$result = sml_lkd_upsert_link( $body['wp_user_id'] ?? 0, $body['discord_user_id'] ?? '', $body['discord_tag'] ?? '' );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$response = new WP_REST_Response( array_merge( array( 'ok' => true ), $result ), 200 );
	$response->header( 'Cache-Control', 'no-store, private' );
	return $response;
}

/** Verify a one-tap connect token; returns array( 'discord_user_id', 'discord_tag', 'nonce' ) or null. */
function sml_lkd_verify_connect_token( $token ) {
	$secret = sml_lkd_bridge_secret();
	$parts  = explode( '.', (string) $token );
	if ( strlen( $secret ) < 32 || 3 !== count( $parts ) || 'v1' !== $parts[0] || ! preg_match( '/^[a-f0-9]{64}$/', $parts[2] ) || ! preg_match( '/^[A-Za-z0-9_-]{10,600}$/', $parts[1] ) ) {
		return null;
	}
	$expected = hash_hmac( 'sha256', 'lk-connect.' . $parts[1], $secret );
	if ( ! hash_equals( $expected, $parts[2] ) ) {
		return null;
	}
	$claims = json_decode( base64_decode( strtr( $parts[1], '-_', '+/' ) ), true );
	if ( ! is_array( $claims ) || ! preg_match( '/^\d{15,24}$/', (string) ( $claims['d'] ?? '' ) ) || (int) ( $claims['e'] ?? 0 ) <= time() ) {
		return null;
	}
	return array(
		'discord_user_id' => (string) $claims['d'],
		'discord_tag'     => (string) ( $claims['t'] ?? '' ),
		'nonce'           => (string) ( $claims['n'] ?? '' ),
	);
}

/**
 * /connect-discord/?lk=<token>: finish the connection for a member who arrived from the Academy.
 * Signed-out visitors log in or register first (WordPress brings them back to this URL). The nonce is
 * burned on use with the same INSERT IGNORE family as request signatures, so a copied link cannot be
 * replayed; its 10-minute life ends before the hourly sweep can free the row.
 */
function sml_lkd_connect_page_link() {
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || empty( $_GET['lk'] ) ) {
		return;
	}
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	if ( ! preg_match( '#/' . preg_quote( SML_LKD_CONNECT_PATH, '#' ) . '/?(?:\?|$)#', $uri ) ) {
		return;
	}
	$token  = (string) wp_unslash( $_GET['lk'] );
	$claims = sml_lkd_verify_connect_token( $token );
	$target = home_url( '/' . SML_LKD_CONNECT_PATH . '/' );
	if ( ! $claims ) {
		wp_safe_redirect( add_query_arg( 'lk_error', 'expired', $target ) );
		exit;
	}
	if ( ! is_user_logged_in() ) {
		auth_redirect();
	}
	global $wpdb;
	$burned = $wpdb->query( $wpdb->prepare(
		"INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'no')",
		'sml_lkd_seen_' . substr( hash( 'sha256', 'lk-connect.' . $claims['nonce'] . '.' . $claims['discord_user_id'] ), 0, 40 ),
		(string) time()
	) );
	if ( 1 !== (int) $burned ) {
		wp_safe_redirect( add_query_arg( 'lk_error', 'used', $target ) );
		exit;
	}
	$result = sml_lkd_upsert_link( get_current_user_id(), $claims['discord_user_id'], $claims['discord_tag'] );
	if ( is_wp_error( $result ) ) {
		wp_safe_redirect( add_query_arg( 'lk_error', 'sml_lkd_discord_already_linked' === $result->get_error_code() ? 'taken' : 'failed', $target ) );
		exit;
	}
	wp_safe_redirect( add_query_arg( 'lk_done', '1', $target ) );
	exit;
}
add_action( 'template_redirect', 'sml_lkd_connect_page_link', 1 );

/* the connect page (site-access snippet) shows the outcome of a one-tap link above its own content */
add_action( 'wp_body_open', static function () {
	if ( is_admin() || ( empty( $_GET['lk_done'] ) && empty( $_GET['lk_error'] ) ) ) {
		return;
	}
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	if ( ! preg_match( '#/' . preg_quote( SML_LKD_CONNECT_PATH, '#' ) . '/?(?:\?|$)#', $uri ) ) {
		return;
	}
	$messages = array(
		'done'    => 'Discord connected. Go back to Discord and tap LOOP-KICK in the Academy — it is ready.',
		'expired' => 'That connect link expired. Open the Academy in Discord, tap LOOP-KICK and choose Connect again.',
		'used'    => 'That connect link was already used. If LOOP-KICK still asks you to connect, open it again in the Academy and choose Connect.',
		'taken'   => 'That Discord account is already connected to a different StockMarketLoop account. Disconnect it there first.',
		'failed'  => 'The connection could not be saved. Please try again from the Academy.',
	);
	$key = ! empty( $_GET['lk_done'] ) ? 'done' : sanitize_key( (string) wp_unslash( $_GET['lk_error'] ) );
	if ( ! isset( $messages[ $key ] ) ) {
		return;
	}
	$ok = 'done' === $key;
	echo '<div style="max-width:760px;margin:18px auto 0;padding:14px 18px;border-radius:12px;font:600 15px/1.5 system-ui,sans-serif;color:' . ( $ok ? '#04170d' : '#fff' ) . ';background:' . ( $ok ? '#22d97a' : '#7a2634' ) . '">' . esc_html( $messages[ $key ] ) . '</div>';
} );

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
	register_rest_route( 'sml-loop-kick/v1', '/discord-link', array(
		'methods'             => 'POST',
		'permission_callback' => static function ( WP_REST_Request $request ) {
			return sml_lkd_verify_signed( $request, sml_lkd_bridge_secret(), 'x-sml-lk-timestamp', 'x-sml-lk-signature' );
		},
		'callback'            => 'sml_lkd_rest_discord_link',
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
