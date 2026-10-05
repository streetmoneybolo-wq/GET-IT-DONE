<?php
/**
 * Plugin Name: SML Perf Guard
 * Description: Keeps group pages fast: a short per-member cache for slow read-only REST routes, and a front-end throttle that lets the channel render before non-critical widgets fetch.
 * Version: 1.0.0
 * Requires PHP: 7.4
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_PERF_GUARD_VERSION', '1.0.0' );

/* Route => seconds. Read-only GET routes only; every entry is cached per member (anonymous visitors share one entry), so personalised data never crosses users. */
function sml_perf_guard_routes(): array {
	return apply_filters( 'sml_perf_guard_routes', array(
		'#^/sml-home-engagement/v1/counts$#'            => 15,
		'#^/sml-gifts/v1/(summary|featured)$#'          => 20,
		'#^/sml-feed-profiles/v1/strip$#'               => 30,
		'#^/sml-scanner/v1/quotes$#'                    => 4,
		'#^/sml-channel-visuals/v1/groups/\d+/visuals$#' => 15,
	) );
}

function sml_perf_guard_ttl( WP_REST_Request $request ): int {
	if ( 'GET' !== $request->get_method() ) { return 0; }
	$route = $request->get_route();
	foreach ( sml_perf_guard_routes() as $pattern => $ttl ) {
		if ( preg_match( $pattern, $route ) ) { return (int) $ttl; }
	}
	return 0;
}

function sml_perf_guard_key( WP_REST_Request $request ): string {
	$uid  = get_current_user_id();
	$gen  = (int) wp_cache_get( 'gen_' . $uid, 'sml_perf_guard' );
	$args = $request->get_query_params();
	ksort( $args );
	return 'r_' . md5( $request->get_route() . '|' . wp_json_encode( $args ) . '|' . $uid . '|' . $gen );
}

/* Short-circuit before the route runs. Authentication has already happened, so the user id in the key is trustworthy. */
add_filter( 'rest_pre_dispatch', static function ( $result, $server, $request ) {
	if ( null !== $result || ! $request instanceof WP_REST_Request || sml_perf_guard_ttl( $request ) <= 0 ) { return $result; }
	$hit = wp_cache_get( sml_perf_guard_key( $request ), 'sml_perf_guard' );
	if ( is_array( $hit ) && isset( $hit['data'] ) ) {
		$response = new WP_REST_Response( $hit['data'], 200 );
		$response->header( 'X-SML-Perf', 'HIT' );
		$response->header( 'Cache-Control', 'private, no-cache' );
		return $response;
	}
	return $result;
}, 5, 3 );

add_filter( 'rest_post_dispatch', static function ( $response, $server, $request ) {
	if ( ! $request instanceof WP_REST_Request || ! $response instanceof WP_REST_Response ) { return $response; }
	$method = $request->get_method();
	/* A write by this member makes their own cached reads stale at once. */
	if ( 'GET' !== $method && 'HEAD' !== $method && 'OPTIONS' !== $method && get_current_user_id() ) {
		$uid = get_current_user_id();
		wp_cache_set( 'gen_' . $uid, (int) wp_cache_get( 'gen_' . $uid, 'sml_perf_guard' ) + 1, 'sml_perf_guard', DAY_IN_SECONDS );
		return $response;
	}
	$ttl = sml_perf_guard_ttl( $request );
	$headers = $response->get_headers();
	if ( $ttl <= 0 || 200 !== $response->get_status() || ( isset( $headers['X-SML-Perf'] ) && 'HIT' === $headers['X-SML-Perf'] ) ) { return $response; }
	wp_cache_set( sml_perf_guard_key( $request ), array( 'data' => $response->get_data() ), 'sml_perf_guard', $ttl );
	$response->header( 'X-SML-Perf', 'MISS' );
	return $response;
}, 20, 3 );

/* Front end (group pages only): non-critical widget calls wait until the page has loaded and the browser is idle, and at most two run at once, so the
 * channel, chat and chart are not queued behind gifts, engagement counts, profile strips and similar. Live-data routes are never delayed. */
add_action( 'wp_head', static function () {
	$path = wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH );
	if ( ! is_string( $path ) || ! preg_match( '#^/groups/[^/]+/?#', $path ) || preg_match( '#^/groups/(leaderboard|new)/?#', $path ) ) { return; }
	?>
<script id="sml-perf-guard-js">(function(){
if(window.__smlPerfGuard)return;window.__smlPerfGuard=1;
var LATE=/\/wp-json\/(sml-gifts\/|sml-feed-profiles\/|sml-home-engagement\/|sml-retail-spotlight\/|sml-pulse\/|sml-kg\/|sml-site-search\/|sml-members\/v1\/profile-feed)/;
var ready=false,waiters=[],active=0,MAX=2,F=window.fetch;
function release(){ready=true;var w=waiters;waiters=[];w.forEach(function(f){f()})}
function go(){var idle=window.requestIdleCallback||function(f){return setTimeout(f,250)};idle(release,{timeout:2500})}
if(document.readyState==='complete')go();else window.addEventListener('load',go,{once:true});
setTimeout(release,6000);
window.fetch=function(input,init){
 try{var url=typeof input==='string'?input:(input&&input.url)||'';var m=String((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
  if(m==='GET'&&LATE.test(url)){return new Promise(function(res,rej){
    function start(){if(active>=MAX){waiters.push(start);return}active++;var p=F.call(window,input,init);p.then(res,rej);var done=function(){active--;var n=waiters.shift();if(n)n()};p.then(done,done)}
    if(ready)start();else waiters.push(start)})}}catch(e){}
 return F.apply(window,arguments)};
})();</script>
	<?php
}, 1 );
