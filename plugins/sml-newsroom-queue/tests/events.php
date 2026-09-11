<?php
require __DIR__ . '/../event.php';
use function StockMarketLoop\NewsroomQueue\normalize_event;
use function StockMarketLoop\NewsroomQueue\canonical_json;
$now = strtotime('2026-09-11T14:00:00Z');
$base = array('authority'=>'issuer-example','event_id'=>'release-1','event_type'=>'earnings',
    'title'=>'TEST FIXTURE: quarterly results','source_url'=>'https://example.com/release-1',
    'observed_at'=>'2026-09-11T13:59:00Z','expires_at'=>'2026-09-11T15:00:00Z',
    'symbols'=>array('SPY'), 'evidence'=>array('volume'=>null,'price'=>100));
$count = 0;
function check($condition, $name) { global $count; if (!$condition) throw new RuntimeException($name); $count++; echo "PASS $name\n"; }
$event = normalize_event($base, $now);
check($event['event_key'] === normalize_event($base, $now)['event_key'], 'retry retains event identity');
check($event['event_key'] !== normalize_event(array_replace($base,array('event_id'=>'release-2')), $now)['event_key'], 'distinct event same ticker is allowed');
check($event['event_key'] === normalize_event(array_replace($base,array('symbols'=>array('QQQ'))), $now)['event_key'], 'same official event deduplicates across ticker/desk routing');
check($event['evidence']['volume'] === null, 'unknown remains null');
check(canonical_json(array('a'=>1,'b'=>array('x'=>2,'y'=>3))) === canonical_json(array('b'=>array('y'=>3,'x'=>2),'a'=>1)), 'object key order does not cause false revision');
foreach (array(
    array('expires_at'=>'2026-09-11T13:00:00Z'),
    array('observed_at'=>'2026-09-11T14:03:00Z'),
    array('observed_at'=>'2026-02-30T13:00:00Z'),
    array('observed_at'=>'2026-09-11 13:59:00'),
    array('source_url'=>'javascript:alert(1)'),
    array('source_url'=>'https://user:password@example.com/'),
    array('symbols'=>array()), array('event_id'=>''), array('evidence'=>array()),
) as $i => $invalid) {
    $failed = false;
    try { normalize_event(array_replace($base,$invalid), $now); } catch (InvalidArgumentException $e) { $failed = true; }
    check($failed, 'invalid input rejected '.$i);
}
echo "$count checks passed. Fixtures only; no WordPress connection.\n";
