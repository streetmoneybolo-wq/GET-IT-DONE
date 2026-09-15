<?php
/**
 * Earning Loop Bucks through activity.
 *
 * Loop Bucks are issued out of the vault, so this file is the only tap into a
 * fixed supply. Three things keep that tap honest:
 *
 *   1. Idempotency. Every award carries a deterministic reference -- event,
 *      user, and either the day or the specific object. The ledger's unique
 *      index means a retried request awards nothing the second time.
 *   2. Daily caps. Per rule and overall. Without them, "earn 5 for a comment"
 *      becomes "earn 5000 for a script".
 *   3. Everything is option-backed and filtered, so the economy can be tuned
 *      from the database rather than a deploy. Getting these numbers right is
 *      an ongoing exercise, not something to guess once and bake in.
 *
 * Loop Bucks are earned, won or bought, and never redeemable for cash.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_lb_earn_rules')) {
    /**
     * amount     Loop Bucks per occurrence
     * cap        most that may be earned from this rule in one day (0 = rule amount)
     * once       lifetime, not daily
     * label      shown in the "how to earn" list
     */
    function sml_lb_earn_rules() {
        $rules = array(
            // One-off milestones. These exist so a new member is not staring
            // at a locked site on day one.
            'profile_done'    => array('amount' => 50,  'once' => true,
                'label' => 'Complete your profile and turn on 2-step'),
            'first_comment'   => array('amount' => 25,  'once' => true,
                'label' => 'Leave your first comment'),
            'first_watch'     => array('amount' => 15,  'once' => true,
                'label' => 'Watch your first video'),
            'first_follow'    => array('amount' => 15,  'once' => true,
                'label' => 'Follow your first creator'),

            // Repeatable.
            'daily_visit'     => array('amount' => 15,  'cap' => 15,
                'label' => 'Show up for the day'),
            'watch_video'     => array('amount' => 3,   'cap' => 30,
                'label' => 'Watch a video'),
            'comment_made'    => array('amount' => 5,   'cap' => 25,
                'label' => 'Comment on a video'),
            'comment_got'     => array('amount' => 3,   'cap' => 30,
                'label' => 'Someone comments on your post'),
            'follower_got'    => array('amount' => 10,  'cap' => 50,
                'label' => 'Gain a follower'),
            'poll_voted'      => array('amount' => 2,   'cap' => 10,
                'label' => 'Vote in a live poll'),
            'video_published' => array('amount' => 60,  'cap' => 180,
                'label' => 'Publish a video'),
            'letter_published' => array('amount' => 50, 'cap' => 150,
                'label' => 'Publish a Loop Letter'),
            'stream_started'  => array('amount' => 75,  'cap' => 150,
                'label' => 'Go live'),
            'game_played'     => array('amount' => 5,   'cap' => 25,
                'label' => 'Finish a game'),
        );

        // Option overrides let the economy be retuned from the database.
        $tuning = (array) get_option('sml_lb_earn_tuning', array());
        foreach ($tuning as $key => $amount) {
            if (isset($rules[$key])) {
                $rules[$key]['amount'] = (int) $amount;
            }
        }
        return apply_filters('sml_lb_earn_rules', $rules);
    }
}

if (!function_exists('sml_lb_earn_daily_ceiling')) {
    /** Nothing may earn more than this in one day, whatever the rules say. */
    function sml_lb_earn_daily_ceiling() {
        return (int) apply_filters('sml_lb_earn_daily_ceiling',
            (int) get_option('sml_lb_earn_ceiling', 400));
    }
}

