<?php
/**
 * Plugin Name: SML PWA
 * Description: Makes stockmarketloop.com installable as an app on Android, iPhone/iPad and desktop: web app manifest, service worker (offline fallback, cached assets), home-screen icons, an install prompt and the iPhone "Add to Home Screen" hint. The app is the whole site.
 * Version: 1.2.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_PWA_VERSION', '1.2.0' );
define( 'SML_PWA_SW_PATH', '/sml-sw.js' );
define( 'SML_PWA_MANIFEST_PATH', '/sml-manifest.webmanifest' ); // its own path: the site already answers /manifest.webmanifest elsewhere (SML App Links)
define( 'SML_PWA_OFFLINE_PATH', '/sml-pwa-offline' );
define( 'SML_PWA_THEME_COLOR', '#06110d' );

function sml_pwa_url( $file ) { return plugins_url( $file, __FILE__ ); }
function sml_pwa_request_path() { return (string) wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '', PHP_URL_PATH ); }

/* The three files the app needs live at the site root (a service worker only controls the path it is served from). A request for one is
   answered here on init, so it works whether or not rewrite rules were flushed and in front of any page cache. */
add_action( 'init', 'sml_pwa_serve', 0 );
function sml_pwa_serve() {
	$path = untrailingslashit( sml_pwa_request_path() );
	if ( $path === SML_PWA_SW_PATH ) {
		nocache_headers();
		header( 'Content-Type: text/javascript; charset=utf-8' );
		header( 'Service-Worker-Allowed: /' );
		header( 'X-Content-Type-Options: nosniff' );
		echo sml_pwa_service_worker(); // phpcs:ignore WordPress.Security.EscapeOutput
		exit;
	}
	if ( $path === SML_PWA_MANIFEST_PATH ) {
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		header( 'Cache-Control: public, max-age=3600' );
		echo wp_json_encode( sml_pwa_manifest(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ); // phpcs:ignore WordPress.Security.EscapeOutput
		exit;
	}
	if ( $path === SML_PWA_OFFLINE_PATH ) {
		nocache_headers();
		header( 'Content-Type: text/html; charset=utf-8' );
		echo sml_pwa_offline_page(); // phpcs:ignore WordPress.Security.EscapeOutput
		exit;
	}
}

function sml_pwa_manifest() {
	$name = get_bloginfo( 'name' ) ?: 'StockMarketLoop';
	$manifest = array(
		'id'               => '/',
		'name'             => $name,
		'short_name'       => 'StockMarketLoop',
		'description'      => get_bloginfo( 'description' ),
		'start_url'        => '/?utm_source=pwa',
		'scope'            => '/',
		'display'          => 'standalone',
		'display_override' => array( 'standalone', 'minimal-ui' ),
		'orientation'      => 'any',
		'background_color' => SML_PWA_THEME_COLOR,
		'theme_color'      => SML_PWA_THEME_COLOR,
		'lang'             => 'en-US',
		'categories'       => array( 'finance', 'news', 'social' ),
		'icons'            => array(
			array( 'src' => sml_pwa_url( 'icons/icon-192.png' ), 'sizes' => '192x192', 'type' => 'image/png' ),
			array( 'src' => sml_pwa_url( 'icons/icon-512.png' ), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any' ),
			array( 'src' => sml_pwa_url( 'icons/icon-maskable-512.png' ), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable' ),
		),
		'shortcuts'        => array(
			array( 'name' => 'Groups', 'url' => '/groups/?utm_source=pwa', 'icons' => array( array( 'src' => sml_pwa_url( 'icons/icon-192.png' ), 'sizes' => '192x192' ) ) ),
			array( 'name' => 'News', 'url' => '/news/?utm_source=pwa', 'icons' => array( array( 'src' => sml_pwa_url( 'icons/icon-192.png' ), 'sizes' => '192x192' ) ) ),
			array( 'name' => 'Academy', 'url' => '/academy-chart-lab/?utm_source=pwa', 'icons' => array( array( 'src' => sml_pwa_url( 'icons/icon-192.png' ), 'sizes' => '192x192' ) ) ),
			array( 'name' => 'Store', 'url' => '/store/?utm_source=pwa', 'icons' => array( array( 'src' => sml_pwa_url( 'icons/icon-192.png' ), 'sizes' => '192x192' ) ) ),
		),
	);
	return apply_filters( 'sml_pwa_manifest', $manifest );
}

/* Head: the manifest, theme colour, iPhone home-screen tags and icons. Only on the front end. Printed before anything else in <head>:
   a browser uses the FIRST manifest link it meets, and SML App Links prints a thinner one of its own. */
function sml_pwa_head_html() {
	return "\n" . '<link rel="manifest" href="' . esc_url( SML_PWA_MANIFEST_PATH ) . '">' . "\n"
		. '<meta name="theme-color" content="' . esc_attr( SML_PWA_THEME_COLOR ) . '">' . "\n"
		. '<meta name="mobile-web-app-capable" content="yes">' . "\n"
		. '<meta name="apple-mobile-web-app-capable" content="yes">' . "\n"
		. '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' . "\n"
		. '<meta name="apple-mobile-web-app-title" content="StockMarketLoop">' . "\n"
		. '<link rel="apple-touch-icon" href="' . esc_url( sml_pwa_url( 'icons/apple-touch-icon.png' ) ) . '">' . "\n";
}
add_action( 'wp_head', 'sml_pwa_head', -100 );
function sml_pwa_head() {
	if ( is_admin() ) { return; }
	echo sml_pwa_head_html(); // phpcs:ignore WordPress.Security.EscapeOutput
}

/* Some pages (Groups, the Academy chart lab, other plugin-rendered screens) print their own HTML and never call wp_head or wp_footer.
   Every front-end HTML response is therefore buffered and the tags are added before </head> and </body> when they are missing, so
   the app behaves the same on every page. Binary or non-HTML output passes through untouched. */
add_action( 'init', 'sml_pwa_buffer', -1000 );
function sml_pwa_buffer() {
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) || ( defined( 'WP_CLI' ) && WP_CLI ) ) { return; }
	if ( ! isset( $_SERVER['REQUEST_METHOD'] ) || 'GET' !== $_SERVER['REQUEST_METHOD'] ) { return; }
	$path = sml_pwa_request_path();
	if ( strpos( $path, '/wp-json' ) === 0 || strpos( $path, '/wp-admin' ) === 0 || strpos( $path, '/wp-login' ) === 0 || preg_match( '#\.(?:js|css|png|jpe?g|gif|webp|svg|ico|json|xml|txt|webmanifest|woff2?|ttf|mp4|mp3|pdf|zip)$#i', $path ) ) { return; }
	ob_start( 'sml_pwa_inject' );
}
function sml_pwa_inject( $html ) {
	if ( ! is_string( $html ) || $html === '' || stripos( $html, '<html' ) === false ) { return $html; }
	if ( stripos( $html, 'sml-manifest.webmanifest' ) === false ) {
		$head = stripos( $html, '</head>' );
		if ( $head !== false ) { $html = substr( $html, 0, $head ) . sml_pwa_head_html() . substr( $html, $head ); }
	}
	if ( stripos( $html, 'id="sml-pwa-js"' ) === false ) {
		$body = strripos( $html, '</body>' );
		if ( $body !== false ) { $html = substr( $html, 0, $body ) . sml_pwa_footer_html() . substr( $html, $body ); }
	}
	return $html;
}

/* Footer: register the service worker; offer the install prompt once it is available; tell iPhone users how to add it. */
add_action( 'wp_footer', 'sml_pwa_footer', 99 );
function sml_pwa_footer() {
	if ( is_admin() ) { return; }
	echo sml_pwa_footer_html(); // phpcs:ignore WordPress.Security.EscapeOutput
}
function sml_pwa_footer_html() {
	$sw   = SML_PWA_SW_PATH . '?v=' . rawurlencode( SML_PWA_VERSION );
	$icon = sml_pwa_url( 'icons/icon-192.png' );
	ob_start();
	?>
<style id="sml-pwa-css">#sml-pwa-bar{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483000;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:#06110d;border:1px solid #1f4a39;box-shadow:0 14px 40px rgba(0,0,0,.55);color:#e6f2ec;font:600 14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}#sml-pwa-bar img{width:44px;height:44px;border-radius:11px;flex:none}#sml-pwa-bar .t{flex:1;min-width:0}#sml-pwa-bar .t b{display:block;color:#fff}#sml-pwa-bar .t small{display:block;color:#8fb0a2;font-weight:500;font-size:12px}#sml-pwa-bar button{appearance:none;border:0;border-radius:10px;padding:9px 13px;font:800 13px system-ui,sans-serif;cursor:pointer}#sml-pwa-bar .go{background:#19e36b;color:#042217}#sml-pwa-bar .x{background:none;color:#8fb0a2;font-size:18px;padding:4px 6px}@media(min-width:720px){#sml-pwa-bar{left:auto;right:20px;max-width:420px}}</style>
<script id="sml-pwa-js">(function(){
if(!('serviceWorker' in navigator))return;
navigator.serviceWorker.register(<?php echo wp_json_encode( $sw ); ?>,{scope:'/'}).catch(function(){});
var KEY='sml-pwa-dismissed',standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
if(standalone){document.documentElement.classList.add('sml-pwa-standalone');return;}
var ios=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function dismissed(){try{var t=Number(localStorage.getItem(KEY)||0);return Date.now()-t<7*86400000}catch(e){return false}}
function dismiss(){try{localStorage.setItem(KEY,String(Date.now()))}catch(e){}var b=document.getElementById('sml-pwa-bar');if(b)b.remove()}
function bar(title,sub,action){if(dismissed()||document.getElementById('sml-pwa-bar'))return;var d=document.createElement('div');d.id='sml-pwa-bar';d.innerHTML='<img alt="" src="<?php echo esc_js( $icon ); ?>"><div class="t"><b>'+title+'</b><small>'+sub+'</small></div>'+(action?'<button type="button" class="go">Install</button>':'')+'<button type="button" class="x" aria-label="Not now">✕</button>';d.querySelector('.x').onclick=dismiss;if(action)d.querySelector('.go').onclick=action;document.body.appendChild(d)}
var prompt=null,android=/Android/i.test(navigator.userAgent),mobile=ios||android||/Mobi/i.test(navigator.userAgent);
function howTo(){var b=document.getElementById('sml-pwa-bar');if(!b)return;b.querySelector('.t').innerHTML='<b>'+(ios?'Tap Share, then "Add to Home Screen"':'Open the browser menu (\u22ee), then "Add to Home screen" or "Install app"')+'</b><small>StockMarketLoop then opens full screen from its own icon.</small>';var g=b.querySelector('.go');if(g)g.remove()}
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();prompt=e;var g=document.querySelector('#sml-pwa-bar .go');if(g)g.onclick=function(){prompt.prompt();prompt.userChoice.then(function(){dismiss()})};else bar('Install the StockMarketLoop app','Opens full screen from your home screen or desktop, with its own icon.',function(){prompt.prompt();prompt.userChoice.then(function(){dismiss()})})});
window.addEventListener('appinstalled',dismiss);
/* phones: show the bar on every visit until installed or dismissed; the Install button uses the browser's prompt when it exists, else shows the steps */
if(mobile)setTimeout(function(){bar(ios?'Add StockMarketLoop to your Home Screen':'Install the StockMarketLoop app',ios?'Tap the Share button, then "Add to Home Screen". It opens like an app.':'Opens full screen from your home screen, with its own icon.',ios?null:function(){if(prompt){prompt.prompt();prompt.userChoice.then(function(){dismiss()})}else howTo()})},1500);
})();</script>
	<?php
	return (string) ob_get_clean();
}

