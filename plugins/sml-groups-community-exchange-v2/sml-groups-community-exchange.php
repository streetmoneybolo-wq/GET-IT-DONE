<?php
/**
 * Plugin Name: StockMarketLoop Groups Community Exchange
 * Description: Isolated, responsive discovery experience for the public Groups directory.
 * Version: 1.0.0
 * Author: StockMarketLoop
 */

if (!defined('ABSPATH')) {
    exit;
}

const SML_GEX_VERSION = '20260724a';

function sml_gex_is_directory() {
    if (is_admin() || wp_doing_ajax()) {
        return false;
    }

    $path = trim((string) wp_parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH), '/');
    return $path === 'groups';
}

function sml_gex_text($value, $fallback = '') {
    $value = trim(wp_strip_all_tags((string) $value));
    return $value !== '' ? $value : $fallback;
}

function sml_gex_creator_payload($owner_id) {
    $owner_id = absint($owner_id);
    if (!$owner_id) {
        return null;
    }

    if (function_exists('sml_groups_user_payload')) {
        return sml_groups_user_payload($owner_id);
    }

    $user = get_userdata($owner_id);
    if (!$user) {
        return null;
    }

    return array(
        'display_name' => $user->display_name ?: $user->user_login,
        'handle' => $user->user_login,
        'avatar_url' => get_avatar_url($owner_id, array('size' => 96)),
        'profile_url' => home_url('/' . rawurlencode($user->user_login) . '/'),
    );
}

function sml_gex_groups() {
    global $wpdb;

    if (!function_exists('sml_groups_tables')) {
        return array();
    }

    $tables = sml_groups_tables();
    $groups_table = $tables['groups'] ?? '';
    $members_table = $tables['members'] ?? '';
    $posts_table = $tables['posts'] ?? '';
    if (!$groups_table || !$members_table || !$posts_table) {
        return array();
    }

    $rows = $wpdb->get_results(
        "SELECT g.*,
            (SELECT COUNT(*) FROM {$members_table} m WHERE m.group_id = g.id) AS member_count,
            (SELECT COUNT(*) FROM {$posts_table} p WHERE p.group_id = g.id AND p.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)) AS post_count
         FROM {$groups_table} g
         WHERE g.type <> 'private'
         ORDER BY g.created_at DESC",
        ARRAY_A
    );

    $viewer_id = get_current_user_id();
    $member_ids = array();
    if ($viewer_id) {
        $member_ids = array_map(
            'absint',
            (array) $wpdb->get_col(
                $wpdb->prepare(
                    "SELECT group_id FROM {$members_table} WHERE user_id = %d",
                    $viewer_id
                )
            )
        );
    }

    $groups = array();
    foreach ((array) $rows as $row) {
        $id = absint($row['id'] ?? 0);
        if (!$id) {
            continue;
        }

        $creator = sml_gex_creator_payload($row['owner_id'] ?? 0);
        $row['id'] = $id;
        $row['name'] = sml_gex_text($row['name'] ?? '', 'Untitled group');
        $row['slug'] = sanitize_title((string) ($row['slug'] ?? ''));
        $row['description'] = sml_gex_text($row['description'] ?? '', 'A StockMarketLoop community for traders and market creators.');
        $row['type'] = sanitize_key((string) ($row['type'] ?? 'creator'));
        $row['access_model'] = sanitize_key((string) ($row['access_model'] ?? 'free')) === 'paid' ? 'paid' : 'free';
        $row['ticker_symbol'] = strtoupper(preg_replace('/[^A-Z0-9.]/', '', (string) ($row['ticker_symbol'] ?? '')));
        $row['sector_name'] = sml_gex_text($row['sector_name'] ?? '');
        $row['icon_url'] = esc_url_raw((string) ($row['icon_url'] ?? ''));
        $row['banner_url'] = esc_url_raw((string) ($row['banner_url'] ?? ''));
        $row['member_count'] = absint($row['member_count'] ?? 0);
        $row['post_count'] = absint($row['post_count'] ?? 0);
        $row['creator'] = $creator;
        $row['is_member'] = in_array($id, $member_ids, true);
        $row['url'] = home_url('/groups/' . rawurlencode($row['slug']) . '/');
        $row['activity_score'] = ($row['post_count'] * 8) + ($row['member_count'] * 3);
        /* lifetime Group Score from sml-group-score (0 when that plugin is off) */
        $gs = function_exists('sml_gs_all_scores') ? (sml_gs_all_scores()[$id] ?? null) : null;
        $row['group_score'] = $gs ? (int) $gs['lifetime'] : 0;
        $row['group_rank'] = $gs ? $gs['rank'] : null;
        $groups[] = $row;
    }

    return $groups;
}

function sml_gex_featured_group($groups) {
    foreach ($groups as $group) {
        if (($group['slug'] ?? '') === 'making-easy-money') {
            return $group;
        }
    }

    if (!$groups) {
        return null;
    }

    $ranked = $groups;
    usort(
        $ranked,
        static function ($a, $b) {
            return ($b['activity_score'] ?? 0) <=> ($a['activity_score'] ?? 0);
        }
    );
    return $ranked[0] ?? null;
}

function sml_gex_ranked_groups($groups) {
    usort(
        $groups,
        static function ($a, $b) {
            $score = ($b['group_score'] ?? 0) <=> ($a['group_score'] ?? 0);
            if ($score !== 0) {
                return $score;
            }
            $activity = ($b['activity_score'] ?? 0) <=> ($a['activity_score'] ?? 0);
            if ($activity !== 0) {
                return $activity;
            }
            return strtotime((string) ($b['created_at'] ?? '')) <=> strtotime((string) ($a['created_at'] ?? ''));
        }
    );
    return $groups;
}

function sml_gex_initials($name) {
    $words = preg_split('/\s+/', trim((string) $name));
    $initials = '';
    foreach ((array) $words as $word) {
        if ($word !== '') {
            $initials .= strtoupper(substr($word, 0, 1));
        }
        if (strlen($initials) >= 2) {
            break;
        }
    }
    return $initials ?: 'SM';
}

function sml_gex_type_label($group) {
    $type = $group['type'] ?? 'creator';
    if ($type === 'ticker') {
        return !empty($group['ticker_symbol']) ? '$' . $group['ticker_symbol'] . ' Ticker room' : 'Ticker room';
    }
    if ($type === 'sector') {
        return !empty($group['sector_name']) ? $group['sector_name'] : 'Sector hub';
    }
    return 'Creator community';
}

function sml_gex_access_label($group) {
    return ($group['access_model'] ?? 'free') === 'paid' ? 'Premium' : 'Free';
}

function sml_gex_render_image($group, $class = '', $loading = 'lazy') {
    $url = esc_url($group['icon_url'] ?? '');
    $name = esc_attr($group['name'] ?? 'Group');
    if ($url) {
        echo '<img class="' . esc_attr($class) . '" src="' . $url . '" alt="' . $name . ' group logo" width="64" height="64" loading="' . esc_attr($loading) . '" decoding="async">';
        return;
    }

    echo '<span class="' . esc_attr($class . ' sml-gex-fallback-logo') . '" aria-hidden="true">' . esc_html(sml_gex_initials($group['name'] ?? 'SM')) . '</span>';
}

