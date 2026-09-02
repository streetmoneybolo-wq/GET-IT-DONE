<?php
/**
 * Plugin Name: SML Connect Dispute Admin
 * Description: Admin review console for payment dispute cases held by the SML platform service: case list, packet review, human-approved submission, review-link endpoint, and dispute notifications.
 * Version: 0.1.0
 * Author: Stock Market Loop
 */

defined( 'ABSPATH' ) || exit;

/* ---------------------------------------------------------------------------
 * Configuration (wp-config constants; values are never printed or logged).
 * ------------------------------------------------------------------------ */

function smlcda_api_url() {
	return defined( 'SML_CONNECT_ADMIN_API_URL' )
		? untrailingslashit( trim( (string) SML_CONNECT_ADMIN_API_URL ) ) : '';
}

function smlcda_api_secret() {
	return defined( 'SML_CONNECT_ADMIN_API_SECRET' )
		? trim( (string) SML_CONNECT_ADMIN_API_SECRET ) : '';
}

function smlcda_configured() {
	return '' !== smlcda_api_url() && '' !== smlcda_api_secret();
}

/* ---------------------------------------------------------------------------
 * Signed platform calls. Same outbound scheme as the billing bridge:
 * HMAC-SHA256 over "{timestamp}.{body}", sent as "sha256=" + hex in
 * x-sml-signature with the unix timestamp in x-sml-timestamp.
 * ------------------------------------------------------------------------ */

function smlcda_signature( $timestamp, $body, $secret ) {
	return 'sha256=' . hash_hmac( 'sha256', $timestamp . '.' . $body, $secret );
}

/** Server-to-server only. Never expose the secret or call this from browser JS. */
function smlcda_call( $path, array $data ) {
	if ( ! smlcda_configured() ) {
		return new WP_Error( 'smlcda_unconfigured', 'Dispute admin API is not configured (SML_CONNECT_ADMIN_API_URL / SML_CONNECT_ADMIN_API_SECRET).' );
	}
	$body      = wp_json_encode( $data );
	$timestamp = (string) time();
	$response  = wp_remote_post( smlcda_api_url() . $path, array(
		'timeout' => 10,
		'headers' => array(
			'Content-Type'    => 'application/json',
			'X-SML-Timestamp' => $timestamp,
			'X-SML-Signature' => smlcda_signature( $timestamp, $body, smlcda_api_secret() ),
		),
		'body'    => $body,
	) );
	if ( is_wp_error( $response ) ) return $response;
	$code   = wp_remote_retrieve_response_code( $response );
	$result = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( $code >= 300 || ! is_array( $result ) || empty( $result['ok'] ) ) {
		$message = is_array( $result ) && isset( $result['message'] )
			? sanitize_text_field( $result['message'] )
			: ( is_array( $result ) && isset( $result['error'] ) ? sanitize_text_field( $result['error'] ) : 'Dispute service request failed.' );
		return new WP_Error( 'smlcda_api_failed', $message, array( 'status' => $code ) );
	}
	return $result;
}

/** Read a field from a platform row accepting camelCase or snake_case keys. */
function smlcda_field( $row, array $keys, $fallback = '' ) {
	if ( ! is_array( $row ) ) return $fallback;
	foreach ( $keys as $key ) {
		if ( isset( $row[ $key ] ) && ! is_array( $row[ $key ] ) ) return $row[ $key ];
	}
	return $fallback;
}

function smlcda_money( $cents, $currency ) {
	if ( '' === $cents || null === $cents || ! is_numeric( $cents ) ) return '-';
	return sprintf( '%s %s', number_format_i18n( ( (int) $cents ) / 100, 2 ), strtoupper( sanitize_text_field( (string) $currency ) ) );
}

/* ---------------------------------------------------------------------------
 * Admin menu page.
 * ------------------------------------------------------------------------ */

function smlcda_admin_url( array $args = array() ) {
	return add_query_arg( $args, admin_url( 'admin.php?page=smlcda-disputes' ) );
}

add_action( 'admin_menu', function () {
	add_menu_page(
		'SML Disputes',
		'SML Disputes',
		'manage_options',
		'smlcda-disputes',
		'smlcda_render_admin_page',
		'dashicons-shield-alt',
		58
	);
} );

