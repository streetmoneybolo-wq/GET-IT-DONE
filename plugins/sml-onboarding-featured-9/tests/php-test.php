<?php
define( 'ABSPATH', '/' );
function add_filter() {}
require __DIR__ . '/../sml-onboarding-featured-9.php';
$fail = 0; $n = 0;
function check( $name, $ok ) { global $fail, $n; $n++; if ( ! $ok ) { $fail++; echo "FAIL $name\n"; } }
check( 'keeps 9 in order', array( 1, 2, 3, 4, 5, 6, 7, 8, 9 ) === sml_of9_clean( array( 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 ) ) );
check( 'drops duplicates and junk', array( 3, 1 ) === sml_of9_clean( array( 3, '3', 0, -2, 'x', 1 ) ) );
check( 'only valid channels', array( 2, 4 ) === sml_of9_clean( array( 1, 2, 3, 4 ), array( 2, 4, 9 ) ) );
check( 'not an array', array() === sml_of9_clean( 'x' ) );
$feat = array( array( 'id' => 1, 'name' => 'a', 'featured' => true ), array( 'id' => 2, 'name' => 'b', 'featured' => true ) );
$other = array( array( 'id' => 3, 'name' => 'c', 'featured' => false ), array( 'id' => 4, 'name' => 'd', 'featured' => false ), array( 'id' => 5, 'name' => 'e', 'featured' => false ) );
$p = sml_of9_partition( $feat, $other, array( 4, 1, 5, 3 ) );
check( 'featured is exactly the list in order', array( 4, 1, 5, 3 ) === array_column( $p[0], 'id' ) );
check( 'the rest is what is left', array( 2 ) === array_column( $p[1], 'id' ) );
check( 'flags follow', $p[0][0]['featured'] === true && $p[1][0]['featured'] === false );
check( 'unknown shapes are left alone', null === sml_of9_partition( array( 'x' ), array(), array( 1 ) ) );
check( 'ids not in the lists are ignored', array( 1 ) === array_column( sml_of9_partition( $feat, $other, array( 1, 99 ) )[0], 'id' ) );
$f = sml_of9_overlay_featured( array( array( 'id' => 110, 'name' => 'A' ), array( 'id' => 104, 'name' => 'B' ) ), array( 110, 104, 105, 107, 136 ), array( 107 ), array( 105 => 'C', 136 => 'D', 107 => 'E' ) );
check( 'overlay featured filled from the saved list', array( 110, 104, 105, 136 ) === array_column( $f, 'id' ) );
check( 'names kept and added', 'A' === $f[0]['name'] && 'C' === $f[2]['name'] );
check( 'open channels are never featured', ! in_array( 107, array_column( $f, 'id' ), true ) );
check( 'overlay of the wrong shape is left alone', null === sml_of9_overlay_featured( 'x', array( 1 ), array(), array() ) );
echo "$n checks, $fail failed\n"; exit( $fail ? 1 : 0 );
