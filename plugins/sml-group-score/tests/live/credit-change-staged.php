<?php
global $wpdb; $P = $wpdb->prefix; $fails = 0;
function t_ok( $c, $l ) { global $fails; echo ( $c ? 'PASS ' : 'FAIL ' ) . $l . PHP_EOL; if ( ! $c ) $fails++; }
$A = 258456547; $B = 258456545; $G = 7;
$q = 0; $c = 0;
$wpdb->query( 'START TRANSACTION' );
try {
	$gmt = gmdate( 'Y-m-d H:i:s' ); $loc = current_time( 'mysql' );
	$wpdb->insert( $wpdb->posts, array( 'post_author' => $B, 'post_title' => 'credit ui test', 'post_name' => 'gs-credit-ui-test', 'post_type' => 'sml_question', 'post_status' => 'publish', 'post_date' => $loc, 'post_date_gmt' => $gmt, 'post_modified' => $loc, 'post_modified_gmt' => $gmt, 'post_content' => 'x', 'post_excerpt' => '', 'to_ping' => '', 'pinged' => '', 'post_content_filtered' => '' ) );
	$q = (int) $wpdb->insert_id;
	$wpdb->insert( $wpdb->comments, array( 'comment_post_ID' => $q, 'user_id' => $A, 'comment_type' => SML_QA_ANSWER_TYPE, 'comment_approved' => '1', 'comment_date' => $loc, 'comment_date_gmt' => $gmt, 'comment_content' => 'answer', 'comment_author' => 't', 'comment_author_email' => '', 'comment_author_url' => '', 'comment_author_IP' => '', 'comment_agent' => '' ) );
	$c = (int) $wpdb->insert_id; clean_post_cache( $q ); clean_comment_cache( $c );

	$req = function ( $method, $route, $params, $uid ) { wp_set_current_user( $uid ); $r = new WP_REST_Request( $method, $route ); foreach ( $params as $k => $v ) $r->set_param( $k, $v ); $res = rest_do_request( $r ); return array( $res->get_status(), $res->get_data() ); };
	$pick = function ( $groups, $gid ) { foreach ( (array) $groups as $g ) { if ( (int) $g['id'] === $gid ) return $g; } return null; };

	list( $st, $d ) = $req( 'GET', '/sml-group-score/v1/qa-credits', array( 'question_id' => $q ), $A );
	t_ok( 200 === $st && isset( $d['mine']['answers'][ (string) $c ] ) && null === $d['mine']['question'], 'author sees their answer in mine, not the question' );
	$m = $d['mine']['answers'][ (string) $c ];
	t_ok( 'self' === $m['credit'] && false === $m['locked'], 'default credit self, unlocked' );
	$g = $pick( $m['groups'], $G );
	t_ok( $g && true === $g['eligible'], 'long-standing group offered as eligible' );
	list( $st, $d ) = $req( 'GET', '/sml-group-score/v1/qa-credits', array( 'question_id' => $q ), $B );
	t_ok( empty( $d['mine']['answers'] ) && 'self' === $d['mine']['question']['credit'], 'asker sees only their question' );
	list( $st, $d ) = $req( 'GET', '/sml-group-score/v1/qa-credits', array( 'question_id' => $q ), 0 );
	t_ok( null === $d['mine']['question'] && empty( $d['mine']['answers'] ), 'signed out: nothing in mine' );

	list( $st, $d ) = $req( 'POST', '/sml-group-score/v1/qa-credit', array( 'object_type' => 'answer', 'object_id' => $c, 'credit' => 'group:' . $G ), $B );
	t_ok( 403 === $st, 'someone else cannot change it (' . $st . ')' );
	list( $st, $d ) = $req( 'POST', '/sml-group-score/v1/qa-credit', array( 'object_type' => 'answer', 'object_id' => $c, 'credit' => 'group:999999' ), $A );
	t_ok( 422 === $st, 'non-member group rejected (' . $st . ')' );
	list( $st, $d ) = $req( 'POST', '/sml-group-score/v1/qa-credit', array( 'object_type' => 'answer', 'object_id' => $c, 'credit' => 'group:' . $G ), $A );
	t_ok( 200 === $st && 'group' === $d['credit'] && $G === (int) $d['group']['id'], 'author switches to group' );
	$row = sml_gs_credit_row( 'answer', $c );
	t_ok( $row && abs( strtotime( $row['posted_at'] . ' UTC' ) - strtotime( $gmt . ' UTC' ) ) < 5, 'posted_at kept at original posting time' );
	list( $st, $d ) = $req( 'GET', '/sml-group-score/v1/qa-credits', array( 'question_id' => $q ), 0 );
	t_ok( isset( $d['answers'][ (string) $c ] ) && $G === (int) $d['answers'][ (string) $c ]['id'], 'public chip shows the group' );
	list( $st, $d ) = $req( 'POST', '/sml-group-score/v1/qa-credit', array( 'object_type' => 'answer', 'object_id' => $c, 'credit' => 'self' ), $A );
	t_ok( 200 === $st && 'self' === $d['credit'], 'author switches back to self' );

	$wpdb->query( $wpdb->prepare( "UPDATE {$P}sml_gs_qa_credit SET posted_at = %s WHERE object_type='answer' AND object_id=%d", gmdate( 'Y-m-d H:i:s', time() - 4000 * DAY_IN_SECONDS ), $c ) );
	list( $st, $d ) = $req( 'POST', '/sml-group-score/v1/qa-credit', array( 'object_type' => 'answer', 'object_id' => $c, 'credit' => 'group:' . $G ), $A );
	t_ok( 422 === $st && 'sml_gs_too_new' === ( $d['code'] ?? '' ), 'group joined after posting refused (' . $st . ')' );
	list( $st, $d ) = $req( 'GET', '/sml-group-score/v1/qa-credits', array( 'question_id' => $q ), $A );
	$g = $pick( $d['mine']['answers'][ (string) $c ]['groups'], $G );
	t_ok( $g && false === $g['eligible'], 'menu marks that group ineligible' );

	$wpdb->insert( $P . 'sml_gs_qa_rewards', array( 'kind' => 'answer_accepted', 'object_id' => $c, 'status' => 'paid', 'settle_after' => $gmt, 'created_at' => $gmt ) );
	list( $st, $d ) = $req( 'GET', '/sml-group-score/v1/qa-credits', array( 'question_id' => $q ), $A );
	t_ok( true === $d['mine']['answers'][ (string) $c ]['locked'], 'locked once paid' );
	list( $st, $d ) = $req( 'POST', '/sml-group-score/v1/qa-credit', array( 'object_type' => 'answer', 'object_id' => $c, 'credit' => 'self' ), $A );
	t_ok( 409 === $st, 'change refused once paid (' . $st . ')' );
	list( $st, $d ) = $req( 'POST', '/sml-group-score/v1/qa-credit', array( 'object_type' => 'question', 'object_id' => $q, 'credit' => 'self' ), $B );
	t_ok( 200 === $st, 'question credit independent of the answer lock (' . $st . ')' );
} catch ( Throwable $e ) { echo 'ERROR ' . $e->getMessage() . "\n"; $fails++; }
finally {
	$wpdb->query( 'ROLLBACK' ); if ( $q ) clean_post_cache( $q ); if ( $c ) clean_comment_cache( $c ); wp_set_current_user( 0 );
}
t_ok( 0 === (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_name='gs-credit-ui-test'" ), 'rolled back' );
echo $fails ? "FAILURES $fails\n" : "ALL PASS\n";
