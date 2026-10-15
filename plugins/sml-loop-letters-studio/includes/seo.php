<?php
/**
 * Search metadata for a letter page, the letters sitemaps (news and full), the
 * site-wide letters feed, and IndexNow pings for Bing and Yahoo.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

/** The <head> tags of a letter page. */
function sml_lls_head( $row, $letter, $data, $pub, $canonical ) {
	$title     = sml_lls_title( $row, $data );
	$desc      = sml_lls_description( $row, $data );
	$og_title  = $data['seo']['og_title'] ?: $title;
	$og_desc   = $data['seo']['og_desc'] ?: $desc;
	$images    = sml_lls_card_images( $row, $data );
	$image     = $images['wide'] ?: sml_lls_cover( $row, $data );
	$indexable = sml_lls_is_indexable( $row, $data );
	$tickers   = sml_lls_tickers( $row );
	$tags      = array_values( array_filter( array_map( 'trim', explode( ',', (string) $row['tags'] ) ) ) );
	$site      = get_bloginfo( 'name' );
	$out = '';
	$out .= '<title>' . esc_html( $title ) . ' | ' . esc_html( $pub['name'] ) . '</title>' . "\n";
	$out .= '<meta name="description" content="' . esc_attr( $desc ) . '">' . "\n";
	$canon_tag  = '<link rel="canonical" href="' . esc_url( $canonical ) . '">' . "\n";
	$robots_tag = '<meta name="robots" content="' . ( $indexable ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' : 'noindex, follow' ) . '">' . "\n";
	$GLOBALS['sml_lls_final'] = array( 'robots' => $robots_tag, 'canonical' => $canon_tag );
	$out .= $canon_tag . $robots_tag;
	$out .= '<meta name="googlebot-news" content="' . ( $indexable ? 'index' : 'noindex' ) . '">' . "\n";
	if ( $data['seo']['news_keywords'] ) { $out .= '<meta name="news_keywords" content="' . esc_attr( sml_lls_trim( $data['seo']['news_keywords'], 200 ) ) . '">' . "\n"; }
	$out .= '<meta name="author" content="' . esc_attr( $pub['author_name'] ) . '">' . "\n";
	$out .= '<link rel="author" href="' . esc_url( $pub['author_url'] ) . '">' . "\n";
	$out .= '<link rel="alternate" type="application/rss+xml" title="' . esc_attr( $pub['name'] ) . '" href="' . esc_url( $pub['feed'] ) . '">' . "\n";
	$out .= '<link rel="alternate" type="application/rss+xml" title="Loop Letters on ' . esc_attr( $site ) . '" href="' . esc_url( home_url( '/sml-letters-feed.xml' ) ) . '">' . "\n";
	$out .= '<meta property="og:type" content="article">' . "\n";
	$out .= '<meta property="og:site_name" content="' . esc_attr( $site ) . '">' . "\n";
	$out .= '<meta property="og:locale" content="' . esc_attr( str_replace( '-', '_', get_bloginfo( 'language' ) ) ) . '">' . "\n";
	$out .= '<meta property="og:url" content="' . esc_url( $canonical ) . '">' . "\n";
	$out .= '<meta property="og:title" content="' . esc_attr( $og_title ) . '">' . "\n";
	$out .= '<meta property="og:description" content="' . esc_attr( $og_desc ) . '">' . "\n";
	if ( $image ) {
		$out .= '<meta property="og:image" content="' . esc_url( $image ) . '">' . "\n";
		$out .= '<meta property="og:image:secure_url" content="' . esc_url( $image ) . '">' . "\n";
		$out .= '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' . "\n";
		$out .= '<meta property="og:image:alt" content="' . esc_attr( $og_title ) . '">' . "\n";
	}
	if ( ! empty( $data['intro']['url'] ) && ! empty( $data['intro']['enabled'] ) ) {
		$out .= '<meta property="og:video" content="' . esc_url( $data['intro']['url'] ) . '"><meta property="og:video:type" content="video/mp4">' . "\n";
	}
	$out .= '<meta property="article:published_time" content="' . esc_attr( sml_lls_iso( $row['published_at'] ?: $row['created_at'] ) ) . '">' . "\n";
	$out .= '<meta property="article:modified_time" content="' . esc_attr( sml_lls_iso( $row['updated_at'] ) ) . '">' . "\n";
	$out .= '<meta property="article:author" content="' . esc_url( $pub['author_url'] ) . '">' . "\n";
	$out .= '<meta property="article:section" content="' . esc_attr( $row['content_type'] ?: 'Analysis' ) . '">' . "\n";
	foreach ( array_slice( array_unique( array_merge( $tickers, $tags ) ), 0, 12 ) as $t ) { $out .= '<meta property="article:tag" content="' . esc_attr( $t ) . '">' . "\n"; }
	$out .= '<meta name="twitter:card" content="summary_large_image">' . "\n";
	$out .= '<meta name="twitter:title" content="' . esc_attr( $og_title ) . '">' . "\n";
	$out .= '<meta name="twitter:description" content="' . esc_attr( $og_desc ) . '">' . "\n";
	if ( $image ) { $out .= '<meta name="twitter:image" content="' . esc_url( $image ) . '"><meta name="twitter:image:alt" content="' . esc_attr( $og_title ) . '">' . "\n"; }
	$x = $pub['social']['x'] ?? '';
	if ( $x && preg_match( '#(?:x\.com|twitter\.com)/@?([A-Za-z0-9_]{1,15})#', $x, $m ) ) { $out .= '<meta name="twitter:creator" content="@' . esc_attr( $m[1] ) . '">' . "\n"; }
	$out .= '<meta name="twitter:label1" content="Reading time"><meta name="twitter:data1" content="' . (int) max( 1, $row['read_minutes'] ) . ' min">' . "\n";
	if ( $tickers ) { $out .= '<meta name="twitter:label2" content="Tickers"><meta name="twitter:data2" content="' . esc_attr( implode( ', ', array_map( function ( $s ) { return '$' . $s; }, array_slice( $tickers, 0, 4 ) ) ) ) . '">' . "\n"; }
	$out .= '<script type="application/ld+json">' . wp_json_encode( sml_lls_jsonld( $row, $letter, $data, $pub, $canonical, $images, $desc, $tickers, $tags ), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . '</script>' . "\n";
	return $out;
}

function sml_lls_jsonld( $row, $letter, $data, $pub, $canonical, $images, $desc, $tickers, $tags ) {
	$site    = get_bloginfo( 'name' );
	$org_id  = home_url( '/#organization' );
	$auth_id = $pub['author_url'] . '#person';
	$type    = in_array( $data['seo']['schema_type'], array( 'NewsArticle', 'AnalysisNewsArticle', 'OpinionNewsArticle', 'BlogPosting', 'Article' ), true ) ? $data['seo']['schema_type'] : 'NewsArticle';
	$image_list = array_values( array_filter( array( $images['wide'], $images['standard'], $images['square'] ) ) );
	if ( ! $image_list && sml_lls_cover( $row, $data ) ) { $image_list = array( sml_lls_cover( $row, $data ) ); }
	$logo = sml_lls_site_logo();
	$org  = array( '@type' => 'Organization', '@id' => $org_id, 'name' => $site, 'url' => home_url( '/' ) );
	if ( $logo ) { $org['logo'] = array( '@type' => 'ImageObject', 'url' => $logo, 'width' => 512, 'height' => 512 ); }
	$person = array( '@type' => 'Person', '@id' => $auth_id, 'name' => $pub['author_name'], 'url' => $pub['author_url'], 'image' => $pub['avatar'] );
	if ( $pub['social'] ) { $person['sameAs'] = array_values( $pub['social'] ); }
	$person['worksFor'] = array( '@id' => $org_id );
	$article = array(
		'@type'            => $type,
		'@id'              => $canonical . '#article',
		'headline'         => sml_lls_trim( $row['title'], 110 ),
		'description'      => $desc,
		'url'              => $canonical,
		'mainEntityOfPage' => array( '@type' => 'WebPage', '@id' => $canonical ),
		'datePublished'    => sml_lls_iso( $row['published_at'] ?: $row['created_at'] ),
		'dateModified'     => sml_lls_iso( $row['updated_at'] ),
		'author'           => array( '@id' => $auth_id ),
		'publisher'        => array( '@id' => $org_id ),
		'inLanguage'       => get_bloginfo( 'language' ),
		'articleSection'   => $row['content_type'] ?: 'Analysis',
		'wordCount'        => (int) $row['word_count'],
		'timeRequired'     => 'PT' . (int) max( 1, $row['read_minutes'] ) . 'M',
		'isPartOf'         => array( '@type' => 'Periodical', 'name' => $pub['name'], 'url' => $pub['url'] ),
		'isAccessibleForFree' => sml_lls_is_public( $row ) ? 'True' : 'False',
	);
	if ( $row['subtitle'] ) { $article['alternativeHeadline'] = sml_lls_trim( $row['subtitle'], 160 ); }
	if ( $image_list ) { $article['image'] = $image_list; }
	$kw = array_unique( array_merge( $tags, $tickers, array_filter( array_map( 'trim', explode( ',', (string) $data['seo']['news_keywords'] ) ) ) ) );
	if ( $kw ) { $article['keywords'] = implode( ', ', array_slice( $kw, 0, 12 ) ); }
	if ( $tickers ) {
		$article['about'] = array_map( function ( $s ) { return array( '@type' => 'Corporation', 'name' => $s, 'tickerSymbol' => $s, 'url' => home_url( '/stocks/' . strtolower( $s ) . '/' ) ); }, array_slice( $tickers, 0, 6 ) );
	}
	if ( ! sml_lls_is_public( $row ) ) { $article['hasPart'] = array( '@type' => 'WebPageElement', 'isAccessibleForFree' => 'False', 'cssSelector' => '.lp-gated' ); }
	if ( ! empty( $data['intro']['enabled'] ) && ! empty( $data['intro']['url'] ) ) {
		$article['video'] = array(
			'@type' => 'VideoObject', 'name' => 'Intro: ' . sml_lls_trim( $row['title'], 90 ), 'description' => $desc,
			'contentUrl' => $data['intro']['url'], 'thumbnailUrl' => array_values( array_filter( array( $data['intro']['poster'], $images['wide'], sml_lls_cover( $row, $data ) ) ) ),
			'uploadDate' => sml_lls_iso( $row['published_at'] ?: $row['created_at'] ), 'duration' => 'PT' . max( 1, (int) round( $data['intro']['seconds'] ?: 15 ) ) . 'S',
		);
	}
	if ( ( $data['audio']['mode'] ?? '' ) === 'upload' && ! empty( $data['audio']['url'] ) ) {
		$article['audio'] = array( '@type' => 'AudioObject', 'name' => sml_lls_trim( $row['title'], 90 ) . ' (audio)', 'contentUrl' => $data['audio']['url'], 'encodingFormat' => sml_lls_mime_from_url( $data['audio']['url'] ), 'duration' => 'PT' . max( 1, (int) round( $data['audio']['seconds'] ) ) . 'S' );
	}
	$crumbs = array( '@type' => 'BreadcrumbList', 'itemListElement' => array(
		array( '@type' => 'ListItem', 'position' => 1, 'name' => $site, 'item' => home_url( '/' ) ),
		array( '@type' => 'ListItem', 'position' => 2, 'name' => 'Loop Letters', 'item' => home_url( '/n/' ) ),
		array( '@type' => 'ListItem', 'position' => 3, 'name' => $pub['name'], 'item' => $pub['url'] ),
		array( '@type' => 'ListItem', 'position' => 4, 'name' => sml_lls_trim( $row['title'], 110 ) ),
	) );
	return array( '@context' => 'https://schema.org', '@graph' => array( $org, $person, $article, $crumbs ) );
}

function sml_lls_site_logo() {
	static $logo = null;
	if ( $logo !== null ) { return $logo; }
	$logo = '';
	$id = (int) get_theme_mod( 'custom_logo' ); if ( ! $id ) { $id = (int) get_option( 'site_icon' ); }
	if ( $id ) { $logo = (string) wp_get_attachment_image_url( $id, 'full' ); }
	if ( ! $logo && function_exists( 'sml_ds_url' ) ) { $logo = sml_ds_url( 'assets/logo.png' ); }
	return $logo;
}
function sml_lls_mime_from_url( $url ) {
	$ext = strtolower( pathinfo( (string) wp_parse_url( $url, PHP_URL_PATH ), PATHINFO_EXTENSION ) );
	$map = array( 'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'wav' => 'audio/wav', 'ogg' => 'audio/ogg', 'oga' => 'audio/ogg', 'mp4' => 'video/mp4', 'webm' => 'video/webm' );
	return $map[ $ext ] ?? 'application/octet-stream';
}

/* ---------------- sitemaps, feed, IndexNow key ---------------- */

add_action( 'init', 'sml_lls_serve_xml', 0 );
function sml_lls_serve_xml() {
	if ( is_admin() ) { return; }
	$path = trim( (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH ), '/' );
	$key  = (string) get_option( 'sml_lls_indexnow_key' );
	if ( $key && $path === $key . '.txt' ) { nocache_headers(); header( 'Content-Type: text/plain; charset=utf-8' ); header( 'X-Robots-Tag: noindex' ); echo $key; exit; } // phpcs:ignore
	if ( 'sml-letters-news-sitemap.xml' === $path ) { sml_lls_emit_xml( 'sml_lls_news_sitemap', 'sml_lls_build_news_sitemap', 300 ); }
	if ( 'sml-letters-full-sitemap.xml' === $path ) { sml_lls_emit_xml( 'sml_lls_full_sitemap', 'sml_lls_build_full_sitemap', 900 ); }
	if ( 'sml-letters-feed.xml' === $path ) { sml_lls_emit_xml( 'sml_lls_feed', 'sml_lls_build_feed', 300, 'application/rss+xml' ); }
}
function sml_lls_emit_xml( $key, $builder, $ttl, $type = 'application/xml' ) {
	$xml = get_transient( $key );
	if ( ! $xml ) { $xml = call_user_func( $builder ); set_transient( $key, $xml, $ttl ); }
	status_header( 200 ); nocache_headers();
	header( 'Content-Type: ' . $type . '; charset=UTF-8' ); header( 'X-Robots-Tag: noindex' );
	echo $xml; // phpcs:ignore
	exit;
}
function sml_lls_flush_xml() { delete_transient( 'sml_lls_news_sitemap' ); delete_transient( 'sml_lls_full_sitemap' ); delete_transient( 'sml_lls_feed' ); }

function sml_lls_build_news_sitemap() {
	$rows = sml_lls_published( 1000, 48 );
	$x = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' . "\n";
	foreach ( $rows as $r ) {
		$data = sml_lls_get( $r['id'] ); if ( ! empty( $data['seo']['noindex'] ) ) { continue; }
		$img  = sml_lls_card_images( $r, $data )['wide'] ?: sml_lls_cover( $r, $data );
		$x .= '<url><loc>' . esc_url( sml_lls_letter_url( $r ) ) . '</loc><lastmod>' . esc_html( sml_lls_iso( $r['updated_at'] ) ) . '</lastmod>';
		$x .= '<news:news><news:publication><news:name>' . esc_html( get_bloginfo( 'name' ) ) . '</news:name><news:language>' . esc_html( substr( get_bloginfo( 'language' ), 0, 2 ) ) . '</news:language></news:publication>';
		$x .= '<news:publication_date>' . esc_html( sml_lls_iso( $r['published_at'] ) ) . '</news:publication_date><news:title>' . esc_html( $r['title'] ) . '</news:title>';
		$kw = sml_lls_tickers( $r ); if ( $kw ) { $x .= '<news:keywords>' . esc_html( implode( ', ', array_slice( $kw, 0, 10 ) ) ) . '</news:keywords><news:stock_tickers>' . esc_html( implode( ', ', array_map( function ( $s ) { return 'NASDAQ:' . $s; }, array_slice( $kw, 0, 5 ) ) ) ) . '</news:stock_tickers>'; }
		$x .= '</news:news>';
		if ( $img ) { $x .= '<image:image><image:loc>' . esc_url( $img ) . '</image:loc><image:title>' . esc_html( $r['title'] ) . '</image:title></image:image>'; }
		$x .= '</url>' . "\n";
	}
	return $x . '</urlset>';
}
function sml_lls_build_full_sitemap() {
	global $wpdb;
	$rows = sml_lls_published( 5000 );
	$x = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' . "\n";
	$pubs = array();
	foreach ( $rows as $r ) {
		$data = sml_lls_get( $r['id'] ); if ( ! empty( $data['seo']['noindex'] ) ) { continue; }
		$img  = sml_lls_card_images( $r, $data )['wide'] ?: sml_lls_cover( $r, $data );
		$x .= '<url><loc>' . esc_url( sml_lls_letter_url( $r ) ) . '</loc><lastmod>' . esc_html( sml_lls_iso( $r['updated_at'] ) ) . '</lastmod><changefreq>weekly</changefreq><priority>0.7</priority>';
		if ( $img ) { $x .= '<image:image><image:loc>' . esc_url( $img ) . '</image:loc></image:image>'; }
		$x .= '</url>' . "\n";
		$pubs[ (int) $r['author_id'] ] = max( $pubs[ (int) $r['author_id'] ] ?? '', $r['updated_at'] );
	}
	foreach ( $pubs as $uid => $mod ) { $x .= '<url><loc>' . esc_url( sml_lls_publication_url( $uid ) ) . '</loc><lastmod>' . esc_html( sml_lls_iso( $mod ) ) . '</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>' . "\n"; }
	$x .= '<url><loc>' . esc_url( home_url( '/n/' ) ) . '</loc><changefreq>daily</changefreq><priority>0.6</priority></url>' . "\n";
	return $x . '</urlset>';
}
function sml_lls_build_feed() {
	$rows = sml_lls_published( 50 );
	$site = get_bloginfo( 'name' );
	$x = '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">' . "\n<channel>\n";
	$x .= '<title>Loop Letters on ' . esc_html( $site ) . '</title><link>' . esc_url( home_url( '/n/' ) ) . '</link><description>Market letters from the creators of ' . esc_html( $site ) . ': issues, tickers and analysis.</description><language>' . esc_html( get_bloginfo( 'language' ) ) . '</language>';
	$x .= '<atom:link href="' . esc_url( home_url( '/sml-letters-feed.xml' ) ) . '" rel="self" type="application/rss+xml" /><lastBuildDate>' . esc_html( gmdate( 'r' ) ) . '</lastBuildDate>' . "\n";
	foreach ( $rows as $r ) {
		$data = sml_lls_get( $r['id'] ); if ( ! empty( $data['seo']['noindex'] ) ) { continue; }
		$pub  = sml_lls_publication( $r['author_id'] );
		$url  = sml_lls_letter_url( $r );
		$img  = sml_lls_card_images( $r, $data )['wide'] ?: sml_lls_cover( $r, $data );
		$x .= '<item><title>' . esc_html( $r['title'] ) . '</title><link>' . esc_url( $url ) . '</link><guid isPermaLink="true">' . esc_url( $url ) . '</guid>';
		$x .= '<pubDate>' . esc_html( gmdate( 'r', strtotime( $r['published_at'] . ' UTC' ) ) ) . '</pubDate><dc:creator>' . esc_html( $pub['author_name'] ) . '</dc:creator>';
		$x .= '<description><![CDATA[' . sml_lls_description( $r, $data ) . ']]></description>';
		$x .= '<content:encoded><![CDATA[' . ( $img ? '<p><img src="' . esc_url( $img ) . '" alt=""></p>' : '' ) . $r['html'] . '<p><a href="' . esc_url( $url ) . '">Read on ' . esc_html( $site ) . '</a></p>]]></content:encoded>';
		foreach ( sml_lls_tickers( $r ) as $t ) { $x .= '<category>' . esc_html( $t ) . '</category>'; }
		if ( $img ) { $x .= '<media:content url="' . esc_url( $img ) . '" medium="image" width="1200" height="630" /><enclosure url="' . esc_url( $img ) . '" type="image/png" length="0" />'; }
		$x .= '</item>' . "\n";
	}
	return $x . "</channel>\n</rss>";
}

/* Registered from wp_loaded: the Google sitemaps plugin rewrites the Sitemap block at the same priority and drops lines added earlier. */
add_action( 'wp_loaded', function () { add_filter( 'robots_txt', 'sml_lls_robots', 30 ); } );
function sml_lls_robots( $txt ) {
	foreach ( array( '/sml-letters-news-sitemap.xml', '/sml-letters-full-sitemap.xml' ) as $p ) {
		if ( false === strpos( $txt, $p ) ) { $txt = rtrim( $txt ) . "\nSitemap: " . home_url( $p ) . "\n"; }
	}
	return $txt;
}

/* ---------------- IndexNow (Bing, Yahoo, Yandex, Naver, Seznam) ---------------- */

function sml_lls_indexnow( $urls ) {
	$key = (string) get_option( 'sml_lls_indexnow_key' );
	$urls = array_values( array_unique( array_filter( (array) $urls ) ) );
	if ( ! $key || ! $urls ) { return false; }
	$host = (string) wp_parse_url( home_url( '/' ), PHP_URL_HOST );
	$body = array( 'host' => $host, 'key' => $key, 'keyLocation' => home_url( '/' . $key . '.txt' ), 'urlList' => array_slice( $urls, 0, 500 ) );
	$r = wp_remote_post( 'https://api.indexnow.org/indexnow', array( 'timeout' => 8, 'headers' => array( 'Content-Type' => 'application/json; charset=utf-8' ), 'body' => wp_json_encode( $body ), 'blocking' => true ) );
	$code = is_wp_error( $r ) ? 0 : (int) wp_remote_retrieve_response_code( $r );
	update_option( 'sml_lls_indexnow_last', array( 'at' => gmdate( 'c' ), 'code' => $code, 'urls' => count( $urls ) ), false );
	return $code >= 200 && $code < 300;
}

add_action( 'sml_letters_published', 'sml_lls_on_published', 20, 2 );
function sml_lls_on_published( $letter_id, $row = null ) {
	sml_lls_flush_xml();
	$row = sml_lls_letter_by_id( $letter_id );
	if ( ! $row ) { return; }
	$data = sml_lls_get( $letter_id );
	if ( ! sml_lls_card_images( $row, $data )['wide'] && ! sml_lls_cover( $row, $data ) ) { sml_lls_card_generate( $row, $data ); }
	if ( sml_lls_is_indexable( $row, $data ) ) {
		wp_schedule_single_event( time() + 20, 'sml_lls_ping', array( array( sml_lls_letter_url( $row ), sml_lls_publication_url( $row['author_id'] ), home_url( '/sml-letters-news-sitemap.xml' ) ) ) );
	}
}
add_action( 'sml_lls_ping', 'sml_lls_indexnow' );
