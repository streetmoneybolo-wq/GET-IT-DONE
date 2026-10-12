<?php
/**
 * Plugin Name: SML App Identity
 * Description: Lets sml-platform-api sign a member into the StockMarketLoop phone app with their stockmarketloop.com account. HMAC-guarded (the same LOOP-KICK bridge secret and signature as the Academy wallet), three signed server-to-server routes: login (username or email + password, plus the member's two-step code when two-step sign-in is on), me (profile, groups, wallet) and proxy (one allow-listed site REST route run as that member). No browser ever calls these routes; the phone talks to the platform API only.
 * Version: 1.1.0
 * Author: StockMarketLoop
 * Requires PHP: 7.4
 *
 * Depends on mu-plugins/sml-loop-kick-discord.php (sml_lkd_verify_signed / sml_lkd_signed_json / sml_lkd_bridge_secret).
 * Without it every route fails closed (503).
 *
 * Outbound: sml_app_push( $user_ids, $message ) asks the platform to push to those members' app devices
 * (POST /v1/app/push/send, signed with the billing API secret like the alert router). Also reachable as
 * do_action( 'sml_app_push', $user_ids, $message ). $message = ['title','body','url','data','collapseId','ttl'].
 *
 * Site hooks (all optional):
 *   apply_filters( 'sml_academy_user_two_step', null, $user_id )            true/false when a 2FA system says so (shared with the wallet)
 *   apply_filters( 'sml_app_two_step_method', null, $user )                 'totp' | 'email' | 'backup' when a 2FA system knows how it verifies
 *   apply_filters( 'sml_app_two_step_verify', null, $user, $code )          true/false from a 2FA system; null falls through to Two Factor / email code
 *   apply_filters( 'sml_app_two_step_send', null, $user )                   true when a 2FA system sent its own code
 *   apply_filters( 'sml_app_member_groups', array(), $user_id )             [{id, name, role}] the groups this member is in
 *   apply_filters( 'sml_app_member_profile', $profile, $user )              add fields to the member payload
 *   apply_filters( 'sml_app_proxy_allow', $allowed, $route, $user_id )      widen or narrow the proxy allow list
 *   do_action( 'sml_app_login', $user, $device )                            a member just signed into the app
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_APP_IDENTITY_VERSION', '1.1.0' );

/* ---------- outbound: push to members' app devices ---------- */

/**
 * Push one message to the app devices of the given members. Fire-and-forget by default (non-blocking HTTP);
 * pass $blocking = true to get the platform's counts back. Returns WP_Error when unconfigured.
 */
function sml_app_push( $user_ids, array $message, $blocking = false ) {
	$secret = defined( 'SML_PLATFORM_BILLING_API_SECRET' ) ? trim( (string) SML_PLATFORM_BILLING_API_SECRET ) : '';
	$base   = defined( 'SML_PLATFORM_API_URL' ) ? untrailingslashit( (string) SML_PLATFORM_API_URL ) : 'https://sml-platform-api.onrender.com';
	if ( '' === $secret ) { return new WP_Error( 'sml_app_push_unconfigured', 'Platform API secret is not configured.' ); }
	$ids = array_values( array_unique( array_filter( array_map( 'absint', (array) $user_ids ) ) ) );
	if ( ! $ids ) { return new WP_Error( 'sml_app_push_nobody', 'No members to push to.' ); }
	$clean = array();
	foreach ( array( 'title', 'body', 'url', 'collapseId', 'channelId', 'category', 'sound' ) as $k ) { if ( isset( $message[ $k ] ) && is_scalar( $message[ $k ] ) ) { $clean[ $k ] = (string) $message[ $k ]; } }
	if ( isset( $message['ttl'] ) ) { $clean['ttl'] = absint( $message['ttl'] ); }
	if ( isset( $message['badge'] ) ) { $clean['badge'] = absint( $message['badge'] ); }
	if ( isset( $message['data'] ) && is_array( $message['data'] ) ) { $clean['data'] = array_map( 'strval', array_filter( $message['data'], 'is_scalar' ) ); }
	if ( '' === trim( (string) ( $clean['title'] ?? '' ) ) && '' === trim( (string) ( $clean['body'] ?? '' ) ) ) { return new WP_Error( 'sml_app_push_empty', 'A push needs a title or a body.' ); }
	$out = array();
	foreach ( array_chunk( $ids, 500 ) as $chunk ) {
		$body      = wp_json_encode( array( 'userIds' => $chunk, 'message' => $clean ) );
		$timestamp = (string) time();
		$response  = wp_remote_post( $base . '/v1/app/push/send', array(
			'timeout'  => $blocking ? 20 : 3,
			'blocking' => (bool) $blocking,
			'headers'  => array(
				'Content-Type'    => 'application/json',
				'X-SML-Timestamp' => $timestamp,
				'X-SML-Signature' => hash_hmac( 'sha256', $timestamp . '.' . $body, $secret ),
			),
			'body'     => $body,
		) );
		if ( $blocking ) {
			if ( is_wp_error( $response ) ) { return $response; }
			$decoded = json_decode( wp_remote_retrieve_body( $response ), true );
			$out[]   = is_array( $decoded ) ? $decoded : array( 'ok' => false, 'status' => wp_remote_retrieve_response_code( $response ) );
		}
	}
	return $blocking ? $out : true;
}
add_action( 'sml_app_push', static function ( $user_ids, $message ) { if ( is_array( $message ) ) { sml_app_push( $user_ids, $message ); } }, 10, 2 );

