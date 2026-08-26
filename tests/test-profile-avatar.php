<?php
/**
 * Standalone test for wpcode/profile-avatar.php (no WP test framework).
 *
 * Run from the repo root:
 *   php tests/test-profile-avatar.php
 *
 * Defines lightweight stubs for every WordPress symbol the snippet touches,
 * loads the snippet through a <?php-prepended wrapper (the WPCode body has no
 * opening tag), then exercises sml_av_route and the collected
 * pre_get_avatar_data / rest_api_init / wp_footer callbacks with plain
 * assertions. Exits non-zero on any failure.
 *
 * NOTE: the wp_footer cases that assert fail-closed behavior MUST run before
 * sml_cdn_resolve_ref is defined — a PHP function cannot be undefined, so the
 * resolver stub is declared conditionally at the very end of the suite.
 */

error_reporting( E_ALL );
ini_set( 'display_errors', '1' );

/* ------------------------------------------------------------------ */
/* Fake ABSPATH: temp dir with real (empty) wp-admin include files so  */
/* the snippet's require_once calls succeed.                           */
/* ------------------------------------------------------------------ */

$fake_root = rtrim( sys_get_temp_dir(), '/\\' ) . DIRECTORY_SEPARATOR . 'sml-avatar-test-abspath' . DIRECTORY_SEPARATOR;
foreach ( array( 'wp-admin/includes', 'wp-content/uploads' ) as $dir ) {
	if ( ! is_dir( $fake_root . $dir ) ) { mkdir( $fake_root . $dir, 0777, true ); }
}
foreach ( array( 'file.php', 'image.php', 'media.php' ) as $inc ) {
	file_put_contents( $fake_root . 'wp-admin/includes/' . $inc, "<?php // stub include for tests\n" );
}
define( 'ABSPATH', $fake_root );

const SML_TEST_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* ------------------------------------------------------------------ */
/* WordPress environment stubs (MUST be defined before the snippet).   */
/* ------------------------------------------------------------------ */

class WPStub {
	public static $users                  = array(); // id => stdClass{ID, user_email}
	public static $user_meta              = array(); // id => key => value
	public static $post_meta              = array(); // post id => key => value
	public static $posts                  = array(); // id => stdClass{ID, post_type, post_mime_type, post_author}
	public static $caps                   = array(); // id => array of capability strings
	public static $current_user_id        = 0;
	public static $filters                = array(); // hook => array of callbacks (collected, fired manually)
	public static $actions                = array(); // hook => array of callbacks (collected, fired manually)
	public static $rest_routes            = array();
	public static $downsize               = array(); // attachment id => image_downsize() return
	public static $downsize_calls         = array(); // every image_downsize() invocation
	public static $attachment_urls        = array(); // attachment id => full URL
	public static $filetype_override      = null;    // forced wp_check_filetype_and_ext() return
	public static $image_mime_override    = 'DERIVE'; // 'DERIVE' = from extension; anything else (incl. false) returned verbatim
	public static $transients             = array(); // key => value (reset between cases)
	public static $set_transient_calls    = array();
	public static $sideload_calls         = array();
	public static $insert_attachment_calls = array();
	public static $update_attach_meta_calls = array();
	public static $update_post_meta_calls = array();
	public static $delete_attachment_calls = array();
	public static $update_user_meta_calls = array();
	public static $delete_user_meta_calls = array();
	public static $next_post_id           = 1000;
}

function add_filter( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	WPStub::$filters[ $hook ][] = $callback; // collected, never auto-fired
	return true;
}

function add_action( $hook, $callback, $priority = 10, $accepted_args = 1 ) {
	WPStub::$actions[ $hook ][] = $callback; // collected, never auto-fired
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
	return in_array( $capability, $caps, true );
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
	WPStub::$delete_user_meta_calls[] = array( 'user_id' => $user_id, 'meta_key' => $meta_key );
	unset( WPStub::$user_meta[ $user_id ][ $meta_key ] );
	return true;
}

function get_post_meta( $post_id, $key = '', $single = false ) {
	$post_id = (int) $post_id;
	if ( isset( WPStub::$post_meta[ $post_id ][ $key ] ) ) {
		$value = WPStub::$post_meta[ $post_id ][ $key ];
		return $single ? $value : array( $value );
	}
	return $single ? '' : array();
}

function update_post_meta( $post_id, $meta_key, $meta_value, $prev_value = '' ) {
	$post_id = (int) $post_id;
	WPStub::$post_meta[ $post_id ][ $meta_key ] = $meta_value;
	WPStub::$update_post_meta_calls[]           = array(
		'post_id'    => $post_id,
		'meta_key'   => $meta_key,
		'meta_value' => $meta_value,
	);
	return true;
}

function wp_delete_attachment( $post_id, $force_delete = false ) {
	$post_id = (int) $post_id;
	WPStub::$delete_attachment_calls[] = array( 'id' => $post_id, 'force' => (bool) $force_delete );
	$post = isset( WPStub::$posts[ $post_id ] ) ? WPStub::$posts[ $post_id ] : null;
	unset( WPStub::$posts[ $post_id ], WPStub::$post_meta[ $post_id ] );
	return $post;
}

