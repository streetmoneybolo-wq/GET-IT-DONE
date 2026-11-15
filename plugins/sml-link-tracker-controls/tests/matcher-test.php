<?php
// php tests/matcher-test.php  (no WordPress needed)
require __DIR__ . '/../includes/matcher.php';
$fail = 0; $n = 0;
function t($name, $ok) { global $fail, $n; $n++; if (!$ok) { $fail++; echo "FAIL: $name\n"; } }

$us = array('ip' => '203.0.113.9', 'country_code' => 'US', 'country' => 'United States', 'region' => 'Georgia', 'city' => 'Atlanta', 'device' => 'mobile', 'platform' => 'iOS', 'browser' => 'Safari');
$ge = array('ip' => '198.51.100.7', 'country_code' => 'GE', 'country' => 'Georgia', 'region' => 'Tbilisi', 'city' => 'Tbilisi', 'device' => 'desktop', 'platform' => 'Windows', 'browser' => 'Chrome');

t('country by code', sml_ltc_rule_matches(array('rule_type' => 'country', 'value' => 'US'), $us));
t('country by name', sml_ltc_rule_matches(array('rule_type' => 'country', 'value' => 'United States'), $us));
t('country lowercase', sml_ltc_rule_matches(array('rule_type' => 'country', 'value' => 'us'), $us));
t('country miss', !sml_ltc_rule_matches(array('rule_type' => 'country', 'value' => 'GB'), $us));
t('region Georgia the state only matches the US visitor when scoped', sml_ltc_rule_matches(array('rule_type' => 'region', 'value' => 'Georgia', 'country_code' => 'US'), $us));
t('region Georgia scoped US does not hit the country Georgia', !sml_ltc_rule_matches(array('rule_type' => 'region', 'value' => 'Georgia', 'country_code' => 'US'), $ge));
t('city accent and case', sml_ltc_rule_matches(array('rule_type' => 'city', 'value' => 'ATLANTA'), $us));
t('city miss', !sml_ltc_rule_matches(array('rule_type' => 'city', 'value' => 'Boston'), $us));
t('device', sml_ltc_rule_matches(array('rule_type' => 'device', 'value' => 'mobile'), $us) && !sml_ltc_rule_matches(array('rule_type' => 'device', 'value' => 'mobile'), $ge));
t('platform', sml_ltc_rule_matches(array('rule_type' => 'platform', 'value' => 'iOS'), $us));
t('browser', sml_ltc_rule_matches(array('rule_type' => 'browser', 'value' => 'Chrome'), $ge));
t('exact ip', sml_ltc_rule_matches(array('rule_type' => 'ip', 'value' => '203.0.113.9'), $us) && !sml_ltc_rule_matches(array('rule_type' => 'ip', 'value' => '203.0.113.10'), $us));
t('cidr /24', sml_ltc_rule_matches(array('rule_type' => 'ip', 'value' => '203.0.113.0/24'), $us) && !sml_ltc_rule_matches(array('rule_type' => 'ip', 'value' => '203.0.114.0/24'), $us));
t('cidr non-octet /20', sml_ltc_ip_in_range('10.0.15.200', '10.0.0.0/20') && !sml_ltc_ip_in_range('10.0.16.1', '10.0.0.0/20'));
t('cidr /0 matches all v4', sml_ltc_ip_in_range('8.8.8.8', '0.0.0.0/0'));
t('ipv6 exact and cidr', sml_ltc_ip_in_range('2001:db8::1', '2001:db8::1') && sml_ltc_ip_in_range('2001:db8:0:1::5', '2001:db8::/32') && !sml_ltc_ip_in_range('2001:db9::1', '2001:db8::/32'));
t('v4 never matches v6 range', !sml_ltc_ip_in_range('1.2.3.4', '2001:db8::/32'));
t('garbage ip never matches', !sml_ltc_ip_in_range('not-an-ip', '1.2.3.4') && !sml_ltc_ip_in_range('1.2.3.4', 'bad/xx') && !sml_ltc_ip_in_range('1.2.3.4', '1.2.3.0/99'));
t('everyone', sml_ltc_rule_matches(array('rule_type' => 'all', 'value' => '*'), $us));
t('unknown type never matches', !sml_ltc_rule_matches(array('rule_type' => 'weird', 'value' => 'x'), $us));
t('empty geo never matches city or region rules', !sml_ltc_rule_matches(array('rule_type' => 'city', 'value' => ''), array('city' => '')));
t('country rule with unknown visitor country does not block', !sml_ltc_rule_matches(array('rule_type' => 'country', 'value' => 'US'), array('country_code' => '', 'country' => '')));

$m = sml_ltc_first_match(array(array('rule_type' => 'country', 'value' => 'GB'), array('rule_type' => 'device', 'value' => 'mobile')), $us);
t('first match picks the matching rule', $m && $m['rule_type'] === 'device');
t('no match is null', sml_ltc_first_match(array(array('rule_type' => 'country', 'value' => 'GB')), $us) === null);

list($r, $e) = sml_ltc_clean_rule('country', 'india');
t('clean country name to code', $r && $r['value'] === 'IN');
list($r, $e) = sml_ltc_clean_rule('country', 'Narnia');
t('clean country unknown rejected', $r === null && $e !== '');
list($r, $e) = sml_ltc_clean_rule('device', 'Tablet');
t('clean device', $r && $r['value'] === 'tablet');
list($r, $e) = sml_ltc_clean_rule('device', 'toaster');
t('clean device rejected', $r === null);
list($r, $e) = sml_ltc_clean_rule('platform', 'mac');
t('clean platform alias', $r && $r['value'] === 'macOS');
list($r, $e) = sml_ltc_clean_rule('ip', '203.0.113.0/24');
t('clean ip range', $r && $r['value'] === '203.0.113.0/24');
list($r, $e) = sml_ltc_clean_rule('ip', '999.1.1.1');
t('clean ip rejected', $r === null);
list($r, $e) = sml_ltc_clean_rule('region', 'Georgia', 'us');
t('clean region scope uppercased', $r && $r['country_code'] === 'US');
list($r, $e) = sml_ltc_clean_rule('region', 'Georgia', 'USA');
t('clean region scope must be 2 letters', $r === null);
list($r, $e) = sml_ltc_clean_rule('all', '');
t('clean all needs no value', $r && $r['rule_type'] === 'all');
list($r, $e) = sml_ltc_clean_rule('city', '');
t('clean city empty rejected', $r === null);
list($r, $e) = sml_ltc_clean_rule('nonsense', 'x');
t('clean unknown type rejected', $r === null);

echo $fail ? "$fail of $n FAILED\n" : "all $n passed\n";
exit($fail ? 1 : 0);
