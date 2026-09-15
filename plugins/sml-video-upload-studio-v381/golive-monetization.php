<?php
/**
 * Creator-scoped monetization settings for the Go Live studio.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_gl_membership_category_defaults')) {
    function sml_gl_membership_category_defaults($category) {
        $content = $category === 'content';
        return array(
            'enabled' => false,
            'name' => $content ? 'Creator Content Membership' : 'Server / Group Membership',
            'description' => '',
            'checkout_url' => '',
            'members_only_live' => $content,
            'members_only_videos' => $content,
            'callin_credits_enabled' => false,
            'callin_credits_per_renewal' => 0,
            'callin_seconds_per_credit' => 30,
            'plans' => sml_creator_membership_plan_defaults(),
        );
    }
}

if (!function_exists('sml_gl_monetization_defaults')) {
    function sml_gl_monetization_defaults() {
        return array(
            'superchat_enabled' => true,
            'superchat_min_loop_bucks' => 5,
            'superchat_max_loop_bucks' => 500,
            'superchat_message_limit' => 200,
            /* Voice Super Chat (recorded messages) — the creator prices each length (owner design 2026-09-15) */
            'voice_enabled' => true,
            'voice_price_15' => 500,
            'voice_price_20' => 2000,
            'voice_price_30' => 5000,
            /* YouTube-style levels: the amount decides the level name + color shown in chat and on the stream */
            'superchat_levels' => sml_gl_default_levels(),
            'stickers_enabled' => false,
            'memberships_enabled' => false,
            'content_membership' => sml_gl_membership_category_defaults('content'),
            'server_group_membership' => sml_gl_membership_category_defaults('server_group'),
            'affiliate_enabled' => false,
            'affiliate_label' => '',
            'affiliate_url' => '',
            'affiliate_disclosure' => 'I may earn a commission from qualifying purchases.',
            'creator_revenue_percent' => 75,
            'platform_revenue_percent' => 25,
        );
    }
}

if (!function_exists('sml_gl_normalize_membership_plans')) {
    function sml_gl_normalize_membership_plans($plans) {
        $defaults = sml_creator_membership_plan_defaults();
        $plans = is_array($plans) ? $plans : array();
        foreach ($defaults as $slug => $default) {
            $incoming = isset($plans[$slug]) && is_array($plans[$slug]) ? $plans[$slug] : array();
            $defaults[$slug]['enabled'] = !empty($incoming['enabled']);
            $defaults[$slug]['price_cents'] = max(0, min(100000000, (int) ($incoming['price_cents'] ?? $default['price_cents'])));
        }
        return $defaults;
    }
}

if (!function_exists('sml_gl_normalize_membership_category')) {
    function sml_gl_normalize_membership_category($category, $stored) {
        $defaults = sml_gl_membership_category_defaults($category);
        $stored = is_array($stored) ? $stored : array();
        $settings = array_merge($defaults, $stored);
        $settings['enabled'] = !empty($settings['enabled']);
        $settings['name'] = sanitize_text_field((string) $settings['name']);
        $settings['description'] = sanitize_textarea_field((string) $settings['description']);
        $settings['checkout_url'] = esc_url_raw((string) $settings['checkout_url']);
        $settings['members_only_live'] = $category === 'content' && !empty($settings['members_only_live']);
        $settings['members_only_videos'] = $category === 'content' && !empty($settings['members_only_videos']);
        $settings['callin_credits_enabled'] = $category === 'content' && !empty($settings['callin_credits_enabled']);
        $settings['callin_credits_per_renewal'] = $settings['callin_credits_enabled']
            ? max(1, min(100, (int) $settings['callin_credits_per_renewal']))
            : 0;
        $settings['callin_seconds_per_credit'] = max(15, min(300, (int) $settings['callin_seconds_per_credit']));
        $settings['plans'] = sml_gl_normalize_membership_plans($settings['plans'] ?? array());
        return $settings;
    }
}

