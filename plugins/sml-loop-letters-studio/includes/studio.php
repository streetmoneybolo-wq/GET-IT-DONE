<?php
/**
 * Writer-side layer. The letter editor is rendered by the Video Upload Studio plugin at
 * /loop-letters and /creator-studio/loop-letters/write; this adds the Studio drawer
 * (media, look, share card, SEO, checklist, templates, schedule) to that page.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_lls_is_editor_request() {
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	return in_array( $path, array( 'loop-letters', 'creator-studio/loop-letters/write' ), true );
}

add_action( 'init', 'sml_lls_studio_buffer', -998 );
function sml_lls_studio_buffer() {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return; }
	if ( ! sml_lls_is_editor_request() || ! is_user_logged_in() ) { return; }
	ob_start( 'sml_lls_studio_inject' );
}

function sml_lls_studio_inject( $html ) {
	if ( ! is_string( $html ) || stripos( $html, 'le-root' ) === false || stripos( $html, 'sml-lls-studio' ) !== false ) { return $html; }
	$user = wp_get_current_user();
	$cfg  = array(
		'base' => esc_url_raw( rest_url( SML_LLS_NS ) ), 'lettersBase' => esc_url_raw( rest_url( 'sml-letters/v1' ) ), 'seoBase' => esc_url_raw( rest_url( 'sml-letters-seo/v1' ) ),
		'nonce' => wp_create_nonce( 'wp_rest' ), 'userId' => (int) $user->ID, 'handle' => sml_lls_handle( $user->ID ), 'home' => home_url( '/' ),
		'quotes' => 'https://stockmarketloop-loop-kick.onrender.com/api/quotes', 'version' => SML_LLS_VERSION, 'tz' => wp_timezone_string(),
		'isAdmin' => current_user_can( 'manage_options' ),
	);
	$inject = '<link rel="stylesheet" id="sml-lls-studio" href="' . esc_url( sml_lls_asset( 'studio.css' ) ) . '">'
		. '<script>window.smlLLStudio=' . wp_json_encode( $cfg ) . ';</script>'
		. '<script src="' . esc_url( sml_lls_asset( 'studio.js' ) ) . '" defer></script>';
	$pos = strripos( $html, '</body>' );
	return $pos === false ? $html . $inject : substr( $html, 0, $pos ) . $inject . substr( $html, $pos );
}
