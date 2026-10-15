<?php
/**
 * The public letter page: /n/{handle}/{slug}/
 * Runs before the two older renderers, redirects every alias of the handle to the
 * one canonical URL, and prints a page that carries its own metadata.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

add_action( 'template_redirect', 'sml_lls_route', -5 );
function sml_lls_route() {
	if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ! sml_lls_letters_ready() ) { return; }
	$path  = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	$parts = array_values( array_filter( explode( '/', $path ) ) );
	if ( count( $parts ) !== 3 || ! in_array( $parts[0], array( 'n', 'letters' ), true ) ) { return; }
	$row = sml_lls_letter_by_slug( $parts[2] );
	if ( ! $row ) { return; }
	$user_id  = get_current_user_id();
	$is_owner = $user_id && ( (int) $row['author_id'] === $user_id || user_can( $user_id, 'manage_options' ) );
	if ( $row['status'] !== 'published' && ! $is_owner ) { return; }
	$handle = sml_lls_handle( $row['author_id'] );
	if ( $parts[0] !== 'n' || sanitize_title( $parts[1] ) !== $handle ) {
		if ( in_array( sanitize_title( $parts[1] ), sml_lls_handle_aliases( $row['author_id'] ), true ) || $parts[0] === 'letters' ) {
			wp_safe_redirect( sml_lls_letter_url( $row ), 301 ); exit;
		}
		return;
	}
	sml_lls_render( $row, $is_owner );
}

function sml_lls_render( $row, $is_owner ) {
	$data      = sml_lls_get( $row['id'] );
	$letter    = sml_letters_public( $row, true );
	$pub       = sml_lls_publication( $row['author_id'] );
	$canonical = sml_lls_letter_url( $row );
	$user_id   = get_current_user_id();
	$unlocked  = empty( $letter['locked'] );
	$blocks    = sml_lls_blocks( $row );
	$tickers   = sml_lls_tickers( $row );
	$levels    = sml_lls_levels( $blocks );
	$accent    = $data['immersive']['accent'] ?: $pub['accent'];
	$indexable = sml_lls_is_indexable( $row, $data );
	$images    = sml_lls_card_images( $row, $data );
	$cover     = sml_lls_cover( $row, $data );
	$neigh     = sml_lls_neighbours( $row );
	$more      = sml_lls_more_from( $row, 5 );
	$reacts    = sml_lls_reaction_counts( $row['id'] );
	$published = $row['published_at'] ? date_i18n( 'M j, Y', strtotime( $row['published_at'] . ' UTC' ) ) : 'Draft preview';
	$audio     = $data['audio'];
	$intro     = ( ! empty( $data['intro']['enabled'] ) && ! empty( $data['intro']['url'] ) ) ? $data['intro'] : null;
	$imm       = $data['immersive'];
	$imm_on    = ( $imm['level'] ?? 'off' ) !== 'off';
	$body_html = $letter['html'];
	// the cover is shown once, by the page, never twice
	if ( $cover && strpos( $body_html, esc_url( $cover ) ) !== false ) { $show_cover = false; } else { $show_cover = (bool) $cover; }
	$login = add_query_arg( 'redirect_to', rawurlencode( $canonical ), home_url( '/sign-up-sign-in/' ) );

	$config = array(
		'base' => esc_url_raw( rest_url( 'sml-letters/v1' ) ), 'nonce' => wp_create_nonce( 'wp_rest' ), 'letterId' => (int) $row['id'], 'userId' => $user_id,
		'chartBase' => esc_url_raw( rest_url( 'sml-trading-floor/v1/chart/' ) ), 'tickerBase' => esc_url_raw( home_url( '/stocks/' ) ), 'loginUrl' => esc_url_raw( $login ),
	);
	$studio = array(
		'base' => esc_url_raw( rest_url( SML_LLS_NS ) ), 'subscribe' => esc_url_raw( rest_url( 'sml-loopletters/v1/subscribe' ) ), 'nonce' => wp_create_nonce( 'wp_rest' ),
		'letterId' => (int) $row['id'], 'handle' => $pub['handle'], 'url' => $canonical, 'title' => $row['title'], 'publication' => $pub['name'],
		'image' => $images['wide'] ?: $cover, 'reactions' => $reacts, 'reader' => $data['reader'], 'intro' => $intro, 'audio' => $audio, 'immersive' => $imm, 'accent' => $accent,
		'quotes' => 'https://stockmarketloop-loop-kick.onrender.com/api/quotes', 'tickers' => $tickers, 'isOwner' => $is_owner, 'reduced' => false,
	);

	status_header( 200 );
	header_remove( 'X-Robots-Tag' );
	header( 'X-Robots-Tag: ' . ( $indexable ? 'index, follow, max-image-preview:large' : 'noindex, follow' ) );
	header( 'Content-Type: text/html; charset=' . get_bloginfo( 'charset' ) );
	header( 'Cache-Control: ' . ( $user_id ? 'private, no-cache' : 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' ) );
	header( 'X-SML-Letter-Studio: ' . SML_LLS_VERSION );

	echo '<!doctype html><html ' . get_language_attributes() . '><head><meta charset="' . esc_attr( get_bloginfo( 'charset' ) ) . '"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';
	if ( function_exists( 'sml_ds_early_html' ) ) { echo sml_ds_early_html(); } // phpcs:ignore
	echo sml_lls_head( $row, $letter, $data, $pub, $canonical ); // phpcs:ignore
	echo '<meta name="theme-color" content="#0b1119">';
	if ( function_exists( 'sml_ds_head_html' ) ) { echo sml_ds_head_html(); } else { echo '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Archivo:wght@700;800&family=IBM+Plex+Mono:wght@500;600&display=swap">'; } // phpcs:ignore
	echo '<link rel="stylesheet" id="sml-lls-css" href="' . esc_url( sml_lls_asset( 'reader.css' ) ) . '">';
	if ( $cover ) { echo '<link rel="preload" as="image" href="' . esc_url( $cover ) . '" fetchpriority="high">'; }
	if ( $intro ) { echo '<link rel="preload" as="video" href="' . esc_url( $intro['url'] ) . '">'; }
	echo '</head>';

	$classes = array( 'lls-page', 'lp-reader-page', 'sml-ds', 'sml-global-header-on' );
	if ( $imm_on ) { $classes[] = 'lls-imm lls-imm-' . sanitize_html_class( $imm['level'] ); if ( ! empty( $imm['texture'] ) && $imm['texture'] !== 'none' ) { $classes[] = 'lls-tex-' . sanitize_html_class( $imm['texture'] ); } }
	if ( $intro ) { $classes[] = 'lls-has-intro'; }
	echo '<body class="' . esc_attr( implode( ' ', $classes ) ) . '" style="--lls-accent:' . esc_attr( $accent ) . ';--lls-accent-rgb:' . esc_attr( sml_lls_rgb( $accent ) ) . '">';

	/* intro video: a layer over the page, never a wall in front of the content for crawlers */
	if ( $intro ) {
		echo '<div class="lls-intro" id="lls-intro" hidden><video id="lls-intro-video" playsinline preload="auto" muted' . ( $intro['poster'] ? ' poster="' . esc_url( $intro['poster'] ) . '"' : '' ) . '><source src="' . esc_url( $intro['url'] ) . '" type="' . esc_attr( sml_lls_mime_from_url( $intro['url'] ) ) . '"></video>';
		echo '<div class="lls-intro-bar"><span class="lls-intro-pub">' . esc_html( $pub['name'] ) . '</span><button type="button" class="lls-intro-sound" id="lls-intro-sound">Sound on</button><button type="button" class="lls-intro-skip" id="lls-intro-skip">Skip intro</button></div><div class="lls-intro-progress"><i id="lls-intro-progress"></i></div></div>';
	}
	/* immersive layers */
	if ( $imm_on ) {
		$bg = '';
		if ( $imm['bg_mode'] === 'cover' && $cover ) { $bg = $cover; } elseif ( in_array( $imm['bg_mode'], array( 'upload', 'video' ), true ) && $imm['bg_url'] ) { $bg = $imm['bg_url']; }
		echo '<div class="lls-fx" id="lls-fx" aria-hidden="true">';
		if ( $bg && $imm['bg_mode'] === 'video' ) { echo '<video class="lls-fx-bg lls-fx-video" autoplay muted loop playsinline src="' . esc_url( $bg ) . '"></video>'; } elseif ( $bg ) { echo '<div class="lls-fx-bg" style="background-image:url(' . esc_url( $bg ) . ')"></div>'; }
		echo '<div class="lls-fx-scrim"></div><canvas id="lls-fx-canvas"></canvas></div>';
	}

	echo '<div class="lp-progress" id="lp-progress"></div>';
	echo '<header class="lls-top"><a class="lls-brand" href="' . esc_url( home_url( '/' ) ) . '"><img src="' . esc_url( sml_lls_site_logo() ) . '" alt="" width="34" height="34"><span>StockMarket<b>Loop</b></span></a>';
	echo '<a class="lls-top-pub" href="' . esc_url( $pub['url'] ) . '">' . esc_html( $pub['name'] ) . '</a><span class="lls-top-sp"></span>';
	echo '<button class="lls-top-btn" type="button" id="lp-bookmark" aria-label="Save this letter"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v17l-6-4.4L6 21z"/></svg><span>Save</span></button>';
	echo '<button class="lls-top-btn" type="button" id="lls-share-top" aria-label="Share"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg><span>Share</span></button>';
	echo '<a class="lls-top-cta" href="#lls-subscribe">' . esc_html( $pub['signup_button'] ) . '</a>';
	if ( $is_owner ) { echo '<a class="lls-top-btn lls-top-edit" href="' . esc_url( home_url( '/loop-letters/?letter=' . (int) $row['id'] ) ) . '">Edit</a>'; }
	echo '</header>';

	echo '<div class="lls-wrap"><main class="lls-main">';
	echo '<article class="lls-letter" itemscope>';
	echo '<div class="lls-kicker"><span class="lls-tag">' . esc_html( $row['content_type'] ?: 'Analysis' ) . '</span>';
	foreach ( array_slice( $tickers, 0, 5 ) as $s ) { echo '<a class="lls-chip" data-lp-sym="' . esc_attr( $s ) . '" href="' . esc_url( home_url( '/stocks/' . strtolower( $s ) . '/' ) ) . '"><b>$' . esc_html( $s ) . '</b><em></em></a>'; }
	echo '</div>';
	echo '<h1 class="lp-title lls-title">' . esc_html( $row['title'] ) . '</h1>';
	if ( $row['subtitle'] ) { echo '<p class="lp-sub lls-sub">' . esc_html( $row['subtitle'] ) . '</p>'; }
	echo '<div class="lls-byline"><a class="lls-byline-avatar" href="' . esc_url( $pub['author_url'] ) . '"><img src="' . esc_url( $pub['avatar'] ) . '" alt="" width="44" height="44"></a><div class="lls-byline-text">';
	echo '<a class="lls-byline-name" href="' . esc_url( $pub['author_url'] ) . '">' . esc_html( $pub['author_name'] ) . '</a><a class="lls-byline-pub" href="' . esc_url( $pub['url'] ) . '">' . esc_html( $pub['name'] ) . '</a>';
	echo '<span class="lls-byline-meta"><time datetime="' . esc_attr( sml_lls_iso( $row['published_at'] ?: $row['created_at'] ) ) . '">' . esc_html( $published ) . '</time> · ' . (int) max( 1, $row['read_minutes'] ) . ' min read' . ( (int) $row['read_count'] > 0 ? ' · ' . number_format( (int) $row['read_count'] ) . ' reads' : '' ) . '</span></div></div>';

	if ( $audio['mode'] === 'upload' && $audio['url'] ) {
		echo '<div class="lls-audio" id="lls-audio" data-mode="upload"><button type="button" class="lls-audio-play" id="lls-audio-play" aria-label="Play"><i></i></button><div class="lls-audio-body"><b>' . esc_html( $audio['title'] ?: 'Listen to this letter' ) . '</b><span class="lls-audio-sub">Read by ' . esc_html( $pub['author_name'] ) . ( $audio['seconds'] ? ' · ' . esc_html( sml_lls_mmss( $audio['seconds'] ) ) : '' ) . '</span><div class="lls-audio-track" id="lls-audio-track"><i id="lls-audio-fill"></i></div></div><div class="lls-audio-wave" id="lls-audio-wave"></div><button type="button" class="lls-audio-rate" id="lls-audio-rate">1×</button><audio id="lls-audio-el" preload="metadata" src="' . esc_url( $audio['url'] ) . '"></audio></div>';
	} elseif ( $audio['mode'] === 'youtube' && sml_lls_youtube_id( $audio['youtube'] ) ) {
		echo '<div class="lls-audio" id="lls-audio" data-mode="youtube" data-yt="' . esc_attr( sml_lls_youtube_id( $audio['youtube'] ) ) . '"><button type="button" class="lls-audio-play" id="lls-audio-play" aria-label="Play"><i></i></button><div class="lls-audio-body"><b>' . esc_html( $audio['title'] ?: 'Soundtrack for this letter' ) . '</b><span class="lls-audio-sub">Audio only · tap to play</span><div class="lls-audio-track" id="lls-audio-track"><i id="lls-audio-fill"></i></div></div><div class="lls-audio-wave" id="lls-audio-wave"></div><button type="button" class="lls-audio-rate lls-audio-vol" id="lls-audio-vol" aria-label="Mute">♪</button></div>';
	}

	if ( $show_cover ) { echo '<figure class="lls-cover"><img src="' . esc_url( $cover ) . '" alt="' . esc_attr( $row['title'] ) . '" width="1200" height="630" fetchpriority="high" decoding="async"></figure>'; }

	echo '<div class="lls-body">';
	if ( ! empty( $data['reader']['toc'] ) ) { echo '<nav class="lls-toc" id="lls-toc" aria-label="In this letter" hidden><b>In this letter</b><ol id="lls-toc-list"></ol></nav>'; }
	echo '<div class="lp-article lls-article" id="lp-article">' . $body_html . '</div>'; // phpcs:ignore
	echo '</div>';

	if ( ! $unlocked ) {
		echo '<div class="lp-lock lp-gated lls-lock">';
		if ( $row['visibility'] === 'subscribers' ) { echo '<h3>This letter is for followers</h3><p>Follow ' . esc_html( $pub['author_name'] ) . ' to read the rest.</p><a class="lls-cta" href="' . esc_url( $pub['author_url'] ) . '">Follow ' . esc_html( $pub['author_name'] ) . '</a>'; }
		else { echo '<h3>Sign in to keep reading</h3><p>This letter is for StockMarketLoop members.</p><a class="lls-cta" href="' . esc_url( $login ) . '">Sign in</a>'; }
		echo '</div>';
	}

	if ( ! empty( $data['reader']['reactions'] ) || ! empty( $data['reader']['share_bar'] ) ) {
		echo '<div class="lls-engage">';
		if ( ! empty( $data['reader']['reactions'] ) ) {
			echo '<div class="lls-react" id="lls-react" role="group" aria-label="React">';
			foreach ( array( 'bull' => array( '📈', 'Bullish' ), 'bear' => array( '📉', 'Bearish' ), 'fire' => array( '🔥', 'Fire' ), 'mind' => array( '🧠', 'Smart' ) ) as $k => $v ) {
				echo '<button type="button" data-react="' . $k . '"><span class="lls-react-ico">' . $v[0] . '</span><span class="lls-react-label">' . $v[1] . '</span><b data-count>' . (int) $reacts[ $k ] . '</b></button>';
			}
			echo '</div>';
		}
		if ( ! empty( $data['reader']['share_bar'] ) ) {
			echo '<div class="lls-share" id="lls-share"><button type="button" data-share="x">Post on X</button><button type="button" data-share="threads">Threads</button><button type="button" data-share="linkedin">LinkedIn</button><button type="button" data-share="copy">Copy link</button>' . ( ( $images['wide'] ?: $cover ) ? '<a data-share="card" href="' . esc_url( $images['wide'] ?: $cover ) . '" download>Share card</a>' : '' ) . '</div>';
		}
		echo '</div>';
	}

	if ( ! empty( $data['reader']['subscribe_box'] ) ) {
		echo '<section class="lls-subscribe" id="lls-subscribe"><div class="lls-subscribe-art">' . ( $pub['logo'] ? '<img src="' . esc_url( $pub['logo'] ) . '" alt="">' : '<img src="' . esc_url( $pub['avatar'] ) . '" alt="">' ) . '</div><div class="lls-subscribe-body"><b>' . esc_html( $pub['name'] ) . '</b><p>' . esc_html( $pub['signup_copy'] ) . '</p>';
		echo '<form class="lls-subscribe-form" id="lls-subscribe-form"><input type="hidden" name="handle" value="' . esc_attr( $pub['handle'] ) . '"><input type="hidden" name="source" value="letter-page"><input type="email" name="email" required autocomplete="email" placeholder="you@example.com" aria-label="Your email"><button type="submit">' . esc_html( $pub['signup_button'] ) . '</button></form><small class="lls-subscribe-note" id="lls-subscribe-note">Free. Confirm by email. One click to leave.</small>';
		echo '</div></section>';
	}

	if ( ! empty( $data['reader']['next_issue'] ) && ( $neigh['prev'] || $neigh['next'] ) ) {
		echo '<nav class="lls-next" aria-label="More issues">';
		foreach ( array( 'prev' => 'Previous issue', 'next' => 'Next issue' ) as $k => $label ) {
			if ( ! $neigh[ $k ] ) { continue; }
			$n = $neigh[ $k ];
			echo '<a class="lls-next-card lls-next-' . $k . '" href="' . esc_url( sml_lls_letter_url( $n ) ) . '"><small>' . $label . '</small><b>' . esc_html( $n['title'] ) . '</b><span>' . (int) max( 1, $n['read_minutes'] ) . ' min read</span></a>';
		}
		echo '</nav>';
	}

	echo '<section class="lp-comments lls-comments"><h3>Discussion (' . (int) $row['comment_count'] . ')</h3>';
	if ( $user_id && $unlocked ) { echo '<div class="lp-compose lls-compose"><img src="' . esc_url( get_avatar_url( $user_id, array( 'size' => 80 ) ) ) . '" alt=""><div class="lp-compose-body"><textarea id="lp-comment-box" placeholder="Add to the discussion"></textarea><div class="lp-compose-bar"><button class="lp-send lls-cta" id="lp-comment-send" disabled>Post comment</button></div></div></div>'; }
	elseif ( ! $user_id ) { echo '<div class="lp-empty"><a href="' . esc_url( $login ) . '">Sign in</a> to join the discussion.</div>'; }
	else { echo '<div class="lp-empty">Unlock the letter to join the discussion.</div>'; }
	echo '<div id="lp-comment-list"></div></section>';
	echo '</article></main>';

	echo '<aside class="lls-rail">';
	if ( $levels && ! empty( $data['reader']['levels_card'] ) ) {
		foreach ( array_slice( $levels, 0, 2 ) as $lv ) {
			echo '<div class="lls-card lls-levels"><h4>$' . esc_html( $lv['symbol'] ) . ' levels' . ( $lv['timeframe'] ? ' <span>' . esc_html( $lv['timeframe'] ) . '</span>' : '' ) . '</h4><dl>';
			foreach ( array( 'entry' => 'Entry', 'stop' => 'Stop', 'target1' => 'Target 1', 'target2' => 'Target 2' ) as $k => $label ) { echo '<div><dt>' . $label . '</dt><dd class="lls-' . $k . '">' . esc_html( $lv[ $k ] !== '' ? $lv[ $k ] : '–' ) . '</dd></div>'; }
			echo '</dl><a class="lls-card-link" href="' . esc_url( home_url( '/stocks/' . strtolower( $lv['symbol'] ) . '/' ) ) . '">Open $' . esc_html( $lv['symbol'] ) . ' terminal</a></div>';
		}
	}
	if ( $tickers ) {
		echo '<div class="lls-card"><h4>Tickers in this letter</h4>';
		foreach ( $tickers as $s ) { echo '<a class="lp-symrow lls-symrow" data-lp-sym="' . esc_attr( $s ) . '" href="' . esc_url( home_url( '/stocks/' . strtolower( $s ) . '/' ) ) . '"><b>$' . esc_html( $s ) . '</b><em>···</em></a>'; }
		echo '</div>';
	}
	echo '<div class="lls-card lls-pubcard"><div class="lls-pubcard-head">' . ( $pub['logo'] ? '<img src="' . esc_url( $pub['logo'] ) . '" alt="">' : '<img src="' . esc_url( $pub['avatar'] ) . '" alt="">' ) . '<div><b>' . esc_html( $pub['name'] ) . '</b><span>by ' . esc_html( $pub['author_name'] ) . '</span></div></div>';
	if ( $pub['tagline'] ) { echo '<p>' . esc_html( $pub['tagline'] ) . '</p>'; }
	echo '<a class="lls-cta lls-cta-wide" href="#lls-subscribe">' . esc_html( $pub['signup_button'] ) . '</a><a class="lls-card-link" href="' . esc_url( $pub['url'] ) . '">All issues</a></div>';
	if ( $more ) {
		echo '<div class="lls-card"><h4>More from ' . esc_html( $pub['name'] ) . '</h4>';
		foreach ( $more as $m ) { echo '<a class="lls-more" href="' . esc_url( sml_lls_letter_url( $m ) ) . '"><b>' . esc_html( $m['title'] ) . '</b><span>' . esc_html( date_i18n( 'M j', strtotime( $m['published_at'] . ' UTC' ) ) ) . ' · ' . (int) max( 1, $m['read_minutes'] ) . ' min</span></a>'; }
		echo '</div>';
	}
	echo '<div class="lls-card lls-stats"><div><span>Words</span><b>' . number_format( (int) $row['word_count'] ) . '</b></div><div><span>Reads</span><b>' . number_format( (int) $row['read_count'] ) . '</b></div><div><span>Saves</span><b>' . number_format( (int) $row['bookmark_count'] ) . '</b></div><div><span>Access</span><b>' . esc_html( ucfirst( $row['visibility'] ) ) . '</b></div></div>';
	echo '</aside></div>';

	echo '<footer class="lls-foot"><a href="' . esc_url( home_url( '/n/' ) ) . '">All Loop Letters</a> · <a href="' . esc_url( home_url( '/news/' ) ) . '">News</a> · <a href="' . esc_url( home_url( '/privacy/' ) ) . '">Privacy</a> · <a href="' . esc_url( home_url( '/terms/' ) ) . '">Terms</a><span>Market commentary, not investment advice. © ' . esc_html( gmdate( 'Y' ) ) . ' ' . esc_html( get_bloginfo( 'name' ) ) . '</span></footer>';

	echo '<div class="lls-quote-pop" id="lls-quote-pop" hidden><button type="button" data-quote="x">Share quote on X</button><button type="button" data-quote="copy">Copy quote</button></div>';
	echo '<script>window.smlLetterPage=' . wp_json_encode( $config ) . ';window.smlLLS=' . wp_json_encode( $studio ) . ';</script>';
	if ( function_exists( 'sml_letters_public_script' ) ) { echo '<script>' . sml_letters_public_script() . '</script>'; } // phpcs:ignore
	echo '<script src="' . esc_url( sml_lls_asset( 'reader.js' ) ) . '" defer></script>';
	if ( $imm_on ) { echo '<script src="' . esc_url( sml_lls_asset( 'letter-fx.js' ) ) . '" defer></script>'; }
	if ( function_exists( 'sml_ds_footer_html' ) ) { echo sml_ds_footer_html(); } // phpcs:ignore
	echo '</body></html>';
	exit;
}

function sml_lls_rgb( $hex ) {
	$hex = ltrim( (string) $hex, '#' ); if ( strlen( $hex ) === 3 ) { $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2]; }
	if ( strlen( $hex ) !== 6 ) { return '56,245,138'; }
	return hexdec( substr( $hex, 0, 2 ) ) . ',' . hexdec( substr( $hex, 2, 2 ) ) . ',' . hexdec( substr( $hex, 4, 2 ) );
}
function sml_lls_mmss( $s ) { $s = (int) round( $s ); return floor( $s / 60 ) . ':' . str_pad( $s % 60, 2, '0', STR_PAD_LEFT ); }
function sml_lls_youtube_id( $url ) {
	if ( preg_match( '#(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\.be/)([A-Za-z0-9_-]{11})#', (string) $url, $m ) ) { return $m[1]; }
	return preg_match( '/^[A-Za-z0-9_-]{11}$/', (string) $url ) ? (string) $url : '';
}
