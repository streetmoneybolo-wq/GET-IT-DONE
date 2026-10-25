<?php
/**
 * Plugin Name: SML Website Dev
 * Description: The owner's command center for stockmarketloop.com, for administrators only. An EVOLVE button on every page opens the Website Dev panel: every bug the site throws, live (JavaScript errors, failed requests, PHP warnings and fatals, REST failures, 404s), what is slow and why (server time, queries, memory, Web Vitals per page), hourly health checks (sitemaps, indexability, REST namespaces, CDN pins, IndexNow, cron, duplicate plugins), and the Evolve engine: a daily brief with concrete, evidence-backed proposals, knobs the system turns on its own within rails, a competitor watch that reads what other platforms ship and turns it into ideas for this one, and a learning loop that measures each shipped change and re-weights what it proposes next. Visitors only ever run a small, anonymous telemetry beacon.
 * Version: 1.0.0
 * Author: StockMarketLoop
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_WD_VERSION', '1.0.0' );
define( 'SML_WD_FILE', __FILE__ );
define( 'SML_WD_DIR', __DIR__ );
define( 'SML_WD_NS', 'sml-dev/v1' );
define( 'SML_WD_DB_VERSION', '1' );

function sml_wd_asset( $file ) { return plugins_url( 'assets/' . $file, SML_WD_FILE ) . '?v=' . rawurlencode( SML_WD_VERSION ); }

/** Owners and administrators only. Everything in the panel, every admin route and the admin page sit behind this. */
function sml_wd_can() { return is_user_logged_in() && current_user_can( 'manage_options' ); }

/** Site-level settings with their defaults. Knob values live in the Evolve state, not here. */
function sml_wd_settings() {
	$defaults = array(
		'beacon_enabled'  => true,
		'competitors'     => sml_wd_default_competitors(),
		'watch_pages'     => array( '/', '/loop-letters/', '/markets/', '/channel/grandmasterobi/', '/create-channel/' ),
		'anthropic_model' => 'claude-sonnet-5',
		'brief_hour_utc'  => 7,
	);
	$saved = get_option( 'sml_wd_settings', array() );
	return array_merge( $defaults, is_array( $saved ) ? $saved : array() );
}
function sml_wd_save_settings( array $patch ) {
	$cur = sml_wd_settings();
	foreach ( $patch as $k => $v ) {
		if ( ! array_key_exists( $k, $cur ) ) { continue; }
		if ( 'competitors' === $k || 'watch_pages' === $k ) { $cur[ $k ] = array_values( array_filter( array_map( 'sanitize_text_field', (array) $v ) ) ); }
		elseif ( 'beacon_enabled' === $k ) { $cur[ $k ] = (bool) $v; }
		elseif ( 'brief_hour_utc' === $k ) { $cur[ $k ] = max( 0, min( 23, (int) $v ) ); }
		else { $cur[ $k ] = sanitize_text_field( (string) $v ); }
	}
	update_option( 'sml_wd_settings', $cur, false );
	return $cur;
}

/** The model key is never stored in the panel or returned by any route: a constant in wp-config.php, or the option set once from WP-CLI. */
function sml_wd_ai_key() {
	if ( defined( 'SML_WD_ANTHROPIC_KEY' ) && SML_WD_ANTHROPIC_KEY ) { return (string) SML_WD_ANTHROPIC_KEY; }
	if ( defined( 'ANTHROPIC_API_KEY' ) && ANTHROPIC_API_KEY ) { return (string) ANTHROPIC_API_KEY; }
	return (string) get_option( 'sml_wd_anthropic_key', '' );
}

require_once SML_WD_DIR . '/includes/logic.php';
require_once SML_WD_DIR . '/includes/store.php';
require_once SML_WD_DIR . '/includes/capture.php';
require_once SML_WD_DIR . '/includes/checks.php';
require_once SML_WD_DIR . '/includes/competitors.php';
require_once SML_WD_DIR . '/includes/evolve.php';
require_once SML_WD_DIR . '/includes/rest.php';
require_once SML_WD_DIR . '/includes/client.php';

