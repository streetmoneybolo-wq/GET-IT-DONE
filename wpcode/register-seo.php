/**
 * SML /register/ SEO  (wpcode/register-seo.php)
 *
 * Makes /register/ rank as a public "Join Stock Market Loop" marketing landing.
 * Output-buffers the page and rewrites the head so it beats whatever Rank Math /
 * the theme emitted:
 *   - robots     -> index, follow      (was noindex,nofollow — the blocker)
 *   - canonical  -> https://site/register/
 *   - <title>    -> Join-focused
 *   - description-> injected (there is none today)
 *   - Open Graph + Twitter tags
 *
 * Output-buffer (not filters): on this WPCOM setup head/robots filters don't
 * reliably stick; rewriting the final HTML does. Uses init ob_start — the same
 * pattern the auth-portal loader already runs on /register/.
 *
 * Sends X-SML-Reg-SEO: 1 on /register/ so activation is verifiable.
 *
 * WPCode: PHP snippet, **Auto Insert · Run Everywhere · ACTIVE**. Guarded class,
 * no dynamic-code/encoding calls, no top-level return. ROLLBACK: deactivate.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! class_exists( 'SML_Register_SEO' ) ) {

	final class SML_Register_SEO {

		public function __construct() {
			add_action( 'init', array( $this, 'maybe_buffer' ), 20 );
		}

		private function on_register() {
			if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return false; }
			$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
			$path = (string) wp_parse_url( $uri, PHP_URL_PATH );
			return (bool) preg_match( '#^/register/?$#', $path );
		}

		public function maybe_buffer() {
			if ( ! $this->on_register() ) { return; }
			if ( ! headers_sent() ) { header( 'X-SML-Reg-SEO: 1' ); } // proof the snippet is live on /register/
			ob_start( array( $this, 'rewrite' ) );
		}

		public function rewrite( $html ) {
			if ( ! is_string( $html ) || false === stripos( $html, '</head>' ) ) { return $html; }

			$title = 'Join Stock Market Loop — The Finance-First Social Platform';
			$desc  = 'Create a free Stock Market Loop account — the finance-first social platform to follow tickers, join trading groups, publish market content, and go live.';
			$canon = home_url( '/register/' );
			$robots = 'index, follow, max-image-preview:large';

			// 1) Force indexable — overwrite EVERY robots/googlebot meta.
			$had_robots = (bool) preg_match( '#<meta[^>]*name=["\']robots["\'][^>]*>#i', $html );
			$html = preg_replace( '#<meta[^>]*name=["\']robots["\'][^>]*>#i', '<meta name="robots" content="' . $robots . '">', $html );
			$html = preg_replace( '#<meta[^>]*name=["\']googlebot["\'][^>]*>#i', '<meta name="googlebot" content="index, follow">', $html );

			// 2) Title.
			$html = preg_replace( '#<title>.*?</title>#is', '<title>' . esc_html( $title ) . '</title>', $html, 1 );

			// 3) Canonical -> /register/ (if a tag exists).
			if ( preg_match( '#<link[^>]*rel=["\']canonical["\'][^>]*>#i', $html ) ) {
				$html = preg_replace(
					'#(<link[^>]*rel=["\']canonical["\'][^>]*href=["\']).*?(["\'])#is',
					'$1' . $this->r( esc_url( $canon ) ) . '$2',
					$html, 1
				);
			}

			// 4) Description: replace if present, else inject.
			$inject = '';
			if ( ! $had_robots ) { $inject .= '<meta name="robots" content="' . $robots . '">'; }
			if ( preg_match( '#<meta[^>]*name=["\']description["\']#i', $html ) ) {
				$html = preg_replace(
					'#(<meta[^>]*name=["\']description["\'][^>]*content=["\']).*?(["\'])#is',
					'$1' . $this->r( esc_attr( $desc ) ) . '$2',
					$html, 1
				);
			} else {
				$inject .= '<meta name="description" content="' . esc_attr( $desc ) . '">';
			}

			// 5) Open Graph + Twitter (only if absent).
			if ( false === stripos( $html, 'property="og:title"' ) ) {
				$inject .= '<meta property="og:type" content="website">'
					. '<meta property="og:site_name" content="Stock Market Loop">'
					. '<meta property="og:url" content="' . esc_url( $canon ) . '">'
					. '<meta property="og:title" content="' . esc_attr( $title ) . '">'
					. '<meta property="og:description" content="' . esc_attr( $desc ) . '">'
					. '<meta name="twitter:card" content="summary">'
					. '<meta name="twitter:title" content="' . esc_attr( $title ) . '">'
					. '<meta name="twitter:description" content="' . esc_attr( $desc ) . '">';
			}

			if ( '' !== $inject ) {
				$pos  = stripos( $html, '</head>' );
				$html = substr( $html, 0, $pos ) . $inject . substr( $html, $pos );
			}

			return $html;
		}

		/** Neutralise $ and \ so they aren't treated as preg_replace backreferences. */
		private function r( $s ) {
			return str_replace( array( '\\', '$' ), array( '\\\\', '\\$' ), (string) $s );
		}
	}

	new SML_Register_SEO();
}
