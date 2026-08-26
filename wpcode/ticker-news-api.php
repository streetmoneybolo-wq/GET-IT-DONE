/**
 * SML Ticker News — the underlying stock's OWN coverage for the terminal.
 *
 *   GET /wp-json/sml-ticker-news/v1/feed?symbol=NVDA
 *
 * The terminal's News module called sml-members/v1/news-feed?symbol=…, but that
 * route ignores the symbol and returns the generic site feed — so Signal News
 * articles about the ticker being viewed never showed up. This route does what
 * the module always claimed: site articles (Signal News included) from the
 * last 21 days that mention the EXACT ticker ($SYM with a word boundary — the
 * same discipline the homepage rabbit-hole uses), newest first, capped at 12,
 * in the exact article shape the terminal already renders. `date_label` is
 * deliberately omitted so the client formats the ISO date in the viewer's own
 * timezone. Public content, 120s per-symbol cache.
 * Rollback: deactivate — the terminal auto-falls back to the legacy feed.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_tn_feed' ) ) {

	function sml_tn_feed( WP_REST_Request $request ) {
		$sym = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $request->get_param( 'symbol' ) ) );
		if ( '' === $sym || strlen( $sym ) > 8 ) {
			return new WP_Error( 'sml_tn_symbol', 'Pass a ticker symbol.', array( 'status' => 400 ) );
		}

		$ck     = 'sml_tn_' . $sym;
		$cached = get_transient( $ck );
		if ( is_array( $cached ) ) {
			$resp = rest_ensure_response( $cached );
			$resp->header( 'Cache-Control', 'public, max-age=120' );
			return $resp;
		}

		$q = new WP_Query( array(
			'post_type'           => 'post',
			'post_status'         => 'publish',
			's'                   => '$' . $sym,
			'posts_per_page'      => 30,
			'orderby'             => 'date',
			'order'               => 'DESC',
			'no_found_rows'       => true,
			'ignore_sticky_posts' => true,
			'date_query'          => array( array( 'after' => '21 days ago' ) ),
		) );

		$exact = '/\$' . preg_quote( $sym, '/' ) . '(?![A-Z0-9])/';
		$out   = array();
		foreach ( $q->posts as $post ) {
			$hay = $post->post_title . ' ' . $post->post_content;
			if ( ! preg_match( $exact, $hay ) ) { continue; }
			preg_match_all( '/\$([A-Z]{1,5})(?![A-Z0-9])/', $hay, $tk );
			$excerpt = $post->post_excerpt ? $post->post_excerpt : wp_trim_words( wp_strip_all_tags( $post->post_content ), 26 );
			$author  = get_userdata( (int) $post->post_author );
			$out[]   = array(
				'id'            => (int) $post->ID,
				'title'         => html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' ),
				'excerpt'       => wp_strip_all_tags( (string) $excerpt ),
				'url'           => get_permalink( $post ),
				'image'         => (string) get_the_post_thumbnail_url( $post, 'medium_large' ),
				'date'          => mysql2date( 'c', $post->post_date_gmt, false ),
				'author'        => $author ? $author->display_name : '',
				'categories'    => array_map( static function ( $t ) { return $t->name; }, (array) get_the_terms( $post, 'category' ) ?: array() ),
				'tickers'       => array_slice( array_values( array_unique( $tk[1] ) ), 0, 4 ),
				'comment_count' => (int) $post->comment_count,
			);
			if ( count( $out ) >= 12 ) { break; }
		}

		$body = array( 'ok' => true, 'symbol' => $sym, 'articles' => $out );
		set_transient( $ck, $body, 120 );
		$resp = rest_ensure_response( $body );
		$resp->header( 'Cache-Control', 'public, max-age=120' );
		return $resp;
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-ticker-news/v1', '/feed', array(
			'methods'             => 'GET',
			'callback'            => 'sml_tn_feed',
			'permission_callback' => '__return_true',
			'args'                => array( 'symbol' => array( 'required' => true, 'type' => 'string' ) ),
		) );
	} );
}
