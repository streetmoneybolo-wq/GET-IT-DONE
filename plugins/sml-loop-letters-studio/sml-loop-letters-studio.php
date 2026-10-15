<?php
/**
 * Plugin Name: SML Loop Letters Studio
 * Description: The reading and writing layer for Loop Letters. One public letter page that owns its search metadata (NewsArticle schema, share images in three ratios, canonical handles, news and full sitemaps, IndexNow), a 15-second intro video, a voice or YouTube audio track, an immersive motion layer, reactions, highlights, a share-card designer and a writer's studio with SEO, readability, templates and scheduling.
 * Version: 1.0.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_LLS_VERSION', '1.0.0' );
define( 'SML_LLS_FILE', __FILE__ );
define( 'SML_LLS_DIR', __DIR__ );
define( 'SML_LLS_NS', 'sml-letter-studio/v1' );

function sml_lls_url( $file ) { return plugins_url( $file, SML_LLS_FILE ); }
function sml_lls_asset( $file ) { return sml_lls_url( 'assets/' . $file ) . '?v=' . rawurlencode( SML_LLS_VERSION ); }

require_once SML_LLS_DIR . '/includes/data.php';
require_once SML_LLS_DIR . '/includes/card.php';
require_once SML_LLS_DIR . '/includes/seo.php';
require_once SML_LLS_DIR . '/includes/reader.php';
require_once SML_LLS_DIR . '/includes/rest.php';
require_once SML_LLS_DIR . '/includes/studio.php';

register_activation_hook( SML_LLS_FILE, 'sml_lls_install' );
add_action( 'init', 'sml_lls_maybe_install', 3 );
function sml_lls_maybe_install() {
	if ( get_option( 'sml_lls_db_version' ) !== SML_LLS_VERSION ) { sml_lls_install(); }
}
