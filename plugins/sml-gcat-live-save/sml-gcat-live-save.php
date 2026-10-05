<?php
/**
 * Plugin Name: SML Group Editor Live Save
 * Description: Pins group-categories.js and group-onboarding.js on /groups/{slug}/ to newer revisions. Deactivate to revert.
 * Version: 1.0.2
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
function sml_gcat_live_save_rewrite( $h ) {
	$p = array( 'js/group-categories' => '9192c494ed470cb789657d7be986c690fd9d769c', 'js/group-onboarding' => 'f1c7e9f65f6d8df0b70d3d7761a283fcf03f766e' );
	foreach ( $p as $f => $r ) {
		$h = preg_replace( '#(https://cdn\.jsdelivr\.net/gh/streetmoneybolo-wq/GET-IT-DONE@)[A-Za-z0-9._-]+(/' . $f . '\.js)#', '${1}' . $r . '${2}', $h );
	}
	return $h;
}
add_action( 'init', static function () {
	$u = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
	if ( is_admin() || false !== strpos( $u, '/wp-json/' ) || ! preg_match( '#^/groups/[^/?]+/?(\?|$)#', $u ) ) { return; }
	ob_start( 'sml_gcat_live_save_rewrite' );
}, -10 );
