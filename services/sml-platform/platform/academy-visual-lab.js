'use strict';

const CHART_TYPES = Object.freeze([
  'Candlestick', 'Bar', 'Line', 'Heikin-Ashi', 'Renko',
  'Point & Figure', 'Kagi', 'OHLC', 'Raindrop', 'Chart Patterns'
]);

function numericBar(bar = {}) {
  return {
    t: Number(bar.t), o: Number(bar.o), h: Number(bar.h),
    l: Number(bar.l), c: Number(bar.c), v: Number(bar.v) || 0
  };
}

function calculateIntervalStats(source = []) {
  const bars = source.map(numericBar).filter((bar) =>
    [bar.o, bar.h, bar.l, bar.c].every(Number.isFinite));
  if (!bars.length) return null;
  const first = bars[0], last = bars[bars.length - 1];
  const high = Math.max(...bars.map((bar) => bar.h));
  const low = Math.min(...bars.map((bar) => bar.l));
  const average = bars.reduce((sum, bar) => sum + ((bar.h + bar.l + bar.c) / 3), 0) / bars.length;
  const volume = bars.reduce((sum, bar) => sum + bar.v, 0);
  const turnover = bars.reduce((sum, bar) => sum + bar.v * ((bar.h + bar.l + bar.c) / 3), 0);
  let rise = 0, fall = 0;
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index].c > bars[index - 1].c) rise += 1;
    if (bars[index].c < bars[index - 1].c) fall += 1;
  }
  return {
    start: first.t, end: last.t, high, low, average,
    changePct: first.o ? ((last.c - first.o) / first.o) * 100 : 0,
    amplitudePct: average ? ((high - low) / average) * 100 : 0,
    volume, turnover,
    bullish: bars.filter((bar) => bar.c >= bar.o).length,
    bearish: bars.filter((bar) => bar.c < bar.o).length,
    rise, fall, count: bars.length
  };
}

function heikinAshi(source = []) {
  let previousOpen = null, previousClose = null;
  return source.map(numericBar).map((bar) => {
    const close = (bar.o + bar.h + bar.l + bar.c) / 4;
    const open = previousOpen == null ? (bar.o + bar.c) / 2 : (previousOpen + previousClose) / 2;
    const result = { ...bar, o: open, c: close, h: Math.max(bar.h, open, close), l: Math.min(bar.l, open, close) };
    previousOpen = open; previousClose = close;
    return result;
  });
}

function renko(source = [], requestedBoxSize) {
  const bars = source.map(numericBar);
  if (!bars.length) return [];
  const range = Math.max(...bars.map((bar) => bar.h)) - Math.min(...bars.map((bar) => bar.l));
  const box = Number(requestedBoxSize) > 0 ? Number(requestedBoxSize) : Math.max(range / 20, 0.01);
  const bricks = [];
  let anchor = bars[0].c;
  bars.slice(1).forEach((bar) => {
    while (Math.abs(bar.c - anchor) >= box) {
      const direction = bar.c > anchor ? 1 : -1;
      const close = anchor + direction * box;
      bricks.push({ t: bar.t, o: anchor, h: Math.max(anchor, close), l: Math.min(anchor, close), c: close, v: bar.v, box });
      anchor = close;
    }
  });
  return bricks;
}

