<?php
/**
 * Card games: Spades and Blackjack.
 *
 * These are the first games with hidden information, so two rules apply
 * throughout:
 *
 *   1. Anything a player must not see lives in the private_state column, never
 *      in state. sml_*_redact() is the only path by which any of it reaches a
 *      client, and it takes the viewer's seat as an argument.
 *   2. Shuffles use random_int(), which draws from the OS CSPRNG. mt_rand is
 *      seedable and therefore predictable; for a dealt hand that is the whole
 *      ballgame.
 *
 * Points are cosmetic. Nothing here converts to money, and it must stay that
 * way -- wagering real value on these would make the site a gambling operator.
 */

if (!defined('ABSPATH')) {
    exit;
}

/* ==================================================================
 * Deck helpers
 * ================================================================== */

if (!function_exists('sml_cards_ranks')) {
    function sml_cards_ranks() {
        return array('2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A');
    }
}

if (!function_exists('sml_cards_deck')) {
    function sml_cards_deck($decks = 1) {
        $out = array();
        for ($d = 0; $d < $decks; $d++) {
            foreach (array('S', 'H', 'D', 'C') as $suit) {
                foreach (sml_cards_ranks() as $rank) {
                    $out[] = $rank . $suit;
                }
            }
        }
        return $out;
    }
}

if (!function_exists('sml_cards_shuffle')) {
    /** Fisher-Yates driven by the OS CSPRNG. */
    function sml_cards_shuffle($cards) {
        for ($i = count($cards) - 1; $i > 0; $i--) {
            try {
                $j = random_int(0, $i);
            } catch (Exception $e) {
                $j = 0;
            }
            $tmp = $cards[$i];
            $cards[$i] = $cards[$j];
            $cards[$j] = $tmp;
        }
        return $cards;
    }
}

if (!function_exists('sml_cards_rank_value')) {
    function sml_cards_rank_value($card) {
        $order = array_flip(sml_cards_ranks());
        $rank = substr((string) $card, 0, 1);
        return isset($order[$rank]) ? (int) $order[$rank] : -1;
    }
}

if (!function_exists('sml_cards_suit')) {
    function sml_cards_suit($card) {
        return substr((string) $card, -1);
    }
}

/* ==================================================================
 * Dealing hook, called by the API when a table starts
 * ================================================================== */

if (!function_exists('sml_game_deal')) {
    function sml_game_deal($game, $seats) {
        if ($game === 'spades') {
            return sml_spades_deal($seats);
        }
        if ($game === 'blackjack') {
            return sml_bj_deal($seats);
        }
        return null;
    }
}

/* ==================================================================
 * SPADES
 *
 * Four seats. Partnerships sit across: 1+3 against 2+4. Bid, then thirteen
 * tricks. First side to 500 wins; -200 loses.
 * ================================================================== */

if (!function_exists('sml_spades_new_state')) {
    function sml_spades_new_state() {
        return array(
            'phase'    => 'dealing',
            'bids'     => array(),
            'counts'   => array(1 => 13, 2 => 13, 3 => 13, 4 => 13),
            'trick'    => array(),
            'lead'     => 1,
            'leadSuit' => '',
            'broken'   => false,
            'won'      => array(1 => 0, 2 => 0, 3 => 0, 4 => 0),
            'scores'   => array('A' => 0, 'B' => 0),
            'bags'     => array('A' => 0, 'B' => 0),
            'hand'     => 1,
            'lastTrick' => array(),
            'log'      => array(),
        );
    }
}

if (!function_exists('sml_spades_new_private')) {
    function sml_spades_new_private() {
        return array('hands' => array());
    }
}

if (!function_exists('sml_spades_team')) {
    /** Seats 1 and 3 are team A; 2 and 4 are team B. */
    function sml_spades_team($seat) {
        return ((int) $seat % 2) === 1 ? 'A' : 'B';
    }
}

if (!function_exists('sml_spades_sort_hand')) {
    function sml_spades_sort_hand($hand) {
        $suitOrder = array('S' => 0, 'H' => 1, 'C' => 2, 'D' => 3);
        usort($hand, function ($a, $b) use ($suitOrder) {
            $sa = $suitOrder[sml_cards_suit($a)];
            $sb = $suitOrder[sml_cards_suit($b)];
            if ($sa !== $sb) {
                return $sa - $sb;
            }
            return sml_cards_rank_value($b) - sml_cards_rank_value($a);
        });
        return $hand;
    }
}

