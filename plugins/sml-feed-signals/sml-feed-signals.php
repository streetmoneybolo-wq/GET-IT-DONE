<?php
/**
 * Plugin Name: SML Feed Signals
 * Description: Per-member feed signals — hides ("not interested"), impression counts, the onboarding questionnaire, and a server-side watchlist reader. The data the corporate feed slot's eligibility rules need.
 * Version: 1.2.0
 *
 * WHAT THIS IS FOR
 * The corporate feed slot (platform/corporate-feed.js) decides eligibility from
 * four per-member signals that did not exist on this site: whether the member
 * hid the source, how often they have already been shown it today, what they
 * told us they care about, and their watchlist. This plugin collects and stores
 * those signals. It does NOT render a slot and does NOT change the feed order.
 *
 * AUTHORS ARE RESOLVED HERE, NEVER TAKEN FROM THE BROWSER
 * A hide or an impression names a feed item (wp-123, chart-{uid}-…, stream-N,
 * grouppost-N, letter-N). The author is looked up from that item's own record.
 * A client that could name an author directly could inflate any account's hide
 * count — and hides are what demote a paying corporate account.
 *
 * ADDITIVE ONLY
 * Two new tables and new REST routes under sml-feed/v1. The homepage renderer,
 * the watchlist writers, and every existing table are untouched; the watchlist
 * reader never writes.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

const SML_FS_VERSION = '1.2.0';
const SML_FS_SCHEMA  = 2;
const SML_FS_NS      = 'sml-feed/v1';

/** Impressions are kept this long; the slot rules look back at most 7 days. */
const SML_FS_IMPRESSION_RETENTION_DAYS = 90;
/** Item-level hides expire; author-level hides stay until the member undoes them. */
const SML_FS_ITEM_HIDE_RETENTION_DAYS  = 180;
/** A single member cannot push one author's daily count past this. */
const SML_FS_MAX_DAILY_IMPRESSIONS     = 500;

function sml_fs_hides_table() { global $wpdb; return $wpdb->prefix . 'sml_feed_hides'; }
function sml_fs_impressions_table() { global $wpdb; return $wpdb->prefix . 'sml_feed_impressions'; }

/* ================================================================= schema */

function sml_fs_install() {
	global $wpdb;
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	$charset = $wpdb->get_charset_collate();
	$hides   = sml_fs_hides_table();
	$imps    = sml_fs_impressions_table();

	/* target is 'item:<ref>' or 'author:<id>' — one column so a UNIQUE key can
	 * hold both kinds without MySQL's NULLs-are-distinct loophole. author_id is
	 * stored on item hides too, so hides count toward the author either way. */
	dbDelta( "CREATE TABLE $hides (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  user_id bigint(20) unsigned NOT NULL,
  target varchar(200) NOT NULL,
  scope varchar(10) NOT NULL,
  item_ref varchar(190) NULL,
  author_id bigint(20) unsigned NULL,
  reason varchar(32) NOT NULL,
  created_at datetime NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY user_target (user_id,target),
  KEY author_created (author_id,created_at)
) $charset;" );

	/* Daily aggregates, not one row per view: at this site's size a row per
	 * (day, member, author, surface) is small, and the slot rules only ever ask
	 * "how many today" and "how many this week". */
	dbDelta( "CREATE TABLE $imps (
  day date NOT NULL,
  user_id bigint(20) unsigned NOT NULL,
  author_id bigint(20) unsigned NOT NULL,
  surface varchar(16) NOT NULL,
  impressions int(10) unsigned NOT NULL DEFAULT 0,
  best_position smallint(5) unsigned NOT NULL DEFAULT 999,
  updated_at datetime NOT NULL,
  PRIMARY KEY  (day,user_id,author_id,surface),
  KEY author_day (author_id,day)
) $charset;" );

	/* Schema 2: daily counts of corporate-slot decisions by outcome (served,
	 * no_candidates, holdout) — the evidence for tuning toward the 80% target. */
	dbDelta( "CREATE TABLE {$wpdb->prefix}sml_feed_slot_daily (
  day date NOT NULL,
  outcome varchar(32) NOT NULL,
  n int(10) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY  (day,outcome)
) $charset;" );

	/* autoloaded: sml_fs_maybe_install reads it on every request */
	update_option( 'sml_fs_schema', SML_FS_SCHEMA, true );
}

function sml_fs_maybe_install() {
	if ( (int) get_option( 'sml_fs_schema' ) !== SML_FS_SCHEMA ) sml_fs_install();
}

/* =============================================================== item refs */

/**
 * Parse a feed item reference into its kind and id.
 *
 * Only the shapes the feed actually emits are accepted. chart ids embed the
 * author's user id ("chart-{uid}-alert-6aa1…"); every other kind is a row id.
 */
function sml_fs_parse_item_ref( $ref ) {
	$ref = is_string( $ref ) ? trim( $ref ) : '';
	if ( '' === $ref || strlen( $ref ) > 190 ) return null;
	if ( preg_match( '/^(wp|stream|grouppost|letter)-(\d{1,19})$/', $ref, $m ) ) {
		return array( 'kind' => $m[1], 'id' => $m[2], 'ref' => $ref );
	}
	if ( preg_match( '/^chart-(\d{1,19})-[A-Za-z0-9_-]{1,120}$/', $ref, $m ) ) {
		return array( 'kind' => 'chart', 'id' => $m[1], 'ref' => $ref );
	}
	return null;
}

function sml_fs_table_exists( $table ) {
	global $wpdb;
	static $cache = array();
	if ( ! isset( $cache[ $table ] ) ) {
		$cache[ $table ] = ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) === $table );
	}
	return $cache[ $table ];
}

