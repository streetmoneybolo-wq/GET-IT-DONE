/**
 * SML Public Cache Warmer (performance phase 9).
 * Hourly + after publishing a post, fetches a SHORT list of PUBLIC, cacheable
 * URLs (logged-out, no cookies) so edge/page caches stay warm: home, section
 * fronts, sitemaps, latest posts. Options/data pages are intentionally
 * EXCLUDED (they trigger metered market-data providers). Sequential with a
 * 300ms gap; 12-URL cap; results (path+status only) stored in an option.
 * Kill switch: add option sml_warmer_off = 1. ROLLBACK: deactivate snippet
 * (also clears its schedule on next admin load via missing hook).
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_warm_public_run' ) ) {

	function sml_warm_public_urls() {
		$urls = array(
			home_url( '/' ),
			home_url( '/markets/' ),
			home_url( '/live/' ),
			home_url( '/n/' ),
			home_url( '/sitemap_index.xml' ),
			home_url( '/news-sitemap.xml' ),
		);
		$posts = get_posts( array( 'numberposts' => 5, 'post_status' => 'publish', 'fields' => 'ids', 'no_found_rows' => true ) );
		foreach ( $posts as $pid ) { $urls[] = get_permalink( $pid ); }
		return array_slice( array_values( array_unique( array_filter( $urls ) ) ), 0, 12 );
	}

	function sml_warm_public_run() {
		if ( get_option( 'sml_warmer_off' ) ) { return; }
		$log = array( 't' => gmdate( 'c' ), 'results' => array() );
		foreach ( sml_warm_public_urls() as $u ) {
			$r = wp_remote_get( $u, array(
				'timeout'     => 8,
				'redirection' => 2,
				'user-agent'  => 'SML-Warmer/1.0 (public cache warm; no auth)',
				'headers'     => array( 'Accept' => 'text/html,application/xml' ),
			) );
			$log['results'][] = array(
				'u' => str_replace( home_url(), '', $u ),
				'c' => is_wp_error( $r ) ? 'err' : (int) wp_remote_retrieve_response_code( $r ),
			);
			usleep( 300000 );
		}
		update_option( 'sml_warmer_last', $log, false );
	}
	add_action( 'sml_warm_public', 'sml_warm_public_run' );

	add_action( 'init', static function () {
		if ( ! wp_next_scheduled( 'sml_warm_public' ) ) {
			wp_schedule_event( time() + 120, 'hourly', 'sml_warm_public' );
		}
	} );

	add_action( 'transition_post_status', static function ( $new_status, $old_status, $post ) {
		if ( 'publish' === $new_status && 'publish' !== $old_status && $post && 'post' === $post->post_type ) {
			wp_schedule_single_event( time() + 120, 'sml_warm_public' );
		}
	}, 10, 3 );

	/* read-only status (paths + HTTP codes only — nothing sensitive) */
	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-warm/v1', '/status', array(
			'methods'             => 'GET',
			'callback'            => static function () {
				return rest_ensure_response( array(
					'last' => get_option( 'sml_warmer_last', null ),
					'next' => ( $n = wp_next_scheduled( 'sml_warm_public' ) ) ? gmdate( 'c', $n ) : null,
					'off'  => (bool) get_option( 'sml_warmer_off' ),
				) );
			},
			'permission_callback' => '__return_true',
		) );
	} );
}
