<?php
/**
 * Plugin Name: SML Banner Zoom Installer
 * Description: One-shot: installs Channel Banners 1.0.7 from the project repo on activation and activates it.
 * Version: 1.0.1
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
define( 'SML_CBI_INSTALL_URL', 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@SHA/plugins/dist/sml-channel-banners-1.0.7.zip' );
function sml_cbi_installer_run() {
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	$tmp = download_url( SML_CBI_INSTALL_URL, 60 );
	if ( is_wp_error( $tmp ) ) { update_option( 'sml_cbi_installer_result', 'download: ' . $tmp->get_error_message(), false ); return; }
	WP_Filesystem();
	$r = unzip_file( $tmp, WP_PLUGIN_DIR );
	@unlink( $tmp );
	if ( is_wp_error( $r ) ) { update_option( 'sml_cbi_installer_result', 'unzip: ' . $r->get_error_message(), false ); return; }
	wp_clean_plugins_cache( true );
	$a = activate_plugin( 'sml-channel-banners/sml-channel-banners.php' );
	update_option( 'sml_cbi_installer_result', is_wp_error( $a ) ? 'activate: ' . $a->get_error_message() : 'ok ' . date( 'c' ), false );
}
register_activation_hook( __FILE__, 'sml_cbi_installer_run' );
