<?php
/**
 * Loop Distribution - REST surface and event wiring.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_dist_routes')) {
    function sml_dist_routes() {
        $ns = 'sml-dist/v1';
        $in = function () { return is_user_logged_in(); };

        register_rest_route($ns, '/status', array(
            'methods' => 'GET', 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_status',
        ));
        register_rest_route($ns, '/accounts', array(
            'methods' => 'GET', 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_accounts',
        ));
        register_rest_route($ns, '/accounts/bluesky', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_link_bluesky',
        ));
        register_rest_route($ns, '/accounts/(?P<id>\d+)/delete', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_unlink',
        ));
        register_rest_route($ns, '/rules', array(
            array('methods' => 'GET', 'permission_callback' => $in, 'callback' => 'sml_dist_rest_rules'),
            array('methods' => 'POST', 'permission_callback' => $in, 'callback' => 'sml_dist_rest_save_rule'),
        ));
        register_rest_route($ns, '/preview', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_preview',
        ));
        register_rest_route($ns, '/share', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_share',
        ));
        register_rest_route($ns, '/queue', array(
            'methods' => 'GET', 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_queue',
        ));
        register_rest_route($ns, '/queue/(?P<id>\d+)/retry', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_retry',
        ));
        register_rest_route($ns, '/queue/(?P<id>\d+)/cancel', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_cancel',
        ));
        register_rest_route($ns, '/stats', array(
            'methods' => 'GET', 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_stats',
        ));
        register_rest_route($ns, '/content', array(
            'methods' => 'GET', 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_content',
        ));
        register_rest_route($ns, '/content/(?P<type>[a-z_]+)/(?P<id>\d+)', array(
            'methods' => 'GET', 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_content_detail',
        ));
        register_rest_route($ns, '/drain', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_dist_rest_drain',
        ));
    }
}
add_action('rest_api_init', 'sml_dist_routes');

/* ==================================================================
 * Status and accounts
 * ================================================================== */

if (!function_exists('sml_dist_rest_status')) {
    function sml_dist_rest_status() {
        $user_id = get_current_user_id();
        return array(
            'entitlements' => sml_dist_entitlements($user_id),
            'upsell'       => sml_dist_upsell($user_id, 'studio'),
            'secrets_ok'   => sml_dist_can_store_secrets(),
            'live'         => sml_dist_live_platforms(),
            'platforms'    => sml_dist_platforms(),
            'integrations' => array(
                'meta' => function_exists('sml_dist_meta_app_secret') && sml_dist_meta_app_secret() !== '',
                'threads' => function_exists('sml_dist_threads_app_secret') && sml_dist_threads_app_secret() !== '',
            ),
            'can_publish'  => function_exists('sml_letters_can_publish') ? sml_letters_can_publish($user_id) : false,
            'cards'        => sml_dist_card_diagnostics(),
        );
    }
}

if (!function_exists('sml_dist_shape_account')) {
    function sml_dist_shape_account($row) {
        $meta = sml_dist_platform($row['platform']);
        return array(
            'id'            => (int) $row['id'],
            'platform'      => $row['platform'],
            'label'         => $meta['label'] ?? $row['platform'],
            'handle'        => $row['handle'],
            'display_name'  => $row['display_name'],
            'status'        => $row['status'],
            'last_error'    => $row['last_error'],
            'last_verified' => $row['last_verified'],
            'created_at'    => $row['created_at'],
        );
    }
}

if (!function_exists('sml_dist_rest_accounts')) {
    function sml_dist_rest_accounts() {
        $rows = sml_dist_accounts_for(get_current_user_id());
        return array('accounts' => array_map('sml_dist_shape_account', $rows));
    }
}

