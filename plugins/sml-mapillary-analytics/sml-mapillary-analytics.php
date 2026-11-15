<?php
/**
 * Plugin Name: SML Mapillary Analytics
 * Description: Adds an inline Mapillary street-imagery viewer to Creator Analytics maps without exposing the Mapillary client token.
 * Version: 1.0.6
 * Author: StockMarketLoop
 */

defined( 'ABSPATH' ) || exit;

define( 'SML_MAPILLARY_ANALYTICS_VERSION', '1.0.6' );
define( 'SML_MAPILLARY_ANALYTICS_FILE', __FILE__ );

function sml_ma_token(): string {
	if ( defined( 'SML_MAPILLARY_CLIENT_TOKEN' ) && is_string( SML_MAPILLARY_CLIENT_TOKEN ) ) {
		return trim( SML_MAPILLARY_CLIENT_TOKEN );
	}
	return trim( (string) get_option( 'sml_mapillary_client_token', '' ) );
}

function sml_ma_is_analytics_request(): bool {
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
		return false;
	}
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$path = strtolower( rawurldecode( (string) wp_parse_url( $uri, PHP_URL_PATH ) ) );
	return (bool) preg_match( '#^/+creator-studio/+analytics/?$#', preg_replace( '#/+#', '/', $path ) );
}

function sml_ma_distance_m( float $lat_a, float $lng_a, float $lat_b, float $lng_b ): int {
	$earth = 6371000;
	$lat_1 = deg2rad( $lat_a );
	$lat_2 = deg2rad( $lat_b );
	$dlat  = deg2rad( $lat_b - $lat_a );
	$dlng  = deg2rad( $lng_b - $lng_a );
	$a     = sin( $dlat / 2 ) ** 2 + cos( $lat_1 ) * cos( $lat_2 ) * sin( $dlng / 2 ) ** 2;
	return (int) round( $earth * 2 * atan2( sqrt( $a ), sqrt( 1 - $a ) ) );
}

function sml_ma_nearest_image( float $lat, float $lng ) {
	$token = sml_ma_token();
	if ( '' === $token ) {
		return array( 'ok' => true, 'configured' => false, 'available' => false, 'reason' => 'not_configured' );
	}

	$cache_key = 'sml_ma_' . md5( number_format( $lat, 3, '.', '' ) . '|' . number_format( $lng, 3, '.', '' ) );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) ) {
		$cached['cached'] = true;
		return $cached;
	}

	$best             = null;
	$successful_query = false;
	foreach ( array( 0.0025, 0.0125, 0.05 ) as $radius ) {
		$bbox = implode(
			',',
			array(
				number_format( $lng - $radius, 6, '.', '' ),
				number_format( $lat - $radius, 6, '.', '' ),
				number_format( $lng + $radius, 6, '.', '' ),
				number_format( $lat + $radius, 6, '.', '' ),
			)
		);
		$url = add_query_arg(
			array(
				'fields' => 'id,computed_geometry,captured_at,computed_compass_angle',
				'bbox'   => $bbox,
				'limit'  => 100,
			),
			'https://graph.mapillary.com/images'
		);
		$response = wp_remote_get(
			$url,
			array(
				'timeout' => 12,
				'headers' => array( 'Authorization' => 'OAuth ' . $token ),
			)
		);
		if ( is_wp_error( $response ) ) {
			continue;
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( 401 === $code || 403 === $code ) {
			return new WP_Error( 'mapillary_auth', 'Mapillary rejected the configured client token.', array( 'status' => 502 ) );
		}
		if ( $code < 200 || $code >= 300 || ! is_array( $body ) ) {
			continue;
		}
		$successful_query = true;
		foreach ( (array) ( $body['data'] ?? array() ) as $image ) {
			$coords = $image['computed_geometry']['coordinates'] ?? null;
			$id     = preg_replace( '/\D+/', '', (string) ( $image['id'] ?? '' ) );
			if ( '' === $id || ! is_array( $coords ) || count( $coords ) < 2 || ! is_numeric( $coords[0] ) || ! is_numeric( $coords[1] ) ) {
				continue;
			}
			$image_lng = (float) $coords[0];
			$image_lat = (float) $coords[1];
			$distance  = sml_ma_distance_m( $lat, $lng, $image_lat, $image_lng );
			if ( null === $best || $distance < $best['distance_m'] ) {
				$best = array(
					'id'            => $id,
					'lat'           => $image_lat,
					'lng'           => $image_lng,
					'distance_m'    => $distance,
					'captured_at'   => isset( $image['captured_at'] ) ? (int) $image['captured_at'] : 0,
					'compass_angle' => isset( $image['computed_compass_angle'] ) ? (float) $image['computed_compass_angle'] : null,
				);
			}
		}
		if ( null !== $best ) {
			break;
		}
	}
	if ( ! $successful_query ) {
		return new WP_Error( 'mapillary_unavailable', 'Mapillary did not return a usable response.', array( 'status' => 502 ) );
	}

	$result = array(
		'ok'         => true,
		'configured' => true,
		'available'  => null !== $best,
		'image'      => $best,
		'reason'     => null === $best ? 'no_imagery' : '',
		'cached'     => false,
	);
	set_transient( $cache_key, $result, null === $best ? HOUR_IN_SECONDS : DAY_IN_SECONDS );
	return $result;
}

