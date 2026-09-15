<?php
/**
 * Loop Letters - Creator Studio editor at /loop-letters/.
 * Block editor with the trading-native blocks, rendered in the same standalone
 * Creator Studio shell as the upload and go-live studios.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_letters_editor_config')) {
    function sml_letters_editor_config() {
        $user = wp_get_current_user();
        $user_id = get_current_user_id();
        return array(
            'base' => esc_url_raw(rest_url('sml-letters/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
            'userId' => $user_id,
            'displayName' => $user->exists() ? ($user->display_name ?: $user->user_login) : 'Creator',
            'handle' => $user->exists() ? $user->user_nicename : '',
            'avatar' => $user->exists() ? get_avatar_url($user_id, array('size' => 96)) : '',
            'canPublish' => sml_letters_can_publish($user_id),
            'searchEndpoint' => esc_url_raw(rest_url('sml-members/v1/ticker-search')),
            'chartEndpoint' => esc_url_raw(rest_url('sml-trading-floor/v1/chart')),
            'trendingEndpoint' => esc_url_raw(rest_url('sml-members/v1/trending-tickers')),
            'uploadEndpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/upload')),
            'loginUrl' => esc_url_raw(add_query_arg('redirect_to', rawurlencode(home_url('/loop-letters/')), home_url('/sign-up-sign-in/'))),
            'creatorStudioUrl' => esc_url_raw(home_url('/creator-studio/')),
            'lettersUrl' => esc_url_raw(home_url('/loop-letters/')),
        );
    }
}

if (!function_exists('sml_letters_editor_styles')) {
    function sml_letters_editor_styles() {
        return <<<'SMLLECSS'
.le-body{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:20px;padding:22px 26px 60px;align-items:start}
.le-main{min-width:0}
.le-side{display:flex;flex-direction:column;gap:16px;position:sticky;top:88px}

.cs-hint{font-size:12.5px;color:#8798ac;line-height:1.65}
.cs-hint b{color:#c2cede}
a.cs-btn{text-decoration:none}
.cs-btn[disabled]{opacity:.45;cursor:not-allowed}

.le-list{display:flex;flex-direction:column;gap:10px}
.le-item{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:12px;
    border:1px solid #182130;background:#0b131f;cursor:pointer;text-align:left;width:100%;color:inherit}
.le-item:hover{border-color:#2b6cff;background:#0e1726}
.le-item-main{flex:1;min-width:0}
.le-item b{display:block;font-size:14.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.le-item small{display:block;font-size:12px;color:#8798ac;margin-top:3px}
.le-kill{flex:0 0 auto;height:28px;padding:0 11px;border-radius:7px;border:1px solid #2a1620;
    background:#180f14;color:#ff8a9b;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
.le-kill:hover{border-color:#ff566e;color:#fff;background:#2a1620}
.le-empty{padding:34px;text-align:center;font-size:13.5px;color:#5d7189;
    border:1px dashed #1e2a3a;border-radius:12px}
.le-pill{font-size:11px;font-weight:800;letter-spacing:.5px;padding:3px 9px;border-radius:999px;flex:0 0 auto}
.le-pill.draft{background:#1a2534;color:#8798ac}
.le-pill.published{background:rgba(34,217,122,.14);color:#22d97a}
.le-pill.scheduled{background:rgba(224,163,54,.14);color:#e0a336}
.le-pill.archived{background:#151d29;color:#5d7189}
.le-pill.paid{background:rgba(224,163,54,.14);color:#e0a336}

.le-title-input{width:100%;background:none;border:0;color:#e6edf5;font-size:30px;font-weight:800;
    letter-spacing:-.6px;padding:6px 0;font-family:inherit;line-height:1.25}
.le-title-input:focus{outline:none}
.le-sub-input{width:100%;background:none;border:0;color:#8798ac;font-size:16px;padding:4px 0;font-family:inherit}
.le-sub-input:focus{outline:none}

.le-blocks{display:flex;flex-direction:column;gap:6px;margin-top:18px}
.le-block{position:relative;border:1px solid transparent;border-radius:10px;padding:8px 10px 8px 34px}
.le-block:hover{border-color:#182130;background:#0a111c}
.le-block.is-active{border-color:#223146}
.le-handle{position:absolute;left:6px;top:10px;display:flex;flex-direction:column;gap:3px;opacity:0;transition:opacity .12s}
.le-block:hover .le-handle{opacity:1}
.le-handle button{width:20px;height:18px;border-radius:5px;background:#111c2b;border:1px solid #223146;
    color:#7b8ca1;font-size:11px;line-height:1;cursor:pointer;display:grid;place-items:center;padding:0}
.le-handle button:hover{color:#fff;background:#1a2839}
.le-text{width:100%;background:none;border:0;color:#e6edf5;font-size:16.5px;line-height:1.75;
    font-family:inherit;resize:none;overflow:hidden;padding:2px 0}
.le-text:focus{outline:none}
.le-text.h2{font-size:23px;font-weight:700;letter-spacing:-.3px}
.le-text.h3{font-size:19px;font-weight:700}
.le-text.quote{border-left:3px solid #2b6cff;padding-left:14px;color:#c2cede;font-style:italic}
.le-text::placeholder{color:#41546b}

.le-special{border:1px solid #1e2a3a;border-radius:10px;background:#0d1622;padding:13px 14px}
.le-special-head{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:800;
    letter-spacing:.7px;color:#63a4ff;margin-bottom:10px}
.le-code-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.le-code-grid label{display:block;margin-bottom:6px;color:#a9b8ca;font-size:11px;font-weight:800;letter-spacing:.7px}
.le-code{display:block;width:100%;min-height:260px;resize:vertical;border:1px solid #223146;border-radius:9px;
    background:#060b12;color:#bfe1ff;padding:13px 14px;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:2}
.le-code:focus{outline:none;border-color:#2b6cff;box-shadow:0 0 0 3px rgba(43,108,255,.12)}
.le-code-controls{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:12px 0 10px;
    color:#71859b;font-size:11.5px;line-height:1.5}
.le-code-controls label{display:flex;align-items:center;gap:7px;color:#a9b8ca;font-weight:700;white-space:nowrap}
.le-code-controls .le-in{width:92px}
.le-code-preview{display:block;width:100%;height:420px;border:1px solid #223146;border-radius:10px;background:#071019}
.le-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}
.le-grid label{display:block;font-size:11px;color:#8798ac;margin-bottom:4px}
.le-in{width:100%;background:#0a1018;border:1px solid #1e2a3a;border-radius:7px;color:#e6edf5;
    padding:8px 10px;font-size:13px;font-family:inherit}
.le-in:focus{outline:none;border-color:#2b6cff}
.le-paywall{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:10px;
    border:1px dashed #e0a336;background:rgba(224,163,54,.06);color:#e0a336;font-size:12.5px;font-weight:700;
    letter-spacing:.5px}
.le-paywall::before,.le-paywall::after{content:'';flex:1;height:1px;background:rgba(224,163,54,.4)}

.le-add{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px;padding-top:14px;border-top:1px solid #16202e}
.le-add button{height:32px;padding:0 12px;border-radius:8px;border:1px solid #223146;background:#0d1622;
    color:#c2cede;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit}
.le-add button:hover{border-color:#2b6cff;color:#fff}

.le-card{background:#0b131f;border:1px solid #182130;border-radius:14px;padding:16px}
.le-card h4{margin:0 0 12px;font-size:14px;font-weight:700}
.le-settings-section{margin-top:20px;padding-top:18px;border-top:1px solid #16202e}
.le-settings-section h3{margin:0 0 10px;font-size:17px;letter-spacing:-.2px;color:#e6edf5}
.le-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.le-settings-grid .wide{grid-column:1/-1}
.le-settings-field label{display:block;font-size:12px;color:#a9b8ca;margin-bottom:7px;font-weight:700}
.le-settings-field input,.le-settings-field textarea,.le-settings-field select{width:100%;box-sizing:border-box;background:#0a1018;
    border:1px solid #1e2a3a;border-radius:9px;color:#e6edf5;padding:10px 12px;font:13px/1.5 inherit}
.le-settings-field textarea{min-height:92px;resize:vertical}
.le-settings-field input:focus,.le-settings-field textarea:focus,.le-settings-field select:focus{outline:none;border-color:#2b6cff}
.le-settings-field input[type="file"]{padding:9px;background:#080e16;color:#a9b8ca}
.le-settings-field .cs-btn{margin-top:10px}
.le-check{display:flex;align-items:center;gap:10px;min-height:42px;padding:10px 12px;border:1px solid #1e2a3a;border-radius:9px;background:#0a1018;
    color:#dbe6f2;font-size:13px;font-weight:700}
.le-check input{width:auto;accent-color:#22d97a}
.le-report-list{display:grid;gap:8px}
.le-report-list div{display:flex;justify-content:space-between;gap:12px;padding:9px 11px;border:1px solid #1e2a3a;border-radius:8px;background:#0a1018;
    color:#c2cede;font-size:12.5px}
.le-report-list span{color:#22d97a;font-weight:800;text-transform:capitalize}
.le-report-list em{display:block;color:#8798ac;font-style:normal;padding:10px 0}
.le-status{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #16202e;font-size:12.5px}
.le-status:last-child{border-bottom:0}.le-status span{color:#8798ac}.le-status b.ok{color:#22d97a}.le-status b.off{color:#e0a336}
.le-field{margin-bottom:13px}
.le-field label{display:block;font-size:12px;color:#a9b8ca;margin-bottom:6px;font-weight:600}
.le-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.le-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 6px 0 10px;border-radius:7px;
    background:#152234;border:1px solid #223146;font-size:12.5px;font-weight:700}
.le-chip button{background:none;border:0;color:#7b8ca1;cursor:pointer;font-size:14px;line-height:1;padding:0}
.le-chip.primary{border-color:#22d97a;color:#22d97a}
.le-vis{display:grid;gap:6px}
.le-vis button{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:9px;
    border:1px solid #1e2a3a;background:#0d1622;color:#dbe6f2;font-size:13px;cursor:pointer;
    text-align:left;font-family:inherit}
.le-vis button.on{border-color:#22d97a;background:rgba(34,217,122,.08);color:#22d97a}
.le-issues{margin-top:10px;padding:11px 13px;border-radius:9px;background:rgba(255,86,110,.09);
    border:1px solid rgba(255,86,110,.28);color:#ffb3bd;font-size:12.5px;line-height:1.6}
.le-ok{background:rgba(34,217,122,.09);border-color:rgba(34,217,122,.28);color:#7ee8ae}
.le-ac{position:absolute;z-index:40;background:#0e1826;border:1px solid #223146;border-radius:9px;
    min-width:220px;max-height:230px;overflow-y:auto;box-shadow:0 18px 50px rgba(0,0,0,.55)}
.le-ac button{display:block;width:100%;text-align:left;padding:9px 12px;background:none;border:0;
    color:#dbe6f2;font-size:13px;cursor:pointer;font-family:inherit}
.le-ac button:hover,.le-ac button.sel{background:#17243a}
.le-ac b{color:#63a4ff}

@media (max-width:1100px){ .le-body{grid-template-columns:minmax(0,1fr)} .le-side{position:static} }
@media (max-width:680px){ .le-settings-grid,.le-code-grid{grid-template-columns:1fr}.le-settings-grid .wide{grid-column:auto}.le-code-controls{align-items:flex-start;flex-direction:column}.le-code{min-height:220px}.le-code-preview{height:360px} }
SMLLECSS;
    }
}
