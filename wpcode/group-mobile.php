/**
 * SML Group Mobile — makes /groups/{slug} pages render properly on phones.
 *
 * Root cause (verified 2026-08-29): the group renderer's served head carries NO
 * viewport meta — the /groups/ directory and /groups/create both do — so phones
 * lay individual group pages out at ~980px and scale them down to unreadable,
 * and the renderer's own @media(max-width:860px) rules never fire. With the
 * standard meta injected, the page reflows cleanly at 375px with zero
 * horizontal overflow (only the header tape marquee, which scrolls by design).
 *
 * This snippet emits the viewport meta at wp_head@0 on group slug pages only
 * (the renderer runs the normal wp_head — bilmur/asset hooks all present),
 * plus a pinned phone-polish stylesheet (css/group-mobile.css: overflow
 * guards, compact hero, swipeable tabs). If the renderer ever grows its own
 * viewport meta, the duplicate is identical and harmless.
 *
 * Kill: option sml_group_mobile_off = 1, or deactivate the snippet.
 * WPCode: PHP snippet, Auto Insert / Run Everywhere. No top-level return.
 */
if ( ! function_exists( 'sml_gmb_on' ) ) {

	function sml_gmb_on() {
		if ( is_admin() || get_option( 'sml_group_mobile_off' ) ) { return false; }
		$path = (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH );
		if ( ! preg_match( '~^/groups/([a-z0-9\-]{2,60})/?$~i', $path, $m ) ) { return false; }
		return 'create' !== strtolower( $m[1] ); /* create page already carries its own viewport */
	}

	add_action( 'wp_head', static function () {
		if ( ! sml_gmb_on() ) { return; }
		echo '<meta name="viewport" content="width=device-width, initial-scale=1">' . "\n";
		if ( function_exists( 'sml_cdn_resolve_ref' ) ) { /* polish CSS is pinned; viewport needs no CDN */
			echo '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@' . esc_attr( sml_cdn_resolve_ref() ) . '/css/group-mobile.css">' . "\n";
		}
	}, 0 );
}
