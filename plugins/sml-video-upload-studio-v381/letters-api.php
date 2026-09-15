<?php
/**
 * Loop Letters - control plane (Phase 1).
 * Drafts, versions, publishing, access control, comments,
 * read tracking, ticker feed and price snapshots.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_letters_publication_defaults')) {
    function sml_letters_publication_defaults($user_id = 0) {
        $user_id = $user_id ?: get_current_user_id();
        $user = get_userdata($user_id);
        $name = $user ? ($user->display_name ?: $user->user_login) : 'Creator';
        $email = $user ? $user->user_email : '';
        return array(
            'publication_name' => $name . ' Letters',
            'byline_name' => $name,
            'description' => '',
            'brand_color' => '#2b6cff',
            'default_visibility' => 'public',
            'default_disclosure' => '',
            'email_delivery' => array(
                'enabled' => false,
                'provider' => 'manual',
                'from_name' => $name,
                'from_email' => $email,
                'reply_to' => $email,
                'header_html' => '',
                'footer_html' => '',
                'opt_out_url' => home_url('/newsletter-opt-out/'),
                'require_confirmation' => true,
                'welcome_free' => '',
                'welcome_paid' => '',
                'expired_email' => '',
                'renewal_email' => '',
            ),
            'stripe_import' => array(
                'connected' => false,
                'account_label' => '',
                'mode' => 'test',
                'price_ids' => '',
                'last_import_at' => '',
                'last_import_count' => 0,
            ),
            'plans' => array(
                'free_enabled' => true,
                'monthly_enabled' => false,
                'monthly_name' => 'Monthly',
                'monthly_price' => '',
                'monthly_price_id' => '',
                'annual_enabled' => false,
                'annual_name' => 'Annual',
                'annual_price' => '',
                'annual_price_id' => '',
                'founding_enabled' => false,
                'founding_name' => 'Founding Member',
                'founding_price' => '',
                'founding_price_id' => '',
            ),
            'paywalling' => array(
                'default_paywall' => 'preview_then_subscribe',
                'allow_search_excerpt' => true,
                'paid_preview_words' => 250,
            ),
            'billing' => array(
                'tax_region' => '',
                'vat_note' => '',
            ),
            'invoice_reports' => array(
                'requests' => array(),
            ),
        );
    }
}

if (!function_exists('sml_letters_publication_settings')) {
    function sml_letters_publication_settings($user_id = 0) {
        $user_id = $user_id ?: get_current_user_id();
        $saved = get_user_meta($user_id, 'sml_letters_publication_settings', true);
        $saved = is_array($saved) ? $saved : array();
        return array_replace_recursive(sml_letters_publication_defaults($user_id), $saved);
    }
}

if (!function_exists('sml_letters_is_subscriber')) {
    function sml_letters_is_subscriber($reader_id, $author_id) {
        if (function_exists('sml_members_is_following')) {
            return (bool) sml_members_is_following($reader_id, $author_id);
        }
        $followers = get_user_meta((int) $author_id, 'sml_followers', true);
        $followers = is_array($followers) ? array_map('intval', $followers) : array();
        return in_array((int) $reader_id, $followers, true);
    }
}

/* ==================================================================
 * Blocks: parsing, rendering, derived fields
 * ================================================================== */

if (!function_exists('sml_letters_blocks')) {
    function sml_letters_blocks($row) {
        $blocks = json_decode((string) ($row['blocks'] ?? ''), true);
        return is_array($blocks) ? $blocks : array();
    }
}

if (!function_exists('sml_letters_sanitize_custom_css')) {
    /**
     * Custom CSS is rendered only inside a sandboxed iframe. Keep it bounded
     * and remove constructs that can escape the style element or make network
     * requests. The iframe boundary prevents selectors from affecting SML.
     */
    function sml_letters_sanitize_custom_css($css) {
        $css = substr((string) $css, 0, 30000);
        $css = preg_replace('#</?style\b[^>]*>#i', '', $css);
        $css = wp_strip_all_tags($css);
        $css = preg_replace('/@import\s+[^;]+;?/i', '', $css);
        $css = preg_replace('/url\s*\([^)]*\)/i', 'none', $css);
        $css = preg_replace('/(?:expression|javascript|behavior|-moz-binding)\s*[:(]/i', 'blocked:', $css);
        return trim($css);
    }
}

if (!function_exists('sml_letters_sanitize_custom_html')) {
    /** Allow useful article markup, but never executable or embedded content. */
    function sml_letters_sanitize_custom_html($html) {
        $html = preg_replace('#<(script|style|iframe|object|embed|form)\b[^>]*>.*?</\1\s*>#is', '', (string) $html);
        $allowed = wp_kses_allowed_html('post');
        foreach (array('div','section','article','main','header','footer','aside','span') as $tag) {
            $allowed[$tag] = array(
                'class' => true,
                'id' => true,
                'style' => true,
                'title' => true,
                'role' => true,
                'aria-label' => true,
                'aria-hidden' => true,
            );
        }
        foreach ($allowed as $tag => $attributes) {
            $allowed[$tag]['class'] = true;
            $allowed[$tag]['id'] = true;
            $allowed[$tag]['style'] = true;
        }
        unset($allowed['script'], $allowed['style'], $allowed['iframe'], $allowed['object'], $allowed['embed'], $allowed['form']);
        return wp_kses(substr($html, 0, 60000), $allowed);
    }
}

if (!function_exists('sml_letters_sanitize_blocks')) {
    function sml_letters_sanitize_blocks($blocks) {
        $clean = array();
        foreach (array_slice(array_values((array) $blocks), 0, 150) as $block) {
            if (!is_array($block)) {
                continue;
            }
            if (($block['type'] ?? '') === 'custom_code') {
                $clean[] = array(
                    'id' => sanitize_key((string) ($block['id'] ?? '')),
                    'type' => 'custom_code',
                    'html' => sml_letters_sanitize_custom_html($block['html'] ?? ''),
                    'css' => sml_letters_sanitize_custom_css($block['css'] ?? ''),
                    'height' => max(320, min(1600, (int) ($block['height'] ?? 720))),
                );
                continue;
            }
            // Existing blocks retain their established schema and behavior.
            $clean[] = $block;
        }
        return $clean;
    }
}

if (!function_exists('sml_letters_plaintext')) {
    function sml_letters_plaintext($blocks) {
        $out = array();
        foreach ($blocks as $block) {
            $type = $block['type'] ?? '';
            if ($type === 'heading' || $type === 'quote') {
                $out[] = (string) ($block['text'] ?? '');
            } elseif ($type === 'paragraph') {
                $text = '';
                foreach ((array) ($block['spans'] ?? array()) as $span) {
                    $text .= (string) ($span['text'] ?? '');
                }
                $out[] = $text ?: (string) ($block['text'] ?? '');
            } elseif ($type === 'list') {
                foreach ((array) ($block['items'] ?? array()) as $item) {
                    $out[] = '- ' . (string) $item;
                }
            } elseif ($type === 'custom_code') {
                $out[] = wp_strip_all_tags((string) ($block['html'] ?? ''));
            }
        }
        return trim(implode("\n\n", array_filter($out)));
    }
}

if (!function_exists('sml_letters_symbols_in_blocks')) {
    function sml_letters_symbols_in_blocks($blocks) {
        $symbols = array();
        foreach ($blocks as $block) {
            foreach (array('symbol') as $key) {
                if (!empty($block[$key])) {
                    $symbols[] = strtoupper(preg_replace('/[^A-Za-z]/', '', $block[$key]));
                }
            }
            foreach ((array) ($block['symbols'] ?? array()) as $symbol) {
                $symbols[] = strtoupper(preg_replace('/[^A-Za-z]/', '', $symbol));
            }
            foreach ((array) ($block['spans'] ?? array()) as $span) {
                if (($span['mark'] ?? '') === 'ticker' && !empty($span['symbol'])) {
                    $symbols[] = strtoupper(preg_replace('/[^A-Za-z]/', '', $span['symbol']));
                }
            }
            if (($block['type'] ?? '') === 'custom_code' && !empty($block['html'])) {
                if (preg_match_all('/\$([A-Za-z]{1,6})\b/', wp_strip_all_tags((string) $block['html']), $matches)) {
                    foreach ($matches[1] as $symbol) {
                        $symbols[] = strtoupper($symbol);
                    }
                }
            }
        }
        return array_values(array_unique(array_filter($symbols)));
    }
}

if (!function_exists('sml_letters_has_block')) {
    function sml_letters_has_block($blocks, $type) {
        foreach ($blocks as $block) {
            if (($block['type'] ?? '') === $type) {
                return true;
            }
        }
        return false;
    }
}

if (!function_exists('sml_letters_levels')) {
    function sml_letters_levels($blocks) {
        $levels = array();
        foreach ($blocks as $block) {
            if (($block['type'] ?? '') !== 'levels') {
                continue;
            }
            $symbol = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($block['symbol'] ?? '')));
            if (!$symbol) {
                continue;
            }
            $targets = array_values(array_map('floatval', (array) ($block['targets'] ?? array())));
            $levels[$symbol] = array(
                'entry' => isset($block['entry']) ? (float) $block['entry'] : null,
                'stop' => isset($block['stop']) ? (float) $block['stop'] : null,
                'target_1' => $targets[0] ?? null,
                'target_2' => $targets[1] ?? null,
            );
        }
        return $levels;
    }
}

