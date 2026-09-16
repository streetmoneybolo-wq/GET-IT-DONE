<?php
/**
 * The corporate feed slot — decided here, from the member's feed signals.
 *
 * THE RULES ARE A PORT, NOT A REDESIGN. relevance(), slotRejection(),
 * selectSlotItem() and isHeldOut() mirror services/sml-platform/platform/
 * corporate-feed.js exactly. slot-fixtures.json is generated FROM that module
 * and test-sml-feed-signals.php fails on any divergence — change the rules in
 * Node first, regenerate, then port.
 *
 * WHY WORDPRESS DECIDES. The member's signals (hides, slot impressions,
 * questionnaire, watchlist), the corporate account list (projected here by the
 * platform) and the feed itself all live on WordPress. Asking the Render API on
 * every homepage load would add latency and make the feed depend on it.
 *
 * THE 80% IS A CEILING, NOT A QUOTA. No eligible item means NO slot — never a
 * filler, never a non-corporate post dressed as promoted, never the same item
 * re-shown to hit a number.
 *
 * OFF UNTIL SWITCHED ON. Option `sml_corporate_slot`: 'off' (default), 'admins'
 * (administrators only — a staged look on the live site), 'on'. The 10% holdout
 * applies in every mode except 'admins'.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

const SML_CS_HOLDOUT_SALT = 'sml-corporate-holdout-v1';

/** POLICY from corporate-feed.js. Times in milliseconds, as in Node. */
function sml_cs_policy() {
	return array(
		'relevanceFloor'          => 0.35,
		'dailySlotCap'            => 2,
		'slotEligiblePostsPerDay' => 5,
		'maxItemAgeMs'            => 24 * 3600 * 1000,
		'hideSuppressionMs'       => 7 * 24 * 3600 * 1000,
		'recencyHalfLifeMs'       => 6 * 3600 * 1000,
		'corporateBoost'          => 1.5,
		'promoBoost'              => 1.5,
		'hideRateDemotion'        => 0.08,
		'holdoutPercent'          => 10,
	);
}

const SML_CS_SLOT_INDEX = 4;

function sml_cs_now_ms() {
	return (int) round( (float) apply_filters( 'sml_cs_now_ms', microtime( true ) * 1000 ) );
}

/** Date.parse() for the ISO strings this code produces and consumes; null when unparseable. */
function sml_cs_parse_ms( $iso ) {
	if ( ! is_string( $iso ) || '' === trim( $iso ) ) return null;
	try {
		$d = new DateTimeImmutable( $iso );
	} catch ( Exception $e ) {
		return null;
	}
	return (int) $d->format( 'Uv' );
}

function sml_cs_clamp01( $value ) {
	if ( ! is_numeric( $value ) ) return 0;
	$n = (float) $value;
	if ( is_nan( $n ) || is_infinite( $n ) ) return 0;
	return $n < 0 ? 0 : ( $n > 1 ? 1 : $n );
}

/** Number.isSafeInteger(Number(value)) && >= 1 */
function sml_cs_positive_id( $value ) {
	if ( is_bool( $value ) || null === $value || ! is_numeric( $value ) ) return null;
	$n = (float) $value;
	if ( floor( $n ) !== $n || $n < 1 || $n > 9007199254740991 ) return null;
	return (int) $n;
}

/** isHeldOut() — deterministic, permanent; an unknown user is held out. */
function sml_cs_is_held_out( $user_id, $salt = SML_CS_HOLDOUT_SALT, $percent = 10 ) {
	$id = sml_cs_positive_id( $user_id );
	if ( null === $id ) return true;
	$digest = hash( 'sha256', $salt . ':' . $id, true );
	$first  = unpack( 'N', substr( $digest, 0, 4 ) )[1];
	return ( $first % 1000 ) < (int) round( $percent * 10 );
}

function sml_cs_ticker_overlap( $item_tickers, $watchlist ) {
	$tickers = is_array( $item_tickers ) ? array_values( $item_tickers ) : array();
	$watched = is_array( $watchlist ) ? array_values( $watchlist ) : array();
	if ( ! $tickers || ! $watched ) return 0;
	$upper = array();
	foreach ( $watched as $t ) $upper[ strtoupper( (string) $t ) ] = true;
	$hits = 0;
	foreach ( $tickers as $t ) if ( isset( $upper[ strtoupper( (string) $t ) ] ) ) $hits++;
	return sml_cs_clamp01( $hits / count( $tickers ) );
}

