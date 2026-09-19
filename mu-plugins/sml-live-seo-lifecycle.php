<?php
/**
 * Plugin Name: SML Live SEO Lifecycle
 * Description: Drives the scheduled-live record (WPCode 7347, user meta _sml_scheduled_live) through scheduled → live → ended from the real broadcast signals, so the video SEO plugin (sml-google-sitemaps: self-canonical live page, BroadcastEvent isLiveBroadcast, video sitemap entry, Indexing API ping, canonical hand-off to the recording) actually sees a stream go live and end. Before this nothing ever changed a record's status; a record more than a day past its scheduled time was treated as stale and the live page fell back to the generic /live/ SEO even while the creator was on air. 2026-09-15.
 * Version: 1.1.1
 * Author: StockMarketLoop
 */

if (!defined('ABSPATH')) { exit; }

function sml_lsl_ready() {
    return function_exists('sml_scheduled_live_row') && function_exists('sml_scheduled_live_store')
        && function_exists('sml_scheduled_live_new_id') && function_exists('sml_scheduled_live_library');
}

/** The record to flip live: the current one, else the newest not-ended record in the library, else a fresh one. */
function sml_lsl_pick_record($user_id) {
    $cur = sml_scheduled_live_row($user_id);
    if (is_array($cur) && !empty($cur['id']) && !in_array((string) ($cur['status'] ?? ''), array('ended', 'cancelled'), true)) { return $cur; }
    $best = null;
    foreach (sml_scheduled_live_library($user_id) as $row) {
        if (!is_array($row) || empty($row['id']) || in_array((string) ($row['status'] ?? ''), array('ended', 'cancelled'), true)) { continue; }
        if (!$best || strcmp((string) ($row['created_at'] ?? ''), (string) ($best['created_at'] ?? '')) > 0) { $best = $row; }
    }
    return $best;
}

function sml_lsl_mark_live($user_id, $title_hint = '') {
    if (!sml_lsl_ready()) { return null; }
    $user_id = (int) $user_id;
    $now = gmdate('c');
    $row = sml_lsl_pick_record($user_id);
    if (!$row) {
        $handle = function_exists('sml_ppe_public_handle') ? (string) sml_ppe_public_handle($user_id) : '';
        $row = array(
            'id' => sml_scheduled_live_new_id(),
            'status' => 'live',
            'title' => $title_hint !== '' ? $title_hint : ('Live on StockMarketLoop' . ($handle ? ' — @' . ltrim($handle, '@') : '')),
            'description' => '',
            'ticker' => '',
            'thumbnail_url' => '',
            'scheduled_at' => $now,
            'visibility' => 'public',
            'recording_status' => 'not_started',
            'recording_url' => '',
            'created_at' => $now,
            'updated_at' => $now,
        );
    }
    if ((string) ($row['status'] ?? '') === 'live') { return $row; }   // reconnect: already live
    $row['status'] = 'live';
    $starts = strtotime((string) ($row['scheduled_at'] ?? ''));
    // BroadcastEvent.startDate comes from scheduled_at; a stale or missing start becomes "now".
    if (!$starts || $starts < time() - 15 * MINUTE_IN_SECONDS) { $row['scheduled_at'] = $now; }
    $row['started_at'] = $now;
    $row['updated_at'] = $now;
    sml_scheduled_live_store($user_id, $row, true);
    update_option('sml_last_live_seo_lifecycle', array('time' => current_time('mysql', true), 'user_id' => $user_id, 'event' => 'live', 'stream_id' => $row['id']), false);
    do_action('sml_scheduled_live_status_changed', $user_id, $row, 'live');
    return $row;
}

/**
 * End a creator's live stream. Every record still marked live is closed, not only the current
 * one: scheduling the next stream moves the current pointer, which used to orphan a stream that
 * was live at that moment (it then showed "live" forever). $ended_at lets the stale sweep use the
 * last real evidence instead of "now".
 */
function sml_lsl_end_row($user_id, array $row, $ended_at = '', $reason = '') {
    $now = gmdate('c');
    $row['status'] = 'ended';
    $row['ended_at'] = $ended_at !== '' ? $ended_at : $now;
    $row['updated_at'] = $now;
    if ($reason !== '') { $row['end_reason'] = $reason; }
    sml_scheduled_live_store($user_id, $row, false);
    $cur = sml_scheduled_live_row($user_id);
    if (is_array($cur) && !empty($cur['id']) && (string) $cur['id'] === (string) $row['id'] && function_exists('sml_scheduled_live_set_next_current')) {
        sml_scheduled_live_set_next_current($user_id);   // point the Watch Page at the next upcoming schedule (or clear it)
    }
    update_option('sml_last_live_seo_lifecycle', array('time' => current_time('mysql', true), 'user_id' => (int) $user_id, 'event' => 'ended', 'stream_id' => $row['id'], 'reason' => $reason), false);
    do_action('sml_scheduled_live_status_changed', (int) $user_id, $row, 'ended');
    return $row;
}

function sml_lsl_mark_ended($user_id) {
    if (!sml_lsl_ready()) { return null; }
    $user_id = (int) $user_id;
    $ended = null;
    foreach (sml_scheduled_live_library($user_id) as $row) {
        if (is_array($row) && !empty($row['id']) && (string) ($row['status'] ?? '') === 'live') { $ended = sml_lsl_end_row($user_id, $row); }
    }
    $cur = sml_scheduled_live_row($user_id);   /* the pointer can hold a live row that is not in the library */
    if (is_array($cur) && !empty($cur['id']) && (string) ($cur['status'] ?? '') === 'live') { $ended = sml_lsl_end_row($user_id, $cur); }
    return $ended;
}

