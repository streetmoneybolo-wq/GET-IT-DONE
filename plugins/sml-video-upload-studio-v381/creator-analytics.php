<?php
/**
 * Feeds real video analytics from the plugin video library into Creator Studio.
 *
 * The sml-members creator-studio/realtime endpoint has no knowledge of videos
 * published through this plugin, so it reported 0 video views. This filters that
 * response and merges in the real per-video numbers the watch page records.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_vus_creator_videos')) {
    /** Every video in the library owned by the given user, newest first. */
    function sml_vus_creator_videos($user_id) {
        $user_id = (int) $user_id;
        if (!$user_id) {
            return array();
        }
        $rows = array();
        foreach (sml_video_upload_studio_library() as $video) {
            if (is_array($video) && (int) ($video['author_id'] ?? 0) === $user_id) {
                $rows[] = $video;
            }
        }
        usort($rows, function ($a, $b) {
            return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
        });
        return $rows;
    }
}

if (!function_exists('sml_vus_ctr')) {
    /** Click-through rate: clicks on a recommended card divided by times it was shown. */
    function sml_vus_ctr($clicks, $impressions) {
        $clicks = (int) $clicks;
        $impressions = (int) $impressions;
        if ($impressions <= 0) {
            return 0;
        }
        return round((min($clicks, $impressions) / $impressions) * 100, 2);
    }
}

if (!function_exists('sml_vus_creator_totals')) {
    function sml_vus_creator_totals($user_id) {
        $totals = array(
            'videos' => 0,
            'views' => 0,
            'impressions' => 0,
            'clicks' => 0,
            'likes' => 0,
            'dislikes' => 0,
            'comments' => 0,
            'saves' => 0,
            'daily' => array(),
            'daily_impressions' => array(),
            'daily_clicks' => array(),
        );

        foreach (sml_vus_creator_videos($user_id) as $video) {
            $totals['videos'] += 1;
            $totals['views'] += (int) ($video['views'] ?? 0);
            $totals['impressions'] += (int) ($video['impressions'] ?? 0);
            $totals['clicks'] += (int) ($video['clicks'] ?? 0);
            $totals['likes'] += count((array) ($video['likes'] ?? array()));
            $totals['dislikes'] += count((array) ($video['dislikes'] ?? array()));
            $totals['comments'] += count((array) ($video['comments'] ?? array()));
            $totals['saves'] += count((array) ($video['saves'] ?? array()));

            foreach ((array) ($video['views_daily'] ?? array()) as $day => $count) {
                $day = (string) $day;
                $totals['daily'][$day] = (int) ($totals['daily'][$day] ?? 0) + (int) $count;
            }
            foreach ((array) ($video['impressions_daily'] ?? array()) as $day => $count) {
                $day = (string) $day;
                $totals['daily_impressions'][$day] = (int) ($totals['daily_impressions'][$day] ?? 0) + (int) $count;
            }
            foreach ((array) ($video['clicks_daily'] ?? array()) as $day => $count) {
                $day = (string) $day;
                $totals['daily_clicks'][$day] = (int) ($totals['daily_clicks'][$day] ?? 0) + (int) $count;
            }
        }

        $totals['engagement'] = $totals['likes'] + $totals['comments'] + $totals['saves'];
        $totals['ctr'] = sml_vus_ctr($totals['clicks'], $totals['impressions']);
        return $totals;
    }
}

if (!function_exists('sml_vus_creator_content_rows')) {
    function sml_vus_creator_content_rows($user_id) {
        $rows = array();
        foreach (sml_vus_creator_videos($user_id) as $video) {
            $views = (int) ($video['views'] ?? 0);
            $impressions = (int) ($video['impressions'] ?? 0);
            $clicks = (int) ($video['clicks'] ?? 0);
            $likes = count((array) ($video['likes'] ?? array()));
            $comments = count((array) ($video['comments'] ?? array()));
            $visibility = (string) ($video['visibility'] ?? 'public');

            $rows[] = array(
                'type' => 'Video',
                'title' => (string) ($video['title'] ?? 'Untitled video'),
                'url' => (string) ($video['watch_url'] ?? ''),
                'status' => ucfirst($visibility),
                'views' => $views,
                'impressions' => $impressions,
                'clicks' => $clicks,
                'ctr' => sml_vus_ctr($clicks, $impressions),
                'revenue' => 0,
                'likes' => $likes,
                'comments' => $comments,
                'ticker' => (string) ($video['ticker'] ?? ''),
                'updated_at' => (string) ($video['updated_at'] ?? ($video['created_at'] ?? '')),
            );
        }
        return $rows;
    }
}

