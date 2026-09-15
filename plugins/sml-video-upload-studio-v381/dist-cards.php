<?php
/**
 * Loop Distribution - preview card generation.
 *
 * SVG is composed server-side and rasterised once per (entity, template,
 * aspect, content hash). No headless browser: WordPress.com will not run one.
 */

if (!defined('ABSPATH')) {
    exit;
}

// Bumping this busts every cached card hash and the font lookup, which is
// exactly what you want after changing the renderer or shipping a font.
define('SML_CARD_VERSION', '3');

if (!function_exists('sml_dist_card_dimensions')) {
    function sml_dist_card_dimensions($aspect) {
        $map = array(
            '1.91:1' => array(1200, 630),
            '1:1'    => array(1080, 1080),
            '2:3'    => array(1000, 1500),
            '9:16'   => array(1080, 1920),
        );
        return $map[$aspect] ?? $map['1.91:1'];
    }
}

if (!function_exists('sml_dist_card_platform_aspect')) {
    function sml_dist_card_platform_aspect($platform) {
        if (in_array($platform, array('instagram', 'threads'), true)) {
            return '1:1';
        }
        if ($platform === 'tiktok') {
            return '9:16';
        }
        if ($platform === 'pinterest') {
            return '2:3';
        }
        return '1.91:1';
    }
}

/* ==================================================================
 * SVG helpers
 * ================================================================== */

