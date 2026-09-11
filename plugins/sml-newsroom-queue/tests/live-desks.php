<?php
$types = array('news','education','earnings','sec_filing','options_flow','gamma','analyst_rating',
    'institutional_ownership','insider_activity','short_interest','macro','semiconductors_ai',
    'biotech_healthcare','energy_commodities','financials_banks','consumer_retail','small_cap_risk','verified_trader_spotlight');
$ready = array(); $missing = array();
foreach ($types as $type) {
    try { $ready[] = \StockMarketLoop\NewsroomQueue\draft_author(array('event_type'=>$type))['name']; }
    catch (Throwable $e) { $missing[] = $type; }
}
echo wp_json_encode(array('ready_count'=>count($ready),'ready_desks'=>$ready,'missing_types'=>$missing)) . "\n";
