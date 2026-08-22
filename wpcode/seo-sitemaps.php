/**
 * SML SEO — new sitemap files. Part 3 of the entity-graph architecture.
 * New URLs only — nothing here touches the existing /sml-sitemap.xml,
 * /sml-ticker-sitemap.xml, or Rank Math's /sitemap_index.xml. Discovery
 * happens via robots.txt Sitemap: lines, so no existing index needs editing.
 *
 * SCOPE, HONESTLY: this ships a bounded v1, not full-directory coverage —
 * see the two real gaps documented inline. Nothing here fakes coverage it
 * doesn't have.
 *   - /sml/v1/symbol-directory and /sml-scanner/v1/directory return the
 *     site's FULL exchange listing (thousands of tickers, most illiquid
 *     ETFs with zero real signal). Scoring every one through the Eligibility
 *     Engine (4 internal REST calls each) on every sitemap request is not
 *     viable synchronously. This ships a documented seed list of real,
 *     liquid, well-known tickers instead — matching Phase 1 of the
 *     architecture doc ("concentrate on top stocks, don't chase millions
 *     yet"). Expanding to the full directory needs a WP-Cron background job
 *     that pre-scores the full list on a schedule and stores the result —
 *     real, buildable, but a separate task from what ships here.
 *   - Groups and creator channels have NO enumeration endpoint at all today
 *     (groups/discover returns a handful of curated groups, not a full list;
 *     channel/letter handles are user meta with no list-all REST route). A
 *     groups/channels sitemap needs that endpoint built first — not
 *     attempted here rather than shipped against data that doesn't exist.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * Depends on wpcode/seo-ege-core.php (load before this one).
 * ROLLBACK: deactivate this snippet — both new URLs 404, robots.txt Sitemap:
 * lines become dead references (harmless; crawlers just get a 404 on them).
 */
if ( ! function_exists( 'sml_seo_sitemap_seed_tickers' ) ) {

	/** Documented v1 seed — real, liquid, well-known tickers. Expand via a
	 *  cron job against symbol-directory once that's built; this is not the
	 *  full market. */
	function sml_seo_sitemap_seed_tickers() {
		return array(
			'SPY', 'QQQ', 'DIA', 'IWM', 'SMH',
			'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'AVGO', 'AMD',
			'NFLX', 'ADBE', 'CRM', 'ORCL', 'CSCO', 'INTC', 'QCOM', 'TXN', 'AMAT', 'MU',
			'PLTR', 'SOFI', 'COIN', 'RBLX', 'SNAP', 'UBER', 'ABNB', 'SHOP', 'SQ', 'PYPL',
			'JPM', 'BAC', 'WFC', 'GS', 'MS', 'V', 'MA', 'AXP',
			'JNJ', 'PFE', 'UNH', 'LLY', 'ABBV', 'MRK',
			'XOM', 'CVX', 'COP',
			'WMT', 'COST', 'HD', 'NKE', 'MCD', 'SBUX', 'DIS',
			'BA', 'CAT', 'GE', 'F', 'GM',
			'T', 'VZ', 'TMUS',
		);
	}

	function sml_seo_sitemap_path() {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		return (string) wp_parse_url( $uri, PHP_URL_PATH );
	}

	function sml_seo_xml_head() { return '<?xml version="1.0" encoding="UTF-8"?>' . "\n"; }
	function sml_esc_xml( $s ) { return htmlspecialchars( (string) $s, ENT_XML1 | ENT_QUOTES, 'UTF-8' ); }

	function sml_seo_render_stocks_sitemap() {
		$cache_key = 'sml_seo_stocks_sitemap_xml';
		$cached = get_transient( $cache_key );
		if ( is_string( $cached ) ) { return $cached; }

		if ( ! function_exists( 'sml_ege_score_ticker' ) ) {
			// engine not loaded — fail closed: an empty-but-valid sitemap, never a broken one
			$xml = sml_seo_xml_head() . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
			set_transient( $cache_key, $xml, 15 * MINUTE_IN_SECONDS );
			return $xml;
		}

		$xml = sml_seo_xml_head() . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
		$included = 0; $skipped = array();
		foreach ( sml_seo_sitemap_seed_tickers() as $sym ) {
			$s = sml_ege_score_ticker( $sym );
			if ( ! $s['valid'] || ! in_array( $s['verdict'], array( 'index', 'selective' ), true ) ) {
				$skipped[] = $sym; continue;
			}
			$xml .= '<url><loc>' . sml_esc_xml( home_url( '/stocks/' . strtolower( $sym ) . '/' ) ) . '</loc>'
				. '<changefreq>hourly</changefreq><priority>' . ( 'index' === $s['verdict'] ? '0.8' : '0.5' ) . '</priority></url>' . "\n";
			$included++;
		}
		$xml .= "<!-- {$included} included, " . count( $skipped ) . ' skipped (below eligibility threshold or no live data): '
			. sml_esc_xml( implode( ',', $skipped ) ) . " -->\n";
		$xml .= '</urlset>';

		set_transient( $cache_key, $xml, 12 * HOUR_IN_SECONDS );
		return $xml;
	}

	function sml_seo_render_hub_sitemap() {
		// v1: /markets/ only — real, always-valid. Sector/theme hub URLs join once
		// their own routes exist and their backing data is confirmed broad enough
		// (see the architecture doc's Part 7 caution against shipping ahead of data).
		$xml = sml_seo_xml_head() . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
		$xml .= '<url><loc>' . sml_esc_xml( home_url( '/markets/' ) ) . '</loc><changefreq>daily</changefreq><priority>0.6</priority></url>' . "\n";
		$xml .= '</urlset>';
		return $xml;
	}

	add_action( 'init', static function () {
		$path = sml_seo_sitemap_path();
		if ( '/sml-stocks-sitemap.xml' !== $path && '/sml-hub-sitemap.xml' !== $path ) { return; }
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return; }

		add_action( 'template_redirect', static function () use ( $path ) {
			global $wp_query;
			if ( $wp_query ) { $wp_query->is_404 = false; }
			status_header( 200 );
			header( 'Content-Type: application/xml; charset=UTF-8' );
			nocache_headers();
			echo '/sml-stocks-sitemap.xml' === $path ? sml_seo_render_stocks_sitemap() : sml_seo_render_hub_sitemap(); // phpcs:ignore
			exit;
		}, 0 );
	}, 1 );

	// discovery: append both new files as robots.txt Sitemap: lines (additive,
	// doesn't touch the two existing Sitemap: lines already there)
	add_filter( 'robots_txt', static function ( $output, $public ) {
		if ( ! $public ) { return $output; }
		if ( false !== strpos( $output, 'sml-stocks-sitemap.xml' ) ) { return $output; }
		$output = rtrim( $output ) . "\nSitemap: " . home_url( '/sml-stocks-sitemap.xml' )
			. "\nSitemap: " . home_url( '/sml-hub-sitemap.xml' ) . "\n";
		return $output;
	}, 21, 2 );
}