function sml_app_ready() {
	return function_exists( 'sml_lkd_verify_signed' ) && function_exists( 'sml_lkd_signed_json' ) && function_exists( 'sml_lkd_bridge_secret' );
}

/** Marks the current request as app traffic so other plugins (rate limiters, nonce checks, analytics) can tell. */
function sml_app_mark_request() {
	if ( ! defined( 'SML_APP_REQUEST' ) ) { define( 'SML_APP_REQUEST', true ); }
	add_filter( 'sml_is_app_request', '__return_true' );
}

function sml_app_error( $code, $status, $extra = array() ) {
	return new WP_REST_Response( array_merge( array( 'ok' => false, 'error' => $code ), $extra ), $status );
}

/* ---------- two-step ---------- */

/** true / false. Fails closed: no signal means NOT enabled. Same rules as the Academy wallet. */
function sml_app_two_step_enabled( $user_id ) {
	$hint = apply_filters( 'sml_academy_user_two_step', null, $user_id );
	if ( null !== $hint ) { return (bool) $hint; }
	if ( class_exists( 'Two_Factor_Core' ) && is_callable( array( 'Two_Factor_Core', 'is_user_using_two_factor' ) ) ) {
		return (bool) Two_Factor_Core::is_user_using_two_factor( $user_id );
	}
	return '1' === (string) get_user_meta( $user_id, 'sml_two_step_enabled', true );
}

/** How this member's second step is verified: 'totp' (an authenticator app), 'email' (a code we send), 'backup'. */
function sml_app_two_step_method( $user ) {
	$hint = apply_filters( 'sml_app_two_step_method', null, $user );
	if ( is_string( $hint ) && '' !== $hint ) { return sanitize_key( $hint ); }
	if ( class_exists( 'Two_Factor_Core' ) && is_callable( array( 'Two_Factor_Core', 'get_primary_provider_for_user' ) ) ) {
		$provider = Two_Factor_Core::get_primary_provider_for_user( $user->ID );
		if ( $provider instanceof Two_Factor_Provider || is_object( $provider ) ) {
			$class = get_class( $provider );
			if ( false !== stripos( $class, 'Totp' ) ) { return 'totp'; }
			if ( false !== stripos( $class, 'Email' ) ) { return 'email'; }
			if ( false !== stripos( $class, 'Backup' ) ) { return 'backup'; }
		}
	}
	if ( '' !== (string) get_user_meta( $user->ID, 'sml_two_step_totp_secret', true ) ) { return 'totp'; }
	return 'email';
}