function smlcda_render_admin_page() {
	if ( ! current_user_can( 'manage_options' ) ) return;
	echo '<div class="wrap" id="smlcda-wrap"><h1>SML Connect Disputes</h1>';
	smlcda_render_flash();
	if ( ! smlcda_configured() ) {
		echo '<div class="notice notice-error"><p>' . esc_html( 'Define SML_CONNECT_ADMIN_API_URL and SML_CONNECT_ADMIN_API_SECRET in wp-config.php to enable this page.' ) . '</p></div></div>';
		return;
	}
	$view    = isset( $_GET['smlcda_view'] ) ? sanitize_key( wp_unslash( $_GET['smlcda_view'] ) ) : 'list';
	$case_id = isset( $_GET['smlcda_case'] ) ? absint( wp_unslash( $_GET['smlcda_case'] ) ) : 0;
	if ( 'detail' === $view && $case_id ) {
		smlcda_render_case_detail( $case_id );
	} else {
		smlcda_render_health_panel();
		smlcda_render_policy_panel();
		smlcda_render_cases_list();
	}
	echo '</div>';
}

function smlcda_render_flash() {
	if ( ! isset( $_GET['smlcda_msg'] ) ) return;
	$msg  = sanitize_text_field( wp_unslash( $_GET['smlcda_msg'] ) );
	$kind = isset( $_GET['smlcda_ok'] ) && '1' === $_GET['smlcda_ok'] ? 'notice-success' : 'notice-error';
	echo '<div class="notice ' . esc_attr( $kind ) . ' is-dismissible"><p>' . esc_html( $msg ) . '</p></div>';
}

/* --------------------------- connectivity health ------------------------- */

function smlcda_render_health_panel() {
	echo '<h2 id="smlcda-health-title">Connectivity health</h2>';
	echo '<table class="widefat striped" id="smlcda-health" style="max-width:760px"><tbody>';

	$health_row = 'unreachable';
	$health     = wp_remote_get( smlcda_api_url() . '/health', array( 'timeout' => 10 ) );
	if ( ! is_wp_error( $health ) && wp_remote_retrieve_response_code( $health ) < 300 ) {
		$health_row = 'ok';
	}
	echo '<tr><td>Platform /health</td><td>' . esc_html( $health_row ) . '</td></tr>';

	$ping = smlcda_call( '/v1/billing/disputes/list', array( 'limit' => 1 ) );
	if ( is_wp_error( $ping ) ) {
		echo '<tr><td>Signed dispute API ping</td><td>' . esc_html( 'failed: ' . $ping->get_error_message() ) . '</td></tr>';
	} else {
		echo '<tr><td>Signed dispute API ping</td><td>ok</td></tr>';
		$webhooks = isset( $ping['webhooks'] ) && is_array( $ping['webhooks'] ) ? $ping['webhooks'] : array();
		if ( $webhooks ) {
			foreach ( $webhooks as $provider => $info ) {
				$last_seen = is_array( $info )
					? smlcda_field( $info, array( 'lastSeenAt', 'last_seen_at', 'lastSeen', 'last_seen' ), 'never' )
					: $info;
				echo '<tr><td>' . esc_html( 'Webhook last seen: ' . sanitize_text_field( (string) $provider ) ) . '</td><td>' . esc_html( sanitize_text_field( (string) $last_seen ) ) . '</td></tr>';
			}
		} else {
			echo '<tr><td>Webhook last-seen</td><td>' . esc_html( 'not reported by the API' ) . '</td></tr>';
		}
	}
	echo '</tbody></table>';
}

/* ----------------------------- policy panel ------------------------------ */

function smlcda_render_policy_panel() {
	echo '<h2 id="smlcda-policy-title">Access policy while a dispute is open</h2>';
	echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" id="smlcda-policy-form">';
	wp_nonce_field( 'smlcda_policy' );
	echo '<input type="hidden" name="action" value="smlcda_policy">';
	echo '<table class="form-table" role="presentation" style="max-width:760px">';
	echo '<tr><th><label for="smlcda-policy-scope">Merchant scope</label></th><td><input class="regular-text" id="smlcda-policy-scope" name="merchant_scope" type="text" required></td></tr>';
	echo '<tr><th><label for="smlcda-policy-choice">While a case is open</label></th><td><select id="smlcda-policy-choice" name="on_dispute">';
	echo '<option value="keep_access">keep_access (default)</option>';
	echo '<option value="suspend_access">suspend_access</option>';
	echo '</select><p class="description">' . esc_html( 'Recorded on the platform; access changes flow only through the existing reconcile pipeline with an audit entry.' ) . '</p></td></tr>';
	echo '</table>';
	submit_button( 'Record policy', 'secondary', 'submit', false );
	echo '</form>';
}