if (!function_exists('sml_gl_default_levels')) {
    /* YouTube-style Super Chat levels (1 LB = 1 cent): the amount decides the level; creators can re-cut them. */
    function sml_gl_default_levels() {
        return array(
            array('min' => 1,    'label' => 'Blue',    'color' => '#1e88e5'),
            array('min' => 20,   'label' => 'Cyan',    'color' => '#00bcd4'),
            array('min' => 50,   'label' => 'Green',   'color' => '#1de9b6'),
            array('min' => 100,  'label' => 'Yellow',  'color' => '#ffca28'),
            array('min' => 250,  'label' => 'Orange',  'color' => '#f57c00'),
            array('min' => 500,  'label' => 'Magenta', 'color' => '#e91e63'),
            array('min' => 1000, 'label' => 'Red',     'color' => '#e62117'),
        );
    }
}
if (!function_exists('sml_gl_normalize_levels')) {
    function sml_gl_normalize_levels($raw) {
        if (is_string($raw)) { $raw = json_decode($raw, true); }
        if (!is_array($raw)) { return sml_gl_default_levels(); }
        $out = array(); $seen = array();
        foreach ($raw as $lv) {
            if (!is_array($lv)) { continue; }
            $min = max(1, min(1000000, (int) ($lv['min'] ?? 0)));
            if (!$min || isset($seen[$min])) { continue; }
            $label = sanitize_text_field((string) ($lv['label'] ?? ''));
            $label = $label !== '' ? mb_substr($label, 0, 24) : ('Level ' . (count($out) + 1));
            $color = (string) ($lv['color'] ?? '');
            if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) { $color = '#1e88e5'; }
            $seen[$min] = true;
            $out[] = array('min' => $min, 'label' => $label, 'color' => strtolower($color));
            if (count($out) >= 10) { break; }
        }
        if (!$out) { return sml_gl_default_levels(); }
        usort($out, function ($a, $b) { return $a['min'] <=> $b['min']; });
        return array_values($out);
    }
}
if (!function_exists('sml_gl_superchat_level')) {
    /* The level a Loop Bucks amount falls into for this creator (highest level whose minimum is met). */
    function sml_gl_superchat_level($user_id, $loop_bucks) {
        $levels = $user_id ? sml_gl_get_monetization_settings((int) $user_id)['superchat_levels'] : sml_gl_default_levels();
        $pick = $levels[0];
        foreach ($levels as $lv) { if ((int) $loop_bucks >= (int) $lv['min']) { $pick = $lv; } }
        return $pick;
    }
}
if (!function_exists('sml_gl_get_monetization_settings')) {
    function sml_gl_get_monetization_settings($user_id) {
        $stored = get_user_meta((int) $user_id, '_sml_gl_monetization', true);
        if (!is_array($stored)) {
            $stored = array();
        }

        $settings = array_merge(sml_gl_monetization_defaults(), $stored);
        // Migrate the original one-off membership link into Content Memberships.
        if (empty($stored['content_membership']) && !empty($stored['membership_name'])) {
            $settings['content_membership'] = array_merge(
                sml_gl_membership_category_defaults('content'),
                array(
                    'enabled' => !empty($stored['memberships_enabled']),
                    'name' => (string) $stored['membership_name'],
                    'checkout_url' => (string) ($stored['membership_url'] ?? ''),
                )
            );
        }

        $settings['superchat_enabled'] = !empty($settings['superchat_enabled']);
        $settings['stickers_enabled'] = false;
        $settings['affiliate_enabled'] = !empty($settings['affiliate_enabled']);
        $settings['superchat_min_loop_bucks'] = max(1, min(1000, (int) $settings['superchat_min_loop_bucks']));
        $settings['superchat_max_loop_bucks'] = max(
            $settings['superchat_min_loop_bucks'],
            min(10000, (int) $settings['superchat_max_loop_bucks'])
        );
        $settings['superchat_message_limit'] = max(40, min(500, (int) $settings['superchat_message_limit']));
        $settings['voice_enabled'] = !isset($settings['voice_enabled']) || !empty($settings['voice_enabled']);
        foreach (array('15' => 500, '20' => 2000, '30' => 5000) as $sec => $def) {
            $k = 'voice_price_' . $sec;
            $v = isset($settings[$k]) ? (int) $settings[$k] : 0;
            $settings[$k] = max(1, min(100000, $v > 0 ? $v : $def));
        }
        $settings['superchat_levels'] = sml_gl_normalize_levels($settings['superchat_levels'] ?? null);
        $settings['content_membership'] = sml_gl_normalize_membership_category(
            'content',
            $settings['content_membership'] ?? array()
        );
        $settings['server_group_membership'] = sml_gl_normalize_membership_category(
            'server_group',
            $settings['server_group_membership'] ?? array()
        );
        $settings['memberships_enabled'] = !empty($settings['content_membership']['enabled'])
            || !empty($settings['server_group_membership']['enabled']);
        $settings['creator_revenue_percent'] = 75;
        $settings['platform_revenue_percent'] = 25;

        unset($settings['membership_name'], $settings['membership_price_label'], $settings['membership_url']);
        return $settings;
    }
}

if (!function_exists('sml_gl_monetization_payload')) {
    function sml_gl_monetization_payload($user_id) {
        return array(
            'ok' => true,
            'settings' => sml_gl_get_monetization_settings($user_id),
            'capabilities' => array(
                'superchat' => true,
                'stickers' => false,
                'memberships' => true,
                'affiliate' => true,
            ),
            'currency' => array(
                'code' => 'USD',
                'label' => 'US dollars',
            ),
            'membership_rules' => array(
                'minimum_term' => '1 month',
                'durations' => array('month_1', 'month_3', 'month_6', 'year_1', 'lifetime'),
                'credits_reset_on_renewal' => true,
                'credits_stack' => false,
                'credits_transferable' => false,
            ),
        );
    }
}

