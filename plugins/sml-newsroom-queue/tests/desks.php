<?php
require __DIR__ . '/../draft.php';
use function StockMarketLoop\NewsroomQueue\desk_for_event;
use function StockMarketLoop\NewsroomQueue\draft_author;
$registry = array('Earnings Desk'=>22, 'SML News'=>33);
$users = array(22=>(object)array('display_name'=>'Earnings Desk'),33=>(object)array('display_name'=>'SML News'));
function get_option($name, $fallback) { return $GLOBALS['registry']; }
function get_user_by($field, $id) { return $GLOBALS['users'][$id] ?? false; }
function user_can($user, $capability) { return true; }
$count = 0;
function check($yes) { global $count; if (!$yes) throw new Exception('Assertion failed'); $count++; }
function rejects($fn) { try { $fn(); } catch (InvalidArgumentException $e) { check(true); return; } throw new Exception('Expected rejection'); }
check(desk_for_event('earnings_preview') === 'Earnings Desk');
check(desk_for_event('unusual_options') === 'Options Flow');
check(desk_for_event('sec_filing') === 'Filings & Actions');
check(desk_for_event('education') === 'Stock Market Beginners');
check(draft_author(array('event_type'=>'earnings')) === array('id'=>22, 'name'=>'Earnings Desk'));
rejects(fn()=>draft_author(array('event_type'=>'unusual_options')));
rejects(fn()=>draft_author(array('event_type'=>'made_up_topic')));
$users[22]->display_name = 'Different author';
rejects(fn()=>draft_author(array('event_type'=>'earnings')));
unset($users[22]);
rejects(fn()=>draft_author(array('event_type'=>'earnings')));
echo "PASS: {$count} desk routing checks\n";
