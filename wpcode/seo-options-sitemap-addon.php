/**
 * SML SEO — options URLs in the existing hub sitemap.
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere.
 * This deliberately adds no rewrite rule. It reuses /sml-hub-sitemap.xml,
 * whose route is already live, and preserves the existing renderer's output.
 */
if ( ! function_exists( 'sml_seo_options_sitemap_tickers' ) ) {
	function sml_seo_options_sitemap_tickers() {
		$fallback = array( 'spy', 'qqq', 'nvda', 'tsla', 'aapl', 'amd', 'meta', 'amzn' );
		$config   = function_exists( 'sml_opt_config' ) ? sml_opt_config() : array();
		$tickers  = is_array( $config ) && ! empty( $config['tickers'] ) && is_array( $config['tickers'] )
			? $config['tickers']
			: $fallback;

		$tickers = array_map(
			static function ( $ticker ) {
				return strtolower( sanitize_key( (string) $ticker ) );
			},
			$tickers
		);
		return array_values( array_unique( array_filter( $tickers ) ) );
	}

	function sml_seo_options_sitemap_xml() {
		$xml = sml_seo_render_hub_sitemap();
		if ( false !== strpos( $xml, home_url( '/options/' ) ) ) {
			return $xml;
		}

		$esc   = function_exists( 'sml_esc_xml' ) ? 'sml_esc_xml' : 'esc_html';
		$items = '<url><loc>' . $esc( home_url( '/options/' ) ) . '</loc><changefreq>daily</changefreq><priority>0.7</priority></url>' . "\n";
		foreach ( sml_seo_options_sitemap_tickers() as $ticker ) {
			/* Keep empty option shells out of discovery. The ingest stores each
			 * snapshot under a lowercase symbol and captured is written only after
			 * a successful chain calculation. URLs therefore join automatically as
			 * their first real dataset arrives. */
			$snapshot = get_option( 'sml_opt_snap_' . $ticker, null );
			if ( ! is_array( $snapshot ) || empty( $snapshot['captured'] ) ) {
				continue;
			}
			$items .= '<url><loc>' . $esc( home_url( '/options/' . rawurlencode( $ticker ) . '/' ) ) . '</loc><changefreq>daily</changefreq><priority>0.6</priority></url>' . "\n";
		}
		return str_replace( '</urlset>', $items . '</urlset>', $xml );
	}

	add_action( 'init', static function () {
		$path = function_exists( 'sml_seo_sitemap_path' ) ? sml_seo_sitemap_path() : '';
		if ( '/sml-hub-sitemap.xml' !== $path || is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) {
			return;
		}
		add_action( 'template_redirect', static function () {
			global $wp_query;
			if ( $wp_query ) { $wp_query->is_404 = false; }
			status_header( 200 );
			header( 'Content-Type: application/xml; charset=UTF-8' );
			nocache_headers();
			echo sml_seo_options_sitemap_xml(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			exit;
		}, -1 );
	}, 2 );
}
