<?php
/**
 * Standalone test for sml-home-owner-controls.php (no WP test framework).
 *
 * Run from the plugin directory:
 *   php tests/test-owner-delete.php
 *
 * Defines lightweight stubs for every WordPress symbol the plugin touches,
 * requires the plugin, then exercises sml_hoc_rest_delete and
 * sml_hoc_patch_home with plain assertions. Exits non-zero on any failure.
 */

error_reporting( E_ALL );
ini_set( 'display_errors', '1' );

/* ------------------------------------------------------------------ */
/* WordPress environment stubs (MUST be defined before the plugin).    */
/* ------------------------------------------------------------------ */

define( 'ABSPATH', dirname( __DIR__ ) . '/' );
define( 'ARRAY_A', 'ARRAY_A' );
define( 'OBJECT', 'OBJECT' );

class WPStub {
	public static $options                = array();
	public static $users                  = array(); // id => stdClass{ID, display_name, user_login}
	public static $user_meta              = array(); // id => key => value
	public static $posts                  = array(); // id => stdClass{ID, post_author}
	public static $comments               = array(); // id => stdClass{comment_ID, user_id}
	public static $caps                   = array(); // id => array of capability strings
	public static $current_user_id        = 0;
	public static $actions                = array(); // collected add_action registrations (never fired)
	public static $rest_routes            = array();
	public static $deleted_posts          = array();
	public static $deleted_comments       = array();
	public static $update_user_meta_calls = array();
	public static $wp_update_user_calls   = array();
}

function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	// Collector no-op: hooks are recorded but never fired in this harness.
	WPStub::$actions[] = array( $hook, $callback, $priority );
	return true;
}

function get_option( $name, $default = false ) {
	return array_key_exists( $name, WPStub::$options ) ? WPStub::$options[ $name ] : $default;
}

function update_option( $name, $value, $autoload = null ) {
	WPStub::$options[ $name ] = $value;
	return true;
}

function get_userdata( $user_id ) {
	$user_id = (int) $user_id;
	return isset( WPStub::$users[ $user_id ] ) ? WPStub::$users[ $user_id ] : false;
}

function get_user_meta( $user_id, $key = '', $single = false ) {
	$user_id = (int) $user_id;
	if ( isset( WPStub::$user_meta[ $user_id ][ $key ] ) ) {
		$value = WPStub::$user_meta[ $user_id ][ $key ];
		return $single ? $value : array( $value );
	}
	return $single ? '' : array();
}

function update_user_meta( $user_id, $meta_key, $meta_value, $prev_value = '' ) {
	$user_id = (int) $user_id;
	WPStub::$user_meta[ $user_id ][ $meta_key ] = $meta_value;
	WPStub::$update_user_meta_calls[]           = array(
		'user_id'    => $user_id,
		'meta_key'   => $meta_key,
		'meta_value' => $meta_value,
	);
	return true;
}

function delete_user_meta( $user_id, $meta_key, $meta_value = '' ) {
	$user_id = (int) $user_id;
	if ( isset( WPStub::$user_meta[ $user_id ][ $meta_key ] ) ) {
		unset( WPStub::$user_meta[ $user_id ][ $meta_key ] );
	}
	return true;
}

function wp_update_user( $userdata ) {
	WPStub::$wp_update_user_calls[] = $userdata;
	$id = isset( $userdata['ID'] ) ? (int) $userdata['ID'] : 0;
	if ( $id && isset( WPStub::$users[ $id ] ) && isset( $userdata['display_name'] ) ) {
		WPStub::$users[ $id ]->display_name = $userdata['display_name'];
	}
	return $id;
}

function get_post( $post_id ) {
	$post_id = (int) $post_id;
	return isset( WPStub::$posts[ $post_id ] ) ? WPStub::$posts[ $post_id ] : null;
}

function get_post_field( $field, $post_id, $context = 'display' ) {
	$post = get_post( $post_id );
	if ( ! $post || ! isset( $post->$field ) ) { return ''; }
	return $post->$field;
}

