<?php
/**
 * Additive recovery of rows lost in the 2026-09-19 03:47 UTC database restore.
 * Source: smlkeep_0919_* (byte copies of the pre-restore __wp_* tables). Target: live wp_*.
 * RULES: insert only rows MISSING from live; never UPDATE/DELETE a live row; raw SQL only (no wp_insert_post etc., so
 * Jetpack Social / IndexNow / Distribute / Loop Bucks earn hooks do NOT re-fire); parent + children in ONE short
 * transaction per group; every child carries an EXISTS-parent guard; abort + ROLLBACK the group if any statement
 * affects a different number of rows than its own pre-count.
 */
global $wpdb;
$MODE   = /*MODE*/'dry'/*/MODE*/;          // 'dry' = count only, write nothing | 'run' = execute
$GROUPS = /*GROUPS*/array('users','terms','drafts','p1','p2','letters','lowrisk','option')/*/GROUPS*/;
$wpdb->hide_errors();

$P1_IDS = '9111,9127,9157,9159,9161,9165,9167,9169,9170,9171,9172,9173,9174,9175,9176,9177,9178,9180,9181,9182,9183,9184,9185,9186,9189,9199,9200,9201,9207,9208,9209,9210,9211,9212,9213,9214,9216,9218,9220,9221,9222,9223,9224,9225,9226,9227,9228,9229,9230,9231,9232,9233,9234,9235,9236,9237,9238,9239,9241,9246,9247,9248,9249,9251,9256,9269';
$P2_IDS = '9154,9155,9156,9158,9162,9164,9166,9168';
$DRAFT_IDS = '9190,9194,9197,9205,9244,9254,9266,9276,9279';
$MEDIA_IDS = '9187,9188,9192,9193,9196,9204,9242,9243,9252,9253,9264,9265,9275,9278';
$SHARE_IDS = '9202,9203,9273,9274';
$NOT_112_Q = "NOT (k.entity_type = 'letter' AND k.entity_id = 112)";
$USER_META_KEYS = "'nickname','first_name','last_name','description','rich_editing','syntax_highlighting','infinite_scrolling','comment_shortcuts','admin_color','use_ssl','show_admin_bar_front','locale','wp_capabilities','wp_user_level','sml_email_verified','sml_referral_code','sml_display_handle','sml_public_handle','dismissed_wp_pointers','sml_feed_onboarding_welcome','wpcom_user_data','sml_loop_bucks','sml_2s_devices','wp_wpcom_site_count','wp_user-settings','jetpack_tracks_wpcom_id'";

/* Materialise the P1 id list ONCE with the full twin guards (id, slug, guid, title AND the meta-level twins the autopilot
   de-duplicates on). Posts 9127/9157 share a title, so the title guard must never be re-evaluated half-way. */
function sml_rc_ids($sql) { global $wpdb; $ids = array_map('intval', (array) $wpdb->get_col($sql)); sort($ids); return $ids; }
$p1 = sml_rc_ids("SELECT k.ID FROM smlkeep_0919_posts k WHERE k.ID IN ($P1_IDS)
    AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.ID = k.ID)
    AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.post_type = 'post' AND l.post_name = k.post_name)
    AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.guid = k.guid)
    AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.post_type = 'post' AND l.post_title = k.post_title)
    AND NOT EXISTS (SELECT 1 FROM smlkeep_0919_postmeta km JOIN wp_postmeta lm ON lm.meta_key = km.meta_key AND lm.meta_value = km.meta_value
                     WHERE km.post_id = k.ID AND km.meta_key IN ('_sml_signal_key','_sml_source_url_hash','_sml_content_fingerprint'))");
$p2 = sml_rc_ids("SELECT k.ID FROM smlkeep_0919_posts k WHERE k.ID IN ($P2_IDS)
    AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.ID = k.ID)
    AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.post_type = 'post' AND l.post_name = k.post_name)
    AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.guid = k.guid)");
$P1L = $p1 ? implode(',', $p1) : '0';
$P2L = $p2 ? implode(',', $p2) : '0';

