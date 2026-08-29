<?php
/**
 * Plugin Name: SML Loop Letters Writer Layout
 * Description: Applies the Loop Hub publication dashboard to the Loop Letters writer without replacing its storage or editor.
 * Version: 1.0.8
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sml_lh_writer_layout_is_target() {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
		return false;
	}

	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	return in_array( $path, array( 'creator-studio/loop-letters/write', 'loop-letters' ), true );
}

function sml_lh_writer_layout_filter( $html ) {
	if ( false !== strpos( $html, 'data-sml-lh-writer-layout' ) || false === strpos( $html, 'id="le-root"' ) ) {
		return $html;
	}

	$css = file_get_contents( __DIR__ . '/assets/writer-layout.css' );
	$js  = file_get_contents( __DIR__ . '/assets/writer-layout.js' );

	if ( false === $css || false === $js ) {
		return $html;
	}

	$fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">'
		. '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
		. '<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&amp;family=DM+Sans:wght@400;500;600;700&amp;family=IBM+Plex+Sans:wght@400;500;600;700&amp;family=Inter:wght@400;500;600;700;800&amp;family=Lora:wght@400;500;600;700&amp;family=Manrope:wght@400;500;600;700;800&amp;family=Merriweather:wght@400;700&amp;family=Montserrat:wght@400;500;600;700;800&amp;family=Playfair+Display:wght@400;600;700&amp;family=Poppins:wght@400;500;600;700&amp;family=Roboto+Slab:wght@400;600;700&amp;family=Space+Grotesk:wght@500;600;700&amp;display=swap" rel="stylesheet">';
	$html = str_replace( '</head>', $fonts . '<style data-sml-lh-writer-layout>' . $css . '</style></head>', $html );
	return str_replace( '</body>', '<script data-sml-lh-writer-layout>' . $js . '</script></body>', $html );
}

function sml_lh_writer_layout_buffer() {
	if ( sml_lh_writer_layout_is_target() ) {
		ob_start( 'sml_lh_writer_layout_filter' );
	}
}
// The Studio owns this route and may terminate during template_redirect, so
// capture output before any route controller has a chance to render and exit.
add_action( 'plugins_loaded', 'sml_lh_writer_layout_buffer', -PHP_INT_MAX );
