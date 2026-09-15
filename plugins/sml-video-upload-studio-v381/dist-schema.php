<?php
/**
 * Loop Distribution - schema, migrations and secret storage.
 *
 * Social auto-share, SEO generation and preview cards for Loop Letters,
 * videos and live streams.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SML_DIST_DB_VERSION', '1.0.1');

if (!function_exists('sml_dist_table')) {
    function sml_dist_table($name) {
        global $wpdb;
        return $wpdb->prefix . 'sml_dist_' . $name;
    }
}

if (!function_exists('sml_dist_install')) {
    function sml_dist_install() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();

        $accounts  = sml_dist_table('accounts');
        $rules     = sml_dist_table('rules');
        $queue     = sml_dist_table('queue');
        $variants  = sml_dist_table('variants');
        $cards     = sml_dist_table('cards');
        $clicks    = sml_dist_table('clicks');
        $daily     = sml_dist_table('daily');
        $trials    = sml_dist_table('trials');
        $templates = sml_dist_table('templates');

        // Tokens are never stored here in the clear. access_ref points into the
        // encrypted secret store; see sml_dist_secret_put().
        dbDelta("CREATE TABLE $accounts (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            platform VARCHAR(24) NOT NULL,
            remote_id VARCHAR(191) NOT NULL,
            handle VARCHAR(191) NOT NULL,
            display_name VARCHAR(191) NULL,
            avatar_url TEXT NULL,
            instance_url VARCHAR(255) NULL,
            scopes TEXT NULL,
            access_ref VARCHAR(64) NOT NULL,
            refresh_ref VARCHAR(64) NULL,
            expires_at DATETIME NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'active',
            last_error TEXT NULL,
            last_verified DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY user_platform_remote (user_id, platform, remote_id),
            KEY user_status (user_id, status),
            KEY expiring (status, expires_at)
        ) $charset;");

        dbDelta("CREATE TABLE $rules (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            event_type VARCHAR(32) NOT NULL,
            account_id BIGINT UNSIGNED NOT NULL,
            enabled TINYINT(1) NOT NULL DEFAULT 1,
            delay_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            template_id BIGINT UNSIGNED NULL,
            quiet_start TIME NULL,
            quiet_end TIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY rule (user_id, event_type, account_id),
            KEY lookup (user_id, event_type, enabled)
        ) $charset;");

        // variant_json is frozen at enqueue time. Editing a letter after the
        // post is queued must not silently change what goes out.
        dbDelta("CREATE TABLE $queue (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            account_id BIGINT UNSIGNED NULL,
            platform VARCHAR(24) NOT NULL,
            entity_type VARCHAR(24) NOT NULL,
            entity_id BIGINT UNSIGNED NOT NULL,
            event_type VARCHAR(32) NOT NULL,
            variant_json LONGTEXT NOT NULL,
            card_id BIGINT UNSIGNED NULL,
            share_token VARCHAR(32) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'queued',
            attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
            run_at DATETIME NOT NULL,
            locked_until DATETIME NULL,
            remote_post_id VARCHAR(191) NULL,
            permalink VARCHAR(255) NULL,
            error_code VARCHAR(64) NULL,
            error_message TEXT NULL,
            idempotency_key VARCHAR(191) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            sent_at DATETIME NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY idem (idempotency_key),
            UNIQUE KEY token (share_token),
            KEY drain (status, run_at),
            KEY entity (entity_type, entity_id),
            KEY user_time (user_id, created_at)
        ) $charset;");

        dbDelta("CREATE TABLE $variants (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            entity_type VARCHAR(24) NOT NULL,
            entity_id BIGINT UNSIGNED NOT NULL,
            event_type VARCHAR(32) NOT NULL,
            platform VARCHAR(24) NOT NULL,
            seed TINYINT UNSIGNED NOT NULL DEFAULT 0,
            caption TEXT NOT NULL,
            hook VARCHAR(255) NULL,
            cta VARCHAR(255) NULL,
            hashtags TEXT NULL,
            symbols VARCHAR(191) NULL,
            char_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            edited TINYINT(1) NOT NULL DEFAULT 0,
            content_hash CHAR(40) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY variant (entity_type, entity_id, event_type, platform, seed),
            KEY stale (content_hash)
        ) $charset;");

        dbDelta("CREATE TABLE $cards (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            entity_type VARCHAR(24) NOT NULL,
            entity_id BIGINT UNSIGNED NOT NULL,
            template VARCHAR(32) NOT NULL,
            aspect VARCHAR(12) NOT NULL,
            width SMALLINT UNSIGNED NOT NULL,
            height SMALLINT UNSIGNED NOT NULL,
            attachment_id BIGINT UNSIGNED NULL,
            url VARCHAR(255) NULL,
            content_hash CHAR(40) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY card (entity_type, entity_id, template, aspect),
            KEY hash (content_hash)
        ) $charset;");

        dbDelta("CREATE TABLE $clicks (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            share_token VARCHAR(32) NOT NULL,
            platform VARCHAR(24) NOT NULL,
            entity_type VARCHAR(24) NOT NULL,
            entity_id BIGINT UNSIGNED NOT NULL,
            session_key VARCHAR(64) NOT NULL,
            referrer VARCHAR(255) NULL,
            ua_class VARCHAR(24) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY once (share_token, session_key),
            KEY token_time (share_token, created_at),
            KEY entity (entity_type, entity_id)
        ) $charset;");

        dbDelta("CREATE TABLE $daily (
            user_id BIGINT UNSIGNED NOT NULL,
            day DATE NOT NULL,
            platform VARCHAR(24) NOT NULL,
            posts_sent INT UNSIGNED NOT NULL DEFAULT 0,
            posts_failed INT UNSIGNED NOT NULL DEFAULT 0,
            clicks INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY  (user_id, day, platform)
        ) $charset;");

        dbDelta("CREATE TABLE $trials (
            user_id BIGINT UNSIGNED NOT NULL,
            started_at DATETIME NOT NULL,
            ends_at DATETIME NOT NULL,
            tier VARCHAR(24) NOT NULL DEFAULT 'trial',
            converted_at DATETIME NULL,
            ended_reason VARCHAR(32) NULL,
            posts_used INT UNSIGNED NOT NULL DEFAULT 0,
            peak_platforms TINYINT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY  (user_id),
            KEY expiring (tier, ends_at)
        ) $charset;");

        dbDelta("CREATE TABLE $templates (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            platform VARCHAR(24) NOT NULL,
            event_type VARCHAR(32) NOT NULL,
            label VARCHAR(80) NOT NULL,
            body TEXT NOT NULL,
            is_default TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY user_plat (user_id, platform, event_type)
        ) $charset;");

        update_option('sml_dist_db_version', SML_DIST_DB_VERSION, false);
    }
}

if (!function_exists('sml_dist_maybe_upgrade')) {
    function sml_dist_maybe_upgrade() {
        if (get_option('sml_dist_db_version') === SML_DIST_DB_VERSION) {
            return;
        }
        sml_dist_install();
    }
}
add_action('init', 'sml_dist_maybe_upgrade', 8);

/* ==================================================================
 * Platform registry
 * ================================================================== */

