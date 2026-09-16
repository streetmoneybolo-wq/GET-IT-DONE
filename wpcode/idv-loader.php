/**
 * SML Identity Verify — serves the /verify-identity/ page.
 *
 * Logged-in only, noindex. Renders the verify widget (js/identity-verify.js from
 * the CDN @main) which drives the Stripe Identity flow via sml-idv/v1. Backend
 * routes live in the companion snippet (sml-idv.php). ROLLBACK: deactivate.
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. Guarded, no top-level return.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! function_exists( 'sml_idv_loader_active' ) ) {

	function sml_idv_loader_active() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return false; }
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		return (bool) preg_match( '#^/verify-identity/?$#', $path );
	}

	function sml_idv_loader_markup() {
		$base  = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@main/';
		$nonce = wp_create_nonce( 'wp_rest' );
		return '<div id="sml-idv-root" aria-label="Verify your identity"></div>'
			. '<script id="sml-idv-config">window.SML_IDV_NONCE=' . wp_json_encode( $nonce ) . ';</script>'
			. '<script id="sml-idv-js" data-nonce="' . esc_attr( $nonce ) . '" src="' . esc_url( $base . 'js/identity-verify.js' ) . '"></script>';
	}

	function sml_idv_loader_ob( $html ) {
		if ( ! is_string( $html ) || false === strripos( $html, '</body>' ) || false !== strpos( $html, 'id="sml-idv-root"' ) ) { return $html; }
		$pos = strripos( $html, '</body>' );
		return substr( $html, 0, $pos ) . sml_idv_loader_markup() . substr( $html, $pos );
	}

	add_action( 'init', static function () { if ( sml_idv_loader_active() ) { ob_start( 'sml_idv_loader_ob' ); } }, 0 );

	add_action( 'template_redirect', static function () {
		if ( ! sml_idv_loader_active() ) { return; }
		if ( ! is_user_logged_in() ) { wp_safe_redirect( wp_login_url( home_url( '/verify-identity/' ) ) ); exit; }
		global $wp_query;
		if ( $wp_query ) { $wp_query->is_404 = false; }
		status_header( 200 );
		nocache_headers();
	}, 0 );

	add_filter( 'pre_get_document_title', static function ( $title ) {
		return sml_idv_loader_active() ? 'Verify your identity | Stock Market Loop' : $title;
	}, 99 );

	add_filter( 'wp_robots', static function ( $robots ) {
		if ( sml_idv_loader_active() ) { $robots['noindex'] = true; $robots['nofollow'] = true; }
		return $robots;
	}, 99 );
}
