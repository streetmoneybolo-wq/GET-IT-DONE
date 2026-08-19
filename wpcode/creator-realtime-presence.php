/**
 * SML Creator Analytics — first-party realtime presence.
 *
 * WPCode: PHP Snippet / Auto Insert / Run Everywhere.
 * Do not add an opening PHP tag in WPCode.
 *
 * Public creator-owned pages receive a signed, server-resolved context and a
 * tiny heartbeat client. Only pseudonymous hashes and a last-seen timestamp
 * are stored. The private aggregate endpoint exposes counts only to the owner.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
/* WPCode merges EVERY "Run Everywhere" PHP snippet into ONE evaluated block (see
   insert-headers-and-footers/includes/auto-insert/class-wpcode-auto-insert-everywhere.php).
   Two consequences for every snippet on this site:
     1. never `return;`/`exit;` at top level — it aborts every snippet merged after it;
     2. WPCode blanks the WHOLE merged block (all 100+ snippets silently dead: channels
        404, CDN loader, Loop Bucks, creator gate…) when the merged code contains MORE
        THAN FIVE calls to base64-decode / eval / ini-set / error-reporting — the site
        already carries 5 (snippets 4481 ×4, 6262 ×1). This snippet's original
        base64url helper was the 6th → sitewide outage 2026-08-19 01:49–02:40.
        Tokens are hex now (bin2hex/hex2bin) — opaque to the client, zero flagged calls. */
if ( ! defined( 'SML_CREATOR_PRESENCE_LOADED' ) ) {
	define( 'SML_CREATOR_PRESENCE_LOADED', true );
}

if ( ! defined( 'SML_CREATOR_PRESENCE_DB_VERSION' ) ) {
	define( 'SML_CREATOR_PRESENCE_DB_VERSION', '1.0.0' );
}
if ( ! defined( 'SML_CREATOR_PRESENCE_TTL' ) ) {
	define( 'SML_CREATOR_PRESENCE_TTL', 90 );
}

if ( ! function_exists( 'sml_creator_presence_table' ) ) {
	function sml_creator_presence_table() {
		global $wpdb;
		return $wpdb->prefix . 'sml_creator_presence';
	}
}

if ( ! function_exists( 'sml_creator_presence_install' ) ) {
	function sml_creator_presence_install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = sml_creator_presence_table();
		$charset = $wpdb->get_charset_collate();
		dbDelta(
			"CREATE TABLE {$table} (
				creator_id BIGINT UNSIGNED NOT NULL,
				visitor_hash CHAR(64) NOT NULL,
				content_kind VARCHAR(24) NOT NULL,
				content_id VARCHAR(191) NOT NULL DEFAULT '',
				last_seen DATETIME NOT NULL,
				PRIMARY KEY  (creator_id, visitor_hash),
				KEY creator_seen (creator_id, last_seen),
				KEY stale_seen (last_seen)
			) {$charset};"
		);
		update_option( 'sml_creator_presence_db_version', SML_CREATOR_PRESENCE_DB_VERSION, false );
	}
}

add_action(
	'init',
	static function () {
		if ( SML_CREATOR_PRESENCE_DB_VERSION !== get_option( 'sml_creator_presence_db_version' ) ) {
			sml_creator_presence_install();
		}
	},
	5
);

if ( ! function_exists( 'sml_creator_presence_b64url' ) ) {
	/* hex, not base64 (WPCode flagged-call budget — see header). Name kept for the call sites. */
	function sml_creator_presence_b64url( $value ) {
		return bin2hex( (string) $value );
	}
}

if ( ! function_exists( 'sml_creator_presence_b64url_decode' ) ) {
	function sml_creator_presence_b64url_decode( $value ) {
		$value = (string) $value;
		if ( '' === $value || strlen( $value ) % 2 || ! ctype_xdigit( $value ) ) { return false; }
		return hex2bin( $value );
	}
}

