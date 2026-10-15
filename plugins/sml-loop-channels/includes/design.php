<?php
/**
 * Channel design: what the creator can change, stored as one user-meta array
 * (sml_channel_design), and how it becomes CSS.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

function sml_lc_presets() {
	/* bg, surface, surface2, line, text, text2, muted, accent2 */
	return array(
		'midnight' => array( 'label' => 'Midnight', 'light' => false, 'bg' => '#04060a', 'surface' => '#0a121b', 'surface2' => '#0d151f', 'line' => '#16202b', 'text' => '#e6edf3', 'text2' => '#c7d6e3', 'muted' => '#5d7085', 'accent2' => '#00ccff' ),
		'graphite' => array( 'label' => 'Graphite', 'light' => false, 'bg' => '#0e1013', 'surface' => '#171a20', 'surface2' => '#1c2027', 'line' => '#262b34', 'text' => '#f1f3f5', 'text2' => '#cfd5dc', 'muted' => '#7b8793', 'accent2' => '#9ab4ff' ),
		'ocean'    => array( 'label' => 'Ocean', 'light' => false, 'bg' => '#03101a', 'surface' => '#071c2c', 'surface2' => '#0b2538', 'line' => '#12354d', 'text' => '#e8f4fb', 'text2' => '#c3dceb', 'muted' => '#6f93aa', 'accent2' => '#5ad1ff' ),
		'ember'    => array( 'label' => 'Ember', 'light' => false, 'bg' => '#120807', 'surface' => '#1e0f0c', 'surface2' => '#271410', 'line' => '#3a221c', 'text' => '#fbeee9', 'text2' => '#e4cfc7', 'muted' => '#9c7f75', 'accent2' => '#ffb454' ),
		'forest'   => array( 'label' => 'Forest', 'light' => false, 'bg' => '#06110b', 'surface' => '#0b1c13', 'surface2' => '#10251a', 'line' => '#193326', 'text' => '#e9f7ee', 'text2' => '#c6e3d0', 'muted' => '#6f9682', 'accent2' => '#7affc0' ),
		'royal'    => array( 'label' => 'Royal', 'light' => false, 'bg' => '#0a0716', 'surface' => '#141028', 'surface2' => '#1b1535', 'line' => '#2a2250', 'text' => '#f1ecff', 'text2' => '#d6cdf3', 'muted' => '#8a7fb5', 'accent2' => '#c084fc' ),
		'paper'    => array( 'label' => 'Paper', 'light' => true, 'bg' => '#f4f1ea', 'surface' => '#ffffff', 'surface2' => '#f7f4ee', 'line' => '#e1dbcf', 'text' => '#141821', 'text2' => '#2f3845', 'muted' => '#6b7380', 'accent2' => '#0f766e' ),
		'snow'     => array( 'label' => 'Snow', 'light' => true, 'bg' => '#f6f8fb', 'surface' => '#ffffff', 'surface2' => '#f1f4f8', 'line' => '#dfe5ed', 'text' => '#0f172a', 'text2' => '#334155', 'muted' => '#64748b', 'accent2' => '#2563eb' ),
	);
}

function sml_lc_fonts() {
	$base = function_exists( 'sml_channel_fonts' ) ? (array) sml_channel_fonts() : array( 'Archivo', 'Space Grotesk', 'Rajdhani', 'Orbitron', 'Exo 2', 'Chakra Petch', 'Oxanium', 'Sora', 'Manrope', 'Outfit', 'Barlow', 'Saira', 'Kanit', 'Play', 'Syne', 'Unbounded', 'Michroma', 'Audiowide' );
	return array_values( array_unique( array_merge( $base, array( 'IBM Plex Sans', 'Inter', 'Poppins', 'Montserrat', 'DM Sans', 'Plus Jakarta Sans', 'Bebas Neue', 'Oswald', 'Playfair Display', 'Lora', 'Space Mono' ) ) ) );
}

function sml_lc_sections() {
	return array( 'hero' => 'Live / latest hero', 'tickers' => 'Your tickers', 'orbit' => 'Latest videos', 'playlists' => 'Playlists', 'community' => 'Community', 'nl' => 'Newsletter', 'about' => 'About' );
}

