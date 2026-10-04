/**
 * SML SEO / AdSense — keep app, sign-in and utility screens out of search and
 * out of the sitemaps, so Google (and the AdSense reviewer) only evaluates
 * pages that carry publisher content.
 *
 * Why: AdSense flagged "Google-served ads on screens without publisher
 * content". These screens render almost no server-side text (a chart shell,
 * a sign-in link, a migration step) and are navigation / behavioural screens.
 *
 * What it does (additive only):
 *  1. Sends `noindex, nofollow` (meta via wp_robots + Rank Math, and an
 *     X-Robots-Tag header) on the listed paths.
 *  2. Drops those URLs from Rank Math's sitemaps.
 *  3. Exposes the `sml_adsense_allowed` filter + sml_adsense_screen_allowed()
 *     so any future AdSense loader can refuse to run on those screens. This
 *     snippet does NOT load AdSense itself.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet.
 * WPCode rules: no top-level return/exit, and none of the flagged function
 * names (the site is at the 5-match limit) appear in this file.
 */
if ( ! function_exists( 'sml_adsense_thin_paths' ) ) {
	function sml_adsense_thin_paths() {
		return apply_filters( 'sml_adsense_thin_paths', array(
			'academy-chart-lab', 'stock-chart', 'advertise', 'two-step',
			'connect-migrate', 'connect-dashboard', 'connect', 'moomoo',
			'login', 'register', 'my-account', 'cart', 'checkout', 'checkout-2',
			'create-channel', 'wallet', 'settings', 'loop-messages', 'customize-profile',
			'upload-video', 'creator-wallet*',
			'advertiser-dashboard', 'go-live', 'referral-center', 'customer-dashboard',
			'my-profile', 'group-analytics', 'search-analytics', 'search-earnings', 'n', 'watchlist',
			'watch', 'tradingfloor',
		) );
	}

	function sml_adsense_request_path() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = trim( (string) wp_parse_url( $uri, PHP_URL_PATH ), '/' );
		return strtolower( $path );
	}

	function sml_adsense_path_is_thin( $path ) {
		$path = trim( strtolower( (string) $path ), '/' );
		if ( '' === $path ) { return false; }
		foreach ( sml_adsense_thin_paths() as $slug ) {
			if ( '*' === substr( $slug, -1 ) ) {
				if ( 0 === strpos( $path, rtrim( $slug, '*' ) ) ) { return true; }
				continue;
			}
			if ( $path === $slug || 0 === strpos( $path, $slug . '/' ) ) { return true; }
		}
		return false;
	}

	/** True when ads may be served on the current screen. */
	function sml_adsense_screen_allowed() {
		if ( is_admin() || is_404() || is_search() || is_front_page() || is_home() ) { return false; }
		if ( sml_adsense_path_is_thin( sml_adsense_request_path() ) ) { return false; }
		return (bool) apply_filters( 'sml_adsense_allowed', is_singular( 'post' ) );
	}

	add_filter( 'wp_robots', static function ( $robots ) {
		if ( sml_adsense_path_is_thin( sml_adsense_request_path() ) ) {
			unset( $robots['index'], $robots['follow'], $robots['max-snippet'], $robots['max-image-preview'], $robots['max-video-preview'] );
			$robots['noindex']  = true;
			$robots['nofollow'] = true;
		}
		return $robots;
	}, 9999 );

	add_filter( 'rank_math/frontend/robots', static function ( $robots ) {
		if ( is_array( $robots ) && sml_adsense_path_is_thin( sml_adsense_request_path() ) ) {
			$robots = array( 'index' => 'noindex', 'follow' => 'nofollow' );
		}
		return $robots;
	}, 9999 );

	add_action( 'send_headers', static function () {
		if ( sml_adsense_path_is_thin( sml_adsense_request_path() ) && ! headers_sent() ) {
			header( 'X-Robots-Tag: noindex, nofollow', true );
		}
	}, 9999 );

	add_filter( 'rank_math/sitemap/entry', static function ( $url, $type, $object ) {
		$loc = is_array( $url ) && isset( $url['loc'] ) ? (string) $url['loc'] : '';
		if ( '' !== $loc && sml_adsense_path_is_thin( wp_parse_url( $loc, PHP_URL_PATH ) ) ) { return false; }
		return $url;
	}, 9999, 3 );

	/**
	 * Backstop: another snippet/plugin can emit its own robots meta after the
	 * filters above run (seen on /stock-chart/, which still printed
	 * "index, follow"). On thin paths, rewrite or inject the robots meta in the
	 * final HTML so nothing downstream can override it.
	 */
	function sml_adsense_force_noindex_html( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '<head' ) ) { return $html; }
		$tag = '<meta name="robots" content="noindex, nofollow" />';
		$n   = 0;
		$out = preg_replace( '#<meta\s+name=["\']robots["\'][^>]*>#i', $tag, $html, -1, $n );
		if ( null === $out ) { return $html; }
		if ( 0 === $n ) { $out = preg_replace( '#</head>#i', $tag . '</head>', $out, 1 ); }
		return null === $out ? $html : $out;
	}

	add_action( 'template_redirect', static function () {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return; }
		if ( sml_adsense_path_is_thin( sml_adsense_request_path() ) ) { ob_start( 'sml_adsense_force_noindex_html' ); }
	}, 0 );
}