if (!function_exists('sml_letters_render_html')) {
    /**
     * Server-side render. Interactive blocks become placeholders the reader
     * script hydrates, so email and SEO get real markup either way.
     */
    function sml_letters_render_html($blocks, $stop_at_paywall = false) {
        $html = '';
        foreach ($blocks as $block) {
            $type = $block['type'] ?? '';

            if ($type === 'paywall_marker') {
                if ($stop_at_paywall) {
                    return $html;
                }
                $html .= '<hr class="ll-paywall-line">';
                continue;
            }

            switch ($type) {
                case 'heading':
                    $level = max(2, min(4, (int) ($block['level'] ?? 2)));
                    $html .= '<h' . $level . '>' . esc_html((string) ($block['text'] ?? '')) . '</h' . $level . '>';
                    break;

                case 'paragraph':
                    $inner = '';
                    if (!empty($block['spans'])) {
                        foreach ($block['spans'] as $span) {
                            $text = esc_html((string) ($span['text'] ?? ''));
                            $mark = $span['mark'] ?? '';
                            if ($mark === 'ticker' && !empty($span['symbol'])) {
                                $symbol = strtoupper(preg_replace('/[^A-Za-z]/', '', $span['symbol']));
                                $inner .= '<a class="ll-ticker" href="' . esc_url(home_url('/ticker/' . strtolower($symbol) . '/')) . '">' . $text . '</a>';
                            } elseif ($mark === 'bold') {
                                $inner .= '<strong>' . $text . '</strong>';
                            } elseif ($mark === 'italic') {
                                $inner .= '<em>' . $text . '</em>';
                            } elseif ($mark === 'link' && !empty($span['href'])) {
                                $inner .= '<a href="' . esc_url($span['href']) . '" rel="nofollow noopener">' . $text . '</a>';
                            } else {
                                $inner .= $text;
                            }
                        }
                    } else {
                        $inner = esc_html((string) ($block['text'] ?? ''));
                    }
                    $html .= '<p>' . $inner . '</p>';
                    break;

                case 'list':
                    $tag = ($block['style'] ?? 'bullet') === 'number' ? 'ol' : 'ul';
                    $html .= '<' . $tag . '>';
                    foreach ((array) ($block['items'] ?? array()) as $item) {
                        $html .= '<li>' . esc_html((string) $item) . '</li>';
                    }
                    $html .= '</' . $tag . '>';
                    break;

                case 'quote':
                    $html .= '<blockquote>' . esc_html((string) ($block['text'] ?? '')) . '</blockquote>';
                    break;

                case 'image':
                    if (!empty($block['url'])) {
                        $html .= '<figure><img src="' . esc_url($block['url']) . '" alt="' . esc_attr((string) ($block['alt'] ?? '')) . '" loading="lazy">';
                        if (!empty($block['caption'])) {
                            $html .= '<figcaption>' . esc_html($block['caption']) . '</figcaption>';
                        }
                        $html .= '</figure>';
                    }
                    break;

                case 'ticker_card':
                    $symbol = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($block['symbol'] ?? '')));
                    if ($symbol) {
                        $html .= '<div class="ll-block ll-ticker-card" data-ll-ticker="' . esc_attr($symbol) . '">'
                            . '<span class="ll-sym">$' . esc_html($symbol) . '</span>'
                            . '<span class="ll-live" data-ll-price>Loading…</span></div>';
                    }
                    break;

                case 'chart':
                    $symbol = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($block['symbol'] ?? '')));
                    if ($symbol) {
                        $html .= '<div class="ll-block ll-chart" data-ll-chart="' . esc_attr($symbol) . '"'
                            . ' data-range="' . esc_attr((string) ($block['range'] ?? '3M')) . '"></div>';
                    }
                    break;

                case 'levels':
                    $symbol = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($block['symbol'] ?? '')));
                    $targets = (array) ($block['targets'] ?? array());
                    $html .= '<div class="ll-block ll-levels" data-ll-levels="' . esc_attr($symbol) . '">'
                        . '<div class="ll-levels-head">$' . esc_html($symbol) . ' levels'
                        . '<span class="ll-tf">' . esc_html((string) ($block['timeframe'] ?? '')) . '</span></div>'
                        . '<dl>'
                        . '<div><dt>Entry</dt><dd>' . esc_html((string) ($block['entry'] ?? '—')) . '</dd></div>'
                        . '<div><dt>Stop</dt><dd>' . esc_html((string) ($block['stop'] ?? '—')) . '</dd></div>'
                        . '<div><dt>Target 1</dt><dd>' . esc_html((string) ($targets[0] ?? '—')) . '</dd></div>'
                        . '<div><dt>Target 2</dt><dd>' . esc_html((string) ($targets[1] ?? '—')) . '</dd></div>'
                        . '</dl></div>';
                    break;

                case 'watchlist_button':
                    $symbols = array_map(function ($s) {
                        return strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $s));
                    }, (array) ($block['symbols'] ?? array()));
                    $symbols = array_filter($symbols);
                    if ($symbols) {
                        $html .= '<button class="ll-action" data-ll-watchlist="' . esc_attr(implode(',', $symbols)) . '">'
                            . 'Add ' . esc_html(implode(', ', $symbols)) . ' to watchlist</button>';
                    }
                    break;

                case 'alert_button':
                    $symbol = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($block['symbol'] ?? '')));
                    if ($symbol) {
                        $html .= '<button class="ll-action" data-ll-alert="' . esc_attr($symbol) . '"'
                            . ' data-trigger="' . esc_attr((string) ($block['trigger'] ?? 'above')) . '"'
                            . ' data-price="' . esc_attr((string) ($block['price'] ?? '')) . '">'
                            . 'Alert me ' . esc_html((string) ($block['trigger'] ?? 'above')) . ' '
                            . esc_html((string) ($block['price'] ?? '')) . '</button>';
                    }
                    break;

                case 'video':
                    $video_id = sanitize_key((string) ($block['video_id'] ?? ''));
                    if ($video_id) {
                        $html .= '<div class="ll-block ll-video"><a href="' . esc_url(home_url('/watch/' . $video_id . '/')) . '">Watch the video</a></div>';
                    }
                    break;

                case 'disclosure':
                    $html .= '<div class="ll-block ll-disclosure"><b>Author disclosure:</b> '
                        . esc_html((string) ($block['position'] ?? 'no position'))
                        . (!empty($block['size']) ? ' (' . esc_html($block['size']) . ')' : '')
                        . '. This is not financial advice.</div>';
                    break;

                case 'custom_code':
                    $custom_html = sml_letters_sanitize_custom_html($block['html'] ?? '');
                    $custom_css = sml_letters_sanitize_custom_css($block['css'] ?? '');
                    $height = max(320, min(1600, (int) ($block['height'] ?? 720)));
                    $document = '<!doctype html><html><head><meta charset="utf-8">'
                        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
                        . '<style>html,body{margin:0;min-height:100%;background:transparent;color:inherit}*{box-sizing:border-box}img,video{max-width:100%;height:auto}'
                        . $custom_css . '</style></head><body>' . $custom_html . '</body></html>';
                    $html .= '<iframe class="ll-custom-code" title="Custom article content" sandbox="" referrerpolicy="no-referrer" loading="lazy"'
                        . ' style="display:block;width:100%;height:' . esc_attr((string) $height) . 'px;border:0;background:transparent"'
                        . ' srcdoc="' . esc_attr($document) . '"></iframe>';
                    break;
            }
        }
        return $html;
    }
}

/* ==================================================================
 * Access control
 * ================================================================== */

if (!function_exists('sml_letters_can_read')) {
    /**
     * Single source of truth for entitlement. Gated body is never sent to the
     * client, so there is nothing to unhide in devtools.
     */
    function sml_letters_can_read($letter, $user_id = null) {
        $user_id = $user_id === null ? get_current_user_id() : (int) $user_id;

        if (($letter['status'] ?? '') !== 'published') {
            return $user_id && ((int) $letter['author_id'] === $user_id || user_can($user_id, 'manage_options'));
        }
        if (($letter['visibility'] ?? 'public') === 'public') {
            return true;
        }
        if (!$user_id) {
            return false;
        }
        if ((int) $letter['author_id'] === $user_id || user_can($user_id, 'manage_options')) {
            return true;
        }
        switch ($letter['visibility']) {
            case 'members':
                return true;   // logged in is enough
            case 'subscribers':
                return sml_letters_is_subscriber($user_id, (int) $letter['author_id']);
            case 'tiered':
                return sml_letters_tier_rank(sml_letters_reader_tier($user_id, (int) $letter['author_id']))
                    >= sml_letters_tier_rank((string) $letter['tier_min']);
            case 'group':
                return function_exists('sml_groups_is_member')
                    ? (bool) sml_groups_is_member((int) $letter['group_id'], $user_id)
                    : false;
        }
        return false;
    }
}

/* ==================================================================
 * Shaping
 * ================================================================== */

if (!function_exists('sml_letters_url')) {
    function sml_letters_url($letter) {
        $author = get_userdata((int) $letter['author_id']);
        $handle = $author ? sanitize_title($author->display_name ?: $author->user_nicename) : 'author';
        return home_url('/n/' . $handle . '/' . $letter['slug'] . '/');
    }
}

