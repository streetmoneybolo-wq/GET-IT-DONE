<?php
/**
 * Plugin Name: SML Group Editor Live Save
 * Description: Serves the group channel editor script (js/group-categories.js) from a specific revision that saves every edit live and never reloads the page when a channel is created, renamed, reordered or deleted. Touches only that one script tag on /groups/{slug}/ pages; every other asset keeps the site-wide CDN pin. Deactivate to go back to the pinned version.
 * Version: 1.0.1
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! defined( 'SML_GCAT_LIVE_SAVE_REF' ) ) {
	define( 'SML_GCAT_LIVE_SAVE_REF', '9192c494ed470cb789657d7be986c690fd9d769c' );
}

/** Point the group-categories.js script tag at the live-save revision. Pure string work, safe to unit test. */
function sml_gcat_live_save_rewrite( $html, $ref = SML_GCAT_LIVE_SAVE_REF ) {
	if ( ! is_string( $html ) || '' === $html || ! preg_match( '/^[a-f0-9]{7,40}$/', (string) $ref ) ) { return $html; }
	return preg_replace(
		'#(https://cdn\.jsdelivr\.net/gh/streetmoneybolo-wq/GET-IT-DONE@)[A-Za-z0-9._-]+(/js/group-categories\.js)#',
		'${1}' . $ref . '${2}',
		$html
	);
}

// Start before the loader's own buffer (priority 0) so this one is outermost and sees the finished page.
add_action( 'init', static function () {
	if ( is_admin() || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return; }
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	if ( false !== strpos( $uri, '/wp-json/' ) || ! preg_match( '#^/groups/[^/]+/?$#', $path ) ) { return; }
	ob_start( static function ( $html ) { return sml_gcat_live_save_rewrite( $html ); } );
}, -10 );
