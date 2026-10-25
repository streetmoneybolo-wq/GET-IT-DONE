<?php
/**
 * SML Website Dev harness. The logic file is pure (no WordPress, no database), so the parts that decide what counts as a
 * bug, how the digest is scored, what the engine proposes and how it learns are all exercised here without a site.
 *
 * Run: php tests/harness.php
 */
declare( strict_types = 1 );
define( 'ABSPATH', __DIR__ . '/' );
require_once dirname( __DIR__ ) . '/includes/logic.php';

$pass = 0; $fail = 0;
function check( string $name, bool $ok, string $detail = '' ): void { global $pass, $fail; if ( $ok ) { $pass++; echo "  PASS  $name\n"; } else { $fail++; echo "  FAIL  $name" . ( $detail ? "  ($detail)" : '' ) . "\n"; } }

echo "\n=== PATHS AND ROUTES ===\n";
check( 'a full URL becomes its path', '/watch/abc123/' === sml_wd_path( 'https://stockmarketloop.com/watch/abc123/?utm=x#t' ) );
check( 'query strings never survive', false === strpos( sml_wd_path( '/go/?token=secret' ), 'secret' ) );
check( 'a bare path is kept', '/loop-letters/' === sml_wd_path( '/loop-letters/' ) );
check( 'garbage becomes root', '/' === sml_wd_path( 'not a url at all' ) );
check( 'numeric ids collapse', '/members/:id/' === sml_wd_route_key( '/members/48213/' ) );
check( 'long slugs collapse', '/watch/:slug/:slug/' === sml_wd_route_key( '/watch/88kbaonkfnj1/spcx-10-percent-trading-rule/' ) );
check( 'tickers collapse', '/stock/:sym/' === sml_wd_route_key( '/stock/TSLA/' ) );
check( 'REST prefix is dropped', 'sml-channel/v1/channel/:slug' === sml_wd_route_key( '/wp-json/sml-channel/v1/channel/grandmasterobi' ) );

echo "\n=== FINGERPRINTS: ONE BUG IS ONE ROW ===\n";
$a = sml_wd_fingerprint( 'js_error', 'Cannot read properties of undefined (reading \'videos\') at loop-channel.js:412:17', '/channel/:slug/' );
$b = sml_wd_fingerprint( 'js_error', 'Cannot read properties of undefined (reading \'videos\') at loop-channel.js:415:3', '/channel/:slug/' );
check( 'line and column differences fold together', $a === $b );
check( 'a different message is a different bug', $a !== sml_wd_fingerprint( 'js_error', 'x is not a function', '/channel/:slug/' ) );
check( 'a different route is a different bug', $a !== sml_wd_fingerprint( 'js_error', 'Cannot read properties of undefined (reading \'videos\')', '/' ) );
check( 'hashes are masked', '#' === substr( sml_wd_normalise_message( 'asset 3f9a8c2d1e deadbeefcafe missing' ), 6, 1 ) );
check( 'messages are capped at 500', 500 === strlen( sml_wd_normalise_message( str_repeat( 'a', 900 ) ) ) );

echo "\n=== THE BEACON PAYLOAD IS CHECKED FIELD BY FIELD ===\n";
check( 'unknown kinds are dropped', null === sml_wd_sanitize_beacon_event( array( 'kind' => 'php_fatal', 'message' => 'spoof' ), '/' ) );
check( 'server kinds cannot be injected from the browser', null === sml_wd_sanitize_beacon_event( array( 'kind' => 'timing', 'message' => 'x' ), '/' ) );
check( 'extension noise is not a site bug', null === sml_wd_sanitize_beacon_event( array( 'kind' => 'js_error', 'message' => 'boom', 'source' => 'chrome-extension://abc/x.js' ), '/' ) );
check( 'ResizeObserver loop is ignored', null === sml_wd_sanitize_beacon_event( array( 'kind' => 'js_error', 'message' => 'ResizeObserver loop limit exceeded' ), '/' ) );
$e = sml_wd_sanitize_beacon_event( array( 'kind' => 'js_error', 'message' => 'x is not a function', 'source' => 'https://cdn.jsdelivr.net/gh/o/r@sha/js/home-feed.js?x=1', 'line' => 12, 'stack' => "a\n b\n c", 'device' => 'phone' ), '/?p=1' );
check( 'a script error is kept with its source path', $e && 'js_error' === $e['kind'] && '/gh/o/r@sha/js/home-feed.js' === $e['meta']['source'] && 'cdn.jsdelivr.net' === $e['meta']['host'] );
check( 'the page URL loses its query string', '/' === $e['url'] );
check( 'phone is recorded', 'phone' === $e['meta']['device'] );
check( 'stacks are flattened', false === strpos( $e['meta']['stack'], "\n" ) );
$f = sml_wd_sanitize_beacon_event( array( 'kind' => 'fetch', 'message' => 'HTTP 404 /wp-json/sml-x/v1/y', 'target' => '/wp-json/sml-x/v1/y?nonce=abc', 'status' => 404 ), '/home/' );
check( 'a failed fetch is a warning routed by its target', 'warn' === $f['level'] && 'sml-x/v1/y' === $f['route'] && false === strpos( $f['meta']['target'], 'nonce' ) );
$g = sml_wd_sanitize_beacon_event( array( 'kind' => 'fetch', 'message' => 'HTTP 500 /x', 'target' => '/x', 'status' => 500 ), '/' );
check( 'a 5xx fetch is an error', 'error' === $g['level'] );
$v = sml_wd_sanitize_beacon_event( array( 'kind' => 'vitals', 'lcp' => 2400.7, 'cls' => '0.0412', 'inp' => 9999999, 'ttfb' => -5, 'device' => 'desktop', 'con' => '4g<script>' ), '/' );
check( 'vitals are numeric and clamped', 2400 === $v['meta']['lcp'] && 0.041 === $v['meta']['cls'] && 600000 === $v['meta']['inp'] && 0 === $v['meta']['ttfb'] );
check( 'connection type is scrubbed', '4gscript' === $v['meta']['con'] );
check( 'vitals without numbers are dropped', null === sml_wd_sanitize_beacon_event( array( 'kind' => 'vitals', 'lcp' => 'abc' ), '/' ) );
check( 'empty messages are dropped', null === sml_wd_sanitize_beacon_event( array( 'kind' => 'js_error', 'message' => '   ' ), '/' ) );

