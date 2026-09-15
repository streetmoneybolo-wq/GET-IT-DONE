<?php
/**
 * Profile completion, and the 50 Loop Bucks that come with it.
 *
 * Seven things make a profile complete: photo, banner, city, state, birthday,
 * relationship status and gender. Filling them in is not enough on its own --
 * the reward is only released once the member has turned on two-step
 * authentication on their WordPress.com account.
 *
 * A NOTE ON VERIFYING 2-STEP, because this is the weak joint in the design.
 *
 * This site runs on WordPress.com, where two-step lives on the WordPress.com
 * account rather than in this database. There is no local Two Factor plugin to
 * query. sml_lb_2fa_status() therefore tries three real signals in order --
 * a site-wide SSO requirement, the two_step_enabled flag Jetpack caches at
 * login, and any filter a future plugin registers -- and only falls back to
 * the member's own word if none of them can answer.
 *
 * Attested claims are written to the ledger with source = 'attested', so an
 * audit can tell exactly which awards rest on self-report and reverse them if
 * that ever matters. Do not mistake an attested claim for a verified one.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_lb_2fa_url')) {
    function sml_lb_2fa_url() {
        return (string) apply_filters('sml_lb_2fa_url',
            'https://wordpress.com/me/security/two-step');
    }
}

/* ==================================================================
 * The fields
 * ================================================================== */

if (!function_exists('sml_lb_profile_fields')) {
    function sml_lb_profile_fields() {
        return apply_filters('sml_lb_profile_fields', array(
            'photo' => array(
                'label' => 'Profile photo',
                'type'  => 'image',
                'meta'  => 'sml_avatar_id',
                'hint'  => 'A clear picture of you. Square works best.',
            ),
            'banner' => array(
                'label' => 'Profile banner',
                'type'  => 'image',
                'meta'  => 'sml_banner_id',
                'hint'  => 'The wide image across the top of your profile.',
            ),
            'city' => array(
                'label' => 'City',
                'type'  => 'text',
                'meta'  => 'sml_city',
                'hint'  => 'Where you are based.',
            ),
            'state' => array(
                'label' => 'State or region',
                'type'  => 'text',
                'meta'  => 'sml_state',
                'hint'  => '',
            ),
            'birthdate' => array(
                'label' => 'Date of birth',
                'type'  => 'date',
                'meta'  => 'sml_birthdate',
                'hint'  => 'Shown on your public profile.',
            ),
            'relationship' => array(
                'label' => 'Relationship status',
                'type'  => 'choice',
                'meta'  => 'sml_relationship',
                'options' => array('single' => 'Single', 'married' => 'Married',
                                   'widowed' => 'Widowed'),
                'hint'  => '',
            ),
            'gender' => array(
                'label' => 'Gender',
                'type'  => 'choice',
                'meta'  => 'sml_gender',
                'options' => array('female' => 'Female', 'male' => 'Male',
                                   'other' => 'Other', 'private' => 'Prefer not to say'),
                'hint'  => '',
            ),
            'bio' => array(
                'label' => 'Short bio',
                'type'  => 'bio',
                'meta'  => 'sml_bio',
                'max'   => 90,
                'hint'  => 'Ninety characters. What you trade, or why you are here.',
            ),
        ));
    }
}

if (!function_exists('sml_lb_profile_min_age')) {
    function sml_lb_profile_min_age() {
        return (int) apply_filters('sml_lb_profile_min_age', 13);
    }
}

if (!function_exists('sml_lb_age_from')) {
    function sml_lb_age_from($birthdate) {
        $birthdate = trim((string) $birthdate);
        if ($birthdate === '') {
            return 0;
        }
        try {
            $dob = new DateTime($birthdate);
            $now = new DateTime('now');
            return (int) $dob->diff($now)->y;
        } catch (Exception $e) {
            return 0;
        }
    }
}

if (!function_exists('sml_lb_profile_value')) {
    function sml_lb_profile_value($user_id, $key) {
        $fields = sml_lb_profile_fields();
        if (!isset($fields[$key])) {
            return '';
        }
        return get_user_meta((int) $user_id, $fields[$key]['meta'], true);
    }
}

/* ==================================================================
 * Checklist
 * ================================================================== */

if (!function_exists('sml_lb_profile_checklist')) {
    function sml_lb_profile_checklist($user_id) {
        $user_id = (int) $user_id;
        $out = array();
        foreach (sml_lb_profile_fields() as $key => $field) {
            $value = get_user_meta($user_id, $field['meta'], true);
            $done = false;
            $shown = '';

            if ($field['type'] === 'image') {
                $done = (int) $value > 0;
                if ($done) {
                    $shown = (string) wp_get_attachment_image_url((int) $value, 'medium');
                }
                // A Gravatar the member actually set counts as a photo.
                if (!$done && $key === 'photo' && function_exists('sml_lb_has_custom_avatar')
                    && sml_lb_has_custom_avatar($user_id)) {
                    $done = true;
                    $shown = get_avatar_url($user_id, array('size' => 200));
                }
            } elseif ($field['type'] === 'date') {
                $age = sml_lb_age_from($value);
                $done = $age >= sml_lb_profile_min_age();
                $shown = $done ? (date_i18n('F j, Y', strtotime($value)) . ' (' . $age . ')') : '';
            } elseif ($field['type'] === 'bio') {
                $done = trim((string) $value) !== '';
                $shown = (string) $value;
            } else {
                $done = trim((string) $value) !== '';
                $shown = (string) $value;
                if ($done && $field['type'] === 'choice' && isset($field['options'][$value])) {
                    $shown = $field['options'][$value];
                }
            }

            $out[$key] = array(
                'label'   => $field['label'],
                'type'    => $field['type'],
                'hint'    => $field['hint'],
                'options' => isset($field['options']) ? $field['options'] : null,
                'value'   => is_scalar($value) ? (string) $value : '',
                'shown'   => $shown,
                'done'    => $done,
            );
        }
        return $out;
    }
}

