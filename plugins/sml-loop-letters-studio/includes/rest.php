<?php
/**
 * REST API: sml-letter-studio/v1
 *   GET  /letter/{id}              studio settings (author or admin)
 *   POST /letter/{id}              save a patch of settings
 *   POST /letter/{id}/upload       multipart file + purpose (cover|intro|audio|bg|cardbg|poster)
 *   POST /letter/{id}/card         render the share card set
 *   POST /letter/{id}/react        reader reaction {kind}
 *   GET  /letter/{id}/public       what the reader page needs after load
 *   GET  /letter/{id}/check        SEO and readability checklist for the writer
 *   POST /ping                     resubmit sitemaps (admin)
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

add_action( 'rest_api_init', 'sml_lls_rest_routes' );
function sml_lls_rest_routes() {
	$ns = SML_LLS_NS;
	$id = array( 'id' => array( 'validate_callback' => function ( $v ) { return is_numeric( $v ); } ) );
	register_rest_route( $ns, '/letter/(?P<id>\d+)', array(
		array( 'methods' => 'GET', 'callback' => 'sml_lls_rest_get', 'permission_callback' => 'sml_lls_rest_can_edit', 'args' => $id ),
		array( 'methods' => 'POST', 'callback' => 'sml_lls_rest_save', 'permission_callback' => 'sml_lls_rest_can_edit', 'args' => $id ),
	) );
	register_rest_route( $ns, '/letter/(?P<id>\d+)/upload', array( 'methods' => 'POST', 'callback' => 'sml_lls_rest_upload', 'permission_callback' => 'sml_lls_rest_can_edit', 'args' => $id ) );
	register_rest_route( $ns, '/letter/(?P<id>\d+)/card', array( 'methods' => 'POST', 'callback' => 'sml_lls_rest_card', 'permission_callback' => 'sml_lls_rest_can_edit', 'args' => $id ) );
	register_rest_route( $ns, '/letter/(?P<id>\d+)/check', array( 'methods' => 'GET', 'callback' => 'sml_lls_rest_check', 'permission_callback' => 'sml_lls_rest_can_edit', 'args' => $id ) );
	register_rest_route( $ns, '/letter/(?P<id>\d+)/react', array( 'methods' => 'POST', 'callback' => 'sml_lls_rest_react', 'permission_callback' => '__return_true', 'args' => $id ) );
	register_rest_route( $ns, '/letter/(?P<id>\d+)/public', array( 'methods' => 'GET', 'callback' => 'sml_lls_rest_public', 'permission_callback' => '__return_true', 'args' => $id ) );
	register_rest_route( $ns, '/ping', array( 'methods' => 'POST', 'callback' => 'sml_lls_rest_ping', 'permission_callback' => function () { return current_user_can( 'manage_options' ); } ) );
}

function sml_lls_rest_can_edit( $request ) {
	if ( ! is_user_logged_in() ) { return new WP_Error( 'sml_lls_auth', 'Sign in to edit this letter.', array( 'status' => 401 ) ); }
	if ( ! sml_lls_can_edit( (int) $request['id'] ) ) { return new WP_Error( 'sml_lls_forbidden', 'This letter is not yours.', array( 'status' => 403 ) ); }
	return true;
}

function sml_lls_rest_envelope( $row ) {
	$data = sml_lls_get( $row['id'] );
	unset( $data['card']['files'] );
	$pub  = sml_lls_publication( $row['author_id'] );
	return array(
		'ok' => true, 'id' => (int) $row['id'], 'status' => $row['status'], 'url' => sml_lls_letter_url( $row ), 'title' => $row['title'], 'subtitle' => $row['subtitle'],
		'cover_url' => $row['cover_url'], 'tickers' => sml_lls_tickers( $row ), 'publication' => array( 'name' => $pub['name'], 'handle' => $pub['handle'], 'accent' => $pub['accent'], 'logo' => $pub['logo'], 'avatar' => $pub['avatar'] ),
		'data' => $data, 'indexnow_key' => current_user_can( 'manage_options' ) ? get_option( 'sml_lls_indexnow_key' ) : null,
		'sitemaps' => array( 'news' => home_url( '/sml-letters-news-sitemap.xml' ), 'full' => home_url( '/sml-letters-full-sitemap.xml' ), 'feed' => home_url( '/sml-letters-feed.xml' ) ),
	);
}

function sml_lls_rest_get( $request ) {
	$row = sml_lls_letter_by_id( (int) $request['id'] );
	if ( ! $row ) { return new WP_Error( 'sml_lls_missing', 'Letter not found.', array( 'status' => 404 ) ); }
	return sml_lls_rest_envelope( $row );
}

/** Whitelists and sanitises a settings patch. */
function sml_lls_sanitize_patch( $in ) {
	$in  = is_array( $in ) ? $in : array();
	$out = array();
	$url = function ( $v ) { return esc_url_raw( (string) $v ); };
	$txt = function ( $v, $max = 200 ) { return mb_substr( sanitize_text_field( (string) $v ), 0, $max ); };
	$hex = function ( $v ) { $v = trim( (string) $v ); return preg_match( '/^#?[0-9a-fA-F]{6}$/', $v ) ? '#' . ltrim( $v, '#' ) : ''; };
	$lst = function ( $v, $allowed ) { return array_values( array_intersect( array_map( 'strval', (array) $v ), $allowed ) ); };
	if ( isset( $in['cover'] ) ) { $c = (array) $in['cover']; $out['cover'] = array( 'url' => $url( $c['url'] ?? '' ), 'id' => absint( $c['id'] ?? 0 ) ); }
	if ( isset( $in['intro'] ) ) { $c = (array) $in['intro']; $out['intro'] = array_filter( array(
		'url' => isset( $c['url'] ) ? $url( $c['url'] ) : null, 'id' => isset( $c['id'] ) ? absint( $c['id'] ) : null, 'poster' => isset( $c['poster'] ) ? $url( $c['poster'] ) : null,
		'seconds' => isset( $c['seconds'] ) ? round( min( 16, max( 0, (float) $c['seconds'] ) ), 2 ) : null, 'enabled' => isset( $c['enabled'] ) ? (bool) $c['enabled'] : null,
	), function ( $v ) { return $v !== null; } ); }
	if ( isset( $in['audio'] ) ) { $c = (array) $in['audio']; $out['audio'] = array_filter( array(
		'mode' => isset( $c['mode'] ) && in_array( $c['mode'], array( 'none', 'upload', 'youtube' ), true ) ? $c['mode'] : null,
		'url' => isset( $c['url'] ) ? $url( $c['url'] ) : null, 'id' => isset( $c['id'] ) ? absint( $c['id'] ) : null,
		'youtube' => isset( $c['youtube'] ) ? ( sml_lls_youtube_id( $c['youtube'] ) ? $txt( $c['youtube'], 200 ) : '' ) : null,
		'title' => isset( $c['title'] ) ? $txt( $c['title'], 120 ) : null, 'seconds' => isset( $c['seconds'] ) ? round( max( 0, (float) $c['seconds'] ), 1 ) : null,
		'autoplay' => isset( $c['autoplay'] ) ? (bool) $c['autoplay'] : null,
	), function ( $v ) { return $v !== null; } ); }
	if ( isset( $in['immersive'] ) ) { $c = (array) $in['immersive']; $out['immersive'] = array_filter( array(
		'level' => isset( $c['level'] ) && in_array( $c['level'], array( 'off', 'calm', 'alive', 'max' ), true ) ? $c['level'] : null,
		'effects' => isset( $c['effects'] ) ? $lst( $c['effects'], array( 'particles', 'aurora', 'grid', 'rain', 'orbs', 'ticker', 'scan', 'noise', 'spotlight' ) ) : null,
		'shapes' => isset( $c['shapes'] ) ? $lst( $c['shapes'], array( 'rings', 'triangles', 'squares', 'lines', 'candles', 'hex' ) ) : null,
		'objects' => isset( $c['objects'] ) ? $lst( $c['objects'], array( 'cube', 'sphere', 'torus', 'pyramid', 'octa', 'bull', 'coin' ) ) : null,
		'texture' => isset( $c['texture'] ) && in_array( $c['texture'], array( 'none', 'grain', 'paper', 'carbon', 'mesh' ), true ) ? $c['texture'] : null,
		'accent' => isset( $c['accent'] ) ? $hex( $c['accent'] ) : null,
		'bg_mode' => isset( $c['bg_mode'] ) && in_array( $c['bg_mode'], array( 'none', 'image', 'video', 'cover' ), true ) ? $c['bg_mode'] : null,
		'bg_url' => isset( $c['bg_url'] ) ? $url( $c['bg_url'] ) : null, 'bg_id' => isset( $c['bg_id'] ) ? absint( $c['bg_id'] ) : null,
		'pulse' => isset( $c['pulse'] ) ? (bool) $c['pulse'] : null,
	), function ( $v ) { return $v !== null; } ); }
	if ( isset( $in['card'] ) ) { $c = (array) $in['card']; $out['card'] = array_filter( array(
		'template' => isset( $c['template'] ) && in_array( $c['template'], array( 'headline', 'chart', 'levels', 'quote' ), true ) ? $c['template'] : null,
		'theme' => isset( $c['theme'] ) && isset( sml_lls_card_themes()[ $c['theme'] ] ) ? $c['theme'] : null,
		'kicker' => isset( $c['kicker'] ) ? $txt( $c['kicker'], 60 ) : null, 'title' => isset( $c['title'] ) ? $txt( $c['title'], 140 ) : null, 'subtitle' => isset( $c['subtitle'] ) ? $txt( $c['subtitle'], 160 ) : null,
		'accent' => isset( $c['accent'] ) ? $hex( $c['accent'] ) : null,
		'bg' => isset( $c['bg'] ) && in_array( $c['bg'], array( 'cover', 'upload', 'none' ), true ) ? $c['bg'] : null,
		'bg_url' => isset( $c['bg_url'] ) ? $url( $c['bg_url'] ) : null, 'bg_id' => isset( $c['bg_id'] ) ? absint( $c['bg_id'] ) : null,
		'show_tickers' => isset( $c['show_tickers'] ) ? (bool) $c['show_tickers'] : null, 'show_avatar' => isset( $c['show_avatar'] ) ? (bool) $c['show_avatar'] : null, 'show_price' => isset( $c['show_price'] ) ? (bool) $c['show_price'] : null,
	), function ( $v ) { return $v !== null; } ); }
	if ( isset( $in['seo'] ) ) { $c = (array) $in['seo']; $out['seo'] = array_filter( array(
		'meta_title' => isset( $c['meta_title'] ) ? $txt( $c['meta_title'], 120 ) : null, 'meta_desc' => isset( $c['meta_desc'] ) ? $txt( $c['meta_desc'], 320 ) : null,
		'keyword' => isset( $c['keyword'] ) ? $txt( $c['keyword'], 80 ) : null, 'news_keywords' => isset( $c['news_keywords'] ) ? $txt( $c['news_keywords'], 200 ) : null,
		'schema_type' => isset( $c['schema_type'] ) && in_array( $c['schema_type'], array( 'NewsArticle', 'AnalysisNewsArticle', 'OpinionNewsArticle', 'ReportageNewsArticle', 'Article', 'BlogPosting' ), true ) ? $c['schema_type'] : null,
		'noindex' => isset( $c['noindex'] ) ? (bool) $c['noindex'] : null,
		'og_title' => isset( $c['og_title'] ) ? $txt( $c['og_title'], 120 ) : null, 'og_desc' => isset( $c['og_desc'] ) ? $txt( $c['og_desc'], 320 ) : null,
	), function ( $v ) { return $v !== null; } ); }
	if ( isset( $in['reader'] ) ) { $c = (array) $in['reader']; $out['reader'] = array();
		foreach ( array( 'toc', 'levels_card', 'reactions', 'highlights', 'subscribe_box', 'next_issue', 'share_bar' ) as $k ) { if ( isset( $c[ $k ] ) ) { $out['reader'][ $k ] = (bool) $c[ $k ]; } } }
	return $out;
}

