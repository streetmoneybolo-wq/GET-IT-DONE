<?php
/**
 * Plugin Name: SML LOOP-KICK Connect
 * Description: One-tap LOOP-KICK ↔ Discord connection for the Making Easy Money Academy, and sign-up with Discord (the signed /discord-register route creates or matches the member's account from the email Discord shares, marks it verified when Discord already verified it, links the Discord id, and hands back a one-time sign-in link). Adds the signed /wp-json/sml-loop-kick/v1/discord-link route (called by sml-platform-api after the member signed in with their site password) and the /connect-discord/?lk= one-tap link handler. Add-on to the SML LOOP-KICK Discord Bridge mu-plugin 1.1.0: it reuses that plugin's signature checks and secret, and steps aside automatically once the bridge itself ships these routes (1.2.0+).
 * Version: 1.1.1
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* mu-plugins load first: when the bridge already carries the connect routes, this add-on does nothing. */
if ( function_exists( 'sml_lkd_rest_discord_link' ) || function_exists( 'sml_lkd_connect_page_link' ) ) {
	return;
}
/* and without the bridge's HMAC helpers there is nothing safe to register */
if ( ! function_exists( 'sml_lkd_verify_signed' ) || ! function_exists( 'sml_lkd_bridge_secret' ) || ! function_exists( 'sml_lkd_signed_json' ) ) {
	return;
}

if ( ! defined( 'SML_LKC_CONNECT_PATH' ) ) {
	define( 'SML_LKC_CONNECT_PATH', 'connect-discord' );
}

/* ---------- Discord ↔ member link (no code, no slash command) ---------- */

function sml_lkc_links_table() {
	global $wpdb;
	return $wpdb->prefix . 'sml_discord_site_links';
}

/**
 * Store (or move) the link for a member. Mirrors sml_drs_rest_bot_link in the site-access snippet:
 * one Discord account belongs to one member (409 otherwise); a member's existing link is replaced.
 * Returns array( 'linked' => true, 'user_id' => int, 'verified' => bool ) or WP_Error.
 */