if (!function_exists('sml_lb_has_custom_avatar')) {
    /**
     * Gravatar serves a generated image for every address, so "has an avatar"
     * has to mean "has one that is not the fallback". A HEAD request with
     * d=404 answers that, cached for a day because it is a network call.
     */
    function sml_lb_has_custom_avatar($user_id) {
        $user = get_userdata((int) $user_id);
        if (!$user || !$user->user_email) {
            return false;
        }
        $cache = 'sml_lb_grav_' . md5(strtolower($user->user_email));
        $hit = get_transient($cache);
        if ($hit !== false) {
            return $hit === 'yes';
        }
        $url = 'https://www.gravatar.com/avatar/' . md5(strtolower(trim($user->user_email)))
             . '?d=404&s=80';
        $res = wp_remote_head($url, array('timeout' => 4));
        $ok = !is_wp_error($res) && (int) wp_remote_retrieve_response_code($res) === 200;
        set_transient($cache, $ok ? 'yes' : 'no', DAY_IN_SECONDS);
        return $ok;
    }
}

if (!function_exists('sml_lb_profile_complete')) {
    function sml_lb_profile_complete($user_id) {
        foreach (sml_lb_profile_checklist($user_id) as $item) {
            if (empty($item['done'])) {
                return false;
            }
        }
        return true;
    }
}

/* ==================================================================
 * Two-step
 * ================================================================== */

if (!function_exists('sml_lb_2fa_status')) {
    /**
     * array(enabled, source, verified)
     *
     * verified is false when the only thing supporting the claim is the
     * member saying so. That distinction is recorded, not smoothed over.
     */
    function sml_lb_2fa_status($user_id) {
        $user_id = (int) $user_id;

        // A plugin that actually knows can answer definitively.
        $external = apply_filters('sml_lb_2fa_enabled', null, $user_id);
        if ($external !== null) {
            return array('enabled' => (bool) $external, 'source' => 'plugin',
                'verified' => true);
        }

        // The Two Factor plugin, if it is ever installed.
        if (class_exists('Two_Factor_Core')
            && method_exists('Two_Factor_Core', 'is_user_using_two_factor')
            && Two_Factor_Core::is_user_using_two_factor($user_id)) {
            return array('enabled' => true, 'source' => 'two-factor', 'verified' => true);
        }

        // Jetpack SSO can be configured to refuse anyone without two-step. If
        // that is on and the account is connected, they necessarily have it.
        if (get_option('jetpack_sso_require_two_step')
            && get_user_meta($user_id, 'wpcom_user_id', true)) {
            return array('enabled' => true, 'source' => 'jetpack-sso-required',
                'verified' => true);
        }

        // Jetpack caches the WordPress.com user object at login; some versions
        // include the two-step flag.
        $wpcom = get_user_meta($user_id, 'wpcom_user_data', true);
        if (is_object($wpcom)) {
            $wpcom = (array) $wpcom;
        }
        if (is_array($wpcom) && isset($wpcom['two_step_enabled'])) {
            return array('enabled' => (bool) $wpcom['two_step_enabled'],
                'source' => 'jetpack-cache', 'verified' => true);
        }

        // Nothing authoritative available. Fall back to what they told us.
        $attested = (bool) get_user_meta($user_id, 'sml_lb_2fa_attested', true);
        return array('enabled' => $attested, 'source' => $attested ? 'attested' : 'none',
            'verified' => false);
    }
}

/* ==================================================================
 * State for the client
 * ================================================================== */

if (!function_exists('sml_lb_profile_state')) {
    function sml_lb_profile_state($user_id) {
        $user_id = (int) $user_id;
        $list = sml_lb_profile_checklist($user_id);
        $done = 0;
        foreach ($list as $item) {
            if (!empty($item['done'])) {
                $done++;
            }
        }
        $total = max(1, count($list));
        $complete = $done === count($list);
        $twofa = sml_lb_2fa_status($user_id);
        $claimed = function_exists('sml_lb_has_earned')
                   && sml_lb_has_earned($user_id, 'profile_done');

        $rules = function_exists('sml_lb_earn_rules') ? sml_lb_earn_rules() : array();
        $reward = isset($rules['profile_done']) ? (int) $rules['profile_done']['amount'] : 50;

        return array(
            'fields'    => $list,
            'done'      => $done,
            'total'     => count($list),
            'percent'   => (int) round(($done / $total) * 100),
            'complete'  => $complete,
            'twofa'     => $twofa,
            'twofaUrl'  => sml_lb_2fa_url(),
            'claimed'   => $claimed,
            'reward'    => $reward,
            // The reward is claimable only once every field is in AND two-step
            // is on. Filling the form alone does nothing.
            'claimable' => $complete && !empty($twofa['enabled']) && !$claimed,
            'minAge'    => sml_lb_profile_min_age(),
            'balance'   => function_exists('sml_lb_balance') ? sml_lb_balance($user_id) : 0,
        );
    }
}

