/**
 * SML Scheduled Live Watch Pages.
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere.
 *
 * Every scheduled stream receives its own stable identity and Watch Page URL:
 * /live/?room={profile-handle}&stream={stream-id}. The creator's current
 * stream remains available through the legacy creator route, while a bounded
 * per-creator library preserves prior records for the dashboard and replay
 * pipeline. This metadata never pretends that video was recorded: the RTMP
 * ingest/recorder must attach a real recording asset before a replay is marked
 * ready. sml-live/v1/feeds/{handle} remains the authority for actual live video.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'sml_scheduled_live_handle_for_user' ) ) {
	function sml_scheduled_live_handle_for_user( $user_id ) {
		$user_id = absint( $user_id );
		if ( ! $user_id ) {
			return '';
		}

		$handle = sanitize_key( (string) get_user_meta( $user_id, 'sml_public_handle', true ) );
		if ( '' === $handle ) {
			$user = get_userdata( $user_id );
			if ( $user ) {
				$handle = sanitize_key( (string) ( $user->user_nicename ?: $user->user_login ) );
			}
		}

		return substr( $handle, 0, 60 );
	}
}

if ( ! function_exists( 'sml_scheduled_live_user_for_handle' ) ) {
	function sml_scheduled_live_user_for_handle( $raw_handle ) {
		$handle = sanitize_key( (string) $raw_handle );
		if ( '' === $handle ) {
			return false;
		}

		$users = get_users(
			array(
				'number'      => 1,
				'count_total' => false,
				'meta_key'    => 'sml_public_handle',
				'meta_value'  => $handle,
			)
		);
		if ( ! empty( $users[0] ) ) {
			return $users[0];
		}

		return get_user_by( 'slug', $handle );
	}
}

if ( ! function_exists( 'sml_scheduled_live_meta_key' ) ) {
	function sml_scheduled_live_meta_key() {
		return '_sml_scheduled_live';
	}
}

if ( ! function_exists( 'sml_scheduled_live_library_key' ) ) {
	function sml_scheduled_live_library_key() {
		return '_sml_scheduled_live_library';
	}
}

if ( ! function_exists( 'sml_scheduled_live_clean_id' ) ) {
	function sml_scheduled_live_clean_id( $value ) {
		$value = strtolower( preg_replace( '/[^a-zA-Z0-9]/', '', (string) $value ) );
		return strlen( $value ) >= 8 && strlen( $value ) <= 32 ? $value : '';
	}
}

if ( ! function_exists( 'sml_scheduled_live_new_id' ) ) {
	function sml_scheduled_live_new_id() {
		return strtolower( substr( str_replace( '-', '', wp_generate_uuid4() ), 0, 16 ) );
	}
}

if ( ! function_exists( 'sml_scheduled_live_watch_url' ) ) {
	function sml_scheduled_live_watch_url( $handle, $stream_id = '' ) {
		$handle = sanitize_key( (string) $handle );
		$stream_id = sml_scheduled_live_clean_id( $stream_id );
		/* `s` is WordPress's global search query. `room` keeps a shared Watch
		 * Page URL stable instead of letting theme/search canonicalization strip
		 * its creator context. */
		if ( ! $handle ) {
			return home_url( '/live/' );
		}
		$args = array( 'room' => $handle );
		if ( $stream_id ) {
			$args['stream'] = $stream_id;
		}
		return add_query_arg( $args, home_url( '/live/' ) );
	}
}

if ( ! function_exists( 'sml_scheduled_live_normalize_start' ) ) {
	function sml_scheduled_live_normalize_start( $raw, $mode ) {
		if ( 'now' === $mode ) {
			return gmdate( 'c' );
		}

		$raw = trim( sanitize_text_field( (string) $raw ) );
		$tz  = function_exists( 'wp_timezone' ) ? wp_timezone() : new DateTimeZone( 'UTC' );
		$dt  = DateTimeImmutable::createFromFormat( '!Y-m-d\\TH:i', $raw, $tz );
		$err = DateTimeImmutable::getLastErrors();
		if ( ! $dt || ( is_array( $err ) && ( ! empty( $err['warning_count'] ) || ! empty( $err['error_count'] ) ) ) ) {
			return new WP_Error( 'sml_scheduled_live_bad_time', 'Choose a valid local start date and time.', array( 'status' => 400 ) );
		}
		if ( $dt->getTimestamp() <= time() ) {
			return new WP_Error( 'sml_scheduled_live_past_time', 'The scheduled start time must be in the future.', array( 'status' => 400 ) );
		}

		return $dt->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'c' );
	}
}

