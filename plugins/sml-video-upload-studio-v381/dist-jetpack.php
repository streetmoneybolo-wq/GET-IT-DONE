<?php
/**
 * Loop Distribution - Jetpack Publicize bridge.
 *
 * Jetpack already holds the platform approvals (Meta, LinkedIn, Threads) and
 * the site already has nine live connections, so there is no reason to run our
 * own OAuth, token store and drivers for those networks. Jetpack becomes the
 * transport; the generation engine stays ours.
 *
 * The bridge works because Publicize acts on WordPress posts and supports a
 * {meta:<key>} placeholder in each connection's message template. So:
 *
 *   1. Each connection's template is set once to {meta:sml_cap_<service>}.
 *   2. Publishing a letter creates a hidden shadow post carrying one caption
 *      per service in post meta.
 *   3. Publicize resolves each connection's template against that post and
 *      every network gets text written for it.
 *
 * The shadow post is not public, not indexed, and never appears in a feed,
 * archive or search result. It exists only so Publicize has something to act on.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SML_DIST_SHADOW_CPT', 'sml_letter_share');

/** Services Jetpack can post to, mapped to how we render tickers for each. */
if (!function_exists('sml_dist_jetpack_services')) {
    function sml_dist_jetpack_services() {
        return array(
            'bluesky'            => 'bluesky',
            'facebook'           => 'facebook',
            'instagram-business' => 'instagram',
            'linkedin'           => 'linkedin',
            'mastodon'           => 'mastodon',
            'threads'            => 'threads',
            'tumblr'             => 'facebook',   // long-form, same register
            'nextdoor'           => 'facebook',
        );
    }
}

if (!function_exists('sml_dist_jetpack_active')) {
    function sml_dist_jetpack_active() {
        return class_exists('Automattic\Jetpack\Publicize\Publicize')
            || defined('JETPACK__VERSION')
            || function_exists('publicize_init');
    }
}

if (!function_exists('sml_dist_meta_key')) {
    function sml_dist_meta_key($service) {
        return 'sml_cap_' . str_replace('-', '_', $service);
    }
}

/* ==================================================================
 * Shadow post type
 * ================================================================== */

if (!function_exists('sml_dist_register_shadow_cpt')) {
    function sml_dist_register_shadow_cpt() {
        register_post_type(SML_DIST_SHADOW_CPT, array(
            'label'               => 'Letter shares',
            'public'              => false,
            'publicly_queryable'  => false,
            'show_ui'             => false,
            'show_in_menu'        => false,
            'show_in_rest'        => false,
            'exclude_from_search' => true,
            'has_archive'         => false,
            'rewrite'             => false,
            'query_var'           => false,
            'can_export'          => false,
            'supports'            => array('title', 'editor', 'excerpt', 'thumbnail', 'custom-fields', 'publicize'),
        ));

        // Belt and braces: some Jetpack builds read support at a later hook.
        add_post_type_support(SML_DIST_SHADOW_CPT, 'publicize');
    }
}
add_action('init', 'sml_dist_register_shadow_cpt', 5);

/** Never let a shadow post reach a crawler, a feed or a sitemap. */
if (!function_exists('sml_dist_shadow_noindex')) {
    function sml_dist_shadow_noindex() {
        if (is_singular(SML_DIST_SHADOW_CPT)) {
            echo '<meta name="robots" content="noindex,nofollow">' . "\n";
        }
    }
}
add_action('wp_head', 'sml_dist_shadow_noindex', 1);

if (!function_exists('sml_dist_shadow_sitemap_exclude')) {
    function sml_dist_shadow_sitemap_exclude($post_types) {
        unset($post_types[SML_DIST_SHADOW_CPT]);
        return $post_types;
    }
}
add_filter('wp_sitemaps_post_types', 'sml_dist_shadow_sitemap_exclude');
add_filter('rank_math/sitemap/excluded_post_types', function ($types) {
    $types = is_array($types) ? $types : array();
    $types[] = SML_DIST_SHADOW_CPT;
    return $types;
});

/** A shadow post that somehow gets requested redirects to the real letter. */
if (!function_exists('sml_dist_shadow_redirect')) {
    function sml_dist_shadow_redirect() {
        if (!is_singular(SML_DIST_SHADOW_CPT)) {
            return;
        }
        $letter_id = (int) get_post_meta(get_the_ID(), 'sml_letter_id', true);
        $url = $letter_id ? sml_dist_entity_url('letter', $letter_id) : home_url('/');
        wp_safe_redirect($url, 301);
        exit;
    }
}
add_action('template_redirect', 'sml_dist_shadow_redirect', 1);

