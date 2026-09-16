<?php
/**
 * Onboarding step 2 — follow 5 of 15 recommended accounts, then the personalized five
 * (people you may know: followers not yet followed back, the trader recommender,
 * creators as backfill).
 *
 * buildCardPool() and validateSelection() are a PORT of
 * services/sml-platform/platform/corporate-onboarding.js. follow-fixtures.json is
 * generated from that module and the PHP test fails on divergence.
 *
 * THE POOL (design §7.2): at most 3 corporate accounts matched to the member's
 * questionnaire categories, SML News plus the most active news desk, then real
 * creators ranked by followers and recent activity. Corporate is capped at 3 of
 * 15 inside the builder, so no input can turn the screen into an ad unit.
 *
 * WHO COUNTS AS A CREATOR. Automated news desks carry usermeta
 * sml_author_persona. They appear ONLY in the two news slots, labelled as news —
 * never in the creator slots, where recommending a bot as a person is a bad first
 * impression. A creator must have followers or published something in 90 days, so
 * an empty account is never recommended.
 *
 * FOLLOWING uses the site's own route, POST /sml-members/v1/follow, so follower
 * lists and the "followed you" notification behave exactly as a click on a profile.
 * Only accounts this member was actually offered can be followed here — otherwise
 * the step would be an arbitrary "make me follow anyone" endpoint.
 *
 * THIN POOLS. This site has few active creators, so the pool is often under 15.
 * The Node rule requires 5 selections; the route requires min(5, cards offered) so
 * a short pool can never trap a new member on this step. The ported functions stay
 * exact; only the route applies that floor.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

const SML_OB_POOL_SIZE        = 15;
const SML_OB_MAX_CORPORATE    = 3;
const SML_OB_REQUIRED         = 5;
const SML_OB_SML_NEWS_LOGIN   = 'stockmarketloop';
const SML_OB_FOLLOW_META      = 'sml_feed_onboarding_follow';

/** Number(value) as JavaScript evaluates it, for the value shapes JSON can carry. */
function sml_ob_js_number( $value ) {
	if ( null === $value ) return 0.0;
	if ( is_bool( $value ) ) return $value ? 1.0 : 0.0;
	if ( is_int( $value ) || is_float( $value ) ) return (float) $value;
	if ( is_string( $value ) ) {
		$t = trim( $value );
		if ( '' === $t ) return 0.0;
		return is_numeric( $t ) ? (float) $t : NAN;
	}
	return NAN;   /* arrays and objects */
}

/** cardKey(): a safe positive integer user id, or null. */
function sml_ob_card_key( $card ) {
	if ( ! is_array( $card ) || ! array_key_exists( 'wpUserId', $card ) ) return null;
	$n = sml_ob_js_number( $card['wpUserId'] );
	if ( is_nan( $n ) || floor( $n ) !== $n || $n <= 0 || $n > 9007199254740991 ) return null;
	return (int) $n;
}

/** buildCardPool() — exact port. */
function sml_ob_build_card_pool( array $input, array $opts = array() ) {
	$size          = $opts['size'] ?? SML_OB_POOL_SIZE;
	$max_corporate = $opts['maxCorporate'] ?? SML_OB_MAX_CORPORATE;
	$profile       = is_array( $input['profile'] ?? null ) ? $input['profile'] : array();
	$affinity      = is_array( $profile['categoryAffinity'] ?? null ) ? $profile['categoryAffinity'] : array();

	$used = array();
	$out  = array();
	$take = function ( $card, $source ) use ( &$used, &$out ) {
		$id = sml_ob_card_key( $card );
		if ( null === $id || isset( $used[ $id ] ) ) return false;
		$used[ $id ] = true;
		$card['wpUserId'] = $id;
		$card['source']   = $source;
		$out[] = $card;
		return true;
	};

	$corporate = array();
	foreach ( is_array( $input['corporate'] ?? null ) ? $input['corporate'] : array() as $c ) {
		if ( ! is_array( $c ) || ( array_key_exists( 'active', $c ) && false === $c['active'] ) ) continue;
		/* Number(affinity[category] || 0): a falsy value is 0, a non-numeric string is NaN */
		$raw = $affinity[ $c['category'] ?? 'undefined' ] ?? 0;
		$corporate[] = array( 'card' => $c, 'fit' => $raw ? sml_ob_js_number( $raw ) : 0.0 );
	}
	usort( $corporate, function ( $a, $b ) {
		$d = $b['fit'] - $a['fit'];   /* NaN is falsy in JS: fall through to the id */
		if ( ! is_nan( $d ) && 0.0 !== $d ) return $d < 0 ? -1 : 1;
		return (int) sml_ob_card_key( $a['card'] ) <=> (int) sml_ob_card_key( $b['card'] );
	} );

	$placed = 0;
	foreach ( $corporate as $entry ) {
		if ( $placed >= $max_corporate || count( $out ) >= $size ) break;
		if ( $take( $entry['card'], 'corporate' ) ) $placed++;
	}
	foreach ( is_array( $input['news'] ?? null ) ? $input['news'] : array() as $card ) {
		if ( count( $out ) >= $size ) break;
		$take( $card, 'news' );
	}
	foreach ( is_array( $input['creators'] ?? null ) ? $input['creators'] : array() as $card ) {
		if ( count( $out ) >= $size ) break;
		$take( $card, 'creator' );
	}

	return array(
		'cards'              => $out,
		'corporateCount'     => $placed,
		'short'              => count( $out ) < $size,
		'requiredSelections' => SML_OB_REQUIRED,
	);
}

