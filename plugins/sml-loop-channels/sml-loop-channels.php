<?php
/**
 * Plugin Name: SML Loop Channels
 * Description: The fast layer for Loop Channels (/channel/{handle}/). Serves a lean, cacheable page with the channel painted server-side (indexable, with ProfilePage and VideoObject schema and real link previews), preloads every API call the channel app makes, and gives the creator a Design studio: theme presets, any accent colour, fonts, a full-width channel banner (image, GIF or video), a page background, layout (sidebar side, section order, video grid), and the immersive motion layer from Loop Letters.
 * Version: 1.0.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_LC_VERSION', '1.0.0' );
define( 'SML_LC_FILE', __FILE__ );
define( 'SML_LC_DIR', __DIR__ );
define( 'SML_LC_NS', 'sml-channel-design/v1' );

function sml_lc_asset( $file ) { return plugins_url( 'assets/' . $file, SML_LC_FILE ) . '?v=' . rawurlencode( SML_LC_VERSION ); }

require_once SML_LC_DIR . '/includes/design.php';
require_once SML_LC_DIR . '/includes/page.php';
require_once SML_LC_DIR . '/includes/rest.php';
