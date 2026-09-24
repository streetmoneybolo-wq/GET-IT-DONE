<?php
/**
 * Loop Distribution - trigger router, share queue and drain worker.
 *
 * Publishing never blocks on a third-party API. An event writes rows and
 * returns; cron drains them. A dead X API costs a retry, not a failed publish.
 */

if (!defined('ABSPATH')) {
    exit;
}

/* ==================================================================
 * Event entry point
 * ================================================================== */

if (!function_exists('sml_dist_event')) {
    /**
     * @param string $event  letter.publish|video.publish|stream.start|replay.ready
     * @param array  $bundle Content bundle from dist-engine.
     */
    function sml_dist_event($event, $bundle) {
        $user_id = (int) ($bundle['author']['id'] ?? 0);
        if (!$user_id) {
            return array();
        }
        if (!sml_dist_can_autoshare($user_id)) {
            return array();
        }

        $rules = sml_dist_rules_for($user_id, $event);
        if (!$rules) {
            return array();
        }

        $seo = sml_dist_seo($bundle);
        $queued = array();
        $stagger = 0;

        foreach ($rules as $rule) {
            $account = sml_dist_account((int) $rule['account_id']);
            if (!$account || $account['status'] !== 'active') {
                continue;
            }
            $enqueued = sml_dist_enqueue(array(
                'user_id'     => $user_id,
                'account_id'  => (int) $account['id'],
                'platform'    => $account['platform'],
                'bundle'      => $bundle,
                'seo'         => $seo,
                'event'       => $event,
                'seed'        => sml_dist_preferred_seed($user_id, $account['platform']),
                'delay'       => (int) $rule['delay_minutes'],
                'stagger'     => $stagger,
                'quiet_start' => $rule['quiet_start'],
                'quiet_end'   => $rule['quiet_end'],
            ));
            if ($enqueued) {
                $queued[] = $enqueued;
                // Identical posts landing on five platforms in the same second
                // is a spam signal on several of them.
                $stagger += 90;
            }
        }
        return $queued;
    }
}
add_action('sml_dist_event', 'sml_dist_event', 10, 2);

if (!function_exists('sml_dist_rules_for')) {
    function sml_dist_rules_for($user_id, $event) {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . sml_dist_table('rules') . "
              WHERE user_id = %d AND event_type = %s",
            $user_id, $event
        ), ARRAY_A) ?: array();

        $by_account = array();
        $enabled = array();
        foreach ($rows as $row) {
            $account_id = (int) $row['account_id'];
            $by_account[$account_id] = true;
            if (!empty($row['enabled'])) {
                $enabled[] = $row;
            }
        }

        // Strict default: connected accounts are supposed to auto-post creator
        // publishes. Missing rule rows usually mean the account was connected
        // before rules existed or the row was lost; synthesize an enabled rule
        // only when the creator has not explicitly disabled that account/event.
        foreach (sml_dist_accounts_for($user_id) as $account) {
            $account_id = (int) ($account['id'] ?? 0);
            if (!$account_id || isset($by_account[$account_id])) {
                continue;
            }
            if (($account['status'] ?? '') !== 'active' || !sml_dist_driver($account['platform'] ?? '')) {
                continue;
            }
            $enabled[] = array(
                'id' => 0,
                'user_id' => (int) $user_id,
                'event_type' => $event,
                'account_id' => $account_id,
                'enabled' => 1,
                'delay_minutes' => 0,
                'quiet_start' => null,
                'quiet_end' => null,
            );
        }

        return $enabled;
    }
}

if (!function_exists('sml_dist_account')) {
    function sml_dist_account($id) {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_dist_table('accounts') . " WHERE id = %d", (int) $id
        ), ARRAY_A);
    }
}

/* ==================================================================
 * Enqueue
 * ================================================================== */