/** validateSelection() — exact port. */
function sml_ob_validate_selection( $selected, array $pool ) {
	$offered = array();
	foreach ( $pool as $card ) {
		$id = sml_ob_card_key( $card );
		if ( null !== $id ) $offered[ $id ] = true;
	}
	$chosen = array();
	$list   = ( is_array( $selected ) && array_keys( $selected ) === range( 0, count( $selected ) - 1 ) ) || array() === $selected ? $selected : array();
	foreach ( $list as $raw ) {
		$n = sml_ob_js_number( $raw );
		if ( is_nan( $n ) || floor( $n ) !== $n || $n <= 0 || $n > 9007199254740991 ) continue;
		$id = (int) $n;
		if ( isset( $offered[ $id ] ) && ! in_array( $id, $chosen, true ) ) $chosen[] = $id;
	}
	return array( 'selected' => $chosen, 'ok' => count( $chosen ) >= SML_OB_REQUIRED, 'required' => SML_OB_REQUIRED );
}

/* ================================================================= inputs */

function sml_ob_is_persona( $user_id ) {
	return metadata_exists( 'user', (int) $user_id, 'sml_author_persona' );
}

function sml_ob_id_list( $raw ) {
	return array_values( array_unique( array_filter( array_map( 'intval', is_array( $raw ) ? $raw : array() ) ) ) );
}

/**
 * The three input lists for this member, before the builder applies the rules.
 * Self and accounts already followed are removed from every list.
 */
