<?php
/**
 * Loop Distribution - content understanding.
 *
 * Turns a letter, video or stream into a structured bundle: symbols, keywords,
 * content type, TL;DR, hook and SEO metadata. Everything downstream (variants,
 * cards, hashtags, timing) reads from the bundle rather than re-parsing.
 */

if (!defined('ABSPATH')) {
    exit;
}

/* ==================================================================
 * Stoplists
 * ================================================================== */

if (!function_exists('sml_dist_ticker_stoplist')) {
    /**
     * Every one of these is also a real ticker somewhere, which is exactly why
     * bare-token detection is capped at low confidence and gated on a directory
     * lookup. Publishing "$CEO" in a creator's name is unrecoverable.
     */
    function sml_dist_ticker_stoplist() {
        return array(
            'CEO','CFO','COO','CTO','ETF','IPO','EPS','GDP','CPI','PPI','FOMC','FED',
            'USA','USD','EUR','GBP','JPY','AI','API','APR','ATH','ATL','AUM','AVG',
            'NYSE','YOY','QOQ','MOM','DD','IMO','TLDR','EOD','EOW','PM','AM','ET','PT',
            'OK','NO','SO','UP','IT','IS','BE','AS','AT','BY','IF','IN','ON','OR','TO',
            'RSI','MACD','EMA','SMA','VWAP','ATR','IV','OI','PE','PEG','ROE','ROI','TTM',
            'Q1','Q2','Q3','Q4','FY','YTD','LLC','INC','LTD','ETC','FAQ','PDF','URL',
            'HODL','FOMO','YOLO','WSB','SEC','IRS','GAAP','EBIT','FCF','CAGR','TAM',
        );
    }
}

if (!function_exists('sml_dist_stopwords')) {
    function sml_dist_stopwords() {
        return array_flip(array(
            'the','a','an','and','or','but','if','then','than','that','this','these','those',
            'is','are','was','were','be','been','being','am','do','does','did','have','has','had',
            'i','you','he','she','it','we','they','me','him','her','us','them','my','your','his',
            'its','our','their','of','in','on','at','to','for','with','by','from','up','down',
            'out','off','over','under','again','further','once','here','there','when','where',
            'why','how','all','any','both','each','few','more','most','other','some','such',
            'no','nor','not','only','own','same','so','too','very','can','will','just','should',
            'now','about','into','through','during','before','after','above','below','between',
            // Finance boilerplate. Technically content, practically noise.
            'stock','stocks','price','market','markets','trade','trading','trader','chart',
            'level','levels','move','moves','week','day','today','going','look','looks','think',
        ));
    }
}

/* ==================================================================
 * Content bundle
 * ================================================================== */

if (!function_exists('sml_dist_bundle_from_letter')) {
    /**
     * @param array $row Raw row from wp_sml_letter_posts.
     */
    function sml_dist_bundle_from_letter($row) {
        $blocks = function_exists('sml_letters_blocks') ? sml_letters_blocks($row) : array();
        $author = get_userdata((int) $row['author_id']);

        return array(
            'entity_type' => 'letter',
            'entity_id'   => (int) $row['id'],
            'title'       => (string) $row['title'],
            'subtitle'    => (string) $row['subtitle'],
            'tldr_manual' => (string) $row['tldr'],
            'blocks'      => $blocks,
            'plaintext'   => sml_dist_plaintext($blocks),
            'url'         => function_exists('sml_letters_url') ? sml_letters_url($row) : home_url('/'),
            'cover'       => (string) $row['cover_url'],
            'author'      => array(
                'id'     => (int) $row['author_id'],
                'name'   => $author ? ($author->display_name ?: $author->user_login) : 'Author',
                'handle' => $author ? $author->user_nicename : '',
                'avatar' => get_avatar_url((int) $row['author_id'], array('size' => 160)),
            ),
            'read_minutes' => (int) $row['read_minutes'],
            'published_at' => (string) $row['published_at'],
            'price_lb'     => (int) $row['price_lb'],
            'visibility'   => (string) $row['visibility'],
        );
    }
}