add_action( 'rest_api_init', function () {
	register_rest_route(
		'sml-mapillary/v1',
		'/nearest',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => function () { return is_user_logged_in(); },
			'callback'            => function ( WP_REST_Request $request ) {
				$lat = $request->get_param( 'lat' );
				$lng = $request->get_param( 'lng' );
				if ( ! is_numeric( $lat ) || ! is_numeric( $lng ) || abs( (float) $lat ) > 85.0511 || abs( (float) $lng ) > 180 ) {
					return new WP_Error( 'bad_coordinates', 'A valid latitude and longitude are required.', array( 'status' => 400 ) );
				}
				$response = sml_ma_nearest_image( (float) $lat, (float) $lng );
				if ( is_wp_error( $response ) ) {
					return $response;
				}
				$response = rest_ensure_response( $response );
				$response->header( 'Cache-Control', 'private, no-store' );
				return $response;
			},
		)
	);
} );
function sml_ma_frontend_markup(): string {
	$base = plugin_dir_url( SML_MAPILLARY_ANALYTICS_FILE );
	$dir  = plugin_dir_path( SML_MAPILLARY_ANALYTICS_FILE );
	$js_file = $dir . 'assets/mapillary-analytics.js';
	$cs_file = $dir . 'assets/mapillary-analytics.css';
	$js_hash = @md5_file( $js_file );
	$cs_hash = @md5_file( $cs_file );
	$js_v = SML_MAPILLARY_ANALYTICS_VERSION . '-' . ( $js_hash ? substr( $js_hash, 0, 12 ) : (int) @filemtime( $js_file ) );
	$cs_v = SML_MAPILLARY_ANALYTICS_VERSION . '-' . ( $cs_hash ? substr( $cs_hash, 0, 12 ) : (int) @filemtime( $cs_file ) );
	$config = array(
		'rest'       => esc_url_raw( rest_url( 'sml-mapillary/v1/nearest' ) ),
		'nonce'      => wp_create_nonce( 'wp_rest' ),
		'configured' => '' !== sml_ma_token(),
		'isAdmin'    => current_user_can( 'manage_options' ),
		'settings'   => admin_url( 'options-general.php?page=sml-mapillary-analytics' ),
	);
	return "\n<!-- SML Mapillary Analytics -->\n"
		. '<script id="sml-mapillary-config">window.SML_MAPILLARY_ANALYTICS=' . wp_json_encode( $config ) . ';</script>' . "\n"
		. '<link rel="stylesheet" id="sml-mapillary-css" href="' . esc_url( $base . 'assets/mapillary-analytics.css?v=' . $cs_v ) . '">' . "\n"
		. '<script id="sml-mapillary-js" src="' . esc_url( $base . 'assets/mapillary-analytics.js?v=' . $js_v ) . '" defer></script>' . "\n";
}

add_action( 'wp_footer', function () {
	if ( ! is_user_logged_in() || ! sml_ma_is_analytics_request() ) {
		return;
	}
	echo sml_ma_frontend_markup();
}, 990 );

function sml_ma_buffer_inject( $html ) {
	if ( ! is_string( $html ) || ! is_user_logged_in() || false === stripos( $html, '</body>' ) ) {
		return $html;
	}
	if ( false !== strpos( $html, 'sml-mapillary-config' ) || false !== strpos( $html, 'mapillary-analytics.js' ) ) {
		return $html;
	}
	$position = strripos( $html, '</body>' );
	return substr( $html, 0, $position ) . sml_ma_frontend_markup() . substr( $html, $position );
}

add_action( 'init', function () {
	if ( ! sml_ma_is_analytics_request() ) {
		return;
	}
	nocache_headers();
	ob_start( 'sml_ma_buffer_inject' );
}, 2 );

add_action( 'admin_menu', function () {
	add_options_page( 'Mapillary Analytics', 'Mapillary Analytics', 'manage_options', 'sml-mapillary-analytics', 'sml_ma_settings_page' );
} );

function sml_ma_settings_page(): void {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$configured = '' !== sml_ma_token();
	?>
	<div class="wrap">
		<h1>Mapillary Analytics</h1>
		<p>Connect a Mapillary client token to show navigable street imagery inside Creator Analytics. The token stays on this server; browsers receive only a nearby public image ID.</p>
		<p><strong>Status:</strong> <?php echo $configured ? 'Connected' : 'Client token required'; ?></p>
		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="sml_mapillary_save">
			<?php wp_nonce_field( 'sml_mapillary_save' ); ?>
			<table class="form-table" role="presentation"><tr>
				<th scope="row"><label for="sml-mapillary-token">Client token</label></th>
				<td><input id="sml-mapillary-token" name="token" type="password" class="regular-text" autocomplete="off" placeholder="MLY|..."><p class="description">Create a client token in the Mapillary developer dashboard. Leave this blank to keep the current token.</p></td>
			</tr></table>
			<?php submit_button( 'Save Mapillary connection' ); ?>
			<?php if ( $configured ) : ?><p><label><input type="checkbox" name="clear" value="1"> Remove the saved token</label></p><?php endif; ?>
		</form>
	</div>
	<?php
}

add_action( 'admin_post_sml_mapillary_save', function () {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'You are not allowed to change this setting.' );
	}
	check_admin_referer( 'sml_mapillary_save' );
	if ( ! empty( $_POST['clear'] ) ) {
		delete_option( 'sml_mapillary_client_token' );
	} else {
		$token = isset( $_POST['token'] ) ? trim( sanitize_text_field( wp_unslash( $_POST['token'] ) ) ) : '';
		if ( '' !== $token ) {
			update_option( 'sml_mapillary_client_token', $token, false );
		}
	}
	wp_safe_redirect( add_query_arg( 'updated', '1', admin_url( 'options-general.php?page=sml-mapillary-analytics' ) ) );
	exit;
} );

