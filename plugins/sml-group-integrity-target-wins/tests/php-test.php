<?php
define( 'ABSPATH', '/' );
function add_action() {} function add_filter() {}
require __DIR__ . '/../sml-group-integrity-target-wins.php';
$fail = 0; $n = 0;
function check( $name, $ok ) { global $fail, $n; $n++; if ( ! $ok ) { $fail++; echo "FAIL $name\n"; } }
$long  = array( 'direction' => 'long', 'entry_price' => 100, 'target_price' => 110, 'alert_at_utc' => '2026-10-01 14:00:00' );
$short = array( 'direction' => 'short', 'entry_price' => 100, 'target_price' => 90, 'alert_at_utc' => '2026-10-01 14:00:00' );
$t0 = strtotime( '2026-10-01 14:00:00 UTC' ) * 1000;
check( 'long hit', sml_gitw_target_hit( array( array( 't' => $t0 + 60000, 'h' => 111, 'l' => 99, 'c' => 110 ) ), $long ) );
check( 'long exactly at target', sml_gitw_target_hit( array( array( 't' => $t0 + 60000, 'h' => 110, 'l' => 99, 'c' => 105 ) ), $long ) );
check( 'long miss', ! sml_gitw_target_hit( array( array( 't' => $t0 + 60000, 'h' => 109.9, 'l' => 99, 'c' => 105 ) ), $long ) );
check( 'before alert ignored', ! sml_gitw_target_hit( array( array( 't' => $t0 - 60000, 'h' => 150, 'l' => 99, 'c' => 105 ) ), $long ) );
check( 'short hit', sml_gitw_target_hit( array( array( 't' => $t0 + 60000, 'h' => 101, 'l' => 89.5, 'c' => 95 ) ), $short ) );
check( 'short miss', ! sml_gitw_target_hit( array( array( 't' => $t0 + 60000, 'h' => 101, 'l' => 90.5, 'c' => 95 ) ), $short ) );
check( 'no target', ! sml_gitw_target_hit( array( array( 't' => $t0 + 60000, 'h' => 500, 'l' => 1, 'c' => 5 ) ), array( 'target_price' => 0 ) + $long ) );
check( 'return long', abs( sml_gitw_target_return( $long ) - 10 ) < 1e-9 );
check( 'return short', abs( sml_gitw_target_return( $short ) - 10 ) < 1e-9 );
check( 'return none', null === sml_gitw_target_return( array( 'entry_price' => 100, 'target_price' => 0 ) ) );
echo "$n checks, $fail failed\n"; exit( $fail ? 1 : 0 );