if (!function_exists('sml_spades_deal')) {
    function sml_spades_deal($seats) {
        $deck = sml_cards_shuffle(sml_cards_deck(1));
        $state = sml_spades_new_state();
        $hands = array();
        $i = 0;
        foreach (array(1, 2, 3, 4) as $seat) {
            $hands[$seat] = sml_spades_sort_hand(array_slice($deck, $i, 13));
            $i += 13;
        }
        $state['phase'] = 'bidding';
        $state['lead'] = 1;
        return array(
            'state'   => $state,
            'private' => array('hands' => $hands),
            'turn'    => 1,
        );
    }
}

if (!function_exists('sml_spades_redact')) {
    function sml_spades_redact($state, $private, $seat) {
        $state = (array) $state;
        $hands = (array) ($private['hands'] ?? array());
        // Your own cards, and nobody else's. Spectators get none.
        $state['hand_cards'] = ($seat >= 1 && $seat <= 4 && isset($hands[$seat]))
            ? array_values((array) $hands[$seat])
            : array();
        $state['counts'] = array();
        foreach (array(1, 2, 3, 4) as $n) {
            $state['counts'][$n] = isset($hands[$n]) ? count((array) $hands[$n]) : 0;
        }
        return $state;
    }
}

if (!function_exists('sml_spades_legal_cards')) {
    /**
     * Follow suit if you can. If you cannot, anything goes. Spades may not be
     * led until someone has been forced to trump, unless spades are all you
     * hold.
     */
    function sml_spades_legal_cards($state, $hand) {
        $hand = array_values((array) $hand);
        $leadSuit = (string) $state['leadSuit'];

        if ($leadSuit !== '') {
            $following = array();
            foreach ($hand as $card) {
                if (sml_cards_suit($card) === $leadSuit) {
                    $following[] = $card;
                }
            }
            return $following ? $following : $hand;
        }

        if (empty($state['broken'])) {
            $nonSpades = array();
            foreach ($hand as $card) {
                if (sml_cards_suit($card) !== 'S') {
                    $nonSpades[] = $card;
                }
            }
            return $nonSpades ? $nonSpades : $hand;
        }
        return $hand;
    }
}

if (!function_exists('sml_spades_trick_winner')) {
    function sml_spades_trick_winner($trick, $leadSuit) {
        $bestSeat = 0;
        $bestVal = -1;
        $trumped = false;
        foreach ($trick as $seat => $card) {
            $suit = sml_cards_suit($card);
            $val = sml_cards_rank_value($card);
            if ($suit === 'S') {
                if (!$trumped || $val > $bestVal) {
                    $trumped = true;
                    $bestVal = $val;
                    $bestSeat = (int) $seat;
                }
                continue;
            }
            if ($trumped || $suit !== $leadSuit) {
                continue;
            }
            if ($val > $bestVal) {
                $bestVal = $val;
                $bestSeat = (int) $seat;
            }
        }
        return $bestSeat;
    }
}

if (!function_exists('sml_spades_score_hand')) {
    function sml_spades_score_hand($state) {
        $bids = (array) $state['bids'];
        $won = (array) $state['won'];

        foreach (array('A', 'B') as $team) {
            $seats = $team === 'A' ? array(1, 3) : array(2, 4);
            $bid = 0;
            $tricks = 0;
            $nilScore = 0;

            foreach ($seats as $seat) {
                $b = (int) ($bids[$seat] ?? 0);
                $t = (int) ($won[$seat] ?? 0);
                $tricks += $t;
                if ($b === 0) {
                    // Nil: 100 if you take nothing, -100 if you take anything.
                    $nilScore += $t === 0 ? 100 : -100;
                } else {
                    $bid += $b;
                }
            }

            if ($bid > 0 && $tricks >= $bid) {
                $bags = $tricks - $bid;
                $state['scores'][$team] += ($bid * 10) + $bags;
                $state['bags'][$team] += $bags;
                // Ten bags costs a hundred. It is the whole reason not to
                // hoover up tricks you never bid for.
                while ($state['bags'][$team] >= 10) {
                    $state['bags'][$team] -= 10;
                    $state['scores'][$team] -= 100;
                }
            } elseif ($bid > 0) {
                $state['scores'][$team] -= $bid * 10;
            }
            $state['scores'][$team] += $nilScore;
        }
        return $state;
    }
}

