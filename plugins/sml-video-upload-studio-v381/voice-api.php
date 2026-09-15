<?php
/**
 * SuperChat Voice Call-In - control plane.
 * Wallet adapter, SuperChat settlement, tokens, queue, sessions, moderation, sweeper.
 */

if (!defined('ABSPATH')) {
    exit;
}

/* ==================================================================
 * Wallet adapter
 *
 * Loop Bucks balance lives outside this plugin. Rather than guess at
 * its storage, every read and write goes through a filter that the
 * site can override. The default implementation walks a list of
 * candidate user-meta keys and uses whichever one actually holds the
 * balance, which is discoverable via /diagnostics/wallet.
 * ================================================================== */

if (!function_exists('sml_voice_wallet_meta_keys')) {
    function sml_voice_wallet_meta_keys() {
        $keys = array(
            'sml_loop_bucks',
            'loop_bucks',
            'sml_loop_bucks_balance',
            'loop_bucks_balance',
            'sml_wallet_balance',
            'sml_credits',
        );
        $stored = get_option('sml_voice_wallet_meta_key', '');
        if ($stored) {
            array_unshift($keys, $stored);
        }
        return array_values(array_unique(apply_filters('sml_voice_wallet_meta_keys', $keys)));
    }
}

if (!function_exists('sml_voice_wallet_balance')) {
    function sml_voice_wallet_balance($user_id) {
        $override = apply_filters('sml_voice_wallet_balance', null, $user_id);
        if ($override !== null) {
            return (int) $override;
        }
        foreach (sml_voice_wallet_meta_keys() as $key) {
            $value = get_user_meta($user_id, $key, true);
            if ($value !== '' && $value !== false && is_numeric($value)) {
                return (int) $value;
            }
        }
        return 0;
    }
}

if (!function_exists('sml_voice_wallet_active_key')) {
    function sml_voice_wallet_active_key($user_id) {
        foreach (sml_voice_wallet_meta_keys() as $key) {
            $value = get_user_meta($user_id, $key, true);
            if ($value !== '' && $value !== false && is_numeric($value)) {
                return $key;
            }
        }
        return '';
    }
}

if (!function_exists('sml_voice_wallet_debit')) {
    /**
     * Atomically debit Loop Bucks. Returns the new balance or WP_Error.
     * The conditional UPDATE is the lock - no read-then-write race.
     */
    function sml_voice_wallet_debit($user_id, $amount, $reference) {
        $amount = (int) $amount;
        if ($amount <= 0) {
            return new WP_Error('sml_voice_bad_amount', 'Invalid amount.', array('status' => 400));
        }

        $handled = apply_filters('sml_voice_wallet_debit', null, $user_id, $amount, $reference);
        if ($handled !== null) {
            return is_wp_error($handled) ? $handled : (int) $handled;
        }

        global $wpdb;
        $key = sml_voice_wallet_active_key($user_id);
        if (!$key) {
            return new WP_Error(
                'sml_voice_wallet_missing',
                'No Loop Bucks wallet found for this account.',
                array('status' => 409)
            );
        }

        $updated = $wpdb->query($wpdb->prepare(
            "UPDATE {$wpdb->usermeta}
                SET meta_value = CAST(meta_value AS SIGNED) - %d
              WHERE user_id = %d
                AND meta_key = %s
                AND CAST(meta_value AS SIGNED) >= %d",
            $amount, $user_id, $key, $amount
        ));

        if (!$updated) {
            return new WP_Error(
                'sml_voice_insufficient',
                'Not enough Loop Bucks for this tier.',
                array('status' => 409)
            );
        }

        wp_cache_delete($user_id, 'user_meta');
        return sml_voice_wallet_balance($user_id);
    }
}

if (!function_exists('sml_voice_wallet_credit')) {
    function sml_voice_wallet_credit($user_id, $amount, $reference) {
        $amount = (int) $amount;
        if ($amount <= 0) {
            return 0;
        }
        $handled = apply_filters('sml_voice_wallet_credit', null, $user_id, $amount, $reference);
        if ($handled !== null) {
            return (int) $handled;
        }
        global $wpdb;
        $key = sml_voice_wallet_active_key($user_id);
        if (!$key) {
            return 0;
        }
        $wpdb->query($wpdb->prepare(
            "UPDATE {$wpdb->usermeta}
                SET meta_value = CAST(meta_value AS SIGNED) + %d
              WHERE user_id = %d AND meta_key = %s",
            $amount, $user_id, $key
        ));
        wp_cache_delete($user_id, 'user_meta');
        return sml_voice_wallet_balance($user_id);
    }
}

/* ==================================================================
 * Helpers
 * ================================================================== */

if (!function_exists('sml_voice_log')) {
    function sml_voice_log($room_id, $session_uid, $actor_id, $event, $payload = array()) {
        global $wpdb;
        $wpdb->insert(sml_voice_table('events'), array(
            'room_id' => $room_id,
            'session_uid' => $session_uid,
            'actor_id' => (int) $actor_id,
            'event' => $event,
            'payload' => wp_json_encode($payload),
        ));
    }
}

if (!function_exists('sml_voice_tier')) {
    function sml_voice_tier($slug_or_id) {
        global $wpdb;
        $table = sml_voice_table('tiers');
        if (is_numeric($slug_or_id)) {
            return $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", $slug_or_id), ARRAY_A);
        }
        return $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE slug = %s AND active = 1", $slug_or_id), ARRAY_A);
    }
}

if (!function_exists('sml_voice_tiers')) {
    function sml_voice_tiers() {
        global $wpdb;
        $table = sml_voice_table('tiers');
        $rows = $wpdb->get_results("SELECT * FROM $table WHERE active = 1 ORDER BY priority ASC, min_loop_bucks ASC", ARRAY_A);
        return array_map(function ($row) {
            return array(
                'slug' => $row['slug'],
                'label' => $row['label'],
                'loop_bucks' => (int) $row['min_loop_bucks'],
                'amount_cents' => (int) $row['min_amount_cents'],
                'seconds' => (int) $row['speak_seconds'],
                'priority' => (int) $row['priority'],
                'members_only' => (bool) $row['members_only'],
                'cooldown_seconds' => (int) $row['cooldown_seconds'],
            );
        }, $rows ?: array());
    }
}

if (!function_exists('sml_voice_room_host')) {
    /** Resolve the host of a live room or group room. */
    function sml_voice_room_host($room_id) {
        global $wpdb;
        $room_id = (string) $room_id;
        if ($room_id !== '' && ctype_digit($room_id)) {
            $live_table = $wpdb->prefix . 'sml_group_live_rooms';
            $exists = (bool) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $live_table));
            if ($exists) {
                $host_id = $wpdb->get_var($wpdb->prepare("SELECT host_id FROM $live_table WHERE id = %d", (int) $room_id));
                if ($host_id) {
                    return (int) $host_id;
                }
            }
        }
        $group_id = 0;
        if (preg_match('/^g(\d+)/', $room_id, $m)) {
            $group_id = (int) $m[1];
        } elseif (ctype_digit($room_id)) {
            $live_table = $wpdb->prefix . 'sml_group_live_rooms';
            $exists = (bool) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $live_table));
            if ($exists) {
                $group_id = (int) $wpdb->get_var($wpdb->prepare("SELECT group_id FROM $live_table WHERE id = %d", (int) $room_id));
            }
        }
        if (!$group_id) {
            /* Creator rooms on /live/ are keyed by the creator's public handle (or creator-{uid}); without this the
               host was 0, so creator pricing/levels were never read and a non-admin creator could not moderate
               their own queue (2026-09-15). */
            if (preg_match('/^creator-(\d+)$/', $room_id, $cm)) { return (int) $cm[1]; }
            if (function_exists('sml_ppe_user_id_by_handle')) {
                $uid = (int) sml_ppe_user_id_by_handle($room_id);
                if ($uid > 0) { return $uid; }
            }
            return 0;
        }
        $table = $wpdb->prefix . 'sml_groups';
        $owner = $wpdb->get_var($wpdb->prepare("SELECT owner_id FROM $table WHERE id = %d", $group_id));
        return (int) $owner;
    }
}

if (!function_exists('sml_voice_can_moderate')) {
    function sml_voice_can_moderate($room_id, $user_id = 0) {
        $user_id = $user_id ?: get_current_user_id();
        if (!$user_id) {
            return false;
        }
        if (user_can($user_id, 'manage_options')) {
            return true;
        }
        if ((int) sml_voice_room_host($room_id) === (int) $user_id) {
            return true;
        }
        // Reuse the existing group role model where it is available.
        if (function_exists('sml_groups_current_user_can_manage')) {
            $group_id = preg_match('/^g(\d+)/', (string) $room_id, $m) ? (int) $m[1] : 0;
            if ($group_id && sml_groups_current_user_can_manage($group_id)) {
                return true;
            }
        }
        return false;
    }
}

if (!function_exists('sml_voice_is_banned')) {
    function sml_voice_is_banned($user_id, $room_id) {
        global $wpdb;
        $table = sml_voice_table('bans');
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table
              WHERE user_id = %d
                AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
                AND (scope = 'global' OR (scope = 'room' AND scope_ref = %s))
              LIMIT 1",
            $user_id, $room_id
        ), ARRAY_A);
        return $row ?: null;
    }
}

if (!function_exists('sml_voice_cooldown_until')) {
    function sml_voice_cooldown_until($user_id, $room_id) {
        global $wpdb;
        $table = sml_voice_table('cooldowns');
        $until = $wpdb->get_var($wpdb->prepare(
            "SELECT until_at FROM $table WHERE user_id = %d AND room_id = %s AND until_at > UTC_TIMESTAMP()",
            $user_id, $room_id
        ));
        return $until ?: '';
    }
}

