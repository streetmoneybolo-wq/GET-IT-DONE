<?php
/**
 * Plugin Name: SML Link Intelligence Tracker
 * Description: Real-time tracked links, click intelligence, and admin-only IP analytics for StockMarketLoop.
 * Version: 1.2.0
 * Author: StockMarketLoop
 */

defined('ABSPATH') || exit;

define('SML_LIT_VERSION', '1.2.0');
define('SML_LIT_REST_NAMESPACE', 'sml-intel/v1');
define('SML_LIT_FILE', __FILE__);
define('SML_LIT_PATH', plugin_dir_path(__FILE__));
define('SML_LIT_URL', plugin_dir_url(__FILE__));

function sml_lit_tables() {
    global $wpdb;
    return array(
        'links'  => $wpdb->prefix . 'sml_tracked_links',
        'clicks' => $wpdb->prefix . 'sml_tracked_link_clicks',
    );
}

function sml_lit_install() {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $t = sml_lit_tables();
    $charset = $wpdb->get_charset_collate();

    dbDelta("CREATE TABLE {$t['links']} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        slug VARCHAR(80) NOT NULL,
        user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
        destination_url TEXT NOT NULL,
        label VARCHAR(190) NOT NULL DEFAULT '',
        preset VARCHAR(60) NOT NULL DEFAULT 'custom',
        campaign VARCHAR(120) NOT NULL DEFAULT '',
        ticker VARCHAR(16) NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        total_clicks BIGINT UNSIGNED NOT NULL DEFAULT 0,
        last_click_at DATETIME NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY slug (slug),
        KEY user_status (user_id,status),
        KEY preset (preset),
        KEY ticker (ticker),
        KEY created_at (created_at)
    ) $charset;");

    dbDelta("CREATE TABLE {$t['clicks']} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        link_id BIGINT UNSIGNED NOT NULL,
        link_owner_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
        visitor_user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
        raw_ip VARBINARY(45) NULL,
        ip_hash CHAR(64) NOT NULL DEFAULT '',
        ip_family VARCHAR(6) NOT NULL DEFAULT '',
        country VARCHAR(80) NOT NULL DEFAULT '',
        region VARCHAR(120) NOT NULL DEFAULT '',
        city VARCHAR(120) NOT NULL DEFAULT '',
        lat DECIMAL(9,6) NULL,
        lng DECIMAL(9,6) NULL,
        latitude DECIMAL(10,7) NULL,
        longitude DECIMAL(10,7) NULL,
        country_code CHAR(2) NOT NULL DEFAULT '',
        timezone VARCHAR(64) NOT NULL DEFAULT '',
        click_key CHAR(24) NOT NULL DEFAULT '',
        server_fp CHAR(64) NOT NULL DEFAULT '',
        client_fp CHAR(64) NOT NULL DEFAULT '',
        fp_json LONGTEXT NULL,
        screen VARCHAR(24) NOT NULL DEFAULT '',
        language VARCHAR(40) NOT NULL DEFAULT '',
        referrer TEXT NULL,
        landing_url TEXT NULL,
        user_agent TEXT NULL,
        device VARCHAR(30) NOT NULL DEFAULT '',
        browser VARCHAR(80) NOT NULL DEFAULT '',
        platform VARCHAR(80) NOT NULL DEFAULT '',
        is_bot TINYINT(1) NOT NULL DEFAULT 0,
        bot_reason VARCHAR(120) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL,
        PRIMARY KEY (id),
        KEY link_created (link_id,created_at),
        KEY owner_created (link_owner_id,created_at),
        KEY ip_hash_created (ip_hash,created_at),
        KEY geo_lat_lng (lat,lng),
        KEY geo_coords (latitude,longitude),
        KEY is_bot (is_bot),
        KEY click_key (click_key),
        KEY client_fp (client_fp),
        KEY server_fp (server_fp)
    ) $charset;");

    update_option('sml_lit_version', SML_LIT_VERSION, false);
    sml_lit_register_rewrites();
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'sml_lit_install');

function sml_lit_deactivate() {
    flush_rewrite_rules();
}
register_deactivation_hook(__FILE__, 'sml_lit_deactivate');

add_action('init', function () {
    if (get_option('sml_lit_version') !== SML_LIT_VERSION) {
        sml_lit_install();
    }
}, 8);

function sml_lit_register_rewrites() {
    add_rewrite_rule('^go/([^/]+)/?$', 'index.php?sml_lit_slug=$matches[1]', 'top');
}
add_action('init', 'sml_lit_register_rewrites');

add_filter('query_vars', function ($vars) {
    $vars[] = 'sml_lit_slug';
    return $vars;
});

function sml_lit_is_admin_viewer() {
    return current_user_can('manage_options');
}

function sml_lit_normalize_url($url) {
    $url = trim((string) $url);
    if ($url === '') return '';
    if (!preg_match('~^https?://~i', $url)) $url = 'https://' . $url;
    $url = esc_url_raw($url);
    if (!$url || !wp_http_validate_url($url)) return '';
    return $url;
}

function sml_lit_slug_base($label, $url) {
    $host = (string) parse_url($url, PHP_URL_HOST);
    $seed = $label ?: $host ?: 'link';
    $seed = sanitize_title($seed);
    return substr($seed ?: 'link', 0, 46);
}