if ( ! function_exists( 'sml_scheduled_live_read' ) ) {
	function sml_scheduled_live_read( $user_id ) {
		$row = get_user_meta( absint( $user_id ), sml_scheduled_live_meta_key(), true );
		return is_array( $row ) ? $row : array();
	}
}

if ( ! function_exists( 'sml_scheduled_live_library' ) ) {
	function sml_scheduled_live_library( $user_id ) {
		$rows = get_user_meta( absint( $user_id ), sml_scheduled_live_library_key(), true );
		if ( ! is_array( $rows ) ) {
			$rows = array();
		}
		$current = sml_scheduled_live_read( $user_id );
		if ( ! empty( $current['id'] ) ) {
			$rows[ sml_scheduled_live_clean_id( $current['id'] ) ] = $current;
		}
		return $rows;
	}
}

if ( ! function_exists( 'sml_scheduled_live_store' ) ) {
	function sml_scheduled_live_store( $user_id, $row, $make_current = true ) {
		$user_id   = absint( $user_id );
		$stream_id = sml_scheduled_live_clean_id( $row['id'] ?? '' );
		if ( ! $user_id || ! $stream_id ) {
			return false;
		}
		$row['id'] = $stream_id;
		$rows      = sml_scheduled_live_library( $user_id );
		$rows[ $stream_id ] = $row;
		uasort( $rows, static function ( $a, $b ) {
			return strcmp( (string) ( $b['created_at'] ?? '' ), (string) ( $a['created_at'] ?? '' ) );
		} );
		$rows = array_slice( $rows, 0, 100, true );
		update_user_meta( $user_id, sml_scheduled_live_library_key(), $rows );
		if ( $make_current ) {
			update_user_meta( $user_id, sml_scheduled_live_meta_key(), $row );
		}
		return true;
	}
}

if ( ! function_exists( 'sml_scheduled_live_row' ) ) {
	function sml_scheduled_live_row( $user_id, $stream_id = '' ) {
		$stream_id = sml_scheduled_live_clean_id( $stream_id );
		if ( ! $stream_id ) {
			return sml_scheduled_live_read( $user_id );
		}
		$rows = sml_scheduled_live_library( $user_id );
		return isset( $rows[ $stream_id ] ) && is_array( $rows[ $stream_id ] ) ? $rows[ $stream_id ] : array();
	}
}