if (!function_exists('sml_letters_public')) {
    function sml_letters_public($row, $with_body = false) {
        $unlocked = sml_letters_can_read($row);
        $blocks = sml_letters_blocks($row);
        $author = get_userdata((int) $row['author_id']);
        $publication = sml_letters_publication_settings((int) $row['author_id']);

        $out = array(
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'title' => $row['title'],
            'subtitle' => $row['subtitle'],
            'tldr' => $row['tldr'],
            'cover_url' => $row['cover_url'],
            'content_type' => $row['content_type'],
            'tags' => array_values(array_filter(explode(',', (string) $row['tags']))),
            'status' => $row['status'],
            'visibility' => $row['visibility'],
            // Retained as a zero-valued compatibility field for older clients.
            'price_lb' => 0,
            'tier_min' => $row['tier_min'],
            'word_count' => (int) $row['word_count'],
            'read_minutes' => (int) $row['read_minutes'],
            'sponsored' => (bool) $row['sponsored'],
            'has_levels' => (bool) $row['has_levels'],
            'locked' => !$unlocked,
            'author' => array(
                'id' => (int) $row['author_id'],
                'name' => $publication['byline_name'],
                'handle' => $author ? $author->user_nicename : '',
                'avatar' => get_avatar_url((int) $row['author_id'], array('size' => 96)),
                'publication_name' => $publication['publication_name'],
                'publication_description' => $publication['description'],
                'brand_color' => $publication['brand_color'],
            ),
            'url' => sml_letters_url($row),
            'published_at' => $row['published_at'],
            'updated_at' => $row['updated_at'],
            'stats' => array(
                'opens' => (int) $row['opens'],
                'reads' => (int) $row['read_count'],
                'comments' => (int) $row['comment_count'],
                'bookmarks' => (int) $row['bookmark_count'],
            ),
            'tickers' => sml_letters_ticker_rows((int) $row['id']),
            'performance' => sml_letters_performance_rows((int) $row['id']),
        );

        if ($with_body) {
            // Free preview stops at the paywall marker; gated blocks never leave the server.
            $out['html'] = $unlocked
                ? sml_letters_render_html($blocks, false)
                : sml_letters_render_html($blocks, true);
            $out['paywalled'] = !$unlocked && sml_letters_has_block($blocks, 'paywall_marker');
        }

        return $out;
    }
}

if (!function_exists('sml_letters_ticker_rows')) {
    function sml_letters_ticker_rows($letter_id) {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT symbol, role, rank_score FROM " . sml_letters_table('tickers') . "
              WHERE letter_id = %d ORDER BY role = 'primary' DESC, rank_score DESC",
            $letter_id
        ), ARRAY_A);
        return array_map(function ($row) {
            return array(
                'symbol' => $row['symbol'],
                'role' => $row['role'],
                'score' => (float) $row['rank_score'],
            );
        }, $rows ?: array());
    }
}

if (!function_exists('sml_letters_performance_rows')) {
    function sml_letters_performance_rows($letter_id) {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . sml_letters_table('performance') . " WHERE letter_id = %d",
            $letter_id
        ), ARRAY_A);
        return array_map(function ($row) {
            return array(
                'symbol' => $row['symbol'],
                'price_at_publish' => $row['price_at_publish'] !== null ? (float) $row['price_at_publish'] : null,
                'price_now' => $row['price_now'] !== null ? (float) $row['price_now'] : null,
                'pct_change' => $row['pct_change'] !== null ? (float) $row['pct_change'] : null,
                'thesis_state' => $row['thesis_state'],
                'entry' => $row['entry'] !== null ? (float) $row['entry'] : null,
                'stop' => $row['stop'] !== null ? (float) $row['stop'] : null,
                'target_1' => $row['target_1'] !== null ? (float) $row['target_1'] : null,
            );
        }, $rows ?: array());
    }
}

/* ==================================================================
 * Price snapshot - cannot be backfilled, so capture from letter #1
 * ================================================================== */

if (!function_exists('sml_letters_spot_price')) {
    function sml_letters_spot_price($symbol) {
        $url = rest_url('sml-trading-floor/v1/chart/' . rawurlencode($symbol)) . '?range=1Y&interval=1d';
        $response = wp_remote_get($url, array('timeout' => 12, 'sslverify' => false));
        if (is_wp_error($response)) {
            return null;
        }
        $body = json_decode(wp_remote_retrieve_body($response), true);
        $bars = $body['data']['bars'] ?? ($body['bars'] ?? array());
        if (!is_array($bars) || !$bars) {
            return null;
        }
        $last = end($bars);
        return isset($last['close']) ? (float) $last['close'] : null;
    }
}

if (!function_exists('sml_letters_snapshot_prices')) {
    function sml_letters_snapshot_prices($letter_id, $blocks) {
        global $wpdb;
        $symbols = sml_letters_symbols_in_blocks($blocks);
        $levels = sml_letters_levels($blocks);
        $now = gmdate('Y-m-d H:i:s');

        foreach ($symbols as $symbol) {
            $price = sml_letters_spot_price($symbol);
            $level = $levels[$symbol] ?? array();

            $wpdb->query($wpdb->prepare(
                "INSERT INTO " . sml_letters_table('performance') . "
                   (letter_id, symbol, price_at_publish, entry, stop, target_1, target_2,
                    price_now, pct_change, thesis_state, snapshot_at, updated_at)
                 VALUES (%d, %s, %f, %s, %s, %s, %s, %f, 0, 'open', %s, %s)
                 ON DUPLICATE KEY UPDATE
                   entry = VALUES(entry), stop = VALUES(stop),
                   target_1 = VALUES(target_1), target_2 = VALUES(target_2)",
                $letter_id, $symbol,
                $price !== null ? $price : 0,
                $level['entry'] ?? null, $level['stop'] ?? null,
                $level['target_1'] ?? null, $level['target_2'] ?? null,
                $price !== null ? $price : 0,
                $now, $now
            ));
        }
    }
}

if (!function_exists('sml_letters_refresh_performance')) {
    /** Nightly re-price. Phase 2 renders the badge; the data accrues from now. */
    function sml_letters_refresh_performance() {
        global $wpdb;
        $table = sml_letters_table('performance');
        $rows = $wpdb->get_results(
            "SELECT * FROM $table WHERE thesis_state = 'open' ORDER BY updated_at ASC LIMIT 25", ARRAY_A);

        foreach ($rows ?: array() as $row) {
            $price = sml_letters_spot_price($row['symbol']);
            if ($price === null) {
                continue;
            }
            $base = (float) $row['price_at_publish'];
            $pct = $base > 0 ? (($price - $base) / $base) * 100 : 0;

            $state = 'open';
            if (!empty($row['stop']) && $price <= (float) $row['stop']) {
                $state = 'stopped';
            } elseif (!empty($row['target_1']) && $price >= (float) $row['target_1']) {
                $state = 'target_hit';
            }

            $wpdb->update($table, array(
                'price_now' => $price,
                'pct_change' => round($pct, 4),
                'thesis_state' => $state,
                'updated_at' => gmdate('Y-m-d H:i:s'),
            ), array('id' => (int) $row['id']));
        }
    }
}
add_action('sml_letters_perf_event', 'sml_letters_refresh_performance');

if (!function_exists('sml_letters_schedule_jobs')) {
    function sml_letters_schedule_jobs() {
        if (!wp_next_scheduled('sml_letters_perf_event')) {
            wp_schedule_event(time() + 300, 'hourly', 'sml_letters_perf_event');
        }
        if (!wp_next_scheduled('sml_letters_publish_event')) {
            wp_schedule_event(time() + 120, 'sml_voice_minute', 'sml_letters_publish_event');
        }
    }
}
add_action('init', 'sml_letters_schedule_jobs', 21);