function wp_delete_post( $post_id, $force_delete = false ) {
	$post_id = (int) $post_id;
	if ( ! isset( WPStub::$posts[ $post_id ] ) ) { return false; }
	$post = WPStub::$posts[ $post_id ];
	unset( WPStub::$posts[ $post_id ] );
	WPStub::$deleted_posts[] = $post_id;
	return $post; // WP returns the post data on success.
}

function get_comment( $comment_id ) {
	$comment_id = (int) $comment_id;
	return isset( WPStub::$comments[ $comment_id ] ) ? WPStub::$comments[ $comment_id ] : null;
}

function wp_delete_comment( $comment_id, $force_delete = false ) {
	$comment_id = (int) $comment_id;
	if ( ! isset( WPStub::$comments[ $comment_id ] ) ) { return false; }
	unset( WPStub::$comments[ $comment_id ] );
	WPStub::$deleted_comments[] = $comment_id;
	return true;
}

function get_current_user_id() {
	return (int) WPStub::$current_user_id;
}

function is_user_logged_in() {
	return get_current_user_id() > 0;
}

function current_user_can( $capability, ...$args ) {
	$uid = get_current_user_id();
	if ( ! $uid ) { return false; }
	$caps = isset( WPStub::$caps[ $uid ] ) ? WPStub::$caps[ $uid ] : array();
	if ( in_array( 'manage_options', $caps, true ) ) { return true; } // admins pass every check
	if ( 'delete_post' === $capability ) {
		// WP maps delete_post to the author's own-post caps: an author can
		// delete their own post; everyone else (non-admin) cannot.
		$post_id = isset( $args[0] ) ? (int) $args[0] : 0;
		$post    = get_post( $post_id );
		return $post && (int) $post->post_author === $uid;
	}
	return in_array( $capability, $caps, true );
}

function sanitize_text_field( $str ) {
	$str = (string) $str;
	$str = strip_tags( $str );
	$str = preg_replace( '/[\r\n\t ]+/', ' ', $str );
	return trim( $str );
}

function sanitize_key( $key ) {
	return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $key ) );
}

function absint( $maybeint ) {
	return abs( (int) $maybeint );
}

