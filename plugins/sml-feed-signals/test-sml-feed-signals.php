<?php
/**
 * Standalone tests for sml-feed-signals.  Run: php test-sml-feed-signals.php
 *
 * WordPress and $wpdb are stubbed just enough to run the real functions. The
 * database-backed paths are ALSO exercised against the live schema inside a
 * rolled-back transaction (see the deploy notes); these tests pin the logic.
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'DAY_IN_SECONDS', 86400 );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'OBJECT_K', 'OBJECT_K' );

$GLOBALS['t_meta']       = array();
$GLOBALS['t_transients'] = array();
$GLOBALS['t_now']        = 1_758_000_000;
$GLOBALS['t_user']       = 42;

function add_action( ...$a ) {}
function add_filter( $hook, $cb = null, ...$rest ) {}
function register_activation_hook( ...$a ) {}
function register_deactivation_hook( ...$a ) {}
function register_rest_route( ...$a ) {}
function apply_filters( $hook, $value ) { return 'sml_fs_now' === $hook ? $GLOBALS['t_now'] : $value; }
function get_current_user_id() { return $GLOBALS['t_user']; }
function is_user_logged_in() { return $GLOBALS['t_user'] > 0; }
function get_user_meta( $uid, $key, $single = false ) { return $GLOBALS['t_meta'][ $uid ][ $key ] ?? ''; }
function update_user_meta( $uid, $key, $value ) { $GLOBALS['t_meta'][ $uid ][ $key ] = $value; return true; }
function delete_user_meta( $uid, $key ) { $had = isset( $GLOBALS['t_meta'][ $uid ][ $key ] ); unset( $GLOBALS['t_meta'][ $uid ][ $key ] ); return $had; }
function get_transient( $k ) { return $GLOBALS['t_transients'][ $k ] ?? false; }
function set_transient( $k, $v, $ttl = 0 ) { $GLOBALS['t_transients'][ $k ] = $v; return true; }
function get_option( $k, $d = false ) { return $d; }
function update_option( ...$a ) { return true; }
function rest_ensure_response( $d ) { return new T_Response( $d ); }

class T_Response { public $data; public function __construct( $d ) { $this->data = $d; } }
class WP_Error {
	public $code; public $message; public $data;
	public function __construct( $c, $m = '', $d = array() ) { $this->code = $c; $this->message = $m; $this->data = $d; }
}
class WP_REST_Request {
	private $params;
	public function __construct( $params = array() ) { $this->params = $params; }
	public function get_param( $k ) { return $this->params[ $k ] ?? null; }
}

/** Fake $wpdb: records queries; answers resolver lookups from a small in-memory model. */
class T_WPDB {
	public $prefix = 'wp_';
	public $posts = 'wp_posts'; public $comments = 'wp_comments'; public $users = 'wp_users';
	public $queries = array();
	public $model = array(
		'wp_posts'           => array( 100 => 7, 101 => 42 ),     // post id => author
		'wp_comments'        => array( 48 => 9 ),
		'wp_sml_group_posts' => array( 34 => 11 ),
		'wp_sml_letter_posts'=> array( 66 => 12 ),
		'wp_users'           => array( 258456581 => 258456581, 7 => 7 ),
	);
	public $hides = array();
	public function prepare( $sql, ...$args ) {
		if ( count( $args ) === 1 && is_array( $args[0] ) ) $args = $args[0];
		$i = 0;
		return preg_replace_callback( '/%[dsf]/', function ( $m ) use ( &$i, $args ) {
			$v = $args[ $i++ ] ?? null;
			return '%d' === $m[0] ? (string) (int) $v : "'" . addslashes( (string) $v ) . "'";
		}, $sql );
	}
	public function get_var( $sql ) {
		$this->queries[] = $sql;
		if ( preg_match( "/SHOW TABLES LIKE '([^']+)'/", $sql, $m ) ) return isset( $this->model[ $m[1] ] ) ? $m[1] : null;
		return 0;
	}
	public function get_results( $sql, $mode = null ) {
		$this->queries[] = $sql;
		if ( preg_match( '/FROM (\w+) WHERE \w+ IN \(([^)]*)\)/', $sql, $m ) && isset( $this->model[ $m[1] ] ) ) {
			$out = array();
			foreach ( array_map( 'intval', explode( ',', $m[2] ) ) as $id ) {
				if ( isset( $this->model[ $m[1] ][ $id ] ) ) $out[] = (object) array( 'item_id' => $id, 'author_id' => $this->model[ $m[1] ][ $id ] );
			}
			return $out;
		}
		return array();
	}
	public function get_col( $sql ) {
		$this->queries[] = $sql;
		if ( strpos( $sql, 'SELECT target FROM wp_sml_feed_hides' ) !== false ) return $this->hides;
		return array();
	}
	public function query( $sql ) { $this->queries[] = $sql; return 1; }
	public function delete( ...$a ) { $this->queries[] = 'DELETE'; return 1; }
	public function get_charset_collate() { return ''; }
}
$GLOBALS['wpdb'] = new T_WPDB();

