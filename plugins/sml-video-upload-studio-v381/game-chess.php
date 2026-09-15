<?php
/**
 * Chess: complete rules, server-authoritative.
 *
 * Board is a flat 64-array, index 0 = a8 and index 63 = h1, so rank 8 is the
 * top of the array and White (seat 1) starts at the bottom. Pieces are two
 * characters: colour then type, e.g. 'wN', 'bQ'. Empty squares are ''.
 *
 * Legality is generated, never trusted: sml_chess_legal_moves() produces the
 * full list for the side to move and a submitted move is accepted only if it
 * appears in that list. That makes castling-through-check, pinned pieces and
 * en-passant discovered checks all fall out of one filter rather than needing
 * their own special cases.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_chess_new_state')) {
    function sml_chess_new_state() {
        $back = array('R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R');
        $board = array_fill(0, 64, '');
        for ($i = 0; $i < 8; $i++) {
            $board[$i]      = 'b' . $back[$i];
            $board[8 + $i]  = 'bP';
            $board[48 + $i] = 'wP';
            $board[56 + $i] = 'w' . $back[$i];
        }
        return array(
            'board'    => $board,
            'castle'   => array('wk' => true, 'wq' => true, 'bk' => true, 'bq' => true),
            'ep'       => -1,
            'halfmove' => 0,
            'seen'     => array(),
            'last'     => array(),
            'check'    => false,
            'result'   => '',
        );
    }
}

if (!function_exists('sml_chess_colour')) {
    function sml_chess_colour($seat) {
        return $seat === 1 ? 'w' : 'b';
    }
}

if (!function_exists('sml_chess_at')) {
    function sml_chess_at($board, $idx) {
        return ($idx >= 0 && $idx < 64) ? (string) $board[$idx] : '';
    }
}

/* ==================================================================
 * Pseudo-legal generation
 * ================================================================== */

if (!function_exists('sml_chess_slide')) {
    function sml_chess_slide($board, $from, $dirs, $me, $once = false) {
        $out = array();
        $r0 = intdiv($from, 8);
        $c0 = $from % 8;
        foreach ($dirs as $d) {
            $step = 1;
            while (true) {
                $r = $r0 + ($d[0] * $step);
                $c = $c0 + ($d[1] * $step);
                if ($r < 0 || $r > 7 || $c < 0 || $c > 7) {
                    break;
                }
                $to = ($r * 8) + $c;
                $piece = sml_chess_at($board, $to);
                if ($piece === '') {
                    $out[] = $to;
                } else {
                    if ($piece[0] !== $me) {
                        $out[] = $to;
                    }
                    break;
                }
                if ($once) {
                    break;
                }
                $step++;
            }
        }
        return $out;
    }
}

if (!function_exists('sml_chess_pseudo')) {
    /**
     * Every move the piece on $from could make ignoring king safety.
     * Returns array of array(from, to, promo).
     */
    function sml_chess_pseudo($state, $from) {
        $board = $state['board'];
        $piece = sml_chess_at($board, $from);
        if ($piece === '') {
            return array();
        }
        $me = $piece[0];
        $type = $piece[1];
        $foe = $me === 'w' ? 'b' : 'w';
        $out = array();

        $diag = array(array(-1, -1), array(-1, 1), array(1, -1), array(1, 1));
        $orth = array(array(-1, 0), array(1, 0), array(0, -1), array(0, 1));

        if ($type === 'P') {
            $dir = $me === 'w' ? -1 : 1;         // white marches toward index 0
            $startRow = $me === 'w' ? 6 : 1;
            $lastRow = $me === 'w' ? 0 : 7;
            $r0 = intdiv($from, 8);
            $c0 = $from % 8;

            $one = (($r0 + $dir) * 8) + $c0;
            if ($r0 + $dir >= 0 && $r0 + $dir <= 7 && sml_chess_at($board, $one) === '') {
                sml_chess_push_pawn($out, $from, $one, ($r0 + $dir) === $lastRow);
                $two = (($r0 + ($dir * 2)) * 8) + $c0;
                if ($r0 === $startRow && sml_chess_at($board, $two) === '') {
                    $out[] = array($from, $two, '');
                }
            }
            foreach (array(-1, 1) as $dc) {
                $r = $r0 + $dir;
                $c = $c0 + $dc;
                if ($r < 0 || $r > 7 || $c < 0 || $c > 7) {
                    continue;
                }
                $to = ($r * 8) + $c;
                $target = sml_chess_at($board, $to);
                if ($target !== '' && $target[0] === $foe) {
                    sml_chess_push_pawn($out, $from, $to, $r === $lastRow);
                } elseif ($target === '' && (int) $state['ep'] === $to) {
                    $out[] = array($from, $to, '');
                }
            }
            return $out;
        }

        if ($type === 'N') {
            $jumps = array(
                array(-2, -1), array(-2, 1), array(-1, -2), array(-1, 2),
                array(1, -2), array(1, 2), array(2, -1), array(2, 1),
            );
            $r0 = intdiv($from, 8);
            $c0 = $from % 8;
            foreach ($jumps as $j) {
                $r = $r0 + $j[0];
                $c = $c0 + $j[1];
                if ($r < 0 || $r > 7 || $c < 0 || $c > 7) {
                    continue;
                }
                $to = ($r * 8) + $c;
                $target = sml_chess_at($board, $to);
                if ($target === '' || $target[0] !== $me) {
                    $out[] = array($from, $to, '');
                }
            }
            return $out;
        }

        if ($type === 'B') {
            $squares = sml_chess_slide($board, $from, $diag, $me);
        } elseif ($type === 'R') {
            $squares = sml_chess_slide($board, $from, $orth, $me);
        } elseif ($type === 'Q') {
            $squares = sml_chess_slide($board, $from, array_merge($diag, $orth), $me);
        } elseif ($type === 'K') {
            $squares = sml_chess_slide($board, $from, array_merge($diag, $orth), $me, true);
        } else {
            $squares = array();
        }
        foreach ($squares as $to) {
            $out[] = array($from, $to, '');
        }
        return $out;
    }
}