function sml_ob_pool_inputs( $user_id ) {
	global $wpdb;
	$user_id   = (int) $user_id;
	$following = array_flip( sml_ob_id_list( get_user_meta( $user_id, 'sml_following', true ) ) );
	$skip      = function ( $id ) use ( $user_id, $following ) { return $id === $user_id || isset( $following[ $id ] ); };

	/* corporate: the active projection */
	$corporate = array();
	foreach ( ( function_exists( 'sml_cs_accounts' ) ? sml_cs_accounts() : array() ) as $id => $account ) {
		$id = (int) $id;
		if ( $id > 0 && ! $skip( $id ) ) $corporate[] = array( 'wpUserId' => $id, 'category' => (string) ( $account['category'] ?? 'other' ), 'active' => true );
	}

	/* news: SML News, then the news desk with the most posts this week */
	$news     = array();
	$sml_news = get_user_by( 'login', SML_OB_SML_NEWS_LOGIN );
	if ( $sml_news && ! $skip( (int) $sml_news->ID ) ) $news[] = array( 'wpUserId' => (int) $sml_news->ID );
	$desk = $wpdb->get_var( $wpdb->prepare(
		"SELECT p.post_author FROM {$wpdb->posts} p
		   JOIN {$wpdb->usermeta} m ON m.user_id = p.post_author AND m.meta_key = 'sml_author_persona'
		  WHERE p.post_type = 'post' AND p.post_status = 'publish' AND p.post_date_gmt >= %s AND p.post_author <> %d
		  GROUP BY p.post_author ORDER BY COUNT(*) DESC LIMIT 1",
		gmdate( 'Y-m-d H:i:s', time() - 7 * DAY_IN_SECONDS ), $sml_news ? (int) $sml_news->ID : 0
	) );
	if ( $desk && ! $skip( (int) $desk ) ) $news[] = array( 'wpUserId' => (int) $desk );

	/* creators: real people with followers or recent content, ranked */
	$since    = gmdate( 'Y-m-d H:i:s', time() - 90 * DAY_IN_SECONDS );
	$activity = array();
	foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT post_author AS id, MAX(post_date_gmt) AS at FROM {$wpdb->posts} WHERE post_type = 'post' AND post_status = 'publish' AND post_date_gmt >= %s GROUP BY post_author", $since ) ) as $r ) $activity[ (int) $r->id ] = max( $activity[ (int) $r->id ] ?? '', $r->at );
	$gp = $wpdb->prefix . 'sml_group_posts';
	if ( function_exists( 'sml_fs_table_exists' ) && sml_fs_table_exists( $gp ) ) {
		foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT user_id AS id, MAX(created_at) AS at FROM $gp WHERE created_at >= %s GROUP BY user_id", $since ) ) as $r ) $activity[ (int) $r->id ] = max( $activity[ (int) $r->id ] ?? '', $r->at );
	}
	foreach ( (array) $wpdb->get_col( "SELECT user_id FROM {$wpdb->usermeta} WHERE meta_key = 'sml_profile_chart_posts' AND LENGTH(meta_value) > 10" ) as $id ) $activity[ (int) $id ] = $activity[ (int) $id ] ?? '1970-01-01 00:00:00';
	foreach ( (array) $wpdb->get_col( "SELECT user_id FROM {$wpdb->usermeta} WHERE meta_key = 'sml_followers' AND LENGTH(meta_value) > 6" ) as $id ) $activity[ (int) $id ] = $activity[ (int) $id ] ?? '1970-01-01 00:00:00';

	/* an account sharing a news desk's name would read as a duplicate of it */
	$news_names = array();
	foreach ( $news as $n ) { $u = get_userdata( $n['wpUserId'] ); if ( $u ) $news_names[ strtolower( trim( $u->display_name ) ) ] = true; }

	$creators = array();
	foreach ( $activity as $id => $at ) {
		if ( $id <= 0 || $skip( $id ) || sml_ob_is_persona( $id ) ) continue;
		$u = get_userdata( $id );
		if ( ! $u || isset( $news_names[ strtolower( trim( $u->display_name ) ) ] ) ) continue;
		$creators[] = array( 'wpUserId' => $id, 'followers' => count( sml_ob_id_list( get_user_meta( $id, 'sml_followers', true ) ) ), 'activeAt' => $at );
	}
	usort( $creators, function ( $a, $b ) {
		if ( $a['followers'] !== $b['followers'] ) return $b['followers'] <=> $a['followers'];
		return strcmp( $b['activeAt'], $a['activeAt'] );
	} );

	$onboarding = get_user_meta( $user_id, SML_FS_ONBOARDING_META, true );
	return (array) apply_filters( 'sml_ob_pool_inputs', array(
		'corporate' => $corporate,
		'news'      => $news,
		'creators'  => array_slice( $creators, 0, 40 ),
		'profile'   => is_array( $onboarding ) ? ( $onboarding['profile'] ?? array() ) : array(),
	), $user_id );
}

/* ================================================================= routes */

function sml_ob_describe( array $card ) {
	$id    = (int) $card['wpUserId'];
	$base  = function_exists( 'sml_fs_member_card' ) ? sml_fs_member_card( $id ) : null;
	if ( ! $base ) return null;
	$followers = count( sml_ob_id_list( get_user_meta( $id, 'sml_followers', true ) ) );
	$label = 'corporate' === $card['source'] ? 'Corporate'
		: ( 'news' === $card['source'] ? 'News' : ( 1 === $followers ? '1 follower' : $followers . ' followers' ) );
	return array_merge( $base, array( 'source' => $card['source'], 'label' => $label, 'followers' => $followers ) );
}

function sml_ob_rest_pool( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$pool    = sml_ob_build_card_pool( sml_ob_pool_inputs( $user_id ) );
	$cards   = array_values( array_filter( array_map( 'sml_ob_describe', $pool['cards'] ) ) );
	/* what was offered is what may be followed */
	set_transient( 'sml_ob_pool_' . $user_id, array_column( $cards, 'id' ), 30 * MINUTE_IN_SECONDS );
	$res = rest_ensure_response( array(
		'cards'    => $cards,
		'required' => min( SML_OB_REQUIRED, count( $cards ) ),
		'short'    => count( $cards ) < SML_OB_POOL_SIZE,
	) );
	$res->header( 'Cache-Control', 'no-store, private' );
	return $res;
}