if (!function_exists('sml_dist_svg_escape')) {
    function sml_dist_svg_escape($text) {
        return htmlspecialchars((string) $text, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }
}

if (!function_exists('sml_dist_wrap_text')) {
    /**
     * Greedy wrap using an average glyph width. Exact metrics need the font
     * loaded; this is close enough at display sizes and never overflows because
     * the caller also shrinks the size when the line count is high.
     */
    function sml_dist_wrap_text($text, $max_width_px, $font_size, $max_lines) {
        $avg = $font_size * 0.52;
        $per_line = max(8, (int) floor($max_width_px / $avg));
        $words = preg_split('/\s+/u', trim((string) $text), -1, PREG_SPLIT_NO_EMPTY);

        $lines = array();
        $cur = '';
        foreach ($words as $w) {
            $try = $cur === '' ? $w : $cur . ' ' . $w;
            if (mb_strlen($try) <= $per_line) {
                $cur = $try;
            } else {
                if ($cur !== '') {
                    $lines[] = $cur;
                }
                $cur = $w;
                if (count($lines) >= $max_lines) {
                    break;
                }
            }
        }
        if ($cur !== '' && count($lines) < $max_lines) {
            $lines[] = $cur;
        }

        if (count($lines) >= $max_lines) {
            $lines = array_slice($lines, 0, $max_lines);
            $last = $lines[count($lines) - 1];
            if (mb_strlen($last) > $per_line - 1) {
                $lines[count($lines) - 1] = mb_substr($last, 0, $per_line - 1) . '…';
            }
        }
        return $lines;
    }
}

if (!function_exists('sml_dist_fit_title')) {
    /** Shrink until it fits the allowed line count. */
    function sml_dist_fit_title($title, $width, $sizes, $max_lines) {
        foreach ($sizes as $size) {
            $lines = sml_dist_wrap_text($title, $width, $size, $max_lines + 1);
            if (count($lines) <= $max_lines) {
                return array('size' => $size, 'lines' => $lines);
            }
        }
        $size = end($sizes);
        return array('size' => $size, 'lines' => sml_dist_wrap_text($title, $width, $size, $max_lines));
    }
}

/* ==================================================================
 * Card templates
 * ================================================================== */

if (!function_exists('sml_dist_card_svg')) {
    function sml_dist_card_svg($template, $facts, $aspect) {
        list($w, $h) = sml_dist_card_dimensions($aspect);
        $tall = in_array($aspect, array('9:16', '2:3'), true);
        $pad = $tall ? 90 : 72;
        $inner = $w - ($pad * 2);

        $head = '<svg xmlns="http://www.w3.org/2000/svg" width="' . $w . '" height="' . $h . '" viewBox="0 0 ' . $w . ' ' . $h . '" font-family="Inter, Helvetica, Arial, sans-serif">'
            . '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
            . '<stop offset="0%" stop-color="#0b1220"/><stop offset="100%" stop-color="#070c15"/>'
            . '</linearGradient></defs>'
            . '<rect width="' . $w . '" height="' . $h . '" fill="url(#bg)"/>'
            . '<rect x="0" y="0" width="10" height="' . $h . '" fill="#2b6cff"/>';

        $foot = '</svg>';

        switch ($template) {
            case 'levels':
                return $head . sml_dist_card_levels($facts, $w, $h, $pad, $inner, $tall) . $foot;
            case 'live':
                return $head . sml_dist_card_live($facts, $w, $h, $pad, $inner, $tall, false) . $foot;
            case 'replay':
                return $head . sml_dist_card_live($facts, $w, $h, $pad, $inner, $tall, true) . $foot;
            default:
                return $head . sml_dist_card_letter($facts, $w, $h, $pad, $inner, $tall) . $foot;
        }
    }
}

if (!function_exists('sml_dist_card_chips')) {
    function sml_dist_card_chips($symbols, $x, $y, $align_right = false, $width = 0) {
        $out = '';
        $chipW = 108;
        $gap = 12;
        $syms = array_slice((array) $symbols, 0, 3);
        $total = count($syms) * $chipW + (count($syms) - 1) * $gap;
        $cx = $align_right ? ($x + $width - $total) : $x;

        foreach ($syms as $s) {
            $label = '$' . strtoupper(is_array($s) ? $s['symbol'] : $s);
            $out .= '<rect x="' . $cx . '" y="' . ($y - 30) . '" width="' . $chipW . '" height="44" rx="10" fill="#132238" stroke="#2b6cff" stroke-width="1.5"/>'
                 . '<text x="' . ($cx + $chipW / 2) . '" y="' . ($y + 1) . '" fill="#63a4ff" font-size="21" font-weight="700" text-anchor="middle">'
                 . sml_dist_svg_escape($label) . '</text>';
            $cx += $chipW + $gap;
        }
        return $out;
    }
}

if (!function_exists('sml_dist_card_letter')) {
    function sml_dist_card_letter($f, $w, $h, $pad, $inner, $tall) {
        $out = '';

        $out .= '<text x="' . $pad . '" y="' . ($pad + 34) . '" fill="#8798ac" font-size="22" font-weight="800" letter-spacing="3">'
             . sml_dist_svg_escape(strtoupper($f['kicker'] ?? 'LOOP LETTER')) . '</text>';

        if (!empty($f['symbols'])) {
            $out .= sml_dist_card_chips($f['symbols'], $pad, $pad + 34, !$tall, $inner);
        }

        $sizes = $tall ? array(84, 72, 62, 54) : array(62, 54, 46, 40);
        $fit = sml_dist_fit_title($f['title'] ?? '', $inner, $sizes, $tall ? 5 : 3);
        $lineH = (int) round($fit['size'] * 1.22);
        $y = $tall ? (int) ($h * 0.32) : (int) ($h * 0.34);

        foreach ($fit['lines'] as $line) {
            $out .= '<text x="' . $pad . '" y="' . $y . '" fill="#e6edf5" font-size="' . $fit['size'] . '" font-weight="800" letter-spacing="-1">'
                 . sml_dist_svg_escape($line) . '</text>';
            $y += $lineH;
        }

        if (!empty($f['subtitle']) && !$tall) {
            $sub = sml_dist_wrap_text($f['subtitle'], $inner, 28, 2);
            $y += 12;
            foreach ($sub as $line) {
                $out .= '<text x="' . $pad . '" y="' . $y . '" fill="#8798ac" font-size="28">'
                     . sml_dist_svg_escape($line) . '</text>';
                $y += 38;
            }
        }

        $footY = $h - $pad - 8;
        $out .= '<line x1="' . $pad . '" y1="' . ($footY - 54) . '" x2="' . ($w - $pad) . '" y2="' . ($footY - 54) . '" stroke="#1e2a3a" stroke-width="2"/>';
        $out .= '<circle cx="' . ($pad + 20) . '" cy="' . ($footY - 12) . '" r="20" fill="#2b6cff"/>';
        $out .= '<text x="' . ($pad + 54) . '" y="' . ($footY - 4) . '" fill="#dbe6f2" font-size="26" font-weight="700">'
             . sml_dist_svg_escape($f['author'] ?? '') . '</text>';

        $meta = trim(($f['handle'] ? '@' . $f['handle'] : '') . ($f['read_minutes'] ? ' · ' . $f['read_minutes'] . ' min read' : ''));
        if ($meta) {
            $out .= '<text x="' . ($w - $pad) . '" y="' . ($footY - 4) . '" fill="#5d7189" font-size="23" text-anchor="end">'
                 . sml_dist_svg_escape($meta) . '</text>';
        }
        return $out;
    }
}

if (!function_exists('sml_dist_card_levels')) {
    function sml_dist_card_levels($f, $w, $h, $pad, $inner, $tall) {
        $out = '';
        $sym = strtoupper((string) ($f['symbol'] ?? ''));

        $out .= '<text x="' . $pad . '" y="' . ($pad + 40) . '" fill="#e6edf5" font-size="42" font-weight="800">'
             . sml_dist_svg_escape('$' . $sym) . '</text>';
        $out .= '<text x="' . ($pad + 30 + (mb_strlen($sym) + 1) * 26) . '" y="' . ($pad + 40) . '" fill="#8798ac" font-size="24" font-weight="800" letter-spacing="3">LEVELS</text>';

        if (!empty($f['timeframe'])) {
            $out .= '<text x="' . ($w - $pad) . '" y="' . ($pad + 40) . '" fill="#e0a336" font-size="22" font-weight="800" letter-spacing="2" text-anchor="end">'
                 . sml_dist_svg_escape(strtoupper($f['timeframe'])) . '</text>';
        }

        $cells = array(
            array('ENTRY',    $f['entry'] ?? '',    '#e6edf5'),
            array('STOP',     $f['stop'] ?? '',     '#ff566e'),
            array('TARGET 1', $f['target_1'] ?? '', '#22d97a'),
            array('TARGET 2', $f['target_2'] ?? '', '#22d97a'),
        );
        $cells = array_values(array_filter($cells, function ($c) {
            return trim((string) $c[1]) !== '';
        }));
        $n = max(1, count($cells));

        $boxY = $tall ? (int) ($h * 0.30) : 210;
        $boxH = 168;
        $cellW = (int) (($inner - ($n - 1) * 14) / $n);
        $x = $pad;

        foreach ($cells as $c) {
            $out .= '<rect x="' . $x . '" y="' . $boxY . '" width="' . $cellW . '" height="' . $boxH . '" rx="14" fill="#0d1622" stroke="#1e2a3a" stroke-width="2"/>';
            $out .= '<text x="' . ($x + $cellW / 2) . '" y="' . ($boxY + 52) . '" fill="#8798ac" font-size="21" font-weight="700" letter-spacing="1.5" text-anchor="middle">'
                 . sml_dist_svg_escape($c[0]) . '</text>';
            $out .= '<text x="' . ($x + $cellW / 2) . '" y="' . ($boxY + 118) . '" fill="' . $c[2] . '" font-size="46" font-weight="800" text-anchor="middle">'
                 . sml_dist_svg_escape($c[1]) . '</text>';
            $x += $cellW + 14;
        }

        // Sparkline from the price series if one was supplied.
        if (!empty($f['spark']) && count((array) $f['spark']) > 2) {
            $vals = array_values(array_map('floatval', (array) $f['spark']));
            $lo = min($vals);
            $hi = max($vals);
            $span = ($hi - $lo) ?: 1;
            $sy = $boxY + $boxH + 56;
            $sh = $tall ? 260 : 118;
            $pts = array();
            foreach ($vals as $i => $v) {
                $px = $pad + ($i / (count($vals) - 1)) * $inner;
                $py = $sy + (1 - ($v - $lo) / $span) * $sh;
                $pts[] = round($px, 1) . ',' . round($py, 1);
            }
            $up = end($vals) >= $vals[0];
            $out .= '<polyline points="' . implode(' ', $pts) . '" fill="none" stroke="' . ($up ? '#22d97a' : '#ff566e') . '" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>';
        }

        $footY = $h - $pad - 8;
        $out .= '<line x1="' . $pad . '" y1="' . ($footY - 54) . '" x2="' . ($w - $pad) . '" y2="' . ($footY - 54) . '" stroke="#1e2a3a" stroke-width="2"/>';
        $out .= '<circle cx="' . ($pad + 20) . '" cy="' . ($footY - 12) . '" r="20" fill="#2b6cff"/>';
        $out .= '<text x="' . ($pad + 54) . '" y="' . ($footY - 4) . '" fill="#dbe6f2" font-size="26" font-weight="700">'
             . sml_dist_svg_escape($f['author'] ?? '') . '</text>';

        // The disclosure rides on the card itself. A levels image that gets
        // screenshotted and reposted still carries the position statement.
        if (!empty($f['disclosure'])) {
            $out .= '<text x="' . ($w - $pad) . '" y="' . ($footY - 4) . '" fill="#e0a336" font-size="21" text-anchor="end">'
                 . sml_dist_svg_escape(sml_dist_truncate($f['disclosure'], 52)) . '</text>';
        }
        return $out;
    }
}

if (!function_exists('sml_dist_card_live')) {
    function sml_dist_card_live($f, $w, $h, $pad, $inner, $tall, $is_replay) {
        $out = '';

        if ($is_replay) {
            $out .= '<polygon points="' . $pad . ',' . ($pad + 12) . ' ' . ($pad + 26) . ',' . ($pad + 28) . ' ' . $pad . ',' . ($pad + 44) . '" fill="#63a4ff"/>';
            $out .= '<text x="' . ($pad + 44) . '" y="' . ($pad + 40) . '" fill="#63a4ff" font-size="26" font-weight="800" letter-spacing="3">REPLAY</text>';
        } else {
            $out .= '<circle cx="' . ($pad + 14) . '" cy="' . ($pad + 28) . '" r="14" fill="#ff2d4b"/>';
            $out .= '<text x="' . ($pad + 44) . '" y="' . ($pad + 40) . '" fill="#ff2d4b" font-size="26" font-weight="800" letter-spacing="3">LIVE NOW</text>';
        }

        if (!empty($f['symbols'])) {
            $out .= sml_dist_card_chips($f['symbols'], $pad, $pad + 34, !$tall, $inner);
        }

        $sizes = $tall ? array(92, 78, 66) : array(70, 60, 50);
        $fit = sml_dist_fit_title($f['title'] ?? '', $inner, $sizes, $tall ? 4 : 3);
        $y = $tall ? (int) ($h * 0.34) : (int) ($h * 0.40);
        $lineH = (int) round($fit['size'] * 1.2);

        foreach ($fit['lines'] as $line) {
            $out .= '<text x="' . $pad . '" y="' . $y . '" fill="#e6edf5" font-size="' . $fit['size'] . '" font-weight="800" letter-spacing="-1">'
                 . sml_dist_svg_escape($line) . '</text>';
            $y += $lineH;
        }

        if (!empty($f['duration']) && $is_replay) {
            $out .= '<rect x="' . $pad . '" y="' . ($y + 4) . '" width="150" height="46" rx="10" fill="#152234" stroke="#223146" stroke-width="2"/>';
            $out .= '<text x="' . ($pad + 75) . '" y="' . ($y + 34) . '" fill="#a9b8ca" font-size="22" font-weight="700" text-anchor="middle">'
                 . sml_dist_svg_escape($f['duration']) . '</text>';
        }

        $footY = $h - $pad - 8;
        $out .= '<circle cx="' . ($pad + 20) . '" cy="' . ($footY - 12) . '" r="20" fill="#2b6cff"/>';
        $out .= '<text x="' . ($pad + 54) . '" y="' . ($footY - 4) . '" fill="#dbe6f2" font-size="26" font-weight="700">'
             . sml_dist_svg_escape($f['author'] ?? '') . '</text>';
        $out .= '<text x="' . ($w - $pad) . '" y="' . ($footY - 4) . '" fill="#5d7189" font-size="23" text-anchor="end">stockmarketloop.com</text>';
        return $out;
    }
}

/* ==================================================================
 * Rasterise and cache
 * ================================================================== */

/* ==================================================================
 * GD renderer
 *
 * WordPress.com ships GD but not Imagick, so SVG cannot be rasterised.
 * Social scrapers will not accept an SVG og:image, so a real PNG has to be
 * drawn directly. GD needs a TrueType font for anything legible, which we
 * locate on the host rather than bundling one.
 * ================================================================== */

if (!function_exists('sml_dist_font')) {
    function sml_dist_font() {
        // Keyed on the card version so shipping a font in a new release is
        // picked up immediately instead of waiting out a day-long transient.
        $key = 'sml_dist_font_v' . SML_CARD_VERSION;
        $cached = get_transient($key);
        if ($cached !== false) {
            return $cached ?: null;
        }

        $candidates = apply_filters('sml_dist_font_candidates', array(
            __DIR__ . '/assets/card.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
            '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
            '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
            '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
            '/usr/share/fonts/liberation/LiberationSans-Bold.ttf',
            '/System/Library/Fonts/Helvetica.ttc',
            ABSPATH . 'wp-includes/fonts/dashicons.ttf',
        ));

        $found = '';
        foreach ($candidates as $path) {
            if ($path && @is_readable($path) && substr($path, -13) !== 'dashicons.ttf') {
                $found = $path;
                break;
            }
        }

        // A hit is cached for a day; a miss for five minutes, so a fix does
        // not have to wait out a stale negative.
        set_transient($key, $found, $found ? DAY_IN_SECONDS : 5 * MINUTE_IN_SECONDS);
        return $found ?: null;
    }
}

if (!function_exists('sml_dist_hex')) {
    function sml_dist_hex($im, $hex) {
        $hex = ltrim((string) $hex, '#');
        if (strlen($hex) === 3) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        return imagecolorallocate($im,
            hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2)));
    }
}

