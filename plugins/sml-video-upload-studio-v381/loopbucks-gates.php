<?php
/**
 * Loop Bucks as an access threshold.
 *
 *   495  play games
 *   200  Creator Studio
 *   100  comment on a live stream
 *
 * These are *held*, not spent. Meeting a gate costs nothing -- the balance is
 * read and compared, never deducted. That distinction matters: a threshold you
 * hold is a membership standard, and one you pay is a purchase. Holding also
 * means a member cannot be gated out by using the site normally.
 *
 * Two escape hatches, because a threshold that locks the wrong people out is
 * worse than no threshold:
 *
 *   - Anyone who has already published keeps Creator Studio forever. Taking
 *     the studio away from someone with a back catalogue in it is indefensible.
 *   - Administrators bypass everything, so the owner can never lock themselves
 *     out by tuning a number.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_lb_gates')) {
    function sml_lb_gates() {
        $defaults = array(
            'games' => array(
                'need'  => 495,
                'label' => 'Play games',
                'why'   => 'Games are free to play. Holding 495 Loop Bucks is what unlocks them.',
            ),
            'creator' => array(
                'need'  => 200,
                'label' => 'Creator Studio',
                'why'   => 'Creator Studio opens at 200 Loop Bucks.',
            ),
            'live_comment' => array(
                'need'  => 100,
                'label' => 'Comment on live streams',
                'why'   => 'Live chat opens at 100 Loop Bucks.',
            ),
        );

        // Thresholds live in an option so they can be retuned without a deploy.
        $tuning = (array) get_option('sml_lb_gate_tuning', array());
        foreach ($tuning as $key => $need) {
            if (isset($defaults[$key])) {
                $defaults[$key]['need'] = max(0, (int) $need);
            }
        }
        return apply_filters('sml_lb_gates', $defaults);
    }
}

if (!function_exists('sml_lb_gate_need')) {
    function sml_lb_gate_need($gate) {
        $all = sml_lb_gates();
        return isset($all[$gate]) ? (int) $all[$gate]['need'] : 0;
    }
}

/* ==================================================================
 * Grandfathering
 * ================================================================== */

if (!function_exists('sml_lb_has_published')) {
    /**
     * Has this person ever published a video or a Loop Letter?
     *
     * Cached in user meta because it is checked on every Creator Studio hit
     * and the answer only ever changes from no to yes.
     */
    function sml_lb_has_published($user_id) {
        global $wpdb;
        $user_id = (int) $user_id;
        if ($user_id <= 0) {
            return false;
        }
        $flag = get_user_meta($user_id, 'sml_lb_founder', true);
        if ($flag !== '') {
            return (bool) $flag;
        }

        $published = false;

        $videos = $wpdb->get_var($wpdb->prepare(
            "SELECT ID FROM {$wpdb->posts}
              WHERE post_author = %d AND post_status = 'publish' LIMIT 1",
            $user_id
        ));
        if ($videos) {
            $published = true;
        }

        if (!$published && function_exists('sml_letters_table')) {
            $letters = $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM " . sml_letters_table('letters') . "
                  WHERE user_id = %d AND status = 'published' LIMIT 1",
                $user_id
            ));
            if ($letters) {
                $published = true;
            }
        }

        // Only the positive is cached. Someone who has not published yet may
        // do so tomorrow, and we want to notice.
        if ($published) {
            update_user_meta($user_id, 'sml_lb_founder', 1);
        }
        return $published;
    }
}

if (!function_exists('sml_lb_gate_exempt')) {
    function sml_lb_gate_exempt($gate, $user_id) {
        $user_id = (int) $user_id;
        if ($user_id <= 0) {
            return false;
        }
        if (user_can($user_id, 'manage_options')) {
            return true;
        }
        if ($gate === 'creator' && sml_lb_has_published($user_id)) {
            return true;
        }
        return (bool) apply_filters('sml_lb_gate_exempt', false, $gate, $user_id);
    }
}

/* ==================================================================
 * The check
 * ================================================================== */

if (!function_exists('sml_lb_can')) {
    function sml_lb_can($gate, $user_id = 0) {
        $user_id = (int) ($user_id ?: get_current_user_id());
        if ($user_id <= 0) {
            return false;
        }
        if (sml_lb_gate_exempt($gate, $user_id)) {
            return true;
        }
        return sml_lb_balance($user_id) >= sml_lb_gate_need($gate);
    }
}

if (!function_exists('sml_lb_gate_check')) {
    /**
     * True, or a WP_Error carrying everything the client needs to render a
     * useful lock screen: what they have, what they need, and the gap.
     *
     * Status is 403 and not 402 -- WordPress.com's edge intercepts 402 and
     * replaces the body with its own "site disabled" page.
     */
    function sml_lb_gate_check($gate, $user_id = 0) {
        $user_id = (int) ($user_id ?: get_current_user_id());
        if ($user_id <= 0) {
            return new WP_Error('lb_signin', 'Sign in first.', array('status' => 401));
        }
        if (sml_lb_gate_exempt($gate, $user_id)) {
            return true;
        }
        $need = sml_lb_gate_need($gate);
        $have = sml_lb_balance($user_id);
        if ($have >= $need) {
            return true;
        }
        $all = sml_lb_gates();
        $label = isset($all[$gate]) ? $all[$gate]['label'] : $gate;

        return new WP_Error('lb_gate',
            $label . ' opens at ' . number_format_i18n($need) . ' Loop Bucks. You have '
            . number_format_i18n($have) . ' -- ' . number_format_i18n($need - $have) . ' to go.',
            array(
                'status' => 403,
                'gate'   => $gate,
                'need'   => $need,
                'have'   => $have,
                'short'  => $need - $have,
            ));
    }
}

