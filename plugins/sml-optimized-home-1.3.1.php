<?php
if (!function_exists('sml_oh_is_home')) {
/**
 * Plugin Name: StockMarketLoop Optimized Home
 * Description: Lightweight, server-rendered signed-in homepage with isolated assets.
 * Version: 1.4.0
 * Author: StockMarketLoop
 */

if (!defined('ABSPATH')) { exit; }

/* Feed-payload cache generation: bumped on any delete so a cached payload can
   never resurrect a removed post. Over-invalidation (revisions etc.) is safe. */
function sml_oh_feed_gen() {
    return absint(get_option('sml_oh_feed_gen', 0));
}
function sml_oh_bump_feed_gen($bump_id = 0, $bump_obj = null) {
    if ($bump_obj instanceof WP_Post && in_array($bump_obj->post_type, array('revision', 'customize_changeset', 'oembed_cache'), true)) { return; }
    update_option('sml_oh_feed_gen', (sml_oh_feed_gen() + 1) % 1000000, false);
}
add_action('deleted_post', 'sml_oh_bump_feed_gen', 10, 2);
add_action('trashed_post', 'sml_oh_bump_feed_gen');
add_action('deleted_comment', 'sml_oh_bump_feed_gen');
add_action('trashed_comment', 'sml_oh_bump_feed_gen');
add_action('spammed_comment', 'sml_oh_bump_feed_gen');
/* creation must bust too, or a member's own just-posted stream item hides ≤30s */
add_action('wp_insert_comment', 'sml_oh_bump_feed_gen');
/* chart cards delete/create by REWRITING sml_profile_chart_posts usermeta —
   no post/comment hook fires, so watch that meta key directly */
function sml_oh_meta_bump_feed_gen($meta_id, $object_id, $meta_key) {
    if ('sml_profile_chart_posts' === $meta_key) { sml_oh_bump_feed_gen(); }
}
add_action('added_user_meta', 'sml_oh_meta_bump_feed_gen', 10, 3);
add_action('updated_user_meta', 'sml_oh_meta_bump_feed_gen', 10, 3);

function sml_oh_is_home() {
    if (is_admin() || wp_doing_ajax() || !is_user_logged_in() || is_preview()) { return false; }
    $path = trim((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH), '/');
    return $path === '';
}

function sml_oh_disable_conflicts() {
    if (!sml_oh_is_home()) { return; }
    global $wordads;
    if (is_object($wordads)) { remove_action('wp', array($wordads, 'init')); }
    add_filter('wordads_content_disable', '__return_true', PHP_INT_MAX);
    add_filter('wordads_excerpt_disable', '__return_true', PHP_INT_MAX);
}
add_action('wp', 'sml_oh_disable_conflicts', 0);

function sml_oh_dequeue() {
    if (!sml_oh_is_home()) { return; }
    global $wp_scripts;
    if (!$wp_scripts) { return; }
    foreach ((array) $wp_scripts->queue as $handle) {
        wp_dequeue_script($handle);
        wp_deregister_script($handle);
    }
}
add_action('wp_print_scripts', 'sml_oh_dequeue', PHP_INT_MAX);
add_action('wp_footer', 'sml_oh_dequeue', 0);

function sml_oh_clean_output($html) {
    if (!is_string($html)) { return $html; }
    $allowed = array();
    $html = preg_replace_callback('~<(script|iframe)\b[^>]*(?:data-sml-oh-allow|id=["\x27]sml-loop-popup-frame["\x27])[^>]*>.*?</\1>~is', function($match) use (&$allowed) {
        $key = '%%SML_OH_ALLOWED_' . count($allowed) . '%%';
        $allowed[$key] = $match[0];
        return $key;
    }, $html);
    $html = preg_replace('~<script\b[^>]*>.*?</script>~is', '', $html);
    $html = preg_replace('~<iframe\b[^>]*>.*?</iframe>~is', '', $html);
    return strtr($html, $allowed);
}
function sml_oh_start_buffer() {
    if (sml_oh_is_home()) { ob_start('sml_oh_clean_output'); }
}
add_action('template_redirect', 'sml_oh_start_buffer', 0);

function sml_oh_render() {
    if (!sml_oh_is_home() || !empty($GLOBALS['sml_oh_rendered'])) { return; }
    $GLOBALS['sml_oh_rendered'] = true;
    $user = wp_get_current_user();
    $avatar = get_avatar_url($user->ID, array('size' => 96));
    // The payload builder runs 50-150 uncached queries (audited 2026-08-29), so
    // repeat views within 30s reuse a per-user copy. Per-user keying keeps
    // viewerLiked/score personalization correct; the generation counter busts
    // every copy the moment anything is deleted. Kill: sml_oh_plcache_off=1.
    $payload = array();
    if (function_exists('sml_sth_feed_payload')) {
        $payload_key = get_option('sml_oh_plcache_off') ? '' : 'sml_oh_pl_' . $user->ID . '_' . sml_oh_feed_gen();
        if ($payload_key) {
            $payload_cached = get_transient($payload_key);
            if (is_array($payload_cached) && $payload_cached) { $payload = $payload_cached; }
        }
        if (!$payload) {
            $payload = (array) sml_sth_feed_payload();
            /* cap well above the 18-card render (plus dedup/48h attrition) so the
               serialized transient stays far under memcached's 1MB per-key limit */
            if (is_array($payload['feed'] ?? null) && count($payload['feed']) > 60) { $payload['feed'] = array_slice($payload['feed'], 0, 60); }
            if ($payload_key && $payload) { set_transient($payload_key, $payload, 30); }
        }
    }
    // Bulk-prime the lookups the loops below repeat per item (posts+meta for the
    // 48h date checks and signal meta, stream comments, then author rows+meta) —
    // behavior-identical, collapses the per-card N+1 into a few grouped queries.
    $prime_post_ids = array();
    $prime_comment_ids = array();
    foreach ((array) ($payload['feed'] ?? array()) as $prime_item) {
        if (!is_array($prime_item)) { continue; }
        $prime_id = (string) ($prime_item['id'] ?? '');
        if (preg_match('/^wp-(\d+)$/', $prime_id, $prime_m)) { $prime_post_ids[] = absint($prime_m[1]); }
        elseif (preg_match('/^stream-(\d+)$/', $prime_id, $prime_m)) { $prime_comment_ids[] = absint($prime_m[1]); }
    }
    if ($prime_post_ids && function_exists('_prime_post_caches')) { _prime_post_caches($prime_post_ids, false, true); }
    if ($prime_comment_ids) { get_comments(array('comment__in' => $prime_comment_ids, 'number' => count($prime_comment_ids))); }
    $prime_author_ids = array();
    foreach ((array) ($payload['feed'] ?? array()) as $prime_item) {
        if (!is_array($prime_item)) { continue; }
        $prime_id = (string) ($prime_item['id'] ?? '');
        $prime_aid = 0;
        if (preg_match('/^wp-(\d+)$/', $prime_id, $prime_m)) { $prime_aid = absint(get_post_field('post_author', absint($prime_m[1]))); }
        elseif (preg_match('/^chart-(\d+)-/', $prime_id, $prime_m)) { $prime_aid = absint($prime_m[1]); }
        elseif (preg_match('/^stream-(\d+)$/', $prime_id, $prime_m)) { $prime_c = get_comment(absint($prime_m[1])); $prime_aid = $prime_c ? absint($prime_c->user_id) : 0; }
        if ($prime_aid) { $prime_author_ids[$prime_aid] = 1; }
    }
    if ($prime_author_ids && function_exists('cache_users')) { cache_users(array_keys($prime_author_ids)); }
    // Feed contract: an article is eligible for 48 hours only, and every
    // underlying feed item may render once. Community activity remains
    // available, but duplicate payload rows and stale WordPress news do not.
    $posts = array();
    $seen_feed_items = array();
    $news_cutoff = time() - (48 * HOUR_IN_SECONDS);
    foreach ((array) ($payload['feed'] ?? array()) as $candidate) {
        if (!is_array($candidate)) { continue; }
        $candidate_id = sanitize_text_field((string) ($candidate['id'] ?? ''));
        $candidate_url = esc_url_raw((string) ($candidate['url'] ?? ''));
        $candidate_title = trim(wp_strip_all_tags((string) ($candidate['title'] ?? '')));
        $candidate_date = sanitize_text_field((string) ($candidate['date'] ?? ''));
        $candidate_post_id = 0;
        if (preg_match('/^wp-(\d+)$/', $candidate_id, $candidate_match)) { $candidate_post_id = absint($candidate_match[1]); }
        if ($candidate_post_id) {
            $published = (int) get_post_time('U', true, $candidate_post_id);
            if (!$published && $candidate_date !== '') { $published = (int) strtotime($candidate_date); }
            if (!$published || $published < $news_cutoff) { continue; }
        }
        $candidate_keys = array($candidate_id !== '' ? 'id:' . strtolower($candidate_id) : 'fallback:' . strtolower($candidate_title));
        if ($candidate_post_id && $candidate_url !== '') { $candidate_keys[] = 'url:' . strtolower(untrailingslashit(strtok($candidate_url, '?#'))); }
        $candidate_duplicate = false;
        foreach ($candidate_keys as $candidate_key) { if (isset($seen_feed_items[$candidate_key])) { $candidate_duplicate = true; break; } }
        if ($candidate_duplicate) { continue; }
        foreach ($candidate_keys as $candidate_key) { $seen_feed_items[$candidate_key] = true; }
        $posts[] = $candidate;
        if (count($posts) >= 18) { break; }
    }
    $watchlist = array_slice((array) ($payload['watchlist'] ?? array('SPY', 'QQQ', 'NVDA', 'TSLA')), 0, 8);
    $groups = array_slice((array) ($payload['groups'] ?? array()), 0, 6);

    /* The legacy server shell is now a hidden data source for home-feed.js.
       Never reveal it as a fallback: if the controller is delayed, members see
       this branded loading canvas instead of the retired three-column layout. */
    echo '<style id="sml-oh-source-lock">
    #sml-oh-loading{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:radial-gradient(900px 480px at 50% -120px,rgba(1,167,125,.2),transparent 62%),linear-gradient(180deg,#0d1622,#080d15);color:#e6edf5;font-family:Inter,system-ui,sans-serif}
    #sml-oh-loading>div{display:grid;justify-items:center;gap:14px;padding:28px 34px;border:1px solid rgba(56,245,138,.22);border-radius:18px;background:linear-gradient(168deg,#1a2431,#0c121c);box-shadow:0 28px 70px rgba(0,0,0,.55)}
    #sml-oh-loading b{font-size:18px;color:#38f58a}#sml-oh-loading span{font-size:12px;color:#93a4b8}
    #sml-oh-loading i{width:34px;height:34px;border:3px solid rgba(56,245,138,.18);border-top-color:#38f58a;border-radius:50%;animation:smlOhLoad .75s linear infinite}
    @keyframes smlOhLoad{to{transform:rotate(360deg)}}
    body>#sml-optimized-home{visibility:hidden!important;pointer-events:none!important}
    #sml-hf-shell #sml-optimized-home{visibility:visible!important;pointer-events:auto!important}
    </style><div id="sml-oh-loading" role="status" aria-live="polite"><div><i aria-hidden="true"></i><b>Stock Market Loop</b><span>Loading your live market feed…</span></div></div>';
    $source_watchlist = array();
    foreach ( $watchlist as $source_symbol ) {
        $source_symbol = preg_replace( '/[^A-Z0-9.\-]/', '', strtoupper( ltrim( (string) $source_symbol, '$' ) ) );
        if ( '' !== $source_symbol ) { $source_watchlist[] = $source_symbol; }
    }
    $source_groups = array();
    foreach ( $groups as $source_group ) {
        if ( ! is_array( $source_group ) ) { continue; }
        $source_groups[] = array(
            'name' => sanitize_text_field( (string) ( $source_group['name'] ?? 'Group' ) ),
            'href' => esc_url_raw( (string) ( $source_group['url'] ?? home_url( '/groups/' ) ) ),
            'img'  => esc_url_raw( (string) ( $source_group['image'] ?? $source_group['icon'] ?? '' ) ),
        );
    }
    $source_data = array(
        'viewer' => array(
            'name'   => sanitize_text_field( (string) ( $user->display_name ?: $user->user_login ) ),
            'avatar' => esc_url_raw( (string) $avatar ),
        ),
        'watchlist' => $source_watchlist,
        'groups'    => $source_groups,
    );
    echo '<script type="application/json" id="sml-oh-data">' . wp_json_encode( $source_data ) . '</script>';
    echo '<div id="sml-optimized-home" data-sml-feed-source="1"><style>
    html{overflow:hidden!important}#sml-optimized-home{color:#eaf7f1;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}#sml-optimized-home *{box-sizing:border-box}.oh-grid{display:block}.oh-card{border:1px solid rgba(107,255,177,.18);background:linear-gradient(180deg,#081813,#030c0a);border-radius:12px;padding:14px;margin-bottom:12px;box-shadow:0 14px 34px rgba(0,0,0,.22)}.oh-post h2{font-size:18px;margin:0 0 8px}.oh-post h2 a{color:#eaf7f1;text-decoration:none}.oh-post p{color:#b7cbc4;line-height:1.55;margin:0}.oh-post img{width:100%;max-height:260px;object-fit:cover;border-radius:9px;margin-top:10px}.oh-meta{font-size:12px;color:#86a097;margin-bottom:7px}
    .oh-post-author{display:flex;align-items:center;gap:10px;margin-bottom:10px;color:#eaf7f1;text-decoration:none}.oh-post img.oh-post-avatar{width:42px!important;height:42px!important;max-height:42px!important;flex:0 0 42px;border-radius:50%!important;object-fit:cover;margin:0!important;border:2px solid rgba(52,255,137,.7);background:#071611}.oh-post-author-name{display:block;font-size:14px;font-weight:800;color:#eaf7f1}
    </style>';
    echo '<div class="oh-grid"><main>';
    foreach ($posts as $post) {
        if (!is_array($post)) { continue; }
        $body = wp_html_excerpt(trim(wp_strip_all_tags((string) ($post['body'] ?? ''))), 700, '...');
        $title = trim(wp_strip_all_tags((string) ($post['title'] ?? '')));
        if ($title === '') { $title = wp_trim_words($body, 12, '...'); }
        $url = esc_url_raw((string) ($post['url'] ?? '#'));
        $image = esc_url_raw((string) ($post['image'] ?? ''));
        $author = is_array($post['author'] ?? null) ? $post['author'] : array();
        $author_name = sanitize_text_field((string) ($author['name'] ?? 'StockMarketLoop'));
        $author_id = absint($author['id'] ?? 0);
        $author_url = esc_url_raw((string) ($author['url'] ?? ($author_id ? get_author_posts_url($author_id) : home_url('/creators/'))));
        $author_avatar = esc_url_raw((string) ($author['avatar'] ?? ''));
        if (!$author_avatar && $author_id) { $author_avatar = get_avatar_url($author_id, array('size' => 96)); }
        if (!$author_avatar) { $author_avatar = get_avatar_url(0, array('size' => 96, 'default' => 'mystery')); }
        $date = sanitize_text_field((string) ($post['date'] ?? ''));
        $item_id = sanitize_text_field((string) ($post['id'] ?? ''));
        // Signal News entries are a distinct editorial card type. Mark them
        // server-side from their canonical post meta so the homepage treatment
        // survives live-feed refreshes and automatically applies to new signals.
        $post_id = 0;
        if (preg_match('/^wp-(\d+)$/', $item_id, $post_match)) { $post_id = absint($post_match[1]); }
        $is_signal = $post_id && get_post_meta($post_id, '_sml_signal_key', true);
        $signal_ticker = $is_signal ? strtoupper(preg_replace('/[^A-Z0-9.\-]/', '', (string) get_post_meta($post_id, '_sml_primary_ticker', true))) : '';
        if ($is_signal) {
            $author_name = 'Stock Market Loop Signal News';
            $author_url = home_url('/markets/');
            $author_avatar = 'https://stockmarketloop.com/wp-content/uploads/2026/08/Untitled-design-90.png';
        }
        $metrics = is_array($post['metrics'] ?? null) ? $post['metrics'] : array();
        $card_class = 'oh-card oh-post sml-sth-post' . ($is_signal ? ' sml-signal-feed-post' : '');
        echo '<article class="' . esc_attr($card_class) . '" data-hfe-item="' . esc_attr($item_id) . '" data-hfe-url="' . esc_url($url) . '"' . ($post_id ? ' data-sml-news-item="1" data-sml-published="' . esc_attr($date) . '"' : '') . ($signal_ticker !== '' ? ' data-sml-ticker="' . esc_attr($signal_ticker) . '"' : '') . '><a class="oh-post-author" data-sml-user-id="' . esc_attr((string) $author_id) . '" href="' . esc_url($author_url) . '"><img class="oh-post-avatar" src="' . esc_url($author_avatar) . '" alt="' . esc_attr($author_name) . '"><span class="oh-post-author-name">' . esc_html($author_name) . '</span></a>';
        echo '<div class="oh-meta">' . esc_html($author_name . ($date !== '' ? ' · ' . $date : '')) . '</div><h2><a href="' . esc_url($url) . '">' . esc_html($title) . '</a></h2><p>' . esc_html($body) . '</p>';
        if ($image && preg_match('#^https?://#i', $image)) { echo '<a href="' . esc_url($url) . '"><img loading="lazy" src="' . esc_url($image) . '" alt=""></a>'; }
        echo '<div class="sml-sth-actions"><span>Likes ' . esc_html((string) absint($metrics['likes'] ?? 0)) . '</span> <span>Comments ' . esc_html((string) absint($metrics['comments'] ?? 0)) . '</span> <span>Shares ' . esc_html((string) absint($metrics['shares'] ?? 0)) . '</span> <a href="' . esc_url($url) . '">Open</a></div>';
        echo '</article>';
    }
    if (!$posts) { echo '<section class="oh-card">Your market feed is ready for new posts.</section>'; }
    echo '</main></div></div>';

    // This standalone homepage bypasses wp_head/wp_footer, so explicitly mount
    // the same proven UI modules it previously stripped away.
    if (class_exists('SML_Loop_Entry')) {
        SML_Loop_Entry::launcher();
        SML_Loop_Entry::popup();
        echo '<style>.sml-loop-launcher{z-index:2147483620!important}#sml-loop-popup{z-index:2147483621!important}</style>';
    }
    if (defined('SML_HFE_URL') && function_exists('sml_hfe_script_config')) {
        echo '<link rel="stylesheet" href="' . esc_url(SML_HFE_URL . 'assets/engagement.css?ver=' . SML_HFE_VERSION) . '">';
        echo '<script data-sml-oh-allow>window.SMLHomeFeedEngagement=' . wp_json_encode(sml_hfe_script_config()) . ';</script>';
        echo '<script data-sml-oh-allow src="' . esc_url(SML_HFE_URL . 'assets/engagement.js?ver=' . SML_HFE_VERSION) . '"></script>';
    }
    if (defined('SML_MHC_VERSION')) {
        $mhc_base = plugin_dir_url(WP_PLUGIN_DIR . '/sml-member-hover-cards/sml-member-hover-cards.php') . 'assets/';
        $mhc_config = array(
            'restBase' => esc_url_raw(rest_url('sml/v1/')),
            'loopBase' => esc_url_raw(rest_url('sml-loop/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
            'groupId' => 0,
            'currentUser' => get_current_user_id(),
            'messagesUrl' => class_exists('SML_Loop_Entry') ? SML_Loop_Entry::url() : home_url('/loop-messages/'),
            'messagesMode' => false,
        );
        echo '<link rel="stylesheet" href="' . esc_url($mhc_base . 'member-hover.css?ver=' . SML_MHC_VERSION) . '">';
        echo '<script data-sml-oh-allow>window.SMLMemberHover=' . wp_json_encode($mhc_config) . ';</script>';
        echo '<script data-sml-oh-allow src="' . esc_url($mhc_base . 'member-hover.js?ver=' . SML_MHC_VERSION) . '"></script>';
    }
}
add_action('wp_body_open', 'sml_oh_render', 0);
add_action('wp_footer', 'sml_oh_render', 1);

function sml_oh_standalone_response() {
    if (!sml_oh_is_home()) { return; }
    status_header(200);
    nocache_headers();
    echo '<!doctype html><html ' . get_language_attributes() . '><head>';
    echo '<meta charset="' . esc_attr(get_bloginfo('charset')) . '">';
    echo '<meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<meta name="robots" content="index,follow,max-image-preview:large">';
    echo '<title>' . esc_html(get_bloginfo('name')) . ' — Live Market Feed</title>';
    echo '</head><body>';
    sml_oh_render();
    // Fail-safe: this standalone response bypasses wp_head/wp_footer, so it
    // must load its own modern controller. The controller has a global guard,
    // making the older WPCode injection path safe when it also runs.
    $home_ref = function_exists('sml_cdn_resolve_ref') ? sml_cdn_resolve_ref() : 'ae2672352eec2b4f10dfdd94c6ef02ae5e00a3d8';
    $home_js = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode($home_ref) . '/js/home-feed.js';
    echo '<script data-sml-oh-allow src="' . esc_url($home_js) . '"></script>';
    echo '</body></html>';
    exit;
}
add_action('template_redirect', 'sml_oh_standalone_response', PHP_INT_MAX);
}

