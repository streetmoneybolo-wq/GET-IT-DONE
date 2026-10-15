<?php
/**
 * Share-card renderer. Draws the letter's link preview with GD in the three ratios
 * search and social crawlers ask for (1200×630, 1200×900, 1200×1200), using the
 * site's own typefaces so the card matches the page it links to.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SML_LLS_CARD_VERSION', '3' );

function sml_lls_card_images( $row, $data ) {
	$imgs = isset( $data['card']['images'] ) && is_array( $data['card']['images'] ) ? $data['card']['images'] : array();
	return array( 'wide' => (string) ( $imgs['wide'] ?? '' ), 'standard' => (string) ( $imgs['standard'] ?? '' ), 'square' => (string) ( $imgs['square'] ?? '' ) );
}

function sml_lls_card_font( $name ) {
	$map = array(
		'display' => 'Archivo-ExtraBold.ttf', 'display2' => 'Archivo-Bold.ttf',
		'sans' => 'IBMPlexSans-Regular.ttf', 'sans-semi' => 'IBMPlexSans-SemiBold.ttf', 'sans-bold' => 'IBMPlexSans-Bold.ttf',
		'mono' => 'IBMPlexMono-Medium.ttf', 'mono-semi' => 'IBMPlexMono-SemiBold.ttf',
	);
	return SML_LLS_DIR . '/assets/fonts/' . ( $map[ $name ] ?? $map['sans'] );
}

function sml_lls_card_themes() {
	return array(
		'dark'  => array( 'bg' => '#0b1119', 'bg2' => '#101a26', 'fg' => '#ffffff', 'muted' => '#9fb0c3', 'chip' => '#182533', 'chipfg' => '#dbe6f2' ),
		'green' => array( 'bg' => '#06130c', 'bg2' => '#0b2416', 'fg' => '#f2fff6', 'muted' => '#8fb79e', 'chip' => '#10301d', 'chipfg' => '#c9f5d8' ),
		'ink'   => array( 'bg' => '#f4f1ea', 'bg2' => '#e9e3d6', 'fg' => '#121417', 'muted' => '#5d6470', 'chip' => '#e2dccd', 'chipfg' => '#1b1f26' ),
		'slate' => array( 'bg' => '#1a1d24', 'bg2' => '#242a35', 'fg' => '#f6f7fb', 'muted' => '#a7afbf', 'chip' => '#2c3442', 'chipfg' => '#e6eaf2' ),
	);
}

function sml_lls_card_sizes() {
	return array( 'wide' => array( 1200, 630 ), 'standard' => array( 1200, 900 ), 'square' => array( 1200, 1200 ) );
}

/** Everything the card is drawn from, resolved from the letter, the publication and the creator's choices. */
function sml_lls_card_spec( $row, $data, $overrides = array() ) {
	$card = sml_lls_merge( $data['card'], $overrides );
	$pub  = sml_lls_publication( $row['author_id'] );
	$blocks = sml_lls_blocks( $row );
	$quote = '';
	foreach ( $blocks as $b ) { if ( ( $b['type'] ?? '' ) === 'quote' && ! empty( $b['text'] ) ) { $quote = (string) $b['text']; break; } }
	if ( ! $quote ) { $quote = (string) ( $row['tldr'] ?: $row['subtitle'] ); }
	$bg = '';
	if ( $card['bg'] === 'cover' ) { $bg = sml_lls_cover( $row, $data ); }
	elseif ( $card['bg'] === 'upload' ) { $bg = (string) $card['bg_url']; }
	$spec = array(
		'template' => in_array( $card['template'], array( 'headline', 'chart', 'levels', 'quote' ), true ) ? $card['template'] : 'headline',
		'theme'    => isset( sml_lls_card_themes()[ $card['theme'] ] ) ? $card['theme'] : 'dark',
		'kicker'   => sml_lls_card_text( $card['kicker'] ?: $pub['name'] ),
		'title'    => sml_lls_card_text( $card['title'] ?: $row['title'] ),
		'subtitle' => sml_lls_card_text( $card['subtitle'] ?: ( $row['subtitle'] ?: '' ) ),
		'quote'    => sml_lls_card_text( $quote ),
		'accent'   => $card['accent'] ?: ( $data['immersive']['accent'] ?: $pub['accent'] ),
		'bg'       => $bg, 'bg_id' => (int) ( $card['bg'] === 'upload' ? $card['bg_id'] : $data['cover']['id'] ),
		'tickers'  => ! empty( $card['show_tickers'] ) ? array_slice( sml_lls_tickers( $row ), 0, 4 ) : array(),
		'avatar'   => ! empty( $card['show_avatar'] ) ? ( $pub['logo'] ?: $pub['avatar'] ) : '',
		'author'   => $pub['author_name'], 'publication' => $pub['name'], 'domain' => wp_parse_url( home_url(), PHP_URL_HOST ),
		'minutes'  => (int) max( 1, $row['read_minutes'] ), 'date' => $row['published_at'] ? gmdate( 'M j, Y', strtotime( $row['published_at'] . ' UTC' ) ) : gmdate( 'M j, Y' ),
		'levels'   => sml_lls_levels( $blocks ), 'prices' => array(), 'series' => array(),
	);
	if ( ! empty( $card['show_price'] ) && $spec['tickers'] ) { $spec['prices'] = sml_lls_card_prices( $spec['tickers'] ); }
	if ( $spec['template'] === 'chart' && $spec['tickers'] ) { $spec['series'] = sml_lls_card_series( $spec['tickers'][0] ); }
	return $spec;
}

