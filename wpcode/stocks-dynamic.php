/**
 * SML Stocks Dynamic — vouched entity pages without page creation (Phase 3).
 *
 * Only ~70 of the seed's symbols have a static /stocks/{x}/ WP page; everything
 * else 404s, and the SEO engine (correctly) refuses to mark a 404 eligible.
 * This snippet closes the loop: when a request would 404 on /stocks/{sym}/ and
 * the SEO sweep VOUCHES for that symbol (a state entry from real scoring —
 * option sml_seo_stocks_state, seed-bounded, read-only), it renders a real
 * entity document instead: proper head (title/canonical/robots from the swept
 * verdict, JSON-LD when the score cache is warm), a visible SEO summary block,
 * and the full V2 terminal mount. The NEXT sweep then sees the page exist and
 * marks the symbol eligible → sitemap. Expanding coverage becomes: add
 * symbols to the seed, nothing else.
 *
 * Fail-closed rules (crawler-controllable path):
 *  - unknown/unvouched symbols stay REAL 404s — no fetching, no rendering;
 *  - render reads ONLY the swept state + the 2h score cache (never fetches);
 *  - robots: index only when the swept verdict says index/selective; noindex
 *    otherwise — mirrors the augment's fail-closed rule;
 *  - static pages always win (this runs only on would-be 404s).
 * Kill: option sml_stocks_dyn_off = 1, or deactivate the snippet.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_sdy_render' ) ) {

	function sml_sdy_vouched( $sym ) {
		$state = get_option( 'sml_seo_stocks_state', array() );
		if ( ! is_array( $state ) || ! isset( $state[ $sym ] ) || ! is_array( $state[ $sym ] ) ) { return null; }
		$st = $state[ $sym ];
		/* a real swept result: 'scored'/'kept-last-good' (data-backed) or 'no-page'
		   (valid data, page missing — exactly what this route exists to fix).
		   'no-data' = confirmed NONEXISTENT symbol -> stays a real 404;
		   'in-progress' rejected so a first sweep cannot self-vouch. */
		if ( ! in_array( (string) ( $st['why'] ?? '' ), array( 'scored', 'kept-last-good', 'no-page' ), true ) ) { return null; }
		if ( ! isset( $st['checked'] ) || ( time() - (int) $st['checked'] ) > 26 * HOUR_IN_SECONDS ) { return null; }
		return $st;
	}

	function sml_sdy_render() {
		if ( ! is_404() || is_admin() || get_option( 'sml_stocks_dyn_off' ) ) { return; }
		$path = (string) parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH );
		if ( ! preg_match( '~^/stocks/([a-z0-9.\-]{1,12})/?$~i', $path, $m ) ) { return; }
		$sym = strtoupper( $m[1] );
		$st  = sml_sdy_vouched( $sym );
		if ( null === $st ) { return; } /* stays a real 404 */
		if ( ! function_exists( 'sml_cdn_resolve_ref' ) ) { return; } /* fail closed */
		$canonical_path = '/stocks/' . strtolower( $sym ) . '/';
		if ( $path !== $canonical_path ) { wp_safe_redirect( home_url( $canonical_path ), 301 ); exit; }

		$score   = function_exists( 'sml_ege_cached_score' ) ? sml_ege_cached_score( $sym ) : null;
		$company = is_array( $score ) && is_array( $score['company'] ?? null ) ? $score['company'] : null;
		$quote   = is_array( $score ) && is_array( $score['quote'] ?? null ) ? $score['quote'] : null;
		$name    = $company && ! empty( $company['name'] ) ? sanitize_text_field( (string) $company['name'] ) : '';
		$last    = $quote && isset( $quote['last'] ) && is_numeric( $quote['last'] ) ? (float) $quote['last'] : null;

		$title = $name ? sprintf( '%s: %s - Stock Market Loop', $sym, $name ) : sprintf( '%s Stock - Stock Market Loop', $sym );
		$desc  = $name
			? sprintf( '$%s (%s) live chart, quotes, options positioning, news and trader chat on Stock Market Loop.', $sym, $name )
			: sprintf( '$%s live chart, quotes, options positioning, news and trader chat on Stock Market Loop.', $sym );
		$index = ! empty( $st['eligible'] ) || in_array( (string) ( $st['verdict'] ?? '' ), array( 'index', 'selective' ), true );
		$base  = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . esc_attr( sml_cdn_resolve_ref() ) . '/';
		$canon = home_url( '/stocks/' . strtolower( $sym ) . '/' );

		status_header( 200 );
		header( 'Content-Type: text/html; charset=UTF-8' );
		header( 'Cache-Control: public, max-age=300' );
		header_remove( 'Expires' ); /* core's 404 handling sent a 1984 Expires — keep freshness signals coherent */

		echo '<!doctype html><html lang="en"><head><meta charset="utf-8">';
		echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
		echo '<title>' . esc_html( $title ) . '</title>';
		echo '<meta name="description" content="' . esc_attr( $desc ) . '">';
		echo '<link rel="canonical" href="' . esc_url( $canon ) . '">';
		echo '<meta name="robots" content="' . ( $index ? 'index, follow, max-image-preview:large' : 'noindex, follow' ) . '">';
		if ( $name ) {
			echo '<script type="application/ld+json">' . wp_json_encode( array(
				'@context' => 'https://schema.org',
				'@type'    => 'Corporation',
				'name'     => $name,
				'tickerSymbol' => $sym,
				'url'      => $canon,
			) ) . '</script>';
		}
		echo '<link rel="stylesheet" href="' . esc_url( $base . 'css/terminal-v2.css' ) . '">';
		echo '<style>body{margin:0;background:#05080d;color:#dfe8f2;font-family:Inter,system-ui,sans-serif}.sml-seo-summary{max-width:900px;margin:0 auto;padding:14px 18px;font-size:14px;line-height:1.6;color:#9fb2c5}.sml-seo-summary b{color:#e6edf5}</style>';
		echo '</head><body class="tv2-live tv2-clean tv2-stocks">';
		echo '<div class="sml-seo-summary"><b>' . esc_html( $name ? '$' . $sym . ' — ' . $name : '$' . $sym ) . '</b>';
		if ( null !== $last ) { echo esc_html( sprintf( ' · last swept quote $%s', number_format( $last, 2 ) ) ); }
		echo esc_html( ' · live chart, options positioning, news and the trader stream load below.' ) . '</div>';
		echo '<script>window.SML_TV2_LIVE=1;window.SML_TV2_CLEAN=1;</script>';
		echo '<div id="sml-tv2-root" aria-label="Ticker Terminal"></div>';
		echo '<script id="sml-tv2-shell" src="' . esc_url( $base . 'js/terminal-shell.js' ) . '"></script>';
		echo '</body></html>';
		exit;
	}
	add_action( 'template_redirect', 'sml_sdy_render', 4 );
}
