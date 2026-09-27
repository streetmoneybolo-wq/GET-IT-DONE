<?php
/**
 * Follow my socials → get a role. Verifiable platforms only.
 *
 *   loop     native StockMarketLoop follow (checked in the site's own follow table, auto-detected)
 *   bluesky  public AT Protocol API, no key needed; ownership proven by a one-time code in the member's bio
 *   youtube  Google OAuth (youtube.readonly) → subscriptions.list?mine=true&forChannelId=  (needs Google app)
 *   reddit   Reddit OAuth (mysubreddits)      → /subreddits/mine/subscriber                (needs Reddit app)
 *   x        not offered: follow lookups need a paid API tier
 *
 * Facebook pages, Threads and LinkedIn cannot be verified by any API and are not offered.
 *
 * Grants are recorded in sml_hub_social_grants and ONLY what was recorded is
 * ever removed. A daily cron re-checks every grant; unfollow → the grant is
 * revoked and the engine role restored to what it was before (or the
 * membership removed when the grant created it), unless a human changed the
 * role in between (then the membership is left alone and the grant is dropped).
 *
 * Enabled per group slug: option sml_hub_socials_slugs (default: making-easy-money).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function sml_hub_social_platforms() {
	return array(
		'loop'    => array( 'label' => 'Loop Channel (StockMarketLoop follow)', 'oauth' => false ),
		'bluesky' => array( 'label' => 'Bluesky', 'oauth' => false ),
		'youtube' => array( 'label' => 'YouTube', 'oauth' => true ),
		'reddit'  => array( 'label' => 'Reddit', 'oauth' => true ),
	);
}

function sml_hub_socials_enabled_for( $group ) {
	if ( ! $group ) {
		return false;
	}
	if ( get_option( 'sml_hub_socials_all' ) ) {
		return true;
	}
	$slugs = get_option( 'sml_hub_socials_slugs', array( 'making-easy-money' ) );
	$slugs = is_array( $slugs ) ? $slugs : array( 'making-easy-money' );
	return in_array( (string) ( $group['slug'] ?? '' ), $slugs, true );
}

function sml_hub_social_cfg( $group_id ) {
	$c = get_option( 'sml_hub_socials_cfg_' . absint( $group_id ), array() );
	$c = is_array( $c ) ? $c : array();
	return array(
		'enabled'           => ! empty( $c['enabled'] ),
		'rule'              => ( isset( $c['rule'] ) && 'all' === $c['rule'] ) ? 'all' : 'any',
		'grant_role_id'     => isset( $c['grant_role_id'] ) ? absint( $c['grant_role_id'] ) : 0,
		'grant_engine_role' => isset( $c['grant_engine_role'] ) && isset( sml_hub_base_levels()[ $c['grant_engine_role'] ] ) ? $c['grant_engine_role'] : 'premium',
		'message'           => isset( $c['message'] ) ? (string) $c['message'] : '',
	);
}

/* ---------- platform availability ---------- */

/** Finds the site's native follow table once (transient) so "Loop follow" can be checked. */
function sml_hub_loop_follow_source() {
	$cached = get_transient( 'sml_hub_loop_follow_source' );
	if ( is_array( $cached ) ) {
		return $cached ?: null;
	}
	$found = apply_filters( 'sml_hub_loop_follow_source', null );
	if ( ! is_array( $found ) ) {
		global $wpdb;
		$tables = (array) $wpdb->get_col( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $wpdb->prefix . 'sml_' ) . '%follow%' ) );
		$follower_cols = array( 'follower_id', 'follower_user_id', 'user_id', 'from_user_id' );
		$target_cols   = array( 'following_id', 'followed_id', 'followee_id', 'target_user_id', 'target_id', 'creator_id', 'owner_id', 'channel_owner_id', 'to_user_id', 'following_user_id', 'followed_user_id' );
		foreach ( $tables as $table ) {
			$cols = array_map( 'strtolower', (array) $wpdb->get_col( "SHOW COLUMNS FROM `{$table}`", 0 ) );
			$f    = null;
			$t    = null;
			foreach ( $follower_cols as $c ) {
				if ( in_array( $c, $cols, true ) ) {
					$f = $c;
					break;
				}
			}
			foreach ( $target_cols as $c ) {
				if ( in_array( $c, $cols, true ) && $c !== $f ) {
					$t = $c;
					break;
				}
			}
			if ( $f && $t ) {
				$found = array( 'table' => $table, 'follower' => $f, 'target' => $t );
				break;
			}
		}
	}
	set_transient( 'sml_hub_loop_follow_source', is_array( $found ) ? $found : array(), 6 * HOUR_IN_SECONDS );
	return is_array( $found ) ? $found : null;
}

function sml_hub_platform_status() {
	$loop = sml_hub_loop_follow_source();
	return array(
		'loop'    => $loop ? 'ready' : 'unavailable',
		'bluesky' => 'ready',
		'youtube' => ( get_option( 'sml_hub_google_client_id' ) && get_option( 'sml_hub_google_client_secret' ) ) ? 'ready' : 'needs_setup',
		'reddit'  => ( get_option( 'sml_hub_reddit_client_id' ) && get_option( 'sml_hub_reddit_client_secret' ) ) ? 'ready' : 'needs_setup',
		'x'       => 'unavailable',
	);
}

/* ---------- small helpers ---------- */