if (!function_exists('sml_letters_run_scheduled')) {
    function sml_letters_run_scheduled() {
        global $wpdb;
        $due = $wpdb->get_col(
            "SELECT id FROM " . sml_letters_table('posts') . "
              WHERE status = 'scheduled' AND schedule_at IS NOT NULL
                AND schedule_at <= UTC_TIMESTAMP() LIMIT 10");
        foreach ($due as $id) {
            sml_letters_do_publish((int) $id);
        }
    }
}
add_action('sml_letters_publish_event', 'sml_letters_run_scheduled');

/* ==================================================================
 * Publish
 * ================================================================== */

if (!function_exists('sml_letters_preflight')) {
    function sml_letters_preflight($row, $blocks) {
        $issues = array();
        $title = trim((string) $row['title']);

        if (strlen($title) < 10 || strlen($title) > 200) {
            $issues[] = 'Give the letter a title between 10 and 200 characters.';
        }
        $has_custom_body = false;
        foreach ($blocks as $block) {
            if (($block['type'] ?? '') === 'custom_code' && trim(wp_strip_all_tags((string) ($block['html'] ?? ''))) !== '') {
                $has_custom_body = true;
                break;
            }
        }
        if (!sml_letters_has_block($blocks, 'paragraph') && !$has_custom_body) {
            $issues[] = 'Add at least one paragraph or HTML & CSS block before publishing.';
        }
        // A trade idea without a disclosure is the one thing we hard-block.
        if (sml_letters_has_block($blocks, 'levels') && !sml_letters_has_block($blocks, 'disclosure')) {
            $issues[] = 'Letters with entry/stop/target levels need a disclosure block stating your position.';
        }
        return $issues;
    }
}

if (!function_exists('sml_letters_paywall_index')) {
    function sml_letters_paywall_index($blocks) {
        foreach ($blocks as $index => $block) {
            if (($block['type'] ?? '') === 'paywall_marker') {
                return $index;
            }
        }
        return count($blocks);
    }
}

if (!function_exists('sml_letters_bind_tickers')) {
    function sml_letters_bind_tickers($letter_id, $blocks, $primary = '') {
        global $wpdb;
        $table = sml_letters_table('tickers');
        $symbols = sml_letters_symbols_in_blocks($blocks);

        $primary = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $primary));
        if ($primary && !in_array($primary, $symbols, true)) {
            array_unshift($symbols, $primary);
        }
        if (!$primary && $symbols) {
            $primary = $symbols[0];
        }

        $wpdb->query($wpdb->prepare("DELETE FROM $table WHERE letter_id = %d", $letter_id));
        foreach ($symbols as $symbol) {
            $wpdb->insert($table, array(
                'letter_id' => $letter_id,
                'symbol' => $symbol,
                'role' => $symbol === $primary ? 'primary' : 'related',
                'rank_score' => $symbol === $primary ? 0.8 : 0.5,
            ));
        }
    }
}

if (!function_exists('sml_letters_do_publish')) {
    function sml_letters_do_publish($letter_id) {
        global $wpdb;
        $table = sml_letters_table('posts');
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", $letter_id), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_letters_missing', 'Letter not found.', array('status' => 404));
        }

        $blocks = sml_letters_blocks($row);
        $issues = sml_letters_preflight($row, $blocks);
        if ($issues) {
            return new WP_Error('sml_letters_preflight', $issues[0], array('status' => 400, 'issues' => $issues));
        }

        $plaintext = sml_letters_plaintext($blocks);
        $words = str_word_count($plaintext);

        $wpdb->update($table, array(
            'status' => 'published',
            'published_at' => $row['published_at'] ?: gmdate('Y-m-d H:i:s'),
            'updated_at' => gmdate('Y-m-d H:i:s'),
            'html' => sml_letters_render_html($blocks, false),
            'plaintext' => $plaintext,
            'word_count' => $words,
            'read_minutes' => max(1, (int) ceil($words / 220)),
            'has_levels' => sml_letters_has_block($blocks, 'levels') ? 1 : 0,
            'has_paywall' => sml_letters_has_block($blocks, 'paywall_marker') ? 1 : 0,
            'schedule_at' => null,
        ), array('id' => $letter_id));

        sml_letters_bind_tickers($letter_id, $blocks, $row['tags']);
        sml_letters_snapshot_prices($letter_id, $blocks);

        do_action('sml_letters_published', $letter_id, $row);
        return true;
    }
}

/* ==================================================================
 * REST
 * ================================================================== */

if (!function_exists('sml_letters_bool_param')) {
    function sml_letters_bool_param($value) {
        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }
}

if (!function_exists('sml_letters_sanitize_settings_payload')) {
    function sml_letters_sanitize_settings_payload(WP_REST_Request $request, $user_id) {
        $current = sml_letters_publication_settings($user_id);

        $visibility = sanitize_key((string) $request->get_param('default_visibility'));
        $visibility = in_array($visibility, array('public', 'members', 'subscribers'), true)
            ? $visibility : 'public';
        $color = sanitize_hex_color((string) $request->get_param('brand_color')) ?: '#2b6cff';

        $email = (array) $request->get_param('email_delivery');
        $provider = sanitize_key((string) ($email['provider'] ?? 'manual'));
        $provider = in_array($provider, array('manual', 'mailchimp', 'sendgrid', 'resend', 'smtp'), true) ? $provider : 'manual';

        $stripe = (array) $request->get_param('stripe_import');
        $mode = sanitize_key((string) ($stripe['mode'] ?? 'test'));
        $mode = in_array($mode, array('test', 'live'), true) ? $mode : 'test';

        $plans = (array) $request->get_param('plans');
        $paywalling = (array) $request->get_param('paywalling');
        $paywall = sanitize_key((string) ($paywalling['default_paywall'] ?? 'preview_then_subscribe'));
        $paywall = in_array($paywall, array('preview_then_subscribe', 'intro_only', 'locked_until_paid'), true)
            ? $paywall : 'preview_then_subscribe';
        $billing = (array) $request->get_param('billing');

        $settings = array_replace_recursive($current, array(
            'publication_name' => mb_substr(sanitize_text_field((string) $request->get_param('publication_name')), 0, 100),
            'byline_name' => mb_substr(sanitize_text_field((string) $request->get_param('byline_name')), 0, 100),
            'description' => mb_substr(sanitize_textarea_field((string) $request->get_param('description')), 0, 500),
            'brand_color' => $color,
            'default_visibility' => $visibility,
            'default_disclosure' => mb_substr(sanitize_textarea_field((string) $request->get_param('default_disclosure')), 0, 500),
            'email_delivery' => array(
                'enabled' => sml_letters_bool_param($email['enabled'] ?? false),
                'provider' => $provider,
                'from_name' => mb_substr(sanitize_text_field((string) ($email['from_name'] ?? '')), 0, 100),
                'from_email' => sanitize_email((string) ($email['from_email'] ?? '')),
                'reply_to' => sanitize_email((string) ($email['reply_to'] ?? '')),
                'header_html' => mb_substr(wp_kses_post((string) ($email['header_html'] ?? '')), 0, 3000),
                'footer_html' => mb_substr(wp_kses_post((string) ($email['footer_html'] ?? '')), 0, 3000),
                'opt_out_url' => esc_url_raw((string) ($email['opt_out_url'] ?? '')),
                'require_confirmation' => sml_letters_bool_param($email['require_confirmation'] ?? true),
                'welcome_free' => mb_substr(sanitize_textarea_field((string) ($email['welcome_free'] ?? '')), 0, 2000),
                'welcome_paid' => mb_substr(sanitize_textarea_field((string) ($email['welcome_paid'] ?? '')), 0, 2000),
                'expired_email' => mb_substr(sanitize_textarea_field((string) ($email['expired_email'] ?? '')), 0, 2000),
                'renewal_email' => mb_substr(sanitize_textarea_field((string) ($email['renewal_email'] ?? '')), 0, 2000),
            ),
            'stripe_import' => array(
                'connected' => sml_letters_bool_param($stripe['connected'] ?? false),
                'account_label' => mb_substr(sanitize_text_field((string) ($stripe['account_label'] ?? '')), 0, 120),
                'mode' => $mode,
                'price_ids' => mb_substr(sanitize_textarea_field((string) ($stripe['price_ids'] ?? '')), 0, 2000),
            ),
            'plans' => array(
                'free_enabled' => sml_letters_bool_param($plans['free_enabled'] ?? true),
                'monthly_enabled' => sml_letters_bool_param($plans['monthly_enabled'] ?? false),
                'monthly_name' => mb_substr(sanitize_text_field((string) ($plans['monthly_name'] ?? 'Monthly')), 0, 80),
                'monthly_price' => mb_substr(sanitize_text_field((string) ($plans['monthly_price'] ?? '')), 0, 40),
                'monthly_price_id' => mb_substr(sanitize_text_field((string) ($plans['monthly_price_id'] ?? '')), 0, 120),
                'annual_enabled' => sml_letters_bool_param($plans['annual_enabled'] ?? false),
                'annual_name' => mb_substr(sanitize_text_field((string) ($plans['annual_name'] ?? 'Annual')), 0, 80),
                'annual_price' => mb_substr(sanitize_text_field((string) ($plans['annual_price'] ?? '')), 0, 40),
                'annual_price_id' => mb_substr(sanitize_text_field((string) ($plans['annual_price_id'] ?? '')), 0, 120),
                'founding_enabled' => sml_letters_bool_param($plans['founding_enabled'] ?? false),
                'founding_name' => mb_substr(sanitize_text_field((string) ($plans['founding_name'] ?? 'Founding Member')), 0, 80),
                'founding_price' => mb_substr(sanitize_text_field((string) ($plans['founding_price'] ?? '')), 0, 40),
                'founding_price_id' => mb_substr(sanitize_text_field((string) ($plans['founding_price_id'] ?? '')), 0, 120),
            ),
            'paywalling' => array(
                'default_paywall' => $paywall,
                'allow_search_excerpt' => sml_letters_bool_param($paywalling['allow_search_excerpt'] ?? true),
                'paid_preview_words' => max(0, min(1500, (int) ($paywalling['paid_preview_words'] ?? 250))),
            ),
            'billing' => array(
                'tax_region' => mb_substr(sanitize_text_field((string) ($billing['tax_region'] ?? '')), 0, 120),
                'vat_note' => mb_substr(sanitize_textarea_field((string) ($billing['vat_note'] ?? '')), 0, 1000),
            ),
        ));

        if ($settings['byline_name'] === '') {
            $settings['byline_name'] = $settings['publication_name'];
        }
        if ($settings['email_delivery']['from_name'] === '') {
            $settings['email_delivery']['from_name'] = $settings['byline_name'];
        }
        if (!$settings['email_delivery']['reply_to']) {
            $settings['email_delivery']['reply_to'] = $settings['email_delivery']['from_email'];
        }
        return $settings;
    }
}

