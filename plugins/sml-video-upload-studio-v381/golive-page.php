<?php
/**
 * StockMarketLoop Creator Studio - Go Live.
 * Standalone 5-step live stream wizard rendered at /go-live/.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_gl_auth_url')) {
    function sml_gl_auth_url($redirect = '') {
        $url = home_url('/sign-up-sign-in/');
        if ($redirect !== '') {
            $url = add_query_arg('redirect_to', rawurlencode($redirect), $url);
        }
        return $url;
    }
}

if (!function_exists('sml_gl_config')) {
    function sml_gl_config() {
        $user = wp_get_current_user();
        $user_id = get_current_user_id();

        return array(
            'loggedIn' => is_user_logged_in(),
            'nonce' => wp_create_nonce('wp_rest'),
            'userId' => $user_id,
            'displayName' => $user->exists() ? ($user->display_name ?: $user->user_login) : 'Creator',
            'handle' => $user->exists() ? $user->user_nicename : '',
            /* Match the public Watch Page and shared chat room key exactly. */
            'watchChatHandle' => $user->exists()
                ? sanitize_key( (string) ( $user->user_nicename ?: $user->user_login ) )
                : '',
            'avatar' => $user->exists() ? get_avatar_url($user_id, array('size' => 96)) : '',
            'uploadEndpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/upload')),
            'chartEndpoint' => esc_url_raw(rest_url('sml-trading-floor/v1/chart')),
            'searchEndpoint' => esc_url_raw(rest_url('sml-members/v1/ticker-search')),
            'trendingEndpoint' => esc_url_raw(rest_url('sml-members/v1/trending-tickers')),
            'groupsEndpoint' => esc_url_raw(rest_url('sml/v1/groups/discover')),
            'liveRoomsEndpoint' => esc_url_raw(rest_url('sml-group-live/v1/rooms')),
            'liveStartEndpoint' => esc_url_raw(rest_url('sml-group-live/v1/start')),
            'liveStopEndpoint' => esc_url_raw(rest_url('sml-group-live/v1/stop')),
            'streamKeyEndpoint' => esc_url_raw(rest_url('sml-voice/v1/stream-key')),
            'streamKeyRotateEndpoint' => esc_url_raw(rest_url('sml-voice/v1/stream-key/rotate')),
            'rtmpSettingsEndpoint' => esc_url_raw(rest_url('sml-voice/v1/rtmp/settings')),
            'liveChatEndpoint' => esc_url_raw(rest_url('sml-voice/v1/chat')),
            'liveChatModerateEndpoint' => esc_url_raw(rest_url('sml-voice/v1/chat/moderate')),
            'chatOverlayEndpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/chat-overlay-settings')),
            'chatOverlaySettings' => $user_id && function_exists('sml_chat_overlay_get')
                ? sml_chat_overlay_get($user_id)
                : array(),
            'chatOverlayFonts' => function_exists('sml_chat_overlay_fonts') ? sml_chat_overlay_fonts() : array('Inter'),
            'chatOverlayUrl' => $user_id && function_exists('sml_chat_overlay_url')
                ? sml_chat_overlay_url($user_id)
                : '',
            'chatOverlayEditorUrl' => esc_url_raw(add_query_arg('chat_overlay', '1', home_url('/go-live/')) . '#chat-overlay'),
            'orbitEndpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/orbit-settings')),
            'orbitSettings' => $user_id && function_exists('sml_vus_orbit_live_get') ? sml_vus_orbit_live_get($user_id) : array('enabled' => false, 'items' => array()),
            'openChatOverlay' => isset($_GET['chat_overlay']) && sanitize_text_field(wp_unslash($_GET['chat_overlay'])) === '1',
            'voiceSettingsEndpoint' => esc_url_raw(rest_url('sml-voice/v1/settings')),
            'monetizationEndpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/creator-revenue-settings')),
            'monetizationSettings' => $user_id && function_exists('sml_gl_get_monetization_settings')
                ? sml_gl_get_monetization_settings($user_id)
                : array(),
            'monetizationUrl' => esc_url_raw(add_query_arg('monetization', '1', home_url('/go-live/')) . '#manage-monetization'),
            'openMonetization' => isset($_GET['monetization']) && sanitize_text_field(wp_unslash($_GET['monetization'])) === '1',
            'isAdmin' => current_user_can('manage_options'),
            'livePollEndpoint' => esc_url_raw(rest_url('sml-group-live/v1/poll')),
            'loginUrl' => esc_url_raw(sml_gl_auth_url(home_url('/go-live/'))),
            'creatorStudioUrl' => esc_url_raw(home_url('/creator-studio/')),
            'uploadPageUrl' => esc_url_raw(home_url('/upload-video/')),
            'groupsUrl' => esc_url_raw(home_url('/groups/')),
            'profileUrl' => sml_video_upload_studio_user_profile_url($user_id),
            'defaultThumbnail' => sml_video_upload_studio_default_thumb(),
        );
    }
}

