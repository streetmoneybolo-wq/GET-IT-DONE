<?php
define( 'ABSPATH', __DIR__ . '/' );
define( 'DAY_IN_SECONDS', 86400 );
function add_action( ...$a ) {}
require __DIR__ . '/sml-mygroups-hot.php';
$passed = 0; $failed = 0;
function ok( $c, $name ) { global $passed, $failed; if ( $c ) $passed++; else { $failed++; echo "FAIL $name\n"; } }
$now = 1789560000;
function msg( $id, $user, $ago_h, $reactions = '[]', $ch = 110, $g = 7 ) { global $now; return array( 'id' => $id, 'channel_id' => $ch, 'group_id' => $g, 'user_id' => $user, 'message' => "m$id", 'reactions' => $reactions, 'created_ts' => $now - $ago_h * 3600 ); }
function ids( $threads ) { return array_map( function ( $t ) { return (int) $t['root']['id'] . ':' . $t['reason']; }, $threads ); }
$V = 42;

/* alerts */
ok( sml_mgh_is_alert_message( array( 'reactions' => '{"_sml_alert_id":"6aa1cddc8b230"}' ) ), 'a message tagged _sml_alert_id is an alert' );
ok( ! sml_mgh_is_alert_message( array( 'reactions' => '{"🔥":[1,2]}' ) ), 'a normal chat message is not an alert' );

/* reactions */
ok( 0 === sml_mgh_reaction_count( '{"_sml_alert_id":"x"}' ), 'the alert marker is not a reaction' );
ok( 3 === sml_mgh_reaction_count( '{"🔥":[1,2],"👍":[5]}' ), 'emoji => users list' );
ok( 4 === sml_mgh_reaction_count( '{"🔥":3,"👍":{"count":1}}' ), 'emoji => count forms' );
ok( 2 === sml_mgh_reaction_count( '[{"emoji":"🔥","user":1},{"emoji":"👍","user":2}]' ), 'list of reaction objects' );
ok( 0 === sml_mgh_reaction_count( '[]' ) && 0 === sml_mgh_reaction_count( '' ) && 0 === sml_mgh_reaction_count( 'garbage' ), 'empty / junk is zero' );

/* your thread: viewer posted, someone else is in it */
$m = array( 1 => msg( 1, $V, 5 ), 2 => msg( 2, 7, 4 ) );
ok( array( '1:your_thread' ) === ids( sml_mgh_select_threads( $m, array( 2 => 1 ), $V, $now ) ), 'viewer started a thread and someone replied' );
$m = array( 1 => msg( 1, 7, 5 ), 2 => msg( 2, $V, 4 ) );
ok( array( '1:your_thread' ) === ids( sml_mgh_select_threads( $m, array( 2 => 1 ), $V, $now ) ), 'viewer replied in someone else\'s thread' );
$m = array( 1 => msg( 1, $V, 5 ), 2 => msg( 2, $V, 4 ) );
ok( array() === ids( sml_mgh_select_threads( $m, array( 2 => 1 ), $V, $now ) ), 'a thread with only the viewer in it is not shown' );

/* hot */
$m = array( 1 => msg( 1, 7, 5 ), 2 => msg( 2, 8, 4 ), 3 => msg( 3, 9, 3 ) );
ok( array( '1:hot' ) === ids( sml_mgh_select_threads( $m, array( 2 => 1, 3 => 2 ), $V, $now ) ), '2 replies from other people is hot (nested reply counts toward the root)' );
$m = array( 1 => msg( 1, 7, 5 ), 2 => msg( 2, 7, 4 ), 3 => msg( 3, 7, 3 ) );
ok( array() === ids( sml_mgh_select_threads( $m, array( 2 => 1, 3 => 1 ), $V, $now ) ), 'someone talking to themselves is not hot (the live 196/197 case)' );
$m = array( 1 => msg( 1, 7, 5, '{"🔥":[1,2,3]}' ) );
ok( array( '1:hot' ) === ids( sml_mgh_select_threads( $m, array(), $V, $now ) ), '3 reactions make a single message hot' );
$m = array( 1 => msg( 1, 7, 5, '{"🔥":[1,2]}' ) );
ok( array() === ids( sml_mgh_select_threads( $m, array(), $V, $now ) ), '2 reactions are not enough' );
$m = array( 1 => msg( 1, 7, 5 ) );
ok( array() === ids( sml_mgh_select_threads( $m, array(), $V, $now ) ), 'a lone message nobody engaged with is not shown' );

$m = array( 1 => msg( 1, 7, 5 ), 2 => msg( 2, 8, 4 ) );
ok( array() === ids( sml_mgh_select_threads( $m, array( 2 => 1 ), $V, $now ) ), 'one reply between two other people is not hot yet' );
ok( 0 === sml_mgh_reaction_count( '{"_internal":[1,2,3],"🔥":[4]}' ) - 1, 'underscore keys never count, even when they hold a list' );

/* freshness + eligibility */
$m = array( 1 => msg( 1, 7, 24 * 9 ), 2 => msg( 2, 8, 24 * 8 ), 3 => msg( 3, 9, 24 * 8 ) );
ok( array() === ids( sml_mgh_select_threads( $m, array( 2 => 1, 3 => 1 ), $V, $now ) ), 'a hot thread with no activity in 7 days is gone' );
$m = array( 1 => msg( 1, 7, 24 * 20 ), 2 => msg( 2, $V, 2 ), 3 => msg( 3, 8, 1 ) );
ok( array( '1:your_thread' ) === ids( sml_mgh_select_threads( $m, array( 2 => 1, 3 => 1 ), $V, $now ) ), 'an old root with fresh replies is judged by its latest activity' );
$m = array( 2 => msg( 2, $V, 2 ), 3 => msg( 3, 8, 1 ) );
ok( array() === ids( sml_mgh_select_threads( $m, array( 2 => 1, 3 => 1 ), $V, $now ) ), 'replies to a root that is not eligible (alert/other channel) never surface' );
$m = array( 1 => msg( 1, $V, 9 ), 2 => msg( 2, 7, 8 ), 5 => msg( 5, 7, 3 ), 6 => msg( 6, 8, 2 ), 7 => msg( 7, 9, 1 ) );
ok( array( '5:hot', '1:your_thread' ) === ids( sml_mgh_select_threads( $m, array( 2 => 1, 6 => 5, 7 => 5 ), $V, $now ) ), 'threads are ordered by latest activity' );
$m = array( 1 => msg( 1, 7, 3 ), 2 => msg( 2, 8, 2 ) );
ok( array() === ids( sml_mgh_select_threads( $m, array( 1 => 2, 2 => 1 ), $V, $now ) ), 'a reply cycle does not loop forever and shows nothing' );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
