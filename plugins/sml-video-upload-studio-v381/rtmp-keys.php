<?php
/**
 * RTMP stream keys - lets a streamer connect OBS to the platform.
 *
 * The ingest server itself runs off-site (nginx-rtmp, Cloudflare Stream, Mux,
 * ...). This file owns everything on the WordPress side: issuing keys, masking
 * and rotating them, and answering the ingest server's auth callback so only a
 * valid key can publish.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SML_RTMP_DB_VERSION', '1.0.0');

if (!function_exists('sml_rtmp_table')) {
    function sml_rtmp_table() {
        global $wpdb;
        return $wpdb->prefix . 'sml_stream_keys';
    }
}

if (!function_exists('sml_rtmp_install')) {
    function sml_rtmp_install() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = sml_rtmp_table();
        $charset = $wpdb->get_charset_collate();

        dbDelta("CREATE TABLE $table (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            stream_key VARCHAR(64) NOT NULL,
            key_prefix VARCHAR(16) NOT NULL,
            label VARCHAR(80) NOT NULL DEFAULT 'Primary',
            provider VARCHAR(24) NOT NULL DEFAULT 'generic',
            provider_stream_id VARCHAR(191) NULL,
            ingest_url VARCHAR(255) NULL,
            playback_url VARCHAR(255) NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'active',
            is_live TINYINT(1) NOT NULL DEFAULT 0,
            last_used_at DATETIME NULL,
            live_started_at DATETIME NULL,
            rotated_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY  (id),
            UNIQUE KEY stream_key (stream_key),
            KEY owner (user_id, status)
        ) $charset;");

        update_option('sml_rtmp_db_version', SML_RTMP_DB_VERSION, false);
    }
}

if (!function_exists('sml_rtmp_maybe_upgrade')) {
    function sml_rtmp_maybe_upgrade() {
        if (get_option('sml_rtmp_db_version') === SML_RTMP_DB_VERSION) {
            return;
        }
        sml_rtmp_install();
    }
}
add_action('init', 'sml_rtmp_maybe_upgrade', 6);

/* ==================================================================
 * Settings
 * ================================================================== */

if (!function_exists('sml_rtmp_settings')) {
    function sml_rtmp_settings() {
        $defaults = array(
            // Set these once your ingest is up.
            'provider' => 'generic',              // generic | nginx | cloudflare | mux
            'ingest_url' => '',                   // e.g. rtmp://live.stockmarketloop.com/live
            'playback_template' => '',            // e.g. https://cdn.example.com/hls/{key}.m3u8
            'auth_secret' => '',                  // shared secret the ingest sends back
            'enabled' => false,
        );
        $stored = get_option('sml_rtmp_settings', array());
        return array_merge($defaults, is_array($stored) ? $stored : array());
    }
}

if (!function_exists('sml_rtmp_save_settings')) {
    function sml_rtmp_save_settings($patch) {
        $settings = array_merge(sml_rtmp_settings(), (array) $patch);

        // Stray whitespace on a pasted secret or URL is the single most common
        // way this whole chain breaks, and it is invisible in the input field.
        foreach (array('auth_secret', 'ingest_url', 'playback_template', 'provider') as $field) {
            if (isset($settings[$field])) {
                $settings[$field] = trim((string) $settings[$field]);
            }
        }

        update_option('sml_rtmp_settings', $settings, false);
        return $settings;
    }
}

/* ==================================================================
 * Access control - only streamers get a key
 * ================================================================== */

if (!function_exists('sml_rtmp_can_stream')) {
    /**
     * A streamer is anyone who can already host: a group owner, a group
     * admin/mod, or a site admin. Keeps the ingest surface small, which is
     * what keeps a metered provider's bill predictable.
     */
    function sml_rtmp_can_stream($user_id = 0) {
        $user_id = $user_id ?: get_current_user_id();
        if (!$user_id) {
            return false;
        }
        if (user_can($user_id, 'manage_options')) {
            return true;
        }

        global $wpdb;
        $groups = $wpdb->prefix . 'sml_groups';
        $owns = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM $groups WHERE owner_id = %d", $user_id));
        if ($owns) {
            return true;
        }

        $members = $wpdb->prefix . 'sml_group_members';
        $role = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM $members
              WHERE user_id = %d AND role IN ('owner','admin','mod','analyst')",
            $user_id));

        return (bool) apply_filters('sml_rtmp_can_stream', $role > 0, $user_id);
    }
}

