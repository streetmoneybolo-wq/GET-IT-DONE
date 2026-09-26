<?php
/**
 * Plugin Name: SML Link Tracker Analytics Tab Fix
 * Description: Force-loads the SML Link Tracker tab inside Creator Analytics using a separate plugin slug to bypass stale plugin-file caching.
 * Version: 1.0.9
 * Author: StockMarketLoop
 */

defined('ABSPATH') || exit;

define('SML_LIT_FIX_VERSION', '1.0.9');
define('SML_LIT_FIX_URL', plugin_dir_url(__FILE__));

function sml_lit_fix_is_creator_analytics_request() {
    if (is_admin() || (defined('REST_REQUEST') && REST_REQUEST) || (defined('DOING_AJAX') && DOING_AJAX)) return false;
    $uri = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '';
    if (false !== strpos($uri, '/wp-json/') || false !== strpos($uri, '/wp-admin/')) return false;
    $path = strtolower(rawurldecode((string) wp_parse_url($uri, PHP_URL_PATH)));
    $path = preg_replace('#/+#', '/', $path);
    return (bool) preg_match('#^/creator-studio/analytics/?$#', $path);
}

function sml_lit_fix_config() {
    return array(
        'rest' => esc_url_raw(rest_url('sml-intel/v1')),
        'nonce' => wp_create_nonce('wp_rest'),
        'isAdmin' => current_user_can('manage_options'),
    );
}

add_action('wp_enqueue_scripts', function () {
    if (!is_user_logged_in() || !sml_lit_fix_is_creator_analytics_request()) return;
    wp_enqueue_style(
        'sml-lit-analytics-tab-fix',
        SML_LIT_FIX_URL . 'assets/sml-link-tracker-analytics-tab-fix.css',
        array(),
        SML_LIT_FIX_VERSION . '-' . time()
    );
    wp_enqueue_script(
        'sml-lit-analytics-tab-fix',
        SML_LIT_FIX_URL . 'assets/sml-link-tracker-analytics-tab-fix.js',
        array(),
        SML_LIT_FIX_VERSION . '-' . time(),
        true
    );
    wp_localize_script('sml-lit-analytics-tab-fix', 'SML_LIT', sml_lit_fix_config());
}, 999);

add_action('wp_footer', function () {
    if (!is_user_logged_in() || !sml_lit_fix_is_creator_analytics_request()) return;
    echo "\n<!-- SML Link Tracker Analytics Tab Fix active -->\n";
    echo '<script id="sml-lit-tab-fix-config">window.SML_LIT=' . wp_json_encode(sml_lit_fix_config()) . ';</script>' . "\n";
    echo '<link rel="stylesheet" id="sml-lit-tab-fix-css" href="' . esc_url(SML_LIT_FIX_URL . 'assets/sml-link-tracker-analytics-tab-fix.css?v=' . SML_LIT_FIX_VERSION . '-' . time()) . '">' . "\n";
    echo '<script id="sml-lit-tab-fix-js" src="' . esc_url(SML_LIT_FIX_URL . 'assets/sml-link-tracker-analytics-tab-fix.js?v=' . SML_LIT_FIX_VERSION . '-' . time()) . '"></script>' . "\n";
}, 999);

function sml_lit_fix_markup() {
    return "\n<!-- SML Link Tracker Analytics Tab Fix buffer injector active -->\n"
        . '<script id="sml-lit-tab-fix-config-buffer">window.SML_LIT=' . wp_json_encode(sml_lit_fix_config()) . ';</script>' . "\n"
        . '<link rel="stylesheet" id="sml-lit-tab-fix-css-buffer" href="' . esc_url(SML_LIT_FIX_URL . 'assets/sml-link-tracker-analytics-tab-fix.css?v=' . SML_LIT_FIX_VERSION . '-' . time()) . '">' . "\n"
        . '<script id="sml-lit-tab-fix-js-buffer" src="' . esc_url(SML_LIT_FIX_URL . 'assets/sml-link-tracker-analytics-tab-fix.js?v=' . SML_LIT_FIX_VERSION . '-' . time()) . '"></script>' . "\n";
}

function sml_lit_fix_ob($html) {
    if (!is_string($html) || false === stripos($html, '</body>')) return $html;
    if (false !== strpos($html, 'sml-lit-tab-fix-js') || false !== strpos($html, 'sml-link-tracker-analytics-tab-fix.js')) return $html;
    $pos = strripos($html, '</body>');
    return substr($html, 0, $pos) . sml_lit_fix_markup() . substr($html, $pos);
}

add_action('init', function () {
    if (!sml_lit_fix_is_creator_analytics_request()) return;
    nocache_headers();
    ob_start('sml_lit_fix_ob');
}, 1);
