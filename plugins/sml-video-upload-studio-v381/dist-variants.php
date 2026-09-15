<?php
/**
 * Loop Distribution - hashtag engine and per-platform variant generation.
 */

if (!defined('ABSPATH')) {
    exit;
}

/* ==================================================================
 * Hashtag engine
 * ================================================================== */

if (!function_exists('sml_dist_type_tags')) {
    function sml_dist_type_tags($type) {
        $map = array(
            'Thesis'    => array('#stockanalysis', '#investing', '#duediligence'),
            'Levels'    => array('#technicalanalysis', '#swingtrading', '#pricelevels'),
            'Earnings'  => array('#earnings', '#earningsseason', '#stocks'),
            'Macro'     => array('#macro', '#economy', '#markets'),
            'Recap'     => array('#marketrecap', '#stockmarket', '#daytrading'),
            'Education' => array('#tradingeducation', '#learntotrade', '#investing101'),
            'Watchlist' => array('#watchlist', '#stockstowatch', '#trading'),
        );
        return $map[$type] ?? $map['Thesis'];
    }
}

if (!function_exists('sml_dist_sector_tags')) {
    function sml_dist_sector_tags($symbols) {
        $sectors = apply_filters('sml_dist_sector_map', array(
            'NVDA' => array('#semiconductors', '#AIstocks'),
            'AMD'  => array('#semiconductors', '#AIstocks'),
            'INTC' => array('#semiconductors'),
            'TSM'  => array('#semiconductors'),
            'AAPL' => array('#techstocks'),
            'MSFT' => array('#techstocks', '#AIstocks'),
            'GOOGL'=> array('#techstocks'),
            'AMZN' => array('#ecommerce', '#techstocks'),
            'META' => array('#techstocks'),
            'TSLA' => array('#EVstocks'),
            'SPY'  => array('#SPX', '#indexes'),
            'QQQ'  => array('#nasdaq', '#indexes'),
            'IWM'  => array('#smallcaps'),
        ));

        $out = array();
        foreach ($symbols as $s) {
            $sym = is_array($s) ? $s['symbol'] : $s;
            foreach ((array) ($sectors[$sym] ?? array()) as $tag) {
                $out[] = $tag;
            }
        }
        return array_values(array_unique($out));
    }
}

if (!function_exists('sml_dist_evergreen_tags')) {
    function sml_dist_evergreen_tags($platform) {
        if ($platform === 'instagram' || $platform === 'tiktok') {
            return array('#stockmarket', '#trading', '#investing', '#stocks', '#daytrading',
                         '#stocktok', '#finance', '#wallstreet', '#stockmarketnews', '#money');
        }
        if ($platform === 'linkedin') {
            return array('#investing', '#equityresearch', '#capitalmarkets');
        }
        return array('#stockmarket', '#trading', '#investing');
    }
}

if (!function_exists('sml_dist_trending_tags')) {
    /** Our own trending feed, not a third-party trend API we would have to pay for. */
    function sml_dist_trending_tags() {
        $cached = get_transient('sml_dist_trending_tags');
        if (is_array($cached)) {
            return $cached;
        }
        global $wpdb;
        $table = $wpdb->prefix . 'sml_letter_tickers';
        $rows = $wpdb->get_col(
            "SELECT symbol FROM $table GROUP BY symbol ORDER BY COUNT(*) DESC LIMIT 20"
        );
        $tags = array();
        foreach ((array) $rows as $s) {
            $tags[] = '#' . strtoupper($s);
        }
        set_transient('sml_dist_trending_tags', $tags, 6 * HOUR_IN_SECONDS);
        return $tags;
    }
}

if (!function_exists('sml_dist_hashtags')) {
    function sml_dist_hashtags($seo, $platform) {
        $meta = sml_dist_platform($platform);
        $budget = $meta ? (int) $meta['tags'] : 3;
        if ($budget <= 0) {
            return array();
        }

        $pool = array();
        foreach ($seo['symbols'] as $s) {
            $pool[] = array('tag' => '#' . $s['symbol'], 'score' => 1.00 * $s['confidence']);
        }
        foreach (sml_dist_sector_tags($seo['symbols']) as $t) {
            $pool[] = array('tag' => $t, 'score' => 0.70);
        }
        foreach (sml_dist_type_tags($seo['content_type']) as $t) {
            $pool[] = array('tag' => $t, 'score' => 0.60);
        }
        foreach (sml_dist_evergreen_tags($platform) as $t) {
            $pool[] = array('tag' => $t, 'score' => 0.30);
        }

        $trending = sml_dist_trending_tags();
        foreach ($pool as &$t) {
            if (in_array($t['tag'], $trending, true)) {
                $t['score'] += 0.25;
            }
        }
        unset($t);

        usort($pool, function ($a, $b) {
            return $b['score'] <=> $a['score'];
        });

        $out = array();
        foreach ($pool as $t) {
            if (count($out) >= $budget) {
                break;
            }
            if (in_array($t['tag'], $out, true)) {
                continue;
            }
            $out[] = $t['tag'];
        }
        return $out;
    }
}

/* ==================================================================
 * Hooks and CTAs
 * ================================================================== */

