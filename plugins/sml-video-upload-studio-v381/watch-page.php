<?php
/**
 * StockMarketLoop watch page - default layout.
 * Standalone renderer with inline site header, player, info card, tabs and live right rail.
 */

if (!defined('ABSPATH')) {
    exit;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

if (!function_exists('sml_vus_time_ago')) {
    function sml_vus_time_ago($iso) {
        $ts = $iso ? strtotime($iso) : 0;
        if (!$ts) {
            return '';
        }
        $diff = max(0, time() - $ts);
        if ($diff < 60) {
            return 'just now';
        }
        $units = array(
            array(31536000, 'year'),
            array(2592000, 'month'),
            array(604800, 'week'),
            array(86400, 'day'),
            array(3600, 'hour'),
            array(60, 'minute'),
        );
        foreach ($units as $unit) {
            if ($diff >= $unit[0]) {
                $n = (int) floor($diff / $unit[0]);
                return $n . ' ' . $unit[1] . ($n > 1 ? 's' : '') . ' ago';
            }
        }
        return 'just now';
    }
}

if (!function_exists('sml_vus_compact_number')) {
    function sml_vus_compact_number($n) {
        $n = (float) $n;
        if ($n >= 1000000) {
            return rtrim(rtrim(number_format($n / 1000000, 1), '0'), '.') . 'M';
        }
        if ($n >= 1000) {
            return rtrim(rtrim(number_format($n / 1000, 1), '0'), '.') . 'K';
        }
        return (string) (int) $n;
    }
}

if (!function_exists('sml_vus_handle')) {
    function sml_vus_handle($user_id) {
        return sanitize_key((string) get_user_meta((int) $user_id, 'sml_channel_handle', true));
    }
}

if (!function_exists('sml_vus_creator_identity')) {
    function sml_vus_creator_identity($user_id) {
        if (function_exists('sml_video_upload_studio_creator_identity')) {
            return sml_video_upload_studio_creator_identity($user_id);
        }
        $user_id = absint($user_id);
        $name = $user_id ? trim((string) get_user_meta($user_id, 'sml_channel_name', true)) : '';
        $handle = sml_vus_handle($user_id);
        $avatar_id = $user_id ? absint(get_user_meta($user_id, 'sml_channel_avatar_id', true)) : 0;
        $avatar = $avatar_id ? wp_get_attachment_image_url($avatar_id, 'thumbnail') : '';
        return array(
            'name' => '' !== $name ? $name : 'Creator',
            'handle' => $handle,
            'avatar' => $avatar ? esc_url_raw($avatar) : '',
            'url' => $handle ? esc_url_raw(home_url('/channel/' . rawurlencode($handle) . '/')) : '',
        );
    }
}

if (!function_exists('sml_vus_duration_label')) {
    function sml_vus_duration_label($seconds) {
        $seconds = (int) $seconds;
        if ($seconds <= 0) {
            return '';
        }
        $h = (int) floor($seconds / 3600);
        $m = (int) floor(($seconds % 3600) / 60);
        $s = $seconds % 60;
        if ($h) {
            return sprintf('%d:%02d:%02d', $h, $m, $s);
        }
        return sprintf('%d:%02d', $m, $s);
    }
}

if (!function_exists('sml_vus_card')) {
    /** Shape a library row into the compact card the rail renders. */
    function sml_vus_card($video) {
        $author_id = (int) ($video['author_id'] ?? 0);
        $identity = sml_vus_creator_identity($author_id);
        return array(
            'id' => $video['id'] ?? '',
            'title' => $video['title'] ?? '',
            'watch_url' => $video['watch_url'] ?? '',
            'thumbnail' => $video['thumbnail_url'] ?: sml_video_upload_studio_default_thumb(),
            'creator' => $identity['name'],
            'handle' => $identity['handle'],
            'profile_url' => $identity['url'],
            'avatar' => $identity['avatar'],
            'verified' => (bool) user_can($author_id, 'edit_posts'),
            'ticker' => $video['ticker'] ?? '',
            'views' => (int) ($video['views'] ?? 0),
            'views_label' => sml_vus_compact_number((int) ($video['views'] ?? 0)) . ' views',
            'ago' => sml_vus_time_ago($video['created_at'] ?? ''),
            'duration' => sml_vus_duration_label($video['duration'] ?? 0),
        );
    }
}

if (!function_exists('sml_vus_visible_videos')) {
    /** Public + unlisted rows the current viewer is allowed to see, newest first. */
    function sml_vus_visible_videos($exclude_id = '') {
        $library = sml_video_upload_studio_library();
        $viewer = get_current_user_id();
        $rows = array();
        foreach ($library as $id => $video) {
            if (!is_array($video) || $id === $exclude_id) {
                continue;
            }
            $visibility = $video['visibility'] ?? 'public';
            if ($visibility === 'private' && (int) ($video['author_id'] ?? 0) !== (int) $viewer) {
                continue;
            }
            if (in_array($visibility, array('members', 'premium'), true)
                && (!function_exists('sml_gl_user_has_content_access')
                    || !sml_gl_user_has_content_access($viewer, (int) ($video['author_id'] ?? 0)))) {
                continue;
            }
            if ($visibility === 'scheduled') {
                continue;
            }
            $rows[] = $video;
        }
        usort($rows, function ($a, $b) {
            return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
        });
        return $rows;
    }
}

if (!function_exists('sml_vus_engagement')) {
    function sml_vus_engagement($video) {
        $viewer = get_current_user_id();
        $likes = (array) ($video['likes'] ?? array());
        $dislikes = (array) ($video['dislikes'] ?? array());
        $saves = (array) ($video['saves'] ?? array());
        return array(
            'views' => (int) ($video['views'] ?? 0),
            'likes' => count($likes),
            'dislikes' => count($dislikes),
            'comments' => count((array) ($video['comments'] ?? array())),
            'liked' => $viewer && in_array($viewer, array_map('intval', $likes), true),
            'disliked' => $viewer && in_array($viewer, array_map('intval', $dislikes), true),
            'saved' => $viewer && in_array($viewer, array_map('intval', $saves), true),
        );
    }
}

if (!function_exists('sml_vus_comment_list')) {
    function sml_vus_comment_list($video) {
        $out = array();
        foreach ((array) ($video['comments'] ?? array()) as $comment) {
            if (!is_array($comment)) {
                continue;
            }
            $out[] = array(
                'id' => $comment['id'] ?? '',
                'name' => $comment['name'] ?? 'Member',
                'handle' => $comment['handle'] ?? '',
                'avatar' => $comment['avatar'] ?? '',
                'text' => $comment['text'] ?? '',
                'ago' => sml_vus_time_ago($comment['created_at'] ?? ''),
            );
        }
        return array_reverse($out);
    }
}

/* ------------------------------------------------------------------ */
/* REST: rail, engagement, comments                                    */
/* ------------------------------------------------------------------ */

if (!function_exists('sml_vus_rest_rail')) {
    function sml_vus_rest_rail(WP_REST_Request $request) {
        $video_id = sanitize_key((string) $request->get_param('video_id'));
        $ticker = strtoupper(preg_replace('/[^A-Z]/', '', (string) $request->get_param('ticker')));
        $rows = sml_vus_visible_videos($video_id);

        $up_next = array();
        $related = array();
        foreach ($rows as $video) {
            $card = sml_vus_card($video);
            if ($ticker && strtoupper((string) ($video['ticker'] ?? '')) === $ticker) {
                if (count($related) < 6) {
                    $related[] = $card;
                }
                continue;
            }
            if (count($up_next) < 8) {
                $up_next[] = $card;
            }
        }

        return array(
            'up_next' => $up_next,
            'related' => $related,
            'ticker' => $ticker,
        );
    }
}

if (!function_exists('sml_vus_rest_engage')) {
    function sml_vus_rest_engage(WP_REST_Request $request) {
        $video_id = sanitize_key((string) $request->get_param('video_id'));
        $action = sanitize_key((string) $request->get_param('action'));
        $library = sml_video_upload_studio_library();
        if (!$video_id || empty($library[$video_id])) {
            return new WP_Error('sml_vus_missing', 'Video not found.', array('status' => 404));
        }

        $video = $library[$video_id];
        $viewer = get_current_user_id();

        if ($action === 'view' || $action === 'duration') {
            /* Anonymous, unauthenticated POSTs with no dedupe let anyone inflate
             * views and the rolling 400-day history with a loop. Verified live:
             * three POSTs took a video from 1 view to 4. sml_dist_session_key()
             * is an IP+UA hash needing no cookie, so this allows one count per
             * video per session per 30 minutes - generous for a genuine
             * re-watch, useless to a script. Duration backfill is unaffected. */
            $sml_vus_fresh_view = false;
            if ($action === 'view') {
                $sml_vus_seen_key = 'sml_vus_seen_' . md5($video_id . '|' . (function_exists('sml_dist_session_key') ? sml_dist_session_key() : ''));
                if (!get_transient($sml_vus_seen_key)) {
                    set_transient($sml_vus_seen_key, 1, 30 * MINUTE_IN_SECONDS);
                    $sml_vus_fresh_view = true;
                }
            }
            if ($action === 'view' && $sml_vus_fresh_view) {
                $video['views'] = (int) ($video['views'] ?? 0) + 1;

                // Keep a rolling 400-day view history so Creator Studio can chart real daily views.
                $daily = (array) ($video['views_daily'] ?? array());
                $today = gmdate('Y-m-d');
                $daily[$today] = (int) ($daily[$today] ?? 0) + 1;
                if (count($daily) > 400) {
                    ksort($daily);
                    $daily = array_slice($daily, -400, null, true);
                }
                $video['views_daily'] = $daily;
            }
            $duration = (int) $request->get_param('duration');
            if ($duration > 0 && !((int) ($video['duration'] ?? 0))) {
                $video['duration'] = $duration;
            }
        } elseif (in_array($action, array('like', 'dislike', 'save'), true)) {
            if (!$viewer) {
                return new WP_Error('sml_vus_login', 'Sign in to do that.', array('status' => 401));
            }
            $map = array('like' => 'likes', 'dislike' => 'dislikes', 'save' => 'saves');
            $key = $map[$action];
            $list = array_map('intval', (array) ($video[$key] ?? array()));
            if (in_array($viewer, $list, true)) {
                $list = array_values(array_diff($list, array($viewer)));
            } else {
                $list[] = $viewer;
                if ($action === 'like') {
                    $video['dislikes'] = array_values(array_diff(array_map('intval', (array) ($video['dislikes'] ?? array())), array($viewer)));
                }
                if ($action === 'dislike') {
                    $video['likes'] = array_values(array_diff(array_map('intval', (array) ($video['likes'] ?? array())), array($viewer)));
                }
            }
            $video[$key] = $list;
        } else {
            return new WP_Error('sml_vus_bad_action', 'Unsupported action.', array('status' => 400));
        }

        $library[$video_id] = $video;
        sml_video_upload_studio_save_library($library);

        return array('ok' => true, 'engagement' => sml_vus_engagement($video));
    }
}

if (!function_exists('sml_vus_rest_impressions')) {
    /**
     * Records a batch of impressions - a video card actually rendered on screen.
     * Deduplicated client side per page view, so one card seen once counts once.
     */
    function sml_vus_rest_impressions(WP_REST_Request $request) {
        $ids = array_slice((array) $request->get_param('ids'), 0, 50);
        $clicks = array_slice((array) $request->get_param('clicks'), 0, 50);
        if (!$ids && !$clicks) {
            return array('ok' => true, 'counted' => 0);
        }

        $library = sml_video_upload_studio_library();
        $today = gmdate('Y-m-d');
        $counted = 0;

        $bump = function ($video, $total_key, $daily_key) use ($today) {
            $video[$total_key] = (int) ($video[$total_key] ?? 0) + 1;
            $daily = (array) ($video[$daily_key] ?? array());
            $daily[$today] = (int) ($daily[$today] ?? 0) + 1;
            if (count($daily) > 400) {
                ksort($daily);
                $daily = array_slice($daily, -400, null, true);
            }
            $video[$daily_key] = $daily;
            return $video;
        };

        foreach ($ids as $raw_id) {
            $video_id = sanitize_key((string) $raw_id);
            if (!$video_id || empty($library[$video_id]) || !is_array($library[$video_id])) {
                continue;
            }
            $library[$video_id] = $bump($library[$video_id], 'impressions', 'impressions_daily');
            $counted += 1;
        }

        foreach ($clicks as $raw_id) {
            $video_id = sanitize_key((string) $raw_id);
            if (!$video_id || empty($library[$video_id]) || !is_array($library[$video_id])) {
                continue;
            }
            $library[$video_id] = $bump($library[$video_id], 'clicks', 'clicks_daily');
            $counted += 1;
        }

        if ($counted) {
            sml_video_upload_studio_save_library($library);
        }

        return array('ok' => true, 'counted' => $counted);
    }
}

if (!function_exists('sml_vus_rest_comment')) {
    function sml_vus_rest_comment(WP_REST_Request $request) {
        $video_id = sanitize_key((string) $request->get_param('video_id'));
        $text = trim(sanitize_textarea_field((string) $request->get_param('text')));
        $library = sml_video_upload_studio_library();
        if (!$video_id || empty($library[$video_id])) {
            return new WP_Error('sml_vus_missing', 'Video not found.', array('status' => 404));
        }
        if ($text === '') {
            return new WP_Error('sml_vus_empty_comment', 'Write something first.', array('status' => 400));
        }
        if (strlen($text) > 2000) {
            $text = substr($text, 0, 2000);
        }

        $user = wp_get_current_user();
        $video = $library[$video_id];
        $comments = (array) ($video['comments'] ?? array());
        $comments[] = array(
            'id' => strtolower(wp_generate_password(10, false, false)),
            'user_id' => (int) $user->ID,
            'name' => $user->display_name ?: $user->user_login,
            'handle' => $user->user_nicename,
            'avatar' => get_avatar_url($user->ID, array('size' => 96)),
            'text' => $text,
            'created_at' => gmdate('c'),
        );
        $video['comments'] = $comments;
        $library[$video_id] = $video;
        sml_video_upload_studio_save_library($library);

        return array('ok' => true, 'comments' => sml_vus_comment_list($video), 'count' => count($comments));
    }
}

if (!function_exists('sml_vus_register_watch_routes')) {
    function sml_vus_register_watch_routes() {
        register_rest_route('sml-video-upload-studio/v1', '/rail', array(
            'methods' => 'GET',
            'permission_callback' => '__return_true',
            'callback' => 'sml_vus_rest_rail',
        ));
        register_rest_route('sml-video-upload-studio/v1', '/engage', array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => '__return_true',
            'callback' => 'sml_vus_rest_engage',
        ));
        register_rest_route('sml-video-upload-studio/v1', '/impressions', array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => '__return_true',
            'callback' => 'sml_vus_rest_impressions',
        ));
        register_rest_route('sml-video-upload-studio/v1', '/comment', array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_vus_rest_comment',
        ));
    }
}
add_action('rest_api_init', 'sml_vus_register_watch_routes');

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