if (!function_exists('sml_voice_queue_rows')) {
    function sml_voice_queue_rows($room_id) {
        global $wpdb;
        $table = sml_voice_table('queue');
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $table
              WHERE room_id = %s AND status = 'waiting'
              ORDER BY priority DESC, requested_at ASC
              LIMIT 50",
            $room_id
        ), ARRAY_A);

        $host_for_levels = (int) sml_voice_room_host($room_id);
        return array_map(function ($row) use ($host_for_levels) {
            return array(
                'level' => sml_voice_level_for($host_for_levels, (int) $row['loop_bucks']),
                'id' => (int) $row['id'],
                'user_id' => (int) $row['user_id'],
                'display_name' => $row['display_name'],
                'avatar_url' => $row['avatar_url'],
                'message' => $row['message'],
                'amount_cents' => (int) $row['amount_cents'],
                'loop_bucks' => (int) $row['loop_bucks'],
                'priority' => (int) $row['priority'],
                'mic_ready' => (bool) $row['mic_ready'],
                'clip_url' => isset($row['clip_url']) ? (string) $row['clip_url'] : '',
                'clip_seconds' => isset($row['clip_seconds']) ? (int) $row['clip_seconds'] : 0,
                'waiting_seconds' => max(0, time() - strtotime($row['requested_at'] . ' UTC')),
            );
        }, $rows ?: array());
    }
}

if (!function_exists('sml_voice_active_session')) {
    function sml_voice_active_session($room_id) {
        global $wpdb;
        $table = sml_voice_table('sessions');
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table
              WHERE room_id = %s AND state IN ('connecting','speaking','muted')
              ORDER BY id DESC LIMIT 1",
            $room_id
        ), ARRAY_A);
        return $row ? sml_voice_session_public($row) : null;
    }
}

if (!function_exists('sml_voice_session_public')) {
    function sml_voice_session_public($row) {
        $remaining = 0;
        if (!empty($row['hard_deadline'])) {
            $remaining = max(0, strtotime($row['hard_deadline'] . ' UTC') - time());
        } elseif ($row['state'] === 'connecting') {
            $remaining = (int) $row['granted_seconds'];
        }
        $user = get_userdata((int) $row['user_id']);
        return array(
            'session_uid' => $row['session_uid'],
            'room_id' => $row['room_id'],
            'user_id' => (int) $row['user_id'],
            'display_name' => $user ? ($user->display_name ?: $user->user_login) : 'Caller',
            'avatar_url' => get_avatar_url((int) $row['user_id'], array('size' => 96)),
            'state' => $row['state'],
            'muted' => (bool) $row['muted'],
            'gain' => (float) $row['gain'],
            'granted_seconds' => (int) $row['granted_seconds'],
            'remaining_seconds' => $remaining,
            'started_at' => $row['started_at'],
        );
    }
}

/* ==================================================================
 * Session lifecycle
 * ================================================================== */

if (!function_exists('sml_voice_end_session')) {
    function sml_voice_end_session($session_uid, $reason) {
        global $wpdb;
        $table = sml_voice_table('sessions');
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE session_uid = %s", $session_uid), ARRAY_A);
        if (!$row || $row['state'] === 'ended') {
            return false;   // idempotent
        }

        $spoken = 0;
        if (!empty($row['started_at'])) {
            $spoken = max(0, time() - strtotime($row['started_at'] . ' UTC'));
        }
        $spoken = min($spoken, (int) $row['granted_seconds'] + 5);

        $wpdb->update($table, array(
            'state' => 'ended',
            'ended_at' => gmdate('Y-m-d H:i:s'),
            'end_reason' => $reason,
            'spoken_seconds' => $spoken,
        ), array('session_uid' => $session_uid));

        // Cooldown starts when the slot is released, not when it was granted.
        $tier = sml_voice_tier((int) $wpdb->get_var($wpdb->prepare(
            "SELECT tier_id FROM " . sml_voice_table('tokens') . " WHERE id = %d", $row['token_id'])));
        $cooldown = $tier ? (int) $tier['cooldown_seconds'] : 600;
        if ($cooldown > 0) {
            $wpdb->query($wpdb->prepare(
                "INSERT INTO " . sml_voice_table('cooldowns') . " (user_id, room_id, until_at)
                 VALUES (%d, %s, DATE_ADD(UTC_TIMESTAMP(), INTERVAL %d SECOND))
                 ON DUPLICATE KEY UPDATE until_at = VALUES(until_at)",
                $row['user_id'], $row['room_id'], $cooldown
            ));
        }

        sml_voice_log($row['room_id'], $session_uid, 0, 'end:' . $reason, array('spoken' => $spoken));

        // Refund when the caller never actually got to speak.
        if (in_array($reason, array('error', 'no_connect'), true) || $spoken < 2) {
            sml_voice_refund((int) $row['token_id'], $reason);
        }
        return true;
    }
}

if (!function_exists('sml_voice_refund')) {
    function sml_voice_refund($token_id, $reason) {
        global $wpdb;
        $tokens = sml_voice_table('tokens');
        $charges = sml_voice_table('superchats');

        $token = $wpdb->get_row($wpdb->prepare("SELECT * FROM $tokens WHERE id = %d", $token_id), ARRAY_A);
        if (!$token) {
            return false;
        }
        $charge = $wpdb->get_row($wpdb->prepare("SELECT * FROM $charges WHERE id = %d", $token['superchat_id']), ARRAY_A);
        if (!$charge || $charge['status'] === 'refunded') {
            return false;
        }

        if ($charge['rail'] === 'loop_bucks' && (int) $charge['loop_bucks'] > 0) {
            sml_voice_wallet_credit((int) $charge['user_id'], (int) $charge['loop_bucks'], 'voice_refund:' . $token_id);
        }

        $wpdb->update($charges, array(
            'status' => 'refunded',
            'refunded_at' => gmdate('Y-m-d H:i:s'),
        ), array('id' => $charge['id']));

        sml_voice_log($token['room_id'], null, 0, 'refund', array(
            'reason' => $reason,
            'loop_bucks' => (int) $charge['loop_bucks'],
        ));
        return true;
    }
}

if (!function_exists('sml_voice_sweep')) {
    /**
     * Authoritative timer. In-page timers cannot be trusted, so the
     * server closes anything past its deadline regardless of clients.
     */
    function sml_voice_sweep() {
        global $wpdb;
        $sessions = sml_voice_table('sessions');

        $expired = $wpdb->get_col(
            "SELECT session_uid FROM $sessions
              WHERE state IN ('speaking','muted')
                AND hard_deadline IS NOT NULL
                AND hard_deadline < UTC_TIMESTAMP()
              LIMIT 25"
        );
        foreach ($expired as $uid) {
            sml_voice_end_session($uid, 'timer');
        }

        // Approved but never published audio within 45s - free the slot.
        $stalled = $wpdb->get_col(
            "SELECT session_uid FROM $sessions
              WHERE state = 'connecting'
                AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 45 SECOND)
              LIMIT 25"
        );
        foreach ($stalled as $uid) {
            sml_voice_end_session($uid, 'no_connect');
        }

        // Expire stale queue entries and unused tokens.
        $wpdb->query(
            "UPDATE " . sml_voice_table('queue') . "
                SET status = 'expired'
              WHERE status = 'waiting'
                AND requested_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR)"
        );
        $wpdb->query(
            "UPDATE " . sml_voice_table('tokens') . "
                SET status = 'expired'
              WHERE status IN ('unused','queued') AND expires_at < UTC_TIMESTAMP()"
        );
    }
}
add_action('sml_voice_sweep_event', 'sml_voice_sweep');

if (!function_exists('sml_voice_schedule_sweeper')) {
    function sml_voice_schedule_sweeper() {
        if (!wp_next_scheduled('sml_voice_sweep_event')) {
            wp_schedule_event(time() + 60, 'sml_voice_minute', 'sml_voice_sweep_event');
        }
    }
}
add_action('init', 'sml_voice_schedule_sweeper', 20);

add_filter('cron_schedules', function ($schedules) {
    $schedules['sml_voice_minute'] = array('interval' => 60, 'display' => 'Every minute (voice call-in)');
    return $schedules;
});

// WP-Cron only fires on traffic, so also sweep opportunistically on voice requests.
if (!function_exists('sml_voice_sweep_throttled')) {
    function sml_voice_sweep_throttled() {
        $last = (int) get_transient('sml_voice_last_sweep');
        if ($last && (time() - $last) < 5) {
            return;
        }
        set_transient('sml_voice_last_sweep', time(), 60);
        sml_voice_sweep();
    }
}

/* ==================================================================
 * REST API
 * ================================================================== */