if (!function_exists('sml_dist_platforms')) {
    /**
     * tier A = postable today, B = needs credentials/approval, C = no write API.
     */
    function sml_dist_platforms() {
        return array(
            'bluesky' => array(
                'label' => 'Bluesky', 'tier' => 'A', 'budget' => 300, 'tags' => 2,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://bsky.app/intent/compose?text=',
            ),
            'mastodon' => array(
                'label' => 'Mastodon', 'tier' => 'A', 'budget' => 500, 'tags' => 3,
                'link_cost' => 23, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => '',
            ),
            'x' => array(
                'label' => 'X', 'tier' => 'B', 'budget' => 280, 'tags' => 2,
                'link_cost' => 23, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://x.com/intent/post?text=',
            ),
            'facebook' => array(
                'label' => 'Facebook', 'tier' => 'B', 'budget' => 2000, 'tags' => 3,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://www.facebook.com/sharer/sharer.php?u=',
            ),
            'instagram' => array(
                'label' => 'Instagram', 'tier' => 'B', 'budget' => 2200, 'tags' => 15,
                'link_cost' => 0, 'symbol' => 'hashtag', 'needs_image' => true,
                'compose' => '',
            ),
            'threads' => array(
                'label' => 'Threads', 'tier' => 'B', 'budget' => 500, 'tags' => 5,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://www.threads.net/intent/post?text=',
            ),
            'linkedin' => array(
                'label' => 'LinkedIn', 'tier' => 'B', 'budget' => 3000, 'tags' => 3,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://www.linkedin.com/feed/?shareActive=true&text=',
            ),
            'reddit' => array(
                'label' => 'Reddit', 'tier' => 'C', 'budget' => 4000, 'tags' => 0,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://www.reddit.com/submit?url=',
            ),
            'moomoo' => array(
                'label' => 'moomoo Community', 'tier' => 'C', 'budget' => 5000, 'tags' => 0,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://www.moomoo.com/community',
            ),
            'yahoo_finance' => array(
                'label' => 'Yahoo Finance Community', 'tier' => 'C', 'budget' => 5000, 'tags' => 0,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://finance.yahoo.com/community/u/stockmarketloop/#posts',
            ),
            'webull' => array(
                'label' => 'Webull Community', 'tier' => 'C', 'budget' => 5000, 'tags' => 0,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://app.webull.com/stocks',
            ),
            'etoro' => array(
                'label' => 'eToro News Feed', 'tier' => 'C', 'budget' => 5000, 'tags' => 0,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://www.etoro.com/feed/',
            ),
            'quora' => array(
                'label' => 'Quora Profile', 'tier' => 'C', 'budget' => 10000, 'tags' => 0,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://www.quora.com/profile/StockMarketLoop',
            ),
            'pinterest' => array(
                'label' => 'Pinterest', 'tier' => 'B', 'budget' => 1100, 'tags' => 0,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => true,
                'compose' => 'https://www.pinterest.com/pin-creation-tool/',
            ),
            'facebook_groups' => array(
                'label' => 'Facebook Groups', 'tier' => 'C', 'budget' => 4000, 'tags' => 3,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://www.facebook.com/groups/feed/',
            ),
            'tiktok' => array(
                'label' => 'TikTok', 'tier' => 'B', 'budget' => 2200, 'tags' => 5,
                'link_cost' => 0, 'symbol' => 'hashtag', 'needs_image' => true,
                'compose' => '',
            ),
            'youtube_community' => array(
                'label' => 'YouTube Community', 'tier' => 'C', 'budget' => 1500, 'tags' => 3,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://studio.youtube.com/',
            ),
            'youtube_description' => array(
                'label' => 'YouTube description', 'tier' => 'B', 'budget' => 5000, 'tags' => 3,
                'link_cost' => 0, 'symbol' => 'cashtag', 'needs_image' => false,
                'compose' => 'https://studio.youtube.com/',
            ),
        );
    }
}

