<?php
/*
Plugin Name: SML Go Live — Multi-screen setup
Description: Re-adds the easy multi-screen (up to 3 screens) live-stream setup to /go-live/. Prints the creator's REST nonce + handle and loads js/go-live-screens.js from the shared CDN, which renders a screen-count picker (POST sml-live/v1/slots), the per-screen keys, a simple one-stream-per-screen guide, and live per-screen status. Non-invasive; reversible by deactivation.
Version: 1.0.0
Author: StockMarketLoop
*/

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * On the /go-live/ page (logged-in creators only), buffer the output and inject
 * the config globals + the multi-screen script before </body>.
 */
add_action( 'init', 'sml_glms_maybe_buffer', 0 );
function sml_glms_maybe_buffer() {
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) {
		return;
	}
	if ( ! is_user_logged_in() ) {
		return;
	}
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
	$path = trim( (string) parse_url( $uri, PHP_URL_PATH ), '/' );
	if ( $path !== 'go-live' ) {
		return;
	}
	ob_start( 'sml_glms_inject' );
}

function sml_glms_inject( $html ) {
	if ( ! is_string( $html ) || stripos( $html, '</body>' ) === false ) {
		return $html; // Not a full HTML document (JSON / bare template).
	}
	if ( strpos( $html, 'sml-gl-screens-js' ) !== false ) {
		return $html; // Already injected.
	}

	$uid    = get_current_user_id();
	$user   = get_userdata( $uid );
	$handle = $user ? $user->user_nicename : ''; // /feeds/{handle} resolves via get_user_by('slug', …).

	$ref = function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main';
	$src = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( (string) $ref ) . '/js/go-live-screens.js';

	$cfg = '<script id="sml-gl-screens-cfg">'
		. 'window.SML_GL_NONCE=' . wp_json_encode( wp_create_nonce( 'wp_rest' ) ) . ';'
		. 'window.SML_GL_HANDLE=' . wp_json_encode( $handle ) . ';'
		. 'window.SML_GL_INGEST=' . wp_json_encode( 'rtmp://live.stockmarketloop.com/live' ) . ';'
		. '</script>';
	// Stable, visible, body-level mount point. The Go Live wizard is a client-rendered
	// SPA whose panels re-render (and its Stream Health panel is hidden), so a body-level
	// container is the reliable place for the card — it is never wiped or hidden.
	$mount = '<div id="sml-gl-multiscreen" style="max-width:760px;margin:22px auto 44px;padding:0 16px;box-sizing:border-box"></div>';
	$js = '<script id="sml-gl-screens-js" src="' . esc_url( $src ) . '" defer></scr' . 'ipt>';

	return str_replace( '</body>', $mount . $cfg . $js . '</body>', $html );
}
