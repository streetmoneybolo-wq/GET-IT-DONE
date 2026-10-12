<?php
/**
 * Plugin Name: SML Edge Cache
 * Description: Lets WordPress.com's edge cache serve stockmarketloop.com's logged-out pages. Today every anonymous page leaves the site with "Cache-Control: no-cache, must-revalidate, max-age=0, no-store, private" (WordPress's nocache_headers(), called by a plugin on every request), so the edge never caches and every visitor waits on PHP. This plugin, at the last moment before the template renders, replaces those headers with public, short-lived caching for safe requests only: logged-out, GET, no WordPress / commerce / session cookies, no Set-Cookie in the response, not admin, login, REST, preview, search or any excluded path. Pages that declare DONOTCACHEPAGE are left alone. It also records which plugin asked for no-cache, so the culprit can be fixed at the source (Settings → SML Edge Cache).
 * Version: 1.0.1
 * Author: StockMarketLoop
 * Requires PHP: 7.4
 *
 * Filters: sml_edge_cache_decision( array $decision, array $request ), sml_edge_cache_excluded_paths( array ).
 * Constants: SML_EDGE_CACHE_OFF (true disables), SML_EDGE_CACHE_TTL (seconds for browsers), SML_EDGE_CACHE_EDGE_TTL (seconds for the edge).
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_EDGE_CACHE_VERSION', '1.0.1' );
define( 'SML_EDGE_CACHE_OPTION', 'sml_edge_cache' );
define( 'SML_EDGE_CACHE_LOG', 'sml_edge_cache_log' );

function sml_ec_defaults() {
	return array(
		'enabled'        => 1,
		'ttl'            => 60,      // browsers: a minute, so a member who signs in sees fresh pages at once
		'edge_ttl'       => 300,     // the edge: five minutes
		'swr'            => 600,     // stale-while-revalidate: serve the old copy while a fresh one is fetched
		'ttl_404'        => 120,
		'excluded_paths' => "/wp-admin\n/wp-login.php\n/wp-json\n/wp-cron.php\n/xmlrpc.php\n/cart\n/checkout\n/my-account\n/store\n/register\n/login\n/connect-discord\n/create-channel\n/creator-studio\n/verify\n/account\n/settings",
	);
}

/** Cookies whose presence means the visitor is not anonymous, or the page may be personalised. Prefix match. */
function sml_ec_bypass_cookie_prefixes() {
	return array( 'wordpress_logged_in_', 'wordpress_sec_', 'wordpressuser_', 'wordpresspass_', 'wp-postpass_', 'wp-settings-', 'comment_author_', 'woocommerce_', 'wp_woocommerce_session_', 'PHPSESSID', 'sml_lbm_ref', 'sml_session', 'sml_sid', 'edd_', 'mepr_', 'pmpro_', 'wpsc_', 'jetpack_sso' );
}

function sml_ec_config() {
	$cfg = wp_parse_args( (array) get_option( SML_EDGE_CACHE_OPTION, array() ), sml_ec_defaults() );
	if ( defined( 'SML_EDGE_CACHE_OFF' ) && SML_EDGE_CACHE_OFF ) { $cfg['enabled'] = 0; }
	if ( defined( 'SML_EDGE_CACHE_TTL' ) ) { $cfg['ttl'] = (int) SML_EDGE_CACHE_TTL; }
	if ( defined( 'SML_EDGE_CACHE_EDGE_TTL' ) ) { $cfg['edge_ttl'] = (int) SML_EDGE_CACHE_EDGE_TTL; }
	return $cfg;
}

function sml_ec_excluded_paths( array $cfg ) {
	$out = array();
	foreach ( preg_split( '/[\r\n,]+/', (string) ( $cfg['excluded_paths'] ?? '' ) ) as $p ) {
		$p = rtrim( trim( $p ), '/' );
		if ( '' !== $p && '/' === $p[0] && ! preg_match( '/[^\w\/\.\-~%]/', $p ) ) { $out[] = $p; }
	}
	return array_values( array_unique( $out ) );
}

/**
 * The decision for one request. Pure: everything it needs comes in $request, so it can be tested without WordPress.
 * $request = [ method, path, query (string), cookies (array name=>value), logged_in (bool), is_404 (bool), is_preview, is_search,
 *              is_feed, is_admin, is_rest, donotcachepage (bool), set_cookie (bool: the response already sets a cookie) ]
 * Returns [ cache => bool, reason => string, headers => [ name => value ] ].
 */
