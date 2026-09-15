<?php
/**
 * Plugin Name: StockMarketLoop Video Upload Studio
 * Description: Adds a YouTube-style upload flow at /upload-video/ that publishes into the existing StockMarketLoop video library and watch-page system.
 * Version: 3.8.8
 * Author: OpenAI
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/watch-page.php';
require_once __DIR__ . '/studio-page.php';
require_once __DIR__ . '/studio-script.php';
require_once __DIR__ . '/golive-page.php';
require_once __DIR__ . '/golive-script.php';
require_once __DIR__ . '/creator-memberships.php';
require_once __DIR__ . '/golive-monetization.php';
require_once __DIR__ . '/creator-analytics.php';
require_once __DIR__ . '/creator-dashboard.php';
require_once __DIR__ . '/voice-schema.php';
require_once __DIR__ . '/voice-api.php';
require_once __DIR__ . '/voice-ui.php';
require_once __DIR__ . '/rtmp-keys.php';
require_once __DIR__ . '/letters-schema.php';
require_once __DIR__ . '/letters-api.php';
require_once __DIR__ . '/letters-editor.php';
require_once __DIR__ . '/letters-editor-script.php';
require_once __DIR__ . '/letters-public.php';
require_once __DIR__ . '/live-slots.php';
require_once __DIR__ . '/live-engage.php';
require_once __DIR__ . '/loopbucks-vault.php';
require_once __DIR__ . '/loopbucks-earn.php';
require_once __DIR__ . '/loopbucks-gates.php';
require_once __DIR__ . '/loopbucks-profile.php';
require_once __DIR__ . '/loopbucks-rank.php';
require_once __DIR__ . '/game-schema.php';
require_once __DIR__ . '/game-wager.php';
require_once __DIR__ . '/game-chess.php';
require_once __DIR__ . '/game-cards.php';
require_once __DIR__ . '/game-api.php';
require_once __DIR__ . '/game-panel.php';
require_once __DIR__ . '/dist-schema.php';
require_once __DIR__ . '/dist-engine.php';
require_once __DIR__ . '/dist-variants.php';
require_once __DIR__ . '/dist-cards.php';
require_once __DIR__ . '/dist-seo.php';
require_once __DIR__ . '/dist-trial.php';
require_once __DIR__ . '/dist-queue.php';
require_once __DIR__ . '/dist-bluesky.php';
require_once __DIR__ . '/dist-handoff.php';
require_once __DIR__ . '/dist-api.php';
require_once __DIR__ . '/dist-meta.php';
require_once __DIR__ . '/dist-threads.php';
require_once __DIR__ . '/dist-jetpack.php';
require_once __DIR__ . '/dist-page.php';

if (!function_exists('sml_video_upload_studio_page_slug')) {
    function sml_video_upload_studio_page_slug() {
        return 'upload-video';
    }
}

if (!function_exists('sml_video_upload_studio_page_url')) {
    function sml_video_upload_studio_page_url() {
        return home_url('/' . sml_video_upload_studio_page_slug() . '/');
    }
}

if (!function_exists('sml_video_upload_studio_auth_url')) {
    function sml_video_upload_studio_auth_url($redirect = '') {
        $url = home_url('/sign-up-sign-in/');
        if ($redirect !== '') {
            $url = add_query_arg('redirect_to', rawurlencode($redirect), $url);
        }
        return $url;
    }
}

if (!function_exists('sml_video_upload_studio_get_page')) {
    function sml_video_upload_studio_get_page() {
        $page = get_page_by_path(sml_video_upload_studio_page_slug(), OBJECT, 'page');
        return $page instanceof WP_Post ? $page : null;
    }
}

if (!function_exists('sml_video_upload_studio_ensure_page')) {
    function sml_video_upload_studio_ensure_page() {
        if (wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }

        $page = sml_video_upload_studio_get_page();
        if ($page) {
            return;
        }

        wp_insert_post(array(
            'post_type' => 'page',
            'post_status' => 'publish',
            'post_title' => 'Upload Video',
            'post_name' => sml_video_upload_studio_page_slug(),
            'post_content' => '[sml_video_upload_studio]',
        ));
    }
}
add_action('init', 'sml_video_upload_studio_ensure_page', 60);

if (!function_exists('sml_video_upload_studio_redirect_legacy_route')) {
    function sml_video_upload_studio_redirect_legacy_route() {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }

        $mode = isset($_GET['mode']) ? sanitize_key((string) wp_unslash($_GET['mode'])) : '';
        if ($mode !== 'upload') {
            return;
        }

        $request_path = wp_parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH);
        $request_path = trim((string) $request_path, '/');
        if ($request_path !== 'go-live') {
            return;
        }

        wp_safe_redirect(sml_video_upload_studio_page_url(), 302);
        exit;
    }
}
add_action('template_redirect', 'sml_video_upload_studio_redirect_legacy_route', 1);

if (!function_exists('sml_video_upload_studio_is_page')) {
    function sml_video_upload_studio_is_page() {
        if (is_admin()) {
            return false;
        }
        $request_path = wp_parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH);
        $request_path = trim((string) $request_path, '/');
        if ($request_path === sml_video_upload_studio_page_slug()) {
            return true;
        }
        if (function_exists('is_page') && is_page(sml_video_upload_studio_page_slug())) {
            return true;
        }
        $queried = get_queried_object();
        return $queried instanceof WP_Post && $queried->post_type === 'page' && $queried->post_name === sml_video_upload_studio_page_slug();
    }
}

if (!function_exists('sml_video_upload_studio_asset_url')) {
    function sml_video_upload_studio_asset_url($path) {
        return plugins_url($path, __FILE__);
    }
}

if (!function_exists('sml_video_upload_studio_default_thumb')) {
    function sml_video_upload_studio_default_thumb() {
        if (function_exists('sml_members_social_image_url')) {
            $social = sml_members_social_image_url();
            if ($social) {
                return esc_url_raw($social);
            }
        }

        if (function_exists('sml_members_brand_icon_url')) {
            $brand = sml_members_brand_icon_url();
            if ($brand) {
                return esc_url_raw($brand);
            }
        }

        $icon_id = (int) get_option('site_icon');
        if ($icon_id) {
            $icon = wp_get_attachment_image_url($icon_id, 'full');
            if ($icon) {
                return esc_url_raw($icon);
            }
        }

        return '';
    }
}

if (!function_exists('sml_video_upload_studio_user_profile_url')) {
    function sml_video_upload_studio_user_profile_url($user_id) {
        if ($user_id && function_exists('sml_members_profile_url')) {
            $profile = sml_members_profile_url($user_id);
            if ($profile) {
                return esc_url_raw($profile);
            }
        }
        return esc_url_raw(home_url('/my-profile/'));
    }
}

if (!function_exists('sml_video_upload_studio_creator_identity')) {
    /** Public Loop Channel identity only; never expose private WP account names. */
    function sml_video_upload_studio_creator_identity($user_id) {
        $user_id = absint($user_id);
        $name = $user_id ? trim((string) get_user_meta($user_id, 'sml_channel_name', true)) : '';
        $handle = $user_id ? sanitize_key((string) get_user_meta($user_id, 'sml_channel_handle', true)) : '';
        $avatar_id = $user_id ? absint(get_user_meta($user_id, 'sml_channel_avatar_id', true)) : 0;
        $avatar = $avatar_id ? wp_get_attachment_image_url($avatar_id, 'thumbnail') : '';

        return array(
            'name' => '' !== $name ? $name : 'Creator',
            'handle' => $handle,
            'avatar' => $avatar ? esc_url_raw($avatar) : '',
            'url' => $handle ? esc_url_raw(home_url('/channel/' . rawurlencode($handle) . '/')) : '',
        );
    }
}

if (!function_exists('sml_video_upload_studio_config')) {
    function sml_video_upload_studio_config() {
        $user_id = get_current_user_id();
        $identity = sml_video_upload_studio_creator_identity($user_id);

        return array(
            'loggedIn' => is_user_logged_in(),
            'nonce' => wp_create_nonce('wp_rest'),
            'userId' => $user_id,
            'displayName' => $identity['name'],
            'chartMediaEndpoint' => esc_url_raw(rest_url('sml-members/v1/chart-media')),
            'profileChartEndpoint' => esc_url_raw(rest_url('sml-members/v1/profile-chart')),
            'pluginUploadEndpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/upload')),
            'pluginPublishEndpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/publish')),
            'orbitEndpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/orbit-settings')),
            'orbitSettings' => $user_id && function_exists('sml_vus_orbit_live_get') ? sml_vus_orbit_live_get($user_id) : array('enabled' => false, 'items' => array()),
            'uploadPageUrl' => esc_url_raw(sml_video_upload_studio_page_url()),
            'creatorStudioUrl' => esc_url_raw(home_url('/creator-studio/')),
            'profileUrl' => $identity['url'],
            'loginUrl' => esc_url_raw(sml_video_upload_studio_auth_url(sml_video_upload_studio_page_url())),
            'watchBaseUrl' => esc_url_raw(home_url('/watch/')),
            'defaultThumbnail' => sml_video_upload_studio_default_thumb(),
            'siteName' => get_bloginfo('name'),
            'siteTagline' => get_bloginfo('description'),
        );
    }
}

if (!function_exists('sml_video_upload_studio_library')) {
    function sml_video_upload_studio_library() {
        $library = get_option('sml_video_upload_studio_library', array());
        return is_array($library) ? $library : array();
    }
}

if (!function_exists('sml_video_upload_studio_save_library')) {
    function sml_video_upload_studio_save_library($library) {
        update_option('sml_video_upload_studio_library', is_array($library) ? $library : array(), false);
    }
}

if (!function_exists('sml_video_upload_studio_generate_id')) {
    function sml_video_upload_studio_generate_id() {
        return strtolower(wp_generate_password(12, false, false));
    }
}

