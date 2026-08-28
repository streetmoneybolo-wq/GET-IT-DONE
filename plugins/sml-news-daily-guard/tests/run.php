<?php

define( 'ABSPATH', __DIR__ . '/' );
function add_filter() {}
function add_action() {}
function register_activation_hook() {}
function register_deactivation_hook() {}
function remove_accents( $value ) { return $value; }
function wp_strip_all_tags( $value ) { return strip_tags( $value ); }
function wp_parse_url( $url, $component = -1 ) { return parse_url( $url, $component ); }
function home_url() { return 'https://stockmarketloop.com/'; }

require_once dirname( __DIR__ ) . '/sml-news-daily-guard.php';

$checks = 0;
$failures = 0;
function check_guard( $label, $condition ) {
	global $checks, $failures;
	++$checks;
	if ( $condition ) { echo "PASS: {$label}\n"; return; }
	++$failures;
	echo "FAIL: {$label}\n";
}

$one = SML_News_Daily_Guard_V130::identity( 'Apple (AAPL) Reports Strong Q3 Earnings', '', strtotime( '2026-08-22 14:00:00 UTC' ) );
$two = SML_News_Daily_Guard_V130::identity( 'AAPL Q3 Earnings Report Shows Strong Results', '', strtotime( '2026-08-22 18:00:00 UTC' ) );
$other = SML_News_Daily_Guard_V130::identity( 'Apple (AAPL) Faces New Antitrust Lawsuit', '', strtotime( '2026-08-22 19:00:00 UTC' ) );
$tomorrow = SML_News_Daily_Guard_V130::identity( 'Apple (AAPL) Reports Strong Q3 Earnings', '', strtotime( '2026-08-23 14:00:00 UTC' ) );

check_guard( 'ticker extraction supports parenthetical symbols', array( 'AAPL' ) === $one['tickers'] );
check_guard( 'same ticker and earnings topic matches', SML_News_Daily_Guard_V130::same_story( $one, $two ) );
check_guard( 'different topic for the same ticker remains distinct', ! SML_News_Daily_Guard_V130::same_story( $one, $other ) );
check_guard( 'the daily key changes on the next New York day', $one['daily_key'] !== $tomorrow['daily_key'] );

$topic_one = SML_News_Daily_Guard_V130::identity( 'Federal Reserve Holds Rates as Inflation Slows', '', strtotime( '2026-08-22 14:00:00 UTC' ) );
$topic_two = SML_News_Daily_Guard_V130::identity( 'Inflation Slows as Federal Reserve Holds Interest Rates', '', strtotime( '2026-08-22 15:00:00 UTC' ) );
check_guard( 'same non-ticker topic matches by normalized content', SML_News_Daily_Guard_V130::same_story( $topic_one, $topic_two ) );

$source_one = SML_News_Daily_Guard_V130::identity(
	'Treasury sanctions Banque Misr UAE in $1.8B Iran-linked action',
	'<a href="https://www.cnbc.com/2026/08/28/treasury-uae-banque-misr-sanctions-iran.html?utm_source=rss">Source</a>',
	strtotime( '2026-08-28 14:00:00 UTC' )
);
$source_two = SML_News_Daily_Guard_V130::identity(
	'Banque Misr UAE sanctions: Treasury moves to revoke U.S. access',
	'<p>Original: https://www.cnbc.com/2026/08/28/treasury-uae-banque-misr-sanctions-iran.html</p>',
	strtotime( '2026-08-28 15:00:00 UTC' )
);
check_guard( 'tracking parameters are removed from canonical source URLs', $source_one['source_urls'] === $source_two['source_urls'] );
check_guard( 'the same source URL matches despite a rewritten title', SML_News_Daily_Guard_V130::same_story( $source_one, $source_two ) );
check_guard( 'the same source URL produces the same race-safe daily key', $source_one['daily_key'] === $source_two['daily_key'] );

echo "\n{$checks} checks, {$failures} failures\n";
exit( $failures ? 1 : 0 );

