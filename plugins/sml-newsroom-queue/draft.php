<?php
namespace StockMarketLoop\NewsroomQueue;

/** Only this explicit event classification can select a newsroom desk. */
function desk_for_event(string $type): string {
    $map = array(
        'news' => 'SML News', 'earnings' => 'Earnings Desk', 'earnings_preview' => 'Earnings Desk',
        'sec_filing' => 'Filings & Actions', 'corporate_action' => 'Filings & Actions',
        'options_flow' => 'Options Flow', 'unusual_options' => 'Options Flow',
        'gamma' => 'Gamma & Volatility', 'volatility' => 'Gamma & Volatility',
        'analyst_rating' => 'Analyst & Valuation', 'valuation' => 'Analyst & Valuation',
        'institutional_ownership' => 'Institutional Ledger', 'insider_activity' => 'Insider Activity',
        'short_interest' => 'Short Interest', 'macro' => 'Macro & Policy',
        'semiconductors_ai' => 'Semiconductors & AI', 'biotech_healthcare' => 'Biotech & Healthcare',
        'energy_commodities' => 'Energy & Commodities', 'financials_banks' => 'Banks & Financials',
        'consumer_retail' => 'Consumer & Retail', 'small_cap_risk' => 'Small-Cap Risk',
        'verified_trader_spotlight' => 'Retail Trader Spotlight', 'education' => 'Stock Market Beginners',
    );
    if (!isset($map[$type])) throw new \InvalidArgumentException('Unmapped event type: editorial desk selection required.');
    return $map[$type];
}

function draft_author(array $event): array {
    $desk = desk_for_event($event['event_type']);
    // The active Author Guard registry, not the older duplicate provisioner registry.
    $registry = get_option('sml_nag_author_ids', array());
    $id = is_array($registry) ? (int) ($registry[$desk] ?? 0) : 0;
    $user = $id ? get_user_by('id', $id) : false;
    if (!$user || !user_can($user, 'edit_posts') ||
        html_entity_decode($user->display_name, ENT_QUOTES, 'UTF-8') !== $desk) {
        throw new \InvalidArgumentException('Desk author is missing or mismatched; no fallback author was assigned.');
    }
    return array('id' => $id, 'name' => $desk);
}