/** Our own emailed one-time code (10 minutes, 5 attempts, one send a minute), used when no 2FA system supplies one. */
function sml_app_email_code_send( $user ) {
	$key = 'sml_app_2sv_' . (int) $user->ID;
	$existing = get_transient( $key );
	if ( is_array( $existing ) && isset( $existing['sent'] ) && time() - (int) $existing['sent'] < 60 ) {
		return true; // a code is already on its way; the member can enter it
	}
	try { $code = (string) random_int( 100000, 999999 ); } catch ( Exception $e ) { $code = (string) wp_rand( 100000, 999999 ); }
	set_transient( $key, array( 'hash' => wp_hash( $code . '|' . $user->ID ), 'sent' => time(), 'tries' => 0 ), 10 * MINUTE_IN_SECONDS );
	$site = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
	$body = sprintf( "Your %s sign-in code is: %s\n\nIt works for 10 minutes. If you did not just sign in on the %s app, change your password at %s.", $site, $code, $site, home_url( '/' ) );
	return (bool) wp_mail( $user->user_email, sprintf( '%s sign-in code: %s', $site, $code ), $body );
}

function sml_app_email_code_verify( $user, $code ) {
	$key = 'sml_app_2sv_' . (int) $user->ID;
	$entry = get_transient( $key );
	if ( ! is_array( $entry ) || empty( $entry['hash'] ) ) { return false; }
	if ( (int) ( $entry['tries'] ?? 0 ) >= 5 ) { delete_transient( $key ); return false; }
	$ok = hash_equals( (string) $entry['hash'], wp_hash( $code . '|' . $user->ID ) );
	if ( $ok ) { delete_transient( $key ); return true; }
	$entry['tries'] = (int) ( $entry['tries'] ?? 0 ) + 1;
	set_transient( $key, $entry, 10 * MINUTE_IN_SECONDS );
	return false;
}

/** Sends the second-step code when the method needs one sent. */
function sml_app_two_step_send( $user, $method ) {
	$hint = apply_filters( 'sml_app_two_step_send', null, $user );
	if ( null !== $hint ) { return (bool) $hint; }
	if ( 'email' !== $method ) { return true; } // authenticator apps and backup codes need nothing sent
	if ( class_exists( 'Two_Factor_Email' ) && method_exists( 'Two_Factor_Email', 'get_instance' ) ) {
		try {
			$provider = Two_Factor_Email::get_instance();
			if ( method_exists( $provider, 'generate_and_email_token' ) ) { $provider->generate_and_email_token( $user ); return true; }
		} catch ( Throwable $e ) { /* fall through to our own code */ }
	}
	return sml_app_email_code_send( $user );
}

/** true when $code is this member's valid second step. */
function sml_app_two_step_verify( $user, $code ) {
	$hint = apply_filters( 'sml_app_two_step_verify', null, $user, $code );
	if ( null !== $hint ) { return (bool) $hint; }
	if ( class_exists( 'Two_Factor_Core' ) ) {
		try {
			if ( class_exists( 'Two_Factor_Totp' ) && method_exists( 'Two_Factor_Totp', 'get_instance' ) ) {
				$totp = Two_Factor_Totp::get_instance();
				if ( method_exists( $totp, 'validate_code_for_user' ) && true === $totp->validate_code_for_user( $user, $code ) ) { return true; }
				if ( method_exists( $totp, 'is_valid_authcode' ) && defined( 'Two_Factor_Totp::SECRET_META_KEY' ) ) {
					$secret = (string) get_user_meta( $user->ID, Two_Factor_Totp::SECRET_META_KEY, true );
					if ( '' !== $secret && true === $totp->is_valid_authcode( $secret, $code ) ) { return true; }
				}
			}
			if ( class_exists( 'Two_Factor_Email' ) && method_exists( 'Two_Factor_Email', 'get_instance' ) ) {
				$email = Two_Factor_Email::get_instance();
				if ( method_exists( $email, 'validate_token' ) && true === $email->validate_token( $user->ID, $code ) ) { return true; }
			}
			if ( class_exists( 'Two_Factor_Backup_Codes' ) && method_exists( 'Two_Factor_Backup_Codes', 'get_instance' ) ) {
				$backup = Two_Factor_Backup_Codes::get_instance();
				if ( method_exists( $backup, 'validate_code' ) && true === $backup->validate_code( $user, $code ) ) { return true; }
			}
		} catch ( Throwable $e ) { /* a provider that cannot answer is a failed check, never a pass */ }
	}
	return sml_app_email_code_verify( $user, $code );
}

