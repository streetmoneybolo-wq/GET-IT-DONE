<?php
/** Loads the tools on /groups/{slug}/ for logged-in members of that group. */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sml_gpro_slug_from_request() {
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
	$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
	if ( preg_match( '#^/groups/([a-z0-9\-]{2,80})/?$#i', $path, $m ) && 'create' !== strtolower( $m[1] ) ) {
		return strtolower( $m[1] );
	}
	return '';
}

add_action( 'wp_footer', static function () {
	if ( ! is_user_logged_in() || is_admin() ) {
		return;
	}
	$slug = sml_gpro_slug_from_request();
	if ( '' === $slug ) {
		return;
	}
	$group = sml_gpro_group_by_slug( $slug );
	if ( ! $group ) {
		return;
	}
	$viewer = sml_gpro_viewer( (int) $group['id'] );
	if ( 'none' === $viewer['level'] ) {
		return;
	}
	$cfg = array(
		'api'       => esc_url_raw( rest_url( 'sml-gpro/v1/' ) ),
		'nonce'     => wp_create_nonce( 'wp_rest' ),
		'groupId'   => (int) $group['id'],
		'slug'      => $slug,
		'level'     => $viewer['level'],
		'canCurate' => (bool) $viewer['can_curate'],
		'ticker'    => isset( $group['ticker_symbol'] ) ? strtoupper( preg_replace( '/[^A-Za-z0-9.\-]/', '', (string) $group['ticker_symbol'] ) ) : '',
		'watchlist' => sml_gpro_watchlist( (int) $group['id'] ),
		'version'   => SML_GPRO_VERSION,
	);
	$ver = SML_GPRO_VERSION . '.' . (string) @filemtime( SML_GPRO_DIR . 'assets/gpro.js' );
	echo '<link id="sml-gpro-css" rel="stylesheet" href="' . esc_url( SML_GPRO_URL . 'assets/gpro.css?v=' . rawurlencode( $ver ) ) . '">' . "\n";
	echo '<script id="sml-gpro-cfg">window.SML_GPRO=' . wp_json_encode( $cfg ) . ';</script>' . "\n";
	echo '<script id="sml-gpro-js" defer src="' . esc_url( SML_GPRO_URL . 'assets/gpro.js?v=' . rawurlencode( $ver ) ) . '"></script>' . "\n";
}, 111 );
