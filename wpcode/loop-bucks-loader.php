/**
 * SML Loop Bucks button — asset loader + config.
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet; it owns no data.
 *
 * Injects css/loop-bucks.css + js/loop-bucks.js from the repo CDN before
 * </body> on front-end pages for signed-in users. The JS anchors the button
 * next to the header LOOP-KICK (#sml-hf-loop-kick) on the home feed and
 * falls back to a fixed top-right pill elsewhere.
 *
 * DATA: the button is backed by the site's REAL Loop Bucks system,
 * sml-lb/v1 (/me, /earn, /gates, /leaderboard). There is deliberately NO
 * second ledger / API snippet — an earlier package shipped one, which would
 * have shown users two different Loop Bucks balances. Function prefix is
 * sml_lbb_ (button) so nothing here can collide with the plugin's sml_lb_*.
 */
if ( ! function_exists( 'sml_lbb_loader_active' ) ) {
	function sml_lbb_loader_active() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return false; }
		if ( ! is_user_logged_in() ) { return false; }
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false !== strpos( $uri, '/wp-json/' ) || false !== strpos( $uri, '/wp-login' ) ) { return false; }
		return true;
	}

	function sml_lbb_loader_markup() {
		$ref  = function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main';
		$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( $ref ) . '/';
		$me   = wp_get_current_user();
		$config = '<script id="sml-lb-config">window.SML_LB=' . wp_json_encode( array(
			'rest'  => rest_url( 'sml-lb/v1' ),
			'nonce' => wp_create_nonce( 'wp_rest' ),
			'home'  => home_url( '/' ),
			'me'    => array( 'id' => (int) $me->ID, 'name' => $me->display_name, 'slug' => $me->user_nicename ),
			'icon'  => $base . 'img/loop-bucks-icon.png',
		) ) . ';</script>';
		return '<link id="sml-lb-css" rel="stylesheet" href="' . esc_url( $base . 'css/loop-bucks.css' ) . '">' . $config
			. '<script id="sml-lb-js" src="' . esc_url( $base . 'js/loop-bucks.js' ) . '"></script>';
	}

	function sml_lbb_loader_buffer( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '</body>' ) || false !== strpos( $html, 'id="sml-lb-js"' ) ) { return $html; }
		/* only HTML documents — never wrap JSON/feeds that happen to be served through this hook */
		if ( ! preg_match( '/<html[\s>]/i', substr( $html, 0, 4096 ) ) ) { return $html; }
		$pos = strripos( $html, '</body>' );
		return substr( $html, 0, $pos ) . sml_lbb_loader_markup() . substr( $html, $pos );
	}

	add_action( 'init', static function () {
		if ( sml_lbb_loader_active() ) { ob_start( 'sml_lbb_loader_buffer' ); }
	}, 0 );
}
