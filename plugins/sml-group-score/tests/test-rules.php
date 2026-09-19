<?php
/* php tests/test-rules.php */
define( 'ABSPATH', __DIR__ . '/' );
define( 'DAY_IN_SECONDS', 86400 );
define( 'HOUR_IN_SECONDS', 3600 );
function get_option( $k, $d = false ) { return $d; }
require dirname( __DIR__ ) . '/includes/rules.php';

$passed = 0; $failed = 0;
function ok( $c, $n ) { global $passed, $failed; if ( $c ) $passed++; else { $failed++; echo "FAIL $n\n"; } }
$S = sml_gs_settings();
$now = 1790000000;
function person( $id, $days_old = 60, $verified = true, $persona = false ) { global $now; return array( 'id' => $id, 'registered_ts' => $now - $days_old * 86400, 'email_verified' => $verified, 'persona' => $persona ); }
function kinds( $v ) { return array_column( $v, 'kind' ); }

/* ---------------- people */
ok( sml_gs_person_qualifies( person( 1 ), 7, $now ), 'an established verified member qualifies' );
ok( ! sml_gs_person_qualifies( person( 1, 2 ), 7, $now ), 'a 2-day-old account does not earn' );
ok( ! sml_gs_person_qualifies( person( 1, 60, false ), 7, $now ), 'an unverified email does not earn' );
ok( ! sml_gs_person_qualifies( person( 1, 60, true, true ), 7, $now ), 'an automated desk account never earns' );
ok( ! sml_gs_person_qualifies( null, 7, $now ), 'nobody is nobody' );

/* ---------------- credit */
$posted = $now - 3600;
ok( 'group' === sml_gs_resolve_credit( array( 'kind' => 'group', 'group_id' => 7, 'posted_ts' => $posted ), array( 7 => $posted - 3 * 86400 ), $S )['kind'], 'a member of 3 days can credit their group' );
ok( 'self' === sml_gs_resolve_credit( array( 'kind' => 'group', 'group_id' => 7, 'posted_ts' => $posted ), array( 7 => $posted - 3600 ), $S )['kind'], 'joining an hour before posting cannot credit the group (join-to-farm)' );
ok( 'self' === sml_gs_resolve_credit( array( 'kind' => 'group', 'group_id' => 7, 'posted_ts' => $posted ), array( 9 => $posted - 9e6 ), $S )['kind'], 'crediting a group you are not in falls back to you' );
ok( 'self' === sml_gs_resolve_credit( null, array(), $S )['kind'], 'no choice means you keep the credit' );

