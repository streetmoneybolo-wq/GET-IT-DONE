<?php
/**
 * Plugin Name: SML Pro Tools Installer
 * Description: One-shot: installs Group Pro Tools 1.0.1 from the project repo on activation and activates it.
 * Version: 1.0.1
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
define( 'SML_GPRO_INSTALL_URL', 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@0af8b5c05228f3bd3e9b12c1f044dcbe7ec58455/plugins/dist/sml-group-pro-tools-1.0.1.zip' );
function sml_gpro_installer_run() {
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/plugin.php';
	$tmp = download_url( SML_GPRO_INSTALL_URL, 60 );
	if ( is_wp_error( $tmp ) ) { update_option( 'sml_gpro_installer_result', 'download: ' . $tmp->get_error_message(), false ); return; }
	WP_Filesystem();
	$r = unzip_file( $tmp, WP_PLUGIN_DIR );
	@unlink( $tmp );
	if ( is_wp_error( $r ) ) { update_option( 'sml_gpro_installer_result', 'unzip: ' . $r->get_error_message(), false ); return; }
	wp_clean_plugins_cache( true );
	$a = activate_plugin( 'sml-group-pro-tools/sml-group-pro-tools.php' );
	update_option( 'sml_gpro_installer_result', is_wp_error( $a ) ? 'activate: ' . $a->get_error_message() : 'ok ' . date( 'c' ), false );
}
register_activation_hook( __FILE__, 'sml_gpro_installer_run' );
