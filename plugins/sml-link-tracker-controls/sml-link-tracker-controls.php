<?php
/**
 * Plugin Name: SML Link Tracker Controls
 * Description: Adds an interactive click map, inline street maps, and layered per-link access protection to the SML Link Intelligence Tracker.
 * Version: 1.5.0
 * Author: StockMarketLoop
 */

defined('ABSPATH') || exit;

define('SML_LINK_TRACKER_CONTROLS_VERSION', '1.5.0');
define('SML_LINK_TRACKER_CONTROLS_FILE', __FILE__);
define('SML_LINK_TRACKER_CONTROLS_URL', plugin_dir_url(__FILE__));
define('SML_LINK_TRACKER_CONTROLS_MAX_RULES', 200);

require_once __DIR__ . '/includes/matcher.php';

function sml_ltc_tables() {
    global $wpdb;
    return array(
        'rules'    => $wpdb->prefix . 'sml_link_access_rules',
        'attempts' => $wpdb->prefix . 'sml_link_blocked_attempts',
        'monitor'  => $wpdb->prefix . 'sml_link_monitor_settings',
        'alerts'   => $wpdb->prefix . 'sml_link_monitor_alerts',
    );
}

function sml_ltc_install() {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $t = sml_ltc_tables();
    $charset = $wpdb->get_charset_collate();

    dbDelta("CREATE TABLE {$t['rules']} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        link_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
        rule_type VARCHAR(16) NOT NULL,
        `value` VARCHAR(120) NOT NULL,
        country_code CHAR(2) NOT NULL DEFAULT '',
        hits BIGINT UNSIGNED NOT NULL DEFAULT 0,
        last_hit_at DATETIME NULL,
        created_at DATETIME NOT NULL,
        PRIMARY KEY  (id),
        KEY link_id (link_id)
    ) $charset;");

    dbDelta("CREATE TABLE {$t['attempts']} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        link_id BIGINT UNSIGNED NOT NULL,
        rule_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
        raw_ip VARBINARY(45) NULL,
        ip_hash CHAR(64) NOT NULL DEFAULT '',
        country_code CHAR(2) NOT NULL DEFAULT '',
        country VARCHAR(80) NOT NULL DEFAULT '',
        region VARCHAR(120) NOT NULL DEFAULT '',
        city VARCHAR(120) NOT NULL DEFAULT '',
        lat DECIMAL(9,6) NULL,
        lng DECIMAL(9,6) NULL,
        device VARCHAR(30) NOT NULL DEFAULT '',
        browser VARCHAR(80) NOT NULL DEFAULT '',
        platform VARCHAR(80) NOT NULL DEFAULT '',
        layer VARCHAR(24) NOT NULL DEFAULT 'manual',
        reason VARCHAR(190) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL,
        PRIMARY KEY  (id),
        KEY link_created (link_id,created_at),
        KEY ip_link (ip_hash,link_id,created_at)
    ) $charset;");

    dbDelta("CREATE TABLE {$t['monitor']} (
        link_id BIGINT UNSIGNED NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        window_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 10,
        click_threshold SMALLINT UNSIGNED NOT NULL DEFAULT 40,
        bot_threshold SMALLINT UNSIGNED NOT NULL DEFAULT 15,
        blocked_threshold SMALLINT UNSIGNED NOT NULL DEFAULT 10,
        repeat_threshold SMALLINT UNSIGNED NOT NULL DEFAULT 12,
        cooldown_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
        protection_mode VARCHAR(12) NOT NULL DEFAULT 'balanced',
        rate_window SMALLINT UNSIGNED NOT NULL DEFAULT 10,
        ip_limit SMALLINT UNSIGNED NOT NULL DEFAULT 60,
        network_limit SMALLINT UNSIGNED NOT NULL DEFAULT 180,
        fingerprint_limit SMALLINT UNSIGNED NOT NULL DEFAULT 90,
        challenge_enabled TINYINT(1) NOT NULL DEFAULT 0,
        block_bots TINYINT(1) NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (link_id), KEY user_id (user_id)
    ) $charset;");

    dbDelta("CREATE TABLE {$t['alerts']} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        link_id BIGINT UNSIGNED NOT NULL,
        alert_type VARCHAR(32) NOT NULL,
        message VARCHAR(255) NOT NULL,
        observed BIGINT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        PRIMARY KEY (id), KEY link_created (link_id,created_at)
    ) $charset;");

    update_option('sml_ltc_version', SML_LINK_TRACKER_CONTROLS_VERSION, false);
}
register_activation_hook(__FILE__, 'sml_ltc_install');

add_action('init', function () {
    if (get_option('sml_ltc_version') !== SML_LINK_TRACKER_CONTROLS_VERSION) {
        sml_ltc_install();
    }
}, 9);

/* ------------------------------------------------------------------ rules */

function sml_ltc_rules_for_link($link_id) {
    global $wpdb;
    $t = sml_ltc_tables();
    return (array) $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t['rules']} WHERE link_id=%d ORDER BY id ASC", (int) $link_id), ARRAY_A);
}

function sml_ltc_rules_need_geo($rules) {
    foreach ($rules as $r) {
        if (in_array($r['rule_type'], array('country', 'region', 'city'), true)) { return true; }
    }
    return false;
}