if (!function_exists('sml_dist_rest_link_bluesky')) {
    function sml_dist_rest_link_bluesky(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        $ent = sml_dist_entitlements($user_id);

        if ($ent['linked_count'] >= max(1, $ent['max_accounts']) && $ent['max_accounts'] > 0) {
            return new WP_Error('account_cap',
                'Your plan covers ' . $ent['max_accounts'] . ' accounts.', array('status' => 409));
        }

        $res = sml_dist_bsky_link_account(
            $user_id,
            (string) $request->get_param('handle'),
            (string) $request->get_param('app_password'),
            esc_url_raw((string) $request->get_param('host'))
        );
        if (is_wp_error($res)) {
            return $res;
        }

        // A linked account with no rules does nothing, which reads as broken.
        // Default to auto-sharing letters and streams; the creator can undo it.
        foreach (array('letter.publish', 'video.publish', 'stream.start') as $event) {
            sml_dist_save_rule($user_id, $event, (int) $res['account_id'], true, 0);
        }

        return $res;
    }
}

if (!function_exists('sml_dist_rest_unlink')) {
    function sml_dist_rest_unlink(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $row = sml_dist_account($id);
        if (!$row || (int) $row['user_id'] !== get_current_user_id()) {
            return new WP_Error('not_found', 'Account not found.', array('status' => 404));
        }
        sml_dist_secret_delete($row['access_ref']);
        sml_dist_secret_delete($row['refresh_ref']);
        $wpdb->delete(sml_dist_table('rules'), array('account_id' => $id));
        $wpdb->delete(sml_dist_table('accounts'), array('id' => $id));
        return array('ok' => true);
    }
}

/* ==================================================================
 * Rules
 * ================================================================== */

if (!function_exists('sml_dist_save_rule')) {
    function sml_dist_save_rule($user_id, $event, $account_id, $enabled, $delay) {
        global $wpdb;
        $table = sml_dist_table('rules');
        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT id FROM $table WHERE user_id = %d AND event_type = %s AND account_id = %d",
            (int) $user_id, $event, (int) $account_id
        ), ARRAY_A);

        $data = array(
            'user_id'       => (int) $user_id,
            'event_type'    => $event,
            'account_id'    => (int) $account_id,
            'enabled'       => $enabled ? 1 : 0,
            'delay_minutes' => max(0, min(1440, (int) $delay)),
        );

        if ($existing) {
            $wpdb->update($table, $data, array('id' => (int) $existing['id']));
        } else {
            $wpdb->insert($table, $data);
        }
    }
}

if (!function_exists('sml_dist_rest_rules')) {
    function sml_dist_rest_rules() {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . sml_dist_table('rules') . " WHERE user_id = %d",
            get_current_user_id()
        ), ARRAY_A);
        return array('rules' => array_map(function ($r) {
            return array(
                'id'         => (int) $r['id'],
                'event_type' => $r['event_type'],
                'account_id' => (int) $r['account_id'],
                'enabled'    => (bool) $r['enabled'],
                'delay_minutes' => (int) $r['delay_minutes'],
            );
        }, (array) $rows));
    }
}

if (!function_exists('sml_dist_rest_save_rule')) {
    function sml_dist_rest_save_rule(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        $account_id = (int) $request->get_param('account_id');
        $row = sml_dist_account($account_id);
        if (!$row || (int) $row['user_id'] !== $user_id) {
            return new WP_Error('not_found', 'Account not found.', array('status' => 404));
        }
        $event = sanitize_text_field((string) $request->get_param('event_type'));
        if (!in_array($event, array('letter.publish','video.publish','stream.start','stream.end','replay.ready'), true)) {
            return new WP_Error('bad_event', 'Unknown event.', array('status' => 400));
        }
        sml_dist_save_rule($user_id, $event, $account_id,
            (bool) $request->get_param('enabled'), (int) $request->get_param('delay_minutes'));
        return sml_dist_rest_rules();
    }
}

/* ==================================================================
 * Preview and share
 * ================================================================== */