echo "\n=== NUMBERS ===\n";
check( 'p75 of 1..100 is 76', 76 === sml_wd_percentile( range( 1, 100 ), 75 ) );
check( 'percentile of nothing is 0', 0 === sml_wd_percentile( array(), 50 ) );
check( 'LCP 2400 is good', 'good' === sml_wd_vital_grade( 'lcp', 2400 ) );
check( 'LCP 3000 needs work', 'needs-work' === sml_wd_vital_grade( 'lcp', 3000 ) );
check( 'CLS 0.3 is poor', 'poor' === sml_wd_vital_grade( 'cls', 0.3 ) );
check( 'unknown metric is n/a', 'n/a' === sml_wd_vital_grade( 'xyz', 1 ) );
check( 'a clean site scores 100', 100 === sml_wd_health_score( array() ) );
$bad = array( 'checks' => array( 'fail' => 3, 'warn' => 2 ), 'errors' => array( 'total' => 400, 'fatals' => array( 1 ) ), 'vitals' => array( 'lcp' => array( 'grade' => 'poor' ), 'inp' => array( 'grade' => 'poor' ), 'cls' => array( 'grade' => 'poor' ) ), 'server' => array( 'p95' => 5000 ) );
check( 'a broken site scores low but never below 0', 0 <= sml_wd_health_score( $bad ) && sml_wd_health_score( $bad ) < 20, (string) sml_wd_health_score( $bad ) );

echo "\n=== KNOBS STAY ON THEIR RAILS ===\n";
$k = sml_wd_knob_defaults()['beaconSampleRate'];
check( 'above the ceiling clamps to the ceiling', 100 === sml_wd_clamp_knob( $k, 500 ) );
check( 'below the floor clamps to the floor', 5 === sml_wd_clamp_knob( $k, -3 ) );
check( 'values snap to the step', 25 === sml_wd_clamp_knob( $k, 27 ) );
check( 'garbage keeps the current value', 25 === sml_wd_clamp_knob( $k, 'abc' ) );

echo "\n=== THE LEARNING LOOP ===\n";
$w = sml_wd_weight_defaults();
$w = sml_wd_learn( $w, 'speed', 0.3 );
check( 'a shipped change that paid off raises its area', 1.1 === $w['speed'] );
$w = sml_wd_learn( $w, 'speed', -0.2 );
check( 'one that made things worse lowers it', 1.0 === $w['speed'] );
$w = sml_wd_learn( $w, 'errors', 0.0 );
check( 'one that changed nothing lowers it a little', 0.97 === $w['errors'] );
for ( $i = 0; $i < 30; $i++ ) { $w = sml_wd_learn( $w, 'seo', 1.0 ); }
check( 'weights never leave 0.5–2.0', 2.0 === $w['seo'] );
check( 'unknown areas are ignored', sml_wd_learn( $w, 'nope', 1.0 ) === $w );

