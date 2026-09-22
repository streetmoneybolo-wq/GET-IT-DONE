<?php
/**
 * Plugin Name: SML Member Email Analytics
 * Description: Owner-only Upgrade.Chat/Stripe contact analytics, renewal queue controls, and consent-gated member offers.
 * Version: 0.1.0
 * Author: Stock Market Loop
 */

defined( 'ABSPATH' ) || exit;

function smlmea_activate() {
	$user = wp_get_current_user();
	if ( $user && $user->exists() && $user->has_cap( 'manage_options' ) ) {
		$user->add_cap( 'view_sml_member_emails', true );
	}
}
register_activation_hook( __FILE__, 'smlmea_activate' );

function smlmea_can_manage() {
	return current_user_can( 'view_sml_member_emails' );
}

function smlmea_api_url() {
	return defined( 'SML_PLATFORM_API_URL' ) ? untrailingslashit( trim( (string) SML_PLATFORM_API_URL ) ) : '';
}
function smlmea_api_secret() {
	return defined( 'SML_PLATFORM_BILLING_API_SECRET' ) ? trim( (string) SML_PLATFORM_BILLING_API_SECRET ) : '';
}
function smlmea_call( $path, array $data ) {
	if ( '' === smlmea_api_url() || '' === smlmea_api_secret() ) return new WP_Error( 'smlmea_unconfigured', 'Platform API configuration is missing.' );
	$body = wp_json_encode( $data );
	$ts   = (string) time();
	$res  = wp_remote_post( smlmea_api_url() . $path, array(
		'timeout' => 30,
		'headers' => array(
			'Content-Type' => 'application/json',
			'X-SML-Timestamp' => $ts,
			'X-SML-Signature' => 'sha256=' . hash_hmac( 'sha256', $ts . '.' . $body, smlmea_api_secret() ),
		),
		'body' => $body,
	) );
	if ( is_wp_error( $res ) ) return $res;
	$result = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( wp_remote_retrieve_response_code( $res ) >= 300 || ! is_array( $result ) || empty( $result['ok'] ) ) {
		return new WP_Error( 'smlmea_api', is_array( $result ) && isset( $result['error'] ) ? sanitize_text_field( $result['error'] ) : 'Platform request failed.' );
	}
	return $result;
}

add_action( 'admin_menu', function () {
	add_menu_page( 'Member Email Analytics', 'Member Emails', 'view_sml_member_emails', 'sml-member-emails', 'smlmea_page', 'dashicons-email-alt2', 59 );
} );

function smlmea_redirect( $message, $ok = true ) {
	wp_safe_redirect( add_query_arg( array( 'page' => 'sml-member-emails', 'smlmea_msg' => $message, 'smlmea_ok' => $ok ? '1' : '0' ), admin_url( 'admin.php' ) ) );
	exit;
}

add_action( 'admin_post_smlmea_sync', function () {
	if ( ! smlmea_can_manage() ) wp_die( 'Forbidden', 403 );
	check_admin_referer( 'smlmea_sync' );
	$result = smlmea_call( '/v1/member-email/sync', array( 'limit' => 500 ) );
	smlmea_redirect( is_wp_error( $result ) ? $result->get_error_message() : sprintf( 'Synchronized %d contact records.', (int) $result['imported'] ), ! is_wp_error( $result ) );
} );

add_action( 'admin_post_smlmea_renewals', function () {
	if ( ! smlmea_can_manage() ) wp_die( 'Forbidden', 403 );
	check_admin_referer( 'smlmea_renewals' );
	$result = smlmea_call( '/v1/member-email/queue-renewals', array( 'daysBefore' => 7 ) );
	smlmea_redirect( is_wp_error( $result ) ? $result->get_error_message() : sprintf( 'Queued %d renewal notices.', (int) $result['queued'] ), ! is_wp_error( $result ) );
} );