if ( ! function_exists( 'sml_scheduled_live_public_payload' ) ) {
	function sml_scheduled_live_public_payload( $user_id, $include_private = false, $stream_id = '' ) {
		$user_id = absint( $user_id );
		$row     = sml_scheduled_live_row( $user_id, $stream_id );
		$handle  = sml_scheduled_live_handle_for_user( $user_id );
		if ( ! $user_id || ! $handle || empty( $row['id'] ) || empty( $row['status'] ) || 'cancelled' === $row['status'] ) {
			return null;
		}
		if ( ! $include_private && ( $row['visibility'] ?? 'public' ) !== 'public' ) {
			return null;
		}
		/* A missed session must not leave a permanent public "scheduled" page. */
		$scheduled_timestamp = strtotime( (string) ( $row['scheduled_at'] ?? '' ) );
		if ( ! $include_private && 'scheduled' === ( $row['status'] ?? '' ) && $scheduled_timestamp && $scheduled_timestamp < ( time() - DAY_IN_SECONDS ) ) {
			return null;
		}

		$creator_name      = trim( (string) get_user_meta( $user_id, 'sml_channel_name', true ) );
		$channel_handle    = sanitize_key( (string) get_user_meta( $user_id, 'sml_channel_handle', true ) );
		$creator_avatar_id = absint( get_user_meta( $user_id, 'sml_channel_avatar_id', true ) );
		$creator_avatar    = $creator_avatar_id ? wp_get_attachment_image_url( $creator_avatar_id, 'thumbnail' ) : '';
		$recording_status = sanitize_key( (string) ( $row['recording_status'] ?? 'not_started' ) );
		$recording_status = in_array( $recording_status, array( 'not_started', 'recording', 'processing', 'ready', 'failed' ), true ) ? $recording_status : 'not_started';
		$recording_url    = 'ready' === $recording_status ? esc_url_raw( (string) ( $row['recording_url'] ?? '' ) ) : '';
		return array(
			'id'            => sml_scheduled_live_clean_id( $row['id'] ),
			'status'        => sanitize_key( (string) $row['status'] ),
			'handle'        => $handle,
			'creator_name'  => '' !== $creator_name ? $creator_name : 'Creator',
			'creator'       => array(
				'name'   => '' !== $creator_name ? $creator_name : 'Creator',
				'handle' => $channel_handle,
				'avatar' => $creator_avatar ? esc_url_raw( $creator_avatar ) : '',
				'url'    => $channel_handle ? home_url( '/channel/' . rawurlencode( $channel_handle ) . '/' ) : '',
			),
			'title'         => sanitize_text_field( (string) ( $row['title'] ?? '' ) ),
			'description'   => sanitize_textarea_field( (string) ( $row['description'] ?? '' ) ),
			'ticker'        => sanitize_key( (string) ( $row['ticker'] ?? '' ) ),
			'thumbnail_url' => esc_url_raw( (string) ( $row['thumbnail_url'] ?? '' ) ),
			'scheduled_at'  => sanitize_text_field( (string) ( $row['scheduled_at'] ?? '' ) ),
			'visibility'    => sanitize_key( (string) ( $row['visibility'] ?? 'public' ) ),
			'watch_url'     => sml_scheduled_live_watch_url( $handle, $row['id'] ),
			'chat_room'     => $handle,
			'recording_status' => $recording_status,
			'recording_url' => $recording_url,
			'ended_at'      => sanitize_text_field( (string) ( $row['ended_at'] ?? '' ) ),
			'created_at'    => sanitize_text_field( (string) ( $row['created_at'] ?? '' ) ),
			'updated_at'    => sanitize_text_field( (string) ( $row['updated_at'] ?? '' ) ),
		);
	}
}

if ( ! function_exists( 'sml_scheduled_live_creator_library' ) ) {
	function sml_scheduled_live_creator_library( $user_id ) {
		$items = array();
		foreach ( sml_scheduled_live_library( $user_id ) as $row ) {
			if ( empty( $row['id'] ) ) {
				continue;
			}
			$item = sml_scheduled_live_public_payload( $user_id, true, $row['id'] );
			if ( $item ) {
				$items[] = $item;
			}
		}
		usort( $items, static function ( $a, $b ) {
			return strcmp( (string) ( $b['created_at'] ?? '' ), (string) ( $a['created_at'] ?? '' ) );
		} );
		return $items;
	}
}

