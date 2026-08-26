/*!
 * SML Charts: Moomoo interval stats (Shift+drag) — CDN copy of snippet #5865's
 * inline script, byte-identical except the host poll runs 200 tries (the
 * analyst dashboard mounts its chart late). Reads the legacy LoopCharts
 * engine via .sml-lc-canvas-host + window.__smlSel(); does nothing on pages
 * without them. Loaded by the updated #5865 snippet.
 */
(function(){
  if (window.__smlIVInit) return; window.__smlIVInit = true;

  var CSS =
  '#sml-iv-layer{position:absolute;inset:0;pointer-events:none;z-index:40;overflow:hidden;}'+
  '#sml-iv-band{position:absolute;top:0;bottom:0;background:rgba(56,132,255,0.14);border-left:1px solid rgba(130,180,255,0.95);border-right:1px solid rgba(130,180,255,0.95);display:none;}'+
  '.sml-iv-tag{position:absolute;top:4px;transform:translateX(-50%);background:#1b2333;color:#cfe0ff;font:11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;padding:1px 6px;border-radius:4px;white-space:nowrap;border:1px solid #2c3a58;display:none;}'+
  '#sml-iv-panel{position:fixed;z-index:2147483000;min-width:236px;max-width:290px;background:#0f1622;color:#e7eefc;border:1px solid #26344d;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.55);font:12.5px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden;display:none;}'+
  '#sml-iv-panel .h{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;font-weight:700;font-size:13px;}'+
  '#sml-iv-panel .h.up{background:linear-gradient(90deg,#0d3a24,#0f1622);color:#43e08a;}'+
  '#sml-iv-panel .h.dn{background:linear-gradient(90deg,#3a0d14,#0f1622);color:#ff6b7d;}'+
  '#sml-iv-panel .x{cursor:pointer;opacity:.65;font-size:16px;line-height:1;padding:0 2px;}'+
  '#sml-iv-panel .x:hover{opacity:1;}'+
  '#sml-iv-panel .rows{padding:6px 12px 4px;}'+
  '#sml-iv-panel .r{display:flex;justify-content:space-between;gap:14px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05);}'+
  '#sml-iv-panel .r:last-child{border-bottom:0;}'+
  '#sml-iv-panel .r .k{color:#8fa3c4;}'+
  '#sml-iv-panel .r .v{font-weight:600;font-variant-numeric:tabular-nums;}'+
  '#sml-iv-panel .v.up{color:#43e08a;}#sml-iv-panel .v.dn{color:#ff6b7d;}'+
  '#sml-iv-panel .rng{padding:8px 12px;border-top:1px solid #1c2740;color:#7f93b5;font-size:11px;}'+
  '.sml-iv-hint{position:absolute;left:12px;top:10px;z-index:41;background:rgba(15,22,34,.9);color:#9fb2d2;font:11px -apple-system,Segoe UI,Roboto,sans-serif;padding:3px 9px;border-radius:6px;pointer-events:none;opacity:0;transition:opacity .35s;border:1px solid #24314c;}';

  function injectCSS(){ if(document.getElementById('sml-iv-css'))return; var st=document.createElement('style'); st.id='sml-iv-css'; st.textContent=CSS; document.head.appendChild(st); }

  function fmtNum(n){ if(n==null||isNaN(n))return '&mdash;'; var a=Math.abs(n);
    if(a>=1e9)return (n/1e9).toFixed(2)+'B'; if(a>=1e6)return (n/1e6).toFixed(2)+'M'; if(a>=1e3)return (n/1e3).toFixed(2)+'K'; return String(Math.round(n*100)/100); }
  function fmtPx(n){ return (n==null||isNaN(n))?'&mdash;':Number(n).toFixed(2); }
  function fmtDate(t){ try{var d=new Date(t);return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});}catch(e){return '';} }
  function shortDate(t){ try{var d=new Date(t);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});}catch(e){return '';} }

  var layer=null, band=null, tagA=null, tagB=null, panel=null, hint=null;
  var dragging=false, sel=null;

  function currentHost(){ return document.querySelector('.sml-lc-canvas-host'); }

  function ensureLayer(hostEl){
    var cs=getComputedStyle(hostEl); if(cs.position==='static')hostEl.style.position='relative';
    if(!layer || layer.parentNode!==hostEl){
      if(layer&&layer.parentNode)layer.parentNode.removeChild(layer);
      layer=document.createElement('div'); layer.id='sml-iv-layer';
      band=document.createElement('div'); band.id='sml-iv-band';
      tagA=document.createElement('div'); tagA.className='sml-iv-tag';
      tagB=document.createElement('div'); tagB.className='sml-iv-tag';
      layer.appendChild(band); layer.appendChild(tagA); layer.appendChild(tagB);
      hostEl.appendChild(layer);
      if(!hint){ hint=document.createElement('div'); hint.className='sml-iv-hint'; hint.textContent='Shift + drag to measure a range'; }
      if(hint.parentNode!==hostEl)hostEl.appendChild(hint);
    }
    if(!panel){ panel=document.createElement('div'); panel.id='sml-iv-panel'; document.body.appendChild(panel); }
  }

  function geom(hostEl){
    var s=window.__smlSel&&window.__smlSel(); if(!s||!Array.isArray(s.bars)||s.to<=s.from)return null;
    var rect=hostEl.getBoundingClientRect();
    var PADL=12, PADR=72;
    var plotL=PADL, plotR=rect.width-PADR; if(plotR<=plotL)return null;
    var n=Math.max(1,s.to-s.from); var barW=(plotR-plotL)/n;
    return {s:s,rect:rect,plotL:plotL,plotR:plotR,barW:barW,n:n};
  }
  function xToIndex(g,hostRelX){ var i=g.s.from+Math.floor((hostRelX-g.plotL)/g.barW); return Math.max(g.s.from,Math.min(g.s.to-1,i)); }
  function centerX(g,i){ return g.plotL+(i-g.s.from+0.5)*g.barW; }

  function drawBand(a,b){ var lo=Math.min(a,b),hi=Math.max(a,b); band.style.left=lo+'px'; band.style.width=(hi-lo)+'px'; band.style.display='block'; }

  function computeStats(g,i0,i1){
    var lo=Math.min(i0,i1), hi=Math.max(i0,i1);
    var bars=g.s.bars.slice(lo,hi+1); if(!bars.length)return null;
    var high=-Infinity,low=Infinity,vol=0,turn=0,sumC=0,yang=0,yin=0,rise=0,fall=0;
    for(var k=0;k<bars.length;k++){ var b=bars[k];
      if(b.h>high)high=b.h; if(b.l<low)low=b.l; vol+=(b.v||0); turn+=((b.v||0)*(b.vw||b.c||0)); sumC+=b.c;
      if(b.c>=b.o)yang++; else yin++;
      if(k>0){ if(b.c>bars[k-1].c)rise++; else if(b.c<bars[k-1].c)fall++; }
    }
    var first=bars[0], last=bars[bars.length-1];
    var chg=last.c-first.c; var chgPct=first.c?chg/first.c*100:0; var amp=low?((high-low)/low*100):0;
    return {count:bars.length,high:high,low:low,avg:sumC/bars.length,chg:chg,chgPct:chgPct,amp:amp,vol:vol,turn:turn,yang:yang,yin:yin,rise:rise,fall:fall,t0:first.t,t1:last.t};
  }

  function row(k,v){ return '<div class="r"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>'; }
  function rowc(k,v,cls){ return '<div class="r"><span class="k">'+k+'</span><span class="v'+(cls?' '+cls:'')+'">'+v+'</span></div>'; }

  function showPanel(st,clientX,clientY){
    var up=st.chgPct>=0; var cls=up?'up':'dn'; var sign=up?'+':'';
    var rows =
      row('High', fmtPx(st.high)) +
      row('Low', fmtPx(st.low)) +
      row('Avg Close', fmtPx(st.avg)) +
      rowc('% Change', sign+st.chgPct.toFixed(2)+'%', cls) +
      row('Amplitude', st.amp.toFixed(2)+'%') +
      row('Volume', fmtNum(st.vol)) +
      row('Turnover', '$'+fmtNum(st.turn)) +
      rowc('Bullish / Bearish', st.yang+' / '+st.yin, null) +
      rowc('Rise / Fall', st.rise+' / '+st.fall, null);
    panel.innerHTML =
      '<div class="h '+cls+'"><span>'+st.count+' candles &nbsp;&#8226;&nbsp; '+sign+st.chgPct.toFixed(2)+'%</span><span class="x" id="sml-iv-x">&times;</span></div>'+
      '<div class="rows">'+rows+'</div>'+
      '<div class="rng">'+fmtDate(st.t0)+'  &rarr;  '+fmtDate(st.t1)+'</div>';
    panel.style.display='block';
    var pw=panel.offsetWidth, ph=panel.offsetHeight;
    var px=clientX+16, py=clientY+16;
    if(px+pw>window.innerWidth-8)px=clientX-pw-16; if(px<8)px=8;
    if(py+ph>window.innerHeight-8)py=window.innerHeight-ph-8; if(py<8)py=8;
    panel.style.left=px+'px'; panel.style.top=py+'px';
    var xb=document.getElementById('sml-iv-x'); if(xb)xb.onclick=clearSel;
  }

  function clearSel(){ if(band)band.style.display='none'; if(tagA)tagA.style.display='none'; if(tagB)tagB.style.display='none'; if(panel)panel.style.display='none'; sel=null; }

  function onDown(e){
    if(!e.shiftKey||e.button!==0)return;
    var hostEl=currentHost(); if(!hostEl)return;
    if(!(e.target===hostEl||hostEl.contains(e.target)))return;
    ensureLayer(hostEl);
    var g=geom(hostEl); if(!g)return;
    var xRel=e.clientX-g.rect.left; if(xRel<0||xRel>g.rect.width)return;
    e.preventDefault(); e.stopPropagation();
    dragging=true; sel={g:g,x0:Math.max(g.plotL,Math.min(g.plotR,xRel)),x1:Math.max(g.plotL,Math.min(g.plotR,xRel))};
    drawBand(sel.x0,sel.x0);
    window.addEventListener('pointermove',onMove,true);
    window.addEventListener('pointerup',onUp,true);
  }
  function onMove(e){
    if(!dragging||!sel)return; e.preventDefault(); e.stopPropagation();
    var g=sel.g; var xRel=Math.max(g.plotL,Math.min(g.plotR,e.clientX-g.rect.left)); sel.x1=xRel;
    var i0=xToIndex(g,sel.x0), i1=xToIndex(g,xRel);
    var ca=centerX(g,Math.min(i0,i1))-g.barW/2, cb=centerX(g,Math.max(i0,i1))+g.barW/2;
    drawBand(ca,cb);
    tagA.textContent=shortDate(g.s.bars[Math.min(i0,i1)].t); tagA.style.left=ca+'px'; tagA.style.display='block';
    tagB.textContent=shortDate(g.s.bars[Math.max(i0,i1)].t); tagB.style.left=cb+'px'; tagB.style.display='block';
  }
  function onUp(e){
    window.removeEventListener('pointermove',onMove,true); window.removeEventListener('pointerup',onUp,true);
    if(!dragging||!sel){dragging=false;return;} dragging=false;
    var g=sel.g; var i0=xToIndex(g,sel.x0), i1=xToIndex(g,sel.x1);
    if(Math.abs(i1-i0)<1 && Math.abs(sel.x1-sel.x0)<6){ clearSel(); return; }
    var st=computeStats(g,i0,i1); if(!st){clearSel();return;}
    showPanel(st,e.clientX,e.clientY);
  }

  function showHint(){ if(hint){hint.style.opacity='1'; setTimeout(function(){if(hint)hint.style.opacity='0';},1600);} }

  function boot(){
    injectCSS();
    document.addEventListener('pointerdown',onDown,true);
    document.addEventListener('keydown',function(e){ if(e.key==='Escape')clearSel(); });
    var tries=0, iv=setInterval(function(){ tries++; var h=currentHost(); if(h){ ensureLayer(h); h.addEventListener('mouseenter',showHint); clearInterval(iv);} if(tries>200)clearInterval(iv); },300);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot); else boot();
})();