if (!function_exists('sml_dist_load_bundle')) {
    function sml_dist_load_bundle($entity_type, $entity_id) {
        if ($entity_type === 'letter') {
            global $wpdb;
            $row = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM " . $wpdb->prefix . "sml_letter_posts WHERE id = %d", (int) $entity_id
            ), ARRAY_A);
            if (!$row) {
                return null;
            }
            $user_id = get_current_user_id();
            if ((int) $row['author_id'] !== $user_id && !user_can($user_id, 'manage_options')) {
                return null;
            }
            return sml_dist_bundle_from_letter($row);
        }
        if ($entity_type === 'video') {
            $video = sml_dist_find_video($entity_id);
            if (!$video) {
                return null;
            }
            $user_id = get_current_user_id();
            if ((int) ($video['author_id'] ?? 0) !== $user_id && !user_can($user_id, 'manage_options')) {
                return null;
            }
            return sml_dist_bundle_from_video($video);
        }
        if ($entity_type === 'stream') {
            $stream = sml_dist_find_stream($entity_id);
            if (!$stream) {
                return null;
            }
            $user_id = get_current_user_id();
            if ((int) ($stream['author_id'] ?? 0) !== $user_id && !user_can($user_id, 'manage_options')) {
                return null;
            }
            return sml_dist_bundle_from_stream($stream);
        }
        return apply_filters('sml_dist_load_bundle', null, $entity_type, $entity_id);
    }
}

if (!function_exists('sml_dist_rest_preview')) {
    function sml_dist_rest_preview(WP_REST_Request $request) {
        $entity_type = sanitize_key((string) $request->get_param('entity_type')) ?: 'letter';
        $entity_id = (int) $request->get_param('entity_id');
        $event = sanitize_text_field((string) $request->get_param('event_type')) ?: 'letter.publish';

        $bundle = sml_dist_load_bundle($entity_type, $entity_id);
        if (!$bundle) {
            return new WP_Error('not_found', 'Nothing to preview.', array('status' => 404));
        }

        $seo = sml_dist_seo($bundle);
        $requested = (array) $request->get_param('platforms');
        $platforms = $requested ?: array_keys(sml_dist_platforms());
        $platforms = array_values(array_filter(array_map('sanitize_key', $platforms), 'sml_dist_platform'));

        $token = sml_dist_handoff_token($bundle, $event);
        $link = sml_dist_share_link($token);

        $variants = sml_dist_build_all($bundle, $seo, $platforms, $event, $link);
        $card = sml_dist_card($bundle, $seo, '', '1.91:1');

        return array(
            'seo' => array(
                'primary'      => $seo['primary'],
                'symbols'      => $seo['symbols'],
                'content_type' => $seo['content_type'],
                'tldr'         => $seo['tldr'],
                'hook'         => $seo['hook'],
                'meta_desc'    => $seo['meta_desc'],
                'keywords'     => $seo['keywords'],
                'optimal_time' => sml_dist_optimal_time($seo, get_current_user_id()),
            ),
            'variants' => $variants,
            'handoff'  => sml_dist_handoff_payloads($bundle, $seo, $event),
            'card'     => $card,
            'link'     => $link,
        );
    }
}

