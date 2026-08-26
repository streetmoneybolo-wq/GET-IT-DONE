/**
 * SML Grandmaster-OBI alert articles — permanent layout loader.
 *
 * WPCode: PHP Snippet, Auto Insert / Run Everywhere.
 * The loader is content-scoped: ordinary posts/pages never receive this CSS.
 */
if ( ! function_exists( 'sml_alert_article_is_layout_post' ) ) {
	function sml_alert_article_is_layout_post() {
		if ( is_admin() || ! is_singular( 'post' ) ) { return false; }
		$post = get_queried_object();
		if ( ! $post instanceof WP_Post ) { return false; }
		return false !== strpos( (string) $post->post_content, 'sml-alert-report' );
	}

	function sml_alert_article_layout_ref() {
		if ( function_exists( 'sml_cdn_resolve_ref' ) ) {
			$ref = (string) sml_cdn_resolve_ref();
			if ( '' !== $ref ) { return $ref; }
		}
		// Immutable fallback known to contain css/article-styles.css. The normal
		// path uses the site's resolver and follows the current verified release.
		return 'e6874ed815d2679d50b96622e4c9eb2d0ac58e00';
	}

	add_filter( 'body_class', function ( $classes ) {
		if ( sml_alert_article_is_layout_post() ) { $classes[] = 'sml-alert-article-page'; }
		return $classes;
	}, 20 );

	add_action( 'wp_enqueue_scripts', function () {
		if ( ! sml_alert_article_is_layout_post() ) { return; }
		wp_enqueue_style(
			'sml-alert-article-fonts',
			'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Space+Grotesk:wght@500;600;700&display=swap',
			array(),
			null
		);
		$ref = sml_alert_article_layout_ref();
		wp_enqueue_style(
			'sml-alert-article-layout',
			'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( $ref ) . '/css/article-styles.css',
			array( 'sml-alert-article-fonts' ),
			$ref
		);
		wp_enqueue_script(
			'sml-alert-article-market-pulse',
			'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( $ref ) . '/js/article-market-pulse.js',
			array(),
			$ref,
			true
		);
	}, 40 );
}