if (!function_exists('sml_video_upload_studio_watch_url')) {
    function sml_video_upload_studio_watch_url($video_id) {
        $video_id = sanitize_key((string) $video_id);
        return $video_id ? home_url('/watch/' . rawurlencode($video_id) . '/') : '';
    }
}

if (!function_exists('sml_video_upload_studio_get_video')) {
    function sml_video_upload_studio_get_video($video_id) {
        $video_id = sanitize_key((string) $video_id);
        $library = sml_video_upload_studio_library();
        if (!$video_id || empty($library[$video_id]) || !is_array($library[$video_id])) {
            return null;
        }
        return $library[$video_id];
    }
}

if (!function_exists('sml_video_upload_studio_handle_upload')) {
    function sml_video_upload_studio_handle_upload(WP_REST_Request $request) {
        $kind = sanitize_key((string) $request->get_param('kind'));
        if (!in_array($kind, array('photo', 'video'), true)) {
            return new WP_Error('sml_bad_media_kind', 'Choose a photo or video upload.', array('status' => 400));
        }

        if (empty($_FILES['media']) || !is_array($_FILES['media'])) {
            return new WP_Error('sml_no_media_file', 'Choose an image or video before posting.', array('status' => 400));
        }

        $file = $_FILES['media'];
        $error = isset($file['error']) ? (int) $file['error'] : UPLOAD_ERR_NO_FILE;
        if ($error !== UPLOAD_ERR_OK) {
            return new WP_Error('sml_media_upload_error', 'The upload did not complete. Try a smaller file or refresh and upload again.', array('status' => 400));
        }

	// Thumbnail images/GIFs are allowed up to 50 MB. Other photo purposes keep
	// their narrower limits so raising thumbnails does not silently raise every
	// creator-media upload. Animated GIFs retain their original file/animation.
	if ( 'photo' === $kind ) {
		$sml_photo_purpose = sanitize_key( (string) $request->get_param( 'purpose' ) );
		$sml_photo_limit_mb = 'thumbnail' === $sml_photo_purpose ? 50 : ( 'orbit' === $sml_photo_purpose ? 20 : 5 );
		$sml_photo_size = isset( $file['size'] ) ? (int) $file['size'] : 0;
		if ( $sml_photo_size > $sml_photo_limit_mb * 1024 * 1024 ) {
			return new WP_Error(
				'sml_media_too_large',
				sprintf( 'This image must be %d MB or smaller.', $sml_photo_limit_mb ),
				array( 'status' => 413 )
			);
		}
	}

	require_once ABSPATH . 'wp-admin/includes/file.php';

        $upload = wp_handle_upload($file, array(
            'test_form' => false,
            'mimes' => array(
                'jpg|jpeg|jpe' => 'image/jpeg',
                'png' => 'image/png',
                'gif' => 'image/gif',
                'webp' => 'image/webp',
                'mp4|m4v' => 'video/mp4',
                'mov' => 'video/quicktime',
                'webm' => 'video/webm',
            ),
        ));

        if (!empty($upload['error'])) {
            return new WP_Error('sml_media_upload_failed', sanitize_text_field((string) $upload['error']), array('status' => 500));
        }

        $mime = sanitize_mime_type((string) ($upload['type'] ?? ''));
        return array(
            'url' => esc_url_raw((string) ($upload['url'] ?? '')),
            'type' => $kind === 'video' ? 'video' : 'image',
            'mime' => $mime,
            'name' => sanitize_file_name((string) ($file['name'] ?? 'upload')),
            'message' => ($kind === 'video' ? 'Video' : 'Image') . ' upload complete.',
        );
    }
}

if (!function_exists('sml_video_upload_studio_publish_video')) {
    function sml_video_upload_studio_publish_video(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        if (!$user_id) {
            return new WP_Error('sml_login_required', 'Sign in to publish a video.', array('status' => 401));
        }

        $title = sanitize_text_field((string) $request->get_param('title'));
        $description = sanitize_textarea_field((string) $request->get_param('description'));
        $ticker = strtoupper(preg_replace('/[^A-Z]/', '', (string) $request->get_param('ticker')));
        $visibility = sanitize_key((string) $request->get_param('visibility'));
        $visibility = in_array($visibility, array('public', 'unlisted', 'private', 'scheduled', 'members', 'premium'), true) ? $visibility : 'public';
        $short = filter_var($request->get_param('short'), FILTER_VALIDATE_BOOLEAN);
        $video_url = esc_url_raw((string) $request->get_param('video_url'));
        $video_name = sanitize_text_field((string) $request->get_param('video_name'));
        $video_mime = sanitize_mime_type((string) $request->get_param('video_mime'));
        $thumbnail_url = esc_url_raw((string) $request->get_param('thumbnail_url'));
        $tags = array_values(array_filter(array_map('sanitize_text_field', (array) $request->get_param('tags'))));
        $hashtags = array_values(array_filter(array_map('sanitize_text_field', (array) $request->get_param('hashtags'))));
        $seo_title = sanitize_text_field((string) $request->get_param('seo_title'));
        $orbit_cards = function_exists('sml_vus_orbit_sanitize_items') ? sml_vus_orbit_sanitize_items($request->get_param('orbit_cards')) : array();

        if (!$title) {
            return new WP_Error('sml_video_title_required', 'Add a title before publishing.', array('status' => 400));
        }
        if (!$description) {
            return new WP_Error('sml_video_description_required', 'Add a description before publishing so the video card has complete details.', array('status' => 400));
        }
        if (!$video_url) {
            return new WP_Error('sml_video_url_required', 'Upload the video file before publishing.', array('status' => 400));
        }
        if (!$thumbnail_url || 0 !== strpos($thumbnail_url, 'https://')) {
            return new WP_Error('sml_video_thumbnail_required', 'Upload a thumbnail image or GIF before publishing.', array('status' => 400));
        }

        $tickers = array();
        foreach ((array) $request->get_param('tickers') as $entry) {
            $clean = strtoupper(preg_replace('/[^A-Z]/', '', (string) $entry));
            if ($clean && !in_array($clean, $tickers, true)) {
                $tickers[] = $clean;
            }
        }
        if ($ticker && !in_array($ticker, $tickers, true)) {
            array_unshift($tickers, $ticker);
        }

        $chapters = array();
        foreach ((array) $request->get_param('chapters') as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $label = sanitize_text_field((string) ($entry['label'] ?? ''));
            $time = sanitize_text_field((string) ($entry['time'] ?? ''));
            if ($label || $time) {
                $chapters[] = array('time' => $time, 'label' => $label);
            }
        }

        $alert_images = array();
        foreach ((array) $request->get_param('alert_images') as $entry) {
            if (!is_array($entry) || empty($entry['url'])) {
                continue;
            }
            $alert_images[] = array(
                'url' => esc_url_raw((string) $entry['url']),
                'title' => sanitize_text_field((string) ($entry['title'] ?? '')),
                'note' => sanitize_text_field((string) ($entry['note'] ?? '')),
                'time' => sanitize_text_field((string) ($entry['time'] ?? '')),
            );
        }

        $surfaces = array_values(array_filter(array_map('sanitize_key', (array) $request->get_param('surfaces'))));
        $sectors = array_values(array_filter(array_map('sanitize_text_field', (array) $request->get_param('sectors'))));
        $watch_interest = array_values(array_filter(array_map('sanitize_text_field', (array) $request->get_param('watch_interest'))));
        $content_type = sanitize_text_field((string) $request->get_param('content_type'));
        $language = sanitize_text_field((string) $request->get_param('language'));
        $recorded_at = sanitize_text_field((string) $request->get_param('recorded_at'));
        $schedule_at = sanitize_text_field((string) $request->get_param('schedule_at'));

        $video_id = sml_video_upload_studio_generate_id();
        $dist_entity_id = function_exists('sml_dist_numeric_entity_id')
            ? sml_dist_numeric_entity_id('video', $video_id, $user_id . '|' . $video_url)
            : (int) sprintf('%u', crc32('video|' . $video_id . '|' . $user_id . '|' . $video_url));
        $video = array(
            'id' => $video_id,
            'dist_entity_id' => $dist_entity_id,
            'tickers' => $tickers,
            'chapters' => $chapters,
            'alert_images' => $alert_images,
            'orbit_cards' => $orbit_cards,
            'surfaces' => $surfaces,
            'sectors' => $sectors,
            'watch_interest' => $watch_interest,
            'content_type' => $content_type,
            'language' => $language,
            'recorded_at' => $recorded_at,
            'schedule_at' => $schedule_at,
            'author_id' => $user_id,
            'display_name' => sml_video_upload_studio_creator_identity($user_id)['name'],
            'profile_url' => sml_video_upload_studio_creator_identity($user_id)['url'],
            'title' => $title,
            'seo_title' => $seo_title ?: $title,
            'description' => $description,
            'ticker' => $ticker,
            'visibility' => $visibility,
            'short' => $short,
            'is_short' => $short,
            'video_url' => $video_url,
            'video_name' => $video_name ?: $title,
            'video_mime' => $video_mime ?: 'video/mp4',
            'thumbnail_url' => $thumbnail_url,
            'tags' => $tags,
            'hashtags' => $hashtags,
            'created_at' => gmdate('c'),
            'updated_at' => gmdate('c'),
            'watch_url' => sml_video_upload_studio_watch_url($video_id),
        );

        $library = sml_video_upload_studio_library();
        $library[$video_id] = $video;
        sml_video_upload_studio_save_library($library);

        // Private, member-only and scheduled videos must never leak into a
        // public social queue. Public videos enter the same event pipeline as
        // Loop Letters so every connected platform keeps its own variant.
        if ($visibility === 'public' && function_exists('sml_dist_bundle_from_video')) {
            do_action('sml_dist_event', 'video.publish', sml_dist_bundle_from_video($video));
        }

        return array(
            'created' => true,
            'video' => $video,
            'watch_url' => $video['watch_url'],
            'post' => array(
                'media' => array(
                    'watch_url' => $video['watch_url'],
                ),
            ),
        );
    }
}

