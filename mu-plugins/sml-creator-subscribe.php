<?php
/**
 * Plugin Name: SML Creator Subscribe Button
 * Description: One real Subscribe button on every Loop Channel, live stream and uploaded video. First click subscribes (the button then offers "Get Notifications"); a second click turns notifications on and the button goes gold; hovering a gold button flashes "Unsubscribe" in red. The choice is stored per viewer per creator. Subscribing uses the site's real follow store (sml_following / sml_followers — the same one Creator Studio counts), and bell subscribers get a LOOP-KICK when that creator goes live or publishes a video. 2026-09-19.
 * Version: 1.2.0
 * Author: StockMarketLoop
 *
 * OWNER SPEC (2026-09-19): Subscribe -> Get Notifications -> SUBSCRIBED (gold, animated);
 * hover while subscribed flashes "Unsubscribe" in red; whatever the viewer leaves it on stays.
 * Placement: between the stream clock and the Like button, replacing "Open $TICKER terminal".
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

const SML_CSUB_VERSION = '1.2.0';

/* ------------------------------------------------------------ state */

function sml_csub_ids( $raw ) {
	if ( function_exists( 'sml_members_id_list' ) ) { return sml_members_id_list( $raw ); }
	return array_values( array_unique( array_filter( array_map( 'absint', (array) $raw ) ) ) );
}

/** 0 = not subscribed, 1 = subscribed, 2 = subscribed + notifications. */
function sml_csub_level( $viewer, $creator ) {
	$viewer = (int) $viewer; $creator = (int) $creator;
	if ( ! $viewer || ! $creator ) { return 0; }
	if ( ! in_array( $creator, sml_csub_ids( get_user_meta( $viewer, 'sml_following', true ) ), true ) ) { return 0; }
	return in_array( $creator, sml_csub_ids( get_user_meta( $viewer, 'sml_bell_creators', true ) ), true ) ? 2 : 1;
}

function sml_csub_followers( $creator ) {
	return count( sml_csub_ids( get_user_meta( (int) $creator, 'sml_followers', true ) ) );
}

/**
 * Apply a level. Subscribing writes the same two lists the members plugin uses, so Creator
 * Studio's subscriber count, the feed and everything else see it immediately.
 */
function sml_csub_set( $viewer, $creator, $level ) {
	$viewer = (int) $viewer; $creator = (int) $creator; $level = max( 0, min( 2, (int) $level ) );
	if ( ! $viewer || ! $creator || $viewer === $creator || ! get_userdata( $creator ) ) {
		return new WP_Error( 'sml_csub_target', 'Choose another member to subscribe to.', array( 'status' => 400 ) );
	}
	$was       = sml_csub_level( $viewer, $creator );
	$following = sml_csub_ids( get_user_meta( $viewer, 'sml_following', true ) );
	$followers = sml_csub_ids( get_user_meta( $creator, 'sml_followers', true ) );
	$bell      = sml_csub_ids( get_user_meta( $viewer, 'sml_bell_creators', true ) );
	$subs      = sml_csub_ids( get_user_meta( $creator, 'sml_bell_subscribers', true ) );

	if ( $level >= 1 ) {
		if ( ! in_array( $creator, $following, true ) ) { $following[] = $creator; }
		if ( ! in_array( $viewer, $followers, true ) ) { $followers[] = $viewer; }
	} else {
		$following = array_values( array_diff( $following, array( $creator ) ) );
		$followers = array_values( array_diff( $followers, array( $viewer ) ) );
	}
	if ( 2 === $level ) {
		if ( ! in_array( $creator, $bell, true ) ) { $bell[] = $creator; }
		if ( ! in_array( $viewer, $subs, true ) ) { $subs[] = $viewer; }
	} else {
		$bell = array_values( array_diff( $bell, array( $creator ) ) );
		$subs = array_values( array_diff( $subs, array( $viewer ) ) );
	}
	update_user_meta( $viewer, 'sml_following', $following );
	update_user_meta( $creator, 'sml_followers', $followers );
	update_user_meta( $viewer, 'sml_bell_creators', $bell );
	update_user_meta( $creator, 'sml_bell_subscribers', $subs );

	/* tell the creator once, when someone new subscribes */
	if ( 0 === $was && $level >= 1 && function_exists( 'sml_members_add_notification' ) ) {
		$who = function_exists( 'sml_members_handle' ) ? sml_members_handle( $viewer ) : ( get_userdata( $viewer ) ? get_userdata( $viewer )->display_name : 'Someone' );
		sml_members_add_notification( $creator, 'follow', $who . ' subscribed to your channel.', home_url( '/creator-studio/?tab=subscribers' ), $viewer );
	}
	return array( 'level' => $level, 'followers' => count( $followers ) );
}

