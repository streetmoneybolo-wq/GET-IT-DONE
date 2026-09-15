<?php
/**
 * Loop Letters - schema and migrations (Phase 1).
 *
 * Long-form trading-native publishing. Reuses the existing follow graph as the
 * subscriber list, Loop Bucks as the paywall, and the ticker content feed as
 * distribution, rather than standing up parallel systems.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SML_LETTERS_DB_VERSION', '1.0.1');

if (!function_exists('sml_letters_table')) {
    function sml_letters_table($name) {
        global $wpdb;
        return $wpdb->prefix . 'sml_letter_' . $name;
    }
}

if (!function_exists('sml_letters_install')) {
    function sml_letters_install() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();

        $letters     = sml_letters_table('posts');
        $versions    = sml_letters_table('versions');
        $tickers     = sml_letters_table('tickers');
        $purchases   = sml_letters_table('purchases');
        $comments    = sml_letters_table('comments');
        $daily       = sml_letters_table('daily');
        $performance = sml_letters_table('performance');
        $bookmarks   = sml_letters_table('bookmarks');
        $reads       = sml_letters_table('reads');

        // Blocks live as JSON on the row. A separate blocks table buys nothing
        // until we need per-block queries, and costs a join on every read.
        dbDelta("CREATE TABLE $letters (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            author_id BIGINT UNSIGNED NOT NULL,
            slug VARCHAR(190) NOT NULL,
            title VARCHAR(200) NOT NULL DEFAULT '',
            subtitle VARCHAR(300) NULL,
            blocks LONGTEXT NULL,
            html LONGTEXT NULL,
            plaintext LONGTEXT NULL,
            tldr TEXT NULL,
            cover_url VARCHAR(255) NULL,
            content_type VARCHAR(48) NOT NULL DEFAULT 'Analysis',
            tags TEXT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'draft',
            visibility VARCHAR(16) NOT NULL DEFAULT 'public',
            tier_min VARCHAR(16) NULL,
            price_lb INT UNSIGNED NOT NULL DEFAULT 0,
            group_id BIGINT UNSIGNED NULL,
            has_levels TINYINT(1) NOT NULL DEFAULT 0,
            has_paywall TINYINT(1) NOT NULL DEFAULT 0,
            disclosure TEXT NULL,
            word_count INT UNSIGNED NOT NULL DEFAULT 0,
            read_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            sponsored TINYINT(1) NOT NULL DEFAULT 0,
            impressions INT UNSIGNED NOT NULL DEFAULT 0,
            opens INT UNSIGNED NOT NULL DEFAULT 0,
            read_count INT UNSIGNED NOT NULL DEFAULT 0,
            completions INT UNSIGNED NOT NULL DEFAULT 0,
            comment_count INT UNSIGNED NOT NULL DEFAULT 0,
            bookmark_count INT UNSIGNED NOT NULL DEFAULT 0,
            revenue_lb INT UNSIGNED NOT NULL DEFAULT 0,
            schedule_at DATETIME NULL,
            published_at DATETIME NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY slug (slug),
            KEY author_status (author_id, status, published_at),
            KEY status_pub (status, published_at),
            KEY scheduled (status, schedule_at)
        ) $charset;");

        dbDelta("CREATE TABLE $versions (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            letter_id BIGINT UNSIGNED NOT NULL,
            author_id BIGINT UNSIGNED NOT NULL,
            label VARCHAR(80) NULL,
            title VARCHAR(200) NOT NULL DEFAULT '',
            blocks LONGTEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY letter_time (letter_id, created_at)
        ) $charset;");

        dbDelta("CREATE TABLE $tickers (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            letter_id BIGINT UNSIGNED NOT NULL,
            symbol VARCHAR(16) NOT NULL,
            role VARCHAR(12) NOT NULL DEFAULT 'related',
            rank_score DECIMAL(6,4) NOT NULL DEFAULT 0.5000,
            bound_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY letter_symbol (letter_id, symbol),
            KEY symbol_score (symbol, rank_score)
        ) $charset;");

        dbDelta("CREATE TABLE $purchases (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            letter_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            rail VARCHAR(16) NOT NULL DEFAULT 'loop_bucks',
            price_lb INT UNSIGNED NOT NULL DEFAULT 0,
            idempotency_key VARCHAR(191) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'paid',
            refunded_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY idem (idempotency_key),
            UNIQUE KEY one_per_reader (letter_id, user_id),
            KEY user_time (user_id, created_at)
        ) $charset;");

        dbDelta("CREATE TABLE $comments (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            letter_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            parent_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            body TEXT NOT NULL,
            quote TEXT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'visible',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY letter_time (letter_id, created_at),
            KEY thread (letter_id, parent_id, created_at)
        ) $charset;");

        dbDelta("CREATE TABLE $daily (
            letter_id BIGINT UNSIGNED NOT NULL,
            day DATE NOT NULL,
            impressions INT UNSIGNED NOT NULL DEFAULT 0,
            opens INT UNSIGNED NOT NULL DEFAULT 0,
            read_count INT UNSIGNED NOT NULL DEFAULT 0,
            completions INT UNSIGNED NOT NULL DEFAULT 0,
            dwell_seconds INT UNSIGNED NOT NULL DEFAULT 0,
            conversions INT UNSIGNED NOT NULL DEFAULT 0,
            revenue_lb INT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY  (letter_id, day)
        ) $charset;");

        // Price snapshot at publish. This cannot be backfilled, which is why it
        // is captured from the very first letter even though the badge does not
        // render until Phase 2.
        dbDelta("CREATE TABLE $performance (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            letter_id BIGINT UNSIGNED NOT NULL,
            symbol VARCHAR(16) NOT NULL,
            price_at_publish DECIMAL(14,4) NULL,
            entry DECIMAL(14,4) NULL,
            stop DECIMAL(14,4) NULL,
            target_1 DECIMAL(14,4) NULL,
            target_2 DECIMAL(14,4) NULL,
            price_now DECIMAL(14,4) NULL,
            pct_change DECIMAL(9,4) NULL,
            max_favourable DECIMAL(9,4) NULL,
            max_adverse DECIMAL(9,4) NULL,
            thesis_state VARCHAR(16) NOT NULL DEFAULT 'open',
            snapshot_at DATETIME NULL,
            updated_at DATETIME NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY letter_symbol (letter_id, symbol),
            KEY state (thesis_state, updated_at)
        ) $charset;");

        dbDelta("CREATE TABLE $bookmarks (
            user_id BIGINT UNSIGNED NOT NULL,
            letter_id BIGINT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (user_id, letter_id),
            KEY letter (letter_id)
        ) $charset;");

        dbDelta("CREATE TABLE $reads (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            letter_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            session_key VARCHAR(64) NOT NULL,
            dwell_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            scroll_pct TINYINT UNSIGNED NOT NULL DEFAULT 0,
            completed TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY once (letter_id, session_key),
            KEY letter_user (letter_id, user_id)
        ) $charset;");

        update_option('sml_letters_db_version', SML_LETTERS_DB_VERSION, false);
    }
}

if (!function_exists('sml_letters_maybe_upgrade')) {
    function sml_letters_maybe_upgrade() {
        if (get_option('sml_letters_db_version') === SML_LETTERS_DB_VERSION) {
            return;
        }
        sml_letters_install();
    }
}
add_action('init', 'sml_letters_maybe_upgrade', 7);

/* ==================================================================
 * Who may publish
 * ================================================================== */