if (!function_exists('sml_video_upload_studio_register_rest_routes')) {
    function sml_video_upload_studio_register_rest_routes() {
        register_rest_route('sml-video-upload-studio/v1', '/upload', array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => 'sml_vus_can_create',
            'callback' => 'sml_video_upload_studio_handle_upload',
        ));

        register_rest_route('sml-video-upload-studio/v1', '/publish', array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => 'sml_vus_can_create',
            'callback' => 'sml_video_upload_studio_publish_video',
        ));
    }
}
add_action('rest_api_init', 'sml_video_upload_studio_register_rest_routes');

if (!function_exists('sml_video_upload_studio_render_watch_page')) {
    function sml_video_upload_studio_render_watch_page() {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }

        $path = trim((string) wp_parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
        if (!preg_match('#^watch/([A-Za-z0-9_-]{8,32})/?$#', $path, $matches)) {
            return;
        }

        $video = sml_video_upload_studio_get_video($matches[1]);
        if (!$video) {
            return;
        }

        $viewer_id = get_current_user_id();
        $visibility = $video['visibility'] ?? 'public';
        $author_id = (int) ($video['author_id'] ?? 0);
        if ($visibility === 'private' && (int) $viewer_id !== $author_id && !current_user_can('manage_options')) {
            status_header(403);
            wp_die('This video is private.');
        }
        if (in_array($visibility, array('members', 'premium'), true)
            && (!function_exists('sml_gl_user_has_content_access') || !sml_gl_user_has_content_access($viewer_id, $author_id))) {
            status_header(403);
            wp_die('This video is available to this creator\'s Content Members.');
        }

        sml_vus_render_watch_layout($video);
        exit;
    }
}
add_action('template_redirect', 'sml_video_upload_studio_render_watch_page', 0);

if (!function_exists('sml_video_upload_studio_enqueue')) {
    function sml_video_upload_studio_enqueue() {
        if (!sml_video_upload_studio_is_page()) {
            return;
        }

        wp_enqueue_style(
            'sml-video-upload-studio',
            sml_video_upload_studio_asset_url('assets/upload-studio.css'),
            array(),
            '1.0.0'
        );
    }
}
add_action('wp_enqueue_scripts', 'sml_video_upload_studio_enqueue', 40);

