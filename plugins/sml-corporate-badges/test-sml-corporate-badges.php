<?php
/**
 * Standalone tests for sml-corporate-badges.  Run: php test-sml-corporate-badges.php
 *
 * WordPress is stubbed just enough to exercise the real functions. The point is
 * the security-critical paths — signature verification and what the intake
 * refuses — which are otherwise only ever exercised in production.
 */

/* ------------------------------------------------------- WordPress stubs */

define( 'ABSPATH', __DIR__ );
define( 'SML_PLATFORM_BILLING_BRIDGE_SECRET', 'bridge-secret' );

$GLOBALS['sml_test_options'] = array();
$GLOBALS['sml_test_comments'] = array();

function update_option( $k, $v, $autoload = null ) { $GLOBALS['sml_test_options'][ $k ] = $v; return true; }
function get_option( $k, $default = false ) { return $GLOBALS['sml_test_options'][ $k ] ?? $default; }
function absint( $v ) { return abs( (int) $v ); }
function sanitize_text_field( $v ) { return trim( strip_tags( (string) $v ) ); }
function sanitize_title( $v ) { return strtolower( preg_replace( '/[^a-z0-9_-]/i', '', (string) $v ) ); }
function esc_attr( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES, 'UTF-8' ); }
function esc_html( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES, 'UTF-8' ); }
function esc_html__( $v, $d = null ) { return esc_html( $v ); }
function __( $v, $d = null ) { return $v; }
function add_action( ...$a ) {}
function add_filter( ...$a ) {}
function register_rest_route( ...$a ) {}
function wp_register_style( ...$a ) {}
function wp_enqueue_style( ...$a ) {}
function wp_add_inline_style( ...$a ) {}
function get_the_author_meta( $f ) { return $GLOBALS['sml_test_author_id'] ?? 0; }
function get_comment( $id ) { return $GLOBALS['sml_test_comments'][ $id ] ?? null; }
function rest_ensure_response( $d ) { return new SML_Test_Response( $d ); }

class SML_Test_Response {
	public $data; public $headers = array();
	public function __construct( $d ) { $this->data = $d; }
	public function header( $k, $v ) { $this->headers[ $k ] = $v; }
}
class WP_Error {
	public $code; public $message; public $data;
	public function __construct( $c, $m = '', $d = array() ) { $this->code = $c; $this->message = $m; $this->data = $d; }
}
class WP_REST_Request {
	private $headers = array(); private $body = '';
	public function __construct( $body = '', $headers = array() ) {
		$this->body = $body;
		foreach ( $headers as $k => $v ) $this->headers[ strtolower( $k ) ] = $v;
	}
	public function get_header( $k ) { return $this->headers[ strtolower( $k ) ] ?? ''; }
	public function get_body() { return $this->body; }
}

require __DIR__ . '/sml-corporate-badges.php';

/* ------------------------------------------------------------- harness */

$passed = 0; $failed = 0;
function ok( $cond, $name ) {
	global $passed, $failed;
	if ( $cond ) { $passed++; echo "ok   $name\n"; }
	else { $failed++; echo "FAIL $name\n"; }
}

function signed_request( $payload, $opts = array() ) {
	$body      = is_string( $payload ) ? $payload : json_encode( $payload );
	$secret    = $opts['secret'] ?? 'bridge-secret';
	$timestamp = (string) ( $opts['timestamp'] ?? time() );
	$sig       = $opts['signature'] ?? hash_hmac( 'sha256', $timestamp . '.' . $body, $secret );
	return new WP_REST_Request( $body, array(
		'x-sml-timestamp' => $timestamp,
		'x-sml-signature' => $opts['prefix'] ?? '' ? 'sha256=' . $sig : $sig,
	) );
}

function projection( $accounts, $over = array() ) {
	return array_merge( array(
		'version' => 1, 'generatedAt' => gmdate( 'c' ),
		'count' => count( $accounts ), 'empty' => 0 === count( $accounts ),
		'accounts' => $accounts,
	), $over );
}

$bloomberg = array( 'wpUserId' => 258457001, 'handle' => 'bloomberg', 'name' => 'Bloomberg', 'category' => 'finance', 'badge' => 'corporate', 'active' => true );
$cnn       = array( 'wpUserId' => 258457002, 'handle' => 'cnn', 'name' => 'CNN', 'category' => 'news', 'badge' => 'corporate', 'active' => true );

/* ------------------------------------------------------- signature gate */

$r = sml_cb_receive_projection( signed_request( projection( array( $bloomberg ) ) ) );
ok( $r instanceof SML_Test_Response, 'a correctly signed projection is accepted' );

$r = sml_cb_receive_projection( signed_request( projection( array( $bloomberg ) ), array( 'prefix' => true ) ) );
ok( $r instanceof SML_Test_Response, 'the optional sha256= prefix is accepted' );

$r = sml_cb_receive_projection( signed_request( projection( array( $bloomberg ) ), array( 'secret' => 'wrong-secret' ) ) );
ok( $r instanceof WP_Error && 401 === $r->data['status'], 'a wrong secret is rejected 401' );

$r = sml_cb_receive_projection( signed_request( projection( array( $bloomberg ) ), array( 'timestamp' => time() - 400 ) ) );
ok( $r instanceof WP_Error, 'a stale timestamp is rejected (replay window)' );