if (!function_exists('sml_dist_hook')) {
    /**
     * Three strategies. Seed 0 inverts the obvious take, seed 1 leads with the
     * number, seed 2 asks the question the reader already has. The creator
     * picks; after enough sends the click data picks for them.
     */
    function sml_dist_hook($seo, $bundle, $seed, $event) {
        $primary = $seo['primary'];
        $levels  = sml_dist_levels($bundle);

        if ($event === 'stream.start') {
            return $primary ? '🔴 LIVE NOW — ' . $primary : '🔴 LIVE NOW';
        }
        if ($event === 'replay.ready') {
            return 'Missed it? The full session is up.';
        }

        if ($seed === 1 && $levels && !empty($levels['entry'])) {
            return $primary . ' — ' . $levels['entry'] . ' is the line that matters.';
        }
        if ($seed === 1) {
            return sml_dist_truncate($seo['hook'], 90);
        }
        if ($seed === 2) {
            $type = $seo['content_type'];
            if ($type === 'Earnings') {
                return $primary ? 'What happens to ' . $primary . ' if the print disappoints?' : 'What does the print actually change?';
            }
            if ($type === 'Levels') {
                return $primary ? 'Where are you wrong on ' . $primary . '?' : 'Where would you be wrong?';
            }
            return $primary ? 'Is ' . $primary . ' still worth holding here?' : 'Is this still worth holding here?';
        }

        // Seed 0 - contrarian framing off the content type.
        $contrarian = array(
            'Levels'    => 'The setup was there before the move — that is the whole point.',
            'Earnings'  => 'Everyone is watching the print. The setup existed before it.',
            'Thesis'    => 'The consensus take is priced in. This one is not.',
            'Macro'     => 'The headline is not the trade. The positioning is.',
            'Recap'     => 'The move everyone noticed was not the important one.',
            'Watchlist' => 'Most watchlists are noise. These earned the slot.',
            'Education' => 'Nobody explains this part, which is why it keeps costing people money.',
        );
        return $contrarian[$seo['content_type']] ?? sml_dist_truncate($seo['hook'], 90);
    }
}

if (!function_exists('sml_dist_cta')) {
    function sml_dist_cta($platform, $event, $seo) {
        if ($event === 'stream.start') {
            return $platform === 'instagram' ? 'Link in bio to watch live.' : 'Join and bring your ticker ↓';
        }
        if ($event === 'replay.ready') {
            return $platform === 'instagram' ? 'Replay — link in bio.' : 'Watch the replay ↓';
        }
        if ($event === 'video.publish') {
            return $platform === 'instagram' ? 'Full breakdown — link in bio.' : 'Watch the breakdown ↓';
        }

        if ($platform === 'instagram' || $platform === 'tiktok') {
            return 'Full letter — link in bio.';
        }
        if ($platform === 'linkedin') {
            return '';   // LinkedIn CTAs read as spam; the link speaks for itself.
        }
        return $seo['content_type'] === 'Levels'
            ? 'Levels and invalidation in the letter ↓'
            : 'Full letter ↓';
    }
}

if (!function_exists('sml_dist_levels')) {
    function sml_dist_levels($bundle) {
        foreach ((array) $bundle['blocks'] as $b) {
            if (($b['type'] ?? '') === 'levels') {
                $targets = (array) ($b['targets'] ?? array());
                return array(
                    'symbol'    => strtoupper((string) ($b['symbol'] ?? '')),
                    'entry'     => (string) ($b['entry'] ?? ''),
                    'stop'      => (string) ($b['stop'] ?? ''),
                    'target_1'  => (string) ($targets[0] ?? ''),
                    'target_2'  => (string) ($targets[1] ?? ''),
                    'timeframe' => (string) ($b['timeframe'] ?? ''),
                );
            }
        }
        return null;
    }
}

if (!function_exists('sml_dist_disclosure')) {
    function sml_dist_disclosure($bundle) {
        foreach ((array) $bundle['blocks'] as $b) {
            if (($b['type'] ?? '') === 'disclosure') {
                $pos = trim((string) ($b['position'] ?? ''));
                $size = trim((string) ($b['size'] ?? ''));
                if ($pos === '') {
                    return '';
                }
                return 'Author is ' . $pos . ($size ? ' (' . $size . ')' : '') . '.';
            }
        }
        return '';
    }
}

/* ==================================================================
 * Body copy
 * ================================================================== */

if (!function_exists('sml_dist_body')) {
    function sml_dist_body($seo, $bundle, $platform, $event) {
        $levels = sml_dist_levels($bundle);
        $primary = $seo['primary'];

        if ($event === 'stream.start') {
            return $bundle['title'];
        }

        // Long-form platforms get the creator's actual prose, not a summary of it.
        if (in_array($platform, array('facebook', 'linkedin', 'reddit', 'moomoo', 'yahoo_finance', 'facebook_groups'), true)) {
            $sentences = sml_dist_sentences($bundle['plaintext']);
            $body = implode(' ', array_slice($sentences, 0, 3));
            if ($levels && $levels['entry'] !== '') {
                $body .= ' Entry ' . $levels['entry']
                    . ($levels['stop'] !== '' ? ', invalidation ' . $levels['stop'] : '')
                    . ($levels['target_1'] !== '' ? ', first target ' . $levels['target_1'] : '') . '.';
            }
            $d = sml_dist_disclosure($bundle);
            return trim($body . ($d ? ' ' . $d : ''));
        }

        if ($levels && $levels['entry'] !== '') {
            $line = ($primary ? $primary . ' — ' : '') . $levels['entry'] . ' entry';
            if ($levels['stop'] !== '')     { $line .= ', ' . $levels['stop'] . ' invalidates'; }
            if ($levels['target_1'] !== '') { $line .= ', ' . $levels['target_1'] . ' first target'; }
            return $line . '.';
        }

        return sml_dist_truncate($seo['tldr'], 180);
    }
}

