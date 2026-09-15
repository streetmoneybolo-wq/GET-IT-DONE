<?php
/**
 * Loop Distribution - Bluesky driver.
 *
 * Bluesky is the only major platform that lets a third-party tool post on a
 * user's behalf with no app review, no partner programme and no per-post fee.
 * It is therefore the platform Phase 1 actually ships on.
 *
 * Auth is an App Password, not the account password. The UI must say so.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_dist_bsky_host')) {
    function sml_dist_bsky_host($account) {
        $host = trim((string) ($account['instance_url'] ?? ''));
        return $host ?: 'https://bsky.social';
    }
}

if (!function_exists('sml_dist_bsky_request')) {
    function sml_dist_bsky_request($host, $method, $path, $body = null, $token = '') {
        $args = array(
            'method'    => $method,
            'timeout'   => 15,
            'headers'   => array('Accept' => 'application/json'),
        );
        if ($token) {
            $args['headers']['Authorization'] = 'Bearer ' . $token;
        }
        if ($body !== null) {
            $args['headers']['Content-Type'] = 'application/json';
            $args['body'] = wp_json_encode($body);
        }

        $res = wp_remote_request(rtrim($host, '/') . '/xrpc/' . $path, $args);
        if (is_wp_error($res)) {
            return new WP_Error('network', $res->get_error_message(), array('retryable' => true));
        }

        $code = (int) wp_remote_retrieve_response_code($res);
        $json = json_decode(wp_remote_retrieve_body($res), true);

        if ($code >= 200 && $code < 300) {
            return is_array($json) ? $json : array();
        }
        $msg = is_array($json) ? ($json['message'] ?? $json['error'] ?? 'Bluesky error') : 'Bluesky error';

        if ($code === 401 || $code === 403) {
            return new WP_Error('auth', $msg, array('retryable' => false, 'status' => $code));
        }
        if ($code === 429 || $code >= 500) {
            return new WP_Error('rate_or_server', $msg, array('retryable' => true, 'status' => $code));
        }
        return new WP_Error('content', $msg, array('retryable' => false, 'status' => $code));
    }
}

/* ==================================================================
 * Session
 * ================================================================== */

if (!function_exists('sml_dist_bsky_login')) {
    function sml_dist_bsky_login($host, $identifier, $app_password) {
        return sml_dist_bsky_request($host, 'POST', 'com.atproto.server.createSession', array(
            'identifier' => $identifier,
            'password'   => $app_password,
        ));
    }
}

if (!function_exists('sml_dist_bsky_token')) {
    /**
     * Access JWTs last roughly two hours. Refresh when we are inside the last
     * ten minutes rather than waiting for a 401 mid-post.
     */
    function sml_dist_bsky_token($account) {
        $host = sml_dist_bsky_host($account);
        $access = sml_dist_secret_get($account['access_ref']);
        $expires = $account['expires_at'] ? strtotime($account['expires_at'] . ' UTC') : 0;

        if ($access && $expires > time() + 600) {
            return $access;
        }

        $refresh = sml_dist_secret_get($account['refresh_ref']);
        if (!$refresh) {
            return $access ?: new WP_Error('auth', 'Bluesky session expired. Reconnect the account.', array('retryable' => false));
        }

        $res = sml_dist_bsky_request($host, 'POST', 'com.atproto.server.refreshSession', null, $refresh);
        if (is_wp_error($res)) {
            return $res;
        }

        global $wpdb;
        sml_dist_secret_put($account['access_ref'], (string) ($res['accessJwt'] ?? ''));
        if (!empty($res['refreshJwt'])) {
            sml_dist_secret_put($account['refresh_ref'], (string) $res['refreshJwt']);
        }
        $wpdb->update(sml_dist_table('accounts'), array(
            'expires_at'    => gmdate('Y-m-d H:i:s', time() + 6600),
            'status'        => 'active',
            'last_error'    => null,
            'last_verified' => sml_dist_now(),
        ), array('id' => (int) $account['id']));

        return (string) ($res['accessJwt'] ?? '');
    }
}

