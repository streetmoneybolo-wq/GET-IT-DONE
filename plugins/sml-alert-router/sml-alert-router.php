<?php
/**
 * Plugin Name: SML Alert Router
 * Description: Creator-controlled, loop-safe alert routing between StockMarketLoop, Discord, and Telegram.
 * Version: 1.0.0
 * Author: Stock Market Loop
 */

defined( 'ABSPATH' ) || exit;

if ( ! function_exists( 'sml_ar_api_secret' ) ) {

function sml_ar_api_secret() {
	return defined( 'SML_PLATFORM_BILLING_API_SECRET' ) ? trim( (string) SML_PLATFORM_BILLING_API_SECRET ) : '';
}

function sml_ar_bridge_secret() {
	return defined( 'SML_PLATFORM_BILLING_BRIDGE_SECRET' ) ? trim( (string) SML_PLATFORM_BILLING_BRIDGE_SECRET ) : '';
}

function sml_ar_api_url() {
	return defined( 'SML_PLATFORM_API_URL' ) ? untrailingslashit( (string) SML_PLATFORM_API_URL ) : '';
}

function sml_ar_signature( $timestamp, $body, $secret ) {
	return hash_hmac( 'sha256', $timestamp . '.' . $body, $secret );
}

function sml_ar_call( $path, array $payload ) {
	$base = sml_ar_api_url();
	$secret = sml_ar_api_secret();
	if ( '' === $base || '' === $secret ) return new WP_Error( 'sml_ar_unconfigured', 'The alert router is not configured.', array( 'status' => 503 ) );
	$body = wp_json_encode( $payload );
	$timestamp = (string) time();
	$response = wp_remote_post( $base . $path, array(
		'timeout' => 20,
		'headers' => array(
			'Content-Type' => 'application/json',
			'X-SML-Timestamp' => $timestamp,
			'X-SML-Signature' => 'sha256=' . sml_ar_signature( $timestamp, $body, $secret ),
		),
		'body' => $body,
	) );
	if ( is_wp_error( $response ) ) return $response;
	$data = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( wp_remote_retrieve_response_code( $response ) >= 300 || empty( $data['ok'] ) ) {
		return new WP_Error( 'sml_ar_api', sanitize_text_field( $data['message'] ?? 'The alert router could not complete the request.' ), array( 'status' => 503 ) );
	}
	return $data;
}

function sml_ar_can_manage( $group_id ) {
	$group_id = absint( $group_id );
	if ( ! $group_id || ! is_user_logged_in() ) return false;
	if ( current_user_can( 'manage_options' ) ) return true;
	if ( function_exists( 'sml_dgc_can_manage' ) ) return (bool) sml_dgc_can_manage( $group_id );
	return false;
}

function sml_ar_owner_id( $group_id ) {
	if ( function_exists( 'sml_dgc_tables' ) ) {
		global $wpdb;
		$tables = sml_dgc_tables();
		return absint( $wpdb->get_var( $wpdb->prepare( "SELECT owner_id FROM {$tables['groups']} WHERE id=%d", absint( $group_id ) ) ) );
	}
	return get_current_user_id();
}

function sml_ar_routes_get( WP_REST_Request $request ) {
	$group_id = absint( $request['group_id'] );
	if ( ! sml_ar_can_manage( $group_id ) ) return new WP_Error( 'sml_ar_forbidden', 'Only this group owner or an administrator can change alert routing.', array( 'status' => 403 ) );
	$result = sml_ar_call( '/v1/alerts/routes/list', array( 'groupId' => $group_id, 'ownerUserId' => sml_ar_owner_id( $group_id ) ) );
	return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
}

function sml_ar_clean_browser_routes( $routes ) {
	$output = array();
	foreach ( is_array( $routes ) ? $routes : array() as $route ) {
		$source = sanitize_key( $route['sourceProvider'] ?? '' );
		if ( ! in_array( $source, array( 'sml', 'discord', 'telegram' ), true ) ) continue;
		$source_id = preg_replace( '/[^A-Za-z0-9_:@.\/-]/', '', (string) ( $route['sourceTargetId'] ?? '' ) );
		if ( '' === $source_id ) continue;
		$destinations = array();
		foreach ( is_array( $route['destinations'] ?? null ) ? $route['destinations'] : array() as $destination ) {
			$provider = sanitize_key( $destination['provider'] ?? '' );
			$target_id = preg_replace( '/[^A-Za-z0-9_:@.\/-]/', '', (string) ( $destination['targetId'] ?? '' ) );
			if ( in_array( $provider, array( 'sml', 'discord', 'telegram' ), true ) && '' !== $target_id ) {
				$destinations[] = array( 'provider' => $provider, 'targetId' => $target_id, 'enabled' => ! empty( $destination['enabled'] ) );
			}
		}
		$output[] = array(
			'name' => sanitize_text_field( $route['name'] ?? 'Alert route' ),
			'sourceProvider' => $source, 'sourceTargetId' => $source_id,
			'enabled' => ! empty( $route['enabled'] ), 'destinations' => $destinations,
		);
	}
	return $output;
}

function sml_ar_routes_save( WP_REST_Request $request ) {
	$group_id = absint( $request['group_id'] );
	if ( ! sml_ar_can_manage( $group_id ) ) return new WP_Error( 'sml_ar_forbidden', 'Only this group owner or an administrator can change alert routing.', array( 'status' => 403 ) );
	$result = sml_ar_call( '/v1/alerts/routes/replace', array(
		'groupId' => $group_id, 'ownerUserId' => sml_ar_owner_id( $group_id ),
		'routes' => sml_ar_clean_browser_routes( $request->get_param( 'routes' ) ),
	) );
	return is_wp_error( $result ) ? $result : rest_ensure_response( $result );
}

function sml_ar_verify_delivery( WP_REST_Request $request ) {
	$secret = sml_ar_bridge_secret();
	$timestamp = (string) $request->get_header( 'x-sml-timestamp' );
	$signature = strtolower( preg_replace( '/^sha256=/', '', (string) $request->get_header( 'x-sml-signature' ) ) );
	if ( '' === $secret || ! ctype_digit( $timestamp ) || abs( time() - (int) $timestamp ) > 300 ) return false;
	$expected = sml_ar_signature( $timestamp, $request->get_body(), $secret );
	return preg_match( '/^[a-f0-9]{64}$/', $signature ) && hash_equals( $expected, $signature );
}

function sml_ar_receive_delivery( WP_REST_Request $request ) {
	if ( ! sml_ar_verify_delivery( $request ) ) return new WP_Error( 'sml_ar_signature', 'Invalid alert delivery signature.', array( 'status' => 401 ) );
	$data = json_decode( $request->get_body(), true );
	$event = is_array( $data['event'] ?? null ) ? $data['event'] : array();
	$group_id = absint( $data['targetId'] ?? 0 );
	$event_id = absint( $event['event_id'] ?? $event['id'] ?? 0 );
	if ( ! $group_id || ! $event_id || empty( $event['body'] ) ) return new WP_Error( 'sml_ar_payload', 'Invalid alert delivery.', array( 'status' => 422 ) );
	$existing = get_posts( array( 'post_type' => 'any', 'post_status' => 'any', 'meta_key' => '_sml_alert_router_event_id', 'meta_value' => $event_id, 'fields' => 'ids', 'posts_per_page' => 1 ) );
	if ( $existing ) return rest_ensure_response( array( 'ok' => true, 'status' => 'duplicate', 'postId' => (int) $existing[0] ) );
	if ( ! post_type_exists( 'sml_alert' ) ) return new WP_Error( 'sml_ar_post_type', 'The StockMarketLoop alert post type is unavailable.', array( 'status' => 503 ) );
	$title = wp_trim_words( sanitize_text_field( $event['body'] ), 12, '…' );
	$post_id = wp_insert_post( array(
		'post_type' => 'sml_alert', 'post_status' => 'publish', 'post_title' => $title,
		'post_content' => wp_kses_post( $event['body'] ), 'post_author' => sml_ar_owner_id( $group_id ),
	), true );
	if ( is_wp_error( $post_id ) ) return $post_id;
	update_post_meta( $post_id, '_sml_alert_router_event_id', $event_id );
	update_post_meta( $post_id, 'sml_alert_group_id', $group_id );
	update_post_meta( $post_id, 'sml_alert_source_provider', sanitize_key( $event['source_provider'] ?? '' ) );
	do_action( 'sml_alert_router_received', $post_id, $group_id, $event );
	return rest_ensure_response( array( 'ok' => true, 'status' => 'published', 'postId' => $post_id ) );
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'sml-alert-router/v1', '/group/(?P<group_id>\d+)/routes', array(
		array( 'methods' => 'GET', 'callback' => 'sml_ar_routes_get', 'permission_callback' => 'is_user_logged_in' ),
		array( 'methods' => 'POST', 'callback' => 'sml_ar_routes_save', 'permission_callback' => 'is_user_logged_in' ),
	) );
	register_rest_route( 'sml-alert-router/v1', '/deliver', array(
		'methods' => 'POST', 'callback' => 'sml_ar_receive_delivery', 'permission_callback' => '__return_true',
	) );
} );