if (!function_exists('sml_vus_watch_config')) {
    function sml_vus_watch_config($video) {
        $author_id = (int) ($video['author_id'] ?? 0);
        $creator_identity = sml_vus_creator_identity($author_id);
        $viewer = wp_get_current_user();
        $ticker = strtoupper((string) ($video['ticker'] ?? ''));

        return array(
            'videoId' => $video['id'] ?? '',
            'ticker' => $ticker,
            'restBase' => esc_url_raw(rest_url('sml-video-upload-studio/v1')),
            'chartEndpoint' => esc_url_raw(rest_url('sml-trading-floor/v1/chart')),
            'tickerEndpoint' => esc_url_raw(rest_url('sml-engines/v1/ticker')),
            'voiceEndpoint' => esc_url_raw(rest_url('sml-ticker-voice/v1/room')),
            'searchEndpoint' => esc_url_raw(rest_url('sml-members/v1/ticker-search')),
            'nonce' => wp_create_nonce('wp_rest'),
            'loggedIn' => is_user_logged_in(),
            'loginUrl' => esc_url_raw(add_query_arg('redirect_to', rawurlencode($video['watch_url'] ?? home_url('/')), home_url('/sign-up-sign-in/'))),
            'engagement' => sml_vus_engagement($video),
            'comments' => sml_vus_comment_list($video),
            'viewer' => array(
                'name' => $viewer->exists() ? ($viewer->display_name ?: $viewer->user_login) : '',
                'avatar' => $viewer->exists() ? get_avatar_url($viewer->ID, array('size' => 96)) : '',
            ),
            'creatorProfile' => $creator_identity['url'],
            'homeUrl' => esc_url_raw(home_url('/')),
        );
    }
}

