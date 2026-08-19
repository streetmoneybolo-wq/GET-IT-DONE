/**
 * SML Ticker Terminal V2 — GO-LIVE loader (artifact architecture, public rollout).
 *
 * Turns on the new design-built terminal for EVERY visitor on /stock-chart/:
 * terminal-shell.js fetches the captured design shell from the commit-pinned
 * CDN and wires the native modules (chart, quote strip, live feed, alert box,
 * market position, short sale, Options / Research / News tabs) — all built on
 * the site's own REST data. Heat map stays off for everyone.
 *
 * CLEAN RENDER (Phase 2): the legacy 14-plugin terminal markup is stripped from
 * the post content, so the legacy modules find nothing to boot into and the old
 * layout never renders at all. Kept in the content: the SEO ticker summary, an
 * anchor the V2 shell mounts at, and a hidden `.sml-pro-body` host the voice-room
 * plugin mounts into (its WebRTC client is proxied by the V2 feed's Voice tab).
 * The ad runtime keeps its own header/sidebar/mobile slots.
 *   - SML_TV2_CLEAN_DEFAULT = true  → clean render for everyone
 *   - ?tv2clean=0                    → this visit renders the legacy markup underneath (debug)
 *   - ?tv2clean=1                    → admins can preview clean render when the default is false
 *
 * Escape hatch: ?tv2=0 shows the untouched legacy terminal for that visit.
 * ROLLBACK: deactivate this snippet in WPCode — the site instantly returns to
 * the original terminal. No database change is ever made.
 *
 * WPCode rules: no top-level return/exit; no base64-decode / eval / ini-set / error-reporting.
 * WPCode PHP snippet: Auto Insert / Run Everywhere / Active.
 */