if (!function_exists('sml_voice_rest_eligibility')) {
    function sml_voice_rest_eligibility(WP_REST_Request $request) {
        global $wpdb;
        sml_voice_sweep_throttled();

        $room_id = sanitize_text_field((string) $request->get_param('room_id'));
        $user_id = get_current_user_id();
        $settings = sml_voice_room_settings($room_id);
        $host_id = (int) sml_voice_room_host($room_id);
        $membership_locked = !empty($settings['members_only'])
            && (!$user_id || !function_exists('sml_gl_user_has_content_access') || !sml_gl_user_has_content_access($user_id, $host_id));

        $tokens = array();
        if ($user_id) {
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT t.token, t.speak_seconds, t.priority, ti.slug, ti.label
                   FROM " . sml_voice_table('tokens') . " t
                   JOIN " . sml_voice_table('tiers') . " ti ON ti.id = t.tier_id
                  WHERE t.user_id = %d AND t.room_id = %s AND t.status = 'unused'
                    AND t.expires_at > UTC_TIMESTAMP()
                  ORDER BY t.priority DESC, t.id ASC",
                $user_id, $room_id
            ), ARRAY_A);
            foreach ($rows ?: array() as $row) {
                $tokens[] = array(
                    'token' => $row['token'],
                    'tier' => $row['slug'],
                    'label' => $row['label'],
                    'seconds' => (int) $row['speak_seconds'],
                    'priority' => (int) $row['priority'],
                );
            }
        }

        $ban = $user_id ? sml_voice_is_banned($user_id, $room_id) : null;
        $queued = null;
        if ($user_id) {
            $queued = $wpdb->get_row($wpdb->prepare(
                "SELECT id, priority, requested_at FROM " . sml_voice_table('queue') . "
                  WHERE user_id = %d AND room_id = %s AND status = 'waiting'",
                $user_id, $room_id
            ), ARRAY_A);
        }

        return array(
            'logged_in' => (bool) $user_id,
            'enabled' => (bool) $settings['enabled'],
            'membership_locked' => (bool) $membership_locked,
            'banned' => (bool) $ban,
            'ban_reason' => $ban['reason'] ?? '',
            'cooldown_until' => $user_id ? sml_voice_cooldown_until($user_id, $room_id) : '',
            'balance' => $user_id ? sml_voice_wallet_balance($user_id) : 0,
            'tokens' => $tokens,
            'tiers' => sml_voice_tiers_for_room($room_id),
            'queue_depth' => count(sml_voice_queue_rows($room_id)),
            'queue_position' => $queued ? sml_voice_queue_position((int) $queued['id']) : 0,
            'queue_id' => $queued ? (int) $queued['id'] : 0,
            'last_decision' => sml_voice_last_decision($user_id, $room_id),
            'active_session' => sml_voice_active_session($room_id),
            'can_moderate' => sml_voice_can_moderate($room_id),
            'membership_credit' => ($user_id && function_exists('sml_gl_get_callin_credit_status'))
                ? sml_gl_get_callin_credit_status($user_id, $host_id)
                : array('available' => false, 'remaining' => 0),
        );
    }
}

if (!function_exists('sml_voice_queue_position')) {
    function sml_voice_queue_position($queue_id) {
        global $wpdb;
        $table = sml_voice_table('queue');
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", $queue_id), ARRAY_A);
        if (!$row || $row['status'] !== 'waiting') {
            return 0;
        }
        $ahead = $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM $table
              WHERE room_id = %s AND status = 'waiting'
                AND (priority > %d OR (priority = %d AND requested_at < %s))",
            $row['room_id'], $row['priority'], $row['priority'], $row['requested_at']
        ));
        return ((int) $ahead) + 1;
    }
}

if (!function_exists('sml_voice_rest_superchat')) {
    function sml_voice_rest_superchat(WP_REST_Request $request) {
        global $wpdb;

        $room_id = sanitize_text_field((string) $request->get_param('room_id'));
        $slug = sanitize_key((string) $request->get_param('tier'));
        $message = sanitize_text_field((string) $request->get_param('message'));
        $user_id = get_current_user_id();
        $use_membership_credit = (bool) $request->get_param('use_membership_credit');

        if (!$room_id) {
            return new WP_Error('sml_voice_room', 'Missing room.', array('status' => 400));
        }
        $settings = sml_voice_room_settings($room_id);
        if (empty($settings['enabled'])) {
            return new WP_Error('sml_voice_disabled', 'Voice call-ins are turned off for this stream.', array('status' => 423));
        }
        $room_host_id = (int) sml_voice_room_host($room_id);
        if (!empty($settings['members_only'])
            && (!function_exists('sml_gl_user_has_content_access') || !sml_gl_user_has_content_access($user_id, $room_host_id))) {
            return new WP_Error('sml_voice_members_only', 'This live room is available to this creator\'s Content Members.', array('status' => 403));
        }

        $tier = sml_voice_tier($slug);
        if (!$tier) {
            return new WP_Error('sml_voice_tier', 'Unknown tier.', array('status' => 400));
        }
        if ((int) $tier['min_loop_bucks'] <= 0) {
            return new WP_Error('sml_voice_rail', 'That tier is not available in Loop Bucks yet.', array('status' => 400));
        }
        if ($ban = sml_voice_is_banned($user_id, $room_id)) {
            return new WP_Error('sml_voice_banned', 'You are blocked from voice on this stream.', array('status' => 403));
        }

        $used = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . sml_voice_table('superchats') . "
              WHERE user_id = %d AND room_id = %s AND tier_id = %d AND status = 'paid'",
            $user_id, $room_id, $tier['id']
        ));
        if ($used >= (int) $tier['max_per_stream']) {
            return new WP_Error('sml_voice_max', 'You have reached the limit for this tier on this stream.', array('status' => 429));
        }

        $cost = sml_voice_tier_cost($tier, $room_id);   // creator-priced (Manage Monetization), tier row is the fallback
        $host_id = (int) sml_voice_room_host($room_id);
        $credit = null;
        if ($use_membership_credit) {
            if (!$host_id || !function_exists('sml_gl_consume_callin_credit')) {
                return new WP_Error('sml_callin_credit_unavailable', 'Membership call-in credits are unavailable for this room.', array('status' => 409));
            }
            $credit = sml_gl_consume_callin_credit($user_id, $host_id, $room_id);
            if (is_wp_error($credit)) {
                return $credit;
            }
            $cost = 0;
            $idem = $credit['idempotency_key'];
            $debit = sml_voice_wallet_balance($user_id);
        } else {
            $idem = 'lb:' . $user_id . ':' . $room_id . ':' . $tier['id'] . ':' . wp_generate_password(8, false, false);
            $debit = sml_voice_wallet_debit($user_id, $cost, $idem);
            if (is_wp_error($debit)) {
                return $debit;
            }
        }

        $user = wp_get_current_user();
        $wpdb->insert(sml_voice_table('superchats'), array(
            'user_id' => $user_id,
            'room_id' => $room_id,
            'streamer_id' => $host_id,
            'tier_id' => $tier['id'],
            'rail' => $use_membership_credit ? 'member_credit' : 'loop_bucks',
            'amount_cents' => $cost,     // 1 LB = 1 cent on this site
            'loop_bucks' => $cost,
            'message' => $message ?: null,
            'idempotency_key' => $idem,
            'status' => 'paid',
            'paid_at' => gmdate('Y-m-d H:i:s'),
        ));
        $superchat_id = (int) $wpdb->insert_id;

        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $wpdb->insert(sml_voice_table('tokens'), array(
            'token' => $token,
            'superchat_id' => $superchat_id,
            'user_id' => $user_id,
            'room_id' => $room_id,
            'tier_id' => $tier['id'],
            'speak_seconds' => $use_membership_credit ? (int) $credit['seconds'] : (int) $tier['speak_seconds'],
            'priority' => $use_membership_credit ? max(6, (int) $tier['priority']) : (int) $tier['priority'],
            'status' => 'unused',
            'expires_at' => gmdate('Y-m-d H:i:s', time() + 6 * HOUR_IN_SECONDS),
        ));

        sml_voice_log($room_id, null, $user_id, 'superchat', array(
            'tier' => $tier['slug'],
            'loop_bucks' => $cost,
            'rail' => $use_membership_credit ? 'member_credit' : 'loop_bucks',
            'membership_credits_remaining' => $use_membership_credit ? (int) $credit['remaining'] : null,
        ));

        return array(
            'ok' => true,
            'superchat_id' => $superchat_id,
            'token' => $token,
            'tier' => $tier['slug'],
            'seconds' => $use_membership_credit ? (int) $credit['seconds'] : (int) $tier['speak_seconds'],
            'priority' => $use_membership_credit ? max(6, (int) $tier['priority']) : (int) $tier['priority'],
            'balance' => (int) $debit,
            'rail' => $use_membership_credit ? 'member_credit' : 'loop_bucks',
            'membership_credits_remaining' => $use_membership_credit ? (int) $credit['remaining'] : null,
        );
    }
}

/* ---- Recorded voice Super Chats (owner design 2026-09-15): the viewer records a message within the pass length,
   it waits in the host's queue as an audio clip, the host listens privately, then approves (plays it into the
   stream) or denies (automatic refund). Nothing is ever live. ---- */
/* ---- Creator-priced Voice Super Chat + levels (owner design 2026-09-15): the creator prices 15/20/30 seconds in
   Manage Monetization; the amount decides a YouTube-style level (name + color) shown in chat and on the stream. ---- */
