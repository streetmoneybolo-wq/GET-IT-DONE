/**
 * SML Creator Gate — registration + channel/letter requirement for
 * Creator Studio / Go Live / Upload.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * Route base: /wp-json/sml-creator-gate/v1
 *
 * Stores NEW personal data (name/DOB/city/state/phone/email) as user-meta —
 * this did not exist anywhere on the site before. Kept intentionally minimal:
 * this snippet owns registration and authoritative Channel/Letter status.
 * Creation still goes through each feature's existing REST endpoint.
 */
if ( ! function_exists( 'sml_cg_sanitize_phone' ) ) {
	function sml_cg_sanitize_phone( $phone ) {
		$digits = preg_replace( '/[^0-9]/', '', (string) $phone );
		return substr( $digits, 0, 15 );
	}

	function sml_cg_valid_dob( $dob ) {
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', (string) $dob ) ) { return false; }
		$ts = strtotime( $dob );
		if ( ! $ts || $ts > current_time( 'timestamp', true ) ) { return false; }
		$age_years = ( current_time( 'timestamp', true ) - $ts ) / ( 365.25 * 86400 );
		return $age_years >= 13 && $age_years < 120;
	}

	function sml_cg_rest_status( WP_REST_Request $request ) {
		$uid = get_current_user_id();
		if ( ! $uid ) { return new WP_Error( 'sml_cg_login_required', 'Sign in required.', array( 'status' => 401 ) ); }
		$handle = get_user_meta( $uid, 'sml_channel_handle', true );
		$letter_handle = get_user_meta( $uid, 'smll_handle', true );
		$reg = array(
			'name'  => get_user_meta( $uid, 'sml_cg_name', true ),
			'dob'   => get_user_meta( $uid, 'sml_cg_dob', true ),
			'city'  => get_user_meta( $uid, 'sml_cg_city', true ),
			'state' => get_user_meta( $uid, 'sml_cg_state', true ),
			'phone' => get_user_meta( $uid, 'sml_cg_phone', true ),
			'email' => get_user_meta( $uid, 'sml_cg_email', true ),
		);
		$registered = ! empty( $reg['name'] ) && ! empty( $reg['dob'] ) && ! empty( $reg['city'] ) && ! empty( $reg['state'] ) && ! empty( $reg['phone'] ) && ! empty( $reg['email'] );
		return rest_ensure_response( array(
			'registered'    => $registered,
			'hasChannel'    => ! empty( $handle ),
			'channelHandle' => $handle ?: '',
			'hasLetter'     => ! empty( $letter_handle ),
			'letterHandle'  => $letter_handle ?: '',
			'creatorName'   => $registered ? $reg['name'] : '',
		) );
	}

	function sml_cg_rest_register( WP_REST_Request $request ) {
		$uid = get_current_user_id();
		if ( ! $uid ) { return new WP_Error( 'sml_cg_login_required', 'Sign in required.', array( 'status' => 401 ) ); }

		$name  = sanitize_text_field( (string) $request->get_param( 'name' ) );
		$dob   = sanitize_text_field( (string) $request->get_param( 'dob' ) );
		$city  = sanitize_text_field( (string) $request->get_param( 'city' ) );
		$state = sanitize_text_field( (string) $request->get_param( 'state' ) );
		$phone = sml_cg_sanitize_phone( $request->get_param( 'phone' ) );
		$email = sanitize_email( (string) $request->get_param( 'email' ) );

		if ( '' === $name || mb_strlen( $name ) < 2 ) { return new WP_Error( 'sml_cg_bad_name', 'Enter your full name.', array( 'status' => 400 ) ); }
		if ( ! sml_cg_valid_dob( $dob ) ) { return new WP_Error( 'sml_cg_bad_dob', 'Enter a valid date of birth (you must be at least 13).', array( 'status' => 400 ) ); }
		if ( '' === $city ) { return new WP_Error( 'sml_cg_bad_city', 'Enter your city.', array( 'status' => 400 ) ); }
		if ( '' === $state ) { return new WP_Error( 'sml_cg_bad_state', 'Enter your state.', array( 'status' => 400 ) ); }
		if ( strlen( $phone ) < 7 ) { return new WP_Error( 'sml_cg_bad_phone', 'Enter a valid phone number.', array( 'status' => 400 ) ); }
		if ( ! is_email( $email ) ) { return new WP_Error( 'sml_cg_bad_email', 'Enter a valid email address.', array( 'status' => 400 ) ); }

		update_user_meta( $uid, 'sml_cg_name', $name );
		update_user_meta( $uid, 'sml_cg_dob', $dob );
		update_user_meta( $uid, 'sml_cg_city', $city );
		update_user_meta( $uid, 'sml_cg_state', $state );
		update_user_meta( $uid, 'sml_cg_phone', $phone );
		update_user_meta( $uid, 'sml_cg_email', $email );
		update_user_meta( $uid, 'sml_cg_registered_at', gmdate( 'c' ) );

		return rest_ensure_response( array( 'ok' => true ) );
	}

	add_action( 'rest_api_init', static function () {
		register_rest_route( 'sml-creator-gate/v1', '/status', array(
			'methods' => WP_REST_Server::READABLE, 'callback' => 'sml_cg_rest_status', 'permission_callback' => 'is_user_logged_in',
		) );
		register_rest_route( 'sml-creator-gate/v1', '/register', array(
			'methods' => WP_REST_Server::CREATABLE, 'callback' => 'sml_cg_rest_register', 'permission_callback' => 'is_user_logged_in',
		) );
	} );
}
