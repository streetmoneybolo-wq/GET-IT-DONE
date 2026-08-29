/**
 * SML Market Monitor — /market-monitor/ live unusual-activity tape.
 *
 * The moomoo-style streaming tape, honestly scoped to what SML's data can
 * truly detect (see SML/CODEX-HANDOFF-market-monitor.md): the Render loop-kick
 * service computes events (sharp moves, 7%+ crossings, volume spikes,
 * day-high/low reversals) from quote snapshots it ALREADY fetches for
 * /api/quotes clients — zero extra provider load — and serves GET /api/tape
 * from memory. This snippet adds:
 *   1. GET /wp-json/sml-mm/v1/signals — last-24h Signal News events (public
 *      posts carrying _sml_signal_key), 60s transient cache, so the tape also
 *      carries the gamma/flow/momentum detections the autopilot publishes.
 *   2. The /market-monitor/ page: un-404 standalone render (proven init@1 ->
 *      template_redirect@0 mechanics), pinned CSS/JS via sml_cdn_resolve_ref().
 * Kill: option sml_mm_off = 1 (page 404s again; signals route stays harmless).
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_mmx_signals' ) ) {

	function sml_mmx_signals() {
		$out = get_transient( 'sml_mmx_signals_v1' );
		if ( is_array( $out ) ) { return $out; }
		$out = array();
		$qq  = new WP_Query( array(
			'post_type'      => 'any',
			'post_status'    => 'publish',
			'posts_per_page' => 40,
			'meta_key'       => '_sml_signal_key',
			'date_query'     => array( array( 'after' => '24 hours ago' ) ),
			'no_found_rows'  => true,
		) );
		foreach ( $qq->posts as $p ) {
			$sym   = preg_replace( '/[^A-Z0-9.\-]/', '', strtoupper( (string) get_post_meta( $p->ID, '_sml_primary_ticker', true ) ) );
			$out[] = array(
				'ts'    => (int) get_post_time( 'U', true, $p ),
				'sym'   => $sym,
				'title' => html_entity_decode( wp_strip_all_tags( get_the_title( $p ) ), ENT_QUOTES ),
				'url'   => get_permalink( $p ),
			);
		}
		set_transient( 'sml_mmx_signals_v1', $out, 60 );
		return $out;
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-mm/v1', '/signals', array(
			'methods'             => 'GET',
			'callback'            => static function () {
				$r = rest_ensure_response( array( 'ok' => true, 'signals' => sml_mmx_signals() ) );
				$r->header( 'Cache-Control', 'public, max-age=60' );
				return $r;
			},
			'permission_callback' => '__return_true', /* public content, read-only, cached */
		) );
	} );

	add_action( 'init', static function () {
		if ( get_option( 'sml_mm_off' ) ) { return; }
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = untrailingslashit( (string) wp_parse_url( $uri, PHP_URL_PATH ) );
		if ( '/market-monitor' !== strtolower( $path ) ) { return; }
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return; }
		add_action( 'template_redirect', static function () {
			if ( ! function_exists( 'sml_cdn_resolve_ref' ) ) { return; } /* fail closed: page 404s, never @main */
			global $wp_query;
			if ( $wp_query ) { $wp_query->is_404 = false; }
			status_header( 200 );
			header( 'Content-Type: text/html; charset=UTF-8' );
			header( 'Cache-Control: public, max-age=120' );
			$base  = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( sml_cdn_resolve_ref() ) . '/';
			$canon = home_url( '/market-monitor/' );
			echo '<!doctype html><html lang="en"><head><meta charset="utf-8">';
			echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
			echo '<title>Market Monitor — Live Unusual Activity Tape | Stock Market Loop</title>';
			echo '<meta name="description" content="A live tape of unusual market activity on Stock Market Loop: sharp moves, volume spikes, intraday reversals and Signal News detections, streaming during market hours.">';
			echo '<link rel="canonical" href="' . esc_url( $canon ) . '">';
			echo '<meta name="robots" content="index, follow">';
			echo '<link rel="stylesheet" href="' . esc_url( $base . 'css/market-monitor.css' ) . '">';
			echo '</head><body class="sml-mm-body">';
			echo '<div id="sml-mm-root" aria-label="Market Monitor"></div>';
			echo '<script>window.SML_MM=' . wp_json_encode( array(
				'tape'    => 'https://stockmarketloop-loop-kick.onrender.com/api/tape',
				'quotes'  => 'https://stockmarketloop-loop-kick.onrender.com/api/quotes',
				'signals' => rest_url( 'sml-mm/v1/signals' ),
				'syms'    => array( 'SPY', 'QQQ', 'IWM', 'DIA', 'SOXX', 'BTC' ), /* polled at 45s to feed the tape ingest — ~1.3 snapshot calls/min while the tape is open */
			) ) . ';</script>';
			echo '<script src="' . esc_url( $base . 'js/market-monitor.js' ) . '"></script>';
			echo '</body></html>';
			exit;
		}, 0 );
	}, 1 );
}