if (!function_exists('sml_voice_level_for')) {
    function sml_voice_level_for($host, $loop_bucks) {
        if (function_exists('sml_gl_superchat_level')) { return sml_gl_superchat_level((int) $host, (int) $loop_bucks); }
        return array('min' => 1, 'label' => 'Blue', 'color' => '#1e88e5');
    }
}
if (!function_exists('sml_voice_tiers_for_room')) {
    function sml_voice_tiers_for_room($room_id) {
        $host = (int) sml_voice_room_host($room_id);
        $s = ($host && function_exists('sml_gl_get_monetization_settings')) ? sml_gl_get_monetization_settings($host) : array();
        $enabled = !isset($s['voice_enabled']) || !empty($s['voice_enabled']);
        $out = array();
        foreach (sml_voice_tiers() as $t) {
            if ((int) $t['loop_bucks'] <= 0) { continue; }   // sponsor tier is cash-only, not offered here
            $sec = (int) $t['seconds'];
            $k = 'voice_price_' . $sec;
            if (isset($s[$k]) && (int) $s[$k] > 0) { $t['loop_bucks'] = (int) $s[$k]; $t['amount_cents'] = (int) $s[$k]; }
            $t['label'] = $sec . ' seconds';
            $t['members_only'] = false;   // the creator's price decides, not membership
            $t['level'] = sml_voice_level_for($host, (int) $t['loop_bucks']);
            $t['enabled'] = $enabled;
            $out[] = $t;
        }
        return $out;
    }
}
if (!function_exists('sml_voice_tier_cost')) {
    function sml_voice_tier_cost($tier, $room_id) {
        foreach (sml_voice_tiers_for_room($room_id) as $t) { if ($t['slug'] === $tier['slug']) { return (int) $t['loop_bucks']; } }
        return (int) $tier['min_loop_bucks'];
    }
}
if (!function_exists('sml_voice_rest_now_playing')) {
    /* Public: what voice Super Chat is playing on this room's stream right now (set by a clip approval). */
    function sml_voice_rest_now_playing(WP_REST_Request $request) {
        $room_id = sanitize_text_field((string) $request->get_param('room_id'));
        $t = $room_id ? get_transient('sml_voice_now_' . sanitize_key($room_id)) : false;
        if (is_array($t) && (int) ($t['until'] ?? 0) < time()) { $t = false; }
        $res = rest_ensure_response(array('playing' => $t ?: null, 'now' => time()));
        $res->header('Cache-Control', 'no-store');
        return $res;
    }
}
if (!function_exists('sml_voice_clip_columns')) {
    function sml_voice_clip_columns() {
        static $done = false;
        if ($done) { return; }
        $done = true;
        if (get_option('sml_voice_clip_cols') === '2') { return; }
        global $wpdb;
        $t = sml_voice_table('queue');
        $have = $wpdb->get_col("SHOW COLUMNS FROM $t");
        if (!in_array('clip_url', $have, true)) { $wpdb->query("ALTER TABLE $t ADD COLUMN clip_url VARCHAR(400) NULL DEFAULT NULL"); }
        if (!in_array('clip_seconds', $have, true)) { $wpdb->query("ALTER TABLE $t ADD COLUMN clip_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 0"); }
        update_option('sml_voice_clip_cols', '2', false);
    }
}
if (!function_exists('sml_voice_clip_delete')) {
    function sml_voice_clip_delete($row) {
        if (empty($row['clip_url'])) { return; }
        $up = wp_upload_dir();
        $url = (string) $row['clip_url'];
        $prefix = $up['baseurl'] . '/sml-voice-clips/';
        if (strpos($url, $prefix) !== 0) { return; }
        $path = $up['basedir'] . '/sml-voice-clips/' . basename($url);
        if (is_file($path)) { @unlink($path); }
    }
}
if (!function_exists('sml_voice_last_decision')) {
    function sml_voice_last_decision($user_id, $room_id) {
        if (!$user_id) { return ''; }
        global $wpdb;
        $r = $wpdb->get_row($wpdb->prepare(
            "SELECT status FROM " . sml_voice_table('queue') . "
              WHERE user_id = %d AND room_id = %s AND status <> 'waiting' AND decided_at IS NOT NULL AND decided_at > %s
              ORDER BY id DESC LIMIT 1",
            $user_id, $room_id, gmdate('Y-m-d H:i:s', time() - 3600)
        ), ARRAY_A);
        return $r ? (string) $r['status'] : '';
    }
}
if (!function_exists('sml_voice_clip_announce')) {
    /* Approved clip: publish "now playing" for every viewer (polled by the live page) and drop a highlighted
       Super Chat row in chat carrying the amount and level — the whole stream sees who sent what. */
    function sml_voice_clip_announce($row) {
        global $wpdb;
        try {
            $host = (int) sml_voice_room_host($row['room_id']);
            $level = sml_voice_level_for($host, (int) $row['loop_bucks']);
            $who = (string) $row['display_name'];
            if (function_exists('sml_ppe_public_handle')) {
                $h = sml_ppe_public_handle((int) $row['user_id']);
                if (is_string($h) && $h !== '') { $who = '@' . ltrim($h, '@'); }
            }
            $seconds = max(3, (int) $row['clip_seconds']);
            set_transient('sml_voice_now_' . sanitize_key((string) $row['room_id']), array(
                'name' => (string) $row['display_name'],
                'who' => $who,
                'user_id' => (int) $row['user_id'],
                'avatar_url' => (string) $row['avatar_url'],
                'loop_bucks' => (int) $row['loop_bucks'],
                'level' => $level,
                'seconds' => $seconds,
                'message' => (string) $row['message'],
                'started' => time(),
                'until' => time() + max(20, $seconds + 15),   // stays on screen a while after the clip, like a pinned Super Chat
            ), max(20, $seconds + 15) + 10);
            $body = '🔊 Voice Super Chat · ' . number_format((int) $row['loop_bucks']) . ' LB · ' . strtoupper((string) $level['label'])
                . ' — playing on the stream now' . (!empty($row['message']) ? ' — “' . $row['message'] . '”' : '');
            $wpdb->insert($wpdb->prefix . 'sml_live_chat_messages', array(
                'room_key' => substr('room-' . sanitize_key((string) $row['room_id']), 0, 190),
                'user_id' => (int) $row['user_id'],
                'display_name' => sanitize_text_field((string) $row['display_name']),
                'body' => $body,
                'message_type' => 'superchat',
                'created_at' => gmdate('Y-m-d H:i:s'),
            ));
        } catch (\Throwable $e) {}
    }
}
if (!function_exists('sml_voice_rest_clip')) {
    function sml_voice_rest_clip(WP_REST_Request $request) {
        global $wpdb;
        sml_voice_clip_columns();
        sml_voice_sweep_throttled();
        $token = sanitize_text_field((string) $request->get_param('token'));
        $user_id = get_current_user_id();
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_voice_table('tokens') . " WHERE token = %s AND user_id = %d",
            $token, $user_id
        ), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_voice_token', 'Voice pass not found.', array('status' => 404));
        }
        if ($row['status'] !== 'unused') {
            return new WP_Error('sml_voice_token_used', 'That voice pass has already been used.', array('status' => 409));
        }
        if (strtotime($row['expires_at'] . ' UTC') < time()) {
            return new WP_Error('sml_voice_token_expired', 'That voice pass has expired.', array('status' => 410));
        }
        if (sml_voice_is_banned($user_id, $row['room_id'])) {
            return new WP_Error('sml_voice_banned', 'You are blocked from voice on this stream.', array('status' => 403));
        }
        $settings = sml_voice_room_settings($row['room_id']);
        if (empty($settings['enabled'])) {
            return new WP_Error('sml_voice_disabled', 'Voice call-ins are turned off.', array('status' => 423));
        }
        $existing = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM " . sml_voice_table('queue') . " WHERE user_id = %d AND room_id = %s AND status = 'waiting'",
            $user_id, $row['room_id']
        ));
        if ($existing) {
            return new WP_Error('sml_voice_queued', 'You already have a message waiting for the host.', array('status' => 409));
        }
        if (count(sml_voice_queue_rows($row['room_id'])) >= (int) $settings['max_queue']) {
            return new WP_Error('sml_voice_full', 'The voice queue is full right now.', array('status' => 429));
        }
        $files = $request->get_file_params();
        $f = isset($files['clip']) ? $files['clip'] : null;
        if (!$f || empty($f['tmp_name']) || !is_uploaded_file($f['tmp_name'])) {
            return new WP_Error('sml_voice_clip', 'No recording was received.', array('status' => 400));
        }
        if ((int) $f['size'] > 4 * 1024 * 1024) {
            return new WP_Error('sml_voice_clip_big', 'That recording is too large.', array('status' => 413));
        }
        $mime = preg_replace('/;.*$/', '', strtolower((string) ($f['type'] ?? '')));
        $map = array(
            'audio/webm' => 'webm', 'video/webm' => 'webm', 'audio/ogg' => 'ogg', 'audio/mp4' => 'm4a',
            'audio/x-m4a' => 'm4a', 'audio/aac' => 'aac', 'audio/mpeg' => 'mp3', 'audio/wav' => 'wav', 'audio/x-wav' => 'wav',
        );
        if (!isset($map[$mime])) {
            return new WP_Error('sml_voice_clip_type', 'That recording format is not supported.', array('status' => 415));
        }
        $seconds = max(1, min((int) $request->get_param('seconds'), (int) $row['speak_seconds'] + 2));
        $up = wp_upload_dir();
        $dir = $up['basedir'] . '/sml-voice-clips';
        wp_mkdir_p($dir);
        $name = 'clip-' . (int) $row['id'] . '-' . wp_generate_password(10, false, false) . '.' . $map[$mime];
        if (!@move_uploaded_file($f['tmp_name'], $dir . '/' . $name)) {
            return new WP_Error('sml_voice_clip_store', 'Could not save the recording.', array('status' => 500));
        }
        $url = $up['baseurl'] . '/sml-voice-clips/' . $name;
        $charge = $wpdb->get_row($wpdb->prepare(
            "SELECT message, amount_cents, loop_bucks FROM " . sml_voice_table('superchats') . " WHERE id = %d",
            $row['superchat_id']
        ), ARRAY_A);
        $msg = sanitize_text_field((string) $request->get_param('message'));
        if ($msg === '' && !empty($charge['message'])) { $msg = (string) $charge['message']; }
        $user = wp_get_current_user();
        $wpdb->insert(sml_voice_table('queue'), array(
            'room_id' => $row['room_id'],
            'user_id' => $user_id,
            'token_id' => (int) $row['id'],
            'priority' => (int) $row['priority'],
            'display_name' => $user->display_name ?: $user->user_login,
            'avatar_url' => get_avatar_url($user_id, array('size' => 96)),
            'message' => $msg,
            'amount_cents' => (int) ($charge['amount_cents'] ?? 0),
            'loop_bucks' => (int) ($charge['loop_bucks'] ?? 0),
            'mic_ready' => 1,
            'status' => 'waiting',
            'clip_url' => $url,
            'clip_seconds' => $seconds,
        ));
        $queue_id = (int) $wpdb->insert_id;
        $wpdb->update(sml_voice_table('tokens'), array('status' => 'queued'), array('id' => (int) $row['id']));
        sml_voice_log($row['room_id'], null, $user_id, 'queued', array('queue_id' => $queue_id, 'clip' => 1, 'seconds' => $seconds));
        return array(
            'ok' => true,
            'queue_id' => $queue_id,
            'position' => sml_voice_queue_position($queue_id),
            'clip_url' => $url,
            'seconds' => $seconds,
        );
    }
}
if (!function_exists('sml_voice_rest_request')) {
    function sml_voice_rest_request(WP_REST_Request $request) {
        global $wpdb;
        sml_voice_sweep_throttled();

        $token = sanitize_text_field((string) $request->get_param('token'));
        $mic_ready = (bool) $request->get_param('mic_ready');
        $user_id = get_current_user_id();

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_voice_table('tokens') . " WHERE token = %s AND user_id = %d",
            $token, $user_id
        ), ARRAY_A);

        if (!$row) {
            return new WP_Error('sml_voice_token', 'Voice pass not found.', array('status' => 404));
        }
        if ($row['status'] !== 'unused') {
            return new WP_Error('sml_voice_token_used', 'That voice pass has already been used.', array('status' => 409));
        }
        if (strtotime($row['expires_at'] . ' UTC') < time()) {
            return new WP_Error('sml_voice_token_expired', 'That voice pass has expired.', array('status' => 410));
        }
        if (sml_voice_is_banned($user_id, $row['room_id'])) {
            return new WP_Error('sml_voice_banned', 'You are blocked from voice on this stream.', array('status' => 403));
        }
        if ($until = sml_voice_cooldown_until($user_id, $row['room_id'])) {
            return new WP_Error('sml_voice_cooldown', 'You can request again shortly.', array(
                'status' => 429, 'until' => $until,
            ));
        }

        $settings = sml_voice_room_settings($row['room_id']);
        if (empty($settings['enabled'])) {
            return new WP_Error('sml_voice_disabled', 'Voice call-ins are turned off.', array('status' => 423));
        }

        $existing = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM " . sml_voice_table('queue') . "
              WHERE user_id = %d AND room_id = %s AND status = 'waiting'",
            $user_id, $row['room_id']
        ));
        if ($existing) {
            return new WP_Error('sml_voice_queued', 'You are already in the queue.', array('status' => 409));
        }

        $depth = count(sml_voice_queue_rows($row['room_id']));
        if ($depth >= (int) $settings['max_queue']) {
            return new WP_Error('sml_voice_full', 'The voice queue is full right now.', array('status' => 429));
        }

        $charge = $wpdb->get_row($wpdb->prepare(
            "SELECT message, amount_cents, loop_bucks FROM " . sml_voice_table('superchats') . " WHERE id = %d",
            $row['superchat_id']
        ), ARRAY_A);

        $user = wp_get_current_user();
        $wpdb->insert(sml_voice_table('queue'), array(
            'room_id' => $row['room_id'],
            'user_id' => $user_id,
            'token_id' => (int) $row['id'],
            'priority' => (int) $row['priority'],
            'display_name' => $user->display_name ?: $user->user_login,
            'avatar_url' => get_avatar_url($user_id, array('size' => 96)),
            'message' => $charge['message'] ?? null,
            'amount_cents' => (int) ($charge['amount_cents'] ?? 0),
            'loop_bucks' => (int) ($charge['loop_bucks'] ?? 0),
            'mic_ready' => $mic_ready ? 1 : 0,
            'status' => 'waiting',
        ));
        $queue_id = (int) $wpdb->insert_id;

        $wpdb->update(sml_voice_table('tokens'), array('status' => 'queued'), array('id' => (int) $row['id']));
        sml_voice_log($row['room_id'], null, $user_id, 'queued', array('queue_id' => $queue_id));

        $position = sml_voice_queue_position($queue_id);
        return array(
            'ok' => true,
            'queue_id' => $queue_id,
            'position' => $position,
            'eta_seconds' => $position * 25,
        );
    }
}