function save_draft(\WP_REST_Request $request) {
    global $wpdb;
    if (strlen($request->get_body()) > 65536) return new \WP_Error('payload_too_large', 'Maximum 64 KB.', array('status' => 413));
    $input = $request->get_json_params();
    if (!is_array($input) || array_diff(array_keys($input), array('payload_hash', 'article'))) {
        return new \WP_Error('invalid_draft', 'Only article and payload_hash are accepted. Status, author and media cannot be overridden.', array('status' => 422));
    }
    $id = absint($request['id']);
    $lock = 'sml_nrv1_' . $id;
    if (1 !== (int) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s,0)', $lock))) {
        return new \WP_Error('draft_busy', 'Another draft request is active. Retry later.', array('status' => 409));
    }
    try {
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . table_name() . ' WHERE id=%d', $id), ARRAY_A);
        if (!$row) return new \WP_Error('event_not_found', 'Event not found.', array('status' => 404));
        if (!is_string($input['payload_hash'] ?? null) || !hash_equals($row['payload_hash'], $input['payload_hash'])) {
            return new \WP_Error('event_changed', 'Evidence hash does not match.', array('status' => 409));
        }
        $existing = get_posts(array('post_type' => 'post', 'post_status' => array('draft','pending','publish','future','private','trash'),
            'meta_key' => '_sml_newsroom_event_key', 'meta_value' => $row['event_key'], 'numberposts' => 1));
        if ($existing) return draft_response($existing[0], true);
        if (strtotime($row['expires_at'] . ' UTC') <= time()) return new \WP_Error('event_expired', 'Refresh evidence before drafting.', array('status' => 409));
        $event = json_decode($row['payload'], true, 64, JSON_THROW_ON_ERROR);
        $author = draft_author($event);
        $article = $input['article'] ?? null;
        if (!is_array($article) || array_diff(array_keys($article), array('title','subtitle','excerpt','body_html','focus_keyword','meta_description'))) {
            throw new \InvalidArgumentException('Invalid article fields.');
        }
        $clean = array();
        foreach (array('title'=>140,'subtitle'=>220,'excerpt'=>400,'focus_keyword'=>100,'meta_description'=>180) as $field=>$max) {
            if (!is_string($article[$field] ?? null)) throw new \InvalidArgumentException('Missing ' . $field);
            $clean[$field] = sanitize_text_field($article[$field]);
            if (!$clean[$field] || mb_strlen($clean[$field]) > $max) throw new \InvalidArgumentException('Invalid ' . $field);
        }
        if (!is_string($article['body_html'] ?? null) || strlen($article['body_html']) > 40000) throw new \InvalidArgumentException('Invalid body.');
        $clean['body_html'] = wp_kses($article['body_html'], array(
            'p'=>array(), 'h2'=>array(), 'h3'=>array(), 'ul'=>array(), 'ol'=>array(), 'li'=>array(), 'strong'=>array(), 'em'=>array(), 'blockquote'=>array()
        ));
        if (str_word_count(wp_strip_all_tags($clean['body_html'])) < 80) throw new \InvalidArgumentException('Draft requires substantive text.');
        $clean['body_html'] .= '<p><strong>Source:</strong> <a href="' . esc_url($event['source_url']) . '">Original evidence</a>. Evidence observed ' . esc_html($event['observed_at']) . '.</p>';
        // Scope to this insertion only. Existing Author Guard heuristics remain
        // unchanged for all other posts; no role or capability is elevated.
        $force = static function($data, $postarr) use ($author, $row) {
            if (empty($postarr['ID']) && ($postarr['meta_input']['_sml_newsroom_event_key'] ?? '') === $row['event_key']) {
                $data['post_status'] = 'draft'; $data['post_author'] = $author['id'];
            }
            return $data;
        };
        add_filter('wp_insert_post_data', $force, PHP_INT_MAX, 2);
        try {
            $post_id = wp_insert_post(wp_slash(array(
                'post_type'=>'post', 'post_status'=>'draft', 'post_author'=>$author['id'],
                'post_title'=>$clean['title'], 'post_excerpt'=>$clean['excerpt'], 'post_content'=>$clean['body_html'],
                'meta_input'=>array(
                    '_sml_newsroom_event_key'=>$row['event_key'], '_sml_newsroom_evidence_hash'=>$row['payload_hash'],
                    '_sml_newsroom_desk'=>$author['name'], '_sml_newsroom_review'=>'required',
                    '_sml_newsroom_media_review'=>'required', '_sml_subtitle'=>$clean['subtitle'],
                    'rank_math_title'=>$clean['title'], 'rank_math_description'=>$clean['meta_description'],
                    'rank_math_focus_keyword'=>$clean['focus_keyword']
                )
            )), true);
        } finally { remove_filter('wp_insert_post_data', $force, PHP_INT_MAX); }
        if (is_wp_error($post_id)) return new \WP_Error('draft_failed', 'WordPress could not save draft.', array('status'=>503));
        return draft_response(get_post($post_id), false);
    } catch (\InvalidArgumentException | \JsonException $error) {
        return new \WP_Error('invalid_draft', $error->getMessage(), array('status'=>422));
    } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); }
}

function draft_response($post, bool $duplicate) {
    return new \WP_REST_Response(array('post_id'=>(int)$post->ID, 'status'=>$post->post_status,
        'author_id'=>(int)$post->post_author, 'duplicate'=>$duplicate,
        'edit_url'=>admin_url('post.php?post=' . (int)$post->ID . '&action=edit')), 200, array('Cache-Control'=>'no-store'));
}
