/**
 * SML Loop Channel — public /channel/{handle}/ loader.
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * Escape hatch: ?ch=0. Admin-only preview gate: ?ch=1.
 * ROLLBACK: deactivate this snippet.
 */
if ( ! function_exists( 'sml_ch_loader_active' ) ) {
	function sml_ch_loader_active() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return false; }
		if ( isset( $_GET['ch'] ) && '0' === $_GET['ch'] ) { return false; }
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false !== strpos( $uri, '/wp-json' ) || false !== strpos( $uri, '/wp-admin' ) ) { return false; }
		if ( ! preg_match( '#/channel/[A-Za-z0-9_.]+/?(?:\?|$)#', $uri ) ) { return false; }
		if ( isset( $_GET['ch'] ) && '1' === $_GET['ch'] ) { return current_user_can( 'manage_options' ); }
		return true;
	}

	function sml_ch_loader_ref() { return function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main'; }

	function sml_ch_loader_markup() {
		$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . sml_ch_loader_ref() . '/';
		$is_admin = current_user_can( 'manage_options' ) ? 1 : 0;
		$me = is_user_logged_in() ? wp_get_current_user() : null;
		$me_handle = '';
		if ( $me ) {
			if ( function_exists( 'sml_members_public_handle' ) ) { $me_handle = sml_members_public_handle( $me->ID ); }
			else { $me_handle = get_user_meta( $me->ID, 'sml_public_handle', true ) ?: $me->user_nicename; }
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
