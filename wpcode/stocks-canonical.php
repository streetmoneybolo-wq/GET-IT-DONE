/**
 * SML Stocks Canonical — one URL per ticker in search (SEO Phase 2, step 1).
 *
 * PROBLEM (verified live): /stock-chart/?symbol=SPY renders a per-symbol
 * title but its canonical points at the bare /stock-chart/ page, so every
 * ticker's ranking signals collapse into one generic URL while the entity
 * page /stocks/spy/ competes separately.
 *
 * FIX: when the requested symbol's entity page is ELIGIBLE (the SEO engine's
 * swept state says the page exists and is indexable — option
 * sml_seo_stocks_state, keep-last-good protected), the terminal variant's
 * canonical points to /stocks/{symbol}/. Search engines consolidate; human
 * visitors keep the full terminal experience. No redirect is issued — a 301
 * waits until the entity pages reach terminal parity.
 *
 * ALSO: admin-only preview of that parity — /stocks/{x}/?tv2stocks=1&symbol=X
 * mounts the V2 terminal shell on the entity page (manage_options only,
 * commit-pinned CDN, fails closed without the resolver) so the experience can
 * be evaluated before any default flips.
 *
 * Read-only on render paths (one autoload-off option read on the terminal
 * page only) — per the SEO engine's architecture rules.
 * Rollback: deactivate this snippet; canonicals return to today's behavior.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_scan_symbol' ) ) {

	function sml_scan_symbol() {
		$raw = isset( $_GET['symbol'] ) ? (string) wp_unslash( $_GET['symbol'] ) : '';
		$sym = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', $raw ) );
		return ( '' !== $sym && strlen( $sym ) <= 12 ) ? $sym : '';
	}

	function sml_scan_target() {
		if ( is_admin() ) { return ''; }
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false === strpos( $uri, '/stock-chart' ) ) { return ''; }
		$sym = sml_scan_symbol();
		if ( '' === $sym ) { return ''; }
		$state = get_option( 'sml_seo_stocks_state', array() );
		if ( ! is_array( $state ) || empty( $state[ $sym ]['eligible'] ) ) { return ''; }
		return home_url( '/stocks/' . strtolower( $sym ) . '/' );
	}

	/* Rank Math prints the canonical on this site; core fallback covered too. */
	add_filter( 'rank_math/frontend/canonical', static function ( $canonical ) {
		$t = sml_scan_target();
		return '' !== $t ? $t : $canonical;
	}, 20 );
	add_filter( 'get_canonical_url', static function ( $canonical ) {
		$t = sml_scan_target();
		return '' !== $t ? $t : $canonical;
	}, 20 );

	/* ---- admin preview: V2 terminal shell mounted on the entity page ---- */
	add_action( 'wp_footer', static function () {
		if ( is_admin() || ! current_user_can( 'manage_options' ) ) { return; }
		if ( ! isset( $_GET['tv2stocks'] ) || '1' !== $_GET['tv2stocks'] ) { return; }
		$path = (string) parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH );
		if ( ! preg_match( '~^/stocks/[a-z0-9.\-]{1,12}/?$~i', $path ) ) { return; }
		if ( ! function_exists( 'sml_cdn_resolve_ref' ) ) { return; } /* fail closed: never @main */
		$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . esc_attr( sml_cdn_resolve_ref() ) . '/';
		echo '<script>window.SML_TV2_LIVE=1;</script>';
		echo '<div id="sml-tv2-root" aria-label="Ticker Terminal preview"></div>';
		echo '<script id="sml-tv2-shell" src="' . esc_url( $base . 'js/terminal-shell.js' ) . '"></script>';
	}, 30 );

	/* admin-only diagnostics: what does the canonical gate actually see? */
	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-scan/v1', '/state', array(
			'methods'             => 'GET',
			'callback'            => static function ( WP_REST_Request $q ) {
				$sym   = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $q->get_param( 'sym' ) ) );
				$state = get_option( 'sml_seo_stocks_state', array() );
				$entry = ( is_array( $state ) && $sym && isset( $state[ $sym ] ) ) ? $state[ $sym ] : null;
				$next  = wp_next_scheduled( 'sml_seo_stocks_score_tick' );
				$eligible_n = 0; $newest_checked = 0;
				if ( is_array( $state ) ) {
					foreach ( $state as $row ) {
						if ( ! empty( $row['eligible'] ) ) { $eligible_n++; }
						if ( isset( $row['checked'] ) && (int) $row['checked'] > $newest_checked ) { $newest_checked = (int) $row['checked']; }
					}
				}
				return rest_ensure_response( array(
					'ok' => true, 'is_array' => is_array( $state ), 'total' => is_array( $state ) ? count( $state ) : 0,
					'eligible_count' => $eligible_n, 'newest_checked_age_s' => $newest_checked ? ( time() - $newest_checked ) : null,
					'entry' => $entry, 'sweep_next_cron_in_s' => $next ? ( $next - time() ) : null,
					'sample_keys' => is_array( $state ) ? array_slice( array_keys( $state ), 0, 6 ) : array(),
				) );
			},
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
		) );
	} );
}
