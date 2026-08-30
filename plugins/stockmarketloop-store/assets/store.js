(function(){
  'use strict';
  var root=document.querySelector('[data-sml-store]');
  if(!root||!window.smlStore)return;
  var cfg=window.smlStore;
  var modal=root.querySelector('[data-store-modal]');
  var modalTitle=modal.querySelector('[data-modal-title]');
  var modalBody=modal.querySelector('[data-modal-body]');
  var detail=modal.querySelector('[data-modal-detail]');
  var detailLabel=modal.querySelector('[data-modal-detail-label]');
  var detailValue=modal.querySelector('[data-modal-detail-value]');
  var confirm=modal.querySelector('[data-modal-confirm]');
  var pending=null;

  function fmt(n){return Number(n||0).toLocaleString('en-US');}
  function balance(){return Number(root.getAttribute('data-balance')||0);}
  function setBalance(n){root.setAttribute('data-balance',String(n));root.querySelectorAll('[data-sml-balance]').forEach(function(el){el.textContent=fmt(n)+' LB';});}
  function open(opts){
    pending=opts.onConfirm||null;
    modalTitle.textContent=opts.title||'Confirm purchase';
    modalBody.textContent=opts.body||'';
    if(opts.detail){detail.hidden=false;detailLabel.textContent=opts.detailLabel||'Balance after';detailValue.textContent=opts.detail;}else{detail.hidden=true;}
    confirm.textContent=opts.confirmLabel||'Confirm';
    modal.hidden=false;document.body.style.overflow='hidden';confirm.focus();
  }
  function close(){modal.hidden=true;pending=null;document.body.style.overflow='';}
  function notice(msg,error){var el=root.querySelector('[data-store-notice]');el.textContent=msg;el.hidden=false;el.classList.toggle('is-error',!!error);el.scrollIntoView({behavior:'smooth',block:'center'});}
  function purchase(btn){
    var price=Number(btn.getAttribute('data-price')||0),bal=balance(),item=btn.getAttribute('data-buy');
    if(!cfg.loggedIn){window.location.href=cfg.loginUrl;return;}
    if(btn.hasAttribute('data-per-use')){open({title:'Pay per upload',body:btn.getAttribute('data-body'),detailLabel:'Cost per upload',detail:fmt(price)+' LB',confirmLabel:'Got it',onConfirm:close});return;}
    if(bal<price){open({title:'Not enough Loop Bucks',body:'This unlock costs '+fmt(price)+' LB but you have '+fmt(bal)+' LB.',detailLabel:'You need',detail:fmt(price-bal)+' more LB',confirmLabel:'Get Loop Bucks',onConfirm:function(){close();root.querySelector('[data-packages]').scrollIntoView({behavior:'smooth'});}});return;}
    open({title:btn.getAttribute('data-title')||'Unlock perk?',body:btn.getAttribute('data-body')||('Unlock this perk for '+fmt(price)+' Loop Bucks?'),detailLabel:'Balance after',detail:fmt(bal-price)+' LB',confirmLabel:btn.getAttribute('data-confirm')||'Unlock',onConfirm:function(){
      confirm.disabled=true;confirm.textContent='Working…';
      fetch(cfg.endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-WP-Nonce':cfg.nonce},body:JSON.stringify({item_id:Number(item)})}).then(function(r){return r.json().then(function(d){return {ok:r.ok,data:d};});}).then(function(res){
        confirm.disabled=false;if(!res.ok)throw new Error(res.data&&res.data.message?res.data.message:'Purchase failed.');
        setBalance(res.data.balance);close();btn.disabled=true;btn.textContent=btn.getAttribute('data-active-label')||'Unlocked';var card=btn.closest('.sml-store__perk,.sml-store__verify');if(card){var owned=card.querySelector('[data-owned]');if(owned)owned.hidden=false;}notice((res.data.item&&res.data.item.name?res.data.item.name:'Purchase')+' unlocked.');
      }).catch(function(err){confirm.disabled=false;close();notice(err.message||'Purchase failed.',true);});
    }});
  }
  root.addEventListener('click',function(e){
    var closeBtn=e.target.closest('[data-modal-close]');if(closeBtn){e.preventDefault();close();return;}
    if(e.target===modal){close();return;}
    var pack=e.target.closest('[data-pack]');if(pack){e.preventDefault();var url=pack.getAttribute('data-url');open({title:'Confirm purchase',body:'You are buying '+pack.getAttribute('data-amount')+' Loop Bucks for '+pack.getAttribute('data-price-label')+'.',detailLabel:'New balance',detail:fmt(balance()+Number(pack.getAttribute('data-amount')))+' LB',confirmLabel:'Pay '+pack.getAttribute('data-price-label'),onConfirm:function(){if(url){window.location.href=url;}else{close();notice('This Loop Bucks pack is not available for checkout yet.',true);}}});return;}
    var gift=e.target.closest('[data-gift-button]');if(gift){e.preventDefault();open({title:'Choose what to gift',body:'Open a post, video, live stream, or article and send the '+gift.getAttribute('data-gift-name')+' from that content. This protects your Loop Bucks by attaching every gift to its creator and content.',confirmLabel:'Open Feed',onConfirm:function(){window.location.href=cfg.feedUrl;}});return;}
    var option=e.target.closest('[data-option]');if(option){e.preventDefault();var card=option.closest('.sml-store__perk');card.querySelectorAll('[data-option]').forEach(function(o){o.classList.remove('is-active');});option.classList.add('is-active');var buy=card.querySelector('[data-buy]');buy.setAttribute('data-buy',option.getAttribute('data-item'));buy.setAttribute('data-price',option.getAttribute('data-price'));buy.textContent=option.getAttribute('data-label');return;}
    var buy=e.target.closest('[data-buy]');if(buy&&!buy.disabled){e.preventDefault();purchase(buy);return;}
  });
  confirm.addEventListener('click',function(){if(pending){var fn=pending;pending=null;fn();}});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!modal.hidden)close();});
})();
