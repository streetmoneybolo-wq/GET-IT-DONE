<?php
/**
 * Plugin Name: SML Corporate Badges
 * Description: Receives the corporate-account projection from the platform and renders the verified Corporate badge. Read-only mirror — this plugin never decides who is corporate.
 * Version: 1.0.0
 *
 * WordPress does NOT decide entitlement. The platform proves domain ownership,
 * takes the money, and pushes a projection here; this plugin mirrors it. A bug
 * in this file can therefore cost a badge — it cannot grant one, and it cannot
 * grant feed placement.
 *
 * The projection is applied WHOLESALE: the stored option is replaced by what
 * arrives. Suspension takes effect by absence, so there is no partial-update
 * path that can leave a stale badge on a suspended advertiser.
 *
 * Signature scheme is the platform's existing one, byte for byte:
 * hash_hmac('sha256', "{$timestamp}.{$body}", $secret), 300s window. Do not
 * invent a second scheme here.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

const SML_CB_OPTION = 'sml_corporate_accounts';

/** Category => badge colour. An allowlist, so a hostile category can never reach CSS. */
function sml_cb_category_colors() {
	return array(
		'news'      => '#C2410C',
		'media'     => '#0F766E',
		'finance'   => '#1D4ED8',
		'research'  => '#6D28D9',
		'brokerage' => '#0F766E',
		'data'      => '#1D4ED8',
		'other'     => '#475569',
	);
}

function sml_cb_bridge_secret() {
	return defined( 'SML_PLATFORM_BILLING_BRIDGE_SECRET' ) ? trim( (string) SML_PLATFORM_BILLING_BRIDGE_SECRET ) : '';
}

function sml_cb_signature( $timestamp, $body, $secret ) {
	return hash_hmac( 'sha256', $timestamp . '.' . $body, $secret );
}

function sml_cb_verify( WP_REST_Request $request ) {
	$secret    = sml_cb_bridge_secret();
	$timestamp = (string) $request->get_header( 'x-sml-timestamp' );
	$signature = strtolower( preg_replace( '/^sha256=/', '', (string) $request->get_header( 'x-sml-signature' ) ) );
	if ( '' === $secret || ! ctype_digit( $timestamp ) || abs( time() - (int) $timestamp ) > 300 ) return false;
	$expected = sml_cb_signature( $timestamp, $request->get_body(), $secret );
	return preg_match( '/^[a-f0-9]{64}$/', $signature ) && hash_equals( $expected, $signature );
}

/* ------------------------------------------------------------------ intake */

function sml_cb_receive_projection( WP_REST_Request $request ) {
	if ( ! sml_cb_verify( $request ) ) {
		return new WP_Error( 'sml_cb_signature', 'Invalid projection signature.', array( 'status' => 401 ) );
	}

	$data = json_decode( $request->get_body(), true );
	if ( ! is_array( $data ) || ! isset( $data['accounts'] ) || ! is_array( $data['accounts'] ) ) {
		return new WP_Error( 'sml_cb_payload', 'Projection must carry an accounts array.', array( 'status' => 422 ) );
	}

	$accounts = $data['accounts'];
	$claimed  = isset( $data['count'] ) ? (int) $data['count'] : -1;

	/* The payload states its own length. A mismatch means it was assembled or
	 * truncated by something other than the publisher, and applying it wholesale
	 * would corrupt every badge on the site. */
	if ( $claimed !== count( $accounts ) ) {
		return new WP_Error( 'sml_cb_count', 'Projection count does not match its accounts.', array( 'status' => 422 ) );
	}

	/* "No corporate accounts" and "the query broke" look identical on the wire.
	 * An empty list is only honoured when the publisher explicitly says it meant
	 * it — otherwise a failed query upstream would silently wipe every badge. */
	if ( 0 === count( $accounts ) && empty( $data['empty'] ) ) {
		return new WP_Error( 'sml_cb_empty', 'Refusing an unflagged empty projection.', array( 'status' => 422 ) );
	}

	$colors = sml_cb_category_colors();
	$clean  = array();
	foreach ( $accounts as $row ) {
		if ( ! is_array( $row ) ) continue;
		$user_id = isset( $row['wpUserId'] ) ? absint( $row['wpUserId'] ) : 0;
		if ( ! $user_id ) continue;
		$category = isset( $row['category'] ) ? (string) $row['category'] : 'other';
		if ( ! isset( $colors[ $category ] ) ) $category = 'other';

		/* Keyed by USER ID, never by handle. Handles collide case-insensitively
		 * here — the nicename collision that resolved /grandmasterobi/ to a
		 * different user than the display name implied already caused one
		 * false-positive badge on this site. */
		$clean[ $user_id ] = array(
			'name'     => sanitize_text_field( (string) ( $row['name'] ?? '' ) ),
			'handle'   => sanitize_title( (string) ( $row['handle'] ?? '' ) ),
			'category' => $category,
		);
	}

	update_option( SML_CB_OPTION, array(
		'accounts'  => $clean,
		'count'     => count( $clean ),
		'synced_at' => gmdate( 'c' ),
	), false );

	return rest_ensure_response( array( 'ok' => true, 'stored' => count( $clean ) ) );
}

