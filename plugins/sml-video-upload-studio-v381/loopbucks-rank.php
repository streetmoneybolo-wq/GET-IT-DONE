<?php
/**
 * Loop Bucks as a public score: standings, trophies, badges.
 *
 *   1st         gold trophy
 *   2nd         silver trophy
 *   3rd         bronze trophy
 *   4 - 100     rank number + TOP 100
 *   101 - 1000  TOP 1000
 *
 * Ranking cannot be done live. Balances live in usermeta as strings, so
 * ordering them means CAST(meta_value AS SIGNED) across every row -- a full
 * scan that MySQL cannot index. On a page that renders fifty usernames that is
 * fifty full scans. So standings are materialised into their own table on a
 * schedule and read back by primary key, which is a single indexed lookup.
 *
 * The trade is that a rank can be up to a refresh interval stale. For a
 * leaderboard that is the right trade; for the balance itself it would not be,
 * which is why the balance shown is always read live.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_lb_rank_depth')) {
    /** How deep the board goes. Beyond this a user is simply unranked. */
    function sml_lb_rank_depth() {
        return (int) apply_filters('sml_lb_rank_depth', 1000);
    }
}

if (!function_exists('sml_lb_rank_model_version')) {
    /** Forces one rebuild whenever the ranking definition changes. */
    function sml_lb_rank_model_version() {
        return 'lifetime-earned-v1';
    }
}

/* ==================================================================
 * Building the board
 * ================================================================== */

if (!function_exists('sml_lb_rebuild_ranks')) {
    function sml_lb_rebuild_ranks() {
        global $wpdb;
        $ranks = sml_lb_table('ranks');
        $ledger = sml_lb_table('ledger');
        $gifts = function_exists('sml_gifts_table')
            ? sml_gifts_table()
            : $wpdb->prefix . 'sml_gifts';
        $depth = sml_lb_rank_depth();

        // Rank on lifetime earned Loop Bucks, not current wallet balance. Money
        // bought in the store, refunds, adjustments, spending and chargebacks
        // never enter this query. Gift income counts only when it belongs to a
        // settled, two-party gift row; this makes self-gifts and forged ledger
        // reasons ineligible even if another caller bypasses the gift API.
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT l.user_id, SUM(l.delta) AS earned
               FROM $ledger l
              WHERE l.delta > 0
                AND (
                    l.reason IN ('earn', 'bonus', 'referral')
                    OR (
                        l.reason IN ('gift_earned', 'gift_received')
                        AND EXISTS (
                            SELECT 1 FROM $gifts g
                             WHERE g.earn_ref = l.ref
                               AND g.status = 'settled'
                               AND g.sender_id <> g.recipient_id
                        )
                    )
                )
              GROUP BY l.user_id
             HAVING earned > 0
              ORDER BY earned DESC, l.user_id ASC
              LIMIT %d",
            $depth
        ), ARRAY_A);

        $wpdb->query("TRUNCATE TABLE $ranks");
        if (!$rows) {
            update_option('sml_lb_ranks_built', current_time('mysql', true), false);
            update_option('sml_lb_rank_model', sml_lb_rank_model_version(), false);
            return 0;
        }

        $now = current_time('mysql', true);
        $values = array();
        $args = array();
        $pos = 0;
        foreach ($rows as $row) {
            $pos++;
            $values[] = '(%d, %d, %d, %s)';
            array_push($args, (int) $row['user_id'], (int) $row['earned'], $pos, $now);
        }
        // Chunked so a big board does not build one enormous statement.
        foreach (array_chunk($values, 200) as $i => $chunk) {
            $slice = array_slice($args, $i * 200 * 4, count($chunk) * 4);
            $wpdb->query($wpdb->prepare(
                "INSERT INTO $ranks (user_id, balance, rank_pos, computed_at) VALUES "
                . implode(',', $chunk),
                $slice
            ));
        }

        update_option('sml_lb_ranks_built', $now, false);
        update_option('sml_lb_rank_model', sml_lb_rank_model_version(), false);
        return $pos;
    }
}

if (!function_exists('sml_lb_schedule_ranks')) {
    function sml_lb_schedule_ranks() {
        if (!wp_next_scheduled('sml_lb_rank_cron')) {
            wp_schedule_event(time() + 300, 'hourly', 'sml_lb_rank_cron');
        }
    }
}
add_action('init', 'sml_lb_schedule_ranks', 20);
add_action('sml_lb_rank_cron', 'sml_lb_rebuild_ranks');