function sml_pwa_offline_page() {
	$icon = esc_url( sml_pwa_url( 'icons/icon-192.png' ) );
	return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · StockMarketLoop</title><meta name="theme-color" content="' . SML_PWA_THEME_COLOR . '"><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#06110d;color:#e6f2ec;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:24px}img{width:72px;height:72px;border-radius:18px;margin:0 auto 14px;display:block}h1{font-size:1.2rem;margin:0 0 6px}p{color:#8fb0a2;margin:0 0 18px}button{border:0;border-radius:10px;background:#19e36b;color:#042217;font:800 15px system-ui;padding:11px 18px;cursor:pointer}</style></head><body><div><img alt="" src="' . $icon . '"><h1>You are offline</h1><p>StockMarketLoop needs a connection for live market data and the feed. Pages you opened recently may still load.</p><button onclick="location.reload()">Try again</button></div></body></html>';
}

/* The service worker: offline fallback for pages, cached theme/plugin assets (stale-while-revalidate), nothing else touched. Signed-in, admin,
   REST, AJAX and any non-GET request always go straight to the network, so the site behaves exactly as before. */
function sml_pwa_service_worker() {
	$version  = 'sml-pwa-' . SML_PWA_VERSION;
	$offline  = SML_PWA_OFFLINE_PATH;
	$precache = wp_json_encode( array( $offline, sml_pwa_url( 'icons/icon-192.png' ), sml_pwa_url( 'icons/icon-512.png' ) ), JSON_UNESCAPED_SLASHES );
	return <<<JS
/* StockMarketLoop service worker ($version) */
const VERSION = '$version';
const OFFLINE = '$offline';
const PRECACHE = $precache;
const ASSET = /\\.(?:css|js|woff2?|ttf|png|jpe?g|gif|webp|svg|ico)(?:\\?.*)?$/i;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE).catch(() => null)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const p = url.pathname;
  if (p.startsWith('/wp-admin') || p.startsWith('/wp-json') || p.startsWith('/wp-login') || p.includes('admin-ajax') || p === '/sml-sw.js' || url.searchParams.has('preview')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || new Response('<h1>Offline</h1>', { status: 503, headers: { 'content-type': 'text/html' } }))));
    return;
  }
  if ((p.startsWith('/wp-content/') || p.startsWith('/wp-includes/')) && ASSET.test(p)) {
    e.respondWith(caches.match(req).then((hit) => { const net = fetch(req).then((r) => { if (r && r.ok) caches.open(VERSION).then((c) => c.put(req, r.clone())); return r; }).catch(() => hit); return hit || net; }));
  }
});
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'StockMarketLoop', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'StockMarketLoop', { body: d.body || '', icon: PRECACHE[1], badge: PRECACHE[1], tag: d.tag || d.collapseId || undefined, data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => { const c = list.find((x) => 'focus' in x); if (c) { c.navigate(url); return c.focus(); } return self.clients.openWindow(url); }));
});
JS;
}