/** One query per kind, not per item. Returns [ref => author user id]. */
function sml_fs_resolve_authors( array $refs ) {
	global $wpdb;
	$by_kind = array();
	foreach ( $refs as $ref ) {
		$parsed = sml_fs_parse_item_ref( $ref );
		if ( $parsed ) $by_kind[ $parsed['kind'] ][ $parsed['id'] ][] = $parsed['ref'];
	}

	$sources = array(
		'wp'        => array( $wpdb->posts, 'ID', 'post_author' ),
		'stream'    => array( $wpdb->comments, 'comment_ID', 'user_id' ),
		'grouppost' => array( $wpdb->prefix . 'sml_group_posts', 'id', 'user_id' ),
		'letter'    => array( $wpdb->prefix . 'sml_letter_posts', 'id', 'author_id' ),
		/* chart ids carry the uid; the lookup only proves that user exists */
		'chart'     => array( $wpdb->users, 'ID', 'ID' ),
	);

	$authors = array();
	foreach ( $by_kind as $kind => $ids ) {
		if ( ! isset( $sources[ $kind ] ) ) continue;
		list( $table, $id_col, $author_col ) = $sources[ $kind ];
		if ( in_array( $kind, array( 'grouppost', 'letter' ), true ) && ! sml_fs_table_exists( $table ) ) continue;
		$keys         = array_keys( $ids );
		$placeholders = implode( ',', array_fill( 0, count( $keys ), '%d' ) );
		$rows = $wpdb->get_results( $wpdb->prepare(
			"SELECT $id_col AS item_id, $author_col AS author_id FROM $table WHERE $id_col IN ($placeholders)",
			array_map( 'intval', $keys )
		) );
		foreach ( (array) $rows as $row ) {
			$author = (int) $row->author_id;
			if ( $author <= 0 ) continue;
			foreach ( $ids[ (string) $row->item_id ] ?? array() as $ref ) $authors[ $ref ] = $author;
		}
	}
	return $authors;
}

/* ================================================================== limits */

/** Fixed-window counter per member. Returns false once the window is spent. */
function sml_fs_rate_ok( $user_id, $bucket, $max, $window_seconds ) {
	$key   = 'sml_fs_rl_' . $bucket . '_' . (int) $user_id;
	$count = (int) get_transient( $key );
	if ( $count >= $max ) return false;
	set_transient( $key, $count + 1, $window_seconds );
	return true;
}

function sml_fs_now() {
	return apply_filters( 'sml_fs_now', time() );
}

function sml_fs_error( $code, $message, $status ) {
	return new WP_Error( $code, $message, array( 'status' => $status ) );
}

/* =================================================================== hides */

const SML_FS_HIDE_REASONS = array( 'not_interested', 'hide_author' );

/**
 * Optional `refs` on hide/undo: the refs currently on screen. The response then
 * carries the up-to-date hidden set, so the feed updates in ONE round trip
 * instead of a hide followed by a separate /visible call (each request costs
 * ~2s of WordPress bootstrap on this host).
 */
function sml_fs_refs_param( WP_REST_Request $request ) {
	$refs = $request->get_param( 'refs' );
	if ( ! is_array( $refs ) ) return null;
	return array_slice( array_map( 'strval', array_filter( $refs, 'is_scalar' ) ), 0, 120 );
}

function sml_fs_rest_hide( WP_REST_Request $request ) {
	global $wpdb;
	$user_id = get_current_user_id();
	if ( ! sml_fs_rate_ok( $user_id, 'hide', 60, 3600 ) ) return sml_fs_error( 'sml_fs_rate', 'Too many hides — try again later.', 429 );

	$scope  = (string) $request->get_param( 'scope' );
	$parsed = sml_fs_parse_item_ref( $request->get_param( 'item_ref' ) );
	$reason = (string) ( $request->get_param( 'reason' ) ?: ( 'author' === $scope ? 'hide_author' : 'not_interested' ) );
	if ( ! in_array( $scope, array( 'item', 'author' ), true ) ) return sml_fs_error( 'sml_fs_scope', 'scope must be item or author.', 400 );
	if ( ! $parsed ) return sml_fs_error( 'sml_fs_item', 'item_ref is not a feed item.', 400 );
	if ( ! in_array( $reason, SML_FS_HIDE_REASONS, true ) ) return sml_fs_error( 'sml_fs_reason', 'Unknown reason.', 400 );

	$authors = sml_fs_resolve_authors( array( $parsed['ref'] ) );
	$author  = $authors[ $parsed['ref'] ] ?? null;
	if ( 'author' === $scope && ! $author ) return sml_fs_error( 'sml_fs_unknown_author', 'Could not find who posted that.', 422 );
	if ( $author && (int) $author === $user_id ) return sml_fs_error( 'sml_fs_self', 'You cannot hide your own posts.', 400 );

	$target = 'author' === $scope ? 'author:' . (int) $author : 'item:' . $parsed['ref'];
	$wpdb->query( $wpdb->prepare(
		'INSERT IGNORE INTO ' . sml_fs_hides_table() . ' (user_id, target, scope, item_ref, author_id, reason, created_at) VALUES (%d, %s, %s, %s, %d, %s, %s)',
		$user_id, $target, $scope, $parsed['ref'], (int) $author, $reason, gmdate( 'Y-m-d H:i:s', sml_fs_now() )
	) );
	$out  = array( 'hidden' => true, 'target' => $target, 'scope' => $scope );
	$refs = sml_fs_refs_param( $request );
	if ( null !== $refs ) $out['hiddenRefs'] = sml_fs_hidden_refs( $user_id, $refs );
	return rest_ensure_response( $out );
}

function sml_fs_rest_unhide( WP_REST_Request $request ) {
	global $wpdb;
	$target = (string) $request->get_param( 'target' );
	$ok_item   = 0 === strpos( $target, 'item:' ) && sml_fs_parse_item_ref( substr( $target, 5 ) );
	$ok_author = (bool) preg_match( '/^author:\d{1,19}$/', $target );
	if ( ! $ok_item && ! $ok_author ) return sml_fs_error( 'sml_fs_target', 'Unknown hide target.', 400 );
	$deleted = $wpdb->delete( sml_fs_hides_table(), array( 'user_id' => get_current_user_id(), 'target' => $target ), array( '%d', '%s' ) );
	$out  = array( 'restored' => (bool) $deleted, 'target' => $target );
	$refs = sml_fs_refs_param( $request );
	if ( null !== $refs ) $out['hiddenRefs'] = sml_fs_hidden_refs( get_current_user_id(), $refs );
	return rest_ensure_response( $out );
}

