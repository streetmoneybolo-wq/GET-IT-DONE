<?php
/**
 * Plugin Name: SML App Links
 * Description: Serves the files that connect stockmarketloop.com to the StockMarketLoop phone app and the PWA shell: the Apple app-site-association (universal links), Android assetlinks.json (app links), a web manifest, and the head tags a phone looks for (apple-touch-icon, theme-color, the App Store smart banner). Everything is driven by Settings → SML App Links, where the app builder's bundle id, team id, package name and signing fingerprints go.
 * Version: 1.0.0
 * Author: StockMarketLoop
 * Requires PHP: 7.4
 *
 * Files served (all cacheable, correct content types, no WordPress 404 page):
 *   /.well-known/apple-app-site-association   and   /apple-app-site-association
 *   /.well-known/assetlinks.json
 *   /manifest.webmanifest   /manifest.json   /site.webmanifest
 *
 * Constants override the saved settings: SML_APP_IOS_TEAM_ID, SML_APP_IOS_BUNDLE_ID, SML_APP_IOS_STORE_ID,
 * SML_APP_ANDROID_PACKAGE, SML_APP_ANDROID_SHA256 (comma separated).
 * Filters: sml_app_links_config, sml_app_links_paths_exclude, sml_app_links_aasa, sml_app_links_assetlinks, sml_app_links_manifest.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_APP_LINKS_VERSION', '1.0.0' );
define( 'SML_APP_LINKS_OPTION', 'sml_app_links' );

/* ---------- configuration ---------- */

function sml_app_links_defaults() {
	return array(
		'app_name'          => 'StockMarketLoop',
		'short_name'        => 'SML',
		'description'       => 'Live stocks, scanner, groups and alerts.',
		'theme_color'       => '#0b1118',
		'background_color'  => '#0b1118',
		'start_url'         => '/',
		'display'           => 'standalone',
		'ios_team_id'       => '',
		'ios_bundle_id'     => '',
		'ios_store_id'      => '',
		'android_package'   => '',
		'android_sha256'    => '',
		'icon_192'          => '',
		'icon_512'          => '',
		'exclude_paths'     => "/wp-admin/*\n/wp-login.php\n/wp-json/*\n/wp-content/*\n/wp-includes/*\n/feed/*\n/xmlrpc.php\n/cart/*\n/checkout/*\n/my-account/*\n/store/*",
	);
}

/** Saved settings merged with defaults, then constants, then the filter. Pure apart from get_option/defined. */
function sml_app_links_config() {
	$cfg = wp_parse_args( (array) get_option( SML_APP_LINKS_OPTION, array() ), sml_app_links_defaults() );
	foreach ( array( 'ios_team_id' => 'SML_APP_IOS_TEAM_ID', 'ios_bundle_id' => 'SML_APP_IOS_BUNDLE_ID', 'ios_store_id' => 'SML_APP_IOS_STORE_ID', 'android_package' => 'SML_APP_ANDROID_PACKAGE', 'android_sha256' => 'SML_APP_ANDROID_SHA256' ) as $key => $const ) {
		if ( defined( $const ) && '' !== trim( (string) constant( $const ) ) ) { $cfg[ $key ] = trim( (string) constant( $const ) ); }
	}
	return apply_filters( 'sml_app_links_config', $cfg );
}