if ( ! function_exists( 'sml_scheduled_live_rest_self' ) ) {
	function sml_scheduled_live_rest_self( WP_REST_Request $request ) {
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return new WP_Error( 'sml_scheduled_live_login', 'Sign in to manage a scheduled live stream.', array( 'status' => 401 ) );
		}

		if ( 'GET' === $request->get_method() ) {
			$current = sml_scheduled_live_public_payload( $user_id, true );
			return rest_ensure_response(
				array(
					'scheduled_live' => $current,
					'watch_url'      => $current ? $current['watch_url'] : sml_scheduled_live_watch_url( sml_scheduled_live_handle_for_user( $user_id ) ),
					'streams'        => sml_scheduled_live_creator_library( $user_id ),
				)
			);
		}

		if ( 'DELETE' === $request->get_method() ) {
			$row = sml_scheduled_live_read( $user_id );
			if ( ! empty( $row['id'] ) ) {
				$row['status']     = 'cancelled';
				$row['updated_at'] = gmdate( 'c' );
				sml_scheduled_live_store( $user_id, $row, false );
			}
			delete_user_meta( $user_id, sml_scheduled_live_meta_key() );
			return rest_ensure_response( array( 'ok' => true, 'cancelled' => true, 'stream_id' => sml_scheduled_live_clean_id( $row['id'] ?? '' ) ) );
		}

		$mode = sanitize_key( (string) $request->get_param( 'mode' ) );
		$mode = in_array( $mode, array( 'now', 'later' ), true ) ? $mode : 'later';
		$handle      = sml_scheduled_live_handle_for_user( $user_id );
		$title       = sanitize_text_field( (string) $request->get_param( 'title' ) );
		$description = sanitize_textarea_field( (string) $request->get_param( 'description' ) );
		if ( '' === $handle ) {
			return new WP_Error( 'sml_scheduled_live_no_handle', 'Set a public profile handle before scheduling a live stream.', array( 'status' => 400 ) );
		}
		if ( '' === $title ) {
			return new WP_Error( 'sml_scheduled_live_title', 'Add a stream title before scheduling.', array( 'status' => 400 ) );
		}
		if ( '' === $description ) {
			return new WP_Error( 'sml_scheduled_live_description', 'Add a stream description before scheduling so the share card has complete details.', array( 'status' => 400 ) );
		}

		$start = sml_scheduled_live_normalize_start( $request->get_param( 'starts_at' ), $mode );
		if ( is_wp_error( $start ) ) {
			return $start;
		}
		$visibility = sanitize_key( (string) $request->get_param( 'visibility' ) );
		$visibility = in_array( $visibility, array( 'public', 'unlisted', 'followers', 'subscribers', 'premium', 'group' ), true ) ? $visibility : 'public';
		$thumb      = esc_url_raw( (string) $request->get_param( 'thumbnail_url' ) );
		$thumb_info = $thumb ? wp_parse_url( $thumb ) : array();
		if ( ! $thumb || ! wp_http_validate_url( $thumb ) || empty( $thumb_info['scheme'] ) || 'https' !== strtolower( (string) $thumb_info['scheme'] ) ) {
			return new WP_Error( 'sml_scheduled_live_thumbnail', 'Upload a valid HTTPS thumbnail image or GIF before scheduling.', array( 'status' => 400 ) );
		}

		$previous = sml_scheduled_live_read( $user_id );
		$now      = gmdate( 'c' );
		/* Repeated clicks/retries for the same pending broadcast are idempotent,
		 * while the next broadcast receives a new ID after the current one is
		 * cancelled or finalized. */
		$reuse_id = ! empty( $previous['id'] ) && 'scheduled' === ( $previous['status'] ?? '' );
		$record   = array(
			'id'            => $reuse_id ? sml_scheduled_live_clean_id( $previous['id'] ) : sml_scheduled_live_new_id(),
			'status'        => 'scheduled',
			'title'         => $title,
			'description'   => $description,
			'ticker'        => strtoupper( preg_replace( '/[^A-Z]/', '', (string) $request->get_param( 'ticker' ) ) ),
			'thumbnail_url' => $thumb,
			'scheduled_at'  => $start,
			'visibility'    => $visibility,
			'recording_status' => $reuse_id ? sanitize_key( (string) ( $previous['recording_status'] ?? 'not_started' ) ) : 'not_started',
			'recording_url' => $reuse_id ? esc_url_raw( (string) ( $previous['recording_url'] ?? '' ) ) : '',
			'created_at'    => $reuse_id && ! empty( $previous['created_at'] ) ? sanitize_text_field( (string) $previous['created_at'] ) : $now,
			'updated_at'    => $now,
		);
		sml_scheduled_live_store( $user_id, $record, true );

		return rest_ensure_response(
			array(
				'ok'             => true,
				'scheduled_live' => sml_scheduled_live_public_payload( $user_id, true ),
			)
		);
	}
}