function sml_lit_unique_slug($base) {
    global $wpdb;
    $t = sml_lit_tables();
    $base = substr(sanitize_title($base), 0, 46) ?: 'link';
    for ($i = 0; $i < 20; $i++) {
        $suffix = strtolower(wp_generate_password($i ? 6 : 4, false, false));
        $slug = substr($base . '-' . $suffix, 0, 78);
        $exists = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t['links']} WHERE slug=%s", $slug));
        if (!$exists) return $slug;
    }
    return substr($base . '-' . time(), 0, 78);
}

function sml_lit_client_ip() {
    if (function_exists('sml_gl_client_ip')) {
        $ip = sml_gl_client_ip();
        if ($ip) return $ip;
    }
    $candidates = array();
    $headers = array('HTTP_CF_CONNECTING_IP', 'HTTP_TRUE_CLIENT_IP', 'HTTP_X_REAL_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR');
    foreach ($headers as $header) {
        if (empty($_SERVER[$header])) continue;
        $value = sanitize_text_field(wp_unslash($_SERVER[$header]));
        foreach (explode(',', $value) as $part) {
            $ip = trim($part);
            if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) $candidates[] = $ip;
        }
    }
    return $candidates ? $candidates[0] : '';
}

function sml_lit_ip_hash($ip) {
    $salt = wp_salt('auth');
    return $ip ? hash_hmac('sha256', $ip, $salt) : '';
}

function sml_lit_ip_family($ip) {
    if (!$ip) return '';
    return strpos($ip, ':') !== false ? 'ipv6' : 'ipv4';
}

function sml_lit_geo($ip) {
    $out = array('country' => '', 'country_code' => '', 'region' => '', 'city' => '', 'latitude' => null, 'longitude' => null, 'timezone' => '');
    if (!$ip) return $out;
    // 1) the local city database (has the state / province); 2) the site's shared lookup; 3) CDN headers if the host ever adds them
    if (function_exists('sml_gl_mmdb_path')) {
        $path = sml_gl_mmdb_path();
        $dir  = WPMU_PLUGIN_DIR . '/sml-geoip-reader';
        if (is_readable($path)) {
            if (!class_exists('\\MaxMind\\Db\\Reader')) {
                foreach (array('Reader/InvalidDatabaseException.php', 'Reader/Util.php', 'Reader/Metadata.php', 'Reader/Decoder.php', 'Reader.php') as $f) {
                    if (is_readable($dir . '/' . $f)) require_once $dir . '/' . $f;
                }
            }
            if (class_exists('\\MaxMind\\Db\\Reader')) {
                try {
                    $reader = new \MaxMind\Db\Reader($path);
                    $rec = $reader->get($ip);
                    $reader->close();
                    if (is_array($rec)) {
                        $out['country_code'] = strtoupper(substr((string) ($rec['country']['iso_code'] ?? ''), 0, 2));
                        $out['country'] = substr((string) ($rec['country']['names']['en'] ?? $out['country_code']), 0, 80);
                        $sub = $rec['subdivisions'][0] ?? array();
                        $out['region'] = substr((string) ($sub['names']['en'] ?? ''), 0, 120);
                        $out['city'] = substr((string) ($rec['city']['names']['en'] ?? ''), 0, 120);
                        $la = $rec['location']['latitude'] ?? null; $lo = $rec['location']['longitude'] ?? null;
                        if (is_numeric($la) && is_numeric($lo)) { $out['latitude'] = round((float) $la, 6); $out['longitude'] = round((float) $lo, 6); }
                        $out['timezone'] = substr((string) ($rec['location']['time_zone'] ?? ''), 0, 64);
                    }
                } catch (\Throwable $e) { /* fall through */ }
            }
        }
    }
    if ($out['country_code'] === '' && function_exists('sml_gl_mmdb_lookup')) {
        $g = sml_gl_mmdb_lookup($ip);
        if (is_array($g)) {
            $out['country_code'] = (string) ($g['country'] ?? '');
            $out['country'] = $out['country_code'];
            $out['city'] = (string) ($g['city'] ?? '');
            $out['latitude'] = $g['lat'] ?? null; $out['longitude'] = $g['long'] ?? null;
        }
    }
    if ($out['country_code'] === '' && !empty($_SERVER['HTTP_CF_IPCOUNTRY'])) {
        $out['country_code'] = strtoupper(substr(sanitize_text_field(wp_unslash($_SERVER['HTTP_CF_IPCOUNTRY'])), 0, 2));
        $out['country'] = $out['country_code'];
    }
    return $out;
}