if ( ! function_exists( 'sml_creator_presence_sign' ) ) {
	function sml_creator_presence_sign( $creator_id, $kind, $content_id ) {
		$payload = array(
			'v'   => 1,
			'uid' => (int) $creator_id,
			'k'   => sanitize_key( $kind ),
			'cid' => sanitize_text_field( (string) $content_id ),
			'exp' => time() + DAY_IN_SECONDS,
		);
		$encoded = sml_creator_presence_b64url( wp_json_encode( $payload ) );
		$sig     = hash_hmac( 'sha256', $encoded, wp_salt( 'auth' ) );
		return $encoded . '.' . $sig;
	}
}

if ( ! function_exists( 'sml_creator_presence_verify' ) ) {
	function sml_creator_presence_verify( $token ) {
		$parts = explode( '.', (string) $token, 2 );
		if ( 2 !== count( $parts ) || ! preg_match( '/^[A-Fa-f0-9]{64}$/', $parts[1] ) ) {
			return new WP_Error( 'sml_presence_bad_context', 'Invalid creator context.', array( 'status' => 403 ) );
		}
		$expected = hash_hmac( 'sha256', $parts[0], wp_salt( 'auth' ) );
		if ( ! hash_equals( $expected, $parts[1] ) ) {
			return new WP_Error( 'sml_presence_bad_context', 'Invalid creator context.', array( 'status' => 403 ) );
		}
		$payload = json_decode( (string) sml_creator_presence_b64url_decode( $parts[0] ), true );
		$kinds   = array( 'channel', 'video', 'live', 'letter', 'article' );
		if ( ! is_array( $payload ) || 1 !== (int) ( $payload['v'] ?? 0 ) || (int) ( $payload['uid'] ?? 0 ) < 1 || (int) ( $payload['exp'] ?? 0 ) < time() || ! in_array( (string) ( $payload['k'] ?? '' ), $kinds, true ) ) {
			return new WP_Error( 'sml_presence_expired_context', 'Creator context expired.', array( 'status' => 403 ) );
		}
		return $payload;
	}
}