$PM_GUARD = "k.meta_key <> 'rank_math_internal_links_processed' AND NOT EXISTS (SELECT 1 FROM wp_postmeta l WHERE l.meta_id = k.meta_id) AND NOT EXISTS (SELECT 1 FROM wp_postmeta l WHERE l.post_id = k.post_id AND l.meta_key = k.meta_key)";
$TR_GUARD = "NOT EXISTS (SELECT 1 FROM wp_term_relationships l WHERE l.object_id = k.object_id AND l.term_taxonomy_id = k.term_taxonomy_id)";
$KEY_GUARD = "NOT EXISTS (SELECT 1 FROM wp_sml_signal_news_keys l WHERE l.id = k.id) AND NOT EXISTS (SELECT 1 FROM wp_sml_signal_news_keys l WHERE l.signal_key = k.signal_key)";
$HAS_POST = "EXISTS (SELECT 1 FROM wp_posts p WHERE p.ID = k.post_id)";
$HAS_LETTER = "EXISTS (SELECT 1 FROM wp_sml_letter_posts p WHERE p.id = k.letter_id)";

/* step = [label, live table, keep table, PRE-COUNT predicate (parent assumed), RUN predicate (parent must exist), plan's expected count or null] */
$PLAN = array(
 'users' => array(
   array('the lost member account', 'wp_users', 'smlkeep_0919_users', $u = "k.ID = 258456637 AND NOT EXISTS (SELECT 1 FROM wp_users l WHERE l.ID = k.ID) AND NOT EXISTS (SELECT 1 FROM wp_users l2 WHERE l2.user_login = k.user_login OR l2.user_nicename = k.user_nicename OR l2.user_email = k.user_email)", $u, 1),
   array('their durable profile rows', 'wp_usermeta', 'smlkeep_0919_usermeta', $m = "k.user_id = 258456637 AND k.meta_key IN ($USER_META_KEYS) AND NOT EXISTS (SELECT 1 FROM wp_usermeta l WHERE l.user_id = k.user_id AND l.meta_key = k.meta_key)", "$m AND EXISTS (SELECT 1 FROM wp_users u WHERE u.ID = k.user_id)", 26),
   array('their one ledger line (+15)', 'wp_sml_lb_ledger', 'smlkeep_0919_sml_lb_ledger', $g = "k.user_id = 258456637 AND NOT EXISTS (SELECT 1 FROM wp_sml_lb_ledger l WHERE l.id = k.id) AND NOT EXISTS (SELECT 1 FROM wp_sml_lb_ledger l2 WHERE l2.ref = k.ref)", "$g AND EXISTS (SELECT 1 FROM wp_users u WHERE u.ID = k.user_id) AND EXISTS (SELECT 1 FROM wp_usermeta mm WHERE mm.user_id = k.user_id AND mm.meta_key = 'sml_loop_bucks' AND mm.meta_value = '15')", 1),
 ),
 'terms' => array(
   array('5 tags', 'wp_terms', 'smlkeep_0919_terms', $t = "k.term_id IN (7212998,7212999,7213000,7213001,7213002) AND NOT EXISTS (SELECT 1 FROM wp_terms l WHERE l.term_id = k.term_id) AND NOT EXISTS (SELECT 1 FROM wp_terms l WHERE l.slug = k.slug)", $t, 5),
   array('their taxonomy rows', 'wp_term_taxonomy', 'smlkeep_0919_term_taxonomy', $tt = "k.term_taxonomy_id IN (1310,1311,1312,1313,1314) AND NOT EXISTS (SELECT 1 FROM wp_term_taxonomy l WHERE l.term_taxonomy_id = k.term_taxonomy_id) AND NOT EXISTS (SELECT 1 FROM wp_term_taxonomy l WHERE l.term_id = k.term_id AND l.taxonomy = k.taxonomy)", "$tt AND EXISTS (SELECT 1 FROM wp_terms t WHERE t.term_id = k.term_id)", 5),
 ),
 'drafts' => array(
   array('9 Spotlight drafts + 14 media', 'wp_posts', 'smlkeep_0919_posts', $d = "k.ID IN ($DRAFT_IDS,$MEDIA_IDS) AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.ID = k.ID) AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.post_name = k.post_name AND l.post_name <> '')", $d, 23),
   array('their postmeta', 'wp_postmeta', 'smlkeep_0919_postmeta', "k.post_id IN ($DRAFT_IDS,$MEDIA_IDS) AND $PM_GUARD", "k.post_id IN ($DRAFT_IDS,$MEDIA_IDS) AND $PM_GUARD AND $HAS_POST", 204),
   array('their tags/categories', 'wp_term_relationships', 'smlkeep_0919_term_relationships', "k.object_id IN ($DRAFT_IDS) AND $TR_GUARD", "k.object_id IN ($DRAFT_IDS) AND $TR_GUARD AND EXISTS (SELECT 1 FROM wp_posts p WHERE p.ID = k.object_id) AND EXISTS (SELECT 1 FROM wp_term_taxonomy x WHERE x.term_taxonomy_id = k.term_taxonomy_id)", 65),
 ),
 'p1' => array(
   array('published news articles (no live twin)', 'wp_posts', 'smlkeep_0919_posts', "k.ID IN ($P1L)", "k.ID IN ($P1L) AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.ID = k.ID)", 66),
   array('their postmeta', 'wp_postmeta', 'smlkeep_0919_postmeta', "k.post_id IN ($P1L) AND $PM_GUARD", "k.post_id IN ($P1L) AND $PM_GUARD AND $HAS_POST", 1042),
   array('their category', 'wp_term_relationships', 'smlkeep_0919_term_relationships', "k.object_id IN ($P1L) AND $TR_GUARD", "k.object_id IN ($P1L) AND $TR_GUARD AND EXISTS (SELECT 1 FROM wp_posts p WHERE p.ID = k.object_id)", 66),
   array('their autopilot de-dupe keys', 'wp_sml_signal_news_keys', 'smlkeep_0919_sml_signal_news_keys', "k.post_id IN ($P1L) AND $KEY_GUARD", "k.post_id IN ($P1L) AND $KEY_GUARD AND $HAS_POST", 66),
 ),
 'p2' => array(
   array('8 repeat-headline articles that restored posts link to', 'wp_posts', 'smlkeep_0919_posts', "k.ID IN ($P2L)", "k.ID IN ($P2L) AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.ID = k.ID)", 8),
   array('their postmeta', 'wp_postmeta', 'smlkeep_0919_postmeta', "k.post_id IN ($P2L) AND $PM_GUARD", "k.post_id IN ($P2L) AND $PM_GUARD AND $HAS_POST", 190),
   array('their category', 'wp_term_relationships', 'smlkeep_0919_term_relationships', "k.object_id IN ($P2L) AND $TR_GUARD", "k.object_id IN ($P2L) AND $TR_GUARD AND EXISTS (SELECT 1 FROM wp_posts p WHERE p.ID = k.object_id)", 8),
   array('their autopilot de-dupe keys', 'wp_sml_signal_news_keys', 'smlkeep_0919_sml_signal_news_keys', "k.post_id IN ($P2L) AND $KEY_GUARD", "k.post_id IN ($P2L) AND $KEY_GUARD AND $HAS_POST", 8),
 ),
 'letters' => array( /* distribution HISTORY first, so a letter never exists without its share cards/tokens; only already-SENT queue rows */
   array('share cards', 'wp_sml_dist_cards', 'smlkeep_0919_sml_dist_cards', $c = "$NOT_112_Q AND NOT EXISTS (SELECT 1 FROM wp_sml_dist_cards l WHERE l.id = k.id) AND NOT EXISTS (SELECT 1 FROM wp_sml_dist_cards l2 WHERE l2.entity_type = k.entity_type AND l2.entity_id = k.entity_id AND l2.template = k.template AND l2.aspect = k.aspect)", $c, 3),
   array('ALREADY-SENT distribution history (never queued/sending rows)', 'wp_sml_dist_queue', 'smlkeep_0919_sml_dist_queue', $q = "k.status IN ('sent','handoff') AND $NOT_112_Q AND NOT EXISTS (SELECT 1 FROM wp_sml_dist_queue l WHERE l.id = k.id) AND NOT EXISTS (SELECT 1 FROM wp_sml_dist_queue l2 WHERE l2.idempotency_key = k.idempotency_key) AND NOT EXISTS (SELECT 1 FROM wp_sml_dist_queue l3 WHERE l3.share_token = k.share_token)", $q, 30),
   array('3 Loop Letters (68, 69, 70)', 'wp_sml_letter_posts', 'smlkeep_0919_sml_letter_posts', $l = "k.id IN (68,69,70) AND NOT EXISTS (SELECT 1 FROM wp_sml_letter_posts l WHERE l.id = k.id OR l.slug = k.slug)", $l, 3),
   array('their versions', 'wp_sml_letter_versions', 'smlkeep_0919_sml_letter_versions', $x = "k.letter_id IN (68,69,70) AND NOT EXISTS (SELECT 1 FROM wp_sml_letter_versions l WHERE l.id = k.id)", "$x AND $HAS_LETTER", 3),
   array('their tickers', 'wp_sml_letter_tickers', 'smlkeep_0919_sml_letter_tickers', $x = "k.letter_id IN (68,69,70) AND NOT EXISTS (SELECT 1 FROM wp_sml_letter_tickers l WHERE l.id = k.id OR (l.letter_id = k.letter_id AND l.symbol = k.symbol))", "$x AND $HAS_LETTER", 3),
   array('their SEO rows', 'wp_sml_letters_seo', 'smlkeep_0919_sml_letters_seo', $x = "k.letter_id IN (68,69,70) AND NOT EXISTS (SELECT 1 FROM wp_sml_letters_seo l WHERE l.letter_id = k.letter_id)", "$x AND $HAS_LETTER", 3),
   array('their generation jobs', 'wp_sml_personal_letters_jobs', 'smlkeep_0919_sml_personal_letters_jobs', $x = "k.letter_id IN (68,69,70) AND NOT EXISTS (SELECT 1 FROM wp_sml_personal_letters_jobs l WHERE l.id = k.id OR (l.local_day = k.local_day AND l.slot = k.slot) OR l.job_key = k.job_key OR l.topic_key = k.topic_key)", "$x AND $HAS_LETTER", 3),
   array('their daily stats', 'wp_sml_letter_daily', 'smlkeep_0919_sml_letter_daily', $x = "k.letter_id IN (68,69,70) AND NOT EXISTS (SELECT 1 FROM wp_sml_letter_daily l WHERE l.letter_id = k.letter_id AND l.day = k.day)", "$x AND $HAS_LETTER", 1),
   array('share pages + share-card images for letters 69/70', 'wp_posts', 'smlkeep_0919_posts', $s = "k.ID IN ($SHARE_IDS) AND NOT EXISTS (SELECT 1 FROM wp_posts l WHERE l.ID = k.ID OR (l.post_name = k.post_name AND l.post_type = k.post_type))", $s, 4),
   array('their postmeta', 'wp_postmeta', 'smlkeep_0919_postmeta', $x = "k.post_id IN ($SHARE_IDS) AND NOT EXISTS (SELECT 1 FROM wp_postmeta l WHERE l.meta_id = k.meta_id OR (l.post_id = k.post_id AND l.meta_key = k.meta_key))", "$x AND $HAS_POST", 38),
   array('share-link click history', 'wp_sml_dist_clicks', 'smlkeep_0919_sml_dist_clicks', $x = "NOT EXISTS (SELECT 1 FROM smlkeep_0919_sml_dist_queue q WHERE q.share_token = k.share_token AND q.entity_type = 'letter' AND q.entity_id = 112) AND NOT EXISTS (SELECT 1 FROM wp_sml_dist_clicks l WHERE l.id = k.id) AND NOT EXISTS (SELECT 1 FROM wp_sml_dist_clicks l2 WHERE l2.share_token = k.share_token AND l2.session_key = k.session_key)", $x, 26),
   array('distribution daily rollup (cosmetic)', 'wp_sml_dist_daily', 'smlkeep_0919_sml_dist_daily', $x = "NOT EXISTS (SELECT 1 FROM wp_sml_dist_daily l WHERE l.user_id = k.user_id AND l.day = k.day AND l.platform = k.platform)", $x, 17),
 ),
 'lowrisk' => array(
   array('de-dupe keys for posts that ARE live (stops the autopilot re-writing them)', 'wp_sml_signal_news_keys', 'smlkeep_0919_sml_signal_news_keys', $x = "$KEY_GUARD AND $HAS_POST AND k.post_id < 9154 AND k.post_id NOT IN (9111,9127)", $x, 34),
   array('"already shared" markers on live posts (stops re-sharing)', 'wp_postmeta', 'smlkeep_0919_postmeta', $x = "k.meta_key = '_publicize_shares' AND $HAS_POST AND k.post_id <= 9153 AND NOT EXISTS (SELECT 1 FROM wp_postmeta l WHERE l.meta_id = k.meta_id) AND NOT EXISTS (SELECT 1 FROM wp_postmeta l WHERE l.post_id = k.post_id AND l.meta_key = k.meta_key)", $x, 28),
   array('billing event idempotency records', 'wp_sml_platform_billing_events', 'smlkeep_0919_sml_platform_billing_events', $x = "NOT EXISTS (SELECT 1 FROM wp_sml_platform_billing_events l WHERE l.id = k.id) AND NOT EXISTS (SELECT 1 FROM wp_sml_platform_billing_events l2 WHERE l2.source_key = k.source_key)", $x, 57),
 ),
 'option' => array(
   array('Loop Bucks top-up bundle prices (inert: the plugin stays INACTIVE)', 'wp_options', 'smlkeep_0919_options', $x = "k.option_name = 'sml_lb_topup_settings' AND NOT EXISTS (SELECT 1 FROM wp_options l WHERE l.option_name = k.option_name)", $x, 1),
 ),
);