if (!function_exists('sml_dist_platform')) {
    function sml_dist_platform($key) {
        $all = sml_dist_platforms();
        return $all[$key] ?? null;
    }
}

if (!function_exists('sml_dist_live_platforms')) {
    /** Platforms we can actually post to right now. */
    function sml_dist_live_platforms() {
        $out = array();
        foreach (sml_dist_platforms() as $key => $meta) {
            if ($meta['tier'] === 'A') {
                $out[] = $key;
            }
        }
        return apply_filters('sml_dist_live_platforms', $out);
    }
}

/* ==================================================================
 * Secret storage
 *
 * Tokens are encrypted at rest with a key that lives in wp-config, not in
 * the database. Without the key we refuse to store credentials rather than
 * writing them in the clear and pretending that is fine.
 * ================================================================== */

if (!function_exists('sml_dist_master_key')) {
    function sml_dist_master_key() {
        if (defined('SML_DIST_KEY') && strlen((string) SML_DIST_KEY) >= 32) {
            return hash('sha256', (string) SML_DIST_KEY, true);
        }
        if (defined('AUTH_KEY') && defined('SECURE_AUTH_SALT') && strlen((string) AUTH_KEY) >= 32) {
            // Fall back to WordPress's own salts. Rotating them invalidates
            // stored tokens, which forces a relink - acceptable, and loud.
            return hash('sha256', AUTH_KEY . SECURE_AUTH_SALT, true);
        }
        return null;
    }
}