/* ---------------- answers */
$base = array( 'approved' => true, 'author' => person( 10 ), 'asker' => person( 20 ), 'accepted' => false, 'voters' => array(), 'credit' => array( 'kind' => 'self' ), 'group_member_ids' => array(), 'asker_in_credited_group' => false, 'now' => $now );
ok( array( 'answer_accepted' ) === kinds( sml_gs_answer_verdict( array_merge( $base, array( 'accepted' => true ) ), $S ) ), 'an answer the asker accepted earns' );
ok( array() === kinds( sml_gs_answer_verdict( array_merge( $base, array( 'accepted' => true, 'asker' => person( 10 ) ) ), $S ) ), 'accepting your own answer earns nothing' );
ok( array() === kinds( sml_gs_answer_verdict( array_merge( $base, array( 'accepted' => true, 'asker' => person( 20, 1 ) ) ), $S ) ), 'a brand-new sock-puppet asker accepting does not pay' );
ok( array() === kinds( sml_gs_answer_verdict( array_merge( $base, array( 'accepted' => true, 'approved' => false ) ), $S ) ), 'an unapproved answer earns nothing' );
ok( array() === kinds( sml_gs_answer_verdict( array_merge( $base, array( 'accepted' => true, 'author' => person( 10, 60, true, true ) ) ), $S ) ), 'desk accounts never earn from answers' );
$v3 = array( person( 31 ), person( 32 ), person( 33 ) );
ok( array( 'answer_voted' ) === kinds( sml_gs_answer_verdict( array_merge( $base, array( 'voters' => $v3 ) ), $S ) ), '3 real upvotes earn' );
ok( array() === kinds( sml_gs_answer_verdict( array_merge( $base, array( 'voters' => array( person( 31 ), person( 32 ), person( 33, 1 ) ) ) ), $S ) ), 'a day-old voter does not count' );
ok( array() === kinds( sml_gs_answer_verdict( array_merge( $base, array( 'voters' => array( person( 31 ), person( 31 ), person( 31 ) ) ) ), $S ) ), 'the same voter three times is one vote' );
ok( array() === kinds( sml_gs_answer_verdict( array_merge( $base, array( 'voters' => array( person( 31 ), person( 32 ), person( 10 ) ) ) ), $S ) ), 'voting for yourself does not count' );
ok( array( 'answer_accepted', 'answer_voted' ) === kinds( sml_gs_answer_verdict( array_merge( $base, array( 'accepted' => true, 'voters' => $v3 ) ), $S ) ), 'accepted and well-voted earn both' );
$g = array( 'credit' => array( 'kind' => 'group', 'group_id' => 7 ), 'group_member_ids' => array( 31, 32 ) );
ok( array() === kinds( sml_gs_answer_verdict( array_merge( $base, $g, array( 'voters' => $v3 ) ), $S ) ), 'group-mates upvoting a group-credited answer do not count' );
ok( array( 'answer_voted' ) === kinds( sml_gs_answer_verdict( array_merge( $base, $g, array( 'voters' => array( person( 33 ), person( 34 ), person( 35 ) ) ) ), $S ) ), 'outsiders upvoting a group-credited answer do count' );
ok( array() === kinds( sml_gs_answer_verdict( array_merge( $base, $g, array( 'accepted' => true, 'asker_in_credited_group' => true ) ), $S ) ), 'a group cannot farm by answering its own members\' questions' );
ok( array( 'answer_accepted' ) === kinds( sml_gs_answer_verdict( array_merge( $base, $g, array( 'accepted' => true ) ), $S ) ), 'an outsider accepting a group member\'s answer scores for the group' );

/* ---------------- questions */
$ans = function ( $id, $approved = true, $accepted = false, $votes = 0, $days = 60 ) { return array( 'author' => person( $id, $days ), 'approved' => $approved, 'accepted' => $accepted, 'qualified_votes' => $votes ); };
$q = array( 'asker' => person( 20 ), 'credit' => array( 'kind' => 'self' ), 'credited_group_member_ids' => array(), 'now' => $now );
ok( sml_gs_question_verdict( array_merge( $q, array( 'answers' => array( $ans( 41 ), $ans( 42, true, true ) ) ) ), $S ), '2 answers from others + a Loop Pass = good question' );
ok( sml_gs_question_verdict( array_merge( $q, array( 'answers' => array( $ans( 41, true, false, 2 ), $ans( 42, true, false, 1 ) ) ) ), $S ), '2 answers + 3 upvotes = good question' );
ok( ! sml_gs_question_verdict( array_merge( $q, array( 'answers' => array( $ans( 41, true, true ) ) ) ), $S ), 'one answer is not enough' );
ok( ! sml_gs_question_verdict( array_merge( $q, array( 'answers' => array( $ans( 41 ), $ans( 41, true, true ) ) ) ), $S ), 'two answers from the same person count once' );
ok( ! sml_gs_question_verdict( array_merge( $q, array( 'answers' => array( $ans( 20 ), $ans( 42, true, true ) ) ) ), $S ), 'answering your own question does not make it good' );
ok( ! sml_gs_question_verdict( array_merge( $q, array( 'answers' => array( $ans( 41 ), $ans( 42 ) ) ) ), $S ), '2 answers with no acceptance and no votes is not yet good' );
ok( ! sml_gs_question_verdict( array_merge( $q, array( 'answers' => array( $ans( 41, true, false, 0, 1 ), $ans( 42, true, true, 0, 1 ) ) ) ), $S ), 'answers from brand-new accounts do not count' );
ok( ! sml_gs_question_verdict( array_merge( $q, array( 'credit' => array( 'kind' => 'group', 'group_id' => 7 ), 'credited_group_member_ids' => array( 41, 42 ), 'answers' => array( $ans( 41 ), $ans( 42, true, true ) ) ) ), $S ), 'a group answering its own member\'s question does not make it good' );

