<?php
/**
 * Plugin Name: StockMarketLoop Live Chat Overlay Fix
 * Description: Restores the Go Live chat overlay with a scoped room API and host controls.
 * Version: 1.0.3
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class SML_Live_Chat_Overlay_Fix {
    const VERSION = '1.0.3';
    const REST_NAMESPACE = 'sml-live-chat/v1';

    public static function boot() {
        add_action( 'rest_api_init', array( __CLASS__, 'register_rest_routes' ) );
        add_action( 'wp_head', array( __CLASS__, 'render_head_assets' ), 9999 );
        add_action( 'wp_footer', array( __CLASS__, 'render_mount' ), 3 );
    }

    public static function activate() {
        global $wpdb;

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $table = $wpdb->prefix . 'sml_live_chat_messages';
        $charset = $wpdb->get_charset_collate();
        $sql = "CREATE TABLE {$table} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            room_key varchar(190) NOT NULL,
            user_id bigint(20) unsigned NOT NULL DEFAULT 0,
            display_name varchar(190) NOT NULL DEFAULT '',
            body text NOT NULL,
            message_type varchar(24) NOT NULL DEFAULT 'chat',
            created_at datetime NOT NULL,
            PRIMARY KEY  (id),
            KEY room_created (room_key, created_at),
            KEY room_id (room_key, id)
        ) {$charset};";
        dbDelta( $sql );
    }

    private static function page_is_live() {
        if ( is_admin() ) {
            return false;
        }

        $path = trim( strtolower( (string) parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ) ), '/' );
        return 'go-live' === $path || 'live' === $path;
    }

    private static function room_key() {
        $requested = isset( $_GET['sml_live_room'] ) ? sanitize_key( wp_unslash( $_GET['sml_live_room'] ) ) : '';
        if ( $requested ) {
            return substr( 'room-' . $requested, 0, 190 );
        }

        $user_id = get_current_user_id();
        return $user_id ? 'creator-' . absint( $user_id ) : 'public-go-live';
    }

    public static function enqueue_assets() {
        if ( ! self::page_is_live() ) {
            return;
        }

        $base = plugin_dir_url( __FILE__ );
        wp_enqueue_style( 'sml-live-chat-overlay-fix', $base . 'assets/live-chat-overlay.css', array(), self::VERSION );
        wp_enqueue_script( 'sml-live-chat-overlay-fix', $base . 'assets/live-chat-overlay.js', array(), self::VERSION, true );
        wp_localize_script(
            'sml-live-chat-overlay-fix',
            'SMLLiveChatOverlay',
            array(
                'restUrl' => esc_url_raw( rest_url( self::REST_NAMESPACE ) ),
                'nonce' => wp_create_nonce( 'wp_rest' ),
                'roomKey' => self::room_key(),
                'loggedIn' => is_user_logged_in(),
                'host' => current_user_can( 'edit_posts' ),
                'name' => is_user_logged_in() ? wp_get_current_user()->display_name : '',
            )
        );
    }

    public static function render_head_assets() {
        $base = plugin_dir_url( __FILE__ );
        $config = array(
            'restUrl' => esc_url_raw( rest_url( self::REST_NAMESPACE ) ),
            'nonce' => wp_create_nonce( 'wp_rest' ),
            'roomKey' => self::room_key(),
            'loggedIn' => is_user_logged_in(),
            'host' => current_user_can( 'edit_posts' ),
            'name' => is_user_logged_in() ? wp_get_current_user()->display_name : '',
        );

        printf(
            '<script id="sml-live-chat-overlay-fix-bootstrap">(function(){var p=String(location.pathname||"").replace(/\\/+$/,"");if(p!=="/go-live"&&p!=="/live"&&p.indexOf("/live/")!==0){return;}window.SMLLiveChatOverlay=%s;var c=document.createElement("link");c.rel="stylesheet";c.href=%s;document.head.appendChild(c);var s=document.createElement("script");s.src=%s;s.defer=true;document.head.appendChild(s);}());</script>',
            wp_json_encode( $config ),
            wp_json_encode( esc_url( $base . 'assets/live-chat-overlay.css?ver=' . self::VERSION ) ),
            wp_json_encode( esc_url( $base . 'assets/live-chat-overlay.js?ver=' . self::VERSION ) )
        );
    }

    public static function render_mount() {
        if ( ! self::page_is_live() ) {
            return;
        }

        printf(
            '<div id="sml-live-chat-overlay-root" data-sml-live-chat-root data-room-key="%s"></div>',
            esc_attr( self::room_key() )
        );
    }

    public static function register_rest_routes() {
        register_rest_route(
            self::REST_NAMESPACE,
            '/room/(?P<room>[a-zA-Z0-9_-]+)/messages',
            array(
                array(
                    'methods' => WP_REST_Server::READABLE,
                    'callback' => array( __CLASS__, 'get_messages' ),
                    'permission_callback' => '__return_true',
                    'args' => array(
                        'after' => array( 'default' => 0, 'sanitize_callback' => 'absint' ),
                        'limit' => array( 'default' => 50, 'sanitize_callback' => 'absint' ),
                    ),
                ),
                array(
                    'methods' => WP_REST_Server::CREATABLE,
                    'callback' => array( __CLASS__, 'create_message' ),
                    'permission_callback' => array( __CLASS__, 'can_write' ),
                ),
            )
        );
    }

    public static function can_write( WP_REST_Request $request ) {
        if ( ! is_user_logged_in() ) {
            return new WP_Error( 'sml_login_required', 'Sign in to join live chat.', array( 'status' => 401 ) );
        }

        $nonce = $request->get_header( 'X-WP-Nonce' );
        if ( ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
            return new WP_Error( 'sml_invalid_nonce', 'This chat session expired. Refresh the page.', array( 'status' => 403 ) );
        }

        return true;
    }

    private static function normalize_room( $room ) {
        return substr( 'room-' . sanitize_key( (string) $room ), 0, 190 );
    }

    public static function get_messages( WP_REST_Request $request ) {
        global $wpdb;

        $room = self::normalize_room( $request['room'] );
        $after = absint( $request->get_param( 'after' ) );
        $limit = min( 100, max( 1, absint( $request->get_param( 'limit' ) ) ) );
        $table = $wpdb->prefix . 'sml_live_chat_messages';

        if ( $after ) {
            $rows = $wpdb->get_results(
                $wpdb->prepare(
                    "SELECT id, user_id, display_name, body, message_type, created_at FROM {$table} WHERE room_key = %s AND id > %d ORDER BY id ASC LIMIT %d",
                    $room,
                    $after,
                    $limit
                ),
                ARRAY_A
            );
        } else {
            $rows = $wpdb->get_results(
                $wpdb->prepare(
                    "SELECT id, user_id, display_name, body, message_type, created_at FROM {$table} WHERE room_key = %s ORDER BY id DESC LIMIT %d",
                    $room,
                    $limit
                ),
                ARRAY_A
            );
            $rows = array_reverse( (array) $rows );
        }

        return rest_ensure_response( array( 'messages' => array_values( (array) $rows ) ) );
    }

    public static function create_message( WP_REST_Request $request ) {
        global $wpdb;

        // body is canonical; accept legacy Watch Page field names so existing clients do not silently lose a message.
        $body = '';
        foreach ( array( 'body', 'message', 'text', 'content' ) as $field ) {
            $candidate = $request->get_param( $field );
            if ( is_scalar( $candidate ) && '' !== trim( (string) $candidate ) ) {
                $body = sanitize_textarea_field( (string) $candidate );
                break;
            }
        }
        if ( '' === trim( $body ) ) {
            return new WP_Error( 'sml_empty_message', 'Enter a message first.', array( 'status' => 400 ) );
        }
        if ( mb_strlen( $body ) > 1000 ) {
            return new WP_Error( 'sml_message_too_long', 'Messages are limited to 1,000 characters.', array( 'status' => 400 ) );
        }

        $user = wp_get_current_user();
        $table = $wpdb->prefix . 'sml_live_chat_messages';
        $ok = $wpdb->insert(
            $table,
            array(
                'room_key' => self::normalize_room( $request['room'] ),
                'user_id' => absint( $user->ID ),
                'display_name' => sanitize_text_field( $user->display_name ?: $user->user_login ),
                'body' => $body,
                'message_type' => 'chat',
                'created_at' => current_time( 'mysql', true ),
            ),
            array( '%s', '%d', '%s', '%s', '%s', '%s' )
        );

        if ( false === $ok ) {
            return new WP_Error( 'sml_message_store_failed', 'The message could not be saved.', array( 'status' => 500 ) );
        }

        return rest_ensure_response(
            array(
                'message' => array(
                    'id' => absint( $wpdb->insert_id ),
                    'user_id' => absint( $user->ID ),
                    'display_name' => sanitize_text_field( $user->display_name ?: $user->user_login ),
                    'body' => $body,
                    'message_type' => 'chat',
                    'created_at' => current_time( 'mysql', true ),
                ),
            )
        );
    }
}

register_activation_hook( __FILE__, array( 'SML_Live_Chat_Overlay_Fix', 'activate' ) );
SML_Live_Chat_Overlay_Fix::boot();
