<?php
/**
 * Plugin Name: SML Design System
 * Description: One look for every page of stockmarketloop.com: shared colour and type tokens (IBM Plex Sans, Archivo, IBM Plex Mono), the dark canvas on theme pages, consistent buttons, cards, forms and engagement controls, avatar fallbacks, plain punctuation in copy, and the loading hints that make the next page open instantly (preconnects, an early stylesheet preload, speculation rules).
 * Version: 1.2.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_DS_VERSION', '1.2.0' );

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
function sml_ds_inject( $html, $phase = 0 ) {
	/* the buffer can reach here in pieces when something flushes mid-page. Each piece is treated on its own; a trailing
	   partial tag or an unfinished script, style, pre, code or textarea block is held back and joined to the next piece,
	   so the punctuation pass never sees half a tag or the inside of a script. The head and footer tags are added only
	   from a piece that carries the whole head, or the closing body tag. */
	static $is_html = null, $carry = '', $seen = array( 'early' => false, 'css' => false, 'js' => false );
	if ( ! is_string( $html ) ) { return $html; }
	$final = (bool) ( $phase & PHP_OUTPUT_HANDLER_FINAL );
	$html  = $carry . $html; $carry = '';
	if ( $html === '' ) { return $html; }
	if ( $is_html === null ) {
		/* decided on the first piece that carries anything: a feed or a JSON body is left alone, everything else is a page
		   (a piece can be as small as a newline a snippet printed early, so the decision cannot wait for the <html> tag) */
		$lead = ltrim( $html, " \t\r\n\xEF\xBB\xBF" );
		if ( $lead === '' ) { $carry = $html; return ''; }
		$is_html = ! ( stripos( $lead, '<?xml' ) === 0 || $lead[0] === '{' || $lead[0] === '[' );
	}
	if ( ! $is_html ) { return $html; }
	foreach ( array( 'early', 'css', 'js' ) as $k ) { if ( stripos( $html, 'id="sml-ds-' . $k . '"' ) !== false ) { $seen[ $k ] = true; } }
	$whole_head = preg_match( '/<head[\s>]/i', $html, $hm, PREG_OFFSET_CAPTURE ) && stripos( $html, '</head>' ) !== false; /* the <head> tag itself, not <header> */
	if ( $whole_head && ! $seen['early'] ) {
		$o = $hm[0][1];
		$c = strpos( $html, '>', $o ); if ( $c !== false ) { $html = substr( $html, 0, $c + 1 ) . sml_ds_early_html() . substr( $html, $c + 1 ); }
	}
	if ( $whole_head && ! $seen['css'] ) {
		$head = stripos( $html, '</head>' );
		if ( $head !== false ) { $html = substr( $html, 0, $head ) . sml_ds_head_html() . substr( $html, $head ); }
	}
	if ( ! $seen['js'] ) {
		$body = strripos( $html, '</body>' );
		if ( $body !== false ) { $html = substr( $html, 0, $body ) . sml_ds_footer_html() . substr( $html, $body ); }
	}
	if ( ! $final ) {
		$cut = strlen( $html );
		$lt = strrpos( $html, '<' );
		if ( $lt !== false && strpos( $html, '>', $lt ) === false ) { $cut = $lt; }                     /* a tag cut in half */
		if ( preg_match_all( '/<(script|style|pre|code|textarea)\b[^>]*>|<\/(script|style|pre|code|textarea)\s*>/i', substr( $html, 0, $cut ), $mm, PREG_OFFSET_CAPTURE | PREG_SET_ORDER ) ) {
			$depth = ''; $at = 0;
			foreach ( $mm as $m ) {
				if ( isset( $m[1] ) && $m[1][0] !== '' ) { if ( $depth === '' ) { $depth = strtolower( $m[1][0] ); $at = $m[0][1]; } }
				elseif ( isset( $m[2] ) && strtolower( $m[2][0] ) === $depth ) { $depth = ''; }
			}
			if ( $depth !== '' ) { $cut = $at; }                                                      /* a block still open */
		}
		if ( $cut < strlen( $html ) ) { $carry = substr( $html, $cut ); $html = substr( $html, 0, $cut ); }
	}
	return sml_ds_dashes( $html );
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
	if ( strpos( $text, '&' ) !== false ) { $text = preg_replace( array( '/&(?:#0*8212|#x0*2014|mdash);/i', '/&(?:#0*8211|#x0*2013|ndash);/i' ), array( "\xE2\x80\x94", "\xE2\x80\x93" ), $text ); }
	$out = ''; $rest = $text;
	while ( preg_match( '/(?: |\xC2\xA0)*(?:\xE2\x80\x94|\xE2\x80\x93(?= |\xC2\xA0))(?: |\xC2\xA0)*/', $rest, $m, PREG_OFFSET_CAPTURE ) ) {
		$at = $m[0][1]; $before = substr( $rest, 0, $at ); $after = substr( $rest, $at + strlen( $m[0][0] ) );
		$lead = trim( $out . $before ); $here = trim( $before );
		$tail = preg_split( '/[.!?:;]\s+/', $lead ); $tail = end( $tail );
		$words = $tail === '' ? 0 : count( preg_split( '/\s+/', trim( $tail ) ) );
		$conj = (bool) preg_match( '/^(?:and|or|but|so|nor|yet|not|which|because|while|then|plus|as|if|unless|though|although|even)\b/i', ltrim( $after ) );
		$label = ! $conj && ( ( $here === '' && $open_label ) || ( $here !== '' && $words > 0 && $words <= 4 && $tail === $lead && ! preg_match( '/[,.!?:;]/', $lead ) ) );
		$sep = $label ? ': ' : ', ';
		if ( $here === '' && ! $open_label ) { $sep = ' '; }
		$out .= rtrim( $before ) . $sep; $rest = ltrim( $after ); $open_label = false;
	}
	return $out . $rest;
}
function sml_ds_dashes( $html ) {
	if ( ! is_string( $html ) || $html === '' ) { return $html; }
	if ( strpos( $html, "\xE2\x80\x94" ) === false && strpos( $html, "\xE2\x80\x93" ) === false && ! preg_match( '/&(?:#0*821[12]|#x0*201[34]|mdash|ndash);/i', $html ) ) { return $html; }
	/* a linear scan, no backtracking regex over the whole page: text runs are treated, tags are copied, and script, style,
	   pre, code and textarea blocks are copied whole */
	$out = ''; $label = false; $pos = 0; $len = strlen( $html );
	while ( $pos < $len ) {
		$lt = strpos( $html, '<', $pos );
		if ( $lt === false ) { $out .= sml_ds_dash_segment( substr( $html, $pos ), $label ); break; }
		if ( $lt > $pos ) { $text = substr( $html, $pos, $lt - $pos ); $out .= sml_ds_dash_segment( $text, $label ); if ( trim( $text ) !== '' ) { $label = false; } }
		$gt = strpos( $html, '>', $lt );
		if ( $gt === false ) { $out .= substr( $html, $lt ); break; }
		$tag = substr( $html, $lt, $gt - $lt + 1 );
		if ( preg_match( '/^<(script|style|pre|code|textarea)\b/i', $tag, $m ) ) {
			$close = stripos( $html, '</' . $m[1], $gt );
			$closeEnd = $close === false ? false : strpos( $html, '>', $close );
			if ( $closeEnd === false ) { $out .= substr( $html, $lt ); break; }
			$out .= substr( $html, $lt, $closeEnd - $lt + 1 ); $pos = $closeEnd + 1; $label = false; continue;
		}
		if ( substr( $tag, 0, 4 ) === '<!--' ) {
			$ce = strpos( $html, '-->', $lt ); if ( $ce === false ) { $out .= substr( $html, $lt ); break; }
			$out .= substr( $html, $lt, $ce - $lt + 3 ); $pos = $ce + 3; continue;
		}
		$out .= $tag; $pos = $gt + 1;
		$label = (bool) preg_match( '/^<\/(?:strong|b|em|i|a|span|h[1-6]|dt|th)>$/i', $tag );
	}
	return $out;
}
function sml_ds_dashes_front( $text ) { return ( is_admin() && ! wp_doing_ajax() ) ? $text : sml_ds_dashes( $text ); }
foreach ( array( 'the_title', 'the_content', 'the_excerpt', 'get_the_excerpt', 'widget_text', 'widget_title', 'term_description', 'get_the_archive_description', 'single_post_title', 'wp_title' ) as $sml_ds_filter ) {
	add_filter( $sml_ds_filter, 'sml_ds_dashes_front', 20 );
}
add_filter( 'document_title_parts', 'sml_ds_dashes_title_parts', 20 );
add_filter( 'pre_get_document_title', 'sml_ds_dashes_front', 999 );
/* every rendered block (block themes build the whole page from blocks: titles, content, query loops, site title) */
add_filter( 'render_block', 'sml_ds_dashes_block', 999, 2 );
function sml_ds_dashes_block( $html, $block ) { return is_admin() ? $html : sml_ds_dashes( $html ); }
function sml_ds_dashes_title_parts( $parts ) { foreach ( $parts as $k => $v ) { $parts[ $k ] = sml_ds_dashes( $v ); } return $parts; }

/* A body class so the stylesheet can tell theme pages from app screens. */
add_filter( 'body_class', 'sml_ds_body_class' );
function sml_ds_body_class( $classes ) { $classes[] = 'sml-ds'; return $classes; }