/* ==================================================================
 * Key lifecycle
 * ================================================================== */

if (!function_exists('sml_rtmp_generate_key')) {
    function sml_rtmp_generate_key() {
        // Prefixed so a leaked key is greppable and obviously ours.
        return 'sml_' . bin2hex(random_bytes(20));
    }
}

if (!function_exists('sml_rtmp_get_key')) {
    function sml_rtmp_get_key($user_id, $create = true) {
        global $wpdb;
        $table = sml_rtmp_table();

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE user_id = %d AND status = 'active' ORDER BY id DESC LIMIT 1",
            $user_id
        ), ARRAY_A);

        if ($row || !$create) {
            return $row;
        }

        $settings = sml_rtmp_settings();
        $key = sml_rtmp_generate_key();

        // Providers that mint their own stream id get a chance here.
        $provisioned = apply_filters('sml_rtmp_provision_key', null, $user_id, $settings);
        if (is_array($provisioned)) {
            $key = $provisioned['stream_key'] ?? $key;
        }

        $wpdb->insert($table, array(
            'user_id' => $user_id,
            'stream_key' => $key,
            'key_prefix' => substr($key, 0, 12),
            'label' => 'Primary',
            'provider' => $settings['provider'],
            'provider_stream_id' => $provisioned['provider_stream_id'] ?? null,
            'ingest_url' => $provisioned['ingest_url'] ?? ($settings['ingest_url'] ?: null),
            'playback_url' => $provisioned['playback_url'] ?? sml_rtmp_playback_url($key, $settings),
            'status' => 'active',
        ));

        return $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE id = %d", $wpdb->insert_id), ARRAY_A);
    }
}

if (!function_exists('sml_rtmp_playback_url')) {
    function sml_rtmp_playback_url($key, $settings = null) {
        $settings = $settings ?: sml_rtmp_settings();
        if (empty($settings['playback_template'])) {
            return null;
        }
        return str_replace('{key}', rawurlencode($key), $settings['playback_template']);
    }
}

if (!function_exists('sml_rtmp_rotate_key')) {
    function sml_rtmp_rotate_key($user_id) {
        global $wpdb;
        $table = sml_rtmp_table();

        // Revoking first means a leaked key stops working the instant you rotate.
        $wpdb->update($table,
            array('status' => 'revoked', 'rotated_at' => gmdate('Y-m-d H:i:s')),
            array('user_id' => $user_id, 'status' => 'active'));

        return sml_rtmp_get_key($user_id, true);
    }
}

if (!function_exists('sml_rtmp_public_row')) {
    function sml_rtmp_public_row($row, $reveal = false) {
        if (!$row) {
            return null;
        }
        $settings = sml_rtmp_settings();
        return array(
            'id' => (int) $row['id'],
            'label' => $row['label'],
            'provider' => $row['provider'],
            'ingest_url' => $row['ingest_url'] ?: $settings['ingest_url'],
            'playback_url' => $row['playback_url'],
            'masked_key' => $row['key_prefix'] . str_repeat('•', 12),
            'stream_key' => $reveal ? $row['stream_key'] : null,
            'is_live' => (bool) $row['is_live'],
            'last_used_at' => $row['last_used_at'],
            'live_started_at' => $row['live_started_at'],
            'created_at' => $row['created_at'],
            'configured' => !empty($settings['ingest_url']),
        );
    }
}

/* ==================================================================
 * REST
 * ================================================================== */