if (!function_exists('sml_dist_gd_text')) {
    /** @return array [width, height] of the drawn text. */
    function sml_dist_gd_text($im, $text, $x, $y, $size, $hex, $font, $anchor = 'left') {
        $text = (string) $text;
        if ($text === '') {
            return array(0, 0);
        }
        $colour = sml_dist_hex($im, $hex);

        if ($font) {
            $box = imagettfbbox($size, 0, $font, $text);
            $w = abs($box[4] - $box[0]);
            $h = abs($box[5] - $box[1]);
            if ($anchor === 'right') {
                $x -= $w;
            } elseif ($anchor === 'center') {
                $x -= (int) ($w / 2);
            }
            imagettftext($im, $size, 0, (int) $x, (int) $y, $colour, $font, $text);
            return array($w, $h);
        }

        // No TrueType font on the host. GD's bitmap fonts top out at ~15px,
        // which would look broken at card size, so we do not pretend.
        $w = imagefontwidth(5) * strlen($text);
        if ($anchor === 'right')  { $x -= $w; }
        if ($anchor === 'center') { $x -= (int) ($w / 2); }
        imagestring($im, 5, (int) $x, (int) $y - 14, $text, $colour);
        return array($w, imagefontheight(5));
    }
}

if (!function_exists('sml_dist_gd_wrap')) {
    function sml_dist_gd_wrap($text, $max_width, $size, $font, $max_lines) {
        $words = preg_split('/\s+/u', trim((string) $text), -1, PREG_SPLIT_NO_EMPTY);
        $lines = array();
        $cur = '';

        $width = function ($s) use ($size, $font) {
            if (!$font) {
                return imagefontwidth(5) * strlen($s);
            }
            $b = imagettfbbox($size, 0, $font, $s);
            return abs($b[4] - $b[0]);
        };

        foreach ($words as $word) {
            $try = $cur === '' ? $word : $cur . ' ' . $word;
            if ($width($try) <= $max_width) {
                $cur = $try;
            } else {
                if ($cur !== '') {
                    $lines[] = $cur;
                }
                $cur = $word;
                if (count($lines) >= $max_lines) {
                    break;
                }
            }
        }
        if ($cur !== '' && count($lines) < $max_lines) {
            $lines[] = $cur;
        }
        if (count($lines) > $max_lines) {
            $lines = array_slice($lines, 0, $max_lines);
        }
        return $lines;
    }
}