if (!function_exists('sml_dist_moomoo_market_sentences')) {
    /**
     * Return verified moomoo/OpenD context without inventing unavailable facts.
     * Integrations can supply richer news, earnings and options context through
     * sml_dist_moomoo_context; the shared OpenD bridge supplies the live quote.
     */
    function sml_dist_moomoo_market_sentences($bundle, $seo) {
        $symbol = strtoupper((string) ($seo['primary'] ?? ''));
        $context = apply_filters('sml_dist_moomoo_context', array(), $symbol, $bundle, $seo);
        $out = array();

        if (is_string($context)) {
            $context = array($context);
        }
        foreach ((array) $context as $value) {
            if (is_array($value)) {
                continue;
            }
            foreach (sml_dist_sentences(wp_strip_all_tags((string) $value)) as $sentence) {
                $sentence = trim($sentence);
                if ($sentence !== '') {
                    $out[] = $sentence;
                }
            }
        }

        if (!$symbol) {
            return array_values(array_unique($out));
        }

        $cache_key = 'sml_dist_moomoo_context_' . md5($symbol);
        $snapshot = get_transient($cache_key);
        if (!is_array($snapshot)) {
            $snapshot = array();
            if (function_exists('sml_moomoo_request')) {
                // This runs inline in a video-render pipeline that can't afford
                // to wait around — a real bridge round-trip fast-fails at 3s
                // and, deliberately, is NOT retried (retries=>0): a 30s
                // "unavailable" placeholder cache below covers the next call
                // instead of this one call paying for multiple attempts.
                $result = sml_moomoo_request('/market', array('symbol' => $symbol, 'depth' => 1, 'ticks' => 0), array(
                    'timeout' => 3, 'retries' => 0, 'cache_bust' => true,
                ));
                if ($result['ok'] && !empty($result['data']['available'])) {
                    $snapshot = $result['data'];
                }
            }
            set_transient($cache_key, $snapshot ?: array('unavailable' => true), 30);
        }

        if (!empty($snapshot['available']) && is_array($snapshot['snapshot'] ?? null)) {
            $quote = $snapshot['snapshot'];
            $last = isset($quote['current']) ? (float) $quote['current'] : (isset($quote['last_price']) ? (float) $quote['last_price'] : 0.0);
            $change = isset($quote['change']) ? (float) $quote['change'] : null;
            $change_pct = isset($quote['change_pct']) ? (float) $quote['change_pct'] : null;
            if ($last > 0) {
                $line = '$' . $symbol . ' last traded at $' . number_format($last, 2);
                if ($change !== null && $change_pct !== null) {
                    $line .= ', ' . ($change >= 0 ? 'up ' : 'down ')
                        . '$' . number_format(abs($change), 2) . ' (' . number_format(abs($change_pct), 2) . '%)';
                }
                $out[] = $line . '.';
            }

            $book = is_array($snapshot['book'] ?? null) ? $snapshot['book'] : array();
            $bid = (float) ($book['bids'][0]['price'] ?? $quote['bid_price'] ?? 0);
            $ask = (float) ($book['asks'][0]['price'] ?? $quote['ask_price'] ?? 0);
            if ($bid > 0 && $ask >= $bid) {
                $out[] = 'OpenD showed a best bid of $' . number_format($bid, 2)
                    . ' and best ask of $' . number_format($ask, 2)
                    . ' for $' . $symbol . ', a spread of $' . number_format($ask - $bid, 2) . '.';
            }
        }

        return array_values(array_unique($out));
    }
}

if (!function_exists('sml_dist_moomoo_copy')) {
    /** Build a distinct title plus a minimum four-sentence factual description. */
    function sml_dist_moomoo_copy($bundle, $seo, $link) {
        $symbol = strtoupper((string) ($seo['primary'] ?? ''));
        $raw_title = trim(wp_strip_all_tags((string) ($bundle['title'] ?? 'Market breakdown')));
        // Remove creator-supplied cashtags before rebuilding one canonical,
        // deduplicated ticker line. Numeric dollar prices are left untouched.
        $raw_title = trim(preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $raw_title));

        $tickers = array();
        foreach ((array) ($seo['symbols'] ?? array()) as $item) {
            $candidate = strtoupper((string) (is_array($item) ? ($item['symbol'] ?? '') : $item));
            if ($candidate !== '' && preg_match('/^[A-Z][A-Z0-9.]{0,9}$/', $candidate) && !in_array($candidate, $tickers, true)) {
                $tickers[] = $candidate;
            }
            if (count($tickers) === 3) {
                break;
            }
        }
        if (!$tickers && $symbol !== '') {
            $tickers[] = $symbol;
        }
        $cashtags = array_map(static function ($ticker) { return '$' . $ticker; }, $tickers);

        $headline_leads = array(
            'Earnings'  => 'The Earnings Setup Traders Cannot Ignore:',
            'Levels'    => 'Breakout or Breakdown? The Level That Decides It:',
            'Macro'     => 'The Headline Is Not the Whole Story:',
            'Recap'     => 'What Actually Moved the Market:',
            'Education' => 'The Trading Detail Most People Miss:',
            'Watchlist' => 'The Setups Demanding Attention Now:',
            'Thesis'    => 'The Market May Be Missing This:',
        );
        $lead = $headline_leads[$seo['content_type'] ?? 'Thesis'] ?? $headline_leads['Thesis'];
        $headline = rtrim($raw_title, " \t\n\r\0\x0B.!?");
        $title_prefix = $cashtags ? implode(' ', $cashtags) . ' — ' : '';
        $title = trim($title_prefix . $lead . ' ' . $headline);
        $title = sml_dist_truncate($title, 150);

        $sentences = sml_dist_moomoo_market_sentences($bundle, $seo);
        $sources = array_merge(
            sml_dist_sentences((string) ($bundle['plaintext'] ?? '')),
            sml_dist_sentences((string) ($seo['tldr'] ?? ''))
        );
        foreach ($sources as $sentence) {
            $sentence = trim(wp_strip_all_tags((string) $sentence));
            if ($sentence !== '' && !in_array($sentence, $sentences, true)) {
                $sentences[] = $sentence;
            }
            if (count($sentences) >= 5) {
                break;
            }
        }

        $levels = sml_dist_levels($bundle);
        if (count($sentences) < 4 && $levels && $levels['entry'] !== '') {
            $line = ($symbol ?: 'The setup') . ' identifies ' . $levels['entry'] . ' as the entry';
            if ($levels['stop'] !== '') {
                $line .= ', with ' . $levels['stop'] . ' as invalidation';
            }
            if ($levels['target_1'] !== '') {
                $line .= ' and ' . $levels['target_1'] . ' as the first target';
            }
            $sentences[] = $line . '.';
        }

        $fallbacks = array(
            ($symbol ?: 'This ticker') . ' is evaluated using the catalyst, recent price action, liquidity, and risk described in the full breakdown.',
            'The analysis separates confirmed facts from scenarios that still require market confirmation.',
            'Traders should verify the current quote, upcoming earnings date, and options activity before acting because those inputs can change quickly.',
            'The linked video contains the complete thesis, chart context, invalidation, and supporting evidence.',
        );
        foreach ($fallbacks as $fallback) {
            if (count($sentences) >= 4) {
                break;
            }
            $sentences[] = $fallback;
        }

        $description = implode(' ', array_slice(array_values(array_unique($sentences)), 0, 5));
        // The three permitted cashtags appear once in the title only. Removing
        // them here prevents accidental duplicate tagging in source prose or
        // injected OpenD context while preserving $123.45 price notation.
        $description = trim(preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $description));
        $caption = $title . "\n\n" . $description;
        if ($link !== '') {
            $caption .= "\n\n" . $link;
        }

        return array(
            'title'       => $title,
            'description' => $description,
            'caption'     => $caption,
        );
    }
}

