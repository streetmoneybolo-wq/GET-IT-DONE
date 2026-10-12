<?php
/* Local proof of the decision logic in SML Edge Cache, run with: php -d display_errors=1 tests/test-edge-cache.php
   WordPress is stubbed just enough for the file to load; the hooks section is skipped because add_action is undefined. */
define( 'ABSPATH', __DIR__ . '/' );
function wp_parse_args( $args, $defaults ) { return array_merge( $defaults, (array) $args ); }
function get_option( $k, $d = array() ) { return $d; }
require dirname( __DIR__ ) . '/sml-edge-cache.php';

$fail = 0;
function check( $name, $cond, $extra = '' ) { global $fail; echo ( $cond ? 'ok   ' : 'FAIL ' ) . $name . ( $cond ? '' : '  ' . $extra ) . "\n"; if ( ! $cond ) { $fail++; } }

$cfg = sml_ec_defaults();
$anon = array( 'method' => 'GET', 'path' => '/', 'query' => '', 'cookies' => array(), 'logged_in' => false, 'is_404' => false, 'is_preview' => false, 'is_search' => false, 'is_feed' => false, 'is_admin' => false, 'is_rest' => false, 'donotcachepage' => false, 'set_cookie' => false );

/* 1. the home page for a logged-out visitor is cached with public headers */
$d = sml_ec_decide( $anon, $cfg );
check( 'anonymous home page is cacheable', $d['cache'] === true && $d['reason'] === 'cacheable' );
check( 'public cache-control with browser, edge and stale windows', $d['headers']['Cache-Control'] === 'public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=3600', $d['headers']['Cache-Control'] );
check( 'vary on encoding and cookie', $d['headers']['Vary'] === 'Accept-Encoding, Cookie' );

/* 2. everything that must never be cached */
check( 'logged-in member', sml_ec_decide( array_merge( $anon, array( 'logged_in' => true ) ), $cfg )['reason'] === 'logged_in' );
check( 'POST', sml_ec_decide( array_merge( $anon, array( 'method' => 'POST' ) ), $cfg )['reason'] === 'method' );
check( 'HEAD is fine', sml_ec_decide( array_merge( $anon, array( 'method' => 'HEAD' ) ), $cfg )['cache'] === true );
check( 'admin', sml_ec_decide( array_merge( $anon, array( 'is_admin' => true ) ), $cfg )['reason'] === 'admin_or_rest' );
check( 'REST', sml_ec_decide( array_merge( $anon, array( 'is_rest' => true ) ), $cfg )['reason'] === 'admin_or_rest' );
check( 'preview', sml_ec_decide( array_merge( $anon, array( 'is_preview' => true ) ), $cfg )['reason'] === 'preview' );
check( 'search', sml_ec_decide( array_merge( $anon, array( 'is_search' => true ) ), $cfg )['reason'] === 'search' );
check( 'DONOTCACHEPAGE wins', sml_ec_decide( array_merge( $anon, array( 'donotcachepage' => true ) ), $cfg )['reason'] === 'donotcachepage' );
check( 'a response that sets a cookie', sml_ec_decide( array_merge( $anon, array( 'set_cookie' => true ) ), $cfg )['reason'] === 'response_sets_cookie' );
check( 'disabled', sml_ec_decide( $anon, array_merge( $cfg, array( 'enabled' => 0 ) ) )['reason'] === 'disabled' );

/* 3. cookies that mark a visitor as not anonymous */
foreach ( array( 'wordpress_logged_in_abc123', 'wp-postpass_x', 'comment_author_x', 'woocommerce_items_in_cart', 'wp_woocommerce_session_x', 'PHPSESSID', 'sml_lbm_ref' ) as $c ) {
	check( "cookie $c bypasses", strpos( sml_ec_decide( array_merge( $anon, array( 'cookies' => array( $c => '1' ) ) ), $cfg )['reason'], 'cookie:' ) === 0 );
}
check( 'harmless cookies do not bypass', sml_ec_decide( array_merge( $anon, array( 'cookies' => array( '_ga' => 'x', 'wordpress_test_cookie' => 'WP Cookie check', 'cookie_consent' => 'yes' ) ) ), $cfg )['cache'] === true );