/* ---------- the member payload ---------- */

function sml_app_handle( $user_id ) {
	foreach ( array( 'sml_members_public_handle', 'sml_members_handle' ) as $fn ) {
		if ( function_exists( $fn ) ) { $handle = (string) call_user_func( $fn, $user_id ); if ( '' !== $handle ) { return $handle; } }
	}
	return '';
}

function sml_app_profile( $user ) {
	$uid = (int) $user->ID;
	$profile = array(
		'id'            => $uid,
		'login'         => (string) $user->user_login,
		'email'         => (string) $user->user_email,
		'displayName'   => (string) $user->display_name,
		'handle'        => sml_app_handle( $uid ),
		'avatar'        => (string) get_avatar_url( $uid, array( 'size' => 192 ) ),
		'profileUrl'    => (string) get_author_posts_url( $uid ),
		'roles'         => array_values( array_map( 'strval', (array) $user->roles ) ),
		'registeredAt'  => (string) $user->user_registered,
		'emailVerified' => '1' === (string) get_user_meta( $uid, 'sml_email_verified', true ),
		'twoStep'       => array( 'enabled' => sml_app_two_step_enabled( $uid ) ),
	);
	return apply_filters( 'sml_app_member_profile', $profile, $user );
}

/** One internal REST GET run as the member, for the bundles in /me. Missing routes and errors come back as null. */
function sml_app_internal_get( $route, $query = array() ) {
	$request = new WP_REST_Request( 'GET', $route );
	if ( $query ) { $request->set_query_params( $query ); }
	$request->set_header( 'X-WP-Nonce', wp_create_nonce( 'wp_rest' ) );
	$response = rest_do_request( $request );
	if ( ! ( $response instanceof WP_REST_Response ) || $response->is_error() || $response->get_status() >= 400 ) { return null; }
	return rest_get_server()->response_to_data( $response, false );
}

function sml_app_member_payload( $user ) {
	$uid = (int) $user->ID;
	wp_set_current_user( $uid );
	$extras = array();
	foreach ( array( 'wallet' => '/sml-lb/v1/me', 'profile' => '/sml-members/v1/profile', 'loopBucks' => '/sml-members/v1/loop-bucks', 'groupKick' => '/sml-group-kick/v1/me', 'notifications' => '/sml-members/v1/notifications' ) as $key => $route ) {
		$extras[ $key ] = sml_app_internal_get( $route );
	}
	$groups = apply_filters( 'sml_app_member_groups', array(), $uid );
	return array(
		'ok'     => true,
		'user'   => sml_app_profile( $user ),
		'groups' => is_array( $groups ) ? array_values( $groups ) : array(),
		'wallet' => is_array( $extras['wallet'] ) ? $extras['wallet'] : null,
		'extras' => $extras,
		'asOf'   => time(),
	);
}

/* ---------- routes ---------- */

function sml_app_permission( WP_REST_Request $request ) {
	if ( ! sml_app_ready() ) { return new WP_Error( 'sml_app_unavailable', 'App identity unavailable.', array( 'status' => 503 ) ); }
	return sml_lkd_verify_signed( $request, sml_lkd_bridge_secret(), 'x-sml-lk-timestamp', 'x-sml-lk-signature' );
}

function sml_app_login_failures( $login ) { return (int) get_transient( 'sml_app_lf_' . md5( strtolower( $login ) ) ); }
function sml_app_login_failed( $login ) {
	$key = 'sml_app_lf_' . md5( strtolower( $login ) );
	set_transient( $key, sml_app_login_failures( $login ) + 1, 15 * MINUTE_IN_SECONDS );
	do_action( 'wp_login_failed', $login, new WP_Error( 'sml_app_login_failed', 'App sign-in failed.' ) );
}

