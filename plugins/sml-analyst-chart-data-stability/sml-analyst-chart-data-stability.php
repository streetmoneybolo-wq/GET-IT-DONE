<?php
/**
 * Plugin Name: SML Analyst Chart Data Stability
 * Description: Trading-session-aware dashboard candles and closed-market live-bar protection.
 * Version: 1.0.3
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_ACDS_VERSION', '1.0.3' );

function sml_acds_massive_get( $path ) {
	$key = (string) get_option( 'sml_massive_key', '' );
	if ( ! $key ) { return new WP_Error( 'sml_acds_missing_key', 'Massive market-data key is not configured.' ); }
	$url = 'https://api.massive.com' . $path . ( false === strpos( $path, '?' ) ? '?' : '&' ) . 'apiKey=' . rawurlencode( $key );
	$response = wp_remote_get( $url, array( 'timeout' => 20, 'redirection' => 1, 'headers' => array( 'Accept' => 'application/json' ) ) );
	if ( is_wp_error( $response ) ) { return $response; }
	$status = (int) wp_remote_retrieve_response_code( $response );
	$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
	if ( $status >= 400 || ! is_array( $body ) ) { return new WP_Error( 'sml_acds_provider_error', 'The candle provider is temporarily unavailable.' ); }
	return $body;
}

function sml_acds_trim_sessions( $bars, $session_count ) {
	if ( ! $bars || $session_count < 1 ) { return array(); }
	$timezone = new DateTimeZone( 'America/New_York' );
	$sessions = array();
	foreach ( $bars as $index => $bar ) {
		$timestamp = isset( $bar['t'] ) ? (int) floor( (float) $bar['t'] / 1000 ) : 0;
		if ( ! $timestamp ) { continue; }
		$key = wp_date( 'Y-m-d', $timestamp, $timezone );
		$sessions[ $key ] = $index;
	}
	$keys = array_keys( $sessions );
	if ( count( $keys ) <= $session_count ) { return array_values( $bars ); }
	$keep = array_flip( array_slice( $keys, -$session_count ) );
	return array_values( array_filter( $bars, static function ( $bar ) use ( $keep, $timezone ) {
		$timestamp = isset( $bar['t'] ) ? (int) floor( (float) $bar['t'] / 1000 ) : 0;
		return $timestamp && isset( $keep[ wp_date( 'Y-m-d', $timestamp, $timezone ) ] );
	} ) );
}

function sml_acds_dash_bars( WP_REST_Request $request ) {
	$symbol = strtoupper( preg_replace( '/[^A-Za-z0-9.\-:]/', '', (string) $request->get_param( 'symbol' ) ) );
	$multiplier = max( 1, min( 60, (int) ( $request->get_param( 'mult' ) ?: 15 ) ) );
	$unit = in_array( $request->get_param( 'unit' ), array( 'minute', 'hour', 'day' ), true ) ? $request->get_param( 'unit' ) : 'minute';
	$requested_days = max( 1, min( 1500, (int) ( $request->get_param( 'days' ) ?: 5 ) ) );
	if ( ! $symbol ) { return new WP_REST_Response( array( 'available' => false, 'reason' => 'no symbol' ), 400 ); }

	/* Intraday ranges are expressed as trading sessions, not wall-clock days.
	 * Expand across weekends/holidays, then trim the response back to the exact
	 * number of requested exchange sessions. */
	$calendar_days = 'day' === $unit
		? $requested_days
		: min( 2200, max( 14, $requested_days + 8, (int) ceil( $requested_days * 7 / 5 ) + 6 ) );
	$cache_key = 'sml_acds_bars_v3_' . md5( implode( '|', array( $symbol, $multiplier, $unit, $requested_days, $calendar_days ) ) );
	$cached = get_transient( $cache_key );
	if ( is_array( $cached ) ) { return new WP_REST_Response( $cached, 200 ); }

	$to = gmdate( 'Y-m-d' );
	$fetch_window = static function ( $lookback ) use ( $symbol, $multiplier, $unit, $to ) {
		$from = gmdate( 'Y-m-d', time() - $lookback * DAY_IN_SECONDS );
		return sml_acds_massive_get( '/v2/aggs/ticker/' . rawurlencode( $symbol ) . '/range/' . $multiplier . '/' . $unit . '/' . $from . '/' . $to . '?adjusted=true&sort=desc&limit=50000' );
	};
	$payload = $fetch_window( $calendar_days );
	if ( is_wp_error( $payload ) ) {
		return new WP_REST_Response( array( 'available' => false, 'reason' => $payload->get_error_message(), 'bars' => array() ), 200 );
	}
	/* Some intraday aggregate windows intermittently return an empty result even
	 * when a wider window is populated. Retry once, wider, before reporting a
	 * data failure. Never cache an empty response. */
	if ( 'day' !== $unit && empty( $payload['results'] ) ) {
		$retry = $fetch_window( min( 2200, $calendar_days + 14 ) );
		if ( ! is_wp_error( $retry ) && ! empty( $retry['results'] ) ) { $payload = $retry; }
	}
	/* Massive's limit counts the underlying 1-minute bars, not the returned ones: with
	 * sort=asc&limit=5000 a 5-minute request over 14 calendar days stopped days short of
	 * today (SPY ended 09-10 on 09-16). Newest first with the maximum limit, then oldest
	 * first again for the chart. */
	if ( ! empty( $payload['results'] ) && is_array( $payload['results'] ) ) { $payload['results'] = array_reverse( $payload['results'] ); }
	$bars = array();
	foreach ( (array) ( $payload['results'] ?? array() ) as $bar ) {
		if ( ! isset( $bar['t'], $bar['o'], $bar['h'], $bar['l'], $bar['c'] ) ) { continue; }
		$bars[] = array( 't' => (float) $bar['t'], 'o' => (float) $bar['o'], 'h' => (float) $bar['h'], 'l' => (float) $bar['l'], 'c' => (float) $bar['c'], 'v' => isset( $bar['v'] ) ? (float) $bar['v'] : 0 );
	}
	if ( 'day' !== $unit ) { $bars = sml_acds_trim_sessions( $bars, $requested_days ); }
	$result = $bars
		? array( 'available' => true, 'bars' => $bars, 'asof' => time(), 'source' => 'massive', 'session_count' => $requested_days )
		: array( 'available' => false, 'reason' => 'no bars', 'bars' => array(), 'asof' => time() );
	if ( $bars ) { set_transient( $cache_key, $result, 'day' === $unit ? 300 : 45 ); }
	return new WP_REST_Response( $result, 200 );
}