if (!function_exists('sml_lb_ranks_stale')) {
    /**
     * WP-Cron only fires on traffic, so a quiet site can go a long time
     * without a rebuild. Nudge it when someone actually looks.
     */
    function sml_lb_ranks_stale() {
        if (get_option('sml_lb_rank_model', '') !== sml_lb_rank_model_version()) {
            return true;
        }
        $built = get_option('sml_lb_ranks_built', '');
        if (!$built) {
            return true;
        }
        return (strtotime($built . ' UTC') < (time() - 3600));
    }
}

/* ==================================================================
 * Reading a rank
 * ================================================================== */

if (!function_exists('sml_lb_rank')) {
    /** array(rank, balance, earned) -- rank 0 means outside the board. */
    function sml_lb_rank($user_id) {
        global $wpdb;
        $user_id = (int) $user_id;
        if ($user_id <= 0) {
            return array('rank' => 0, 'balance' => 0);
        }
        if (sml_lb_ranks_stale()) {
            sml_lb_rebuild_ranks();
        }
        $ranks = sml_lb_table('ranks');
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT rank_pos, balance FROM $ranks WHERE user_id = %d", $user_id
        ), ARRAY_A);

        return array(
            // Wallet balance remains live. Earned score and rank are the
            // materialised values used by the public standings.
            'balance' => sml_lb_balance($user_id),
            'earned'  => $row ? (int) $row['balance'] : 0,
            'rank'    => $row ? (int) $row['rank_pos'] : 0,
        );
    }
}

if (!function_exists('sml_lb_leaderboard')) {
    function sml_lb_leaderboard($limit = 100, $offset = 0) {
        global $wpdb;
        if (sml_lb_ranks_stale()) {
            sml_lb_rebuild_ranks();
        }
        $ranks = sml_lb_table('ranks');
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT user_id, balance, rank_pos FROM $ranks
              ORDER BY rank_pos ASC LIMIT %d OFFSET %d",
            (int) $limit, (int) $offset
        ), ARRAY_A);

        $out = array();
        foreach ((array) $rows as $row) {
            $user = get_userdata((int) $row['user_id']);
            if (!$user) {
                continue;
            }
            if ('1' === get_user_meta((int) $row['user_id'], 'sml_hide_leaderboard', true)) {   // /settings/ → Privacy → "Show me on leaderboards" off
                continue;
            }
            $out[] = array(
                'rank'    => (int) $row['rank_pos'],
                'balance' => sml_lb_balance((int) $row['user_id']),
                'earned'  => (int) $row['balance'],
                'id'      => (int) $row['user_id'],
                'name'    => $user->display_name ?: $user->user_login,
                'handle'  => $user->user_nicename,
                'avatar'  => get_avatar_url($row['user_id'], array('size' => 64)),
                'badge'   => sml_lb_badge_data((int) $row['rank_pos']),
            );
        }
        return $out;
    }
}

/* ==================================================================
 * Badges
 * ================================================================== */

if (!function_exists('sml_lb_badge_data')) {
    function sml_lb_badge_data($rank) {
        $rank = (int) $rank;
        if ($rank === 1) {
            return array('kind' => 'trophy', 'metal' => 'gold',   'label' => '1st',
                'title' => 'Rank 1 by Loop Bucks');
        }
        if ($rank === 2) {
            return array('kind' => 'trophy', 'metal' => 'silver', 'label' => '2nd',
                'title' => 'Rank 2 by Loop Bucks');
        }
        if ($rank === 3) {
            return array('kind' => 'trophy', 'metal' => 'bronze', 'label' => '3rd',
                'title' => 'Rank 3 by Loop Bucks');
        }
        if ($rank >= 4 && $rank <= 100) {
            return array('kind' => 'top100', 'metal' => '', 'label' => '#' . $rank,
                'title' => 'Top 100 - rank ' . $rank);
        }
        if ($rank >= 101 && $rank <= sml_lb_rank_depth()) {
            return array('kind' => 'top1000', 'metal' => '', 'label' => 'TOP 1000',
                'title' => 'Top 1000 - rank ' . $rank);
        }
        return array('kind' => '', 'metal' => '', 'label' => '', 'title' => '');
    }
}

