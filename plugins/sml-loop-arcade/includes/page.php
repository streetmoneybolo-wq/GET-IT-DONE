<?php
/**
 * Mounts the arcade and the board visuals on the live and watch pages. Those pages are
 * rendered by other plugins and scripts, so this adds its layer at the end of the
 * body through an output buffer, the same way the site's own loaders do.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_arc_page_kind() {
	$uri  = (string) ( $_SERVER['REQUEST_URI'] ?? '' );
	$path = trim( (string) wp_parse_url( $uri, PHP_URL_PATH ), '/' );
	if ( preg_match( '#^live(/|$)#', $path ) ) {
		$parts = explode( '/', $path );
		if ( count( $parts ) === 2 && empty( $_GET['s'] ) && empty( $_GET['room'] ) ) { return ''; } /* /live/{handle}/ is the creator's slots page */
		return 'live';
	}
	if ( preg_match( '#^(watch|video)/[A-Za-z0-9]#', $path ) ) { return 'watch'; }
	return '';
}

add_action( 'init', function () {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return; }
	if ( ! sml_arc_page_kind() ) { return; }
	ob_start( 'sml_arc_inject' );
}, -990 );

function sml_arc_inject( $html ) {
	if ( ! is_string( $html ) || strpos( $html, 'sml-arcade-js' ) !== false ) { return $html; }
	$pos = strripos( $html, '</body>' );
	if ( $pos === false ) { return $html; }
	$kind = sml_arc_page_kind();
	$uid  = get_current_user_id();
	$handle = '';
	if ( preg_match( '#"handle":"([A-Za-z0-9_.-]+)"#', substr( $html, 0, 400000 ), $m ) && strpos( $html, 'SML_LW_ROOM' ) !== false ) { $handle = strtolower( $m[1] ); }
	if ( ! $handle ) { $handle = strtolower( preg_replace( '/[^a-z0-9_.-]/i', '', (string) ( $_GET['s'] ?? ( $_GET['room'] ?? '' ) ) ) ); }
	if ( ! $handle && preg_match( '#^/live/([A-Za-z0-9_.-]+)/#', (string) wp_parse_url( (string) $_SERVER['REQUEST_URI'], PHP_URL_PATH ), $m2 ) ) { $handle = strtolower( $m2[1] ); }
	$cfg = array(
		'base' => esc_url_raw( rest_url( SML_ARC_NS ) ), 'nonce' => wp_create_nonce( 'wp_rest' ), 'userId' => $uid, 'kind' => $kind, 'handle' => $handle,
		'loginUrl' => esc_url_raw( add_query_arg( 'redirect_to', rawurlencode( home_url( (string) $_SERVER['REQUEST_URI'] ) ), home_url( '/sign-up-sign-in/' ) ) ),
		'quotes' => 'https://stockmarketloop-loop-kick.onrender.com/api/quotes', 'version' => SML_ARC_VERSION,
	);
	$inject = '<link rel="stylesheet" id="sml-arcade-css" href="' . esc_url( sml_arc_asset( 'arcade.css' ) ) . '"><link rel="stylesheet" id="sml-boards-css" href="' . esc_url( sml_arc_asset( 'boards.css' ) ) . '">'
		. '<script>window.SML_ARCADE=' . wp_json_encode( $cfg ) . ';</script>'
		. '<script id="sml-arcade-js" src="' . esc_url( sml_arc_asset( 'arcade.js' ) ) . '" defer></script>'
		. '<script id="sml-boards-js" src="' . esc_url( sml_arc_asset( 'boards.js' ) ) . '" defer></script>';
	return substr( $html, 0, $pos ) . $inject . substr( $html, $pos );
}