function sml_ltc_visitor_context($rules, $with_geo = null) {
    $ip = sml_lit_client_ip();
    $ua = isset($_SERVER['HTTP_USER_AGENT']) ? substr(sanitize_textarea_field(wp_unslash($_SERVER['HTTP_USER_AGENT'])), 0, 1000) : '';
    $agent = sml_lit_parse_agent($ua);
    // The location lookup is only done when a rule needs it (or when a block is being recorded for the map).
    $geo = ($with_geo === null ? sml_ltc_rules_need_geo($rules) : $with_geo) ? sml_lit_geo($ip) : array();
    return array(
        'ip' => $ip,
        'country_code' => (string) ($geo['country_code'] ?? ''),
        'country' => (string) ($geo['country'] ?? ''),
        'region' => (string) ($geo['region'] ?? ''),
        'city' => (string) ($geo['city'] ?? ''),
        'lat' => $geo['latitude'] ?? null,
        'lng' => $geo['longitude'] ?? null,
        'device' => $agent['device'],
        'platform' => $agent['platform'],
        'browser' => $agent['browser'],
        'user_agent' => $ua,
        'is_bot' => (int) $agent['is_bot'],
        'bot_reason' => (string) $agent['bot_reason'],
        'server_fp' => function_exists('sml_lit_server_fp') ? sml_lit_server_fp() : hash('sha256', $ua),
    );
}

/* ------------------------------------------------------------------ layered guard */

function sml_ltc_guard_defaults() {
    return array(
        'protection_mode' => 'balanced', 'rate_window' => 10, 'ip_limit' => 60,
        'network_limit' => 180, 'fingerprint_limit' => 90,
        'challenge_enabled' => 0, 'block_bots' => 0,
    );
}

function sml_ltc_guard_settings($link_id) {
    global $wpdb;
    $t = sml_ltc_tables();
    $row = $wpdb->get_row($wpdb->prepare("SELECT protection_mode,rate_window,ip_limit,network_limit,fingerprint_limit,challenge_enabled,block_bots FROM {$t['monitor']} WHERE link_id=%d", (int) $link_id), ARRAY_A);
    $out = array_merge(sml_ltc_guard_defaults(), is_array($row) ? $row : array());
    $out['protection_mode'] = in_array($out['protection_mode'], array('standard', 'balanced', 'strict'), true) ? $out['protection_mode'] : 'balanced';
    foreach (array('rate_window', 'ip_limit', 'network_limit', 'fingerprint_limit', 'challenge_enabled', 'block_bots') as $key) $out[$key] = (int) $out[$key];
    return $out;
}

function sml_ltc_guard_network($ip) {
    $bin = @inet_pton((string) $ip);
    if ($bin === false) return '';
    if (strlen($bin) === 4) return bin2hex(substr($bin, 0, 3)) . '/24';
    return bin2hex(substr($bin, 0, 8)) . '/64';
}

function sml_ltc_guard_counter($key, $ttl) {
    $key = 'g_' . hash('sha256', (string) $key);
    $ttl = max(60, (int) $ttl);
    if (function_exists('wp_using_ext_object_cache') && wp_using_ext_object_cache()) {
        if (wp_cache_add($key, 1, 'sml_ltc_guard', $ttl)) return 1;
        $count = wp_cache_incr($key, 1, 'sml_ltc_guard');
        if ($count !== false) return (int) $count;
    }
    $old = (int) get_transient('sml_ltc_' . $key);
    $count = $old + 1;
    set_transient('sml_ltc_' . $key, $count, $ttl);
    return $count;
}

function sml_ltc_guard_cookie_name($link_id) { return 'sml_ltc_v_' . (int) $link_id; }

function sml_ltc_guard_identity($link_id, $ctx, $expires) {
    return (int) $link_id . '|' . (int) $expires . '|' . sml_lit_ip_hash((string) ($ctx['ip'] ?? '')) . '|' . hash('sha256', (string) ($ctx['user_agent'] ?? ''));
}

function sml_ltc_guard_cookie_valid($link_id, $ctx) {
    $name = sml_ltc_guard_cookie_name($link_id);
    $raw = isset($_COOKIE[$name]) ? (string) wp_unslash($_COOKIE[$name]) : '';
    if (!preg_match('/^(\d{10})\.([a-f0-9]{64})$/', $raw, $m) || (int) $m[1] < time()) return false;
    $want = hash_hmac('sha256', sml_ltc_guard_identity($link_id, $ctx, (int) $m[1]), wp_salt('secure_auth'));
    return hash_equals($want, $m[2]);
}

function sml_ltc_guard_challenge_token($link_id, $ctx) {
    $expires = time() + 300;
    $payload = (int) $link_id . '|' . $expires . '|' . sml_lit_ip_hash((string) ($ctx['ip'] ?? '')) . '|' . hash('sha256', (string) ($ctx['user_agent'] ?? ''));
    return base64_encode($payload) . '.' . hash_hmac('sha256', $payload, wp_salt('nonce'));
}

