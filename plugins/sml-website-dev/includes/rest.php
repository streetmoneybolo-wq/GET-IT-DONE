<?php
/**
 * REST: sml-dev/v1
 *   POST /beacon                       public: the visitor telemetry (errors, vitals), rate-limited and same-origin
 *   GET  /overview                     admin: the headline numbers for the panel
 *   GET  /live?since_id&kinds          admin: the live stream of new rows
 *   GET  /errors?hours&resolved        admin: distinct bugs in the window
 *   POST /resolve {fp, resolve}        admin: mark a bug resolved (it reappears as "regressed" if it fires again)
 *   GET  /speed?hours                  admin: vitals per route, server and REST timings
 *   GET  /checks  · POST /checks/run   admin: health checks
 *   GET  /evolve  · POST /evolve/brief · POST /evolve/proposal {id,status} · POST /evolve/propose {...} · POST /evolve/knob {key,value,pinned}
 *   GET  /competitors · POST /competitors/scan
 *   GET  /settings · POST /settings
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

add_action( 'rest_api_init', function () {
	$admin = array( 'permission_callback' => 'sml_wd_rest_admin' );
	register_rest_route( SML_WD_NS, '/beacon', array( 'methods' => 'POST', 'callback' => 'sml_wd_rest_beacon', 'permission_callback' => '__return_true' ) );
	register_rest_route( SML_WD_NS, '/overview', array( 'methods' => 'GET', 'callback' => 'sml_wd_rest_overview' ) + $admin );
	register_rest_route( SML_WD_NS, '/live', array( 'methods' => 'GET', 'callback' => 'sml_wd_rest_live' ) + $admin );
	register_rest_route( SML_WD_NS, '/errors', array( 'methods' => 'GET', 'callback' => 'sml_wd_rest_errors' ) + $admin );
	register_rest_route( SML_WD_NS, '/resolve', array( 'methods' => 'POST', 'callback' => 'sml_wd_rest_resolve' ) + $admin );
	register_rest_route( SML_WD_NS, '/speed', array( 'methods' => 'GET', 'callback' => 'sml_wd_rest_speed' ) + $admin );
	register_rest_route( SML_WD_NS, '/checks', array( 'methods' => 'GET', 'callback' => function () { return array( 'ok' => true, 'checks' => get_option( 'sml_wd_checks', array() ), 'history' => array_slice( (array) get_option( 'sml_wd_checks_history', array() ), -48 ) ); } ) + $admin );
	register_rest_route( SML_WD_NS, '/checks/run', array( 'methods' => 'POST', 'callback' => function () { return array( 'ok' => true, 'checks' => sml_wd_run_checks( 'manual' ), 'history' => array_slice( (array) get_option( 'sml_wd_checks_history', array() ), -48 ) ); } ) + $admin );
	register_rest_route( SML_WD_NS, '/evolve', array( 'methods' => 'GET', 'callback' => function () { return sml_wd_evolve_snapshot(); } ) + $admin );
	register_rest_route( SML_WD_NS, '/evolve/brief', array( 'methods' => 'POST', 'callback' => function () { $r = sml_wd_run_brief( 'owner' ); return $r + array( 'snapshot' => sml_wd_evolve_snapshot() ); } ) + $admin );
	register_rest_route( SML_WD_NS, '/evolve/proposal', array( 'methods' => 'POST', 'callback' => 'sml_wd_rest_proposal' ) + $admin );
	register_rest_route( SML_WD_NS, '/evolve/propose', array( 'methods' => 'POST', 'callback' => 'sml_wd_rest_propose' ) + $admin );
	register_rest_route( SML_WD_NS, '/evolve/knob', array( 'methods' => 'POST', 'callback' => 'sml_wd_rest_knob' ) + $admin );
	register_rest_route( SML_WD_NS, '/competitors', array( 'methods' => 'GET', 'callback' => function () { $c = get_option( 'sml_wd_competitors', array() ); unset( $c['seen'] ); return array( 'ok' => true, 'competitors' => $c ); } ) + $admin );
	register_rest_route( SML_WD_NS, '/competitors/scan', array( 'methods' => 'POST', 'callback' => function () { $c = sml_wd_scan_competitors( 'owner' ); unset( $c['seen'] ); return array( 'ok' => true, 'competitors' => $c ); } ) + $admin );
	register_rest_route( SML_WD_NS, '/settings', array( 'methods' => 'GET', 'callback' => function () { return array( 'ok' => true, 'settings' => sml_wd_settings(), 'aiOn' => (bool) sml_wd_ai_key(), 'aiSource' => defined( 'SML_WD_ANTHROPIC_KEY' ) ? 'wp-config constant' : ( get_option( 'sml_wd_anthropic_key' ) ? 'option' : ( defined( 'ANTHROPIC_API_KEY' ) ? 'ANTHROPIC_API_KEY constant' : '' ) ) ); } ) + $admin );
	register_rest_route( SML_WD_NS, '/settings', array( 'methods' => 'POST', 'callback' => 'sml_wd_rest_settings' ) + $admin );
} );

function sml_wd_rest_admin() {
	if ( ! is_user_logged_in() ) { return new WP_Error( 'sml_wd_auth', 'Sign in first.', array( 'status' => 401 ) ); }
	if ( ! sml_wd_can() ) { return new WP_Error( 'sml_wd_admin', 'Administrators only.', array( 'status' => 403 ) ); }
	return true;
}

/* ---------- the public beacon ---------- */
function sml_wd_rest_beacon( WP_REST_Request $req ) {
	if ( ! sml_wd_settings()['beacon_enabled'] ) { return new WP_REST_Response( null, 204 ); }
	$host = wp_parse_url( home_url(), PHP_URL_HOST );
	$origin = $req->get_header( 'origin' ) ?: $req->get_header( 'referer' );
	if ( $origin && wp_parse_url( $origin, PHP_URL_HOST ) !== $host ) { return new WP_REST_Response( null, 204 ); }
	$raw = $req->get_body();
	if ( strlen( $raw ) > 24000 ) { return new WP_REST_Response( null, 204 ); }
	$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) $_SERVER['REMOTE_ADDR'] : '';
	$rl = 'sml_wd_rl_' . md5( $ip . gmdate( 'YmdHi' ) );
	$n = (int) get_transient( $rl );
	if ( $n > 120 ) { return new WP_REST_Response( null, 204 ); }
	set_transient( $rl, $n + 1, 120 );
	$body = json_decode( $raw, true );
	$events = is_array( $body ) && isset( $body['events'] ) && is_array( $body['events'] ) ? $body['events'] : array();
	$page = sml_wd_path( is_array( $body ) && isset( $body['page'] ) ? (string) $body['page'] : '/' );
	$kept = 0;
	foreach ( array_slice( $events, 0, 40 ) as $e ) {
		$clean = sml_wd_sanitize_beacon_event( $e, $page );
		if ( ! $clean ) { continue; }
		sml_wd_record( $clean ); $kept++;
	}
	return new WP_REST_Response( null, 204 );
}