if (!function_exists('sml_rtmp_rest_key')) {
    function sml_rtmp_rest_key(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        if (!sml_rtmp_can_stream($user_id)) {
            return new WP_Error(
                'sml_rtmp_forbidden',
                'Stream keys are for group owners and admins. Create a group to start streaming.',
                array('status' => 403)
            );
        }

        $reveal = (bool) $request->get_param('reveal');
        $row = sml_rtmp_get_key($user_id, true);

        if ($reveal) {
            sml_voice_log('rtmp', null, $user_id, 'stream_key_revealed', array('id' => (int) $row['id']));
        }

        return array(
            'ok' => true,
            'key' => sml_rtmp_public_row($row, $reveal),
            'settings' => array(
                'enabled' => (bool) sml_rtmp_settings()['enabled'],
                'provider' => sml_rtmp_settings()['provider'],
            ),
        );
    }
}

if (!function_exists('sml_rtmp_rest_rotate')) {
    function sml_rtmp_rest_rotate(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        if (!sml_rtmp_can_stream($user_id)) {
            return new WP_Error('sml_rtmp_forbidden', 'Not allowed.', array('status' => 403));
        }
        $row = sml_rtmp_rotate_key($user_id);
        sml_voice_log('rtmp', null, $user_id, 'stream_key_rotated', array('id' => (int) $row['id']));
        return array('ok' => true, 'key' => sml_rtmp_public_row($row, true));
    }
}

if (!function_exists('sml_rtmp_rest_settings')) {
    function sml_rtmp_rest_settings(WP_REST_Request $request) {
        if (!current_user_can('manage_options')) {
            return new WP_Error('sml_rtmp_forbidden', 'Admins only.', array('status' => 403));
        }
        $patch = array();
        foreach (array('provider', 'ingest_url', 'playback_template', 'auth_secret') as $field) {
            if ($request->get_param($field) !== null) {
                $patch[$field] = sanitize_text_field((string) $request->get_param($field));
            }
        }
        if ($request->get_param('enabled') !== null) {
            $patch['enabled'] = (bool) $request->get_param('enabled');
        }
        $settings = sml_rtmp_save_settings($patch);
        $has_secret = !empty($settings['auth_secret']);
        unset($settings['auth_secret']);          // never echo it back
        $settings['auth_secret_set'] = $has_secret;
        return array('ok' => true, 'settings' => $settings);
    }
}

if (!function_exists('sml_rtmp_rest_settings_get')) {
    function sml_rtmp_rest_settings_get(WP_REST_Request $request) {
        if (!current_user_can('manage_options')) {
            return new WP_Error('sml_rtmp_forbidden', 'Admins only.', array('status' => 403));
        }
        $settings = sml_rtmp_settings();
        $has_secret = !empty($settings['auth_secret']);
        unset($settings['auth_secret']);          // never echo it back
        $settings['auth_secret_set'] = $has_secret;
        return array('ok' => true, 'settings' => $settings);
    }
}

/* ==================================================================
 * Pairing + auth diagnostics
 *
 * The commonest failure in this whole chain is a secret mismatch between
 * nginx and WordPress, and it surfaces to the streamer as OBS claiming the
 * stream key is wrong. These two things make that diagnosable without SSH.
 * ================================================================== */

/**
 * One-time cleanup of an already-saved secret carrying stray whitespace.
 * Runs once per version bump; costs a single option read afterwards.
 */
if (!function_exists('sml_rtmp_heal_settings')) {
    function sml_rtmp_heal_settings() {
        if (get_option('sml_rtmp_healed') === '1') {
            return;
        }
        $settings = get_option('sml_rtmp_settings', array());
        if (is_array($settings) && !empty($settings['auth_secret'])) {
            $clean = trim((string) $settings['auth_secret']);
            if ($clean !== $settings['auth_secret']) {
                $settings['auth_secret'] = $clean;
                update_option('sml_rtmp_settings', $settings, false);
            }
        }
        update_option('sml_rtmp_healed', '1', false);
    }
}
add_action('init', 'sml_rtmp_heal_settings', 6);

if (!function_exists('sml_rtmp_pairing_open')) {
    function sml_rtmp_pairing_open() {
        return (bool) get_transient('sml_rtmp_pairing');
    }
}

