<?php
/* PHP stub test: php tests/php-test.php   (no WordPress needed) */
define( 'ABSPATH', __DIR__ . '/' );
define( 'ARRAY_A', 'ARRAY_A' );
define( 'SML_GPRO_VERSION', 'test' );
define( 'SML_GPRO_DIR', dirname( __DIR__ ) . '/' );
define( 'SML_GPRO_URL', 'https://x.test/' );
define( 'SML_PLATFORM_BILLING_BASE_URL', 'https://platform.test' );
define( 'SML_PLATFORM_BILLING_API_SECRET', 'secret-1' );

$fails = 0; $n = 0;
function ok( $cond, $msg ) { global $fails, $n; $n++; if ( ! $cond ) { $fails++; echo "FAIL: $msg\n"; } }

class WP_Error { public $code; public $message; public $data; function __construct( $c = '', $m = '', $d = array() ) { $this->code = $c; $this->message = $m; $this->data = $d; } function get_error_code() { return $this->code; } }
function is_wp_error( $x ) { return $x instanceof WP_Error; }
class WP_REST_Request { private $p; function __construct( $p ) { $this->p = $p; } function get_param( $k ) { return $this->p[ $k ] ?? null; } }
function absint( $v ) { return abs( (int) $v ); }
function sanitize_key( $s ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $s ) ); }
function sanitize_title( $s ) { return trim( preg_replace( '/[^a-z0-9\-]+/', '-', strtolower( (string) $s ) ), '-' ); }
function wp_json_encode( $v ) { return json_encode( $v ); }
function add_action() {}
$GLOBALS['opts'] = array(); $GLOBALS['trans'] = array(); $GLOBALS['remote'] = array(); $GLOBALS['user'] = 5; $GLOBALS['admin'] = false; $GLOBALS['role'] = 'member'; $GLOBALS['owner'] = 99;
function get_option( $k, $d = false ) { return $GLOBALS['opts'][ $k ] ?? $d; }
function update_option( $k, $v ) { $GLOBALS['opts'][ $k ] = $v; return true; }
function get_transient( $k ) { return $GLOBALS['trans'][ $k ] ?? false; }
function set_transient( $k, $v ) { $GLOBALS['trans'][ $k ] = $v; return true; }
function is_user_logged_in() { return $GLOBALS['user'] > 0; }
function get_current_user_id() { return $GLOBALS['user']; }
function user_can( $u, $c ) { return $GLOBALS['admin']; }
function wp_remote_post( $url, $args ) { $GLOBALS['remote'][] = array( $url, $args ); $r = $GLOBALS['reply'] ?? array( 'code' => 200, 'body' => '{"ok":true,"tool":"x"}' ); return $r instanceof WP_Error ? $r : $r; }
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }
class FakeDb {
	public $prefix = 'wp_';
	function prepare( $q, ...$a ) { return vsprintf( str_replace( array( '%d', '%s' ), array( '%d', "'%s'" ), $q ), $a ); }
	function get_row( $q, $o ) { return $GLOBALS['group'] ?? null; }
	function get_var( $q ) { return $GLOBALS['role']; }
}
$GLOBALS['wpdb'] = new FakeDb();
$GLOBALS['group'] = array( 'id' => 7, 'slug' => 'mem', 'owner_id' => 99, 'ticker_symbol' => 'SPY' );

foreach ( array( 'access', 'platform', 'rest' ) as $f ) { require SML_GPRO_DIR . "includes/$f.php"; }

/* levels */
ok( sml_gpro_level_for( false, false, null ) === 'none', 'non-member is none' );
ok( sml_gpro_level_for( false, false, 'member' ) === 'preview', 'member is preview' );
foreach ( array( 'premium', 'analyst', 'mod', 'admin', 'owner' ) as $r ) { ok( sml_gpro_level_for( false, false, $r ) === 'full', "$r is full" ); }
ok( sml_gpro_level_for( true, false, null ) === 'full', 'site admin full even without membership' );
ok( sml_gpro_level_for( false, true, null ) === 'full', 'owner full' );
ok( sml_gpro_can_curate( false, false, 'premium' ) === false, 'premium cannot curate' );
ok( sml_gpro_can_curate( false, false, 'analyst' ) === true, 'analyst curates' );
ok( sml_gpro_can_curate( false, true, null ) === true, 'owner curates' );

/* symbols */
$clean = sml_gpro_clean_symbols( array( 'spy', 'SPY', 'bad sym', 'brk.b', '1x', 'aapl', 'x' ) );
ok( $clean === array( 'SPY', 'BRK.B', 'AAPL', 'X' ), 'symbols cleaned and deduped: ' . json_encode( $clean ) );
ok( count( sml_gpro_clean_symbols( array_map( function ( $i ) { return 'T' . chr( 65 + $i ); }, range( 0, 25 ) ) ) ) === 12, 'capped at 12' );

/* signature matches what the platform verifies: HMAC-SHA256 over "timestamp.body" */
ok( sml_gpro_signature( '1700000000', '{"a":1}', 'k' ) === hash_hmac( 'sha256', '1700000000.{"a":1}', 'k' ), 'signature format' );