if (!function_exists('sml_dist_gd_rounded')) {
    function sml_dist_gd_rounded($im, $x, $y, $w, $h, $r, $fill_hex, $stroke_hex = '') {
        $fill = sml_dist_hex($im, $fill_hex);
        imagefilledrectangle($im, $x + $r, $y, $x + $w - $r, $y + $h, $fill);
        imagefilledrectangle($im, $x, $y + $r, $x + $w, $y + $h - $r, $fill);
        foreach (array(array($x + $r, $y + $r), array($x + $w - $r, $y + $r),
                       array($x + $r, $y + $h - $r), array($x + $w - $r, $y + $h - $r)) as $c) {
            imagefilledellipse($im, $c[0], $c[1], $r * 2, $r * 2, $fill);
        }
        if ($stroke_hex) {
            $stroke = sml_dist_hex($im, $stroke_hex);
            imagesetthickness($im, 2);
            imagerectangle($im, $x, $y, $x + $w, $y + $h, $stroke);
            imagesetthickness($im, 1);
        }
    }
}

if (!function_exists('sml_dist_gd_card')) {
    function sml_dist_gd_card($template, $f, $w, $h) {
        $im = imagecreatetruecolor($w, $h);
        imagealphablending($im, true);
        $font = sml_dist_font();

        imagefilledrectangle($im, 0, 0, $w, $h, sml_dist_hex($im, '#0a1220'));
        imagefilledrectangle($im, 0, 0, 10, $h, sml_dist_hex($im, '#2b6cff'));

        $tall = $h > $w;
        $pad = $tall ? 80 : 68;
        $inner = $w - ($pad * 2);
        $syms = array_slice((array) ($f['symbols'] ?? array()), 0, 3);

        // Kicker
        $kicker = $template === 'levels'
            ? '$' . strtoupper((string) ($f['symbol'] ?? '')) . '  LEVELS'
            : strtoupper((string) ($f['kicker'] ?? 'LOOP LETTER'));
        sml_dist_gd_text($im, $kicker, $pad, $pad + 26, 22, '#8798ac', $font);

        // Ticker chips, top right
        if ($syms && !$tall) {
            $chipW = 104;
            $gap = 12;
            $x = $w - $pad - (count($syms) * $chipW + (count($syms) - 1) * $gap);
            foreach ($syms as $s) {
                sml_dist_gd_rounded($im, $x, $pad, $chipW, 44, 10, '#132238', '#2b6cff');
                sml_dist_gd_text($im, '$' . strtoupper($s), $x + ($chipW / 2), $pad + 30, 19, '#63a4ff', $font, 'center');
                $x += $chipW + $gap;
            }
        }

        if ($template === 'levels') {
            $cells = array(
                array('ENTRY',    $f['entry'] ?? '',    '#e6edf5'),
                array('STOP',     $f['stop'] ?? '',     '#ff566e'),
                array('TARGET 1', $f['target_1'] ?? '', '#22d97a'),
                array('TARGET 2', $f['target_2'] ?? '', '#22d97a'),
            );
            $cells = array_values(array_filter($cells, function ($c) {
                return trim((string) $c[1]) !== '';
            }));
            $n = max(1, count($cells));

            $boxY = $tall ? (int) ($h * 0.28) : 190;
            $boxH = 160;
            $cellW = (int) (($inner - ($n - 1) * 14) / $n);
            $x = $pad;
            foreach ($cells as $c) {
                sml_dist_gd_rounded($im, $x, $boxY, $cellW, $boxH, 14, '#0d1622', '#1e2a3a');
                sml_dist_gd_text($im, $c[0], $x + ($cellW / 2), $boxY + 48, 18, '#8798ac', $font, 'center');
                sml_dist_gd_text($im, $c[1], $x + ($cellW / 2), $boxY + 112, 40, $c[2], $font, 'center');
                $x += $cellW + 14;
            }

            // Sparkline
            $spark = (array) ($f['spark'] ?? array());
            if (count($spark) > 2) {
                $vals = array_map('floatval', array_values($spark));
                $lo = min($vals);
                $hi = max($vals);
                $span = ($hi - $lo) ?: 1;
                $sy = $boxY + $boxH + 46;
                $sh = $tall ? 240 : 108;
                $up = end($vals) >= $vals[0];
                $line = sml_dist_hex($im, $up ? '#22d97a' : '#ff566e');
                imagesetthickness($im, 4);
                $px = null;
                $py = null;
                foreach ($vals as $i => $v) {
                    $cx = $pad + ($i / (count($vals) - 1)) * $inner;
                    $cy = $sy + (1 - ($v - $lo) / $span) * $sh;
                    if ($px !== null) {
                        imageline($im, (int) $px, (int) $py, (int) $cx, (int) $cy, $line);
                    }
                    $px = $cx;
                    $py = $cy;
                }
                imagesetthickness($im, 1);
            }
        } else {
            $size = $tall ? 62 : 50;
            $lines = sml_dist_gd_wrap((string) ($f['title'] ?? ''), $inner, $size, $font, $tall ? 5 : 3);
            while (count($lines) > ($tall ? 5 : 3) && $size > 30) {
                $size -= 6;
                $lines = sml_dist_gd_wrap((string) ($f['title'] ?? ''), $inner, $size, $font, $tall ? 5 : 3);
            }
            $y = $tall ? (int) ($h * 0.30) : (int) ($h * 0.33);
            foreach ($lines as $line) {
                sml_dist_gd_text($im, $line, $pad, $y, $size, '#e6edf5', $font);
                $y += (int) ($size * 1.28);
            }

            if (!empty($f['subtitle']) && !$tall) {
                $sub = sml_dist_gd_wrap((string) $f['subtitle'], $inner, 25, $font, 2);
                $y += 14;
                foreach ($sub as $line) {
                    sml_dist_gd_text($im, $line, $pad, $y, 25, '#8798ac', $font);
                    $y += 36;
                }
            }
        }

        // Footer
        $footY = $h - $pad;
        imagesetthickness($im, 2);
        imageline($im, $pad, $footY - 54, $w - $pad, $footY - 54, sml_dist_hex($im, '#1e2a3a'));
        imagesetthickness($im, 1);
        imagefilledellipse($im, $pad + 20, $footY - 18, 40, 40, sml_dist_hex($im, '#2b6cff'));
        sml_dist_gd_text($im, (string) ($f['author'] ?? ''), $pad + 54, $footY - 8, 24, '#dbe6f2', $font);

        $right = $template === 'levels' && !empty($f['disclosure'])
            ? sml_dist_truncate($f['disclosure'], 46)
            : trim(($f['handle'] ? '@' . $f['handle'] : '')
                 . ($f['read_minutes'] ? '  ·  ' . $f['read_minutes'] . ' min read' : ''));
        if ($right) {
            sml_dist_gd_text($im, $right, $w - $pad, $footY - 8, 21,
                ($template === 'levels' && !empty($f['disclosure'])) ? '#e0a336' : '#5d7189', $font, 'right');
        }

        ob_start();
        imagepng($im, null, 6);
        $data = ob_get_clean();
        imagedestroy($im);
        return $data;
    }
}

