<?php
/**
 * Plugin Name: SML Group Live Routes
 * Description: The live-room REST routes the Go Live studio depends on (sml-group-live/v1: rooms, start, stop, poll, signal). They used to live in WPCode snippet 5750 "Group Live + Personal Inbox", which is a draft, so the studio's Go Live button answered 404 "rest_no_route". This is the live-room subset of that snippet as a mu-plugin (outside the WPCode merged eval), with two fixes: stop accepts group_id (what the studio sends) and the host's rooms poll keeps their room's heartbeat alive. 2026-09-15. 1.1.0 (owner call 2026-09-19): a host group is OPTIONAL — group_id 0 opens a "channel room" that belongs to the creator alone (one per host, nobody notified, visible only to its host), so a creator can go live on their Watch Page without broadcasting into any group.
 * Version: 1.1.0
 * Author: StockMarketLoop
 */

if (!defined('ABSPATH')) { exit; }

if (!function_exists('sml_gli_tables')) {
    function sml_gli_tables() {
        global $wpdb;
        return array(
            'rooms' => $wpdb->prefix . 'sml_group_live_rooms',
            'presence' => $wpdb->prefix . 'sml_group_live_presence',
            'signals' => $wpdb->prefix . 'sml_group_live_signals',
        );
    }
}
if (!function_exists('sml_gli_ensure_tables')) {
    function sml_gli_ensure_tables() {
        if (get_option('sml_gli_routes_tables') === '1') { return; }
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $t = sml_gli_tables();
        $charset = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE {$t['rooms']} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            group_id BIGINT UNSIGNED NOT NULL,
            host_id BIGINT UNSIGNED NOT NULL,
            kind VARCHAR(16) NOT NULL,
            title VARCHAR(190) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'active',
            started_at DATETIME NOT NULL,
            heartbeat_at DATETIME NOT NULL,
            ended_at DATETIME NULL,
            PRIMARY KEY (id),
            KEY group_status (group_id, status)
        ) $charset;");
        dbDelta("CREATE TABLE {$t['presence']} (
            room_id BIGINT UNSIGNED NOT NULL,
            user_id BIGINT UNSIGNED NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (room_id, user_id)
        ) $charset;");
        dbDelta("CREATE TABLE {$t['signals']} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            room_id BIGINT UNSIGNED NOT NULL,
            from_user BIGINT UNSIGNED NOT NULL,
            to_user BIGINT UNSIGNED NOT NULL,
            signal_type VARCHAR(16) NOT NULL,
            payload LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY room_to (room_id, to_user, id)
        ) $charset;");
        update_option('sml_gli_routes_tables', '1', false);
    }
}
if (!function_exists('sml_gli_group_access')) {
    function sml_gli_group_access($group_id, $must_be_member = false) {
        $group_id = absint($group_id);
        $user_id = get_current_user_id();
        if (!$group_id || !$user_id || !function_exists('sml_groups_can_enter_content')) { return false; }
        if (!sml_groups_can_enter_content($group_id, $user_id)) { return false; }
        if ($must_be_member && !current_user_can('manage_options')
            && !(function_exists('sml_groups_current_user_can_manage') && sml_groups_current_user_can_manage($group_id, $user_id))
            && !(function_exists('sml_groups_user_is_member') && sml_groups_user_is_member($group_id, $user_id))) { return false; }
        return true;
    }
}
if (!function_exists('sml_gli_room_access')) {
    /** Access to ONE room. A group room follows its group's rules. A channel room (group_id 0: the creator went
        live without a host group) has no group audience — viewers are on the public Watch Page, which is keyed by
        the creator's handle, not by this row — so only its host (or an admin) may poll or signal it. */
    function sml_gli_room_access($room, $must_be_member = false) {
        $group_id = (int) ($room['group_id'] ?? 0);
        if ($group_id) { return sml_gli_group_access($group_id, $must_be_member); }
        $user_id = get_current_user_id();
        return $user_id && ((int) ($room['host_id'] ?? 0) === $user_id || current_user_can('manage_options'));
    }
}
if (!function_exists('sml_gli_user_payload')) {
    function sml_gli_user_payload($user_id) {
        if (function_exists('sml_groups_user_payload')) { return sml_groups_user_payload($user_id); }
        $user = get_userdata($user_id);
        return array('id' => (int) $user_id, 'display_name' => $user ? $user->display_name : 'Member', 'handle' => $user ? $user->user_login : 'member', 'avatar_url' => get_avatar_url($user_id));
    }
}
if (!function_exists('sml_gli_expire_rooms')) {
    function sml_gli_expire_rooms() {
        global $wpdb;
        $t = sml_gli_tables();
        $cutoff = gmdate('Y-m-d H:i:s', time() - 95);
        $wpdb->query($wpdb->prepare("UPDATE {$t['rooms']} SET status='ended', ended_at=UTC_TIMESTAMP() WHERE status='active' AND heartbeat_at < %s", $cutoff));
        $presence_cutoff = gmdate('Y-m-d H:i:s', time() - 40);
        $wpdb->query($wpdb->prepare("DELETE FROM {$t['presence']} WHERE updated_at < %s", $presence_cutoff));
        if (mt_rand(1, 20) === 1) {
            $signal_cutoff = gmdate('Y-m-d H:i:s', time() - 3600);
            $wpdb->query($wpdb->prepare("DELETE FROM {$t['signals']} WHERE created_at < %s", $signal_cutoff));
        }
    }
}
if (!function_exists('sml_gli_room_payload')) {
    function sml_gli_room_payload($row) {
        $present = isset($row['presence_count']) ? max(0, (int) $row['presence_count']) : 0;
        $members = max(1, $present);
        return array(
            'id' => (int) $row['id'], 'group_id' => (int) $row['group_id'], 'host_id' => (int) $row['host_id'],
            'host' => sml_gli_user_payload((int) $row['host_id']), 'kind' => sanitize_key($row['kind']),
            'title' => sanitize_text_field($row['title']), 'status' => sanitize_key($row['status']),
            'started_at' => mysql_to_rfc3339($row['started_at']),
            'member_count' => $members,
            'audience_count' => max(0, $members - 1),
            'viewer_count' => max(0, $members - 1),
        );
    }
}
if (!function_exists('sml_gli_rooms')) {
    function sml_gli_rooms(WP_REST_Request $request) {
        global $wpdb;
        $group_id = absint($request->get_param('group_id'));
        // group_id 0 = the caller's own channel room (no host group). Still heartbeats below; lists only their rooms.
        if ($group_id && !sml_gli_group_access($group_id)) { return new WP_Error('sml_gli_locked', 'Join or unlock this group to view its live rooms.', array('status' => 403)); }
        $t = sml_gli_tables();
        $now = current_time('mysql', true);
        /* The studio polls this every few seconds while live and never calls /poll, so the host's own room would
           expire after 95s of "silence". The host's rooms poll is the heartbeat. */
        $wpdb->query($wpdb->prepare("UPDATE {$t['rooms']} SET heartbeat_at=%s WHERE group_id=%d AND host_id=%d AND status='active'", $now, $group_id, get_current_user_id()));
        $wpdb->query($wpdb->prepare("INSERT INTO {$t['presence']} (room_id,user_id,updated_at) SELECT id, %d, %s FROM {$t['rooms']} WHERE group_id=%d AND host_id=%d AND status='active' ON DUPLICATE KEY UPDATE updated_at=VALUES(updated_at)", get_current_user_id(), $now, $group_id, get_current_user_id()));
        sml_gli_expire_rooms();
        $rows = $group_id
            ? $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t['rooms']} WHERE group_id=%d AND status='active' ORDER BY started_at ASC LIMIT 6", $group_id), ARRAY_A)
            : $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t['rooms']} WHERE group_id=0 AND host_id=%d AND status='active' ORDER BY started_at ASC LIMIT 6", get_current_user_id()), ARRAY_A);
        $cutoff = gmdate('Y-m-d H:i:s', time() - 40);
        foreach ($rows ?: array() as &$row) {
            $row['presence_count'] = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t['presence']} WHERE room_id=%d AND updated_at >= %s", (int) $row['id'], $cutoff));
        }
        unset($row);
        return array('rooms' => array_map('sml_gli_room_payload', $rows ?: array()), 'visual_limit' => 3, 'voice_limit' => 3);
    }
}
if (!function_exists('sml_gli_notify_group')) {
    function sml_gli_notify_group($group_id, $message, $link, $actor_id) {
        global $wpdb;
        if (!function_exists('sml_groups_tables') || !function_exists('sml_members_add_notification')) { return 0; }
        $tables = sml_groups_tables();
        $ids = $wpdb->get_col($wpdb->prepare("SELECT user_id FROM {$tables['members']} WHERE group_id=%d", $group_id));
        $sent = 0;
        foreach (array_unique(array_map('absint', $ids ?: array())) as $user_id) {
            if (!$user_id || $user_id === (int) $actor_id) { continue; }
            sml_members_add_notification($user_id, 'group_alert', $message, $link, $actor_id);
            $sent++;
        }
        return $sent;
    }
}
if (!function_exists('sml_gli_start')) {
    function sml_gli_start(WP_REST_Request $request) {
        global $wpdb;
        $group_id = absint($request->get_param('group_id'));
        // A host group is optional (owner call 2026-09-19). group_id 0 = a channel room: the stream lives on the
        // creator's Watch Page only, so there is no group to be a member of.
        if ($group_id && !sml_gli_group_access($group_id, true)) { return new WP_Error('sml_gli_member', 'You must be a member of this group to go live.', array('status' => 403)); }
        if (!$group_id && !apply_filters('sml_gli_can_start_channel_room', true, get_current_user_id())) { return new WP_Error('sml_gli_channel', 'Your account cannot go live yet.', array('status' => 403)); }
        $kind = sanitize_key((string) $request->get_param('kind'));
        if (!in_array($kind, array('video', 'screen', 'voice'), true)) { return new WP_Error('sml_gli_kind', 'Choose video, screen share, or voice.', array('status' => 400)); }
        $title = sanitize_text_field((string) $request->get_param('title'));
        if ($title === '') { $title = ucfirst($kind) . ' room'; }
        $t = sml_gli_tables();
        sml_gli_expire_rooms();
        $user_id = get_current_user_id();
        // Going live again from the studio while your own room is still active just returns that room.
        $mine = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t['rooms']} WHERE group_id=%d AND host_id=%d AND status='active' ORDER BY id DESC LIMIT 1", $group_id, $user_id), ARRAY_A);
        if ($mine) {
            $wpdb->update($t['rooms'], array('heartbeat_at' => current_time('mysql', true), 'title' => $title), array('id' => (int) $mine['id']), array('%s', '%s'), array('%d'));
            $mine['title'] = $title;
            return array('room' => sml_gli_room_payload($mine), 'notified' => 0, 'resumed' => true);
        }
        /* The 3-slot limit is per GROUP. Channel rooms all share group_id 0, so counting them together would let
           three creators lock every other creator on the site out — they are limited per HOST instead (one each). */
        $lock = $group_id ? 'sml_gli_group_' . $group_id : 'sml_gli_host_' . $user_id;
        $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s,3)', $lock));
        $visual = $kind !== 'voice';
        if ($group_id) {
            $count_sql = $visual
                ? "SELECT COUNT(*) FROM {$t['rooms']} WHERE group_id=%d AND status='active' AND kind IN ('video','screen')"
                : "SELECT COUNT(*) FROM {$t['rooms']} WHERE group_id=%d AND status='active' AND kind='voice'";
            $count = (int) $wpdb->get_var($wpdb->prepare($count_sql, $group_id));
            if ($count >= 3) {
                $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
                return new WP_Error('sml_gli_limit', $visual ? 'All 3 live video slots are in use.' : 'All 3 voice-room slots are in use.', array('status' => 409));
            }
        } else {
            // Re-check under the lock so a double click on Go Live cannot open two channel rooms.
            $dupe = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t['rooms']} WHERE group_id=0 AND host_id=%d AND status='active' ORDER BY id DESC LIMIT 1", $user_id), ARRAY_A);
            if ($dupe) {
                $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
                return array('room' => sml_gli_room_payload($dupe), 'notified' => 0, 'resumed' => true);
            }
        }
        $now = current_time('mysql', true);
        $wpdb->insert($t['rooms'], array('group_id' => $group_id, 'host_id' => $user_id, 'kind' => $kind, 'title' => $title, 'status' => 'active', 'started_at' => $now, 'heartbeat_at' => $now), array('%d', '%d', '%s', '%s', '%s', '%s', '%s'));
        $room_id = (int) $wpdb->insert_id;
        $wpdb->query($wpdb->prepare("INSERT INTO {$t['presence']} (room_id,user_id,updated_at) VALUES (%d,%d,%s) ON DUPLICATE KEY UPDATE updated_at=VALUES(updated_at)", $room_id, $user_id, $now));
        $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
        $sent = 0;
        if ($group_id) { // a channel room has no members to notify
            $group = function_exists('sml_groups_group_payload') ? sml_groups_group_payload($group_id) : null;
            $group_name = $group['name'] ?? 'Your group';
            $link = $group['url'] ?? home_url('/groups/');
            $host = sml_gli_user_payload($user_id);
            $sent = apply_filters('sml_gli_notify_on_start', true, $group_id, $user_id)
                ? sml_gli_notify_group($group_id, $host['display_name'] . ' started “' . $title . '” live in ' . $group_name . '.', $link, $user_id)
                : 0;
        }
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t['rooms']} WHERE id=%d", $room_id), ARRAY_A);
        return array('room' => sml_gli_room_payload($row), 'notified' => $sent);
    }
}
if (!function_exists('sml_gli_stop')) {
    function sml_gli_stop(WP_REST_Request $request) {
        global $wpdb;
        $t = sml_gli_tables();
        $room_id = absint($request->get_param('room_id'));
        $user_id = get_current_user_id();
        if (!$room_id) {
            // The studio sends group_id: end the caller's active room in that group.
            $group_id = absint($request->get_param('group_id'));
            $room_id = (int) $wpdb->get_var($wpdb->prepare("SELECT id FROM {$t['rooms']} WHERE group_id=%d AND host_id=%d AND status='active' ORDER BY id DESC LIMIT 1", $group_id, $user_id));
            if (!$room_id) { return array('ended' => true, 'note' => 'no active room'); }
        }
        $room = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t['rooms']} WHERE id=%d", $room_id), ARRAY_A);
        if (!$room) { return new WP_Error('sml_gli_room', 'Live room not found.', array('status' => 404)); }
        $can_manage = (int) $room['group_id'] > 0 && function_exists('sml_groups_current_user_can_manage') && sml_groups_current_user_can_manage((int) $room['group_id']);
        if ((int) $room['host_id'] !== $user_id && !$can_manage && !current_user_can('manage_options')) { return new WP_Error('sml_gli_host', 'Only the host or group team can end this room.', array('status' => 403)); }
        $wpdb->update($t['rooms'], array('status' => 'ended', 'ended_at' => current_time('mysql', true)), array('id' => (int) $room_id), array('%s', '%s'), array('%d'));
        $wpdb->delete($t['presence'], array('room_id' => (int) $room_id), array('%d'));
        return array('ended' => true, 'room_id' => (int) $room_id);
    }
}
if (!function_exists('sml_gli_poll')) {
    function sml_gli_poll(WP_REST_Request $request) {
        global $wpdb;
        $room_id = absint($request->get_param('room_id'));
        $after = absint($request->get_param('after'));
        $t = sml_gli_tables();
        $room = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t['rooms']} WHERE id=%d", $room_id), ARRAY_A);
        if (!$room || !sml_gli_room_access($room, true)) { return new WP_Error('sml_gli_room', 'This live room is unavailable.', array('status' => 404)); }
        if ($room['status'] !== 'active') { return array('ended' => true, 'signals' => array(), 'peers' => array()); }
        $user_id = get_current_user_id();
        $now = current_time('mysql', true);
        $wpdb->query($wpdb->prepare("INSERT INTO {$t['presence']} (room_id,user_id,updated_at) VALUES (%d,%d,%s) ON DUPLICATE KEY UPDATE updated_at=VALUES(updated_at)", $room_id, $user_id, $now));
        if ((int) $room['host_id'] === $user_id) { $wpdb->update($t['rooms'], array('heartbeat_at' => $now), array('id' => $room_id), array('%s'), array('%d')); }
        $cutoff = gmdate('Y-m-d H:i:s', time() - 40);
        $peer_ids = $wpdb->get_col($wpdb->prepare("SELECT user_id FROM {$t['presence']} WHERE room_id=%d AND updated_at >= %s", $room_id, $cutoff));
        $signals = $wpdb->get_results($wpdb->prepare("SELECT id,from_user,to_user,signal_type,payload FROM {$t['signals']} WHERE room_id=%d AND to_user=%d AND id>%d ORDER BY id ASC LIMIT 100", $room_id, $user_id, $after), ARRAY_A);
        foreach ($signals ?: array() as &$signal) { $signal['id'] = (int) $signal['id']; $signal['from_user'] = (int) $signal['from_user']; $signal['to_user'] = (int) $signal['to_user']; $signal['payload'] = json_decode($signal['payload'], true); }
        unset($signal);
        return array('room' => sml_gli_room_payload($room), 'ended' => false, 'signals' => $signals ?: array(), 'peers' => array_map('sml_gli_user_payload', array_map('absint', $peer_ids ?: array())));
    }
}
if (!function_exists('sml_gli_signal')) {
    function sml_gli_signal(WP_REST_Request $request) {
        global $wpdb;
        $room_id = absint($request->get_param('room_id')); $to = absint($request->get_param('to_user'));
        $type = sanitize_key((string) $request->get_param('signal_type')); $payload = $request->get_param('payload');
        if (!in_array($type, array('offer', 'answer', 'ice'), true) || !$to || !is_array($payload)) { return new WP_Error('sml_gli_signal', 'Invalid live-room signal.', array('status' => 400)); }
        $t = sml_gli_tables(); $room = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t['rooms']} WHERE id=%d AND status='active'", $room_id), ARRAY_A);
        if (!$room || !sml_gli_room_access($room, true)) { return new WP_Error('sml_gli_room', 'Room unavailable.', array('status' => 404)); }
        $wpdb->insert($t['signals'], array('room_id' => $room_id, 'from_user' => get_current_user_id(), 'to_user' => $to, 'signal_type' => $type, 'payload' => wp_json_encode($payload), 'created_at' => current_time('mysql', true)), array('%d', '%d', '%d', '%s', '%s', '%s'));
        return array('sent' => true, 'id' => (int) $wpdb->insert_id);
    }
}

add_action('rest_api_init', function () {
    if (function_exists('sml_gli_frontend')) { return; } // the full WPCode snippet is active again: let it own the namespace
    sml_gli_ensure_tables();
    $auth = array('permission_callback' => 'is_user_logged_in');
    register_rest_route('sml-group-live/v1', '/rooms',  array_merge($auth, array('methods' => 'GET',  'callback' => 'sml_gli_rooms')));
    register_rest_route('sml-group-live/v1', '/start',  array_merge($auth, array('methods' => 'POST', 'callback' => 'sml_gli_start')));
    register_rest_route('sml-group-live/v1', '/stop',   array_merge($auth, array('methods' => 'POST', 'callback' => 'sml_gli_stop')));
    register_rest_route('sml-group-live/v1', '/poll',   array_merge($auth, array('methods' => 'GET',  'callback' => 'sml_gli_poll')));
    register_rest_route('sml-group-live/v1', '/signal', array_merge($auth, array('methods' => 'POST', 'callback' => 'sml_gli_signal')));
}, 20);
