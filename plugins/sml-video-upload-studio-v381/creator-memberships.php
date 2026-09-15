<?php
/**
 * Creator membership products, entitlements and creator-scoped call-in credits.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SML_CREATOR_MEMBERSHIP_DB_VERSION', '1.0.0');

if (!function_exists('sml_creator_membership_table')) {
    function sml_creator_membership_table($name) {
        global $wpdb;
        return $wpdb->prefix . 'sml_creator_membership_' . $name;
    }
}

if (!function_exists('sml_creator_membership_plan_defaults')) {
    function sml_creator_membership_plan_defaults() {
        return array(
            'month_1' => array('label' => '1 month', 'months' => 1, 'enabled' => true, 'price_cents' => 999),
            'month_3' => array('label' => '3 months', 'months' => 3, 'enabled' => false, 'price_cents' => 2499),
            'month_6' => array('label' => '6 months', 'months' => 6, 'enabled' => false, 'price_cents' => 4499),
            'year_1' => array('label' => '1 year', 'months' => 12, 'enabled' => false, 'price_cents' => 7999),
            'lifetime' => array('label' => 'Lifetime', 'months' => 0, 'enabled' => false, 'price_cents' => 19999),
        );
    }
}

if (!function_exists('sml_creator_membership_install')) {
    function sml_creator_membership_install() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        $memberships = sml_creator_membership_table('entitlements');
        $ledger = sml_creator_membership_table('credit_ledger');

        dbDelta("CREATE TABLE $memberships (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            member_id BIGINT UNSIGNED NOT NULL,
            creator_id BIGINT UNSIGNED NOT NULL,
            category VARCHAR(24) NOT NULL DEFAULT 'content',
            plan_slug VARCHAR(24) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            price_cents INT UNSIGNED NOT NULL DEFAULT 0,
            period_start DATETIME NOT NULL,
            period_end DATETIME NULL,
            is_lifetime TINYINT(1) NOT NULL DEFAULT 0,
            callin_credit_allowance SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            callin_credits_remaining SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            source_ref VARCHAR(191) NULL,
            renewal_key VARCHAR(191) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY member_creator_category (member_id, creator_id, category),
            UNIQUE KEY renewal_key (renewal_key),
            KEY creator_status (creator_id, category, status),
            KEY member_status (member_id, category, status),
            KEY expiry (status, period_end)
        ) $charset;");

        dbDelta("CREATE TABLE $ledger (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            entitlement_id BIGINT UNSIGNED NOT NULL,
            member_id BIGINT UNSIGNED NOT NULL,
            creator_id BIGINT UNSIGNED NOT NULL,
            delta SMALLINT NOT NULL DEFAULT 0,
            balance_after SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            event VARCHAR(32) NOT NULL,
            source_ref VARCHAR(191) NULL,
            idempotency_key VARCHAR(191) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY idempotency_key (idempotency_key),
            KEY entitlement_time (entitlement_id, created_at),
            KEY member_creator (member_id, creator_id, created_at)
        ) $charset;");

        update_option('sml_creator_membership_db_version', SML_CREATOR_MEMBERSHIP_DB_VERSION, false);
    }
}

if (!function_exists('sml_creator_membership_maybe_upgrade')) {
    function sml_creator_membership_maybe_upgrade() {
        if (get_option('sml_creator_membership_db_version') !== SML_CREATOR_MEMBERSHIP_DB_VERSION) {
            sml_creator_membership_install();
        }
    }
}
add_action('init', 'sml_creator_membership_maybe_upgrade', 4);

if (!function_exists('sml_creator_membership_active_row')) {
    function sml_creator_membership_active_row($member_id, $creator_id, $category = 'content') {
        global $wpdb;
        $table = sml_creator_membership_table('entitlements');
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table
              WHERE member_id = %d AND creator_id = %d AND category = %s
                AND status = 'active'
                AND (is_lifetime = 1 OR period_end IS NULL OR period_end > UTC_TIMESTAMP())
              LIMIT 1",
            (int) $member_id,
            (int) $creator_id,
            sanitize_key($category)
        ), ARRAY_A);
        return is_array($row) ? $row : null;
    }
}

if (!function_exists('sml_gl_user_has_content_access')) {
    function sml_gl_user_has_content_access($member_id, $creator_id) {
        if ((int) $member_id === (int) $creator_id || user_can((int) $member_id, 'manage_options')) {
            return true;
        }
        return (bool) sml_creator_membership_active_row($member_id, $creator_id, 'content');
    }
}

if (!function_exists('sml_gl_user_has_group_access')) {
    function sml_gl_user_has_group_access($member_id, $creator_id) {
        if ((int) $member_id === (int) $creator_id || user_can((int) $member_id, 'manage_options')) {
            return true;
        }
        return (bool) sml_creator_membership_active_row($member_id, $creator_id, 'server_group');
    }
}

if (!function_exists('sml_creator_membership_apply_renewal')) {
    /**
     * Called by a successful checkout/renewal webhook.
     *
     * Credits reset to the configured allowance. They never accumulate.
     */
    function sml_creator_membership_apply_renewal($args) {
        global $wpdb;
        $args = wp_parse_args((array) $args, array(
            'member_id' => 0,
            'creator_id' => 0,
            'category' => 'content',
            'plan_slug' => 'month_1',
            'status' => 'active',
            'price_cents' => 0,
            'period_start' => gmdate('Y-m-d H:i:s'),
            'period_end' => null,
            'source_ref' => '',
            'renewal_key' => '',
        ));

        $member_id = (int) $args['member_id'];
        $creator_id = (int) $args['creator_id'];
        $category = in_array($args['category'], array('content', 'server_group'), true) ? $args['category'] : 'content';
        $plan_slug = sanitize_key($args['plan_slug']);
        $plans = sml_creator_membership_plan_defaults();
        if (!$member_id || !$creator_id || !isset($plans[$plan_slug])) {
            return new WP_Error('sml_membership_invalid', 'Invalid membership renewal data.');
        }

        $renewal_key = sanitize_text_field((string) $args['renewal_key']);
        if (!$renewal_key) {
            $renewal_key = 'membership:' . $member_id . ':' . $creator_id . ':' . $category . ':' . $plan_slug . ':' . md5((string) $args['period_start']);
        }

        $table = sml_creator_membership_table('entitlements');
        $ledger = sml_creator_membership_table('credit_ledger');
        $already = $wpdb->get_var($wpdb->prepare("SELECT id FROM $ledger WHERE idempotency_key = %s", $renewal_key));
        if ($already) {
            return sml_creator_membership_active_row($member_id, $creator_id, $category);
        }

        $creator_settings = function_exists('sml_gl_get_monetization_settings')
            ? sml_gl_get_monetization_settings($creator_id)
            : array();
        $content = isset($creator_settings['content_membership']) && is_array($creator_settings['content_membership'])
            ? $creator_settings['content_membership']
            : array();
        $allowance = ($category === 'content' && !empty($content['callin_credits_enabled']))
            ? max(0, min(100, (int) ($content['callin_credits_per_renewal'] ?? 0)))
            : 0;

        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE member_id = %d AND creator_id = %d AND category = %s LIMIT 1",
            $member_id,
            $creator_id,
            $category
        ), ARRAY_A);
        $old_balance = $existing ? (int) $existing['callin_credits_remaining'] : 0;
        $is_lifetime = $plan_slug === 'lifetime' ? 1 : 0;
        $period_end = $is_lifetime ? null : sanitize_text_field((string) $args['period_end']);
        if (!$is_lifetime && !$period_end) {
            $months = (int) $plans[$plan_slug]['months'];
            $period_end = gmdate('Y-m-d H:i:s', strtotime('+' . $months . ' months', strtotime((string) $args['period_start'] . ' UTC')));
        }

        $row = array(
            'member_id' => $member_id,
            'creator_id' => $creator_id,
            'category' => $category,
            'plan_slug' => $plan_slug,
            'status' => sanitize_key((string) $args['status']) ?: 'active',
            'price_cents' => max(0, (int) $args['price_cents']),
            'period_start' => sanitize_text_field((string) $args['period_start']),
            'period_end' => $period_end ?: null,
            'is_lifetime' => $is_lifetime,
            'callin_credit_allowance' => $allowance,
            'callin_credits_remaining' => $allowance,
            'source_ref' => sanitize_text_field((string) $args['source_ref']),
            'renewal_key' => $renewal_key,
            'updated_at' => gmdate('Y-m-d H:i:s'),
        );

        if ($existing) {
            $wpdb->update($table, $row, array('id' => (int) $existing['id']));
            $entitlement_id = (int) $existing['id'];
        } else {
            $row['created_at'] = gmdate('Y-m-d H:i:s');
            $wpdb->insert($table, $row);
            $entitlement_id = (int) $wpdb->insert_id;
        }

        $wpdb->insert($ledger, array(
            'entitlement_id' => $entitlement_id,
            'member_id' => $member_id,
            'creator_id' => $creator_id,
            'delta' => $allowance - $old_balance,
            'balance_after' => $allowance,
            'event' => $is_lifetime ? 'lifetime_grant' : 'renewal_reset',
            'source_ref' => sanitize_text_field((string) $args['source_ref']),
            'idempotency_key' => $renewal_key,
        ));

        do_action('sml_creator_membership_updated', $entitlement_id, $row);
        return sml_creator_membership_active_row($member_id, $creator_id, $category);
    }
}
add_action('sml_creator_membership_renewed', 'sml_creator_membership_apply_renewal', 10, 1);