function sml_lc_defaults() {
	return array(
		'preset'     => 'midnight',
		'accent'     => '',
		'font'       => '',
		'radius'     => 'soft',      /* sharp | soft | round */
		'width'      => 'standard',  /* standard | wide | narrow */
		'banner'     => array( 'mode' => 'none', 'url' => '', 'id' => 0, 'poster' => '', 'height' => 'medium', 'fit' => 'cover', 'position' => 'center', 'overlay' => true, 'title' => '', 'subtitle' => '' ),
		'background' => array( 'mode' => 'none', 'url' => '', 'id' => 0, 'blur' => 0, 'dim' => 60, 'fixed' => true, 'pattern' => 'grid' ),
		'layout'     => array( 'sidebar' => 'left', 'videos' => 'orbit', 'order' => array( 'hero', 'tickers', 'orbit', 'playlists', 'community', 'nl', 'about' ), 'hidden' => array() ),
		'effects'    => array( 'level' => 'off', 'effects' => array(), 'shapes' => array(), 'objects' => array(), 'pulse' => false ),
		'seo'        => array(
			'title' => '', 'description' => '', 'keywords' => '', 'topics' => array(), 'tickers' => array(), 'category' => '', 'job_title' => '',
			'og_title' => '', 'og_desc' => '', 'image' => array( 'url' => '', 'id' => 0 ), 'twitter' => '',
			'noindex' => false, 'videos_schema' => true, 'posts_schema' => true, 'last_ping' => array( 'at' => '', 'ok' => null ), 'updated_at' => '',
		),
		'updated_at' => '',
	);
}

function sml_lc_merge( $base, $patch ) {
	foreach ( (array) $patch as $k => $v ) {
		if ( is_array( $v ) && isset( $base[ $k ] ) && is_array( $base[ $k ] ) && ! isset( $v[0] ) && ! isset( $base[ $k ][0] ) ) { $base[ $k ] = sml_lc_merge( $base[ $k ], $v ); }
		else { $base[ $k ] = $v; }
	}
	return $base;
}

function sml_lc_get( $user_id ) {
	$d = get_user_meta( (int) $user_id, 'sml_channel_design', true );
	return sml_lc_merge( sml_lc_defaults(), is_array( $d ) ? $d : array() );
}

function sml_lc_put( $user_id, $patch ) {
	$d = sml_lc_merge( sml_lc_get( $user_id ), $patch );
	$d['updated_at'] = gmdate( 'c' );
	update_user_meta( (int) $user_id, 'sml_channel_design', $d );
	delete_transient( 'sml_lc_page_' . (int) $user_id );
	return $d;
}

function sml_lc_hex( $v ) { $v = trim( (string) $v ); return preg_match( '/^#?[0-9a-fA-F]{6}$/', $v ) ? '#' . strtolower( ltrim( $v, '#' ) ) : ''; }