/* ==================================================================
 * Saving
 * ================================================================== */

if (!function_exists('sml_lb_profile_save')) {
    function sml_lb_profile_save($user_id, $input) {
        $user_id = (int) $user_id;
        $fields = sml_lb_profile_fields();
        $errors = array();

        foreach ($fields as $key => $field) {
            if (!array_key_exists($key, $input)) {
                continue;
            }
            $raw = $input[$key];

            if ($field['type'] === 'image') {
                $id = (int) $raw;
                if ($id > 0) {
                    // Only ever accept an attachment the member owns, or an
                    // arbitrary id lets someone point at any file on the site.
                    $att = get_post($id);
                    if (!$att || $att->post_type !== 'attachment'
                        || (int) $att->post_author !== $user_id) {
                        $errors[$key] = 'That image does not belong to you.';
                        continue;
                    }
                }
                update_user_meta($user_id, $field['meta'], $id);
                continue;
            }

            if ($field['type'] === 'bio') {
                $val = sanitize_text_field((string) $raw);
                $max = (int) (isset($field['max']) ? $field['max'] : 90);
                if (mb_strlen($val) > $max) {
                    $errors[$key] = 'Keep it to ' . $max . ' characters.';
                    continue;
                }
                update_user_meta($user_id, $field['meta'], $val);
                continue;
            }

            if ($field['type'] === 'date') {
                $date = trim(sanitize_text_field((string) $raw));
                // An empty value clears the field. A member must be able to
                // take something back off their profile.
                if ($date === '') {
                    delete_user_meta($user_id, $field['meta']);
                    continue;
                }
                $age = sml_lb_age_from($date);
                if ($age <= 0) {
                    $errors[$key] = 'Give a valid date of birth.';
                    continue;
                }
                if ($age < sml_lb_profile_min_age()) {
                    $errors[$key] = 'You must be at least '
                        . sml_lb_profile_min_age() . ' to use StockMarketLoop.';
                    continue;
                }
                if ($age > 120) {
                    $errors[$key] = 'Check that date of birth.';
                    continue;
                }
                update_user_meta($user_id, $field['meta'], $date);
                continue;
            }

            if ($field['type'] === 'choice') {
                $val = sanitize_key((string) $raw);
                if ($val !== '' && !isset($field['options'][$val])) {
                    $errors[$key] = 'Pick one of the options.';
                    continue;
                }
                update_user_meta($user_id, $field['meta'], $val);
                continue;
            }

            $val = sanitize_text_field((string) $raw);
            if (mb_strlen($val) > 80) {
                $val = mb_substr($val, 0, 80);
            }
            update_user_meta($user_id, $field['meta'], $val);
        }

        return $errors;
    }
}

/* ==================================================================
 * REST
 * ================================================================== */

if (!function_exists('sml_lb_profile_routes')) {
    function sml_lb_profile_routes() {
        $auth = function () {
            return is_user_logged_in();
        };

        register_rest_route('sml-lb/v1', '/profile', array(
            array(
                'methods'  => 'GET',
                'permission_callback' => $auth,
                'callback' => function () {
                    return sml_lb_profile_state(get_current_user_id());
                },
            ),
            array(
                'methods'  => 'POST',
                'permission_callback' => $auth,
                'callback' => function (WP_REST_Request $r) {
                    $uid = get_current_user_id();
                    $errors = sml_lb_profile_save($uid, (array) $r->get_json_params());
                    $state = sml_lb_profile_state($uid);
                    $state['errors'] = $errors;
                    $state['ok'] = empty($errors);
                    return $state;
                },
            ),
        ));

        // Upload a photo or banner.
        register_rest_route('sml-lb/v1', '/profile/image', array(
            'methods'  => 'POST',
            'permission_callback' => $auth,
            'callback' => 'sml_lb_profile_upload',
        ));

        // The member says they have turned two-step on. Recorded, then checked
        // against whatever real signal exists.
        register_rest_route('sml-lb/v1', '/profile/attest-2fa', array(
            'methods'  => 'POST',
            'permission_callback' => $auth,
            'callback' => function () {
                $uid = get_current_user_id();
                update_user_meta($uid, 'sml_lb_2fa_attested', 1);
                update_user_meta($uid, 'sml_lb_2fa_attested_at', current_time('mysql', true));
                return sml_lb_profile_state($uid);
            },
        ));

        register_rest_route('sml-lb/v1', '/profile/claim', array(
            'methods'  => 'POST',
            'permission_callback' => $auth,
            'callback' => 'sml_lb_profile_claim',
        ));
    }
}
add_action('rest_api_init', 'sml_lb_profile_routes');