if (!function_exists('sml_spades_move')) {
    function sml_spades_move($state, $private, $seat, $move) {
        $state = (array) $state;
        $private = (array) $private;
        $hands = (array) ($private['hands'] ?? array());
        $action = isset($move['action']) ? (string) $move['action'] : 'play';

        /* ---- bidding ---- */
        if ($state['phase'] === 'bidding') {
            if ($action !== 'bid') {
                return array('error' => 'Place your bid first.');
            }
            $bid = isset($move['bid']) ? (int) $move['bid'] : -1;
            if ($bid < 0 || $bid > 13) {
                return array('error' => 'Bid between 0 and 13.');
            }
            if (isset($state['bids'][$seat])) {
                return array('error' => 'You already bid.');
            }
            $state['bids'][$seat] = $bid;

            if (count($state['bids']) < 4) {
                $next = ($seat % 4) + 1;
                return array('state' => $state, 'private' => $private, 'next' => $next);
            }
            $state['phase'] = 'playing';
            $state['lead'] = 1;
            return array('state' => $state, 'private' => $private, 'next' => 1);
        }

        if ($state['phase'] !== 'playing') {
            return array('error' => 'This hand is over.');
        }
        if ($action !== 'play') {
            return array('error' => 'Play a card.');
        }

        /* ---- playing a card ---- */
        $card = strtoupper(trim((string) ($move['card'] ?? '')));
        $hand = array_values((array) ($hands[$seat] ?? array()));
        if (!in_array($card, $hand, true)) {
            return array('error' => 'That card is not in your hand.');
        }
        $legal = sml_spades_legal_cards($state, $hand);
        if (!in_array($card, $legal, true)) {
            return array('error' => $state['leadSuit'] !== ''
                ? 'You must follow ' . sml_spades_suit_name($state['leadSuit']) . '.'
                : 'Spades have not been broken yet.');
        }

        $hands[$seat] = array_values(array_diff($hand, array($card)));
        $private['hands'] = $hands;

        $state['trick'][$seat] = $card;
        if ($state['leadSuit'] === '') {
            $state['leadSuit'] = sml_cards_suit($card);
        }
        if (sml_cards_suit($card) === 'S') {
            $state['broken'] = true;
        }

        if (count($state['trick']) < 4) {
            return array('state' => $state, 'private' => $private, 'next' => ($seat % 4) + 1);
        }

        /* ---- trick complete ---- */
        $winner = sml_spades_trick_winner($state['trick'], $state['leadSuit']);
        $state['won'][$winner] = (int) ($state['won'][$winner] ?? 0) + 1;
        $state['lastTrick'] = array(
            'cards'  => $state['trick'],
            'winner' => $winner,
            'suit'   => $state['leadSuit'],
        );
        $state['trick'] = array();
        $state['leadSuit'] = '';
        $state['lead'] = $winner;

        $cardsLeft = 0;
        foreach ($hands as $h) {
            $cardsLeft += count((array) $h);
        }
        if ($cardsLeft > 0) {
            return array('state' => $state, 'private' => $private, 'next' => $winner);
        }

        /* ---- hand complete ---- */
        $state = sml_spades_score_hand($state);
        $state['log'][] = array(
            'hand'   => (int) $state['hand'],
            'bids'   => $state['bids'],
            'won'    => $state['won'],
            'scores' => $state['scores'],
        );

        $a = (int) $state['scores']['A'];
        $b = (int) $state['scores']['B'];
        if ($a >= 500 || $b >= 500 || $a <= -200 || $b <= -200) {
            $state['phase'] = 'finished';
            // Seat 1 stands for team A, seat 2 for team B.
            $winnerSeat = 0;
            if ($a !== $b) {
                $winnerSeat = $a > $b ? 1 : 2;
            }
            return array('state' => $state, 'private' => $private,
                'winner' => $winnerSeat, 'done' => true);
        }

        // Next hand: fresh deal, bids cleared, dealer rotates.
        $deal = sml_spades_deal(array(1, 2, 3, 4));
        $fresh = $deal['state'];
        $fresh['scores'] = $state['scores'];
        $fresh['bags'] = $state['bags'];
        $fresh['hand'] = (int) $state['hand'] + 1;
        $fresh['log'] = $state['log'];
        $lead = (((int) $state['hand']) % 4) + 1;
        $fresh['lead'] = $lead;
        return array('state' => $fresh, 'private' => $deal['private'], 'next' => $lead);
    }
}