if (!function_exists('sml_chess_push_pawn')) {
    function sml_chess_push_pawn(&$out, $from, $to, $promoting) {
        if ($promoting) {
            foreach (array('Q', 'R', 'B', 'N') as $p) {
                $out[] = array($from, $to, $p);
            }
            return;
        }
        $out[] = array($from, $to, '');
    }
}

/* ==================================================================
 * Attacks and check
 * ================================================================== */

if (!function_exists('sml_chess_attacked')) {
    /** Is $square attacked by side $by? Pawn direction handled explicitly. */
    function sml_chess_attacked($board, $square, $by) {
        $r0 = intdiv($square, 8);
        $c0 = $square % 8;

        // Pawns: a white pawn attacks toward lower indices, so a square is
        // attacked by white from the rank below it.
        $pawnRow = $by === 'w' ? $r0 + 1 : $r0 - 1;
        if ($pawnRow >= 0 && $pawnRow <= 7) {
            foreach (array(-1, 1) as $dc) {
                $c = $c0 + $dc;
                if ($c < 0 || $c > 7) {
                    continue;
                }
                if (sml_chess_at($board, ($pawnRow * 8) + $c) === $by . 'P') {
                    return true;
                }
            }
        }

        $jumps = array(
            array(-2, -1), array(-2, 1), array(-1, -2), array(-1, 2),
            array(1, -2), array(1, 2), array(2, -1), array(2, 1),
        );
        foreach ($jumps as $j) {
            $r = $r0 + $j[0];
            $c = $c0 + $j[1];
            if ($r < 0 || $r > 7 || $c < 0 || $c > 7) {
                continue;
            }
            if (sml_chess_at($board, ($r * 8) + $c) === $by . 'N') {
                return true;
            }
        }

        $diag = array(array(-1, -1), array(-1, 1), array(1, -1), array(1, 1));
        $orth = array(array(-1, 0), array(1, 0), array(0, -1), array(0, 1));

        foreach (array(array($diag, 'B'), array($orth, 'R')) as $set) {
            foreach ($set[0] as $d) {
                $step = 1;
                while (true) {
                    $r = $r0 + ($d[0] * $step);
                    $c = $c0 + ($d[1] * $step);
                    if ($r < 0 || $r > 7 || $c < 0 || $c > 7) {
                        break;
                    }
                    $piece = sml_chess_at($board, ($r * 8) + $c);
                    if ($piece !== '') {
                        if ($piece[0] === $by
                            && ($piece[1] === $set[1] || $piece[1] === 'Q'
                                || ($step === 1 && $piece[1] === 'K'))) {
                            return true;
                        }
                        break;
                    }
                    $step++;
                }
            }
        }
        return false;
    }
}

if (!function_exists('sml_chess_king')) {
    function sml_chess_king($board, $colour) {
        foreach ($board as $i => $piece) {
            if ($piece === $colour . 'K') {
                return (int) $i;
            }
        }
        return -1;
    }
}

