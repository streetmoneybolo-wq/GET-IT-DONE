<?php
/**
 * Plugin Name: SML Pro Tools Installer
 * Description: One-shot: installs Group Pro Tools 1.0.0 from the project repo on activation and activates it.
 * Version: 1.0.0
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
define( 'SML_GPRO_INSTALL_URL', 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@9ed7b9c18b1ece38c4f96f49632c29e783efc46a/plugins/dist/sml-group-pro-tools-1.0.0.zip' );
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