if (!function_exists('sml_dist_enqueue')) {
    function sml_dist_enqueue($args) {
        global $wpdb;
        $table = sml_dist_table('queue');

        $bundle   = $args['bundle'];
        $seo      = $args['seo'];
        $platform = $args['platform'];
        $event    = $args['event'];

        // Blackout beats every other timing rule.
        if ($seo['primary'] && sml_dist_earnings_blackout($seo['primary'])) {
            return null;
        }

        $token = sml_dist_token();
        $link  = sml_dist_share_link($token);

        $variant = sml_dist_build_variant($bundle, $seo, $platform, $event, (int) $args['seed'], $link);
        if (!$variant) {
            return null;
        }

        $card = null;
        if (!empty($variant['needs_image']) || $platform !== 'bluesky') {
            $card = sml_dist_card($bundle, $seo, '', sml_dist_card_platform_aspect($platform));
        } else {
            $card = sml_dist_card($bundle, $seo, '', '1.91:1');
        }
        if ($card) {
            $variant['card_url'] = $card['url'];
        }

        $run_at = sml_dist_run_at($seo, $args);

        $idem_parts = array(
            (int) $args['user_id'], $platform, $bundle['entity_type'],
            (int) $bundle['entity_id'], $event, gmdate('Y-m-d'),
        );
        if (!empty($args["idem_suffix"])) {
            $idem_parts[] = (string) $args["idem_suffix"];
        }
        $idem = sha1(implode("|", $idem_parts));

        $ok = $wpdb->insert($table, array(
            'user_id'         => (int) $args['user_id'],
            'account_id'      => (int) $args['account_id'] ?: null,
            'platform'        => $platform,
            'entity_type'     => $bundle['entity_type'],
            'entity_id'       => (int) $bundle['entity_id'],
            'event_type'      => $event,
            'variant_json'    => wp_json_encode($variant),
            'card_id'         => $card ? (int) $card['id'] : null,
            'share_token'     => $token,
            'status'          => 'queued',
            'run_at'          => $run_at,
            'idempotency_key' => $idem,
        ));

        // Duplicate key means this already went out today. Not an error.
        if (!$ok) {
            return null;
        }

        return array(
            'id'       => (int) $wpdb->insert_id,
            'platform' => $platform,
            'run_at'   => $run_at,
            'token'    => $token,
        );
    }
}

if (!function_exists('sml_dist_run_at')) {
    function sml_dist_run_at($seo, $args) {
        $base = time() + ((int) ($args['delay'] ?? 0) * 60) + (int) ($args['stagger'] ?? 0);

        // A live announcement is only useful while the stream is live. Keep an
        // owner's explicit delay, but never move it into a later market window.
        if (0 === strpos((string) ($args['event'] ?? ''), 'stream.')) {
            return gmdate('Y-m-d H:i:s', $base);
        }

        // Content-type timing only applies when the creator has not set an
        // explicit delay - an explicit instruction always wins over a heuristic.
        if (empty($args['delay'])) {
            $optimal = sml_dist_optimal_time($seo, (int) $args['user_id']);
            if ($optimal) {
                $base = max($base, strtotime($optimal . ' UTC'));
            }
        }

        $run = gmdate('Y-m-d H:i:s', $base);
        return sml_dist_respect_quiet($run, $args['quiet_start'] ?? null, $args['quiet_end'] ?? null);
    }
}

if (!function_exists('sml_dist_respect_quiet')) {
    function sml_dist_respect_quiet($run_at, $start, $end) {
        if (!$start || !$end) {
            return $run_at;
        }
        $t = strtotime($run_at . ' UTC');
        $hhmm = gmdate('H:i', $t);

        $inWindow = ($start <= $end)
            ? ($hhmm >= $start && $hhmm < $end)
            : ($hhmm >= $start || $hhmm < $end);   // window crosses midnight

        if (!$inWindow) {
            return $run_at;
        }
        $release = strtotime(gmdate('Y-m-d', $t) . ' ' . $end . ' UTC');
        if ($release <= $t) {
            $release += DAY_IN_SECONDS;
        }
        return gmdate('Y-m-d H:i:s', $release);
    }
}

/* ==================================================================
 * Drain worker
 * ================================================================== */

if (!function_exists('sml_dist_cron_schedules')) {
    function sml_dist_cron_schedules($schedules) {
        if (!isset($schedules['sml_minute'])) {
            $schedules['sml_minute'] = array('interval' => 60, 'display' => 'Every minute');
        }
        return $schedules;
    }
}
add_filter('cron_schedules', 'sml_dist_cron_schedules');