if (!function_exists('sml_lb_trophy_svg')) {
    function sml_lb_trophy_svg($metal) {
        $fills = array(
            'gold'   => array('#ffd75e', '#c9962a'),
            'silver' => array('#e3e9f0', '#93a4b8'),
            'bronze' => array('#e0a173', '#96603a'),
        );
        $c = isset($fills[$metal]) ? $fills[$metal] : $fills['bronze'];
        return '<svg class="lb-trophy" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">'
            . '<path d="M7 4h10v5a5 5 0 0 1-10 0V4z" fill="' . $c[0] . '"/>'
            . '<path d="M7 5H4.6a3.4 3.4 0 0 0 3.2 4.4M17 5h2.4a3.4 3.4 0 0 1-3.2 4.4" '
            . 'stroke="' . $c[1] . '" stroke-width="1.5" fill="none" stroke-linecap="round"/>'
            . '<path d="M10 14h4v3h-4z" fill="' . $c[1] . '"/>'
            . '<path d="M8 20h8l-.7-2.2H8.7L8 20z" fill="' . $c[0] . '"/></svg>';
    }
}

if (!function_exists('sml_lb_badge_html')) {
    /**
     * The chip that sits beside a username: balance, then rank marker.
     * Returns '' for users with no Loop Bucks so profiles stay clean.
     */
    function sml_lb_badge_html($user_id, $args = array()) {
        $args = wp_parse_args($args, array(
            'balance' => true,
            'rank'    => true,
            'class'   => '',
        ));
        $data = sml_lb_rank($user_id);
        if ($data['balance'] <= 0 && $data['rank'] <= 0) {
            return '';
        }
        $badge = sml_lb_badge_data($data['rank']);

        $html = '<span class="lb-chip ' . esc_attr($args['class']) . '">';
        if ($args['balance']) {
            $html .= '<span class="lb-amount" title="Loop Bucks">'
                   . '<i class="lb-coin" aria-hidden="true"></i>'
                   . number_format_i18n($data['balance']) . '</span>';
        }
        if ($args['rank'] && $badge['kind']) {
            $html .= '<span class="lb-rank lb-' . esc_attr($badge['kind']) . '"'
                   . ' title="' . esc_attr($badge['title']) . '">';
            if ($badge['kind'] === 'trophy') {
                $html .= sml_lb_trophy_svg($badge['metal']);
                $html .= '<b>' . esc_html($badge['label']) . '</b>';
            } elseif ($badge['kind'] === 'top100') {
                $html .= '<b>' . esc_html($badge['label']) . '</b><em>TOP 100</em>';
            } else {
                $html .= '<em>TOP 1000</em>';
            }
            $html .= '</span>';
        }
        return $html . '</span>';
    }
}