if (!function_exists('sml_letters_imported_subscriber_count')) {
    function sml_letters_imported_subscriber_count($user_id) {
        $subscribers = get_user_meta((int) $user_id, 'sml_letters_imported_subscribers', true);
        return is_array($subscribers) ? count($subscribers) : 0;
    }
}

if (!function_exists('sml_letters_parse_imported_subscribers')) {
    function sml_letters_parse_imported_subscribers($csv) {
        $rows = preg_split('/\r\n|\r|\n/', (string) $csv);
        $out = array();
        $headers = array();
        foreach ($rows as $idx => $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            $cols = str_getcsv($line);
            if (!$cols) {
                continue;
            }
            if (!$headers && $idx === 0) {
                $lower = array_map('strtolower', array_map('trim', $cols));
                if (in_array('email', $lower, true) || in_array('email address', $lower, true)) {
                    $headers = $lower;
                    continue;
                }
            }
            $email = '';
            $name = '';
            if ($headers) {
                $email_idx = array_search('email', $headers, true);
                if ($email_idx === false) {
                    $email_idx = array_search('email address', $headers, true);
                }
                $name_idx = array_search('name', $headers, true);
                if ($name_idx === false) {
                    $name_idx = array_search('customer', $headers, true);
                }
                $email = $email_idx !== false ? (string) ($cols[$email_idx] ?? '') : '';
                $name = $name_idx !== false ? (string) ($cols[$name_idx] ?? '') : '';
            } else {
                foreach ($cols as $col) {
                    if (!$email && is_email(trim($col))) {
                        $email = trim($col);
                    } elseif (!$name) {
                        $name = trim($col);
                    }
                }
            }
            $email = sanitize_email($email);
            if (!$email) {
                continue;
            }
            $out[$email] = array(
                'email' => $email,
                'name' => mb_substr(sanitize_text_field($name), 0, 120),
                'source' => 'uploaded_list',
                'status' => 'imported',
                'imported_at' => gmdate('c'),
            );
        }
        return $out;
    }
}

if (!function_exists('sml_letters_rest_settings')) {
    function sml_letters_rest_settings(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        $settings = sml_letters_publication_settings($user_id);

        if ($request->get_method() === 'POST') {
            $settings = sml_letters_sanitize_settings_payload($request, $user_id);
            if ($settings['publication_name'] === '') {
                return new WP_Error('sml_letters_settings_name', 'Give your publication a name.', array('status' => 400));
            }
            update_user_meta($user_id, 'sml_letters_publication_settings', $settings);
        }

        $followers = get_user_meta($user_id, 'sml_followers', true);
        $email = (array) ($settings['email_delivery'] ?? array());
        $stripe = (array) ($settings['stripe_import'] ?? array());
        $reports = (array) ($settings['invoice_reports']['requests'] ?? array());
        return array(
            'settings' => $settings,
            'status' => array(
                'audience_source' => 'followers',
                'subscriber_count' => is_array($followers) ? count(array_unique(array_map('intval', $followers))) : 0,
                'site_delivery' => true,
                'email_delivery' => !empty($email['enabled']),
                'email_provider' => sanitize_key((string) ($email['provider'] ?? 'manual')),
                'mailchimp_detected' => (bool) get_option('mailchimp_sf_access_token'),
                'imported_subscriber_count' => sml_letters_imported_subscriber_count($user_id),
                'stripe_connected' => !empty($stripe['connected']),
                'stripe_last_import_at' => (string) ($stripe['last_import_at'] ?? ''),
                'stripe_last_import_count' => (int) ($stripe['last_import_count'] ?? 0),
                'invoice_report_count' => count($reports),
            ),
        );
    }
}

if (!function_exists('sml_letters_rest_import_subscribers')) {
    function sml_letters_rest_import_subscribers(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        $incoming = sml_letters_parse_imported_subscribers((string) $request->get_param('csv'));
        if (!$incoming) {
            return new WP_Error('sml_letters_no_subscribers', 'No valid email addresses were found in that file.', array('status' => 400));
        }
        $existing = get_user_meta($user_id, 'sml_letters_imported_subscribers', true);
        $existing = is_array($existing) ? $existing : array();
        $merged = array_replace($existing, $incoming);
        update_user_meta($user_id, 'sml_letters_imported_subscribers', $merged);
        return array('imported' => count($incoming), 'total' => count($merged), 'status' => 'saved');
    }
}

if (!function_exists('sml_letters_rest_stripe_connect')) {
    function sml_letters_rest_stripe_connect(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        $settings = sml_letters_publication_settings($user_id);
        $mode = sanitize_key((string) $request->get_param('mode'));
        $mode = in_array($mode, array('test', 'live'), true) ? $mode : 'test';
        $settings['stripe_import']['connected'] = true;
        $settings['stripe_import']['account_label'] = mb_substr(sanitize_text_field((string) $request->get_param('account_label')), 0, 120) ?: 'Stripe account connected';
        $settings['stripe_import']['mode'] = $mode;
        update_user_meta($user_id, 'sml_letters_publication_settings', $settings);
        return array('settings' => $settings, 'connected' => true);
    }
}

if (!function_exists('sml_letters_rest_import_stripe_paid')) {
    function sml_letters_rest_import_stripe_paid(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        $settings = sml_letters_publication_settings($user_id);
        if (empty($settings['stripe_import']['connected'])) {
            return new WP_Error('sml_letters_stripe_not_connected', 'Connect Stripe in Newsletter Settings before importing paid subscriptions.', array('status' => 400));
        }
        $incoming = sml_letters_parse_imported_subscribers((string) $request->get_param('csv'));
        foreach ($incoming as $email => $row) {
            $incoming[$email]['source'] = 'stripe_paid_import';
            $incoming[$email]['status'] = 'paid';
        }
        $existing = get_user_meta($user_id, 'sml_letters_imported_subscribers', true);
        $existing = is_array($existing) ? $existing : array();
        $merged = array_replace($existing, $incoming);
        update_user_meta($user_id, 'sml_letters_imported_subscribers', $merged);
        $settings['stripe_import']['last_import_at'] = gmdate('c');
        $settings['stripe_import']['last_import_count'] = count($incoming);
        update_user_meta($user_id, 'sml_letters_publication_settings', $settings);
        return array('imported' => count($incoming), 'total' => count($merged), 'settings' => $settings);
    }
}

if (!function_exists('sml_letters_rest_request_invoice_report')) {
    function sml_letters_rest_request_invoice_report(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        $settings = sml_letters_publication_settings($user_id);
        $from = sanitize_text_field((string) $request->get_param('from'));
        $to = sanitize_text_field((string) $request->get_param('to'));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
            return new WP_Error('sml_letters_bad_report_range', 'Choose a valid start and end date for the report.', array('status' => 400));
        }
        $reports = (array) ($settings['invoice_reports']['requests'] ?? array());
        array_unshift($reports, array(
            'id' => 'lir_' . wp_generate_password(10, false, false),
            'from' => $from,
            'to' => $to,
            'status' => 'requested',
            'requested_at' => gmdate('c'),
            'purpose' => 'sales_tax_vat',
        ));
        $settings['invoice_reports']['requests'] = array_slice($reports, 0, 20);
        update_user_meta($user_id, 'sml_letters_publication_settings', $settings);
        return array('reports' => $settings['invoice_reports']['requests'], 'settings' => $settings);
    }
}

if (!function_exists('sml_letters_rest_create')) {
    function sml_letters_rest_create(WP_REST_Request $request) {
        global $wpdb;
        if (!sml_letters_can_publish()) {
            return new WP_Error('sml_letters_forbidden',
                'Loop Letters are open to group owners and admins.', array('status' => 403));
        }
        $user_id = get_current_user_id();
        $title = sanitize_text_field((string) $request->get_param('title')) ?: 'Untitled letter';
        $settings = sml_letters_publication_settings($user_id);
        $blocks = array(
            array('id' => 'b1', 'type' => 'paragraph', 'spans' => array(array('text' => ''))),
        );
        if ($settings['default_disclosure'] !== '') {
            $blocks[] = array(
                'id' => 'b2',
                'type' => 'disclosure',
                'position' => $settings['default_disclosure'],
                'size' => '',
            );
        }

        $base = sanitize_title($title) ?: 'letter';
        $slug = $base;
        $n = 2;
        while ($wpdb->get_var($wpdb->prepare(
            "SELECT id FROM " . sml_letters_table('posts') . " WHERE slug = %s", $slug))) {
            $slug = $base . '-' . $n++;
        }

        $wpdb->insert(sml_letters_table('posts'), array(
            'author_id' => $user_id,
            'slug' => $slug,
            'title' => $title,
            'blocks' => wp_json_encode($blocks),
            'status' => 'draft',
            'visibility' => $settings['default_visibility'],
        ));

        return array('ok' => true, 'letter_id' => (int) $wpdb->insert_id, 'slug' => $slug);
    }
}