function sml_lls_rest_save( $request ) {
	$row = sml_lls_letter_by_id( (int) $request['id'] );
	if ( ! $row ) { return new WP_Error( 'sml_lls_missing', 'Letter not found.', array( 'status' => 404 ) ); }
	$patch = sml_lls_sanitize_patch( $request->get_json_params() ?: $request->get_params() );
	sml_lls_put( $row['id'], $patch );
	if ( ! empty( $patch['seo'] ) ) {
		$s = $patch['seo'];
		sml_lls_seo_mirror( $row['id'], array( 'meta_title' => $s['meta_title'] ?? null, 'meta_desc' => $s['meta_desc'] ?? null, 'keyword' => $s['keyword'] ?? null, 'schema' => $s['schema_type'] ?? null, 'og_title' => $s['og_title'] ?? null, 'og_desc' => $s['og_desc'] ?? null ) );
	}
	if ( ! empty( $patch['cover']['url'] ) && function_exists( 'sml_letters_table' ) ) {
		global $wpdb;
		$wpdb->update( sml_letters_table( 'posts' ), array( 'cover_url' => $patch['cover']['url'] ), array( 'id' => (int) $row['id'] ) );
		$row['cover_url'] = $patch['cover']['url'];
	}
	if ( function_exists( 'sml_lls_flush_xml' ) ) { sml_lls_flush_xml(); }
	return sml_lls_rest_envelope( $row );
}