if (!function_exists('sml_rtmp_pairing_start')) {
    function sml_rtmp_pairing_start($minutes = 10) {
        set_transient('sml_rtmp_pairing', time(), max(1, (int) $minutes) * MINUTE_IN_SECONDS);
    }
}

if (!function_exists('sml_rtmp_pairing_close')) {
    function sml_rtmp_pairing_close() {
        delete_transient('sml_rtmp_pairing');
    }
}

if (!function_exists('sml_rtmp_key_exists')) {
    /** True if this is a live, active key - including -b / -c feed suffixes. */
    function sml_rtmp_key_exists($key) {
        global $wpdb;
        $table = sml_rtmp_table();
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT id FROM $table WHERE stream_key = %s AND status = 'active'", $key), ARRAY_A);
        $row = apply_filters('sml_rtmp_resolve_key', $row, $key);
        return (bool) $row;
    }
}

if (!function_exists('sml_rtmp_log_auth')) {
    /**
     * Records enough to diagnose a mismatch without ever storing either
     * secret in full.
     */
    function sml_rtmp_log_auth($result, $key, $sent, $settings) {
        $expected = (string) ($settings['auth_secret'] ?? '');
        $log = get_option('sml_rtmp_auth_log', array());
        if (!is_array($log)) {
            $log = array();
        }

        array_unshift($log, array(
            'at'            => gmdate('Y-m-d H:i:s'),
            'result'        => $result,
            'key_prefix'    => substr((string) $key, 0, 16),
            'key_len'       => strlen((string) $key),
            'sent_prefix'   => $sent === '' ? '(none sent)' : substr($sent, 0, 6),
            'sent_len'      => strlen((string) $sent),
            'stored_prefix' => $expected === '' ? '(none stored)' : substr($expected, 0, 6),
            'stored_len'    => strlen($expected),
            'match'         => ($expected !== '' && hash_equals($expected, (string) $sent)),
        ));

        update_option('sml_rtmp_auth_log', array_slice($log, 0, 25), false);
    }
}

