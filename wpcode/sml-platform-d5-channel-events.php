/**
 * SML Platform Gateway — D5 Loop Channel event producer.
 *
 * WPCode: PHP Snippet / Auto Insert / Run Everywhere. Do not include an
 * opening PHP tag. This is intentionally an additive producer: it observes
 * only verified, successful Loop Channel REST writes and sends a minimum-data
 * event to the existing D4 gateway through WP-Cron.
 *
 * Emits only: creator.channel.updated
 *
 * Confirmed routes:
 * - POST /sml-create-channel/v1/create   -> action=created
 * - POST /sml-channel/v1/settings        -> action=updated
 *
 * Not connected here: Loop Letters, Groups, articles, media uploads, member
 * profile data, emails, biographies, links, or any other unverified schema.
 *
 * Reliability: the producer assigns sourceEventKey once. The Render D5 schema
 * deduplicates re-tries by that key, while the D4 gateway still signs every
 * delivery and independently validates every payload.
 *
 * ROLLBACK: deactivate this snippet. It never changes a channel and queued
 * deliveries are record-only; they cannot publish or alter user data.
 */

if ( ! defined( 'SML_PLATFORM_D5_CHANNEL_EVENTS_LOADED' ) ) {

	define( 'SML_PLATFORM_D5_CHANNEL_EVENTS_LOADED', true );
	define( 'SML_PLATFORM_D5_CHANNEL_EVENT_ACTION', 'sml_platform_d5_deliver_channel_event' );

	function sml_platform_d5_channel_handle( $value ) {
		if ( function_exists( 'sml_channel_clean_handle' ) ) {
			return (string) sml_channel_clean_handle( $value );
		}
		$value = strtolower( ltrim( sanitize_text_field( (string) $value ), '@' ) );
		return substr( preg_replace( '/[^a-z0-9_.]/', '', $value ), 0, 30 );
	}

	function sml_platform_d5_queue_channel_event( $action, $handle, $actor_user_id, $route ) {
		if ( ! function_exists( 'sml_platform_emit_event' ) ) {
			return false;
		}
		$handle = sml_platform_d5_channel_handle( $handle );
		$actor_user_id = absint( $actor_user_id );
		if ( '' === $handle || ! in_array( $action, array( 'created', 'updated' ), true ) || ! $actor_user_id ) {
			return false;
		}
		$event = array(
			'key'     => wp_generate_uuid4(),
			'action'  => $action,
			'handle'  => $handle,
			'actor'   => $actor_user_id,
			'route'   => sanitize_text_field( (string) $route ),
			'attempt' => 0,
		);
		wp_schedule_single_event( time(), SML_PLATFORM_D5_CHANNEL_EVENT_ACTION, array( $event ) );
		if ( function_exists( 'spawn_cron' ) ) {
			spawn_cron( time() );
		}
		return true;
	}

	function sml_platform_d5_deliver_channel_event( $event ) {
		if ( ! is_array( $event ) || ! function_exists( 'sml_platform_emit_event' ) ) {
			return;
		}
		$handle = sml_platform_d5_channel_handle( $event['handle'] ?? '' );
		$key = isset( $event['key'] ) ? strtolower( sanitize_text_field( (string) $event['key'] ) ) : '';
		$action = isset( $event['action'] ) ? (string) $event['action'] : '';
		$actor = absint( $event['actor'] ?? 0 );
		$attempt = min( 2, max( 0, absint( $event['attempt'] ?? 0 ) ) );
		if ( '' === $handle || ! wp_is_uuid( $key ) || ! in_array( $action, array( 'created', 'updated' ), true ) || ! $actor ) {
			return;
		}

		$result = sml_platform_emit_event(
			'creator.channel.updated',
			array(
				'sourceEventKey' => $key,
				'action'         => $action,
				'channelHandle'  => $handle,
				'sourceRoute'    => (string) ( $event['route'] ?? '' ),
			),
			array(
				'actorUserId' => $actor,
				'subject'     => array( 'type' => 'channel', 'id' => $handle ),
			)
		);

		// Two bounded background retries. The stable sourceEventKey ensures that
		// a late response cannot create duplicate platform records.
		if ( is_wp_error( $result ) && $attempt < 2 ) {
			$event['attempt'] = $attempt + 1;
			wp_schedule_single_event( time() + ( 60 * ( $attempt + 1 ) ), SML_PLATFORM_D5_CHANNEL_EVENT_ACTION, array( $event ) );
		}
	}
	add_action( SML_PLATFORM_D5_CHANNEL_EVENT_ACTION, 'sml_platform_d5_deliver_channel_event', 10, 1 );

	add_action( 'rest_api_init', static function() {
		register_rest_route(
			'sml-platform/v1',
			'/channel-producer-status',
			array(
				'methods' => WP_REST_Server::READABLE,
				'permission_callback' => static function() { return current_user_can( 'manage_options' ); },
				'callback' => static function() {
					return rest_ensure_response( array(
						'active' => true,
						'gatewayAvailable' => function_exists( 'sml_platform_emit_event' ),
						'observedRoutes' => array( '/sml-create-channel/v1/create', '/sml-channel/v1/settings' ),
						'queuedNextRun' => wp_next_scheduled( SML_PLATFORM_D5_CHANNEL_EVENT_ACTION ) ?: null,
						'mode' => 'record_only',
					) );
				},
			)
		);
	} );

	add_filter( 'rest_post_dispatch', static function( $response, $server, $request ) {
		if ( ! $request instanceof WP_REST_Request || 'POST' !== strtoupper( (string) $request->get_method() ) ) {
			return $response;
		}
		$route = (string) $request->get_route();
		if ( ! in_array( $route, array( '/sml-create-channel/v1/create', '/sml-channel/v1/settings' ), true ) ) {
			return $response;
		}
		$response = rest_ensure_response( $response );
		if ( $response->get_status() < 200 || $response->get_status() >= 300 ) {
			return $response;
		}
		$data = (array) $response->get_data();
		if ( '/sml-create-channel/v1/create' === $route && ! empty( $data['already'] ) ) {
			return $response;
		}
		$actor = get_current_user_id();
		$handle = '/sml-create-channel/v1/create' === $route
			? (string) ( $data['handle'] ?? '' )
			: (string) get_user_meta( $actor, 'sml_channel_handle', true );
		sml_platform_d5_queue_channel_event(
			'/sml-create-channel/v1/create' === $route ? 'created' : 'updated',
			$handle,
			$actor,
			$route
		);
		return $response;
	}, 99, 3 );
}