function sml_hub_http_json( $url, $args = array() ) {
	$args = array_merge( array( 'timeout' => 8, 'headers' => array( 'User-Agent' => 'StockMarketLoop-GroupHub/' . SML_HUB_VERSION ) ), $args );
	$res  = wp_remote_request( $url, $args );
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = (int) wp_remote_retrieve_response_code( $res );
	$body = json_decode( (string) wp_remote_retrieve_body( $res ), true );
	if ( $code < 200 || $code >= 300 ) {
		return new WP_Error( 'sml_hub_http_' . $code, is_array( $body ) && isset( $body['message'] ) ? (string) $body['message'] : ( 'HTTP ' . $code ), array( 'status' => 502 ) );
	}
	return is_array( $body ) ? $body : array();
}

function sml_hub_seal( $plain ) {
	$key = hash( 'sha256', ( defined( 'AUTH_KEY' ) ? AUTH_KEY : '' ) . ( defined( 'SECURE_AUTH_KEY' ) ? SECURE_AUTH_KEY : '' ) . 'sml-hub', true );
	$iv  = random_bytes( 16 );
	$enc = openssl_encrypt( (string) $plain, 'aes-256-cbc', $key, OPENSSL_RAW_DATA, $iv );
	return false === $enc ? '' : base64_encode( $iv . $enc );
}

function sml_hub_unseal( $blob ) {
	$raw = base64_decode( (string) $blob, true );
	if ( ! $raw || strlen( $raw ) < 17 ) {
		return '';
	}
	$key = hash( 'sha256', ( defined( 'AUTH_KEY' ) ? AUTH_KEY : '' ) . ( defined( 'SECURE_AUTH_KEY' ) ? SECURE_AUTH_KEY : '' ) . 'sml-hub', true );
	$dec = openssl_decrypt( substr( $raw, 16 ), 'aes-256-cbc', $key, OPENSSL_RAW_DATA, substr( $raw, 0, 16 ) );
	return false === $dec ? '' : $dec;
}

function sml_hub_social_link( $user_id, $platform ) {
	global $wpdb;
	$t = sml_hub_tables();
	return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['social_links']} WHERE user_id=%d AND platform=%s", absint( $user_id ), sanitize_key( $platform ) ), ARRAY_A ) ?: null;
}

function sml_hub_social_save_link( $user_id, $platform, $fields ) {
	global $wpdb;
	$t   = sml_hub_tables();
	$row = sml_hub_social_link( $user_id, $platform );
	$fields['updated_at'] = sml_hub_now();
	if ( $row ) {
		$wpdb->update( $t['social_links'], $fields, array( 'id' => (int) $row['id'] ) );
	} else {
		$fields += array( 'user_id' => absint( $user_id ), 'platform' => sanitize_key( $platform ), 'handle' => '', 'created_at' => sml_hub_now() );
		$wpdb->insert( $t['social_links'], $fields );
	}
	return sml_hub_social_link( $user_id, $platform );
}

function sml_hub_social_targets( $group_id ) {
	global $wpdb;
	$t = sml_hub_tables();
	return (array) $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$t['social_targets']} WHERE group_id=%d ORDER BY id ASC", absint( $group_id ) ), ARRAY_A );
}

/* ---------- Bluesky ---------- */

function sml_hub_bsky_resolve( $handle ) {
	$handle = strtolower( ltrim( trim( (string) $handle ), '@' ) );
	if ( '' === $handle ) {
		return new WP_Error( 'sml_hub_handle', 'Enter a Bluesky handle.', array( 'status' => 400 ) );
	}
	if ( false === strpos( $handle, '.' ) ) {
		$handle .= '.bsky.social';
	}
	$r = sml_hub_http_json( 'https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=' . rawurlencode( $handle ) );
	if ( is_wp_error( $r ) ) {
		return new WP_Error( 'sml_hub_bsky', 'That Bluesky handle could not be found.', array( 'status' => 400 ) );
	}
	return array( 'handle' => $handle, 'did' => (string) ( $r['did'] ?? '' ) );
}

