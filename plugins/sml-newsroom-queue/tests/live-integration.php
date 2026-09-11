<?php
// Run only with wp eval-file. Creates ONE clearly labeled draft fixture, then
// trashes that exact fixture recoverably. Never invokes an AI model or publisher.
use function StockMarketLoop\NewsroomQueue\table_name;
$GLOBALS['nr_checks'] = 0;
$post_id = 0;
$key = '';
function nr_check($condition, $message) { if (!$condition) throw new Exception($message); $GLOBALS['nr_checks']++; }
function nr_request($method, $path, $body = null) {
    $request = new WP_REST_Request($method, '/sml-newsroom-review/v1' . $path);
    if ($body !== null) { $request->set_header('content-type','application/json'); $request->set_body(wp_json_encode($body)); }
    return rest_do_request($request);
}
try {
    wp_set_current_user(0);
    nr_check(nr_request('GET','/events')->get_status() === 401, 'Anonymous read must be denied');
    nr_check(nr_request('POST','/events/1/draft',array())->get_status() === 401, 'Anonymous write must be denied');
    $admins = get_users(array('role'=>'administrator','number'=>1,'fields'=>'ID'));
    nr_check(!empty($admins), 'Admin required for fixture');
    wp_set_current_user((int)$admins[0]);
    $input = array('authority'=>'sml-integration-test','event_id'=>wp_generate_uuid4(),'event_type'=>'earnings',
        'title'=>'INTEGRATION TEST ONLY — options flow author routing fixture',
        'source_url'=>'https://stockmarketloop.com/', 'observed_at'=>gmdate('Y-m-d\TH:i:s\Z'),
        'expires_at'=>gmdate('Y-m-d\TH:i:s\Z',time()+600),'symbols'=>array('SPY'),
        'evidence'=>array('test_only'=>true,'notice'=>'No real market data, earnings claim or publication.'));
    $queued = nr_request('POST','/events',$input);
    nr_check($queued->get_status() === 200, 'Enqueue failed: ' . wp_json_encode($queued->get_data()));
    $id = $queued->get_data()['id']; $key = $queued->get_data()['event_key'];
    nr_check(nr_request('POST','/events',$input)->get_data()['id'] === $id, 'Enqueue not idempotent');
    $changed = $input; $changed['evidence']['notice'] = 'changed';
    nr_check(nr_request('POST','/events',$changed)->get_status() === 409, 'Changed evidence must conflict');
    // Local REST dispatcher parses query parameters via an explicit request.
    $request = new WP_REST_Request('GET','/sml-newsroom-review/v1/events'); $request->set_param('after',$id-1);
    $items = rest_do_request($request)->get_data()['items'];
    $item = array_values(array_filter($items, static fn($i)=>$i['id'] === $id))[0];
    nr_check($item['author']['name'] === 'Earnings Desk', 'Wrong registry/desk');
    $article = array('title'=>$input['title'],'subtitle'=>'INTEGRATION TEST — not for publication',
        'excerpt'=>'Test fixture. No market analysis or real earnings assertion.',
        'focus_keyword'=>'integration test','meta_description'=>'Internal unpublished integration test fixture, not a market report.',
        'body_html'=>'<p>' . str_repeat('This is an internal unpublished integration fixture. It contains no market data and is not an investment article. ', 8) . '</p><script>window.test=true</script><img src="https://invalid.example/test.png">');
    $body = array('payload_hash'=>$item['payload_hash'],'article'=>$article);
    nr_check(nr_request('POST','/events/'.$id.'/draft',array_merge($body,array('status'=>'publish')))->get_status() === 422, 'Status override not rejected');
    $wrong = $body; $wrong['payload_hash'] = str_repeat('0',64);
    nr_check(nr_request('POST','/events/'.$id.'/draft',$wrong)->get_status() === 409, 'Wrong evidence hash accepted');
    $saved = nr_request('POST','/events/'.$id.'/draft',$body);
    nr_check($saved->get_status() === 200, 'Draft failed: ' . wp_json_encode($saved->get_data()));
    $post_id = $saved->get_data()['post_id'];
    $post = get_post($post_id);
    nr_check($post->post_status === 'draft', 'Post was not a draft');
    nr_check((int)$post->post_author === $item['author']['id'], 'Author Guard overrode resolved author');
    nr_check(strpos($post->post_content,'<script') === false && strpos($post->post_content,'<img') === false, 'Unsafe HTML retained');
    nr_check(get_post_meta($post_id,'rank_math_focus_keyword',true) === 'integration test', 'SEO missing');
    $again = nr_request('POST','/events/'.$id.'/draft',$body)->get_data();
    nr_check($again['post_id'] === $post_id && $again['duplicate'], 'Draft retry duplicated content');
    echo wp_json_encode(array('checks'=>$GLOBALS['nr_checks'],'result'=>'pass','fixture_event_id'=>$id,'fixture_post_id'=>$post_id,'actual_status'=>$post->post_status,'author_id'=>(int)$post->post_author)) . "\n";
} finally {
    if ($post_id && get_post_meta($post_id,'_sml_newsroom_event_key',true) === $key && get_post_status($post_id) === 'draft') {
        $trashed = wp_trash_post($post_id);
        echo wp_json_encode(array('fixture_post_id'=>$post_id,'recoverable_trash'=>(bool)$trashed)) . "\n";
    }
}
