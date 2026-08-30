<?php
/**
 * Plugin Name: SML Live Studio Real Data
 * Description: Replaces Creator Studio overlay demo content with the creator's real subscriber count and shared Watch Page chat.
 * Version: 1.0.0
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
		'1.0.0',
		true
	);
}
add_action( 'wp_enqueue_scripts', 'sml_lsrd_enqueue', 9999 );

