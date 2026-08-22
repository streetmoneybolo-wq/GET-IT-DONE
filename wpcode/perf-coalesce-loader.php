/**
 * SML Performance — site-wide GET request coalescing loader.
 *
 * Injects the coalescing shim INLINE (not as an external <script src>) as the
 * very first thing in <head> — a synchronous external request there would
 * itself become a render-blocking resource waiting on a CDN round-trip,
 * which would undercut the whole point. Inlining costs ~1KB of HTML and
 * guarantees window.fetch is wrapped before any other script (including
 * legacy plugin code this repo has no visibility into) can call it, with
 * zero extra network requests. Source of truth for the shim logic itself is
 * js/perf-fetch-coalesce.js in this repo — keep the two in sync if you edit
 * either; this copy is intentionally static/inlined for load-order safety,
 * not fetched at runtime.
 *
 * WPCode setup: PHP snippet, Auto Insert / Run Everywhere.
 * ROLLBACK: deactivate this snippet — fetch behaves exactly as it does today,
 * nothing here is stateful or destructive.
 */
if ( ! function_exists( 'sml_perf_coalesce_active' ) ) {
	function sml_perf_coalesce_active() {
		if ( is_admin() ) { return false; }
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false !== strpos( $uri, '/wp-json/' ) || false !== strpos( $uri, '/wp-admin/' ) ) { return false; }
		if ( defined( 'DOING_AJAX' ) && DOING_AJAX ) { return false; }
		return true;
	}

	function sml_perf_coalesce_js() {
		return <<<'JS'
(function(){"use strict";if(window.__smlFetchCoalesced||typeof window.fetch!=="function")return;window.__smlFetchCoalesced=true;
var native=window.fetch.bind(window);var inflight=Object.create(null);
function isPlainGet(input,init){var method=(init&&init.method)||(input&&input.method)||"GET";if(String(method).toUpperCase()!=="GET")return false;if(init&&init.body)return false;return true;}
function keyFor(input,init){var url=typeof input==="string"?input:(input&&input.url);if(!url)return null;try{url=new URL(url,location.href).href;}catch(e){}var creds=(init&&init.credentials)||(input&&input.credentials)||"same-origin";return creds+"|"+url;}
window.fetch=function(input,init){if(!isPlainGet(input,init))return native(input,init);var key=keyFor(input,init);if(!key)return native(input,init);
if(inflight[key])return inflight[key].then(function(res){return res.clone();});
var p=native(input,init).then(function(res){delete inflight[key];return res;},function(err){delete inflight[key];throw err;});
inflight[key]=p;return p.then(function(res){return res.clone();});};})();
JS;
	}

	function sml_perf_coalesce_ob( $html ) {
		if ( ! is_string( $html ) ) { return $html; }
		if ( false !== strpos( $html, 'id="sml-perf-coalesce"' ) ) { return $html; } // idempotent
		foreach ( headers_list() as $h ) { if ( 0 === stripos( $h, 'content-type:' ) && false === stripos( $h, 'text/html' ) ) { return $html; } }
		if ( ! preg_match( '/<head\b[^>]*>/i', $html, $m, PREG_OFFSET_CAPTURE ) ) { return $html; }
		$tag = '<script id="sml-perf-coalesce">' . sml_perf_coalesce_js() . '</script>';
		$at  = $m[0][1] + strlen( $m[0][0] );
		return substr( $html, 0, $at ) . $tag . substr( $html, $at );
	}

	add_action( 'init', static function () {
		if ( sml_perf_coalesce_active() ) { ob_start( 'sml_perf_coalesce_ob' ); }
	}, 0 );
}