if (!function_exists('sml_rtmp_rest_auth')) {
    /**
     * Called by the ingest server when a publisher connects.
     *
     * nginx-rtmp posts form fields including `name` (the stream key).
     * Respond 200 to allow publishing, 403 to reject.
     */
    function sml_rtmp_rest_auth(WP_REST_Request $request) {
        global $wpdb;

        $settings = sml_rtmp_settings();
        if (empty($settings['enabled'])) {
            return new WP_REST_Response(array('ok' => false, 'reason' => 'disabled'), 403);
        }

        // Trim both sides. A secret pasted into the settings field almost
        // always arrives with a trailing newline or space attached, and since
        // the secret is checked before the stream key, the streamer sees OBS
        // complain that their *key* is wrong. One invisible character.
        $sent = trim((string) ($request->get_param('secret') ?: $request->get_header('x-sml-rtmp-secret')));
        $settings['auth_secret'] = trim((string) $settings['auth_secret']);

        $key = (string) ($request->get_param('name') ?: $request->get_param('key'));
        $key = trim($key);
        if (!$key) {
            return new WP_REST_Response(array('ok' => false, 'reason' => 'no_key'), 403);
        }

        // Shared secret stops anyone else asserting a publish on your behalf.
        if (!empty($settings['auth_secret']) && !hash_equals((string) $settings['auth_secret'], $sent)) {

            // Pairing. The secret lives in the ingest server's nginx config and
            // in WordPress, and the two drift apart whenever the installer is
            // re-run - which reads to the streamer as "OBS says my key is
            // wrong", because the secret is checked before the key ever is.
            //
            // An admin can open a short pairing window and let the next publish
            // teach WordPress the secret the server is actually sending. The
            // caller still has to present a valid, active stream key, so an
            // open window is not an open door.
            if (sml_rtmp_pairing_open() && $sent !== '' && sml_rtmp_key_exists($key)) {
                sml_rtmp_save_settings(array('auth_secret' => $sent));
                sml_rtmp_pairing_close();
                sml_rtmp_log_auth('paired', $key, $sent, $settings);
            } else {
                sml_rtmp_log_auth('bad_secret', $key, $sent, $settings);
                return new WP_REST_Response(array('ok' => false, 'reason' => 'bad_secret'), 403);
            }
        }

        $table = sml_rtmp_table();
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE stream_key = %s AND status = 'active'", $key), ARRAY_A);

        // Extra OBS outputs publish to {key}-b / {key}-c. They resolve back to
        // the same row so one rotation still revokes every feed.
        $row = apply_filters('sml_rtmp_resolve_key', $row, $key);

        if (!$row) {
            sml_voice_log('rtmp', null, 0, 'publish_rejected', array('prefix' => substr($key, 0, 12)));
            sml_rtmp_log_auth('unknown_key', $key, $sent, $settings);
            return new WP_REST_Response(array('ok' => false, 'reason' => 'unknown_key'), 403);
        }
        $feed = isset($row['_feed']) ? $row['_feed'] : 'a';
        if (!sml_rtmp_can_stream((int) $row['user_id'])) {
            return new WP_REST_Response(array('ok' => false, 'reason' => 'not_a_streamer'), 403);
        }

        // Only the primary feed flips the row live. A secondary output going
        // up must not restart the stream clock or re-fire the "we're live"
        // notifications.
        if ($feed === 'a') {
            $was_live = !empty($row['is_live']);
            $wpdb->update($table, array(
                'is_live' => 1,
                'last_used_at' => gmdate('Y-m-d H:i:s'),
                'live_started_at' => gmdate('Y-m-d H:i:s'),
            ), array('id' => (int) $row['id']));
            /* The encoder connecting on the primary feed IS "the creator went live" on this site (the studio's
               REST start route is a draft snippet). Listeners: mu-plugin sml-live-autopost (Distribute). 2026-09-15 */
            do_action('sml_stream_went_live', $row, $was_live, $feed);
        } else {
            $wpdb->update($table, array('last_used_at' => gmdate('Y-m-d H:i:s')), array('id' => (int) $row['id']));
        }

        if (function_exists('sml_slots_mark_feed')) {
            sml_slots_mark_feed((int) $row['user_id'], $feed, true);
        }

        sml_voice_log('rtmp', null, (int) $row['user_id'], 'publish_started',
            array('id' => (int) $row['id'], 'feed' => $feed));
        sml_rtmp_log_auth('ok', $key, $sent, $settings);
        return new WP_REST_Response(
            array('ok' => true, 'user_id' => (int) $row['user_id'], 'feed' => $feed), 200);
    }
}

if (!function_exists('sml_rtmp_rest_auth_done')) {
    function sml_rtmp_rest_auth_done(WP_REST_Request $request) {
        global $wpdb;
        $key = trim((string) ($request->get_param('name') ?: $request->get_param('key')));
        if (!$key) {
            return new WP_REST_Response(array('ok' => true), 200);
        }
        $table = sml_rtmp_table();
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE stream_key = %s", $key), ARRAY_A);
        $row = apply_filters('sml_rtmp_resolve_key', $row, $key);

        if ($row) {
            $feed = isset($row['_feed']) ? $row['_feed'] : 'a';

            // A secondary output dropping is not the stream ending. Only the
            // primary feed going away takes the whole broadcast offline.
            if ($feed === 'a') {
                $was_live = !empty($row['is_live']);
                $wpdb->update($table, array('is_live' => 0), array('id' => (int) $row['id']));
                /* primary feed gone = the broadcast ended (listeners: scheduled-live lifecycle / SEO hand-off) 2026-09-15 */
                do_action('sml_stream_ended', $row, $was_live, $feed);
            }
            if (function_exists('sml_slots_mark_feed')) {
                sml_slots_mark_feed((int) $row['user_id'], $feed, false);
            }
            sml_voice_log('rtmp', null, (int) $row['user_id'], 'publish_stopped',
                array('id' => (int) $row['id'], 'feed' => $feed));
        }
        return new WP_REST_Response(array('ok' => true), 200);
    }
}