function sml_hub_bsky_bio_contains( $did, $code ) {
	$r = sml_hub_http_json( 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=' . rawurlencode( $did ) );
	if ( is_wp_error( $r ) ) {
		return false;
	}
	return false !== stripos( (string) ( $r['description'] ?? '' ), $code );
}

function sml_hub_bsky_follows( $member_did, $target_did ) {
	$r = sml_hub_http_json( 'https://public.api.bsky.app/xrpc/app.bsky.graph.getRelationships?actor=' . rawurlencode( $target_did ) . '&others=' . rawurlencode( $member_did ) );
	if ( is_wp_error( $r ) ) {
		return null;
	}
	foreach ( (array) ( $r['relationships'] ?? array() ) as $rel ) {
		if ( isset( $rel['did'] ) && $rel['did'] === $member_did ) {
			return ! empty( $rel['followedBy'] );
		}
	}
	return false;
}

/* ---------- Loop (native) ---------- */

function sml_hub_loop_follows( $follower_uid, $target_uid ) {
	$pre = apply_filters( 'sml_hub_loop_follows', null, $follower_uid, $target_uid );
	if ( null !== $pre ) {
		return (bool) $pre;
	}
	$src = sml_hub_loop_follow_source();
	if ( ! $src ) {
		return null;
	}
	global $wpdb;
	return (bool) $wpdb->get_var( $wpdb->prepare( "SELECT 1 FROM `{$src['table']}` WHERE `{$src['follower']}`=%d AND `{$src['target']}`=%d LIMIT 1", absint( $follower_uid ), absint( $target_uid ) ) );
}

function sml_hub_loop_resolve( $handle ) {
	$handle = ltrim( trim( (string) $handle ), '@' );
	$user   = get_user_by( 'slug', sanitize_title( $handle ) ) ?: get_user_by( 'login', $handle );
	if ( ! $user ) {
		return new WP_Error( 'sml_hub_loop_user', 'No StockMarketLoop account has that handle.', array( 'status' => 400 ) );
	}
	return array( 'handle' => $user->user_nicename, 'id' => (string) $user->ID );
}

/* ---------- OAuth (YouTube / Reddit) ---------- */

function sml_hub_oauth_redirect( $platform ) {
	return rest_url( 'sml-hub/v1/oauth/' . sanitize_key( $platform ) . '/callback' );
}

function sml_hub_oauth_state( $uid, $gid, $platform ) {
	$ts   = time();
	$sig  = wp_hash( "$uid|$gid|$platform|$ts", 'nonce' );
	return rtrim( strtr( base64_encode( wp_json_encode( array( 'u' => (int) $uid, 'g' => (int) $gid, 'p' => $platform, 't' => $ts, 's' => $sig ) ) ), '+/', '-_' ), '=' );
}

function sml_hub_oauth_state_read( $state ) {
	$json = base64_decode( strtr( (string) $state, '-_', '+/' ) );
	$d    = json_decode( (string) $json, true );
	if ( ! is_array( $d ) || empty( $d['u'] ) || empty( $d['g'] ) || empty( $d['p'] ) || empty( $d['t'] ) || empty( $d['s'] ) ) {
		return null;
	}
	if ( time() - (int) $d['t'] > 15 * MINUTE_IN_SECONDS ) {
		return null;
	}
	if ( ! hash_equals( wp_hash( "{$d['u']}|{$d['g']}|{$d['p']}|{$d['t']}", 'nonce' ), (string) $d['s'] ) ) {
		return null;
	}
	return $d;
}

function sml_hub_oauth_authorize_url( $platform, $uid, $gid ) {
	$state = sml_hub_oauth_state( $uid, $gid, $platform );
	if ( 'youtube' === $platform ) {
		return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query( array(
			'client_id'     => get_option( 'sml_hub_google_client_id' ),
			'redirect_uri'  => sml_hub_oauth_redirect( 'youtube' ),
			'response_type' => 'code',
			'scope'         => 'https://www.googleapis.com/auth/youtube.readonly',
			'access_type'   => 'offline',
			'prompt'        => 'consent',
			'state'         => $state,
		) );
	}
	if ( 'reddit' === $platform ) {
		return 'https://www.reddit.com/api/v1/authorize?' . http_build_query( array(
			'client_id'     => get_option( 'sml_hub_reddit_client_id' ),
			'response_type' => 'code',
			'state'         => $state,
			'redirect_uri'  => sml_hub_oauth_redirect( 'reddit' ),
			'duration'      => 'permanent',
			'scope'         => 'identity mysubreddits',
		) );
	}
	return '';
}

function sml_hub_oauth_exchange( $platform, $code ) {
	if ( 'youtube' === $platform ) {
		return sml_hub_http_json( 'https://oauth2.googleapis.com/token', array( 'method' => 'POST', 'body' => array(
			'code' => $code, 'client_id' => get_option( 'sml_hub_google_client_id' ), 'client_secret' => get_option( 'sml_hub_google_client_secret' ),
			'redirect_uri' => sml_hub_oauth_redirect( 'youtube' ), 'grant_type' => 'authorization_code',
		) ) );
	}
	if ( 'reddit' === $platform ) {
		return sml_hub_http_json( 'https://www.reddit.com/api/v1/access_token', array( 'method' => 'POST',
			'headers' => array( 'Authorization' => 'Basic ' . base64_encode( get_option( 'sml_hub_reddit_client_id' ) . ':' . get_option( 'sml_hub_reddit_client_secret' ) ), 'User-Agent' => 'StockMarketLoop-GroupHub/' . SML_HUB_VERSION ),
			'body' => array( 'grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => sml_hub_oauth_redirect( 'reddit' ) ),
		) );
	}
	return new WP_Error( 'sml_hub_platform', 'Unknown platform.' );
}

/** Returns a fresh access token for a stored link, refreshing when needed. */
function sml_hub_oauth_access_token( $link ) {
	$tok = json_decode( sml_hub_unseal( $link['token_blob'] ?? '' ), true );
	if ( ! is_array( $tok ) || empty( $tok['refresh_token'] ) ) {
		return '';
	}
	if ( ! empty( $tok['access_token'] ) && ! empty( $tok['expires_at'] ) && (int) $tok['expires_at'] > time() + 60 ) {
		return (string) $tok['access_token'];
	}
	$platform = $link['platform'];
	if ( 'youtube' === $platform ) {
		$r = sml_hub_http_json( 'https://oauth2.googleapis.com/token', array( 'method' => 'POST', 'body' => array(
			'refresh_token' => $tok['refresh_token'], 'client_id' => get_option( 'sml_hub_google_client_id' ), 'client_secret' => get_option( 'sml_hub_google_client_secret' ), 'grant_type' => 'refresh_token',
		) ) );
	} else {
		$r = sml_hub_http_json( 'https://www.reddit.com/api/v1/access_token', array( 'method' => 'POST',
			'headers' => array( 'Authorization' => 'Basic ' . base64_encode( get_option( 'sml_hub_reddit_client_id' ) . ':' . get_option( 'sml_hub_reddit_client_secret' ) ), 'User-Agent' => 'StockMarketLoop-GroupHub/' . SML_HUB_VERSION ),
			'body' => array( 'grant_type' => 'refresh_token', 'refresh_token' => $tok['refresh_token'] ),
		) );
	}
	if ( is_wp_error( $r ) || empty( $r['access_token'] ) ) {
		return '';
	}
	$tok['access_token'] = (string) $r['access_token'];
	$tok['expires_at']   = time() + (int) ( $r['expires_in'] ?? 3600 );
	sml_hub_social_save_link( $link['user_id'], $platform, array( 'token_blob' => sml_hub_seal( wp_json_encode( $tok ) ) ) );
	return $tok['access_token'];
}

function sml_hub_youtube_subscribed( $link, $channel_id ) {
	$token = sml_hub_oauth_access_token( $link );
	if ( ! $token ) {
		return null;
	}
	$r = sml_hub_http_json( 'https://www.googleapis.com/youtube/v3/subscriptions?part=id&mine=true&forChannelId=' . rawurlencode( $channel_id ), array( 'headers' => array( 'Authorization' => 'Bearer ' . $token ) ) );
	if ( is_wp_error( $r ) ) {
		return null;
	}
	return ! empty( $r['items'] );
}

function sml_hub_reddit_subscribed( $link, $name ) {
	$token = sml_hub_oauth_access_token( $link );
	if ( ! $token ) {
		return null;
	}
	$name  = strtolower( $name );
	$after = '';
	for ( $i = 0; $i < 10; $i++ ) {
		$r = sml_hub_http_json( 'https://oauth.reddit.com/subreddits/mine/subscriber?limit=100' . ( $after ? '&after=' . rawurlencode( $after ) : '' ), array( 'headers' => array( 'Authorization' => 'Bearer ' . $token, 'User-Agent' => 'StockMarketLoop-GroupHub/' . SML_HUB_VERSION ) ) );
		if ( is_wp_error( $r ) ) {
			return null;
		}
		foreach ( (array) ( $r['data']['children'] ?? array() ) as $child ) {
			if ( strtolower( (string) ( $child['data']['display_name'] ?? '' ) ) === $name ) {
				return true;
			}
		}
		$after = (string) ( $r['data']['after'] ?? '' );
		if ( '' === $after ) {
			break;
		}
	}
	return false;
}

/* ---------- evaluation + grants ---------- */

/** true = follows, false = does not, null = cannot tell right now (treated as "keep what we have"). */
function sml_hub_target_satisfied( $target, $user_id ) {
	$platform = $target['platform'];
	$link     = sml_hub_social_link( $user_id, $platform );
	if ( 'loop' === $platform ) {
		return sml_hub_loop_follows( $user_id, (int) $target['external_id'] );
	}
	if ( ! $link || empty( $link['verified_at'] ) ) {
		return false;
	}
	if ( 'bluesky' === $platform ) {
		return sml_hub_bsky_follows( (string) $link['external_id'], (string) $target['external_id'] );
	}
	if ( 'youtube' === $platform ) {
		return sml_hub_youtube_subscribed( $link, (string) $target['external_id'] );
	}
	if ( 'reddit' === $platform ) {
		return sml_hub_reddit_subscribed( $link, (string) $target['external_id'] );
	}
	return false;
}

function sml_hub_social_grant( $group_id ) {
	global $wpdb;
	$t = sml_hub_tables();
	return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['social_grants']} WHERE group_id=%d AND user_id=%d", absint( $group_id ), get_current_user_id() ), ARRAY_A ) ?: null;
}

function sml_hub_social_evaluate( $group_id, $user_id ) {
	global $wpdb;
	$t        = sml_hub_tables();
	$group_id = absint( $group_id );
	$user_id  = absint( $user_id );
	$group    = sml_hub_group( $group_id );
	$cfg      = sml_hub_social_cfg( $group_id );
	$targets  = sml_hub_social_targets( $group_id );
	$grant    = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$t['social_grants']} WHERE group_id=%d AND user_id=%d", $group_id, $user_id ), ARRAY_A );
	$enabled  = $group && sml_hub_socials_enabled_for( $group ) && $cfg['enabled'] && $targets;

	$status   = array();
	$unknown  = false;
	$sat      = 0;
	foreach ( $targets as $target ) {
		$s = $enabled ? sml_hub_target_satisfied( $target, $user_id ) : false;
		if ( null === $s ) {
			$unknown = true;
		} elseif ( $s ) {
			$sat++;
		}
		$status[ (int) $target['id'] ] = $s;
	}
	$eligible = $enabled && ( 'all' === $cfg['rule'] ? $sat === count( $targets ) : $sat > 0 );

	if ( $eligible && ! $grant ) {
		$prior   = sml_hub_engine_role( $group_id, $user_id );
		$levels  = sml_hub_base_levels();
		$role    = $cfg['grant_role_id'] ? sml_hub_role( $cfg['grant_role_id'] ) : null;
		$base    = $role ? $role['base_level'] : $cfg['grant_engine_role'];
		$applied = '';
		$created = null === $prior ? 1 : 0;
		if ( sml_hub_is_owner( $group_id, $user_id ) ) {
			return array( 'eligible' => true, 'granted' => false, 'targets' => $status, 'reason' => 'owner' );
		}
		if ( null === $prior || $levels[ $prior ] < $levels[ $base ] ) {
			sml_hub_set_engine_role( $group_id, $user_id, $base, 'social' );
			$applied = $base;
		}
		if ( $role ) {
			$wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$t['member_roles']} (group_id,user_id,role_id,source,granted_by_user_id,created_at) VALUES (%d,%d,%d,'social',0,%s)", $group_id, $user_id, $role['id'], sml_hub_now() ) );
		}
		$wpdb->insert( $t['social_grants'], array(
			'group_id' => $group_id, 'user_id' => $user_id, 'applied_role_id' => $role ? $role['id'] : 0, 'applied_engine_role' => $applied,
			'prior_engine_role' => (string) $prior, 'created_member' => $created, 'satisfied_targets' => wp_json_encode( array_keys( array_filter( $status ) ) ),
			'last_verified_at' => sml_hub_now(), 'created_at' => sml_hub_now(),
		) );
		sml_hub_audit( $group_id, 'social_granted', $user_id, array( 'role_id' => $role ? $role['id'] : 0, 'engine_role' => $applied, 'prior' => $prior ) );
		return array( 'eligible' => true, 'granted' => true, 'targets' => $status );
	}

	if ( ! $eligible && $grant && ! $unknown ) {
		$current = sml_hub_engine_role( $group_id, $user_id );
		$action  = 'revoked';
		if ( (int) $grant['applied_role_id'] ) {
			$wpdb->delete( $t['member_roles'], array( 'group_id' => $group_id, 'user_id' => $user_id, 'role_id' => (int) $grant['applied_role_id'], 'source' => 'social' ), array( '%d', '%d', '%d', '%s' ) );
		}
		if ( '' !== (string) $grant['applied_engine_role'] ) {
			if ( $current === (string) $grant['applied_engine_role'] ) {
				if ( ! empty( $grant['created_member'] ) ) {
					$wpdb->delete( $t['members'], array( 'group_id' => $group_id, 'user_id' => $user_id ), array( '%d', '%d' ) );
				} elseif ( '' !== (string) $grant['prior_engine_role'] ) {
					sml_hub_set_engine_role( $group_id, $user_id, (string) $grant['prior_engine_role'], 'social_revoked' );
				}
			} else {
				$action = 'protected_manual_membership';
			}
		}
		$wpdb->delete( $t['social_grants'], array( 'id' => (int) $grant['id'] ), array( '%d' ) );
		sml_hub_audit( $group_id, 'social_' . $action, $user_id, array( 'grant' => $grant ) );
		return array( 'eligible' => false, 'granted' => false, 'targets' => $status, 'action' => $action );
	}

	if ( $grant ) {
		$wpdb->update( $t['social_grants'], array( 'last_verified_at' => sml_hub_now(), 'satisfied_targets' => wp_json_encode( array_keys( array_filter( $status ) ) ) ), array( 'id' => (int) $grant['id'] ) );
	}
	return array( 'eligible' => $eligible, 'granted' => (bool) $grant, 'targets' => $status, 'unknown' => $unknown );
}

