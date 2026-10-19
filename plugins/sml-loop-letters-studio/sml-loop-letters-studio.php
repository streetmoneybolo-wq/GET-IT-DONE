<?php
/**
 * Plugin Name: SML Loop Letters Studio
 * Description: The reading and writing layer for Loop Letters. One public letter page that owns its search metadata (NewsArticle schema, share images in three ratios, canonical handles, news and full sitemaps, IndexNow), a 15-second intro video, a voice or YouTube audio track, an immersive motion layer, reactions, highlights, a share-card designer and a writer's studio with SEO, readability, templates and scheduling.
 * Version: 1.0.3
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_LLS_VERSION', '1.0.3' );
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

/*
 * Other layers on this site buffer the page and rewrite the robots tag after it is printed.
 * Buffers unwind last-in first-out, so the earliest buffer has the final word: this one is
 * opened at plugins_loaded, on letter paths only, and re-asserts the tags the page decided on.
 */
add_action( 'plugins_loaded', 'sml_lls_outer_buffer', 1 );
function sml_lls_outer_buffer() {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'WP_CLI' ) && WP_CLI ) ) { return; }
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	if ( ! preg_match( '#^(n|letters)/[^/]+/[^/]+$#', $path ) ) { return; }
	ob_start( 'sml_lls_final_html' );
}
function sml_lls_final_html( $html ) {
	if ( ! is_string( $html ) || empty( $GLOBALS['sml_lls_final'] ) || strpos( $html, 'lls-page' ) === false ) { return $html; }
	$f = $GLOBALS['sml_lls_final'];
	$html = preg_replace( '#<meta[^>]+name=["\']?robots["\']?[^>]*>\s*#i', '', $html );
	$html = preg_replace( '#<meta[^>]+name=["\']?googlebot["\']?[^>]*>\s*#i', '', $html );
	$html = preg_replace( '#<link[^>]+rel=["\']canonical["\'][^>]*>\s*#i', '', $html );
	$pos = stripos( $html, '</head>' );
	return $pos === false ? $html : substr( $html, 0, $pos ) . $f['robots'] . $f['canonical'] . substr( $html, $pos );
}

register_activation_hook( SML_LLS_FILE, 'sml_lls_install' );
add_action( 'init', 'sml_lls_maybe_install', 3 );
function sml_lls_maybe_install() {
	if ( get_option( 'sml_lls_db_version' ) !== SML_LLS_VERSION ) { sml_lls_install(); }
}