if (!function_exists('sml_dist_rest_share')) {
    function sml_dist_rest_share(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        if (!sml_dist_can_autoshare($user_id)) {
            return new WP_Error('not_entitled',
                'Auto-share is paused on your plan. You can still copy posts from the handoff panel.',
                array('status' => 409));
        }

        $entity_type = sanitize_key((string) $request->get_param('entity_type')) ?: 'letter';
        $entity_id = (int) $request->get_param('entity_id');
        $event = sanitize_text_field((string) $request->get_param('event_type')) ?: 'letter.publish';

        $bundle = sml_dist_load_bundle($entity_type, $entity_id);
        if (!$bundle) {
            return new WP_Error('not_found', 'Nothing to share.', array('status' => 404));
        }

        $seo = sml_dist_seo($bundle);
        $wanted = array_map('absint', (array) $request->get_param('account_ids'));
        $seed = max(0, min(2, (int) $request->get_param('seed')));
        $delay = max(0, (int) $request->get_param('delay_minutes'));

        $queued = array();
        $stagger = 0;
        foreach ($wanted as $account_id) {
            $account = sml_dist_account($account_id);
            if (!$account || (int) $account['user_id'] !== $user_id || $account['status'] !== 'active') {
                continue;
            }
            $res = sml_dist_enqueue(array(
                'user_id'    => $user_id,
                'account_id' => (int) $account['id'],
                'platform'   => $account['platform'],
                'bundle'     => $bundle,
                'seo'        => $seo,
                'event'      => $event,
                'seed'       => $seed,
                'delay'      => $delay,
                'stagger'    => $stagger,
            ));
            if ($res) {
                $queued[] = $res;
                $stagger += 90;
            }
        }

        return array('ok' => true, 'queued' => $queued);
    }
}

/* ==================================================================
 * Queue and stats
 * ================================================================== */

if (!function_exists('sml_dist_rest_queue')) {
    function sml_dist_rest_queue(WP_REST_Request $request) {
        global $wpdb;
        $limit = max(1, min(100, (int) $request->get_param('limit') ?: 40));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . sml_dist_table('queue') . "
              WHERE user_id = %d AND platform <> 'handoff'
              ORDER BY created_at DESC LIMIT %d",
            get_current_user_id(), $limit
        ), ARRAY_A);

        return array('queue' => array_map(function ($r) {
            $v = json_decode($r['variant_json'], true);
            return array(
                'id'         => (int) $r['id'],
                'platform'   => $r['platform'],
                'status'     => $r['status'],
                'event_type' => $r['event_type'],
                'entity_id'  => (int) $r['entity_id'],
                'run_at'     => $r['run_at'],
                'sent_at'    => $r['sent_at'],
                'attempts'   => (int) $r['attempts'],
                'permalink'  => $r['permalink'],
                'error'      => $r['error_message'],
                'caption'    => (string) ($v['caption'] ?? ''),
            );
        }, (array) $rows));
    }
}

if (!function_exists('sml_dist_rest_retry')) {
    function sml_dist_rest_retry(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $table = sml_dist_table('queue');
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", $id), ARRAY_A);
        if (!$row || (int) $row['user_id'] !== get_current_user_id()) {
            return new WP_Error('not_found', 'Not found.', array('status' => 404));
        }
        $wpdb->update($table, array(
            'status' => 'queued', 'attempts' => 0, 'run_at' => sml_dist_now(),
            'locked_until' => null, 'error_code' => null, 'error_message' => null,
        ), array('id' => $id));
        return array('ok' => true);
    }
}

if (!function_exists('sml_dist_rest_cancel')) {
    function sml_dist_rest_cancel(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $table = sml_dist_table('queue');
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", $id), ARRAY_A);
        if (!$row || (int) $row['user_id'] !== get_current_user_id()) {
            return new WP_Error('not_found', 'Not found.', array('status' => 404));
        }
        if ($row['status'] === 'sent') {
            return new WP_Error('already_sent', 'That already went out.', array('status' => 400));
        }
        $wpdb->update($table, array('status' => 'skipped', 'error_message' => 'Cancelled.'), array('id' => $id));
        return array('ok' => true);
    }
}

if (!function_exists('sml_dist_rest_drain')) {
    /** Manual kick, because WP-Cron on a low-traffic site can sit idle. */
    function sml_dist_rest_drain() {
        sml_dist_drain();
        return array('ok' => true);
    }
}