/* 4. excluded paths: prefix match on path segments only */
foreach ( array( '/wp-admin/', '/wp-admin', '/wp-login.php', '/wp-json/sml/v1/x', '/cart/', '/checkout/pay/', '/my-account/', '/store/', '/register/', '/connect-discord/', '/creator-studio/analytics/', '/verify/abc' ) as $p ) {
	check( "excluded $p", sml_ec_decide( array_merge( $anon, array( 'path' => $p ) ), $cfg )['reason'] === 'excluded_path' );
}
foreach ( array( '/groups/making-easy-money/', '/markets/', '/grandmasterobi/', '/nvda-stock-news-nvidia-holds-steady/', '/storefront-news/', '/analyst-dashboard/' ) as $p ) {
	check( "cached $p", sml_ec_decide( array_merge( $anon, array( 'path' => $p ) ), $cfg )['cache'] === true );
}

/* 5. query strings: tracking params are fine, anything else is not */
check( 'utm/fbclid query still cached', sml_ec_decide( array_merge( $anon, array( 'query' => 'utm_source=x&fbclid=abc' ) ), $cfg )['cache'] === true );
check( 'other query not cached', sml_ec_decide( array_merge( $anon, array( 'query' => 'sml_group_tool=1&embed=live-chart' ) ), $cfg )['reason'] === 'query' );
check( '?s= search query not cached', sml_ec_decide( array_merge( $anon, array( 'query' => 's=nvda' ) ), $cfg )['reason'] === 'query' );

/* 6. 404 pages are cached briefly */
$d404 = sml_ec_decide( array_merge( $anon, array( 'is_404' => true, 'path' => '/nope' ) ), $cfg );
check( '404 cacheable with the short TTL', $d404['reason'] === 'cacheable_404' && strpos( $d404['headers']['Cache-Control'], 'public, max-age=60, s-maxage=120' ) === 0, $d404['headers']['Cache-Control'] );

/* 7. settings clamp */
$custom = array_merge( $cfg, array( 'ttl' => 0, 'edge_ttl' => 10, 'swr' => 0 ) );
check( 'edge TTL never below 30 and swr can be off', sml_ec_decide( $anon, $custom )['headers']['Cache-Control'] === 'public, max-age=0, s-maxage=30, stale-if-error=3600' );
$ex = sml_ec_excluded_paths( array( 'excluded_paths' => "/wp-admin/\n/ok\nno-slash\n/bad path\n/ok, /two" ) );
check( 'excluded paths cleaned', $ex === array( '/wp-admin', '/ok', '/two' ), json_encode( $ex ) );

/* 8. caller attribution from a backtrace */
$trace = array(
	array( 'file' => '/srv/htdocs/wp-includes/functions.php', 'line' => 1 ),
	array( 'file' => '/srv/htdocs/wp-includes/plugin.php', 'line' => 2 ),
	array( 'file' => '/srv/htdocs/wp-content/plugins/some-membership/includes/front.php', 'line' => 88 ),
	array( 'file' => '/srv/htdocs/wp-includes/class-wp-hook.php', 'line' => 3 ),
);
check( 'the first non-core frame names the plugin', sml_ec_caller_from_trace( $trace ) === 'wp-content/plugins/some-membership:88' );
check( 'a WPCode snippet is recognised', sml_ec_caller_from_trace( array( array( 'file' => '/srv/htdocs/wp-content/plugins/insert-headers-and-footers/includes/class-wpcode-snippet-execute.php(214) : eval()\'d code', 'line' => 5 ) ) ) === 'wp-content/plugins/insert-headers-and-footers:5' );
check( 'core-only trace is unknown', sml_ec_caller_from_trace( array( array( 'file' => '/srv/htdocs/wp-includes/x.php' ) ) ) === 'unknown' );

echo $fail ? "\n$fail FAILED\n" : "\nall checks passed\n";
exit( $fail ? 1 : 0 );
