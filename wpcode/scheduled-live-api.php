<?php
/**
 * SML Scheduled Live Watch Pages.
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere.
 *
 * A scheduled stream uses the existing creator-scoped Watch Page route:
 * /live/?s={profile-handle}. It does not create a duplicate WordPress post or
 * a fake video. The record only makes the pending broadcast discoverable and
 * supplies its title, thumbnail/GIF, start time, and chat room before RTMP
 * ingest begins. Once the real ingest turns on, sml-live/v1/feeds/{handle}
 * remains the sole authority for whether video is actually live.
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
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

if ( ! function_exists( 'sml_scheduled_live_watch_url' ) ) {
	function sml_scheduled_live_watch_url( $handle ) {
		$handle = sanitize_key( (string) $handle );
		/* `s` is WordPress's global search query. `room` keeps a shared Watch
		 * Page URL stable instead of letting theme/search canonicalization strip
		 * its creator context. */
		return $handle ? add_query_arg( 'room', $handle, home_url( '/live/' ) ) : home_url( '/live/' );
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

if ( ! function_exists( 'sml_scheduled_live_public_payload' ) ) {
	function sml_scheduled_live_public_payload( $user_id, $include_private = false ) {
		$user_id = absint( $user_id );
		$row     = sml_scheduled_live_read( $user_id );
		$handle  = sml_scheduled_live_handle_for_user( $user_id );
		if ( ! $user_id || ! $handle || empty( $row['id'] ) || empty( $row['status'] ) || 'cancelled' === $row['status'] ) {
			return null;
		}
		if ( ! $include_private && ( $row['visibility'] ?? 'public' ) !== 'public' ) {
			return null;
		}
		/* A missed session must not leave a permanent public "scheduled" page. */
		$scheduled_timestamp = strtotime( (string) ( $row['scheduled_at'] ?? '' ) );
		if ( ! $include_private && $scheduled_timestamp && $scheduled_timestamp < ( time() - DAY_IN_SECONDS ) ) {
			return null;
		}

		$user = get_userdata( $user_id );
		return array(
			'id'            => sanitize_text_field( (string) $row['id'] ),
			'status'        => sanitize_key( (string) $row['status'] ),
			'handle'        => $handle,
			'creator_name'  => $user ? ( $user->display_name ?: $user->user_login ) : 'Creator',
			'title'         => sanitize_text_field( (string) ( $row['title'] ?? '' ) ),
			'description'   => sanitize_textarea_field( (string) ( $row['description'] ?? '' ) ),
			'ticker'        => sanitize_key( (string) ( $row['ticker'] ?? '' ) ),
			'thumbnail_url' => esc_url_raw( (string) ( $row['thumbnail_url'] ?? '' ) ),
			'scheduled_at'  => sanitize_text_field( (string) ( $row['scheduled_at'] ?? '' ) ),
			'visibility'    => sanitize_key( (string) ( $row['visibility'] ?? 'public' ) ),
			'watch_url'     => sml_scheduled_live_watch_url( $handle ),
			'chat_room'     => $handle,
			'created_at'    => sanitize_text_field( (string) ( $row['created_at'] ?? '' ) ),
			'updated_at'    => sanitize_text_field( (string) ( $row['updated_at'] ?? '' ) ),
		);
	}
}

if ( ! function_exists( 'sml_scheduled_live_rest_self' ) ) {
	function sml_scheduled_live_rest_self( WP_REST_Request $request ) {
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return new WP_Error( 'sml_scheduled_live_login', 'Sign in to manage a scheduled live stream.', array( 'status' => 401 ) );
		}

		if ( 'GET' === $request->get_method() ) {
			return rest_ensure_response(
				array(
					'scheduled_live' => sml_scheduled_live_public_payload( $user_id, true ),
					'watch_url'      => sml_scheduled_live_watch_url( sml_scheduled_live_handle_for_user( $user_id ) ),
				)
			);
		}

		if ( 'DELETE' === $request->get_method() ) {
			delete_user_meta( $user_id, sml_scheduled_live_meta_key() );
			return rest_ensure_response( array( 'ok' => true, 'cancelled' => true ) );
		}

		$mode = sanitize_key( (string) $request->get_param( 'mode' ) );
		$mode = in_array( $mode, array( 'now', 'later' ), true ) ? $mode : 'later';
		$handle = sml_scheduled_live_handle_for_user( $user_id );
		$title  = sanitize_text_field( (string) $request->get_param( 'title' ) );
		if ( '' === $handle ) {
			return new WP_Error( 'sml_scheduled_live_no_handle', 'Set a public profile handle before scheduling a live stream.', array( 'status' => 400 ) );
		}
		if ( '' === $title ) {
			return new WP_Error( 'sml_scheduled_live_title', 'Add a stream title before scheduling.', array( 'status' => 400 ) );
		}

		$start = sml_scheduled_live_normalize_start( $request->get_param( 'starts_at' ), $mode );
		if ( is_wp_error( $start ) ) {
			return $start;
		}
		$visibility = sanitize_key( (string) $request->get_param( 'visibility' ) );
		$visibility = in_array( $visibility, array( 'public', 'unlisted', 'followers', 'subscribers', 'premium', 'group' ), true ) ? $visibility : 'public';
		$thumb      = esc_url_raw( (string) $request->get_param( 'thumbnail_url' ) );
		$thumb_info = $thumb ? wp_parse_url( $thumb ) : array();
		if ( $thumb && ( ! wp_http_validate_url( $thumb ) || empty( $thumb_info['scheme'] ) || 'https' !== strtolower( (string) $thumb_info['scheme'] ) ) ) {
			return new WP_Error( 'sml_scheduled_live_thumbnail', 'The stream thumbnail must be a valid HTTPS image URL.', array( 'status' => 400 ) );
		}

		$previous = sml_scheduled_live_read( $user_id );
		$now      = gmdate( 'c' );
		$record   = array(
			'id'            => ! empty( $previous['id'] ) ? sanitize_text_field( (string) $previous['id'] ) : wp_generate_uuid4(),
			'status'        => 'scheduled',
			'title'         => $title,
			'description'   => sanitize_textarea_field( (string) $request->get_param( 'description' ) ),
			'ticker'        => strtoupper( preg_replace( '/[^A-Z]/', '', (string) $request->get_param( 'ticker' ) ) ),
			'thumbnail_url' => $thumb,
			'scheduled_at'  => $start,
			'visibility'    => $visibility,
			'created_at'    => ! empty( $previous['created_at'] ) ? sanitize_text_field( (string) $previous['created_at'] ) : $now,
			'updated_at'    => $now,
		);
		update_user_meta( $user_id, sml_scheduled_live_meta_key(), $record );

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
		$data = $user ? sml_scheduled_live_public_payload( $user->ID, false ) : null;
		if ( ! $data ) {
			return new WP_Error( 'sml_scheduled_live_not_found', 'No public scheduled stream was found for this creator.', array( 'status' => 404 ) );
		}
		return rest_ensure_response( $data );
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
	}
);
