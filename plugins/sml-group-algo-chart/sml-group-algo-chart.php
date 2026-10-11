<?php
/**
 * Plugin Name: SML Group Algo Chart
 * Description: The Live Chart and the Analyst Dashboard show a group's own ALGO list instead of a fixed MEM ALGO button. A member opens Live Chart inside their group and the algos that group offers appear (Making Easy Money: MEM ALGO first). Outside a group, or in a group without MEM ALGO, the MEM ALGO button is not shown.
 * Version: 1.0.0
 * Author: StockMarketLoop
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SML_GAC_VERSION', '1.0.0' );

/**
 * The dashboard page itself, and the same page embedded as a group tool (?sml_group_tool / ?embed=…).
 * Cheap checks only: the script is small and refuses to run on any page without the chart toolbar.
 */
function sml_gac_is_chart_page() {
	if ( is_admin() ) {
		return false;
	}
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
	if ( false !== strpos( $uri, 'analyst-dashboard' ) || isset( $_GET['sml_group_tool'] ) || isset( $_GET['sml_popout'] ) ) {
		return true;
	}
	return is_page( 'analyst-dashboard' );
}

/**
 * The group this page belongs to. The dashboard carries it in the embed query, the group plugins put it on the
 * request in a few spellings; the script also reads the dashboard's own alert-destination data as a fallback.
 */
function sml_gac_group_id() {
	foreach ( array( 'group_id', 'group', 'gid', 'sml_group' ) as $k ) {
		if ( isset( $_GET[ $k ] ) && ctype_digit( (string) $_GET[ $k ] ) ) {
			return (int) $_GET[ $k ];
		}
	}
	return 0;
}

add_action( 'wp_enqueue_scripts', static function () {
	if ( ! sml_gac_is_chart_page() ) {
		return;
	}
	wp_register_script( 'sml-group-algo-chart', plugins_url( 'assets/algo-chart.js', __FILE__ ), array(), SML_GAC_VERSION, true );
	wp_localize_script( 'sml-group-algo-chart', 'SML_GAC', array(
		'groupId' => sml_gac_group_id(),
		'rest'    => esc_url_raw( rest_url( 'sml/v1/group/algos' ) ),
		'nonce'   => wp_create_nonce( 'wp_rest' ),
		'ajax'    => admin_url( 'admin-ajax.php' ),
	) );
	wp_enqueue_script( 'sml-group-algo-chart' );
}, 100 );
