<?php
/* Creates NEW tables only (smlkeep_0919_*), as byte copies of the pre-restore __wp_* tables. Touches nothing that exists. */
global $wpdb;
$tables = array('users','usermeta','posts','postmeta','terms','term_taxonomy','term_relationships','options','comments','commentmeta',
  'sml_letter_posts','sml_letter_versions','sml_letter_tickers','sml_letter_daily','sml_letter_reads','sml_letters_seo','sml_personal_letters_jobs',
  'sml_dist_queue','sml_dist_clicks','sml_dist_cards','sml_dist_daily','sml_signal_news_keys','sml_platform_billing_events',
  'sml_lb_ledger','sml_lb_ranks','sml_market_content_locks','sml_bench_creator','suremails_email_log','sml_kg_news');
$total = 0; $done = 0;
foreach ($tables as $t) {
  $src = '__wp_' . $t; $dst = 'smlkeep_0919_' . $t;
  if (!$wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $src))) { echo "  skip (no source): $src\n"; continue; }
  if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $dst))) { $n = (int) $wpdb->get_var("SELECT COUNT(*) FROM `$dst`"); $m = (int) $wpdb->get_var("SELECT COUNT(*) FROM `$src`"); echo "  exists: $dst rows=$n (source $m)\n"; if ($n === $m) { $done++; continue; } if ($n > 0) { continue; } }
  else { $wpdb->query("CREATE TABLE `$dst` LIKE `$src`"); }
  $wpdb->query("INSERT INTO `$dst` SELECT * FROM `$src`");
  $n = (int) $wpdb->get_var("SELECT COUNT(*) FROM `$dst`"); $m = (int) $wpdb->get_var("SELECT COUNT(*) FROM `$src`");
  $st = $wpdb->get_row($wpdb->prepare('SHOW TABLE STATUS LIKE %s', $dst), ARRAY_A); $mb = round(((int) $st['Data_length'] + (int) $st['Index_length']) / 1048576, 1); $total += $mb;
  printf("  %-44s rows=%-7d source=%-7d %s  %.1f MB\n", $dst, $n, $m, $n === $m ? 'OK' : 'MISMATCH', $mb);
  if ($n === $m) { $done++; }
}
echo "safety copies complete: $done of " . count($tables) . " | ~" . round($total, 1) . " MB\n";