function sml_lls_card_text( $s ) {
	$s = html_entity_decode( wp_strip_all_tags( (string) $s ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
	$s = preg_replace( '/[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{FE0F}\x{200D}]/u', '', $s ); // GD cannot draw emoji
	return trim( preg_replace( '/\s+/u', ' ', $s ) );
}

function sml_lls_card_prices( $symbols ) {
	$key = 'sml_lls_px_' . md5( implode( ',', $symbols ) );
	$hit = get_transient( $key );
	if ( is_array( $hit ) ) { return $hit; }
	$out = array();
	$r = wp_remote_get( 'https://stockmarketloop-loop-kick.onrender.com/api/quotes?symbols=' . rawurlencode( implode( ',', $symbols ) ), array( 'timeout' => 6 ) );
	if ( ! is_wp_error( $r ) ) {
		$j = json_decode( wp_remote_retrieve_body( $r ), true );
		foreach ( (array) ( $j['quotes'] ?? array() ) as $sym => $q ) {
			if ( ! isset( $q['last'] ) || ! $q['last'] ) { continue; }
			$out[ strtoupper( $sym ) ] = array( 'last' => (float) $q['last'], 'pct' => (float) ( $q['pct'] ?? 0 ) );
		}
	}
	set_transient( $key, $out, 120 );
	return $out;
}

function sml_lls_card_series( $symbol ) {
	$key = 'sml_lls_series_' . $symbol;
	$hit = get_transient( $key );
	if ( is_array( $hit ) ) { return $hit; }
	$out = array();
	$r = wp_remote_get( 'https://stockmarketloop-loop-kick.onrender.com/api/history?symbol=' . rawurlencode( $symbol ) . '&tf=1D', array( 'timeout' => 8 ) );
	if ( ! is_wp_error( $r ) ) {
		$j = json_decode( wp_remote_retrieve_body( $r ), true );
		foreach ( (array) ( $j['bars'] ?? array() ) as $c ) {
			$v = is_array( $c ) ? ( $c['c'] ?? ( $c['close'] ?? null ) ) : null;
			if ( is_numeric( $v ) ) { $out[] = (float) $v; }
		}
		$out = array_slice( $out, -63 ); // about three months of sessions
	}
	set_transient( $key, $out, 900 );
	return $out;
}

/* ---------------- drawing helpers ---------------- */

function sml_lls_hex( $im, $hex, $alpha = 0 ) {
	$hex = ltrim( (string) $hex, '#' );
	if ( strlen( $hex ) === 3 ) { $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2]; }
	if ( strlen( $hex ) !== 6 ) { $hex = '38f58a'; }
	return imagecolorallocatealpha( $im, hexdec( substr( $hex, 0, 2 ) ), hexdec( substr( $hex, 2, 2 ) ), hexdec( substr( $hex, 4, 2 ) ), (int) $alpha );
}

function sml_lls_text_width( $font, $size, $text ) {
	$b = imagettfbbox( $size, 0, $font, $text );
	return $b ? abs( $b[2] - $b[0] ) : 0;
}

/** Word-wrap to a pixel width; returns lines. */
function sml_lls_wrap( $font, $size, $text, $max_w ) {
	$words = preg_split( '/\s+/u', trim( $text ) );
	$lines = array(); $cur = '';
	foreach ( $words as $w ) {
		$try = $cur === '' ? $w : $cur . ' ' . $w;
		if ( sml_lls_text_width( $font, $size, $try ) <= $max_w ) { $cur = $try; continue; }
		if ( $cur !== '' ) { $lines[] = $cur; }
		// a single word wider than the box gets broken hard
		while ( sml_lls_text_width( $font, $size, $w ) > $max_w && mb_strlen( $w ) > 2 ) {
			$n = mb_strlen( $w ); $cut = $n;
			while ( $cut > 1 && sml_lls_text_width( $font, $size, mb_substr( $w, 0, $cut ) . '-' ) > $max_w ) { $cut--; }
			$lines[] = mb_substr( $w, 0, $cut ) . '-'; $w = mb_substr( $w, $cut );
		}
		$cur = $w;
	}
	if ( $cur !== '' ) { $lines[] = $cur; }
	return $lines;
}

/** Shrinks the font until the text fits the lines allowed; returns [size, lines]. */
function sml_lls_fit( $font, $size, $min, $text, $max_w, $max_lines ) {
	for ( $s = $size; $s >= $min; $s -= 2 ) {
		$lines = sml_lls_wrap( $font, $s, $text, $max_w );
		if ( count( $lines ) <= $max_lines ) { return array( $s, $lines ); }
	}
	$lines = sml_lls_wrap( $font, $min, $text, $max_w );
	if ( count( $lines ) > $max_lines ) { $lines = array_slice( $lines, 0, $max_lines ); $lines[ $max_lines - 1 ] = rtrim( mb_substr( $lines[ $max_lines - 1 ], 0, -1 ), ' ,.;:' ) . '…'; }
	return array( $min, $lines );
}

/** Draws lines top-down from a baseline-origin; returns the y after the block. */
function sml_lls_lines( $im, $font, $size, $lines, $x, $y, $color, $leading = 1.12 ) {
	$lh = (int) round( $size * $leading );
	foreach ( $lines as $line ) { imagettftext( $im, $size, 0, $x, $y + $size, $color, $font, $line ); $y += $lh; }
	return $y;
}

function sml_lls_round_rect( $im, $x, $y, $w, $h, $r, $color ) {
	$r = (int) min( $r, $w / 2, $h / 2 );
	imagefilledrectangle( $im, $x + $r, $y, $x + $w - $r, $y + $h, $color );
	imagefilledrectangle( $im, $x, $y + $r, $x + $w, $y + $h - $r, $color );
	foreach ( array( array( $x + $r, $y + $r ), array( $x + $w - $r, $y + $r ), array( $x + $r, $y + $h - $r ), array( $x + $w - $r, $y + $h - $r ) ) as $c ) { imagefilledellipse( $im, $c[0], $c[1], $r * 2, $r * 2, $color ); }
}

function sml_lls_gradient( $im, $x, $y, $w, $h, $hex, $from_alpha, $to_alpha ) {
	$steps = max( 1, $h );
	for ( $i = 0; $i < $steps; $i++ ) {
		$a = (int) round( $from_alpha + ( $to_alpha - $from_alpha ) * ( $i / $steps ) );
		imageline( $im, $x, $y + $i, $x + $w, $y + $i, sml_lls_hex( $im, $hex, max( 0, min( 127, $a ) ) ) );
	}
}

function sml_lls_load_image( $url, $attachment_id = 0 ) {
	$bytes = '';
	if ( $attachment_id ) { $path = get_attached_file( $attachment_id ); if ( $path && is_readable( $path ) ) { $bytes = (string) file_get_contents( $path ); } } // phpcs:ignore
	if ( ! $bytes && $url ) {
		$uploads = wp_get_upload_dir();
		if ( strpos( $url, $uploads['baseurl'] ) === 0 ) { $path = $uploads['basedir'] . substr( $url, strlen( $uploads['baseurl'] ) ); if ( is_readable( $path ) ) { $bytes = (string) file_get_contents( $path ); } } // phpcs:ignore
	}
	if ( ! $bytes && $url ) {
		$r = wp_remote_get( $url, array( 'timeout' => 10, 'limit_response_size' => 12 * 1024 * 1024 ) );
		if ( ! is_wp_error( $r ) && (int) wp_remote_retrieve_response_code( $r ) === 200 ) { $bytes = (string) wp_remote_retrieve_body( $r ); }
	}
	if ( ! $bytes ) { return null; }
	$im = @imagecreatefromstring( $bytes ); // phpcs:ignore
	return $im ?: null;
}

/** Scales and crops a source image to fill a box ("object-fit: cover"). */
function sml_lls_cover_fit( $dst, $src, $x, $y, $w, $h ) {
	$sw = imagesx( $src ); $sh = imagesy( $src );
	if ( ! $sw || ! $sh ) { return; }
	$scale = max( $w / $sw, $h / $sh );
	$cw = (int) round( $w / $scale ); $ch = (int) round( $h / $scale );
	$cx = (int) round( ( $sw - $cw ) / 2 ); $cy = (int) round( ( $sh - $ch ) * 0.35 );
	imagecopyresampled( $dst, $src, $x, $y, $cx, $cy, $w, $h, $cw, $ch );
}

function sml_lls_circle_image( $src, $d ) {
	$out = imagecreatetruecolor( $d, $d );
	imagesavealpha( $out, true ); imagealphablending( $out, false );
	$clear = imagecolorallocatealpha( $out, 0, 0, 0, 127 );
	imagefill( $out, 0, 0, $clear );
	imagealphablending( $out, true );
	sml_lls_cover_fit( $out, $src, 0, 0, $d, $d );
	imagealphablending( $out, false );
	$r = $d / 2;
	for ( $yy = 0; $yy < $d; $yy++ ) {
		for ( $xx = 0; $xx < $d; $xx++ ) {
			$dist = sqrt( ( $xx - $r + 0.5 ) ** 2 + ( $yy - $r + 0.5 ) ** 2 );
			if ( $dist > $r ) { imagesetpixel( $out, $xx, $yy, $clear ); }
			elseif ( $dist > $r - 1.2 ) { $c = imagecolorsforindex( $out, imagecolorat( $out, $xx, $yy ) ); imagesetpixel( $out, $xx, $yy, imagecolorallocatealpha( $out, $c['red'], $c['green'], $c['blue'], (int) min( 127, 127 * ( $dist - ( $r - 1.2 ) ) / 1.2 ) ) ); }
		}
	}
	return $out;
}

/* ---------------- the card ---------------- */

function sml_lls_card_draw( $spec, $w, $h ) {
	$t  = sml_lls_card_themes()[ $spec['theme'] ];
	$im = imagecreatetruecolor( $w, $h );
	imagealphablending( $im, true ); imagesavealpha( $im, false );
	imagefilledrectangle( $im, 0, 0, $w, $h, sml_lls_hex( $im, $t['bg'] ) );
	$light = $spec['theme'] === 'ink';
	$pad   = (int) round( $w * 0.06 );
	$square = $h >= $w;

	// background image, darkened so type stays readable
	$has_bg = false;
	if ( $spec['bg'] ) {
		$src = sml_lls_load_image( $spec['bg'], $spec['bg_id'] );
		if ( $src ) {
			sml_lls_cover_fit( $im, $src, 0, 0, $w, $h ); imagedestroy( $src ); $has_bg = true;
			imagefilledrectangle( $im, 0, 0, $w, $h, sml_lls_hex( $im, $t['bg'], $light ? 70 : 60 ) );
			sml_lls_gradient( $im, 0, (int) ( $h * 0.25 ), $w, (int) ( $h * 0.75 ), $t['bg'], 120, 12 );
		}
	}
	if ( ! $has_bg ) {
		// a quiet diagonal wash plus a faint grid, so a plain card still has depth
		sml_lls_gradient( $im, 0, 0, $w, $h, $t['bg2'], 60, 127 );
		$grid = sml_lls_hex( $im, $t['fg'], $light ? 120 : 122 );
		for ( $x = $pad; $x < $w; $x += 60 ) { imageline( $im, $x, 0, $x, $h, $grid ); }
		for ( $y = 0; $y < $h; $y += 60 ) { imageline( $im, 0, $y, $w, $y, $grid ); }
		// accent glow top-right
		for ( $i = 0; $i < 14; $i++ ) { imagefilledellipse( $im, (int) ( $w * 0.86 ), (int) ( $h * 0.12 ), (int) ( $w * 0.55 - $i * 20 ), (int) ( $w * 0.55 - $i * 20 ), sml_lls_hex( $im, $spec['accent'], 124 ) ); }
	}

	$fg = sml_lls_hex( $im, $t['fg'] ); $muted = sml_lls_hex( $im, $t['muted'] ); $accent = sml_lls_hex( $im, $spec['accent'] );
	$f_display = sml_lls_card_font( 'display' ); $f_sans = sml_lls_card_font( 'sans' ); $f_semi = sml_lls_card_font( 'sans-semi' ); $f_mono = sml_lls_card_font( 'mono-semi' );

	// top band: accent mark + kicker, date on the right
	$ky = $pad;
	imagefilledrectangle( $im, $pad, $ky, $pad + 10, $ky + 30, $accent );
	imagettftext( $im, 22, 0, $pad + 26, $ky + 25, $fg, $f_mono, mb_strtoupper( sml_lls_trim( $spec['kicker'], 42 ) ) );
	$date = $spec['date'] . '  ·  ' . $spec['minutes'] . ' MIN READ';
	imagettftext( $im, 20, 0, $w - $pad - sml_lls_text_width( $f_mono, 20, $date ), $ky + 25, $muted, $f_mono, $date );

	// bottom band: avatar, author, publication, domain; tickers right
	$by   = $h - $pad;
	$av_d = $square ? 84 : 68;
	$bx   = $pad;
	if ( $spec['avatar'] ) {
		$asrc = sml_lls_load_image( $spec['avatar'] );
		if ( $asrc ) { $circle = sml_lls_circle_image( $asrc, $av_d ); imagecopy( $im, $circle, $bx, $by - $av_d, 0, 0, $av_d, $av_d ); imagedestroy( $circle ); imagedestroy( $asrc ); $bx += $av_d + 18; }
	}
	// ticker chips, measured first so the byline can make room for them
	$chips = array(); $chips_w = 0;
	foreach ( $spec['tickers'] as $sym ) {
		$label = '$' . $sym;
		$pxs = $spec['prices'][ $sym ] ?? null;
		if ( $pxs ) { $label .= ( $pxs['pct'] >= 0 ? '  +' : '  ' ) . number_format( $pxs['pct'], 2 ) . '%'; }
		$tw = sml_lls_text_width( $f_mono, 20, $label ) + 36;
		if ( $chips_w + $tw + 12 > $w * 0.52 ) { break; }
		$chips[] = array( $label, $tw, $pxs ); $chips_w += $tw + 12;
	}
	$chips_bottom_y = $by - $av_d / 2;
	$chip_h = 46; $cx = $w - $pad;
	foreach ( array_reverse( $chips ) as $c ) {
		list( $label, $tw, $pxs ) = $c;
		$cx -= $tw;
		sml_lls_round_rect( $im, $cx, (int) ( $chips_bottom_y - $chip_h / 2 ), $tw, $chip_h, 12, sml_lls_hex( $im, $t['chip'], $has_bg ? 30 : 0 ) );
		$col = $pxs ? ( $pxs['pct'] >= 0 ? sml_lls_hex( $im, $light ? '#117a3e' : '#38f58a' ) : sml_lls_hex( $im, $light ? '#b3261e' : '#ff6b6b' ) ) : sml_lls_hex( $im, $t['chipfg'] );
		imagettftext( $im, 20, 0, $cx + 18, (int) ( $chips_bottom_y + 7 ), $col, $f_mono, $label );
		$cx -= 12;
	}
	$byline_w = ( $chips ? $cx - 20 : $w - $pad ) - $bx;
	$author  = sml_lls_fit_width( $f_semi, 26, $spec['author'], $byline_w );
	$publine = $spec['publication'] . '  ·  ' . $spec['domain'];
	if ( sml_lls_text_width( $f_sans, 21, $publine ) > $byline_w ) { $publine = $spec['publication']; }
	if ( sml_lls_text_width( $f_sans, 21, $publine ) > $byline_w ) { $publine = $spec['domain']; }
	$publine = sml_lls_fit_width( $f_sans, 21, $publine, $byline_w );
	imagettftext( $im, 26, 0, $bx, $by - $av_d / 2 - 6, $fg, $f_semi, $author );
	imagettftext( $im, 21, 0, $bx, $by - $av_d / 2 + 24, $muted, $f_sans, $publine );

	// middle: template body
	$text_w   = $w - 2 * $pad;
	$top      = $ky + 70;
	$bottom   = $by - $av_d - 40;
	$region_h = $bottom - $top;

	if ( $spec['template'] === 'levels' && $spec['levels'] ) {
		$panel_w = $square ? $text_w : (int) ( $text_w * 0.4 );
		$lv = $spec['levels'][0];
		$ph = 44 * 5 + 40;
		$px = $square ? $pad : $w - $pad - $panel_w;
		$py = $square ? $bottom - $ph : $top + (int) ( ( $region_h - $ph ) / 2 );
		sml_lls_round_rect( $im, $px, $py, $panel_w, $ph, 18, sml_lls_hex( $im, $t['chip'], $has_bg ? 20 : 0 ) );
		$head = '$' . $lv['symbol'] . ' LEVELS' . ( $lv['timeframe'] ? '  ·  ' . mb_strtoupper( $lv['timeframe'] ) : '' );
		if ( sml_lls_text_width( $f_mono, 24, $head ) > $panel_w - 48 ) { $head = '$' . $lv['symbol'] . ' LEVELS'; }
		imagettftext( $im, 24, 0, $px + 24, $py + 46, $fg, $f_mono, sml_lls_fit_width( $f_mono, 24, $head, $panel_w - 48 ) );
		$rows = array( array( 'Entry', $lv['entry'], $t['fg'] ), array( 'Stop', $lv['stop'], $light ? '#b3261e' : '#ff6b6b' ), array( 'Target 1', $lv['target1'], $light ? '#117a3e' : '#38f58a' ), array( 'Target 2', $lv['target2'], $light ? '#117a3e' : '#38f58a' ) );
		$ry = $py + 46 + 50;
		foreach ( $rows as $r ) {
			imagettftext( $im, 22, 0, $px + 24, $ry, $muted, $f_sans, $r[0] );
			$val = $r[1] !== '' ? $r[1] : '–';
			imagettftext( $im, 24, 0, $px + $panel_w - 24 - sml_lls_text_width( $f_mono, 24, $val ), $ry, sml_lls_hex( $im, $r[2] ), $f_mono, $val );
			$ry += 44;
		}
		if ( $square ) { $bottom = $py - 36; $region_h = $bottom - $top; } else { $text_w = $w - 2 * $pad - $panel_w - 48; }
	}

	if ( $spec['template'] === 'chart' && count( $spec['series'] ) > 4 ) {
		$ser = $spec['series']; $n = count( $ser ); $min = min( $ser ); $max = max( $ser ); $rng = max( 0.0001, $max - $min );
		$cx0 = $pad; $cw = $text_w; $ch = $square ? (int) ( $region_h * 0.34 ) : (int) ( $region_h * 0.42 ); $cy0 = $bottom - $ch;
		$up = end( $ser ) >= $ser[0];
		$line = sml_lls_hex( $im, $up ? ( $light ? '#117a3e' : '#38f58a' ) : ( $light ? '#b3261e' : '#ff6b6b' ) );
		$pts = array();
		for ( $i = 0; $i < $n; $i++ ) { $pts[] = array( (int) ( $cx0 + $cw * $i / ( $n - 1 ) ), (int) ( $cy0 + $ch - ( $ser[ $i ] - $min ) / $rng * ( $ch - 10 ) - 5 ) ); }
		// area fill
		for ( $i = 1; $i < $n; $i++ ) {
			$poly = array( $pts[ $i - 1 ][0], $pts[ $i - 1 ][1], $pts[ $i ][0], $pts[ $i ][1], $pts[ $i ][0], $cy0 + $ch, $pts[ $i - 1 ][0], $cy0 + $ch );
			imagefilledpolygon( $im, $poly, sml_lls_hex( $im, $up ? '#38f58a' : '#ff6b6b', 112 ) );
		}
		imagesetthickness( $im, 4 );
		for ( $i = 1; $i < $n; $i++ ) { imageline( $im, $pts[ $i - 1 ][0], $pts[ $i - 1 ][1], $pts[ $i ][0], $pts[ $i ][1], $line ); }
		imagesetthickness( $im, 1 );
		$last = end( $pts ); imagefilledellipse( $im, $last[0], $last[1], 14, 14, $line );
		$lbl = '$' . $spec['tickers'][0] . '  ·  3 months';
		imagettftext( $im, 20, 0, $pad, $cy0 - 10, $muted, $f_mono, $lbl );
		$bottom = $cy0 - 46; $region_h = $bottom - $top;
	}

	if ( $spec['template'] === 'quote' && $spec['quote'] ) {
		imagettftext( $im, 150, 0, $pad - 8, $top + 120, $accent, $f_display, '“' );
		list( $qs, $qlines ) = sml_lls_fit( $f_semi, $square ? 52 : 44, 28, $spec['quote'], $text_w, $square ? 7 : 5 );
		$qh = count( $qlines ) * (int) round( $qs * 1.22 );
		$ty = $top + 110 + (int) max( 0, ( $region_h - 110 - $qh - 60 ) / 2 );
		sml_lls_lines( $im, $f_semi, $qs, $qlines, $pad, $ty, $fg, 1.22 );
		list( $ts, $tlines ) = sml_lls_fit( $f_display, 30, 22, $spec['title'], $text_w, 2 );
		sml_lls_lines( $im, $f_display, $ts, $tlines, $pad, $bottom - count( $tlines ) * (int) round( $ts * 1.12 ), $muted, 1.12 );
		return $im;
	}

	// headline (and the text half of chart/levels): shrink until title + subtitle fit the space left
	$start = $square ? 92 : ( $h > 700 ? 84 : 74 );
	$max_lines = $square ? 5 : ( $h > 700 ? 4 : 3 );
	if ( $text_w < $w * 0.6 ) { $max_lines += 2; $start = min( $start, 56 ); } // narrow column beside a panel
	$subtitle = ( $spec['subtitle'] && $spec['template'] !== 'quote' ) ? $spec['subtitle'] : '';
	$size = $start; $lines = array(); $sub_lines = array(); $sub_size = 28; $title_h = 0; $sub_h = 0;
	for ( $s = $start; $s >= 36; $s -= 2 ) {
		$lines = sml_lls_wrap( $f_display, $s, $spec['title'], $text_w );
		if ( count( $lines ) > $max_lines ) { continue; }
		$sub_size = max( 20, (int) round( $s * 0.36 ) ); $sub_lines = array();
		if ( $subtitle ) { list( $sub_size, $sub_lines ) = sml_lls_fit( $f_sans, $sub_size, 20, $subtitle, $text_w, 2 ); }
		$title_h = count( $lines ) * (int) round( $s * 1.06 );
		$sub_h   = $sub_lines ? count( $sub_lines ) * (int) round( $sub_size * 1.3 ) + 22 : 0;
		$size = $s;
		if ( $title_h + $sub_h <= $region_h ) { break; }
		if ( $s <= 36 ) { break; }
	}
	if ( count( $lines ) > $max_lines || $title_h + $sub_h > $region_h ) {
		list( $size, $lines ) = sml_lls_fit( $f_display, $size, 36, $spec['title'], $text_w, $max_lines );
		$title_h = count( $lines ) * (int) round( $size * 1.06 );
		if ( $title_h + $sub_h > $region_h ) { $sub_lines = array(); $sub_h = 0; }
	}
	$block_h = $title_h + $sub_h;
	$ty = $spec['template'] === 'headline' && $has_bg ? $bottom - $block_h : $top + (int) max( 0, ( $region_h - $block_h ) / 2 );
	$ty = max( $top, $ty );
	$y2 = sml_lls_lines( $im, $f_display, $size, $lines, $pad - 2, $ty, $fg, 1.06 );
	if ( $sub_lines ) { sml_lls_lines( $im, $f_sans, $sub_size, $sub_lines, $pad, $y2 + 22, $muted, 1.3 ); }
	return $im;
}

/** Trims a single line with an ellipsis until it fits the width. */
function sml_lls_fit_width( $font, $size, $text, $max_w ) {
	$text = trim( (string) $text );
	if ( sml_lls_text_width( $font, $size, $text ) <= $max_w ) { return $text; }
	while ( mb_strlen( $text ) > 1 ) {
		$text = rtrim( mb_substr( $text, 0, -1 ), ' ·,.' );
		if ( sml_lls_text_width( $font, $size, $text . '…' ) <= $max_w ) { return $text . '…'; }
	}
	return '…';
}

/** Renders and stores all three ratios; mirrors the wide one into the letters SEO table. */
function sml_lls_card_generate( $row, $data, $overrides = array(), $force = false ) {
	if ( ! function_exists( 'imagecreatetruecolor' ) || ! function_exists( 'imagettftext' ) ) { return new WP_Error( 'sml_lls_gd', 'Image rendering is not available on this server.' ); }
	$spec = sml_lls_card_spec( $row, $data, $overrides );
	$hash = substr( md5( SML_LLS_CARD_VERSION . wp_json_encode( array_diff_key( $spec, array( 'prices' => 1, 'series' => 1, 'date' => 1 ) ) ) . wp_json_encode( $spec['prices'] ) . count( $spec['series'] ) ), 0, 10 );
	$have = sml_lls_card_images( $row, $data );
	if ( ! $force && $hash === ( $data['card']['hash'] ?? '' ) && $have['wide'] && $have['standard'] && $have['square'] ) { return array( 'images' => $have, 'hash' => $hash, 'cached' => true ); }

	@ini_set( 'memory_limit', '512M' ); // phpcs:ignore
	$images = array(); $files = array();
	foreach ( sml_lls_card_sizes() as $key => $wh ) {
		$im = sml_lls_card_draw( $spec, $wh[0], $wh[1] );
		ob_start(); imagepng( $im, null, 7 ); $png = ob_get_clean(); imagedestroy( $im );
		$name = 'loop-letter-' . (int) $row['id'] . '-' . $key . '-' . $hash . '.png';
		$up = wp_upload_bits( $name, null, $png );
		if ( empty( $up['error'] ) ) { $images[ $key ] = $up['url']; $files[ $key ] = $up['file']; }
		else { return new WP_Error( 'sml_lls_upload', 'Could not save the card image: ' . $up['error'] ); }
	}
	// drop the previous set
	foreach ( (array) ( $data['card']['files'] ?? array() ) as $old ) { if ( $old && is_string( $old ) && file_exists( $old ) && strpos( $old, 'loop-letter-' ) !== false ) { @unlink( $old ); } } // phpcs:ignore
	$patch = array( 'card' => array_merge( $overrides, array( 'images' => $images, 'files' => $files, 'hash' => $hash, 'generated_at' => gmdate( 'c' ) ) ) );
	sml_lls_put( $row['id'], $patch );
	sml_lls_seo_mirror( $row['id'], array( 'social_image' => $images['wide'] ) );
	return array( 'images' => $images, 'hash' => $hash, 'cached' => false );
}

/** Keeps the older Letters SEO table in step so its own head tags agree with ours. */
function sml_lls_seo_mirror( $letter_id, $patch ) {
	global $wpdb;
	$table = $wpdb->prefix . 'sml_letters_seo';
	if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) { return false; }
	$json = $wpdb->get_var( $wpdb->prepare( "SELECT data FROM $table WHERE letter_id = %d", (int) $letter_id ) );
	$cur  = $json ? json_decode( $json, true ) : array();
	$cur  = is_array( $cur ) ? $cur : array();
	foreach ( $patch as $k => $v ) { if ( $v !== null && $v !== '' ) { $cur[ $k ] = $v; } }
	$cols = $wpdb->get_col( "SHOW COLUMNS FROM $table" );
	$rowdata = array( 'letter_id' => (int) $letter_id, 'data' => wp_json_encode( $cur ) );
	if ( in_array( 'updated_at', (array) $cols, true ) ) { $rowdata['updated_at'] = gmdate( 'Y-m-d H:i:s' ); }
	return (bool) $wpdb->replace( $table, $rowdata );
}