/** "A1B2C3D4E5" style Apple team ids and "com.example.app" bundle ids / Android packages. */
function sml_app_links_clean_team_id( $v ) { return preg_match( '/^[A-Z0-9]{10}$/', strtoupper( trim( (string) $v ) ) ) ? strtoupper( trim( (string) $v ) ) : ''; }
function sml_app_links_clean_bundle( $v ) { $v = trim( (string) $v ); return preg_match( '/^[A-Za-z0-9_]+(\.[A-Za-z0-9_-]+)+$/', $v ) ? $v : ''; }
function sml_app_links_clean_store_id( $v ) { $v = preg_replace( '/\D/', '', (string) $v ); return '' === $v ? '' : $v; }
/** Android signing fingerprints: colon-separated SHA-256, uppercase, one or many (debug + release + Play App Signing). */
function sml_app_links_clean_fingerprints( $v ) {
	$out = array();
	foreach ( preg_split( '/[\s,;]+/', strtoupper( (string) $v ) ) as $fp ) {
		$fp = trim( $fp );
		if ( '' === $fp ) { continue; }
		if ( preg_match( '/^[0-9A-F]{64}$/', $fp ) ) { $fp = implode( ':', str_split( $fp, 2 ) ); }
		if ( preg_match( '/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/', $fp ) ) { $out[] = $fp; }
	}
	return array_values( array_unique( $out ) );
}
function sml_app_links_clean_color( $v ) { $v = trim( (string) $v ); return preg_match( '/^#[0-9A-Fa-f]{6}$/', $v ) ? strtolower( $v ) : ''; }
function sml_app_links_exclude_paths( array $cfg ) {
	$paths = array();
	foreach ( preg_split( '/[\r\n,]+/', (string) ( $cfg['exclude_paths'] ?? '' ) ) as $p ) {
		$p = trim( $p );
		if ( '' !== $p && '/' === $p[0] && ! preg_match( '/[^\w\/\*\.\-~%\?]/', $p ) ) { $paths[] = $p; }
	}
	return apply_filters( 'sml_app_links_paths_exclude', array_values( array_unique( $paths ) ) );
}

/* ---------- the three documents (pure: config in, array out) ---------- */

/** Apple: universal links for the whole site except the excluded paths, plus web credentials (password autofill). Empty details until a team id and bundle id exist. */
function sml_app_links_aasa( array $cfg ) {
	$team = sml_app_links_clean_team_id( $cfg['ios_team_id'] ?? '' );
	$bundle = sml_app_links_clean_bundle( $cfg['ios_bundle_id'] ?? '' );
	$doc = array( 'applinks' => array( 'details' => array() ) );
	if ( '' !== $team && '' !== $bundle ) {
		$app_id   = $team . '.' . $bundle;
		$excludes = sml_app_links_exclude_paths( $cfg );
		$components = array();
		foreach ( $excludes as $path ) { $components[] = array( '/' => $path, 'exclude' => true, 'comment' => 'stays in the browser' ); }
		$components[] = array( '/' => '*', 'comment' => 'everything else opens in the app' );
		$legacy = array();
		foreach ( $excludes as $path ) { $legacy[] = 'NOT ' . $path; }
		$legacy[] = '*';
		$doc['applinks']['details'][] = array( 'appIDs' => array( $app_id ), 'components' => $components, 'paths' => $legacy );
		$doc['webcredentials'] = array( 'apps' => array( $app_id ) );
	}
	return apply_filters( 'sml_app_links_aasa', $doc, $cfg );
}

/** Android: app links for the package with every known signing fingerprint, plus credential sharing (password autofill). Empty list until both exist. */
function sml_app_links_assetlinks( array $cfg ) {
	$package = sml_app_links_clean_bundle( $cfg['android_package'] ?? '' );
	$prints  = sml_app_links_clean_fingerprints( $cfg['android_sha256'] ?? '' );
	$doc = array();
	if ( '' !== $package && $prints ) {
		$target = array( 'namespace' => 'android_app', 'package_name' => $package, 'sha256_cert_fingerprints' => $prints );
		$doc[] = array( 'relation' => array( 'delegate_permission/common.handle_all_urls' ), 'target' => $target );
		$doc[] = array( 'relation' => array( 'delegate_permission/common.get_login_creds' ), 'target' => $target );
	}
	return apply_filters( 'sml_app_links_assetlinks', $doc, $cfg );
}