if (!function_exists('sml_dist_webull_sector_tickers')) {
    /** Select at most five unique peers from the primary ticker's sector. */
    function sml_dist_webull_sector_tickers($seo) {
        $groups = apply_filters('sml_dist_webull_sector_groups', array(
            array('NVDA','AMD','AVGO','TSM','QCOM','MU','INTC','ARM'),
            array('AAPL','MSFT','GOOGL','META','AMZN','NFLX','ORCL','CRM'),
            array('TSLA','RIVN','LCID','NIO','XPEV','LI'),
            array('JPM','BAC','WFC','C','GS','MS'),
            array('XOM','CVX','COP','OXY','SLB','EOG'),
            array('LLY','NVO','MRK','PFE','ABBV','BMY'),
            array('WMT','COST','TGT','HD','LOW','AMZN'),
            array('SPY','QQQ','DIA','IWM','VTI'),
        ));
        $primary = strtoupper((string) ($seo['primary'] ?? ''));
        $sector = array();
        foreach ((array) $groups as $group) {
            $clean_group = array_values(array_unique(array_map('strtoupper', (array) $group)));
            if ($primary !== '' && in_array($primary, $clean_group, true)) {
                $sector = $clean_group;
                break;
            }
        }

        $detected = array();
        foreach ((array) ($seo['symbols'] ?? array()) as $item) {
            $candidate = strtoupper((string) (is_array($item) ? ($item['symbol'] ?? '') : $item));
            if ($candidate !== '' && preg_match('/^[A-Z][A-Z0-9.]{0,9}$/', $candidate)) {
                $detected[] = $candidate;
            }
        }

        $candidates = $sector
            ? array_merge(array($primary), array_intersect($detected, $sector), $sector)
            : array_merge(array($primary), $detected);
        return array_slice(array_values(array_unique(array_filter($candidates))), 0, 5);
    }
}

if (!function_exists('sml_dist_webull_copy')) {
    /** Dedicated no-link Webull post with title, subtitle and substantive body. */
    function sml_dist_webull_copy($bundle, $seo) {
        $symbol = strtoupper((string) ($seo['primary'] ?? ''));
        $raw_title = trim(wp_strip_all_tags((string) ($bundle['title'] ?? 'Market setup')));
        $raw_title = trim(preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $raw_title));

        $leads = array(
            'Earnings'  => 'The Earnings Setup Traders Cannot Ignore:',
            'Levels'    => 'Breakout or Breakdown? The Level That Decides It:',
            'Macro'     => 'The Market Is Pricing This Wrong:',
            'Recap'     => 'What Actually Moved the Market:',
            'Education' => 'The Trading Detail Most People Miss:',
            'Watchlist' => 'The Setups Demanding Attention Now:',
            'Thesis'    => 'The Market May Be Missing This:',
        );
        $type = (string) ($seo['content_type'] ?? 'Thesis');
        $title = sml_dist_truncate(($leads[$type] ?? $leads['Thesis']) . ' ' . rtrim($raw_title, " \t\n\r\0\x0B.!?"), 150);

        $subtitle_templates = array(
            'Earnings' => '%s earnings outlook, guidance risk, price action, and options positioning',
            'Levels'   => '%s stock analysis: breakout levels, support, resistance, volume, and risk',
            'Macro'    => '%s market outlook: catalysts, sector rotation, liquidity, and risk',
            'Recap'    => '%s price action explained: catalyst, volume, momentum, and next levels',
            'Watchlist'=> '%s sector watch: relative strength, catalysts, technical levels, and risk',
            'Thesis'   => '%s stock analysis: price action, catalysts, earnings outlook, and sector momentum',
        );
        $subject = $symbol ?: 'Market';
        $subtitle = sprintf($subtitle_templates[$type] ?? $subtitle_templates['Thesis'], $subject);

        $sentences = sml_dist_moomoo_market_sentences($bundle, $seo);
        $source_text = preg_replace('/\bStockMarketLoop\b/i', '', (string) ($bundle['plaintext'] ?? ''));
        $source_text = preg_replace('~https?://\S+~iu', '', $source_text);
        foreach (array_merge(sml_dist_sentences($source_text), sml_dist_sentences((string) ($seo['tldr'] ?? ''))) as $sentence) {
            $sentence = trim(preg_replace('/\s+/u', ' ', wp_strip_all_tags((string) $sentence)));
            if ($sentence !== '' && !in_array($sentence, $sentences, true)) {
                $sentences[] = $sentence;
            }
            if (count($sentences) >= 5) {
                break;
            }
        }

        $fallbacks = array(
            $subject . ' is being evaluated through its current catalyst, recent price action, sector strength, liquidity, and downside risk.',
            'The setup remains conditional on buyers confirming the move with volume rather than relying on headline momentum alone.',
            'Upcoming earnings, guidance changes, and unusual options activity should be verified because each can quickly change the risk profile.',
            'The strongest confirmation would be sustained relative strength while the identified support and invalidation levels remain intact.',
        );
        foreach ($fallbacks as $fallback) {
            if (count(array_unique($sentences)) >= 4) {
                break;
            }
            $sentences[] = $fallback;
        }
        $description = implode(' ', array_slice(array_values(array_unique($sentences)), 0, 5));
        $description = trim(preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $description));
        $description = trim(preg_replace('~https?://\S+~iu', '', $description));

        $attribution = 'Market data and active trader discussion for this topic were reviewed through StockMarketLoop.';
        $tickers = array_map(static function ($ticker) { return '$' . $ticker; }, sml_dist_webull_sector_tickers($seo));
        $caption = $title
            . "\n" . $subtitle
            . "\n\n" . $description . ' ' . $attribution
            . "\n\n" . implode(' ', $tickers);

        return array(
            'title' => $title,
            'subtitle' => $subtitle,
            'description' => trim($description . ' ' . $attribution),
            'caption' => $caption,
        );
    }
}

