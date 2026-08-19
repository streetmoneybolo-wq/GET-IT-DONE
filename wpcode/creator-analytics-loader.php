/**
 * SML Creator Analytics — serves the NEW analytics dashboard at
 * /creator-studio/analytics/ (design: creator-dashboard.html), replacing the
 * previous inline "Creator Analytics" screen on that URL. Per-user: the page
 * only shows sections for what the signed-in user owns (Channel / Letters /
 * groups). All numbers come from the site's own endpoints — nothing is faked.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * Logged-out visitors are sent to login and brought back. The URL is noindex.
 * ROLLBACK: deactivate this snippet — the previous screen returns.
 */
if ( ! function_exists( 'sml_ca_loader_active' ) ) {
	function sml_ca_loader_active() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return false; }
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false !== strpos( $uri, '/wp-json/' ) || false !== strpos( $uri, '/wp-admin/' ) ) { return false; }
		$path = strtolower( rawurldecode( (string) wp_parse_url( $uri, PHP_URL_PATH ) ) );
		$path = preg_replace( '#/+#', '/', $path );
		return (bool) preg_match( '#^/creator-studio/analytics/?$#', $path );
	}
	// Keep the analytics UI on the verified item-tracking build. The shared
	// moving resolver can remain cached on an older commit for several minutes.
	function sml_ca_loader_ref() { return 'a7f48ce'; }

	function sml_ca_loader_markup() {
		$base  = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( sml_ca_loader_ref() ) . '/';
		$nonce = wp_create_nonce( 'wp_rest' );
		return '<link rel="stylesheet" id="sml-ca-css" href="' . esc_url( $base . 'css/creator-analytics.css' ) . '">'
			. '<script id="sml-ca-config">window.SML_CA_NONCE=' . wp_json_encode( $nonce ) . ';</script>'
			. '<div id="sml-ca-root" aria-label="Creator Analytics"></div>'
			. '<script id="sml-ca-js" data-nonce="' . esc_attr( $nonce ) . '" src="' . esc_url( $base . 'js/creator-analytics.js' ) . '"></script>';
	}
	function sml_ca_loader_ob( $html ) {
		if ( ! is_string( $html ) || false === strripos( $html, '</body>' ) || false !== strpos( $html, 'id="sml-ca-root"' ) ) { return $html; }
		foreach ( headers_list() as $h ) { if ( 0 === stripos( $h, 'content-type:' ) && false === stripos( $h, 'text/html' ) ) { return $html; } }
		// retire the previous inline dashboard on this URL (its 10-second poller and styles)
		$html = preg_replace( '#<script[^>]*id="sml-creator-studio-pro-js"[^>]*>.*?</script>#is', '', $html );
		$html = preg_replace( '#<style[^>]*id="sml-creator-studio-pro-css"[^>]*>.*?</style>#is', '', $html );
		$html = preg_replace( '#<link[^>]*id="sml-creator-studio-pro-css"[^>]*>#i', '', $html );
		$pos = strripos( $html, '</body>' );
		return substr( $html, 0, $pos ) . sml_ca_loader_markup() . substr( $html, $pos );
	}

	add_action( 'init', static function () {
		if ( ! sml_ca_loader_active() ) { return; }
		if ( ! is_user_logged_in() ) {
			wp_safe_redirect( wp_login_url( home_url( '/creator-studio/analytics/' ) ) );
			exit;
		}
		nocache_headers();
		ob_start( 'sml_ca_loader_ob' );
	}, 0 );
	add_filter( 'pre_get_document_title', static function ( $title ) {
		return sml_ca_loader_active() ? 'Creator Analytics | Stock Market Loop' : $title;
	}, 99 );
	add_filter( 'wp_robots', static function ( $robots ) {
		if ( sml_ca_loader_active() ) { $robots['noindex'] = true; $robots['nofollow'] = true; }
		return $robots;
	}, 99 );
}
