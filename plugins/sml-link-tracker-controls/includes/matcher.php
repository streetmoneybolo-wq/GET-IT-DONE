<?php
/**
 * Access-rule matching for tracked links. No WordPress calls in this file so it can be unit tested on its own.
 *
 * A rule is array('rule_type' => ..., 'value' => ..., 'country_code' => optional 2-letter scope for region and city rules).
 * A visitor context is array('ip', 'country_code', 'country', 'region', 'city', 'device', 'platform', 'browser').
 */

if (!function_exists('sml_ltc_rule_types')) {
    function sml_ltc_rule_types() {
        return array(
            'country'  => 'Country',
            'region'   => 'State or region',
            'city'     => 'City',
            'device'   => 'Device type',
            'platform' => 'Operating system',
            'browser'  => 'Browser',
            'ip'       => 'IP address or range',
            'all'      => 'Everyone',
        );
    }
}

if (!function_exists('sml_ltc_norm')) {
    /** Lowercase, strip accents-ish punctuation and extra spaces so "São Paulo" and "sao  paulo" compare equal enough. */
    function sml_ltc_norm($s) {
        $s = (string) $s;
        if (function_exists('iconv')) {
            $t = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
            if (is_string($t) && $t !== '') { $s = $t; }
        }
        $s = strtolower($s);
        $s = preg_replace('/[^a-z0-9]+/', ' ', $s);
        return trim((string) $s);
    }
}

if (!function_exists('sml_ltc_country_codes')) {
    /** Names people type, mapped to ISO codes. Covers the common ones; anything else can be entered as the 2-letter code. */
    function sml_ltc_country_names() {
        return array(
            'united states' => 'US', 'usa' => 'US', 'america' => 'US', 'united kingdom' => 'GB', 'uk' => 'GB', 'england' => 'GB', 'great britain' => 'GB',
            'canada' => 'CA', 'australia' => 'AU', 'new zealand' => 'NZ', 'ireland' => 'IE', 'germany' => 'DE', 'france' => 'FR', 'spain' => 'ES',
            'italy' => 'IT', 'portugal' => 'PT', 'netherlands' => 'NL', 'belgium' => 'BE', 'switzerland' => 'CH', 'austria' => 'AT', 'sweden' => 'SE',
            'norway' => 'NO', 'denmark' => 'DK', 'finland' => 'FI', 'poland' => 'PL', 'czechia' => 'CZ', 'czech republic' => 'CZ', 'romania' => 'RO',
            'ukraine' => 'UA', 'russia' => 'RU', 'turkey' => 'TR', 'greece' => 'GR', 'israel' => 'IL', 'saudi arabia' => 'SA', 'united arab emirates' => 'AE',
            'uae' => 'AE', 'egypt' => 'EG', 'south africa' => 'ZA', 'nigeria' => 'NG', 'kenya' => 'KE', 'ghana' => 'GH', 'morocco' => 'MA',
            'india' => 'IN', 'pakistan' => 'PK', 'bangladesh' => 'BD', 'sri lanka' => 'LK', 'china' => 'CN', 'hong kong' => 'HK', 'taiwan' => 'TW',
            'japan' => 'JP', 'south korea' => 'KR', 'korea' => 'KR', 'singapore' => 'SG', 'malaysia' => 'MY', 'indonesia' => 'ID', 'thailand' => 'TH',
            'vietnam' => 'VN', 'philippines' => 'PH', 'mexico' => 'MX', 'brazil' => 'BR', 'argentina' => 'AR', 'chile' => 'CL', 'colombia' => 'CO',
            'peru' => 'PE', 'venezuela' => 'VE', 'jamaica' => 'JM', 'trinidad and tobago' => 'TT', 'haiti' => 'HT', 'dominican republic' => 'DO',
        );
    }
}

if (!function_exists('sml_ltc_country_code_of')) {
    /** "US", "us", "United States" => "US". Unknown names return ''. */
    function sml_ltc_country_code_of($value) {
        $raw = trim((string) $value);
        if (preg_match('/^[A-Za-z]{2}$/', $raw)) { return strtoupper($raw); }
        $map = sml_ltc_country_names();
        $n = sml_ltc_norm($raw);
        return isset($map[$n]) ? $map[$n] : '';
    }
}

if (!function_exists('sml_ltc_ip_in_range')) {
    /** Exact address or CIDR (v4 or v6). Anything malformed never matches. */
    function sml_ltc_ip_in_range($ip, $range) {
        $ip = trim((string) $ip);
        $range = trim((string) $range);
        if ($ip === '' || $range === '') { return false; }
        $bin = @inet_pton($ip);
        if ($bin === false) { return false; }
        if (strpos($range, '/') === false) {
            $rb = @inet_pton($range);
            return $rb !== false && $rb === $bin;
        }
        list($net, $bits) = explode('/', $range, 2);
        $nb = @inet_pton(trim($net));
        if ($nb === false || !ctype_digit($bits) || strlen($nb) !== strlen($bin)) { return false; }
        $bits = (int) $bits;
        $max = strlen($nb) * 8;
        if ($bits > $max) { return false; }
        $full = intdiv($bits, 8);
        if ($full && substr($bin, 0, $full) !== substr($nb, 0, $full)) { return false; }
        $rest = $bits % 8;
        if ($rest === 0) { return true; }
        $mask = (0xFF << (8 - $rest)) & 0xFF;
        return (ord($bin[$full]) & $mask) === (ord($nb[$full]) & $mask);
    }
}