/** Web manifest: name, colours, icons, start URL, plus the store listings so browsers can offer the native app. $site = ['icon_192'=>url, 'icon_512'=>url, 'home'=>url]. */
function sml_app_links_manifest( array $cfg, array $site ) {
	$theme = sml_app_links_clean_color( $cfg['theme_color'] ?? '' ) ?: '#0b1118';
	$bg    = sml_app_links_clean_color( $cfg['background_color'] ?? '' ) ?: $theme;
	$start = (string) ( $cfg['start_url'] ?? '/' );
	if ( '' === $start || '/' !== $start[0] ) { $start = '/'; }
	$icons = array();
	foreach ( array( '192' => (string) ( $cfg['icon_192'] ?: ( $site['icon_192'] ?? '' ) ), '512' => (string) ( $cfg['icon_512'] ?: ( $site['icon_512'] ?? '' ) ) ) as $size => $url ) {
		if ( '' !== $url && preg_match( '#^https://#i', $url ) ) { $icons[] = array( 'src' => $url, 'sizes' => $size . 'x' . $size, 'type' => 'image/png', 'purpose' => 'any maskable' ); }
	}
	$doc = array(
		'id'               => '/',
		'name'             => (string) ( $cfg['app_name'] ?: 'StockMarketLoop' ),
		'short_name'       => (string) ( $cfg['short_name'] ?: 'SML' ),
		'description'      => (string) ( $cfg['description'] ?? '' ),
		'start_url'        => $start . ( false === strpos( $start, '?' ) ? '?source=pwa' : '&source=pwa' ),
		'scope'            => '/',
		'display'          => in_array( $cfg['display'] ?? '', array( 'standalone', 'minimal-ui', 'fullscreen', 'browser' ), true ) ? $cfg['display'] : 'standalone',
		'orientation'      => 'portrait',
		'theme_color'      => $theme,
		'background_color' => $bg,
		'icons'            => $icons,
		'categories'       => array( 'finance', 'news', 'social' ),
		'prefer_related_applications' => false,
		'related_applications'        => array(),
	);
	$store = sml_app_links_clean_store_id( $cfg['ios_store_id'] ?? '' );
	if ( '' !== $store ) { $doc['related_applications'][] = array( 'platform' => 'itunes', 'url' => 'https://apps.apple.com/app/id' . $store, 'id' => $store ); }
	$package = sml_app_links_clean_bundle( $cfg['android_package'] ?? '' );
	if ( '' !== $package ) { $doc['related_applications'][] = array( 'platform' => 'play', 'url' => 'https://play.google.com/store/apps/details?id=' . $package, 'id' => $package ); }
	return apply_filters( 'sml_app_links_manifest', $doc, $cfg, $site );
}

/** Which document a request path asks for, or '' for none. */
function sml_app_links_route( $path ) {
	$path = strtolower( rtrim( (string) parse_url( (string) $path, PHP_URL_PATH ), '/' ) );
	switch ( $path ) {
		case '/.well-known/apple-app-site-association':
		case '/apple-app-site-association':
			return 'aasa';
		case '/.well-known/assetlinks.json':
			return 'assetlinks';
		case '/manifest.webmanifest':
		case '/manifest.json':
		case '/site.webmanifest':
			return 'manifest';
	}
	return '';
}

/* ---------- WordPress wiring (skipped when the file is loaded outside WordPress, e.g. by the tests) ---------- */
if ( ! function_exists( 'add_action' ) ) { return; }

function sml_app_links_site_icons() {
	$out = array( 'icon_192' => '', 'icon_512' => '', 'home' => home_url( '/' ) );
	if ( function_exists( 'get_site_icon_url' ) && has_site_icon() ) {
		$out['icon_192'] = (string) get_site_icon_url( 192 );
		$out['icon_512'] = (string) get_site_icon_url( 512 );
	}
	return $out;
}

