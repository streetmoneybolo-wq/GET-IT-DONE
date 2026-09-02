<?php
/** Lightweight release-contract checks; no WordPress bootstrap required. */

$php = file_get_contents( dirname( __DIR__ ) . '/sml-retail-trader-spotlight.php' );
$js = file_get_contents( dirname( __DIR__ ) . '/assets/retail-trader-spotlight.js' );
$checks = array(
	'global product name' => false !== strpos( $php, "'Retail Trader Spotlight'" ) && false === stripos( $php . $js, 'Making Easy Money Spotlight' ),
	'v1.4 release' => false !== strpos( $php, "const VERSION = '1.4.0'" ),
	'v4 tenant-safe schema' => false !== strpos( $php, "const DB_VERSION = '4'" ) && false !== strpos( $php, 'UNIQUE KEY group_message (group_id,guild_id,discord_message_id)' ),
	'exact message trace route' => false !== strpos( $php, '/trace/(?P<message_id>\\d{15,24})' ),
	'idempotent recovery route' => false !== strpos( $php, '/recover' ) && false !== strpos( $php, '$this->bot_alert( $internal )' ),
	'group-scoped Discord cursor' => false !== strpos( $php, '$config[\'group_id\'] . \':\' . $config[\'guild_id\'] . \':\' . $config[\'channel_id\']' ),
	'group-scoped source key' => false !== strpos( $php, '\'discord:\' . $row[\'group_id\'] . \':\' . $row[\'guild_id\']' ),
	'poll health persisted' => false !== strpos( $php, "update_option( 'sml_rts_poll_health'" ),
	'reason-coded ignored alerts' => false !== strpos( $php, "'alert_ignored'" ) && false !== strpos( $php, "'multiple_tickers'" ),
	'manager recovery UI' => false !== strpos( $js, 'Recover missed alert' ) && false !== strpos( $js, 'Trace alert' ),
);

$failed = array_keys( array_filter( $checks, static function ( $passed ) { return ! $passed; } ) );
foreach ( $checks as $label => $passed ) echo ( $passed ? 'ok ' : 'not ok ' ) . $label . PHP_EOL;
if ( $failed ) {
	fwrite( STDERR, 'Failed: ' . implode( ', ', $failed ) . PHP_EOL );
	exit( 1 );
}
