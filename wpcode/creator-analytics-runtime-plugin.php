<?php
/**
 * Plugin Name: SML Creator Analytics Runtime
 * Description: Private creator analytics, realtime presence, and payout-disabled monetization reconciliation.
 * Version: 1.2.0
 * Author: Stock Market Loop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

$sml_creator_analytics_sources = array(
	__DIR__ . '/creator-realtime-presence.raw.php',
	__DIR__ . '/creator-ga4-data-api.raw.php',
	__DIR__ . '/creator-monetization-shadow.raw.php',
);
foreach ( $sml_creator_analytics_sources as $sml_creator_analytics_source ) {
	if ( ! is_readable( $sml_creator_analytics_source ) ) { continue; }
	$sml_creator_analytics_code = (string) file_get_contents( $sml_creator_analytics_source );
	if ( '' !== trim( $sml_creator_analytics_code ) ) {
		eval( $sml_creator_analytics_code ); // phpcs:ignore Squiz.PHP.Eval.Discouraged -- trusted bundled sources shared with WPCode.
	}
}
unset( $sml_creator_analytics_code, $sml_creator_analytics_source, $sml_creator_analytics_sources );