function sml_lit_parse_agent($ua) {
    $ua_l = strtolower((string) $ua);
    $is_bot = preg_match('~bot|crawl|spider|slurp|curl|wget|python|headless|preview|facebookexternalhit|discordbot|telegrambot|twitterbot|linkedinbot|whatsapp~', $ua_l) ? 1 : 0;
    $device = 'desktop';
    if (preg_match('~ipad|tablet~', $ua_l)) $device = 'tablet';
    elseif (preg_match('~mobile|iphone|android~', $ua_l)) $device = 'mobile';

    $browser = 'Unknown';
    if (strpos($ua_l, 'edg/') !== false) $browser = 'Edge';
    elseif (strpos($ua_l, 'chrome/') !== false && strpos($ua_l, 'chromium') === false) $browser = 'Chrome';
    elseif (strpos($ua_l, 'safari/') !== false && strpos($ua_l, 'chrome/') === false) $browser = 'Safari';
    elseif (strpos($ua_l, 'firefox/') !== false) $browser = 'Firefox';
    elseif (strpos($ua_l, 'discordbot') !== false) $browser = 'Discord Bot';
    elseif (strpos($ua_l, 'telegrambot') !== false) $browser = 'Telegram Bot';

    $platform = 'Unknown';
    if (strpos($ua_l, 'windows') !== false) $platform = 'Windows';
    elseif (strpos($ua_l, 'mac os') !== false || strpos($ua_l, 'macintosh') !== false) $platform = 'macOS';
    elseif (strpos($ua_l, 'iphone') !== false || strpos($ua_l, 'ipad') !== false) $platform = 'iOS';
    elseif (strpos($ua_l, 'android') !== false) $platform = 'Android';
    elseif (strpos($ua_l, 'linux') !== false) $platform = 'Linux';

    return array(
        'device' => $device,
        'browser' => $browser,
        'platform' => $platform,
        'is_bot' => $is_bot,
        'bot_reason' => $is_bot ? 'User agent matched bot/preview/crawler pattern' : '',
    );
}

function sml_lit_server_fp() {
    $parts = array();
    foreach (array('HTTP_USER_AGENT', 'HTTP_ACCEPT_LANGUAGE', 'HTTP_ACCEPT_ENCODING', 'HTTP_ACCEPT', 'HTTP_SEC_CH_UA', 'HTTP_SEC_CH_UA_PLATFORM', 'HTTP_SEC_CH_UA_MOBILE', 'HTTP_DNT', 'HTTP_UPGRADE_INSECURE_REQUESTS') as $h) {
        $parts[] = isset($_SERVER[$h]) ? (string) wp_unslash($_SERVER[$h]) : '';
    }
    return hash('sha256', implode('|', $parts));
}

function sml_lit_public_link_url($slug) {
    return home_url('/go/' . rawurlencode($slug) . '/');
}

function sml_lit_create_link($args) {
    global $wpdb;
    $t = sml_lit_tables();
    $user_id = isset($args['user_id']) ? absint($args['user_id']) : get_current_user_id();
    $url = sml_lit_normalize_url($args['destination_url'] ?? '');
    if (!$url) return new WP_Error('invalid_url', 'Enter a valid http or https URL.', array('status' => 400));

    $label = sanitize_text_field($args['label'] ?? '');
    $preset = sanitize_key($args['preset'] ?? 'custom') ?: 'custom';
    $campaign = sanitize_text_field($args['campaign'] ?? '');
    $ticker = strtoupper(substr(preg_replace('/[^A-Z0-9.\-]/', '', (string) ($args['ticker'] ?? '')), 0, 16));
    $slug = !empty($args['slug']) ? sanitize_title($args['slug']) : sml_lit_unique_slug(sml_lit_slug_base($label, $url));
    if (!$slug) $slug = sml_lit_unique_slug('link');

    $now = current_time('mysql');
    $ok = $wpdb->insert($t['links'], array(
        'slug' => $slug,
        'user_id' => $user_id,
        'destination_url' => $url,
        'label' => $label,
        'preset' => $preset,
        'campaign' => $campaign,
        'ticker' => $ticker,
        'status' => 'active',
        'created_at' => $now,
        'updated_at' => $now,
    ), array('%s','%d','%s','%s','%s','%s','%s','%s','%s','%s'));

    if (!$ok) return new WP_Error('insert_failed', 'Could not create tracked link.', array('status' => 500));
    return sml_lit_get_link((int) $wpdb->insert_id);
}

function sml_lit_get_link($id_or_slug) {
    global $wpdb;
    $t = sml_lit_tables();
    if (is_numeric($id_or_slug)) {
        return $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t['links']} WHERE id=%d", absint($id_or_slug)), ARRAY_A);
    }
    return $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t['links']} WHERE slug=%s", sanitize_title($id_or_slug)), ARRAY_A);
}

function sml_lit_link_response($row) {
    if (!$row) return null;
    return array(
        'id' => (int) $row['id'],
        'slug' => $row['slug'],
        'tracked_url' => sml_lit_public_link_url($row['slug']),
        'destination_url' => $row['destination_url'],
        'label' => $row['label'],
        'preset' => $row['preset'],
        'campaign' => $row['campaign'],
        'ticker' => $row['ticker'],
        'status' => $row['status'],
        'total_clicks' => (int) $row['total_clicks'],
        'last_click_at' => $row['last_click_at'],
        'created_at' => $row['created_at'],
        'user_id' => (int) $row['user_id'],
    );
}