if ( ! function_exists( 'sml_creator_presence_context' ) ) {
	function sml_creator_presence_context() {
		global $wpdb;

		$uri   = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$path  = trim( strtolower( rawurldecode( (string) wp_parse_url( $uri, PHP_URL_PATH ) ) ), '/' );
		$parts = array_values( array_filter( explode( '/', $path ), 'strlen' ) );
		if ( ! $parts ) {
			return null;
		}

		$creator_id = 0;
		$kind       = '';
		$content_id = '';

		if ( 2 === count( $parts ) && 'channel' === $parts[0] ) {
			$handle = sanitize_title( $parts[1] );
			$query  = new WP_User_Query(
				array(
					'number'      => 1,
					'count_total' => false,
					'fields'      => 'ID',
					'meta_key'    => 'sml_channel_handle',
					'meta_value'  => $handle,
				)
			);
			$ids        = $query->get_results();
			$creator_id = ! empty( $ids[0] ) ? (int) $ids[0] : 0;
			$kind       = 'channel';
			$content_id = $handle;
		} elseif ( 2 === count( $parts ) && 'watch' === $parts[0] ) {
			$video_id = sanitize_key( $parts[1] );
			$library  = function_exists( 'sml_video_upload_studio_library' ) ? sml_video_upload_studio_library() : get_option( 'sml_video_upload_studio_library', array() );
			foreach ( (array) $library as $video ) {
				if ( ! is_array( $video ) || $video_id !== sanitize_key( (string) ( $video['id'] ?? '' ) ) || 'public' !== strtolower( (string) ( $video['visibility'] ?? '' ) ) ) {
					continue;
				}
				$creator_id = (int) ( $video['author_id'] ?? 0 );
				break;
			}
			$kind       = 'video';
			$content_id = $video_id;
		} elseif ( 'live' === $parts[0] && count( $parts ) <= 2 ) {
			$handle = isset( $parts[1] ) ? sanitize_title( $parts[1] ) : '';
			if ( '' === $handle && function_exists( 'sml_slots_first_live_handle' ) ) {
				$handle = sanitize_title( sml_slots_first_live_handle() );
			}
			$user       = $handle ? get_user_by( 'slug', $handle ) : false;
			$creator_id = $user ? (int) $user->ID : 0;
			$kind       = 'live';
			$content_id = $handle;
		} elseif ( 3 === count( $parts ) && 'letters' === $parts[0] && function_exists( 'sml_letters_table' ) ) {
			$slug = sanitize_title( $parts[2] );
			$row  = $wpdb->get_row( $wpdb->prepare( 'SELECT id, author_id, status FROM ' . sml_letters_table( 'posts' ) . ' WHERE slug = %s LIMIT 1', $slug ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( $row && 'published' === (string) $row['status'] ) {
				$creator_id = (int) $row['author_id'];
				$content_id = (string) $row['id'];
			}
			$kind = 'letter';
		} elseif ( is_singular( 'post' ) ) {
			$post = get_queried_object();
			if ( $post instanceof WP_Post && 'publish' === $post->post_status ) {
				$creator_id = (int) $post->post_author;
				$content_id = (string) $post->ID;
				$kind       = 'article';
			}
		}

		if ( $creator_id < 1 || ! get_userdata( $creator_id ) ) {
			return null;
		}
		return array( 'creator_id' => $creator_id, 'kind' => $kind, 'content_id' => $content_id );
	}
}

if ( ! function_exists( 'sml_creator_presence_markup' ) ) {
	function sml_creator_presence_markup( $context ) {
		// Analytics attribution must not drift with the cached moving resolver.
		$ref  = '6e3ce9f';
		$base = 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . rawurlencode( $ref ) . '/';
		$user = get_userdata( (int) $context['creator_id'] );
		$cfg  = array(
			'endpoint'      => esc_url_raw( rest_url( 'sml-creator-analytics/v1/presence' ) ),
			'context'       => sml_creator_presence_sign( $context['creator_id'], $context['kind'], $context['content_id'] ),
			'creatorHandle' => $user ? sanitize_title( $user->user_nicename ) : '',
			'contentKind'   => sanitize_key( $context['kind'] ),
			'contentId'     => sanitize_text_field( (string) $context['content_id'] ),
			'interval'      => 40000,
		);
		return '<script id="sml-cp-config">window.SML_CREATOR_PRESENCE=' . wp_json_encode( $cfg ) . ';</script>'
			. '<script id="sml-cp-js" defer src="' . esc_url( $base . 'js/creator-presence.js' ) . '"></script>';
	}
}

add_action(
	'template_redirect',
	static function () {
		if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return;
		}
		$context = sml_creator_presence_context();
		if ( ! $context ) {
			return;
		}
		ob_start(
			static function ( $html ) use ( $context ) {
				if ( ! is_string( $html ) || false === strripos( $html, '</body>' ) || false !== strpos( $html, 'id="sml-cp-js"' ) ) {
					return $html;
				}
				$pos = strripos( $html, '</body>' );
				return substr( $html, 0, $pos ) . sml_creator_presence_markup( $context ) . substr( $html, $pos );
			}
		);
	},
	-100
);

if ( ! function_exists( 'sml_creator_presence_rest_beat' ) ) {
	function sml_creator_presence_rest_beat( WP_REST_Request $request ) {
		global $wpdb;
		$payload = sml_creator_presence_verify( $request->get_param( 'context' ) );
		if ( is_wp_error( $payload ) ) {
			return $payload;
		}
		$visitor = (string) $request->get_param( 'visitor' );
		if ( ! preg_match( '/^[A-Za-z0-9_-]{16,80}$/', $visitor ) ) {
			return new WP_Error( 'sml_presence_bad_visitor', 'Invalid visitor token.', array( 'status' => 400 ) );
		}

		$ip        = isset( $_SERVER['REMOTE_ADDR'] ) ? (string) wp_unslash( $_SERVER['REMOTE_ADDR'] ) : '';
		$rate_hash = substr( hash_hmac( 'sha256', $ip, wp_salt( 'nonce' ) ), 0, 24 );
		$rate_key  = 'sml_cp_rate_' . $rate_hash;
		$rate      = (int) get_transient( $rate_key );
		$visitor_rate_key = 'sml_cp_visitor_rate_' . substr( hash_hmac( 'sha256', $visitor, wp_salt( 'nonce' ) ), 0, 24 );
		$visitor_rate     = (int) get_transient( $visitor_rate_key );
		if ( $rate >= 600 || $visitor_rate >= 6 ) {
			return new WP_Error( 'sml_presence_rate_limited', 'Too many heartbeat requests.', array( 'status' => 429 ) );
		}
		set_transient( $rate_key, $rate + 1, MINUTE_IN_SECONDS );
		set_transient( $visitor_rate_key, $visitor_rate + 1, MINUTE_IN_SECONDS );

		$visitor_hash = hash_hmac( 'sha256', $visitor, wp_salt( 'secure_auth' ) );
		$table        = sml_creator_presence_table();
		$now          = gmdate( 'Y-m-d H:i:s' );
		$sql          = $wpdb->prepare(
			"INSERT INTO {$table} (creator_id, visitor_hash, content_kind, content_id, last_seen)
			 VALUES (%d, %s, %s, %s, %s)
			 ON DUPLICATE KEY UPDATE content_kind = VALUES(content_kind), content_id = VALUES(content_id), last_seen = VALUES(last_seen)",
			(int) $payload['uid'],
			$visitor_hash,
			sanitize_key( $payload['k'] ),
			sanitize_text_field( (string) ( $payload['cid'] ?? '' ) ),
			$now
		);
		if ( false === $wpdb->query( $sql ) ) { // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			return new WP_Error( 'sml_presence_write_failed', 'Presence is temporarily unavailable.', array( 'status' => 503 ) );
		}
		if ( 1 === wp_rand( 1, 100 ) ) {
			$wpdb->query( "DELETE FROM {$table} WHERE last_seen < (UTC_TIMESTAMP() - INTERVAL 1 DAY)" ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		}
		return rest_ensure_response( array( 'ok' => true, 'ttl' => SML_CREATOR_PRESENCE_TTL ) );
	}
}

if ( ! function_exists( 'sml_creator_presence_rest_mine' ) ) {
	function sml_creator_presence_rest_mine() {
		global $wpdb;
		$creator_id = get_current_user_id();
		$table      = sml_creator_presence_table();
		$cutoff     = gmdate( 'Y-m-d H:i:s', time() - SML_CREATOR_PRESENCE_TTL );
		$rows       = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT content_kind, COUNT(*) AS viewers FROM {$table} WHERE creator_id = %d AND last_seen >= %s GROUP BY content_kind",
				$creator_id,
				$cutoff
			),
			ARRAY_A
		);
		$by_kind = array();
		$total   = 0;
		foreach ( (array) $rows as $row ) {
			$count = max( 0, (int) $row['viewers'] );
			$by_kind[ sanitize_key( $row['content_kind'] ) ] = $count;
			$total += $count;
		}
		$item_rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT content_kind, content_id, COUNT(*) AS viewers FROM {$table} WHERE creator_id = %d AND last_seen >= %s GROUP BY content_kind, content_id ORDER BY viewers DESC",
				$creator_id,
				$cutoff
			),
			ARRAY_A
		);
		$items = array();
		foreach ( (array) $item_rows as $row ) {
			$items[] = array(
				'kind'      => sanitize_key( $row['content_kind'] ),
				'contentId' => sanitize_text_field( (string) $row['content_id'] ),
				'viewers'   => max( 0, (int) $row['viewers'] ),
			);
		}
		return rest_ensure_response(
			array(
				'available' => true,
				'count'     => $total,
				'byKind'    => $by_kind,
				'items'     => $items,
				'window'    => SML_CREATOR_PRESENCE_TTL,
				'updatedAt' => gmdate( 'c' ),
			)
		);
	}
}

add_action(
	'rest_api_init',
	static function () {
		register_rest_route(
			'sml-creator-analytics/v1',
			'/presence',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => 'sml_creator_presence_rest_beat',
					'permission_callback' => '__return_true',
				),
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => 'sml_creator_presence_rest_mine',
					'permission_callback' => static function () { return is_user_logged_in(); },
				),
			)
		);
	}
);