if (!function_exists('sml_dist_schedule_cron')) {
    function sml_dist_schedule_cron() {
        if (!wp_next_scheduled('sml_dist_drain')) {
            wp_schedule_event(time() + 60, 'sml_minute', 'sml_dist_drain');
        }
        if (!wp_next_scheduled('sml_dist_reap')) {
            wp_schedule_event(time() + 300, 'hourly', 'sml_dist_reap');
        }
        if (!wp_next_scheduled('sml_dist_trial_sweep')) {
            wp_schedule_event(time() + 600, 'twicedaily', 'sml_dist_trial_sweep');
        }
    }
}
add_action('init', 'sml_dist_schedule_cron', 9);

if (!function_exists('sml_dist_drain')) {
    function sml_dist_drain() {
        global $wpdb;
        $table = sml_dist_table('queue');
        $now = sml_dist_now();
        $worker = wp_generate_password(8, false, false);

        // Claim before reading. Overlapping cron runs are normal on WordPress
        // and a read-then-write here would double-post.
        $wpdb->query($wpdb->prepare(
            "UPDATE $table
                SET status = 'sending',
                    locked_until = DATE_ADD(%s, INTERVAL 3 MINUTE),
                    error_code = %s
              WHERE status = 'queued' AND run_at <= %s
              ORDER BY run_at ASC
              LIMIT 8",
            $now, 'lock:' . $worker, $now
        ));

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $table WHERE status = 'sending' AND error_code = %s",
            'lock:' . $worker
        ), ARRAY_A);

        foreach ((array) $rows as $row) {
            sml_dist_send_row($row);
        }
    }
}
add_action('sml_dist_drain', 'sml_dist_drain');

if (!function_exists('sml_dist_send_row')) {
    function sml_dist_send_row($row) {
        global $wpdb;
        $table = sml_dist_table('queue');

        $driver = sml_dist_driver($row['platform']);
        if (!$driver) {
            sml_dist_mark_failed($row, 'no_driver', 'No driver for ' . $row['platform'] . '. Use Composer Handoff.');
            return;
        }

        $account = sml_dist_account((int) $row['account_id']);
        if (!$account) {
            sml_dist_mark_failed($row, 'no_account', 'The linked account is gone. Reconnect it.');
            return;
        }

        $variant = json_decode($row['variant_json'], true);
        $result = call_user_func($driver, $variant, $account, $row);

        if (is_wp_error($result)) {
            $code = $result->get_error_code();
            $data = $result->get_error_data();
            $retryable = is_array($data) ? !empty($data['retryable']) : false;

            if ($code === 'auth') {
                $wpdb->update(sml_dist_table('accounts'),
                    array('status' => 'expired', 'last_error' => $result->get_error_message()),
                    array('id' => (int) $account['id']));
                sml_dist_mark_failed($row, 'auth', $result->get_error_message());
                return;
            }
            if ($retryable && (int) $row['attempts'] < 5) {
                sml_dist_backoff($row, $code, $result->get_error_message());
                return;
            }
            sml_dist_mark_failed($row, $code, $result->get_error_message());
            return;
        }

        $wpdb->update($table, array(
            'status'         => 'sent',
            'remote_post_id' => (string) ($result['remote_id'] ?? ''),
            'permalink'      => (string) ($result['permalink'] ?? ''),
            'sent_at'        => sml_dist_now(),
            'locked_until'   => null,
            'error_code'     => null,
        ), array('id' => (int) $row['id']));

        sml_dist_bump_daily((int) $row['user_id'], $row['platform'], 'posts_sent');
        sml_dist_bump_trial_usage((int) $row['user_id']);
    }
}