function sml_ob_rest_follow( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	if ( ! sml_fs_rate_ok( $user_id, 'obf', 10, HOUR_IN_SECONDS ) ) return sml_fs_error( 'sml_fs_rate', 'Too many attempts — try again later.', 429 );

	$offered = get_transient( 'sml_ob_pool_' . $user_id );
	if ( ! is_array( $offered ) ) return sml_fs_error( 'sml_ob_expired', 'Those suggestions expired. Please reload them.', 409 );
	$pool      = array_map( function ( $id ) { return array( 'wpUserId' => $id ); }, $offered );
	$selection = sml_ob_validate_selection( $request->get_param( 'userIds' ), $pool );
	$required  = min( SML_OB_REQUIRED, count( $offered ) );
	if ( count( $selection['selected'] ) < $required ) {
		return new WP_Error( 'sml_ob_too_few', sprintf( 'Pick at least %d to follow.', $required ), array( 'status' => 422, 'required' => $required ) );
	}

	$followed = array();
	foreach ( $selection['selected'] as $target ) {
		$follow = new WP_REST_Request( 'POST', '/sml-members/v1/follow' );
		$follow->set_param( 'user_id', $target );
		$follow->set_param( 'action', 'follow' );
		$res = rest_do_request( $follow );
		if ( ! $res->is_error() && 200 === $res->get_status() ) $followed[] = $target;
	}
	update_user_meta( $user_id, SML_OB_FOLLOW_META, array( 'completed_at' => gmdate( 'c' ), 'followed' => $followed, 'offered' => array_map( 'intval', $offered ) ) );
	delete_transient( 'sml_ob_pool_' . $user_id );
	return rest_ensure_response( array( 'followed' => $followed, 'count' => count( $followed ) ) );
}

/* ================================================= the personalized five */

/** JavaScript truthiness for a JSON-decoded value. */
function sml_ob_js_truthy( $value ) {
	if ( is_string( $value ) ) return '' !== $value;          /* "0" is truthy in JS */
	if ( is_float( $value ) ) return 0.0 !== $value && ! is_nan( $value );
	if ( is_array( $value ) ) return true;                    /* [] and {} are truthy */
	return (bool) $value;
}

/**
 * personalizedFive() — exact port. Friends, then trader suggestions, then
 * creators as backfill; automated accounts are never offered as people, and
 * anything in `exclude` (the pool, accounts already followed) is not repeated.
 */
function sml_ob_personalized_five( array $input, array $opts = array() ) {
	$size = $opts['size'] ?? SML_OB_REQUIRED;
	$used = array();
	foreach ( is_array( $input['exclude'] ?? null ) && array_is_list( $input['exclude'] ) ? $input['exclude'] : array() as $raw ) {
		$n = sml_ob_js_number( $raw );
		if ( ! is_nan( $n ) && 0.0 !== $n ) $used[ (string) $n ] = true;   /* .map(Number).filter(Boolean) */
	}
	$out = array();
	$consider = function ( $list, $source ) use ( &$used, &$out, $size ) {
		foreach ( is_array( $list ) && array_is_list( $list ) ? $list : array() as $card ) {
			if ( count( $out ) >= $size ) return;
			$id = sml_ob_card_key( $card );
			if ( null === $id || isset( $used[ (string) (float) $id ] ) ) continue;
			if ( sml_ob_js_truthy( $card['isAutomated'] ?? null ) ) continue;
			$used[ (string) (float) $id ] = true;
			$card['wpUserId'] = $id;
			$card['source']   = $source;
			$out[] = $card;
		}
	};
	$consider( $input['friends'] ?? null, 'friends' );
	$consider( $input['traderSuggest'] ?? null, 'trader_suggest' );
	$consider( $input['creators'] ?? null, 'creator_backfill' );
	return array( 'cards' => $out, 'short' => count( $out ) < $size );
}

/**
 * The live inputs.
 *   friends        people who already follow this member and are not followed
 *                  back — following them makes them friends (friends = mutual follow)
 *   traderSuggest  /sml-recs/v1/suggest, the transparent recommender; it fails
 *                  closed (photo gate, opt-out, no shared groups) and returns []
 *   creators       the same ranked creator list the pool uses
 * Excluded: self, everyone already followed, and every card the pool offered.
 */
