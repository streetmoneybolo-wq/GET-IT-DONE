<?php
/**
 * Plugin Name: SML Newsroom Review Queue
 * Description: Isolated evidence queue and manually requested drafts. No automatic publishing or deletion.
 * Version: 0.2.0
 */
namespace StockMarketLoop\NewsroomQueue;
defined('ABSPATH') || exit;
require_once __DIR__ . '/event.php';
require_once __DIR__ . '/draft.php';
require_once __DIR__ . '/admin.php';

function table_name(): string {
    global $wpdb;
    return $wpdb->prefix . 'sml_newsroom_review_events';
}

register_activation_hook(__FILE__, static function () {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $table = table_name();
    $charset = $wpdb->get_charset_collate();
    dbDelta("CREATE TABLE {$table} (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        event_key char(64) NOT NULL,
        payload_hash char(64) NOT NULL,
        payload longtext NOT NULL,
        created_by bigint(20) unsigned NOT NULL,
        created_at datetime NOT NULL,
        expires_at datetime NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY event_key (event_key),
        KEY expires_at (expires_at)
    ) {$charset};");
});

add_action('rest_api_init', static function () {
    register_rest_route('sml-newsroom-review/v1', '/events', array(
        array('methods' => 'POST', 'permission_callback' => __NAMESPACE__ . '\\can_manage',
              'callback' => __NAMESPACE__ . '\\enqueue'),
        array('methods' => 'GET', 'permission_callback' => __NAMESPACE__ . '\\can_draft',
              'callback' => __NAMESPACE__ . '\\list_events'),
    ));
    register_rest_route('sml-newsroom-review/v1', '/events/(?P<id>\d+)/draft', array(
        'methods'=>'POST', 'permission_callback'=>__NAMESPACE__ . '\\can_draft', 'callback'=>__NAMESPACE__ . '\\save_draft'
    ));
});

function can_manage(): bool { return current_user_can('manage_options'); }

function can_draft(): bool {
    if (can_manage()) return true;
    $id = (int) get_option('sml_newsroom_review_service_user_id', 0);
    return $id > 0 && get_current_user_id() === $id && current_user_can('edit_posts');
}

function enqueue(\WP_REST_Request $request) {
    global $wpdb;
    if (strlen($request->get_body()) > 65536) return new \WP_Error('payload_too_large', 'Maximum request size is 64 KB.', array('status' => 413));
    try {
        $input = $request->get_json_params();
        if (!is_array($input)) throw new \InvalidArgumentException('Expected JSON object');
        $event = normalize_event($input, time());
        $payload = canonical_json($event);
    } catch (\InvalidArgumentException | \JsonException $error) {
        return new \WP_Error('invalid_event', $error->getMessage(), array('status' => 422));
    }
    $table = table_name();
    $hash = hash('sha256', $payload);
    // Unique database key arbitrates simultaneous retries. Never overwrite an existing event.
    $written = $wpdb->query($wpdb->prepare(
        "INSERT INTO {$table} (event_key,payload_hash,payload,created_by,created_at,expires_at)
         VALUES (%s,%s,%s,%d,%s,%s) ON DUPLICATE KEY UPDATE event_key=VALUES(event_key)",
        $event['event_key'], $hash, $payload, get_current_user_id(), gmdate('Y-m-d H:i:s'),
        gmdate('Y-m-d H:i:s', strtotime($event['expires_at']))
    ));
    if ($written === false) return new \WP_Error('queue_unavailable', 'Could not store event.', array('status' => 503));
    $row = $wpdb->get_row($wpdb->prepare("SELECT id,payload_hash FROM {$table} WHERE event_key=%s", $event['event_key']), ARRAY_A);
    if (!$row) return new \WP_Error('queue_unavailable', 'Could not verify event.', array('status' => 503));
    if (!hash_equals($row['payload_hash'], $hash)) {
        return new \WP_Error('event_revision_conflict', 'This event already exists with different evidence. Review the original; it has not been overwritten.', array('status' => 409, 'event_id' => (int) $row['id']));
    }
    return new \WP_REST_Response(array('id' => (int) $row['id'], 'event_key' => $event['event_key'], 'review_state' => 'needs_editorial_review', 'published' => false), 200, array('Cache-Control' => 'no-store'));
}

function list_events(\WP_REST_Request $request) {
    global $wpdb;
    $after = max(0, (int) $request->get_param('after'));
    $rows = $wpdb->get_results($wpdb->prepare('SELECT id,payload_hash,payload,created_at,expires_at FROM ' . table_name() . ' WHERE id>%d ORDER BY id ASC LIMIT 50', $after), ARRAY_A);
    if ($wpdb->last_error) return new \WP_Error('queue_unavailable', 'Could not read queue.', array('status' => 503));
    $items = array();
    foreach ($rows as $row) {
        $event = json_decode($row['payload'], true);
        try { $author = draft_author($event); } catch (\Throwable $e) { $author = null; }
        $drafts = get_posts(array('post_type'=>'post','post_status'=>array('draft','pending','publish','future','private','trash'),
            'meta_key'=>'_sml_newsroom_event_key','meta_value'=>$event['event_key'] ?? '', 'numberposts'=>1));
        $draft = $drafts ? array('post_id'=>(int)$drafts[0]->ID,'status'=>$drafts[0]->post_status,'author_id'=>(int)$drafts[0]->post_author) : null;
        $items[] = array('id' => (int) $row['id'], 'payload_hash'=>$row['payload_hash'], 'event' => $event, 'author'=>$author, 'draft'=>$draft,
            'expired' => strtotime($row['expires_at'] . ' UTC') <= time(), 'created_at' => $row['created_at'] . 'Z');
    }
    return new \WP_REST_Response(array('items' => $items, 'next_after' => $items ? end($items)['id'] : $after, 'mode' => 'review_only'), 200, array('Cache-Control' => 'no-store'));
}
