<?php
/**
 * Loop Distribution - Meta and Threads account linking callbacks.
 *
 * App secrets must be defined in wp-config.php. User and page tokens are
 * encrypted by the existing sml_dist_secret_* store before persistence.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_dist_meta_app_id')) {
    function sml_dist_meta_app_id() {
        return defined('SML_META_APP_ID') ? trim((string) SML_META_APP_ID) : '1447575867207373';
    }
}

if (!function_exists('sml_dist_meta_app_secret')) {
    function sml_dist_meta_app_secret() {
        return defined('SML_META_APP_SECRET') ? trim((string) SML_META_APP_SECRET) : '';
    }
}

if (!function_exists('sml_dist_meta_configuration_id')) {
    function sml_dist_meta_configuration_id() {
        return defined('SML_META_CONFIGURATION_ID')
            ? trim((string) SML_META_CONFIGURATION_ID)
            : '1017379174590061';
    }
}

if (!function_exists('sml_dist_meta_graph_version')) {
    function sml_dist_meta_graph_version() {
        $version = defined('SML_META_GRAPH_VERSION') ? trim((string) SML_META_GRAPH_VERSION) : 'v25.0';
        return preg_match('/^v\d+\.\d+$/', $version) ? $version : 'v25.0';
    }
}

if (!function_exists('sml_dist_threads_app_id')) {
    function sml_dist_threads_app_id() {
        return defined('SML_THREADS_APP_ID') ? trim((string) SML_THREADS_APP_ID) : '1407909977945671';
    }
}

if (!function_exists('sml_dist_threads_app_secret')) {
    function sml_dist_threads_app_secret() {
        return defined('SML_THREADS_APP_SECRET') ? trim((string) SML_THREADS_APP_SECRET) : '';
    }
}

if (!function_exists('sml_dist_meta_callback_url')) {
    function sml_dist_meta_callback_url() {
        return rest_url('sml-dist/v1/meta/callback');
    }
}

if (!function_exists('sml_dist_meta_public_permission')) {
    function sml_dist_meta_public_permission() {
        return true;
    }
}

if (!function_exists('sml_dist_meta_routes')) {
    function sml_dist_meta_routes() {
        $ns = 'sml-dist/v1';

        register_rest_route($ns, '/meta/health', array(
            'methods' => 'GET',
            'permission_callback' => function () { return current_user_can('manage_options'); },
            'callback' => 'sml_dist_meta_health',
        ));
        register_rest_route($ns, '/meta/connect/(?P<platform>facebook|instagram|threads)', array(
            'methods' => 'GET',
            'permission_callback' => function () { return is_user_logged_in(); },
            'callback' => 'sml_dist_meta_connect',
        ));
        register_rest_route($ns, '/meta/callback', array(
            'methods' => 'GET',
            'permission_callback' => 'sml_dist_meta_public_permission',
            'callback' => 'sml_dist_meta_callback',
        ));
        register_rest_route($ns, '/meta/deauthorize', array(
            'methods' => 'POST',
            'permission_callback' => 'sml_dist_meta_public_permission',
            'callback' => 'sml_dist_meta_deauthorize',
        ));
        register_rest_route($ns, '/meta/data-deletion', array(
            'methods' => 'POST',
            'permission_callback' => 'sml_dist_meta_public_permission',
            'callback' => 'sml_dist_meta_data_deletion',
        ));
        register_rest_route($ns, '/meta/data-deletion/status/(?P<code>[A-Za-z0-9_-]{20,64})', array(
            'methods' => 'GET',
            'permission_callback' => 'sml_dist_meta_public_permission',
            'callback' => 'sml_dist_meta_data_deletion_status',
        ));
    }
}
add_action('rest_api_init', 'sml_dist_meta_routes');

if (!function_exists('sml_dist_meta_health')) {
    function sml_dist_meta_health() {
        return array(
            'ok' => true,
            'callback_url' => sml_dist_meta_callback_url(),
            'deauthorize_url' => rest_url('sml-dist/v1/meta/deauthorize'),
            'data_deletion_url' => rest_url('sml-dist/v1/meta/data-deletion'),
            'meta' => array(
                'app_id' => sml_dist_meta_app_id(),
                'configuration_id' => sml_dist_meta_configuration_id(),
                'secret_configured' => sml_dist_meta_app_secret() !== '',
            ),
            'threads' => array(
                'app_id' => sml_dist_threads_app_id(),
                'secret_configured' => sml_dist_threads_app_secret() !== '',
            ),
            'secret_store' => sml_dist_can_store_secrets(),
        );
    }
}

if (!function_exists('sml_dist_meta_state_key')) {
    function sml_dist_meta_state_key($state) {
        return 'sml_dist_meta_' . hash('sha256', (string) $state);
    }
}

if (!function_exists('sml_dist_meta_new_state')) {
    function sml_dist_meta_new_state($user_id, $platform) {
        try {
            $state = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        } catch (Exception $e) {
            return new WP_Error('state', 'Could not start a secure connection.', array('status' => 500));
        }

        set_transient(sml_dist_meta_state_key($state), array(
            'user_id' => (int) $user_id,
            'platform' => (string) $platform,
            'created_at' => time(),
        ), 10 * MINUTE_IN_SECONDS);

        return $state;
    }
}

if (!function_exists('sml_dist_meta_consume_state')) {
    function sml_dist_meta_consume_state($state) {
        if (!is_string($state) || !preg_match('/^[A-Za-z0-9_-]{30,80}$/', $state)) {
            return null;
        }
        $key = sml_dist_meta_state_key($state);
        $data = get_transient($key);
        delete_transient($key);
        return is_array($data) ? $data : null;
    }
}

if (!function_exists('sml_dist_meta_connect')) {
    function sml_dist_meta_connect(WP_REST_Request $request) {
        $platform = sanitize_key((string) $request->get_param('platform'));
        $state = sml_dist_meta_new_state(get_current_user_id(), $platform);
        if (is_wp_error($state)) {
            return $state;
        }

        $redirect = sml_dist_meta_callback_url();

        if ($platform === 'threads') {
            if (!sml_dist_threads_app_id() || !sml_dist_threads_app_secret()) {
                return new WP_Error('not_configured', 'Threads connection is not configured yet.', array('status' => 503));
            }
            $url = add_query_arg(array(
                'client_id' => sml_dist_threads_app_id(),
                'redirect_uri' => $redirect,
                'scope' => 'threads_basic,threads_content_publish',
                'response_type' => 'code',
                'state' => $state,
            ), 'https://threads.net/oauth/authorize');
        } else {
            if (!sml_dist_meta_app_id() || !sml_dist_meta_app_secret() || !sml_dist_meta_configuration_id()) {
                return new WP_Error('not_configured', 'Meta connection is not configured yet.', array('status' => 503));
            }
            $url = add_query_arg(array(
                'client_id' => sml_dist_meta_app_id(),
                'redirect_uri' => $redirect,
                'state' => $state,
                'response_type' => 'code',
                'config_id' => sml_dist_meta_configuration_id(),
                'override_default_response_type' => 'true',
            ), 'https://www.facebook.com/' . sml_dist_meta_graph_version() . '/dialog/oauth');
        }

        return array('ok' => true, 'authorize_url' => esc_url_raw($url));
    }
}

if (!function_exists('sml_dist_meta_remote_json')) {
    function sml_dist_meta_remote_json($url, $args = array()) {
        $defaults = array('timeout' => 20, 'redirection' => 2);
        $response = !empty($args['method']) && strtoupper($args['method']) === 'POST'
            ? wp_remote_post($url, array_merge($defaults, $args))
            : wp_remote_get($url, array_merge($defaults, $args));

        if (is_wp_error($response)) {
            return new WP_Error('meta_transport', $response->get_error_message(), array('retryable' => true));
        }

        $code = (int) wp_remote_retrieve_response_code($response);
        $body = json_decode((string) wp_remote_retrieve_body($response), true);
        if (!is_array($body)) {
            return new WP_Error('meta_response', 'Meta returned an unreadable response.', array('retryable' => $code >= 500));
        }
        if ($code < 200 || $code >= 300 || isset($body['error'])) {
            $message = isset($body['error']['message']) ? (string) $body['error']['message'] : 'Meta rejected the request.';
            $error_code = isset($body['error']['code']) ? 'meta_' . absint($body['error']['code']) : 'meta_api';
            return new WP_Error($error_code, $message, array('retryable' => $code >= 500));
        }
        return $body;
    }
}

if (!function_exists('sml_dist_meta_graph_get')) {
    function sml_dist_meta_graph_get($path, $token, $fields = '') {
        $args = array('access_token' => (string) $token);
        if ($fields !== '') {
            $args['fields'] = $fields;
        }
        $url = add_query_arg($args, 'https://graph.facebook.com/' . sml_dist_meta_graph_version() . '/' . ltrim($path, '/'));
        return sml_dist_meta_remote_json($url);
    }
}

if (!function_exists('sml_dist_meta_upsert_account')) {
    function sml_dist_meta_upsert_account($args) {
        global $wpdb;

        if (!sml_dist_can_store_secrets()) {
            return new WP_Error('no_key', 'Encrypted token storage is unavailable.', array('status' => 500));
        }

        $table = sml_dist_table('accounts');
        $existing = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE user_id = %d AND platform = %s AND remote_id = %s",
            (int) $args['user_id'], (string) $args['platform'], (string) $args['remote_id']
        ), ARRAY_A);

        $access_ref = $existing ? (string) $existing['access_ref'] : sml_dist_secret_ref();
        if (!sml_dist_secret_put($access_ref, (string) $args['access_token'])) {
            return new WP_Error('token_store', 'The access token could not be encrypted.', array('status' => 500));
        }

        $data = array(
            'user_id' => (int) $args['user_id'],
            'platform' => sanitize_key((string) $args['platform']),
            'remote_id' => sanitize_text_field((string) $args['remote_id']),
            'handle' => sanitize_text_field((string) $args['handle']),
            'display_name' => sanitize_text_field((string) $args['display_name']),
            'avatar_url' => esc_url_raw((string) ($args['avatar_url'] ?? '')),
            'instance_url' => '',
            'scopes' => wp_json_encode((array) ($args['scopes'] ?? array())),
            'access_ref' => $access_ref,
            'refresh_ref' => null,
            'expires_at' => !empty($args['expires_at']) ? (string) $args['expires_at'] : null,
            'status' => 'active',
            'last_error' => null,
            'last_verified' => sml_dist_now(),
        );

        if ($existing) {
            $wpdb->update($table, $data, array('id' => (int) $existing['id']));
            $id = (int) $existing['id'];
        } else {
            $wpdb->insert($table, $data);
            $id = (int) $wpdb->insert_id;
        }

        if (!$id) {
            sml_dist_secret_delete($access_ref);
            return new WP_Error('account_store', 'The linked account could not be saved.', array('status' => 500));
        }

        foreach (array('letter.publish', 'video.publish', 'stream.start') as $event) {
            sml_dist_save_rule((int) $args['user_id'], $event, $id, true, 0);
        }
        sml_dist_start_trial((int) $args['user_id']);

        return $id;
    }
}

if (!function_exists('sml_dist_meta_exchange_business_code')) {
    function sml_dist_meta_exchange_business_code($code) {
        return sml_dist_meta_remote_json(
            'https://graph.facebook.com/' . sml_dist_meta_graph_version() . '/oauth/access_token',
            array('method' => 'POST', 'body' => array(
                'client_id' => sml_dist_meta_app_id(),
                'client_secret' => sml_dist_meta_app_secret(),
                'redirect_uri' => sml_dist_meta_callback_url(),
                'code' => (string) $code,
            ))
        );
    }
}

if (!function_exists('sml_dist_meta_import_business_accounts')) {
    function sml_dist_meta_import_business_accounts($user_id, $token, $expires_in = 0) {
        $identity = sml_dist_meta_graph_get('me', $token, 'id,name');
        if (is_wp_error($identity)) {
            return $identity;
        }

        $pages = sml_dist_meta_graph_get('me/accounts', $token, 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}');
        if (is_wp_error($pages)) {
            return $pages;
        }

        $expires_at = $expires_in > 0 ? gmdate('Y-m-d H:i:s', time() + (int) $expires_in) : null;
        $saved = array();
        foreach ((array) ($pages['data'] ?? array()) as $page) {
            if (empty($page['id']) || empty($page['access_token'])) {
                continue;
            }
            $scope_meta = array(
                'auth_user_id' => (string) ($identity['id'] ?? ''),
                'permissions' => array('business_management', 'pages_manage_posts', 'pages_show_list'),
                'page_id' => (string) $page['id'],
            );
            $page_id = sml_dist_meta_upsert_account(array(
                'user_id' => $user_id,
                'platform' => 'facebook',
                'remote_id' => (string) $page['id'],
                'handle' => (string) ($page['name'] ?? $page['id']),
                'display_name' => (string) ($page['name'] ?? 'Facebook Page'),
                'access_token' => (string) $page['access_token'],
                'expires_at' => $expires_at,
                'scopes' => $scope_meta,
            ));
            if (!is_wp_error($page_id)) {
                $saved[] = array('platform' => 'facebook', 'account_id' => $page_id);
            }

            $ig = isset($page['instagram_business_account']) && is_array($page['instagram_business_account'])
                ? $page['instagram_business_account'] : array();
            if (!empty($ig['id'])) {
                $ig_id = sml_dist_meta_upsert_account(array(
                    'user_id' => $user_id,
                    'platform' => 'instagram',
                    'remote_id' => (string) $ig['id'],
                    'handle' => (string) ($ig['username'] ?? $ig['id']),
                    'display_name' => (string) ($ig['name'] ?? $ig['username'] ?? 'Instagram'),
                    'avatar_url' => (string) ($ig['profile_picture_url'] ?? ''),
                    'access_token' => (string) $page['access_token'],
                    'expires_at' => $expires_at,
                    'scopes' => array_merge($scope_meta, array(
                        'instagram_id' => (string) $ig['id'],
                        'permissions' => array('instagram_business_content_publish', 'business_management', 'pages_show_list'),
                    )),
                ));
                if (!is_wp_error($ig_id)) {
                    $saved[] = array('platform' => 'instagram', 'account_id' => $ig_id);
                }
            }
        }

        return $saved ? $saved : new WP_Error('no_assets', 'Meta did not return an eligible Facebook Page or Instagram business account.', array('status' => 400));
    }
}

if (!function_exists('sml_dist_threads_exchange_code')) {
    function sml_dist_threads_exchange_code($code) {
        $short = sml_dist_meta_remote_json('https://graph.threads.net/oauth/access_token', array(
            'method' => 'POST',
            'body' => array(
                'client_id' => sml_dist_threads_app_id(),
                'client_secret' => sml_dist_threads_app_secret(),
                'grant_type' => 'authorization_code',
                'redirect_uri' => sml_dist_meta_callback_url(),
                'code' => (string) $code,
            ),
        ));
        if (is_wp_error($short) || empty($short['access_token'])) {
            return $short;
        }

        $long = sml_dist_meta_remote_json(add_query_arg(array(
            'grant_type' => 'th_exchange_token',
            'client_secret' => sml_dist_threads_app_secret(),
            'access_token' => (string) $short['access_token'],
        ), 'https://graph.threads.net/access_token'));

        return is_wp_error($long) ? $short : $long;
    }
}

if (!function_exists('sml_dist_threads_import_account')) {
    function sml_dist_threads_import_account($user_id, $token, $expires_in = 0) {
        $profile = sml_dist_meta_remote_json(add_query_arg(array(
            'fields' => 'id,username,threads_profile_picture_url',
            'access_token' => (string) $token,
        ), 'https://graph.threads.net/v1.0/me'));
        if (is_wp_error($profile)) {
            return $profile;
        }
        $id = (string) ($profile['id'] ?? '');
        if ($id === '') {
            return new WP_Error('no_profile', 'Threads did not return an account.', array('status' => 400));
        }
        return sml_dist_meta_upsert_account(array(
            'user_id' => $user_id,
            'platform' => 'threads',
            'remote_id' => $id,
            'handle' => (string) ($profile['username'] ?? $id),
            'display_name' => (string) ($profile['username'] ?? 'Threads'),
            'avatar_url' => (string) ($profile['threads_profile_picture_url'] ?? ''),
            'access_token' => (string) $token,
            'expires_at' => $expires_in > 0 ? gmdate('Y-m-d H:i:s', time() + (int) $expires_in) : null,
            'scopes' => array(
                'auth_user_id' => $id,
                'permissions' => array('threads_basic', 'threads_content_publish'),
            ),
        ));
    }
}

if (!function_exists('sml_dist_meta_callback')) {
    function sml_dist_meta_callback(WP_REST_Request $request) {
        $state = sml_dist_meta_consume_state((string) $request->get_param('state'));
        if (!$state) {
            return new WP_Error('invalid_state', 'This connection link expired or was already used.', array('status' => 400));
        }

        if ($request->get_param('error')) {
            $message = sanitize_text_field((string) $request->get_param('error_description'));
            wp_safe_redirect(add_query_arg('sml_dist_error', rawurlencode($message ?: 'Authorization was cancelled.'), home_url('/distribute/')));
            exit;
        }

        $code = trim((string) $request->get_param('code'));
        if ($code === '') {
            return new WP_Error('missing_code', 'Meta did not return an authorization code.', array('status' => 400));
        }

        if ($state['platform'] === 'threads') {
            $token = sml_dist_threads_exchange_code($code);
            if (!is_wp_error($token) && !empty($token['access_token'])) {
                $result = sml_dist_threads_import_account((int) $state['user_id'], (string) $token['access_token'], (int) ($token['expires_in'] ?? 0));
            } else {
                $result = $token;
            }
            $count = is_wp_error($result) ? 0 : 1;
        } else {
            $token = sml_dist_meta_exchange_business_code($code);
            if (!is_wp_error($token) && !empty($token['access_token'])) {
                $result = sml_dist_meta_import_business_accounts((int) $state['user_id'], (string) $token['access_token'], (int) ($token['expires_in'] ?? 0));
            } else {
                $result = $token;
            }
            $count = is_array($result) ? count($result) : 0;
        }

        if (is_wp_error($result)) {
            wp_safe_redirect(add_query_arg('sml_dist_error', rawurlencode($result->get_error_message()), home_url('/distribute/')));
            exit;
        }

        wp_safe_redirect(add_query_arg('sml_dist_linked', max(1, $count), home_url('/distribute/')));
        exit;
    }
}

if (!function_exists('sml_dist_meta_base64url_decode')) {
    function sml_dist_meta_base64url_decode($value) {
        $value = strtr((string) $value, '-_', '+/');
        $value .= str_repeat('=', (4 - strlen($value) % 4) % 4);
        return base64_decode($value, true);
    }
}

if (!function_exists('sml_dist_meta_parse_signed_request')) {
    function sml_dist_meta_parse_signed_request($signed_request) {
        $parts = explode('.', (string) $signed_request, 2);
        if (count($parts) !== 2) {
            return new WP_Error('bad_signed_request', 'Invalid signed request.', array('status' => 400));
        }

        $signature = sml_dist_meta_base64url_decode($parts[0]);
        $payload_raw = sml_dist_meta_base64url_decode($parts[1]);
        $payload = json_decode((string) $payload_raw, true);
        if ($signature === false || !is_array($payload)) {
            return new WP_Error('bad_signed_request', 'Invalid signed request.', array('status' => 400));
        }

        $secrets = array_filter(array(sml_dist_meta_app_secret(), sml_dist_threads_app_secret()));
        foreach ($secrets as $secret) {
            $expected = hash_hmac('sha256', $parts[1], $secret, true);
            if (hash_equals($expected, $signature)) {
                return $payload;
            }
        }
        return new WP_Error('bad_signature', 'Invalid signed request signature.', array('status' => 403));
    }
}

if (!function_exists('sml_dist_meta_delete_remote_user')) {
    function sml_dist_meta_delete_remote_user($remote_user_id) {
        global $wpdb;
        $accounts = sml_dist_table('accounts');
        $rows = $wpdb->get_results(
            "SELECT * FROM $accounts WHERE platform IN ('facebook','instagram','threads')",
            ARRAY_A
        );
        $deleted = 0;
        foreach ((array) $rows as $row) {
            $scope = json_decode((string) $row['scopes'], true);
            $auth_id = is_array($scope) ? (string) ($scope['auth_user_id'] ?? '') : '';
            if ((string) $row['remote_id'] !== (string) $remote_user_id && $auth_id !== (string) $remote_user_id) {
                continue;
            }
            sml_dist_secret_delete($row['access_ref']);
            sml_dist_secret_delete($row['refresh_ref']);
            $wpdb->delete(sml_dist_table('rules'), array('account_id' => (int) $row['id']));
            $wpdb->delete($accounts, array('id' => (int) $row['id']));
            $deleted++;
        }
        return $deleted;
    }
}

if (!function_exists('sml_dist_meta_deauthorize')) {
    function sml_dist_meta_deauthorize(WP_REST_Request $request) {
        $payload = sml_dist_meta_parse_signed_request((string) $request->get_param('signed_request'));
        if (is_wp_error($payload)) {
            return $payload;
        }
        $remote_id = sanitize_text_field((string) ($payload['user_id'] ?? ''));
        if ($remote_id !== '') {
            sml_dist_meta_delete_remote_user($remote_id);
        }
        return array('ok' => true);
    }
}

if (!function_exists('sml_dist_meta_data_deletion')) {
    function sml_dist_meta_data_deletion(WP_REST_Request $request) {
        $payload = sml_dist_meta_parse_signed_request((string) $request->get_param('signed_request'));
        if (is_wp_error($payload)) {
            return $payload;
        }
        $remote_id = sanitize_text_field((string) ($payload['user_id'] ?? ''));
        if ($remote_id === '') {
            return new WP_Error('missing_user', 'The deletion request did not include a user.', array('status' => 400));
        }

        sml_dist_meta_delete_remote_user($remote_id);
        try {
            $code = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
        } catch (Exception $e) {
            return new WP_Error('confirmation', 'Could not create a confirmation code.', array('status' => 500));
        }
        set_transient('sml_dist_delete_' . $code, array('completed_at' => time()), 7 * DAY_IN_SECONDS);

        return array(
            'url' => rest_url('sml-dist/v1/meta/data-deletion/status/' . rawurlencode($code)),
            'confirmation_code' => $code,
        );
    }
}

if (!function_exists('sml_dist_meta_data_deletion_status')) {
    function sml_dist_meta_data_deletion_status(WP_REST_Request $request) {
        $code = (string) $request->get_param('code');
        $status = get_transient('sml_dist_delete_' . $code);
        if (!$status) {
            return new WP_Error('not_found', 'Deletion confirmation not found or expired.', array('status' => 404));
        }
        return array(
            'status' => 'complete',
            'confirmation_code' => $code,
            'completed_at' => gmdate('c', (int) $status['completed_at']),
        );
    }
}
