<?php
/**
 * What the browser gets: every visitor runs the small anonymous beacon; administrators also get the EVOLVE button and
 * the Website Dev panel on every front-end page, an admin-bar entry, and the same panel under Tools in wp-admin.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_wd_client_config( $inline = false ) {
	return array(
		'rest' => esc_url_raw( rest_url( SML_WD_NS ) ), 'nonce' => wp_create_nonce( 'wp_rest' ), 'home' => home_url( '/' ), 'host' => wp_parse_url( home_url(), PHP_URL_HOST ),
		'user' => wp_get_current_user()->display_name, 'version' => SML_WD_VERSION, 'inline' => (bool) $inline, 'adminUrl' => admin_url( 'tools.php?page=sml-website-dev' ),
		'repo' => 'https://github.com/streetmoneybolo-wq/GET-IT-DONE',
	);
}

add_action( 'wp_enqueue_scripts', 'sml_wd_enqueue', 20 );
function sml_wd_enqueue() {
	$settings = sml_wd_settings();
	if ( $settings['beacon_enabled'] ) {
		wp_enqueue_script( 'sml-wd-beacon', sml_wd_asset( 'beacon.js' ), array(), SML_WD_VERSION, array( 'in_footer' => true, 'strategy' => 'defer' ) );
		wp_add_inline_script( 'sml-wd-beacon', 'window.SML_WD=' . wp_json_encode( array( 'beacon' => esc_url_raw( rest_url( SML_WD_NS . '/beacon' ) ), 'rate' => (int) sml_wd_knob( 'beaconSampleRate' ), 'admin' => sml_wd_can(), 'path' => sml_wd_current_path() ), JSON_UNESCAPED_SLASHES ) . ';', 'before' );
	}
	if ( ! sml_wd_can() ) { return; }
	wp_enqueue_style( 'sml-wd', sml_wd_asset( 'dev.css' ), array(), SML_WD_VERSION );
	wp_enqueue_script( 'sml-wd', sml_wd_asset( 'dev.js' ), array(), SML_WD_VERSION, array( 'in_footer' => true, 'strategy' => 'defer' ) );
	wp_add_inline_script( 'sml-wd', 'window.SML_WD_ADMIN=' . wp_json_encode( sml_wd_client_config( false ), JSON_UNESCAPED_SLASHES ) . ';', 'before' );
}

/* pages that print their own <body> without wp_footer (several SML screens do) still get the beacon through wp_head when the footer never runs */
add_action( 'wp_head', function () {
	if ( ! sml_wd_settings()['beacon_enabled'] || wp_script_is( 'sml-wd-beacon', 'enqueued' ) ) { return; }
	echo '<script>window.SML_WD=' . wp_json_encode( array( 'beacon' => esc_url_raw( rest_url( SML_WD_NS . '/beacon' ) ), 'rate' => (int) sml_wd_knob( 'beaconSampleRate' ), 'admin' => sml_wd_can(), 'path' => sml_wd_current_path() ), JSON_UNESCAPED_SLASHES ) . ';</script><script defer src="' . esc_url( sml_wd_asset( 'beacon.js' ) ) . '"></script>' . "\n"; // phpcs:ignore
}, 99 );

add_action( 'admin_bar_menu', function ( $bar ) {
	if ( ! sml_wd_can() ) { return; }
	$checks = get_option( 'sml_wd_checks', array() );
	$fail = isset( $checks['summary']['fail'] ) ? (int) $checks['summary']['fail'] : 0;
	$bar->add_node( array( 'id' => 'sml-website-dev', 'title' => '<span class="ab-icon dashicons dashicons-superhero" style="top:2px"></span> Website Dev' . ( $fail ? ' <span style="background:#f2495c;color:#fff;border-radius:9px;padding:0 6px;font-size:11px">' . $fail . '</span>' : '' ), 'href' => admin_url( 'tools.php?page=sml-website-dev' ), 'meta' => array( 'title' => 'Bugs, speed, health checks and the Evolve engine' ) ) );
}, 90 );
