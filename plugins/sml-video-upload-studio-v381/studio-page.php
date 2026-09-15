<?php
/**
 * StockMarketLoop Creator Studio - Upload Video.
 * Standalone 5-step wizard rendered at /upload-video/.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_cs_auth_url')) {
    function sml_cs_auth_url($redirect = '') {
        $url = home_url('/sign-up-sign-in/');
        if ($redirect !== '') {
            $url = add_query_arg('redirect_to', rawurlencode($redirect), $url);
        }
        return $url;
    }
}

if (!function_exists('sml_cs_nav_items')) {
    function sml_cs_nav_items() {
        return array(
            array('key' => 'dashboard', 'label' => 'Dashboard', 'url' => home_url('/creator-studio/')),
            array('key' => 'videos', 'label' => 'Videos', 'url' => home_url('/creator-studio/videos/')),
            array('key' => 'upload', 'label' => 'Upload Video', 'url' => home_url('/upload-video/')),
            array('key' => 'live', 'label' => 'Go Live', 'url' => home_url('/go-live/')),
            array('key' => 'playlists', 'label' => 'Playlists', 'url' => home_url('/creator-studio/?tab=playlists')),
            array('key' => 'analytics', 'label' => 'Analytics', 'url' => home_url('/creator-studio/analytics/')),
            array('key' => 'comments', 'label' => 'Comments', 'url' => home_url('/creator-studio/?tab=comments')),
            array('key' => 'subscribers', 'label' => 'Subscribers', 'url' => home_url('/creator-studio/?tab=subscribers')),
            array('key' => 'monetization', 'label' => 'Monetization', 'url' => home_url('/creator-studio/?tab=monetization')),
            array('key' => 'letters', 'label' => 'Loop Letters', 'url' => home_url('/loop-letters/')),
            array('key' => 'distribute', 'label' => 'Distribution', 'url' => home_url('/distribute/')),
            array('key' => 'groups', 'label' => 'Groups', 'url' => home_url('/groups/')),
            array('key' => 'settings', 'label' => 'Settings', 'url' => home_url('/creator-studio/settings/')),
        );
    }
}

if (!function_exists('sml_cs_nav_icon')) {
    function sml_cs_nav_icon($key) {
        $icons = array(
            'dashboard' => '<rect x="3.4" y="3.4" width="7" height="7" rx="1.6"/><rect x="13.6" y="3.4" width="7" height="7" rx="1.6"/><rect x="3.4" y="13.6" width="7" height="7" rx="1.6"/><rect x="13.6" y="13.6" width="7" height="7" rx="1.6"/>',
            'videos' => '<circle cx="12" cy="12" r="8.6"/><path d="M10.2 8.8l5 3.2-5 3.2z"/>',
            'upload' => '<path d="M12 15.6V4.4M8 8.4L12 4.4l4 4"/><path d="M4.4 15.2v3.2a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6v-3.2"/>',
            'live' => '<rect x="2.8" y="6" width="13" height="12" rx="2.4"/><path d="M16.4 11l4.8-3v8l-4.8-3z"/>',
            'playlists' => '<path d="M4 7h12M4 12h12M4 17h8"/><path d="M18.4 12.6v5.2M21 15.2h-5.2"/>',
            'analytics' => '<path d="M5 19V11M10.4 19V5M15.8 19v-6M21 19H3"/>',
            'comments' => '<path d="M20.4 12.4c0 3.9-3.8 7-8.4 7-1 0-2-.2-2.9-.5L4 20.4l1.6-4.2c-.8-1.1-1.3-2.4-1.3-3.8 0-3.9 3.8-7 8.4-7s7.7 3.1 7.7 7z"/>',
            'subscribers' => '<circle cx="9" cy="8.4" r="3.4"/><path d="M3 19.4c0-3.1 2.7-5.2 6-5.2s6 2.1 6 5.2"/><path d="M16.4 5.6a3.4 3.4 0 0 1 0 6.4M17.6 14.6c2 .7 3.4 2.4 3.4 4.8"/>',
            'monetization' => '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4v9.2M14.4 9.6c-.6-.8-1.5-1.1-2.5-1.1-1.4 0-2.4.8-2.4 1.9 0 2.7 5.1 1.4 5.1 4.1 0 1.2-1.1 2-2.6 2-1.1 0-2.1-.4-2.7-1.2"/>',
            'letters' => '<rect x="3" y="5.4" width="18" height="13.2" rx="2.4"/><path d="M3.8 7l8.2 6 8.2-6"/>',
            'distribute' => '<circle cx="18" cy="5.6" r="2.8"/><circle cx="6" cy="12" r="2.8"/><circle cx="18" cy="18.4" r="2.8"/><path d="M8.5 10.6l7-3.6M8.5 13.4l7 3.6"/>',
            'groups' => '<circle cx="8.4" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 18.6c0-2.6 2.4-4.2 5.4-4.2s5.4 1.6 5.4 4.2M15 14.6c3 0 6 1.6 6 4"/>',
            'settings' => '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1v-.2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1z"/>',
        );
        $path = $icons[$key] ?? $icons['dashboard'];
        return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' . $path . '</svg>';
    }
}

if (!function_exists('sml_cs_render_sidebar')) {
    function sml_cs_render_sidebar($active = '', $dashboard_inline = false) {
        echo '<aside class="cs-side"><a class="cs-brand" href="' . esc_url(home_url('/')) . '">';
        echo '<svg width="32" height="32" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="#2b6cff" stroke-width="2.4"/><path d="M11 25.5l5.4-6.2 4 3.6 7.4-9" stroke="#2b6cff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        echo '<b>StockMarket<em>Loop</em></b></a><div class="cs-side-label">CREATOR STUDIO</div><nav class="cs-nav">';
        foreach (sml_cs_nav_items() as $item) {
            $url = $dashboard_inline && $item['key'] === 'dashboard' ? '#creator-dashboard' : $item['url'];
            $classes = $item['key'] === $active ? ' class="cs-on"' : '';
            $attributes = '';
            if ($dashboard_inline && $item['key'] === 'dashboard') {
                $attributes .= ' data-cs-dashboard';
            }
            if ($dashboard_inline && $item['key'] === 'live') {
                $attributes .= ' data-cs-view="live"';
            }
            echo '<a href="' . esc_url($url) . '"' . $classes . $attributes . '>' . sml_cs_nav_icon($item['key']) . esc_html($item['label']) . '</a>';
        }
        echo '</nav><div class="cs-help"><b>Build your audience</b><p>Review your latest uploads, use live topic signals, or start a broadcast without leaving Creator Studio.</p>';
        echo '<a href="#creator-dashboard"' . ($dashboard_inline ? ' data-cs-dashboard' : '') . '>Open Creator Dashboard</a></div></aside>';
    }
}

if (!function_exists('sml_cs_config')) {
    function sml_cs_config() {
        $user = wp_get_current_user();
        $user_id = get_current_user_id();

        return array(
            'loggedIn' => is_user_logged_in(),
            'nonce' => wp_create_nonce('wp_rest'),
            'userId' => $user_id,
            'displayName' => $user->exists() ? ($user->display_name ?: $user->user_login) : 'Creator',
            'handle' => $user->exists() ? $user->user_nicename : '',
            'avatar' => $user->exists() ? get_avatar_url($user_id, array('size' => 96)) : '',
            'uploadEndpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/upload')),
            'publishEndpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/publish')),
            'chartEndpoint' => esc_url_raw(rest_url('sml-trading-floor/v1/chart')),
            'searchEndpoint' => esc_url_raw(rest_url('sml-members/v1/ticker-search')),
            'trendingEndpoint' => esc_url_raw(rest_url('sml-members/v1/trending-tickers')),
            'loginUrl' => esc_url_raw(sml_cs_auth_url(home_url('/upload-video/'))),
            'creatorStudioUrl' => esc_url_raw(home_url('/creator-studio/')),
            'profileUrl' => sml_video_upload_studio_user_profile_url($user_id),
            'goLiveUrl' => esc_url_raw(home_url('/go-live/')),
            'watchBase' => esc_url_raw(home_url('/watch/')),
            'defaultThumbnail' => sml_video_upload_studio_default_thumb(),
            'maxBytes' => 20 * 1024 * 1024 * 1024,
        );
    }
}

if (!function_exists('sml_cs_styles')) {
    function sml_cs_styles() {
        return <<<'SMLSTUDIOCSS'
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:#070c15;color:#e6edf5;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
input,select,textarea{font:inherit}
svg{display:block}
[hidden]{display:none !important}

.cs-shell{display:grid;grid-template-columns:222px minmax(0,1fr);min-height:100vh}

/* ---------------- sidebar ---------------- */
.cs-side{background:#080d17;border-right:1px solid #141d2a;display:flex;flex-direction:column;padding:0 0 18px;position:sticky;top:0;height:100vh;overflow-y:auto}
.cs-brand{display:flex;align-items:center;gap:11px;padding:20px 18px;border-bottom:1px solid #141d2a}
.cs-brand b{font-size:17px;font-weight:800;line-height:1.15;letter-spacing:-.3px}
.cs-brand b em{display:block;font-style:normal;color:#2b6cff}
.cs-side-label{padding:20px 18px 10px;font-size:11px;font-weight:800;letter-spacing:1.3px;color:#5d7189}
.cs-nav{display:flex;flex-direction:column;gap:2px;padding:0 10px}
.cs-nav a{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:9px;font-size:14px;font-weight:600;color:#a9b8ca}
.cs-nav a:hover{background:#0f1926;color:#fff}
.cs-nav a.cs-on{background:#2b6cff;color:#fff}
.cs-help{margin:auto 12px 0;padding:16px;border-radius:12px;background:#0d1622;border:1px solid #1a2534}
.cs-help b{display:block;font-size:14px;margin-bottom:7px}
.cs-help p{margin:0 0 13px;font-size:12.5px;line-height:1.55;color:#8798ac}
.cs-help a{display:block;text-align:center;height:38px;line-height:38px;border-radius:9px;background:#2b6cff;color:#fff;font-size:13px;font-weight:700}

/* ---------------- top bar ---------------- */
.cs-main{min-width:0;display:flex;flex-direction:column}
.cs-top{display:flex;align-items:center;gap:18px;padding:14px 26px;border-bottom:1px solid #141d2a;background:#080d17;position:sticky;top:0;z-index:40}
.cs-crumb{font-size:19px;font-weight:700;letter-spacing:-.3px}
.cs-crumb span{color:#5d7189;margin:0 8px;font-weight:500}
.cs-crumb b{font-weight:700;color:#e6edf5}
.cs-autosave{display:flex;align-items:center;gap:9px;margin:0 auto;font-size:13.5px;color:#8798ac}
.cs-autosave svg{color:#22d97a}
.cs-top-btn{display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 18px;border-radius:10px;border:1px solid #1e2a3a;background:#0d1622;font-size:14px;font-weight:600;color:#dbe6f2}
.cs-top-btn:hover{background:#132033}
.cs-avatar{display:flex;align-items:center;gap:7px;padding:3px 9px 3px 3px;border-radius:999px;border:1px solid #1e2a3a}
.cs-avatar img{width:34px;height:34px;border-radius:50%;object-fit:cover}

/* ---------------- stepper ---------------- */
.cs-steps{display:flex;align-items:center;gap:0;padding:20px 26px;border-bottom:1px solid #141d2a;background:#0a1018}
.cs-step{display:flex;align-items:center;gap:13px;flex:0 0 auto}
.cs-step-dot{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-size:15px;font-weight:700;background:#111c2b;border:1.5px solid #223146;color:#8798ac;flex:0 0 auto}
.cs-step.cs-active .cs-step-dot{background:#2b6cff;border-color:#2b6cff;color:#fff}
.cs-step.cs-done .cs-step-dot{background:transparent;border-color:#22d97a;color:#22d97a}
.cs-step b{display:block;font-size:14.5px;font-weight:700}
.cs-step small{display:block;font-size:12.5px;color:#7b8ca1;margin-top:2px}
.cs-step.cs-done small{color:#22d97a}
.cs-step-line{flex:1 1 auto;height:1px;background:#1e2a3a;margin:0 18px;min-width:24px}
.cs-step.cs-done+.cs-step-line{background:#1d5c3c}

/* ---------------- body ---------------- */
.cs-body{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:22px;padding:22px 26px 48px;align-items:start}
.cs-card{background:#0b131f;border:1px solid #182130;border-radius:14px;padding:22px}
.cs-card+.cs-card{margin-top:18px}
.cs-card h2{margin:0 0 4px;font-size:20px;font-weight:700;letter-spacing:-.3px}
.cs-card h3{margin:0;font-size:16px;font-weight:700}
.cs-card p.cs-sub{margin:0 0 20px;font-size:13.5px;color:#8798ac}
.cs-head-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}
.cs-content{min-width:0}
.cs-rail{display:flex;flex-direction:column;gap:18px;position:sticky;top:88px}
.cs-rail-card{background:#0b131f;border:1px solid #182130;border-radius:14px;padding:18px}
.cs-rail-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.cs-rail-head b{font-size:16px;font-weight:700}
.cs-rail-link{color:#2b6cff;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:5px}

/* ---------------- dropzone ---------------- */
.cs-drop{border:1.5px dashed #2a3a4f;border-radius:14px;padding:44px 20px;text-align:center;background:#080f1a;transition:border-color .18s,background .18s}
.cs-drop.cs-over{border-color:#2b6cff;background:#0b1526}
.cs-drop svg{margin:0 auto 16px;color:#2b6cff}
.cs-drop b{display:block;font-size:17px;font-weight:600}
.cs-drop .cs-or{margin:12px 0;color:#5d7189;font-size:13px}
.cs-drop-btn{height:44px;padding:0 26px;border-radius:9px;background:#2b6cff;color:#fff;font-weight:700;font-size:14.5px}
.cs-drop-btn:hover{background:#1f5ce6}
.cs-drop small{display:block;margin-top:18px;color:#6d8098;font-size:12.5px}
.cs-imports{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-top:16px}
.cs-import{display:flex;align-items:center;gap:10px;padding:13px 12px;border-radius:11px;border:1px solid #1a2534;background:#0d1622;font-size:12.5px;line-height:1.3;text-align:left}
.cs-import span{color:#8798ac;display:block}
.cs-import b{display:block;font-weight:700;color:#dbe6f2}
.cs-import[disabled]{opacity:.55;cursor:not-allowed}
.cs-import[disabled]:hover::after{content:"Coming soon";position:absolute}
.cs-import-ico{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:#132033;flex:0 0 auto}

/* ---------------- file card ---------------- */
.cs-file{margin-top:18px;border:1px solid #1a2534;border-radius:13px;padding:16px;background:#0d1622}
.cs-file-top{display:flex;align-items:center;gap:14px}
.cs-file-ico{width:46px;height:46px;border-radius:10px;background:#152234;display:grid;place-items:center;color:#63a4ff;flex:0 0 auto}
.cs-file-name{font-size:14.5px;font-weight:700;word-break:break-all}
.cs-file-size{font-size:12.5px;color:#8798ac;margin-top:3px}
.cs-file-mid{flex:1;min-width:120px}
.cs-file-pct{text-align:right;font-size:14px;font-weight:700;color:#22d97a}
.cs-bar{height:6px;border-radius:999px;background:#182534;overflow:hidden;margin-top:8px}
.cs-bar i{display:block;height:100%;border-radius:999px;background:#22d97a;width:0;transition:width .25s}
.cs-bar.cs-blue i{background:#2b6cff}
.cs-file-meta{font-size:12px;color:#8798ac;margin-top:7px}
.cs-icon-btn{width:40px;height:40px;border-radius:10px;border:1px solid #223146;display:grid;place-items:center;color:#c2cede;flex:0 0 auto}
.cs-icon-btn:hover{background:#152234}
.cs-proc{margin-top:16px;border:1px solid #1a2534;border-radius:12px;padding:16px;background:#080f1a}
.cs-proc b{font-size:14px;font-weight:700}
.cs-proc b span{font-weight:500;color:#8798ac;font-size:13px}
.cs-proc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px 20px;margin-top:14px}
.cs-proc-item{display:flex;align-items:center;gap:9px;font-size:13px;color:#8798ac}
.cs-proc-item.cs-ok{color:#dbe6f2}
.cs-proc-item i{width:17px;height:17px;border-radius:50%;border:1.5px solid #2a3a4f;flex:0 0 auto;display:grid;place-items:center}
.cs-proc-item.cs-ok i{border-color:#22d97a;background:#22d97a}
.cs-proc-item.cs-run i{border-color:#2b6cff;border-top-color:transparent;animation:cs-spin .8s linear infinite}
@keyframes cs-spin{to{transform:rotate(360deg)}}
.cs-tip{margin-top:16px;display:flex;align-items:flex-start;gap:11px;padding:14px 16px;border-radius:11px;background:rgba(43,108,255,.07);border:1px solid rgba(43,108,255,.22);font-size:13.5px;line-height:1.55;color:#c2cede}
.cs-tip b{color:#63a4ff}
.cs-tip button{margin-left:auto;color:#7b8ca1}

/* ---------------- forms ---------------- */
.cs-field{margin-bottom:18px}
.cs-field label,.cs-label{display:block;font-size:13px;font-weight:600;color:#a9b8ca;margin-bottom:7px}
.cs-field .cs-hint{font-size:12px;color:#6d8098;margin-top:6px}
.cs-input,.cs-select,.cs-area{width:100%;background:#0d1622;border:1px solid #1e2a3a;border-radius:10px;color:#e6edf5;padding:12px 14px;font-size:14px}
.cs-area{min-height:120px;resize:vertical;line-height:1.65}
.cs-input:focus,.cs-select:focus,.cs-area:focus{outline:none;border-color:#2b6cff;box-shadow:0 0 0 3px rgba(43,108,255,.14)}
.cs-input[disabled],.cs-select[disabled]{opacity:.5}
.cs-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.cs-row-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.cs-count{float:right;font-size:12px;color:#6d8098;font-weight:500}
.cs-tags{display:flex;flex-wrap:wrap;gap:8px;padding:8px;border:1px solid #1e2a3a;border-radius:10px;background:#0d1622;min-height:46px;align-items:center}
.cs-tag{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 6px 0 11px;border-radius:7px;background:#152234;border:1px solid #223146;font-size:13px;font-weight:600}
.cs-tag button{color:#7b8ca1;font-size:15px;line-height:1}
.cs-tag button:hover{color:#ff566e}
.cs-tags input{flex:1;min-width:120px;background:none;border:0;outline:none;color:#e6edf5;font-size:13.5px;padding:0 6px;height:28px}
.cs-radio-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.cs-radio{display:flex;gap:12px;padding:15px;border-radius:12px;border:1px solid #1e2a3a;background:#0d1622;text-align:left;align-items:flex-start}
.cs-radio.cs-on{border-color:#e0a336;background:rgba(224,163,54,.07)}
.cs-radio i{width:18px;height:18px;border-radius:50%;border:1.6px solid #3a4c63;flex:0 0 auto;margin-top:2px;display:grid;place-items:center}
.cs-radio.cs-on i{border-color:#e0a336}
.cs-radio.cs-on i::after{content:"";width:9px;height:9px;border-radius:50%;background:#e0a336}
.cs-radio b{display:block;font-size:14px;font-weight:700;margin-bottom:4px}
.cs-radio span{display:block;font-size:12.5px;color:#8798ac;line-height:1.5}
.cs-badge{display:inline-block;margin-top:8px;font-size:11.5px;font-weight:700;color:#22d97a}
.cs-toggle{width:38px;height:22px;border-radius:999px;background:#26364a;position:relative;flex:0 0 auto;transition:background .18s}
.cs-toggle::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#8798ac;transition:left .18s,background .18s}
[aria-checked="true"] .cs-toggle{background:#2b6cff}
[aria-checked="true"] .cs-toggle::after{left:19px;background:#fff}
.cs-surface{display:flex;align-items:center;gap:11px;padding:13px;border-radius:11px;border:1px solid #1e2a3a;background:#0d1622;text-align:left;width:100%}
.cs-surface-ico{width:30px;height:30px;border-radius:8px;background:#152234;display:grid;place-items:center;color:#8798ac;flex:0 0 auto}
.cs-surface b{display:block;font-size:13.5px;font-weight:700}
.cs-surface small{display:block;font-size:11.5px;margin-top:2px;color:#22d97a}
.cs-surface small.cs-opt{color:#7b8ca1}
.cs-surface-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:11px}
.cs-tick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}
.cs-tick{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:9px;border:1px solid #1e2a3a;background:#0d1622;font-size:13.5px;font-weight:700}
.cs-tick .cs-toggle{margin-left:auto}
.cs-tick button.cs-x{color:#7b8ca1}

/* ---------------- thumbnails, chapters, media ---------------- */
.cs-thumb-pick{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.cs-thumb{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;border:2px solid #1c2839;background:#0d1622;display:grid;place-items:center;color:#5d7189;font-size:12.5px}
.cs-thumb.cs-on{border-color:#22d97a}
.cs-thumb img{width:100%;height:100%;object-fit:cover}
.cs-thumb b{position:absolute;right:7px;bottom:7px;background:rgba(3,7,13,.86);border-radius:5px;padding:2px 6px;font-size:11.5px;font-weight:700}
.cs-chapters{display:flex;flex-direction:column;gap:8px}
.cs-chapter{display:grid;grid-template-columns:96px minmax(0,1fr) 40px;gap:10px;align-items:center}
.cs-chapter .cs-input{padding:9px 11px;font-size:13.5px}
.cs-add{display:inline-flex;align-items:center;gap:7px;margin-top:12px;height:38px;padding:0 15px;border-radius:9px;border:1px dashed #2a3a4f;color:#8798ac;font-size:13.5px;font-weight:600}
.cs-add:hover{border-color:#2b6cff;color:#63a4ff}
.cs-media-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.cs-media{border:1px solid #1a2534;border-radius:11px;overflow:hidden;background:#0d1622}
.cs-media-art{aspect-ratio:16/9;background:#0a1018}
.cs-media-art img{width:100%;height:100%;object-fit:cover}
.cs-media-body{padding:11px 12px}
.cs-media-body b{display:block;font-size:13px;font-weight:700}
.cs-media-body small{display:block;font-size:11.5px;color:#8798ac;margin-top:3px}
.cs-media-body input{margin-top:8px;width:100%;background:#0a1018;border:1px solid #1e2a3a;border-radius:7px;color:#dbe6f2;padding:7px 9px;font-size:12px}

/* ---------------- review ---------------- */
.cs-review-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.cs-def{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px 16px;font-size:13.5px}
.cs-def dt{color:#8798ac}
.cs-def dd{margin:0;font-weight:600}
.cs-edit{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:8px;border:1px solid #223146;font-size:12.5px;font-weight:600;color:#c2cede}
.cs-edit:hover{background:#152234}
.cs-check{display:flex;align-items:center;gap:10px;padding:7px 0;font-size:13.5px}
.cs-check i{color:#22d97a;flex:0 0 auto}
.cs-check span{margin-left:auto;font-size:12px;color:#7b8ca1;font-weight:600}
.cs-check.cs-warn i{color:#e0a336}
.cs-warn-box{display:flex;gap:11px;padding:14px;border-radius:11px;background:rgba(224,163,54,.08);border:1px solid rgba(224,163,54,.26);font-size:13px;line-height:1.55;color:#e8d3a8}
.cs-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cs-metric{padding:14px;border-radius:11px;border:1px solid #1a2534;background:#0d1622}
.cs-metric small{display:flex;align-items:center;gap:7px;font-size:12.5px;color:#8798ac}
.cs-metric b{display:block;font-size:22px;font-weight:800;margin-top:7px;letter-spacing:-.5px}
.cs-metric i{display:block;font-style:normal;font-size:12px;color:#22d97a;margin-top:4px}
.cs-score{font-size:44px;font-weight:800;color:#22d97a;letter-spacing:-1.5px;line-height:1}
.cs-score span{font-size:16px;color:#7b8ca1;font-weight:600}
.cs-ring{width:78px;height:78px;flex:0 0 auto}

/* ---------------- publishing ---------------- */
.cs-pub-pct{font-size:40px;font-weight:800;color:#2b6cff;letter-spacing:-1.2px}
.cs-task{display:grid;grid-template-columns:44px minmax(0,1fr) 250px 56px 120px;gap:14px;align-items:center;padding:14px 0;border-top:1px solid #16202e}
.cs-task:first-child{border-top:0}
.cs-task-ico{width:40px;height:40px;border-radius:10px;background:#152234;display:grid;place-items:center;color:#63a4ff}
.cs-task b{display:block;font-size:14px;font-weight:700}
.cs-task small{display:block;font-size:12.5px;color:#8798ac;margin-top:3px}
.cs-task-pct{font-size:13.5px;font-weight:700;text-align:right}
.cs-task-state{font-size:13px;font-weight:600;color:#8798ac;text-align:right}
.cs-task-state.cs-done{color:#22d97a}
.cs-task-state.cs-run{color:#63a4ff}
.cs-activity{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:10px;padding:8px 0;font-size:12.5px;align-items:center}
.cs-activity time{color:#7b8ca1}
.cs-activity em{font-style:normal;font-weight:600;color:#22d97a}
.cs-activity em.cs-run{color:#63a4ff}
.cs-activity em.cs-pending{color:#7b8ca1}
.cs-stripe{background-image:linear-gradient(45deg,rgba(255,255,255,.16) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.16) 50%,rgba(255,255,255,.16) 75%,transparent 75%,transparent);background-size:14px 14px;animation:cs-slide .7s linear infinite}
@keyframes cs-slide{to{background-position:14px 0}}

/* ---------------- success ---------------- */
.cs-hero{margin:0 0 18px;padding:18px 24px;border-radius:14px;border:1px solid rgba(34,217,122,.3);background:linear-gradient(90deg,rgba(34,217,122,.11),rgba(34,217,122,.02));display:flex;align-items:center;gap:15px}
.cs-hero-ico{width:44px;height:44px;border-radius:50%;background:rgba(34,217,122,.16);display:grid;place-items:center;color:#22d97a;flex:0 0 auto}
.cs-hero b{display:block;font-size:19px;font-weight:700;color:#22d97a}
.cs-hero span{display:block;font-size:13.5px;color:#a9b8ca;margin-top:3px}
.cs-hero a{margin-left:auto;height:42px;padding:0 20px;border-radius:10px;border:1px solid rgba(34,217,122,.4);color:#22d97a;font-weight:700;font-size:14px;display:inline-flex;align-items:center;gap:8px}
.cs-live-grid{display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:24px}
.cs-live-art{border-radius:12px;overflow:hidden;border:1px solid #1a2534;aspect-ratio:16/9;background:#0a1018}
.cs-live-art img{width:100%;height:100%;object-fit:cover}
.cs-pill-live{display:inline-block;padding:4px 10px;border-radius:6px;background:rgba(34,217,122,.15);border:1px solid rgba(34,217,122,.35);color:#22d97a;font-size:11.5px;font-weight:800;letter-spacing:.7px}
.cs-cta-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:20px}
.cs-cta{display:inline-flex;align-items:center;justify-content:center;gap:9px;height:48px;border-radius:10px;border:1px solid #223146;background:#0d1622;font-weight:700;font-size:14px}
.cs-cta.cs-primary{background:#2b6cff;border-color:#2b6cff;color:#fff}
.cs-cta:hover{background:#152234}
.cs-cta.cs-primary:hover{background:#1f5ce6}
.cs-dist-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.cs-dist{padding:15px;border-radius:11px;border:1px solid #1a2534;background:#0d1622}
.cs-dist-top{display:flex;align-items:center;gap:9px;font-size:13.5px;font-weight:700}
.cs-dist-top svg:last-child{margin-left:auto;color:#22d97a}
.cs-dist p{margin:9px 0 12px;font-size:12.5px;color:#8798ac}
.cs-dist a{color:#2b6cff;font-size:12.5px;font-weight:600}
.cs-next{display:flex;align-items:center;gap:12px;padding:13px 0;border-top:1px solid #16202e}
.cs-next:first-of-type{border-top:0}
.cs-next-ico{width:34px;height:34px;border-radius:9px;background:#152234;display:grid;place-items:center;color:#63a4ff;flex:0 0 auto}
.cs-next b{display:block;font-size:13.5px;font-weight:700}
.cs-next small{display:block;font-size:12px;color:#8798ac;margin-top:2px}
.cs-next svg:last-child{margin-left:auto;color:#5d7189}

/* ---------------- preview card ---------------- */
.cs-prev-art{position:relative;aspect-ratio:16/9;border-radius:11px;overflow:hidden;background:#0a1018;border:1px solid #1a2534}
.cs-prev-art img{width:100%;height:100%;object-fit:cover}
.cs-prev-art b{position:absolute;right:8px;bottom:8px;background:rgba(3,7,13,.86);border-radius:5px;padding:2px 7px;font-size:11.5px;font-weight:700}
.cs-prev-title{margin-top:12px;font-size:15px;font-weight:700;line-height:1.4}
.cs-prev-by{display:flex;align-items:center;gap:9px;margin-top:11px}
.cs-prev-by img{width:34px;height:34px;border-radius:50%;object-fit:cover}
.cs-prev-by b{display:flex;align-items:center;gap:5px;font-size:13.5px;font-weight:700}
.cs-prev-by small{display:block;font-size:12px;color:#8798ac}
.cs-status-row{display:flex;align-items:center;justify-content:space-between;padding:7px 0;font-size:13.5px}
.cs-status-row span{color:#8798ac}
.cs-status-row b{font-weight:600}
.cs-status-row b.cs-green{color:#22d97a}
.cs-status-row b.cs-blue{color:#63a4ff}

/* ---------------- footer actions ---------------- */
.cs-actions{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:20px}
.cs-btn{display:inline-flex;align-items:center;gap:10px;height:48px;padding:0 24px;border-radius:10px;font-weight:700;font-size:15px;border:1px solid #223146;background:#0d1622;color:#dbe6f2}
.cs-btn:hover{background:#152234}
.cs-btn-primary{background:#2b6cff;border-color:#2b6cff;color:#fff}
.cs-btn-primary:hover{background:#1f5ce6}
.cs-btn-gold{background:linear-gradient(90deg,#e0a336,#c8862a);border-color:#e0a336;color:#17120a}
.cs-btn-gold:hover{filter:brightness(1.07)}
.cs-btn[disabled]{opacity:.45;cursor:not-allowed}
.cs-btn-wide{width:100%;justify-content:center}
.cs-foot-note{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:11px;font-size:12.5px;color:#6d8098}

.cs-gate{max-width:460px;margin:12vh auto;text-align:center}
.cs-gate h1{font-size:24px;margin:0 0 10px}
.cs-gate p{color:#8798ac;font-size:14px;line-height:1.6;margin:0 0 22px}

@media (max-width:1500px){
  .cs-body{grid-template-columns:minmax(0,1fr) 340px}
  .cs-surface-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .cs-task{grid-template-columns:44px minmax(0,1fr) 160px 50px 110px}
}
@media (max-width:1180px){
  .cs-shell{grid-template-columns:1fr}
  .cs-side{display:none}
  .cs-body{grid-template-columns:minmax(0,1fr)}
  .cs-rail{position:static}
  .cs-imports,.cs-review-grid,.cs-radio-grid,.cs-tick-grid,.cs-thumb-pick,.cs-media-grid,.cs-dist-grid,.cs-cta-row,.cs-row,.cs-row-3,.cs-live-grid{grid-template-columns:minmax(0,1fr)}
  .cs-steps{overflow-x:auto}
  .cs-step small{display:none}
  .cs-task{grid-template-columns:44px minmax(0,1fr) 60px}
  .cs-task .cs-bar,.cs-task .cs-task-state{display:none}
}
SMLSTUDIOCSS;
    }
}