add_action( 'admin_post_smlcda_policy', function () {
	if ( ! current_user_can( 'manage_options' ) ) wp_die( esc_html( 'Insufficient permissions.' ), 403 );
	check_admin_referer( 'smlcda_policy' );
	$scope  = isset( $_POST['merchant_scope'] ) ? sanitize_text_field( wp_unslash( $_POST['merchant_scope'] ) ) : '';
	$choice = isset( $_POST['on_dispute'] ) ? sanitize_key( wp_unslash( $_POST['on_dispute'] ) ) : '';
	if ( '' === $scope || ! in_array( $choice, array( 'keep_access', 'suspend_access' ), true ) ) {
		wp_safe_redirect( smlcda_admin_url( array( 'smlcda_msg' => 'Invalid policy input.', 'smlcda_ok' => '0' ) ) );
		exit;
	}
	$result = smlcda_call( '/v1/billing/disputes/record-policy', array(
		'merchantScope' => $scope,
		'onDispute'     => $choice,
		'wpUserId'      => get_current_user_id(),
	) );
	$args = is_wp_error( $result )
		? array( 'smlcda_msg' => 'Policy update failed: ' . $result->get_error_message(), 'smlcda_ok' => '0' )
		: array( 'smlcda_msg' => 'Policy recorded.', 'smlcda_ok' => '1' );
	wp_safe_redirect( smlcda_admin_url( $args ) );
	exit;
} );

/* ------------------------------ cases list ------------------------------- */

function smlcda_render_cases_list() {
	echo '<h2 id="smlcda-cases-title">Open dispute cases</h2>';
	$result = smlcda_call( '/v1/billing/disputes/list', array() );
	if ( is_wp_error( $result ) ) {
		echo '<div class="notice notice-error"><p>' . esc_html( 'Could not load cases: ' . $result->get_error_message() ) . '</p></div>';
		return;
	}
	$cases = isset( $result['cases'] ) && is_array( $result['cases'] ) ? $result['cases'] : array();
	if ( ! $cases ) {
		echo '<p>' . esc_html( 'No dispute cases reported by the platform.' ) . '</p>';
		return;
	}
	echo '<table class="widefat striped" id="smlcda-cases"><thead><tr>';
	foreach ( array( 'Case', 'Provider', 'Reason', 'Amount', 'Response due', 'State', 'Completeness', '' ) as $head ) {
		echo '<th>' . esc_html( $head ) . '</th>';
	}
	echo '</tr></thead><tbody>';
	foreach ( $cases as $case ) {
		$id           = absint( smlcda_field( $case, array( 'id', 'caseId', 'case_id' ), 0 ) );
		$provider     = sanitize_text_field( (string) smlcda_field( $case, array( 'provider' ) ) );
		$reason       = sanitize_text_field( (string) smlcda_field( $case, array( 'reason' ) ) );
		$amount       = smlcda_money( smlcda_field( $case, array( 'amountCents', 'amount_cents' ), null ), smlcda_field( $case, array( 'currency' ) ) );
		$due_by       = sanitize_text_field( (string) smlcda_field( $case, array( 'dueBy', 'due_by' ), '-' ) );
		$state        = sanitize_text_field( (string) smlcda_field( $case, array( 'caseState', 'case_state' ) ) );
		$completeness = sanitize_text_field( (string) smlcda_field( $case, array( 'completeness' ), '-' ) );
		echo '<tr>';
		echo '<td>' . esc_html( (string) $id ) . '</td>';
		echo '<td>' . esc_html( $provider ) . '</td>';
		echo '<td>' . esc_html( $reason ) . '</td>';
		echo '<td>' . esc_html( $amount ) . '</td>';
		echo '<td>' . esc_html( $due_by ) . '</td>';
		echo '<td>' . esc_html( $state ) . '</td>';
		echo '<td>' . esc_html( $completeness ) . '</td>';
		echo '<td><a class="button" href="' . esc_url( smlcda_admin_url( array( 'smlcda_view' => 'detail', 'smlcda_case' => $id ) ) ) . '">Review</a></td>';
		echo '</tr>';
	}
	echo '</tbody></table>';
}