if (!function_exists('sml_rtmp_rest_diagnose')) {
    function sml_rtmp_rest_diagnose() {
        $settings = sml_rtmp_settings();
        $log = get_option('sml_rtmp_auth_log', array());
        $log = is_array($log) ? $log : array();

        $verdict = 'No publish attempt has reached WordPress yet.';
        $fix = 'Hit Start Streaming in OBS, then check here again. If nothing appears, '
             . 'the callback is not arriving at all - that is an nginx or DNS problem, not a key problem.';

        if ($log) {
            $last = $log[0];
            if ($last['result'] === 'ok' || $last['result'] === 'paired') {
                $verdict = 'The last publish was accepted.';
                $fix = 'Nothing to fix.';
            } elseif ($last['result'] === 'bad_secret') {
                $verdict = 'The ingest server is sending a secret that does not match the one saved here.';
                $fix = 'Click Pair, then start streaming within 10 minutes. WordPress will take the '
                     . 'secret the server actually sends and save it.';
            } elseif ($last['result'] === 'unknown_key') {
                $verdict = 'The secret matched, but the stream key did not.';
                $fix = 'Copy the key from the OBS panel again - it has probably been rotated since you pasted it.';
            }
        }

        return array(
            'enabled'      => !empty($settings['enabled']),
            'provider'     => $settings['provider'],
            'ingest_url'   => $settings['ingest_url'],
            'secret_set'   => !empty($settings['auth_secret']),
            'secret_len'   => strlen((string) $settings['auth_secret']),
            'pairing_open' => sml_rtmp_pairing_open(),
            'verdict'      => $verdict,
            'fix'          => $fix,
            'attempts'     => array_slice($log, 0, 10),
        );
    }
}

if (!function_exists('sml_rtmp_rest_pair')) {
    function sml_rtmp_rest_pair(WP_REST_Request $request) {
        if ($request->get_param('cancel')) {
            sml_rtmp_pairing_close();
            return array('ok' => true, 'pairing_open' => false);
        }
        sml_rtmp_pairing_start(10);
        return array(
            'ok'           => true,
            'pairing_open' => true,
            'expires_in'   => 600,
            'note'         => 'Start streaming from OBS within 10 minutes. The next publish that '
                            . 'presents a valid stream key will set the secret.',
        );
    }
}

if (!function_exists('sml_rtmp_register_routes')) {
    function sml_rtmp_register_routes() {
        $ns = 'sml-voice/v1';

        register_rest_route($ns, '/stream-key', array(
            'methods' => 'GET',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_rtmp_rest_key',
        ));
        register_rest_route($ns, '/stream-key/rotate', array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_rtmp_rest_rotate',
        ));
        register_rest_route($ns, '/rtmp/settings', array(
            array(
                'methods' => WP_REST_Server::CREATABLE,
                'permission_callback' => 'is_user_logged_in',
                'callback' => 'sml_rtmp_rest_settings',
            ),
            array(
                'methods' => 'GET',
                'permission_callback' => 'is_user_logged_in',
                'callback' => 'sml_rtmp_rest_settings_get',
            ),
        ));
        // Open by design - the ingest server is not logged in. Guarded by the
        // shared secret plus the key lookup itself.
        register_rest_route($ns, '/rtmp/diagnose', array(
            'methods' => 'GET',
            'permission_callback' => function () { return current_user_can('manage_options'); },
            'callback' => 'sml_rtmp_rest_diagnose',
        ));
        register_rest_route($ns, '/rtmp/pair', array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => function () { return current_user_can('manage_options'); },
            'callback' => 'sml_rtmp_rest_pair',
        ));
        register_rest_route($ns, '/rtmp/auth', array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => '__return_true',
            'callback' => 'sml_rtmp_rest_auth',
        ));
        register_rest_route($ns, '/rtmp/done', array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => '__return_true',
            'callback' => 'sml_rtmp_rest_auth_done',
        ));
    }
}
add_action('rest_api_init', 'sml_rtmp_register_routes');