add_action( 'rest_api_init', static function () {
	register_rest_route( 'sml/v1', '/dash-bars', array(
		'methods' => 'GET',
		'permission_callback' => '__return_true',
		'args' => array( 'symbol' => array( 'required' => true ) ),
		'callback' => 'sml_acds_dash_bars',
	), true );
}, 100 );

/* WPCode can register its legacy route after normal plugin callbacks. Intercept
 * this one read-only endpoint at dispatch time so load order cannot restore the
 * calendar-day bug. */
add_filter( 'rest_pre_dispatch', static function ( $result, $server, $request ) {
	if ( '/sml/v1/dash-bars' === $request->get_route() ) { return sml_acds_dash_bars( $request ); }
	return $result;
}, 1, 3 );

add_filter( 'rest_post_dispatch', static function ( $response, $server, $request ) {
	if ( '/sml/v1/dash-bars' === $request->get_route() && $response instanceof WP_REST_Response ) {
		$response->header( 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0' );
		$response->header( 'Pragma', 'no-cache' );
	}
	return $response;
}, 100, 3 );

function sml_acds_inject_dashboard_guard( $html ) {
	if ( false === stripos( $html, 'sml-tv-chart' ) || false !== stripos( $html, 'sml-acds-closed-guard' ) ) { return $html; }
	$head_script = '<script id="sml-acds-fetch-guard">(function(){var f=window.fetch;if(!f||f.__smlChartDataGuard)return;function g(input,init){var raw=typeof input==="string"?input:(input instanceof URL?input.href:"");if(raw&&raw.indexOf("/sml/v1/dash-bars")!==-1){var u=new URL(raw,location.origin);u.searchParams.set("sml_acds","103");input=u.toString();init=Object.assign({},init||{},{cache:"no-store"});}return f.call(this,input,init);}g.__smlChartDataGuard=true;window.fetch=g;}());</script>';
	$script = <<<'HTML'
<script id="sml-acds-closed-guard">
(function () {
  'use strict';
  function install(attempt) {
    var original = window.__smlDashboardApplyLiveQuote;
    if (typeof original !== 'function') {
      if (attempt < 100) window.setTimeout(function () { install(attempt + 1); }, 50);
      return;
    }
    if (original.__smlClosedGuard) return;
    function guarded(payload) {
      payload = payload || {};
      var arbiter = window.__smlMarketArbiter;
      var source = String(payload.source || '').toLowerCase();
      if (source === 'market_closed' || (arbiter && arbiter.isMarketClosed && arbiter.isMarketClosed())) {
        return true;
      }
      return original(payload);
    }
    guarded.__smlClosedGuard = true;
    guarded.__smlOriginal = original;
    window.__smlDashboardApplyLiveQuote = guarded;
  }
  install(0);
}());
</script>
HTML;
	$html = preg_replace( '/<\/head>/i', $head_script . '</head>', $html, 1 );
	return preg_replace( '/<\/body>/i', $script . '</body>', $html, 1 );
}

add_action( 'plugins_loaded', static function () {
	$path = trailingslashit( (string) wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ) );
	if ( '/analyst-dashboard/' === $path ) { ob_start( 'sml_acds_inject_dashboard_guard' ); }
}, PHP_INT_MAX - 20 );