if (!function_exists('sml_chess_in_check')) {
    function sml_chess_in_check($board, $colour) {
        $king = sml_chess_king($board, $colour);
        if ($king < 0) {
            return false;
        }
        return sml_chess_attacked($board, $king, $colour === 'w' ? 'b' : 'w');
    }
}

/* ==================================================================
 * Applying a move to a board
 * ================================================================== */

if (!function_exists('sml_chess_make')) {
    /** Apply without legality checking. Returns the new state. */
    function sml_chess_make($state, $move) {
        list($from, $to, $promo) = $move;
        $board = $state['board'];
        $piece = sml_chess_at($board, $from);
        $me = $piece[0];
        $type = $piece[1];
        $captured = sml_chess_at($board, $to);

        $board[$from] = '';
        $board[$to] = $piece;

        // En passant: the captured pawn is not on the landing square.
        if ($type === 'P' && (int) $state['ep'] === $to && $captured === '') {
            $victim = $me === 'w' ? $to + 8 : $to - 8;
            $captured = sml_chess_at($board, $victim);
            $board[$victim] = '';
        }

        if ($type === 'P' && $promo !== '') {
            $board[$to] = $me . $promo;
        }

        // Castling moves the rook too.
        if ($type === 'K' && abs(($to % 8) - ($from % 8)) === 2) {
            if ($to === 62) { $board[63] = ''; $board[61] = 'wR'; }
            if ($to === 58) { $board[56] = ''; $board[59] = 'wR'; }
            if ($to === 6)  { $board[7]  = ''; $board[5]  = 'bR'; }
            if ($to === 2)  { $board[0]  = ''; $board[3]  = 'bR'; }
        }

        $castle = $state['castle'];
        if ($type === 'K') {
            if ($me === 'w') { $castle['wk'] = false; $castle['wq'] = false; }
            else { $castle['bk'] = false; $castle['bq'] = false; }
        }
        // A rook leaving, or being captured on, its home square kills the right.
        foreach (array(56 => 'wq', 63 => 'wk', 0 => 'bq', 7 => 'bk') as $sq => $right) {
            if ($from === $sq || $to === $sq) {
                $castle[$right] = false;
            }
        }

        $ep = -1;
        if ($type === 'P' && abs(intdiv($to, 8) - intdiv($from, 8)) === 2) {
            $ep = intdiv($from + $to, 2);
        }

        $state['board'] = $board;
        $state['castle'] = $castle;
        $state['ep'] = $ep;
        $state['halfmove'] = ($type === 'P' || $captured !== '')
            ? 0
            : ((int) $state['halfmove'] + 1);
        $state['last'] = array((int) $from, (int) $to);
        return $state;
    }
}

/* ==================================================================
 * Legal move list
 * ================================================================== */

if (!function_exists('sml_chess_legal_moves')) {
    function sml_chess_legal_moves($state, $colour) {
        $board = $state['board'];
        $legal = array();

        foreach ($board as $from => $piece) {
            if ($piece === '' || $piece[0] !== $colour) {
                continue;
            }
            foreach (sml_chess_pseudo($state, (int) $from) as $move) {
                $after = sml_chess_make($state, $move);
                if (!sml_chess_in_check($after['board'], $colour)) {
                    $legal[] = $move;
                }
            }
        }

        // Castling. Generated separately because the legality test is about
        // squares the king passes over, not just where it lands.
        $king = sml_chess_king($board, $colour);
        $home = $colour === 'w' ? 60 : 4;
        $foe = $colour === 'w' ? 'b' : 'w';
        if ($king === $home && !sml_chess_attacked($board, $home, $foe)) {
            $rights = $colour === 'w'
                ? array('wk' => array(61, 62, 63, array(61, 62)), 'wq' => array(59, 58, 56, array(59, 58, 57)))
                : array('bk' => array(5, 6, 7, array(5, 6)),      'bq' => array(3, 2, 0, array(3, 2, 1)));
            foreach ($rights as $right => $spec) {
                if (empty($state['castle'][$right])) {
                    continue;
                }
                if (sml_chess_at($board, $spec[2]) !== $colour . 'R') {
                    continue;
                }
                $clear = true;
                foreach ($spec[3] as $sq) {
                    if (sml_chess_at($board, $sq) !== '') {
                        $clear = false;
                        break;
                    }
                }
                if (!$clear) {
                    continue;
                }
                // The king may not pass through or land on an attacked square.
                if (sml_chess_attacked($board, $spec[0], $foe)
                    || sml_chess_attacked($board, $spec[1], $foe)) {
                    continue;
                }
                $legal[] = array($home, $spec[1], '');
            }
        }

        return $legal;
    }
}

/* ==================================================================
 * Draw detection
 * ================================================================== */

