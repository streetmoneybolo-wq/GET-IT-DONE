/**
 * SML SEO 5 — Groups + Channels sitemaps (the last uncovered content types).
 *
 *   /sml-groups-sitemap.xml     public trading groups   (/groups/{slug})
 *   /sml-channels-sitemap.xml   creator Loop Channels   (/channel/{handle}/)
 *
 * ENUMERATION (the missing piece this snippet adds), refreshed hourly by cron
 * and on demand:
 *   - groups: one front-door GET of the public /groups/ directory (the same
 *     rendered truth visitors see — storage-schema independent), slugs
 *     extracted, shadow-banned groups removed via sml_banned_group_slugs()
 *     when the loader exposes it. Keep-last-good: a failed or empty fetch
 *     never wipes the stored list.
 *   - channels: users carrying the sml_channel_handle meta (every channel
 *     page renders by default for a valid handle), capped at 500.
 * State: option sml_seo_social {groups, channels, updated} — render paths are
 * READ-ONLY per the SEO engine's architecture rules.
 *
 * Serving mirrors the proven entity-sitemap mechanics exactly (init@1 path
 * gate -> template_redirect@0 un-404 + emit + exit, which beats Rank Math's
 * -sitemap.xml interception), plus robots.txt discovery lines.
 * Ops: POST /wp-json/sml-seo-social/v1/refresh (admin) rebuilds now;
 *      GET  /wp-json/sml-seo-social/v1/status  (admin) shows counts + age.
 * Kill: deactivate the snippet (sitemaps 404, robots lines disappear).
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_ssoc_state' ) ) {

	function sml_ssoc_state() {
		$s = get_option( 'sml_seo_social', array() );
		return is_array( $s ) ? $s : array();
	}

	function sml_ssoc_refresh() {
		$state = sml_ssoc_state();

		/* groups: the rendered public directory is the truth */
		$res = wp_remote_get( home_url( '/groups/' ), array( 'timeout' => 4, 'limit_response_size' => 1048576 ) );
		if ( ! is_wp_error( $res ) && 200 === (int) wp_remote_retrieve_response_code( $res ) ) {
			$body = (string) wp_remote_retrieve_body( $res );
			preg_match_all( '~/groups/([a-z0-9\-]{2,60})["\'/]~i', $body, $m );
			$slugs = array_values( array_unique( array_map( 'strtolower', (array) $m[1] ) ) );
			if ( function_exists( 'sml_banned_group_slugs' ) ) {
				$ban   = array_map( 'strtolower', (array) sml_banned_group_slugs() );
				$slugs = array_values( array_diff( $slugs, $ban ) );
			}
			if ( $slugs ) { $state['groups'] = array_slice( $slugs, 0, 200 ); } /* keep-last-good on empty */
		}

		/* channels: users with a channel handle */
		$ids = get_users( array( 'meta_key' => 'sml_channel_handle', 'meta_compare' => 'EXISTS', 'fields' => 'ID', 'number' => 500 ) );
		$handles = array();
		foreach ( (array) $ids as $uid ) {
			$h = strtolower( (string) get_user_meta( (int) $uid, 'sml_channel_handle', true ) );
			$h = substr( preg_replace( '/[^a-z0-9_.]/', '', $h ), 0, 30 );
			if ( '' !== $h ) { $handles[ $h ] = 1; }
		}
		if ( $handles ) { $state['channels'] = array_slice( array_keys( $handles ), 0, 500 ); }

		$state['updated'] = time();
		update_option( 'sml_seo_social', $state, false );
		return $state;
	}

	add_action( 'init', static function () {
		if ( ! wp_next_scheduled( 'sml_seo_social_tick' ) && add_option( 'sml_ssoc_scheduled_v1', '1', '', false ) ) {
			wp_schedule_event( time() + 300, 'hourly', 'sml_seo_social_tick' );
		}
	}, 20 );
	add_action( 'sml_seo_social_tick', 'sml_ssoc_refresh' );

	function sml_ssoc_xml( $urls ) {
		$xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
		foreach ( $urls as $u ) {
			$xml .= '<url><loc>' . htmlspecialchars( $u, ENT_XML1 | ENT_QUOTES, 'UTF-8' ) . '</loc></url>';
		}
		return $xml . '</urlset>';
	}

	add_action( 'init', static function () {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
		if ( '/sml-groups-sitemap.xml' !== $path && '/sml-channels-sitemap.xml' !== $path ) { return; }
		if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return; }
		add_action( 'template_redirect', static function () use ( $path ) {
			global $wp_query;
			if ( $wp_query ) { $wp_query->is_404 = false; }
			status_header( 200 );
			header( 'Content-Type: application/xml; charset=UTF-8' );
			header( 'Cache-Control: public, max-age=900' );
			$state = sml_ssoc_state();
			if ( '/sml-groups-sitemap.xml' === $path ) {
				$urls = array_map( static function ( $s ) { return home_url( '/groups/' . $s ); }, (array) ( $state['groups'] ?? array() ) );
			} else {
				$urls = array_map( static function ( $h ) { return home_url( '/channel/' . $h . '/' ); }, (array) ( $state['channels'] ?? array() ) );
			}
			echo sml_ssoc_xml( $urls ); // phpcs:ignore
			exit;
		}, 0 );
	}, 1 );

	add_filter( 'robots_txt', static function ( $output, $public ) {
		if ( ! $public || false !== strpos( $output, 'sml-groups-sitemap.xml' ) ) { return $output; }
		return rtrim( $output ) . "\nSitemap: " . home_url( '/sml-groups-sitemap.xml' )
			. "\nSitemap: " . home_url( '/sml-channels-sitemap.xml' ) . "\n";
	}, 22, 2 );

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-seo-social/v1', '/refresh', array(
			'methods'             => 'POST',
			'callback'            => static function () {
				$s = sml_ssoc_refresh();
				return rest_ensure_response( array( 'ok' => true, 'groups' => count( (array) ( $s['groups'] ?? array() ) ), 'channels' => count( (array) ( $s['channels'] ?? array() ) ) ) );
			},
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
		) );
		register_rest_route( 'sml-seo-social/v1', '/status', array(
			'methods'             => 'GET',
			'callback'            => static function () {
				$s = sml_ssoc_state();
				return rest_ensure_response( array(
					'ok' => true,
					'groups' => count( (array) ( $s['groups'] ?? array() ) ),
					'channels' => count( (array) ( $s['channels'] ?? array() ) ),
					'age_s' => isset( $s['updated'] ) ? ( time() - (int) $s['updated'] ) : null,
					'next_cron_in_s' => ( $n = wp_next_scheduled( 'sml_seo_social_tick' ) ) ? ( $n - time() ) : null,
				) );
			},
			'permission_callback' => static function () { return current_user_can( 'manage_options' ); },
		) );
	} );
}
