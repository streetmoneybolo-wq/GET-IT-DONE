/**
 * SML Live Watch — canonical per-room social cards.
 *
 * WPCode: PHP Snippet / Auto Insert / Run Everywhere.
 * Replace snippet #7358 with this file. Do not add an opening PHP tag.
 *
 * One record is the source of truth for the page and every crawler card:
 * title, description, canonical watch URL, and creator thumbnail/poster.
 * Rank Math's Facebook and Twitter emitters are replaced on room pages so
 * stale logo dimensions, MIME types, secure URLs, or duplicate image tags can
 * never compete with the stream thumbnail.
 */

if ( ! function_exists( 'sml_lsc_room_handle' ) ) {
	function sml_lsc_room_handle() {
		if ( empty( $_GET['room'] ) ) {
			return '';
		}
		$handle = sanitize_text_field( wp_unslash( (string) $_GET['room'] ) );
		return preg_match( '/^[A-Za-z0-9_-]{1,60}$/', $handle ) ? $handle : '';
	}

	function sml_lsc_is_room_page() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path = '/' . trim( strtolower( (string) strtok( $uri, '?' ) ), '/' ) . '/';
		return '/live/' === $path && '' !== sml_lsc_room_handle();
	}

	function sml_lsc_record() {
		static $record = null;
		if ( null !== $record ) {
			return $record;
		}
		$record = array();
		if ( ! sml_lsc_is_room_page()
			|| ! function_exists( 'sml_scheduled_live_user_for_handle' )
			|| ! function_exists( 'sml_scheduled_live_public_payload' ) ) {
			return $record;
		}

		$user = sml_scheduled_live_user_for_handle( sml_lsc_room_handle() );
		if ( ! $user || empty( $user->ID ) ) {
			return $record;
		}
		$payload = sml_scheduled_live_public_payload( absint( $user->ID ), false );
		if ( is_array( $payload ) ) {
			$record = $payload;
		}
		return $record;
	}

	/**
	 * Social networks reject very large animated GIFs. A poster listed here must
	 * be a still frame derived from that creator's exact stream thumbnail — never
	 * a site logo or an unrelated fallback. The watch page keeps the GIF itself.
	 */
	function sml_lsc_poster_attachments() {
		return array( 'grandmasterobi' => 7359 );
	}

	function sml_lsc_image() {
		$row = sml_lsc_record();
		$url = esc_url_raw( (string) ( $row['thumbnail_url'] ?? '' ) );
		if ( '' === $url || 0 !== strpos( $url, 'https://' ) ) {
			return array();
		}

		$attachment_id = attachment_url_to_postid( $url );
		if ( preg_match( '/\.gif(?:\?|$)/i', $url ) ) {
			$posters = sml_lsc_poster_attachments();
			$handle  = sml_lsc_room_handle();
			if ( ! empty( $posters[ $handle ] ) ) {
				$poster_url = wp_get_attachment_url( absint( $posters[ $handle ] ) );
				if ( $poster_url ) {
					$url           = esc_url_raw( $poster_url );
					$attachment_id = absint( $posters[ $handle ] );
				}
			}
		}

		$meta   = $attachment_id ? wp_get_attachment_metadata( $attachment_id ) : array();
		$mime   = $attachment_id ? get_post_mime_type( $attachment_id ) : '';
		$width  = absint( $meta['width'] ?? 0 );
		$height = absint( $meta['height'] ?? 0 );
		if ( ! $mime ) {
			$path = (string) wp_parse_url( $url, PHP_URL_PATH );
			$ext  = strtolower( pathinfo( $path, PATHINFO_EXTENSION ) );
			$mime = array( 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp' )[ $ext ] ?? '';
		}

		$row = sml_lsc_record();
		return array(
			'url'    => $url,
			'width'  => $width,
			'height' => $height,
			'mime'   => $mime,
			'alt'    => sanitize_text_field( (string) ( $row['title'] ?? 'StockMarketLoop live stream' ) ),
		);
	}

	function sml_lsc_values() {
		$row = sml_lsc_record();
		if ( empty( $row ) ) {
			return array();
		}
		$title       = sanitize_text_field( (string) ( $row['title'] ?? '' ) );
		$description = trim( wp_strip_all_tags( (string) ( $row['description'] ?? '' ) ) );
		$canonical   = esc_url_raw( (string) ( $row['watch_url'] ?? '' ) );
		if ( '' === $canonical ) {
			$canonical = home_url( '/live/?room=' . rawurlencode( sml_lsc_room_handle() ) );
		}
		if ( '' === $title || '' === $description ) {
			return array();
		}
		return array(
			'title'       => $title,
			'description' => $description,
			'canonical'   => $canonical,
			'image'       => sml_lsc_image(),
		);
	}

	function sml_lsc_meta_tag( $attribute, $name, $content ) {
		if ( '' === (string) $content ) {
			return;
		}
		echo '<meta ' . esc_attr( $attribute ) . '="' . esc_attr( $name ) . '" content="' . esc_attr( (string) $content ) . '">' . "\n";
	}

	function sml_lsc_emit_facebook() {
		$data = sml_lsc_values();
		if ( empty( $data ) ) {
			return;
		}
		$image = $data['image'];
		sml_lsc_meta_tag( 'property', 'og:type', 'video.other' );
		sml_lsc_meta_tag( 'property', 'og:site_name', get_bloginfo( 'name' ) );
		sml_lsc_meta_tag( 'property', 'og:title', $data['title'] );
		sml_lsc_meta_tag( 'property', 'og:description', $data['description'] );
		sml_lsc_meta_tag( 'property', 'og:url', $data['canonical'] );
		if ( ! empty( $image['url'] ) ) {
			sml_lsc_meta_tag( 'property', 'og:image', $image['url'] );
			sml_lsc_meta_tag( 'property', 'og:image:secure_url', $image['url'] );
			sml_lsc_meta_tag( 'property', 'og:image:type', $image['mime'] );
			sml_lsc_meta_tag( 'property', 'og:image:width', $image['width'] );
			sml_lsc_meta_tag( 'property', 'og:image:height', $image['height'] );
			sml_lsc_meta_tag( 'property', 'og:image:alt', $image['alt'] );
		}
	}

	function sml_lsc_emit_twitter() {
		$data = sml_lsc_values();
		if ( empty( $data ) ) {
			return;
		}
		$image = $data['image'];
		sml_lsc_meta_tag( 'name', 'twitter:card', 'summary_large_image' );
		sml_lsc_meta_tag( 'name', 'twitter:title', $data['title'] );
		sml_lsc_meta_tag( 'name', 'twitter:description', $data['description'] );
		if ( ! empty( $image['url'] ) ) {
			sml_lsc_meta_tag( 'name', 'twitter:image', $image['url'] );
			sml_lsc_meta_tag( 'name', 'twitter:image:alt', $image['alt'] );
		}
	}

	add_action( 'wp', function () {
		$data = sml_lsc_values();
		if ( empty( $data ) ) {
			return;
		}

		add_filter( 'rank_math/frontend/title', static function () use ( $data ) {
			return $data['title'];
		}, 99 );
		add_filter( 'rank_math/frontend/description', static function () use ( $data ) {
			return $data['description'];
		}, 99 );
		add_filter( 'rank_math/frontend/canonical', static function () use ( $data ) {
			return $data['canonical'];
		}, 99 );

		/* Replace, do not supplement, Rank Math's network tags. */
		remove_all_actions( 'rank_math/opengraph/facebook' );
		remove_all_actions( 'rank_math/opengraph/twitter' );
		add_action( 'rank_math/opengraph/facebook', 'sml_lsc_emit_facebook', 10 );
		add_action( 'rank_math/opengraph/twitter', 'sml_lsc_emit_twitter', 10 );
	}, 99 );
}
