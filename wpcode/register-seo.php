/**
 * SML landing SEO  (wpcode/register-seo.php  — WPCode snippet #7942)
 *
 * Makes app-shell landing pages that self-noindex rank as real marketing pages.
 * Both /register/ and /loop-letters/ shipped rel=canonical->home and
 * robots=noindex,nofollow (emitted by their rendering plugins), which blocks
 * indexing. This output-buffers those pages and rewrites the head:
 *   - robots     -> index, follow, max-image-preview:large
 *   - canonical  -> the page's own URL
 *   - <title>    + description (per-page)
 *   - Open Graph + Twitter tags
 *
 * Output-buffer (not filters): on this WPCOM setup head/robots filters don't
 * reliably stick; rewriting the final HTML does. init ob_start — the pattern the
 * auth-portal loader uses. Sends X-SML-Reg-SEO: 1 so activation is verifiable.
 *
 * WPCode: PHP snippet, Auto Insert · Run Everywhere · ACTIVE. Guarded class,
 * no dynamic-code/encoding calls, no top-level return. ROLLBACK: deactivate.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! class_exists( 'SML_Register_SEO' ) ) {

	final class SML_Register_SEO {

		/** path (trailing-slash-insensitive) => title/description. */
		private function targets() {
			return array(
				'/register/' => array(
					'title' => 'Join Stock Market Loop — The Finance-First Social Platform',
					'desc'  => 'Create a free Stock Market Loop account — the finance-first social platform to follow tickers, join trading groups, publish market content, and go live.',
				),
				'/loop-letters/' => array(
					'title' => 'Loop Letters — Finance Newsletters & Market Analysis | Stock Market Loop',
					'desc'  => 'Loop Letters on Stock Market Loop — read and publish finance newsletters, ticker analysis, and market commentary, connected to an active trading community.',
				),
			);
		}

		public function __construct() {
			add_action( 'init', array( $this, 'maybe_buffer' ), 20 );
		}

		/** Returns the matched target key (with trailing slash) or ''. */
		private function match() {
			if ( is_admin() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'DOING_AJAX' ) && DOING_AJAX ) ) { return ''; }
			$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
			$path = '/' . trim( (string) wp_parse_url( $uri, PHP_URL_PATH ), '/' ) . '/';
			return isset( $this->targets()[ $path ] ) ? $path : '';
		}

		public function maybe_buffer() {
			$key = $this->match();
			if ( '' === $key ) { return; }
			if ( ! headers_sent() ) { header( 'X-SML-Reg-SEO: 1' ); }
			$GLOBALS['sml_reg_seo_key'] = $key;
			ob_start( array( $this, 'rewrite' ) );
		}

		public function rewrite( $html ) {
			if ( ! is_string( $html ) || false === stripos( $html, '</head>' ) ) { return $html; }

			$key = isset( $GLOBALS['sml_reg_seo_key'] ) ? $GLOBALS['sml_reg_seo_key'] : '/register/';
			$cfg = $this->targets();
			$t   = isset( $cfg[ $key ] ) ? $cfg[ $key ] : reset( $cfg );

			$title  = $t['title'];
			$desc   = $t['desc'];
			$canon  = home_url( $key );
			$robots = 'index, follow, max-image-preview:large';

			// 1) Force indexable — overwrite EVERY robots/googlebot meta.
			$had_robots = (bool) preg_match( '#<meta[^>]*name=["\']robots["\'][^>]*>#i', $html );
			$html = preg_replace( '#<meta[^>]*name=["\']robots["\'][^>]*>#i', '<meta name="robots" content="' . $robots . '">', $html );
			$html = preg_replace( '#<meta[^>]*name=["\']googlebot["\'][^>]*>#i', '<meta name="googlebot" content="index, follow">', $html );

			// 2) Title.
			$html = preg_replace( '#<title>.*?</title>#is', '<title>' . esc_html( $title ) . '</title>', $html, 1 );

			// 3) Canonical -> the page's own URL.
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