function sml_ltc_guard_verify_challenge($link, $ctx) {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST' || empty($_SERVER['HTTP_X_SML_GUARD'])) return false;
    $raw = isset($_POST['token']) ? (string) wp_unslash($_POST['token']) : '';
    $parts = explode('.', $raw, 2);
    $payload = count($parts) === 2 ? base64_decode($parts[0], true) : false;
    if (!is_string($payload) || !hash_equals(hash_hmac('sha256', $payload, wp_salt('nonce')), $parts[1])) return new WP_Error('bad_challenge', 'Browser verification expired.', array('status' => 403));
    $values = explode('|', $payload);
    if (count($values) !== 4 || (int) $values[0] !== (int) $link['id'] || (int) $values[1] < time() || (int) $values[1] > time() + 360) return new WP_Error('bad_challenge', 'Browser verification expired.', array('status' => 403));
    if (!hash_equals($values[2], sml_lit_ip_hash((string) ($ctx['ip'] ?? ''))) || !hash_equals($values[3], hash('sha256', (string) ($ctx['user_agent'] ?? '')))) return new WP_Error('bad_challenge', 'Browser verification changed.', array('status' => 403));
    $expires = time() + 12 * HOUR_IN_SECONDS;
    $value = $expires . '.' . hash_hmac('sha256', sml_ltc_guard_identity((int) $link['id'], $ctx, $expires), wp_salt('secure_auth'));
    setcookie(sml_ltc_guard_cookie_name((int) $link['id']), $value, array('expires' => $expires, 'path' => '/go/' . rawurlencode($link['slug']) . '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax'));
    nocache_headers();
    wp_send_json(array('ok' => true));
}

function sml_ltc_guard_render_challenge($link, $ctx) {
    status_header(200); nocache_headers();
    header('Content-Type: text/html; charset=utf-8'); header('X-Robots-Tag: noindex, nofollow'); header('Referrer-Policy: no-referrer');
    $token = sml_ltc_guard_challenge_token((int) $link['id'], $ctx);
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Checking this link</title>';
    echo '<style>html,body{height:100%;margin:0;background:#070c15;color:#c9d6e5;font:16px system-ui,-apple-system,Segoe UI,sans-serif}body{display:grid;place-items:center;text-align:center;padding:24px}.b{max-width:430px}.s{width:38px;height:38px;border:3px solid #263746;border-top-color:#38f58a;border-radius:50%;margin:0 auto 18px;animation:r .8s linear infinite}h1{font-size:21px;color:#fff}p{color:#8ea2b8}@keyframes r{to{transform:rotate(360deg)}}</style></head><body><div class="b"><div class="s"></div><h1>Checking this protected link</h1><p id="m">Verifying your browser before continuing.</p></div>';
    echo '<script>(function(){var t=' . wp_json_encode($token) . ',m=document.getElementById("m");fetch(location.href,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/x-www-form-urlencoded","X-SML-Guard":"1"},body:"token="+encodeURIComponent(t)}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(){location.replace(location.href)}).catch(function(){m.textContent="This browser could not be verified. Refresh to try again."})}());</script></body></html>';
    exit;
}

function sml_ltc_guard_decision($link, $ctx, $settings) {
    if ($settings['protection_mode'] === 'standard') return null;
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if (!in_array($method, array('GET', 'HEAD'), true)) return array('layer' => 'protocol', 'reason' => 'Unsupported request method');
    if ($ctx['user_agent'] === '') return array('layer' => 'integrity', 'reason' => 'Missing browser identity');
    if (($settings['block_bots'] || $settings['protection_mode'] === 'strict') && $ctx['is_bot']) return array('layer' => 'automation', 'reason' => $ctx['bot_reason'] ?: 'Automated client');

    $window = max(1, min(60, $settings['rate_window'])) * MINUTE_IN_SECONDS;
    $link_id = (int) $link['id'];
    $ip_limit = max(5, $settings['ip_limit']);
    $network_limit = max(10, $settings['network_limit']);
    $fingerprint_limit = max(5, $settings['fingerprint_limit']);
    if ($settings['protection_mode'] === 'strict') {
        $ip_limit = min($ip_limit, 20); $network_limit = min($network_limit, 60); $fingerprint_limit = min($fingerprint_limit, 30);
    }
    if ($ctx['ip'] !== '') {
        $ip_count = sml_ltc_guard_counter($link_id . '|ip|' . sml_lit_ip_hash($ctx['ip']), $window);
        if ($ip_count > $ip_limit) return array('layer' => 'rate_ip', 'reason' => 'Too many requests from one address');
        $network = sml_ltc_guard_network($ctx['ip']);
        if ($network !== '') {
            $network_count = sml_ltc_guard_counter($link_id . '|network|' . $network, $window);
            if ($network_count > $network_limit) return array('layer' => 'rate_network', 'reason' => 'Too many requests from one network');
        }
    }
    if ($ctx['server_fp'] !== '') {
        $fp_count = sml_ltc_guard_counter($link_id . '|fp|' . $ctx['server_fp'], $window);
        if ($fp_count > $fingerprint_limit) return array('layer' => 'rate_fingerprint', 'reason' => 'Repeated browser fingerprint');
    }
    $global_count = sml_ltc_guard_counter($link_id . '|global', $window);
    if ($global_count > max(300, $network_limit * 5)) return array('layer' => 'rate_global', 'reason' => 'Link traffic burst exceeded its safety ceiling');
    return null;
}