/* ---------- admin reads ---------- */
function sml_wd_rest_overview( WP_REST_Request $req ) {
	$hours = max( 1, min( 168, (int) ( $req['hours'] ?: 24 ) ) );
	$d = sml_wd_digest();
	$checks = get_option( 'sml_wd_checks', array() );
	$ev = sml_wd_evolve_state();
	return array(
		'ok' => true, 'asOf' => gmdate( 'c' ), 'score' => $d['score'], 'views' => $d['views'], 'phones' => $d['phones'],
		'errors' => $d['errors'], 'series' => sml_wd_error_series( min( $hours, 48 ) ), 'vitals' => $d['vitals'], 'server' => array( 'p50' => $d['server']['p50'], 'p95' => $d['server']['p95'], 'n' => $d['server']['n'] ),
		'checks' => array( 'at' => isset( $checks['at'] ) ? $checks['at'] : '', 'summary' => isset( $checks['summary'] ) ? $checks['summary'] : array( 'ok' => 0, 'warn' => 0, 'fail' => 0 ), 'failing' => $d['checks']['failing'] ),
		'brief' => $ev['briefs'] ? array_intersect_key( end( $ev['briefs'] ), array( 'day' => 1, 'at' => 1, 'summary' => 1, 'model' => 1, 'score' => 1 ) ) : null,
		'open' => count( array_filter( $ev['proposals'], function ( $p ) { return in_array( $p['status'], array( 'proposed', 'approved', 'building' ), true ); } ) ),
		'aiOn' => (bool) sml_wd_ai_key(), 'version' => SML_WD_VERSION,
	);
}
function sml_wd_rest_live( WP_REST_Request $req ) {
	$kinds = $req['kinds'] ? array_map( 'sanitize_key', explode( ',', (string) $req['kinds'] ) ) : sml_wd_error_kinds();
	return array( 'ok' => true, 'rows' => sml_wd_recent( $kinds, max( 1, min( 200, (int) ( $req['limit'] ?: 60 ) ) ), (int) $req['since_id'] ), 'asOf' => gmdate( 'c' ) );
}
function sml_wd_rest_errors( WP_REST_Request $req ) {
	return array( 'ok' => true, 'rows' => sml_wd_errors( max( 1, min( 720, (int) ( $req['hours'] ?: 24 ) ) ), 120, (bool) $req['resolved'] ), 'series' => sml_wd_error_series( 24 ) );
}
function sml_wd_rest_resolve( WP_REST_Request $req ) {
	$fp = preg_replace( '/[^a-f0-9]/', '', strtolower( (string) $req['fp'] ) );
	if ( 32 !== strlen( $fp ) ) { return new WP_Error( 'sml_wd_bad_fp', 'Bad fingerprint.', array( 'status' => 400 ) ); }
	return array( 'ok' => sml_wd_resolve( $fp, null === $req['resolve'] ? true : (bool) $req['resolve'] ) );
}
function sml_wd_rest_speed( WP_REST_Request $req ) {
	return array( 'ok' => true ) + sml_wd_speed( max( 1, min( 168, (int) ( $req['hours'] ?: 24 ) ) ) );
}

