<?php
/**
 * Plugin Name: SML Return After Sign-in
 * Description: The sign-up / sign-in portal always finishes on the home page. When a watch page's "join the chat" card sends a visitor there it leaves a short-lived `sml_return_to` cookie; once they are signed in and land on the home page (or the portal), this sends them back to that stream or video. Only /live/ and /watch/ paths are honoured. 2026-09-23.
 * Version: 1.0.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

add_action( 'init', function () {
	if ( empty( $_COOKIE['sml_return_to'] ) || 'GET' !== ( $_SERVER['REQUEST_METHOD'] ?? '' ) || is_admin() || wp_doing_ajax() || wp_doing_cron() ) { return; }
	if ( ! is_user_logged_in() ) { return; }

	$here = strtolower( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '/' ), PHP_URL_PATH ) );
	if ( ! in_array( $here, array( '/', '/register/', '/login/', '/sign-up-sign-in/' ), true ) ) { return; }   /* only where the portal drops people */

	/* one shot, whatever happens next */
	setcookie( 'sml_return_to', '', array( 'expires' => time() - 3600, 'path' => '/', 'samesite' => 'Lax' ) );

	$to = rawurldecode( (string) wp_unslash( $_COOKIE['sml_return_to'] ) );
	if ( strlen( $to ) > 400 || ! preg_match( '#^/(live|watch)/[A-Za-z0-9._~%/\-]*(\?[A-Za-z0-9._~%=&\-]*)?$#', $to ) || false !== strpos( $to, '//' ) ) { return; }

	wp_safe_redirect( home_url( $to ) );
	exit;
}, 1 );