function esc_attr( $text ) { return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8', false ); }
function esc_html( $text ) { return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8', false ); }
function esc_url( $url ) { return (string) $url; }
function esc_url_raw( $url ) { return (string) $url; }

function wp_json_encode( $data, $options = 0, $depth = 512 ) {
	return json_encode( $data, $options, $depth );
}

function wp_create_nonce( $action = -1 ) {
	return 'testnonce-' . $action;
}

function rest_url( $path = '' ) {
	return 'https://example.test/wp-json/' . ltrim( (string) $path, '/' );
}

function wp_parse_url( $url, $component = -1 ) {
	return parse_url( (string) $url, $component );
}

function maybe_unserialize( $data ) {
	if ( is_string( $data ) ) {
		$trim = trim( $data );
		if ( 'N;' === $trim || preg_match( '/^[abdiOsC]:/', $trim ) ) {
			$un = @unserialize( $trim );
			if ( false !== $un || 'b:0;' === $trim ) { return $un; }
		}
	}
	return $data;
}

function get_avatar_url( $id_or_email, $args = null ) {
	return 'https://example.test/avatar/' . absint( $id_or_email ) . '.png';
}

function get_author_posts_url( $author_id, $author_nicename = '' ) {
	return 'https://example.test/author/' . absint( $author_id ) . '/';
}

function is_wp_error( $thing ) {
	return $thing instanceof WP_Error;
}

function register_rest_route( $namespace, $route, $args = array(), $override = false ) {
	WPStub::$rest_routes[] = array( $namespace, $route, $args );
	return true;
}

function rest_ensure_response( $response ) {
	if ( $response instanceof WP_REST_Response ) { return $response; }
	return new WP_REST_Response( $response );
}

class WP_Error {
	public $errors     = array();
	public $error_data = array();

	public function __construct( $code = '', $message = '', $data = '' ) {
		if ( '' === $code || null === $code ) { return; }
		$this->errors[ $code ][] = $message;
		if ( ! empty( $data ) ) { $this->error_data[ $code ] = $data; }
	}

	public function get_error_code() {
		$codes = array_keys( $this->errors );
		return isset( $codes[0] ) ? $codes[0] : '';
	}

	public function get_error_message( $code = '' ) {
		if ( '' === $code ) { $code = $this->get_error_code(); }
		return isset( $this->errors[ $code ][0] ) ? $this->errors[ $code ][0] : '';
	}

	public function get_error_data( $code = '' ) {
		if ( '' === $code ) { $code = $this->get_error_code(); }
		return isset( $this->error_data[ $code ] ) ? $this->error_data[ $code ] : null;
	}
}

class WP_REST_Request {
	private $params;

	public function __construct( $params = array() ) {
		$this->params = (array) $params;
	}

	public function get_param( $key ) {
		return isset( $this->params[ $key ] ) ? $this->params[ $key ] : null;
	}
}

class WP_REST_Response {
	public $data;
	public $status  = 200;
	public $headers = array();

	public function __construct( $data = null, $status = 200 ) {
		$this->data   = $data;
		$this->status = (int) $status;
	}

	public function header( $key, $value, $replace = true ) {
		$this->headers[ $key ] = $value;
	}

	public function get_data() { return $this->data; }
	public function get_status() { return $this->status; }
}

class WP_REST_Server {
	const READABLE  = 'GET';
	const CREATABLE = 'POST';
	const EDITABLE  = 'POST, PUT, PATCH';
	const DELETABLE = 'DELETE';
}

class WPDB_Stub {
	public $usermeta = 'wp_usermeta';

	public function prepare( $query, ...$args ) {
		if ( isset( $args[0] ) && is_array( $args[0] ) ) { $args = $args[0]; }
		foreach ( $args as $arg ) {
			if ( is_int( $arg ) || is_float( $arg ) ) {
				$query = preg_replace( '/%[df]/', (string) $arg, $query, 1 );
			} else {
				$query = preg_replace( '/%s/', "'" . addslashes( (string) $arg ) . "'", $query, 1 );
			}
		}
		return $query;
	}

	public function get_results( $query, $output = OBJECT ) {
		// Seeded from the WPStub::$user_meta fixture, mirroring the usermeta
		// table: one row per user holding the requested meta_key, with the
		// value stored serialized exactly as WP would persist an array.
		$meta_key = '';
		if ( preg_match( "/meta_key\s*=\s*'([^']+)'/", (string) $query, $m ) ) { $meta_key = $m[1]; }
		$rows = array();
		foreach ( WPStub::$user_meta as $uid => $metas ) {
			if ( '' === $meta_key || ! array_key_exists( $meta_key, $metas ) ) { continue; }
			$value  = $metas[ $meta_key ];
			$rows[] = array(
				'user_id'    => (string) $uid,
				'meta_value' => ( is_array( $value ) || is_object( $value ) ) ? serialize( $value ) : (string) $value,
			);
		}
		if ( ARRAY_A === $output ) { return $rows; }
		$objects = array();
		foreach ( $rows as $row ) { $objects[] = (object) $row; }
		return $objects;
	}
}

$GLOBALS['wpdb'] = new WPDB_Stub();
$wpdb            = $GLOBALS['wpdb'];

/* ------------------------------------------------------------------ */
/* Load the plugin under test.                                         */
/* ------------------------------------------------------------------ */

require dirname( __DIR__ ) . '/sml-home-owner-controls.php';

/* ------------------------------------------------------------------ */
/* Tiny assertion helper.                                              */
/* ------------------------------------------------------------------ */

$GLOBALS['t_pass'] = 0;
$GLOBALS['t_fail'] = 0;

function t_assert( $cond, $label ) {
	if ( $cond ) {
		$GLOBALS['t_pass']++;
		echo "PASS  $label\n";
	} else {
		$GLOBALS['t_fail']++;
		echo "FAIL  $label\n";
	}
}

function t_assert_error( $result, $code, $status, $label ) {
	t_assert( $result instanceof WP_Error, "$label -> returns WP_Error" );
	if ( ! ( $result instanceof WP_Error ) ) { return; }
	$got_code = $result->get_error_code();
	t_assert( $got_code === $code, "$label -> error code '$code' (got '$got_code')" );
	$data       = $result->get_error_data();
	$got_status = is_array( $data ) && isset( $data['status'] ) ? (int) $data['status'] : null;
	t_assert( $got_status === $status, "$label -> status $status (got " . var_export( $got_status, true ) . ')' );
}

/* ------------------------------------------------------------------ */
/* Fixture.                                                            */
/* ------------------------------------------------------------------ */

function reset_fixture( $current_user = 0 ) {
	WPStub::$options   = array();
	WPStub::$users     = array(
		10 => (object) array( 'ID' => 10, 'display_name' => 'Owner Ten', 'user_login' => 'owner10' ),
		11 => (object) array( 'ID' => 11, 'display_name' => 'Other Eleven', 'user_login' => 'other11' ),
		99 => (object) array( 'ID' => 99, 'display_name' => 'Site Admin', 'user_login' => 'admin99' ),
	);
	WPStub::$user_meta = array(
		10 => array(
			'sml_profile_chart_posts' => array(
				array( 'id' => 'abc123', 'author_id' => 10, 'title' => 'Chart A' ),
				array( 'id' => 'keepme', 'author_id' => 10, 'title' => 'Chart B' ),
			),
		),
	);
	WPStub::$posts     = array(
		5 => (object) array( 'ID' => 5, 'post_author' => 10 ),
		6 => (object) array( 'ID' => 6, 'post_author' => 11 ),
		7 => (object) array( 'ID' => 7, 'post_author' => 0 ), // system import, author 0
	);
	WPStub::$comments  = array(
		77 => (object) array( 'comment_ID' => 77, 'user_id' => 10 ),
		78 => (object) array( 'comment_ID' => 78, 'user_id' => 0 ), // system import, author 0
	);
	WPStub::$caps      = array(
		99 => array( 'manage_options' ),
	);
	WPStub::$current_user_id        = (int) $current_user;
	WPStub::$deleted_posts          = array();
	WPStub::$deleted_comments       = array();
	WPStub::$update_user_meta_calls = array();
	WPStub::$wp_update_user_calls   = array();
}

function run_delete( $item_id, $current_user ) {
	reset_fixture( $current_user );
	$request = new WP_REST_Request( array( 'item_id' => $item_id ) );
	return sml_hoc_rest_delete( $request );
}

function home_fixture_html() {
	return '<html><body><div id="sml-optimized-home">'
		. '<article class="oh-card" data-hfe-item="wp-5"><a class="oh-post-author" href="/stockmarketloop/owner10/"><img class="oh-post-avatar" src="/old-avatar.png" alt="Old"><span class="oh-post-author-name">Old Name</span></a><h2>Post five</h2></article>'
		. '<article class="oh-card" data-hfe-item="wp-7"><a class="oh-post-author" href="/legacy-author/">Legacy Author</a><h2>Post seven</h2></article>'
		. '</div><script src="/wp-content/js/home-feed.js?v=1"></script></body></html>';
}

/* ------------------------------------------------------------------ */
/* Case 1: owner deletes own wp-{id} -> 200 deleted:true               */
/* ------------------------------------------------------------------ */

$result = run_delete( 'wp-5', 10 );
t_assert( $result instanceof WP_REST_Response, 'case1 owner wp-5 -> WP_REST_Response' );
if ( $result instanceof WP_REST_Response ) {
	t_assert( 200 === $result->get_status(), 'case1 -> status 200' );
	$data = $result->get_data();
	t_assert( is_array( $data ) && true === ( $data['deleted'] ?? null ), 'case1 -> deleted:true' );
	t_assert( 'wordpress' === ( $data['type'] ?? null ) && 5 === ( $data['id'] ?? null ), 'case1 -> type wordpress, id 5' );
	t_assert( in_array( 5, WPStub::$deleted_posts, true ), 'case1 -> wp_delete_post(5) actually ran' );
	t_assert( 'private, no-store' === ( $result->headers['Cache-Control'] ?? null ), 'case1 -> Cache-Control private, no-store header set' );
}

/* ------------------------------------------------------------------ */
/* Case 2: admin deletes someone else's wp-{id} -> deleted:true        */
/* ------------------------------------------------------------------ */

$result = run_delete( 'wp-6', 99 );
t_assert( $result instanceof WP_REST_Response, 'case2 admin wp-6 -> WP_REST_Response' );
if ( $result instanceof WP_REST_Response ) {
	$data = $result->get_data();
	t_assert( is_array( $data ) && true === ( $data['deleted'] ?? null ), 'case2 -> deleted:true' );
	t_assert( in_array( 6, WPStub::$deleted_posts, true ), 'case2 -> wp_delete_post(6) actually ran' );
}

/* ------------------------------------------------------------------ */
/* Case 3: non-owner non-admin on wp-{id} -> 403 sml_hoc_owner         */
/* ------------------------------------------------------------------ */

$result = run_delete( 'wp-5', 11 );
t_assert_error( $result, 'sml_hoc_owner', 403, 'case3 non-owner wp-5' );
t_assert( array() === WPStub::$deleted_posts, 'case3 -> nothing was deleted' );

/* ------------------------------------------------------------------ */
/* Case 4: missing post wp-999 -> 404 sml_hoc_missing                  */
/* ------------------------------------------------------------------ */

$result = run_delete( 'wp-999', 10 );
t_assert_error( $result, 'sml_hoc_missing', 404, 'case4 missing wp-999' );

/* ------------------------------------------------------------------ */
/* Case 5: chart owner delete -> deleted:true, usermeta row removed    */
/* ------------------------------------------------------------------ */

$result = run_delete( 'chart-10-abc123', 10 );
t_assert( $result instanceof WP_REST_Response, 'case5 owner chart -> WP_REST_Response' );
if ( $result instanceof WP_REST_Response ) {
	$data = $result->get_data();
	t_assert( is_array( $data ) && true === ( $data['deleted'] ?? null ), 'case5 -> deleted:true' );
	t_assert( 'chart' === ( $data['type'] ?? null ) && 'abc123' === ( $data['id'] ?? null ), 'case5 -> type chart, id abc123' );
}
t_assert( 1 === count( WPStub::$update_user_meta_calls ), 'case5 -> update_user_meta called exactly once' );
if ( count( WPStub::$update_user_meta_calls ) ) {
	$call = WPStub::$update_user_meta_calls[0];
	t_assert( 10 === $call['user_id'] && 'sml_profile_chart_posts' === $call['meta_key'], 'case5 -> update_user_meta targeted user 10 / sml_profile_chart_posts' );
	$new_rows = $call['meta_value'];
	$ids      = array();
	foreach ( (array) $new_rows as $row ) { $ids[] = is_array( $row ) ? ( $row['id'] ?? '' ) : ''; }
	t_assert( 1 === count( (array) $new_rows ), 'case5 -> row list shrank from 2 to 1' );
	t_assert( ! in_array( 'abc123', $ids, true ) && in_array( 'keepme', $ids, true ), 'case5 -> abc123 removed, keepme kept' );
}
$backing = WPStub::$user_meta[10]['sml_profile_chart_posts'];
t_assert( is_array( $backing ) && 1 === count( $backing ), 'case5 -> backing usermeta fixture actually shrank' );

/* ------------------------------------------------------------------ */
/* Case 6: chart non-owner -> 403                                      */
/* ------------------------------------------------------------------ */

$result = run_delete( 'chart-10-abc123', 11 );
t_assert_error( $result, 'sml_hoc_owner', 403, 'case6 non-owner chart' );
t_assert( array() === WPStub::$update_user_meta_calls, 'case6 -> update_user_meta never called' );
t_assert( 2 === count( WPStub::$user_meta[10]['sml_profile_chart_posts'] ), 'case6 -> chart list untouched' );

/* ------------------------------------------------------------------ */
/* Case 7: stream owner delete -> deleted:true; non-owner -> 403       */
/* ------------------------------------------------------------------ */

$result = run_delete( 'stream-77', 10 );
t_assert( $result instanceof WP_REST_Response, 'case7a owner stream-77 -> WP_REST_Response' );
if ( $result instanceof WP_REST_Response ) {
	$data = $result->get_data();
	t_assert( is_array( $data ) && true === ( $data['deleted'] ?? null ), 'case7a -> deleted:true' );
	t_assert( 'stream' === ( $data['type'] ?? null ) && 77 === ( $data['id'] ?? null ), 'case7a -> type stream, id 77' );
	t_assert( in_array( 77, WPStub::$deleted_comments, true ), 'case7a -> wp_delete_comment(77) actually ran' );
}

$result = run_delete( 'stream-77', 11 );
t_assert_error( $result, 'sml_hoc_owner', 403, 'case7b non-owner stream-77' );
t_assert( array() === WPStub::$deleted_comments, 'case7b -> comment not deleted' );

/* ------------------------------------------------------------------ */
/* Case 8: bogus item id -> 400 sml_hoc_bad_item                       */
/* ------------------------------------------------------------------ */

$result = run_delete( 'bogus-thing-1', 10 );
t_assert_error( $result, 'sml_hoc_bad_item', 400, 'case8 bogus item id' );

/* ------------------------------------------------------------------ */
/* Case 9: logged out -> 401                                           */
/* ------------------------------------------------------------------ */

$result = run_delete( 'wp-5', 0 );
t_assert_error( $result, 'sml_hoc_sign_in', 401, 'case9 logged out' );

/* ------------------------------------------------------------------ */
/* Case 10: sml_hoc_patch_home — admin sees delete on BOTH cards       */
/* ------------------------------------------------------------------ */

reset_fixture( 99 );
$out = sml_hoc_patch_home( home_fixture_html() );
t_assert( 1 === substr_count( $out, 'data-sml-delete-item="wp-5"' ), 'case10 admin -> delete button on resolvable card wp-5' );
t_assert( 1 === substr_count( $out, 'data-sml-delete-item="wp-7"' ), 'case10 admin -> delete button on unresolvable card wp-7' );
t_assert( false !== strpos( $out, '<a class="oh-post-author" href="/legacy-author/">Legacy Author</a>' ), 'case10 admin -> original author markup preserved on unresolvable card' );
t_assert( false !== strpos( $out, 'data-sml-user-id="10"' ), 'case10 admin -> resolvable card got refreshed identity markup' );
t_assert( false !== strpos( $out, 'data-sml-owner-id="10"' ) && false !== strpos( $out, 'data-sml-owner-id="0"' ), 'case10 admin -> owner-id attributes stamped on both cards' );

/* ------------------------------------------------------------------ */
/* Case 11: patch_home — plain owner sees button ONLY on own card      */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
$out = sml_hoc_patch_home( home_fixture_html() );
t_assert( 1 === substr_count( $out, 'data-sml-delete-item="wp-5"' ), 'case11 owner -> delete button on own card wp-5' );
t_assert( 0 === substr_count( $out, 'data-sml-delete-item="wp-7"' ), 'case11 owner -> NO delete button on unresolvable card wp-7' );
t_assert( false !== strpos( $out, '<a class="oh-post-author" href="/legacy-author/">Legacy Author</a>' ), 'case11 owner -> original author markup preserved on unresolvable card' );

/* ------------------------------------------------------------------ */
/* Case 12: patch_home — config script once, BEFORE home-feed.js       */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
$out     = sml_hoc_patch_home( home_fixture_html() );
$cfg_pos = strpos( $out, 'window.SMLHomeOwnerControls=' );
$js_pos  = strpos( $out, 'home-feed.js' );
t_assert( 1 === substr_count( $out, 'window.SMLHomeOwnerControls=' ), 'case12 logged in -> exactly one config script' );
t_assert( false !== $cfg_pos && false !== $js_pos && $cfg_pos < $js_pos, 'case12 -> config script injected BEFORE home-feed.js tag' );
t_assert( false !== strpos( $out, 'testnonce-wp_rest' ), 'case12 -> config carries the wp_rest nonce' );
t_assert( false !== strpos( $out, 'sml-home-owner\/v1\/content' ) || false !== strpos( $out, 'sml-home-owner/v1/content' ), 'case12 -> config carries the REST endpoint' );

/* ------------------------------------------------------------------ */
/* Case 13: patch_home — logged out: no buttons, no config script      */
/* ------------------------------------------------------------------ */

reset_fixture( 0 );
$out = sml_hoc_patch_home( home_fixture_html() );
t_assert( 0 === substr_count( $out, 'data-sml-delete-item=' ), 'case13 logged out -> no delete buttons at all' );
t_assert( false === strpos( $out, 'window.SMLHomeOwnerControls' ), 'case13 logged out -> no config script injected' );

/* ------------------------------------------------------------------ */
/* Summary.                                                            */
/* ------------------------------------------------------------------ */

echo "\n";
/* ------------------------------------------------------------------ */
/* Case 14: author-0 stream comment — admin CAN moderate, others 403   */
/* (regression guard: owner_id 0 must not be conflated with "missing") */
/* ------------------------------------------------------------------ */

$result = run_delete( 'stream-78', 99 ); // admin
t_assert( $result instanceof WP_REST_Response && 200 === $result->get_status(), 'case14 admin deletes author-0 stream-78 -> 200' );
t_assert( in_array( 78, WPStub::$deleted_comments, true ), 'case14 -> wp_delete_comment(78) actually ran' );

$result = run_delete( 'stream-78', 10 ); // plain member, not the author
t_assert_error( $result, 'sml_hoc_owner', 403, 'case14 non-admin on author-0 stream-78' );
t_assert( ! in_array( 78, WPStub::$deleted_comments, true ), 'case14 -> comment 78 untouched by non-admin' );

$result = run_delete( 'stream-404404', 99 ); // truly missing comment
t_assert_error( $result, 'sml_hoc_missing', 404, 'case14 genuinely missing stream comment -> 404' );

/* ------------------------------------------------------------------ */
/* Case 15: chart-0-{id} is an invalid identifier -> 400, never a scan */
/* ------------------------------------------------------------------ */

$result = run_delete( 'chart-0-abc123', 99 );
t_assert_error( $result, 'sml_hoc_bad_id', 400, 'case15 chart-0-{id} -> 400 invalid identifier' );
t_assert( array() === WPStub::$update_user_meta_calls, 'case15 -> no usermeta write attempted' );

/* ------------------------------------------------------------------ */
/* Case 16: SML News identity migration uses the gold news artwork     */
/* while leaving login/nicename/profile routing entirely untouched.   */
/* ------------------------------------------------------------------ */

WPStub::$options = array();
WPStub::$users[258456587] = (object) array(
	'ID'           => 258456587,
	'display_name' => 'Old Name',
	'user_login'   => 'stockmarketloop',
	'user_nicename'=> 'stockmarketloop',
);
WPStub::$user_meta[258456587] = array(
	'sml_avatar_url'           => 'https://example.test/old-avatar.png',
	'sml_avatar_attachment_id' => 991,
);
WPStub::$update_user_meta_calls = array();
WPStub::$wp_update_user_calls   = array();
sml_hoc_migrate_news_identity();
t_assert( 'SML News' === WPStub::$user_meta[258456587]['sml_display_handle'], 'case16 -> display handle is SML News' );
t_assert( 'SML News' === WPStub::$user_meta[258456587]['sml_display_name'], 'case16 -> profile display name is SML News' );
t_assert( 'stockmarketloop' === WPStub::$user_meta[258456587]['sml_public_handle'], 'case16 -> stable public profile handle remains stockmarketloop' );
t_assert( 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@main/img/sml-news-avatar-gold-v1.png' === WPStub::$user_meta[258456587]['sml_avatar_url'], 'case16 -> gold SML News avatar is canonical' );
t_assert( ! isset( WPStub::$user_meta[258456587]['sml_avatar_attachment_id'] ), 'case16 -> stale managed attachment id removed' );
t_assert( 'SML News' === WPStub::$users[258456587]->display_name, 'case16 -> WordPress display name is SML News' );
t_assert( 'stockmarketloop' === WPStub::$users[258456587]->user_login && 'stockmarketloop' === WPStub::$users[258456587]->user_nicename, 'case16 -> stable login and profile slug remain stockmarketloop' );
t_assert( '1.0.4' === WPStub::$options['sml_hoc_identity_version'], 'case16 -> migration version stored' );

printf( "Total: %d assertions, %d passed, %d failed\n", $GLOBALS['t_pass'] + $GLOBALS['t_fail'], $GLOBALS['t_pass'], $GLOBALS['t_fail'] );
if ( $GLOBALS['t_fail'] > 0 ) {
	echo "RESULT: FAIL\n";
	exit( 1 );
}
echo "RESULT: ALL PASS\n";
exit( 0 );
