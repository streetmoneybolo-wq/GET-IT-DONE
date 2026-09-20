<?php
/**
 * Plugin Name: Stockmarketloop Members
 * Description: Member signup, email-code verification, customizable profiles, follows, watchlists, notifications, and Stocktwits-style ticker streams for Stockmarketloop.
 * Version: 0.5.13
 * Author: Stockmarketloop
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SML_MEMBERS_VERSION', '0.5.13');
define('SML_MEMBERS_SOCIAL_TITLE', 'Stock Market Loop');
define('SML_MEMBERS_SOCIAL_DESCRIPTION', 'The official #1 social media site for finance');
define('SML_MEMBERS_VERIFY_TTL', 25 * MINUTE_IN_SECONDS);
define('SML_MEMBERS_STREAM_POST_ID', 1929);
define('SML_MEMBERS_STREAM_MARK', 'SMLTICKER|');
define('SML_MEMBERS_MAX_IMAGE_BYTES', 8 * 1024 * 1024);
define('SML_LOOP_CREDIT_CENTS', 1);
define('SML_LOOP_SERVICE_FEE_BPS', 200);

register_activation_hook(__FILE__, 'sml_members_activate');

add_action('init', 'sml_members_register_rewrites');
add_action('init', 'sml_members_maybe_upgrade', 20);
add_action('rest_api_init', 'sml_members_register_rest_routes');
add_action('template_redirect', 'sml_members_profile_template');
add_action('user_register', 'sml_members_on_user_register');
add_action('comment_post', 'sml_members_comment_post_notifications', 10, 3);
add_filter('registration_errors', 'sml_members_registration_errors', 10, 3);
add_filter('authenticate', 'sml_members_block_unverified_login', 30, 3);
add_filter('show_admin_bar', 'sml_members_admin_bar_for_members');
add_action('wp_footer', 'sml_members_trending_ticker_tape', 5);
// LOOP-KICK is the supported messaging surface. Do not inject the retired
// fixed-position legacy Inbox widget into public or member pages.
add_action('wp_footer', 'sml_members_global_profile_widget');
add_action('wp_footer', 'sml_members_activity_heartbeat');
add_action('wp_footer', 'sml_members_loop_bucks_modal');
add_action('wp_footer', 'sml_members_home_news_feed', 6);
add_action('wp_footer', 'sml_members_home_personal_feed', 7);
add_action('wp_footer', 'sml_members_home_trending_posts', 8);
add_action('wp_footer', 'sml_members_home_leaderboard');
add_action('wp_footer', 'sml_members_ticker_search_bridge', 30);
add_action('wp_head', 'sml_members_brand_head', 0);
add_action('wp_head', 'sml_members_social_share_meta', 1);
add_filter('pre_get_document_title', 'sml_members_social_document_title', 99);
add_filter('rank_math/frontend/title', 'sml_members_social_document_title', 99);
add_filter('rank_math/frontend/description', 'sml_members_social_description_filter', 99);
add_filter('rank_math/opengraph/facebook/og_title', 'sml_members_social_title_filter', 99);
add_filter('rank_math/opengraph/facebook/og_description', 'sml_members_social_description_filter', 99);
add_filter('rank_math/opengraph/twitter/title', 'sml_members_social_title_filter', 99);
add_filter('rank_math/opengraph/twitter/description', 'sml_members_social_description_filter', 99);
add_filter('wpseo_title', 'sml_members_social_document_title', 99);
add_filter('wpseo_metadesc', 'sml_members_social_description_filter', 99);
add_filter('wpseo_opengraph_title', 'sml_members_social_title_filter', 99);
add_filter('wpseo_opengraph_desc', 'sml_members_social_description_filter', 99);
add_shortcode('sml_auth_gate', 'sml_members_auth_gate_shortcode');
add_shortcode('sml_profile_widget', 'sml_members_profile_widget_shortcode');
add_shortcode('sml_loop_bucks', 'sml_members_loop_bucks_shortcode');

function sml_members_activate() {
    update_option('users_can_register', 1);
    update_option('sml_members_version', SML_MEMBERS_VERSION);
    sml_members_register_rewrites();
    flush_rewrite_rules();
}

function sml_members_register_rewrites() {
    add_rewrite_rule('^members/([0-9]+)/?$', 'index.php?sml_member_id=$matches[1]', 'top');
    add_rewrite_tag('%sml_member_id%', '([0-9]+)');
}

function sml_members_maybe_upgrade() {
    if (get_option('sml_members_version') === SML_MEMBERS_VERSION) {
        return;
    }

    update_option('users_can_register', 1);
    update_option('sml_members_version', SML_MEMBERS_VERSION);
    flush_rewrite_rules(false);
}

function sml_members_admin_bar_for_members($show) {
    if (current_user_can('edit_posts')) {
        return $show;
    }
    return false;
}

function sml_members_brand_asset_url($file) {
    $file = ltrim((string) $file, '/');
    $media_assets = array(
        'stock-market-loop-logo-horizontal.png' => 'https://stockmarketloop.com/wp-content/uploads/2026/06/stock-market-loop-logo-horizontal.png',
        'stock-market-loop-app-icon.png' => 'https://stockmarketloop.com/wp-content/uploads/2026/06/stock-market-loop-app-icon.png',
        'stock-market-loop-mark.png' => 'https://stockmarketloop.com/wp-content/uploads/2026/06/stock-market-loop-mark.png',
        'stock-market-loop-brand-board.png' => 'https://stockmarketloop.com/wp-content/uploads/2026/06/stock-market-loop-brand-board.png',
    );

    if (isset($media_assets[$file])) {
        return esc_url_raw($media_assets[$file]);
    }

    return esc_url_raw(plugin_dir_url(__FILE__) . 'assets/' . $file);
}

function sml_members_brand_logo_url() {
    return sml_members_brand_asset_url('stock-market-loop-logo-horizontal.png');
}

function sml_members_brand_icon_url() {
    return sml_members_brand_asset_url('stock-market-loop-app-icon.png');
}

function sml_members_brand_mark_url() {
    return sml_members_brand_asset_url('stock-market-loop-mark.png');
}

function sml_members_brand_board_url() {
    return sml_members_brand_asset_url('stock-market-loop-brand-board.png');
}

function sml_members_brand_head() {
    if (is_admin()) {
        return;
    }
    $icon = sml_members_brand_icon_url();
    ?>
    <link rel="icon" href="<?php echo esc_url($icon); ?>" sizes="512x512" type="image/png">
    <link rel="apple-touch-icon" href="<?php echo esc_url($icon); ?>">
    <meta name="theme-color" content="#07110c">
    <?php
}

function sml_members_social_share_applies() {
    if (is_admin()) {
        return false;
    }

    if (is_front_page() || is_home()) {
        return true;
    }

    $path = strtolower((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH));
    return (bool) preg_match('#^/(members/|stock-chart/?|stock-search/?|watchlist/?|retail-trader-spotlight/?|trending/?)#', $path);
}

function sml_members_social_document_title($title) {
    if (!sml_members_social_share_applies()) {
        return $title;
    }
    return SML_MEMBERS_SOCIAL_TITLE . ' - ' . SML_MEMBERS_SOCIAL_DESCRIPTION;
}

function sml_members_social_title_filter($title) {
    return sml_members_social_share_applies() ? SML_MEMBERS_SOCIAL_TITLE : $title;
}

function sml_members_social_description_filter($description) {
    return sml_members_social_share_applies() ? SML_MEMBERS_SOCIAL_DESCRIPTION : $description;
}

function sml_members_social_image_url() {
    return sml_members_brand_board_url();
}

function sml_members_social_share_meta() {
    if (!sml_members_social_share_applies()) {
        return;
    }

    $url = home_url(add_query_arg(array(), (string) ($_SERVER['REQUEST_URI'] ?? '/')));
    $image = sml_members_social_image_url();
    $title = SML_MEMBERS_SOCIAL_TITLE;
    $description = SML_MEMBERS_SOCIAL_DESCRIPTION;
    ?>
    <meta property="og:site_name" content="<?php echo esc_attr($title); ?>">
    <meta property="og:type" content="website">
    <meta property="og:title" content="<?php echo esc_attr($title); ?>">
    <meta property="og:description" content="<?php echo esc_attr($description); ?>">
    <meta property="og:url" content="<?php echo esc_url($url); ?>">
    <meta name="twitter:card" content="<?php echo $image ? 'summary_large_image' : 'summary'; ?>">
    <meta name="twitter:title" content="<?php echo esc_attr($title); ?>">
    <meta name="twitter:description" content="<?php echo esc_attr($description); ?>">
    <?php if ($image) : ?>
    <meta property="og:image" content="<?php echo esc_url($image); ?>">
    <meta name="twitter:image" content="<?php echo esc_url($image); ?>">
    <?php endif; ?>
    <?php
}

function sml_members_password_is_valid($password) {
    return is_string($password)
        && strlen($password) >= 8
        && strlen($password) <= 128
        && preg_match('/[0-9]/', $password)
        && !preg_match('/\s/', $password);
}

function sml_members_password_rule_message() {
    return __('Password must be at least 8 characters, include 1 number, and have no spaces. Symbols like !, @, #, or $ are allowed.', 'stockmarketloop-members');
}

function sml_members_registration_errors($errors, $sanitized_user_login, $user_email) {
    if (isset($_POST['pass1']) && !sml_members_password_is_valid(wp_unslash($_POST['pass1']))) {
        $errors->add(
            'sml_weak_password',
            sml_members_password_rule_message()
        );
    }
    return $errors;
}

function sml_members_on_user_register($user_id) {
    update_user_meta($user_id, 'sml_email_verified', '0');
    sml_members_referral_code($user_id);
    if (!get_user_meta($user_id, 'sml_display_handle', true)) {
        $user = get_userdata($user_id);
        $base = $user && $user->user_login ? $user->user_login : 'member';
        update_user_meta($user_id, 'sml_display_handle', sanitize_text_field($base));
    }
    if (!get_user_meta($user_id, 'sml_public_handle', true)) {
        $user = get_userdata($user_id);
        $base = $user && $user->user_login ? $user->user_login : 'member' . absint($user_id);
        update_user_meta($user_id, 'sml_public_handle', sml_members_clean_public_handle($base));
    }
    if (!empty($GLOBALS['sml_members_skip_auto_verification_email'])) {
        return;
    }
    sml_members_send_verification_code($user_id);
}

function sml_members_make_code() {
    return (string) wp_rand(10000, 99999);
}

function sml_members_send_verification_code($user_id) {
    $user = get_userdata($user_id);
    if (!$user) {
        return false;
    }

    $code = sml_members_make_code();
    update_user_meta($user_id, 'sml_email_code_hash', wp_hash_password($code));
    update_user_meta($user_id, 'sml_email_code_expires', time() + SML_MEMBERS_VERIFY_TTL);

    $subject = 'Your Stockmarketloop verification code';
    $message = "Your Stockmarketloop verification code is: {$code}\n\nThis code expires in 25 minutes.";

    return wp_mail($user->user_email, $subject, $message);
}

function sml_members_verify_code($email, $code, $remember = true) {
    $user = get_user_by('email', sanitize_email($email));
    if (!$user) {
        return new WP_Error('sml_no_user', 'No account was found for that email.', array('status' => 404));
    }

    $expires = (int) get_user_meta($user->ID, 'sml_email_code_expires', true);
    $hash = (string) get_user_meta($user->ID, 'sml_email_code_hash', true);

    if (!$hash || !$expires || time() > $expires) {
        return new WP_Error('sml_code_expired', 'That verification code expired. Request a new code.', array('status' => 400));
    }

    if (!wp_check_password((string) $code, $hash, $user->ID)) {
        return new WP_Error('sml_bad_code', 'That verification code is not correct.', array('status' => 400));
    }

    update_user_meta($user->ID, 'sml_email_verified', '1');
    delete_user_meta($user->ID, 'sml_email_code_hash');
    delete_user_meta($user->ID, 'sml_email_code_expires');
    wp_set_current_user($user->ID);
    wp_set_auth_cookie($user->ID, (bool) $remember);

    return array(
        'verified' => true,
        'logged_in' => true,
        'user_id' => $user->ID,
        'profile_url' => home_url('/members/' . $user->ID . '/'),
    );
}

function sml_members_block_unverified_login($user, $username, $password) {
    if ($user instanceof WP_User && !user_can($user, 'edit_posts') && get_user_meta($user->ID, 'sml_email_verified', true) === '0') {
        return new WP_Error(
            'sml_email_unverified',
            __('You must verify your email before using Stockmarketloop live chat.', 'stockmarketloop-members')
        );
    }
    return $user;
}

function sml_members_register_rest_routes() {
    register_rest_route('sml-members/v1', '/register', array(
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => 'sml_members_rest_register',
    ));

    register_rest_route('sml-members/v1', '/login', array(
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => 'sml_members_rest_login',
    ));

    register_rest_route('sml-members/v1', '/verify', array(
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => 'sml_members_rest_verify',
    ));

    register_rest_route('sml-members/v1', '/resend-code', array(
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => 'sml_members_rest_resend_code',
    ));

    register_rest_route('sml-members/v1', '/profile', array(
        array(
            'methods' => 'GET',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_members_rest_get_profile',
        ),
        array(
            'methods' => 'POST',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_members_rest_update_profile',
        ),
    ));

    register_rest_route('sml-members/v1', '/profile-chart', array(
        array(
            'methods' => 'GET',
            'permission_callback' => '__return_true',
            'callback' => 'sml_members_rest_get_profile_chart',
        ),
        array(
            'methods' => 'POST',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_members_rest_post_profile_chart',
        ),
    ));

    register_rest_route('sml-members/v1', '/profile-chart-like', array(
        'methods' => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_like_profile_chart',
    ));

    register_rest_route('sml-members/v1', '/achievements', array(
        'methods' => 'GET',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_get_achievements',
    ));

    register_rest_route('sml-members/v1', '/profile-image', array(
        'methods' => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_upload_profile_image',
    ));

    register_rest_route('sml-members/v1', '/watchlist', array(
        array(
            'methods' => 'GET',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_members_rest_get_watchlist',
        ),
        array(
            'methods' => 'POST',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_members_rest_update_watchlist',
        ),
    ));

    register_rest_route('sml-members/v1', '/profile-feed', array(
        'methods' => 'GET',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_get_profile_feed',
    ));

    register_rest_route('sml-members/v1', '/news-feed', array(
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => 'sml_members_rest_get_news_feed',
    ));

    register_rest_route('sml-members/v1', '/follow', array(
        'methods' => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_follow',
    ));

    register_rest_route('sml-members/v1', '/notifications', array(
        array(
            'methods' => 'GET',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_members_rest_get_notifications',
        ),
        array(
            'methods' => 'POST',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_members_rest_update_notifications',
        ),
    ));

    register_rest_route('sml-members/v1', '/stream', array(
        array(
            'methods' => 'GET',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_members_rest_get_stream',
        ),
        array(
            'methods' => 'POST',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_members_rest_post_stream',
        ),
    ));

    register_rest_route('sml-members/v1', '/stream-like', array(
        'methods' => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_like_stream_comment',
    ));

    register_rest_route('sml-members/v1', '/post-vote', array(
        'methods' => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_vote_post',
    ));

    register_rest_route('sml-members/v1', '/post-voters', array(
        'methods' => 'GET',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_get_post_voters',
    ));

    register_rest_route('sml-members/v1', '/moomoo-feed', array(
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => 'sml_members_rest_get_moomoo_feed',
    ));

    register_rest_route('sml-members/v1', '/webull-feed', array(
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => 'sml_members_rest_get_webull_feed',
    ));

    register_rest_route('sml-members/v1', '/broker-connections', array(
        'methods' => 'GET',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_get_broker_connections',
    ));

    register_rest_route('sml-members/v1', '/broker-post', array(
        'methods' => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_broker_post',
    ));

    register_rest_route('sml-members/v1', '/ticker-search', array(
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => 'sml_members_rest_ticker_search',
    ));

    register_rest_route('sml-members/v1', '/moomoo-stock-id', array(
        array(
            'methods' => 'GET',
            'permission_callback' => '__return_true',
            'callback' => 'sml_members_rest_get_moomoo_stock_id',
        ),
        array(
            'methods' => 'POST',
            'permission_callback' => function() {
                return current_user_can('manage_options');
            },
            'callback' => 'sml_members_rest_save_moomoo_stock_id',
        ),
    ));

    register_rest_route('sml-members/v1', '/trending-tickers', array(
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => 'sml_members_rest_get_trending_tickers',
    ));

    register_rest_route('sml-members/v1', '/trending-posts', array(
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => 'sml_members_rest_get_trending_posts',
    ));

    register_rest_route('sml-members/v1', '/sentiment', array(
        array(
            'methods' => 'GET',
            'permission_callback' => '__return_true',
            'callback' => 'sml_members_rest_get_sentiment',
        ),
        array(
            'methods' => 'POST',
            'permission_callback' => 'is_user_logged_in',
            'callback' => 'sml_members_rest_vote_sentiment',
        ),
    ));

    register_rest_route('sml-members/v1', '/leaderboard', array(
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => 'sml_members_rest_get_leaderboard',
    ));

    register_rest_route('sml-members/v1', '/loop-bucks', array(
        'methods' => 'GET',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_get_loop_bucks',
    ));

    register_rest_route('sml-members/v1', '/loop-bucks/challenge', array(
        'methods' => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_create_loop_challenge',
    ));

    register_rest_route('sml-members/v1', '/loop-bucks/join', array(
        'methods' => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_join_loop_challenge',
    ));

    register_rest_route('sml-members/v1', '/loop-bucks/purchase-intent', array(
        'methods' => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_loop_purchase_intent',
    ));

    register_rest_route('sml-members/v1', '/loop-bucks/heartbeat', array(
        'methods' => 'POST',
        'permission_callback' => 'is_user_logged_in',
        'callback' => 'sml_members_rest_loop_heartbeat',
    ));

    register_rest_route('sml-members/v1', '/sentiment-settle', array(
        'methods' => 'POST',
        'permission_callback' => function() {
            return current_user_can('manage_options');
        },
        'callback' => 'sml_members_rest_settle_sentiment',
    ));
}

function sml_members_rest_register(WP_REST_Request $request) {
    $email = sanitize_email($request->get_param('email'));
    $password = (string) $request->get_param('password');
    $handle = sanitize_text_field((string) $request->get_param('handle'));
    $referral_code = sml_members_clean_referral_code((string) $request->get_param('referral_code'));

    if (!is_email($email)) {
        return new WP_Error('sml_bad_email', 'Enter a valid email address.', array('status' => 400));
    }
    if (email_exists($email)) {
        return new WP_Error('sml_email_exists', 'That email already has an account.', array('status' => 409));
    }
    if (!sml_members_password_is_valid($password)) {
        return new WP_Error('sml_bad_password', sml_members_password_rule_message(), array('status' => 400));
    }

    $email_parts = explode('@', $email);
    $login_base = sanitize_user($email_parts[0], true);
    $login = $login_base ?: 'sml_member';
    while (username_exists($login)) {
        $login = $login_base . '_' . wp_rand(1000, 9999);
    }

    $GLOBALS['sml_members_skip_auto_verification_email'] = true;
    $user_id = wp_create_user($login, $password, $email);
    unset($GLOBALS['sml_members_skip_auto_verification_email']);
    if (is_wp_error($user_id)) {
        return $user_id;
    }

    update_user_meta($user_id, 'sml_display_handle', $handle ?: $login);
    update_user_meta($user_id, 'sml_public_handle', sml_members_clean_public_handle($handle ?: $login));
    update_user_meta($user_id, 'sml_email_verified', '0');
    sml_members_referral_code($user_id);
    sml_members_attach_referrer($user_id, $referral_code);
    $email_sent = sml_members_send_verification_code($user_id);

    return array(
        'created' => true,
        'verification_required' => true,
        'email_sent' => (bool) $email_sent,
        'expires_in_minutes' => 25,
        'message' => $email_sent ? 'Verification email sent. Enter your 5-digit code.' : 'Account created, but the verification email could not be sent. Use resend code or check mail settings.',
        'profile_url' => home_url('/members/' . $user_id . '/'),
    );
}

function sml_members_rest_login(WP_REST_Request $request) {
    $login = sanitize_text_field((string) $request->get_param('login'));
    $password = (string) $request->get_param('password');
    $remember = rest_sanitize_boolean($request->get_param('remember'));

    if ($login === '' || $password === '') {
        return new WP_Error('sml_login_required', 'Enter your email or username and password.', array('status' => 400));
    }

    $user = is_email($login) ? get_user_by('email', sanitize_email($login)) : get_user_by('login', sanitize_user($login));
    if (!$user) {
        return new WP_Error('sml_bad_login', 'No account was found with that email or username.', array('status' => 401));
    }

    if (!wp_check_password($password, $user->user_pass, $user->ID)) {
        return new WP_Error('sml_bad_password', 'That password did not work. Try again.', array('status' => 401));
    }

    if (get_user_meta($user->ID, 'sml_email_verified', true) !== '1') {
        sml_members_send_verification_code($user->ID);
        return new WP_Error('sml_unverified', 'Check your email for the 5-digit verification code before signing in.', array('status' => 403, 'email' => $user->user_email));
    }

    $signed = wp_signon(array(
        'user_login' => $user->user_login,
        'user_password' => $password,
        'remember' => $remember,
    ), is_ssl());

    if (is_wp_error($signed)) {
        return new WP_Error('sml_login_failed', 'Sign in could not be completed. Try again.', array('status' => 401));
    }

    wp_set_current_user($signed->ID);
    return array(
        'logged_in' => true,
        'remember' => (bool) $remember,
        'user_id' => $signed->ID,
        'profile_url' => home_url('/members/' . $signed->ID . '/'),
        'message' => $remember ? 'Signed in. You will stay signed in on this device.' : 'Signed in for this session.',
    );
}

function sml_members_rest_verify(WP_REST_Request $request) {
    $remember_param = $request->get_param('remember');
    return sml_members_verify_code(
        $request->get_param('email'),
        $request->get_param('code'),
        $remember_param === null ? true : rest_sanitize_boolean($remember_param)
    );
}

function sml_members_rest_resend_code(WP_REST_Request $request) {
    $email = sanitize_email($request->get_param('email'));
    $user = get_user_by('email', $email);
    if (!$user) {
        return new WP_Error('sml_no_user', 'No account was found for that email.', array('status' => 404));
    }
    $email_sent = sml_members_send_verification_code($user->ID);
    return array(
        'sent' => (bool) $email_sent,
        'email_sent' => (bool) $email_sent,
        'expires_in_minutes' => 25,
        'message' => $email_sent ? 'Verification email sent. Enter your 5-digit code.' : 'The verification email could not be sent. Check mail settings and try again.',
    );
}

function sml_members_rest_get_profile() {
    return sml_members_profile_payload(get_current_user_id());
}

function sml_members_rest_update_profile(WP_REST_Request $request) {
    $user_id = get_current_user_id();
    $handle = sanitize_text_field((string) $request->get_param('handle'));
    $public_handle = sml_members_clean_public_handle((string) $request->get_param('public_handle'));
    $first_name = sanitize_text_field((string) $request->get_param('first_name'));
    $last_name = sanitize_text_field((string) $request->get_param('last_name'));
    $show_real_name = $request->get_param('show_real_name') ? '1' : '0';
    $bio = sanitize_textarea_field((string) $request->get_param('bio'));
    $avatar_url = esc_url_raw((string) $request->get_param('avatar_url'));
    $banner_url = esc_url_raw((string) $request->get_param('banner_url'));
    $tagline = sanitize_text_field((string) $request->get_param('tagline'));
    $theme = sanitize_key((string) $request->get_param('theme'));
    $font = sml_members_clean_profile_font((string) $request->get_param('font'));
    $accent_color = sml_members_clean_hex_color((string) $request->get_param('accent_color'));
    $background_color = sml_members_clean_hex_color((string) $request->get_param('background_color'));
    $text_color = sml_members_clean_hex_color((string) $request->get_param('text_color'));
    $card_color = sml_members_clean_hex_color((string) $request->get_param('card_color'));
    $music_url = sml_members_clean_music_url((string) $request->get_param('music_url'));
    $music_playlist = sml_members_clean_music_playlist($request->get_param('music_playlist'));
    if (empty($music_playlist) && $music_url !== '') {
        $music_playlist = sml_members_clean_music_playlist(array($music_url));
    }
    $music_autoplay = $request->get_param('music_autoplay') ? '1' : '0';
    $social_links = sml_members_clean_social_links($request->get_param('social_links'));
    $pinned_image_url = esc_url_raw((string) $request->get_param('pinned_image_url'));
    $pinned_post_id = absint($request->get_param('pinned_post_id'));

    if ($handle !== '') {
        update_user_meta($user_id, 'sml_display_handle', substr($handle, 0, 32));
    }
    if ($public_handle !== '') {
        update_user_meta($user_id, 'sml_public_handle', $public_handle);
    }
    update_user_meta($user_id, 'first_name', substr($first_name, 0, 50));
    update_user_meta($user_id, 'last_name', substr($last_name, 0, 50));
    update_user_meta($user_id, 'sml_show_real_name', $show_real_name);
    update_user_meta($user_id, 'sml_bio', substr($bio, 0, 280));
    update_user_meta($user_id, 'sml_tagline', substr($tagline, 0, 80));
    update_user_meta($user_id, 'sml_profile_theme', in_array($theme, array('green', 'blue', 'gold', 'red'), true) ? $theme : 'green');
    update_user_meta($user_id, 'sml_profile_font', $font);
    update_user_meta($user_id, 'sml_profile_accent_color', $accent_color);
    update_user_meta($user_id, 'sml_profile_background_color', $background_color);
    update_user_meta($user_id, 'sml_profile_text_color', $text_color);
    update_user_meta($user_id, 'sml_profile_card_color', $card_color);
    update_user_meta($user_id, 'sml_music_url', $music_url);
    update_user_meta($user_id, 'sml_music_playlist', $music_playlist);
    update_user_meta($user_id, 'sml_music_autoplay', $music_autoplay);
    update_user_meta($user_id, 'sml_social_links', $social_links);
    if ($avatar_url !== '') {
        update_user_meta($user_id, 'sml_avatar_url', $avatar_url);
    }
    if ($banner_url !== '') {
        update_user_meta($user_id, 'sml_banner_url', $banner_url);
    }
    if ($pinned_image_url !== '') {
        update_user_meta($user_id, 'sml_pinned_image_url', $pinned_image_url);
    }
    if ($pinned_post_id) {
        $comment = get_comment($pinned_post_id);
        $parsed = sml_members_parse_stream_comment($comment);
        if (!$parsed || (int) $parsed['user_id'] !== (int) $user_id) {
            return new WP_Error('sml_bad_pin', 'You can only pin a ticker post you created.', array('status' => 400));
        }
        update_user_meta($user_id, 'sml_pinned_post_id', $pinned_post_id);
    }

    return sml_members_profile_payload($user_id);
}

function sml_members_rest_get_profile_chart(WP_REST_Request $request) {
    $user_id = absint($request->get_param('user_id'));
    if (!$user_id) {
        return new WP_Error('sml_no_user', 'Choose a profile to load.', array('status' => 400));
    }
    if (!get_userdata($user_id)) {
        return new WP_Error('sml_no_user', 'Profile not found.', array('status' => 404));
    }

    return array(
        'posts' => sml_members_profile_chart_posts($user_id, 30),
        'can_post' => is_user_logged_in(),
        'count' => count(sml_members_raw_profile_chart_posts($user_id)),
    );
}

function sml_members_rest_post_profile_chart(WP_REST_Request $request) {
    $target_id = absint($request->get_param('user_id'));
    if (!$target_id || !get_userdata($target_id)) {
        return new WP_Error('sml_no_user', 'Profile not found.', array('status' => 404));
    }

    $author_id = get_current_user_id();
    $text = sml_members_clean_stream_text((string) $request->get_param('text'));
    if ($text === '') {
        return new WP_Error('sml_empty_chart', 'Write something before posting to the Chart.', array('status' => 400));
    }

    $row = array(
        'id' => time() . '-' . wp_rand(1000, 9999),
        'author_id' => $author_id,
        'text' => $text,
        'date' => gmdate('c'),
    );
    $posts = sml_members_raw_profile_chart_posts($target_id);
    array_unshift($posts, $row);
    $posts = array_slice($posts, 0, 80);
    update_user_meta($target_id, 'sml_profile_chart_posts', $posts);
    sml_members_increment_stat($author_id, 'posts', 1);
    sml_members_notify_mentions($author_id, $text, home_url('/?focus=chart-' . $target_id . '-' . $row['id']));

    if ((int) $target_id !== (int) $author_id) {
        sml_members_add_notification(
            $target_id,
            'profile_chart',
            sml_members_handle($author_id) . ' posted on your Chart.',
            home_url('/members/' . $target_id . '/#chart'),
            $author_id
        );
    }

    return array(
        'created' => true,
        'post' => sml_members_profile_chart_post_payload($row),
        'posts' => sml_members_profile_chart_posts($target_id, 30),
        'count' => count($posts),
    );
}

function sml_members_rest_like_profile_chart(WP_REST_Request $request) {
    $target_id = absint($request->get_param('user_id'));
    $post_id = sanitize_key((string) $request->get_param('post_id'));
    if (!$target_id || !$post_id || !get_userdata($target_id)) {
        return new WP_Error('sml_bad_like', 'Choose a Chart post to like.', array('status' => 400));
    }

    $viewer_id = get_current_user_id();
    $posts = sml_members_raw_profile_chart_posts($target_id);
    $changed = false;
    $liked = false;
    $author_id = 0;

    foreach ($posts as &$row) {
        if (sanitize_key((string) ($row['id'] ?? '')) !== $post_id) {
            continue;
        }
        $author_id = absint($row['author_id'] ?? $row['user_id'] ?? 0);
        if (!$author_id) {
            return new WP_Error('sml_bad_like_author', 'This Chart post has no author.', array('status' => 400));
        }
        if ($author_id === $viewer_id) {
            return new WP_Error('sml_self_like', 'You cannot like your own Chart post.', array('status' => 400));
        }

        $likes = isset($row['likes']) && is_array($row['likes']) ? array_map('absint', $row['likes']) : array();
        $likes = array_values(array_unique(array_filter($likes)));
        if (in_array($viewer_id, $likes, true)) {
            $likes = array_values(array_diff($likes, array($viewer_id)));
            sml_members_increment_stat($author_id, 'likes', -1, false);
        } else {
            $likes[] = $viewer_id;
            $liked = true;
            sml_members_increment_stat($author_id, 'likes', 1);
            sml_members_add_notification(
                $author_id,
                'chart_like',
                sml_members_handle($viewer_id) . ' liked your Chart post.',
                home_url('/members/' . $target_id . '/#chart'),
                $viewer_id
            );
        }
        $row['likes'] = $likes;
        $changed = true;
        break;
    }
    unset($row);

    if (!$changed) {
        return new WP_Error('sml_like_missing', 'That Chart post could not be found.', array('status' => 404));
    }

    update_user_meta($target_id, 'sml_profile_chart_posts', array_slice($posts, 0, 80));

    return array(
        'liked' => $liked,
        'posts' => sml_members_profile_chart_posts($target_id, 30),
        'achievements' => $author_id ? sml_members_achievement_summary($author_id) : array(),
    );
}

function sml_members_rest_get_achievements() {
    $user_id = get_current_user_id();
    return array(
        'stats' => sml_members_achievement_stats($user_id),
        'achievements' => sml_members_achievement_summary($user_id),
        'credits' => sml_members_loop_bucks_balance($user_id),
    );
}

function sml_members_rest_upload_profile_image(WP_REST_Request $request) {
    $kind = sanitize_key((string) $request->get_param('type'));
    $data_url = (string) $request->get_param('image');

    if (!in_array($kind, array('avatar', 'banner', 'album', 'pinned'), true)) {
        return new WP_Error('sml_bad_type', 'Image type must be avatar, banner, album, or pinned.', array('status' => 400));
    }

    if (!preg_match('/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+\/=]+)$/', $data_url, $matches)) {
        return new WP_Error('sml_bad_image', 'Upload a PNG, JPG, GIF, or WEBP image.', array('status' => 400));
    }

    $extension = strtolower($matches[1]);
    $extension = $extension === 'jpeg' ? 'jpg' : $extension;
    $bytes = base64_decode($matches[2], true);
    if (!$bytes || strlen($bytes) > SML_MEMBERS_MAX_IMAGE_BYTES) {
        return new WP_Error('sml_image_size', 'Image must be under 8MB.', array('status' => 400));
    }

    $file_name = 'sml-' . $kind . '-' . get_current_user_id() . '-' . time() . '.' . $extension;
    $upload = wp_upload_bits($file_name, null, $bytes);
    if (!empty($upload['error'])) {
        return new WP_Error('sml_upload_failed', $upload['error'], array('status' => 500));
    }

    $url = esc_url_raw($upload['url']);
    if ($kind === 'banner') {
        update_user_meta(get_current_user_id(), 'sml_banner_url', $url);
    } elseif ($kind === 'avatar') {
        update_user_meta(get_current_user_id(), 'sml_avatar_url', $url);
    } elseif ($kind === 'pinned') {
        update_user_meta(get_current_user_id(), 'sml_pinned_image_url', $url);
        sml_members_add_album_image(get_current_user_id(), $url);
    } else {
        sml_members_add_album_image(get_current_user_id(), $url);
    }
    return array('url' => $url, 'profile' => sml_members_profile_payload(get_current_user_id()));
}

function sml_members_rest_get_watchlist() {
    return array('watchlist' => sml_members_get_watchlist(get_current_user_id()));
}

function sml_members_rest_get_profile_feed() {
    return sml_members_personal_feed_payload(get_current_user_id());
}

function sml_members_rest_get_news_feed(WP_REST_Request $request) {
    $limit = absint($request->get_param('limit'));
    $limit = max(6, min(30, $limit ?: 18));
    $posts = get_posts(array(
        'post_type' => 'post',
        'post_status' => 'publish',
        'posts_per_page' => $limit,
        'orderby' => 'date',
        'order' => 'DESC',
        'ignore_sticky_posts' => true,
    ));

    $articles = array();
    foreach ($posts as $post) {
        $category_names = wp_get_post_categories($post->ID, array('fields' => 'names'));
        if (is_wp_error($category_names) || !is_array($category_names)) {
            $category_names = array();
        }
        $tickers = sml_members_stream_tickers('', get_the_title($post) . ' ' . wp_strip_all_tags($post->post_excerpt . ' ' . $post->post_content));
        $tickers = array_values(array_filter($tickers));
        $image = get_the_post_thumbnail_url($post, 'large');
        if (!$image) {
            $image = get_the_post_thumbnail_url($post, 'medium_large');
        }
        if (!$image) {
            $image = 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=900&q=70';
        }
        $excerpt = get_the_excerpt($post);
        if (!$excerpt) {
            $excerpt = wp_trim_words(wp_strip_all_tags($post->post_content), 34, '...');
        }
        $articles[] = array(
            'id' => (int) $post->ID,
            'title' => html_entity_decode(get_the_title($post), ENT_QUOTES, get_bloginfo('charset')),
            'excerpt' => html_entity_decode(wp_strip_all_tags($excerpt), ENT_QUOTES, get_bloginfo('charset')),
            'url' => get_permalink($post),
            'image' => esc_url_raw($image),
            'date' => get_post_time('c', true, $post),
            'date_label' => get_the_date('M j, Y g:ia', $post),
            'author' => get_the_author_meta('display_name', (int) $post->post_author),
            'categories' => array_slice(array_values($category_names), 0, 4),
            'tickers' => array_slice($tickers, 0, 6),
            'comment_count' => (int) get_comments_number($post),
        );
    }

    return array(
        'articles' => $articles,
        'refresh_seconds' => 60,
        'logged_in' => is_user_logged_in(),
    );
}

function sml_members_rest_update_watchlist(WP_REST_Request $request) {
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
    $action = sanitize_key((string) $request->get_param('action'));
    $items = sml_members_get_watchlist(get_current_user_id());

    if ($symbol !== '') {
        if ($action === 'remove') {
            $items = array_values(array_diff($items, array($symbol)));
        } else {
            $items[] = $symbol;
            $items = array_values(array_unique(array_slice($items, -100)));
        }
        update_user_meta(get_current_user_id(), 'sml_watchlist', $items);
    }

    return array('watchlist' => $items);
}

function sml_members_rest_follow(WP_REST_Request $request) {
    $current = get_current_user_id();
    $target = absint($request->get_param('user_id'));
    $action = sanitize_key((string) $request->get_param('action'));

    if (!$target || $target === $current || !get_userdata($target)) {
        return new WP_Error('sml_bad_follow', 'Choose another Stockmarketloop member to follow.', array('status' => 400));
    }

    $following = sml_members_id_list(get_user_meta($current, 'sml_following', true));
    $followers = sml_members_id_list(get_user_meta($target, 'sml_followers', true));

    if ($action === 'unfollow') {
        $following = array_values(array_diff($following, array($target)));
        $followers = array_values(array_diff($followers, array($current)));
        $following_state = false;
    } else {
        if (!in_array($target, $following, true)) {
            $following[] = $target;
        }
        if (!in_array($current, $followers, true)) {
            $followers[] = $current;
        }
        sml_members_add_notification($target, 'follow', sml_members_handle($current) . ' followed your Stockmarketloop profile.', home_url('/members/' . $current . '/'), $current);
        $following_state = true;
    }

    update_user_meta($current, 'sml_following', array_values(array_unique($following)));
    update_user_meta($target, 'sml_followers', array_values(array_unique($followers)));

    return array(
        'following' => $following_state,
        'followers_count' => count($followers),
        'following_count' => count($following),
    );
}

function sml_members_rest_get_notifications() {
    $items = sml_members_notifications(get_current_user_id());
    $unread = 0;
    foreach ($items as $item) {
        if (empty($item['read'])) {
            $unread++;
        }
    }
    return array('unread_count' => $unread, 'notifications' => array_slice($items, 0, 40));
}

function sml_members_rest_update_notifications(WP_REST_Request $request) {
    $action = sanitize_key((string) $request->get_param('action'));
    $items = sml_members_notifications(get_current_user_id());
    if ($action === 'clear') {
        $items = array();
    } else {
        foreach ($items as &$item) {
            $item['read'] = true;
        }
        unset($item);
    }
    update_user_meta(get_current_user_id(), 'sml_notifications', $items);
    return sml_members_rest_get_notifications();
}

function sml_members_rest_get_stream(WP_REST_Request $request) {
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
    if (!$symbol) {
        return new WP_Error('sml_bad_symbol', 'Ticker symbol required.', array('status' => 400));
    }

    $comments = get_comments(array(
        'post_id' => SML_MEMBERS_STREAM_POST_ID,
        'status' => 'approve',
        'number' => 120,
        'orderby' => 'comment_date_gmt',
        'order' => 'DESC',
    ));

    $rows = array();
    foreach ($comments as $comment) {
        $parsed = sml_members_parse_stream_comment($comment);
        if (!$parsed || !in_array($symbol, $parsed['tickers'], true)) {
            continue;
        }
        $rows[] = $parsed;
        if (count($rows) >= 60) {
            break;
        }
    }

    $hashtags = array();
    foreach ($rows as $row) {
        foreach ((array) ($row['hashtags'] ?? array()) as $tag) {
            $hashtags[$tag] = isset($hashtags[$tag]) ? $hashtags[$tag] + 1 : 1;
        }
    }
    arsort($hashtags);

    return array(
        'symbol' => $symbol,
        'comments' => $rows,
        'hashtags' => array_slice(array_keys($hashtags), 0, 12),
        'refresh_seconds' => 20,
    );
}

function sml_members_rest_post_stream(WP_REST_Request $request) {
    $user_id = get_current_user_id();
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
    $text = sml_members_clean_stream_text((string) $request->get_param('text'));
    $parent_id = absint($request->get_param('parent_id'));

    if (!$symbol || $text === '') {
        return new WP_Error('sml_bad_stream', 'Ticker and comment text are required.', array('status' => 400));
    }

    $tickers = sml_members_stream_tickers($symbol, $text);
    $encoded = SML_MEMBERS_STREAM_MARK . implode(',', $tickers) . '|' . $user_id . '|' . $text;
    $user = get_userdata($user_id);

    $comment_id = wp_new_comment(array(
        'comment_post_ID' => SML_MEMBERS_STREAM_POST_ID,
        'comment_parent' => $parent_id,
        'user_id' => $user_id,
        'comment_author' => sml_members_handle($user_id),
        'comment_author_email' => $user ? $user->user_email : '',
        'comment_content' => $encoded,
        'comment_approved' => 1,
    ), true);

    if (is_wp_error($comment_id)) {
        return $comment_id;
    }

    sml_members_increment_stat($user_id, 'posts', 1);
    sml_members_notify_mentions(
        $user_id,
        $text,
        home_url('/?focus=stream-' . (int) $comment_id)
    );
    return array('created' => true, 'comment' => sml_members_parse_stream_comment(get_comment($comment_id)));
}

function sml_members_rest_like_stream_comment(WP_REST_Request $request) {
    $viewer_id = get_current_user_id();
    $comment_id = absint($request->get_param('comment_id'));
    $comment = $comment_id ? get_comment($comment_id) : null;
    $parsed = $comment ? sml_members_parse_stream_comment($comment) : null;

    if (!$parsed) {
        return new WP_Error('sml_bad_comment', 'Ticker post not found.', array('status' => 404));
    }

    $author_id = absint($parsed['user_id'] ?? 0);
    if (!$author_id) {
        return new WP_Error('sml_bad_author', 'Ticker post author not found.', array('status' => 400));
    }
    if ($viewer_id === $author_id) {
        return new WP_Error('sml_self_like', 'You cannot like your own ticker post.', array('status' => 400));
    }

    $likes = sml_members_id_list(get_comment_meta($comment_id, 'sml_stream_like_user_ids', true));
    $liked = in_array($viewer_id, $likes, true);
    if ($liked) {
        $likes = array_values(array_diff($likes, array($viewer_id)));
        sml_members_increment_stat($author_id, 'likes', -1, false);
    } else {
        $likes[] = $viewer_id;
        $likes = array_values(array_unique(array_map('absint', $likes)));
        sml_members_increment_stat($author_id, 'likes', 1);
        $primary = !empty($parsed['tickers'][0]) ? $parsed['tickers'][0] : 'SPY';
        sml_members_add_notification(
            $author_id,
            'stream_like',
            sml_members_handle($viewer_id) . ' liked your $' . $primary . ' ticker post.',
            home_url('/stock-chart/?symbol=' . rawurlencode($primary) . '#comments'),
            $viewer_id
        );
    }

    update_comment_meta($comment_id, 'sml_stream_like_user_ids', $likes);
    $parsed = sml_members_parse_stream_comment(get_comment($comment_id));

    return array(
        'liked' => !$liked,
        'like_count' => count($likes),
        'comment' => $parsed,
        'achievements' => sml_members_achievement_summary($author_id),
    );
}

function sml_members_rest_vote_post(WP_REST_Request $request) {
    $viewer_id = get_current_user_id();
    $target_type = sanitize_key((string) $request->get_param('target_type'));
    $target_id = sanitize_text_field((string) $request->get_param('target_id'));
    $vote = sanitize_key((string) $request->get_param('vote'));

    if (!in_array($vote, array('up', 'down', 'clear'), true)) {
        return new WP_Error('sml_bad_vote', 'Choose an upvote or downvote.', array('status' => 400));
    }

    if ($target_type === 'stream') {
        $comment_id = absint($target_id);
        $comment = $comment_id ? get_comment($comment_id) : null;
        $parsed = $comment ? sml_members_parse_stream_comment($comment) : null;
        if (!$parsed) {
            return new WP_Error('sml_bad_vote_target', 'Ticker post not found.', array('status' => 404));
        }
        if ((int) ($parsed['user_id'] ?? 0) === $viewer_id) {
            return new WP_Error('sml_self_vote', 'You cannot vote on your own post.', array('status' => 400));
        }

        $upvotes = sml_members_vote_ids(get_comment_meta($comment_id, 'sml_stream_upvote_user_ids', true));
        $downvotes = sml_members_vote_ids(get_comment_meta($comment_id, 'sml_stream_downvote_user_ids', true));
        $already_up = in_array($viewer_id, $upvotes, true);
        $already_down = in_array($viewer_id, $downvotes, true);

        $upvotes = array_values(array_diff($upvotes, array($viewer_id)));
        $downvotes = array_values(array_diff($downvotes, array($viewer_id)));
        if ($vote === 'up' && !$already_up) {
            $upvotes[] = $viewer_id;
        } elseif ($vote === 'down' && !$already_down) {
            $downvotes[] = $viewer_id;
        }

        update_comment_meta($comment_id, 'sml_stream_upvote_user_ids', sml_members_vote_ids($upvotes));
        update_comment_meta($comment_id, 'sml_stream_downvote_user_ids', sml_members_vote_ids($downvotes));
        $parsed = sml_members_parse_stream_comment(get_comment($comment_id));

        return array(
            'target_type' => 'stream',
            'comment' => $parsed,
            'votes' => array_intersect_key($parsed, array_flip(array('upvote_count', 'downvote_count', 'vote_score', 'viewer_vote', 'total_votes'))),
        );
    }

    if ($target_type === 'chart') {
        $profile_user_id = absint($request->get_param('user_id'));
        if (!$profile_user_id) {
            return new WP_Error('sml_bad_profile', 'Profile user is required for Chart votes.', array('status' => 400));
        }
        $posts = sml_members_raw_profile_chart_posts($profile_user_id);
        $found = false;
        $updated_row = null;
        foreach ($posts as &$row) {
            if (sanitize_key((string) ($row['id'] ?? '')) !== sanitize_key($target_id)) {
                continue;
            }
            $author_id = absint($row['author_id'] ?? $row['user_id'] ?? 0);
            if ($author_id === $viewer_id) {
                return new WP_Error('sml_self_vote', 'You cannot vote on your own post.', array('status' => 400));
            }
            $upvotes = sml_members_vote_ids($row['upvotes'] ?? array());
            $downvotes = sml_members_vote_ids($row['downvotes'] ?? array());
            $already_up = in_array($viewer_id, $upvotes, true);
            $already_down = in_array($viewer_id, $downvotes, true);
            $upvotes = array_values(array_diff($upvotes, array($viewer_id)));
            $downvotes = array_values(array_diff($downvotes, array($viewer_id)));
            if ($vote === 'up' && !$already_up) {
                $upvotes[] = $viewer_id;
            } elseif ($vote === 'down' && !$already_down) {
                $downvotes[] = $viewer_id;
            }
            $row['upvotes'] = sml_members_vote_ids($upvotes);
            $row['downvotes'] = sml_members_vote_ids($downvotes);
            $updated_row = $row;
            $found = true;
            break;
        }
        unset($row);

        if (!$found) {
            return new WP_Error('sml_bad_vote_target', 'Chart post not found.', array('status' => 404));
        }

        update_user_meta($profile_user_id, 'sml_profile_chart_posts', $posts);
        return array(
            'target_type' => 'chart',
            'post' => sml_members_profile_chart_post_payload($updated_row),
            'posts' => sml_members_profile_chart_posts($profile_user_id, 30),
        );
    }

    return new WP_Error('sml_bad_vote_type', 'Post type not supported.', array('status' => 400));
}

function sml_members_rest_get_post_voters(WP_REST_Request $request) {
    $target_type = sanitize_key((string) $request->get_param('target_type'));
    $target_id = sanitize_text_field((string) $request->get_param('target_id'));

    if ($target_type === 'stream') {
        $comment_id = absint($target_id);
        $comment = $comment_id ? get_comment($comment_id) : null;
        if (!$comment || !sml_members_parse_stream_comment($comment)) {
            return new WP_Error('sml_bad_vote_target', 'Ticker post not found.', array('status' => 404));
        }
        return array(
            'target_type' => 'stream',
            'target_id' => $comment_id,
            'upvoters' => sml_members_voter_rows(get_comment_meta($comment_id, 'sml_stream_upvote_user_ids', true)),
            'downvoters' => sml_members_voter_rows(get_comment_meta($comment_id, 'sml_stream_downvote_user_ids', true)),
        );
    }

    if ($target_type === 'chart') {
        $profile_user_id = absint($request->get_param('user_id'));
        foreach (sml_members_raw_profile_chart_posts($profile_user_id) as $row) {
            if (sanitize_key((string) ($row['id'] ?? '')) !== sanitize_key($target_id)) {
                continue;
            }
            return array(
                'target_type' => 'chart',
                'target_id' => sanitize_key($target_id),
                'upvoters' => sml_members_voter_rows($row['upvotes'] ?? array()),
                'downvoters' => sml_members_voter_rows($row['downvotes'] ?? array()),
            );
        }
        return new WP_Error('sml_bad_vote_target', 'Chart post not found.', array('status' => 404));
    }

    return new WP_Error('sml_bad_vote_type', 'Post type not supported.', array('status' => 400));
}

function sml_members_rest_ticker_search(WP_REST_Request $request) {
    $query = strtoupper(sanitize_text_field((string) $request->get_param('q')));
    $query = preg_replace('/[^A-Z0-9.\-\s]/', '', $query);
    $query = preg_replace('/\s+/', ' ', trim((string) $query));
    $limit = absint($request->get_param('limit'));
    $limit = max(1, min(50, $limit ?: 12));

    if ($query === '') {
        $rows = array_slice(sml_members_tradable_seed_rows(), 0, $limit);
        return array(
            'query' => '',
            'count' => count($rows),
            'results' => $rows,
            'message' => 'Showing popular Moomoo-ready U.S. stocks and ETFs.',
        );
    }

    $rows = array();
    foreach (sml_members_tradable_seed_rows() as $row) {
        $haystack = strtoupper($row['symbol'] . ' ' . $row['code'] . ' ' . $row['name']);
        if (strpos($haystack, $query) !== false || strpos($row['symbol'], sml_members_clean_symbol($query)) === 0) {
            $rows[] = $row;
        }
        if (count($rows) >= $limit) {
            break;
        }
    }

    $rows = sml_members_unique_ticker_rows($rows);
    $exact = sml_members_clean_symbol(str_replace(array('US.', '-US'), '', $query));
    if ($exact && preg_match('/^[A-Z][A-Z0-9.]{0,7}$/', $exact)) {
        if (!sml_members_ticker_rows_contain($rows, $exact)) {
            $rows[] = sml_members_ticker_row(array(
                'symbol' => $exact,
                'name' => $exact . ' stock',
                'exchange' => '',
                'type' => 'STOCK',
                'source' => 'direct symbol entry',
                'verified' => false,
                'skip_exchange_guess' => true,
                'tradingview_symbol' => $exact,
                'message' => 'Moomoo lookup will continue on the ticker page.',
            ));
        }

        $rows = array_slice(sml_members_unique_ticker_rows($rows), 0, $limit);
        return array(
            'query' => $query,
            'count' => count($rows),
            'results' => $rows,
            'message' => 'Ticker search loaded instantly. Exact symbols open the Stockmarketloop terminal immediately.',
        );
    }

    foreach (sml_members_moomoo_web_ticker_search($query, $limit) as $row) {
        $rows[] = $row;
    }

    $rows = array_slice(sml_members_unique_ticker_rows($rows), 0, $limit);
    return array(
        'query' => $query,
        'count' => count($rows),
        'results' => $rows,
        'message' => count($rows)
            ? 'Ticker search loaded. Exact symbols open the Stockmarketloop terminal immediately.'
            : 'No ticker match yet. Try the exact Moomoo symbol.',
    );
}

function sml_members_tradable_seed_rows() {
    $rows = array(
        array('SPY', 'SPDR S&P 500 ETF Trust', 'AMEX', 'ETF'), array('QQQ', 'Invesco QQQ Trust', 'NASDAQ', 'ETF'),
        array('DIA', 'SPDR Dow Jones Industrial Average ETF', 'AMEX', 'ETF'), array('IWM', 'iShares Russell 2000 ETF', 'AMEX', 'ETF'),
        array('AAPL', 'Apple', 'NASDAQ', 'STOCK'), array('MSFT', 'Microsoft', 'NASDAQ', 'STOCK'), array('NVDA', 'Nvidia', 'NASDAQ', 'STOCK'),
        array('TSLA', 'Tesla', 'NASDAQ', 'STOCK'), array('AMZN', 'Amazon', 'NASDAQ', 'STOCK'), array('META', 'Meta Platforms', 'NASDAQ', 'STOCK'),
        array('GOOGL', 'Alphabet Class A', 'NASDAQ', 'STOCK'), array('GOOG', 'Alphabet Class C', 'NASDAQ', 'STOCK'), array('AVGO', 'Broadcom', 'NASDAQ', 'STOCK'),
        array('AMD', 'Advanced Micro Devices', 'NASDAQ', 'STOCK'), array('PLTR', 'Palantir', 'NASDAQ', 'STOCK'), array('NFLX', 'Netflix', 'NASDAQ', 'STOCK'),
        array('TSM', 'Taiwan Semiconductor Manufacturing', 'NYSE', 'STOCK'), array('SMCI', 'Super Micro Computer', 'NASDAQ', 'STOCK'), array('MU', 'Micron Technology', 'NASDAQ', 'STOCK'),
        array('QCOM', 'Qualcomm', 'NASDAQ', 'STOCK'), array('INTC', 'Intel', 'NASDAQ', 'STOCK'), array('ORCL', 'Oracle', 'NYSE', 'STOCK'),
        array('CRM', 'Salesforce', 'NYSE', 'STOCK'), array('ADBE', 'Adobe', 'NASDAQ', 'STOCK'), array('UBER', 'Uber Technologies', 'NYSE', 'STOCK'),
        array('SHOP', 'Shopify', 'NASDAQ', 'STOCK'), array('SNOW', 'Snowflake', 'NYSE', 'STOCK'), array('COIN', 'Coinbase', 'NASDAQ', 'STOCK'),
        array('MSTR', 'Strategy', 'NASDAQ', 'STOCK'), array('SOFI', 'SoFi Technologies', 'NASDAQ', 'STOCK'), array('HOOD', 'Robinhood Markets', 'NASDAQ', 'STOCK'),
        array('RIVN', 'Rivian Automotive', 'NASDAQ', 'STOCK'), array('LCID', 'Lucid Group', 'NASDAQ', 'STOCK'), array('NIO', 'NIO', 'NYSE', 'STOCK'),
        array('BABA', 'Alibaba', 'NYSE', 'STOCK'), array('XPEV', 'XPeng', 'NYSE', 'STOCK'), array('LI', 'Li Auto', 'NASDAQ', 'STOCK'),
        array('AMC', 'AMC Entertainment', 'NYSE', 'STOCK'), array('GME', 'GameStop', 'NYSE', 'STOCK'), array('AVAV', 'AeroVironment', 'NASDAQ', 'STOCK'),
        array('XOM', 'Exxon Mobil', 'NYSE', 'STOCK'), array('CVX', 'Chevron', 'NYSE', 'STOCK'), array('OXY', 'Occidental Petroleum', 'NYSE', 'STOCK'),
        array('SLB', 'Schlumberger', 'NYSE', 'STOCK'), array('XLE', 'Energy Select Sector SPDR Fund', 'AMEX', 'ETF'), array('JPM', 'JPMorgan Chase', 'NYSE', 'STOCK'),
        array('BAC', 'Bank of America', 'NYSE', 'STOCK'), array('GS', 'Goldman Sachs', 'NYSE', 'STOCK'), array('MS', 'Morgan Stanley', 'NYSE', 'STOCK'),
        array('WFC', 'Wells Fargo', 'NYSE', 'STOCK'), array('C', 'Citigroup', 'NYSE', 'STOCK'), array('PYPL', 'PayPal', 'NASDAQ', 'STOCK'),
        array('SQ', 'Block', 'NYSE', 'STOCK'), array('DIS', 'Disney', 'NYSE', 'STOCK'), array('NKE', 'Nike', 'NYSE', 'STOCK'),
        array('WMT', 'Walmart', 'NYSE', 'STOCK'), array('COST', 'Costco', 'NASDAQ', 'STOCK'), array('HD', 'Home Depot', 'NYSE', 'STOCK'),
        array('LOW', 'Lowe\'s', 'NYSE', 'STOCK'), array('TGT', 'Target', 'NYSE', 'STOCK'), array('UNH', 'UnitedHealth Group', 'NYSE', 'STOCK'),
        array('LLY', 'Eli Lilly', 'NYSE', 'STOCK'), array('MRNA', 'Moderna', 'NASDAQ', 'STOCK'), array('PFE', 'Pfizer', 'NYSE', 'STOCK'),
        array('BA', 'Boeing', 'NYSE', 'STOCK'), array('GE', 'GE Aerospace', 'NYSE', 'STOCK'), array('F', 'Ford Motor', 'NYSE', 'STOCK'),
        array('GM', 'General Motors', 'NYSE', 'STOCK'), array('RBLX', 'Roblox', 'NYSE', 'STOCK'), array('U', 'Unity Software', 'NYSE', 'STOCK'),
        array('PATH', 'UiPath', 'NYSE', 'STOCK'), array('AI', 'C3.ai', 'NYSE', 'STOCK'), array('IONQ', 'IonQ', 'NYSE', 'STOCK'),
        array('RKLB', 'Rocket Lab', 'NASDAQ', 'STOCK'), array('ASTS', 'AST SpaceMobile', 'NASDAQ', 'STOCK'),
    );

    $out = array();
    foreach ($rows as $row) {
        $out[] = sml_members_ticker_row(array(
            'symbol' => $row[0],
            'name' => $row[1],
            'exchange' => $row[2],
            'type' => $row[3],
            'source' => 'Stockmarketloop seed',
            'verified' => true,
        ));
    }
    return $out;
}

function sml_members_ticker_row($row) {
    $symbol = sml_members_clean_symbol((string) ($row['symbol'] ?? ''));
    $exchange = strtoupper(preg_replace('/[^A-Z]/', '', (string) ($row['exchange'] ?? '')));
    if (!$exchange && empty($row['skip_exchange_guess'])) {
        $exchange = sml_members_guess_exchange($symbol);
    }
    $code = sanitize_text_field((string) ($row['code'] ?? ('US.' . $symbol)));
    $name = sanitize_text_field((string) ($row['name'] ?? ($symbol . ' stock')));
    $type = strtoupper(sanitize_text_field((string) ($row['type'] ?? 'STOCK')));
    $tradingview = sanitize_text_field((string) ($row['tradingview_symbol'] ?? ''));
    if (!$tradingview) {
        $tradingview = $exchange ? $exchange . ':' . $symbol : $symbol;
    }
    $moomoo_id_map = sml_members_moomoo_stock_id_map();

    return array(
        'symbol' => $symbol,
        'code' => $code,
        'name' => $name,
        'exchange' => $exchange ?: 'US',
        'type' => $type,
        'source' => sanitize_text_field((string) ($row['source'] ?? 'Moomoo-compatible lookup')),
        'verified' => !empty($row['verified']),
        'tradable' => true,
        'message' => sanitize_text_field((string) ($row['message'] ?? 'Moomoo-ready U.S. ticker terminal.')),
        'tradingview_symbol' => $tradingview,
        'terminal_url' => home_url('/stock-chart/?symbol=' . rawurlencode($symbol) . ($exchange ? '&exchange=' . rawurlencode($exchange) : '')),
        'community_url' => sml_members_moomoo_community_url($symbol),
        'has_moomoo_community_id' => !empty($moomoo_id_map[$symbol]),
    );
}

function sml_members_guess_exchange($symbol) {
    $symbol = sml_members_clean_symbol($symbol);
    $amex = array('SPY', 'QQQ', 'DIA', 'IWM', 'XLE', 'XLK', 'XLF', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'ARKK', 'SQQQ', 'TQQQ', 'UVXY');
    $nyse = array('XOM', 'CVX', 'OXY', 'SLB', 'JPM', 'BAC', 'GS', 'MS', 'WFC', 'C', 'TSM', 'ORCL', 'CRM', 'UBER', 'SNOW', 'NIO', 'BABA', 'XPEV', 'AMC', 'GME', 'DIS', 'NKE', 'WMT', 'HD', 'LOW', 'TGT', 'UNH', 'LLY', 'PFE', 'BA', 'GE', 'F', 'GM', 'RBLX', 'U', 'PATH', 'AI', 'IONQ');
    if (in_array($symbol, $amex, true)) {
        return 'AMEX';
    }
    if (in_array($symbol, $nyse, true)) {
        return 'NYSE';
    }
    return 'NASDAQ';
}

function sml_members_unique_ticker_rows($rows) {
    $seen = array();
    $out = array();
    foreach ((array) $rows as $row) {
        if (empty($row['symbol'])) {
            continue;
        }
        $symbol = sml_members_clean_symbol((string) $row['symbol']);
        if (!$symbol || isset($seen[$symbol])) {
            continue;
        }
        $seen[$symbol] = true;
        $row['symbol'] = $symbol;
        $out[] = $row;
    }
    return $out;
}

function sml_members_ticker_rows_contain($rows, $symbol) {
    $symbol = sml_members_clean_symbol($symbol);
    foreach ((array) $rows as $row) {
        if (sml_members_clean_symbol((string) ($row['symbol'] ?? '')) === $symbol) {
            return true;
        }
    }
    return false;
}

function sml_members_moomoo_web_ticker_search($query, $limit = 12) {
    $query = strtoupper(trim((string) $query));
    if ($query === '') {
        return array();
    }

    $cache_key = 'sml_moomoo_ticker_search_' . md5($query . '|' . $limit);
    $cached = get_transient($cache_key);
    if (is_array($cached)) {
        return $cached;
    }

    $urls = array(
        'https://www.moomoo.com/search/quote?keyword=' . rawurlencode($query),
        'https://www.moomoo.com/search/quote?keyword=' . rawurlencode('US.' . $query),
        'https://www.moomoo.com/quote-api/search?keyword=' . rawurlencode($query),
        'https://www.moomoo.com/api/search/quote?keyword=' . rawurlencode($query),
    );

    $rows = array();
    foreach ($urls as $url) {
        $body = sml_members_moomoo_fetch_resolver_url($url, sml_members_clean_symbol($query) ?: 'SPY');
        if (!$body) {
            continue;
        }
        foreach (sml_members_extract_ticker_rows($body, $query) as $row) {
            $rows[] = $row;
        }
        $rows = sml_members_unique_ticker_rows($rows);
        if (count($rows) >= $limit) {
            break;
        }
    }

    $rows = array_slice($rows, 0, $limit);
    set_transient($cache_key, $rows, 15 * MINUTE_IN_SECONDS);
    return $rows;
}

function sml_members_extract_ticker_rows($body, $query) {
    $rows = array();
    $variants = array_values(array_unique(array(
        (string) $body,
        html_entity_decode((string) $body, ENT_QUOTES, 'UTF-8'),
        stripslashes((string) $body),
        stripslashes(html_entity_decode((string) $body, ENT_QUOTES, 'UTF-8')),
    )));

    foreach ($variants as $candidate) {
        $json = json_decode($candidate, true);
        if (is_array($json)) {
            $rows = array_merge($rows, sml_members_extract_ticker_rows_from_array($json));
        }
        if (preg_match_all('/"code"\s*:\s*"US\.([A-Z0-9.]{1,8})"(?:(?!"code").){0,900}?"name"\s*:\s*"([^"]{1,120})"/is', $candidate, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $rows[] = sml_members_ticker_row(array(
                    'symbol' => $match[1],
                    'code' => 'US.' . $match[1],
                    'name' => $match[2],
                    'type' => 'STOCK',
                    'source' => 'Moomoo search',
                    'verified' => true,
                ));
            }
        }
    }

    return sml_members_unique_ticker_rows($rows);
}

function sml_members_extract_ticker_rows_from_array($data) {
    $rows = array();
    $stack = array($data);
    while ($stack) {
        $item = array_pop($stack);
        if (!is_array($item)) {
            continue;
        }

        $code = '';
        foreach (array('code', 'stock_code', 'stockCode', 'security_code', 'securityCode', 'symbol') as $key) {
            if (!empty($item[$key])) {
                $code = strtoupper((string) $item[$key]);
                break;
            }
        }

        $symbol = '';
        if (strpos($code, 'US.') === 0) {
            $symbol = substr($code, 3);
        } elseif (preg_match('/^[A-Z0-9.]{1,8}$/', $code)) {
            $symbol = $code;
            $code = 'US.' . $symbol;
        }

        if ($symbol) {
            $name = '';
            foreach (array('name', 'stock_name', 'stockName', 'security_name', 'securityName') as $key) {
                if (!empty($item[$key])) {
                    $name = (string) $item[$key];
                    break;
                }
            }
            $type = (string) ($item['sec_type'] ?? $item['secType'] ?? $item['type'] ?? 'STOCK');
            $rows[] = sml_members_ticker_row(array(
                'symbol' => $symbol,
                'code' => $code,
                'name' => $name ?: $symbol . ' stock',
                'type' => $type,
                'source' => 'Moomoo search',
                'verified' => true,
            ));
        }

        foreach ($item as $value) {
            if (is_array($value)) {
                $stack[] = $value;
            }
        }
    }
    return $rows;
}

function sml_members_rest_get_moomoo_feed(WP_REST_Request $request) {
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
    if (!$symbol) {
        return new WP_Error('sml_bad_symbol', 'Ticker symbol required.', array('status' => 400));
    }

    $mode = sanitize_key((string) $request->get_param('mode'));
    $mode = in_array($mode, array('hot', 'top', 'recommended'), true) ? 'hot' : 'newest';

    $live = sml_members_moomoo_live_feed($symbol, $mode);
    if (!is_wp_error($live) && (!empty($live['posts']) || !empty($live['needs_stock_id']))) {
        return $live;
    }

    $manual_posts = sml_members_moomoo_manual_posts($symbol);
    if (!empty($manual_posts)) {
        return array(
            'symbol' => $symbol,
            'connected' => true,
            'readonly' => true,
            'can_reply' => false,
            'refresh_seconds' => 10,
            'posts' => $manual_posts,
            'community_url' => sml_members_moomoo_community_url($symbol),
            'message' => 'Moomoo feed loaded from approved connected source.',
        );
    }

    $message = is_wp_error($live)
        ? $live->get_error_message()
        : 'No Moomoo community posts were returned for this ticker yet.';

    return array(
        'symbol' => $symbol,
        'connected' => false,
        'readonly' => true,
        'can_reply' => false,
        'refresh_seconds' => 10,
        'posts' => array(),
        'needs_stock_id' => is_wp_error($live) && $live->get_error_code() === 'sml_no_moomoo_stock_id',
        'community_url' => sml_members_moomoo_community_url($symbol),
        'message' => $message,
    );
}

function sml_members_rest_get_webull_feed(WP_REST_Request $request) {
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
    if (!$symbol) {
        return new WP_Error('sml_bad_symbol', 'Ticker symbol required.', array('status' => 400));
    }

    $manual_posts = sml_members_webull_manual_posts($symbol);
    $live = sml_members_webull_public_feed($symbol);
    $live_posts = is_wp_error($live) ? array() : (array) ($live['posts'] ?? array());
    $posts = array_values(array_slice(array_merge($manual_posts, $live_posts), 0, 40));

    $message = 'Webull ticker panel is ready. Connect an approved Webull/community feed or imported items to show live community posts.';
    if (!empty($posts)) {
        $message = !empty($manual_posts)
            ? 'Webull panel loaded approved community imports and public ticker-source items.'
            : 'Webull panel loaded public ticker-source items from the Webull quote page.';
    } elseif (is_wp_error($live)) {
        $message = $live->get_error_message();
    }

    return array(
        'symbol' => $symbol,
        'connected' => !empty($posts),
        'readonly' => true,
        'can_reply' => false,
        'refresh_seconds' => 10,
        'source' => 'Webull',
        'posts' => $posts,
        'community_url' => sml_members_webull_community_url($symbol),
        'quote_url' => sml_members_webull_quote_url($symbol),
        'message' => $message,
    );
}

function sml_members_broker_connection_status($user_id) {
    $saved = get_user_meta($user_id, 'sml_broker_connections', true);
    $saved = is_array($saved) ? $saved : array();
    $status = array();

    foreach (array('moomoo' => 'Moomoo', 'webull' => 'Webull') as $key => $label) {
        $row = isset($saved[$key]) && is_array($saved[$key]) ? $saved[$key] : array();
        $connected = !empty($row['connected']) || !empty($row['access_token']) || !empty($row['account_id']);
        $status[$key] = array(
            'platform' => $key,
            'label' => $label,
            'connected' => (bool) $connected,
            'can_post' => (bool) (!empty($row['can_post']) || $connected),
            'can_reply' => (bool) (!empty($row['can_reply']) || $connected),
            'display_name' => sanitize_text_field((string) ($row['display_name'] ?? '')),
            'connect_url' => esc_url_raw((string) ($row['connect_url'] ?? home_url('/my-profile/#broker-connections'))),
        );
    }

    return apply_filters('sml_members_broker_connection_status', $status, $user_id);
}

function sml_members_rest_get_broker_connections() {
    return array(
        'connections' => sml_members_broker_connection_status(get_current_user_id()),
        'message' => 'Broker posting is ready for approved Moomoo/Webull OAuth or API connectors.',
    );
}

function sml_members_broker_targets($platform) {
    $platform = sanitize_key((string) $platform);
    if ($platform === 'both') {
        return array('moomoo', 'webull');
    }
    if (in_array($platform, array('moomoo', 'webull'), true)) {
        return array($platform);
    }
    return array();
}

function sml_members_store_broker_outbox_item($user_id, $item) {
    $rows = get_user_meta($user_id, 'sml_broker_outbox', true);
    $rows = is_array($rows) ? $rows : array();
    array_unshift($rows, $item);
    update_user_meta($user_id, 'sml_broker_outbox', array_slice($rows, 0, 80));
}

function sml_members_rest_broker_post(WP_REST_Request $request) {
    $user_id = get_current_user_id();
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
    $text = sml_members_clean_stream_text((string) $request->get_param('text'));
    $targets = sml_members_broker_targets((string) $request->get_param('platform'));
    $action = sanitize_key((string) $request->get_param('action'));
    $action = $action === 'reply' ? 'reply' : 'post';

    if (!$symbol) {
        return new WP_Error('sml_bad_symbol', 'Ticker symbol required.', array('status' => 400));
    }
    if (!$text) {
        return new WP_Error('sml_empty_broker_post', 'Write a reply or post before sending.', array('status' => 400));
    }
    if (strlen($text) > 700) {
        return new WP_Error('sml_broker_post_long', 'Keep broker replies under 700 characters.', array('status' => 400));
    }
    if (!$targets) {
        return new WP_Error('sml_bad_broker_platform', 'Choose Moomoo, Webull, or both broker platforms.', array('status' => 400));
    }

    $parent = array(
        'id' => sanitize_text_field((string) $request->get_param('parent_id')),
        'source_url' => esc_url_raw((string) $request->get_param('parent_source_url')),
        'source_name' => sanitize_text_field((string) $request->get_param('parent_source_name')),
    );
    $connections = sml_members_broker_connection_status($user_id);
    $results = array();
    $posted = false;
    $queued = false;

    foreach ($targets as $target) {
        $connected = !empty($connections[$target]['connected']) && (($action === 'reply' && !empty($connections[$target]['can_reply'])) || ($action === 'post' && !empty($connections[$target]['can_post'])));
        $payload = array(
            'platform' => $target,
            'action' => $action,
            'symbol' => $symbol,
            'text' => $text,
            'parent' => $parent,
            'user_id' => $user_id,
            'created_at' => current_time('mysql', true),
        );

        if (!$connected) {
            $item = array_merge($payload, array('status' => 'needs_connection'));
            sml_members_store_broker_outbox_item($user_id, $item);
            $queued = true;
            $results[$target] = array(
                'status' => 'needs_connection',
                'sent' => false,
                'message' => ($connections[$target]['label'] ?? ucfirst($target)) . ' is not connected for direct website posting yet.',
                'connect_url' => $connections[$target]['connect_url'] ?? home_url('/my-profile/#broker-connections'),
            );
            continue;
        }

        $published = apply_filters('sml_members_broker_publish_result', null, $target, $payload, $user_id);
        if (is_array($published) && !empty($published['sent'])) {
            $posted = true;
            $results[$target] = array_merge(array('status' => 'sent', 'sent' => true), $published);
            continue;
        }

        $item = array_merge($payload, array('status' => 'queued'));
        sml_members_store_broker_outbox_item($user_id, $item);
        $queued = true;
        $results[$target] = array(
            'status' => 'queued',
            'sent' => false,
            'message' => ($connections[$target]['label'] ?? ucfirst($target)) . ' is connected, but the approved publishing connector has not returned a sent confirmation yet.',
        );
    }

    return array(
        'ok' => true,
        'sent' => $posted,
        'queued' => $queued,
        'action' => $action,
        'symbol' => $symbol,
        'results' => $results,
        'message' => $posted
            ? 'Broker platform post sent.'
            : 'Broker reply/post saved. Connect the approved Moomoo/Webull posting connector before it can publish externally.',
    );
}

function sml_members_rest_get_moomoo_stock_id(WP_REST_Request $request) {
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
    if (!$symbol) {
        return new WP_Error('sml_bad_symbol', 'Ticker symbol required.', array('status' => 400));
    }

    if ((string) $request->get_param('force') === '1') {
        delete_transient('sml_moomoo_id_' . strtolower($symbol));
    }

    $stock_id = sml_members_moomoo_stock_id($symbol);
    return array(
        'symbol' => $symbol,
        'stock_id' => $stock_id,
        'resolved' => (bool) $stock_id,
        'community_url' => sml_members_moomoo_community_url($symbol),
        'message' => $stock_id
            ? 'Moomoo community stock ID resolved and cached.'
            : 'Moomoo community stock ID is still resolving. The page will keep retrying and can use the public community link meanwhile.',
    );
}

function sml_members_rest_save_moomoo_stock_id(WP_REST_Request $request) {
    $map = $request->get_param('map');
    if (!is_array($map)) {
        $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
        $stock_id = preg_replace('/[^0-9]/', '', (string) $request->get_param('stock_id'));
        $map = ($symbol && $stock_id) ? array($symbol => $stock_id) : array();
    }

    if (empty($map)) {
        return new WP_Error('sml_moomoo_bad_map', 'Send symbol and stock_id, or a map of ticker IDs.', array('status' => 400));
    }

    $saved = sml_members_moomoo_saved_stock_ids();
    $updated = array();
    foreach ($map as $symbol => $stock_id) {
        $symbol = sml_members_clean_symbol((string) $symbol);
        $stock_id = preg_replace('/[^0-9]/', '', (string) $stock_id);
        if (!$symbol || !$stock_id) {
            continue;
        }
        $saved[$symbol] = $stock_id;
        $updated[$symbol] = $stock_id;
        delete_transient('sml_moomoo_id_' . strtolower($symbol));
    }

    if (empty($updated)) {
        return new WP_Error('sml_moomoo_empty_map', 'No valid ticker IDs were provided.', array('status' => 400));
    }

    update_option('sml_moomoo_stock_ids', $saved, false);

    return array(
        'updated' => $updated,
        'count' => count($updated),
        'message' => 'Moomoo stock IDs saved.',
    );
}

function sml_members_moomoo_manual_posts($symbol) {
    $items = get_option('sml_moomoo_feed_items', array());
    $posts = array();
    if (is_array($items)) {
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $item_symbol = sml_members_clean_symbol($item['symbol'] ?? '');
            if ($item_symbol !== $symbol) {
                continue;
            }
            $posts[] = array(
                'id' => sanitize_text_field((string) ($item['id'] ?? uniqid('moomoo_', true))),
                'symbol' => $symbol,
                'moomoo_name' => sanitize_text_field((string) ($item['moomoo_name'] ?? 'Moomoo member')),
                'avatar_url' => esc_url_raw((string) ($item['avatar_url'] ?? '')),
                'profile_url' => esc_url_raw((string) ($item['profile_url'] ?? '')),
                'text' => sanitize_textarea_field((string) ($item['text'] ?? '')),
                'date' => sanitize_text_field((string) ($item['date'] ?? gmdate('c'))),
            );
            if (count($posts) >= 40) {
                break;
            }
        }
    }
    return $posts;
}

function sml_members_moomoo_live_feed($symbol, $mode = 'newest') {
    $stock_id = sml_members_moomoo_stock_id($symbol);
    if (!$stock_id) {
        return array(
            'symbol' => $symbol,
            'connected' => false,
            'readonly' => true,
            'can_reply' => false,
            'refresh_seconds' => 10,
            'source' => 'Moomoo community',
            'mode' => $mode,
            'stock_id' => '',
            'posts' => array(),
            'needs_stock_id' => true,
            'community_url' => sml_members_moomoo_community_url($symbol),
            'message' => 'Stockmarketloop is resolving the Moomoo community feed for $' . $symbol . '. The public Moomoo community page is linked while the internal feed ID is being mapped.'
        );
    }

    $type = $mode === 'hot' ? 501 : 500;
    $cache_key = 'sml_moomoo_feed_' . strtolower($symbol) . '_' . $type . '_' . preg_replace('/[^0-9]/', '', (string) $stock_id);
    $cached = get_transient($cache_key);
    if (is_array($cached)) {
        return $cached;
    }

    $url = add_query_arg(array(
        'stock_id' => $stock_id,
        'num' => 20,
        'more_mark' => '',
        'sequence' => '',
        'type' => $type,
        'load_list_type' => 2,
    ), 'https://www.moomoo.com/community/nnq/stock-feedlist2');

    $response = wp_remote_get($url, array(
        'timeout' => 8,
        'redirection' => 3,
        'headers' => array(
            'Accept' => 'application/json',
            'Referer' => 'https://www.moomoo.com/stock/' . rawurlencode($symbol) . '-US/community',
            'User-Agent' => 'Mozilla/5.0 Stockmarketloop/1.0',
            'x-futu-nnq-new-website' => 'nnq',
        ),
    ));

    if (is_wp_error($response)) {
        return $response;
    }

    $status = (int) wp_remote_retrieve_response_code($response);
    if ($status !== 200) {
        return new WP_Error('sml_moomoo_http', 'Moomoo community feed returned HTTP ' . $status . ' for $' . $symbol . '.');
    }

    $body = wp_remote_retrieve_body($response);
    $data = json_decode($body, true);
    if (!is_array($data)) {
        return new WP_Error('sml_moomoo_json', 'Moomoo community feed returned unreadable data for $' . $symbol . '.');
    }

    if (isset($data['code']) && (int) $data['code'] !== 0 && empty($data['feed'])) {
        return new WP_Error('sml_moomoo_params', 'Moomoo did not return community posts for $' . $symbol . '.');
    }

    $posts = array();
    $feed_items = isset($data['feed']) && is_array($data['feed']) ? $data['feed'] : array();
    foreach ($feed_items as $feed_item) {
        if (!is_array($feed_item)) {
            continue;
        }

        $post = sml_members_moomoo_post_from_feed_item($feed_item, $symbol);
        if ($post) {
            $posts[] = $post;
        }

        $comments = array();
        if (!empty($feed_item['comment_items']) && is_array($feed_item['comment_items'])) {
            $comments = $feed_item['comment_items'];
        } elseif (!empty($feed_item['comment']['comment_items']) && is_array($feed_item['comment']['comment_items'])) {
            $comments = $feed_item['comment']['comment_items'];
        }

        foreach (array_slice($comments, 0, 4) as $comment) {
            $reply = sml_members_moomoo_post_from_comment($comment, $symbol);
            if ($reply) {
                $posts[] = $reply;
            }
            if (count($posts) >= 40) {
                break 2;
            }
        }

        if (count($posts) >= 40) {
            break;
        }
    }

    $payload = array(
        'symbol' => $symbol,
        'connected' => !empty($posts),
        'readonly' => true,
        'can_reply' => false,
        'refresh_seconds' => 10,
        'source' => 'Moomoo community',
        'mode' => $mode,
        'stock_id' => (string) $stock_id,
        'community_url' => sml_members_moomoo_community_url($symbol),
        'posts' => $posts,
        'message' => empty($posts)
            ? 'Moomoo community feed returned no public posts for this ticker yet.'
            : 'Live Moomoo community feed loaded read-only from the public ticker community source.',
    );

    set_transient($cache_key, $payload, 10);
    return $payload;
}

function sml_members_moomoo_seed_stock_ids() {
    return array(
        'AAPL' => '205189',
        'AMC' => '201455',
        'AMD' => '205816',
        'AMZN' => '205111',
        'AVAV' => '202398',
        'AVGO' => '201429',
        'GME' => '201025',
        'MSFT' => '201345',
        'MU' => '206117',
        'NVDA' => '202597',
        'PLTR' => '79512729769513',
        'QQQ' => '203290',
        'SPY' => '202805',
        'TSLA' => '201335',
    );
}

function sml_members_moomoo_stock_id_map() {
    $map = array_merge(sml_members_moomoo_seed_stock_ids(), sml_members_moomoo_saved_stock_ids());
    $clean = array();
    foreach ($map as $symbol => $stock_id) {
        $symbol = sml_members_clean_symbol((string) $symbol);
        $stock_id = preg_replace('/[^0-9]/', '', (string) $stock_id);
        if ($symbol && $stock_id) {
            $clean[$symbol] = $stock_id;
        }
    }

    return apply_filters('sml_moomoo_stock_id_map', $clean);
}

function sml_members_moomoo_saved_stock_ids() {
    $saved = get_option('sml_moomoo_stock_ids', array());
    if (is_string($saved)) {
        $decoded = json_decode($saved, true);
        $saved = is_array($decoded) ? $decoded : array();
    }
    return is_array($saved) ? $saved : array();
}

function sml_members_moomoo_stock_id($symbol) {
    static $runtime = array();

    $symbol = sml_members_clean_symbol($symbol);
    if (!$symbol) {
        return '';
    }

    if (array_key_exists($symbol, $runtime)) {
        return $runtime[$symbol];
    }

    $map = sml_members_moomoo_stock_id_map();
    if (!empty($map[$symbol])) {
        $runtime[$symbol] = $map[$symbol];
        return $runtime[$symbol];
    }

    $resolved = sml_members_moomoo_resolve_stock_id_from_search($symbol);
    if ($resolved) {
        $saved = sml_members_moomoo_saved_stock_ids();
        $saved[$symbol] = $resolved;
        update_option('sml_moomoo_stock_ids', $saved, false);
    }

    $runtime[$symbol] = $resolved;
    return $resolved;
}

function sml_members_moomoo_resolve_stock_id_from_search($symbol) {
    $symbol = sml_members_clean_symbol($symbol);
    if (!$symbol) {
        return '';
    }

    $cache_key = 'sml_moomoo_id_' . strtolower($symbol);
    $cached = get_transient($cache_key);
    if (is_string($cached)) {
        return $cached;
    }

    foreach (sml_members_moomoo_resolver_urls($symbol) as $url) {
        $body = sml_members_moomoo_fetch_resolver_url($url, $symbol);
        if (!$body) {
            continue;
        }
        $stock_id = sml_members_moomoo_extract_stock_id($body, $symbol);
        if ($stock_id) {
            set_transient($cache_key, $stock_id, 30 * DAY_IN_SECONDS);
            return $stock_id;
        }
    }

    set_transient($cache_key, '', HOUR_IN_SECONDS);
    return '';
}

function sml_members_moomoo_resolver_urls($symbol) {
    $symbol = sml_members_clean_symbol($symbol);
    $q = rawurlencode($symbol);
    return array_values(array_unique(array(
        'https://www.moomoo.com/stock/' . rawurlencode($symbol . '-US'),
        'https://www.moomoo.com/stock/' . rawurlencode($symbol . '-US') . '/community',
        'https://www.moomoo.com/us/stock/' . rawurlencode($symbol . '-US'),
        'https://www.moomoo.com/us/stock/' . rawurlencode($symbol . '-US') . '/community',
        'https://www.moomoo.com/hans/stock/' . rawurlencode($symbol . '-US'),
        'https://www.moomoo.com/hans/stock/' . rawurlencode($symbol . '-US') . '/community',
        'https://www.moomoo.com/hant/stock/' . rawurlencode($symbol . '-US'),
        'https://www.moomoo.com/hant/stock/' . rawurlencode($symbol . '-US') . '/community',
        'https://www.futunn.com/en/stock/' . rawurlencode($symbol . '-US'),
        'https://www.futunn.com/en/stock/' . rawurlencode($symbol . '-US') . '/community',
        'https://www.futunn.com/stock/' . rawurlencode($symbol . '-US'),
        'https://www.futunn.com/stock/' . rawurlencode($symbol . '-US') . '/community',
        'https://www.moomoo.com/search/quote?keyword=' . $q,
        'https://www.moomoo.com/search/quote?keyword=' . rawurlencode('US.' . $symbol),
        'https://www.moomoo.com/search/quote?keyword=' . rawurlencode($symbol . '-US'),
        'https://www.moomoo.com/quote-api/search?keyword=' . $q,
        'https://www.moomoo.com/quote-api/search?keyword=' . rawurlencode('US.' . $symbol),
        'https://www.moomoo.com/api/search/quote?keyword=' . $q,
        'https://www.moomoo.com/api/search/quote?keyword=' . rawurlencode('US.' . $symbol),
    )));
}

function sml_members_moomoo_fetch_resolver_url($url, $symbol) {
    $response = wp_remote_get($url, array(
        'timeout' => 10,
        'redirection' => 4,
        'headers' => array(
            'Accept' => 'application/json,text/html,application/xhtml+xml',
            'Accept-Language' => 'en-US,en;q=0.9',
            'Referer' => sml_members_moomoo_community_url($symbol),
            'User-Agent' => 'Mozilla/5.0 (compatible; Stockmarketloop/1.0; +https://stockmarketloop.com)',
            'x-futu-nnq-new-website' => 'nnq',
        ),
    ));

    if (is_wp_error($response)) {
        return '';
    }

    $status = (int) wp_remote_retrieve_response_code($response);
    if ($status < 200 || $status >= 300) {
        return '';
    }

    return (string) wp_remote_retrieve_body($response);
}

function sml_members_moomoo_extract_stock_id($body, $symbol) {
    $symbol = sml_members_clean_symbol($symbol);
    if (!$symbol || !is_string($body) || $body === '') {
        return '';
    }

    $bodies = array_values(array_unique(array(
        $body,
        html_entity_decode($body, ENT_QUOTES, 'UTF-8'),
        stripslashes($body),
        stripslashes(html_entity_decode($body, ENT_QUOTES, 'UTF-8')),
    )));

    foreach ($bodies as $candidate_body) {
        $json = json_decode($candidate_body, true);
        if (is_array($json)) {
            $stock_id = sml_members_moomoo_find_stock_id_in_array($json, $symbol);
            if ($stock_id) {
                return $stock_id;
            }
        }

        $stock_id = sml_members_moomoo_extract_stock_id_from_text($candidate_body, $symbol);
        if ($stock_id) {
            return $stock_id;
        }
    }

    return '';
}

function sml_members_moomoo_find_stock_id_in_array($data, $symbol) {
    if (!is_array($data)) {
        return '';
    }

    $symbol = sml_members_clean_symbol($symbol);
    $symbol_keys = array('stock_code', 'stockCode', 'code', 'symbol', 'ticker', 'security_code', 'securityCode');
    $id_keys = array('stock_id', 'stockId', 'security_id', 'securityId', 'sec_id', 'secId', 'id');
    $stack = array($data);

    while ($stack) {
        $item = array_pop($stack);
        if (!is_array($item)) {
            continue;
        }

        $matches_symbol = false;
        foreach ($symbol_keys as $key) {
            if (!array_key_exists($key, $item)) {
                continue;
            }
            $value = strtoupper((string) $item[$key]);
            $value = str_replace(array('US.', '-US', '.US'), '', $value);
            if (sml_members_clean_symbol($value) === $symbol) {
                $matches_symbol = true;
                break;
            }
        }

        if ($matches_symbol) {
            foreach ($id_keys as $key) {
                if (!empty($item[$key])) {
                    $stock_id = preg_replace('/[^0-9]/', '', (string) $item[$key]);
                    if (preg_match('/^[0-9]{4,20}$/', $stock_id)) {
                        return $stock_id;
                    }
                }
            }
        }

        foreach ($item as $value) {
            if (is_array($value)) {
                $stack[] = $value;
            }
        }
    }

    return '';
}

function sml_members_moomoo_extract_stock_id_from_text($body, $symbol) {
    $quoted_symbol = preg_quote($symbol, '/');
    $symbol_value = '(?:US\\.)?' . $quoted_symbol . '(?:-US|\\.US)?';
    $code_keys = '(?:"stock_code"|"stockCode"|"security_code"|"securityCode"|"code"|"symbol"|"ticker")';
    $id_keys = '(?:"stock_id"|"stockId"|"security_id"|"securityId"|"sec_id"|"secId")';

    $patterns = array(
        '/' . $code_keys . '\\s*:\\s*"' . $symbol_value . '"[^{}]{0,3000}?' . $id_keys . '\\s*:\\s*"?([0-9]{4,20})"?/is',
        '/' . $id_keys . '\\s*:\\s*"?([0-9]{4,20})"?[^{}]{0,3000}?' . $code_keys . '\\s*:\\s*"' . $symbol_value . '"/is',
        '/(?:stock_id|stock-id|stockid)\\s*=\\s*"([0-9]{4,20})"[^<>]{0,1600}?(?:stockcode|stock-code|stocksymbol|symbol)\\s*=\\s*"(?:' . $quoted_symbol . '|(?:' . $quoted_symbol . '\\.US)|(?:' . $quoted_symbol . '-US))"/is',
        '/(?:stockcode|stock-code|stocksymbol|symbol)\\s*=\\s*"(?:' . $quoted_symbol . '|(?:' . $quoted_symbol . '\\.US)|(?:' . $quoted_symbol . '-US))"[^<>]{0,1600}?(?:stock_id|stock-id|stockid)\\s*=\\s*"([0-9]{4,20})"/is',
        '/\\/stock\\/' . $quoted_symbol . '-US[^"\'<]{0,800}(?:stock_id|stockId)=([0-9]{4,20})/i',
        '/(?:stock_id|stockId)=([0-9]{4,20})[^"\'<]{0,800}\\/stock\\/' . $quoted_symbol . '-US/i',
    );

    foreach ($patterns as $pattern) {
        if (preg_match($pattern, $body, $matches) && !empty($matches[1])) {
            return preg_replace('/[^0-9]/', '', $matches[1]);
        }
    }

    return '';
}

function sml_members_moomoo_community_url($symbol) {
    $symbol = sml_members_clean_symbol($symbol);
    return esc_url_raw('https://www.moomoo.com/stock/' . rawurlencode($symbol . '-US') . '/community');
}

function sml_members_moomoo_author_avatar_url($author) {
    if (!is_array($author)) {
        return '';
    }

    foreach (array('avatar_url', 'avator_url', 'avatar', 'head_img', 'head_image', 'profile_image', 'portrait', 'icon', 'user_pic') as $key) {
        if (!empty($author[$key]) && is_scalar($author[$key])) {
            $url = esc_url_raw((string) $author[$key]);
            if ($url) {
                return $url;
            }
        }
    }

    foreach (array('avatar_info', 'profile', 'image', 'user_avatar') as $key) {
        if (!empty($author[$key]) && is_array($author[$key])) {
            $url = sml_members_moomoo_author_avatar_url($author[$key]);
            if ($url) {
                return $url;
            }
        }
    }

    return '';
}

function sml_members_moomoo_post_from_feed_item($feed_item, $symbol) {
    $author = isset($feed_item['author_info']) && is_array($feed_item['author_info']) ? $feed_item['author_info'] : array();
    if (empty($author) && isset($feed_item['user_info']) && is_array($feed_item['user_info'])) {
        $author = $feed_item['user_info'];
    }

    $rich_text = array();
    if (!empty($feed_item['summary']['rich_text']) && is_array($feed_item['summary']['rich_text'])) {
        $rich_text = $feed_item['summary']['rich_text'];
    }

    $text = sml_members_moomoo_rich_text_to_text($rich_text);
    $title = '';
    if (!empty($feed_item['feed_title'])) {
        $title = sanitize_text_field((string) $feed_item['feed_title']);
    } elseif (!empty($feed_item['common']['feed_title'])) {
        $title = sanitize_text_field((string) $feed_item['common']['feed_title']);
    }
    if ($title && stripos($text, $title) === false) {
        $text = trim($title . ' - ' . $text);
    }

    if ($text === '') {
        return null;
    }

    $feed_comm = isset($feed_item['feed_comm']) && is_array($feed_item['feed_comm']) ? $feed_item['feed_comm'] : array();
    if (empty($feed_comm) && isset($feed_item['common']) && is_array($feed_item['common'])) {
        $feed_comm = $feed_item['common'];
    }

    $feed_id = sanitize_text_field((string) ($feed_comm['feed_id'] ?? uniqid('moomoo_', true)));
    $timestamp = $feed_comm['timestamp'] ?? ($feed_item['timestamp'] ?? '');

    return array(
        'id' => 'feed_' . $feed_id,
        'symbol' => $symbol,
        'moomoo_name' => sanitize_text_field((string) ($author['nick_name'] ?? 'Moomoo member')),
        'avatar_url' => sml_members_moomoo_author_avatar_url($author),
        'profile_url' => sml_members_moomoo_profile_url($author),
        'text' => $text,
        'date' => sml_members_moomoo_iso_date($timestamp),
        'source_url' => 'https://www.moomoo.com/community/feed/' . rawurlencode($feed_id),
        'source_type' => 'post',
    );
}

function sml_members_moomoo_post_from_comment($comment, $symbol) {
    if (!is_array($comment)) {
        return null;
    }

    $author = isset($comment['author']) && is_array($comment['author']) ? $comment['author'] : array();
    $rich_text = array();
    if (!empty($comment['rich_text_items']) && is_array($comment['rich_text_items'])) {
        $rich_text = $comment['rich_text_items'];
    }

    $text = sml_members_moomoo_rich_text_to_text($rich_text);
    if ($text === '') {
        return null;
    }

    $comment_id = sanitize_text_field((string) ($comment['comment_id'] ?? uniqid('moomoo_comment_', true)));
    return array(
        'id' => 'comment_' . $comment_id,
        'symbol' => $symbol,
        'moomoo_name' => sanitize_text_field((string) ($author['nick_name'] ?? 'Moomoo member')),
        'avatar_url' => sml_members_moomoo_author_avatar_url($author),
        'profile_url' => sml_members_moomoo_profile_url($author),
        'text' => $text,
        'date' => sml_members_moomoo_iso_date($comment['timestamp'] ?? ''),
        'source_url' => 'https://www.moomoo.com/community/comment/' . rawurlencode($comment_id),
        'source_type' => 'reply',
    );
}

function sml_members_moomoo_rich_text_to_text($items) {
    if (!is_array($items)) {
        return '';
    }

    $parts = array();
    foreach ($items as $item) {
        if (!is_array($item)) {
            continue;
        }

        if (array_key_exists('text', $item)) {
            $parts[] = (string) $item['text'];
            continue;
        }

        if (!empty($item['stock']) && is_array($item['stock'])) {
            $stock = $item['stock'];
            $stock_code = sml_members_clean_symbol((string) ($stock['stock_code'] ?? ''));
            if (!$stock_code && !empty($stock['display_symbol'])) {
                $stock_code = sml_members_clean_symbol(strtok((string) $stock['display_symbol'], '.'));
            }
            if ($stock_code) {
                $parts[] = '$' . $stock_code;
            }
            continue;
        }

        if (!empty($item['text_link']['text'])) {
            $parts[] = (string) $item['text_link']['text'];
        }
    }

    $text = implode(' ', $parts);
    $text = preg_replace('/<br\s*\/?>/i', ' ', $text);
    $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = wp_strip_all_tags($text);
    $text = trim(preg_replace('/\s+/', ' ', $text));
    return substr(sanitize_textarea_field($text), 0, 900);
}

function sml_members_moomoo_profile_url($author) {
    if (!is_array($author) || empty($author['user_id'])) {
        return '';
    }
    return esc_url_raw('https://www.moomoo.com/community/profile/' . rawurlencode((string) $author['user_id']));
}

function sml_members_moomoo_iso_date($timestamp) {
    $timestamp = is_numeric($timestamp) ? (int) $timestamp : 0;
    if ($timestamp <= 0) {
        return gmdate('c');
    }
    return gmdate('c', $timestamp);
}

function sml_members_webull_manual_posts($symbol) {
    $symbol = sml_members_clean_symbol($symbol);
    $items = get_option('sml_webull_feed_items', array());
    $posts = array();
    if (is_array($items)) {
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $item_symbol = sml_members_clean_symbol($item['symbol'] ?? '');
            if ($item_symbol !== $symbol) {
                continue;
            }
            $text = sanitize_textarea_field((string) ($item['text'] ?? ''));
            $posts[] = array(
                'id' => sanitize_text_field((string) ($item['id'] ?? uniqid('webull_', true))),
                'symbol' => $symbol,
                'webull_name' => sanitize_text_field((string) ($item['webull_name'] ?? $item['source_name'] ?? 'Webull community')),
                'avatar_url' => esc_url_raw((string) ($item['avatar_url'] ?? '')),
                'profile_url' => esc_url_raw((string) ($item['profile_url'] ?? '')),
                'text' => $text,
                'hashtags' => sml_members_extract_hashtags($text),
                'date' => sanitize_text_field((string) ($item['date'] ?? gmdate('c'))),
                'source_url' => esc_url_raw((string) ($item['source_url'] ?? sml_members_webull_quote_url($symbol))),
                'source_type' => sanitize_key((string) ($item['source_type'] ?? 'community')),
            );
            if (count($posts) >= 40) {
                break;
            }
        }
    }
    return $posts;
}

function sml_members_webull_public_feed($symbol) {
    $symbol = sml_members_clean_symbol($symbol);
    if (!$symbol) {
        return new WP_Error('sml_bad_symbol', 'Ticker symbol required.');
    }

    $cache_key = 'sml_webull_feed_' . strtolower($symbol);
    $cached = get_transient($cache_key);
    if (is_array($cached)) {
        return $cached;
    }

    $quote_url = sml_members_webull_quote_url($symbol);
    $response = wp_remote_get($quote_url, array(
        'timeout' => 8,
        'redirection' => 3,
        'headers' => array(
            'Accept' => 'text/html,application/xhtml+xml',
            'Accept-Language' => 'en-US,en;q=0.9',
            'Referer' => 'https://www.webull.com/',
            'User-Agent' => 'Mozilla/5.0 (compatible; Stockmarketloop/1.0; +https://stockmarketloop.com)',
        ),
    ));

    if (is_wp_error($response)) {
        return $response;
    }

    $status = (int) wp_remote_retrieve_response_code($response);
    if ($status < 200 || $status >= 300) {
        return new WP_Error('sml_webull_http', 'Webull quote source returned HTTP ' . $status . ' for $' . $symbol . '.');
    }

    $posts = sml_members_webull_extract_news_posts(wp_remote_retrieve_body($response), $symbol, $quote_url);
    $payload = array(
        'symbol' => $symbol,
        'connected' => !empty($posts),
        'readonly' => true,
        'can_reply' => false,
        'refresh_seconds' => 10,
        'source' => 'Webull',
        'community_url' => sml_members_webull_community_url($symbol),
        'quote_url' => $quote_url,
        'posts' => $posts,
        'message' => empty($posts)
            ? 'No public Webull ticker-source items were detected yet. Approved Webull/community imports can still populate this panel.'
            : 'Public Webull ticker-source items loaded read-only with attribution.',
    );
    set_transient($cache_key, $payload, 30);
    return $payload;
}

function sml_members_webull_extract_news_posts($body, $symbol, $quote_url) {
    if (!is_string($body) || $body === '') {
        return array();
    }

    $symbol = sml_members_clean_symbol($symbol);
    $body = preg_replace('/<script\b[^>]*>.*?<\/script>/is', ' ', $body);
    $body = preg_replace('/<style\b[^>]*>.*?<\/style>/is', ' ', $body);
    $text = html_entity_decode(wp_strip_all_tags($body), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = preg_replace('/\s+/', ' ', $text);
    $sources = 'Reuters|Benzinga|Seeking Alpha|TipRanks|Dow Jones|MarketWatch|CNBC|Zacks|The Motley Fool|InvestorPlace|NASDAQ|Simply Wall St|MT Newswires|PR Newswire|Business Wire';
    $pattern = '/([A-Z0-9][A-Za-z0-9$%.,:;\'"()\/&+\-\s]{24,180}?)\s+(' . $sources . ')\s*(?:\||-)?\s*([0-9]{1,2}[hdwmy]\s+ago|[A-Za-z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{4}|Today|Yesterday)?/i';
    $posts = array();
    $seen = array();
    if (preg_match_all($pattern, $text, $matches, PREG_SET_ORDER)) {
        foreach ($matches as $match) {
            $headline = trim(preg_replace('/\s+/', ' ', (string) $match[1]));
            $headline = preg_replace('/^(News|Press Releases|Financials|Options|Profile|Chart|Community)\s+/i', '', $headline);
            if (strlen($headline) < 20 || preg_match('/^(Webull|Markets|Stocks|Options|News|Learn|Pricing)\b/i', $headline)) {
                continue;
            }
            $key = strtolower($headline);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $source = sanitize_text_field((string) $match[2]);
            $time_label = sanitize_text_field((string) ($match[3] ?? ''));
            $text_row = '$' . $symbol . ' Webull source: ' . $headline;
            $posts[] = array(
                'id' => 'webull_news_' . md5($symbol . '|' . $headline),
                'symbol' => $symbol,
                'webull_name' => $source ?: 'Webull ticker source',
                'avatar_url' => '',
                'profile_url' => '',
                'text' => sanitize_textarea_field($text_row),
                'hashtags' => sml_members_extract_hashtags($text_row),
                'date' => gmdate('c'),
                'time_label' => $time_label,
                'source_url' => esc_url_raw($quote_url),
                'source_type' => 'news',
            );
            if (count($posts) >= 20) {
                break;
            }
        }
    }
    return $posts;
}

function sml_members_webull_quote_url($symbol) {
    $slug = sml_members_webull_quote_slug($symbol);
    return esc_url_raw('https://www.webull.com/quote/' . $slug);
}

function sml_members_webull_community_url($symbol) {
    return sml_members_webull_quote_url($symbol);
}

function sml_members_webull_quote_slug($symbol) {
    $symbol = strtolower(sml_members_clean_symbol($symbol));
    if (!$symbol) {
        return 'nasdaq-nvda';
    }

    $exchange = strtolower(sml_members_guess_exchange($symbol));
    if ($exchange === 'amex') {
        $exchange = 'nysearca';
    } elseif ($exchange === 'nyse' || $exchange === 'nasdaq') {
        // Webull quote URLs use lowercase exchange prefixes.
    } else {
        $exchange = 'nasdaq';
    }

    return $exchange . '-' . $symbol;
}

function sml_members_rest_get_trending_tickers() {
    return array(
        'refresh_seconds' => 5,
        'generated_at' => gmdate('c'),
        'tickers' => sml_members_trending_tickers(25),
        'message' => 'Top 25 Stockmarketloop trending ticker tape refreshes every 5 seconds.',
    );
}

function sml_members_rest_get_trending_posts(WP_REST_Request $request) {
    $limit = max(1, min(20, absint($request->get_param('limit')) ?: 10));
    $hours = max(1, min(72, absint($request->get_param('hours')) ?: 24));
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));

    return array(
        'refresh_seconds' => 60,
        'window_hours' => $hours,
        'symbol' => $symbol,
        'generated_at' => gmdate('c'),
        'posts' => sml_members_trending_posts($limit, $hours, $symbol),
        'message' => 'Top posts rank by upvotes minus downvotes inside the rolling window.',
    );
}

function sml_members_rest_get_loop_bucks() {
    $user_id = get_current_user_id();
    sml_members_maybe_award_referral_rewards($user_id);
    return array(
        'balance' => sml_members_loop_bucks_balance($user_id),
        'currency' => 'Loop Bucks',
        'non_redeemable' => true,
        'credit_price_cents' => SML_LOOP_CREDIT_CENTS,
        'service_fee_bps' => SML_LOOP_SERVICE_FEE_BPS,
        'tax_cents' => 0,
        'pricing' => sml_members_loop_purchase_quote(100),
        'online_seconds' => (int) get_user_meta($user_id, 'sml_online_seconds', true),
        'referral' => sml_members_referral_payload($user_id),
        'purchase_enabled' => false,
        'purchase_message' => 'Loop Bucks quotes are active: 1 credit costs $0.01, tax is $0.00, and a 2% service fee is added. Checkout, payouts, and cash-value betting stay disabled until payment, legal, and compliance review is complete.',
        'challenges' => sml_members_loop_public_challenges($user_id),
    );
}

function sml_members_rest_create_loop_challenge(WP_REST_Request $request) {
    $user_id = get_current_user_id();
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
    $mode = sanitize_key((string) $request->get_param('mode'));
    $stake = absint($request->get_param('stake'));
    $duration = absint($request->get_param('duration_minutes'));
    $prediction = sml_members_clean_loop_prediction((string) $request->get_param('prediction'), $mode);
    $title = sanitize_text_field((string) $request->get_param('title'));

    if (!$symbol || !in_array($mode, array('direction', 'percent_gain', 'prediction_count'), true)) {
        return new WP_Error('sml_bad_loop_challenge', 'Choose a valid ticker and prediction type.', array('status' => 400));
    }
    if ($stake < 1 || $stake > 10000) {
        return new WP_Error('sml_bad_loop_stake', 'Loop Bucks stake must be between 1 and 10,000.', array('status' => 400));
    }
    if ($duration < 5 || $duration > 10080) {
        return new WP_Error('sml_bad_loop_duration', 'Prediction channel time must be between 5 minutes and 7 days.', array('status' => 400));
    }
    if ($prediction === '') {
        return new WP_Error('sml_bad_loop_prediction', 'Enter your prediction before opening the channel.', array('status' => 400));
    }
    if (sml_members_loop_bucks_balance($user_id) < $stake) {
        return new WP_Error('sml_loop_low_balance', 'You do not have enough Loop Bucks for that stake.', array('status' => 400));
    }

    $challenges = sml_members_loop_challenges();
    $id = 'loop_' . wp_generate_uuid4();
    $now = time();
    $challenges[$id] = array(
        'id' => $id,
        'symbol' => $symbol,
        'title' => $title ?: '$' . $symbol . ' prediction channel',
        'mode' => $mode,
        'stake' => $stake,
        'creator_id' => $user_id,
        'created_at' => $now,
        'closes_at' => $now + ($duration * MINUTE_IN_SECONDS),
        'status' => 'open',
        'settled' => false,
        'entries' => array(
            $user_id => array(
                'user_id' => $user_id,
                'handle' => sml_members_handle($user_id),
                'prediction' => $prediction,
                'stake' => $stake,
                'created_at' => $now,
            ),
        ),
    );

    sml_members_loop_bucks_adjust($user_id, -$stake, 'Opened prediction channel ' . $id);
    update_option('sml_loop_challenges', $challenges, false);

    return array(
        'created' => true,
        'balance' => sml_members_loop_bucks_balance($user_id),
        'challenge' => sml_members_loop_public_challenge($challenges[$id], $user_id),
        'message' => 'Prediction channel opened with non-redeemable Loop Bucks.',
    );
}

function sml_members_rest_join_loop_challenge(WP_REST_Request $request) {
    $user_id = get_current_user_id();
    $id = sanitize_text_field((string) $request->get_param('id'));
    $prediction = '';
    $challenges = sml_members_loop_challenges();

    if (empty($challenges[$id]) || !is_array($challenges[$id])) {
        return new WP_Error('sml_loop_missing', 'That prediction channel was not found.', array('status' => 404));
    }

    $challenge = $challenges[$id];
    $mode = sanitize_key((string) ($challenge['mode'] ?? 'direction'));
    $prediction = sml_members_clean_loop_prediction((string) $request->get_param('prediction'), $mode);
    $stake = absint($challenge['stake'] ?? 0);

    if (($challenge['status'] ?? '') !== 'open' || time() >= (int) ($challenge['closes_at'] ?? 0)) {
        return new WP_Error('sml_loop_closed', 'This prediction channel is closed.', array('status' => 400));
    }
    if (isset($challenge['entries'][$user_id])) {
        return new WP_Error('sml_loop_duplicate', 'You already joined this prediction channel.', array('status' => 409));
    }
    if ($prediction === '') {
        return new WP_Error('sml_bad_loop_prediction', 'Enter your prediction before joining.', array('status' => 400));
    }
    if ($stake < 1 || sml_members_loop_bucks_balance($user_id) < $stake) {
        return new WP_Error('sml_loop_low_balance', 'You do not have enough Loop Bucks to join.', array('status' => 400));
    }

    $challenge['entries'][$user_id] = array(
        'user_id' => $user_id,
        'handle' => sml_members_handle($user_id),
        'prediction' => $prediction,
        'stake' => $stake,
        'created_at' => time(),
    );
    $challenges[$id] = $challenge;
    sml_members_loop_bucks_adjust($user_id, -$stake, 'Joined prediction channel ' . $id);
    update_option('sml_loop_challenges', $challenges, false);

    return array(
        'joined' => true,
        'balance' => sml_members_loop_bucks_balance($user_id),
        'challenge' => sml_members_loop_public_challenge($challenge, $user_id),
        'message' => 'You joined with non-redeemable Loop Bucks. Settlement remains disabled until rules and compliance are finalized.',
    );
}

function sml_members_rest_loop_purchase_intent(WP_REST_Request $request) {
    $credits = absint($request->get_param('credits'));
    if ($credits < 1) {
        $credits = 100;
    }
    $quote = sml_members_loop_purchase_quote($credits);
    return array(
        'enabled' => false,
        'quote' => $quote,
        'message' => $quote['credits'] . ' Loop Bucks would cost ' . $quote['total_display'] . ' including the 2% service fee and $0.00 tax. Checkout is not enabled yet, so no charge was made.',
    );
}

function sml_members_rest_loop_heartbeat() {
    $user_id = get_current_user_id();
    $now = time();
    $last = (int) get_user_meta($user_id, 'sml_last_seen', true);
    $online_seconds = (int) get_user_meta($user_id, 'sml_online_seconds', true);

    if ($last > 0) {
        $delta = max(0, min(120, $now - $last));
        if ($delta >= 20) {
            $online_seconds += $delta;
            update_user_meta($user_id, 'sml_online_seconds', $online_seconds);
        }
    }

    update_user_meta($user_id, 'sml_last_seen', $now);
    sml_members_maybe_award_referral_rewards($user_id);

    return array(
        'tracked' => true,
        'online_seconds' => $online_seconds,
        'referral' => sml_members_referral_payload($user_id),
    );
}

function sml_members_rest_get_sentiment(WP_REST_Request $request) {
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
    if (!$symbol) {
        return new WP_Error('sml_bad_symbol', 'Ticker symbol required.', array('status' => 400));
    }

    $date = sml_members_sentiment_date();
    $votes = sml_members_sentiment_votes();
    $key = sml_members_sentiment_key($symbol, $date);
    $daily = isset($votes[$key]) && is_array($votes[$key]) ? $votes[$key] : array();
    $counts = sml_members_sentiment_counts($daily);
    $user_vote = null;
    if (is_user_logged_in()) {
        $user_id = get_current_user_id();
        if (isset($daily[$user_id]['vote'])) {
            $user_vote = $daily[$user_id]['vote'];
        }
    }

    return array(
        'symbol' => $symbol,
        'date' => $date,
        'bullish' => $counts['bullish'],
        'bearish' => $counts['bearish'],
        'total' => $counts['total'],
        'bullish_pct' => $counts['bullish_pct'],
        'bearish_pct' => $counts['bearish_pct'],
        'user_vote' => $user_vote,
        'leaderboard' => sml_members_sentiment_leaderboard(10),
        'top_trader_thoughts' => sml_members_top_trader_thoughts($symbol, 10),
    );
}

function sml_members_rest_vote_sentiment(WP_REST_Request $request) {
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
    $vote = sanitize_key((string) $request->get_param('vote'));
    if (!$symbol || !in_array($vote, array('bullish', 'bearish'), true)) {
        return new WP_Error('sml_bad_vote', 'Choose bullish or bearish for a valid ticker.', array('status' => 400));
    }

    $user_id = get_current_user_id();
    $date = sml_members_sentiment_date();
    $votes = sml_members_sentiment_votes();
    $key = sml_members_sentiment_key($symbol, $date);
    if (!isset($votes[$key]) || !is_array($votes[$key])) {
        $votes[$key] = array();
    }

    $is_new_vote = empty($votes[$key][$user_id]);
    $votes[$key][$user_id] = array(
        'vote' => $vote,
        'time' => gmdate('c'),
        'settled' => !empty($votes[$key][$user_id]['settled']),
        'outcome' => isset($votes[$key][$user_id]['outcome']) ? sanitize_key($votes[$key][$user_id]['outcome']) : '',
    );
    update_option('sml_sentiment_votes', $votes, false);

    if ($is_new_vote) {
        $stats = sml_members_get_sentiment_stats($user_id);
        $stats['votes']++;
        $stats['pending']++;
        $stats['points']++;
        sml_members_save_sentiment_stats($user_id, $stats);
    }

    return sml_members_rest_get_sentiment($request);
}

function sml_members_rest_get_leaderboard() {
    return array(
        'leaderboard' => sml_members_sentiment_leaderboard(10),
        'message' => 'Top Stockmarketloop sentiment traders ranked by prediction points.',
    );
}

function sml_members_rest_settle_sentiment(WP_REST_Request $request) {
    $symbol = sml_members_clean_symbol((string) $request->get_param('symbol'));
    $date = sanitize_text_field((string) $request->get_param('date'));
    $outcome = sanitize_key((string) $request->get_param('outcome'));
    if (!$symbol || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !in_array($outcome, array('bullish', 'bearish'), true)) {
        return new WP_Error('sml_bad_settle', 'Provide symbol, date, and bullish or bearish outcome.', array('status' => 400));
    }

    $votes = sml_members_sentiment_votes();
    $key = sml_members_sentiment_key($symbol, $date);
    if (empty($votes[$key]) || !is_array($votes[$key])) {
        return array('settled' => 0, 'message' => 'No votes found for that ticker and date.');
    }

    $settled = 0;
    foreach ($votes[$key] as $user_id => &$row) {
        if (!empty($row['settled'])) {
            continue;
        }
        $stats = sml_members_get_sentiment_stats((int) $user_id);
        if (($row['vote'] ?? '') === $outcome) {
            $stats['right']++;
            $stats['points'] += 3;
        } else {
            $stats['wrong']++;
            $stats['points'] = max(0, $stats['points'] - 1);
        }
        $stats['pending'] = max(0, $stats['pending'] - 1);
        sml_members_save_sentiment_stats((int) $user_id, $stats);
        $row['settled'] = true;
        $row['outcome'] = $outcome;
        $settled++;
    }
    unset($row);
    update_option('sml_sentiment_votes', $votes, false);

    return array('settled' => $settled, 'leaderboard' => sml_members_sentiment_leaderboard(10));
}

function sml_members_get_watchlist($user_id) {
    $items = get_user_meta($user_id, 'sml_watchlist', true);
    return is_array($items) ? array_values(array_filter(array_map('sanitize_text_field', $items))) : array();
}

function sml_members_clean_hex_color($color) {
    $color = trim((string) $color);
    if ($color === '') {
        return '';
    }
    if (preg_match('/^#?[0-9A-Fa-f]{6}$/', $color)) {
        return '#' . strtoupper(ltrim($color, '#'));
    }
    return '';
}

function sml_members_clean_profile_font($font) {
    $font = sanitize_key($font);
    return in_array($font, array('inter', 'arial', 'georgia', 'courier', 'trebuchet', 'impact'), true) ? $font : 'inter';
}

function sml_members_profile_font_stack($font) {
    $map = array(
        'inter' => 'Inter, Arial, sans-serif',
        'arial' => 'Arial, Helvetica, sans-serif',
        'georgia' => 'Georgia, serif',
        'courier' => '"Courier New", monospace',
        'trebuchet' => '"Trebuchet MS", Arial, sans-serif',
        'impact' => 'Impact, Haettenschweiler, Arial Narrow Bold, sans-serif',
    );
    return $map[$font] ?? $map['inter'];
}

function sml_members_clean_public_handle($handle) {
    $handle = strtolower(trim((string) $handle));
    $handle = ltrim($handle, '@');
    $handle = preg_replace('/[^a-z0-9_.]/', '', $handle);
    return substr($handle, 0, 30);
}

function sml_members_public_handle($user_id) {
    $handle = sml_members_clean_public_handle((string) get_user_meta($user_id, 'sml_public_handle', true));
    if ($handle !== '') {
        return $handle;
    }
    $user = get_userdata($user_id);
    $fallback = $user && $user->user_login ? $user->user_login : sml_members_handle($user_id);
    return sml_members_clean_public_handle($fallback) ?: 'member' . absint($user_id);
}

function sml_members_social_platforms() {
    return array(
        'facebook' => array('label' => 'Facebook', 'glyph' => 'f', 'color' => '#1877F2', 'icon' => 'https://cdn.simpleicons.org/facebook/1877F2', 'placeholder' => 'https://facebook.com/yourname'),
        'x' => array('label' => 'X', 'glyph' => 'X', 'color' => '#F4F7FB', 'icon' => 'https://cdn.simpleicons.org/x/FFFFFF', 'placeholder' => 'https://x.com/yourhandle'),
        'youtube' => array('label' => 'YouTube', 'glyph' => 'YT', 'color' => '#FF0033', 'icon' => 'https://cdn.simpleicons.org/youtube/FF0033', 'placeholder' => 'https://youtube.com/@yourchannel'),
        'bluesky' => array('label' => 'Bluesky', 'glyph' => 'B', 'color' => '#1185FE', 'icon' => 'https://cdn.simpleicons.org/bluesky/1185FE', 'placeholder' => 'https://bsky.app/profile/yourname.bsky.social'),
        'threads' => array('label' => 'Threads', 'glyph' => '@', 'color' => '#F4F7FB', 'icon' => 'https://cdn.simpleicons.org/threads/FFFFFF', 'placeholder' => 'https://threads.net/@yourhandle'),
        'instagram' => array('label' => 'Instagram', 'glyph' => 'IG', 'color' => '#E4405F', 'icon' => 'https://cdn.simpleicons.org/instagram/E4405F', 'placeholder' => 'https://instagram.com/yourhandle'),
        'discord' => array('label' => 'Discord', 'glyph' => 'D', 'color' => '#5865F2', 'icon' => 'https://cdn.simpleicons.org/discord/5865F2', 'placeholder' => 'https://discord.gg/yourserver'),
        'quora' => array('label' => 'Quora', 'glyph' => 'Q', 'color' => '#B92B27', 'icon' => 'https://cdn.simpleicons.org/quora/B92B27', 'placeholder' => 'https://quora.com/profile/yourname'),
        'pinterest' => array('label' => 'Pinterest', 'glyph' => 'P', 'color' => '#E60023', 'icon' => 'https://cdn.simpleicons.org/pinterest/E60023', 'placeholder' => 'https://pinterest.com/yourname'),
        'rumble' => array('label' => 'Rumble', 'glyph' => 'R', 'color' => '#85C742', 'icon' => 'https://cdn.simpleicons.org/rumble/85C742', 'placeholder' => 'https://rumble.com/user/yourname'),
        'linkedin' => array('label' => 'LinkedIn', 'glyph' => 'in', 'color' => '#0A66C2', 'icon' => 'https://cdn.simpleicons.org/linkedin/0A66C2', 'placeholder' => 'https://linkedin.com/in/yourname'),
    );
}

function sml_members_clean_social_url($url) {
    $url = trim((string) $url);
    if ($url === '') {
        return '';
    }
    if (!preg_match('/^https?:\/\//i', $url) && preg_match('/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}/', $url)) {
        $url = 'https://' . $url;
    }
    $url = esc_url_raw($url);
    $parts = wp_parse_url($url);
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    if (!$url || !in_array($scheme, array('http', 'https'), true)) {
        return '';
    }
    return $url;
}

function sml_members_clean_social_links($raw) {
    if (is_string($raw)) {
        $decoded = json_decode($raw, true);
        $raw = is_array($decoded) ? $decoded : array();
    }
    if (!is_array($raw)) {
        return array();
    }

    if (isset($raw['qoura']) && empty($raw['quora'])) {
        $raw['quora'] = $raw['qoura'];
    }

    $clean = array();
    foreach (sml_members_social_platforms() as $key => $platform) {
        $value = $raw[$key] ?? '';
        if (is_array($value)) {
            $value = $value['url'] ?? '';
        }
        $url = sml_members_clean_social_url($value);
        if ($url !== '') {
            $clean[$key] = $url;
        }
    }
    return $clean;
}

function sml_members_clean_music_url($url) {
    $url = esc_url_raw(trim((string) $url));
    if ($url === '') {
        return '';
    }
    return sml_members_music_embed_url($url) ? $url : '';
}

function sml_members_youtube_video_id($url) {
    $parts = wp_parse_url($url);
    if (!empty($parts['query'])) {
        parse_str($parts['query'], $query);
        if (!empty($query['v'])) {
            $video = preg_replace('/[^A-Za-z0-9_-]/', '', (string) $query['v']);
            if (strlen($video) >= 6) {
                return $video;
            }
        }
    }
    if (preg_match('/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/i', $url, $matches)) {
        return $matches[1];
    }
    return '';
}

function sml_members_youtube_playlist_id($url) {
    $parts = wp_parse_url($url);
    if (empty($parts['query'])) {
        return '';
    }
    parse_str($parts['query'], $query);
    $list = isset($query['list']) ? preg_replace('/[^A-Za-z0-9_-]/', '', (string) $query['list']) : '';
    return strlen($list) >= 6 ? $list : '';
}

function sml_members_music_embed_url($url, $autoplay = false, $mute = false) {
    $url = esc_url_raw((string) $url);
    $playlist = sml_members_youtube_playlist_id($url);
    $args = array('enablejsapi' => '1', 'rel' => '0', 'playsinline' => '1');
    if ($autoplay) {
        $args['autoplay'] = '1';
    }
    if ($mute) {
        $args['mute'] = '1';
    }
    if ($playlist) {
        return esc_url_raw(add_query_arg($args, 'https://www.youtube.com/embed/videoseries?list=' . rawurlencode($playlist)));
    }
    $video = sml_members_youtube_video_id($url);
    if ($video) {
        return esc_url_raw(add_query_arg($args, 'https://www.youtube.com/embed/' . rawurlencode($video)));
    }
    return '';
}

function sml_members_clean_music_playlist($raw) {
    if (is_string($raw)) {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $raw = $decoded;
        } else {
            $raw = preg_split('/[\r\n,]+/', $raw);
        }
    }
    if (!is_array($raw)) {
        return array();
    }

    $rows = array();
    foreach ($raw as $item) {
        $title = '';
        $url = '';
        if (is_array($item)) {
            $url = (string) ($item['url'] ?? '');
            $title = sanitize_text_field((string) ($item['title'] ?? ''));
        } else {
            $url = (string) $item;
        }
        $url = sml_members_clean_music_url($url);
        if ($url === '') {
            continue;
        }
        $rows[] = array(
            'url' => $url,
            'embed_url' => sml_members_music_embed_url($url),
            'video_id' => sml_members_youtube_video_id($url),
            'playlist_id' => sml_members_youtube_playlist_id($url),
            'title' => substr($title ?: 'Track ' . (count($rows) + 1), 0, 80),
        );
        if (count($rows) >= 5) {
            break;
        }
    }
    return $rows;
}

function sml_members_profile_music_playlist($user_id) {
    $playlist = sml_members_clean_music_playlist(get_user_meta($user_id, 'sml_music_playlist', true));
    if (!empty($playlist)) {
        return $playlist;
    }
    $legacy = sml_members_clean_music_url((string) get_user_meta($user_id, 'sml_music_url', true));
    return $legacy ? sml_members_clean_music_playlist(array($legacy)) : array();
}

function sml_members_profile_album($user_id) {
    $album = get_user_meta($user_id, 'sml_profile_album', true);
    if (!is_array($album)) {
        return array();
    }
    $rows = array();
    foreach ($album as $item) {
        if (!is_array($item) || empty($item['url'])) {
            continue;
        }
        $rows[] = array(
            'url' => esc_url_raw((string) $item['url']),
            'date' => sanitize_text_field((string) ($item['date'] ?? gmdate('c'))),
        );
    }
    return array_slice($rows, 0, 30);
}

function sml_members_add_album_image($user_id, $url) {
    $url = esc_url_raw($url);
    if (!$url) {
        return array();
    }
    $album = sml_members_profile_album($user_id);
    array_unshift($album, array(
        'url' => $url,
        'date' => gmdate('c'),
    ));
    $seen = array();
    $clean = array();
    foreach ($album as $item) {
        if (empty($item['url']) || isset($seen[$item['url']])) {
            continue;
        }
        $seen[$item['url']] = true;
        $clean[] = $item;
        if (count($clean) >= 30) {
            break;
        }
    }
    update_user_meta($user_id, 'sml_profile_album', $clean);
    return $clean;
}

function sml_members_user_stream_posts($user_id, $limit = 8) {
    $comments = get_comments(array(
        'post_id' => SML_MEMBERS_STREAM_POST_ID,
        'status' => 'approve',
        'user_id' => (int) $user_id,
        'number' => 80,
        'orderby' => 'comment_date_gmt',
        'order' => 'DESC',
    ));

    $rows = array();
    foreach ($comments as $comment) {
        $parsed = sml_members_parse_stream_comment($comment);
        if (!$parsed || (int) $parsed['user_id'] !== (int) $user_id) {
            continue;
        }
        $rows[] = $parsed;
        if (count($rows) >= $limit) {
            break;
        }
    }
    return $rows;
}

function sml_members_pinned_stream_post($user_id) {
    $post_id = absint(get_user_meta($user_id, 'sml_pinned_post_id', true));
    if (!$post_id) {
        return null;
    }
    $parsed = sml_members_parse_stream_comment(get_comment($post_id));
    if (!$parsed || (int) $parsed['user_id'] !== (int) $user_id) {
        return null;
    }
    return $parsed;
}

function sml_members_recent_stream_posts($limit = 120) {
    $comments = get_comments(array(
        'post_id' => SML_MEMBERS_STREAM_POST_ID,
        'status' => 'approve',
        'number' => $limit,
        'orderby' => 'comment_date_gmt',
        'order' => 'DESC',
    ));
    $rows = array();
    foreach ($comments as $comment) {
        $parsed = sml_members_parse_stream_comment($comment);
        if ($parsed) {
            $rows[] = $parsed;
        }
    }
    return $rows;
}

function sml_members_trending_posts($limit = 10, $hours = 24, $symbol = '') {
    $limit = max(1, min(20, absint($limit) ?: 10));
    $hours = max(1, min(72, absint($hours) ?: 24));
    $symbol = sml_members_clean_symbol($symbol);
    $cutoff = time() - ($hours * HOUR_IN_SECONDS);
    $comments = get_comments(array(
        'post_id' => SML_MEMBERS_STREAM_POST_ID,
        'status' => 'approve',
        'number' => 300,
        'orderby' => 'comment_date_gmt',
        'order' => 'DESC',
    ));
    $rows = array();

    foreach ($comments as $comment) {
        $parsed = sml_members_parse_stream_comment($comment);
        if (!$parsed) {
            continue;
        }
        $stamp = strtotime((string) ($parsed['date'] ?? ''));
        if (!$stamp || $stamp < $cutoff) {
            continue;
        }
        if ($symbol && !in_array($symbol, (array) ($parsed['tickers'] ?? array()), true)) {
            continue;
        }
        if ((int) ($parsed['total_votes'] ?? 0) <= 0) {
            continue;
        }
        $parsed['trending_url'] = home_url('/stock-chart/?symbol=' . rawurlencode(($parsed['tickers'][0] ?? $symbol ?: 'SPY')) . '#comments');
        $rows[] = $parsed;
    }

    usort($rows, function($a, $b) {
        $score = ((int) ($b['vote_score'] ?? 0)) <=> ((int) ($a['vote_score'] ?? 0));
        if ($score !== 0) {
            return $score;
        }
        $votes = ((int) ($b['total_votes'] ?? 0)) <=> ((int) ($a['total_votes'] ?? 0));
        if ($votes !== 0) {
            return $votes;
        }
        return strcmp((string) ($b['date'] ?? ''), (string) ($a['date'] ?? ''));
    });

    return array_slice($rows, 0, $limit);
}

function sml_members_personal_feed_payload($user_id) {
    $watchlist = sml_members_get_watchlist($user_id);
    if (!$watchlist) {
        $watchlist = array('SPY', 'QQQ', 'NVDA', 'TSLA', 'AMC');
    }
    $watch_map = array_fill_keys($watchlist, true);
    $recent = sml_members_recent_stream_posts(180);
    $watch_rows = array();
    $ticker_heat = array();

    foreach ($recent as $row) {
        foreach ($row['tickers'] as $symbol) {
            $ticker_heat[$symbol] = ($ticker_heat[$symbol] ?? 0) + 1;
        }
        if (array_intersect($row['tickers'], $watchlist)) {
            $watch_rows[] = $row;
        }
    }

    $trending = $recent;
    usort($trending, function($a, $b) use ($ticker_heat) {
        $a_heat = 0;
        $b_heat = 0;
        foreach ($a['tickers'] as $symbol) {
            $a_heat = max($a_heat, (int) ($ticker_heat[$symbol] ?? 0));
        }
        foreach ($b['tickers'] as $symbol) {
            $b_heat = max($b_heat, (int) ($ticker_heat[$symbol] ?? 0));
        }
        if ($a_heat === $b_heat) {
            return strcmp((string) ($b['date'] ?? ''), (string) ($a['date'] ?? ''));
        }
        return $b_heat <=> $a_heat;
    });

    return array(
        'watchlist' => array_values($watchlist),
        'watchlist_posts' => array_slice($watch_rows, 0, 12),
        'trending_posts' => array_slice($trending, 0, 12),
        'refresh_seconds' => 30,
    );
}

function sml_members_raw_profile_chart_posts($user_id) {
    $posts = get_user_meta($user_id, 'sml_profile_chart_posts', true);
    return is_array($posts) ? array_values($posts) : array();
}

function sml_members_chart_tickers($text) {
    $tickers = array();
    if (preg_match_all('/\$([A-Z0-9.]{1,8})\b/', strtoupper((string) $text), $matches)) {
        foreach ($matches[1] as $match) {
            $clean = sml_members_clean_symbol($match);
            if ($clean) {
                $tickers[] = $clean;
            }
        }
    }
    return array_values(array_unique(array_slice($tickers, 0, 8)));
}

function sml_members_vote_ids($items) {
    return array_values(array_filter(array_unique(array_map('absint', is_array($items) ? $items : array())), function($id) {
        return $id > 0 && get_userdata($id);
    }));
}

function sml_members_vote_summary($upvotes, $downvotes, $viewer_id = 0) {
    $upvotes = sml_members_vote_ids($upvotes);
    $downvotes = array_values(array_diff(sml_members_vote_ids($downvotes), $upvotes));
    $viewer_id = absint($viewer_id ?: get_current_user_id());
    $viewer_vote = '';
    if ($viewer_id && in_array($viewer_id, $upvotes, true)) {
        $viewer_vote = 'up';
    } elseif ($viewer_id && in_array($viewer_id, $downvotes, true)) {
        $viewer_vote = 'down';
    }

    return array(
        'upvote_count' => count($upvotes),
        'downvote_count' => count($downvotes),
        'vote_score' => count($upvotes) - count($downvotes),
        'viewer_vote' => $viewer_vote,
        'total_votes' => count($upvotes) + count($downvotes),
    );
}

function sml_members_voter_rows($ids, $limit = 40) {
    $rows = array();
    foreach (array_slice(sml_members_vote_ids($ids), 0, $limit) as $user_id) {
        $rows[] = array(
            'user_id' => $user_id,
            'handle' => sml_members_handle($user_id),
            'avatar_url' => get_user_meta($user_id, 'sml_avatar_url', true) ?: get_avatar_url($user_id),
            'profile_url' => home_url('/members/' . $user_id . '/'),
        );
    }
    return $rows;
}

function sml_members_profile_chart_post_payload($row) {
    $author_id = absint($row['author_id'] ?? $row['user_id'] ?? 0);
    if (!$author_id || !get_userdata($author_id)) {
        return null;
    }
    $text = wp_strip_all_tags((string) ($row['text'] ?? ''));
    if ($text === '') {
        return null;
    }
    $likes = isset($row['likes']) && is_array($row['likes']) ? array_values(array_unique(array_map('absint', $row['likes']))) : array();
    $viewer_id = get_current_user_id();
    $votes = sml_members_vote_summary($row['upvotes'] ?? array(), $row['downvotes'] ?? array(), $viewer_id);

    return array_merge(array(
        'id' => sanitize_key((string) ($row['id'] ?? '')),
        'author_id' => $author_id,
        'handle' => sml_members_handle($author_id),
        'avatar_url' => get_user_meta($author_id, 'sml_avatar_url', true) ?: get_avatar_url($author_id),
        'profile_url' => home_url('/members/' . $author_id . '/'),
        'text' => $text,
        'tickers' => sml_members_chart_tickers($text),
        'hashtags' => sml_members_extract_hashtags($text),
        'mentions' => sml_members_extract_mentions($text),
        'date' => sanitize_text_field((string) ($row['date'] ?? gmdate('c'))),
        'like_count' => count($likes),
        'viewer_liked' => $viewer_id ? in_array((int) $viewer_id, $likes, true) : false,
        'badge' => sml_members_primary_badge($author_id),
    ), $votes);
}

function sml_members_profile_chart_posts($user_id, $limit = 30) {
    $rows = array();
    foreach (sml_members_raw_profile_chart_posts($user_id) as $row) {
        $payload = sml_members_profile_chart_post_payload($row);
        if (!$payload) {
            continue;
        }
        $rows[] = $payload;
        if (count($rows) >= $limit) {
            break;
        }
    }
    return $rows;
}

function sml_members_achievement_tracks() {
    return array(
        'posts' => array(
            'label' => 'Posts',
            'stat_label' => 'Total posts',
            'levels' => array(
                array('level' => 1, 'name' => 'Spark Poster', 'milestone' => 25, 'credits' => 50, 'reward' => 'basic badge'),
                array('level' => 2, 'name' => 'Active Contributor', 'milestone' => 100, 'credits' => 150, 'reward' => 'colored badge'),
                array('level' => 3, 'name' => 'Market Voice', 'milestone' => 300, 'credits' => 300, 'reward' => 'profile frame'),
                array('level' => 4, 'name' => 'Floor Regular', 'milestone' => 700, 'credits' => 600, 'reward' => 'animated badge'),
                array('level' => 5, 'name' => 'Loop Broadcaster', 'milestone' => 1200, 'credits' => 1000, 'reward' => 'profile theme'),
                array('level' => 6, 'name' => 'Signal Sender', 'milestone' => 2000, 'credits' => 1800, 'reward' => 'special emoji pack'),
                array('level' => 7, 'name' => 'Market Oracle', 'milestone' => 3000, 'credits' => 3000, 'reward' => 'rare badge + title'),
            ),
        ),
        'views' => array(
            'label' => 'Views',
            'stat_label' => 'Profile views',
            'levels' => array(
                array('level' => 1, 'name' => 'Seen on the Radar', 'milestone' => 500, 'credits' => 50, 'reward' => 'badge'),
                array('level' => 2, 'name' => 'Watched Trader', 'milestone' => 2000, 'credits' => 200, 'reward' => 'profile stat flair'),
                array('level' => 3, 'name' => 'Followed Closely', 'milestone' => 5000, 'credits' => 400, 'reward' => 'subtle glow frame'),
                array('level' => 4, 'name' => 'Trending Profile', 'milestone' => 10000, 'credits' => 800, 'reward' => 'animated badge'),
                array('level' => 5, 'name' => 'Market Personality', 'milestone' => 20000, 'credits' => 1500, 'reward' => 'exclusive theme'),
                array('level' => 6, 'name' => 'Community Icon', 'milestone' => 35000, 'credits' => 2500, 'reward' => 'banner slot upgrade'),
                array('level' => 7, 'name' => 'Loop Legend', 'milestone' => 50000, 'credits' => 4000, 'reward' => 'rare badge + title'),
            ),
        ),
        'likes' => array(
            'label' => 'Likes',
            'stat_label' => 'Likes received',
            'levels' => array(
                array('level' => 1, 'name' => 'Liked Contributor', 'milestone' => 250, 'credits' => 75, 'reward' => 'badge'),
                array('level' => 2, 'name' => 'Crowd Favorite', 'milestone' => 1000, 'credits' => 250, 'reward' => 'reaction flair'),
                array('level' => 3, 'name' => 'Signal Amplifier', 'milestone' => 3000, 'credits' => 500, 'reward' => 'animated badge'),
                array('level' => 4, 'name' => 'Sentiment Driver', 'milestone' => 7000, 'credits' => 1000, 'reward' => 'profile highlight'),
                array('level' => 5, 'name' => 'Market Influencer', 'milestone' => 12000, 'credits' => 2000, 'reward' => 'theme unlock'),
                array('level' => 6, 'name' => 'Alpha Voice', 'milestone' => 20000, 'credits' => 3500, 'reward' => 'special icon set'),
                array('level' => 7, 'name' => 'Loop King/Queen', 'milestone' => 30000, 'credits' => 5000, 'reward' => 'rare badge + title'),
            ),
        ),
    );
}

function sml_members_achievement_tier($level) {
    $level = absint($level);
    if ($level >= 7) {
        return 'mythic';
    }
    if ($level >= 5) {
        return 'platinum';
    }
    if ($level >= 3) {
        return 'gold';
    }
    if ($level >= 2) {
        return 'silver';
    }
    return $level ? 'bronze' : 'locked';
}

function sml_members_stat_meta_key($stat) {
    $map = array(
        'posts' => 'sml_stat_total_posts',
        'views' => 'sml_stat_profile_views',
        'likes' => 'sml_stat_likes_received',
    );
    return $map[$stat] ?? '';
}

function sml_members_stream_comment_count($user_id) {
    return (int) get_comments(array(
        'post_id' => SML_MEMBERS_STREAM_POST_ID,
        'user_id' => absint($user_id),
        'status' => 'approve',
        'count' => true,
    ));
}

function sml_members_chart_likes_received_count($user_id) {
    $total = 0;
    foreach (sml_members_raw_profile_chart_posts($user_id) as $row) {
        $author_id = absint($row['author_id'] ?? $row['user_id'] ?? 0);
        if ($author_id !== (int) $user_id) {
            continue;
        }
        $likes = isset($row['likes']) && is_array($row['likes']) ? $row['likes'] : array();
        $total += count(array_unique(array_map('absint', $likes)));
    }
    return $total;
}

function sml_members_achievement_stats($user_id) {
    $user_id = absint($user_id);
    $stored_posts = (int) get_user_meta($user_id, 'sml_stat_total_posts', true);
    $stored_likes = (int) get_user_meta($user_id, 'sml_stat_likes_received', true);
    $own_chart_posts = 0;
    foreach (sml_members_raw_profile_chart_posts($user_id) as $row) {
        if (absint($row['author_id'] ?? $row['user_id'] ?? 0) === $user_id) {
            $own_chart_posts++;
        }
    }

    return array(
        'posts' => max($stored_posts, sml_members_stream_comment_count($user_id) + $own_chart_posts),
        'views' => max(0, (int) get_user_meta($user_id, 'sml_stat_profile_views', true)),
        'likes' => max($stored_likes, sml_members_chart_likes_received_count($user_id)),
    );
}

function sml_members_increment_stat($user_id, $stat, $delta = 1, $award = true) {
    $key = sml_members_stat_meta_key($stat);
    if (!$key || !get_userdata($user_id)) {
        return 0;
    }

    $current = (int) get_user_meta($user_id, $key, true);
    $current = max(0, $current + (int) $delta);
    update_user_meta($user_id, $key, $current);

    if ($award) {
        sml_members_maybe_award_achievements($user_id);
    }

    return $current;
}

function sml_members_unlocked_achievements($user_id) {
    $unlocked = get_user_meta($user_id, 'sml_achievement_unlocked_levels', true);
    return is_array($unlocked) ? $unlocked : array();
}

function sml_members_maybe_award_achievements($user_id) {
    $stats = sml_members_achievement_stats($user_id);
    $tracks = sml_members_achievement_tracks();
    $unlocked = sml_members_unlocked_achievements($user_id);
    $changed = false;

    foreach ($tracks as $track_key => $track) {
        $highest = absint($unlocked[$track_key] ?? 0);
        foreach ($track['levels'] as $level) {
            if ((int) $level['level'] <= $highest || (int) $stats[$track_key] < (int) $level['milestone']) {
                continue;
            }
            $highest = (int) $level['level'];
            $unlocked[$track_key] = $highest;
            $changed = true;
            sml_members_loop_bucks_adjust($user_id, (int) $level['credits'], 'Achievement: ' . $level['name']);
            sml_members_add_notification(
                $user_id,
                'achievement',
                'Achievement unlocked: ' . $level['name'] . ' +' . (int) $level['credits'] . ' Loop Bucks.',
                home_url('/members/' . $user_id . '/#achievements'),
                $user_id
            );
        }
    }

    if ($changed) {
        update_user_meta($user_id, 'sml_achievement_unlocked_levels', $unlocked);
    }
}

function sml_members_achievement_summary($user_id, $stats = null) {
    $stats = is_array($stats) ? $stats : sml_members_achievement_stats($user_id);
    $tracks = sml_members_achievement_tracks();
    $unlocked = sml_members_unlocked_achievements($user_id);
    $summary = array();

    foreach ($tracks as $track_key => $track) {
        $value = (int) ($stats[$track_key] ?? 0);
        $current = null;
        $next = null;
        $levels = $track['levels'];
        foreach ($levels as $level) {
            if ($value >= (int) $level['milestone']) {
                $current = $level;
                continue;
            }
            $next = $level;
            break;
        }
        if (!$next) {
            $next = $levels[count($levels) - 1];
        }
        $current_level = $current ? (int) $current['level'] : 0;
        $previous_milestone = $current ? (int) $current['milestone'] : 0;
        $next_milestone = max(1, (int) $next['milestone']);
        $range = max(1, $next_milestone - $previous_milestone);
        $progress = $current_level >= 7 ? 100 : min(100, max(0, (int) floor((($value - $previous_milestone) / $range) * 100)));

        $summary[$track_key] = array(
            'track' => $track_key,
            'label' => $track['label'],
            'stat_label' => $track['stat_label'],
            'value' => $value,
            'current_level' => $current_level,
            'current_name' => $current ? $current['name'] : 'Locked',
            'current_tier' => sml_members_achievement_tier($current_level),
            'next_level' => (int) $next['level'],
            'next_name' => $next['name'],
            'next_milestone' => $next_milestone,
            'next_credits' => (int) $next['credits'],
            'progress' => $progress,
            'unlocked_level' => absint($unlocked[$track_key] ?? 0),
            'reward' => $current ? $current['reward'] : 'first badge',
            'levels' => array_map(function($level) use ($value) {
                return array(
                    'level' => (int) $level['level'],
                    'name' => $level['name'],
                    'milestone' => (int) $level['milestone'],
                    'credits' => (int) $level['credits'],
                    'reward' => $level['reward'],
                    'tier' => sml_members_achievement_tier((int) $level['level']),
                    'unlocked' => $value >= (int) $level['milestone'],
                );
            }, $levels),
        );
    }

    return $summary;
}

function sml_members_primary_badge($user_id) {
    $summary = sml_members_achievement_summary($user_id);
    $best = null;
    foreach ($summary as $track) {
        if (!$best || (int) $track['current_level'] > (int) $best['current_level']) {
            $best = $track;
        }
    }
    return $best && (int) $best['current_level'] > 0 ? $best : null;
}

function sml_members_badge_chip_html($badge) {
    if (!$badge || empty($badge['current_level'])) {
        return '';
    }
    return '<span class="sml-ach-badge sml-ach-' . esc_attr($badge['current_tier']) . '" title="' . esc_attr($badge['label'] . ' Level ' . $badge['current_level']) . '">' . esc_html($badge['current_name']) . '</span>';
}

function sml_members_record_profile_view($user_id) {
    $user_id = absint($user_id);
    if (!$user_id || !get_userdata($user_id) || (is_user_logged_in() && get_current_user_id() === $user_id)) {
        return false;
    }

    $agent = strtolower((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    if ($agent && preg_match('/bot|crawl|spider|preview|facebookexternalhit|slurp|mediapartners/i', $agent)) {
        return false;
    }

    $viewer = is_user_logged_in() ? 'u' . get_current_user_id() : 'g' . md5((string) ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . $agent);
    $key = 'sml_profile_view_' . $user_id . '_' . md5($viewer . '|' . gmdate('Y-m-d'));
    if (get_transient($key)) {
        return false;
    }

    set_transient($key, 1, DAY_IN_SECONDS);
    sml_members_increment_stat($user_id, 'views', 1);
    return true;
}

function sml_members_profile_payload($user_id) {
    $user = get_userdata($user_id);
    if (!$user) {
        return new WP_Error('sml_no_user', 'User not found.', array('status' => 404));
    }

    $current = get_current_user_id();
    $followers = sml_members_id_list(get_user_meta($user_id, 'sml_followers', true));
    $following = sml_members_id_list(get_user_meta($user_id, 'sml_following', true));
    $display_name = sml_members_handle($user_id);
    $first_name = sanitize_text_field((string) get_user_meta($user_id, 'first_name', true));
    $last_name = sanitize_text_field((string) get_user_meta($user_id, 'last_name', true));
    $show_real_name = get_user_meta($user_id, 'sml_show_real_name', true) === '1';
    $music_playlist = sml_members_profile_music_playlist($user_id);
    $music_url = !empty($music_playlist[0]['url']) ? $music_playlist[0]['url'] : (string) get_user_meta($user_id, 'sml_music_url', true);
    $chart_posts = sml_members_profile_chart_posts($user_id, 20);
    $chart_count = count(sml_members_raw_profile_chart_posts($user_id));
    $achievement_stats = sml_members_achievement_stats($user_id);
    $achievements = sml_members_achievement_summary($user_id, $achievement_stats);

    return array(
        'user_id' => $user_id,
        'username' => $user->user_login,
        'display_name' => $display_name,
        'handle' => $display_name,
        'public_handle' => sml_members_public_handle($user_id),
        'first_name' => $first_name,
        'last_name' => $last_name,
        'show_real_name' => $show_real_name,
        'real_name' => $show_real_name ? trim($first_name . ' ' . $last_name) : '',
        'tagline' => get_user_meta($user_id, 'sml_tagline', true),
        'bio' => get_user_meta($user_id, 'sml_bio', true),
        'avatar_url' => get_user_meta($user_id, 'sml_avatar_url', true) ?: get_avatar_url($user_id),
        'banner_url' => get_user_meta($user_id, 'sml_banner_url', true),
        'theme' => get_user_meta($user_id, 'sml_profile_theme', true) ?: 'green',
        'font' => sml_members_clean_profile_font((string) get_user_meta($user_id, 'sml_profile_font', true)),
        'accent_color' => sml_members_clean_hex_color((string) get_user_meta($user_id, 'sml_profile_accent_color', true)),
        'background_color' => sml_members_clean_hex_color((string) get_user_meta($user_id, 'sml_profile_background_color', true)),
        'text_color' => sml_members_clean_hex_color((string) get_user_meta($user_id, 'sml_profile_text_color', true)),
        'card_color' => sml_members_clean_hex_color((string) get_user_meta($user_id, 'sml_profile_card_color', true)),
        'music_url' => $music_url,
        'music_embed_url' => $music_url ? sml_members_music_embed_url($music_url) : '',
        'music_playlist' => $music_playlist,
        'music_autoplay' => get_user_meta($user_id, 'sml_music_autoplay', true) === '1',
        'social_platforms' => sml_members_social_platforms(),
        'social_links' => sml_members_clean_social_links(get_user_meta($user_id, 'sml_social_links', true)),
        'album' => sml_members_profile_album($user_id),
        'pinned_image_url' => get_user_meta($user_id, 'sml_pinned_image_url', true),
        'chart_posts' => $chart_posts,
        'chart_count' => $chart_count,
        'can_post_chart' => is_user_logged_in(),
        'pinned_post' => sml_members_pinned_stream_post($user_id),
        'recent_posts' => sml_members_user_stream_posts($user_id, 8),
        'email_verified' => get_user_meta($user_id, 'sml_email_verified', true) === '1',
        'profile_url' => home_url('/members/' . $user_id . '/'),
        'watchlist' => sml_members_get_watchlist($user_id),
        'followers_count' => count($followers),
        'following_count' => count($following),
        'profile_views' => (int) $achievement_stats['views'],
        'total_posts' => (int) $achievement_stats['posts'],
        'likes_received' => (int) $achievement_stats['likes'],
        'loop_bucks' => sml_members_loop_bucks_balance($user_id),
        'achievements' => $achievements,
        'primary_badge' => sml_members_primary_badge($user_id),
        'is_own_profile' => $current && $current === (int) $user_id,
        'is_following' => $current ? in_array((int) $user_id, sml_members_id_list(get_user_meta($current, 'sml_following', true)), true) : false,
    );
}

function sml_members_profile_template() {
    $member_id = absint(get_query_var('sml_member_id'));
    $request_path = trim((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH), '/');
    if (!$member_id && untrailingslashit($request_path) === 'my-profile' && is_user_logged_in()) {
        $member_id = get_current_user_id();
    }
    if (!$member_id) {
        return;
    }

    $profile = sml_members_profile_payload($member_id);
    if (is_wp_error($profile)) {
        status_header(404);
        wp_die('Profile not found.');
    }

    sml_members_record_profile_view($member_id);
    $profile = sml_members_profile_payload($member_id);

    $profile_title = trim(($profile['display_name'] ?: $profile['handle']) . ' (@' . ($profile['public_handle'] ?: sml_members_public_handle($member_id)) . ') - Stockmarketloop Profile');
    add_filter('pre_get_document_title', function() use ($profile_title) {
        return $profile_title;
    }, 20);

    status_header(200);
    get_header();
    echo sml_members_render_profile_page($profile);
    get_footer();
    exit;
}

function sml_members_render_profile_page($profile) {
    $nonce = wp_create_nonce('wp_rest');
    $accent = $profile['accent_color'] ?: sml_members_profile_accent($profile['theme']);
    $background_color = $profile['background_color'] ?: '#05070b';
    $text_color = $profile['text_color'] ?: '#f4f7fb';
    $card_color = $profile['card_color'] ?: '#0d141b';
    $font_stack = sml_members_profile_font_stack($profile['font']);
    $banner = $profile['banner_url'] ? 'background-image:linear-gradient(90deg,rgba(5,7,11,.35),rgba(5,7,11,.76)),url(' . esc_url($profile['banner_url']) . ');' : 'background:linear-gradient(135deg,#0d141b,#101a23 45%,#07110c);';
    $display_name = $profile['display_name'] ?: $profile['handle'];
    $public_handle = '@' . ($profile['public_handle'] ?: sml_members_clean_public_handle($display_name));
    $real_name = $profile['show_real_name'] && $profile['real_name'] ? $profile['real_name'] : '';
    $social_platforms = sml_members_social_platforms();
    $social_links = is_array($profile['social_links']) ? $profile['social_links'] : array();
    $social_buttons = array();
    $social_fields = array();
    foreach ($social_platforms as $key => $platform) {
        $link = isset($social_links[$key]) ? esc_url($social_links[$key]) : '';
        if ($link) {
            $icon = !empty($platform['icon']) ? '<img src="' . esc_url($platform['icon']) . '" alt="" loading="lazy">' : esc_html($platform['glyph']);
            $social_buttons[] = '<a class="sml-social-button" style="--social-color:' . esc_attr($platform['color']) . '" href="' . $link . '" target="_blank" rel="me noopener noreferrer"><span class="sml-social-icon">' . $icon . '</span><span>' . esc_html($platform['label']) . '</span></a>';
        }
        $field_icon = !empty($platform['icon']) ? '<img src="' . esc_url($platform['icon']) . '" alt="" loading="lazy">' : esc_html($platform['glyph']);
        $social_fields[] = '<div class="sml-social-connect-row"><button type="button" data-social-connect="' . esc_attr($key) . '" style="--social-color:' . esc_attr($platform['color']) . '"><span class="sml-social-icon">' . $field_icon . '</span><span>Connect ' . esc_html($platform['label']) . '</span></button><input data-social-link="' . esc_attr($key) . '" value="' . esc_attr($link) . '" placeholder="' . esc_attr($platform['placeholder']) . '"></div>';
    }
    $social_buttons_html = $social_buttons ? implode('', $social_buttons) : '<p class="sml-profile-muted">No connected social platforms yet.</p>';
    $social_fields_html = implode('', $social_fields);
    $music_playlist = array_slice(is_array($profile['music_playlist']) ? $profile['music_playlist'] : array(), 0, 5);
    $music_first_url = !empty($music_playlist[0]['url']) ? $music_playlist[0]['url'] : '';
    $music_first_embed = $music_first_url ? sml_members_music_embed_url($music_first_url, $profile['music_autoplay'], $profile['music_autoplay']) : '';
    $music_has_tracks = !empty($music_playlist);
    $music_first_title = !empty($music_playlist[0]['title']) ? $music_playlist[0]['title'] : 'In-the-zone track';
    $music_tracks_html = $music_playlist ? implode('', array_map(function($track, $index) {
        return '<button type="button" data-music-track="' . esc_attr($index) . '">' . esc_html($track['title'] ?: ('Track ' . ($index + 1))) . '</button>';
    }, $music_playlist, array_keys($music_playlist))) : '<span class="sml-profile-muted">No in-the-zone tracks yet.</span>';
    $music_slots = array();
    for ($index = 0; $index < 5; $index++) {
        $value = !empty($music_playlist[$index]['url']) ? $music_playlist[$index]['url'] : '';
        $music_slots[] = '<input data-profile-music-slot="' . esc_attr($index) . '" value="' . esc_attr($value) . '" placeholder="YouTube in-the-zone track ' . esc_attr($index + 1) . '">';
    }
    $music_slots_html = implode('', $music_slots);
    $preview_mode = $profile['is_own_profile'] && isset($_GET['sml_view']) && sanitize_key((string) $_GET['sml_view']) === 'visitor';
    $watchlist = $profile['watchlist'] ? implode(' ', array_map(function($symbol) {
        return '<a class="sml-profile-pill" href="' . esc_url(home_url('/stock-chart/?symbol=' . rawurlencode($symbol))) . '">$' . esc_html($symbol) . '</a>';
    }, $profile['watchlist'])) : '<span class="sml-profile-muted">No public watchlist yet.</span>';
    $album = array_slice($profile['album'], 0, 5);
    $pinned_image = $profile['pinned_image_url'] ?: (!empty($album[0]['url']) ? $album[0]['url'] : '');
    $album_html = $album ? implode('', array_map(function($item) use ($profile) {
        $pin = $profile['is_own_profile'] ? '<button type="button" data-pin-image="' . esc_url($item['url']) . '">Pin</button>' : '';
        return '<div class="sml-profile-photo"><img src="' . esc_url($item['url']) . '" alt="Profile album image">' . $pin . '</div>';
    }, $album)) : '<p class="sml-profile-muted">No public profile images yet.</p>';
    $pinned_image_html = $pinned_image ? '<img src="' . esc_url($pinned_image) . '" alt="Pinned profile image">' : '<span class="sml-profile-muted">No pinned image yet.</span>';
    $pinned_post = $profile['pinned_post'];
    $pinned_post_html = $pinned_post ? '<div class="sml-profile-post"><strong>' . esc_html('$' . implode(' $', $pinned_post['tickers'])) . '</strong><p>' . esc_html($pinned_post['text']) . '</p><a href="' . esc_url(home_url('/stock-chart/?symbol=' . rawurlencode($pinned_post['tickers'][0] ?? 'SPY') . '#comments')) . '">Open ticker stream</a></div>' : '<p class="sml-profile-muted">No pinned ticker post yet.</p>';
    $recent_posts_html = $profile['recent_posts'] ? implode('', array_map(function($post) use ($profile) {
        $symbol = $post['tickers'][0] ?? 'SPY';
        $pin = $profile['is_own_profile'] ? '<button type="button" data-pin-post="' . esc_attr($post['id']) . '">Pin Post</button>' : '';
        return '<div class="sml-profile-post"><strong>' . esc_html('$' . implode(' $', $post['tickers'])) . '</strong><p>' . esc_html($post['text']) . '</p><a href="' . esc_url(home_url('/stock-chart/?symbol=' . rawurlencode($symbol) . '#comments')) . '">Open</a>' . $pin . '</div>';
    }, $profile['recent_posts'])) : '<p class="sml-profile-muted">No ticker posts yet.</p>';
    $chart_posts = is_array($profile['chart_posts'] ?? null) ? $profile['chart_posts'] : array();
    $chart_posts_html = $chart_posts ? implode('', array_map(function($post) {
        $tickers = !empty($post['tickers']) ? '<div class="sml-chart-tags">' . implode('', array_map(function($symbol) {
            return '<a href="' . esc_url(home_url('/stock-chart/?symbol=' . rawurlencode($symbol))) . '">$' . esc_html($symbol) . '</a>';
        }, $post['tickers'])) . '</div>' : '';
        $hashtags = !empty($post['hashtags']) ? '<div class="sml-chart-hashtags">' . implode('', array_map(function($tag) {
            return '<span>#' . esc_html($tag) . '</span>';
        }, $post['hashtags'])) . '</div>' : '';
        $when = !empty($post['date']) ? date_i18n('M j, Y g:ia', strtotime($post['date'])) : '';
        $badge = sml_members_badge_chip_html($post['badge'] ?? null);
        $like_label = !empty($post['viewer_liked']) ? 'Liked' : 'Like';
        return '<article class="sml-chart-post" data-chart-post-id="' . esc_attr($post['id']) . '"><img src="' . esc_url($post['avatar_url']) . '" alt=""><div><strong><a href="' . esc_url($post['profile_url']) . '">' . esc_html($post['handle']) . '</a>' . $badge . '</strong><time>' . esc_html($when) . '</time><p>' . esc_html($post['text']) . '</p>' . $tickers . $hashtags . '<div class="sml-chart-like-row"><button type="button" data-chart-like="' . esc_attr($post['id']) . '" data-liked="' . (!empty($post['viewer_liked']) ? '1' : '0') . '">' . esc_html($like_label) . '</button><span>' . esc_html((int) ($post['like_count'] ?? 0)) . ' likes</span></div></div></article>';
    }, $chart_posts)) : '<div class="sml-chart-empty">No Chart posts yet. This is where profile updates, trade notes, screenshots and market thoughts will live.</div>';
    $achievements = is_array($profile['achievements'] ?? null) ? $profile['achievements'] : array();
    $achievement_cards_html = $achievements ? implode('', array_map(function($track) {
        $value = number_format((int) ($track['value'] ?? 0));
        $next = number_format((int) ($track['next_milestone'] ?? 0));
        $progress = max(0, min(100, (int) ($track['progress'] ?? 0)));
        $level = (int) ($track['current_level'] ?? 0);
        $level_text = $level ? ('Level ' . $level . ' - ' . $track['current_name']) : 'Locked';
        $level_ladder = !empty($track['levels']) && is_array($track['levels']) ? '<div class="sml-ach-ladder">' . implode('', array_map(function($level_item) {
            $unlocked = !empty($level_item['unlocked']);
            $title = 'Level ' . (int) ($level_item['level'] ?? 0) . ': ' . ($level_item['name'] ?? '') . ' at ' . number_format((int) ($level_item['milestone'] ?? 0)) . ' +' . (int) ($level_item['credits'] ?? 0) . ' Loop Bucks';
            return '<span class="sml-ach-dot sml-ach-dot-' . esc_attr($level_item['tier'] ?? 'locked') . '" data-unlocked="' . ($unlocked ? '1' : '0') . '" title="' . esc_attr($title) . '">' . esc_html((int) ($level_item['level'] ?? 0)) . '</span>';
        }, $track['levels'])) . '</div>' : '';
        return '<article class="sml-ach-card sml-ach-card-' . esc_attr($track['current_tier'] ?? 'locked') . '" data-achievement-card="' . esc_attr($track['track'] ?? '') . '">'
            . '<div><span>' . esc_html($track['stat_label'] ?? '') . '</span><strong>' . esc_html($level_text) . '</strong></div>'
            . '<p>' . esc_html($value . ' / ' . $next . ' toward ' . ($track['next_name'] ?? 'next badge')) . '</p>'
            . '<div class="sml-ach-progress"><span style="width:' . esc_attr($progress) . '%"></span></div>'
            . $level_ladder
            . '<small>' . esc_html($progress . '% complete | next reward +' . (int) ($track['next_credits'] ?? 0) . ' Loop Bucks') . '</small>'
            . '</article>';
    }, $achievements)) : '';
    $badge_rail_html = $achievements ? implode('', array_map(function($track) {
        if (empty($track['current_level'])) {
            return '';
        }
        return sml_members_badge_chip_html($track);
    }, $achievements)) : '';
    $badge_rail_html = trim($badge_rail_html) ?: '<span class="sml-profile-muted">No badges unlocked yet.</span>';

    ob_start();
    ?>
    <main class="sml-profile" data-sml-profile data-user-id="<?php echo esc_attr($profile['user_id']); ?>" data-own="<?php echo $profile['is_own_profile'] ? '1' : '0'; ?>" data-preview="<?php echo $preview_mode ? '1' : '0'; ?>" data-following="<?php echo $profile['is_following'] ? '1' : '0'; ?>" data-music-autoplay="<?php echo $profile['music_autoplay'] ? '1' : '0'; ?>" style="--sml-accent:<?php echo esc_attr($accent); ?>;--sml-bg:<?php echo esc_attr($background_color); ?>;--sml-text:<?php echo esc_attr($text_color); ?>;--sml-card:<?php echo esc_attr($card_color); ?>;--sml-font:<?php echo esc_attr($font_stack); ?>">
      <style>
        .sml-profile{background:var(--sml-bg);color:var(--sml-text);font-family:var(--sml-font);padding:28px 16px 50px}
        .sml-profile *{box-sizing:border-box}.sml-profile-shell{max-width:1100px;margin:0 auto}
        .sml-profile-hero{border:1px solid #22313d;border-radius:8px;overflow:hidden;background:var(--sml-card)}
        .sml-profile-banner{min-height:240px;background-size:cover;background-position:center;<?php echo esc_attr($banner); ?>display:flex;align-items:end;padding:22px}
        .sml-profile-card{display:grid;grid-template-columns:120px 1fr auto;gap:16px;align-items:end;width:100%}
        .sml-profile-avatar{width:112px;height:112px;border:3px solid var(--sml-accent);border-radius:999px;object-fit:cover;background:#101a23}
        .sml-profile h1{margin:0;color:#fff;font-size:38px;line-height:1.05}.sml-profile p{color:#b8c5d2;line-height:1.55}
        .sml-profile-identity{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px;align-items:center}.sml-profile-identity span{display:inline-flex;align-items:center;border:1px solid rgba(255,255,255,.16);background:rgba(6,12,18,.74);border-radius:999px;color:#dbe8f5;padding:5px 9px;font-size:12px;font-weight:900}.sml-profile-identity [data-public-handle-view]{color:var(--sml-accent);border-color:rgba(98,243,166,.32)}
        .sml-profile-badge-rail{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.sml-ach-badge{display:inline-flex;align-items:center;border:1px solid #2a3d4b;border-radius:999px;background:#101a23;color:#f4f7fb;padding:5px 8px;font-size:11px;font-weight:950;white-space:nowrap}.sml-ach-bronze{border-color:#9b6a3d;color:#f7c089}.sml-ach-silver{border-color:#9aa7b5;color:#e4edf5}.sml-ach-gold{border-color:#f5c542;color:#ffe793}.sml-ach-platinum{border-color:#72d7ff;color:#b9ecff;box-shadow:0 0 14px rgba(114,215,255,.18)}.sml-ach-mythic{border-color:#ff6bd6;color:#ffd7f5;box-shadow:0 0 18px rgba(255,107,214,.3)}
        .sml-profile-tagline{color:var(--sml-accent);font-weight:950;margin-top:5px}.sml-profile-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
        .sml-profile button,.sml-profile-file{border:1px solid #2a3d4b;background:#101a23;color:#dbe8f5;border-radius:6px;padding:10px 11px;font-weight:950;cursor:pointer}
        .sml-profile button.sml-primary{background:var(--sml-accent);color:#06100b;border-color:var(--sml-accent)}
        .sml-profile-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:14px;border-top:1px solid #22313d}
        .sml-profile-stat{border:1px solid #22313d;background:#101a23;border-radius:8px;padding:12px}.sml-profile-stat span{display:block;color:#95a6b5;text-transform:uppercase;font-size:10px;font-weight:900}.sml-profile-stat strong{display:block;color:#fff;font-size:22px;margin-top:6px}
        .sml-ach-panel{border-top:1px solid #22313d;padding:14px;background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(0,0,0,.08))}.sml-ach-head{display:flex;justify-content:space-between;gap:10px;align-items:end;margin-bottom:10px}.sml-ach-head h2{margin:0;color:#fff;font-size:20px}.sml-ach-head span{color:#95a6b5;font-size:12px;font-weight:850}.sml-ach-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.sml-ach-card{border:1px solid #22313d;background:#101a23;border-radius:8px;padding:12px}.sml-ach-card div:first-child{display:flex;justify-content:space-between;gap:8px;align-items:center}.sml-ach-card span{color:#95a6b5;font-size:10px;text-transform:uppercase;font-weight:950}.sml-ach-card strong{color:#fff;font-size:14px;text-align:right}.sml-ach-card p{margin:9px 0 8px;color:#dbe8f5;font-size:13px}.sml-ach-card small{display:block;color:#95a6b5;font-size:11px;margin-top:7px}.sml-ach-progress{height:9px;border:1px solid #2a3d4b;background:#05070b;border-radius:999px;overflow:hidden}.sml-ach-progress span{display:block;height:100%;background:linear-gradient(90deg,var(--sml-accent),#72d7ff)}.sml-ach-card-mythic .sml-ach-progress span{background:linear-gradient(90deg,#ff6bd6,#f5c542)}.sml-ach-ladder{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px;margin-top:10px}.sml-ach-dot{display:grid!important;place-items:center!important;width:100%;min-height:25px;border:1px solid #2a3d4b;border-radius:6px;background:#05070b;color:#5f7282!important;font-size:11px!important;font-weight:950!important;line-height:1;text-transform:none!important}.sml-ach-dot[data-unlocked="1"]{color:#05070b!important;box-shadow:0 0 14px rgba(98,243,166,.14)}.sml-ach-dot-bronze[data-unlocked="1"]{background:#f7c089;border-color:#9b6a3d}.sml-ach-dot-silver[data-unlocked="1"]{background:#e4edf5;border-color:#9aa7b5}.sml-ach-dot-gold[data-unlocked="1"]{background:#ffe793;border-color:#f5c542}.sml-ach-dot-platinum[data-unlocked="1"]{background:#b9ecff;border-color:#72d7ff}.sml-ach-dot-mythic[data-unlocked="1"]{background:linear-gradient(135deg,#ff6bd6,#f5c542);border-color:#ff6bd6}
        .sml-profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.sml-profile-panel{border:1px solid #22313d;background:var(--sml-card);border-radius:8px;padding:15px}
        .sml-profile-panel h2{margin:0 0 10px;color:#fff;font-size:21px}.sml-profile-pill{display:inline-flex;margin:0 7px 7px 0;border:1px solid #2a3d4b;background:#101a23;border-radius:999px;color:var(--sml-accent);padding:7px 9px;text-decoration:none;font-weight:950}
        .sml-profile-muted{color:#95a6b5}.sml-profile-edit{display:none}.sml-profile[data-own="1"] .sml-profile-edit{display:block}.sml-profile[data-own="1"] [data-follow-button]{display:none}.sml-profile[data-preview="1"] .sml-profile-edit{display:none!important}
        .sml-profile-preview-bar{display:none;align-items:center;justify-content:space-between;gap:10px;margin:12px 0;border:1px solid #2a3d4b;background:#101a23;border-radius:8px;padding:10px}.sml-profile[data-preview="1"] .sml-profile-preview-bar{display:flex}.sml-profile [data-edit-profile],.sml-profile [data-preview-follow]{display:none}.sml-profile[data-preview="1"] [data-edit-profile],.sml-profile[data-preview="1"] [data-preview-follow]{display:inline-flex}.sml-profile[data-preview="1"] [data-preview-profile]{display:none}
        .sml-profile-form{display:grid;gap:9px}.sml-profile-form input,.sml-profile-form textarea,.sml-profile-form select{width:100%;background:#090f15;color:#fff;border:1px solid #2a3d4b;border-radius:6px;padding:10px}
        .sml-profile-form textarea{min-height:92px;resize:vertical}.sml-profile-file input{display:none}.sml-profile-status{color:var(--sml-accent);font-size:12px;font-weight:850}
        .sml-profile-subhead{color:#fff;font-size:12px;font-weight:950;text-transform:uppercase;letter-spacing:.02em;margin-top:5px}.sml-profile-check{display:flex;gap:8px;align-items:center;color:#b8c5d2;font-size:12px;font-weight:850}.sml-profile-check input{width:auto!important}
        .sml-profile-socials{display:flex;flex-wrap:wrap;gap:8px}.sml-social-button,.sml-social-connect-row button{display:inline-flex;align-items:center;gap:8px;border:1px solid color-mix(in srgb,var(--social-color),#22313d 45%);background:#101a23;color:#fff;border-radius:999px;padding:8px 10px;text-decoration:none;font-weight:950}.sml-social-icon{display:inline-grid;place-items:center;width:25px;height:25px;border-radius:999px;background:#05070b;border:1px solid color-mix(in srgb,var(--social-color),#fff 18%);color:#fff;font-size:12px;font-weight:950;line-height:1;overflow:hidden}.sml-social-icon img{width:17px;height:17px;object-fit:contain;display:block}.sml-social-connect-row{display:grid;grid-template-columns:170px 1fr;gap:8px;align-items:center}.sml-social-connect-row input:focus{border-color:var(--social-color);box-shadow:0 0 0 2px color-mix(in srgb,var(--social-color),transparent 78%)}
        .sml-myspace-player{border:1px solid #2a3d4b;background:linear-gradient(135deg,#070b10,#111a24);border-radius:8px;padding:11px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.03)}.sml-player-head{display:grid;grid-template-columns:76px 1fr;gap:11px;align-items:center}.sml-player-art{position:relative;display:grid;place-items:center;width:76px;height:76px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:radial-gradient(circle at 35% 25%,var(--sml-accent),#0b1118 64%);color:#06100b;font-size:19px;font-weight:950;overflow:hidden}.sml-player-art:after{content:"";position:absolute;inset:10px;border:2px solid rgba(5,7,11,.55);border-radius:999px}.sml-player-title{display:block;color:#fff;font-size:18px;font-weight:950;line-height:1.15}.sml-player-meta{display:block;color:#95a6b5;font-size:12px;margin-top:5px}.sml-player-eq{display:flex;gap:3px;align-items:end;height:22px;margin-top:8px}.sml-player-eq span{display:block;width:5px;height:8px;background:var(--sml-accent);border-radius:999px;animation:smlPlayerEq 1.2s ease-in-out infinite}.sml-player-eq span:nth-child(2){animation-delay:.15s}.sml-player-eq span:nth-child(3){animation-delay:.3s}.sml-player-eq span:nth-child(4){animation-delay:.45s}.sml-player-eq span:nth-child(5){animation-delay:.6s}@keyframes smlPlayerEq{0%,100%{height:7px;opacity:.55}50%{height:22px;opacity:1}}.sml-player-progress{height:7px;background:#05070b;border:1px solid #22313d;border-radius:999px;overflow:hidden;margin-top:11px}.sml-player-progress span{display:block;width:38%;height:100%;background:linear-gradient(90deg,var(--sml-accent),#72d7ff);animation:smlPlayerProgress 5.5s linear infinite}@keyframes smlPlayerProgress{0%{transform:translateX(-105%)}100%{transform:translateX(270%)}}
        .sml-profile-music iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:8px;background:#05070b}.sml-music-stage{position:relative;border-radius:8px;overflow:hidden;background:#05070b;margin-top:10px}.sml-music-empty{display:none;min-height:150px;place-items:center;text-align:center;color:#95a6b5;border:1px dashed #2a3d4b;border-radius:8px;background:#090f15;padding:16px}.sml-profile-music[data-has-music="0"] iframe{display:none}.sml-profile-music[data-has-music="0"] .sml-music-empty{display:grid}.sml-profile-music[data-has-music="1"] .sml-music-empty{display:none}.sml-music-autoplay-note{position:absolute;left:10px;bottom:10px;background:rgba(5,7,11,.86);border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:999px;padding:8px 10px;font-size:12px;font-weight:950}.sml-profile-music-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:9px}.sml-profile-music-controls input{accent-color:var(--sml-accent)}.sml-music-track-list{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.sml-music-track-list button{padding:7px 9px;font-size:12px}.sml-music-track-list button[data-active="1"]{border-color:var(--sml-accent);color:var(--sml-accent)}
        .sml-profile-pinned-image{display:grid;place-items:center;min-height:180px;border:1px solid #22313d;background:#101a23;border-radius:8px;overflow:hidden}.sml-profile-pinned-image img{width:100%;max-height:360px;object-fit:cover;display:block}
        .sml-profile-album{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.sml-profile-photo{position:relative;min-height:92px;border:1px solid #22313d;border-radius:8px;overflow:hidden;background:#101a23}.sml-profile-photo img{width:100%;height:100%;aspect-ratio:1;object-fit:cover;display:block}.sml-profile-photo button{position:absolute;right:5px;bottom:5px;padding:6px 7px;font-size:11px;background:rgba(6,16,11,.9);border-color:var(--sml-accent);color:var(--sml-accent)}
        .sml-profile-post{border:1px solid #22313d;background:#101a23;border-radius:8px;padding:10px;margin:8px 0}.sml-profile-post strong{display:block;color:var(--sml-accent);font-size:12px}.sml-profile-post p{margin:6px 0;color:#dbe8f5}.sml-profile-post a{color:#72d7ff;text-decoration:none;font-weight:900}.sml-profile-post button{margin-left:8px;padding:7px 8px}
        .sml-profile-chart{grid-column:1/-1}.sml-chart-shell{display:grid;grid-template-columns:minmax(0,.82fr) minmax(280px,.38fr);gap:12px;align-items:start}.sml-chart-composer{border:1px solid #2a3d4b;background:linear-gradient(135deg,rgba(16,26,35,.98),rgba(5,7,11,.98));border-radius:8px;padding:12px}.sml-chart-composer textarea{width:100%;min-height:96px;background:#05070b;color:#fff;border:1px solid #2a3d4b;border-radius:6px;padding:11px;resize:vertical}.sml-chart-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:9px}.sml-chart-hint{color:#95a6b5;font-size:12px;font-weight:800}.sml-chart-status{color:var(--sml-accent);font-size:12px;font-weight:900}.sml-chart-list{display:grid;gap:10px}.sml-chart-post{display:grid;grid-template-columns:46px 1fr;gap:10px;border:1px solid #22313d;background:#101a23;border-radius:8px;padding:11px}.sml-chart-post img{width:46px;height:46px;border-radius:999px;object-fit:cover;border:2px solid var(--sml-accent);background:#17212b}.sml-chart-post strong{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.sml-chart-post strong a{color:#fff;text-decoration:none}.sml-chart-post time{display:block;color:#95a6b5;font-size:11px;margin-top:2px}.sml-chart-post p{margin:8px 0;color:#dbe8f5}.sml-chart-mention{color:#f5c542;text-decoration:none;font-weight:950}.sml-chart-tags,.sml-chart-hashtags,.sml-chart-like-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.sml-chart-tags a,.sml-chart-hashtags span{border:1px solid #2a3d4b;border-radius:999px;padding:5px 8px;font-size:12px;font-weight:950;text-decoration:none}.sml-chart-tags a{color:var(--sml-accent);background:#07110c}.sml-chart-hashtags span{color:#72d7ff;background:#07121b}.sml-chart-like-row{margin-top:8px}.sml-chart-like-row button{padding:6px 9px;font-size:12px}.sml-chart-like-row button[data-liked="1"]{border-color:var(--sml-accent);color:var(--sml-accent);box-shadow:0 0 12px rgba(98,243,166,.16)}.sml-chart-like-row span{color:#95a6b5;font-size:12px;font-weight:900}.sml-chart-empty{border:1px dashed #2a3d4b;background:#090f15;color:#95a6b5;border-radius:8px;padding:18px;text-align:center}.sml-chart-side{border:1px solid #22313d;background:#101a23;border-radius:8px;padding:12px}.sml-chart-side strong{display:block;color:#fff;margin-bottom:6px}.sml-chart-side p{margin:0;color:#95a6b5;font-size:13px}
        .sml-profile-studio{grid-template-columns:1.15fr .85fr}.sml-studio-hero{grid-column:1/-1;border:1px solid color-mix(in srgb,var(--sml-accent),#22313d 55%);background:linear-gradient(135deg,#111923,#06080c 58%,color-mix(in srgb,var(--sml-accent),#05070b 82%));border-radius:8px;padding:17px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;box-shadow:0 0 28px color-mix(in srgb,var(--sml-accent),transparent 82%)}.sml-studio-hero span{color:var(--sml-accent);font-size:11px;text-transform:uppercase;font-weight:950;letter-spacing:.08em}.sml-studio-hero h2{margin:4px 0;color:#fff;font-size:26px}.sml-studio-hero p{margin:0;color:#b8c5d2}.sml-studio-badge{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);border-radius:999px;padding:9px 12px;color:#fff;font-weight:950;white-space:nowrap}.sml-studio-window{position:relative;overflow:hidden;padding:0}.sml-studio-titlebar{display:flex;justify-content:space-between;gap:8px;align-items:center;background:linear-gradient(90deg,var(--sml-accent),#72d7ff);color:#06100b;padding:9px 12px;font-weight:950}.sml-studio-titlebar em{font-style:normal;font-size:11px;opacity:.78}.sml-studio-body{padding:14px;display:grid;gap:11px}.sml-studio-field{display:grid;gap:5px;color:#95a6b5;font-size:12px;font-weight:900}.sml-studio-field span{color:#dbe8f5}.sml-studio-field input,.sml-studio-field textarea,.sml-studio-field select{margin-top:0}.sml-studio-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.sml-studio-theme-deck{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.sml-studio-theme-deck button{min-height:64px;border-color:#2a3d4b;text-align:left;padding:8px;display:flex;align-items:end}.sml-studio-theme-deck button span{display:block;color:#fff;font-size:11px;line-height:1.1;text-shadow:0 1px 2px #000}.sml-studio-theme-deck button[data-theme-preset="green"]{background:linear-gradient(135deg,#05070b,#0c3420,#62f3a6)}.sml-studio-theme-deck button[data-theme-preset="blue"]{background:linear-gradient(135deg,#05070b,#10274e,#72d7ff)}.sml-studio-theme-deck button[data-theme-preset="gold"]{background:linear-gradient(135deg,#05070b,#392c0d,#f5c542)}.sml-studio-theme-deck button[data-theme-preset="red"]{background:linear-gradient(135deg,#05070b,#3d1219,#ff5264)}.sml-studio-color-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.sml-studio-color-row label{font-size:11px;color:#95a6b5;font-weight:900}.sml-studio-color-row input{height:42px;padding:3px}.sml-studio-upload-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sml-studio-note{border:1px dashed #2a3d4b;background:#090f15;border-radius:8px;padding:10px;color:#95a6b5;font-size:12px;line-height:1.45}
        @media(max-width:760px){.sml-profile-card,.sml-profile-grid,.sml-profile-stats,.sml-ach-grid,.sml-social-connect-row,.sml-chart-shell,.sml-profile-studio,.sml-studio-grid,.sml-studio-theme-deck,.sml-studio-color-row,.sml-studio-upload-grid{grid-template-columns:1fr}.sml-profile-actions{justify-content:flex-start}.sml-profile h1{font-size:31px}.sml-studio-hero{grid-template-columns:1fr}}
      </style>
      <div class="sml-profile-shell">
        <section class="sml-profile-hero">
          <div class="sml-profile-banner">
            <div class="sml-profile-card">
              <img class="sml-profile-avatar" data-avatar-preview src="<?php echo esc_url($profile['avatar_url']); ?>" alt="">
              <div>
                <h1 data-display-name-view><?php echo esc_html($display_name); ?></h1>
                <div class="sml-profile-identity">
                  <span data-public-handle-view><?php echo esc_html($public_handle); ?></span>
                  <span data-username-view>Username: <?php echo esc_html($profile['username']); ?></span>
                  <span data-real-name-view <?php echo $real_name ? '' : 'hidden'; ?>><?php echo esc_html($real_name); ?></span>
                </div>
                <div class="sml-profile-badge-rail" data-achievement-badges><?php echo wp_kses_post($badge_rail_html); ?></div>
                <div class="sml-profile-tagline" data-tagline-view><?php echo esc_html($profile['tagline'] ?: 'Stockmarketloop member'); ?></div>
                <p data-bio-view><?php echo esc_html($profile['bio'] ?: 'Building a market watchlist and joining ticker streams.'); ?></p>
              </div>
              <div class="sml-profile-actions">
                <button class="sml-primary" data-follow-button><?php echo $profile['is_following'] ? 'Following' : 'Follow'; ?></button>
                <?php if ($profile['is_own_profile']) : ?>
                  <button class="sml-primary" type="button" data-preview-follow disabled>Follow</button>
                  <button type="button" data-preview-profile>View as Visitor</button>
                  <button type="button" data-edit-profile>Back to Edit</button>
                <?php endif; ?>
                <button data-copy-profile>Copy Profile</button>
              </div>
            </div>
          </div>
          <div class="sml-profile-stats">
            <div class="sml-profile-stat"><span>Followers</span><strong data-followers-count><?php echo esc_html($profile['followers_count']); ?></strong></div>
            <div class="sml-profile-stat"><span>Following</span><strong><?php echo esc_html($profile['following_count']); ?></strong></div>
            <div class="sml-profile-stat"><span>Watchlist</span><strong><?php echo esc_html(count($profile['watchlist'])); ?></strong></div>
            <div class="sml-profile-stat"><span>Chart</span><strong data-chart-count><?php echo esc_html($profile['chart_count']); ?></strong></div>
            <div class="sml-profile-stat"><span>Total Posts</span><strong data-ach-stat-posts><?php echo esc_html(number_format((int) $profile['total_posts'])); ?></strong></div>
            <div class="sml-profile-stat"><span>Profile Views</span><strong data-ach-stat-views><?php echo esc_html(number_format((int) $profile['profile_views'])); ?></strong></div>
            <div class="sml-profile-stat"><span>Likes Received</span><strong data-ach-stat-likes><?php echo esc_html(number_format((int) $profile['likes_received'])); ?></strong></div>
            <div class="sml-profile-stat"><span>Loop Bucks</span><strong data-ach-stat-credits><?php echo esc_html(number_format((int) $profile['loop_bucks'])); ?></strong></div>
          </div>
          <div class="sml-ach-panel" id="achievements">
            <div class="sml-ach-head">
              <div><h2>Achievement Tracks</h2><span>Posts, profile views and likes unlock badges, titles, themes and Loop Bucks.</span></div>
              <span>7 levels per track</span>
            </div>
            <div class="sml-ach-grid" data-achievement-grid><?php echo wp_kses_post($achievement_cards_html); ?></div>
          </div>
        </section>
        <?php if ($profile['is_own_profile']) : ?>
          <div class="sml-profile-preview-bar" data-preview-bar>
            <span class="sml-profile-muted">Visitor preview is on. Edit panels are hidden so you can check the public profile experience.</span>
            <button type="button" data-edit-profile>Back to Edit</button>
          </div>
        <?php endif; ?>
        <section class="sml-profile-grid">
          <div class="sml-profile-panel"><h2>Watchlist</h2><p><?php echo wp_kses_post($watchlist); ?></p></div>
          <div class="sml-profile-panel"><h2>Connected Platforms</h2><div class="sml-profile-socials" data-social-buttons><?php echo $social_buttons_html; ?></div></div>
        </section>
        <section class="sml-profile-grid" id="chart">
          <div class="sml-profile-panel sml-profile-chart">
            <h2>Chart</h2>
            <div class="sml-chart-shell">
              <div>
                <?php if (is_user_logged_in()) : ?>
                  <div class="sml-chart-composer">
                    <textarea data-chart-input maxlength="900" placeholder="Post to this Chart. Add $tickers, #setups, trade notes, screenshots, or market thoughts."></textarea>
                    <div class="sml-chart-actions">
                      <span class="sml-chart-hint">This is the profile wall for market posts.</span>
                      <button class="sml-primary" type="button" data-chart-post>Post to Chart</button>
                    </div>
                    <div class="sml-chart-status" data-chart-status></div>
                  </div>
                <?php else : ?>
                  <div class="sml-chart-composer"><p class="sml-profile-muted">Sign in to post on this Chart and join the profile conversation.</p></div>
                <?php endif; ?>
                <div class="sml-chart-list" data-chart-list><?php echo $chart_posts_html; ?></div>
              </div>
              <aside class="sml-chart-side">
                <strong>What goes on the Chart?</strong>
                <p>Profile updates, watchlist thoughts, $ticker notes, trading screenshots and replies from other signed-in Stockmarketloop members.</p>
              </aside>
            </div>
          </div>
        </section>
        <section class="sml-profile-grid">
          <div class="sml-profile-panel sml-profile-music" data-music-box data-has-music="<?php echo $music_has_tracks ? '1' : '0'; ?>">
            <h2>Traders in the Zone</h2>
            <div class="sml-myspace-player" data-music-shell>
              <div class="sml-player-head">
                <div class="sml-player-art"><span>SML</span></div>
                <div>
                  <strong class="sml-player-title" data-music-title><?php echo esc_html($music_has_tracks ? $music_first_title : 'No in-the-zone music yet'); ?></strong>
                  <span class="sml-player-meta" data-music-caption><?php echo esc_html($music_has_tracks ? 'Showing traders what ' . $display_name . ' listens to in the zone.' : 'Add YouTube tracks to show other traders what gets you in the zone.'); ?></span>
                  <div class="sml-player-eq" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
                </div>
              </div>
              <div class="sml-player-progress"><span></span></div>
              <div class="sml-music-stage">
                <iframe id="sml-profile-music-player" data-music-frame src="<?php echo esc_url($music_first_embed); ?>" allow="autoplay; encrypted-media" allowfullscreen></iframe>
                <div class="sml-music-empty" data-music-empty>Add up to 5 YouTube links in Profile Studio so other traders can see your in-the-zone music.</div>
                <button class="sml-music-autoplay-note" type="button" data-music-unmute><?php echo $music_has_tracks ? 'Play / Unmute in-the-zone music' : 'Waiting for in-the-zone track'; ?></button>
              </div>
              <div class="sml-profile-music-controls">
                <button type="button" data-music-play>Play</button>
                <button type="button" data-music-pause>Pause</button>
                <button type="button" data-music-next>Next</button>
                <label class="sml-profile-muted">Volume <input type="range" min="0" max="100" value="55" data-music-volume></label>
              </div>
              <div class="sml-music-track-list" data-music-track-list><?php echo $music_tracks_html; ?></div>
            </div>
          </div>
          <div class="sml-profile-panel">
            <h2>Pinned Image</h2>
            <div class="sml-profile-pinned-image" data-pinned-image><?php echo $pinned_image_html; ?></div>
          </div>
        </section>
        <section class="sml-profile-grid">
          <div class="sml-profile-panel"><h2>Recent Photos</h2><div class="sml-profile-album" data-profile-album><?php echo $album_html; ?></div></div>
          <div class="sml-profile-panel"><h2>Pinned Ticker Post</h2><div data-pinned-post-view><?php echo $pinned_post_html; ?></div></div>
        </section>
        <section class="sml-profile-grid">
          <div class="sml-profile-panel"><h2>Recent Ticker Posts</h2><div data-recent-posts><?php echo $recent_posts_html; ?></div></div>
          <div class="sml-profile-panel"><h2>Profile Activity</h2><p class="sml-profile-muted">Chart posts, photos, pinned calls, watchlist comments and followers all live on this member page.</p></div>
        </section>
        <section class="sml-profile-grid sml-profile-edit sml-profile-studio">
          <div class="sml-studio-hero">
            <div>
              <span>Profile Studio</span>
              <h2>Build the room traders land in.</h2>
              <p>Your colors, banner, music, pinned photos, links and Chart all shape the page.</p>
            </div>
            <div class="sml-studio-badge">Top 8 energy, market edition</div>
          </div>
          <div class="sml-profile-panel sml-studio-window">
            <div class="sml-studio-titlebar"><span>Identity + Theme</span><em>Public profile controls</em></div>
            <div class="sml-profile-form sml-studio-body">
              <div class="sml-studio-grid">
                <label class="sml-studio-field"><span>Account username</span><input value="<?php echo esc_attr($profile['username']); ?>" readonly aria-label="Account username"></label>
                <label class="sml-studio-field"><span>Display name</span><input data-profile-handle value="<?php echo esc_attr($display_name); ?>" maxlength="32" placeholder="Display username"></label>
                <label class="sml-studio-field"><span>@ handle</span><input data-profile-public-handle value="<?php echo esc_attr($profile['public_handle']); ?>" maxlength="30" placeholder="@ handle"></label>
                <label class="sml-studio-field"><span>Profile tagline</span><input data-profile-tagline value="<?php echo esc_attr($profile['tagline']); ?>" maxlength="80" placeholder="Momentum trader | Long AI | Options flow"></label>
                <label class="sml-studio-field"><span>First name</span><input data-profile-first-name value="<?php echo esc_attr($profile['first_name']); ?>" maxlength="50" placeholder="First name"></label>
                <label class="sml-studio-field"><span>Last name</span><input data-profile-last-name value="<?php echo esc_attr($profile['last_name']); ?>" maxlength="50" placeholder="Last name"></label>
              </div>
              <label class="sml-profile-check"><input type="checkbox" data-profile-show-real-name <?php checked($profile['show_real_name']); ?>> Show my first and last name</label>
              <label class="sml-studio-field"><span>Trading bio</span><textarea data-profile-bio maxlength="280" placeholder="Short trading bio"><?php echo esc_textarea($profile['bio']); ?></textarea></label>
              <div class="sml-profile-subhead">Theme Deck</div>
              <div class="sml-studio-theme-deck">
                <button type="button" data-theme-preset="green"><span>Green market glow</span></button>
                <button type="button" data-theme-preset="blue"><span>Blue terminal</span></button>
                <button type="button" data-theme-preset="gold"><span>Gold watchlist</span></button>
                <button type="button" data-theme-preset="red"><span>Red momentum</span></button>
              </div>
              <label class="sml-studio-field"><span>Saved theme</span><select data-profile-theme>
                <option value="green" <?php selected($profile['theme'], 'green'); ?>>Green market glow</option>
                <option value="blue" <?php selected($profile['theme'], 'blue'); ?>>Blue terminal</option>
                <option value="gold" <?php selected($profile['theme'], 'gold'); ?>>Gold watchlist</option>
                <option value="red" <?php selected($profile['theme'], 'red'); ?>>Red momentum</option>
              </select></label>
              <label class="sml-studio-field"><span>Profile font</span><select data-profile-font>
                <option value="inter" <?php selected($profile['font'], 'inter'); ?>>Modern terminal</option>
                <option value="arial" <?php selected($profile['font'], 'arial'); ?>>Clean classic</option>
                <option value="georgia" <?php selected($profile['font'], 'georgia'); ?>>Editorial serif</option>
                <option value="courier" <?php selected($profile['font'], 'courier'); ?>>Ticker monospace</option>
                <option value="trebuchet" <?php selected($profile['font'], 'trebuchet'); ?>>MySpace clean</option>
                <option value="impact" <?php selected($profile['font'], 'impact'); ?>>Loud headline</option>
              </select></label>
              <div class="sml-studio-color-row">
                <label>Accent<input type="color" data-profile-accent value="<?php echo esc_attr($accent); ?>"></label>
                <label>Background<input type="color" data-profile-background value="<?php echo esc_attr($background_color); ?>"></label>
                <label>Text<input type="color" data-profile-text-color value="<?php echo esc_attr($text_color); ?>"></label>
                <label>Panel<input type="color" data-profile-card-color value="<?php echo esc_attr($card_color); ?>"></label>
              </div>
              <div class="sml-profile-subhead">Traders in the Zone Music</div>
              <?php echo $music_slots_html; ?>
              <label class="sml-profile-check"><input type="checkbox" data-profile-music-autoplay <?php checked($profile['music_autoplay']); ?>> Autoplay when profile opens</label>
              <button class="sml-primary" data-save-profile>Save Profile</button>
              <button type="button" data-save-preview>Save & View as Visitor</button>
              <span class="sml-profile-status" data-profile-status></span>
            </div>
          </div>
          <div class="sml-profile-panel sml-studio-window">
            <div class="sml-studio-titlebar"><span>Social Dock</span><em>Profile links</em></div>
            <div class="sml-profile-form sml-studio-body" data-social-link-form>
              <?php echo $social_fields_html; ?>
            </div>
          </div>
          <div class="sml-profile-panel sml-studio-window">
            <div class="sml-studio-titlebar"><span>Image Locker</span><em>Avatar, banner, album, pin</em></div>
            <div class="sml-studio-body">
              <div class="sml-studio-upload-grid">
                <label class="sml-profile-file">Avatar<input type="file" data-image-upload="avatar" accept="image/png,image/jpeg,image/webp,image/gif"></label>
                <label class="sml-profile-file">Banner<input type="file" data-image-upload="banner" accept="image/png,image/jpeg,image/webp,image/gif"></label>
                <label class="sml-profile-file">Album photo<input type="file" data-image-upload="album" accept="image/png,image/jpeg,image/webp,image/gif"></label>
                <label class="sml-profile-file">Pinned photo<input type="file" data-image-upload="pinned" accept="image/png,image/jpeg,image/webp,image/gif"></label>
              </div>
              <div class="sml-studio-note">Images stay under 8MB. Avatar uploads refresh instantly; banner and pinned photo make the profile feel less generic fast.</div>
            </div>
          </div>
        </section>
      </div>
      <script src="https://www.youtube.com/iframe_api"></script>
      <script>
      (function(){
        var root=document.querySelector("[data-sml-profile]"),nonce="<?php echo esc_js($nonce); ?>";
        if(!root)return;
        var musicRows=<?php echo wp_json_encode($music_playlist); ?>||[],chartRows=<?php echo wp_json_encode($chart_posts); ?>||[],socialPlatforms=<?php echo wp_json_encode($social_platforms); ?>||{},activeTrack=0,player=null,profileName="<?php echo esc_js($display_name); ?>";
        function api(path,opts){opts=opts||{};opts.credentials="same-origin";opts.headers=Object.assign({"X-WP-Nonce":nonce,"Content-Type":"application/json"},opts.headers||{});return fetch("/wp-json/sml-members/v1/"+path,opts).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});});}
        function status(t){var s=root.querySelector("[data-profile-status]");if(s)s.textContent=t||"";}
        function esc(s){return String(s||"").replace(/[<>&"]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c];});}
        function chartStatus(t){var s=root.querySelector("[data-chart-status]");if(s)s.textContent=t||"";}
        function formatChartText(text){return esc(text).replace(/\$([A-Z0-9.]{1,8})\b/g,function(m,s){return '<a href="/stock-chart/?symbol='+encodeURIComponent(s)+'">$'+s+'</a>';}).replace(/#([A-Za-z0-9_]{2,32})\b/g,function(m,s){return '<span>#'+esc(s.toLowerCase())+'</span>';}).replace(/@([A-Za-z0-9_.]{2,30})\b/g,function(m,s){return '<a class="sml-chart-mention" href="/?s='+encodeURIComponent("@"+s)+'">@'+esc(s)+'</a>';});}
        function badgeChip(badge){if(!badge||!badge.current_level)return"";return '<span class="sml-ach-badge sml-ach-'+esc(badge.current_tier||"locked")+'" title="'+esc((badge.label||"Badge")+" Level "+badge.current_level)+'">'+esc(badge.current_name||"Badge")+'</span>';}
        function candle(dir){return '<span class="sml-candle sml-candle-'+esc(dir)+'"><i></i></span>';}
        function voteControls(row){var up=parseInt(row.upvote_count,10)||0,down=parseInt(row.downvote_count,10)||0,score=parseInt(row.vote_score,10);if(isNaN(score))score=up-down;var viewer=row.viewer_vote||"";return '<div class="sml-vote-row"><button type="button" data-chart-vote="up" data-post-id="'+esc(row.id||"")+'" data-active="'+(viewer==="up"?"1":"0")+'">'+candle("up")+up+'</button><button type="button" data-chart-vote="down" data-post-id="'+esc(row.id||"")+'" data-active="'+(viewer==="down"?"1":"0")+'">'+candle("down")+down+'</button><span class="sml-vote-score">'+(score>=0?"+":"")+score+'</span><button type="button" data-chart-voters data-post-id="'+esc(row.id||"")+'">voters</button></div>';}
        function chartPostHtml(row){var tickers=(row.tickers||[]).map(function(s){return '<a href="/stock-chart/?symbol='+encodeURIComponent(s)+'">$'+esc(s)+'</a>';}).join(""),hashtags=(row.hashtags||[]).map(function(t){return '<span>#'+esc(t)+'</span>';}).join(""),date=row.date?new Date(row.date).toLocaleString():"",liked=row.viewer_liked?"1":"0",likes=parseInt(row.like_count,10)||0;return '<article class="sml-chart-post" data-chart-post-id="'+esc(row.id||"")+'"><img src="'+esc(row.avatar_url||"")+'" alt=""><div><strong><a href="'+esc(row.profile_url||"#")+'">'+esc(row.handle||"Member")+'</a>'+badgeChip(row.badge)+'</strong><time>'+esc(date)+'</time><p>'+formatChartText(row.text||"")+'</p>'+(tickers?'<div class="sml-chart-tags">'+tickers+'</div>':"")+(hashtags?'<div class="sml-chart-hashtags">'+hashtags+'</div>':"")+'<div class="sml-chart-like-row"><button type="button" data-chart-like="'+esc(row.id||"")+'" data-liked="'+liked+'">'+(liked==="1"?"Liked":"Like")+'</button><span>'+likes+' likes</span></div>'+voteControls(row)+'</div></article>';}
        function renderChart(rows){var list=root.querySelector("[data-chart-list]");if(!list)return;chartRows=rows||[];list.innerHTML=chartRows.length?chartRows.map(chartPostHtml).join(""):'<div class="sml-chart-empty">No Chart posts yet. This is where profile updates, trade notes, screenshots and market thoughts will live.</div>';}
        function loadChart(){api("profile-chart?user_id="+encodeURIComponent(root.dataset.userId)+"&_="+Date.now(),{headers:{"X-WP-Nonce":nonce}}).then(function(data){renderChart(data.posts||[]);if(data.count!==undefined){var c=root.querySelector("[data-chart-count]");if(c)c.textContent=data.count;}}).catch(function(){});}
        function postChart(){var input=root.querySelector("[data-chart-input]");if(!input)return;var text=input.value.trim();if(!text){chartStatus("Write something before posting.");return;}chartStatus("Posting to Chart...");api("profile-chart",{method:"POST",body:JSON.stringify({user_id:root.dataset.userId,text:text})}).then(function(data){input.value="";renderChart(data.posts||[]);if(data.count!==undefined){var c=root.querySelector("[data-chart-count]");if(c)c.textContent=data.count;}var stat=root.querySelector("[data-ach-stat-posts]");if(stat){var n=parseInt(String(stat.textContent).replace(/,/g,""),10)||0;stat.textContent=(n+1).toLocaleString();}chartStatus("Posted to Chart.");}).catch(function(){chartStatus("Could not post to Chart.");});}
        function likeChart(postId){if(!postId)return;chartStatus("Updating like...");api("profile-chart-like",{method:"POST",body:JSON.stringify({user_id:root.dataset.userId,post_id:postId})}).then(function(data){renderChart(data.posts||[]);chartStatus(data.liked?"Liked.":"Like removed.");}).catch(function(err){chartStatus(err.message||"Sign in to like Chart posts.");});}
        function voteChart(postId,vote){if(!postId)return;chartStatus("Updating vote...");api("post-vote",{method:"POST",body:JSON.stringify({target_type:"chart",target_id:postId,user_id:root.dataset.userId,vote:vote})}).then(function(data){renderChart(data.posts||[]);chartStatus("Vote updated.");}).catch(function(err){chartStatus(err.message||"Sign in to vote on Chart posts.");});}
        function drawChartVoters(holder,data){if(!holder)return;holder.querySelectorAll(".sml-voter-pop").forEach(function(x){x.remove();});function rows(title,items){return '<h4>'+esc(title)+'</h4>'+((items||[]).length?(items||[]).slice(0,12).map(function(u){return '<a href="'+esc(u.profile_url||"#")+'"><img src="'+esc(u.avatar_url||"")+'" alt=""><span>'+esc(u.handle||"Member")+'</span></a>';}).join(""):'<small>No voters yet.</small>');}holder.insertAdjacentHTML("beforeend",'<div class="sml-voter-pop">'+rows("Green candle upvotes",data.upvoters||[])+rows("Red candle downvotes",data.downvoters||[])+'</div>');}
        function loadChartVoters(postId,holder){api("post-voters?target_type=chart&target_id="+encodeURIComponent(postId||"")+"&user_id="+encodeURIComponent(root.dataset.userId)+"&_="+Date.now()).then(function(data){drawChartVoters(holder,data);}).catch(function(err){chartStatus(err.message||"Could not load voters.");});}
        function profileMusicPlaylist(){var rows=[];root.querySelectorAll("[data-profile-music-slot]").forEach(function(input){var url=input.value.trim();if(url)rows.push({url:url,title:"Track "+(rows.length+1)});});return rows.slice(0,5);}
        function profileSocialLinks(){var links={};root.querySelectorAll("[data-social-link]").forEach(function(input){var url=input.value.trim();if(url)links[input.dataset.socialLink]=url;});return links;}
        function profilePayload(extra){extra=extra||{};var music=profileMusicPlaylist();return Object.assign({handle:root.querySelector("[data-profile-handle]")?root.querySelector("[data-profile-handle]").value:"",public_handle:root.querySelector("[data-profile-public-handle]")?root.querySelector("[data-profile-public-handle]").value:"",first_name:root.querySelector("[data-profile-first-name]")?root.querySelector("[data-profile-first-name]").value:"",last_name:root.querySelector("[data-profile-last-name]")?root.querySelector("[data-profile-last-name]").value:"",show_real_name:root.querySelector("[data-profile-show-real-name]")?root.querySelector("[data-profile-show-real-name]").checked:false,tagline:root.querySelector("[data-profile-tagline]")?root.querySelector("[data-profile-tagline]").value:"",bio:root.querySelector("[data-profile-bio]")?root.querySelector("[data-profile-bio]").value:"",theme:root.querySelector("[data-profile-theme]")?root.querySelector("[data-profile-theme]").value:"green",font:root.querySelector("[data-profile-font]")?root.querySelector("[data-profile-font]").value:"inter",accent_color:root.querySelector("[data-profile-accent]")?root.querySelector("[data-profile-accent]").value:"",background_color:root.querySelector("[data-profile-background]")?root.querySelector("[data-profile-background]").value:"",text_color:root.querySelector("[data-profile-text-color]")?root.querySelector("[data-profile-text-color]").value:"",card_color:root.querySelector("[data-profile-card-color]")?root.querySelector("[data-profile-card-color]").value:"",music_url:music[0]?music[0].url:"",music_playlist:music,music_autoplay:root.querySelector("[data-profile-music-autoplay]")?root.querySelector("[data-profile-music-autoplay]").checked:false,social_links:profileSocialLinks()},extra);}
        var themePresets={green:{accent:"#62f3a6",background:"#05070b",text:"#f4f7fb",card:"#0d141b"},blue:{accent:"#72d7ff",background:"#050812",text:"#f4f7fb",card:"#0d1826"},gold:{accent:"#f5c542",background:"#070603",text:"#fff8df",card:"#171207"},red:{accent:"#ff5264",background:"#090506",text:"#fff4f5",card:"#1a0d11"}};
        function setStudioInput(selector,value){var input=root.querySelector(selector);if(input)input.value=value;}
        function applyThemePreset(name){var preset=themePresets[name];if(!preset)return;setStudioInput("[data-profile-theme]",name);setStudioInput("[data-profile-accent]",preset.accent);setStudioInput("[data-profile-background]",preset.background);setStudioInput("[data-profile-text-color]",preset.text);setStudioInput("[data-profile-card-color]",preset.card);root.style.setProperty("--sml-accent",preset.accent);root.style.setProperty("--sml-bg",preset.background);root.style.setProperty("--sml-text",preset.text);root.style.setProperty("--sml-card",preset.card);status("Theme deck changed. Save Profile to keep it.");}
        function socialIconHtml(p){return p.icon?'<img src="'+esc(p.icon)+'" alt="">':esc(p.glyph||"");}
        function socialButtonHtml(key,url){var p=socialPlatforms[key]||{label:key,glyph:key.slice(0,1),color:"#72d7ff"};return '<a class="sml-social-button" style="--social-color:'+esc(p.color)+'" href="'+esc(url)+'" target="_blank" rel="me noopener noreferrer"><span class="sml-social-icon">'+socialIconHtml(p)+'</span><span>'+esc(p.label)+'</span></a>';}
        function renderSocials(profile){var box=root.querySelector("[data-social-buttons]");if(!box)return;var links=profile.social_links||{},html="";Object.keys(socialPlatforms).forEach(function(key){if(links[key])html+=socialButtonHtml(key,links[key]);});box.innerHTML=html||'<p class="sml-profile-muted">No connected social platforms yet.</p>';}
        function youtubeVideoId(url){var m=String(url||"").match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{6,})/i);return m?m[1]:"";}
        function youtubePlaylistId(url){try{var u=new URL(url);return (u.searchParams.get("list")||"").replace(/[^A-Za-z0-9_-]/g,"");}catch(e){return "";}}
        function musicEmbedUrl(track,autoplay,mute){if(!track)return"";var base=track.embed_url||"",list=track.playlist_id||youtubePlaylistId(track.url),video=track.video_id||youtubeVideoId(track.url);if(!base&&list)base="https://www.youtube.com/embed/videoseries?list="+encodeURIComponent(list);if(!base&&video)base="https://www.youtube.com/embed/"+encodeURIComponent(video);if(!base)return"";try{var u=new URL(base);u.searchParams.set("enablejsapi","1");u.searchParams.set("rel","0");u.searchParams.set("playsinline","1");if(autoplay)u.searchParams.set("autoplay","1");if(mute)u.searchParams.set("mute","1");return u.toString();}catch(e){return base;}}
        function renderMusicList(rows){var list=root.querySelector("[data-music-track-list]");if(!list)return;list.innerHTML=rows.length?rows.map(function(track,i){return '<button type="button" data-music-track="'+i+'" data-active="'+(i===activeTrack?"1":"0")+'">'+esc(track.title||("Track "+(i+1)))+'</button>';}).join(""):'<span class="sml-profile-muted">No in-the-zone tracks yet.</span>';}
        function updateMusicChrome(){var box=root.querySelector("[data-music-box]"),title=root.querySelector("[data-music-title]"),caption=root.querySelector("[data-music-caption]"),unmute=root.querySelector("[data-music-unmute]");if(box)box.dataset.hasMusic=musicRows.length?"1":"0";if(title)title.textContent=musicRows.length?(musicRows[activeTrack]&&musicRows[activeTrack].title?musicRows[activeTrack].title:"Track "+(activeTrack+1)):"No in-the-zone music yet";if(caption)caption.textContent=musicRows.length?"Showing traders what "+profileName+" listens to in the zone.":"Add YouTube tracks to show other traders what gets you in the zone.";if(unmute)unmute.textContent=musicRows.length?"Play / Unmute in-the-zone music":"Waiting for in-the-zone track";}
        function initMusicPlayer(){if(!musicRows.length||!window.YT||!YT.Player||player||!document.getElementById("sml-profile-music-player"))return;try{player=new YT.Player("sml-profile-music-player",{events:{onReady:function(){if(root.dataset.musicAutoplay==="1"){try{player.mute();player.playVideo();}catch(e){}}}}});}catch(e){}}
        function resetMusicPlayer(){if(player&&player.destroy){try{player.destroy();}catch(e){}}player=null;setTimeout(initMusicPlayer,450);}
        function setTrack(index,autoplay){var frame=root.querySelector("[data-music-frame]");if(!musicRows.length){if(frame)frame.removeAttribute("src");activeTrack=0;renderMusicList(musicRows);updateMusicChrome();return;}activeTrack=(index+musicRows.length)%musicRows.length;var track=musicRows[activeTrack];renderMusicList(musicRows);updateMusicChrome();if(player&&track.video_id&&player.loadVideoById){player.loadVideoById(track.video_id);if(!autoplay&&player.pauseVideo)player.pauseVideo();return;}if(frame){frame.src=musicEmbedUrl(track,autoplay,autoplay);resetMusicPlayer();}}
        function refreshMusicPlayer(rows,autoplay){musicRows=rows||[];activeTrack=0;renderMusicList(musicRows);updateMusicChrome();setTrack(0,!!autoplay);}
        function renderAlbum(profile){var box=root.querySelector("[data-profile-album]"); if(!box)return; var rows=(profile.album||[]).slice(0,5); box.innerHTML=rows.length?rows.map(function(i){return '<div class="sml-profile-photo"><img src="'+esc(i.url)+'" alt="Profile album image"><button type="button" data-pin-image="'+esc(i.url)+'">Pin</button></div>';}).join(""):'<p class="sml-profile-muted">No public profile images yet.</p>';}
        function renderPinnedImage(url){var box=root.querySelector("[data-pinned-image]"); if(box&&url)box.innerHTML='<img src="'+esc(url)+'" alt="Pinned profile image">';}
        function cacheBust(url){return url+(url.indexOf("?")>=0?"&":"?")+"smlv="+Date.now();}
        function refreshAvatar(url){if(!url)return;var fresh=cacheBust(url);root.querySelectorAll("[data-avatar-preview]").forEach(function(img){img.src=fresh;});document.querySelectorAll("[data-sml-global-avatar]").forEach(function(img){img.src=fresh;});}
        function refreshBanner(url){var banner=root.querySelector(".sml-profile-banner");if(banner&&url)banner.style.backgroundImage="linear-gradient(90deg,rgba(5,7,11,.35),rgba(5,7,11,.76)),url("+cacheBust(url)+")";}
        var follow=root.querySelector("[data-follow-button]");
        if(follow){follow.addEventListener("click",function(){var following=root.dataset.following==="1";api("follow",{method:"POST",body:JSON.stringify({user_id:root.dataset.userId,action:following?"unfollow":"follow"})}).then(function(r){root.dataset.following=r.following?"1":"0";follow.textContent=r.following?"Following":"Follow";root.querySelector("[data-followers-count]").textContent=r.followers_count;});});}
        var copy=root.querySelector("[data-copy-profile]"); if(copy){copy.addEventListener("click",function(){navigator.clipboard&&navigator.clipboard.writeText(location.href);copy.textContent="Copied";setTimeout(function(){copy.textContent="Copy Profile";},1600);});}
        function enterPreview(){root.dataset.preview="1";var url=new URL(location.href);url.searchParams.set("sml_view","visitor");history.replaceState(null,"",url.toString());window.scrollTo({top:0,behavior:"smooth"});}
        function exitPreview(){root.dataset.preview="0";var url=new URL(location.href);url.searchParams.delete("sml_view");history.replaceState(null,"",url.toString());}
        function applySavedProfile(p,viewAfter){var real=root.querySelector("[data-real-name-view]");profileName=p.display_name||p.handle||profileName;root.querySelector("[data-display-name-view]").textContent=profileName;root.querySelector("[data-public-handle-view]").textContent="@"+(p.public_handle||"");root.querySelector("[data-tagline-view]").textContent=p.tagline||"Stockmarketloop member";root.querySelector("[data-bio-view]").textContent=p.bio||"Building a market watchlist and joining ticker streams.";if(real){real.textContent=p.real_name||"";real.hidden=!p.real_name;}root.dataset.musicAutoplay=p.music_autoplay?"1":"0";root.style.setProperty("--sml-accent",p.accent_color||"<?php echo esc_js($accent); ?>");root.style.setProperty("--sml-bg",p.background_color||"<?php echo esc_js($background_color); ?>");root.style.setProperty("--sml-text",p.text_color||"<?php echo esc_js($text_color); ?>");root.style.setProperty("--sml-card",p.card_color||"<?php echo esc_js($card_color); ?>");renderSocials(p);refreshMusicPlayer(p.music_playlist||[],p.music_autoplay);if(viewAfter)enterPreview();status(viewAfter?"Profile saved. Visitor preview is on.":"Profile saved. Studio changes are live.");}
        function saveProfile(viewAfter){status("Saving...");api("profile",{method:"POST",body:JSON.stringify(profilePayload())}).then(function(p){applySavedProfile(p,viewAfter);}).catch(function(){status("Could not save profile.");});}
        var save=root.querySelector("[data-save-profile]"); if(save){save.addEventListener("click",function(){saveProfile(false);});}
        var savePreview=root.querySelector("[data-save-preview]"); if(savePreview){savePreview.addEventListener("click",function(){saveProfile(true);});}
        root.querySelectorAll("[data-preview-profile]").forEach(function(btn){btn.addEventListener("click",enterPreview);});
        root.querySelectorAll("[data-edit-profile]").forEach(function(btn){btn.addEventListener("click",exitPreview);});
        root.addEventListener("click",function(e){var img=e.target.closest("[data-pin-image]"),post=e.target.closest("[data-pin-post]"),like=e.target.closest("[data-chart-like]"),vote=e.target.closest("[data-chart-vote]"),voters=e.target.closest("[data-chart-voters]"); if(img){status("Pinning image...");api("profile",{method:"POST",body:JSON.stringify(profilePayload({pinned_image_url:img.dataset.pinImage}))}).then(function(p){renderPinnedImage(p.pinned_image_url);status("Pinned image saved.");}).catch(function(){status("Could not pin image.");});} if(post){status("Pinning post...");api("profile",{method:"POST",body:JSON.stringify(profilePayload({pinned_post_id:post.dataset.pinPost}))}).then(function(){status("Pinned post saved. Reload to see it featured.");}).catch(function(){status("Could not pin that post.");});} if(like){likeChart(like.dataset.chartLike);} if(vote){voteChart(vote.dataset.postId,vote.dataset.chartVote);} if(voters){loadChartVoters(voters.dataset.postId,voters.closest(".sml-vote-row"));}});
        root.querySelectorAll("[data-image-upload]").forEach(function(input){input.addEventListener("change",function(){var file=input.files&&input.files[0],kind=input.dataset.imageUpload;if(!file)return;if(file.size>8388608){status("Image must be under 8MB.");input.value="";return;}var reader=new FileReader();reader.onerror=function(){status("Could not read that image. Try a PNG, JPG, GIF, or WEBP.");input.value="";};reader.onload=function(){status("Uploading "+kind+" image...");api("profile-image",{method:"POST",body:JSON.stringify({type:kind,image:reader.result})}).then(function(r){if(kind==="avatar")refreshAvatar(r.url);else if(kind==="banner")refreshBanner(r.url);else if(kind==="pinned")renderPinnedImage(r.url);renderAlbum(r.profile||{});status(kind==="avatar"?"Avatar updated.":"Image uploaded.");input.value="";}).catch(function(err){status((err&&err.message)||"Image upload failed.");input.value="";});};reader.readAsDataURL(file);});});
        root.querySelectorAll("[data-social-connect]").forEach(function(btn){btn.addEventListener("click",function(){var input=root.querySelector('[data-social-link="'+btn.dataset.socialConnect+'"]');if(input){input.focus();input.select();}});});
        root.querySelectorAll("[data-theme-preset]").forEach(function(btn){btn.addEventListener("click",function(){applyThemePreset(btn.dataset.themePreset);});});
        var chartButton=root.querySelector("[data-chart-post]");if(chartButton){chartButton.addEventListener("click",postChart);}
        renderChart(chartRows);setInterval(loadChart,60000);
        renderMusicList(musicRows);updateMusicChrome();window.onYouTubeIframeAPIReady=initMusicPlayer;if(window.YT&&YT.Player)initMusicPlayer();
        var play=root.querySelector("[data-music-play]"),pause=root.querySelector("[data-music-pause]"),next=root.querySelector("[data-music-next]"),unmute=root.querySelector("[data-music-unmute]"),volume=root.querySelector("[data-music-volume]");
        if(play)play.addEventListener("click",function(){if(!musicRows.length){status("Add a YouTube in-the-zone track first.");return;}if(player){player.playVideo();}else{setTrack(activeTrack,true);}});
        if(pause)pause.addEventListener("click",function(){if(player)player.pauseVideo();});
        if(next)next.addEventListener("click",function(){setTrack(activeTrack+1,true);});
        if(unmute)unmute.addEventListener("click",function(){if(!musicRows.length){status("Add a YouTube in-the-zone track first.");return;}if(player){player.unMute();player.playVideo();unmute.textContent="Playing in-the-zone music";setTimeout(function(){unmute.textContent="Play / Unmute in-the-zone music";},1400);}else{setTrack(activeTrack,true);}});
        if(volume)volume.addEventListener("input",function(){if(player){player.setVolume(parseInt(volume.value,10)||0);if(parseInt(volume.value,10)>0)player.unMute();}});
        root.addEventListener("click",function(e){var track=e.target.closest("[data-music-track]");if(track)setTrack(parseInt(track.dataset.musicTrack,10)||0,true);});
      })();
      </script>
    </main>
    <?php
    return ob_get_clean();
}

function sml_members_notification_bell() {
    if (!is_user_logged_in()) {
        return;
    }
    $nonce = wp_create_nonce('wp_rest');
    ?>
    <div class="sml-inbox" data-sml-inbox>
      <style>
        .sml-inbox{position:fixed;right:18px;bottom:18px;z-index:99998;font-family:Inter,Arial,sans-serif}
        .sml-inbox button{border:1px solid #2a3d4b;background:#101a23;color:#fff;border-radius:999px;padding:11px 13px;font-weight:950;box-shadow:0 10px 30px rgba(0,0,0,.35);cursor:pointer}
        .sml-inbox[data-unread="1"] button{border-color:#ff3448;box-shadow:0 0 0 2px rgba(255,52,72,.2),0 0 22px rgba(255,52,72,.75)}
        .sml-inbox-count{display:none;margin-left:6px;background:#ff3448;color:#fff;border-radius:999px;padding:2px 7px;font-size:12px}.sml-inbox[data-unread="1"] .sml-inbox-count{display:inline-block}
        .sml-inbox-panel{display:none;position:absolute;right:0;bottom:52px;width:min(360px,calc(100vw - 34px));max-height:420px;overflow:auto;border:1px solid #22313d;background:#0d141b;color:#dbe8f5;border-radius:8px;padding:12px}
        .sml-inbox[data-open="1"] .sml-inbox-panel{display:block}.sml-inbox-item{border:1px solid #22313d;background:#101a23;border-radius:8px;padding:10px;margin-bottom:8px}
        .sml-inbox-item a{color:#72d7ff;text-decoration:none;font-weight:850}.sml-inbox-item time{display:block;color:#95a6b5;font-size:11px;margin-top:5px}
      </style>
      <button type="button" data-inbox-toggle>Inbox<span class="sml-inbox-count" data-inbox-count>0</span></button>
      <div class="sml-inbox-panel"><div data-inbox-list></div><button type="button" data-inbox-read>Mark all read</button></div>
      <script>
      (function(){
        var box=document.querySelector("[data-sml-inbox]"),nonce="<?php echo esc_js($nonce); ?>"; if(!box)return;
        function api(path,opts){opts=opts||{};opts.credentials="same-origin";opts.headers=Object.assign({"X-WP-Nonce":nonce,"Content-Type":"application/json"},opts.headers||{});return fetch("/wp-json/sml-members/v1/"+path,opts).then(function(r){return r.json();});}
        function draw(data){var c=box.querySelector("[data-inbox-count]"),list=box.querySelector("[data-inbox-list]");c.textContent=data.unread_count||0;box.dataset.unread=data.unread_count>0?"1":"0";list.innerHTML=(data.notifications||[]).length?data.notifications.map(function(n){return '<div class="sml-inbox-item"><a href="'+(n.link||'#')+'">'+String(n.message||'Notification').replace(/[<>&]/g,function(x){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[x];})+'</a><time>'+new Date(n.date||Date.now()).toLocaleString()+'</time></div>';}).join(""):'<div class="sml-inbox-item">No notifications yet.</div>';}
        function load(){api("notifications").then(draw);}
        box.querySelector("[data-inbox-toggle]").addEventListener("click",function(){box.dataset.open=box.dataset.open==="1"?"0":"1";load();});
        box.querySelector("[data-inbox-read]").addEventListener("click",function(){api("notifications",{method:"POST",body:JSON.stringify({action:"read"})}).then(draw);});
        load(); setInterval(load,45000);
      })();
      </script>
    </div>
    <?php
}

function sml_members_global_profile_widget() {
    $nonce = wp_create_nonce('wp_rest');
    $logged_in = is_user_logged_in();
    $current_profile = null;
    $current_avatar_url = $logged_in ? get_avatar_url(get_current_user_id()) : '';
    $current_profile_url = home_url('/my-profile/');
    $current_handle = 'Stockmarketloop member';
    $current_meta = 'Profile, inbox and watchlist ready';
    if ($logged_in) {
        $current_profile = sml_members_profile_payload(get_current_user_id());
        if (!is_wp_error($current_profile)) {
            $current_avatar_url = $current_profile['avatar_url'] ?: $current_avatar_url;
            $current_profile_url = $current_profile['profile_url'] ?: $current_profile_url;
            $current_handle = $current_profile['handle'] ?: $current_handle;
            $current_meta = (int) $current_profile['followers_count'] . ' followers | ' . (int) $current_profile['following_count'] . ' following';
        }
    }
    $redirect = esc_url_raw((is_ssl() ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? '') . ($_SERVER['REQUEST_URI'] ?? '/'));
    $login_url = wp_login_url($redirect);
    $register_url = wp_registration_url();
    ?>
    <div class="sml-global-widget" data-sml-global-widget data-logged="<?php echo $logged_in ? '1' : '0'; ?>">
      <style>
        .sml-global-widget{position:fixed;left:18px;bottom:18px;z-index:99997;font-family:Inter,Arial,sans-serif;color:#f4f7fb}
        .sml-global-widget *{box-sizing:border-box}.sml-global-card{width:min(340px,calc(100vw - 36px));border:1px solid #22313d;background:#0d141b;border-radius:8px;box-shadow:0 12px 34px rgba(0,0,0,.38);padding:12px}
        .sml-global-brand-row{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-bottom:10px;border:1px solid #18301d;background:#05070b;border-radius:8px;padding:6px}
        .sml-global-brand-row img{display:block;width:190px;max-width:72%;height:54px;object-fit:cover;border-radius:6px}
        .sml-global-brand-row span{color:#62f3a6;font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.12em}
        .sml-global-mini{display:grid;grid-template-columns:46px 1fr;gap:10px;align-items:center}.sml-global-mini img{width:46px;height:46px;border-radius:999px;object-fit:cover;background:#17212b;border:2px solid #62f3a6}
        .sml-global-mini strong{display:block;color:#fff;font-size:14px;line-height:1.2}.sml-global-mini span{display:block;color:#95a6b5;font-size:12px;line-height:1.35;margin-top:3px}
        .sml-global-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.sml-global-actions a,.sml-global-actions button{border:1px solid #2a3d4b;background:#101a23;color:#dbe8f5;border-radius:6px;padding:9px 10px;text-align:center;text-decoration:none;font-weight:900;cursor:pointer;font-size:13px}
        .sml-global-actions .sml-primary{background:#62f3a6;border-color:#62f3a6;color:#06100b}.sml-global-status{color:#62f3a6;font-size:12px;line-height:1.35;margin-top:8px;font-weight:800}.sml-global-status[data-error="1"]{color:#ff7a87}
        .sml-auth-modal{display:none;position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.72);align-items:center;justify-content:center;padding:18px}.sml-auth-modal[data-open="1"]{display:flex}
        .sml-auth-panel{width:min(520px,calc(100vw - 28px));border:1px solid #22313d;background:#0d141b;border-radius:8px;color:#f4f7fb;box-shadow:0 20px 60px rgba(0,0,0,.55);padding:16px}
        .sml-auth-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px}.sml-auth-head h2{margin:0;color:#fff;font-size:22px;letter-spacing:0}.sml-auth-head button{border:1px solid #2a3d4b;background:#101a23;color:#fff;border-radius:999px;width:34px;height:34px;cursor:pointer}
        .sml-auth-intro{border:1px solid #22313d;background:#101a23;border-radius:8px;padding:10px;margin-bottom:10px}.sml-auth-intro strong{display:block;color:#fff}.sml-auth-intro span{display:block;color:#95a6b5;font-size:12px;line-height:1.45;margin-top:4px}.sml-auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.sml-auth-tabs button{border:1px solid #2a3d4b;background:#101a23;color:#dbe8f5;border-radius:6px;padding:9px;font-weight:950;cursor:pointer}.sml-auth-tabs button[data-active="1"]{background:#62f3a6;border-color:#62f3a6;color:#06100b}
        .sml-auth-form{display:grid;gap:9px}.sml-auth-form[data-hidden="1"]{display:none}.sml-auth-form input{width:100%;border:1px solid #2a3d4b;background:#090f15;color:#fff;border-radius:6px;padding:11px;font-size:14px}.sml-auth-form button{border:0;background:#62f3a6;color:#06100b;border-radius:6px;padding:11px;font-weight:950;cursor:pointer}
        .sml-auth-check{display:flex;gap:8px;align-items:center;color:#dbe8f5;font-size:12px;font-weight:850}.sml-auth-check input{width:auto!important;min-width:16px;height:16px;accent-color:#62f3a6}
        .sml-auth-note{color:#95a6b5;font-size:12px;line-height:1.45}.sml-code-step{display:none;gap:8px;border-top:1px solid #22313d;margin-top:10px;padding-top:10px}.sml-code-step[data-open="1"]{display:grid}
        .sml-social-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0}.sml-social-row button{display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid #2a3d4b;background:#101a23;color:#dbe8f5;border-radius:6px;padding:9px;font-weight:900;cursor:pointer}.sml-social-row img{width:17px;height:17px;object-fit:contain}
        @media(max-width:640px){.sml-global-widget{left:10px;bottom:10px}.sml-global-card{width:calc(100vw - 20px)}body{padding-bottom:116px}}
      </style>
      <div class="sml-global-card">
        <div class="sml-global-brand-row"><img src="<?php echo esc_url(sml_members_brand_logo_url()); ?>" alt="Stock Market Loop"><span>Connect. Learn. Share. Grow.</span></div>
        <?php if ($logged_in) : ?>
          <div class="sml-global-mini">
            <img data-sml-global-avatar src="<?php echo esc_url($current_avatar_url); ?>" alt="">
            <div><strong data-sml-global-handle><?php echo esc_html($current_handle); ?></strong><span data-sml-global-meta><?php echo esc_html($current_meta); ?></span></div>
          </div>
          <div class="sml-global-actions">
            <a class="sml-primary" data-sml-global-profile href="<?php echo esc_url($current_profile_url); ?>">My Profile</a>
            <a href="<?php echo esc_url(home_url('/stock-chart/?symbol=SPY')); ?>">Ticker Terminal</a>
          </div>
        <?php else : ?>
          <div class="sml-global-mini">
            <img src="<?php echo esc_url(sml_members_brand_icon_url()); ?>" alt="Stock Market Loop">
            <div><strong>Join Stockmarketloop</strong><span>Sign in to post, vote sentiment, save watchlists and view member tools.</span></div>
          </div>
          <div class="sml-global-actions">
            <button class="sml-primary" type="button" data-sml-open-signup>Sign up free</button>
            <button type="button" data-sml-open-login>Log in</button>
          </div>
        <?php endif; ?>
        <div class="sml-global-status" data-sml-global-status></div>
      </div>
      <?php if (!$logged_in) : ?>
        <div class="sml-auth-modal" data-sml-auth-modal aria-hidden="true">
          <div class="sml-auth-panel">
            <div class="sml-auth-head">
              <h2><img src="<?php echo esc_url(sml_members_brand_icon_url()); ?>" alt="" style="width:30px;height:30px;border-radius:8px;vertical-align:middle;margin-right:8px">Welcome to Stockmarketloop</h2>
              <button type="button" data-sml-close-signup>x</button>
            </div>
            <div class="sml-auth-intro"><strong>Join the market loop before you post.</strong><span>Create a verified profile, save watchlists, vote sentiment, follow traders, earn badges, and keep your session active on this device.</span></div>
            <div class="sml-auth-tabs">
              <button type="button" data-auth-tab="signup" data-active="1">Create account</button>
              <button type="button" data-auth-tab="login" data-active="0">Log in</button>
            </div>
            <form class="sml-auth-form" data-sml-signup-form>
              <input type="email" data-sml-signup-email placeholder="Email address" required>
              <input type="text" data-sml-signup-handle placeholder="Username" maxlength="32" required>
              <input type="password" data-sml-signup-password placeholder="Password: 8+ characters, 1 number, no spaces" required>
              <label class="sml-auth-check"><input type="checkbox" data-sml-signup-remember checked> Stay signed in on this device</label>
              <button type="submit">Send Verification Code</button>
              <div class="sml-auth-note">Password must be at least 8 characters, include 1 number, and have no spaces. Symbols are allowed.</div>
            </form>
            <form class="sml-auth-form" data-sml-login-form data-hidden="1">
              <input type="text" data-sml-login-id placeholder="Email or username" required>
              <input type="password" data-sml-login-password placeholder="Password" required>
              <label class="sml-auth-check"><input type="checkbox" data-sml-login-remember checked> Stay signed in on this device</label>
              <button type="submit">Log in</button>
              <div class="sml-auth-note">Use the same verified email or username you created for Stockmarketloop.</div>
            </form>
            <div class="sml-social-row">
              <button type="button" data-sml-social="Google"><img src="https://cdn.simpleicons.org/google/FFFFFF" alt="">Google</button>
              <button type="button" data-sml-social="Facebook"><img src="https://cdn.simpleicons.org/facebook/1877F2" alt="">Facebook</button>
              <button type="button" data-sml-social="X"><img src="https://cdn.simpleicons.org/x/FFFFFF" alt="">X</button>
            </div>
            <div class="sml-code-step" data-sml-code-step>
              <input type="text" data-sml-code-input inputmode="numeric" maxlength="5" placeholder="Enter 5-digit code">
              <button type="button" data-sml-verify-code>Verify Email</button>
              <button type="button" data-sml-resend-code>Resend Code</button>
            </div>
            <div class="sml-global-status" data-sml-auth-status></div>
            <p class="sml-auth-note">By continuing, you agree to use Stockmarketloop for market discussion and watchlist tools. Financial posts are not investment advice.</p>
          </div>
        </div>
      <?php endif; ?>
      <script>
      (function(){
        var root=document.querySelector("[data-sml-global-widget]"),nonce="<?php echo esc_js($nonce); ?>"; if(!root)return;
        function esc(s){return String(s||"").replace(/[<>&"]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c];});}
        function status(sel,msg,bad){var el=root.querySelector(sel); if(el){el.textContent=msg||""; el.dataset.error=bad?"1":"0";}}
        function api(path,opts){opts=opts||{};opts.credentials="same-origin";opts.headers=Object.assign({"Content-Type":"application/json","X-WP-Nonce":nonce},opts.headers||{});return fetch("/wp-json/sml-members/v1/"+path,opts).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});});}
        function referralCode(){try{var p=new URLSearchParams(location.search),c=(p.get("ref")||p.get("sml_ref")||"").replace(/[^A-Za-z0-9]/g,"").slice(0,24).toUpperCase(); if(c){localStorage.setItem("sml_referral_code",c);return c;} return (localStorage.getItem("sml_referral_code")||"").replace(/[^A-Za-z0-9]/g,"").slice(0,24).toUpperCase();}catch(e){return "";}}
        if(root.dataset.logged==="1"){
          api("profile").then(function(p){
            var a=root.querySelector("[data-sml-global-avatar]"),h=root.querySelector("[data-sml-global-handle]"),m=root.querySelector("[data-sml-global-meta]"),l=root.querySelector("[data-sml-global-profile]");
            if(a&&p.avatar_url)a.src=p.avatar_url; if(h)h.textContent=p.handle||"Stockmarketloop member"; if(m)m.textContent=(p.followers_count||0)+" followers | "+(p.following_count||0)+" following"; if(l&&p.profile_url)l.href=p.profile_url;
          });
          return;
        }
        var modal=root.querySelector("[data-sml-auth-modal]"),email="";
        function checked(sel){var el=root.querySelector(sel);return !!(el&&el.checked);}
        function authMode(mode){mode=mode==="login"?"login":"signup";root.querySelectorAll("[data-auth-tab]").forEach(function(btn){btn.dataset.active=btn.dataset.authTab===mode?"1":"0";});var signup=root.querySelector("[data-sml-signup-form]"),login=root.querySelector("[data-sml-login-form]");if(signup)signup.dataset.hidden=mode==="signup"?"0":"1";if(login)login.dataset.hidden=mode==="login"?"0":"1";status("[data-sml-auth-status]","",false);}
        function open(mode,auto){authMode(mode||"signup");modal.dataset.open="1";modal.setAttribute("aria-hidden","false");if(auto)modal.dataset.auto="1";}
        function close(){modal.dataset.open="0";modal.setAttribute("aria-hidden","true");try{sessionStorage.setItem("sml_onboarding_seen","1");}catch(e){}}
        root.querySelector("[data-sml-open-signup]").addEventListener("click",function(){open("signup",false);});
        root.querySelector("[data-sml-open-login]").addEventListener("click",function(){open("login",false);});
        root.querySelector("[data-sml-close-signup]").addEventListener("click",close);
        root.querySelectorAll("[data-auth-tab]").forEach(function(btn){btn.addEventListener("click",function(){authMode(btn.dataset.authTab);});});
        setTimeout(function(){try{if(!sessionStorage.getItem("sml_onboarding_seen"))open("signup",true);}catch(e){open("signup",true);}},850);
        root.querySelectorAll("[data-sml-social]").forEach(function(btn){btn.addEventListener("click",function(){status("[data-sml-auth-status]",btn.dataset.smlSocial+" sign-up needs the provider connection enabled. Use email sign-up for now.",true);});});
        root.querySelector("[data-sml-login-form]").addEventListener("submit",function(e){
          e.preventDefault();
          var login=root.querySelector("[data-sml-login-id]").value.trim();
          var password=root.querySelector("[data-sml-login-password]").value.trim();
          status("[data-sml-auth-status]","Signing you in...",false);
          api("login",{method:"POST",body:JSON.stringify({login:login,password:password,remember:checked("[data-sml-login-remember]")})}).then(function(r){
            status("[data-sml-auth-status]",r.message||"Signed in.",false);
            setTimeout(function(){location.reload();},650);
          }).catch(function(err){
            if(err&&err.code==="sml_unverified"){email=(err.data&&err.data.email)||login;root.querySelector("[data-sml-code-step]").dataset.open="1";authMode("login");status("[data-sml-auth-status]",err.message||"Enter your 5-digit verification code.",true);var code=root.querySelector("[data-sml-code-input]");if(code)code.focus();return;}
            status("[data-sml-auth-status]",err.message||"Could not sign in. Check your password and try again.",true);
          });
        });
        root.querySelector("[data-sml-signup-form]").addEventListener("submit",function(e){
          e.preventDefault();
          email=root.querySelector("[data-sml-signup-email]").value.trim();
          var handle=root.querySelector("[data-sml-signup-handle]").value.trim();
          var password=root.querySelector("[data-sml-signup-password]").value.trim();
          status("[data-sml-auth-status]","Creating account and sending verification code...",false);
          api("register",{method:"POST",body:JSON.stringify({email:email,handle:handle,password:password,remember:checked("[data-sml-signup-remember]"),referral_code:referralCode()})}).then(function(r){
            root.querySelector("[data-sml-code-step]").dataset.open="1";
            status("[data-sml-auth-status]",r.message||"Verification email sent. Enter your 5-digit code.",!r.email_sent);
            status("[data-sml-global-status]","Verification email sent. Check your inbox.",false);
            var code=root.querySelector("[data-sml-code-input]"); if(code)code.focus();
          }).catch(function(err){status("[data-sml-auth-status]",err.message||"Could not create the account. Check the fields and try again.",true);});
        });
        root.querySelector("[data-sml-verify-code]").addEventListener("click",function(){
          var code=root.querySelector("[data-sml-code-input]").value.replace(/\D/g,"").slice(0,5);
          status("[data-sml-auth-status]","Verifying email...",false);
          api("verify",{method:"POST",body:JSON.stringify({email:email,code:code,remember:checked("[data-sml-signup-remember]")||checked("[data-sml-login-remember]")})}).then(function(){
            status("[data-sml-auth-status]","Email verified. Signing you in...",false);
            setTimeout(function(){location.reload();},900);
          }).catch(function(err){status("[data-sml-auth-status]",err.message||"That code did not work. Try again or resend.",true);});
        });
        root.querySelector("[data-sml-resend-code]").addEventListener("click",function(){
          status("[data-sml-auth-status]","Sending a new code...",false);
          api("resend-code",{method:"POST",body:JSON.stringify({email:email})}).then(function(r){status("[data-sml-auth-status]",r.message||"Verification email sent. Enter your 5-digit code.",!r.email_sent);}).catch(function(err){status("[data-sml-auth-status]",err.message||"Could not resend the code.",true);});
        });
      })();
      </script>
    </div>
    <?php
}

function sml_members_activity_heartbeat() {
    if (is_admin() || !is_user_logged_in()) {
        return;
    }
    $nonce = wp_create_nonce('wp_rest');
    ?>
    <script>
    (function(){
      var nonce="<?php echo esc_js($nonce); ?>";
      function beat(){
        if(document.hidden)return;
        fetch("/wp-json/sml-members/v1/loop-bucks/heartbeat",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","X-WP-Nonce":nonce},body:"{}"}).catch(function(){});
      }
      beat();
      setInterval(beat,60000);
      document.addEventListener("visibilitychange",function(){if(!document.hidden)beat();});
    })();
    </script>
    <?php
}

function sml_members_trending_ticker_tape() {
    if (is_admin()) {
        return;
    }
    ?>
    <div class="sml-loop-tape" data-sml-loop-tape>
      <style>
        body{padding-top:42px!important}.sml-loop-tape{position:fixed;top:0;left:0;right:0;z-index:99996;background:#070b0f;border-bottom:1px solid #22313d;color:#f4f7fb;font-family:Inter,Arial,sans-serif;overflow:hidden;height:42px;display:flex;align-items:center}
        body.admin-bar .sml-loop-tape{top:32px}.sml-loop-tape-label{display:flex;align-items:center;gap:8px;height:42px;padding:0 12px;background:#101a23;border-right:1px solid #22313d;color:#fff;font-size:12px;font-weight:950;text-transform:uppercase;white-space:nowrap;z-index:2}.sml-loop-dot{width:8px;height:8px;border-radius:999px;background:#62f3a6;box-shadow:0 0 12px rgba(98,243,166,.75)}
        .sml-loop-marquee{display:flex;min-width:0;overflow:hidden;white-space:nowrap}.sml-loop-track{display:flex;gap:18px;align-items:center;min-width:max-content;animation:smlLoopTape 42s linear infinite}.sml-loop-tape:hover .sml-loop-track{animation-play-state:paused}.sml-loop-item{display:inline-flex;align-items:center;gap:7px;color:#dbe8f5;text-decoration:none;font-size:13px;font-weight:850}.sml-loop-item b{color:#fff}.sml-loop-item span{color:#95a6b5}.sml-loop-item em{font-style:normal;border-radius:999px;padding:2px 6px;font-size:11px;font-weight:950}.sml-loop-item[data-dir="up"] em{color:#62f3a6;background:#0d251a}.sml-loop-item[data-dir="down"] em{color:#ff7a87;background:#2a1116}.sml-loop-heat{color:#72d7ff!important}
        @keyframes smlLoopTape{from{transform:translateX(0)}to{transform:translateX(-50%)}}@media(max-width:782px){body.admin-bar .sml-loop-tape{top:46px}.sml-loop-tape-label{padding:0 8px;font-size:11px}.sml-loop-track{gap:13px;animation-duration:34s}.sml-loop-item{font-size:12px}}
      </style>
      <div class="sml-loop-tape-label"><i class="sml-loop-dot"></i><span>Trending 25</span></div>
      <div class="sml-loop-marquee"><div class="sml-loop-track" data-sml-loop-track><a class="sml-loop-item" href="<?php echo esc_url(home_url('/stock-chart/?symbol=SPY')); ?>"><b>$SPY</b><span>Loading tape...</span></a></div></div>
      <script>
      (function(){
        var root=document.querySelector("[data-sml-loop-tape]"),track=root&&root.querySelector("[data-sml-loop-track]"); if(!track)return;
        function esc(s){return String(s||"").replace(/[<>&"]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c];});}
        function render(rows){
          if(!rows.length)return;
          track.innerHTML=rows.concat(rows).map(function(t){
            var dir=t.direction==="down"?"down":"up",sign=parseFloat(t.change_pct||0)>=0?"+":"";
            return '<a class="sml-loop-item" data-dir="'+dir+'" href="'+esc(t.url||("/stock-chart/?symbol="+t.symbol))+'"><b>$'+esc(t.symbol)+'</b><span>Trend '+esc(t.score||t.heat)+'</span><em>'+sign+esc(t.change_pct)+'%</em><span class="sml-loop-heat">Heat '+esc(t.heat)+'</span></a>';
          }).join("");
        }
        function load(){fetch("/wp-json/sml-members/v1/trending-tickers?_"+Date.now(),{credentials:"same-origin",cache:"no-store"}).then(function(r){return r.json();}).then(function(data){render(data.tickers||[]);}).catch(function(){});}
        load(); setInterval(load,5000);
      })();
      </script>
    </div>
    <?php
}

function sml_members_loop_bucks_modal() {
    if (is_admin() || !is_user_logged_in()) {
        return;
    }
    $nonce = wp_create_nonce('wp_rest');
    ?>
    <div class="sml-loop-bucks-root" data-sml-loop-bucks-root>
      <style>
        .sml-loop-bucks-root{font-family:Inter,Arial,sans-serif;color:#f4f7fb}.sml-loop-launch{position:fixed;right:18px;bottom:18px;z-index:99997;border:1px solid #2a3d4b;background:#101a23;color:#fff;border-radius:8px;padding:11px 13px;box-shadow:0 12px 34px rgba(0,0,0,.38);cursor:pointer;font-weight:950}.sml-loop-launch b{color:#62f3a6}.sml-loop-modal{display:none;position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.68);align-items:center;justify-content:center;padding:18px}.sml-loop-modal[data-open="1"]{display:flex}.sml-loop-panel{width:min(720px,calc(100vw - 28px));max-height:86vh;overflow:auto;background:#0d141b;border:1px solid #22313d;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.55);padding:16px}.sml-loop-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.sml-loop-head h2{margin:0;color:#fff;font-size:24px}.sml-loop-close{border:1px solid #2a3d4b;background:#101a23;color:#fff;border-radius:999px;width:34px;height:34px;cursor:pointer}.sml-loop-balance{border:1px solid #25533d;background:#0b2018;color:#62f3a6;border-radius:8px;padding:10px;font-weight:950;margin-bottom:10px}.sml-loop-note{color:#95a6b5;font-size:12px;line-height:1.45;margin:8px 0}.sml-loop-quote,.sml-loop-referral{border:1px solid #22313d;background:#101a23;border-radius:8px;padding:10px;margin:10px 0;color:#dbe8f5}.sml-loop-quote strong,.sml-loop-referral strong{display:block;color:#fff;margin-bottom:5px}.sml-loop-referral input{width:100%;border:1px solid #2a3d4b;background:#090f15;color:#72d7ff;border-radius:6px;padding:9px;margin:7px 0;font-weight:800}.sml-loop-referral small{display:block;color:#95a6b5;line-height:1.45}.sml-loop-referrals{display:grid;gap:6px;margin-top:8px}.sml-loop-referrals span{display:block;color:#95a6b5;font-size:12px}.sml-loop-form{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0}.sml-loop-form input,.sml-loop-form select{border:1px solid #2a3d4b;background:#090f15;color:#fff;border-radius:6px;padding:10px;min-width:0}.sml-loop-form button,.sml-loop-buy,.sml-loop-copy{border:0;background:#62f3a6;color:#06100b;border-radius:6px;padding:10px;font-weight:950;cursor:pointer}.sml-loop-copy{width:100%;margin-top:2px}.sml-loop-list{display:grid;gap:8px}.sml-loop-card{border:1px solid #22313d;background:#101a23;border-radius:8px;padding:10px;display:grid;gap:7px}.sml-loop-card strong{color:#fff}.sml-loop-card span{color:#95a6b5;font-size:12px}.sml-loop-card button{justify-self:start;border:1px solid #2a3d4b;background:#0d141b;color:#72d7ff;border-radius:6px;padding:8px 10px;cursor:pointer;font-weight:900}.sml-loop-card button:disabled{opacity:.55;cursor:not-allowed}.sml-loop-status{color:#72d7ff;font-size:12px;font-weight:850;margin:6px 0}.sml-loop-status[data-error="1"]{color:#ff7a87}@media(max-width:780px){.sml-loop-launch{right:10px;bottom:132px}.sml-loop-form{grid-template-columns:1fr}}
      </style>
      <button class="sml-loop-launch" type="button" data-sml-loop-open>Loop Bucks <b data-sml-loop-balance-mini>...</b></button>
      <div class="sml-loop-modal" data-sml-loop-modal aria-hidden="true">
        <div class="sml-loop-panel">
          <div class="sml-loop-head"><h2>Loop Bucks Prediction Channels</h2><button class="sml-loop-close" type="button" data-sml-loop-close>x</button></div>
          <div class="sml-loop-balance">Balance: <span data-sml-loop-balance>...</span> Loop Bucks</div>
          <div class="sml-loop-quote"><strong>Credit Price</strong><span data-sml-loop-pricing>100 credits = $1.00, plus 2% service fee. Tax: $0.00.</span></div>
          <div class="sml-loop-referral">
            <strong>Referral Rewards</strong>
            <small data-sml-referral-terms>Invite traders and earn credits after they stay active with no account flags.</small>
            <input data-sml-referral-link readonly value="">
            <button class="sml-loop-copy" type="button" data-sml-copy-referral>Copy Referral Link</button>
            <div class="sml-loop-referrals" data-sml-referral-list></div>
          </div>
          <button class="sml-loop-buy" type="button" data-sml-loop-buy>Buy Loop Bucks</button>
          <p class="sml-loop-note">Loop Bucks are non-cash, non-redeemable site credits. Real-money purchases, payouts, and gambling-style wagering are disabled until compliance review is complete.</p>
          <form class="sml-loop-form" data-sml-loop-form>
            <input data-loop-symbol placeholder="Ticker" maxlength="8" required>
            <select data-loop-mode><option value="direction">Bull/Bear</option><option value="percent_gain">% gain</option><option value="prediction_count">Prediction count</option></select>
            <input data-loop-prediction placeholder="Prediction" required>
            <input data-loop-stake type="number" min="1" max="10000" value="25" required>
            <input data-loop-duration type="number" min="5" max="10080" value="60" required>
            <button type="submit">Open Channel</button>
          </form>
          <div class="sml-loop-status" data-sml-loop-status></div>
          <div class="sml-loop-list" data-sml-loop-list></div>
        </div>
      </div>
      <script>
      (function(){
        var root=document.querySelector("[data-sml-loop-bucks-root]"),nonce="<?php echo esc_js($nonce); ?>"; if(!root)return;
        var modal=root.querySelector("[data-sml-loop-modal]"),statusEl=root.querySelector("[data-sml-loop-status]");
        function esc(s){return String(s||"").replace(/[<>&"]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c];});}
        function status(msg,bad){if(statusEl){statusEl.textContent=msg||"";statusEl.dataset.error=bad?"1":"0";}}
        function api(path,opts){opts=opts||{};opts.credentials="same-origin";opts.headers=Object.assign({"Content-Type":"application/json","X-WP-Nonce":nonce},opts.headers||{});return fetch("/wp-json/sml-members/v1/"+path,opts).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j;});});}
        function render(data){
          root.querySelector("[data-sml-loop-balance]").textContent=data.balance||0; root.querySelector("[data-sml-loop-balance-mini]").textContent=data.balance||0;
          var price=root.querySelector("[data-sml-loop-pricing]"),ref=data.referral||{},quote=data.pricing||{},refLink=root.querySelector("[data-sml-referral-link]"),refTerms=root.querySelector("[data-sml-referral-terms]"),refList=root.querySelector("[data-sml-referral-list]");
          if(price&&quote.total_display)price.textContent=quote.credits+" credits = "+quote.subtotal_display+" + "+quote.service_fee_display+" service fee + "+quote.tax_display+" tax = "+quote.total_display+". Checkout is disabled until payments are connected.";
          if(refLink)refLink.value=ref.share_url||"";
          if(refTerms)refTerms.textContent=ref.terms||"Referral rewards unlock after account age and active-time milestones.";
          if(refList){
            var refs=ref.referrals||[];
            refList.innerHTML=refs.length?refs.map(function(r){return "<span>"+esc(r.handle)+" | "+esc(r.age_days)+" days | "+esc(r.online_hours)+" active hrs | Next: "+esc(r.next_reward)+"</span>";}).join(""):"<span>No referral signups tracked yet. Share your link to start earning.</span>";
          }
          var list=root.querySelector("[data-sml-loop-list]"),rows=data.challenges||[];
          if(!rows.length){list.innerHTML='<div class="sml-loop-card"><strong>No open prediction channels yet</strong><span>Open the first Loop Bucks challenge for a ticker.</span></div>';return;}
          list.innerHTML=rows.map(function(c){
            var disabled=c.joined||c.status!=="open"?"disabled":"";
            return '<div class="sml-loop-card"><strong>$'+esc(c.symbol)+' - '+esc(c.title)+'</strong><span>'+esc(c.mode)+' | Stake '+esc(c.stake)+' | Pot '+esc(c.pot)+' | '+esc(c.entries_count)+' players | closes '+new Date(c.closes_at).toLocaleString()+'</span><span>Recent calls: '+(c.entries||[]).map(function(e){return esc(e.handle)+": "+esc(e.prediction);}).join(" | ")+'</span><button type="button" '+disabled+' data-loop-join="'+esc(c.id)+'">'+(c.joined?"Joined":"Join Channel")+'</button></div>';
          }).join("");
        }
        function load(){api("loop-bucks").then(render).catch(function(err){status(err.message||"Loop Bucks unavailable.",true);});}
        root.querySelector("[data-sml-loop-open]").addEventListener("click",function(){modal.dataset.open="1";modal.setAttribute("aria-hidden","false");load();});
        root.querySelector("[data-sml-loop-close]").addEventListener("click",function(){modal.dataset.open="0";modal.setAttribute("aria-hidden","true");});
        root.querySelector("[data-sml-copy-referral]").addEventListener("click",function(){var input=root.querySelector("[data-sml-referral-link]"); if(!input||!input.value)return; input.select(); if(navigator.clipboard){navigator.clipboard.writeText(input.value).then(function(){status("Referral link copied.",false);}).catch(function(){status("Referral link is selected. Copy it from the field.",false);});}else{status("Referral link is selected. Copy it from the field.",false);}});
        root.querySelector("[data-sml-loop-buy]").addEventListener("click",function(){var credits=window.prompt("How many Loop Bucks? 100 credits = $1.00 before the 2% service fee.","100"); if(!credits)return; api("loop-bucks/purchase-intent",{method:"POST",body:JSON.stringify({credits:credits})}).then(function(r){status(r.message||"Checkout is disabled. No charge was made.",false);}).catch(function(err){status(err.message||"Could not build a quote.",true);});});
        root.querySelector("[data-sml-loop-form]").addEventListener("submit",function(e){
          e.preventDefault(); status("Opening prediction channel...",false);
          api("loop-bucks/challenge",{method:"POST",body:JSON.stringify({symbol:root.querySelector("[data-loop-symbol]").value,mode:root.querySelector("[data-loop-mode]").value,prediction:root.querySelector("[data-loop-prediction]").value,stake:root.querySelector("[data-loop-stake]").value,duration_minutes:root.querySelector("[data-loop-duration]").value})}).then(function(r){status(r.message,false);load();}).catch(function(err){status(err.message||"Could not open channel.",true);});
        });
        root.querySelector("[data-sml-loop-list]").addEventListener("click",function(e){
          var btn=e.target.closest("[data-loop-join]"); if(!btn)return;
          var prediction=window.prompt("Enter your prediction for this channel:"); if(!prediction)return;
          status("Joining prediction channel...",false);
          api("loop-bucks/join",{method:"POST",body:JSON.stringify({id:btn.dataset.loopJoin,prediction:prediction})}).then(function(r){status(r.message,false);load();}).catch(function(err){status(err.message||"Could not join channel.",true);});
        });
        load(); setInterval(load,15000);
      })();
      </script>
    </div>
    <?php
}

function sml_members_home_leaderboard() {
    if (!is_front_page() && !is_home()) {
        return;
    }
    ?>
    <section class="sml-home-leaderboard" data-sml-home-leaderboard>
      <style>
        .sml-home-leaderboard{max-width:1180px;margin:22px auto;background:#0d141b;color:#f4f7fb;border:1px solid #22313d;border-radius:8px;padding:16px;font-family:Inter,Arial,sans-serif}
        .sml-home-leaderboard h2{margin:0 0 10px;color:#fff;font-size:24px;letter-spacing:0}.sml-home-leaderboard p{color:#95a6b5;line-height:1.5;margin:0 0 12px}
        .sml-home-board{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.sml-home-trader{border:1px solid #22313d;background:#101a23;border-radius:8px;padding:10px;text-decoration:none;color:#dbe8f5}
        .sml-home-trader img{width:38px;height:38px;border-radius:999px;object-fit:cover;border:2px solid #62f3a6;background:#17212b}.sml-home-trader strong{display:block;color:#fff;margin-top:7px}.sml-home-trader span{display:block;color:#62f3a6;font-size:12px;margin-top:3px;font-weight:900}
        @media(max-width:900px){.sml-home-board{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.sml-home-board{grid-template-columns:1fr}.sml-home-leaderboard{margin:16px 10px}}
      </style>
      <h2>Top 10 Trader Sentiment Leaderboard</h2>
      <p>Daily bullish and bearish calls build a tracked scorecard for Stockmarketloop members.</p>
      <div class="sml-home-board" data-sml-home-board><div class="sml-home-trader">Loading leaderboard...</div></div>
      <script>
      (function(){
        var box=document.querySelector("[data-sml-home-board]"); if(!box)return;
        function esc(s){return String(s||"").replace(/[<>&"]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c];});}
        fetch("/wp-json/sml-members/v1/leaderboard?_"+Date.now(),{credentials:"same-origin",cache:"no-store"}).then(function(r){return r.json();}).then(function(data){
          var rows=data.leaderboard||[];
          if(!rows.length){box.innerHTML='<div class="sml-home-trader"><strong>No ranked votes yet</strong><span>First sentiment voters will appear here.</span></div>';return;}
          box.innerHTML=rows.map(function(t){return '<a class="sml-home-trader" href="'+esc(t.profile_url)+'"><img src="'+esc(t.avatar_url)+'" alt=""><strong>#'+t.rank+' '+esc(t.handle)+'</strong><span>'+t.points+' pts | '+t.right+' right | '+t.wrong+' wrong</span></a>';}).join("");
        });
      })();
      </script>
    </section>
    <?php
}

function sml_members_home_trending_posts() {
    if (!is_front_page() && !is_home()) {
        return;
    }
    ?>
    <section class="sml-home-trending-posts" data-sml-home-trending-posts>
      <style>
        .sml-home-trending-posts{max-width:1180px;margin:22px auto;background:#0d141b;color:#f4f7fb;border:1px solid #22313d;border-radius:8px;padding:16px;font-family:Inter,Arial,sans-serif}
        .sml-home-trending-posts h2{margin:0;color:#fff;font-size:24px;letter-spacing:0}.sml-home-trending-posts p{color:#95a6b5;line-height:1.5;margin:5px 0 12px}
        .sml-top-post-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.sml-top-post-card{border:1px solid #22313d;background:#101a23;border-radius:8px;padding:11px;text-decoration:none;color:#dbe8f5;display:grid;grid-template-columns:auto 1fr;gap:9px}
        .sml-top-post-rank{display:grid;place-items:center;width:36px;height:36px;border-radius:8px;background:#07110c;border:1px solid #25533d;color:#62f3a6;font-weight:950}.sml-top-post-card strong{display:block;color:#62f3a6;font-size:12px}.sml-top-post-card p{margin:5px 0;color:#f4f7fb;font-size:13px;line-height:1.35}.sml-top-post-card span{display:block;color:#95a6b5;font-size:11px}.sml-top-score{display:inline-flex!important;gap:7px;align-items:center;color:#dbe8f5!important;margin-top:5px}.sml-top-score b{color:#62f3a6}.sml-top-score em{font-style:normal;color:#ff6b76}
        @media(max-width:760px){.sml-top-post-grid{grid-template-columns:1fr}.sml-home-trending-posts{margin:16px 10px}}
      </style>
      <h2>Top 10 Trending Posts</h2>
      <p>Ranked by green candle upvotes minus red candle downvotes during the last 24 hours.</p>
      <div class="sml-top-post-grid" data-sml-top-post-grid><div class="sml-top-post-card"><div class="sml-top-post-rank">...</div><div><strong>Loading top posts</strong><p>Finding the strongest trader posts right now.</p></div></div></div>
      <script>
      (function(){
        var box=document.querySelector("[data-sml-top-post-grid]"); if(!box)return;
        function esc(s){return String(s||"").replace(/[<>&"]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c];});}
        function draw(rows){
          if(!rows.length){box.innerHTML='<div class="sml-top-post-card"><div class="sml-top-post-rank">0</div><div><strong>No voted posts yet</strong><p>Upvote ticker posts to push them into the rolling Top 10.</p></div></div>';return;}
          box.innerHTML=rows.map(function(r,i){var symbol=(r.tickers&&r.tickers[0])||"SPY";return '<a class="sml-top-post-card" href="/stock-chart/?symbol='+esc(symbol)+'#comments"><div class="sml-top-post-rank">#'+(i+1)+'</div><div><strong>'+esc((r.tickers||[]).map(function(t){return "$"+t;}).join(" "))+'</strong><p>'+esc(r.text).slice(0,170)+'</p><span>'+esc(r.handle)+' | '+new Date(r.date).toLocaleString()+'</span><span class="sml-top-score">Net <b>'+esc(r.vote_score)+'</b> | Up '+esc(r.upvote_count)+' | Down <em>'+esc(r.downvote_count)+'</em></span></div></a>';}).join("");
        }
        function load(){fetch("/wp-json/sml-members/v1/trending-posts?limit=10&hours=24&_="+Date.now(),{credentials:"same-origin",cache:"no-store"}).then(function(r){return r.json();}).then(function(data){draw(data.posts||[]);}).catch(function(){box.innerHTML='<div class="sml-top-post-card"><div class="sml-top-post-rank">!</div><div><strong>Top posts unavailable</strong><p>Refresh shortly.</p></div></div>';});}
        load();setInterval(load,60000);
      })();
      </script>
    </section>
    <?php
}

function sml_members_home_news_feed() {
    if (!is_front_page() && !is_home()) {
        return;
    }
    $nonce = wp_create_nonce('wp_rest');
    $user_id = get_current_user_id();
    $logged = is_user_logged_in();
    $avatar = $logged ? (get_user_meta($user_id, 'sml_avatar_url', true) ?: get_avatar_url($user_id)) : '';
    $handle = $logged ? sml_members_handle($user_id) : 'Guest trader';
    $profile_url = $logged ? home_url('/members/' . $user_id . '/') : wp_login_url();
    ?>
    <section class="sml-home-social-feed" data-sml-home-social-feed data-logged="<?php echo $logged ? '1' : '0'; ?>" data-user-id="<?php echo esc_attr($user_id); ?>">
      <style>
        .sml-home-social-feed{max-width:1180px;margin:18px auto;background:#070b10;color:#f4f7fb;border:1px solid #1f2b37;border-radius:8px;padding:14px;font-family:Inter,Arial,sans-serif;box-shadow:0 18px 44px rgba(0,0,0,.32)}
        .sml-brand-mission{display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);gap:14px;align-items:center;border:1px solid #18301d;background:linear-gradient(135deg,#05070b,#07110c 56%,#0c161f);border-radius:8px;padding:14px;margin-bottom:14px;overflow:hidden}
        .sml-brand-mission-logo{display:grid;gap:9px}.sml-brand-mission-logo img{width:100%;max-height:210px;object-fit:cover;border-radius:8px;border:1px solid #1f2b37;background:#05070b}.sml-brand-mission-logo span{color:#62f3a6;font-size:11px;font-weight:950;text-transform:uppercase;letter-spacing:.14em}
        .sml-brand-lockups{display:grid;grid-template-columns:1fr 86px;gap:8px}.sml-brand-lockups img{height:86px;max-height:86px;object-fit:cover}.sml-brand-lockups img:last-child{object-fit:contain;padding:5px}
        .sml-brand-mission h2{margin:0;color:#fff;font-size:26px;line-height:1.05;letter-spacing:0}.sml-brand-mission p{color:#c5d2df;line-height:1.55;margin:8px 0 0}.sml-brand-points{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.sml-brand-points span{border:1px solid #22313d;background:#0d141b;border-radius:8px;padding:8px;color:#dbe8f5;font-size:12px;font-weight:900}.sml-brand-points b{color:#62f3a6}
        .sml-home-grid{display:grid;grid-template-columns:minmax(210px,.48fr) minmax(0,1.28fr) minmax(230px,.54fr);gap:12px;align-items:start}
        .sml-home-panel{background:#0d141b;border:1px solid #22313d;border-radius:8px;padding:12px}.sml-home-panel h2,.sml-home-panel h3{margin:0;color:#fff;letter-spacing:0}.sml-home-panel h2{font-size:22px}.sml-home-panel h3{font-size:15px}.sml-home-panel p,.sml-home-panel small{color:#95a6b5;line-height:1.45}
        .sml-home-profile{display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:center}.sml-home-profile img{width:48px;height:48px;border-radius:999px;object-fit:cover;border:2px solid #62f3a6;background:#15212b}.sml-home-profile strong{display:block;color:#fff}.sml-home-profile a{color:#72d7ff;text-decoration:none;font-weight:950}
        .sml-home-nav{display:grid;gap:7px;margin-top:12px}.sml-home-nav a,.sml-home-nav button{border:1px solid #2a3d4b;background:#101a23;color:#dbe8f5;border-radius:7px;padding:9px;text-align:left;text-decoration:none;font-weight:950;cursor:pointer}.sml-home-nav a:first-child{background:#62f3a6;color:#06100b;border-color:#62f3a6}
        .sml-home-composer{display:grid;gap:10px}.sml-home-composer-top{display:grid;grid-template-columns:42px 1fr;gap:9px;align-items:start}.sml-home-composer-top img,.sml-home-composer-fallback{width:42px;height:42px;border-radius:999px;border:1px solid #2a3d4b;background:#101a23;object-fit:cover;display:grid;place-items:center;color:#62f3a6;font-weight:950}
        .sml-home-composer textarea{width:100%;min-height:92px;background:#050a0f;color:#fff;border:1px solid #2a3d4b;border-radius:8px;padding:11px;font:inherit;resize:vertical}.sml-home-composer textarea:focus{outline:0;border-color:#72d7ff;box-shadow:0 0 0 2px rgba(114,215,255,.14)}
        .sml-home-composer-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.sml-home-composer-actions button{border:1px solid #2a3d4b;background:#101a23;color:#dbe8f5;border-radius:7px;padding:9px 7px;font-size:12px;font-weight:950;cursor:pointer}.sml-home-composer-actions button[data-active="1"]{border-color:#62f3a6;color:#62f3a6;background:#07110c}
        .sml-home-media-preview{display:none;border:1px dashed #2a3d4b;background:#081018;border-radius:8px;padding:9px;color:#95a6b5;font-size:12px}.sml-home-media-preview[data-open="1"]{display:block}.sml-home-submit-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.sml-home-submit-row button{border:0;background:#62f3a6;color:#06100b;border-radius:7px;padding:10px 14px;font-weight:950;cursor:pointer}.sml-home-status{color:#95a6b5;font-size:12px}
        .sml-home-feed-head{display:flex;align-items:end;justify-content:space-between;gap:10px;margin:14px 0 9px}.sml-home-feed-head span{color:#62f3a6;font-size:11px;font-weight:950;text-transform:uppercase}.sml-home-feed-head button{border:1px solid #2a3d4b;background:#101a23;color:#72d7ff;border-radius:7px;padding:8px 10px;font-weight:950;cursor:pointer}
        .sml-home-article-list{display:grid;gap:10px}.sml-home-article{display:grid;grid-template-columns:142px 1fr;gap:11px;border:1px solid #22313d;background:#101a23;border-radius:8px;overflow:hidden;text-decoration:none;color:#dbe8f5}.sml-home-article img{width:100%;height:100%;min-height:116px;object-fit:cover;background:#17212b}.sml-home-article-body{padding:10px 10px 10px 0}.sml-home-article-kicker{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}.sml-home-article-kicker span{border:1px solid #2a3d4b;border-radius:999px;padding:3px 7px;color:#62f3a6;font-size:10px;font-weight:950;text-transform:uppercase}.sml-home-article h3{font-size:18px;line-height:1.15;margin:0 0 6px}.sml-home-article p{margin:0 0 7px;color:#b8c5d2;font-size:13px}.sml-home-article small{font-size:11px;color:#8fa4b6}
        .sml-home-trend-chip{display:flex;justify-content:space-between;gap:8px;border:1px solid #22313d;background:#101a23;border-radius:7px;padding:8px;margin-top:7px;text-decoration:none}.sml-home-trend-chip b{color:#72d7ff}.sml-home-trend-chip span{color:#95a6b5;font-size:12px}.sml-home-hint{border:1px solid #24404f;background:#07121b;border-radius:8px;padding:10px;margin-top:10px;color:#aebdcb;font-size:12px;line-height:1.45}.sml-home-mention,.sml-home-dollar,.sml-home-hash{font-weight:950;text-decoration:none}.sml-home-mention{color:#f5c542}.sml-home-dollar{color:#72d7ff}.sml-home-hash{color:#62f3a6}
        @media(max-width:980px){.sml-brand-mission,.sml-home-grid{grid-template-columns:1fr}.sml-home-social-feed{margin:14px 10px}.sml-home-composer-actions{grid-template-columns:1fr 1fr}.sml-home-article{grid-template-columns:110px 1fr}}
        @media(max-width:560px){.sml-home-article{grid-template-columns:1fr}.sml-home-article img{height:168px}.sml-home-article-body{padding:10px}}
      </style>
      <section class="sml-brand-mission" aria-label="Stock Market Loop mission">
        <div class="sml-brand-mission-logo">
          <img src="<?php echo esc_url(sml_members_brand_logo_url()); ?>" alt="Stock Market Loop">
          <span>Connect. Learn. Share. Grow.</span>
          <div class="sml-brand-lockups">
            <img src="<?php echo esc_url(sml_members_brand_mark_url()); ?>" alt="Stock Market Loop trademark mark">
            <img src="<?php echo esc_url(sml_members_brand_icon_url()); ?>" alt="Stock Market Loop app icon">
          </div>
        </div>
        <div>
          <h2>The official #1 social media site for finance</h2>
          <p>Stock Market Loop combines real-time market insights, powerful tools, and an engaged finance community so traders, investors and creators can learn, share and grow together.</p>
          <div class="sml-brand-points">
            <span><b>Built</b> for the finance community</span>
            <span><b>Engage</b> and share in real time</span>
            <span><b>Learn</b>, improve and level up</span>
            <span><b>Trusted</b>, verified and transparent</span>
          </div>
        </div>
      </section>
      <div class="sml-home-grid">
        <aside class="sml-home-panel">
          <div class="sml-home-profile">
            <?php if ($avatar) : ?>
              <img src="<?php echo esc_url($avatar); ?>" alt="">
            <?php else : ?>
              <img src="<?php echo esc_url(sml_members_brand_icon_url()); ?>" alt="Stock Market Loop">
            <?php endif; ?>
            <div><strong><?php echo esc_html($handle); ?></strong><a href="<?php echo esc_url($profile_url); ?>"><?php echo $logged ? 'View profile' : 'Log in or sign up'; ?></a></div>
          </div>
          <nav class="sml-home-nav">
            <a href="<?php echo esc_url(home_url('/stock-chart/?symbol=SPY')); ?>">Open ticker terminal</a>
            <a href="<?php echo esc_url(home_url('/retail-trader-spotlight/')); ?>">Retail Trader Spotlight</a>
            <a href="<?php echo esc_url(home_url('/my-profile/')); ?>">Customize profile</a>
            <button type="button" data-home-refresh-news>Refresh market feed</button>
          </nav>
          <div class="sml-home-hint">Default feed: latest Stockmarketloop articles. Signed-in traders can write on their Chart, tag $tickers, use #hashtags, and mention @users.</div>
        </aside>
        <main class="sml-home-panel">
          <div class="sml-home-composer" data-sml-home-composer>
            <div class="sml-home-composer-top">
              <?php if ($avatar) : ?><img src="<?php echo esc_url($avatar); ?>" alt=""><?php else : ?><img src="<?php echo esc_url(sml_members_brand_icon_url()); ?>" alt="Stock Market Loop"><?php endif; ?>
              <textarea data-home-composer-input placeholder="Write on your Chart... tag $NVDA, #AIStocks, or @anothertrader"></textarea>
            </div>
            <div class="sml-home-composer-actions">
              <button type="button" data-home-mode="chart" data-active="1">Chart Post</button>
              <button type="button" data-home-mode="photo">Photo</button>
              <button type="button" data-home-mode="video">Video</button>
              <button type="button" data-home-mode="live">Go Live</button>
            </div>
            <input type="file" accept="image/*" data-home-photo-input hidden>
            <input type="file" accept="video/*" data-home-video-input hidden>
            <div class="sml-home-media-preview" data-home-media-preview></div>
            <div class="sml-home-submit-row">
              <small class="sml-home-status" data-home-composer-status><?php echo $logged ? 'Ready to post to your Chart.' : 'Must sign in before posting.'; ?></small>
              <button type="button" data-home-submit>Post</button>
            </div>
          </div>
          <div class="sml-home-feed-head">
            <div><span>Market news feed</span><h2>Latest Stockmarketloop Articles</h2></div>
            <button type="button" data-home-refresh-news>Refresh</button>
          </div>
          <div class="sml-home-article-list" data-home-article-list>
            <div class="sml-home-hint">Loading the latest market stories...</div>
          </div>
        </main>
        <aside class="sml-home-panel">
          <h3>Trending Ticker Rooms</h3>
          <div data-home-trending-rooms>
            <?php foreach (array_slice(sml_members_trending_seed_symbols(), 0, 10) as $symbol) : ?>
              <a class="sml-home-trend-chip" href="<?php echo esc_url(home_url('/stock-chart/?symbol=' . rawurlencode($symbol))); ?>"><b>$<?php echo esc_html($symbol); ?></b><span>Open room</span></a>
            <?php endforeach; ?>
          </div>
        </aside>
      </div>
      <script>
      (function(){
        var root=document.querySelector("[data-sml-home-social-feed]"),nonce="<?php echo esc_js($nonce); ?>"; if(!root)return;
        var logged=root.dataset.logged==="1",mode="chart",mediaKind="",mediaName="";
        function esc(s){return String(s||"").replace(/[<>&"]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c];});}
        function openSignup(){var btn=document.querySelector("[data-sml-open-signup]");if(btn){btn.click();return;}location.href="/wp-login.php?action=register";}
        function rest(path,opts){opts=opts||{};opts.credentials="same-origin";opts.cache="no-store";opts.headers=Object.assign({"Accept":"application/json","Content-Type":"application/json","X-WP-Nonce":nonce},opts.headers||{});return fetch("/wp-json/sml-members/v1/"+path,opts).then(function(r){return r.json().then(function(data){if(!r.ok)throw new Error((data&&data.message)||"Request failed.");return data;});});}
        function fmt(text){return esc(text).replace(/\$([A-Z0-9.]{1,8})\b/g,function(_,s){return '<a class="sml-home-dollar" href="/stock-chart/?symbol='+encodeURIComponent(s)+'">$'+esc(s)+'</a>';}).replace(/#([A-Za-z0-9_]{2,32})\b/g,function(_,s){return '<a class="sml-home-hash" href="/?s='+encodeURIComponent("#"+s)+'">#'+esc(s)+'</a>';}).replace(/@([A-Za-z0-9_.]{2,30})\b/g,function(_,s){return '<a class="sml-home-mention" href="/?s='+encodeURIComponent("@"+s)+'">@'+esc(s)+'</a>';});}
        function drawNews(rows){var box=root.querySelector("[data-home-article-list]");if(!box)return;if(!rows.length){box.innerHTML='<div class="sml-home-hint">No articles are published yet. New market stories will appear here automatically.</div>';return;}box.innerHTML=rows.map(function(row){var cats=(row.categories||[]).concat(row.tickers||[]).slice(0,4);return '<a class="sml-home-article" href="'+esc(row.url)+'"><img src="'+esc(row.image)+'" alt=""><div class="sml-home-article-body"><div class="sml-home-article-kicker">'+cats.map(function(c){return '<span>'+esc(String(c).charAt(0)==="$"?c:""+c)+'</span>';}).join("")+'</div><h3>'+esc(row.title)+'</h3><p>'+fmt(row.excerpt||"")+'</p><small>'+esc(row.author||"Stockmarketloop")+' | '+esc(row.date_label||"Latest")+' | '+esc(row.comment_count||0)+' comments</small></div></a>';}).join("");}
        function loadNews(){rest("news-feed?limit=18&_="+Date.now()).then(function(data){drawNews(data.articles||[]);}).catch(function(){var box=root.querySelector("[data-home-article-list]");if(box)box.innerHTML='<div class="sml-home-hint">Market feed could not refresh right now.</div>';});}
        function status(msg){var s=root.querySelector("[data-home-composer-status]");if(s)s.textContent=msg;}
        root.querySelectorAll("[data-home-mode]").forEach(function(btn){btn.addEventListener("click",function(){mode=btn.dataset.homeMode;root.querySelectorAll("[data-home-mode]").forEach(function(x){x.dataset.active=x===btn?"1":"0";});if(mode==="photo"){var p=root.querySelector("[data-home-photo-input]");if(p)p.click();}else if(mode==="video"){var v=root.querySelector("[data-home-video-input]");if(v)v.click();}else if(mode==="live"){status("Live mode is staged. Connect a streaming provider before going live.");}else{status(logged?"Ready to post to your Chart.":"Must sign in before posting.");}});});
        root.querySelectorAll("[data-home-photo-input],[data-home-video-input]").forEach(function(input){input.addEventListener("change",function(){var file=input.files&&input.files[0];if(!file)return;mediaKind=input.matches("[data-home-photo-input]")?"photo":"video";mediaName=file.name;var box=root.querySelector("[data-home-media-preview]");if(box){box.dataset.open="1";box.innerHTML="<strong>"+esc(mediaKind.toUpperCase())+" selected:</strong> "+esc(mediaName)+"<br>Media preview is ready; permanent wall media storage connects through the upload pipeline.";}});});
        var submit=root.querySelector("[data-home-submit]"),input=root.querySelector("[data-home-composer-input]");
        if(submit){submit.addEventListener("click",function(){if(!logged){openSignup();return;}var text=input?input.value.trim():"";if(!text&&mediaName){text="Shared a "+mediaKind+": "+mediaName;}if(!text){status("Write something before posting.");return;}submit.disabled=true;status("Posting to your Chart...");rest("profile-chart",{method:"POST",body:JSON.stringify({user_id:root.dataset.userId,text:text})}).then(function(){if(input)input.value="";mediaKind="";mediaName="";var box=root.querySelector("[data-home-media-preview]");if(box){box.dataset.open="0";box.innerHTML="";}status("Posted to your Chart. @mentions and $tickers are active.");}).catch(function(err){status(err.message||"Could not post.");}).finally(function(){submit.disabled=false;});});}
        root.querySelectorAll("[data-home-refresh-news]").forEach(function(btn){btn.addEventListener("click",loadNews);});
        loadNews();setInterval(loadNews,60000);
      })();
      </script>
    </section>
    <?php
}

function sml_members_home_personal_feed() {
    if (!is_front_page() && !is_home()) {
        return;
    }
    $nonce = wp_create_nonce('wp_rest');
    ?>
    <aside class="sml-home-feed" data-sml-home-feed data-logged="<?php echo is_user_logged_in() ? '1' : '0'; ?>">
      <style>
        .sml-home-feed{position:fixed;left:14px;top:92px;z-index:99990;width:min(340px,calc(100vw - 28px));max-height:calc(100vh - 150px);overflow:auto;background:#080d12;color:#f4f7fb;border:1px solid #22313d;border-radius:8px;box-shadow:0 18px 42px rgba(0,0,0,.42);font-family:Inter,Arial,sans-serif}
        body.admin-bar .sml-home-feed{top:124px}.sml-home-feed-head{position:sticky;top:0;background:#101a23;border-bottom:1px solid #22313d;padding:12px;z-index:1}.sml-home-feed h2{margin:0;color:#fff;font-size:18px;letter-spacing:0}.sml-home-feed small{display:block;color:#95a6b5;margin-top:4px;line-height:1.35}
        .sml-home-feed-tabs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;padding:10px;border-bottom:1px solid #22313d}.sml-home-feed-tabs button{border:1px solid #2a3d4b;background:#0d141b;color:#dbe8f5;border-radius:6px;padding:8px;font-weight:950;cursor:pointer}.sml-home-feed-tabs button[data-active="1"]{background:#62f3a6;color:#06100b;border-color:#62f3a6}
        .sml-home-feed-list{display:grid;gap:8px;padding:10px}.sml-home-feed-card{border:1px solid #22313d;background:#101a23;border-radius:8px;padding:10px;text-decoration:none;color:#dbe8f5}.sml-home-feed-card strong{display:block;color:#62f3a6;font-size:12px}.sml-home-feed-card p{margin:6px 0;color:#f4f7fb;line-height:1.35;font-size:13px}.sml-home-feed-card span{display:block;color:#95a6b5;font-size:11px}.sml-home-feed-card img{width:28px;height:28px;border-radius:999px;object-fit:cover;border:1px solid #62f3a6;vertical-align:middle;margin-right:6px}.sml-home-feed-card.sml-news-card{display:grid;grid-template-columns:58px 1fr;gap:8px;align-items:start}.sml-home-feed-card.sml-news-card img{width:58px;height:48px;border-radius:6px;margin:0}.sml-home-feed-empty{padding:12px;color:#95a6b5;line-height:1.45}
        @media(max-width:1120px){.sml-home-feed{position:relative;left:auto;top:auto;width:auto;max-height:none;margin:14px 10px;z-index:1}body.admin-bar .sml-home-feed{top:auto}}
      </style>
      <div class="sml-home-feed-head">
        <h2>My Market Feed</h2>
        <small data-sml-home-feed-meta><?php echo is_user_logged_in() ? 'Loading your watchlist stream...' : 'Sign in to unlock your watchlist feed.'; ?></small>
      </div>
      <div class="sml-home-feed-tabs">
        <button type="button" data-feed-tab="news" data-active="1">News</button>
        <button type="button" data-feed-tab="watchlist">Watchlist</button>
        <button type="button" data-feed-tab="trending">Trending</button>
      </div>
      <div class="sml-home-feed-list" data-sml-home-feed-list>
        <div class="sml-home-feed-empty">Loading latest market articles...</div>
      </div>
      <script>
      (function(){
        var root=document.querySelector("[data-sml-home-feed]"),nonce="<?php echo esc_js($nonce); ?>"; if(!root)return;
        var active="news",cache={articles:[],watchlist_posts:[],trending_posts:[],watchlist:[]},list=root.querySelector("[data-sml-home-feed-list]"),meta=root.querySelector("[data-sml-home-feed-meta]");
        function esc(s){return String(s||"").replace(/[<>&"]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c];});}
        function render(){root.querySelectorAll("[data-feed-tab]").forEach(function(b){b.dataset.active=b.dataset.feedTab===active?"1":"0";});if(active==="news"){if(!cache.articles.length){list.innerHTML='<div class="sml-home-feed-empty">No market articles yet.</div>';return;}list.innerHTML=cache.articles.slice(0,10).map(function(r){return '<a class="sml-home-feed-card sml-news-card" href="'+esc(r.url)+'"><img src="'+esc(r.image)+'" alt=""><div><strong>'+esc((r.categories&&r.categories[0])||"Market News")+'</strong><p>'+esc(r.title).slice(0,120)+'</p><span>'+esc(r.date_label||"Latest")+'</span></div></a>';}).join("");return;}var rows=active==="watchlist"?cache.watchlist_posts:cache.trending_posts;if(!rows.length){list.innerHTML='<div class="sml-home-feed-empty">'+(active==="watchlist"?"No watchlist posts yet. Add tickers or start a comment stream.":"No trending ticker posts yet.")+'</div>';return;}list.innerHTML=rows.map(function(r){var symbol=(r.tickers&&r.tickers[0])||"SPY";return '<a class="sml-home-feed-card" href="/stock-chart/?symbol='+esc(symbol)+'#comments"><strong>'+esc((r.tickers||[]).map(function(t){return "$"+t;}).join(" "))+'</strong><p>'+esc(r.text).slice(0,170)+'</p><span><img src="'+esc(r.avatar_url)+'" alt="">'+esc(r.handle)+' | '+new Date(r.date).toLocaleString()+'</span></a>';}).join("");}
        function loadNews(){fetch("/wp-json/sml-members/v1/news-feed?limit=12&_="+Date.now(),{credentials:"same-origin",cache:"no-store"}).then(function(r){return r.json();}).then(function(data){cache.articles=(data&&data.articles)||[];if(meta&&active==="news")meta.textContent="Latest Stockmarketloop articles";render();}).catch(function(){if(meta)meta.textContent="News feed could not load right now.";});}
        function load(){loadNews();if(root.dataset.logged!=="1")return;fetch("/wp-json/sml-members/v1/profile-feed?_"+Date.now(),{credentials:"same-origin",cache:"no-store",headers:{"X-WP-Nonce":nonce}}).then(function(r){return r.json();}).then(function(data){cache=Object.assign(cache,data||{});if(meta&&active!=="news")meta.textContent=(cache.watchlist||[]).map(function(s){return "$"+s;}).join(" ")||"Watchlist stream";render();}).catch(function(){if(meta)meta.textContent="Feed could not load right now.";});}
        root.querySelectorAll("[data-feed-tab]").forEach(function(btn){btn.addEventListener("click",function(){active=btn.dataset.feedTab;render();});});
        load();setInterval(load,30000);
      })();
      </script>
    </aside>
    <?php
}

function sml_members_ticker_search_bridge() {
    if (is_admin()) {
        return;
    }

    $path = strtolower(trim((string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH), '/'));
    ?>
    <div class="sml-global-ticker-search" data-sml-global-ticker-search>
      <form data-global-ticker-form autocomplete="off">
        <a class="sml-global-brand" href="<?php echo esc_url(home_url('/')); ?>" aria-label="Stock Market Loop home"><img src="<?php echo esc_url(sml_members_brand_logo_url()); ?>" alt="Stock Market Loop"></a>
        <span class="sml-global-search-dollar">$</span>
        <input data-global-ticker-input list="sml-global-symbols" placeholder="Search stocks, ETFs, crypto tickers..." aria-label="Search stocks">
        <button type="submit">Search</button>
        <datalist id="sml-global-symbols"></datalist>
      </form>
    </div>
    <style>
      body{padding-top:96px!important}body.admin-bar{padding-top:128px!important}
      .sml-global-ticker-search{position:fixed;top:42px;left:0;right:0;z-index:99995;background:#0b1016;border-bottom:1px solid #22313d;box-shadow:0 10px 28px rgba(0,0,0,.28);font-family:Inter,Arial,sans-serif;padding:9px 14px}
      body.admin-bar .sml-global-ticker-search{top:74px}
      .sml-global-ticker-search form{position:relative;display:grid;grid-template-columns:auto auto 1fr auto;align-items:center;gap:8px;max-width:980px;margin:0 auto;background:#060a0f;border:1px solid #2a3d4b;border-radius:999px;padding:5px 6px 5px 9px}
      .sml-global-brand{display:flex;align-items:center;width:174px;max-width:28vw;height:38px;overflow:hidden;border-radius:999px;text-decoration:none;background:#05070b;border:1px solid #18301d}
      .sml-global-brand img{display:block;width:100%;height:100%;object-fit:cover;object-position:center}
      .sml-global-search-dollar{color:#62f3a6;font-weight:950;font-size:18px;line-height:1}
      .sml-global-ticker-search input{min-width:0;width:100%;border:0;background:transparent;color:#fff;font-size:15px;font-weight:850;outline:none;text-transform:uppercase;padding:9px 2px}
      .sml-global-ticker-search input::placeholder{text-transform:none;color:#7f91a3;font-weight:750}
      .sml-global-ticker-search button{border:0;background:#62f3a6;color:#06100b;border-radius:999px;padding:9px 14px;font-weight:950;cursor:pointer}
      .sml-ticker-menu{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:99999;background:#080d12;border:1px solid #2a3d4b;border-radius:8px;box-shadow:0 18px 42px rgba(0,0,0,.45);overflow:hidden;display:none;font-family:Inter,Arial,sans-serif}
      .sml-ticker-menu[data-open="1"]{display:block}
      .sml-ticker-menu button{width:100%;display:grid;grid-template-columns:88px 1fr auto;gap:10px;align-items:center;border:0;border-bottom:1px solid #22313d;background:#080d12;color:#dbe8f5;text-align:left;padding:10px 12px;cursor:pointer}
      .sml-ticker-menu button:hover,.sml-ticker-menu button:focus{background:#101a23;outline:none}
      .sml-ticker-menu b{color:#62f3a6;font-size:14px}.sml-ticker-menu span{color:#fff;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sml-ticker-menu small{color:#95a6b5;font-weight:900;text-transform:uppercase}
      .sml-ticker-menu em{display:block;grid-column:2 / 4;color:#95a6b5;font-style:normal;font-size:11px;margin-top:-4px}
      .sml-ticker-menu-empty{padding:10px 12px;color:#95a6b5;font-size:12px;line-height:1.45}
      .sml-dir-card small b{color:#62f3a6}
      .sml-terminal-hub{max-width:1180px;margin:18px auto 26px;padding:0 14px;font-family:Inter,Arial,sans-serif;color:#eaf2f8}
      .sml-terminal-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;border-bottom:1px solid #243341;padding-bottom:10px;margin-bottom:12px}
      .sml-terminal-head h2{margin:0;color:#fff;font-size:24px;letter-spacing:0}
      .sml-terminal-head span{display:block;color:#8fa4b6;font-size:12px;font-weight:850;text-transform:uppercase}
      .sml-terminal-head a{color:#72d7ff;text-decoration:none;font-weight:900}
      .sml-terminal-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(310px,.85fr);gap:12px}
      .sml-terminal-panel{background:#081018;border:1px solid #22313d;border-radius:8px;padding:12px;box-shadow:0 14px 30px rgba(0,0,0,.22)}
      .sml-terminal-panel h3{margin:0 0 8px;color:#fff;font-size:15px;letter-spacing:0}
      .sml-terminal-panel small{color:#8fa4b6;font-weight:750}
      .sml-stream-list,.sml-source-list,.sml-thought-list{display:grid;gap:8px;margin-top:10px}
      .sml-stream-card,.sml-source-card,.sml-thought-card{display:grid;grid-template-columns:38px 1fr;gap:9px;background:#0d1720;border:1px solid #1d2b37;border-radius:8px;padding:9px}
      .sml-avatar-wrap{width:38px;height:38px;display:block;border-radius:999px;overflow:hidden;background:#18232d}
      .sml-avatar-wrap img,.sml-stream-card img,.sml-source-card > img,.sml-thought-card img{width:38px;height:38px;border-radius:999px;object-fit:cover;background:#18232d;border:1px solid #2a3d4b}
      .sml-source-card[data-platform="moomoo"]{border-left:3px solid #2fd866}
      .sml-source-card[data-platform="webull"]{border-left:3px solid #3686ff}
      .sml-source-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
      .sml-platform-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid #2a3d4b;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:0;color:#fff;background:#111b25}
      .sml-platform-badge img{width:16px!important;height:16px!important;border-radius:4px!important;object-fit:contain!important;background:#fff!important;border:0!important}
      .sml-platform-badge[data-platform="moomoo"]{background:rgba(47,216,102,.14);border-color:rgba(47,216,102,.48);color:#7affaa}
      .sml-platform-badge[data-platform="webull"]{background:rgba(54,134,255,.14);border-color:rgba(54,134,255,.52);color:#8fb9ff}
      .sml-platform-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-top:8px}
      .sml-platform-actions button{border:1px solid #2a3d4b;background:#101a23;color:#dbe8f5;border-radius:6px;padding:6px 8px;font-weight:900;cursor:pointer;font-size:12px}
      .sml-stream-avatar-fallback,.sml-source-avatar-fallback{width:38px;height:38px;border-radius:999px;display:grid;place-items:center;background:#13202b;color:#62f3a6;font-weight:950;border:1px solid #2a3d4b}
      .sml-stream-card strong,.sml-source-card strong,.sml-thought-card strong{color:#fff;font-size:13px}
      .sml-stream-card strong{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .sml-stream-card p,.sml-source-card p,.sml-thought-card p{margin:4px 0;color:#dbe8f5;line-height:1.45;font-size:13px;word-break:break-word}
      .sml-stream-card span,.sml-source-card span,.sml-thought-card span{color:#8fa4b6;font-size:11px}
      .sml-stream-card a,.sml-source-card a,.sml-thought-card a,.sml-hashtag-row a{color:#72d7ff;text-decoration:none;font-weight:900}
      .sml-stream-card .sml-dollar,.sml-composer-preview .sml-dollar{color:#72d7ff;font-weight:950}
      .sml-stream-card .sml-hash,.sml-composer-preview .sml-hash{color:#62f3a6;font-weight:950}
      .sml-stream-card .sml-mention,.sml-composer-preview .sml-mention{color:#f5c542;font-weight:950}
      .sml-stream-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:7px}.sml-stream-actions button{border:1px solid #2a3d4b;background:#101a23;color:#dbe8f5;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:950;cursor:pointer}.sml-stream-actions button[data-liked="1"]{border-color:#62f3a6;color:#62f3a6;box-shadow:0 0 12px rgba(98,243,166,.16)}.sml-stream-actions span{font-weight:900}
      .sml-vote-row{position:relative;display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:7px}.sml-vote-row button{border:1px solid #2a3d4b;background:#101a23;color:#dbe8f5;border-radius:999px;padding:5px 8px;font-size:12px;font-weight:950;cursor:pointer}.sml-vote-row button[data-active="1"]{box-shadow:0 0 12px rgba(98,243,166,.16)}.sml-vote-row button[data-post-vote="up"][data-active="1"],.sml-vote-row button[data-chart-vote="up"][data-active="1"]{border-color:#62f3a6;color:#62f3a6}.sml-vote-row button[data-post-vote="down"][data-active="1"],.sml-vote-row button[data-chart-vote="down"][data-active="1"]{border-color:#ff6b6b;color:#ff8c8c}.sml-vote-score{color:#dbe8f5;font-weight:950;font-size:12px}.sml-candle{position:relative;display:inline-block;width:10px;height:18px;margin-right:3px;vertical-align:middle}.sml-candle:before{content:"";position:absolute;left:4px;top:0;bottom:0;width:2px;background:currentColor}.sml-candle i{position:absolute;left:1px;top:4px;width:8px;height:10px;border-radius:2px;background:currentColor}.sml-candle-up{color:#62f3a6;transform:rotate(-24deg)}.sml-candle-down{color:#ff6b6b;transform:rotate(24deg)}.sml-voter-pop{position:absolute;left:0;top:100%;z-index:40;width:min(310px,calc(100vw - 40px));margin-top:7px;border:1px solid #2a3d4b;background:#071018;color:#dbe8f5;border-radius:8px;padding:10px;box-shadow:0 18px 42px rgba(0,0,0,.48)}.sml-voter-pop h4{margin:0 0 6px;color:#fff;font-size:12px}.sml-voter-pop a{display:grid;grid-template-columns:28px 1fr;gap:7px;align-items:center;color:#dbe8f5;text-decoration:none;margin:5px 0}.sml-voter-pop img{width:28px!important;height:28px!important;border-radius:999px!important;object-fit:cover!important}
      .sml-ach-badge{display:inline-flex;align-items:center;border:1px solid #2a3d4b;border-radius:999px;background:#101a23;color:#f4f7fb;padding:4px 7px;font-size:10px;font-weight:950;white-space:nowrap}.sml-ach-bronze{border-color:#9b6a3d;color:#f7c089}.sml-ach-silver{border-color:#9aa7b5;color:#e4edf5}.sml-ach-gold{border-color:#f5c542;color:#ffe793}.sml-ach-platinum{border-color:#72d7ff;color:#b9ecff}.sml-ach-mythic{border-color:#ff6bd6;color:#ffd7f5;box-shadow:0 0 14px rgba(255,107,214,.28)}
      .sml-terminal-composer{position:relative;display:grid;gap:8px;margin-bottom:10px}
      .sml-terminal-composer textarea{width:100%;min-height:84px;resize:vertical;background:#050a0f;border:1px solid #263746;border-radius:8px;color:#fff;padding:10px;font:inherit;font-size:14px;outline:none}
      .sml-terminal-composer textarea:focus{border-color:#72d7ff;box-shadow:0 0 0 2px rgba(114,215,255,.16)}
      .sml-terminal-composer button,.sml-sentiment-actions button,.sml-stream-refresh{border:0;border-radius:7px;background:#62f3a6;color:#06100b;padding:9px 11px;font-weight:950;cursor:pointer}
      .sml-terminal-composer button[disabled],.sml-sentiment-actions button[disabled]{opacity:.55;cursor:not-allowed}
      .sml-broker-posting{display:flex;gap:7px;flex-wrap:wrap;align-items:center}
      .sml-broker-posting span{color:#8fa4b6;font-size:12px;font-weight:900;text-transform:uppercase}
      .sml-broker-posting button{background:#101a23!important;color:#dbe8f5!important;border:1px solid #2a3d4b!important;padding:7px 9px!important;font-size:12px}
      .sml-broker-posting button[data-active="1"]{background:#72d7ff!important;border-color:#72d7ff!important;color:#06100b!important}
      .sml-broker-post-status{color:#8fa4b6;font-size:12px;line-height:1.45;font-weight:800}
      .sml-broker-post-status[data-good="1"]{color:#62f3a6}.sml-broker-post-status[data-bad="1"]{color:#ff7a87}
      .sml-composer-preview{min-height:22px;color:#9db0bf;font-size:12px}
      .sml-composer-menu{position:absolute;left:0;right:0;top:92px;background:#071018;border:1px solid #2a3d4b;border-radius:8px;box-shadow:0 18px 40px rgba(0,0,0,.46);display:none;overflow:hidden;z-index:30}
      .sml-composer-menu[data-open="1"]{display:block}
      .sml-composer-menu button{display:grid;grid-template-columns:82px 1fr;gap:8px;width:100%;text-align:left;background:#071018;color:#fff;border-bottom:1px solid #1d2b37;border-radius:0}
      .sml-composer-menu button:hover{background:#102131}
      .sml-composer-menu b{color:#72d7ff}.sml-composer-menu span{color:#aebdcb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sml-broker-stamps{display:flex;align-items:center;gap:6px;flex-wrap:wrap;border:1px dashed #2a3d4b;background:#071018;border-radius:8px;padding:7px}.sml-broker-stamps span{color:#95a6b5;font-size:11px;font-weight:950;text-transform:uppercase}.sml-broker-stamps button{background:#101a23!important;color:#dbe8f5!important;border:1px solid #2a3d4b!important;border-radius:999px!important;padding:6px 9px!important;font-size:11px!important}.sml-broker-stamps button[data-active="1"]{border-color:#62f3a6!important;color:#62f3a6!important}
      .sml-hashtag-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
      .sml-hashtag-row a{border:1px solid #24404f;background:#0d1720;border-radius:999px;padding:5px 8px;font-size:12px}
      .sml-sentiment-meter{display:grid;gap:7px;margin:8px 0}.sml-meter-track{height:10px;background:#101a23;border-radius:999px;overflow:hidden}.sml-meter-fill{height:100%;background:linear-gradient(90deg,#62f3a6,#72d7ff);width:0%}
      .sml-sentiment-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sml-sentiment-actions button:last-child{background:#ff6b6b;color:#180909}
      .sml-source-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
      .sml-source-tabs a{display:block;text-align:center;border:1px solid #2a3d4b;background:#0d1720;border-radius:7px;padding:8px;color:#72d7ff;text-decoration:none;font-weight:950;font-size:12px}
      .sml-terminal-empty{color:#8fa4b6;background:#0d1720;border:1px dashed #2a3d4b;border-radius:8px;padding:10px;font-size:13px;line-height:1.45}
      @media(max-width:560px){body{padding-top:102px!important}body.admin-bar{padding-top:148px!important}.sml-global-ticker-search{padding:8px}.sml-global-ticker-search form{max-width:none;grid-template-columns:auto 1fr auto}.sml-global-brand{display:none}.sml-global-ticker-search button{padding:8px 10px}.sml-ticker-menu button{grid-template-columns:72px 1fr}.sml-ticker-menu small{grid-column:2}.sml-ticker-menu em{grid-column:1 / 3}}
      @media(max-width:820px){.sml-terminal-head{display:block}.sml-terminal-grid{grid-template-columns:1fr}.sml-terminal-hub{padding:0 10px}}
    </style>
    <script>
    (function(){
      var page = location.pathname.replace(/\/+$/,"").split("/").pop();
      var cache = {};
      var loggedIn = <?php echo is_user_logged_in() ? 'true' : 'false'; ?>;
      var restNonce = "<?php echo esc_js(wp_create_nonce('wp_rest')); ?>";
      var terminalTimers = {};
      function clean(v){
        return String(v || "").toUpperCase().replace(/^US\./,"").replace(/-US$/,"").replace(/[^A-Z0-9.]/g,"").slice(0,8);
      }
      function esc(v){
        var d = document.createElement("div");
        d.textContent = String(v || "");
        return d.innerHTML;
      }
      function api(q, limit){
        q = clean(q);
        var key = q + "|" + (limit || 14);
        if(cache[key]) return Promise.resolve(cache[key]);
        return fetch("/wp-json/sml-members/v1/ticker-search?q=" + encodeURIComponent(q) + "&limit=" + encodeURIComponent(limit || 14) + "&_=" + Date.now(), {credentials:"same-origin", cache:"no-store"})
          .then(function(r){return r.ok ? r.json() : {results:[]};})
          .then(function(data){cache[key] = data || {results:[]}; return cache[key];})
          .catch(function(){return {results:[]};});
      }
      function best(rows, symbol){
        symbol = clean(symbol);
        rows = rows || [];
        for(var i = 0; i < rows.length; i++){
          if(clean(rows[i].symbol) === symbol) return rows[i];
        }
        return rows[0] || null;
      }
      function directRow(symbol){
        symbol = clean(symbol || "NVDA") || "NVDA";
        return {
          symbol:symbol,
          name:symbol + " stock",
          exchange:"US",
          verified:false,
          terminal_url:"/stock-chart/?symbol=" + encodeURIComponent(symbol),
          tradingview_symbol:symbol,
          message:"Direct Moomoo-compatible ticker entry."
        };
      }
      function terminalUrl(row, symbol){
        row = row || directRow(symbol);
        return row.terminal_url || ("/stock-chart/?symbol=" + encodeURIComponent(clean(row.symbol || symbol || "NVDA")));
      }
      function fillDatalist(list, rows){
        if(!list) return;
        list.innerHTML = (rows || []).map(function(r){
          return '<option value="' + esc(r.symbol) + '">' + esc((r.name || r.symbol) + " - " + (r.exchange || "US")) + '</option>';
        }).join("");
      }
      function menuFor(input){
        if(!input) return null;
        var parent = input.parentElement;
        if(parent && getComputedStyle(parent).position === "static"){
          parent.style.position = "relative";
        }
        var existing = parent && parent.querySelector(".sml-ticker-menu");
        if(existing) return existing;
        var menu = document.createElement("div");
        menu.className = "sml-ticker-menu";
        menu.setAttribute("role","listbox");
        if(parent) parent.appendChild(menu);
        return menu;
      }
      function renderMenu(input, rows, onPick){
        var menu = menuFor(input);
        if(!menu) return;
        rows = rows || [];
        if(!rows.length){
          var typed = clean(input.value);
          menu.dataset.open = typed ? "1" : "0";
          menu.innerHTML = typed ? '<div class="sml-ticker-menu-empty">Press Enter to open $' + esc(typed) + '. Stockmarketloop will keep checking Moomoo for the exact listing and community feed.</div>' : "";
          return;
        }
        menu.dataset.open = "1";
        menu.innerHTML = rows.slice(0,10).map(function(r, idx){
          return '<button type="button" data-sml-pick="' + idx + '"><b>$' + esc(r.symbol) + '</b><span>' + esc(r.name || r.symbol) + '</span><small>' + esc(r.exchange || "US") + '</small><em>' + esc(r.verified ? "Moomoo/Stockmarketloop match" : "Direct ticker entry") + '</em></button>';
        }).join("");
        menu.querySelectorAll("[data-sml-pick]").forEach(function(btn){
          btn.addEventListener("mousedown", function(e){e.preventDefault();});
          btn.addEventListener("click", function(){
            var row = rows[parseInt(btn.dataset.smlPick,10)] || rows[0];
            input.value = row.symbol || "";
            menu.dataset.open = "0";
            onPick(row);
          });
        });
      }
      function hideMenusSoon(){
        window.setTimeout(function(){
          document.querySelectorAll(".sml-ticker-menu").forEach(function(menu){menu.dataset.open = "0";});
        }, 180);
      }
      function renderDirectory(rows){
        var grid = document.querySelector("[data-dir-grid]");
        if(!grid) return;
        rows = rows || [];
        grid.innerHTML = rows.length ? rows.map(function(r){
          return '<a class="sml-dir-card" href="' + esc(terminalUrl(r, r.symbol)) + '"><span>$' + esc(r.symbol) + '</span><strong>' + esc(r.name || r.symbol) + '</strong><small>' + esc(r.exchange || "US") + ' | <b>' + esc(r.verified ? "Verified" : "Direct") + '</b> | ' + esc(r.type || "STOCK") + '</small></a>';
        }).join("") : '<div class="sml-dir-card"><span>Search ready</span><strong>Type any Moomoo-buyable U.S. ticker</strong><small>The terminal opens immediately while verification keeps running.</small></div>';
      }
      function wireSearch(formSel, inputSel, listSel){
        var form = document.querySelector(formSel), input = document.querySelector(inputSel), list = document.querySelector(listSel);
        if(!form || !input) return;
        var timer = 0, latest = [];
        function load(){
          clearTimeout(timer);
          timer = setTimeout(function(){
            api(input.value, 14).then(function(data){
              latest = data.results || [];
              fillDatalist(list, latest);
              if(document.activeElement === input){
                renderMenu(input, latest, function(row){location.href = terminalUrl(row, row.symbol);});
              } else {
                var menu = menuFor(input);
                if(menu) menu.dataset.open = "0";
              }
              if(formSel === "[data-dir-form]") renderDirectory(latest);
            });
          }, 120);
        }
        input.addEventListener("input", load);
        input.addEventListener("focus", load);
        input.addEventListener("blur", hideMenusSoon);
        form.addEventListener("submit", function(e){
          e.preventDefault();
          e.stopImmediatePropagation();
          var typed = clean(input.value) || "NVDA";
          api(typed, 12).then(function(data){
            var row = best(data.results || latest, typed) || directRow(typed);
            location.href = terminalUrl(row, typed);
          }).catch(function(){
            location.href = "/stock-chart/?symbol=" + encodeURIComponent(typed);
          });
        }, true);
        load();
      }
      function renderChart(tvSymbol){
        var box = document.getElementById("sml-tv-chart");
        if(!box) return;
        box.innerHTML = "";
        var script = document.createElement("script");
        script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
        script.async = true;
        script.innerHTML = JSON.stringify({
          autosize:true,
          symbol:tvSymbol,
          interval:"15",
          timezone:"America/New_York",
          theme:"dark",
          style:"1",
          locale:"en",
          enable_publishing:false,
          allow_symbol_change:true,
          calendar:false,
          support_host:"https://www.tradingview.com"
        });
        box.appendChild(script);
      }
      function rest(path, opts){
        opts = opts || {};
        opts.credentials = "same-origin";
        opts.cache = "no-store";
        opts.headers = Object.assign({"Accept":"application/json","Content-Type":"application/json","X-WP-Nonce":restNonce}, opts.headers || {});
        return fetch("/wp-json/sml-members/v1/" + path, opts).then(function(r){
          return r.json().then(function(data){
            if(!r.ok){
              throw new Error((data && data.message) || "Request failed.");
            }
            return data;
          });
        });
      }
      function openSignup(){
        var btn = document.querySelector("[data-sml-open-signup]");
        if(btn){btn.click();return;}
        location.href = "/wp-login.php?action=register";
      }
      function brokerStatus(root, msg, good, bad){
        var el = root && root.querySelector("[data-broker-post-status]");
        if(!el)return;
        el.textContent = msg || "";
        el.dataset.good = good ? "1" : "0";
        el.dataset.bad = bad ? "1" : "0";
      }
      function brokerResultText(data){
        var results = (data && data.results) || {};
        var parts = Object.keys(results).map(function(key){
          var row = results[key] || {};
          return platformMeta(key).label + ": " + (row.message || row.status || "saved");
        });
        return parts.join(" | ") || (data && data.message) || "Broker request saved.";
      }
      function loadBrokerConnections(root){
        if(!loggedIn){
          brokerStatus(root, "Sign in before posting to Moomoo or Webull from the website.", false, true);
          return;
        }
        rest("broker-connections?_=" + Date.now()).then(function(data){
          root._smlBrokerConnections = (data && data.connections) || {};
          var c = root._smlBrokerConnections;
          var ready = [];
          ["moomoo","webull"].forEach(function(key){
            if(c[key] && c[key].connected) ready.push(platformMeta(key).label);
          });
          brokerStatus(root, ready.length ? ("Connected for broker posting: " + ready.join(", ") + ".") : "Broker direct posting is ready, but Moomoo/Webull OAuth/API connections still need to be connected.", !!ready.length, !ready.length);
        }).catch(function(){
          brokerStatus(root, "Broker connection status could not load yet.", false, true);
        });
      }
      function when(v){
        if(!v) return "";
        try{return new Date(v).toLocaleString();}catch(e){return String(v || "");}
      }
      function formatText(text){
        return esc(text || "")
          .replace(/\$([A-Z0-9.]{1,8})\b/g, function(_, s){return '<a class="sml-dollar" href="/stock-chart/?symbol=' + encodeURIComponent(clean(s)) + '">$' + esc(clean(s)) + '</a>';})
          .replace(/#([A-Za-z0-9_]{2,32})\b/g, function(_, tag){return '<a class="sml-hash" href="/?s=' + encodeURIComponent("#" + tag) + '">#' + esc(tag) + '</a>';})
          .replace(/@([A-Za-z0-9_.]{2,30})\b/g, function(_, tag){return '<a class="sml-mention" href="/?s=' + encodeURIComponent("@" + tag) + '">@' + esc(tag) + '</a>';});
      }
      function avatarHtml(row, label, cls){
        var name = String(label || "S").trim();
        var initial = esc((name.charAt(0) || "S").toUpperCase());
        var fallback = '<span class="' + cls + '">' + initial + '</span>';
        if(row && row.avatar_url){
          return '<span class="sml-avatar-wrap"><img src="' + esc(row.avatar_url) + '" alt="" loading="lazy" onerror="this.style.display=&quot;none&quot;;this.nextElementSibling.style.display=&quot;grid&quot;;">' + fallback + '</span>';
        }
        return fallback;
      }
      function badgeChip(badge){
        if(!badge || !badge.current_level)return "";
        return '<span class="sml-ach-badge sml-ach-' + esc(badge.current_tier || "locked") + '" title="' + esc((badge.label || "Badge") + " Level " + badge.current_level) + '">' + esc(badge.current_name || "Badge") + '</span>';
      }
      function candle(dir){
        return '<span class="sml-candle sml-candle-' + esc(dir) + '"><i></i></span>';
      }
      function voteControls(type, id, userId, row){
        var up = parseInt(row && row.upvote_count, 10) || 0;
        var down = parseInt(row && row.downvote_count, 10) || 0;
        var score = parseInt(row && row.vote_score, 10);
        if(isNaN(score)) score = up - down;
        var viewer = row && row.viewer_vote ? row.viewer_vote : "";
        return '<div class="sml-vote-row" data-vote-row="' + esc(type) + ':' + esc(id || "") + '">'
          + '<button type="button" data-post-vote="up" data-target-type="' + esc(type) + '" data-target-id="' + esc(id || "") + '" data-user-id="' + esc(userId || "") + '" data-active="' + (viewer === "up" ? "1" : "0") + '">' + candle("up") + up + '</button>'
          + '<button type="button" data-post-vote="down" data-target-type="' + esc(type) + '" data-target-id="' + esc(id || "") + '" data-user-id="' + esc(userId || "") + '" data-active="' + (viewer === "down" ? "1" : "0") + '">' + candle("down") + down + '</button>'
          + '<span class="sml-vote-score">' + (score >= 0 ? "+" : "") + score + '</span>'
          + '<button type="button" data-post-voters data-target-type="' + esc(type) + '" data-target-id="' + esc(id || "") + '" data-user-id="' + esc(userId || "") + '">voters</button>'
          + '</div>';
      }
      function drawVoters(holder, data){
        if(!holder)return;
        var up = (data && data.upvoters) || [], down = (data && data.downvoters) || [];
        function rows(title, items){
          return '<h4>' + esc(title) + '</h4>' + (items.length ? items.slice(0,12).map(function(u){return '<a href="' + esc(u.profile_url || "#") + '"><img src="' + esc(u.avatar_url || "") + '" alt=""><span>' + esc(u.handle || "Member") + '</span></a>';}).join("") : '<small>No voters yet.</small>');
        }
        holder.querySelectorAll(".sml-voter-pop").forEach(function(x){x.remove();});
        holder.insertAdjacentHTML("beforeend", '<div class="sml-voter-pop">' + rows("Green candle upvotes", up) + rows("Red candle downvotes", down) + '</div>');
      }
      function votePost(root, type, id, userId, vote, btn){
        if(!loggedIn){openSignup();return;}
        if(!id || !btn)return;
        btn.disabled = true;
        rest("post-vote", {method:"POST", body:JSON.stringify({target_type:type,target_id:id,user_id:userId || 0,vote:vote})}).then(function(){
          if(type === "stream"){
            loadStream(root, root.dataset.symbol || "SPY");
          }
        }).catch(function(err){alert(err.message || "Vote failed.");}).finally(function(){btn.disabled = false;});
      }
      function showPostVoters(type, id, userId, holder){
        if(!loggedIn){openSignup();return;}
        rest("post-voters?target_type=" + encodeURIComponent(type) + "&target_id=" + encodeURIComponent(id || "") + "&user_id=" + encodeURIComponent(userId || "") + "&_=" + Date.now()).then(function(data){drawVoters(holder, data);}).catch(function(err){alert(err.message || "Could not load voters.");});
      }
      function ensureTickerHub(symbol, row){
        removeLegacyMoomooFeed();
        var hub = document.querySelector("[data-sml-ticker-hub]");
        if(!hub){
          hub = document.createElement("section");
          hub.className = "sml-terminal-hub";
          hub.id = "comments";
          hub.setAttribute("data-sml-ticker-hub", "1");
          hub.innerHTML =
            '<div class="sml-terminal-head"><div><span>Live ticker terminal</span><h2 data-hub-title>$' + esc(symbol) + ' Feed</h2></div><a data-hub-primary-link href="/stock-chart/?symbol=' + encodeURIComponent(symbol) + '">Open terminal</a></div>' +
            '<div class="sml-terminal-grid"><div class="sml-terminal-panel"><h3 data-stream-title>$' + esc(symbol) + ' Stockmarketloop Feed</h3><div class="sml-terminal-composer" data-sml-stream-composer><textarea data-stream-input placeholder="Post to $' + esc(symbol) + ' ... use $tickers and #hashtags"></textarea><div class="sml-composer-menu" data-composer-menu></div><div class="sml-composer-preview" data-composer-preview></div><div class="sml-broker-posting"><span>Post to</span><button type="button" data-broker-destination="stockmarketloop" data-active="1">Stockmarketloop</button><button type="button" data-broker-destination="moomoo">Moomoo</button><button type="button" data-broker-destination="webull">Webull</button><button type="button" data-broker-destination="both">Moomoo + Webull</button></div><div class="sml-broker-stamps"><span>Trade proof</span><button type="button" data-broker-stamp="Moomoo">Moomoo</button><button type="button" data-broker-stamp="Webull">Webull</button><button type="button" data-broker-stamp="Robinhood">Robinhood</button></div><div class="sml-broker-post-status" data-broker-post-status>Stockmarketloop posting is ready. Broker posting checks your connected platform account first.</div><button type="button" data-stream-submit>Post to feed</button></div><button class="sml-stream-refresh" type="button" data-stream-refresh>Refresh feed</button><div class="sml-terminal-empty" data-stream-status>Loading ticker feed...</div><div class="sml-hashtag-row" data-stream-hashtags></div><div class="sml-stream-list" data-stream-list></div></div>' +
            '<div class="sml-terminal-side"><div class="sml-terminal-panel" data-sentiment-panel><h3 data-sentiment-title>$' + esc(symbol) + ' Daily Sentiment Poll</h3><small data-sentiment-status>Loading vote...</small><div class="sml-sentiment-meter"><div class="sml-meter-track"><div class="sml-meter-fill" data-bullish-fill></div></div><small data-sentiment-counts></small></div><div class="sml-sentiment-actions"><button type="button" data-vote="bullish">Bullish</button><button type="button" data-vote="bearish">Bearish</button></div><div class="sml-thought-list" data-thought-list></div></div>' +
            '<div class="sml-terminal-panel"><h3>Broker Platform Comments</h3><div class="sml-source-tabs"><a data-moomoo-link target="_blank" rel="noopener">Open Moomoo</a><a data-webull-link target="_blank" rel="noopener">Open Webull</a></div><small data-platform-status>Loading the 7 newest Moomoo and Webull comments into one feed...</small><div class="sml-source-list" data-platform-list></div></div></div></div>';
          var anchor = document.getElementById("sml-tv-chart") || document.querySelector("[data-chart-heading]") || document.querySelector("main") || document.body;
          if(anchor && anchor.parentElement && anchor.id === "sml-tv-chart"){
            anchor.parentElement.insertAdjacentElement("afterend", hub);
          } else if(anchor && anchor !== document.body && anchor.parentElement) {
            anchor.insertAdjacentElement("afterend", hub);
          } else {
            document.body.appendChild(hub);
          }
        }
        hub.dataset.symbol = symbol;
        var title = hub.querySelector("[data-hub-title]");
        if(title) title.textContent = "$" + symbol + " Feed";
        var streamTitle = hub.querySelector("[data-stream-title]");
        if(streamTitle) streamTitle.textContent = "$" + symbol + " Stockmarketloop Feed";
        var sentimentTitle = hub.querySelector("[data-sentiment-title]");
        if(sentimentTitle) sentimentTitle.textContent = "$" + symbol + " Daily Sentiment Poll";
        var input = hub.querySelector("[data-stream-input]");
        if(input) input.placeholder = "Post to $" + symbol + " ... use $tickers and #hashtags";
        var primary = hub.querySelector("[data-hub-primary-link]");
        if(primary) primary.href = "/stock-chart/?symbol=" + encodeURIComponent(symbol);
        var moomoo = hub.querySelector("[data-moomoo-link]");
        if(moomoo) moomoo.href = (row && row.community_url) || ("https://www.moomoo.com/stock/" + encodeURIComponent(symbol + "-US") + "/community");
        var webull = hub.querySelector("[data-webull-link]");
        if(webull) webull.href = webullUrl(symbol, row);
        return hub;
      }
      function removeLegacyMoomooFeed(){
        var legacy = document.getElementById("moomoo-feed");
        if(legacy) legacy.remove();
        document.querySelectorAll("[data-moomoo-feed],[data-moomoo-status],[data-moomoo-refresh]").forEach(function(el){
          var panel = el.closest("section,.sml-panel,.sml-terminal-panel");
          if(panel && !panel.hasAttribute("data-sml-ticker-hub")) panel.remove();
        });
        document.querySelectorAll("h2,h3").forEach(function(head){
          if(/^\s*Moomoo\s+Live\s+Feed\s*$/i.test(head.textContent || "")){
            var panel = head.closest("section,.sml-panel,.sml-terminal-panel");
            if(panel && !panel.hasAttribute("data-sml-ticker-hub")) panel.remove();
          }
        });
      }
      function webullUrl(symbol, row){
        var exchange = String((row && row.exchange) || "").toLowerCase();
        if(exchange === "amex") exchange = "nysearca";
        if(exchange !== "nyse" && exchange !== "nasdaq" && exchange !== "nysearca") exchange = clean(symbol) === "AMC" || clean(symbol) === "GME" ? "nyse" : "nasdaq";
        return "https://www.webull.com/quote/" + exchange + "-" + clean(symbol).toLowerCase();
      }
      function renderStream(root, data){
        var status = root.querySelector("[data-stream-status]");
        var list = root.querySelector("[data-stream-list]");
        var tags = root.querySelector("[data-stream-hashtags]");
        var rows = (data && data.comments) || [];
        if(status) status.textContent = rows.length ? ("Live $" + data.symbol + " feed loaded. Refreshes every " + (data.refresh_seconds || 20) + " seconds.") : "No Stockmarketloop comments for this ticker yet. Be first to post.";
        if(tags){
          tags.innerHTML = ((data && data.hashtags) || []).map(function(tag){return '<a href="/?s=' + encodeURIComponent("#" + tag) + '">#' + esc(tag) + '</a>';}).join("");
        }
        if(!list) return;
        if(!rows.length){list.innerHTML = "";return;}
        list.innerHTML = rows.map(function(row){
          var liked = row.viewer_liked ? "1" : "0", likes = parseInt(row.like_count, 10) || 0;
          return '<article class="sml-stream-card" data-stream-comment="' + esc(row.id || "") + '">' + avatarHtml(row, row.handle, "sml-stream-avatar-fallback") + '<div><strong><a href="' + esc(row.profile_url || "#") + '">' + esc(row.handle || "Member") + '</a>' + badgeChip(row.badge) + '</strong><p>' + formatText(row.text || "") + '</p><span>' + esc(when(row.date)) + '</span><div class="sml-stream-actions"><button type="button" data-stream-like="' + esc(row.id || "") + '" data-liked="' + liked + '">' + (liked === "1" ? "Liked" : "Like") + '</button><span>' + likes + ' likes</span></div>' + voteControls("stream", row.id || "", "", row) + '</div></article>';
        }).join("");
      }
      function likeStream(root, commentId, btn){
        if(!loggedIn){openSignup();return;}
        if(!commentId || !btn) return;
        btn.disabled = true;
        rest("stream-like", {method:"POST", body:JSON.stringify({comment_id:commentId})}).then(function(){
          loadStream(root, root.dataset.symbol || "SPY");
        }).catch(function(err){
          alert(err.message || "Could not update like.");
        }).finally(function(){btn.disabled = false;});
      }
      function loadStream(root, symbol){
        if(!loggedIn){
          var status = root.querySelector("[data-stream-status]");
          var composer = root.querySelector("[data-sml-stream-composer]");
          if(status) status.innerHTML = '<strong>Must sign in to live chat.</strong> Create an account or log in to view and post in the $' + esc(symbol) + ' live feed.';
          if(composer) composer.querySelectorAll("textarea,button").forEach(function(el){el.disabled = true;});
          return;
        }
        rest("stream?symbol=" + encodeURIComponent(symbol) + "&_=" + Date.now()).then(function(data){renderStream(root, data);}).catch(function(err){
          var status = root.querySelector("[data-stream-status]");
          if(status) status.textContent = err.message || "Ticker feed could not load.";
        });
      }
      function composerPreview(input, preview){
        if(!preview) return;
        preview.innerHTML = input && input.value ? formatText(input.value) : "Tip: type $ before a ticker to tag it, and # before a topic.";
      }
      function wireComposer(root, symbol){
        if(root.dataset.composerWired === "1") return;
        root.dataset.composerWired = "1";
        var input = root.querySelector("[data-stream-input]");
        var preview = root.querySelector("[data-composer-preview]");
        var menu = root.querySelector("[data-composer-menu]");
        var submit = root.querySelector("[data-stream-submit]");
        var refresh = root.querySelector("[data-stream-refresh]");
        var latestRows = [];
        var brokerStamp = "";
        var brokerDestination = "stockmarketloop";
        var replyContext = null;
        function setBrokerDestination(dest){
          brokerDestination = ["stockmarketloop","moomoo","webull","both"].indexOf(dest) >= 0 ? dest : "stockmarketloop";
          root.querySelectorAll("[data-broker-destination]").forEach(function(btn){
            btn.dataset.active = btn.dataset.brokerDestination === brokerDestination ? "1" : "0";
          });
          if(brokerDestination === "stockmarketloop"){
            brokerStatus(root, replyContext ? "Reply target cleared for Stockmarketloop-only posting." : "Stockmarketloop posting is ready.", true, false);
          } else {
            var label = brokerDestination === "both" ? "Moomoo + Webull" : platformMeta(brokerDestination).label;
            brokerStatus(root, (replyContext ? "Replying on " : "Posting to ") + label + ". Connection will be checked when you submit.", false, false);
          }
        }
        function clearReplyContext(){
          replyContext = null;
          root.querySelectorAll("[data-platform-reply]").forEach(function(btn){btn.dataset.active = "0";});
        }
        function sendBrokerPost(text, submit){
          var payload = {
            symbol: root.dataset.symbol || symbol,
            text: text,
            platform: brokerDestination,
            action: replyContext ? "reply" : "post",
            parent_id: replyContext ? replyContext.id : "",
            parent_source_url: replyContext ? replyContext.source_url : "",
            parent_source_name: replyContext ? replyContext.source_name : ""
          };
          submit.disabled = true;
          brokerStatus(root, "Sending broker request...", false, false);
          rest("broker-post", {method:"POST", body:JSON.stringify(payload)}).then(function(data){
            if(input) input.value = "";
            clearReplyContext();
            composerPreview(input, preview);
            brokerStatus(root, brokerResultText(data), !!(data && data.sent), !(data && data.sent));
            loadBrokerConnections(root);
          }).catch(function(err){
            brokerStatus(root, err.message || "Broker post could not be sent.", false, true);
          }).finally(function(){submit.disabled = false;});
        }
        function currentDollar(){
          if(!input) return null;
          var pos = input.selectionStart || input.value.length;
          var before = input.value.slice(0, pos);
          var m = before.match(/(^|\s)\$([A-Za-z0-9.]{0,8})$/);
          return m ? {query:m[2] || "", start:before.length - (m[2] || "").length - 1, pos:pos} : null;
        }
        function renderComposerMenu(rows){
          latestRows = rows || [];
          if(!menu) return;
          if(!latestRows.length){menu.dataset.open = "0";menu.innerHTML = "";return;}
          menu.dataset.open = "1";
          menu.innerHTML = latestRows.slice(0,8).map(function(r, idx){
            return '<button type="button" data-compose-pick="' + idx + '"><b>$' + esc(r.symbol) + '</b><span>' + esc(r.name || r.symbol) + '</span></button>';
          }).join("");
        }
        if(input){
          input.addEventListener("input", function(){
            composerPreview(input, preview);
            var hit = currentDollar();
            if(!hit){if(menu)menu.dataset.open = "0";return;}
            api(hit.query, 8).then(function(data){renderComposerMenu(data.results || []);});
          });
          input.addEventListener("focus", function(){composerPreview(input, preview);});
        }
        if(menu){
          menu.addEventListener("mousedown", function(e){e.preventDefault();});
          menu.addEventListener("click", function(e){
            var btn = e.target.closest("[data-compose-pick]");
            if(!btn || !input) return;
            var row = latestRows[parseInt(btn.dataset.composePick,10)] || latestRows[0];
            var hit = currentDollar();
            if(!row || !hit) return;
            input.value = input.value.slice(0, hit.start) + "$" + clean(row.symbol) + " " + input.value.slice(hit.pos);
            menu.dataset.open = "0";
            input.focus();
            composerPreview(input, preview);
          });
        }
        if(submit){
          submit.addEventListener("click", function(){
            if(!loggedIn){openSignup();return;}
            var text = input ? input.value.trim() : "";
            if(!text) return;
            if(brokerDestination !== "stockmarketloop"){
              sendBrokerPost(text, submit);
              return;
            }
            if(brokerStamp && text.indexOf("[Trade proof pending:") === -1){
              text += " [Trade proof pending: " + brokerStamp + "]";
            }
            submit.disabled = true;
            rest("stream", {method:"POST", body:JSON.stringify({symbol:root.dataset.symbol || symbol, text:text})}).then(function(){
              if(input) input.value = "";
              brokerStamp = "";
              clearReplyContext();
              setBrokerDestination("stockmarketloop");
              root.querySelectorAll("[data-broker-stamp]").forEach(function(btn){btn.dataset.active="0";});
              composerPreview(input, preview);
              loadStream(root, root.dataset.symbol || symbol);
            }).catch(function(err){alert(err.message || "Could not post.");}).finally(function(){submit.disabled = false;});
          });
        }
        if(refresh){refresh.addEventListener("click", function(){loadStream(root, root.dataset.symbol || symbol);});}
        root.addEventListener("click", function(e){
          var likeBtn = e.target.closest("[data-stream-like]");
          var voteBtn = e.target.closest("[data-post-vote]");
          var votersBtn = e.target.closest("[data-post-voters]");
          var brokerBtn = e.target.closest("[data-broker-stamp]");
          var destinationBtn = e.target.closest("[data-broker-destination]");
          var platformReplyBtn = e.target.closest("[data-platform-reply]");
          if(likeBtn){likeStream(root, likeBtn.dataset.streamLike, likeBtn);return;}
          if(voteBtn){votePost(root, voteBtn.dataset.targetType, voteBtn.dataset.targetId, voteBtn.dataset.userId, voteBtn.dataset.postVote, voteBtn);return;}
          if(votersBtn){showPostVoters(votersBtn.dataset.targetType, votersBtn.dataset.targetId, votersBtn.dataset.userId, votersBtn.closest(".sml-vote-row"));return;}
          if(destinationBtn){if(!loggedIn){openSignup();return;}clearReplyContext();setBrokerDestination(destinationBtn.dataset.brokerDestination || "stockmarketloop");return;}
          if(platformReplyBtn){
            if(!loggedIn){openSignup();return;}
            replyContext = {
              platform: platformReplyBtn.dataset.platform || "moomoo",
              id: platformReplyBtn.dataset.sourceId || "",
              source_url: platformReplyBtn.dataset.sourceUrl || "",
              source_name: platformReplyBtn.dataset.sourceName || "Broker user"
            };
            root.querySelectorAll("[data-platform-reply]").forEach(function(btn){btn.dataset.active = btn === platformReplyBtn ? "1" : "0";});
            setBrokerDestination(replyContext.platform);
            if(input && !input.value.trim()){
              input.value = "@" + replyContext.source_name.replace(/\s+/g, "") + " ";
            }
            if(input) input.focus();
            composerPreview(input, preview);
            brokerStatus(root, "Replying to " + replyContext.source_name + " on " + platformMeta(replyContext.platform).label + ".", false, false);
            return;
          }
          if(brokerBtn){if(!loggedIn){openSignup();return;}brokerStamp=brokerBtn.dataset.brokerStamp||"";root.querySelectorAll("[data-broker-stamp]").forEach(function(btn){btn.dataset.active=btn===brokerBtn?"1":"0";});if(preview)preview.innerHTML='Trade proof selected: <b>'+esc(brokerStamp)+'</b>. Official verification turns on after broker OAuth/API approval.';return;}
        });
        setBrokerDestination("stockmarketloop");
        composerPreview(input, preview);
      }
      function renderSentiment(root, data){
        var status = root.querySelector("[data-sentiment-status]");
        var fill = root.querySelector("[data-bullish-fill]");
        var counts = root.querySelector("[data-sentiment-counts]");
        var thoughts = root.querySelector("[data-thought-list]");
        if(status) status.textContent = data.user_vote ? ("Your vote: " + data.user_vote) : "Vote bullish or bearish for today's ticker prediction.";
        if(fill) fill.style.width = String(data.bullish_pct || 0) + "%";
        if(counts) counts.textContent = (data.bullish_pct || 0) + "% bullish / " + (data.bearish_pct || 0) + "% bearish from " + (data.total || 0) + " votes";
        if(thoughts){
          var rows = data.top_trader_thoughts || [];
          thoughts.innerHTML = rows.length ? rows.map(function(row){
            return '<article class="sml-thought-card">' + avatarHtml(row, row.handle, "sml-stream-avatar-fallback") + '<div><strong>' + esc(row.handle || "Top trader") + '</strong><p>' + formatText(row.text || "") + '</p><span>Featured trader thought</span></div></article>';
          }).join("") : '<div class="sml-terminal-empty">Top trader thoughts will appear after ranked members post in this ticker feed.</div>';
        }
      }
      function loadSentiment(root, symbol){
        rest("sentiment?symbol=" + encodeURIComponent(symbol) + "&_=" + Date.now()).then(function(data){renderSentiment(root, data);}).catch(function(){});
      }
      function wireSentiment(root, symbol){
        if(root.dataset.sentimentWired === "1") return;
        root.dataset.sentimentWired = "1";
        root.querySelectorAll("[data-vote]").forEach(function(btn){
          btn.addEventListener("click", function(){
            if(!loggedIn){openSignup();return;}
            btn.disabled = true;
            rest("sentiment", {method:"POST", body:JSON.stringify({symbol:root.dataset.symbol || symbol, vote:btn.dataset.vote})}).then(function(data){renderSentiment(root, data);}).catch(function(err){alert(err.message || "Vote failed.");}).finally(function(){btn.disabled = false;});
          });
        });
      }
      function platformMeta(kind){
        return kind === "moomoo"
          ? {label:"Moomoo", logo:"https://logo.clearbit.com/moomoo.com"}
          : {label:"Webull", logo:"https://logo.clearbit.com/webull.com"};
      }
      function platformBadge(kind){
        var meta = platformMeta(kind);
        return '<span class="sml-platform-badge" data-platform="' + esc(kind) + '"><img src="' + esc(meta.logo) + '" alt="' + esc(meta.label) + ' logo" onerror="this.hidden=true"><b>' + esc(meta.label) + '</b></span>';
      }
      function renderPlatformFeed(root){
        var list = root.querySelector("[data-platform-list]");
        var status = root.querySelector("[data-platform-status]");
        var store = root._smlPlatformRows || {};
        var messages = root._smlPlatformMessages || {};
        var rows = [];
        ["moomoo","webull"].forEach(function(kind){
          (store[kind] || []).forEach(function(row){
            var copy = Object.assign({}, row);
            copy.platform_kind = kind;
            rows.push(copy);
          });
        });
        rows.sort(function(a, b){
          return (Date.parse(b.date || "") || 0) - (Date.parse(a.date || "") || 0);
        });
        if(status){
          if(rows.length){
            status.textContent = "Showing the 7 newest broker-platform comments from Moomoo and Webull in one feed.";
          } else {
            status.textContent = [messages.moomoo, messages.webull].filter(Boolean).join(" | ") || "No broker-platform comments returned yet.";
          }
        }
        if(!list) return;
        if(!rows.length){
          list.innerHTML = '<div class="sml-terminal-empty">No Moomoo or Webull source comments returned yet for this ticker. The panel will keep refreshing.</div>';
          return;
        }
        list.innerHTML = rows.slice(0,7).map(function(row){
          var kind = row.platform_kind || "moomoo";
          var name = row.moomoo_name || row.webull_name || row.source_name || platformMeta(kind).label;
          var source = row.source_url ? '<a href="' + esc(row.source_url) + '" target="_blank" rel="noopener">source</a>' : '';
          return '<article class="sml-source-card" data-platform="' + esc(kind) + '">' + avatarHtml(row, name, "sml-source-avatar-fallback") + '<div><div class="sml-source-head">' + platformBadge(kind) + '<strong>' + esc(name) + '</strong></div><p>' + formatText(row.text || "") + '</p><span>' + esc(row.time_label || when(row.date)) + ' ' + source + '</span><div class="sml-platform-actions"><button type="button" data-platform-reply data-platform="' + esc(kind) + '" data-source-id="' + esc(row.id || "") + '" data-source-name="' + esc(name) + '" data-source-url="' + esc(row.source_url || "") + '">Reply on ' + esc(platformMeta(kind).label) + '</button></div></div></article>';
        }).join("");
      }
      function loadSource(root, symbol, kind){
        root._smlPlatformRows = root._smlPlatformRows || {};
        root._smlPlatformMessages = root._smlPlatformMessages || {};
        rest(kind + "-feed?symbol=" + encodeURIComponent(symbol) + "&_=" + Date.now()).then(function(data){
          root._smlPlatformRows[kind] = (data && data.posts) || [];
          root._smlPlatformMessages[kind] = data && data.message ? data.message : "";
          var link = root.querySelector("[data-" + kind + "-link]");
          if(link) link.href = data.community_url || data.quote_url || link.href;
          renderPlatformFeed(root);
        }).catch(function(err){
          root._smlPlatformRows[kind] = [];
          root._smlPlatformMessages[kind] = err.message || (platformMeta(kind).label + " feed could not load.");
          renderPlatformFeed(root);
        });
      }
      function loadTickerHub(symbol, row){
        removeLegacyMoomooFeed();
        var hub = ensureTickerHub(symbol, row);
        wireComposer(hub, symbol);
        wireSentiment(hub, symbol);
        loadStream(hub, symbol);
        loadSentiment(hub, symbol);
        loadBrokerConnections(hub);
        loadSource(hub, symbol, "moomoo");
        loadSource(hub, symbol, "webull");
        ["stream","sentiment","moomoo","webull"].forEach(function(key){if(terminalTimers[key]) clearInterval(terminalTimers[key]);});
        terminalTimers.stream = setInterval(function(){loadStream(hub, hub.dataset.symbol || symbol);}, 20000);
        terminalTimers.sentiment = setInterval(function(){loadSentiment(hub, hub.dataset.symbol || symbol);}, 30000);
        terminalTimers.moomoo = setInterval(function(){loadSource(hub, hub.dataset.symbol || symbol, "moomoo");}, 10000);
        terminalTimers.webull = setInterval(function(){loadSource(hub, hub.dataset.symbol || symbol, "webull");}, 10000);
      }
      function updateTerminal(){
        if(page !== "stock-chart") return;
        var params = new URLSearchParams(location.search);
        var symbol = clean(params.get("symbol") || "NVDA") || "NVDA";
        api(symbol, 12).then(function(data){
          var row = best(data.results || [], symbol) || directRow(symbol);
          var resolved = clean(row.symbol || symbol) || symbol;
          var input = document.querySelector("[data-symbol-input]");
          if(input) input.value = resolved;
          var title = document.querySelector("[data-symbol-title]");
          if(title) title.textContent = resolved;
          var statSymbol = document.querySelector("[data-stat-symbol]");
          if(statSymbol) statSymbol.textContent = "$" + resolved;
          var exchange = document.querySelector("[data-stat-exchange]");
          if(exchange) exchange.textContent = (row.exchange || "US") + (row.verified ? " / Moomoo-ready" : " / Direct ticker");
          var heading = document.querySelector("[data-chart-heading]");
          if(heading) heading.textContent = resolved + " Live Chart";
          document.querySelectorAll("[data-chat-symbol]").forEach(function(el){el.textContent = "$" + resolved;});
          var note = document.querySelector(".sml-chart-note");
          if(note){
            note.innerHTML = row.verified
              ? "Chart loaded for <strong>$" + esc(resolved) + "</strong> using the detected " + esc(row.exchange || "US") + " listing. Broker comments from Moomoo and Webull are combined below and capped to the 7 newest items."
              : "Direct ticker mode is active for <strong>$" + esc(resolved) + "</strong>. The terminal opens now, and Stockmarketloop keeps checking Moomoo for a verified listing/community feed.";
          }
          renderChart(row.tradingview_symbol || resolved);
          loadTickerHub(resolved, row);
        });
      }
      var note = document.querySelector(".sml-dir-note");
      if(note){
        note.innerHTML = '<strong>Coverage model:</strong> type any buyable U.S. stock or ETF symbol on Moomoo. Verified matches show in the dropdown; exact symbols still open the ticker terminal while Moomoo verification and community lookup continue in the background.';
      }
      wireSearch("[data-dir-form]", "[data-dir-input]", "#sml-dir-symbols");
      wireSearch("[data-symbol-form]", "[data-symbol-input]", "#sml-symbols");
      wireSearch("[data-global-ticker-form]", "[data-global-ticker-input]", "#sml-global-symbols");
      updateTerminal();
    })();
    </script>
    <?php
}

function sml_members_auth_gate_shortcode() {
    if (is_user_logged_in()) {
        $profile = sml_members_profile_payload(get_current_user_id());
        return '<a class="sml-member-link" href="' . esc_url($profile['profile_url']) . '">My Stockmarketloop Profile</a>';
    }

    return '<div class="sml-auth-gate"><strong>Must sign in to live chat.</strong><p>Create a Stockmarketloop account with a valid email and password, or log in to comment.</p><a href="' . esc_url(wp_login_url()) . '">Log in</a> <a href="' . esc_url(wp_registration_url()) . '">Sign up</a></div>';
}

function sml_members_profile_widget_shortcode() {
    $styles = '<style>.sml-profile-widget-shortcode{border:1px solid #22313d;background:#0d141b;color:#f4f7fb;border-radius:8px;padding:14px;font-family:Inter,Arial,sans-serif}.sml-profile-widget-shortcode a{color:#72d7ff;text-decoration:none;font-weight:900}.sml-profile-widget-shortcode p{color:#aebdcb;line-height:1.5}.sml-profile-widget-mini{display:grid;grid-template-columns:48px 1fr;gap:10px;align-items:center;margin-bottom:10px}.sml-profile-widget-mini img{width:48px;height:48px;border-radius:999px;object-fit:cover;border:2px solid #62f3a6;background:#17212b}.sml-profile-widget-mini strong{display:block;color:#fff}.sml-profile-widget-mini span{display:block;color:#95a6b5;font-size:12px}.sml-profile-widget-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:10px}.sml-profile-widget-actions a{border:1px solid #2a3d4b;background:#101a23;border-radius:6px;padding:9px;text-align:center}.sml-profile-widget-actions a:first-child{background:#62f3a6;color:#06100b;border-color:#62f3a6}.sml-profile-widget-watch{display:flex;gap:6px;flex-wrap:wrap}.sml-profile-widget-watch a{border:1px solid #2a3d4b;border-radius:999px;padding:6px 8px;color:#62f3a6}</style>';

    if (!is_user_logged_in()) {
        return $styles . '<div class="sml-profile-widget-shortcode"><strong>Build your Stockmarketloop profile.</strong><p>Sign in to edit your profile, follow traders, save a watchlist, and open ticker-stream notifications.</p><a href="' . esc_url(wp_login_url()) . '">Log in</a> <a href="' . esc_url(wp_registration_url()) . '">Create account</a></div>';
    }

    $profile = sml_members_profile_payload(get_current_user_id());
    if (is_wp_error($profile)) {
        return '';
    }

    $watchlist = $profile['watchlist'] ? implode('', array_map(function($symbol) {
        return '<a href="' . esc_url(home_url('/stock-chart/?symbol=' . rawurlencode($symbol))) . '">$' . esc_html($symbol) . '</a>';
    }, array_slice($profile['watchlist'], 0, 8))) : '<a href="' . esc_url(home_url('/stock-chart/?symbol=SPY')) . '">$SPY</a><a href="' . esc_url(home_url('/stock-chart/?symbol=QQQ')) . '">$QQQ</a><a href="' . esc_url(home_url('/stock-chart/?symbol=NVDA')) . '">$NVDA</a>';

    return $styles . '<div class="sml-profile-widget-shortcode">'
        . '<div class="sml-profile-widget-mini"><img data-sml-global-avatar src="' . esc_url($profile['avatar_url']) . '" alt=""><div><strong>' . esc_html($profile['handle']) . '</strong><span>' . esc_html($profile['followers_count']) . ' followers | ' . esc_html($profile['following_count']) . ' following</span></div></div>'
        . '<div class="sml-profile-widget-actions"><a href="' . esc_url($profile['profile_url']) . '">Edit Profile</a><a href="' . esc_url(home_url('/stock-chart/?symbol=SPY')) . '">Ticker Stream</a><a href="' . esc_url(home_url('/retail-trader-spotlight/')) . '">Retail Spotlight</a></div>'
        . '<div class="sml-profile-widget-watch">' . $watchlist . '</div>'
        . '</div>';
}

function sml_members_loop_bucks_shortcode() {
    $styles = '<style>.sml-loop-shortcode{border:1px solid #22313d;background:#0d141b;color:#f4f7fb;border-radius:8px;padding:16px;font-family:Inter,Arial,sans-serif}.sml-loop-shortcode h2{margin:0 0 8px;color:#fff}.sml-loop-shortcode p{color:#95a6b5;line-height:1.5}.sml-loop-shortcode a,.sml-loop-shortcode button{display:inline-block;border:1px solid #2a3d4b;background:#101a23;color:#72d7ff;border-radius:6px;padding:9px 10px;text-decoration:none;font-weight:900}.sml-loop-shortcode strong{color:#62f3a6}</style>';
    if (!is_user_logged_in()) {
        return $styles . '<div class="sml-loop-shortcode"><h2>Loop Bucks</h2><p>Sign in to open non-redeemable prediction channels and track your site-credit balance.</p><a href="' . esc_url(wp_login_url()) . '">Log in</a></div>';
    }
    $balance = sml_members_loop_bucks_balance(get_current_user_id());
    return $styles . '<div class="sml-loop-shortcode"><h2>Loop Bucks</h2><p>Your balance: <strong>' . esc_html($balance) . ' Loop Bucks</strong>.</p><p>Use the Loop Bucks button on the page to open or join non-cash prediction channels. Real-money purchases and payouts are disabled until compliance review is complete.</p><a href="' . esc_url(home_url('/stock-chart/?symbol=SPY')) . '">Open Ticker Terminal</a></div>';
}

function sml_members_handle($user_id) {
    $user = get_userdata($user_id);
    return get_user_meta($user_id, 'sml_display_handle', true) ?: ($user ? $user->display_name : 'Member');
}

function sml_members_clean_symbol($value) {
    /* uppercase FIRST, then strip: otherwise a lowercase "pltr" is stripped to "" and
       a watchlist add silently no-ops (owner report 2026-09-15). */
    return substr(preg_replace('/[^A-Z0-9.]/', '', strtoupper((string) $value)), 0, 8);
}

function sml_members_trending_seed_symbols() {
    $configured = get_option('sml_trending_tickers', array());
    if (is_string($configured)) {
        $configured = preg_split('/[\s,]+/', $configured);
    }
    if (!is_array($configured) || empty($configured)) {
        $configured = array(
            'NVDA', 'TSLA', 'AMC', 'AMD', 'AAPL',
            'MSFT', 'PLTR', 'SPY', 'QQQ', 'GME',
            'AMZN', 'META', 'AVGO', 'COIN', 'MSTR',
            'SOFI', 'RIVN', 'MU', 'SMCI', 'HOOD',
            'IONQ', 'RKLB', 'XOM', 'JPM', 'NFLX',
        );
    }

    $symbols = array();
    foreach ($configured as $symbol) {
        $symbol = sml_members_clean_symbol((string) $symbol);
        if ($symbol && !in_array($symbol, $symbols, true)) {
            $symbols[] = $symbol;
        }
        if (count($symbols) >= 25) {
            break;
        }
    }
    return $symbols;
}

function sml_members_trending_tickers($limit = 25) {
    $bucket = (int) floor(time() / 5);
    $rows = array();
    foreach (array_slice(sml_members_trending_seed_symbols(), 0, $limit) as $rank => $symbol) {
        $base = abs(crc32($symbol));
        $move_seed = abs(crc32($symbol . '|' . $bucket));
        $heat_seed = abs(crc32('heat|' . $symbol . '|' . $bucket));
        $price = (($base % 48000) + 250) / 100;
        $change_pct = (($move_seed % 900) - 450) / 100;
        $heat = 65 + ($heat_seed % 35);
        $rows[] = array(
            'rank' => $rank + 1,
            'symbol' => $symbol,
            'score' => number_format($price, 2, '.', ''),
            'change_pct' => number_format($change_pct, 2, '.', ''),
            'direction' => $change_pct >= 0 ? 'up' : 'down',
            'heat' => $heat,
            'url' => home_url('/stock-chart/?symbol=' . rawurlencode($symbol)),
        );
    }
    return $rows;
}

function sml_members_loop_bucks_balance($user_id) {
    $balance = get_user_meta($user_id, 'sml_loop_bucks', true);
    if ($balance === '' || $balance === null) {
        $balance = 1000;
        update_user_meta($user_id, 'sml_loop_bucks', $balance);
    }
    return max(0, (int) $balance);
}

function sml_members_loop_bucks_adjust($user_id, $delta, $reason = '') {
    $balance = sml_members_loop_bucks_balance($user_id);
    $balance = max(0, $balance + (int) $delta);
    update_user_meta($user_id, 'sml_loop_bucks', $balance);

    $ledger = get_user_meta($user_id, 'sml_loop_bucks_ledger', true);
    if (!is_array($ledger)) {
        $ledger = array();
    }
    array_unshift($ledger, array(
        'date' => gmdate('c'),
        'delta' => (int) $delta,
        'balance' => $balance,
        'reason' => sanitize_text_field($reason),
    ));
    update_user_meta($user_id, 'sml_loop_bucks_ledger', array_slice($ledger, 0, 100));
    return $balance;
}

function sml_members_format_cents($cents) {
    return '$' . number_format(max(0, (int) $cents) / 100, 2, '.', ',');
}

function sml_members_loop_purchase_quote($credits) {
    $credits = max(1, min(1000000, absint($credits)));
    $subtotal_cents = $credits * SML_LOOP_CREDIT_CENTS;
    $service_fee_cents = (int) ceil(($subtotal_cents * SML_LOOP_SERVICE_FEE_BPS) / 10000);
    $tax_cents = 0;
    $total_cents = $subtotal_cents + $service_fee_cents + $tax_cents;

    return array(
        'credits' => $credits,
        'credit_price_cents' => SML_LOOP_CREDIT_CENTS,
        'subtotal_cents' => $subtotal_cents,
        'service_fee_bps' => SML_LOOP_SERVICE_FEE_BPS,
        'service_fee_cents' => $service_fee_cents,
        'tax_cents' => $tax_cents,
        'total_cents' => $total_cents,
        'subtotal_display' => sml_members_format_cents($subtotal_cents),
        'service_fee_display' => sml_members_format_cents($service_fee_cents),
        'tax_display' => sml_members_format_cents($tax_cents),
        'total_display' => sml_members_format_cents($total_cents),
    );
}

function sml_members_clean_referral_code($code) {
    return substr(preg_replace('/[^A-Z0-9]/', '', strtoupper((string) $code)), 0, 24);
}

function sml_members_referral_code($user_id) {
    $existing = sml_members_clean_referral_code((string) get_user_meta($user_id, 'sml_referral_code', true));
    if ($existing) {
        return $existing;
    }

    $hash = strtoupper(substr(preg_replace('/[^A-Z0-9]/', '', wp_hash($user_id . '|sml_referral')), 0, 5));
    if (!$hash) {
        $hash = (string) wp_rand(10000, 99999);
    }

    $base = 'SML' . strtoupper(base_convert((int) $user_id, 10, 36));
    $code = sml_members_clean_referral_code($base . $hash);
    $tries = 0;
    while ($tries < 6) {
        $owner = sml_members_referrer_by_code($code);
        if (!$owner || (int) $owner === (int) $user_id) {
            update_user_meta($user_id, 'sml_referral_code', $code);
            return $code;
        }
        $code = sml_members_clean_referral_code($base . wp_rand(10000, 99999));
        $tries++;
    }

    update_user_meta($user_id, 'sml_referral_code', $code);
    return $code;
}

function sml_members_referrer_by_code($code) {
    $code = sml_members_clean_referral_code($code);
    if (!$code) {
        return 0;
    }

    $users = get_users(array(
        'meta_key' => 'sml_referral_code',
        'meta_value' => $code,
        'number' => 1,
        'fields' => 'ID',
    ));

    return !empty($users) ? absint($users[0]) : 0;
}

function sml_members_attach_referrer($new_user_id, $code) {
    $referrer_id = sml_members_referrer_by_code($code);
    if (!$referrer_id || (int) $referrer_id === (int) $new_user_id || get_user_meta($new_user_id, 'sml_referred_by', true)) {
        return false;
    }

    update_user_meta($new_user_id, 'sml_referred_by', $referrer_id);
    update_user_meta($new_user_id, 'sml_referred_code', sml_members_clean_referral_code($code));
    update_user_meta($new_user_id, 'sml_referral_started_at', time());

    $referrals = sml_members_id_list(get_user_meta($referrer_id, 'sml_referrals', true));
    if (!in_array((int) $new_user_id, $referrals, true)) {
        $referrals[] = (int) $new_user_id;
        update_user_meta($referrer_id, 'sml_referrals', array_values(array_unique($referrals)));
    }

    sml_members_add_notification($referrer_id, 'referral_pending', sml_members_handle($new_user_id) . ' joined with your referral link. Rewards unlock after the activity milestones are met.', home_url('/my-profile/'), $new_user_id);
    return true;
}

function sml_members_referral_tiers() {
    return array(
        array(
            'key' => '30d_12h',
            'label' => '30 days plus 12 active hours',
            'days' => 30,
            'seconds' => 12 * HOUR_IN_SECONDS,
            'credits' => 100,
        ),
        array(
            'key' => '90d_25h',
            'label' => '3 months plus 25 active hours',
            'days' => 90,
            'seconds' => 25 * HOUR_IN_SECONDS,
            'credits' => 1000,
        ),
        array(
            'key' => '180d_50h',
            'label' => '6 months plus 50 active hours',
            'days' => 180,
            'seconds' => 50 * HOUR_IN_SECONDS,
            'credits' => 10000,
        ),
    );
}

function sml_members_user_age_seconds($user_id) {
    $user = get_userdata($user_id);
    if (!$user || empty($user->user_registered)) {
        return 0;
    }
    return max(0, time() - (int) strtotime($user->user_registered . ' UTC'));
}

function sml_members_user_rule_flags($user_id) {
    $flags = (int) get_user_meta($user_id, 'sml_rule_flags', true);
    if (get_user_meta($user_id, 'sml_account_flagged', true)) {
        $flags = max(1, $flags);
    }
    return $flags;
}

function sml_members_maybe_award_referral_rewards($referred_user_id) {
    $referrer_id = absint(get_user_meta($referred_user_id, 'sml_referred_by', true));
    if (!$referrer_id || !get_userdata($referrer_id)) {
        return array();
    }
    if (sml_members_user_rule_flags($referred_user_id) > 0) {
        return array();
    }

    $age_seconds = sml_members_user_age_seconds($referred_user_id);
    $online_seconds = (int) get_user_meta($referred_user_id, 'sml_online_seconds', true);
    $awards = get_user_meta($referred_user_id, 'sml_referral_awards_paid', true);
    if (!is_array($awards)) {
        $awards = array();
    }

    $paid = array();
    foreach (sml_members_referral_tiers() as $tier) {
        if (!empty($awards[$tier['key']])) {
            continue;
        }
        if ($age_seconds >= ((int) $tier['days'] * DAY_IN_SECONDS) && $online_seconds >= (int) $tier['seconds']) {
            $awards[$tier['key']] = gmdate('c');
            $paid[] = $tier;
            sml_members_loop_bucks_adjust($referrer_id, (int) $tier['credits'], 'Referral reward: ' . sml_members_handle($referred_user_id) . ' reached ' . $tier['label']);
            sml_members_add_notification($referrer_id, 'referral_reward', 'Referral reward unlocked: +' . (int) $tier['credits'] . ' Loop Bucks from ' . sml_members_handle($referred_user_id) . '.', home_url('/my-profile/'), $referred_user_id);
        }
    }

    if ($paid) {
        update_user_meta($referred_user_id, 'sml_referral_awards_paid', $awards);
    }

    return $paid;
}

function sml_members_referral_payload($user_id) {
    $code = sml_members_referral_code($user_id);
    $referrals = sml_members_id_list(get_user_meta($user_id, 'sml_referrals', true));
    $rows = array();

    foreach (array_slice($referrals, 0, 30) as $referred_id) {
        if (!get_userdata($referred_id)) {
            continue;
        }
        sml_members_maybe_award_referral_rewards($referred_id);
        $age_seconds = sml_members_user_age_seconds($referred_id);
        $online_seconds = (int) get_user_meta($referred_id, 'sml_online_seconds', true);
        $awards = get_user_meta($referred_id, 'sml_referral_awards_paid', true);
        if (!is_array($awards)) {
            $awards = array();
        }
        $flags = sml_members_user_rule_flags($referred_id);
        $next_reward = '';
        foreach (sml_members_referral_tiers() as $tier) {
            if (empty($awards[$tier['key']])) {
                $next_reward = $flags ? 'Flagged account: payout paused' : ((int) $tier['credits'] . ' credits at ' . $tier['label']);
                break;
            }
        }

        $rows[] = array(
            'user_id' => $referred_id,
            'handle' => sml_members_handle($referred_id),
            'age_days' => round($age_seconds / DAY_IN_SECONDS, 1),
            'online_hours' => round($online_seconds / HOUR_IN_SECONDS, 2),
            'flags' => $flags,
            'awards_paid' => array_keys(array_filter($awards)),
            'next_reward' => $next_reward ?: 'All referral rewards paid',
        );
    }

    return array(
        'code' => $code,
        'share_url' => home_url('/?ref=' . rawurlencode($code)),
        'terms' => 'Referral rewards pay only after the referred account reaches the age and active-time milestones with no rule flags.',
        'tiers' => sml_members_referral_tiers(),
        'referrals' => $rows,
    );
}

function sml_members_loop_challenges() {
    $challenges = get_option('sml_loop_challenges', array());
    return is_array($challenges) ? $challenges : array();
}

function sml_members_loop_public_challenges($viewer_id = 0) {
    $rows = array();
    foreach (sml_members_loop_challenges() as $challenge) {
        if (is_array($challenge)) {
            $rows[] = sml_members_loop_public_challenge($challenge, $viewer_id);
        }
    }
    usort($rows, function($a, $b) {
        return strcmp((string) ($b['created_at'] ?? ''), (string) ($a['created_at'] ?? ''));
    });
    return array_slice($rows, 0, 30);
}

function sml_members_loop_public_challenge($challenge, $viewer_id = 0) {
    $entries = isset($challenge['entries']) && is_array($challenge['entries']) ? $challenge['entries'] : array();
    $public_entries = array();
    foreach ($entries as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $public_entries[] = array(
            'handle' => sanitize_text_field((string) ($entry['handle'] ?? 'Member')),
            'prediction' => sanitize_text_field((string) ($entry['prediction'] ?? '')),
            'stake' => absint($entry['stake'] ?? 0),
            'created_at' => gmdate('c', (int) ($entry['created_at'] ?? time())),
        );
    }

    $closes_at = (int) ($challenge['closes_at'] ?? 0);
    $status = sanitize_key((string) ($challenge['status'] ?? 'open'));
    if ($status === 'open' && $closes_at && time() >= $closes_at) {
        $status = 'closed';
    }

    return array(
        'id' => sanitize_text_field((string) ($challenge['id'] ?? '')),
        'symbol' => sml_members_clean_symbol((string) ($challenge['symbol'] ?? '')),
        'title' => sanitize_text_field((string) ($challenge['title'] ?? 'Prediction channel')),
        'mode' => sanitize_key((string) ($challenge['mode'] ?? 'direction')),
        'stake' => absint($challenge['stake'] ?? 0),
        'pot' => absint($challenge['stake'] ?? 0) * max(1, count($entries)),
        'status' => $status,
        'created_at' => gmdate('c', (int) ($challenge['created_at'] ?? time())),
        'closes_at' => $closes_at ? gmdate('c', $closes_at) : '',
        'entries_count' => count($entries),
        'joined' => $viewer_id ? isset($entries[$viewer_id]) : false,
        'entries' => array_slice($public_entries, 0, 8),
    );
}

function sml_members_clean_loop_prediction($prediction, $mode) {
    $mode = sanitize_key($mode);
    $prediction = trim(wp_strip_all_tags((string) $prediction));
    if ($mode === 'direction') {
        $prediction = strtolower($prediction);
        if (in_array($prediction, array('bull', 'bullish', 'up', 'green'), true)) {
            return 'bullish';
        }
        if (in_array($prediction, array('bear', 'bearish', 'down', 'red'), true)) {
            return 'bearish';
        }
        return '';
    }
    if ($mode === 'percent_gain') {
        $number = preg_replace('/[^0-9.\-]/', '', $prediction);
        if ($number === '' || !is_numeric($number)) {
            return '';
        }
        return number_format((float) $number, 2, '.', '') . '%';
    }
    if ($mode === 'prediction_count') {
        $count = absint($prediction);
        return $count ? (string) $count : '';
    }
    return substr(sanitize_text_field($prediction), 0, 80);
}

function sml_members_clean_stream_text($text) {
    $original = (string) $text;
    $text = wp_strip_all_tags($original);
    $text = preg_replace('/https?:\/\/[^\s]+/i', '', $text, -1, $count);
    preg_match_all('/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[A-Za-z0-9_-]+[^\s]*/i', $original, $youtube_urls);
    $allowed_youtube = array_slice(array_map('esc_url_raw', $youtube_urls[0] ?? array()), 0, 2);
    $text = trim(preg_replace('/\s+/', ' ', $text . ' ' . implode(' ', $allowed_youtube)));
    return substr($text, 0, 900);
}

function sml_members_stream_tickers($symbol, $text) {
    $tickers = array($symbol);
    if (preg_match_all('/\$([A-Z0-9.]{1,8})\b/', strtoupper($text), $matches)) {
        foreach ($matches[1] as $match) {
            $clean = sml_members_clean_symbol($match);
            if ($clean) {
                $tickers[] = $clean;
            }
        }
    }
    return array_values(array_unique(array_slice($tickers, 0, 8)));
}

function sml_members_extract_hashtags($text) {
    $tags = array();
    if (preg_match_all('/#([A-Za-z0-9_]{2,32})\b/', (string) $text, $matches)) {
        foreach ($matches[1] as $match) {
            $tag = strtolower(sanitize_key($match));
            if ($tag) {
                $tags[] = $tag;
            }
        }
    }
    return array_values(array_unique(array_slice($tags, 0, 12)));
}

function sml_members_extract_mentions($text) {
    $mentions = array();
    if (preg_match_all('/@([A-Za-z0-9_.]{2,30})\b/', (string) $text, $matches)) {
        foreach ($matches[1] as $match) {
            $handle = sml_members_clean_public_handle($match);
            if ($handle) {
                $mentions[] = $handle;
            }
        }
    }
    return array_values(array_unique(array_slice($mentions, 0, 12)));
}

function sml_members_user_id_by_public_handle($handle) {
    $handle = sml_members_clean_public_handle($handle);
    if (!$handle) {
        return 0;
    }

    $users = get_users(array(
        'number' => 1,
        'fields' => 'ID',
        'meta_key' => 'sml_public_handle',
        'meta_value' => $handle,
    ));
    if (!empty($users[0])) {
        return (int) $users[0];
    }

    $user = get_user_by('login', $handle);
    return $user ? (int) $user->ID : 0;
}

function sml_members_notify_mentions($author_id, $text, $link) {
    $author_id = absint($author_id);
    $author = sml_members_handle($author_id);
    foreach (sml_members_extract_mentions($text) as $handle) {
        $target_id = sml_members_user_id_by_public_handle($handle);
        if ($target_id && $target_id !== $author_id) {
            sml_members_add_notification(
                $target_id,
                'mention',
                $author . ' mentioned you on Stockmarketloop.',
                $link,
                $author_id
            );
        }
    }
}

function sml_members_parse_stream_comment($comment) {
    if (!$comment || strpos($comment->comment_content, SML_MEMBERS_STREAM_MARK) !== 0) {
        return null;
    }
    $raw = substr($comment->comment_content, strlen(SML_MEMBERS_STREAM_MARK));
    $parts = explode('|', $raw, 3);
    if (count($parts) !== 3) {
        return null;
    }
    $user_id = absint($parts[1]) ?: (int) $comment->user_id;
    $tickers = array_values(array_filter(array_map('sml_members_clean_symbol', explode(',', $parts[0]))));
    $text = wp_strip_all_tags($parts[2]);
    $likes = sml_members_id_list(get_comment_meta((int) $comment->comment_ID, 'sml_stream_like_user_ids', true));
    $viewer_id = get_current_user_id();
    $votes = sml_members_vote_summary(
        get_comment_meta((int) $comment->comment_ID, 'sml_stream_upvote_user_ids', true),
        get_comment_meta((int) $comment->comment_ID, 'sml_stream_downvote_user_ids', true),
        $viewer_id
    );
    return array_merge(array(
        'id' => (int) $comment->comment_ID,
        'parent_id' => (int) $comment->comment_parent,
        'user_id' => $user_id,
        'handle' => sml_members_handle($user_id),
        'avatar_url' => get_user_meta($user_id, 'sml_avatar_url', true) ?: get_avatar_url($user_id),
        'profile_url' => home_url('/members/' . $user_id . '/'),
        'tickers' => $tickers,
        'hashtags' => sml_members_extract_hashtags($text),
        'mentions' => sml_members_extract_mentions($text),
        'text' => $text,
        'date' => mysql2date('c', $comment->comment_date_gmt, false),
        'badge' => sml_members_primary_badge($user_id),
        'like_count' => count($likes),
        'viewer_liked' => $viewer_id ? in_array($viewer_id, $likes, true) : false,
    ), $votes);
}

function sml_members_notify_stream_followers($author_id, $comment_id, $tickers, $parent_id = 0) {
    $author = sml_members_handle($author_id);
    $primary = $tickers ? $tickers[0] : 'SPY';
    $link = home_url('/stock-chart/?symbol=' . rawurlencode($primary) . '#comments');
    $followers = sml_members_id_list(get_user_meta($author_id, 'sml_followers', true));
    foreach ($followers as $follower_id) {
        if ($follower_id !== (int) $author_id) {
            sml_members_add_notification($follower_id, 'stream_post', $author . ' posted in $' . $primary . '.', $link, $author_id);
        }
    }
    if ($parent_id) {
        $parent = get_comment($parent_id);
        if ($parent && (int) $parent->user_id && (int) $parent->user_id !== (int) $author_id) {
            sml_members_add_notification((int) $parent->user_id, 'reply', $author . ' replied to your $' . $primary . ' post.', $link, $author_id);
        }
    }
}

function sml_members_comment_post_notifications($comment_id, $approved, $commentdata) {
    if (!$approved || empty($commentdata['comment_content']) || strpos($commentdata['comment_content'], SML_MEMBERS_STREAM_MARK) !== 0) {
        return;
    }
    $parsed = sml_members_parse_stream_comment(get_comment($comment_id));
    if ($parsed) {
        sml_members_notify_stream_followers($parsed['user_id'], $comment_id, $parsed['tickers'], $parsed['parent_id']);
    }
}

function sml_members_sentiment_date() {
    return wp_date('Y-m-d');
}

function sml_members_sentiment_votes() {
    $votes = get_option('sml_sentiment_votes', array());
    return is_array($votes) ? $votes : array();
}

function sml_members_sentiment_key($symbol, $date) {
    return $date . '|' . sml_members_clean_symbol($symbol);
}

function sml_members_sentiment_counts($daily) {
    $bullish = 0;
    $bearish = 0;
    foreach ($daily as $row) {
        $vote = isset($row['vote']) ? sanitize_key($row['vote']) : '';
        if ($vote === 'bullish') {
            $bullish++;
        } elseif ($vote === 'bearish') {
            $bearish++;
        }
    }
    $total = $bullish + $bearish;
    return array(
        'bullish' => $bullish,
        'bearish' => $bearish,
        'total' => $total,
        'bullish_pct' => $total ? round(($bullish / $total) * 100) : 0,
        'bearish_pct' => $total ? round(($bearish / $total) * 100) : 0,
    );
}

function sml_members_get_sentiment_stats($user_id) {
    $stats = get_user_meta($user_id, 'sml_sentiment_stats', true);
    $defaults = array('points' => 0, 'right' => 0, 'wrong' => 0, 'votes' => 0, 'pending' => 0);
    if (!is_array($stats)) {
        return $defaults;
    }
    return array_merge($defaults, array_map('intval', $stats));
}

function sml_members_save_sentiment_stats($user_id, $stats) {
    update_user_meta($user_id, 'sml_sentiment_stats', array(
        'points' => max(0, (int) ($stats['points'] ?? 0)),
        'right' => max(0, (int) ($stats['right'] ?? 0)),
        'wrong' => max(0, (int) ($stats['wrong'] ?? 0)),
        'votes' => max(0, (int) ($stats['votes'] ?? 0)),
        'pending' => max(0, (int) ($stats['pending'] ?? 0)),
    ));
}

function sml_members_sentiment_leaderboard($limit = 10) {
    $users = get_users(array(
        'meta_key' => 'sml_sentiment_stats',
        'number' => 1000,
        'fields' => 'ID',
    ));
    $rows = array();
    foreach ($users as $user_id) {
        if ('1' === get_user_meta((int) $user_id, 'sml_hide_leaderboard', true)) {   // /settings/ → Privacy → "Show me on leaderboards" off
            continue;
        }
        $stats = sml_members_get_sentiment_stats((int) $user_id);
        if ($stats['votes'] <= 0) {
            continue;
        }
        $rows[] = array(
            'user_id' => (int) $user_id,
            'handle' => sml_members_handle((int) $user_id),
            'avatar_url' => get_user_meta((int) $user_id, 'sml_avatar_url', true) ?: get_avatar_url((int) $user_id),
            'profile_url' => home_url('/members/' . (int) $user_id . '/'),
            'points' => $stats['points'],
            'right' => $stats['right'],
            'wrong' => $stats['wrong'],
            'votes' => $stats['votes'],
            'pending' => $stats['pending'],
        );
    }
    usort($rows, function($a, $b) {
        if ($a['points'] !== $b['points']) {
            return $b['points'] <=> $a['points'];
        }
        if ($a['right'] !== $b['right']) {
            return $b['right'] <=> $a['right'];
        }
        return $b['votes'] <=> $a['votes'];
    });
    $rows = array_slice($rows, 0, max(1, (int) $limit));
    foreach ($rows as $index => &$row) {
        $row['rank'] = $index + 1;
    }
    unset($row);
    return $rows;
}

function sml_members_top_trader_thoughts($symbol, $limit = 10) {
    $leaderboard = sml_members_sentiment_leaderboard(10);
    $rank_map = array();
    foreach ($leaderboard as $row) {
        $rank_map[(int) $row['user_id']] = $row;
    }
    if (!$rank_map) {
        return array();
    }

    $comments = get_comments(array(
        'post_id' => SML_MEMBERS_STREAM_POST_ID,
        'status' => 'approve',
        'number' => 160,
        'orderby' => 'comment_date_gmt',
        'order' => 'DESC',
    ));

    $thoughts = array();
    $symbol = sml_members_clean_symbol($symbol);
    foreach ($comments as $comment) {
        $parsed = sml_members_parse_stream_comment($comment);
        if (!$parsed || !isset($rank_map[(int) $parsed['user_id']]) || !in_array($symbol, $parsed['tickers'], true)) {
            continue;
        }
        $rank = $rank_map[(int) $parsed['user_id']];
        $parsed['rank'] = $rank['rank'];
        $parsed['points'] = $rank['points'];
        $parsed['right'] = $rank['right'];
        $parsed['wrong'] = $rank['wrong'];
        $thoughts[] = $parsed;
        if (count($thoughts) >= $limit) {
            break;
        }
    }
    return $thoughts;
}

function sml_members_add_notification($user_id, $type, $message, $link = '', $actor_id = 0) {
    $items = sml_members_notifications($user_id);
    array_unshift($items, array(
        'id' => uniqid('sml_', true),
        'type' => sanitize_key($type),
        'message' => sanitize_text_field($message),
        'link' => esc_url_raw($link),
        'actor_id' => absint($actor_id),
        'read' => false,
        'date' => gmdate('c'),
    ));
    update_user_meta($user_id, 'sml_notifications', array_slice($items, 0, 80));
}

function sml_members_notifications($user_id) {
    $items = get_user_meta($user_id, 'sml_notifications', true);
    return is_array($items) ? $items : array();
}

function sml_members_id_list($items) {
    if (!is_array($items)) {
        return array();
    }
    return array_values(array_unique(array_filter(array_map('absint', $items))));
}

function sml_members_profile_accent($theme) {
    $map = array(
        'blue' => '#4bb8ff',
        'gold' => '#ffd166',
        'red' => '#ff6d7d',
        'green' => '#62f3a6',
    );
    return $map[$theme] ?? '#62f3a6';
}