function sml_lc_sanitize( $in ) {
	$in  = is_array( $in ) ? $in : array();
	$out = array();
	$url = function ( $v ) { return esc_url_raw( (string) $v ); };
	$txt = function ( $v, $max ) { return mb_substr( sanitize_text_field( (string) $v ), 0, $max ); };
	$one = function ( $v, $allowed, $default = null ) { return in_array( $v, $allowed, true ) ? $v : $default; };
	$keep = function ( $arr ) { return array_filter( $arr, function ( $v ) { return $v !== null; } ); };
	if ( isset( $in['preset'] ) ) { $out['preset'] = $one( $in['preset'], array_keys( sml_lc_presets() ), 'midnight' ); }
	if ( isset( $in['accent'] ) ) { $out['accent'] = sml_lc_hex( $in['accent'] ); }
	if ( isset( $in['font'] ) ) { $out['font'] = $in['font'] === '' ? '' : (string) $one( $in['font'], sml_lc_fonts(), '' ); }
	if ( isset( $in['radius'] ) ) { $out['radius'] = $one( $in['radius'], array( 'sharp', 'soft', 'round' ), 'soft' ); }
	if ( isset( $in['width'] ) ) { $out['width'] = $one( $in['width'], array( 'narrow', 'standard', 'wide' ), 'standard' ); }
	if ( isset( $in['banner'] ) ) { $b = (array) $in['banner']; $out['banner'] = $keep( array(
		'mode' => isset( $b['mode'] ) ? $one( $b['mode'], array( 'none', 'image', 'video', 'gradient' ), 'none' ) : null,
		'url' => isset( $b['url'] ) ? $url( $b['url'] ) : null, 'id' => isset( $b['id'] ) ? absint( $b['id'] ) : null, 'poster' => isset( $b['poster'] ) ? $url( $b['poster'] ) : null,
		'height' => isset( $b['height'] ) ? $one( $b['height'], array( 'short', 'medium', 'tall' ), 'medium' ) : null,
		'fit' => isset( $b['fit'] ) ? $one( $b['fit'], array( 'cover', 'contain' ), 'cover' ) : null,
		'position' => isset( $b['position'] ) ? $one( $b['position'], array( 'top', 'center', 'bottom' ), 'center' ) : null,
		'overlay' => isset( $b['overlay'] ) ? (bool) $b['overlay'] : null,
		'title' => isset( $b['title'] ) ? $txt( $b['title'], 80 ) : null, 'subtitle' => isset( $b['subtitle'] ) ? $txt( $b['subtitle'], 140 ) : null,
	) ); }
	if ( isset( $in['background'] ) ) { $b = (array) $in['background']; $out['background'] = $keep( array(
		'mode' => isset( $b['mode'] ) ? $one( $b['mode'], array( 'none', 'image', 'video', 'pattern', 'banner' ), 'none' ) : null,
		'url' => isset( $b['url'] ) ? $url( $b['url'] ) : null, 'id' => isset( $b['id'] ) ? absint( $b['id'] ) : null,
		'blur' => isset( $b['blur'] ) ? max( 0, min( 30, (int) $b['blur'] ) ) : null, 'dim' => isset( $b['dim'] ) ? max( 0, min( 95, (int) $b['dim'] ) ) : null,
		'fixed' => isset( $b['fixed'] ) ? (bool) $b['fixed'] : null,
		'pattern' => isset( $b['pattern'] ) ? $one( $b['pattern'], array( 'grid', 'dots', 'diagonal', 'noise', 'candles' ), 'grid' ) : null,
	) ); }
	if ( isset( $in['layout'] ) ) { $l = (array) $in['layout']; $lay = $keep( array(
		'sidebar' => isset( $l['sidebar'] ) ? $one( $l['sidebar'], array( 'left', 'right', 'stack' ), 'left' ) : null,
		'videos' => isset( $l['videos'] ) ? $one( $l['videos'], array( 'orbit', 'grid', 'list' ), 'orbit' ) : null,
	) );
		if ( isset( $l['order'] ) ) { $ord = array_values( array_intersect( array_map( 'strval', (array) $l['order'] ), array_keys( sml_lc_sections() ) ) ); foreach ( array_keys( sml_lc_sections() ) as $k ) { if ( ! in_array( $k, $ord, true ) ) { $ord[] = $k; } } $lay['order'] = $ord; }
		if ( isset( $l['hidden'] ) ) { $lay['hidden'] = array_values( array_intersect( array_map( 'strval', (array) $l['hidden'] ), array_keys( sml_lc_sections() ) ) ); }
		$out['layout'] = $lay; }
	if ( isset( $in['effects'] ) ) { $e = (array) $in['effects']; $lst = function ( $v, $allowed ) { return array_values( array_intersect( array_map( 'strval', (array) $v ), $allowed ) ); }; $out['effects'] = $keep( array(
		'level' => isset( $e['level'] ) ? $one( $e['level'], array( 'off', 'calm', 'alive', 'max' ), 'off' ) : null,
		'effects' => isset( $e['effects'] ) ? $lst( $e['effects'], array( 'particles', 'aurora', 'grid', 'rain', 'orbs', 'ticker', 'scan', 'noise', 'spotlight' ) ) : null,
		'shapes' => isset( $e['shapes'] ) ? $lst( $e['shapes'], array( 'rings', 'triangles', 'squares', 'lines', 'candles', 'hex' ) ) : null,
		'objects' => isset( $e['objects'] ) ? $lst( $e['objects'], array( 'cube', 'sphere', 'torus', 'pyramid', 'octa', 'bull', 'coin' ) ) : null,
		'pulse' => isset( $e['pulse'] ) ? (bool) $e['pulse'] : null,
	) ); }
	if ( isset( $in['seo'] ) ) { $s = (array) $in['seo']; $words = function ( $v, $max, $len ) { $o = array(); foreach ( is_array( $v ) ? $v : explode( ',', (string) $v ) as $x ) { $x = trim( sanitize_text_field( (string) $x ) ); if ( $x !== '' ) { $o[] = mb_substr( $x, 0, $len ); } if ( count( $o ) >= $max ) { break; } } return array_values( array_unique( $o ) ); };
		$out['seo'] = $keep( array(
			'title' => isset( $s['title'] ) ? $txt( $s['title'], 90 ) : null, 'description' => isset( $s['description'] ) ? $txt( $s['description'], 200 ) : null,
			'keywords' => isset( $s['keywords'] ) ? $txt( $s['keywords'], 300 ) : null,
			'topics' => isset( $s['topics'] ) ? $words( $s['topics'], 12, 40 ) : null,
			'tickers' => isset( $s['tickers'] ) ? array_values( array_filter( array_map( function ( $t ) { return strtoupper( preg_replace( '/[^A-Za-z.]/', '', (string) $t ) ); }, $words( $s['tickers'], 15, 8 ) ) ) ) : null,
			'category' => isset( $s['category'] ) ? $one( $s['category'], array_keys( sml_lc_categories() ), '' ) : null,
			'job_title' => isset( $s['job_title'] ) ? $txt( $s['job_title'], 60 ) : null,
			'og_title' => isset( $s['og_title'] ) ? $txt( $s['og_title'], 90 ) : null, 'og_desc' => isset( $s['og_desc'] ) ? $txt( $s['og_desc'], 200 ) : null,
			'image' => isset( $s['image'] ) && is_array( $s['image'] ) ? array( 'url' => $url( $s['image']['url'] ?? '' ), 'id' => absint( $s['image']['id'] ?? 0 ) ) : null,
			'twitter' => isset( $s['twitter'] ) ? ltrim( $txt( $s['twitter'], 30 ), '@' ) : null,
			'noindex' => isset( $s['noindex'] ) ? (bool) $s['noindex'] : null, 'videos_schema' => isset( $s['videos_schema'] ) ? (bool) $s['videos_schema'] : null, 'posts_schema' => isset( $s['posts_schema'] ) ? (bool) $s['posts_schema'] : null,
		) ); }
	return $out;
}

