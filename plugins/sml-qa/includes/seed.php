<?php
/**
 * SML Q&A — one-time content seeder (Phase 5 kickoff).
 *
 * Seeds the platform with the site's own evergreen editorial Q&A so the section
 * is genuinely useful before any discovery is turned on. Content lives in
 * includes/seed-data.php (a plain PHP array). Insertion is server-side and
 * IDEMPOTENT — a question whose slug already exists is skipped, so the button is
 * safe to press more than once and safe to ship disabled-by-completion.
 *
 * Triggered by a single admin click (Questions → Seed Content). Everything runs
 * in PHP under a manage_options + nonce gate; nothing is created client-side.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }

require_once SML_QA_DIR . 'includes/seed-data.php';

/**
 * Create one question + its accepted answer, or skip if the slug already exists.
 * Returns 'created' | 'skipped' | 'error:<reason>'.
 */
function sml_qa_seed_one( array $item, $author_id ) {
	$slug = isset( $item['slug'] ) ? sanitize_title( $item['slug'] ) : '';
	if ( '' === $slug || empty( $item['title'] ) || empty( $item['answer_body'] ) ) {
		return 'error:incomplete';
	}
	/* Idempotency: never duplicate a question we already seeded. */
	if ( get_page_by_path( $slug, OBJECT, 'sml_question' ) ) {
		return 'skipped';
	}

	$qid = wp_insert_post( array(
		'post_type'    => 'sml_question',
		'post_status'  => 'publish',
		'post_title'   => wp_strip_all_tags( (string) $item['title'] ),
		'post_content' => (string) ( $item['question_body'] ?? '' ),
		'post_name'    => $slug,
		'post_author'  => (int) $author_id,
	), true );

	if ( is_wp_error( $qid ) || ! $qid ) {
		return 'error:insert_post';
	}

	$ticker = strtoupper( preg_replace( '/[^A-Za-z.]/', '', (string) ( $item['ticker'] ?? '' ) ) );
	if ( '' !== $ticker ) {
		update_post_meta( $qid, '_sml_qa_ticker', substr( $ticker, 0, 10 ) );
	}

	$author = get_userdata( (int) $author_id );
	$cid = wp_insert_comment( array(
		'comment_post_ID'      => (int) $qid,
		'comment_content'      => (string) $item['answer_body'],
		'comment_type'         => SML_QA_ANSWER_TYPE,
		'comment_approved'     => 1,
		'user_id'              => (int) $author_id,
		'comment_author'       => $author ? $author->display_name : 'SML News',
		'comment_author_email' => $author ? $author->user_email : '',
	) );

	if ( ! $cid ) {
		/* Roll the question back so we never leave an answerless (noindex) shell. */
		wp_delete_post( $qid, true );
		return 'error:insert_comment';
	}

	update_post_meta( $qid, '_sml_qa_accepted', (int) $cid );
	if ( function_exists( 'sml_qa_recount' ) ) { sml_qa_recount( $qid ); }

	return 'created';
}

/** Run the full seed. Returns array( created, skipped, errors[] ). */
function sml_qa_run_seed() {
	$items = sml_qa_seed_data();
	$author_id = get_current_user_id();
	$out = array( 'created' => 0, 'skipped' => 0, 'errors' => array() );
	foreach ( $items as $item ) {
		$r = sml_qa_seed_one( $item, $author_id );
		if ( 'created' === $r ) { $out['created']++; }
		elseif ( 'skipped' === $r ) { $out['skipped']++; }
		else { $out['errors'][] = ( $item['slug'] ?? '?' ) . ' → ' . $r; }
	}
	update_option( 'sml_qa_seed_last', array( 'time' => time(), 'result' => $out ), false );
	return $out;
}

/* Admin submenu: Questions → Seed Content ---------------------------------- */
add_action( 'admin_menu', function () {
	add_submenu_page(
		'edit.php?post_type=sml_question',
		'Seed Q&A Content',
		'Seed Content',
		'manage_options',
		'sml-qa-seed',
		'sml_qa_seed_page'
	);
} );

function sml_qa_seed_page() {
	if ( ! current_user_can( 'manage_options' ) ) { return; }
	$last = get_option( 'sml_qa_seed_last' );
	$total = count( sml_qa_seed_data() );
	echo '<div class="wrap"><h1>Seed Q&amp;A Content</h1>';
	echo '<p>Publishes ' . (int) $total . ' evergreen editorial questions (each with an accepted answer) authored by the current user. Idempotent: questions whose slug already exists are skipped, so pressing this again only fills gaps.</p>';
	if ( is_array( $last ) && isset( $last['result'] ) ) {
		$r = $last['result'];
		echo '<div class="notice notice-info"><p>Last run: <strong>' . (int) $r['created'] . '</strong> created, <strong>' . (int) $r['skipped'] . '</strong> skipped';
		if ( ! empty( $r['errors'] ) ) { echo ', <strong>' . count( $r['errors'] ) . '</strong> errors: ' . esc_html( implode( '; ', $r['errors'] ) ); }
		echo '.</p></div>';
	}
	echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
	echo '<input type="hidden" name="action" value="sml_qa_seed">';
	wp_nonce_field( 'sml_qa_seed', 'sml_qa_seed_nonce' );
	submit_button( 'Publish seed questions', 'primary', 'submit', true );
	echo '</form></div>';
}

add_action( 'admin_post_sml_qa_seed', function () {
	if ( ! current_user_can( 'manage_options' ) ) { wp_die( 'Insufficient permissions.' ); }
	check_admin_referer( 'sml_qa_seed', 'sml_qa_seed_nonce' );
	$out = sml_qa_run_seed();
	$url = add_query_arg( array(
		'post_type' => 'sml_question',
		'page'      => 'sml-qa-seed',
		'seeded'    => (int) $out['created'],
		'skipped'   => (int) $out['skipped'],
	), admin_url( 'edit.php' ) );
	wp_safe_redirect( $url );
	exit;
} );