/* ==================================================================
 * Rich text facets
 *
 * Bluesky does not auto-link anything. A bare URL is plain text unless we
 * supply byte-offset facets. Same for hashtags and cashtags.
 * ================================================================== */

if (!function_exists('sml_dist_bsky_facets')) {
    function sml_dist_bsky_facets($text) {
        $facets = array();

        // Links.
        if (preg_match_all('#https?://[^\s\)\]]+#', $text, $m, PREG_OFFSET_CAPTURE)) {
            foreach ($m[0] as $hit) {
                $url = rtrim($hit[0], '.,;:!?');
                $start = $hit[1];
                $facets[] = array(
                    'index'    => array('byteStart' => $start, 'byteEnd' => $start + strlen($url)),
                    'features' => array(array('$type' => 'app.bsky.richtext.facet#link', 'uri' => $url)),
                );
            }
        }

        // Hashtags. Bluesky's tag facet takes the tag without the leading #.
        if (preg_match_all('/(?<![\w#])#([A-Za-z][A-Za-z0-9_]{0,63})/', $text, $m2, PREG_OFFSET_CAPTURE)) {
            foreach ($m2[0] as $i => $hit) {
                $start = $hit[1];
                $facets[] = array(
                    'index'    => array('byteStart' => $start, 'byteEnd' => $start + strlen($hit[0])),
                    'features' => array(array('$type' => 'app.bsky.richtext.facet#tag', 'tag' => $m2[1][$i][0])),
                );
            }
        }

        usort($facets, function ($a, $b) {
            return $a['index']['byteStart'] <=> $b['index']['byteStart'];
        });
        return $facets;
    }
}

/* ==================================================================
 * Blobs and embeds
 * ================================================================== */

if (!function_exists('sml_dist_bsky_upload_blob')) {
    function sml_dist_bsky_upload_blob($host, $token, $url) {
        $img = wp_remote_get($url, array('timeout' => 20));
        if (is_wp_error($img)) {
            return null;
        }
        $body = wp_remote_retrieve_body($img);
        $mime = wp_remote_retrieve_header($img, 'content-type') ?: 'image/png';

        // Bluesky rejects blobs over 1MB. A card that fails to upload must not
        // fail the post, so this returns null and the post ships without it.
        if (!$body || strlen($body) > 976 * 1024) {
            return null;
        }

        $res = wp_remote_post(rtrim($host, '/') . '/xrpc/com.atproto.repo.uploadBlob', array(
            'timeout' => 25,
            'headers' => array('Authorization' => 'Bearer ' . $token, 'Content-Type' => $mime),
            'body'    => $body,
        ));
        if (is_wp_error($res) || (int) wp_remote_retrieve_response_code($res) >= 300) {
            return null;
        }
        $json = json_decode(wp_remote_retrieve_body($res), true);
        return $json['blob'] ?? null;
    }
}

/* ==================================================================
 * Post
 * ================================================================== */

if (!function_exists('sml_dist_bsky_post')) {
    function sml_dist_bsky_post($variant, $account, $row = null) {
        $host = sml_dist_bsky_host($account);
        $token = sml_dist_bsky_token($account);
        if (is_wp_error($token)) {
            return $token;
        }
        if (!$token) {
            return new WP_Error('auth', 'No Bluesky session. Reconnect the account.', array('retryable' => false));
        }

        $text = (string) $variant['caption'];

        // Bluesky counts graphemes, not bytes. Trim conservatively rather than
        // letting the API reject the whole post.
        if (mb_strlen($text) > 300) {
            $text = sml_dist_truncate($text, 297);
        }

        $record = array(
            '$type'     => 'app.bsky.feed.post',
            'text'      => $text,
            'createdAt' => gmdate('Y-m-d\TH:i:s\Z'),
            'langs'     => array('en'),
        );

        $facets = sml_dist_bsky_facets($text);
        if ($facets) {
            $record['facets'] = $facets;
        }

        // Prefer an external embed: it renders as a link card with the title
        // and image, which outperforms a bare image attachment.
        if (!empty($variant['link'])) {
            $external = array(
                'uri'         => $variant['link'],
                'title'       => sml_dist_truncate((string) ($variant['hook'] ?: ''), 100),
                'description' => sml_dist_truncate((string) ($variant['body'] ?: ''), 200),
            );
            if (!empty($variant['card_url'])) {
                $blob = sml_dist_bsky_upload_blob($host, $token, $variant['card_url']);
                if ($blob) {
                    $external['thumb'] = $blob;
                }
            }
            $record['embed'] = array(
                '$type'    => 'app.bsky.embed.external',
                'external' => $external,
            );
        }

        $res = sml_dist_bsky_request($host, 'POST', 'com.atproto.repo.createRecord', array(
            'repo'       => $account['remote_id'],
            'collection' => 'app.bsky.feed.post',
            'record'     => $record,
        ), $token);

        if (is_wp_error($res)) {
            return $res;
        }

        $uri = (string) ($res['uri'] ?? '');
        $rkey = $uri ? substr($uri, strrpos($uri, '/') + 1) : '';
        $permalink = $rkey ? 'https://bsky.app/profile/' . $account['handle'] . '/post/' . $rkey : '';

        return array('remote_id' => $uri, 'permalink' => $permalink);
    }
}

