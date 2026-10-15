/* Academy profile desk: how a profile page LOOKS and FEELS (the member picks it in Customize, server: academy-profile-pages.js).
 *   24 textures    every module can be a legal pad, graph paper, manila folder, kraft paper, newsprint, ledger sheet, ticker tape,
 *                  index card, sticky note, blueprint, carbon fibre, brushed steel, leather, walnut, oak, marble, brass plate,
 *                  green felt, cork board, CRT terminal, parchment, concrete, slate or frosted glass. Drawn in CSS only.
 *   6 desks        the surface the modules sit on, drawn as a scene (NYSE trading floor, paper desk, walnut office, steel
 *                  trader's desk, cork wall, leather blotter). With no texture chosen a desk dresses its own modules: the paper
 *                  desk makes each module a different sheet of paper, the NYSE floor makes them screens and instruments.
 *   7 lights       desk lamp, window sun, monitor glow, neon sweep, golden hour, spotlight: moving light over the page,
 *                  with dust in the beam, pulsing with the song.
 *   3D orbs        glass-like spheres flying around the page in real perspective.
 *   3D gallery     up to 12 pictures on a rotating orbit (drag to spin); each picture can link to a page.
 * Pictures come through the Academy's own origin (the page may only show images from itself). The file builds its CSS and SVG
 * from plain strings and holds no backslash, backtick or template placeholder: it is inlined into the Academy page. */
