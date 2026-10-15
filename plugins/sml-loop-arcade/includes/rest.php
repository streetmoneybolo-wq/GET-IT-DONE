<?php
/**
 * REST: sml-arcade/v1
 *   GET  /state?handle=&stream=      everything the panel shows (public; richer when signed in)
 *   POST /spin                       {handle}  spin the wheel
 *   POST /jackpot/start              {handle, prize, minutes, title}  host only
 *   POST /jackpot/tick               {handle}  a watch ticket (once a minute)
 *   POST /jackpot/draw               {handle}  host ends the round early and draws
 *   POST /tape/call                  {handle, symbol, dir}
 *   GET  /tape/quote?symbols=        prices for the call card
 *   GET  /ladder?game=&period=
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

add_action( 'rest_api_init', function () {
	$ns = SML_ARC_NS; $auth = function () { return is_user_logged_in() ? true : new WP_Error( 'sml_arc_auth', 'Sign in to play.', array( 'status' => 401 ) ); };
	register_rest_route( $ns, '/state', array( 'methods' => 'GET', 'callback' => 'sml_arc_rest_state', 'permission_callback' => '__return_true' ) );
	register_rest_route( $ns, '/spin', array( 'methods' => 'POST', 'callback' => 'sml_arc_rest_spin', 'permission_callback' => $auth ) );
	register_rest_route( $ns, '/jackpot/start', array( 'methods' => 'POST', 'callback' => 'sml_arc_rest_jp_start', 'permission_callback' => $auth ) );
	register_rest_route( $ns, '/jackpot/tick', array( 'methods' => 'POST', 'callback' => 'sml_arc_rest_jp_tick', 'permission_callback' => $auth ) );
	register_rest_route( $ns, '/jackpot/draw', array( 'methods' => 'POST', 'callback' => 'sml_arc_rest_jp_draw', 'permission_callback' => $auth ) );
	register_rest_route( $ns, '/tape/call', array( 'methods' => 'POST', 'callback' => 'sml_arc_rest_tape_call', 'permission_callback' => $auth ) );
	register_rest_route( $ns, '/tape/quote', array( 'methods' => 'GET', 'callback' => function ( $r ) { return array( 'ok' => true, 'quotes' => sml_arc_quotes( explode( ',', (string) $r->get_param( 'symbols' ) ) ) ); }, 'permission_callback' => '__return_true' ) );
	register_rest_route( $ns, '/ladder', array( 'methods' => 'GET', 'callback' => function ( $r ) { $g = sanitize_key( (string) $r->get_param( 'game' ) ) ?: 'tape'; $p = preg_replace( '/[^0-9a-z]/', '', (string) $r->get_param( 'period' ) ) ?: sml_arc_month(); return array( 'ok' => true, 'game' => $g, 'period' => $p, 'rows' => sml_arc_ladder( $g, $p, 10 ), 'mine' => get_current_user_id() ? sml_arc_my_rank( get_current_user_id(), $g, $p ) : null ); }, 'permission_callback' => '__return_true' ) );
} );

function sml_arc_room( $request ) {
	$handle = strtolower( preg_replace( '/[^a-z0-9_.-]/i', '', (string) $request->get_param( 'handle' ) ) );
	$stream = preg_replace( '/[^A-Za-z0-9]/', '', (string) $request->get_param( 'stream' ) );
	return array( 'handle' => $handle, 'room' => $stream ? 'stream-' . strtolower( $stream ) : $handle, 'host' => $handle ? sml_arc_room_host( $handle ) : 0, 'live' => $handle ? sml_arc_room_live( $handle ) : false );
}
function sml_arc_is_host( $room ) { $uid = get_current_user_id(); return $uid && ( ( $room['host'] && $room['host'] === $uid ) || current_user_can( 'manage_options' ) ); }

function sml_arc_rest_state( $request ) {
	$uid = get_current_user_id(); $room = sml_arc_room( $request ); $t = sml_arc_tuning();
	$round = sml_arc_round_live( $room['room'] );
	if ( $round ) { $round = sml_arc_jackpot_settle( $round ); }
	$last = sml_arc_round_last( $room['room'] );
	$open = $uid ? sml_arc_call_open( $uid ) : null;
	if ( $open ) { $open = sml_arc_call_resolve( $open ); }
	$out = array(
		'ok' => true, 'room' => $room['room'], 'handle' => $room['handle'], 'live' => $room['live'], 'isHost' => sml_arc_is_host( $room ), 'signedIn' => (bool) $uid,
		'balance' => $uid ? sml_arc_balance( $uid ) : 0, 'ledger' => sml_arc_ledger_ready(), 'capLeft' => $uid ? sml_arc_room_left( $uid ) : 0,
		'spin' => array( 'wheel' => sml_arc_wheel(), 'allowance' => $uid ? sml_arc_spin_allowance( $uid, $room['live'] ) : array( 'total' => (int) $t['spin_base'], 'used' => 0, 'left' => 0, 'streak' => 0, 'won' => 0 ) ),
		'jackpot' => array( 'round' => $round ? sml_arc_round_public( $round, $uid ) : null, 'last' => $last ? sml_arc_round_public( $last, $uid ) : null, 'min' => (int) $t['jackpot_min'], 'max' => (int) $t['jackpot_max'], 'minutes' => (array) $t['jackpot_minutes'], 'recent' => sml_arc_jackpot_recent( 6 ) ),
		'tape' => array( 'open' => $open ? sml_arc_call_public( $open ) : null, 'mine' => $uid ? sml_arc_my_calls( $uid, 6 ) : array(), 'room' => sml_arc_room_calls( $room['room'], 10 ), 'seconds' => (int) $t['tape_seconds'], 'todayLeft' => $uid ? max( 0, (int) $t['tape_daily_max'] - sml_arc_calls_today( $uid ) ) : 0, 'ladder' => sml_arc_ladder( 'tape', sml_arc_month(), 10 ), 'me' => $uid ? sml_arc_my_rank( $uid, 'tape', sml_arc_month() ) : null, 'prizes' => (array) $t['tape_daily_prizes'] ),
	);
	$res = rest_ensure_response( $out );
	$res->header( 'Cache-Control', 'no-store' );
	return $res;
}

function sml_arc_rest_spin( $request ) {
	$room = sml_arc_room( $request );
	$r = sml_arc_spin( get_current_user_id(), $room['live'] );
	return is_wp_error( $r ) ? $r : $r;
}

function sml_arc_rest_jp_start( $request ) {
	$room = sml_arc_room( $request );
	if ( ! sml_arc_is_host( $room ) ) { return new WP_Error( 'sml_arc_host', 'Only the host of this stream can start a jackpot.', array( 'status' => 403 ) ); }
	$r = sml_arc_jackpot_start( get_current_user_id(), $room['room'], (int) $request->get_param( 'prize' ), (int) $request->get_param( 'minutes' ), (string) $request->get_param( 'title' ) );
	return is_wp_error( $r ) ? $r : array( 'ok' => true, 'round' => $r, 'balance' => sml_arc_balance( get_current_user_id() ) );
}
function sml_arc_rest_jp_tick( $request ) {
	$room = sml_arc_room( $request ); $uid = get_current_user_id();
	$round = sml_arc_round_live( $room['room'] );
	if ( $round ) { $round = sml_arc_jackpot_settle( $round ); }
	if ( ! $round || $round['status'] !== 'live' ) { return array( 'ok' => true, 'round' => $round ? sml_arc_round_public( $round, $uid ) : null ); }
	if ( (int) $round['host_id'] === $uid ) { return array( 'ok' => true, 'round' => sml_arc_round_public( $round, $uid ), 'host' => true ); }
	$mine = sml_arc_jackpot_tick( $uid, $round );
	return array( 'ok' => true, 'mine' => $mine, 'round' => sml_arc_round_public( $round, $uid ) );
}
function sml_arc_rest_jp_draw( $request ) {
	$room = sml_arc_room( $request );
	if ( ! sml_arc_is_host( $room ) ) { return new WP_Error( 'sml_arc_host', 'Only the host can draw.', array( 'status' => 403 ) ); }
	$round = sml_arc_round_live( $room['room'] );
	if ( ! $round ) { return new WP_Error( 'sml_arc_none', 'No jackpot is running.', array( 'status' => 404 ) ); }
	return array( 'ok' => true, 'round' => sml_arc_round_public( sml_arc_jackpot_settle( $round, true ), get_current_user_id() ) );
}
function sml_arc_rest_tape_call( $request ) {
	$room = sml_arc_room( $request );
	$r = sml_arc_call_place( get_current_user_id(), $room['room'], (string) $request->get_param( 'symbol' ), (string) $request->get_param( 'dir' ) );
	return is_wp_error( $r ) ? $r : array( 'ok' => true, 'call' => $r );
}
