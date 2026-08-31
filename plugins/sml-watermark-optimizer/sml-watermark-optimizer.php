<?php
/**
 * Plugin Name: StockMarketLoop Watermark Optimizer
 * Description: Serves the approved animated Portal Chat background site-wide while preserving an instant rollback switch.
 * Version: 1.2.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! defined( 'SML_WM_PORTAL_URL' ) ) {
	define( 'SML_WM_PORTAL_URL', 'https://stockmarketloop.com/wp-content/uploads/2026/08/Untitled-800-x-800-px-2.gif' );
}

if ( ! function_exists( 'sml_wm_base' ) ) {
	function sml_wm_base() {
		return 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@4befb9c/media/watermarks/';
	}
}

if ( ! function_exists( 'sml_wm_active' ) ) {
	function sml_wm_active() {
		return ! get_option( 'sml_wm_off' );
	}
}

if ( ! function_exists( 'sml_wm_portal_url' ) ) {
	/**
	 * Replace only the group shell's bundled Portal watermark URL.
	 * Normal channels keep their group/channel-specific backgrounds.
	 *
	 * @param string $url    Absolute plugin asset URL built by plugins_url().
	 * @param string $path   Relative path requested by the caller.
	 * @param string $plugin Plugin file the caller resolved against.
	 */
	function sml_wm_portal_url( $url, $path, $plugin ) {
		if ( ! sml_wm_active() || ! is_string( $url ) || ! is_string( $path ) ) {
			return $url;
		}
		if ( false === strpos( $path, 'portal-watermark.gif' ) || false === strpos( $url, 'sml-group-shell' ) ) {
			return $url;
		}
		return SML_WM_PORTAL_URL;
	}
}

if ( ! has_filter( 'plugins_url', 'sml_wm_portal_url' ) ) {
	add_filter( 'plugins_url', 'sml_wm_portal_url', 10, 3 );
}