require __DIR__ . '/sml-feed-signals.php';

$passed = 0; $failed = 0;
function ok( $cond, $name ) { global $passed, $failed; if ( $cond ) { $passed++; } else { $failed++; echo "FAIL $name\n"; } }
function deep_equal( $a, $b ) {
	if ( is_float( $a ) || is_float( $b ) || ( is_numeric( $a ) && is_numeric( $b ) && ! is_string( $a ) && ! is_string( $b ) ) ) {
		return is_numeric( $a ) && is_numeric( $b ) && abs( $a - $b ) < 1e-9;
	}
	if ( is_array( $a ) && is_array( $b ) ) {
		if ( count( $a ) !== count( $b ) ) return false;
		foreach ( $a as $k => $v ) { if ( ! array_key_exists( $k, $b ) || ! deep_equal( $v, $b[ $k ] ) ) return false; }
		return true;
	}
	return $a === $b;
}

/* ============================================ parity with the Node module */

$fx = json_decode( file_get_contents( __DIR__ . '/onboarding-fixtures.json' ), true );
ok( deep_equal( sml_fs_questions(), $fx['questions'] ), 'the ten questions are identical to the Node module, text included' );
ok( deep_equal( sml_fs_slot_cap_by_appetite(), $fx['slotCapByAppetite'] ), 'slot caps by news appetite match' );
ok( count( $fx['fixtures'] ) >= 40, 'fixtures cover every answer option' );

foreach ( $fx['fixtures'] as $f ) {
	$v = sml_fs_validate_answers( $f['input'] );
	ok( deep_equal( $v['answers'], $f['answers'] ), "answers match Node: {$f['name']}" );
	ok( $v['missing'] === $f['missing'], "missing matches Node: {$f['name']}" );
	ok( deep_equal( $v['rejected'], $f['rejected'] ), "rejected matches Node: {$f['name']}" );
	ok( $v['complete'] === $f['complete'], "complete matches Node: {$f['name']}" );
	$p = sml_fs_build_profile( $v['answers'] );
	ok( deep_equal( $p, $f['profile'] ), "profile matches Node: {$f['name']}" . ( deep_equal( $p, $f['profile'] ) ? '' : "\n   php:  " . json_encode( $p ) . "\n   node: " . json_encode( $f['profile'] ) ) );
}

/* ================================================================ item refs */

ok( sml_fs_parse_item_ref( 'wp-8842' )['kind'] === 'wp', 'wp refs parse' );
ok( sml_fs_parse_item_ref( 'chart-258456581-alert-6aa1cde009d43' )['id'] === '258456581', 'chart refs carry the author id' );
ok( sml_fs_parse_item_ref( 'grouppost-34' )['kind'] === 'grouppost', 'group post refs parse' );
ok( sml_fs_parse_item_ref( " wp-1\n" )['ref'] === 'wp-1', 'surrounding whitespace is trimmed, and the clean ref is what gets stored' );
foreach ( array( '', 'wp-', 'wp-abc', 'post-1', 'wp-1; DROP', 'wp-1 2', 'chart-1', 'chart-x-y', str_repeat( 'a', 200 ), null, 5, array() ) as $bad ) {
	ok( null === sml_fs_parse_item_ref( $bad ), 'refused ref ' . json_encode( $bad ) );
}

/* ================================================================ resolvers */