if (!function_exists('sml_dist_numeric_entity_id')) {
    function sml_dist_numeric_entity_id($type, $raw_id, $salt = '') {
        if (is_numeric($raw_id) && (int) $raw_id > 0) {
            return (int) $raw_id;
        }
        $hash = sprintf('%u', crc32((string) $type . '|' . (string) $raw_id . '|' . (string) $salt));
        return max(1, (int) $hash);
    }
}

if (!function_exists('sml_dist_bundle_from_video')) {
    function sml_dist_bundle_from_video($video) {
        $author = get_userdata((int) ($video['author_id'] ?? 0));
        $entity_id = sml_dist_numeric_entity_id('video', $video['dist_entity_id'] ?? ($video['id'] ?? ''), $video['watch_url'] ?? '');
        return array(
            'entity_type' => 'video',
            'entity_id'   => $entity_id,
            'source_id'   => (string) ($video['id'] ?? ''),
            'title'       => (string) ($video['title'] ?? ''),
            'subtitle'    => '',
            'tldr_manual' => (string) ($video['description'] ?? ''),
            'blocks'      => array(),
            'plaintext'   => (string) ($video['description'] ?? ''),
            'url'         => (string) ($video['watch_url'] ?? home_url('/')),
            'cover'       => (string) ($video['thumbnail'] ?? ''),
            'video_url'   => (string) ($video['video_url'] ?? ''),
            'video_mime'  => (string) ($video['video_mime'] ?? ''),
            'author'      => array(
                'id'     => (int) ($video['author_id'] ?? 0),
                'name'   => $author ? ($author->display_name ?: $author->user_login) : 'Creator',
                'handle' => $author ? $author->user_nicename : '',
                'avatar' => get_avatar_url((int) ($video['author_id'] ?? 0), array('size' => 160)),
            ),
            'read_minutes' => 0,
            'published_at' => (string) ($video['published_at'] ?? ''),
            'price_lb'     => 0,
            'visibility'   => 'public',
            'tickers_hint' => (array) ($video['tickers'] ?? array()),
        );
    }
}

if (!function_exists('sml_dist_bundle_from_stream')) {
    function sml_dist_bundle_from_stream($stream) {
        $user_id = (int) ($stream['author_id'] ?? get_current_user_id());
        $author = get_userdata($user_id);
        $handle = $author ? sanitize_key((string) ($author->user_nicename ?: $author->user_login)) : '';
        $stream_key = (string) ($stream['id'] ?? $stream['session_id'] ?? '');
        $entity_id = sml_dist_numeric_entity_id('stream', $stream['dist_entity_id'] ?? $stream_key, $user_id . '|' . ($stream['started_at'] ?? ''));

        return array(
            'entity_type' => 'stream',
            'entity_id'   => max(1, $entity_id),
            'source_id'   => $stream_key,
            'title'       => (string) ($stream['title'] ?? 'Live on StockMarketLoop'),
            'subtitle'    => '',
            'tldr_manual' => (string) ($stream['description'] ?? ''),
            'blocks'      => array(),
            'plaintext'   => (string) ($stream['description'] ?? ''),
            'url'         => (string) ($stream['watch_url'] ?? home_url('/live/?room=' . rawurlencode($handle))),
            'cover'       => (string) ($stream['thumbnail_url'] ?? ''),
            'author'      => array(
                'id'     => $user_id,
                'name'   => $author ? ($author->display_name ?: $author->user_login) : 'Creator',
                'handle' => $handle,
                'avatar' => get_avatar_url($user_id, array('size' => 160)),
            ),
            'read_minutes' => 0,
            'published_at' => (string) ($stream['started_at'] ?? sml_dist_now()),
            'price_lb'     => 0,
            'visibility'   => (string) ($stream['visibility'] ?? 'public'),
            'tickers_hint' => array_filter(array((string) ($stream['ticker'] ?? ''))),
        );
    }
}