function sml_cs_category_affinity( $category, $profile ) {
	if ( ! $category || ! is_array( $profile ) ) return 0;
	$aff = $profile['categoryAffinity'] ?? null;
	if ( ! is_array( $aff ) ) return 0;
	return sml_cs_clamp01( $aff[ $category ] ?? 0 );
}

function sml_cs_recency_decay( $age_ms, $half_life_ms ) {
	if ( null === $age_ms || ! is_finite( (float) $age_ms ) || $age_ms < 0 ) return 0;
	return pow( 0.5, $age_ms / $half_life_ms );
}

/** relevance(item, user) in [0, 1]. */
function sml_cs_relevance( array $item, array $user, $now_ms, ?array $policy = null ) {
	$policy    = $policy ?? sml_cs_policy();
	$published = sml_cs_parse_ms( $item['publishedAt'] ?? null );
	$age_ms    = null === $published ? null : $now_ms - $published;
	return sml_cs_clamp01(
		  0.45 * sml_cs_ticker_overlap( $item['tickers'] ?? array(), $user['watchlist'] ?? array() )
		+ 0.25 * sml_cs_category_affinity( $item['category'] ?? null, $user['onboardingProfile'] ?? null )
		+ 0.20 * sml_cs_clamp01( $item['engagementRate7d'] ?? 0 )
		+ 0.10 * sml_cs_recency_decay( $age_ms, $policy['recencyHalfLifeMs'] )
	);
}

/**
 * slotRejection() — why an item may not take the slot, or null.
 *
 * $context: activeCorporateIds (list), hiddenSources / slotsShownToday /
 * slotEligibleUsedToday (maps keyed by corporate user id).
 */
function sml_cs_slot_rejection( array $item, array $user, array $context, $now_ms, ?array $policy = null ) {
	$policy = $policy ?? sml_cs_policy();
	$active = array_flip( array_map( 'intval', (array) ( $context['activeCorporateIds'] ?? array() ) ) );

	$corporate = sml_cs_positive_id( $item['corporateId'] ?? null );
	if ( null === $corporate ) return 'not_corporate';
	if ( ! isset( $active[ $corporate ] ) ) return 'not_active';

	$published = sml_cs_parse_ms( $item['publishedAt'] ?? null );
	$age_ms    = null === $published ? null : $now_ms - $published;
	if ( null === $age_ms || $age_ms < 0 || $age_ms >= $policy['maxItemAgeMs'] ) return 'stale';

	$hidden_at = $context['hiddenSources'][ $corporate ] ?? null;
	if ( null !== $hidden_at && $now_ms - (float) $hidden_at < $policy['hideSuppressionMs'] ) return 'user_hid_source';

	if ( (int) ( $context['slotsShownToday'][ $corporate ] ?? 0 ) >= $policy['dailySlotCap'] ) return 'user_frequency_cap';
	if ( (int) ( $context['slotEligibleUsedToday'][ $corporate ] ?? 0 ) >= $policy['slotEligiblePostsPerDay'] ) return 'account_daily_cap';

	if ( sml_cs_relevance( $item, $user, $now_ms, $policy ) < $policy['relevanceFloor'] ) return 'below_relevance_floor';
	return null;
}

/** selectSlotItem() — highest relevance, ties broken by id; null means an EMPTY slot. */
function sml_cs_select( array $items, array $user, array $context, $now_ms, ?array $policy = null ) {
	$policy   = $policy ?? sml_cs_policy();
	$eligible = array();
	foreach ( $items as $item ) {
		if ( is_array( $item ) && null === sml_cs_slot_rejection( $item, $user, $context, $now_ms, $policy ) ) {
			$eligible[] = array( 'item' => $item, 'r' => sml_cs_relevance( $item, $user, $now_ms, $policy ) );
		}
	}
	if ( ! $eligible ) return null;
	usort( $eligible, function ( $a, $b ) {
		if ( $b['r'] !== $a['r'] ) return $b['r'] < $a['r'] ? -1 : 1;
		return strcmp( (string) $a['item']['id'], (string) $b['item']['id'] );
	} );
	return $eligible[0]['item'];
}