if (!function_exists('sml_letters_can_publish')) {
    /**
     * Mirrors the stream-key gate: group owners, admins and moderators.
     * Change with the sml_letters_can_publish filter to open it to all members.
     */
    function sml_letters_can_publish($user_id = 0) {
        $user_id = $user_id ?: get_current_user_id();
        if (!$user_id) {
            return false;
        }
        $allowed = function_exists('sml_rtmp_can_stream')
            ? sml_rtmp_can_stream($user_id)
            : user_can($user_id, 'manage_options');

        return (bool) apply_filters('sml_letters_can_publish', $allowed, $user_id);
    }
}

/* ==================================================================
 * Tiers
 * ================================================================== */

if (!function_exists('sml_letters_tier_rank')) {
    function sml_letters_tier_rank($slug) {
        $ranks = array('free' => 0, 'basic' => 1, 'pro' => 2, 'elite' => 3);
        $slug = strtolower((string) $slug);
        return isset($ranks[$slug]) ? $ranks[$slug] : 0;
    }
}

if (!function_exists('sml_letters_reader_tier')) {
    /**
     * Reader's tier with a given author. No subscription system exists yet, so
     * this resolves through group membership and stays overridable.
     */
    function sml_letters_reader_tier($reader_id, $author_id) {
        $tier = apply_filters('sml_letters_reader_tier', null, $reader_id, $author_id);
        if ($tier !== null) {
            return (string) $tier;
        }
        if (!$reader_id) {
            return 'free';
        }
        if ((int) $reader_id === (int) $author_id) {
            return 'elite';
        }
        return 'free';
    }
}