/* ---- signals: the encoder (rtmp-keys.php actions) ---- */
add_action('sml_stream_went_live', function ($row, $was_live, $feed) {
    if ($feed !== 'a' || !is_array($row) || empty($row['user_id'])) { return; }
    sml_lsl_mark_live((int) $row['user_id']);
}, 5, 3);
add_action('sml_stream_ended', function ($row, $was_live, $feed) {
    if ($feed !== 'a' || !is_array($row) || empty($row['user_id'])) { return; }
    sml_lsl_mark_ended((int) $row['user_id']);
}, 5, 3);

/* ---- signals: the studio's browser go-live (group live rooms) ---- */
add_filter('rest_request_after_callbacks', function ($response, $handler, $request) {
    if (!$request instanceof WP_REST_Request || strtoupper($request->get_method()) !== 'POST' || is_wp_error($response)) { return $response; }
    $route = $request->get_route();
    $rest = rest_ensure_response($response);
    if ((int) $rest->get_status() >= 300 || !is_user_logged_in()) { return $response; }
    if ($route === '/sml-group-live/v1/start' || $route === '/sml/v1/group/live-room/start') {
        $visibility = sanitize_key((string) ($request->get_param('visibility') ?: 'public'));
        if ($visibility === 'public') { sml_lsl_mark_live(get_current_user_id(), sanitize_text_field((string) $request->get_param('title'))); }
    } elseif ($route === '/sml-group-live/v1/stop' || $route === '/sml/v1/group/live-room/end') {
        sml_lsl_mark_ended(get_current_user_id());
    }
    return $response;
}, 5, 3);

/* ---- safety net: close streams whose end signal never arrived (live-room times are UTC: current_time('mysql', true)) ----
   A stream stays live only while something proves it: an active studio room with a fresh
   heartbeat, or the creator's encoder key reporting is_live. With neither for 6 hours, it is
   closed. ended_at is the last real evidence (the matching room's last heartbeat), otherwise the
   start time, and end_reason says it was closed automatically — no length is invented. */
function sml_lsl_on_air($user_id) {
    global $wpdb;
    $rooms = $wpdb->prefix . 'sml_group_live_rooms';
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $rooms))) {
        $beat = $wpdb->get_var($wpdb->prepare("SELECT MAX(heartbeat_at) FROM {$rooms} WHERE host_id=%d AND status='active'", $user_id));
        if ($beat && strtotime($beat . ' UTC') > time() - 10 * MINUTE_IN_SECONDS) { return true; }
    }
    if (function_exists('sml_rtmp_table')) {
        $keys = sml_rtmp_table();
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $keys)) && (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$keys} WHERE user_id=%d AND is_live=1", $user_id))) { return true; }
    }
    return false;
}

function sml_lsl_last_evidence($user_id, array $row) {
    global $wpdb;
    $start = strtotime((string) ($row['started_at'] ?? $row['scheduled_at'] ?? ''));
    if (!$start) { return ''; }
    $rooms = $wpdb->prefix . 'sml_group_live_rooms';
    if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $rooms))) {
        foreach ((array) $wpdb->get_results($wpdb->prepare("SELECT started_at, heartbeat_at FROM {$rooms} WHERE host_id=%d ORDER BY id DESC LIMIT 50", $user_id), ARRAY_A) as $r) {
            $rs = strtotime($r['started_at'] . ' UTC');
            $hb = strtotime($r['heartbeat_at'] . ' UTC');
            if ($rs && abs($rs - $start) <= 15 * MINUTE_IN_SECONDS && $hb > $start) { return gmdate('c', $hb); }
        }
    }
    return gmdate('c', $start);
}

function sml_lsl_sweep_stale($only_user = 0) {
    global $wpdb;
    if (!sml_lsl_ready()) { return array(); }
    $closed = array();
    $users = $only_user ? array((int) $only_user) : array_map('intval', (array) $wpdb->get_col($wpdb->prepare("SELECT DISTINCT user_id FROM {$wpdb->usermeta} WHERE meta_key IN (%s, %s)", '_sml_scheduled_live_library', '_sml_scheduled_live')));
    foreach ($users as $uid) {
        if (sml_lsl_on_air($uid)) { continue; }
        $rows = sml_scheduled_live_library($uid);
        $cur = sml_scheduled_live_row($uid);
        if (is_array($cur) && !empty($cur['id']) && empty($rows[$cur['id']])) { $rows[$cur['id']] = $cur; }
        foreach ($rows as $row) {
            if (!is_array($row) || empty($row['id']) || (string) ($row['status'] ?? '') !== 'live') { continue; }
            $seen = max((int) strtotime((string) ($row['updated_at'] ?? '')), (int) strtotime((string) ($row['started_at'] ?? '')));
            if ($seen > time() - 6 * HOUR_IN_SECONDS) { continue; }
            sml_lsl_end_row($uid, $row, sml_lsl_last_evidence($uid, $row), 'auto_closed_no_signal');
            $closed[] = array('user_id' => $uid, 'stream_id' => $row['id']);
        }
    }
    return $closed;
}
add_action('init', function () {
    if (!wp_next_scheduled('sml_lsl_sweep_stale')) { wp_schedule_event(time() + 300, 'hourly', 'sml_lsl_sweep_stale'); }
});
add_action('sml_lsl_sweep_stale', function () { sml_lsl_sweep_stale(); });
