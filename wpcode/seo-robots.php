/**
 * SML SEO — robots.txt addition: block raw REST responses from every crawler.
 * Part 6 of the entity-graph architecture. Deliberately minimal and additive —
 * appends one line to the site's existing robots.txt via the standard
 * `robots_txt` filter, touches nothing else.
 *
 * NOT added here (on purpose, see the architecture doc): `Disallow: /stock-chart/`.
 * That line is a Week-1 follow-up, only once the /stocks/{ticker}/ 301 (not
 * yet shipped — seo-ticker-augment.php only ships the Day-1 canonical tag so
 * far) is confirmed live. Disallowing the path before the redirect exists
 * would stop Google from ever discovering the redirect at all.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet — robots.txt returns to exactly what it
 * serves today.
 */
if ( ! function_exists( 'sml_seo_robots_txt' ) ) {
	function sml_seo_robots_txt( $output, $public ) {
		if ( ! $public ) { return $output; }
		if ( false === strpos( $output, '/wp-json/' ) ) {
			$output = rtrim( $output ) . "\n\n# Raw REST API responses are data, not pages — never a separate crawl target.\nDisallow: /wp-json/\n";
		}
		// Keep discovery in this same reliable robots filter. The sitemap snippet
		// also registers these lines defensively, but WPCode execution order and
		// full-page caching can otherwise publish the REST rule without the new
		// sitemap declarations during a staggered activation.
		if ( false === strpos( $output, 'sml-stocks-sitemap.xml' ) ) {
			$output = rtrim( $output ) . "\nSitemap: " . home_url( '/sml-stocks-sitemap.xml' )
				. "\nSitemap: " . home_url( '/sml-hub-sitemap.xml' ) . "\n";
		}
		return $output;
	}
	add_filter( 'robots_txt', 'sml_seo_robots_txt', 20, 2 );
}