function academyVisualLabScript() {
  const names = JSON.stringify(CHART_TYPES).replace(/</g, '\\u003c');
  return `<style>
.academy-chart-tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 8px;border:1px solid #1b3540;border-top:0;background:#09121a}.academy-chart-tools label{font:800 .6rem ui-monospace;color:#8ee8c1}.academy-chart-tools select,.academy-chart-tools button{height:27px;border:1px solid #2b5362;border-radius:5px;background:#10212b;color:#eaf5f8;padding:3px 7px;font:800 .61rem system-ui}.academy-chart-tools button.on{background:#00c47d;color:#032318}.academy-chart-stage{position:relative;min-height:0;height:100%}.academy-chart-stage>canvas{position:absolute;inset:0;width:100%;height:100%}.academy-chart-overlay{z-index:2;cursor:crosshair}.academy-interval-stats{display:none;position:absolute;z-index:4;left:18px;top:18px;width:min(520px,calc(100% - 36px));padding:9px;border:1px solid #4de9ae;border-radius:8px;background:rgba(4,14,20,.94);box-shadow:0 9px 30px rgba(0,0,0,.55)}.academy-interval-stats.open{display:block}.academy-stat-head{display:flex;justify-content:space-between;gap:9px;margin-bottom:7px;color:#8ff1c5;font:900 .64rem ui-monospace}.academy-stat-grid{display:grid;grid-template-columns:repeat(5,minmax(74px,1fr));gap:5px}.academy-stat-grid span{padding:5px;background:#0e2029;color:#78929e;font:600 .54rem ui-monospace}.academy-stat-grid b{display:block;margin-top:2px;color:#eef8fa;font-size:.66rem}.academy-visual-math-lab{display:none;margin:10px 0 14px;padding:12px;border:1px solid #ffca55;border-radius:10px;background:linear-gradient(145deg,#09131b,#171407)}.academy-visual-math-lab.open{display:block}.academy-math-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:9px;color:#ffda7c;font:900 .65rem ui-monospace;letter-spacing:.07em}.academy-math-stage{position:relative;min-height:220px;border:1px solid #3f4f54;border-radius:8px;background:#071018;overflow:hidden}.academy-math-step{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:9px;padding:14px}.academy-ladder{display:grid;gap:5px}.academy-ladder div{display:flex;justify-content:space-between;padding:7px 8px;border-radius:5px;font:800 .68rem ui-monospace}.academy-ladder .ask{position:static;background:#431724;color:#ff9aad;animation:none}.academy-ladder .bid{position:static;background:#073b2c;color:#78f0bb;animation:none}.academy-math-arrow{color:#ffd166;font-size:2rem;transform:translateX(calc(var(--math-progress,0)*12px))}.academy-equations{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.academy-equations span{padding:8px;border:1px solid #304b57;background:#0d1d27;color:#dcecf1;font:800 .65rem/1.35 ui-monospace}.academy-equations b{color:#ffcf5a}.academy-guide{position:fixed;z-index:2147483645;pointer-events:none;border:3px solid #ffd24d;border-radius:9px;box-shadow:0 0 0 9999px rgba(0,0,0,.28),0 0 25px #ffd24d}.academy-guide:after{content:attr(data-label);position:absolute;right:0;bottom:calc(100% + 8px);max-width:260px;padding:7px 10px;border-radius:7px;background:#ffd24d;color:#1a1300;font:900 .68rem/1.25 system-ui}.academy-guide:before{content:'➜';position:absolute;right:14px;bottom:calc(100% - 2px);color:#ffd24d;font-size:1.35rem;transform:rotate(90deg)}
@media(max-width:760px){.academy-stat-grid{grid-template-columns:repeat(2,1fr)}.academy-math-step{grid-template-columns:1fr}.academy-math-arrow{transform:rotate(90deg)}.academy-equations{grid-template-columns:1fr}}
</style><script>(()=>{
const chartTypes=${names},base=document.getElementById('chart'),toolbar=document.querySelector('.toolbar');if(!base||!toolbar)return;
const tools=document.createElement('div');tools.className='academy-chart-tools';tools.innerHTML='<label for="academy-chart-type">CHART TYPE</label><select id="academy-chart-type"></select><button id="academy-select-range" class="on" type="button">Drag: Interval Stats</button><button id="academy-clear-range" type="button">Clear</button><span style="color:#728b97;font:600 .58rem ui-monospace">Drag across candles to calculate the selected range</span>';
const select=tools.querySelector('select');chartTypes.forEach(name=>{const option=document.createElement('option');option.textContent=name;option.value=name;select.appendChild(option)});toolbar.insertAdjacentElement('afterend',tools);
const stage=document.createElement('div');stage.className='academy-chart-stage';base.parentNode.insertBefore(stage,base);stage.appendChild(base);const overlay=document.createElement('canvas');overlay.className='academy-chart-overlay';overlay.setAttribute('aria-label','Interactive chart types and interval selection');stage.appendChild(overlay);
const stats=document.createElement('section');stats.className='academy-interval-stats';stats.setAttribute('aria-live','polite');stage.appendChild(stats);
let latest=[],style='Candlestick',selection=null,dragStart=null;
const number=value=>Number(value),valid=bar=>bar&&['o','h','l','c'].every(key=>Number.isFinite(number(bar[key]))),fmt=(value,digits=2)=>Number(value).toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}),compact=value=>Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(Number(value)||0),stamp=value=>{const raw=Number(value);if(!Number.isFinite(raw))return'—';const ms=raw<1e12?raw*1000:raw;return new Date(ms).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})};
const getState=()=>{const state=window.smlAcademyChartState?.()||{},bars=(Array.isArray(state.bars)?state.bars:latest).filter(valid),n=Math.max(12,Math.min(bars.length,Math.floor(105/(state.scale||1)))),end=Math.max(n,Math.min(bars.length,bars.length-(state.offset||0)));return{bars,view:bars.slice(end-n,end)}};
const ha=source=>{let po=null,pc=null;return source.map(raw=>{const b={...raw,o:+raw.o,h:+raw.h,l:+raw.l,c:+raw.c,v:+raw.v||0},c=(b.o+b.h+b.l+b.c)/4,o=po==null?(b.o+b.c)/2:(po+pc)/2,r={...b,o,c,h:Math.max(b.h,o,c),l:Math.min(b.l,o,c)};po=o;pc=c;return r})};
const renkoBars=source=>{if(!source.length)return[];const range=Math.max(...source.map(b=>+b.h))-Math.min(...source.map(b=>+b.l)),box=Math.max(range/20,.01),out=[];let anchor=+source[0].c;source.slice(1).forEach(b=>{while(Math.abs(+b.c-anchor)>=box){const dir=+b.c>anchor?1:-1,next=anchor+dir*box;out.push({...b,o:anchor,c:next,h:Math.max(anchor,next),l:Math.min(anchor,next)});anchor=next}});return out};
function size(){const r=stage.getBoundingClientRect(),d=devicePixelRatio||1;overlay.width=Math.max(1,Math.round(r.width*d));overlay.height=Math.max(1,Math.round(r.height*d));overlay.style.width=r.width+'px';overlay.style.height=r.height+'px';overlay.getContext('2d').setTransform(d,0,0,d,0);draw()}
function axes(ctx,w,h,view){const pad={l:12,r:64,t:18,b:24},lo=Math.min(...view.map(b=>+b.l)),hi=Math.max(...view.map(b=>+b.h)),span=hi-lo||1,y=value=>pad.t+(hi-value)/span*(h-pad.t-pad.b),step=(w-pad.l-pad.r)/Math.max(1,view.length);ctx.fillStyle='#071018';ctx.fillRect(0,0,w,h);ctx.strokeStyle='rgba(116,153,170,.15)';for(let i=0;i<5;i++){const yy=pad.t+(h-pad.t-pad.b)*i/4;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(w-pad.r,yy);ctx.stroke();ctx.fillStyle='#78919d';ctx.font='10px ui-monospace';ctx.fillText(fmt(hi-span*i/4),w-pad.r+7,yy+3)}return{pad,y,step,lo,hi}}
function drawOhlc(ctx,view,g,body=true,ticks=true){view.forEach((b,i)=>{const x=g.pad.l+(i+.5)*g.step,up=+b.c>=+b.o,color=up?'#00d084':'#ff5470';ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(x,g.y(+b.h));ctx.lineTo(x,g.y(+b.l));if(ticks){ctx.moveTo(x-g.step*.3,g.y(+b.o));ctx.lineTo(x,g.y(+b.o));ctx.moveTo(x,g.y(+b.c));ctx.lineTo(x+g.step*.3,g.y(+b.c))}ctx.stroke();if(body){const top=g.y(Math.max(+b.o,+b.c)),bottom=g.y(Math.min(+b.o,+b.c));ctx.fillRect(x-g.step*.3,top,Math.max(1,g.step*.6),Math.max(1,bottom-top))}})}
function drawLine(ctx,view,g){ctx.beginPath();view.forEach((b,i)=>{const x=g.pad.l+(i+.5)*g.step,y=g.y(+b.c);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.strokeStyle='#58d7ff';ctx.lineWidth=2;ctx.stroke()}
function drawPointFigure(ctx,view,g){const box=Math.max((g.hi-g.lo)/14,.01);let col=0,anchor=+view[0].c,dir=0;view.slice(1).forEach(b=>{const delta=+b.c-anchor,next=delta>0?1:delta<0?-1:0;if(next&&dir&&next!==dir)col++;if(next)dir=next;const count=Math.floor(Math.abs(delta)/box);for(let j=1;j<=count;j++){const x=g.pad.l+(col+.5)*Math.max(12,g.step),y=g.y(anchor+dir*j*box);ctx.fillStyle=dir>0?'#00d084':'#ff5470';ctx.font='bold 13px ui-monospace';ctx.fillText(dir>0?'X':'O',x,y)}if(count)anchor+=dir*count*box})}
function drawKagi(ctx,view,g){const reversal=Math.max((g.hi-g.lo)*.04,.01);let x=g.pad.l+8,last=+view[0].c,dir=0;ctx.beginPath();ctx.moveTo(x,g.y(last));view.slice(1).forEach(b=>{const price=+b.c,next=price>last?1:-1;if(dir&&next!==dir&&Math.abs(price-last)>=reversal){x+=Math.max(7,g.step);ctx.lineTo(x,g.y(last))}if(!dir||next===dir||Math.abs(price-last)>=reversal){dir=next;last=price;ctx.lineTo(x,g.y(last))}});ctx.strokeStyle='#ffd166';ctx.lineWidth=3;ctx.stroke()}
function drawRaindrop(ctx,view,g){const maxV=Math.max(1,...view.map(b=>+b.v||0));view.forEach((b,i)=>{const x=g.pad.l+(i+.5)*g.step,w=Math.max(2,g.step*.38*((+b.v||0)/maxV)),mid=g.y((+b.h + +b.l)/2),color=+b.c>=+b.o?'#00d084':'#ff5470';ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x,g.y(+b.h));ctx.lineTo(x,g.y(+b.l));ctx.stroke();ctx.fillStyle=color+'99';ctx.beginPath();ctx.ellipse(x-w*.25,mid,w,Math.max(3,Math.abs(g.y(+b.h)-g.y(+b.l))*.18),0,0,Math.PI*2);ctx.fill()})}
function drawPatterns(ctx,view,g){drawOhlc(ctx,view,g,true,false);const highs=view.map((b,i)=>({i,v:+b.h})).sort((a,b)=>b.v-a.v).slice(0,2).sort((a,b)=>a.i-b.i);if(highs.length===2){ctx.setLineDash([6,5]);ctx.strokeStyle='#ffd166';ctx.beginPath();ctx.moveTo(g.pad.l+(highs[0].i+.5)*g.step,g.y(highs[0].v));ctx.lineTo(g.pad.l+(highs[1].i+.5)*g.step,g.y(highs[1].v));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#ffd166';ctx.font='bold 11px system-ui';ctx.fillText('Potential resistance — confirm, do not predict',g.pad.l+8,g.pad.t+16)}}
function draw(){const ctx=overlay.getContext('2d'),w=overlay.clientWidth,h=overlay.clientHeight,{view}=getState();ctx.clearRect(0,0,w,h);if(!view.length)return;let data=style==='Heikin-Ashi'?ha(view):style==='Renko'?renkoBars(view):view;if(!data.length)data=view;const g=axes(ctx,w,h,data);if(style==='Line')drawLine(ctx,data,g);else if(style==='Bar'||style==='OHLC')drawOhlc(ctx,data,g,false,true);else if(style==='Point & Figure')drawPointFigure(ctx,data,g);else if(style==='Kagi')drawKagi(ctx,data,g);else if(style==='Raindrop')drawRaindrop(ctx,data,g);else if(style==='Chart Patterns')drawPatterns(ctx,data,g);else drawOhlc(ctx,data,g,true,false);ctx.fillStyle='#90a5b3';ctx.font='bold 10px ui-monospace';ctx.fillText(style.toUpperCase()+' · LIVE',g.pad.l,h-8);if(selection){ctx.fillStyle='rgba(255,209,102,.14)';ctx.strokeStyle='#ffd166';ctx.fillRect(selection.x1,0,selection.x2-selection.x1,h);ctx.strokeRect(selection.x1+.5,.5,selection.x2-selection.x1-1,h-1)}}
function selectedBars(){if(!selection)return[];const {view}=getState(),w=overlay.clientWidth,padL=12,padR=64,pw=w-padL-padR,step=pw/Math.max(1,view.length),start=Math.max(0,Math.min(view.length-1,Math.floor((selection.x1-padL)/step))),end=Math.max(start,Math.min(view.length-1,Math.floor((selection.x2-padL)/step)));return view.slice(start,end+1)}
function calc(source){if(!source.length)return null;const high=Math.max(...source.map(b=>+b.h)),low=Math.min(...source.map(b=>+b.l)),avg=source.reduce((s,b)=>s+(+b.h + +b.l + +b.c)/3,0)/source.length,volume=source.reduce((s,b)=>s+(+b.v||0),0),turnover=source.reduce((s,b)=>s+(+b.v||0)*((+b.h + +b.l + +b.c)/3),0);let rise=0,fall=0;source.slice(1).forEach((b,i)=>{if(+b.c>+source[i].c)rise++;else if(+b.c<+source[i].c)fall++});return{start:source[0].t,end:source.at(-1).t,high,low,avg,change:+source[0].o?((+source.at(-1).c-+source[0].o)/+source[0].o)*100:0,amp:avg?(high-low)/avg*100:0,volume,turnover,bull:source.filter(b=>+b.c>=+b.o).length,bear:source.filter(b=>+b.c<+b.o).length,rise,fall,count:source.length}}
function renderStats(){const s=calc(selectedBars());if(!s){stats.classList.remove('open');return}const items=[['Start',stamp(s.start)],['End',stamp(s.end)],['High',fmt(s.high)],['Low',fmt(s.low)],['Average',fmt(s.avg)],['% Change',(s.change>=0?'+':'')+fmt(s.change)+'%'],['Amplitude',fmt(s.amp)+'%'],['Volume',compact(s.volume)],['Turnover',String.fromCharCode(36)+compact(s.turnover)],['Bull / Bear',s.bull+' / '+s.bear],['Rise / Fall',s.rise+' / '+s.fall],['Candles',s.count]];stats.innerHTML='<div class="academy-stat-head"><span>INTERVAL STATS · SELECTED CANDLES ONLY</span><span>'+style+'</span></div><div class="academy-stat-grid">'+items.map(item=>'<span>'+item[0]+'<b>'+item[1]+'</b></span>').join('')+'</div>';stats.classList.add('open')}
overlay.addEventListener('pointerdown',event=>{dragStart=event.offsetX;selection={x1:dragStart,x2:dragStart};overlay.setPointerCapture(event.pointerId);draw()});overlay.addEventListener('pointermove',event=>{if(dragStart==null)return;selection={x1:Math.min(dragStart,event.offsetX),x2:Math.max(dragStart,event.offsetX)};draw()});overlay.addEventListener('pointerup',()=>{dragStart=null;renderStats();draw()});tools.querySelector('#academy-clear-range').onclick=()=>{selection=null;stats.classList.remove('open');draw()};select.onchange=()=>{style=select.value;selection=null;stats.classList.remove('open');draw()};
const lab=document.createElement('section');lab.className='academy-visual-math-lab';lab.innerHTML='<div class="academy-math-head"><span>VISUAL MATH LAB · NARRATION SYNCED</span><span id="academy-math-phase">STEP 1 / 3</span></div><div class="academy-math-stage"><div class="academy-math-step"><div class="academy-ladder"><div class="ask"><span>ASK · Seller offers</span><b>$100.05 × 300</b></div><div class="ask"><span>NEXT ASK</span><b>$100.06 × 500</b></div></div><div class="academy-math-arrow">➜</div><div class="academy-ladder"><div class="bid"><span>BID · Buyer offers</span><b>$100.00 × 400</b></div><div class="bid"><span>NEXT BID</span><b>$99.99 × 600</b></div></div><div class="academy-equations"><span>Spread<br><b>$100.05 − $100.00 = $0.05</b></span><span>Midpoint<br><b>($100.05 + $100.00) ÷ 2 = $100.025</b></span><span>Market buy<br><b>Consumes the $100.05 ask; the next available ask can become $100.06</b></span></div></div></div>';document.querySelector('.academy-live-deck')?.insertAdjacentElement('afterend',lab);
let guide=null,lastGuide='';function showGuide(target,label){if(!target){guide?.remove();guide=null;return}if(!guide){guide=document.createElement('div');guide.className='academy-guide';document.body.appendChild(guide)}const r=target.getBoundingClientRect();guide.style.left=(r.left-4)+'px';guide.style.top=(r.top-4)+'px';guide.style.width=(r.width+8)+'px';guide.style.height=(r.height+8)+'px';guide.dataset.label=label}
function syncVisual(detail){const text=((detail.lesson?.title||'')+' '+(detail.text||'')+' '+(detail.slide?.visualKind||'')).toLowerCase(),progress=Math.max(0,Math.min(1,Number(detail.progress)||0));lab.style.setProperty('--math-progress',progress);lab.querySelector('#academy-math-phase').textContent='STEP '+Math.min(3,Math.floor(progress*3)+1)+' / 3';const mathNeeded=/bid|ask|spread|order book|price discovery|liquidity|level 2|market order/.test(text);lab.classList.toggle('open',mathNeeded);let key='',target=null,label='';if(/level 2|order book|bid|ask|spread|liquidity/.test(text)){key='depth';target=document.querySelector('.academy-depth')||document.querySelector('.book');label='LEVEL 2: watch price and available size on both sides'}else if(/scanner|s\.i\.r\.e|relative volume|premarket|gainer|momentum/.test(text)){key='scanner';target=document.querySelector('.academy-scanner');label='SCANNER: filter and compare verified live fields'}else if(/candle|ohlc|heikin|renko|kagi|point.{0,3}figure|raindrop|chart pattern/.test(text)){key='chart';target=stage;label='CHART: inspect structure, then validate with context'}if(key!==lastGuide){lastGuide=key;showGuide(target,label)}if(!key)showGuide(null,'')}
window.addEventListener('sml-academy-slide-sync',event=>syncVisual(event.detail||{}));const liveDeck=document.querySelector('.academy-live-deck');if(liveDeck)new MutationObserver(()=>{const progress=parseFloat(document.querySelector('.academy-deck-progress i')?.style.width||'0')/100;syncVisual({lesson:{title:document.getElementById('lesson-title')?.textContent||''},text:(document.querySelector('.academy-slide-title')?.textContent||'')+' '+(document.querySelector('.academy-caption')?.textContent||''),progress:progress%1,slide:{visualKind:document.querySelector('.academy-slide-visual')?.dataset.kind||''}})}).observe(liveDeck,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','data-kind']});window.addEventListener('sml-academy-market',event=>{latest=Array.isArray(event.detail?.bars)?event.detail.bars:latest;selection=null;stats.classList.remove('open');draw()});new ResizeObserver(size).observe(stage);window.addEventListener('scroll',()=>{if(lastGuide){lastGuide='';showGuide(null,'')}},{passive:true});size();
})()</script>`;
}

module.exports = { CHART_TYPES, calculateIntervalStats, heikinAshi, renko, academyVisualLabScript };