if (!function_exists('sml_gl_validate_membership_category')) {
    function sml_gl_validate_membership_category($category, $settings) {
        if (empty($settings['enabled'])) {
            return true;
        }
        if (!$settings['name'] || !$settings['checkout_url']) {
            return new WP_Error(
                'sml_gl_membership_incomplete',
                'Add a membership name and checkout URL before enabling this membership category.',
                array('status' => 400)
            );
        }
        $month = $settings['plans']['month_1'] ?? array();
        if (empty($month['enabled']) || empty($month['price_cents'])) {
            return new WP_Error(
                'sml_gl_membership_month_required',
                'Every membership must offer a priced 1-month plan.',
                array('status' => 400)
            );
        }
        foreach ($settings['plans'] as $plan) {
            if (!empty($plan['enabled']) && empty($plan['price_cents'])) {
                return new WP_Error(
                    'sml_gl_membership_price_required',
                    'Every enabled membership duration needs a price.',
                    array('status' => 400)
                );
            }
        }
        return true;
    }
}

if (!function_exists('sml_gl_rest_monetization')) {
    function sml_gl_rest_monetization(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        if (!$user_id) {
            return new WP_Error('sml_gl_login_required', 'Sign in to manage monetization.', array('status' => 401));
        }
        if ($request->get_method() === 'GET') {
            return sml_gl_monetization_payload($user_id);
        }

        $current = sml_gl_get_monetization_settings($user_id);
        $min = max(1, min(1000, (int) $request->get_param('superchat_min_loop_bucks')));
        $max = max($min, min(10000, (int) $request->get_param('superchat_max_loop_bucks')));
        $content = sml_gl_normalize_membership_category('content', $request->get_param('content_membership'));
        $server_group = sml_gl_normalize_membership_category('server_group', $request->get_param('server_group_membership'));

        $valid = sml_gl_validate_membership_category('content', $content);
        if (is_wp_error($valid)) {
            return $valid;
        }
        $valid = sml_gl_validate_membership_category('server_group', $server_group);
        if (is_wp_error($valid)) {
            return $valid;
        }

        $settings = array(
            'superchat_enabled' => (bool) $request->get_param('superchat_enabled'),
            'superchat_min_loop_bucks' => $min,
            'superchat_max_loop_bucks' => $max,
            'superchat_message_limit' => max(40, min(500, (int) $request->get_param('superchat_message_limit'))),
            'voice_enabled' => $request->get_param('voice_enabled') === null ? !empty($current['voice_enabled']) : (bool) $request->get_param('voice_enabled'),
            'voice_price_15' => max(1, min(100000, (int) $request->get_param('voice_price_15') ?: (int) $current['voice_price_15'])),
            'voice_price_20' => max(1, min(100000, (int) $request->get_param('voice_price_20') ?: (int) $current['voice_price_20'])),
            'voice_price_30' => max(1, min(100000, (int) $request->get_param('voice_price_30') ?: (int) $current['voice_price_30'])),
            'superchat_levels' => sml_gl_normalize_levels($request->get_param('superchat_levels') === null ? $current['superchat_levels'] : $request->get_param('superchat_levels')),
            'stickers_enabled' => false,
            'memberships_enabled' => !empty($content['enabled']) || !empty($server_group['enabled']),
            'content_membership' => $content,
            'server_group_membership' => $server_group,
            'affiliate_enabled' => (bool) $request->get_param('affiliate_enabled'),
            'affiliate_label' => sanitize_text_field((string) $request->get_param('affiliate_label')),
            'affiliate_url' => esc_url_raw((string) $request->get_param('affiliate_url')),
            'affiliate_disclosure' => sanitize_textarea_field((string) $request->get_param('affiliate_disclosure')),
            'creator_revenue_percent' => 75,
            'platform_revenue_percent' => 25,
        );

        if ($settings['affiliate_enabled'] && (!$settings['affiliate_label'] || !$settings['affiliate_url'])) {
            return new WP_Error(
                'sml_gl_affiliate_incomplete',
                'Add an affiliate link label and URL before enabling affiliate links.',
                array('status' => 400)
            );
        }
        if (!$settings['affiliate_disclosure']) {
            $settings['affiliate_disclosure'] = $current['affiliate_disclosure'];
        }

        update_user_meta($user_id, '_sml_gl_monetization', $settings);
        do_action('sml_creator_monetization_updated', $user_id, $settings);
        return sml_gl_monetization_payload($user_id);
    }
}

if (!function_exists('sml_gl_register_monetization_route')) {
    function sml_gl_register_monetization_route() {
        register_rest_route('sml-video-upload-studio/v1', '/creator-revenue-settings', array(
            array(
                'methods' => WP_REST_Server::READABLE,
                'callback' => 'sml_gl_rest_monetization',
                'permission_callback' => 'is_user_logged_in',
            ),
            array(
                'methods' => WP_REST_Server::EDITABLE,
                'callback' => 'sml_gl_rest_monetization',
                'permission_callback' => 'is_user_logged_in',
            ),
        ));
    }
}
add_action('rest_api_init', 'sml_gl_register_monetization_route');
