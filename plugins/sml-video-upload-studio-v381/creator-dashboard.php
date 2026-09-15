<?php
/**
 * Creator Studio dashboard.
 *
 * Provides the same in-place dashboard module on /go-live/ and the canonical
 * /creator-studio/ entry point. All creator numbers come from the existing
 * video library/analytics engine; trend cards identify their source.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_vus_dashboard_trends')) {
    function sml_vus_dashboard_trends() {
        $cached = get_transient('sml_vus_dashboard_google_trends_us');
        if (is_array($cached)) {
            return $cached;
        }

        $items = array();
        $response = wp_safe_remote_get(
            'https://trends.google.com/trending/rss?geo=US',
            array(
                'timeout' => 6,
                'redirection' => 2,
                'headers' => array('Accept' => 'application/rss+xml, application/xml'),
            )
        );

        if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200) {
            $previous = libxml_use_internal_errors(true);
            $xml = simplexml_load_string((string) wp_remote_retrieve_body($response));
            libxml_clear_errors();
            libxml_use_internal_errors($previous);

            if ($xml && isset($xml->channel->item)) {
                foreach ($xml->channel->item as $entry) {
                    $title = sanitize_text_field((string) $entry->title);
                    if ($title === '') {
                        continue;
                    }
                    $namespaces = $entry->getNameSpaces(true);
                    $traffic = '';
                    if (isset($namespaces['ht'])) {
                        $trend = $entry->children($namespaces['ht']);
                        $traffic = sanitize_text_field((string) ($trend->approx_traffic ?? ''));
                    }
                    $items[] = array(
                        'title' => $title,
                        'traffic' => $traffic,
                        'source' => 'Google Trends',
                        'google_url' => 'https://trends.google.com/trends/explore?geo=US&q=' . rawurlencode($title),
                        'youtube_url' => 'https://www.youtube.com/results?search_query=' . rawurlencode($title),
                        'angle' => sprintf('Explain why “%s” is moving now and connect it to markets, sectors, or tickers only when the evidence supports it.', $title),
                    );
                    if (count($items) >= 8) {
                        break;
                    }
                }
            }
        }

        set_transient('sml_vus_dashboard_google_trends_us', $items, 15 * MINUTE_IN_SECONDS);
        return $items;
    }
}

if (!function_exists('sml_vus_dashboard_payload')) {
    function sml_vus_dashboard_payload($user_id) {
        $user_id = (int) $user_id;
        $totals = function_exists('sml_vus_creator_totals') ? sml_vus_creator_totals($user_id) : array();
        $videos = function_exists('sml_vus_creator_videos') ? sml_vus_creator_videos($user_id) : array();
        $recent = array();

        foreach (array_slice($videos, 0, 6) as $video) {
            $recent[] = array(
                'id' => sanitize_text_field((string) ($video['id'] ?? '')),
                'title' => sanitize_text_field((string) ($video['title'] ?? 'Untitled video')),
                'thumbnail' => esc_url_raw((string) ($video['thumbnail_url'] ?? '')),
                'watch_url' => esc_url_raw((string) ($video['watch_url'] ?? '')),
                'visibility' => sanitize_text_field((string) ($video['visibility'] ?? 'public')),
                'created_at' => sanitize_text_field((string) ($video['created_at'] ?? '')),
                'views' => (int) ($video['views'] ?? 0),
                'impressions' => (int) ($video['impressions'] ?? 0),
                'likes' => count((array) ($video['likes'] ?? array())),
                'comments' => count((array) ($video['comments'] ?? array())),
                'ticker' => sanitize_text_field((string) ($video['ticker'] ?? '')),
            );
        }

        return array(
            'summary' => array(
                'uploads' => (int) ($totals['videos'] ?? 0),
                'views' => (int) ($totals['views'] ?? 0),
                'impressions' => (int) ($totals['impressions'] ?? 0),
                'engagement' => (int) ($totals['engagement'] ?? 0),
                'ctr' => (float) ($totals['ctr'] ?? 0),
                'comments' => (int) ($totals['comments'] ?? 0),
            ),
            'recent_uploads' => $recent,
            'recommendations' => sml_vus_dashboard_trends(),
            'trend_status' => array(
                'google' => 'Live U.S. Trending Now RSS; cached for 15 minutes.',
                'youtube' => 'YouTube search links validate demand without claiming private YouTube trend data.',
            ),
            'generated_at' => gmdate('c'),
        );
    }
}

if (!function_exists('sml_vus_dashboard_rest')) {
    function sml_vus_dashboard_rest() {
        return rest_ensure_response(sml_vus_dashboard_payload(get_current_user_id()));
    }
}

if (!function_exists('sml_vus_dashboard_register_route')) {
    function sml_vus_dashboard_register_route() {
        register_rest_route('sml-video-upload-studio/v1', '/creator-dashboard', array(
            'methods' => 'GET',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_vus_dashboard_rest',
        ));
    }
}
add_action('rest_api_init', 'sml_vus_dashboard_register_route');

if (!function_exists('sml_vus_dashboard_config')) {
    function sml_vus_dashboard_config() {
        return array(
            'endpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/creator-dashboard')),
            'nonce' => wp_create_nonce('wp_rest'),
            'uploadUrl' => esc_url_raw(home_url('/upload-video/')),
            'goLiveUrl' => esc_url_raw(home_url('/go-live/')),
            'analyticsUrl' => esc_url_raw(home_url('/creator-studio/analytics/')),
        );
    }
}

if (!function_exists('sml_vus_dashboard_styles')) {
    function sml_vus_dashboard_styles() {
        return <<<'CSS'
.cs-dashboard{padding:26px;min-width:0}
.cs-dash-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:22px}
.cs-dash-head h1{margin:0;font-size:28px;letter-spacing:-.6px}.cs-dash-head p{margin:7px 0 0;color:#8798ac;font-size:14px}
.cs-dash-actions{display:flex;gap:10px;flex-wrap:wrap}.cs-dash-actions a{height:40px;padding:0 15px;border:1px solid #223146;border-radius:9px;display:inline-flex;align-items:center;font-size:13px;font-weight:700}.cs-dash-actions a:first-child{background:#2b6cff;border-color:#2b6cff;color:#fff}
.cs-dash-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:18px}
.cs-dash-metric{background:#0b131f;border:1px solid #182130;border-radius:13px;padding:17px}.cs-dash-metric span{display:block;color:#8798ac;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px}.cs-dash-metric b{display:block;margin-top:8px;font-size:24px;letter-spacing:-.5px}.cs-dash-metric small{display:block;margin-top:5px;color:#5f748c;font-size:11px}
.cs-dash-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);gap:18px;align-items:start}.cs-dash-panel{background:#0b131f;border:1px solid #182130;border-radius:14px;padding:20px;min-width:0}.cs-dash-panel-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:15px}.cs-dash-panel-head h2{margin:0;font-size:18px}.cs-dash-panel-head a,.cs-dash-panel-head span{color:#63a4ff;font-size:12px;font-weight:700}
.cs-dash-video-list{display:flex;flex-direction:column}.cs-dash-video{display:grid;grid-template-columns:112px minmax(0,1fr) auto;gap:13px;padding:12px 0;border-top:1px solid #16202e;align-items:center}.cs-dash-video:first-child{border-top:0;padding-top:0}.cs-dash-thumb{aspect-ratio:16/9;border-radius:8px;background:#101b2a center/cover no-repeat;border:1px solid #203047;display:grid;place-items:center;color:#60758d;font-size:11px}.cs-dash-video b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cs-dash-video small{display:block;color:#71859b;font-size:11.5px;margin-top:5px}.cs-dash-video-stats{text-align:right;font-size:11.5px;color:#8ca0b5;white-space:nowrap}
.cs-trend-list{display:flex;flex-direction:column;gap:10px}.cs-trend{border:1px solid #1b2a3c;background:#0d1724;border-radius:11px;padding:13px}.cs-trend-top{display:flex;align-items:center;gap:8px}.cs-trend-source{font-size:10px;font-weight:800;letter-spacing:.55px;text-transform:uppercase;color:#63a4ff}.cs-trend-traffic{margin-left:auto;font-size:10px;color:#22d97a}.cs-trend b{display:block;font-size:14px;margin-top:7px}.cs-trend p{margin:6px 0 10px;font-size:11.5px;line-height:1.45;color:#8295aa}.cs-trend-links{display:flex;gap:10px}.cs-trend-links a{font-size:11px;font-weight:700;color:#63a4ff}.cs-trend-note{margin:12px 0 0;color:#657a91;font-size:10.5px;line-height:1.5}
.cs-dash-empty{padding:28px 12px;text-align:center;color:#708399;font-size:13px;border:1px dashed #26384c;border-radius:10px}.cs-dash-error{color:#ff8f9c}
@media(max-width:1250px){.cs-dash-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.cs-dash-grid{grid-template-columns:1fr}}
@media(max-width:720px){.cs-dashboard{padding:18px}.cs-dash-head{display:block}.cs-dash-actions{margin-top:15px}.cs-dash-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.cs-dash-video{grid-template-columns:84px minmax(0,1fr)}.cs-dash-video-stats{display:none}}
CSS;
    }
}

if (!function_exists('sml_vus_dashboard_markup')) {
    function sml_vus_dashboard_markup($hidden = true) {
        echo '<section class="cs-dashboard" id="cs-dashboard"' . ($hidden ? ' hidden' : '') . ' aria-label="Creator dashboard">';
        echo '<div class="cs-dash-head"><div><h1>Creator Dashboard</h1><p>Your newest content, current performance, and live topic opportunities in one workspace.</p></div>';
        echo '<div class="cs-dash-actions"><a href="' . esc_url(home_url('/upload-video/')) . '">Upload video</a><a href="' . esc_url(home_url('/go-live/')) . '" data-cs-live-view>Go Live</a><a href="' . esc_url(home_url('/creator-studio/analytics/')) . '">Full analytics</a></div></div>';
        echo '<div class="cs-dash-metrics" data-cs-dash-metrics><div class="cs-dash-empty">Loading creator totals…</div></div>';
        echo '<div class="cs-dash-grid"><article class="cs-dash-panel"><div class="cs-dash-panel-head"><h2>Latest uploads</h2><a href="' . esc_url(home_url('/creator-studio/videos/')) . '">Manage videos</a></div><div class="cs-dash-video-list" data-cs-recent></div></article>';
        echo '<aside class="cs-dash-panel"><div class="cs-dash-panel-head"><h2>Topic recommendations</h2><span>Live signals</span></div><div class="cs-trend-list" data-cs-trends></div><p class="cs-trend-note" data-cs-trend-note></p></aside></div>';
        echo '</section>';
    }
}

if (!function_exists('sml_vus_dashboard_script')) {
    function sml_vus_dashboard_script() {
        return <<<'JS'
(function(){
  'use strict';
  var root=document.getElementById('cs-dashboard');
  var cfg=window.smlCreatorDashboardConfig||{};
  if(!root||root.dataset.bound==='1'){return;}root.dataset.bound='1';
  function esc(v){var d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML;}
  function num(v){return new Intl.NumberFormat().format(Number(v)||0);}
  function age(v){if(!v)return 'Recently published';var t=Date.parse(v);if(!isFinite(t))return 'Recently published';var h=Math.max(0,Math.floor((Date.now()-t)/36e5));if(h<1)return 'Less than an hour ago';if(h<24)return h+'h ago';return Math.floor(h/24)+'d ago';}
  function paint(data){
    var s=data.summary||{};
    var metrics=[['Uploads',s.uploads,'Published videos'],['Views',s.views,'All-time video views'],['Impressions',s.impressions,'Recommendation exposure'],['Engagement',s.engagement,'Likes, comments and saves'],['CTR',(Number(s.ctr)||0).toFixed(2)+'%','Clicks ÷ impressions']];
    root.querySelector('[data-cs-dash-metrics]').innerHTML=metrics.map(function(x){return '<article class="cs-dash-metric"><span>'+esc(x[0])+'</span><b>'+esc(typeof x[1]==='number'?num(x[1]):x[1])+'</b><small>'+esc(x[2])+'</small></article>';}).join('');
    var videos=Array.isArray(data.recent_uploads)?data.recent_uploads:[];
    root.querySelector('[data-cs-recent]').innerHTML=videos.length?videos.map(function(v){var art=v.thumbnail?' style="background-image:url(&quot;'+esc(v.thumbnail)+'&quot;)"':'';return '<a class="cs-dash-video" href="'+esc(v.watch_url||'#')+'"><span class="cs-dash-thumb"'+art+'>'+(v.thumbnail?'':'No thumbnail')+'</span><span><b>'+esc(v.title)+'</b><small>'+esc((v.ticker?'$'+v.ticker+' · ':'')+age(v.created_at)+' · '+(v.visibility||'public'))+'</small></span><span class="cs-dash-video-stats">'+num(v.views)+' views<br>'+num(v.comments)+' comments</span></a>';}).join(''):'<div class="cs-dash-empty">No uploads yet. Publish your first video to populate this dashboard.</div>';
    var trends=Array.isArray(data.recommendations)?data.recommendations:[];
    root.querySelector('[data-cs-trends]').innerHTML=trends.length?trends.map(function(t){return '<article class="cs-trend"><div class="cs-trend-top"><span class="cs-trend-source">'+esc(t.source||'Google Trends')+'</span><span class="cs-trend-traffic">'+esc(t.traffic||'Trending now')+'</span></div><b>'+esc(t.title)+'</b><p>'+esc(t.angle)+'</p><div class="cs-trend-links"><a target="_blank" rel="noopener" href="'+esc(t.google_url)+'">Validate in Google</a><a target="_blank" rel="noopener" href="'+esc(t.youtube_url)+'">Check YouTube demand</a></div></article>';}).join(''):'<div class="cs-dash-empty">Live topic data is temporarily unavailable. Your upload and performance data is still current.</div>';
    var st=data.trend_status||{};root.querySelector('[data-cs-trend-note]').textContent=(st.google||'')+' '+(st.youtube||'');
  }
  function load(){if(root.dataset.loaded==='1')return;root.dataset.loaded='1';fetch(cfg.endpoint,{credentials:'same-origin',cache:'no-store',headers:{'X-WP-Nonce':cfg.nonce||''}}).then(function(r){return r.json().then(function(j){if(!r.ok||j.code)throw new Error(j.message||'Dashboard unavailable');return j;});}).then(paint).catch(function(e){root.dataset.loaded='0';root.querySelector('[data-cs-dash-metrics]').innerHTML='<div class="cs-dash-empty cs-dash-error">'+esc(e.message||'Dashboard unavailable')+'</div>';});}
  function showDashboard(){
    var steps=document.getElementById('gl-steps'),body=document.querySelector('.gl-body'),crumb=document.querySelector('.cs-crumb b');
    if(steps)steps.hidden=true;if(body)body.hidden=true;root.hidden=false;if(crumb)crumb.textContent='Dashboard';
    document.querySelectorAll('.cs-nav a').forEach(function(a){a.classList.toggle('cs-on',a.hasAttribute('data-cs-dashboard'));});
    if(location.hash!=='#creator-dashboard')history.replaceState(null,'','#creator-dashboard');load();
  }
  function showLive(){
    var steps=document.getElementById('gl-steps'),body=document.querySelector('.gl-body'),crumb=document.querySelector('.cs-crumb b');
    root.hidden=true;if(steps)steps.hidden=false;if(body)body.hidden=false;if(crumb)crumb.textContent='Go Live';
    document.querySelectorAll('.cs-nav a').forEach(function(a){a.classList.toggle('cs-on',a.getAttribute('data-cs-view')==='live');});
    if(location.hash==='#creator-dashboard')history.replaceState(null,'',location.pathname+location.search);
  }
  document.addEventListener('click',function(e){var dash=e.target.closest('[data-cs-dashboard]');if(dash){e.preventDefault();showDashboard();return;}var live=e.target.closest('[data-cs-live-view],[data-cs-view="live"]');if(live&&document.getElementById('gl-steps')){e.preventDefault();showLive();}});
  window.SMLCreatorDashboard={show:showDashboard,live:showLive,load:load};
  if(!root.hidden||location.hash==='#creator-dashboard'){showDashboard();}
})();
JS;
    }
}

if (!function_exists('sml_vus_render_creator_dashboard')) {
    function sml_vus_render_creator_dashboard() {
        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=' . get_bloginfo('charset'));
        $config = sml_cs_config();
        echo '<!doctype html><html ' . get_language_attributes() . '><head><meta charset="' . esc_attr(get_bloginfo('charset')) . '"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Creator Studio Dashboard - ' . esc_html(get_bloginfo('name')) . '</title><style>' . sml_cs_styles() . sml_vus_dashboard_styles() . '</style></head><body>';
        if (!is_user_logged_in()) {
            $auth_url = add_query_arg('redirect_to', rawurlencode(home_url('/creator-studio/')), home_url('/sign-up-sign-in/'));
            echo '<div class="cs-gate"><h1>Sign in to Creator Studio</h1><p>Your creator dashboard is available after you sign in.</p><a class="cs-btn cs-btn-primary" href="' . esc_url($auth_url) . '">Sign in</a></div></body></html>';
            exit;
        }
        echo '<div class="cs-shell">';
        sml_cs_render_sidebar('dashboard', true);
        echo '<div class="cs-main"><header class="cs-top"><div class="cs-crumb">Creator Studio<span>/</span><b>Dashboard</b></div><div class="cs-autosave">Live creator workspace</div><a class="cs-top-btn" href="' . esc_url(home_url('/upload-video/')) . '">Upload</a><a class="cs-avatar" href="' . esc_url($config['profileUrl']) . '"><img src="' . esc_url($config['avatar']) . '" alt=""></a></header>';
        sml_vus_dashboard_markup(false);
        echo '</div></div><script>window.smlCreatorDashboardConfig=' . wp_json_encode(sml_vus_dashboard_config()) . ';</script><script>' . sml_vus_dashboard_script() . '</script></body></html>';
        exit;
    }
}

if (!function_exists('sml_vus_creator_dashboard_intercept')) {
    function sml_vus_creator_dashboard_intercept() {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        $path = trim((string) wp_parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH), '/');
        if ($path !== 'creator-studio') {
            return;
        }
        sml_vus_render_creator_dashboard();
    }
}
add_action('template_redirect', 'sml_vus_creator_dashboard_intercept', -20);
