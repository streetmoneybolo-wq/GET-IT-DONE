/**
 * SML Platform Gateway — authenticated outbound events to Render.
 *
 * WPCode: PHP Snippet / Auto Insert / Run Everywhere. Do not include an
 * opening PHP tag. This snippet deliberately sends nothing on its own; a later
 * reviewed feature must call sml_platform_emit_event().
 *
 * Preferred configuration: set SML_PLATFORM_WEBHOOK_SECRET in wp-config.php.
 * If this WordPress.com environment cannot expose wp-config.php, add the secret
 * through the site's protected configuration process, never in a public page,
 * JavaScript payload, browser console, or a committed file.
 */

if ( ! defined( 'SML_PLATFORM_GATEWAY_LOADED' ) ) {
	define( 'SML_PLATFORM_GATEWAY_LOADED', true );
}

if ( ! defined( 'SML_PLATFORM_API_URL' ) ) {
	define( 'SML_PLATFORM_API_URL', 'https://sml-platform-api.onrender.com/v1/wordpress/events' );
}

if ( ! function_exists( 'sml_platform_gateway_allowed_event_types' ) ) {
	function sml_platform_gateway_allowed_event_types() {
		return array(
			'system.integration.ping',
			'creator.channel.updated',
			'creator.letter.published',
			'group.member.changed',
			'news.article.published',
		);
	}
}

if ( ! function_exists( 'sml_platform_gateway_secret' ) ) {
	function sml_platform_gateway_secret() {
		return defined( 'SML_PLATFORM_WEBHOOK_SECRET' ) ? trim( (string) SML_PLATFORM_WEBHOOK_SECRET ) : '';
	}
}

if ( ! function_exists( 'sml_platform_gateway_url' ) ) {
	function sml_platform_gateway_url() {
		$url  = esc_url_raw( (string) SML_PLATFORM_API_URL );
		$part = wp_parse_url( $url );
		if ( ! is_array( $part ) || 'https' !== ( $part['scheme'] ?? '' ) || 'sml-platform-api.onrender.com' !== strtolower( (string) ( $part['host'] ?? '' ) ) || '/v1/wordpress/events' !== ( $part['path'] ?? '' ) ) {
			return new WP_Error( 'sml_platform_gateway_url', 'Platform gateway is misconfigured.' );
		}
		return $url;
	}
}

if ( ! function_exists( 'sml_platform_emit_event' ) ) {
	/**
	 * Send one idempotent event. The return value contains no secret or payload.
	 * This has no automatic hooks by design: receiver-side consumers are not
	 * connected yet, so calling code must be explicitly reviewed first.
	 */
	function sml_platform_emit_event( $event_type, $data = array(), $context = array() ) {
		$event_type = strtolower( trim( (string) $event_type ) );
		if ( ! preg_match( '/^[a-z]+(?:\.[a-z_]+)+$/', $event_type ) || ! in_array( $event_type, sml_platform_gateway_allowed_event_types(), true ) ) {
			return new WP_Error( 'sml_platform_gateway_event', 'Event type is not allowed.' );
		}
		if ( ! is_array( $data ) || ! is_array( $context ) ) {
			return new WP_Error( 'sml_platform_gateway_payload', 'Gateway event data must be an array.' );
		}

		$secret = sml_platform_gateway_secret();
		if ( '' === $secret ) {
			return new WP_Error( 'sml_platform_gateway_secret', 'Platform gateway secret is not configured.' );
		}
		$url = sml_platform_gateway_url();
		if ( is_wp_error( $url ) ) {
			return $url;
		}

		$subject      = isset( $context['subject'] ) && is_array( $context['subject'] ) ? $context['subject'] : array();
		$actor_user_id = isset( $context['actorUserId'] ) ? absint( $context['actorUserId'] ) : 0;
		$subject_type = isset( $subject['type'] ) ? sanitize_key( (string) $subject['type'] ) : null;
		$subject_id   = isset( $subject['id'] ) ? sanitize_text_field( (string) $subject['id'] ) : null;
		if ( ( null === $subject_type ) !== ( null === $subject_id ) || ( null !== $subject_type && ( '' === $subject_type || '' === $subject_id ) ) ) {
			return new WP_Error( 'sml_platform_gateway_subject', 'Gateway subject needs both a type and an ID.' );
		}
		$payload      = array(
			'version'     => 1,
			'eventId'     => wp_generate_uuid4(),
			'eventType'   => $event_type,
			'occurredAt'  => gmdate( 'c' ),
			'actorUserId' => $actor_user_id > 0 ? $actor_user_id : null,
			'subject'     => array(
				'type' => $subject_type,
				'id'   => $subject_id,
			),
			'data'        => $data,
		);
		if ( null === $payload['subject']['type'] && null === $payload['subject']['id'] ) {
			$payload['subject'] = (object) array();
		}

		$body = wp_json_encode( $payload );
		if ( ! is_string( $body ) || '' === $body || strlen( $body ) > 65536 ) {
			return new WP_Error( 'sml_platform_gateway_encode', 'Gateway payload could not be encoded.' );
		}
		$timestamp = (string) time();
		$signature = 'sha256=' . hash_hmac( 'sha256', $timestamp . '.' . $body, $secret );
		$response  = wp_remote_post(
			$url,
			array(
				'timeout'     => 5,
				'redirection' => 0,
				'headers'     => array(
					'Content-Type'    => 'application/json',
					'X-SML-Timestamp' => $timestamp,
					'X-SML-Signature' => $signature,
				),
				'body'        => $body,
			)
		);
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'sml_platform_gateway_unavailable', 'Platform gateway is temporarily unavailable.' );
		}
		$status = (int) wp_remote_retrieve_response_code( $response );
		if ( 200 !== $status && 202 !== $status ) {
			return new WP_Error( 'sml_platform_gateway_rejected', 'Platform gateway rejected the event.', array( 'status' => $status ) );
		}
		return array( 'ok' => true, 'eventId' => $payload['eventId'], 'status' => 202 === $status ? 'accepted' : 'duplicate' );
	}
}

if ( ! function_exists( 'sml_platform_gateway_status' ) ) {
	function sml_platform_gateway_status() {
		return rest_ensure_response(
			array(
				'configured' => '' !== sml_platform_gateway_secret() && ! is_wp_error( sml_platform_gateway_url() ),
				'endpoint'   => 'sml-platform-api.onrender.com',
				'activeHooks'=> array(),
			)
		);
	}
}

add_action(
	'rest_api_init',
	static function() {
		register_rest_route(
			'sml-platform/v1',
			'/gateway-status',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'sml_platform_gateway_status',
				'permission_callback' => static function() { return current_user_can( 'manage_options' ); },
			)
		);
	}
);