if (!function_exists('sml_dist_plaintext')) {
    function sml_dist_plaintext($blocks) {
        $out = array();
        foreach ((array) $blocks as $b) {
            $type = $b['type'] ?? '';
            if ($type === 'paragraph' && !empty($b['spans'])) {
                $line = '';
                foreach ($b['spans'] as $s) {
                    $line .= (string) ($s['text'] ?? '');
                }
                $out[] = $line;
            } elseif (in_array($type, array('heading', 'quote', 'paragraph'), true)) {
                $out[] = (string) ($b['text'] ?? '');
            } elseif ($type === 'list') {
                foreach ((array) ($b['items'] ?? array()) as $item) {
                    $out[] = (string) $item;
                }
            }
        }
        return trim(preg_replace('/\s+/u', ' ', implode(' ', $out)));
    }
}

/* ==================================================================
 * Ticker engine
 * ================================================================== */

if (!function_exists('sml_dist_symbol_exists')) {
    /**
     * Directory lookup, cached for a day. Falls back to "unknown symbols are
     * not symbols" so a missing directory can never produce a false cashtag.
     */
    function sml_dist_symbol_exists($symbol) {
        $symbol = strtoupper($symbol);
        $known = get_transient('sml_dist_symbols');
        if (!is_array($known)) {
            $known = array();
            $rows = apply_filters('sml_dist_symbol_directory', null);
            if (is_array($rows)) {
                foreach ($rows as $r) {
                    $s = strtoupper(is_array($r) ? ($r['symbol'] ?? '') : (string) $r);
                    if ($s) {
                        $known[$s] = 1;
                    }
                }
            } else {
                global $wpdb;
                $table = $wpdb->prefix . 'sml_letter_tickers';
                $found = $wpdb->get_col("SELECT DISTINCT symbol FROM $table LIMIT 2000");
                foreach ((array) $found as $s) {
                    $known[strtoupper($s)] = 1;
                }
            }
            set_transient('sml_dist_symbols', $known, DAY_IN_SECONDS);
        }
        return isset($known[$symbol]);
    }
}

if (!function_exists('sml_dist_extract_symbols')) {
    /**
     * Returns [['symbol'=>'NVDA','confidence'=>1.0,'source'=>'block'], ...]
     * ordered by confidence then first appearance.
     */
    function sml_dist_extract_symbols($bundle) {
        $found = array();

        $bump = function (&$found, $symbol, $score, $source) {
            $symbol = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $symbol));
            if ($symbol === '' || strlen($symbol) > 5) {
                return;
            }
            if (!isset($found[$symbol]) || $found[$symbol]['confidence'] < $score) {
                $found[$symbol] = array('confidence' => $score, 'source' => $source, 'hits' => 0);
            }
            $found[$symbol]['hits']++;
        };

        // 1.00 - the creator declared these in a block. Not a guess.
        foreach ((array) $bundle['blocks'] as $b) {
            if (!empty($b['symbol'])) {
                $bump($found, $b['symbol'], 1.00, 'block');
            }
            foreach ((array) ($b['symbols'] ?? array()) as $s) {
                $bump($found, $s, 1.00, 'block');
            }
            foreach ((array) ($b['spans'] ?? array()) as $s) {
                if (($s['mark'] ?? '') === 'ticker' && !empty($s['symbol'])) {
                    $bump($found, $s['symbol'], 1.00, 'span');
                }
            }
        }
        foreach ((array) ($bundle['tickers_hint'] ?? array()) as $s) {
            $bump($found, is_array($s) ? ($s['symbol'] ?? '') : $s, 1.00, 'hint');
        }

        $text = $bundle['title'] . ' ' . $bundle['subtitle'] . ' ' . $bundle['plaintext'];

        // 0.95 - explicit cashtag in prose.
        if (preg_match_all('/(?<![A-Za-z0-9])\$([A-Za-z]{1,5})(?![A-Za-z0-9])/', $text, $m)) {
            foreach ($m[1] as $s) {
                $bump($found, $s, 0.95, 'cashtag');
            }
        }

        // 0.60 - bare uppercase token. Guarded three ways: stoplist, directory
        // lookup, and it must appear twice or sit in the title.
        $stop = array_flip(sml_dist_ticker_stoplist());
        if (preg_match_all('/(?<![A-Za-z0-9$#])([A-Z]{2,5})(?![A-Za-z0-9])/', $text, $m2)) {
            $counts = array_count_values($m2[1]);
            foreach ($counts as $s => $n) {
                if (isset($stop[$s]) || isset($found[$s])) {
                    continue;
                }
                if (!sml_dist_symbol_exists($s)) {
                    continue;
                }
                $inTitle = stripos($bundle['title'], $s) !== false;
                if ($n < 2 && !$inTitle) {
                    continue;
                }
                $bump($found, $s, 0.60, 'bare');
            }
        }

        uasort($found, function ($a, $b) {
            if ($a['confidence'] === $b['confidence']) {
                return $b['hits'] <=> $a['hits'];
            }
            return $b['confidence'] <=> $a['confidence'];
        });

        $out = array();
        foreach ($found as $symbol => $meta) {
            $out[] = array(
                'symbol'     => $symbol,
                'confidence' => $meta['confidence'],
                'source'     => $meta['source'],
            );
            if (count($out) >= 8) {
                break;
            }
        }
        return $out;
    }
}