/* --------------------------- case detail + review ------------------------ */

function smlcda_render_case_detail( $case_id ) {
	echo '<p><a href="' . esc_url( smlcda_admin_url() ) . '">&larr; Back to cases</a></p>';
	$result = smlcda_call( '/v1/billing/disputes/detail', array( 'caseId' => $case_id ) );
	if ( is_wp_error( $result ) ) {
		echo '<div class="notice notice-error"><p>' . esc_html( 'Could not load case: ' . $result->get_error_message() ) . '</p></div>';
		return;
	}
	smlcda_render_review_ui( $result, array(
		'approve_action' => 'smlcda_approve',
		'allow_build'    => true,
	) );
}

/**
 * Shared review renderer used by the wp-admin page and /connect-review/.
 * $detail is the platform detail/redeem response; $context controls actions.
 */
function smlcda_render_review_ui( array $detail, array $context ) {
	$case    = isset( $detail['case'] ) && is_array( $detail['case'] ) ? $detail['case'] : $detail;
	$case_id = absint( smlcda_field( $case, array( 'id', 'caseId', 'case_id' ), 0 ) );

	echo '<h2 id="smlcda-case-title">' . esc_html( sprintf( 'Case %d - %s - %s', $case_id, (string) smlcda_field( $case, array( 'provider' ) ), (string) smlcda_field( $case, array( 'reason' ) ) ) ) . '</h2>';
	echo '<table class="widefat striped" id="smlcda-case-facts" style="max-width:760px"><tbody>';
	$facts = array(
		'Provider dispute id' => smlcda_field( $case, array( 'providerDisputeId', 'provider_dispute_id' ) ),
		'Amount'              => smlcda_money( smlcda_field( $case, array( 'amountCents', 'amount_cents' ), null ), smlcda_field( $case, array( 'currency' ) ) ),
		'Response due'        => smlcda_field( $case, array( 'dueBy', 'due_by' ), '-' ),
		'State'               => smlcda_field( $case, array( 'caseState', 'case_state' ) ),
		'Lifecycle stage'     => smlcda_field( $case, array( 'lifecycleStage', 'lifecycle_stage' ), '-' ),
		'Response cycle'      => smlcda_field( $case, array( 'responseCycle', 'response_cycle' ), '1' ),
	);
	foreach ( $facts as $label => $value ) {
		echo '<tr><td>' . esc_html( $label ) . '</td><td>' . esc_html( sanitize_text_field( (string) $value ) ) . '</td></tr>';
	}
	echo '</tbody></table>';

	if ( ! empty( $context['allow_build'] ) ) {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" id="smlcda-build-form" style="margin:12px 0">';
		wp_nonce_field( 'smlcda_build_' . $case_id );
		echo '<input type="hidden" name="action" value="smlcda_build">';
		echo '<input type="hidden" name="case_id" value="' . esc_attr( (string) $case_id ) . '">';
		submit_button( 'Build / refresh evidence packet', 'secondary', 'submit', false );
		echo '</form>';
	}

	$packet = isset( $detail['packet'] ) && is_array( $detail['packet'] ) ? $detail['packet'] : null;
	if ( ! $packet ) {
		echo '<p id="smlcda-no-packet">' . esc_html( 'No evidence packet has been built for this case yet.' ) . '</p>';
		return;
	}
	$packet_id      = absint( smlcda_field( $packet, array( 'id', 'packetId', 'packet_id' ), 0 ) );
	$packet_version = absint( smlcda_field( $packet, array( 'version', 'packetVersion', 'packet_version' ), 0 ) );
	$manifest       = isset( $packet['manifest'] ) && is_array( $packet['manifest'] ) ? $packet['manifest'] : array();

	echo '<h3 id="smlcda-packet-title">' . esc_html( sprintf( 'Evidence packet version %d', $packet_version ) ) . '</h3>';

	$warnings = isset( $packet['warnings'] ) && is_array( $packet['warnings'] ) ? $packet['warnings'] : array();
	if ( $warnings ) {
		echo '<div class="notice notice-warning inline" id="smlcda-warnings"><p><strong>' . esc_html( 'Warnings' ) . '</strong></p><ul>';
		foreach ( $warnings as $warning ) {
			$code   = is_array( $warning ) ? smlcda_field( $warning, array( 'code' ) ) : $warning;
			$explan = is_array( $warning ) ? smlcda_field( $warning, array( 'detail' ) ) : '';
			echo '<li>' . esc_html( trim( sanitize_text_field( (string) $code ) . ' ' . sanitize_text_field( (string) $explan ) ) ) . '</li>';
		}
		echo '</ul></div>';
	}

	$assertions = isset( $manifest['assertions'] ) && is_array( $manifest['assertions'] ) ? $manifest['assertions'] : array();
	echo '<h4>' . esc_html( 'Assertions (each cites its evidence records)' ) . '</h4>';
	if ( $assertions ) {
		echo '<table class="widefat striped" id="smlcda-assertions"><thead><tr><th>' . esc_html( 'Assertion' ) . '</th><th>' . esc_html( 'Kind' ) . '</th><th>' . esc_html( 'Evidence item ids' ) . '</th></tr></thead><tbody>';
		foreach ( $assertions as $assertion ) {
			$text = sanitize_text_field( (string) smlcda_field( $assertion, array( 'text' ) ) );
			$kind = sanitize_text_field( (string) smlcda_field( $assertion, array( 'kind' ) ) );
			$ids  = array();
			$raw_ids = isset( $assertion['evidence_item_ids'] ) ? $assertion['evidence_item_ids'] : ( isset( $assertion['evidenceItemIds'] ) ? $assertion['evidenceItemIds'] : array() );
			foreach ( (array) $raw_ids as $eid ) $ids[] = absint( $eid );
			echo '<tr><td>' . esc_html( $text ) . '</td><td>' . esc_html( $kind ) . '</td><td>' . esc_html( implode( ', ', $ids ) ) . '</td></tr>';
		}
		echo '</tbody></table>';
	} else {
		echo '<p>' . esc_html( 'The packet contains no assertions.' ) . '</p>';
	}

	echo '<h4>' . esc_html( 'Exact files and fields that will be transmitted' ) . '</h4>';
	echo '<table class="widefat striped" id="smlcda-transmit"><thead><tr><th>' . esc_html( 'Item' ) . '</th><th>' . esc_html( 'Value / file' ) . '</th></tr></thead><tbody>';
	$transmit_rows = 0;
	$fields = isset( $detail['transmitFields'] ) && is_array( $detail['transmitFields'] ) ? $detail['transmitFields'] : array();
	if ( ! $fields && isset( $manifest['transmitFields'] ) && is_array( $manifest['transmitFields'] ) ) $fields = $manifest['transmitFields'];
	foreach ( $fields as $name => $value ) {
		$rendered = is_array( $value ) ? wp_json_encode( $value ) : (string) $value;
		echo '<tr><td>' . esc_html( 'Field: ' . sanitize_text_field( (string) $name ) ) . '</td><td>' . esc_html( sanitize_textarea_field( $rendered ) ) . '</td></tr>';
		$transmit_rows++;
	}
	$files = isset( $detail['transmitFiles'] ) && is_array( $detail['transmitFiles'] ) ? $detail['transmitFiles'] : array();
	if ( ! $files && isset( $manifest['transmitFiles'] ) && is_array( $manifest['transmitFiles'] ) ) $files = $manifest['transmitFiles'];
	foreach ( $files as $file ) {
		$name   = sanitize_text_field( (string) smlcda_field( $file, array( 'fileName', 'file_name', 'name' ) ) );
		$sha    = sanitize_text_field( (string) smlcda_field( $file, array( 'fileSha256', 'file_sha256', 'sha256' ) ) );
		$target = sanitize_text_field( (string) smlcda_field( $file, array( 'evidenceType', 'evidence_type', 'field' ) ) );
		echo '<tr><td>' . esc_html( 'File: ' . $name ) . '</td><td>' . esc_html( trim( $target . ' sha256:' . $sha ) ) . '</td></tr>';
		$transmit_rows++;
	}
	if ( ! $transmit_rows ) {
		echo '<tr><td colspan="2">' . esc_html( 'The platform did not report transmit fields for this packet.' ) . '</td></tr>';
	}
	echo '</tbody></table>';

	if ( empty( $context['approve_action'] ) || ! $packet_version ) return;

	echo '<h3 id="smlcda-approve-title">' . esc_html( 'Approve and submit' ) . '</h3>';
	echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" id="smlcda-approve-form">';
	wp_nonce_field( 'smlcda_approve_' . $case_id );
	echo '<input type="hidden" name="action" value="' . esc_attr( $context['approve_action'] ) . '">';
	echo '<input type="hidden" name="case_id" value="' . esc_attr( (string) $case_id ) . '">';
	echo '<input type="hidden" name="packet_id" value="' . esc_attr( (string) $packet_id ) . '">';
	echo '<input type="hidden" name="packet_version" value="' . esc_attr( (string) $packet_version ) . '">';
	if ( ! empty( $context['review_ref'] ) ) {
		echo '<input type="hidden" name="review_ref" value="' . esc_attr( (string) $context['review_ref'] ) . '">';
	}
	echo '<input type="hidden" name="confirmation_label" value="' . esc_attr( smlcda_confirmation_label() ) . '">';
	echo '<p><label for="smlcda-confirm"><input type="checkbox" id="smlcda-confirm" name="smlcda_confirm" value="1" required> ';
	echo esc_html( smlcda_confirmation_label() );
	echo '</label></p>';
	submit_button( 'Submit this packet to the provider', 'primary', 'submit', false );
	echo '</form>';
}