if (!function_exists('sml_vus_filter_creator_realtime')) {
    /**
     * Merge real video numbers into the Creator Studio realtime payload.
     */
    function sml_vus_filter_creator_realtime($response, $server, $request) {
        if (!($response instanceof WP_REST_Response) || !($request instanceof WP_REST_Request)) {
            return $response;
        }
        if (strpos((string) $request->get_route(), '/sml-members/v1/creator-studio/realtime') === false) {
            return $response;
        }

        $data = $response->get_data();
        if (!is_array($data)) {
            return $response;
        }

        $user_id = get_current_user_id();
        if (!$user_id) {
            return $response;
        }

        $totals = sml_vus_creator_totals($user_id);
        if (!$totals['videos']) {
            return $response;
        }

        if (isset($data['overview']) && is_array($data['overview'])) {
            $overview = $data['overview'];
            $overview['video_views'] = (int) ($overview['video_views'] ?? 0) + $totals['views'];
            $overview['views'] = (int) ($overview['views'] ?? 0) + $totals['views'];
            $overview['impressions'] = (int) ($overview['impressions'] ?? 0) + $totals['impressions'];
            $overview['clicks'] = (int) ($overview['clicks'] ?? 0) + $totals['clicks'];
            $overview['engagement'] = (int) ($overview['engagement'] ?? 0) + $totals['engagement'];
            $overview['comments'] = (int) ($overview['comments'] ?? 0) + $totals['comments'];
            $overview['video_count'] = $totals['videos'];
            $overview['video_likes'] = $totals['likes'];
            $overview['video_saves'] = $totals['saves'];
            $overview['video_impressions'] = $totals['impressions'];

            // Recompute CTR against the merged totals rather than leaving the stale value.
            $overview['ctr'] = sml_vus_ctr((int) $overview['clicks'], (int) $overview['impressions']);

            $data['overview'] = $overview;
        }

        // Real per-day video views, keyed by the dates the endpoint already returned.
        if (isset($data['series']) && is_array($data['series'])) {
            foreach ($data['series'] as $index => $point) {
                if (!is_array($point) || empty($point['date'])) {
                    continue;
                }
                $day = (string) $point['date'];
                if (!isset($totals['daily'][$day]) && !isset($totals['daily_impressions'][$day])) {
                    continue;
                }
                $point['views'] = (int) ($point['views'] ?? 0) + (int) ($totals['daily'][$day] ?? 0);
                $point['impressions'] = (int) ($point['impressions'] ?? 0) + (int) ($totals['daily_impressions'][$day] ?? 0);
                $point['clicks'] = (int) ($point['clicks'] ?? 0) + (int) ($totals['daily_clicks'][$day] ?? 0);
                $data['series'][$index] = $point;
            }
        }

        // Put real videos at the top of the content table.
        $video_rows = sml_vus_creator_content_rows($user_id);
        if ($video_rows) {
            $existing = isset($data['content']) && is_array($data['content']) ? $data['content'] : array();
            $data['content'] = array_slice(array_merge($video_rows, $existing), 0, 40);
        }

        // The video revenue tab can at least report real view volume.
        if (isset($data['data_connection_tabs']['ad']['video']) && is_array($data['data_connection_tabs']['ad']['video'])) {
            $video_tab = $data['data_connection_tabs']['ad']['video'];
            if (isset($video_tab['totals']) && is_array($video_tab['totals'])) {
                $video_tab['totals']['video_views'] = (int) ($video_tab['totals']['video_views'] ?? 0) + $totals['views'];
                $video_tab['totals']['impressions'] = (int) ($video_tab['totals']['impressions'] ?? 0) + $totals['impressions'];
                $video_tab['totals']['clicks'] = (int) ($video_tab['totals']['clicks'] ?? 0) + $totals['clicks'];
                $video_tab['totals']['ctr'] = sml_vus_ctr(
                    (int) $video_tab['totals']['clicks'],
                    (int) $video_tab['totals']['impressions']
                );
            }
            $data['data_connection_tabs']['ad']['video'] = $video_tab;
        }

        $data['video_library'] = array(
            'videos' => $totals['videos'],
            'views' => $totals['views'],
            'impressions' => $totals['impressions'],
            'clicks' => $totals['clicks'],
            'ctr' => $totals['ctr'],
            'likes' => $totals['likes'],
            'comments' => $totals['comments'],
            'saves' => $totals['saves'],
        );

        $response->set_data($data);
        return $response;
    }
}
add_filter('rest_post_dispatch', 'sml_vus_filter_creator_realtime', 20, 3);

if (!function_exists('sml_vus_rest_analytics')) {
    function sml_vus_rest_analytics(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        $requested = (int) $request->get_param('user_id');
        if ($requested && $requested !== $user_id && !current_user_can('manage_options')) {
            return new WP_Error('sml_vus_forbidden', 'You can only read your own analytics.', array('status' => 403));
        }
        if ($requested) {
            $user_id = $requested;
        }

        $days = (int) $request->get_param('range');
        $days = $days > 0 && $days <= 365 ? $days : 28;

        $totals = sml_vus_creator_totals($user_id);
        $series = array();
        for ($i = $days - 1; $i >= 0; $i--) {
            $day = gmdate('Y-m-d', time() - ($i * DAY_IN_SECONDS));
            $day_impressions = (int) ($totals['daily_impressions'][$day] ?? 0);
            $day_clicks = (int) ($totals['daily_clicks'][$day] ?? 0);
            $series[] = array(
                'date' => $day,
                'views' => (int) ($totals['daily'][$day] ?? 0),
                'impressions' => $day_impressions,
                'clicks' => $day_clicks,
                'ctr' => sml_vus_ctr($day_clicks, $day_impressions),
            );
        }

        return array(
            'user_id' => $user_id,
            'range_days' => $days,
            'totals' => array(
                'videos' => $totals['videos'],
                'views' => $totals['views'],
                'impressions' => $totals['impressions'],
                'clicks' => $totals['clicks'],
                'ctr' => $totals['ctr'],
                'likes' => $totals['likes'],
                'dislikes' => $totals['dislikes'],
                'comments' => $totals['comments'],
                'saves' => $totals['saves'],
                'engagement' => $totals['engagement'],
            ),
            'series' => $series,
            'videos' => sml_vus_creator_content_rows($user_id),
            'generated_at' => gmdate('c'),
        );
    }
}

if (!function_exists('sml_vus_register_analytics_route')) {
    function sml_vus_register_analytics_route() {
        register_rest_route('sml-video-upload-studio/v1', '/analytics', array(
            'methods' => 'GET',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_vus_rest_analytics',
        ));
    }
}
add_action('rest_api_init', 'sml_vus_register_analytics_route');