/* ---------- evolve writes ---------- */
function sml_wd_rest_proposal( WP_REST_Request $req ) {
	$p = sml_wd_set_proposal( sanitize_text_field( (string) $req['id'] ), sanitize_key( (string) $req['status'] ) );
	if ( ! $p ) { return new WP_Error( 'sml_wd_no_proposal', 'Unknown proposal or status.', array( 'status' => 404 ) ); }
	return array( 'ok' => true, 'proposal' => $p, 'snapshot' => sml_wd_evolve_snapshot() );
}
/** The owner (or the Competitors tab) adds a proposal by hand. */
function sml_wd_rest_propose( WP_REST_Request $req ) {
	$s = sml_wd_evolve_state();
	$added = sml_wd_adopt_proposals( $s, array( array( 'title' => $req['title'], 'evidence' => $req['evidence'], 'change' => $req['change'], 'effect' => $req['effect'], 'risk' => $req['risk'] ?: 'medium', 'size' => $req['size'] ?: 'M', 'area' => $req['area'] ?: 'competition', 'score' => 0.6 ) ), gmdate( 'Y-m-d' ), 'owner' );
	sml_wd_evolve_save( $s );
	return array( 'ok' => (bool) $added, 'proposal' => $added ? $added[0] : null, 'snapshot' => sml_wd_evolve_snapshot() );
}
function sml_wd_rest_knob( WP_REST_Request $req ) {
	$k = sml_wd_set_knob( sanitize_key( (string) $req['key'] ), null === $req['value'] ? null : $req['value'], null === $req['pinned'] ? null : (bool) $req['pinned'], 'owner' );
	if ( ! $k ) { return new WP_Error( 'sml_wd_no_knob', 'Unknown knob.', array( 'status' => 404 ) ); }
	return array( 'ok' => true, 'knob' => $k, 'snapshot' => sml_wd_evolve_snapshot() );
}
function sml_wd_rest_settings( WP_REST_Request $req ) {
	$patch = $req->get_json_params(); if ( ! is_array( $patch ) ) { $patch = array(); }
	if ( isset( $patch['competitors'] ) && is_string( $patch['competitors'] ) ) { $patch['competitors'] = preg_split( '/\r?\n/', $patch['competitors'] ); }
	if ( isset( $patch['watch_pages'] ) && is_string( $patch['watch_pages'] ) ) { $patch['watch_pages'] = preg_split( '/\r?\n/', $patch['watch_pages'] ); }
	if ( isset( $patch['watch_pages'] ) ) { $patch['watch_pages'] = array_map( function ( $p ) { $p = sml_wd_path( trim( (string) $p ) ); return '/' === $p ? $p : trailingslashit( $p ); }, (array) $patch['watch_pages'] ); }
	/* the key may be set here once; it is stored, never echoed back */
	if ( ! empty( $patch['anthropic_key'] ) && is_string( $patch['anthropic_key'] ) ) { update_option( 'sml_wd_anthropic_key', trim( $patch['anthropic_key'] ), false ); }
	if ( isset( $patch['anthropic_key'] ) && '' === $patch['anthropic_key'] && ! empty( $patch['clear_key'] ) ) { delete_option( 'sml_wd_anthropic_key' ); }
	unset( $patch['anthropic_key'], $patch['clear_key'] );
	return array( 'ok' => true, 'settings' => sml_wd_save_settings( $patch ), 'aiOn' => (bool) sml_wd_ai_key() );
}
