<?php
/**
 * Continue with Google for stockmarketloop.com (not the Academy).
 *
 * The browser shows Google's own button (Google Identity Services) and hands this site a signed ID token. The site checks the
 * token itself: Google's published signing keys, the issuer, the audience (this site's client id), the expiry, a single-use nonce
 * the site issued a moment ago (so a stolen token cannot be replayed), and that Google vouches for the email. Then it signs the
 * member in, or creates the account the way the Discord sign-up does (the login name is the handle; the email counts as verified
 * because Google verified it). No client secret is needed.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

/* This site's Google client id (public). It is the one Site Kit's Sign in with Google already uses, so its authorized origin
   https://stockmarketloop.com is already registered with Google. */
if ( ! defined( 'SMLX_GOOGLE_CLIENT_ID' ) ) {
	define( 'SMLX_GOOGLE_CLIENT_ID', '1059456933795-grqif18gru4imnb0osb901b4q0u322pj.apps.googleusercontent.com' );
}

/* ---------- the token: pure functions, no WordPress ---------- */
function smlx_b64u( $s ) { return base64_decode( strtr( (string) $s, '-_', '+/' ) . str_repeat( '=', ( 4 - strlen( (string) $s ) % 4 ) % 4 ) ); }
function smlx_der_len( $n ) { if ( $n < 128 ) { return chr( $n ); } $b = ltrim( pack( 'N', $n ), "\0" ); return chr( 0x80 | strlen( $b ) ) . $b; }
function smlx_der_int( $b ) { if ( $b === '' || ( ord( $b[0] ) & 0x80 ) ) { $b = "\0" . $b; } return "\x02" . smlx_der_len( strlen( $b ) ) . $b; }
/* an RSA public key (modulus and exponent, base64url) as the PEM openssl_verify wants */
function smlx_jwk_pem( $n, $e ) {
	$rsa  = smlx_der_int( smlx_b64u( $n ) ) . smlx_der_int( smlx_b64u( $e ) );
	$seq  = "\x30" . smlx_der_len( strlen( $rsa ) ) . $rsa;
	$bits = "\x03" . smlx_der_len( strlen( $seq ) + 1 ) . "\0" . $seq;
	$algo = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";
	$spki = "\x30" . smlx_der_len( strlen( $algo . $bits ) ) . $algo . $bits;
	return "-----BEGIN PUBLIC KEY-----\n" . chunk_split( base64_encode( $spki ), 64, "\n" ) . "-----END PUBLIC KEY-----\n";
}

/**
 * Check a Google ID token. $jwks is Google's key set ({"keys":[{kid,n,e,...}]}). Returns array( 'ok' => true, 'claims' => [...] )
 * or array( 'ok' => false, 'code' => ... ). $now is injectable for tests.
 */
function smlx_google_verify( $jwt, $client_id, $jwks, $now = null ) {
	$now   = $now ?: time();
	$parts = explode( '.', (string) $jwt );
	if ( count( $parts ) !== 3 || strlen( $jwt ) > 4096 ) { return array( 'ok' => false, 'code' => 'malformed' ); }
	$head   = json_decode( smlx_b64u( $parts[0] ), true );
	$claims = json_decode( smlx_b64u( $parts[1] ), true );
	$sig    = smlx_b64u( $parts[2] );
	if ( ! is_array( $head ) || ! is_array( $claims ) || $sig === '' ) { return array( 'ok' => false, 'code' => 'malformed' ); }
	if ( ( $head['alg'] ?? '' ) !== 'RS256' || empty( $head['kid'] ) ) { return array( 'ok' => false, 'code' => 'bad_alg' ); }
	$key = null;
	foreach ( (array) ( $jwks['keys'] ?? array() ) as $k ) { if ( ( $k['kid'] ?? '' ) === $head['kid'] && ( $k['kty'] ?? '' ) === 'RSA' ) { $key = $k; break; } }
	if ( ! $key ) { return array( 'ok' => false, 'code' => 'unknown_key' ); }
	$pub = openssl_pkey_get_public( smlx_jwk_pem( $key['n'], $key['e'] ) );
	if ( ! $pub || openssl_verify( $parts[0] . '.' . $parts[1], $sig, $pub, OPENSSL_ALGO_SHA256 ) !== 1 ) { return array( 'ok' => false, 'code' => 'bad_signature' ); }
	if ( ! in_array( $claims['iss'] ?? '', array( 'accounts.google.com', 'https://accounts.google.com' ), true ) ) { return array( 'ok' => false, 'code' => 'bad_issuer' ); }
	if ( ( $claims['aud'] ?? '' ) !== $client_id ) { return array( 'ok' => false, 'code' => 'bad_audience' ); }
	if ( (int) ( $claims['exp'] ?? 0 ) < $now - 30 ) { return array( 'ok' => false, 'code' => 'expired' ); }
	if ( (int) ( $claims['iat'] ?? 0 ) > $now + 120 ) { return array( 'ok' => false, 'code' => 'bad_time' ); }
	if ( empty( $claims['sub'] ) || ! is_string( $claims['sub'] ) ) { return array( 'ok' => false, 'code' => 'no_subject' ); }
	return array( 'ok' => true, 'claims' => $claims );
}