/* ---------- lifecycle ---------- */
register_activation_hook( __FILE__, 'sml_wd_activate' );
function sml_wd_activate() {
	sml_wd_install_table();
	sml_wd_schedule();
}
register_deactivation_hook( __FILE__, 'sml_wd_deactivate' );
function sml_wd_deactivate() {
	foreach ( array( 'sml_wd_cron_checks', 'sml_wd_cron_brief', 'sml_wd_cron_competitors', 'sml_wd_cron_prune' ) as $hook ) {
		$ts = wp_next_scheduled( $hook );
		while ( $ts ) { wp_unschedule_event( $ts, $hook ); $ts = wp_next_scheduled( $hook ); }
	}
}

/* the table is created on activation; this catches an upload that replaced the folder without a re-activation */
add_action( 'init', 'sml_wd_maybe_upgrade', 1 );
function sml_wd_maybe_upgrade() {
	if ( get_option( 'sml_wd_db_version' ) !== SML_WD_DB_VERSION ) { sml_wd_install_table(); }
	if ( ! wp_next_scheduled( 'sml_wd_cron_checks' ) ) { sml_wd_schedule(); }
}

add_filter( 'cron_schedules', function ( $s ) {
	$s['sml_wd_30min'] = array( 'interval' => 1800, 'display' => 'Every 30 minutes (SML Website Dev)' );
	return $s;
} );
function sml_wd_schedule() {
	if ( ! wp_next_scheduled( 'sml_wd_cron_checks' ) ) { wp_schedule_event( time() + 120, 'hourly', 'sml_wd_cron_checks' ); }
	if ( ! wp_next_scheduled( 'sml_wd_cron_brief' ) ) { wp_schedule_event( time() + 600, 'hourly', 'sml_wd_cron_brief' ); }
	if ( ! wp_next_scheduled( 'sml_wd_cron_competitors' ) ) { wp_schedule_event( time() + 300, 'sml_wd_30min', 'sml_wd_cron_competitors' ); }
	if ( ! wp_next_scheduled( 'sml_wd_cron_prune' ) ) { wp_schedule_event( time() + 900, 'daily', 'sml_wd_cron_prune' ); }
}
add_action( 'sml_wd_cron_checks', function () { sml_wd_run_checks( 'cron' ); } );
add_action( 'sml_wd_cron_brief', function () { if ( sml_wd_evolve_due() ) { sml_wd_run_brief( 'scheduled' ); } } );
add_action( 'sml_wd_cron_competitors', function () { if ( sml_wd_competitors_due() ) { sml_wd_scan_competitors( 'cron' ); } } );
add_action( 'sml_wd_cron_prune', function () { sml_wd_prune( (int) sml_wd_knob( 'retentionDays' ) ); } );

/* ---------- wp-admin entry: Tools → Website Dev (the same panel, for when the front end is the thing that is broken) ---------- */
add_action( 'admin_menu', function () {
	add_management_page( 'Website Dev', 'Website Dev', 'manage_options', 'sml-website-dev', 'sml_wd_admin_page' );
} );
function sml_wd_admin_page() {
	if ( ! sml_wd_can() ) { wp_die( 'Administrators only.' ); }
	wp_enqueue_style( 'sml-wd', sml_wd_asset( 'dev.css' ), array(), SML_WD_VERSION );
	wp_enqueue_script( 'sml-wd', sml_wd_asset( 'dev.js' ), array(), SML_WD_VERSION, true );
	wp_add_inline_script( 'sml-wd', 'window.SML_WD_ADMIN=' . wp_json_encode( sml_wd_client_config( true ) ) . ';', 'before' );
	echo '<div class="wrap"><h1 class="screen-reader-text">Website Dev</h1><div id="sml-wd-inline" class="sml-wd-inline"></div></div>';
}