/* ======================================================= live candidates */

/**
 * The active corporate accounts, from the projection the platform pushes to
 * plugin sml-corporate-badges. Filterable (sml_cs_accounts) so a staged test
 * can supply accounts without touching the real projection.
 */
function sml_cs_accounts() {
	$accounts = function_exists( 'sml_cb_accounts' ) ? sml_cb_accounts() : array();
	return (array) apply_filters( 'sml_cs_accounts', $accounts );
}

function sml_cs_tickers_from_text( $text ) {
	preg_match_all( '/\$([A-Z]{1,5}(?:\.[A-Z])?)(?![A-Za-z])/', (string) $text, $m );
	return $m[1];
}

/**
 * Recent content from corporate authors, in corporate-feed.js item shape.
 *
 * slotEligiblePostsPerDay is applied HERE, as its design intent: only each
 * account's five newest posts from the last 24h are slot candidates; the rest
 * still compete organically. Cached site-wide for 60s — the candidate list is
 * the same for every member; only the decision is per member.
 */
function sml_cs_candidates( $now_ms ) {
	global $wpdb;
	$accounts = sml_cs_accounts();
	if ( ! $accounts ) return array();
	$ids = array_values( array_filter( array_map( 'intval', array_keys( $accounts ) ) ) );
	if ( ! $ids ) return array();

	$cache_key = 'sml_cs_cand_' . md5( implode( ',', $ids ) . '|' . intdiv( $now_ms, 60000 ) );
	$cached    = get_transient( $cache_key );
	if ( is_array( $cached ) ) return $cached;

	$policy = sml_cs_policy();
	$since  = gmdate( 'Y-m-d H:i:s', intdiv( $now_ms - $policy['maxItemAgeMs'], 1000 ) );
	$in     = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
	$items  = array();
	$per    = array();

	$posts = $wpdb->get_results( $wpdb->prepare(
		"SELECT ID, post_author, post_title, post_excerpt, post_date_gmt FROM {$wpdb->posts}
		  WHERE post_type = 'post' AND post_status = 'publish' AND post_password = ''
		    AND post_author IN ($in) AND post_date_gmt >= %s
		  ORDER BY post_date_gmt DESC LIMIT 200",
		array_merge( $ids, array( $since ) )
	) );
	foreach ( (array) $posts as $p ) {
		$author = (int) $p->post_author;
		if ( ( $per[ $author ] ?? 0 ) >= $policy['slotEligiblePostsPerDay'] ) continue;
		$per[ $author ] = ( $per[ $author ] ?? 0 ) + 1;
		$tickers = sml_cs_tickers_from_text( $p->post_title );
		$primary = strtoupper( (string) get_post_meta( (int) $p->ID, '_sml_primary_ticker', true ) );
		if ( preg_match( '/^[A-Z][A-Z.\-]{0,9}$/', $primary ) ) array_unshift( $tickers, $primary );
		$items[] = array(
			'id'               => 'wp-' . (int) $p->ID,
			'corporateId'      => $author,
			'category'         => (string) ( $accounts[ $author ]['category'] ?? 'other' ),
			'tickers'          => array_values( array_unique( $tickers ) ),
			'engagementRate7d' => 0,
			'publishedAt'      => gmdate( 'Y-m-d\TH:i:s.000\Z', strtotime( $p->post_date_gmt . ' UTC' ) ),
			'title'            => wp_strip_all_tags( get_the_title( (int) $p->ID ) ),
			'url'              => get_permalink( (int) $p->ID ),
			'excerpt'          => wp_trim_words( wp_strip_all_tags( $p->post_excerpt ?: get_post_field( 'post_content', (int) $p->ID ) ), 32, '…' ),
			'image'            => get_the_post_thumbnail_url( (int) $p->ID, 'medium_large' ) ?: null,
		);
	}

	$letters_table = $wpdb->prefix . 'sml_letter_posts';
	if ( function_exists( 'sml_fs_table_exists' ) && sml_fs_table_exists( $letters_table ) ) {
		$letters = $wpdb->get_results( $wpdb->prepare(
			"SELECT id, author_id, title, tldr, subtitle, cover_url, slug, published_at FROM $letters_table
			  WHERE status = 'published' AND visibility = 'public' AND has_paywall = 0
			    AND author_id IN ($in) AND published_at >= %s
			  ORDER BY published_at DESC LIMIT 50",
			array_merge( $ids, array( $since ) )
		) );
		$ticker_table = $wpdb->prefix . 'sml_letter_tickers';
		foreach ( (array) $letters as $l ) {
			$author = (int) $l->author_id;
			if ( ( $per[ $author ] ?? 0 ) >= $policy['slotEligiblePostsPerDay'] ) continue;
			$per[ $author ] = ( $per[ $author ] ?? 0 ) + 1;
			$symbols = $wpdb->get_col( $wpdb->prepare( "SELECT symbol FROM $ticker_table WHERE letter_id = %d", (int) $l->id ) );
			$items[] = array(
				'id'               => 'letter-' . (int) $l->id,
				'corporateId'      => $author,
				'category'         => (string) ( $accounts[ $author ]['category'] ?? 'other' ),
				'tickers'          => array_values( array_unique( array_map( 'strtoupper', (array) $symbols ) ) ),
				'engagementRate7d' => 0,
				'publishedAt'      => gmdate( 'Y-m-d\TH:i:s.000\Z', strtotime( $l->published_at . ' UTC' ) ),
				'title'            => wp_strip_all_tags( (string) $l->title ),
				'url'              => home_url( '/n/' . rawurlencode( (string) $l->slug ) . '/' ),
				'excerpt'          => wp_trim_words( wp_strip_all_tags( (string) ( $l->tldr ?: $l->subtitle ) ), 32, '…' ),
				'image'            => $l->cover_url ? esc_url_raw( $l->cover_url ) : null,
			);
		}
	}

	set_transient( $cache_key, $items, 60 );
	return $items;
}

