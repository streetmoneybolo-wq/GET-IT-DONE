/**
 * SML Meet Traders — serves the /meet/ page (opt-in trader networking directory).
 *
 * Logged-in only; the page is noindex (personal networking surface, no public
 * value). Loads js/meet-traders.js from the CDN with a fresh wp_rest nonce.
 * Backend routes live in the companion snippet (sml-meet/v1). ROLLBACK: deactivate.
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. Guarded, no top-level return.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! function_exists( 'sml_meet_loader_active' ) ) {

	function sml_meet_loader_active() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return false; }
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		return (bool) preg_match( '#^/meet/?$#', $path );
	}

	function sml_meet_loader_markup() {
		// @main so a freshly-pushed js file is served immediately (purged on deploy);
		// the shared resolver's pinned ref can lag behind new files.
		$base  = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@main/';
		$nonce = wp_create_nonce( 'wp_rest' );
		return '<div id="sml-meet-root" aria-label="Meet Traders"></div>'
			. '<script id="sml-meet-config">window.SML_MEET_NONCE=' . wp_json_encode( $nonce ) . ';</script>'
			. '<script id="sml-meet-js" data-nonce="' . esc_attr( $nonce ) . '" src="' . esc_url( $base . 'js/meet-traders.js' ) . '"></script>';
	}

	function sml_meet_loader_ob( $html ) {
		if ( ! is_string( $html ) || false === strripos( $html, '</body>' ) || false !== strpos( $html, 'id="sml-meet-root"' ) ) { return $html; }
		$pos = strripos( $html, '</body>' );
		return substr( $html, 0, $pos ) . sml_meet_loader_markup() . substr( $html, $pos );
	}

	add_action( 'init', static function () { if ( sml_meet_loader_active() ) { ob_start( 'sml_meet_loader_ob' ); } }, 0 );

	add_action( 'template_redirect', static function () {
		if ( ! sml_meet_loader_active() ) { return; }
		if ( ! is_user_logged_in() ) { wp_safe_redirect( wp_login_url( home_url( '/meet/' ) ) ); exit; }
		global $wp_query;
		if ( $wp_query ) { $wp_query->is_404 = false; }
		status_header( 200 );
		nocache_headers();
	}, 0 );

	add_filter( 'pre_get_document_title', static function ( $title ) {
		return sml_meet_loader_active() ? 'Meet Traders | Stock Market Loop' : $title;
	}, 99 );

	add_filter( 'wp_robots', static function ( $robots ) {
		if ( sml_meet_loader_active() ) { $robots['noindex'] = true; $robots['nofollow'] = true; }
		return $robots;
	}, 99 );
}