/* ------------------------------------------------------------------ lookup */

function sml_cb_accounts() {
	$stored = get_option( SML_CB_OPTION );
	return ( is_array( $stored ) && isset( $stored['accounts'] ) && is_array( $stored['accounts'] ) )
		? $stored['accounts'] : array();
}

/**
 * Is this user a corporate account?
 *
 * Absent from the projection means NOT corporate, always. Suspension arrives as
 * absence, so a cache miss or a failed sync must fail in the direction of no
 * badge rather than a stale one.
 */
function sml_cb_is_corporate( $user_id ) {
	$user_id = absint( $user_id );
	if ( ! $user_id ) return false;
	$accounts = sml_cb_accounts();
	return isset( $accounts[ $user_id ] );
}

/** Badge markup, or '' when the user is not corporate. Always escaped. */
function sml_cb_badge_html( $user_id ) {
	$user_id  = absint( $user_id );
	$accounts = sml_cb_accounts();
	if ( ! isset( $accounts[ $user_id ] ) ) return '';

	$account  = $accounts[ $user_id ];
	$colors   = sml_cb_category_colors();
	$category = isset( $colors[ $account['category'] ] ) ? $account['category'] : 'other';

	return sprintf(
		'<span class="sml-cb-badge sml-cb-badge--%1$s" style="--sml-cb-color:%2$s" title="%3$s" aria-label="%3$s">'
		. '<svg class="sml-cb-badge__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
		. '<path fill="currentColor" d="M8 .8 2.4 3v4.6c0 3.3 2.3 6.4 5.6 7.6 3.3-1.2 5.6-4.3 5.6-7.6V3L8 .8Zm2.9 5.4-3.6 3.6a.8.8 0 0 1-1.1 0L4.6 8.2l1.1-1.1 1.1 1.1 3-3 1.1 1Z"/>'
		. '</svg><span class="sml-cb-badge__text">%4$s</span></span>',
		esc_attr( $category ),
		esc_attr( $colors[ $category ] ),
		/* translators: %s: company name */
		esc_attr( sprintf( __( 'Verified corporate account: %s', 'sml' ), $account['name'] ) ),
		esc_html__( 'Corporate', 'sml' )
	);
}

/* --------------------------------------------------------- server surfaces */

/** Post author byline. */
function sml_cb_filter_author( $display_name ) {
	$badge = sml_cb_badge_html( get_the_author_meta( 'ID' ) );
	return $badge ? $display_name . ' ' . $badge : $display_name;
}

/** Comment author line. */
function sml_cb_filter_comment_author( $author, $comment_id = 0 ) {
	$comment = get_comment( $comment_id );
	if ( ! $comment || ! $comment->user_id ) return $author;
	$badge = sml_cb_badge_html( $comment->user_id );
	return $badge ? $author . ' ' . $badge : $author;
}

/**
 * Public read for client-rendered surfaces (the home feed is built in JS from
 * a CDN bundle, so it cannot call a PHP helper).
 *
 * Deliberately minimal: user id, display name, category. No billing, no
 * verification detail, nothing that is not already visible on a badge.
 */
function sml_cb_public_badges() {
	$out = array();
	foreach ( sml_cb_accounts() as $user_id => $account ) {
		$out[ (string) $user_id ] = array(
			'name'     => $account['name'],
			'category' => $account['category'],
		);
	}
	$response = rest_ensure_response( array( 'accounts' => $out, 'count' => count( $out ) ) );
	/* Short public cache: a badge appearing a minute late is fine; a badge
	 * lingering after suspension is not. */
	$response->header( 'Cache-Control', 'public, max-age=60' );
	return $response;
}

function sml_cb_styles() {
	$css = '.sml-cb-badge{display:inline-flex;align-items:center;gap:.25em;padding:.1em .45em;border-radius:.35em;'
		. 'background:var(--sml-cb-color,#475569);color:#fff;font-size:.72em;font-weight:700;line-height:1.5;'
		. 'letter-spacing:.02em;vertical-align:middle;white-space:nowrap}'
		. '.sml-cb-badge__icon{width:1em;height:1em;flex:0 0 auto}';
	wp_register_style( 'sml-corporate-badges', false, array(), '1.0.0' );
	wp_enqueue_style( 'sml-corporate-badges' );
	wp_add_inline_style( 'sml-corporate-badges', $css );
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-corporate/v1', '/projection', array(
		'methods'             => 'POST',
		'callback'            => 'sml_cb_receive_projection',
		/* Signature is checked inside the callback, matching sml-alert-router. */
		'permission_callback' => '__return_true',
	) );
	register_rest_route( 'sml-corporate/v1', '/badges', array(
		'methods'             => 'GET',
		'callback'            => 'sml_cb_public_badges',
		'permission_callback' => '__return_true',
	) );
} );

add_filter( 'the_author', 'sml_cb_filter_author' );
add_filter( 'get_comment_author', 'sml_cb_filter_comment_author', 10, 2 );
add_action( 'wp_enqueue_scripts', 'sml_cb_styles' );