$authors = sml_fs_resolve_authors( array( 'wp-100', 'stream-48', 'grouppost-34', 'letter-66', 'chart-258456581-x', 'chart-999-x', 'wp-555', 'junk' ) );
ok( ( $authors['wp-100'] ?? null ) === 7, 'wp post author from post_author' );
ok( ( $authors['stream-48'] ?? null ) === 9, 'stream author from the comment' );
ok( ( $authors['grouppost-34'] ?? null ) === 11, 'group post author' );
ok( ( $authors['letter-66'] ?? null ) === 12, 'letter author' );
ok( ( $authors['chart-258456581-x'] ?? null ) === 258456581, 'chart author, proven to exist' );
ok( ! isset( $authors['chart-999-x'] ), 'a chart id naming a non-existent user resolves to nothing' );
ok( ! isset( $authors['wp-555'] ) && ! isset( $authors['junk'] ), 'unknown and malformed refs resolve to nothing' );

$GLOBALS['wpdb']->queries = array();
sml_fs_resolve_authors( array( 'wp-100', 'wp-101', 'wp-555' ) );
$selects = array_filter( $GLOBALS['wpdb']->queries, function ( $q ) { return strpos( $q, 'SELECT ID AS item_id' ) !== false; } );
ok( count( $selects ) === 1, 'one query per kind, not per item' );

/* ==================================================================== hides */

$GLOBALS['t_user'] = 42;
$r = sml_fs_rest_hide( new WP_REST_Request( array( 'scope' => 'author', 'item_ref' => 'wp-100' ) ) );
ok( $r instanceof T_Response && $r->data['target'] === 'author:7', 'hiding an author stores the RESOLVED author' );
$insert = end( $GLOBALS['wpdb']->queries );
ok( strpos( $insert, 'INSERT IGNORE' ) !== false && strpos( $insert, "'author:7'" ) !== false, 'the insert is idempotent on (user, target)' );

$r = sml_fs_rest_hide( new WP_REST_Request( array( 'scope' => 'author', 'item_ref' => 'wp-101' ) ) );
ok( $r instanceof WP_Error && 'sml_fs_self' === $r->code, 'you cannot hide your own posts' );

$r = sml_fs_rest_hide( new WP_REST_Request( array( 'scope' => 'author', 'item_ref' => 'wp-555' ) ) );
ok( $r instanceof WP_Error && 422 === $r->data['status'], 'an author hide needs a resolvable author' );

$r = sml_fs_rest_hide( new WP_REST_Request( array( 'scope' => 'item', 'item_ref' => 'wp-555' ) ) );
ok( $r instanceof T_Response && $r->data['target'] === 'item:wp-555', 'an item hide works even when the author is unknown' );

foreach ( array(
	array( 'scope' => 'everything', 'item_ref' => 'wp-100' ),
	array( 'scope' => 'item', 'item_ref' => 'nope' ),
	array( 'scope' => 'item', 'item_ref' => 'wp-100', 'reason' => 'spite' ),
	array( 'scope' => 'author', 'author_id' => 7 ),
) as $bad ) {
	$r = sml_fs_rest_hide( new WP_REST_Request( $bad ) );
	ok( $r instanceof WP_Error, 'refused hide ' . json_encode( $bad ) );
}

foreach ( array( 'author:7', 'item:wp-100', 'item:chart-7-abc' ) as $target ) {
	ok( sml_fs_rest_unhide( new WP_REST_Request( array( 'target' => $target ) ) ) instanceof T_Response, "undo accepts $target" );
}
foreach ( array( 'author:x', 'item:nope', 'everything', "author:7' OR 1=1" ) as $target ) {
	ok( sml_fs_rest_unhide( new WP_REST_Request( array( 'target' => $target ) ) ) instanceof WP_Error, "undo refuses $target" );
}

