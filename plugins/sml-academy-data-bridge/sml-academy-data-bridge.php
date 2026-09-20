<?php
/**
 * Plugin Name: SML Academy Data Bridge
 * Description: Private, signed Academy access to existing Options and Earnings REST data. It never exposes those feeds to site visitors.
 * Version: 0.1.2
 * Requires PHP: 7.4
 */

defined( 'ABSPATH' ) || exit;

/**
 * Configuration belongs in wp-config.php or a host-level secret manager:
 * SML_ACADEMY_BRIDGE_SECRET: same 32+ character secret stored in Render.
 * SML_ACADEMY_SERVICE_USER_ID: a dedicated read-only site user allowed to read
 * the existing private market endpoints. Do not use an administrator account.
 */

if ( ! function_exists( 'sml_academy_bridge_secret' ) ) {
	function sml_academy_bridge_secret() {
		if ( defined( 'SML_ACADEMY_BRIDGE_SECRET' ) ) {
			return trim( (string) SML_ACADEMY_BRIDGE_SECRET );
		}
		$stored = (string) get_option( 'sml_academy_bridge_secret', '' );
		if ( '' === $stored || ! function_exists( 'openssl_decrypt' ) ) {
			return '';
		}
		$raw    = base64_decode( $stored, true );
		$method = 'aes-256-cbc';
		$iv_len = openssl_cipher_iv_length( $method );
		if ( false === $raw || strlen( $raw ) <= $iv_len ) {
			return '';
		}
		return (string) openssl_decrypt( substr( $raw, $iv_len ), $method, hash( 'sha256', wp_salt( 'auth' ), true ), OPENSSL_RAW_DATA, substr( $raw, 0, $iv_len ) );
	}
}

if ( ! function_exists( 'sml_academy_bridge_service_user_id' ) ) {
	function sml_academy_bridge_service_user_id() {
		return defined( 'SML_ACADEMY_SERVICE_USER_ID' ) ? absint( SML_ACADEMY_SERVICE_USER_ID ) : absint( get_option( 'sml_academy_bridge_service_user_id', 0 ) );
	}
}

if ( ! function_exists( 'sml_academy_bridge_encrypt_secret' ) ) {
	function sml_academy_bridge_encrypt_secret( $secret ) {
		if ( ! function_exists( 'openssl_encrypt' ) ) {
			return new WP_Error( 'sml_academy_bridge_crypto', 'OpenSSL is not available on this server.' );
		}
		$method = 'aes-256-cbc';
		$iv     = random_bytes( openssl_cipher_iv_length( $method ) );
		$value  = openssl_encrypt( $secret, $method, hash( 'sha256', wp_salt( 'auth' ), true ), OPENSSL_RAW_DATA, $iv );
		return false === $value ? new WP_Error( 'sml_academy_bridge_crypto', 'The secret could not be protected.' ) : base64_encode( $iv . $value );
	}
}

