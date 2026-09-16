/**
 * SML Identity Verification — Stripe Identity (test/live), self-contained.
 *
 * Verifies a member is a real person whose government ID name matches their
 * account name, WITHOUT the site ever storing the ID: Stripe captures the
 * document + selfie, we only read the pass/fail + verified name and set a flag.
 *
 *   GET  /wp-json/sml-idv/v1/status    -> { configured, mode, verified, pending, publishable_key }
 *   POST /wp-json/sml-idv/v1/session   -> creates a Stripe VerificationSession, { client_secret, id }
 *   POST /wp-json/sml-idv/v1/finalize  -> polls the session; on verified + NAME MATCH sets usermeta sml_id_verified=1
 *   POST /wp-json/sml-idv/v1/config    -> (admin) save keys/mode
 *
 * Keys are entered by an admin in Settings -> SML Identity (stored in options,
 * autoload off, NEVER returned by any route or logged). The recommender gate
 * (sml-recs) turns on when option sml_recs_require_verified is set.
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. Guarded, no dynamic-code
 * calls, no banned tokens, no top-level return. Kill switch: deactivate.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! function_exists( 'sml_idv_secret' ) ) {

	function sml_idv_mode() { return 'live' === get_option( 'sml_idv_mode', 'test' ) ? 'live' : 'test'; }
	function sml_idv_secret() { return (string) get_option( 'sml_idv_secret_' . sml_idv_mode(), '' ); }
	function sml_idv_publishable() { return (string) get_option( 'sml_idv_pk_' . sml_idv_mode(), '' ); }

	/** Call the Stripe REST API with the configured secret key (no SDK). */
	function sml_idv_api( $method, $path, $params ) {
		$sk = sml_idv_secret();
		if ( '' === $sk ) { return new WP_Error( 'sml_idv_nokey', 'Identity verification is not configured yet.', array( 'status' => 503 ) ); }
		$args = array(
			'method'  => $method,
			'timeout' => 20,
			'headers' => array( 'Authorization' => 'Bearer ' . $sk, 'Stripe-Version' => '2024-06-20' ),
		);
		if ( 'GET' === $method ) {
			$url = 'https://api.stripe.com/v1/' . $path . ( ! empty( $params ) ? ( '?' . http_build_query( $params ) ) : '' );
		} else {
			$url = 'https://api.stripe.com/v1/' . $path;
			$args['headers']['Content-Type'] = 'application/x-www-form-urlencoded';
			$args['body'] = http_build_query( (array) $params );
		}
		$r = wp_remote_request( $url, $args );
		if ( is_wp_error( $r ) ) { return $r; }
		$code = (int) wp_remote_retrieve_response_code( $r );
		$body = json_decode( (string) wp_remote_retrieve_body( $r ), true );
		if ( $code < 200 || $code >= 300 ) {
			$msg = isset( $body['error']['message'] ) ? $body['error']['message'] : 'Stripe request failed.';
			return new WP_Error( 'sml_idv_stripe', $msg, array( 'status' => 400 ) );
		}
		return is_array( $body ) ? $body : array();
	}

	/** Normalize a name for comparison: lowercase, letters+spaces only. */
	function sml_idv_norm_name( $s ) {
		$s = strtolower( trim( (string) $s ) );
		$s = preg_replace( '/[^a-z ]/', ' ', $s );
		return trim( preg_replace( '/\s+/', ' ', $s ) );
	}

	/** True if the ID's verified name matches the account name (first + last present). */
	function sml_idv_name_matches( $verified, $account ) {
		$v = sml_idv_norm_name( $verified );
		$a = sml_idv_norm_name( $account );
		if ( '' === $v ) { return false; }
		if ( $v === $a ) { return true; }
		$vt = array_values( array_filter( explode( ' ', $v ) ) );
		$at = array_values( array_filter( explode( ' ', $a ) ) );
		if ( count( $vt ) < 2 || count( $at ) < 2 ) { return false; }
		$first = $vt[0];
		$last  = $vt[ count( $vt ) - 1 ];
		return in_array( $first, $at, true ) && in_array( $last, $at, true );
	}

	function sml_idv_status_payload( $uid ) {
		return array(
			'configured'      => '' !== sml_idv_secret(),
			'mode'            => sml_idv_mode(),
			'verified'        => (bool) get_user_meta( $uid, 'sml_id_verified', true ),
			'pending'         => '' !== (string) get_user_meta( $uid, 'sml_idv_session', true ),
			'name_mismatch'   => (bool) get_user_meta( $uid, 'sml_idv_name_mismatch', true ),
			'publishable_key' => sml_idv_publishable(),
		);
	}

	function sml_idv_get_status( WP_REST_Request $request ) {
		return rest_ensure_response( sml_idv_status_payload( get_current_user_id() ) );
	}

	function sml_idv_create_session( WP_REST_Request $request ) {
		$uid = get_current_user_id();
		if ( get_user_meta( $uid, 'sml_id_verified', true ) ) {
			return rest_ensure_response( array( 'already' => true ) + sml_idv_status_payload( $uid ) );
		}
		$res = sml_idv_api( 'POST', 'identity/verification_sessions', array(
			'type'                                       => 'document',
			'metadata[wp_user_id]'                       => (string) $uid,
			'options[document][require_matching_selfie]' => 'true',
			'options[document][require_live_capture]'    => 'true',
		) );
		if ( is_wp_error( $res ) ) {
			$d = $res->get_error_data();
			return new WP_REST_Response( array( 'code' => $res->get_error_code(), 'message' => $res->get_error_message() ), isset( $d['status'] ) ? (int) $d['status'] : 400 );
		}
		update_user_meta( $uid, 'sml_idv_session', (string) $res['id'] );
		delete_user_meta( $uid, 'sml_idv_name_mismatch' );
		return rest_ensure_response( array( 'client_secret' => $res['client_secret'], 'id' => $res['id'] ) );
	}

	function sml_idv_finalize( WP_REST_Request $request ) {
		$uid = get_current_user_id();
		$sid = (string) get_user_meta( $uid, 'sml_idv_session', true );
		if ( '' === $sid ) { return rest_ensure_response( sml_idv_status_payload( $uid ) ); }
		$res = sml_idv_api( 'GET', 'identity/verification_sessions/' . rawurlencode( $sid ), array() );
		if ( is_wp_error( $res ) ) {
			$d = $res->get_error_data();
			return new WP_REST_Response( array( 'code' => $res->get_error_code(), 'message' => $res->get_error_message() ), isset( $d['status'] ) ? (int) $d['status'] : 400 );
		}
		$status = isset( $res['status'] ) ? (string) $res['status'] : '';
		if ( 'verified' === $status ) {
			$vo    = isset( $res['verified_outputs'] ) && is_array( $res['verified_outputs'] ) ? $res['verified_outputs'] : array();
			$vname = trim( ( isset( $vo['first_name'] ) ? $vo['first_name'] : '' ) . ' ' . ( isset( $vo['last_name'] ) ? $vo['last_name'] : '' ) );
			$u     = get_userdata( $uid );
			$acct  = $u ? $u->display_name : '';
			$match = sml_idv_name_matches( $vname, $acct );
			if ( $match ) {
				update_user_meta( $uid, 'sml_id_verified', 1 );
				update_user_meta( $uid, 'sml_id_verified_at', time() );
				delete_user_meta( $uid, 'sml_idv_session' );
				delete_user_meta( $uid, 'sml_idv_name_mismatch' );
			} else {
				update_user_meta( $uid, 'sml_idv_name_mismatch', 1 );
			}
			return rest_ensure_response( array( 'status' => $status, 'name_match' => $match ) + sml_idv_status_payload( $uid ) );
		}
		if ( 'canceled' === $status ) { delete_user_meta( $uid, 'sml_idv_session' ); }
		return rest_ensure_response( array( 'status' => $status ) + sml_idv_status_payload( $uid ) );
	}

	function sml_idv_save_config( WP_REST_Request $request ) {
		if ( ! current_user_can( 'manage_options' ) ) { return new WP_REST_Response( array( 'message' => 'forbidden' ), 403 ); }
		$am = 'live' === $request->get_param( 'active_mode' ) ? 'live' : 'test';
		update_option( 'sml_idv_mode', $am );
		foreach ( array( 'test', 'live' ) as $m ) {
			$sk = trim( (string) $request->get_param( 'secret_' . $m ) );
			$pk = trim( (string) $request->get_param( 'pk_' . $m ) );
			if ( '' !== $sk ) { update_option( 'sml_idv_secret_' . $m, $sk, false ); }
			if ( '' !== $pk ) { update_option( 'sml_idv_pk_' . $m, $pk, false ); }
		}
		return rest_ensure_response( array( 'ok' => true, 'configured' => '' !== sml_idv_secret(), 'mode' => sml_idv_mode() ) );
	}

	add_action( 'rest_api_init', function () {
		$auth = function () { return is_user_logged_in(); };
		register_rest_route( 'sml-idv/v1', '/status',   array( 'methods' => 'GET',  'callback' => 'sml_idv_get_status',      'permission_callback' => $auth ) );
		register_rest_route( 'sml-idv/v1', '/session',  array( 'methods' => 'POST', 'callback' => 'sml_idv_create_session',  'permission_callback' => $auth ) );
		register_rest_route( 'sml-idv/v1', '/finalize', array( 'methods' => 'POST', 'callback' => 'sml_idv_finalize',        'permission_callback' => $auth ) );
		register_rest_route( 'sml-idv/v1', '/config',   array( 'methods' => 'POST', 'callback' => 'sml_idv_save_config',     'permission_callback' => function () { return current_user_can( 'manage_options' ); } ) );
	} );

	/* Admin settings page: paste your own Stripe keys here (never in code). */
	add_action( 'admin_menu', function () {
		add_options_page( 'SML Identity', 'SML Identity', 'manage_options', 'sml-idv', 'sml_idv_admin_page' );
	} );

	function sml_idv_admin_page() {
		if ( ! current_user_can( 'manage_options' ) ) { return; }
		if ( isset( $_POST['sml_idv_nonce'] ) && wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['sml_idv_nonce'] ) ), 'sml_idv_save' ) ) {
			$am = ( isset( $_POST['sml_idv_active_mode'] ) && 'live' === $_POST['sml_idv_active_mode'] ) ? 'live' : 'test';
			update_option( 'sml_idv_mode', $am );
			foreach ( array( 'test', 'live' ) as $m ) {
				if ( ! empty( $_POST[ 'sml_idv_secret_' . $m ] ) ) { update_option( 'sml_idv_secret_' . $m, trim( sanitize_text_field( wp_unslash( $_POST[ 'sml_idv_secret_' . $m ] ) ) ), false ); }
				if ( ! empty( $_POST[ 'sml_idv_pk_' . $m ] ) ) { update_option( 'sml_idv_pk_' . $m, trim( sanitize_text_field( wp_unslash( $_POST[ 'sml_idv_pk_' . $m ] ) ) ), false ); }
			}
			if ( isset( $_POST['sml_idv_require'] ) ) { update_option( 'sml_recs_require_verified', 1 ); } else { update_option( 'sml_recs_require_verified', 0 ); }
			echo '<div class="notice notice-success is-dismissible"><p>Saved.</p></div>';
		}
		$mode = sml_idv_mode();
		$hasTS = '' !== get_option( 'sml_idv_secret_test', '' );
		$hasLS = '' !== get_option( 'sml_idv_secret_live', '' );
		$reqv  = (bool) get_option( 'sml_recs_require_verified', 0 );
		echo '<div class="wrap"><h1>SML Identity (Stripe)</h1>';
		echo '<p>Paste your own Stripe keys. Secret keys are stored write-only and never shown again or returned by the API. Test keys begin <code>sk_test_</code>/<code>pk_test_</code>; live keys <code>sk_live_</code>/<code>pk_live_</code>.</p>';
		echo '<form method="post">';
		wp_nonce_field( 'sml_idv_save', 'sml_idv_nonce' ); // the handler above requires this
		echo '<table class="form-table">';
		echo '<tr><th scope="row">Active mode</th><td><label><input type="radio" name="sml_idv_active_mode" value="test" ' . checked( $mode, 'test', false ) . '> Test</label> &nbsp;&nbsp; <label><input type="radio" name="sml_idv_active_mode" value="live" ' . checked( $mode, 'live', false ) . '> Live</label></td></tr>';
		echo '<tr><th scope="row">Test publishable key</th><td><input type="text" name="sml_idv_pk_test" style="width:440px" value="' . esc_attr( get_option( 'sml_idv_pk_test', '' ) ) . '" placeholder="pk_test_..." autocomplete="off"></td></tr>';
		echo '<tr><th scope="row">Test secret key</th><td><input type="password" name="sml_idv_secret_test" style="width:440px" placeholder="' . ( $hasTS ? 'saved — leave blank to keep' : 'sk_test_...' ) . '" autocomplete="off"></td></tr>';
		echo '<tr><th scope="row">Live publishable key</th><td><input type="text" name="sml_idv_pk_live" style="width:440px" value="' . esc_attr( get_option( 'sml_idv_pk_live', '' ) ) . '" placeholder="pk_live_..." autocomplete="off"></td></tr>';
		echo '<tr><th scope="row">Live secret key</th><td><input type="password" name="sml_idv_secret_live" style="width:440px" placeholder="' . ( $hasLS ? 'saved — leave blank to keep' : 'sk_live_...' ) . '" autocomplete="off"></td></tr>';
		echo '<tr><th scope="row">Gate the rail</th><td><label><input type="checkbox" name="sml_idv_require" ' . checked( $reqv, true, false ) . '> Require ID verification to appear in "Traders you may connect with" (in addition to a real photo)</label></td></tr>';
		echo '</table>';
		submit_button( 'Save' );
		echo '</form></div>';
	}
}