/**
 * Which of these on-screen items should this member not see?
 *
 * The browser sends item refs only; author hides are matched server-side,
 * which is the only way article cards (which carry no author attribute in the
 * DOM) can be filtered by author at all.
 */
function sml_fs_hidden_refs( $user_id, array $refs ) {
	global $wpdb;
	$refs = array_values( array_unique( array_filter( $refs, 'sml_fs_parse_item_ref' ) ) );
	if ( ! $refs ) return array();

	$rows = $wpdb->get_col( $wpdb->prepare( 'SELECT target FROM ' . sml_fs_hides_table() . ' WHERE user_id = %d', $user_id ) );
	if ( ! $rows ) return array();
	$targets = array_flip( $rows );

	$authors = sml_fs_resolve_authors( $refs );
	$hidden  = array();
	foreach ( $refs as $ref ) {
		if ( isset( $targets[ 'item:' . $ref ] ) ) { $hidden[] = $ref; continue; }
		if ( isset( $authors[ $ref ] ) && isset( $targets[ 'author:' . $authors[ $ref ] ] ) ) $hidden[] = $ref;
	}
	return $hidden;
}

function sml_fs_rest_visible( WP_REST_Request $request ) {
	$refs = $request->get_param( 'refs' );
	if ( ! is_array( $refs ) ) return sml_fs_error( 'sml_fs_refs', 'refs must be a list.', 400 );
	$refs = array_slice( array_map( 'strval', array_filter( $refs, 'is_scalar' ) ), 0, 120 );
	return rest_ensure_response( array( 'hidden' => sml_fs_hidden_refs( get_current_user_id(), $refs ) ) );
}

/* ============================================== the member's own hide list */

function sml_fs_member_handle( $user_id ) {
	/* Same resolution as sml-settings: the public handle first, never trusting
	 * nicename alone (nicenames collide on this site). */
	$h = function_exists( 'sml_ppe_public_handle' ) ? (string) sml_ppe_public_handle( $user_id ) : '';
	if ( '' === $h ) { $u = get_userdata( $user_id ); $h = $u ? $u->user_nicename : ''; }
	return ltrim( $h, '@' );
}

function sml_fs_member_url( $user_id ) {
	if ( function_exists( 'sml_fp_my_profile_url' ) ) return (string) sml_fp_my_profile_url( $user_id );
	if ( function_exists( 'sml_profile_url_for' ) ) return (string) sml_profile_url_for( (int) $user_id );
	$h = sml_fs_member_handle( $user_id );
	return $h ? home_url( '/' . $h . '/' ) : '';
}

function sml_fs_member_card( $user_id ) {
	$u = get_userdata( (int) $user_id );
	if ( ! $u ) return null;
	return array(
		'id'     => (int) $user_id,
		'name'   => $u->display_name ?: $u->user_login,
		'handle' => sml_fs_member_handle( (int) $user_id ),
		/* https always: some provisioned author avatars come back as http://, which
		 * the slot card refuses to load and a browser would flag as mixed content. */
		'avatar' => set_url_scheme( (string) get_avatar_url( (int) $user_id, array( 'size' => 56 ) ), 'https' ),
		'url'    => sml_fs_member_url( (int) $user_id ),
	);
}

/**
 * What a hidden post is shown as in the member's settings.
 *
 * Only PUBLIC content gets a title: a published, non-password article, or a
 * published public letter. Charts, ticker comments and group posts are shown
 * as "Post by <author>" — a group post may be paid content, and a member who
 * has since left the group must not get its text back from their settings.
 */
function sml_fs_describe_item( $ref ) {
	global $wpdb;
	$parsed = sml_fs_parse_item_ref( $ref );
	if ( ! $parsed ) return array( 'title' => null, 'url' => null );
	if ( 'wp' === $parsed['kind'] ) {
		$post = get_post( (int) $parsed['id'] );
		if ( $post && 'publish' === $post->post_status && '' === (string) $post->post_password ) {
			return array( 'title' => wp_strip_all_tags( get_the_title( $post ) ), 'url' => get_permalink( $post ) );
		}
		return array( 'title' => null, 'url' => null, 'gone' => true );
	}
	if ( 'letter' === $parsed['kind'] && sml_fs_table_exists( $wpdb->prefix . 'sml_letter_posts' ) ) {
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT title, status, visibility FROM {$wpdb->prefix}sml_letter_posts WHERE id = %d", (int) $parsed['id'] ) );
		if ( $row && 'published' === $row->status && ( '' === (string) $row->visibility || 'public' === $row->visibility ) ) {
			return array( 'title' => wp_strip_all_tags( (string) $row->title ), 'url' => null );
		}
	}
	return array( 'title' => null, 'url' => null );
}

/** GET /hides — the member's own hidden accounts and posts, newest first. */
function sml_fs_rest_hides_list( WP_REST_Request $request ) {
	global $wpdb;
	$user_id = get_current_user_id();
	$rows = $wpdb->get_results( $wpdb->prepare(
		'SELECT target, scope, item_ref, author_id, created_at FROM ' . sml_fs_hides_table() . ' WHERE user_id = %d ORDER BY created_at DESC, id DESC LIMIT 400',
		$user_id
	) );

	$accounts = array();
	$posts    = array();
	$cards    = array();
	foreach ( (array) $rows as $row ) {
		$author = (int) $row->author_id;
		if ( $author && ! array_key_exists( $author, $cards ) ) $cards[ $author ] = sml_fs_member_card( $author );
		$when = gmdate( 'c', strtotime( $row->created_at . ' UTC' ) );

		if ( 'author' === $row->scope ) {
			/* an account that no longer exists has nothing left to unhide */
			if ( ! $cards[ $author ] ) continue;
			$accounts[] = array_merge( $cards[ $author ], array( 'target' => $row->target, 'hiddenAt' => $when ) );
			continue;
		}
		$d = sml_fs_describe_item( (string) $row->item_ref );
		$posts[] = array(
			'target'   => $row->target,
			'title'    => $d['title'],
			'url'      => $d['url'],
			'gone'     => ! empty( $d['gone'] ),
			'author'   => $author && $cards[ $author ] ? array( 'name' => $cards[ $author ]['name'], 'url' => $cards[ $author ]['url'] ) : null,
			'hiddenAt' => $when,
		);
	}
	return rest_ensure_response( array(
		'accounts' => array_slice( $accounts, 0, 200 ),
		'posts'    => array_slice( $posts, 0, 200 ),
	) );
}

