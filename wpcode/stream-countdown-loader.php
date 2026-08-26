/**
 * SML Stream Countdown — loader.
 *
 * Injects js/stream-countdown.js (the owner's flip-clock countdown design,
 * wired to the real sml-scheduled-live/v1/creator/{handle} API) on the pages
 * where a creator's upcoming stream matters:
 *   /channel/{handle}/   — the channel's public page
 *   /live/               — the watch page (?room={handle})
 * The module itself decides whether to render: only when the API says a
 * PUBLIC stream is genuinely scheduled (status "scheduled", future
 * scheduled_at). No schedule -> the page is untouched. Scheduled video
 * premieres join once an API for them exists.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate — the script tag disappears, pages return to today's
 * behavior; the module holds no server state.
 */
if ( ! function_exists( 'sml_cdwn_loader_active' ) ) {

	function sml_cdwn_loader_active() {
		if ( is_admin() || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return false; }
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false !== strpos( $uri, '/wp-json/' ) || false !== strpos( $uri, '/wp-admin/' ) ) { return false; }
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		if ( preg_match( '#^/channel/[A-Za-z0-9_-]{1,40}/?$#', $path ) ) { return true; }
		if ( '/live/' === rtrim( $path, '/' ) . '/' && '/' !== $path ) { return true; }
		return false;
	}

	function sml_cdwn_ob( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '</body>' ) ) { return $html; }
		if ( false !== strpos( $html, 'id="sml-cdwn-js"' ) ) { return $html; } // idempotent
		foreach ( headers_list() as $hh ) { if ( 0 === stripos( $hh, 'content-type:' ) && false === stripos( $hh, 'text/html' ) ) { return $html; } }
		$ref = function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main';
		$tag = '<script id="sml-cdwn-js" defer src="https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . esc_attr( $ref ) . '/js/stream-countdown.js"></script>';
		$at  = stripos( $html, '</body>' );
		return substr( $html, 0, $at ) . $tag . substr( $html, $at );
	}

	add_action( 'init', static function () {
		if ( sml_cdwn_loader_active() ) { ob_start( 'sml_cdwn_ob' ); }
	}, 0 );
}
