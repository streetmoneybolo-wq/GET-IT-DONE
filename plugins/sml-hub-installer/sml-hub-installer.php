<?php
/**
 * Plugin Name: SML Hub Installer
 * Description: One-shot: installs Group Settings Hub 1.0.6 from the project repo on activation, then deactivates itself.
 * Version: 1.0.0
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
define( 'SML_HUB_INSTALL_URL', 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@fc6f08e24bb80ea5c69136c8e90c06111488c4d7/plugins/dist/sml-group-settings-hub-1.0.6.zip' );
function sml_hub_installer_run() {
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	$tmp = download_url( SML_HUB_INSTALL_URL, 60 );
	if ( is_wp_error( $tmp ) ) { update_option( 'sml_hub_installer_result', 'download: ' . $tmp->get_error_message(), false ); return; }
	WP_Filesystem();
	$r = unzip_file( $tmp, WP_PLUGIN_DIR );
	@unlink( $tmp );
	if ( is_wp_error( $r ) ) { update_option( 'sml_hub_installer_result', 'unzip: ' . $r->get_error_message(), false ); return; }
	wp_clean_plugins_cache( true );
	$a = activate_plugin( 'sml-group-settings-hub/sml-group-settings-hub.php' );
	update_option( 'sml_hub_installer_result', is_wp_error( $a ) ? 'activate: ' . $a->get_error_message() : 'ok ' . date( 'c' ), false );
}
register_activation_hook( __FILE__, 'sml_hub_installer_run' );