/* ============================================================= impressions */

const SML_FS_SURFACES = array( 'feed', 'slot' );

/**
 * Record a batch of on-screen impressions.
 *
 * The client counts a card once per page view, after it has been at least half
 * visible for a second. Here they are folded into daily per-author rows. A
 * member's own posts are not counted, and one member can add at most
 * SML_FS_MAX_DAILY_IMPRESSIONS per author per day — a script replaying the
 * endpoint cannot swamp an author's hide rate toward zero.
 */
function sml_fs_record_impressions( $user_id, array $items, $now = null ) {
	global $wpdb;
	$now   = $now ?? sml_fs_now();
	$clean = array();
	foreach ( array_slice( $items, 0, 60 ) as $item ) {
		if ( ! is_array( $item ) ) continue;
		$parsed  = sml_fs_parse_item_ref( $item['ref'] ?? null );
		$surface = (string) ( $item['surface'] ?? 'feed' );
		if ( ! $parsed || ! in_array( $surface, SML_FS_SURFACES, true ) ) continue;
		$position = isset( $item['position'] ) && is_numeric( $item['position'] ) ? max( 0, min( 998, (int) $item['position'] ) ) : 998;
		$key = $parsed['ref'] . '|' . $surface;
		if ( ! isset( $clean[ $key ] ) || $position < $clean[ $key ]['position'] ) {
			$clean[ $key ] = array( 'ref' => $parsed['ref'], 'surface' => $surface, 'position' => $position );
		}
	}
	if ( ! $clean ) return 0;

	$authors = sml_fs_resolve_authors( array_column( $clean, 'ref' ) );
	$rollup  = array();
	foreach ( $clean as $row ) {
		$author = $authors[ $row['ref'] ] ?? 0;
		if ( ! $author || (int) $author === (int) $user_id ) continue;
		$k = $author . '|' . $row['surface'];
		if ( ! isset( $rollup[ $k ] ) ) $rollup[ $k ] = array( 'author' => $author, 'surface' => $row['surface'], 'count' => 0, 'position' => 999 );
		$rollup[ $k ]['count']++;
		$rollup[ $k ]['position'] = min( $rollup[ $k ]['position'], $row['position'] );
	}

	$day     = gmdate( 'Y-m-d', $now );
	$stamp   = gmdate( 'Y-m-d H:i:s', $now );
	$table   = sml_fs_impressions_table();
	$written = 0;
	foreach ( $rollup as $r ) {
		$wpdb->query( $wpdb->prepare(
			"INSERT INTO $table (day, user_id, author_id, surface, impressions, best_position, updated_at)
			 VALUES (%s, %d, %d, %s, %d, %d, %s)
			 ON DUPLICATE KEY UPDATE
			   impressions = LEAST(impressions + VALUES(impressions), %d),
			   best_position = LEAST(best_position, VALUES(best_position)),
			   updated_at = VALUES(updated_at)",
			$day, $user_id, $r['author'], $r['surface'], min( $r['count'], SML_FS_MAX_DAILY_IMPRESSIONS ), $r['position'], $stamp,
			SML_FS_MAX_DAILY_IMPRESSIONS
		) );
		$written += $r['count'];
	}
	return $written;
}

function sml_fs_rest_impressions( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	if ( ! sml_fs_rate_ok( $user_id, 'imp', 30, 60 ) ) return sml_fs_error( 'sml_fs_rate', 'Too many requests.', 429 );
	$items = $request->get_param( 'items' );
	if ( ! is_array( $items ) ) return sml_fs_error( 'sml_fs_items', 'items must be a list.', 400 );
	return rest_ensure_response( array( 'recorded' => sml_fs_record_impressions( $user_id, $items ) ) );
}

/* ============================================================== onboarding */

/**
 * The questionnaire. MUST stay identical to QUESTIONS in
 * services/sml-platform/platform/corporate-onboarding.js — the slot's relevance
 * function reads the profile this produces. onboarding-fixtures.json is
 * generated from that Node module and the PHP test fails on any drift.
 */
function sml_fs_questions() {
	return array(
		array( 'id' => 'instrument', 'required' => true, 'type' => 'single', 'drives' => 'categoryAffinity, group recs',
			'prompt' => 'What do you mostly trade?',
			'options' => array( 'stocks', 'options', 'crypto', 'futures', 'learning' ) ),
		array( 'id' => 'holdPeriod', 'required' => true, 'type' => 'single', 'drives' => 'creator style match',
			'prompt' => 'How long is a typical position held?',
			'options' => array( 'minutes', 'days', 'weeks', 'months_plus' ) ),
		array( 'id' => 'riskAppetite', 'required' => true, 'type' => 'single', 'drives' => 'creator and group match',
			'prompt' => 'How would you describe your risk appetite?',
			'options' => array( 'protect_capital', 'balanced', 'aggressive', 'swing_for_the_fences' ) ),
		array( 'id' => 'experience', 'required' => true, 'type' => 'single', 'drives' => 'beginner-content weighting',
			'prompt' => 'Roughly how long have you been trading?',
			'options' => array( 'just_starting', 'under_a_year', 'one_to_five', 'over_five' ) ),
		array( 'id' => 'watchlist', 'required' => false, 'type' => 'tickers', 'max' => 5,
			'drives' => 'watchlist seed — the strongest feed signal there is',
			'prompt' => 'Pick up to 5 tickers you follow' ),
		array( 'id' => 'sectors', 'required' => false, 'type' => 'multi', 'drives' => 'corporate category match',
			'prompt' => 'Which sectors interest you?',
			'options' => array( 'technology', 'energy', 'healthcare', 'financials', 'consumer', 'industrials', 'crypto', 'macro' ) ),
		array( 'id' => 'learningStyle', 'required' => true, 'type' => 'single', 'drives' => 'rail ordering, letters vs video',
			'prompt' => 'How do you prefer to learn?',
			'options' => array( 'live_video', 'short_clips', 'written_letters', 'chat' ) ),
		array( 'id' => 'participation', 'required' => true, 'type' => 'single', 'drives' => 'voice-room rail on/off',
			'prompt' => 'Do you want live voice rooms and group chat, or mostly read quietly?',
			'options' => array( 'voice_and_chat', 'read_quietly' ) ),
		array( 'id' => 'intent', 'required' => true, 'type' => 'single', 'drives' => 'creator vs peer weighting',
			'prompt' => 'Are you here to follow pros, share your own trades, or both?',
			'options' => array( 'follow_pros', 'share_my_trades', 'both' ) ),
		array( 'id' => 'newsAppetite', 'required' => true, 'type' => 'single', 'drives' => 'corporate slot cap — self-selected',
			'prompt' => 'How much market news do you want?',
			'options' => array( 'headlines_only', 'a_few_a_day', 'everything' ) ),
	);
}