if ( ! defined( 'SML_TV2_CLEAN_DEFAULT' ) ) { define( 'SML_TV2_CLEAN_DEFAULT', true ); }   /* clean render is the default since 2026-08-19; ?tv2clean=0 shows the old markup underneath for a visit */
if ( ! function_exists( 'sml_tv2_live_active' ) ) {

	function sml_tv2_live_active() {
		if ( is_admin() ) { return false; }
		if ( isset( $_GET['tv2'] ) && '0' === $_GET['tv2'] ) { return false; } // escape hatch -> legacy
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		return ( strpos( $uri, '/stock-chart' ) !== false );                   // terminal page only
	}

	function sml_tv2_live_ref() {
		if ( function_exists( 'sml_cdn_resolve_ref' ) ) { return sml_cdn_resolve_ref(); } // commit-pinned
		return 'main';
	}

	function sml_tv2_clean_active() {
		if ( ! sml_tv2_live_active() ) { return false; }
		if ( isset( $_GET['tv2clean'] ) ) {
			if ( '0' === $_GET['tv2clean'] ) { return false; }
			if ( '1' === $_GET['tv2clean'] ) { return SML_TV2_CLEAN_DEFAULT || current_user_can( 'manage_options' ); }
		}
		return (bool) SML_TV2_CLEAN_DEFAULT;
	}

	/* [start, end) of the balanced <section …>…</section> block that begins at $needle */
	function sml_tv2_section_span( $html, $needle ) {
		$start = strpos( $html, $needle );
		if ( false === $start ) { return null; }
		if ( ! preg_match_all( '#<section\b|</section>#i', $html, $m, PREG_OFFSET_CAPTURE, $start ) ) { return null; }
		$depth = 0;
		foreach ( $m[0] as $tok ) {
			$depth += ( 0 === stripos( $tok[0], '<section' ) ) ? 1 : -1;
			if ( 0 === $depth ) { return array( $start, $tok[1] + strlen( $tok[0] ) ); }
		}
		return null;
	}
	/* remove the legacy terminal block, leave the V2 anchor + voice host in its place, and move
	   the SEO "market summary and related coverage" section to the BOTTOM of the content (under the terminal) */
	function sml_tv2_strip_terminal( $html ) {
		$t = sml_tv2_section_span( $html, '<section class="sml-terminal"' );
		if ( ! $t ) { return $html; }
		$anchor = '<div id="sml-tv2-anchor" aria-hidden="true"></div>'
			. '<div class="sml-pro-body tv2-legacy-host" hidden aria-hidden="true" style="display:none"></div>'; /* voice-room plugin mounts here (proxied, never shown) */
		$html = substr( $html, 0, $t[0] ) . $anchor . substr( $html, $t[1] );
		$s = sml_tv2_section_span( $html, '<section class="sml-ticker-summary"' );
		if ( $s ) {
			$summary = substr( $html, $s[0], $s[1] - $s[0] );
			$html    = substr( $html, 0, $s[0] ) . substr( $html, $s[1] );
			$html    = rtrim( $html ) . "\n" . '<div class="tv2-summary-below">' . $summary . '</div>';
		}
		return $html;
	}
	/* priority 99: the SEO summary section is added by another plugin's content filter, so
	   we must run after it to be able to move it below the terminal */
	add_filter( 'the_content', static function ( $html ) {
		if ( ! is_string( $html ) || ! sml_tv2_clean_active() || ! in_the_loop() ) { return $html; }
		return sml_tv2_strip_terminal( $html );
	}, 99 );

	/* The legacy terminal modules are printed as inline <script id="sml-…"> blocks by
	   their plugins regardless of the content. With the markup gone they mostly no-op,
	   but the live-feed booter falls back to mounting in <main> and keeps polling, the
	   search booter re-renders the old symbol search, etc. In clean render these exact
	   blocks are dropped from the page output. Everything else (auth, ads, voice room,
	   watchlists, members, analytics) is untouched. */
	function sml_tv2_clean_strip_ids() {
		return array(
			'sml-livefeed-boot', 'sml-replystream-boot', 'sml-ws-js', 'sml-tiles-js', 'sml-tech-js', 'sml-opt-js',
			'sml-moveprofile-js', 'sml-pro-terminal-js', 'sml-loopcharts-inline-js-after', 'sml-terminal-structure-guard-js-after',
			'sml-ticker-nav-repair-js', 'sml-trading-floor-link-repair-js', 'sml-custom-chart-remover-js', 'sml-iv-stats-js',
			'sml-options-earnings-intel-js', 'sml-ei-markers-js-extra', 'sml-ticker-heatmap-js-extra',
			'sml-ticker-search-boot', 'sml-ticker-search-click-guard', 'sml-ticker-search-pointer-guard', 'sml-ticker-community-tabs-js-extra',
		);
	}
	function sml_tv2_clean_ob( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '</body>' ) ) { return $html; }
		foreach ( sml_tv2_clean_strip_ids() as $id ) {
			$html = preg_replace( '#<script\b[^>]*\bid=["\']' . preg_quote( $id, '#' ) . '["\'][^>]*>.*?</script>\s*#is', '', $html );
		}
		/* external legacy UI scripts that only exist to dress the old terminal */
		$html = preg_replace( '#<script\b[^>]*\bsrc=["\'][^"\']*sml-ticker-community-tabs/assets/ticker-community-tabs\.js[^"\']*["\'][^>]*></script>\s*#i', '', $html );
		return $html;
	}
	add_action( 'template_redirect', static function () {
		if ( sml_tv2_clean_active() && ! ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { ob_start( 'sml_tv2_clean_ob' ); }
	}, 0 );
	/* blocks appended by OTHER snippets' output buffers (the live-feed booter, reply stream)
	   land after this buffer has flushed — the outermost pre-paint-guard buffer strips them */
	add_filter( 'sml_pp_strip_script_ids', static function ( $ids ) {
		if ( ! sml_tv2_clean_active() ) { return $ids; }
		return array_merge( (array) $ids, sml_tv2_clean_strip_ids() );
	} );

	/* server-side body classes so the CDN stylesheet can clear the page chrome above the
	   terminal on the very first paint (no script needed): tv2-live (+ tv2-clean) */
	add_filter( 'body_class', static function ( $classes ) {
		if ( sml_tv2_live_active() ) { $classes[] = 'tv2-live'; if ( sml_tv2_clean_active() ) { $classes[] = 'tv2-clean'; } }
		return $classes;
	} );

	add_action( 'wp_enqueue_scripts', function () {
		if ( ! sml_tv2_live_active() ) { return; }
		$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . sml_tv2_live_ref() . '/';
		wp_enqueue_style( 'sml-tv2', $base . 'css/terminal-v2.css', array(), null );
		wp_enqueue_script( 'sml-tv2-shell', $base . 'js/terminal-shell.js', array(), null, true );
	}, 20 );

	add_action( 'wp_footer', function () {
		if ( ! sml_tv2_live_active() ) { return; }
		// the live flag MUST print before the footer scripts run (priority 5 < 20)
		echo '<script>window.SML_TV2_LIVE=1;' . ( sml_tv2_clean_active() ? 'window.SML_TV2_CLEAN=1;' : '' ) . '</script>';
		echo '<div id="sml-tv2-root" aria-label="Ticker Terminal"></div>';
	}, 5 );
}