if (!function_exists('sml_video_upload_studio_footer_boot')) {
    function sml_video_upload_studio_footer_boot() {
        if (!sml_video_upload_studio_is_page()) {
            return;
        }

        $config = wp_json_encode(sml_video_upload_studio_config());
        $script_body = <<<'SMLVIDEOJS'
(function () {
  'use strict';

  function readConfigFromScripts() {
    var scripts = Array.prototype.slice.call(document.scripts || []);
    for (var i = 0; i < scripts.length; i += 1) {
      var text = String(scripts[i].textContent || '');
      if (text.indexOf('smlVideoUploadStudioConfig') === -1) {
        continue;
      }
      var match = text.match(/smlVideoUploadStudioConfig\s*=\s*(\{[\s\S]*?\});/);
      if (!match || !match[1]) {
        continue;
      }
      try {
        return JSON.parse(match[1]);
      } catch (error) {
        continue;
      }
    }
    return {};
  }

  var cfg = window.smlVideoUploadStudioConfig || readConfigFromScripts() || {};
  var root = null;
  var booted = false;

  function resolveRoot() {
    return document.getElementById('sml-upload-studio-app');
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[character];
    });
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'stockmarketloop-video';
  }

  function tokenList(value, keepHashes) {
    return String(value || '')
      .split(/[,\n\r\t ]+/)
      .map(function (item) { return item.trim(); })
      .filter(Boolean)
      .map(function (item) {
        if (keepHashes) {
          return item.charAt(0) === '#' ? item : ('#' + item.replace(/^#+/, ''));
        }
        return item.replace(/^#+/, '');
      });
  }

  function cashtag(value) {
    var cleaned = String(value || '').trim().replace(/^\$/, '').toUpperCase();
    return cleaned ? ('$' + cleaned) : '';
  }

  function stateKey() {
    return 'smlUploadStudioDraftV1';
  }

  function nextSchedule() {
    var now = new Date(Date.now() + 60 * 60 * 1000);
    now.setMinutes(0, 0, 0);
    return {
      date: now.toISOString().slice(0, 10),
      time: String(now.getHours()).padStart(2, '0') + ':00'
    };
  }

  function defaultDraft() {
    var schedule = nextSchedule();
    return {
      step: 0,
      title: '',
      description: '',
      ticker: '',
      category: 'Stock Market News',
      tags: '',
      hashtags: '#StockMarketLoop',
      audience: 'Not made for kids',
      visibility: 'public',
      short: false,
      embeddingAllowed: true,
      commentsAllowed: true,
      publishDate: schedule.date,
      publishTime: schedule.time,
      seoTitle: '',
      canonicalUrl: '',
      watchUrlPreview: '',
      file: null,
      filePreviewName: '',
      filePreviewSize: '',
      thumbFile: null,
      thumbUrl: cfg.defaultThumbnail || '',
      upload: null,
      publishedWatchUrl: ''
    };
  }

  function safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  var draft = safeParse(localStorage.getItem(stateKey())) || defaultDraft();
  if (draft && typeof draft === 'object') {
    if (typeof Blob === 'undefined' || !(draft.file instanceof Blob)) {
      draft.file = null;
    }
    if (typeof Blob === 'undefined' || !(draft.thumbFile instanceof Blob)) {
      draft.thumbFile = null;
    }
  }
  var publishing = false;

  function normalizeDraft() {
    if (!draft || typeof draft !== 'object') {
      draft = defaultDraft();
    }
    if (!draft.visibility) {
      draft.visibility = 'public';
    }
    if (!draft.category) {
      draft.category = 'Stock Market News';
    }
    if (!draft.audience) {
      draft.audience = 'Not made for kids';
    }
    if (typeof draft.embeddingAllowed !== 'boolean') {
      draft.embeddingAllowed = true;
    }
    if (typeof draft.commentsAllowed !== 'boolean') {
      draft.commentsAllowed = true;
    }
    if (!draft.thumbUrl && cfg.defaultThumbnail) {
      draft.thumbUrl = cfg.defaultThumbnail;
    }
    if (!draft.publishDate || !draft.publishTime) {
      var schedule = nextSchedule();
      draft.publishDate = draft.publishDate || schedule.date;
      draft.publishTime = draft.publishTime || schedule.time;
    }
  }

  function saveDraft() {
    normalizeDraft();
    var copy = {};
    for (var key in draft) {
      if (Object.prototype.hasOwnProperty.call(draft, key) && key !== 'file' && key !== 'thumbFile') {
        copy[key] = draft[key];
      }
    }
    try {
      localStorage.setItem(stateKey(), JSON.stringify(copy));
    } catch (error) {
      /* storage unavailable - the draft still works in memory */
    }
  }

  function watchPreviewUrl() {
    if (draft.publishedWatchUrl) {
      return draft.publishedWatchUrl;
    }
    if (draft.watchUrlPreview) {
      return draft.watchUrlPreview;
    }
    var titleSlug = slugify(draft.title || draft.filePreviewName || draft.ticker || 'stockmarketloop-video');
    return String(cfg.watchBaseUrl || '/watch/') + titleSlug + '/';
  }

  function metadataOutputs() {
    var title = String(draft.title || '').trim() || 'StockMarketLoop video';
    var tickerTag = cashtag(draft.ticker);
    var watchUrl = watchPreviewUrl();
    var seoTitle = String(draft.seoTitle || '').trim() || (tickerTag ? (tickerTag + ' ' + title) : title);
    var thumb = draft.thumbUrl || cfg.defaultThumbnail || '';
    var description = String(draft.description || '').trim();
    var metaDescription = description.slice(0, 180);
    var hashtags = tokenList(draft.hashtags, true).slice(0, 5);
    var tags = tokenList(draft.tags, false).slice(0, 12);
    var searchPreview = seoTitle + '\n' + watchUrl + '\n' + metaDescription;
    var jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: seoTitle,
      description: metaDescription || 'Uploaded video on StockMarketLoop.',
      thumbnailUrl: thumb ? [thumb] : [],
      uploadDate: new Date().toISOString(),
      embedUrl: watchUrl + '?embed=1',
      contentUrl: watchUrl,
      genre: draft.category || 'Stock Market News',
      keywords: tags.concat(hashtags).join(', ')
    };
    return {
      title: title,
      seoTitle: seoTitle,
      tickerTag: tickerTag,
      watchUrl: watchUrl,
      hashtags: hashtags,
      tags: tags,
      metaDescription: metaDescription,
      searchPreview: searchPreview,
      videoJsonLd: JSON.stringify(jsonLd, null, 2),
      sitemapLine: '<loc>' + watchUrl + '</loc>',
      embedCode: '<iframe src="' + watchUrl + '?embed=1" width="960" height="540" allowfullscreen></iframe>'
    };
  }

  function errors() {
    var out = [];
    if (!draft.filePreviewName && !draft.upload) {
      out.push('Choose a video file first.');
    }
    if (!String(draft.title || '').trim()) {
      out.push('Add a title before publishing.');
    }
    if (String(draft.title || '').length > 100) {
      out.push('Titles must stay under 100 characters.');
    }
    if (!String(draft.description || '').trim()) {
      out.push('Add a description so the watch page and search previews are not empty.');
    }
    if (String(draft.description || '').length > 5000) {
      out.push('Descriptions must stay under 5,000 characters.');
    }
    if (!cashtag(draft.ticker)) {
      out.push('Add a primary ticker so recommendations and internal linking can classify the video.');
    }
    if (tokenList(draft.hashtags, true).length > 5) {
      out.push('Use five hashtags or fewer.');
    }
    if (draft.visibility === 'scheduled' && (!draft.publishDate || !draft.publishTime)) {
      out.push('Scheduled videos need a publish date and time.');
    }
    return out;
  }

  function statusMarkup(tone, text) {
    return '<div class="sml-upload-status" data-tone="' + esc(tone || '') + '">' + esc(text || '') + '</div>';
  }

  function fileSummaryMarkup() {
    if (!draft.filePreviewName && !draft.upload) {
      return '';
    }

    var mime = (draft.upload && draft.upload.mime) || '';
    var label = mime && mime.indexOf('video/') === 0 ? 'Video' : 'Upload';
    return ''
      + '<div class="sml-upload-file-summary">'
      + '  <div class="sml-upload-file-icon">' + esc(label) + '</div>'
      + '  <div>'
      + '    <strong>' + esc(draft.filePreviewName || (draft.upload && draft.upload.name) || 'Selected video') + '</strong>'
      + '    <span>' + esc(draft.filePreviewSize || 'Ready to upload') + '</span>'
      + '    <small>The publish step will create the Chart post, watch page, and recommendation-ready video record.</small>'
      + '  </div>'
      + '</div>';
  }

  function thumbPreviewMarkup() {
    var src = draft.thumbUrl || cfg.defaultThumbnail || '';
    return ''
      + '<div class="sml-upload-thumb-preview">'
      + (src ? '<img src="' + esc(src) + '" alt="Thumbnail preview">' : '<div class="sml-upload-empty">Upload a 16:9 image</div>')
      + '</div>';
  }

  function stepMarkup() {
    var data = metadataOutputs();
    switch (draft.step) {
      case 0:
        return ''
          + '<div class="sml-upload-grid">'
          + '  <section class="sml-upload-drop">'
          + '    <strong>Choose the video file first</strong>'
          + '    <p>This uploader keeps the flow similar to a creator platform: file first, then title, ticker, thumbnail, search metadata, visibility, and publish.</p>'
          + '    <button type="button" data-upload-pick>Choose video</button>'
          + '    <input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-m4v" data-upload-file>'
          + fileSummaryMarkup()
          + '  </section>'
          + '</div>';
      case 1:
        return ''
          + '<div class="sml-upload-grid">'
          + '  <div class="sml-upload-grid-2">'
          + '    <div class="sml-upload-field"><label>Title</label><input type="text" maxlength="100" data-field="title" value="' + esc(draft.title) + '"><small>Keep it sharp and market-specific.</small></div>'
          + '    <div class="sml-upload-field"><label>Ticker focus</label><input type="text" data-field="ticker" value="' + esc(draft.ticker) + '" placeholder="NVDA"><small>This becomes a cashtag on the watch page and helps recommendations.</small></div>'
          + '  </div>'
          + '  <div class="sml-upload-field"><label>Description</label><textarea data-field="description" maxlength="5000" placeholder="Explain the setup, catalyst, targets, risks, or market context.">' + esc(draft.description) + '</textarea><small>The first two lines do most of the work for SEO, previews, and recommendations.</small></div>'
          + '  <div class="sml-upload-grid-2">'
          + '    <div class="sml-upload-field"><label>Category</label><select data-field="category"><option' + (draft.category === 'Stock Market News' ? ' selected' : '') + '>Stock Market News</option><option' + (draft.category === 'Live Trading' ? ' selected' : '') + '>Live Trading</option><option' + (draft.category === 'Education' ? ' selected' : '') + '>Education</option><option' + (draft.category === 'Options' ? ' selected' : '') + '>Options</option><option' + (draft.category === 'Crypto' ? ' selected' : '') + '>Crypto</option><option' + (draft.category === 'AI Stocks' ? ' selected' : '') + '>AI Stocks</option></select></div>'
          + '    <div class="sml-upload-field"><label>Audience</label><select data-field="audience"><option' + (draft.audience === 'Not made for kids' ? ' selected' : '') + '>Not made for kids</option><option' + (draft.audience === 'Made for kids' ? ' selected' : '') + '>Made for kids</option></select></div>'
          + '  </div>'
          + '  <div class="sml-upload-thumb-row">'
          + thumbPreviewMarkup()
          + '    <div class="sml-upload-grid">'
          + '      <div class="sml-upload-field"><label>Thumbnail</label><button type="button" class="sml-upload-thumb-button" data-thumb-pick>Upload thumbnail</button><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-thumb-file hidden><small>Use a 16:9 image so the watch page, search cards, and shares stay clean.</small></div>'
          + '      <div class="sml-upload-field"><label>Tags</label><input type="text" data-field="tags" value="' + esc(draft.tags) + '" placeholder="nvidia stock, earnings, ai chip stocks"><small>Tags help with aliases, misspellings, and topic clustering.</small></div>'
          + '      <div class="sml-upload-field"><label>Hashtags</label><input type="text" data-field="hashtags" value="' + esc(draft.hashtags) + '" placeholder="#NVDA #StockMarketLoop"><small>Use 2 to 4 focused hashtags.</small></div>'
          + '    </div>'
          + '  </div>'
          + '</div>';
      case 2:
        return ''
          + '<div class="sml-upload-grid">'
          + '  <div class="sml-upload-field"><label>SEO title</label><input type="text" maxlength="110" data-field="seoTitle" value="' + esc(draft.seoTitle) + '" placeholder="' + esc(data.seoTitle) + '"><small>Leave blank to auto-generate from the title and ticker.</small></div>'
          + '  <div class="sml-upload-field"><label>Canonical URL</label><input type="text" data-field="canonicalUrl" value="' + esc(draft.canonicalUrl) + '" placeholder="' + esc(data.watchUrl) + '"><small>The final watch page URL is set on publish. This preview helps you shape the share copy now.</small></div>'
          + '  <div class="sml-upload-card">'
          + '    <div class="sml-upload-code-head"><strong>Search preview</strong></div>'
          + '    <div class="sml-upload-body"><div class="sml-upload-preview-snippet">' + esc(data.searchPreview) + '</div></div>'
          + '  </div>'
          + codeBlock('VideoObject JSON-LD', data.videoJsonLd)
          + codeBlock('Sitemap line', data.sitemapLine)
          + codeBlock('Embed code', data.embedCode)
          + '</div>';
      case 3:
      default:
        return ''
          + '<div class="sml-upload-grid">'
          + '  <div class="sml-upload-grid-2">'
          + '    <div class="sml-upload-field"><label>Visibility</label><select data-field="visibility"><option value="public"' + (draft.visibility === 'public' ? ' selected' : '') + '>Public</option><option value="unlisted"' + (draft.visibility === 'unlisted' ? ' selected' : '') + '>Unlisted</option><option value="private"' + (draft.visibility === 'private' ? ' selected' : '') + '>Private</option><option value="scheduled"' + (draft.visibility === 'scheduled' ? ' selected' : '') + '>Scheduled</option></select></div>'
          + '    <div class="sml-upload-field"><label>Watch page preview URL</label><input type="text" readonly value="' + esc(data.watchUrl) + '"><small>This becomes the real watch page after publish.</small></div>'
          + '  </div>'
          + (draft.visibility === 'scheduled'
            ? '<div class="sml-upload-grid-2"><div class="sml-upload-field"><label>Publish date</label><input type="date" data-field="publishDate" value="' + esc(draft.publishDate) + '"></div><div class="sml-upload-field"><label>Publish time</label><input type="time" data-field="publishTime" value="' + esc(draft.publishTime) + '"></div></div>'
            : '')
          + '  <div class="sml-upload-toggle-grid">'
          + '    <div class="sml-upload-toggle"><label><input type="checkbox" data-check="embeddingAllowed"' + (draft.embeddingAllowed ? ' checked' : '') + '> Allow embedding</label><p>Helps creators and sites reuse the watch page player cleanly.</p></div>'
          + '    <div class="sml-upload-toggle"><label><input type="checkbox" data-check="commentsAllowed"' + (draft.commentsAllowed ? ' checked' : '') + '> Allow comments</label><p>Comments help engagement and recommendation quality.</p></div>'
          + '    <div class="sml-upload-toggle"><label><input type="checkbox" data-check="short"' + (draft.short ? ' checked' : '') + '> Short video</label><p>Adds this upload to the homepage Shorts &amp; Profile Uploads rail. Best for clips under a minute.</p></div>'
          + '  </div>'
          + '  <button type="button" class="sml-upload-review-publish" data-publish>Publish video</button>'
          + '</div>';
    }
  }

  function codeBlock(title, value) {
    return ''
      + '<div class="sml-upload-code">'
      + '  <div class="sml-upload-code-head"><strong>' + esc(title) + '</strong><button type="button" data-copy="' + esc(value) + '">Copy</button></div>'
      + '  <pre>' + esc(value) + '</pre>'
      + '</div>';
  }

  function previewMarkup() {
    var outputs = metadataOutputs();
    return ''
      + '<article class="sml-upload-preview-card">'
      + '  <div class="sml-upload-preview-media">' + ((draft.thumbUrl || cfg.defaultThumbnail) ? '<img src="' + esc(draft.thumbUrl || cfg.defaultThumbnail) + '" alt="Watch page preview">' : '') + '</div>'
      + '  <div class="sml-upload-preview-body">'
      + '    <strong>' + esc(outputs.seoTitle) + '</strong>'
      + '    <div class="sml-upload-preview-meta">' + esc(outputs.watchUrl) + '</div>'
      + '    <div class="sml-upload-preview-snippet">' + esc(outputs.metaDescription || 'Add a title and description to see how the preview will look.') + '</div>'
      + '    <div class="sml-upload-chip-row">'
      + (outputs.tickerTag ? '<span class="sml-upload-chip">' + esc(outputs.tickerTag) + '</span>' : '')
      + outputs.hashtags.map(function (tag) { return '<span class="sml-upload-chip">' + esc(tag) + '</span>'; }).join('')
      + '    </div>'
      + '  </div>'
      + '</article>';
  }

  function sideMarkup() {
    var outputs = metadataOutputs();
    return ''
      + '<div class="sml-upload-card">'
      + '  <h2>Watch page preview</h2>'
      + '  <p>This is the metadata package your watch page, shares, and recommendation engine will use after publish.</p>'
      + previewMarkup()
      + '</div>'
      + '<div class="sml-upload-card">'
      + '  <h3>Recommendation signals</h3>'
      + '  <p><strong>Ticker:</strong> ' + esc(outputs.tickerTag || 'Missing') + '</p>'
      + '  <p><strong>Category:</strong> ' + esc(draft.category || 'Missing') + '</p>'
      + '  <p><strong>Hashtags:</strong> ' + esc(outputs.hashtags.join(' ') || 'Missing') + '</p>'
      + '  <p><strong>Visibility:</strong> ' + esc((draft.visibility || 'public').replace(/^./, function (letter) { return letter.toUpperCase(); })) + '</p>'
      + '</div>'
      + '<div class="sml-upload-card">'
      + '  <h3>Why this page matters</h3>'
      + '  <p>The old route was dead. This upload studio now gathers the metadata the StockMarketLoop watch pages, search previews, and video recommendation service actually need.</p>'
      + '</div>';
  }

  function loggedOutMarkup() {
    return ''
      + '<div class="sml-upload-card sml-upload-login">'
      + '  <h2>Sign in to upload</h2>'
      + '  <p>Creators need to be signed in before they can upload a video, attach the right title and ticker metadata, and generate a watch page that can actually be crawled.</p>'
      + '  <a class="sml-upload-primary" href="' + esc(cfg.loginUrl || '/sign-up-sign-in/') + '">Sign in</a>'
      + '</div>';
  }

  function renderStatus() {
    if (publishing) {
      return statusMarkup('warn', 'Publishing video, creating the Chart post, and generating the watch page...');
    }
    var issues = errors();
    if (!issues.length) {
      return statusMarkup('good', 'Metadata looks healthy. This upload is ready to publish into the watch-page system.');
    }
    return statusMarkup('warn', issues[0]);
  }

  function render() {
    normalizeDraft();

    if (!cfg.loggedIn) {
      root.innerHTML = loggedOutMarkup();
      return;
    }

    var issues = errors();
    root.innerHTML = ''
      + '<div class="sml-upload-shell">'
      + '  <section class="sml-upload-main">'
      + '    <article class="sml-upload-card">'
      + '      <div class="sml-upload-stepper">'
      + stepButton(0, 'File', 'Choose and stage the video')
      + stepButton(1, 'Details', 'Title, ticker, description, thumbnail')
      + stepButton(2, 'SEO & indexing', 'Search preview, structured data, watch URL')
      + stepButton(3, 'Visibility', 'Public, unlisted, private, scheduled')
      + '      </div>'
      + '      <div class="sml-upload-body">'
      + stepMarkup()
      + (issues.length ? '<div class="sml-upload-errors">' + issues.map(function (issue) { return '<span>' + esc(issue) + '</span>'; }).join('') + '</div>' : '')
      + '      </div>'
      + '      <div class="sml-upload-footer">'
      +            renderStatus()
      + '        <div class="sml-upload-footer-actions">'
      + '          <button type="button" data-quiet="1" data-action="back">Back</button>'
      + '          <button type="button" data-quiet="1" data-action="save">Save draft</button>'
      + '          <button type="button" data-action="next">' + esc(draft.step < 3 ? 'Next' : 'Review') + '</button>'
      + '        </div>'
      + '      </div>'
      + '    </article>'
      + '  </section>'
      + '  <aside class="sml-upload-side">'
      + sideMarkup()
      + '  </aside>'
      + '</div>';
  }

  function stepButton(index, title, text) {
    return ''
      + '<button type="button" class="sml-upload-step" data-step="' + index + '" data-active="' + (draft.step === index ? '1' : '0') + '">'
      + '  <b>' + esc(title) + '</b>'
      + '  <span>' + esc(text) + '</span>'
      + '</button>';
  }

  function humanSize(bytes) {
    var size = Number(bytes || 0);
    if (!size) {
      return '';
    }
    if (size >= 1024 * 1024 * 1024) {
      return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
    if (size >= 1024 * 1024) {
      return (size / (1024 * 1024)).toFixed(1) + ' MB';
    }
    return Math.round(size / 1024) + ' KB';
  }

  function uploadAsset(endpoint, kind, file) {
    var normalizedKind = kind === 'thumbnail' ? 'photo' : kind;
    var form = new FormData();
    form.append('kind', normalizedKind);
	if (kind === 'thumbnail') form.append('purpose', 'thumbnail');
    form.append('media', file, file.name);
    function send(url) {
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
          'X-WP-Nonce': cfg.nonce || ''
        },
        body: form
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (!response.ok) {
            var error = new Error(payload.message || 'Upload failed.');
            error.code = payload.code || '';
            error.status = response.status;
            throw error;
          }
          return payload;
        });
      });
    }
    var primary = cfg.pluginUploadEndpoint || endpoint;
    var backup = primary === endpoint ? '' : endpoint;
    return send(primary).catch(function (error) {
      if (backup) {
        return send(backup);
      }
      throw error;
    });
  }

  function publishViaPlugin(uploaded) {
    var outputs = metadataOutputs();
    return fetch(cfg.pluginPublishEndpoint, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-WP-Nonce': cfg.nonce || ''
      },
      body: JSON.stringify({
        title: draft.title || uploaded.videoUpload.title || draft.filePreviewName || 'StockMarketLoop video',
        seo_title: outputs.seoTitle || draft.title || '',
        description: draft.description || '',
        ticker: String(draft.ticker || '').replace(/^\$/, ''),
        visibility: draft.visibility || 'public',
        short: !!draft.short,
        video_url: uploaded.videoUpload.url,
        video_name: uploaded.videoUpload.name || draft.filePreviewName || '',
        video_mime: uploaded.videoUpload.mime || '',
        thumbnail_url: (uploaded.thumbUpload && uploaded.thumbUpload.url) || draft.thumbUrl || '',
        tags: outputs.tags || [],
        hashtags: outputs.hashtags || []
      })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          throw new Error(payload.message || 'Publish failed.');
        }
        return payload;
      });
    });
  }

  function publishPayload(videoUpload, thumbUpload) {
    var outputs = metadataOutputs();
    var tickerTag = outputs.tickerTag;
    var textParts = [];
    if (draft.title) {
      textParts.push(draft.title);
    }
    if (draft.description) {
      textParts.push(draft.description);
    }
    if (tickerTag) {
      textParts.push(tickerTag);
    }
    if (outputs.hashtags.length) {
      textParts.push(outputs.hashtags.join(' '));
    }

    var media = {
      url: videoUpload.url,
      type: 'video',
      name: draft.title || videoUpload.title || draft.filePreviewName,
      mime: videoUpload.mime,
      title: draft.title || videoUpload.title || draft.filePreviewName,
      description: draft.description || '',
      visibility: draft.visibility === 'scheduled' ? 'public' : draft.visibility,
      thumbnail_url: (thumbUpload && thumbUpload.url) || draft.thumbUrl || '',
      watch_url: draft.publishedWatchUrl || '',
      uploadWizardComplete: true
    };

    return {
      user_id: cfg.userId,
      text: textParts.filter(Boolean).join('\n\n'),
      media: media
    };
  }

  function publishVideo() {
    if (publishing) {
      return;
    }

    var issues = errors();
    var hasUsableFile = (typeof Blob !== 'undefined') && (draft.file instanceof Blob);
    if (!hasUsableFile) {
      issues.push('Re-select your video file, then press Publish video again. The file is cleared whenever the page reloads.');
    }

    if (issues.length) {
      render();
      window.alert(issues[0]);
      return;
    }

    publishing = true;
    render();

    Promise.resolve()
      .then(function () {
        return uploadAsset(cfg.chartMediaEndpoint, 'video', draft.file);
      })
      .then(function (videoUpload) {
        draft.upload = videoUpload;
        if (draft.thumbFile) {
          return uploadAsset(cfg.chartMediaEndpoint, 'thumbnail', draft.thumbFile).then(function (thumbUpload) {
            return { videoUpload: videoUpload, thumbUpload: thumbUpload };
          });
        }
        return { videoUpload: videoUpload, thumbUpload: null };
      })
      .then(function (uploaded) {
        function publishViaMembers() {
          return fetch(cfg.profileChartEndpoint, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'X-WP-Nonce': cfg.nonce || ''
            },
            body: JSON.stringify(publishPayload(uploaded.videoUpload, uploaded.thumbUpload))
          }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (payload) {
              if (!response.ok) {
                var error = new Error(payload.message || 'Publish failed.');
                error.code = payload.code || '';
                error.status = response.status;
                throw error;
              }
              return payload;
            });
          });
        }

        if (cfg.pluginPublishEndpoint) {
          return publishViaPlugin(uploaded).catch(function (error) {
            if (!cfg.profileChartEndpoint) {
              throw error;
            }
            return publishViaMembers();
          });
        }

        return publishViaMembers();
      })
      .then(function (payload) {
        var watchUrl = (payload && payload.watch_url)
          || (payload && payload.video && payload.video.watch_url)
          || (payload && payload.post && payload.post.media && payload.post.media.watch_url)
          || '';
        draft.publishedWatchUrl = watchUrl || '';
        saveDraft();
        if (watchUrl) {
          window.location.href = watchUrl;
          return;
        }
        publishing = false;
        render();
        window.alert('The video uploaded, but no watch page URL came back. Check Creator Studio for the new video.');
      })
      .catch(function (error) {
        publishing = false;
        window.alert(error && error.message ? error.message : 'The video could not be published.');
        render();
      });
  }

  function bind() {
    root.addEventListener('click', function (event) {
      var step = event.target.closest('[data-step]');
      if (step) {
        draft.step = Number(step.getAttribute('data-step') || 0);
        saveDraft();
        render();
        return;
      }

      var action = event.target.closest('[data-action]');
      if (action) {
        var kind = action.getAttribute('data-action');
        if (kind === 'back') {
          draft.step = Math.max(0, draft.step - 1);
        } else if (kind === 'next') {
          draft.step = Math.min(3, draft.step + 1);
        } else if (kind === 'save') {
          saveDraft();
        }
        saveDraft();
        render();
        return;
      }

      if (event.target.closest('[data-upload-pick]')) {
        var fileInput = root.querySelector('[data-upload-file]');
        if (fileInput) {
          fileInput.click();
        }
        return;
      }

      if (event.target.closest('[data-thumb-pick]')) {
        var thumbInput = root.querySelector('[data-thumb-file]');
        if (thumbInput) {
          thumbInput.click();
        }
        return;
      }

      var publish = event.target.closest('[data-publish]');
      if (publish) {
        publishVideo();
        return;
      }

      var copy = event.target.closest('[data-copy]');
      if (copy && navigator.clipboard) {
        navigator.clipboard.writeText(copy.getAttribute('data-copy') || '');
        copy.textContent = 'Copied';
        window.setTimeout(function () {
          copy.textContent = 'Copy';
        }, 1200);
      }
    });

    root.addEventListener('input', function (event) {
      var field = event.target.closest('[data-field]');
      if (field) {
        draft[field.getAttribute('data-field')] = field.value;
        saveDraft();
        return;
      }

      var check = event.target.closest('[data-check]');
      if (check) {
        draft[check.getAttribute('data-check')] = !!check.checked;
        saveDraft();
        return;
      }
    });

    root.addEventListener('change', function (event) {
      var fileInput = event.target.closest('[data-upload-file]');
      if (fileInput && fileInput.files && fileInput.files[0]) {
        var file = fileInput.files[0];
        draft.file = file;
        draft.filePreviewName = file.name;
        draft.filePreviewSize = humanSize(file.size);
        if (!draft.title) {
          draft.title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
        }
        saveDraft();
        render();
        return;
      }

      var thumbInput = event.target.closest('[data-thumb-file]');
      if (thumbInput && thumbInput.files && thumbInput.files[0]) {
		if (!/^image\/(jpeg|png|webp|gif)$/i.test(thumbInput.files[0].type || '') || thumbInput.files[0].size > 50 * 1024 * 1024) {
		  window.alert('Thumbnails must be a JPEG, PNG, WebP, or GIF file no larger than 50 MB.');
		  thumbInput.value = '';
		  return;
		}
        draft.thumbFile = thumbInput.files[0];
        var reader = new FileReader();
        reader.onload = function () {
          draft.thumbUrl = String(reader.result || '');
          saveDraft();
          render();
        };
        reader.readAsDataURL(draft.thumbFile);
        return;
      }

      var field = event.target.closest('[data-field]');
      if (field) {
        draft[field.getAttribute('data-field')] = field.value;
        saveDraft();
        render();
      }
    });
  }

  function boot() {
    if (booted) {
      return true;
    }
    root = resolveRoot();
    if (!root) {
      return false;
    }
    cfg = window.smlVideoUploadStudioConfig || readConfigFromScripts() || cfg || {};
    normalizeDraft();
    bind();
    render();
    booted = true;
    return true;
  }

  if (!boot()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    }
    var bootAttempts = 0;
    var bootTimer = window.setInterval(function () {
      bootAttempts += 1;
      if (boot() || bootAttempts > 20) {
        window.clearInterval(bootTimer);
      }
    }, 250);
  }
})();
SMLVIDEOJS;
        ?>
        <script>
            window.smlVideoUploadStudioConfig = <?php echo $config ? $config : '{}'; ?>;
        </script>
        <?php if ($script_body) : ?>
            <script>