function sml_app_rest_login( WP_REST_Request $request ) {
	sml_app_mark_request();
	$body     = sml_lkd_signed_json( $request );
	$login    = sanitize_text_field( (string) ( $body['login'] ?? '' ) );
	$password = (string) ( $body['password'] ?? '' );
	$code     = preg_replace( '/[^\w-]/', '', (string) ( $body['code'] ?? '' ) );
	$device   = isset( $body['device'] ) && is_array( $body['device'] ) ? array_map( 'sanitize_text_field', array_filter( $body['device'], 'is_scalar' ) ) : array();
	if ( '' === $login || '' === $password || strlen( $login ) > 120 || strlen( $password ) > 512 ) { return sml_app_error( 'invalid_request', 400 ); }
	if ( sml_app_login_failures( $login ) >= 10 ) { return sml_app_error( 'rate_limited', 429, array( 'retryAfterSec' => 900 ) ); }

	$user = wp_authenticate( $login, $password );
	if ( is_wp_error( $user ) || ! ( $user instanceof WP_User ) ) {
		sml_app_login_failed( $login );
		return sml_app_error( 'invalid_credentials', 401 );
	}
	if ( function_exists( 'is_user_spammy' ) && is_user_spammy( $user ) ) { return sml_app_error( 'account_blocked', 403 ); }
	if ( '1' === (string) get_user_meta( $user->ID, 'sml_account_suspended', true ) ) { return sml_app_error( 'account_blocked', 403 ); }

	if ( sml_app_two_step_enabled( $user->ID ) ) {
		$method = sml_app_two_step_method( $user );
		if ( '' === $code ) {
			sml_app_two_step_send( $user, $method );
			$email = (string) $user->user_email;
			$at    = strpos( $email, '@' );
			$hint  = 'email' === $method && false !== $at ? substr( $email, 0, 1 ) . '•••' . substr( $email, $at ) : '';
			return sml_app_error( 'two_step_required', 403, array( 'method' => $method, 'hint' => $hint ) );
		}
		if ( ! sml_app_two_step_verify( $user, $code ) ) {
			sml_app_login_failed( $login );
			return sml_app_error( 'two_step_invalid', 403, array( 'method' => $method ) );
		}
	}

	delete_transient( 'sml_app_lf_' . md5( strtolower( $login ) ) );
	update_user_meta( $user->ID, 'sml_app_last_login', array( 'at' => time(), 'platform' => (string) ( $device['platform'] ?? '' ), 'app' => (string) ( $device['appVersion'] ?? '' ) ) );
	// Deliberately NOT do_action('wp_login'): that is the browser flow (Two Factor's login page, redirects). The app has its own session.
	do_action( 'sml_app_login', $user, $device );
	return new WP_REST_Response( sml_app_member_payload( $user ), 200 );
}

function sml_app_rest_me( WP_REST_Request $request ) {
	sml_app_mark_request();
	$body = sml_lkd_signed_json( $request );
	$user = get_userdata( absint( $body['userId'] ?? 0 ) );
	if ( ! $user ) { return sml_app_error( 'user_not_found', 404 ); }
	if ( '1' === (string) get_user_meta( $user->ID, 'sml_account_suspended', true ) ) { return sml_app_error( 'account_blocked', 403 ); }
	return new WP_REST_Response( sml_app_member_payload( $user ), 200 );
}

