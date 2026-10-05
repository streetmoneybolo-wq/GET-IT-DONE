<?php
/**
 * Plugin Name: SML Group Pro Tools
 * Description: Trade setup breakdowns, absorption meter, options strategy and hedge builder, dark pool tool and an analyst dashboard inside every StockMarketLoop group, powered by the Academy's live data. Members of the group get a preview; Premium, analysts and managers get the full tools.
 * Version: 1.0.0
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SML_GPRO_VERSION', '1.0.0' );
define( 'SML_GPRO_DIR', plugin_dir_path( __FILE__ ) );
define( 'SML_GPRO_URL', plugin_dir_url( __FILE__ ) );

require_once SML_GPRO_DIR . 'includes/access.php';
require_once SML_GPRO_DIR . 'includes/platform.php';
require_once SML_GPRO_DIR . 'includes/rest.php';
require_once SML_GPRO_DIR . 'includes/surface.php';