/* ------------------------------------------------------------ who owns this page */

/** array( creator_id, name, where ) for a Loop Channel, live stream or video page; null otherwise. */
function sml_csub_page_creator() {
	global $wpdb;
	static $memo = false;
	if ( false !== $memo ) { return $memo; }
	$memo = null;
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	$uid  = 0; $where = '';

	if ( preg_match( '#^channel/([^/]+)#', $path, $m ) ) {
		$uid   = (int) $wpdb->get_var( $wpdb->prepare( "SELECT user_id FROM {$wpdb->usermeta} WHERE meta_key = 'sml_channel_handle' AND meta_value = %s LIMIT 1", rawurldecode( $m[1] ) ) );
		$where = 'channel';
	} elseif ( preg_match( '#^live(?:/([^/]+))?#', $path, $m ) ) {
		$handle = isset( $m[1] ) ? rawurldecode( $m[1] ) : (string) ( $_GET['room'] ?? $_GET['s'] ?? '' );
		$handle = preg_replace( '/[^A-Za-z0-9_-]/', '', $handle );
		if ( '' !== $handle && function_exists( 'sml_scheduled_live_user_for_handle' ) ) {
			$u   = sml_scheduled_live_user_for_handle( $handle );
			$uid = $u instanceof WP_User ? (int) $u->ID : (int) $u;
		}
		if ( ! $uid && '' !== $handle ) {
			$u   = get_user_by( 'slug', $handle );
			$uid = $u ? (int) $u->ID : 0;
		}
		$where = 'live';
	} elseif ( preg_match( '#^watch/([^/]+)#', $path, $m ) ) {
		$lib = function_exists( 'sml_video_upload_studio_library' ) ? (array) sml_video_upload_studio_library() : (array) get_option( 'sml_video_upload_studio_library', array() );
		$v   = $lib[ rawurldecode( $m[1] ) ] ?? null;
		$uid = is_array( $v ) ? (int) ( $v['author_id'] ?? 0 ) : 0;
		$where = 'watch';
	}
	if ( ! $uid || ! get_userdata( $uid ) ) { return $memo; }
	$name = function_exists( 'sml_channel_handle_for_user' ) ? (string) get_user_meta( $uid, 'sml_channel_name', true ) : '';
	if ( '' === $name ) { $name = get_userdata( $uid )->display_name; }
	$memo = array( 'id' => $uid, 'name' => $name, 'where' => $where );
	return $memo;
}

/* ------------------------------------------------------------ REST */

