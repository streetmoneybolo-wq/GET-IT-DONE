/**
 * SML AdSense Cleanup — noindex the thin / templated / app surface.
 *
 * Google rejected the site for "low value content": ~149 of 402 posts are
 * machine-templated (signal blurbs + Discord-alert recaps) and NOTHING was
 * noindexed, so the crawler graded the whole thin surface. This snippet keeps
 * that content live for on-site users but removes it from Google's index by
 * integrating with Rank Math's robots filter, so the index reflects the real
 * editorial + trust pages instead of the auto-generated flood.
 *
 * WHAT IT NOINDEXES (precise, reversible):
 *  - Signal posts: _sml_signal_key meta, or the "STOCKMARKETLOOP MARKET SIGNAL"/
 *    "VERIFIED MARKET SIGNAL"/"Editorial Desk" machine markers, or a $TICKER-led
 *    title. (Legit macro digests bylined "Stock Market Loop News" carry none of
 *    these and stay indexed.)
 *  - Discord-pump recaps: bodies naming "Making Easy Money" / "Grandmaster".
 *  - App/account/checkout/duplicate/preview shells by exact path.
 * DELIBERATELY LEFT INDEXED: category/archive hubs, /stocks/{ticker}/ entity
 * pages (governed by the separate SEO eligibility engine), and all real editorial.
 *
 * Kill: option sml_ni_off = 1, or deactivate. Verify logged-out with cache off.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_ni_should_noindex' ) ) {

	function sml_ni_paths() {
		return array(
			'/wallet', '/cart', '/checkout', '/checkout-2', '/my-account', '/settings',
			'/loop-messages', '/customize-profile', '/go-live', '/upload-video',
			'/video-monetization', '/referral-center', '/group-analytics',
			'/advertiser-dashboard', '/finance-search', '/search-earnings',
			'/search-analytics', '/options-calculator', '/customer-dashboard',
			'/my-profile', '/stock-search', '/creator-wallet', '/creator-wallet-2',
			'/creator-wallet-3', '/creator-wallet-4',
			'/sml-unusual-activity-layout-preview', '/taste-safe-sensory-nulla-dignissim',
		);
	}

	function sml_ni_should_noindex() {
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return false; }
		if ( get_option( 'sml_ni_off' ) ) { return false; }

		$path = strtolower( untrailingslashit( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ) ) );
		if ( in_array( $path, sml_ni_paths(), true ) ) { return true; }

		if ( function_exists( 'is_singular' ) && is_singular( 'post' ) ) {
			$id = get_queried_object_id();
			if ( $id ) {
				if ( get_post_meta( $id, '_sml_signal_key', true ) ) { return true; }
				$post = get_post( $id );
				if ( $post ) {
					$t = (string) $post->post_title;
					$c = (string) $post->post_content;
					if ( preg_match( '/^\s*\$[A-Z]{1,6}\b/', $t ) ) { return true; } /* $TICKER-led signal title */
					if ( false !== stripos( $c, 'STOCKMARKETLOOP MARKET SIGNAL' ) ) { return true; }
					if ( false !== stripos( $c, 'VERIFIED MARKET SIGNAL' ) ) { return true; }
					if ( false !== stripos( $c, 'By StockMarketLoop Editorial Desk' ) ) { return true; }
					if ( false !== stripos( $c, 'Making Easy Money' ) ) { return true; } /* Discord-pump recap */
					if ( false !== stripos( $c, 'Grandmaster' ) ) { return true; }
				}
			}
		}
		return false;
	}

	/* Primary: Rank Math owns the robots meta on this site. */
	add_filter( 'rank_math/frontend/robots', static function ( $robots ) {
		if ( sml_ni_should_noindex() ) { $robots['index'] = 'noindex'; }
		return $robots;
	}, 20 );

	/* Belt-and-suspenders for any page core (not Rank Math) emits robots on. */
	add_filter( 'wp_robots', static function ( $robots ) {
		if ( sml_ni_should_noindex() ) { unset( $robots['index'] ); $robots['noindex'] = true; }
		return $robots;
	}, 20 );

	/* Admin diagnostic: GET /wp-json/sml-ni/v1/check?url=/some/path (or ?post=ID). */
	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-ni/v1', '/check', array(
			'methods'             => 'GET',
			'callback'            => static function ( WP_REST_Request $q ) {
				$out = array( 'off' => (bool) get_option( 'sml_ni_off' ) );
				$pid = absint( $q->get_param( 'post' ) );
				if ( $pid ) {
					$has_meta = (bool) get_post_meta( $pid, '_sml_signal_key', true );
					$p = get_post( $pid );
					$out['post'] = array(
						'id' => $pid,
						'title' => $p ? $p->post_title : null,
						'signal_meta' => $has_meta,
						'title_ticker' => $p ? (bool) preg_match( '/^\s*\$[A-Z]{1,6}\b/', (string) $p->post_title ) : false,
						'market_signal' => $p ? ( false !== stripos( (string) $p->post_content, 'MARKET SIGNAL' ) ) : false,
						'discord_pump' => $p ? ( false !== stripos( (string) $p->post_content, 'Making Easy Money' ) || false !== stripos( (string) $p->post_content, 'Grandmaster' ) ) : false,
					);
				}
				$url = (string) $q->get_param( 'url' );
				if ( '' !== $url ) {
					$path = strtolower( untrailingslashit( (string) wp_parse_url( $url, PHP_URL_PATH ) ) );
					$out['path'] = $path;
					$out['path_match'] = in_array( $path, sml_ni_paths(), true );
				}
				return rest_ensure_response( $out );
			},
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
		) );
	} );
}