if (!function_exists('sml_ltc_valid_ip_value')) {
    function sml_ltc_valid_ip_value($value) {
        $value = trim((string) $value);
        if (strpos($value, '/') === false) { return filter_var($value, FILTER_VALIDATE_IP) !== false; }
        list($net, $bits) = explode('/', $value, 2);
        if (filter_var($net, FILTER_VALIDATE_IP) === false || !ctype_digit($bits)) { return false; }
        $max = strpos($net, ':') !== false ? 128 : 32;
        return (int) $bits <= $max;
    }
}

if (!function_exists('sml_ltc_rule_matches')) {
    function sml_ltc_rule_matches($rule, $ctx) {
        $type = (string) ($rule['rule_type'] ?? '');
        $value = (string) ($rule['value'] ?? '');
        switch ($type) {
            case 'all':
                return true;
            case 'ip':
                return sml_ltc_ip_in_range($ctx['ip'] ?? '', $value);
            case 'country':
                $code = sml_ltc_country_code_of($value);
                $have = strtoupper((string) ($ctx['country_code'] ?? ''));
                if ($code !== '' && $have !== '') { return $code === $have; }
                return $have === '' && sml_ltc_norm($value) !== '' && sml_ltc_norm($value) === sml_ltc_norm($ctx['country'] ?? '');
            case 'region':
            case 'city':
                $scope = strtoupper((string) ($rule['country_code'] ?? ''));
                if ($scope !== '' && strtoupper((string) ($ctx['country_code'] ?? '')) !== $scope) { return false; }
                $have = sml_ltc_norm($ctx[$type] ?? '');
                return $have !== '' && $have === sml_ltc_norm($value);
            case 'device':
            case 'platform':
            case 'browser':
                $have = sml_ltc_norm($ctx[$type] ?? '');
                return $have !== '' && $have === sml_ltc_norm($value);
        }
        return false;
    }
}

if (!function_exists('sml_ltc_first_match')) {
    /** The first rule that blocks this visitor, or null. */
    function sml_ltc_first_match($rules, $ctx) {
        foreach ((array) $rules as $rule) {
            if (is_array($rule) && sml_ltc_rule_matches($rule, $ctx)) { return $rule; }
        }
        return null;
    }
}

if (!function_exists('sml_ltc_clean_rule')) {
    /** Validate and normalise a rule from user input. Returns array(rule) or array(null, 'why not'). */
    function sml_ltc_clean_rule($type, $value, $country_code = '') {
        $types = sml_ltc_rule_types();
        $type = strtolower(trim((string) $type));
        if (!isset($types[$type])) { return array(null, 'Choose what to block.'); }
        $value = trim((string) $value);
        $cc = '';
        if ($type === 'all') {
            return array(array('rule_type' => 'all', 'value' => '*', 'country_code' => ''), '');
        }
        if ($value === '') { return array(null, 'Enter a value to block.'); }
        if (strlen($value) > 120) { return array(null, 'That value is too long.'); }
        switch ($type) {
            case 'country':
                $code = sml_ltc_country_code_of($value);
                if ($code === '') { return array(null, 'Use the 2-letter country code (for example US, GB, IN) or a common country name.'); }
                $value = $code;
                break;
            case 'region':
            case 'city':
                $cc = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) $country_code));
                if ($cc !== '' && strlen($cc) !== 2) { return array(null, 'The country scope must be a 2-letter code.'); }
                break;
            case 'device':
                $d = sml_ltc_norm($value);
                if (!in_array($d, array('mobile', 'desktop', 'tablet'), true)) { return array(null, 'Device type is mobile, desktop or tablet.'); }
                $value = $d;
                break;
            case 'platform':
                $p = sml_ltc_norm($value);
                $known = array('windows' => 'Windows', 'macos' => 'macOS', 'mac os' => 'macOS', 'mac' => 'macOS', 'ios' => 'iOS', 'android' => 'Android', 'linux' => 'Linux');
                if (!isset($known[$p])) { return array(null, 'Operating system is Windows, macOS, iOS, Android or Linux.'); }
                $value = $known[$p];
                break;
            case 'browser':
                $b = sml_ltc_norm($value);
                $known = array('chrome' => 'Chrome', 'safari' => 'Safari', 'firefox' => 'Firefox', 'edge' => 'Edge');
                if (!isset($known[$b])) { return array(null, 'Browser is Chrome, Safari, Firefox or Edge.'); }
                $value = $known[$b];
                break;
            case 'ip':
                if (!sml_ltc_valid_ip_value($value)) { return array(null, 'Enter an IPv4 or IPv6 address, or a range like 203.0.113.0/24.'); }
                break;
        }
        return array(array('rule_type' => $type, 'value' => $value, 'country_code' => $cc), '');
    }
}