if (!function_exists('sml_spades_suit_name')) {
    function sml_spades_suit_name($suit) {
        $names = array('S' => 'spades', 'H' => 'hearts', 'D' => 'diamonds', 'C' => 'clubs');
        return isset($names[$suit]) ? $names[$suit] : 'suit';
    }
}

/* ==================================================================
 * BLACKJACK
 *
 * Six-deck shoe, dealer stands on all seventeens, blackjack pays 3:2.
 * Chips are play money and are reset every table.
 * ================================================================== */

if (!function_exists('sml_bj_new_state')) {
    function sml_bj_new_state() {
        return array(
            'phase'   => 'dealing',
            'dealer'  => array('cards' => array(), 'hole' => true, 'total' => 0),
            'players' => array(),
            'order'   => array(),
            'active'  => 0,
            'round'   => 1,
            'message' => '',
        );
    }
}

if (!function_exists('sml_bj_new_private')) {
    function sml_bj_new_private() {
        return array('shoe' => array(), 'hole' => '');
    }
}

if (!function_exists('sml_bj_total')) {
    /** Best total not busting; aces drop from 11 to 1 as needed. */
    function sml_bj_total($cards) {
        $total = 0;
        $aces = 0;
        foreach ((array) $cards as $card) {
            $rank = substr((string) $card, 0, 1);
            if ($rank === 'A') {
                $aces++;
                $total += 11;
            } elseif (in_array($rank, array('T', 'J', 'Q', 'K'), true)) {
                $total += 10;
            } else {
                $total += (int) $rank;
            }
        }
        while ($total > 21 && $aces > 0) {
            $total -= 10;
            $aces--;
        }
        return $total;
    }
}

if (!function_exists('sml_bj_soft')) {
    function sml_bj_soft($cards) {
        $hard = 0;
        $aces = 0;
        foreach ((array) $cards as $card) {
            $rank = substr((string) $card, 0, 1);
            if ($rank === 'A') { $aces++; $hard += 1; }
            elseif (in_array($rank, array('T', 'J', 'Q', 'K'), true)) { $hard += 10; }
            else { $hard += (int) $rank; }
        }
        return $aces > 0 && ($hard + 10) <= 21;
    }
}

if (!function_exists('sml_bj_draw')) {
    function sml_bj_draw(&$shoe) {
        if (count($shoe) < 20) {
            $shoe = array_merge($shoe, sml_cards_shuffle(sml_cards_deck(6)));
        }
        return array_shift($shoe);
    }
}

if (!function_exists('sml_bj_deal')) {
    function sml_bj_deal($seats) {
        $shoe = sml_cards_shuffle(sml_cards_deck(6));
        $state = sml_bj_new_state();
        $seats = array_values(array_map('intval', (array) $seats));
        sort($seats);

        $players = array();
        foreach ($seats as $seat) {
            $players[$seat] = array(
                'hands'  => array(array(
                    'cards' => array(), 'bet' => 10, 'done' => false,
                    'doubled' => false, 'result' => '', 'payout' => 0,
                )),
                'active' => 0,
                'chips'  => 100,
            );
        }

        // Two rounds, dealer last, exactly as at a real table.
        for ($pass = 0; $pass < 2; $pass++) {
            foreach ($seats as $seat) {
                $players[$seat]['hands'][0]['cards'][] = sml_bj_draw($shoe);
            }
            $state['dealer']['cards'][] = sml_bj_draw($shoe);
        }

        // The hole card lives in private state, not merely flagged in public.
        $hole = array_pop($state['dealer']['cards']);

        $state['players'] = $players;
        $state['order'] = $seats;
        $state['phase'] = 'player';
        $state['active'] = $seats[0];
        $state['dealer']['hole'] = true;
        $state['dealer']['total'] = sml_bj_total($state['dealer']['cards']);

        return array(
            'state'   => $state,
            'private' => array('shoe' => $shoe, 'hole' => $hole),
            'turn'    => $seats[0],
        );
    }
}

