<?php
/* sml_hub_clean_icon: run with `php tests/icon-test.php` (WordPress functions are stubbed). */
define( 'ABSPATH', '/' );
function wp_strip_all_tags( $s ) { return strip_tags( $s ); }
function esc_url_raw( $u, $protocols = null ) { return filter_var( $u, FILTER_VALIDATE_URL ) && ( ! $protocols || in_array( parse_url( $u, PHP_URL_SCHEME ), $protocols, true ) ) ? $u : ''; }
function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); }
function home_url() { return 'https://stockmarketloop.com'; }
function wp_get_upload_dir() { return array( 'baseurl' => 'https://stockmarketloop.com/wp-content/uploads' ); }
/* load only the helper out of the plugin file */
$src = file_get_contents( __DIR__ . '/../sml-group-settings-hub.php' );
preg_match( '/function sml_hub_clean_icon\(.*?\n}\n/s', $src, $m );
eval( $m[0] );
$fail = 0; $n = 0;
function check( $name, $ok ) { global $fail, $n; $n++; if ( ! $ok ) { $fail++; echo "FAIL $name\n"; } }
check( 'emoji kept', '👑' === sml_hub_clean_icon( '👑' ) );
check( 'short text kept', 'VIP' === sml_hub_clean_icon( ' VIP ' ) );
check( 'capped at 8', 8 === mb_strlen( sml_hub_clean_icon( str_repeat( 'x', 30 ) ) ) );
check( 'markup removed', false === strpos( sml_hub_clean_icon( '<img src=x onerror=alert(1)>A' ), '<' ) );
check( 'quotes removed', '' === preg_replace( '/[^"\'`&<>]/', '', sml_hub_clean_icon( 'a"b\'c`d&e' ) ) );
check( 'own uploads image kept', 'https://stockmarketloop.com/wp-content/uploads/2026/10/x.png' === sml_hub_clean_icon( 'https://stockmarketloop.com/wp-content/uploads/2026/10/x.png' ) );
check( 'other site image dropped', '' === sml_hub_clean_icon( 'https://evil.example/x.png' ) );
check( 'http image dropped', '' === sml_hub_clean_icon( 'http://stockmarketloop.com/x.png' ) );
check( 'javascript url dropped', 0 !== strpos( sml_hub_clean_icon( 'javascript:alert(1)' ), 'javascript' ) );
check( 'empty', '' === sml_hub_clean_icon( '' ) && '' === sml_hub_clean_icon( null ) );
echo "$n checks, $fail failed\n"; exit( $fail ? 1 : 0 );