if (!function_exists('sml_dist_rest_stats')) {
    function sml_dist_rest_stats(WP_REST_Request $request) {
        global $wpdb;
        $user_id = get_current_user_id();
        $ent = sml_dist_entitlements($user_id);
        $days = (int) $request->get_param('days') ?: 30;
        if ($ent['history_days'] > 0) {
            $days = min($days, $ent['history_days']);
        }
        $since = gmdate('Y-m-d', time() - $days * DAY_IN_SECONDS);

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT platform,
                    SUM(posts_sent) AS sent,
                    SUM(posts_failed) AS failed,
                    SUM(clicks) AS clicks
               FROM " . sml_dist_table('daily') . "
              WHERE user_id = %d AND day >= %s
           GROUP BY platform",
            $user_id, $since
        ), ARRAY_A);

        $by_platform = array();
        $totals = array('sent' => 0, 'failed' => 0, 'clicks' => 0);
        foreach ((array) $rows as $r) {
            $sent = (int) $r['sent'];
            $clicks = (int) $r['clicks'];
            $by_platform[] = array(
                'platform' => $r['platform'],
                'label'    => sml_dist_platform($r['platform'])['label'] ?? $r['platform'],
                'sent'     => $sent,
                'failed'   => (int) $r['failed'],
                'clicks'   => $clicks,
                'ctr'      => $sent > 0 ? round($clicks / $sent, 2) : 0,
            );
            $totals['sent'] += $sent;
            $totals['failed'] += (int) $r['failed'];
            $totals['clicks'] += $clicks;
        }

        usort($by_platform, function ($a, $b) { return $b['clicks'] <=> $a['clicks']; });

        return array(
            'days'        => $days,
            'totals'      => $totals,
            'by_platform' => $by_platform,
            'recap'       => sml_dist_value_recap($user_id),
            'health'      => array_values(array_filter(
                array_map('sml_dist_shape_account', sml_dist_accounts_for($user_id)),
                function ($a) { return $a['status'] !== 'active'; }
            )),
        );
    }
}

if (!function_exists('sml_dist_find_video')) {
    function sml_dist_find_video($entity_id) {
        if (!function_exists('sml_video_upload_studio_library')) {
            return null;
        }
        $entity_id = (int) $entity_id;
        foreach (sml_video_upload_studio_library() as $video) {
            if (!is_array($video)) {
                continue;
            }
            $dist_id = function_exists('sml_dist_numeric_entity_id')
                ? sml_dist_numeric_entity_id('video', $video['dist_entity_id'] ?? ($video['id'] ?? ''), $video['watch_url'] ?? '')
                : (int) ($video['dist_entity_id'] ?? 0);
            if ($dist_id === $entity_id) {
                $video['dist_entity_id'] = $dist_id;
                return $video;
            }
        }
        return null;
    }
}

if (!function_exists('sml_dist_stream_library')) {
    function sml_dist_stream_library($user_id = 0) {
        $user_id = $user_id ?: get_current_user_id();
        $streams = get_user_meta((int) $user_id, 'sml_dist_stream_library', true);
        return is_array($streams) ? $streams : array();
    }
}

if (!function_exists('sml_dist_find_stream')) {
    function sml_dist_find_stream($entity_id) {
        $entity_id = (int) $entity_id;
        $user_ids = array(get_current_user_id());
        if (current_user_can('manage_options')) {
            $user_ids = array_values(array_unique(array_filter(array_merge($user_ids, get_users(array('fields' => 'ID'))))));
        }
        foreach ($user_ids as $user_id) {
            foreach (sml_dist_stream_library((int) $user_id) as $stream) {
                if (!is_array($stream)) {
                    continue;
                }
                $dist_id = function_exists('sml_dist_numeric_entity_id')
                    ? sml_dist_numeric_entity_id('stream', $stream['dist_entity_id'] ?? ($stream['id'] ?? $stream['session_id'] ?? ''), (int) $user_id . '|' . ($stream['started_at'] ?? ''))
                    : (int) ($stream['dist_entity_id'] ?? 0);
                if ($dist_id === $entity_id) {
                    $stream['dist_entity_id'] = $dist_id;
                    $stream['author_id'] = (int) ($stream['author_id'] ?? $user_id);
                    return $stream;
                }
            }
        }
        return null;
    }
}