function sml_gex_render_directory() {
    if (!sml_gex_is_directory()) {
        return;
    }

    $groups = sml_gex_groups();
    $ranked = sml_gex_ranked_groups($groups);
    $featured = sml_gex_featured_group($groups);
    $trending = array_slice(
        array_values(
            array_filter(
                $ranked,
                static function ($group) use ($featured) {
                    return !$featured || (int) $group['id'] !== (int) $featured['id'];
                }
            )
        ),
        0,
        4
    );
    if (count($trending) < 4) {
        $trending = array_slice($ranked, 0, 4);
    }

    $is_logged_in = is_user_logged_in();
    $current_user = wp_get_current_user();
    $rest_nonce = wp_create_nonce('wp_rest');
    $login_url = wp_login_url(home_url('/groups/'));
    $profile_handle = $is_logged_in ? (string) get_user_meta($current_user->ID, 'sml_public_handle', true) : '';
    $profile_url = $profile_handle ? home_url('/' . rawurlencode($profile_handle) . '/') : home_url('/my-profile/');
    $create_url = $is_logged_in ? '#create-group' : $login_url;
    $directory_url = home_url('/groups/');
    $share_image = add_query_arg('v', SML_GEX_VERSION, home_url('/wp-content/uploads/2026/07/stockmarketloop-groups-card.jpg'));
    $description = 'Join trusted traders, creator communities and focused rooms built around how you invest.';

    status_header(200);
    nocache_headers();
    send_nosniff_header();
    header('Content-Type: text/html; charset=' . get_option('blog_charset'));
    ?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo('charset'); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>StockMarketLoop Groups | Find Your Market Circle</title>
    <meta name="description" content="<?php echo esc_attr($description); ?>">
    <link rel="canonical" href="<?php echo esc_url($directory_url); ?>">
    <meta name="theme-color" content="#06110d">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="StockMarketLoop">
    <meta property="og:title" content="StockMarketLoop Groups | Find Your Market Circle">
    <meta property="og:description" content="<?php echo esc_attr($description); ?>">
    <meta property="og:url" content="<?php echo esc_url($directory_url); ?>">
    <meta property="og:image" content="<?php echo esc_url($share_image); ?>">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="StockMarketLoop Groups | Find Your Market Circle">
    <meta name="twitter:description" content="<?php echo esc_attr($description); ?>">
    <meta name="twitter:image" content="<?php echo esc_url($share_image); ?>">
    <style id="sml-gex-styles">
        :root {
            color-scheme: dark;
            --gex-bg: #050b08;
            --gex-surface: #09150f;
            --gex-surface-2: #0d1d15;
            --gex-line: #1c3b2d;
            --gex-line-soft: rgba(97, 173, 137, .18);
            --gex-text: #f4fbf7;
            --gex-muted: #9bb3a7;
            --gex-accent: #39e6a2;
            --gex-accent-2: #53c7ef;
            --gex-gold: #e5c260;
            --gex-danger: #ff6677;
            --gex-sidebar: 244px;
        }
        * { box-sizing: border-box; }
        html { background: var(--gex-bg); scroll-behavior: smooth; }
        body {
            margin: 0;
            min-width: 320px;
            background:
                radial-gradient(circle at 68% -15%, rgba(38, 139, 98, .16), transparent 38%),
                linear-gradient(145deg, #050b08 0%, #07130e 55%, #06100c 100%);
            color: var(--gex-text);
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 15px;
            line-height: 1.5;
            letter-spacing: 0;
        }
        button, input, select, textarea { font: inherit; letter-spacing: 0; }
        button, a { -webkit-tap-highlight-color: transparent; }
        a { color: inherit; }
        [hidden] { display: none !important; }
        .sml-gex-skip {
            position: fixed;
            top: 8px;
            left: 8px;
            z-index: 1000;
            transform: translateY(-150%);
            background: var(--gex-accent);
            color: #021009;
            padding: 10px 14px;
            border-radius: 6px;
            font-weight: 800;
        }
        .sml-gex-skip:focus { transform: translateY(0); }
        .sml-gex-app {
            min-height: 100vh;
            display: grid;
            grid-template-columns: var(--gex-sidebar) minmax(0, 1fr);
        }
        .sml-gex-sidebar {
            position: sticky;
            top: 0;
            height: 100vh;
            overflow-y: auto;
            padding: 24px 18px;
            border-right: 1px solid var(--gex-line-soft);
            background: rgba(4, 16, 11, .94);
            backdrop-filter: blur(16px);
        }
        .sml-gex-brand {
            display: flex;
            align-items: center;
            gap: 10px;
            margin: 0 8px 28px;
            color: #fff;
            text-decoration: none;
            font-size: 16px;
            font-weight: 800;
        }
        .sml-gex-brand-mark,
        .sml-gex-nav-icon {
            display: inline-grid;
            place-items: center;
            flex: 0 0 auto;
        }
        .sml-gex-brand-mark {
            width: 34px;
            height: 34px;
            border-radius: 8px;
            background: var(--gex-accent);
            color: #052116;
            box-shadow: 0 0 24px rgba(57, 230, 162, .16);
            font-size: 12px;
        }
        .sml-gex-sidebar-label {
            margin: 22px 10px 8px;
            color: #799486;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
        }
        .sml-gex-nav { display: grid; gap: 4px; }
        .sml-gex-nav button,
        .sml-gex-nav a {
            width: 100%;
            min-height: 44px;
            display: flex;
            align-items: center;
            gap: 10px;
            border: 1px solid transparent;
            border-radius: 7px;
            background: transparent;
            color: #afc2b8;
            padding: 9px 10px;
            text-align: left;
            text-decoration: none;
            font-weight: 700;
            cursor: pointer;
            transition: background-color .18s ease, border-color .18s ease, color .18s ease, transform .18s ease;
        }
        .sml-gex-nav button:hover,
        .sml-gex-nav button[aria-pressed="true"],
        .sml-gex-nav a:hover {
            border-color: rgba(57, 230, 162, .2);
            background: rgba(57, 230, 162, .09);
            color: #eafff5;
            transform: translateX(2px);
        }
        .sml-gex-nav-icon {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            background: rgba(255, 255, 255, .035);
            color: var(--gex-accent);
            font-size: 11px;
            font-weight: 900;
        }
        .sml-gex-create {
            width: 100%;
            min-height: 46px;
            margin-top: 24px;
            border: 0;
            border-radius: 7px;
            background: var(--gex-accent);
            color: #03140d;
            font-weight: 900;
            cursor: pointer;
            box-shadow: 0 10px 28px rgba(57, 230, 162, .14);
            transition: transform .18s ease, box-shadow .18s ease, background-color .18s ease;
        }
        .sml-gex-create:hover { transform: translateY(-2px); box-shadow: 0 14px 34px rgba(57, 230, 162, .23); }
        .sml-gex-account {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 18px;
            padding: 15px 8px 0;
            border-top: 1px solid var(--gex-line-soft);
            text-decoration: none;
        }
        .sml-gex-account img,
        .sml-gex-account-avatar {
            width: 34px;
            height: 34px;
            border-radius: 999px;
            object-fit: cover;
            background: #143326;
        }
        .sml-gex-account strong,
        .sml-gex-account span { display: block; }
        .sml-gex-account strong { font-size: 12px; color: #fff; }
        .sml-gex-account span { font-size: 11px; color: var(--gex-muted); }
        .sml-gex-main {
            min-width: 0;
            padding: 24px clamp(18px, 3vw, 42px) 64px;
        }
        .sml-gex-topbar {
            display: grid;
            grid-template-columns: minmax(260px, 650px) auto;
            justify-content: space-between;
            gap: 14px;
            align-items: center;
            max-width: 1240px;
            margin: 0 auto 22px;
        }
        .sml-gex-search {
            position: relative;
            display: flex;
            align-items: center;
        }
        .sml-gex-search span {
            position: absolute;
            left: 14px;
            color: var(--gex-muted);
            font-weight: 900;
            pointer-events: none;
        }
        .sml-gex-search input {
            width: 100%;
            min-height: 46px;
            border: 1px solid var(--gex-line-soft);
            border-radius: 8px;
            background: rgba(8, 21, 15, .86);
            color: #fff;
            padding: 10px 46px 10px 40px;
            outline: none;
        }
        .sml-gex-search input:focus { border-color: var(--gex-accent); box-shadow: 0 0 0 3px rgba(57, 230, 162, .11); }
        .sml-gex-search kbd {
            position: absolute;
            right: 10px;
            border: 1px solid var(--gex-line);
            border-radius: 5px;
            color: #799486;
            background: #09140f;
            padding: 3px 6px;
            font-size: 10px;
        }
        .sml-gex-top-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .sml-gex-utility {
            min-height: 40px;
            border: 1px solid var(--gex-line-soft);
            border-radius: 7px;
            background: rgba(8, 21, 15, .86);
            color: #c7d8cf;
            padding: 8px 13px;
            font-size: 12px;
            font-weight: 800;
            cursor: pointer;
        }
        .sml-gex-utility:hover,
        .sml-gex-utility[aria-pressed="true"] { color: #fff; border-color: var(--gex-accent); }
        .sml-gex-content { max-width: 1240px; margin: 0 auto; }
        .sml-gex-hero {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 22px;
            align-items: end;
            margin: 8px 0 24px;
        }
        .sml-gex-hero h1 {
            margin: 0;
            color: #fff;
            font-family: Georgia, "Times New Roman", serif;
            font-size: clamp(38px, 5vw, 62px);
            font-weight: 600;
            line-height: 1.02;
            letter-spacing: 0;
        }
        .sml-gex-hero p {
            max-width: 650px;
            margin: 10px 0 0;
            color: #a9bdb2;
            font-size: 15px;
        }
        .sml-gex-filters {
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 8px;
            max-width: 360px;
        }
        .sml-gex-chip {
            min-height: 38px;
            border: 1px solid var(--gex-line-soft);
            border-radius: 999px;
            background: rgba(8, 21, 15, .65);
            color: #a9bdb2;
            padding: 8px 14px;
            font-size: 12px;
            font-weight: 800;
            cursor: pointer;
            transition: color .18s ease, border-color .18s ease, background-color .18s ease, transform .18s ease;
        }
        .sml-gex-chip:hover { transform: translateY(-1px); color: #fff; }
        .sml-gex-chip[aria-pressed="true"] {
            border-color: var(--gex-accent);
            background: var(--gex-accent);
            color: #03140d;
        }
        .sml-gex-feature-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 316px;
            gap: 18px;
            align-items: stretch;
        }
        .sml-gex-featured,
        .sml-gex-trending {
            border: 1px solid var(--gex-line-soft);
            border-radius: 8px;
            background: rgba(8, 24, 17, .86);
            overflow: hidden;
        }
        .sml-gex-featured {
            position: relative;
            min-height: 348px;
            padding: clamp(24px, 3.5vw, 42px);
            display: grid;
            align-content: center;
            isolation: isolate;
        }
        .sml-gex-featured::before {
            content: "$";
            position: absolute;
            right: 42px;
            bottom: -110px;
            z-index: -1;
            color: rgba(57, 230, 162, .055);
            font-family: Georgia, serif;
            font-size: 330px;
            line-height: 1;
        }
        .sml-gex-featured::after {
            content: "";
            position: absolute;
            inset: 0;
            z-index: -2;
            background:
                linear-gradient(90deg, rgba(7, 34, 22, .97) 0%, rgba(8, 31, 22, .87) 58%, rgba(8, 25, 18, .7) 100%),
                var(--gex-feature-bg, none);
            background-position: center;
            background-size: cover;
        }
        .sml-gex-eyebrow {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #9af3ca;
            font-size: 11px;
            font-weight: 900;
            text-transform: uppercase;
        }
        .sml-gex-eyebrow::before {
            content: "";
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: var(--gex-accent);
            box-shadow: 0 0 14px rgba(57, 230, 162, .55);
        }
        .sml-gex-featured h2 {
            max-width: 680px;
            margin: 32px 0 10px;
            color: #fff;
            font-family: Georgia, "Times New Roman", serif;
            font-size: clamp(32px, 4vw, 48px);
            font-weight: 500;
            line-height: 1.08;
            letter-spacing: 0;
        }
        .sml-gex-featured > p {
            max-width: 720px;
            margin: 0;
            color: #b7c9c0;
            font-size: 14px;
        }
        .sml-gex-feature-meta {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px 16px;
            margin-top: 20px;
            color: #82998d;
            font-size: 12px;
        }
        .sml-gex-feature-meta a { color: #d9ebe2; text-decoration: none; font-weight: 800; }
        .sml-gex-feature-actions {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 30px;
        }
        .sml-gex-primary {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 46px;
            border: 0;
            border-radius: 7px;
            background: var(--gex-accent);
            color: #04150e;
            padding: 10px 18px;
            text-decoration: none;
            font-weight: 900;
            box-shadow: 0 12px 28px rgba(57, 230, 162, .14);
            transition: transform .18s ease, box-shadow .18s ease;
        }
        .sml-gex-primary:hover { transform: translateY(-2px); box-shadow: 0 16px 34px rgba(57, 230, 162, .22); }
        .sml-gex-tag {
            display: inline-flex;
            align-items: center;
            min-height: 28px;
            border: 1px solid rgba(57, 230, 162, .15);
            border-radius: 999px;
            background: rgba(57, 230, 162, .09);
            color: #8cf1c4;
            padding: 5px 10px;
            font-size: 10px;
            font-weight: 900;
            text-transform: uppercase;
        }
        .sml-gex-trending { padding: 20px; }
        .sml-gex-section-head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 12px;
        }
        .sml-gex-section-head h2 {
            margin: 0;
            color: #fff;
            font-family: Georgia, "Times New Roman", serif;
            font-size: 27px;
            font-weight: 500;
            letter-spacing: 0;
        }
        .sml-gex-section-head button {
            border: 0;
            background: transparent;
            color: #9de9c6;
            padding: 0;
            font-size: 11px;
            font-weight: 800;
            cursor: pointer;
        }
        .sml-gex-ranking { margin-top: 8px; }
        .sml-gex-rank {
            display: grid;
            grid-template-columns: 26px 40px minmax(0, 1fr) auto;
            gap: 9px;
            align-items: center;
            min-height: 68px;
            border-top: 1px solid var(--gex-line-soft);
            color: #fff;
            text-decoration: none;
        }
        .sml-gex-rank-number { color: #637a6e; font-size: 12px; }
        .sml-gex-rank-logo,
        .sml-gex-tile-logo {
            display: inline-grid;
            place-items: center;
            object-fit: cover;
            background: #103123;
            color: #87ebbe;
            font-weight: 900;
        }
        .sml-gex-rank-logo { width: 40px; height: 40px; border-radius: 8px; font-size: 12px; }
        .sml-gex-rank strong,
        .sml-gex-rank small { display: block; min-width: 0; }
        .sml-gex-rank strong { overflow: hidden; color: #fff; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
        .sml-gex-rank small { color: #7f968a; font-size: 10px; }
        .sml-gex-rank-metric { color: var(--gex-accent); font-size: 10px; font-weight: 900; white-space: nowrap; }
        .sml-gex-discover { margin-top: 30px; }
        .sml-gex-discover .sml-gex-section-head { margin-bottom: 14px; }
        .sml-gex-result-count { color: #93d9b9; font-size: 11px; font-weight: 800; }
        .sml-gex-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
        }
        .sml-gex-tile {
            position: relative;
            min-width: 0;
            min-height: 220px;
            border: 1px solid var(--gex-line-soft);
            border-radius: 8px;
            background: rgba(8, 22, 16, .84);
            padding: 16px;
            color: inherit;
            overflow: hidden;
            transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease, background-color .2s ease;
        }
        .sml-gex-tile-link {
            min-height: 188px;
            display: grid;
            grid-template-rows: auto 1fr auto;
            color: inherit;
            text-decoration: none;
        }
        .sml-gex-tile:hover {
            transform: translateY(-3px);
            border-color: rgba(57, 230, 162, .42);
            background: rgba(11, 29, 21, .96);
            box-shadow: 0 16px 34px rgba(0, 0, 0, .25), 0 0 22px rgba(57, 230, 162, .07);
        }
        .sml-gex-tile-top {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
        }
        .sml-gex-tile-logo { width: 48px; height: 48px; border-radius: 10px; font-size: 13px; }
        .sml-gex-tile-tag {
            border: 1px solid rgba(229, 194, 96, .18);
            border-radius: 999px;
            background: rgba(229, 194, 96, .07);
            color: #e5cf8c;
            padding: 4px 8px;
            font-size: 9px;
            font-weight: 900;
            text-transform: uppercase;
        }
        .sml-gex-tile-body { align-self: center; min-width: 0; margin: 18px 0 12px; }
        .sml-gex-tile h3 {
            margin: 0 0 6px;
            color: #fff;
            font-size: 17px;
            line-height: 1.2;
        }
        .sml-gex-tile p {
            display: -webkit-box;
            margin: 0;
            overflow: hidden;
            color: #91a79c;
            font-size: 12px;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 3;
        }
        .sml-gex-tile-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            color: #799085;
            font-size: 10px;
        }
        .sml-gex-tile-meta b { color: var(--gex-accent); font-weight: 900; }
        .sml-gex-tile-score { color: #38f58a; font-weight: 900; letter-spacing: .02em; white-space: nowrap; }
        .sml-gex-score-link { color: #38f58a; text-decoration: none; font-weight: 700; }
        .sml-gex-score-link b { font-weight: 900; }
        .sml-gex-score-link:hover, .sml-gex-view-ranking:hover { text-decoration: underline; }
        .sml-gex-view-ranking { color: var(--gex-accent); font-size: 12px; font-weight: 800; text-decoration: none; white-space: nowrap; }
        .sml-gex-save {
            position: absolute;
            top: 14px;
            right: 14px;
            width: 30px;
            height: 30px;
            display: none;
            place-items: center;
            border: 1px solid var(--gex-line);
            border-radius: 6px;
            background: #09150f;
            color: #9bb3a7;
            cursor: pointer;
        }
        .sml-gex-tile:hover .sml-gex-save,
        .sml-gex-save:focus,
        .sml-gex-save[aria-pressed="true"] { display: grid; }
        .sml-gex-save[aria-pressed="true"] { color: var(--gex-gold); border-color: var(--gex-gold); }
        .sml-gex-empty {
            grid-column: 1 / -1;
            min-height: 150px;
            display: grid;
            place-items: center;
            border: 1px dashed var(--gex-line);
            border-radius: 8px;
            color: var(--gex-muted);
            text-align: center;
            padding: 28px;
        }
        .sml-gex-mobile-nav { display: none; }
        .sml-gex-dialog {
            width: min(660px, calc(100vw - 28px));
            max-height: calc(100vh - 32px);
            border: 1px solid #2b5641;
            border-radius: 8px;
            background: #07130e;
            color: #fff;
            padding: 0;
            overflow: auto;
            box-shadow: 0 30px 90px rgba(0, 0, 0, .65);
        }
        .sml-gex-dialog::backdrop { background: rgba(0, 5, 3, .82); backdrop-filter: blur(5px); }
        .sml-gex-dialog-head {
            position: sticky;
            top: 0;
            z-index: 2;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            border-bottom: 1px solid var(--gex-line-soft);
            background: #07130e;
            padding: 18px 20px;
        }
        .sml-gex-dialog-head h2 { margin: 0; font-family: Georgia, serif; font-size: 25px; font-weight: 500; }
        .sml-gex-dialog-close {
            width: 36px;
            height: 36px;
            border: 1px solid var(--gex-line);
            border-radius: 6px;
            background: #0a1a12;
            color: #fff;
            cursor: pointer;
        }
        .sml-gex-form { display: grid; gap: 14px; padding: 20px; }
        .sml-gex-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .sml-gex-field { display: grid; gap: 6px; }
        .sml-gex-field label { color: #dff3e8; font-size: 12px; font-weight: 800; }
        .sml-gex-field input,
        .sml-gex-field select,
        .sml-gex-field textarea {
            width: 100%;
            min-height: 44px;
            border: 1px solid var(--gex-line);
            border-radius: 6px;
            background: #040c08;
            color: #fff;
            padding: 10px 11px;
            outline: none;
        }
        .sml-gex-field textarea { min-height: 104px; resize: vertical; }
        .sml-gex-field input:focus,
        .sml-gex-field select:focus,
        .sml-gex-field textarea:focus { border-color: var(--gex-accent); box-shadow: 0 0 0 3px rgba(57, 230, 162, .09); }
        .sml-gex-form-status { min-height: 20px; color: #a8c1b4; font-size: 12px; }
        .sml-gex-form-status[data-error="true"] { color: #ff9aa6; }
        .sml-gex-footer {
            max-width: 1240px;
            margin: 44px auto 0;
            padding-top: 18px;
            border-top: 1px solid var(--gex-line-soft);
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            color: #70877b;
            font-size: 11px;
        }
        .sml-gex-footer nav { display: flex; flex-wrap: wrap; gap: 14px; }
        .sml-gex-footer a { color: #9bb3a7; text-decoration: none; }
        :focus-visible { outline: 2px solid var(--gex-accent); outline-offset: 3px; }
        @media (max-width: 1080px) {
            :root { --gex-sidebar: 210px; }
            .sml-gex-feature-row { grid-template-columns: minmax(0, 1fr) 280px; }
            .sml-gex-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 820px) {
            .sml-gex-app { display: block; padding-bottom: 68px; }
            .sml-gex-sidebar { display: none; }
            .sml-gex-main { padding: 16px 16px 52px; }
            .sml-gex-topbar { grid-template-columns: 1fr; margin-bottom: 18px; }
            .sml-gex-top-actions { justify-content: flex-start; }
            .sml-gex-hero { grid-template-columns: 1fr; align-items: start; }
            .sml-gex-filters { justify-content: flex-start; max-width: none; }
            .sml-gex-feature-row { grid-template-columns: 1fr; }
            .sml-gex-trending { order: 2; }
            .sml-gex-ranking { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
            .sml-gex-mobile-nav {
                position: fixed;
                right: 0;
                bottom: 0;
                left: 0;
                z-index: 50;
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                border-top: 1px solid var(--gex-line);
                background: rgba(4, 15, 10, .96);
                backdrop-filter: blur(16px);
                padding-bottom: env(safe-area-inset-bottom);
            }
            .sml-gex-mobile-nav button,
            .sml-gex-mobile-nav a {
                min-height: 58px;
                display: grid;
                place-items: center;
                border: 0;
                background: transparent;
                color: #a9bdb2;
                text-decoration: none;
                font-size: 11px;
                font-weight: 800;
            }
            .sml-gex-mobile-nav button[aria-pressed="true"] { color: var(--gex-accent); }
        }
        @media (max-width: 560px) {
            .sml-gex-main { padding-right: 12px; padding-left: 12px; }
            .sml-gex-top-actions { display: grid; grid-template-columns: 1fr 1fr; }
            .sml-gex-hero h1 { font-size: 40px; }
            .sml-gex-chip { min-height: 36px; padding: 7px 12px; }
            .sml-gex-featured { min-height: 330px; padding: 24px 20px; }
            .sml-gex-featured h2 { margin-top: 24px; font-size: 34px; }
            .sml-gex-ranking { grid-template-columns: 1fr; }
            .sml-gex-grid { grid-template-columns: 1fr; }
            .sml-gex-tile { min-height: 198px; }
            .sml-gex-form-grid { grid-template-columns: 1fr; }
        }
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
        }
        /* Keep this standalone app aligned with the homepage chrome. */
        .sml-gex-app { display:block; padding-top:104px; }
        .sml-gex-sidebar { display:none; }
        .sml-acct { display:none !important; }
        .sml-gex-main { padding:24px clamp(18px, 3vw, 42px) 64px; }
        .sml-sitewide-home-header{position:fixed;top:0;left:0;right:0;z-index:100;color:#e6edf5;font-family:Inter,system-ui,sans-serif}.sml-shh-head{background:linear-gradient(180deg,rgba(20,30,44,.97),rgba(9,15,24,.96));border-bottom:1px solid rgba(0,0,0,.7)}.sml-shh-row{max-width:1360px;margin:0 auto;display:flex;align-items:center;gap:16px;padding:0 24px;height:60px}.sml-shh-logo{display:flex;align-items:center;flex:none}.sml-shh-logo img{height:46px;width:auto}.sml-shh-search{flex:1;max-width:620px;display:flex;gap:8px;padding:8px 16px;background:#080e17;border:1px solid #000;border-radius:999px}.sml-shh-search input{flex:1;min-width:0;background:transparent;border:0;outline:0;color:#e6edf5}.sml-shh-nav{display:flex;gap:18px}.sml-shh-nav a{color:#93a4b8;text-decoration:none}.sml-shh-kick{padding:9px 20px;border:0;border-radius:999px;font-weight:800;color:#04140b;background:#43ed9c;text-decoration:none;font-size:13px}.sml-shh-account{display:flex;align-items:center;gap:8px;color:#e6edf5;text-decoration:none;font-size:12px;font-weight:700}.sml-shh-account img{width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid #43ed9c}.sml-shh-tape{background:#060a11;overflow:hidden}.sml-shh-tape-inner{display:flex;gap:28px;padding:7px 24px;white-space:nowrap;font:600 11px/1.2 monospace;color:#93a4b8}.sml-shh-tape b{color:#00a9e8}@media(max-width:767px){.sml-gex-app{padding-top:104px}.sml-shh-row{padding:0 10px;gap:8px}.sml-shh-logo img{height:30px}.sml-shh-nav{display:none}.sml-shh-account span{display:none}.sml-shh-search{padding:8px 11px}.sml-shh-kick{padding:10px 11px;font-size:10px}}
    </style>
</head>
<body>
<?php $sml_gex_header_avatar = $is_logged_in ? (string) get_user_meta( $current_user->ID, 'sml_avatar_url', true ) : ''; ?>
<header class="sml-sitewide-home-header" aria-label="StockMarketLoop navigation"><div class="sml-shh-head"><div class="sml-shh-row"><a class="sml-shh-logo" href="<?php echo esc_url(home_url('/')); ?>" aria-label="StockMarketLoop"><img src="https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@main/img/loop-logo.png" alt="StockMarketLoop"></a><form class="sml-shh-search" action="<?php echo esc_url(home_url('/stock-chart/')); ?>" method="get"><span aria-hidden="true">⌕</span><input name="symbol" aria-label="Search a ticker" placeholder="Search a ticker, e.g. NVDA"><button type="submit" hidden>Search</button></form><nav class="sml-shh-nav" aria-label="Primary"><a href="<?php echo esc_url(home_url('/q/')); ?>">Q&amp;A</a><a href="<?php echo esc_url(home_url('/market-monitor/')); ?>">Monitor</a></nav><a class="sml-shh-kick" href="<?php echo esc_url(home_url('/loop-kick/')); ?>">LOOP-KICK</a><a class="sml-shh-account" href="<?php echo esc_url($is_logged_in ? $profile_url : $login_url); ?>"><?php if ($is_logged_in) : ?><img src="<?php echo esc_url($sml_gex_header_avatar ?: get_avatar_url($current_user->ID, array('size' => 72))); ?>" alt=""><?php endif; ?><span><?php echo esc_html($is_logged_in ? $current_user->display_name : 'Sign in'); ?></span></a></div></div><div class="sml-shh-tape"><div class="sml-shh-tape-inner"><span><b>$SPY</b> Market data loading</span><span><b>$QQQ</b> Market data loading</span><span><b>$NVDA</b> Market data loading</span></div></div></header>
<a class="sml-gex-skip" href="#sml-gex-content">Skip to groups</a>
<div class="sml-gex-app">
    <aside class="sml-gex-sidebar" aria-label="Groups navigation">
        <a class="sml-gex-brand" href="<?php echo esc_url(home_url('/')); ?>">
            <span class="sml-gex-brand-mark" aria-hidden="true">SM</span>
            <span>StockMarketLoop</span>
        </a>

        <p class="sml-gex-sidebar-label">Groups</p>
        <nav class="sml-gex-nav" aria-label="Group views">
            <button type="button" data-gex-filter="all" aria-pressed="true"><span class="sml-gex-nav-icon" aria-hidden="true">D</span>Discover</button>
            <button type="button" data-gex-filter="mine" aria-pressed="false"><span class="sml-gex-nav-icon" aria-hidden="true">Y</span>Your groups</button>
            <button type="button" data-gex-filter="trending" aria-pressed="false"><span class="sml-gex-nav-icon" aria-hidden="true">T</span>Trending</button>
            <button type="button" data-gex-filter="new" aria-pressed="false"><span class="sml-gex-nav-icon" aria-hidden="true">N</span>New &amp; noteworthy</button>
        </nav>

        <?php /* "Browse by" category nav removed (owner call 2026-09-10) */ ?>

        <button class="sml-gex-create" type="button" data-gex-create>+ Create a group</button>

        <a class="sml-gex-account" href="<?php echo esc_url($is_logged_in ? $profile_url : $login_url); ?>">
            <?php if ($is_logged_in) : ?>
                <img src="<?php echo esc_url(get_avatar_url($current_user->ID, array('size' => 68))); ?>" alt="" width="34" height="34">
            <?php else : ?>
                <span class="sml-gex-account-avatar" aria-hidden="true"></span>
            <?php endif; ?>
            <span>
                <strong><?php echo esc_html($is_logged_in ? $current_user->display_name : 'Your account'); ?></strong>
                <span><?php echo esc_html($is_logged_in ? 'Manage memberships' : 'Sign in to join groups'); ?></span>
            </span>
        </a>
    </aside>

    <main class="sml-gex-main" id="sml-gex-content">
        <header class="sml-gex-topbar">
            <label class="sml-gex-search">
                <span aria-hidden="true">Q</span>
                <input type="search" data-gex-search placeholder="Search groups, creators, tickers or sectors..." autocomplete="off" aria-label="Search groups">
                <kbd aria-hidden="true">Ctrl K</kbd>
            </label>
            <div class="sml-gex-top-actions">
                <button class="sml-gex-utility" type="button" data-gex-filter-button aria-pressed="false">Filters <span data-gex-filter-count>0</span></button>
                <button class="sml-gex-utility" type="button" data-gex-filter="saved" aria-pressed="false">Saved</button>
            </div>
        </header>

        <div class="sml-gex-content">
            <section class="sml-gex-hero" aria-labelledby="sml-gex-title">
                <div>
                    <h1 id="sml-gex-title">Find your market circle.</h1>
                    <p><?php echo esc_html($description); ?></p>
                </div>
                <div class="sml-gex-filters" aria-label="Group filters">
                    <button class="sml-gex-chip" type="button" data-gex-filter="all" aria-pressed="true">For you</button>
                    <button class="sml-gex-chip" type="button" data-gex-filter="free" aria-pressed="false">Free</button>
                    <button class="sml-gex-chip" type="button" data-gex-filter="paid" aria-pressed="false">Premium</button>
                    <button class="sml-gex-chip" type="button" data-gex-filter="options" aria-pressed="false">Options</button>
                    <button class="sml-gex-chip" type="button" data-gex-filter="ticker" aria-pressed="false">Tickers</button>
                </div>
            </section>

            <section class="sml-gex-feature-row" aria-label="Featured and trending groups">
                <?php if ($featured) : ?>
                    <?php
                    $featured_creator = $featured['creator'] ?? null;
                    $featured_background = esc_url($featured['banner_url'] ?? '');
                    ?>
                    <article class="sml-gex-featured" style="--gex-feature-bg:url('<?php echo $featured_background; ?>')">
                        <span class="sml-gex-eyebrow">Featured community</span>
                        <h2><?php echo esc_html($featured['name']); ?></h2>
                        <p><?php echo esc_html($featured['description']); ?></p>
                        <div class="sml-gex-feature-meta">
                            <?php if ($featured_creator) : ?>
                                <span>Created by <a href="<?php echo esc_url($featured_creator['profile_url'] ?? '#'); ?>">@<?php echo esc_html(ltrim((string) ($featured_creator['handle'] ?? 'creator'), '@')); ?></a></span>
                            <?php endif; ?>
                            <span><?php echo esc_html(number_format_i18n($featured['member_count'])); ?> members</span>
                            <span><?php echo esc_html(number_format_i18n($featured['post_count'])); ?> hot posts</span>
                            <?php if (function_exists('sml_gs_all_scores')) : ?><a class="sml-gex-score-link" href="<?php echo esc_url(home_url('/groups/leaderboard/#group-' . (int) $featured['id'])); ?>">Group Score <b><?php echo esc_html(number_format_i18n($featured['group_score'])); ?></b><?php echo $featured['group_rank'] ? ' &middot; #' . (int) $featured['group_rank'] : ''; ?></a><?php endif; ?>
                        </div>
                        <div class="sml-gex-feature-actions">
                            <a class="sml-gex-primary" href="<?php echo esc_url($featured['url']); ?>">View group</a>
                            <span class="sml-gex-tag"><?php echo esc_html(sml_gex_access_label($featured)); ?></span>
                        </div>
                    </article>
                <?php else : ?>
                    <article class="sml-gex-featured">
                        <span class="sml-gex-eyebrow">Featured community</span>
                        <h2>Start the first market circle</h2>
                        <p>Create a focused home for your trading community, market ideas, alerts, and education.</p>
                        <div class="sml-gex-feature-actions">
                            <button class="sml-gex-primary" type="button" data-gex-create>Create a group</button>
                        </div>
                    </article>
                <?php endif; ?>

                <aside class="sml-gex-trending" aria-labelledby="sml-gex-trending-title">
                    <div class="sml-gex-section-head">
                        <h2 id="sml-gex-trending-title">Top groups</h2>
                        <a class="sml-gex-view-ranking" href="<?php echo esc_url(home_url('/groups/leaderboard/')); ?>">Leaderboard &rarr;</a>
                    </div>
                    <div class="sml-gex-ranking">
                        <?php foreach ($trending as $index => $group) : ?>
                            <a class="sml-gex-rank" href="<?php echo esc_url($group['url']); ?>">
                                <span class="sml-gex-rank-number"><?php echo esc_html(str_pad((string) ($index + 1), 2, '0', STR_PAD_LEFT)); ?></span>
                                <?php sml_gex_render_image($group, 'sml-gex-rank-logo'); ?>
                                <span>
                                    <strong><?php echo esc_html($group['name']); ?></strong>
                                    <small><?php echo esc_html(sml_gex_access_label($group) . ' - ' . sml_gex_type_label($group)); ?></small>
                                </span>
                                <span class="sml-gex-rank-metric" title="Group Score"><?php echo esc_html(number_format_i18n($group['group_score']) . ' pts'); ?></span>
                            </a>
                        <?php endforeach; ?>
                        <?php if (!$trending) : ?>
                            <p class="sml-gex-empty">Trending groups will appear as communities become active.</p>
                        <?php endif; ?>
                    </div>
                </aside>
            </section>

            <section class="sml-gex-discover" aria-labelledby="sml-gex-discover-title">
                <div class="sml-gex-section-head">
                    <h2 id="sml-gex-discover-title">Discover communities</h2>
                    <span class="sml-gex-result-count"><span data-gex-result-count><?php echo esc_html(count($ranked)); ?></span> groups</span>
                </div>
                <div class="sml-gex-grid" data-gex-grid>
                    <?php foreach ($ranked as $group) : ?>
                        <?php
                        $creator = $group['creator'] ?? null;
                        $search_blob = strtolower(
                            implode(
                                ' ',
                                array(
                                    $group['name'],
                                    $group['description'],
                                    $group['ticker_symbol'],
                                    $group['sector_name'],
                                    $group['type'],
                                    $group['access_model'],
                                    $creator['handle'] ?? '',
                                    $creator['display_name'] ?? '',
                                )
                            )
                        );
                        ?>
                        <article
                            class="sml-gex-tile"
                            data-group-id="<?php echo esc_attr($group['id']); ?>"
                            data-group-type="<?php echo esc_attr($group['type']); ?>"
                            data-group-access="<?php echo esc_attr($group['access_model']); ?>"
                            data-group-member="<?php echo $group['is_member'] ? '1' : '0'; ?>"
                            data-group-created="<?php echo esc_attr(strtotime((string) ($group['created_at'] ?? '')) ?: 0); ?>"
                            data-group-score="<?php echo esc_attr($group['group_score']); ?>"
                            data-group-options="<?php echo (stripos($search_blob, 'option') !== false) ? '1' : '0'; ?>"
                            data-group-search="<?php echo esc_attr($search_blob); ?>"
                        >
                            <a class="sml-gex-tile-link" href="<?php echo esc_url($group['url']); ?>">
                                <span class="sml-gex-tile-top">
                                    <?php sml_gex_render_image($group, 'sml-gex-tile-logo'); ?>
                                    <span class="sml-gex-tile-tag"><?php echo esc_html(sml_gex_access_label($group)); ?></span>
                                </span>
                                <span class="sml-gex-tile-body">
                                    <h3><?php echo esc_html($group['name']); ?></h3>
                                    <p><?php echo esc_html($group['description']); ?></p>
                                </span>
                                <span class="sml-gex-tile-meta">
                                    <span><?php echo esc_html(sml_gex_type_label($group)); ?></span>
                                    <span class="sml-gex-tile-score" title="Group Score"><?php echo esc_html(number_format_i18n($group['group_score'])); ?> pts</span>
                                    <b><?php echo esc_html(number_format_i18n($group['member_count'])); ?> members</b>
                                </span>
                            </a>
                            <button class="sml-gex-save" type="button" aria-label="Save <?php echo esc_attr($group['name']); ?>" aria-pressed="false" data-gex-save="<?php echo esc_attr($group['id']); ?>">S</button>
                        </article>
                    <?php endforeach; ?>
                    <div class="sml-gex-empty" data-gex-empty hidden>No groups match this view. Try another filter or search.</div>
                </div>
            </section>
        </div>

        <footer class="sml-gex-footer">
            <span>&copy; <?php echo esc_html(wp_date('Y')); ?> StockMarketLoop</span>
            <nav aria-label="Legal links">
                <a href="<?php echo esc_url(home_url('/about/')); ?>">About</a>
                <a href="<?php echo esc_url(home_url('/contact/')); ?>">Contact</a>
                <a href="<?php echo esc_url(home_url('/terms/')); ?>">Terms</a>
                <a href="<?php echo esc_url(home_url('/privacy-policy/')); ?>">Privacy</a>
            </nav>
        </footer>
    </main>
</div>

<nav class="sml-gex-mobile-nav" aria-label="Mobile groups navigation">
    <button type="button" data-gex-filter="all" aria-pressed="true">Discover</button>
    <button type="button" data-gex-filter="mine" aria-pressed="false">Your groups</button>
    <button type="button" data-gex-filter="trending" aria-pressed="false">Trending</button>
    <button type="button" data-gex-create>Create</button>
</nav>

<dialog class="sml-gex-dialog" data-gex-dialog aria-labelledby="sml-gex-dialog-title">
    <div class="sml-gex-dialog-head">
        <h2 id="sml-gex-dialog-title">Create a group</h2>
        <button class="sml-gex-dialog-close" type="button" data-gex-close aria-label="Close create group dialog">X</button>
    </div>
    <?php if ($is_logged_in) : ?>
        <form class="sml-gex-form" data-gex-create-form>
            <div class="sml-gex-form-grid">
                <div class="sml-gex-field">
                    <label for="sml-gex-name">Group name</label>
                    <input id="sml-gex-name" name="name" required minlength="2" maxlength="190" placeholder="Example: SPY Trading Floor">
                </div>
                <div class="sml-gex-field">
                    <label for="sml-gex-type">Group type</label>
                    <select id="sml-gex-type" name="type">
                        <option value="ticker">Ticker room</option>
                        <option value="sector">Sector hub</option>
                        <option value="creator">Creator community</option>
                        <option value="private">Private group</option>
                    </select>
                </div>
            </div>
            <div class="sml-gex-form-grid">
                <div class="sml-gex-field" data-gex-ticker-field>
                    <label for="sml-gex-ticker">Ticker symbol</label>
                    <input id="sml-gex-ticker" name="ticker_symbol" maxlength="12" placeholder="SPY">
                </div>
                <div class="sml-gex-field" data-gex-sector-field hidden>
                    <label for="sml-gex-sector">Sector</label>
                    <input id="sml-gex-sector" name="sector_name" maxlength="120" placeholder="AI, Energy, Banks">
                </div>
                <div class="sml-gex-field" data-gex-creator-field hidden>
                    <label for="sml-gex-creator">Creator/community link</label>
                    <input id="sml-gex-creator" name="creator_url" type="url" placeholder="https://">
                </div>
                <div class="sml-gex-field">
                    <label for="sml-gex-access">Access</label>
                    <select id="sml-gex-access" name="access_model">
                        <option value="free">Free</option>
                        <option value="paid">Membership required</option>
                    </select>
                </div>
            </div>
            <div class="sml-gex-form-grid" data-gex-paid-fields hidden>
                <div class="sml-gex-field">
                    <label for="sml-gex-price">Monthly price</label>
                    <input id="sml-gex-price" name="monthly_price_loopbucks" type="number" min="100" step="1" value="100">
                </div>
                <div class="sml-gex-field">
                    <label for="sml-gex-pitch">Membership pitch</label>
                    <input id="sml-gex-pitch" name="paid_pitch" maxlength="240" placeholder="What members unlock">
                </div>
            </div>
            <div class="sml-gex-field">
                <label for="sml-gex-description">Description</label>
                <textarea id="sml-gex-description" name="description" maxlength="1200" placeholder="Explain who this group is for and what members can expect."></textarea>
            </div>
            <div class="sml-gex-form-status" data-gex-create-status aria-live="polite"></div>
            <button class="sml-gex-primary" type="submit">Create group</button>
        </form>
    <?php else : ?>
        <div class="sml-gex-form">
            <p>Sign in to create and manage your StockMarketLoop community.</p>
            <a class="sml-gex-primary" href="<?php echo esc_url($login_url); ?>">Sign in to continue</a>
        </div>
    <?php endif; ?>
</dialog>

<script id="sml-gex-script">
(function () {
    'use strict';
    var root = document;
    var tiles = Array.prototype.slice.call(root.querySelectorAll('.sml-gex-tile'));
    var filter = 'all';
    var query = '';
    var savedKey = 'sml-gex-saved-groups';
    var saved = [];
    var nonce = <?php echo wp_json_encode($rest_nonce); ?>;
    var loginUrl = <?php echo wp_json_encode($login_url); ?>;
    var loggedIn = <?php echo $is_logged_in ? 'true' : 'false'; ?>;

    try {
        saved = JSON.parse(localStorage.getItem(savedKey) || '[]').map(String);
    } catch (error) {
        saved = [];
    }

    function setSaved(next) {
        saved = next;
        try {
            localStorage.setItem(savedKey, JSON.stringify(saved));
        } catch (error) {}
    }

    function setPressedFilter(value) {
        root.querySelectorAll('[data-gex-filter]').forEach(function (button) {
            button.setAttribute('aria-pressed', button.dataset.gexFilter === value ? 'true' : 'false');
        });
    }

    function sortTiles(value) {
        var grid = root.querySelector('[data-gex-grid]');
        if (!grid) return;
        var ordered = tiles.slice();
        if (value === 'new') {
            ordered.sort(function (a, b) { return Number(b.dataset.groupCreated || 0) - Number(a.dataset.groupCreated || 0); });
        } else if (value === 'trending') {
            ordered.sort(function (a, b) { return Number(b.dataset.groupScore || 0) - Number(a.dataset.groupScore || 0); });
        }
        ordered.forEach(function (tile) { grid.insertBefore(tile, root.querySelector('[data-gex-empty]')); });
    }

    function matches(tile) {
        var id = String(tile.dataset.groupId || '');
        var searchable = String(tile.dataset.groupSearch || '');
        if (query && searchable.indexOf(query) === -1) return false;
        if (filter === 'all' || filter === 'trending' || filter === 'new') return true;
        if (filter === 'mine') return tile.dataset.groupMember === '1';
        if (filter === 'saved') return saved.indexOf(id) !== -1;
        if (filter === 'free' || filter === 'paid') return tile.dataset.groupAccess === filter;
        if (filter === 'options') return tile.dataset.groupOptions === '1';
        return tile.dataset.groupType === filter;
    }

    function render() {
        var visible = 0;
        sortTiles(filter);
        tiles.forEach(function (tile) {
            var show = matches(tile);
            tile.hidden = !show;
            if (show) visible += 1;
            var save = tile.querySelector('[data-gex-save]');
            if (save) save.setAttribute('aria-pressed', saved.indexOf(String(tile.dataset.groupId)) !== -1 ? 'true' : 'false');
        });
        var count = root.querySelector('[data-gex-result-count]');
        var empty = root.querySelector('[data-gex-empty]');
        var activeCount = root.querySelector('[data-gex-filter-count]');
        if (count) count.textContent = String(visible);
        if (empty) empty.hidden = visible !== 0;
        if (activeCount) activeCount.textContent = (filter === 'all' ? '0' : '1');
        setPressedFilter(filter);
    }

    root.querySelectorAll('[data-gex-filter]').forEach(function (button) {
        button.addEventListener('click', function () {
            filter = button.dataset.gexFilter || 'all';
            render();
            var discover = root.querySelector('.sml-gex-discover');
            if (discover && button.closest('.sml-gex-sidebar, .sml-gex-mobile-nav, .sml-gex-trending')) {
                discover.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    var search = root.querySelector('[data-gex-search]');
    if (search) {
        search.addEventListener('input', function () {
            query = search.value.trim().toLowerCase();
            render();
        });
    }

    root.addEventListener('keydown', function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            if (search) search.focus();
        }
    });

    root.querySelectorAll('[data-gex-save]').forEach(function (button) {
        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            var id = String(button.dataset.gexSave || '');
            var index = saved.indexOf(id);
            if (index === -1) saved.push(id);
            else saved.splice(index, 1);
            setSaved(saved);
            render();
        });
    });

    var dialog = root.querySelector('[data-gex-dialog]');
    function openCreate() {
        if (!loggedIn) {
            window.location.href = loginUrl;
            return;
        }
        if (dialog && typeof dialog.showModal === 'function') {
            dialog.showModal();
            var first = dialog.querySelector('input');
            if (first) window.setTimeout(function () { first.focus(); }, 50);
        }
    }
    root.querySelectorAll('[data-gex-create]').forEach(function (button) {
        button.addEventListener('click', openCreate);
    });
    var close = root.querySelector('[data-gex-close]');
    if (close) close.addEventListener('click', function () { dialog.close(); });
    if (dialog) dialog.addEventListener('click', function (event) {
        if (event.target === dialog) dialog.close();
    });

    var type = root.querySelector('#sml-gex-type');
    var access = root.querySelector('#sml-gex-access');
    function syncFields() {
        if (!type) return;
        var ticker = root.querySelector('[data-gex-ticker-field]');
        var sector = root.querySelector('[data-gex-sector-field]');
        var creator = root.querySelector('[data-gex-creator-field]');
        if (ticker) ticker.hidden = type.value !== 'ticker';
        if (sector) sector.hidden = type.value !== 'sector';
        if (creator) creator.hidden = type.value !== 'creator';
        var paid = root.querySelector('[data-gex-paid-fields]');
        if (paid) paid.hidden = !access || access.value !== 'paid';
    }
    if (type) type.addEventListener('change', syncFields);
    if (access) access.addEventListener('change', syncFields);
    syncFields();

    var form = root.querySelector('[data-gex-create-form]');
    if (form) {
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            var status = form.querySelector('[data-gex-create-status]');
            var values = new FormData(form);
            var payload = {};
            values.forEach(function (value, key) { payload[key] = value; });
            if (status) {
                status.textContent = 'Creating your group...';
                status.dataset.error = 'false';
            }
            fetch('/wp-json/sml/v1/group/create', {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: {
                    'Content-Type': 'application/json',
                    'X-WP-Nonce': nonce
                },
                body: JSON.stringify(payload)
            }).then(function (response) {
                return response.json().then(function (data) {
                    if (!response.ok || data.code) throw data;
                    return data;
                });
            }).then(function (data) {
                window.location.href = data.group.url;
            }).catch(function (error) {
                if (status) {
                    status.textContent = error.message || 'The group could not be created. Please review the fields and try again.';
                    status.dataset.error = 'true';
                }
            });
        });
    }

    render();
})();
</script>
</body>
</html>
    <?php
    exit;
}
add_action('template_redirect', 'sml_gex_render_directory', -900000);