if (!function_exists('sml_lb_badge_styles')) {
    function sml_lb_badge_styles() {
        return <<<'SMLLBCSS'
.lb-chip{display:inline-flex;align-items:center;gap:7px;vertical-align:middle;margin-left:8px;
    font-size:12.5px;font-weight:700;line-height:1}
.lb-amount{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;
    background:#1d1706;border:1px solid #3d3210;color:#ffb454}
.lb-coin{width:11px;height:11px;border-radius:50%;background:linear-gradient(145deg,#ffd75e,#c9962a);
    box-shadow:inset 0 0 0 1.5px rgba(0,0,0,.22);display:inline-block}
.lb-rank{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;
    background:#0d1725;border:1px solid #1e2a3a;color:#c8d5e4}
.lb-rank em{font-style:normal;font-size:10px;letter-spacing:.7px;color:#7b8ca1}
.lb-rank b{font-weight:800}
.lb-rank.lb-trophy{border-color:#3d3210;background:#161206}
.lb-trophy svg,.lb-rank .lb-trophy{display:block}
.lb-rank.lb-top100{border-color:#1e3352;background:#101c2e}
.lb-rank.lb-top100 b{color:#63a4ff}
.lb-rank.lb-top1000 em{color:#8798ac}

.lb-board{width:100%;border-collapse:collapse;font-size:13.5px}
.lb-board th{text-align:left;font-size:11px;letter-spacing:.7px;text-transform:uppercase;
    color:#7b8ca1;padding:0 10px 9px;font-weight:800}
.lb-board td{padding:9px 10px;border-top:1px solid #16202e}
.lb-board .lb-pos{width:52px;color:#7b8ca1;font-weight:800}
.lb-board img{width:28px;height:28px;border-radius:50%;object-fit:cover;vertical-align:middle;
    margin-right:9px;border:1px solid #26364a}
.lb-board .lb-bal{text-align:right;color:#ffb454;font-weight:800;white-space:nowrap}
SMLLBCSS;
    }
}

/* ==================================================================
 * Surfaces
 * ================================================================== */

if (!function_exists('sml_lb_badge_shortcode')) {
    function sml_lb_badge_shortcode($atts) {
        $atts = shortcode_atts(array('user' => 0, 'balance' => 'yes', 'rank' => 'yes'), $atts);
        $user_id = (int) $atts['user'] ?: get_current_user_id();
        if (!$user_id) {
            return '';
        }
        return '<style>' . sml_lb_badge_styles() . '</style>'
             . sml_lb_badge_html($user_id, array(
                 'balance' => $atts['balance'] !== 'no',
                 'rank'    => $atts['rank'] !== 'no',
             ));
    }
}
add_shortcode('loop_bucks_badge', 'sml_lb_badge_shortcode');

if (!function_exists('sml_lb_board_shortcode')) {
    function sml_lb_board_shortcode($atts) {
        $atts = shortcode_atts(array('limit' => 100), $atts);
        $rows = sml_lb_leaderboard((int) $atts['limit']);
        if (!$rows) {
            return '<p>No standings yet.</p>';
        }
        $html = '<style>' . sml_lb_badge_styles() . '</style>';
        $html .= '<table class="lb-board"><thead><tr><th>Rank</th><th>Member</th>'
               . '<th style="text-align:right">Loop Bucks</th></tr></thead><tbody>';
        foreach ($rows as $row) {
            $badge = $row['badge'];
            $marker = $badge['kind'] === 'trophy'
                ? sml_lb_trophy_svg($badge['metal'])
                : '#' . $row['rank'];
            $html .= '<tr><td class="lb-pos">' . $marker . '</td>';
            $html .= '<td><img src="' . esc_url($row['avatar']) . '" alt="">'
                   . esc_html($row['name']) . '</td>';
            $html .= '<td class="lb-bal">' . number_format_i18n($row['balance']) . '</td></tr>';
        }
        return $html . '</tbody></table>';
    }
}
add_shortcode('loop_bucks_leaderboard', 'sml_lb_board_shortcode');

if (!function_exists('sml_lb_append_to_author')) {
    /**
     * Bolt the chip onto display names wherever WordPress renders one.
     * Off by default -- themes use the_author in odd places and a badge in a
     * meta tag helps nobody. Enable with the option or the filter.
     */
    function sml_lb_append_to_author($name) {
        if (is_admin() || is_feed() || !get_option('sml_lb_badge_authors', 0)) {
            return $name;
        }
        global $authordata;
        if (empty($authordata->ID)) {
            return $name;
        }
        return $name . sml_lb_badge_html((int) $authordata->ID);
    }
}
add_filter('the_author', 'sml_lb_append_to_author');

/* ==================================================================
 * REST
 * ================================================================== */

if (!function_exists('sml_lb_routes')) {
    function sml_lb_routes() {
        register_rest_route('sml-lb/v1', '/me', array(
            'methods'  => 'GET',
            'permission_callback' => '__return_true',
            'callback' => function () {
                $uid = get_current_user_id();
                $data = sml_lb_rank($uid);
                return array(
                    'balance' => $data['balance'],
                    'rank'    => $data['rank'],
                    'badge'   => sml_lb_badge_data($data['rank']),
                    'history' => $uid ? sml_lb_history($uid, 15) : array(),
                );
            },
        ));

        register_rest_route('sml-lb/v1', '/leaderboard', array(
            'methods'  => 'GET',
            'permission_callback' => '__return_true',
            'callback' => function (WP_REST_Request $r) {
                $limit = min(200, max(1, (int) $r->get_param('limit') ?: 100));
                return array('board' => sml_lb_leaderboard($limit));
            },
        ));

        // Operations: the global escrow counter and the per-table columns are
        // two records of the same fact, so they can be compared. Drift means a
        // bug; this reports it and, on request, repairs it from the tables,
        // which are the authoritative record of what is actually held.
        register_rest_route('sml-lb/v1', '/reconcile', array(
            'methods'  => array('GET', 'POST'),
            'permission_callback' => function () {
                return current_user_can('manage_options');
            },
            'callback' => function (WP_REST_Request $r) {
                global $wpdb;
                $t = sml_game_table('tables');
                $held = (int) $wpdb->get_var(
                    "SELECT COALESCE(SUM(escrowed), 0) FROM $t
                      WHERE status IN ('waiting','playing')"
                );
                $counter = sml_lb_escrow_total();
                $drift = $counter - $held;

                $fixed = false;
                if ($r->get_method() === 'POST' && $drift !== 0) {
                    update_option('sml_lb_escrow', $held, false);
                    delete_transient('sml_lb_vault');
                    $fixed = true;
                }
                return array(
                    'escrow_counter' => $counter,
                    'tables_hold'    => $held,
                    'drift'          => $drift,
                    'repaired'       => $fixed,
                    'audit'          => sml_lb_audit(),
                );
            },
        ));

        // Destructive. Admin only, and it will not fire without confirm=RESET.
        register_rest_route('sml-lb/v1', '/reset', array(
            'methods'  => array('GET', 'POST'),
            'permission_callback' => function () {
                return current_user_can('manage_options');
            },
            'callback' => function (WP_REST_Request $r) {
                global $wpdb;
                $tag = sanitize_key((string) $r->get_param('tag')) ?: 'launch';
                $live = $r->get_method() === 'POST'
                        && $r->get_param('confirm') === 'RESET';

                // Stakes sitting in escrow belong to players. Give them back
                // before zeroing, or they are lost with no ledger row saying so.
                if ($live) {
                    $t = sml_game_table('tables');
                    $open = $wpdb->get_results(
                        "SELECT * FROM $t WHERE status IN ('waiting','playing')", ARRAY_A);
                    foreach ((array) $open as $row) {
                        sml_game_close_and_refund($row, 'abandoned');
                    }
                }

                $out = sml_lb_reset_all($tag, !$live);
                $out['escrow_cleared'] = $live;
                $out['audit'] = sml_lb_audit();
                if (!$live) {
                    $out['note'] = 'Dry run. POST with confirm=RESET to apply.';
                }
                return $out;
            },
        ));

        // Zero one account rather than the whole site. Same ledger trail, so
        // the same undo path works.
        register_rest_route('sml-lb/v1', '/reset/user', array(
            'methods'  => 'POST',
            'permission_callback' => function () {
                return current_user_can('manage_options');
            },
            'callback' => function (WP_REST_Request $r) {
                $uid = (int) $r->get_param('user_id') ?: get_current_user_id();
                if ($r->get_param('confirm') !== 'RESET') {
                    return new WP_Error('confirm', 'Pass confirm=RESET.', array('status' => 400));
                }
                $tag = sanitize_key((string) $r->get_param('tag')) ?: 'single';
                $bal = sml_lb_balance($uid);
                if ($bal === 0) {
                    return array('user_id' => $uid, 'moved' => 0, 'balance' => 0,
                        'audit' => sml_lb_audit());
                }
                sml_lb_move($uid, -$bal, $bal > 0 ? 'admin_debit' : 'admin_credit',
                    'reset:' . $tag . ':' . $uid, array('reset' => $tag, 'was' => $bal));
                delete_transient('sml_lb_vault');
                sml_lb_rebuild_ranks();
                return array('user_id' => $uid, 'moved' => $bal,
                    'balance' => sml_lb_balance($uid), 'audit' => sml_lb_audit());
            },
        ));

        register_rest_route('sml-lb/v1', '/reset/undo', array(
            'methods'  => 'POST',
            'permission_callback' => function () {
                return current_user_can('manage_options');
            },
            'callback' => function (WP_REST_Request $r) {
                $tag = sanitize_key((string) $r->get_param('tag')) ?: 'launch';
                if ($r->get_param('confirm') !== 'UNDO') {
                    return new WP_Error('confirm', 'Pass confirm=UNDO.', array('status' => 400));
                }
                $out = sml_lb_undo_reset($tag);
                $out['audit'] = sml_lb_audit();
                return $out;
            },
        ));

        register_rest_route('sml-lb/v1', '/vault', array(
            'methods'  => 'GET',
            'permission_callback' => '__return_true',
            'callback' => function () {
                $audit = sml_lb_audit();
                return array(
                    'supply'      => $audit['supply'],
                    'circulating' => $audit['circulating'],
                    'escrow'      => $audit['escrow'],
                    'vault'       => $audit['vault'],
                    'healthy'     => $audit['healthy'],
                );
            },
        ));
    }
}
add_action('rest_api_init', 'sml_lb_routes');
