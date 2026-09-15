<?php
/**
 * Loop Distribution - Threads publishing driver.
 *
 * Creates text/image/video containers, preserves unfinished media containers
 * inside the queue row, and publishes them when Threads reports readiness.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_dist_threads_api')) {
    function sml_dist_threads_api($method, $path, $token, $params = array()) {
        $method = strtoupper((string) $method);
        $url = 'https://graph.threads.net/v1.0/' . ltrim((string) $path, '/');
        $args = array('method' => $method, 'timeout' => 25);

        if ($method === 'GET') {
            $params['access_token'] = $token;
            $url = add_query_arg($params, $url);
        } else {
            $params['access_token'] = $token;
            $args['body'] = $params;
        }

        $response = wp_remote_request($url, $args);
        if (is_wp_error($response)) {
            return new WP_Error('threads_network', $response->get_error_message(), array('retryable' => true));
        }

        $status = (int) wp_remote_retrieve_response_code($response);
        $json = json_decode(wp_remote_retrieve_body($response), true);
        if ($status >= 200 && $status < 300) {
            return is_array($json) ? $json : array();
        }

        $error = is_array($json) ? (array) ($json['error'] ?? array()) : array();
        $message = sanitize_text_field((string) ($error['message'] ?? 'Threads API request failed.'));
        $code = (int) ($error['code'] ?? 0);
        $lower = strtolower($message);

        if ($status === 401 || $status === 403 || in_array($code, array(102, 190), true)) {
            return new WP_Error('auth', $message, array('retryable' => false, 'status' => $status));
        }
        if ($status === 429 || $status >= 500) {
            return new WP_Error('threads_rate_or_server', $message, array('retryable' => true, 'status' => $status));
        }
        if (strpos($lower, 'requested resource does not exist') !== false
            || strpos($lower, 'not ready') !== false
            || strpos($lower, 'processing') !== false) {
            return new WP_Error('threads_processing', $message, array('retryable' => true, 'status' => $status));
        }
        return new WP_Error('threads_content', $message, array('retryable' => false, 'status' => $status));
    }
}

if (!function_exists('sml_dist_threads_token')) {
    function sml_dist_threads_token($account) {
        $token = sml_dist_secret_get((string) ($account['access_ref'] ?? ''));
        if ($token === '') {
            return new WP_Error('auth', 'Threads session is missing. Reconnect the account.', array('retryable' => false));
        }

        $expires = !empty($account['expires_at']) ? strtotime($account['expires_at'] . ' UTC') : 0;
        if (!$expires || $expires > time() + 7 * DAY_IN_SECONDS) {
            return $token;
        }

        $refresh = wp_remote_get(add_query_arg(array(
            'grant_type' => 'th_refresh_token',
            'access_token' => $token,
        ), 'https://graph.threads.net/refresh_access_token'), array('timeout' => 25));

        if (is_wp_error($refresh)) {
            return $expires > time()
                ? $token
                : new WP_Error('auth', 'Threads session expired. Reconnect the account.', array('retryable' => false));
        }
        $json = json_decode(wp_remote_retrieve_body($refresh), true);
        if ((int) wp_remote_retrieve_response_code($refresh) >= 300 || empty($json['access_token'])) {
            return $expires > time()
                ? $token
                : new WP_Error('auth', 'Threads session expired. Reconnect the account.', array('retryable' => false));
        }

        $token = (string) $json['access_token'];
        sml_dist_secret_put((string) $account['access_ref'], $token);
        global $wpdb;
        $wpdb->update(sml_dist_table('accounts'), array(
            'expires_at' => gmdate('Y-m-d H:i:s', time() + (int) ($json['expires_in'] ?? 5184000)),
            'last_error' => null,
            'last_verified' => sml_dist_now(),
            'status' => 'active',
        ), array('id' => (int) $account['id']));

        return $token;
    }
}

if (!function_exists('sml_dist_threads_media_body')) {
    function sml_dist_threads_media_body($variant) {
        $caption = sml_dist_truncate((string) ($variant['caption'] ?? ''), 500);
        $event = (string) ($variant['event_type'] ?? '');
        $video = esc_url_raw((string) ($variant['video_url'] ?? ''));
        $cover = esc_url_raw((string) ($variant['cover_url'] ?? $variant['card_url'] ?? ''));

        if ($event === 'video.publish' && strpos($video, 'https://') === 0) {
            return array('media_type' => 'VIDEO', 'video_url' => $video, 'text' => $caption);
        }
        if ($cover && strpos($cover, 'https://') === 0) {
            return array('media_type' => 'IMAGE', 'image_url' => $cover, 'text' => $caption);
        }
        return array('media_type' => 'TEXT', 'text' => $caption);
    }
}

if (!function_exists('sml_dist_threads_store_creation')) {
    function sml_dist_threads_store_creation($row, $variant, $creation_id, $media_type) {
        if (empty($row['id'])) {
            return;
        }
        $variant['threads_creation_id'] = (string) $creation_id;
        $variant['threads_media_type'] = (string) $media_type;
        global $wpdb;
        $wpdb->update(sml_dist_table('queue'), array(
            'variant_json' => wp_json_encode($variant),
        ), array('id' => (int) $row['id']));
    }
}

if (!function_exists('sml_dist_threads_post')) {
    function sml_dist_threads_post($variant, $account, $row = null) {
        $token = sml_dist_threads_token($account);
        if (is_wp_error($token)) {
            return $token;
        }

        $user_id = (string) ($account['remote_id'] ?? '');
        if ($user_id === '') {
            return new WP_Error('auth', 'Threads account id is missing. Reconnect the account.', array('retryable' => false));
        }

        $body = sml_dist_threads_media_body($variant);
        $creation_id = (string) ($variant['threads_creation_id'] ?? '');
        if ($creation_id === '') {
            $created = sml_dist_threads_api('POST', rawurlencode($user_id) . '/threads', $token, $body);
            if (is_wp_error($created)) {
                return $created;
            }
            $creation_id = (string) ($created['id'] ?? '');
            if ($creation_id === '') {
                return new WP_Error('threads_container', 'Threads did not return a media container.', array('retryable' => true));
            }
            sml_dist_threads_store_creation((array) $row, $variant, $creation_id, $body['media_type']);
        }

        // Image and video containers are processed asynchronously. Keep the
        // same container id in the queue and let normal backoff retry it.
        if (($body['media_type'] ?? 'TEXT') !== 'TEXT') {
            $status = sml_dist_threads_api('GET', rawurlencode($creation_id), $token, array(
                'fields' => 'status,error_message',
            ));
            if (is_wp_error($status)) {
                return $status;
            }
            $state = strtoupper((string) ($status['status'] ?? ''));
            if ($state === 'ERROR' || $state === 'EXPIRED') {
                return new WP_Error('threads_media', sanitize_text_field((string) ($status['error_message'] ?? 'Threads could not process this media.')), array('retryable' => false));
            }
            if ($state && !in_array($state, array('FINISHED', 'PUBLISHED'), true)) {
                return new WP_Error('threads_processing', 'Threads is still processing the media.', array('retryable' => true));
            }
        }

        $published = sml_dist_threads_api('POST', rawurlencode($user_id) . '/threads_publish', $token, array(
            'creation_id' => $creation_id,
        ));
        if (is_wp_error($published)) {
            return $published;
        }
        $media_id = (string) ($published['id'] ?? '');
        if ($media_id === '') {
            return new WP_Error('threads_publish', 'Threads did not return a published post id.', array('retryable' => true));
        }

        $post = sml_dist_threads_api('GET', rawurlencode($media_id), $token, array('fields' => 'id,permalink'));
        if (is_wp_error($post)) {
            return array('remote_id' => $media_id, 'permalink' => '');
        }
        return array(
            'remote_id' => $media_id,
            'permalink' => esc_url_raw((string) ($post['permalink'] ?? '')),
        );
    }
}

if (!function_exists('sml_dist_register_threads')) {
    function sml_dist_register_threads($drivers) {
        $drivers['threads'] = 'sml_dist_threads_post';
        return $drivers;
    }
}
add_filter('sml_dist_drivers', 'sml_dist_register_threads');

if (!function_exists('sml_dist_threads_live_rest_bridge')) {
    function sml_dist_threads_live_rest_bridge($response, $handler, $request) {
        if (!$request instanceof WP_REST_Request || strtoupper($request->get_method()) !== 'POST') {
            return $response;
        }
        $routes = array('/sml-group-live/v1/start', '/sml/v1/group/live-room/start');
        if (!in_array($request->get_route(), $routes, true) || is_wp_error($response)) {
            return $response;
        }
        $rest_response = rest_ensure_response($response);
        if ((int) $rest_response->get_status() >= 300 || !is_user_logged_in()) {
            return $response;
        }

        $visibility = sanitize_key((string) ($request->get_param('visibility') ?: 'public'));
        if ($visibility !== 'public') {
            return $response;
        }
        $data = (array) $rest_response->get_data();
        $room = !empty($data['room']) && is_array($data['room']) ? $data['room'] : $data;
        $session_id = (string) ($data['session_id'] ?? $room['session_id'] ?? $room['id'] ?? $room['name'] ?? '');
        $user_id = get_current_user_id();
        $dedupe = 'sml_dist_live_bridge_' . sha1($user_id . '|' . $request->get_route() . '|' . $session_id);
        if (get_transient($dedupe)) {
            return $response;
        }

        $user = wp_get_current_user();
        $handle = sanitize_key((string) ($user->user_nicename ?: $user->user_login));
        $stream = array(
            'id' => $session_id ?: (string) time(),
            'session_id' => $session_id,
            'author_id' => $user_id,
            'title' => sanitize_text_field((string) ($request->get_param('title') ?: ($data['name'] ?? 'Live on StockMarketLoop'))),
            'description' => sanitize_textarea_field((string) $request->get_param('description')),
            'ticker' => strtoupper(preg_replace('/[^A-Z]/', '', (string) $request->get_param('ticker'))),
            'visibility' => 'public',
            'thumbnail_url' => esc_url_raw((string) ($request->get_param('thumbnail_url') ?: ($room['thumbnail_url'] ?? ''))),
            'watch_url' => esc_url_raw((string) ($room['watch_url'] ?? $data['watch_url'] ?? home_url('/live/?room=' . rawurlencode($handle)))),
            'started_at' => sml_dist_now(),
        );
        if (function_exists('sml_dist_bundle_from_stream')) {
            $bundle = sml_dist_bundle_from_stream($stream);
            $stream['dist_entity_id'] = (int) ($bundle['entity_id'] ?? 0);
            $history = get_user_meta($user_id, 'sml_dist_stream_library', true);
            $history = is_array($history) ? $history : array();
            $history[(string) $stream['dist_entity_id']] = $stream;
            update_user_meta($user_id, 'sml_dist_stream_library', array_slice($history, -80, 80, true));
        }
        set_transient($dedupe, 1, 6 * HOUR_IN_SECONDS);
        sml_dist_event('stream.start', sml_dist_bundle_from_stream($stream));

        return $response;
    }
}
add_filter('rest_request_after_callbacks', 'sml_dist_threads_live_rest_bridge', 20, 3);