if ( ! function_exists( 'sml_scheduled_live_rest_public' ) ) {
	function sml_scheduled_live_rest_public( WP_REST_Request $request ) {
		$user = sml_scheduled_live_user_for_handle( $request->get_param( 'handle' ) );
		$data = $user ? sml_scheduled_live_public_payload( $user->ID, false, $request->get_param( 'stream_id' ) ) : null;
		if ( ! $data ) {
			return new WP_Error( 'sml_scheduled_live_not_found', 'No public scheduled stream was found for this creator.', array( 'status' => 404 ) );
		}
		return rest_ensure_response( $data );
	}
}

/* Recorder hand-off. This does not manufacture a replay: it accepts only a
 * real HTTPS asset URL supplied for one of the signed-in creator's own stream
 * records. The ingest recorder can call this after it has persisted the file. */
if ( ! function_exists( 'sml_scheduled_live_rest_recording' ) ) {
	function sml_scheduled_live_rest_recording( WP_REST_Request $request ) {
		$user_id   = get_current_user_id();
		$stream_id = sml_scheduled_live_clean_id( $request->get_param( 'stream_id' ) );
		$row       = $stream_id ? sml_scheduled_live_row( $user_id, $stream_id ) : array();
		if ( ! $user_id || ! $stream_id || empty( $row['id'] ) ) {
			return new WP_Error( 'sml_scheduled_live_recording_not_found', 'That stream does not belong to this creator.', array( 'status' => 404 ) );
		}

		$status = sanitize_key( (string) $request->get_param( 'status' ) );
		$status = in_array( $status, array( 'recording', 'processing', 'ready', 'failed' ), true ) ? $status : 'processing';
		$url    = esc_url_raw( (string) $request->get_param( 'recording_url' ) );
		if ( 'ready' === $status && ( ! $url || ! wp_http_validate_url( $url ) || 0 !== strpos( strtolower( $url ), 'https://' ) ) ) {
			return new WP_Error( 'sml_scheduled_live_recording_url', 'A real HTTPS recording URL is required before a replay can be marked ready.', array( 'status' => 400 ) );
		}

		$row['status']           = in_array( $status, array( 'ready', 'failed' ), true ) ? 'ended' : 'live';
		$row['recording_status'] = $status;
		$row['recording_url']    = 'ready' === $status ? $url : '';
		$row['ended_at']         = in_array( $status, array( 'ready', 'failed' ), true ) ? gmdate( 'c' ) : '';
		$row['updated_at']       = gmdate( 'c' );
		sml_scheduled_live_store( $user_id, $row, false );
		$current = sml_scheduled_live_read( $user_id );
		if ( ! empty( $current['id'] ) && sml_scheduled_live_clean_id( $current['id'] ) === $stream_id ) {
			if ( 'ended' === $row['status'] ) {
				delete_user_meta( $user_id, sml_scheduled_live_meta_key() );
			} else {
				update_user_meta( $user_id, sml_scheduled_live_meta_key(), $row );
			}
		}

		return rest_ensure_response( array( 'ok' => true, 'stream' => sml_scheduled_live_public_payload( $user_id, true, $stream_id ) ) );
	}
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'sml-scheduled-live/v1',
			'/creator',
			array(
				array( 'methods' => WP_REST_Server::READABLE, 'callback' => 'sml_scheduled_live_rest_self', 'permission_callback' => 'is_user_logged_in' ),
				array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => 'sml_scheduled_live_rest_self', 'permission_callback' => 'is_user_logged_in' ),
				array( 'methods' => WP_REST_Server::DELETABLE, 'callback' => 'sml_scheduled_live_rest_self', 'permission_callback' => 'is_user_logged_in' ),
			)
		);
		register_rest_route(
			'sml-scheduled-live/v1',
			'/creator/(?P<handle>[A-Za-z0-9_-]+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'sml_scheduled_live_rest_public',
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			'sml-scheduled-live/v1',
			'/creator/(?P<handle>[A-Za-z0-9_-]+)/(?P<stream_id>[A-Za-z0-9]{8,32})',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'sml_scheduled_live_rest_public',
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			'sml-scheduled-live/v1',
			'/creator/recording',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'sml_scheduled_live_rest_recording',
				'permission_callback' => 'is_user_logged_in',
			)
		);
	}
);