if ( ! function_exists( 'sml_academy_bridge_settings_page' ) ) {
	function sml_academy_bridge_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		if ( isset( $_POST['sml_academy_bridge_save'] ) ) {
			check_admin_referer( 'sml_academy_bridge_settings' );
			$service_user = absint( $_POST['sml_academy_bridge_service_user_id'] ?? 0 );
			$user         = $service_user ? get_user_by( 'id', $service_user ) : false;
			if ( ! $user || user_can( $user, 'manage_options' ) ) {
				add_settings_error( 'sml_academy_bridge', 'service_user', 'Choose a non-administrator service user.', 'error' );
			} else {
				update_option( 'sml_academy_bridge_service_user_id', $service_user, false );
				$secret = trim( (string) wp_unslash( $_POST['sml_academy_bridge_new_secret'] ?? '' ) );
				if ( '' !== $secret ) {
					if ( strlen( $secret ) < 32 ) {
						add_settings_error( 'sml_academy_bridge', 'secret', 'The secret must be at least 32 characters.', 'error' );
					} else {
						$encrypted = sml_academy_bridge_encrypt_secret( $secret );
						if ( is_wp_error( $encrypted ) ) {
							add_settings_error( 'sml_academy_bridge', 'secret', $encrypted->get_error_message(), 'error' );
						} else {
							update_option( 'sml_academy_bridge_secret', $encrypted, false );
						}
					}
				}
				if ( ! get_settings_errors( 'sml_academy_bridge' ) ) {
					add_settings_error( 'sml_academy_bridge', 'saved', 'Academy bridge settings saved.', 'updated' );
				}
			}
		}
		// get_users() returns stdClass rows when requesting a limited fields list.
		// Resolve each row to a WP_User before checking capabilities.
		$users = array_filter( get_users( array( 'orderby' => 'display_name' ) ), static function( $user ) {
			return $user instanceof WP_User && ! user_can( $user, 'manage_options' );
		} );
		$current = sml_academy_bridge_service_user_id();
		?>
		<div class="wrap"><h1>Academy Data Bridge</h1><?php settings_errors( 'sml_academy_bridge' ); ?>
		<p>This bridge is private. Render can request data only after Discord Academy-role authorization. The secret is encrypted at rest and is never displayed after saving.</p>
		<form method="post"><?php wp_nonce_field( 'sml_academy_bridge_settings' ); ?>
		<table class="form-table" role="presentation"><tbody>
		<tr><th scope="row"><label for="sml-academy-service-user">Service user</label></th><td><select id="sml-academy-service-user" name="sml_academy_bridge_service_user_id" required><option value="">Select a non-administrator user</option><?php foreach ( $users as $user ) : ?><option value="<?php echo esc_attr( $user->ID ); ?>" <?php selected( $current, $user->ID ); ?>><?php echo esc_html( $user->display_name . ' (' . $user->user_login . ')' ); ?></option><?php endforeach; ?></select><p class="description">Use a dedicated, least-privilege account that can read the existing market endpoints.</p></td></tr>
		<tr><th scope="row"><label for="sml-academy-secret">Shared secret</label></th><td><input id="sml-academy-secret" name="sml_academy_bridge_new_secret" type="password" class="regular-text" autocomplete="new-password" /><p class="description">Paste the same 32+ character secret saved in Render. Leave blank to keep the current secret.</p></td></tr>
		</tbody></table><p class="submit"><button type="submit" name="sml_academy_bridge_save" class="button button-primary">Save Academy Bridge</button></p></form></div>
		<?php
	}
}

add_action( 'admin_menu', static function() {
	add_options_page( 'Academy Data Bridge', 'Academy Data Bridge', 'manage_options', 'sml-academy-data-bridge', 'sml_academy_bridge_settings_page' );
} );

if ( ! function_exists( 'sml_academy_bridge_authorize' ) ) {
	function sml_academy_bridge_authorize( WP_REST_Request $request ) {
		$secret    = sml_academy_bridge_secret();
		$timestamp = (string) $request->get_header( 'x-sml-academy-timestamp' );
		$provided  = (string) $request->get_header( 'x-sml-academy-signature' );
		$symbol    = strtoupper( preg_replace( '/[^A-Z0-9.:-]/', '', (string) $request->get_param( 'symbol' ) ) );
		if ( strlen( $secret ) < 32 || ! preg_match( '/^\d{10,12}$/', $timestamp ) || '' === $symbol ) {
			return new WP_Error( 'sml_academy_bridge_unauthorized', 'Unauthorized.', array( 'status' => 401 ) );
		}
		if ( abs( time() - (int) $timestamp ) > 60 ) {
			return new WP_Error( 'sml_academy_bridge_expired', 'Unauthorized.', array( 'status' => 401 ) );
		}
		$path     = '/wp-json' . $request->get_route() . '?symbol=' . rawurlencode( $symbol );
		$expected = 'sha256=' . hash_hmac( 'sha256', $timestamp . '.' . $path, $secret );
		if ( ! hash_equals( $expected, $provided ) ) {
			return new WP_Error( 'sml_academy_bridge_signature', 'Unauthorized.', array( 'status' => 401 ) );
		}
		return true;
	}
}

