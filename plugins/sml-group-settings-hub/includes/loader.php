<?php
/**
 * Front-end loader (group pages only) and the site-admin settings page.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sml_hub_group_slug_from_request() {
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	if ( preg_match( '#^/groups/([a-z0-9\-]{2,80})/?$#i', $path, $m ) && 'create' !== strtolower( $m[1] ) ) {
		return strtolower( $m[1] );
	}
	return '';
}

/* The group renderer runs a normal wp_footer (the billing bridge and Discord Connect print there too). */
add_action( 'wp_footer', static function () {
	if ( ! is_user_logged_in() || is_admin() ) {
		return;
	}
	$slug = sml_hub_group_slug_from_request();
	if ( '' === $slug ) {
		return;
	}
	$group = sml_hub_group_by_slug( $slug );
	$cfg   = array(
		'api'     => esc_url_raw( rest_url( 'sml-hub/v1/' ) ),
		'nonce'   => wp_create_nonce( 'wp_rest' ),
		'ajax'    => esc_url_raw( admin_url( 'admin-ajax.php' ) ),
		'slug'    => $slug,
		'groupId' => $group ? (int) $group['id'] : 0,
		'version' => SML_HUB_VERSION,
	);
	$ver = SML_HUB_VERSION . '.' . (string) @filemtime( SML_HUB_DIR . 'assets/hub.js' );
	echo '<link id="sml-hub-css" rel="stylesheet" href="' . esc_url( SML_HUB_URL . 'assets/hub.css?v=' . rawurlencode( $ver ) ) . '">' . "\n";
	echo '<script id="sml-hub-cfg">window.SML_HUB=' . wp_json_encode( $cfg ) . ';</script>' . "\n";
	echo '<script id="sml-hub-js" defer src="' . esc_url( SML_HUB_URL . 'assets/hub.js?v=' . rawurlencode( $ver ) ) . '"></script>' . "\n";
}, 110 );

/* ---------- Settings → SML Group Hub ---------- */

add_action( 'admin_menu', static function () {
	add_options_page( 'SML Group Hub', 'SML Group Hub', 'manage_options', 'sml-hub-settings', 'sml_hub_settings_page' );
} );

add_action( 'admin_init', static function () {
	register_setting( 'sml_hub', 'sml_hub_socials_slugs', array( 'type' => 'array', 'sanitize_callback' => static function ( $v ) {
		if ( is_string( $v ) ) {
			$v = explode( ',', $v );
		}
		$out = array();
		foreach ( (array) $v as $s ) {
			$s = sanitize_title( trim( (string) $s ) );
			if ( '' !== $s ) {
				$out[] = $s;
			}
		}
		return array_values( array_unique( $out ) );
	} ) );
	register_setting( 'sml_hub', 'sml_hub_socials_all', array( 'type' => 'boolean', 'sanitize_callback' => static function ( $v ) { return $v ? 1 : 0; } ) );
	foreach ( array( 'sml_hub_google_client_id', 'sml_hub_google_client_secret', 'sml_hub_reddit_client_id', 'sml_hub_reddit_client_secret' ) as $opt ) {
		register_setting( 'sml_hub', $opt, array( 'type' => 'string', 'sanitize_callback' => static function ( $v ) { return trim( sanitize_text_field( (string) $v ) ); } ) );
	}
} );

function sml_hub_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$slugs = get_option( 'sml_hub_socials_slugs', array( 'making-easy-money' ) );
	$slugs = is_array( $slugs ) ? implode( ', ', $slugs ) : (string) $slugs;
	$status = sml_hub_platform_status();
	$loop   = sml_hub_loop_follow_source();
	echo '<div class="wrap"><h1>SML Group Hub</h1>';
	echo '<form method="post" action="options.php">';
	settings_fields( 'sml_hub' );
	echo '<h2>Follow-to-unlock</h2><table class="form-table" role="presentation">';
	echo '<tr><th scope="row">Enabled for group slugs</th><td><input type="text" class="regular-text" name="sml_hub_socials_slugs" value="' . esc_attr( $slugs ) . '"><p class="description">Comma-separated. Default: making-easy-money. The feature stays hidden in every other group.</p></td></tr>';
	echo '<tr><th scope="row">Enable for every group</th><td><label><input type="checkbox" name="sml_hub_socials_all" value="1" ' . checked( 1, (int) get_option( 'sml_hub_socials_all' ), false ) . '> Every group owner can use it</label></td></tr>';
	echo '<tr><th scope="row">Loop Channel follow check</th><td>' . ( $loop ? '<code>' . esc_html( $loop['table'] ) . '</code> (' . esc_html( $loop['follower'] ) . ' → ' . esc_html( $loop['target'] ) . ')' : '<em>No follow table detected. A developer can point the plugin at it with the <code>sml_hub_loop_follow_source</code> filter.</em>' ) . '</td></tr>';
	echo '</table>';
	echo '<h2>YouTube (Google OAuth) — ' . esc_html( $status['youtube'] ) . '</h2><p>Create a Google Cloud OAuth client (Web application) with the YouTube Data API v3 enabled, scope <code>youtube.readonly</code>, and add this redirect URI: <code>' . esc_html( sml_hub_oauth_redirect( 'youtube' ) ) . '</code></p><table class="form-table" role="presentation">';
	echo '<tr><th scope="row">Client ID</th><td><input type="text" class="regular-text" name="sml_hub_google_client_id" value="' . esc_attr( (string) get_option( 'sml_hub_google_client_id' ) ) . '"></td></tr>';
	echo '<tr><th scope="row">Client secret</th><td><input type="password" class="regular-text" name="sml_hub_google_client_secret" value="' . esc_attr( (string) get_option( 'sml_hub_google_client_secret' ) ) . '" autocomplete="new-password"></td></tr></table>';
	echo '<h2>Reddit OAuth — ' . esc_html( $status['reddit'] ) . '</h2><p>Create a Reddit app (type “web app”) at reddit.com/prefs/apps with this redirect URI: <code>' . esc_html( sml_hub_oauth_redirect( 'reddit' ) ) . '</code></p><table class="form-table" role="presentation">';
	echo '<tr><th scope="row">Client ID</th><td><input type="text" class="regular-text" name="sml_hub_reddit_client_id" value="' . esc_attr( (string) get_option( 'sml_hub_reddit_client_id' ) ) . '"></td></tr>';
	echo '<tr><th scope="row">Client secret</th><td><input type="password" class="regular-text" name="sml_hub_reddit_client_secret" value="' . esc_attr( (string) get_option( 'sml_hub_reddit_client_secret' ) ) . '" autocomplete="new-password"></td></tr></table>';
	echo '<p>Bluesky needs no keys. X/Twitter is not offered: follow lookups require a paid X API tier. Facebook pages, Threads and LinkedIn cannot be verified by any API.</p>';
	submit_button();
	echo '</form></div>';
}
