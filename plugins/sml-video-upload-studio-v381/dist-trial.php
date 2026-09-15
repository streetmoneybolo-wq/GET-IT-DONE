<?php
/**
 * Loop Distribution - 90-day trial, entitlements and upsell logic.
 *
 * Nothing is deleted at expiry. Accounts stay linked, rules stay configured,
 * variants keep generating, handoff keeps working. Only automated sending
 * stops. That asymmetry is the whole conversion mechanic - upgrading is
 * instant, so the cost of lapsing is felt without anything being destroyed.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SML_DIST_TRIAL_DAYS', 90);

if (!function_exists('sml_dist_tiers')) {
    function sml_dist_tiers() {
        return array(
            'free'   => array('label' => 'Free',    'accounts' => 0,  'schedule' => false, 'ab' => false, 'history' => 7),
            'trial'  => array('label' => 'Trial',   'accounts' => 10, 'schedule' => true,  'ab' => true,  'history' => 90),
            'pro'    => array('label' => 'Creator', 'accounts' => 3,  'schedule' => true,  'ab' => false, 'history' => 90),
            'studio' => array('label' => 'Studio',  'accounts' => 10, 'schedule' => true,  'ab' => true,  'history' => 0),
        );
    }
}

if (!function_exists('sml_dist_trial')) {
    function sml_dist_trial($user_id) {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_dist_table('trials') . " WHERE user_id = %d", (int) $user_id
        ), ARRAY_A);
    }
}

if (!function_exists('sml_dist_start_trial')) {
    /**
     * Fires on first account link. ended_reason is never cleared, so a second
     * trial requires an admin grant rather than deleting a row.
     */
    function sml_dist_start_trial($user_id) {
        global $wpdb;
        $existing = sml_dist_trial($user_id);
        if ($existing) {
            return $existing;
        }

        $now = time();
        $wpdb->insert(sml_dist_table('trials'), array(
            'user_id'    => (int) $user_id,
            'started_at' => gmdate('Y-m-d H:i:s', $now),
            'ends_at'    => gmdate('Y-m-d H:i:s', $now + SML_DIST_TRIAL_DAYS * DAY_IN_SECONDS),
            'tier'       => 'trial',
        ));
        return sml_dist_trial($user_id);
    }
}

if (!function_exists('sml_dist_tier')) {
    function sml_dist_tier($user_id) {
        $row = sml_dist_trial($user_id);
        if (!$row) {
            return 'free';
        }
        if ($row['tier'] === 'trial' && strtotime($row['ends_at'] . ' UTC') < time()) {
            return 'free';
        }
        return (string) $row['tier'];
    }
}

if (!function_exists('sml_dist_can_autoshare')) {
    function sml_dist_can_autoshare($user_id) {
        $tier = sml_dist_tier($user_id);
        $tiers = sml_dist_tiers();
        $allowed = ($tiers[$tier]['accounts'] ?? 0) > 0;
        return (bool) apply_filters('sml_dist_can_autoshare', $allowed, $user_id, $tier);
    }
}

if (!function_exists('sml_dist_entitlements')) {
    function sml_dist_entitlements($user_id) {
        $tier = sml_dist_tier($user_id);
        $spec = sml_dist_tiers()[$tier] ?? sml_dist_tiers()['free'];
        $row = sml_dist_trial($user_id);

        $days_left = null;
        if ($row && $row['tier'] === 'trial') {
            $left = strtotime($row['ends_at'] . ' UTC') - time();
            $days_left = max(0, (int) ceil($left / DAY_IN_SECONDS));
        }

        return array(
            'tier'          => $tier,
            'label'         => $spec['label'],
            'can_autoshare' => sml_dist_can_autoshare($user_id),
            'max_accounts'  => (int) $spec['accounts'],
            'can_schedule'  => (bool) $spec['schedule'],
            'can_ab_test'   => (bool) $spec['ab'],
            'history_days'  => (int) $spec['history'],
            'trial_days_left' => $days_left,
            'trial_ends_at' => $row['ends_at'] ?? null,
            'linked_count'  => count(sml_dist_accounts_for($user_id)),
        );
    }
}

if (!function_exists('sml_dist_accounts_for')) {
    function sml_dist_accounts_for($user_id) {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . sml_dist_table('accounts') . "
              WHERE user_id = %d AND status <> 'revoked' ORDER BY created_at ASC",
            (int) $user_id
        ), ARRAY_A) ?: array();
    }
}

if (!function_exists('sml_dist_bump_trial_usage')) {
    function sml_dist_bump_trial_usage($user_id) {
        global $wpdb;
        $wpdb->query($wpdb->prepare(
            "UPDATE " . sml_dist_table('trials') . "
                SET posts_used = posts_used + 1 WHERE user_id = %d",
            (int) $user_id
        ));
    }
}

/* ==================================================================
 * Expiry sweep
 * ================================================================== */

