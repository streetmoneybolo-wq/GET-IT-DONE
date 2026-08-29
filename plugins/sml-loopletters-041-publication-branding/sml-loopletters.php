<?php
/**
 * Plugin Name:       SML Loop Letters
 * Plugin URI:        https://stockmarketloop.com
 * Description:       Publication setup for creators, and the public letter page at /n/{handle}. Companion to SML Settings Dashboard.
 * Version:           0.4.1
 * Author:            StockMarketLoop
 * License:           GPL-2.0-or-later
 * Requires PHP:      7.4
 *
 * ---------------------------------------------------------------------------
 * DESIGN NOTES
 * ---------------------------------------------------------------------------
 * These follow the conventions sml-settings 1.3.1 established, for the reasons
 * that plugin documents. Three of them are load-bearing here.
 *
 * NO GLOBAL FUNCTIONS. The site runs ~147 WPCode snippets in one shared global
 * namespace, and an unguarded declaration destroyed the groups system once. So
 * everything lives inside a single guarded class, exactly as sml-settings does.
 * Version 0.1.0 of this file declared fifteen global `smll_*` functions; that
 * was the single largest risk in it and is why this rewrite exists.
 *
 * NO REWRITE RULES. sml-settings notes that the groups outage was a stale
 * rewrite cache, and chose a real Page holding a shortcode instead. A public
 * page at /n/{handle} needs a dynamic path segment, which normally means
 * add_rewrite_rule() — the one thing that already broke this site. It is
 * avoided here: the `request` filter rewrites query vars in memory on each
 * request. That is code, not cached database state, so there is nothing to
 * flush and nothing that can go stale. See route_public() below.
 *
 * PAGE CACHE SAFETY, INVERTED. sml-settings renders client-side from /me so a
 * cached page can never serve one member's settings to another. The public
 * letter page is the opposite case: the HTML is identical for every visitor,
 * it needs to be readable by crawlers, and it should survive with JavaScript
 * off. So it renders server-side. The only per-visitor state on it is the
 * subscribe form, which is inert until submitted.
 *
 * @package SML\LoopLetters
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'SML_LoopLetters_V040', false ) ) {

	final class SML_LoopLetters_V040 {

		const VERSION      = '0.4.1';
		const NS           = 'sml-loopletters/v1';
		const PAGE_SLUG    = 'n';
		const DB_VERSION_OPT = 'sml_loopletters_db_version';

		/** Where a creator with a publication lands. */
		const STUDIO_URL   = '/creator-studio/loop-letters/write/';

		/** Meta key holding the handle. Indexed, so handle lookups are one query. */
		const HANDLE_META  = 'smll_handle';

		private static $instance = null;

		/** Resolved from the URL by route_public(), read by the shortcode. */
		private $view = null;

		public static function boot() {
			if ( null === self::$instance ) {
				self::$instance = new self();
			}
			return self::$instance;
		}

		private function __construct() {
			add_action( 'rest_api_init', array( $this, 'routes' ) );
			add_action( 'admin_init', array( 'SML_LoopLetters_Subscriptions_V031', 'maybe_upgrade' ) );

			// Public page. The filter runs before the main query, so a match
			// turns into a normal Page request that WordPress serves as a 200.
			add_filter( 'request', array( $this, 'route_public' ) );
			add_shortcode( 'sml_letter_page', array( $this, 'render_public' ) );

			// Creator Studio setup wizard.
			add_shortcode( 'loop_letter_setup', array( $this, 'render_setup' ) );
			add_action( 'wp_enqueue_scripts', array( $this, 'enqueue' ) );
			add_action( 'template_redirect', array( $this, 'maybe_route_landing' ), 5 );
			add_filter( 'body_class', array( $this, 'body_class' ) );
			add_action( 'wp_head', array( $this, 'route_css' ), 99 );

			// Keep the handle index in step with whatever wrote the settings.
			add_action( 'sml_letters_settings_saved', array( $this, 'index_handle' ) );

			// Confirmation links arrive as plain GETs, not REST calls — a link in
			// an email cannot carry a nonce header.
			add_action( 'template_redirect', array( 'SML_LoopLetters_Subscriptions_V031', 'handle_request' ), 4 );
		}

		// ===================================================================
		// Activation
		// ===================================================================

		public static function activate() {
			self::install_tables();
			if ( is_callable( array( 'SML_LoopLetters_Subscriptions_V031', 'install' ) ) ) {
				SML_LoopLetters_Subscriptions_V031::install();
			}
			self::ensure_page();
		}

		private static function install_tables() {
			global $wpdb;
			require_once ABSPATH . 'wp-admin/includes/upgrade.php';

			$table   = $wpdb->prefix . 'sml_letter_subscribers';
			$charset = $wpdb->get_charset_collate();

			// UNIQUE on (publication_user_id, email) is what makes a repeated
			// subscribe idempotent instead of creating duplicate rows — people
			// double-click, and mail clients pre-fetch links.
			$sql = "CREATE TABLE {$table} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				publication_user_id BIGINT UNSIGNED NOT NULL,
				email VARCHAR(190) NOT NULL,
				status VARCHAR(20) NOT NULL DEFAULT 'pending',
				token CHAR(64) NULL,
				source VARCHAR(60) NULL,
				created_at DATETIME NOT NULL,
				confirmed_at DATETIME NULL,
				PRIMARY KEY (id),
				UNIQUE KEY pub_email (publication_user_id, email),
				KEY pub_status (publication_user_id, status),
				KEY token (token)
			) {$charset};";

			dbDelta( $sql );
			update_option( self::DB_VERSION_OPT, self::VERSION );
		}

		/**
		 * The /n/ page must exist as a real Page.
		 *
		 * route_public() rewrites /n/{handle} to this page, so it is the thing
		 * WordPress actually resolves and renders. Same reasoning as
		 * sml-settings' /settings page: a Page needs no flush and cannot be
		 * lost to a stale rewrite cache.
		 */
		private static function ensure_page() {
			$existing = get_page_by_path( self::PAGE_SLUG );
			if ( $existing && 'trash' !== $existing->post_status ) {
				return;
			}
			wp_insert_post( array(
				'post_title'     => 'Letters',
				'post_name'      => self::PAGE_SLUG,
				'post_content'   => '[sml_letter_page]',
				'post_status'    => 'publish',
				'post_type'      => 'page',
				'comment_status' => 'closed',
				'ping_status'    => 'closed',
			) );
		}

		// ===================================================================
		// Letter storage
		// ===================================================================

		/**
		 * Letters are a post type so they inherit the editor, autosave,
		 * revisions and scheduled publishing — all of which a newsletter needs
		 * and none of which is worth rebuilding on a custom table.
		 *
		 * publicly_queryable is false on purpose. If WordPress served these at
		 * /sml_letter/{slug} there would be two URLs for one letter, which
		 * splits shares and confuses crawlers. /n/{handle}/{slug} is the only
		 * public address, and it is produced here.
		 */
		// ===================================================================
		// Publication settings
		// ===================================================================
		//
		// Stored as individual user meta rows rather than one serialised blob.
		// A blob cannot be queried, and the handle has to be: get_users() with
		// a meta_key lookup is a single indexed query, while finding a handle
		// inside serialised data means unserialising every user on the site.

		/**
		 * @return array Always the full shape, with defaults filled in, so no
		 *               caller has to null-check individual keys.
		 */
		public function get_publication( $user_id = 0 ) {
			$user_id = $user_id ? (int) $user_id : get_current_user_id();
			if ( ! $user_id ) {
				return array();
			}

			$user = get_userdata( $user_id );
			if ( ! $user ) {
				return array();
			}

			$handle = (string) get_user_meta( $user_id, self::HANDLE_META, true );
			$sections = (array) get_user_meta( $user_id, 'smll_sections', true );
			$section_defaults = array(
				'hero' => true, 'about' => true, 'social' => true,
				'featured' => true, 'topics' => true,
			);
			$sections = wp_parse_args( $sections, $section_defaults );

			$logo_image_id       = absint( get_user_meta( $user_id, 'smll_logo_image_id', true ) );
			$background_image_id = absint( get_user_meta( $user_id, 'smll_background_image_id', true ) );

			return array(
				'userId'      => $user_id,
				'name'        => (string) get_user_meta( $user_id, 'smll_name', true ),
				'handle'      => $handle,
				'tagline'     => (string) get_user_meta( $user_id, 'smll_tagline', true ),
				'topics'      => array_values( (array) get_user_meta( $user_id, 'smll_topics', true ) ),
				'cadence'     => (string) get_user_meta( $user_id, 'smll_cadence', true ),
				'visibility'  => (string) get_user_meta( $user_id, 'smll_visibility', true ) ?: 'public',
				'welcome_subject' => (string) get_user_meta( $user_id, 'smll_welcome_subject', true ),
				'welcome_body'    => (string) get_user_meta( $user_id, 'smll_welcome_body', true ),
				'onboarded'   => '1' === get_user_meta( $user_id, 'smll_onboarded', true ),
				'authorName'  => $user->display_name,
				'authorAvatar'=> get_avatar_url( $user_id, array( 'size' => 96 ) ),
				'publicUrl'   => $handle ? home_url( '/' . self::PAGE_SLUG . '/' . $handle . '/' ) : '',
				'accent'      => (string) get_user_meta( $user_id, 'smll_accent', true ) ?: '#00ff88',
				'font'        => (string) get_user_meta( $user_id, 'smll_font', true ) ?: 'grotesk',
				'layout'      => (string) get_user_meta( $user_id, 'smll_layout', true ) ?: 'list',
				'logo'        => (string) get_user_meta( $user_id, 'smll_logo', true ),
				'logoImageId' => $logo_image_id,
				'logoImageUrl'=> $logo_image_id ? (string) wp_get_attachment_image_url( $logo_image_id, 'medium' ) : '',
				'backgroundImageId' => $background_image_id,
				'backgroundImageUrl'=> $background_image_id ? (string) wp_get_attachment_image_url( $background_image_id, 'full' ) : '',
				'sections'    => array_map( 'rest_sanitize_boolean', $sections ),
				'signup_copy' => (string) get_user_meta( $user_id, 'smll_signup_copy', true ) ?: 'Sign up now to get access to the library of members-only issues.',
				'signup_button' => (string) get_user_meta( $user_id, 'smll_signup_button', true ) ?: 'Subscribe',
				'footer_note' => (string) get_user_meta( $user_id, 'smll_footer_note', true ) ?: 'Powered by Loop Hub',
				'social_x' => (string) get_user_meta( $user_id, 'smll_social_x', true ),
				'social_youtube' => (string) get_user_meta( $user_id, 'smll_social_youtube', true ),
				'social_discord' => (string) get_user_meta( $user_id, 'smll_social_discord', true ),
			);
		}

		/**
		 * A publication is set up once it has both a name and a handle. Those
		 * are the two things every downstream link needs, so anything less
		 * would produce broken URLs.
		 */
		public function has_publication( $user_id = 0 ) {
			$pub = $this->get_publication( $user_id );
			return ! empty( $pub['name'] ) && ! empty( $pub['handle'] );
		}

		/** Handles the platform needs for its own routes. */
		private function reserved_handles() {
			return apply_filters( 'sml_letters_reserved_handles', array(
				'admin', 'api', 'app', 'creator-studio', 'dashboard', 'feed', 'go-live',
				'groups', 'help', 'letters', 'login', 'loop', 'loop-letters', 'me',
				'n', 'new', 'news', 'settings', 'signup', 'stocks', 'support',
				'ticker', 'upload-video', 'watch', 'wp-admin', 'wp-json',
			) );
		}

		/** @return int Owning user ID, or 0. */
		private function handle_owner( $handle ) {
			$users = get_users( array(
				'meta_key'   => self::HANDLE_META,
				'meta_value' => $handle,
				'number'     => 1,
				'fields'     => 'ID',
			) );
			return $users ? (int) $users[0] : 0;
		}

		public function index_handle( $user_id = 0 ) {
			$user_id = $user_id ? (int) $user_id : get_current_user_id();
			if ( ! $user_id ) {
				return;
			}
			$handle = sanitize_title( (string) get_user_meta( $user_id, 'smll_handle_raw', true ) );
			if ( $handle ) {
				update_user_meta( $user_id, self::HANDLE_META, $handle );
			}
		}

		// ===================================================================
		// Public routing — no rewrite rules
		// ===================================================================

		/**
		 * Map /n/{handle} and /n/{handle}/{letter} onto the /n/ Page.
		 *
		 * The request path is read directly rather than inspecting parsed query
		 * vars, because how WordPress parses /n/handle/ depends on the site's
		 * permalink structure — with %postname% it goes through verbose page
		 * rules and lands in `pagename`, with other structures it may not. The
		 * raw path is the same under every structure.
		 *
		 * On no match the vars are returned untouched, so any URL that is not
		 * ours behaves exactly as it does today.
		 *
		 * @param array $vars Query vars WordPress is about to run.
		 * @return array
		 */
		public function route_public( $vars ) {
			if ( is_admin() || wp_doing_ajax() ) {
				return $vars;
			}

			$path = $this->request_path();
			if ( '' === $path ) {
				return $vars;
			}

			$base = self::PAGE_SLUG;

			// /n/{handle}[/{letter}]
			if ( ! preg_match( '#^' . preg_quote( $base, '#' ) . '/([^/]+)(?:/([^/]+))?/?$#', $path, $m ) ) {
				// Query-string fallback: /n/?h=handle&l=letter.
				// Kept deliberately — if pretty permalinks are ever off, or a
				// host mangles path routing, this URL still resolves. Nothing
				// links to it, it is a floor to fall back to.
				if ( $base === untrailingslashit( $path ) && isset( $_GET['h'] ) ) {
					$m = array(
						'',
						sanitize_title( wp_unslash( $_GET['h'] ) ),
						isset( $_GET['l'] ) ? sanitize_title( wp_unslash( $_GET['l'] ) ) : '',
					);
				} else {
					return $vars;
				}
			}

			$handle = sanitize_title( $m[1] );
			$letter = isset( $m[2] ) ? sanitize_title( $m[2] ) : '';

			if ( '' === $handle ) {
				return $vars;
			}

			$owner = $this->handle_owner( $handle );
			if ( ! $owner ) {
				// Unknown handle stays a 404 rather than rendering an empty
				// publication — a soft 404 is worse than a real one, both for
				// the reader and for anything crawling the site.
				return $vars;
			}

			$this->view = array(
				'handle' => $handle,
				'letter' => $letter,
				'owner'  => $owner,
			);

			// Hand WordPress the real Page. From here it is an ordinary page
			// request: 200, theme template, wp_head/wp_footer, everything.
			return array( 'pagename' => $base );
		}

		/** Request path relative to the WordPress root, no leading/trailing slash. */
		private function request_path() {
			$uri = isset( $_SERVER['REQUEST_URI'] )
				? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) )
				: '';
			$path = (string) wp_parse_url( $uri, PHP_URL_PATH );

			// Subdirectory installs: strip the site's own base path first.
			$home = (string) wp_parse_url( home_url(), PHP_URL_PATH );
			if ( $home && '/' !== $home && 0 === strpos( $path, $home ) ) {
				$path = substr( $path, strlen( $home ) );
			}

			return trim( $path, '/' );
		}

		// ===================================================================
		// Public page rendering
		// ===================================================================

		public function render_public() {
			if ( ! $this->view ) {
				return $this->render_directory();
			}

			$pub = $this->get_publication( $this->view['owner'] );
			if ( empty( $pub['handle'] ) ) {
				return '';
			}

			return $this->view['letter']
				? $this->render_single( $pub, $this->view['letter'] )
				: $this->render_publication( $pub );
		}

		/** The publication front page: who this is, and everything they've sent. */
		private function render_publication( $pub ) {
			if ( is_callable( array( 'SML_LoopLetters_Home_V040', 'render' ) ) ) {
				return SML_LoopLetters_Home_V040::render( $pub );
			}
			return '<div class="ll-empty"><h2 class="ll-empty__title">Publication unavailable</h2>'
				. '<p class="ll-empty__body">Please refresh and try again.</p></div>';
		}

		private function render_list_item( $pub, $letter ) {
			$url = home_url( '/' . self::PAGE_SLUG . '/' . $pub['handle'] . '/' . $letter->post_name . '/' );

			$excerpt = $letter->post_excerpt
				? $letter->post_excerpt
				: wp_trim_words( wp_strip_all_tags( strip_shortcodes( $letter->post_content ) ), 34, '…' );

			return '<li class="ll-list__item">'
				. '<a class="ll-list__link" href="' . esc_url( $url ) . '">'
				. '<time class="ll-list__date" datetime="' . esc_attr( get_the_date( 'c', $letter ) ) . '">'
				. esc_html( get_the_date( 'M j, Y', $letter ) ) . '</time>'
				. '<h3 class="ll-list__title">' . esc_html( get_the_title( $letter ) ) . '</h3>'
				. '<p class="ll-list__excerpt">' . esc_html( $excerpt ) . '</p>'
				. '</a></li>';
		}

		private function render_single( $pub, $slug ) {
			$row = null;
			if ( function_exists( 'sml_letters_table' ) ) {
				global $wpdb;
				$table = sml_letters_table( 'posts' );
				$row = $wpdb->get_row( $wpdb->prepare(
					"SELECT * FROM {$table} WHERE author_id = %d AND slug = %s AND status = 'published' LIMIT 1",
					(int) $pub['userId'],
					sanitize_title( $slug )
				), ARRAY_A );
			}

			if ( ! $row ) {
				// Scoped to this author on purpose: two creators may both have
				// a letter called "week-one", and each should resolve under its
				// own handle rather than whichever was published first.
				return '<div class="ll-pub">' . $this->render_header( $pub )
					. '<div class="ll-pub__body"><div class="ll-empty">'
					. '<h2 class="ll-empty__title">That letter is not here</h2>'
					. '<p class="ll-empty__body">It may have been unpublished. '
					. '<a href="' . esc_url( $pub['publicUrl'] ) . '">See every letter →</a></p>'
					. '</div></div></div>';
			}

			$letter = function_exists( 'sml_letters_public' )
				? sml_letters_public( $row, true )
				: array();

			$h  = '<div class="ll-pub ll-pub--single">';
			$h .= $this->render_header( $pub, true );
			$h .= '<article class="ll-letter">';
			$published = ! empty( $row['published_at'] ) ? strtotime( $row['published_at'] . ' UTC' ) : false;
			$h .= '<time class="ll-letter__date" datetime="' . esc_attr( $published ? wp_date( 'c', $published ) : '' ) . '">'
				. esc_html( $published ? wp_date( 'F j, Y', $published ) : '' ) . '</time>';
			$h .= '<h1 class="ll-letter__title">' . esc_html( (string) ( $letter['title'] ?? $row['title'] ) ) . '</h1>';
			$h .= '<div class="ll-letter__body">' . wp_kses_post( (string) ( $letter['html'] ?? '' ) ) . '</div>';

			$h .= '</article>';
			$h .= $this->render_subscribe( $pub, 'letter-foot' );
			$h .= '</div>';

			return $h;
		}

		private function render_header( $pub, $compact = false ) {
			$topics = '';
			if ( ! empty( $pub['topics'] ) ) {
				$topics = '<ul class="ll-topics">';
				foreach ( array_slice( $pub['topics'], 0, 6 ) as $t ) {
					$topics .= '<li class="ll-topics__item">' . esc_html( $t ) . '</li>';
				}
				$topics .= '</ul>';
			}

			$cadence = $pub['cadence']
				? '<span class="ll-head__cadence">' . esc_html( $pub['cadence'] ) . '</span>'
				: '';

			$h  = '<header class="ll-head' . ( $compact ? ' ll-head--compact' : '' ) . '">';
			$h .= '<a class="ll-head__id" href="' . esc_url( $pub['publicUrl'] ) . '">';
			$h .= '<img class="ll-head__avatar" src="' . esc_url( $pub['authorAvatar'] ) . '" alt="" width="56" height="56" />';
			$h .= '<span class="ll-head__names">';
			$h .= '<span class="ll-head__name">' . esc_html( $pub['name'] ) . '</span>';
			$h .= '<span class="ll-head__by">by ' . esc_html( $pub['authorName'] ) . '</span>';
			$h .= '</span></a>';

			if ( ! $compact ) {
				if ( $pub['tagline'] ) {
					$h .= '<p class="ll-head__tagline">' . esc_html( $pub['tagline'] ) . '</p>';
				}
				$h .= $cadence . $topics;
				$h .= $this->render_subscribe( $pub, 'head' );
			}

			$h .= '</header>';
			return $h;
		}

		/**
		 * A plain form with a real action, progressively enhanced.
		 *
		 * It posts to the REST route via fetch when JavaScript is available and
		 * falls back to a normal submission when it is not — an email capture
		 * that silently fails without JS is worse than no form.
		 */
		private function render_subscribe( $pub, $where ) {
			$action = esc_url( rest_url( self::NS . '/subscribe' ) );

			return '<form class="ll-sub" data-ll-subscribe method="post" action="' . $action . '">'
				. '<input type="hidden" name="handle" value="' . esc_attr( $pub['handle'] ) . '" />'
				. '<input type="hidden" name="source" value="' . esc_attr( $where ) . '" />'
				. '<label class="ll-sub__label" for="ll-email-' . esc_attr( $where ) . '">Your email</label>'
				. '<div class="ll-sub__row">'
				. '<input class="ll-sub__input" id="ll-email-' . esc_attr( $where ) . '" type="email" name="email"'
				. ' required autocomplete="email" placeholder="you@example.com" />'
				. '<button class="ll-sub__btn" type="submit">Subscribe</button>'
				. '</div>'
				. '<p class="ll-sub__note" data-ll-status>Free. One click to unsubscribe.</p>'
				. '</form>';
		}

		/** /n/ with no handle — a plain index rather than a 404. */
		private function render_directory() {
			$users = get_users( array(
				'meta_key' => self::HANDLE_META,
				'number'   => 50,
				'fields'   => 'ID',
			) );

			$h = '<div class="ll-pub"><header class="ll-head">'
				. '<h1 class="ll-head__name">Loop Letters</h1>'
				. '<p class="ll-head__tagline">Market analysis, written by people who trade it.</p>'
				. '</header><div class="ll-pub__body">';

			if ( ! $users ) {
				$h .= '<div class="ll-empty"><h2 class="ll-empty__title">No publications yet</h2></div>';
			} else {
				$h .= '<ul class="ll-dir">';
				foreach ( $users as $uid ) {
					$p = $this->get_publication( $uid );
					if ( empty( $p['name'] ) ) {
						continue;
					}
					$h .= '<li class="ll-dir__item"><a class="ll-dir__link" href="' . esc_url( $p['publicUrl'] ) . '">'
						. '<img class="ll-dir__avatar" src="' . esc_url( $p['authorAvatar'] ) . '" alt="" width="40" height="40" />'
						. '<span><span class="ll-dir__name">' . esc_html( $p['name'] ) . '</span>'
						. '<span class="ll-dir__by">by ' . esc_html( $p['authorName'] ) . '</span></span>'
						. '</a></li>';
				}
				$h .= '</ul>';
			}

			return $h . '</div></div>';
		}

		// ===================================================================
		// Creator Studio setup wizard
		// ===================================================================

		private function is_letters_screen() {
			$path = $this->request_path();
			return ( 0 === strpos( $path, 'creator-studio/loop-letters' ) || 0 === strpos( $path, 'loop-letters' ) );
		}

		private function is_landing() {
			return ( 'loop-letters' === $this->request_path() );
		}

		/** Bare /n/ — the directory, which needs the same stylesheet. */
		private function is_public_page() {
			return ( self::PAGE_SLUG === $this->request_path() );
		}

		public function enqueue() {
			// Public page assets are enqueued here rather than from inside the
			// shortcode. A stylesheet enqueued during the_content is printed by
			// print_late_styles() in the footer, which means the letter paints
			// unstyled first — the `request` filter has already resolved the
			// view by this point, so the decision can be made in wp_head time.
			if ( $this->view || $this->is_public_page() ) {
				wp_enqueue_style(
					'smll-fonts',
					'https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;600;700&family=Inter:wght@400;500;600;700;800&family=Lora:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=Merriweather:wght@400;700&family=Montserrat:wght@400;500;600;700;800&family=Playfair+Display:wght@400;600;700&family=Poppins:wght@400;500;600;700&family=Roboto+Slab:wght@400;600;700&family=Space+Grotesk:wght@500;600;700&display=swap',
					array(),
					null
				);
				if ( $this->view && empty( $this->view['letter'] ) ) {
					wp_enqueue_style( 'sml-letter-home', SMLL_URL_HELPER . 'assets/letter-home.css', array(), self::VERSION );
					wp_enqueue_script( 'sml-letter-home', SMLL_URL_HELPER . 'assets/letter-home.js', array(), self::VERSION, true );
					wp_localize_script( 'sml-letter-home', 'SMLLetterHome', array(
						'rest'   => esc_url_raw( rest_url( self::NS ) ),
						'nonce'  => wp_create_nonce( 'wp_rest' ),
						'handle' => $this->view['handle'],
						'canEdit'=> is_user_logged_in() && get_current_user_id() === (int) $this->view['owner'],
					) );
				} else {
					wp_enqueue_style( 'sml-letter-public', SMLL_URL_HELPER . 'assets/letter-public.css', array(), self::VERSION );
					wp_enqueue_script( 'sml-letter-public', SMLL_URL_HELPER . 'assets/letter-public.js', array(), self::VERSION, true );
					wp_localize_script( 'sml-letter-public', 'SMLLetterPublic', array(
						'rest'   => esc_url_raw( rest_url( self::NS ) ),
						'nonce'  => wp_create_nonce( 'wp_rest' ),
						'handle' => $this->view ? $this->view['handle'] : '',
					) );
				}
			}

			if ( ! $this->is_letters_screen() ) {
				return;
			}

			wp_enqueue_style( 'smll-letters-setup', SMLL_URL_HELPER . 'assets/letters-setup.css', array(), self::VERSION );
			wp_enqueue_script( 'smll-letters-setup', SMLL_URL_HELPER . 'assets/letters-setup.js', array(), self::VERSION, true );

			wp_localize_script( 'smll-letters-setup', 'SMLLetters', array(
				'rest'   => esc_url_raw( rest_url( self::NS . '/' ) ),
				'nonce'  => wp_create_nonce( 'wp_rest' ),
				'site'   => wp_parse_url( home_url(), PHP_URL_HOST ),
				'base'   => '/' . self::PAGE_SLUG . '/',
				'studio' => self::STUDIO_URL,
			) );
		}

		public function render_setup() {
			if ( ! is_user_logged_in() ) {
				return '';
			}
			if ( $this->has_publication() && ! isset( $_GET['edit'] ) ) {
				return '';
			}
			return '<div id="ls-setup-root" class="smll-setup-root"></div>';
		}

		private function route_state() {
			if ( ! is_user_logged_in() ) {
				return 'marketing';
			}
			return $this->has_publication() ? 'dashboard' : 'setup';
		}

		/**
		 * ?stay=1 opts out, so the marketing page stays reachable for a creator
		 * who wants to see what a non-subscriber sees — and so this is
		 * debuggable without signing out.
		 */
		public function maybe_route_landing() {
			if ( is_admin() || wp_doing_ajax() || ! $this->is_landing() ) {
				return;
			}
			if ( isset( $_GET['stay'] ) ) {
				return;
			}
			if ( 'dashboard' === $this->route_state() ) {
				wp_safe_redirect( self::STUDIO_URL, 302 );
				exit;
			}
		}

		public function body_class( $classes ) {
			if ( $this->is_landing() && 'setup' === $this->route_state() ) {
				$classes[] = 'smll-mode-setup';
			}
			return $classes;
		}

		public function route_css() {
			if ( ! $this->is_landing() ) {
				return;
			}
			echo '<style id="smll-route-css">'
				. 'body.smll-mode-setup .hero,body.smll-mode-setup .value-strip,'
				. 'body.smll-mode-setup #reading,body.smll-mode-setup #tickers,'
				. 'body.smll-mode-setup #analysts,body.smll-mode-setup #how,'
				. 'body.smll-mode-setup #income{display:none !important}'
				. 'body.smll-mode-setup .smll-setup-root{display:block}'
				. '.smll-setup-root:empty{min-height:60vh}'
				. '</style>';
		}

		// ===================================================================
		// REST
		// ===================================================================

		public function routes() {
			register_rest_route( self::NS, '/settings', array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_settings' ),
					'permission_callback' => array( $this, 'require_login' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'save_settings' ),
					'permission_callback' => array( $this, 'require_login' ),
				),
			) );

			register_rest_route( self::NS, '/handle-available', array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'check_handle' ),
				'permission_callback' => array( $this, 'require_login' ),
				'args'                => array(
					'handle' => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_title',
					),
				),
			) );

			// Public: anyone can subscribe, that is the entire point.
			register_rest_route( self::NS, '/subscribe', array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'subscribe' ),
				'permission_callback' => '__return_true',
			) );

			if ( is_callable( array( 'SML_LoopLetters_Subscriptions_V031', 'register_routes' ) ) ) {
				SML_LoopLetters_Subscriptions_V031::register_routes( self::NS );
			}
			if ( is_callable( array( 'SML_LoopLetters_Home_V040', 'register_routes' ) ) ) {
				SML_LoopLetters_Home_V040::register_routes( self::NS );
			}
		}

		public function require_login() {
			return is_user_logged_in()
				? true
				: new WP_Error( 'smll_unauthorized', 'You must be signed in.', array( 'status' => 401 ) );
		}

		public function get_settings() {
			return rest_ensure_response( $this->get_publication() );
		}

		public function save_settings( WP_REST_Request $req ) {
			$id      = get_current_user_id();
			$name    = trim( (string) $req->get_param( 'name' ) );
			$handle  = sanitize_title( (string) $req->get_param( 'handle' ) );
			$tagline = trim( (string) $req->get_param( 'tagline' ) );
			$cadence = (string) $req->get_param( 'cadence' );
			$topics  = (array) $req->get_param( 'topics' );

			if ( '' === $name || mb_strlen( $name ) > 60 ) {
				return $this->err( 'invalid_name', 'Publication name must be 1–60 characters.', 422 );
			}
			if ( mb_strlen( $tagline ) > 160 ) {
				return $this->err( 'invalid_tagline', 'Tagline must be 160 characters or fewer.', 422 );
			}
			if ( strlen( $handle ) < 3 ) {
				return $this->err( 'invalid_handle', 'Handle must be at least 3 characters.', 422 );
			}
			if ( in_array( $handle, $this->reserved_handles(), true ) ) {
				return $this->err( 'handle_reserved', 'That handle is reserved.', 409 );
			}

			$owner = $this->handle_owner( $handle );
			if ( $owner && $owner !== $id ) {
				return $this->err( 'handle_taken', 'That handle is already in use.', 409 );
			}

			$topics = array_slice( array_values( array_filter( array_map(
				function ( $t ) {
					return sanitize_text_field( (string) $t );
				},
				$topics
			) ) ), 0, 6 );

			update_user_meta( $id, 'smll_name', sanitize_text_field( $name ) );
			update_user_meta( $id, 'smll_tagline', sanitize_text_field( $tagline ) );
			update_user_meta( $id, 'smll_cadence', sanitize_text_field( $cadence ) );
			update_user_meta( $id, 'smll_topics', $topics );

			// The welcome email is stored even though nothing sends it yet. The
			// wizard asks for it on the last step, and losing something a
			// creator typed is worse than storing a field early — when the
			// sender lands it will find the copy already written.
			$vis = (string) $req->get_param( 'visibility' );
			update_user_meta( $id, 'smll_visibility',
				in_array( $vis, array( 'public', 'subscribers', 'paid' ), true ) ? $vis : 'public' );
			update_user_meta( $id, 'smll_welcome_subject',
				sanitize_text_field( (string) $req->get_param( 'welcome_subject' ) ) );
			update_user_meta( $id, 'smll_welcome_body',
				sanitize_textarea_field( (string) $req->get_param( 'welcome_body' ) ) );

			// These fields were added after the original setup wizard shipped.
			// Only write fields present in the request so that the older wizard
			// cannot erase a creator's publication design on its next save.
			if ( $req->has_param( 'accent' ) ) {
				$accent = strtolower( (string) $req->get_param( 'accent' ) );
				$allowed_accents = array( '#00ff88', '#00ccff', '#ffb020', '#ff5c7a', '#b98cff' );
				update_user_meta( $id, 'smll_accent', in_array( $accent, $allowed_accents, true ) ? $accent : '#00ff88' );
			}
			if ( $req->has_param( 'font' ) ) {
				$font = (string) $req->get_param( 'font' );
				$allowed_fonts = array( 'grotesk', 'serif', 'archivo', 'inter', 'manrope', 'poppins', 'montserrat', 'dm-sans', 'playfair', 'merriweather', 'lora', 'roboto-slab' );
				update_user_meta( $id, 'smll_font', in_array( $font, $allowed_fonts, true ) ? $font : 'grotesk' );
			}
			if ( $req->has_param( 'layout' ) ) {
				$layout = (string) $req->get_param( 'layout' );
				update_user_meta( $id, 'smll_layout', in_array( $layout, array( 'list', 'grid', 'magazine' ), true ) ? $layout : 'list' );
			}
			if ( $req->has_param( 'logo' ) ) {
				$logo = strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', (string) $req->get_param( 'logo' ) ) );
				update_user_meta( $id, 'smll_logo', substr( $logo, 0, 2 ) );
			}
			if ( $req->has_param( 'sections' ) ) {
				$section_input = (array) $req->get_param( 'sections' );
				$sections = array();
				foreach ( array( 'hero', 'about', 'social', 'featured', 'topics' ) as $section ) {
					$sections[ $section ] = isset( $section_input[ $section ] )
						? rest_sanitize_boolean( $section_input[ $section ] )
						: true;
				}
				update_user_meta( $id, 'smll_sections', $sections );
			}
			foreach ( array( 'signup_copy', 'signup_button', 'footer_note' ) as $field ) {
				if ( ! $req->has_param( $field ) ) {
					continue;
				}
				$value = 'signup_copy' === $field
					? sanitize_textarea_field( (string) $req->get_param( $field ) )
					: sanitize_text_field( (string) $req->get_param( $field ) );
				$limit = 'signup_button' === $field ? 28 : ( 'footer_note' === $field ? 80 : 240 );
				update_user_meta( $id, 'smll_' . $field, substr( $value, 0, $limit ) );
			}
			foreach ( array( 'x', 'youtube', 'discord' ) as $network ) {
				if ( $req->has_param( 'social_' . $network ) ) {
					update_user_meta( $id, 'smll_social_' . $network, esc_url_raw( (string) $req->get_param( 'social_' . $network ) ) );
				}
			}

			update_user_meta( $id, 'smll_onboarded', '1' );

			// Written last: the handle index is what every public URL resolves
			// through, so it should only start pointing at this publication
			// once the rest of the record is actually there.
			update_user_meta( $id, self::HANDLE_META, $handle );

			do_action( 'sml_letters_settings_saved', $id );

			return rest_ensure_response( $this->get_publication( $id ) );
		}

		public function check_handle( WP_REST_Request $req ) {
			$handle = sanitize_title( (string) $req->get_param( 'handle' ) );

			if ( strlen( $handle ) < 3 ) {
				return rest_ensure_response( array( 'available' => false, 'reason' => 'too_short', 'handle' => $handle ) );
			}
			if ( in_array( $handle, $this->reserved_handles(), true ) ) {
				return rest_ensure_response( array( 'available' => false, 'reason' => 'reserved', 'handle' => $handle ) );
			}

			$owner = $this->handle_owner( $handle );
			$mine  = ( $owner && $owner === get_current_user_id() );

			return rest_ensure_response( array(
				'available' => ( ! $owner || $mine ),
				'reason'    => ( $owner && ! $mine ) ? 'taken' : '',
				'handle'    => $handle,
			) );
		}

		/**
		 * Subscribe — double opt-in.
		 *
		 * Single opt-in on a public form means anyone can sign anyone else up,
		 * and it poisons deliverability for the whole domain, not just the one
		 * publication. The address is stored as `pending` and only counts once
		 * the owner of the inbox clicks the link.
		 *
		 * The response is deliberately identical whether the address was new,
		 * already pending, or already confirmed. Different responses would turn
		 * this into an oracle for "is this person subscribed to that analyst",
		 * which is nobody's business.
		 */
		public function subscribe( WP_REST_Request $req ) {
			global $wpdb;

			$handle = sanitize_title( (string) $req->get_param( 'handle' ) );
			$email  = sanitize_email( (string) $req->get_param( 'email' ) );
			$source = substr( sanitize_text_field( (string) $req->get_param( 'source' ) ), 0, 60 );

			$done = rest_ensure_response( array(
				'ok'      => true,
				'message' => 'Check your inbox to confirm.',
			) );

			if ( ! is_email( $email ) ) {
				return $this->err( 'invalid_email', 'That does not look like a valid email address.', 422 );
			}

			$owner = $this->handle_owner( $handle );
			if ( ! $owner ) {
				return $this->err( 'unknown_publication', 'That publication does not exist.', 404 );
			}

			// Rate limited on the address, not the IP: shared networks and
			// mobile carriers put thousands of legitimate readers behind one
			// address, and blocking those is worse than the abuse it prevents.
			$rl = 'smll_sub_' . md5( strtolower( $email ) );
			$hits = (int) get_transient( $rl );
			if ( $hits >= 5 ) {
				return $done; // Same shape as success — no signal to a prober.
			}
			set_transient( $rl, $hits + 1, HOUR_IN_SECONDS );

			$table = $wpdb->prefix . 'sml_letter_subscribers';
			$token = bin2hex( random_bytes( 32 ) );

			$existing = $wpdb->get_row( $wpdb->prepare(
				"SELECT id, status FROM {$table} WHERE publication_user_id = %d AND email = %s",
				$owner,
				$email
			) );

			if ( $existing && 'confirmed' === $existing->status ) {
				return $done;
			}

			if ( $existing ) {
				// Re-issue rather than reuse: a token sitting in an old email
				// should stop working once a newer one is sent.
				$wpdb->update(
					$table,
					array( 'token' => $token, 'created_at' => current_time( 'mysql', true ) ),
					array( 'id' => (int) $existing->id ),
					array( '%s', '%s' ),
					array( '%d' )
				);
			} else {
				$wpdb->insert(
					$table,
					array(
						'publication_user_id' => $owner,
						'email'               => $email,
						'status'              => 'pending',
						'token'               => $token,
						'source'              => $source,
						'created_at'          => current_time( 'mysql', true ),
					),
					array( '%d', '%s', '%s', '%s', '%s', '%s' )
				);
			}

			$pub  = $this->get_publication( $owner );
			$link = add_query_arg(
				array( 'smll_confirm' => $token ),
				home_url( '/' . self::PAGE_SLUG . '/' . $handle . '/' )
			);

			wp_mail(
				$email,
				'Confirm your subscription to ' . $pub['name'],
				"Confirm your subscription to {$pub['name']}:\n\n{$link}\n\n"
				. "If you did not request this, ignore this email and nothing will be sent."
			);

			return $done;
		}

		private function err( $code, $message, $status ) {
			return new WP_Error( 'smll_' . $code, $message, array( 'status' => $status ) );
		}
	}

	// Asset URL. A constant rather than a method call so it resolves once, and
	// is defined before boot() so the class can use it.
	if ( ! defined( 'SMLL_URL_HELPER' ) ) {
		define( 'SMLL_URL_HELPER', plugin_dir_url( __FILE__ ) );
	}

	// Existing installations already have the page and base table. The
	// additive subscriber schema upgrade runs through admin_init below.

	require_once __DIR__ . '/includes/class-smll-subscriptions.php';
	require_once __DIR__ . '/includes/class-smll-home.php';
	if ( is_callable( array( 'SML_LoopLetters_Home_V040', 'init' ) ) ) {
		SML_LoopLetters_Home_V040::init();
	}

	SML_LoopLetters_V040::boot();
}
