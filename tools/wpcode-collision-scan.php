<?php
/**
 * WPCode collision scanner — run with:  wp eval-file wpcode-collision-scan.php
 *
 * WPCode does not execute under WP-CLI, so in this runtime only plugins and
 * mu-plugins have defined functions/classes. Any name that an ACTIVE PHP snippet
 * declares and that ALREADY exists here will hit "Cannot redeclare" when WPCode
 * runs on the frontend — and on this site that aborts every snippet after it.
 * A declaration is only safe if the snippet guards THAT EXACT NAME.
 */
$posts = get_posts( array( 'post_type' => 'wpcode', 'post_status' => 'publish', 'numberposts' => -1, 'orderby' => 'ID', 'order' => 'ASC' ) );
$scanned = 0; $hits = array();
foreach ( $posts as $p ) {
	$types = wp_get_post_terms( $p->ID, 'wpcode_type', array( 'fields' => 'slugs' ) );
	if ( is_array( $types ) && $types && ! in_array( 'php', $types, true ) ) { continue; }
	$code = (string) $p->post_content;
	if ( false === strpos( $code, 'function ' ) && false === strpos( $code, 'class ' ) ) { continue; }
	$scanned++;
	$names = array();
	if ( preg_match_all( '/^[ \t]*function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/m', $code, $m ) ) { foreach ( $m[1] as $n ) { $names[ $n ] = 'function'; } }
	if ( preg_match_all( '/^[ \t]*(?:final\s+|abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/m', $code, $m ) ) { foreach ( $m[1] as $n ) { $names[ $n ] = 'class'; } }
	foreach ( $names as $n => $kind ) {
		$exists = ( 'function' === $kind ) ? function_exists( $n ) : class_exists( $n, false );
		if ( ! $exists ) { continue; }
		$guard   = ( 'function' === $kind ) ? 'function_exists' : 'class_exists';
		$guarded = (bool) preg_match( '/' . $guard . '\s*\(\s*[\'"]\\\\?' . preg_quote( $n, '/' ) . '[\'"]/', $code );
		$where = '';
		try {
			$r = ( 'function' === $kind ) ? new ReflectionFunction( $n ) : new ReflectionClass( $n );
			$where = str_replace( '/srv/htdocs/wp-content/', '', (string) $r->getFileName() );
		} catch ( Throwable $e ) { $where = '?'; }
		$hits[] = array( 'snippet' => $p->ID, 'title' => mb_substr( $p->post_title, 0, 44 ), 'kind' => $kind, 'name' => $n, 'guarded_exact' => $guarded ? 'yes' : 'NO', 'already_defined_in' => $where );
	}
}
echo "active PHP snippets scanned: {$scanned}\n";
echo "names already defined outside WPCode: " . count( $hits ) . "\n\n";
usort( $hits, function ( $a, $b ) { return strcmp( $a['guarded_exact'], $b['guarded_exact'] ) ?: ( $a['snippet'] - $b['snippet'] ); } );
foreach ( $hits as $h ) {
	printf( "%-4s #%-5d %-8s %-42s defined in: %s\n        (%s)\n", 'NO' === $h['guarded_exact'] ? 'FATAL' : 'ok', $h['snippet'], $h['kind'], $h['name'], $h['already_defined_in'], $h['title'] );
}