function sml_ltc_log_blocked($link, $rule, $ctx) {
    global $wpdb;
    $t = sml_ltc_tables();
    $hash = sml_lit_ip_hash($ctx['ip']);
    $now = current_time('mysql');
    // A blocked visitor refreshing the page should not fill the table.
    if ($hash !== '') {
        $recent = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$t['attempts']} WHERE link_id=%d AND ip_hash=%s AND created_at >= %s",
            (int) $link['id'], $hash, gmdate('Y-m-d H:i:s', time() - 60 + (int) (get_option('gmt_offset') * 3600))
        ));
        if ($recent >= 5) { return; }
    }
    $row = array(
        'link_id' => (int) $link['id'],
        'rule_id' => (int) $rule['id'],
        'raw_ip' => $ctx['ip'],
        'ip_hash' => $hash,
        'country_code' => $ctx['country_code'],
        'country' => $ctx['country'],
        'region' => $ctx['region'],
        'city' => $ctx['city'],
        'device' => $ctx['device'],
        'browser' => $ctx['browser'],
        'platform' => $ctx['platform'],
        'layer' => (string) ($rule['layer'] ?? 'manual'),
        'reason' => substr((string) ($rule['reason'] ?? ''), 0, 190),
        'created_at' => $now,
    );
    $formats = array('%d', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s');
    if ($ctx['lat'] !== null && $ctx['lng'] !== null) {
        $row['lat'] = $ctx['lat'];
        $row['lng'] = $ctx['lng'];
        $formats[] = '%f';
        $formats[] = '%f';
    }
    $wpdb->insert($t['attempts'], $row, $formats);
    $wpdb->query($wpdb->prepare("UPDATE {$t['rules']} SET hits=hits+1, last_hit_at=%s WHERE id=%d", $now, (int) $rule['id']));
    sml_ltc_check_activity((int) $link['id']);
}

function sml_ltc_render_blocked() {
    status_header(403);
    nocache_headers();
    header('Content-Type: text/html; charset=utf-8');
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: no-referrer');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Protected link unavailable</title>';
    echo '<style>html,body{height:100%;margin:0;background:#070c15;color:#c9d6e5;font:16px system-ui,-apple-system,Segoe UI,sans-serif}body{display:grid;place-items:center;text-align:center;padding:24px}.b{max-width:420px}.i{width:54px;height:54px;border-radius:50%;border:2px solid #ff566e;color:#ff566e;display:grid;place-items:center;margin:0 auto 18px;font-size:26px;font-weight:800}h1{margin:0 0 8px;font-size:22px;color:#fff}p{margin:0;color:#8ea2b8;line-height:1.55}</style></head><body><div class="b"><div class="i">&#x2715;</div>';
    echo '<h1>This protected link is unavailable</h1><p>This request did not pass the access rules set by the person who shared the link.</p></div></body></html>';
    exit;
}

/* The tracker's own redirect runs at priority 0. This layered guard runs first,
   so blocked and unverified requests are never logged as clicks and never
   receive the destination URL. */
add_action('template_redirect', function () {
    if (!function_exists('sml_lit_get_link') || !function_exists('sml_lit_client_ip') || !function_exists('sml_lit_geo')) { return; }
    $slug = get_query_var('sml_lit_slug');
    if (!$slug) { return; }
    $link = sml_lit_get_link($slug);
    if (!$link || $link['status'] !== 'active') { return; }
    $rules = sml_ltc_rules_for_link((int) $link['id']);
    $settings = sml_ltc_guard_settings((int) $link['id']);
    $ctx = sml_ltc_visitor_context($rules);
    if ($rules) {
        $hit = sml_ltc_first_match($rules, $ctx);
        if ($hit) {
            if (!sml_ltc_rules_need_geo($rules)) $ctx = sml_ltc_visitor_context($rules, true);
            if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
            $hit['layer'] = 'manual'; $hit['reason'] = 'Matched ' . $hit['rule_type'] . ' access rule';
            sml_ltc_log_blocked($link, $hit, $ctx); sml_ltc_render_blocked();
        }
    }

    $verified = sml_ltc_guard_verify_challenge($link, $ctx);
    if (is_wp_error($verified)) { status_header(403); wp_send_json_error(array('message' => $verified->get_error_message()), 403); }
    $decision = sml_ltc_guard_decision($link, $ctx, $settings);
    if ($decision) {
        if (!sml_ltc_rules_need_geo($rules)) $ctx = sml_ltc_visitor_context($rules, true);
        if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
        $decision['id'] = 0; sml_ltc_log_blocked($link, $decision, $ctx); sml_ltc_render_blocked();
    }
    $needs_challenge = $settings['protection_mode'] === 'strict' || !empty($settings['challenge_enabled']);
    if ($needs_challenge && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET' && !$ctx['is_bot'] && !sml_ltc_guard_cookie_valid((int) $link['id'], $ctx)) {
        if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
        sml_ltc_guard_render_challenge($link, $ctx);
    }
}, -5);

/* ------------------------------------------------------------------- REST */

function sml_ltc_register_routes($ns) {
    register_rest_route($ns, '/links/(?P<id>\d+)/access', array(
        array('methods' => WP_REST_Server::READABLE, 'permission_callback' => 'is_user_logged_in', 'callback' => 'sml_ltc_rest_access_list'),
        array('methods' => WP_REST_Server::CREATABLE, 'permission_callback' => 'is_user_logged_in', 'callback' => 'sml_ltc_rest_access_add'),
    ));
    register_rest_route($ns, '/links/(?P<id>\d+)/access/(?P<rule>\d+)/delete', array(
        'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => 'is_user_logged_in', 'callback' => 'sml_ltc_rest_access_delete',
    ));
    register_rest_route($ns, '/links/(?P<id>\d+)/map', array(
        'methods' => WP_REST_Server::READABLE, 'permission_callback' => 'is_user_logged_in', 'callback' => 'sml_ltc_rest_map',
    ));
    register_rest_route($ns, '/links/(?P<id>\d+)/monitoring', array(
        array('methods' => WP_REST_Server::READABLE, 'permission_callback' => 'is_user_logged_in', 'callback' => 'sml_ltc_rest_monitor_get'),
        array('methods' => WP_REST_Server::CREATABLE, 'permission_callback' => 'is_user_logged_in', 'callback' => 'sml_ltc_rest_monitor_save'),
    ));
}
add_action('rest_api_init', function () {
    sml_ltc_register_routes('sml-intel/v1');
    sml_ltc_register_routes('sml-link-tracker/v1');
});

