<?php
/**
 * Plugin Name: SML Watchlist moomoo Comments
 * Description: GET /wp-json/sml-watch/v1/moomoo-comments — the moomoo community comments for the stocks on the signed-in member's saved watchlist, for the home feed (the same comments the Ticker Terminal shows). Read-only: replying happens on moomoo.
 * Version: 1.0.0
 * Author: StockMarketLoop
 *
 * OWNER RULE (2026-09-16): anyone with a watchlist built sees the moomoo comments of those
 * stocks in their news feed, like the terminal, with "Sign up or into moomoo to reply" on
 * the card.
 *
 * Source: /sml-ticker-community/v1/moomoo (the terminal's route), which reuses
 * sml-members' moomoo-feed mapping and upstream cache. The watchlist is read server-side
 * from the member's account, never from a client-supplied list, so the feed shows exactly
 * the stocks they saved. Each symbol's result is cached 90s; at most 6 cold symbols are
 * fetched per request so a large watchlist fills in over a couple of refreshes instead of
 * stalling the feed.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

const SML_WMC_MAX_SYMBOLS  = 15;
const SML_WMC_PER_SYMBOL   = 3;
const SML_WMC_TOTAL        = 24;
const SML_WMC_MAX_AGE_H    = 48;
const SML_WMC_COLD_PER_REQ = 6;

function sml_wmc_watchlist( $uid ) {
	if ( function_exists( 'sml_fs_watchlist' ) ) {
		$list = (array) sml_fs_watchlist( (int) $uid );
	} else {
		$raw  = get_user_meta( (int) $uid, 'sml_watchlist', true );
		$list = is_array( $raw ) ? $raw : preg_split( '/[\s,]+/', (string) $raw );
	}
	$out = array();
	foreach ( $list as $s ) {
		$s = strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $s ) );
		if ( '' !== $s && strlen( $s ) <= 10 && ! in_array( $s, $out, true ) ) $out[] = $s;
	}
	return array_slice( $out, 0, SML_WMC_MAX_SYMBOLS );
}

function sml_wmc_text( $raw, $len = 500 ) {
	$t = wp_strip_all_tags( html_entity_decode( (string) $raw, ENT_QUOTES, 'UTF-8' ), true );
	$t = trim( preg_replace( '/\s+/u', ' ', $t ) );
	if ( mb_strlen( $t ) > $len ) $t = mb_substr( $t, 0, $len - 1 ) . '…';
	return $t;
}

/** Only moomoo's own https URLs are passed on as links/images. */
function sml_wmc_moomoo_url( $url ) {
	$url  = esc_url_raw( (string) $url );
	$host = strtolower( (string) wp_parse_url( $url, PHP_URL_HOST ) );
	return ( 'https' === wp_parse_url( $url, PHP_URL_SCHEME ) && preg_match( '/(^|\.)moomoo\.com$/', $host ) ) ? $url : '';
}

/** One symbol's comments, normalized; null when not cached and not allowed to fetch now. */
function sml_wmc_symbol_posts( $sym, $may_fetch ) {
	$key = 'sml_wmc_' . strtolower( $sym );
	$hit = get_transient( $key );
	if ( is_array( $hit ) ) return $hit;
	if ( ! $may_fetch ) return null;
	$req = new WP_REST_Request( 'GET', '/sml-ticker-community/v1/moomoo' );
	$req->set_param( 'symbol', $sym );
	$res  = rest_do_request( $req );
	$data = $res->is_error() ? array() : (array) $res->get_data();
	$out  = array();
	foreach ( (array) ( $data['posts'] ?? array() ) as $p ) {
		if ( ! is_array( $p ) ) continue;
		$text = sml_wmc_text( $p['text'] ?? '' );
		$ts   = strtotime( (string) ( $p['date'] ?? '' ) );
		$pid  = preg_replace( '/[^A-Za-z0-9_\-]/', '', (string) ( $p['id'] ?? '' ) );
		if ( '' === $text || ! $ts || '' === $pid ) continue;
		$out[] = array(
			'id'          => 'mmc-' . $pid,
			'symbol'      => $sym,
			'name'        => sml_wmc_text( $p['moomoo_name'] ?? 'moomoo user', 60 ),
			'avatar'      => sml_wmc_moomoo_url( $p['avatar_url'] ?? '' ),
			'profile_url' => sml_wmc_moomoo_url( $p['profile_url'] ?? '' ),
			'url'         => sml_wmc_moomoo_url( $p['source_url'] ?? '' ),
			'text'        => $text,
			'type'        => ( 'comment' === ( $p['source_type'] ?? '' ) ) ? 'comment' : 'post',
			'date'        => gmdate( 'c', $ts ),
			'ts'          => $ts,
		);
	}
	$community = sml_wmc_moomoo_url( $data['community_url'] ?? '' ) ?: 'https://www.moomoo.com/stock/' . rawurlencode( $sym ) . '-US/community';
	$packed = array( 'posts' => $out, 'community_url' => $community );
	set_transient( $key, $packed, $out ? 90 : 45 );
	return $packed;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-watch/v1', '/moomoo-comments', array(
		'methods'             => 'GET',
		'permission_callback' => 'is_user_logged_in',
		'callback'            => 'sml_wmc_rest',
	) );
} );

function sml_wmc_rest( WP_REST_Request $req ) {
	$uid  = get_current_user_id();
	$syms = sml_wmc_watchlist( $uid );
	$respond = function ( $body ) {
		$res = new WP_REST_Response( $body );
		$res->header( 'Cache-Control', 'no-store, private' );
		return $res;
	};
	if ( ! $syms ) return $respond( array( 'items' => array(), 'symbols' => array(), 'reason' => 'no_watchlist' ) );

	$cutoff = time() - SML_WMC_MAX_AGE_H * HOUR_IN_SECONDS;
	$items  = array(); $pending = array(); $cold = 0;
	foreach ( $syms as $sym ) {
		$may   = $cold < SML_WMC_COLD_PER_REQ;
		$was   = get_transient( 'sml_wmc_' . strtolower( $sym ) );
		$packed = sml_wmc_symbol_posts( $sym, $may );
		if ( ! is_array( $was ) && $may ) $cold++;
		if ( null === $packed ) { $pending[] = $sym; continue; }
		$n = 0;
		foreach ( $packed['posts'] as $p ) {
			if ( $p['ts'] < $cutoff ) continue;
			$p['reply_url'] = $p['url'] ?: $packed['community_url'];
			$items[] = $p;
			if ( ++$n >= SML_WMC_PER_SYMBOL ) break;
		}
	}
	usort( $items, function ( $a, $b ) { return $b['ts'] <=> $a['ts']; } );
	$items = array_slice( $items, 0, SML_WMC_TOTAL );
	foreach ( $items as &$i ) unset( $i['ts'] );
	unset( $i );
	return $respond( array( 'items' => $items, 'symbols' => $syms, 'pending' => $pending ) );
}
