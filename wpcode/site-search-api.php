/**
 * StockMarketLoop site-wide search — read-only aggregation endpoint.
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere.
 * Route: GET /wp-json/sml-site-search/v1/search?q=AMC
 *
 * This adapter does not create another content index. It searches the existing
 * ticker directory, video rail, published WordPress news, Loop Letter feed and
 * public member identities, then returns one stable response shape.
 */
if ( ! function_exists( 'sml_ss_clean_query' ) ) {
	function sml_ss_clean_query( $value ) {
		$value = trim( sanitize_text_field( wp_unslash( (string) $value ) ) );
		$value = preg_replace( '/\s+/', ' ', $value );
		return mb_substr( $value, 0, 64 );
	}

	function sml_ss_rest_data( $route, $params = array() ) {
		$request = new WP_REST_Request( 'GET', $route );
		foreach ( $params as $key => $value ) { $request->set_param( $key, $value ); }
		$response = rest_do_request( $request );
		if ( is_wp_error( $response ) || (int) $response->get_status() >= 400 ) { return array(); }
		$data = $response->get_data();
		return is_array( $data ) ? $data : array();
	}

	function sml_ss_text( $value ) {
		return trim( wp_strip_all_tags( html_entity_decode( (string) $value, ENT_QUOTES, get_bloginfo( 'charset' ) ) ) );
	}

	function sml_ss_member_handle( $user ) {
		if ( ! $user instanceof WP_User ) { return ''; }
		if ( function_exists( 'sml_members_public_handle' ) ) {
			$handle = sml_members_public_handle( $user->ID );
			if ( $handle ) { return sanitize_user( (string) $handle, true ); }
		}
		$handle = get_user_meta( $user->ID, 'sml_public_handle', true );
		return sanitize_user( $handle ? (string) $handle : (string) $user->user_nicename, true );
	}

	function sml_ss_people( $query, $limit = 8 ) {
		$found = array();
		$add = static function ( $users ) use ( &$found, $limit ) {
			foreach ( (array) $users as $user ) {
				if ( ! $user instanceof WP_User || isset( $found[ $user->ID ] ) || count( $found ) >= $limit ) { continue; }
				$handle = sml_ss_member_handle( $user );
				if ( '' === $handle ) { continue; }
				$found[ $user->ID ] = array(
					'id'     => (int) $user->ID,
					'name'   => (string) $user->display_name,
					'handle' => $handle,
					'avatar' => (string) get_avatar_url( $user->ID, array( 'size' => 96 ) ),
					'url'    => home_url( '/' . rawurlencode( $handle ) . '/' ),
				);
			}
		};

		$by_core = new WP_User_Query( array(
			'number'         => $limit,
			'count_total'    => false,
			'search'         => '*' . esc_attr( $query ) . '*',
			'search_columns' => array( 'user_login', 'user_nicename', 'display_name' ),
			'orderby'        => 'display_name',
			'order'          => 'ASC',
		) );
		$add( $by_core->get_results() );

		if ( count( $found ) < $limit ) {
			$by_handle = new WP_User_Query( array(
				'number'      => $limit,
				'count_total' => false,
				'meta_query'  => array(
					array( 'key' => 'sml_public_handle', 'value' => $query, 'compare' => 'LIKE' ),
				),
				'orderby'     => 'display_name',
				'order'       => 'ASC',
			) );
			$add( $by_handle->get_results() );
		}
		return array_values( $found );
	}

	function sml_ss_videos( $query, $symbol ) {
		$params = $symbol ? array( 'ticker' => $symbol ) : array();
		$data = sml_ss_rest_data( '/sml-video-upload-studio/v1/rail', $params );
		$rows = array_merge( isset( $data['related'] ) ? (array) $data['related'] : array(), isset( $data['up_next'] ) ? (array) $data['up_next'] : array() );
		$out = array();
		$needle = strtolower( $query );
		foreach ( $rows as $row ) {
			if ( ! is_array( $row ) ) { continue; }
			$id = isset( $row['id'] ) ? sanitize_key( $row['id'] ) : '';
			if ( '' === $id || isset( $out[ $id ] ) ) { continue; }
			$haystack = strtolower( implode( ' ', array_filter( array( $row['ticker'] ?? '', $row['title'] ?? '', $row['creator'] ?? '', $row['handle'] ?? '' ) ) ) );
			$exact_ticker = $symbol && strtoupper( (string) ( $row['ticker'] ?? '' ) ) === $symbol;
			if ( ! $exact_ticker && false === strpos( $haystack, $needle ) ) { continue; }
			$out[ $id ] = array(
				'id'        => $id,
				'title'     => sml_ss_text( $row['title'] ?? '' ),
				'url'       => esc_url_raw( $row['watch_url'] ?? home_url( '/watch/' . $id . '/' ) ),
				'thumbnail' => esc_url_raw( $row['thumbnail'] ?? '' ),
				'creator'   => sml_ss_text( $row['creator'] ?? '' ),
				'handle'    => sanitize_user( (string) ( $row['handle'] ?? '' ), true ),
				'ticker'    => strtoupper( sanitize_text_field( (string) ( $row['ticker'] ?? '' ) ) ),
				'views'     => sml_ss_text( $row['views_label'] ?? '' ),
				'age'       => sml_ss_text( $row['ago'] ?? '' ),
				'duration'  => sml_ss_text( $row['duration'] ?? '' ),
			);
			if ( count( $out ) >= 8 ) { break; }
		}
		return array_values( $out );
	}

	function sml_ss_news( $query ) {
		$posts = new WP_Query( array(
			'post_type'           => 'post',
			'post_status'         => 'publish',
			's'                   => $query,
			'posts_per_page'      => 8,
			'orderby'             => 'date',
			'order'               => 'DESC',
			'ignore_sticky_posts' => true,
			'no_found_rows'       => true,
		) );
		$out = array();
		foreach ( $posts->posts as $post ) {
			$out[] = array(
				'id'      => (int) $post->ID,
				'title'   => sml_ss_text( get_the_title( $post ) ),
				'url'     => get_permalink( $post ),
				'excerpt' => sml_ss_text( get_the_excerpt( $post ) ),
				'image'   => (string) get_the_post_thumbnail_url( $post, 'medium' ),
				'date'    => get_the_date( 'M j, Y', $post ),
			);
		}
		return $out;
	}

	function sml_ss_letters( $query, $symbol ) {
		$data = sml_ss_rest_data( '/sml-letters/v1/feed', array( 'q' => $query, 'search' => $query, 'ticker' => $symbol ) );
		$rows = isset( $data['letters'] ) ? (array) $data['letters'] : array();
		$out = array();
		foreach ( array_slice( $rows, 0, 8 ) as $row ) {
			if ( ! is_array( $row ) ) { continue; }
			$url = $row['url'] ?? ( $row['link'] ?? '' );
			if ( ! $url ) { continue; }
			$out[] = array(
				'id'      => (int) ( $row['id'] ?? 0 ),
				'title'   => sml_ss_text( $row['title'] ?? '' ),
				'url'     => esc_url_raw( $url ),
				'excerpt' => sml_ss_text( $row['excerpt'] ?? ( $row['summary'] ?? '' ) ),
				'author'  => sml_ss_text( $row['author'] ?? ( $row['name'] ?? '' ) ),
				'date'    => sml_ss_text( $row['date'] ?? '' ),
			);
		}
		return $out;
	}

	function sml_ss_search( WP_REST_Request $request ) {
		$query = sml_ss_clean_query( $request->get_param( 'q' ) );
		if ( mb_strlen( $query ) < 2 ) {
			return new WP_Error( 'sml_ss_short_query', 'Enter at least 2 characters.', array( 'status' => 400 ) );
		}
		$cache_key = 'sml_ss_' . md5( strtolower( $query ) );
		$cached = get_transient( $cache_key );
		if ( is_array( $cached ) ) { return rest_ensure_response( $cached ); }

		$symbol_candidate = strtoupper( ltrim( $query, '$' ) );
		$symbol_candidate = preg_match( '/^[A-Z][A-Z0-9.\-]{0,7}$/', $symbol_candidate ) ? $symbol_candidate : '';
		$ticker_data = sml_ss_rest_data( '/sml-members/v1/ticker-search', array( 'q' => $query ) );
		$quotes = isset( $ticker_data['results'] ) ? array_slice( (array) $ticker_data['results'], 0, 8 ) : array();
		$exact_symbol = '';
		foreach ( $quotes as $quote ) {
			if ( strtoupper( (string) ( $quote['symbol'] ?? '' ) ) === $symbol_candidate ) { $exact_symbol = $symbol_candidate; break; }
		}
		if ( ! $exact_symbol && ! empty( $quotes[0]['symbol'] ) ) { $exact_symbol = strtoupper( sanitize_text_field( (string) $quotes[0]['symbol'] ) ); }

		$result = array(
			'query'  => $query,
			'symbol' => $exact_symbol,
			'groups' => array(
				'quotes'  => $quotes,
				'videos'  => sml_ss_videos( $query, $symbol_candidate ),
				'news'    => sml_ss_news( $query ),
				'letters' => sml_ss_letters( $query, $symbol_candidate ),
				'people'  => sml_ss_people( $query ),
			),
		);
		set_transient( $cache_key, $result, MINUTE_IN_SECONDS );
		return rest_ensure_response( $result );
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-site-search/v1', '/search', array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'sml_ss_search',
			'permission_callback' => '__return_true',
			'args'                => array( 'q' => array( 'type' => 'string', 'required' => true ) ),
		) );
	} );
}