if (!function_exists('sml_dist_etoro_copy')) {
    /** Build a clean, discussion-led post within eToro's community rules. */
    function sml_dist_etoro_copy($bundle, $seo) {
        $symbol = strtoupper((string) ($seo['primary'] ?? ''));
        $raw_title = trim(wp_strip_all_tags((string) ($bundle['title'] ?? 'Market setup')));
        $raw_title = preg_replace('~https?://\S+~iu', '', $raw_title);
        $raw_title = trim(preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $raw_title));

        $leads = array(
            'Earnings'  => 'The Earnings Question the Market Must Answer:',
            'Levels'    => 'Breakout or Breakdown? The Level That Matters:',
            'Macro'     => 'The Macro Signal Beneath the Headline:',
            'Recap'     => 'What Actually Moved the Market:',
            'Education' => 'The Market Detail Worth Understanding:',
            'Watchlist' => 'The Setups Worth Watching Closely:',
            'Thesis'    => 'The Market May Be Missing This:',
        );
        $type = (string) ($seo['content_type'] ?? 'Thesis');
        $title = sml_dist_truncate(($leads[$type] ?? $leads['Thesis']) . ' ' . rtrim($raw_title, " \t\n\r\0\x0B.!?"), 150);

        $subtitle_templates = array(
            'Earnings' => '%s earnings outlook, expectations, price action, and risk',
            'Levels'   => '%s market structure: support, resistance, volume, and confirmation',
            'Macro'    => '%s market context: rates, liquidity, sector rotation, and risk',
            'Recap'    => '%s price action: catalyst, breadth, momentum, and next confirmation',
            'Watchlist'=> '%s sector watch: relative strength, catalysts, and market structure',
            'Thesis'   => '%s market analysis: price action, catalysts, earnings, and sector momentum',
        );
        $subject = $symbol ?: 'Market';
        $subtitle = sprintf($subtitle_templates[$type] ?? $subtitle_templates['Thesis'], $subject);

        $sentences = sml_dist_moomoo_market_sentences($bundle, $seo);
        $source_text = preg_replace('~https?://\S+~iu', '', (string) ($bundle['plaintext'] ?? ''));
        $source_text = preg_replace('/\bStockMarketLoop\b/i', '', $source_text);
        $imperative = '/\b(?:buy|sell|invest in|enter now|short now|go long|go short|load up|all in|must own)\b/i';
        foreach (array_merge(sml_dist_sentences($source_text), sml_dist_sentences((string) ($seo['tldr'] ?? ''))) as $sentence) {
            $sentence = trim(preg_replace('/\s+/u', ' ', wp_strip_all_tags((string) $sentence)));
            if ($sentence !== '' && !preg_match($imperative, $sentence) && !in_array($sentence, $sentences, true)) {
                $sentences[] = $sentence;
            }
            if (count($sentences) >= 5) {
                break;
            }
        }

        $fallbacks = array(
            $subject . ' is being evaluated through its current catalyst, recent price action, sector participation, liquidity, and downside risk.',
            'The thesis remains conditional on confirmation from volume and market breadth rather than headline momentum alone.',
            'Upcoming earnings, guidance changes, and options positioning may alter the risk profile as new information reaches the market.',
            'A stronger signal would require sustained relative strength while the identified support and invalidation areas remain intact.',
        );
        foreach ($fallbacks as $fallback) {
            if (count(array_unique($sentences)) >= 4) {
                break;
            }
            $sentences[] = $fallback;
        }
        $description = implode(' ', array_slice(array_values(array_unique($sentences)), 0, 5));
        $description = trim(preg_replace('~https?://\S+~iu', '', $description));
        $description = trim(preg_replace('/\bStockMarketLoop\b/i', '', $description));
        $description = trim(preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $description));
        $description = trim(preg_replace($imperative, 'evaluate', $description));

        $questions = array(
            'Earnings' => 'Which matters more here: the reported numbers, forward guidance, or the market reaction?',
            'Levels'   => 'Which confirmation would make this market structure more convincing?',
            'Macro'    => 'Which macro input is most likely to change this outlook next?',
            'Recap'    => 'Does this look like healthy consolidation or weakening participation?',
            'Watchlist'=> 'Which of these related assets is showing the clearest relative strength?',
            'Thesis'   => 'What evidence would confirm or invalidate this thesis for you?',
        );
        $question = $questions[$type] ?? $questions['Thesis'];
        $tickers = array_map(static function ($ticker) { return '$' . $ticker; }, sml_dist_webull_sector_tickers($seo));
        $caption = $title . "\n" . $subtitle . "\n\n" . $description
            . "\n\n" . $question . "\n\n" . implode(' ', $tickers);

        return array(
            'title' => $title,
            'subtitle' => $subtitle,
            'description' => $description,
            'caption' => $caption,
        );
    }
}