if (!function_exists('sml_dist_rasterise')) {
    /**
     * @return array|null ['data'=>binary, 'mime'=>..., 'ext'=>...]
     */
    function sml_dist_rasterise($svg, $w, $h, $template = 'letter', $facts = array()) {
        if (class_exists('Imagick')) {
            try {
                $im = new Imagick();
                $im->setBackgroundColor(new ImagickPixel('#070c15'));
                $im->readImageBlob('<?xml version="1.0" encoding="UTF-8"?>' . $svg);
                $im->setImageFormat('png');
                $im->resizeImage($w, $h, Imagick::FILTER_LANCZOS, 1);
                $data = $im->getImageBlob();
                $im->clear();
                return array('data' => $data, 'mime' => 'image/png', 'ext' => 'png');
            } catch (Exception $e) {
                // Fall through to GD.
            }
        }

        if (function_exists('imagecreatetruecolor') && sml_dist_font()) {
            $png = sml_dist_gd_card($template, $facts, $w, $h);
            if ($png) {
                return array('data' => $png, 'mime' => 'image/png', 'ext' => 'png');
            }
        }

        // No rasteriser and no usable font. An SVG still renders in our own UI
        // and is better than nothing, but og:image falls back to the cover.
        return array('data' => $svg, 'mime' => 'image/svg+xml', 'ext' => 'svg');
    }
}