if (!function_exists('sml_dist_render_symbol')) {
    function sml_dist_render_symbol($symbol, $platform) {
        $meta = sml_dist_platform($platform);
        $style = $meta ? $meta['symbol'] : 'cashtag';
        if ($platform === 'seo' || $style === 'plain') {
            return $symbol;
        }
        return ($style === 'hashtag' ? '#' : '$') . $symbol;
    }
}

/* ==================================================================
 * Keywords
 * ================================================================== */

if (!function_exists('sml_dist_keywords')) {
    /**
     * Term frequency scored against a rolling corpus of recent letters, so a
     * word that appears in every letter this creator writes stops counting as
     * a keyword. Cheap approximation of TF-IDF, no external service.
     */
    function sml_dist_keywords($bundle, $limit = 12) {
        $stop = sml_dist_stopwords();
        $text = strtolower($bundle['title'] . ' ' . $bundle['subtitle'] . ' ' . $bundle['plaintext']);
        $text = preg_replace('/[^a-z0-9\s\-]/', ' ', $text);
        $words = preg_split('/\s+/', $text, -1, PREG_SPLIT_NO_EMPTY);

        $tf = array();
        $prev = '';
        foreach ($words as $w) {
            if (strlen($w) < 3 || isset($stop[$w]) || ctype_digit($w)) {
                $prev = '';
                continue;
            }
            $tf[$w] = ($tf[$w] ?? 0) + 1;
            if ($prev !== '') {
                $bi = $prev . ' ' . $w;
                $tf[$bi] = ($tf[$bi] ?? 0) + 1.4;   // bigrams are better keywords
            }
            $prev = $w;
        }

        $df = sml_dist_corpus_df();
        $total = max(1, (int) ($df['__docs'] ?? 1));
        $scored = array();
        foreach ($tf as $term => $count) {
            $seen = (int) ($df[$term] ?? 0);
            $idf = log(($total + 1) / ($seen + 1)) + 1;
            $boost = stripos($bundle['title'], $term) !== false ? 2.2 : 1.0;
            $scored[$term] = $count * $idf * $boost;
        }
        arsort($scored);

        return array_slice(array_keys($scored), 0, $limit);
    }
}