function sml_fs_slot_cap_by_appetite() {
	return array( 'headlines_only' => 1, 'a_few_a_day' => 2, 'everything' => 3 );
}

function sml_fs_category_signals() {
	return array(
		'instrument' => array(
			'stocks'   => array( 'finance' => 0.4, 'brokerage' => 0.2 ),
			'options'  => array( 'finance' => 0.5, 'data' => 0.3 ),
			'crypto'   => array( 'finance' => 0.3, 'data' => 0.2 ),
			'futures'  => array( 'finance' => 0.4, 'data' => 0.3 ),
			'learning' => array( 'research' => 0.3, 'media' => 0.2 ),
		),
		'learningStyle' => array(
			'live_video'      => array( 'media' => 0.3 ),
			'short_clips'     => array( 'media' => 0.3 ),
			'written_letters' => array( 'research' => 0.4, 'news' => 0.2 ),
			'chat'            => array( 'media' => 0.2 ),
		),
		'newsAppetite' => array(
			'headlines_only' => array( 'news' => 0.2 ),
			'a_few_a_day'    => array( 'news' => 0.4 ),
			'everything'     => array( 'news' => 0.6, 'media' => 0.2 ),
		),
		'sectors' => array(
			'technology'  => array( 'data' => 0.2, 'research' => 0.1 ),
			'energy'      => array( 'research' => 0.1 ),
			'healthcare'  => array( 'research' => 0.2 ),
			'financials'  => array( 'finance' => 0.3, 'brokerage' => 0.2 ),
			'consumer'    => array( 'media' => 0.1 ),
			'industrials' => array( 'research' => 0.1 ),
			'crypto'      => array( 'data' => 0.2 ),
			'macro'       => array( 'news' => 0.3, 'research' => 0.3 ),
		),
	);
}

function sml_fs_is_list( $value ) {
	return is_array( $value ) && ( array() === $value || array_keys( $value ) === range( 0, count( $value ) - 1 ) );
}

/** Mirrors normalizeTickers() in corporate-onboarding.js exactly. */
function sml_fs_normalize_tickers( $value ) {
	$seen = array();
	foreach ( sml_fs_is_list( $value ) ? $value : array() as $raw ) {
		$ticker = is_scalar( $raw ) && ! is_bool( $raw ) ? strtoupper( trim( (string) $raw ) ) : '';
		$ticker = preg_replace( '/^\$/', '', $ticker );
		if ( ! preg_match( '/^[A-Z][A-Z.\-]{0,9}$/', $ticker ) ) continue;
		$seen[ $ticker ] = true;
		if ( count( $seen ) >= 5 ) break;
	}
	return array_keys( $seen );
}

/** Mirrors validateAnswers() in corporate-onboarding.js exactly. */
function sml_fs_validate_answers( $input ) {
	$by_id    = array();
	foreach ( sml_fs_questions() as $q ) $by_id[ $q['id'] ] = $q;
	$answers  = array();
	$rejected = array();

	foreach ( is_array( $input ) ? $input : array() as $id => $raw ) {
		$id = (string) $id;
		if ( ! isset( $by_id[ $id ] ) ) { $rejected[] = array( 'id' => $id, 'reason' => 'unknown_question' ); continue; }
		$q = $by_id[ $id ];

		if ( 'tickers' === $q['type'] ) {
			$tickers = sml_fs_normalize_tickers( $raw );
			if ( $tickers ) $answers[ $id ] = $tickers;
			continue;
		}
		if ( 'multi' === $q['type'] ) {
			$chosen = array();
			foreach ( sml_fs_is_list( $raw ) ? $raw : array() as $v ) {
				$v = is_scalar( $v ) ? (string) $v : '';
				if ( in_array( $v, $q['options'], true ) && ! in_array( $v, $chosen, true ) ) $chosen[] = $v;
			}
			if ( $chosen ) $answers[ $id ] = $chosen;
			continue;
		}
		$value = is_scalar( $raw ) && ! is_bool( $raw ) ? (string) $raw : '';
		if ( ! in_array( $value, $q['options'], true ) ) { $rejected[] = array( 'id' => $id, 'reason' => 'unknown_option' ); continue; }
		$answers[ $id ] = $value;
	}

	$missing = array();
	foreach ( sml_fs_questions() as $q ) {
		if ( $q['required'] && ! array_key_exists( $q['id'], $answers ) ) $missing[] = $q['id'];
	}
	return array( 'answers' => $answers, 'missing' => $missing, 'rejected' => $rejected, 'complete' => ! $missing );
}