function get_transient( $transient ) {
	return isset( WPStub::$transients[ $transient ] ) ? WPStub::$transients[ $transient ] : false;
}

function set_transient( $transient, $value, $expiration = 0 ) {
	WPStub::$transients[ $transient ]  = $value;
	WPStub::$set_transient_calls[]     = array(
		'key'        => $transient,
		'value'      => $value,
		'expiration' => (int) $expiration,
	);
	return true;
}

function get_post( $post_id ) {
	$post_id = (int) $post_id;
	return isset( WPStub::$posts[ $post_id ] ) ? WPStub::$posts[ $post_id ] : null;
}

function get_user_by( $field, $value ) {
	if ( 'email' === $field ) {
		foreach ( WPStub::$users as $user ) {
			if ( isset( $user->user_email ) && $user->user_email === $value ) { return $user; }
		}
	}
	return false;
}

function is_email( $email ) {
	// WP returns the email itself on success, false otherwise.
	return filter_var( (string) $email, FILTER_VALIDATE_EMAIL ) ? $email : false;
}

function absint( $maybeint ) {
	return abs( (int) $maybeint );
}

function sanitize_text_field( $str ) {
	$str = strip_tags( (string) $str );
	$str = preg_replace( '/[\r\n\t ]+/', ' ', $str );
	return trim( $str );
}