/* ---------- WordPress side ---------- */
function smlx_google_jwks( $force = false ) {
	$cached = $force ? false : get_transient( 'smlx_google_jwks' );
	if ( is_array( $cached ) && ! empty( $cached['keys'] ) ) { return $cached; }
	$res = wp_remote_get( 'https://www.googleapis.com/oauth2/v3/certs', array( 'timeout' => 8 ) );
	if ( is_wp_error( $res ) || (int) wp_remote_retrieve_response_code( $res ) !== 200 ) { return is_array( $cached ) ? $cached : array(); }
	$body = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( ! is_array( $body ) || empty( $body['keys'] ) ) { return array(); }
	set_transient( 'smlx_google_jwks', $body, 6 * HOUR_IN_SECONDS );
	return $body;
}

function smlx_google_ip() { return isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : ''; }

/* A page-load nonce, single use: the token Google signs must carry it, so a token that leaks cannot be played back later. */
function smlx_google_rest_nonce( WP_REST_Request $request ) {
	$n = wp_generate_password( 32, false );
	set_transient( 'smlx_gn_' . hash( 'sha256', $n ), 1, 10 * MINUTE_IN_SECONDS );
	$r = new WP_REST_Response( array( 'nonce' => $n ), 200 );
	$r->header( 'Cache-Control', 'no-store, private' );
	return $r;
}

function smlx_google_username( $name, $email ) {
	$base = sanitize_user( strtolower( preg_replace( '/[^a-z0-9._]/i', '', (string) $name ) ), true );
	if ( strlen( $base ) < 3 ) { $base = sanitize_user( strtolower( preg_replace( '/[^a-z0-9._]/i', '', (string) strstr( (string) $email, '@', true ) ) ), true ); }
	if ( strlen( $base ) < 3 ) { $base = 'member'; }
	$base = substr( $base, 0, 28 );
	$user = $base;
	for ( $i = 1; username_exists( $user ); $i++ ) { $user = $base . $i; }
	return $user;
}