if (!function_exists('sml_dist_can_store_secrets')) {
    function sml_dist_can_store_secrets() {
        return sml_dist_master_key() !== null && function_exists('openssl_encrypt');
    }
}

if (!function_exists('sml_dist_secret_ref')) {
    function sml_dist_secret_ref() {
        return 'r' . bin2hex(random_bytes(12));
    }
}

if (!function_exists('sml_dist_secret_put')) {
    function sml_dist_secret_put($ref, $plaintext) {
        $key = sml_dist_master_key();
        if (!$key || !function_exists('openssl_encrypt')) {
            return false;
        }
        $iv = random_bytes(16);
        $blob = openssl_encrypt((string) $plaintext, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv);
        if ($blob === false) {
            return false;
        }
        update_option('sml_dist_sec_' . $ref, base64_encode($iv . $blob), false);
        return true;
    }
}

if (!function_exists('sml_dist_secret_get')) {
    function sml_dist_secret_get($ref) {
        $key = sml_dist_master_key();
        $raw = $ref ? get_option('sml_dist_sec_' . $ref) : '';
        if (!$key || !$raw || !function_exists('openssl_decrypt')) {
            return '';
        }
        $bin = base64_decode($raw, true);
        if ($bin === false || strlen($bin) <= 16) {
            return '';
        }
        $out = openssl_decrypt(substr($bin, 16), 'aes-256-cbc', $key, OPENSSL_RAW_DATA, substr($bin, 0, 16));
        return $out === false ? '' : $out;
    }
}

if (!function_exists('sml_dist_secret_delete')) {
    function sml_dist_secret_delete($ref) {
        if ($ref) {
            delete_option('sml_dist_sec_' . $ref);
        }
    }
}

/* ==================================================================
 * Shared helpers
 * ================================================================== */

if (!function_exists('sml_dist_now')) {
    function sml_dist_now() {
        return gmdate('Y-m-d H:i:s');
    }
}

if (!function_exists('sml_dist_token')) {
    function sml_dist_token() {
        return substr(str_replace(array('+', '/', '='), '', base64_encode(random_bytes(18))), 0, 10);
    }
}

if (!function_exists('sml_dist_session_key')) {
    /** Salted, truncated, never stores a raw IP. */
    function sml_dist_session_key() {
        $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
        $ua = isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : '';
        $salt = defined('NONCE_SALT') ? NONCE_SALT : 'sml-dist';
        return substr(hash('sha256', $salt . '|' . $ip . '|' . $ua), 0, 64);
    }
}

if (!function_exists('sml_dist_ua_class')) {
    function sml_dist_ua_class() {
        $ua = isset($_SERVER['HTTP_USER_AGENT']) ? strtolower((string) $_SERVER['HTTP_USER_AGENT']) : '';
        if (!$ua) {
            return 'unknown';
        }
        if (preg_match('/bot|crawl|spider|preview|facebookexternalhit|slurp/', $ua)) {
            return 'bot';
        }
        if (preg_match('/mobile|android|iphone|ipad/', $ua)) {
            return 'mobile';
        }
        return 'desktop';
    }
}
