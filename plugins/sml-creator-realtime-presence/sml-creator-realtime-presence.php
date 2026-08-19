<?php
/**
 * Plugin Name: SML Creator Realtime Presence
 * Description: Privacy-preserving first-party viewer presence for creator analytics.
 * Version: 1.0.0
 * Author: Stock Market Loop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

$sml_presence_source = __DIR__ . '/creator-realtime-presence.raw.php';
if ( ! is_readable( $sml_presence_source ) ) {
	return;
}
$sml_presence_code = (string) file_get_contents( $sml_presence_source );
if ( '' !== trim( $sml_presence_code ) ) {
	eval( $sml_presence_code ); // phpcs:ignore Squiz.PHP.Eval.Discouraged -- trusted bundled source shared with WPCode.
}
unset( $sml_presence_code, $sml_presence_source );