/* ================================================================ outcomes */

function sml_cs_outcomes_table() { global $wpdb; return $wpdb->prefix . 'sml_feed_slot_daily'; }

/** Daily counts of slot decisions by outcome — what step 7 (tuning to 80%) reads. */
function sml_cs_record_outcome( $outcome, $now_ms ) {
	global $wpdb;
	$wpdb->query( $wpdb->prepare(
		'INSERT INTO ' . sml_cs_outcomes_table() . ' (day, outcome, n) VALUES (%s, %s, 1) ON DUPLICATE KEY UPDATE n = n + 1',
		gmdate( 'Y-m-d', intdiv( $now_ms, 1000 ) ), substr( (string) $outcome, 0, 32 )
	) );
}

/* ================================================================== routes */

function sml_cs_mode() {
	$mode = (string) get_option( 'sml_corporate_slot', 'off' );
	return in_array( $mode, array( 'off', 'admins', 'on' ), true ) ? $mode : 'off';
}

/**
 * GET /sml-feed/v1/slot — this member's slot decision for this page view.
 *
 * { slot: null, reason: 'disabled' | 'holdout' | 'no_candidates' }  or
 * { slot: {...}, reason: null, position: 4 }
 */
function sml_cs_rest_slot( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$now_ms  = sml_cs_now_ms();
	$mode    = sml_cs_mode();
	$respond = function ( $body ) {
		$res = rest_ensure_response( $body );
		$res->header( 'Cache-Control', 'no-store, private' );
		return $res;
	};

	if ( 'off' === $mode || ( 'admins' === $mode && ! current_user_can( 'manage_options' ) ) ) {
		return $respond( array( 'slot' => null, 'reason' => 'disabled' ) );
	}
	if ( ! sml_fs_rate_ok( $user_id, 'slot', 30, 60 ) ) {
		return $respond( array( 'slot' => null, 'reason' => 'rate_limited' ) );
	}
	/* staged mode is a look at the slot, not an experiment arm */
	if ( 'on' === $mode && sml_cs_is_held_out( $user_id ) ) {
		sml_cs_record_outcome( 'holdout', $now_ms );
		return $respond( array( 'slot' => null, 'reason' => 'holdout' ) );
	}

	$signals = sml_fs_user_signals( $user_id, intdiv( $now_ms, 1000 ) );
	$policy  = sml_cs_policy();
	/* Question 10: the member's own ceiling on promoted slots per day */
	$own_cap = $signals['onboardingProfile']['corporateSlotCap'] ?? null;
	if ( is_int( $own_cap ) && $own_cap >= 1 ) $policy['dailySlotCap'] = $own_cap;

	$accounts = sml_cs_accounts();
	$context  = array(
		'activeCorporateIds'    => array_map( 'intval', array_keys( $accounts ) ),
		'hiddenSources'         => $signals['hiddenSources'],
		'slotsShownToday'       => $signals['slotsShownToday'],
		'slotEligibleUsedToday' => array(),
	);
	$user = array(
		'id'                => $user_id,
		'watchlist'         => $signals['watchlist'],
		'onboardingProfile' => $signals['onboardingProfile'],
	);

	/* never offer something this member hid, item by item */
	$candidates = sml_cs_candidates( $now_ms );
	if ( $candidates && function_exists( 'sml_fs_hidden_refs' ) ) {
		$hidden = array_flip( sml_fs_hidden_refs( $user_id, array_column( $candidates, 'id' ) ) );
		$candidates = array_values( array_filter( $candidates, function ( $c ) use ( $hidden ) { return ! isset( $hidden[ $c['id'] ] ); } ) );
	}

	$pick = sml_cs_select( $candidates, $user, $context, $now_ms, $policy );
	if ( ! $pick ) {
		sml_cs_record_outcome( 'no_candidates', $now_ms );
		return $respond( array( 'slot' => null, 'reason' => 'no_candidates' ) );
	}

	sml_cs_record_outcome( 'served', $now_ms );
	$author  = (int) $pick['corporateId'];
	$account = $accounts[ $author ] ?? array();
	$card    = function_exists( 'sml_fs_member_card' ) ? sml_fs_member_card( $author ) : null;
	return $respond( array(
		'slot'     => array(
			'ref'         => $pick['id'],
			'title'       => $pick['title'],
			'url'         => $pick['url'],
			'excerpt'     => $pick['excerpt'],
			'image'       => $pick['image'],
			'publishedAt' => $pick['publishedAt'],
			'tickers'     => $pick['tickers'],
			'author'      => array(
				'id'       => $author,
				'name'     => (string) ( $account['name'] ?? ( $card['name'] ?? '' ) ),
				'handle'   => $card['handle'] ?? '',
				'avatar'   => $card['avatar'] ?? '',
				'url'      => $card['url'] ?? '',
				'category' => (string) ( $account['category'] ?? 'other' ),
			),
		),
		'reason'   => null,
		'position' => SML_CS_SLOT_INDEX,
	) );
}

