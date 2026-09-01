/**
 * SML Loop Letters — XML sitemap  (wpcode/loop-letters-sitemap.php)
 *
 * Loop Letters live in a CUSTOM table (sml_letters_table('posts')), so Rank Math
 * never sees them and published letters land in NO sitemap. This serves one at
 * /sml-letters-sitemap.xml listing every published letter (/n/{handle}/{slug}/)
 * plus the /n/ archive, and adds a Sitemap: line to robots.txt so crawlers find
 * it. Mirrors the letters plugin's own query/URL logic exactly.
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere.
 * No dynamic-code/encoding calls, guarded class, no top-level return.
 * ROLLBACK: deactivate the snippet (the URL 404s again).
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! class_exists( 'SML_Letters_Sitemap' ) ) {

	final class SML_Letters_Sitemap {

		const PATH  = '/sml-letters-sitemap.xml';
		const TTL   = 300;   // seconds; letters publish rarely, staleness is harmless
		const CACHE = 'sml_letters_sitemap_xml';

		public function __construct() {
			add_action( 'init', array( $this, 'maybe_serve' ), 0 );
			add_filter( 'robots_txt', array( $this, 'advertise' ), 20 );
		}

		/** Path match for our sitemap URL. */
		private function is_request() {
			if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) { return false; }
			$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
			$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
			return self::PATH === $path;
		}

		public function maybe_serve() {
			if ( ! $this->is_request() ) { return; }
			$xml = get_transient( self::CACHE );
			if ( ! is_string( $xml ) || '' === $xml ) {
				$xml = $this->build();
				set_transient( self::CACHE, $xml, self::TTL );
			}
			if ( ! headers_sent() ) {
				header( 'Content-Type: application/xml; charset=UTF-8' );
				nocache_headers();
			}
			echo $xml; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped — built with esc_url/esc_html below
			exit;
		}

		/** Published letters straight from the letters table (trusted helper name). */
		private function letters() {
			if ( ! function_exists( 'sml_letters_table' ) ) { return array(); }
			global $wpdb;
			$table = sml_letters_table( 'posts' );
			if ( ! $table ) { return array(); }
			return (array) $wpdb->get_results(
				"SELECT author_id, slug, published_at FROM {$table} WHERE status = 'published' ORDER BY published_at DESC LIMIT 5000", // phpcs:ignore WordPress.DB
				ARRAY_A
			);
		}

		private function build() {
			$decl = '<' . '?xml version="1.0" encoding="UTF-8"?' . '>';
			$out  = $decl . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";

			// The letters archive.
			$out .= '<url><loc>' . esc_url( home_url( '/n/' ) ) . '</loc><changefreq>daily</changefreq></url>' . "\n";

			foreach ( $this->letters() as $row ) {
				$handle = get_user_meta( (int) $row['author_id'], 'smll_handle', true );
				$slug   = isset( $row['slug'] ) ? sanitize_title( (string) $row['slug'] ) : '';
				if ( ! $handle || '' === $slug ) { continue; }
				$loc = home_url( '/n/' . rawurlencode( (string) $handle ) . '/' . $slug . '/' );
				$out .= '<url><loc>' . esc_url( $loc ) . '</loc>';
				if ( ! empty( $row['published_at'] ) ) {
					$ts = strtotime( (string) $row['published_at'] . ' UTC' );
					if ( $ts ) { $out .= '<lastmod>' . esc_html( gmdate( 'c', $ts ) ) . '</lastmod>'; }
				}
				$out .= '</url>' . "\n";
			}

			$out .= '</urlset>';
			return $out;
		}

		/** Point crawlers at the sitemap via robots.txt. */
		public function advertise( $output ) {
			$line = 'Sitemap: ' . esc_url( home_url( self::PATH ) );
			if ( is_string( $output ) && false === strpos( $output, self::PATH ) ) {
				$output .= "\n" . $line . "\n";
			}
			return $output;
		}
	}

	new SML_Letters_Sitemap();
}
