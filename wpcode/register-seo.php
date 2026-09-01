/**
 * SML /register/ SEO  (wpcode/register-seo.php)
 *
 * Makes /register/ rank as a public "Join Stock Market Loop" marketing landing.
 * It currently self-canonicalises to the HOMEPAGE (rel=canonical -> "/"), which
 * tells Google /register/ is a duplicate of / and must not be indexed on its own.
 * This output-buffers /register/ and rewrites the head:
 *   - canonical  -> https://site/register/   (the actual fix)
 *   - <title>    -> Join-focused
 *   - description-> registration-focused
 *   - adds Open Graph + Twitter tags (none today) for shareable link previews
 *
 * Output-buffer (not filters) because on this WPCOM setup head/robots filters do
 * not reliably stick — rewriting the final HTML does. Matches the site's existing
 * output-buffer pattern (adsense-noindex, the auth-portal loader).
 *
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. Guarded class, no
 * dynamic-code/encoding calls, no top-level return. ROLLBACK: deactivate.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! class_exists( 'SML_Register_SEO' ) ) {

	final class SML_Register_SEO {

		public function __construct() {
			add_action( 'template_redirect', array( $this, 'maybe_buffer' ), 0 );
		}

		private function on_register() {
			if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return false; }
			$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
			$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
			return (bool) preg_match( '#^/register/?$#', $path );
		}

		public function maybe_buffer() {
			if ( $this->on_register() ) { ob_start( array( $this, 'rewrite' ) ); }
		}

		public function rewrite( $html ) {
			if ( ! is_string( $html ) || false === stripos( $html, '</head>' ) ) { return $html; }

			$title = 'Join Stock Market Loop — The Finance-First Social Platform';
			$desc  = 'Create a free Stock Market Loop account — the finance-first social platform to follow tickers, join trading groups, publish market content, and go live.';
			$canon = home_url( '/register/' );

			// <title>
			$html = preg_replace( '#<title>.*?</title>#is', '<title>' . esc_html( $title ) . '</title>', $html, 1 );
			// meta description content
			$html = preg_replace(
				'#(<meta[^>]*name=["\']description["\'][^>]*content=["\']).*?(["\'])#is',
				'$1' . $this->r( $desc ) . '$2',
				$html, 1
			);
			// canonical href (the critical fix: point to /register/, not /)
			$html = preg_replace(
				'#(<link[^>]*rel=["\']canonical["\'][^>]*href=["\']).*?(["\'])#is',
				'$1' . $this->r( esc_url( $canon ) ) . '$2',
				$html, 1
			);

			// Open Graph + Twitter — only if absent.
			if ( false === stripos( $html, 'property="og:title"' ) ) {
				$og  = '<meta property="og:type" content="website">'
					. '<meta property="og:site_name" content="Stock Market Loop">'
					. '<meta property="og:url" content="' . esc_url( $canon ) . '">'
					. '<meta property="og:title" content="' . esc_attr( $title ) . '">'
					. '<meta property="og:description" content="' . esc_attr( $desc ) . '">'
					. '<meta name="twitter:card" content="summary">'
					. '<meta name="twitter:title" content="' . esc_attr( $title ) . '">'
					. '<meta name="twitter:description" content="' . esc_attr( $desc ) . '">';
				$pos  = stripos( $html, '</head>' );
				$html = substr( $html, 0, $pos ) . $og . substr( $html, $pos );
			}

			return $html;
		}

		/** Neutralise $ and \ so they are not treated as preg_replace backreferences. */
		private function r( $s ) {
			return str_replace( array( '\\', '$' ), array( '\\\\', '\\$' ), (string) $s );
		}
	}

	new SML_Register_SEO();
}