/* one round trip: hide/undo can return the refreshed hidden set */
$GLOBALS['wpdb']->hides = array( 'author:7' );
$r = sml_fs_rest_hide( new WP_REST_Request( array( 'scope' => 'author', 'item_ref' => 'wp-100', 'refs' => array( 'wp-100', 'stream-48' ) ) ) );
ok( $r instanceof T_Response && $r->data['hiddenRefs'] === array( 'wp-100' ), 'hide returns the refreshed hidden set when refs are sent' );
$r = sml_fs_rest_hide( new WP_REST_Request( array( 'scope' => 'item', 'item_ref' => 'wp-100' ) ) );
ok( ! isset( $r->data['hiddenRefs'] ), 'and omits it when they are not' );
$GLOBALS['wpdb']->hides = array();
$r = sml_fs_rest_unhide( new WP_REST_Request( array( 'target' => 'author:7', 'refs' => array( 'wp-100' ) ) ) );
ok( $r->data['hiddenRefs'] === array(), 'undo returns the refreshed hidden set too' );
$GLOBALS['t_transients'] = array();

/* the rate limit */
$GLOBALS['t_transients'] = array();
for ( $i = 0; $i < 60; $i++ ) sml_fs_rest_hide( new WP_REST_Request( array( 'scope' => 'item', 'item_ref' => 'wp-100' ) ) );
$r = sml_fs_rest_hide( new WP_REST_Request( array( 'scope' => 'item', 'item_ref' => 'wp-100' ) ) );
ok( $r instanceof WP_Error && 429 === $r->data['status'], 'hides are rate-limited per member' );
$GLOBALS['t_transients'] = array();

/* ================================================================== visible */

$GLOBALS['wpdb']->hides = array( 'author:7', 'item:grouppost-34' );
$hidden = sml_fs_hidden_refs( 42, array( 'wp-100', 'grouppost-34', 'stream-48', 'wp-100', 'garbage' ) );
ok( $hidden === array( 'wp-100', 'grouppost-34' ), 'author hides filter article cards by resolved author; item hides by ref' );
ok( array() === sml_fs_hidden_refs( 42, array() ), 'no refs, no work' );
$GLOBALS['wpdb']->hides = array();
$GLOBALS['wpdb']->queries = array();
ok( array() === sml_fs_hidden_refs( 42, array( 'wp-100' ) ), 'nothing hidden returns nothing' );
ok( count( $GLOBALS['wpdb']->queries ) === 1, 'and skips author resolution entirely' );

/* ============================================================== impressions */

$GLOBALS['wpdb']->queries = array();
$n = sml_fs_record_impressions( 42, array(
	array( 'ref' => 'wp-100', 'position' => 3, 'surface' => 'feed' ),
	array( 'ref' => 'wp-100', 'position' => 1, 'surface' => 'feed' ),   // duplicate in batch → counted once, best position kept
	array( 'ref' => 'stream-48', 'position' => 5 ),
	array( 'ref' => 'wp-101', 'position' => 2 ),                        // own post → not counted
	array( 'ref' => 'wp-555', 'position' => 2 ),                        // unknown author → not counted
	array( 'ref' => 'wp-100', 'surface' => 'sidebar' ),                 // unknown surface → dropped
	'nonsense',
), $GLOBALS['t_now'] );
ok( 2 === $n, 'two valid, distinct, other-authored impressions are recorded' );
$upserts = array_values( array_filter( $GLOBALS['wpdb']->queries, function ( $q ) { return strpos( $q, 'INSERT INTO wp_sml_feed_impressions' ) !== false; } ) );
ok( 2 === count( $upserts ), 'one upsert per (author, surface)' );
ok( strpos( $upserts[0], "'feed'" ) !== false && preg_match( "/, 7, 'feed', 1, 1,/", $upserts[0] ), 'author 7 counted once at best position 1' );
ok( strpos( $upserts[0], 'LEAST(impressions + VALUES(impressions), 500)' ) !== false, 'the daily per-author cap is enforced in SQL' );
ok( strpos( $upserts[0], "'2025-09-16'" ) !== false, 'the day is UTC' );

$many = array();
for ( $i = 0; $i < 200; $i++ ) $many[] = array( 'ref' => 'wp-100', 'position' => $i );
$GLOBALS['wpdb']->queries = array();
sml_fs_record_impressions( 42, $many, $GLOBALS['t_now'] );
ok( count( array_filter( $GLOBALS['wpdb']->queries, function ( $q ) { return strpos( $q, 'INSERT INTO' ) !== false; } ) ) === 1, 'a batch is capped at 60 items and rolled up' );

/* ============================================================== onboarding */