/** Mirrors buildProfile() in corporate-onboarding.js exactly. */
function sml_fs_build_profile( array $answers ) {
	$signals  = sml_fs_category_signals();
	$affinity = array();
	$add = function ( $contribution ) use ( &$affinity ) {
		foreach ( (array) $contribution as $category => $weight ) {
			$affinity[ $category ] = ( $affinity[ $category ] ?? 0 ) + $weight;
		}
	};
	$add( $signals['instrument'][ $answers['instrument'] ?? '' ] ?? null );
	$add( $signals['learningStyle'][ $answers['learningStyle'] ?? '' ] ?? null );
	$add( $signals['newsAppetite'][ $answers['newsAppetite'] ?? '' ] ?? null );
	foreach ( (array) ( $answers['sectors'] ?? array() ) as $sector ) $add( $signals['sectors'][ $sector ] ?? null );

	$category_affinity = array();
	foreach ( $affinity as $category => $weight ) {
		$category_affinity[ $category ] = min( 1, round( $weight * 1000 ) / 1000 );
	}
	$caps  = sml_fs_slot_cap_by_appetite();
	$style = $answers['learningStyle'] ?? null;

	return array(
		'watchlist'        => isset( $answers['watchlist'] ) && is_array( $answers['watchlist'] ) ? $answers['watchlist'] : array(),
		'categoryAffinity' => $category_affinity,
		'corporateSlotCap' => $caps[ $answers['newsAppetite'] ?? '' ] ?? $caps['a_few_a_day'],
		'prefersVideo'     => 'live_video' === $style || 'short_clips' === $style,
		'prefersLetters'   => 'written_letters' === $style,
		'wantsVoiceRooms'  => 'voice_and_chat' === ( $answers['participation'] ?? null ),
		'isBeginner'       => 'just_starting' === ( $answers['experience'] ?? null ) || 'learning' === ( $answers['instrument'] ?? null ),
		'holdPeriod'       => $answers['holdPeriod'] ?? null,
		'riskAppetite'     => $answers['riskAppetite'] ?? null,
		'intent'           => $answers['intent'] ?? null,
	);
}

const SML_FS_ONBOARDING_META = 'sml_feed_onboarding';
const SML_FS_SNOOZE_META     = 'sml_feed_onboarding_snooze_until';
/** Set when an account is created; the questionnaire opens as a welcome step once. */
const SML_FS_WELCOME_META    = 'sml_feed_onboarding_welcome';
const SML_FS_WELCOME_WINDOW  = 30 * 86400;

/**
 * Part of the sign-up flow WITHOUT touching the sign-up card.
 *
 * The /register/ card and its JavaScript are hardened and owner-approved; they
 * stay exactly as they are. sml-members creates the account with
 * wp_create_user() (so user_register fires), verification signs the member in,
 * and the card then sends them to the homepage — where feed-signals.js opens
 * the questionnaire as a welcome step because of this flag. It works the same
 * for any other way an account gets created. Shown once: saving or skipping
 * clears it, and it lapses after 30 days so an old unverified signup is not
 * greeted as new months later.
 */
function sml_fs_mark_new_member( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id > 0 ) update_user_meta( $user_id, SML_FS_WELCOME_META, sml_fs_now() );
}

function sml_fs_onboarding_state( $user_id ) {
	$stored = get_user_meta( $user_id, SML_FS_ONBOARDING_META, true );
	$snooze = (int) get_user_meta( $user_id, SML_FS_SNOOZE_META, true );
	$done   = is_array( $stored ) && ! empty( $stored['completed_at'] );
	$joined = (int) get_user_meta( $user_id, SML_FS_WELCOME_META, true );
	$welcome = ! $done && $joined > 0 && $joined > sml_fs_now() - SML_FS_WELCOME_WINDOW;
	return array(
		'completed'     => $done,
		'answers'       => $done ? $stored['answers'] : null,
		'profile'       => $done ? $stored['profile'] : null,
		'snoozedUntil'  => $snooze > sml_fs_now() ? gmdate( 'c', $snooze ) : null,
		'shouldPrompt'  => ! $done && $snooze <= sml_fs_now(),
		/* a brand-new member: open the questionnaire as a welcome step, not a card */
		'welcome'       => $welcome,
	);
}

function sml_fs_rest_onboarding_get( WP_REST_Request $request ) {
	$state = sml_fs_onboarding_state( get_current_user_id() );
	$state['questions'] = sml_fs_questions();
	/* Piggybacks on a request the homepage already makes: the client only asks
	 * /slot when this is true, so a switched-off slot costs members zero extra
	 * requests on a host that throttles on request volume. */
	$mode = function_exists( 'sml_cs_mode' ) ? sml_cs_mode() : 'off';
	$state['slot'] = 'on' === $mode || ( 'admins' === $mode && current_user_can( 'manage_options' ) );
	/* objects, not [] — an empty affinity map must stay a JSON object */
	if ( $state['profile'] && ! $state['profile']['categoryAffinity'] ) $state['profile']['categoryAffinity'] = new stdClass();
	return rest_ensure_response( $state );
}

function sml_fs_rest_onboarding_save( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	if ( ! sml_fs_rate_ok( $user_id, 'onb', 20, 3600 ) ) return sml_fs_error( 'sml_fs_rate', 'Too many attempts — try again later.', 429 );
	$result = sml_fs_validate_answers( $request->get_param( 'answers' ) );
	if ( ! $result['complete'] ) {
		return new WP_Error( 'sml_fs_incomplete', 'Please answer every required question.', array( 'status' => 422, 'missing' => $result['missing'] ) );
	}
	$profile = sml_fs_build_profile( $result['answers'] );
	update_user_meta( $user_id, SML_FS_ONBOARDING_META, array(
		'version'      => 1,
		'answers'      => $result['answers'],
		'profile'      => $profile,
		'completed_at' => gmdate( 'c', sml_fs_now() ),
	) );
	delete_user_meta( $user_id, SML_FS_SNOOZE_META );
	delete_user_meta( $user_id, SML_FS_WELCOME_META );
	if ( ! $profile['categoryAffinity'] ) $profile['categoryAffinity'] = new stdClass();
	return rest_ensure_response( array( 'saved' => true, 'profile' => $profile, 'ignored' => $result['rejected'] ) );
}

function sml_fs_rest_onboarding_snooze( WP_REST_Request $request ) {
	$days  = max( 1, min( 30, (int) ( $request->get_param( 'days' ) ?: 7 ) ) );
	$until = sml_fs_now() + $days * DAY_IN_SECONDS;
	update_user_meta( get_current_user_id(), SML_FS_SNOOZE_META, $until );
	/* skipping the welcome step is still an answer: never auto-open it again */
	delete_user_meta( get_current_user_id(), SML_FS_WELCOME_META );
	return rest_ensure_response( array( 'snoozedUntil' => gmdate( 'c', $until ) ) );
}

