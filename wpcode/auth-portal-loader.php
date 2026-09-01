/**
 * SML Auth Portal reskin loader  —  wpcode/auth-portal-loader.php
 *
 * Injects the new-design reskin (css/auth-portal.css + js/auth-portal.js) on the
 * EXISTING /register/ page. That page is rendered by the sml-members plugin and
 * already ships the hardened auth (register / login / verify / handle-availability
 * / oauth + the /__challenge anti-bot handshake). This loader adds ONLY front-end:
 * the JS repaints the marketing landing and relocates the plugin's real .sml-auth-card
 * into it. Auth, nonces, and the plugin stay completely untouched.
 *
 * STAGED: only fires when the URL carries ?authv2=1, so real visitors keep seeing
 * the current page until we've tested signup / login / oauth / verify end-to-end.
 * GO LIVE: change sml_authportal_staged() to return true (or drop the ?authv2 check).
 * ROLLBACK: deactivate this snippet — /register/ instantly reverts to the plugin UI.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * No dynamic-code/encoding calls, no globals (guarded), no top-level return.
 */
if ( ! function_exists( 'sml_authportal_on_register' ) ) {

	/** True only on the /register/ page (front-end, not admin/REST/ajax). */
	function sml_authportal_on_register() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return false; }
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		return (bool) preg_match( '#^/register/?$#', $path );
	}

	/** Staging gate. While true-only-with-?authv2=1, real users are unaffected. */
	function sml_authportal_staged() {
		// FLIP TO `return true;` (unconditional on /register/) when ready to go live.
		return isset( $_GET['authv2'] ) && '1' === (string) $_GET['authv2']; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
	}

	/** Fire the reskin? */
	function sml_authportal_active() {
		return sml_authportal_on_register() && sml_authportal_staged();
	}

	function sml_authportal_ref() {
		return function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main';
	}

	function sml_authportal_markup() {
		$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( sml_authportal_ref() ) . '/';
		return '<link rel="stylesheet" id="sml-authportal-css" href="' . esc_url( $base . 'css/auth-portal.css' ) . '">'
			. '<script id="sml-authportal-js" defer src="' . esc_url( $base . 'js/auth-portal.js' ) . '"></script>';
	}

	function sml_authportal_ob( $html ) {
		if ( ! is_string( $html ) || false === strripos( $html, '</body>' ) || false !== strpos( $html, 'id="sml-authportal-js"' ) ) {
			return $html;
		}
		$pos = strripos( $html, '</body>' );
		return substr( $html, 0, $pos ) . sml_authportal_markup() . substr( $html, $pos );
	}

	add_action( 'init', static function () {
		if ( sml_authportal_active() ) { ob_start( 'sml_authportal_ob' ); }
	}, 0 );
}