function sml_lc_categories() {
	return array( '' => 'Not set', 'day-trading' => 'Day trading', 'swing-trading' => 'Swing trading', 'options' => 'Options', 'futures' => 'Futures', 'forex' => 'Forex', 'crypto' => 'Crypto', 'penny-stocks' => 'Small caps and penny stocks', 'long-term' => 'Long-term investing', 'dividends' => 'Dividends and income', 'macro' => 'Macro and economy', 'earnings' => 'Earnings', 'technical' => 'Technical analysis', 'news' => 'Market news', 'education' => 'Trading education' );
}

/** What the creator talks about most, read from their own videos, posts and letters: suggestions for the SEO tab when trends move. */
function sml_lc_suggest( $user_id, $videos, $posts ) {
	$counts = array(); $words = array();
	$bump = function ( &$arr, $k, $n = 1 ) { if ( $k === '' ) { return; } $arr[ $k ] = ( $arr[ $k ] ?? 0 ) + $n; };
	foreach ( (array) $videos as $v ) { $bump( $counts, strtoupper( ltrim( (string) ( $v['ticker'] ?? '' ), '$' ) ), 3 ); preg_match_all( '/\$([A-Za-z]{1,6})\b/', ( $v['title'] ?? '' ) . ' ' . ( $v['description'] ?? '' ), $m ); foreach ( $m[1] as $t ) { $bump( $counts, strtoupper( $t ), 2 ); } }
	foreach ( (array) $posts as $p ) { foreach ( (array) ( $p['tickers'] ?? array() ) as $t ) { $bump( $counts, strtoupper( ltrim( (string) $t, '$' ) ), 2 ); } preg_match_all( '/\$([A-Za-z]{1,6})\b/', ( $p['title'] ?? '' ) . ' ' . ( $p['body'] ?? '' ), $m ); foreach ( $m[1] as $t ) { $bump( $counts, strtoupper( $t ) ); } }
	foreach ( sml_lc_letters( $user_id, 30 ) as $l ) { preg_match_all( '/\$([A-Za-z]{1,6})\b/', (string) $l['title'] . ' ' . (string) $l['subtitle'], $m ); foreach ( $m[1] as $t ) { $bump( $counts, strtoupper( $t ), 2 ); } }
	$stop = array_flip( explode( ' ', 'the a an and or of to in on for with from by at as is are was were be been this that these those it its into over under after before new now how why what when who top best big huge big-time today tonight week month year day days stock stocks market markets trade trades trading trader traders alert alerts price shares share up down next last first one two three all more most some just about near again back off out than then there here they them you your our we us my me i so if but not no yes can will would should could may might' ) );
	$titles = array();
	foreach ( (array) $videos as $v ) { $titles[] = (string) ( $v['title'] ?? '' ); }
	foreach ( (array) $posts as $p ) { $titles[] = (string) ( $p['title'] ?? '' ); }
	foreach ( sml_lc_letters( $user_id, 30 ) as $l ) { $titles[] = (string) $l['title']; }
	foreach ( $titles as $t ) { foreach ( preg_split( '/[^A-Za-z-]+/', strtolower( $t ) ) as $w ) { if ( strlen( $w ) < 4 || isset( $stop[ $w ] ) ) { continue; } $bump( $words, $w ); } }
	arsort( $counts ); arsort( $words );
	return array( 'tickers' => array_slice( array_keys( array_filter( $counts ) ), 0, 12 ), 'topics' => array_slice( array_keys( array_filter( $words, function ( $n ) { return $n >= 2; } ) ), 0, 15 ) );
}

