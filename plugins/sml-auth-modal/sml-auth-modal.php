<?php
/**
 * Plugin Name: SML Auth Modal
 * Description: The StockMarketLoop sign-up and sign-in module, redesigned. Email sign-up with a live handle check and suggestions, a password meter, a one-time-code verify step with resend cooldown, and sign-in with forgot-password. Replaces the old modal (whose Google and Facebook buttons pointed at routes that do not exist), turns the landing page's "Sign Up With Google" buttons into "Create Free Account", and removes Site Kit's Sign in with Google from every page, wp-login.php included.
 * Version: 1.1.0
 * Author: StockMarketLoop
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

define( 'SMLX_AUTH_DIR', plugin_dir_path( __FILE__ ) );
require_once SMLX_AUTH_DIR . 'includes/google.php';
/* The CSS and JS live in the repo (assets/) and load from a commit-pinned CDN URL, as the site's other scripts do; a copy of the
   plugin that carries assets/ next to this file uses them inline instead. Bump the pin to ship a new version of either. */
/* Continue with Discord: the platform's Discord sign-in (same callback as the trial link; it makes or matches the site account and signs the member in). */
define( 'SMLX_AUTH_DISCORD', 'https://sml-platform-api.onrender.com/academy-activity/trial/signin' );
define( 'SMLX_AUTH_CDN', 'https://cdn.jsdelivr.net/gh/streetmoneybolo-wq/GET-IT-DONE@1035718862d8b9004c5f0601cd62813aa9e4e9a8/plugins/sml-auth-modal/assets/' );

function smlx_auth_markup() {
	return <<<'HTML'
<div class="smlx-auth" data-sml-auth-modal aria-hidden="true">
  <div class="smlx-card" role="dialog" aria-modal="true" aria-labelledby="smlx-title" tabindex="-1">
    <button class="smlx-x" type="button" data-sml-auth-close aria-label="Close">&times;</button>
    <div class="smlx-brand"><i></i>StockMarketLoop</div>
    <h2 id="smlx-title" data-auth-title>Create your account</h2>
    <p class="smlx-sub" data-auth-sub>Free to join. Follow traders, post your ideas, get paid.</p>

    <div class="smlx-tabs" role="tablist" data-tabs>
      <button type="button" role="tab" data-auth-tab="signup" data-active="1">Create account</button>
      <button type="button" role="tab" data-auth-tab="login" data-active="0">Log in</button>
    </div>

    <div class="smlx-oauth" data-oauth hidden><div class="smlx-google" data-google hidden></div><a class="smlx-discord" data-discord href="#"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg><span>Continue with Discord</span></a><div class="smlx-or"><span>or use email</span></div></div>

    <div class="smlx-msg" data-auth-status role="alert" aria-live="polite" hidden></div>

    <form class="smlx-form" data-signup-form novalidate>
      <label class="smlx-f"><span>Email</span>
        <input type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" required>
        <em class="smlx-err" data-err="email"></em><button type="button" class="smlx-hint" data-email-fix hidden></button>
      </label>
      <label class="smlx-f"><span>Display name</span>
        <input type="text" name="display_name" autocomplete="name" maxlength="60" placeholder="How your name shows on posts" required>
        <em class="smlx-err" data-err="display_name"></em>
      </label>
      <div class="smlx-f"><span>Profile handle</span>
        <div class="smlx-handle"><b>@</b><input type="text" name="handle" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="30" placeholder="yourhandle" aria-label="Profile handle" required></div>
        <small class="smlx-note" data-handle-status data-state="">Letters, numbers, dots and underscores. Filled in from your name; change it any time before you join.</small>
        <div class="smlx-chips" data-handle-chips></div>
        <em class="smlx-err" data-err="handle"></em>
      </div>
      <div class="smlx-f"><span>Password</span>
        <div class="smlx-pass"><input type="password" name="password" autocomplete="new-password" placeholder="At least 8 characters" required><button type="button" class="smlx-eye" data-toggle-pass aria-label="Show password" aria-pressed="false">Show</button></div>
        <div class="smlx-meter" aria-hidden="true"><i data-meter></i></div>
        <small class="smlx-note" data-pass-hint>Use 8 or more characters. A longer phrase beats a short, clever one.</small>
        <em class="smlx-err" data-err="password"></em>
      </div>
      <label class="smlx-check"><input type="checkbox" name="remember" checked> Keep me signed in on this device</label>
      <button class="smlx-go" type="submit" data-signup-submit><span>Create free account</span></button>
      <p class="smlx-alt">Already a member? <button type="button" class="smlx-link" data-auth-tab="login">Log in</button></p>
    </form>

    <form class="smlx-form" data-login-form novalidate hidden>
      <label class="smlx-f"><span>Email or username</span>
        <input type="text" name="login" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="you@example.com" required>
        <em class="smlx-err" data-err="login"></em>
      </label>
      <div class="smlx-f"><span class="smlx-row"><span>Password</span><a class="smlx-link" data-forgot href="/wp-login.php?action=lostpassword">Forgot password?</a></span>
        <div class="smlx-pass"><input type="password" name="password" autocomplete="current-password" placeholder="Your password" required><button type="button" class="smlx-eye" data-toggle-pass aria-label="Show password" aria-pressed="false">Show</button></div>
        <em class="smlx-err" data-err="lpassword"></em>
      </div>
      <label class="smlx-check"><input type="checkbox" name="remember" checked> Keep me signed in</label>
      <button class="smlx-go" type="submit" data-login-submit><span>Log in</span></button>
      <p class="smlx-alt">New here? <button type="button" class="smlx-link" data-auth-tab="signup">Create a free account</button></p>
    </form>

    <form class="smlx-form" data-verify-form novalidate hidden>
      <input type="hidden" name="email">
      <div class="smlx-otp" data-otp role="group" aria-label="5-digit verification code">
        <input inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="one-time-code" aria-label="Digit 1">
        <input inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Digit 2">
        <input inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Digit 3">
        <input inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Digit 4">
        <input inputmode="numeric" pattern="[0-9]*" maxlength="1" aria-label="Digit 5">
      </div>
      <button class="smlx-go" type="submit" data-verify-submit><span>Verify and continue</span></button>
      <p class="smlx-alt"><button type="button" class="smlx-link" data-resend-code>Resend code</button> <span data-cooldown></span></p>
      <p class="smlx-alt"><button type="button" class="smlx-link" data-verify-back>Use a different email</button></p>
    </form>
  </div>
</div>
HTML;
}