/** Existing alert publishers can call this action with post ID and group ID. */
function sml_ar_publish_post( $post_id, $group_id = 0 ) {
	$post = get_post( $post_id );
	$group_id = absint( $group_id ?: get_post_meta( $post_id, 'sml_alert_group_id', true ) );
	if ( ! $post || 'publish' !== $post->post_status || ! $group_id || get_post_meta( $post_id, '_sml_alert_router_event_id', true ) ) return;
	if ( get_post_meta( $post_id, '_sml_alert_router_sent', true ) ) return;
	$result = sml_ar_call( '/v1/alerts/ingest', array(
		'groupId' => $group_id, 'sourceProvider' => 'sml', 'sourceTargetId' => (string) $group_id,
		'sourceMessageId' => (string) $post_id, 'body' => wp_strip_all_tags( $post->post_content ),
		'authorExternalId' => (string) $post->post_author, 'authorName' => get_the_author_meta( 'display_name', $post->post_author ),
		'occurredAt' => get_post_time( DATE_ATOM, true, $post ),
	) );
	if ( ! is_wp_error( $result ) ) update_post_meta( $post_id, '_sml_alert_router_sent', current_time( 'mysql', true ) );
}
add_action( 'sml_alert_published', 'sml_ar_publish_post', 10, 2 );
add_action( 'save_post_sml_alert', function ( $post_id, $post ) { sml_ar_publish_post( $post_id, get_post_meta( $post_id, 'sml_alert_group_id', true ) ); }, 20, 2 );