if (!function_exists('sml_dist_register_bluesky')) {
    function sml_dist_register_bluesky($drivers) {
        $drivers['bluesky'] = 'sml_dist_bsky_post';
        return $drivers;
    }
}
add_filter('sml_dist_drivers', 'sml_dist_register_bluesky');

/* ==================================================================
 * Linking
 * ================================================================== */

if (!function_exists('sml_dist_bsky_link_account')) {
    function sml_dist_bsky_link_account($user_id, $handle, $app_password, $host = '') {
        if (!sml_dist_can_store_secrets()) {
            return new WP_Error('no_key',
                'Token encryption is not configured. Add SML_DIST_KEY to wp-config.php before linking accounts.',
                array('status' => 500));
        }

        $handle = ltrim(trim((string) $handle), '@');
        $host = $host ?: 'https://bsky.social';

        // Refuse anything that looks like a primary password. App Passwords
        // are always xxxx-xxxx-xxxx-xxxx.
        if (!preg_match('/^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/i', trim((string) $app_password))) {
            return new WP_Error('not_app_password',
                'That is not an App Password. In Bluesky go to Settings → App Passwords, create one, and paste it here. Never your account password.',
                array('status' => 400));
        }

        $session = sml_dist_bsky_login($host, $handle, trim((string) $app_password));
        if (is_wp_error($session)) {
            return $session;
        }
        if (empty($session['did'])) {
            return new WP_Error('auth', 'Bluesky did not return an account id.', array('status' => 400));
        }

        global $wpdb;
        $table = sml_dist_table('accounts');

        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE user_id = %d AND platform = 'bluesky' AND remote_id = %s",
            (int) $user_id, $session['did']
        ), ARRAY_A);

        $access_ref  = $existing ? $existing['access_ref']  : sml_dist_secret_ref();
        $refresh_ref = $existing ? $existing['refresh_ref'] : sml_dist_secret_ref();

        sml_dist_secret_put($access_ref, (string) ($session['accessJwt'] ?? ''));
        sml_dist_secret_put($refresh_ref, (string) ($session['refreshJwt'] ?? ''));

        $data = array(
            'user_id'       => (int) $user_id,
            'platform'      => 'bluesky',
            'remote_id'     => (string) $session['did'],
            'handle'        => (string) ($session['handle'] ?? $handle),
            'display_name'  => (string) ($session['handle'] ?? $handle),
            'instance_url'  => $host,
            'access_ref'    => $access_ref,
            'refresh_ref'   => $refresh_ref,
            'expires_at'    => gmdate('Y-m-d H:i:s', time() + 6600),
            'status'        => 'active',
            'last_error'    => null,
            'last_verified' => sml_dist_now(),
        );

        if ($existing) {
            $wpdb->update($table, $data, array('id' => (int) $existing['id']));
            $id = (int) $existing['id'];
        } else {
            $wpdb->insert($table, $data);
            $id = (int) $wpdb->insert_id;
        }

        sml_dist_start_trial((int) $user_id);

        return array('ok' => true, 'account_id' => $id, 'handle' => $data['handle']);
    }
}
