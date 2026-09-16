<?php
/**
 * Plugin Name: SML Watchlist Hot Ticker Comments
 * Description: Surfaces HOT ticker-terminal comments for the symbols on a member's watchlist into their news feed. A terminal "Trader Discussion" message is a WP comment on the /stock-chart/ page, encoded "SMLTICKER|<SYM>|<uid>|<text>", with engagement in comment meta (sml_stream_like_user_ids / _upvote_ / _downvote_). Only comments scoring >= the hot threshold (default 6/10) are returned. Owner rule 2026-09-15.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) { exit; }

/* The single page that owns the terminal comment thread (slug "stock-chart"). */
function sml_wthc_terminal_post_id() {
	static $id = null;
	if ($id !== null) { return $id; }
	$p = get_page_by_path('stock-chart');
	$id = $p ? (int) $p->ID : (int) apply_filters('sml_wthc_fallback_post_id', 1929);
	return $id;
}

/* 0..10 hotness from likes + upvotes + replies, cooled by downvotes. Configurable. */
function sml_wthc_score($comment_id) {
	$comment_id = (int) $comment_id;
	$uniq = function ($meta_key) use ($comment_id) {
		$v = get_comment_meta($comment_id, $meta_key, true);
		if (!is_array($v)) { $v = maybe_unserialize($v); }
		if (!is_array($v)) { return 0; }
		return count(array_unique(array_filter(array_map('absint', $v))));
	};
	$likes = $uniq('sml_stream_like_user_ids');
	$ups   = $uniq('sml_stream_upvote_user_ids');
	$downs = $uniq('sml_stream_downvote_user_ids');
	$replies = (int) get_comments(array(
		'parent'  => $comment_id,
		'status'  => 'approve',
		'count'   => true,
	));

	$w_vote  = max(1, (int) apply_filters('sml_wthc_w_vote',  (int) get_option('sml_watch_hot_w_vote', 2)));
	$w_reply = max(1, (int) apply_filters('sml_wthc_w_reply', (int) get_option('sml_watch_hot_w_reply', 3)));

	$pts = (($likes + $ups) * $w_vote) + ($replies * $w_reply) - $downs;
	if ($pts < 0) { $pts = 0; }
	if ($pts > 10) { $pts = 10; }
	return array('score' => (int) $pts, 'likes' => $likes, 'upvotes' => $ups, 'downvotes' => $downs, 'replies' => $replies);
}

/* Parse a stream comment body: "SMLTICKER|SYM|uid|text" -> [sym, uid, text] or null. */
function sml_wthc_parse($body) {
	$body = (string) $body;
	if (strpos($body, 'SMLTICKER|') !== 0) { return null; }
	$parts = explode('|', $body, 4);
	if (count($parts) < 4) { return null; }
	$sym = strtoupper(preg_replace('/[^A-Z0-9.\-]/i', '', $parts[1]));
	$uid = absint($parts[2]);
	$text = trim($parts[3]);
	if ($sym === '' || $text === '') { return null; }
	return array('symbol' => $sym, 'uid' => $uid, 'text' => $text);
}

function sml_wthc_rest(WP_REST_Request $req) {
	$post_id = sml_wthc_terminal_post_id();
	$min = (int) apply_filters('sml_wthc_min_score', (int) get_option('sml_watch_hot_min_score', 6));

	/* the symbols to look for: the query param, else the caller's account watchlist */
	$want = array();
	$raw = (string) $req->get_param('symbols');
	if ($raw !== '') {
		foreach (explode(',', $raw) as $s) {
			$s = strtoupper(preg_replace('/[^A-Z0-9.\-]/i', '', $s));
			if ($s !== '') { $want[$s] = 1; }
		}
	}
	$viewer = get_current_user_id();
	if (empty($want) && $viewer && function_exists('sml_members_get_watchlist')) {
		foreach ((array) sml_members_get_watchlist($viewer) as $s) {
			$s = strtoupper(preg_replace('/[^A-Z0-9.\-]/i', '', (string) $s));
			if ($s !== '') { $want[$s] = 1; }
		}
	}
	if (empty($want) || !$post_id) {
		return rest_ensure_response(array('ok' => true, 'items' => array(), 'min_score' => $min));
	}
	/* cap how many symbols we scan per call */
	$want = array_slice($want, 0, 24, true);

	/* pull recent top-level terminal comments once, filter in PHP */
	$comments = get_comments(array(
		'post_id' => $post_id,
		'status'  => 'approve',
		'parent'  => 0,
		'number'  => 400,
		'orderby' => 'comment_date_gmt',
		'order'   => 'DESC',
	));

	$items = array();
	foreach ($comments as $c) {
		$p = sml_wthc_parse($c->comment_content);
		if (!$p || empty($want[$p['symbol']])) { continue; }
		$sc = sml_wthc_score($c->comment_ID);
		if ($sc['score'] < $min) { continue; }

		$author_id = $p['uid'] ?: (int) $c->user_id;
		$name = $author_id ? get_the_author_meta('display_name', $author_id) : '';
		if ($name === '') { $name = $c->comment_author ?: 'Trader'; }
		$avatar = $author_id ? get_avatar_url($author_id, array('size' => 64)) : get_avatar_url($c->comment_author_email, array('size' => 64));
		$handle = $author_id ? get_the_author_meta('user_login', $author_id) : '';

		$items[] = array(
			'id'        => 'ttc-' . $p['symbol'] . '-' . (int) $c->comment_ID,
			'symbol'    => $p['symbol'],
			'commentId' => (int) $c->comment_ID,
			'author'    => $name,
			'authorId'  => $author_id,
			'handle'    => $handle,
			'avatar'    => $avatar,
			'body'      => mb_substr($p['text'], 0, 500),
			'url'       => home_url('/stock-chart/?symbol=' . rawurlencode($p['symbol']) . '#tv2lf-' . (int) $c->comment_ID),
			'date'      => get_comment_date('c', $c),
			'ts'        => (int) strtotime($c->comment_date_gmt . ' UTC'),
			'score'     => $sc['score'],
			'likes'     => $sc['likes'] + $sc['upvotes'],
			'replies'   => $sc['replies'],
		);
	}

	/* hottest first, then newest; one card per symbol so no single ticker floods the feed */
	usort($items, function ($a, $b) {
		if ($b['score'] !== $a['score']) { return $b['score'] - $a['score']; }
		return $b['ts'] - $a['ts'];
	});
	$per_symbol = array();
	$out = array();
	foreach ($items as $it) {
		$s = $it['symbol'];
		if (!empty($per_symbol[$s])) { continue; }   /* top-scoring one per symbol */
		$per_symbol[$s] = 1;
		$out[] = $it;
		if (count($out) >= 12) { break; }
	}

	return rest_ensure_response(array('ok' => true, 'items' => array_values($out), 'min_score' => $min));
}

add_action('rest_api_init', function () {
	register_rest_route('sml-watch/v1', '/hot-comments', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'callback'            => 'sml_wthc_rest',
		'args'                => array(
			'symbols' => array('type' => 'string', 'required' => false),
		),
	));
});