if ( ! function_exists( 'sml_academy_bridge_subrequest' ) ) {
	function sml_academy_bridge_subrequest( $route, $symbol ) {
		$service_user_id = sml_academy_bridge_service_user_id();
		if ( ! $service_user_id || ! get_user_by( 'id', $service_user_id ) ) {
			return new WP_Error( 'sml_academy_bridge_service_user', 'Academy data bridge is not configured.', array( 'status' => 503 ) );
		}
		$previous_user_id = get_current_user_id();
		wp_set_current_user( $service_user_id );
		try {
			$subrequest = new WP_REST_Request( WP_REST_Server::READABLE, $route );
			$subrequest->set_param( 'symbol', $symbol );
			$response = rest_do_request( $subrequest );
		} finally {
			wp_set_current_user( $previous_user_id );
		}
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$response = rest_ensure_response( $response );
		$status   = (int) $response->get_status();
		if ( $status < 200 || $status > 299 ) {
			return new WP_Error( 'sml_academy_bridge_source', 'Academy data is temporarily unavailable.', array( 'status' => 503 ) );
		}
		return $response->get_data();
	}
}

if ( ! function_exists( 'sml_academy_bridge_options' ) ) {
	function sml_academy_bridge_options( WP_REST_Request $request ) {
		$symbol = strtoupper( preg_replace( '/[^A-Z0-9.:-]/', '', (string) $request->get_param( 'symbol' ) ) );
		$data   = sml_academy_bridge_subrequest( '/sml-options-intelligence/v1/chain', $symbol );
		if ( is_wp_error( $data ) ) {
			return $data;
		}
		return new WP_REST_Response( array( 'ok' => true, 'symbol' => $symbol, 'data' => $data ), 200 );
	}
}

if ( ! function_exists( 'sml_academy_bridge_earnings' ) ) {
	function sml_academy_bridge_earnings( WP_REST_Request $request ) {
		$symbol = strtoupper( preg_replace( '/[^A-Z0-9.:-]/', '', (string) $request->get_param( 'symbol' ) ) );
		$data   = sml_academy_bridge_subrequest( '/sml/v1/earnings/symbol', $symbol );
		if ( is_wp_error( $data ) ) {
			// Older site builds expose the same data from this route.
			$data = sml_academy_bridge_subrequest( '/sml/v1/earnings/calendar', $symbol );
		}
		if ( is_wp_error( $data ) ) {
			return new WP_Error( 'sml_academy_bridge_earnings', 'Academy earnings data is temporarily unavailable.', array( 'status' => 503 ) );
		}
		return new WP_REST_Response( array( 'ok' => true, 'symbol' => $symbol, 'data' => $data ), 200 );
	}
}

add_action( 'rest_api_init', static function() {
	$arguments = array(
		'methods'             => WP_REST_Server::READABLE,
		'permission_callback' => 'sml_academy_bridge_authorize',
		'args'                => array(
			'symbol' => array(
				'required'          => true,
				'sanitize_callback' => static function( $value ) { return strtoupper( preg_replace( '/[^A-Z0-9.:-]/', '', (string) $value ) ); },
				'validate_callback' => static function( $value ) { return 1 === preg_match( '/^[A-Z0-9.:-]{1,12}$/', (string) $value ); },
			),
		),
	);
	register_rest_route( 'sml-academy-bridge/v1', '/options', array_merge( $arguments, array( 'callback' => 'sml_academy_bridge_options' ) ) );
	register_rest_route( 'sml-academy-bridge/v1', '/earnings', array_merge( $arguments, array( 'callback' => 'sml_academy_bridge_earnings' ) ) );
} );