if (!function_exists('sml_dist_card_facts')) {
    function sml_dist_card_facts($bundle, $seo, $template) {
        $facts = array(
            'kicker'       => $bundle['entity_type'] === 'letter' ? 'Loop Letter' : 'StockMarketLoop',
            'title'        => $bundle['title'],
            'subtitle'     => $bundle['subtitle'],
            'author'       => $bundle['author']['name'],
            'handle'       => $bundle['author']['handle'],
            'read_minutes' => $bundle['read_minutes'],
            'symbols'      => array_map(function ($s) { return $s['symbol']; }, $seo['symbols']),
        );

        if ($template === 'levels') {
            $lv = sml_dist_levels($bundle);
            if ($lv) {
                $facts = array_merge($facts, $lv);
            }
            $facts['disclosure'] = sml_dist_disclosure($bundle);
            $facts['spark'] = sml_dist_spark_series($facts['symbol'] ?? ($seo['primary'] ?: ''));
        }
        return $facts;
    }
}

if (!function_exists('sml_dist_spark_series')) {
    function sml_dist_spark_series($symbol) {
        $symbol = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $symbol));
        if (!$symbol) {
            return array();
        }
        $key = 'sml_dist_spark_' . strtolower($symbol);
        $cached = get_transient($key);
        if (is_array($cached)) {
            return $cached;
        }

        $url = rest_url('sml-trading-floor/v1/chart/' . rawurlencode($symbol)) . '?range=3M&interval=1d';
        $res = wp_remote_get($url, array('timeout' => 8, 'sslverify' => false));
        $out = array();
        if (!is_wp_error($res)) {
            $body = json_decode(wp_remote_retrieve_body($res), true);
            $bars = $body['data']['bars'] ?? ($body['bars'] ?? array());
            foreach ((array) $bars as $b) {
                if (isset($b['close'])) {
                    $out[] = (float) $b['close'];
                }
            }
            if (count($out) > 90) {
                $out = array_slice($out, -90);
            }
        }
        set_transient($key, $out, HOUR_IN_SECONDS);
        return $out;
    }
}