(() => {
  if (window.smlProfileDesk) return;

  /* ---------- textures: [id, label, ink, muted, heading, declarations, extra rules (optional)] ---------- */
  const TEX = [
    ['legal-pad', 'Legal pad', '#1d2a4a', '#4b5c80', '#b3262d',
      'background:linear-gradient(90deg,transparent 46px,rgba(214,62,69,.85) 46px,rgba(214,62,69,.85) 48px,transparent 48px),linear-gradient(90deg,transparent 52px,rgba(214,62,69,.7) 52px,rgba(214,62,69,.7) 53px,transparent 53px),repeating-linear-gradient(180deg,#fff7a8 0,#fff7a8 25px,#8fbfe0 25px,#8fbfe0 26px);border:0;border-radius:2px;padding:24px 14px 14px 64px;box-shadow:0 1px 0 #f2e27a,0 14px 30px rgba(0,0,0,.5)'],
    ['graph-paper', 'Graph paper', '#17302a', '#3d5d52', '#1a7f5a',
      'background:linear-gradient(rgba(26,127,90,.38) 1px,transparent 1px) 0 0/70px 70px,linear-gradient(90deg,rgba(26,127,90,.38) 1px,transparent 1px) 0 0/70px 70px,linear-gradient(rgba(26,127,90,.17) 1px,transparent 1px) 0 0/14px 14px,linear-gradient(90deg,rgba(26,127,90,.17) 1px,transparent 1px) 0 0/14px 14px,#f3f8f1;border:0;border-radius:2px;box-shadow:0 12px 28px rgba(0,0,0,.45)'],
    ['manila-folder', 'Manila folder', '#3b2a12', '#6b5330', '#8a3b12',
      'background:repeating-linear-gradient(0deg,rgba(120,80,20,.05) 0,rgba(120,80,20,.05) 1px,transparent 1px,transparent 3px),radial-gradient(ellipse at 30% 20%,rgba(255,255,255,.28),transparent 60%),linear-gradient(180deg,#ecd096,#dcb870);border:1px solid #b8914a;border-radius:2px 10px 4px 4px;overflow:visible;margin-top:16px;box-shadow:0 12px 26px rgba(0,0,0,.45)'],
    ['kraft-paper', 'Kraft paper', '#2b1d0e', '#54391b', '#7a2e0e',
      'background:radial-gradient(rgba(70,40,10,.18) 1px,transparent 1.5px) 0 0/5px 5px,radial-gradient(rgba(255,255,255,.12) 1px,transparent 1.5px) 2px 3px/7px 7px,repeating-linear-gradient(95deg,rgba(90,55,20,.07) 0,rgba(90,55,20,.07) 2px,transparent 2px,transparent 7px),linear-gradient(160deg,#c49a68,#a87c4a);border:0;border-radius:3px;box-shadow:0 12px 26px rgba(0,0,0,.5)'],
    ['newsprint', 'Newsprint', '#1a1a1a', '#4a4a4a', '#1a1a1a',
      'background:radial-gradient(rgba(0,0,0,.09) 1px,transparent 1.4px) 0 0/4px 4px,linear-gradient(90deg,transparent calc(50% - 1px),rgba(0,0,0,.14) calc(50% - 1px),rgba(0,0,0,.14) 50%,transparent 50%),linear-gradient(180deg,#ebe6d4,#ddd7c0);border:0;border-top:3px double #1a1a1a;border-radius:0;font-family:Georgia,serif;box-shadow:0 12px 26px rgba(0,0,0,.45)'],
    ['ledger-green', 'Ledger sheet', '#12331f', '#3b6a4c', '#a12727',
      'background:linear-gradient(90deg,transparent 40px,rgba(190,40,40,.7) 40px,rgba(190,40,40,.7) 41px,transparent 41px,transparent 44px,rgba(190,40,40,.7) 44px,rgba(190,40,40,.7) 45px,transparent 45px),repeating-linear-gradient(180deg,transparent 0,transparent 21px,rgba(30,110,60,.45) 21px,rgba(30,110,60,.45) 22px),linear-gradient(180deg,#d4e8c8,#c3dbb4);border:0;border-radius:2px;padding:14px 14px 14px 58px;box-shadow:0 12px 26px rgba(0,0,0,.45)'],
    ['ticker-tape', 'Ticker tape', '#111111', '#444444', '#0b6b3a',
      'background:radial-gradient(circle,rgba(0,0,0,.38) 2px,transparent 2.5px) 0 5px/14px 14px repeat-x,radial-gradient(circle,rgba(0,0,0,.38) 2px,transparent 2.5px) 0 100%/14px 14px repeat-x,linear-gradient(180deg,#f7f6ee,#ecebdf);border:0;border-radius:0;padding:28px 14px;font-family:ui-monospace,Menlo,Consolas,monospace;box-shadow:0 10px 22px rgba(0,0,0,.45)'],
    ['index-card', 'Index card', '#1f2a44', '#59627a', '#c0392b',
      'background:linear-gradient(180deg,transparent 33px,rgba(214,62,69,.8) 33px,rgba(214,62,69,.8) 34px,transparent 34px),repeating-linear-gradient(180deg,transparent 0,transparent 23px,rgba(70,120,190,.4) 23px,rgba(70,120,190,.4) 24px),#fffdf3;border:0;border-radius:3px;box-shadow:0 10px 20px rgba(0,0,0,.45)'],
    ['sticky-note', 'Sticky note', '#3a3000', '#6b5c00', '#8a5a00',
      'background:linear-gradient(180deg,rgba(255,255,255,.4),transparent 18%),linear-gradient(135deg,#fff08a,#ffe14d);border:0;border-radius:2px 2px 16px 2px;box-shadow:0 16px 12px -9px rgba(0,0,0,.6),0 2px 0 rgba(0,0,0,.08)'],
    ['blueprint', 'Blueprint', '#e6f4ff', '#9fc9ea', '#7fe0ff',
      'background:linear-gradient(rgba(255,255,255,.22) 1px,transparent 1px) 0 0/56px 56px,linear-gradient(90deg,rgba(255,255,255,.22) 1px,transparent 1px) 0 0/56px 56px,linear-gradient(rgba(255,255,255,.09) 1px,transparent 1px) 0 0/11.2px 11.2px,linear-gradient(90deg,rgba(255,255,255,.09) 1px,transparent 1px) 0 0/11.2px 11.2px,radial-gradient(ellipse at 50% 0,#17518e,#0b3566);border:1px solid #7fb6ec;border-radius:3px;font-family:ui-monospace,Menlo,Consolas,monospace;box-shadow:0 12px 30px rgba(0,0,0,.5)'],
    ['carbon-fiber', 'Carbon fibre', '#f1f1f1', '#9a9a9a', 'var(--acc)',
      'background:linear-gradient(135deg,rgba(255,255,255,.1),transparent 38%),repeating-linear-gradient(45deg,rgba(255,255,255,.045) 0,rgba(255,255,255,.045) 2px,transparent 2px,transparent 4px),repeating-linear-gradient(-45deg,rgba(0,0,0,.4) 0,rgba(0,0,0,.4) 2px,transparent 2px,transparent 4px),#16181b;border:1px solid #2a2d31;border-radius:6px;box-shadow:0 12px 30px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.12)'],
    ['brushed-steel', 'Brushed steel', '#1b2127', '#424c56', '#0a4a7a',
      'background:repeating-linear-gradient(90deg,rgba(255,255,255,.08) 0,rgba(255,255,255,.08) 1px,rgba(0,0,0,.05) 1px,rgba(0,0,0,.05) 2px),linear-gradient(100deg,#8e959c 0%,#d3d8dc 18%,#9aa2a9 36%,#e1e5e8 55%,#a2aab1 74%,#cfd4d8 100%);border:1px solid #6d757c;border-radius:6px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.7),inset 0 -2px 0 rgba(0,0,0,.18)'],
    ['leather', 'Leather', '#f2e3c8', '#c7ae84', '#e2b869',
      'background:radial-gradient(rgba(255,255,255,.07) 1px,transparent 1.6px) 0 0/6px 6px,radial-gradient(rgba(0,0,0,.28) 1px,transparent 2px) 3px 3px/7px 7px,radial-gradient(ellipse at 30% 10%,rgba(255,255,255,.1),transparent 60%),linear-gradient(160deg,#4a2c1a,#2e1a0f);border:1px solid #1a0e07;border-radius:10px;box-shadow:0 14px 30px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.08)'],
    ['walnut', 'Walnut', '#f6e6d0', '#cdb08a', '#f0b86a',
      'background:repeating-linear-gradient(92deg,rgba(0,0,0,.2) 0,rgba(0,0,0,.2) 2px,transparent 2px,transparent 9px,rgba(255,255,255,.045) 9px,rgba(255,255,255,.045) 10px,transparent 10px,transparent 17px),repeating-linear-gradient(88deg,rgba(0,0,0,.13) 0,rgba(0,0,0,.13) 1px,transparent 1px,transparent 23px),radial-gradient(ellipse at 20% 30%,rgba(255,200,140,.14),transparent 55%),linear-gradient(180deg,#5a3921,#3e2514);border:1px solid #24130a;border-radius:5px;box-shadow:0 14px 30px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,220,170,.16)'],
    ['oak', 'Oak', '#2a1a0a', '#5a4025', '#7a3b0c',
      'background:repeating-linear-gradient(91deg,rgba(110,70,30,.24) 0,rgba(110,70,30,.24) 1px,transparent 1px,transparent 6px,rgba(255,255,255,.1) 6px,rgba(255,255,255,.1) 7px,transparent 7px,transparent 13px),repeating-linear-gradient(89deg,rgba(80,50,20,.15) 0,rgba(80,50,20,.15) 2px,transparent 2px,transparent 31px),linear-gradient(180deg,#d1a56d,#b88a55);border:1px solid #8a6434;border-radius:5px;box-shadow:0 12px 26px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.35)'],
    ['marble', 'Marble', '#1b1f26', '#4d5662', '#5b3f9a',
      'background:linear-gradient(115deg,transparent 30%,rgba(90,100,115,.24) 31%,transparent 32.5%,transparent 55%,rgba(90,100,115,.17) 56%,transparent 57%),linear-gradient(62deg,transparent 40%,rgba(120,130,145,.2) 41%,transparent 42%),radial-gradient(ellipse at 20% 15%,#ffffff,#e9ecef 60%,#d7dbe0);border:1px solid #c3c8ce;border-radius:8px;box-shadow:0 14px 30px rgba(0,0,0,.45),inset 0 1px 0 #fff'],
    ['brass-plate', 'Brass plate', '#2b1d05', '#5c4210', '#6b1d0a',
      'background:repeating-linear-gradient(90deg,rgba(255,255,255,.12) 0,rgba(255,255,255,.12) 1px,rgba(0,0,0,.06) 1px,rgba(0,0,0,.06) 2px),linear-gradient(135deg,#b88a2a,#f1d27a 25%,#c39a3a 50%,#f4dc8e 72%,#a87a22);border:1px solid #7d5a14;border-radius:5px;text-shadow:0 1px 0 rgba(255,235,170,.75);box-shadow:0 12px 26px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,245,200,.8),inset 0 -2px 0 rgba(90,60,10,.4)'],
    ['green-felt', 'Green felt', '#f0ffe9', '#a9d9b4', '#ffe08a',
      'background:radial-gradient(rgba(255,255,255,.07) 1px,transparent 1.5px) 0 0/4px 4px,radial-gradient(rgba(0,0,0,.2) 1px,transparent 1.5px) 2px 2px/5px 5px,radial-gradient(ellipse at 50% 30%,#2f7a50,#174b2e 70%);border:2px solid #d8b24a;border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 0 40px rgba(0,0,0,.45)'],
    ['cork-board', 'Cork board', '#2b1a0a', '#5b3d1c', '#7a2e0e',
      'background:radial-gradient(rgba(60,30,5,.35) 1px,transparent 2px) 0 0/9px 9px,radial-gradient(rgba(255,230,180,.28) 1.5px,transparent 2.5px) 4px 5px/11px 11px,radial-gradient(rgba(90,50,15,.3) 2px,transparent 3px) 7px 2px/17px 17px,linear-gradient(135deg,#c98f52,#b17a40);border:5px solid #7a4b22;border-radius:6px;box-shadow:0 12px 26px rgba(0,0,0,.55),inset 0 0 18px rgba(60,30,5,.5)'],
    ['crt-terminal', 'CRT terminal', '#6dffa4', '#38b56e', '#b6ffd2',
      'background:repeating-linear-gradient(0deg,rgba(0,0,0,.4) 0,rgba(0,0,0,.4) 1px,transparent 1px,transparent 3px),radial-gradient(ellipse at center,rgba(40,120,70,.38),transparent 72%),#03130a;border:2px solid #0d3a1f;border-radius:14px;font-family:ui-monospace,Menlo,Consolas,monospace;text-shadow:0 0 6px rgba(80,255,150,.55);box-shadow:0 0 26px rgba(60,255,140,.25),inset 0 0 44px rgba(0,0,0,.75)'],
    ['parchment', 'Parchment', '#3a2a12', '#6b5430', '#7b2d12',
      'background:radial-gradient(ellipse at 50% 50%,#f6ebc9 45%,#e3c98e 85%,#c9a566 100%),#e8d3a1;border:0;border-radius:8px 14px 9px 12px / 12px 8px 14px 9px;font-family:Georgia,serif;box-shadow:0 12px 26px rgba(0,0,0,.5),inset 0 0 40px rgba(120,80,20,.45)'],
    ['concrete', 'Concrete', '#1d1f21', '#46494c', '#7a1f1f',
      'background:radial-gradient(rgba(0,0,0,.14) 1px,transparent 1.5px) 0 0/5px 5px,radial-gradient(rgba(255,255,255,.17) 1px,transparent 1.5px) 2px 2px/6px 6px,radial-gradient(ellipse at 30% 20%,rgba(255,255,255,.2),transparent 60%),linear-gradient(180deg,#9a9d9f,#82868a);border:1px solid #6a6d70;border-radius:3px;box-shadow:0 12px 26px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.25)'],
    ['slate', 'Slate', '#f4f6f8', '#aab4bd', '#ffd479',
      'background:radial-gradient(rgba(255,255,255,.05) 1px,transparent 1.5px) 0 0/6px 6px,repeating-linear-gradient(15deg,rgba(255,255,255,.028) 0,rgba(255,255,255,.028) 2px,transparent 2px,transparent 9px),linear-gradient(160deg,#363c43,#242a30);border:3px solid #6b4a2a;border-radius:4px;box-shadow:0 12px 26px rgba(0,0,0,.6),inset 0 0 22px rgba(0,0,0,.5)'],
    ['frosted-glass', 'Frosted glass', '#ffffff', '#cbd5de', 'var(--acc)',
      'background:linear-gradient(135deg,rgba(255,255,255,.2),rgba(255,255,255,.04) 45%,rgba(255,255,255,.11));-webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4);border:1px solid rgba(255,255,255,.35);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.55)']
  ];
  const TEX_IDS = TEX.map((t) => t[0]);
  /* what a desk dresses its modules in when the member picked no single texture */
  const MIX = {
    'nyse-floor': ['crt-terminal', 'carbon-fiber', 'blueprint', 'brushed-steel', 'crt-terminal', 'slate', 'ticker-tape'],
    'paper-desk': ['legal-pad', 'graph-paper', 'manila-folder', 'newsprint', 'index-card', 'ledger-green', 'kraft-paper', 'sticky-note'],
    'walnut-office': ['leather', 'brass-plate', 'walnut', 'parchment', 'leather', 'marble', 'green-felt'],
    'steel-trader': ['brushed-steel', 'carbon-fiber', 'concrete', 'slate', 'brushed-steel', 'frosted-glass'],
    'cork-wall': ['sticky-note', 'index-card', 'graph-paper', 'kraft-paper', 'legal-pad', 'newsprint'],
    'leather-blotter': ['leather', 'parchment', 'brass-plate', 'green-felt', 'oak', 'ledger-green']
  };
  const DESKS = [['none', 'No desk'], ['nyse-floor', 'NYSE trading floor'], ['paper-desk', 'Paper desk'], ['walnut-office', 'Walnut office'], ['steel-trader', 'Steel trader desk'], ['cork-wall', 'Cork wall'], ['leather-blotter', 'Leather blotter']];
  const LIGHTS = [['off', 'Off'], ['desk-lamp', 'Desk lamp'], ['window-sun', 'Window sun'], ['monitor-glow', 'Monitor glow'], ['neon-sweep', 'Neon sweep'], ['golden-hour', 'Golden hour'], ['spotlight', 'Spotlight']];
  const ORB_LEVELS = [['off', 'Off'], ['few', 'A few'], ['many', 'Lots']];
  /* small decorations a texture or desk adds to a module: [class] */
  const DECO = { 'manila-folder': 'tab', 'legal-pad': 'bind', leather: 'stitch', 'brass-plate': 'riv', 'cork-board': 'pin', blueprint: 'corner', 'sticky-note': 'curl' };
  const DESK_DECO = { 'paper-desk': ['tape', 'clip', 'tape', 'clip'], 'cork-wall': ['pin'] };

  /* ---------- CSS ---------- */
  let css = '.pd-desk,.pd-light,.pd-orbs,.pd-vig{position:fixed;inset:0;pointer-events:none}.pd-desk{z-index:0;overflow:hidden}.pd-desk svg{width:100%;height:100%;display:block}.pd-light{z-index:0;mix-blend-mode:screen;width:100%;height:100%}.pd-vig{z-index:0;background:radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,.6) 100%)}.pd-orbs{z-index:4;width:100%;height:100%}'
    + '.pv-sec[class*=tx-] h6{color:var(--hd)}.pv-sec[class*=tx-]{color:var(--ink)}'
    + '.pv-sec[class*=tx-] .pv-name,.pv-sec[class*=tx-] .pv-kv b,.pv-sec[class*=tx-] .pv-post p,.pv-sec[class*=tx-] .pv-srv b,.pv-sec[class*=tx-] .pv-song .ttl,.pv-sec[class*=tx-] .pv-link .t{color:var(--ink)}'
    + '.pv-sec[class*=tx-] .pv-tag,.pv-sec[class*=tx-] .pv-bio,.pv-sec[class*=tx-] .pv-kv span,.pv-sec[class*=tx-] .pv-post .m,.pv-sec[class*=tx-] .pv-song .sub,.pv-sec[class*=tx-] .pv-srv small,.pv-sec[class*=tx-] .pv-empty,.pv-sec[class*=tx-] .pv-note,.pv-sec[class*=tx-] .pv-link .t small,.pv-sec[class*=tx-] .pv-kv b small{color:var(--mut)}'
    + '.pv-sec[class*=tx-] .pv-kv div,.pv-sec[class*=tx-] .pv-post,.pv-sec[class*=tx-] .pv-link{background:var(--soft)}.pv-sec[class*=tx-] .pv-post{border-left-color:var(--hd)}.pv-sec[class*=tx-] .pv-post .m i,.pv-sec[class*=tx-] .pv-tier{color:var(--hd)}.pv-sec[class*=tx-] .pv-tier{background:var(--soft)}'
    + '.pv-sec[class*=tx-] .pv-ava{border-color:var(--hd)}.pv-sec[class*=tx-] .pv-bars i{background:var(--hd)}.pv-sec[class*=tx-] .pv-btn{color:var(--ink);border-color:var(--mut)}'
    + '.pv-sec[class*=tx-]{-webkit-backdrop-filter:none;backdrop-filter:none;position:relative}'
    + '.pd-sw{display:block;height:38px;border-radius:6px;position:relative}.pd-sw span{position:absolute;left:0;right:0;bottom:0;padding:2px 4px;font:800 .5rem system-ui,sans-serif;color:var(--ink);background:var(--soft);border-radius:0 0 6px 6px;text-align:center}';
  /* real surfaces: a generated relief (SVG noise lit like a light raking across the material) printed over each texture, so
   * paper has fibres, wood has grain, leather is pebbled, steel is brushed, concrete is pitted and marble is veined */
  const svgUri = (inner) => 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="f" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">' + inner + '</filter><rect width="100%" height="100%" filter="url(#f)"/></svg>') + '")';
  const turb = (bf, oct, seed, type) => '<feTurbulence type="' + (type || 'fractalNoise') + '" baseFrequency="' + bf + '" numOctaves="' + oct + '" seed="' + seed + '" stitchTiles="stitch" result="n"/>';
  const lit = (surf, elev, az, col) => '<feDiffuseLighting in="n" surfaceScale="' + surf + '" diffuseConstant="1" lighting-color="' + (col || '#fff') + '"><feDistantLight azimuth="' + (az || 225) + '" elevation="' + elev + '"/></feDiffuseLighting>';
  const shine = (surf, elev, exp) => '<feSpecularLighting in="n" surfaceScale="' + surf + '" specularConstant="1.1" specularExponent="' + exp + '" lighting-color="#fff"><feDistantLight azimuth="225" elevation="' + elev + '"/></feSpecularLighting>';
  const veins = (bf, seed, r, g, b, k) => turb(bf, 5, seed, 'turbulence') + '<feColorMatrix type="matrix" values="0 0 0 0 ' + r + ' 0 0 0 0 ' + g + ' 0 0 0 0 ' + b + ' ' + (-k) + ' 0 0 0 ' + (k * 0.1) + '"/>';
  /* [filter, blend, opacity] */
  const paperFibre = (seed, op) => [turb('0.045 0.05', 5, seed) + lit(1.6, 62, 225), 'multiply', op || 0.5];
  const GRAIN = {
    'legal-pad': paperFibre(3, 0.42), 'graph-paper': paperFibre(5, 0.35), 'manila-folder': paperFibre(8, 0.6), 'index-card': paperFibre(11, 0.4),
    'kraft-paper': [turb('0.03 0.06', 6, 2) + lit(2.4, 58, 225), 'multiply', 0.75], 'newsprint': [turb('0.06 0.03', 5, 6) + lit(1.8, 60, 225), 'multiply', 0.55],
    'ledger-green': paperFibre(14, 0.4), 'ticker-tape': paperFibre(17, 0.35), 'sticky-note': paperFibre(19, 0.25), 'parchment': [turb('0.02 0.025', 6, 21) + lit(2.8, 52, 225), 'multiply', 0.7],
    'blueprint': [turb('0.7', 2, 4) + lit(0.6, 40, 225), 'soft-light', 0.5],
    'carbon-fiber': [turb('0.5', 2, 9) + lit(0.8, 32, 225), 'overlay', 0.35],
    'brushed-steel': [turb('0.0015 0.8', 3, 3) + lit(1.4, 34, 200), 'overlay', 0.85],
    'brass-plate': [turb('0.002 0.9', 3, 6) + lit(1.6, 34, 200), 'overlay', 0.8],
    'leather': [turb('0.32', 3, 12) + lit(2.4, 30, 225), 'overlay', 0.7],
    'walnut': [turb('0.006 0.2', 5, 4) + lit(2.6, 31, 190), 'overlay', 0.9],
    'oak': [turb('0.008 0.14', 5, 7) + lit(2.6, 33, 190), 'overlay', 0.85],
    'marble': [veins('0.005 0.008', 15, 0.2, 0.24, 0.33, 9), 'multiply', 1],
    'green-felt': [turb('0.9', 2, 5) + lit(1.1, 32, 225), 'overlay', 0.8],
    'cork-board': [turb('0.07', 4, 13) + lit(2.2, 31, 225), 'overlay', 0.55],
    'crt-terminal': [turb('0.9 0.5', 2, 23) + lit(0.6, 33, 225), 'overlay', 0.3],
    'concrete': [turb('0.085', 5, 16) + lit(2.4, 38, 225), 'multiply', 0.6],
    'slate': [turb('0.012 0.05', 5, 18) + lit(2.8, 30, 225), 'overlay', 0.85],
    'frosted-glass': [turb('0.8', 2, 20) + lit(0.5, 45, 225), 'soft-light', 0.55]
  };
  for (const t of TEX) {
    const sel = '.pv-sec.tx-' + t[0] + '.tx-' + t[0] + ',.pd-sw.tx-' + t[0] + '.tx-' + t[0];
    const dark = ['#f', '#e', '#6', '#a'].indexOf(t[2].slice(0, 2)) >= 0 || t[2] === 'var(--acc)';
    css += sel + '{--ink:' + t[2] + ';--mut:' + t[3] + ';--hd:' + t[4] + ';--soft:' + (dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)') + ';' + t[5] + '}';
    const g = GRAIN[t[0]];
    if (g) css += '.pv-sec.tx-' + t[0] + '.tx-' + t[0] + ':before,.pd-sw.tx-' + t[0] + '.tx-' + t[0] + ':before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:' + svgUri(g[0]) + ';mix-blend-mode:' + g[1] + ';opacity:' + g[2] + '}';
  }
  css += '.pv-sec[class*=tx-]{isolation:isolate}.pd-sw[class*=tx-]{overflow:hidden}';
  css += '.pd-d{position:absolute;pointer-events:none;display:block}'
    + '.pd-tab{left:20px;top:-15px;width:92px;height:16px;background:linear-gradient(180deg,#e8cc92,#dcb870);border:1px solid #b8914a;border-bottom:0;border-radius:7px 7px 0 0}'
    + '.pd-bind{left:0;right:0;top:0;height:11px;background:linear-gradient(180deg,#d8c04a,#b99b2c);border-bottom:1px solid #8c7418;border-radius:2px 2px 0 0;box-shadow:0 2px 3px rgba(0,0,0,.25)}'
    + '.pd-stitch{inset:7px;border:2px dashed rgba(226,184,105,.8);border-radius:7px}'
    + '.pd-riv{inset:0;background:radial-gradient(circle at 11px 11px,#f6e3a1 1px,#8d6a1c 3px,transparent 4.5px),radial-gradient(circle at calc(100% - 11px) 11px,#f6e3a1 1px,#8d6a1c 3px,transparent 4.5px),radial-gradient(circle at 11px calc(100% - 11px),#f6e3a1 1px,#8d6a1c 3px,transparent 4.5px),radial-gradient(circle at calc(100% - 11px) calc(100% - 11px),#f6e3a1 1px,#8d6a1c 3px,transparent 4.5px)}'
    + '.pd-pin{left:50%;top:-7px;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ff9a9a,#d62d2d 55%,#7a1010);box-shadow:0 5px 5px rgba(0,0,0,.45)}'
    + '.pd-corner{inset:8px;background:linear-gradient(#7fe0ff,#7fe0ff) 0 0/16px 1px no-repeat,linear-gradient(#7fe0ff,#7fe0ff) 0 0/1px 16px no-repeat,linear-gradient(#7fe0ff,#7fe0ff) 100% 0/16px 1px no-repeat,linear-gradient(#7fe0ff,#7fe0ff) 100% 0/1px 16px no-repeat,linear-gradient(#7fe0ff,#7fe0ff) 0 100%/16px 1px no-repeat,linear-gradient(#7fe0ff,#7fe0ff) 0 100%/1px 16px no-repeat,linear-gradient(#7fe0ff,#7fe0ff) 100% 100%/16px 1px no-repeat,linear-gradient(#7fe0ff,#7fe0ff) 100% 100%/1px 16px no-repeat;opacity:.8}'
    + '.pd-curl{right:0;bottom:0;width:26px;height:26px;background:linear-gradient(135deg,transparent 50%,rgba(0,0,0,.12) 50%,rgba(255,255,255,.55));border-radius:0 0 16px 0}'
    + '.pd-tape{left:50%;top:-11px;width:84px;height:24px;margin-left:-42px;transform:rotate(-3deg);background:linear-gradient(180deg,rgba(255,255,255,.55),rgba(235,228,200,.5));box-shadow:0 1px 3px rgba(0,0,0,.3);border-left:2px dotted rgba(0,0,0,.12);border-right:2px dotted rgba(0,0,0,.12)}'
    + '.pd-clip{left:18px;top:-12px;width:20px;height:46px;border:3px solid #9aa3ab;border-radius:10px;box-shadow:1px 2px 2px rgba(0,0,0,.4)}.pd-clip:after{content:"";position:absolute;left:3px;top:6px;width:8px;height:38px;border:3px solid #b9c1c8;border-radius:8px}'
    + '.dk-paper-desk .pv-sec:nth-child(3n+1){transform:rotate(-1.3deg)}.dk-paper-desk .pv-sec:nth-child(3n+2){transform:rotate(1deg)}.dk-paper-desk .pv-sec:nth-child(3n){transform:rotate(-.4deg)}'
    + '.dk-cork-wall .pv-sec:nth-child(3n+1){transform:rotate(1.6deg)}.dk-cork-wall .pv-sec:nth-child(3n+2){transform:rotate(-1.2deg)}.dk-cork-wall .pv-sec:nth-child(3n){transform:rotate(.6deg)}'
    + '.dk-nyse-floor .pv-sec,.dk-steel-trader .pv-sec{border-radius:6px}'
    + '.pv-sec.orb{padding:10px 10px 6px;overflow:visible}.pv-sec.orb{background:transparent;border-color:transparent;box-shadow:none}'
    + '@media(min-width:900px){.pv-sec.orb{grid-area:orb}}'
    /* modules that move with the music: each listens to one part of the sound (kick, bass, vocal, snare, hi-hats) */
    + '.pv-sec[data-rx]{will-change:scale,translate,rotate}.pd-rx{inset:-1px;border-radius:inherit;opacity:calc(var(--rx,0) * .9);box-shadow:0 0 calc(10px + var(--rx,0) * 26px) 2px var(--rxc,var(--acc,#00c47d)),inset 0 0 calc(var(--rx,0) * 18px) var(--rxc,var(--acc,#00c47d));z-index:3}'
    + '.pv-sec[data-rx=kick]{scale:calc(1 + var(--rx,0) * .034)}.pv-sec[data-rx=bass]{translate:0 calc(var(--rx,0) * -4px);scale:calc(1 + var(--rx,0) * .01)}.pv-sec[data-rx=vocal]{scale:calc(1 + var(--rx,0) * .014)}.pv-sec[data-rx=vocal] .pd-rx{--rxc:var(--acc2,#6c8cff)}'
    + '.pv-sec[data-rx=snare]{rotate:calc(var(--rx,0) * .45deg);scale:calc(1 + var(--rx,0) * .016)}.pv-sec[data-rx=snare] .pd-rx{--rxc:#ffffff}.pv-sec[data-rx=hats]{translate:calc(var(--rx,0) * 2px) 0;scale:calc(1 + var(--rx,0) * .008)}.pv-sec[data-rx=hats] .pd-rx{--rxc:#ffe9a6}'
    /* the 3D gallery */
    + '.pd-orbit{position:relative;height:340px;perspective:1100px;overflow:hidden;cursor:grab;touch-action:pan-y;-webkit-user-select:none;user-select:none}.pd-orbit.drag{cursor:grabbing}'
    + '.pd-stage{position:absolute;inset:0;transform-style:preserve-3d}'
    + '.pd-it{position:absolute;left:50%;top:50%;width:var(--w,132px);height:var(--w,132px);margin:calc(var(--w,132px) / -2) 0 0 calc(var(--w,132px) / -2);padding:0;border:2px solid rgba(255,255,255,.55);border-radius:14px;background:#0b1424;cursor:pointer;overflow:hidden;box-shadow:0 12px 26px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.4);will-change:transform,opacity;transition:border-color .15s}'
    + '.pd-it img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;-webkit-user-drag:none}.pd-it:hover{border-color:var(--acc,#00c47d)}'
    + '.pd-it span{position:absolute;left:0;right:0;bottom:0;padding:14px 6px 5px;background:linear-gradient(transparent,rgba(0,0,0,.8));color:#fff;font:700 .6rem system-ui,sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.pd-it.link:after{content:"↗";position:absolute;right:5px;top:4px;width:18px;height:18px;border-radius:50%;background:var(--acc,#00c47d);color:#04140d;font:900 .7rem/18px system-ui,sans-serif;text-align:center}'
    + '.pd-hint{position:absolute;left:0;right:0;bottom:2px;text-align:center;font:700 .54rem ui-monospace,monospace;letter-spacing:.1em;color:#7f95a1;pointer-events:none}'
    + '@media(max-width:640px){.pd-orbit{height:270px}.pd-it{--w:96px}}'
    /* editor */
    + '.pd-sw.none{background:#0c1821;--ink:#cfe3ea;--soft:rgba(255,255,255,.06);border:1px solid #23404d}.pd-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.pd-grid button{border:1px solid #23404d;border-radius:8px;background:#0c1821;color:#cfe3ea;padding:4px;cursor:pointer;font:700 .56rem system-ui,sans-serif}.pd-grid button.on{border-color:var(--acc,#00c47d);color:#fff;background:#0e1f1a}.pd-grid .pd-sw{margin-bottom:3px}'
    + '.pd-mod{display:grid;grid-template-columns:62px 1fr 1fr;gap:5px;margin-top:5px;align-items:center}.pd-mod b{font:800 .58rem system-ui,sans-serif;color:#7ef0bd}.pd-mod select{min-width:0;border:1px solid #23404d;border-radius:6px;background:#0c1821;color:#cfe3ea;padding:5px 4px;font:700 .58rem system-ui,sans-serif}'
    + '.pd-orow{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding:7px;border:1px solid #1d3744;border-radius:8px;background:#0b141c}.pd-orow .r{display:flex;gap:5px;align-items:center}.pd-orow .r input{flex:1;min-width:0}.pd-orow b{font:800 .56rem ui-monospace,monospace;color:#7ef0bd;flex:none}.pd-orow button{border:1px solid #3a2a2a;border-radius:6px;background:#1a0e0e;color:#ff9f9f;padding:3px 7px;cursor:pointer;font:800 .6rem system-ui}';
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  /* ---------- the desk scenes (SVG, 1600 x 900, cropped to fill) ---------- */
  const f1 = (n) => String(Math.round(n * 10) / 10);
  const rect = (x, y, w, h, fill, extra) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '" ' + (extra || '') + '/>';
  const paper = (x, y, w, h, rot, lines, tint) => {
    let s = '<g transform="rotate(' + rot + ' ' + (x + w / 2) + ' ' + (y + h / 2) + ')"><rect x="' + (x + 5) + '" y="' + (y + 7) + '" width="' + w + '" height="' + h + '" fill="rgba(0,0,0,.35)" filter="url(#blur6)"/><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + (tint || '#f4f1e6') + '" stroke="rgba(0,0,0,.18)"/>';
    for (let i = 0; i < lines; i++) { const ly = y + 22 + i * 15; if (ly > y + h - 10) break; s += '<line x1="' + (x + 14) + '" y1="' + ly + '" x2="' + (x + w - 14 - ((i * 37) % 60)) + '" y2="' + ly + '" stroke="' + (i % 4 === 3 ? 'rgba(30,60,120,.5)' : 'rgba(40,40,40,.28)') + '" stroke-width="2"/>'; }
    return s + '</g>';
  };
  const cup = (x, y) => '<ellipse cx="' + (x + 6) + '" cy="' + (y + 52) + '" rx="46" ry="12" fill="rgba(0,0,0,.4)" filter="url(#blur6)"/><path d="M' + (x - 34) + ' ' + y + ' h68 v40 q0 22 -34 22 q-34 0 -34 -22z" fill="#f2efe6" stroke="#cfc8b4"/><ellipse cx="' + x + '" cy="' + y + '" rx="34" ry="9" fill="#3a2214"/><path d="M' + (x + 34) + ' ' + (y + 8) + ' q26 4 18 24 q-6 10 -22 8" fill="none" stroke="#e2dccb" stroke-width="8"/><path d="M' + (x - 8) + ' ' + (y - 14) + ' q-10 -22 4 -36 M' + (x + 8) + ' ' + (y - 12) + ' q10 -22 -4 -40" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="4" stroke-linecap="round"><animate attributeName="opacity" values=".15;.45;.15" dur="4s" repeatCount="indefinite"/></path>';
  const lamp = (x, y, shade) => '<ellipse cx="' + x + '" cy="' + (y + 150) + '" rx="64" ry="14" fill="rgba(0,0,0,.45)"/><ellipse cx="' + x + '" cy="' + (y + 140) + '" rx="54" ry="12" fill="#2a2d31"/><path d="M' + x + ' ' + (y + 140) + ' L' + (x - 40) + ' ' + (y + 40) + ' L' + (x + 30) + ' ' + (y - 10) + '" fill="none" stroke="#9aa3ab" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M' + (x + 4) + ' ' + (y - 24) + ' L' + (x + 78) + ' ' + (y + 8) + ' L' + (x + 38) + ' ' + (y + 64) + ' L' + (x - 22) + ' ' + (y + 6) + 'z" fill="' + (shade || '#1f6b4a') + '" stroke="rgba(0,0,0,.4)"/><ellipse cx="' + (x + 28) + '" cy="' + (y + 52) + '" rx="26" ry="10" fill="rgba(255,226,160,.85)"><animate attributeName="opacity" values=".7;.95;.8;1" dur="3s" repeatCount="indefinite"/></ellipse>';
  const keyboard = (x, y, w) => { let s = '<g transform="translate(' + x + ' ' + y + ')"><rect x="6" y="9" width="' + w + '" height="96" rx="9" fill="rgba(0,0,0,.4)" filter="url(#blur6)"/><rect width="' + w + '" height="92" rx="8" fill="#15181d" stroke="#2c3138"/>'; for (let r = 0; r < 4; r++) for (let c = 0; c < Math.floor((w - 24) / 26); c++) s += '<rect x="' + (12 + c * 26) + '" y="' + (10 + r * 20) + '" width="21" height="15" rx="3" fill="#232830" stroke="#303743"/>'; return s + '</g>'; };
  const pin = (x, y, col) => '<circle cx="' + (x + 3) + '" cy="' + (y + 5) + '" r="8" fill="rgba(0,0,0,.4)"/><circle cx="' + x + '" cy="' + y + '" r="8" fill="' + col + '"/><circle cx="' + (x - 2) + '" cy="' + (y - 2) + '" r="3" fill="rgba(255,255,255,.7)"/>';
  const pen = (x, y, rot, col) => '<g transform="rotate(' + rot + ' ' + x + ' ' + y + ')"><rect x="' + x + '" y="' + y + '" width="150" height="9" rx="4" fill="' + col + '"/><rect x="' + (x + 150) + '" y="' + (y + 1) + '" width="20" height="7" fill="#d8d8d0"/><polygon points="' + (x + 170) + ',' + (y + 1) + ' ' + (x + 186) + ',' + (y + 4.5) + ' ' + (x + 170) + ',' + (y + 8) + '" fill="#2a2a2a"/></g>';
  const grain = (fill, a, b) => {
    let s = '<rect width="1600" height="900" fill="' + fill + '"/>';
    for (let i = 0; i < 70; i++) s += '<path d="M0 ' + (i * 13 + (i % 5) * 3) + ' C400 ' + (i * 13 - 14 + (i % 7) * 4) + ' 1000 ' + (i * 13 + 16 - (i % 3) * 5) + ' 1600 ' + (i * 13 + (i % 4) * 2) + '" fill="none" stroke="' + (i % 3 ? a : b) + '" stroke-width="' + (1 + (i % 3)) + '"/>';
    return s;
  };
  const defs = '<defs><filter id="blur6"><feGaussianBlur stdDeviation="6"/></filter><filter id="blur24"><feGaussianBlur stdDeviation="24"/></filter><linearGradient id="deskTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.08)"/><stop offset="1" stop-color="rgba(0,0,0,.35)"/></linearGradient><radialGradient id="warm" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="rgba(255,200,120,.55)"/><stop offset="1" stop-color="rgba(255,200,120,0)"/></radialGradient></defs>';
  function monitor(x, y, w, h, seed, up) {
    let s = '<rect x="' + (x - 8) + '" y="' + (y - 8) + '" width="' + (w + 16) + '" height="' + (h + 16) + '" rx="10" fill="#0a0d12" stroke="#222a35"/><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="#02070d"/><rect x="' + (x - 20) + '" y="' + (y - 20) + '" width="' + (w + 40) + '" height="' + (h + 40) + '" fill="rgba(80,220,160,.10)" filter="url(#blur24)"/>';
    for (let g = 1; g < 4; g++) s += '<line x1="' + x + '" y1="' + (y + g * h / 4) + '" x2="' + (x + w) + '" y2="' + (y + g * h / 4) + '" stroke="rgba(120,160,200,.12)"/>';
    let px = x + 8, py = y + h * 0.6, pts = '';
    for (let i = 0; i < 26; i++) { py += (((seed * 31 + i * 17) % 23) - (up ? 9 : 12)) * h / 220; py = Math.max(y + 10, Math.min(y + h - 10, py)); pts += f1(px) + ',' + f1(py) + ' '; px += (w - 16) / 25; }
    s += '<polyline points="' + pts + '" fill="none" stroke="' + (up ? '#35e6a0' : '#ff6b7f') + '" stroke-width="3" stroke-linejoin="round"/>';
    for (let i = 0; i < 9; i++) { const cx = x + 20 + i * ((w - 40) / 8), ch = 10 + ((seed + i * 13) % 26), cy = y + h - 24 - ch - ((i * 7) % 12), col = (seed + i) % 3 ? '#35e6a0' : '#ff6b7f'; s += '<rect x="' + (cx - 3) + '" y="' + cy + '" width="6" height="' + ch + '" fill="' + col + '" opacity=".55"/>'; }
    return s + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="none" stroke="rgba(160,255,220,.18)"><animate attributeName="stroke-opacity" values=".1;.35;.1" dur="' + (3 + seed % 3) + 's" repeatCount="indefinite"/></rect>';
  }
  const deskSvg = (id) => {
    let b = '';
    if (id === 'nyse-floor') {
      b += rect(0, 0, 1600, 900, '#060a12');
      b += '<rect width="1600" height="520" fill="#0a1220"/>';
      for (let i = 0; i < 5; i++) b += monitor(70 + i * 305, 60 + (i % 2) * 14, 250, 170, i * 7 + 3, i % 2 === 0);
      b += '<rect y="318" width="1600" height="46" fill="#02050a" stroke="#1d2a3a"/><g clip-path="url(#tk)"><clipPath id="tk"><rect y="318" width="1600" height="46"/></clipPath><g><text y="351" font-family="monospace" font-size="26" font-weight="700" fill="#35e6a0">SPY ▲   QQQ ▲   DIA ▼   IWM ▲   AAPL ▲   MSFT ▲   NVDA ▲   TSLA ▼   AMZN ▲   META ▼   GOOGL ▲   AMD ▲   JPM ▼   XLE ▲   GLD ▲   VIX ▼   SPY ▲   QQQ ▲   DIA ▼   IWM ▲   AAPL ▲   MSFT ▲   NVDA ▲   TSLA ▼   AMZN ▲   META ▼   <animateTransform attributeName="transform" type="translate" from="0 0" to="-1500 0" dur="46s" repeatCount="indefinite"/></text></g></g>';
      b += '<polygon points="0,520 1600,520 1600,900 0,900" fill="#24160d"/>' + '<polygon points="0,520 1600,520 1600,900 0,900" fill="url(#deskTop)"/>';
      for (let i = 0; i < 26; i++) b += '<path d="M0 ' + (540 + i * 14) + ' C500 ' + (532 + i * 14) + ' 1100 ' + (548 + i * 14) + ' 1600 ' + (540 + i * 14) + '" fill="none" stroke="rgba(0,0,0,' + (0.18 + (i % 3) * 0.06) + ')" stroke-width="2"/>';
      b += '<rect y="516" width="1600" height="8" fill="#3a2414"/><rect y="516" width="1600" height="2" fill="rgba(255,220,170,.35)"/>';
      b += paper(70, 640, 250, 180, -7, 10) + paper(110, 660, 250, 180, 4, 10, '#ece8d8') + keyboard(560, 760, 460) + cup(1180, 700) + lamp(1440, 560, '#16543a') + pen(360, 800, -10, '#1a3a8a') + pen(380, 830, 8, '#8a1a1a');
      b += '<ellipse cx="1440" cy="640" rx="190" ry="120" fill="url(#warm)"/>';
    } else if (id === 'paper-desk') {
      b += grain('#b98b57', 'rgba(110,70,30,.35)', 'rgba(255,255,255,.12)');
      b += '<rect width="1600" height="900" fill="url(#deskTop)"/>';
      const sheets = [[40, 60, 300, 390, -9, 22, '#f4f1e6'], [1230, 40, 310, 400, 7, 22, '#fff7b0'], [820, 580, 360, 300, -4, 18, '#e9f3ea'], [90, 520, 330, 330, 6, 20, '#f4f1e6'], [1290, 520, 280, 360, -8, 18, '#efe9d6'], [520, 40, 260, 200, 3, 10, '#f4f1e6']];
      for (const s of sheets) b += paper(s[0], s[1], s[2], s[3], s[4], s[5], s[6]);
      b += '<circle cx="1100" cy="470" r="46" fill="none" stroke="rgba(60,30,10,.35)" stroke-width="6"/><circle cx="1100" cy="470" r="40" fill="none" stroke="rgba(60,30,10,.2)" stroke-width="3"/>';
      b += '<g transform="translate(560 760) rotate(-6)"><circle cx="0" cy="0" r="30" fill="none" stroke="#222" stroke-width="5"/><circle cx="90" cy="0" r="30" fill="none" stroke="#222" stroke-width="5"/><path d="M30 -4 q30 -14 30 0" fill="none" stroke="#222" stroke-width="5"/><circle cx="0" cy="0" r="27" fill="rgba(180,220,255,.18)"/><circle cx="90" cy="0" r="27" fill="rgba(180,220,255,.18)"/></g>';
      b += pen(470, 300, 22, '#1a3a8a') + pen(960, 80, -14, '#222222') + pen(700, 840, 4, '#8a1a1a');
      b += '<g transform="translate(1180 740)"><rect x="6" y="9" width="170" height="220" rx="14" fill="rgba(0,0,0,.4)" filter="url(#blur6)"/><rect width="170" height="220" rx="12" fill="#2b2f36" stroke="#3d4450"/><rect x="14" y="14" width="142" height="44" rx="5" fill="#9fc9a4"/>';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) b += '<rect x="' + (14 + c * 36) + '" y="' + (74 + r * 36) + '" width="30" height="28" rx="5" fill="' + (c === 3 ? '#d98a2b' : '#4a515c') + '"/>';
      b += '</g>' + cup(330, 470);
    } else if (id === 'walnut-office') {
      b += grain('#46281a', 'rgba(0,0,0,.35)', 'rgba(255,200,140,.10)');
      b += '<rect width="1600" height="900" fill="url(#deskTop)"/>';
      b += '<rect x="262" y="212" width="1090" height="590" rx="14" fill="rgba(0,0,0,.5)" filter="url(#blur24)"/><rect x="250" y="200" width="1090" height="590" rx="10" fill="#1d1511" stroke="#0c0806" stroke-width="3"/><rect x="262" y="212" width="1066" height="566" rx="6" fill="none" stroke="rgba(226,184,105,.55)" stroke-width="2" stroke-dasharray="9 7"/>';
      b += lamp(1460, 120, '#1f6b4a') + '<ellipse cx="1420" cy="260" rx="230" ry="150" fill="url(#warm)"/>';
      b += '<rect x="70" y="620" width="40" height="150" rx="8" fill="#2b2f36"/><rect x="118" y="660" width="40" height="110" rx="8" fill="#3a2a1a"/>' + pen(78, 610, -78, '#c9a23a') + pen(120, 650, -84, '#1a1a1a') + pen(150, 650, -70, '#8a1a1a');
      b += '<g transform="translate(560 800)"><rect x="6" y="9" width="520" height="70" rx="6" fill="rgba(0,0,0,.45)" filter="url(#blur6)"/><rect width="520" height="70" rx="6" fill="#c9a23a" stroke="#7d5a14"/><rect x="8" y="8" width="504" height="54" rx="3" fill="none" stroke="rgba(90,60,10,.5)"/><text x="260" y="46" font-family="Georgia,serif" font-size="30" font-weight="700" text-anchor="middle" fill="#3a2406">PORTFOLIO MANAGER</text></g>';
      b += paper(1230, 640, 280, 190, 8, 9) + paper(1250, 660, 280, 190, -3, 9, '#e9e4d2') + cup(150, 300);
    } else if (id === 'steel-trader') {
      b += '<rect width="1600" height="900" fill="#7a8189"/>';
      for (let i = 0; i < 160; i++) b += '<line x1="0" y1="' + (i * 5.6) + '" x2="1600" y2="' + (i * 5.6 + (i % 3)) + '" stroke="' + (i % 2 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)') + '"/>';
      b += '<rect width="1600" height="900" fill="url(#deskTop)"/><rect width="1600" height="900" fill="rgba(160,200,255,.05)"/>';
      for (let i = 0; i < 4; i++) b += monitor(120 + i * 380, 70 + (i % 2) * 22, 300, 190, i * 11 + 5, i % 3 !== 1);
      b += '<path d="M60 900 C200 760 400 840 520 700 S900 640 1040 760" fill="none" stroke="#1a1d22" stroke-width="12" stroke-linecap="round"/><path d="M1540 900 C1400 780 1240 820 1160 700" fill="none" stroke="#1a1d22" stroke-width="9" stroke-linecap="round"/>';
      b += keyboard(520, 770, 520) + '<g transform="translate(1180 770)"><rect width="190" height="90" rx="14" fill="#15181d" stroke="#2c3138"/><circle cx="60" cy="45" r="26" fill="#232830"/><circle cx="130" cy="45" r="26" fill="#232830"/></g><g transform="translate(120 760)"><path d="M0 70 q0 -70 80 -70 q80 0 80 70" fill="none" stroke="#1a1d22" stroke-width="14"/><rect x="-14" y="56" width="34" height="56" rx="12" fill="#232830"/><rect x="140" y="56" width="34" height="56" rx="12" fill="#232830"/></g>' + cup(1450, 720);
    } else if (id === 'cork-wall') {
      b += '<rect width="1600" height="900" fill="#b8854c"/>';
      for (let i = 0; i < 900; i++) { const x = (i * 193) % 1600, y = (i * 107) % 900; b += '<circle cx="' + x + '" cy="' + y + '" r="' + (1 + (i % 4)) + '" fill="' + (i % 3 ? 'rgba(70,35,8,.35)' : 'rgba(255,228,176,.3)') + '"/>'; }
      b += '<rect x="14" y="14" width="1572" height="872" rx="6" fill="none" stroke="#6b4220" stroke-width="28"/><rect x="14" y="14" width="1572" height="872" rx="6" fill="none" stroke="rgba(255,220,170,.3)" stroke-width="2"/>';
      const notes = [[60, 70, 230, 170, -6, '#fff08a'], [1300, 90, 230, 170, 5, '#ffb3c1'], [70, 640, 240, 180, 4, '#a8e6cf'], [1290, 600, 250, 190, -5, '#f4f1e6'], [700, 40, 210, 130, 2, '#b8d8ff'], [640, 730, 260, 130, -3, '#fff08a']];
      for (const n of notes) b += paper(n[0], n[1], n[2], n[3], n[4], 8, n[5]) + pin(n[0] + n[2] / 2, n[1] + 10, '#d62d2d');
      b += '<polyline points="175,80 815,50 1415,100 1415,690 195,650 175,80" fill="none" stroke="rgba(190,30,30,.75)" stroke-width="3"/>' + pin(175, 80, '#2d6bd6') + pin(1415, 100, '#2d6bd6') + pin(195, 650, '#2d6bd6');
    } else if (id === 'leather-blotter') {
      b += grain('#2b1a10', 'rgba(0,0,0,.4)', 'rgba(255,200,140,.07)');
      b += '<rect width="1600" height="900" fill="url(#deskTop)"/>';
      b += '<rect x="196" y="116" width="1220" height="700" rx="22" fill="rgba(0,0,0,.55)" filter="url(#blur24)"/><rect x="180" y="100" width="1220" height="700" rx="18" fill="#10261a" stroke="#06110b" stroke-width="4"/>';
      for (let i = 0; i < 1300; i++) b += '<circle cx="' + (190 + (i * 97) % 1200) + '" cy="' + (110 + (i * 61) % 680) + '" r="1.2" fill="' + (i % 2 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.3)') + '"/>';
      b += '<rect x="198" y="118" width="1184" height="664" rx="12" fill="none" stroke="rgba(226,184,105,.6)" stroke-width="2" stroke-dasharray="10 8"/>';
      b += '<polygon points="180,100 280,100 180,200" fill="#3a2214" stroke="#1d0f07"/><polygon points="1400,100 1300,100 1400,200" fill="#3a2214" stroke="#1d0f07"/><polygon points="180,800 280,800 180,700" fill="#3a2214" stroke="#1d0f07"/><polygon points="1400,800 1300,800 1400,700" fill="#3a2214" stroke="#1d0f07"/>';
      b += lamp(1470, 100, '#1f6b4a') + '<ellipse cx="1430" cy="240" rx="230" ry="150" fill="url(#warm)"/>' + pen(60, 300, 80, '#c9a23a') + paper(30, 560, 120, 280, 3, 14, '#efe9d6') + cup(1490, 700);
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">' + defs + b + '</svg>';
  };

  /* ---------- the running scene: lighting, orbs, gallery ---------- */
  const R = { raf: 0, view: null, light: null, orbs: null, orbit: null, mode: 'off', modes: [], mods: [], ch: null, orbMode: 'off', pulse: null, acc: '#00c47d', acc2: '#6c8cff', motes: [], orbList: [], w: 0, h: 0, ang: 0, spin: 0.18, drag: null, resize: null, reduce: false };
  const rnd = (a, b) => a + Math.random() * (b - a);
  function shade(hex, k) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex)); if (!m) return '#334455';
    const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return 'rgb(' + c(r) + ',' + c(g) + ',' + c(b) + ')';
  }
  function rgba(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex)); if (!m) return 'rgba(255,255,255,' + a + ')';
    const n = parseInt(m[1], 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function motes() { R.motes = []; for (let i = 0; i < 60; i++) R.motes.push({ x: Math.random(), y: Math.random(), z: Math.random(), s: rnd(0.2, 1), p: rnd(0, 6.28) }); }
  const CHN = ['kick', 'bass', 'vocal', 'snare', 'hats'];
  function orbList(mode) {
    R.orbList = []; const n = mode === 'many' ? 14 : mode === 'few' ? 6 : 0;
    for (let i = 0; i < n; i++) R.orbList.push({ a: rnd(0, 6.28), rr: rnd(0.35, 1.05), y: rnd(-1, 1), sp: rnd(0.0012, 0.0045) * (Math.random() < 0.5 ? -1 : 1), bob: rnd(0, 6.28), rad: rnd(14, 46), col: i % 5 === 0 ? '#ffffff' : (i % 2 ? R.acc : R.acc2), c: CHN[i % 5] });
  }
  function drawLight(ctx, w, h, t, p) {
    ctx.clearRect(0, 0, w, h);
    const modes = R.modes; if (!modes.length) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = modes.length > 1 ? 0.78 : 1;
    for (const m of modes) lightOne(ctx, m, w, h, t, p);
    ctx.globalAlpha = 1;
    /* dust floating in the light */
    for (const m of R.motes) {
      m.y -= 0.00006 * (0.4 + m.s) * (1 + p * 3); m.x += Math.sin(t / 2000 + m.p) * 0.00008; if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
      const a = (0.14 + 0.24 * Math.abs(Math.sin(t / 900 + m.p))) * (modes.length === 1 && modes[0] === 'monitor-glow' ? 0.5 : 1);
      ctx.fillStyle = 'rgba(255,245,225,' + a + ')'; ctx.beginPath(); ctx.arc(m.x * w, m.y * h, 0.6 + m.z * 1.6, 0, 6.283); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function lightOne(ctx, mode, w, h, t, p) {
    const acc = R.acc, acc2 = R.acc2, big = Math.max(w, h);
    if (mode === 'desk-lamp') {
      const fl = 0.93 + 0.07 * Math.sin(t / 230) + 0.03 * Math.sin(t / 97), lx = w * 0.84, ly = h * 0.06;
      const g = ctx.createRadialGradient(lx, ly, 8, lx - w * 0.12, ly + h * 0.38, big * 0.8);
      g.addColorStop(0, 'rgba(255,214,140,' + (0.55 * fl + p * 0.25) + ')'); g.addColorStop(0.32, 'rgba(255,170,80,' + (0.17 * fl) + ')'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const c = ctx.createLinearGradient(lx, ly, lx - w * 0.5, h); c.addColorStop(0, 'rgba(255,220,160,' + (0.22 * fl) + ')'); c.addColorStop(1, 'rgba(255,220,160,0)');
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(lx - 20, ly); ctx.lineTo(lx + 40, ly); ctx.lineTo(lx - w * 0.25, h); ctx.lineTo(lx - w * 0.85, h); ctx.closePath(); ctx.fill();
    } else if (mode === 'window-sun') {
      const sh = (t / 9000) % 1;
      for (let i = 0; i < 4; i++) {
        const x0 = w * (0.02 + i * 0.16 + Math.sin(t / 6000 + i) * 0.02), wid = w * (0.07 + 0.01 * i);
        const g = ctx.createLinearGradient(x0, 0, x0 + w * 0.5, h); g.addColorStop(0, 'rgba(255,236,190,' + (0.2 + p * 0.1) + ')'); g.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + wid, 0); ctx.lineTo(x0 + wid + w * 0.55, h); ctx.lineTo(x0 + w * 0.5, h); ctx.closePath(); ctx.fill();
      }
      const g2 = ctx.createRadialGradient(w * 0.05, 0, 10, w * 0.05, 0, big * 0.55); g2.addColorStop(0, 'rgba(255,240,200,' + (0.4 + 0.1 * Math.sin(sh * 6.28)) + ')'); g2.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
    } else if (mode === 'monitor-glow') {
      const g = ctx.createRadialGradient(w * 0.5, h * 1.02, 10, w * 0.5, h * 1.02, big * 0.75); g.addColorStop(0, 'rgba(80,190,255,' + (0.34 + p * 0.3) + ')'); g.addColorStop(0.5, 'rgba(60,120,255,0.1)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const sy = ((t / 14) % (h + 140)) - 70; const s = ctx.createLinearGradient(0, sy - 60, 0, sy + 60); s.addColorStop(0, 'rgba(120,220,255,0)'); s.addColorStop(0.5, 'rgba(120,220,255,0.09)'); s.addColorStop(1, 'rgba(120,220,255,0)'); ctx.fillStyle = s; ctx.fillRect(0, sy - 60, w, 120);
    } else if (mode === 'neon-sweep') {
      for (let k = 0; k < 2; k++) {
        const ang = t / (2600 + k * 900) + k * 3, x = w * (0.5 + 0.42 * Math.cos(ang)), y = h * (0.45 + 0.32 * Math.sin(ang * 1.3));
        const g = ctx.createRadialGradient(x, y, 8, x, y, big * (0.42 + p * 0.12)); const col = k ? acc2 : acc; g.addColorStop(0, rgba(col, 0.5)); g.addColorStop(1, rgba(col, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
    } else if (mode === 'golden-hour') {
      const g = ctx.createLinearGradient(0, h, w, 0); g.addColorStop(0, 'rgba(255,140,60,' + (0.3 + p * 0.1) + ')'); g.addColorStop(0.55, 'rgba(255,190,110,0.1)'); g.addColorStop(1, 'rgba(255,230,180,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 5; i++) { const x = w * (0.78 - i * 0.16), y = h * (0.18 + i * 0.12) + Math.sin(t / 1800 + i) * 6, r = 20 + i * 18; const f = ctx.createRadialGradient(x, y, 0, x, y, r); f.addColorStop(0, 'rgba(255,220,160,' + (0.2 - i * 0.025) + ')'); f.addColorStop(1, 'rgba(255,220,160,0)'); ctx.fillStyle = f; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
      const sun = ctx.createRadialGradient(w * 0.9, h * 0.05, 4, w * 0.9, h * 0.05, big * 0.4); sun.addColorStop(0, 'rgba(255,236,190,0.55)'); sun.addColorStop(1, 'rgba(255,236,190,0)'); ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
    } else if (mode === 'spotlight') {
      const sx = w * (0.5 + 0.28 * Math.sin(t / 4200)), g = ctx.createLinearGradient(sx, 0, sx, h); g.addColorStop(0, 'rgba(255,255,240,' + (0.3 + p * 0.15) + ')'); g.addColorStop(1, 'rgba(255,255,240,0.02)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx - 20, 0); ctx.lineTo(sx + 20, 0); ctx.lineTo(sx + w * 0.22, h); ctx.lineTo(sx - w * 0.22, h); ctx.closePath(); ctx.fill();
      const pool = ctx.createRadialGradient(sx, h * 0.92, 10, sx, h * 0.92, w * 0.25); pool.addColorStop(0, 'rgba(255,255,240,0.28)'); pool.addColorStop(1, 'rgba(255,255,240,0)'); ctx.save(); ctx.translate(0, 0); ctx.fillStyle = pool; ctx.fillRect(0, 0, w, h); ctx.restore();
    }
  }
  function drawOrbs(ctx, w, h, t, p) {
    ctx.clearRect(0, 0, w, h);
    if (!R.orbList.length) return;
    const F = 900, cx = w / 2, cy = h / 2, items = [];
    for (const o of R.orbList) {
      o.a += o.sp * (1 + p * 4);
      const wx = Math.cos(o.a) * o.rr * w * 0.62, wz = Math.sin(o.a) * o.rr * w * 0.62, wy = o.y * h * 0.42 + Math.sin(t / 1700 + o.bob) * 26;
      const s = F / (F + wz + 520);
      const cv = (R.ch && R.ch[o.c]) || 0;
      items.push({ x: cx + wx * s, y: cy + wy * s, r: o.rad * s * (1 + p * 0.3 + cv * 0.55), z: wz, col: o.col, s: s, g: cv });
    }
    items.sort((a, b) => b.z - a.z);
    for (const q of items) {
      const al = Math.max(0.25, Math.min(0.97, 0.35 + q.s * 0.6 + q.g * 0.25));
      ctx.save(); ctx.globalAlpha = al;
      const halo = ctx.createRadialGradient(q.x, q.y, q.r * 0.6, q.x, q.y, q.r * 2.4); halo.addColorStop(0, rgba(q.col, 0.28)); halo.addColorStop(1, rgba(q.col, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(q.x, q.y, q.r * 2.4, 0, 6.283); ctx.fill();
      const g = ctx.createRadialGradient(q.x - q.r * 0.38, q.y - q.r * 0.42, q.r * 0.06, q.x, q.y, q.r);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.18, rgba(q.col, 0.95)); g.addColorStop(0.7, shade(q.col, 0.55)); g.addColorStop(1, shade(q.col, 0.22));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.283); ctx.fill();
      const rim = ctx.createRadialGradient(q.x + q.r * 0.3, q.y + q.r * 0.38, q.r * 0.5, q.x + q.r * 0.3, q.y + q.r * 0.38, q.r * 1.05); rim.addColorStop(0, 'rgba(255,255,255,0)'); rim.addColorStop(1, 'rgba(255,255,255,.28)');
      ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.ellipse(q.x - q.r * 0.34, q.y - q.r * 0.4, q.r * 0.16, q.r * 0.1, -0.7, 0, 6.283); ctx.fill();
      ctx.restore();
    }
  }
  function layOrbit(t) {
    const box = R.orbit; if (!box) return;
    const items = box.querySelectorAll('.pd-it'), n = items.length; if (!n) return;
    const W = box.clientWidth || 600, size = n > 8 ? 108 : 132, Rad = Math.max(150, Math.min(W * 0.42, 150 + n * 26));
    box.style.setProperty('--w', size + 'px');
    for (let i = 0; i < n; i++) {
      const th = (i / n) * 6.2832 + R.ang, cz = Math.cos(th), sx = Math.sin(th);
      const x = sx * Rad * 1.25, z = cz * Rad, y = -cz * 26 + Math.sin(t / 1600 + i) * 4;
      const cv = (R.ch && R.ch[CHN[i % 5]]) || 0;
      const sc = (0.62 + 0.38 * (cz + 1) / 2) * (1 + cv * 0.14);
      const el = items[i];
      el.style.boxShadow = cv > 0.08 ? '0 12px 26px rgba(0,0,0,.55),0 0 ' + Math.round(8 + cv * 26) + 'px ' + R.acc : '';
      el.style.transform = 'translate3d(' + f1(x) + 'px,' + f1(y) + 'px,' + f1(z) + 'px) scale(' + f1(sc * 100) / 100 + ')';
      el.style.opacity = String(f1((0.4 + 0.6 * (cz + 1) / 2) * 100) / 100);
      el.style.zIndex = String(Math.round(cz * 100 + 100));
      el.style.filter = cz < 0 ? 'brightness(' + f1((0.65 + 0.35 * (cz + 1)) * 100) / 100 + ')' : 'none';
    }
  }
  function frame(t) {
    const p = R.pulse ? R.pulse() : { p: 0 }, lvl = p.p || 0;
    R.ch = p.ch || null;
    for (const m of R.mods) m.el.style.setProperty('--rx', R.ch ? String(Math.round(Math.max(0, Math.min(1, R.ch[m.c] || 0)) * 100) / 100) : '0');
    if (R.light) drawLight(R.light.getContext('2d'), R.w, R.h, t, lvl);
    if (R.orbs) drawOrbs(R.orbs.getContext('2d'), R.w, R.h, t, lvl);
    if (R.orbit) { if (!R.drag) R.ang += (R.spin + lvl * 0.5) * 0.017; layOrbit(t); }
    R.raf = requestAnimationFrame(frame);
  }
  function size() {
    R.w = innerWidth; R.h = innerHeight;
    for (const c of [R.light, R.orbs]) if (c) { c.width = R.w; c.height = R.h; }
    if (R.reduce) { const p = { p: 0 }; if (R.light) drawLight(R.light.getContext('2d'), R.w, R.h, 1000, p.p); if (R.orbs) drawOrbs(R.orbs.getContext('2d'), R.w, R.h, 1000, p.p); layOrbit(1000); }
  }
  function stop() {
    if (R.raf) cancelAnimationFrame(R.raf); R.raf = 0;
    if (R.resize) window.removeEventListener('resize', R.resize); R.resize = null;
    R.light = R.orbs = R.orbit = null; R.view = null; R.mods = []; R.modes = []; R.ch = null;
  }
  function openLink(url) { if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ } } }
  function wireOrbit(box) {
    let sx = 0, moved = 0, last = 0, vel = 0, id = null, down = null;
    box.addEventListener('pointerdown', (e) => { down = e.target && e.target.closest ? e.target.closest('.pd-it') : null; id = e.pointerId; sx = e.clientX; last = e.clientX; moved = 0; vel = 0; R.drag = true; box.classList.add('drag'); try { box.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } });
    box.addEventListener('pointermove', (e) => { if (!R.drag || e.pointerId !== id) return; const dx = e.clientX - last; last = e.clientX; moved += Math.abs(dx); vel = dx; R.ang += dx * 0.012; if (R.reduce) layOrbit(1000); });
    const end = (e) => {
      if (e.pointerId !== id) return; R.drag = null; id = null; box.classList.remove('drag');
      R.spin = Math.max(-0.9, Math.min(0.9, vel * 0.07)) || 0.18; if (Math.abs(R.spin) < 0.12) R.spin = R.spin < 0 ? -0.18 : 0.18;
      if (moved < 7 && down && down.dataset.href) openLink(down.dataset.href); down = null;
    };
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  }

  /* the section markup for the gallery; pictures come through the Academy's own origin */
  function orbitHtml(list, token, esc) {
    const items = (list || []).slice(0, 12);
    return '<div class="pd-orbit" data-n="' + items.length + '"><div class="pd-stage">' + items.map((o) => '<button type="button" class="pd-it' + (o.href ? ' link' : '') + '"' + (o.href ? ' data-href="' + esc(o.href) + '"' : '') + ' title="' + esc(o.title || (o.href ? 'Visit link' : '')) + '"><img alt="" draggable="false" src="/academy-activity/profiles/link-image?u=' + encodeURIComponent(o.image) + '&t=' + encodeURIComponent(token) + '">' + (o.title ? '<span>' + esc(o.title) + '</span>' : '') + '</button>').join('') + '</div><div class="pd-hint">DRAG TO SPIN' + (items.some((o) => o.href) ? ' · TAP A PICTURE TO VISIT' : '') + '</div></div>';
  }

  /* apply(view, data, pulse): dress the freshly rendered profile (called after every render) */
  function apply(view, data, pulse) {
    stop();
    const s = data && data.settings || {}, t = s.theme || {};
    const root = view.querySelector('.pv-root'); if (!root) return;
    R.view = view; R.pulse = pulse; R.acc = t.accent || '#00c47d'; R.acc2 = t.accent2 || '#6c8cff';
    R.reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const desk = DESKS.some((d) => d[0] === t.desk) ? t.desk : 'none';
    /* effects stack: the member can have several textures, several lights at once (older single choices still work) */
    const pool = (Array.isArray(t.textures) && t.textures.length ? t.textures : (t.texture && t.texture !== 'none' ? [t.texture] : [])).filter((id) => TEX_IDS.indexOf(id) >= 0);
    const lightList = (Array.isArray(t.lights) && t.lights.length ? t.lights : (t.light && t.light !== 'off' ? [t.light] : [])).filter((id) => id !== 'off' && LIGHTS.some((d) => d[0] === id));
    const orbs = ORB_LEVELS.some((d) => d[0] === t.orbs) ? t.orbs : 'off';
    const byModule = t.moduleTex && typeof t.moduleTex === 'object' ? t.moduleTex : {}, reacts = t.moduleReact && typeof t.moduleReact === 'object' ? t.moduleReact : {};
    const M = window.smlProfileMusic, DEF = (M && M.DEFAULT_REACT) || {};
    root.classList.add('dk-' + desk);
    /* layers: desk scene, light, vignette sit behind the page; orbs fly over it */
    const fx = view.querySelector('.pv-fx');
    if (desk !== 'none') { const d = document.createElement('div'); d.className = 'pd-desk'; d.innerHTML = deskSvg(desk); view.insertBefore(d, view.firstChild); if (fx) fx.style.opacity = '.3'; view.style.background = '#05080e'; }
    if (lightList.length) {
      const c = document.createElement('canvas'); c.className = 'pd-light'; view.insertBefore(c, root); R.light = c; R.modes = lightList; R.mode = lightList[0]; motes();
      const v = document.createElement('div'); v.className = 'pd-vig'; view.insertBefore(v, root);
    } else { R.mode = 'off'; R.modes = []; }
    if (orbs !== 'off') { const c = document.createElement('canvas'); c.className = 'pd-orbs'; view.appendChild(c); R.orbs = c; R.orbMode = orbs; orbList(orbs); }
    /* modules: a texture of their own, else handed out from the chosen textures in turn, else the desk's own mix */
    const secs = root.querySelectorAll('.pv-sec');
    const mix = !pool.length ? (MIX[desk] || null) : null;
    const KEYS = ['head', 'stats', 'server', 'paper', 'song', 'social', 'feed'];
    let k = 0;
    secs.forEach((el, i) => {
      if (el.classList.contains('orb')) return; /* the gallery stays clear so the desk shows behind the pictures */
      const key = KEYS.find((x) => el.classList.contains(x)) || '';
      const own = key && TEX_IDS.indexOf(byModule[key]) >= 0 ? byModule[key] : '';
      const id = own || (pool.length ? pool[k % pool.length] : (mix ? mix[k % mix.length] : ''));
      k += 1;
      if (id) el.classList.add('tx-' + id);
      const kinds = [];
      if (id && DECO[id]) kinds.push(DECO[id]);
      const dd = DESK_DECO[desk]; if (dd) kinds.push(dd[i % dd.length]);
      for (const kd of kinds) { const i2 = document.createElement('i'); i2.className = 'pd-d pd-' + kd; el.appendChild(i2); }
      const want = key ? (reacts[key] || DEF[key] || '') : '';
      if (M && want && want !== 'off') { el.setAttribute('data-rx', want); const g = document.createElement('i'); g.className = 'pd-d pd-rx'; el.appendChild(g); R.mods.push({ el: el, c: want }); }
    });
    /* the 3D gallery */
    const box = root.querySelector('.pd-orbit');
    if (box) { R.orbit = box; wireOrbit(box); R.spin = 0.18; }
    if (R.light || R.orbs || R.orbit || R.mods.length) {
      R.resize = () => size(); window.addEventListener('resize', R.resize); size();
      if (!R.reduce) R.raf = requestAnimationFrame(frame);
    }
  }

  window.smlProfileDesk = { apply, stop, orbitHtml, textures: TEX.map((t) => ({ id: t[0], label: t[1] })), desks: DESKS.map((d) => ({ id: d[0], label: d[1] })), lights: LIGHTS.map((d) => ({ id: d[0], label: d[1] })), orbs: ORB_LEVELS.map((d) => ({ id: d[0], label: d[1] })) };
})();