function smlcda_confirmation_label() {
	return 'I have reviewed every assertion, file, and field listed above and approve submitting this exact evidence packet to the payment provider.';
}

add_action( 'admin_post_smlcda_build', function () {
	if ( ! current_user_can( 'manage_options' ) ) wp_die( esc_html( 'Insufficient permissions.' ), 403 );
	$case_id = isset( $_POST['case_id'] ) ? absint( wp_unslash( $_POST['case_id'] ) ) : 0;
	check_admin_referer( 'smlcda_build_' . $case_id );
	$result = smlcda_call( '/v1/billing/disputes/build-packet', array(
		'caseId'   => $case_id,
		'wpUserId' => get_current_user_id(),
	) );
	$args = is_wp_error( $result )
		? array( 'smlcda_msg' => 'Packet build failed: ' . $result->get_error_message(), 'smlcda_ok' => '0' )
		: array( 'smlcda_msg' => 'Packet built.', 'smlcda_ok' => '1' );
	wp_safe_redirect( smlcda_admin_url( array_merge( $args, array( 'smlcda_view' => 'detail', 'smlcda_case' => $case_id ) ) ) );
	exit;
} );

/**
 * Shared approval processor. Authorization is enforced server-side twice:
 * here (logged-in + nonce + capability) and again by the platform, which
 * re-verifies the WordPress user against the case's merchant scope before
 * submitting anything. Nothing about approval is decided in browser JS.
 */