<?php echo $script_body; ?>
            </script>
        <?php endif; ?>
        <?php
    }
}
add_action('wp_footer', 'sml_video_upload_studio_footer_boot', 120);

if (!function_exists('sml_video_upload_studio_shortcode')) {
    function sml_video_upload_studio_shortcode() {
        sml_video_upload_studio_enqueue();
        ob_start();
        ?>
        <section class="sml-upload-studio-page" data-sml-upload-studio>
            <header class="sml-upload-studio-hero">
                <div>
                    <p class="sml-upload-kicker">Creator Studio</p>
                    <h1>Upload a video like a real creator platform</h1>
                    <p class="sml-upload-copy">Build the title, description, ticker focus, thumbnail, visibility, and SEO signals before you publish. When you hit publish, StockMarketLoop creates the watch page and recommendation-ready video record automatically.</p>
                </div>
                <div class="sml-upload-hero-actions">
                    <a class="sml-upload-secondary" href="<?php echo esc_url(home_url('/creator-studio/')); ?>">Back to Creator Studio</a>
                    <a class="sml-upload-primary" href="<?php echo esc_url(home_url('/go-live/')); ?>">Go live instead</a>
                </div>
            </header>
            <div id="sml-upload-studio-app" class="sml-upload-studio-app" aria-live="polite"></div>
        </section>
        <?php
        return (string) ob_get_clean();
    }
}
add_shortcode('sml_video_upload_studio', 'sml_video_upload_studio_shortcode');