if (!function_exists('sml_dist_quora_copy')) {
    /** Build a standalone, search-led Quora profile/Space post. */
    function sml_dist_quora_copy($bundle, $seo, $link) {
        $symbol = strtoupper((string) ($seo['primary'] ?? ''));
        $subject = $symbol ?: 'the market';
        $raw_title = trim(wp_strip_all_tags((string) ($bundle['title'] ?? 'Market analysis')));
        $raw_title = trim(preg_replace('~https?://\S+~iu', '', $raw_title));
        $raw_title = trim(preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $raw_title));
        $raw_title = trim(preg_replace('/\s+/u', ' ', $raw_title));
        $title = sml_dist_truncate(rtrim($raw_title, " \t\n\r\0\x0B.!?") . ': What the Market Data Shows', 140);

        $type = (string) ($seo['content_type'] ?? 'Thesis');
        $openers = array(
            'Earnings'  => 'The important issue is not simply whether the company beat expectations, but whether earnings, guidance, and the market reaction support the same conclusion.',
            'Levels'    => 'The useful way to evaluate this setup is to separate the visible price level from the volume, breadth, and follow-through needed to confirm it.',
            'Macro'     => 'This development matters because rates, liquidity, sector rotation, and risk appetite can change how the same headline is priced.',
            'Recap'     => 'The headline explains only part of the move; participation, volume, and relative strength provide the stronger test of its durability.',
            'Education' => 'The practical lesson is to evaluate the evidence in layers instead of treating one indicator or headline as a complete signal.',
            'Watchlist' => 'A useful watchlist is built around confirmation and invalidation, not simply a collection of symbols that recently moved.',
            'Thesis'    => 'The central question is whether the current catalyst, price action, and market participation reinforce one another or point to a fragile move.',
        );

        $paragraphs = array($openers[$type] ?? $openers['Thesis']);
        $source = preg_replace('~https?://\S+~iu', '', (string) ($bundle['plaintext'] ?? ''));
        $source = preg_replace('/\b(?:TITLE|SUBTITLE|DESCRIPTION|ANALYSIS|HASHTAGS)\s*:?/i', '', $source);
        $source = preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $source);
        $candidates = array_merge(
            sml_dist_moomoo_market_sentences($bundle, $seo),
            sml_dist_sentences($source),
            sml_dist_sentences((string) ($seo['tldr'] ?? ''))
        );
        foreach ($candidates as $sentence) {
            $sentence = trim(preg_replace('/\s+/u', ' ', wp_strip_all_tags((string) $sentence)));
            $sentence = trim(preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $sentence));
            if ($sentence === '' || in_array($sentence, $paragraphs, true)) {
                continue;
            }
            $paragraphs[] = $sentence;
            if (count($paragraphs) >= 5) {
                break;
            }
        }

        $fallbacks = array(
            'For ' . $subject . ', confirmation should come from sustained participation and volume rather than a single intraday reaction.',
            'Upcoming earnings, guidance, economic data, and unusual options positioning can all change the balance of risk as new information arrives.',
            'The most useful approach is to identify what would confirm the thesis, what would invalidate it, and which related assets are showing comparable strength or weakness.',
            'That framework keeps the discussion focused on observable evidence instead of turning market commentary into a prediction presented as certainty.',
        );
        foreach ($fallbacks as $fallback) {
            if (count(array_unique($paragraphs)) >= 5) {
                break;
            }
            $paragraphs[] = $fallback;
        }
        $paragraphs = array_slice(array_values(array_unique($paragraphs)), 0, 7);

        $tickers = array_slice(sml_dist_webull_sector_tickers($seo), 0, 3);
        if ($tickers) {
            $paragraphs[] = 'The most relevant symbols for this discussion are ' . implode(', ', array_map(static function ($ticker) {
                return '$' . $ticker;
            }, $tickers)) . '.';
        }

        $disclosure = 'Disclosure: I publish market research through StockMarketLoop.';
        if ($link) {
            $disclosure .= ' The complete charts, data, and original source article are available here: ' . $link;
        }
        $caption = $title . "\n\n" . implode("\n\n", $paragraphs) . "\n\n" . $disclosure;

        return array(
            'title' => $title,
            'subtitle' => '',
            'description' => implode(' ', $paragraphs),
            'caption' => $caption,
        );
    }
}