function smlcda_process_approval( $require_manage_options ) {
	if ( ! is_user_logged_in() ) wp_die( esc_html( 'Login required.' ), 403 );
	if ( $require_manage_options && ! current_user_can( 'manage_options' ) ) wp_die( esc_html( 'Insufficient permissions.' ), 403 );
	$case_id = isset( $_POST['case_id'] ) ? absint( wp_unslash( $_POST['case_id'] ) ) : 0;
	check_admin_referer( 'smlcda_approve_' . $case_id );

	$packet_id      = isset( $_POST['packet_id'] ) ? absint( wp_unslash( $_POST['packet_id'] ) ) : 0;
	$packet_version = isset( $_POST['packet_version'] ) ? absint( wp_unslash( $_POST['packet_version'] ) ) : 0;
	$confirmed      = isset( $_POST['smlcda_confirm'] ) && '1' === $_POST['smlcda_confirm'];
	$posted_label   = isset( $_POST['confirmation_label'] ) ? sanitize_textarea_field( wp_unslash( $_POST['confirmation_label'] ) ) : '';
	$review_ref     = isset( $_POST['review_ref'] ) ? sanitize_text_field( wp_unslash( $_POST['review_ref'] ) ) : '';

	if ( ! $case_id || ! $packet_version || ! $confirmed || $posted_label !== smlcda_confirmation_label() ) {
		return new WP_Error( 'smlcda_confirmation', 'The confirmation checkbox and its label must accompany an approval.' );
	}

	return smlcda_call( '/v1/billing/disputes/approve-submit', array(
		'caseId'        => $case_id,
		'packetId'      => $packet_id,
		'packetVersion' => $packet_version,
		'wpUserId'      => get_current_user_id(),
		'reviewRef'     => $review_ref,
		'confirmation'  => array(
			'checkboxLabel' => $posted_label,
			'page'          => $require_manage_options ? 'wp-admin:smlcda-disputes' : 'connect-review',
			'wpUserLogin'   => wp_get_current_user()->user_login,
		),
	) );
}

