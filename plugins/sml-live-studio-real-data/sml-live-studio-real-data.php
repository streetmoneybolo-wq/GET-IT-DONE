<?php
/**
 * Plugin Name: SML Live Studio Real Data
 * Description: Replaces Creator Studio overlay demo content with the creator's real subscriber count and shared Watch Page chat.
 * Version: 1.0.1
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_lsrd_is_go_live_page() {
	if ( is_admin() ) { return false; }
	if ( is_page( 'go-live' ) ) { return true; }
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	return 'go-live' === $path;
}

function sml_lsrd_enqueue() {
	if ( ! sml_lsrd_is_go_live_page() ) { return; }
	wp_enqueue_script(
		'sml-live-studio-real-data',
		plugins_url( 'assets/live-studio-real-data.js', __FILE__ ),
		array(),
		'1.0.1',
		true
	);
}
add_action( 'wp_enqueue_scripts', 'sml_lsrd_enqueue', 9999 );

/*
 * /go-live/ is rendered by a standalone plugin template that does not call
 * wp_head() or wp_footer(). Keep the normal enqueue for compatibility, then
 * inject the same asset into that standalone response at the final boundary.
 */
function sml_lsrd_inject_standalone_asset( $html ) {
	if ( false !== strpos( $html, 'sml-live-studio-real-data.js' ) ) { return $html; }
	$src = esc_url( plugins_url( 'assets/live-studio-real-data.js', __FILE__ ) ) . '?ver=1.0.1';
	$tag = '<script src="' . $src . '" defer></script>';
	if ( false !== stripos( $html, '</body>' ) ) {
		return preg_replace( '/<\/body>/i', $tag . '</body>', $html, 1 );
	}
	return $html . $tag;
}

function sml_lsrd_buffer_go_live() {
	if ( ! sml_lsrd_is_go_live_page() ) { return; }
	ob_start( 'sml_lsrd_inject_standalone_asset' );
}
add_action( 'template_redirect', 'sml_lsrd_buffer_go_live', -9999 );