/** Serve the documents before WordPress routes the request (so no theme, no 404 page, no heavy HTML). */
add_action( 'init', static function () {
	$kind = sml_app_links_route( $_SERVER['REQUEST_URI'] ?? '' );
	if ( '' === $kind ) { return; }
	$cfg = sml_app_links_config();
	if ( 'aasa' === $kind ) { $doc = sml_app_links_aasa( $cfg ); $type = 'application/json'; }
	elseif ( 'assetlinks' === $kind ) { $doc = sml_app_links_assetlinks( $cfg ); $type = 'application/json'; }
	else { $doc = sml_app_links_manifest( $cfg, sml_app_links_site_icons() ); $type = 'application/manifest+json'; }
	$body = wp_json_encode( $doc, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT );
	nocache_headers();
	header_remove( 'Expires' );
	header_remove( 'Pragma' );
	status_header( 200 );
	header( 'Content-Type: ' . $type . '; charset=utf-8' );
	header( 'Cache-Control: public, max-age=3600, s-maxage=3600' );
	header( 'Access-Control-Allow-Origin: *' );
	header( 'X-Content-Type-Options: nosniff' );
	header( 'X-SML-App-Links: ' . SML_APP_LINKS_VERSION );
	echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON document, content type set above.
	exit;
}, 0 );

/** Head tags: manifest link, theme colour, apple-touch-icon, the App Store smart banner, Google Play hint. */
add_action( 'wp_head', static function () {
	if ( is_admin() ) { return; }
	$cfg   = sml_app_links_config();
	$icons = sml_app_links_site_icons();
	$theme = sml_app_links_clean_color( $cfg['theme_color'] ?? '' ) ?: '#0b1118';
	echo "\n" . '<link rel="manifest" href="' . esc_url( home_url( '/manifest.webmanifest' ) ) . '">' . "\n";
	echo '<meta name="theme-color" content="' . esc_attr( $theme ) . '">' . "\n";
	echo '<meta name="mobile-web-app-capable" content="yes">' . "\n";
	echo '<meta name="apple-mobile-web-app-capable" content="yes">' . "\n";
	echo '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' . "\n";
	echo '<meta name="apple-mobile-web-app-title" content="' . esc_attr( $cfg['short_name'] ?: 'SML' ) . '">' . "\n";
	$touch = (string) ( $cfg['icon_192'] ?: $icons['icon_192'] );
	if ( '' !== $touch ) { echo '<link rel="apple-touch-icon" sizes="180x180" href="' . esc_url( $touch ) . '">' . "\n"; }
	$store = sml_app_links_clean_store_id( $cfg['ios_store_id'] ?? '' );
	if ( '' !== $store ) {
		$url = '';
		if ( isset( $_SERVER['REQUEST_URI'] ) ) { $url = home_url( wp_unslash( (string) $_SERVER['REQUEST_URI'] ) ); }
		echo '<meta name="apple-itunes-app" content="app-id=' . esc_attr( $store ) . ( $url ? ', app-argument=' . esc_attr( $url ) : '' ) . '">' . "\n";
	}
	$package = sml_app_links_clean_bundle( $cfg['android_package'] ?? '' );
	if ( '' !== $package ) { echo '<meta name="google-play-app" content="app-id=' . esc_attr( $package ) . '">' . "\n"; }
}, 1 );

/* ---------- settings page ---------- */