if (!function_exists('sml_dist_card')) {
    /**
     * Idempotent: same facts produce the same hash, which is a cache hit and
     * zero work. Regeneration only happens when the letter actually changed.
     */
    function sml_dist_card($bundle, $seo, $template = '', $aspect = '1.91:1') {
        global $wpdb;
        $table = sml_dist_table('cards');

        if (!$template) {
            $template = ($seo['content_type'] === 'Levels' && sml_dist_levels($bundle)) ? 'levels' : 'letter';
        }
        $facts = sml_dist_card_facts($bundle, $seo, $template);
        $hash = sha1(wp_json_encode($facts) . '|' . $template . '|' . $aspect . '|' . SML_CARD_VERSION);

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE entity_type = %s AND entity_id = %d
              AND template = %s AND aspect = %s",
            $bundle['entity_type'], $bundle['entity_id'], $template, $aspect
        ), ARRAY_A);

        if ($row && $row['content_hash'] === $hash && $row['url']) {
            return $row;
        }

        list($w, $h) = sml_dist_card_dimensions($aspect);
        $svg = sml_dist_card_svg($template, $facts, $aspect);
        $img = sml_dist_rasterise($svg, $w, $h, $template, $facts);
        if (!$img) {
            return null;
        }

        // Hash in the filename so a regenerated card busts every scraper cache
        // that already fetched the old one.
        $name = sprintf('card-%s-%d-%s-%s-%s.%s',
            $bundle['entity_type'], $bundle['entity_id'], $template,
            str_replace(array('.', ':'), '', $aspect), substr($hash, 0, 8), $img['ext']);

        $url = sml_dist_write_card_file($img['data'], $name);
        if (!$url) {
            return null;
        }

        $data = array(
            'entity_type'   => $bundle['entity_type'],
            'entity_id'     => (int) $bundle['entity_id'],
            'template'      => $template,
            'aspect'        => $aspect,
            'width'         => $w,
            'height'        => $h,
            'attachment_id' => null,
            'url'           => $url,
            'content_hash'  => $hash,
        );

        if ($row) {
            $wpdb->update($table, $data, array('id' => (int) $row['id']));
            $data['id'] = (int) $row['id'];
        } else {
            $wpdb->insert($table, $data);
            $data['id'] = (int) $wpdb->insert_id;
        }
        return $data;
    }
}