/* ==================================================================
 * Building the shadow post
 * ================================================================== */

if (!function_exists('sml_dist_jetpack_publish')) {
    /**
     * Creates (or refreshes) the shadow post for a letter and lets Publicize
     * fire on it.
     *
     * @return array|WP_Error
     */
    function sml_dist_jetpack_publish($bundle, $seo, $event = 'letter.publish', $seed = 0) {
        if (!sml_dist_jetpack_active()) {
            return new WP_Error('no_jetpack', 'Jetpack is not active on this site.', array('status' => 400));
        }

        $existing = sml_dist_shadow_for($bundle['entity_type'], (int) $bundle['entity_id'], $event);

        // One share token per letter+event, reused on re-publish so clicks
        // aggregate against a single row rather than fragmenting.
        $token = sml_dist_handoff_token($bundle, $event);
        $link  = sml_dist_share_link($token);

        // Build one caption per Jetpack service.
        $captions = array();
        foreach (sml_dist_jetpack_services() as $service => $platform) {
            $variant = sml_dist_build_variant($bundle, $seo, $platform, $event, (int) $seed, $link);
            if (!$variant) {
                continue;
            }
            $caption = $variant['caption'];
            // Instagram hides links in captions, but Jetpack posts an image
            // with the caption, so the bio CTA our generator writes still reads
            // correctly. Everything else keeps the link.
            $captions[$service] = $caption;
        }
        if (!$captions) {
            return new WP_Error('no_captions', 'Nothing to publish.', array('status' => 400));
        }

        $card = sml_dist_card($bundle, $seo, '', '1.91:1');

        $postarr = array(
            'post_type'    => SML_DIST_SHADOW_CPT,
            'post_status'  => 'publish',
            'post_title'   => $bundle['title'],
            'post_excerpt' => $seo['tldr'],
            'post_content' => $seo['tldr'] . "\n\n" . $link,
            'post_author'  => (int) $bundle['author']['id'],
        );
        if ($existing) {
            $postarr['ID'] = (int) $existing;
        }

        // Meta must exist before the post transitions to publish, because
        // Publicize resolves {meta:...} at that moment.
        $meta = array(
            'sml_letter_id'   => (int) $bundle['entity_id'],
            'sml_entity_type' => $bundle['entity_type'],
            'sml_event_type'  => $event,
            'sml_share_token' => $token,
        );
        foreach ($captions as $service => $caption) {
            $meta[sml_dist_meta_key($service)] = $caption;
        }
        $postarr['meta_input'] = $meta;

        // Our card is better than Jetpack's generic generated image, so turn
        // the Social Image Generator off for this post specifically.
        $postarr['meta_input']['_jetpack_social_options'] = array(
            'image_generator_settings' => array('enabled' => false),
        );

        $post_id = $existing ? wp_update_post($postarr, true) : wp_insert_post($postarr, true);
        if (is_wp_error($post_id)) {
            return $post_id;
        }

        if ($card && !empty($card['url']) && substr($card['url'], -4) === '.png') {
            sml_dist_attach_card($post_id, $card['url']);
        }

        sml_dist_record_shadow($bundle, $event, (int) $post_id, $token, $captions);

        return array(
            'ok'       => true,
            'post_id'  => (int) $post_id,
            'token'    => $token,
            'services' => array_keys($captions),
        );
    }
}

if (!function_exists('sml_dist_shadow_for')) {
    function sml_dist_shadow_for($entity_type, $entity_id, $event) {
        $found = get_posts(array(
            'post_type'   => SML_DIST_SHADOW_CPT,
            'post_status' => 'any',
            'numberposts' => 1,
            'fields'      => 'ids',
            'meta_query'  => array(
                array('key' => 'sml_letter_id', 'value' => (int) $entity_id),
                array('key' => 'sml_entity_type', 'value' => $entity_type),
                array('key' => 'sml_event_type', 'value' => $event),
            ),
        ));
        return $found ? (int) $found[0] : 0;
    }
}

