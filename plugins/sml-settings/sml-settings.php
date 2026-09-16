<?php
/**
 * Plugin Name:       SML Settings Dashboard
 * Plugin URI:        https://stockmarketloop.com
 * Description:       Member settings: profile, account (email, password, billing links, data export), security (two-step verification via SML Two-Step, signed-in devices, new-device alerts, activity), privacy (profile access — enforced, messaging rules, leaderboard + search-engine opt-outs, blocked members), notifications and account deletion. Adds a /settings page.
 * Version:           1.4.2
 * Author:            StockMarketLoop
 * License:           GPL-2.0-or-later
 * Requires PHP:      7.4
 *
 * ---------------------------------------------------------------------------
 * DESIGN NOTES
 * ---------------------------------------------------------------------------
 * Everything is inside one uniquely-named guarded class. This site runs ~147
 * WPCode snippets in a shared global namespace, and an unguarded function
 * declaration silently destroyed the whole groups system earlier today. No
 * global functions are declared here.
 *
 * The settings page is a real WordPress Page holding a shortcode, created on
 * activation. Deliberately NOT a rewrite rule: the groups outage was a stale
 * rewrite cache, and a page needs no flush and cannot be lost that way.
 *
 * @package SML\Settings
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'SML_Settings_V1', false ) ) {

	final class SML_Settings_V1 {

		const VERSION   = '1.4.2';
		const NS        = 'sml-settings/v1';
		const PAGE_SLUG = 'settings';
		const DB_VERSION_OPT = 'sml_settings_db_version';
		const DELETE_GRACE_DAYS = 30;

		private static $instance = null;

		public static function boot() {
			if ( null === self::$instance ) {
				self::$instance = new self();
			}
			return self::$instance;
		}

		private function __construct() {
			add_action( 'rest_api_init', array( $this, 'routes' ) );
			add_shortcode( 'sml_settings', array( $this, 'render_shortcode' ) );
			add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ) );

			// Persistent account menu, every page, signed-in members only.
			add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_launcher' ) );
			// Priority 5, not 20: core hooks wp_print_footer_scripts at 20, and
			// same-priority ties resolve in registration order, so at 20 the
			// script tag printed before this markup existed.
			add_action( 'wp_footer', array( $this, 'render_launcher' ), 5 );

			// Fallback for pages rendered without wp_footer. The groups
			// directory hooks template_redirect at -900000 and exits, so this
			// has to be lower still or the buffer is never open in time.
			// template_redirect (not init) keeps the buffer off REST, AJAX,
			// cron and admin requests, which never reach this hook at all.
			add_action( 'template_redirect', array( $this, 'maybe_buffer' ), -2000000 );

			// Log the events users actually want to see in "login activity".
			add_action( 'wp_login', array( $this, 'on_login' ), 10, 2 );
			add_action( 'wp_login_failed', array( $this, 'on_login_failed' ) );

			// Privacy enforcement (1.4.0): profile access + search-engine opt-out.
			add_action( 'template_redirect', array( $this, 'gate_profile' ), 8 );
			add_filter( 'wp_robots', array( $this, 'robots_noindex' ) );

			// Deletion grace period.
			add_action( 'sml_settings_process_deletion', array( $this, 'process_deletion' ) );
			add_action( 'init', array( $this, 'maybe_block_pending_deletion' ) );
		}

		// ===================================================================
		// Activation
		// ===================================================================

		public static function activate() {
			self::install_tables();
			self::ensure_page();
			if ( ! wp_next_scheduled( 'sml_settings_process_deletion' ) ) {
				wp_schedule_event( time() + 3600, 'daily', 'sml_settings_process_deletion' );
			}
		}

		public static function deactivate() {
			wp_clear_scheduled_hook( 'sml_settings_process_deletion' );
		}

		private static function install_tables() {
			global $wpdb;
			require_once ABSPATH . 'wp-admin/includes/upgrade.php';

			$table   = $wpdb->prefix . 'sml_security_events';
			$charset = $wpdb->get_charset_collate();

			$sql = "CREATE TABLE {$table} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				user_id BIGINT UNSIGNED NOT NULL,
				event_type VARCHAR(40) NOT NULL,
				ip_address VARCHAR(45) NULL,
				user_agent VARCHAR(255) NULL,
				detail TEXT NULL,
				created_at DATETIME NOT NULL,
				PRIMARY KEY (id),
				KEY user_created (user_id, created_at)
			) {$charset};";

			dbDelta( $sql );
			update_option( self::DB_VERSION_OPT, self::VERSION );
		}

		private static function ensure_page() {
			$existing = get_page_by_path( self::PAGE_SLUG );
			if ( $existing && 'trash' !== $existing->post_status ) {
				return;
			}
			wp_insert_post( array(
				'post_title'   => 'Settings',
				'post_name'    => self::PAGE_SLUG,
				'post_content' => '[sml_settings]',
				'post_status'  => 'publish',
				'post_type'    => 'page',
				'comment_status' => 'closed',
				'ping_status'  => 'closed',
			) );
		}

		// ===================================================================
		// Front end
		// ===================================================================

		public function render_shortcode() {
			if ( ! is_user_logged_in() ) {
				return '<div class="sml-set sml-set--guest"><p>You need to be signed in to manage your settings.</p>'
					. '<a class="sml-set__btn" href="' . esc_url( wp_login_url( get_permalink() ) ) . '">Sign in</a></div>';
			}
			// The shell only. Everything else is rendered client-side from
			// /me, so a cached page can never serve one member's settings to
			// another — the HTML is identical for everyone.
			return '<div id="sml-settings-root" class="sml-set" data-sml-settings></div>';
		}

		public function enqueue() {
			if ( ! is_singular() ) {
				return;
			}
			$post = get_post();
			if ( ! $post || ! has_shortcode( (string) $post->post_content, 'sml_settings' ) ) {
				return;
			}

			$url = plugin_dir_url( __FILE__ );
			wp_enqueue_style( 'sml-settings', $url . 'assets/settings.css', array(), self::VERSION );
			wp_enqueue_script( 'sml-settings', $url . 'assets/settings.js', array(), self::VERSION, true );

			wp_localize_script( 'sml-settings', 'SMLSettings', array(
				'rest'       => esc_url_raw( rest_url( self::NS ) ),
				'nonce'      => wp_create_nonce( 'wp_rest' ),
				'logoutUrl'  => esc_url_raw( wp_logout_url( home_url( '/' ) ) ),
				'graceDays'  => self::DELETE_GRACE_DAYS,
				'twoStepRest'=> esc_url_raw( rest_url( 'sml-2step/v1' ) ),
				'qr'         => esc_url_raw( $url . 'assets/qrcode.min.js?ver=' . self::VERSION ),
				'links'      => $this->links(),
			) );
		}

		/**
		 * Assets for the persistent account button.
		 *
		 * Separate from the settings-page assets because these load on every
		 * page of the site — so they are kept to ~3KB combined and do no
		 * network work at all.
		 */
		public function enqueue_launcher() {
			if ( ! $this->launcher_applies() ) {
				return;
			}
			$url = plugin_dir_url( __FILE__ );
			wp_enqueue_style( 'sml-acct', $url . 'assets/launcher.css', array(), self::VERSION );
			wp_enqueue_script( 'sml-acct', $url . 'assets/launcher.js', array(), self::VERSION, true );
		}

		/**
		 * The account button itself.
		 *
		 * Rendered server-side rather than injected by script so it is present
		 * on first paint — a control that pops in a second late reads as the
		 * page being broken, and this one is the only route to Settings.
		 */
		public function render_launcher() {
			if ( ! $this->launcher_applies() ) {
				return;
			}
			echo $this->launcher_markup(); // phpcs:ignore WordPress.Security.EscapeOutput
		}

		/**
		 * Shared gate for both delivery paths.
		 */
		private function launcher_applies() {
			if ( ! is_user_logged_in() || is_admin() || is_feed() ) {
				return false;
			}
			// Embedded group tools and the Analyst Dashboard already sit inside a
			// top-level page that owns the account launcher. Rendering another copy
			// inside each iframe produces stacked avatar buttons over the interface.
			$embed = isset( $_GET['embed'] )
				? sanitize_text_field( wp_unslash( $_GET['embed'] ) )
				: '';
			if ( '1' === $embed || isset( $_GET['sml_group_tool'] ) ) {
				return false;
			}
			// Don't shadow the settings page's own navigation.
			$post = get_post();
			if ( $post && has_shortcode( (string) $post->post_content, 'sml_settings' ) ) {
				return false;
			}
			return true;
		}

		private function launcher_markup() {
			$u        = wp_get_current_user();
			$avatar   = get_avatar_url( $u->ID, array( 'size' => 88 ) );
			/* the canonical handle URL (owner call 2026-09-08): the nicename form only 301s to it and defeats the profile prerender */
			$profile  = function_exists( 'sml_fp_my_profile_url' ) ? sml_fp_my_profile_url( $u->ID ) : ( function_exists( 'sml_profile_url_for' ) ? sml_profile_url_for( $u->ID ) : home_url( '/' . $u->user_nicename . '/' ) );
			$settings = home_url( '/' . self::PAGE_SLUG . '/' );

			// Icons are inline SVG: no icon-font request, no FOUT, and they
			// inherit currentColor so hover states just work.
			$icon = static function ( $d ) {
				return '<svg class="sml-acct__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
					. ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
					. $d . '</svg>';
			};

			// Built by concatenation, NOT ob_start(). This method also runs from
			// inside an output-buffer callback, and PHP forbids opening a buffer
			// there — doing so discards the entire response. That is how the
			// groups directory went blank once already.
			$item = static function ( $href, $svg, $label, $extra = '', $trail = '' ) {
				return '<a class="sml-acct__item' . $extra . '" role="menuitem" href="' . esc_url( $href ) . '">'
					. $svg . '<span class="sml-acct__label">' . esc_html( $label ) . '</span>' . $trail . '</a>';
			};
			$sep = '<div class="sml-acct__sep"></div>';

			$html  = '<div class="sml-acct" data-sml-acct>';
			$html .= '<button type="button" class="sml-acct__btn" aria-expanded="false" aria-haspopup="true"'
				. ' aria-label="' . esc_attr__( 'Account menu', 'sml-settings' ) . '">'
				. '<img class="sml-acct__avatar" src="' . esc_url( $avatar ) . '" alt="" /></button>';

			$html .= '<div class="sml-acct__menu" role="menu">';
			$html .= '<div class="sml-acct__head">'
				. '<span class="sml-acct__name">' . esc_html( $u->display_name ) . '</span>'
				. '<span class="sml-acct__handle">@' . esc_html( $u->user_nicename ) . '</span>'
				. '</div>';

			// Group 1 — getting around. Home first: it is the one item people
			// reach for when they are lost, and the site has no persistent
			// header to fall back on.
			$html .= $item(
				home_url( '/' ),
				$icon( '<path d="M3 9.5 12 3l9 6.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 13 15 13 15 22"/>' ),
				__( 'Home', 'sml-settings' )
			);

			$html .= $item(
				$profile,
				$icon( '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' ),
				__( 'My profile', 'sml-settings' )
			);

			$html .= $sep;

			// Group 2 — creating. Go live carries a live dot so it reads as an
			// action rather than another page link.
			$html .= $item(
				home_url( '/creator-studio/' ),
				$icon( '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>' ),
				__( 'Creator Studio', 'sml-settings' )
			);

			$html .= $item(
				home_url( '/go-live/' ),
				$icon( '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>' ),
				__( 'Go live', 'sml-settings' ),
				'',
				'<span class="sml-acct__dot" aria-hidden="true"></span>'
			);

			$html .= $sep;

			// Group 3 — the account itself.
			$html .= $item(
				$settings,
				$icon( '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' ),
				__( 'Settings', 'sml-settings' )
			);

			$html .= $item(
				home_url( '/customize-profile/' ),
				$icon( '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>' ),
				__( 'Customize profile', 'sml-settings' )
			);

			$html .= $sep;

			$html .= $item(
				wp_logout_url( home_url( '/' ) ),
				$icon( '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>' ),
				__( 'Sign out', 'sml-settings' ),
				' sml-acct__item--danger'
			);

			$html .= '</div></div>';

			return $html;
		}

		// ===================================================================
		// Standalone-page fallback
		// ===================================================================
		//
		// Some SML screens (the /groups/ directory is the clearest example) are
		// echoed as complete HTML documents by WPCode snippets that never call
		// wp_head() or wp_footer(). No amount of hooking reaches those pages,
		// so "accessible from any page" needs a second delivery path.
		//
		// ob_start()'s callback runs at shutdown even when the page ends in
		// exit(), which is exactly what those snippets do. The callback is
		// deliberately paranoid: it touches the buffer only when the response
		// is a real HTML document that does not already contain the button.

		public function maybe_buffer() {
			if ( ! $this->launcher_applies() ) {
				return;
			}
			if ( wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || wp_doing_cron() ) {
				return;
			}
			if ( isset( $_SERVER['REQUEST_METHOD'] ) && 'GET' !== strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) ) ) {
				return;
			}
			ob_start( array( $this, 'inject_launcher' ) );
		}

		/**
		 * @param string $html Full response body.
		 * @return string
		 */
		public function inject_launcher( $html ) {
			if ( ! is_string( $html ) || '' === $html ) {
				return $html;
			}
			// Already delivered through wp_footer — the normal case.
			if ( false !== strpos( $html, 'data-sml-acct' ) ) {
				return $html;
			}
			// Only touch complete HTML documents. Partials, JSON, XML and
			// anything streamed by another plugin are left exactly as they are.
			$close = strripos( $html, '</body>' );
			if ( false === $close || false === stripos( $html, '<html' ) ) {
				return $html;
			}

			// Nothing this callback does is worth a blank page. If anything at
			// all goes wrong, the visitor gets the page exactly as the site
			// rendered it and simply has no account button on that screen.
			try {
				$url    = plugin_dir_url( __FILE__ );
				$ver    = rawurlencode( self::VERSION );
				$assets = '<link rel="stylesheet" href="' . esc_url( $url . 'assets/launcher.css?ver=' . $ver ) . '" />'
					. '<script src="' . esc_url( $url . 'assets/launcher.js?ver=' . $ver ) . '" defer></script>';

				$markup = $this->launcher_markup();
			} catch ( \Throwable $e ) {
				return $html;
			}

			return substr( $html, 0, $close ) . $markup . $assets . substr( $html, $close );
		}

		// ===================================================================
		// REST
		// ===================================================================

		public function routes() {
			$auth = array( $this, 'require_login' );

			$get  = function ( $path, $cb ) use ( $auth ) {
				register_rest_route( self::NS, $path, array(
					'methods' => 'GET', 'callback' => array( $this, $cb ), 'permission_callback' => $auth,
				) );
			};
			$post = function ( $path, $cb ) use ( $auth ) {
				register_rest_route( self::NS, $path, array(
					'methods' => 'POST', 'callback' => array( $this, $cb ), 'permission_callback' => $auth,
				) );
			};

			$get( '/me', 'get_me' );
			$post( '/profile', 'update_profile' );
			$post( '/account/email/request', 'request_email_change' );
			$post( '/account/email/verify', 'verify_email_change' );
			$post( '/account/password', 'change_password' );
			$get( '/security/activity', 'get_activity' );
			$post( '/security/sessions/revoke', 'revoke_sessions' );
			$post( '/privacy', 'update_privacy' );
			$post( '/notifications', 'update_notifications' );
			$post( '/danger/delete/request', 'request_deletion' );
			$post( '/danger/delete/cancel', 'cancel_deletion' );
			$post( '/account/export', 'request_export' );
			$post( '/privacy/unblock', 'unblock_member' );
		}

		public function require_login() {
			return is_user_logged_in()
				? true
				: new WP_Error( 'sml_unauthorized', 'You must be signed in.', array( 'status' => 401 ) );
		}

		// -------------------------------------------------------------------

		public function get_me() {
			$u  = wp_get_current_user();
			$id = $u->ID;

			$pending_email = get_user_meta( $id, 'sml_pending_email', true );
			$delete_at     = (int) get_user_meta( $id, 'sml_delete_at', true );

			return rest_ensure_response( array(
				'id'          => $id,
				'handle'      => $this->handle( $id ),
				'displayName' => $u->display_name,
				'bio'         => get_user_meta( $id, 'description', true ),
				'email'       => $u->user_email,
				'pendingEmail'=> $pending_email ? $pending_email : null,
				'avatar'      => get_avatar_url( $id, array( 'size' => 96 ) ),
				'profileUrl'  => $this->profile_url( $id ),
				'registered'  => $u->user_registered,
				'loopBucks'   => function_exists( 'sml_lb_balance' ) ? (int) sml_lb_balance( $id ) : 0,
				'privacy'     => $this->privacy_payload( $id ),
				'notifications' => $this->notifications_payload( $id ),
				'twoStep'     => class_exists( 'SML_Two_Step' ) ? SML_Two_Step::status( $id ) : null,
				'dataExport'  => $this->export_state( $u->user_email ),
				'deletion' => $delete_at ? array(
					'scheduledFor' => gmdate( 'c', $delete_at ),
					'daysLeft'     => max( 0, (int) ceil( ( $delete_at - time() ) / DAY_IN_SECONDS ) ),
				) : null,
			) );
		}

		public function update_profile( WP_REST_Request $req ) {
			$id   = get_current_user_id();
			$name = trim( (string) $req->get_param( 'displayName' ) );
			$bio  = trim( (string) $req->get_param( 'bio' ) );

			if ( '' === $name || mb_strlen( $name ) > 60 ) {
				return $this->err( 'invalid_display_name', 'Display name must be 1–60 characters.', 422 );
			}
			if ( mb_strlen( $bio ) > 500 ) {
				return $this->err( 'invalid_bio', 'Bio must be 500 characters or fewer.', 422 );
			}

			wp_update_user( array( 'ID' => $id, 'display_name' => sanitize_text_field( $name ) ) );
			update_user_meta( $id, 'description', sanitize_textarea_field( $bio ) );
			$this->log( $id, 'profile_updated' );

			return rest_ensure_response( array( 'ok' => true ) );
		}

		/**
		 * Email change, step 1.
		 *
		 * The new address is held in user meta and the code is hashed — a
		 * database read must not hand someone a working verification code. The
		 * address is NOT written to the user record until it is verified, so a
		 * typo cannot lock somebody out of their own account.
		 */
		public function request_email_change( WP_REST_Request $req ) {
			$id    = get_current_user_id();
			$email = sanitize_email( (string) $req->get_param( 'email' ) );

			if ( ! is_email( $email ) ) {
				return $this->err( 'invalid_email', 'That does not look like a valid email address.', 422 );
			}
			if ( strtolower( $email ) === strtolower( wp_get_current_user()->user_email ) ) {
				return $this->err( 'same_email', 'That is already your email address.', 422 );
			}
			if ( email_exists( $email ) ) {
				// Deliberately vague: confirming which addresses have accounts
				// is an enumeration oracle.
				return $this->err( 'email_unavailable', 'That address cannot be used.', 409 );
			}
			if ( ! $this->rate_ok( 'email_change', $id, 5, HOUR_IN_SECONDS ) ) {
				return $this->err( 'rate_limited', 'Too many attempts. Try again in an hour.', 429 );
			}

			$code = (string) wp_rand( 100000, 999999 );
			update_user_meta( $id, 'sml_pending_email', $email );
			update_user_meta( $id, 'sml_pending_email_hash', wp_hash_password( $code ) );
			update_user_meta( $id, 'sml_pending_email_exp', time() + 15 * MINUTE_IN_SECONDS );
			update_user_meta( $id, 'sml_pending_email_tries', 0 );

			wp_mail(
				$email,
				'Confirm your new StockMarketLoop email',
				"Your verification code is {$code}\n\nIt expires in 15 minutes.\n\n"
				. "If you did not request this, you can ignore this email."
			);

			// Tell the CURRENT address too — that is how an account takeover
			// gets noticed by the person being taken over.
			wp_mail(
				wp_get_current_user()->user_email,
				'Someone requested an email change on your account',
				"A change to {$email} was requested. If this wasn't you, change your password immediately."
			);

			$this->log( $id, 'email_change_requested', $email );

			return rest_ensure_response( array( 'ok' => true, 'pendingEmail' => $email ) );
		}

		public function verify_email_change( WP_REST_Request $req ) {
			$id    = get_current_user_id();
			$code  = trim( (string) $req->get_param( 'code' ) );
			$email = get_user_meta( $id, 'sml_pending_email', true );
			$hash  = get_user_meta( $id, 'sml_pending_email_hash', true );
			$exp   = (int) get_user_meta( $id, 'sml_pending_email_exp', true );
			$tries = (int) get_user_meta( $id, 'sml_pending_email_tries', true );

			if ( ! $email || ! $hash ) {
				return $this->err( 'no_pending_change', 'There is no email change waiting.', 409 );
			}
			if ( time() > $exp ) {
				$this->clear_pending_email( $id );
				return $this->err( 'code_expired', 'That code has expired. Request a new one.', 410 );
			}
			// Bound guesses — a 6-digit code is brute-forceable in seconds otherwise.
			if ( $tries >= 5 ) {
				$this->clear_pending_email( $id );
				return $this->err( 'too_many_attempts', 'Too many incorrect codes. Request a new one.', 429 );
			}

			update_user_meta( $id, 'sml_pending_email_tries', $tries + 1 );

			if ( ! wp_check_password( $code, $hash ) ) {
				return $this->err( 'bad_code', 'That code is not correct.', 400 );
			}

			$old = wp_get_current_user()->user_email;
			wp_update_user( array( 'ID' => $id, 'user_email' => $email ) );
			$this->clear_pending_email( $id );
			$this->log( $id, 'email_changed', $old . ' → ' . $email );

			wp_mail( $old, 'Your StockMarketLoop email was changed',
				"Your account email is now {$email}. If this wasn't you, contact support immediately." );

			return rest_ensure_response( array( 'ok' => true, 'email' => $email ) );
		}

		private function clear_pending_email( $id ) {
			delete_user_meta( $id, 'sml_pending_email' );
			delete_user_meta( $id, 'sml_pending_email_hash' );
			delete_user_meta( $id, 'sml_pending_email_exp' );
			delete_user_meta( $id, 'sml_pending_email_tries' );
		}

		/**
		 * Password change.
		 *
		 * Requires the current password — a hijacked session must not be able
		 * to lock the real owner out. On success every OTHER session is
		 * destroyed, which is the entire point of changing a password after
		 * you suspect compromise.
		 */
		public function change_password( WP_REST_Request $req ) {
			$id      = get_current_user_id();
			$current = (string) $req->get_param( 'currentPassword' );
			$next    = (string) $req->get_param( 'newPassword' );
			$user    = get_userdata( $id );

			if ( ! $this->rate_ok( 'password_change', $id, 5, HOUR_IN_SECONDS ) ) {
				return $this->err( 'rate_limited', 'Too many attempts. Try again in an hour.', 429 );
			}
			if ( ! wp_check_password( $current, $user->user_pass, $id ) ) {
				$this->log( $id, 'password_change_failed' );
				return $this->err( 'wrong_password', 'Your current password is not correct.', 400 );
			}
			if ( strlen( $next ) < 10 ) {
				return $this->err( 'weak_password', 'Use at least 10 characters.', 422 );
			}
			if ( $next === $current ) {
				return $this->err( 'same_password', 'That is your current password.', 422 );
			}

			wp_set_password( $next, $id );

			// wp_set_password destroys ALL sessions including this one, so sign
			// the user back in here — otherwise changing your password logs you
			// out, which reads as an error.
			wp_set_current_user( $id );
			if ( class_exists( 'SML_Two_Step' ) ) { SML_Two_Step::bypass_next(); }   // this session already proved the password
			wp_set_auth_cookie( $id, false );

			$this->log( $id, 'password_changed' );
			wp_mail( $user->user_email, 'Your StockMarketLoop password was changed',
				"If this wasn't you, reset your password immediately." );

			return rest_ensure_response( array( 'ok' => true, 'sessionsRevoked' => true ) );
		}

		public function get_activity() {
			global $wpdb;
			$id    = get_current_user_id();
			$table = $wpdb->prefix . 'sml_security_events';

			$rows = $wpdb->get_results( $wpdb->prepare(
				"SELECT event_type, ip_address, user_agent, detail, created_at
				 FROM {$table} WHERE user_id = %d ORDER BY created_at DESC LIMIT 50",
				$id
			), ARRAY_A );

			return rest_ensure_response( array( 'items' => $rows ?: array() ) );
		}

		public function revoke_sessions() {
			$id = get_current_user_id();
			$manager = WP_Session_Tokens::get_instance( $id );
			$manager->destroy_others( wp_get_session_token() );
			$this->log( $id, 'sessions_revoked' );
			return rest_ensure_response( array( 'ok' => true ) );
		}

		public function update_privacy( WP_REST_Request $req ) {
			$id  = get_current_user_id();
			$vis = (string) $req->get_param( 'profileAccess' );
			if ( '' === $vis ) { $vis = (string) $req->get_param( 'profileVisibility' ); }

			if ( ! in_array( $vis, array( 'public', 'members', 'private' ), true ) ) {
				return $this->err( 'invalid_visibility', 'Unknown visibility option.', 422 );
			}

			// Own key — `sml_profile_visibility` belongs to the profile-details plugin (per-field array) and must not be clobbered.
			update_user_meta( $id, 'sml_profile_access', $vis );
			update_user_meta( $id, 'sml_show_activity', $req->get_param( 'showActivity' ) ? '1' : '0' );
			update_user_meta( $id, 'sml_profile_noindex', $req->get_param( 'noindex' ) ? '1' : '0' );
			update_user_meta( $id, 'sml_hide_leaderboard', $req->get_param( 'hideLeaderboard' ) ? '1' : '0' );

			if ( class_exists( 'SML_Loop_Prefs' ) && null !== $req->get_param( 'whoCanMessage' ) ) {
				$who = sanitize_key( (string) $req->get_param( 'whoCanMessage' ) );
				if ( in_array( $who, array( 'everyone', 'following', 'nobody' ), true ) ) {
					SML_Loop_Prefs::save( $id, array( 'who_can_message' => $who, 'allow_requests' => $req->get_param( 'allowRequests' ) ? 1 : 0 ) );
				}
			}
			$this->log( $id, 'privacy_updated', $vis );

			return rest_ensure_response( array( 'ok' => true, 'privacy' => $this->privacy_payload( $id ) ) );
		}

		public function update_notifications( WP_REST_Request $req ) {
			$id = get_current_user_id();
			update_user_meta( $id, 'sml_notify_email', $req->get_param( 'email' ) ? '1' : '0' );
			// Q&A follow-up emails: the Q&A plugin's own opt-out flag.
			if ( $req->get_param( 'qa' ) ) { delete_user_meta( $id, 'sml_qa_email_off' ); } else { update_user_meta( $id, 'sml_qa_email_off', '1' ); }
			// New-device sign-in alerts: the two-step plugin's flag.
			update_user_meta( $id, 'sml_2s_login_alerts', $req->get_param( 'loginAlerts' ) ? '1' : '0' );
			return rest_ensure_response( array( 'ok' => true, 'notifications' => $this->notifications_payload( $id ) ) );
		}

		/**
		 * Account deletion — scheduled, not immediate.
		 *
		 * The pasted blueprint ran DELETE FROM users straight from the request.
		 * Three reasons that is the wrong shape on a live platform:
		 *
		 *   1. There is no undo. Account deletion is overwhelmingly done in
		 *      anger or by mistake, and a meaningful share of people come back
		 *      within days.
		 *   2. It leaves the payment provider billing a card for an account
		 *      that no longer exists. That is a chargeback and a support
		 *      nightmare, not a tidy cleanup.
		 *   3. It destroys content other people are still reading, mid-thread,
		 *      with no warning to them.
		 *
		 * So: password-confirmed, scheduled 30 days out, cancellable by simply
		 * signing in, and the user is signed out immediately so it FEELS
		 * deleted. A daily cron does the real work.
		 */
		public function request_deletion( WP_REST_Request $req ) {
			$id       = get_current_user_id();
			$password = (string) $req->get_param( 'password' );
			$confirm  = (string) $req->get_param( 'confirm' );
			$user     = get_userdata( $id );

			if ( 'DELETE' !== strtoupper( trim( $confirm ) ) ) {
				return $this->err( 'confirm_required', 'Type DELETE to confirm.', 422 );
			}
			if ( ! wp_check_password( $password, $user->user_pass, $id ) ) {
				return $this->err( 'wrong_password', 'That password is not correct.', 400 );
			}
			// An administrator deleting themselves through a member UI is
			// almost certainly a mistake, and it can orphan the site.
			if ( user_can( $id, 'manage_options' ) ) {
				return $this->err( 'admin_blocked',
					'Administrator accounts cannot be deleted here. Contact support.', 403 );
			}

			$when = time() + ( self::DELETE_GRACE_DAYS * DAY_IN_SECONDS );
			update_user_meta( $id, 'sml_delete_at', $when );
			$this->log( $id, 'deletion_scheduled', gmdate( 'c', $when ) );

			wp_mail( $user->user_email, 'Your StockMarketLoop account is scheduled for deletion',
				"Your account will be permanently deleted on " . gmdate( 'F j, Y', $when ) . ".\n\n"
				. "Changed your mind? Just sign in again before then and it will be cancelled." );

			wp_destroy_current_session();
			wp_clear_auth_cookie();

			return rest_ensure_response( array(
				'ok' => true,
				'scheduledFor' => gmdate( 'c', $when ),
				'graceDays' => self::DELETE_GRACE_DAYS,
			) );
		}

		public function cancel_deletion() {
			$id = get_current_user_id();
			delete_user_meta( $id, 'sml_delete_at' );
			$this->log( $id, 'deletion_cancelled' );
			return rest_ensure_response( array( 'ok' => true ) );
		}

		/**
		 * Signing in cancels a pending deletion.
		 *
		 * Making someone find a settings page to undo something they regret is
		 * a dark pattern in reverse — the intent is unambiguous the moment they
		 * come back.
		 */
		public function maybe_block_pending_deletion() {
			if ( ! is_user_logged_in() ) {
				return;
			}
			$id = get_current_user_id();
			if ( get_user_meta( $id, 'sml_delete_at', true ) ) {
				delete_user_meta( $id, 'sml_delete_at' );
				$this->log( $id, 'deletion_cancelled_by_login' );
			}
		}

		/** Daily cron: actually delete anything past its grace period. */
		public function process_deletion() {
			$users = get_users( array(
				'meta_key'     => 'sml_delete_at',
				'meta_value'   => time(),
				'meta_compare' => '<=',
				'meta_type'    => 'NUMERIC',
				'number'       => 25,
				'fields'       => 'ID',
			) );

			if ( ! $users ) {
				return;
			}
			require_once ABSPATH . 'wp-admin/includes/user.php';

			foreach ( $users as $uid ) {
				if ( user_can( $uid, 'manage_options' ) ) {
					delete_user_meta( $uid, 'sml_delete_at' );
					continue;
				}
				/**
				 * Last chance for other plugins to tear down: cancel the
				 * subscription, revoke Discord roles, purge media. Fired before
				 * the row disappears, while the id still resolves to something.
				 */
				do_action( 'sml_settings_before_user_deleted', $uid );
				wp_delete_user( $uid );   // handles content reassignment properly
			}
		}

		// ===================================================================
		// 1.4.0: identity, privacy, notifications, data export, blocks
		// ===================================================================

		private function handle( $id ) {
			$h = function_exists( 'sml_ppe_public_handle' ) ? (string) sml_ppe_public_handle( $id ) : '';
			if ( '' === $h ) { $u = get_userdata( $id ); $h = $u ? $u->user_nicename : ''; }
			return ltrim( $h, '@' );
		}

		private function profile_url( $id ) {
			if ( function_exists( 'sml_fp_my_profile_url' ) ) { return (string) sml_fp_my_profile_url( $id ); }
			if ( function_exists( 'sml_profile_url_for' ) ) { return (string) sml_profile_url_for( (int) $id ); }
			return home_url( '/' . $this->handle( $id ) . '/' );
		}

		private function links() {
			$page = static function ( $slug ) { $p = get_page_by_path( $slug ); return ( $p && 'publish' === $p->post_status ) ? get_permalink( $p ) : ''; };
			return array(
				'customize'         => home_url( '/customize-profile/' ),
				'customerDashboard' => $page( 'customer-dashboard' ),
				'orders'            => $page( 'my-account' ),
				'connect'           => $page( 'connect-dashboard' ),
				'loopBucks'         => $page( 'loop-bucks' ),
				'alerts'            => $page( 'alerts' ),
			);
		}

		/** Profile access: own key, migrated once from the old string value that shared the profile-details plugin's key. */
		public static function profile_access( $id ) {
			$v = get_user_meta( $id, 'sml_profile_access', true );
			if ( ! in_array( $v, array( 'public', 'members', 'private' ), true ) ) {
				$old = get_user_meta( $id, 'sml_profile_visibility', true );
				$v   = ( is_string( $old ) && in_array( $old, array( 'public', 'members', 'private' ), true ) ) ? $old : 'public';
			}
			return $v;
		}

		private function privacy_payload( $id ) {
			$dm = array( 'available' => false, 'whoCanMessage' => 'everyone', 'allowRequests' => true );
			if ( class_exists( 'SML_Loop_Prefs' ) ) {
				try {
					$p  = SML_Loop_Prefs::get( (int) $id );
					$dm = array( 'available' => true, 'whoCanMessage' => (string) ( $p['who_can_message'] ?? 'everyone' ), 'allowRequests' => ! empty( $p['allow_requests'] ) );
				} catch ( \Throwable $e ) {}
			}
			$blocked = array();
			if ( function_exists( 'sml_mhc_blocked_ids' ) ) {
				foreach ( (array) sml_mhc_blocked_ids( $id ) as $bid ) {
					$bu = get_userdata( (int) $bid ); if ( ! $bu ) { continue; }
					$blocked[] = array( 'id' => (int) $bid, 'name' => $bu->display_name ?: $bu->user_login, 'handle' => $this->handle( (int) $bid ), 'avatar' => get_avatar_url( (int) $bid, array( 'size' => 56 ) ) );
				}
			}
			return array(
				'profileAccess'   => self::profile_access( $id ),
				'showActivity'    => '0' !== get_user_meta( $id, 'sml_show_activity', true ),
				'noindex'         => '1' === get_user_meta( $id, 'sml_profile_noindex', true ),
				'hideLeaderboard' => '1' === get_user_meta( $id, 'sml_hide_leaderboard', true ),
				'dm'              => $dm,
				'blocked'         => $blocked,
			);
		}

		private function notifications_payload( $id ) {
			return array(
				'email'       => '0' !== get_user_meta( $id, 'sml_notify_email', true ),
				'qa'          => ! get_user_meta( $id, 'sml_qa_email_off', true ),
				'loginAlerts' => '0' !== get_user_meta( $id, 'sml_2s_login_alerts', true ),
			);
		}

		private function export_state( $email ) {
			$q = get_posts( array( 'post_type' => 'user_request', 'post_status' => array( 'request-pending', 'request-confirmed', 'request-completed' ), 'name' => 'export_personal_data', 'title' => $email, 'posts_per_page' => 1, 'orderby' => 'date', 'order' => 'DESC', 'fields' => 'all', 'no_found_rows' => true ) );
			if ( ! $q ) { return null; }
			$r = $q[0];
			if ( 'request-completed' === $r->post_status && strtotime( $r->post_modified_gmt ) < time() - 14 * DAY_IN_SECONDS ) { return null; }
			return array( 'state' => $r->post_status, 'requested' => mysql2date( 'c', $r->post_date_gmt, false ) );
		}

		/** Core personal-data export: confirmation email → admin/cron builds the ZIP → download link email. */
		public function request_export() {
			$u = wp_get_current_user();
			if ( ! $this->rate_ok( 'export', $u->ID, 3, DAY_IN_SECONDS ) ) { return $this->err( 'rate_limited', 'You can request three exports a day.', 429 ); }
			$rid = wp_create_user_request( $u->user_email, 'export_personal_data' );
			if ( is_wp_error( $rid ) ) {
				if ( 'duplicate_request' === $rid->get_error_code() ) { return $this->err( 'export_pending', 'A request is already open. Check your email for the confirmation link.', 409 ); }
				return $this->err( 'export_failed', $rid->get_error_message(), 500 );
			}
			wp_send_user_request( $rid );
			$this->log( $u->ID, 'data_export_requested' );
			return rest_ensure_response( array( 'ok' => true, 'dataExport' => $this->export_state( $u->user_email ) ) );
		}

		public function unblock_member( WP_REST_Request $req ) {
			$id     = get_current_user_id();
			$target = absint( $req->get_param( 'userId' ) );
			if ( ! function_exists( 'sml_mhc_block' ) ) { return $this->err( 'no_blocks', 'Blocking is not available.', 501 ); }
			$r = new WP_REST_Request( 'POST', '/sml/v1/member-hover/block' );
			$r->set_param( 'user_id', $target ); $r->set_param( 'action', 'unblock' );
			$out = sml_mhc_block( $r );
			if ( is_wp_error( $out ) ) { return $out; }
			$this->log( $id, 'member_unblocked', (string) $target );
			$pp = $this->privacy_payload( $id );
			return rest_ensure_response( array( 'ok' => true, 'blocked' => $pp['blocked'] ) );
		}

		/** Enforce "Who can see your profile page" on the public profile route. */
		public function gate_profile() {
			if ( ! function_exists( 'sml_ppe_is_public_profile_request' ) || ! function_exists( 'sml_ppe_resolve_request_user_id' ) ) { return; }
			if ( ! sml_ppe_is_public_profile_request() ) { return; }
			$target = (int) sml_ppe_resolve_request_user_id();
			if ( ! $target ) { return; }
			$viewer = get_current_user_id();
			if ( '1' === get_user_meta( $target, 'sml_profile_noindex', true ) ) { header( 'X-Robots-Tag: noindex' ); }
			if ( $viewer === $target || current_user_can( 'manage_options' ) ) { return; }
			$access = self::profile_access( $target );
			if ( 'public' === $access ) { return; }
			if ( 'members' === $access && ! $viewer ) {
				wp_safe_redirect( wp_login_url( home_url( add_query_arg( array(), (string) ( $_SERVER['REQUEST_URI'] ?? '/' ) ) ) ) );
				exit;
			}
			if ( 'members' === $access ) { return; }
			// private
			status_header( 403 ); nocache_headers(); header( 'X-Robots-Tag: noindex' );
			$name = get_userdata( $target ); $name = $name ? $name->display_name : 'This member';
			echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Private profile - ' . esc_html( get_bloginfo( 'name' ) ) . '</title>'
				. '<style>body{margin:0;background:#04070b;color:#e6edf3;font:15px/1.5 Archivo,Inter,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}.c{max-width:420px;text-align:center}.k{font:800 10px/1 Archivo,sans-serif;letter-spacing:.2em;color:#00ff88;margin-bottom:12px}h1{margin:0 0 8px;font-size:22px}p{color:#9fb0c0;margin:0 0 18px}a{display:inline-block;padding:11px 18px;border-radius:10px;background:#00ff88;color:#04120a;font-weight:800;text-decoration:none}</style></head>'
				. '<body><div class="c"><div class="k">STOCKMARKETLOOP</div><h1>' . esc_html( $name ) . ' keeps this profile private</h1><p>Only they can see this page. Their posts in groups and live rooms are still visible to the people there.</p><a href="' . esc_url( home_url( '/' ) ) . '">Back to StockMarketLoop</a></div></body></html>';
			exit;
		}

		public function robots_noindex( $robots ) {
			if ( function_exists( 'sml_ppe_is_public_profile_request' ) && sml_ppe_is_public_profile_request() ) {
				$t = (int) sml_ppe_resolve_request_user_id();
				if ( $t && '1' === get_user_meta( $t, 'sml_profile_noindex', true ) ) { $robots['noindex'] = true; $robots['nofollow'] = true; unset( $robots['index'], $robots['follow'] ); }
			}
			return $robots;
		}

		// ===================================================================
		// Helpers
		// ===================================================================

		public function on_login( $login, $user ) {
			if ( $user instanceof WP_User ) {
				$this->log( $user->ID, 'login' );
			}
		}

		public function on_login_failed( $login ) {
			$user = get_user_by( 'login', $login );
			if ( $user ) {
				$this->log( $user->ID, 'login_failed' );
			}
		}

		private function log( $user_id, $type, $detail = '' ) {
			global $wpdb;
			$wpdb->insert(
				$wpdb->prefix . 'sml_security_events',
				array(
					'user_id'    => (int) $user_id,
					'event_type' => substr( $type, 0, 40 ),
					'ip_address' => $this->client_ip(),
					'user_agent' => substr( (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' ), 0, 255 ),
					'detail'     => $detail ? substr( $detail, 0, 500 ) : null,
					'created_at' => current_time( 'mysql', true ),
				),
				array( '%d', '%s', '%s', '%s', '%s', '%s' )
			);
		}

		/**
		 * Client IP behind a proxy.
		 *
		 * X-Forwarded-For is client-controlled and can be spoofed, so the
		 * LAST entry is used — the one the edge appended — not the first.
		 */
		private function client_ip() {
			$xff = (string) ( $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '' );
			if ( $xff ) {
				$parts = array_map( 'trim', explode( ',', $xff ) );
				$ip    = end( $parts );
				if ( filter_var( $ip, FILTER_VALIDATE_IP ) ) {
					return $ip;
				}
			}
			$ip = (string) ( $_SERVER['REMOTE_ADDR'] ?? '' );
			return filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : null;
		}

		private function rate_ok( $bucket, $user_id, $max, $window ) {
			$key   = 'sml_rl_' . $bucket . '_' . (int) $user_id;
			$count = (int) get_transient( $key );
			if ( $count >= $max ) {
				return false;
			}
			set_transient( $key, $count + 1, $window );
			return true;
		}

		private function err( $code, $message, $status ) {
			return new WP_Error( 'sml_' . $code, $message, array( 'status' => $status ) );
		}
	}

	if ( ! function_exists( 'sml_settings_email_allowed' ) ) {
		/** Master email switch from /settings/ → Notifications. Security emails never go through here. */
		function sml_settings_email_allowed( $user_id, $kind = '' ) {
			$user_id = (int) $user_id;
			if ( '0' === get_user_meta( $user_id, 'sml_notify_email', true ) ) { return false; }
			if ( 'qa' === $kind && get_user_meta( $user_id, 'sml_qa_email_off', true ) ) { return false; }
			if ( 'login_alerts' === $kind && '0' === get_user_meta( $user_id, 'sml_2s_login_alerts', true ) ) { return false; }
			return (bool) apply_filters( 'sml_settings_email_allowed', true, $user_id, $kind );
		}
	}

	register_activation_hook( __FILE__, array( 'SML_Settings_V1', 'activate' ) );
	register_deactivation_hook( __FILE__, array( 'SML_Settings_V1', 'deactivate' ) );

	SML_Settings_V1::boot();
}