if (!function_exists('sml_dist_trial_sweep')) {
    function sml_dist_trial_sweep() {
        global $wpdb;
        $trials = sml_dist_table('trials');
        $queue = sml_dist_table('queue');

        $expired = $wpdb->get_results(
            "SELECT * FROM $trials WHERE tier = 'trial' AND ends_at < UTC_TIMESTAMP()",
            ARRAY_A
        );

        foreach ((array) $expired as $row) {
            $wpdb->update($trials, array(
                'tier'         => 'free',
                'ended_reason' => 'expired',
            ), array('user_id' => (int) $row['user_id']));

            // Pending sends are skipped, not silently dropped. The creator is
            // told which posts did not go out and why.
            $wpdb->query($wpdb->prepare(
                "UPDATE $queue SET status = 'skipped',
                        error_code = 'trial_ended',
                        error_message = 'Auto-share paused - trial ended.'
                  WHERE user_id = %d AND status = 'queued'",
                (int) $row['user_id']
            ));

            do_action('sml_dist_trial_expired', (int) $row['user_id'], $row);
        }
    }
}
add_action('sml_dist_trial_sweep', 'sml_dist_trial_sweep');

/* ==================================================================
 * Value recap
 * ================================================================== */

if (!function_exists('sml_dist_value_recap')) {
    /**
     * Built entirely from the creator's own numbers. If they are weak we show
     * them anyway - a creator with four clicks should not be sold a monthly
     * subscription, and being straight about that is what makes the pitch
     * credible for the creator with two thousand.
     */
    function sml_dist_value_recap($user_id) {
        global $wpdb;
        $q = sml_dist_table('queue');
        $c = sml_dist_table('clicks');
        $trial = sml_dist_trial($user_id);

        $sent = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM $q WHERE user_id = %d AND status = 'sent'", (int) $user_id));

        $platforms = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(DISTINCT platform) FROM $q WHERE user_id = %d AND status = 'sent'", (int) $user_id));

        $clicks = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM $c c
               JOIN $q q ON q.share_token = c.share_token
              WHERE q.user_id = %d", (int) $user_id));

        // Reads that came from a share link, vs total reads on this creator's
        // letters. The honest version of "distribution drove X% of your reads".
        $reads = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(read_count), 0) FROM " . $wpdb->prefix . "sml_letter_posts
              WHERE author_id = %d AND status = 'published'", (int) $user_id));

        $share_pct = $reads > 0 ? min(100, round(($clicks / $reads) * 100)) : 0;
        $minutes_saved = (int) round($sent * 3.7);

        return array(
            'posts_sent'     => $sent,
            'platforms'      => $platforms,
            'clicks'         => $clicks,
            'reads'          => $reads,
            'share_pct'      => $share_pct,
            'hours_saved'    => round($minutes_saved / 60, 1),
            'days_left'      => ($trial && $trial['tier'] === 'trial')
                ? max(0, (int) ceil((strtotime($trial['ends_at'] . ' UTC') - time()) / DAY_IN_SECONDS))
                : null,
            'worth_it'       => $clicks >= 50,
        );
    }
}

/* ==================================================================
 * Upsell triggers
 * ================================================================== */

if (!function_exists('sml_dist_upsell')) {
    /**
     * At most one upsell surface per session, and never on the publish screen.
     * An upsell that interrupts publishing costs more in abandoned letters
     * than it earns in conversions.
     */
    function sml_dist_upsell($user_id, $context = '') {
        if ($context === 'publish') {
            return null;
        }

        $ent = sml_dist_entitlements($user_id);
        $tier = $ent['tier'];

        if ($tier === 'trial') {
            $left = (int) $ent['trial_days_left'];
            if ($left <= 1) {
                return array('key' => 'trial_last_day', 'headline' => 'Auto-share stops tomorrow',
                             'recap' => sml_dist_value_recap($user_id));
            }
            if ($left <= 7) {
                return array('key' => 'trial_week', 'headline' => $left . ' days left on your trial',
                             'recap' => sml_dist_value_recap($user_id));
            }
            if ($left <= 15) {
                return array('key' => 'trial_two_weeks', 'headline' => $left . ' days left',
                             'recap' => sml_dist_value_recap($user_id));
            }
            return null;
        }

        if ($tier === 'free') {
            $recap = sml_dist_value_recap($user_id);
            if ($recap['posts_sent'] > 0) {
                return array('key' => 'lapsed', 'headline' => 'Auto-share is paused', 'recap' => $recap);
            }
            return null;
        }

        if ($tier === 'pro' && $ent['linked_count'] >= $ent['max_accounts']) {
            return array('key' => 'account_cap',
                         'headline' => 'Creator covers ' . $ent['max_accounts'] . ' accounts',
                         'recap' => null);
        }

        return null;
    }
}

/* ==================================================================
 * Admin grant
 * ================================================================== */

if (!function_exists('sml_dist_set_tier')) {
    function sml_dist_set_tier($user_id, $tier) {
        global $wpdb;
        if (!array_key_exists($tier, sml_dist_tiers())) {
            return new WP_Error('bad_tier', 'Unknown tier.', array('status' => 400));
        }
        sml_dist_start_trial($user_id);

        $patch = array('tier' => $tier);
        if ($tier === 'pro' || $tier === 'studio') {
            $patch['converted_at'] = sml_dist_now();
            $patch['ended_reason'] = 'converted';
        }
        if ($tier === 'trial') {
            $patch['ends_at'] = gmdate('Y-m-d H:i:s', time() + SML_DIST_TRIAL_DAYS * DAY_IN_SECONDS);
            $patch['ended_reason'] = null;
        }
        $wpdb->update(sml_dist_table('trials'), $patch, array('user_id' => (int) $user_id));
        return sml_dist_entitlements($user_id);
    }
}