if (!function_exists('sml_gl_styles')) {
    function sml_gl_styles() {
        return <<<'SMLGLCSS'
/* ---------------- go live: three column body ---------------- */
.gl-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.02fr) 300px;gap:20px;padding:22px 26px 48px;align-items:start}
.gl-col{min-width:0;display:flex;flex-direction:column;gap:18px}
.gl-col.gl-rail{position:sticky;top:88px}
.gl-req{color:#ff566e}
#sml-live-share{display:none!important}
.sml-cdo-orbit-voice-layout{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,.85fr);gap:18px;align-items:start;margin-top:16px}
.sml-cdo-orbit-voice-layout>*{min-width:0}
.sml-cdo-voice-slot{min-width:0}
.sml-cdo-voice-slot .vcd{position:static;right:auto;bottom:auto;left:auto;width:100%;max-width:none;max-height:560px;box-shadow:0 16px 44px rgba(0,0,0,.28)}
.sml-cdo-voice-slot .vcd-body{max-height:465px}
.sml-cdo-voice-slot .vcd-empty{padding:18px}
@media (max-width:980px){.sml-cdo-orbit-voice-layout{grid-template-columns:minmax(0,1fr)}}

.gl-media{position:relative;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#05090f;border:1px solid #1a2534}
.gl-media video{width:100%;height:100%;object-fit:cover;display:block;background:#05090f;transform:none}
.gl-media video.gl-no-mirror{transform:none}
.gl-media-empty{position:absolute;inset:0;display:grid;place-items:center;text-align:center;color:#5d7189;font-size:13.5px;padding:20px;gap:12px}
.gl-quote{position:absolute;left:14px;top:14px;width:44%;max-width:250px;padding:13px 15px;border-radius:11px;background:linear-gradient(160deg,rgba(6,20,14,.93),rgba(5,11,18,.9));border:1px solid rgba(34,217,122,.28);backdrop-filter:blur(6px)}
.gl-quote b{display:block;font-size:16px;font-weight:800;letter-spacing:.3px}
.gl-quote .gl-price{font-size:27px;font-weight:800;letter-spacing:-.8px;margin-top:4px}
.gl-quote .gl-chg{font-size:13px;font-weight:700;color:#22d97a;margin-top:3px}
.gl-quote .gl-chg.gl-down{color:#ff566e}
.gl-quote .gl-session{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#e0a336;margin-top:7px;font-weight:600}
.gl-quote .gl-session i{width:7px;height:7px;border-radius:50%;background:#e0a336;display:block}
.gl-quote svg{margin-top:8px;width:100%;height:44px}
.gl-badge-q{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:#22d97a}
.gl-badge-q.gl-warn{color:#e0a336}
.gl-badge-q.gl-bad{color:#ff566e}
.gl-movers{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:14px}
.gl-movers .gl-movers-label{font-size:12.5px;color:#8798ac;width:100%}
.gl-mover{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 11px;border-radius:8px;background:#0f1926;border:1px solid #1e2a3a;font-size:12.5px;font-weight:700}
.gl-mover em{font-style:normal;color:#22d97a}
.gl-mover em.gl-down{color:#ff566e}

.gl-health{display:grid;grid-template-columns:minmax(0,1fr) 132px;gap:16px;align-items:center}
.gl-health-row{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13.5px}
.gl-health-row i{color:#22d97a;flex:0 0 auto;display:flex}
.gl-health-row i.gl-off{color:#3a4c63}
.gl-health-row i.gl-warn{color:#e0a336}
.gl-health-row span{color:#c2cede}
.gl-health-row b{margin-left:auto;font-weight:600;color:#22d97a;font-size:13px;text-align:right}
.gl-health-row b.gl-muted{color:#7b8ca1}
.gl-health-row b.gl-warn{color:#e0a336}
.gl-gauge{text-align:center}
.gl-gauge small{display:block;font-size:11.5px;color:#7b8ca1;margin-top:8px;line-height:1.4}

.gl-tools{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}
.gl-tool{display:flex;align-items:center;gap:10px;padding:13px 12px;border-radius:11px;border:1px solid #1e2a3a;background:#0d1622;text-align:left}
.gl-tool:hover:not([disabled]){background:#132033;border-color:#2b6cff}
.gl-tool[disabled]{opacity:.45;cursor:not-allowed}
.gl-tool span{min-width:0}
.gl-tool b{display:block;font-size:13px;font-weight:700}
.gl-tool small{display:block;font-size:11.5px;color:#8798ac;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gl-tool.gl-on{border-color:#ff566e;background:rgba(255,86,110,.08)}

.gl-choice{display:flex;align-items:center;gap:12px;padding:11px 4px;width:100%;text-align:left}
.gl-choice+.gl-choice{border-top:1px solid #16202e}
.gl-choice-ico{width:26px;flex:0 0 auto;color:#8798ac;display:flex}
.gl-choice b{display:block;font-size:13.5px;font-weight:700}
.gl-choice small{display:block;font-size:12px;color:#8798ac;margin-top:2px}
.gl-dot{width:19px;height:19px;border-radius:50%;border:1.7px solid #3a4c63;margin-left:auto;flex:0 0 auto;display:grid;place-items:center}
.gl-choice.gl-on .gl-dot{border-color:#2b6cff}
.gl-choice.gl-on .gl-dot::after{content:"";width:9px;height:9px;border-radius:50%;background:#2b6cff}
.gl-choice[disabled]{opacity:.45;cursor:not-allowed}

.gl-switchrow{display:flex;align-items:center;gap:11px;padding:9px 2px;width:100%;text-align:left}
a.gl-switchrow{color:inherit;text-decoration:none}
.gl-switchrow+.gl-switchrow{border-top:1px solid #16202e}
.gl-switchrow svg{color:#8798ac;flex:0 0 auto}
.gl-switchrow b{font-size:13.5px;font-weight:600}
.gl-switchrow em{margin-left:auto;font-style:normal;font-size:12.5px;font-weight:700;color:#22d97a}
.gl-switchrow em.gl-off{color:#5d7189}
.gl-switchrow[disabled]{opacity:.45;cursor:not-allowed}

.gl-scene-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.gl-scene{border:1.5px solid #1e2a3a;border-radius:11px;padding:12px;background:#0d1622;text-align:left}
.gl-scene.gl-on{border-color:#2b6cff;background:rgba(43,108,255,.07)}
.gl-scene-art{aspect-ratio:16/9;border-radius:8px;background:#0a1018;border:1px solid #1a2534;position:relative;overflow:hidden;margin-bottom:10px}
.gl-scene-art i{position:absolute;background:#1c2b3d;border-radius:4px;display:block}
.gl-scene b{font-size:13px;font-weight:700}
.gl-scene small{display:block;font-size:11.5px;color:#8798ac;margin-top:3px}

.gl-meter{height:8px;border-radius:999px;background:#182534;overflow:hidden;margin-top:9px}
.gl-meter i{display:block;height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,#22d97a,#e0a336,#ff566e);transition:width .1s}

.gl-live-banner{display:flex;align-items:center;gap:14px;padding:15px 20px;border-radius:12px;border:1px solid rgba(255,86,110,.35);background:linear-gradient(90deg,rgba(255,86,110,.13),rgba(255,86,110,.02))}
.gl-live-dot{width:11px;height:11px;border-radius:50%;background:#ff566e;box-shadow:0 0 0 0 rgba(255,86,110,.6);animation:gl-pulse 1.7s infinite;flex:0 0 auto}
@keyframes gl-pulse{70%{box-shadow:0 0 0 11px rgba(255,86,110,0)}100%{box-shadow:0 0 0 0 rgba(255,86,110,0)}}
.gl-live-banner b{font-size:16px;font-weight:800;letter-spacing:.6px;color:#ff566e}
.gl-live-banner span{font-size:13px;color:#a9b8ca}
.gl-live-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.gl-stat{padding:14px;border-radius:11px;border:1px solid #1a2534;background:#0d1622}
.gl-stat small{font-size:12px;color:#8798ac;display:flex;align-items:center;gap:7px}
.gl-stat b{display:block;font-size:23px;font-weight:800;margin-top:6px;letter-spacing:-.5px;font-variant-numeric:tabular-nums}

.gl-thumb-row{display:grid;grid-template-columns:minmax(0,240px) minmax(0,1fr);gap:16px;align-items:start}
.gl-thumb-art{aspect-ratio:16/9;border-radius:10px;overflow:hidden;border:1px solid #1c2839;background:#0d1622;display:grid;place-items:center;color:#5d7189;font-size:12.5px}
.gl-thumb-art img{width:100%;height:100%;object-fit:cover}
.gl-thumb-side{display:flex;flex-direction:column;gap:9px}
.gl-thumb-side p{margin:0 0 4px;font-size:12.5px;color:#8798ac;line-height:1.6}
.gl-btn-line{display:flex;align-items:center;gap:10px;height:42px;padding:0 16px;border-radius:9px;border:1px solid #223146;background:#0d1622;font-size:13.5px;font-weight:600;width:100%;justify-content:center}
.gl-btn-line:hover:not([disabled]){background:#152234}
.gl-btn-line[disabled]{opacity:.45;cursor:not-allowed}
.gl-ai{display:flex;align-items:center;gap:10px;margin-top:10px}
.gl-ai small{font-size:12px;color:#7b8ca1}

.gl-live-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,.8fr);gap:18px;margin-top:18px}
.gl-chat-card,.gl-chat-side{min-height:100%}
.gl-chat-head{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:14px}
.gl-chat-head h3{margin:0 0 4px}
.gl-chat-head small{color:#8798ac;display:block;line-height:1.5}
.gl-chat-refresh{width:auto;padding:0 18px;flex:0 0 auto}
.gl-chat-meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.gl-chat-state,.gl-chat-soft{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;border:1px solid #223146;background:#0d1622;font-size:12px;font-weight:700}
.gl-chat-state.is-on{color:#22d97a;border-color:rgba(34,217,122,.35)}
.gl-chat-state.is-off{color:#7b8ca1}
.gl-chat-soft{color:#9eb0c5}
.gl-chat-feed{display:flex;flex-direction:column;gap:10px;max-height:520px;overflow:auto;padding-right:4px}
.gl-chat-empty{padding:18px;border:1px dashed #243446;border-radius:12px;color:#7f92a8;text-align:center;background:#0d1622}
.gl-chat-item{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:12px;padding:12px;border-radius:12px;border:1px solid #1d2a39;background:#0d1622;align-items:start}
.gl-chat-item.is-super{border-color:rgba(224,163,54,.5);background:linear-gradient(160deg,rgba(224,163,54,.12),rgba(13,22,34,.95))}
.gl-chat-item.is-removed{opacity:.55}
.gl-chat-item img{width:42px;height:42px;border-radius:50%;object-fit:cover;border:1px solid #203246}
.gl-chat-copy{min-width:0}
.gl-chat-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gl-chat-row b{font-size:13.5px;color:#f4f7fb}
.gl-chat-row time{margin-left:auto;font-size:11.5px;color:#7f92a8}
.gl-chat-copy p{margin:6px 0 0;color:#d6dfeb;font-size:13.5px;line-height:1.5;word-break:break-word}
.gl-chat-tier,.gl-chat-money{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.02em}
.gl-chat-tier{background:rgba(224,163,54,.15);color:#f5c35a;border:1px solid rgba(224,163,54,.4);text-transform:capitalize}
.gl-chat-money{background:rgba(34,217,122,.12);color:#22d97a;border:1px solid rgba(34,217,122,.35)}
.gl-chat-actions{display:flex;align-items:center;gap:6px}
.gl-chat-actions button{height:30px;padding:0 11px;border-radius:8px;border:1px solid #223146;background:#111d2a;color:#dce5ef;font-size:12px;font-weight:700}
.gl-chat-actions button:hover{background:#162537}
.gl-chat-compose{display:flex;flex-direction:column;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid #1a2534}
.gl-chat-compose textarea{min-height:88px;resize:vertical;background:#0b131d;border:1px solid #223146;border-radius:11px;color:#e6edf5;padding:12px 13px;font:inherit}
.gl-chat-compose-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.gl-chat-compose-row small{color:#7f92a8;line-height:1.5}
.gl-chat-totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.gl-chat-tile{padding:14px 12px;border-radius:12px;border:1px solid #1d2a39;background:#0d1622}
.gl-chat-tile small{display:block;color:#7f92a8;font-size:11.5px}
.gl-chat-tile b{display:block;margin-top:6px;font-size:20px;font-weight:800;letter-spacing:-.4px}

.gl-money-row{cursor:pointer}
.gl-money-row[aria-disabled="true"]{cursor:not-allowed;opacity:.58}
.gl-money-status{display:inline-flex;align-items:center;justify-content:center;min-width:42px;height:24px;padding:0 8px;border-radius:999px;border:1px solid rgba(34,217,122,.3);background:rgba(34,217,122,.1);color:#22d97a;font-size:11px;font-weight:800;font-style:normal}
.gl-money-status.gl-off{border-color:#243448;background:#111b28;color:#7f92a8}
.gl-money-status.gl-soon{border-color:rgba(224,163,54,.35);background:rgba(224,163,54,.09);color:#e0a336}
.gl-money-modal{position:fixed;inset:0;z-index:1000000;display:grid;place-items:center;padding:24px;background:rgba(1,6,12,.78);backdrop-filter:blur(8px)}
.gl-money-dialog{width:min(1040px,100%);max-height:min(900px,calc(100vh - 36px));overflow:auto;border:1px solid #27374a;border-radius:14px;background:#08111c;box-shadow:0 30px 90px rgba(0,0,0,.6)}
.gl-money-head{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:20px 22px;border-bottom:1px solid #1d2a39;background:rgba(8,17,28,.96);backdrop-filter:blur(10px)}
.gl-money-head h2{margin:0;font-size:21px}
.gl-money-head p{margin:5px 0 0;color:#8798ac;font-size:13px;line-height:1.5}
.gl-money-close{width:38px;height:38px;border-radius:9px;border:1px solid #27374a;background:#101b28;color:#e6edf5;font-size:22px;line-height:1}
.gl-money-form{padding:20px 22px 24px}
.gl-money-module{padding:18px;border:1px solid #1d2a39;border-radius:12px;background:#0c1622;margin-bottom:14px}
.gl-money-module.is-active{border-color:rgba(34,217,122,.38);box-shadow:inset 0 0 0 1px rgba(34,217,122,.05)}
.gl-money-module.is-soon{opacity:.68}
.gl-money-module-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}
.gl-money-module-head>svg{color:#22d97a;flex:0 0 auto;margin-top:2px}
.gl-money-module-head span{min-width:0}
.gl-money-module-head b{display:block;font-size:15px}
.gl-money-module-head small{display:block;color:#8798ac;font-size:12.5px;line-height:1.5;margin-top:3px}
.gl-money-toggle{margin-left:auto;display:inline-flex;align-items:center;gap:9px;font-size:12px;font-weight:800;color:#8798ac}
.gl-money-toggle input{width:19px;height:19px;accent-color:#22d97a}
.gl-money-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.gl-money-fields .gl-wide{grid-column:1/-1}
.gl-money-fields label{display:flex;flex-direction:column;gap:7px;color:#aebdd0;font-size:12px;font-weight:700}
.gl-money-fields input,.gl-money-fields textarea{width:100%;border:1px solid #27374a;border-radius:9px;background:#08111a;color:#f3f7fb;padding:10px 11px;font:inherit}
.gl-money-fields textarea{min-height:72px;resize:vertical}
.gl-membership-intro{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 0 12px;padding:12px 14px;border:1px solid #27374a;border-radius:10px;background:#09131e}
.gl-membership-intro b{font-size:14px}.gl-membership-intro span{color:#8798ac;font-size:12px}
.gl-membership-category{border-left:3px solid #22d97a}
.gl-benefit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;margin:15px 0;padding:14px;border:1px solid #1d2a39;border-radius:10px;background:#08111a}
.gl-benefit-grid label{display:flex;align-items:center;gap:9px;color:#c6d2df;font-size:12.5px;font-weight:700}
.gl-benefit-grid label:has(input[type=number]){display:grid;grid-template-columns:minmax(0,1fr) 110px}
.gl-benefit-grid input[type=checkbox]{width:18px;height:18px;accent-color:#22d97a}
.gl-benefit-grid input[type=number]{width:100%;border:1px solid #27374a;border-radius:8px;background:#0c1622;color:#f3f7fb;padding:8px 9px}
.gl-benefit-grid .gl-wide{grid-column:1/-1}
.gl-credit-rule{margin:0;color:#8798ac;font-size:11.5px;line-height:1.55}
.gl-membership-plans{margin-top:15px;border:1px solid #1d2a39;border-radius:10px;overflow:hidden}
.gl-membership-plan-head,.gl-membership-plan{display:grid;grid-template-columns:minmax(150px,1fr) 150px minmax(150px,190px);align-items:center;gap:12px;padding:10px 12px}
.gl-membership-plan-head{background:#0a121d;color:#6f8298;font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.gl-membership-plan{border-top:1px solid #172433;color:#dbe5ef;font-size:12.5px}
.gl-membership-plan>span b,.gl-membership-plan>span small{display:block}.gl-membership-plan>span small{margin-top:2px;color:#8798ac;font-size:10.5px}
.gl-price-input{display:flex;align-items:center;border:1px solid #27374a;border-radius:8px;background:#08111a;overflow:hidden}
.gl-price-input span{padding:0 0 0 10px;color:#8798ac;font-weight:800}
.gl-price-input input{min-width:0;width:100%;border:0;background:transparent;color:#f3f7fb;padding:9px;font:inherit}
.gl-money-split{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;border-radius:10px;background:#0a121d;border:1px solid #1d2a39;color:#aebdd0;font-size:12.5px}
.gl-money-split b{color:#22d97a;font-size:14px}
.gl-money-feedback{min-height:20px;margin:4px 0 12px;color:#8798ac;font-size:12.5px}
.gl-money-feedback.is-error{color:#ff7187}
.gl-money-actions{display:flex;justify-content:flex-end;gap:10px}

.gl-chat-overlay-preview{position:absolute;z-index:4;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;width:min(430px,58%);pointer-events:none}
.gl-chat-overlay-preview article{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:start;box-shadow:0 10px 28px rgba(0,0,0,.22);overflow:hidden}
.gl-chat-overlay-preview article.no-avatar{grid-template-columns:minmax(0,1fr)}
.gl-chat-overlay-preview img{border-radius:50%;object-fit:cover}
.gl-chat-overlay-preview b,.gl-chat-overlay-preview small{display:inline-block}.gl-chat-overlay-preview p{margin:3px 0 0;line-height:1.35;overflow-wrap:anywhere}
.gl-chat-overlay-preview .badge{margin-left:7px;padding:2px 6px;border-radius:999px;border:1px solid currentColor;font-size:.62em;text-transform:uppercase}
.gl-overlay-subscriber-count{align-self:flex-start;padding:5px 9px;border:1px solid rgba(94,234,212,.38);border-radius:999px;background:rgba(7,17,28,.84);color:#f4f7fb;font-size:.72em;font-weight:850;box-shadow:0 8px 22px rgba(0,0,0,.25)}
.gl-overlay-dialog{width:min(1180px,100%)}
.gl-overlay-layout{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(340px,.95fr);min-height:620px}
.gl-overlay-controls{padding:20px 22px 26px;border-right:1px solid #1d2a39}
.gl-overlay-stage-wrap{position:sticky;top:79px;align-self:start;padding:20px;background:#060d16}
.gl-overlay-stage{position:relative;aspect-ratio:16/9;overflow:hidden;border:1px solid #27374a;border-radius:12px;background:radial-gradient(circle at 78% 20%,rgba(43,108,255,.2),transparent 38%),linear-gradient(145deg,#111e2d,#070c13 68%);box-shadow:inset 0 0 60px rgba(0,0,0,.38)}
.gl-overlay-stage:before{content:"LIVE PREVIEW";position:absolute;top:13px;left:14px;padding:5px 8px;border-radius:6px;background:#e92c43;color:#fff;font-size:9px;font-weight:900;letter-spacing:.08em}
.gl-overlay-stage-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:10% 10%}
.gl-overlay-stage .gl-chat-overlay-preview{cursor:move;pointer-events:auto}
.gl-overlay-section{padding:15px 0;border-bottom:1px solid #172433}.gl-overlay-section:first-child{padding-top:0}.gl-overlay-section:last-child{border-bottom:0}
.gl-overlay-section h3{margin:0 0 11px;font-size:14px}.gl-overlay-section>p{margin:-5px 0 12px;color:#7f92a8;font-size:11.5px;line-height:1.5}
.gl-overlay-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
.gl-overlay-grid.gl-three{grid-template-columns:repeat(3,minmax(0,1fr))}
.gl-overlay-field{display:flex;flex-direction:column;gap:6px;color:#aebdd0;font-size:11.5px;font-weight:700;min-width:0}
.gl-overlay-field input,.gl-overlay-field select{width:100%;height:40px;border:1px solid #27374a;border-radius:8px;background:#08111a;color:#f3f7fb;padding:0 10px;font:inherit}
.gl-overlay-field input[type=color]{padding:4px;cursor:pointer}.gl-overlay-field input[type=range]{padding:0;border:0;accent-color:#22d97a}
.gl-position-grid{display:grid;grid-template-columns:repeat(3,44px);gap:7px}
.gl-position-grid button{height:36px;border:1px solid #27374a;border-radius:8px;background:#0d1824;color:#7f92a8;font-size:12px}
.gl-position-grid button.gl-on{border-color:#22d97a;background:rgba(34,217,122,.12);color:#22d97a}
.gl-overlay-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 13px}
.gl-overlay-checks label{display:flex;align-items:center;gap:8px;color:#c5d1df;font-size:12px;font-weight:700}
.gl-overlay-checks input{width:17px;height:17px;accent-color:#22d97a}
.gl-overlay-source{margin-top:14px;padding:12px;border:1px solid #27374a;border-radius:10px;background:#08111a}
.gl-overlay-source b{display:block;margin-bottom:5px;font-size:12px}.gl-overlay-source p{margin:0 0 9px;color:#7f92a8;font-size:11px;line-height:1.5}
.gl-overlay-copy{display:flex;gap:8px}.gl-overlay-copy input{min-width:0;flex:1;height:38px;border:1px solid #27374a;border-radius:8px;background:#050b12;color:#aebdd0;padding:0 10px;font-size:11px}
.gl-overlay-copy button{height:38px;white-space:nowrap}
.gl-overlay-feedback{min-height:19px;margin-top:10px;color:#8798ac;font-size:12px}.gl-overlay-feedback.is-error{color:#ff7187}

.gl-ticker-row{display:grid;grid-template-columns:130px minmax(0,1fr) auto;gap:10px;align-items:center}
.gl-verified{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#22d97a;white-space:nowrap}
.gl-resolved{display:flex;align-items:center;gap:10px;background:#0d1622;border:1px solid #1e2a3a;border-radius:10px;padding:12px 14px;font-size:14px;min-width:0}
.gl-resolved span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

@media (max-width:1600px){ .gl-body{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 280px} }
@media (max-width:1320px){
  .gl-body{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .gl-col.gl-rail{grid-column:1 / -1;position:static}
}
@media (max-width:1080px){
  .gl-body{grid-template-columns:minmax(0,1fr);padding:16px 16px 44px}
  .gl-tools,.gl-scene-grid,.gl-live-stats,.gl-chat-totals,.gl-live-grid{grid-template-columns:minmax(0,1fr)}
  .gl-health{grid-template-columns:minmax(0,1fr)}
  .gl-thumb-row{grid-template-columns:minmax(0,1fr)}
  .gl-chat-item{grid-template-columns:42px minmax(0,1fr)}
  .gl-chat-actions{grid-column:2}
  .gl-chat-compose-row{flex-direction:column;align-items:stretch}
  .gl-money-modal{padding:10px}
  .gl-money-dialog{max-height:calc(100vh - 20px)}
  .gl-money-fields{grid-template-columns:minmax(0,1fr)}
  .gl-money-fields .gl-wide{grid-column:auto}
  .gl-membership-intro{align-items:flex-start;flex-direction:column}
  .gl-benefit-grid{grid-template-columns:minmax(0,1fr)}
  .gl-benefit-grid .gl-wide{grid-column:auto}
  .gl-membership-plan-head{display:none}
  .gl-membership-plan{grid-template-columns:minmax(0,1fr) minmax(130px,1fr);gap:8px}
  .gl-membership-plan>span{grid-column:1/-1}
  .gl-money-actions{flex-direction:column-reverse}
  .gl-money-actions .cs-btn{width:100%}
  .gl-overlay-layout{grid-template-columns:minmax(0,1fr)}
  .gl-overlay-controls{border-right:0;border-bottom:1px solid #1d2a39}
  .gl-overlay-stage-wrap{position:static}
}
@media (max-width:620px){
  .gl-overlay-grid,.gl-overlay-grid.gl-three,.gl-overlay-checks{grid-template-columns:minmax(0,1fr)}
  .gl-chat-overlay-preview{width:min(360px,82%)}
}
SMLGLCSS;
    }
}
