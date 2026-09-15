<?php
/*
Plugin Name: SML Go Live — hide legacy Stream Health
Description: Keeps the legacy browser-cam "Stream Health" panel hidden on /go-live/ (it only watched the browser camera and showed "Encoder: Waiting" forever). The real encoder status AND the multi-screen "Live video slots" control are NATIVE to the Go Live wizard (sml_slots_print_control), so nothing else is injected here. Replaces the health-hide half of the deactivated snippet 7047. Non-invasive; reversible by deactivation.
Version: 1.2.0
Author: StockMarketLoop
*/

// NOTE: the plugin directory is still named "sml-go-live-multiscreen" (legacy) — an
// earlier version also injected a multi-screen setup card, but that duplicated the
// wizard's native "Live video slots" control (sml_slots_print_control), so it was
// removed. This plugin now ONLY hides the legacy Stream Health panel.

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

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
		return $html; // Not a full HTML document.
	}
	if ( strpos( $html, 'sml-glh-off-js' ) !== false ) {
		return $html; // Already hidden (e.g. if snippet 7047 is reactivated).
	}

	// Find the #gl-middle Stream Health <section> by its heading text and hide it.
	// Anti-flash pre-style hides the 2nd section immediately; a MutationObserver
	// keeps it hidden through the wizard's client-side re-renders.
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

	return str_replace( '</body>', $glh . '</body>', $html );
}