function sml_ltc_owned_link(WP_REST_Request $request) {
    if (!function_exists('sml_lit_get_link')) {
        return new WP_Error('tracker_missing', 'The Link Intelligence Tracker plugin is not active.', array('status' => 503));
    }
    $link = sml_lit_get_link(absint($request['id']));
    if (!$link) { return new WP_Error('not_found', 'Tracked link not found.', array('status' => 404)); }
    if ((int) $link['user_id'] !== get_current_user_id() && !current_user_can('manage_options')) {
        return new WP_Error('forbidden', 'You can only manage your own links.', array('status' => 403));
    }
    return $link;
}

function sml_ltc_rule_label($r) {
    $v = $r['value'];
    switch ($r['rule_type']) {
        case 'all': return 'Everyone';
        case 'country': return 'Country: ' . $v;
        case 'region': return 'Region: ' . $v . ($r['country_code'] ? ' (' . $r['country_code'] . ')' : '');
        case 'city': return 'City: ' . $v . ($r['country_code'] ? ' (' . $r['country_code'] . ')' : '');
        case 'device': return 'Device: ' . $v;
        case 'platform': return 'OS: ' . $v;
        case 'browser': return 'Browser: ' . $v;
        case 'ip': return 'IP: ' . $v;
    }
    return $v;
}

function sml_ltc_rule_response($r) {
    return array(
        'id' => (int) $r['id'],
        'rule_type' => $r['rule_type'],
        'value' => $r['rule_type'] === 'ip' && !current_user_can('manage_options') ? sml_ltc_mask_ip($r['value']) : $r['value'],
        'country_code' => $r['country_code'],
        'label' => sml_ltc_rule_label($r['rule_type'] === 'ip' && !current_user_can('manage_options') ? array_merge($r, array('value' => sml_ltc_mask_ip($r['value']))) : $r),
        'hits' => (int) $r['hits'],
        'last_hit_at' => $r['last_hit_at'],
        'created_at' => $r['created_at'],
    );
}

/** Owners can block an IP from their analytics without ever seeing it, so the list shows it partly hidden. */
function sml_ltc_mask_ip($v) {
    if (strpos($v, ':') !== false) { $p = explode(':', $v); return $p[0] . ':' . ($p[1] ?? '') . ':…'; }
    $range = '';
    if (strpos($v, '/') !== false) { list($v, $range) = explode('/', $v, 2); $range = '/' . $range; }
    $p = explode('.', $v);
    return ($p[0] ?? '') . '.' . ($p[1] ?? '') . '.•.•' . $range;
}

function sml_ltc_rest_access_list(WP_REST_Request $request) {
    $link = sml_ltc_owned_link($request);
    if (is_wp_error($link)) { return $link; }
    $rules = sml_ltc_rules_for_link((int) $link['id']);
    return rest_ensure_response(array(
        'rules' => array_map('sml_ltc_rule_response', $rules),
        'rule_types' => sml_ltc_rule_types(),
    ));
}

function sml_ltc_rest_access_add(WP_REST_Request $request) {
    global $wpdb;
    $link = sml_ltc_owned_link($request);
    if (is_wp_error($link)) { return $link; }
    $t = sml_ltc_tables();

    $type = (string) $request->get_param('rule_type');
    $value = (string) $request->get_param('value');
    $scope = (string) $request->get_param('country_code');

    // Block "the person who just clicked" without the owner ever being shown the raw IP.
    $source = (string) $request->get_param('source');
    $source_id = absint($request->get_param('source_id'));
    if ($source && $source_id) {
        $table = $source === 'attempt' ? sml_ltc_tables()['attempts'] : (function_exists('sml_lit_tables') ? sml_lit_tables()['clicks'] : '');
        if (!$table || !in_array($source, array('click', 'attempt'), true)) { return new WP_Error('bad_source', 'Unknown source.', array('status' => 400)); }
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE id=%d AND link_id=%d", $source_id, (int) $link['id']), ARRAY_A);
        if (!$row) { return new WP_Error('not_found', 'That visit was not found.', array('status' => 404)); }
        $map = array('country' => 'country_code', 'region' => 'region', 'city' => 'city', 'device' => 'device', 'platform' => 'platform', 'browser' => 'browser', 'ip' => 'raw_ip');
        if (!isset($map[$type])) { return new WP_Error('bad_type', 'That cannot be taken from a visit.', array('status' => 400)); }
        $value = (string) ($row[$map[$type]] ?? '');
        if ($value === '') { return new WP_Error('unknown', 'We could not tell that visitor\'s ' . $type . ', so there is nothing to block.', array('status' => 422)); }
        if (in_array($type, array('region', 'city'), true)) { $scope = (string) ($row['country_code'] ?? ''); }
    }

    list($clean, $why) = sml_ltc_clean_rule($type, $value, $scope);
    if (!$clean) { return new WP_Error('invalid_rule', $why, array('status' => 400)); }

    $existing = sml_ltc_rules_for_link((int) $link['id']);
    foreach ($existing as $r) {
        if ($r['rule_type'] === $clean['rule_type'] && strcasecmp($r['value'], $clean['value']) === 0 && strtoupper($r['country_code']) === strtoupper($clean['country_code'])) {
            return rest_ensure_response(array('rule' => sml_ltc_rule_response($r), 'already' => true));
        }
    }
    if (count($existing) >= SML_LINK_TRACKER_CONTROLS_MAX_RULES) { return new WP_Error('too_many', 'This link already has the maximum number of rules.', array('status' => 400)); }

    $ok = $wpdb->insert($t['rules'], array(
        'link_id' => (int) $link['id'],
        'user_id' => get_current_user_id(),
        'rule_type' => $clean['rule_type'],
        'value' => $clean['value'],
        'country_code' => $clean['country_code'],
        'created_at' => current_time('mysql'),
    ), array('%d', '%d', '%s', '%s', '%s', '%s'));
    if (!$ok) { return new WP_Error('insert_failed', 'Could not save the rule.', array('status' => 500)); }
    $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t['rules']} WHERE id=%d", (int) $wpdb->insert_id), ARRAY_A);
    return rest_ensure_response(array('rule' => sml_ltc_rule_response($row), 'already' => false));
}