if (!function_exists('sml_vus_watch_styles')) {
    function sml_vus_watch_styles() {
        return <<<'SMLWATCHCSS'
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:#060a12;color:#e6edf5;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
svg{display:block}
.wv-shell{min-height:100vh;background:radial-gradient(1200px 600px at 20% -10%,rgba(34,217,122,.06),transparent 60%),#060a12}

/* ---------- header ---------- */
.wv-head{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:22px;padding:12px 26px;background:rgba(8,13,22,.94);backdrop-filter:blur(14px);border-bottom:1px solid #16202e}
.wv-brand{display:flex;align-items:center;gap:11px;flex:0 0 auto}
.wv-brand-name{font-size:21px;font-weight:800;letter-spacing:-.4px}
.wv-brand-name em{font-style:normal;color:#22d97a}
.wv-search{position:relative;flex:0 1 400px;margin-left:8px}
.wv-search input{width:100%;height:42px;border-radius:12px;background:#0d1622;border:1px solid #1d2a3a;color:#e6edf5;padding:0 46px 0 42px;font-size:14px}
.wv-search input::placeholder{color:#7b8ca1}
.wv-search input:focus{outline:none;border-color:#2b6cff;box-shadow:0 0 0 3px rgba(43,108,255,.16)}
.wv-search .wv-search-ico{position:absolute;left:14px;top:12px;color:#7b8ca1}
.wv-search kbd{position:absolute;right:10px;top:9px;min-width:24px;height:24px;display:grid;place-items:center;border:1px solid #26364a;border-radius:6px;color:#7b8ca1;font-size:12px;font-family:inherit}
.wv-nav{display:flex;align-items:center;gap:30px;margin-left:auto;font-size:15px;font-weight:600;color:#c2cede}
.wv-nav a:hover{color:#fff}
.wv-head-right{display:flex;align-items:center;gap:18px;margin-left:26px}
.wv-bell{position:relative;color:#c2cede}
.wv-bell span{position:absolute;top:-6px;right:-7px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#2b6cff;color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center}
.wv-me{display:flex;align-items:center;gap:10px}
.wv-me img{width:38px;height:38px;border-radius:50%;object-fit:cover;border:1px solid #26364a}
.wv-me b{display:block;font-size:14px;font-weight:700;line-height:1.2}
.wv-me small{color:#22d97a;font-size:12px;font-weight:600}

/* ---------- layout ---------- */
.wv-wrap{display:grid;grid-template-columns:minmax(0,1fr) 470px;gap:22px;padding:22px 26px 60px;max-width:1740px;margin:0 auto;align-items:start}
.wv-card{background:#0b131f;border:1px solid #182130;border-radius:14px}

/* ---------- player ---------- */
.wv-player{position:relative;background:#000;border:1px solid #182130;border-radius:14px;overflow:hidden}
.wv-player video{display:block;width:100%;aspect-ratio:16/9;background:#000;object-fit:contain}
.wv-ctl{position:absolute;left:0;right:0;bottom:0;padding:0 18px 12px;background:linear-gradient(to top,rgba(4,8,14,.94),rgba(4,8,14,.55) 60%,transparent);transition:opacity .18s;opacity:1}
.wv-player.wv-idle .wv-ctl{opacity:0}
.wv-scrub{position:relative;height:16px;display:flex;align-items:center;cursor:pointer}
.wv-scrub-track{position:relative;height:4px;width:100%;border-radius:999px;background:rgba(255,255,255,.22)}
.wv-scrub-buf{position:absolute;inset:0 auto 0 0;height:100%;border-radius:999px;background:rgba(255,255,255,.3);width:0}
.wv-scrub-fill{position:absolute;inset:0 auto 0 0;height:100%;border-radius:999px;background:#22d97a;width:0}
.wv-scrub-knob{position:absolute;top:50%;left:0;width:13px;height:13px;margin-left:-6px;border-radius:50%;background:#22d97a;transform:translateY(-50%) scale(0);transition:transform .15s}
.wv-scrub:hover .wv-scrub-knob,.wv-player.wv-scrubbing .wv-scrub-knob{transform:translateY(-50%) scale(1)}
.wv-bar{display:flex;align-items:center;gap:18px;padding-top:6px;color:#dbe6f2}
.wv-bar button{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;color:#dbe6f2}
.wv-bar button:hover{background:rgba(255,255,255,.1);color:#fff}
.wv-bar .wv-time{font-size:13px;font-variant-numeric:tabular-nums;color:#c7d4e2;margin-left:2px}
.wv-bar .wv-spacer{margin-left:auto}
.wv-vol{display:flex;align-items:center;gap:8px}
.wv-vol input{width:0;opacity:0;transition:width .2s,opacity .2s;accent-color:#22d97a}
.wv-vol:hover input,.wv-vol:focus-within input{width:72px;opacity:1}
.wv-menu{position:relative}
.wv-menu-pop{position:absolute;bottom:40px;right:0;min-width:150px;background:#0e1826;border:1px solid #1f2b3c;border-radius:10px;padding:6px;display:none;box-shadow:0 18px 50px rgba(0,0,0,.55)}
.wv-menu.wv-open .wv-menu-pop{display:block}
.wv-menu-pop button{width:100%;height:auto;justify-content:flex-start;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;font-size:13px;font-weight:600}
.wv-menu-pop button[aria-checked="true"]{color:#22d97a}
.wv-theater .wv-wrap{grid-template-columns:minmax(0,1fr)}
.wv-theater .wv-rail{display:none}

/* ---------- info card ---------- */
.wv-info{margin-top:16px;padding:22px 24px 20px}
.wv-info-top{display:flex;gap:26px;align-items:flex-start}
.wv-title{margin:0;font-size:29px;line-height:1.24;font-weight:700;letter-spacing:-.5px}
.wv-meta{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-top:14px;font-size:13.5px;color:#93a4b8}
.wv-chip{display:inline-flex;align-items:center;height:28px;padding:0 11px;border-radius:8px;background:rgba(43,108,255,.12);border:1px solid rgba(43,108,255,.32);color:#63a4ff;font-weight:700;font-size:13px}
.wv-sent{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:8px;font-weight:700;font-size:13px;background:rgba(34,217,122,.12);border:1px solid rgba(34,217,122,.32);color:#22d97a}
.wv-sent.wv-bear{background:rgba(255,86,110,.12);border-color:rgba(255,86,110,.32);color:#ff566e}
.wv-sent.wv-neutral{background:rgba(148,163,184,.12);border-color:rgba(148,163,184,.3);color:#a6b6c8}
.wv-views{display:inline-flex;align-items:center;gap:7px}
.wv-disclaimer{margin-top:14px;font-size:12.5px;color:#65798f;line-height:1.5}
.wv-creator{flex:0 0 auto;display:flex;align-items:center;gap:14px;padding-top:2px}
.wv-creator img{width:52px;height:52px;border-radius:50%;object-fit:cover;border:1px solid #26364a}
.wv-creator-name{display:flex;align-items:center;gap:6px;font-size:16px;font-weight:700}
.wv-creator-sub{font-size:13px;color:#8798ac;margin-top:2px}
.wv-follow{height:40px;padding:0 24px;border-radius:999px;border:1px solid #2b6cff;color:#63a4ff;font-weight:700;font-size:14px;background:rgba(43,108,255,.08)}
.wv-follow:hover{background:rgba(43,108,255,.18)}
.wv-more{width:40px;height:40px;border-radius:999px;border:1px solid #24344a;display:grid;place-items:center;color:#c2cede}
.wv-actions{display:flex;flex-wrap:wrap;gap:12px;justify-content:flex-end;margin-top:6px}
.wv-act{display:inline-flex;align-items:center;gap:9px;height:44px;padding:0 18px;border-radius:999px;background:#111c2b;border:1px solid #223146;font-weight:700;font-size:14px;color:#dbe6f2}
.wv-act:hover{background:#162335}
.wv-act.wv-on{color:#22d97a;border-color:rgba(34,217,122,.45);background:rgba(34,217,122,.1)}
.wv-act-split{display:inline-flex;align-items:center;background:#111c2b;border:1px solid #223146;border-radius:999px;overflow:hidden}
.wv-act-split .wv-act{border:0;background:transparent;border-radius:0}
.wv-act-split .wv-divider{width:1px;height:22px;background:#223146}
.wv-act-icon{width:44px;height:44px;border-radius:999px;background:#111c2b;border:1px solid #223146;display:grid;place-items:center;color:#dbe6f2}

/* ---------- tabs ---------- */
.wv-tabs{margin-top:16px;padding:0 24px 24px}
.wv-tabs-nav{display:flex;gap:34px;border-bottom:1px solid #182130;padding:4px 0 0}
.wv-tab{display:inline-flex;align-items:center;gap:9px;padding:16px 2px;font-size:14.5px;font-weight:600;color:#8798ac;border-bottom:2px solid transparent;margin-bottom:-1px}
.wv-tab[aria-selected="true"]{color:#22d97a;border-bottom-color:#22d97a}
.wv-tab-count{font-size:12.5px;color:#7b8ca1;background:#131f2e;border-radius:999px;padding:2px 8px;font-weight:700}
.wv-panel{padding-top:22px}
.wv-panel[hidden]{display:none}
.wv-overview{display:grid;grid-template-columns:minmax(0,1fr) 560px;gap:34px;align-items:start}
.wv-desc{font-size:14.5px;line-height:1.75;color:#c8d5e4;white-space:pre-wrap}
.wv-desc.wv-clamped{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.wv-showmore{margin-top:14px;color:#63a4ff;font-weight:700;font-size:14px;display:inline-flex;align-items:center;gap:7px}
.wv-facts{background:#0d1725;border:1px solid #1a2534;border-radius:12px;overflow:hidden}
.wv-fact{display:grid;grid-template-columns:180px minmax(0,1fr);gap:16px;padding:15px 20px;font-size:14px;border-bottom:1px solid #16202e}
.wv-fact:last-child{border-bottom:0}
.wv-fact dt{color:#8798ac}
.wv-fact dd{margin:0;color:#e6edf5;font-weight:600}
.wv-empty{padding:36px 4px;color:#7b8ca1;font-size:14px;text-align:center}
.wv-chapter-list{display:flex;flex-direction:column;gap:2px}
.wv-chapter{display:flex;align-items:center;gap:16px;padding:11px 12px;border-radius:9px;text-align:left;width:100%}
.wv-chapter:hover{background:#111c2b}
.wv-chapter-time{font-variant-numeric:tabular-nums;font-size:13px;font-weight:700;color:#63a4ff;min-width:56px}
.wv-chapter-label{font-size:14px;color:#dbe6f2}
.wv-alerts{margin-top:22px}
.wv-alerts-head{font-size:13px;font-weight:700;color:#8798ac;margin-bottom:11px}
.wv-alerts-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.wv-alert{margin:0;border:1px solid #1a2534;border-radius:11px;overflow:hidden;background:#0d1725}
.wv-alert img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
.wv-alert figcaption{padding:10px 12px}
.wv-alert b{display:block;font-size:13px;font-weight:700}
.wv-alert span{display:block;font-size:12px;color:#8798ac;margin-top:3px}
.wv-comment-form{display:flex;gap:14px;align-items:flex-start;margin-bottom:26px}
.wv-comment-form img{width:42px;height:42px;border-radius:50%;object-fit:cover;border:1px solid #26364a;flex:0 0 auto}
.wv-comment-form .wv-cf-body{flex:1;min-width:0}
.wv-comment-form textarea{width:100%;min-height:52px;resize:vertical;background:#0d1725;border:1px solid #1e2a3a;border-radius:11px;color:#e6edf5;padding:13px 15px;font-size:14px;line-height:1.6}
.wv-comment-form textarea:focus{outline:none;border-color:#2b6cff}
.wv-cf-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:10px}
.wv-cf-actions button{height:38px;padding:0 20px;border-radius:999px;font-weight:700;font-size:14px;background:#22d97a;color:#04170d}
.wv-cf-actions button[disabled]{opacity:.5;cursor:default}
.wv-comment{display:flex;gap:14px;padding:16px 0;border-top:1px solid #16202e}
.wv-comment img{width:42px;height:42px;border-radius:50%;object-fit:cover;border:1px solid #26364a;flex:0 0 auto}
.wv-comment-name{font-size:14px;font-weight:700}
.wv-comment-name span{color:#7b8ca1;font-weight:500;margin-left:8px;font-size:13px}
.wv-comment-text{margin-top:5px;font-size:14px;line-height:1.65;color:#c8d5e4;white-space:pre-wrap}

/* ---------- rail ---------- */
.wv-rail{display:flex;flex-direction:column;gap:18px;position:sticky;top:80px}
.wv-rail-card{padding:18px}
.wv-rail-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.wv-rail-title{font-size:16px;font-weight:700}
.wv-viewall{color:#63a4ff;font-size:13.5px;font-weight:600}
.wv-switch{display:inline-flex;align-items:center;gap:10px;font-size:13px;color:#8798ac;font-weight:600}
.wv-switch i{width:42px;height:24px;border-radius:999px;background:#22d97a;position:relative;transition:background .2s}
.wv-switch i::after{content:"";position:absolute;top:3px;left:21px;width:18px;height:18px;border-radius:50%;background:#04170d;transition:left .2s}
.wv-switch[aria-checked="false"] i{background:#26364a}
.wv-switch[aria-checked="false"] i::after{left:3px;background:#8798ac}
.wv-item{display:grid;grid-template-columns:150px minmax(0,1fr);gap:13px;padding:9px 0}
.wv-item:hover .wv-item-title{color:#fff}
.wv-thumb{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#111c2b;border:1px solid #1c2839}
.wv-thumb img{width:100%;height:100%;object-fit:cover}
.wv-thumb-fallback{position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(135deg,#12202f,#0d1826);color:#3f5570;font-size:15px;font-weight:800;letter-spacing:.5px}
.wv-thumb b{position:absolute;right:6px;bottom:6px;background:rgba(3,7,13,.88);border-radius:5px;padding:2px 6px;font-size:11.5px;font-weight:700;letter-spacing:.2px}
.wv-item-title{font-size:14px;font-weight:700;line-height:1.35;color:#e6edf5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.wv-item-sub{margin-top:6px;font-size:12.5px;color:#8798ac;display:flex;align-items:center;gap:5px}
.wv-item-stats{margin-top:3px;font-size:12.5px;color:#7b8ca1}
.wv-live{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:.9px;color:#22d97a}
.wv-live i{width:9px;height:9px;border-radius:50%;background:#22d97a;box-shadow:0 0 0 0 rgba(34,217,122,.6);animation:wvpulse 1.9s infinite}
@keyframes wvpulse{70%{box-shadow:0 0 0 9px rgba(34,217,122,0)}100%{box-shadow:0 0 0 0 rgba(34,217,122,0)}}
.wv-listening{font-size:13px;color:#8798ac;display:inline-flex;align-items:center;gap:7px}
.wv-room-title{font-size:16px;font-weight:700;margin-top:12px}
.wv-room-host{font-size:13px;color:#8798ac;margin-top:4px;display:flex;align-items:center;gap:5px}
.wv-room-foot{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:14px}
.wv-stack{display:flex}
.wv-stack img,.wv-stack span{width:32px;height:32px;border-radius:50%;border:2px solid #0b131f;object-fit:cover;margin-left:-9px;background:#1a2534;display:grid;place-items:center;font-size:11px;font-weight:800;color:#c2cede}
.wv-stack :first-child{margin-left:0}
.wv-join{height:44px;padding:0 26px;border-radius:10px;background:#2b6cff;color:#fff;font-weight:700;font-size:14.5px}
.wv-join:hover{background:#1f5ce6}
.wv-quote-head{display:flex;align-items:center;gap:10px}
.wv-quote-sym{font-size:17px;font-weight:800;color:#63a4ff}
.wv-quote-name{font-size:13.5px;color:#8798ac;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wv-quote-head button{color:#7b8ca1}
.wv-quote-body{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-top:12px}
.wv-quote-price{font-size:31px;font-weight:800;letter-spacing:-.6px;line-height:1}
.wv-quote-change{font-size:14px;font-weight:700;color:#22d97a;margin-top:8px}
.wv-quote-change.wv-down{color:#ff566e}
.wv-spark{width:210px;height:52px;flex:0 0 auto}
.wv-quote-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:18px}
.wv-quote-grid dt{font-size:12px;color:#8798ac;margin-bottom:5px}
.wv-quote-grid dd{margin:0;font-size:13.5px;font-weight:700;white-space:nowrap}
.wv-skel{background:linear-gradient(90deg,#131f2e,#1a2839,#131f2e);background-size:200% 100%;animation:wvsk 1.3s infinite;border-radius:8px;color:transparent}
@keyframes wvsk{0%{background-position:200% 0}100%{background-position:-200% 0}}
.wv-verified{color:#2b6cff;flex:0 0 auto}

@media (max-width:1400px){
  .wv-wrap{grid-template-columns:minmax(0,1fr) 400px}
  .wv-overview{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:1080px){
  .wv-wrap{grid-template-columns:minmax(0,1fr);padding:16px 16px 50px}
  .wv-rail{position:static}
  .wv-nav,.wv-search{display:none}
  .wv-info-top{flex-direction:column;gap:18px}
  .wv-actions{justify-content:flex-start}
  .wv-title{font-size:22px}
}
SMLWATCHCSS;
    }
}

if (!function_exists('sml_vus_watch_script')) {
    function sml_vus_watch_script() {
        return <<<'SMLWATCHJS'
(function () {
  var cfg = window.smlWatchConfig || {};
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function compact(n) {
    n = Number(n) || 0;
    if (n >= 1e6) { return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'; }
    if (n >= 1e3) { return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K'; }
    return String(Math.round(n));
  }

  function clock(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = seconds % 60;
    var pad = function (v) { return v < 10 ? '0' + v : String(v); };
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  function api(path, options) {
    options = options || {};
    var headers = { 'Accept': 'application/json' };
    if (options.body) { headers['Content-Type'] = 'application/json'; }
    if (cfg.nonce) { headers['X-WP-Nonce'] = cfg.nonce; }
    return fetch(path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          var error = new Error(payload.message || 'Request failed.');
          error.status = response.status;
          throw error;
        }
        return payload;
      });
    });
  }

  /* ---------------- player ---------------- */
  var player = $('.wv-player');
  var video = $('video', player);
  var scrub = $('.wv-scrub', player);
  var fill = $('.wv-scrub-fill', player);
  var buffered = $('.wv-scrub-buf', player);
  var knob = $('.wv-scrub-knob', player);
  var timeLabel = $('.wv-time', player);
  var playBtn = $('[data-player="play"]', player);
  var iconPlay = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6L19 12z"/></svg>';
  var iconPause = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>';
  var idleTimer = null;

  function syncPlayIcon() {
    playBtn.innerHTML = video.paused ? iconPlay : iconPause;
    playBtn.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
  }

  function paint() {
    var duration = video.duration || 0;
    var pct = duration ? (video.currentTime / duration) * 100 : 0;
    fill.style.width = pct + '%';
    knob.style.left = pct + '%';
    timeLabel.textContent = clock(video.currentTime) + ' / ' + clock(duration);
    try {
      if (video.buffered.length) {
        buffered.style.width = (duration ? (video.buffered.end(video.buffered.length - 1) / duration) * 100 : 0) + '%';
      }
    } catch (error) { /* buffered can throw before metadata */ }
  }

  function seekFromEvent(event) {
    var rect = scrub.getBoundingClientRect();
    var ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    if (video.duration) { video.currentTime = ratio * video.duration; }
    paint();
  }

  function goIdle() {
    if (!video.paused) { player.classList.add('wv-idle'); }
  }

  function wake() {
    player.classList.remove('wv-idle');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(goIdle, 2600);
  }

  playBtn.addEventListener('click', function () { video.paused ? video.play() : video.pause(); });
  video.addEventListener('click', function () { video.paused ? video.play() : video.pause(); });
  video.addEventListener('play', syncPlayIcon);
  video.addEventListener('pause', function () { syncPlayIcon(); wake(); });
  video.addEventListener('timeupdate', paint);
  video.addEventListener('progress', paint);
  var viewCounted = false;
  function countView() {
    if (viewCounted) { return; }
    // One view per video per browser session, so a refresh does not inflate the count.
    var seenKey = 'sml-watch-seen-' + cfg.videoId;
    try {
      if (window.sessionStorage.getItem(seenKey)) { viewCounted = true; return; }
      window.sessionStorage.setItem(seenKey, '1');
    } catch (error) { /* private mode - fall through and count once per load */ }
    viewCounted = true;
    var duration = (video.duration && isFinite(video.duration)) ? Math.round(video.duration) : 0;
    api(cfg.restBase + '/engage', { method: 'POST', body: { video_id: cfg.videoId, action: 'view', duration: duration } })
      .then(function (payload) { if (payload.engagement) { paintEngagement(payload.engagement); } })
      .catch(function () { /* view counting is best effort */ });
  }

  video.addEventListener('loadedmetadata', function () {
    paint();
    if (viewCounted && video.duration && isFinite(video.duration)) {
      api(cfg.restBase + '/engage', { method: 'POST', body: { video_id: cfg.videoId, action: 'duration', duration: Math.round(video.duration) } })
        .catch(function () { /* duration backfill is best effort */ });
    }
  });

  scrub.addEventListener('pointerdown', function (event) {
    player.classList.add('wv-scrubbing');
    scrub.setPointerCapture(event.pointerId);
    seekFromEvent(event);
  });
  scrub.addEventListener('pointermove', function (event) {
    if (player.classList.contains('wv-scrubbing')) { seekFromEvent(event); }
  });
  scrub.addEventListener('pointerup', function (event) {
    player.classList.remove('wv-scrubbing');
    try { scrub.releasePointerCapture(event.pointerId); } catch (error) { /* already released */ }
  });

  $('[data-player="back"]', player).addEventListener('click', function () { video.currentTime = Math.max(0, video.currentTime - 10); });
  var nextBtn = $('[data-player="next"]', player);
  nextBtn.addEventListener('click', function () {
    var first = $('.wv-item[href]', $('[data-rail="upnext"]'));
    if (first) { window.location.href = first.getAttribute('href'); }
  });

  var volumeBtn = $('[data-player="mute"]', player);
  var volumeInput = $('.wv-vol input', player);
  var iconVolume = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z"/><path d="M15.4 8.6a4.6 4.6 0 0 1 0 6.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M17.8 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  var iconMuted = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z"/><path d="M16 9.5l4.5 5M20.5 9.5l-4.5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function syncVolume() {
    volumeBtn.innerHTML = (video.muted || video.volume === 0) ? iconMuted : iconVolume;
    volumeInput.value = video.muted ? 0 : video.volume;
  }
  volumeBtn.addEventListener('click', function () { video.muted = !video.muted; syncVolume(); });
  volumeInput.addEventListener('input', function () {
    video.volume = Number(volumeInput.value);
    video.muted = video.volume === 0;
    syncVolume();
  });

  var settings = $('[data-player="settings-menu"]', player);
  $('[data-player="settings"]', player).addEventListener('click', function (event) {
    event.stopPropagation();
    settings.classList.toggle('wv-open');
  });
  document.addEventListener('click', function () { settings.classList.remove('wv-open'); });
  $$('[data-speed]', settings).forEach(function (button) {
    button.addEventListener('click', function () {
      video.playbackRate = Number(button.getAttribute('data-speed'));
      $$('[data-speed]', settings).forEach(function (other) {
        other.setAttribute('aria-checked', other === button ? 'true' : 'false');
      });
    });
  });

  $('[data-player="pip"]', player).addEventListener('click', function () {
    if (document.pictureInPictureElement) { document.exitPictureInPicture(); }
    else if (video.requestPictureInPicture) { video.requestPictureInPicture().catch(function () {}); }
  });
  $('[data-player="theater"]', player).addEventListener('click', function () {
    document.documentElement.classList.toggle('wv-theater');
  });
  $('[data-player="full"]', player).addEventListener('click', function () {
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else if (player.requestFullscreen) { player.requestFullscreen().catch(function () {}); }
  });

  player.addEventListener('pointermove', wake);
  player.addEventListener('pointerleave', goIdle);
  document.addEventListener('keydown', function (event) {
    var tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') { return; }
    if (event.key === ' ' || event.key === 'k') { event.preventDefault(); video.paused ? video.play() : video.pause(); }
    else if (event.key === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - 5); }
    else if (event.key === 'ArrowRight') { video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); }
    else if (event.key === 'm') { video.muted = !video.muted; syncVolume(); }
    else if (event.key === 'f') { $('[data-player="full"]', player).click(); }
    else if (event.key === '/') { event.preventDefault(); var box = $('.wv-search input'); if (box) { box.focus(); } }
  });

  syncPlayIcon();
  syncVolume();
  paint();

  $$('.wv-chapter[data-seek]').forEach(function (chapter) {
    chapter.addEventListener('click', function () {
      video.currentTime = Number(chapter.getAttribute('data-seek')) || 0;
      video.play().catch(function () { /* autoplay may be blocked */ });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  /* ---------------- tabs ---------------- */
  $$('.wv-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.wv-tab').forEach(function (other) { other.setAttribute('aria-selected', other === tab ? 'true' : 'false'); });
      $$('.wv-panel').forEach(function (panel) { panel.hidden = panel.id !== tab.getAttribute('aria-controls'); });
    });
  });

  var desc = $('.wv-desc');
  var showMore = $('.wv-showmore');
  if (desc && showMore) {
    if (desc.scrollHeight <= desc.clientHeight + 4) {
      showMore.style.display = 'none';
    }
    showMore.addEventListener('click', function () {
      var clamped = desc.classList.toggle('wv-clamped');
      showMore.querySelector('span').textContent = clamped ? 'Show more' : 'Show less';
      showMore.querySelector('svg').style.transform = clamped ? '' : 'rotate(180deg)';
    });
  }

  /* ---------------- engagement ---------------- */
  function paintEngagement(data) {
    var likeBtn = $('[data-engage="like"]');
    var dislikeBtn = $('[data-engage="dislike"]');
    var saveBtn = $('[data-engage="save"]');
    $('[data-count="likes"]').textContent = compact(data.likes);
    $('[data-count="comments"]').textContent = compact(data.comments);
    $('[data-count="views"]').textContent = compact(data.views) + ' views';
    var commentTab = $('[data-count="comments-tab"]');
    if (commentTab) { commentTab.textContent = compact(data.comments); }
    likeBtn.classList.toggle('wv-on', !!data.liked);
    dislikeBtn.classList.toggle('wv-on', !!data.disliked);
    saveBtn.classList.toggle('wv-on', !!data.saved);
    $('[data-label="save"]').textContent = data.saved ? 'Saved' : 'Save';
  }

  $$('[data-engage]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (!cfg.loggedIn) { window.location.href = cfg.loginUrl; return; }
      api(cfg.restBase + '/engage', { method: 'POST', body: { video_id: cfg.videoId, action: button.getAttribute('data-engage') } })
        .then(function (payload) { if (payload.engagement) { paintEngagement(payload.engagement); } })
        .catch(function (error) { window.alert(error.message); });
    });
  });

  var shareBtn = $('[data-action="share"]');
  shareBtn.addEventListener('click', function () {
    var url = window.location.href;
    if (navigator.share) { navigator.share({ title: document.title, url: url }).catch(function () {}); return; }
    var done = function () {
      var label = $('span', shareBtn);
      var original = label.textContent;
      label.textContent = 'Link copied';
      window.setTimeout(function () { label.textContent = original; }, 1800);
    };
    if (navigator.clipboard) { navigator.clipboard.writeText(url).then(done).catch(function () {}); }
  });

  paintEngagement(cfg.engagement || { likes: 0, dislikes: 0, comments: 0, views: 0 });
  countView();

  /* ---------------- comments ---------------- */
  var commentList = $('[data-comments="list"]');
  function paintComments(items) {
    if (!items.length) {
      commentList.innerHTML = '<div class="wv-empty">No comments yet. Start the conversation.</div>';
      return;
    }
    commentList.innerHTML = items.map(function (item) {
      return '<article class="wv-comment">'
        + '<img src="' + esc(item.avatar) + '" alt="" loading="lazy">'
        + '<div><div class="wv-comment-name">' + esc(item.name) + '<span>@' + esc(item.handle) + ' &middot; ' + esc(item.ago) + '</span></div>'
        + '<div class="wv-comment-text">' + esc(item.text) + '</div></div>'
        + '</article>';
    }).join('');
  }
  paintComments(cfg.comments || []);

  var commentForm = $('[data-comments="form"]');
  if (commentForm) {
    var field = $('textarea', commentForm);
    var submit = $('button[type="submit"]', commentForm);
    commentForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = field.value.trim();
      if (!text) { return; }
      submit.disabled = true;
      api(cfg.restBase + '/comment', { method: 'POST', body: { video_id: cfg.videoId, text: text } })
        .then(function (payload) {
          field.value = '';
          paintComments(payload.comments || []);
          var engagement = cfg.engagement || {};
          engagement.comments = payload.count || 0;
          paintEngagement(engagement);
        })
        .catch(function (error) { window.alert(error.message); })
        .then(function () { submit.disabled = false; });
    });
  }

  /* ---------------- rail: up next + related ---------------- */
  var checkIcon = '<svg class="wv-verified" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.8l2.6 2.1 3.3-.3.9 3.2 2.8 1.8-1.3 3.1 1.3 3.1-2.8 1.8-.9 3.2-3.3-.3L12 22.2l-2.6-2.1-3.3.3-.9-3.2-2.8-1.8L3.7 12 2.4 8.9l2.8-1.8.9-3.2 3.3.3z"/><path d="M8.4 12.2l2.4 2.4 4.6-4.8" fill="none" stroke="#0b131f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function itemMarkup(item) {
    var art = item.thumbnail
      ? '<img src="' + esc(item.thumbnail) + '" alt="" loading="lazy">'
      : '<span class="wv-thumb-fallback">' + esc(item.ticker ? '$' + item.ticker : 'SML') + '</span>';
    return '<a class="wv-item" href="' + esc(item.watch_url) + '" data-vid="' + esc(item.id) + '">'
      + '<div class="wv-thumb">' + art
      + (item.duration ? '<b>' + esc(item.duration) + '</b>' : '') + '</div>'
      + '<div><div class="wv-item-title">' + esc(item.title) + '</div>'
      + '<div class="wv-item-sub">' + esc(item.creator) + (item.verified ? checkIcon : '') + '</div>'
      + '<div class="wv-item-stats">' + esc(item.views_label) + ' &middot; ' + esc(item.ago) + '</div></div></a>';
  }

  /* ---------------- impression tracking ---------------- */
  // A card counts as an impression once it has actually been on screen, and only
  // once per page view, so scrolling up and down does not inflate the number.
  var impressionSeen = {};
  var impressionQueue = [];
  var impressionTimer = null;
  var impressionObserver = null;

  var clickQueue = [];

  function sendBeacon(payload) {
    try {
      fetch(cfg.restBase + '/impressions', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce || '' },
        body: JSON.stringify(payload)
      }).catch(function () { /* best effort */ });
    } catch (error) { /* best effort */ }
  }

  function flushImpressions() {
    impressionTimer = null;
    var ids = impressionQueue.splice(0, 50);
    var clicks = clickQueue.splice(0, 50);
    if (!ids.length && !clicks.length) { return; }
    sendBeacon({ ids: ids, clicks: clicks });
  }

  function queueImpression(id) {
    if (!id || impressionSeen[id]) { return; }
    impressionSeen[id] = true;
    impressionQueue.push(id);
    if (!impressionTimer) { impressionTimer = window.setTimeout(flushImpressions, 1200); }
  }

  // Geometry check used when IntersectionObserver never reports - some browsers
  // and embedded views only fire it after a real paint.
  function scanVisibleCards(host) {
    if (document.visibilityState === 'hidden') { return; }
    var viewport = window.innerHeight || document.documentElement.clientHeight;
    $$('[data-vid]', host).forEach(function (node) {
      var id = node.getAttribute('data-vid');
      if (!id || impressionSeen[id]) { return; }
      var box = node.getBoundingClientRect();
      if (!box.height) { return; }
      var visible = Math.min(box.bottom, viewport) - Math.max(box.top, 0);
      if (visible / box.height >= 0.5) { queueImpression(id); }
    });
  }

  function observeImpressions(host) {
    if ('IntersectionObserver' in window) {
      if (!impressionObserver) {
        impressionObserver = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.intersectionRatio < 0.5) { return; }
            queueImpression(entry.target.getAttribute('data-vid'));
            impressionObserver.unobserve(entry.target);
          });
        }, { threshold: [0.5] });
      }
      $$('[data-vid]', host).forEach(function (node) { impressionObserver.observe(node); });
    }

    window.setTimeout(function () { scanVisibleCards(host); }, 1500);
    if (!host.__scrollBound) {
      host.__scrollBound = true;
      var pending = null;
      window.addEventListener('scroll', function () {
        if (pending) { return; }
        pending = window.setTimeout(function () { pending = null; scanVisibleCards(host); }, 400);
      }, { passive: true });
    }
  }

  window.addEventListener('pagehide', flushImpressions);

  // A click on a recommended card is the other half of click-through rate.
  document.addEventListener('click', function (event) {
    var card = event.target.closest('.wv-item[data-vid]');
    if (!card) { return; }
    var id = card.getAttribute('data-vid');
    if (!id) { return; }
    clickQueue.push(id);
    flushImpressions();
  }, true);

  function paintList(target, items, emptyText) {
    var host = $('[data-rail="' + target + '"]');
    if (!host) { return; }
    if (!items || !items.length) {
      host.innerHTML = '<div class="wv-empty">' + esc(emptyText) + '</div>';
      return;
    }
    host.innerHTML = items.map(itemMarkup).join('');
    observeImpressions(host);
  }

  var railUrl = cfg.restBase + '/rail?video_id=' + encodeURIComponent(cfg.videoId) + (cfg.ticker ? '&ticker=' + encodeURIComponent(cfg.ticker) : '');
  api(railUrl)
    .then(function (payload) {
      paintList('upnext', payload.up_next, 'Nothing queued up yet.');
      paintList('related', payload.related, 'No other videos on this ticker yet.');
    })
    .catch(function () {
      paintList('upnext', [], 'Recommendations are unavailable right now.');
      paintList('related', [], 'Recommendations are unavailable right now.');
    });

  var autoplay = $('[data-rail="autoplay"]');
  if (autoplay) {
    var stored = window.localStorage.getItem('sml-watch-autoplay');
    if (stored === '0') { autoplay.setAttribute('aria-checked', 'false'); }
    autoplay.addEventListener('click', function () {
      var on = autoplay.getAttribute('aria-checked') !== 'true';
      autoplay.setAttribute('aria-checked', on ? 'true' : 'false');
      window.localStorage.setItem('sml-watch-autoplay', on ? '1' : '0');
    });
    video.addEventListener('ended', function () {
      if (autoplay.getAttribute('aria-checked') !== 'true') { return; }
      var first = $('.wv-item[href]', $('[data-rail="upnext"]'));
      if (first) { window.location.href = first.getAttribute('href'); }
    });
  }

  /* ---------------- rail: voice room ---------------- */
  if (cfg.ticker) {
    var loadRoom = function () {
      api(cfg.voiceEndpoint + '?symbol=' + encodeURIComponent(cfg.ticker))
        .then(function (room) {
          var count = Number(room.count) || 0;
          $('[data-room="count"]').textContent = compact(count) + ' listening';
          $('[data-room="title"]').textContent = room.title || ('$' + cfg.ticker + ' Live Voice Room');
          var members = (room.members || []).slice(0, 5);
          var stack = $('[data-room="stack"]');
          stack.innerHTML = members.map(function (member) {
            return '<img src="' + esc(member.avatar || member.avatar_url || '') + '" alt="" loading="lazy">';
          }).join('') + (count > members.length ? '<span>+' + compact(count - members.length) + '</span>' : '');
          var host = members.length ? (members[0].name || members[0].display_name || '') : '';
          $('[data-room="host"]').textContent = host ? ('Hosted by ' + host) : 'Open room - anyone can speak';
        })
        .catch(function () {
          $('[data-room="count"]').textContent = 'Room offline';
        });
    };
    loadRoom();
    window.setInterval(loadRoom, 30000);
  }

  /* ---------------- rail: quote ---------------- */
  function sparkline(values) {
    if (!values.length) { return ''; }
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = (max - min) || 1;
    var w = 210;
    var h = 52;
    var points = values.map(function (value, index) {
      var x = (index / (values.length - 1 || 1)) * w;
      var y = h - 4 - ((value - min) / span) * (h - 10);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var up = values[values.length - 1] >= values[0];
    var stroke = up ? '#22d97a' : '#ff566e';
    return '<svg class="wv-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
      + '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'
      + '</svg>';
  }

  function money(value) {
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  if (cfg.ticker) {
    var quoteHost = $('[data-quote="panel"]');

    // The chart feed returns one continuous series regardless of the range asked
    // for, so the latest session is sliced out of it rather than fetched twice.
    function dayKey(bar) {
      return new Date((Number(bar.time) || 0) * 1000).toISOString().slice(0, 10);
    }

    api(cfg.chartEndpoint + '/' + encodeURIComponent(cfg.ticker) + '?range=1Y&interval=1d')
      .then(function (payload) {
        var bars = ((payload.data || payload).bars) || [];
        if (!bars.length) { throw new Error('no bars'); }

        var latestKey = dayKey(bars[bars.length - 1]);
        var session = bars.filter(function (bar) { return dayKey(bar) === latestKey; });
        var sessionStart = bars.length - session.length;
        if (session.length < 2) {
          session = bars.slice(-26);
          sessionStart = bars.length - session.length;
        }
        var previous = sessionStart > 0 ? bars[sessionStart - 1].close : session[0].open;

        var last = session[session.length - 1].close;
        var change = last - previous;
        var pct = previous ? (change / previous) * 100 : 0;
        var high = Math.max.apply(null, session.map(function (bar) { return bar.high; }));
        var low = Math.min.apply(null, session.map(function (bar) { return bar.low; }));
        var volume = session.reduce(function (sum, bar) { return sum + (Number(bar.volume) || 0); }, 0);
        var window52 = bars.slice(-252);
        var yearHigh = Math.max.apply(null, window52.map(function (bar) { return bar.high; }));
        var yearLow = Math.min.apply(null, window52.map(function (bar) { return bar.low; }));

        $('[data-quote="price"]').textContent = money(last);
        var changeEl = $('[data-quote="change"]');
        changeEl.textContent = (change >= 0 ? '+' : '') + money(change) + ' (' + (change >= 0 ? '+' : '') + pct.toFixed(2) + '%)';
        changeEl.classList.toggle('wv-down', change < 0);
        $('[data-quote="volume"]').textContent = compact(volume);
        $('[data-quote="range"]').textContent = money(low) + ' - ' + money(high);
        $('[data-quote="week"]').textContent = money(yearLow) + ' - ' + money(yearHigh);
        $('[data-quote="spark"]').innerHTML = sparkline(window52.map(function (bar) { return bar.close; }));
        $$('.wv-skel', quoteHost).forEach(function (node) { node.classList.remove('wv-skel'); });
      })
      .catch(function () {
        if (quoteHost) { quoteHost.style.display = 'none'; }
      });

    api(cfg.tickerEndpoint + '/' + encodeURIComponent(cfg.ticker))
      .then(function (payload) {
        var summary = payload.summary || {};
        var sentiment = String(summary.sentiment || '').toLowerCase();
        var pill = $('[data-sentiment]');
        if (!pill || !sentiment) { return; }
        var label = sentiment.charAt(0).toUpperCase() + sentiment.slice(1);
        $('span', pill).textContent = label;
        pill.classList.remove('wv-bear', 'wv-neutral');
        if (sentiment === 'bearish') { pill.classList.add('wv-bear'); }
        else if (sentiment !== 'bullish') { pill.classList.add('wv-neutral'); }
        var arrow = $('svg', pill);
        if (arrow) { arrow.style.transform = sentiment === 'bearish' ? 'rotate(180deg)' : ''; }
        var marketCap = summary.market_cap || summary.marketCap;
        if (marketCap) { $('[data-quote="cap"]').textContent = compact(marketCap); }
      })
      .catch(function () { /* sentiment stays at its published value */ });

    api(cfg.searchEndpoint + '?q=' + encodeURIComponent(cfg.ticker))
      .then(function (payload) {
        var rows = payload.results || payload.tickers || payload || [];
        if (!Array.isArray(rows)) { return; }
        var hit = rows.filter(function (row) {
          return String(row.symbol || row.ticker || '').toUpperCase() === cfg.ticker;
        })[0];
        var name = hit && (hit.name || hit.company || hit.company_name);
        if (name) { $('[data-quote="name"]').textContent = name; }
      })
      .catch(function () { /* company name is optional */ });
  }

  /* ---------------- header search ---------------- */
  var searchBox = $('.wv-search input');
  if (searchBox) {
    searchBox.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') { return; }
      var term = searchBox.value.trim();
      if (term) { window.location.href = cfg.homeUrl + '?s=' + encodeURIComponent(term); }
    });
  }
})();
SMLWATCHJS;
    }
}

if (!function_exists('sml_vus_render_watch_layout')) {
    function sml_vus_render_watch_layout($video) {
        $config = sml_vus_watch_config($video);
        $author_id = (int) ($video['author_id'] ?? 0);
        $engagement = $config['engagement'];

        $title = (string) ($video['title'] ?? 'Untitled video');
        $seo_title = (string) ($video['seo_title'] ?: $title);
        $description = (string) ($video['description'] ?? '');
        $watch_url = (string) ($video['watch_url'] ?? '');
        $thumb = (string) ($video['thumbnail_url'] ?: sml_video_upload_studio_default_thumb());
        $video_url = (string) ($video['video_url'] ?? '');
        $mime = (string) ($video['video_mime'] ?: 'video/mp4');
        $identity = sml_vus_creator_identity($author_id);
        $creator = $identity['name'];
        $handle = $identity['handle'];
        $profile_url = $identity['url'];
        $avatar = $identity['avatar'];
        $ticker = strtoupper((string) ($video['ticker'] ?? ''));
        $hashtags = (array) ($video['hashtags'] ?? array());
        $published = $video['created_at'] ? date_i18n('M j, Y g:i A T', strtotime($video['created_at'])) : '';
        $ago = sml_vus_time_ago($video['created_at'] ?? '');
        $viewer = $config['viewer'];
        $verified = user_can($author_id, 'edit_posts');
        /* Scheduled upload ("premiere"): before its publish time only the author/admin can watch; everyone else
           gets a premiere card, the video source stays out of the HTML, and the schema carries a BroadcastEvent
           with the start time (Google's upcoming-video markup). The sitemap adds it once the time passes. 2026-09-15 */
        /* Premiere phases (owner design 2026-09-15: a scheduled upload acts like a live watch page):
           upcoming = countdown + live chat, file withheld from viewers; live = everyone plays in sync from the
           start time with live chat and LIVE-badge markup; after start+duration it is a normal video. */
        $premiere_ts = strtotime((string) ($video['schedule_at'] ?? ''));
        $premiere_dur = max(30, (int) ($video['duration'] ?? 0));
        $premiere_end = $premiere_ts ? $premiere_ts + $premiere_dur : 0;
        $premiere_phase = !$premiere_ts ? '' : (time() < $premiere_ts ? 'upcoming' : (time() < $premiere_end ? 'live' : ''));
        $premiere_active = $premiere_phase !== '';
        $is_premiere = $premiere_phase === 'upcoming';
        // ?preview_premiere=1 lets the author/admin see exactly what viewers get before the time.
        $premiere_preview = $is_premiere && !empty($_GET['preview_premiere']) && ((int) $viewer === $author_id || current_user_can('manage_options'));
        $premiere_gate = $is_premiere && ($premiere_preview || ((int) $viewer !== $author_id && !current_user_can('manage_options')));

        $secondary_tickers = array();
        $source_tickers = (array) ($video['tickers'] ?? array());
        if (!$source_tickers) {
            $source_tickers = $hashtags;
        }
        foreach ($source_tickers as $tag) {
            $clean = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $tag));
            if ($clean && $clean !== $ticker && strlen($clean) <= 5) {
                $secondary_tickers[] = $clean;
            }
        }
        $secondary_tickers = array_values(array_unique($secondary_tickers));

        $chapters = array();
        foreach ((array) ($video['chapters'] ?? array()) as $chapter) {
            if (!is_array($chapter) || empty($chapter['label'])) {
                continue;
            }
            $parts = array_reverse(explode(':', (string) ($chapter['time'] ?? '0')));
            $seconds = 0;
            foreach ($parts as $index => $part) {
                $seconds += ((int) $part) * pow(60, $index);
            }
            $chapters[] = array(
                'time' => (string) ($chapter['time'] ?? '0:00'),
                'label' => (string) $chapter['label'],
                'seconds' => $seconds,
            );
        }
        $alert_images = (array) ($video['alert_images'] ?? array());

        $check = '<svg class="wv-verified" width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.8l2.6 2.1 3.3-.3.9 3.2 2.8 1.8-1.3 3.1 1.3 3.1-2.8 1.8-.9 3.2-3.3-.3L12 22.2l-2.6-2.1-3.3.3-.9-3.2-2.8-1.8L3.7 12 2.4 8.9l2.8-1.8.9-3.2 3.3.3z"/><path d="M8.4 12.2l2.4 2.4 4.6-4.8" fill="none" stroke="#0b131f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=' . get_bloginfo('charset'));

        echo '<!doctype html><html ' . get_language_attributes() . '><head>';
        echo '<meta charset="' . esc_attr(get_bloginfo('charset')) . '">';
        echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
        $social_description = wp_trim_words(wp_strip_all_tags($description), 32);
        $social_alt = $title ?: $seo_title;
        $social_image_id = $thumb ? attachment_url_to_postid($thumb) : 0;
        $social_image_meta = $social_image_id ? wp_get_attachment_metadata($social_image_id) : array();
        $social_image_mime = $social_image_id ? get_post_mime_type($social_image_id) : '';
        if (!$social_image_mime && $thumb) {
            $social_path = (string) wp_parse_url($thumb, PHP_URL_PATH);
            $social_ext = strtolower(pathinfo($social_path, PATHINFO_EXTENSION));
            $social_mimes = array(
                'jpg' => 'image/jpeg',
                'jpeg' => 'image/jpeg',
                'png' => 'image/png',
                'gif' => 'image/gif',
                'webp' => 'image/webp',
            );
            $social_image_mime = $social_mimes[$social_ext] ?? '';
        }

        echo '<title>' . ($premiere_phase === 'live' ? 'LIVE PREMIERE: ' : ($premiere_phase === 'upcoming' ? 'PREMIERE: ' : '')) . esc_html($seo_title) . ' - ' . esc_html(get_bloginfo('name')) . '</title>';
        if ($premiere_ts) {   /* every phase: after the premiere the chat room stays attached to the video */
            echo '<meta name="sml:premiere-start" content="' . esc_attr(gmdate('c', $premiere_ts)) . '">';
            echo '<meta name="sml:premiere-duration" content="' . (int) $premiere_dur . '">';
            echo '<meta name="sml:premiere-chat" content="premiere-' . esc_attr((string) ($video['id'] ?? '')) . '">';
        }
        echo '<link rel="canonical" href="' . esc_url($watch_url) . '">';
        echo '<meta name="description" content="' . esc_attr($social_description) . '">';
        echo '<meta property="og:type" content="video.other">';
        echo '<meta property="og:site_name" content="' . esc_attr(get_bloginfo('name')) . '">';
        echo '<meta property="og:title" content="' . esc_attr($seo_title) . '">';
        echo '<meta property="og:description" content="' . esc_attr($social_description) . '">';
        echo '<meta property="og:url" content="' . esc_url($watch_url) . '">';
        if (!$is_premiere) { echo '<meta property="og:video" content="' . esc_url($video_url) . '">'; } // no video file before a premiere
        if ($thumb) {
            echo '<meta property="og:image" content="' . esc_url($thumb) . '">';
            echo '<meta property="og:image:secure_url" content="' . esc_url($thumb) . '">';
            if ($social_image_mime) {
                echo '<meta property="og:image:type" content="' . esc_attr($social_image_mime) . '">';
            }
            if (!empty($social_image_meta['width'])) {
                echo '<meta property="og:image:width" content="' . absint($social_image_meta['width']) . '">';
            }
            if (!empty($social_image_meta['height'])) {
                echo '<meta property="og:image:height" content="' . absint($social_image_meta['height']) . '">';
            }
            echo '<meta property="og:image:alt" content="' . esc_attr($social_alt) . '">';
        }
        echo '<meta name="twitter:card" content="summary_large_image">';
        echo '<meta name="twitter:title" content="' . esc_attr($seo_title) . '">';
        echo '<meta name="twitter:description" content="' . esc_attr($social_description) . '">';
        if ($thumb) {
            echo '<meta name="twitter:image" content="' . esc_url($thumb) . '">';
            echo '<meta name="twitter:image:alt" content="' . esc_attr($social_alt) . '">';
        }
        echo '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
        echo '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';

        $schema = array(
            '@context' => 'https://schema.org',
            '@type' => 'VideoObject',
            'name' => $seo_title,
            'description' => wp_strip_all_tags($description),
            'thumbnailUrl' => $thumb,
            'uploadDate' => $video['created_at'] ?? '',
            'contentUrl' => $is_premiere ? '' : $video_url,
            'embedUrl' => $is_premiere ? '' : $watch_url . '?embed=1',
            'interactionStatistic' => array(
                '@type' => 'InteractionCounter',
                'interactionType' => 'https://schema.org/WatchAction',
                'userInteractionCount' => (int) $engagement['views'],
            ),
        );
        if ($premiere_active) {
            $schema['publication'] = array(
                '@type' => 'BroadcastEvent',
                'isLiveBroadcast' => true,
                'startDate' => gmdate('c', $premiere_ts),
                'endDate' => gmdate('c', $premiere_end),
            );
            $schema = array_filter($schema, function ($v) { return $v !== ''; });
        }
        echo '<script type="application/ld+json">' . wp_json_encode($schema) . '</script>';

        echo '<style>' . sml_vus_watch_styles() . '</style>';
        echo '</head><body><div class="wv-shell">';

        /* ---------------- header ---------------- */
        echo '<header class="wv-head">';
        echo '<a class="wv-brand" href="' . esc_url(home_url('/')) . '">';
        echo '<svg width="34" height="34" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="#22d97a" stroke-width="2.4"/><path d="M11 25.5l5.4-6.2 4 3.6 7.4-9" stroke="#22d97a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        echo '<span class="wv-brand-name">StockMarket<em>Loop</em></span></a>';
        echo '<div class="wv-search"><span class="wv-search-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6" stroke-linecap="round"/></svg></span>';
        echo '<input type="search" placeholder="Search tickers, creators, groups, topics..." aria-label="Search"><kbd>/</kbd></div>';
        echo '<nav class="wv-nav">';
        echo '<a href="' . esc_url(home_url('/')) . '">Home</a>';
        echo '<a href="' . esc_url(home_url('/tickers/')) . '">Tickers</a>';
        echo '<a href="' . esc_url(home_url('/groups/')) . '">Groups</a>';
        echo '<a href="' . esc_url(home_url('/creators/')) . '">Creators</a>';
        echo '<a href="' . esc_url(home_url('/news/')) . '">News</a>';
        echo '</nav>';
        echo '<div class="wv-head-right">';
        echo '<a class="wv-bell" href="' . esc_url(home_url('/notifications/')) . '" aria-label="Notifications"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 15.5V10a6 6 0 1 0-12 0v5.5L4.5 18h15z" stroke-linejoin="round"/><path d="M10 20.5a2 2 0 0 0 4 0" stroke-linecap="round"/></svg></a>';
        if (is_user_logged_in()) {
            echo '<a class="wv-me" href="' . esc_url(get_edit_profile_url()) . '"><img src="' . esc_url(get_avatar_url(get_current_user_id(), array('size' => 96))) . '" alt="">';
            echo '<span><b>' . esc_html($viewer['name']) . '</b><small>Member</small></span></a>';
        } else {
            echo '<a class="wv-follow" href="' . esc_url($config['loginUrl']) . '">Sign in</a>';
        }
        echo '</div></header>';

        echo '<div class="wv-wrap"><main>';

        /* ---------------- player ---------------- */
        echo '<section class="wv-player' . ($premiere_gate ? ' wv-premiere' : '') . '">';
        if ($premiere_gate) {
            echo '<div class="wv-premiere-card" style="position:relative;aspect-ratio:16/9;background:#000 url(' . esc_url($thumb) . ') center/cover no-repeat;display:flex;align-items:flex-end">'
                . '<div style="width:100%;padding:18px 20px;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.85));color:#fff">'
                . '<div style="font:800 11px/1 Inter,sans-serif;letter-spacing:.18em;color:#22d97a">PREMIERE</div>'
                . '<div style="font:700 20px/1.2 Inter,sans-serif;margin-top:6px">Premieres ' . esc_html(date_i18n('D, M j, Y \a\t g:i A T', $premiere_ts)) . '</div>'
                . '<div style="font:500 13px/1.4 Inter,sans-serif;color:#cfd8e3;margin-top:4px">Come back then — the video unlocks for everyone at that time.</div>'
                . '</div></div>';
        } else {
        echo '<video preload="metadata" playsinline poster="' . esc_url($thumb) . '"><source src="' . esc_url($video_url) . '" type="' . esc_attr($mime) . '"></video>';
        echo '<div class="wv-ctl">';
        echo '<div class="wv-scrub"><div class="wv-scrub-track"><div class="wv-scrub-buf"></div><div class="wv-scrub-fill"></div><div class="wv-scrub-knob"></div></div></div>';
        echo '<div class="wv-bar">';
        echo '<button data-player="play" aria-label="Play"></button>';
        echo '<button data-player="next" aria-label="Next video"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5.4v13.2L15 12z"/><rect x="16.4" y="5.4" width="2.4" height="13.2" rx="1"/></svg></button>';
        echo '<button data-player="back" aria-label="Back 10 seconds"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 6a6.5 6.5 0 1 1-6.3 8" stroke-linecap="round"/><path d="M12 2.6V9L7.4 6z" fill="currentColor" stroke="none"/></svg></button>';
        echo '<span class="wv-vol"><button data-player="mute" aria-label="Mute"></button><input type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume"></span>';
        echo '<span class="wv-time">0:00 / 0:00</span>';
        echo '<span class="wv-spacer"></span>';
        echo '<button data-player="cc" aria-label="Captions"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2.6" y="5" width="18.8" height="14" rx="3"/><path d="M10 10.4a2.4 2.4 0 1 0 0 3.2M17 10.4a2.4 2.4 0 1 0 0 3.2" stroke-linecap="round"/></svg></button>';
        echo '<span class="wv-menu" data-player="settings-menu"><button data-player="settings" aria-label="Settings"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1v-.2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1z"/></svg></button>';
        echo '<span class="wv-menu-pop">';
        foreach (array('0.5', '1', '1.25', '1.5', '2') as $speed) {
            echo '<button data-speed="' . esc_attr($speed) . '" aria-checked="' . ($speed === '1' ? 'true' : 'false') . '">' . esc_html($speed === '1' ? 'Normal speed' : $speed . 'x speed') . '</button>';
        }
        echo '</span></span>';
        echo '<button data-player="pip" aria-label="Picture in picture"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2.6" y="5" width="18.8" height="14" rx="3"/><rect x="12.4" y="11.4" width="7" height="5.6" rx="1.4" fill="currentColor" stroke="none"/></svg></button>';
        echo '<button data-player="theater" aria-label="Theater mode"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2.6" y="6.4" width="18.8" height="11.2" rx="2.4"/></svg></button>';
        echo '<button data-player="full" aria-label="Full screen"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 9V4.6h4.4M20 9V4.6h-4.4M4 15v4.4h4.4M20 15v4.4h-4.4"/></svg></button>';
        echo '</div></div>';
        }
        echo '</section>';

        /* ---------------- info card ---------------- */
        echo '<section class="wv-card wv-info"><div class="wv-info-top"><div style="flex:1;min-width:0">';
        echo '<h1 class="wv-title">' . esc_html($title) . '</h1>';
        echo '<div class="wv-meta">';
        if ($ticker) {
            echo '<a class="wv-chip" href="' . esc_url(home_url('/ticker/' . strtolower($ticker) . '/')) . '">$' . esc_html($ticker) . '</a>';
        }
        foreach (array_slice($secondary_tickers, 0, 2) as $extra) {
            echo '<a class="wv-chip" href="' . esc_url(home_url('/ticker/' . strtolower($extra) . '/')) . '">$' . esc_html($extra) . '</a>';
        }
        echo '<span>Market Sentiment</span>';
        echo '<span class="wv-sent wv-neutral" data-sentiment><span>Neutral</span><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l7 9h-4.4v7H9.4v-7H5z"/></svg></span>';
        echo '<span class="wv-views"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.8"/></svg><b data-count="views">0 views</b></span>';
        echo '<span>&middot;</span><span>' . esc_html($ago) . '</span>';
        echo '</div>';
        echo '<p class="wv-disclaimer">Disclaimer: Information is for educational purposes only and not financial advice. Markets involve risk.</p>';
        echo '</div>';

        echo '<div class="wv-creator">';
        echo '<a href="' . esc_url($profile_url) . '"><img src="' . esc_url($avatar) . '" alt=""></a>';
        echo '<div><a href="' . esc_url($profile_url) . '" class="wv-creator-name">' . esc_html($creator) . ($verified ? $check : '') . '</a>';
        echo '<div class="wv-creator-sub">' . ($handle ? '@' . esc_html($handle) : '') . '</div></div>';
        echo '<a class="wv-follow" href="' . esc_url($profile_url) . '">Follow</a>';
        echo '<a class="wv-more" href="' . esc_url($profile_url) . '" aria-label="More from this creator"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9.5l6 5.5 6-5.5"/></svg></a>';
        echo '</div></div>';

        echo '<div class="wv-actions">';
        echo '<span class="wv-act-split">';
        echo '<button class="wv-act" data-engage="like"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7.5 10.5V20H4.6V10.5zM10.4 20h6.4c1 0 1.9-.7 2.1-1.7l1.2-5.6c.2-1-.6-2-1.6-2h-4.1l.6-3.2A1.9 1.9 0 0 0 13.2 5l-2.8 5.5z" stroke-linejoin="round"/></svg><b data-count="likes">0</b></button>';
        echo '<span class="wv-divider"></span>';
        echo '<button class="wv-act" data-engage="dislike" aria-label="Dislike"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16.5 13.5V4h2.9v9.5zM13.6 4H7.2c-1 0-1.9.7-2.1 1.7L3.9 11.3c-.2 1 .6 2 1.6 2h4.1l-.6 3.2a1.9 1.9 0 0 0 1.8 2.5l2.8-5.5z" stroke-linejoin="round"/></svg></button>';
        echo '</span>';
        echo '<a class="wv-act" href="#wv-comments-panel"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.4 12.4c0 3.9-3.8 7-8.4 7-1 0-2-.2-2.9-.5L4 20.4l1.6-4.2c-.8-1.1-1.3-2.4-1.3-3.8 0-3.9 3.8-7 8.4-7s7.7 3.1 7.7 7z" stroke-linejoin="round"/></svg><span>Comment</span><b data-count="comments">0</b></a>';
        echo '<button class="wv-act" data-action="share"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.6V19a1.6 1.6 0 0 0 1.6 1.6h12.8A1.6 1.6 0 0 0 20 19v-6.4"/><path d="M12 15V3.6M7.6 8L12 3.6 16.4 8"/></svg><span>Share</span></button>';
        echo '<button class="wv-act" data-engage="save"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6.4 3.6h11.2v16.8L12 16.4l-5.6 4z"/></svg><span data-label="save">Save</span></button>';
        echo '<a class="wv-act-icon" href="' . esc_url($profile_url) . '" aria-label="More options"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg></a>';
        echo '</div></section>';

        /* ---------------- tabs ---------------- */
        echo '<section class="wv-card wv-tabs"><div class="wv-tabs-nav" role="tablist">';
        echo '<button class="wv-tab" role="tab" aria-selected="true" aria-controls="wv-overview-panel"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6.5h16M4 12h16M4 17.5h10"/></svg>Overview</button>';
        echo '<button class="wv-tab" role="tab" aria-selected="false" aria-controls="wv-transcript-panel"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3.4h8.4L19 8v12.6H6z"/><path d="M9 12h7M9 15.6h5" stroke-linecap="round"/></svg>Transcript</button>';
        echo '<button class="wv-tab" role="tab" aria-selected="false" aria-controls="wv-chapters-panel"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M9 6.5h11M9 12h11M9 17.5h11M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01"/></svg>Chapters</button>';
        echo '<button class="wv-tab" role="tab" aria-selected="false" aria-controls="wv-comments-panel"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20.4 12.4c0 3.9-3.8 7-8.4 7-1 0-2-.2-2.9-.5L4 20.4l1.6-4.2c-.8-1.1-1.3-2.4-1.3-3.8 0-3.9 3.8-7 8.4-7s7.7 3.1 7.7 7z"/></svg>Comments<span class="wv-tab-count" data-count="comments-tab">0</span></button>';
        echo '</div>';

        echo '<div class="wv-panel" id="wv-overview-panel" role="tabpanel"><div class="wv-overview"><div>';
        echo '<div class="wv-desc wv-clamped">' . esc_html($description ?: 'No description was added for this video.') . '</div>';
        echo '<button class="wv-showmore"><span>Show more</span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 5.5 6-5.5"/></svg></button>';
        if ($alert_images) {
            echo '<div class="wv-alerts"><div class="wv-alerts-head">Supporting media</div><div class="wv-alerts-grid">';
            foreach (array_slice($alert_images, 0, 6) as $image) {
                echo '<figure class="wv-alert"><img src="' . esc_url($image['url']) . '" alt="" loading="lazy">';
                echo '<figcaption><b>' . esc_html($image['title'] ?: 'Alert') . '</b>';
                if (!empty($image['note'])) {
                    echo '<span>' . esc_html($image['note']) . '</span>';
                }
                echo '</figcaption></figure>';
            }
            echo '</div></div>';
        }
        echo '</div><dl class="wv-facts">';
        echo '<div class="wv-fact"><dt>Published</dt><dd>' . esc_html($published) . '</dd></div>';
        echo '<div class="wv-fact"><dt>Category</dt><dd>Markets &amp; Investing</dd></div>';
        if ($ticker) {
            echo '<div class="wv-fact"><dt>Primary ticker</dt><dd>$' . esc_html($ticker) . '</dd></div>';
        }
        echo '<div class="wv-fact"><dt>Visibility</dt><dd>' . esc_html(ucfirst((string) ($video['visibility'] ?? 'public'))) . '</dd></div>';
        echo '<div class="wv-fact"><dt>License</dt><dd>Standard StockMarketLoop License</dd></div>';
        echo '</dl></div></div>';

        echo '<div class="wv-panel" id="wv-transcript-panel" role="tabpanel" hidden><div class="wv-empty">No transcript has been generated for this video yet.</div></div>';

        echo '<div class="wv-panel" id="wv-chapters-panel" role="tabpanel" hidden>';
        if ($chapters) {
            echo '<div class="wv-chapter-list">';
            foreach ($chapters as $chapter) {
                echo '<button class="wv-chapter" data-seek="' . esc_attr((string) $chapter['seconds']) . '">';
                echo '<span class="wv-chapter-time">' . esc_html($chapter['time']) . '</span>';
                echo '<span class="wv-chapter-label">' . esc_html($chapter['label']) . '</span></button>';
            }
            echo '</div>';
        } else {
            echo '<div class="wv-empty">No chapters were added to this video.</div>';
        }
        echo '</div>';

        echo '<div class="wv-panel" id="wv-comments-panel" role="tabpanel" hidden>';
        if (is_user_logged_in()) {
            echo '<form class="wv-comment-form" data-comments="form"><img src="' . esc_url($viewer['avatar']) . '" alt="">';
            echo '<div class="wv-cf-body"><textarea placeholder="Add a comment..." maxlength="2000"></textarea>';
            echo '<div class="wv-cf-actions"><button type="submit">Comment</button></div></div></form>';
        } else {
            echo '<div class="wv-empty"><a href="' . esc_url($config['loginUrl']) . '" style="color:#63a4ff;font-weight:700">Sign in</a> to join the conversation.</div>';
        }
        echo '<div data-comments="list"></div></div>';
        echo '</section>';

        // Game Panel sits directly under the description / details +
        // comments card, inside the main column.
        if (function_exists('sml_game_panel_markup')) {
            echo sml_game_panel_markup('video', (string) ($video['id'] ?? ''));
        }
        echo '</main>';

        /* ---------------- rail ---------------- */
        echo '<aside class="wv-rail">';

        echo '<section class="wv-card wv-rail-card"><div class="wv-rail-head"><span class="wv-rail-title">Up Next</span>';
        echo '<button class="wv-switch" data-rail="autoplay" role="switch" aria-checked="true">Autoplay<i></i></button></div>';
        echo '<div data-rail="upnext"><div class="wv-empty">Loading...</div></div></section>';

        if ($ticker) {
            echo '<section class="wv-card wv-rail-card"><div class="wv-rail-head"><span class="wv-rail-title">Related to $' . esc_html($ticker) . '</span>';
            echo '<a class="wv-viewall" href="' . esc_url(home_url('/ticker/' . strtolower($ticker) . '/')) . '">View all</a></div>';
            echo '<div data-rail="related"><div class="wv-empty">Loading...</div></div></section>';

            echo '<section class="wv-card wv-rail-card"><div class="wv-rail-head">';
            echo '<span class="wv-live"><i></i>LIVE VOICE ROOM</span>';
            echo '<span class="wv-listening"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 14v-2.4a8 8 0 0 1 16 0V14" stroke-linecap="round"/><rect x="2.8" y="13.4" width="4.4" height="6.2" rx="2.2"/><rect x="16.8" y="13.4" width="4.4" height="6.2" rx="2.2"/></svg><b data-room="count">Checking...</b></span></div>';
            echo '<div class="wv-room-title" data-room="title">$' . esc_html($ticker) . ' Live Voice Room</div>';
            echo '<div class="wv-room-host" data-room="host">Loading room...</div>';
            echo '<div class="wv-room-foot"><span class="wv-stack" data-room="stack"></span>';
            echo '<a class="wv-join" href="' . esc_url(home_url('/ticker/' . strtolower($ticker) . '/?room=1')) . '">Join Room</a></div></section>';

            echo '<section class="wv-card wv-rail-card" data-quote="panel">';
            echo '<div class="wv-quote-head"><span class="wv-quote-sym">$' . esc_html($ticker) . '</span>';
            echo '<span class="wv-quote-name" data-quote="name">' . esc_html($ticker) . '</span>';
            echo '<button aria-label="Add to watchlist"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3.8l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.9l5.8-.8z"/></svg></button>';
            echo '<button aria-label="More"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5.5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="18.5" r="1.7"/></svg></button></div>';
            echo '<div class="wv-quote-body"><div><div class="wv-quote-price wv-skel" data-quote="price">000.00</div>';
            echo '<div class="wv-quote-change wv-skel" data-quote="change">+0.00 (0.00%)</div></div>';
            echo '<div data-quote="spark"></div></div>';
            echo '<dl class="wv-quote-grid">';
            echo '<div><dt>Volume</dt><dd class="wv-skel" data-quote="volume">0</dd></div>';
            echo '<div><dt>Day Range</dt><dd class="wv-skel" data-quote="range">0 - 0</dd></div>';
            echo '<div><dt>Market Cap</dt><dd data-quote="cap">&mdash;</dd></div>';
            echo '<div><dt>52W Range</dt><dd class="wv-skel" data-quote="week">0 - 0</dd></div>';
            echo '</dl></section>';
        }

        echo '</aside></div></div>';
        echo '<script>window.smlWatchConfig=' . wp_json_encode($config) . ';</script>';
        echo '<script>' . sml_vus_watch_script() . '</script>';
        if (function_exists('sml_game_panel_assets')) {
            echo sml_game_panel_assets();
        }
        echo '</body></html>';
        exit;
    }
}

