<?php
/**
 * Plugin Name: SML Chart Academy Tools
 * Description: Adds the Academy chart tools the site chart did not have (smart-money map, MEM ALGO strategies, named candlesticks, bar-close countdown, options calculator, order-book walls, cost distribution, tape stats) to the LoopCharts chart on the analyst dashboard. Group pages embed that same dashboard, so they get the tools too.
 * Version: 1.1.1
 *
 * The scripts are inlined before </body> on /analyst-dashboard/ only (one injection covers the dashboard and every group's embedded copy).
 * Script ids start with "sml-dashboard-chart-" because the dashboard strips other sml-* script tags.
 * Kill switch: deactivate the plugin.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_cat_scripts() {
	$dir = __DIR__ . '/assets/';
	$wrap_cjs = function ( $file, $global ) use ( $dir ) {
		$src = @file_get_contents( $dir . $file );
		if ( ! $src ) { return ''; }
		return '(function(){var module={exports:{}},exports=module.exports;' . $src . "\nif(!window." . $global . ')window.' . $global . '=module.exports;})();';
	};
	$parts = array(
		'umd-smart-money' => @file_get_contents( $dir . 'academy-smart-money.js' ),   // UMD: sets window.SmlSmartMoney
		'umd-options'     => @file_get_contents( $dir . 'academy-options-calc.js' ),  // UMD: sets window.SmlOptionsCalc
		'patterns'        => $wrap_cjs( 'academy-patterns.js', 'SmlPatterns' ),
		'mem-algo'        => $wrap_cjs( 'academy-mem-algo.js', 'MemAlgoEngine' ),
		'adapter'         => @file_get_contents( $dir . 'adapter.js' ),
		'depth'           => @file_get_contents( $dir . 'depth.js' ),        // walls, cost distribution, tape stats
	);
	$out = '';
	foreach ( $parts as $id => $js ) {
		if ( ! $js ) { continue; }
		$out .= '<script id="sml-dashboard-chart-academy-' . esc_attr( $id ) . '">' . str_replace( '</script', '<\/script', $js ) . "</script>\n";
	}
	return $out;
}

function sml_cat_inject( $html ) {
	if ( ! is_string( $html ) || false === strpos( $html, 'sml-lc-canvas-host' ) || false !== strpos( $html, 'sml-dashboard-chart-academy-adapter' ) ) { return $html; }
	$pos = strripos( $html, '</body>' );
	if ( false === $pos ) { return $html; }
	return substr( $html, 0, $pos ) . sml_cat_scripts() . substr( $html, $pos );
}

add_action( 'plugins_loaded', static function () {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return; }
	$path = trailingslashit( (string) wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ) );
	if ( '/analyst-dashboard/' === $path ) { ob_start( 'sml_cat_inject' ); }
}, PHP_INT_MAX );