add_action( 'rest_api_init', function () {
	$ns = 'sml-csub/v1';
	register_rest_route( $ns, '/state', array( 'methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function ( WP_REST_Request $r ) {
		$creator = absint( $r->get_param( 'creator' ) );
		if ( ! $creator || ! get_userdata( $creator ) ) { return new WP_Error( 'sml_csub_creator', 'Unknown creator.', array( 'status' => 404 ) ); }
		$res = rest_ensure_response( array( 'creator' => $creator, 'level' => sml_csub_level( get_current_user_id(), $creator ), 'followers' => sml_csub_followers( $creator ), 'logged_in' => is_user_logged_in() ) );
		$res->header( 'Cache-Control', 'no-store, private' );
		return $res;
	} ) );
	register_rest_route( $ns, '/set', array( 'methods' => 'POST', 'permission_callback' => 'is_user_logged_in', 'callback' => function ( WP_REST_Request $r ) {
		$in  = (array) $r->get_json_params() ?: (array) $r->get_body_params();
		$out = sml_csub_set( get_current_user_id(), absint( $in['creator'] ?? 0 ), (int) ( $in['level'] ?? 0 ) );
		return is_wp_error( $out ) ? $out : array_merge( array( 'ok' => true ), $out );
	} ) );
} );

/* ------------------------------------------------- notifications for bell subscribers */

function sml_csub_notify( $creator, $message, $link ) {
	if ( ! function_exists( 'sml_members_add_notification' ) ) { return 0; }
	$sent = 0;
	foreach ( sml_csub_ids( get_user_meta( (int) $creator, 'sml_bell_subscribers', true ) ) as $uid ) {
		if ( $uid === (int) $creator || ! get_userdata( $uid ) ) { continue; }
		sml_members_add_notification( $uid, 'creator_live', $message, $link, (int) $creator );
		$sent++;
	}
	return $sent;
}
function sml_csub_creator_name( $creator ) {
	$n = (string) get_user_meta( (int) $creator, 'sml_channel_name', true );
	if ( '' === $n ) { $u = get_userdata( (int) $creator ); $n = $u ? $u->display_name : 'A creator'; }
	return $n;
}
/* live: the lifecycle plugin fires this when a stream really goes live */
add_action( 'sml_scheduled_live_status_changed', function ( $user_id, $row, $status ) {
	if ( 'live' !== $status || get_user_meta( $user_id, '_sml_csub_live_' . ( $row['id'] ?? '' ), true ) ) { return; }
	update_user_meta( $user_id, '_sml_csub_live_' . ( $row['id'] ?? '' ), 1 );
	$url = function_exists( 'sml_scheduled_live_public_payload' ) ? (string) ( sml_scheduled_live_public_payload( $user_id, true, (string) ( $row['id'] ?? '' ) )['watch_url'] ?? '' ) : '';
	sml_csub_notify( $user_id, '🔴 ' . sml_csub_creator_name( $user_id ) . ' is live: ' . sml_csub_clip( $row['title'] ?? 'Live now' ), $url ?: home_url( '/live/' ) );
}, 10, 3 );
/* video: a new row in the upload library */
add_action( 'update_option_sml_video_upload_studio_library', function ( $old, $new ) {
	if ( ! is_array( $new ) ) { return; }
	foreach ( $new as $slug => $v ) {
		if ( ! is_array( $v ) || isset( $old[ $slug ] ) || empty( $v['author_id'] ) ) { continue; }
		if ( 'public' !== (string) ( $v['visibility'] ?? '' ) ) { continue; }
		sml_csub_notify( (int) $v['author_id'], '▶ ' . sml_csub_creator_name( (int) $v['author_id'] ) . ' posted: ' . sml_csub_clip( $v['title'] ?? 'a new video' ), (string) ( $v['watch_url'] ?? home_url( '/watch/' . rawurlencode( (string) $slug ) . '/' ) ) );
	}
}, 20, 2 );
function sml_csub_clip( $t ) {
	$t = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( (string) $t ) ) );
	return mb_strlen( $t ) > 70 ? mb_substr( $t, 0, 69 ) . '…' : $t;
}

/* ------------------------------------------------------------ the button */