add_action( 'admin_post_smlmea_offer', function () {
	if ( ! smlmea_can_manage() ) wp_die( 'Forbidden', 403 );
	check_admin_referer( 'smlmea_offer' );
	$subject = isset( $_POST['subject'] ) ? sanitize_text_field( wp_unslash( $_POST['subject'] ) ) : '';
	$key     = isset( $_POST['campaign_key'] ) ? sanitize_key( wp_unslash( $_POST['campaign_key'] ) ) : '';
	$html    = isset( $_POST['offer_html'] ) ? wp_kses_post( wp_unslash( $_POST['offer_html'] ) ) : '';
	$result  = smlmea_call( '/v1/member-email/special-offer', array( 'subject' => $subject, 'campaignKey' => $key, 'html' => $html ) );
	smlmea_redirect( is_wp_error( $result ) ? $result->get_error_message() : sprintf( 'Queued %d consented member offers.', (int) $result['queued'] ), ! is_wp_error( $result ) );
} );

function smlmea_page() {
	if ( ! smlmea_can_manage() ) wp_die( 'Forbidden', 403 );
	$data = smlmea_call( '/v1/member-email/analytics', array( 'limit' => 500, 'includeRawEmails' => true ) );
	echo '<div class="wrap"><h1>StockMarketLoop Member Email Analytics</h1>';
	echo '<p>Private owner view. Email addresses must never be copied into Google Analytics, URLs, Discord, or browser-side tracking events.</p>';
	if ( isset( $_GET['smlmea_msg'] ) ) {
		$ok = isset( $_GET['smlmea_ok'] ) && '1' === $_GET['smlmea_ok'];
		echo '<div class="notice ' . esc_attr( $ok ? 'notice-success' : 'notice-error' ) . '"><p>' . esc_html( sanitize_text_field( wp_unslash( $_GET['smlmea_msg'] ) ) ) . '</p></div>';
	}
	if ( is_wp_error( $data ) ) {
		echo '<div class="notice notice-error"><p>' . esc_html( $data->get_error_message() ) . '</p></div></div>';
		return;
	}
	$summary = isset( $data['summary'] ) && is_array( $data['summary'] ) ? $data['summary'] : array();
	echo '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:18px 0">';
	foreach ( array( 'contacts' => 'Contacts', 'upgrade_chat' => 'Upgrade.Chat', 'stripe' => 'Stripe', 'marketing_opted_in' => 'Marketing opt-ins', 'suppressed' => 'Suppressed' ) as $key => $label ) {
		echo '<div class="card" style="min-width:150px"><h3>' . esc_html( $label ) . '</h3><strong style="font-size:26px">' . esc_html( isset( $summary[ $key ] ) ? (string) $summary[ $key ] : '0' ) . '</strong></div>';
	}
	echo '</div><div style="display:flex;gap:10px">';
	echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="smlmea_sync">'; wp_nonce_field( 'smlmea_sync' ); submit_button( 'Sync billing contacts', 'secondary', 'submit', false ); echo '</form>';
	echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '"><input type="hidden" name="action" value="smlmea_renewals">'; wp_nonce_field( 'smlmea_renewals' ); submit_button( 'Queue 7-day renewal notices', 'secondary', 'submit', false ); echo '</form></div>';
	echo '<h2>Contacts</h2><table class="widefat striped"><thead><tr><th>Email</th><th>Source</th><th>Discord ID</th><th>Renewal</th><th>Marketing</th><th>Last sync</th></tr></thead><tbody>';
	foreach ( (array) $data['contacts'] as $row ) {
		echo '<tr><td>' . esc_html( (string) $row['email'] ) . '</td><td>' . esc_html( (string) $row['source'] ) . '</td><td><code>' . esc_html( (string) $row['discordUserId'] ) . '</code></td><td>' . esc_html( (string) $row['renewalAt'] ) . '</td><td>' . esc_html( ! empty( $row['marketingOptIn'] ) ? 'Opted in' : 'Not opted in' ) . '</td><td>' . esc_html( (string) $row['lastSyncedAt'] ) . '</td></tr>';
	}
	echo '</tbody></table><h2>Special offer</h2><p>Only contacts with affirmative marketing consent receive this campaign.</p>';
	echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="max-width:800px"><input type="hidden" name="action" value="smlmea_offer">'; wp_nonce_field( 'smlmea_offer' );
	echo '<p><label>Campaign key<br><input class="regular-text" required name="campaign_key" placeholder="fall-member-offer-2026"></label></p>';
	echo '<p><label>Subject<br><input class="large-text" required maxlength="180" name="subject"></label></p>';
	echo '<p><label>Message<br><textarea class="large-text" required rows="8" name="offer_html"></textarea></label></p>';
	submit_button( 'Queue offer for opted-in members' ); echo '</form></div>';
}