if (!function_exists('sml_dist_shape_content_item')) {
    function sml_dist_shape_content_item($type, $id, $title, $url, $status, $published_at, $thumb = '') {
        return array(
            'type' => $type,
            'id' => (int) $id,
            'title' => (string) $title,
            'url' => esc_url_raw((string) $url),
            'status' => (string) $status,
            'published_at' => (string) $published_at,
            'thumbnail' => esc_url_raw((string) $thumb),
        );
    }
}

if (!function_exists('sml_dist_rest_content')) {
    function sml_dist_rest_content(WP_REST_Request $request) {
        global $wpdb;
        $user_id = get_current_user_id();
        $items = array();

        $letters_table = $wpdb->prefix . 'sml_letter_posts';
        $letters = $wpdb->get_results($wpdb->prepare(
            "SELECT id,title,slug,status,published_at,cover_url FROM $letters_table
              WHERE author_id = %d AND status = 'published'
              ORDER BY published_at DESC LIMIT 80",
            $user_id
        ), ARRAY_A);
        foreach ((array) $letters as $row) {
            $items[] = sml_dist_shape_content_item(
                'letter',
                (int) $row['id'],
                $row['title'],
                function_exists('sml_letters_url') ? sml_letters_url($row + array('author_id' => $user_id)) : '',
                $row['status'],
                $row['published_at'],
                $row['cover_url']
            );
        }

        if (function_exists('sml_video_upload_studio_library')) {
            foreach (sml_video_upload_studio_library() as $video) {
                if (!is_array($video) || (int) ($video['author_id'] ?? 0) !== $user_id) {
                    continue;
                }
                $dist_id = function_exists('sml_dist_numeric_entity_id')
                    ? sml_dist_numeric_entity_id('video', $video['dist_entity_id'] ?? ($video['id'] ?? ''), $video['watch_url'] ?? '')
                    : (int) ($video['dist_entity_id'] ?? 0);
                $items[] = sml_dist_shape_content_item(
                    'video',
                    $dist_id,
                    $video['title'] ?? 'Uploaded video',
                    $video['watch_url'] ?? '',
                    $video['visibility'] ?? 'public',
                    $video['created_at'] ?? '',
                    $video['thumbnail_url'] ?? ($video['thumbnail'] ?? '')
                );
            }
        }

        foreach (sml_dist_stream_library($user_id) as $stream) {
            if (!is_array($stream)) {
                continue;
            }
            $dist_id = function_exists('sml_dist_numeric_entity_id')
                ? sml_dist_numeric_entity_id('stream', $stream['dist_entity_id'] ?? ($stream['id'] ?? $stream['session_id'] ?? ''), $user_id . '|' . ($stream['started_at'] ?? ''))
                : (int) ($stream['dist_entity_id'] ?? 0);
            $items[] = sml_dist_shape_content_item(
                'stream',
                $dist_id,
                $stream['title'] ?? 'Live stream',
                $stream['watch_url'] ?? '',
                $stream['visibility'] ?? 'public',
                $stream['started_at'] ?? '',
                $stream['thumbnail_url'] ?? ''
            );
        }

        usort($items, function ($a, $b) {
            return strcmp((string) $b['published_at'], (string) $a['published_at']);
        });
        return array('content' => array_slice($items, 0, 160));
    }
}