function sml_lkc_upsert_link( $user_id, $discord_user_id, $discord_tag = '' ) {
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
	$table = sml_lkc_links_table();
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
function sml_lkc_rest_discord_link( WP_REST_Request $request ) {
	$body   = sml_lkd_signed_json( $request );
	$result = sml_lkc_upsert_link( $body['wp_user_id'] ?? 0, $body['discord_user_id'] ?? '', $body['discord_tag'] ?? '' );
	if ( is_wp_error( $result ) ) {
		return $result;
	}
	$response = new WP_REST_Response( array_merge( array( 'ok' => true ), $result ), 200 );
	$response->header( 'Cache-Control', 'no-store, private' );
	return $response;
}

/** Verify a one-tap connect token; returns array( 'discord_user_id', 'discord_tag', 'nonce' ) or null. */
function sml_lkc_verify_connect_token( $token ) {
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
function sml_lkc_connect_page_link() {
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || empty( $_GET['lk'] ) ) {
		return;
	}
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	if ( ! preg_match( '#/' . preg_quote( SML_LKC_CONNECT_PATH, '#' ) . '/?(?:\?|$)#', $uri ) ) {
		return;
	}
	$token  = (string) wp_unslash( $_GET['lk'] );
	$claims = sml_lkc_verify_connect_token( $token );
	$target = home_url( '/' . SML_LKC_CONNECT_PATH . '/' );
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
	$result = sml_lkc_upsert_link( get_current_user_id(), $claims['discord_user_id'], $claims['discord_tag'] );
	if ( is_wp_error( $result ) ) {
		wp_safe_redirect( add_query_arg( 'lk_error', 'sml_lkd_discord_already_linked' === $result->get_error_code() ? 'taken' : 'failed', $target ) );
		exit;
	}
	wp_safe_redirect( add_query_arg( 'lk_done', '1', $target ) );
	exit;
}
add_action( 'template_redirect', 'sml_lkc_connect_page_link', 1 );

/* the connect page (site-access snippet) shows the outcome of a one-tap link above its own content */
add_action( 'wp_body_open', static function () {
	if ( is_admin() || ( empty( $_GET['lk_done'] ) && empty( $_GET['lk_error'] ) ) ) {
		return;
	}
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	if ( ! preg_match( '#/' . preg_quote( SML_LKC_CONNECT_PATH, '#' ) . '/?(?:\?|$)#', $uri ) ) {
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

/* ---------- sign up with Discord ----------
 * sml-platform-api signs the member in with Discord (identify + email) and calls /discord-register with what Discord shared.
 *   - a Discord id that is already linked: that member, nothing created
 *   - an email that already belongs to a member: linked to that member, but only when Discord has verified the email
 *     (Discord's verification is as good as our own code: the member proved they own that mailbox)
 *   - otherwise a new member is created with a random password; the email is marked verified when Discord verified it
 * The answer carries a one-time sign-in link (10 minutes, single use) so the member lands on the site signed in. */
function sml_lkc_find_by_discord( $discord_user_id ) {
	global $wpdb;
	$table = sml_lkc_links_table();
	if ( (string) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
		return 0;
	}
	return (int) $wpdb->get_var( $wpdb->prepare( "SELECT user_id FROM {$table} WHERE discord_user_id=%s", $discord_user_id ) );
}

function sml_lkc_username_for( $name, $email ) {
	$base = sanitize_user( strtolower( preg_replace( '/[^a-z0-9._-]/i', '', (string) $name ) ), true );
	if ( strlen( $base ) < 3 ) {
		$base = sanitize_user( strtolower( (string) strstr( (string) $email, '@', true ) ), true );
	}
	if ( strlen( $base ) < 3 ) {
		$base = 'member';
	}
	$base = substr( $base, 0, 40 );
	$user = $base;
	$i    = 1;
	while ( username_exists( $user ) ) {
		$user = $base . $i++;
	}
	return $user;
}

/** A one-time sign-in link for a member (10 minutes, single use), landing on $to when it is on this site. */
function sml_lkc_login_link( $user_id, $to = '' ) {
	$token = wp_generate_password( 40, false );
	set_transient( 'sml_lkc_login_' . hash( 'sha256', $token ), array( 'u' => (int) $user_id, 'to' => (string) $to ), 10 * MINUTE_IN_SECONDS );
	return add_query_arg( 'sml_lkc_login', $token, home_url( '/' ) );
}

add_action( 'init', static function () {
	if ( is_admin() || empty( $_GET['sml_lkc_login'] ) ) {
		return;
	}
	$token = (string) wp_unslash( $_GET['sml_lkc_login'] );
	if ( ! preg_match( '/^[A-Za-z0-9]{40}$/', $token ) ) {
		return;
	}
	$key = 'sml_lkc_login_' . hash( 'sha256', $token );
	$row = get_transient( $key );
	if ( ! is_array( $row ) ) {
		wp_safe_redirect( add_query_arg( 'sml_login', 'expired', home_url( '/' ) ) );
		exit;
	}
	delete_transient( $key );
	$user = get_userdata( (int) $row['u'] );
	if ( ! $user ) {
		return;
	}
	wp_set_current_user( $user->ID );
	wp_set_auth_cookie( $user->ID, true );
	do_action( 'wp_login', $user->user_login, $user );
	$to = (string) ( $row['to'] ?? '' );
	wp_safe_redirect( $to && 0 === strpos( $to, home_url( '/' ) ) ? $to : home_url( '/members/' . $user->ID . '/' ) );
	exit;
}, 1 );

function sml_lkc_rest_discord_register( WP_REST_Request $request ) {
	$body           = sml_lkd_signed_json( $request );
	$discord_id     = preg_replace( '/\D/', '', (string) ( $body['discord_user_id'] ?? '' ) );
	$tag            = sanitize_text_field( (string) ( $body['discord_tag'] ?? '' ) );
	$email          = sanitize_email( (string) ( $body['email'] ?? '' ) );
	$email_verified = ! empty( $body['email_verified'] );
	$name           = sanitize_text_field( (string) ( $body['name'] ?? '' ) );
	if ( ! preg_match( '/^\d{15,24}$/', $discord_id ) ) {
		return new WP_Error( 'sml_lkd_bad_discord_id', 'A Discord user id is required.', array( 'status' => 400 ) );
	}
	$table = sml_lkc_links_table();
	global $wpdb;
	if ( (string) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) {
		return new WP_Error( 'sml_lkd_links_missing', 'Discord linking is not set up on this site.', array( 'status' => 503 ) );
	}
	$uid     = sml_lkc_find_by_discord( $discord_id );
	$created = false;
	$matched = false;
	if ( ! $uid ) {
		if ( ! $email || ! is_email( $email ) ) {
			return new WP_Error( 'sml_lkc_email_required', 'Discord shared no email address for this account.', array( 'status' => 400 ) );
		}
		$existing = get_user_by( 'email', $email );
		if ( $existing ) {
			/* both sides must have verified the address: Discord (the member owns the mailbox) and the site (the account was not pre-registered
			 * with someone else's email and an unverified password). Otherwise the member signs in with the password and connects Discord. */
			if ( ! $email_verified || '1' !== (string) get_user_meta( $existing->ID, 'sml_email_verified', true ) ) {
				return new WP_Error( 'sml_lkc_email_unverified', 'An account with this email already exists. Sign in with your password to connect Discord to it.', array( 'status' => 409 ) );
			}
			$uid     = (int) $existing->ID;
			$matched = true;
		} else {
			$username = sml_lkc_username_for( $name, $email );
			$uid      = wp_insert_user( array(
				'user_login'   => $username,
				'user_email'   => $email,
				'user_pass'    => wp_generate_password( 32, true, true ),
				'display_name' => $name ?: $username,
				'nickname'     => $name ?: $username,
				'role'         => get_option( 'default_role', 'subscriber' ),
			) );
			if ( is_wp_error( $uid ) ) {
				return $uid;
			}
			$created = true;
			update_user_meta( $uid, 'sml_signup_via', 'discord' );
			update_user_meta( $uid, 'sml_discord_signup_at', gmdate( 'c' ) );
			do_action( 'sml_lkc_discord_registered', $uid, $discord_id );
		}
		$link = sml_lkc_upsert_link( $uid, $discord_id, $tag );
		if ( is_wp_error( $link ) ) {
			return $link;
		}
	}
	if ( $email_verified && '1' !== (string) get_user_meta( $uid, 'sml_email_verified', true ) ) {
		update_user_meta( $uid, 'sml_email_verified', '1' );
		update_user_meta( $uid, 'sml_email_verified_via', 'discord' );
	}
	$user     = get_userdata( $uid );
	$response = new WP_REST_Response( array(
		'ok'          => true,
		'created'     => $created,
		'matched'     => $matched,
		'linked'      => true,
		'user_id'     => $uid,
		'handle'      => $user ? $user->user_login : '',
		'verified'    => '1' === (string) get_user_meta( $uid, 'sml_email_verified', true ),
		'login_url'   => sml_lkc_login_link( $uid, (string) ( $body['return_to'] ?? '' ) ),
		'profile_url' => home_url( '/members/' . $uid . '/' ),
	), 200 );
	$response->header( 'Cache-Control', 'no-store, private' );
	return $response;
}

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml-loop-kick/v1', '/discord-link', array(
		'methods'             => 'POST',
		'permission_callback' => static function ( WP_REST_Request $request ) {
			return sml_lkd_verify_signed( $request, sml_lkd_bridge_secret(), 'x-sml-lk-timestamp', 'x-sml-lk-signature' );
		},
		'callback'            => 'sml_lkc_rest_discord_link',
	) );
	register_rest_route( 'sml-loop-kick/v1', '/discord-register', array(
		'methods'             => 'POST',
		'permission_callback' => static function ( WP_REST_Request $request ) {
			return sml_lkd_verify_signed( $request, sml_lkd_bridge_secret(), 'x-sml-lk-timestamp', 'x-sml-lk-signature' );
		},
		'callback'            => 'sml_lkc_rest_discord_register',
	) );
} );
