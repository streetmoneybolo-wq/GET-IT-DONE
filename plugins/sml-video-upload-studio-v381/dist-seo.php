<?php
/**
 * Loop Distribution - SEO markup for public letter pages.
 *
 * Injects generated OG/Twitter tags, a preview card image, and JSON-LD with
 * correct paywall markup. Serving a truncated article to crawlers without
 * isAccessibleForFree/hasPart is cloaking; with it, it is sanctioned.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_dist_letter_seo')) {
    /** Cached per letter, keyed on content hash so edits invalidate it. */
    function sml_dist_letter_seo($row) {
        $key = 'sml_dist_seo_' . (int) $row['id'];
        $cached = get_transient($key);
        $stamp = md5((string) $row['updated_at'] . '|' . (string) $row['title']);

        if (is_array($cached) && ($cached['_stamp'] ?? '') === $stamp) {
            return $cached;
        }

        $bundle = sml_dist_bundle_from_letter($row);
        $seo = sml_dist_seo($bundle);
        $seo['_stamp'] = $stamp;
        $seo['_bundle'] = $bundle;

        set_transient($key, $seo, 6 * HOUR_IN_SECONDS);
        return $seo;
    }
}

if (!function_exists('sml_dist_letter_head')) {
    /**
     * Echoed inside <head> of the public letter page.
     *
     * @param array $row      Raw letter row.
     * @param array $letter   Shaped letter (sml_letters_public output).
     * @param bool  $unlocked Whether the current viewer can read the whole thing.
     */
    function sml_dist_letter_head($row, $letter, $unlocked) {
        if (!function_exists('sml_dist_seo')) {
            return;
        }

        $seo = sml_dist_letter_seo($row);
        $bundle = $seo['_bundle'];

        $desc = $letter['tldr'] ?: ($seo['meta_desc'] ?: $letter['subtitle']);
        $image = $letter['cover_url'];

        // A generated card beats no image, and beats a generic site logo.
        if (!$image) {
            $card = sml_dist_card($bundle, $seo, '', '1.91:1');
            if ($card && !empty($card['url']) && substr($card['url'], -4) === '.png') {
                $image = $card['url'];
            }
        }

        echo '<meta name="description" content="' . esc_attr($desc) . '">' . "\n";
        if ($seo['keywords']) {
            echo '<meta name="keywords" content="' . esc_attr(implode(', ', array_slice($seo['keywords'], 0, 10))) . '">' . "\n";
        }
        echo '<meta property="og:site_name" content="' . esc_attr(get_bloginfo('name')) . '">' . "\n";
        echo '<meta property="article:published_time" content="' . esc_attr(mysql2date('c', $letter['published_at'] ?: $row['created_at'], false)) . '">' . "\n";
        echo '<meta property="article:modified_time" content="' . esc_attr(mysql2date('c', $row['updated_at'], false)) . '">' . "\n";
        echo '<meta property="article:author" content="' . esc_attr($letter['author']['name']) . '">' . "\n";
        foreach (array_slice($seo['symbols'], 0, 5) as $s) {
            echo '<meta property="article:tag" content="' . esc_attr($s['symbol']) . '">' . "\n";
        }
        if ($image) {
            echo '<meta property="og:image" content="' . esc_url($image) . '">' . "\n";
            echo '<meta property="og:image:width" content="1200">' . "\n";
            echo '<meta property="og:image:height" content="630">' . "\n";
            echo '<meta name="twitter:image" content="' . esc_url($image) . '">' . "\n";
        }
        echo '<meta name="twitter:title" content="' . esc_attr($letter['title']) . '">' . "\n";
        echo '<meta name="twitter:description" content="' . esc_attr($desc) . '">' . "\n";

        echo '<script type="application/ld+json">' . wp_json_encode(
            sml_dist_letter_jsonld($row, $letter, $seo, $image, $unlocked),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        ) . '</script>' . "\n";
    }
}