if (!function_exists('sml_bj_redact')) {
    function sml_bj_redact($state, $private, $seat) {
        $state = (array) $state;

        // The shoe is never in public state to begin with; strip it anyway so
        // that a future bug upstream cannot turn into a dealt-cards leak.
        unset($state['shoe']);

        if (!empty($state['dealer']['hole'])) {
            // Face down. Show the upcard only, and a total that reflects just
            // that -- sending the real total would give the hole card away.
            $up = array_values((array) $state['dealer']['cards']);
            $state['dealer']['cards'] = $up;
            $state['dealer']['total'] = sml_bj_total($up);
            $state['dealer']['down'] = 1;
        } else {
            $state['dealer']['down'] = 0;
            $state['dealer']['total'] = sml_bj_total((array) $state['dealer']['cards']);
        }
        return $state;
    }
}

if (!function_exists('sml_bj_next_hand')) {
    /** Advance to the next unfinished hand, or to the dealer. */
    function sml_bj_next_hand($state) {
        $order = (array) $state['order'];
        foreach ($order as $seat) {
            $player = $state['players'][$seat];
            foreach ($player['hands'] as $i => $hand) {
                if (empty($hand['done'])) {
                    $state['players'][$seat]['active'] = (int) $i;
                    $state['active'] = (int) $seat;
                    return $state;
                }
            }
        }
        $state['active'] = 0;
        $state['phase'] = 'dealer';
        return $state;
    }
}

if (!function_exists('sml_bj_settle')) {
    function sml_bj_settle($state, $private) {
        $shoe = (array) ($private['shoe'] ?? array());
        $hole = (string) ($private['hole'] ?? '');

        $dealer = (array) $state['dealer']['cards'];
        if ($hole !== '' && !in_array($hole, $dealer, true)) {
            $dealer[] = $hole;
        }
        // Dealer stands on all seventeens, soft or hard.
        while (sml_bj_total($dealer) < 17) {
            $dealer[] = sml_bj_draw($shoe);
        }
        $dealerTotal = sml_bj_total($dealer);
        $dealerBJ = count($dealer) === 2 && $dealerTotal === 21;

        $state['dealer']['cards'] = array_values($dealer);
        $state['dealer']['hole'] = false;
        $state['dealer']['total'] = $dealerTotal;

        foreach ((array) $state['order'] as $seat) {
            foreach ($state['players'][$seat]['hands'] as $i => $hand) {
                $cards = (array) $hand['cards'];
                $total = sml_bj_total($cards);
                $bet = (int) $hand['bet'];
                $natural = count($cards) === 2 && $total === 21 && empty($hand['doubled']);

                if ($total > 21) {
                    $result = 'bust';
                    $payout = -$bet;
                } elseif ($natural && !$dealerBJ) {
                    $result = 'blackjack';
                    $payout = (int) round($bet * 1.5);
                } elseif ($dealerBJ && !$natural) {
                    $result = 'lose';
                    $payout = -$bet;
                } elseif ($dealerTotal > 21 || $total > $dealerTotal) {
                    $result = 'win';
                    $payout = $bet;
                } elseif ($total === $dealerTotal) {
                    $result = 'push';
                    $payout = 0;
                } else {
                    $result = 'lose';
                    $payout = -$bet;
                }

                $state['players'][$seat]['hands'][$i]['result'] = $result;
                $state['players'][$seat]['hands'][$i]['payout'] = $payout;
                $state['players'][$seat]['hands'][$i]['total'] = $total;
                $state['players'][$seat]['chips'] =
                    (int) $state['players'][$seat]['chips'] + $payout;
            }
        }

        $state['phase'] = 'settled';
        $state['active'] = 0;
        return array('state' => $state, 'private' => array('shoe' => $shoe, 'hole' => ''));
    }
}