function sml_ltc_rest_access_delete(WP_REST_Request $request) {
    global $wpdb;
    $link = sml_ltc_owned_link($request);
    if (is_wp_error($link)) { return $link; }
    $t = sml_ltc_tables();
    $wpdb->delete($t['rules'], array('id' => absint($request['rule']), 'link_id' => (int) $link['id']), array('%d', '%d'));
    return rest_ensure_response(array('ok' => true));
}

function sml_ltc_rest_map(WP_REST_Request $request) {
    global $wpdb;
    $link = sml_ltc_owned_link($request);
    if (is_wp_error($link)) { return $link; }
    $ct = sml_lit_tables()['clicks'];
    $at = sml_ltc_tables()['attempts'];
    $all_time = $request->get_param('period') === 'all';
    $days = $all_time ? 0 : max(1, min(365, absint($request->get_param('days') ?: 30)));
    $since = $all_time ? '1970-01-01 00:00:00' : gmdate('Y-m-d H:i:s', time() - $days * DAY_IN_SECONDS + (int) (get_option('gmt_offset') * 3600));
    $admin = current_user_can('manage_options');
    $dp = $admin ? 4 : 1; // owners get city-level positions, not exact coordinates
    $lid = (int) $link['id'];

    $clicks = $wpdb->get_results($wpdb->prepare(
        "SELECT country_code, MAX(country) country, region, city, ROUND(COALESCE(lat,latitude),$dp) la, ROUND(COALESCE(lng,longitude),$dp) lo,
                SUM(is_bot=0) humans, SUM(is_bot=1) bots, MAX(created_at) last_at
         FROM {$ct} WHERE link_id=%d AND created_at >= %s
         GROUP BY country_code, region, city, la, lo ORDER BY humans DESC LIMIT 500", $lid, $since), ARRAY_A);
    $blocked = $wpdb->get_results($wpdb->prepare(
        "SELECT country_code, MAX(country) country, region, city, ROUND(lat,$dp) la, ROUND(lng,$dp) lo, COUNT(*) n, MAX(created_at) last_at
         FROM {$at} WHERE link_id=%d AND created_at >= %s
         GROUP BY country_code, region, city, la, lo ORDER BY n DESC LIMIT 500", $lid, $since), ARRAY_A);

    $points = array();
    $key = function ($r) { return strtoupper($r['country_code']) . '|' . $r['region'] . '|' . $r['city'] . '|' . $r['la'] . '|' . $r['lo']; };
    foreach ($clicks as $r) {
        $points[$key($r)] = array('cc' => strtoupper($r['country_code']), 'country' => $r['country'], 'region' => $r['region'], 'city' => $r['city'],
            'lat' => $r['la'] === null ? null : (float) $r['la'], 'lng' => $r['lo'] === null ? null : (float) $r['lo'],
            'clicks' => (int) $r['humans'], 'bots' => (int) $r['bots'], 'blocked' => 0, 'last' => $r['last_at']);
    }
    foreach ($blocked as $r) {
        $k = $key($r);
        if (!isset($points[$k])) {
            $points[$k] = array('cc' => strtoupper($r['country_code']), 'country' => $r['country'], 'region' => $r['region'], 'city' => $r['city'],
                'lat' => $r['la'] === null ? null : (float) $r['la'], 'lng' => $r['lo'] === null ? null : (float) $r['lo'],
                'clicks' => 0, 'bots' => 0, 'blocked' => 0, 'last' => $r['last_at']);
        }
        $points[$k]['blocked'] = (int) $r['n'];
    }

    $recent = array();
    $rows = $wpdb->get_results($wpdb->prepare("SELECT id, country_code, country, region, city, device, browser, platform, is_bot, created_at FROM {$ct} WHERE link_id=%d AND created_at >= %s ORDER BY id DESC LIMIT 20", $lid, $since), ARRAY_A);
    foreach ($rows as $r) {
        $recent[] = array('source' => 'click', 'id' => (int) $r['id'], 'status' => $r['is_bot'] ? 'bot' : 'allowed', 'cc' => $r['country_code'], 'country' => $r['country'], 'region' => $r['region'], 'city' => $r['city'],
            'device' => $r['device'], 'browser' => $r['browser'], 'platform' => $r['platform'], 'at' => $r['created_at']);
    }
    $rows = $wpdb->get_results($wpdb->prepare("SELECT id, country_code, country, region, city, device, browser, platform, layer, reason, created_at FROM {$at} WHERE link_id=%d AND created_at >= %s ORDER BY id DESC LIMIT 10", $lid, $since), ARRAY_A);
    foreach ($rows as $r) {
        $recent[] = array('source' => 'attempt', 'id' => (int) $r['id'], 'status' => 'blocked', 'cc' => $r['country_code'], 'country' => $r['country'], 'region' => $r['region'], 'city' => $r['city'],
            'device' => $r['device'], 'browser' => $r['browser'], 'platform' => $r['platform'], 'layer' => $r['layer'], 'reason' => $r['reason'], 'at' => $r['created_at']);
    }
    usort($recent, function ($a, $b) { return strcmp($b['at'], $a['at']); });

    $total_blocked = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$at} WHERE link_id=%d AND created_at >= %s", $lid, $since));
    $total_clicks = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$ct} WHERE link_id=%d AND is_bot=0 AND created_at >= %s", $lid, $since));
    $unlocated = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$ct} WHERE link_id=%d AND is_bot=0 AND created_at >= %s AND COALESCE(lat,latitude) IS NULL", $lid, $since));

    $response = rest_ensure_response(array(
        'days' => $days,
        'period' => $all_time ? 'all' : $days,
        'totals' => array('clicks' => $total_clicks, 'blocked' => $total_blocked, 'unlocated' => $unlocated),
        'points' => array_values($points),
        'recent' => array_slice($recent, 0, 25),
    ));
    $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    return $response;
}

/* Per-link activity monitoring. Alerts describe unusual patterns, not proof of fraud. */
function sml_ltc_rest_monitor_get(WP_REST_Request $request) {
    global $wpdb;
    $link = sml_ltc_owned_link($request);
    if (is_wp_error($link)) { return $link; }
    $t = sml_ltc_tables(); $id = (int) $link['id'];
    $settings = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t['monitor']} WHERE link_id=%d", $id), ARRAY_A);
    if (!$settings) { $settings = array_merge(array('enabled'=>0,'window_minutes'=>10,'click_threshold'=>40,'bot_threshold'=>15,'blocked_threshold'=>10,'repeat_threshold'=>12,'cooldown_minutes'=>30), sml_ltc_guard_defaults()); }
    else { $settings = array_merge(sml_ltc_guard_defaults(), $settings); }
    unset($settings['user_id'], $settings['link_id']);
    $alerts = $wpdb->get_results($wpdb->prepare("SELECT alert_type,message,observed,created_at FROM {$t['alerts']} WHERE link_id=%d ORDER BY id DESC LIMIT 10", $id), ARRAY_A);
    return rest_ensure_response(array('settings'=>$settings,'alerts'=>$alerts));
}