if (!function_exists('sml_lb_earned_today')) {
    function sml_lb_earned_today($user_id, $event = '') {
        global $wpdb;
        $ledger = sml_lb_table('ledger');
        if ($event !== '') {
            return (int) $wpdb->get_var($wpdb->prepare(
                "SELECT COALESCE(SUM(delta), 0) FROM $ledger
                  WHERE user_id = %d AND reason = 'earn'
                    AND ref LIKE %s
                    AND created_at >= UTC_DATE()",
                (int) $user_id, 'earn:' . $event . ':%'
            ));
        }
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(delta), 0) FROM $ledger
              WHERE user_id = %d AND reason = 'earn' AND created_at >= UTC_DATE()",
            (int) $user_id
        ));
    }
}

if (!function_exists('sml_lb_has_earned')) {
    /** Has this once-only award already been paid? */
    function sml_lb_has_earned($user_id, $event) {
        global $wpdb;
        $ledger = sml_lb_table('ledger');
        return (bool) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM $ledger WHERE user_id = %d AND ref LIKE %s LIMIT 1",
            (int) $user_id, 'earn:' . $event . ':%'
        ));
    }
}

if (!function_exists('sml_lb_award')) {
    /**
     * Pay a user for doing something.
     *
     * $key distinguishes separate occurrences within a day -- a video id, a
     * comment id. Leave it empty for once-a-day rules; the date fills in.
     *
     * Returns the amount actually awarded, which is 0 when a cap is hit or the
     * award has already been paid. Never throws: earning is a side effect of
     * doing something else, and a capped award must not break that action.
     */
    function sml_lb_award($event, $user_id = 0, $key = '', $meta = array()) {
        $user_id = (int) ($user_id ?: get_current_user_id());
        if ($user_id <= 0) {
            return 0;
        }
        $rules = sml_lb_earn_rules();
        if (!isset($rules[$event])) {
            return 0;
        }
        $rule = $rules[$event];
        $amount = (int) $rule['amount'];
        if ($amount <= 0) {
            return 0;
        }

        if (!empty($rule['once'])) {
            if (sml_lb_has_earned($user_id, $event)) {
                return 0;
            }
            $ref = 'earn:' . $event . ':' . $user_id;
        } else {
            $day = gmdate('Ymd');
            $cap = (int) (isset($rule['cap']) ? $rule['cap'] : $rule['amount']);
            $already = sml_lb_earned_today($user_id, $event);
            if ($cap > 0 && $already >= $cap) {
                return 0;
            }
            if ($cap > 0) {
                $amount = min($amount, $cap - $already);
            }
            $slug = $key !== '' ? sanitize_key((string) $key) : $day;
            $ref = 'earn:' . $event . ':' . $user_id . ':' . $day . ':' . $slug;
        }

        // Global ceiling, applied last so one busy rule cannot swallow the day.
        $ceiling = sml_lb_earn_daily_ceiling();
        if ($ceiling > 0) {
            $today = sml_lb_earned_today($user_id);
            if ($today >= $ceiling) {
                return 0;
            }
            $amount = min($amount, $ceiling - $today);
        }
        if ($amount <= 0) {
            return 0;
        }

        $moved = sml_lb_move($user_id, $amount, 'earn', $ref,
            array_merge(array('event' => $event), (array) $meta));
        if (is_wp_error($moved) || !empty($moved['replayed'])) {
            return 0;
        }
        do_action('sml_lb_earned', $user_id, $event, $amount);
        return $amount;
    }
}

