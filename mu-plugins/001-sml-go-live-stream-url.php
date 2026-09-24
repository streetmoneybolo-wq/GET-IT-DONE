<?php
/**
 * Plugin Name: SML Go Live stream URLs
 * Description: /go-live/{handle}/{title-slug}-{stream-id} opens the Go Live studio for that one stream. The page itself is the ordinary /go-live/ page (the studio script reads the id from the path), so every studio module works unchanged.
 * Version: 1.0.0
 *
 * Same technique as 000-sml-clean-urls: at include time the pretty path is rewritten to /go-live/ before anything reads the request.
 * The stream must belong to the signed-in creator — the studio script looks it up in that creator's own library and falls back to the
 * normal studio when it is not found, so a guessed id shows nothing. Pages are never edge-cached (they carry a signed-in nonce).
 * ROLLBACK: delete this file; those URLs 404 and the Manage links fall back to /go-live/ in the studio script.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! function_exists( 'sml_gls_rewrite' ) ) {
	function sml_gls_rewrite() {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
		if ( '' === $uri || 0 !== strpos( $uri, '/go-live/' ) ) { return; }
		$path  = (string) parse_url( $uri, PHP_URL_PATH );
		$query = (string) parse_url( $uri, PHP_URL_QUERY );
		if ( ! preg_match( '#^/go-live/([A-Za-z0-9_-]+)/([^/]+)/?$#', $path, $m ) ) { return; }
		if ( ! preg_match( '/(?:^|-)([A-Za-z0-9]{8,32})$/', $m[2] ) ) { return; }
		$GLOBALS['sml_gls_route'] = array( 'handle' => $m[1], 'slug' => $m[2] );
		$_SERVER['SML_GLS_ORIGINAL_URI'] = $uri;
		$_SERVER['REQUEST_URI'] = '/go-live/' . ( '' !== $query ? '?' . $query : '' );
		if ( ! defined( 'DONOTCACHEPAGE' ) ) { define( 'DONOTCACHEPAGE', true ); }
	}
	sml_gls_rewrite();
	add_action( 'template_redirect', function () { if ( ! empty( $GLOBALS['sml_gls_route'] ) && function_exists( 'nocache_headers' ) ) { nocache_headers(); } }, 1 );
}
