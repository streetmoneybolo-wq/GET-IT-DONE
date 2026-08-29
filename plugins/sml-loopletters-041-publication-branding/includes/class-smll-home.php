<?php
/**
 * Newsletter home — the publication front page at /n/{handle}.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES
 * ---------------------------------------------------------------------------
 * The 0.2.x public page was a single 680px column: masthead, subscribe, a flat
 * list of letters. This is the Loop Hub design instead — two columns, a hero
 * card, a sidebar carrying about/subscribe/featured/topics, and pagination.
 *
 * The narrow single column was not wrong, it was answering a different
 * question. A publication home is an INDEX: its job is to get a stranger from
 * "who is this" to "I'll read that one" in a couple of seconds, which wants
 * density and several parallel entry points. A letter is PROSE, and prose
 * wants one narrow measure and nothing beside it. So both stylesheets stay:
 * letter-home.css for this screen, letter-public.css for reading a letter.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE DESIGN IMPLIES THAT DID NOT EXIST
 * ---------------------------------------------------------------------------
 * The mock quietly assumes four things the plugin had no support for:
 *
 *   featured image   →  post thumbnail, already declared on the post type
 *   "15 MIN READ"    →  computed once on save, not on every render
 *   FEATURED list    →  a per-letter flag, curated by the creator
 *   TOPICS + counts  →  a real taxonomy, so counts come from the term cache
 *                       rather than a COUNT(*) per topic per page view
 *
 * All four are here. Nothing about them is visible until a creator uses them,
 * so an empty publication still renders cleanly.
 *
 * @package SML\LoopLetters
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'SML_LoopLetters_Home_V040', false ) ) {

	final class SML_LoopLetters_Home_V040 {

		const POST_TYPE   = 'sml_letter';
		const TAXONOMY    = 'sml_letter_topic';
		const META_READ   = '_smll_read_minutes';
		const META_FEAT   = '_smll_featured';

		const PER_PAGE    = 5;
		const FEAT_LIMIT  = 4;
		const TOPIC_LIMIT = 20;

		/**
		 * REST namespace of the host plugin.
		 *
		 * Not a constant: production already renamed this once, from
		 * sml-letters/v1 to sml-loopletters/v1, to stop colliding with SML
		 * Video Upload Studio. Hard-coding it here would mean this file needs
		 * editing the next time that happens, and a stale value would point
		 * the subscribe form at a route that does not exist — a form that
		 * silently fails rather than erroring. register_routes() sets it.
		 */
		private static $ns = 'sml-loopletters/v1';

		/** Words per minute. 220 is the usual adult silent-reading figure for
		 *  non-technical prose; market analysis with tickers and numbers reads
		 *  slower, so this deliberately errs toward a slightly longer estimate
		 *  than a blog-standard 265 would give. */
		const WPM = 220;

		public static function init() {
			// Feed is emitted before the theme loads: it is XML, not a page.
			// Priority 3 puts it ahead of the subscription handler at 4 and
			// the landing router at 5, none of which apply to a feed request.
			add_action( 'template_redirect', array( __CLASS__, 'maybe_feed' ), 3 );

			// Letter records belong to SML Video Upload Studio's custom tables.
			// Do not register a companion post type, taxonomy, or save handlers.
		}

		// ===================================================================
		// Featured flag — editor UI
		// ===================================================================

		/**
		 * A checkbox, not a "featured" category.
		 *
		 * Using a term would put curation in the same list as topics, where it
		 * would show up in the reader-facing topic rail as though "Featured"
		 * were a subject someone writes about. It is an editorial decision, so
		 * it lives on the letter as a flag.
		 */
		public static function add_featured_box() {
			add_meta_box(
				'smll_featured',
				'Feature this issue',
				array( __CLASS__, 'render_featured_box' ),
				self::POST_TYPE,
				'side',
				'high'
			);
		}

		public static function render_featured_box( $post ) {
			wp_nonce_field( 'smll_featured_save', 'smll_featured_nonce' );
			$on = ( '1' === get_post_meta( $post->ID, self::META_FEAT, true ) );
			?>
			<label style="display:flex;gap:8px;align-items:flex-start;line-height:1.5">
				<input type="checkbox" name="smll_featured" value="1" <?php checked( $on ); ?> />
				<span>Show in the <strong>Featured</strong> list on your publication home.</span>
			</label>
			<p style="margin:10px 0 0;color:#646970;font-size:12px">
				The <?php echo (int) self::FEAT_LIMIT; ?> most recent featured issues are shown.
				Featuring an older issue is how a good piece keeps earning readers
				after it has scrolled off the front page.
			</p>
			<?php
		}

		public static function save_featured_box( $post_id ) {
			if ( ! isset( $_POST['smll_featured_nonce'] )
				|| ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['smll_featured_nonce'] ) ), 'smll_featured_save' ) ) {
				return;
			}
			if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
				return;
			}
			if ( ! current_user_can( 'edit_post', $post_id ) ) {
				return;
			}

			if ( empty( $_POST['smll_featured'] ) ) {
				// Deleted rather than set to '0'. The featured query is a
				// meta_value lookup, and rows that exist only to say "no" make
				// that index bigger for nothing.
				delete_post_meta( $post_id, self::META_FEAT );
			} else {
				update_post_meta( $post_id, self::META_FEAT, '1' );
			}
		}

		// ===================================================================
		// RSS
		// ===================================================================

		/**
		 * Per-publication feed at /n/{handle}/?feed=rss.
		 *
		 * Built by hand rather than through WordPress's feed templates because
		 * those key off the main query, and /n/{handle} is a Page standing in
		 * for a publication — do_feed() would describe the Page, not the
		 * letters.
		 *
		 * Full content is deliberately NOT included, only excerpts. A feed that
		 * carries the whole letter is a feed nobody clicks through from, and
		 * the click-through is the only signal a creator gets that a piece
		 * landed.
		 */
		public static function maybe_feed() {
			if ( empty( $_GET['feed'] ) || 'rss' !== $_GET['feed'] ) {
				return;
			}

			$path = trim( (string) wp_parse_url(
				isset( $_SERVER['REQUEST_URI'] ) ? esc_url_raw( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '',
				PHP_URL_PATH
			), '/' );

			if ( ! preg_match( '#^n/([^/]+)/?$#', $path, $m ) ) {
				return;
			}

			$handle = sanitize_title( $m[1] );
			$users  = get_users( array(
				'meta_key'   => 'smll_handle',
				'meta_value' => $handle,
				'number'     => 1,
				'fields'     => 'ID',
			) );
			if ( ! $users ) {
				return;
			}

			$owner = (int) $users[0];
			$user  = get_userdata( $owner );
			$name  = (string) get_user_meta( $owner, 'smll_name', true );
			if ( '' === $name ) {
				$proj = get_user_meta( $owner, 'smll_public', true );
				$name = is_array( $proj ) && ! empty( $proj['name'] ) ? $proj['name'] : $user->display_name;
			}

			$self  = home_url( '/n/' . $handle . '/' );
			$posts = self::query( $owner, 20, 0 );

			header( 'Content-Type: application/rss+xml; charset=UTF-8', true );
			echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
			?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
	<title><?php echo esc_html( $name ); ?></title>
	<link><?php echo esc_url( $self ); ?></link>
	<atom:link href="<?php echo esc_url( add_query_arg( 'feed', 'rss', $self ) ); ?>" rel="self" type="application/rss+xml" />
	<description><?php echo esc_html( (string) get_user_meta( $owner, 'smll_tagline', true ) ); ?></description>
	<language><?php echo esc_html( get_bloginfo( 'language' ) ); ?></language>
	<lastBuildDate><?php echo esc_html( $posts ? self::date( $posts[0], 'r' ) : gmdate( 'r' ) ); ?></lastBuildDate>
			<?php foreach ( $posts as $p ) : ?>
	<item>
		<title><?php echo esc_html( self::title( $p ) ); ?></title>
		<link><?php echo esc_url( home_url( '/n/' . $handle . '/' . self::slug( $p ) . '/' ) ); ?></link>
		<guid isPermaLink="true"><?php echo esc_url( home_url( '/n/' . $handle . '/' . self::slug( $p ) . '/' ) ); ?></guid>
		<pubDate><?php echo esc_html( self::date( $p, 'r' ) ); ?></pubDate>
		<description><![CDATA[<?php echo esc_html( self::excerpt( $p, 45 ) ); ?>]]></description>
	</item>
			<?php endforeach; ?>
</channel>
</rss>
			<?php
			exit;
		}

		// ===================================================================
		// Topics
		// ===================================================================

		/**
		 * Topics are a taxonomy, not a meta field.
		 *
		 * The sidebar shows a count beside every topic. With meta that means a
		 * COUNT(*) per topic per page view; with a taxonomy the count lives in
		 * the term row and is maintained by WordPress. Twenty topics on a
		 * cached term list is one query instead of twenty.
		 *
		 * publicly_queryable is false for the same reason the post type's is:
		 * /n/{handle} owns the public URLs, and a parallel /sml_letter_topic/
		 * archive would compete with it.
		 */
		public static function register_taxonomy() {
			register_taxonomy( self::TAXONOMY, self::POST_TYPE, array(
				'label'              => 'Topics',
				'public'             => false,
				'publicly_queryable' => false,
				'show_ui'            => true,
				'show_in_rest'       => true,
				'show_admin_column'  => true,
				'hierarchical'       => false,
				'rewrite'            => false,
			) );
		}

		// ===================================================================
		// Read time
		// ===================================================================

		/**
		 * Computed on save and stored, never computed during a render.
		 *
		 * A publication home shows a read time for up to ten letters at once.
		 * Doing the word count at render means stripping tags and shortcodes
		 * off ten full post bodies on every single page view, including for
		 * crawlers. Once per save is the right frequency.
		 */
		public static function cache_read_time( $post_id, $post ) {
			if ( wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
				return;
			}
			update_post_meta( $post_id, self::META_READ, self::calc_read_time( $post->post_content ) );
		}

		public static function calc_read_time( $content ) {
			$words = str_word_count( wp_strip_all_tags( strip_shortcodes( (string) $content ) ) );
			return max( 1, (int) ceil( $words / self::WPM ) );
		}

		public static function read_time( $post ) {
			$m = (int) get_post_meta( $post->ID, self::META_READ, true );
			if ( $m > 0 ) {
				return $m;
			}
			// Backfill for letters written before this file existed, so no
			// letter ever renders without one.
			$m = self::calc_read_time( $post->post_content );
			update_post_meta( $post->ID, self::META_READ, $m );
			return $m;
		}

		// ===================================================================
		// Rendering
		// ===================================================================

		/**
		 * @param array $pub Publication array from the host plugin's
		 *                   get_publication(). Passed in rather than fetched so
		 *                   this class does not care whether that data came
		 *                   from the Studio bridge or the local projection.
		 */
		public static function render( $pub ) {
			$owner_id = (int) $pub['userId'];
			$topic    = self::current_topic();
			$layout   = in_array( $pub['layout'] ?? '', array( 'list', 'grid', 'magazine' ), true ) ? $pub['layout'] : 'list';
			$allowed_fonts = array( 'grotesk', 'serif', 'archivo', 'inter', 'manrope', 'poppins', 'montserrat', 'dm-sans', 'playfair', 'merriweather', 'lora', 'roboto-slab' );
			$font     = in_array( $pub['font'] ?? '', $allowed_fonts, true ) ? $pub['font'] : 'grotesk';
			$accent   = preg_match( '/^#[0-9a-f]{6}$/i', $pub['accent'] ?? '' ) ? strtolower( $pub['accent'] ) : '#00ff88';
			$rgb      = sscanf( ltrim( $accent, '#' ), '%02x%02x%02x' );
			$sections = wp_parse_args( (array) ( $pub['sections'] ?? array() ), array(
				'hero' => true, 'about' => true, 'social' => true, 'featured' => true, 'topics' => true,
			) );

			$background = ! empty( $pub['backgroundImageUrl'] ) ? esc_url_raw( $pub['backgroundImageUrl'] ) : '';
			$h  = '<div class="lh lh--layout-' . esc_attr( $layout ) . ' lh--font-' . esc_attr( $font ) . ( $background ? ' lh--has-background' : '' ) . '"'
				. ' style="--lh-accent:' . esc_attr( $accent ) . ';--lh-accent-rgb:'
				. esc_attr( implode( ',', array_map( 'intval', $rgb ) ) )
				. ( $background ? ';--lh-background-image:url(&quot;' . esc_url( $background ) . '&quot;)' : '' ) . '">';
			$h .= self::top_bar( $pub );
			$h .= '<div class="lh-wrap"><main>';

			// Filtered view: a flat list, no hero. Promoting one result of a
			// filter to hero size implies it is the newest issue of the
			// publication, which it is not — it is only the newest in this
			// topic, and the distinction matters on a page about markets.
			if ( $topic ) {
				$h .= self::filter_bar( $pub, $topic );

				$posts = self::query( $owner_id, self::PER_PAGE, 0, $topic );
				$total = self::count( $owner_id, $topic );

				if ( ! $posts ) {
					$h .= '<div class="lh-empty">'
						. '<h2 class="lh-empty__title">Nothing under this topic yet</h2>'
						. '<p class="lh-empty__body"><a href="' . esc_url( $pub['publicUrl'] ) . '">'
						. 'See every issue</a></p></div>';
				} else {
					$h .= '<ul class="lh-list" data-lh-list>';
					foreach ( $posts as $p ) {
						$h .= self::list_item( $pub, $p );
					}
					$h .= '</ul>';

					if ( $total > self::PER_PAGE ) {
						$h .= '<button class="lh-more" type="button" data-lh-more data-page="1"'
							. ' data-topic="' . esc_attr( $topic ) . '">Load more issues</button>';
					}
				}

				$h .= '</main>' . self::sidebar( $pub ) . '</div>' . self::footer( $pub ) . '</div>';
				return $h;
			}

			$show_hero = rest_sanitize_boolean( $sections['hero'] );
			$latest = self::query( $owner_id, 1, 0 );
			$latest = $latest ? $latest[0] : null;

			// Offset by one: the hero already spent the newest letter, and
			// showing it twice makes a young publication look like it is
			// repeating itself.
			$base  = ( $latest && $show_hero ) ? 1 : 0;
			$rest  = $latest ? self::query( $owner_id, self::PER_PAGE, $base ) : array();
			$total = self::count( $owner_id );

			if ( ! $latest ) {
				$h .= '<div class="lh-empty">'
					. '<h2 class="lh-empty__title">No issues yet</h2>'
					. '<p class="lh-empty__body">Subscribe and the first one lands in your inbox '
					. 'the moment it goes out.</p></div>';
			} else {
				if ( $show_hero ) {
					$h .= self::hero( $pub, $latest );
				}

				if ( $rest ) {
					$h .= '<p class="lh__label">' . ( $show_hero ? 'More issues' : 'Latest issues' ) . '</p><ul class="lh-list" data-lh-list>';
					foreach ( $rest as $p ) {
						$h .= self::list_item( $pub, $p );
					}
					$h .= '</ul>';

					if ( $total > ( $base + self::PER_PAGE ) ) {
						$h .= '<button class="lh-more" type="button" data-lh-more data-page="1" data-base="'
							. (int) $base . '">Load more issues</button>';
					}
				}
			}

			$h .= '</main>';
			$h .= self::sidebar( $pub );
			$h .= '</div>';
			$h .= self::footer( $pub );
			$h .= '</div>';

			return $h;
		}

		/** Header for a filtered view, with the way back out. */
		private static function filter_bar( $pub, $topic ) {
			$label = ucwords( str_replace( '-', ' ', $topic ) );

			return '<p class="lh__label">Topic</p>'
				. '<div class="lh-filter">'
				. '<h1 class="lh-filter__name">' . esc_html( $label ) . '</h1>'
				. '<a class="lh-filter__clear" href="' . esc_url( $pub['publicUrl'] ) . '">'
				. 'Clear filter</a></div>';
		}

		private static function top_bar( $pub ) {
			$nav = array(
				'Watch'       => '/watch/',
				'Live'        => '/go-live/',
				'Newsletters' => '/loop-letters/',
				'Markets'     => '/markets/',
			);

			$h  = '<header class="lh-top"><div class="lh-top__in">';
			$h .= '<a class="lh-brand" href="' . esc_url( home_url( '/' ) ) . '">'
				. '<span class="lh-brand__dot" aria-hidden="true"></span>'
				. '<span class="lh-brand__name">Loop Hub</span></a>';

			$h .= '<ul class="lh-nav">';
			foreach ( $nav as $label => $path ) {
				$active = ( 'Newsletters' === $label ) ? ' is-active' : '';
				$h .= '<li><a class="lh-nav__link' . $active . '" href="' . esc_url( home_url( $path ) ) . '">'
					. esc_html( $label ) . '</a></li>';
			}
			$h .= '</ul>';

			// Only the owner sees this. Rendering it for everyone and hiding it
			// with CSS would leak the edit URL into every cached page and every
			// crawl of the site.
			if ( self::is_owner( $pub ) ) {
				$h .= '<button class="lh-edit" type="button" data-lh-edit>Edit publication</button>';
			}

			return $h . '</div></header>';
		}

		private static function is_owner( $pub ) {
			return is_user_logged_in() && get_current_user_id() === (int) $pub['userId'];
		}

		private static function hero( $pub, $post ) {
			$url = self::letter_url( $pub, $post );

			$cover = self::value( $post, 'cover_url' );
			$media = $cover
				? '<img class="lh-hero__media" src="' . esc_url( $cover ) . '" alt="" loading="eager" />'
				: '';
			if ( '' === $media ) {
				$media = '<div class="lh-hero__media lh-hero__media--empty">Featured image</div>';
			}

			return '<a class="lh-hero" data-lh-section="hero" href="' . esc_url( $url ) . '">'
				. $media
				. '<div class="lh-hero__body">'
				. '<p class="lh-hero__eyebrow">Latest issue</p>'
				. '<h1 class="lh-hero__title">' . esc_html( self::title( $post ) ) . '</h1>'
				. '<p class="lh-hero__excerpt">' . esc_html( self::excerpt( $post, 32 ) ) . '</p>'
				. self::meta( $post )
				. '</div></a>';
		}

		public static function list_item( $pub, $post ) {
			return '<li class="lh-list__item"><a class="lh-list__link" href="'
				. esc_url( self::letter_url( $pub, $post ) ) . '">'
				. '<h2 class="lh-list__title">' . esc_html( self::title( $post ) ) . '</h2>'
				. '<p class="lh-list__excerpt">' . esc_html( self::excerpt( $post, 30 ) ) . '</p>'
				. self::meta( $post )
				. '</a></li>';
		}

		private static function sidebar( $pub ) {
			$sections = wp_parse_args( (array) ( $pub['sections'] ?? array() ), array(
				'about' => true, 'social' => true, 'featured' => true, 'topics' => true,
			) );
			$h = '<aside class="lh-side">';

			// --- about + subscribe ---
			$h .= '<section class="lh-side__block">';
			if ( rest_sanitize_boolean( $sections['about'] ) ) {
				$logo = strtoupper( substr( preg_replace( '/[^A-Za-z0-9]/', '', $pub['logo'] ?? '' ), 0, 2 ) );
				if ( '' === $logo ) {
					$words = preg_split( '/\s+/', trim( (string) $pub['name'] ) );
					$logo = strtoupper( substr( $words[0] ?? 'L', 0, 1 ) . substr( $words[1] ?? '', 0, 1 ) );
				}
				$logo_image = ! empty( $pub['logoImageUrl'] )
					? '<img src="' . esc_url( $pub['logoImageUrl'] ) . '" alt="' . esc_attr( $pub['name'] . ' logo' ) . '" loading="lazy" />'
					: esc_html( $logo );
				$h .= '<div data-lh-section="about"><p class="lh__label">About</p>';
				$h .= '<a class="lh-about__id" href="' . esc_url( $pub['publicUrl'] ) . '">'
					. '<span class="lh-about__logo">' . $logo_image . '</span>'
					. '<span><span class="lh-about__name">' . esc_html( $pub['name'] ) . '</span>';
				if ( ! empty( $pub['tagline'] ) ) {
					$h .= '<span class="lh-about__tagline">' . esc_html( $pub['tagline'] ) . '</span>';
				}
				$h .= '</span></a></div>';
			}

			$h .= '<p class="lh-about__pitch">' . esc_html( $pub['signup_copy'] ?? '' ) . '</p>';
			$h .= self::subscribe_form( $pub );
			if ( rest_sanitize_boolean( $sections['social'] ) ) {
				$h .= '<div data-lh-section="social">' . self::social( $pub ) . '</div>';
			}
			$h .= '</section>';

			// --- featured ---
			$featured = self::featured( (int) $pub['userId'] );
			if ( rest_sanitize_boolean( $sections['featured'] ) && $featured ) {
				$h .= '<section class="lh-side__block" data-lh-section="featured"><p class="lh__label">Featured</p><ul class="lh-feat">';
				foreach ( $featured as $p ) {
					$h .= '<li class="lh-feat__item"><a class="lh-feat__link" href="'
						. esc_url( self::letter_url( $pub, $p ) ) . '">'
						. '<h3 class="lh-feat__title">' . esc_html( self::title( $p ) ) . '</h3>'
						. '<p class="lh-feat__excerpt">' . esc_html( self::excerpt( $p, 22 ) ) . '</p>'
						. self::meta( $p )
						. '</a></li>';
				}
				$h .= '</ul></section>';
			}

			// --- topics ---
			$topics = self::topics( (int) $pub['userId'] );
			if ( rest_sanitize_boolean( $sections['topics'] ) && $topics ) {
				$h .= '<section class="lh-side__block" data-lh-section="topics"><p class="lh__label">Topics</p><ul class="lh-topics">';
				foreach ( $topics as $t ) {
					$h .= '<li class="lh-topics__item"><a class="lh-topics__link" href="'
						. esc_url( add_query_arg( 'topic', $t->slug, $pub['publicUrl'] ) ) . '">'
						. '<span>' . esc_html( $t->name ) . '</span>'
						. '<span class="lh-topics__count">' . (int) $t->count . ' '
						. esc_html( _n( 'issue', 'issues', (int) $t->count, 'sml-loopletters' ) )
						. '</span></a></li>';
				}
				$h .= '</ul></section>';
			}

			return $h . '</aside>';
		}

		private static function subscribe_form( $pub ) {
			return '<form class="lh-sub" data-lh-subscribe method="post" action="'
				. esc_url( rest_url( self::$ns . '/subscribe' ) ) . '">'
				. '<input type="hidden" name="handle" value="' . esc_attr( $pub['handle'] ) . '" />'
				. '<input type="hidden" name="source" value="home-sidebar" />'
				. '<div class="lh-sub__row">'
				. '<input class="lh-sub__input" type="email" name="email" required autocomplete="email"'
				. ' placeholder="jamie@example.com" aria-label="Your email" />'
				. '<button class="lh-sub__btn" type="submit">' . esc_html( $pub['signup_button'] ?? 'Subscribe' ) . '</button>'
				. '</div>'
				. '<p class="lh-sub__note" data-lh-status>Free. One click to unsubscribe.</p>'
				. '</form>';
		}

		/**
		 * Social links come from the publication settings, and only the ones
		 * that are set are rendered. An empty rail of dead placeholder chips
		 * looks more abandoned than no rail at all.
		 */
		private static function social( $pub ) {
			$links = array(
				'X / Twitter' => $pub['social_x'] ?? '',
				'YouTube'     => $pub['social_youtube'] ?? '',
				'Discord'     => $pub['social_discord'] ?? '',
			);

			$items = '';
			foreach ( $links as $label => $url ) {
				if ( ! $url ) {
					continue;
				}
				$items .= '<li><a class="lh-social__link" rel="me noopener" target="_blank" href="'
					. esc_url( $url ) . '">' . esc_html( $label ) . '</a></li>';
			}

			// RSS is always available: it is generated, not configured.
			$items .= '<li><a class="lh-social__link" href="'
				. esc_url( add_query_arg( 'feed', 'rss', $pub['publicUrl'] ) ) . '">RSS</a></li>';

			return '<ul class="lh-social">' . $items . '</ul>';
		}

		private static function footer( $pub ) {
			$host = wp_parse_url( home_url(), PHP_URL_HOST );

			return '<footer class="lh-foot"><p class="lh-foot__in">'
				. esc_html( $host . '/n/' . $pub['handle'] )
				. ' &middot; <a href="' . esc_url( home_url( '/loop-letters/' ) ) . '">'
				. esc_html( $pub['footer_note'] ?? 'Powered by Loop Hub' ) . '</a>'
				. '</p></footer>';
		}

		// ===================================================================
		// Queries
		// ===================================================================

		public static function query( $author_id, $limit, $offset, $topic = '' ) {
			if ( ! function_exists( 'sml_letters_table' ) ) {
				return array();
			}

			global $wpdb;
			$table  = sml_letters_table( 'posts' );
			$limit  = max( 1, (int) $limit );
			$offset = max( 0, (int) $offset );

			if ( ! $topic ) {
				return (array) $wpdb->get_results( $wpdb->prepare(
					"SELECT * FROM {$table} WHERE author_id = %d AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT %d OFFSET %d",
					(int) $author_id,
					$limit,
					$offset
				), ARRAY_A );
			}

			$rows = (array) $wpdb->get_results( $wpdb->prepare(
				"SELECT * FROM {$table} WHERE author_id = %d AND status = 'published' ORDER BY published_at DESC, id DESC",
				(int) $author_id
			), ARRAY_A );
			$rows = array_values( array_filter( $rows, static function ( $row ) use ( $topic ) {
				foreach ( array_filter( array_map( 'trim', explode( ',', (string) ( $row['tags'] ?? '' ) ) ) ) as $tag ) {
					if ( sanitize_title( $tag ) === $topic ) {
						return true;
					}
				}
				return false;
			} ) );

			return array_slice( $rows, $offset, $limit );
		}

		/** The topic currently being filtered to, or '' for none. */
		private static function current_topic() {
			return isset( $_GET['topic'] ) ? sanitize_title( wp_unslash( $_GET['topic'] ) ) : '';
		}

		private static function count( $author_id, $topic = '' ) {
			if ( $topic ) {
				return count( self::query( $author_id, PHP_INT_MAX, 0, $topic ) );
			}
			if ( ! function_exists( 'sml_letters_table' ) ) {
				return 0;
			}
			global $wpdb;
			$table = sml_letters_table( 'posts' );
			return (int) $wpdb->get_var( $wpdb->prepare(
				"SELECT COUNT(*) FROM {$table} WHERE author_id = %d AND status = 'published'",
				(int) $author_id
			) );
		}

		private static function featured( $author_id ) {
			$ids = array_slice( array_values( array_filter( array_map(
				'absint',
				(array) get_user_meta( (int) $author_id, 'smll_featured_letter_ids', true )
			) ) ), 0, self::FEAT_LIMIT );
			if ( ! $ids || ! function_exists( 'sml_letters_table' ) ) {
				return array();
			}
			global $wpdb;
			$table = sml_letters_table( 'posts' );
			$in    = implode( ',', $ids );
			$rows  = (array) $wpdb->get_results(
				"SELECT * FROM {$table} WHERE author_id = " . (int) $author_id . " AND status = 'published' AND id IN ({$in})",
				ARRAY_A
			);
			$rank = array_flip( $ids );
			usort( $rows, static function ( $a, $b ) use ( $rank ) {
				return ( $rank[ (int) $a['id'] ] ?? PHP_INT_MAX ) <=> ( $rank[ (int) $b['id'] ] ?? PHP_INT_MAX );
			} );
			return $rows;
		}

		/**
		 * Topics used by THIS creator, with counts scoped to them.
		 *
		 * get_terms() counts across the whole taxonomy, which on a shared
		 * platform would show one creator the total usage of a topic across
		 * every publication — "4 issues" when they have written one. So the
		 * counts are recomputed against this author's letters.
		 */
		private static function topics( $author_id ) {
			$rows = self::query( $author_id, 200, 0 );
			if ( ! $rows ) {
				return array();
			}

			$tally = array();
			foreach ( $rows as $row ) {
				foreach ( array_filter( array_map( 'trim', explode( ',', (string) ( $row['tags'] ?? '' ) ) ) ) as $name ) {
					$slug = sanitize_title( $name );
					if ( ! isset( $tally[ $slug ] ) ) {
						$tally[ $slug ] = (object) array( 'slug' => $slug, 'name' => $name, 'count' => 0 );
					}
					$tally[ $slug ]->count++;
				}
			}

			$out = array_values( $tally );
			usort( $out, static function ( $a, $b ) {
				return strcasecmp( $a->name, $b->name );
			} );

			return array_slice( $out, 0, self::TOPIC_LIMIT );
		}

		// ===================================================================
		// Helpers
		// ===================================================================

		public static function letter_url( $pub, $post ) {
			return home_url( '/n/' . $pub['handle'] . '/' . self::slug( $post ) . '/' );
		}

		private static function excerpt( $post, $words ) {
			$excerpt = self::value( $post, 'subtitle' );
			if ( '' === $excerpt ) {
				$excerpt = self::value( $post, 'tldr' );
			}
			if ( '' === $excerpt ) {
				$excerpt = self::value( $post, 'plaintext' );
			}
			return wp_trim_words(
				wp_strip_all_tags( $excerpt ),
				$words,
				'…'
			);
		}

		private static function meta( $post ) {
			return '<p class="lh__meta">'
				. '<time datetime="' . esc_attr( self::date( $post, 'c' ) ) . '">'
				. esc_html( self::date( $post, 'd M Y' ) ) . '</time>'
				. ' · ' . max( 1, (int) self::value( $post, 'read_minutes' ) ) . ' min read</p>';
		}

		private static function value( $row, $key ) {
			if ( is_array( $row ) ) {
				return isset( $row[ $key ] ) ? (string) $row[ $key ] : '';
			}
			return isset( $row->{$key} ) ? (string) $row->{$key} : '';
		}

		private static function title( $row ) {
			return self::value( $row, 'title' );
		}

		private static function slug( $row ) {
			return sanitize_title( self::value( $row, 'slug' ) );
		}

		private static function date( $row, $format ) {
			$value = self::value( $row, 'published_at' );
			$time  = $value ? strtotime( $value . ' UTC' ) : false;
			return $time ? wp_date( $format, $time ) : '';
		}

		// ===================================================================
		// REST — load more
		// ===================================================================

		/**
		 * Returns rendered HTML rather than JSON.
		 *
		 * The alternative is shipping the list-item markup twice — once in PHP
		 * for first paint and SEO, once in JS for appended pages — and those
		 * two copies drift the first time anyone edits one of them. Rendering
		 * server-side keeps a single definition of what an issue row looks
		 * like. The payload is small and the markup is already escaped.
		 */
		public static function register_routes( $ns ) {
			self::$ns = (string) $ns;

			register_rest_route( $ns, '/issues', array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'rest_issues' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'handle' => array( 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_title' ),
					'page'   => array( 'required' => false, 'type' => 'integer', 'default' => 1 ),
					'topic'  => array( 'required' => false, 'type' => 'string', 'sanitize_callback' => 'sanitize_title' ),
					'base'   => array( 'required' => false, 'type' => 'integer', 'default' => 1 ),
				),
			) );
		}

		public static function rest_issues( WP_REST_Request $req ) {
			$handle = sanitize_title( (string) $req->get_param( 'handle' ) );
			$page   = max( 1, (int) $req->get_param( 'page' ) );

			$users = get_users( array(
				'meta_key'   => 'smll_handle',
				'meta_value' => $handle,
				'number'     => 1,
				'fields'     => 'ID',
			) );
			if ( ! $users ) {
				return new WP_Error( 'smll_unknown_publication', 'No such publication.', array( 'status' => 404 ) );
			}

			$owner = (int) $users[0];
			$pub   = array(
				'userId' => $owner,
				'handle' => $handle,
			);

			$topic = (string) $req->get_param( 'topic' );

			// The unfiltered view spends its newest letter on the hero, so its
			// pages are offset by one. A filtered view has no hero, so it is
			// not. Getting this wrong silently skips or repeats a letter.
			$base   = $topic ? 0 : min( 1, max( 0, (int) $req->get_param( 'base' ) ) );
			$offset = $base + ( $page * self::PER_PAGE );

			$posts = self::query( $owner, self::PER_PAGE, $offset, $topic );

			$html = '';
			foreach ( $posts as $p ) {
				$html .= self::list_item( $pub, $p );
			}

			$shown = $offset + count( $posts );

			return rest_ensure_response( array(
				'html'    => $html,
				'page'    => $page,
				'hasMore' => ( $shown < self::count( $owner, $topic ) ),
			) );
		}
	}
}