if (!function_exists('sml_voice_rest_cancel')) {
    function sml_voice_rest_cancel(WP_REST_Request $request) {
        global $wpdb;
        $queue_id = (int) $request->get_param('queue_id');
        $user_id = get_current_user_id();

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_voice_table('queue') . " WHERE id = %d", $queue_id), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_voice_queue', 'Not in the queue.', array('status' => 404));
        }
        if ((int) $row['user_id'] !== $user_id && !sml_voice_can_moderate($row['room_id'])) {
            return new WP_Error('sml_voice_forbidden', 'Not allowed.', array('status' => 403));
        }
        if ($row['status'] !== 'waiting') {
            return array('ok' => true);
        }

        $wpdb->update(sml_voice_table('queue'), array(
            'status' => 'cancelled', 'decided_at' => gmdate('Y-m-d H:i:s'),
        ), array('id' => $queue_id));

        // Cancelling gives the pass back rather than burning it.
        $wpdb->update(sml_voice_table('tokens'), array('status' => 'unused'), array('id' => (int) $row['token_id']));
        sml_voice_clip_delete($row);
        sml_voice_log($row['room_id'], null, $user_id, 'cancelled', array('queue_id' => $queue_id));
        return array('ok' => true);
    }
}

if (!function_exists('sml_voice_rest_mic_ready')) {
    function sml_voice_rest_mic_ready(WP_REST_Request $request) {
        global $wpdb;
        $queue_id = (int) $request->get_param('queue_id');
        $wpdb->update(sml_voice_table('queue'),
            array('mic_ready' => $request->get_param('ready') ? 1 : 0),
            array('id' => $queue_id, 'user_id' => get_current_user_id()));
        return array('ok' => true);
    }
}

if (!function_exists('sml_voice_rest_queue')) {
    function sml_voice_rest_queue(WP_REST_Request $request) {
        sml_voice_sweep_throttled();
        $room_id = sanitize_text_field((string) $request->get_param('room_id'));
        if (!sml_voice_can_moderate($room_id)) {
            return new WP_Error('sml_voice_forbidden', 'Only the host can see the queue.', array('status' => 403));
        }
        return array(
            'queue' => sml_voice_queue_rows($room_id),
            'active_session' => sml_voice_active_session($room_id),
            'settings' => sml_voice_room_settings($room_id),
        );
    }
}

if (!function_exists('sml_voice_rest_approve')) {
    function sml_voice_rest_approve(WP_REST_Request $request) {
        global $wpdb;
        $queue_id = (int) $request->get_param('queue_id');
        $start_muted = (bool) $request->get_param('start_muted');

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_voice_table('queue') . " WHERE id = %d", $queue_id), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_voice_queue', 'Request not found.', array('status' => 404));
        }
        if (!sml_voice_can_moderate($row['room_id'])) {
            return new WP_Error('sml_voice_forbidden', 'Only the host can approve.', array('status' => 403));
        }
        if ($row['status'] !== 'waiting') {
            return new WP_Error('sml_voice_decided', 'That request was already handled.', array('status' => 409));
        }
        if (!empty($row['clip_url'])) {
            /* Recorded voice Super Chat (owner design 2026-09-15): nothing is live. The host has listened privately
               and is now playing the clip into the stream; consume the pass and announce it in chat. */
            $actor = get_current_user_id();
            $wpdb->update(sml_voice_table('queue'), array(
                'status' => 'approved',
                'decided_at' => gmdate('Y-m-d H:i:s'),
                'decided_by' => $actor,
            ), array('id' => $queue_id));
            $wpdb->update(sml_voice_table('tokens'), array(
                'status' => 'consumed', 'consumed_at' => gmdate('Y-m-d H:i:s'),
            ), array('id' => (int) $row['token_id']));
            sml_voice_log($row['room_id'], null, $actor, 'approved', array('clip' => 1, 'queue_id' => $queue_id));
            sml_voice_clip_announce($row);
            return array(
                'ok' => true,
                'clip' => true,
                'level' => sml_voice_level_for((int) sml_voice_room_host($row['room_id']), (int) $row['loop_bucks']),
                'clip_url' => (string) $row['clip_url'],
                'seconds' => (int) $row['clip_seconds'],
                'display_name' => (string) $row['display_name'],
                'loop_bucks' => (int) $row['loop_bucks'],
                'message' => (string) $row['message'],
            );
        }
        if (sml_voice_active_session($row['room_id'])) {
            return new WP_Error('sml_voice_busy', 'Someone is already on the line.', array('status' => 409));
        }

        $token = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_voice_table('tokens') . " WHERE id = %d", $row['token_id']), ARRAY_A);

        $uid = wp_generate_uuid4();
        $identity = 'caller_' . (int) $row['user_id'] . '_' . substr($uid, 0, 8);
        $actor = get_current_user_id();

        $wpdb->update(sml_voice_table('queue'), array(
            'status' => 'approved',
            'decided_at' => gmdate('Y-m-d H:i:s'),
            'decided_by' => $actor,
        ), array('id' => $queue_id));

        $wpdb->update(sml_voice_table('tokens'), array(
            'status' => 'consumed', 'consumed_at' => gmdate('Y-m-d H:i:s'),
        ), array('id' => (int) $row['token_id']));

        $wpdb->insert(sml_voice_table('sessions'), array(
            'session_uid' => $uid,
            'room_id' => $row['room_id'],
            'user_id' => (int) $row['user_id'],
            'streamer_id' => $actor,
            'queue_id' => $queue_id,
            'token_id' => (int) $row['token_id'],
            'media_identity' => $identity,
            'granted_seconds' => (int) $token['speak_seconds'],
            'state' => 'connecting',
            'muted' => $start_muted ? 1 : 0,
        ));

        sml_voice_log($row['room_id'], $uid, $actor, 'approved', array('start_muted' => $start_muted));

        return array(
            'ok' => true,
            'session_uid' => $uid,
            'media_identity' => $identity,
            'granted_seconds' => (int) $token['speak_seconds'],
            'start_muted' => $start_muted,
        );
    }
}