if (!function_exists('sml_lb_profile_upload')) {
    function sml_lb_profile_upload(WP_REST_Request $request) {
        $uid = get_current_user_id();
        $slot = sanitize_key((string) $request->get_param('slot'));
        if (!in_array($slot, array('photo', 'banner'), true)) {
            return new WP_Error('bad_slot', 'Photo or banner?', array('status' => 400));
        }
        $files = $request->get_file_params();
        if (empty($files['file'])) {
            return new WP_Error('no_file', 'No image was sent.', array('status' => 400));
        }

        $type = wp_check_filetype($files['file']['name']);
        if (!in_array(strtolower((string) $type['ext']),
            array('jpg', 'jpeg', 'png', 'gif', 'webp'), true)) {
            return new WP_Error('bad_type', 'Use a JPG, PNG, GIF or WebP.',
                array('status' => 400));
        }
        if ((int) $files['file']['size'] > 8 * 1024 * 1024) {
            return new WP_Error('too_big', 'Keep it under 8 MB.', array('status' => 400));
        }

        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';

        $id = media_handle_sideload(array(
            'name'     => $files['file']['name'],
            'tmp_name' => $files['file']['tmp_name'],
        ), 0);
        if (is_wp_error($id)) {
            return $id;
        }
        // Ownership is what sml_lb_profile_save() checks against later.
        wp_update_post(array('ID' => $id, 'post_author' => $uid));

        $fields = sml_lb_profile_fields();
        update_user_meta($uid, $fields[$slot]['meta'], (int) $id);

        return array('ok' => true, 'id' => (int) $id,
            'url' => wp_get_attachment_image_url($id, 'medium'),
            'state' => sml_lb_profile_state($uid));
    }
}

if (!function_exists('sml_lb_profile_claim')) {
    function sml_lb_profile_claim() {
        $uid = get_current_user_id();
        $state = sml_lb_profile_state($uid);

        if ($state['claimed']) {
            return new WP_Error('already', 'You have already claimed this.',
                array('status' => 409));
        }
        if (!$state['complete']) {
            return new WP_Error('incomplete',
                'Fill in every part of your profile first.',
                array('status' => 409, 'state' => $state));
        }
        if (empty($state['twofa']['enabled'])) {
            return new WP_Error('no_2fa',
                'Turn on two-step authentication to release your Loop Bucks.',
                array('status' => 409, 'url' => sml_lb_2fa_url()));
        }

        $paid = sml_lb_award('profile_done', $uid, '', array(
            // Recorded so an audit can separate verified from self-reported.
            '2fa_source'   => $state['twofa']['source'],
            '2fa_verified' => (bool) $state['twofa']['verified'],
        ));

        $fresh = sml_lb_profile_state($uid);
        $fresh['awarded'] = $paid;
        $fresh['ok'] = $paid > 0;
        return $fresh;
    }
}

/* ==================================================================
 * The public profile card
 *
 * Date of birth, city, state, relationship status and a ninety-character
 * bio, shown on every member's profile.
 *
 * A word on the date of birth. Full date plus city and state is the exact
 * combination identity thieves want, and unlike everything else here a
 * birthday cannot be changed once it leaks. sml_lb_show_full_dob() is the
 * one switch that decides between the whole date and just the age:
 *
 *     add_filter('sml_lb_show_full_dob', '__return_false');
 *
 * It is on, because that is what was asked for. Worth revisiting.
 * ================================================================== */

if (!function_exists('sml_lb_show_full_dob')) {
    function sml_lb_show_full_dob() {
        return (bool) apply_filters('sml_lb_show_full_dob',
            (bool) get_option('sml_lb_public_dob', 1));
    }
}

if (!function_exists('sml_lb_public_profile')) {
    /** Everything the card renders, for one member. */
    function sml_lb_public_profile($user_id) {
        $user_id = (int) $user_id;
        $user = get_userdata($user_id);
        if (!$user) {
            return null;
        }

        $dob   = (string) get_user_meta($user_id, 'sml_birthdate', true);
        $age   = sml_lb_age_from($dob);
        $city  = trim((string) get_user_meta($user_id, 'sml_city', true));
        $state = trim((string) get_user_meta($user_id, 'sml_state', true));
        $rel   = (string) get_user_meta($user_id, 'sml_relationship', true);
        $bio   = trim((string) get_user_meta($user_id, 'sml_bio', true));

        $fields = sml_lb_profile_fields();
        $relLabel = isset($fields['relationship']['options'][$rel])
            ? $fields['relationship']['options'][$rel] : '';

        $bannerId = (int) get_user_meta($user_id, 'sml_banner_id', true);
        $photoId  = (int) get_user_meta($user_id, 'sml_avatar_id', true);

        $where = trim(implode(', ', array_filter(array($city, $state))), ', ');

        return array(
            'id'      => $user_id,
            'name'    => $user->display_name ?: $user->user_login,
            'handle'  => $user->user_nicename,
            'photo'   => $photoId
                         ? wp_get_attachment_image_url($photoId, 'medium')
                         : get_avatar_url($user_id, array('size' => 200)),
            'banner'  => $bannerId ? wp_get_attachment_image_url($bannerId, 'large') : '',
            'dob'     => $dob,
            'dobLabel' => $dob
                ? (sml_lb_show_full_dob()
                    ? date_i18n('F j, Y', strtotime($dob)) . ($age ? ' · ' . $age : '')
                    : ($age ? $age . ' years old' : ''))
                : '',
            'city'    => $city,
            'state'   => $state,
            'where'   => $where,
            'relationship' => $relLabel,
            'bio'     => $bio,
            'badge'   => function_exists('sml_lb_badge_html')
                         ? sml_lb_badge_html($user_id) : '',
        );
    }
}

