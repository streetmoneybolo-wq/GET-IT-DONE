<?php
namespace StockMarketLoop\NewsroomQueue;
add_action('admin_menu', static function() {
    add_management_page('SML Newsroom Review', 'SML Newsroom Review', 'manage_options', 'sml-newsroom-review', __NAMESPACE__ . '\\admin_page');
});
function admin_page() {
    if (!can_manage()) return;
    global $wpdb;
    echo '<div class="wrap"><h1>SML Newsroom Review</h1><p>Draft-only pilot. Nothing on this page publishes an article or calls an AI provider. Evidence, author attribution and image rights require editorial review.</p>';
    $rows = $wpdb->get_results('SELECT id,event_key,payload,expires_at FROM ' . table_name() . ' ORDER BY id DESC LIMIT 50', ARRAY_A);
    echo '<h2>Recent evidence events</h2><table class="widefat striped"><thead><tr><th>ID</th><th>Event</th><th>Desk</th><th>Evidence</th><th>Draft</th></tr></thead><tbody>';
    foreach ($rows ?: array() as $row) {
        $event = json_decode($row['payload'], true);
        try { $desk = draft_author($event)['name']; } catch (\Throwable $e) { $desk = 'Needs desk review'; }
        $posts = get_posts(array('post_type'=>'post','post_status'=>array('draft','pending','publish','future','private','trash'),
            'meta_key'=>'_sml_newsroom_event_key','meta_value'=>$row['event_key'],'numberposts'=>1));
        echo '<tr><td>' . (int)$row['id'] . '</td><td>' . esc_html($event['title'] ?? 'Invalid event') . '</td><td>' . esc_html($desk) . '</td><td>' .
            (strtotime($row['expires_at'] . ' UTC') <= time() ? 'Expired' : 'Requires fact check') . '</td><td>';
        if ($posts) echo '<a href="' . esc_url(get_edit_post_link($posts[0]->ID)) . '">Review ' . esc_html($posts[0]->post_status) . '</a>';
        else echo 'Not generated';
        echo '</td></tr>';
    }
    echo '</tbody></table><h2>Duplicate candidates</h2><p>These are flags, not deletion decisions. Different events about the same ticker remain separate.</p>';
    $reviews = get_option('sml_market_content_duplicate_review_v1', array());
    echo '<ul>';
    foreach (is_array($reviews) ? array_slice($reviews, 0, 100) : array() as $review) {
        if (!is_array($review)) continue;
        echo '<li>' . esc_html($review['ticker'] ?? '') . ': ';
        foreach ($review['candidate_ids'] ?? array() as $id) {
            echo '<a href="' . esc_url(admin_url('post.php?post=' . absint($id) . '&action=edit')) . '">Post ' . absint($id) . '</a> ';
        }
        echo '</li>';
    }
    echo '</ul></div>';
}
