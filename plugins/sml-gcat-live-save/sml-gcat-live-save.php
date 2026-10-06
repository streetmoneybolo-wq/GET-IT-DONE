<?php
/**
 * Plugin Name: SML Group Editor Live Save
 * Description: Pins group-categories.js, group-onboarding.js and group-storefront.js on /groups/{slug}/ to newer revisions. Deactivate to revert.
 * Version: 1.0.7
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
function sml_gcat_live_save_rewrite( $h ) {
	$p = array( 'js/group-categories' => '1c6700cb07ddd7396cd90239056680dc3b43d2e0', 'js/group-onboarding' => 'f1c7e9f65f6d8df0b70d3d7761a283fcf03f766e', 'js/group-storefront' => 'fa71a510497fa4335a4040a19e323fe78f870151' );
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