add_action( 'wp_footer', function () {
	if ( ! is_user_logged_in() ) return;
	$nonce = wp_create_nonce( 'wp_rest' );
	?>
	<style>
	.sml-ar-open{border:1px solid #20e58b!important;background:#071a15!important;color:#6fffc0!important;font-weight:900!important}.sml-ar-modal{position:fixed;inset:0;z-index:999999;background:#020712e8;display:none;place-items:center;padding:20px}.sml-ar-modal.is-open{display:grid}.sml-ar-panel{width:min(760px,96vw);max-height:88vh;overflow:auto;background:#07111f;color:#eef7ff;border:1px solid #16df8c;border-radius:18px;padding:24px;box-shadow:0 0 45px #00df8a33}.sml-ar-panel h2{color:#fff;margin:0 0 8px}.sml-ar-note{color:#a8bbcb}.sml-ar-route{border:1px solid #28445a;border-radius:12px;padding:14px;margin:12px 0;background:#0b1726}.sml-ar-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.sml-ar-panel input,.sml-ar-panel select{box-sizing:border-box;width:100%;background:#030a12;color:#fff;border:1px solid #31526a;border-radius:8px;padding:10px}.sml-ar-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}.sml-ar-panel button{border:1px solid #20e58b;border-radius:9px;padding:9px 14px;background:#09251d;color:#8affce;font-weight:800}.sml-ar-remove{border-color:#ff506c!important;color:#ff93a5!important;background:#2c0910!important}@media(max-width:620px){.sml-ar-grid{grid-template-columns:1fr}}
	</style>
	<div class="sml-ar-modal" id="sml-ar-modal" aria-hidden="true"><section class="sml-ar-panel" role="dialog" aria-modal="true" aria-labelledby="sml-ar-title"><h2 id="sml-ar-title">Alert Distribution</h2><p class="sml-ar-note">Choose where an alert starts and every place it should appear. Changes apply to new alerts immediately.</p><div id="sml-ar-list"></div><button type="button" id="sml-ar-add">+ Add route</button><div class="sml-ar-actions"><button type="button" id="sml-ar-close">Cancel</button><button type="button" id="sml-ar-save">Save directions</button></div><p id="sml-ar-status" class="sml-ar-note" aria-live="polite"></p></section></div>
	<script>(function(){var nonce=<?php echo wp_json_encode( $nonce ); ?>,modal=document.getElementById('sml-ar-modal'),list=document.getElementById('sml-ar-list'),gid='',observer=null;if(!modal)return;function esc(v){return String(v||'').replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]})}function row(r){r=r||{name:'New alert route',sourceProvider:'discord',sourceTargetId:'',enabled:true,destinations:[]};var d={};(r.destinations||[]).forEach(function(x){d[x.provider]=x.targetId});var el=document.createElement('div');el.className='sml-ar-route';el.innerHTML='<div class="sml-ar-grid"><label>Route name<input data-k="name" value="'+esc(r.name)+'"></label><label>Alert starts in<select data-k="sourceProvider"><option value="discord">Discord</option><option value="telegram">Telegram</option><option value="sml">StockMarketLoop</option></select></label><label>Source channel/group ID<input data-k="sourceTargetId" value="'+esc(r.sourceTargetId)+'" placeholder="Discord channel ID, Telegram chat ID, or SML group ID"></label><label><input style="width:auto" type="checkbox" data-k="enabled" '+(r.enabled!==false?'checked':'')+'> Route enabled</label><label>Send to Discord channel ID<input data-d="discord" value="'+esc(d.discord)+'"></label><label>Send to Telegram chat ID<input data-d="telegram" value="'+esc(d.telegram)+'"></label><label>Send to SML group ID<input data-d="sml" value="'+esc(d.sml||gid)+'"></label></div><button type="button" class="sml-ar-remove">Remove route</button>';el.querySelector('[data-k="sourceProvider"]').value=r.sourceProvider;el.querySelector('.sml-ar-remove').onclick=function(){el.remove()};list.appendChild(el)}function collect(){return Array.from(list.children).map(function(el){var destinations=[];el.querySelectorAll('[data-d]').forEach(function(i){if(i.value.trim())destinations.push({provider:i.dataset.d,targetId:i.value.trim(),enabled:true})});return{name:el.querySelector('[data-k="name"]').value,sourceProvider:el.querySelector('[data-k="sourceProvider"]').value,sourceTargetId:el.querySelector('[data-k="sourceTargetId"]').value,enabled:el.querySelector('[data-k="enabled"]').checked,destinations:destinations}})}function api(method,body){return fetch('/wp-json/sml-alert-router/v1/group/'+gid+'/routes',{method:method,headers:{'X-WP-Nonce':nonce,'Content-Type':'application/json'},body:body&&JSON.stringify(body)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.message||'Request failed');return j})})}function open(){list.innerHTML='';modal.classList.add('is-open');modal.setAttribute('aria-hidden','false');document.getElementById('sml-ar-status').textContent='Loading…';api('GET').then(function(j){(j.routes||[]).forEach(row);if(!list.children.length)row();document.getElementById('sml-ar-status').textContent=''}).catch(function(e){document.getElementById('sml-ar-status').textContent=e.message})}function boot(){var root=document.getElementById('sml-group-root'),actions=root&&root.querySelector('.sml-group-actions,.sml-gshell__group-actions,[data-group-actions]');gid=root&&String(root.dataset.groupId||'').replace(/\D/g,'');if(!gid||!actions||actions.querySelector('.sml-ar-open'))return;var b=document.createElement('button');b.type='button';b.className='sml-group-btn sml-ar-open';b.textContent='⚡ Alert Directions';b.onclick=open;actions.appendChild(b);if(observer)observer.disconnect()}document.getElementById('sml-ar-add').onclick=function(){row()};document.getElementById('sml-ar-close').onclick=function(){modal.classList.remove('is-open')};document.getElementById('sml-ar-save').onclick=function(){var s=document.getElementById('sml-ar-status');s.textContent='Saving…';api('POST',{routes:collect()}).then(function(){s.textContent='Directions saved. New alerts will follow these routes.'}).catch(function(e){s.textContent=e.message})};observer=new MutationObserver(boot);observer.observe(document.documentElement,{childList:true,subtree:true});[0,300,900,1800,3500,7000,12000].forEach(function(ms){setTimeout(boot,ms)});})();</script>
	<?php
}, 110 );

}
