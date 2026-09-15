<?php
/*
Plugin Name: SML Go Live — Multi-screen setup
Description: Adds the easy multi-screen (up to 3 screens) live-stream setup to /go-live/ (screen-count picker → POST sml-live/v1/slots, per-screen keys, one-stream-per-screen guide, live status via js/go-live-screens.js) and keeps the legacy browser-cam "Stream Health" panel hidden there. Non-invasive; reversible by deactivation.
Version: 1.1.0
Author: StockMarketLoop
*/

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * On the /go-live/ page (logged-in creators only), buffer the output and inject
 * the config globals + the multi-screen script before </body>.
 */
add_action( 'init', 'sml_glms_maybe_buffer', 0 );
function sml_glms_maybe_buffer() {
	if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) {
		return;
	}
	if ( ! is_user_logged_in() ) {
		return;
	}
	$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '';
	$path = trim( (string) parse_url( $uri, PHP_URL_PATH ), '/' );
	if ( $path !== 'go-live' ) {
		return;
	}
	ob_start( 'sml_glms_inject' );
}

function sml_glms_inject( $html ) {
	if ( ! is_string( $html ) || stripos( $html, '</body>' ) === false ) {
		return $html; // Not a full HTML document (JSON / bare template).
	}
	if ( strpos( $html, 'sml-gl-screens-js' ) !== false ) {
		return $html; // Already injected.
	}

	$uid    = get_current_user_id();
	$user   = get_userdata( $uid );
	$handle = $user ? $user->user_nicename : ''; // /feeds/{handle} resolves via get_user_by('slug', …).

	$ref = function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main';
	$src = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( (string) $ref ) . '/js/go-live-screens.js';

	$cfg = '<script id="sml-gl-screens-cfg">'
		. 'window.SML_GL_NONCE=' . wp_json_encode( wp_create_nonce( 'wp_rest' ) ) . ';'
		. 'window.SML_GL_HANDLE=' . wp_json_encode( $handle ) . ';'
		. 'window.SML_GL_INGEST=' . wp_json_encode( 'rtmp://live.stockmarketloop.com/live' ) . ';'
		. '</script>';
	// Stable, visible, body-level mount point. The Go Live wizard is a client-rendered
	// SPA whose panels re-render (and its Stream Health panel is hidden), so a body-level
	// container is the reliable place for the card — it is never wiped or hidden.
	$mount = '<div id="sml-gl-multiscreen" style="max-width:760px;margin:22px auto 44px;padding:0 16px;box-sizing:border-box"></div>';
	$js = '<script id="sml-gl-screens-js" src="' . esc_url( $src ) . '" defer></scr' . 'ipt>';

	// Keep the legacy browser-cam "Stream Health" panel hidden on /go-live/ (it only
	// watched the browser camera and showed "Encoder: Waiting" forever). This matches
	// the behavior of the now-deactivated snippet 7047; the shared #sml-glh-off-js
	// marker means the two never double-inject if 7047 is ever reactivated.
	$glh = '';
	if ( strpos( $html, 'sml-glh-off-js' ) === false ) {
		$glh = '<script id="sml-glh-off-js">(function(){var done=false;'
			. 'var pre=document.createElement("style");'
			. 'pre.textContent="#gl-middle>section.cs-card:nth-of-type(2){display:none!important}";'
			. '(document.head||document.documentElement).appendChild(pre);'
			. 'function mark(){var mid=document.getElementById("gl-middle");if(!mid)return;'
			. 'var k=mid.children;for(var i=0;i<k.length;i++){var c=k[i];if(c.tagName!=="SECTION")continue;'
			. 'var h=c.querySelector("h1,h2,h3,h4");'
			. 'if(h&&/^\s*Stream Health\s*$/i.test(h.textContent||"")){'
			. 'c.style.setProperty("display","none","important");'
			. 'if(!done){done=true;if(pre.parentNode)pre.parentNode.removeChild(pre);}}}}'
			. 'mark();'
			. 'try{new MutationObserver(mark).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}'
			. 'var n=0,t=setInterval(function(){mark();if(++n>60)clearInterval(t);},250);'
			. '})();</scr' . 'ipt>';
	}

	return str_replace( '</body>', $glh . $mount . $cfg . $js . '</body>', $html );
}