if (!function_exists('sml_dist_attach_card')) {
    /**
     * Sideloads the generated card into the media library and sets it as the
     * featured image, which is what Publicize attaches to the outgoing post.
     */
    function sml_dist_attach_card($post_id, $url) {
        $existing = (int) get_post_meta($post_id, '_sml_card_url_hash', true);
        $hash = crc32($url);
        if ($existing === (int) $hash && get_post_thumbnail_id($post_id)) {
            return;
        }

        $dir = wp_upload_dir();
        $path = str_replace(trailingslashit($dir['baseurl']), trailingslashit($dir['basedir']), $url);
        if (!@is_readable($path)) {
            return;
        }
        $data = @file_get_contents($path);
        if (!$data) {
            return;
        }

        $name = 'share-' . $post_id . '-' . substr(md5($url), 0, 8) . '.png';
        $upload = wp_upload_bits($name, null, $data);
        if (!empty($upload['error'])) {
            return;
        }

        $attachment_id = wp_insert_attachment(array(
            'post_mime_type' => 'image/png',
            'post_title'     => $name,
            'post_status'    => 'inherit',
        ), $upload['file'], $post_id);

        if (is_wp_error($attachment_id) || !$attachment_id) {
            return;
        }
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $meta = wp_generate_attachment_metadata($attachment_id, $upload['file']);
        if ($meta) {
            wp_update_attachment_metadata($attachment_id, $meta);
        }

        set_post_thumbnail($post_id, $attachment_id);
        update_post_meta($post_id, '_sml_card_url_hash', $hash);
    }
}

if (!function_exists('sml_dist_record_shadow')) {
    /** Logs one queue row per service so the UI and analytics still see sends. */
    function sml_dist_record_shadow($bundle, $event, $post_id, $token, $captions) {
        global $wpdb;
        $table = sml_dist_table('queue');

        foreach ($captions as $service => $caption) {
            $idem = sha1(implode('|', array(
                (int) $bundle['author']['id'], 'jetpack:' . $service,
                $bundle['entity_type'], (int) $bundle['entity_id'], $event, gmdate('Y-m-d'),
            )));

            $wpdb->insert($table, array(
                'user_id'         => (int) $bundle['author']['id'],
                'account_id'      => null,
                'platform'        => $service,
                'entity_type'     => $bundle['entity_type'],
                'entity_id'       => (int) $bundle['entity_id'],
                'event_type'      => $event,
                'variant_json'    => wp_json_encode(array(
                    'caption'   => $caption,
                    'via'       => 'jetpack',
                    'shadow_id' => (int) $post_id,
                )),
                'share_token'     => sml_dist_token(),
                'status'          => 'sent',
                'run_at'          => sml_dist_now(),
                'sent_at'         => sml_dist_now(),
                'idempotency_key' => $idem,
            ));
            if ($wpdb->insert_id) {
                sml_dist_bump_daily((int) $bundle['author']['id'], $service, 'posts_sent');
            }
        }
    }
}

/* ==================================================================
 * Connection templates
 * ================================================================== */

if (!function_exists('sml_dist_jetpack_connections')) {
    /**
     * Reads the site's Publicize connections. Jetpack stores these in an
     * option; the exact shape has moved between versions, so this is defensive.
     */
    function sml_dist_jetpack_connections() {
        $out = array();

        if (!class_exists('Automattic\Jetpack\Publicize\Connections')) {
            return $out;
        }

        $conns = call_user_func(array('Automattic\Jetpack\Publicize\Connections', 'get_all_for_user'));

        // Jetpack returns a flat list of connection arrays. Treating it as
        // service => items produced 9 × 16 field-name entries, which is how
        // this first reported 144 connections.
        foreach ((array) $conns as $key => $item) {
            if (!is_array($item) || !isset($item['service_name'])) {
                continue;
            }
            $out[] = array(
                'service'  => (string) $item['service_name'],
                'id'       => (string) ($item['connection_id'] ?? $item['id'] ?? ''),
                'name'     => (string) ($item['display_name'] ?? $item['external_handle'] ?? ''),
                'handle'   => (string) ($item['external_handle'] ?? ''),
                'template' => (string) ($item['template'] ?? ''),
            );
        }
        return $out;
    }
}

if (!function_exists('sml_dist_expected_template')) {
    function sml_dist_expected_template($service) {
        return '{meta:' . sml_dist_meta_key($service) . '}';
    }
}