function sml_lit_log_click($link, $is_bot_hint = null) {
    global $wpdb;
    $t = sml_lit_tables();
    $ip = sml_lit_client_ip();
    $ua = isset($_SERVER['HTTP_USER_AGENT']) ? substr(sanitize_textarea_field(wp_unslash($_SERVER['HTTP_USER_AGENT'])), 0, 1000) : '';
    $ref = isset($_SERVER['HTTP_REFERER']) ? substr(esc_url_raw(wp_unslash($_SERVER['HTTP_REFERER'])), 0, 1000) : '';
    $landing = home_url(wp_unslash($_SERVER['REQUEST_URI'] ?? ''));
    $geo = sml_lit_geo($ip);
    $agent = sml_lit_parse_agent($ua);
    $now = current_time('mysql');
    $key = strtolower(wp_generate_password(24, false, false));
    $lang = isset($_SERVER['HTTP_ACCEPT_LANGUAGE']) ? substr(sanitize_text_field(wp_unslash($_SERVER['HTTP_ACCEPT_LANGUAGE'])), 0, 40) : '';

    $row = array(
        'link_id' => (int) $link['id'],
        'link_owner_id' => (int) $link['user_id'],
        'visitor_user_id' => (int) get_current_user_id(),
        'raw_ip' => $ip,
        'ip_hash' => sml_lit_ip_hash($ip),
        'ip_family' => sml_lit_ip_family($ip),
        'country' => $geo['country'],
        'country_code' => $geo['country_code'],
        'region' => $geo['region'],
        'city' => $geo['city'],
        'timezone' => $geo['timezone'],
        'click_key' => $key,
        'server_fp' => sml_lit_server_fp(),
        'language' => $lang,
        'referrer' => $ref,
        'landing_url' => $landing,
        'user_agent' => $ua,
        'device' => $agent['device'],
        'browser' => $agent['browser'],
        'platform' => $agent['platform'],
        'is_bot' => $agent['is_bot'],
        'bot_reason' => $agent['bot_reason'],
        'created_at' => $now,
    );
    $formats = array('%d','%d','%d','%s','%s','%s','%s','%s','%s','%s','%s','%s','%s','%s','%s','%s','%s','%s','%s','%s','%d','%s','%s');
    if ($geo['latitude'] !== null && $geo['longitude'] !== null) {
        $row['lat'] = $geo['latitude'];
        $row['lng'] = $geo['longitude'];
        $row['latitude'] = $geo['latitude'];
        $row['longitude'] = $geo['longitude'];
        $formats[] = '%f';
        $formats[] = '%f';
        $formats[] = '%f';
        $formats[] = '%f';
    }
    $wpdb->insert($t['clicks'], $row, $formats);

    $click_id = (int) $wpdb->insert_id;
    if ($click_id && !$agent['is_bot']) {
        $wpdb->query($wpdb->prepare("UPDATE {$t['links']} SET total_clicks=total_clicks+1, last_click_at=%s, updated_at=%s WHERE id=%d", $now, $now, (int) $link['id']));
    } elseif ($click_id) {
        $wpdb->query($wpdb->prepare("UPDATE {$t['links']} SET last_click_at=%s, updated_at=%s WHERE id=%d", $now, $now, (int) $link['id']));
    }

    do_action('sml_link_tracker_click_logged', array(
        'click_id' => $click_id,
        'link_id' => (int) $link['id'],
        'link_owner_id' => (int) $link['user_id'],
        'slug' => $link['slug'],
        'preset' => $link['preset'],
        'ticker' => $link['ticker'],
        'campaign' => $link['campaign'],
        'ip_hash' => sml_lit_ip_hash($ip),
        'raw_ip_admin_only' => $ip,
        'created_at' => $now,
    ));
    return array('id' => $click_id, 'key' => $key, 'is_bot' => (int) $agent['is_bot'], 'is_bot_reason' => $agent['bot_reason']);
}