function sml_app_links_sanitize( $input ) {
	$input = is_array( $input ) ? $input : array();
	$d = sml_app_links_defaults();
	$out = array();
	$out['app_name']         = sanitize_text_field( $input['app_name'] ?? $d['app_name'] ) ?: $d['app_name'];
	$out['short_name']       = substr( sanitize_text_field( $input['short_name'] ?? $d['short_name'] ) ?: $d['short_name'], 0, 12 );
	$out['description']      = sanitize_text_field( $input['description'] ?? $d['description'] );
	$out['theme_color']      = sml_app_links_clean_color( $input['theme_color'] ?? '' ) ?: $d['theme_color'];
	$out['background_color'] = sml_app_links_clean_color( $input['background_color'] ?? '' ) ?: $out['theme_color'];
	$out['start_url']        = ( isset( $input['start_url'] ) && '' !== $input['start_url'] && '/' === $input['start_url'][0] ) ? sanitize_text_field( $input['start_url'] ) : '/';
	$out['display']          = in_array( $input['display'] ?? '', array( 'standalone', 'minimal-ui', 'fullscreen', 'browser' ), true ) ? $input['display'] : 'standalone';
	$out['ios_team_id']      = sml_app_links_clean_team_id( $input['ios_team_id'] ?? '' );
	$out['ios_bundle_id']    = sml_app_links_clean_bundle( $input['ios_bundle_id'] ?? '' );
	$out['ios_store_id']     = sml_app_links_clean_store_id( $input['ios_store_id'] ?? '' );
	$out['android_package']  = sml_app_links_clean_bundle( $input['android_package'] ?? '' );
	$out['android_sha256']   = implode( "\n", sml_app_links_clean_fingerprints( $input['android_sha256'] ?? '' ) );
	$out['icon_192']         = esc_url_raw( (string) ( $input['icon_192'] ?? '' ) );
	$out['icon_512']         = esc_url_raw( (string) ( $input['icon_512'] ?? '' ) );
	$out['exclude_paths']    = implode( "\n", sml_app_links_exclude_paths( array( 'exclude_paths' => (string) ( $input['exclude_paths'] ?? $d['exclude_paths'] ) ) ) );
	foreach ( array( 'ios_team_id', 'ios_bundle_id', 'android_package', 'android_sha256' ) as $k ) {
		if ( ! empty( $input[ $k ] ) && '' === $out[ $k ] ) { add_settings_error( SML_APP_LINKS_OPTION, 'sml_app_links_' . $k, sprintf( '"%s" was not a valid value and was cleared.', esc_html( $k ) ) ); }
	}
	return $out;
}

add_action( 'admin_init', static function () {
	register_setting( 'sml_app_links', SML_APP_LINKS_OPTION, array( 'type' => 'array', 'sanitize_callback' => 'sml_app_links_sanitize' ) );
} );

add_action( 'admin_menu', static function () {
	add_options_page( 'SML App Links', 'SML App Links', 'manage_options', 'sml-app-links', 'sml_app_links_page' );
} );

