<?php
/**
 * Plugin Name: SML Loop Letters Branding Settings
 * Description: Adds publication logo, homepage background, and typography controls to Loop Letters newsletter settings.
 * Version: 1.0.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'SML_LoopLetters_Branding_Settings_100', false ) ) {
	final class SML_LoopLetters_Branding_Settings_100 {
		const NS = 'sml-letter-branding/v1';
		const MAX_FILE_BYTES = 10485760;

		public static function boot() {
			add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
			add_action( 'plugins_loaded', array( __CLASS__, 'start_buffer' ), -PHP_INT_MAX + 20 );
		}

		public static function fonts() {
			return array( 'grotesk', 'serif', 'archivo', 'inter', 'manrope', 'poppins', 'montserrat', 'dm-sans', 'playfair', 'merriweather', 'lora', 'roboto-slab' );
		}

		public static function can_edit() {
			if ( ! is_user_logged_in() ) {
				return false;
			}
			return ! function_exists( 'sml_letters_can_publish' ) || sml_letters_can_publish( get_current_user_id() );
		}

		public static function routes() {
			register_rest_route( self::NS, '/settings', array(
				array( 'methods' => 'GET', 'permission_callback' => array( __CLASS__, 'can_edit' ), 'callback' => array( __CLASS__, 'get' ) ),
				array( 'methods' => 'POST', 'permission_callback' => array( __CLASS__, 'can_edit' ), 'callback' => array( __CLASS__, 'save' ) ),
			) );
			register_rest_route( self::NS, '/media', array(
				'methods' => 'POST',
				'permission_callback' => array( __CLASS__, 'can_edit' ),
				'callback' => array( __CLASS__, 'upload' ),
			) );
		}

		private static function attachment_url( $id, $size ) {
			$id = absint( $id );
			return $id ? (string) wp_get_attachment_image_url( $id, $size ) : '';
		}

		private static function payload( $user_id ) {
			$logo = absint( get_user_meta( $user_id, 'smll_logo_image_id', true ) );
			$background = absint( get_user_meta( $user_id, 'smll_background_image_id', true ) );
			$font = (string) get_user_meta( $user_id, 'smll_font', true );
			return array(
				'logoId' => $logo,
				'logoUrl' => self::attachment_url( $logo, 'medium' ),
				'backgroundId' => $background,
				'backgroundUrl' => self::attachment_url( $background, 'full' ),
				'font' => in_array( $font, self::fonts(), true ) ? $font : 'grotesk',
				'maxFileBytes' => self::MAX_FILE_BYTES,
			);
		}

		public static function get() {
			return rest_ensure_response( self::payload( get_current_user_id() ) );
		}

		private static function owned_image_id( $value, $user_id ) {
			$id = absint( $value );
			if ( ! $id ) {
				return 0;
			}
			$post = get_post( $id );
			if ( ! $post || 'attachment' !== $post->post_type || 0 !== strpos( (string) get_post_mime_type( $id ), 'image/' ) ) {
				return new WP_Error( 'smll_branding_invalid_image', 'Choose a valid image from your uploads.', array( 'status' => 422 ) );
			}
			if ( (int) $post->post_author !== (int) $user_id && ! current_user_can( 'manage_options' ) ) {
				return new WP_Error( 'smll_branding_image_owner', 'That image does not belong to this creator.', array( 'status' => 403 ) );
			}
			return $id;
		}

		public static function save( WP_REST_Request $request ) {
			$user_id = get_current_user_id();
			$logo = self::owned_image_id( $request->get_param( 'logoId' ), $user_id );
			$background = self::owned_image_id( $request->get_param( 'backgroundId' ), $user_id );
			if ( is_wp_error( $logo ) ) { return $logo; }
			if ( is_wp_error( $background ) ) { return $background; }

			$font = sanitize_key( (string) $request->get_param( 'font' ) );
			$font = in_array( $font, self::fonts(), true ) ? $font : 'grotesk';
			update_user_meta( $user_id, 'smll_logo_image_id', $logo );
			update_user_meta( $user_id, 'smll_background_image_id', $background );
			update_user_meta( $user_id, 'smll_font', $font );
			do_action( 'sml_letters_settings_saved', $user_id );
			return rest_ensure_response( self::payload( $user_id ) );
		}

		public static function upload( WP_REST_Request $request ) {
			$slot = sanitize_key( (string) $request->get_param( 'slot' ) );
			if ( ! in_array( $slot, array( 'logo', 'background' ), true ) ) {
				return new WP_Error( 'smll_branding_slot', 'Choose logo or background.', array( 'status' => 422 ) );
			}
			$files = $request->get_file_params();
			$file = isset( $files['file'] ) && is_array( $files['file'] ) ? $files['file'] : array();
			if ( empty( $file['tmp_name'] ) || ! empty( $file['error'] ) ) {
				return new WP_Error( 'smll_branding_upload', 'The image upload did not arrive correctly.', array( 'status' => 400 ) );
			}
			if ( (int) ( $file['size'] ?? 0 ) > self::MAX_FILE_BYTES ) {
				return new WP_Error( 'smll_branding_size', 'Images must be 10 MB or smaller.', array( 'status' => 413 ) );
			}
			$check = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'], array(
				'jpg|jpeg|jpe' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp',
			) );
			if ( empty( $check['type'] ) || 0 !== strpos( $check['type'], 'image/' ) ) {
				return new WP_Error( 'smll_branding_type', 'Use a JPG, PNG, GIF, or WebP image.', array( 'status' => 415 ) );
			}

			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
			$id = media_handle_upload( 'file', 0, array(), array( 'test_form' => false ) );
			if ( is_wp_error( $id ) ) {
				return new WP_Error( 'smll_branding_media', $id->get_error_message(), array( 'status' => 400 ) );
			}
			wp_update_post( array( 'ID' => $id, 'post_author' => get_current_user_id() ) );
			$publication = function_exists( 'sml_letters_publication_settings' ) ? sml_letters_publication_settings( get_current_user_id() ) : array();
			$name = sanitize_text_field( (string) ( $publication['publication_name'] ?? 'Loop Letters' ) );
			update_post_meta( $id, '_wp_attachment_image_alt', $name . ( 'logo' === $slot ? ' publication logo' : ' publication background' ) );
			update_user_meta( get_current_user_id(), 'logo' === $slot ? 'smll_logo_image_id' : 'smll_background_image_id', $id );
			return rest_ensure_response( array( 'id' => (int) $id, 'url' => self::attachment_url( $id, 'logo' === $slot ? 'medium' : 'full' ) ) );
		}

		private static function is_editor_request() {
			if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return false; }
			$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
			return in_array( $path, array( 'creator-studio/loop-letters/write', 'loop-letters' ), true );
		}

		public static function start_buffer() {
			if ( self::is_editor_request() ) {
				ob_start( array( __CLASS__, 'inject' ) );
			}
		}

		public static function inject( $html ) {
			if ( false !== strpos( $html, 'data-sml-letter-branding' ) || false === strpos( $html, 'id="le-root"' ) ) { return $html; }
			$config = array( 'rest' => esc_url_raw( rest_url( self::NS ) ), 'nonce' => wp_create_nonce( 'wp_rest' ) );
			$fonts = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&family=DM+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&family=Lora:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=Merriweather:wght@400;700&family=Montserrat:wght@400;500;600;700;800&family=Playfair+Display:wght@400;600;700&family=Poppins:wght@400;500;600;700&family=Roboto+Slab:wght@400;600;700&family=Space+Grotesk:wght@500;600;700&display=swap';
			$head = '<link rel="stylesheet" data-sml-letter-branding href="' . esc_url( $fonts ) . '"><link rel="stylesheet" data-sml-letter-branding href="' . esc_url( plugins_url( 'assets/settings-branding.css', __FILE__ ) ) . '?v=1.0.0">';
			$foot = '<script>window.SMLLetterBranding=' . wp_json_encode( $config ) . ';</script><script data-sml-letter-branding src="' . esc_url( plugins_url( 'assets/settings-branding.js', __FILE__ ) ) . '?v=1.0.0"></script>';
			$html = str_replace( '</head>', $head . '</head>', $html );
			return str_replace( '</body>', $foot . '</body>', $html );
		}
	}
	SML_LoopLetters_Branding_Settings_100::boot();
}