add_action( 'sml_hub_social_recheck', static function () {
	global $wpdb;
	$t    = sml_hub_tables();
	$rows = (array) $wpdb->get_results( "SELECT group_id, user_id FROM {$t['social_grants']} ORDER BY last_verified_at ASC LIMIT 2000", ARRAY_A );
	foreach ( $rows as $r ) {
		sml_hub_social_evaluate( (int) $r['group_id'], (int) $r['user_id'] );
	}
} );

function sml_hub_social_targets_role_deleted( $group_id, $role_id ) {
	$cfg = sml_hub_social_cfg( $group_id );
	if ( $cfg['grant_role_id'] === absint( $role_id ) ) {
		$cfg['grant_role_id'] = 0;
		update_option( 'sml_hub_socials_cfg_' . absint( $group_id ), $cfg, false );
	}
}

/* ---------- state for the UI ---------- */

function sml_hub_social_target_public( $target ) {
	return array(
		'id'       => (int) $target['id'],
		'platform' => (string) $target['platform'],
		'handle'   => (string) $target['handle'],
		'label'    => (string) $target['label'],
		'url'      => (string) $target['url'],
	);
}

function sml_hub_social_public_state( $group_id, $user_id ) {
	global $wpdb;
	$group = sml_hub_group( $group_id );
	$cfg   = sml_hub_social_cfg( $group_id );
	if ( ! $group || ! sml_hub_socials_enabled_for( $group ) ) {
		return array( 'available' => false );
	}
	$t        = sml_hub_tables();
	$targets  = sml_hub_social_targets( $group_id );
	$links    = array();
	foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT platform, handle, proof_code, verified_at FROM {$t['social_links']} WHERE user_id=%d", absint( $user_id ) ), ARRAY_A ) as $l ) {
		$links[ $l['platform'] ] = array( 'handle' => $l['handle'], 'proof_code' => $l['proof_code'], 'verified' => ! empty( $l['verified_at'] ) );
	}
	$grant = $wpdb->get_row( $wpdb->prepare( "SELECT satisfied_targets, last_verified_at FROM {$t['social_grants']} WHERE group_id=%d AND user_id=%d", absint( $group_id ), absint( $user_id ) ), ARRAY_A );
	$role  = $cfg['grant_role_id'] ? sml_hub_role( $cfg['grant_role_id'] ) : null;
	return array(
		'available'  => true,
		'enabled'    => $cfg['enabled'] && count( $targets ) > 0,
		'rule'       => $cfg['rule'],
		'message'    => $cfg['message'],
		'reward'     => $role ? $role['name'] : sml_hub_base_labels()[ $cfg['grant_engine_role'] ],
		'targets'    => array_map( 'sml_hub_social_target_public', $targets ),
		'links'      => $links,
		'granted'    => (bool) $grant,
		'satisfied'  => $grant ? (array) json_decode( (string) $grant['satisfied_targets'], true ) : array(),
		'platforms'  => sml_hub_platform_status(),
	);
}

