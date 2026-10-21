/* Where each playbook step points on the page (the words are in academy/tour-playbooks.js, keyed by the same step ids). A step lists the
 * control to spotlight (`s`, first visible match wins) and what to open first (`pre`). A step with no match is read as a plain card, so
 * a layout that lacks a module (a phone, a free account) still hears the whole lesson. Modules a step opens are closed again when the
 * walkthrough ends (window.smlTourEnsure, academy-tour.js). */
(() => {
  if (window.__smlPlaybooks) return;
  window.__smlPlaybooks = 1;
  const $ = (s) => document.querySelector(s);
  const ensure = (panel, opener) => () => { if (window.smlTourEnsure) window.smlTourEnsure(panel, opener); };
  const show = (sel) => () => { const el = $(sel); if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'start', behavior: 'instant' }); } catch (_) { /* ignore */ } } };
  const both = (...fns) => () => fns.forEach((f) => f());
  const T = {};
  const add = (pb, map) => Object.keys(map).forEach((k) => { T['pb-' + pb + '-' + k] = map[k]; });

  const DIR = '#academy-direction';
  add('together', {
    direction: { s: DIR, pre: show(DIR) },
    flow: { s: '#tool-rail .tg[data-group=flow], #ms-sub' },
    levels: { s: '#tool-rail .tg[data-group=chart], #ms-sub' },
    plan: { s: '#targets-toggle, #mem-algo-toggle' },
    contract: { s: '#options-chain, #options-dock', pre: show('#options-chain') },
    risk: { s: '#click-alert-toggle' }
  });
  add('spy', {
    intro: { s: DIR, pre: show(DIR) },
    tabs: { s: DIR + ' .smd-tabs' },
    bias: { s: DIR + ' .smd-label, ' + DIR + ' .smd-gauge' },
    built: { s: DIR + ' .smd-ev' },
    checklist: { s: DIR + ' .smd-check' },
    levels: { s: DIR + ' .smd-levels' },
    gamma: { s: DIR + ' .smd-flip, ' + DIR + ' .smd-v2' },
    vix: { s: DIR + ' .smd-vix, ' + DIR + ' .smd-regime' },
    catalysts: { s: DIR + ' .smd-tbl, ' + DIR + ' .smd-v2' },
    record: { s: DIR + ' .smd-foot, ' + DIR + ' .smd-note' },
    chain: { s: '#options-chain, #options-dock', pre: show('#options-chain') }
  });
  add('cheap', {
    intro: { s: '#options-chain, #options-dock', pre: both(ensure('#options-chain', '#load-options'), show('#options-chain')) },
    expiry: { s: '#options-expiry' },
    range: { s: '#options-range' },
    columns: { s: '#options-chain table' },
    click: { s: '#options-chain table' },
    calc: { s: '.opt-calc', pre: show('.opt-calc') },
    scenario: { s: '.opt-calc table, .opt-calc' },
    breakeven: { s: '.opt-calc' },
    screen: { s: '#academy-screener-toggle, #academy-screener', pre: ensure('#academy-screener', '#academy-screener-toggle') },
    checks: { s: '#options-chain' },
    ready: { s: '#paper-toggle' }
  });
  add('indicators', {
    intro: { s: '.academy-intelligence', pre: show('.academy-intelligence') },
    search: { s: '#academy-indicator-search' },
    live: { s: '#academy-indicator-category, .academy-intelligence' },
    combo: { s: '.academy-intelligence' },
    screener: { s: '#academy-screener, #academy-screener-toggle', pre: both(ensure('#academy-screener', '#academy-screener-toggle'), show('#academy-screener')) },
    rows: { s: '#academy-screener' },
    suggest: { s: '#academy-screener-suggest, #academy-screener' },
    targets: { s: '#targets-toggle' }
  });
  add('fda', {
    intro: { s: '#catalysts-toggle' },
    open: { s: '#catalysts-panel', pre: both(ensure('#catalysts-panel', '#catalysts-toggle'), () => { const t = $('#catalysts-panel [data-tab="fda"]'); if (t) t.click(); }) },
    columns: { s: '#catalysts-panel table' },
    approval: { s: '#catalysts-panel table' },
    impact: { s: '#catalysts-panel table' },
    detail: { s: '#catalysts-panel tr.row, #catalysts-panel table', pre: () => { const r = $('#catalysts-panel tr.row'); if (r && !r.nextElementSibling) r.click(); } },
    plan: { s: '#academy-hedge, #catalysts-panel' }
  });
  const hedgePre = () => { ensure('#mem-algo-panel', '#mem-algo-toggle')(); const b = $('.mem-hedge-btn'); if (b && !($('#academy-hedge') && $('#academy-hedge').getBoundingClientRect().height)) b.click(); const h = $('#academy-hedge'); if (h) h.scrollIntoView({ block: 'start' }); };
  add('hedge', {
    intro: { s: '#mem-algo-toggle' },
    open: { s: '#academy-hedge', pre: hedgePre },
    form: { s: '#academy-hedge' },
    context: { s: '#academy-hedge' },
    cards: { s: '#academy-hedge' },
    numbers: { s: '#academy-hedge' },
    payoff: { s: '#academy-hedge' },
    act: { s: '#academy-hedge' }
  });
  add('social', {
    talk: { s: '#talk-panel, #talk-btn', pre: ensure('#talk-panel', '#talk-btn') },
    post: { s: '#talk-panel .tk-say, #talk-panel' },
    follow: { s: '#talk-panel' },
    rooms: { s: '.academy-chat-tabs', pre: show('.academy-chat') },
    chat: { s: 'section.academy-chat' },
    use: { s: 'section.academy-chat' }
  });
  add('profile', {
    intro: { s: '#academy-profile-btn' },
    open: { s: '#academy-profile-view', pre: ensure('#academy-profile-view', '#academy-profile-btn') },
    basics: { s: '#pv-edit, #academy-profile-view', pre: () => { const e = $('#academy-profile-view [data-pv="edit"]'); if (e && !($('#pv-edit') && $('#pv-edit').getBoundingClientRect().height)) e.click(); } },
    look: { s: '#pv-edit' },
    fx: { s: '#pv-edit' },
    song: { s: '#pv-edit' },
    show: { s: '#pv-edit' },
    record: { s: '#academy-profile-view' },
    money: { s: '.ac-host, #academy-profile-view' },
    paid: { s: '.ac-host, #academy-profile-view' }
  });
  window.smlTourTargets = T;
})();