if (!function_exists('sml_letters_rest_get')) {
    function sml_letters_rest_get(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_letters_table('posts') . " WHERE id = %d", $id), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_letters_missing', 'Letter not found.', array('status' => 404));
        }
        $user_id = get_current_user_id();
        if ((int) $row['author_id'] !== $user_id && !user_can($user_id, 'manage_options')) {
            return new WP_Error('sml_letters_forbidden', 'Not your letter.', array('status' => 403));
        }
        $out = sml_letters_public($row, true);
        $out['blocks'] = sml_letters_blocks($row);
        return $out;
    }
}

if (!function_exists('sml_letters_rest_save')) {
    function sml_letters_rest_save(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $table = sml_letters_table('posts');
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", $id), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_letters_missing', 'Letter not found.', array('status' => 404));
        }
        $user_id = get_current_user_id();
        if ((int) $row['author_id'] !== $user_id && !user_can($user_id, 'manage_options')) {
            return new WP_Error('sml_letters_forbidden', 'Not your letter.', array('status' => 403));
        }

        $patch = array('updated_at' => gmdate('Y-m-d H:i:s'));

        if ($request->get_param('title') !== null) {
            $patch['title'] = sanitize_text_field((string) $request->get_param('title'));
        }
        if ($request->get_param('subtitle') !== null) {
            $patch['subtitle'] = sanitize_text_field((string) $request->get_param('subtitle'));
        }
        if ($request->get_param('tldr') !== null) {
            $patch['tldr'] = sanitize_textarea_field((string) $request->get_param('tldr'));
        }
        if ($request->get_param('cover_url') !== null) {
            $patch['cover_url'] = esc_url_raw((string) $request->get_param('cover_url'));
        }
        if ($request->get_param('content_type') !== null) {
            $patch['content_type'] = sanitize_text_field((string) $request->get_param('content_type'));
        }
        if ($request->get_param('tags') !== null) {
            $tags = array_map('sanitize_text_field', (array) $request->get_param('tags'));
            $patch['tags'] = implode(',', array_filter($tags));
        }
        if ($request->get_param('visibility') !== null) {
            $v = sanitize_key((string) $request->get_param('visibility'));
            $v = $v === 'paid' ? 'subscribers' : $v;
            $patch['visibility'] = in_array($v, array('public','members','subscribers','tiered','group'), true) ? $v : 'public';
        }
        if ($request->get_param('tier_min') !== null) {
            $patch['tier_min'] = sanitize_key((string) $request->get_param('tier_min'));
        }
        // Loop Letters no longer accepts Loop Bucks pricing. Always clear a
        // legacy value when a draft is saved, including from an older client.
        $patch['price_lb'] = 0;
        if ($request->get_param('blocks') !== null) {
            $blocks = sml_letters_sanitize_blocks((array) $request->get_param('blocks'));
            $patch['blocks'] = wp_json_encode(array_values($blocks));
            $plain = sml_letters_plaintext($blocks);
            $patch['plaintext'] = $plain;
            $patch['word_count'] = str_word_count($plain);
            $patch['read_minutes'] = max(1, (int) ceil(str_word_count($plain) / 220));
            $patch['has_levels'] = sml_letters_has_block($blocks, 'levels') ? 1 : 0;
            $patch['has_paywall'] = sml_letters_has_block($blocks, 'paywall_marker') ? 1 : 0;
        }

        $wpdb->update($table, $patch, array('id' => $id));
        return array('ok' => true, 'saved_at' => $patch['updated_at']);
    }
}

if (!function_exists('sml_letters_rest_publish')) {
    function sml_letters_rest_publish(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $table = sml_letters_table('posts');
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", $id), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_letters_missing', 'Letter not found.', array('status' => 404));
        }
        $user_id = get_current_user_id();
        if ((int) $row['author_id'] !== $user_id && !user_can($user_id, 'manage_options')) {
            return new WP_Error('sml_letters_forbidden', 'Not your letter.', array('status' => 403));
        }
        if (!sml_letters_can_publish($user_id)) {
            return new WP_Error('sml_letters_forbidden', 'You cannot publish letters yet.', array('status' => 403));
        }

        // Cut a version before the state changes.
        $wpdb->insert(sml_letters_table('versions'), array(
            'letter_id' => $id,
            'author_id' => $user_id,
            'label' => 'publish',
            'title' => $row['title'],
            'blocks' => $row['blocks'],
        ));

        $schedule_at = sanitize_text_field((string) $request->get_param('schedule_at'));
        if ($schedule_at) {
            $ts = strtotime($schedule_at);
            if (!$ts || $ts < time()) {
                return new WP_Error('sml_letters_schedule', 'Pick a future time.', array('status' => 400));
            }
            $blocks = sml_letters_blocks($row);
            $issues = sml_letters_preflight($row, $blocks);
            if ($issues) {
                return new WP_Error('sml_letters_preflight', $issues[0], array('status' => 400, 'issues' => $issues));
            }
            $wpdb->update($table, array(
                'status' => 'scheduled',
                'schedule_at' => gmdate('Y-m-d H:i:s', $ts),
            ), array('id' => $id));
            return array('ok' => true, 'status' => 'scheduled', 'schedule_at' => gmdate('c', $ts));
        }

        $done = sml_letters_do_publish($id);
        if (is_wp_error($done)) {
            return $done;
        }

        $fresh = $wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE id = %d", $id), ARRAY_A);
        return array('ok' => true, 'status' => 'published', 'letter' => sml_letters_public($fresh, false));
    }
}

if (!function_exists('sml_letters_rest_read')) {
    /** Public read. Access filtering happens here, before anything is serialized. */
    function sml_letters_rest_read(WP_REST_Request $request) {
        global $wpdb;
        $slug = sanitize_title((string) $request->get_param('slug'));
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_letters_table('posts') . " WHERE slug = %s", $slug), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_letters_missing', 'Letter not found.', array('status' => 404));
        }
        if ($row['status'] !== 'published'
            && !(get_current_user_id() && ((int) $row['author_id'] === get_current_user_id()
                 || current_user_can('manage_options')))) {
            return new WP_Error('sml_letters_missing', 'Letter not found.', array('status' => 404));
        }
        return sml_letters_public($row, true);
    }
}

if (!function_exists('sml_letters_rest_feed')) {
    function sml_letters_rest_feed(WP_REST_Request $request) {
        global $wpdb;
        $type = sanitize_key((string) $request->get_param('type')) ?: 'trending';
        $symbol = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $request->get_param('symbol')));
        $limit = max(1, min(50, (int) $request->get_param('limit') ?: 20));
        $posts = sml_letters_table('posts');
        $tickers = sml_letters_table('tickers');

        if ($type === 'ticker' && $symbol) {
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT l.* FROM $tickers t
                   JOIN $posts l ON l.id = t.letter_id AND l.status = 'published'
                  WHERE t.symbol = %s
                  ORDER BY t.rank_score DESC, l.published_at DESC LIMIT %d",
                $symbol, $limit), ARRAY_A);
        } elseif ($type === 'author') {
            $author = (int) $request->get_param('author_id');
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT * FROM $posts WHERE author_id = %d AND status = 'published'
                  ORDER BY published_at DESC LIMIT %d", $author, $limit), ARRAY_A);
        } else {
            $rows = $wpdb->get_results($wpdb->prepare(
                "SELECT * FROM $posts WHERE status = 'published'
                  ORDER BY published_at DESC LIMIT %d", $limit), ARRAY_A);
        }

        return array('letters' => array_map(function ($row) {
            return sml_letters_public($row, false);
        }, $rows ?: array()));
    }
}

if (!function_exists('sml_letters_rest_mine')) {
    function sml_letters_rest_mine(WP_REST_Request $request) {
        global $wpdb;
        $user_id = get_current_user_id();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . sml_letters_table('posts') . "
              WHERE author_id = %d ORDER BY updated_at DESC LIMIT 100", $user_id), ARRAY_A);
        return array(
            'can_publish' => sml_letters_can_publish($user_id),
            'letters' => array_map(function ($row) { return sml_letters_public($row, false); }, $rows ?: array()),
        );
    }
}

if (!function_exists('sml_letters_has_column')) {
    function sml_letters_has_column($table, $column) {
        global $wpdb;
        static $cache = array();
        $key = $table . '.' . $column;
        if (!array_key_exists($key, $cache)) {
            $cache[$key] = (bool) $wpdb->get_var($wpdb->prepare("SHOW COLUMNS FROM $table LIKE %s", $column));
        }
        return $cache[$key];
    }
}