function sml_ltc_rest_monitor_save(WP_REST_Request $request) {
    global $wpdb;
    $link = sml_ltc_owned_link($request);
    if (is_wp_error($link)) { return $link; }
    $t = sml_ltc_tables(); $id = (int) $link['id'];
    $fields = array(
        'enabled' => absint($request->get_param('enabled')) ? 1 : 0,
        'window_minutes' => max(1,min(60,absint($request->get_param('window_minutes') ?: 10))),
        'click_threshold' => max(5,min(10000,absint($request->get_param('click_threshold') ?: 40))),
        'bot_threshold' => max(1,min(10000,absint($request->get_param('bot_threshold') ?: 15))),
        'blocked_threshold' => max(1,min(10000,absint($request->get_param('blocked_threshold') ?: 10))),
        'repeat_threshold' => max(3,min(10000,absint($request->get_param('repeat_threshold') ?: 12))),
        'cooldown_minutes' => max(5,min(1440,absint($request->get_param('cooldown_minutes') ?: 30))),
        'protection_mode' => in_array((string) $request->get_param('protection_mode'), array('standard','balanced','strict'), true) ? (string) $request->get_param('protection_mode') : 'balanced',
        'rate_window' => max(1,min(60,absint($request->get_param('rate_window') ?: 10))),
        'ip_limit' => max(5,min(10000,absint($request->get_param('ip_limit') ?: 60))),
        'network_limit' => max(10,min(20000,absint($request->get_param('network_limit') ?: 180))),
        'fingerprint_limit' => max(5,min(10000,absint($request->get_param('fingerprint_limit') ?: 90))),
        'challenge_enabled' => absint($request->get_param('challenge_enabled')) ? 1 : 0,
        'block_bots' => absint($request->get_param('block_bots')) ? 1 : 0,
        'user_id' => (int) $link['user_id'], 'updated_at' => current_time('mysql'),
    );
    $exists = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t['monitor']} WHERE link_id=%d", $id));
    if ($exists) { $wpdb->update($t['monitor'], $fields, array('link_id'=>$id)); }
    else { $fields['link_id']=$id; $wpdb->insert($t['monitor'],$fields); }
    return sml_ltc_rest_monitor_get($request);
}

