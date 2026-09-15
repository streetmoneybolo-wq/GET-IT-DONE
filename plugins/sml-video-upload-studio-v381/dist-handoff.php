<?php
/**
 * Loop Distribution - Composer Handoff.
 *
 * For every platform we cannot post to (no write API, no approval yet, or the
 * creator has not linked it), we still generate the finished post and hand it
 * over: copy the caption, open the native composer, paste, done.
 *
 * This is deliberately a first-class feature rather than an error state. It
 * covers YouTube Community permanently, and every gated platform until its
 * approval lands.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_dist_handoff_url')) {
    /**
     * Prefilled composer URLs where the platform supports them. Instagram and
     * TikTok have no web composer that accepts prefilled text, so those get a
     * copy-only card and a link to the app.
     */
    function sml_dist_handoff_url($platform, $variant) {
        $meta = sml_dist_platform($platform);
        $base = $meta ? (string) $meta['compose'] : '';
        if (!$base) {
            return '';
        }

        $text = (string) $variant['caption'];

        switch ($platform) {
            case 'facebook':
                // Facebook's sharer takes a URL only; it scrapes OG tags for
                // the rest, which is why the OG work in dist-seo matters here.
                return $base . rawurlencode((string) $variant['link']);

            case 'youtube_community':
            case 'youtube_description':
                return $base;   // Studio has no prefill; the copy button does the work.

            case 'moomoo':
            case 'yahoo_finance':
            case 'webull':
            case 'etoro':
            case 'quora':
            case 'pinterest':
            case 'facebook_groups':
                return $base;   // Native editors do not provide a supported prefill URL.

            case 'reddit':
                $title = strtok($text, "\n") ?: 'StockMarketLoop market discussion';
                return $base . rawurlencode((string) $variant['link'])
                    . '&title=' . rawurlencode(sml_dist_truncate($title, 280));

            default:
                return $base . rawurlencode($text);
        }
    }
}

if (!function_exists('sml_dist_handoff_note')) {
    function sml_dist_handoff_note($platform) {
        $notes = array(
            'youtube_community' =>
                'YouTube has no API for community posts. Copy this, open Studio → Community → Create post, paste.',
            'instagram' =>
                'Instagram links are not clickable in captions. Copy the caption, post the card image, and put the link in your bio. Hashtags go in the first comment.',
            'tiktok' =>
                'TikTok needs a video. Copy this as your caption when you upload.',
            'facebook' =>
                'Opens Facebook\'s share dialog with your link. The preview card comes from the page itself.',
            'x' =>
                'Opens X with the post prefilled. Link auto-shortens to 23 characters.',
            'linkedin' =>
                'Opens LinkedIn with the post prefilled. First two lines are all anyone sees before "see more".',
            'threads' =>
                'Opens Threads with the post prefilled.',
            'mastodon' =>
                'Copy this and post from your instance.',
            'reddit' =>
                'Choose the right subreddit, read its rules, then use the prepared title and link. Automatic commercial posting requires Reddit approval.',
            'moomoo' =>
                'Copy this into moomoo Community. Add moomoo ticker tags and, for video posts, attach or link the video in the native editor.',
            'yahoo_finance' =>
                'Copy this post, open your Yahoo Finance Community profile, select Create, paste, review, and send.',
            'webull' =>
                'Copy this Webull-ready post, open Webull, enter Community, paste, review, and publish. The post intentionally contains no external link.',
            'etoro' =>
                'Copy this eToro-ready discussion post, open the News Feed, paste, review, and publish. It intentionally excludes links, promotion, and direct trade instructions.',
            'quora' =>
                'Copy this original long-form post, open your Quora profile, choose Create post (or your personal Space), paste, review, and publish. Keep the affiliation disclosure and single source link.',
            'pinterest' =>
                'Download the vertical card, copy the title and description, open Pinterest Create Pin, select a board, add the destination link and image alt text, then publish.',
            'facebook_groups' =>
                'Meta removed the Groups publishing API. Copy this, open a Group you manage, and publish it manually.',
        );
        return $notes[$platform] ?? 'Copy the caption and post it from the app.';
    }
}