if (!function_exists('sml_letters_rest_beacon')) {
    function sml_letters_rest_beacon(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $kind = sanitize_key((string) $request->get_param('kind'));
        $session = substr(sanitize_text_field((string) $request->get_param('session')), 0, 64);
        $posts = sml_letters_table('posts');
        $today = gmdate('Y-m-d');

        if (!$id || !$session) {
            return array('ok' => true);
        }

        $column = in_array($kind, array('impression', 'open', 'read', 'completion', 'click'), true) ? $kind : null;
        if (!$column) {
            return array('ok' => true);
        }
        $map = array(
            'impression' => 'impressions',
            'open' => 'opens',
            'read' => 'read_count',
            'completion' => 'completions',
            'click' => 'clicks',
        );
        $field = $map[$column];

        if ($kind === 'read' || $kind === 'completion') {
            $wpdb->query($wpdb->prepare(
                "INSERT INTO " . sml_letters_table('reads') . "
                   (letter_id, user_id, session_key, dwell_seconds, scroll_pct, completed)
                 VALUES (%d, %d, %s, %d, %d, %d)
                 ON DUPLICATE KEY UPDATE
                   dwell_seconds = GREATEST(dwell_seconds, VALUES(dwell_seconds)),
                   scroll_pct = GREATEST(scroll_pct, VALUES(scroll_pct)),
                   completed = GREATEST(completed, VALUES(completed))",
                $id, get_current_user_id(), $session,
                (int) $request->get_param('dwell'), (int) $request->get_param('scroll'),
                $kind === 'completion' ? 1 : 0));
        }

        if (sml_letters_has_column($posts, $field)) {
            $wpdb->query($wpdb->prepare("UPDATE $posts SET $field = $field + 1 WHERE id = %d", $id));
        }
        $daily = sml_letters_table('daily');
        if (sml_letters_has_column($daily, $field)) {
            $wpdb->query($wpdb->prepare(
                "INSERT INTO $daily (letter_id, day, $field)
                 VALUES (%d, %s, 1) ON DUPLICATE KEY UPDATE $field = $field + 1", $id, $today));
        }

        return array('ok' => true);
    }
}

if (!function_exists('sml_letters_rest_comment')) {
    function sml_letters_rest_comment(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $body = trim(sanitize_textarea_field((string) $request->get_param('body')));
        $posts = sml_letters_table('posts');

        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $posts WHERE id = %d", $id), ARRAY_A);
        if (!$row || $row['status'] !== 'published') {
            return new WP_Error('sml_letters_missing', 'Letter not found.', array('status' => 404));
        }
        if ($body === '') {
            return new WP_Error('sml_letters_empty', 'Write something first.', array('status' => 400));
        }
        // Paid letters: only people who can actually read it may comment.
        if (!sml_letters_can_read($row)) {
            return new WP_Error('sml_letters_locked', 'Unlock the letter to comment.', array('status' => 403));
        }

        $wpdb->insert(sml_letters_table('comments'), array(
            'letter_id' => $id,
            'user_id' => get_current_user_id(),
            'parent_id' => max(0, (int) $request->get_param('parent_id')),
            'body' => substr($body, 0, 4000),
            'quote' => sanitize_textarea_field((string) $request->get_param('quote')) ?: null,
        ));
        $wpdb->query($wpdb->prepare(
            "UPDATE $posts SET comment_count = comment_count + 1 WHERE id = %d", $id));

        return array('ok' => true, 'comments' => sml_letters_comment_rows($id));
    }
}

if (!function_exists('sml_letters_comment_rows')) {
    function sml_letters_comment_rows($letter_id) {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . sml_letters_table('comments') . "
              WHERE letter_id = %d AND status = 'visible'
              ORDER BY created_at ASC LIMIT 200", $letter_id), ARRAY_A);
        return array_map(function ($row) {
            $user = get_userdata((int) $row['user_id']);
            return array(
                'id' => (int) $row['id'],
                'parent_id' => (int) $row['parent_id'],
                'body' => $row['body'],
                'quote' => $row['quote'],
                'name' => $user ? ($user->display_name ?: $user->user_login) : 'Member',
                'handle' => $user ? $user->user_nicename : '',
                'avatar' => get_avatar_url((int) $row['user_id'], array('size' => 80)),
                'created_at' => $row['created_at'],
            );
        }, $rows ?: array());
    }
}

if (!function_exists('sml_letters_rest_comments')) {
    function sml_letters_rest_comments(WP_REST_Request $request) {
        return array('comments' => sml_letters_comment_rows((int) $request->get_param('id')));
    }
}

if (!function_exists('sml_letters_rest_bookmark')) {
    function sml_letters_rest_bookmark(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $user_id = get_current_user_id();
        $table = sml_letters_table('bookmarks');
        $posts = sml_letters_table('posts');

        $exists = $wpdb->get_var($wpdb->prepare(
            "SELECT letter_id FROM $table WHERE user_id = %d AND letter_id = %d", $user_id, $id));
        if ($exists) {
            $wpdb->delete($table, array('user_id' => $user_id, 'letter_id' => $id));
            $wpdb->query($wpdb->prepare(
                "UPDATE $posts SET bookmark_count = GREATEST(0, bookmark_count - 1) WHERE id = %d", $id));
            return array('ok' => true, 'bookmarked' => false);
        }
        $wpdb->insert($table, array('user_id' => $user_id, 'letter_id' => $id));
        $wpdb->query($wpdb->prepare(
            "UPDATE $posts SET bookmark_count = bookmark_count + 1 WHERE id = %d", $id));
        return array('ok' => true, 'bookmarked' => true);
    }
}

if (!function_exists('sml_letters_rest_delete')) {
    /**
     * Drafts are removed outright. Published letters archive by default - a
     * trade thesis that aged badly must not be quietly erasable, since that is
     * what the performance record depends on. Admins can force a hard delete
     * for genuine test data.
     */
    function sml_letters_rest_delete(WP_REST_Request $request) {
        global $wpdb;
        $id = (int) $request->get_param('id');
        $force = (bool) $request->get_param('force');
        $posts = sml_letters_table('posts');

        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM $posts WHERE id = %d", $id), ARRAY_A);
        if (!$row) {
            return new WP_Error('sml_letters_missing', 'Letter not found.', array('status' => 404));
        }
        $user_id = get_current_user_id();
        $is_admin = user_can($user_id, 'manage_options');
        if ((int) $row['author_id'] !== $user_id && !$is_admin) {
            return new WP_Error('sml_letters_forbidden', 'Not your letter.', array('status' => 403));
        }

        $hard = ($row['status'] !== 'published') || ($force && $is_admin);

        if (!$hard) {
            $wpdb->update($posts, array('status' => 'archived'), array('id' => $id));
            return array('ok' => true, 'action' => 'archived');
        }

        foreach (array('tickers', 'performance', 'comments', 'daily', 'bookmarks', 'reads', 'versions', 'purchases') as $t) {
            $wpdb->delete(sml_letters_table($t), array('letter_id' => $id));
        }
        $wpdb->delete($posts, array('id' => $id));
        return array('ok' => true, 'action' => 'deleted');
    }
}

if (!function_exists('sml_letters_rest_diagnostics')) {
    function sml_letters_rest_diagnostics(WP_REST_Request $request) {
        global $wpdb;
        if (!current_user_can('manage_options')) {
            return new WP_Error('sml_letters_forbidden', 'Admins only.', array('status' => 403));
        }
        $tables = array();
        foreach (array('posts','versions','tickers','purchases','comments','daily','performance','bookmarks','reads') as $t) {
            $name = sml_letters_table($t);
            $tables[$t] = (bool) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $name));
        }
        return array(
            'db_version' => get_option('sml_letters_db_version'),
            'tables' => $tables,
            'letter_count' => (int) $wpdb->get_var('SELECT COUNT(*) FROM ' . sml_letters_table('posts')),
            'can_publish' => sml_letters_can_publish(),
            'last_db_error' => $wpdb->last_error,
        );
    }
}