function sml_fs_rest_onboarding_reset( WP_REST_Request $request ) {
	delete_user_meta( get_current_user_id(), SML_FS_ONBOARDING_META );
	delete_user_meta( get_current_user_id(), SML_FS_SNOOZE_META );
	return rest_ensure_response( array( 'reset' => true ) );
}

/* =============================================================== watchlist */

/**
 * A member's watchlist, read-only.
 *
 * Three keys hold watchlists on this site and they have drifted apart: the
 * members plugin reads and writes `sml_watchlist`; the older social-trading
 * home engine wrote the same list to `sml_watchlist`, `sml_l6_watchlist` and
 * `sml_watchlist_symbols` together. Seen live: a member whose `sml_watchlist`
 * is empty while both older keys still hold four tickers. `sml_watchlist` wins
 * when it has anything; otherwise the older keys are the member's last known
 * list. Nothing here writes — other plugins own that data.
 */
function sml_fs_watchlist( $user_id, $max = 12 ) {
	foreach ( array( 'sml_watchlist', 'sml_watchlist_symbols', 'sml_l6_watchlist' ) as $key ) {
		$raw = get_user_meta( (int) $user_id, $key, true );
		if ( ! is_array( $raw ) ) continue;
		$out = array();
		foreach ( $raw as $symbol ) {
			$symbol = is_scalar( $symbol ) ? strtoupper( trim( (string) $symbol ) ) : '';
			$symbol = preg_replace( '/^\$/', '', $symbol );
			if ( preg_match( '/^[A-Z][A-Z.\-]{0,9}$/', $symbol ) && ! in_array( $symbol, $out, true ) ) $out[] = $symbol;
			if ( count( $out ) >= $max ) break;
		}
		if ( $out ) return $out;
	}
	return array();
}

/* ========================================================== slot signals */

/**
 * Everything the corporate slot's eligibility rules need for one member.
 *
 * Shapes match platform/corporate-feed.js: watchlist + onboardingProfile feed
 * relevance(); hiddenSources and slotsShownToday feed slotRejection().
 *
 * hiddenSources counts EVERY hide of that author in the last 7 days, item-level
 * "not interested" included — deliberately. A member who dismissed one of an
 * advertiser's posts should not be handed a paid slot from them the same week.
 */
function sml_fs_user_signals( $user_id, $now = null ) {
	global $wpdb;
	$now      = $now ?? sml_fs_now();
	$week_ago = gmdate( 'Y-m-d H:i:s', $now - 7 * DAY_IN_SECONDS );

	$hidden = array();
	$rows = $wpdb->get_results( $wpdb->prepare(
		'SELECT author_id, MAX(created_at) AS at FROM ' . sml_fs_hides_table() . ' WHERE user_id = %d AND author_id > 0 AND created_at >= %s GROUP BY author_id',
		$user_id, $week_ago
	) );
	foreach ( (array) $rows as $r ) $hidden[ (int) $r->author_id ] = strtotime( $r->at . ' UTC' ) * 1000;

	$shown = array();
	$rows = $wpdb->get_results( $wpdb->prepare(
		"SELECT author_id, impressions FROM " . sml_fs_impressions_table() . " WHERE user_id = %d AND day = %s AND surface = 'slot'",
		$user_id, gmdate( 'Y-m-d', $now )
	) );
	foreach ( (array) $rows as $r ) $shown[ (int) $r->author_id ] = (int) $r->impressions;

	$onboarding = sml_fs_onboarding_state( $user_id );
	return array(
		'userId'            => (int) $user_id,
		'watchlist'         => sml_fs_watchlist( $user_id ),
		'onboardingProfile' => $onboarding['profile'],
		'hiddenSources'     => $hidden,
		'slotsShownToday'   => $shown,
	);
}

/**
 * Per-author 7-day totals for the hide-rate demotion (corporate-feed.js
 * boostFor: slotImpressions, organicImpressions, hides).
 */
function sml_fs_author_metrics( $author_id, $now = null ) {
	global $wpdb;
	$now   = $now ?? sml_fs_now();
	$since = gmdate( 'Y-m-d', $now - 6 * DAY_IN_SECONDS );
	$imps  = $wpdb->get_results( $wpdb->prepare(
		'SELECT surface, SUM(impressions) AS n FROM ' . sml_fs_impressions_table() . ' WHERE author_id = %d AND day >= %s GROUP BY surface',
		$author_id, $since
	), OBJECT_K );
	$hides = (int) $wpdb->get_var( $wpdb->prepare(
		'SELECT COUNT(*) FROM ' . sml_fs_hides_table() . ' WHERE author_id = %d AND created_at >= %s',
		$author_id, gmdate( 'Y-m-d H:i:s', $now - 7 * DAY_IN_SECONDS )
	) );
	return array(
		'slotImpressions'    => isset( $imps['slot'] ) ? (int) $imps['slot']->n : 0,
		'organicImpressions' => isset( $imps['feed'] ) ? (int) $imps['feed']->n : 0,
		'hides'              => $hides,
	);
}

/* =============================================================== retention */

function sml_fs_retention() {
	global $wpdb;
	$now = sml_fs_now();
	$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . sml_fs_impressions_table() . ' WHERE day < %s',
		gmdate( 'Y-m-d', $now - SML_FS_IMPRESSION_RETENTION_DAYS * DAY_IN_SECONDS ) ) );
	$wpdb->query( $wpdb->prepare( "DELETE FROM " . sml_fs_hides_table() . " WHERE scope = 'item' AND created_at < %s",
		gmdate( 'Y-m-d H:i:s', $now - SML_FS_ITEM_HIDE_RETENTION_DAYS * DAY_IN_SECONDS ) ) );
}

/* ================================================================= privacy */