/** Tiny page for real browsers: read non-invasive device signals, hand them to the tracker, then continue to the destination. Everything else gets a plain 302. */
function sml_lit_interstitial($dest, $key) {
    nocache_headers();
    header('Content-Type: text/html; charset=utf-8');
    header('X-Robots-Tag: noindex, nofollow');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    $d = esc_url($dest);
    $endpoint = esc_url_raw(rest_url(SML_LIT_REST_NAMESPACE . '/fp'));
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Redirecting…</title>';
    echo '<noscript><meta http-equiv="refresh" content="0;url=' . $d . '"></noscript>';
    echo '<style>html,body{height:100%;margin:0;background:#070c15;color:#9fb2c7;font:14px system-ui,sans-serif}body{display:grid;place-items:center}a{color:#5b9bff}</style></head><body>';
    echo '<p>Taking you there… <a href="' . $d . '" rel="noreferrer">continue</a></p>';
    echo '<script>(function(){var D=' . wp_json_encode($dest) . ',K=' . wp_json_encode($key) . ',E=' . wp_json_encode($endpoint) . ',gone=false;';
    echo 'function go(){if(gone)return;gone=true;location.replace(D)}';
    echo 'setTimeout(go,1200);';
    echo 'try{var n=navigator,s=screen,f={};';
    echo 'f.tz=Intl.DateTimeFormat().resolvedOptions().timeZone||"";f.tzo=new Date().getTimezoneOffset();f.lang=(n.languages||[n.language]).join(",");f.plat=n.platform||"";';
    echo 'f.sw=s.width;f.sh=s.height;f.aw=s.availWidth;f.ah=s.availHeight;f.dpr=window.devicePixelRatio||1;f.cd=s.colorDepth;f.vw=innerWidth;f.vh=innerHeight;';
    echo 'f.hc=n.hardwareConcurrency||0;f.dm=n.deviceMemory||0;f.tp=n.maxTouchPoints||0;f.ck=n.cookieEnabled?1:0;f.dnt=n.doNotTrack||"";f.pl=(n.plugins||[]).length;';
    echo 'if(n.userAgentData){f.uam=n.userAgentData.mobile?1:0;f.uap=n.userAgentData.platform||"";f.uab=(n.userAgentData.brands||[]).map(function(b){return b.brand+" "+b.version}).join(", ")}';
    echo 'if(n.connection){f.net=n.connection.effectiveType||""}';
    echo 'try{var c=document.createElement("canvas");c.width=200;c.height=40;var x=c.getContext("2d");x.textBaseline="top";x.font="14px Arial";x.fillStyle="#f60";x.fillRect(10,5,80,20);x.fillStyle="#069";x.fillText("SML fp \u00e9\u4e2d\ud83d\ude00",4,12);f.cv=c.toDataURL().slice(-64)}catch(e){}';
    echo 'try{var g=document.createElement("canvas").getContext("webgl");if(g){var e2=g.getExtension("WEBGL_debug_renderer_info");f.gv=e2?g.getParameter(e2.UNMASKED_VENDOR_WEBGL):g.getParameter(g.VENDOR);f.gr=e2?g.getParameter(e2.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)}}catch(e){}';
    echo 'var stable=[f.plat,f.sw,f.sh,f.dpr,f.cd,f.hc,f.dm,f.tp,f.tz,f.lang,f.cv,f.gv,f.gr].join("|");';
    echo 'function post(h){f.h=h;var b=JSON.stringify({k:K,f:f});try{if(!(n.sendBeacon&&n.sendBeacon(E,new Blob([b],{type:"text/plain"}))))throw 0}catch(e){fetch(E,{method:"POST",body:b,keepalive:true,headers:{"Content-Type":"text/plain"}}).catch(function(){})}setTimeout(go,60)}';
    echo 'if(window.crypto&&crypto.subtle&&window.TextEncoder){crypto.subtle.digest("SHA-256",new TextEncoder().encode(stable)).then(function(a){post(Array.prototype.map.call(new Uint8Array(a),function(x){return("0"+x.toString(16)).slice(-2)}).join(""))}).catch(function(){post("")})}else{post("")}';
    echo '}catch(e){go()}})();</script></body></html>';
    exit;
}

add_action('template_redirect', function () {
    $slug = get_query_var('sml_lit_slug');
    if (!$slug) return;
    if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
    nocache_headers();
    header('X-Robots-Tag: noindex, nofollow');
    $link = sml_lit_get_link($slug);
    if (!$link || $link['status'] !== 'active') {
        status_header(404);
        echo esc_html__('Tracked link not found.', 'sml-lit');
        exit;
    }
    // Only web destinations; the stored URL is re-validated because rows can be edited elsewhere.
    $dest = sml_lit_normalize_url($link['destination_url']);
    if (!$dest) { status_header(404); echo esc_html__('Tracked link not found.', 'sml-lit'); exit; }
    $click = sml_lit_log_click($link);
    $accept = isset($_SERVER['HTTP_ACCEPT']) ? (string) $_SERVER['HTTP_ACCEPT'] : '';
    $purpose = strtolower((string) ($_SERVER['HTTP_SEC_PURPOSE'] ?? $_SERVER['HTTP_PURPOSE'] ?? ''));
    $human = empty($click['is_bot']) && false !== strpos($accept, 'text/html') && false === strpos($purpose, 'prefetch') && (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET');
    if ($human && !empty($click['key'])) sml_lit_interstitial($dest, $click['key']);
    // Crawlers and link-preview bots get a plain redirect so the destination's own preview still works. wp_redirect, not wp_safe_redirect: the destination is by design an external site.
    wp_redirect($dest, 302, 'StockMarketLoop Link Intelligence');
    exit;
}, 0);

function sml_lit_permission_logged_in() {
    return is_user_logged_in();
}

function sml_lit_permission_admin() {
    return sml_lit_is_admin_viewer();
}

function sml_lit_register_rest_routes_for_namespace($namespace) {
    register_rest_route($namespace, '/links', array(
        array(
            'methods' => WP_REST_Server::READABLE,
            'permission_callback' => 'sml_lit_permission_logged_in',
            'callback' => 'sml_lit_rest_links',
        ),
        array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => 'sml_lit_permission_logged_in',
            'callback' => 'sml_lit_rest_create_link',
        ),
    ));

    register_rest_route($namespace, '/links/(?P<id>\d+)/analytics', array(
        'methods' => WP_REST_Server::READABLE,
        'permission_callback' => 'sml_lit_permission_logged_in',
        'callback' => 'sml_lit_rest_link_analytics',
    ));

    register_rest_route($namespace, '/fp', array(
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => 'sml_lit_rest_fp',
    ));

    register_rest_route($namespace, '/admin/live', array(
        'methods' => WP_REST_Server::READABLE,
        'permission_callback' => 'sml_lit_permission_admin',
        'callback' => 'sml_lit_rest_admin_live',
    ));
}

add_action('rest_api_init', function () {
    sml_lit_register_rest_routes_for_namespace(SML_LIT_REST_NAMESPACE);
    sml_lit_register_rest_routes_for_namespace('sml-link-tracker/v1');
});

