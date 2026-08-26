/**
 * SML UI — retire the React control site-wide.
 *
 * The Home Feed Engagement plugin (v119) renders a "React" button + emoji
 * reaction menu on feed cards and article pages. Product call 2026-08-26:
 * the React control is retired everywhere. Rather than editing the live
 * engagement plugin (its reactions storage/routes stay intact and harmless),
 * this snippet removes the control at render time on every page:
 *   - CSS hides the reaction menu instantly (no flash),
 *   - a tiny footer script removes React buttons (text-matched — they carry
 *     no distinguishing class) and the menus, and keeps sweeping for
 *     late-rendered ones.
 * The optimized homepage is covered separately by home-feed.js (its
 * standalone response does not print normal wp_footer output).
 * Rollback: deactivate this snippet — the buttons return on next load.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_retire_react_footer' ) ) {
	function sml_retire_react_footer() {
		echo '<style id="sml-noreact-css">.sml-hfe-reaction-menu{display:none!important}</style>';
		echo '<script id="sml-noreact" data-sml-oh-allow>(function(){function z(){try{document.querySelectorAll("button.sml-hfe-btn").forEach(function(b){if(/^\s*React\b/i.test(b.textContent||""))b.remove();});document.querySelectorAll(".sml-hfe-reaction-menu").forEach(function(m){m.remove();});}catch(e){}}z();setInterval(z,4000);})();</script>';
	}
	add_action( 'wp_footer', 'sml_retire_react_footer', 99 );
}