if (!function_exists('sml_dist_letter_jsonld')) {
    function sml_dist_letter_jsonld($row, $letter, $seo, $image, $unlocked) {
        $author = $letter['author'];

        $about = array();
        foreach (array_slice($seo['symbols'], 0, 5) as $s) {
            $about[] = array(
                '@type'        => 'Corporation',
                'name'         => $s['symbol'],
                'tickerSymbol' => $s['symbol'],
                'url'          => home_url('/ticker/' . strtolower($s['symbol']) . '/'),
            );
        }

        $data = array(
            '@context'         => 'https://schema.org',
            '@type'            => 'Article',
            'headline'         => $letter['title'],
            'description'      => $seo['meta_desc'],
            'datePublished'    => mysql2date('c', $letter['published_at'] ?: $row['created_at'], false),
            'dateModified'     => mysql2date('c', $row['updated_at'], false),
            'wordCount'        => (int) $letter['word_count'],
            'inLanguage'       => get_bloginfo('language'),
            'author'           => array(
                '@type' => 'Person',
                'name'  => $author['name'],
                'url'   => home_url('/members/' . $author['handle'] . '/'),
            ),
            'publisher'        => array(
                '@type' => 'Organization',
                'name'  => get_bloginfo('name'),
                'url'   => home_url('/'),
            ),
            'mainEntityOfPage' => array('@type' => 'WebPage', '@id' => $letter['url']),
        );

        if ($image) {
            $data['image'] = array($image);
        }
        if ($about) {
            $data['about'] = $about;
        }
        if ($seo['keywords']) {
            $data['keywords'] = implode(', ', array_slice($seo['keywords'], 0, 10));
        }

        // The paywall contract. Without this pair, serving a preview to
        // crawlers and the full text to buyers is cloaking.
        $gated = ($letter['visibility'] !== 'public');
        $data['isAccessibleForFree'] = $gated ? 'False' : 'True';
        if ($gated) {
            $data['hasPart'] = array(
                '@type'               => 'WebPageElement',
                'isAccessibleForFree' => 'False',
                'cssSelector'         => '.lp-gated',
            );
        }

        return apply_filters('sml_dist_letter_jsonld', $data, $row, $letter, $seo);
    }
}

/* ==================================================================
 * Attribution redirect:  /r/{token}
 * ================================================================== */

if (!function_exists('sml_dist_intercept_redirect')) {
    function sml_dist_intercept_redirect() {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        $path = trim((string) wp_parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
        $parts = array_values(array_filter(explode('/', $path)));
        if (count($parts) !== 2 || $parts[0] !== 'r') {
            return;
        }

        global $wpdb;
        $token = preg_replace('/[^A-Za-z0-9]/', '', $parts[1]);
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_dist_table('queue') . " WHERE share_token = %s", $token
        ), ARRAY_A);

        if (!$row) {
            wp_safe_redirect(home_url('/'), 302);
            exit;
        }

        $ua = sml_dist_ua_class();
        if ($ua !== 'bot') {
            // INSERT IGNORE on the unique (token, session) means a reload is
            // not a second click.
            $wpdb->query($wpdb->prepare(
                "INSERT IGNORE INTO " . sml_dist_table('clicks') . "
                   (share_token, platform, entity_type, entity_id, session_key, referrer, ua_class)
                 VALUES (%s, %s, %s, %d, %s, %s, %s)",
                $token, $row['platform'], $row['entity_type'], (int) $row['entity_id'],
                sml_dist_session_key(),
                substr((string) ($_SERVER['HTTP_REFERER'] ?? ''), 0, 255), $ua
            ));
            if ($wpdb->rows_affected) {
                $wpdb->query($wpdb->prepare(
                    "INSERT INTO " . sml_dist_table('daily') . " (user_id, day, platform, clicks)
                     VALUES (%d, %s, %s, 1)
                     ON DUPLICATE KEY UPDATE clicks = clicks + 1",
                    (int) $row['user_id'], gmdate('Y-m-d'), $row['platform']
                ));
            }
        }

        wp_safe_redirect(sml_dist_entity_url($row['entity_type'], (int) $row['entity_id']), 302);
        exit;
    }
}
add_action('template_redirect', 'sml_dist_intercept_redirect', 0);

if (!function_exists('sml_dist_entity_url')) {
    function sml_dist_entity_url($entity_type, $entity_id) {
        if ($entity_type === 'letter') {
            global $wpdb;
            $row = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM " . $wpdb->prefix . "sml_letter_posts WHERE id = %d", $entity_id
            ), ARRAY_A);
            if ($row && function_exists('sml_letters_url')) {
                return sml_letters_url($row);
            }
        }
        $url = apply_filters('sml_dist_entity_url', '', $entity_type, $entity_id);
        return $url ?: home_url('/');
    }
}

if (!function_exists('sml_dist_share_link')) {
    function sml_dist_share_link($token) {
        return home_url('/r/' . $token . '/');
    }
}