function esc_attr( $text ) { return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8', false ); }
function esc_url_raw( $url ) { return (string) $url; }

function wp_json_encode( $data, $options = 0, $depth = 512 ) {
	return json_encode( $data, $options, $depth );
}

function wp_create_nonce( $action = -1 ) {
	return 'testnonce-' . $action;
}

function get_avatar_url( $id_or_email, $args = null ) {
	$size = is_array( $args ) && isset( $args['size'] ) ? (int) $args['size'] : 96;
	return 'https://secure.gravatar.com/avatar/u' . absint( $id_or_email ) . '?s=' . $size;
}

function wp_get_attachment_url( $attachment_id ) {
	$attachment_id = (int) $attachment_id;
	if ( isset( WPStub::$attachment_urls[ $attachment_id ] ) ) { return WPStub::$attachment_urls[ $attachment_id ]; }
	return 'https://example.test/wp-content/uploads/full-' . $attachment_id . '.png';
}

function image_downsize( $id, $size = 'medium' ) {
	$id = (int) $id;
	WPStub::$downsize_calls[] = array( 'id' => $id, 'size' => $size );
	return isset( WPStub::$downsize[ $id ] ) ? WPStub::$downsize[ $id ] : false;
}

function wp_check_filetype_and_ext( $file, $filename, $mimes = null ) {
	if ( null !== WPStub::$filetype_override ) { return WPStub::$filetype_override; }
	$ext  = strtolower( (string) pathinfo( (string) $filename, PATHINFO_EXTENSION ) );
	$map  = array(
		'jpg'  => 'image/jpeg', 'jpeg' => 'image/jpeg', 'jpe' => 'image/jpeg',
		'png'  => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif',
		'txt'  => 'text/plain',
	);
	$type = isset( $map[ $ext ] ) ? $map[ $ext ] : false;
	return array( 'ext' => $type ? $ext : false, 'type' => $type, 'proper_filename' => false );
}

function wp_get_image_mime( $file ) {
	// 'DERIVE' (the reset default) sniffs by extension so honest fixtures pass;
	// override with false (or a mime string) to simulate unidentifiable bytes.
	if ( 'DERIVE' !== WPStub::$image_mime_override ) { return WPStub::$image_mime_override; }
	$ext = strtolower( (string) pathinfo( (string) $file, PATHINFO_EXTENSION ) );
	$map = array(
		'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'jpe' => 'image/jpeg',
		'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif',
	);
	return isset( $map[ $ext ] ) ? $map[ $ext ] : false;
}

function wp_handle_sideload( $file, $overrides = array() ) {
	WPStub::$sideload_calls[] = array( 'file' => $file, 'overrides' => $overrides );
	if ( empty( $file['tmp_name'] ) || ! is_file( $file['tmp_name'] ) ) {
		return array( 'error' => 'Specified file failed upload test.' );
	}
	$dest = ABSPATH . 'wp-content/uploads/' . basename( (string) $file['name'] );
	copy( $file['tmp_name'], $dest ); // real WP moves; copy keeps the fixture file reusable
	$check = wp_check_filetype_and_ext( $dest, $file['name'] );
	return array(
		'file' => $dest,
		'url'  => 'https://example.test/wp-content/uploads/' . basename( (string) $file['name'] ),
		'type' => (string) $check['type'],
	);
}

function wp_insert_attachment( $args, $file = false, $parent = 0 ) {
	$id                                = ++WPStub::$next_post_id;
	WPStub::$insert_attachment_calls[] = array( 'id' => $id, 'args' => $args, 'file' => $file );
	WPStub::$posts[ $id ]              = (object) array_merge(
		array( 'post_mime_type' => '', 'post_title' => '', 'post_status' => 'inherit', 'post_author' => 0 ),
		(array) $args,
		array( 'ID' => $id, 'post_type' => 'attachment' )
	);
	return $id;
}

function wp_generate_attachment_metadata( $attachment_id, $file ) {
	return array( 'file' => basename( (string) $file ), 'width' => 1, 'height' => 1, 'sizes' => array() );
}

function wp_update_attachment_metadata( $attachment_id, $data ) {
	$attachment_id = (int) $attachment_id;
	WPStub::$update_attach_meta_calls[] = array(
		'id'          => $attachment_id,
		'data'        => $data,
		// was the reap tag already written when metadata generation ran?
		'tag_present' => isset( WPStub::$post_meta[ $attachment_id ]['_sml_avatar_for'] ),
	);
	return true;
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
	private $method;

	public function __construct( $method = 'GET', $params = array() ) {
		$this->method = strtoupper( (string) $method );
		$this->params = (array) $params;
	}

	public function get_param( $key ) {
		return isset( $this->params[ $key ] ) ? $this->params[ $key ] : null;
	}

	public function get_method() {
		return $this->method;
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

class WP_User {
	public $ID = 0;
	public function __construct( $id = 0 ) { $this->ID = (int) $id; }
}

class WP_Post {
	public $ID          = 0;
	public $post_author = 0;
	public function __construct( $props = array() ) {
		foreach ( (array) $props as $k => $v ) { $this->$k = $v; }
	}
}

class WP_Comment {
	public $comment_ID           = 0;
	public $user_id              = 0;
	public $comment_author_email = '';
	public function __construct( $props = array() ) {
		foreach ( (array) $props as $k => $v ) { $this->$k = $v; }
	}
}

/* ------------------------------------------------------------------ */
/* Load the snippet under test (WPCode body has no <?php tag).         */
/* ------------------------------------------------------------------ */

$snippet_src = file_get_contents( dirname( __DIR__ ) . '/wpcode/profile-avatar.php' );
if ( false === $snippet_src || '' === trim( $snippet_src ) ) {
	fwrite( STDERR, "Could not read wpcode/profile-avatar.php\n" );
	exit( 1 );
}
$wrapper = ABSPATH . 'profile-avatar-under-test.php';
file_put_contents( $wrapper, "<?php\n" . $snippet_src );
require $wrapper;

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
	$_FILES = array(); // $_FILES is global state — wiped before every case
	WPStub::$users = array(
		10 => (object) array( 'ID' => 10, 'user_email' => 'ten@example.test' ),
		11 => (object) array( 'ID' => 11, 'user_email' => 'eleven@example.test' ),
		99 => (object) array( 'ID' => 99, 'user_email' => 'admin@example.test' ),
	);
	WPStub::$user_meta = array();
	WPStub::$post_meta = array();
	WPStub::$posts     = array();
	WPStub::$caps      = array(
		99 => array( 'manage_options' ),
	);
	WPStub::$current_user_id          = (int) $current_user;
	WPStub::$rest_routes              = array();
	WPStub::$downsize                 = array();
	WPStub::$downsize_calls           = array();
	WPStub::$attachment_urls          = array();
	WPStub::$filetype_override        = null;
	WPStub::$image_mime_override      = 'DERIVE';
	WPStub::$transients               = array(); // throttle window resets between cases
	WPStub::$set_transient_calls      = array();
	WPStub::$sideload_calls           = array();
	WPStub::$insert_attachment_calls  = array();
	WPStub::$update_attach_meta_calls = array();
	WPStub::$update_post_meta_calls   = array();
	WPStub::$delete_attachment_calls  = array();
	WPStub::$update_user_meta_calls   = array();
	WPStub::$delete_user_meta_calls   = array();
	WPStub::$next_post_id             = 1000;
}

function seed_upload_file( $bytes, $overrides = array() ) {
	$tmp = ABSPATH . 'php-tmp-upload';
	file_put_contents( $tmp, $bytes );
	clearstatcache( true, $tmp ); // same path is rewritten between cases
	$_FILES['file'] = array_merge( array(
		'name'     => 'avatar.png',
		'type'     => 'image/png',
		'tmp_name' => $tmp,
		'error'    => 0,
		'size'     => filesize( $tmp ),
	), $overrides );
}

function run_route( $method, $params = array() ) {
	$request = new WP_REST_Request( $method, $params );
	return sml_av_route( $request );
}

/* ------------------------------------------------------------------ */
/* Sanity: hooks were collected; rest_api_init registers the route.    */
/* ------------------------------------------------------------------ */

reset_fixture( 0 );
t_assert( isset( WPStub::$filters['pre_get_avatar_data'][0] ), 'setup -> pre_get_avatar_data filter collected' );
t_assert( isset( WPStub::$actions['rest_api_init'][0] ), 'setup -> rest_api_init action collected' );
t_assert( isset( WPStub::$actions['wp_footer'][0] ), 'setup -> wp_footer action collected' );
call_user_func( WPStub::$actions['rest_api_init'][0] );
t_assert( 1 === count( WPStub::$rest_routes ), 'setup -> exactly one REST route registered' );
if ( count( WPStub::$rest_routes ) ) {
	list( $ns, $route, $args ) = WPStub::$rest_routes[0];
	t_assert( 'sml-avatar/v1' === $ns && '/me' === $route, 'setup -> route is sml-avatar/v1/me' );
	t_assert( 'sml_av_route' === ( $args['callback'] ?? null ) && 'is_user_logged_in' === ( $args['permission_callback'] ?? null ), 'setup -> callback + permission_callback wired' );
}

/* ------------------------------------------------------------------ */
/* Case 1: GET logged out -> WP_Error 401                              */
/* ------------------------------------------------------------------ */

reset_fixture( 0 );
$result = run_route( 'GET' );
t_assert_error( $result, 'sml_av_auth', 401, 'case1 GET logged out' );

/* ------------------------------------------------------------------ */
/* Case 2: GET logged in, no meta -> {custom:false, avatar:gravatar}   */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
$result = run_route( 'GET' );
t_assert( $result instanceof WP_REST_Response, 'case2 GET no meta -> WP_REST_Response' );
if ( $result instanceof WP_REST_Response ) {
	$data = $result->get_data();
	t_assert( is_array( $data ) && true === ( $data['ok'] ?? null ), 'case2 -> ok:true' );
	t_assert( false === ( $data['custom'] ?? null ), 'case2 -> custom:false' );
	t_assert( 'https://secure.gravatar.com/avatar/u10?s=192' === ( $data['avatar'] ?? null ), 'case2 -> avatar is the gravatar URL (size 192)' );
	t_assert( 'private, no-store' === ( $result->headers['Cache-Control'] ?? null ), 'case2 -> Cache-Control private, no-store' );
}

/* ------------------------------------------------------------------ */
/* Case 3: POST multipart happy path (real PNG through the stubs)      */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
WPStub::$downsize[1001] = array( 'https://example.test/wp-content/uploads/avatar-300x300.png', 300, 300, true );
seed_upload_file( base64_decode( SML_TEST_PNG_B64 ) );
$result = run_route( 'POST' );
t_assert( $result instanceof WP_REST_Response, 'case3 POST multipart -> WP_REST_Response' );
if ( $result instanceof WP_REST_Response ) {
	$data = $result->get_data();
	t_assert( true === ( $data['custom'] ?? null ), 'case3 -> custom:true' );
	t_assert( 'https://example.test/wp-content/uploads/avatar-300x300.png' === ( $data['avatar'] ?? null ), 'case3 -> avatar is the medium downsize URL' );
	t_assert( 'private, no-store' === ( $result->headers['Cache-Control'] ?? null ), 'case3 -> Cache-Control private, no-store' );
}
t_assert( 1 === count( WPStub::$sideload_calls ), 'case3 -> wp_handle_sideload called once' );
t_assert( 1 === count( WPStub::$insert_attachment_calls ), 'case3 -> wp_insert_attachment called once' );
t_assert( 'https://example.test/wp-content/uploads/avatar-300x300.png' === ( WPStub::$user_meta[10]['sml_avatar_url'] ?? null ), 'case3 -> sml_avatar_url meta written from image_downsize medium' );
t_assert( 1001 === ( WPStub::$user_meta[10]['sml_avatar_attachment_id'] ?? null ), 'case3 -> sml_avatar_attachment_id meta written' );
t_assert( isset( WPStub::$posts[1001] ) && 10 === (int) WPStub::$posts[1001]->post_author && 'image/png' === WPStub::$posts[1001]->post_mime_type, 'case3 -> attachment owned by uploader, image/png' );
t_assert( 1 === count( WPStub::$update_attach_meta_calls ) && 1001 === WPStub::$update_attach_meta_calls[0]['id'], 'case3 -> attachment metadata generated + stored' );
t_assert( 10 === ( WPStub::$post_meta[1001]['_sml_avatar_for'] ?? null ), 'case3 -> attachment tagged _sml_avatar_for = uploader uid' );
t_assert( true === ( WPStub::$update_attach_meta_calls[0]['tag_present'] ?? null ), 'case3 -> _sml_avatar_for tag written BEFORE metadata generation' );
t_assert( 1 === ( WPStub::$transients['sml_av_rate_10'] ?? null ), 'case3 -> throttle counter sml_av_rate_10 incremented to 1' );
t_assert( array( 'key' => 'sml_av_rate_10', 'value' => 1, 'expiration' => 600 ) === ( WPStub::$set_transient_calls[0] ?? null ), 'case3 -> throttle transient written with TTL 600' );

/* ------------------------------------------------------------------ */
/* Case 4: POST file too big (9MB) -> 413, no meta written             */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
seed_upload_file( base64_decode( SML_TEST_PNG_B64 ), array( 'size' => 9 * 1024 * 1024 ) );
$result = run_route( 'POST' );
t_assert_error( $result, 'sml_av_size', 413, 'case4 POST 9MB file' );
t_assert( array() === WPStub::$update_user_meta_calls, 'case4 -> no user meta written' );
t_assert( array() === WPStub::$sideload_calls, 'case4 -> wp_handle_sideload never called' );

/* ------------------------------------------------------------------ */
/* Case 5: POST wrong type (check returns text/plain) -> 415           */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
seed_upload_file( "this is not an image\n" );
WPStub::$filetype_override = array( 'ext' => 'txt', 'type' => 'text/plain', 'proper_filename' => false );
$result = run_route( 'POST' );
t_assert_error( $result, 'sml_av_type', 415, 'case5 POST text/plain masquerading as png' );
t_assert( array() === WPStub::$update_user_meta_calls, 'case5 -> no user meta written' );
t_assert( array() === WPStub::$sideload_calls, 'case5 -> wp_handle_sideload never called' );

/* ------------------------------------------------------------------ */
/* Case 6: POST attachment_id owned by caller -> meta from downsize    */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
WPStub::$posts[501]    = (object) array( 'ID' => 501, 'post_type' => 'attachment', 'post_mime_type' => 'image/png', 'post_author' => 10 );
WPStub::$downsize[501] = array( 'https://example.test/wp-content/uploads/mine-300x300.png', 300, 300, true );
$result = run_route( 'POST', array( 'attachment_id' => 501 ) );
t_assert( $result instanceof WP_REST_Response, 'case6 POST own attachment -> WP_REST_Response' );
if ( $result instanceof WP_REST_Response ) {
	$data = $result->get_data();
	t_assert( true === ( $data['custom'] ?? null ), 'case6 -> custom:true' );
	t_assert( 'https://example.test/wp-content/uploads/mine-300x300.png' === ( $data['avatar'] ?? null ), 'case6 -> avatar is the medium downsize URL' );
}
t_assert( 'https://example.test/wp-content/uploads/mine-300x300.png' === ( WPStub::$user_meta[10]['sml_avatar_url'] ?? null ), 'case6 -> sml_avatar_url meta set from image_downsize medium' );
t_assert( 501 === ( WPStub::$user_meta[10]['sml_avatar_attachment_id'] ?? null ), 'case6 -> sml_avatar_attachment_id meta set to 501' );

/* ------------------------------------------------------------------ */
/* Case 7: POST attachment_id owned by ANOTHER user, non-admin ->      */
/*         sml_av_missing 404, indistinguishable from a missing id     */
/*         (no existence oracle)                                       */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
WPStub::$posts[502] = (object) array( 'ID' => 502, 'post_type' => 'attachment', 'post_mime_type' => 'image/jpeg', 'post_author' => 22 );
$result = run_route( 'POST', array( 'attachment_id' => 502 ) );
t_assert_error( $result, 'sml_av_missing', 404, 'case7 POST someone else\'s attachment answers like missing' );
$missing = run_route( 'POST', array( 'attachment_id' => 999999 ) );
t_assert(
	$result instanceof WP_Error && $missing instanceof WP_Error
		&& $result->get_error_code() === $missing->get_error_code()
		&& $result->get_error_message() === $missing->get_error_message(),
	'case7 -> not-owned response identical to truly-missing response'
);
t_assert( array() === WPStub::$update_user_meta_calls, 'case7 -> no user meta written' );

/* ------------------------------------------------------------------ */
/* Case 8: POST attachment_id that is not an image attachment -> 404   */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
WPStub::$posts[503] = (object) array( 'ID' => 503, 'post_type' => 'attachment', 'post_mime_type' => 'application/pdf', 'post_author' => 10 );
WPStub::$posts[504] = (object) array( 'ID' => 504, 'post_type' => 'post', 'post_mime_type' => '', 'post_author' => 10 );
$result = run_route( 'POST', array( 'attachment_id' => 503 ) );
t_assert_error( $result, 'sml_av_missing', 404, 'case8a POST non-image attachment (pdf)' );
$result = run_route( 'POST', array( 'attachment_id' => 504 ) );
t_assert_error( $result, 'sml_av_missing', 404, 'case8b POST non-attachment post type' );
$result = run_route( 'POST', array( 'attachment_id' => 999 ) );
t_assert_error( $result, 'sml_av_missing', 404, 'case8c POST missing attachment id' );
t_assert( array() === WPStub::$update_user_meta_calls, 'case8 -> no user meta written' );

/* ------------------------------------------------------------------ */
/* Case 9: POST {url} — admin sets verbatim (and clears any stale      */
/*         attachment id meta); non-admin url-only -> 400              */
/* ------------------------------------------------------------------ */

reset_fixture( 99 );
WPStub::$posts[700] = (object) array( 'ID' => 700, 'post_type' => 'attachment', 'post_mime_type' => 'image/png', 'post_author' => 99 ); // untagged — must survive
WPStub::$user_meta[99]['sml_avatar_attachment_id'] = 700; // stale id from a previous avatar
$result = run_route( 'POST', array( 'url' => 'https://example.test/restored/known-good.png' ) );
t_assert( $result instanceof WP_REST_Response, 'case9a admin POST url -> WP_REST_Response' );
if ( $result instanceof WP_REST_Response ) {
	$data = $result->get_data();
	t_assert( true === ( $data['custom'] ?? null ), 'case9a -> custom:true' );
	t_assert( 'https://example.test/restored/known-good.png' === ( $data['avatar'] ?? null ), 'case9a -> avatar is the verbatim URL' );
}
t_assert( 'https://example.test/restored/known-good.png' === ( WPStub::$user_meta[99]['sml_avatar_url'] ?? null ), 'case9a -> meta set verbatim' );
t_assert( ! isset( WPStub::$user_meta[99]['sml_avatar_attachment_id'] ), 'case9a -> stale sml_avatar_attachment_id meta cleared' );
$deleted_keys = array_map( static function ( $c ) { return $c['user_id'] . ':' . $c['meta_key']; }, WPStub::$delete_user_meta_calls );
t_assert( in_array( '99:sml_avatar_attachment_id', $deleted_keys, true ), 'case9a -> delete_user_meta actually called for the stale id' );
t_assert( array() === WPStub::$delete_attachment_calls && isset( WPStub::$posts[700] ), 'case9a -> untagged stale attachment NOT reaped' );

reset_fixture( 11 );
$result = run_route( 'POST', array( 'url' => 'https://example.test/sneaky.png' ) );
t_assert_error( $result, 'sml_av_input', 400, 'case9b non-admin POST url only' );
t_assert( array() === WPStub::$update_user_meta_calls, 'case9b -> no user meta written' );

/* ------------------------------------------------------------------ */
/* Case 10: DELETE -> both metas deleted, custom:false                 */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
WPStub::$user_meta[10] = array(
	'sml_avatar_url'           => 'https://example.test/wp-content/uploads/avatar-300x300.png',
	'sml_avatar_attachment_id' => 1001,
);
$result = run_route( 'DELETE' );
t_assert( $result instanceof WP_REST_Response, 'case10 DELETE -> WP_REST_Response' );
if ( $result instanceof WP_REST_Response ) {
	$data = $result->get_data();
	t_assert( false === ( $data['custom'] ?? null ), 'case10 -> custom:false' );
	t_assert( 'https://secure.gravatar.com/avatar/u10?s=192' === ( $data['avatar'] ?? null ), 'case10 -> avatar back to gravatar' );
}
$deleted_keys = array_map( static function ( $c ) { return $c['meta_key']; }, WPStub::$delete_user_meta_calls );
t_assert( in_array( 'sml_avatar_url', $deleted_keys, true ) && in_array( 'sml_avatar_attachment_id', $deleted_keys, true ), 'case10 -> both metas deleted' );
t_assert( ! isset( WPStub::$user_meta[10]['sml_avatar_url'] ) && ! isset( WPStub::$user_meta[10]['sml_avatar_attachment_id'] ), 'case10 -> meta store actually cleared' );

/* ------------------------------------------------------------------ */
/* Case 11: pre_get_avatar_data filter — every ref shape               */
/* ------------------------------------------------------------------ */

reset_fixture( 0 );
WPStub::$user_meta[10]['sml_avatar_url'] = 'https://example.test/custom-photo.png';
$filter    = WPStub::$filters['pre_get_avatar_data'][0];
$base_args = array( 'url' => 'https://secure.gravatar.com/avatar/original', 'found_avatar' => false, 'size' => 96 );

$out = call_user_func( $filter, $base_args, 10 );
t_assert( 'https://example.test/custom-photo.png' === ( $out['url'] ?? null ), 'case11a user id with meta -> url overridden' );
t_assert( true === ( $out['found_avatar'] ?? null ), 'case11a -> found_avatar:true' );

$out = call_user_func( $filter, $base_args, 11 );
t_assert( $out === $base_args, 'case11b user id without meta -> args unchanged' );

$comment = new WP_Comment( array( 'comment_ID' => 77, 'user_id' => 10, 'comment_author_email' => '' ) );
$out     = call_user_func( $filter, $base_args, $comment );
t_assert( 'https://example.test/custom-photo.png' === ( $out['url'] ?? null ) && true === ( $out['found_avatar'] ?? null ), 'case11c WP_Comment with user_id resolves to override' );

$out = call_user_func( $filter, $base_args, 'ten@example.test' );
t_assert( 'https://example.test/custom-photo.png' === ( $out['url'] ?? null ) && true === ( $out['found_avatar'] ?? null ), 'case11d email string resolves via get_user_by' );

$out = call_user_func( $filter, $base_args, 'definitely-not-an-email' );
t_assert( $out === $base_args, 'case11e unknown ref -> args unchanged' );

/* guest comment (user_id 0) claiming a member's email: NO email fallback —
   an impostor must not be able to wear that member's photo */
$guest = new WP_Comment( array( 'comment_ID' => 78, 'user_id' => 0, 'comment_author_email' => 'ten@example.test' ) );
$out   = call_user_func( $filter, $base_args, $guest );
t_assert( $out === $base_args, 'case11f guest WP_Comment with a member\'s email -> args unchanged (no email fallback)' );

/* ------------------------------------------------------------------ */
/* Case 12: upload throttle — 5 changes pass, the 6th is 429           */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
seed_upload_file( base64_decode( SML_TEST_PNG_B64 ) );
$ok_count = 0;
for ( $i = 1; $i <= 5; $i++ ) {
	$result = run_route( 'POST' );
	if ( $result instanceof WP_REST_Response ) { $ok_count++; }
}
t_assert( 5 === $ok_count, 'case12 -> first five uploads in the window succeed' );
t_assert( 5 === count( WPStub::$sideload_calls ), 'case12 -> five sideloads performed' );
$result = run_route( 'POST' );
t_assert_error( $result, 'sml_av_rate', 429, 'case12 sixth upload within the window' );
t_assert( 5 === count( WPStub::$sideload_calls ), 'case12 -> sixth attempt never reaches sideload' );
t_assert( 5 === ( WPStub::$transients['sml_av_rate_10'] ?? null ), 'case12 -> throttle counter stays at 5 (rejected attempt not recounted)' );
$ttl_ok = 5 === count( WPStub::$set_transient_calls );
foreach ( WPStub::$set_transient_calls as $call ) {
	if ( 'sml_av_rate_10' !== $call['key'] || 600 !== $call['expiration'] ) { $ttl_ok = false; }
}
t_assert( $ttl_ok, 'case12 -> every throttle write uses key sml_av_rate_10 with TTL 600' );

/* ------------------------------------------------------------------ */
/* Case 13: content sniff — ext-check says png, stored bytes say NOT   */
/*          an image -> 415, moved file unlinked, nothing inserted     */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
seed_upload_file( "these bytes decode as no image format\n" );
WPStub::$filetype_override   = array( 'ext' => 'png', 'type' => 'image/png', 'proper_filename' => false );
WPStub::$image_mime_override = false; // wp_get_image_mime cannot identify the stored bytes
$result = run_route( 'POST' );
t_assert_error( $result, 'sml_av_type', 415, 'case13 POST ext-check png but sniff false' );
t_assert( 1 === count( WPStub::$sideload_calls ), 'case13 -> sideload ran (sniff happens on stored bytes)' );
t_assert( ! file_exists( ABSPATH . 'wp-content/uploads/avatar.png' ), 'case13 -> moved file unlinked' );
t_assert( array() === WPStub::$insert_attachment_calls, 'case13 -> no attachment inserted' );
t_assert( array() === WPStub::$update_user_meta_calls, 'case13 -> no user meta written' );

/* ------------------------------------------------------------------ */
/* Case 14: GIF upload keeps the ORIGINAL url — downsize not consulted */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
seed_upload_file( "GIF89a-tiny-animated-fixture", array( 'name' => 'avatar.gif', 'type' => 'image/gif' ) );
WPStub::$downsize[1001] = array( 'https://example.test/wp-content/uploads/avatar-300x300.gif', 300, 300, true ); // decoy: must NOT be used
$result = run_route( 'POST' );
t_assert( $result instanceof WP_REST_Response, 'case14 POST gif -> WP_REST_Response' );
if ( $result instanceof WP_REST_Response ) {
	$data = $result->get_data();
	t_assert( 'https://example.test/wp-content/uploads/avatar.gif' === ( $data['avatar'] ?? null ), 'case14 -> avatar is the ORIGINAL gif URL (moved url)' );
}
t_assert( array() === WPStub::$downsize_calls, 'case14 -> image_downsize never consulted for gif' );
t_assert( 'https://example.test/wp-content/uploads/avatar.gif' === ( WPStub::$user_meta[10]['sml_avatar_url'] ?? null ), 'case14 -> meta stores original gif url' );

/* ------------------------------------------------------------------ */
/* Case 15: second upload reaps the first (tagged) attachment          */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
seed_upload_file( base64_decode( SML_TEST_PNG_B64 ) );
$first = run_route( 'POST' );
t_assert( $first instanceof WP_REST_Response, 'case15 first upload -> WP_REST_Response' );
t_assert( 10 === ( WPStub::$post_meta[1001]['_sml_avatar_for'] ?? null ), 'case15 -> first attachment tagged for uid 10' );
seed_upload_file( base64_decode( SML_TEST_PNG_B64 ) );
$second = run_route( 'POST' );
t_assert( $second instanceof WP_REST_Response, 'case15 second upload -> WP_REST_Response' );
t_assert( 1002 === ( WPStub::$user_meta[10]['sml_avatar_attachment_id'] ?? null ), 'case15 -> meta points at the new attachment' );
t_assert(
	1 === count( WPStub::$delete_attachment_calls )
		&& 1001 === WPStub::$delete_attachment_calls[0]['id']
		&& true === WPStub::$delete_attachment_calls[0]['force'],
	'case15 -> superseded tagged attachment 1001 force-deleted (and only it)'
);
t_assert( ! isset( WPStub::$posts[1001] ) && isset( WPStub::$posts[1002] ), 'case15 -> old attachment gone, new one kept' );

/* ------------------------------------------------------------------ */
/* Case 16: replacing an avatar whose stored attachment is NOT tagged  */
/*          (referenced library image, e.g. SML News artwork) must     */
/*          NOT delete it                                              */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
WPStub::$posts[600]    = (object) array( 'ID' => 600, 'post_type' => 'attachment', 'post_mime_type' => 'image/png', 'post_author' => 10 ); // library image — no _sml_avatar_for tag
WPStub::$user_meta[10] = array(
	'sml_avatar_url'           => 'https://example.test/wp-content/uploads/sml-news-artwork.png',
	'sml_avatar_attachment_id' => 600,
);
seed_upload_file( base64_decode( SML_TEST_PNG_B64 ) );
$result = run_route( 'POST' );
t_assert( $result instanceof WP_REST_Response, 'case16 replacement upload -> WP_REST_Response' );
t_assert( array() === WPStub::$delete_attachment_calls, 'case16 -> untagged library attachment NOT deleted' );
t_assert( isset( WPStub::$posts[600] ), 'case16 -> library attachment still exists' );
t_assert( 1001 === ( WPStub::$user_meta[10]['sml_avatar_attachment_id'] ?? null ), 'case16 -> meta moved to the new attachment' );

/* ------------------------------------------------------------------ */
/* Case 17: DELETE reaps a tagged stored id, never an untagged one     */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
WPStub::$posts[800]                        = (object) array( 'ID' => 800, 'post_type' => 'attachment', 'post_mime_type' => 'image/png', 'post_author' => 10 );
WPStub::$post_meta[800]['_sml_avatar_for'] = 10; // created by this flow for this user
WPStub::$user_meta[10]                     = array(
	'sml_avatar_url'           => 'https://example.test/wp-content/uploads/avatar-800.png',
	'sml_avatar_attachment_id' => 800,
);
$result = run_route( 'DELETE' );
t_assert( $result instanceof WP_REST_Response, 'case17a DELETE tagged stored id -> WP_REST_Response' );
t_assert(
	1 === count( WPStub::$delete_attachment_calls )
		&& 800 === WPStub::$delete_attachment_calls[0]['id']
		&& true === WPStub::$delete_attachment_calls[0]['force'],
	'case17a -> tagged attachment 800 force-deleted'
);
t_assert( ! isset( WPStub::$posts[800] ), 'case17a -> attachment actually gone' );

reset_fixture( 10 );
WPStub::$posts[600]    = (object) array( 'ID' => 600, 'post_type' => 'attachment', 'post_mime_type' => 'image/png', 'post_author' => 10 ); // untagged library image
WPStub::$user_meta[10] = array(
	'sml_avatar_url'           => 'https://example.test/wp-content/uploads/sml-news-artwork.png',
	'sml_avatar_attachment_id' => 600,
);
$result = run_route( 'DELETE' );
t_assert( $result instanceof WP_REST_Response, 'case17b DELETE untagged stored id -> WP_REST_Response' );
t_assert( array() === WPStub::$delete_attachment_calls, 'case17b -> untagged attachment NOT deleted' );
t_assert( isset( WPStub::$posts[600] ), 'case17b -> library attachment still exists' );
t_assert( ! isset( WPStub::$user_meta[10]['sml_avatar_url'] ) && ! isset( WPStub::$user_meta[10]['sml_avatar_attachment_id'] ), 'case17b -> metas still cleared' );

/* ------------------------------------------------------------------ */
/* Bonus: wp_footer FAILS CLOSED without the resolver, and injects the */
/* pinned loader only on /customize-profile once the resolver exists.  */
/* NOTE: negative (no-resolver) cases MUST run before the resolver     */
/* stub is defined — a PHP function cannot be undefined.               */
/* ------------------------------------------------------------------ */

reset_fixture( 10 );
$_SERVER['REQUEST_URI'] = '/customize-profile/';
ob_start();
call_user_func( WPStub::$actions['wp_footer'][0] );
$footer = ob_get_clean();
t_assert( '' === $footer, 'footer logged in on page, NO resolver -> fails closed (no output at all)' );

reset_fixture( 10 );
$_SERVER['REQUEST_URI'] = '/some-other-page/';
ob_start();
call_user_func( WPStub::$actions['wp_footer'][0] );
$footer = ob_get_clean();
t_assert( '' === $footer, 'footer on other page -> no output' );

reset_fixture( 0 );
$_SERVER['REQUEST_URI'] = '/customize-profile/';
ob_start();
call_user_func( WPStub::$actions['wp_footer'][0] );
$footer = ob_get_clean();
t_assert( '' === $footer, 'footer logged out -> no output' );

/* define the resolver only NOW — conditional declaration so PHP does not
   hoist it at compile time and break the fail-closed cases above */
if ( ! function_exists( 'sml_cdn_resolve_ref' ) ) {
	function sml_cdn_resolve_ref() { return 'abc1234'; }
}

reset_fixture( 10 );
$_SERVER['REQUEST_URI'] = '/customize-profile/';
ob_start();
call_user_func( WPStub::$actions['wp_footer'][0] );
$footer = ob_get_clean();
t_assert( false !== strpos( $footer, 'id="sml-avatar-cfg"' ) && false !== strpos( $footer, 'testnonce-wp_rest' ), 'footer with resolver -> config script with wp_rest nonce' );
t_assert( false !== strpos( $footer, '@abc1234/js/profile-photo.js' ), 'footer with resolver -> loader pinned to the resolved ref @abc1234' );

reset_fixture( 10 );
$_SERVER['REQUEST_URI'] = '/some-other-page/';
ob_start();
call_user_func( WPStub::$actions['wp_footer'][0] );
$footer = ob_get_clean();
t_assert( '' === $footer, 'footer with resolver on other page -> still no output' );

/* ------------------------------------------------------------------ */
/* Summary.                                                            */
/* ------------------------------------------------------------------ */

echo "\n";
printf( "Total: %d assertions, %d passed, %d failed\n", $GLOBALS['t_pass'] + $GLOBALS['t_fail'], $GLOBALS['t_pass'], $GLOBALS['t_fail'] );
if ( $GLOBALS['t_fail'] > 0 ) {
	echo "RESULT: FAIL\n";
	exit( 1 );
}
echo "RESULT: ALL PASS\n";
exit( 0 );