if (!function_exists('sml_vus_can_create')) {
    /**
     * Publishing endpoints sit behind the same gate as the studio page.
     * Locking only the page would be theatre -- the REST routes are the
     * thing that actually creates content.
     */
    function sml_vus_can_create() {
        if (!is_user_logged_in()) {
            return false;
        }
        if (!function_exists('sml_lb_can')) {
            return true;
        }
        return sml_lb_can('creator');
    }
}


/* SML chat overlay compatibility for the active 3.8.1 plugin. */
/**
 * Creator-configurable live chat overlay and signed OBS browser source.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_chat_overlay_fonts')) {
    function sml_chat_overlay_fonts() {
        return array(
            'ABeeZee', 'Abril Fatface', 'Acme', 'Alegreya', 'Alegreya Sans',
            'Alfa Slab One', 'Amatic SC', 'Anton', 'Archivo', 'Archivo Black',
            'Archivo Narrow', 'Arimo', 'Arvo', 'Assistant', 'Audiowide', 'Bangers',
            'Barlow', 'Bebas Neue', 'Bitter', 'Black Ops One', 'Bree Serif',
            'Cabin', 'Cabin Condensed', 'Candal', 'Cardo', 'Carter One', 'Catamaran',
            'Chakra Petch', 'Changa', 'Chivo', 'Cinzel', 'Comfortaa', 'Comic Neue',
            'Cormorant Garamond', 'Crimson Pro', 'DM Sans', 'Dancing Script',
            'Domine', 'Dosis', 'EB Garamond', 'Encode Sans', 'Exo 2', 'Figtree',
            'Fira Sans', 'Fjalla One', 'Francois One', 'Fredoka', 'Geist',
            'Geist Mono', 'Gloria Hallelujah', 'Graduate', 'Great Vibes', 'Hind',
            'IBM Plex Mono', 'IBM Plex Sans', 'IBM Plex Serif', 'Inconsolata',
            'Indie Flower', 'Instrument Sans', 'Inter', 'Josefin Sans',
            'Josefin Slab', 'Kanit', 'Karla', 'Kaushan Script', 'Lato',
            'League Gothic', 'League Spartan', 'Lexend', 'Libre Baskerville',
            'Libre Franklin', 'Lilita One', 'Literata', 'Lobster', 'Lora',
            'Luckiest Guy', 'Manrope', 'Maven Pro', 'Merriweather',
            'Merriweather Sans', 'Michroma', 'Monda', 'Montserrat', 'Mulish',
            'Nanum Gothic', 'Newsreader', 'Noto Sans', 'Noto Sans Display',
            'Noto Sans Mono', 'Noto Serif', 'Noto Serif Display', 'Nova Square',
            'Nunito Sans', 'Old Standard TT', 'Open Sans', 'Orbitron', 'Oswald',
            'Oxygen', 'PT Mono', 'PT Sans', 'PT Serif', 'Pacifico', 'Patrick Hand',
            'Permanent Marker', 'Philosopher', 'Play', 'Playfair Display',
            'Plus Jakarta Sans', 'Poiret One', 'Poppins', 'Prata', 'Prompt',
            'Quicksand', 'Rajdhani', 'Raleway', 'Righteous', 'Roboto',
            'Roboto Condensed', 'Roboto Mono', 'Roboto Serif', 'Rock Salt',
            'Rokkitt', 'Rubik', 'Russo One', 'Sacramento', 'Satisfy',
            'Shadows Into Light', 'Signika', 'Slabo 27px', 'Sora',
            'Source Sans 3', 'Source Serif 4', 'Space Grotesk', 'Special Elite',
            'Spectral', 'Staatliches', 'Syncopate', 'Teko', 'Titillium Web',
            'Ubuntu', 'Ubuntu Condensed', 'Unbounded', 'Urbanist', 'Vollkorn',
            'Work Sans', 'Yanone Kaffeesatz', 'Zilla Slab',
        );
    }
}

if (!function_exists('sml_chat_overlay_defaults')) {
    function sml_chat_overlay_defaults() {
        return array(
            'enabled' => false,
            'position' => 'bottom_left',
            'x' => 4,
            'y' => 64,
            'width' => 430,
            'max_messages' => 5,
            'font_family' => 'Inter',
            'font_size' => 18,
            'font_weight' => 600,
            'text_color' => '#f4f7fb',
            'name_color' => '#5eead4',
            'accent_color' => '#22d97a',
            'background_color' => '#07111c',
            'background_opacity' => 82,
            'corner_radius' => 16,
            'padding' => 14,
            'message_gap' => 8,
            'animation' => 'slide',
            'display_seconds' => 14,
            'show_avatars' => true,
            'show_timestamps' => false,
            'show_badges' => true,
            'show_superchats' => true,
            'show_subscriber_count' => false,
            'auto_contrast' => true,
            'compact_mode' => false,
            'hide_links' => false,
        );
    }
}

if (!function_exists('sml_chat_overlay_color')) {
    function sml_chat_overlay_color($value, $fallback) {
        $value = sanitize_hex_color((string) $value);
        return $value ?: $fallback;
    }
}

if (!function_exists('sml_chat_overlay_normalize')) {
    function sml_chat_overlay_normalize($raw) {
        $defaults = sml_chat_overlay_defaults();
        $raw = is_array($raw) ? $raw : array();
        $settings = array_merge($defaults, $raw);
        $positions = array('top_left', 'top_center', 'top_right', 'middle_left', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right', 'custom');
        $animations = array('slide', 'fade', 'pop', 'none');
        $fonts = sml_chat_overlay_fonts();

        $settings['enabled'] = !empty($settings['enabled']);
        $settings['position'] = in_array($settings['position'], $positions, true) ? $settings['position'] : $defaults['position'];
        $settings['x'] = max(0, min(100, (float) $settings['x']));
        $settings['y'] = max(0, min(100, (float) $settings['y']));
        $settings['width'] = max(280, min(760, (int) $settings['width']));
        $settings['max_messages'] = max(1, min(12, (int) $settings['max_messages']));
        $settings['font_family'] = in_array($settings['font_family'], $fonts, true) ? $settings['font_family'] : $defaults['font_family'];
        $settings['font_size'] = max(2, min(72, (int) $settings['font_size']));
        $settings['font_weight'] = in_array((int) $settings['font_weight'], array(400, 500, 600, 700, 800), true)
            ? (int) $settings['font_weight']
            : $defaults['font_weight'];
        $settings['text_color'] = sml_chat_overlay_color($settings['text_color'], $defaults['text_color']);
        $settings['name_color'] = sml_chat_overlay_color($settings['name_color'], $defaults['name_color']);
        $settings['accent_color'] = sml_chat_overlay_color($settings['accent_color'], $defaults['accent_color']);
        $settings['background_color'] = sml_chat_overlay_color($settings['background_color'], $defaults['background_color']);
        $settings['background_opacity'] = max(0, min(100, (int) $settings['background_opacity']));
        $settings['corner_radius'] = max(0, min(40, (int) $settings['corner_radius']));
        $settings['padding'] = max(6, min(32, (int) $settings['padding']));
        $settings['message_gap'] = max(0, min(24, (int) $settings['message_gap']));
        $settings['animation'] = in_array($settings['animation'], $animations, true) ? $settings['animation'] : $defaults['animation'];
        $settings['display_seconds'] = max(3, min(120, (int) $settings['display_seconds']));
        foreach (array('show_avatars', 'show_timestamps', 'show_badges', 'show_superchats', 'show_subscriber_count', 'auto_contrast', 'compact_mode', 'hide_links') as $flag) {
            $settings[$flag] = !empty($settings[$flag]);
        }
        return $settings;
    }
}

if (!function_exists('sml_chat_overlay_get')) {
    function sml_chat_overlay_get($creator_id) {
        return sml_chat_overlay_normalize(get_user_meta((int) $creator_id, '_sml_chat_overlay', true));
    }
}

if (!function_exists('sml_chat_overlay_token')) {
    function sml_chat_overlay_token($creator_id) {
        return hash_hmac('sha256', 'sml-chat-overlay|' . (int) $creator_id, wp_salt('auth'));
    }
}

if (!function_exists('sml_chat_overlay_url')) {
    function sml_chat_overlay_url($creator_id, $room_id = 'ROOM_ID') {
        return add_query_arg(array(
            'creator' => (int) $creator_id,
            'room' => (string) $room_id,
            'token' => sml_chat_overlay_token($creator_id),
        ), home_url('/live-chat-overlay/'));
    }
}

if (!function_exists('sml_chat_overlay_payload')) {
    function sml_chat_overlay_payload($creator_id) {
        return array(
            'ok' => true,
            'settings' => sml_chat_overlay_get($creator_id),
            'fonts' => sml_chat_overlay_fonts(),
            'overlay_url' => sml_chat_overlay_url($creator_id),
            'rules' => array(
                'moderated_messages_only' => true,
                'signed_browser_source' => true,
                'responsive_safe_area' => true,
            ),
        );
    }
}

if (!function_exists('sml_chat_overlay_rest_settings')) {
    function sml_chat_overlay_rest_settings(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        if (!$user_id) {
            return new WP_Error('sml_overlay_login', 'Sign in to manage live chat overlays.', array('status' => 401));
        }
        if ($request->get_method() === 'GET') {
            return sml_chat_overlay_payload($user_id);
        }
        $settings = sml_chat_overlay_normalize($request->get_json_params());
        update_user_meta($user_id, '_sml_chat_overlay', $settings);
        do_action('sml_chat_overlay_updated', $user_id, $settings);
        return sml_chat_overlay_payload($user_id);
    }
}

if (!function_exists('sml_chat_overlay_valid_request')) {
    function sml_chat_overlay_valid_request($creator_id, $room_id, $token) {
        if (!$creator_id || !$room_id || !$token) {
            return false;
        }
        if (!hash_equals(sml_chat_overlay_token($creator_id), (string) $token)) {
            return false;
        }
        return function_exists('sml_voice_room_host')
            && (int) sml_voice_room_host($room_id) === (int) $creator_id;
    }
}

/*
 * The Watch Page composer is the canonical viewer-chat surface.  Its message
 * store is keyed by the creator's public profile handle, while a Go Live room
 * has a separate numeric room ID.  Resolve the former from the signed overlay
 * creator instead of trying to derive it from the room ID, so the overlay can
 * display the exact same viewer messages without copying them into another
 * table.
 */