if (!function_exists('sml_letters_rest_topic_insights')) {
    function sml_letters_rest_topic_insights(WP_REST_Request $request) {
        global $wpdb;
        $posts = sml_letters_table('posts');
        $tickers = sml_letters_table('tickers');
        $limit = max(5, min(50, (int) $request->get_param('limit') ?: 20));
        $user_id = get_current_user_id();
        $is_admin = current_user_can('manage_options');

        $click_expr = sml_letters_has_column($posts, 'clicks') ? 'clicks' : '0';
        $where = "status = 'published'";
        $args = array();
        if (!$is_admin) {
            $where .= ' AND author_id = %d';
            $args[] = $user_id;
        }
        $args[] = $limit;

        $sql = "SELECT id, title, slug, tags, author_id, published_at,
                       COALESCE(impressions,0) AS impressions,
                       COALESCE(opens,0) AS opens,
                       COALESCE(read_count,0) AS reads,
                       COALESCE(completions,0) AS completions,
                       COALESCE(comment_count,0) AS comments,
                       COALESCE(bookmark_count,0) AS bookmarks,
                       COALESCE($click_expr,0) AS clicks
                  FROM $posts
                 WHERE $where
                 ORDER BY (COALESCE(opens,0) + COALESCE(read_count,0) * 3 + COALESCE(completions,0) * 5
                          + COALESCE(comment_count,0) * 7 + COALESCE(bookmark_count,0) * 8 + COALESCE($click_expr,0) * 6) DESC,
                          published_at DESC
                 LIMIT %d";
        $rows = $wpdb->get_results($wpdb->prepare($sql, $args), ARRAY_A);

        $topics = array();
        $leaders = array();
        foreach ($rows ?: array() as $row) {
            $opens = (int) $row['opens'];
            $impressions = (int) $row['impressions'];
            $reads = (int) $row['reads'];
            $completions = (int) $row['completions'];
            $comments = (int) $row['comments'];
            $bookmarks = (int) $row['bookmarks'];
            $clicks = (int) $row['clicks'];
            $score = $opens + ($reads * 3) + ($completions * 5) + ($comments * 7) + ($bookmarks * 8) + ($clicks * 6);
            $ctr = $impressions > 0 ? round(($opens / $impressions) * 100, 2) : 0;
            $completion = $reads > 0 ? round(($completions / $reads) * 100, 2) : 0;
            $letter_topics = array_values(array_filter(array_map('trim', explode(',', (string) $row['tags']))));

            $symbols = $wpdb->get_col($wpdb->prepare(
                "SELECT symbol FROM $tickers WHERE letter_id = %d ORDER BY role = 'primary' DESC, rank_score DESC LIMIT 8",
                (int) $row['id']
            ));
            foreach (array_merge($letter_topics, array_map(function ($s) { return '$' . strtoupper($s); }, $symbols ?: array())) as $topic) {
                $key = strtolower($topic);
                if (!isset($topics[$key])) {
                    $topics[$key] = array('topic' => $topic, 'letters' => 0, 'score' => 0, 'opens' => 0, 'clicks' => 0, 'reads' => 0);
                }
                $topics[$key]['letters']++;
                $topics[$key]['score'] += $score;
                $topics[$key]['opens'] += $opens;
                $topics[$key]['clicks'] += $clicks;
                $topics[$key]['reads'] += $reads;
            }

            $leaders[] = array(
                'id' => (int) $row['id'],
                'title' => $row['title'],
                'slug' => $row['slug'],
                'published_at' => $row['published_at'],
                'score' => $score,
                'impressions' => $impressions,
                'opens' => $opens,
                'clicks' => $clicks,
                'reads' => $reads,
                'completions' => $completions,
                'ctr' => $ctr,
                'completion_rate' => $completion,
                'topics' => $letter_topics,
                'symbols' => array_values($symbols ?: array()),
            );
        }

        usort($topics, function ($a, $b) {
            return $b['score'] <=> $a['score'];
        });

        return array(
            'ok' => true,
            'scope' => $is_admin ? 'site' : 'creator',
            'leaders' => $leaders,
            'topics' => array_slice(array_values($topics), 0, $limit),
            'guidance' => array(
                'double_down_on' => array_slice(array_column(array_values($topics), 'topic'), 0, 5),
                'headline_logic' => 'Prefer the strongest ticker/catalyst angle from high-open, high-read, high-completion letters; avoid repeating low-score topics unless a new catalyst changes the story.',
            ),
        );
    }
}

if (!function_exists('sml_letters_register_routes')) {
    function sml_letters_register_routes() {
        $ns = 'sml-letters/v1';
        $in = 'is_user_logged_in';

        register_rest_route($ns, '/settings', array(
            array('methods' => 'GET', 'permission_callback' => $in, 'callback' => 'sml_letters_rest_settings'),
            array('methods' => 'POST', 'permission_callback' => $in, 'callback' => 'sml_letters_rest_settings'),
        ));
        register_rest_route($ns, '/settings/subscribers/import', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_import_subscribers',
        ));
        register_rest_route($ns, '/settings/stripe/connect', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_stripe_connect',
        ));
        register_rest_route($ns, '/settings/stripe/import-paid', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_import_stripe_paid',
        ));
        register_rest_route($ns, '/settings/invoice-report', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_request_invoice_report',
        ));
        register_rest_route($ns, '/letters', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_create',
        ));
        register_rest_route($ns, '/letters/(?P<id>\d+)', array(
            array('methods' => 'GET', 'permission_callback' => $in, 'callback' => 'sml_letters_rest_get'),
            array('methods' => 'POST', 'permission_callback' => $in, 'callback' => 'sml_letters_rest_save'),
        ));
        register_rest_route($ns, '/letters/(?P<id>\d+)/publish', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_publish',
        ));
        register_rest_route($ns, '/letters/(?P<id>\d+)/comment', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_comment',
        ));
        register_rest_route($ns, '/letters/(?P<id>\d+)/comments', array(
            'methods' => 'GET', 'permission_callback' => '__return_true',
            'callback' => 'sml_letters_rest_comments',
        ));
        register_rest_route($ns, '/letters/(?P<id>\d+)/bookmark', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_bookmark',
        ));
        register_rest_route($ns, '/read', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => '__return_true',
            'callback' => 'sml_letters_rest_beacon',
        ));
        register_rest_route($ns, '/letter', array(
            'methods' => 'GET', 'permission_callback' => '__return_true',
            'callback' => 'sml_letters_rest_read',
        ));
        register_rest_route($ns, '/feed', array(
            'methods' => 'GET', 'permission_callback' => '__return_true',
            'callback' => 'sml_letters_rest_feed',
        ));
        register_rest_route($ns, '/mine', array(
            'methods' => 'GET', 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_mine',
        ));
        register_rest_route($ns, '/letters/(?P<id>\d+)/delete', array(
            'methods' => WP_REST_Server::CREATABLE, 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_delete',
        ));
        register_rest_route($ns, '/diagnostics', array(
            'methods' => 'GET', 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_diagnostics',
        ));
        register_rest_route($ns, '/insights/topics', array(
            'methods' => 'GET', 'permission_callback' => $in,
            'callback' => 'sml_letters_rest_topic_insights',
        ));
    }
}
add_action('rest_api_init', 'sml_letters_register_routes');

/* ==================================================================
 * Distribution: ticker feed + Creator Studio analytics
 * ================================================================== */

if (!function_exists('sml_letters_for_symbol')) {
    function sml_letters_for_symbol($symbol, $limit = 10) {
        global $wpdb;
        $symbol = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $symbol));
        if (!$symbol) {
            return array();
        }
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT l.* FROM " . sml_letters_table('tickers') . " t
               JOIN " . sml_letters_table('posts') . " l
                 ON l.id = t.letter_id AND l.status = 'published'
              WHERE t.symbol = %s
              ORDER BY t.rank_score DESC, l.published_at DESC LIMIT %d",
            $symbol, $limit), ARRAY_A);

        return array_map(function ($row) { return sml_letters_public($row, false); }, $rows ?: array());
    }
}

// Register into the feed the ticker pages already read.
add_filter('sml_engines_ticker_posts', function ($posts, $symbol, $args = array()) {
    if (!is_array($posts)) {
        $posts = array();
    }
    foreach (sml_letters_for_symbol($symbol, 10) as $letter) {
        $posts[] = array(
            'type' => 'loop_letter',
            'id' => $letter['id'],
            'title' => $letter['title'],
            'url' => $letter['url'],
            'author' => $letter['author']['name'],
            'published_at' => $letter['published_at'],
            'locked' => $letter['locked'],
            'read_minutes' => $letter['read_minutes'],
            'performance' => $letter['performance'],
        );
    }
    return $posts;
}, 10, 3);

if (!function_exists('sml_letters_creator_totals')) {
    function sml_letters_creator_totals($user_id) {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT COUNT(*) AS letters,
                    COALESCE(SUM(impressions),0) AS impressions,
                    COALESCE(SUM(opens),0) AS opens,
                    COALESCE(SUM(read_count),0) AS read_total,
                    COALESCE(SUM(completions),0) AS completions,
                    COALESCE(SUM(comment_count),0) AS comments,
                    COALESCE(SUM(bookmark_count),0) AS bookmarks,
                    COALESCE(SUM(revenue_lb),0) AS revenue_lb
               FROM " . sml_letters_table('posts') . "
              WHERE author_id = %d AND status = 'published'", $user_id), ARRAY_A);

        $reads = (int) ($row['read_total'] ?? 0);
        return array(
            'letters' => (int) ($row['letters'] ?? 0),
            'impressions' => (int) ($row['impressions'] ?? 0),
            'opens' => (int) ($row['opens'] ?? 0),
            'reads' => $reads,
            'completions' => (int) ($row['completions'] ?? 0),
            'completion_rate' => $reads > 0 ? round(((int) $row['completions'] / $reads) * 100, 2) : 0,
            'comments' => (int) ($row['comments'] ?? 0),
            'bookmarks' => (int) ($row['bookmarks'] ?? 0),
            'revenue_lb' => (int) ($row['revenue_lb'] ?? 0),
        );
    }
}

add_filter('rest_post_dispatch', function ($response, $server, $request) {
    if (!($response instanceof WP_REST_Response) || !($request instanceof WP_REST_Request)) {
        return $response;
    }
    if (strpos((string) $request->get_route(), '/sml-members/v1/creator-studio/realtime') === false) {
        return $response;
    }
    $user_id = get_current_user_id();
    if (!$user_id) {
        return $response;
    }
    $totals = sml_letters_creator_totals($user_id);
    if (!$totals['letters']) {
        return $response;
    }

    $data = $response->get_data();
    if (isset($data['overview']) && is_array($data['overview'])) {
        $data['overview']['views'] = (int) ($data['overview']['views'] ?? 0) + $totals['opens'];
        $data['overview']['impressions'] = (int) ($data['overview']['impressions'] ?? 0) + $totals['impressions'];
        $data['overview']['engagement'] = (int) ($data['overview']['engagement'] ?? 0)
            + $totals['comments'] + $totals['bookmarks'];
        $data['overview']['letter_reads'] = $totals['reads'];
        $data['overview']['letter_count'] = $totals['letters'];
    }
    $data['loop_letters'] = $totals;
    $response->set_data($data);
    return $response;
}, 21, 3);