function sml_ob_five_inputs( $user_id ) {
	$user_id   = (int) $user_id;
	$following = sml_ob_id_list( get_user_meta( $user_id, 'sml_following', true ) );
	$done      = get_user_meta( $user_id, SML_OB_FOLLOW_META, true );
	$offered   = is_array( $done ) ? sml_ob_id_list( $done['offered'] ?? array() ) : array();
	$pending   = get_transient( 'sml_ob_pool_' . $user_id );
	$exclude   = array_values( array_unique( array_merge( array( $user_id ), $following, $offered, is_array( $pending ) ? sml_ob_id_list( $pending ) : array() ) ) );
	$automated = function ( $id ) { return sml_ob_is_persona( $id ); };

	$friends = array();
	foreach ( array_reverse( sml_ob_id_list( get_user_meta( $user_id, 'sml_followers', true ) ) ) as $id ) {
		$friends[] = array( 'wpUserId' => $id, 'isAutomated' => $automated( $id ) );
	}

	$trader = array();
	$req = new WP_REST_Request( 'GET', '/sml-recs/v1/suggest' );
	$req->set_param( 'surface', 'connect' );
	$req->set_param( 'limit', 10 );
	$res = rest_do_request( $req );
	if ( ! $res->is_error() && 200 === $res->get_status() ) {
		$data = $res->get_data();
		foreach ( is_array( $data['items'] ?? null ) ? $data['items'] : array() as $item ) {
			$id = (int) ( $item['user_id'] ?? 0 );
			if ( $id > 0 ) $trader[] = array( 'wpUserId' => $id, 'reason' => (string) ( $item['reason'] ?? '' ), 'isAutomated' => $automated( $id ) );
		}
	}

	$creators = array();
	foreach ( sml_ob_pool_inputs( $user_id )['creators'] as $c ) $creators[] = array( 'wpUserId' => $c['wpUserId'], 'isAutomated' => false );

	return (array) apply_filters( 'sml_ob_five_inputs', array( 'friends' => $friends, 'traderSuggest' => $trader, 'creators' => $creators, 'exclude' => $exclude ), $user_id );
}

function sml_ob_rest_five( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$five    = sml_ob_personalized_five( sml_ob_five_inputs( $user_id ) );
	$cards   = array();
	foreach ( $five['cards'] as $c ) {
		$card = sml_ob_describe( array( 'wpUserId' => $c['wpUserId'], 'source' => 'creator' ) );
		if ( ! $card ) continue;
		$card['source'] = $c['source'];
		if ( 'friends' === $c['source'] ) $card['label'] = 'Follows you';
		elseif ( 'trader_suggest' === $c['source'] && '' !== trim( $c['reason'] ?? '' ) ) $card['label'] = wp_strip_all_tags( $c['reason'] );
		$cards[] = $card;
	}
	set_transient( 'sml_ob_five_' . $user_id, array_column( $cards, 'id' ), 30 * MINUTE_IN_SECONDS );
	$res = rest_ensure_response( array( 'cards' => $cards ) );
	$res->header( 'Cache-Control', 'no-store, private' );
	return $res;
}

/** Follow one card from the five. Only a card this member was shown. */
function sml_ob_rest_five_follow( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$target  = (int) $request->get_param( 'userId' );
	$offered = get_transient( 'sml_ob_five_' . $user_id );
	if ( ! is_array( $offered ) ) return sml_fs_error( 'sml_ob_expired', 'Those suggestions expired. Please reload them.', 409 );
	if ( $target <= 0 || ! in_array( $target, array_map( 'intval', $offered ), true ) ) return sml_fs_error( 'sml_ob_not_offered', 'That account was not suggested to you.', 422 );
	if ( ! sml_fs_rate_ok( $user_id, 'ob5', 20, HOUR_IN_SECONDS ) ) return sml_fs_error( 'sml_fs_rate', 'Too many attempts — try again later.', 429 );

	$follow = new WP_REST_Request( 'POST', '/sml-members/v1/follow' );
	$follow->set_param( 'user_id', $target );
	$follow->set_param( 'action', 'follow' );
	$res = rest_do_request( $follow );
	if ( $res->is_error() || 200 !== $res->get_status() ) return sml_fs_error( 'sml_ob_follow_failed', 'Couldn’t follow right now. Please try again.', 502 );
	return rest_ensure_response( array( 'following' => true, 'userId' => $target ) );
}

add_action( 'rest_api_init', function () {
	register_rest_route( SML_FS_NS, '/onboarding/follow-pool', array( 'methods' => 'GET', 'callback' => 'sml_ob_rest_pool', 'permission_callback' => 'sml_fs_logged_in' ) );
	register_rest_route( SML_FS_NS, '/onboarding/follow', array( 'methods' => 'POST', 'callback' => 'sml_ob_rest_follow', 'permission_callback' => 'sml_fs_logged_in' ) );
	register_rest_route( SML_FS_NS, '/onboarding/five', array( 'methods' => 'GET', 'callback' => 'sml_ob_rest_five', 'permission_callback' => 'sml_fs_logged_in' ) );
	register_rest_route( SML_FS_NS, '/onboarding/five/follow', array( 'methods' => 'POST', 'callback' => 'sml_ob_rest_five_follow', 'permission_callback' => 'sml_fs_logged_in' ) );
} );