/* payload whitelist */
$p = sml_gpro_payload( 'strategies', 7, 5, 'SPY', array(), array( 'view' => 'bullish', 'shares' => '200', 'cost' => 'abc', 'evil' => 'x', 'horizonDays' => -5 ), true );
ok( $p['params'] === array( 'view' => 'bullish', 'shares' => 200.0 ), 'params whitelisted: ' . json_encode( $p['params'] ) );
ok( $p['preview'] === true && $p['symbol'] === 'SPY', 'payload basics' );
ok( json_encode( sml_gpro_payload( 'setups', 7, 5, 'SPY', array(), array(), false )['params'] ) === '{}', 'empty params serialise as an object' );

/* rest flow */
$GLOBALS['role'] = null;
$r = sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'setups', 'symbol' => 'SPY' ) ) );
ok( is_wp_error( $r ) && $r->code === 'gpro_forbidden', 'non-member refused' );
ok( count( $GLOBALS['remote'] ) === 0, 'no platform call for a non-member' );

$GLOBALS['role'] = 'member';
$r = sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'setups', 'symbol' => 'spy' ) ) );
ok( ! is_wp_error( $r ) && $r['level'] === 'preview', 'member gets preview level' );
$sent = json_decode( $GLOBALS['remote'][0][1]['body'], true );
ok( $sent['preview'] === true && $sent['symbol'] === 'SPY' && $sent['groupId'] === 7, 'preview flag and group sent' );
ok( $GLOBALS['remote'][0][0] === 'https://platform.test/v1/group-tools/run', 'platform url' );
$h = $GLOBALS['remote'][0][1]['headers'];
ok( $h['X-SML-Signature'] === hash_hmac( 'sha256', $h['X-SML-Timestamp'] . '.' . $GLOBALS['remote'][0][1]['body'], 'secret-1' ), 'request is signed with the shared secret' );

$before = count( $GLOBALS['remote'] );
sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'setups', 'symbol' => 'SPY' ) ) );
ok( count( $GLOBALS['remote'] ) === $before, 'identical request served from the short cache' );

$GLOBALS['role'] = 'premium';
$r = sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'setups', 'symbol' => 'SPY' ) ) );
$sent = json_decode( end( $GLOBALS['remote'] )[1]['body'], true );
ok( $r['level'] === 'full' && $sent['preview'] === false, 'premium member gets the full tool' );

ok( is_wp_error( sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'rm-rf', 'symbol' => 'SPY' ) ) ) ), 'unknown tool rejected' );
ok( is_wp_error( sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'setups', 'symbol' => 'x y!' ) ) ) ), 'bad ticker rejected' );
ok( is_wp_error( sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'setups' ) ) ) ), 'missing ticker rejected' );

/* dashboard uses the watchlist when none is sent */
sml_gpro_save_watchlist( 7, array( 'nvda', 'amd' ) );
$empty = sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'leaders' ) ) );
ok( ! is_wp_error( $empty ) && ! empty( $empty['empty'] ), 'leaders without symbols reports an empty list rather than calling out' );
sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'dashboard' ) ) );
$sent = json_decode( end( $GLOBALS['remote'] )[1]['body'], true );
ok( $sent['symbols'] === array( 'NVDA', 'AMD' ), 'dashboard defaults to the group list' );
update_option( 'sml_gpro_watch_7', array() );
$none = sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'dashboard' ) ) );
ok( ! empty( $none['empty'] ), 'empty watchlist handled' );

/* failure mapping never leaks internals */
$GLOBALS['trans'] = array();
$GLOBALS['reply'] = array( 'code' => 500, 'body' => '{"ok":false,"error":"stack trace secret"}' );
$e = sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'setups', 'symbol' => 'QQQ' ) ) );
ok( is_wp_error( $e ) && $e->code === 'gpro_failed' && strpos( $e->message, 'secret' ) === false, 'platform error is generic' );
$GLOBALS['reply'] = array( 'code' => 429, 'body' => '{}' );
$e = sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'setups', 'symbol' => 'IWM' ) ) );
ok( is_wp_error( $e ) && $e->code === 'gpro_busy', '429 mapped' );
$GLOBALS['reply'] = new WP_Error( 'http_request_failed', 'cURL error 28 internal host' );
$e = sml_gpro_rest_run( new WP_REST_Request( array( 'group_id' => 7, 'tool' => 'setups', 'symbol' => 'DIA' ) ) );
ok( is_wp_error( $e ) && $e->code === 'gpro_unreachable' && strpos( $e->message, 'cURL' ) === false, 'network error is generic' );

/* watchlist permissions */
$GLOBALS['role'] = 'premium';
$d = sml_gpro_rest_watchlist_post( new WP_REST_Request( array( 'group_id' => 7, 'symbols' => 'spy, qqq' ) ) );
ok( is_wp_error( $d ) && $d->code === 'gpro_forbidden', 'premium cannot edit the list' );
$GLOBALS['role'] = 'analyst';
$d = sml_gpro_rest_watchlist_post( new WP_REST_Request( array( 'group_id' => 7, 'symbols' => 'spy, qqq, bad!' ) ) );
ok( $d['symbols'] === array( 'SPY', 'QQQ' ), 'analyst saves a cleaned list from a string' );
ok( sml_gpro_rest_watchlist_get( new WP_REST_Request( array( 'group_id' => 7 ) ) )['symbols'] === array( 'SPY', 'QQQ' ), 'list reads back' );

/* unconfigured */
echo "$n checks, $fails failed\n";
exit( $fails ? 1 : 0 );
