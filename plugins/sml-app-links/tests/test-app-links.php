<?php
/* Local proof of the pure parts of SML App Links, run with: php -d display_errors=1 tests/test-app-links.php
   WordPress is stubbed just enough for the file to load; the hooks section is skipped because add_action is undefined. */
define( 'ABSPATH', __DIR__ . '/' );
function apply_filters( $tag, $value ) { return $value; }
function wp_parse_args( $args, $defaults ) { return array_merge( $defaults, (array) $args ); }
function get_option( $k, $d = array() ) { return $d; }
require dirname( __DIR__ ) . '/sml-app-links.php';

$fail = 0;
function check( $name, $cond ) { global $fail; echo ( $cond ? 'ok   ' : 'FAIL ' ) . $name . "\n"; if ( ! $cond ) { $fail++; } }

$d = sml_app_links_defaults();

/* 1. unconfigured: valid, empty documents */
$aasa = sml_app_links_aasa( $d );
check( 'empty AASA has an applinks.details list and no webcredentials', $aasa === array( 'applinks' => array( 'details' => array() ) ) );
check( 'empty assetlinks is an empty list', sml_app_links_assetlinks( $d ) === array() );
check( 'json of an empty assetlinks is []', wp_json_encode_stub( sml_app_links_assetlinks( $d ) ) === '[]' );

/* 2. iOS configured */
$ios = array_merge( $d, array( 'ios_team_id' => 'abcde12345', 'ios_bundle_id' => 'com.stockmarketloop.app' ) );
$aasa = sml_app_links_aasa( $ios );
$detail = $aasa['applinks']['details'][0];
check( 'team id is upper-cased and joined to the bundle id', $detail['appIDs'] === array( 'ABCDE12345.com.stockmarketloop.app' ) );
check( 'web credentials name the same app', $aasa['webcredentials'] === array( 'apps' => array( 'ABCDE12345.com.stockmarketloop.app' ) ) );
$last = end( $detail['components'] );
check( 'components end with the catch-all', $last['/'] === '*' && empty( $last['exclude'] ) );
$excluded = array_filter( $detail['components'], static function ( $c ) { return ! empty( $c['exclude'] ); } );
check( 'wp-admin, wp-json, checkout and the store are excluded', count( array_intersect( array_column( $excluded, '/' ), array( '/wp-admin/*', '/wp-json/*', '/checkout/*', '/store/*' ) ) ) === 4 );
check( 'legacy paths list mirrors the components with NOT prefixes and ends in *', in_array( 'NOT /wp-admin/*', $detail['paths'], true ) && end( $detail['paths'] ) === '*' );
check( 'a bad team id yields no details', sml_app_links_aasa( array_merge( $ios, array( 'ios_team_id' => 'TOO-SHORT' ) ) )['applinks']['details'] === array() );
check( 'a bad bundle id yields no details', sml_app_links_aasa( array_merge( $ios, array( 'ios_bundle_id' => 'no dots or spaces' ) ) )['applinks']['details'] === array() );

/* 3. Android configured, fingerprints in both spellings */
$and = array_merge( $d, array( 'android_package' => 'com.stockmarketloop.app', 'android_sha256' => "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5\n" . strtolower( str_repeat( 'ab', 32 ) ) . ", not-a-fingerprint" ) );
$links = sml_app_links_assetlinks( $and );
check( 'two relations: handle_all_urls and get_login_creds', count( $links ) === 2 && $links[0]['relation'] === array( 'delegate_permission/common.handle_all_urls' ) && $links[1]['relation'] === array( 'delegate_permission/common.get_login_creds' ) );
check( 'package name carried', $links[0]['target']['package_name'] === 'com.stockmarketloop.app' && $links[0]['target']['namespace'] === 'android_app' );
check( 'fingerprints normalised: colon form kept, bare hex colonised and upper-cased, junk dropped', $links[0]['target']['sha256_cert_fingerprints'] === array( '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5', implode( ':', array_fill( 0, 32, 'AB' ) ) ) );
check( 'a package without fingerprints yields nothing', sml_app_links_assetlinks( array_merge( $and, array( 'android_sha256' => '' ) ) ) === array() );

/* 4. manifest */
$site = array( 'icon_192' => 'https://stockmarketloop.com/wp-content/uploads/cropped-icon-192x192.png', 'icon_512' => 'https://stockmarketloop.com/wp-content/uploads/cropped-icon-512x512.png', 'home' => 'https://stockmarketloop.com/' );
$m = sml_app_links_manifest( array_merge( $d, array( 'ios_store_id' => 'id6451234567', 'android_package' => 'com.stockmarketloop.app', 'theme_color' => '#112233' ) ), $site );
check( 'manifest basics', $m['name'] === 'StockMarketLoop' && $m['short_name'] === 'SML' && $m['display'] === 'standalone' && $m['scope'] === '/' && $m['start_url'] === '/?source=pwa' );
check( 'theme colour honoured, background falls back to it', $m['theme_color'] === '#112233' && $m['background_color'] === '#0b1118' );
check( 'site icons used when no override', count( $m['icons'] ) === 2 && $m['icons'][1]['sizes'] === '512x512' && $m['icons'][0]['purpose'] === 'any maskable' );
check( 'store listings become related applications', $m['related_applications'][0] === array( 'platform' => 'itunes', 'url' => 'https://apps.apple.com/app/id6451234567', 'id' => '6451234567' ) && $m['related_applications'][1]['platform'] === 'play' );
$m2 = sml_app_links_manifest( array_merge( $d, array( 'icon_192' => 'http://insecure.example/i.png', 'theme_color' => 'red' ) ), array( 'icon_192' => '', 'icon_512' => '' ) );
check( 'insecure icon url and bad colour are ignored', $m2['icons'] === array() && $m2['theme_color'] === '#0b1118' );

/* 5. routing */
check( 'well-known AASA', sml_app_links_route( '/.well-known/apple-app-site-association' ) === 'aasa' );
check( 'root AASA with a query string', sml_app_links_route( '/apple-app-site-association?x=1' ) === 'aasa' );
check( 'assetlinks', sml_app_links_route( '/.well-known/assetlinks.json' ) === 'assetlinks' );
check( 'manifest spellings', sml_app_links_route( '/manifest.webmanifest' ) === 'manifest' && sml_app_links_route( '/manifest.json/' ) === 'manifest' && sml_app_links_route( '/site.webmanifest' ) === 'manifest' );
check( 'other paths are left to WordPress', sml_app_links_route( '/groups/making-easy-money/' ) === '' && sml_app_links_route( '/wp-json/sml/v1/x' ) === '' );

/* 6. exclude path cleaning */
$ex = sml_app_links_exclude_paths( array( 'exclude_paths' => "/wp-admin/*\n/ok/path\nno-leading-slash\n/bad path with space\n/wp-admin/*, /cart/*" ) );
check( 'exclude paths: leading slash required, spaces refused, duplicates removed', $ex === array( '/wp-admin/*', '/ok/path', '/cart/*' ) );

function wp_json_encode_stub( $v ) { return json_encode( $v, JSON_UNESCAPED_SLASHES ); }

echo $fail ? "\n$fail FAILED\n" : "\nall checks passed\n";
exit( $fail ? 1 : 0 );