function sml_lc_rgb( $hex ) {
	$hex = ltrim( (string) $hex, '#' );
	if ( strlen( $hex ) !== 6 ) { return '0,255,136'; }
	return hexdec( substr( $hex, 0, 2 ) ) . ',' . hexdec( substr( $hex, 2, 2 ) ) . ',' . hexdec( substr( $hex, 4, 2 ) );
}

/** The legacy stylesheet, fetched once per CDN ref and retinted for a preset: every hard-coded palette hex becomes the preset's colour. */
function sml_lc_legacy_css_url() {
	$ref = function_exists( 'sml_ch_loader_ref' ) ? sml_ch_loader_ref() : ( function_exists( 'sml_cdn_resolve_ref' ) ? sml_cdn_resolve_ref() : 'main' );
	return 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . $ref . '/css/loop-channel.css';
}
function sml_lc_legacy_css() {
	$url = sml_lc_legacy_css_url();
	$key = 'sml_lc_css_' . md5( $url );
	$css = get_transient( $key );
	if ( is_string( $css ) && $css !== '' ) { return $css; }
	$r = wp_remote_get( $url, array( 'timeout' => 6 ) );
	if ( is_wp_error( $r ) || (int) wp_remote_retrieve_response_code( $r ) !== 200 ) { return ''; }
	$css = (string) wp_remote_retrieve_body( $r );
	set_transient( $key, $css, 12 * HOUR_IN_SECONDS );
	return $css;
}
function sml_lc_themed_css( $preset_key ) {
	$p = sml_lc_presets()[ $preset_key ] ?? null;
	if ( ! $p || $preset_key === 'midnight' ) { return ''; }
	$css = sml_lc_legacy_css();
	if ( ! $css ) { return ''; }
	$map = array(
		'#04060a' => $p['bg'], '#05080d' => $p['bg'], '#080c12' => $p['bg'],
		'#0a121b' => $p['surface'], '#0a0d13' => $p['surface'], '#0b1119' => $p['surface'], '#0d1a15' => $p['surface'],
		'#0d151f' => $p['surface2'], '#101c26' => $p['surface2'], '#0a1420' => $p['surface2'], '#081420' => $p['surface2'], '#0d2030' => $p['surface2'],
		'#16202b' => $p['line'], '#1c2833' => $p['line'], '#131c26' => $p['line'], '#10161f' => $p['line'], '#101923' => $p['line'], '#20303f' => $p['line'], '#2a3a49' => $p['line'], '#1b3a4d' => $p['line'],
		'#e6edf3' => $p['text'], '#fff' => $p['text'], '#ffffff' => $p['text'],
		'#c7d6e3' => $p['text2'], '#8fa3b5' => $p['text2'], '#a8dcf0' => $p['text2'],
		'#5d7085' => $p['muted'], '#4c5d6d' => $p['muted'], '#3d4f5f' => $p['muted'],
		'#00ccff' => $p['accent2'], '#7ae6ff' => $p['accent2'],
	);
	$out = preg_replace_callback( '/#[0-9a-fA-F]{3,6}\b/', function ( $m ) use ( $map ) { $k = strtolower( $m[0] ); return $map[ $k ] ?? $m[0]; }, $css );
	/* the gradient overlays assume a dark page; a light preset needs them lifted */
	if ( ! empty( $p['light'] ) ) {
		$out = preg_replace( '/rgba\((?:4,6,10|7,11,16|8,12,18)\s*,\s*([0-9.]+)\)/', 'rgba(255,255,255,$1)', $out );
		$out = str_replace( 'color:' . $p['text'] . ';background:var(--accent)', 'color:#0b1119;background:var(--accent)', $out );
	}
	return $out;
}