function sml_csub_js() {
	return <<<'JS'
(function(){
  'use strict';
  var C=window.smlCsub;if(!C||!C.creator)return;
  var LABEL=['Subscribe','Get Notifications','SUBSCRIBED'];
  var level=Number(C.level)||0,busy=false,mounts=[],count=Number(C.followers)||0,counts=[];

  /* ---- subscriber count: shown under the creator's name (live + video pages) and in the channel's stat ---- */
  function fmtN(n){n=Number(n)||0;if(n>=1e6)return (n/1e6).toFixed(n>=1e7?0:1).replace(/\.0$/,'')+'M';if(n>=1e4)return Math.round(n/1e3)+'K';if(n>=1e3)return (n/1e3).toFixed(1).replace(/\.0$/,'')+'K';return String(n);}
  function countText(){return count===1?'1 subscriber':fmtN(count)+' subscribers';}
  function paintCount(pulse){
    counts=counts.filter(function(el){return document.documentElement.contains(el);});   /* the page may have re-rendered */
    counts.forEach(function(el){
      var next=el.dataset.kind==='stat'?fmtN(count):countText();
      if(el.textContent===next)return;
      el.textContent=next;
      if(pulse&&!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)){el.classList.remove('sml-csub-bump');void el.offsetWidth;el.classList.add('sml-csub-bump');}
    });
  }
  function addCount(el,kind){if(counts.indexOf(el)<0){el.dataset.kind=kind;counts.push(el);}paintCount(false);}

  function btn(where){
    var b=document.createElement('button');
    b.type='button';b.className='sml-csub';b.setAttribute('data-sml-csub',where);
    b.innerHTML='<span class="sml-csub-ico" aria-hidden="true"></span><span class="sml-csub-t"></span>';
    b.addEventListener('click',onClick);
    ['mouseenter','focus'].forEach(function(ev){b.addEventListener(ev,function(){b.classList.add('is-hover');});});
    ['mouseleave','blur'].forEach(function(ev){b.addEventListener(ev,function(){b.classList.remove('is-hover');});});
    mounts.push(b);paintOne(b);
    return b;
  }
  function paintOne(b){
    b.dataset.level=String(level);
    b.classList.toggle('is-on',level===2);
    b.classList.toggle('is-sub',level===1);
    b.setAttribute('aria-pressed',level>0?'true':'false');
    b.querySelector('.sml-csub-ico').textContent=level===2?'🔔':(level===1?'🔕':'');
    b.querySelector('.sml-csub-t').textContent=LABEL[level];
    b.title=level===0?('Subscribe to '+C.name):(level===1?'Turn on notifications for '+C.name:'Subscribed to '+C.name+' — click to unsubscribe');
    b.setAttribute('aria-label',level===2?('Subscribed to '+C.name+'. Activate to unsubscribe.'):b.title);
  }
  function paint(){mounts.forEach(paintOne);}
  function onClick(e){
    e.preventDefault();e.stopPropagation();
    if(!C.loggedIn){location.href=C.loginUrl;return;}
    if(busy)return;
    var next=level===0?1:(level===1?2:0),was=level,wasCount=count;
    level=next;busy=true;
    if(was===0&&next>=1)count+=1;else if(next===0&&was>=1)count=Math.max(0,count-1);
    paint();paintCount(true);                           /* optimistic: the click always feels instant */
    fetch(C.rest+'set',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-WP-Nonce':C.nonce},body:JSON.stringify({creator:C.creator,level:next})})
      .then(function(r){return r.json().then(function(j){if(!r.ok||j.code)throw new Error(j.message||'Could not save that.');return j;});})
      .then(function(j){level=Number(j.level)||0;busy=false;if(typeof j.followers==='number')count=j.followers;paint();paintCount(false);})
      .catch(function(){level=was;count=wasCount;busy=false;paint();paintCount(false);flash('Could not save that — try again.');});
  }
  function flash(msg){
    var t=document.createElement('div');t.className='sml-csub-toast';t.textContent=msg;document.body.appendChild(t);
    setTimeout(function(){t.remove();},2600);
  }

  var css='.sml-csub{display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 16px;border-radius:999px;border:1px solid transparent;background:#38f58a;color:#06120c;font:800 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.2px;cursor:pointer;white-space:nowrap;transition:background .18s,color .18s,border-color .18s,box-shadow .18s;-webkit-tap-highlight-color:transparent}'
    +'.sml-csub:hover{background:#5cffa6}'
    +'.sml-csub:focus-visible{outline:2px solid #fff;outline-offset:2px}'
    +'.sml-csub .sml-csub-ico:empty{display:none}'
    +'.sml-csub.is-sub{background:transparent;border-color:#38f58a;color:#38f58a}.sml-csub.is-sub:hover{background:rgba(56,245,138,.14)}'
    +'.sml-csub.is-on{background:linear-gradient(100deg,#8a6b12,#ffd76a 28%,#fff3c4 46%,#ffd05a 62%,#8a6b12);background-size:220% 100%;color:#241a02;border-color:#ffdd80;box-shadow:0 0 0 1px rgba(255,221,128,.35),0 6px 18px rgba(255,196,60,.22);animation:smlCsubShine 5.5s linear infinite}'
    +'@keyframes smlCsubShine{0%{background-position:120% 0}100%{background-position:-120% 0}}'
    +'.sml-csub.is-on.is-hover{animation:smlCsubFlash 1s steps(1,end) infinite;background:#2a0d12;border-color:#ff4d6a;color:#ff4d6a;box-shadow:none}'
    +'@keyframes smlCsubFlash{0%,49%{color:#ff4d6a;border-color:#ff4d6a}50%,100%{color:#ff9aa9;border-color:#7a2230}}'
    +'.sml-csub.is-on.is-hover .sml-csub-t{font-size:0}'
    +'.sml-csub.is-on.is-hover .sml-csub-t::after{content:"Unsubscribe";font-size:13px}'
    +'.sml-csub.is-on.is-hover .sml-csub-ico{display:none}'
    +'.sml-csub-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483646;padding:10px 16px;border-radius:10px;background:#1b0f14;border:1px solid #ff4d6a;color:#ffc2cc;font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif}'
    +'.sml-csub-count{display:block;margin-top:2px;font-size:12px;font-weight:600;color:#8fa3b5;font-variant-numeric:tabular-nums}'
    +'.sml-csub-bump{animation:smlCsubBump .55s ease-out}'
    +'@keyframes smlCsubBump{0%{transform:scale(1);color:#ffd76a}40%{transform:scale(1.14);color:#ffd76a}100%{transform:scale(1)}}'
    +'@media (prefers-reduced-motion:reduce){.sml-csub.is-on,.sml-csub.is-on.is-hover{animation:none}.sml-csub.is-on.is-hover{background:#2a0d12}.sml-csub-bump{animation:none}}'
    +'@media(max-width:640px){.sml-csub{height:34px;padding:0 13px;font-size:12px}}';
  var st=document.createElement('style');st.textContent=css;(document.head||document.documentElement).appendChild(st);

  /* "N subscribers" under the creator's name — its own line, beside the page's own meta text so the
     page can rewrite that text without wiping this */
  function countLine(){
    var id=document.querySelector('.slw-about-h .slw-about-id');
    if(id&&!id.querySelector('.sml-csub-count')){var s=document.createElement('span');s.className='fo sml-csub-count';s.setAttribute('aria-live','polite');id.appendChild(s);addCount(s,'text');}
  }

  /* where the button goes on each page */
  function place(){
    if(C.where==='live'){
      var row=document.querySelector('.slw-ctl-r');                          /* owner 2026-09-19: no Subscribe in the player bar, only in the description */
      if(row){var term=row.querySelector('.slw-btn-term');if(term)term.remove();var bar=row.querySelector('[data-sml-csub]');if(bar)bar.remove();}
      var old=document.querySelector('#slw-sub');                            /* the placeholder next to the creator name */
      if(old&&!old.dataset.smlCsubDone){old.dataset.smlCsubDone='1';old.style.display='none';
        if(old.parentNode&&!old.parentNode.querySelector('[data-sml-csub="live-who"]'))old.parentNode.insertBefore(btn('live-who'),old);}
      countLine();
    } else if(C.where==='watch'){
      var prof=document.querySelector('#vw-profile');                        /* creator block under the video, not the player bar */
      if(prof&&prof.parentNode&&!prof.parentNode.querySelector('[data-sml-csub]'))prof.parentNode.insertBefore(btn('watch'),prof);
      countLine();
    } else if(C.where==='channel'){
      var stat=document.querySelector('#ch-subscribers,#ch-followers');
      if(stat)addCount(stat,'stat');
      var sub=document.querySelector('#ch-sub');
      if(sub&&!sub.dataset.smlCsubDone){sub.dataset.smlCsubDone='1';sub.style.display='none';
        var bell=document.querySelector('#ch-bell');if(bell)bell.style.display='none';   /* this button owns notifications now */
        sub.parentNode.insertBefore(btn('channel'),sub);}
    }
  }
  place();
  if('MutationObserver' in window){var t=0;new MutationObserver(function(){if(t)return;t=setTimeout(function(){t=0;place();},150);}).observe(document.documentElement,{childList:true,subtree:true});}
  /* the page HTML can be cached for signed-out visitors, so read the current count and state once on load,
     and again when the tab comes back (another tab may have changed it) */
  function refresh(){
    if(busy)return;
    fetch(C.rest+'state?creator='+C.creator,{credentials:'same-origin',cache:'no-store',headers:{'X-WP-Nonce':C.nonce}})
      .then(function(r){return r.json();}).then(function(j){
        if(busy)return;
        if(typeof j.followers==='number'&&j.followers!==count){count=j.followers;paintCount(false);}
        if(C.loggedIn&&typeof j.level==='number'&&j.level!==level){level=j.level;paint();}
      }).catch(function(){});
  }
  refresh();
  document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh();});
})();
JS;
}