if (!function_exists('sml_dist_pinterest_copy')) {
    /** Build separate Pinterest title, description, destination and alt text. */
    function sml_dist_pinterest_copy($bundle, $seo, $link) {
        $symbol = strtoupper((string) ($seo['primary'] ?? ''));
        $raw_title = trim(wp_strip_all_tags((string) ($bundle['title'] ?? 'Market analysis')));
        $raw_title = trim(preg_replace('~https?://\S+~iu', '', $raw_title));
        $raw_title = trim(preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $raw_title));
        $raw_title = trim(preg_replace('/\s+/u', ' ', $raw_title));

        $type = (string) ($seo['content_type'] ?? 'Thesis');
        $prefixes = array(
            'Earnings'  => 'Earnings Analysis:',
            'Levels'    => 'Stock Chart Levels:',
            'Macro'     => 'Market Outlook:',
            'Recap'     => 'Market Recap:',
            'Education' => 'Trading Guide:',
            'Watchlist' => 'Stock Watchlist:',
            'Thesis'    => 'Stock Market Analysis:',
        );
        $title = sml_dist_truncate(($prefixes[$type] ?? $prefixes['Thesis']) . ' ' . $raw_title, 100);

        $source = preg_replace('~https?://\S+~iu', '', (string) ($bundle['plaintext'] ?? ''));
        $source = preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $source);
        $sentences = array();
        foreach (array_merge(sml_dist_sentences((string) ($seo['tldr'] ?? '')), sml_dist_sentences($source)) as $sentence) {
            $sentence = trim(preg_replace('/\s+/u', ' ', wp_strip_all_tags((string) $sentence)));
            $sentence = trim(preg_replace('~https?://\S+~iu', '', $sentence));
            $sentence = trim(preg_replace('/(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9._-]{0,14})\b/u', '$1', $sentence));
            if ($sentence !== '' && !in_array($sentence, $sentences, true)) {
                $sentences[] = $sentence;
            }
            if (count($sentences) >= 3) {
                break;
            }
        }
        if (!$sentences) {
            $sentences[] = 'Review the catalyst, recent price action, volume, market breadth, upcoming earnings, and the levels that would confirm or invalidate the setup.';
        }

        $keywords = array_slice(array_values(array_unique(array_filter(array_map(static function ($keyword) {
            return ltrim(trim(wp_strip_all_tags((string) $keyword)), '#$');
        }, (array) ($seo['keywords'] ?? array()))))), 0, 5);
        $tickers = array_slice(sml_dist_webull_sector_tickers($seo), 0, 3);
        $ticker_text = $tickers ? implode(' ', array_map(static function ($ticker) { return '$' . $ticker; }, $tickers)) : '';

        $description = implode(' ', $sentences);
        $description .= ' Use this StockMarketLoop breakdown to compare the catalyst, market structure, confirmation signals, and downside risk before the next session.';
        if ($keywords) {
            $description .= ' Topics: ' . implode(', ', $keywords) . '.';
        }
        if ($ticker_text) {
            $description .= ' ' . $ticker_text;
        }
        $description = sml_dist_truncate(trim($description), 800);

        $alt_subject = $symbol ? $symbol . ' stock market analysis' : 'stock market analysis';
        $alt_text = sml_dist_truncate('Vertical StockMarketLoop article graphic for ' . $alt_subject
            . ', summarizing the catalyst, price action, market levels, and risk discussed in “' . $raw_title . '.”', 500);
        $caption = $title . "\n\n" . $description . ($link ? "\n\n" . $link : '');

        return array(
            'title' => $title,
            'subtitle' => '',
            'description' => $description,
            'alt_text' => $alt_text,
            'caption' => $caption,
        );
    }
}

/* ==================================================================
 * Assembly with a character budget
 * ================================================================== */

if (!function_exists('sml_dist_assemble')) {
    /**
     * Drops whole components in reverse priority rather than hard-truncating,
     * because a caption cut mid-word reads as broken automation.
     */
    function sml_dist_assemble($parts, $link, $platform) {
        $meta = sml_dist_platform($platform);
        $budget = $meta ? (int) $meta['budget'] : 500;
        $linkCost = $meta && $meta['link_cost'] ? (int) $meta['link_cost'] : mb_strlen($link);

        // priority: lower survives longer
        $order = array('hook' => 1, 'symbols' => 2, 'cta' => 3, 'body' => 4, 'hashtags' => 5);
        $live = array_filter($parts, function ($v) {
            return trim((string) $v) !== '';
        });

        $render = function ($live) {
            $seq = array('hook', 'symbols', 'body', 'cta', 'hashtags');
            $out = array();
            foreach ($seq as $k) {
                if (!empty($live[$k])) {
                    $out[] = trim($live[$k]);
                }
            }
            return implode("\n\n", $out);
        };

        $fits = function ($live) use ($render, $budget, $linkCost) {
            return mb_strlen($render($live)) + $linkCost + 2 <= $budget;
        };

        while (!$fits($live) && $live) {
            // Trim the body a sentence at a time before sacrificing it entirely.
            if (!empty($live['body'])) {
                $sent = sml_dist_sentences($live['body']);
                if (count($sent) > 1) {
                    array_pop($sent);
                    $live['body'] = implode(' ', $sent);
                    continue;
                }
            }
            $victim = null;
            $worst = -1;
            foreach ($live as $k => $v) {
                $p = $order[$k] ?? 9;
                if ($p > $worst) {
                    $worst = $p;
                    $victim = $k;
                }
            }
            if ($victim === null) {
                break;
            }
            unset($live[$victim]);
        }

        $text = $render($live);
        return $link ? trim($text . "\n\n" . $link) : $text;
    }
}

/* ==================================================================
 * Variant generation
 * ================================================================== */