if (!function_exists('sml_gl_get_callin_credit_status')) {
    function sml_gl_get_callin_credit_status($member_id, $creator_id) {
        $row = sml_creator_membership_active_row($member_id, $creator_id, 'content');
        $settings = function_exists('sml_gl_get_monetization_settings')
            ? sml_gl_get_monetization_settings($creator_id)
            : array();
        $content = isset($settings['content_membership']) && is_array($settings['content_membership'])
            ? $settings['content_membership']
            : array();
        $remaining = $row ? (int) $row['callin_credits_remaining'] : 0;
        return array(
            'available' => $remaining > 0,
            'remaining' => $remaining,
            'allowance' => $row ? (int) $row['callin_credit_allowance'] : 0,
            'seconds' => max(15, min(300, (int) ($content['callin_seconds_per_credit'] ?? 30))),
            'creator_id' => (int) $creator_id,
            'creator_name' => get_the_author_meta('display_name', (int) $creator_id),
            'renews_at' => $row && empty($row['is_lifetime']) ? mysql_to_rfc3339($row['period_end']) : '',
            'non_transferable' => true,
        );
    }
}

if (!function_exists('sml_gl_consume_callin_credit')) {
    function sml_gl_consume_callin_credit($member_id, $creator_id, $room_id) {
        global $wpdb;
        $table = sml_creator_membership_table('entitlements');
        $ledger = sml_creator_membership_table('credit_ledger');
        $wpdb->query('START TRANSACTION');
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table
              WHERE member_id = %d AND creator_id = %d AND category = 'content'
                AND status = 'active'
                AND (is_lifetime = 1 OR period_end IS NULL OR period_end > UTC_TIMESTAMP())
              LIMIT 1 FOR UPDATE",
            (int) $member_id,
            (int) $creator_id
        ), ARRAY_A);
        if (!$row || (int) $row['callin_credits_remaining'] < 1) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('sml_callin_credit_empty', 'No call-in credits are available for this creator.', array('status' => 402));
        }

        $remaining = (int) $row['callin_credits_remaining'] - 1;
        $updated = $wpdb->update(
            $table,
            array('callin_credits_remaining' => $remaining, 'updated_at' => gmdate('Y-m-d H:i:s')),
            array('id' => (int) $row['id'])
        );
        if ($updated === false) {
            $wpdb->query('ROLLBACK');
            return new WP_Error('sml_callin_credit_update', 'Could not reserve the membership credit.', array('status' => 500));
        }

        $idem = 'callin:' . (int) $row['id'] . ':' . sanitize_key((string) $room_id) . ':' . wp_generate_uuid4();
        $wpdb->insert($ledger, array(
            'entitlement_id' => (int) $row['id'],
            'member_id' => (int) $member_id,
            'creator_id' => (int) $creator_id,
            'delta' => -1,
            'balance_after' => $remaining,
            'event' => 'callin_used',
            'source_ref' => sanitize_text_field((string) $room_id),
            'idempotency_key' => $idem,
        ));
        $wpdb->query('COMMIT');

        $status = sml_gl_get_callin_credit_status($member_id, $creator_id);
        $status['idempotency_key'] = $idem;
        return $status;
    }
}
