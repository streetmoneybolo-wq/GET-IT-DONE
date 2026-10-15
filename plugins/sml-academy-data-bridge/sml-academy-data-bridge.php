<?php
/**
 * Plugin Name: SML Academy Data Bridge
 * Description: Private, signed Academy access to existing Options, Earnings and Capital Flow data. It never exposes those feeds to site visitors.
 * Version: 0.3.0
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
		$expiration = sanitize_text_field( (string) $request->get_param( 'expiration' ) );
		if ( '' !== $expiration && ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $expiration ) ) {
			return new WP_Error( 'sml_academy_bridge_expiration', 'Unauthorized.', array( 'status' => 401 ) );
		}
		if ( strlen( $secret ) < 32 || ! preg_match( '/^\d{10,12}$/', $timestamp ) || '' === $symbol ) {
			return new WP_Error( 'sml_academy_bridge_unauthorized', 'Unauthorized.', array( 'status' => 401 ) );
		}
		if ( abs( time() - (int) $timestamp ) > 60 ) {
			return new WP_Error( 'sml_academy_bridge_expired', 'Unauthorized.', array( 'status' => 401 ) );
		}
		$path     = '/wp-json' . $request->get_route() . '?symbol=' . rawurlencode( $symbol ) . ( '' !== $expiration ? '&expiration=' . rawurlencode( $expiration ) : '' );
		$expected = 'sha256=' . hash_hmac( 'sha256', $timestamp . '.' . $path, $secret );
		if ( ! hash_equals( $expected, $provided ) ) {
			return new WP_Error( 'sml_academy_bridge_signature', 'Unauthorized.', array( 'status' => 401 ) );
		}
		return true;
	}
}

if ( ! function_exists( 'sml_academy_bridge_subrequest' ) ) {
	function sml_academy_bridge_subrequest( $route, $symbol, $expiration = '', $extra = array() ) {
		$service_user_id = sml_academy_bridge_service_user_id();
		if ( ! $service_user_id || ! get_user_by( 'id', $service_user_id ) ) {
			return new WP_Error( 'sml_academy_bridge_service_user', 'Academy data bridge is not configured.', array( 'status' => 503 ) );
		}
		$previous_user_id = get_current_user_id();
		wp_set_current_user( $service_user_id );
		try {
			$subrequest = new WP_REST_Request( WP_REST_Server::READABLE, $route );
			$subrequest->set_param( 'symbol', $symbol );
			if ( '' !== $expiration ) { $subrequest->set_param( 'expiration', $expiration ); }
			foreach ( (array) $extra as $k => $v ) { $subrequest->set_param( $k, $v ); }
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
			// Carry the source route's own reason through (the options provider guard names the real cause:
			// a refused provider, an unreachable bridge, a symbol with no listed options). The platform shows
			// it to the member and logs it; a bare "temporarily unavailable" told nobody what to fix.
			$data   = $response->get_data();
			$code   = is_array( $data ) && ! empty( $data['code'] ) ? sanitize_key( (string) $data['code'] ) : '';
			$reason = is_array( $data ) && ! empty( $data['message'] ) ? trim( wp_strip_all_tags( (string) $data['message'] ) ) : '';
			if ( '' === $reason && is_array( $data ) && ! empty( $data['error'] ) && is_string( $data['error'] ) ) {
				$reason = trim( wp_strip_all_tags( $data['error'] ) );
			}
			$message = 'Academy data is temporarily unavailable.';
			if ( '' !== $reason ) {
				$message .= ' ' . mb_substr( $reason, 0, 200 );
			}
			return new WP_Error( 'sml_academy_bridge_source', $message, array( 'status' => 503, 'source_status' => $status, 'source_code' => $code ) );
		}
		return $response->get_data();
	}
}

if ( ! function_exists( 'sml_academy_bridge_options' ) ) {
	function sml_academy_bridge_options( WP_REST_Request $request ) {
		$symbol = strtoupper( preg_replace( '/[^A-Z0-9.:-]/', '', (string) $request->get_param( 'symbol' ) ) );
		$expiration = sanitize_text_field( (string) $request->get_param( 'expiration' ) );
		$data   = sml_academy_bridge_subrequest( '/sml-options-intelligence/v1/chain', $symbol, $expiration );
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

/* Capital flow by order size (super-large / large / medium / small net inflow) straight from the moomoo OpenD bridge the
 * other site plugins already use (option sml_moomoo_bridge + sml_moomoo_secret). Cached a minute per symbol. */