/** Device signals from the redirect page. Accepts only a key issued in the last few minutes, once. */
function sml_lit_rest_fp(WP_REST_Request $request) {
    global $wpdb;
    $t = sml_lit_tables();
    $raw = $request->get_body();
    $in = json_decode((string) $raw, true);
    $key = is_array($in) ? preg_replace('/[^a-z0-9]/', '', strtolower((string) ($in['k'] ?? ''))) : '';
    $f = is_array($in) && is_array($in['f'] ?? null) ? $in['f'] : array();
    if (strlen($key) !== 24 || !$f) return new WP_REST_Response(array('ok' => false), 202);
    $clean = array();
    foreach ($f as $k => $v) {
        $k = preg_replace('/[^a-z0-9]/i', '', (string) $k);
        if ($k === '' || strlen($k) > 6) continue;
        $clean[$k] = is_scalar($v) ? substr((string) $v, 0, 160) : '';
    }
    $hash = preg_match('/^[a-f0-9]{64}$/', (string) ($clean['h'] ?? '')) ? $clean['h'] : hash('sha256', wp_json_encode($clean));
    $screen = isset($clean['sw'], $clean['sh']) ? substr($clean['sw'] . 'x' . $clean['sh'], 0, 24) : '';
    $updated = $wpdb->query($wpdb->prepare(
        "UPDATE {$t['clicks']} SET client_fp=%s, fp_json=%s, screen=%s, timezone=IF(%s<>'', %s, timezone) WHERE click_key=%s AND client_fp='' AND created_at >= %s",
        $hash, wp_json_encode($clean), $screen, (string) ($clean['tz'] ?? ''), (string) ($clean['tz'] ?? ''), $key, gmdate('Y-m-d H:i:s', time() - 600 + (int) (get_option('gmt_offset') * 3600))
    ));
    return new WP_REST_Response(array('ok' => (bool) $updated), 200);
}

function sml_lit_rest_create_link(WP_REST_Request $request) {
    $created = sml_lit_create_link(array(
        'destination_url' => $request->get_param('destination_url'),
        'label' => $request->get_param('label'),
        'preset' => $request->get_param('preset'),
        'campaign' => $request->get_param('campaign'),
        'ticker' => $request->get_param('ticker'),
        'user_id' => get_current_user_id(),
    ));
    if (is_wp_error($created)) return $created;
    return rest_ensure_response(sml_lit_link_response($created));
}

function sml_lit_rest_links(WP_REST_Request $request) {
    global $wpdb;
    $t = sml_lit_tables();
    $limit = max(1, min(100, absint($request->get_param('limit') ?: 25)));
    $user_id = get_current_user_id();
    if (sml_lit_is_admin_viewer() && $request->get_param('user_id')) {
        $user_id = absint($request->get_param('user_id'));
    }
    if (sml_lit_is_admin_viewer() && $request->get_param('sitewide')) {
        $rows = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t['links']} ORDER BY updated_at DESC LIMIT %d", $limit), ARRAY_A);
    } else {
        $rows = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t['links']} WHERE user_id=%d ORDER BY updated_at DESC LIMIT %d", $user_id, $limit), ARRAY_A);
    }
    return rest_ensure_response(array_map('sml_lit_link_response', $rows));
}

function sml_lit_click_public_row($row, $include_ip = false) {
    $out = array(
        'id' => (int) $row['id'],
        'link_id' => (int) $row['link_id'],
        'link_owner_id' => (int) $row['link_owner_id'],
        'owner_user_id' => (int) $row['link_owner_id'],
        'visitor_user_id' => (int) $row['visitor_user_id'],
        'ip_hash' => $row['ip_hash'],
        'ip_family' => $row['ip_family'],
        'country' => $row['country'],
        'region' => $row['region'],
        'city' => $row['city'],
        'referrer' => $row['referrer'],
        'landing_url' => $row['landing_url'],
        'country_code' => $row['country_code'] ?? '',
        'timezone' => $row['timezone'] ?? '',
        'screen' => $row['screen'] ?? '',
        'language' => $row['language'] ?? '',
        'device' => $row['device'],
        'browser' => $row['browser'],
        'platform' => $row['platform'],
        'is_bot' => (bool) $row['is_bot'],
        'bot_reason' => $row['bot_reason'],
        'created_at' => $row['created_at'],
    );
    if ($include_ip) {
        $out['raw_ip'] = $row['raw_ip'];
        $out['user_agent'] = $row['user_agent'];
        $out['server_fp'] = $row['server_fp'] ?? '';
        $out['client_fp'] = $row['client_fp'] ?? '';
        $out['fingerprint'] = !empty($row['fp_json']) ? json_decode((string) $row['fp_json'], true) : null;
        $lat = isset($row['lat']) && $row['lat'] !== null ? (float) $row['lat'] : (isset($row['latitude']) && $row['latitude'] !== null ? (float) $row['latitude'] : null);
        $lng = isset($row['lng']) && $row['lng'] !== null ? (float) $row['lng'] : (isset($row['longitude']) && $row['longitude'] !== null ? (float) $row['longitude'] : null);
        $out['lat'] = $lat;
        $out['lng'] = $lng;
        $out['latitude'] = $lat;
        $out['longitude'] = $lng;
    }
    return $out;
}