if (!function_exists('sml_dist_template_report')) {
    /**
     * Tells the creator which connections are wired to our captions and which
     * are still using Jetpack's default title+excerpt.
     */
    function sml_dist_template_report() {
        $rows = array();
        foreach (sml_dist_jetpack_connections() as $c) {
            $expected = sml_dist_expected_template($c['service']);
            $rows[] = array(
                'service'  => $c['service'],
                'name'     => $c['name'],
                'id'       => $c['id'],
                'template' => $c['template'],
                'expected' => $expected,
                'wired'    => trim($c['template']) === $expected,
            );
        }
        return $rows;
    }
}

/* ==================================================================
 * Event wiring - Jetpack takes over from our own drivers
 * ================================================================== */

if (!function_exists('sml_dist_jetpack_on_event')) {
    function sml_dist_jetpack_on_event($event, $bundle) {
        $user_id = (int) ($bundle['author']['id'] ?? 0);
        if (!$user_id || !sml_dist_jetpack_active()) {
            return;
        }
        if (!sml_dist_can_autoshare($user_id)) {
            return;
        }
        if (!apply_filters('sml_dist_use_jetpack', true, $event, $bundle)) {
            return;
        }

        $seo = sml_dist_seo($bundle);

        // The one hard block: never publish a thesis into a print.
        if ($seo['primary'] && sml_dist_earnings_blackout($seo['primary'])) {
            return;
        }

        sml_dist_jetpack_publish($bundle, $seo, $event, sml_dist_preferred_seed($user_id, 'bluesky'));
    }
}
add_action('sml_dist_event', 'sml_dist_jetpack_on_event', 5, 2);

/**
 * With Jetpack carrying the load, our own drivers would double-post. They stay
 * in the codebase for platforms Jetpack does not cover, but are disabled for
 * anything Jetpack already handles.
 */
if (!function_exists('sml_dist_suppress_own_drivers')) {
    function sml_dist_suppress_own_drivers($platforms) {
        if (!sml_dist_jetpack_active()) {
            return $platforms;
        }
        $covered = array_values(sml_dist_jetpack_services());
        return array_values(array_diff($platforms, $covered));
    }
}
add_filter('sml_dist_live_platforms', 'sml_dist_suppress_own_drivers');

/* ==================================================================
 * REST
 * ================================================================== */

if (!function_exists('sml_dist_jetpack_routes')) {
    function sml_dist_jetpack_routes() {
        register_rest_route('sml-dist/v1', '/jetpack', array(
            'methods' => 'GET',
            'permission_callback' => function () { return is_user_logged_in(); },
            'callback' => 'sml_dist_rest_jetpack_status',
        ));
        register_rest_route('sml-dist/v1', '/jetpack/share', array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => function () { return is_user_logged_in(); },
            'callback' => 'sml_dist_rest_jetpack_share',
        ));
    }
}
add_action('rest_api_init', 'sml_dist_jetpack_routes');

if (!function_exists('sml_dist_rest_jetpack_status')) {
    function sml_dist_rest_jetpack_status() {
        $services = array();
        foreach (sml_dist_jetpack_services() as $service => $platform) {
            $services[$service] = array(
                'meta_key' => sml_dist_meta_key($service),
                'template' => sml_dist_expected_template($service),
                'renders'  => $platform,
            );
        }
        return array(
            'active'      => sml_dist_jetpack_active(),
            'services'    => $services,
            'connections' => sml_dist_template_report(),
            'shadow_cpt'  => SML_DIST_SHADOW_CPT,
        );
    }
}

if (!function_exists('sml_dist_rest_jetpack_share')) {
    function sml_dist_rest_jetpack_share(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        if (!sml_dist_can_autoshare($user_id)) {
            return new WP_Error('not_entitled',
                'Auto-share is paused on your plan. The generated posts are still there to copy.',
                array('status' => 409));
        }

        $entity_type = sanitize_key((string) $request->get_param('entity_type')) ?: 'letter';
        $entity_id = (int) $request->get_param('entity_id');
        $event = sanitize_text_field((string) $request->get_param('event_type')) ?: 'letter.publish';
        $seed = max(0, min(2, (int) $request->get_param('seed')));

        $bundle = sml_dist_load_bundle($entity_type, $entity_id);
        if (!$bundle) {
            return new WP_Error('not_found', 'Nothing to share.', array('status' => 404));
        }

        return sml_dist_jetpack_publish($bundle, sml_dist_seo($bundle), $event, $seed);
    }
}
