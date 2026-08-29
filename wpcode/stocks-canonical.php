/**
 * SML Stocks Canonical + Entity Terminal — one URL per ticker (SEO Phase 2).
 *
 * 1. ENTITY TERMINAL (parity): /stocks/{x}/ mounts the full V2 Ticker
 *    Terminal for every visitor — same body classes, stylesheet, shell and
 *    footer mount the /stock-chart/ go-live snippet uses, so the existing
 *    terminal-v2.css chrome-clearing applies. The shell reads the symbol
 *    from the path (terminal-shell.js @bfd6e02+). The page's own SEO summary
 *    (body-level .sml-seo-summary) stays; the legacy client-rendered watch
 *    layout is hidden when it mounts. Escape hatch: ?tv2stocks=0 renders the
 *    legacy entity page for that visit.
 * 2. 301: /stock-chart/?symbol=X permanently redirects to /stocks/x/ when
 *    that symbol's entity page is ELIGIBLE per the SEO engine's swept state
 *    (option sml_seo_stocks_state — outage-protected, read-only here).
 *    Ineligible/unknown symbols keep the classic terminal. Any tv2 debug
 *    param (tv2 / tv2clean / tv2stocks) skips the redirect for that visit.
 * 3. CANONICAL fallback: for any non-redirected render, the canonical line in
 *    the final HTML points at the eligible entity page (the terminal page is
 *    a captured-shell render — filters never fire there, hence the buffer).
 * 4. Admin diagnostics: GET /wp-json/sml-scan/v1/state?sym=X.
 *
 * Kill switch for 1+2 together: option sml_stocks_tv2_off = 1 (canonical
 * rewrite stays). Full rollback: deactivate this snippet.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_scan_symbol' ) ) {

	function sml_scan_symbol() {
		$raw = isset( $_GET['symbol'] ) ? (string) wp_unslash( $_GET['symbol'] ) : '';
		$sym = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', $raw ) );
		return ( '' !== $sym && strlen( $sym ) <= 12 ) ? $sym : '';
	}

	function sml_scan_eligible( $sym ) {
		if ( '' === $sym ) { return false; }
		$state = get_option( 'sml_seo_stocks_state', array() );
		return is_array( $state ) && ! empty( $state[ $sym ]['eligible'] );
	}

	function sml_scan_target() {
		if ( is_admin() ) { return ''; }
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false === strpos( $uri, '/stock-chart' ) ) { return ''; }
		$sym = sml_scan_symbol();
		if ( ! sml_scan_eligible( $sym ) ) { return ''; }
		return home_url( '/stocks/' . strtolower( $sym ) . '/' );
	}

	function sml_scan_stocks_path_sym() {
		$path = (string) parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH );
		return preg_match( '~^/stocks/([a-z0-9.\-]{1,12})/?$~i', $path, $m ) ? strtoupper( $m[1] ) : '';
	}

	/* entity terminal is ON unless the kill option is set or ?tv2stocks=0 */
	function sml_scan_stocks_live() {
		if ( is_admin() || get_option( 'sml_stocks_tv2_off' ) ) { return false; }
		if ( isset( $_GET['tv2stocks'] ) && '0' === $_GET['tv2stocks'] ) { return false; }
		if ( '' === sml_scan_stocks_path_sym() ) { return false; }
		return function_exists( 'sml_cdn_resolve_ref' ); /* fail closed: never @main */
	}

	/* ---- 1. entity terminal go-live (mirrors the /stock-chart/ go-live) ---- */
	add_filter( 'body_class', static function ( $classes ) {
		if ( sml_scan_stocks_live() ) { $classes[] = 'tv2-live'; $classes[] = 'tv2-clean'; $classes[] = 'tv2-stocks'; }
		return $classes;
	} );
	add_action( 'wp_enqueue_scripts', static function () {
		if ( ! sml_scan_stocks_live() ) { return; }
		$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . sml_cdn_resolve_ref() . '/';
		wp_enqueue_style( 'sml-tv2', $base . 'css/terminal-v2.css', array(), null );
		wp_enqueue_script( 'sml-tv2-shell', $base . 'js/terminal-shell.js', array(), null, true );
	}, 20 );
	add_action( 'wp_head', static function () {
		if ( ! sml_scan_stocks_live() ) { return; }
		/* the legacy watch layout client-renders after load — keep it hidden;
		   the body-level .sml-seo-summary stays visible below the terminal */
		echo '<style id="sml-tv2-stocks-css">body.tv2-stocks .sml-watch-wrap,body.tv2-stocks .sml-watch-page,body.tv2-stocks .sml-primary-video{display:none!important}</style>';
	}, 20 );
	add_action( 'wp_footer', static function () {
		if ( ! sml_scan_stocks_live() ) { return; }
		echo '<script>window.SML_TV2_LIVE=1;window.SML_TV2_CLEAN=1;</script>';
		echo '<div id="sml-tv2-root" aria-label="Ticker Terminal"></div>';
	}, 5 );

	/* ---- 2. permanent redirect: classic terminal URL -> entity page ---- */
	add_action( 'template_redirect', static function () {
		if ( is_admin() || get_option( 'sml_stocks_tv2_off' ) ) { return; }
		if ( isset( $_GET['tv2'] ) || isset( $_GET['tv2clean'] ) || isset( $_GET['tv2stocks'] ) ) { return; } /* debug visits stay */
		if ( 'GET' !== strtoupper( (string) ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) ) ) { return; }
		$target = sml_scan_target();
		if ( '' === $target ) { return; }
		wp_safe_redirect( $target, 301 );
		exit;
	}, 2 );

	/* ---- 3. canonical rewrite for any non-redirected terminal render ---- */
	add_action( 'init', static function () {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return; }
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false === strpos( $uri, '/stock-chart' ) ) { return; }
		if ( '' === sml_scan_symbol() ) { return; }
		ob_start( static function ( $html ) {
			$t = sml_scan_target();
			if ( '' === $t || ! is_string( $html ) ) { return $html; }
			$new = preg_replace( '~<link rel="canonical" href="[^"]*"~', '<link rel="canonical" href="' . esc_url( $t ) . '"', $html, 1 );
			return is_string( $new ) ? $new : $html;
		} );
	}, 3 );
	add_filter( 'rank_math/frontend/canonical', static function ( $canonical ) {
		$t = sml_scan_target();
		return '' !== $t ? $t : $canonical;
	}, 20 );

	/* ---- 4. admin-only diagnostics ---- */
	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-scan/v1', '/state', array(
			'methods'             => 'GET',
			'callback'            => static function ( WP_REST_Request $q ) {
				$sym   = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $q->get_param( 'sym' ) ) );
				$state = get_option( 'sml_seo_stocks_state', array() );
				$entry = ( is_array( $state ) && $sym && isset( $state[ $sym ] ) ) ? $state[ $sym ] : null;
				$next  = wp_next_scheduled( 'sml_seo_stocks_score_tick' );
				$eligible_n = 0; $newest = 0;
				if ( is_array( $state ) ) {
					foreach ( $state as $row ) {
						if ( ! empty( $row['eligible'] ) ) { $eligible_n++; }
						if ( isset( $row['checked'] ) && (int) $row['checked'] > $newest ) { $newest = (int) $row['checked']; }
					}
				}
				return rest_ensure_response( array(
					'ok' => true, 'total' => is_array( $state ) ? count( $state ) : 0, 'eligible_count' => $eligible_n,
					'newest_checked_age_s' => $newest ? ( time() - $newest ) : null, 'entry' => $entry,
					'sweep_next_cron_in_s' => $next ? ( $next - time() ) : null,
					'stocks_terminal_live' => ! get_option( 'sml_stocks_tv2_off' ),
				) );
			},
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
		) );
	} );
}
