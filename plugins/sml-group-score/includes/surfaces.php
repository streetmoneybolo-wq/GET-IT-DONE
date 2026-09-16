<?php
/**
 * Where members SEE the Group Score: the group page header (beside the member count), the
 * /groups/ directory (reads sml_gs_all_scores()), and the leaderboard page /groups/leaderboard/.
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

/** Groups that must never be listed publicly: private groups and shadow-banned slugs. */
function sml_gs_listable( $group ) {
	if ( 'private' === ( $group['type'] ?? '' ) ) return false;
	if ( defined( 'SML_BANNED_GROUP_SLUGS' ) && in_array( strtolower( (string) $group['slug'] ), array_map( 'trim', explode( ',', strtolower( (string) SML_BANNED_GROUP_SLUGS ) ) ), true ) ) return false;
	return true;
}

/**
 * Every group's lifetime + last-30-day score and public rank, in two queries, cached 2 min.
 * group_id => [lifetime, last_30_days, rank]. Rank counts listable groups only.
 */
function sml_gs_all_scores() {
	global $wpdb;
	$hit = wp_cache_get( 'all_scores', 'sml_gs' );
	if ( is_array( $hit ) ) return $hit;
	$t = sml_gs_t( 'events' );
	$groups = $wpdb->get_results( "SELECT id, slug, type FROM {$wpdb->prefix}sml_groups", ARRAY_A );
	$life = array(); $recent = array();
	foreach ( (array) $wpdb->get_results( "SELECT group_id, SUM(points) s FROM $t GROUP BY group_id" ) as $r ) $life[ (int) $r->group_id ] = (int) $r->s;
	foreach ( (array) $wpdb->get_results( $wpdb->prepare( "SELECT group_id, SUM(points) s FROM $t WHERE day >= %s GROUP BY group_id", sml_gs_et_day( sml_gs_now() - 30 * DAY_IN_SECONDS ) ) ) as $r ) $recent[ (int) $r->group_id ] = (int) $r->s;
	$out = array(); $listable = array();
	foreach ( (array) $groups as $g ) {
		$gid = (int) $g['id'];
		$out[ $gid ] = array( 'lifetime' => $life[ $gid ] ?? 0, 'last_30_days' => $recent[ $gid ] ?? 0, 'rank' => null );
		if ( sml_gs_listable( $g ) ) $listable[ $gid ] = $out[ $gid ]['lifetime'];
	}
	arsort( $listable );
	$pos = 0; $prev = null; $shown = 0;
	foreach ( $listable as $gid => $score ) {
		$shown++;
		if ( $score !== $prev ) { $pos = $shown; $prev = $score; }   /* ties share a rank */
		$out[ $gid ]['rank'] = $pos;
	}
	wp_cache_set( 'all_scores', $out, 'sml_gs', 120 );
	return $out;
}

function sml_gs_leaderboard_url( $gid = 0 ) {
	return home_url( '/groups/leaderboard/' ) . ( $gid ? '#group-' . (int) $gid : '' );
}

/* ------------------------------------------------------ group page header */

add_action( 'wp_enqueue_scripts', function () {
	$path = trim( (string) wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ), '/' );
	if ( ! preg_match( '#^groups/([a-z0-9-]+)$#', $path, $m ) || 'leaderboard' === $m[1] ) return;
	global $wpdb;
	$g = $wpdb->get_row( $wpdb->prepare( "SELECT id, slug, type FROM {$wpdb->prefix}sml_groups WHERE slug = %s", $m[1] ), ARRAY_A );
	if ( ! $g ) return;
	$all = sml_gs_all_scores();
	$me  = $all[ (int) $g['id'] ] ?? array( 'lifetime' => 0, 'last_30_days' => 0, 'rank' => null );
	wp_enqueue_style( 'sml-gs-group', plugins_url( 'assets/group-score.css', dirname( __FILE__ ) ), array(), SML_GS_VERSION );
	wp_enqueue_script( 'sml-gs-group', plugins_url( 'assets/group-score.js', dirname( __FILE__ ) ), array(), SML_GS_VERSION, true );
	wp_localize_script( 'sml-gs-group', 'SML_GS_GROUP', array(
		'groupId'     => (int) $g['id'],
		'lifetime'    => (int) $me['lifetime'],
		'last30'      => (int) $me['last_30_days'],
		'rank'        => sml_gs_listable( $g ) ? $me['rank'] : null,
		'leaderboard' => sml_gs_leaderboard_url( (int) $g['id'] ),
	) );
}, 40 );

