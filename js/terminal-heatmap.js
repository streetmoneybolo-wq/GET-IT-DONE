/*!
 * SML Ticker Terminal — Sector Heat Map module (design port, 1:1).
 * Ported verbatim from the owner's "SML Sector Heat Map" design bundle:
 * same CSS, same rotation engine (market overview -> every industry's top 5
 * -> bottom 5), same tiers/sparklines/indices. Integration deltas ONLY:
 *   - mounts between the Market position/Signals row (.tv2-mpsig) and the
 *     live feed card (.tv2-lf), width:100% of that same column;
 *   - every card click navigates to /stocks/{ticker}/ (the entity page);
 *   - logos always come from the public favicon service (the bundle's few
 *     local PNGs are not hosted on the site).
 * DATA IS SAMPLE and labeled so in the UI ("· SAMPLE", "all figures
 * sample"), exactly as the design ships. Wiring real quotes is a separate
 * phase — do NOT strip the sample labels before that lands, and do not wire
 * ~290 tickers to live quote calls without a bulk endpoint + the provider
 * rate-limit question resolved (see massive-rate-limits memory).
 */
(function () {
  'use strict';
  if (window.__smlTv2HeatmapBooted) return;
  window.__smlTv2HeatmapBooted = true;

  var CSS = ".smlhm{--up:#00ff88;--down:#ff4d5e;--flat:#8fa89b;--bg:#05080a;--panel:#0a1210;--line:#1c2b23;--txt:#e6f2ea;--mut:#8fa89b;\n  width:100%;background:var(--bg);color:var(--txt);font-family:'IBM Plex Sans',sans-serif;padding:22px 18px 26px;box-sizing:border-box;}\n.smlhm *{box-sizing:border-box;margin:0;}\n.smlhm .hm-top{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:14px;}\n.smlhm h2{font-family:'IBM Plex Mono',monospace;font-size:26px;font-weight:700;letter-spacing:1px;}\n.smlhm h2 em{color:var(--up);font-style:normal;} .smlhm h2 i{color:var(--down);font-style:normal;}\n.smlhm .hm-sub{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:3px;color:var(--mut);margin-top:3px;}\n.smlhm .hm-block{border-left:1px solid var(--line);padding-left:16px;}\n.smlhm .hm-block label{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:1px;color:var(--mut);display:block;}\n.smlhm .hm-block b{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;margin-top:2px;display:block;}\n.smlhm .hm-block b.now{color:var(--up);}\n.smlhm .hm-samp{color:#ffb020;}\n.smlhm .hm-idx{margin-left:auto;display:flex;gap:14px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 14px;font-family:'IBM Plex Mono',monospace;font-size:11px;}\n.smlhm .hm-idx span{color:var(--mut);} .smlhm .hm-idx b{font-weight:600;margin-left:5px;}\n.smlhm .hm-prog{height:3px;background:#101815;border-radius:2px;overflow:hidden;margin:0 0 14px;}\n.smlhm .hm-prog i{display:block;height:100%;width:0;background:linear-gradient(90deg,#00ff8833,var(--up));}\n.smlhm .hm-break{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:11px 14px;margin-bottom:14px;font-family:'IBM Plex Mono',monospace;}\n.smlhm .hm-break label{font-size:10px;letter-spacing:2px;color:var(--mut);}\n.smlhm .hm-break b{font-size:12px;font-weight:700;letter-spacing:1px;}\n.smlhm .hm-break span{font-size:10px;color:var(--mut);margin-left:auto;}\n.smlhm .hm-grid{display:grid;grid-template-columns:repeat(30,1fr);gap:13px;transition:opacity .38s ease,transform .38s ease;}\n.smlhm .hm-grid.fade{opacity:.15;transform:translateY(8px) scale(.99);}\n.smlhm .hm-card{position:relative;grid-column:span 6;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:9px;min-width:0;\n  border:1px solid color-mix(in srgb,var(--c) 40%,transparent);\n  background:\n    url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.045'/%3E%3C/svg%3E\"),\n    repeating-linear-gradient(0deg,transparent 0 3px,#ffffff03 3px 4px),\n    radial-gradient(120% 90% at 18% 0%,color-mix(in srgb,var(--c) 10%,transparent),transparent 55%),\n    linear-gradient(165deg,#111c17,#070c0e 62%,#05090b);\n  box-shadow:0 16px 34px #000000c4,0 2px 6px #000000a0,0 0 26px color-mix(in srgb,var(--c) 13%,transparent),\n    inset 0 1px 0 #ffffff21,inset 0 -14px 30px #00000075;\n  transition:transform .4s ease,opacity .4s ease,box-shadow .3s ease,border-color .5s ease;}\n.smlhm .hm-card::before,.smlhm .hm-card::after{content:\"\";position:absolute;width:14px;height:14px;border:1px solid color-mix(in srgb,var(--c) 55%,transparent);pointer-events:none;}\n.smlhm .hm-card::before{top:6px;left:6px;border-right:none;border-bottom:none;border-radius:6px 0 0 0;}\n.smlhm .hm-card::after{bottom:6px;right:6px;border-left:none;border-top:none;border-radius:0 0 6px 0;}\n.smlhm .hm-card:hover{transform:translateY(-4px) scale(1.008);}\n.smlhm .hm-card.swap{opacity:.15;transform:translateY(10px) scale(.97);}\n.smlhm .hm-card header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}\n.smlhm .hm-logo{position:relative;width:36px;height:36px;border-radius:9px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;\n  background:color-mix(in srgb,var(--c) 12%,transparent);border:1px solid color-mix(in srgb,var(--c) 30%,transparent);\n  color:var(--c);font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:16px;}\n.smlhm .hm-logo i{position:absolute;inset:0;background-size:cover;background-position:center;}\n.smlhm .hm-sym{font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:23px;letter-spacing:1px;line-height:1;}\n.smlhm .hm-meta{min-width:0;}\n.smlhm .hm-name{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n.smlhm .hm-sector{font-size:10px;color:var(--c);margin-top:2px;transition:color .5s;}\n.smlhm .hm-badge{display:none;font-family:'IBM Plex Mono',monospace;font-size:8px;letter-spacing:1px;font-weight:700;color:#05080a;background:var(--c);\n  padding:4px 7px;border-radius:4px;box-shadow:0 0 14px color-mix(in srgb,var(--c) 55%,transparent);white-space:nowrap;}\n.smlhm .hm-badge.on{display:block;}\n.smlhm .hm-pct{margin-left:auto;font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:19px;color:var(--c);white-space:nowrap;\n  transition:text-shadow .35s,transform .35s,color .5s;}\n.smlhm .hm-pct.pulse{text-shadow:0 0 16px var(--c);transform:scale(1.06);}\n.smlhm .hm-spark{width:100%;height:34px;display:block;}\n.smlhm .hm-stats{display:flex;border-top:1px solid #ffffff12;padding-top:8px;}\n.smlhm .hm-stats>div{flex:1;min-width:0;padding-right:8px;}\n.smlhm .hm-stats>div+div{border-left:1px solid #ffffff12;padding-left:10px;}\n.smlhm .hm-stats label{font-family:'IBM Plex Mono',monospace;font-size:8px;letter-spacing:1px;color:var(--mut);display:block;}\n.smlhm .hm-stats b{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;margin-top:3px;display:block;}\n.smlhm .hm-range{position:relative;height:6px;border-radius:2px;background:#101815;margin-top:7px;}\n.smlhm .hm-range i{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--c) 35%,transparent));width:100%;}\n.smlhm .hm-range u{position:absolute;top:-2px;width:2px;height:10px;background:var(--c);border-radius:1px;left:50%;transition:left .8s ease,background .5s;box-shadow:0 0 6px var(--c);}\n.smlhm .rs-row{display:flex;align-items:center;gap:7px;}\n.smlhm .hm-rs{flex:1;height:6px;border-radius:2px;background:#101815;position:relative;max-width:100px;}\n.smlhm .hm-rs i{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:linear-gradient(90deg,color-mix(in srgb,var(--c) 20%,transparent),var(--c));transition:width .8s ease,background .5s;}\n/* tiers */\n.smlhm .hm-card.t0{padding:18px 24px;gap:12px;}\n.smlhm .hm-card.t0 .hm-logo{width:52px;height:52px;font-size:22px;}\n.smlhm .hm-card.t0 .hm-sym{font-size:42px;}\n.smlhm .hm-card.t0 .hm-pct{font-size:40px;}\n.smlhm .hm-card.t0 .hm-name{font-size:14px;} .smlhm .hm-card.t0 .hm-sector{font-size:12px;}\n.smlhm .hm-card.t0 .hm-spark{height:58px;} .smlhm .hm-card.t0 .hm-stats b{font-size:16px;}\n.smlhm .hm-card.t0 .hm-badge{font-size:9px;padding:5px 9px;}\n.smlhm .hm-card.t1 .hm-sym{font-size:29px;} .smlhm .hm-card.t1 .hm-pct{font-size:25px;}\n.smlhm .hm-card.t1 .hm-spark{height:42px;}\n.smlhm .hm-foot{margin-top:12px;font-family:'IBM Plex Mono',monospace;font-size:10px;color:#5c7a6b;}\n@media (max-width:1100px){\n  .smlhm .hm-card{grid-column:span 15 !important;}\n  .smlhm .hm-card.t0{grid-column:span 30 !important;}\n}\n@media (max-width:640px){\n  .smlhm .hm-card{grid-column:span 30 !important;}\n  .smlhm .hm-idx{display:none;}\n}\n\n.smlhm .hm-card{cursor:pointer;}\n";
  var MARKUP = "<div class=\"hm-top\">\n  <div>\n    <h2>LEADING STOCKS <em>HEAT</em> <i>MAP</i></h2>\n    <div class=\"hm-sub\">INDUSTRY LEADERS &amp; LAGGARDS · FULL MARKET ROTATION</div>\n  </div>\n  <div class=\"hm-block\"><label>MARKET SNAPSHOT</label><b>LIVE TAPE <span class=\"hm-samp\">· SAMPLE</span></b></div>\n  <div class=\"hm-block\"><label>NOW SHOWING</label><b class=\"now\" id=\"hm-view\">MARKET OVERVIEW</b></div>\n  <div class=\"hm-idx\" id=\"hm-idx\"></div>\n  <button type=\"button\" class=\"hm-min\" id=\"hm-min\" aria-expanded=\"true\" title=\"Minimize heat map\">—</button>\n</div>\n<div class=\"hm-prog\"><i id=\"hm-prog\"></i></div>\n<div class=\"hm-break\" id=\"hm-break\"></div>\n<div class=\"hm-grid\" id=\"hm-grid\"></div>\n<div class=\"hm-foot\">ⓘ Data is delayed · Market cap in USD · Relative strength vs. S&amp;P 500 · rotation: market overview → every industry's top 5 → every industry's bottom 5 · all figures sample</div>";

  function engine(){

"use strict";
var UP="#00ff88",DOWN="#ff4d5e",FLAT="#8fa89b";
var HAVE={NVDA:1,JPM:1,LLY:1,AMZN:1,GOOGL:1,GE:1,WMT:1,XOM:1,NEE:1,PLD:1,LIN:1};
/* ticker → company domain, used to fetch each logo from a public icon service */
var DOMSTR="NVDA nvidia.com AVGO broadcom.com AMD amd.com TSM tsmc.com QCOM qualcomm.com CRM salesforce.com ADBE adobe.com INTU intuit.com NOW servicenow.com SAP sap.com MSFT microsoft.com ORCL oracle.com PLTR palantir.com SNOW snowflake.com MDB mongodb.com PANW paloaltonetworks.com CRWD crowdstrike.com ZS zscaler.com FTNT fortinet.com OKTA okta.com AAPL apple.com SONY sony.com DELL dell.com HPQ hp.com GRMN garmin.com GOOGL google.com META meta.com SPOT spotify.com PINS pinterest.com RDDT reddit.com ACN accenture.com IBM ibm.com INFY infosys.com CTSH cognizant.com WIT wipro.com CSCO cisco.com ANET arista.com ERIC ericsson.com NOK nokia.com UI ui.com JPM jpmorganchase.com BAC bankofamerica.com WFC wellsfargo.com C citigroup.com HSBC hsbc.com USB usbank.com PNC pnc.com TFC truist.com FITB 53.com RF regions.com V visa.com MA mastercard.com AXP americanexpress.com COF capitalone.com DFS discover.com BRK.B berkshirehathaway.com PGR progressive.com CB chubb.com MET metlife.com AIG aig.com BLK blackrock.com BX blackstone.com KKR kkr.com APO apollo.com TROW troweprice.com GS goldmansachs.com MS morganstanley.com SCHW schwab.com IBKR interactivebrokers.com HOOD robinhood.com PYPL paypal.com XYZ block.xyz COIN coinbase.com SOFI sofi.com AFRM affirm.com LLY lilly.com NVO novonordisk.com PFE pfizer.com MRK merck.com ABBV abbvie.com AMGN amgen.com VRTX vrtx.com REGN regeneron.com GILD gilead.com MRNA modernatx.com ABT abbott.com MDT medtronic.com SYK stryker.com BSX bostonscientific.com ISRG intuitive.com UNH unitedhealthgroup.com ELV elevancehealth.com CI cigna.com CVS cvshealth.com HUM humana.com TMO thermofisher.com DHR danaher.com A agilent.com IQV iqvia.com LH labcorp.com XOM exxonmobil.com CVX chevron.com SHEL shell.com BP bp.com TTE totalenergies.com COP conocophillips.com EOG eogresources.com OXY oxy.com DVN devonenergy.com FANG diamondbackenergy.com KMI kindermorgan.com WMB williams.com ET energytransfer.com OKE oneok.com TRP tcenergy.com SLB slb.com HAL halliburton.com BKR bakerhughes.com FTI technipfmc.com WHD cactuswhd.com FSLR firstsolar.com ENPH enphase.com RUN sunrun.com BE bloomenergy.com NXT nextracker.com BTU peabodyenergy.com CEIX consolenergy.com AMR alphametresources.com HCC warriormetcoal.com ARLP arlp.com GE geaerospace.com RTX rtx.com LMT lockheedmartin.com BA boeing.com NOC northropgrumman.com DAL delta.com UAL united.com LUV southwest.com AAL aa.com ALK alaskaair.com UNP up.com CSX csx.com NSC norfolksouthern.com CP cpkcr.com CNI cn.ca UPS ups.com FDX fedex.com ODFL odfl.com XPO xpo.com JBHT jbhunt.com CAT caterpillar.com DE deere.com CNH cnh.com AGCO agcocorp.com PCAR paccar.com HON honeywell.com MMM 3m.com ITW itw.com PH parker.com DOV dovercorporation.com ETN eaton.com EMR emerson.com ROK rockwellautomation.com HUBB hubbell.com GNRC generac.com TSLA tesla.com TM toyota.com F ford.com GM gm.com RIVN rivian.com APTV aptiv.com MGA magna.com BWA borgwarner.com LEA lear.com GNTX gentex.com AMZN amazon.com BABA alibaba.com MELI mercadolibre.com PDD pddholdings.com SHOP shopify.com WMT walmart.com COST costco.com TGT target.com DG dollargeneral.com DLTR dollartree.com MCD mcdonalds.com SBUX starbucks.com CMG chipotle.com YUM yum.com DRI darden.com NKE nike.com LULU lululemon.com RL ralphlauren.com DECK deckers.com TPR tapestry.com BKNG bookingholdings.com MAR marriott.com HLT hilton.com RCL royalcaribbean.com ABNB airbnb.com HD homedepot.com LOW lowes.com TSCO tractorsupply.com BLDR bldr.com WSM williams-sonoma.com KO coca-cola.com PEP pepsico.com MNST monsterbevcorp.com KDP keurigdrpepper.com STZ cbrands.com MDLZ mondelezinternational.com GIS generalmills.com HSY thehersheycompany.com KHC kraftheinzcompany.com CAG conagrabrands.com PG pg.com CL colgatepalmolive.com KMB kimberly-clark.com CHD churchdwight.com CLX thecloroxcompany.com PM pmi.com MO altria.com BTI bat.com UVV universalcorp.com TPB turningpointbrands.com KR kroger.com ACI albertsons.com SYY sysco.com USFD usfoods.com SFM sprouts.com TMUS t-mobile.com VZ verizon.com T att.com CHTR charter.com CMCSA comcast.com NFLX netflix.com DIS disney.com WBD wbd.com LYV livenation.com PARA paramount.com EA ea.com TTWO take2games.com RBLX roblox.com U unity.com NTES netease.com TTD thetradedesk.com APP applovin.com OMC omnicomgroup.com IPG interpublic.com DV doubleverify.com NEE nexteraenergy.com SO southerncompany.com DUK duke-energy.com D dominionenergy.com AEP aep.com AWK amwater.com WTRG essential.co ATO atmosenergy.com NI nisource.com SRE sempra.com PLD prologis.com AMT americantower.com EQIX equinix.com DLR digitalrealty.com PSA publicstorage.com SPG simon.com O realtyincome.com AVB avalonbay.com EQR equityapartments.com VICI viciproperties.com LIN linde.com SHW sherwin-williams.com APD airproducts.com ECL ecolab.com DD dupont.com BHP bhp.com RIO riotinto.com FCX fcx.com NUE nucor.com VALE vale.com NEM newmont.com GOLD barrick.com AEM agnicoeagle.com KGC kinross.com WPM wheatonpm.com IP internationalpaper.com PKG packagingcorp.com SW smurfitwestrock.com BALL ball.com AMCR amcor.com";
var DOM={};(function(){var t=DOMSTR.split(" ");for(var i=0;i<t.length;i+=2)DOM[t[i]]=t[i+1];})();
function logoUrl(sym){
  if(DOM[sym])return 'url("https://www.google.com/s2/favicons?domain='+DOM[sym]+'&sz=128")';
  return "none";
}
/* 58 industry sectors (standard industry taxonomy, as used by moomoo-style heat maps), 5 stocks each.
   Format: [industry, "SYM|Name|Cap,..."] — %change/volume/RS are seeded sample values generated below. */
var IND=[
["Semiconductors","NVDA|NVIDIA|$2.41T,AVGO|Broadcom|$1.30T,AMD|AMD|$230B,TSM|TSMC|$1.05T,QCOM|Qualcomm|$185B"],
["Software - Application","CRM|Salesforce|$260B,ADBE|Adobe|$220B,INTU|Intuit|$180B,NOW|ServiceNow|$190B,SAP|SAP SE|$240B"],
["Software - Infrastructure","MSFT|Microsoft|$3.32T,ORCL|Oracle|$390B,PLTR|Palantir|$220B,SNOW|Snowflake|$55B,MDB|MongoDB|$28B"],
["Cybersecurity","PANW|Palo Alto Networks|$120B,CRWD|CrowdStrike|$95B,ZS|Zscaler|$32B,FTNT|Fortinet|$60B,OKTA|Okta|$16B"],
["Consumer Electronics","AAPL|Apple|$3.45T,SONY|Sony|$115B,DELL|Dell|$80B,HPQ|HP Inc|$32B,GRMN|Garmin|$38B"],
["Internet Content","GOOGL|Alphabet|$2.20T,META|Meta Platforms|$1.35T,SPOT|Spotify|$110B,PINS|Pinterest|$22B,RDDT|Reddit|$28B"],
["IT Services","ACN|Accenture|$210B,IBM|IBM|$230B,INFY|Infosys|$75B,CTSH|Cognizant|$38B,WIT|Wipro|$28B"],
["Communication Equipment","CSCO|Cisco|$240B,ANET|Arista Networks|$130B,ERIC|Ericsson|$26B,NOK|Nokia|$25B,UI|Ubiquiti|$22B"],
["Banks - Diversified","JPM|JPMorgan Chase|$610B,BAC|Bank of America|$310B,WFC|Wells Fargo|$210B,C|Citigroup|$130B,HSBC|HSBC|$170B"],
["Banks - Regional","USB|US Bancorp|$68B,PNC|PNC Financial|$72B,TFC|Truist|$56B,FITB|Fifth Third|$28B,RF|Regions Financial|$21B"],
["Credit Services","V|Visa|$560B,MA|Mastercard|$440B,AXP|American Express|$190B,COF|Capital One|$55B,DFS|Discover|$40B"],
["Insurance","BRK.B|Berkshire Hathaway|$930B,PGR|Progressive|$150B,CB|Chubb|$115B,MET|MetLife|$52B,AIG|AIG|$48B"],
["Asset Management","BLK|BlackRock|$130B,BX|Blackstone|$160B,KKR|KKR|$120B,APO|Apollo Global|$85B,TROW|T Rowe Price|$25B"],
["Capital Markets","GS|Goldman Sachs|$160B,MS|Morgan Stanley|$155B,SCHW|Charles Schwab|$130B,IBKR|Interactive Brokers|$45B,HOOD|Robinhood|$38B"],
["Fintech","PYPL|PayPal|$70B,XYZ|Block|$45B,COIN|Coinbase|$65B,SOFI|SoFi|$16B,AFRM|Affirm|$18B"],
["Drug Manufacturers","LLY|Eli Lilly|$730B,NVO|Novo Nordisk|$380B,PFE|Pfizer|$150B,MRK|Merck|$260B,ABBV|AbbVie|$330B"],
["Biotechnology","AMGN|Amgen|$150B,VRTX|Vertex|$120B,REGN|Regeneron|$85B,GILD|Gilead|$110B,MRNA|Moderna|$14B"],
["Medical Devices","ABT|Abbott Labs|$195B,MDT|Medtronic|$115B,SYK|Stryker|$135B,BSX|Boston Scientific|$130B,ISRG|Intuitive Surgical|$180B"],
["Healthcare Plans","UNH|UnitedHealth|$480B,ELV|Elevance|$95B,CI|Cigna|$92B,CVS|CVS Health|$85B,HUM|Humana|$32B"],
["Diagnostics & Research","TMO|Thermo Fisher|$210B,DHR|Danaher|$165B,A|Agilent|$38B,IQV|IQVIA|$36B,LH|Labcorp|$21B"],
["Oil & Gas Integrated","XOM|Exxon Mobil|$480B,CVX|Chevron|$280B,SHEL|Shell|$210B,BP|BP|$95B,TTE|TotalEnergies|$150B"],
["Oil & Gas E&P","COP|ConocoPhillips|$130B,EOG|EOG Resources|$70B,OXY|Occidental|$45B,DVN|Devon Energy|$25B,FANG|Diamondback|$45B"],
["Oil & Gas Midstream","KMI|Kinder Morgan|$60B,WMB|Williams|$70B,ET|Energy Transfer|$60B,OKE|ONEOK|$55B,TRP|TC Energy|$50B"],
["Oilfield Services","SLB|SLB|$55B,HAL|Halliburton|$25B,BKR|Baker Hughes|$45B,FTI|TechnipFMC|$14B,WHD|Cactus|$4B"],
["Renewable Energy","FSLR|First Solar|$22B,ENPH|Enphase|$5B,RUN|Sunrun|$3B,BE|Bloom Energy|$8B,NXT|Nextracker|$8B"],
["Coal","BTU|Peabody Energy|$3B,CEIX|CONSOL Energy|$3B,AMR|Alpha Metallurgical|$2B,HCC|Warrior Met|$3B,ARLP|Alliance Resource|$3B"],
["Aerospace & Defense","GE|GE Aerospace|$290B,RTX|RTX Corp|$180B,LMT|Lockheed Martin|$110B,BA|Boeing|$130B,NOC|Northrop Grumman|$75B"],
["Airlines","DAL|Delta Air Lines|$40B,UAL|United Airlines|$32B,LUV|Southwest|$18B,AAL|American Airlines|$8B,ALK|Alaska Air|$7B"],
["Railroads","UNP|Union Pacific|$140B,CSX|CSX|$65B,NSC|Norfolk Southern|$55B,CP|Canadian Pacific|$75B,CNI|Canadian National|$65B"],
["Freight & Logistics","UPS|UPS|$95B,FDX|FedEx|$65B,ODFL|Old Dominion|$38B,XPO|XPO|$14B,JBHT|JB Hunt|$14B"],
["Farm & Heavy Machinery","CAT|Caterpillar|$180B,DE|John Deere|$130B,CNH|CNH Industrial|$15B,AGCO|AGCO|$8B,PCAR|Paccar|$55B"],
["Industrial Conglomerates","HON|Honeywell|$140B,MMM|3M|$80B,ITW|Illinois Tool Works|$72B,PH|Parker Hannifin|$85B,DOV|Dover|$25B"],
["Electrical Equipment","ETN|Eaton|$130B,EMR|Emerson|$70B,ROK|Rockwell|$32B,HUBB|Hubbell|$23B,GNRC|Generac|$9B"],
["Auto Manufacturers","TSLA|Tesla|$760B,TM|Toyota|$250B,F|Ford|$45B,GM|General Motors|$55B,RIVN|Rivian|$12B"],
["Auto Components","APTV|Aptiv|$16B,MGA|Magna|$12B,BWA|BorgWarner|$8B,LEA|Lear|$5B,GNTX|Gentex|$7B"],
["Internet Retail","AMZN|Amazon|$1.98T,BABA|Alibaba|$220B,MELI|MercadoLibre|$95B,PDD|PDD Holdings|$140B,SHOP|Shopify|$140B"],
["Discount Stores","WMT|Walmart|$780B,COST|Costco|$390B,TGT|Target|$48B,DG|Dollar General|$22B,DLTR|Dollar Tree|$16B"],
["Restaurants","MCD|McDonald's|$210B,SBUX|Starbucks|$105B,CMG|Chipotle|$60B,YUM|Yum Brands|$40B,DRI|Darden|$25B"],
["Apparel & Luxury","NKE|Nike|$110B,LULU|Lululemon|$25B,RL|Ralph Lauren|$16B,DECK|Deckers|$16B,TPR|Tapestry|$18B"],
["Travel & Lodging","BKNG|Booking Holdings|$160B,MAR|Marriott|$70B,HLT|Hilton|$60B,RCL|Royal Caribbean|$75B,ABNB|Airbnb|$75B"],
["Home Improvement","HD|Home Depot|$350B,LOW|Lowe's|$130B,TSCO|Tractor Supply|$28B,BLDR|Builders FirstSource|$14B,WSM|Williams-Sonoma|$21B"],
["Beverages","KO|Coca-Cola|$300B,PEP|PepsiCo|$195B,MNST|Monster|$55B,KDP|Keurig Dr Pepper|$45B,STZ|Constellation|$30B"],
["Food Products","MDLZ|Mondelez|$85B,GIS|General Mills|$28B,HSY|Hershey|$36B,KHC|Kraft Heinz|$32B,CAG|Conagra|$9B"],
["Household Products","PG|Procter & Gamble|$395B,CL|Colgate-Palmolive|$72B,KMB|Kimberly-Clark|$42B,CHD|Church & Dwight|$24B,CLX|Clorox|$16B"],
["Tobacco","PM|Philip Morris|$260B,MO|Altria|$100B,BTI|British American|$95B,UVV|Universal|$1B,TPB|Turning Point|$1B"],
["Food Distribution","KR|Kroger|$45B,ACI|Albertsons|$11B,SYY|Sysco|$38B,USFD|US Foods|$18B,SFM|Sprouts|$14B"],
["Telecom Services","TMUS|T-Mobile|$260B,VZ|Verizon|$180B,T|AT&T|$200B,CHTR|Charter|$55B,CMCSA|Comcast|$130B"],
["Entertainment","NFLX|Netflix|$290B,DIS|Disney|$170B,WBD|Warner Bros Discovery|$30B,LYV|Live Nation|$32B,PARA|Paramount|$9B"],
["Gaming","EA|Electronic Arts|$40B,TTWO|Take-Two|$40B,RBLX|Roblox|$85B,U|Unity|$12B,NTES|NetEase|$65B"],
["Advertising","TTD|Trade Desk|$28B,APP|AppLovin|$140B,OMC|Omnicom|$14B,IPG|Interpublic|$9B,DV|DoubleVerify|$2B"],
["Utilities - Electric","NEE|NextEra Energy|$151B,SO|Southern Company|$96B,DUK|Duke Energy|$89B,D|Dominion|$50B,AEP|American Electric|$55B"],
["Utilities - Gas & Water","AWK|American Water|$28B,WTRG|Essential Utilities|$11B,ATO|Atmos Energy|$24B,NI|NiSource|$19B,SRE|Sempra|$50B"],
["REIT - Industrial & Data","PLD|Prologis|$104B,AMT|American Tower|$93B,EQIX|Equinix|$75B,DLR|Digital Realty|$55B,PSA|Public Storage|$50B"],
["REIT - Retail & Residential","SPG|Simon Property|$59B,O|Realty Income|$52B,AVB|AvalonBay|$28B,EQR|Equity Residential|$25B,VICI|VICI Properties|$34B"],
["Chemicals","LIN|Linde|$155B,SHW|Sherwin-Williams|$89B,APD|Air Products|$62B,ECL|Ecolab|$75B,DD|DuPont|$32B"],
["Metals & Mining","BHP|BHP Group|$130B,RIO|Rio Tinto|$110B,FCX|Freeport-McMoRan|$62B,NUE|Nucor|$32B,VALE|Vale|$45B"],
["Gold","NEM|Newmont|$65B,GOLD|Barrick|$38B,AEM|Agnico Eagle|$60B,KGC|Kinross|$18B,WPM|Wheaton|$40B"],
["Paper & Packaging","IP|International Paper|$18B,PKG|Packaging Corp|$17B,SW|Smurfit Westrock|$22B,BALL|Ball Corp|$16B,AMCR|Amcor|$14B"]
];
function hash(s){var h=0,i;for(i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%99991;return h;}
var DATA=IND.map(function(row){
  return{sector:row[0],stocks:row[1].split(",").map(function(t){
    var p=t.split("|"),sym=p[0];
    var pct=Math.round(((hash(sym+"p")%1000)/1000-0.5)*7*100)/100;
    var vol=Math.round((1+(hash(sym+"v")%590)/10)*10)/10;
    var rs=Math.max(0.6,Math.min(1.5,Math.round((1+pct*0.09+((hash(sym+"r")%100)/100-0.5)*0.2)*100)/100));
    return[sym,p[1],pct,p[2],vol,rs];
  })};
});
var N=DATA.length;
var IDX=[["S&P 500",6412.2,0.42],["NASDAQ",21830.5,0.66],["DOW",44916.8,0.18]];
var OV_SPANS=[30,10,10,10,6,6,6,6,6,15,15],OV_TIERS=[0,1,1,1,2,2,2,2,2,1,1];
var live={},leaders=DATA.map(function(){return 0;}),sv=-1,cards=[],idxRefs=[];
function colorOf(p){return p===0?FLAT:(p>0?UP:DOWN);}
function initVals(sym,pct){
  var seed=0,i;for(i=0;i<sym.length;i++)seed=(seed*31+sym.charCodeAt(i))%9973;
  function rnd(){seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;}
  var n=140,drift=pct/n*6,v=20-pct*3,vals=[];
  for(i=0;i<n;i++){var burst=rnd()<0.06?(rnd()-0.5)*4:0;v+=drift+(rnd()-0.5)*1.7+burst;vals.push(v);}
  return vals;
}
DATA.forEach(function(sec){sec.stocks.forEach(function(s){
  var vals=initVals(s[0],s[2]);
  live[s[0]]={pct:s[2],vol:s[4],rsd:0,vals:vals,hi:Math.max.apply(null,vals),lo:Math.min.apply(null,vals)};
});});
function avgOf(sec){return sec.stocks.reduce(function(a,s){return a+live[s[0]].pct;},0)/sec.stocks.length;}
function pts(vals){
  var n=vals.length,min=Math.min.apply(null,vals),max=Math.max.apply(null,vals),range=Math.max(max-min,1),arr=[];
  for(var i=0;i<n;i++)arr.push((i/(n-1)*200).toFixed(1)+","+(38-(vals[i]-min)/range*32).toFixed(1));
  return{line:arr.join(" "),area:arr.join(" ")+" 200,44 0,44",last:arr[n-1].split(",")};
}
function el(tag,cls,parent){var e=document.createElement(tag);if(cls)e.className=cls;if(parent)parent.appendChild(e);return e;}
function svgEl(tag,parent){var e=document.createElementNS("http://www.w3.org/2000/svg",tag);parent.appendChild(e);return e;}
function buildCard(en,grid){
  var root=el("article","hm-card t"+en.tier,grid);
  root.style.gridColumn="span "+en.span;
  var head=el("header",null,root);
  var logo=el("div","hm-logo",head);var mono=el("span",null,logo);var img=el("i",null,logo);
  var sym=el("div","hm-sym",head);
  var meta=el("div","hm-meta",head);var name=el("div","hm-name",meta);var sector=el("div","hm-sector",meta);
  var badge=el("span","hm-badge",head);
  var pct=el("div","hm-pct",head);
  var svg=svgEl("svg",root);svg.setAttribute("class","hm-spark");svg.setAttribute("viewBox","0 0 200 44");svg.setAttribute("preserveAspectRatio","none");
  [11,22,33].forEach(function(y){var l=svgEl("line",svg);l.setAttribute("x1",0);l.setAttribute("x2",200);l.setAttribute("y1",y);l.setAttribute("y2",y);l.setAttribute("stroke","#ffffff0d");l.setAttribute("stroke-width","0.4");});
  var area=svgEl("polygon",svg);area.setAttribute("opacity","0.12");
  var glow=svgEl("polyline",svg);glow.setAttribute("fill","none");glow.setAttribute("stroke-width","3");glow.setAttribute("opacity","0.16");glow.setAttribute("stroke-linejoin","round");
  var line=svgEl("polyline",svg);line.setAttribute("fill","none");line.setAttribute("stroke-width","0.9");line.setAttribute("opacity","0.95");line.setAttribute("stroke-linejoin","round");
  var dot=svgEl("circle",svg);dot.setAttribute("r","1.8");
  var stats=el("div","hm-stats",root);
  var d1=el("div",null,stats);el("label",null,d1).textContent="MARKET CAP";var cap=el("b",null,d1);
  var d2=el("div",null,stats);el("label",null,d2).textContent="VOLUME";var vol=el("b",null,d2);
  var d3=el("div",null,stats);el("label",null,d3).textContent="DAY RANGE";var range=el("div","hm-range",d3);el("i",null,range);var rdot=el("u",null,range);
  var d4=el("div",null,stats);el("label",null,d4).textContent="REL STRENGTH";var rrow=el("div","rs-row",d4);var rsb=el("b",null,rrow);var rsbar=el("div","hm-rs",rrow);var rsfill=el("i",null,rsbar);
  return{en:en,sym:null,root:root,els:{mono:mono,img:img,sym:sym,name:name,sector:sector,badge:badge,pct:pct,area:area,glow:glow,line:line,dot:dot,cap:cap,vol:vol,rdot:rdot,rsb:rsb,rsfill:rsfill}};
}
function badgeText(en){
  if(en.badge==="leader")return en.mode==="bottom"?"▼ BIGGEST LAGGARD":"★ TOP PERFORMER";
  return "▲ NEW LEADER";
}
function paint(card,stock){
  var s=stock,L=live[s[0]],c=colorOf(L.pct),e=card.els;
  card.sym=s[0];card.root.setAttribute("data-sym",s[0]);
  card.root.style.setProperty("--c",c);
  e.mono.textContent=s[0][0];
  e.img.style.backgroundImage=logoUrl(s[0]);
  e.sym.textContent=s[0];
  e.name.textContent=s[1];
  e.sector.textContent=card.en.sec.sector;
  e.badge.textContent=badgeText(card.en);
  e.badge.classList.toggle("on",card.en.badge==="leader");
  e.pct.textContent=(L.pct>0?"+":"")+L.pct.toFixed(2)+"% "+(L.pct>=0?"▲":"▼");
  var p=pts(L.vals);
  e.area.setAttribute("points",p.area);e.area.setAttribute("fill",c);
  e.glow.setAttribute("points",p.line);e.glow.setAttribute("stroke",c);
  e.line.setAttribute("points",p.line);e.line.setAttribute("stroke",c);
  e.dot.setAttribute("cx",p.last[0]);e.dot.setAttribute("cy",p.last[1]);e.dot.setAttribute("fill",c);
  e.cap.textContent=s[3];
  e.vol.textContent=L.vol.toFixed(1)+"M";
  var cur=L.vals[L.vals.length-1];
  e.rdot.style.left=Math.max(2,Math.min(98,(cur-L.lo)/Math.max(L.hi-L.lo,0.1)*100))+"%";
  var rs=Math.round((s[5]+L.rsd)*100)/100;
  e.rsb.textContent=rs.toFixed(2);
  e.rsfill.style.width=Math.min(rs/1.5*100,100)+"%";
}
function slotStock(en){
  if(en.badge==="new")return en.sec.stocks[leaders[en.i]];
  var asc=en.mode==="bottom";
  var order=en.sec.stocks.map(function(s,j){return j;}).sort(function(a,b){
    var pa=live[en.sec.stocks[a][0]].pct,pb=live[en.sec.stocks[b][0]].pct;
    return asc?pa-pb:pb-pa;
  });
  return en.sec.stocks[order[en.rank]];
}
function entriesFor(v){
  if(v<0){ // overview: 11 hottest industries right now
    var top=DATA.map(function(sec,i){return{sec:sec,i:i,a:avgOf(sec)};}).sort(function(a,b){return b.a-a.a;}).slice(0,11);
    return top.map(function(t,k){return{sec:t.sec,i:t.i,span:OV_SPANS[k],tier:OV_TIERS[k],badge:"new",rank:0,mode:"top"};});
  }
  var mode=v<N?"top":"bottom";
  var sec=DATA[v%N],si=v%N;
  return sec.stocks.map(function(_,k){return{sec:sec,i:si,span:k===0?30:15,tier:k===0?0:1,badge:k===0?"leader":null,rank:k,mode:mode};});
}
var grid=document.getElementById("hm-grid");
function buildGrid(){
  grid.innerHTML="";cards=[];
  entriesFor(sv).forEach(function(en){var c=buildCard(en,grid);cards.push(c);paint(c,slotStock(en));});
}
function buildBreak(){
  var box=document.getElementById("hm-break");
  box.innerHTML="";
  var lab=el("label",null,box);
  var b=el("b",null,box);
  var note=el("span",null,box);
  if(sv<0){
    lab.textContent="MARKET OVERVIEW ·";
    b.textContent="TOP 11 INDUSTRIES BY AVERAGE MOVE";b.style.color=UP;
    note.textContent="next: top 5 by industry · "+N+" industries tracked";
  }else if(sv<N){
    lab.textContent="TOP 5 ·";
    b.textContent="▲ "+DATA[sv%N].sector.toUpperCase();b.style.color=UP;
    note.textContent="industry "+(sv%N+1)+"/"+N+" · leaders phase";
  }else{
    lab.textContent="BOTTOM 5 ·";
    b.textContent="▼ "+DATA[sv%N].sector.toUpperCase();b.style.color=DOWN;
    note.textContent="industry "+(sv%N+1)+"/"+N+" · laggards phase";
  }
}
function buildIdx(){
  var box=document.getElementById("hm-idx");
  IDX.forEach(function(d){
    var w=el("div",null,box);var s=el("span",null,w);s.textContent=d[0];var b=el("b",null,w);
    idxRefs.push({d:d,b:b});
  });
  paintIdx();
}
function paintIdx(){
  idxRefs.forEach(function(r){
    r.b.textContent=r.d[1].toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1})+" "+(r.d[2]>0?"+":"")+r.d[2].toFixed(2)+"%";
    r.b.style.color=colorOf(r.d[2]);
  });
}
function tick(){
  Object.keys(live).forEach(function(sym){
    var L=live[sym];
    var d=(Math.random()-0.5)*0.3-L.pct*0.03;
    L.pct=Math.round((L.pct+d)*100)/100;
    L.vol+=Math.random()*0.2;
    var nv=L.vals[L.vals.length-1]+d*8+(Math.random()-0.5)*1.4;
    L.vals=L.vals.slice(1);L.vals.push(nv);
    L.hi=Math.max(L.hi,nv);L.lo=Math.min(L.lo,nv);
    L.rsd=Math.max(-0.12,Math.min(0.12,L.rsd+(Math.random()-0.5)*0.02));
  });
  DATA.forEach(function(sec,i){ // leadership hysteresis for overview slots
    var cur=leaders[i],best=cur;
    sec.stocks.forEach(function(s,j){if(live[s[0]].pct>live[sec.stocks[best][0]].pct+0.15)best=j;});
    leaders[i]=best;
  });
  cards.forEach(function(card){
    var target=slotStock(card.en);
    if(target[0]!==card.sym){
      card.root.classList.add("swap");
      (function(cd,tg){setTimeout(function(){
        paint(cd,tg);cd.root.classList.remove("swap");
        if(cd.en.badge==="new"){cd.els.badge.classList.add("on");setTimeout(function(){cd.els.badge.classList.remove("on");},2600);}
      },420);})(card,target);
    }else{
      paint(card,target);
      card.els.pct.classList.add("pulse");
      (function(cd){setTimeout(function(){cd.els.pct.classList.remove("pulse");},550);})(card);
    }
  });
  IDX.forEach(function(d){d[2]=Math.round((d[2]+(Math.random()-0.5)*0.06)*100)/100;d[1]+=d[1]*(Math.random()-0.5)*0.0004;});
  paintIdx();
}
var progEl=document.getElementById("hm-prog"),viewEl=document.getElementById("hm-view");
function restartProg(){
  progEl.style.transition="none";progEl.style.width="0%";
  void progEl.offsetWidth;
  progEl.style.transition="width 9s linear";progEl.style.width="100%";
}
function nextView(){
  grid.classList.add("fade");
  setTimeout(function(){
    sv=sv>=2*N-1?-1:sv+1;
    if(sv<0)viewEl.textContent="MARKET OVERVIEW · TOP INDUSTRIES";
    else if(sv<N)viewEl.textContent="TOP 5 · "+DATA[sv%N].sector.toUpperCase()+" · "+(sv%N+1)+"/"+N;
    else viewEl.textContent="BOTTOM 5 · "+DATA[sv%N].sector.toUpperCase()+" · "+(sv%N+1)+"/"+N;
    buildGrid();buildBreak();
    grid.classList.remove("fade");
    restartProg();
  },400);
}
buildIdx();buildGrid();buildBreak();restartProg();
/* while minimized the engine idles — no ticks, no rotation, no repaint work */
function hmOff(){var s=document.getElementById("smlhm");return !!(s&&s.classList.contains("hm-collapsed"));}
setInterval(function(){if(!hmOff())tick();},2200);
setInterval(function(){if(!hmOff())nextView();},9000);
document.getElementById("smlhm").addEventListener("smlhm:expand",restartProg);

  var grid2=document.getElementById("hm-grid");
  grid2.addEventListener("click",function(e){
    var card=e.target&&e.target.closest?e.target.closest(".hm-card"):null;
    if(!card)return;
    var sym=card.getAttribute("data-sym");
    if(sym)location.href="/stocks/"+sym.toLowerCase()+"/";
  });
  }

  function mount(){
    if (document.getElementById('smlhm')) return true;
    var lf = document.querySelector('.tv2-lf');
    var mpsig = document.querySelector('.tv2-mpsig');
    if (!lf && !mpsig) return false;
    var style = document.createElement('style');
    style.id = 'smlhm-css'; style.textContent = CSS + [
      /* minimizer: collapses to a slim title bar; the live feed below shifts up
         in normal flow. Choice persists per visitor (localStorage). */
      ".smlhm .hm-min{margin-left:12px;flex-shrink:0;width:26px;height:26px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--mut);font-family:'IBM Plex Mono',monospace;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}",
      ".smlhm .hm-min:hover{color:var(--up);border-color:var(--up);}",
      ".smlhm.hm-collapsed{padding:12px 18px;}",
      ".smlhm.hm-collapsed .hm-prog,.smlhm.hm-collapsed .hm-break,.smlhm.hm-collapsed .hm-grid,.smlhm.hm-collapsed .hm-foot,.smlhm.hm-collapsed .hm-idx,.smlhm.hm-collapsed .hm-block,.smlhm.hm-collapsed .hm-sub{display:none;}",
      ".smlhm.hm-collapsed .hm-top{margin-bottom:0;}",
      ".smlhm.hm-collapsed h2{font-size:16px;}",
      ".smlhm.hm-collapsed .hm-min{margin-left:auto;}"
    ].join('\n');
    document.head.appendChild(style);
    if (!document.querySelector('link[href*="IBM+Plex"]')) {
      var f = document.createElement('link'); f.rel = 'stylesheet';
      f.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';
      document.head.appendChild(f);
    }
    var sec = document.createElement('section');
    sec.className = 'smlhm'; sec.id = 'smlhm'; sec.setAttribute('data-tv2-keep', '1');
    sec.innerHTML = MARKUP;
    if (lf && lf.parentNode) lf.parentNode.insertBefore(sec, lf);
    else mpsig.parentNode.insertBefore(sec, mpsig.nextSibling);
    try { engine(); } catch (e) { sec.remove(); return true; }
    var btn = sec.querySelector('#hm-min');
    function setCollapsed(on, persist) {
      sec.classList.toggle('hm-collapsed', on);
      btn.textContent = on ? '+' : '—';
      btn.title = on ? 'Expand heat map' : 'Minimize heat map';
      btn.setAttribute('aria-expanded', on ? 'false' : 'true');
      if (persist) { try { localStorage.setItem('smlhm-collapsed', on ? '1' : '0'); } catch (e) {} }
      if (!on) { try { sec.dispatchEvent(new Event('smlhm:expand')); } catch (e) {} }
    }
    btn.addEventListener('click', function (e) { e.stopPropagation(); setCollapsed(!sec.classList.contains('hm-collapsed'), true); });
    try { if (localStorage.getItem('smlhm-collapsed') === '1') setCollapsed(true, false); } catch (e) {}
    return true;
  }

  // the mp2/feed cards render at their own pace — retry briefly, like the shell does
  if (!mount()) {
    var tries = 0;
    var t = setInterval(function () { if (mount() || ++tries > 40) clearInterval(t); }, 400);
  }
})();