/** Inline CSS variables and the small rule set that applies a design on top of the legacy stylesheet. */
function sml_lc_vars_css( $design, $appearance ) {
	$p = sml_lc_presets()[ $design['preset'] ] ?? sml_lc_presets()['midnight'];
	$accent = sml_lc_hex( $design['accent'] ) ?: ( $appearance['accent'] ?? '#00ff88' );
	$font = $design['font'] ?: ( $appearance['font'] ?? 'Archivo' );
	$fontv = ( strpos( $font, ' ' ) !== false ? "'" . $font . "'" : $font ) . ',system-ui,sans-serif';
	$radius = array( 'sharp' => '4px', 'soft' => '12px', 'round' => '22px' )[ $design['radius'] ] ?? '12px';
	$width = array( 'narrow' => '1100px', 'standard' => '1420px', 'wide' => '1720px' )[ $design['width'] ] ?? '1420px';
	$b = $design['banner']; $bg = $design['background'];
	$bh = array( 'short' => '160px', 'medium' => '260px', 'tall' => '380px' )[ $b['height'] ] ?? '260px';
	$css = ':root{--lc-bg:' . $p['bg'] . ';--lc-surface:' . $p['surface'] . ';--lc-surface2:' . $p['surface2'] . ';--lc-line:' . $p['line'] . ';--lc-text:' . $p['text'] . ';--lc-text2:' . $p['text2'] . ';--lc-muted:' . $p['muted'] . ';--lc-accent:' . $accent . ';--lc-accent-rgb:' . sml_lc_rgb( $accent ) . ';--lc-accent2:' . $p['accent2'] . ';--lc-font:' . $fontv . ';--lc-radius:' . $radius . ';--lc-width:' . $width . ';--lc-banner-h:' . $bh . ';--lc-banner-fit:' . $b['fit'] . ';--lc-banner-pos:' . $b['position'] . ';--lc-bg-blur:' . (int) $bg['blur'] . 'px;--lc-bg-dim:' . ( (int) $bg['dim'] / 100 ) . '}';
	$css .= 'body.lch-on{background:var(--lc-bg)!important}';
	$css .= '#sml-ch-root{--accent:var(--lc-accent)!important;--chfont:var(--lc-font)!important;max-width:none}';
	$css .= '#sml-ch-root .lch-body{max-width:var(--lc-width)}';
	/* section order and visibility: the legacy app mounts fixed ids, so flex order does the layout */
	$i = 1;
	foreach ( (array) $design['layout']['order'] as $k ) { $css .= '#ch-' . $k . ',#ch-playlists,#sml-lc-' . $k . '{order:' . $i . '}'; $i++; }
	foreach ( (array) $design['layout']['hidden'] as $k ) { $css .= '#ch-' . $k . ( $k === 'playlists' ? ',#ch-playlists' : '' ) . '{display:none!important}'; }
	return $css;
}

function sml_lc_font_link( $design, $appearance ) {
	$font = $design['font'] ?: ( $appearance['font'] ?? 'Archivo' );
	if ( ! $font || in_array( $font, array( 'Archivo', 'IBM Plex Sans' ), true ) ) { return ''; }
	return '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=' . rawurlencode( $font ) . ':wght@400;600;700;800&display=swap">';
}

/** The body classes a design turns on. */
function sml_lc_body_classes( $design ) {
	$c = array( 'lc-preset-' . $design['preset'], 'lc-radius-' . $design['radius'], 'lc-sidebar-' . $design['layout']['sidebar'], 'lc-videos-' . $design['layout']['videos'] );
	if ( ! empty( sml_lc_presets()[ $design['preset'] ]['light'] ) ) { $c[] = 'lc-light'; }
	if ( $design['banner']['mode'] !== 'none' ) { $c[] = 'lc-has-banner'; }
	if ( $design['background']['mode'] !== 'none' ) { $c[] = 'lc-has-bg'; if ( ! empty( $design['background']['fixed'] ) ) { $c[] = 'lc-bg-fixed'; } }
	if ( ( $design['effects']['level'] ?? 'off' ) !== 'off' ) { $c[] = 'lc-fx'; }
	return $c;
}
