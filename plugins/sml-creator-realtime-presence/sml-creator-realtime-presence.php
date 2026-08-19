<?php
/**
 * Plugin Name: SML Creator Analytics Runtime
 * Description: Private GA4 creator reports and privacy-preserving first-party realtime presence.
 * Version: 1.1.0
 * Author: Stock Market Loop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

$sml_creator_analytics_sources = array(
	__DIR__ . '/creator-realtime-presence.raw.php',
	__DIR__ . '/creator-ga4-data-api.raw.php',
);
foreach ( $sml_creator_analytics_sources as $sml_creator_analytics_source ) {
	if ( ! is_readable( $sml_creator_analytics_source ) ) {
		continue;
	}
	$sml_creator_analytics_code = (string) file_get_contents( $sml_creator_analytics_source );
	if ( '' !== trim( $sml_creator_analytics_code ) ) {
		eval( $sml_creator_analytics_code ); // phpcs:ignore Squiz.PHP.Eval.Discouraged -- trusted bundled sources shared with WPCode.
	}
}
unset( $sml_creator_analytics_code, $sml_creator_analytics_source, $sml_creator_analytics_sources );
