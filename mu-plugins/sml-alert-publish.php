<?php
/**
 * Plugin Name: SML Alert Publish (Academy to StockMarketLoop group to Discord)
 * Description: Lets sml-platform-api publish a Click-to-Alert as a StockMarketLoop group alert under the member's own site account (for example Grandmaster-Obi): the typed alert text, the exact price and time, and the two scenario pictures. The existing SML Alert Router then hands it to the Alert Bot, which posts it in Discord. HMAC-guarded with the LOOP-KICK bridge secret. Only a linked, email-verified member who manages the group may publish into it.
 * Version: 1.0.0
 *
 * Depends on sml-loop-kick-discord.php (signature check, link table) and the sml_alert post type. Fails closed (503) if either is missing.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_ap_ready() {
	return function_exists( 'sml_lkd_verify_signed' ) && function_exists( 'sml_lkd_signed_json' ) && function_exists( 'sml_lkd_bridge_secret' ) && post_type_exists( 'sml_alert' );
}

/** May this site user publish alerts into this group? Group managers and site admins only. */
function sml_ap_can_post( $user_id, $group_id ) {
	$user_id = absint( $user_id ); $group_id = absint( $group_id );
	if ( ! $user_id || ! $group_id ) { return false; }
	if ( user_can( $user_id, 'manage_options' ) ) { return true; }
	return function_exists( 'sml_dgc_can_manage' ) && (bool) sml_dgc_can_manage( $group_id, $user_id );
}

/** Save one PNG (base64) to the media library and attach it to the alert post; returns the attachment id or 0. */
function sml_ap_store_image( $post_id, $name, $b64, $alt ) {
	$bytes = base64_decode( (string) $b64, true );
	if ( false === $bytes || strlen( $bytes ) < 100 || strlen( $bytes ) > 3 * 1024 * 1024 ) { return 0; }
	if ( "\x89PNG" !== substr( $bytes, 0, 4 ) ) { return 0; } // PNG charts only
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';
	$file = wp_upload_bits( sanitize_file_name( $name ?: 'scenario.png' ), null, $bytes );
	if ( ! empty( $file['error'] ) ) { return 0; }
	$id = wp_insert_attachment( array( 'post_mime_type' => 'image/png', 'post_title' => sanitize_text_field( $alt ?: 'Scenario chart' ), 'post_status' => 'inherit' ), $file['file'], $post_id );
	if ( is_wp_error( $id ) || ! $id ) { return 0; }
	wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $file['file'] ) );
	update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( $alt ) );
	return (int) $id;
}

function sml_ap_rest( WP_REST_Request $request ) {
	if ( ! sml_ap_ready() ) { return new WP_Error( 'sml_ap_unavailable', 'Alert publishing is unavailable.', array( 'status' => 503 ) ); }
	$ok = sml_lkd_verify_signed( $request, sml_lkd_bridge_secret(), 'x-sml-lk-timestamp', 'x-sml-lk-signature' );
	if ( is_wp_error( $ok ) ) { return $ok; }
	global $wpdb;
	$b   = sml_lkd_signed_json( $request );
	$did = preg_replace( '/\D/', '', (string) ( $b['discord_user_id'] ?? '' ) );
	$gid = absint( $b['group_id'] ?? 0 );
	$ref = preg_replace( '/[^A-Za-z0-9:_-]/', '', (string) ( $b['ref'] ?? '' ) );
	$text = trim( (string) ( $b['body'] ?? '' ) );
	if ( ! preg_match( '/^\d{15,24}$/', $did ) || ! $gid || strlen( $ref ) < 12 || '' === $text || strlen( $text ) > 3800 ) {
		return new WP_Error( 'sml_ap_payload', 'Invalid alert.', array( 'status' => 400 ) );
	}
	// the same alert (same ref) never publishes twice
	$dupe = get_posts( array( 'post_type' => 'sml_alert', 'post_status' => 'any', 'meta_key' => '_sml_ap_ref', 'meta_value' => $ref, 'fields' => 'ids', 'posts_per_page' => 1 ) );
	if ( $dupe ) { return rest_ensure_response( array( 'ok' => true, 'status' => 'duplicate', 'postId' => (int) $dupe[0] ) ); }

	$links = $wpdb->prefix . 'sml_discord_site_links';
	$uid   = absint( $wpdb->get_var( $wpdb->prepare( "SELECT user_id FROM {$links} WHERE discord_user_id=%s", $did ) ) );
	if ( ! $uid || ! get_userdata( $uid ) ) { return new WP_REST_Response( array( 'ok' => false, 'error' => 'not_linked' ), 403 ); }
	if ( '1' !== (string) get_user_meta( $uid, 'sml_email_verified', true ) ) { return new WP_REST_Response( array( 'ok' => false, 'error' => 'not_verified' ), 403 ); }
	if ( ! sml_ap_can_post( $uid, $gid ) ) { return new WP_REST_Response( array( 'ok' => false, 'error' => 'not_group_manager' ), 403 ); }

	$meta = is_array( $b['meta'] ?? null ) ? $b['meta'] : array();
	$post_id = wp_insert_post( array(
		'post_type' => 'sml_alert', 'post_status' => 'draft', // published only after the pictures are attached, so the Alert Bot sees them
		'post_title' => wp_trim_words( sanitize_text_field( $text ), 12, '…' ), 'post_content' => wp_kses_post( nl2br( esc_html( $text ) ) ), 'post_author' => $uid,
	), true );
	if ( is_wp_error( $post_id ) ) { return $post_id; }
	update_post_meta( $post_id, '_sml_ap_ref', $ref );
	update_post_meta( $post_id, 'sml_alert_group_id', $gid );
	update_post_meta( $post_id, 'sml_alert_source_provider', 'academy' );
	foreach ( array( 'symbol', 'side', 'entry', 'target', 'stop', 'price', 'at' ) as $k ) {
		if ( isset( $meta[ $k ] ) ) { update_post_meta( $post_id, 'sml_alert_' . $k, sanitize_text_field( (string) $meta[ $k ] ) ); }
	}
	$ids = array();
	foreach ( array_slice( (array) ( $b['images'] ?? array() ), 0, 2 ) as $img ) {
		$id = sml_ap_store_image( $post_id, (string) ( $img['name'] ?? '' ), (string) ( $img['b64'] ?? '' ), (string) ( $img['alt'] ?? '' ) );
		if ( $id ) { $ids[] = $id; }
	}
	update_post_meta( $post_id, 'sml_alert_image_ids', $ids );
	if ( $ids ) { set_post_thumbnail( $post_id, $ids[0] ); }
	wp_update_post( array( 'ID' => $post_id, 'post_status' => 'publish' ) ); // fires save_post_sml_alert: the SML Alert Router sends it on to Discord
	do_action( 'sml_alert_published', $post_id, $gid );
	return rest_ensure_response( array( 'ok' => true, 'status' => 'published', 'postId' => (int) $post_id, 'images' => count( $ids ), 'url' => get_permalink( $post_id ) ) );
}

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml-loop-kick/v1', '/alert-publish', array(
		'methods'             => 'POST',
		'callback'            => 'sml_ap_rest',
		'permission_callback' => '__return_true',
	) );
} );