add_action( 'admin_post_smlcda_approve', function () {
	$case_id = isset( $_POST['case_id'] ) ? absint( wp_unslash( $_POST['case_id'] ) ) : 0;
	$result  = smlcda_process_approval( true );
	$args    = is_wp_error( $result )
		? array( 'smlcda_msg' => 'Submission failed: ' . $result->get_error_message(), 'smlcda_ok' => '0' )
		: array( 'smlcda_msg' => 'Evidence packet submitted for provider review.', 'smlcda_ok' => '1' );
	wp_safe_redirect( smlcda_admin_url( array_merge( $args, array( 'smlcda_view' => 'detail', 'smlcda_case' => $case_id ) ) ) );
	exit;
} );

/* Approval arriving from the /connect-review/ page: the platform re-verifies
   the WordPress user's scope (group owner or admin) before submitting. */
add_action( 'admin_post_smlcda_review_approve', function () {
	$result  = smlcda_process_approval( current_user_can( 'manage_options' ) ? true : false );
	$message = is_wp_error( $result )
		? 'Submission failed: ' . $result->get_error_message()
		: 'Evidence packet submitted for provider review.';
	wp_safe_redirect( add_query_arg( array( 'smlcda_msg' => rawurlencode( $message ) ), home_url( '/connect-review/' ) ) );
	exit;
} );

/* ---------------------------------------------------------------------------
 * /connect-review/ rewrite endpoint.
 * A review token arrives as ?t=... . Possession of the token alone renders
 * nothing: the visitor must be logged in AND hold manage_options, or the
 * platform must confirm group-owner capability for this WordPress user when
 * the token is redeemed. All checks are server-side.
 * ------------------------------------------------------------------------ */

add_action( 'init', function () {
	add_rewrite_rule( '^connect-review/?$', 'index.php?smlcda_review=1', 'top' );
} );

add_filter( 'query_vars', function ( $vars ) {
	$vars[] = 'smlcda_review';
	return $vars;
} );

register_activation_hook( __FILE__, function () {
	add_rewrite_rule( '^connect-review/?$', 'index.php?smlcda_review=1', 'top' );
	flush_rewrite_rules();
} );

register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );

add_action( 'template_redirect', function () {
	if ( '1' !== get_query_var( 'smlcda_review' ) ) return;

	if ( ! is_user_logged_in() ) {
		auth_redirect();
		exit;
	}

	$message = isset( $_GET['smlcda_msg'] ) ? sanitize_text_field( wp_unslash( $_GET['smlcda_msg'] ) ) : '';
	$token   = isset( $_GET['t'] ) ? sanitize_text_field( wp_unslash( $_GET['t'] ) ) : '';

	status_header( 200 );
	nocache_headers();

	if ( '' === $token ) {
		smlcda_review_shell( $message ? $message : 'This review link is missing its token.', null );
		exit;
	}
	if ( ! smlcda_configured() ) {
		smlcda_review_shell( 'The dispute review service is not configured.', null );
		exit;
	}

	$has_manage = current_user_can( 'manage_options' );
	$redeem     = smlcda_call( '/v1/billing/disputes/redeem-review-token', array(
		'token'         => $token,
		'wpUserId'      => get_current_user_id(),
		'manageOptions' => $has_manage,
	) );

	if ( is_wp_error( $redeem ) ) {
		/* Covers expired/used tokens AND WordPress users the platform does not
		   recognize as an admin or the case's group owner. No case data is
		   rendered in either situation. */
		smlcda_review_shell( 'This review link could not be validated for your account.', null );
		exit;
	}
	if ( ! $has_manage && empty( $redeem['authorized'] ) ) {
		smlcda_review_shell( 'Your account is not authorized to review this case.', null );
		exit;
	}

	smlcda_review_shell( $message, function () use ( $redeem ) {
		smlcda_render_review_ui( $redeem, array(
			'approve_action' => 'smlcda_review_approve',
			'allow_build'    => false,
			'review_ref'     => sanitize_text_field( (string) smlcda_field( $redeem, array( 'reviewRef', 'review_ref' ) ) ),
		) );
	} );
	exit;
} );