function sml_ec_decide( array $request, array $cfg ) {
	$no = static function ( $reason ) { return array( 'cache' => false, 'reason' => $reason, 'headers' => array() ); };
	if ( empty( $cfg['enabled'] ) ) { return $no( 'disabled' ); }
	$method = strtoupper( (string) ( $request['method'] ?? 'GET' ) );
	if ( 'GET' !== $method && 'HEAD' !== $method ) { return $no( 'method' ); }
	if ( ! empty( $request['logged_in'] ) ) { return $no( 'logged_in' ); }
	if ( ! empty( $request['is_admin'] ) || ! empty( $request['is_rest'] ) ) { return $no( 'admin_or_rest' ); }
	if ( ! empty( $request['is_preview'] ) ) { return $no( 'preview' ); }
	if ( ! empty( $request['is_search'] ) ) { return $no( 'search' ); }
	if ( ! empty( $request['donotcachepage'] ) ) { return $no( 'donotcachepage' ); }
	if ( ! empty( $request['set_cookie'] ) ) { return $no( 'response_sets_cookie' ); }
	$path = '/' . ltrim( (string) parse_url( (string) ( $request['path'] ?? '/' ), PHP_URL_PATH ), '/' );
	foreach ( sml_ec_excluded_paths( $cfg ) as $ex ) {
		if ( $path === $ex || 0 === strpos( $path, $ex . '/' ) || 0 === strpos( $path, $ex . '.' ) ) { return $no( 'excluded_path' ); }
	}
	foreach ( array_keys( (array) ( $request['cookies'] ?? array() ) ) as $name ) {
		foreach ( sml_ec_bypass_cookie_prefixes() as $prefix ) {
			if ( 0 === stripos( (string) $name, $prefix ) ) { return $no( 'cookie:' . $prefix ); }
		}
	}
	$query = trim( (string) ( $request['query'] ?? '' ) );
	if ( '' !== $query ) {
		// only tracking parameters are harmless to cache; anything else may change the page
		parse_str( $query, $params );
		foreach ( array_keys( (array) $params ) as $k ) {
			if ( ! preg_match( '/^(utm_\w+|fbclid|gclid|msclkid|ref|source|mc_cid|mc_eid|igshid|ttclid)$/i', (string) $k ) ) { return $no( 'query' ); }
		}
	}
	$ttl = max( 0, (int) $cfg['ttl'] );
	$edge = max( 30, (int) $cfg['edge_ttl'] );
	$swr = max( 0, (int) $cfg['swr'] );
	if ( ! empty( $request['is_404'] ) ) { $ttl = min( $ttl, (int) $cfg['ttl_404'] ); $edge = min( $edge, max( 30, (int) $cfg['ttl_404'] ) ); }
	$cc = 'public, max-age=' . $ttl . ', s-maxage=' . $edge . ( $swr ? ', stale-while-revalidate=' . $swr : '' ) . ', stale-if-error=3600';
	return array( 'cache' => true, 'reason' => ! empty( $request['is_404'] ) ? 'cacheable_404' : ( ! empty( $request['is_feed'] ) ? 'cacheable_feed' : 'cacheable' ), 'headers' => array( 'Cache-Control' => $cc, 'Vary' => 'Accept-Encoding, Cookie' ) );
}

/** The file (plugin or theme) that asked for no-cache, from a backtrace: the first frame outside WordPress core. */
function sml_ec_caller_from_trace( array $trace ) {
	foreach ( $trace as $frame ) {
		$file = isset( $frame['file'] ) ? str_replace( '\\', '/', (string) $frame['file'] ) : '';
		if ( '' === $file ) { continue; }
		if ( false !== strpos( $file, '/wp-includes/' ) || false !== strpos( $file, '/wp-admin/' ) || false !== strpos( $file, '/sml-edge-cache/' ) ) { continue; }
		if ( preg_match( '#/(wp-content/(?:plugins|mu-plugins|themes)/[^/]+)#', $file, $m ) ) { return $m[1] . ( isset( $frame['line'] ) ? ':' . $frame['line'] : '' ); }
		if ( false !== strpos( $file, 'wpcode' ) || false !== strpos( $file, 'eval()' ) ) { return 'WPCode snippet'; }
		return basename( $file ) . ( isset( $frame['line'] ) ? ':' . $frame['line'] : '' );
	}
	return 'unknown';
}