function sml_hub_social_owner_state( $group_id ) {
	global $wpdb;
	$t     = sml_hub_tables();
	$group = sml_hub_group( $group_id );
	$cfg   = sml_hub_social_cfg( $group_id );
	$rows  = (array) $wpdb->get_results( $wpdb->prepare( "SELECT g.user_id, g.applied_role_id, g.applied_engine_role, g.last_verified_at, g.created_at, u.display_name FROM {$t['social_grants']} g LEFT JOIN {$wpdb->users} u ON u.ID=g.user_id WHERE g.group_id=%d ORDER BY g.created_at DESC LIMIT 200", absint( $group_id ) ), ARRAY_A );
	return array(
		'available' => $group && sml_hub_socials_enabled_for( $group ),
		'config'    => $cfg,
		'targets'   => array_map( 'sml_hub_social_target_public', sml_hub_social_targets( $group_id ) ),
		'grants'    => $rows,
		'platforms' => sml_hub_platform_status(),
		'loop_source' => sml_hub_loop_follow_source(),
		'redirects' => array( 'youtube' => sml_hub_oauth_redirect( 'youtube' ), 'reddit' => sml_hub_oauth_redirect( 'reddit' ) ),
	);
}

/* ---------- REST ---------- */

add_action( 'rest_api_init', static function () {
	$ns = 'sml-hub/v1';
	$g  = '/group/(?P<group_id>\d+)/socials';

	register_rest_route( $ns, $g . '/config', array(
		'methods'             => 'POST',
		'permission_callback' => sml_hub_perm( 'manage_socials' ),
		'callback'            => static function ( $request ) {
			$gid  = absint( $request->get_param( 'group_id' ) );
			if ( ! sml_hub_socials_enabled_for( sml_hub_group( $gid ) ) ) {
				return sml_hub_rest_error( 'sml_hub_socials_off', 'Follow-to-unlock is not enabled for this group.', 403 );
			}
			$body = $request->get_json_params();
			$body = is_array( $body ) ? $body : array();
			$cfg  = sml_hub_social_cfg( $gid );
			if ( array_key_exists( 'enabled', $body ) ) {
				$cfg['enabled'] = ! empty( $body['enabled'] );
			}
			if ( isset( $body['rule'] ) ) {
				$cfg['rule'] = 'all' === $body['rule'] ? 'all' : 'any';
			}
			if ( array_key_exists( 'grant_role_id', $body ) ) {
				$rid  = absint( $body['grant_role_id'] );
				$role = $rid ? sml_hub_role( $rid ) : null;
				$cfg['grant_role_id'] = ( $role && $role['group_id'] === $gid ) ? $rid : 0;
			}
			if ( isset( $body['grant_engine_role'] ) && isset( sml_hub_base_levels()[ $body['grant_engine_role'] ] ) ) {
				if ( ! sml_hub_is_manager( $gid ) && sml_hub_base_levels()[ $body['grant_engine_role'] ] >= sml_hub_base_levels()['mod'] ) {
					return sml_hub_rest_error( 'sml_hub_role_too_high', 'Only owners and admins can grant Moderator or Admin.', 403 );
				}
				$cfg['grant_engine_role'] = $body['grant_engine_role'];
			}
			if ( isset( $body['message'] ) ) {
				$cfg['message'] = mb_substr( sanitize_textarea_field( (string) $body['message'] ), 0, 300 );
			}
			update_option( 'sml_hub_socials_cfg_' . $gid, $cfg, false );
			sml_hub_audit( $gid, 'socials_config', 0, $cfg );
			return array( 'socials' => sml_hub_social_owner_state( $gid ) );
		},
	) );

	register_rest_route( $ns, $g . '/targets', array(
		'methods'             => 'POST',
		'permission_callback' => sml_hub_perm( 'manage_socials' ),
		'callback'            => static function ( $request ) {
			global $wpdb;
			$t    = sml_hub_tables();
			$gid  = absint( $request->get_param( 'group_id' ) );
			if ( ! sml_hub_socials_enabled_for( sml_hub_group( $gid ) ) ) {
				return sml_hub_rest_error( 'sml_hub_socials_off', 'Follow-to-unlock is not enabled for this group.', 403 );
			}
			$body     = $request->get_json_params();
			$body     = is_array( $body ) ? $body : array();
			$platform = sanitize_key( (string) ( $body['platform'] ?? '' ) );
			$handle   = trim( (string) ( $body['handle'] ?? '' ) );
			$label    = mb_substr( sanitize_text_field( (string) ( $body['label'] ?? '' ) ), 0, 80 );
			$status   = sml_hub_platform_status();
			if ( ! isset( sml_hub_social_platforms()[ $platform ] ) ) {
				return sml_hub_rest_error( 'sml_hub_platform', 'That platform cannot be verified, so it cannot grant a role.' );
			}
			if ( 'ready' !== $status[ $platform ] ) {
				return sml_hub_rest_error( 'sml_hub_platform_not_ready', 'needs_setup' === $status[ $platform ] ? 'That platform needs its API app configured by the site admin first.' : 'That platform is not available on this site.' );
			}
			if ( count( sml_hub_social_targets( $gid ) ) >= 10 ) {
				return sml_hub_rest_error( 'sml_hub_target_limit', 'Up to 10 targets per group.' );
			}
			$external = '';
			$url      = '';
			if ( 'bluesky' === $platform ) {
				$r = sml_hub_bsky_resolve( $handle );
				if ( is_wp_error( $r ) ) {
					return $r;
				}
				$handle   = $r['handle'];
				$external = $r['did'];
				$url      = 'https://bsky.app/profile/' . rawurlencode( $handle );
			} elseif ( 'loop' === $platform ) {
				$r = sml_hub_loop_resolve( $handle );
				if ( is_wp_error( $r ) ) {
					return $r;
				}
				$handle   = $r['handle'];
				$external = $r['id'];
				$url      = home_url( '/channel/' . rawurlencode( $handle ) . '/' );
			} elseif ( 'youtube' === $platform ) {
				$handle = preg_replace( '/[^A-Za-z0-9_\-]/', '', $handle );
				if ( ! preg_match( '/^UC[A-Za-z0-9_\-]{20,}$/', $handle ) ) {
					return sml_hub_rest_error( 'sml_hub_youtube_id', 'Enter the YouTube channel ID (starts with UC). Find it under YouTube Studio → Settings → Channel → Advanced.' );
				}
				$external = $handle;
				$url      = 'https://www.youtube.com/channel/' . rawurlencode( $handle );
			} elseif ( 'reddit' === $platform ) {
				$handle = preg_replace( '#^(https?://)?(www\.)?reddit\.com/#', '', $handle );
				$handle = preg_replace( '#^(r|u|user)/#', '', trim( $handle, '/' ) );
				$handle = preg_replace( '/[^A-Za-z0-9_]/', '', $handle );
				if ( '' === $handle ) {
					return sml_hub_rest_error( 'sml_hub_reddit_name', 'Enter a subreddit name (r/…) or profile (u/…).' );
				}
				$is_user  = ! empty( $body['reddit_profile'] );
				$external = $is_user ? 'u_' . $handle : $handle;
				$handle   = $is_user ? 'u/' . $handle : 'r/' . $handle;
				$url      = 'https://www.reddit.com/' . $handle . '/';
			}
			$ok = $wpdb->insert( $t['social_targets'], array( 'group_id' => $gid, 'platform' => $platform, 'handle' => $handle, 'external_id' => $external, 'label' => $label, 'url' => $url, 'created_at' => sml_hub_now() ) );
			if ( ! $ok ) {
				return sml_hub_rest_error( 'sml_hub_target_exists', 'That target is already listed.', 409 );
			}
			sml_hub_audit( $gid, 'social_target_added', 0, array( 'platform' => $platform, 'handle' => $handle ) );
			return array( 'socials' => sml_hub_social_owner_state( $gid ) );
		},
	) );

	register_rest_route( $ns, $g . '/targets/(?P<target_id>\d+)', array(
		'methods'             => 'DELETE',
		'permission_callback' => sml_hub_perm( 'manage_socials' ),
		'callback'            => static function ( $request ) {
			global $wpdb;
			$t   = sml_hub_tables();
			$gid = absint( $request->get_param( 'group_id' ) );
			$wpdb->delete( $t['social_targets'], array( 'id' => absint( $request->get_param( 'target_id' ) ), 'group_id' => $gid ), array( '%d', '%d' ) );
			sml_hub_audit( $gid, 'social_target_removed', 0, array( 'target_id' => absint( $request->get_param( 'target_id' ) ) ) );
			return array( 'socials' => sml_hub_social_owner_state( $gid ) );
		},
	) );

	register_rest_route( $ns, $g . '/recheck', array(
		'methods'             => 'POST',
		'permission_callback' => sml_hub_perm( 'manage_socials' ),
		'callback'            => static function ( $request ) {
			global $wpdb;
			$t    = sml_hub_tables();
			$gid  = absint( $request->get_param( 'group_id' ) );
			$rows = (array) $wpdb->get_col( $wpdb->prepare( "SELECT user_id FROM {$t['social_grants']} WHERE group_id=%d LIMIT 500", $gid ) );
			$n    = 0;
			foreach ( $rows as $uid ) {
				$r = sml_hub_social_evaluate( $gid, (int) $uid );
				if ( ! $r['granted'] ) {
					$n++;
				}
			}
			return array( 'checked' => count( $rows ), 'revoked' => $n, 'socials' => sml_hub_social_owner_state( $gid ) );
		},
	) );

	register_rest_route( $ns, $g . '/connect', array(
		'methods'             => 'POST',
		'permission_callback' => 'is_user_logged_in',
		'callback'            => static function ( $request ) {
			$gid = absint( $request->get_param( 'group_id' ) );
			$uid = get_current_user_id();
			if ( ! sml_hub_socials_enabled_for( sml_hub_group( $gid ) ) ) {
				return sml_hub_rest_error( 'sml_hub_socials_off', 'Follow-to-unlock is not enabled for this group.', 403 );
			}
			$body     = $request->get_json_params();
			$body     = is_array( $body ) ? $body : array();
			$platform = sanitize_key( (string) ( $body['platform'] ?? '' ) );
			$status   = sml_hub_platform_status();
			if ( empty( $status[ $platform ] ) || 'ready' !== $status[ $platform ] ) {
				return sml_hub_rest_error( 'sml_hub_platform', 'That platform is not available.' );
			}
			if ( 'bluesky' === $platform ) {
				$r = sml_hub_bsky_resolve( (string) ( $body['handle'] ?? '' ) );
				if ( is_wp_error( $r ) ) {
					return $r;
				}
				$existing = sml_hub_social_link( $uid, 'bluesky' );
				$code     = ( $existing && $existing['proof_code'] && $existing['external_id'] === $r['did'] ) ? $existing['proof_code'] : 'SML-' . strtoupper( wp_generate_password( 6, false, false ) );
				$link     = sml_hub_social_save_link( $uid, 'bluesky', array( 'handle' => $r['handle'], 'external_id' => $r['did'], 'proof_code' => $code, 'verified_at' => ( $existing && $existing['external_id'] === $r['did'] ) ? $existing['verified_at'] : null ) );
				return array( 'platform' => 'bluesky', 'handle' => $link['handle'], 'proof_code' => $code, 'verified' => ! empty( $link['verified_at'] ),
					'instructions' => 'Add the code ' . $code . ' anywhere in your Bluesky bio, then press Verify. You can remove it after verification.' );
			}
			if ( 'youtube' === $platform || 'reddit' === $platform ) {
				return array( 'platform' => $platform, 'authorize_url' => sml_hub_oauth_authorize_url( $platform, $uid, $gid ) );
			}
			if ( 'loop' === $platform ) {
				return array( 'platform' => 'loop', 'verified' => true, 'instructions' => 'Your StockMarketLoop follows are checked automatically.' );
			}
			return sml_hub_rest_error( 'sml_hub_platform', 'Unknown platform.' );
		},
	) );

	register_rest_route( $ns, $g . '/verify', array(
		'methods'             => 'POST',
		'permission_callback' => 'is_user_logged_in',
		'callback'            => static function ( $request ) {
			$gid = absint( $request->get_param( 'group_id' ) );
			$uid = get_current_user_id();
			if ( ! sml_hub_socials_enabled_for( sml_hub_group( $gid ) ) ) {
				return sml_hub_rest_error( 'sml_hub_socials_off', 'Follow-to-unlock is not enabled for this group.', 403 );
			}
			$last = (int) get_user_meta( $uid, 'sml_hub_social_verify_at', true );
			if ( time() - $last < 20 ) {
				return sml_hub_rest_error( 'sml_hub_slow_down', 'Give it a few seconds, then try again.', 429 );
			}
			update_user_meta( $uid, 'sml_hub_social_verify_at', time() );
			$bsky = sml_hub_social_link( $uid, 'bluesky' );
			if ( $bsky && empty( $bsky['verified_at'] ) && $bsky['proof_code'] && sml_hub_bsky_bio_contains( $bsky['external_id'], $bsky['proof_code'] ) ) {
				sml_hub_social_save_link( $uid, 'bluesky', array( 'verified_at' => sml_hub_now() ) );
			}
			$result = sml_hub_social_evaluate( $gid, $uid );
			return array( 'result' => $result, 'socials' => sml_hub_social_public_state( $gid, $uid ) );
		},
	) );

	register_rest_route( $ns, $g . '/disconnect', array(
		'methods'             => 'POST',
		'permission_callback' => 'is_user_logged_in',
		'callback'            => static function ( $request ) {
			global $wpdb;
			$t        = sml_hub_tables();
			$gid      = absint( $request->get_param( 'group_id' ) );
			$uid      = get_current_user_id();
			$body     = $request->get_json_params();
			$platform = sanitize_key( (string) ( is_array( $body ) ? ( $body['platform'] ?? '' ) : '' ) );
			$wpdb->delete( $t['social_links'], array( 'user_id' => $uid, 'platform' => $platform ), array( '%d', '%s' ) );
			$result = sml_hub_social_evaluate( $gid, $uid );
			return array( 'result' => $result, 'socials' => sml_hub_social_public_state( $gid, $uid ) );
		},
	) );

	register_rest_route( $ns, '/oauth/(?P<platform>youtube|reddit)/callback', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => static function ( $request ) {
			$platform = sanitize_key( $request->get_param( 'platform' ) );
			$state    = sml_hub_oauth_state_read( (string) $request->get_param( 'state' ) );
			$group    = $state ? sml_hub_group( (int) $state['g'] ) : null;
			$back     = $group ? home_url( '/groups/' . rawurlencode( (string) $group['slug'] ) . '/' ) : home_url( '/' );
			$code     = (string) $request->get_param( 'code' );
			if ( ! $state || $state['p'] !== $platform || '' === $code ) {
				wp_safe_redirect( add_query_arg( 'socials', 'failed', $back ) );
				exit;
			}
			$tok = sml_hub_oauth_exchange( $platform, $code );
			if ( is_wp_error( $tok ) || empty( $tok['refresh_token'] ) ) {
				wp_safe_redirect( add_query_arg( 'socials', 'failed', $back ) );
				exit;
			}
			$tok['expires_at'] = time() + (int) ( $tok['expires_in'] ?? 3600 );
			$handle = '';
			if ( 'youtube' === $platform ) {
				$me = sml_hub_http_json( 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', array( 'headers' => array( 'Authorization' => 'Bearer ' . $tok['access_token'] ) ) );
				if ( ! is_wp_error( $me ) && ! empty( $me['items'][0] ) ) {
					$handle = (string) ( $me['items'][0]['snippet']['title'] ?? '' );
					$external = (string) $me['items'][0]['id'];
				}
			} else {
				$me = sml_hub_http_json( 'https://oauth.reddit.com/api/v1/me', array( 'headers' => array( 'Authorization' => 'Bearer ' . $tok['access_token'], 'User-Agent' => 'StockMarketLoop-GroupHub/' . SML_HUB_VERSION ) ) );
				if ( ! is_wp_error( $me ) ) {
					$handle   = (string) ( $me['name'] ?? '' );
					$external = (string) ( $me['id'] ?? '' );
				}
			}
			sml_hub_social_save_link( (int) $state['u'], $platform, array( 'handle' => $handle, 'external_id' => isset( $external ) ? $external : '', 'token_blob' => sml_hub_seal( wp_json_encode( $tok ) ), 'verified_at' => sml_hub_now() ) );
			sml_hub_social_evaluate( (int) $state['g'], (int) $state['u'] );
			wp_safe_redirect( add_query_arg( 'socials', 'connected', $back ) );
			exit;
		},
	) );
} );
