<?php
/**
 * Plugin Name: SML Letter Publish Time
 * Description: Shows the time a Loop Letter was published, not only the date, in the letter byline ("Oct 19, 2026 at 4:41 PM EDT"). Eastern time, the market's clock, because letter pages are cached for every reader. Does nothing once the reader itself prints the time.
 * Version: 1.0.1
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

/* Rewrites the byline's <time datetime="..."> text. Only on letter pages (/n/{author}/{slug}), and only when the text has no time yet. */
function sml_lpt_filter( $html ) {
	if ( strpos( $html, 'lls-byline-meta' ) === false ) { return $html; }
	return preg_replace_callback(
		'#(<span class="lls-byline-meta"><time datetime=")([^"]+)(">)([^<]*)(</time>)#',
		function ( $m ) {
			if ( strpos( $m[4], ' at ' ) !== false ) { return $m[0]; }
			$ts = strtotime( $m[2] );
			if ( ! $ts ) { return $m[0]; }
			return $m[1] . $m[2] . $m[3] . esc_html( wp_date( 'M j, Y \a\t g:i A T', $ts, new DateTimeZone( 'America/New_York' ) ) ) . $m[5];
		},
		$html,
		1
	);
}

/* The reader prints the whole letter page and exits at template_redirect, so the buffer opens earlier, at plugins_loaded, as the reader's own does. */
add_action( 'plugins_loaded', function () {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'WP_CLI' ) && WP_CLI ) ) { return; }
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	if ( ! preg_match( '#^(n|letters)/[^/]+/[^/]+$#', $path ) ) { return; }
	ob_start( 'sml_lpt_filter' );
}, 2 );
