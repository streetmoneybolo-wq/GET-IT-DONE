/**
 * StockMarketLoop site-wide search asset loader.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere.
 * Rollback: deactivate this loader; it owns no data.
 */
if ( ! function_exists( 'sml_ss_loader_active' ) ) {
	function sml_ss_loader_active() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return false; }
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		return false === strpos( $uri, '/wp-json/' );
	}

	function sml_ss_loader_markup() {
		$ref = function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main';
		$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( $ref ) . '/';
		$config = '<script id="sml-ss-config">window.SML_SITE_SEARCH=' . wp_json_encode( array(
			'rest' => rest_url( 'sml-site-search/v1/search' ),
		) ) . ';</script>';
		return '<link id="sml-ss-css" rel="stylesheet" href="' . esc_url( $base . 'css/site-search.css' ) . '">' . $config
			. '<script id="sml-ss-js" src="' . esc_url( $base . 'js/site-search.js' ) . '"></script>';
	}

	function sml_ss_loader_buffer( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '</body>' ) || false !== strpos( $html, 'id="sml-ss-js"' ) ) { return $html; }
		$pos = strripos( $html, '</body>' );
		return substr( $html, 0, $pos ) . sml_ss_loader_markup() . substr( $html, $pos );
	}

	add_action( 'init', static function () {
		if ( sml_ss_loader_active() ) { ob_start( 'sml_ss_loader_buffer' ); }
	}, 0 );
}
