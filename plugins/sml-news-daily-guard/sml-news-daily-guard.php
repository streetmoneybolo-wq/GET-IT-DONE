<?php
/**
 * Plugin Name: SML News Daily Guard
 * Description: Race-safe one-post-per-ticker-topic-day protection for automated Markets news.
 * Version: 1.2.0
 * Author: StockMarketLoop
 * Requires at least: 6.4
 * Requires PHP: 8.0
 */

defined( 'ABSPATH' ) || exit;

final class SML_News_Daily_Guard_V120 {
	const VERSION = '1.2.0';
	const MARKET_CATEGORY_ID = 7212105;
	// The Make connection currently authenticates as this service/editor user.
	const MAKE_INGEST_USER_ID = 258456543;
	// All generated SML News articles must belong to /stockmarketloop/.
	const SML_NEWS_AUTHOR_ID = 258456587;
	const META_KEY = '_sml_news_daily_key';
	const DUPLICATE_META = '_sml_news_duplicate_of';
	const SOURCE = 'daily_ticker_topic';

	private static $request_keys = array();
	private static $fallback_lock = false;

	public static function boot() {
		add_filter( 'rest_pre_dispatch', array( __CLASS__, 'intercept_rest_create' ), 8, 3 );
		add_filter( 'rest_pre_insert_post', array( __CLASS__, 'protect_rest_insert' ), 5, 2 );
		add_action( 'rest_after_insert_post', array( __CLASS__, 'attach_created_post' ), 10, 3 );
		add_action( 'wp_after_insert_post', array( __CLASS__, 'protect_non_rest_insert' ), 20, 4 );
		add_action( 'sml_news_daily_guard_cleanup', array( __CLASS__, 'cleanup' ) );
		add_action( 'init', array( __CLASS__, 'ensure_schedule' ) );
	}

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'sml_news_daily_keys';
	}

	public static function activate() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table = self::table();
		$charset = $wpdb->get_charset_collate();
		dbDelta( "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			daily_key char(64) NOT NULL,
			trading_day date NOT NULL,
			ticker_key varchar(96) NOT NULL DEFAULT '',
			topic_key varchar(255) NOT NULL DEFAULT '',
			post_id bigint(20) unsigned NOT NULL DEFAULT 0,
			state varchar(16) NOT NULL DEFAULT 'reserved',
			reserved_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY daily_key (daily_key),
			KEY post_id (post_id),
			KEY trading_day (trading_day)
		) {$charset};" );
		self::ensure_schedule();
	}

	public static function deactivate() {
		wp_clear_scheduled_hook( 'sml_news_daily_guard_cleanup' );
	}

	public static function ensure_schedule() {
		if ( ! wp_next_scheduled( 'sml_news_daily_guard_cleanup' ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'sml_news_daily_guard_cleanup' );
		}
	}

	public static function cleanup() {
		global $wpdb;
		$table = self::table();
		$wpdb->query( "DELETE FROM {$table} WHERE updated_at < UTC_TIMESTAMP() - INTERVAL 45 DAY" );
	}

	public static function normalize_tokens( $title ) {
		$title = strtolower( remove_accents( wp_strip_all_tags( html_entity_decode( (string) $title, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) ) ) );
		$title = str_replace(
			array( 'adviser','advisers','defence','equities','bonds','dismisses','dismissed','raises','raised' ),
			array( 'advisor','advisor','defense','equity','bond','dismiss','dismiss','raise','raise' ),
			$title
		);
		$title = preg_replace( '/[^a-z0-9.$%]+/', ' ', $title );
		$parts = preg_split( '/\s+/', trim( $title ) );
		$stop = array(
			'the','and','for','with','from','into','after','amid','says','said','new','news','stock','stocks','shares',
			'market','markets','company','latest','live','update','updates','today','trading','investors','investor',
			'report','reports','around','over','under','more','less','than','this','that','its','their','his','her','our',
			'your','could','would','will','surges','surge','jumps','jump','rises','rise','falls','fall','boosts','boost',
			'growth','demand','mentioned','calls','vows','breaking',
		);
		$tokens = array();
		foreach ( (array) $parts as $token ) {
			if ( strlen( $token ) < 3 || in_array( $token, $stop, true ) ) { continue; }
			if ( strlen( $token ) > 5 && 'ies' === substr( $token, -3 ) ) {
				$token = substr( $token, 0, -3 ) . 'y';
			} elseif ( strlen( $token ) > 5 && 's' === substr( $token, -1 ) && 'ss' !== substr( $token, -2 ) ) {
				$token = substr( $token, 0, -1 );
			}
			$tokens[] = $token;
		}
		$tokens = array_values( array_unique( $tokens ) );
		sort( $tokens );
		return $tokens;
	}

	public static function extract_tickers( $text ) {
		$text = html_entity_decode( wp_strip_all_tags( (string) $text ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		preg_match_all( '/\$([A-Z][A-Z0-9.\-]{0,5})(?![A-Z0-9])/i', $text, $cash );
		preg_match_all( '/\(([A-Z]{1,5})\)/', $text, $paren );
		preg_match_all( '/\b([A-Z]{2,5})\b/', $text, $bare );
		$blocked = array( 'CEO','CFO','COO','SEC','FDA','FTC','DOJ','FED','FOMC','USA','US','USD','EPS','IPO','ETF','ET','AM','PM','AI','GDP','CPI','PPI','NYSE','NASDAQ' );
		$tickers = array_map( 'strtoupper', array_merge( $cash[1] ?? array(), $paren[1] ?? array(), $bare[1] ?? array() ) );
		$tickers = array_values( array_diff( array_unique( $tickers ), $blocked ) );
		sort( $tickers );
		return $tickers;
	}

	private static function canonical_source_url( $url ) {
		$url = html_entity_decode( trim( (string) $url ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$url = rtrim( $url, "\\\"'.,;:!?)]}" );
		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || empty( $parts['host'] ) || empty( $parts['path'] ) ) { return ''; }
		$scheme = strtolower( (string) ( $parts['scheme'] ?? 'https' ) );
		if ( ! in_array( $scheme, array( 'http', 'https' ), true ) ) { return ''; }
		$host = strtolower( preg_replace( '/^www\\./', '', (string) $parts['host'] ) );
		$path = '/' . ltrim( preg_replace( '#/+#', '/', rawurldecode( (string) $parts['path'] ) ), '/' );
		$path = '/' === $path ? $path : rtrim( $path, '/' );
		$query = array();
		if ( ! empty( $parts['query'] ) ) {
			parse_str( (string) $parts['query'], $query );
			foreach ( array_keys( $query ) as $key ) {
				if ( preg_match( '/^(utm_|fbclid$|gclid$|mc_[ce]id$|ref$|source$)/i', (string) $key ) ) { unset( $query[ $key ] ); }
			}
			ksort( $query );
		}
		return 'https://' . $host . $path . ( $query ? '?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 ) : '' );
	}

	public static function extract_source_urls( $content ) {
		$content = html_entity_decode( (string) $content, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		preg_match_all( '#https?://[^\\s<>\\"\']+#i', $content, $matches );
		$urls = array();
		$site_host = strtolower( (string) wp_parse_url( home_url( '/' ), PHP_URL_HOST ) );
		$site_host = preg_replace( '/^www\\./', '', $site_host );
		foreach ( (array) ( $matches[0] ?? array() ) as $url ) {
			$canonical = self::canonical_source_url( $url );
			$host = strtolower( (string) wp_parse_url( $canonical, PHP_URL_HOST ) );
			$host = preg_replace( '/^www\\./', '', $host );
			if ( '' !== $canonical && '' !== $host && $host !== $site_host ) { $urls[] = $canonical; }
		}
		$urls = array_values( array_unique( $urls ) );
		sort( $urls );
		return $urls;
	}

	public static function identity( $title, $content = '', $timestamp = null ) {
		$timestamp = $timestamp ?: time();
		$timezone = new DateTimeZone( 'America/New_York' );
		$day = ( new DateTimeImmutable( '@' . (int) $timestamp ) )->setTimezone( $timezone )->format( 'Y-m-d' );
		$tickers = self::extract_tickers( (string) $title . ' ' . (string) $content );
		$tokens = self::normalize_tokens( $title );
		$topic = implode( ' ', $tokens );
		$ticker_key = implode( ',', $tickers );
		$source_urls = self::extract_source_urls( $content );
		$key_material = $source_urls ? 'source|' . $source_urls[0] : 'topic|' . $ticker_key . '|' . $topic;
		return array(
			'day' => $day,
			'tickers' => $tickers,
			'tokens' => $tokens,
			'ticker_key' => $ticker_key,
			'topic_key' => substr( $topic, 0, 255 ),
			'source_urls' => $source_urls,
			'daily_key' => hash( 'sha256', $day . '|' . $key_material ),
		);
	}

	public static function similarity( $a, $b ) {
		$a = array_values( array_unique( (array) $a ) );
		$b = array_values( array_unique( (array) $b ) );
		$shared = count( array_intersect( $a, $b ) );
		$small = min( count( $a ), count( $b ) );
		$union = count( array_unique( array_merge( $a, $b ) ) );
		return array(
			'shared' => $shared,
			'containment' => $shared / max( 1, $small ),
			'jaccard' => $shared / max( 1, $union ),
		);
	}

	public static function same_story( $incoming, $existing ) {
		if ( array_intersect( (array) ( $incoming['source_urls'] ?? array() ), (array) ( $existing['source_urls'] ?? array() ) ) ) { return true; }
		$score = self::similarity( $incoming['tokens'], $existing['tokens'] );
		$overlap = array_intersect( $incoming['tickers'], $existing['tickers'] );
		if ( $incoming['topic_key'] === $existing['topic_key'] && ( $overlap || ( ! $incoming['tickers'] && ! $existing['tickers'] ) ) ) {
			return true;
		}
		if ( $overlap ) {
			return $score['shared'] >= 3 && $score['containment'] >= 0.55 && $score['jaccard'] >= 0.28;
		}
		if ( ! $incoming['tickers'] && ! $existing['tickers'] ) {
			return $score['shared'] >= 4 && $score['containment'] >= 0.70 && $score['jaccard'] >= 0.45;
		}
		return false;
	}

	private static function request_value( $value ) {
		if ( is_array( $value ) ) {
			return (string) ( $value['raw'] ?? $value['rendered'] ?? '' );
		}
		return (string) $value;
	}

	private static function is_sml_make_article( $request ) {
		$current_user_id = (int) get_current_user_id();
		if ( ! in_array( $current_user_id, array( self::MAKE_INGEST_USER_ID, self::SML_NEWS_AUTHOR_ID ), true ) ) { return false; }
		$categories = array_map( 'absint', (array) $request->get_param( 'categories' ) );
		if ( ! in_array( self::MARKET_CATEGORY_ID, $categories, true ) ) { return false; }
		$content = self::request_value( $request->get_param( 'content' ) );
		return false !== stripos( $content, 'smln-article' ) || false !== stripos( $content, 'Stock Market Loop News' );
	}

	private static function normalize_sml_make_status( $request ) {
		if ( 'POST' !== strtoupper( $request->get_method() ) || '/wp/v2/posts' !== rtrim( $request->get_route(), '/' ) ) { return; }
		if ( $request->get_param( 'id' ) || ! self::is_sml_make_article( $request ) ) { return; }
		$status = sanitize_key( $request->get_param( 'status' ) ?: 'draft' );
		if ( in_array( $status, array( 'draft', 'pending' ), true ) ) { $request->set_param( 'status', 'publish' ); }
		$request->set_param( 'author', self::SML_NEWS_AUTHOR_ID );
	}

	public static function protect_rest_insert( $prepared_post, $request ) {
		if ( is_wp_error( $prepared_post ) || ! $prepared_post instanceof stdClass ) { return $prepared_post; }
		if ( $request->get_param( 'id' ) || ! self::is_sml_make_article( $request ) ) { return $prepared_post; }
		$categories = array_map( 'absint', (array) $request->get_param( 'categories' ) );
		$content = (string) ( $prepared_post->post_content ?? self::request_value( $request->get_param( 'content' ) ) );
		if ( ! in_array( self::MARKET_CATEGORY_ID, $categories, true ) ) { return $prepared_post; }
		if ( false === stripos( $content, 'smln-article' ) && false === stripos( $content, 'Stock Market Loop News' ) ) { return $prepared_post; }

		$prepared_post->post_author = self::SML_NEWS_AUTHOR_ID;
		$prepared_post->post_status = 'publish';
		$request->set_param( 'author', self::SML_NEWS_AUTHOR_ID );
		$request->set_param( 'status', 'publish' );
		if ( $request->get_param( '_sml_news_daily_key' ) ) { return $prepared_post; }

		$title = (string) ( $prepared_post->post_title ?? self::request_value( $request->get_param( 'title' ) ) );
		$identity = self::identity( $title, $content, time() );
		$existing_id = self::find_existing( $identity );
		if ( $existing_id ) {
			return new WP_Error(
				'sml_news_duplicate',
				'This source article already exists.',
				array( 'status' => 409, 'existing_post_id' => $existing_id, 'sml_duplicate' => true )
			);
		}

		$reservation = self::reserve( $identity );
		if ( ! empty( $reservation['post_id'] ) ) {
			return new WP_Error( 'sml_news_duplicate', 'This source article already exists.', array( 'status' => 409, 'existing_post_id' => (int) $reservation['post_id'], 'sml_duplicate' => true ) );
		}
		if ( empty( $reservation['reserved'] ) ) {
			return new WP_Error( 'sml_news_ingestion_in_progress', 'This source article is already being created.', array( 'status' => 409, 'retry_after' => 10 ) );
		}

		$request->set_param( '_sml_news_daily_key', $identity['daily_key'] );
		self::$request_keys[ spl_object_id( $request ) ] = $identity;
		return $prepared_post;
	}

	private static function is_guarded_request( $request ) {
		if ( 'POST' !== strtoupper( $request->get_method() ) || '/wp/v2/posts' !== rtrim( $request->get_route(), '/' ) ) { return false; }
		if ( $request->get_param( 'id' ) ) { return false; }
		$status = sanitize_key( $request->get_param( 'status' ) ?: 'draft' );
		if ( ! in_array( $status, array( 'publish','future' ), true ) ) { return false; }
		$categories = array_map( 'absint', (array) $request->get_param( 'categories' ) );
		$guard = in_array( self::MARKET_CATEGORY_ID, $categories, true );
		return (bool) apply_filters( 'sml_news_daily_guard_should_guard', $guard, $request );
	}

	private static function day_bounds_utc( $day ) {
		$timezone = new DateTimeZone( 'America/New_York' );
		$utc = new DateTimeZone( 'UTC' );
		$start = new DateTimeImmutable( $day . ' 00:00:00', $timezone );
		$end = $start->modify( '+1 day' );
		return array( $start->setTimezone( $utc )->format( 'Y-m-d H:i:s' ), $end->setTimezone( $utc )->format( 'Y-m-d H:i:s' ) );
	}

	private static function find_existing( $identity, $exclude_id = 0 ) {
		$ids = get_posts( array(
			'post_type' => 'post', 'post_status' => array( 'publish','future','pending','draft' ),
			'posts_per_page' => 300, 'fields' => 'ids', 'orderby' => 'date', 'order' => 'DESC', 'no_found_rows' => true,
			'post__not_in' => $exclude_id ? array( $exclude_id ) : array(),
			'category__in' => array( self::MARKET_CATEGORY_ID ),
		) );
		foreach ( $ids as $post_id ) {
			$post = get_post( $post_id );
			if ( ! $post ) { continue; }
			$post_timestamp = get_post_timestamp( $post );
			$existing = self::identity( $post->post_title, $post->post_content, $post_timestamp ?: time() );
			if ( $existing['day'] !== $identity['day'] ) { continue; }
			if ( self::same_story( $identity, $existing ) ) { return (int) $post_id; }
		}
		return 0;
	}

	private static function duplicate_response( $post_id ) {
		$post = get_post( $post_id );
		if ( ! $post ) { return new WP_Error( 'sml_news_duplicate_missing', 'The matching article could not be loaded.', array( 'status' => 409 ) ); }
		$response = new WP_REST_Response( array(
			'id' => (int) $post_id,
			'date' => mysql_to_rfc3339( $post->post_date ),
			'date_gmt' => mysql_to_rfc3339( $post->post_date_gmt ),
			'slug' => $post->post_name,
			'status' => $post->post_status,
			'link' => get_permalink( $post_id ),
			'title' => array( 'rendered' => get_the_title( $post_id ) ),
			'sml_duplicate' => true,
			'sml_existing_post_id' => (int) $post_id,
			'sml_rule' => self::SOURCE,
		), 200 );
		$response->header( 'X-SML-Duplicate', '1' );
		return $response;
	}

	private static function reserve( $identity ) {
		global $wpdb;
		$table = self::table();
		$now = current_time( 'mysql', true );
		$inserted = $wpdb->query( $wpdb->prepare(
			"INSERT IGNORE INTO {$table} (daily_key,trading_day,ticker_key,topic_key,post_id,state,reserved_at,updated_at) VALUES (%s,%s,%s,%s,0,'reserved',%s,%s)",
			$identity['daily_key'], $identity['day'], $identity['ticker_key'], $identity['topic_key'], $now, $now
		) );
		if ( 1 === (int) $inserted ) { return array( 'reserved' => true, 'post_id' => 0 ); }
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT post_id,state,reserved_at FROM {$table} WHERE daily_key=%s LIMIT 1", $identity['daily_key'] ), ARRAY_A );
		if ( ! empty( $row['post_id'] ) ) { return array( 'reserved' => false, 'post_id' => (int) $row['post_id'] ); }
		if ( $row && strtotime( $row['reserved_at'] . ' UTC' ) < time() - 10 * MINUTE_IN_SECONDS ) {
			$wpdb->delete( $table, array( 'daily_key' => $identity['daily_key'], 'post_id' => 0 ) );
			return self::reserve( $identity );
		}
		return array( 'reserved' => false, 'post_id' => 0 );
	}

	public static function intercept_rest_create( $result, $server, $request ) {
		if ( null !== $result ) { return $result; }
		self::normalize_sml_make_status( $request );
		if ( ! self::is_guarded_request( $request ) ) { return $result; }
		$title = self::request_value( $request->get_param( 'title' ) );
		$content = self::request_value( $request->get_param( 'content' ) );
		if ( '' === trim( $title ) ) { return $result; }
		$date = $request->get_param( 'date_gmt' ) ?: $request->get_param( 'date' );
		$timestamp = $date ? strtotime( $date . ( false === strpos( $date, 'Z' ) ? ' UTC' : '' ) ) : time();
		$identity = self::identity( $title, $content, $timestamp ?: time() );
		$existing_id = self::find_existing( $identity );
		if ( $existing_id ) { return self::duplicate_response( $existing_id ); }
		$reservation = self::reserve( $identity );
		if ( ! empty( $reservation['post_id'] ) ) { return self::duplicate_response( $reservation['post_id'] ); }
		if ( empty( $reservation['reserved'] ) ) {
			return new WP_Error( 'sml_news_ingestion_in_progress', 'This news event is already being created. Retry with the same payload.', array( 'status' => 409, 'retry_after' => 10 ) );
		}
		$request->set_param( '_sml_news_daily_key', $identity['daily_key'] );
		self::$request_keys[ spl_object_id( $request ) ] = $identity;
		return $result;
	}

	public static function attach_created_post( $post, $request, $creating ) {
		if ( ! $creating || ! $post instanceof WP_Post ) { return; }
		$key = (string) $request->get_param( '_sml_news_daily_key' );
		$identity = self::$request_keys[ spl_object_id( $request ) ] ?? null;
		if ( '' === $key || ! is_array( $identity ) ) { return; }
		global $wpdb;
		$table = self::table();
		$wpdb->update( $table, array( 'post_id' => $post->ID, 'state' => 'created', 'updated_at' => current_time( 'mysql', true ) ), array( 'daily_key' => $key ) );
		update_post_meta( $post->ID, self::META_KEY, $key );
		update_post_meta( $post->ID, '_sml_news_tickers', $identity['tickers'] );
		update_post_meta( $post->ID, '_sml_news_topic_tokens', $identity['tokens'] );
	}

	public static function protect_non_rest_insert( $post_id, $post, $update, $post_before ) {
		if ( self::$fallback_lock || ! $post instanceof WP_Post || 'post' !== $post->post_type || 'publish' !== $post->post_status ) { return; }
		if ( ! has_category( self::MARKET_CATEGORY_ID, $post ) || get_post_meta( $post_id, self::META_KEY, true ) ) { return; }
		$identity = self::identity( $post->post_title, $post->post_content, strtotime( $post->post_date_gmt . ' UTC' ) );
		$existing_id = self::find_existing( $identity, $post_id );
		if ( $existing_id ) {
			self::$fallback_lock = true;
			wp_update_post( array( 'ID' => $post_id, 'post_status' => 'draft' ) );
			update_post_meta( $post_id, self::DUPLICATE_META, $existing_id );
			self::$fallback_lock = false;
			return;
		}
		$reservation = self::reserve( $identity );
		if ( ! empty( $reservation['post_id'] ) && (int) $reservation['post_id'] !== (int) $post_id ) {
			self::$fallback_lock = true;
			wp_update_post( array( 'ID' => $post_id, 'post_status' => 'draft' ) );
			update_post_meta( $post_id, self::DUPLICATE_META, (int) $reservation['post_id'] );
			self::$fallback_lock = false;
			return;
		}
		global $wpdb;
		$wpdb->update( self::table(), array( 'post_id' => $post_id, 'state' => 'created', 'updated_at' => current_time( 'mysql', true ) ), array( 'daily_key' => $identity['daily_key'] ) );
		update_post_meta( $post_id, self::META_KEY, $identity['daily_key'] );
	}
}

SML_News_Daily_Guard_V120::boot();
register_activation_hook( __FILE__, array( 'SML_News_Daily_Guard_V120', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'SML_News_Daily_Guard_V120', 'deactivate' ) );