/* ---------- WordPress wiring (skipped outside WordPress, e.g. in the tests) ---------- */
if ( ! function_exists( 'add_action' ) ) { return; }

$GLOBALS['sml_ec_nocache_callers'] = array();

/** Every call to nocache_headers() passes through this filter: remember who asked, for the diagnostics page. */
add_filter( 'nocache_headers', static function ( $headers ) {
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() ) ) { return $headers; }
	$GLOBALS['sml_ec_nocache_callers'][] = sml_ec_caller_from_trace( debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS, 25 ) );
	return $headers;
}, 1 );

function sml_ec_request_snapshot() {
	$uri = (string) ( $_SERVER['REQUEST_URI'] ?? '/' );
	$set_cookie = false;
	foreach ( headers_list() as $h ) { if ( 0 === stripos( $h, 'Set-Cookie:' ) ) { $set_cookie = true; break; } }
	return array(
		'method'         => (string) ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ),
		'path'           => (string) parse_url( $uri, PHP_URL_PATH ),
		'query'          => (string) ( parse_url( $uri, PHP_URL_QUERY ) ?: '' ),
		'cookies'        => (array) $_COOKIE,
		'logged_in'      => is_user_logged_in(),
		'is_404'         => is_404(),
		'is_preview'     => is_preview() || isset( $_GET['preview'] ) || isset( $_GET['customize_changeset_uuid'] ),
		'is_search'      => is_search(),
		'is_feed'        => is_feed(),
		'is_admin'       => is_admin(),
		'is_rest'        => defined( 'REST_REQUEST' ) && REST_REQUEST,
		'donotcachepage' => defined( 'DONOTCACHEPAGE' ) && DONOTCACHEPAGE,
		'set_cookie'     => $set_cookie,
	);
}

function sml_ec_log( array $entry ) {
	$log = (array) get_option( SML_EDGE_CACHE_LOG, array() );
	$key = md5( $entry['path'] . '|' . $entry['reason'] . '|' . implode( ',', $entry['callers'] ) );
	$entry['seen'] = isset( $log[ $key ]['seen'] ) ? (int) $log[ $key ]['seen'] + 1 : 1;
	$entry['at']   = time();
	$log[ $key ]   = $entry;
	if ( count( $log ) > 40 ) { uasort( $log, static function ( $a, $b ) { return (int) $b['at'] <=> (int) $a['at']; } ); $log = array_slice( $log, 0, 40, true ); }
	update_option( SML_EDGE_CACHE_LOG, $log, false );
}

/** Write the decided headers. Runs twice: before the template, and again at the very end of the request, because some plugins call
 *  nocache_headers() while the template renders (inside an output buffer, so headers are still open) and would otherwise win. */
function sml_ec_apply( $final = false ) {
	if ( headers_sent() || empty( $GLOBALS['sml_ec_decision'] ) ) { return; }
	$decision = $GLOBALS['sml_ec_decision'];
	$request  = $GLOBALS['sml_ec_request'];
	$callers  = array_values( array_unique( (array) $GLOBALS['sml_ec_nocache_callers'] ) );
	if ( $final ) {
		// a cookie set during rendering makes the page personal after all
		foreach ( headers_list() as $h ) { if ( 0 === stripos( $h, 'Set-Cookie:' ) ) { $decision = array( 'cache' => false, 'reason' => 'response_sets_cookie', 'headers' => array() ); break; } }
		// remember, at most once a minute per page, which plugins asked for no-cache on an anonymous page
		if ( $callers && empty( $request['logged_in'] ) && empty( $request['is_admin'] ) && empty( $request['is_rest'] ) && false === get_transient( 'sml_ec_seen_' . md5( $request['path'] ) ) ) {
			set_transient( 'sml_ec_seen_' . md5( $request['path'] ), 1, MINUTE_IN_SECONDS );
			sml_ec_log( array( 'path' => $request['path'], 'reason' => $decision['reason'], 'cached' => (bool) $decision['cache'], 'callers' => $callers ) );
		}
	}
	if ( empty( $decision['cache'] ) ) {
		if ( 'response_sets_cookie' === $decision['reason'] ) { header( 'Cache-Control: private, no-store', true ); }
		header( 'X-SML-Edge-Cache: skip ' . $decision['reason'], true );
		return;
	}
	header_remove( 'Expires' );
	header_remove( 'Pragma' );
	header_remove( 'Cache-Control' );
	header_remove( 'Last-Modified' );
	foreach ( $decision['headers'] as $name => $value ) { header( $name . ': ' . $value, true ); }
	header( 'X-SML-Edge-Cache: ' . $decision['reason'] . ( $callers ? ' (overrode ' . count( $callers ) . ' nocache call' . ( 1 === count( $callers ) ? '' : 's' ) . ')' : '' ) . ( $final ? ' final' : '' ), true );
}
function sml_ec_ob_finalize( $buffer ) { sml_ec_apply( true ); return $buffer; }

