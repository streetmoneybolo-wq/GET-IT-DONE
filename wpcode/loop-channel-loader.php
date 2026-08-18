/**
 * SML Loop Channel — public /channel/{handle}/ loader.
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * Escape hatch: ?ch=0.
 * ROLLBACK: deactivate this snippet.
 *
 * Gate (2026-08-18): a channel page renders publicly ONLY when {handle}
 * resolves to a real, deliberately created channel — i.e. some user has
 * that exact value in sml_channel_handle (set only via /create-channel/).
 * Lookup is on the channel-handle namespace alone; it never falls back to
 * profile handles (sml_public_handle) — the two must never cross-resolve.
 * Handles that resolve to no channel stay a normal 404 for everyone.
 * Admins additionally see any /channel/... URL for preview.
 *
 * History: this used to be `return current_user_can('manage_options')` —
 * the emergency lockdown from when channels went live for every account
 * with no opt-in. Once /create-channel/ became the only way to set
 * sml_channel_handle, that blanket lockdown was hiding real, opted-in
 * channels from every non-admin (404 for the creator's own audience).
 */
if ( ! function_exists( 'sml_ch_loader_active' ) ) {
	function sml_ch_loader_requested_handle() {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false !== strpos( $uri, '/wp-json' ) || false !== strpos( $uri, '/wp-admin' ) ) { return ''; }
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		return preg_match( '#^/channel/([A-Za-z0-9_.]+)/?$#', $path, $m ) ? strtolower( $m[1] ) : '';
	}

	function sml_ch_loader_channel_exists( $handle ) {
		static $cache = array();
		if ( '' === $handle ) { return false; }
		if ( isset( $cache[ $handle ] ) ) { return $cache[ $handle ]; }
		if ( function_exists( 'sml_channel_user_by_handle' ) ) {
			$cache[ $handle ] = (bool) sml_channel_user_by_handle( $handle );
			return $cache[ $handle ];
		}
		/* data API not loaded (snippet order) — same lookup, same namespace, no profile-handle fallback */
		$q = new WP_User_Query( array( 'number' => 1, 'count_total' => false, 'fields' => 'ID', 'meta_key' => 'sml_channel_handle', 'meta_value' => $handle ) );
		$cache[ $handle ] = ! empty( $q->get_results() );
		return $cache[ $handle ];
	}

	function sml_ch_loader_active() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return false; }
		if ( isset( $_GET['ch'] ) && '0' === $_GET['ch'] ) { return false; }
		$handle = sml_ch_loader_requested_handle();
		if ( '' === $handle ) { return false; }
		if ( sml_ch_loader_channel_exists( $handle ) ) { return true; }
		return current_user_can( 'manage_options' );
	}

	function sml_ch_loader_ref() { return function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main'; }

	function sml_ch_loader_markup() {
		$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . sml_ch_loader_ref() . '/';
		$is_admin = current_user_can( 'manage_options' ) ? 1 : 0;
		$me = is_user_logged_in() ? wp_get_current_user() : null;
		$me_handle = '';
		if ( $me ) {
			$me_handle = get_user_meta( $me->ID, 'sml_channel_handle', true );
		}
		$config = array( 'id' => $me ? (int) $me->ID : 0, 'handle' => sanitize_key( $me_handle ) );
		return '<link rel="stylesheet" id="sml-ch-css" href="' . esc_url( $base . 'css/loop-channel.css' ) . '">'
			. '<script>window.SML_CH_ADMIN=' . $is_admin . ';window.SML_CH_NONCE=' . wp_json_encode( wp_create_nonce( 'wp_rest' ) ) . ';window.SML_CH_ME=' . wp_json_encode( $config ) . ';</script>'
			. '<div id="sml-ch-root" aria-label="Loop Channel"></div>'
			. '<script id="sml-ch-js" src="' . esc_url( $base . 'js/loop-channel.js' ) . '"></script>';
	}

	function sml_ch_loader_ob( $html ) {
		if ( ! is_string( $html ) || false === strripos( $html, '</body>' ) || false !== strpos( $html, 'id="sml-ch-root"' ) ) { return $html; }
		$pos = strripos( $html, '</body>' );
		return substr( $html, 0, $pos ) . sml_ch_loader_markup() . substr( $html, $pos );
	}

	add_action( 'init', static function () { if ( sml_ch_loader_active() ) { ob_start( 'sml_ch_loader_ob' ); } }, 0 );
	add_action( 'template_redirect', static function () {
		if ( ! sml_ch_loader_active() ) { return; }
		global $wp_query;
		if ( $wp_query ) { $wp_query->is_404 = false; }
		status_header( 200 );
	}, 0 );
	add_filter( 'pre_get_document_title', static function ( $title ) {
		return sml_ch_loader_active() ? 'Loop Channel | Stock Market Loop' : $title;
	}, 99 );
}