if (!function_exists('sml_lb_gate_status')) {
    /** Every gate at once, for the client. */
    function sml_lb_gate_status($user_id = 0) {
        $user_id = (int) ($user_id ?: get_current_user_id());
        $balance = $user_id ? sml_lb_balance($user_id) : 0;
        $out = array();
        foreach (sml_lb_gates() as $key => $gate) {
            $open = $user_id ? sml_lb_can($key, $user_id) : false;
            $out[$key] = array(
                'label' => $gate['label'],
                'why'   => $gate['why'],
                'need'  => (int) $gate['need'],
                'have'  => $balance,
                'open'  => $open,
                'short' => $open ? 0 : max(0, (int) $gate['need'] - $balance),
                'exempt' => $user_id ? sml_lb_gate_exempt($key, $user_id) : false,
            );
        }
        return $out;
    }
}

/* ==================================================================
 * Lock screen
 * ================================================================== */

if (!function_exists('sml_lb_lock_html')) {
    function sml_lb_lock_html($gate, $user_id = 0) {
        $user_id = (int) ($user_id ?: get_current_user_id());
        $status = sml_lb_gate_status($user_id);
        $g = isset($status[$gate]) ? $status[$gate] : null;
        if (!$g || $g['open']) {
            return '';
        }
        $progress = function_exists('sml_lb_earn_progress')
            ? sml_lb_earn_progress($user_id) : array('ways' => array());
        $pct = $g['need'] > 0 ? min(100, round(($g['have'] / $g['need']) * 100)) : 100;

        $html = '<div class="lbg-lock"><div class="lbg-head">'
              . '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">'
              . '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/>'
              . '<path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" stroke-linecap="round"/></svg>'
              . '<b>' . esc_html($g['label']) . '</b></div>';
        $html .= '<p class="lbg-why">' . esc_html($g['why']) . '</p>';
        $html .= '<div class="lbg-bar"><i style="width:' . (int) $pct . '%"></i></div>';
        $html .= '<div class="lbg-nums"><span><b>' . number_format_i18n($g['have'])
               . '</b> of ' . number_format_i18n($g['need']) . ' LB</span>'
               . '<span>' . number_format_i18n($g['short']) . ' to go</span></div>';

        if (!empty($progress['ways'])) {
            $html .= '<div class="lbg-ways"><span class="lbg-lbl">Fastest ways to earn</span><ul>';
            foreach (array_slice($progress['ways'], 0, 5) as $way) {
                $html .= '<li><span>' . esc_html($way['label']) . '</span>'
                       . '<b>+' . (int) $way['amount'] . '</b></li>';
            }
            $html .= '</ul></div>';
        }
        return $html . '</div>';
    }
}

if (!function_exists('sml_lb_lock_styles')) {
    function sml_lb_lock_styles() {
        return <<<'SMLLBGCSS'
.lbg-lock{background:#0d1725;border:1px solid #1e2a3a;border-radius:12px;padding:18px 20px;margin:14px 0}
.lbg-head{display:flex;align-items:center;gap:9px;color:#ffb454;margin-bottom:7px}
.lbg-head b{font-size:14.5px;font-weight:800;color:#e6edf5}
.lbg-why{margin:0 0 14px;font-size:13px;color:#8798ac;line-height:1.6}
.lbg-bar{height:7px;border-radius:99px;background:#16202e;overflow:hidden}
.lbg-bar i{display:block;height:100%;background:linear-gradient(90deg,#c9962a,#ffd75e);border-radius:99px}
.lbg-nums{display:flex;justify-content:space-between;margin-top:8px;font-size:12.5px;color:#7b8ca1}
.lbg-nums b{color:#ffb454}
.lbg-ways{margin-top:16px;padding-top:14px;border-top:1px solid #16202e}
.lbg-lbl{font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#7b8ca1}
.lbg-ways ul{list-style:none;margin:9px 0 0;padding:0}
.lbg-ways li{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#c8d5e4}
.lbg-ways li b{color:#4f9d5f;font-weight:800}
SMLLBGCSS;
    }
}

/* ==================================================================
 * REST
 * ================================================================== */

if (!function_exists('sml_lb_gate_routes')) {
    function sml_lb_gate_routes() {
        register_rest_route('sml-lb/v1', '/gates', array(
            'methods'  => 'GET',
            'permission_callback' => '__return_true',
            'callback' => function () {
                $uid = get_current_user_id();
                return array(
                    'balance' => $uid ? sml_lb_balance($uid) : 0,
                    'loggedIn' => (bool) $uid,
                    'gates'   => sml_lb_gate_status($uid),
                    'earn'    => $uid && function_exists('sml_lb_earn_progress')
                                 ? sml_lb_earn_progress($uid) : null,
                );
            },
        ));
    }
}
add_action('rest_api_init', 'sml_lb_gate_routes');