if (!function_exists('sml_dist_rest_content_detail')) {
    function sml_dist_rest_content_detail(WP_REST_Request $request) {
        global $wpdb;
        $user_id = get_current_user_id();
        $type = sanitize_key((string) $request->get_param('type'));
        $id = (int) $request->get_param('id');
        if (!in_array($type, array('letter', 'video', 'stream'), true) || $id < 1) {
            return new WP_Error('bad_content', 'Choose a valid distributed item.', array('status' => 400));
        }

        $bundle = sml_dist_load_bundle($type, $id);
        if (!$bundle) {
            return new WP_Error('not_found', 'Content not found.', array('status' => 404));
        }

        $q = sml_dist_table('queue');
        $c = sml_dist_table('clicks');
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT q.id,q.platform,q.status,q.event_type,q.run_at,q.sent_at,q.permalink,q.remote_post_id,q.error_message,q.share_token,
                    COUNT(DISTINCT c.id) AS clicks
               FROM $q q
          LEFT JOIN $c c ON c.share_token = q.share_token
              WHERE q.user_id = %d AND q.entity_type = %s AND q.entity_id = %d
           GROUP BY q.id
           ORDER BY FIELD(q.status,'sent','queued','sending','failed','handoff','skipped'), q.created_at DESC",
            $user_id, $type, $id
        ), ARRAY_A);

        $platforms = array();
        $totals = array('sent' => 0, 'queued' => 0, 'failed' => 0, 'handoff' => 0, 'clicks' => 0);
        foreach ((array) $rows as $row) {
            $platform = $row['platform'];
            $status = $row['status'];
            $clicks = (int) $row['clicks'];
            if (!isset($totals[$status])) {
                $totals[$status] = 0;
            }
            $totals[$status]++;
            $totals['clicks'] += $clicks;
            $meta = $platform === 'handoff' ? array('label' => 'Manual handoff link') : sml_dist_platform($platform);
            $platforms[] = array(
                'queue_id' => (int) $row['id'],
                'platform' => $platform,
                'label' => $meta['label'] ?? $platform,
                'status' => $status,
                'event_type' => $row['event_type'],
                'run_at' => $row['run_at'],
                'sent_at' => $row['sent_at'],
                'permalink' => esc_url_raw((string) $row['permalink']),
                'remote_post_id' => (string) $row['remote_post_id'],
                'error' => (string) $row['error_message'],
                'clicks' => $clicks,
                'tracking_link' => function_exists('sml_dist_share_link') ? sml_dist_share_link($row['share_token']) : '',
            );
        }

        return array(
            'content' => array(
                'type' => $type,
                'id' => $id,
                'title' => $bundle['title'],
                'url' => $bundle['url'],
            ),
            'totals' => $totals,
            'platforms' => $platforms,
        );
    }
}

/* ==================================================================
 * Event wiring
 *
 * sml_letters_do_publish fires this after the letter is fully committed.
 * Publishing must not wait on distribution.
 * ================================================================== */

if (!function_exists('sml_dist_on_letter_published')) {
    function sml_dist_on_letter_published($letter_id, $stale_row = null) {
        global $wpdb;
        // Always re-read. The action passes the row as it was *before* the
        // publish update, so its status is still 'draft'.
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . $wpdb->prefix . "sml_letter_posts WHERE id = %d", (int) $letter_id
        ), ARRAY_A);
        if (!$row || $row['status'] !== 'published') {
            return;
        }
        delete_transient('sml_dist_seo_' . (int) $letter_id);
        do_action('sml_dist_event', 'letter.publish', sml_dist_bundle_from_letter($row));
    }
}
add_action('sml_letters_published', 'sml_dist_on_letter_published', 10, 2);

if (!function_exists('sml_dist_notify_failure')) {
    function sml_dist_notify_failure($row, $code, $message) {
        $label = sml_dist_platform($row['platform'])['label'] ?? $row['platform'];
        $note = get_user_meta((int) $row['user_id'], 'sml_dist_notices', true);
        $note = is_array($note) ? $note : array();
        array_unshift($note, array(
            'time'     => sml_dist_now(),
            'platform' => $row['platform'],
            'label'    => $label,
            'code'     => $code,
            'message'  => $message,
            'queue_id' => (int) $row['id'],
        ));
        update_user_meta((int) $row['user_id'], 'sml_dist_notices', array_slice($note, 0, 20));
    }
}
add_action('sml_dist_send_failed', 'sml_dist_notify_failure', 10, 3);