if (!function_exists('sml_chat_overlay_watch_room_key')) {
    function sml_chat_overlay_watch_room_key($creator_id) {
        $creator_id = absint($creator_id);
        if (!$creator_id) {
            return '';
        }

        $handle = sanitize_key((string) get_user_meta($creator_id, 'sml_public_handle', true));
        if ('' === $handle) {
            $user = get_userdata($creator_id);
            if ($user) {
                $handle = sanitize_key((string) ($user->user_nicename ?: $user->user_login));
            }
        }

        return '' === $handle ? '' : substr('room-' . $handle, 0, 190);
    }
}

if (!function_exists('sml_chat_overlay_watch_message_payload')) {
    function sml_chat_overlay_watch_message_payload($row) {
        $user_id = absint($row['user_id'] ?? 0);
        return array(
            'id' => absint($row['id'] ?? 0),
            'user_id' => $user_id,
            'display_name' => sanitize_text_field((string) ($row['display_name'] ?? 'Member')),
            'message' => wp_strip_all_tags((string) ($row['body'] ?? '')),
            'kind' => sanitize_key((string) ($row['message_type'] ?? 'chat')),
            'created_at' => (string) ($row['created_at'] ?? ''),
            'avatar_url' => $user_id ? get_avatar_url($user_id, array('size' => 96)) : '',
        );
    }
}

if (!function_exists('sml_chat_overlay_rest_feed')) {
    function sml_chat_overlay_rest_feed(WP_REST_Request $request) {
        global $wpdb;
        $creator_id = absint($request->get_param('creator_id'));
        $room_id = sanitize_text_field((string) $request->get_param('room_id'));
        $token = sanitize_text_field((string) $request->get_param('token'));
        if (!sml_chat_overlay_valid_request($creator_id, $room_id, $token)) {
            return new WP_Error('sml_overlay_forbidden', 'This overlay source is not authorized for that room.', array('status' => 403));
        }
        $settings = sml_chat_overlay_get($creator_id);
        $after = max(0, (int) $request->get_param('after_id'));
        $limit = max(5, min(30, (int) ($request->get_param('limit') ?: $settings['max_messages'])));
        $room_key = sml_chat_overlay_watch_room_key($creator_id);
        if ('' === $room_key) {
            return new WP_Error('sml_overlay_watch_room_missing', 'This creator does not have a Watch Page chat room.', array('status' => 404));
        }
        $table = $wpdb->prefix . 'sml_live_chat_messages';
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, user_id, display_name, body, message_type, created_at FROM $table WHERE room_key = %s AND id > %d ORDER BY id ASC LIMIT %d",
            $room_key,
            $after,
            $limit
        ), ARRAY_A);
        $messages = array();
        foreach ($rows ?: array() as $row) {
            if (($row['message_type'] ?? 'chat') === 'superchat' && empty($settings['show_superchats'])) {
                continue;
            }
            $message = sml_chat_overlay_watch_message_payload($row);
            if (!empty($settings['hide_links'])) {
                $message['message'] = preg_replace('~https?://\S+~i', '[link hidden]', (string) $message['message']);
            }
            $messages[] = $message;
        }
        $cursor = $after;
        foreach ($messages as $message) {
            $cursor = max($cursor, (int) $message['id']);
        }
        return array(
            'ok' => true,
            'settings' => $settings,
            'subscriber_count' => function_exists('sml_creator_subscription_count') ? sml_creator_subscription_count($creator_id) : 0,
            'messages' => $messages,
            'cursor' => $cursor,
            'server_time' => time(),
        );
    }
}

if (!function_exists('sml_chat_overlay_register_routes')) {
    function sml_chat_overlay_register_routes() {
        register_rest_route('sml-video-upload-studio/v1', '/chat-overlay-settings', array(
            array(
                'methods' => WP_REST_Server::READABLE,
                'callback' => 'sml_chat_overlay_rest_settings',
                'permission_callback' => 'is_user_logged_in',
            ),
            array(
                'methods' => WP_REST_Server::EDITABLE,
                'callback' => 'sml_chat_overlay_rest_settings',
                'permission_callback' => 'is_user_logged_in',
            ),
        ));
        register_rest_route('sml-video-upload-studio/v1', '/chat-overlay-feed', array(
            'methods' => WP_REST_Server::READABLE,
            'callback' => 'sml_chat_overlay_rest_feed',
            'permission_callback' => '__return_true',
        ));
    }
}
add_action('rest_api_init', 'sml_chat_overlay_register_routes');