if (!function_exists('sml_lb_earn_progress')) {
    /** What a member has, what they still need, and the quickest ways to get it. */
    function sml_lb_earn_progress($user_id) {
        $user_id = (int) $user_id;
        $rules = sml_lb_earn_rules();
        $today = sml_lb_earned_today($user_id);

        $todo = array();
        foreach ($rules as $key => $rule) {
            if (!empty($rule['once'])) {
                if (!sml_lb_has_earned($user_id, $key)) {
                    $todo[] = array('key' => $key, 'label' => $rule['label'],
                        'amount' => (int) $rule['amount'], 'once' => true);
                }
                continue;
            }
            $cap = (int) (isset($rule['cap']) ? $rule['cap'] : $rule['amount']);
            $got = sml_lb_earned_today($user_id, $key);
            if ($cap <= 0 || $got < $cap) {
                $todo[] = array('key' => $key, 'label' => $rule['label'],
                    'amount' => (int) $rule['amount'], 'once' => false,
                    'left' => max(0, $cap - $got));
            }
        }

        // Biggest wins first -- that is what someone staring at a locked
        // feature actually wants to know.
        usort($todo, function ($a, $b) {
            if ($a['once'] !== $b['once']) {
                return $a['once'] ? -1 : 1;
            }
            return $b['amount'] - $a['amount'];
        });

        return array(
            'balance'     => sml_lb_balance($user_id),
            'today'       => $today,
            'ceiling'     => sml_lb_earn_daily_ceiling(),
            'ways'        => array_slice($todo, 0, 8),
        );
    }
}

/* ==================================================================
 * Hooks
 *
 * Each of these is a real thing a member did. Awards are deliberately
 * fire-and-forget: if a cap blocks the payment the underlying action
 * still succeeds.
 * ================================================================== */

if (!function_exists('sml_lb_on_login')) {
    function sml_lb_on_login($login, $user = null) {
        if (!$user || empty($user->ID)) {
            return;
        }
        sml_lb_award('daily_visit', $user->ID);
    }
}
add_action('wp_login', 'sml_lb_on_login', 10, 2);

if (!function_exists('sml_lb_on_visit')) {
    /**
     * wp_login only fires on a fresh sign-in, and people stay logged in for
     * weeks. Award the daily on the first authenticated page view instead,
     * behind a transient so it costs one cache read rather than a query.
     */
    function sml_lb_on_visit() {
        if (is_admin() || !is_user_logged_in() || wp_doing_ajax()) {
            return;
        }
        $uid = get_current_user_id();
        $seen = 'sml_lb_day_' . $uid . '_' . gmdate('Ymd');
        if (get_transient($seen)) {
            return;
        }
        set_transient($seen, 1, DAY_IN_SECONDS);
        sml_lb_award('daily_visit', $uid);
    }
}
add_action('template_redirect', 'sml_lb_on_visit', 99);

if (!function_exists('sml_lb_on_letter_published')) {
    function sml_lb_on_letter_published($letter_id, $row) {
        $author = (int) ($row['user_id'] ?? 0);
        if ($author) {
            sml_lb_award('letter_published', $author, 'letter' . (int) $letter_id);
        }
    }
}
add_action('sml_letters_published', 'sml_lb_on_letter_published', 10, 2);

if (!function_exists('sml_lb_earn_routes')) {
    function sml_lb_earn_routes() {
        register_rest_route('sml-lb/v1', '/earn', array(
            'methods'  => 'GET',
            'permission_callback' => '__return_true',
            'callback' => function () {
                $uid = get_current_user_id();
                if (!$uid) {
                    return array('balance' => 0, 'ways' => array(), 'today' => 0);
                }
                return sml_lb_earn_progress($uid);
            },
        ));

        // Client-reported watch completion. Rate-limited and capped, and worth
        // little, because anything the browser asserts can be faked.
        register_rest_route('sml-lb/v1', '/earn/watched', array(
            'methods'  => 'POST',
            'permission_callback' => function () {
                return is_user_logged_in();
            },
            'callback' => function (WP_REST_Request $r) {
                $video = sanitize_key((string) $r->get_param('video_id'));
                if ($video === '') {
                    return new WP_Error('no_video', 'Which video?', array('status' => 400));
                }
                $uid = get_current_user_id();
                sml_lb_award('first_watch', $uid);
                $paid = sml_lb_award('watch_video', $uid, $video, array('video' => $video));
                return array('ok' => true, 'awarded' => $paid,
                    'balance' => sml_lb_balance($uid));
            },
        ));
    }
}
add_action('rest_api_init', 'sml_lb_earn_routes');
