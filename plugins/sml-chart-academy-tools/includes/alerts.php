<?php
/**
 * Alerts desk for group charts. The Academy platform evaluates the trader's posted alerts (risk grade, plan, checklist, options read);
 * this file decides who may see them on stockmarketloop.com and relays a signed request, reusing the Pro Tools connection.
 *
 * Who sees what, per group (same levels as Pro Tools):
 *   owner, site admin, premium / analyst / mod / admin  -> live desk
 *   other members                                       -> a count of open alerts only (teaser), never the alerts
 *   not a member / signed out                           -> nothing
 * Only groups listed in option sml_cat_alerts_groups (default: Making Easy Money, id 7) show the desk.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_cat_alerts_groups() {
	$g = get_option( 'sml_cat_alerts_groups', array( 7 ) );
	return array_values( array_filter( array_map( 'absint', (array) $g ) ) );
}

function sml_cat_alerts_view( $group_id, $user_id = 0 ) {
	if ( ! in_array( (int) $group_id, sml_cat_alerts_groups(), true ) || ! function_exists( 'sml_gpro_viewer' ) ) { return ''; }
	$v = sml_gpro_viewer( $group_id, $user_id );
	if ( 'full' === $v['level'] ) { return 'live'; }
	if ( 'preview' === $v['level'] ) { return 'teaser'; }
	return '';
}

function sml_cat_alerts_call( array $payload ) {
	if ( ! function_exists( 'sml_gpro_base_url' ) || ! function_exists( 'sml_gpro_secret' ) || ! function_exists( 'sml_gpro_signature' ) ) {
		return new WP_Error( 'sml_cat_unconfigured', 'The alerts service is not connected.', array( 'status' => 503 ) );
	}
	$base = sml_gpro_base_url(); $secret = sml_gpro_secret();
	if ( '' === $base || '' === $secret ) { return new WP_Error( 'sml_cat_unconfigured', 'The alerts service is not connected.', array( 'status' => 503 ) ); }
	$body = wp_json_encode( $payload ); $ts = (string) time();
	$res = wp_remote_post( $base . '/v1/group-tools/alerts', array(
		'timeout' => 20,
		'headers' => array( 'Content-Type' => 'application/json', 'X-SML-Timestamp' => $ts, 'X-SML-Signature' => sml_gpro_signature( $ts, $body, $secret ) ),
		'body'    => $body,
	) );
	if ( is_wp_error( $res ) ) { return new WP_Error( 'sml_cat_unreachable', 'The alerts service did not answer. Try again in a moment.', array( 'status' => 503 ) ); }
	$code = (int) wp_remote_retrieve_response_code( $res );
	$data = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( $code >= 300 || ! is_array( $data ) || empty( $data['ok'] ) ) {
		return new WP_Error( 'sml_cat_failed', 404 === $code ? 'That alert is no longer on the desk.' : 'The alerts desk is temporarily unavailable.', array( 'status' => 404 === $code ? 404 : 503 ) );
	}
	// avatars are served by the platform; make their paths absolute for the browser
	$fix = function ( &$a ) use ( $base ) { if ( ! empty( $a['avatar'] ) && 0 === strpos( (string) $a['avatar'], '/' ) ) { $a['avatar'] = $base . $a['avatar']; } };
	if ( isset( $data['alerts'] ) && is_array( $data['alerts'] ) ) { foreach ( $data['alerts'] as &$row ) { $fix( $row ); } unset( $row ); }
	if ( isset( $data['alert'] ) && is_array( $data['alert'] ) ) { $fix( $data['alert'] ); }
	unset( $data['feed'] ); // internal channel health, not for members
	return $data;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-cat/v1', '/alerts', array(
		'methods'             => 'GET',
		'permission_callback' => 'is_user_logged_in',
		'callback'            => function ( WP_REST_Request $r ) {
			$gid  = absint( $r->get_param( 'group_id' ) );
			$view = sml_cat_alerts_view( $gid );
			if ( '' === $view ) { return new WP_Error( 'sml_cat_forbidden', 'The alerts desk is for members of this group.', array( 'status' => 403 ) ); }
			$detail = preg_replace( '/[^0-9]/', '', (string) $r->get_param( 'detail' ) );
			if ( $detail ) {
				if ( 'live' !== $view ) { return new WP_Error( 'sml_cat_premium', 'Open alerts are for Premium members.', array( 'status' => 403 ) ); }
				return rest_ensure_response( sml_cat_alerts_call( array( 'groupId' => $gid, 'view' => $view, 'detail' => $detail ) ) );
			}
			$key = 'sml_cat_alerts_' . $view;
			$hit = get_transient( $key );
			if ( is_array( $hit ) ) { return rest_ensure_response( $hit ); }
			$data = sml_cat_alerts_call( array( 'groupId' => $gid, 'view' => $view ) );
			if ( is_wp_error( $data ) ) { return $data; }
			set_transient( $key, $data, 15 ); // every member of every group shares the same 15-second snapshot
			$res = rest_ensure_response( $data );
			$res->header( 'Cache-Control', 'private, no-store' );
			return $res;
		},
	) );
} );

/** Config for the chart page: only when the embed belongs to a group that has the desk and the viewer may see it. */
function sml_cat_alerts_config() {
	$gid = isset( $_GET['group_id'] ) ? absint( $_GET['group_id'] ) : 0;
	if ( ! $gid || ! is_user_logged_in() ) { return null; }
	$view = sml_cat_alerts_view( $gid );
	if ( '' === $view ) { return null; }
	return array( 'groupId' => $gid, 'view' => $view, 'rest' => esc_url_raw( rest_url( 'sml-cat/v1/alerts' ) ), 'nonce' => wp_create_nonce( 'wp_rest' ) );
}