add_action( 'template_redirect', static function () {
	if ( headers_sent() ) { return; }
	$cfg = sml_ec_config();
	$request = sml_ec_request_snapshot();
	$GLOBALS['sml_ec_request']  = $request;
	$GLOBALS['sml_ec_decision'] = apply_filters( 'sml_edge_cache_decision', sml_ec_decide( $request, $cfg ), $request );
	sml_ec_apply( false );
	if ( ! empty( $GLOBALS['sml_ec_decision']['cache'] ) ) {
		// the buffer's callback runs when the page is complete and nothing has reached the client yet: the last word on the headers
		ob_start( 'sml_ec_ob_finalize' );
		add_action( 'shutdown', static function () { sml_ec_apply( true ); }, -1000 );
	}
}, PHP_INT_MAX );

/** WordPress core's own nocache for the "wp" headers stage (logged-in only in core, but some plugins filter it): keep the public ones out of the way. */
add_filter( 'wp_headers', static function ( $headers ) {
	if ( is_user_logged_in() || is_admin() ) { return $headers; }
	$cfg = sml_ec_config();
	if ( empty( $cfg['enabled'] ) ) { return $headers; }
	foreach ( array( 'Expires', 'Cache-Control', 'Pragma' ) as $k ) { unset( $headers[ $k ] ); }
	return $headers;
}, PHP_INT_MAX );

/* ---------- settings + diagnostics page ---------- */

function sml_ec_sanitize( $input ) {
	$input = is_array( $input ) ? $input : array();
	$d = sml_ec_defaults();
	$n = static function ( $v, $min, $max, $def ) { $v = is_numeric( $v ) ? (int) $v : $def; return max( $min, min( $max, $v ) ); };
	return array(
		'enabled'        => empty( $input['enabled'] ) ? 0 : 1,
		'ttl'            => $n( $input['ttl'] ?? $d['ttl'], 0, 3600, $d['ttl'] ),
		'edge_ttl'       => $n( $input['edge_ttl'] ?? $d['edge_ttl'], 30, 86400, $d['edge_ttl'] ),
		'swr'            => $n( $input['swr'] ?? $d['swr'], 0, 86400, $d['swr'] ),
		'ttl_404'        => $n( $input['ttl_404'] ?? $d['ttl_404'], 0, 3600, $d['ttl_404'] ),
		'excluded_paths' => implode( "\n", sml_ec_excluded_paths( array( 'excluded_paths' => (string) ( $input['excluded_paths'] ?? $d['excluded_paths'] ) ) ) ),
	);
}
add_action( 'admin_init', static function () {
	register_setting( 'sml_edge_cache', SML_EDGE_CACHE_OPTION, array( 'type' => 'array', 'sanitize_callback' => 'sml_ec_sanitize' ) );
	if ( isset( $_POST['sml_ec_clear_log'] ) && current_user_can( 'manage_options' ) && check_admin_referer( 'sml_ec_clear_log' ) ) { delete_option( SML_EDGE_CACHE_LOG ); wp_safe_redirect( admin_url( 'options-general.php?page=sml-edge-cache&cleared=1' ) ); exit; }
} );
add_action( 'admin_menu', static function () { add_options_page( 'SML Edge Cache', 'SML Edge Cache', 'manage_options', 'sml-edge-cache', 'sml_ec_page' ); } );

