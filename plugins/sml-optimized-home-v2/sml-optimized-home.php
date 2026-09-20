<?php
if (!function_exists('sml_oh_is_home')) {
/**
 * Plugin Name: StockMarketLoop Optimized Home
 * Description: Lightweight, server-rendered public live feed with signed-in upgrades.
 * Version: 1.4.4
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
    if (is_admin() || wp_doing_ajax() || is_preview()) { return false; }
    $path = trim((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH), '/');
    return $path === '';
}

function sml_oh_auth_url($redirect = '') {
    $url = home_url('/sign-up-sign-in/');
    if ($redirect !== '') {
        $url = add_query_arg('redirect_to', rawurlencode($redirect), $url);
    }
    return $url;
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
    $is_logged_in = is_user_logged_in();
    $user = wp_get_current_user();
    $avatar = $is_logged_in ? get_avatar_url($user->ID, array('size' => 96)) : '';
    // The payload builder runs 50-150 uncached queries (audited 2026-08-29), so
    // repeat views within 30s reuse a per-user copy. Per-user keying keeps
    // viewerLiked/score personalization correct; the generation counter busts
    // every copy the moment anything is deleted. Kill: sml_oh_plcache_off=1.
    $payload = array();
    if (function_exists('sml_sth_feed_payload')) {
        $payload_key = get_option('sml_oh_plcache_off') ? '' : 'sml_oh_pl_' . absint($user->ID) . '_' . sml_oh_feed_gen();
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
            'loggedIn' => $is_logged_in,
            'name'   => $is_logged_in ? sanitize_text_field( (string) ( $user->display_name ?: $user->user_login ) ) : 'Sign In',
            'avatar' => esc_url_raw( (string) $avatar ),
            'authUrl' => esc_url_raw( sml_oh_auth_url( home_url( '/' ) ) ),
        ),
        'watchlist' => $source_watchlist,
        'groups'    => $source_groups,
        'publicDiscovery' => array(
            'watch'        => esc_url_raw( home_url( '/watch/' ) ),
            'live'         => esc_url_raw( home_url( '/live/' ) ),
            'channels'     => esc_url_raw( home_url( '/channels/' ) ),
            'letters'      => esc_url_raw( home_url( '/n/' ) ),
            'qa'           => esc_url_raw( home_url( '/q/' ) ),
            'tickerTerminal' => esc_url_raw( home_url( '/stock-chart/' ) ),
        ),
        'lockedActions' => array(
            'post'          => esc_url_raw( sml_oh_auth_url( home_url( '/?compose=1' ) ) ),
            'loopKick'      => esc_url_raw( sml_oh_auth_url( home_url( '/' ) ) ),
            'uploadVideo'   => esc_url_raw( sml_oh_auth_url( home_url( '/upload-video/' ) ) ),
            'goLive'        => esc_url_raw( sml_oh_auth_url( home_url( '/go-live/' ) ) ),
            'writeLetter'   => esc_url_raw( sml_oh_auth_url( home_url( '/creator-studio/loop-letters/write/' ) ) ),
            'createChannel' => esc_url_raw( sml_oh_auth_url( home_url( '/create-channel/' ) ) ),
        ),
    );
    echo '<script type="application/json" id="sml-oh-data">' . wp_json_encode( $source_data ) . '</script>';
    echo '<div id="sml-optimized-home" data-sml-feed-source="1"><style>
html{overflow:hidden!important}#sml-optimized-home{color:#eaf7f1;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}#sml-optimized-home *{box-sizing:border-box}.oh-grid{display:block}.oh-card{border:1px solid rgba(107,255,177,.18);background:linear-gradient(180deg,#081813,#030c0a);border-radius:12px;padding:14px;margin-bottom:12px;box-shadow:0 14px 34px rgba(0,0,0,.22)}#sml-optimized-home .oh-post{position:relative;isolation:isolate;overflow:hidden}#sml-optimized-home .oh-post>*{position:relative;z-index:1}#sml-optimized-home .oh-post.sml-no-featured-image:after,#sml-optimized-home .oh-post[data-hfe-has-featured="0"]:after{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;opacity:.28;background:radial-gradient(circle at 78% 68%,rgba(255,45,76,.22),transparent 34%),linear-gradient(115deg,transparent 0 28%,rgba(255,54,90,.22) 28% 29%,transparent 29% 38%,rgba(255,54,90,.16) 38% 39%,transparent 39% 100%),linear-gradient(18deg,transparent 0 42%,rgba(255,54,90,.20) 42% 43%,transparent 43% 58%,rgba(255,54,90,.13) 58% 59%,transparent 59% 100%);background-repeat:no-repeat;background-size:100% 100%,100% 100%,100% 100%;background-position:center}#sml-optimized-home .oh-post.sml-has-featured-image:after,#sml-optimized-home .oh-post[data-hfe-has-featured="1"]:after{content:none!important;display:none!important}#sml-optimized-home .oh-post.sml-has-featured-image>.sml-signal-watermark,#sml-optimized-home .oh-post[data-hfe-has-featured="1"]>.sml-signal-watermark{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}.oh-post h2{font-size:18px;margin:0 0 8px}.oh-post h2 a{color:#eaf7f1;text-decoration:none}.oh-post p{color:#b7cbc4;line-height:1.55;margin:0}.oh-post img{width:100%;max-height:260px;object-fit:cover;border-radius:9px;margin-top:10px}.oh-meta{font-size:12px;color:#86a097;margin-bottom:7px}
    .oh-post-author{display:flex;align-items:center;gap:10px;margin-bottom:8px;color:#eaf7f1;text-decoration:none}.oh-post-author-text{display:flex;align-items:baseline;gap:7px;min-width:0;flex-wrap:wrap}.oh-post img.oh-post-avatar{width:42px!important;height:42px!important;max-height:42px!important;flex:0 0 42px;border-radius:50%!important;object-fit:cover;margin:0!important;border:2px solid rgba(52,255,137,.7);background:#071611}.oh-post-author-name{display:inline;font-size:14px;font-weight:800;color:#eaf7f1}.oh-post-date,.sml-feed-time-badge{display:inline-flex!important;align-items:center!important;font-family:"IBM Plex Mono",monospace!important;font-size:10px!important;font-weight:700!important;color:#a9b8c7!important;line-height:1.2!important;opacity:1!important;visibility:visible!important;white-space:nowrap!important}.oh-post-date:before,.sml-feed-time-badge:before{content:"·";margin-right:7px;color:#38f58a}.oh-meta{display:none!important}
    </style>';
    /* The homepage is a custom standalone render: it never runs wp_head, so it had no H1 at all (Bing SEO report,
       2026-09-19). Visually hidden on purpose - the design has no headline slot. */
    echo '<style>.sml-oh-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}</style>';
    echo '<div class="oh-grid"><main><h1 class="sml-oh-sr-only">Live Stock Market News and Market Feed</h1>';
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
        $comment_id = 0;
        if (preg_match('/^wp-(\d+)$/', $item_id, $post_match)) { $post_id = absint($post_match[1]); }
        elseif (preg_match('/^stream-(\d+)$/', $item_id, $comment_match)) { $comment_id = absint($comment_match[1]); }
        $timestamp_iso = '';
        if ($post_id) {
            $timestamp_unix = (int) get_post_time('U', false, $post_id);
            if ($timestamp_unix) {
                $timestamp_iso = get_post_time('c', false, $post_id);
                $date = wp_date('M j, Y, g:i A', $timestamp_unix);
            }
        } elseif ($comment_id) {
            $comment = get_comment($comment_id);
            if ($comment) {
                $timestamp_unix = (int) mysql2date('U', $comment->comment_date);
                if ($timestamp_unix) {
                    $timestamp_iso = mysql2date('c', $comment->comment_date);
                    $date = wp_date('M j, Y, g:i A', $timestamp_unix);
                }
            }
        } elseif ($date !== '') {
            $timestamp_unix = (int) strtotime($date);
            if ($timestamp_unix) {
                $timestamp_iso = wp_date('c', $timestamp_unix);
                $date = wp_date('M j, Y, g:i A', $timestamp_unix);
            }
        }
        $is_signal = $post_id && get_post_meta($post_id, '_sml_signal_key', true);
        $signal_ticker = $is_signal ? strtoupper(preg_replace('/[^A-Z0-9.\-]/', '', (string) get_post_meta($post_id, '_sml_primary_ticker', true))) : '';
        if ($is_signal) {
            $author_name = 'Stock Market Loop Signal News';
            $author_url = home_url('/markets/');
            $author_avatar = 'https://stockmarketloop.com/wp-content/uploads/2026/08/Untitled-design-90.png';
        }
        $official_names = array('sml news','stock market loop signal news','stock market beginners','retail trader spotlight','options flow','gamma & volatility','earnings desk','filings & actions','analyst & valuation','institutional ledger','insider activity','short interest','macro & policy','semiconductors & ai','biotech & healthcare','energy & commodities','banks & financials','consumer & retail','small-cap risk');
        $is_official_author = $is_signal || in_array(strtolower($author_name), $official_names, true);
        $is_giftable = (!$is_official_author && $author_id > 0 && get_current_user_id() !== $author_id);
        $metrics = is_array($post['metrics'] ?? null) ? $post['metrics'] : array();
        $featured_image_allowed_author_ids = array(258456587, 258456543, 258456596, 258456597);
        $has_featured_image = ($image && preg_match('#^https?://#i', $image) && in_array((int) $author_id, $featured_image_allowed_author_ids, true));
        if (!$has_featured_image) { $image = ''; }
        $card_class = 'oh-card oh-post sml-sth-post' . ($is_signal ? ' sml-signal-feed-post' : '') . ($has_featured_image ? ' sml-has-featured-image' : ' sml-no-featured-image');
        echo '<article class="' . esc_attr($card_class) . '" data-hfe-item="' . esc_attr($item_id) . '" data-hfe-url="' . esc_url($url) . '" data-hfe-recipient-id="' . esc_attr((string) $author_id) . '" data-hfe-giftable="' . ($is_giftable ? '1' : '0') . '" data-hfe-has-featured="' . ($has_featured_image ? '1' : '0') . '"' . ($date !== '' ? ' data-sml-display-time="' . esc_attr($date) . '"' : '') . ($timestamp_iso !== '' ? ' data-sml-display-time-iso="' . esc_attr($timestamp_iso) . '"' : '') . ($is_official_author ? ' data-hfe-official-author="1"' : '') . ($post_id ? ' data-sml-news-item="1" data-sml-published="' . esc_attr($timestamp_iso ?: $date) . '"' : '') . ($signal_ticker !== '' ? ' data-sml-ticker="' . esc_attr($signal_ticker) . '"' : '') . '><a class="oh-post-author" data-sml-user-id="' . esc_attr((string) $author_id) . '" href="' . esc_url($author_url) . '"><img class="oh-post-avatar" src="' . esc_url($author_avatar) . '" alt="' . esc_attr($author_name) . '"><span class="oh-post-author-text"><span class="oh-post-author-name">' . esc_html($author_name) . '</span>' . ($date !== '' ? '<time class="oh-post-date" datetime="' . esc_attr($timestamp_iso) . '">' . esc_html($date) . '</time>' : '') . '</span></a>';
        echo '<div class="oh-meta">' . esc_html($author_name . ($date !== '' ? ' · ' . $date : '')) . '</div><h2><a href="' . esc_url($url) . '">' . esc_html($title) . '</a></h2><p>' . esc_html($body) . '</p>';
        if ($has_featured_image) { echo '<a href="' . esc_url($url) . '"><img loading="lazy" src="' . esc_url($image) . '" alt="' . esc_attr($title) . '"></a>'; }
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
    echo '<style id="sml-signal-watermark-clamp">
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post{min-height:0!important;padding-bottom:18px!important;overflow:hidden!important;isolation:isolate!important}
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post:after{z-index:0!important;opacity:.50!important;background:linear-gradient(90deg,rgba(3,10,17,.99) 0%,rgba(3,10,17,.90) 40%,rgba(3,10,17,.48) 76%,rgba(3,10,17,.70) 100%)!important}
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post>*:not(.sml-signal-watermark){position:relative!important;z-index:5!important}
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post .sml-signal-watermark{inset:0!important;height:100%!important;z-index:1!important;opacity:.42!important;border-radius:18px!important;overflow:hidden!important;background:linear-gradient(90deg,rgba(53,242,139,.06) 0%,rgba(53,242,139,.13) 48%,rgba(53,242,139,.20) 100%)!important}
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post.is-signal-down .sml-signal-watermark{background:linear-gradient(90deg,rgba(255,83,101,.06) 0%,rgba(255,83,101,.13) 48%,rgba(255,83,101,.20) 100%)!important}
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post .sml-signal-watermark svg{left:0!important;right:0!important;bottom:0!important;width:100%!important;height:100%!important;opacity:.36!important;filter:drop-shadow(0 0 4px currentColor)!important}
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post .sml-signal-watermark b{left:8px!important;right:auto!important;top:auto!important;bottom:6px!important;max-width:46%!important;overflow:hidden!important;white-space:nowrap!important;text-overflow:ellipsis!important;padding:2px 7px!important;border-radius:6px!important;background:rgba(3,10,17,.86)!important;font-size:8px!important;line-height:1.15!important}
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post .sml-sth-actions,#sml-hf-shell #sml-optimized-home .sml-signal-feed-post .sml-hfe-actions{position:relative!important;z-index:8!important;margin-top:18px!important}
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post h2,#sml-hf-shell #sml-optimized-home .sml-signal-feed-post>p{position:relative!important;z-index:8!important;max-width:760px!important}
    </style>';
    echo '<script data-sml-oh-allow>(function(){var css=document.getElementById("sml-signal-watermark-clamp");function push(){if(css&&css.parentNode!==document.head)document.head.appendChild(css);document.querySelectorAll("#sml-hf-shell #sml-optimized-home .sml-signal-feed-post").forEach(function(c){c.style.isolation="isolate";var w=c.querySelector(".sml-signal-watermark");if(w){w.style.inset="0";w.style.height="100%";w.style.zIndex="1";w.style.opacity=".42";w.style.borderRadius="18px";}var a=c.querySelector(".sml-sth-actions,.sml-hfe-actions");if(a){a.style.position="relative";a.style.zIndex="8";}})}push();setTimeout(push,250);setTimeout(push,900);setTimeout(push,1800);})();</script>';
    echo '<style id="sml-feed-visible-timestamps">
      #sml-hf-shell #sml-optimized-home .oh-post .oh-post-date,
      #sml-hf-shell #sml-optimized-home .oh-post .sml-feed-time-badge{
        display:inline-flex!important;
        align-items:center!important;
        width:auto!important;
        height:auto!important;
        margin-left:0!important;
        color:#b8c6d6!important;
        opacity:1!important;
        visibility:visible!important;
        font:700 10px/1.2 \"IBM Plex Mono\",monospace!important;
        white-space:nowrap!important;
        text-shadow:0 1px 8px rgba(0,0,0,.65)!important;
      }
      #sml-hf-shell #sml-optimized-home .oh-post .oh-post-date:before,
      #sml-hf-shell #sml-optimized-home .oh-post .sml-feed-time-badge:before{
        content:\"·\"!important;
        margin:0 7px 0 0!important;
        color:#38f58a!important;
      }
      #sml-hf-shell #sml-optimized-home .oh-post .oh-post-author-text{
        display:flex!important;
        align-items:baseline!important;
        gap:7px!important;
        flex-wrap:wrap!important;
        min-width:0!important;
      }
    </style>';
    echo '<script data-sml-oh-allow>(function(){function addTimes(){document.querySelectorAll("#sml-hf-shell #sml-optimized-home .oh-post").forEach(function(card){var t=card.getAttribute("data-sml-display-time")||card.getAttribute("data-sml-published")||"";if(!t||card.querySelector(".oh-post-date,.sml-feed-time-badge"))return;var row=card.querySelector(".oh-post-author-text")||card.querySelector(".oh-post-author");if(!row)return;var el=document.createElement("time");el.className="sml-feed-time-badge";el.textContent=t;var iso=card.getAttribute("data-sml-display-time-iso")||card.getAttribute("data-sml-published")||"";if(iso)el.setAttribute("datetime",iso);row.appendChild(el);});}addTimes();setTimeout(addTimes,250);setTimeout(addTimes,900);setTimeout(addTimes,1800);setInterval(addTimes,3000);})();</script>';
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
    /* Meta description + canonical: also missing because wp_head never runs here. While snippets run, WPCode #5827
       (Living Meta Layer) replaces this description in place with its trending text, so the wording below is the
       fallback for the days the snippet cache is down. Open Graph / Twitter tags are deliberately NOT printed here -
       #5827 adds the full set (with the share image) only when the page has no property="og:" tag yet, so printing
       any og:* from this file would switch the richer set off. */
    $home_title = get_bloginfo('name') . ' — Live Market Feed';
    $home_description = 'Follow live stock market news, market data, trader insights, charts, videos, and ticker discussions on Stock Market Loop.';
    echo '<meta name="description" content="' . esc_attr($home_description) . '">';
    /* No canonical on /?focus=... share links: phone share sheets share the canonical instead of the address bar,
       which would turn a shared post into a link to the bare homepage. Those URLs stay as they were. */
    if (empty($_GET['focus'])) { echo '<link rel="canonical" href="' . esc_url(home_url('/')) . '">'; }
    echo '<title>' . esc_html($home_title) . '</title>';
    echo '</head><body>';
    sml_oh_render();
    // Fail-safe: this standalone response bypasses wp_head/wp_footer, so it
    // must load its own modern controller. The controller has a global guard,
    // making the older WPCode injection path safe when it also runs.
    $home_ref = function_exists('sml_cdn_resolve_ref') ? sml_cdn_resolve_ref() : 'ae2672352eec2b4f10dfdd94c6ef02ae5e00a3d8';
    $home_js = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode($home_ref) . '/js/home-feed.js';
    echo '<script data-sml-oh-allow src="' . esc_url($home_js) . '"></script>';
    if (!is_user_logged_in()) {
        $guest_auth = esc_url_raw(sml_oh_auth_url(home_url('/')));
        echo '<style id="sml-oh-guest-public-style">
          #sml-hf-shell #sml-hf-me-top>div,
          #sml-hf-shell #sml-hf-me-card>div,
          #sml-hf-shell .hf-composer>div:first-child{
            background:#fff!important;color:#071611!important;font-size:9px!important;font-weight:1000!important;line-height:1!important;text-align:center!important;
          }
          #sml-hf-shell #sml-hf-me-top>div,
          #sml-hf-shell .hf-composer>div:first-child{font-size:8px!important}
        </style>';
        echo '<script data-sml-oh-allow>(function(){var auth=' . wp_json_encode($guest_auth) . ';function lockLink(el,txt){if(!el)return;if(txt)el.textContent=txt;el.setAttribute("href",auth);el.setAttribute("data-sml-guest-auth","1");}function setAvatarText(el){if(!el)return;var d=el.firstElementChild;if(d&&d.tagName!=="IMG"){d.textContent="Sign\\nIn";d.style.whiteSpace="pre-line";d.style.background="#fff";d.style.color="#071611";d.style.fontWeight="1000";d.style.fontSize=(parseInt(d.style.width,10)>40?"9px":"8px");d.style.lineHeight="1";d.style.textAlign="center";}}function apply(){var shell=document.getElementById("sml-hf-shell");if(!shell)return;setAvatarText(document.getElementById("sml-hf-me-top"));setAvatarText(document.getElementById("sml-hf-me-card"));var card=document.getElementById("sml-hf-me-card");if(card){var label=card.parentElement&&card.parentElement.querySelector("div div div");if(label)label.textContent="Sign In";var status=card.parentElement&&card.parentElement.querySelector("div div div+div");if(status)status.innerHTML="<span style=\\"width:6px;height:6px;border-radius:50%;background:#ffffff\\"></span>Browse free · sign in to engage";}lockLink(document.getElementById("sml-hf-post"),"Sign In");lockLink(shell.querySelector("a[href=\\"/go-live/\\"]"),"Sign In to Go Live");lockLink(shell.querySelector("a[href=\\"/upload-video/\\"]"),"Sign In to Upload");lockLink(shell.querySelector("a[href=\\"/creator-studio/loop-letters/write/\\"]"),"Sign In to Write");var kick=document.getElementById("sml-hf-loop-kick");if(kick){kick.textContent="Sign In";kick.onclick=function(e){e.preventDefault();location.href=auth;};}var edit=document.getElementById("sml-hf-watch-edit");if(edit){edit.textContent="sign in";edit.onclick=function(e){e.preventDefault();e.stopPropagation();location.href=auth;};}var add=document.getElementById("sml-hf-watch-addbtn");if(add){add.onclick=function(e){e.preventDefault();e.stopPropagation();location.href=auth;};}shell.querySelectorAll(".hf-composer input,#sml-hf-watch-inp").forEach(function(i){i.readOnly=true;i.placeholder=i.id==="sml-hf-watch-inp"?"Sign in to save a watchlist":"Sign in to post, create, and engage";i.addEventListener("focus",function(){location.href=auth;},{once:true});});}apply();[150,400,900,1600,3000].forEach(function(t){setTimeout(apply,t);});document.addEventListener("click",function(e){var t=e.target&&e.target.closest&&e.target.closest("#sml-hf-me-top,#sml-hf-me-card,[data-sml-guest-auth]");if(t){e.preventDefault();location.href=auth;}},true);})();</script>';
    }
    echo '<style id="sml-signal-watermark-layer-fix">
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post{
        min-height:0!important;
        padding-bottom:18px!important;
        overflow:hidden!important;
        isolation:isolate!important;
      }
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post:after{
        z-index:0!important;
        opacity:.54!important;
        background:linear-gradient(90deg,rgba(3,10,17,.98) 0%,rgba(3,10,17,.88) 38%,rgba(3,10,17,.42) 72%,rgba(3,10,17,.62) 100%)!important;
      }
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post>*:not(.sml-signal-watermark){
        position:relative!important;
        z-index:3!important;
      }
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post .sml-signal-watermark{
        inset:0!important;
        height:100%!important;
        z-index:1!important;
        opacity:.42!important;
        border-radius:18px!important;
        background:linear-gradient(90deg,rgba(53,242,139,.06) 0%,rgba(53,242,139,.13) 48%,rgba(53,242,139,.20) 100%)!important;
        overflow:hidden!important;
      }
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post.is-signal-down .sml-signal-watermark{
        background:linear-gradient(90deg,rgba(255,83,101,.06) 0%,rgba(255,83,101,.13) 48%,rgba(255,83,101,.20) 100%)!important;
      }
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post .sml-signal-watermark svg{
        left:0!important;
        right:0!important;
        bottom:0!important;
        width:100%!important;
        height:100%!important;
        opacity:.48!important;
      }
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post .sml-signal-watermark b{
        left:10px!important;
        right:auto!important;
        top:auto!important;
        bottom:8px!important;
        max-width:54%!important;
        overflow:hidden!important;
        white-space:nowrap!important;
        text-overflow:ellipsis!important;
        padding:3px 8px!important;
        border-radius:6px!important;
        background:rgba(3,10,17,.82)!important;
        color:inherit!important;
        font-size:9px!important;
        line-height:1.2!important;
      }
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post .sml-sth-actions,
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post .sml-hfe-actions{
        position:relative!important;
        z-index:4!important;
        margin-top:16px!important;
      }
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post h2,
      #sml-hf-shell #sml-optimized-home .sml-signal-feed-post>p{
        position:relative!important;
        z-index:4!important;
        max-width:760px!important;
      }
      @media(max-width:760px){
        #sml-hf-shell #sml-optimized-home .sml-signal-feed-post .sml-signal-watermark{
          inset:0!important;
          height:100%!important;
          opacity:.34!important;
        }
      }
    </style>';
    echo '</body></html>';
    exit;
}
add_action('template_redirect', 'sml_oh_standalone_response', PHP_INT_MAX);
}