echo "MODE=$MODE | P1 list after twin guards: " . count($p1) . " of 66 | P2 list: " . count($p2) . " of 8 | " . gmdate('Y-m-d H:i:s') . " UTC\n";
$totals = array('inserted' => 0, 'groups_ok' => 0, 'groups_failed' => 0);
foreach ($GROUPS as $g) {
  if (empty($PLAN[$g])) { continue; }
  echo "\n== group: $g ==\n";
  $pre = array(); $warn = false;
  foreach ($PLAN[$g] as $i => $s) {
    $pre[$i] = (int) $wpdb->get_var("SELECT COUNT(*) FROM `{$s[2]}` k WHERE {$s[3]}");
    $flag = (null !== $s[5] && $pre[$i] !== $s[5]) ? "  <-- plan expected {$s[5]}" : '';
    if ($flag) { $warn = true; }
    printf("  pre-count %-5d %-30s %s%s\n", $pre[$i], $s[1], $s[0], $flag);
  }
  if ('run' !== $MODE) { continue; }
  if ($warn && !in_array($g, array('p1', 'p2'), true)) { echo "  ABORT group $g: a pre-count differs from the reviewed plan. Nothing written.\n"; $totals['groups_failed']++; continue; }
  $wpdb->query('START TRANSACTION'); $ok = true; $done = 0;
  foreach ($PLAN[$g] as $i => $s) {
    if (0 === $pre[$i]) { continue; }
    /* wp_options.option_id is auto-increment and must not be copied */
    $sql = ('wp_options' === $s[1])
      ? "INSERT INTO `wp_options` (option_name, option_value, autoload) SELECT k.option_name, k.option_value, k.autoload FROM `{$s[2]}` k WHERE {$s[4]}"
      : "INSERT INTO `{$s[1]}` SELECT k.* FROM `{$s[2]}` k WHERE {$s[4]}";
    $n = $wpdb->query($sql);
    if (false === $n || (int) $n !== $pre[$i]) { echo "  FAIL  {$s[1]}: affected=" . var_export($n, true) . " expected={$pre[$i]} err=" . $wpdb->last_error . "\n"; $ok = false; break; }
    echo "  ok    {$s[1]}: +$n\n"; $done += (int) $n;
  }
  if ($ok) { $wpdb->query('COMMIT'); $totals['inserted'] += $done; $totals['groups_ok']++; echo "  COMMIT ($done rows)\n"; }
  else { $wpdb->query('ROLLBACK'); $totals['groups_failed']++; echo "  ROLLBACK - group $g left untouched\n"; }
}