if ( ! function_exists( 'sml_academy_bridge_capital' ) ) {
	function sml_academy_bridge_capital( WP_REST_Request $request ) {
		$symbol = strtoupper( preg_replace( '/[^A-Z0-9.:-]/', '', (string) $request->get_param( 'symbol' ) ) );
		$cache_key = 'sml_acb_cap_' . md5( $symbol );
		$cached    = get_transient( $cache_key );
		if ( is_array( $cached ) ) {
			return new WP_REST_Response( array( 'ok' => true, 'symbol' => $symbol, 'data' => $cached, 'cached' => true ), 200 );
		}
		$base = rtrim( (string) get_option( 'sml_moomoo_bridge', '' ), '/' );
		$key  = (string) get_option( 'sml_moomoo_secret', '' );
		if ( '' === $key || ! wp_http_validate_url( $base ) || 0 !== strpos( $base, 'https://' ) ) {
			return new WP_Error( 'sml_academy_bridge_capital', 'Capital flow is not connected right now.', array( 'status' => 503 ) );
		}
		$r = wp_safe_remote_get( add_query_arg( array( 'symbol' => $symbol ), $base . '/capital-flow' ), array( 'timeout' => 15, 'redirection' => 0, 'limit_response_size' => 300000, 'headers' => array( 'X-SML-Key' => $key ) ) );
		if ( is_wp_error( $r ) || 200 !== wp_remote_retrieve_response_code( $r ) ) {
			return new WP_Error( 'sml_academy_bridge_capital', 'Capital flow is temporarily unavailable.', array( 'status' => 503 ) );
		}
		$d = json_decode( wp_remote_retrieve_body( $r ), true );
		if ( ! is_array( $d ) || empty( $d['available'] ) ) {
			return new WP_Error( 'sml_academy_bridge_capital', 'No capital flow for this symbol.', array( 'status' => 503 ) );
		}
		$data = array(
			'rows'         => isset( $d['rows'] ) && is_array( $d['rows'] ) ? array_slice( $d['rows'], -100 ) : array(),
			'distribution' => isset( $d['distribution'] ) && is_array( $d['distribution'] ) ? $d['distribution'] : array(),
			'asof'         => isset( $d['asof'] ) ? (int) $d['asof'] : time(),
		);
		set_transient( $cache_key, $data, 60 );
		return new WP_REST_Response( array( 'ok' => true, 'symbol' => $symbol, 'data' => $data ), 200 );
	}
}

/* Whole-market earnings calendar for one month (the Academy's earnings playbook). The month rides in the signed
 * `expiration` parameter as its first day, so the request signature is unchanged; symbol is a fixed placeholder. */
if ( ! function_exists( 'sml_academy_bridge_calendar' ) ) {
	function sml_academy_bridge_calendar( WP_REST_Request $request ) {
		$first = sanitize_text_field( (string) $request->get_param( 'expiration' ) );
		$month = preg_match( '/^(\d{4}-\d{2})-\d{2}$/', $first, $m ) ? $m[1] : gmdate( 'Y-m' );
		$data  = sml_academy_bridge_subrequest( '/sml/v1/earnings/calendar', 'US', '', array( 'month' => $month, 'market' => 'US' ) );
		if ( is_wp_error( $data ) ) {
			return new WP_Error( 'sml_academy_bridge_calendar', 'The earnings calendar is temporarily unavailable.', array( 'status' => 503 ) );
		}
		return new WP_REST_Response( array( 'ok' => true, 'month' => $month, 'data' => $data ), 200 );
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
			'expiration' => array(
				'required'          => false,
				'sanitize_callback' => 'sanitize_text_field',
				'validate_callback' => static function( $value ) { return '' === (string) $value || 1 === preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $value ); },
			),
		),
	);
	register_rest_route( 'sml-academy-bridge/v1', '/options', array_merge( $arguments, array( 'callback' => 'sml_academy_bridge_options' ) ) );
	register_rest_route( 'sml-academy-bridge/v1', '/earnings', array_merge( $arguments, array( 'callback' => 'sml_academy_bridge_earnings' ) ) );
	register_rest_route( 'sml-academy-bridge/v1', '/capital', array_merge( $arguments, array( 'callback' => 'sml_academy_bridge_capital' ) ) );
	register_rest_route( 'sml-academy-bridge/v1', '/calendar', array_merge( $arguments, array( 'callback' => 'sml_academy_bridge_calendar' ) ) );
} );