if (!function_exists('sml_dist_corpus_df')) {
    /** Document frequencies over the last 200 published letters, cached 12h. */
    function sml_dist_corpus_df() {
        $cached = get_transient('sml_dist_corpus_df');
        if (is_array($cached)) {
            return $cached;
        }

        global $wpdb;
        $table = $wpdb->prefix . 'sml_letter_posts';
        $rows = $wpdb->get_col(
            "SELECT plaintext FROM $table WHERE status = 'published'
              ORDER BY published_at DESC LIMIT 200"
        );

        $stop = sml_dist_stopwords();
        $df = array('__docs' => count((array) $rows));
        foreach ((array) $rows as $doc) {
            $seen = array();
            $words = preg_split('/\s+/', strtolower(preg_replace('/[^a-z0-9\s\-]/i', ' ', (string) $doc)), -1, PREG_SPLIT_NO_EMPTY);
            $prev = '';
            foreach ($words as $w) {
                if (strlen($w) < 3 || isset($stop[$w])) {
                    $prev = '';
                    continue;
                }
                $seen[$w] = 1;
                if ($prev !== '') {
                    $seen[$prev . ' ' . $w] = 1;
                }
                $prev = $w;
            }
            foreach (array_keys($seen) as $term) {
                $df[$term] = ($df[$term] ?? 0) + 1;
            }
        }

        set_transient('sml_dist_corpus_df', $df, 12 * HOUR_IN_SECONDS);
        return $df;
    }
}

/* ==================================================================
 * Classification
 * ================================================================== */

if (!function_exists('sml_dist_classify')) {
    /**
     * Rule-based on purpose. The signal here is structural (does it have a
     * levels block?) not semantic, and structure is not something a language
     * model reads more reliably than an if statement.
     */
    function sml_dist_classify($bundle, $symbols) {
        $blocks = (array) $bundle['blocks'];
        $has = function ($type) use ($blocks) {
            foreach ($blocks as $b) {
                if (($b['type'] ?? '') === $type) {
                    return true;
                }
            }
            return false;
        };

        $title = (string) $bundle['title'];
        $text  = $title . ' ' . $bundle['plaintext'];

        if ($has('levels')) {
            return 'Levels';
        }
        if (preg_match('/\b(earnings|EPS|guidance|beat|missed|the print|quarterly)\b/i', $text)) {
            return 'Earnings';
        }
        if (count($symbols) >= 5) {
            return 'Watchlist';
        }
        if (preg_match('/\b(how to|what is|explained|beginner|guide|basics|101)\b/i', $title)) {
            return 'Education';
        }
        if (preg_match('/\b(recap|wrap|session|the close|today.s move)\b/i', $title)) {
            return 'Recap';
        }
        if (!$symbols || preg_match('/\b(CPI|PPI|Fed|FOMC|rates|macro|yields|inflation|jobs report)\b/i', $text)) {
            return 'Macro';
        }
        return 'Thesis';
    }
}

/* ==================================================================
 * Summarisation
 * ================================================================== */

if (!function_exists('sml_dist_sentences')) {
    function sml_dist_sentences($text) {
        $parts = preg_split('/(?<=[.!?])\s+(?=[A-Z$"\'])/u', trim((string) $text), -1, PREG_SPLIT_NO_EMPTY);
        return array_values(array_filter(array_map('trim', (array) $parts), function ($s) {
            return strlen($s) > 24;
        }));
    }
}

if (!function_exists('sml_dist_summarise')) {
    /**
     * Extractive. A generated abstract that subtly misstates a trade thesis is
     * worse than a verbatim sentence the creator actually wrote.
     */
    function sml_dist_summarise($bundle, $symbols) {
        $sentences = sml_dist_sentences($bundle['plaintext']);
        if (!$sentences) {
            return array('tldr' => (string) $bundle['subtitle'], 'hook' => (string) $bundle['title']);
        }

        $primary = $symbols[0]['symbol'] ?? '';
        $scored = array();
        foreach ($sentences as $i => $s) {
            $score = 0.0;
            $score += ($i < 3) ? (3 - $i) * 0.8 : 0;                    // lede bias
            if ($primary && stripos($s, $primary) !== false)  $score += 2.5;
            if (preg_match('/\d+\.\d+|\d+%/', $s))            $score += 2.0;  // has a number
            if (preg_match('/\b(because|why|the reason|matters|invalidat)/i', $s)) $score += 1.5;
            $len = strlen($s);
            if ($len > 60 && $len < 220)                      $score += 1.0;
            $scored[$i] = $score;
        }
        arsort($scored);
        $bestIdx = array_key_first($scored);

        $tldr = sml_dist_truncate($sentences[$bestIdx], 200);

        // The hook is deliberately a different sentence from the TL;DR so the
        // social post and the meta description do not read identically.
        unset($scored[$bestIdx]);
        $hookIdx = $scored ? array_key_first($scored) : $bestIdx;
        $hook = sml_dist_truncate($sentences[$hookIdx], 90);

        return array('tldr' => $tldr, 'hook' => $hook);
    }
}