if (!function_exists('sml_dist_write_card_file')) {
    /**
     * Written straight into uploads/sml-cards/ rather than through the media
     * library. wp_upload_bits enforces the allowed-mime list, which rejects
     * SVG outright and made every card fail silently on the first deploy.
     *
     * @return string Public URL, or '' on failure.
     */
    function sml_dist_write_card_file($data, $filename) {
        $dir = wp_upload_dir();
        if (!empty($dir['error'])) {
            return '';
        }
        $folder = trailingslashit($dir['basedir']) . 'sml-cards';
        if (!file_exists($folder) && !wp_mkdir_p($folder)) {
            return '';
        }
        $name = sanitize_file_name($filename);
        $path = trailingslashit($folder) . $name;

        if (file_put_contents($path, $data) === false) {
            return '';
        }
        return trailingslashit($dir['baseurl']) . 'sml-cards/' . $name;
    }
}

if (!function_exists('sml_dist_card_diagnostics')) {
    function sml_dist_card_diagnostics() {
        $dir = wp_upload_dir();
        $folder = trailingslashit($dir['basedir']) . 'sml-cards';
        return array(
            'imagick'    => class_exists('Imagick'),
            'gd'         => function_exists('imagecreatetruecolor'),
            'freetype'   => function_exists('imagettftext'),
            'font'       => sml_dist_font() ?: 'NONE FOUND',
            'upload_dir' => empty($dir['error']) ? $dir['basedir'] : ('ERROR: ' . $dir['error']),
            'writable'   => empty($dir['error']) ? is_writable($dir['basedir']) : false,
            'folder'     => file_exists($folder) ? 'exists' : 'missing',
        );
    }
}