if (!function_exists('sml_dist_build_variant')) {
    function sml_dist_build_variant($bundle, $seo, $platform, $event, $seed, $link) {
        $meta = sml_dist_platform($platform);
        if (!$meta) {
            return null;
        }

        $hook = sml_dist_hook($seo, $bundle, $seed, $event);
        $body = sml_dist_body($seo, $bundle, $platform, $event);
        $cta  = sml_dist_cta($platform, $event, $seo);
        $tags = sml_dist_hashtags($seo, $platform);
        if (in_array($platform, array('moomoo', 'webull', 'etoro', 'quora', 'pinterest'), true)) {
            $tags = array();
        }

        $rendered = array();
        foreach (array_slice($seo['symbols'], 0, 3) as $s) {
            $rendered[] = sml_dist_render_symbol($s['symbol'], $platform);
        }

        // Instagram puts tags in the first comment, so they never compete with
        // the caption for characters or attention.
        $tagsInCaption = $platform === 'instagram' ? array() : $tags;

        // Instagram and TikTok links are not clickable, so shipping one is noise.
        $useLink = in_array($platform, array('instagram', 'tiktok', 'webull', 'etoro'), true) ? '' : $link;

        $caption = sml_dist_assemble(array(
            'hook'     => $hook,
            'symbols'  => implode(' ', $rendered),
            'body'     => $body,
            'cta'      => $cta,
            'hashtags' => implode(' ', $tagsInCaption),
        ), $useLink, $platform);

        $platform_title = '';
        $platform_subtitle = '';
        $platform_description = '';
        $platform_alt_text = '';
        if ($platform === 'moomoo') {
            $moomoo = sml_dist_moomoo_copy($bundle, $seo, $link);
            $platform_title = $moomoo['title'];
            $platform_description = $moomoo['description'];
            $caption = $moomoo['caption'];
        }
        if ($platform === 'webull') {
            $webull = sml_dist_webull_copy($bundle, $seo);
            $platform_title = $webull['title'];
            $platform_subtitle = $webull['subtitle'];
            $platform_description = $webull['description'];
            $caption = $webull['caption'];
        }
        if ($platform === 'etoro') {
            $etoro = sml_dist_etoro_copy($bundle, $seo);
            $platform_title = $etoro['title'];
            $platform_subtitle = $etoro['subtitle'];
            $platform_description = $etoro['description'];
            $caption = $etoro['caption'];
        }
        if ($platform === 'quora') {
            $quora = sml_dist_quora_copy($bundle, $seo, $link);
            $platform_title = $quora['title'];
            $platform_subtitle = $quora['subtitle'];
            $platform_description = $quora['description'];
            $caption = $quora['caption'];
        }
        if ($platform === 'pinterest') {
            $pinterest = sml_dist_pinterest_copy($bundle, $seo, $link);
            $platform_title = $pinterest['title'];
            $platform_subtitle = $pinterest['subtitle'];
            $platform_description = $pinterest['description'];
            $platform_alt_text = $pinterest['alt_text'];
            $caption = $pinterest['caption'];
        }

        return array(
            'platform'    => $platform,
            'seed'        => (int) $seed,
            'hook'        => $hook,
            'body'        => $body,
            'cta'         => $cta,
            'symbols'     => $rendered,
            'hashtags'    => $tags,
            'first_comment' => $platform === 'instagram' ? implode(' ', $tags) : '',
            'link'        => $link,
            'caption'     => $caption,
            'title'       => $platform_title,
            'subtitle'    => $platform_subtitle,
            'description' => $platform_description,
            'alt_text'    => $platform_alt_text,
            'char_count'  => mb_strlen($caption),
            'needs_image' => (bool) $meta['needs_image'],
            'entity_type' => (string) ($bundle['entity_type'] ?? ''),
            'event_type'  => (string) $event,
            'source_url'  => (string) ($bundle['url'] ?? ''),
            'cover_url'   => (string) ($bundle['cover'] ?? ''),
            'video_url'   => (string) ($bundle['video_url'] ?? ''),
            'video_mime'  => (string) ($bundle['video_mime'] ?? ''),
            'tier'        => $meta['tier'],
            'label'       => $meta['label'],
        );
    }
}

if (!function_exists('sml_dist_build_all')) {
    /**
     * @return array platform => [seed0, seed1, seed2]
     */
    function sml_dist_build_all($bundle, $seo, $platforms, $event, $link) {
        $out = array();
        foreach ($platforms as $platform) {
            $seeds = array();
            for ($s = 0; $s < 3; $s++) {
                $v = sml_dist_build_variant($bundle, $seo, $platform, $event, $s, $link);
                if ($v) {
                    $seeds[] = $v;
                }
            }
            if ($seeds) {
                $out[$platform] = $seeds;
            }
        }
        return $out;
    }
}

/* ==================================================================
 * YouTube description (structured, not a social caption)
 * ================================================================== */

if (!function_exists('sml_dist_youtube_description')) {
    function sml_dist_youtube_description($bundle, $seo, $link, $chapters = array()) {
        $lines = array($bundle['title'], '', $seo['tldr'], '');

        if ($chapters) {
            $lines[] = '⏱ Chapters';
            foreach ($chapters as $c) {
                $lines[] = ($c['time'] ?? '00:00') . ' ' . ($c['label'] ?? '');
            }
            $lines[] = '';
        }

        $syms = array();
        foreach ($seo['symbols'] as $s) {
            $syms[] = '$' . $s['symbol'];
        }
        if ($syms) {
            $lines[] = '📊 Tickers covered: ' . implode(' ', $syms);
        }
        $lines[] = '📄 Full written analysis: ' . $link;
        if ($seo['primary']) {
            $lines[] = '🔔 Levels and alerts: ' . home_url('/ticker/' . strtolower($seo['primary']) . '/');
        }

        $d = sml_dist_disclosure($bundle);
        if ($d) {
            $lines[] = '';
            $lines[] = $d . ' This is not financial advice.';
        }

        $lines[] = '';
        $lines[] = implode(' ', sml_dist_hashtags($seo, 'youtube_description'));

        return implode("\n", $lines);
    }
}