if (!function_exists('sml_chat_overlay_render_page')) {
    function sml_chat_overlay_render_page() {
        $creator_id = absint($_GET['creator'] ?? 0);
        $room_id = sanitize_text_field((string) wp_unslash($_GET['room'] ?? ''));
        $token = sanitize_text_field((string) wp_unslash($_GET['token'] ?? ''));
        if (!sml_chat_overlay_valid_request($creator_id, $room_id, $token)) {
            status_header(403);
            nocache_headers();
            echo '<!doctype html><html><body style="margin:0;background:transparent;color:#fff;font:16px sans-serif">Invalid overlay source.</body></html>';
            exit;
        }
        $settings = sml_chat_overlay_get($creator_id);
        $font = str_replace('%20', '+', rawurlencode($settings['font_family']));
        $config = array(
            'endpoint' => esc_url_raw(rest_url('sml-video-upload-studio/v1/chat-overlay-feed')),
            'creatorId' => $creator_id,
            'roomId' => $room_id,
            'token' => $token,
            'settings' => $settings,
        );
        nocache_headers();
        header('Content-Type: text/html; charset=' . get_option('blog_charset'));
        ?><!doctype html>
<html><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=<?php echo esc_attr($font); ?>:wght@400;500;600;700;800&display=swap">
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}
#sml-overlay{position:absolute;display:flex;flex-direction:column;justify-content:flex-end;pointer-events:none}
.subscriber-count{align-self:flex-start;padding:.35em .65em;border-radius:999px;background:rgba(7,17,28,.82);color:var(--text);font-size:.78em;font-weight:800}
.msg{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;animation-duration:.32s;animation-fill-mode:both}
.msg.no-avatar{grid-template-columns:minmax(0,1fr)}.avatar{border-radius:50%;object-fit:cover}.row{display:flex;align-items:center;flex-wrap:wrap}
.name{font-weight:800}.time{opacity:.7}.body{line-height:1.35;overflow-wrap:anywhere}.badge{font-size:.7em;font-weight:800;text-transform:uppercase}
.super{box-shadow:inset 3px 0 0 var(--accent),0 8px 28px rgba(0,0,0,.18)}
@keyframes slide{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}@keyframes pop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
</style></head><body><div id="sml-overlay"></div>
<script>window.SML_CHAT_OVERLAY=<?php echo wp_json_encode($config); ?>;</script>
<script>
(function(){
  var c=window.SML_CHAT_OVERLAY,s=c.settings,root=document.getElementById('sml-overlay'),cursor=0,items=[],subscriberCount=0;
  function hexRgb(hex){var n=parseInt(String(hex).replace('#',''),16);return[(n>>16)&255,(n>>8)&255,n&255]}
  function safeText(){
    if(!s.auto_contrast||Number(s.background_opacity)<45)return s.text_color;
    var rgb=hexRgb(s.background_color),lum=(rgb[0]*299+rgb[1]*587+rgb[2]*114)/255000;
    return lum>.62?'#07111c':'#f7fbff';
  }
  function place(){
    var map={top_left:[4,4],top_center:[50,4],top_right:[96,4],middle_left:[4,42],middle_right:[96,42],bottom_left:[4,64],bottom_center:[50,64],bottom_right:[96,64]};
    var p=s.position==='custom'?[s.x,s.y]:(map[s.position]||map.bottom_left),tx=p[0]===50?'-50%':(p[0]>50?'-100%':'0'),ty=p[1]>50?'-100%':'0';
    root.style.cssText='left:'+p[0]+'%;top:'+p[1]+'%;width:min('+s.width+'px,92vw);transform:translate('+tx+','+ty+');gap:'+s.message_gap+'px;'
      +'font-family:'+JSON.stringify(s.font_family)+',sans-serif;font-size:'+s.font_size+'px;font-weight:'+s.font_weight+';'
      +'--accent:'+s.accent_color+';--text:'+s.text_color+';--name:'+s.name_color+';';
  }
  function esc(v){var d=document.createElement('div');d.textContent=v==null?'':String(v);return d.innerHTML}
  function draw(){
    var rgb=hexRgb(s.background_color),bg='rgba('+rgb.join(',')+','+(s.background_opacity/100)+')';
    var count=s.show_subscriber_count?'<div class="subscriber-count">'+Number(subscriberCount||0).toLocaleString()+' subscribers</div>':'';
    root.innerHTML=count+items.slice(-s.max_messages).map(function(m){
      var superChat=m.kind==='superchat',avatar=s.show_avatars&&m.avatar_url?'<img class="avatar" src="'+esc(m.avatar_url)+'" width="'+(s.compact_mode?30:38)+'" height="'+(s.compact_mode?30:38)+'" alt="">':'';
      var badge=s.show_badges&&superChat?'<span class="badge">Super Chat'+(m.loop_bucks?' - '+m.loop_bucks+' LB':'')+'</span>':'';
      var time=s.show_timestamps?'<time class="time">'+new Date(m.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+'</time>':'';
      return '<article class="msg '+(avatar?'':'no-avatar')+' '+(superChat?'super':'')+'" data-id="'+m.id+'" style="gap:'+(s.compact_mode?7:10)+'px;padding:'+s.padding+'px;border-radius:'+s.corner_radius+'px;background:'+bg+';color:'+safeText()+';animation-name:'+(s.animation==='none'?'none':s.animation)+'">'
        +avatar+'<div><div class="row" style="gap:8px"><b class="name" style="color:'+s.name_color+'">'+esc(m.display_name)+'</b>'+badge+time+'</div><div class="body">'+esc(m.message)+'</div></div></article>';
    }).join('');
  }
  function poll(){
    var u=c.endpoint+'?creator_id='+c.creatorId+'&room_id='+encodeURIComponent(c.roomId)+'&token='+encodeURIComponent(c.token)+'&after_id='+cursor+'&limit='+s.max_messages;
    fetch(u,{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
      subscriberCount=Number(d.subscriber_count||0);
      (d.messages||[]).forEach(function(m){cursor=Math.max(cursor,Number(m.id)||0);items.push(m)});
      var now=Date.now(),ttl=s.display_seconds*1000;items=items.filter(function(m){return now-new Date(m.created_at).getTime()<ttl});
      draw();
    }).catch(function(){}).finally(function(){setTimeout(poll,1600)});
  }
  place();poll();
})();
</script></body></html><?php
        exit;
    }
}

if (!function_exists('sml_chat_overlay_intercept')) {
    function sml_chat_overlay_intercept() {
        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        $path = trim((string) wp_parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
        if ($path === 'live-chat-overlay') {
            sml_chat_overlay_render_page();
        }
    }
}
add_action('template_redirect', 'sml_chat_overlay_intercept', -10);


/* SML Orbit Cards additive backend */
/**
 * Shared creator-controlled three-card orbit configuration.
 * Images use the existing authenticated photo uploader; this file only
 * validates, stores, and exposes the small configuration object.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_vus_orbit_sanitize_items')) {
    function sml_vus_orbit_sanitize_items($items) {
        $clean = array();
        foreach (array_slice((array) $items, 0, 3) as $item) {
            if (!is_array($item)) {
                continue;
            }
            $image = esc_url_raw((string) ($item['url'] ?? ''));
            if (!$image || !preg_match('#^https?://#i', $image)) {
                continue;
            }
            $link = esc_url_raw((string) ($item['link'] ?? ''));
            if ($link && !preg_match('#^https?://#i', $link)) {
                $link = '';
            }
            $clean[] = array(
                'url' => $image,
                'title' => sanitize_text_field(mb_substr((string) ($item['title'] ?? ''), 0, 80)),
                'subtitle' => sanitize_text_field(mb_substr((string) ($item['subtitle'] ?? ''), 0, 120)),
                'link' => $link,
            );
        }
        return $clean;
    }
}

if (!function_exists('sml_vus_orbit_default')) {
    function sml_vus_orbit_default() {
        return array('enabled' => false, 'items' => array());
    }
}

if (!function_exists('sml_vus_orbit_live_get')) {
    function sml_vus_orbit_live_get($user_id) {
        $saved = get_user_meta((int) $user_id, '_sml_vus_live_orbit', true);
        if (!is_array($saved)) {
            return sml_vus_orbit_default();
        }
        return array(
            'enabled' => !empty($saved['enabled']),
            'items' => sml_vus_orbit_sanitize_items($saved['items'] ?? array()),
        );
    }
}

if (!function_exists('sml_vus_orbit_save_live')) {
    function sml_vus_orbit_save_live(WP_REST_Request $request) {
        $user_id = get_current_user_id();
        if (!$user_id) {
            return new WP_Error('sml_login_required', 'Sign in to save orbit cards.', array('status' => 401));
        }
        $items = sml_vus_orbit_sanitize_items($request->get_param('items'));
        $value = array(
            'enabled' => !empty($request->get_param('enabled')) && count($items) > 0,
            'items' => $items,
            'updated_at' => gmdate('c'),
        );
        update_user_meta($user_id, '_sml_vus_live_orbit', $value);
        return array('saved' => true, 'orbit' => array('enabled' => $value['enabled'], 'items' => $items));
    }
}

if (!function_exists('sml_vus_orbit_register_route')) {
    function sml_vus_orbit_register_route() {
        register_rest_route('sml-video-upload-studio/v1', '/orbit-settings', array(
            'methods' => WP_REST_Server::CREATABLE,
            'permission_callback' => 'sml_vus_can_create',
            'callback' => 'sml_vus_orbit_save_live',
        ));
    }
}
add_action('rest_api_init', 'sml_vus_orbit_register_route', 30);

