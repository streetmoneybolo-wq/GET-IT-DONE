<?php
/**
 * SML Loop Letters — real SEO for public letters (Phase 2).
 *
 * Install as ONE WPCode PHP snippet: Auto Insert / Run Everywhere.
 *
 * Loop letters live in a CUSTOM TABLE ({prefix}sml_letters_posts), NOT wp_posts,
 * so Rank Math never sees them and the public letter page (/n/{handle}/{slug})
 * ships only the generic shortcode-page <head>. This snippet gives each published
 * letter a real, per-letter <head>: title, description, canonical, Open Graph,
 * X/Twitter cards, and NewsArticle JSON-LD — driven by the fields the creator
 * fills in the writer's SEO/Meta steps.
 *
 * Storage: {prefix}sml_letters_seo (letter_id PK, data JSON). Writer saves via
 * the gated REST route below; the wp_head hook reads it on the public page.
 *
 * NO GLOBAL FUNCTIONS (the site runs ~147 snippets in one namespace) — everything
 * is inside a single guarded class, matching sml-loopletters.php conventions.
 * Uses no eval/base64/ini_set (safe for the merged-eval budget). No top-level return.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! class_exists( 'SML_Letters_SEO' ) ) {

	final class SML_Letters_SEO {

		const VERSION     = '1.0.0';
		const NS          = 'sml-letters-seo/v1';
		const PAGE_SLUG   = 'n';            // /n/{handle}/{slug}
		const HANDLE_META = 'smll_handle';  // matches sml-loopletters.php
		const REST_MAX    = 20000;          // per-letter JSON hard cap (chars)

		/** SEO/Meta fields the writer may set. Anything else is dropped. */
		const FIELDS = array(
			'meta_title', 'meta_desc', 'canonical', 'keyword', 'category', 'schema',
			'tags', 'sentiment', 'og_title', 'og_desc', 'twitter', 'social_image',
			'subject', 'publish_date', 'publish_time',
		);

		private static $resolved = null; // memoized public-page letter row

		public function __construct() {
			add_action( 'init', array( $this, 'install' ), 5 );
			add_action( 'rest_api_init', array( $this, 'routes' ) );
			// Priority 1 so our tags print before the theme's generic ones; the title
			// filter suppresses the default <title> on a resolved letter page.
			add_action( 'wp_head', array( $this, 'render_head' ), 1 );
			add_filter( 'pre_get_document_title', array( $this, 'filter_title' ), 99 );
			add_filter( 'document_title_parts', array( $this, 'filter_title_parts' ), 99 );
		}

		/* ---------------- storage ---------------- */

		private function table() {
			global $wpdb;
			return $wpdb->prefix . 'sml_letters_seo';
		}

		public function install() {
			if ( get_option( 'sml_letters_seo_version' ) === self::VERSION ) { return; }
			global $wpdb;
			require_once ABSPATH . 'wp-admin/includes/upgrade.php';
			$t       = $this->table();
			$charset = $wpdb->get_charset_collate();
			dbDelta( "CREATE TABLE {$t} (
				letter_id BIGINT UNSIGNED NOT NULL,
				data LONGTEXT NULL,
				updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
				updated_at DATETIME NOT NULL,
				PRIMARY KEY (letter_id)
			) $charset;" );
			update_option( 'sml_letters_seo_version', self::VERSION, false );
		}

		private function get_seo( $letter_id ) {
			global $wpdb;
			$json = $wpdb->get_var( $wpdb->prepare(
				"SELECT data FROM {$this->table()} WHERE letter_id = %d", (int) $letter_id ) );
			$data = $json ? json_decode( $json, true ) : array();
			return is_array( $data ) ? $data : array();
		}

		private function put_seo( $letter_id, array $data, $user_id ) {
			global $wpdb;
			$clean = array();
			foreach ( self::FIELDS as $key ) {
				if ( ! isset( $data[ $key ] ) ) { continue; }
				$val = $data[ $key ];
				$clean[ $key ] = is_string( $val ) ? sanitize_text_field( $val ) : '';
			}
			// The two long fields keep newlines; still stripped of tags.
			foreach ( array( 'meta_desc', 'og_desc' ) as $key ) {
				if ( isset( $data[ $key ] ) ) {
					$clean[ $key ] = wp_strip_all_tags( (string) $data[ $key ] );
				}
			}
			if ( isset( $clean['canonical'] ) )    { $clean['canonical']    = esc_url_raw( $clean['canonical'] ); }
			if ( isset( $clean['social_image'] ) ) { $clean['social_image'] = esc_url_raw( $clean['social_image'] ); }
			$json = wp_json_encode( $clean );
			if ( ! is_string( $json ) || strlen( $json ) > self::REST_MAX ) {
				return new WP_Error( 'sml_seo_too_big', 'SEO payload is too large.', array( 'status' => 400 ) );
			}
			$now = current_time( 'mysql', true );
			$wpdb->query( $wpdb->prepare(
				"INSERT INTO {$this->table()} (letter_id, data, updated_by, updated_at) VALUES (%d, %s, %d, %s)
				 ON DUPLICATE KEY UPDATE data = VALUES(data), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)",
				(int) $letter_id, $json, (int) $user_id, $now ) );
			return $clean;
		}

		/* ---------------- letter lookup + ownership ---------------- */

		private function letters_table() {
			if ( function_exists( 'sml_letters_table' ) ) {
				return sml_letters_table( 'posts' );
			}
			global $wpdb;
			return $wpdb->prefix . 'sml_letters_posts';
		}

		/** The author_id that owns a letter row, or 0. */
		private function letter_author( $letter_id ) {
			global $wpdb;
			return (int) $wpdb->get_var( $wpdb->prepare(
				"SELECT author_id FROM {$this->letters_table()} WHERE id = %d", (int) $letter_id ) );
		}

		private function can_edit( $letter_id ) {
			$uid = get_current_user_id();
			if ( ! $uid ) { return false; }
			if ( user_can( $uid, 'manage_options' ) ) { return true; }
			return $this->letter_author( $letter_id ) === $uid;
		}

		/** Resolve the letter row for the current /n/{handle}/{slug} request (or null). */
		private function resolve_public() {
			if ( null !== self::$resolved ) { return self::$resolved ?: null; }
			self::$resolved = false;
			$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
			$path = trim( (string) wp_parse_url( $uri, PHP_URL_PATH ), '/' );
			$home = (string) wp_parse_url( home_url(), PHP_URL_PATH );
			if ( $home && '/' !== $home && 0 === strpos( $path, trim( $home, '/' ) ) ) {
				$path = trim( substr( $path, strlen( trim( $home, '/' ) ) ), '/' );
			}
			if ( ! preg_match( '#^' . self::PAGE_SLUG . '/([^/]+)/([^/]+)/?$#', $path, $m ) ) { return null; }
			$handle = sanitize_title( $m[1] );
			$slug   = sanitize_title( $m[2] );
			$owners = get_users( array(
				'meta_key'   => self::HANDLE_META,
				'meta_value' => $handle,
				'number'     => 1,
				'fields'     => 'ID',
			) );
			$owner = $owners ? (int) $owners[0] : 0;
			if ( ! $owner ) { return null; }
			global $wpdb;
			$row = $wpdb->get_row( $wpdb->prepare(
				"SELECT id, title, subtitle, tldr, cover_url, tags, published_at, updated_at
				 FROM {$this->letters_table()} WHERE author_id = %d AND slug = %s AND status = 'published' LIMIT 1",
				$owner, $slug ), ARRAY_A );
			if ( ! $row ) { return null; }
			$row['handle'] = $handle;
			$row['slug']   = $slug;
			$row['owner']  = $owner;
			self::$resolved = $row;
			return $row;
		}

		/* ---------------- REST ---------------- */

		public function routes() {
			register_rest_route( self::NS, '/letter/(?P<id>\d+)', array(
				array( 'methods' => 'GET',  'callback' => array( $this, 'rest_get' ),  'permission_callback' => 'is_user_logged_in' ),
				array( 'methods' => 'POST', 'callback' => array( $this, 'rest_post' ), 'permission_callback' => 'is_user_logged_in' ),
			) );
		}

		public function rest_get( WP_REST_Request $req ) {
			$id = absint( $req['id'] );
			if ( ! $this->can_edit( $id ) ) {
				return new WP_Error( 'sml_seo_forbidden', 'You cannot view this letter’s SEO.', array( 'status' => 403 ) );
			}
			return rest_ensure_response( array( 'id' => $id, 'seo' => $this->get_seo( $id ) ) );
		}

		public function rest_post( WP_REST_Request $req ) {
			$id = absint( $req['id'] );
			if ( ! $this->can_edit( $id ) ) {
				return new WP_Error( 'sml_seo_forbidden', 'Only the letter’s author can edit its SEO.', array( 'status' => 403 ) );
			}
			$in = $req->get_param( 'seo' );
			if ( ! is_array( $in ) ) { $in = array(); }
			$saved = $this->put_seo( $id, $in, get_current_user_id() );
			if ( is_wp_error( $saved ) ) { return $saved; }
			return rest_ensure_response( array( 'ok' => true, 'id' => $id, 'seo' => $saved ) );
		}

		/* ---------------- public <head> ---------------- */

		private function letter_url( $row ) {
			return home_url( '/' . self::PAGE_SLUG . '/' . rawurlencode( $row['handle'] ) . '/' . rawurlencode( $row['slug'] ) . '/' );
		}

		private function derive( $row, $seo ) {
			// Every value here is tag-stripped at the source so no consumer (the
			// <title> pre_get_document_title short-circuit, og/twitter attrs, or the
			// JSON-LD names) can be a markup-injection sink regardless of storage.
			$pub_name = wp_strip_all_tags( (string) get_user_meta( (int) $row['owner'], 'smll_name', true ) );
			$pub_name = $pub_name ?: wp_strip_all_tags( (string) get_bloginfo( 'name' ) );
			$title    = wp_strip_all_tags( trim( (string) ( $seo['meta_title'] ?? '' ) ) ?: ( (string) $row['title'] . ' — ' . $pub_name ) );
			$descsrc  = trim( (string) ( $seo['meta_desc'] ?? '' ) );
			if ( '' === $descsrc ) { $descsrc = (string) ( $row['tldr'] ?: $row['subtitle'] ); }
			$desc     = wp_trim_words( wp_strip_all_tags( $descsrc ), 40, '…' );
			$image    = esc_url_raw( trim( (string) ( $seo['social_image'] ?? '' ) ) ?: (string) $row['cover_url'] );
			$canon    = esc_url_raw( trim( (string) ( $seo['canonical'] ?? '' ) ) ?: $this->letter_url( $row ) );
			$udata    = get_userdata( (int) $row['owner'] );
			return array(
				'title' => $title,
				'desc'  => $desc,
				'image' => $image,
				'url'   => $this->letter_url( $row ),
				'canon' => $canon,
				'pub'   => $pub_name,
				'author'=> wp_strip_all_tags( (string) ( $udata ? $udata->display_name : $pub_name ) ),
			);
		}

		public function filter_title( $title ) {
			$row = $this->resolve_public();
			if ( ! $row ) { return $title; }
			$d = $this->derive( $row, $this->get_seo( (int) $row['id'] ) );
			// pre_get_document_title short-circuits BEFORE core's esc_html, so escape here.
			return esc_html( $d['title'] );
		}
		public function filter_title_parts( $parts ) {
			$row = $this->resolve_public();
			if ( ! $row ) { return $parts; }
			$d = $this->derive( $row, $this->get_seo( (int) $row['id'] ) );
			return array( 'title' => esc_html( $d['title'] ) );
		}

		public function render_head() {
			$row = $this->resolve_public();
			if ( ! $row ) { return; }
			$seo = $this->get_seo( (int) $row['id'] );
			$d   = $this->derive( $row, $seo );
			$og_title = trim( (string) ( $seo['og_title'] ?? '' ) ) ?: $d['title'];
			$og_desc  = trim( (string) ( $seo['og_desc'] ?? '' ) )  ?: $d['desc'];
			$tw_card  = ( ( $seo['twitter'] ?? '' ) === 'summary' ) ? 'summary' : 'summary_large_image';
			$published = ! empty( $row['published_at'] ) ? gmdate( 'c', strtotime( $row['published_at'] . ' UTC' ) ) : '';
			$modified  = ! empty( $row['updated_at'] )   ? gmdate( 'c', strtotime( $row['updated_at'] . ' UTC' ) )   : $published;

			$out  = "\n<!-- SML Loop Letters SEO -->\n";
			$out .= '<meta name="description" content="' . esc_attr( $d['desc'] ) . '">' . "\n";
			$out .= '<link rel="canonical" href="' . esc_url( $d['canon'] ) . '">' . "\n";
			$out .= '<meta property="og:type" content="article">' . "\n";
			$out .= '<meta property="og:site_name" content="' . esc_attr( $d['pub'] ) . '">' . "\n";
			$out .= '<meta property="og:title" content="' . esc_attr( $og_title ) . '">' . "\n";
			$out .= '<meta property="og:description" content="' . esc_attr( $og_desc ) . '">' . "\n";
			$out .= '<meta property="og:url" content="' . esc_url( $d['url'] ) . '">' . "\n";
			if ( $d['image'] ) { $out .= '<meta property="og:image" content="' . esc_url( $d['image'] ) . '">' . "\n"; }
			if ( $published ) { $out .= '<meta property="article:published_time" content="' . esc_attr( $published ) . '">' . "\n"; }
			$out .= '<meta name="twitter:card" content="' . esc_attr( $tw_card ) . '">' . "\n";
			$out .= '<meta name="twitter:title" content="' . esc_attr( $og_title ) . '">' . "\n";
			$out .= '<meta name="twitter:description" content="' . esc_attr( $og_desc ) . '">' . "\n";
			if ( $d['image'] ) { $out .= '<meta name="twitter:image" content="' . esc_url( $d['image'] ) . '">' . "\n"; }

			$types = array( 'NewsArticle', 'Article', 'AnalysisNewsArticle', 'OpinionNewsArticle', 'BlogPosting' );
			$type  = in_array( ( $seo['schema'] ?? '' ), $types, true ) ? $seo['schema'] : 'NewsArticle';
			$ld = array(
				'@context'         => 'https://schema.org',
				'@type'            => $type,
				'headline'         => wp_strip_all_tags( (string) $row['title'] ),
				'description'      => $d['desc'],
				'mainEntityOfPage' => $d['url'],
				'datePublished'    => $published,
				'dateModified'     => $modified,
				'author'           => array( '@type' => 'Person', 'name' => $d['author'] ),
				'publisher'        => array( '@type' => 'Organization', 'name' => $d['pub'] ),
			);
			if ( $d['image'] ) { $ld['image'] = $d['image']; }
			if ( ! empty( $seo['keyword'] ) ) { $ld['keywords'] = sanitize_text_field( $seo['keyword'] ); }
			// NOTE: no JSON_UNESCAPED_SLASHES — keeping '/' escaped means a stray
			// "</script>" in any value becomes "<\/script>" and cannot break out.
			$out .= '<script type="application/ld+json">'
				. wp_json_encode( $ld, JSON_UNESCAPED_UNICODE ) . '</script>' . "\n";
			$out .= "<!-- /SML Loop Letters SEO -->\n";

			// esc_* applied per-attribute above; JSON-LD is wp_json_encode'd.
			echo $out; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		}
	}

	new SML_Letters_SEO();
}