/* These three pages are custom renders (the live page and the channel page build themselves in
   the browser), so the button ships from an init output buffer and mounts itself when the page's
   own controls appear. */
add_action( 'init', function () {
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'WP_CLI' ) && WP_CLI ) || 'GET' !== ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) ) { return; }
	$c = sml_csub_page_creator();
	if ( ! $c ) { return; }
	$viewer = get_current_user_id();
	if ( $viewer === $c['id'] ) { return; }   /* a creator does not subscribe to themselves */
	$cfg = array(
		'creator'  => $c['id'],
		'name'     => $c['name'],
		'where'    => $c['where'],
		'level'    => sml_csub_level( $viewer, $c['id'] ),
		'followers' => sml_csub_followers( $c['id'] ),
		'loggedIn' => (bool) $viewer,
		'rest'     => esc_url_raw( rest_url( 'sml-csub/v1/' ) ),
		'nonce'    => wp_create_nonce( 'wp_rest' ),
		/* clean URLs rewrite REQUEST_URI to the internal /live/?room=… form; send people back to the pretty one */
		'loginUrl' => wp_login_url( ( is_ssl() ? 'https://' : 'http://' ) . ( $_SERVER['HTTP_HOST'] ?? '' ) . ( $_SERVER['SML_CU_ORIG_REQUEST_URI'] ?? $_SERVER['REQUEST_URI'] ?? '/' ) ),
	);
	ob_start( function ( $html ) use ( $cfg ) {
		if ( ! is_string( $html ) || false !== strpos( $html, 'window.smlCsub' ) ) { return $html; }
		$pos = strripos( $html, '</body>' );
		if ( false === $pos ) { return $html; }
		return substr_replace( $html, '<script>window.smlCsub=' . wp_json_encode( $cfg ) . ';</script><script>' . sml_csub_js() . '</script>', $pos, 0 );
	} );
}, 1 );
