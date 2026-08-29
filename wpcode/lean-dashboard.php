/**
 * SML Lean Dashboard — stop building the admin Dashboard widgets nobody reads.
 *
 * The Dashboard carried 15 widgets (WooCommerce setup/status/reviews, Rank
 * Math, Site Health tests, a live site-preview iframe, Site Kit's GA summary,
 * writing prompts, activity, quick draft, WPForms, newsletter, wp.org events
 * feed). Screen Options only hides them CLIENT-side — the server still
 * registers and renders every one on each Dashboard load. This removes them
 * server-side before they build, keeping only At a Glance and Jetpack Stats.
 * Applies to every admin user; measured Dashboard TTFB was 5-10s with the
 * full set vs ~3s for light admin pages.
 * Kill switch: option sml_lean_dash_off = 1, or deactivate this snippet.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_lean_dashboard' ) ) {
	function sml_lean_dashboard() {
		if ( get_option( 'sml_lean_dash_off' ) ) { return; }
		$drop = array(
			'wc_admin_dashboard_setup',
			'woocommerce_dashboard_status',
			'woocommerce_dashboard_recent_reviews',
			'rank_math_dashboard_widget',
			'dashboard_site_health',
			'wpcom_site_preview_widget',
			'google_dashboard_widget',
			'wpcom_daily_writing_prompt',
			'dashboard_activity',
			'dashboard_quick_press',
			'wpforms_reports_widget_lite',
			'jetpack_newsletter_dashboard_widget',
			'dashboard_primary',
		);
		foreach ( $drop as $id ) {
			foreach ( array( 'normal', 'side', 'column3', 'column4' ) as $ctx ) {
				remove_meta_box( $id, 'dashboard', $ctx );
			}
		}
	}
	add_action( 'wp_dashboard_setup', 'sml_lean_dashboard', 99 );
}
