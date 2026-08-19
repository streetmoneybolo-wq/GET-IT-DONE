/**
 * SML Creator Analytics — private GA4 Data API adapter.
 *
 * WPCode: PHP Snippet / Auto Insert / Run Everywhere.
 * Do not add an opening PHP tag in WPCode.
 *
 * The service-account JSON must live outside the public web root. Override the
 * default path with SML_CREATOR_GA4_KEY_FILE in wp-config.php when needed.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
if ( defined( 'SML_CREATOR_GA4_LOADED' ) ) {
	return;
}
define( 'SML_CREATOR_GA4_LOADED', true );

if ( ! defined( 'SML_CREATOR_GA4_PROPERTY_ID' ) ) {
	define( 'SML_CREATOR_GA4_PROPERTY_ID', '469605605' );
}

if ( ! function_exists( 'sml_creator_ga4_key_file' ) ) {
	function sml_creator_ga4_key_file() {
		if ( defined( 'SML_CREATOR_GA4_KEY_FILE' ) && SML_CREATOR_GA4_KEY_FILE ) {
			return (string) SML_CREATOR_GA4_KEY_FILE;
		}
		return '/home/150846796/sml-secrets/ga4-creator-reader.json';
	}
}

if ( ! function_exists( 'sml_creator_ga4_credentials' ) ) {
	function sml_creator_ga4_credentials() {
		$path = sml_creator_ga4_key_file();
		if ( ! is_readable( $path ) ) {
			return new WP_Error( 'sml_ga4_not_configured', 'Creator audience analytics is not configured.' );
		}
		$raw = file_get_contents( $path ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$creds = json_decode( (string) $raw, true );
		if ( ! is_array( $creds ) || empty( $creds['client_email'] ) || empty( $creds['private_key'] ) || empty( $creds['token_uri'] ) ) {
			return new WP_Error( 'sml_ga4_invalid_credentials', 'Creator audience analytics credentials are invalid.' );
		}
		return $creds;
	}
}

if ( ! function_exists( 'sml_creator_ga4_b64url' ) ) {
	function sml_creator_ga4_b64url( $value ) {
		return rtrim( strtr( base64_encode( $value ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
	}
}

if ( ! function_exists( 'sml_creator_ga4_access_token' ) ) {
	function sml_creator_ga4_access_token() {
		$creds = sml_creator_ga4_credentials();
		if ( is_wp_error( $creds ) ) {
			return $creds;
		}

		$cache_key = 'sml_ga4_tok_' . substr( hash( 'sha256', $creds['client_email'] . '|' . ( $creds['private_key_id'] ?? '' ) ), 0, 24 );
		$cached = get_transient( $cache_key );
		if ( is_string( $cached ) && '' !== $cached ) {
			return $cached;
		}

		$now = time();
		$header = sml_creator_ga4_b64url( wp_json_encode( array( 'alg' => 'RS256', 'typ' => 'JWT' ) ) );
		$claims = sml_creator_ga4_b64url(
			wp_json_encode(
				array(
					'iss'   => $creds['client_email'],
					'scope' => 'https://www.googleapis.com/auth/analytics.readonly',
					'aud'   => $creds['token_uri'],
					'iat'   => $now - 30,
					'exp'   => $now + 3300,
				)
			)
		);
		$unsigned = $header . '.' . $claims;
		$signature = '';
		if ( ! function_exists( 'openssl_sign' ) || ! openssl_sign( $unsigned, $signature, $creds['private_key'], OPENSSL_ALGO_SHA256 ) ) {
			return new WP_Error( 'sml_ga4_sign_failed', 'Creator audience analytics authentication failed.' );
		}
		$jwt = $unsigned . '.' . sml_creator_ga4_b64url( $signature );
		$response = wp_remote_post(
			$creds['token_uri'],
			array(
				'timeout' => 15,
				'body'    => array(
					'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
					'assertion'  => $jwt,
				),
			)
		);
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'sml_ga4_token_unavailable', 'Creator audience analytics authentication is temporarily unavailable.' );
		}
		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( 200 !== (int) wp_remote_retrieve_response_code( $response ) || empty( $body['access_token'] ) ) {
			return new WP_Error( 'sml_ga4_token_rejected', 'Creator audience analytics authentication was rejected.' );
		}
		$ttl = max( 60, min( 3300, (int) ( $body['expires_in'] ?? 3600 ) - 120 ) );
		set_transient( $cache_key, (string) $body['access_token'], $ttl );
		return (string) $body['access_token'];
	}
}

if ( ! function_exists( 'sml_creator_ga4_filter' ) ) {
	function sml_creator_ga4_filter( $handle ) {
		return array(
			'filter' => array(
				'fieldName'    => 'customEvent:creator_handle',
				'stringFilter' => array( 'matchType' => 'EXACT', 'value' => $handle, 'caseSensitive' => false ),
			),
		);
	}
}

if ( ! function_exists( 'sml_creator_ga4_report' ) ) {
	function sml_creator_ga4_report( $token, $body, $realtime = false ) {
		$method = $realtime ? 'runRealtimeReport' : 'runReport';
		$url = 'https://analyticsdata.googleapis.com/v1beta/properties/' . rawurlencode( SML_CREATOR_GA4_PROPERTY_ID ) . ':' . $method;
		$response = wp_remote_post(
			$url,
			array(
				'timeout' => 18,
				'headers' => array( 'Authorization' => 'Bearer ' . $token, 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode( $body ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'sml_ga4_report_unavailable', 'Creator audience analytics is temporarily unavailable.' );
		}
		$data = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( 200 !== (int) wp_remote_retrieve_response_code( $response ) || ! is_array( $data ) ) {
			$status = (int) wp_remote_retrieve_response_code( $response );
			return new WP_Error( 'sml_ga4_report_rejected', 403 === $status ? 'GA4 property access has not been granted yet.' : 'GA4 rejected the analytics report.', array( 'status' => $status ) );
		}
		return $data;
	}
}

if ( ! function_exists( 'sml_creator_ga4_rows' ) ) {
	function sml_creator_ga4_rows( $report, $dimension_names, $metric_names ) {
		$out = array();
		foreach ( (array) ( $report['rows'] ?? array() ) as $row ) {
			$item = array();
			foreach ( $dimension_names as $i => $name ) {
				$item[ $name ] = sanitize_text_field( $row['dimensionValues'][ $i ]['value'] ?? '' );
			}
			foreach ( $metric_names as $i => $name ) {
				$value = $row['metricValues'][ $i ]['value'] ?? 0;
				$item[ $name ] = false !== strpos( (string) $value, '.' ) ? (float) $value : (int) $value;
			}
			$out[] = $item;
		}
		return $out;
	}
}

if ( ! function_exists( 'sml_creator_ga4_audience_payload' ) ) {
	function sml_creator_ga4_audience_payload( $handle, $days ) {
		$token = sml_creator_ga4_access_token();
		if ( is_wp_error( $token ) ) {
			return $token;
		}
		$date_ranges = array( array( 'startDate' => $days . 'daysAgo', 'endDate' => 'today' ) );
		$filter = sml_creator_ga4_filter( $handle );
		$metrics = array( array( 'name' => 'activeUsers' ), array( 'name' => 'screenPageViews' ), array( 'name' => 'sessions' ) );
		$base = array( 'dateRanges' => $date_ranges, 'dimensionFilter' => $filter, 'metrics' => $metrics, 'limit' => 100 );

		$country = sml_creator_ga4_report( $token, array_merge( $base, array( 'dimensions' => array( array( 'name' => 'country' ) ), 'orderBys' => array( array( 'metric' => array( 'metricName' => 'activeUsers' ), 'desc' => true ) ) ) ) );
		if ( is_wp_error( $country ) ) {
			return $country;
		}
		$city = sml_creator_ga4_report( $token, array_merge( $base, array( 'dimensions' => array( array( 'name' => 'city' ), array( 'name' => 'country' ) ), 'orderBys' => array( array( 'metric' => array( 'metricName' => 'activeUsers' ), 'desc' => true ) ) ) ) );
		$source = sml_creator_ga4_report( $token, array_merge( $base, array( 'dimensions' => array( array( 'name' => 'sessionSourceMedium' ) ), 'orderBys' => array( array( 'metric' => array( 'metricName' => 'sessions' ), 'desc' => true ) ) ) ) );
		$kind = sml_creator_ga4_report( $token, array_merge( $base, array( 'dimensions' => array( array( 'name' => 'customEvent:content_kind' ) ), 'orderBys' => array( array( 'metric' => array( 'metricName' => 'screenPageViews' ), 'desc' => true ) ) ) ) );
		$series_body = array( 'dateRanges' => $date_ranges, 'dimensionFilter' => $filter, 'dimensions' => array( array( 'name' => 'date' ) ), 'metrics' => $metrics, 'orderBys' => array( array( 'dimension' => array( 'dimensionName' => 'date' ) ) ), 'limit' => 400 );
		$series = sml_creator_ga4_report( $token, $series_body );

		$cities = is_wp_error( $city ) ? array() : sml_creator_ga4_rows( $city, array( 'city', 'country' ), array( 'users', 'views', 'sessions' ) );
		$cities = array_values( array_filter( $cities, static function ( $row ) { return (int) $row['users'] >= 10; } ) );
		$payload = array(
			'configured' => true,
			'propertyId' => (string) SML_CREATOR_GA4_PROPERTY_ID,
			'rangeDays'  => $days,
			'privacyThreshold' => 10,
			'countries'  => sml_creator_ga4_rows( $country, array( 'country' ), array( 'users', 'views', 'sessions' ) ),
			'cities'     => $cities,
			'sources'    => is_wp_error( $source ) ? array() : sml_creator_ga4_rows( $source, array( 'source' ), array( 'users', 'views', 'sessions' ) ),
			'kinds'      => is_wp_error( $kind ) ? array() : sml_creator_ga4_rows( $kind, array( 'kind' ), array( 'users', 'views', 'sessions' ) ),
			'series'     => is_wp_error( $series ) ? array() : sml_creator_ga4_rows( $series, array( 'date' ), array( 'users', 'views', 'sessions' ) ),
			// GA4's Realtime API does not accept event-scoped custom dimensions,
			// including customEvent:creator_handle. Keep this explicitly unavailable
			// instead of issuing an invalid request or showing a site-wide count as if
			// it belonged to this creator. A first-party presence heartbeat can fill
			// this contract later without weakening creator isolation.
			'live'       => array(
				'available'    => false,
				'count'        => 0,
				'topCountries' => array(),
				'reason'       => 'creator_realtime_requires_first_party_presence',
			),
		);
		return $payload;
	}
}

if ( ! function_exists( 'sml_creator_ga4_rest_audience' ) ) {
	function sml_creator_ga4_rest_audience( WP_REST_Request $request ) {
		$user = wp_get_current_user();
		if ( ! $user || ! $user->exists() ) {
			return new WP_Error( 'rest_not_logged_in', 'Authentication required.', array( 'status' => 401 ) );
		}
		$handle = sanitize_title( $user->user_nicename );
		if ( '' === $handle ) {
			return new WP_Error( 'sml_ga4_no_creator_handle', 'This account does not have a creator handle.', array( 'status' => 422 ) );
		}
		$days = min( 90, max( 7, absint( $request->get_param( 'range' ) ?: 28 ) ) );
		if ( is_wp_error( sml_creator_ga4_credentials() ) ) {
			return rest_ensure_response( array( 'configured' => false, 'countries' => array(), 'cities' => array(), 'sources' => array(), 'kinds' => array(), 'series' => array(), 'live' => array( 'available' => false, 'count' => 0, 'topCountries' => array() ) ) );
		}
		$cache_key = 'sml_ga4_aud_' . get_current_user_id() . '_' . $days . '_' . substr( hash( 'sha256', $handle ), 0, 12 );
		$cached = get_transient( $cache_key );
		if ( is_array( $cached ) ) {
			$cached['cached'] = true;
			return rest_ensure_response( $cached );
		}
		$payload = sml_creator_ga4_audience_payload( $handle, $days );
		if ( is_wp_error( $payload ) ) {
			return new WP_REST_Response( array( 'configured' => true, 'available' => false, 'code' => $payload->get_error_code(), 'message' => $payload->get_error_message() ), 503 );
		}
		$payload['cached'] = false;
		set_transient( $cache_key, $payload, 15 * MINUTE_IN_SECONDS );
		return rest_ensure_response( $payload );
	}
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'sml-creator-analytics/v1',
			'/audience',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'sml_creator_ga4_rest_audience',
				'permission_callback' => static function () { return is_user_logged_in(); },
				'args'                => array( 'range' => array( 'sanitize_callback' => 'absint', 'default' => 28 ) ),
			)
		);
	}
);