if (!function_exists('sml_bj_move')) {
    function sml_bj_move($state, $private, $seat, $move) {
        $state = (array) $state;
        $private = (array) $private;
        $shoe = (array) ($private['shoe'] ?? array());
        $action = strtolower((string) ($move['action'] ?? ''));

        if ($state['phase'] === 'settled') {
            if ($action !== 'again') {
                return array('error' => 'Round over. Deal again to keep playing.');
            }
            $deal = sml_bj_deal((array) $state['order']);
            $fresh = $deal['state'];
            $fresh['round'] = (int) $state['round'] + 1;
            foreach ((array) $state['order'] as $s) {
                $fresh['players'][$s]['chips'] = (int) $state['players'][$s]['chips'];
            }
            return array('state' => $fresh, 'private' => $deal['private'], 'next' => $deal['turn']);
        }

        if ($state['phase'] !== 'player') {
            return array('error' => 'Not your turn.');
        }
        if ((int) $state['active'] !== (int) $seat) {
            return array('error' => 'Not your turn.');
        }
        if (!isset($state['players'][$seat])) {
            return array('error' => 'You are not seated.');
        }

        $idx = (int) $state['players'][$seat]['active'];
        if (!isset($state['players'][$seat]['hands'][$idx])) {
            return array('error' => 'No hand to play.');
        }
        $hand = $state['players'][$seat]['hands'][$idx];
        $cards = (array) $hand['cards'];

        if ($action === 'hit') {
            $cards[] = sml_bj_draw($shoe);
            $state['players'][$seat]['hands'][$idx]['cards'] = $cards;
            if (sml_bj_total($cards) >= 21) {
                $state['players'][$seat]['hands'][$idx]['done'] = true;
            }
        } elseif ($action === 'stand') {
            $state['players'][$seat]['hands'][$idx]['done'] = true;
        } elseif ($action === 'double') {
            if (count($cards) !== 2) {
                return array('error' => 'You can only double on your first two cards.');
            }
            $cards[] = sml_bj_draw($shoe);
            $state['players'][$seat]['hands'][$idx]['cards'] = $cards;
            $state['players'][$seat]['hands'][$idx]['bet'] = (int) $hand['bet'] * 2;
            $state['players'][$seat]['hands'][$idx]['doubled'] = true;
            $state['players'][$seat]['hands'][$idx]['done'] = true;
        } elseif ($action === 'split') {
            if (count($cards) !== 2) {
                return array('error' => 'You can only split your first two cards.');
            }
            if (sml_bj_pair_value($cards[0]) !== sml_bj_pair_value($cards[1])) {
                return array('error' => 'Those cards are not a pair.');
            }
            if (count($state['players'][$seat]['hands']) >= 2) {
                return array('error' => 'One split per round.');
            }
            $bet = (int) $hand['bet'];
            $state['players'][$seat]['hands'][$idx] = array(
                'cards' => array($cards[0], sml_bj_draw($shoe)),
                'bet' => $bet, 'done' => false, 'doubled' => false, 'result' => '', 'payout' => 0,
            );
            $state['players'][$seat]['hands'][] = array(
                'cards' => array($cards[1], sml_bj_draw($shoe)),
                'bet' => $bet, 'done' => false, 'doubled' => false, 'result' => '', 'payout' => 0,
            );
        } else {
            return array('error' => 'Hit, stand, double or split.');
        }

        $private['shoe'] = $shoe;
        $state = sml_bj_next_hand($state);

        if ($state['phase'] === 'dealer') {
            $settled = sml_bj_settle($state, $private);
            $state = $settled['state'];
            $private = $settled['private'];
            $private['hole'] = '';

            // The house is not a seat, so nobody "wins" the table. Keep it
            // open so the group can play another round.
            return array('state' => $state, 'private' => $private,
                'next' => (int) $state['order'][0]);
        }

        return array('state' => $state, 'private' => $private, 'next' => (int) $state['active']);
    }
}

if (!function_exists('sml_bj_pair_value')) {
    function sml_bj_pair_value($card) {
        $rank = substr((string) $card, 0, 1);
        return in_array($rank, array('T', 'J', 'Q', 'K'), true) ? 'T' : $rank;
    }
}