/* ---------------- shares */
$t = $now - 3 * 86400;
ok( sml_gs_share_counts( $t, array( array( 'session' => 'a', 'ua_class' => 'desktop', 'ts' => $t + 60 ), array( 'session' => 'b', 'ua_class' => 'mobile', 'ts' => $t + 120 ) ), $S ), 'two different visitors make a share count' );
ok( ! sml_gs_share_counts( $t, array( array( 'session' => 'a', 'ua_class' => 'desktop', 'ts' => $t + 60 ), array( 'session' => 'a', 'ua_class' => 'desktop', 'ts' => $t + 90 ) ), $S ), 'one visitor clicking twice does not' );
ok( ! sml_gs_share_counts( $t, array( array( 'session' => 'a', 'ua_class' => 'bot', 'ts' => $t + 60 ), array( 'session' => 'b', 'ua_class' => 'desktop', 'ts' => $t + 90 ) ), $S ), 'bots are not visitors' );
ok( ! sml_gs_share_counts( $t, array( array( 'session' => 'a', 'ua_class' => 'desktop', 'ts' => $t - 60 ), array( 'session' => 'b', 'ua_class' => 'desktop', 'ts' => $t + 8 * 86400 ) ), $S ), 'clicks before the share or after 7 days do not count' );
ok( ! sml_gs_share_counts( $t, array(), $S ), 'pressing share alone earns nothing' );
ok( 3 === sml_gs_share_points_each( 1, $S ) && 2 === sml_gs_share_points_each( 2, $S ) && 1 === sml_gs_share_points_each( 5, $S ), 'a member in several groups spreads a share across them, at least 1 each' );

/* ---------------- daily standing */
$d = sml_gs_daily_points( array( 'members' => 25, 'dau' => 9, 'badges' => 4, 'channels' => 2, 'letters' => 9 ), $S );
ok( 10 === $d['members'] && 15 === $d['dau'] && 6 === $d['badges'] && 8 === $d['channels'] && 20 === $d['letters'], 'daily points: sqrt for crowds, capped per creator kind' );
$big = sml_gs_daily_points( array( 'members' => 2500 ), $S );
ok( 100 === $big['members'], '100x the members is only 10x the points (stuffing does not pay)' );
ok( array( 'members' => 0, 'dau' => 0, 'badges' => 0, 'channels' => 0, 'letters' => 0 ) === sml_gs_daily_points( array(), $S ), 'an empty group earns nothing' );

/* ---------------- Loop Bucks */
ok( 25 === sml_gs_lb_amount( 'answer_accepted', 0, $S ), 'accepted answer pays 25' );
ok( 10 === sml_gs_lb_amount( 'answer_voted', 50, $S ), 'voted answer pays 10' );
ok( 5 === sml_gs_lb_amount( 'answer_accepted', 95, $S ), 'the daily Q&A cap trims the last payout' );
ok( 0 === sml_gs_lb_amount( 'question_good', 100, $S ), 'nothing past the daily cap' );
ok( 0 === sml_gs_lb_amount( 'made_up', 0, $S ), 'unknown kinds pay nothing' );
ok( 15 === sml_gs_group_points_for( 'answer_accepted', $S ) && 0 === sml_gs_group_points_for( 'x', $S ), 'group points map' );

echo "\n$passed passed, $failed failed\n";
exit( $failed ? 1 : 0 );