if (!function_exists('sml_dist_handoff_payloads')) {
    /**
     * @return array One entry per platform the creator is not auto-posting to.
     */
    function sml_dist_handoff_payloads($bundle, $seo, $event = 'letter.publish', $only = array()) {
        $linked = sml_dist_linked_platforms((int) $bundle['author']['id']);
        $platforms = $only ?: array_keys(sml_dist_platforms());

        // A share token gives handoff posts the same click attribution as
        // automated ones. Without it, manual posting looks like it drives
        // nothing, which is false and would push creators the wrong way.
        $token = sml_dist_handoff_token($bundle, $event);
        $link = sml_dist_share_link($token);

        $out = array();
        foreach ($platforms as $platform) {
            $meta = sml_dist_platform($platform);
            if (!$meta) {
                continue;
            }
            // Skip platforms already auto-posting, unless explicitly requested.
            if (!$only && in_array($platform, $linked, true) && $meta['tier'] === 'A') {
                continue;
            }

            $variant = sml_dist_build_variant($bundle, $seo, $platform, $event, 0, $link);
            if (!$variant) {
                continue;
            }

            if ($platform === 'youtube_description') {
                $variant['caption'] = sml_dist_youtube_description($bundle, $seo, $link);
                $variant['char_count'] = mb_strlen($variant['caption']);
            }

            $aspect = sml_dist_card_platform_aspect($platform);
            $card = sml_dist_card($bundle, $seo, '', $aspect);

            $out[] = array(
                'platform'      => $platform,
                'label'         => $meta['label'],
                'tier'          => $meta['tier'],
                'caption'       => $variant['caption'],
                'first_comment' => $variant['first_comment'],
                'alt_text'      => (string) ($variant['alt_text'] ?? ''),
                'hashtags'      => $variant['hashtags'],
                'char_count'    => $variant['char_count'],
                'budget'        => (int) $meta['budget'],
                'needs_image'   => (bool) $meta['needs_image'],
                'card_url'      => $card['url'] ?? '',
                'card_aspect'   => $aspect,
                'compose_url'   => sml_dist_handoff_url($platform, $variant),
                'note'          => sml_dist_handoff_note($platform),
                'link'          => $link,
            );
        }
        return $out;
    }
}

if (!function_exists('sml_dist_handoff_token')) {
    /**
     * One stable handoff token per (entity, event), stored as a queue row with
     * status 'handoff' so clicks land in the same attribution table.
     */
    function sml_dist_handoff_token($bundle, $event) {
        global $wpdb;
        $table = sml_dist_table('queue');

        $idem = sha1(implode('|', array(
            (int) $bundle['author']['id'], 'handoff',
            $bundle['entity_type'], (int) $bundle['entity_id'], $event,
        )));

        $existing = $wpdb->get_var($wpdb->prepare(
            "SELECT share_token FROM $table WHERE idempotency_key = %s", $idem
        ));
        if ($existing) {
            return $existing;
        }

        $token = sml_dist_token();
        $wpdb->insert($table, array(
            'user_id'         => (int) $bundle['author']['id'],
            'account_id'      => null,
            'platform'        => 'handoff',
            'entity_type'     => $bundle['entity_type'],
            'entity_id'       => (int) $bundle['entity_id'],
            'event_type'      => $event,
            'variant_json'    => wp_json_encode(array('handoff' => true)),
            'share_token'     => $token,
            'status'          => 'handoff',
            'run_at'          => sml_dist_now(),
            'idempotency_key' => $idem,
        ));

        if (!$wpdb->insert_id) {
            $again = $wpdb->get_var($wpdb->prepare(
                "SELECT share_token FROM $table WHERE idempotency_key = %s", $idem
            ));
            return $again ?: $token;
        }
        return $token;
    }
}

if (!function_exists('sml_dist_linked_platforms')) {
    function sml_dist_linked_platforms($user_id) {
        global $wpdb;
        $rows = $wpdb->get_col($wpdb->prepare(
            "SELECT DISTINCT platform FROM " . sml_dist_table('accounts') . "
              WHERE user_id = %d AND status = 'active'",
            (int) $user_id
        ));
        return array_values((array) $rows);
    }
}
