<?php
/**
 * SuperChat Voice Call-In - schema, migrations and tier seed.
 * Phase 1 of the call-in system: control plane only, P2P media.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SML_VOICE_DB_VERSION', '1.3.0');

if (!function_exists('sml_voice_table')) {
    function sml_voice_table($name) {
        global $wpdb;
        return $wpdb->prefix . 'sml_voice_' . $name;
    }
}

if (!function_exists('sml_voice_install')) {
    function sml_voice_install() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();

        $tiers      = sml_voice_table('tiers');
        $superchats = sml_voice_table('superchats');
        $tokens     = sml_voice_table('tokens');
        $queue      = sml_voice_table('queue');
        $sessions   = sml_voice_table('sessions');
        $bans       = sml_voice_table('bans');
        $cooldowns  = sml_voice_table('cooldowns');
        $events     = sml_voice_table('events');
        $chat       = sml_voice_table('chat');

        // Note: dbDelta is picky - two spaces after PRIMARY KEY, one space around KEY.
        dbDelta("CREATE TABLE $tiers (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            slug VARCHAR(32) NOT NULL,
            label VARCHAR(64) NOT NULL,
            min_amount_cents INT UNSIGNED NOT NULL DEFAULT 0,
            min_loop_bucks INT UNSIGNED NOT NULL DEFAULT 0,
            speak_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 15,
            priority TINYINT UNSIGNED NOT NULL DEFAULT 0,
            cooldown_seconds INT UNSIGNED NOT NULL DEFAULT 600,
            members_only TINYINT(1) NOT NULL DEFAULT 0,
            max_per_stream TINYINT UNSIGNED NOT NULL DEFAULT 3,
            active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY slug (slug),
            KEY active_priority (active, priority)
        ) $charset;");

        dbDelta("CREATE TABLE $superchats (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            room_id VARCHAR(64) NOT NULL,
            streamer_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            tier_id BIGINT UNSIGNED NOT NULL,
            rail VARCHAR(16) NOT NULL DEFAULT 'loop_bucks',
            amount_cents INT UNSIGNED NOT NULL DEFAULT 0,
            loop_bucks INT UNSIGNED NOT NULL DEFAULT 0,
            currency CHAR(3) NOT NULL DEFAULT 'USD',
            message VARCHAR(280) NULL,
            provider_ref VARCHAR(191) NULL,
            idempotency_key VARCHAR(191) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            paid_at DATETIME NULL,
            refunded_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY idem (idempotency_key),
            KEY room_time (room_id, created_at),
            KEY user_time (user_id, created_at)
        ) $charset;");

        dbDelta("CREATE TABLE $tokens (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            token CHAR(43) NOT NULL,
            superchat_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            room_id VARCHAR(64) NOT NULL,
            tier_id BIGINT UNSIGNED NOT NULL,
            speak_seconds SMALLINT UNSIGNED NOT NULL,
            priority TINYINT UNSIGNED NOT NULL DEFAULT 0,
            status VARCHAR(16) NOT NULL DEFAULT 'unused',
            expires_at DATETIME NOT NULL,
            consumed_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY token (token),
            KEY user_status (user_id, status),
            KEY room_status (room_id, status)
        ) $charset;");

        dbDelta("CREATE TABLE $queue (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            room_id VARCHAR(64) NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            token_id BIGINT UNSIGNED NOT NULL,
            priority TINYINT UNSIGNED NOT NULL DEFAULT 0,
            display_name VARCHAR(120) NOT NULL,
            avatar_url VARCHAR(255) NULL,
            message VARCHAR(280) NULL,
            amount_cents INT UNSIGNED NOT NULL DEFAULT 0,
            loop_bucks INT UNSIGNED NOT NULL DEFAULT 0,
            mic_ready TINYINT(1) NOT NULL DEFAULT 0,
            status VARCHAR(16) NOT NULL DEFAULT 'waiting',
            requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            decided_at DATETIME NULL,
            decided_by BIGINT UNSIGNED NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY token_once (token_id),
            KEY pop_order (room_id, status, priority, requested_at),
            KEY user_room (user_id, room_id, status)
        ) $charset;");

        dbDelta("CREATE TABLE $sessions (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            session_uid CHAR(36) NOT NULL,
            room_id VARCHAR(64) NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            streamer_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            queue_id BIGINT UNSIGNED NOT NULL,
            token_id BIGINT UNSIGNED NOT NULL,
            media_identity VARCHAR(128) NOT NULL,
            granted_seconds SMALLINT UNSIGNED NOT NULL,
            state VARCHAR(16) NOT NULL DEFAULT 'connecting',
            muted TINYINT(1) NOT NULL DEFAULT 0,
            gain DECIMAL(4,2) NOT NULL DEFAULT 1.00,
            started_at DATETIME NULL,
            hard_deadline DATETIME NULL,
            ended_at DATETIME NULL,
            end_reason VARCHAR(24) NULL,
            spoken_seconds SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            peak_dbfs DECIMAL(6,2) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY session_uid (session_uid),
            KEY room_state (room_id, state),
            KEY deadline (state, hard_deadline)
        ) $charset;");

        dbDelta("CREATE TABLE $bans (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            scope VARCHAR(16) NOT NULL DEFAULT 'room',
            scope_ref VARCHAR(64) NULL,
            reason VARCHAR(255) NULL,
            created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
            expires_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY lookup (user_id, scope, scope_ref)
        ) $charset;");

        dbDelta("CREATE TABLE $cooldowns (
            user_id BIGINT UNSIGNED NOT NULL,
            room_id VARCHAR(64) NOT NULL,
            until_at DATETIME NOT NULL,
            PRIMARY KEY  (user_id, room_id)
        ) $charset;");

        // WebRTC signalling. Self-contained so call-ins do not depend on a
        // group live room already existing.
        $signals = sml_voice_table('signals');
        dbDelta("CREATE TABLE $signals (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            session_uid CHAR(36) NOT NULL,
            from_user BIGINT UNSIGNED NOT NULL,
            to_user BIGINT UNSIGNED NOT NULL,
            from_role VARCHAR(8) NOT NULL DEFAULT 'caller',
            signal_type VARCHAR(16) NOT NULL,
            payload LONGTEXT NOT NULL,
            consumed TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY inbox (session_uid, from_role, id),
            KEY cleanup (created_at)
        ) $charset;");

        dbDelta("CREATE TABLE $events (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            room_id VARCHAR(64) NOT NULL,
            session_uid CHAR(36) NULL,
            actor_id BIGINT UNSIGNED NULL,
            event VARCHAR(48) NOT NULL,
            payload LONGTEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY room_time (room_id, created_at),
            KEY session (session_uid)
        ) $charset;");

        dbDelta("CREATE TABLE $chat (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            room_id VARCHAR(64) NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            display_name VARCHAR(120) NOT NULL,
            avatar_url VARCHAR(255) NULL,
            message VARCHAR(280) NOT NULL,
            kind VARCHAR(16) NOT NULL DEFAULT 'message',
            tier_slug VARCHAR(32) NULL,
            amount_cents INT UNSIGNED NOT NULL DEFAULT 0,
            loop_bucks INT UNSIGNED NOT NULL DEFAULT 0,
            status VARCHAR(16) NOT NULL DEFAULT 'active',
            highlighted_until DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            KEY room_time (room_id, id),
            KEY room_kind (room_id, kind, status, created_at),
            KEY user_time (user_id, created_at)
        ) $charset;");

        sml_voice_seed_tiers();
        update_option('sml_voice_db_version', SML_VOICE_DB_VERSION, false);
    }
}

if (!function_exists('sml_voice_seed_tiers')) {
    function sml_voice_seed_tiers() {
        global $wpdb;
        $table = sml_voice_table('tiers');

        // 1 Loop Buck = 1 cent on this site, so LB price mirrors the USD price.
        $seed = array(
            array('bronze',  'Speak',             500,   500, 15, 0, 900, 0, 3),
            array('silver',  'Priority Speak',   2000,  2000, 20, 5, 600, 0, 3),
            array('gold',    'Member Voice',     5000,  5000, 30, 8, 300, 1, 5),
            array('sponsor', 'Sponsored Segment', 25000, 0,   90, 10,  0, 0, 1),
        );

        foreach ($seed as $row) {
            $exists = $wpdb->get_var($wpdb->prepare("SELECT id FROM $table WHERE slug = %s", $row[0]));
            if ($exists) {
                continue;
            }
            $wpdb->insert($table, array(
                'slug' => $row[0],
                'label' => $row[1],
                'min_amount_cents' => $row[2],
                'min_loop_bucks' => $row[3],
                'speak_seconds' => $row[4],
                'priority' => $row[5],
                'cooldown_seconds' => $row[6],
                'members_only' => $row[7],
                'max_per_stream' => $row[8],
                'active' => 1,
            ));
        }
    }
}

if (!function_exists('sml_voice_maybe_upgrade')) {
    function sml_voice_maybe_upgrade() {
        if (get_option('sml_voice_db_version') === SML_VOICE_DB_VERSION) {
            return;
        }
        sml_voice_install();
    }
}
add_action('init', 'sml_voice_maybe_upgrade', 5);

if (!function_exists('sml_voice_room_settings')) {
    function sml_voice_room_settings($room_id) {
        $all = get_option('sml_voice_room_settings', array());
        $defaults = array(
            'enabled' => true,
            'min_tier' => 'bronze',
            'auto_approve_priority' => 0,   // 0 = never auto approve
            'max_queue' => 25,
            'require_mic_ready' => true,
            'text_chat_enabled' => true,
            'super_chat_enabled' => true,
            'members_only' => false,
            'chat_slow_mode' => 3,
        );
        $room = isset($all[$room_id]) && is_array($all[$room_id]) ? $all[$room_id] : array();
        return array_merge($defaults, $room);
    }
}

if (!function_exists('sml_voice_save_room_settings')) {
    function sml_voice_save_room_settings($room_id, $settings) {
        $all = get_option('sml_voice_room_settings', array());
        if (!is_array($all)) {
            $all = array();
        }
        $all[$room_id] = array_merge(sml_voice_room_settings($room_id), (array) $settings);
        update_option('sml_voice_room_settings', $all, false);
        return $all[$room_id];
    }
}