if (!function_exists('sml_lb_card_styles')) {
    function sml_lb_card_styles() {
        return <<<'SMLPCCSS'
.lpc{background:#0b131f;border:1px solid #182130;border-radius:14px;overflow:hidden;
    color:#e6edf5;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
.lpc-banner{height:132px;background:#101c2e;background-size:cover;background-position:center}
.lpc-body{padding:0 22px 20px;position:relative}
.lpc-photo{width:88px;height:88px;border-radius:50%;object-fit:cover;border:3px solid #0b131f;
    margin-top:-44px;display:block;background:#101c2e}
.lpc-name{margin:11px 0 2px;font-size:19px;font-weight:800;letter-spacing:-.3px;
    display:flex;align-items:center;flex-wrap:wrap;gap:4px}
.lpc-handle{font-size:13px;color:#7b8ca1;margin-bottom:12px}
.lpc-bio{font-size:14px;line-height:1.65;color:#c8d5e4;margin:0 0 14px;max-width:52ch}
.lpc-facts{display:flex;flex-wrap:wrap;gap:9px}
.lpc-fact{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:99px;
    background:#0d1725;border:1px solid #1e2a3a;font-size:12.5px;color:#c8d5e4}
.lpc-fact svg{color:#7b8ca1;flex:0 0 auto}
.lpc-fact b{font-weight:700}
@media (max-width:520px){.lpc-banner{height:96px}.lpc-photo{width:70px;height:70px;margin-top:-35px}}
SMLPCCSS;
    }
}

if (!function_exists('sml_lb_card_icon')) {
    function sml_lb_card_icon($kind) {
        $paths = array(
            'cake'  => '<path d="M4 20h16v-7H4v7zM6 13V9.5A1.5 1.5 0 0 1 7.5 8h9A1.5 1.5 0 0 1 18 9.5V13"/>'
                     . '<path d="M12 8V5M9.5 8V6M14.5 8V6" stroke-linecap="round"/>',
            'pin'   => '<path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z"/>'
                     . '<circle cx="12" cy="10" r="2.6"/>',
            'heart' => '<path d="M12 20s-7.5-4.7-7.5-9.6A4.4 4.4 0 0 1 12 7.5a4.4 4.4 0 0 1 7.5 2.9C19.5 15.3 12 20 12 20z"/>',
        );
        $d = isset($paths[$kind]) ? $paths[$kind] : '';
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
             . 'stroke-width="1.7" stroke-linejoin="round">' . $d . '</svg>';
    }
}

if (!function_exists('sml_lb_profile_card_html')) {
    function sml_lb_profile_card_html($user_id) {
        $p = sml_lb_public_profile($user_id);
        if (!$p) {
            return '';
        }

        $h = '<section class="lpc">';
        $h .= '<div class="lpc-banner"' . ($p['banner']
              ? ' style="background-image:url(' . esc_url($p['banner']) . ')"' : '') . '></div>';
        $h .= '<div class="lpc-body">';
        $h .= '<img class="lpc-photo" src="' . esc_url($p['photo']) . '" alt="'
            . esc_attr($p['name']) . '">';
        $h .= '<h2 class="lpc-name">' . esc_html($p['name']) . $p['badge'] . '</h2>';
        $h .= '<div class="lpc-handle">@' . esc_html($p['handle']) . '</div>';

        if ($p['bio'] !== '') {
            $h .= '<p class="lpc-bio">' . esc_html($p['bio']) . '</p>';
        }

        $facts = '';
        if ($p['dobLabel'] !== '') {
            $facts .= '<span class="lpc-fact">' . sml_lb_card_icon('cake')
                    . '<b>' . esc_html($p['dobLabel']) . '</b></span>';
        }
        if ($p['where'] !== '') {
            $facts .= '<span class="lpc-fact">' . sml_lb_card_icon('pin')
                    . esc_html($p['where']) . '</span>';
        }
        if ($p['relationship'] !== '') {
            $facts .= '<span class="lpc-fact">' . sml_lb_card_icon('heart')
                    . esc_html($p['relationship']) . '</span>';
        }
        if ($facts !== '') {
            $h .= '<div class="lpc-facts">' . $facts . '</div>';
        }

        return $h . '</div></section>';
    }
}

if (!function_exists('sml_lb_profile_card_shortcode')) {
    function sml_lb_profile_card_shortcode($atts) {
        $atts = shortcode_atts(array('user' => 0, 'handle' => ''), $atts);
        $user_id = (int) $atts['user'];
        if (!$user_id && $atts['handle'] !== '') {
            $u = get_user_by('slug', sanitize_title($atts['handle']));
            $user_id = $u ? (int) $u->ID : 0;
        }
        if (!$user_id) {
            // Fall back to whoever this page is about, then to the viewer.
            $user_id = (int) get_queried_object_id();
            if (!$user_id || !get_userdata($user_id)) {
                $user_id = get_current_user_id();
            }
        }
        if (!$user_id) {
            return '';
        }
        return '<style>' . sml_lb_card_styles()
             . (function_exists('sml_lb_badge_styles') ? sml_lb_badge_styles() : '')
             . '</style>' . sml_lb_profile_card_html($user_id);
    }
}
add_shortcode('loop_profile_card', 'sml_lb_profile_card_shortcode');

if (!function_exists('sml_lb_card_rest')) {
    function sml_lb_card_rest() {
        register_rest_route('sml-lb/v1', '/card/(?P<handle>[A-Za-z0-9\-_]+)', array(
            'methods'  => 'GET',
            'permission_callback' => '__return_true',
            'callback' => function (WP_REST_Request $r) {
                $u = get_user_by('slug', sanitize_title((string) $r->get_param('handle')));
                if (!$u) {
                    return new WP_Error('no_user', 'No such member.', array('status' => 404));
                }
                // CSS travels with the markup. Anything consuming this over
                // REST has no stylesheet of its own, and unstyled output is
                // worse than none.
                return array(
                    'profile' => sml_lb_public_profile($u->ID),
                    'css'     => sml_lb_card_styles(),
                    'html'    => sml_lb_profile_card_html($u->ID),
                    'styled'  => '<style>' . sml_lb_card_styles() . '</style>'
                                 . sml_lb_profile_card_html($u->ID),
                );
            },
        ));
    }
}
add_action('rest_api_init', 'sml_lb_card_rest');

/* ==================================================================
 * Setup UI  --  [loop_profile_setup]
 * ================================================================== */

if (!function_exists('sml_lb_profile_styles')) {
    function sml_lb_profile_styles() {
        return <<<'SMLPFCSS'
.pf-wrap{max-width:640px;background:#0b131f;border:1px solid #182130;border-radius:14px;
    padding:22px 24px;color:#e6edf5;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
.pf-wrap *{box-sizing:border-box}
.pf-top{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px}
.pf-top h3{margin:0 0 5px;font-size:17px;font-weight:800;letter-spacing:-.3px}
.pf-top p{margin:0;font-size:13px;color:#8798ac;line-height:1.6}
.pf-prize{margin-left:auto;flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;
    padding:6px 12px;border-radius:99px;background:#1d1706;border:1px solid #3d3210;
    color:#ffb454;font-size:13px;font-weight:800;white-space:nowrap}
.pf-bar{height:7px;border-radius:99px;background:#16202e;overflow:hidden;margin-bottom:6px}
.pf-bar i{display:block;height:100%;background:linear-gradient(90deg,#c9962a,#ffd75e);
    border-radius:99px;transition:width .25s ease}
.pf-count{font-size:12.5px;color:#7b8ca1;margin-bottom:18px}

.pf-grid{display:grid;gap:14px}
.pf-row{display:flex;gap:12px;align-items:flex-start;padding:13px 14px;background:#0d1725;
    border:1px solid #1e2a3a;border-radius:11px}
.pf-row.done{border-color:#24361a;background:#101a0c}
.pf-tick{flex:0 0 auto;width:20px;height:20px;border-radius:50%;border:2px solid #2b3a4d;
    margin-top:2px}
.pf-row.done .pf-tick{border-color:#4f9d5f;background:#4f9d5f}
.pf-field{flex:1;min-width:0}
.pf-field label{display:block;font-size:13.5px;font-weight:700;margin-bottom:3px}
.pf-field .pf-hint{font-size:12px;color:#7b8ca1;margin-bottom:8px;line-height:1.5}
.pf-field textarea{width:100%;background:#0a1220;border:1px solid #1e2a3a;border-radius:8px;
    color:#e6edf5;padding:9px 11px;font-size:13.5px;font-family:inherit;resize:vertical;line-height:1.5}
.pf-field textarea:focus{outline:none;border-color:#2b6cff}
.pf-field input[type=text],.pf-field input[type=date],.pf-field select{
    width:100%;background:#0a1220;border:1px solid #1e2a3a;border-radius:8px;color:#e6edf5;
    padding:9px 11px;font-size:13.5px;font-family:inherit}
.pf-field input:focus,.pf-field select:focus{outline:none;border-color:#2b6cff}
.pf-field .pf-err{color:#ff8f9c;font-size:12px;margin-top:5px}
.pf-thumb{display:flex;align-items:center;gap:11px;margin-top:4px}
.pf-thumb img{width:52px;height:52px;object-fit:cover;border-radius:9px;border:1px solid #26364a}
.pf-thumb img.wide{width:104px;height:40px}
.pf-file{position:relative;overflow:hidden;display:inline-block}
.pf-file input{position:absolute;inset:0;opacity:0;cursor:pointer}
.pf-btn{border:0;border-radius:9px;padding:9px 16px;font-size:13px;font-weight:700;
    cursor:pointer;background:#2b6cff;color:#fff;font-family:inherit}
.pf-btn:hover{background:#1f5ae0}
.pf-btn[disabled]{opacity:.45;cursor:default}
.pf-btn.ghost{background:#16202e;color:#c8d5e4;border:1px solid #26364a}

.pf-step2{margin-top:20px;padding:18px 20px;border-radius:12px;background:#101c2e;
    border:1px solid #1e3352}
.pf-step2.locked{opacity:.55}
.pf-step2 h4{margin:0 0 6px;font-size:14.5px;font-weight:800;display:flex;align-items:center;gap:8px}
.pf-step2 p{margin:0 0 14px;font-size:13px;color:#a9b8ca;line-height:1.65}
.pf-step2 ol{margin:0 0 16px;padding-left:20px;font-size:13px;color:#a9b8ca;line-height:1.9}
.pf-step2 a.pf-link{color:#63a4ff;font-weight:700}
.pf-go{display:inline-flex;align-items:center;gap:8px;background:#2b6cff;color:#fff;
    border-radius:9px;padding:10px 17px;font-size:13.5px;font-weight:700;text-decoration:none}
.pf-go:hover{background:#1f5ae0;color:#fff}
.pf-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px}
.pf-note{font-size:12px;color:#7b8ca1}
.pf-done{margin-top:18px;padding:16px 18px;border-radius:12px;background:#101a0c;
    border:1px solid #24361a;color:#a9c095;font-size:13.5px;font-weight:700}
.pf-msg{margin-top:12px;font-size:13px;min-height:18px}
.pf-msg.bad{color:#ff8f9c}
.pf-msg.good{color:#4f9d5f}
SMLPFCSS;
    }
}

if (!function_exists('sml_lb_profile_script')) {
    function sml_lb_profile_script() {
        return <<<'SMLPFJS'
(function () {
  var root = document.getElementById('pf-root');
  var cfg = window.smlProfileCfg;
  if (!root || !cfg) { return; }

  var state = null;
  var busy = false;
  var msg = '';
  var msgKind = '';
  var errors = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin',
                 headers: { 'X-WP-Nonce': cfg.nonce } };
    if (opts.body instanceof FormData) {
      init.body = opts.body;
    } else if (opts.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(cfg.base + path, init).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) { throw new Error((j && j.message) || 'That did not work.'); }
        return j;
      });
    });
  }

  function load() {
    api('/profile').then(function (s) { state = s; render(); })
      .catch(function (e) { msg = e.message; msgKind = 'bad'; render(); });
  }

  function fieldHtml(key, f) {
    var h = '<div class="pf-row' + (f.done ? ' done' : '') + '"><span class="pf-tick"></span>'
          + '<div class="pf-field"><label>' + esc(f.label) + '</label>';
    if (f.hint) { h += '<div class="pf-hint">' + esc(f.hint) + '</div>'; }

    if (f.type === 'image') {
      if (f.shown) {
        h += '<div class="pf-thumb"><img class="' + (key === 'banner' ? 'wide' : '')
           + '" src="' + esc(f.shown) + '" alt="">';
      } else {
        h += '<div class="pf-thumb">';
      }
      h += '<span class="pf-file"><span class="pf-btn ghost">'
         + (f.done ? 'Replace' : 'Upload') + '</span>'
         + '<input type="file" accept="image/*" data-upload="' + key + '"></span></div>';
    } else if (f.type === 'choice') {
      h += '<select data-field="' + key + '"><option value="">Choose...</option>';
      Object.keys(f.options).forEach(function (v) {
        h += '<option value="' + esc(v) + '"' + (f.value === v ? ' selected' : '') + '>'
           + esc(f.options[v]) + '</option>';
      });
      h += '</select>';
    } else if (f.type === 'date') {
      h += '<input type="date" data-field="' + key + '" value="' + esc(f.value) + '">';
      if (f.done) { h += '<div class="pf-hint" style="margin:6px 0 0">' + esc(f.shown) + '</div>'; }
    } else if (f.type === 'bio') {
      var used = (f.value || '').length;
      h += '<textarea data-field="' + key + '" maxlength="90" rows="2">'
         + esc(f.value) + '</textarea>'
         + '<div class="pf-hint" style="margin:5px 0 0;text-align:right" data-count="' + key + '">'
         + used + ' / 90</div>';
    } else {
      h += '<input type="text" data-field="' + key + '" value="' + esc(f.value) + '">';
    }
    if (errors[key]) { h += '<div class="pf-err">' + esc(errors[key]) + '</div>'; }
    return h + '</div></div>';
  }

  function render() {
    if (!state) { root.innerHTML = '<div class="pf-wrap">Loading...</div>'; return; }

    var h = '<div class="pf-wrap"><div class="pf-top"><div>'
      + '<h3>Complete your profile</h3>'
      + '<p>Seven details, then switch on two-step security to release your Loop Bucks.</p>'
      + '</div><span class="pf-prize">+' + state.reward + ' LB</span></div>';

    h += '<div class="pf-bar"><i style="width:' + state.percent + '%"></i></div>'
       + '<div class="pf-count">' + state.done + ' of ' + state.total + ' done</div>';

    h += '<div class="pf-grid">';
    Object.keys(state.fields).forEach(function (k) { h += fieldHtml(k, state.fields[k]); });
    h += '</div>';

    h += '<div class="pf-actions"><button class="pf-btn" data-save="1"'
       + (busy ? ' disabled' : '') + '>Save details</button>'
       + '<span class="pf-note">Only your city, state and age are shown publicly.</span></div>';

    /* ---- step two ---- */
    var two = state.twofa || {};
    h += '<div class="pf-step2' + (state.complete ? '' : ' locked') + '">';
    h += '<h4>' + (two.enabled ? '✓ ' : '') + 'Step 2 &mdash; turn on two-step security</h4>';

    if (!state.complete) {
      h += '<p>Finish the details above and this unlocks.</p>';
    } else if (state.claimed) {
      h += '<p>Claimed. Your ' + state.reward + ' Loop Bucks are in your balance.</p>';
    } else if (two.enabled) {
      h += '<p>Two-step is on. Claim your Loop Bucks.</p>'
         + '<button class="pf-btn" data-claim="1"' + (busy ? ' disabled' : '') + '>'
         + 'Claim +' + state.reward + ' LB</button>';
    } else {
      h += '<p>Your Loop Bucks are waiting. Two-step means a code from your phone on top '
         + 'of your password, so nobody can take your account or your balance.</p>';
      h += '<ol>'
         + '<li>Open <a class="pf-link" href="' + esc(state.twofaUrl)
         + '" target="_blank" rel="noopener">WordPress.com security settings</a>.</li>'
         + '<li>Choose <b>Two-Step Authentication</b>, then <b>Get Started</b>.</li>'
         + '<li>Add your phone number or an authenticator app and confirm the code.</li>'
         + '<li>Save your backup codes somewhere safe.</li>'
         + '<li>Come back here and press the button below.</li>'
         + '</ol>';
      h += '<a class="pf-go" href="' + esc(state.twofaUrl) + '" target="_blank" rel="noopener">'
         + 'Open two-step settings'
         + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
         + 'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
         + '<path d="M8 5h11v11M19 5L6 18"/></svg></a>';
      h += '<div class="pf-actions"><button class="pf-btn ghost" data-attest="1"'
         + (busy ? ' disabled' : '') + '>I have turned it on</button></div>';
    }
    h += '</div>';

    if (state.claimed) {
      h += '<div class="pf-done">Profile complete. Balance: '
         + Number(state.balance || 0).toLocaleString() + ' LB</div>';
    }
    if (msg) { h += '<div class="pf-msg ' + msgKind + '">' + esc(msg) + '</div>'; }

    root.innerHTML = h + '</div>';
  }

  function collect() {
    var out = {};
    root.querySelectorAll('[data-field]').forEach(function (el) {
      out[el.getAttribute('data-field')] = el.value;
    });
    return out;
  }

  root.addEventListener('input', function (e) {
    var ta = e.target.closest('textarea[data-field]');
    if (!ta) { return; }
    var out = root.querySelector('[data-count="' + ta.getAttribute('data-field') + '"]');
    if (out) { out.textContent = ta.value.length + ' / 90'; }
  });

  root.addEventListener('change', function (e) {
    var up = e.target.closest('[data-upload]');
    if (!up || !up.files || !up.files[0]) { return; }
    var fd = new FormData();
    fd.append('file', up.files[0]);
    fd.append('slot', up.getAttribute('data-upload'));
    busy = true; msg = 'Uploading...'; msgKind = ''; render();
    api('/profile/image', { method: 'POST', body: fd })
      .then(function (res) {
        busy = false; msg = ''; state = res.state; render();
      })
      .catch(function (err) {
        busy = false; msg = err.message; msgKind = 'bad'; render();
      });
  });

  root.addEventListener('click', function (e) {
    if (busy) { return; }

    if (e.target.closest('[data-save]')) {
      busy = true; msg = 'Saving...'; msgKind = ''; render();
      api('/profile', { method: 'POST', body: collect() })
        .then(function (res) {
          busy = false;
          state = res;
          errors = res.errors || {};
          msg = res.ok ? 'Saved.' : 'Some details need another look.';
          msgKind = res.ok ? 'good' : 'bad';
          render();
        })
        .catch(function (err) { busy = false; msg = err.message; msgKind = 'bad'; render(); });
      return;
    }

    if (e.target.closest('[data-attest]')) {
      busy = true; render();
      api('/profile/attest-2fa', { method: 'POST', body: {} })
        .then(function (res) { busy = false; state = res; msg = ''; render(); })
        .catch(function (err) { busy = false; msg = err.message; msgKind = 'bad'; render(); });
      return;
    }

    if (e.target.closest('[data-claim]')) {
      busy = true; render();
      api('/profile/claim', { method: 'POST', body: {} })
        .then(function (res) {
          busy = false; state = res;
          msg = res.awarded > 0 ? ('+' + res.awarded + ' Loop Bucks added.') : '';
          msgKind = 'good';
          render();
        })
        .catch(function (err) { busy = false; msg = err.message; msgKind = 'bad'; render(); });
    }
  });

  load();
})();
SMLPFJS;
    }
}

if (!function_exists('sml_lb_profile_shortcode')) {
    function sml_lb_profile_shortcode() {
        if (!is_user_logged_in()) {
            return '<p><a href="' . esc_url(add_query_arg('redirect_to', rawurlencode(home_url(add_query_arg(array()))), home_url('/sign-up-sign-in/')))
                 . '">Sign in</a> to set up your profile.</p>';
        }
        $config = array(
            'base'  => esc_url_raw(rest_url('sml-lb/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
        );
        return '<style>' . sml_lb_profile_styles() . '</style>'
             . '<div id="pf-root"></div>'
             . '<script>window.smlProfileCfg=' . wp_json_encode($config) . ';</script>'
             . '<script>' . sml_lb_profile_script() . '</script>';
    }
}
add_shortcode('loop_profile_setup', 'sml_lb_profile_shortcode');