if (!function_exists('sml_dist_backoff')) {
    function sml_dist_backoff($row, $code, $message) {
        global $wpdb;
        $attempts = (int) $row['attempts'] + 1;
        $steps = array(60, 300, 1500, 7200, 43200);   // 1m, 5m, 25m, 2h, 12h
        $wait = $steps[min($attempts - 1, count($steps) - 1)];

        $wpdb->update(sml_dist_table('queue'), array(
            'status'        => 'queued',
            'attempts'      => $attempts,
            'run_at'        => gmdate('Y-m-d H:i:s', time() + $wait),
            'locked_until'  => null,
            'error_code'    => $code,
            'error_message' => $message,
        ), array('id' => (int) $row['id']));
    }
}

if (!function_exists('sml_dist_mark_failed')) {
    function sml_dist_mark_failed($row, $code, $message) {
        global $wpdb;
        $wpdb->update(sml_dist_table('queue'), array(
            'status'        => 'failed',
            'locked_until'  => null,
            'error_code'    => $code,
            'error_message' => $message,
        ), array('id' => (int) $row['id']));

        sml_dist_bump_daily((int) $row['user_id'], $row['platform'], 'posts_failed');

        // Silent failure is how creators stop trusting an automation tool.
        // Exactly one notification per failure, with the reason.
        do_action('sml_dist_send_failed', $row, $code, $message);
    }
}

if (!function_exists('sml_dist_reap')) {
    /** Requeue rows whose worker died mid-send. */
    function sml_dist_reap() {
        global $wpdb;
        $wpdb->query(
            "UPDATE " . sml_dist_table('queue') . "
                SET status = 'queued', locked_until = NULL, error_code = NULL
              WHERE status = 'sending' AND locked_until IS NOT NULL AND locked_until < UTC_TIMESTAMP()"
        );
    }
}
add_action('sml_dist_reap', 'sml_dist_reap');

if (!function_exists('sml_dist_bump_daily')) {
    function sml_dist_bump_daily($user_id, $platform, $field) {
        global $wpdb;
        if (!in_array($field, array('posts_sent', 'posts_failed', 'clicks'), true)) {
            return;
        }
        $wpdb->query($wpdb->prepare(
            "INSERT INTO " . sml_dist_table('daily') . " (user_id, day, platform, $field)
             VALUES (%d, %s, %s, 1)
             ON DUPLICATE KEY UPDATE $field = $field + 1",
            (int) $user_id, gmdate('Y-m-d'), $platform
        ));
    }
}

/* ==================================================================
 * Learned defaults
 * ================================================================== */

if (!function_exists('sml_dist_preferred_seed')) {
    /**
     * After 20 sends on a platform, the seed with the best click-through
     * becomes the default. Below that threshold the sample is noise.
     */
    function sml_dist_preferred_seed($user_id, $platform) {
        global $wpdb;
        $q = sml_dist_table('queue');
        $c = sml_dist_table('clicks');

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT q.variant_json, COUNT(DISTINCT c.id) AS clicks
               FROM $q q
          LEFT JOIN $c c ON c.share_token = q.share_token
              WHERE q.user_id = %d AND q.platform = %s AND q.status = 'sent'
           GROUP BY q.id
              LIMIT 200",
            (int) $user_id, $platform
        ), ARRAY_A);

        if (count((array) $rows) < 20) {
            return 0;
        }

        $tally = array();
        foreach ($rows as $r) {
            $v = json_decode($r['variant_json'], true);
            $seed = (int) ($v['seed'] ?? 0);
            if (!isset($tally[$seed])) {
                $tally[$seed] = array('posts' => 0, 'clicks' => 0);
            }
            $tally[$seed]['posts']++;
            $tally[$seed]['clicks'] += (int) $r['clicks'];
        }

        $best = 0;
        $bestRate = -1;
        foreach ($tally as $seed => $t) {
            if ($t['posts'] < 5) {
                continue;
            }
            $rate = $t['clicks'] / $t['posts'];
            if ($rate > $bestRate) {
                $bestRate = $rate;
                $best = $seed;
            }
        }
        return $best;
    }
}

/* ==================================================================
 * Driver registry
 * ================================================================== */

if (!function_exists('sml_dist_driver')) {
    function sml_dist_driver($platform) {
        $drivers = apply_filters('sml_dist_drivers', array());
        return $drivers[$platform] ?? null;
    }
}