echo "\n=== THE RULES BRIEF ===\n";
$d = array(
	'views' => 500, 'score' => 48,
	'errors' => array( 'total' => 120, 'distinct' => 9, 'fatals' => array( array( 'route' => '/watch/:slug/', 'message' => 'plugins/x/x.php:12 Call to undefined function', 'n' => 4 ) ), 'top' => array(
		array( 'kind' => 'http_404', 'route' => '/old-page/', 'url' => '/old-page/', 'message' => '404 /old-page/', 'n' => 60, 'referer' => '/', 'source' => '', 'target' => '' ),
		array( 'kind' => 'js_error', 'route' => '/channel/:slug/', 'url' => '/channel/grandmasterobi/', 'message' => 'x is not a function', 'n' => 30, 'source' => '/js/loop-channel.js', 'target' => '', 'referer' => '' ),
	) ),
	'vitals' => array( 'lcp' => array( 'p75' => 4800, 'grade' => 'poor', 'worst' => array( 'route' => '/markets/', 'p75' => 7000 ) ), 'inp' => array( 'p75' => 150, 'grade' => 'good' ), 'cls' => array( 'p75' => 0.02, 'grade' => 'good' ), 'ttfb' => array( 'p75' => 900, 'grade' => 'needs-work' ) ),
	'server' => array( 'p50' => 400, 'p95' => 2200, 'maxQueries' => 310, 'slowest' => array( array( 'route' => '/markets/', 'p95' => 3900, 'queries' => 310, 'mem' => 140 ) ) ),
	'checks' => array( 'fail' => 1, 'warn' => 0, 'failing' => array( array( 'id' => 'indexability', 'title' => 'Sitemap URLs are indexable', 'detail' => '6 sampled; 1 conflict', 'fix' => 'Remove the noindex' ) ) ),
	'competitors' => array( 'gaps' => array( array( 'idea' => 'Build short video for StockMarketLoop', 'source' => 'YouTube', 'title' => 'Shorts get a new editor', 'change' => 'Design a shorts layer.' ) ) ),
	'a11y' => 3,
);
$brief = sml_wd_rules_brief( $d, sml_wd_weight_defaults() );
$titles = array_column( $brief['proposals'], 'title' );
check( 'summary quotes the numbers', false !== strpos( $brief['summary'], '120 errors' ) && false !== strpos( $brief['summary'], 'LCP 4800 ms' ) );
check( 'at most seven proposals', count( $brief['proposals'] ) <= 7, (string) count( $brief['proposals'] ) );
check( 'a failing check is proposed as a fix', (bool) preg_grep( '/^Fix: Sitemap URLs are indexable/', $titles ) );
check( 'the PHP fatal is proposed', (bool) preg_grep( '/^Stop the PHP fatal/', $titles ) );
check( 'the hot 404 gets a redirect proposal', (bool) preg_grep( '/^Redirect the 404 at \/old-page\//', $titles ) );
check( 'poor LCP names the worst route', (bool) preg_grep( '/^Bring LCP under 2.5 s on \/markets\//', $titles ) );
check( 'the fatal and the failing check lead (highest impact)', in_array( $titles[0], array( 'Stop the PHP fatal on /watch/:slug/', 'Fix: Sitemap URLs are indexable' ), true ), $titles[0] );
check( 'every proposal is scored and grounded', ! array_filter( $brief['proposals'], function ( $p ) { return empty( $p['evidence'] ) || ! isset( $p['score'] ); } ) );
$heavy = sml_wd_rules_brief( $d, array( 'speed' => 2.0, 'errors' => 0.5, 'seo' => 0.5, 'reliability' => 0.5, 'navigation' => 0.5, 'competition' => 0.5, 'a11y' => 0.5 ) );
check( 'a heavy speed weight moves LCP to the top', 0 === strpos( $heavy['proposals'][0]['title'], 'Bring LCP' ), $heavy['proposals'][0]['title'] );
$quiet = sml_wd_rules_brief( array( 'views' => 10, 'score' => 100, 'errors' => array( 'total' => 0, 'distinct' => 0 ), 'checks' => array( 'fail' => 0, 'warn' => 0 ) ), sml_wd_weight_defaults() );
check( 'a quiet day proposes nothing', array() === $quiet['proposals'] );

echo "\n=== COMPETITORS: A HEADLINE BECOMES AN IDEA ===\n";
$ns = array( 'sml-live/v1', 'sml-live-chat/v1', 'sml-letters/v1', 'sml-watch/v1', 'sml-alert-router/v1', 'sml-games/v1' );
$i = sml_wd_competitor_idea( 'TradingView', 'Introducing the new options chain with live greeks', $ns );
check( 'a capability this site lacks is a gap', $i && 'gap' === $i['kind'] && 'options' === $i['focus'] );
check( 'the gap idea names the capability', 'Build options for StockMarketLoop' === $i['idea'] );
$j = sml_wd_competitor_idea( 'Twitch', 'Live streaming gets a new chat experience', $ns );
check( 'a capability this site has is parity', $j && 'parity' === $j['kind'] && in_array( 'live streaming', $j['have'], true ) );
check( 'the parity idea says go further', 0 === strpos( $j['idea'], 'Go further than Twitch' ) );
check( 'hiring news is not product news', null === sml_wd_competitor_idea( 'Robinhood', 'We’re hiring across engineering', $ns ) );
check( 'an unrelated headline is nothing', null === sml_wd_competitor_idea( 'Discord', 'Our favourite recipes of the year', $ns ) );
check( 'namespaces match by prefix', $j && in_array( 'live chat', $j['have'], true ) );
$k2 = sml_wd_competitor_idea( 'YouTube', 'Shorts: new vertical video editor', array() );
check( 'with no namespaces everything is a gap', $k2 && 'gap' === $k2['kind'] && 'short video' === $k2['focus'] );

echo "\n" . ( $fail ? "FAILED: $fail failed, $pass passed\n" : "OK: $pass passed\n" );
exit( $fail ? 1 : 0 );