function sml_ltc_check_activity($link_id) {
    global $wpdb;
    $t=sml_ltc_tables(); $ct=sml_lit_tables()['clicks'];
    $s=$wpdb->get_row($wpdb->prepare("SELECT * FROM {$t['monitor']} WHERE link_id=%d AND enabled=1",$link_id),ARRAY_A);
    if (!$s) { return; }
    $since=gmdate('Y-m-d H:i:s',time()-(int)$s['window_minutes']*MINUTE_IN_SECONDS+(int)(get_option('gmt_offset')*3600));
    $c=$wpdb->get_row($wpdb->prepare("SELECT COUNT(*) total,SUM(is_bot=1) bots FROM {$ct} WHERE link_id=%d AND created_at >= %s",$link_id,$since),ARRAY_A);
    $b=(int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t['attempts']} WHERE link_id=%d AND created_at >= %s",$link_id,$since));
    $repeat=(int)$wpdb->get_var($wpdb->prepare("SELECT MAX(visits) FROM (SELECT COUNT(*) visits FROM {$ct} WHERE link_id=%d AND created_at >= %s AND server_fp<>'' GROUP BY server_fp) repeated_visitors",$link_id,$since));
    $c=(array)$c;
    $signals=array();
    if ((int)$c['total'] >= (int)$s['click_threshold']) { $signals[]=array('click_burst','Unusual click burst: '.$c['total'].' visits in '.$s['window_minutes'].' minutes.',(int)$c['total']); }
    if ((int)$c['bots'] >= (int)$s['bot_threshold']) { $signals[]=array('bot_preview_spike','Bot or preview activity elevated: '.$c['bots'].' in '.$s['window_minutes'].' minutes.',(int)$c['bots']); }
    if ($b >= (int)$s['blocked_threshold']) { $signals[]=array('blocked_spike','Blocked access attempts elevated: '.$b.' in '.$s['window_minutes'].' minutes.',$b); }
    if ($repeat >= (int)$s['repeat_threshold']) { $signals[]=array('repeat_fingerprint','Repeated activity from one device fingerprint: '.$repeat.' clicks in '.$s['window_minutes'].' minutes.',$repeat); }
    foreach ($signals as $signal) {
        $recent=(int)$wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t['alerts']} WHERE link_id=%d AND alert_type=%s AND created_at >= %s",$link_id,$signal[0],gmdate('Y-m-d H:i:s',time()-(int)$s['cooldown_minutes']*MINUTE_IN_SECONDS+(int)(get_option('gmt_offset')*3600))));
        if ($recent) { continue; }
        $wpdb->insert($t['alerts'],array('link_id'=>$link_id,'alert_type'=>$signal[0],'message'=>$signal[1],'observed'=>$signal[2],'created_at'=>current_time('mysql')),array('%d','%s','%s','%d','%s'));
        $user=get_userdata((int)$s['user_id']);
        if ($user && is_email($user->user_email)) { wp_mail($user->user_email,'StockMarketLoop Link Tracker activity alert',$signal[1]."\nReview this link in Creator Studio → Analytics → Link Tracker. This is an automated signal and does not confirm malicious activity."); }
    }
}
add_action('sml_link_tracker_click_logged', function($event){ if (!empty($event['link_id'])) { sml_ltc_check_activity((int)$event['link_id']); } }, 10, 1);

/* --------------------------------------------------------------- front end */

function sml_ltc_is_analytics_request() {
    if (is_admin() || (defined('REST_REQUEST') && REST_REQUEST)) { return false; }
    $uri = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '';
    $path = strtolower(rawurldecode((string) wp_parse_url($uri, PHP_URL_PATH)));
    return (bool) preg_match('#^/+creator-studio/+analytics/?$#', preg_replace('#/+#', '/', $path));
}

add_action('wp_footer', function () {
    if (!is_user_logged_in()) { return; }
    $tracker_on = function_exists('wp_script_is') && (wp_script_is('sml-lit', 'enqueued') || wp_script_is('sml-lit', 'done'));
    if (!$tracker_on && !sml_ltc_is_analytics_request()) { return; }
    static $printed = false;
    if ($printed) { return; }
    $printed = true;
    $dir = plugin_dir_path(SML_LINK_TRACKER_CONTROLS_FILE);
    $v = SML_LINK_TRACKER_CONTROLS_VERSION . '-' . (int) @filemtime($dir . 'assets/controls.js');
    $cfg = array(
        'rest' => esc_url_raw(rest_url('sml-intel/v1')),
        'nonce' => wp_create_nonce('wp_rest'),
        'isAdmin' => current_user_can('manage_options'),
    );
    echo "\n<!-- SML Link Tracker Controls -->\n";
    echo '<script id="sml-lc-config">window.SML_LINK_TRACKER_CONTROLS=' . wp_json_encode($cfg) . ';</script>' . "\n";
    echo '<link rel="stylesheet" href="' . esc_url(SML_LINK_TRACKER_CONTROLS_URL . 'assets/controls.css?v=' . $v) . '">' . "\n";
    echo '<script src="' . esc_url(SML_LINK_TRACKER_CONTROLS_URL . 'assets/controls.js?v=' . $v) . '" defer></script>' . "\n";
}, 1001);
