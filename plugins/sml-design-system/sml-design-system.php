<?php
/**
 * Plugin Name: SML Design System
 * Description: One look for every page of stockmarketloop.com: shared colour and type tokens, the dark canvas on theme pages, consistent buttons, cards, forms and engagement controls, calmer accents, and avatar fallbacks. Pure CSS and a few lines of JavaScript; it changes no content.
 * Version: 1.0.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_DS_VERSION', '1.0.0' );

function sml_ds_url( $file ) { return plugins_url( $file, __FILE__ ); }
function sml_ds_request_path() { return (string) wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '', PHP_URL_PATH ); }

/* The fonts the whole site shares (Inter for copy, Space Grotesk for display headings, IBM Plex Mono for numbers) and the stylesheet.
   Printed late in <head> so it sits after the theme and plugin styles it refines. */
function sml_ds_head_html() {
	return "\n" . '<link id="sml-ds-fonts-pre" rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' . "\n"
		. '<link id="sml-ds-fonts" rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap">' . "\n"
		. '<link id="sml-ds-css" rel="stylesheet" href="' . esc_url( sml_ds_url( 'assets/design-system.css' ) . '?v=' . rawurlencode( SML_DS_VERSION ) ) . '">' . "\n";
}
function sml_ds_footer_html() {
	return "\n" . '<script id="sml-ds-js" src="' . esc_url( sml_ds_url( 'assets/design-system.js' ) . '?v=' . rawurlencode( SML_DS_VERSION ) ) . '" defer></script>' . "\n";
}

add_action( 'wp_head', 'sml_ds_head', 999 );
function sml_ds_head() { if ( ! is_admin() ) { echo sml_ds_head_html(); } } // phpcs:ignore WordPress.Security.EscapeOutput
add_action( 'wp_footer', 'sml_ds_footer', 999 );
function sml_ds_footer() { if ( ! is_admin() ) { echo sml_ds_footer_html(); } } // phpcs:ignore WordPress.Security.EscapeOutput

/* Pages that print their own HTML without wp_head / wp_footer (Groups, the chart lab, other plugin screens) get the same files
   through the output buffer, so the look is the same everywhere. Non-HTML output passes through untouched. */
add_action( 'init', 'sml_ds_buffer', -999 );
function sml_ds_buffer() {
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) || ( defined( 'WP_CLI' ) && WP_CLI ) ) { return; }
	if ( ! isset( $_SERVER['REQUEST_METHOD'] ) || 'GET' !== $_SERVER['REQUEST_METHOD'] ) { return; }
	$path = sml_ds_request_path();
	if ( strpos( $path, '/wp-json' ) === 0 || strpos( $path, '/wp-admin' ) === 0 || strpos( $path, '/wp-login' ) === 0 || preg_match( '#\.(?:js|css|png|jpe?g|gif|webp|svg|ico|json|xml|txt|webmanifest|woff2?|ttf|mp4|mp3|pdf|zip)$#i', $path ) ) { return; }
	ob_start( 'sml_ds_inject' );
}
function sml_ds_inject( $html ) {
	if ( ! is_string( $html ) || $html === '' || stripos( $html, '<html' ) === false ) { return $html; }
	if ( stripos( $html, 'id="sml-ds-css"' ) === false ) {
		$head = stripos( $html, '</head>' );
		if ( $head !== false ) { $html = substr( $html, 0, $head ) . sml_ds_head_html() . substr( $html, $head ); }
	}
	if ( stripos( $html, 'id="sml-ds-js"' ) === false ) {
		$body = strripos( $html, '</body>' );
		if ( $body !== false ) { $html = substr( $html, 0, $body ) . sml_ds_footer_html() . substr( $html, $body ); }
	}
	return $html;
}

/* A body class so the stylesheet can tell theme pages from app screens. */
add_filter( 'body_class', 'sml_ds_body_class' );
function sml_ds_body_class( $classes ) { $classes[] = 'sml-ds'; return $classes; }