/** Mirrors SITE_ALLOW / SITE_DENY in platform/app-api.js. Both sides refuse; the platform's list is the one the app sees. */
function sml_app_proxy_allowed( $route, $user_id ) {
	$allow = array(
		'sml-feed/v1/', 'sml-feed-profiles/v1/', 'sml-members/v1/', 'sml-group-kick/v1/', 'sml-lb/v1/', 'sml-lbm/v1/', 'sml-boot/v1/',
		'sml-hub/v1/group/', 'sml-group-tools/v1/', 'sml-locsec/v1/', 'sml-loop-kick/v1/bootstrap', 'sml-loop-kick-post/v1/', 'sml-2step/v1/status', 'sml-2step/v1/sessions',
		'sml-scanner/v1/', 'sml-ticker-news/v1/', 'sml-sentiment/v1/', 'sml-mood/v1/', 'sml-tags/v1/', 'sml-watch/v1/', 'sml-profile-preview/v1/', 'sml-friends-profile/v1/',
		'sml-store/v1/', 'sml-storefront/v1/', 'sml-sub/v1/', 'sml-subscribers/v1/', 'sml-gifts/v1/', 'sml-emotes/v1/', 'sml-group-landing/v1/', 'sml-group-shell/v1/',
		'sml-group-score/v1/', 'sml-gextras/v1/', 'sml-cues/v1/', 'sml-playlists/v1/', 'sml-creator-videos/v1/', 'sml-creator-comments/v1/', 'sml-display-name/v1/', 'wp/v2/users/me',
	);
	$bare = ltrim( $route, '/' );
	if ( ! preg_match( '#^[a-z0-9-]+/v\d+(?:/(?!\.{1,2}(?:/|$))[\w.-]+)*$#', $bare ) ) { return false; }
	if ( preg_match( '#(^|/)(login|register|resend-code|webhook|reset|reconcile|admin|export|oauth|checkout|purchase-intent|upload|chirp-upload|profile-image|image)(/|$)#', $bare ) ) { return false; }
	$ok = false;
	foreach ( $allow as $prefix ) { if ( $bare === rtrim( $prefix, '/' ) || 0 === strpos( $bare, $prefix ) ) { $ok = true; break; } }
	return (bool) apply_filters( 'sml_app_proxy_allow', $ok, '/' . $bare, $user_id );
}

function sml_app_rest_proxy( WP_REST_Request $request ) {
	sml_app_mark_request();
	$body   = sml_lkd_signed_json( $request );
	$user   = get_userdata( absint( $body['userId'] ?? 0 ) );
	$method = strtoupper( sanitize_key( (string) ( $body['method'] ?? 'GET' ) ) );
	$route  = '/' . ltrim( (string) ( $body['route'] ?? '' ), '/' );
	$query  = isset( $body['query'] ) && is_array( $body['query'] ) ? $body['query'] : array();
	$data   = isset( $body['body'] ) && is_array( $body['body'] ) ? $body['body'] : null;
	if ( ! $user ) { return sml_app_error( 'user_not_found', 404 ); }
	if ( '1' === (string) get_user_meta( $user->ID, 'sml_account_suspended', true ) ) { return sml_app_error( 'account_blocked', 403 ); }
	if ( ! in_array( $method, array( 'GET', 'POST', 'DELETE' ), true ) ) { return sml_app_error( 'invalid_method', 400 ); }
	if ( ! sml_app_proxy_allowed( $route, $user->ID ) ) { return sml_app_error( 'site_route_not_allowed', 404 ); }

	wp_set_current_user( $user->ID );
	$inner = new WP_REST_Request( $method, $route );
	$clean = array();
	foreach ( $query as $k => $v ) { if ( is_scalar( $v ) && preg_match( '/^[\w\[\].-]{1,64}$/', (string) $k ) ) { $clean[ (string) $k ] = (string) $v; } }
	if ( $clean ) { $inner->set_query_params( $clean ); }
	if ( null !== $data && 'GET' !== $method ) {
		$inner->set_header( 'Content-Type', 'application/json' );
		$inner->set_body( wp_json_encode( $data ) );
	}
	$inner->set_header( 'X-WP-Nonce', wp_create_nonce( 'wp_rest' ) );
	$inner->set_header( 'X-SML-App', '1' );
	$response = rest_do_request( $inner );
	$server   = rest_get_server();
	$status   = $response instanceof WP_REST_Response ? (int) $response->get_status() : 500;
	$payload  = $response instanceof WP_REST_Response ? $server->response_to_data( $response, false ) : null;
	return new WP_REST_Response( array( 'ok' => true, 'siteStatus' => $status, 'body' => $payload ), 200 );
}

add_action( 'rest_api_init', static function () {
	foreach ( array( 'login' => 'sml_app_rest_login', 'me' => 'sml_app_rest_me', 'proxy' => 'sml_app_rest_proxy' ) as $leaf => $callback ) {
		register_rest_route( 'sml-platform/v1', '/app/' . $leaf, array(
			'methods'             => 'POST',
			'callback'            => $callback,
			'permission_callback' => 'sml_app_permission',
		) );
	}
} );