function sml_lit_rest_link_analytics(WP_REST_Request $request) {
    global $wpdb;
    $t = sml_lit_tables();
    $id = absint($request['id']);
    $link = sml_lit_get_link($id);
    if (!$link) return new WP_Error('not_found', 'Tracked link not found.', array('status' => 404));
    $is_admin = sml_lit_is_admin_viewer();
    if (!$is_admin && (int) $link['user_id'] !== get_current_user_id()) {
        return new WP_Error('forbidden', 'You can only view analytics for your own links.', array('status' => 403));
    }
    $limit = max(1, min(250, absint($request->get_param('limit') ?: 100)));
    $clicks = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t['clicks']} WHERE link_id=%d ORDER BY created_at DESC LIMIT %d", $id, $limit), ARRAY_A);
    $summary = array(
        'total_clicks' => (int) $link['total_clicks'],
        'unique_visitors' => (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(DISTINCT ip_hash) FROM {$t['clicks']} WHERE link_id=%d AND ip_hash<>''", $id)),
        'bot_clicks' => (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t['clicks']} WHERE link_id=%d AND is_bot=1", $id)),
        'unique_devices' => (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(DISTINCT IF(client_fp<>'', client_fp, server_fp)) FROM {$t['clicks']} WHERE link_id=%d AND is_bot=0", $id)),
    );
    return rest_ensure_response(array(
        'link' => sml_lit_link_response($link),
        'summary' => $summary,
        'admin_ip_visible' => $is_admin,
        'clicks' => array_map(function ($row) use ($is_admin) {
            return sml_lit_click_public_row($row, $is_admin);
        }, $clicks),
    ));
}

function sml_lit_rest_admin_live(WP_REST_Request $request) {
    global $wpdb;
    $t = sml_lit_tables();
    $limit = max(1, min(200, absint($request->get_param('limit') ?: 100)));
    $owner = absint($request->get_param('owner') ?: $request->get_param('user_id') ?: 0);
    $since = absint($request->get_param('since') ?: 0);
    $where = array('1=1');
    $params = array();
    if ($owner) {
        $where[] = 'c.link_owner_id=%d';
        $params[] = $owner;
    }
    if ($since) {
        $where[] = 'c.id>%d';
        $params[] = $since;
    }
    $params[] = $limit;
    $sql = "SELECT c.*, l.slug, l.destination_url, l.label, l.preset, l.campaign, l.ticker FROM {$t['clicks']} c JOIN {$t['links']} l ON c.link_id=l.id WHERE " . implode(' AND ', $where) . ' ORDER BY c.id DESC LIMIT %d';
    $rows = $wpdb->get_results($wpdb->prepare($sql, $params), ARRAY_A);
    $response = rest_ensure_response(array(
        'admin_ip_visible' => true,
        'clicks' => array_map(function ($row) {
            $out = sml_lit_click_public_row($row, true);
            $out['slug'] = $row['slug'];
            $out['tracked_url'] = sml_lit_public_link_url($row['slug']);
            $out['destination_url'] = $row['destination_url'];
            $out['label'] = $row['label'];
            $out['preset'] = $row['preset'];
            $out['campaign'] = $row['campaign'];
            $out['ticker'] = $row['ticker'];
            return $out;
        }, $rows),
    ));
    $response->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    $response->header('Pragma', 'no-cache');
    return $response;
}

function sml_lit_enqueue_assets() {
    wp_enqueue_style('sml-lit', SML_LIT_URL . 'assets/sml-link-intelligence-tracker.css', array(), SML_LIT_VERSION);
    wp_enqueue_script('sml-lit', SML_LIT_URL . 'assets/sml-link-intelligence-tracker.js', array(), SML_LIT_VERSION, true);
    wp_localize_script('sml-lit', 'SML_LIT', array(
        'rest' => esc_url_raw(rest_url(SML_LIT_REST_NAMESPACE)),
        'nonce' => wp_create_nonce('wp_rest'),
        'isAdmin' => sml_lit_is_admin_viewer(),
    ));
}

function sml_lit_is_creator_analytics_request() {
    if (is_admin() || (defined('REST_REQUEST') && REST_REQUEST) || (defined('DOING_AJAX') && DOING_AJAX)) return false;
    $uri = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '';
    if (false !== strpos($uri, '/wp-json/') || false !== strpos($uri, '/wp-admin/')) return false;
    $path = strtolower(rawurldecode((string) wp_parse_url($uri, PHP_URL_PATH)));
    $path = preg_replace('#/+#', '/', $path);
    return (bool) preg_match('#^/creator-studio/analytics/?$#', $path);
}

// The analytics-page mount is owned by the companion "SML Link Tracker
// Analytics Tab Fix" plugin whenever it is active; a second installer here
// would race it for the same nav slot.
add_action('wp_enqueue_scripts', function () {
    if (defined('SML_LIT_FIX_VERSION')) return;
    if (!is_user_logged_in() || !sml_lit_is_creator_analytics_request()) return;
    sml_lit_enqueue_assets();
}, 99);

add_action('wp_footer', function () {
    if (defined('SML_LIT_FIX_VERSION')) return;
    if (!is_user_logged_in() || !sml_lit_is_creator_analytics_request()) return;
    static $printed = false;
    if ($printed) return;
    $printed = true;
    $cfg = array(
        'rest' => esc_url_raw(rest_url(SML_LIT_REST_NAMESPACE)),
        'nonce' => wp_create_nonce('wp_rest'),
        'isAdmin' => sml_lit_is_admin_viewer(),
    );
    echo "\n<!-- SML Link Intelligence Tracker analytics dashboard mount -->\n";
    echo '<script id="sml-lit-force-config">window.SML_LIT=' . wp_json_encode($cfg) . ';</script>' . "\n";
    echo '<link rel="stylesheet" id="sml-lit-force-css" href="' . esc_url(SML_LIT_URL . 'assets/sml-link-intelligence-tracker.css?v=' . SML_LIT_VERSION . '-' . time()) . '">' . "\n";
    echo '<script id="sml-lit-force-js" src="' . esc_url(SML_LIT_URL . 'assets/sml-link-intelligence-tracker.js?v=' . SML_LIT_VERSION . '-' . time()) . '"></script>' . "\n";
}, 999);

function sml_lit_user_shortcode() {
    if (!is_user_logged_in()) {
        return '<div class="sml-lit-card"><h2>Sign in required</h2><p>Create an account or sign in to build tracked StockMarketLoop links.</p></div>';
    }
    sml_lit_enqueue_assets();
    ob_start(); ?>
    <section class="sml-lit" data-sml-lit="user">
        <div class="sml-lit-hero">
            <p class="sml-lit-kicker">StockMarketLoop Link Intelligence</p>
            <h1>Track any link in real time</h1>
            <p>Create tracked links for articles, Discord invites, SEC filings, videos, Substack posts, checkout pages, campaigns, and ticker stories.</p>
        </div>
        <form class="sml-lit-form" data-lit-create>
            <input name="destination_url" type="url" placeholder="Paste any URL, including Discord invite links" required>
            <select name="preset">
                <option value="stock-news">Stock News Link</option>
                <option value="discord-invite">Discord Invite Link</option>
                <option value="social-campaign">Social Campaign Link</option>
                <option value="substack-blog">Substack / Blog Link</option>
                <option value="video">YouTube / Video Link</option>
                <option value="sec-filing">SEC Filing Link</option>
                <option value="earnings-report">Earnings Report Link</option>
                <option value="checkout">Product / Checkout Link</option>
                <option value="custom">Custom Link</option>
            </select>
            <input name="label" placeholder="Link label">
            <input name="ticker" placeholder="Ticker, optional">
            <input name="campaign" placeholder="Campaign, optional">
            <button type="submit">Create Tracker</button>
        </form>
        <div class="sml-lit-status" data-lit-status></div>
        <div class="sml-lit-grid" data-lit-links></div>
    </section>
    <?php return ob_get_clean();
}
add_shortcode('sml_link_tracker', 'sml_lit_user_shortcode');

function sml_lit_admin_shortcode() {
    if (!sml_lit_is_admin_viewer()) {
        return '<div class="sml-lit-card"><h2>Admin only</h2><p>Only admin accounts can view site-wide link intelligence and raw IP analytics.</p></div>';
    }
    sml_lit_enqueue_assets();
    ob_start(); ?>
    <section class="sml-lit sml-lit-admin" data-sml-lit="admin">
        <div class="sml-lit-hero">
            <p class="sml-lit-kicker">Admin forensic analytics</p>
            <h1>Live site-wide link clicks</h1>
            <p>Raw IP addresses are visible here only because this account has admin permission. Normal users never receive raw IPs from the API.</p>
        </div>
        <p>The unified Pulse map now owns live click locations, owner filtering, and the recent-click table.</p>
        <div class="sml-lit-toolbar">
            <input data-lit-user-filter placeholder="Optional link owner user ID">
            <button data-lit-open-pulse>Open Live click map</button>
        </div>
        <div class="sml-lit-status" data-lit-pulse-status></div>
    </section>
    <?php return ob_get_clean();
}
add_shortcode('sml_link_tracker_admin', 'sml_lit_admin_shortcode');

if (defined('WP_CLI') && WP_CLI) {
    WP_CLI::add_command('sml-intel backfill-coordinates', function ($args, $assoc_args) {
        global $wpdb;
        $t = sml_lit_tables();
        $days = max(1, min(30, absint($assoc_args['days'] ?? 30)));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, raw_ip FROM {$t['clicks']} WHERE created_at >= DATE_SUB(NOW(), INTERVAL %d DAY) AND (lat IS NULL OR lng IS NULL) ORDER BY id ASC",
            $days
        ), ARRAY_A);
        $updated = 0;
        $unresolved = 0;
        foreach ($rows as $row) {
            $geo = sml_lit_geo((string) $row['raw_ip']);
            if ($geo['latitude'] === null || $geo['longitude'] === null) {
                $unresolved++;
                continue;
            }
            $ok = $wpdb->update(
                $t['clicks'],
                array(
                    'lat' => $geo['latitude'],
                    'lng' => $geo['longitude'],
                    'latitude' => $geo['latitude'],
                    'longitude' => $geo['longitude'],
                ),
                array('id' => (int) $row['id']),
                array('%f', '%f', '%f', '%f'),
                array('%d')
            );
            if ($ok !== false) $updated++;
        }
        WP_CLI::success(sprintf('Backfill complete: %d updated, %d unresolved, %d inspected.', $updated, $unresolved, count($rows)));
    });
}