/* --------------------------------------------------------- leaderboard page */

add_action( 'template_redirect', function () {
	if ( is_admin() || wp_doing_ajax() ) return;
	$path = trim( (string) wp_parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ), '/' );
	if ( 'groups/leaderboard' !== $path ) return;
	global $wpdb, $wp_query;
	if ( $wp_query ) { $wp_query->is_404 = false; }
	status_header( 200 );
	nocache_headers();

	$all    = sml_gs_all_scores();
	$groups = array();
	foreach ( (array) $wpdb->get_results( "SELECT id, name, slug, type, icon_url, access_model, (SELECT COUNT(*) FROM {$wpdb->prefix}sml_group_members m WHERE m.group_id = g.id) members FROM {$wpdb->prefix}sml_groups g", ARRAY_A ) as $g ) {
		if ( ! sml_gs_listable( $g ) ) continue;
		$s = $all[ (int) $g['id'] ] ?? array( 'lifetime' => 0, 'last_30_days' => 0, 'rank' => null );
		$groups[] = array_merge( $g, $s, array( 'breakdown' => sml_gs_group_score( (int) $g['id'] )['breakdown'] ) );
	}
	usort( $groups, function ( $a, $b ) { return array( $b['lifetime'], $b['last_30_days'], $a['name'] ) <=> array( $a['lifetime'], $a['last_30_days'], $b['name'] ); } );
	$s = sml_gs_settings();
	$families = array(
		'qa'      => array( 'label' => 'Q&A',            'sources' => array( 'qa_answer_accepted', 'qa_answer_voted', 'qa_question_good' ) ),
		'targets' => array( 'label' => 'Targets hit',    'sources' => array( 'target_hit' ) ),
		'shares'  => array( 'label' => 'Shares',         'sources' => array( 'share' ) ),
		'people'  => array( 'label' => 'Members & activity', 'sources' => array( 'daily_members', 'daily_dau', 'daily_badges' ) ),
		'creators'=> array( 'label' => 'Creators',       'sources' => array( 'daily_channels', 'daily_letters' ) ),
	);

	$title = 'Group Leaderboard';
	add_filter( 'pre_get_document_title', function () use ( $title ) { return $title . ' | StockMarketLoop'; } );
	add_action( 'wp_head', function () {
		echo '<meta name="description" content="StockMarketLoop groups ranked by lifetime Group Score: verified price targets hit, helpful Q&amp;A, outside shares, active members and creators.">' . "\n";
		echo '<link rel="canonical" href="' . esc_url( home_url( '/groups/leaderboard/' ) ) . '">' . "\n";
	}, 1 );
	wp_enqueue_style( 'sml-gs-board', plugins_url( 'assets/leaderboard.css', dirname( __FILE__ ) ), array(), SML_GS_VERSION );
	?><!doctype html>
<html <?php language_attributes(); ?>>
<head><meta charset="<?php bloginfo( 'charset' ); ?>"><meta name="viewport" content="width=device-width, initial-scale=1"><title><?php echo esc_html( $title . ' | StockMarketLoop' ); ?></title><?php remove_action( 'wp_head', '_wp_render_title_tag', 1 ); wp_head(); ?></head>
<body <?php body_class( 'sml-gs-board-page' ); ?>>
<?php wp_body_open(); ?>
<main class="sml-gsb">
	<header class="sml-gsb-hero">
		<a class="sml-gsb-back" href="<?php echo esc_url( home_url( '/groups/' ) ); ?>">&larr; All groups</a>
		<h1>Group Leaderboard</h1>
		<p>Every group builds a lifetime <strong>Group Score</strong> from real results and real people. It never resets, and it can't be bought or botted.</p>
	</header>

	<section class="sml-gsb-list" aria-label="Groups ranked by Group Score">
		<?php if ( ! $groups ) : ?>
			<p class="sml-gsb-empty">No groups yet.</p>
		<?php endif; ?>
		<?php foreach ( $groups as $g ) :
			$total = max( 1, (int) $g['lifetime'] );
			$fam = array();
			foreach ( $families as $key => $f ) {
				$pts = 0;
				foreach ( $f['sources'] as $src ) $pts += (int) ( $g['breakdown'][ $src ]['points'] ?? 0 );
				$fam[ $key ] = $pts;
			}
			$url = home_url( '/groups/' . rawurlencode( $g['slug'] ) . '/' );
			?>
			<article class="sml-gsb-row" id="group-<?php echo (int) $g['id']; ?>">
				<span class="sml-gsb-rank<?php echo ( $g['rank'] && $g['rank'] <= 3 ) ? ' is-top' : ''; ?>"><?php echo $g['rank'] ? '#' . (int) $g['rank'] : '—'; ?></span>
				<a class="sml-gsb-group" href="<?php echo esc_url( $url ); ?>">
					<?php if ( $g['icon_url'] ) : ?><img src="<?php echo esc_url( $g['icon_url'] ); ?>" alt="" width="44" height="44" loading="lazy"><?php else : ?><span class="sml-gsb-initial" aria-hidden="true"><?php echo esc_html( mb_strtoupper( mb_substr( $g['name'], 0, 1 ) ) ); ?></span><?php endif; ?>
					<span class="sml-gsb-name"><strong><?php echo esc_html( $g['name'] ); ?></strong><small><?php echo esc_html( number_format_i18n( (int) $g['members'] ) . ' members · ' . ( 'paid' === $g['access_model'] ? 'Premium' : 'Free' ) ); ?></small></span>
				</a>
				<span class="sml-gsb-score"><b><?php echo esc_html( number_format_i18n( (int) $g['lifetime'] ) ); ?></b><small>lifetime</small></span>
				<span class="sml-gsb-recent"><b>+<?php echo esc_html( number_format_i18n( (int) $g['last_30_days'] ) ); ?></b><small>30 days</small></span>
				<span class="sml-gsb-bar" role="img" aria-label="<?php echo esc_attr( implode( ', ', array_map( function ( $k ) use ( $families, $fam ) { return $families[ $k ]['label'] . ' ' . $fam[ $k ]; }, array_keys( $fam ) ) ) ); ?>">
					<?php foreach ( $fam as $key => $pts ) : if ( $pts <= 0 ) continue; ?>
						<i class="f-<?php echo esc_attr( $key ); ?>" style="width:<?php echo esc_attr( round( 100 * $pts / $total, 2 ) ); ?>%" title="<?php echo esc_attr( $families[ $key ]['label'] . ': ' . $pts ); ?>"></i>
					<?php endforeach; ?>
				</span>
			</article>
		<?php endforeach; ?>
		<ul class="sml-gsb-legend" aria-hidden="true">
			<?php foreach ( $families as $key => $f ) : ?><li><i class="f-<?php echo esc_attr( $key ); ?>"></i><?php echo esc_html( $f['label'] ); ?></li><?php endforeach; ?>
		</ul>
	</section>

	<section class="sml-gsb-how" aria-labelledby="sml-gsb-how-title">
		<h2 id="sml-gsb-how-title">How a group earns score</h2>
		<ul>
			<li><b>+<?php echo (int) $s['pts_target_hit']; ?></b> Price target hit on a group alert — counted only after the alert tracker verifies it.</li>
			<li><b>+<?php echo (int) $s['pts_answer_accepted']; ?></b> A member's answer, credited to the group, is accepted by the person who asked. <b>+<?php echo (int) $s['pts_answer_voted']; ?></b> when it gets 3+ upvotes from outside the group.</li>
			<li><b>+<?php echo (int) $s['pts_question_good']; ?></b> A great question listed for the group (answered by 2+ people outside the group).</li>
			<li><b>+<?php echo (int) $s['pts_share']; ?></b> A member shares StockMarketLoop content to another platform and 2+ different people open it.</li>
			<li><b>Every day</b> for active members, members, members with badges, Loop Channel creators and Loop Letter writers.</li>
		</ul>
		<p class="sml-gsb-fine">Only verified accounts count, every reward is re-checked after 24 hours, and larger crowds add less per person — so the score reflects real, lasting activity. Members choose on each Q&amp;A post whether to keep the Loop Bucks or give their group the credit.</p>
		<a class="sml-gsb-cta" href="<?php echo esc_url( home_url( '/q/' ) ); ?>">Answer questions in Q&amp;A &rarr;</a>
	</section>
</main>
<?php wp_footer(); ?>
</body>
</html>
<?php
	exit;
}, -1000000 );
