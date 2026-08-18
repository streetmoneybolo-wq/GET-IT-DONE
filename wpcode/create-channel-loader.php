/**
 * SML Create Channel — serves the /create-channel/ page (design: "Create Loop
 * Channel"). The Creator Gate CTA ("Register + create Channel") and the account
 * menu send creators here; on success the page sends them to /go-live/.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * Logged-out visitors are sent to login and brought back. The URL is noindex.
 * ROLLBACK: deactivate this snippet (the URL returns to 404).
 */
if ( ! function_exists( 'sml_cc_loader_active' ) ) {
	function sml_cc_loader_active() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return false; }
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		return (bool) preg_match( '#^/create-channel/?$#', $path );
	}
	function sml_cc_loader_ref() { return function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main'; }

	function sml_cc_loader_markup() {
		$base  = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( sml_cc_loader_ref() ) . '/';
		$nonce = wp_create_nonce( 'wp_rest' );
		// config as BOTH an inline script and data-attributes: inline may be CSP-blocked on some pages
		return '<link rel="stylesheet" id="sml-cc-css" href="' . esc_url( $base . 'css/create-channel.css' ) . '">'
			. '<script id="sml-cc-config">window.SML_CC_NONCE=' . wp_json_encode( $nonce ) . ';window.SML_CC_ME=true;</script>'
			. '<div id="sml-cc-root" aria-label="Create your Loop Channel"></div>'
			. '<script id="sml-cc-js" data-nonce="' . esc_attr( $nonce ) . '" data-me="1" src="' . esc_url( $base . 'js/create-channel.js' ) . '"></script>';
	}
	function sml_cc_loader_ob( $html ) {
		if ( ! is_string( $html ) || false === strripos( $html, '</body>' ) || false !== strpos( $html, 'id="sml-cc-root"' ) ) { return $html; }
		$pos = strripos( $html, '</body>' );
		return substr( $html, 0, $pos ) . sml_cc_loader_markup() . substr( $html, $pos );
	}

	add_action( 'init', static function () { if ( sml_cc_loader_active() ) { ob_start( 'sml_cc_loader_ob' ); } }, 0 );
	add_action( 'template_redirect', static function () {
		if ( ! sml_cc_loader_active() ) { return; }
		if ( ! is_user_logged_in() ) {
			wp_safe_redirect( wp_login_url( home_url( '/create-channel/' ) ) );
			exit;
		}
		global $wp_query;
		if ( $wp_query ) { $wp_query->is_404 = false; }
		status_header( 200 );
		nocache_headers();
	}, 0 );
	add_filter( 'pre_get_document_title', static function ( $title ) {
		return sml_cc_loader_active() ? 'Create your Loop Channel | Stock Market Loop' : $title;
	}, 99 );
	add_filter( 'wp_robots', static function ( $robots ) {
		if ( sml_cc_loader_active() ) { $robots['noindex'] = true; $robots['nofollow'] = true; }
		return $robots;
	}, 99 );
}
