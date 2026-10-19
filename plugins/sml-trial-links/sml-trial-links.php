<?php
/**
 * Plugin Name: SML Trial Links
 * Description: Short, memorable links for the Making Easy Money free trials. stockmarketloop.com/15day (also /15-day-trial, /academy-free, /free-academy, /academy-trial) sends people to the 15-day no-card Academy trial, with /15day/<channel> tagging where they came from. stockmarketloop.com/trial, /free-trial and /7day keep going to the 7-day MEM trial. stockmarketloop.com/trial (also /free-trial, /7day, /7-day-trial) sends people straight to the one-page trial flow of the Making Easy Money Academy billing service; /trial/weekly and /trial/yearly pick those plans; /mem-plans opens every plan. No page, no theme, no account needed on the site.
 * Version: 1.1.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_TRIAL_LINKS_VERSION', '1.1.0' );

/** The Academy billing service that sells the trial (override with the option sml_trial_links_base). */
function sml_trial_links_base() {
	$base = (string) get_option( 'sml_trial_links_base', '' );
	if ( ! preg_match( '#^https://[a-z0-9.-]+(/[^\s]*)?$#i', $base ) ) { $base = 'https://making-easy-money-academy.onrender.com'; }
	return rtrim( $base, '/' ) . '/v1/academy/billing/';
}

/** The Academy platform that grants the 15-day no-card trial (override with the option sml_academy_trial_base). */
function sml_academy_trial_base() {
	$base = (string) get_option( 'sml_academy_trial_base', '' );
	if ( ! preg_match( '#^https://[a-z0-9.-]+(/[^\s]*)?$#i', $base ) ) { $base = 'https://sml-platform-api.onrender.com'; }
	return rtrim( $base, '/' ) . '/academy-activity/trial';
}

/**
 * Matches the request path against the short links. Returns the target URL or ''.
 * Runs on init (before WordPress resolves the request to a 404), so no page or rewrite rule is involved.
 */
function sml_trial_links_target( $path, $query = array() ) {
	$path = strtolower( trim( (string) wp_parse_url( $path, PHP_URL_PATH ), '/' ) );
	$segments = $path === '' ? array() : explode( '/', $path );
	if ( ! $segments ) { return ''; }
	$head = $segments[0];
	/* the 15-day Academy trial (no card): /15day, /15day/<channel>, ?via=<channel>; the channel tag rides along so the Academy log says where the sign-up came from */
	if ( in_array( $head, array( '15day', '15-day', '15-day-trial', '15-day-free-trial', 'trial15', 'academy-free', 'free-academy', 'academy-trial', 'academy15' ), true ) ) {
		$via = isset( $segments[1] ) ? $segments[1] : ( isset( $query['via'] ) ? (string) $query['via'] : 'site' );
		$via = substr( preg_replace( '/[^a-z0-9_-]/', '', strtolower( $via ) ), 0, 40 );
		return sml_academy_trial_base() . '?via=' . rawurlencode( $via === '' ? 'site' : $via );
	}
	$plans = array( 'monthly', 'weekly', 'yearly' );
	$aliases = array( 'month' => 'monthly', 'week' => 'weekly', 'year' => 'yearly', 'annual' => 'yearly' );
	if ( in_array( $head, array( 'trial', 'free-trial', 'freetrial', '7day', '7-day', '7-day-trial', '7-day-free-trial', 'mem-trial' ), true ) ) {
		$plan = isset( $segments[1] ) ? $segments[1] : ( isset( $query['plan'] ) ? strtolower( (string) $query['plan'] ) : 'monthly' );
		if ( isset( $aliases[ $plan ] ) ) { $plan = $aliases[ $plan ]; }
		if ( ! in_array( $plan, $plans, true ) ) { $plan = 'monthly'; }
		return sml_trial_links_base() . 'trial?plan=' . $plan;
	}
	if ( in_array( $head, array( 'mem-plans', 'mem-buy', 'academy-plans' ), true ) && count( $segments ) === 1 ) {
		return sml_trial_links_base() . 'buy';
	}
	return '';
}

add_action( 'init', function () {
	if ( is_admin() || ( defined( 'WP_CLI' ) && WP_CLI ) ) { return; }
	$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	if ( $uri === '' ) { return; }
	/* the site may live in a subdirectory: strip the home path first */
	$home_path = trim( (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH ), '/' );
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	if ( $home_path !== '' && stripos( ltrim( $path, '/' ), $home_path . '/' ) === 0 ) { $path = substr( ltrim( $path, '/' ), strlen( $home_path ) ); }
	$query = array();
	wp_parse_str( (string) wp_parse_url( $uri, PHP_URL_QUERY ), $query );
	$target = sml_trial_links_target( $path, $query );
	if ( $target === '' ) { return; }
	/* keep campaign tags so the owner can see where sign-ups came from */
	$keep = array();
	foreach ( array( 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref' ) as $k ) {
		if ( isset( $query[ $k ] ) && is_string( $query[ $k ] ) && $query[ $k ] !== '' ) { $keep[ $k ] = substr( sanitize_text_field( $query[ $k ] ), 0, 80 ); }
	}
	if ( $keep ) { $target .= ( strpos( $target, '?' ) === false ? '?' : '&' ) . http_build_query( $keep ); }
	nocache_headers();
	header( 'X-SML-Trial-Links: ' . SML_TRIAL_LINKS_VERSION );
	wp_redirect( $target, 302, 'SML Trial Links' ); // phpcs:ignore WordPress.Security.SafeRedirect
	exit;
}, 1 );