function sml_fs_privacy_exporter( $email, $page = 1 ) {
	global $wpdb;
	$user = get_user_by( 'email', $email );
	if ( ! $user ) return array( 'data' => array(), 'done' => true );
	$data  = array();
	$hides = $wpdb->get_results( $wpdb->prepare( 'SELECT target, reason, created_at FROM ' . sml_fs_hides_table() . ' WHERE user_id = %d', $user->ID ) );
	foreach ( (array) $hides as $i => $h ) {
		$data[] = array( 'group_id' => 'sml-feed-hides', 'group_label' => 'Feed: hidden posts and accounts', 'item_id' => 'hide-' . $i,
			'data' => array( array( 'name' => 'Hidden', 'value' => $h->target ), array( 'name' => 'Reason', 'value' => $h->reason ), array( 'name' => 'When', 'value' => $h->created_at ) ) );
	}
	$days = $wpdb->get_results( $wpdb->prepare( 'SELECT day, author_id, surface, impressions FROM ' . sml_fs_impressions_table() . ' WHERE user_id = %d', $user->ID ) );
	foreach ( (array) $days as $i => $d ) {
		$data[] = array( 'group_id' => 'sml-feed-impressions', 'group_label' => 'Feed: posts shown to you (daily counts)', 'item_id' => 'imp-' . $i,
			'data' => array( array( 'name' => 'Day', 'value' => $d->day ), array( 'name' => 'Author', 'value' => $d->author_id ), array( 'name' => 'Where', 'value' => $d->surface ), array( 'name' => 'Times shown', 'value' => $d->impressions ) ) );
	}
	$onb = get_user_meta( $user->ID, SML_FS_ONBOARDING_META, true );
	if ( is_array( $onb ) ) {
		$data[] = array( 'group_id' => 'sml-feed-onboarding', 'group_label' => 'Feed: your questionnaire answers', 'item_id' => 'onboarding',
			'data' => array( array( 'name' => 'Answers', 'value' => wp_json_encode( $onb['answers'] ?? array() ) ), array( 'name' => 'Completed', 'value' => (string) ( $onb['completed_at'] ?? '' ) ) ) );
	}
	return array( 'data' => $data, 'done' => true );
}

function sml_fs_privacy_eraser( $email, $page = 1 ) {
	global $wpdb;
	$user = get_user_by( 'email', $email );
	if ( ! $user ) return array( 'items_removed' => false, 'items_retained' => false, 'messages' => array(), 'done' => true );
	$removed  = (int) $wpdb->delete( sml_fs_hides_table(), array( 'user_id' => $user->ID ), array( '%d' ) );
	$removed += (int) $wpdb->delete( sml_fs_impressions_table(), array( 'user_id' => $user->ID ), array( '%d' ) );
	$removed += delete_user_meta( $user->ID, SML_FS_ONBOARDING_META ) ? 1 : 0;
	delete_user_meta( $user->ID, SML_FS_SNOOZE_META );
	delete_user_meta( $user->ID, SML_FS_WELCOME_META );
	return array( 'items_removed' => $removed > 0, 'items_retained' => false, 'messages' => array(), 'done' => true );
}

/* ================================================================== wiring */

function sml_fs_logged_in() {
	return is_user_logged_in();
}

function sml_fs_register_routes() {
	$auth = 'sml_fs_logged_in';
	register_rest_route( SML_FS_NS, '/hide', array(
		array( 'methods' => 'POST', 'callback' => 'sml_fs_rest_hide', 'permission_callback' => $auth ),
		array( 'methods' => 'DELETE', 'callback' => 'sml_fs_rest_unhide', 'permission_callback' => $auth ),
	) );
	register_rest_route( SML_FS_NS, '/visible', array( 'methods' => 'POST', 'callback' => 'sml_fs_rest_visible', 'permission_callback' => $auth ) );
	register_rest_route( SML_FS_NS, '/hides', array( 'methods' => 'GET', 'callback' => 'sml_fs_rest_hides_list', 'permission_callback' => $auth ) );
	register_rest_route( SML_FS_NS, '/impressions', array( 'methods' => 'POST', 'callback' => 'sml_fs_rest_impressions', 'permission_callback' => $auth ) );
	register_rest_route( SML_FS_NS, '/onboarding', array(
		array( 'methods' => 'GET', 'callback' => 'sml_fs_rest_onboarding_get', 'permission_callback' => $auth ),
		array( 'methods' => 'POST', 'callback' => 'sml_fs_rest_onboarding_save', 'permission_callback' => $auth ),
		array( 'methods' => 'DELETE', 'callback' => 'sml_fs_rest_onboarding_reset', 'permission_callback' => $auth ),
	) );
	register_rest_route( SML_FS_NS, '/onboarding/snooze', array( 'methods' => 'POST', 'callback' => 'sml_fs_rest_onboarding_snooze', 'permission_callback' => $auth ) );
}

/* The corporate slot: a port of corporate-feed.js decided from these signals. */
require_once __DIR__ . '/corporate-slot.php';

register_activation_hook( __FILE__, 'sml_fs_install' );
add_action( 'plugins_loaded', 'sml_fs_maybe_install' );
add_action( 'user_register', 'sml_fs_mark_new_member', 20 );
add_action( 'rest_api_init', 'sml_fs_register_routes' );
add_action( 'sml_fs_retention_event', 'sml_fs_retention' );
add_action( 'init', function () {
	if ( function_exists( 'wp_next_scheduled' ) && ! wp_next_scheduled( 'sml_fs_retention_event' ) ) {
		wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'sml_fs_retention_event' );
	}
} );
register_deactivation_hook( __FILE__, function () {
	wp_clear_scheduled_hook( 'sml_fs_retention_event' );
} );
add_filter( 'wp_privacy_personal_data_exporters', function ( $exporters ) {
	$exporters['sml-feed-signals'] = array( 'exporter_friendly_name' => 'Feed signals', 'callback' => 'sml_fs_privacy_exporter' );
	return $exporters;
} );
add_filter( 'wp_privacy_personal_data_erasers', function ( $erasers ) {
	$erasers['sml-feed-signals'] = array( 'eraser_friendly_name' => 'Feed signals', 'callback' => 'sml_fs_privacy_eraser' );
	return $erasers;
} );
