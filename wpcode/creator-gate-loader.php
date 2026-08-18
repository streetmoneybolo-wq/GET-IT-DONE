/**
 * SML Creator Gate — site-wide account-menu loader and gated-page enforcer.
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet; it owns no stored creator data.
 */
if ( ! function_exists( 'sml_cg_loader_is_gated_path' ) ) {
	function sml_cg_loader_is_gated_path() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		return (bool) preg_match( '#^/(?:creator-studio(?:/|$)|go-live/?$|upload-video/?$)#', $path );
	}

	function sml_cg_loader_active() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) {
			return false;
		}
		return is_user_logged_in() || sml_cg_loader_is_gated_path();
	}

	function sml_cg_loader_ref() {
		return function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main';
	}

	function sml_cg_loader_markup() {
		$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( sml_cg_loader_ref() ) . '/js/';
		$nonce = wp_create_nonce( 'wp_rest' );
		$config = '<script id="sml-cg-config">window.SML_CG_NONCE=' . wp_json_encode( $nonce )
			. ';window.SML_CG_ME=' . ( is_user_logged_in() ? 'true' : 'false' ) . ';</script>';
		$scripts = '<script id="sml-cg-js" data-nonce="' . esc_attr( $nonce ) . '" data-me="'
			. ( is_user_logged_in() ? '1' : '0' ) . '" src="' . esc_url( $base . 'creator-gate.js' ) . '"></script>';
		if ( sml_cg_loader_is_gated_path() ) {
			$scripts .= '<script id="sml-cg-enforce-js" src="' . esc_url( $base . 'creator-gate-enforce.js' ) . '"></script>';
		}
		return $config . $scripts;
	}

	function sml_cg_loader_ob( $html ) {
		if ( ! is_string( $html ) || false === strripos( $html, '</body>' ) || false !== strpos( $html, 'id="sml-cg-js"' ) ) {
			return $html;
		}
		$pos = strripos( $html, '</body>' );
		return substr( $html, 0, $pos ) . sml_cg_loader_markup() . substr( $html, $pos );
	}

	add_action( 'init', static function () {
		if ( sml_cg_loader_active() ) {
			ob_start( 'sml_cg_loader_ob' );
		}
	}, 0 );
}