$r = sml_cb_receive_projection( signed_request( projection( array( $bloomberg ) ), array( 'timestamp' => time() + 400 ) ) );
ok( $r instanceof WP_Error, 'a far-future timestamp is rejected' );

$r = sml_cb_receive_projection( signed_request( projection( array( $bloomberg ) ), array( 'signature' => 'not-hex' ) ) );
ok( $r instanceof WP_Error, 'a non-hex signature is rejected before comparison' );

$r = sml_cb_receive_projection( new WP_REST_Request( json_encode( projection( array( $bloomberg ) ) ) ) );
ok( $r instanceof WP_Error, 'an unsigned request is rejected' );

/* the body is what is signed: tampering after signing must fail */
$body = json_encode( projection( array( $bloomberg ) ) );
$ts   = (string) time();
$sig  = hash_hmac( 'sha256', $ts . '.' . $body, 'bridge-secret' );
$tampered = new WP_REST_Request( json_encode( projection( array( $bloomberg, $cnn ) ) ), array(
	'x-sml-timestamp' => $ts, 'x-sml-signature' => $sig,
) );
ok( sml_cb_receive_projection( $tampered ) instanceof WP_Error, 'a body swapped after signing is rejected' );

/* --------------------------------------------------------- payload gate */

$r = sml_cb_receive_projection( signed_request( projection( array( $bloomberg ), array( 'count' => 9 ) ) ) );
ok( $r instanceof WP_Error && 422 === $r->data['status'], 'a count that disagrees with the list is rejected' );

$r = sml_cb_receive_projection( signed_request( projection( array(), array( 'empty' => false ) ) ) );
ok( $r instanceof WP_Error, 'an UNFLAGGED empty projection is refused (a broken query must not wipe badges)' );

$r = sml_cb_receive_projection( signed_request( projection( array() ) ) );
ok( $r instanceof SML_Test_Response, 'a FLAGGED empty projection is honoured (genuinely zero is legitimate)' );
ok( 0 === count( sml_cb_accounts() ), 'and it clears the stored accounts' );

$r = sml_cb_receive_projection( signed_request( array( 'version' => 1 ) ) );
ok( $r instanceof WP_Error, 'a payload with no accounts array is rejected' );

/* --------------------------------------------------------- storage rules */

sml_cb_receive_projection( signed_request( projection( array( $bloomberg, $cnn ) ) ) );
$accounts = sml_cb_accounts();
ok( isset( $accounts[258457001] ) && isset( $accounts[258457002] ), 'accounts are keyed by integer user id' );
ok( sml_cb_is_corporate( 258457001 ), 'a projected user is corporate' );
ok( ! sml_cb_is_corporate( 258456543 ), 'an unprojected user is NOT corporate' );
ok( ! sml_cb_is_corporate( 0 ) && ! sml_cb_is_corporate( null ), 'a missing id is never corporate' );

/* wholesale replace: the previous set must not survive */
sml_cb_receive_projection( signed_request( projection( array( $cnn ) ) ) );
ok( ! sml_cb_is_corporate( 258457001 ), 'a suspended account disappears by absence on the next push' );
ok( sml_cb_is_corporate( 258457002 ), 'the remaining account survives' );

/* a hostile category must not reach CSS */
$evil = array_merge( $bloomberg, array( 'category' => 'x;}</style><script>alert(1)</script>' ) );
sml_cb_receive_projection( signed_request( projection( array( $evil ) ) ) );
$stored = sml_cb_accounts();
ok( 'other' === $stored[258457001]['category'], 'an unknown category collapses to the allowlisted default' );

/* rows without an id are dropped rather than stored under 0 */
sml_cb_receive_projection( signed_request( projection( array( $bloomberg, array( 'name' => 'Ghost' ) ) ) ) );
ok( 1 === count( sml_cb_accounts() ), 'a row without a user id is dropped' );

/* ------------------------------------------------------------ rendering */

sml_cb_receive_projection( signed_request( projection( array(
	array_merge( $bloomberg, array( 'name' => 'Bloom<script>alert(1)</script>berg' ) ),
) ) ) );
$html = sml_cb_badge_html( 258457001 );
ok( '' !== $html, 'a corporate user renders a badge' );
ok( false === strpos( $html, '<script>' ), 'the company name cannot inject script' );
ok( false !== strpos( $html, 'aria-label=' ), 'the badge is labelled for screen readers' );
ok( '' === sml_cb_badge_html( 258456543 ), 'a non-corporate user renders nothing' );
ok( '' === sml_cb_badge_html( 0 ), 'user 0 renders nothing' );

$GLOBALS['sml_test_author_id'] = 258457001;
ok( false !== strpos( sml_cb_filter_author( 'Bloomberg' ), 'sml-cb-badge' ), 'the author byline gains a badge' );
$GLOBALS['sml_test_author_id'] = 258456543;
ok( 'Someone' === sml_cb_filter_author( 'Someone' ), 'a normal author byline is untouched' );

/* ------------------------------------------------------------- public read */

$public = sml_cb_public_badges();
ok( $public instanceof SML_Test_Response, 'the public badge map responds' );
$json = json_encode( $public->data );
ok( false === strpos( $json, 'cents' ) && false === strpos( $json, 'verified_domain' ),
	'the public map leaks no billing or verification detail' );
ok( isset( $public->headers['Cache-Control'] ), 'the public map is cacheable but short-lived' );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
