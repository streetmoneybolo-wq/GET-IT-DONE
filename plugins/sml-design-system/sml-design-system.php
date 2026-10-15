<?php
/**
 * Plugin Name: SML Design System
 * Description: One look for every page of stockmarketloop.com: shared colour and type tokens (IBM Plex Sans, Archivo, IBM Plex Mono), the dark canvas on theme pages, consistent buttons, cards, forms and engagement controls, avatar fallbacks, plain punctuation in copy, and the loading hints that make the next page open instantly (preconnects, an early stylesheet preload, speculation rules).
 * Version: 1.1.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_DS_VERSION', '1.1.0' );

function sml_ds_url( $file ) { return plugins_url( $file, __FILE__ ); }
function sml_ds_request_path() { return (string) wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '', PHP_URL_PATH ); }

/* The fonts the whole site shares (IBM Plex Sans for copy, Archivo for display headings, IBM Plex Mono for numbers) and the stylesheet.
   Printed late in <head> so it sits after the theme and plugin styles it refines. */
function sml_ds_fonts_href() {
	return 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Archivo:wght@600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap';
}
function sml_ds_css_href() { return sml_ds_url( 'assets/design-system.css' ) . '?v=' . rawurlencode( SML_DS_VERSION ); }
function sml_ds_head_html() {
	return "\n" . '<link id="sml-ds-fonts" rel="stylesheet" href="' . esc_url( sml_ds_fonts_href() ) . '">' . "\n"
		. '<link id="sml-ds-css" rel="stylesheet" href="' . esc_url( sml_ds_css_href() ) . '">' . "\n";
}

/* Printed first in <head>: the connections every page needs (the CDN that serves the site scripts, the fonts, the two APIs), an early
   preload of the stylesheet so it is fetched while the long head is still parsing, and speculation rules so the browser fetches the
   next page as soon as the visitor shows interest in a link (hover or touch) and renders it ahead on a press. Pages that change state
   through a URL (sign-in, the account, the store, anything with a query string) are never fetched ahead. */
function sml_ds_early_html() {
	$skip = array( '/wp-admin/*', '/wp-login.php*', '/wp-json/*', '/go-live/*', '/upload-video/*', '/creator-studio/*', '/store/*', '/shop/*', '/cart/*', '/checkout/*', '/checkout-2/*', '/my-account/*', '/wallet/*', '/creator-wallet/*', '/settings/*', '/customize-profile/*', '/two-step/*', '/data-deletion/*', '/connect-migrate/*', '/*\\?*', '/*#*' );
	$rules = array(
		'prefetch'  => array(
			array( 'where' => array( 'and' => array( array( 'href_matches' => '/*' ), array( 'not' => array( 'href_matches' => $skip ) ), array( 'not' => array( 'selector_matches' => '[download], [target=_blank], .no-prefetch, [data-no-prefetch]' ) ) ) ), 'eagerness' => 'moderate' ),
			array( 'where' => array( 'and' => array( array( 'selector_matches' => '#sml-global-header a[href], #sml-legal-footer a[href]' ), array( 'not' => array( 'href_matches' => $skip ) ) ) ), 'eagerness' => 'eager' ),
		),
		'prerender' => array(
			array( 'where' => array( 'and' => array( array( 'href_matches' => '/*' ), array( 'not' => array( 'href_matches' => $skip ) ), array( 'not' => array( 'selector_matches' => '[download], [target=_blank], .no-prefetch, [data-no-prefetch]' ) ) ) ), 'eagerness' => 'conservative' ),
		),
	);
	$hosts = array( 'https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://sml-platform-api.onrender.com', 'https://stockmarketloop-loop-kick.onrender.com' );
	$out  = "\n" . '<meta id="sml-ds-early" name="sml-design-system" content="' . esc_attr( SML_DS_VERSION ) . '">' . "\n";
	foreach ( $hosts as $h ) { $out .= '<link rel="preconnect" href="' . esc_url( $h ) . '" crossorigin>' . "\n"; }
	$out .= '<link rel="preload" as="style" href="' . esc_url( sml_ds_css_href() ) . '">' . "\n";
	$out .= '<link rel="preload" as="style" href="' . esc_url( sml_ds_fonts_href() ) . '">' . "\n";
	$out .= '<script type="speculationrules">' . wp_json_encode( $rules, JSON_UNESCAPED_SLASHES ) . '</script>' . "\n";
	return $out;
}
add_action( 'wp_head', 'sml_ds_head_early', 1 );
function sml_ds_head_early() { if ( ! is_admin() ) { echo sml_ds_early_html(); } } // phpcs:ignore WordPress.Security.EscapeOutput
function sml_ds_footer_html() {
	return "\n" . '<script id="sml-ds-js" src="' . esc_url( sml_ds_url( 'assets/design-system.js' ) . '?v=' . rawurlencode( SML_DS_VERSION ) ) . '" defer></script>' . "\n";
}