if ('run' === $MODE && $totals['inserted'] > 0) {
  /* targeted cache work, in PHP (no wp-cli subcommands on this host) */
  foreach (array_merge($p1, $p2, array_map('intval', explode(',', "$DRAFT_IDS,$MEDIA_IDS,$SHARE_IDS"))) as $pid) { clean_post_cache((int) $pid); }
  clean_user_cache(258456637);
  if (function_exists('wp_update_term_count_now')) { wp_update_term_count_now(array(417), 'category'); wp_update_term_count_now(array(1310, 1311, 1312, 1313, 1314), 'post_tag'); }
  clean_term_cache(array(7212998, 7212999, 7213000, 7213001, 7213002), '', false);
  wp_cache_delete('alloptions', 'options'); wp_cache_delete('notoptions', 'options');
  if (function_exists('wp_cache_set_posts_last_changed')) { wp_cache_set_posts_last_changed(); }
  if (function_exists('wp_cache_set_terms_last_changed')) { wp_cache_set_terms_last_changed(); }
  if (function_exists('wp_cache_set_users_last_changed')) { wp_cache_set_users_last_changed(); }
  echo "\ncaches cleaned for the restored ids\n";
}
echo "\nTOTAL inserted={$totals['inserted']} groups_ok={$totals['groups_ok']} groups_failed={$totals['groups_failed']}\n";
echo "distribution queue rows that could SEND right now (must be unchanged by this script): " . (int) $wpdb->get_var("SELECT COUNT(*) FROM wp_sml_dist_queue WHERE status IN ('queued','sending')") . "\n";