if (!function_exists('sml_voice_rest_deny')) {
    function sml_voice_rest_deny(WP_REST_Request $request) {
        global $wpdb;
        $queue_id = (int) $request->get_param('queue_id');
        $reason = sanitize_text_field((string) $request->get_param('reason'));

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_voice_table('queue') . " WHERE id = %d", $queue_id), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_voice_queue', 'Request not found.', array('status' => 404));
        }
        if (!sml_voice_can_moderate($row['room_id'])) {
            return new WP_Error('sml_voice_forbidden', 'Only the host can deny.', array('status' => 403));
        }

        $wpdb->update(sml_voice_table('queue'), array(
            'status' => 'denied',
            'decided_at' => gmdate('Y-m-d H:i:s'),
            'decided_by' => get_current_user_id(),
        ), array('id' => $queue_id));

        // Denied always refunds - they never got to speak.
        sml_voice_refund((int) $row['token_id'], 'denied');
        sml_voice_clip_delete($row);
        sml_voice_log($row['room_id'], null, get_current_user_id(), 'denied', array('reason' => $reason));

        return array('ok' => true, 'refunded' => true);
    }
}

if (!function_exists('sml_voice_rest_session_state')) {
    function sml_voice_rest_session_state(WP_REST_Request $request) {
        global $wpdb;
        $uid = sanitize_text_field((string) $request->get_param('session_uid'));
        $action = sanitize_key((string) $request->get_param('action'));

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_voice_table('sessions') . " WHERE session_uid = %s", $uid), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_voice_session', 'Session not found.', array('status' => 404));
        }

        $is_host = sml_voice_can_moderate($row['room_id']);
        $is_caller = (int) $row['user_id'] === get_current_user_id();

        switch ($action) {
            case 'connected':
                if (!$is_caller) {
                    return new WP_Error('sml_voice_forbidden', 'Not allowed.', array('status' => 403));
                }
                if ($row['state'] !== 'connecting') {
                    return array('ok' => true, 'session' => sml_voice_session_public($row));
                }
                $deadline = gmdate('Y-m-d H:i:s', time() + (int) $row['granted_seconds']);
                $wpdb->update(sml_voice_table('sessions'), array(
                    'state' => $row['muted'] ? 'muted' : 'speaking',
                    'started_at' => gmdate('Y-m-d H:i:s'),
                    'hard_deadline' => $deadline,
                ), array('session_uid' => $uid));
                sml_voice_log($row['room_id'], $uid, get_current_user_id(), 'speaking_started');
                break;

            case 'mute':
            case 'unmute':
                if (!$is_host) {
                    return new WP_Error('sml_voice_forbidden', 'Only the host can mute.', array('status' => 403));
                }
                $muted = $action === 'mute';
                $wpdb->update(sml_voice_table('sessions'), array(
                    'muted' => $muted ? 1 : 0,
                    'state' => $muted ? 'muted' : 'speaking',
                ), array('session_uid' => $uid));
                sml_voice_log($row['room_id'], $uid, get_current_user_id(), $action);
                break;

            case 'gain':
                if (!$is_host) {
                    return new WP_Error('sml_voice_forbidden', 'Only the host can change volume.', array('status' => 403));
                }
                $gain = max(0, min(2, (float) $request->get_param('gain')));
                $wpdb->update(sml_voice_table('sessions'), array('gain' => $gain), array('session_uid' => $uid));
                break;

            case 'extend':
                if (!$is_host) {
                    return new WP_Error('sml_voice_forbidden', 'Only the host can extend.', array('status' => 403));
                }
                $add = max(5, min(120, (int) $request->get_param('seconds')));
                $wpdb->query($wpdb->prepare(
                    "UPDATE " . sml_voice_table('sessions') . "
                        SET hard_deadline = DATE_ADD(COALESCE(hard_deadline, UTC_TIMESTAMP()), INTERVAL %d SECOND),
                            granted_seconds = granted_seconds + %d
                      WHERE session_uid = %s",
                    $add, $add, $uid
                ));
                sml_voice_log($row['room_id'], $uid, get_current_user_id(), 'extend', array('seconds' => $add));
                break;

            case 'end':
                if (!$is_host && !$is_caller) {
                    return new WP_Error('sml_voice_forbidden', 'Not allowed.', array('status' => 403));
                }
                sml_voice_end_session($uid, $is_host ? 'streamer' : 'disconnect');
                break;

            case 'flag':
                $wpdb->update(sml_voice_table('sessions'),
                    array('peak_dbfs' => (float) $request->get_param('dbfs')),
                    array('session_uid' => $uid));
                sml_voice_log($row['room_id'], $uid, get_current_user_id(), 'flag:' .
                    sanitize_key((string) $request->get_param('kind')),
                    array('dbfs' => (float) $request->get_param('dbfs')));
                break;

            default:
                return new WP_Error('sml_voice_action', 'Unsupported action.', array('status' => 400));
        }

        $fresh = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_voice_table('sessions') . " WHERE session_uid = %s", $uid), ARRAY_A);
        return array('ok' => true, 'session' => sml_voice_session_public($fresh));
    }
}

/* ==================================================================
 * WebRTC signalling (offer / answer / ice)
 *
 * Mirrors the shape the existing group live rooms use, but scoped to a
 * voice session so it works whether or not a group room is running.
 * ================================================================== */

if (!function_exists('sml_voice_rest_signal_send')) {
    function sml_voice_rest_signal_send(WP_REST_Request $request) {
        global $wpdb;

        $uid = sanitize_text_field((string) $request->get_param('session_uid'));
        $type = sanitize_key((string) $request->get_param('signal_type'));
        $payload = $request->get_param('payload');

        if (!in_array($type, array('offer', 'answer', 'ice', 'bye'), true)) {
            return new WP_Error('sml_voice_signal_type', 'Unsupported signal.', array('status' => 400));
        }

        $session = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_voice_table('sessions') . " WHERE session_uid = %s", $uid), ARRAY_A);
        if (!$session) {
            return new WP_Error('sml_voice_session', 'Session not found.', array('status' => 404));
        }
        if ($session['state'] === 'ended') {
            return new WP_Error('sml_voice_ended', 'That session has ended.', array('status' => 410));
        }

        $me = get_current_user_id();
        $is_caller = (int) $session['user_id'] === $me;
        $is_host = sml_voice_can_moderate($session['room_id']);
        if (!$is_caller && !$is_host) {
            return new WP_Error('sml_voice_forbidden', 'Not part of this call.', array('status' => 403));
        }

        // The client declares which side it is. Routing by role rather than by
        // user id means one account can hold both ends, which is how a host
        // tests the audio path alone in two tabs.
        $role = sanitize_key((string) $request->get_param('role'));
        if (!in_array($role, array('caller', 'host'), true)) {
            $role = $is_caller ? 'caller' : 'host';
        }
        if ($role === 'caller' && !$is_caller && !$is_host) {
            return new WP_Error('sml_voice_forbidden', 'Not the caller.', array('status' => 403));
        }
        if ($role === 'host' && !$is_host) {
            return new WP_Error('sml_voice_forbidden', 'Not the host.', array('status' => 403));
        }

        $to = $role === 'caller' ? (int) $session['streamer_id'] : (int) $session['user_id'];

        $wpdb->insert(sml_voice_table('signals'), array(
            'session_uid' => $uid,
            'from_user' => $me,
            'to_user' => $to,
            'from_role' => $role,
            'signal_type' => $type,
            'payload' => wp_json_encode($payload),
        ));

        return array('ok' => true, 'id' => (int) $wpdb->insert_id);
    }
}

if (!function_exists('sml_voice_rest_signal_poll')) {
    function sml_voice_rest_signal_poll(WP_REST_Request $request) {
        global $wpdb;

        $uid = sanitize_text_field((string) $request->get_param('session_uid'));
        $after = (int) $request->get_param('after');

        $session = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_voice_table('sessions') . " WHERE session_uid = %s", $uid), ARRAY_A);
        if (!$session) {
            return new WP_Error('sml_voice_session', 'Session not found.', array('status' => 404));
        }

        $me = get_current_user_id();
        $is_caller = (int) $session['user_id'] === $me;
        $is_host = sml_voice_can_moderate($session['room_id']);
        if (!$is_caller && !$is_host) {
            return new WP_Error('sml_voice_forbidden', 'Not part of this call.', array('status' => 403));
        }

        // Deliver whatever the opposite side sent. Role-based rather than
        // user-based, so a single account can drive both ends while testing.
        $role = sanitize_key((string) $request->get_param('role'));
        if (!in_array($role, array('caller', 'host'), true)) {
            $role = $is_caller ? 'caller' : 'host';
        }
        $other = $role === 'caller' ? 'host' : 'caller';

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, from_user, signal_type, payload
               FROM " . sml_voice_table('signals') . "
              WHERE session_uid = %s
                AND id > %d
                AND from_role = %s
              ORDER BY id ASC LIMIT 40",
            $uid, $after, $other
        ), ARRAY_A);

        $out = array();
        $max = $after;
        foreach ($rows ?: array() as $row) {
            $out[] = array(
                'id' => (int) $row['id'],
                'from_user' => (int) $row['from_user'],
                'signal_type' => $row['signal_type'],
                'payload' => json_decode($row['payload'], true),
            );
            $max = max($max, (int) $row['id']);
        }

        return array(
            'signals' => $out,
            'cursor' => $max,
            'session' => sml_voice_session_public($session),
        );
    }
}