/** GET /sml-feed/v1/slot/stats — admins: daily outcomes and slot impressions, 14 days. */
function sml_cs_rest_stats( WP_REST_Request $request ) {
	global $wpdb;
	$since = gmdate( 'Y-m-d', time() - 13 * DAY_IN_SECONDS );
	$outcomes = $wpdb->get_results( $wpdb->prepare( 'SELECT day, outcome, n FROM ' . sml_cs_outcomes_table() . ' WHERE day >= %s ORDER BY day DESC, outcome', $since ), ARRAY_A );
	$slot_imps = $wpdb->get_results( $wpdb->prepare(
		"SELECT day, author_id, SUM(impressions) AS impressions, COUNT(DISTINCT user_id) AS members FROM " . sml_fs_impressions_table() . " WHERE surface = 'slot' AND day >= %s GROUP BY day, author_id ORDER BY day DESC",
		$since
	), ARRAY_A );
	return rest_ensure_response( array( 'mode' => sml_cs_mode(), 'outcomes' => $outcomes, 'slotImpressions' => $slot_imps ) );
}

add_action( 'rest_api_init', function () {
	register_rest_route( SML_FS_NS, '/slot', array( 'methods' => 'GET', 'callback' => 'sml_cs_rest_slot', 'permission_callback' => 'sml_fs_logged_in' ) );
	register_rest_route( SML_FS_NS, '/slot/stats', array( 'methods' => 'GET', 'callback' => 'sml_cs_rest_stats',
		'permission_callback' => function () { return current_user_can( 'manage_options' ); } ) );
} );