/* The modal, its stylesheet and its script, as one block that takes the old modal's place. */
function smlx_auth_block() {
	$cfg = wp_json_encode( array(
		'api'   => rest_url( 'sml-members/v1/' ),
		'nonce' => wp_create_nonce( 'wp_rest' ),
		'home'  => home_url( '/' ),
		'reset' => wp_lostpassword_url(),
		'discord' => SMLX_AUTH_DISCORD,
		'google'  => SMLX_GOOGLE_CLIENT_ID,
		'gapi'    => rest_url( 'sml-auth/v1/' ),
	) );
	$css = SMLX_AUTH_DIR . 'assets/auth.css';
	$js  = SMLX_AUTH_DIR . 'assets/auth.js';
	if ( is_readable( $css ) && is_readable( $js ) ) {
		$style  = '<style id="smlx-auth-css">' . file_get_contents( $css ) . '</style>';
		$script = '<script id="smlx-auth-js">window.SMLX_AUTH=' . $cfg . ';' . file_get_contents( $js ) . '</script>';
	} else {
		$style  = '<link id="smlx-auth-css" rel="stylesheet" href="' . esc_url( SMLX_AUTH_CDN . 'auth.min.css' ) . '">';
		$script = '<script>window.SMLX_AUTH=' . $cfg . ';</script><script id="smlx-auth-js" src="' . esc_url( SMLX_AUTH_CDN . 'auth.min.js' ) . '"></script>'
			/* if the script never arrives, the buttons go to WordPress's own login page instead of doing nothing (or looping) */
			. '<script>if(!window.SMLAuth){document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("[data-sml-guest-open]"):null;if(!a)return;e.preventDefault();e.stopPropagation();location.href="/wp-login.php"+(a.getAttribute("data-sml-guest-open")==="signup"?"?action=register":"");},true);}</script>';
	}
	return $style . smlx_auth_markup() . $script;
}

function smlx_auth_filter( $html ) {
	if ( ! is_string( $html ) || $html === '' ) { return $html; }

	/* Site Kit's Sign in with Google (the button and Google's script), wherever it was added */
	if ( strpos( $html, 'Sign in with Google button added by Site Kit' ) !== false ) {
		$html = preg_replace( '#<!-- Sign in with Google button added by Site Kit -->.*?<!-- End Sign in with Google button added by Site Kit -->#s', '', $html );
	}

	/* the old modal and its script (they are one run of markup ending at the script's close tag) */
	if ( strpos( $html, 'data-sml-auth-modal' ) !== false && strpos( $html, 'smlx-auth-js' ) === false ) {
		$block = smlx_auth_block();
		if ( $block !== '' ) {
			$html = preg_replace_callback( '#<div class="sml-auth-modal"[^>]*data-sml-auth-modal.*?</script>#s', function () use ( $block ) { return $block; }, $html, 1 );
		}
	}

	/* the landing page's calls to action: no Google or Facebook, a plain "create account" that opens the module */
	if ( strpos( $html, 'data-social-provider' ) !== false ) {
		$html = preg_replace_callback( '#<a\b[^>]*\bdata-social-provider="(?:google|facebook)"[^>]*>(.*?)</a>#s', function ( $m ) {
			$label = stripos( $m[1], 'click here' ) !== false ? 'Create Your Free Account' : 'Create Free Account';
			return '<a class="sml-guest-btn primary" href="#stockmarketloop-signup" data-sml-guest-open="signup">' . $label . '</a>';
		}, $html );
	}
	return $html;
}

/* Front-end pages only: a browser GET for HTML, never the REST API, admin, ajax or cron. */
add_action( 'plugins_loaded', function () {
	if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'WP_CLI' ) && WP_CLI ) ) { return; }
	if ( ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) !== 'GET' ) { return; }
	$accept = (string) ( $_SERVER['HTTP_ACCEPT'] ?? '' );
	if ( $accept !== '' && stripos( $accept, 'text/html' ) === false && strpos( $accept, '*/*' ) === false ) { return; }
	$path = (string) wp_parse_url( (string) ( $_SERVER['REQUEST_URI'] ?? '' ), PHP_URL_PATH );
	if ( strpos( $path, '/wp-json/' ) === 0 || substr( $path, -4 ) === '.xml' || substr( $path, -5 ) === '/feed' || strpos( $path, '/feed/' ) !== false ) { return; }
	ob_start( 'smlx_auth_filter' );
}, 3 );

/* Belt and braces on the login screen: if the buffer missed anything, Site Kit's button stays hidden. */
add_action( 'login_head', function () {
	echo '<style>[class*="googlesitekit-sign-in-with-google"]{display:none!important}</style>';
} );
