<?php
/**
 * Plugin Name: SML Academy Profile Card
 * Description: Read-only, HMAC-signed lookup that lets the Making Easy Money Academy chat show a member's StockMarketLoop profile, channel and home group next to their Discord profile. Public fields only, and only for members whose Discord is linked and email-verified.
 * Version: 1.0.0
 * Author: StockMarketLoop
 *
 * Route: POST /wp-json/sml-loop-kick/v1/discord-profile   body {"discord_user_id": "..."}
 * Authentication is the LOOP-KICK bridge's own: HMAC-SHA256 over "{ts}.{route}.{sha256(body)}" with the bridge secret, 60 s window, every signature single-use.
 * This plugin reuses that bridge's verification (sml_lkd_verify_signed / sml_lkd_bridge_secret from mu-plugins/sml-loop-kick-discord.php) and fails closed
 * (503) if the bridge is not installed. It writes nothing except a short per-member rate-limit transient.
 *
 * ROLLBACK: deactivate this plugin. The chat then shows Discord profiles only.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sml_apc_https( $url ) {
	$url = trim( (string) $url );
	return ( '' !== $url && 0 === strpos( $url, 'https://' ) ) ? esc_url_raw( $url ) : '';
}

function sml_apc_rest_profile( WP_REST_Request $request ) {
	global $wpdb;
	$data = json_decode( (string) $request->get_body(), true );
	$data = is_array( $data ) ? $data : array();
	$discord_user_id = preg_replace( '/\D/', '', (string) ( $data['discord_user_id'] ?? '' ) );
	if ( ! preg_match( '/^\d{15,24}$/', $discord_user_id ) ) {
		return new WP_Error( 'sml_apc_bad_id', 'A Discord user id is required.', array( 'status' => 400 ) );
	}
	$rate_key = 'sml_apc_rate_' . $discord_user_id;
	$rate     = (int) get_transient( $rate_key );
	if ( $rate >= 60 ) {
		return new WP_Error( 'sml_apc_rate', 'Too many requests.', array( 'status' => 429 ) );
	}
	set_transient( $rate_key, $rate + 1, MINUTE_IN_SECONDS );

	$links = $wpdb->prefix . 'sml_discord_site_links';
	$link  = $wpdb->get_row( $wpdb->prepare( "SELECT user_id FROM {$links} WHERE discord_user_id=%s", $discord_user_id ), ARRAY_A );
	$user_id = $link ? absint( $link['user_id'] ) : 0;
	$user    = $user_id ? get_userdata( $user_id ) : false;
	// not linked, or linked but not email-verified: nothing is shown (fails closed)
	if ( ! $user || '1' !== (string) get_user_meta( $user_id, 'sml_email_verified', true ) ) {
		return new WP_REST_Response( array( 'ok' => true, 'linked' => false ), 200 );
	}

	$handle = function_exists( 'sml_lkd_handle_display' ) ? sml_lkd_handle_display( $user_id ) : (string) $user->user_nicename;
	$card   = array(
		'handle'       => sanitize_text_field( $handle ),
		'display_name' => sanitize_text_field( (string) $user->display_name ),
		'avatar'       => sml_apc_https( get_avatar_url( $user_id, array( 'size' => 128 ) ) ),
		'profile_url'  => '' !== $handle ? home_url( '/members/' . rawurlencode( $handle ) . '/' ) : '',
		'channel'      => null,
		'group'        => null,
	);

	if ( function_exists( 'sml_channel_handle_for_user' ) ) {
		$channel = sml_channel_handle_for_user( $user_id );
		if ( '' !== (string) $channel ) {
			$card['channel'] = array( 'handle' => sanitize_text_field( $channel ), 'url' => home_url( '/channel/' . rawurlencode( $channel ) . '/' ) );
			if ( function_exists( 'sml_channel_settings' ) ) {
				$settings = sml_channel_settings( $user_id );
				$hg       = is_array( $settings ) && isset( $settings['home_group'] ) && is_array( $settings['home_group'] ) ? $settings['home_group'] : array();
				$url      = sml_apc_https( $hg['url'] ?? '' );
				if ( '' !== $url ) {
					$card['group'] = array( 'name' => sanitize_text_field( (string) ( $hg['name'] ?? '' ) ), 'url' => $url, 'members' => sanitize_text_field( (string) ( $hg['members'] ?? '' ) ) );
				}
			}
		}
	}
	return new WP_REST_Response( array( 'ok' => true, 'linked' => true, 'card' => $card ), 200 );
}

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml-loop-kick/v1', '/discord-profile', array(
		'methods'             => 'POST',
		'permission_callback' => static function ( WP_REST_Request $request ) {
			if ( ! function_exists( 'sml_lkd_verify_signed' ) || ! function_exists( 'sml_lkd_bridge_secret' ) ) {
				return new WP_Error( 'sml_apc_unconfigured', 'Not configured.', array( 'status' => 503 ) );
			}
			return sml_lkd_verify_signed( $request, sml_lkd_bridge_secret(), 'x-sml-lk-timestamp', 'x-sml-lk-signature' );
		},
		'callback'            => 'sml_apc_rest_profile',
	) );
} );