if (!function_exists('sml_chess_key')) {
    function sml_chess_key($state, $colour) {
        $c = $state['castle'];
        return implode('', $state['board']) . '|' . $colour
             . '|' . (empty($c['wk']) ? '' : 'K') . (empty($c['wq']) ? '' : 'Q')
             . (empty($c['bk']) ? '' : 'k') . (empty($c['bq']) ? '' : 'q')
             . '|' . (int) $state['ep'];
    }
}

if (!function_exists('sml_chess_thin')) {
    /** King v king, king+minor v king, and same-coloured-bishop endings. */
    function sml_chess_thin($board) {
        $men = array();
        foreach ($board as $i => $piece) {
            if ($piece === '' || $piece[1] === 'K') {
                continue;
            }
            if (in_array($piece[1], array('P', 'R', 'Q'), true)) {
                return false;
            }
            $men[] = array($piece, (int) $i);
        }
        if (count($men) <= 1) {
            return true;
        }
        if (count($men) === 2) {
            $a = $men[0];
            $b = $men[1];
            if ($a[0][1] === 'B' && $b[0][1] === 'B' && $a[0][0] !== $b[0][0]) {
                $sqA = (intdiv($a[1], 8) + ($a[1] % 8)) % 2;
                $sqB = (intdiv($b[1], 8) + ($b[1] % 8)) % 2;
                return $sqA === $sqB;
            }
        }
        return false;
    }
}

/* ==================================================================
 * Move entry point
 * ================================================================== */

if (!function_exists('sml_chess_move')) {
    function sml_chess_move($state, $seat, $move) {
        $me = sml_chess_colour($seat);
        $from = isset($move['from']) ? (int) $move['from'] : -1;
        $to   = isset($move['to']) ? (int) $move['to'] : -1;
        $promo = isset($move['promo']) ? strtoupper(substr((string) $move['promo'], 0, 1)) : '';
        if (!in_array($promo, array('Q', 'R', 'B', 'N'), true)) {
            $promo = '';
        }

        if ($from < 0 || $from > 63 || $to < 0 || $to > 63) {
            return array('error' => 'Off the board.');
        }
        $piece = sml_chess_at($state['board'], $from);
        if ($piece === '' || $piece[0] !== $me) {
            return array('error' => 'Not your piece.');
        }

        $legal = sml_chess_legal_moves($state, $me);
        $chosen = null;
        $needsPromo = false;
        foreach ($legal as $candidate) {
            if ($candidate[0] !== $from || $candidate[1] !== $to) {
                continue;
            }
            if ($candidate[2] !== '') {
                $needsPromo = true;
                if ($candidate[2] === ($promo ?: 'Q')) {
                    $chosen = $candidate;
                    break;
                }
                continue;
            }
            $chosen = $candidate;
            break;
        }
        if (!$chosen && $needsPromo) {
            $chosen = array($from, $to, 'Q');
        }
        if (!$chosen) {
            return array('error' => sml_chess_in_check($state['board'], $me)
                ? 'You are in check.'
                : 'That is not a legal move.');
        }

        $next = sml_chess_make($state, $chosen);
        $foe = $me === 'w' ? 'b' : 'w';

        $seen = (array) ($next['seen'] ?? array());
        $key = sml_chess_key($next, $foe);
        $seen[] = $key;
        if (count($seen) > 120) {
            $seen = array_slice($seen, -120);
        }
        $next['seen'] = $seen;

        $foeMoves = sml_chess_legal_moves($next, $foe);
        $foeInCheck = sml_chess_in_check($next['board'], $foe);
        $next['check'] = $foeInCheck;

        if (!$foeMoves) {
            if ($foeInCheck) {
                $next['result'] = 'checkmate';
                return array('state' => $next, 'winner' => $seat, 'done' => true);
            }
            $next['result'] = 'stalemate';
            return array('state' => $next, 'winner' => 0, 'done' => true);
        }
        if ((int) $next['halfmove'] >= 100) {
            $next['result'] = 'fifty-move rule';
            return array('state' => $next, 'winner' => 0, 'done' => true);
        }
        if (sml_chess_thin($next['board'])) {
            $next['result'] = 'insufficient material';
            return array('state' => $next, 'winner' => 0, 'done' => true);
        }
        $repeats = 0;
        foreach ($seen as $entry) {
            if ($entry === $key) {
                $repeats++;
            }
        }
        if ($repeats >= 3) {
            $next['result'] = 'threefold repetition';
            return array('state' => $next, 'winner' => 0, 'done' => true);
        }

        return array('state' => $next, 'next' => $seat === 1 ? 2 : 1);
    }
}