function sml_ec_page() {
	if ( ! current_user_can( 'manage_options' ) ) { return; }
	$cfg = sml_ec_config();
	$log = (array) get_option( SML_EDGE_CACHE_LOG, array() );
	uasort( $log, static function ( $a, $b ) { return (int) $b['at'] <=> (int) $a['at']; } );
	$name = static function ( $k ) { return esc_attr( SML_EDGE_CACHE_OPTION . '[' . $k . ']' ); };
	?>
	<div class="wrap">
		<h1>SML Edge Cache</h1>
		<p>Logged-out pages leave with <code>Cache-Control: public, max-age=<?php echo (int) $cfg['ttl']; ?>, s-maxage=<?php echo (int) $cfg['edge_ttl']; ?></code> so WordPress.com's edge can serve them. Members who are signed in, pages that set cookies, admin, REST, search, previews and the excluded paths are never cached. Check a page with <code>curl -sI https://stockmarketloop.com/ | grep -i -E 'cache-control|x-ac|x-sml-edge'</code>: <code>X-ac: ... HIT</code> on the second request means the edge served it.</p>
		<form method="post" action="options.php">
			<?php settings_fields( 'sml_edge_cache' ); ?>
			<table class="form-table" role="presentation">
				<tr><th>Enabled</th><td><label><input type="checkbox" name="<?php echo $name( 'enabled' ); ?>" value="1" <?php checked( ! empty( $cfg['enabled'] ) ); ?>> Replace no-cache headers on safe logged-out pages</label></td></tr>
				<tr><th><label for="sml-ec-ttl">Browser TTL (seconds)</label></th><td><input id="sml-ec-ttl" type="number" min="0" max="3600" name="<?php echo $name( 'ttl' ); ?>" value="<?php echo (int) $cfg['ttl']; ?>"><p class="description">Keep short: a member who signs in should see fresh pages right away.</p></td></tr>
				<tr><th><label for="sml-ec-edge">Edge TTL (seconds)</label></th><td><input id="sml-ec-edge" type="number" min="30" max="86400" name="<?php echo $name( 'edge_ttl' ); ?>" value="<?php echo (int) $cfg['edge_ttl']; ?>"><p class="description"><code>s-maxage</code>: how long the edge may serve a copy. Publishing a post purges WordPress.com's cache anyway.</p></td></tr>
				<tr><th><label for="sml-ec-swr">Stale while revalidate (seconds)</label></th><td><input id="sml-ec-swr" type="number" min="0" max="86400" name="<?php echo $name( 'swr' ); ?>" value="<?php echo (int) $cfg['swr']; ?>"></td></tr>
				<tr><th><label for="sml-ec-404">404 TTL (seconds)</label></th><td><input id="sml-ec-404" type="number" min="0" max="3600" name="<?php echo $name( 'ttl_404' ); ?>" value="<?php echo (int) $cfg['ttl_404']; ?>"></td></tr>
				<tr><th><label for="sml-ec-ex">Never cache these paths</label></th><td><textarea id="sml-ec-ex" class="large-text code" rows="8" name="<?php echo $name( 'excluded_paths' ); ?>"><?php echo esc_textarea( (string) $cfg['excluded_paths'] ); ?></textarea><p class="description">One per line, prefix match. Add any page that looks different for different logged-out visitors.</p></td></tr>
			</table>
			<?php submit_button(); ?>
		</form>
		<h2>Who asked for no-cache on logged-out pages</h2>
		<p>Every <code>nocache_headers()</code> call on an anonymous page is recorded here with the plugin that made it. The override above handles it; fixing the plugin removes the need.</p>
		<?php if ( ! $log ) : ?><p><em>Nothing recorded yet. Visit a page while signed out, then reload this screen.</em></p><?php else : ?>
		<table class="widefat striped"><thead><tr><th>Page</th><th>Asked by</th><th>Result</th><th>Seen</th><th>Last</th></tr></thead><tbody>
		<?php foreach ( $log as $e ) : ?>
			<tr><td><code><?php echo esc_html( $e['path'] ); ?></code></td><td><?php echo esc_html( implode( ', ', (array) $e['callers'] ) ); ?></td><td><?php echo ! empty( $e['cached'] ) ? '<span style="color:#1a7f37">cached (overridden)</span>' : '<span style="color:#9a6700">not cached: ' . esc_html( $e['reason'] ) . '</span>'; ?></td><td><?php echo (int) $e['seen']; ?></td><td><?php echo esc_html( human_time_diff( (int) $e['at'] ) ); ?> ago</td></tr>
		<?php endforeach; ?>
		</tbody></table>
		<form method="post" style="margin-top:10px"><?php wp_nonce_field( 'sml_ec_clear_log' ); ?><button class="button" name="sml_ec_clear_log" value="1">Clear this list</button></form>
		<?php endif; ?>
	</div>
	<?php
}
