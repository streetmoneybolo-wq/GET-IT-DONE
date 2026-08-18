/**
 * SML Loop Channel — public creator-scoped content API.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * Route: GET /wp-json/sml-channel/v1/channel/{handle}
 *
 * This is intentionally a read-only adapter over existing stores. It does not
 * create a second video or post database and it never exposes non-public video
 * visibility states.
 */
if ( ! function_exists( 'sml_channel_clean_handle' ) ) {
	function sml_channel_clean_handle( $handle ) {
		if ( function_exists( 'sml_members_clean_public_handle' ) ) {
			return sml_members_clean_public_handle( $handle );
		}
		$handle = strtolower( ltrim( sanitize_text_field( (string) $handle ), '@' ) );
		return substr( preg_replace( '/[^a-z0-9_.]/', '', $handle ), 0, 30 );
	}

	function sml_channel_user_by_handle( $handle ) {
		$handle = sml_channel_clean_handle( $handle );
		if ( '' === $handle ) { return false; }
		$query = new WP_User_Query(
			array(
				'number'     => 1,
				'count_total'=> false,
				'meta_key'   => 'sml_channel_handle',
				'meta_value' => $handle,
			)
		);
		$users = $query->get_results();
		return ! empty( $users[0] ) ? $users[0] : false;
	}

	function sml_channel_handle_for_user( $user_id ) {
		return sml_channel_clean_handle( get_user_meta( $user_id, 'sml_channel_handle', true ) );
	}

	function sml_channel_profile_handle_for_user( $user_id ) {
		if ( function_exists( 'sml_members_public_handle' ) ) {
			return sml_members_public_handle( $user_id );
		}
		$public = get_user_meta( $user_id, 'sml_public_handle', true );
		if ( $public ) { return sml_channel_clean_handle( $public ); }
		$user = get_userdata( $user_id );
		return $user ? sml_channel_clean_handle( $user->user_nicename ?: $user->user_login ) : '';
	}

	function sml_channel_profile_handle_owner( $handle ) {
		$handle = sml_channel_clean_handle( $handle );
		if ( '' === $handle ) { return false; }
		$query = new WP_User_Query( array(
			'number' => 1, 'count_total' => false,
			'meta_key' => 'sml_public_handle', 'meta_value' => $handle,
		) );
		$users = $query->get_results();
		if ( ! empty( $users[0] ) ) { return $users[0]; }
		$user = get_user_by( 'slug', $handle );
		if ( ! $user ) { $user = get_user_by( 'login', $handle ); }
		return $user ?: false;
	}

	function sml_channel_profile_handle_available( $handle ) {
		$handle = sml_channel_clean_handle( $handle );
		if ( '' === $handle ) { return false; }
		$ask = static function () use ( $handle ) {
			$check = new WP_REST_Request( 'GET', '/sml-members/v1/handle-availability' );
			$check->set_param( 'handle', $handle );
			$check->set_param( '_sml_channel_namespace_check', 1 );
			return rest_do_request( $check );
		};
		$result = $ask();
		if ( ! is_wp_error( $result ) && 403 === (int) $result->get_status() ) {
			$data = (array) $result->get_data();
			if ( isset( $data['code'] ) && 'sml_handle_locked' === $data['code'] ) {
				/* FIX 2026-08-18: for every signed-in member the profile service answers
				   403 "Handles are locked after signup" — a statement about the CALLER's
				   own profile handle, not about the handle being asked about. Failing
				   closed on it made EVERY channel handle read as taken, site-wide, so no
				   creator could ever claim one (and the Creator Gate then locked them all
				   out of Go Live / Upload). Ask again exactly the way signup does —
				   anonymously — so the real availability rules answer. Any other error
				   still fails closed. */
				$uid = get_current_user_id();
				wp_set_current_user( 0 );
				try { $result = $ask(); } finally { wp_set_current_user( $uid ); }
			}
		}
		if ( is_wp_error( $result ) || $result->get_status() >= 400 ) { return false; }
		$data = (array) $result->get_data();
		if ( array_key_exists( 'available', $data ) ) { return (bool) $data['available']; }
		if ( array_key_exists( 'is_available', $data ) ) { return (bool) $data['is_available']; }
		return ! sml_channel_profile_handle_owner( $handle );
	}

	function sml_channel_handle_available( $handle, $user_id = 0 ) {
		$handle = sml_channel_clean_handle( $handle );
		if ( '' === $handle ) { return false; }
		/* The two namespaces are intentionally disjoint, including for one user. */
		if ( ! sml_channel_profile_handle_available( $handle ) ) { return false; }
		$owner = sml_channel_user_by_handle( $handle );
		return ! $owner || (int) $owner->ID === (int) $user_id;
	}

	function sml_channel_iso_date( $value ) {
		$time = is_numeric( $value ) ? (int) $value : strtotime( (string) $value );
		return $time ? gmdate( 'c', $time ) : '';
	}

	function sml_channel_video_card( $video, $creator, $handle ) {
		$id = isset( $video['id'] ) ? sanitize_key( $video['id'] ) : '';
		if ( '' === $id ) { return null; }
		$watch_url = isset( $video['watch_url'] ) ? esc_url_raw( $video['watch_url'] ) : '';
		if ( '' === $watch_url ) { $watch_url = home_url( '/watch/' . rawurlencode( $id ) . '/' ); }
		$views = isset( $video['views'] ) ? max( 0, (int) $video['views'] ) : 0;
		$duration = isset( $video['duration'] ) ? max( 0, (int) $video['duration'] ) : 0;
		$created = isset( $video['created_at'] ) ? sml_channel_iso_date( $video['created_at'] ) : '';
		return array(
			'id'          => $id,
			'title'       => sanitize_text_field( isset( $video['title'] ) ? $video['title'] : '' ),
			'description' => wp_strip_all_tags( isset( $video['description'] ) ? $video['description'] : '' ),
			'watch_url'   => $watch_url,
			'thumbnail'   => esc_url_raw( isset( $video['thumbnail_url'] ) ? $video['thumbnail_url'] : '' ),
			'creator'     => $creator,
			'handle'      => $handle,
			'ticker'      => sanitize_text_field( isset( $video['ticker'] ) ? $video['ticker'] : '' ),
			'views'       => $views,
			'views_label' => number_format_i18n( $views ) . ' views',
			'duration'    => function_exists( 'sml_vus_duration_label' ) ? sml_vus_duration_label( $duration ) : ( $duration ? gmdate( $duration >= 3600 ? 'G:i:s' : 'i:s', $duration ) : '' ),
			'created_at'  => $created,
		);
	}

	function sml_channel_videos( $user_id, $creator, $handle ) {
		$library = function_exists( 'sml_video_upload_studio_library' ) ? sml_video_upload_studio_library() : get_option( 'sml_video_upload_studio_library', array() );
		if ( ! is_array( $library ) ) { return array(); }
		$rows = array();
		foreach ( $library as $video ) {
			if ( ! is_array( $video ) || (int) ( $video['author_id'] ?? 0 ) !== (int) $user_id ) { continue; }
			if ( 'public' !== strtolower( (string) ( $video['visibility'] ?? '' ) ) ) { continue; }
			if ( ! empty( $video['schedule_at'] ) && strtotime( (string) $video['schedule_at'] ) > current_time( 'timestamp', true ) ) { continue; }
			$card = sml_channel_video_card( $video, $creator, $handle );
			if ( $card ) { $rows[] = $card; }
		}
		usort( $rows, static function ( $a, $b ) { return strcmp( (string) $b['created_at'], (string) $a['created_at'] ); } );
		return array_slice( $rows, 0, 100 );
	}

	function sml_channel_wp_posts( $user_id ) {
		$types = array( 'post' );
		foreach ( array( 'sml_video', 'sml_alert', 'sml_question', 'sml_group_post', 'sml_chart_post', 'sml_live_stream', 'sml_news' ) as $type ) {
			if ( post_type_exists( $type ) ) { $types[] = $type; }
		}
		$q = new WP_Query( array( 'post_type' => $types, 'post_status' => 'publish', 'author' => (int) $user_id, 'posts_per_page' => 20, 'orderby' => 'date', 'order' => 'DESC', 'no_found_rows' => true ) );
		$rows = array();
		foreach ( $q->posts as $post ) {
			$rows[] = array(
				'id'      => 'wp-' . $post->ID,
				'kind'    => $post->post_type,
				'title'   => get_the_title( $post ),
				'body'    => wp_strip_all_tags( get_the_excerpt( $post ) ?: wp_trim_words( $post->post_content, 48 ) ),
				'url'     => get_permalink( $post ),
				'date'    => get_post_time( 'c', true, $post ),
				'image'   => get_the_post_thumbnail_url( $post, 'large' ) ?: '',
				'tickers' => function_exists( 'sml_sth_symbols' ) ? sml_sth_symbols( $post->post_title . ' ' . $post->post_content ) : array(),
				'metrics' => function_exists( 'sml_sth_metric' ) ? sml_sth_metric( $post->ID ) : array(),
			);
		}
		return $rows;
	}

	function sml_channel_member_posts( $user_id ) {
		$rows = array();
		if ( function_exists( 'sml_members_profile_chart_posts' ) ) {
			foreach ( (array) sml_members_profile_chart_posts( $user_id, 20 ) as $post ) {
				$rows[] = array(
					'id' => 'chart-' . sanitize_key( (string) ( $post['id'] ?? '' ) ), 'kind' => 'chart_post',
					'title' => '', 'body' => wp_strip_all_tags( (string) ( $post['text'] ?? '' ) ), 'url' => esc_url_raw( (string) ( $post['url'] ?? '' ) ),
					'date' => sml_channel_iso_date( $post['date'] ?? '' ), 'image' => esc_url_raw( (string) ( $post['image'] ?? $post['chart_url'] ?? '' ) ),
					'tickers' => array_values( array_filter( array_map( 'sanitize_text_field', (array) ( $post['tickers'] ?? array() ) ) ) ),
					'metrics' => array( 'likes' => max( 0, (int) ( $post['like_count'] ?? 0 ) ) ),
				);
			}
		}
		if ( function_exists( 'sml_members_user_stream_posts' ) ) {
			foreach ( (array) sml_members_user_stream_posts( $user_id, 20 ) as $post ) {
				$tickers = array_values( array_filter( array_map( 'sanitize_text_field', (array) ( $post['tickers'] ?? array() ) ) ) );
				$url = ! empty( $post['url'] ) ? esc_url_raw( $post['url'] ) : ( ! empty( $tickers[0] ) ? home_url( '/stock-chart/?symbol=' . rawurlencode( $tickers[0] ) . '#comments' ) : '' );
				$rows[] = array(
					'id' => 'stream-' . sanitize_key( (string) ( $post['id'] ?? $post['comment_ID'] ?? '' ) ), 'kind' => 'stream_post',
					'title' => '', 'body' => wp_strip_all_tags( (string) ( $post['text'] ?? $post['body'] ?? $post['comment_content'] ?? '' ) ),
					'url' => $url, 'date' => sml_channel_iso_date( $post['date'] ?? $post['comment_date_gmt'] ?? '' ),
					'image' => esc_url_raw( (string) ( $post['image'] ?? '' ) ), 'tickers' => $tickers,
					'metrics' => array( 'likes' => max( 0, (int) ( $post['like_count'] ?? 0 ) ) ),
				);
			}
		}
		return $rows;
	}

	function sml_channel_posts( $user_id ) {
		$rows = array_merge( sml_channel_wp_posts( $user_id ), sml_channel_member_posts( $user_id ) );
		$seen = array();
		$rows = array_values( array_filter( $rows, static function ( $row ) use ( &$seen ) {
			$key = (string) ( $row['id'] ?? '' );
			if ( '' === $key || isset( $seen[ $key ] ) ) { return false; }
			$seen[ $key ] = true; return true;
		} ) );
		usort( $rows, static function ( $a, $b ) { return strcmp( (string) ( $b['date'] ?? '' ), (string) ( $a['date'] ?? '' ) ); } );
		return array_slice( $rows, 0, 20 );
	}

	/* ---------- channel appearance + profile (the "Loop Channel" design is the
	   default layout for EVERY channel; the creator's own theme/images/links are
	   stored per user and served to every viewer). Storage:
	     sml_channel_name / _tagline / _about / _links / _avatar_id / _banner_id /
	     _created_at  — written by /create-channel/ (create-channel-api.php)
	     sml_channel_settings — array: accent, font, aff (2 x {label,url}),
	                            home_group {url,name}, moderation {role,mods,words,links}
	     sml_channel_{backdrop|aff1|aff2|group}_id — attachment ids (media route below) */
	function sml_channel_accents() { return array( '#00ff88', '#00ccff', '#ffd166', '#ff6b4a', '#673aff', '#ff2e66', '#7affc0', '#4c9eff' ); }
	function sml_channel_fonts() { return array( 'Archivo', 'Space Grotesk', 'Rajdhani', 'Orbitron', 'Exo 2', 'Chakra Petch', 'Oxanium', 'Sora', 'Manrope', 'Outfit', 'Barlow', 'Saira', 'Kanit', 'Play', 'Syne', 'Unbounded', 'Michroma', 'Audiowide' ); }
	function sml_channel_media_kinds() { return array( 'avatar', 'banner', 'backdrop', 'aff1', 'aff2', 'group' ); }
	function sml_channel_media_url( $id, $size = 'large' ) {
		$id = (int) $id; if ( ! $id ) { return ''; }
		$u = wp_get_attachment_image_url( $id, $size );
		return $u ? $u : (string) wp_get_attachment_url( $id );
	}
	function sml_channel_settings( $user_id ) {
		$s = get_user_meta( $user_id, 'sml_channel_settings', true );
		$s = is_array( $s ) ? $s : array();
		$aff = isset( $s['aff'] ) && is_array( $s['aff'] ) ? $s['aff'] : array();
		$mod = isset( $s['moderation'] ) && is_array( $s['moderation'] ) ? $s['moderation'] : array();
		$hg  = isset( $s['home_group'] ) && is_array( $s['home_group'] ) ? $s['home_group'] : array();
		return array(
			'accent'     => ( isset( $s['accent'] ) && in_array( $s['accent'], sml_channel_accents(), true ) ) ? $s['accent'] : '#00ff88',
			'font'       => ( isset( $s['font'] ) && in_array( $s['font'], sml_channel_fonts(), true ) ) ? $s['font'] : 'Archivo',
			'aff'        => array(
				array( 'label' => (string) ( $aff[0]['label'] ?? '' ), 'url' => (string) ( $aff[0]['url'] ?? '' ), 'image' => sml_channel_media_url( get_user_meta( $user_id, 'sml_channel_aff1_id', true ) ) ),
				array( 'label' => (string) ( $aff[1]['label'] ?? '' ), 'url' => (string) ( $aff[1]['url'] ?? '' ), 'image' => sml_channel_media_url( get_user_meta( $user_id, 'sml_channel_aff2_id', true ) ) ),
			),
			'home_group' => array( 'url' => (string) ( $hg['url'] ?? '' ), 'name' => (string) ( $hg['name'] ?? '' ), 'members' => (string) ( $hg['members'] ?? '' ), 'image' => sml_channel_media_url( get_user_meta( $user_id, 'sml_channel_group_id', true ) ) ),
			'moderation' => array(
				'role'  => (string) ( $mod['role'] ?? 'Mod' ),
				'mods'  => array_values( array_map( 'strval', (array) ( $mod['mods'] ?? array() ) ) ),
				'words' => array_values( array_map( 'strval', (array) ( $mod['words'] ?? array() ) ) ),
				'links' => array_values( array_map( 'strval', (array) ( $mod['links'] ?? array() ) ) ),
			),
		);
	}
	function sml_channel_profile( $user ) {
		$links = get_user_meta( $user->ID, 'sml_channel_links', true );
		$links = is_array( $links ) ? $links : array();
		return array(
			'name'       => (string) ( get_user_meta( $user->ID, 'sml_channel_name', true ) ?: $user->display_name ),
			'tagline'    => (string) get_user_meta( $user->ID, 'sml_channel_tagline', true ),
			'about'      => (string) get_user_meta( $user->ID, 'sml_channel_about', true ),
			'links'      => array( 'site' => (string) ( $links['site'] ?? '' ), 'x' => (string) ( $links['x'] ?? '' ), 'youtube' => (string) ( $links['youtube'] ?? '' ) ),
			'avatar'     => sml_channel_media_url( get_user_meta( $user->ID, 'sml_channel_avatar_id', true ), 'medium' ),
			'banner'     => sml_channel_media_url( get_user_meta( $user->ID, 'sml_channel_banner_id', true ) ),
			'backdrop'   => sml_channel_media_url( get_user_meta( $user->ID, 'sml_channel_backdrop_id', true ) ),
			'created_at' => (string) get_user_meta( $user->ID, 'sml_channel_created_at', true ),
		);
	}

	function sml_channel_rest_get( WP_REST_Request $request ) {
		$user = sml_channel_user_by_handle( $request['handle'] );
		if ( ! $user ) { return new WP_Error( 'sml_channel_not_found', 'Creator not found.', array( 'status' => 404 ) ); }
		$handle = sml_channel_handle_for_user( $user->ID );
		$profile_handle = sml_channel_profile_handle_for_user( $user->ID );
		$creator = $user->display_name;
		$videos = sml_channel_videos( $user->ID, $creator, $handle );
		$posts = sml_channel_posts( $user->ID );
		$owner = get_current_user_id() && (int) get_current_user_id() === (int) $user->ID;
		$settings = sml_channel_settings( $user->ID );
		if ( ! $owner ) { unset( $settings['moderation'] ); } /* mod config is creator-only */
		return rest_ensure_response( array(
			'creator' => array( 'id' => (int) $user->ID, 'name' => $creator, 'handle' => $handle, 'profile_handle' => $profile_handle ),
			'owner'   => (bool) $owner,
			'profile' => sml_channel_profile( $user ),
			'appearance' => $settings,
			'stats' => array( 'videos' => count( $videos ), 'views' => array_sum( wp_list_pluck( $videos, 'views' ) ), 'posts' => count( $posts ) ),
			'videos' => $videos,
			'posts' => $posts,
		) );
	}

	/* owner-only: the caller must currently own a channel handle */
	function sml_channel_owner_uid() {
		$uid = get_current_user_id();
		if ( ! $uid ) { return 0; }
		return '' !== sml_channel_handle_for_user( $uid ) ? $uid : 0;
	}
	function sml_channel_rest_save_settings( WP_REST_Request $request ) {
		$uid = sml_channel_owner_uid();
		if ( ! $uid ) { return new WP_Error( 'sml_channel_no_channel', 'Create a Loop Channel first.', array( 'status' => 403 ) ); }
		$cur = get_user_meta( $uid, 'sml_channel_settings', true ); $cur = is_array( $cur ) ? $cur : array();
		$p = $request->get_json_params(); $p = is_array( $p ) ? $p : array();

		if ( array_key_exists( 'accent', $p ) ) { $a = (string) $p['accent']; if ( in_array( $a, sml_channel_accents(), true ) ) { $cur['accent'] = $a; } }
		if ( array_key_exists( 'font', $p ) ) { $f = (string) $p['font']; if ( in_array( $f, sml_channel_fonts(), true ) ) { $cur['font'] = $f; } }
		if ( array_key_exists( 'aff', $p ) && is_array( $p['aff'] ) ) {
			$aff = array();
			for ( $i = 0; $i < 2; $i++ ) {
				$row = isset( $p['aff'][ $i ] ) && is_array( $p['aff'][ $i ] ) ? $p['aff'][ $i ] : array();
				$url = isset( $row['url'] ) ? esc_url_raw( (string) $row['url'], array( 'http', 'https' ) ) : '';
				$aff[] = array( 'label' => mb_substr( sanitize_text_field( (string) ( $row['label'] ?? '' ) ), 0, 80 ), 'url' => $url );
			}
			$cur['aff'] = $aff;
		}
		if ( array_key_exists( 'home_group', $p ) && is_array( $p['home_group'] ) ) {
			$hg = $p['home_group'];
			$url = isset( $hg['url'] ) ? (string) $hg['url'] : '';
			if ( '' !== $url && ! preg_match( '#^https?://#i', $url ) ) { $url = home_url( '/' . ltrim( $url, '/' ) ); }
			$cur['home_group'] = array( 'url' => esc_url_raw( $url, array( 'http', 'https' ) ), 'name' => mb_substr( sanitize_text_field( (string) ( $hg['name'] ?? '' ) ), 0, 60 ), 'members' => mb_substr( sanitize_text_field( (string) ( $hg['members'] ?? '' ) ), 0, 20 ) );
		}
		if ( array_key_exists( 'moderation', $p ) && is_array( $p['moderation'] ) ) {
			$m = $p['moderation'];
			$list = static function ( $v, $max, $len ) { $out = array(); foreach ( (array) $v as $x ) { $x = mb_substr( sanitize_text_field( (string) $x ), 0, $len ); if ( '' !== $x ) { $out[] = $x; } if ( count( $out ) >= $max ) { break; } } return array_values( array_unique( $out ) ); };
			$cur['moderation'] = array(
				'role'  => mb_substr( sanitize_text_field( (string) ( $m['role'] ?? 'Mod' ) ), 0, 30 ) ?: 'Mod',
				'mods'  => $list( $m['mods'] ?? array(), 50, 40 ),
				'words' => $list( $m['words'] ?? array(), 200, 60 ),
				'links' => $list( $m['links'] ?? array(), 200, 100 ),
			);
		}
		update_user_meta( $uid, 'sml_channel_settings', $cur );

		/* profile text fields share storage with /create-channel/ */
		if ( array_key_exists( 'name', $p ) ) { $n = mb_substr( sanitize_text_field( (string) $p['name'] ), 0, 60 ); if ( '' !== $n ) { update_user_meta( $uid, 'sml_channel_name', $n ); } }
		if ( array_key_exists( 'tagline', $p ) ) { update_user_meta( $uid, 'sml_channel_tagline', mb_substr( sanitize_text_field( (string) $p['tagline'] ), 0, 120 ) ); }
		if ( array_key_exists( 'about', $p ) ) { update_user_meta( $uid, 'sml_channel_about', mb_substr( sanitize_textarea_field( (string) $p['about'] ), 0, 600 ) ); }
		if ( array_key_exists( 'links', $p ) && is_array( $p['links'] ) ) {
			$links = array();
			foreach ( array( 'site', 'x', 'youtube' ) as $k ) {
				$v = isset( $p['links'][ $k ] ) ? trim( (string) $p['links'][ $k ] ) : '';
				if ( '' === $v ) { continue; }
				$links[ $k ] = preg_match( '#^https?://#i', $v ) ? esc_url_raw( $v, array( 'http', 'https' ) ) : mb_substr( sanitize_text_field( $v ), 0, 120 );
			}
			update_user_meta( $uid, 'sml_channel_links', $links );
		}
		$user = get_userdata( $uid );
		return rest_ensure_response( array( 'ok' => true, 'appearance' => sml_channel_settings( $uid ), 'profile' => sml_channel_profile( $user ) ) );
	}

	/* POST multipart {file, kind} or JSON {kind, remove:true}. GIFs allowed (design: "GIFs autoplay"). */
	function sml_channel_rest_media( WP_REST_Request $request ) {
		$uid = sml_channel_owner_uid();
		if ( ! $uid ) { return new WP_Error( 'sml_channel_no_channel', 'Create a Loop Channel first.', array( 'status' => 403 ) ); }
		$kind = sanitize_key( (string) $request->get_param( 'kind' ) );
		if ( ! in_array( $kind, sml_channel_media_kinds(), true ) ) { return new WP_Error( 'sml_channel_bad_kind', 'Unknown image slot.', array( 'status' => 400 ) ); }
		$meta_key = 'sml_channel_' . $kind . '_id';
		if ( $request->get_param( 'remove' ) ) {
			delete_user_meta( $uid, $meta_key );
			return rest_ensure_response( array( 'ok' => true, 'kind' => $kind, 'url' => '' ) );
		}
		$files = $request->get_file_params();
		if ( empty( $files['file'] ) ) { return new WP_Error( 'sml_channel_no_file', 'Choose an image.', array( 'status' => 400 ) ); }
		if ( (int) ( $files['file']['size'] ?? 0 ) > 8 * 1024 * 1024 ) { return new WP_Error( 'sml_channel_too_big', 'Keep images under 8 MB.', array( 'status' => 413 ) ); }
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$id = media_handle_upload( 'file', 0, array( 'post_title' => 'Loop Channel ' . $kind ), array( 'test_form' => false, 'mimes' => array( 'jpg|jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif' ) ) );
		if ( is_wp_error( $id ) ) { return new WP_Error( 'sml_channel_upload_failed', $id->get_error_message(), array( 'status' => 400 ) ); }
		update_user_meta( $uid, $meta_key, (int) $id );
		return rest_ensure_response( array( 'ok' => true, 'kind' => $kind, 'id' => (int) $id, 'url' => sml_channel_media_url( $id, 'avatar' === $kind ? 'medium' : 'large' ) ) );
	}

	function sml_channel_rest_handle_availability( WP_REST_Request $request ) {
		$handle = sml_channel_clean_handle( $request->get_param( 'handle' ) );
		if ( '' === $handle ) { return new WP_Error( 'sml_channel_invalid_handle', 'Enter a valid channel handle.', array( 'status' => 400 ) ); }
		$available = sml_channel_handle_available( $handle, get_current_user_id() );
		return rest_ensure_response( array( 'handle' => $handle, 'available' => $available, 'is_available' => $available ) );
	}

	function sml_channel_rest_save_handle( WP_REST_Request $request ) {
		$user_id = get_current_user_id();
		$raw = (string) $request->get_param( 'handle' );
		$handle = sml_channel_clean_handle( $raw );
		if ( '' === trim( $raw ) ) {
			delete_user_meta( $user_id, 'sml_channel_handle' );
			return rest_ensure_response( array( 'saved' => true, 'enabled' => false, 'handle' => '', 'url' => '' ) );
		}
		if ( '' === $handle || $handle !== strtolower( ltrim( trim( $raw ), '@' ) ) ) {
			return new WP_Error( 'sml_channel_invalid_handle', 'Use only letters, numbers, underscores, or periods.', array( 'status' => 400 ) );
		}
		if ( ! sml_channel_handle_available( $handle, $user_id ) ) {
			return new WP_Error( 'sml_channel_handle_taken', 'That handle is unavailable in the channel or profile namespace.', array( 'status' => 409 ) );
		}
		update_user_meta( $user_id, 'sml_channel_handle', $handle );
		return rest_ensure_response( array( 'saved' => true, 'enabled' => true, 'handle' => $handle, 'url' => home_url( '/channel/' . rawurlencode( $handle ) . '/' ) ) );
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-channel/v1', '/channel/(?P<handle>[a-zA-Z0-9_.]+)', array(
			'methods' => WP_REST_Server::READABLE, 'callback' => 'sml_channel_rest_get', 'permission_callback' => '__return_true',
			'args' => array( 'handle' => array( 'required' => true, 'sanitize_callback' => 'sml_channel_clean_handle' ) ),
		) );
		register_rest_route( 'sml-channel/v1', '/handle-availability', array(
			'methods' => WP_REST_Server::READABLE, 'callback' => 'sml_channel_rest_handle_availability',
			'permission_callback' => 'is_user_logged_in',
			'args' => array( 'handle' => array( 'required' => true, 'sanitize_callback' => 'sml_channel_clean_handle' ) ),
		) );
		register_rest_route( 'sml-channel/v1', '/handle', array(
			'methods' => WP_REST_Server::CREATABLE, 'callback' => 'sml_channel_rest_save_handle',
			'permission_callback' => 'is_user_logged_in',
		) );
		register_rest_route( 'sml-channel/v1', '/settings', array(
			'methods' => WP_REST_Server::CREATABLE, 'callback' => 'sml_channel_rest_save_settings',
			'permission_callback' => 'is_user_logged_in',
		) );
		register_rest_route( 'sml-channel/v1', '/media', array(
			'methods' => WP_REST_Server::CREATABLE, 'callback' => 'sml_channel_rest_media',
			'permission_callback' => 'is_user_logged_in',
		) );
	} );

	/* Keep the existing profile-handle availability response aware of opted-in
	 * channel handles, so a future profile claim cannot create a collision. */
	add_filter( 'rest_post_dispatch', static function ( $response, $server, $request ) {
		if ( 0 === strpos( $request->get_route(), '/sml-channel/v1/' ) ) {
			$response = rest_ensure_response( $response );
			$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
			$response->header( 'Pragma', 'no-cache' );
		}
		if ( '/sml-members/v1/handle-availability' !== $request->get_route() ) { return $response; }
		if ( $request->get_param( '_sml_channel_namespace_check' ) ) { return $response; }
		$handle = sml_channel_clean_handle( $request->get_param( 'handle' ) );
		if ( '' === $handle || ! sml_channel_user_by_handle( $handle ) ) { return $response; }
		$response = rest_ensure_response( $response );
		$data = (array) $response->get_data();
		$data['available'] = false;
		$data['is_available'] = false;
		$response->set_data( $data );
		return $response;
	}, 10, 3 );
}