/** Minimal themed shell for the front-end review page. */
function smlcda_review_shell( $notice, $body_renderer ) {
	get_header();
	echo '<div id="smlcda-review-wrap" style="max-width:960px;margin:32px auto;padding:0 16px">';
	echo '<h1>' . esc_html( 'Dispute packet review' ) . '</h1>';
	if ( $notice ) {
		echo '<div class="notice notice-info"><p>' . esc_html( $notice ) . '</p></div>';
	}
	if ( is_callable( $body_renderer ) ) {
		call_user_func( $body_renderer );
	}
	echo '</div>';
	get_footer();
}

/* ---------------------------------------------------------------------------
 * dispute_notify adapter: bridge intent -> admin notice transient + email.
 * Wording is factual and neutral; it reports record identifiers only.
 * ------------------------------------------------------------------------ */

add_action( 'sml_platform_dispute_notify', 'smlcda_dispute_notify_adapter', 10, 2 );

function smlcda_dispute_notify_adapter( $data, $source ) {
	$data     = is_array( $data ) ? $data : array();
	$case_id  = sanitize_text_field( (string) smlcda_field( $data, array( 'caseId', 'case_id' ), 'unknown' ) );
	$provider = sanitize_text_field( (string) smlcda_field( $data, array( 'provider' ), 'unknown' ) );
	$notice   = sanitize_text_field( (string) smlcda_field( $data, array( 'noticeType', 'notice_type', 'stage' ), 'update' ) );
	$due_by   = sanitize_text_field( (string) smlcda_field( $data, array( 'dueBy', 'due_by' ), '' ) );

	$message = sprintf( 'A payment dispute notification was received. Case: %s. Provider: %s. Type: %s.', $case_id, $provider, $notice );
	if ( '' !== $due_by ) $message .= sprintf( ' Response due: %s.', $due_by );

	$notices = get_transient( 'smlcda_dispute_notices' );
	if ( ! is_array( $notices ) ) $notices = array();
	$notices[] = array( 'message' => $message, 'source' => sanitize_text_field( (string) $source ) );
	set_transient( 'smlcda_dispute_notices', array_slice( $notices, -10 ), DAY_IN_SECONDS );

	wp_mail(
		get_option( 'admin_email' ),
		'StockMarketLoop dispute notification',
		$message . ' Review the case at: ' . admin_url( 'admin.php?page=smlcda-disputes' )
	);
}

add_action( 'admin_notices', function () {
	if ( ! current_user_can( 'manage_options' ) ) return;
	$notices = get_transient( 'smlcda_dispute_notices' );
	if ( ! is_array( $notices ) || ! $notices ) return;
	$dismiss_url = wp_nonce_url( admin_url( 'admin-post.php?action=smlcda_dismiss_notices' ), 'smlcda_dismiss' );
	echo '<div class="notice notice-warning" id="smlcda-notify">';
	foreach ( $notices as $entry ) {
		echo '<p>' . esc_html( sanitize_text_field( (string) ( $entry['message'] ?? '' ) ) ) . '</p>';
	}
	echo '<p><a class="button" href="' . esc_url( admin_url( 'admin.php?page=smlcda-disputes' ) ) . '">' . esc_html( 'Open dispute console' ) . '</a> ';
	echo '<a class="button" href="' . esc_url( $dismiss_url ) . '">' . esc_html( 'Dismiss' ) . '</a></p>';
	echo '</div>';
} );

add_action( 'admin_post_smlcda_dismiss_notices', function () {
	if ( ! current_user_can( 'manage_options' ) ) wp_die( esc_html( 'Insufficient permissions.' ), 403 );
	check_admin_referer( 'smlcda_dismiss' );
	delete_transient( 'smlcda_dispute_notices' );
	wp_safe_redirect( smlcda_admin_url() );
	exit;
} );