add_action( 'wp_head', 'sml_ds_head', 999 );
function sml_ds_head() { if ( ! is_admin() ) { echo sml_ds_head_html(); } } // phpcs:ignore WordPress.Security.EscapeOutput
add_action( 'wp_footer', 'sml_ds_footer', 999 );
function sml_ds_footer() { if ( ! is_admin() ) { echo sml_ds_footer_html(); } } // phpcs:ignore WordPress.Security.EscapeOutput

/* Pages that print their own HTML without wp_head / wp_footer (Groups, the chart lab, other plugin screens) get the same files
   through the output buffer, so the look is the same everywhere. Non-HTML output passes through untouched. */
add_action( 'init', 'sml_ds_buffer', -999 );
function sml_ds_buffer() {
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) || ( defined( 'WP_CLI' ) && WP_CLI ) ) { return; }
	if ( ! isset( $_SERVER['REQUEST_METHOD'] ) || 'GET' !== $_SERVER['REQUEST_METHOD'] ) { return; }
	$path = sml_ds_request_path();
	if ( strpos( $path, '/wp-json' ) === 0 || strpos( $path, '/wp-admin' ) === 0 || strpos( $path, '/wp-login' ) === 0 || preg_match( '#\.(?:js|css|png|jpe?g|gif|webp|svg|ico|json|xml|txt|webmanifest|woff2?|ttf|mp4|mp3|pdf|zip)$#i', $path ) ) { return; }
	ob_start( 'sml_ds_inject' );
}
function sml_ds_inject( $html ) {
	if ( ! is_string( $html ) || $html === '' || stripos( $html, '<html' ) === false ) { return $html; }
	if ( stripos( $html, 'id="sml-ds-early"' ) === false ) {
		$open = stripos( $html, '<head' );
		if ( $open !== false ) { $close = strpos( $html, '>', $open ); if ( $close !== false ) { $html = substr( $html, 0, $close + 1 ) . sml_ds_early_html() . substr( $html, $close + 1 ); } }
	}
	if ( stripos( $html, 'id="sml-ds-css"' ) === false ) {
		$head = stripos( $html, '</head>' );
		if ( $head !== false ) { $html = substr( $html, 0, $head ) . sml_ds_head_html() . substr( $html, $head ); }
	}
	if ( stripos( $html, 'id="sml-ds-js"' ) === false ) {
		$body = strripos( $html, '</body>' );
		if ( $body !== false ) { $html = substr( $html, 0, $body ) . sml_ds_footer_html() . substr( $html, $body ); }
	}
	return $html;
}

/* The sign-in page (wp-login.php) wears the same canvas: the stylesheet, the fonts and the site logo. */
add_filter( 'login_body_class', 'sml_ds_login_body_class' );
function sml_ds_login_body_class( $classes ) { $classes[] = 'sml-ds'; return $classes; }
add_action( 'login_enqueue_scripts', 'sml_ds_login_head', 999 );
function sml_ds_login_head() { echo sml_ds_head_html(); } // phpcs:ignore WordPress.Security.EscapeOutput
add_filter( 'login_headerurl', 'sml_ds_login_headerurl' );
function sml_ds_login_headerurl() { return home_url( '/' ); }
add_filter( 'login_headertext', 'sml_ds_login_headertext' );
function sml_ds_login_headertext() { return 'Stock Market Loop'; }