$GLOBALS['t_meta'] = array();
$state = sml_fs_onboarding_state( 42 );
ok( $state['shouldPrompt'] === true && $state['completed'] === false, 'a new member is prompted' );

$r = sml_fs_rest_onboarding_save( new WP_REST_Request( array( 'answers' => array( 'instrument' => 'stocks' ) ) ) );
ok( $r instanceof WP_Error && 422 === $r->data['status'] && in_array( 'newsAppetite', $r->data['missing'], true ), 'an incomplete questionnaire is refused with what is missing' );
ok( ! isset( $GLOBALS['t_meta'][42][ SML_FS_ONBOARDING_META ] ), 'and nothing is stored' );

$complete = $fx['fixtures'][0]['input'];
$r = sml_fs_rest_onboarding_save( new WP_REST_Request( array( 'answers' => $complete ) ) );
ok( $r instanceof T_Response && $r->data['saved'] === true, 'a complete questionnaire saves' );
ok( deep_equal( $GLOBALS['t_meta'][42][ SML_FS_ONBOARDING_META ]['profile'], $fx['fixtures'][0]['profile'] ), 'the stored profile is exactly what Node would build' );
$state = sml_fs_onboarding_state( 42 );
ok( $state['completed'] && ! $state['shouldPrompt'], 'a completed member is not prompted again' );

$GLOBALS['t_meta'] = array();
sml_fs_rest_onboarding_snooze( new WP_REST_Request( array( 'days' => 999 ) ) );
$until = $GLOBALS['t_meta'][42][ SML_FS_SNOOZE_META ];
ok( $until === $GLOBALS['t_now'] + 30 * DAY_IN_SECONDS, 'snooze is capped at 30 days' );
ok( sml_fs_onboarding_state( 42 )['shouldPrompt'] === false, 'a snoozed member is not prompted' );
$GLOBALS['t_now'] += 31 * DAY_IN_SECONDS;
ok( sml_fs_onboarding_state( 42 )['shouldPrompt'] === true, 'and is prompted again once the snooze passes' );
$GLOBALS['t_now'] -= 31 * DAY_IN_SECONDS;

$r = sml_fs_rest_onboarding_get( new WP_REST_Request() );
ok( count( $r->data['questions'] ) === 10, 'GET returns the questions' );

/* empty affinity must serialise as {} not [] */
$GLOBALS['t_meta'] = array();
$minimal = array( 'instrument' => 'stocks', 'holdPeriod' => 'days', 'riskAppetite' => 'balanced', 'experience' => 'one_to_five',
	'learningStyle' => 'chat', 'participation' => 'read_quietly', 'intent' => 'both', 'newsAppetite' => 'headlines_only' );
$r = sml_fs_rest_onboarding_save( new WP_REST_Request( array( 'answers' => $minimal ) ) );
ok( strpos( json_encode( $r->data['profile'] ), '"categoryAffinity":{' ) !== false, 'categoryAffinity is always a JSON object' );

/* =============================================================== watchlist */

$GLOBALS['t_meta'] = array(
	1 => array( 'sml_watchlist' => array( 'spy', '$nvda', 'SPY', 'bad ticker' ) ),
	2 => array( 'sml_watchlist' => array(), 'sml_watchlist_symbols' => array( 'SPY', 'NVDA', 'SPCX', 'GLW' ), 'sml_l6_watchlist' => array( 'SPY' ) ),
	3 => array( 'sml_watchlist' => '', 'sml_l6_watchlist' => array( 'VIXY' ) ),
	4 => array(),
);
ok( sml_fs_watchlist( 1 ) === array( 'SPY', 'NVDA' ), 'sml_watchlist is normalized and deduped' );
ok( sml_fs_watchlist( 2 ) === array( 'SPY', 'NVDA', 'SPCX', 'GLW' ), 'an empty sml_watchlist falls back to the older keys (the live case)' );
ok( sml_fs_watchlist( 3 ) === array( 'VIXY' ), 'the oldest key is the last resort' );
ok( sml_fs_watchlist( 4 ) === array(), 'no watchlist anywhere is an empty list' );
$writes = array_filter( $GLOBALS['wpdb']->queries, function ( $q ) { return stripos( $q, 'usermeta' ) !== false; } );
ok( ! $writes, 'reading a watchlist never writes' );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
