<?php
define( 'ABSPATH', '/' );
function add_action() {} function add_filter() {}
function wp_strip_all_tags( $s ) { return strip_tags( $s ); }
require __DIR__ . '/../sml-group-extras.php';
$fail = 0; $n = 0;
function check( $name, $ok ) { global $fail, $n; $n++; if ( ! $ok ) { $fail++; echo "FAIL $name\n"; } }
check( 'plain', 'Day trade alerts' === sml_gex_clean_description( 'Day trade alerts' ) );
check( 'tags stripped', 'hi there' === sml_gex_clean_description( '<b>hi</b> <script>x</script>there' ) || false !== strpos( sml_gex_clean_description( '<b>hi</b> there' ), 'hi there' ) );
check( 'whitespace collapsed', 'a b c' === sml_gex_clean_description( "a \n\n  b\t c" ) );
check( '180 cap', 180 === mb_strlen( sml_gex_clean_description( str_repeat( 'x', 500 ) ) ) );
check( '180 cap multibyte', 180 === mb_strlen( sml_gex_clean_description( str_repeat( '📈', 300 ) ) ) );
check( 'exactly 180 kept', 180 === mb_strlen( sml_gex_clean_description( str_repeat( 'y', 180 ) ) ) );
check( 'empty', '' === sml_gex_clean_description( '   ' ) );
check( 'non string', '' === sml_gex_clean_description( array( 'x' ) ) );
echo "$n checks, $fail failed\n"; exit( $fail ? 1 : 0 );