if (!function_exists('sml_voice_rest_credit')) {
    function sml_voice_rest_credit(WP_REST_Request $request) {
        if (!current_user_can('manage_options')) {
            return new WP_Error('sml_voice_forbidden', 'Admins only.', array('status' => 403));
        }
        $user_id = (int) ($request->get_param('user_id') ?: get_current_user_id());
        $amount = (int) $request->get_param('amount');
        $note = sanitize_text_field((string) $request->get_param('note'));

        if ($amount <= 0 || $amount > 100000) {
            return new WP_Error('sml_voice_amount', 'Amount out of range.', array('status' => 400));
        }

        $balance = sml_voice_wallet_credit($user_id, $amount, 'admin_credit:' . $note);
        sml_voice_log('admin', null, get_current_user_id(), 'admin_credit', array(
            'user_id' => $user_id, 'amount' => $amount, 'note' => $note,
        ));
        return array('ok' => true, 'balance' => (int) $balance);
    }
}

if (!function_exists('sml_voice_rest_ban')) {
    function sml_voice_rest_ban(WP_REST_Request $request) {
        global $wpdb;
        $room_id = sanitize_text_field((string) $request->get_param('room_id'));
        if (!sml_voice_can_moderate($room_id)) {
            return new WP_Error('sml_voice_forbidden', 'Only the host can block.', array('status' => 403));
        }
        $target = (int) $request->get_param('user_id');
        $hours = (int) $request->get_param('hours');

        $wpdb->insert(sml_voice_table('bans'), array(
            'user_id' => $target,
            'scope' => 'room',
            'scope_ref' => $room_id,
            'reason' => sanitize_text_field((string) $request->get_param('reason')),
            'created_by' => get_current_user_id(),
            'expires_at' => $hours > 0 ? gmdate('Y-m-d H:i:s', time() + $hours * HOUR_IN_SECONDS) : null,
        ));

        // Drop anything they have pending.
        $wpdb->query($wpdb->prepare(
            "UPDATE " . sml_voice_table('queue') . " SET status = 'denied'
              WHERE user_id = %d AND room_id = %s AND status = 'waiting'",
            $target, $room_id
        ));

        sml_voice_log($room_id, null, get_current_user_id(), 'ban', array('user_id' => $target, 'hours' => $hours));
        return array('ok' => true);
    }
}

if (!function_exists('sml_voice_rest_settings')) {
    function sml_voice_rest_settings(WP_REST_Request $request) {
        $room_id = sanitize_text_field((string) $request->get_param('room_id'));
        if (!sml_voice_can_moderate($room_id)) {
            return new WP_Error('sml_voice_forbidden', 'Only the host can change settings.', array('status' => 403));
        }
        $patch = array();
        foreach (array('enabled', 'require_mic_ready', 'text_chat_enabled', 'super_chat_enabled', 'members_only') as $flag) {
            if ($request->get_param($flag) !== null) {
                $patch[$flag] = (bool) $request->get_param($flag);
            }
        }
        if ($request->get_param('max_queue') !== null) {
            $patch['max_queue'] = max(1, min(100, (int) $request->get_param('max_queue')));
        }
        if ($request->get_param('auto_approve_priority') !== null) {
            $patch['auto_approve_priority'] = max(0, min(10, (int) $request->get_param('auto_approve_priority')));
        }
        if ($request->get_param('chat_slow_mode') !== null) {
            $patch['chat_slow_mode'] = max(0, min(60, (int) $request->get_param('chat_slow_mode')));
        }
        return array('ok' => true, 'settings' => sml_voice_save_room_settings($room_id, $patch));
    }
}


if (!function_exists('sml_voice_chat_group_id')) {
    function sml_voice_chat_group_id($room_id) {
        global $wpdb;
        $room_id = (string) $room_id;
        if (preg_match('/^g(\d+)/', $room_id, $m)) {
            return (int) $m[1];
        }
        if (!ctype_digit($room_id)) {
            return 0;
        }
        $table = $wpdb->prefix . 'sml_group_live_rooms';
        $exists = (bool) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table));
        if (!$exists) {
            return 0;
        }
        return (int) $wpdb->get_var($wpdb->prepare("SELECT group_id FROM $table WHERE id = %d", (int) $room_id));
    }
}

if (!function_exists('sml_voice_chat_can_view')) {
    function sml_voice_chat_can_view($room_id, $user_id = 0) {
        $user_id = $user_id ?: get_current_user_id();
        if (!$user_id) {
            return false;
        }
        if (user_can($user_id, 'manage_options') || sml_voice_can_moderate($room_id, $user_id)) {
            return true;
        }
        $group_id = sml_voice_chat_group_id($room_id);
        if ($group_id && function_exists('sml_gli_group_access')) {
            return sml_gli_group_access($group_id, true);
        }
        return (bool) $group_id;
    }
}

if (!function_exists('sml_voice_chat_payload')) {
    function sml_voice_chat_payload($row) {
        return array(
            'id' => (int) $row['id'],
            'room_id' => (string) $row['room_id'],
            'user_id' => (int) $row['user_id'],
            'display_name' => sanitize_text_field($row['display_name']),
            'avatar_url' => esc_url_raw((string) $row['avatar_url']),
            'message' => sanitize_text_field($row['message']),
            'kind' => sanitize_key($row['kind']),
            'tier_slug' => sanitize_key((string) $row['tier_slug']),
            'amount_cents' => (int) $row['amount_cents'],
            'loop_bucks' => (int) $row['loop_bucks'],
            'status' => sanitize_key($row['status']),
            'highlighted' => !empty($row['highlighted_until']) && strtotime($row['highlighted_until'] . ' UTC') > time(),
            'highlighted_until' => !empty($row['highlighted_until']) ? mysql_to_rfc3339($row['highlighted_until']) : null,
            'created_at' => mysql_to_rfc3339($row['created_at']),
        );
    }
}

if (!function_exists('sml_voice_rest_chat_list')) {
    function sml_voice_rest_chat_list(WP_REST_Request $request) {
        global $wpdb;
        $room_id = sanitize_text_field((string) $request->get_param('room_id'));
        if (!sml_voice_chat_can_view($room_id)) {
            return new WP_Error('sml_voice_forbidden', 'You cannot view this live chat.', array('status' => 403));
        }
        $after = max(0, (int) $request->get_param('after_id'));
        $limit = max(10, min(80, (int) ($request->get_param('limit') ?: 40)));
        $settings = sml_voice_room_settings($room_id);
        $table = sml_voice_table('chat');
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $table WHERE room_id = %s AND id > %d AND status <> 'deleted' ORDER BY id ASC LIMIT %d",
            $room_id, $after, $limit
        ), ARRAY_A);
        $messages = array_map('sml_voice_chat_payload', $rows ?: array());
        $cursor = $after;
        foreach ($messages as $msg) {
            $cursor = max($cursor, (int) $msg['id']);
        }
        $totals = $wpdb->get_row($wpdb->prepare(
            "SELECT COUNT(*) AS total_messages, COALESCE(SUM(CASE WHEN kind = 'superchat' AND status = 'active' THEN loop_bucks ELSE 0 END), 0) AS loop_bucks, COALESCE(SUM(CASE WHEN kind = 'superchat' AND status = 'active' THEN amount_cents ELSE 0 END), 0) AS amount_cents FROM $table WHERE room_id = %s AND status <> 'deleted'",
            $room_id
        ), ARRAY_A);
        return array(
            'ok' => true,
            'messages' => $messages,
            'cursor' => $cursor,
            'settings' => array(
                'text_chat_enabled' => !empty($settings['text_chat_enabled']),
                'super_chat_enabled' => !empty($settings['super_chat_enabled']),
                'chat_slow_mode' => (int) $settings['chat_slow_mode'],
            ),
            'totals' => array(
                'messages' => (int) ($totals['total_messages'] ?? 0),
                'loop_bucks' => (int) ($totals['loop_bucks'] ?? 0),
                'amount_cents' => (int) ($totals['amount_cents'] ?? 0),
            ),
        );
    }
}