/* Map verified Google claims to a site user: by Google id, then by a verified email; otherwise a new account. */
function smlx_google_resolve( $claims ) {
	$sub   = (string) $claims['sub'];
	$email = sanitize_email( (string) ( $claims['email'] ?? '' ) );
	$name  = sanitize_text_field( (string) ( $claims['name'] ?? '' ) );
	$found = get_users( array( 'meta_key' => 'sml_google_sub', 'meta_value' => $sub, 'number' => 1, 'fields' => 'ID' ) );
	if ( $found ) { return array( 'uid' => (int) $found[0], 'created' => false ); }
	if ( ! $email || ! is_email( $email ) ) { return new WP_Error( 'google_no_email', 'Google did not share an email address.', array( 'status' => 400 ) ); }
	if ( empty( $claims['email_verified'] ) || ( $claims['email_verified'] !== true && $claims['email_verified'] !== 'true' ) ) {
		return new WP_Error( 'google_email_unverified', 'Google has not verified that email address.', array( 'status' => 403 ) );
	}
	$existing = get_user_by( 'email', $email );
	if ( $existing ) {
		/* both sides must have verified the address: Google, and the site (an account pre-registered with this email and a password nobody
		   confirmed must not be handed to whoever signs in with Google) */
		if ( '1' !== (string) get_user_meta( $existing->ID, 'sml_email_verified', true ) ) {
			return new WP_Error( 'email_unverified_existing', 'An account with this email already exists. Log in with your email and password to use it.', array( 'status' => 409, 'email' => $email ) );
		}
		update_user_meta( $existing->ID, 'sml_google_sub', $sub );
		return array( 'uid' => (int) $existing->ID, 'created' => false );
	}
	$login = smlx_google_username( $name, $email );
	$uid   = wp_insert_user( array( 'user_login' => $login, 'user_email' => $email, 'user_pass' => wp_generate_password( 32, true, true ), 'display_name' => $name ?: $login, 'nickname' => $name ?: $login, 'role' => get_option( 'default_role', 'subscriber' ) ) );
	if ( is_wp_error( $uid ) ) { return new WP_Error( 'google_create_failed', 'We could not create the account. Try signing up with your email.', array( 'status' => 500 ) ); }
	update_user_meta( $uid, 'sml_google_sub', $sub );
	update_user_meta( $uid, 'sml_signup_via', 'google' );
	update_user_meta( $uid, 'sml_google_signup_at', gmdate( 'c' ) );
	update_user_meta( $uid, 'sml_email_verified', '1' );
	update_user_meta( $uid, 'sml_email_verified_via', 'google' );
	do_action( 'sml_auth_google_registered', $uid, $sub );
	return array( 'uid' => (int) $uid, 'created' => true );
}

function smlx_google_rest_signin( WP_REST_Request $request ) {
	/* a few tries a minute per address: this is a login endpoint */
	$rl = 'smlx_g_rl_' . md5( smlx_google_ip() ); $n = (int) get_transient( $rl );
	if ( $n >= 20 ) { return new WP_Error( 'rate_limited', 'Too many attempts. Wait a minute and try again.', array( 'status' => 429 ) ); }
	set_transient( $rl, $n + 1, 10 * MINUTE_IN_SECONDS );

	$jwt  = (string) $request->get_param( 'credential' );
	$jwks = smlx_google_jwks();
	if ( ! $jwks ) { return new WP_Error( 'google_unavailable', 'Google sign-in is not reachable right now. Try again, or use your email.', array( 'status' => 503 ) ); }
	$check = smlx_google_verify( $jwt, SMLX_GOOGLE_CLIENT_ID, $jwks );
	if ( ! $check['ok'] && $check['code'] === 'unknown_key' ) { $check = smlx_google_verify( $jwt, SMLX_GOOGLE_CLIENT_ID, smlx_google_jwks( true ) ); } // Google rotated its keys
	if ( ! $check['ok'] ) { return new WP_Error( 'google_invalid', 'That Google sign-in could not be verified. Try again.', array( 'status' => 401 ) ); }
	$claims = $check['claims'];

	$nonce = isset( $claims['nonce'] ) ? (string) $claims['nonce'] : '';
	$key   = 'smlx_gn_' . hash( 'sha256', $nonce );
	if ( $nonce === '' || ! get_transient( $key ) ) { return new WP_Error( 'google_stale', 'That Google sign-in expired. Try again.', array( 'status' => 401 ) ); }
	delete_transient( $key );

	$who = smlx_google_resolve( $claims );
	if ( is_wp_error( $who ) ) { return $who; }
	$user = get_userdata( $who['uid'] );
	if ( ! $user ) { return new WP_Error( 'google_create_failed', 'We could not find that account.', array( 'status' => 500 ) ); }

	wp_set_current_user( $user->ID );
	wp_set_auth_cookie( $user->ID, true );
	do_action( 'wp_login', $user->user_login, $user );

	$to = (string) $request->get_param( 'return_to' );
	$to = ( $to !== '' && 0 === strpos( $to, home_url( '/' ) ) ) ? $to : home_url( '/' );
	$r  = new WP_REST_Response( array( 'ok' => true, 'created' => $who['created'], 'redirect' => $to ), 200 );
	$r->header( 'Cache-Control', 'no-store, private' );
	return $r;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-auth/v1', '/google-nonce', array( 'methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => 'smlx_google_rest_nonce' ) );
	register_rest_route( 'sml-auth/v1', '/google', array( 'methods' => 'POST', 'permission_callback' => '__return_true', 'callback' => 'smlx_google_rest_signin' ) );
} );