function sml_lls_upload_rules( $purpose ) {
	$image = array( 'jpg|jpeg|jpe' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'gif' => 'image/gif' );
	$video = array( 'mp4|m4v' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime' );
	$audio = array( 'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'wav' => 'audio/wav', 'ogg|oga' => 'audio/ogg', 'aac' => 'audio/aac' );
	switch ( $purpose ) {
		case 'intro':  return array( 'mimes' => $video, 'max' => 40 * MB_IN_BYTES );
		case 'audio':  return array( 'mimes' => $audio, 'max' => 60 * MB_IN_BYTES );
		case 'bg':     return array( 'mimes' => $image + $video, 'max' => 25 * MB_IN_BYTES );
		case 'cardbg': case 'cover': case 'poster': default: return array( 'mimes' => $image, 'max' => 12 * MB_IN_BYTES );
	}
}

function sml_lls_rest_upload( $request ) {
	$row = sml_lls_letter_by_id( (int) $request['id'] );
	if ( ! $row ) { return new WP_Error( 'sml_lls_missing', 'Letter not found.', array( 'status' => 404 ) ); }
	$purpose = sanitize_key( (string) $request->get_param( 'purpose' ) ) ?: 'cover';
	$files   = $request->get_file_params();
	$file    = $files['file'] ?? null;
	if ( ! $file || empty( $file['tmp_name'] ) ) { return new WP_Error( 'sml_lls_nofile', 'No file was sent.', array( 'status' => 400 ) ); }
	$rules = sml_lls_upload_rules( $purpose );
	if ( (int) $file['size'] > $rules['max'] ) { return new WP_Error( 'sml_lls_big', 'That file is larger than ' . size_format( $rules['max'] ) . '.', array( 'status' => 413 ) ); }
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';
	require_once ABSPATH . 'wp-admin/includes/image.php';
	$check = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'], $rules['mimes'] );
	if ( empty( $check['type'] ) ) { return new WP_Error( 'sml_lls_type', 'That file type is not allowed for ' . $purpose . '.', array( 'status' => 415 ) ); }
	$up = wp_handle_upload( $file, array( 'test_form' => false, 'mimes' => $rules['mimes'], 'unique_filename_callback' => function ( $dir, $name, $ext ) use ( $row, $purpose ) { return 'loop-letter-' . (int) $row['id'] . '-' . $purpose . '-' . substr( md5( $name . microtime() ), 0, 8 ) . $ext; } ) );
	if ( ! empty( $up['error'] ) ) { return new WP_Error( 'sml_lls_upload', $up['error'], array( 'status' => 400 ) ); }
	$att_id = wp_insert_attachment( array( 'post_mime_type' => $up['type'], 'post_title' => sanitize_text_field( $row['title'] . ' (' . $purpose . ')' ), 'post_content' => '', 'post_status' => 'inherit', 'post_author' => (int) $row['author_id'] ), $up['file'] );
	if ( $att_id && ! is_wp_error( $att_id ) && strpos( $up['type'], 'image/' ) === 0 ) { wp_update_attachment_metadata( $att_id, wp_generate_attachment_metadata( $att_id, $up['file'] ) ); }
	$att_id = is_wp_error( $att_id ) ? 0 : (int) $att_id;
	$seconds = (float) $request->get_param( 'seconds' );
	$patch = array();
	switch ( $purpose ) {
		case 'cover':  $patch = array( 'cover' => array( 'url' => $up['url'], 'id' => $att_id ) ); break;
		case 'intro':  $patch = array( 'intro' => array( 'url' => $up['url'], 'id' => $att_id, 'seconds' => round( min( 16, max( 0, $seconds ) ), 2 ), 'enabled' => true ) ); break;
		case 'poster': $patch = array( 'intro' => array( 'poster' => $up['url'] ) ); break;
		case 'audio':  $patch = array( 'audio' => array( 'mode' => 'upload', 'url' => $up['url'], 'id' => $att_id, 'seconds' => round( max( 0, $seconds ), 1 ) ) ); break;
		case 'bg':     $patch = array( 'immersive' => array( 'bg_url' => $up['url'], 'bg_id' => $att_id, 'bg_mode' => strpos( $up['type'], 'video/' ) === 0 ? 'video' : 'image' ) ); break;
		case 'cardbg': $patch = array( 'card' => array( 'bg_url' => $up['url'], 'bg_id' => $att_id, 'bg' => 'upload' ) ); break;
	}
	if ( $patch ) { sml_lls_rest_save_patch( $row, $patch ); }
	return array( 'ok' => true, 'url' => $up['url'], 'id' => $att_id, 'type' => $up['type'], 'purpose' => $purpose, 'data' => sml_lls_get( $row['id'] ) );
}

function sml_lls_rest_save_patch( $row, $patch ) {
	sml_lls_put( $row['id'], $patch );
	if ( ! empty( $patch['cover']['url'] ) && function_exists( 'sml_letters_table' ) ) {
		global $wpdb;
		$wpdb->update( sml_letters_table( 'posts' ), array( 'cover_url' => $patch['cover']['url'] ), array( 'id' => (int) $row['id'] ) );
	}
}

function sml_lls_rest_card( $request ) {
	$row = sml_lls_letter_by_id( (int) $request['id'] );
	if ( ! $row ) { return new WP_Error( 'sml_lls_missing', 'Letter not found.', array( 'status' => 404 ) ); }
	$body  = $request->get_json_params() ?: array();
	$patch = sml_lls_sanitize_patch( array( 'card' => $body['card'] ?? array() ) );
	if ( ! empty( $patch['card'] ) ) { sml_lls_put( $row['id'], $patch ); }
	$data = sml_lls_get( $row['id'] );
	$res  = sml_lls_card_generate( $row, $data, array(), ! empty( $body['force'] ) );
	if ( is_wp_error( $res ) ) { return $res; }
	$res['ok'] = true; $res['data'] = sml_lls_get( $row['id'] ); unset( $res['data']['card']['files'] );
	return $res;
}

/** Writer-side checklist: what search engines and readers will see. */
function sml_lls_rest_check( $request ) {
	$row = sml_lls_letter_by_id( (int) $request['id'] );
	if ( ! $row ) { return new WP_Error( 'sml_lls_missing', 'Letter not found.', array( 'status' => 404 ) ); }
	$data   = sml_lls_get( $row['id'] );
	$blocks = sml_lls_blocks( $row );
	$text   = trim( (string) $row['plaintext'] );
	$title  = sml_lls_title( $row, $data );
	$desc   = sml_lls_description( $row, $data );
	$words  = (int) $row['word_count'] ?: str_word_count( $text );
	$sentences = max( 1, preg_match_all( '/[.!?]+(\s|$)/', $text ) );
	$syll = 0; foreach ( preg_split( '/\s+/', strtolower( $text ) ) as $w ) { $syll += max( 1, preg_match_all( '/[aeiouy]+/', $w ) ); }
	$flesch = $words ? round( 206.835 - 1.015 * ( $words / $sentences ) - 84.6 * ( $syll / max( 1, $words ) ) ) : 0;
	$headings = 0; $quotes = 0; $tickers = 0; $images = 0; $paras = 0; $long = 0;
	foreach ( $blocks as $b ) {
		$t = $b['type'] ?? '';
		if ( $t === 'heading' ) { $headings++; } elseif ( $t === 'quote' ) { $quotes++; } elseif ( in_array( $t, array( 'ticker_card', 'chart', 'levels' ), true ) ) { $tickers++; }
		elseif ( $t === 'paragraph' ) { $paras++; if ( str_word_count( (string) ( $b['text'] ?? '' ) ) > 120 ) { $long++; } }
		if ( ! empty( $b['image'] ) || ! empty( $b['url'] ) && $t === 'image' ) { $images++; }
	}
	$items = array();
	$add = function ( $ok, $key, $label, $hint, $level = 'warn' ) use ( &$items ) { $items[] = array( 'ok' => (bool) $ok, 'key' => $key, 'label' => $label, 'hint' => $hint, 'level' => $level ); };
	$tl = mb_strlen( $title );
	$add( $tl >= 35 && $tl <= 70, 'title', 'Headline length ' . $tl . ' characters', 'Search shows about 60 characters. Keep it between 35 and 70 and lead with the thing the reader searches for.' );
	$dl = mb_strlen( $desc );
	$add( $dl >= 90 && $dl <= 160, 'desc', 'Description ' . $dl . ' characters', 'Write the description yourself in SEO. 120 to 160 characters, one concrete claim, the ticker in it.' );
	$add( (bool) sml_lls_cover( $row, $data ) || (bool) sml_lls_card_images( $row, $data )['wide'], 'image', 'Share image set', 'Add a cover or generate the share card. Google Discover and every social feed need a 1200 pixel wide image.', 'error' );
	$add( $words >= 400, 'length', $words . ' words', 'Letters under 400 words rarely rank or get picked up by Google News. 700 to 1500 is the sweet spot for a market letter.' );
	$add( $headings >= 2 || $words < 500, 'headings', $headings . ' headings', 'Break the letter into sections with headings. Readers scan first and the table of contents builds itself from them.' );
	$add( (bool) sml_lls_tickers( $row ), 'tickers', 'Tickers tagged', 'Mention a $TICKER in the text or add a ticker card. The page then carries stock_tickers in the news sitemap and Corporation entities in the schema.' );
	$add( ! empty( $data['seo']['keyword'] ) && stripos( $title . ' ' . $desc, $data['seo']['keyword'] ) !== false, 'keyword', 'Focus phrase in headline and description', 'Pick one phrase a reader would type, then use it once in the headline, once in the description and in the first paragraph.' );
	$add( $long === 0, 'paragraphs', $long ? $long . ' paragraphs over 120 words' : 'Paragraph length', 'Split anything over 120 words. On a phone a long paragraph is a wall and readers leave at walls.', 'info' );
	$add( $flesch >= 50 || ! $words, 'readability', 'Readability score ' . $flesch, 'Scores under 50 read like a filing. Shorter sentences and plain verbs lift it without dumbing anything down.', 'info' );
	$add( $row['subtitle'] !== '' || $row['tldr'] !== '', 'subtitle', 'Subtitle or summary', 'A one-line subtitle becomes the description fallback and the card subtitle.', 'info' );
	$add( ! empty( $data['intro']['url'] ) || ! empty( $data['audio']['url'] ) || ! empty( $data['audio']['youtube'] ), 'media', 'Intro video or audio', 'A 15 second intro or a voice read keeps readers on the page longer and earns the VideoObject and AudioObject schema.', 'info' );
	$add( $row['visibility'] === 'public' || $row['visibility'] === 'members', 'visibility', 'Indexable visibility', 'Public and members letters are indexed. Followers-only letters are indexed with paywall markup; keep the first section open so the snippet has something to show.', 'info' );
	$score = 0; $max = 0;
	foreach ( $items as $i ) { $w = $i['level'] === 'error' ? 3 : ( $i['level'] === 'warn' ? 2 : 1 ); $max += $w; if ( $i['ok'] ) { $score += $w; } }
	return array( 'ok' => true, 'score' => $max ? (int) round( 100 * $score / $max ) : 0, 'items' => $items, 'words' => $words, 'read_minutes' => (int) max( 1, $row['read_minutes'] ), 'flesch' => $flesch, 'title' => $title, 'description' => $desc, 'url' => sml_lls_letter_url( $row ), 'image' => sml_lls_card_images( $row, $data )['wide'] ?: sml_lls_cover( $row, $data ) );
}

function sml_lls_rest_react( $request ) {
	global $wpdb;
	$row = sml_lls_letter_by_id( (int) $request['id'] );
	if ( ! $row || $row['status'] !== 'published' ) { return new WP_Error( 'sml_lls_missing', 'Letter not found.', array( 'status' => 404 ) ); }
	$kind = sanitize_key( (string) $request->get_param( 'kind' ) );
	if ( ! in_array( $kind, array( 'bull', 'bear', 'fire', 'mind' ), true ) ) { return new WP_Error( 'sml_lls_kind', 'Unknown reaction.', array( 'status' => 400 ) ); }
	$fp = sml_lls_fingerprint();
	$t  = sml_lls_table( 'reactions' );
	$existing = $wpdb->get_row( $wpdb->prepare( "SELECT id, kind FROM $t WHERE letter_id = %d AND fingerprint = %s", (int) $row['id'], $fp ), ARRAY_A );
	$mine = $kind;
	if ( $existing && $existing['kind'] === $kind ) { $wpdb->delete( $t, array( 'id' => (int) $existing['id'] ) ); $mine = ''; }
	elseif ( $existing ) { $wpdb->update( $t, array( 'kind' => $kind, 'created_at' => gmdate( 'Y-m-d H:i:s' ) ), array( 'id' => (int) $existing['id'] ) ); }
	else { $wpdb->insert( $t, array( 'letter_id' => (int) $row['id'], 'kind' => $kind, 'fingerprint' => $fp, 'created_at' => gmdate( 'Y-m-d H:i:s' ) ) ); }
	return array( 'ok' => true, 'mine' => $mine, 'counts' => sml_lls_reaction_counts( $row['id'] ) );
}

function sml_lls_rest_public( $request ) {
	global $wpdb;
	$row = sml_lls_letter_by_id( (int) $request['id'] );
	if ( ! $row || $row['status'] !== 'published' ) { return new WP_Error( 'sml_lls_missing', 'Letter not found.', array( 'status' => 404 ) ); }
	$fp   = sml_lls_fingerprint();
	$mine = $wpdb->get_var( $wpdb->prepare( 'SELECT kind FROM ' . sml_lls_table( 'reactions' ) . ' WHERE letter_id = %d AND fingerprint = %s', (int) $row['id'], $fp ) );
	return array( 'ok' => true, 'counts' => sml_lls_reaction_counts( $row['id'] ), 'mine' => (string) $mine, 'reads' => (int) $row['read_count'], 'bookmarks' => (int) $row['bookmark_count'] );
}

function sml_lls_rest_ping() {
	sml_lls_flush_xml();
	$urls = array();
	foreach ( sml_lls_published( 20 ) as $r ) { $urls[] = sml_lls_letter_url( $r ); }
	$res = $urls ? sml_lls_indexnow( $urls ) : null;
	return array( 'ok' => true, 'submitted' => count( $urls ), 'indexnow' => array( 'ok' => (bool) $res, 'code' => (int) ( get_option( 'sml_lls_indexnow_last' )['code'] ?? 0 ) ) );
}