/* Plain punctuation in everything WordPress prints: a spaced dash becomes a colon after a short lead-in ("Market news: timely coverage")
   and a comma anywhere else ("Visit our Contact page, we read every message"). Ranges such as 2k–5k and anything inside code are left alone.
   The same rule runs in the browser for content other scripts render (the feed, the store, the landing page). */
function sml_ds_dash_segment( $text, $open_label ) {
	$out = ''; $rest = $text;
	while ( preg_match( '/[ \x{00A0}]*(?:—|–(?=[ \x{00A0}]))[ \x{00A0}]*/u', $rest, $m, PREG_OFFSET_CAPTURE ) ) {
		$at = $m[0][1]; $before = substr( $rest, 0, $at ); $after = substr( $rest, $at + strlen( $m[0][0] ) );
		$lead = trim( $out . $before ); $here = trim( $before );
		$tail = preg_split( '/[.!?:;]\s+/u', $lead ); $tail = end( $tail );
		$words = $tail === '' ? 0 : count( preg_split( '/\s+/u', trim( $tail ) ) );
		$conj = (bool) preg_match( '/^(?:and|or|but|so|nor|yet|not|which|because|while|then|plus|as|if|unless|though|although|even)\b/iu', ltrim( $after ) );
		$label = ! $conj && ( ( $here === '' && $open_label ) || ( $here !== '' && $words > 0 && $words <= 4 && $tail === $lead && ! preg_match( '/[,.!?:;]/u', $lead ) ) );
		$sep = $label ? ': ' : ', ';
		if ( $here === '' && ! $open_label ) { $sep = ' '; }
		$out .= rtrim( $before ) . $sep; $rest = ltrim( $after ); $open_label = false;
	}
	return $out . $rest;
}
function sml_ds_dashes( $html ) {
	if ( ! is_string( $html ) || $html === '' || ( strpos( $html, '—' ) === false && strpos( $html, '–' ) === false ) ) { return $html; }
	$parts = preg_split( '/(<(?:script|style|pre|code|textarea)\b[^>]*>.*?<\/(?:script|style|pre|code|textarea)>|<[^>]+>)/isu', $html, -1, PREG_SPLIT_DELIM_CAPTURE );
	if ( $parts === false ) { return $html; }
	$out = ''; $label = false;
	foreach ( $parts as $i => $p ) {
		if ( $i % 2 === 1 ) { $out .= $p; $label = (bool) preg_match( '/^<\/(?:strong|b|em|i|a|span|h[1-6]|dt|th)>/i', $p ); continue; }
		$out .= sml_ds_dash_segment( $p, $label ); if ( trim( $p ) !== '' ) { $label = false; }
	}
	return $out;
}
function sml_ds_dashes_front( $text ) { return ( is_admin() && ! wp_doing_ajax() ) ? $text : sml_ds_dashes( $text ); }
foreach ( array( 'the_title', 'the_content', 'the_excerpt', 'get_the_excerpt', 'widget_text', 'widget_title', 'term_description', 'get_the_archive_description', 'single_post_title', 'wp_title' ) as $sml_ds_filter ) {
	add_filter( $sml_ds_filter, 'sml_ds_dashes_front', 20 );
}
add_filter( 'document_title_parts', 'sml_ds_dashes_title_parts', 20 );
function sml_ds_dashes_title_parts( $parts ) { foreach ( $parts as $k => $v ) { $parts[ $k ] = sml_ds_dashes( $v ); } return $parts; }

/* A body class so the stylesheet can tell theme pages from app screens. */
add_filter( 'body_class', 'sml_ds_body_class' );
function sml_ds_body_class( $classes ) { $classes[] = 'sml-ds'; return $classes; }