function sml_app_links_page() {
	if ( ! current_user_can( 'manage_options' ) ) { return; }
	$cfg = wp_parse_args( (array) get_option( SML_APP_LINKS_OPTION, array() ), sml_app_links_defaults() );
	$live = sml_app_links_config();
	$field = static function ( $key, $label, $type = 'text', $help = '' ) use ( $cfg ) {
		$id = 'sml-app-links-' . str_replace( '_', '-', $key );
		echo '<tr><th scope="row"><label for="' . esc_attr( $id ) . '">' . esc_html( $label ) . '</label></th><td>';
		if ( 'textarea' === $type ) { echo '<textarea class="large-text code" rows="4" id="' . esc_attr( $id ) . '" name="' . esc_attr( SML_APP_LINKS_OPTION . '[' . $key . ']' ) . '">' . esc_textarea( (string) $cfg[ $key ] ) . '</textarea>'; }
		else { echo '<input class="regular-text code" type="text" id="' . esc_attr( $id ) . '" name="' . esc_attr( SML_APP_LINKS_OPTION . '[' . $key . ']' ) . '" value="' . esc_attr( (string) $cfg[ $key ] ) . '">'; }
		if ( $help ) { echo '<p class="description">' . wp_kses_post( $help ) . '</p>'; }
		echo '</td></tr>';
	};
	$ios_ok = '' !== sml_app_links_clean_team_id( $live['ios_team_id'] ) && '' !== sml_app_links_clean_bundle( $live['ios_bundle_id'] );
	$and_ok = '' !== sml_app_links_clean_bundle( $live['android_package'] ) && sml_app_links_clean_fingerprints( $live['android_sha256'] );
	?>
	<div class="wrap">
		<h1>SML App Links</h1>
		<p>These values come from the app builder. Until they are filled in, the files below are served empty (valid JSON, no app claims), so nothing breaks.</p>
		<table class="widefat striped" style="max-width:900px"><tbody>
			<tr><td><code><?php echo esc_html( home_url( '/.well-known/apple-app-site-association' ) ); ?></code></td><td><?php echo $ios_ok ? '<strong style="color:#1a7f37">iOS universal links on</strong>' : 'waiting for the Apple team id and bundle id'; ?></td></tr>
			<tr><td><code><?php echo esc_html( home_url( '/.well-known/assetlinks.json' ) ); ?></code></td><td><?php echo $and_ok ? '<strong style="color:#1a7f37">Android app links on</strong>' : 'waiting for the package name and SHA-256 fingerprints'; ?></td></tr>
			<tr><td><code><?php echo esc_html( home_url( '/manifest.webmanifest' ) ); ?></code></td><td>web manifest, always on<?php echo has_site_icon() ? '' : ' (<strong>no site icon set</strong>: add one under Appearance → Customize → Site Identity, or give icon URLs below)'; ?></td></tr>
		</tbody></table>
		<form method="post" action="options.php">
			<?php settings_fields( 'sml_app_links' ); ?>
			<h2>iPhone</h2>
			<table class="form-table" role="presentation">
				<?php $field( 'ios_team_id', 'Apple Team ID', 'text', '10 characters, from the Apple Developer account (Membership details).' ); ?>
				<?php $field( 'ios_bundle_id', 'Bundle ID', 'text', 'For example <code>com.stockmarketloop.app</code>. Must match the app\'s Associated Domains entitlement <code>applinks:stockmarketloop.com</code>.' ); ?>
				<?php $field( 'ios_store_id', 'App Store ID', 'text', 'Digits only, from App Store Connect. Turns on the Smart App Banner in Safari.' ); ?>
			</table>
			<h2>Android</h2>
			<table class="form-table" role="presentation">
				<?php $field( 'android_package', 'Package name', 'text', 'For example <code>com.stockmarketloop.app</code>.' ); ?>
				<?php $field( 'android_sha256', 'Signing certificate SHA-256 fingerprints', 'textarea', 'One per line: the upload key, the Play App Signing key, and any debug key the builder tests with. From Play Console → App integrity, or <code>keytool -list -v</code>.' ); ?>
			</table>
			<h2>Web manifest</h2>
			<table class="form-table" role="presentation">
				<?php $field( 'app_name', 'App name' ); ?>
				<?php $field( 'short_name', 'Short name', 'text', 'Under the home-screen icon, 12 characters at most.' ); ?>
				<?php $field( 'description', 'Description' ); ?>
				<?php $field( 'theme_color', 'Theme colour', 'text', 'Hex, for example <code>#0b1118</code>. Also the browser toolbar colour on phones.' ); ?>
				<?php $field( 'background_color', 'Background colour' ); ?>
				<?php $field( 'start_url', 'Start URL', 'text', 'Where the installed PWA opens.' ); ?>
				<?php $field( 'icon_192', 'Icon 192×192 (PNG URL)', 'text', 'Leave empty to use the site icon.' ); ?>
				<?php $field( 'icon_512', 'Icon 512×512 (PNG URL)' ); ?>
			</table>
			<h2>Paths that stay in the browser</h2>
			<table class="form-table" role="presentation">
				<?php $field( 'exclude_paths', 'Excluded paths', 'textarea', 'One per line, <code>*</code> allowed. Every other stockmarketloop.com link opens in the app once it is installed. Checkout and the store stay on the web until the payments decision.' ); ?>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}
