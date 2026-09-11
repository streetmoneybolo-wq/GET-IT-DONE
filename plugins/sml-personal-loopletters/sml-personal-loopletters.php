<?php
/**
 * Plugin Name: SML Personal Loop Letters
 * Description: Isolated two-a-day writing ledger for Vaughn McNair's Making Easy Money publication.
 * Version: 0.1.2
 */
namespace SML\PersonalLetters2026;
if (!defined('ABSPATH')) { exit; }

final class Brain {
    const OWNER = 258456581;
    const SERVICE = 258456587;
    const NS = 'sml-personal-letters/v1';
    const ENABLED = 'sml_pl26_enabled';
    public static function table() { global $wpdb; return $wpdb->prefix.'sml_personal_letters_jobs'; }
    public static function now() { return new \DateTimeImmutable('now', new \DateTimeZone('America/Chicago')); }
    public static function install() {
        global $wpdb;
        require_once ABSPATH.'wp-admin/includes/upgrade.php';
        $table=self::table(); $charset=$wpdb->get_charset_collate();
        dbDelta("CREATE TABLE $table (
            id bigint unsigned NOT NULL AUTO_INCREMENT,
            local_day date NOT NULL,
            slot tinyint unsigned NOT NULL,
            job_key varchar(64) NOT NULL,
            topic_key varchar(64) NOT NULL,
            status varchar(24) NOT NULL,
            evidence longtext NOT NULL,
            result longtext NULL,
            letter_id bigint unsigned NOT NULL DEFAULT 0,
            created_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY day_slot (local_day,slot),
            UNIQUE KEY job_key (job_key),
            UNIQUE KEY topic_key (topic_key)
        ) $charset;");
        add_option(self::ENABLED, false, '', false);
    }
    public static function operator() { return get_current_user_id()===self::OWNER || current_user_can('manage_options'); }
    public static function service() { return get_current_user_id()===self::SERVICE; }
    private static function require_owner() {
        if (get_user_meta(self::OWNER,'smll_handle',true)!=='vaughn-mcnair' ||
            !function_exists('sml_letters_can_publish') || !sml_letters_can_publish(self::OWNER)) {
            throw new \RuntimeException('Personal publication identity or publishing access unavailable.');
        }
        $routes=rest_get_server()->get_routes();
        if (!isset($routes['/sml-letters-seo/v1/letter/(?P<id>\d+)'])) throw new \RuntimeException('Existing letter SEO API unavailable.');
    }
    private static function locked($fn) {
        global $wpdb;
        $key='sml_pl26_'.get_current_blog_id();
        if ((int)$wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s,0)',$key))!==1) return new \WP_Error('busy','Personal writer busy.',array('status'=>409));
        try { return $fn(); }
        catch (\Throwable $e) { return new \WP_Error('personal_writer_failed',$e->getMessage(),array('status'=>422)); }
        finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)',$key)); }
    }
    public static function routes() {
        foreach (array('context'=>'GET','claim'=>'POST','complete'=>'POST') as $name=>$method) {
            register_rest_route(self::NS,'/'.$name,array('methods'=>$method,'callback'=>array(__CLASS__,$name),'permission_callback'=>array(__CLASS__,'service')));
        }
        register_rest_route(self::NS,'/status',array('methods'=>'GET','callback'=>array(__CLASS__,'status'),'permission_callback'=>array(__CLASS__,'operator')));
    }
    public static function status() {
        global $wpdb;
        return array('enabled'=>(bool)get_option(self::ENABLED,false),'owner_id'=>self::OWNER,'publication'=>'Making Easy Money',
            'worker_last_seen'=>get_option('sml_pl26_last_poll','Not yet seen'),
            'daily_attempt_limit'=>2,'timezone'=>'America/Chicago','windows'=>array('08:00–15:59','16:00–23:59'),
            'jobs'=>$wpdb->get_results('SELECT id,local_day,slot,status,letter_id,result,created_at FROM '.self::table().' ORDER BY id DESC LIMIT 20',ARRAY_A));
    }
    private static function due() {
        global $wpdb;
        if (!get_option(self::ENABLED,false)) return false;
        $now=self::now(); $hour=(int)$now->format('G');
        if (get_option('sml_pl26_run_now',false)===$now->format('Y-m-d')) {
            $day=$now->format('Y-m-d');
            for($slot=1;$slot<=2;$slot++) if(!$wpdb->get_var($wpdb->prepare('SELECT id FROM '.self::table().' WHERE local_day=%s AND slot=%d',$day,$slot))) return array('day'=>$day,'slot'=>$slot);
            return false;
        }
        if ($hour<8) return false;
        $slot=$hour<16?1:2; $day=$now->format('Y-m-d');
        if ($wpdb->get_var($wpdb->prepare('SELECT id FROM '.self::table().' WHERE local_day=%s AND slot=%d',$day,$slot))) return false;
        return array('day'=>$day,'slot'=>$slot);
    }
    private static function bridge($path,$params) {
        $base=rtrim((string)get_option('sml_moomoo_bridge',''),'/');
        $key=(string)get_option('sml_moomoo_secret','');
        if (!$key || !wp_http_validate_url($base) || strpos($base,'https://')!==0) return array();
        $r=wp_safe_remote_get(add_query_arg($params,$base.$path),array('timeout'=>15,'redirection'=>0,'limit_response_size'=>300000,'headers'=>array('X-SML-Key'=>$key)));
        if (is_wp_error($r)||wp_remote_retrieve_response_code($r)!==200) return array();
        $d=json_decode(wp_remote_retrieve_body($r),true);
        $asof=(float)($d['asof']??0); if($asof>20000000000) $asof/=1000;
        return !empty($d['available']) && abs(time()-$asof)<600 ? $d : array();
    }
    public static function context() {
        update_option('sml_pl26_last_poll',gmdate('c'),false);
        if (!self::due()) return array('due'=>false);
        try { self::require_owner(); } catch (\Throwable $e) { return new \WP_Error('owner_unavailable',$e->getMessage(),array('status'=>409)); }
        $cached=get_transient('sml_pl26_packet');
        if (is_array($cached)) return array('due'=>true,'packet'=>$cached);
        $universe=self::bridge('/universe',array('market'=>'US','count'=>8));
        $rows=(array)($universe['rows']??array());
        // Provider heat is not Google/Bing search demand. Rotate candidates between windows.
        if (self::due()['slot']===2) $rows=array_reverse($rows);
        foreach (array_slice($rows,0,3) as $row) {
            $symbol=preg_replace('/^US\./','',(string)($row['security']??''));
            if (!preg_match('/^[A-Z]{1,5}$/',$symbol)) continue;
            $market=self::bridge('/market',array('symbol'=>$symbol,'depth'=>1,'ticks'=>1));
            $s=$market['snapshot']??array();
            $ts=is_numeric($s['timestamp_ms']??null)?(int)($s['timestamp_ms']/1000):0;
            if (!$ts || $ts>time()+300 || time()-$ts>96*3600 || !is_numeric($s['current']??null) || $s['current']<=0) continue;
            if (!is_numeric($s['change_pct']??null) || abs((float)$s['change_pct'])<1.5) continue;
            $candles=self::bridge('/candles',array('symbol'=>$symbol,'count'=>60));
            $bars=array_values(array_filter((array)($candles['rows']??array()),static function($b){return is_numeric($b['close']??null)&&$b['close']>0&&!empty($b['time_key']);}));
            usort($bars,static function($a,$b){return strcmp($a['time_key'],$b['time_key']);});
            $bars=array_slice($bars,-40);
            $facts=array();
            foreach(array('current','change_pct','prev_close','open','high','low','volume') as $k) $facts[$k]=is_numeric($s[$k]??null)?(float)$s[$k]:null;
            $packet=array('symbol'=>$symbol,'company'=>sanitize_text_field($row['name']??$symbol),'observed_at'=>gmdate('c',$ts),'fetched_at'=>gmdate('c'),
                'expires_at'=>gmdate('c',time()+1800),'snapshot'=>$facts,'adjustment'=>sanitize_text_field($candles['adjustment']??'unknown'),
                'bars'=>array_map(static function($b){return array('date'=>$b['time_key'],'close'=>(float)$b['close'],'volume'=>is_numeric($b['volume']??null)?(float)$b['volume']:null);},$bars),
                'google_trends'=>null,'bing_trends'=>null,'sources'=>array(array('id'=>'market','url'=>home_url('/stock-chart/?symbol='.$symbol),'kind'=>'SML market-data capture','asof'=>gmdate('c',$ts))));
            $packet['topic_key']=hash('sha256',$symbol.'|'.gmdate('Y-m-d',$ts).'|market-analysis');
            global $wpdb;
            if ($wpdb->get_var($wpdb->prepare('SELECT id FROM '.self::table().' WHERE topic_key=%s',$packet['topic_key']))) continue;
            $packet['hash']=hash('sha256',wp_json_encode($packet));
            set_transient('sml_pl26_packet',$packet,300);
            return array('due'=>true,'packet'=>$packet);
        }
        return array('due'=>true,'packet'=>null,'reason'=>'No fresh, unused market candidate met the evidence threshold.');
    }
    public static function claim($r) {
        return self::locked(static function()use($r){
            global $wpdb;
            self::require_owner(); $due=self::due(); $p=get_transient('sml_pl26_packet');
            if(!$due || !is_array($p) || !hash_equals($p['hash'],(string)$r->get_param('hash')) || strtotime($p['expires_at'])<=time()) throw new \RuntimeException('Slot or evidence unavailable.');
            $key=bin2hex(random_bytes(24)); $now=gmdate('Y-m-d H:i:s');
            $ok=$wpdb->insert(self::table(),array('local_day'=>$due['day'],'slot'=>$due['slot'],'job_key'=>$key,'topic_key'=>$p['topic_key'],'status'=>'claimed','evidence'=>wp_json_encode($p),'created_at'=>$now,'updated_at'=>$now));
            if(!$ok) throw new \RuntimeException('Slot already reserved or database unavailable.');
            delete_option('sml_pl26_run_now');
            return array('job_key'=>$key,'packet'=>$p,'owner_id'=>self::OWNER);
        });
    }
    private static function call($method,$route,$body=array()) {
        $r=new \WP_REST_Request($method,$route); $r->set_body_params($body);
        $response=rest_do_request($r);
        if($response->is_error()) throw new \RuntimeException('Existing Letters API rejected '.$route.'.');
        return $response->get_data();
    }
    private static function row($id) { global $wpdb; return $wpdb->get_row($wpdb->prepare('SELECT * FROM '.sml_letters_table('posts').' WHERE id=%d',$id),ARRAY_A); }
    private static function cover($packet,$id) {
        if (!function_exists('imagecreatetruecolor')) throw new \RuntimeException('Featured image renderer unavailable.');
        $im=imagecreatetruecolor(1200,630); $bg=imagecolorallocate($im,7,18,22); $green=imagecolorallocate($im,0,235,156); $white=imagecolorallocate($im,230,242,240);
        imagefill($im,0,0,$bg);
        imagestring($im,5,50,40,'MAKING EASY MONEY | LOOP LETTERS',$green);
        imagestring($im,5,50,95,'$'.$packet['symbol'].' | '.substr($packet['company'],0,70),$white);
        imagestring($im,5,50,140,'Market analysis | snapshot '.$packet['observed_at'],$white);
        $bars=$packet['bars']; $v=array_column($bars,'close');
        if(count($v)>1 && max($v)>min($v)) {
            $min=min($v);$range=max($v)-$min; imagesetthickness($im,4);
            for($i=1;$i<count($v);$i++) imageline($im,50+($i-1)*1100/(count($v)-1),480-($v[$i-1]-$min)*250/$range,50+$i*1100/(count($v)-1),480-($v[$i]-$min)*250/$range,$green);
            imagestring($im,3,50,515,'Observed closes: '.substr($bars[0]['date'],0,10).' to '.substr(end($bars)['date'],0,10).' | '.$packet['adjustment'],$white);
        }
        imagestring($im,5,50,575,'STOCKMARKETLOOP.COM | Historical observations, not a forecast',$green);
        ob_start();imagepng($im);$bytes=ob_get_clean();imagedestroy($im);
        $u=wp_upload_bits('making-easy-money-letter-'.$id.'.png',null,$bytes);
        if(!empty($u['error'])) throw new \RuntimeException('Could not save featured image.');
        return $u['url'];
    }
    public static function complete($r) {
        return self::locked(static function()use($r){
            global $wpdb;
            $table=self::table(); $job=$wpdb->get_row($wpdb->prepare("SELECT * FROM $table WHERE job_key=%s",(string)$r->get_param('job_key')),ARRAY_A);
            if(!$job) throw new \RuntimeException('Unknown job.');
            if($job['status']!=='claimed') return array('status'=>$job['status'],'letter_id'=>(int)$job['letter_id'],'duplicate'=>true);
            $p=json_decode($job['evidence'],true); $article=$r->get_param('article'); $check=$r->get_param('verification');
            $reason='';
            if(!get_option(self::ENABLED,false)) $reason='Paused by owner.';
            elseif($job['local_day']!==self::now()->format('Y-m-d') || strtotime($p['expires_at'])<time()) $reason='Evidence or daily slot expired.';
            elseif(!is_array($article)||!is_array($check)||($check['pass']??false)!==true||!empty($check['issues'])) $reason='Generation or evidence verification failed.';
            if($reason) {
                $issues=array_slice(array_map('sanitize_text_field',(array)($check['issues']??array())),0,20);
                $wpdb->update($table,array('status'=>'held','result'=>wp_json_encode(array('reason'=>$reason,'issues'=>$issues)),'updated_at'=>gmdate('Y-m-d H:i:s')),array('id'=>$job['id']));
                return array('status'=>'held','reason'=>$reason);
            }
            self::require_owner();
            $fields=array('title'=>140,'subtitle'=>220,'excerpt'=>400,'focus_keyword'=>100,'meta_description'=>180);
            foreach($fields as $f=>$max) if(!is_string($article[$f]??null)||strlen($article[$f])<1||strlen($article[$f])>$max||wp_strip_all_tags($article[$f])!==$article[$f]) throw new \RuntimeException('Invalid article '.$f.'.');
            $sections=$article['sections']??null;
            if(!is_array($sections)||count($sections)<3||count($sections)>8) throw new \RuntimeException('Invalid article sections.');
            $blocks=array();$words=0;
            $add=static function($type,$data)use(&$blocks){$blocks[]=array_merge(array('id'=>'pl'.(count($blocks)+1),'type'=>$type),$data);};
            $add('paragraph',array('spans'=>array(array('text'=>'Data snapshot: '.$p['observed_at'].'. This analysis uses observed data, not a streaming quote.'))));
            foreach($sections as $s) {
                if(!is_string($s['heading']??null)||strlen($s['heading'])>120||!is_array($s['paragraphs']??null)||count($s['paragraphs'])>5) throw new \RuntimeException('Invalid section.');
                $add('heading',array('level'=>2,'text'=>sanitize_text_field($s['heading'])));
                foreach($s['paragraphs'] as $text) {
                    if(!is_string($text)||strlen($text)>2500||wp_strip_all_tags($text)!==$text) throw new \RuntimeException('Invalid paragraph.');
                    $words+=str_word_count($text);$add('paragraph',array('spans'=>array(array('text'=>$text))));
                }
            }
            if($words<250||$words>1000) throw new \RuntimeException('Article needs 250–1000 substantive words.');
            $add('heading',array('level'=>2,'text'=>'Source and disclosure'));
            $add('paragraph',array('spans'=>array(array('text'=>'View $'.$p['symbol'].' market data on StockMarketLoop','mark'=>'link','href'=>$p['sources'][0]['url']))));
            $add('paragraph',array('spans'=>array(array('text'=>'AI-assisted analysis based on the timestamped source data shown above. Historical price action does not predict future returns. This is general market commentary, not personalized investment advice.'))));
            $old=get_current_user_id(); wp_set_current_user(self::OWNER);
            try {
                // Persist the draft ID before saving/publishing. Never recreate after uncertain outcome.
                $id=(int)$job['letter_id'];
                if(!$id) {
                    $created=self::call('POST','/sml-letters/v1/letters',array('title'=>$article['title'])); $id=(int)($created['letter_id']??0);
                    if(!$id||!$wpdb->update($table,array('letter_id'=>$id),array('id'=>$job['id']))) throw new \RuntimeException('Draft ID could not be recorded.');
                }
                $row=self::row($id);
                if(!$row||(int)$row['author_id']!==self::OWNER||$row['status']!=='draft') throw new \RuntimeException('Draft ownership/status changed; no overwrite.');
                $image=self::cover($p,$id);
                self::call('POST','/sml-letters/v1/letters/'.$id,array('title'=>$article['title'],'subtitle'=>$article['subtitle'],'tldr'=>$article['excerpt'],'cover_url'=>$image,'tags'=>array($p['symbol']),'visibility'=>'public','blocks'=>$blocks));
                $saved=self::row($id);
                if(($saved['title']??'')!==$article['title']||($saved['cover_url']??'')!==$image||(int)($saved['word_count']??0)<250) throw new \RuntimeException('Draft readback failed.');
                $url=home_url('/n/vaughn-mcnair/'.$saved['slug'].'/');
                $seo=array('meta_title'=>$article['title'],'meta_desc'=>$article['meta_description'],'canonical'=>$url,'keyword'=>$article['focus_keyword'],'og_title'=>$article['title'],'og_desc'=>$article['excerpt'],'social_image'=>$image,'twitter'=>'summary_large_image','schema'=>'AnalysisNewsArticle');
                self::call('POST','/sml-letters-seo/v1/letter/'.$id,array('seo'=>$seo));
                $seo_saved=self::call('GET','/sml-letters-seo/v1/letter/'.$id);
                if(($seo_saved['seo']['canonical']??'')!==$url) throw new \RuntimeException('SEO readback failed.');
                // Mark publishing BEFORE the side-effect; ambiguous requests must be reconciled, never retried.
                if(!$wpdb->update($table,array('status'=>'publishing','result'=>wp_json_encode(array('verification'=>$check,'url'=>$url))),array('id'=>$job['id']))) throw new \RuntimeException('Publish intent not recorded.');
                self::call('POST','/sml-letters/v1/letters/'.$id.'/publish');
                $row=self::row($id);
                if(($row['status']??'')!=='published') throw new \RuntimeException('Published status not confirmed.');
                $wpdb->update($table,array('status'=>'published','updated_at'=>gmdate('Y-m-d H:i:s')),array('id'=>$job['id']));
                return array('status'=>'published','letter_id'=>$id,'url'=>$url,'owner_id'=>self::OWNER);
            } catch (\Throwable $e) {
                // Only pre-publish failures can be held safely. Publishing is an uncertain side-effect.
                $wpdb->query($wpdb->prepare("UPDATE $table SET status='held', result=%s WHERE id=%d AND status='claimed'",wp_json_encode(array('reason'=>$e->getMessage())),$job['id']));
                throw $e;
            } finally { wp_set_current_user($old); }
        });
    }
    public static function menu() {
        if(self::operator()) add_management_page('Personal Loop Letters','Personal Loop Letters','read','sml-personal-letters',array(__CLASS__,'page'));
    }
    public static function toolbar($bar) {
        if(self::operator()) $bar->add_node(array('id'=>'sml-personal-letters','title'=>'Personal Letters AI','href'=>admin_url('tools.php?page=sml-personal-letters')));
    }
    public static function seo_owner() {
        // The existing custom-table Letters SEO renderer owns generated-letter metadata.
        // Suppress only Rank Math's generic /n/ page metadata for our published letter IDs.
        if(!class_exists('SML_Letters_SEO') || !function_exists('sml_letters_table')) return;
        $path=(string)wp_parse_url($_SERVER['REQUEST_URI']??'',PHP_URL_PATH);
        if(!preg_match('#^/n/vaughn-mcnair/([a-z0-9-]+)/?$#',$path,$m)) return;
        global $wpdb;
        $posts=sml_letters_table('posts'); $jobs=self::table();
        $found=$wpdb->get_var($wpdb->prepare("SELECT p.id FROM $posts p INNER JOIN $jobs j ON j.letter_id=p.id WHERE p.author_id=%d AND p.slug=%s AND p.status='published' LIMIT 1",self::OWNER,$m[1]));
        if(!$found) return;
        add_filter('rank_math/frontend/canonical','__return_false',999);
        add_filter('rank_math/frontend/description','__return_empty_string',999);
        add_filter('rank_math/json_ld','__return_empty_array',999);
        add_action('rank_math/head',static function(){
            global $wp_filter;
            // Paper can memoize the generic canonical before wp; remove its emitter as well.
            foreach(($wp_filter['rank_math/head']->callbacks??array()) as $priority=>$callbacks) foreach($callbacks as $entry) {
                $fn=$entry['function'];
                if(is_array($fn)&&is_object($fn[0])&&$fn[0] instanceof \RankMath\Frontend\Head&&in_array($fn[1],array('canonical','metadesc'),true)) remove_action('rank_math/head',$fn,$priority);
            }
            remove_all_actions('rank_math/opengraph/facebook');
            remove_all_actions('rank_math/opengraph/twitter');
        },0);
    }
    public static function page() {
        if(!self::operator()) wp_die('Not authorized.');
        if(isset($_POST['pl_action'])) {
            check_admin_referer('sml_pl26_toggle');
            if($_POST['pl_action']==='run_now') update_option('sml_pl26_run_now',self::now()->format('Y-m-d'),false);
            else { update_option(self::ENABLED, $_POST['pl_action']==='enable',false); delete_option('sml_pl26_run_now'); }
        }
        $state=self::status();
        echo '<div class="wrap"><h1>Making Easy Money — Personal Loop Letters</h1><p>Vaughn McNair only. Other authors are unaffected. Maximum two generation attempts per day; failed attempts count. Windows: 8am and 4pm America/Chicago. No catch-up batches.</p>';
        echo '<p>Status: <strong>'.($state['enabled']?'Enabled':'Paused').'</strong> · Worker last seen: '.esc_html($state['worker_last_seen']).'</p><form method="post">';wp_nonce_field('sml_pl26_toggle');
        echo '<button class="button button-primary" name="pl_action" value="'.($state['enabled']?'pause':'enable').'">'.($state['enabled']?'Pause personal writer':'Enable personal writer').'</button></form>';
        if($state['enabled']) { echo '<form method="post">';wp_nonce_field('sml_pl26_toggle');echo '<p><button class="button" name="pl_action" value="run_now">Use next daily slot now</button> Counts toward the same two-attempt limit. No additional attempt or retry.</p></form>'; }
        echo '<p><a href="'.esc_url(home_url('/creator-studio/loop-letters/write/')).'">Open your writer</a> · <a href="'.esc_url(home_url('/n/vaughn-mcnair/')).'">View publication</a></p><p>Connected: timestamped market snapshots and historical closes. Google/Bing Trends, SEC/company source enrichment, earnings and options adapters are not enabled in this version. No data or rankings are fabricated.</p><table class="widefat"><tr><th>Day / slot</th><th>Status</th><th>Letter ID</th><th>Result</th></tr>';
        foreach($state['jobs'] as $j) echo '<tr><td>'.esc_html($j['local_day'].' / '.$j['slot']).'</td><td>'.esc_html($j['status']).'</td><td>'.esc_html($j['letter_id']).'</td><td>'.esc_html($j['result']??'').'</td></tr>';
        echo '</table></div>';
    }
}
register_activation_hook(__FILE__,array(Brain::class,'install'));
add_action('rest_api_init',array(Brain::class,'routes'));
add_action('admin_menu',array(Brain::class,'menu'));
add_action('admin_bar_menu',array(Brain::class,'toolbar'),90);
add_action('wp',array(Brain::class,'seo_owner'),99);