if (!function_exists('sml_dist_truncate')) {
    function sml_dist_truncate($text, $max) {
        $text = trim(preg_replace('/\s+/u', ' ', (string) $text));
        if (mb_strlen($text) <= $max) {
            return $text;
        }
        $cut = mb_substr($text, 0, $max - 1);
        $space = mb_strrpos($cut, ' ');
        if ($space !== false && $space > $max * 0.6) {
            $cut = mb_substr($cut, 0, $space);
        }
        return rtrim($cut, " ,.;:-") . '…';
    }
}

/* ==================================================================
 * SEO bundle
 * ================================================================== */

if (!function_exists('sml_dist_seo')) {
    function sml_dist_seo($bundle) {
        $symbols = sml_dist_extract_symbols($bundle);
        $type    = sml_dist_classify($bundle, $symbols);
        $sum     = sml_dist_summarise($bundle, $symbols);
        $keywords = sml_dist_keywords($bundle);

        $tldr = $bundle['tldr_manual'] ?: $sum['tldr'];
        $primary = $symbols[0]['symbol'] ?? '';

        // Front-load the ticker. It is the query people actually type.
        $desc = $tldr;
        if ($primary && stripos($desc, $primary) === false) {
            $desc = $primary . ': ' . $desc;
        }

        return array(
            'symbols'      => $symbols,
            'primary'      => $primary,
            'content_type' => $type,
            'tldr'         => $tldr,
            'hook'         => $sum['hook'],
            'keywords'     => $keywords,
            'meta_desc'    => sml_dist_truncate($desc, 155),
            'title'        => $bundle['title'],
            'url'          => $bundle['url'],
            'content_hash' => sha1($bundle['title'] . '|' . $bundle['plaintext'] . '|' . wp_json_encode($symbols)),
        );
    }
}

/* ==================================================================
 * Optimal timing
 * ================================================================== */

if (!function_exists('sml_dist_optimal_time')) {
    /**
     * A Levels letter written at 3am should not be posted at 3am. The content
     * type already tells us when its audience is paying attention.
     */
    function sml_dist_optimal_time($seo, $user_id = 0) {
        $tz = new DateTimeZone('America/New_York');
        $map = array(
            'Levels'   => '09:15',
            'Thesis'   => '09:15',
            'Earnings' => '16:05',
            'Macro'    => '07:00',
            'Recap'    => '16:30',
            'Watchlist'=> '08:30',
            'Education'=> '12:00',
        );
        $target = $map[$seo['content_type']] ?? '';
        if (!$target) {
            return null;
        }

        $now = new DateTime('now', $tz);
        $slot = new DateTime($now->format('Y-m-d') . ' ' . $target, $tz);

        // Never delay more than 14 hours - a stale post is worse than a
        // mistimed one, and creators find long silent queues alarming.
        if ($slot <= $now) {
            $slot->modify('+1 day');
        }
        if (($slot->getTimestamp() - $now->getTimestamp()) > 14 * HOUR_IN_SECONDS) {
            return null;
        }
        $slot->setTimezone(new DateTimeZone('UTC'));
        return $slot->format('Y-m-d H:i:s');
    }
}

if (!function_exists('sml_dist_earnings_blackout')) {
    /**
     * Publishing "here's my thesis" twenty minutes before a print that
     * invalidates it is the worst look available to a trading creator.
     * Overridable via filter once an earnings calendar feed exists.
     */
    function sml_dist_earnings_blackout($symbol) {
        return (bool) apply_filters('sml_dist_earnings_blackout', false, $symbol);
    }
}