if (!function_exists('sml_voice_rest_chat_post')) {
    function sml_voice_rest_chat_post(WP_REST_Request $request) {
        global $wpdb;
        $user_id = get_current_user_id();
        $room_id = sanitize_text_field((string) $request->get_param('room_id'));
        if (!sml_voice_chat_can_view($room_id, $user_id)) {
            return new WP_Error('sml_voice_forbidden', 'You cannot post in this live chat.', array('status' => 403));
        }
        $settings = sml_voice_room_settings($room_id);
        $kind = sanitize_key((string) ($request->get_param('kind') ?: 'message'));
        $message = sanitize_text_field((string) $request->get_param('message'));
        if ($message === '') {
            return new WP_Error('sml_voice_empty', 'Write a message first.', array('status' => 400));
        }
        if ($kind === 'superchat' && empty($settings['super_chat_enabled'])) {
            return new WP_Error('sml_voice_superchat_off', 'Super Chat is off for this stream.', array('status' => 409));
        }
        if ($kind !== 'superchat' && empty($settings['text_chat_enabled'])) {
            return new WP_Error('sml_voice_chat_off', 'Live chat is off for this stream.', array('status' => 409));
        }

        $table = sml_voice_table('chat');
        $slow = max(0, (int) ($settings['chat_slow_mode'] ?? 0));
        if ($kind !== 'superchat' && $slow > 0) {
            $latest = $wpdb->get_var($wpdb->prepare(
                "SELECT created_at FROM $table WHERE room_id = %s AND user_id = %d AND status = 'active' ORDER BY id DESC LIMIT 1",
                $room_id, $user_id
            ));
            if ($latest && (time() - strtotime($latest . ' UTC')) < $slow) {
                return new WP_Error('sml_voice_slow_mode', 'Slow mode is on for this stream.', array('status' => 429));
            }
        }

        $tier_slug = '';
        $amount_cents = 0;
        $loop_bucks = 0;
        $highlighted_until = null;
        if ($kind === 'superchat') {
            $tier = sml_voice_tier((string) $request->get_param('tier'));
            if (!$tier) {
                return new WP_Error('sml_voice_tier', 'Choose a valid Super Chat tier.', array('status' => 400));
            }
            $tier_slug = sanitize_key($tier['slug']);
            $amount_cents = max(0, (int) $tier['min_amount_cents']);
            $loop_bucks = max((int) $tier['min_loop_bucks'], $amount_cents);
            if (!user_can($user_id, 'manage_options')) {
                $balance = sml_voice_wallet_debit($user_id, $loop_bucks, 'live_chat:' . $room_id . ':' . $tier_slug);
                if (is_wp_error($balance)) {
                    return $balance;
                }
            }
            $superchat_table = sml_voice_table('superchats');
            $wpdb->insert($superchat_table, array(
                'user_id' => $user_id,
                'room_id' => $room_id,
                'streamer_id' => (int) sml_voice_room_host($room_id),
                'tier_id' => (int) $tier['id'],
                'rail' => 'loop_bucks',
                'amount_cents' => $amount_cents,
                'loop_bucks' => $loop_bucks,
                'currency' => 'USD',
                'message' => $message,
                'provider_ref' => 'live-chat',
                'idempotency_key' => wp_generate_uuid4(),
                'status' => 'paid',
                'paid_at' => current_time('mysql', true),
            ));
            $highlighted_until = gmdate('Y-m-d H:i:s', time() + HOUR_IN_SECONDS);
        }

        $user = wp_get_current_user();
        $wpdb->insert($table, array(
            'room_id' => $room_id,
            'user_id' => $user_id,
            'display_name' => $user->display_name ?: $user->user_login,
            'avatar_url' => get_avatar_url($user_id, array('size' => 96)),
            'message' => $message,
            'kind' => $kind,
            'tier_slug' => $tier_slug ?: null,
            'amount_cents' => $amount_cents,
            'loop_bucks' => $loop_bucks,
            'status' => 'active',
            'highlighted_until' => $highlighted_until,
        ));
        $id = (int) $wpdb->insert_id;
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", $id), ARRAY_A);
        sml_voice_log($room_id, null, $user_id, $kind === 'superchat' ? 'chat_superchat' : 'chat_message', array(
            'chat_id' => $id, 'tier' => $tier_slug, 'loop_bucks' => $loop_bucks, 'amount_cents' => $amount_cents,
        ));
        return array('ok' => true, 'message' => sml_voice_chat_payload($row));
    }
}

if (!function_exists('sml_voice_rest_chat_moderate')) {
    function sml_voice_rest_chat_moderate(WP_REST_Request $request) {
        global $wpdb;
        $chat_id = (int) $request->get_param('id');
        $action = sanitize_key((string) $request->get_param('action'));
        $table = sml_voice_table('chat');
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", $chat_id), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_voice_chat', 'Chat item not found.', array('status' => 404));
        }
        if (!sml_voice_can_moderate($row['room_id'])) {
            return new WP_Error('sml_voice_forbidden', 'Only the host can moderate chat.', array('status' => 403));
        }
        $patch = array();
        if ($action === 'remove') {
            $patch['status'] = 'removed';
        } elseif ($action === 'restore') {
            $patch['status'] = 'active';
        } elseif ($action === 'highlight') {
            $patch['highlighted_until'] = gmdate('Y-m-d H:i:s', time() + HOUR_IN_SECONDS);
            $patch['status'] = 'active';
        } else {
            return new WP_Error('sml_voice_action', 'Unknown moderation action.', array('status' => 400));
        }
        $wpdb->update($table, $patch, array('id' => $chat_id));
        $fresh = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", $chat_id), ARRAY_A);
        sml_voice_log($row['room_id'], null, get_current_user_id(), 'chat_' . $action, array('chat_id' => $chat_id));
        return array('ok' => true, 'message' => sml_voice_chat_payload($fresh));
    }
}

if (!function_exists('sml_voice_rest_diagnostics')) {
    function sml_voice_rest_diagnostics(WP_REST_Request $request) {
        global $wpdb;
        if (!current_user_can('manage_options')) {
            return new WP_Error('sml_voice_forbidden', 'Admins only.', array('status' => 403));
        }
        $user_id = (int) ($request->get_param('user_id') ?: get_current_user_id());

        $candidates = array();
        foreach (sml_voice_wallet_meta_keys() as $key) {
            $value = get_user_meta($user_id, $key, true);
            $candidates[$key] = ($value === '' || $value === false) ? null : $value;
        }

        // Any numeric meta whose key hints at a wallet, to catch keys we did not guess.
        $like = $wpdb->get_results($wpdb->prepare(
            "SELECT meta_key, meta_value FROM {$wpdb->usermeta}
              WHERE user_id = %d
                AND (meta_key LIKE %s OR meta_key LIKE %s OR meta_key LIKE %s OR meta_key LIKE %s)
              LIMIT 40",
            $user_id, '%loop%', '%buck%', '%credit%', '%wallet%'
        ), ARRAY_A);

        $tables = array();
        foreach (array('tiers', 'superchats', 'tokens', 'queue', 'sessions', 'bans', 'cooldowns', 'events', 'signals') as $t) {
            $name = sml_voice_table($t);
            $tables[$t] = (bool) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $name));
        }

        return array(
            'db_version' => get_option('sml_voice_db_version'),
            'tables' => $tables,
            'tier_count' => (int) $wpdb->get_var('SELECT COUNT(*) FROM ' . sml_voice_table('tiers')),
            'active_wallet_key' => sml_voice_wallet_active_key($user_id),
            'wallet_balance' => sml_voice_wallet_balance($user_id),
            'candidates' => $candidates,
            'meta_matches' => $like ?: array(),
            'cron_next' => wp_next_scheduled('sml_voice_sweep_event'),
            'ice_servers' => count(sml_voice_ice_servers()),
            'turn_configured' => (bool) array_filter(sml_voice_ice_servers(), function ($s) {
                return isset($s['urls']) && strpos((string) $s['urls'], 'turn:') === 0;
            }),
        );
    }
}

if (!function_exists('sml_voice_register_routes')) {
    function sml_voice_register_routes() {
        $ns = 'sml-voice/v1';
        $logged_in = 'is_user_logged_in';

        register_rest_route($ns, '/eligibility', array(
            'methods' => 'GET', 'permission_callback' => '__return_true',
            'callback' => 'sml_voice_rest_eligibility',
        ));
        register_rest_route($ns, '/superchat', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_superchat',
        ));
        register_rest_route($ns, '/now-playing', array(
            'methods' => 'GET', 'permission_callback' => '__return_true',
            'callback' => 'sml_voice_rest_now_playing',
        ));
        register_rest_route($ns, '/clip', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_clip',
        ));
        register_rest_route($ns, '/request', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_request',
        ));
        register_rest_route($ns, '/cancel', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_cancel',
        ));
        register_rest_route($ns, '/mic-ready', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_mic_ready',
        ));
        register_rest_route($ns, '/queue', array(
            'methods' => 'GET', 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_queue',
        ));
        register_rest_route($ns, '/approve', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_approve',
        ));
        register_rest_route($ns, '/deny', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_deny',
        ));
        register_rest_route($ns, '/session', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_session_state',
        ));
        register_rest_route($ns, '/ban', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_ban',
        ));
        register_rest_route($ns, '/settings', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_settings',
        ));
        register_rest_route($ns, '/signal', array(
            array(
                'methods' => WP_REST_Server::CREATABLE,
                'permission_callback' => $logged_in,
                'callback' => 'sml_voice_rest_signal_send',
            ),
            array(
                'methods' => 'GET',
                'permission_callback' => $logged_in,
                'callback' => 'sml_voice_rest_signal_poll',
            ),
        ));
        register_rest_route($ns, '/credit', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_credit',
        ));
        register_rest_route($ns, '/chat', array(
            array(
                'methods' => 'GET',
                'permission_callback' => $logged_in,
                'callback' => 'sml_voice_rest_chat_list',
            ),
            array(
                'methods' => WP_REST_Server::CREATABLE,
                'permission_callback' => $logged_in,
                'callback' => 'sml_voice_rest_chat_post',
            ),
        ));
        register_rest_route($ns, '/chat/moderate', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_chat_moderate',
        ));
        register_rest_route($ns, '/diagnostics', array(
            'methods' => 'GET', 'permission_callback' => $logged_in,
            'callback' => 'sml_voice_rest_diagnostics',
        ));
    }
}
add_action('rest_api_init', 'sml_voice_register_routes');
