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
      'background:linear-gradient(135deg,rgba(255,255,255,.2),rgba(255,255,255,.04) 45%,rgba(255,255,255,.11));-webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4);border:1px solid rgba(255,255,255,.35);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.55)'],
    ['canvas', 'Canvas', '#2b2418', '#5c5036', '#8a3b12',
      'background:repeating-linear-gradient(0deg,rgba(60,40,10,.07) 0,rgba(60,40,10,.07) 1px,transparent 1px,transparent 3px),repeating-linear-gradient(90deg,rgba(60,40,10,.07) 0,rgba(60,40,10,.07) 1px,transparent 1px,transparent 3px),linear-gradient(160deg,#e7ddc5,#d5c8a6);border:0;border-radius:3px;box-shadow:0 12px 26px rgba(0,0,0,.45)'],
    ['linen', 'Linen', '#26262a', '#5b5b63', '#7a2d3a',
      'background:repeating-linear-gradient(0deg,rgba(90,80,60,.07) 0,rgba(90,80,60,.07) 1px,transparent 1px,transparent 4px),repeating-linear-gradient(90deg,rgba(255,255,255,.35) 0,rgba(255,255,255,.35) 1px,transparent 1px,transparent 5px),linear-gradient(180deg,#ece8de,#ddd8cb);border:0;border-radius:5px;box-shadow:0 12px 26px rgba(0,0,0,.4)'],
    ['denim', 'Denim', '#f1f5fb', '#aebdd6', '#ffd479',
      'background:repeating-linear-gradient(45deg,rgba(255,255,255,.07) 0,rgba(255,255,255,.07) 2px,transparent 2px,transparent 4px),repeating-linear-gradient(-45deg,rgba(0,0,0,.1) 0,rgba(0,0,0,.1) 1px,transparent 1px,transparent 3px),linear-gradient(160deg,#35557f,#233c5e);border:0;border-radius:8px;outline:2px dashed rgba(232,193,90,.8);outline-offset:-8px;box-shadow:0 12px 28px rgba(0,0,0,.55)'],
    ['suede', 'Suede', '#fbefdc', '#d8c0a0', '#ffd9a0',
      'background:radial-gradient(rgba(255,255,255,.1) 1px,transparent 1.6px) 0 0/5px 5px,radial-gradient(rgba(0,0,0,.2) 1px,transparent 1.8px) 2px 3px/6px 6px,linear-gradient(160deg,#8a6646,#664a31);border:0;border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.12)'],
    ['granite', 'Granite', '#f4f4f4', '#c4c6c9', '#ffd479',
      'background:radial-gradient(rgba(255,255,255,.4) 1px,transparent 1.8px) 0 0/7px 7px,radial-gradient(rgba(0,0,0,.5) 1.2px,transparent 2px) 3px 2px/9px 9px,radial-gradient(rgba(220,150,150,.3) 1.5px,transparent 2.4px) 5px 6px/13px 13px,linear-gradient(160deg,#74777b,#5c5f63);border:1px solid #484a4d;border-radius:4px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.25)'],
    ['terrazzo', 'Terrazzo', '#22201e', '#5c5750', '#b0452f',
      'background:radial-gradient(circle at 12% 22%,#c96b5a 0 6px,transparent 7px),radial-gradient(circle at 38% 12%,#3b4a5a 0 4px,transparent 5px),radial-gradient(circle at 62% 30%,#d8a24a 0 6px,transparent 7px),radial-gradient(circle at 86% 18%,#6e8f7a 0 5px,transparent 6px),radial-gradient(circle at 24% 62%,#2c2c2c 0 5px,transparent 6px),radial-gradient(circle at 52% 72%,#c96b5a 0 5px,transparent 6px),radial-gradient(circle at 78% 58%,#8aa0b8 0 6px,transparent 7px),radial-gradient(circle at 92% 86%,#d8a24a 0 4px,transparent 5px),radial-gradient(circle at 8% 90%,#6e8f7a 0 6px,transparent 7px),#ece6dc;background-size:150px 130px;border:0;border-radius:6px;box-shadow:0 12px 28px rgba(0,0,0,.45),inset 0 1px 0 #fff'],
    ['copper', 'Copper', '#2a1006', '#5e2e18', '#5a1a08',
      'background:repeating-linear-gradient(90deg,rgba(255,255,255,.1) 0,rgba(255,255,255,.1) 1px,rgba(0,0,0,.07) 1px,rgba(0,0,0,.07) 2px),linear-gradient(135deg,#a9552d,#eaa47c 25%,#b9622f 50%,#f1b28c 72%,#8f4522);border:1px solid #6e3216;border-radius:6px;text-shadow:0 1px 0 rgba(255,220,190,.7);box-shadow:0 12px 26px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,235,215,.8),inset 0 -2px 0 rgba(80,30,6,.4)'],
    ['gold-leaf', 'Gold leaf', '#3a2600', '#6a4a10', '#5a2a00',
      'background:radial-gradient(ellipse at 20% 15%,rgba(255,250,210,.9),transparent 40%),radial-gradient(ellipse at 80% 70%,rgba(255,240,170,.7),transparent 45%),linear-gradient(135deg,#b88a1e,#f3d56c 30%,#c9981f 55%,#f6dd7c 78%,#a77a14);border:1px solid #8a640c;border-radius:6px;text-shadow:0 1px 0 rgba(255,245,190,.7);box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,250,210,.9),inset 0 -2px 0 rgba(110,70,0,.4)'],
    ['rusted-iron', 'Rusted iron', '#fbeee2', '#d4b49c', '#ffd8a8',
      'background:radial-gradient(ellipse at 18% 28%,rgba(190,90,30,.7),transparent 38%),radial-gradient(ellipse at 74% 64%,rgba(160,70,20,.65),transparent 42%),radial-gradient(ellipse at 52% 12%,rgba(210,120,50,.45),transparent 30%),linear-gradient(160deg,#5d4538,#3f2e25);border:2px solid #2a1d16;border-radius:3px;box-shadow:0 12px 28px rgba(0,0,0,.6),inset 0 0 26px rgba(0,0,0,.45)'],
    ['bamboo', 'Bamboo', '#2a2410', '#5f5628', '#6b4a10',
      'background:repeating-linear-gradient(90deg,rgba(90,110,40,.28) 0,rgba(90,110,40,.28) 1px,transparent 1px,transparent 38px,rgba(255,255,255,.25) 38px,rgba(255,255,255,.25) 39px,transparent 39px,transparent 77px),repeating-linear-gradient(0deg,transparent 0,transparent 118px,rgba(90,70,20,.4) 118px,rgba(90,70,20,.4) 121px),linear-gradient(180deg,#dccd8e,#c6b66e);border:1px solid #9a8a46;border-radius:5px;box-shadow:0 12px 26px rgba(0,0,0,.45)'],
    ['chalkboard', 'Chalkboard', '#f4f4ea', '#bcc3b8', '#ffe08a',
      'background:radial-gradient(ellipse at 30% 25%,rgba(255,255,255,.12),transparent 50%),radial-gradient(ellipse at 70% 80%,rgba(255,255,255,.08),transparent 45%),linear-gradient(160deg,#2b3731,#1f2924);border:8px solid #8a6a43;border-radius:4px;box-shadow:0 12px 28px rgba(0,0,0,.6),inset 0 0 24px rgba(0,0,0,.55)'],
    ['pegboard', 'Pegboard', '#2b2310', '#665a36', '#8a3b12',
      'background:radial-gradient(circle,#5a4a28 2.2px,rgba(0,0,0,.25) 3.2px,transparent 3.8px) 0 0/22px 22px,linear-gradient(180deg,#dccda7,#cdbd94);border:0;border-radius:3px;box-shadow:0 12px 26px rgba(0,0,0,.45)'],
    ['velvet', 'Velvet', '#ffe9ee', '#e0a6b4', '#ffd479',
      'background:radial-gradient(ellipse at 28% 18%,rgba(255,130,150,.4),transparent 55%),radial-gradient(ellipse at 80% 90%,rgba(0,0,0,.4),transparent 60%),linear-gradient(160deg,#82143a,#4a0a1e);border:0;border-radius:12px;box-shadow:0 14px 30px rgba(0,0,0,.6),inset 0 0 44px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,170,190,.25)'],
    ['tweed', 'Tweed', '#fff6e8', '#dccbb0', '#ffd479',
      'background:radial-gradient(#d9c9a8 1px,transparent 1.6px) 0 0/5px 5px,radial-gradient(#3a2f26 1px,transparent 1.6px) 2px 3px/6px 6px,radial-gradient(#a8573a 1px,transparent 1.6px) 4px 1px/9px 9px,repeating-linear-gradient(45deg,rgba(255,255,255,.07) 0,rgba(255,255,255,.07) 2px,transparent 2px,transparent 5px),linear-gradient(160deg,#7b6a58,#5e5042);border:0;border-radius:6px;box-shadow:0 12px 26px rgba(0,0,0,.55)'],
    ['cardboard', 'Cardboard', '#2b1a08', '#6b4a22', '#8a3b12',
      'background:repeating-linear-gradient(90deg,rgba(90,55,20,.22) 0,rgba(90,55,20,.22) 2px,transparent 2px,transparent 6px),linear-gradient(180deg,rgba(255,255,255,.14),transparent 40%),linear-gradient(160deg,#c9a06a,#b48850);border:0;border-radius:3px;box-shadow:0 12px 24px rgba(0,0,0,.5)'],
    ['brick', 'Brick wall', '#fbf3ea', '#ddc9b8', '#ffd479',
      'background-color:#a64a32;background-image:BRICKIMG;border:0;border-radius:3px;box-shadow:0 12px 28px rgba(0,0,0,.6),inset 0 0 30px rgba(0,0,0,.35)'],
    ['subway-tile', 'Subway tile', '#1d2330', '#566074', '#1a6b8a',
      'background-color:#f4f6f7;background-image:SUBWAYIMG;border:0;border-radius:4px;box-shadow:0 12px 26px rgba(0,0,0,.45),inset 0 1px 0 #fff'],
    ['croc-leather', 'Croc leather', '#eef3e6', '#a9bba0', '#ffd479',
      'background-color:#243022;background-image:CROCIMG,linear-gradient(160deg,rgba(255,255,255,.1),transparent 50%);border:1px solid #101810;border-radius:10px;box-shadow:0 14px 30px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.1)'],
    ['holographic', 'Holographic foil', '#14142a', '#4b4b72', '#5b2a9a',
      'background:repeating-linear-gradient(115deg,rgba(255,255,255,.18) 0,rgba(255,255,255,.18) 2px,transparent 2px,transparent 9px),linear-gradient(115deg,#ff9ad5,#ffd59a 18%,#b4ff9a 36%,#9ae6ff 54%,#b49aff 72%,#ff9ad5 90%);border:1px solid rgba(255,255,255,.6);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.9)'],
    ['titanium', 'Titanium', '#f1f4f8', '#aab3c2', '#9fd8ff',
      'background:repeating-linear-gradient(90deg,rgba(255,255,255,.07) 0,rgba(255,255,255,.07) 1px,rgba(0,0,0,.08) 1px,rgba(0,0,0,.08) 2px),linear-gradient(105deg,#3d4452 0%,#8a93a4 22%,#4f5766 42%,#9aa3b4 62%,#454c5a 82%,#7b8496 100%);border:1px solid #2d3340;border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.35),inset 0 -2px 0 rgba(0,0,0,.3)'],
    ['jade', 'Jade', '#effff6', '#a9d9bd', '#ffe08a',
      'background:radial-gradient(ellipse at 28% 24%,rgba(255,255,255,.3),transparent 50%),radial-gradient(ellipse at 80% 80%,rgba(0,40,20,.35),transparent 55%),linear-gradient(135deg,#34805f,#1e5a42 50%,#42996f);border:1px solid #14402e;border-radius:14px;box-shadow:0 14px 30px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.35),inset 0 0 30px rgba(0,60,30,.35)'],
    ['mahogany', 'Mahogany', '#fbe6d8', '#d4a98e', '#ffc98a',
      'background:repeating-linear-gradient(92deg,rgba(0,0,0,.22) 0,rgba(0,0,0,.22) 2px,transparent 2px,transparent 8px,rgba(255,150,110,.07) 8px,rgba(255,150,110,.07) 9px,transparent 9px,transparent 16px),radial-gradient(ellipse at 22% 30%,rgba(255,150,110,.16),transparent 55%),linear-gradient(180deg,#6a2a1a,#4a1c10);border:1px solid #2a0f08;border-radius:6px;box-shadow:0 14px 30px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,190,150,.2)'],
    ['driftwood', 'Driftwood', '#26221c', '#625b4e', '#6b3a14',
      'background:repeating-linear-gradient(89deg,rgba(60,50,38,.25) 0,rgba(60,50,38,.25) 1px,transparent 1px,transparent 7px,rgba(255,255,255,.14) 7px,rgba(255,255,255,.14) 8px,transparent 8px,transparent 15px),linear-gradient(180deg,#c8bfae,#aea492);border:1px solid #8a8070;border-radius:4px;box-shadow:0 12px 26px rgba(0,0,0,.5)'],
    ['sand', 'Beach sand', '#3a2f1a', '#7a6a48', '#8a4a12',
      'background:repeating-linear-gradient(8deg,rgba(150,115,60,.13) 0,rgba(150,115,60,.13) 2px,transparent 2px,transparent 11px),radial-gradient(rgba(120,90,40,.3) 1px,transparent 1.6px) 0 0/6px 6px,radial-gradient(rgba(255,255,255,.4) 1px,transparent 1.6px) 3px 2px/8px 8px,linear-gradient(180deg,#e8d5a3,#d8c28a);border:0;border-radius:8px;box-shadow:0 12px 26px rgba(0,0,0,.45)'],
    ['snow', 'Fresh snow', '#1c2b3c', '#566a80', '#1a5a9a',
      'background:radial-gradient(rgba(255,255,255,.95) 1px,transparent 2px) 0 0/9px 9px,radial-gradient(rgba(190,215,240,.55) 1.5px,transparent 3px) 4px 5px/13px 13px,radial-gradient(ellipse at 30% 10%,#ffffff,#e4eef8 55%,#cddcec);border:0;border-radius:18px;box-shadow:0 14px 30px rgba(0,0,0,.4),inset 0 -6px 14px rgba(150,180,215,.45),inset 0 2px 0 #fff'],
    ['ice', 'Ice', '#0a2236', '#3a6382', '#0a5a9a',
      'background:linear-gradient(63deg,transparent 46%,rgba(255,255,255,.75) 46.5%,transparent 47.6%) 0 0/230px 170px,linear-gradient(-28deg,transparent 52%,rgba(255,255,255,.6) 52.4%,transparent 53.4%) 40px 20px/190px 150px,linear-gradient(135deg,#c4e9ff,#7cc2ee 45%,#d6f0ff);border:1px solid rgba(255,255,255,.8);border-radius:12px;box-shadow:0 14px 30px rgba(0,60,120,.35),inset 0 0 26px rgba(255,255,255,.7),inset 0 -8px 18px rgba(40,120,190,.35)'],
    ['lava-rock', 'Lava rock', '#ffe9d4', '#d9a98a', '#ffc46a',
      'background:linear-gradient(28deg,transparent 46%,rgba(255,120,30,.95) 47%,rgba(255,200,80,.9) 47.6%,transparent 49%) 0 0/210px 160px,linear-gradient(-52deg,transparent 56%,rgba(255,100,20,.9) 57%,rgba(255,190,70,.8) 57.5%,transparent 58.6%) 60px 30px/240px 180px,radial-gradient(ellipse at 40% 90%,rgba(255,90,20,.35),transparent 60%),linear-gradient(160deg,#241917,#120c0a);border:2px solid #0a0605;border-radius:6px;box-shadow:0 0 30px rgba(255,100,30,.22),0 14px 30px rgba(0,0,0,.65),inset 0 0 30px rgba(0,0,0,.6)'],
    ['moss', 'Moss', '#f0ffe0', '#b8d89a', '#ffe08a',
      'background:radial-gradient(rgba(190,255,120,.35) 1.5px,transparent 2.6px) 0 0/8px 8px,radial-gradient(rgba(10,50,10,.5) 1.5px,transparent 2.6px) 3px 4px/9px 9px,radial-gradient(ellipse at 30% 20%,rgba(160,230,100,.35),transparent 55%),linear-gradient(160deg,#3f7a2a,#25521a);border:0;border-radius:16px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 0 34px rgba(10,40,10,.55)'],
    ['silk', 'Silk', '#fff0fa', '#e6b4d8', '#ffe08a',
      'background:linear-gradient(100deg,#6a1a5a 0%,#c2559a 10%,#5a1250 22%,#d466ac 35%,#561048 48%,#c2559a 62%,#5a1250 76%,#d466ac 90%,#6a1a5a 100%);border:0;border-radius:12px;box-shadow:0 14px 30px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,200,240,.5)'],
    ['wool-knit', 'Wool knit', '#fff1f1', '#e6bcbc', '#ffe08a',
      'background-color:#74282f;background-image:KNITIMG;border:0;border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 0 26px rgba(0,0,0,.35)'],
    ['quilted-leather', 'Quilted leather', '#f6e6c8', '#cdb48a', '#e2b869',
      'background-color:#38220f;background-image:QUILTIMG;border:1px solid #120a04;border-radius:12px;box-shadow:0 14px 30px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.1)'],
    ['diamond-plate', 'Diamond plate', '#12161a', '#40484f', '#8a1a1a',
      'background-color:#8b929a;background-image:TREADIMG;border:2px solid #4e555d;border-radius:4px;box-shadow:0 12px 28px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.4)'],
    ['circuit-board', 'Circuit board', '#d8ffe9', '#8fd1ac', '#ffd479',
      'background-color:#0e5a34;background-image:PCBIMG;border:2px solid #06301c;border-radius:8px;box-shadow:0 12px 28px rgba(0,0,0,.6),inset 0 0 40px rgba(0,30,15,.45)'],
    ['honeycomb', 'Honeycomb', '#fff4dc', '#d9bd82', '#ffb020',
      'background-color:#1b1e26;background-image:HEXIMG;border:1px solid #3a3f4d;border-radius:8px;box-shadow:0 12px 28px rgba(0,0,0,.6),inset 0 0 30px rgba(0,0,0,.4)'],
    ['tatami', 'Tatami mat', '#2a2a14', '#6b6a38', '#6b2a10',
      'background:repeating-linear-gradient(90deg,rgba(110,100,40,.28) 0,rgba(110,100,40,.28) 1px,transparent 1px,transparent 4px),repeating-linear-gradient(90deg,rgba(255,255,255,.14) 0,rgba(255,255,255,.14) 1px,transparent 1px,transparent 9px),linear-gradient(180deg,#c6bd7e,#b3aa6a);border:0;border-top:10px solid #2a3a22;border-bottom:10px solid #2a3a22;border-radius:2px;box-shadow:0 12px 26px rgba(0,0,0,.5)'],
    ['plaster', 'Plaster', '#2a2622', '#6a625a', '#8a3b12',
      'background:radial-gradient(ellipse at 20% 20%,rgba(255,255,255,.7),transparent 55%),radial-gradient(ellipse at 80% 85%,rgba(160,150,135,.35),transparent 55%),linear-gradient(160deg,#eee9df,#ddd6c9);border:0;border-radius:8px;box-shadow:0 12px 26px rgba(0,0,0,.45),inset 0 1px 0 #fff'],
    ['terracotta', 'Terracotta', '#2a1208', '#6a3a22', '#5a1a08',
      'background:radial-gradient(rgba(90,30,10,.35) 1px,transparent 1.8px) 0 0/7px 7px,radial-gradient(rgba(255,200,160,.25) 1.5px,transparent 2.4px) 3px 4px/11px 11px,radial-gradient(ellipse at 30% 20%,rgba(255,170,120,.3),transparent 55%),linear-gradient(160deg,#c96a3e,#a8522c);border:1px solid #7a3a1c;border-radius:10px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,210,170,.4)'],
    ['cobblestone', 'Cobblestone', '#f4f4f6', '#c8c8ce', '#ffd479',
      'background-color:#3a3a3e;background-image:COBBLEIMG;border:2px solid #232326;border-radius:6px;box-shadow:0 12px 28px rgba(0,0,0,.6),inset 0 0 26px rgba(0,0,0,.4)'],
    ['cracked-earth', 'Cracked earth', '#2a1a08', '#6a4a22', '#6a1a08',
      'background-color:#b8946a;background-image:CRACKIMG;border:0;border-radius:6px;box-shadow:0 12px 26px rgba(0,0,0,.5),inset 0 0 30px rgba(90,50,10,.35)'],
    ['rope-weave', 'Rope weave', '#fff3dc', '#e0c898', '#ffd479',
      'background-color:#6a5230;background-image:ROPEIMG;border:2px solid #3a2c16;border-radius:8px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 0 22px rgba(0,0,0,.4)'],
    ['onyx', 'Black onyx', '#f6ecd0', '#c9b480', '#ffd479',
      'background:radial-gradient(ellipse at 25% 15%,rgba(255,255,255,.14),transparent 50%),linear-gradient(160deg,#14141a,#050507);border:1px solid #2a2a30;border-radius:8px;box-shadow:0 14px 30px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.2)'],
    ['pearl', 'Pearl', '#2a2438', '#6a6080', '#7a3a9a',
      'background:radial-gradient(ellipse at 22% 18%,#ffffff,transparent 55%),linear-gradient(135deg,#ffffff,#f5e6ff 22%,#e4fff4 46%,#fff1dc 70%,#f1e8ff 90%);border:1px solid #e4dcee;border-radius:14px;box-shadow:0 14px 30px rgba(0,0,0,.4),inset 0 1px 0 #fff,inset 0 -3px 10px rgba(180,150,220,.3)'],
    ['neon-glass', 'Neon glass', '#e8faff', '#8fd2e0', '#ff5ad0',
      'background:linear-gradient(135deg,rgba(14,18,44,.78),rgba(8,10,28,.62));-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid rgba(60,240,255,.85);border-radius:14px;box-shadow:0 0 26px rgba(60,240,255,.35),inset 0 0 22px rgba(255,60,200,.2),inset 0 0 0 1px rgba(255,255,255,.08)'],
    ['corduroy', 'Corduroy', '#fff0dc', '#e0bc94', '#ffd479',
      'background:repeating-linear-gradient(90deg,rgba(0,0,0,.28) 0,rgba(0,0,0,.28) 2px,rgba(255,255,255,.08) 2px,rgba(255,255,255,.08) 3px,transparent 3px,transparent 7px),linear-gradient(160deg,#94603e,#6e4429);border:0;border-radius:10px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 0 22px rgba(0,0,0,.3)'],
    ['gunmetal', 'Gunmetal', '#eef1f5', '#a4acb8', '#9fd8ff',
      'background:repeating-linear-gradient(90deg,rgba(255,255,255,.05) 0,rgba(255,255,255,.05) 1px,rgba(0,0,0,.1) 1px,rgba(0,0,0,.1) 2px),linear-gradient(105deg,#23272d 0%,#5a606a 24%,#2f343b 46%,#656b76 68%,#262a30 100%);border:1px solid #14161a;border-radius:6px;box-shadow:0 14px 30px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.25)'],
    ['seigaiha', 'Wave pattern', '#f4f8fd', '#b8cce4', '#ffd479',
      'background-color:#1c3b63;background-image:WAVEIMG;border:2px solid #10233d;border-radius:8px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 0 24px rgba(0,0,0,.35)'],
    ['argyle', 'Argyle', '#fff4dc', '#e0cc9c', '#ffe08a',
      'background-color:#1f4a3c;background-image:ARGYLEIMG;border:0;border-radius:6px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 0 24px rgba(0,0,0,.35)'],
    ['burlap', 'Burlap', '#2a1c08', '#6a5026', '#7a2e0e',
      'background:repeating-linear-gradient(0deg,rgba(60,38,10,.22) 0,rgba(60,38,10,.22) 2px,transparent 2px,transparent 5px),repeating-linear-gradient(90deg,rgba(60,38,10,.2) 0,rgba(60,38,10,.2) 2px,transparent 2px,transparent 5px),radial-gradient(rgba(255,255,255,.18) 1px,transparent 1.6px) 0 0/4px 4px,linear-gradient(160deg,#c4a06a,#a8844e);border:0;border-radius:4px;box-shadow:0 12px 26px rgba(0,0,0,.5)'],
    ['tartan', 'Tartan', '#fff4dc', '#e0cc9c', '#ffd479',
      'background-color:#6a1620;background-image:TARTANIMG;border:2px solid #3a0a10;border-radius:6px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 0 24px rgba(0,0,0,.35)'],
    ['houndstooth', 'Houndstooth', '#1a1a1a', '#5a5a5a', '#8a1a2a',
      'background-color:#e6e1d6;background-image:HOUNDIMG;border:0;border-radius:6px;box-shadow:0 12px 26px rgba(0,0,0,.45),inset 0 0 18px rgba(0,0,0,.12)'],
    ['checker-tile', 'Checker tile', '#2a2418', '#6a5e44', '#7a2e0e',
      'background-color:#e9e2d0;background-image:CHECKIMG;border:3px solid #b8ad92;border-radius:4px;box-shadow:0 12px 26px rgba(0,0,0,.45),inset 0 0 14px rgba(0,0,0,.15)'],
    ['rubber-mat', 'Rubber mat', '#eef1f5', '#a4acb8', '#9fd8ff',
      'background:radial-gradient(rgba(255,255,255,.1) 1.2px,transparent 2px) 0 0/9px 9px,radial-gradient(rgba(0,0,0,.4) 1.6px,transparent 2.6px) 4px 4px/9px 9px,linear-gradient(160deg,#30333a,#1c1e23);border:1px solid #0e0f12;border-radius:8px;box-shadow:0 12px 26px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.1)'],
    ['amethyst', 'Amethyst', '#f6ecff', '#c9a9e8', '#ffd479',
      'background:radial-gradient(ellipse at 24% 18%,rgba(255,255,255,.32),transparent 45%),radial-gradient(ellipse at 78% 82%,rgba(255,120,255,.35),transparent 55%),linear-gradient(145deg,#4a1a7a,#7a3ab8 40%,#3a1260 70%,#6a2aa0);border:1px solid #2a0a48;border-radius:12px;box-shadow:0 14px 30px rgba(40,0,80,.55),inset 0 1px 0 rgba(255,255,255,.3),inset 0 -4px 14px rgba(20,0,50,.5)'],
    ['sandstone', 'Sandstone', '#2a1c08', '#6a5026', '#7a2e0e',
      'background:repeating-linear-gradient(176deg,rgba(150,100,50,.22) 0,rgba(150,100,50,.22) 3px,transparent 3px,transparent 11px),repeating-linear-gradient(184deg,rgba(255,240,200,.25) 0,rgba(255,240,200,.25) 2px,transparent 2px,transparent 17px),linear-gradient(160deg,#dcb888,#c29a64);border:0;border-radius:6px;box-shadow:0 12px 26px rgba(0,0,0,.5),inset 0 0 26px rgba(120,70,20,.3)'],
    ['pinstripe', 'Pinstripe', '#f4f6fa', '#a9b4c8', '#ffd479',
      'background:repeating-linear-gradient(90deg,rgba(255,255,255,.3) 0,rgba(255,255,255,.3) 1px,transparent 1px,transparent 9px),linear-gradient(160deg,#1c2a48,#101a30);border:1px solid #0a1224;border-radius:6px;box-shadow:0 12px 28px rgba(0,0,0,.6),inset 0 0 22px rgba(0,0,0,.35)'],
    ['herringbone', 'Herringbone', '#fff0dc', '#e0bc94', '#ffd479',
      'background-color:#7a4a2a;background-image:HERRINGIMG;border:2px solid #3a2010;border-radius:6px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 0 22px rgba(0,0,0,.3)'],
    ['lapis', 'Lapis lazuli', '#f4f8ff', '#b8c8ee', '#ffd479',
      'background:radial-gradient(rgba(255,215,120,.9) .8px,transparent 1.4px) 0 0/23px 19px,radial-gradient(rgba(255,215,120,.7) .7px,transparent 1.3px) 9px 7px/31px 27px,radial-gradient(ellipse at 28% 20%,rgba(120,160,255,.35),transparent 55%),linear-gradient(150deg,#16308a,#0a1a58 55%,#1c3ca0);border:1px solid #060e34;border-radius:10px;box-shadow:0 14px 30px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.25)'],
    ['rosewood', 'Rosewood', '#fff0e6', '#e0b8a8', '#ffd479',
      'background:repeating-linear-gradient(94deg,rgba(40,8,6,.4) 0,rgba(40,8,6,.4) 1px,transparent 1px,transparent 6px),repeating-linear-gradient(91deg,rgba(255,150,120,.12) 0,rgba(255,150,120,.12) 2px,transparent 2px,transparent 13px),linear-gradient(160deg,#6a2418,#4a140c 60%,#5e1e14);border:1px solid #2a0a06;border-radius:8px;box-shadow:0 14px 30px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,180,150,.25)'],
    ['snakeskin', 'Snakeskin', '#f0f4d8', '#b8c490', '#ffd479',
      'background-color:#3a4a22;background-image:SNAKEIMG;border:1px solid #1a2410;border-radius:10px;box-shadow:0 12px 28px rgba(0,0,0,.55),inset 0 0 24px rgba(0,0,0,.35)'],
    ['galaxy', 'Galaxy', '#f4eeff', '#b8a8e8', '#7fe0ff',
      'background:radial-gradient(rgba(255,255,255,.95) .8px,transparent 1.4px) 0 0/37px 41px,radial-gradient(rgba(190,220,255,.8) .7px,transparent 1.3px) 17px 23px/53px 47px,radial-gradient(ellipse at 20% 25%,rgba(255,80,200,.4),transparent 50%),radial-gradient(ellipse at 80% 75%,rgba(60,140,255,.45),transparent 55%),linear-gradient(150deg,#0c0624,#1a0a48 55%,#08122e);border:1px solid #06031a;border-radius:12px;box-shadow:0 0 26px rgba(120,80,255,.3),0 14px 30px rgba(0,0,0,.6)']
  ];
  const TEX_IDS = TEX.map((t) => t[0]);
  /* what a desk dresses its modules in when the member picked no single texture */
  const MIX = {
    'nyse-floor': ['crt-terminal', 'carbon-fiber', 'blueprint', 'brushed-steel', 'crt-terminal', 'slate', 'ticker-tape'],
    'paper-desk': ['legal-pad', 'graph-paper', 'manila-folder', 'newsprint', 'index-card', 'ledger-green', 'kraft-paper', 'sticky-note'],
    'walnut-office': ['leather', 'brass-plate', 'walnut', 'parchment', 'leather', 'marble', 'green-felt'],
    'steel-trader': ['brushed-steel', 'carbon-fiber', 'concrete', 'slate', 'brushed-steel', 'frosted-glass'],
    'cork-wall': ['sticky-note', 'index-card', 'graph-paper', 'kraft-paper', 'legal-pad', 'newsprint'],
    'leather-blotter': ['leather', 'parchment', 'brass-plate', 'green-felt', 'oak', 'ledger-green'],
    'night-skyline': ['carbon-fiber', 'frosted-glass', 'crt-terminal', 'slate', 'brushed-steel', 'carbon-fiber', 'blueprint'],
    'sunrise-office': ['bamboo', 'linen', 'canvas', 'index-card', 'oak', 'legal-pad', 'terrazzo'],
    'amber-terminal': ['crt-terminal', 'carbon-fiber', 'crt-terminal', 'slate', 'rusted-iron', 'crt-terminal', 'carbon-fiber'],
    'library-study': ['leather', 'walnut', 'parchment', 'brass-plate', 'leather', 'ledger-green', 'gold-leaf'],
    'penthouse': ['marble', 'frosted-glass', 'gold-leaf', 'granite', 'frosted-glass', 'copper', 'terrazzo'],
    'war-room': ['chalkboard', 'pegboard', 'sticky-note', 'chalkboard', 'index-card', 'pegboard', 'graph-paper'],
    'drafting-table': ['blueprint', 'graph-paper', 'canvas', 'blueprint', 'kraft-paper', 'linen', 'blueprint'],
    'rooftop-terrace': ['driftwood', 'slate', 'canvas', 'rusted-iron', 'driftwood', 'denim', 'frosted-glass'],
    'beach-office': ['sand', 'driftwood', 'bamboo', 'linen', 'sand', 'canvas', 'frosted-glass'],
    'space-station': ['titanium', 'carbon-fiber', 'crt-terminal', 'holographic', 'titanium', 'frosted-glass', 'crt-terminal'],
    'cafe-table': ['marble', 'mahogany', 'linen', 'velvet', 'brick', 'canvas', 'terrazzo'],
    'vault-room': ['titanium', 'gold-leaf', 'brushed-steel', 'rusted-iron', 'gold-leaf', 'concrete', 'copper'],
    'music-studio': ['velvet', 'carbon-fiber', 'tweed', 'crt-terminal', 'velvet', 'titanium', 'jade'],
    'mountain-cabin': ['walnut', 'wool-knit', 'oak', 'quilted-leather', 'driftwood', 'snow', 'moss'],
    'neon-city': ['carbon-fiber', 'circuit-board', 'holographic', 'honeycomb', 'crt-terminal', 'titanium', 'carbon-fiber'],
    'greenhouse': ['moss', 'bamboo', 'sand', 'linen', 'driftwood', 'jade', 'terrazzo'],
    'observatory': ['mahogany', 'brass-plate', 'titanium', 'blueprint', 'leather', 'copper', 'parchment'],
    'submarine': ['diamond-plate', 'rusted-iron', 'titanium', 'brushed-steel', 'diamond-plate', 'circuit-board', 'copper'],
    'zen-room': ['tatami', 'bamboo', 'plaster', 'linen', 'driftwood', 'jade', 'snow'],
    'jungle-treehouse': ['moss', 'bamboo', 'rope-weave', 'driftwood', 'burlap', 'jade', 'terracotta'],
    'ice-cave': ['ice', 'snow', 'frosted-glass', 'titanium', 'pearl', 'ice', 'neon-glass'],
    'desert-canyon': ['terracotta', 'cracked-earth', 'rusted-iron', 'sand', 'burlap', 'cobblestone', 'copper'],
    'airship-deck': ['mahogany', 'brass-plate', 'copper', 'rope-weave', 'canvas', 'gold-leaf', 'quilted-leather'],
    'pirate-cabin': ['driftwood', 'rope-weave', 'parchment', 'mahogany', 'rusted-iron', 'burlap', 'cobblestone'],
    'retro-arcade': ['neon-glass', 'carbon-fiber', 'argyle', 'crt-terminal', 'holographic', 'gunmetal', 'neon-glass'],
    'wizard-tower': ['amethyst', 'parchment', 'galaxy', 'mahogany', 'gold-leaf', 'velvet', 'lapis'],
    'coral-reef': ['pearl', 'sand', 'jade', 'lapis', 'seigaiha', 'terracotta', 'ice'],
    'volcano-lab': ['lava-rock', 'rusted-iron', 'gunmetal', 'copper', 'rubber-mat', 'terracotta', 'onyx'],
    'cloud-lounge': ['pearl', 'silk', 'snow', 'frosted-glass', 'pinstripe', 'wool-knit', 'houndstooth'],
    'train-car': ['rosewood', 'herringbone', 'brass-plate', 'tartan', 'leather', 'parchment', 'checker-tile'],
    'lighthouse': ['driftwood', 'rope-weave', 'sandstone', 'brick', 'snakeskin', 'canvas', 'slate']
  };
  const DESKS = [['none', 'No desk'], ['nyse-floor', 'NYSE trading floor'], ['paper-desk', 'Paper desk'], ['walnut-office', 'Walnut office'], ['steel-trader', 'Steel trader desk'], ['cork-wall', 'Cork wall'], ['leather-blotter', 'Leather blotter'], ['night-skyline', 'Night skyline'], ['sunrise-office', 'Sunrise office'], ['amber-terminal', 'Amber terminal'], ['library-study', 'Library study'], ['penthouse', 'Penthouse view'], ['war-room', 'War room whiteboard'], ['drafting-table', 'Drafting table'], ['rooftop-terrace', 'Rooftop terrace'], ['beach-office', 'Beach office'], ['space-station', 'Space station'], ['cafe-table', 'Cafe table'], ['vault-room', 'Vault room'], ['music-studio', 'Music studio'], ['mountain-cabin', 'Mountain cabin'], ['neon-city', 'Neon rain city'], ['greenhouse', 'Greenhouse'], ['observatory', 'Observatory'], ['submarine', 'Submarine'], ['zen-room', 'Zen room'], ['jungle-treehouse', 'Jungle treehouse'], ['ice-cave', 'Ice cave'], ['desert-canyon', 'Desert canyon'], ['airship-deck', 'Airship deck'], ['pirate-cabin', 'Pirate cabin'], ['retro-arcade', 'Retro arcade'], ['wizard-tower', 'Wizard tower'], ['coral-reef', 'Coral reef'], ['volcano-lab', 'Volcano lab'], ['cloud-lounge', 'Cloud lounge'], ['train-car', 'Night train'], ['lighthouse', 'Lighthouse']];
  const LIGHTS = [['off', 'Off'], ['desk-lamp', 'Desk lamp'], ['window-sun', 'Window sun'], ['monitor-glow', 'Monitor glow'], ['neon-sweep', 'Neon sweep'], ['golden-hour', 'Golden hour'], ['spotlight', 'Spotlight'], ['candlelight', 'Candlelight'], ['moonlight', 'Moonlight'], ['stage-beams', 'Stage beams'], ['storm-flash', 'Storm flashes'], ['aurora-ribbons', 'Aurora ribbons'], ['god-rays', 'God rays'], ['fireplace', 'Fireplace'], ['led-strip', 'LED strips'], ['fairy-lights', 'Fairy lights'], ['lava-glow', 'Lava glow'], ['police-lights', 'Police lights'], ['disco-ball', 'Disco ball'], ['laser-grid', 'Laser fan'], ['searchlights', 'Searchlights'], ['neon-flicker', 'Neon flicker'], ['tv-glow', 'TV glow'], ['caustics', 'Underwater caustics'], ['pulse-rings', 'Pulse rings'], ['fireworks', 'Fireworks'], ['prism', 'Prism rainbow'], ['sunset-horizon', 'Sunset horizon'], ['fireflies', 'Fireflies'], ['snow-glow', 'Glowing snowfall'], ['lanterns', 'Floating lanterns'], ['radar-sweep', 'Radar sweep'], ['matrix-rain', 'Code rain'], ['equalizer-glow', 'Equalizer glow'], ['lens-flare', 'Lens flare'], ['bokeh-drift', 'Bokeh drift'], ['beacon', 'Warning beacon']];
  const ORB_LEVELS = [['off', 'Off'], ['few', 'A few'], ['many', 'Lots']];
  /* small decorations a texture or desk adds to a module: [class] */
  const DECO = { 'manila-folder': 'tab', 'legal-pad': 'bind', leather: 'stitch', 'brass-plate': 'riv', 'cork-board': 'pin', blueprint: 'corner', 'sticky-note': 'curl' };
  const DESK_DECO = { 'paper-desk': ['tape', 'clip', 'tape', 'clip'], 'cork-wall': ['pin'], 'war-room': ['tape', 'pin'], 'drafting-table': ['corner'] };

  /* ---------- CSS ---------- */
  let css = '.pd-desk,.pd-light,.pd-orbs,.pd-vig{position:fixed;inset:0;pointer-events:none}.pd-desk{z-index:0;overflow:hidden}.pd-desk svg{width:100%;height:100%;display:block}.pd-light{z-index:3;mix-blend-mode:screen;opacity:.62;width:100%;height:100%}.pd-vig{z-index:0;background:radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,.6) 100%)}.pd-orbs{z-index:4;width:100%;height:100%}'
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
  const tile = (w, h, inner) => 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' + inner + '</svg>') + '")';
  const BRICK = tile(64, 56, '<rect width="64" height="56" fill="#cfc6b6"/><rect x="2" y="2" width="60" height="24" rx="2" fill="#a64a32"/><rect x="-30" y="30" width="60" height="24" rx="2" fill="#9a412c"/><rect x="34" y="30" width="60" height="24" rx="2" fill="#b0523a"/><rect x="2" y="2" width="60" height="6" fill="rgba(255,255,255,.12)"/><rect x="34" y="30" width="60" height="6" fill="rgba(255,255,255,.12)"/><rect x="-30" y="30" width="60" height="6" fill="rgba(255,255,255,.1)"/>');
  const SUBWAY = tile(60, 30, '<rect width="60" height="30" fill="#9aa1a8"/><rect x="1.5" y="1.5" width="57" height="27" rx="3" fill="#f4f6f7"/><rect x="1.5" y="1.5" width="57" height="9" rx="3" fill="rgba(255,255,255,.7)"/><rect x="1.5" y="22" width="57" height="6" rx="3" fill="rgba(120,130,140,.18)"/>');
  const CROC = tile(46, 34, '<rect width="46" height="34" fill="#243022"/><ellipse cx="23" cy="17" rx="19" ry="13" fill="#34452f" stroke="#141c13" stroke-width="2"/><ellipse cx="23" cy="12" rx="12" ry="6" fill="rgba(255,255,255,.16)"/><circle cx="23" cy="19" r="2" fill="rgba(0,0,0,.35)"/><ellipse cx="0" cy="0" rx="19" ry="13" fill="#34452f" stroke="#141c13" stroke-width="2"/><ellipse cx="46" cy="0" rx="19" ry="13" fill="#34452f" stroke="#141c13" stroke-width="2"/><ellipse cx="0" cy="34" rx="19" ry="13" fill="#34452f" stroke="#141c13" stroke-width="2"/><ellipse cx="46" cy="34" rx="19" ry="13" fill="#34452f" stroke="#141c13" stroke-width="2"/>');
  const QUILT = tile(60, 60, '<rect width="60" height="60" fill="#38220f"/><path d="M30 0 L60 30 L30 60 L0 30Z" fill="#4c2f19" stroke="#1c0f06" stroke-width="2"/><path d="M30 7 L53 30 L30 53 L7 30Z" fill="rgba(255,255,255,.07)"/><path d="M30 0 L60 30 M60 30 L30 60 M30 60 L0 30 M0 30 L30 0" stroke="rgba(226,184,105,.55)" stroke-width="1" stroke-dasharray="3 3" fill="none"/><circle cx="30" cy="30" r="3.2" fill="#c9a23a" stroke="#6b4a10"/><circle cx="0" cy="0" r="3.2" fill="#c9a23a"/><circle cx="60" cy="0" r="3.2" fill="#c9a23a"/><circle cx="0" cy="60" r="3.2" fill="#c9a23a"/><circle cx="60" cy="60" r="3.2" fill="#c9a23a"/>');
  const TREAD = tile(48, 48, '<rect width="48" height="48" fill="#8b929a"/><g transform="rotate(45 14 14)"><ellipse cx="14" cy="14" rx="11" ry="4" fill="#c0c8d0" stroke="#4e555d"/><ellipse cx="14" cy="13" rx="9" ry="2" fill="rgba(255,255,255,.5)"/></g><g transform="rotate(-45 36 36)"><ellipse cx="36" cy="36" rx="11" ry="4" fill="#c0c8d0" stroke="#4e555d"/><ellipse cx="36" cy="35" rx="9" ry="2" fill="rgba(255,255,255,.5)"/></g>');
  const PCB = tile(120, 120, '<rect width="120" height="120" fill="#0e5a34"/><g fill="none" stroke="#c9a23a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M0 30 H44 L64 50 H120"/><path d="M0 84 H30 L48 66 H84 L100 82 H120"/><path d="M60 0 V28 L80 48 V80"/><path d="M24 120 V96 L40 80"/><path d="M96 0 V30 H120"/></g><g fill="#c9a23a"><circle cx="44" cy="30" r="4.5"/><circle cx="64" cy="50" r="4.5"/><circle cx="30" cy="84" r="4.5"/><circle cx="84" cy="66" r="4.5"/><circle cx="80" cy="80" r="4.5"/><circle cx="40" cy="80" r="4.5"/></g><g fill="#06301c"><circle cx="44" cy="30" r="1.8"/><circle cx="64" cy="50" r="1.8"/><circle cx="30" cy="84" r="1.8"/><circle cx="84" cy="66" r="1.8"/></g><rect x="88" y="94" width="22" height="14" fill="#14141a" stroke="#555"/>');
  const HEX = tile(56, 100, '<rect width="56" height="100" fill="#1b1e26"/><g fill="none" stroke="#ffb020" stroke-width="2" stroke-opacity=".85"><path d="M28 66L0 50L0 16L28 0L56 16L56 50L28 66L28 100"/><path d="M28 0L28 34L0 50L0 84L28 100L56 84L56 50L28 34"/></g><path d="M28 66L0 50L0 16L28 0L56 16L56 50Z" fill="rgba(255,176,32,.05)"/>');
  const KNIT = tile(20, 14, '<rect width="20" height="14" fill="#74282f"/><path d="M0 2 L10 12 L20 2" stroke="#b8545c" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M0 2 L10 12 L20 2" stroke="rgba(255,220,220,.35)" stroke-width="1.4" fill="none" transform="translate(0 -1.4)"/><path d="M0 4 L10 14 L20 4" stroke="rgba(0,0,0,.28)" stroke-width="1.4" fill="none"/>');
  const COBBLE = tile(96, 72, '<rect width="96" height="72" fill="#3a3a3e"/><rect x="3" y="3" width="40" height="30" rx="12" fill="#8a8a90"/><rect x="48" y="4" width="44" height="26" rx="11" fill="#74747c"/><rect x="2" y="38" width="32" height="30" rx="11" fill="#7c7c84"/><rect x="38" y="36" width="52" height="32" rx="13" fill="#8e8e94"/><rect x="3" y="3" width="40" height="9" rx="8" fill="rgba(255,255,255,.14)"/><rect x="38" y="36" width="52" height="9" rx="8" fill="rgba(255,255,255,.12)"/><rect x="48" y="4" width="44" height="8" rx="6" fill="rgba(255,255,255,.1)"/>');
  const ROPE = tile(22, 22, '<rect width="22" height="22" fill="#6a5230"/><path d="M-4 18 L8 6 M8 24 L20 12 M12 10 L24 -2" stroke="#c9a96a" stroke-width="7" stroke-linecap="round"/><path d="M-4 18 L8 6 M8 24 L20 12 M12 10 L24 -2" stroke="rgba(255,255,255,.22)" stroke-width="2" stroke-linecap="round" transform="translate(-1 -1)"/><path d="M-2 22 L10 10 M10 26 L22 14" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/>');
  const WAVES = tile(60, 30, '<rect width="60" height="30" fill="#1c3b63"/><g fill="none" stroke="#a9c4e6" stroke-opacity=".5" stroke-width="1.2"><circle cx="0" cy="30" r="28"/><circle cx="0" cy="30" r="21"/><circle cx="0" cy="30" r="14"/><circle cx="0" cy="30" r="7"/><circle cx="60" cy="30" r="28"/><circle cx="60" cy="30" r="21"/><circle cx="60" cy="30" r="14"/><circle cx="60" cy="30" r="7"/><circle cx="30" cy="15" r="28"/><circle cx="30" cy="15" r="21"/><circle cx="30" cy="15" r="14"/><circle cx="30" cy="15" r="7"/></g>');
  const ARGYLE = tile(80, 80, '<rect width="80" height="80" fill="#1f4a3c"/><path d="M40 0 L80 40 L40 80 L0 40Z" fill="#7a2a3a"/><path d="M40 14 L66 40 L40 66 L14 40Z" fill="#c9a96a" opacity=".25"/><path d="M0 0 L80 80 M80 0 L0 80" stroke="#e8d6a0" stroke-width="1.4" stroke-dasharray="4 4"/>');
  const CRACKS = tile(130, 110, '<rect width="130" height="110" fill="#b8946a"/><g fill="none" stroke="rgba(60,36,14,.85)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M0 30 L28 38 L46 22 L80 30 L104 14 L130 24"/><path d="M28 38 L22 70 L48 84 L44 110"/><path d="M80 30 L76 62 L100 78 L130 70"/><path d="M48 84 L76 62"/><path d="M22 70 L0 76"/><path d="M100 78 L96 110"/><path d="M46 22 L50 0"/><path d="M104 14 L100 0"/></g><g fill="rgba(255,255,255,.1)"><path d="M30 40 L44 26 L76 32 L72 60 L50 80 L26 68Z"/><path d="M82 34 L102 18 L126 28 L126 66 L102 74Z"/></g>');
  const TARTAN = tile(64, 64, '<rect width="64" height="64" fill="#6a1620"/><rect x="0" y="10" width="64" height="12" fill="#1c3a6a" opacity=".75"/><rect x="10" y="0" width="12" height="64" fill="#1c3a6a" opacity=".75"/><rect x="0" y="38" width="64" height="4" fill="#e8c860" opacity=".8"/><rect x="38" y="0" width="4" height="64" fill="#e8c860" opacity=".8"/><rect x="0" y="50" width="64" height="2" fill="#f4f0e4" opacity=".7"/><rect x="50" y="0" width="2" height="64" fill="#f4f0e4" opacity=".7"/><rect x="0" y="10" width="64" height="12" fill="#000" opacity=".12"/>');
  const HOUND = tile(32, 32, '<rect width="32" height="32" fill="#e6e1d6"/><path d="M0 0 H16 V8 L8 16 H0Z M16 16 H32 V24 L24 32 H16Z M16 0 L32 0 L24 8 H16Z M0 16 L8 16 L16 24 V32 H8 L0 24Z" fill="#b9b3a6"/>');
  const CHECK = tile(64, 64, '<rect width="64" height="64" fill="#e9e2d0"/><rect width="32" height="32" fill="#c9bfa6"/><rect x="32" y="32" width="32" height="32" fill="#c9bfa6"/><path d="M0 0 H64 V64 H0Z" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="2"/><path d="M32 0 V64 M0 32 H64" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/>');
  const HERRING = tile(48, 24, '<rect width="48" height="24" fill="#7a4a2a"/><path d="M0 12 L12 0 H24 L12 12Z" fill="#8e5a34" stroke="#3a2010"/><path d="M24 12 L36 0 H48 L36 12Z" fill="#8e5a34" stroke="#3a2010"/><path d="M12 24 L24 12 H36 L24 24Z" fill="#6a3e22" stroke="#3a2010"/><path d="M-12 24 L0 12 H12 L0 24Z" fill="#6a3e22" stroke="#3a2010"/><path d="M36 24 L48 12 H60 L48 24Z" fill="#6a3e22" stroke="#3a2010"/>');
  const SNAKE = tile(30, 22, '<rect width="30" height="22" fill="#3a4a22"/><path d="M0 11 Q7.5 0 15 11 Q22.5 0 30 11 Q22.5 22 15 11 Q7.5 22 0 11Z" fill="#566a30" stroke="#1a2410" stroke-width="1.4"/><path d="M7 11 Q15 3 23 11" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1.6"/><circle cx="15" cy="11" r="1.6" fill="rgba(0,0,0,.3)"/>');
  const turb = (bf, oct, seed, type) => '<feTurbulence type="' + (type || 'fractalNoise') + '" baseFrequency="' + bf + '" numOctaves="' + oct + '" seed="' + seed + '" stitchTiles="stitch" result="n"/>';
  const lit = (surf, elev, az, col) => '<feDiffuseLighting in="n" surfaceScale="' + surf + '" diffuseConstant="1" lighting-color="' + (col || '#fff') + '"><feDistantLight azimuth="' + (az || 225) + '" elevation="' + elev + '"/></feDiffuseLighting>';
  const shine = (surf, elev, exp) => '<feSpecularLighting in="n" surfaceScale="' + surf + '" specularConstant="1.1" specularExponent="' + exp + '" lighting-color="#fff"><feDistantLight azimuth="225" elevation="' + elev + '"/></feSpecularLighting>';
  const veins = (bf, seed, r, g, b, k) => turb(bf, 4, seed) + '<feColorMatrix type="matrix" values="0 0 0 0 ' + r + ' 0 0 0 0 ' + g + ' 0 0 0 0 ' + b + ' 1 0 0 0 0"/><feComponentTransfer><feFuncA type="table" tableValues="' + k + '"/></feComponentTransfer>';
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
    'marble': [veins('0.006 0.011', 15, 0.22, 0.26, 0.36, '0 0 0 0 0.2 0.8 0.2 0 0 0 0'), 'multiply', 0.7],
    'green-felt': [turb('0.9', 2, 5) + lit(1.1, 32, 225), 'overlay', 0.8],
    'cork-board': [turb('0.07', 4, 13) + lit(2.2, 31, 225), 'overlay', 0.55],
    'crt-terminal': [turb('0.9 0.5', 2, 23) + lit(0.6, 33, 225), 'overlay', 0.3],
    'concrete': [turb('0.085', 5, 16) + lit(2.4, 38, 225), 'multiply', 0.6],
    'slate': [turb('0.012 0.05', 5, 18) + lit(2.8, 30, 225), 'overlay', 0.85],
    'frosted-glass': [turb('0.8', 2, 20) + lit(0.5, 45, 225), 'soft-light', 0.55],
    'canvas': [turb('0.55 0.6', 3, 24) + lit(1.8, 58, 225), 'multiply', 0.6], 'linen': [turb('0.35 0.5', 4, 25) + lit(1.4, 58, 225), 'multiply', 0.5],
    'denim': [turb('0.5 0.6', 3, 26) + lit(1.6, 32, 225), 'overlay', 0.7], 'suede': [turb('0.9', 2, 27) + lit(1.2, 32, 225), 'overlay', 0.8],
    'granite': [turb('0.2', 4, 28) + lit(1.6, 36, 225), 'overlay', 0.5], 'terrazzo': [turb('0.06', 4, 29) + lit(1.4, 60, 225), 'multiply', 0.4],
    'copper': [turb('0.002 0.8', 3, 30) + lit(1.6, 34, 200), 'overlay', 0.85], 'gold-leaf': [turb('0.035', 5, 32) + lit(3.4, 34, 225), 'overlay', 0.95],
    'rusted-iron': [turb('0.05', 5, 33) + lit(3.2, 33, 225), 'overlay', 0.9], 'bamboo': [turb('0.01 0.3', 4, 34) + lit(1.8, 36, 190), 'overlay', 0.6],
    'chalkboard': [turb('0.6', 3, 35) + lit(0.8, 32, 225), 'soft-light', 0.8], 'pegboard': [turb('0.5', 3, 36) + lit(1.2, 55, 225), 'multiply', 0.4],
    'velvet': [turb('0.9', 2, 37) + lit(0.9, 30, 225), 'soft-light', 0.9], 'tweed': [turb('0.3', 4, 38) + lit(1.6, 34, 225), 'overlay', 0.7],
    'cardboard': [turb('0.02 0.3', 4, 39) + lit(2.2, 58, 225), 'multiply', 0.7], 'brick': [turb('0.09', 4, 40) + lit(3, 40, 225), 'multiply', 0.55],
    'subway-tile': [turb('0.6', 2, 41) + lit(0.5, 60, 225), 'multiply', 0.25], 'croc-leather': [turb('0.5', 3, 42) + lit(1.2, 32, 225), 'overlay', 0.5],
    'holographic': [turb('0.02 0.4', 3, 43) + lit(1.4, 40, 225), 'soft-light', 0.8], 'titanium': [turb('0.0015 0.9', 3, 44) + lit(1.4, 34, 200), 'overlay', 0.85],
    'jade': [turb('0.02', 4, 45) + lit(1.6, 38, 225), 'soft-light', 0.9], 'mahogany': [turb('0.007 0.2', 5, 46) + lit(2.4, 31, 190), 'overlay', 0.85],
    'driftwood': [turb('0.006 0.16', 5, 47) + lit(2.8, 33, 190), 'multiply', 0.55], 'sand': [turb('0.7', 3, 48) + lit(1.2, 60, 225), 'multiply', 0.45],
    'snow': [turb('0.05', 4, 49) + lit(2.2, 55, 225), 'multiply', 0.35], 'ice': [turb('0.015', 4, 50) + lit(2, 38, 225), 'soft-light', 0.9],
    'lava-rock': [turb('0.07', 5, 51) + lit(3.6, 33, 225), 'overlay', 0.85], 'moss': [turb('0.28', 4, 52) + lit(2.8, 33, 225), 'overlay', 0.9],
    'silk': [turb('0.004 0.03', 3, 53) + lit(1.2, 32, 225), 'soft-light', 0.7], 'wool-knit': [turb('0.6', 3, 54) + lit(1.4, 34, 225), 'overlay', 0.5],
    'quilted-leather': [turb('0.4', 3, 55) + lit(1.6, 32, 225), 'overlay', 0.5], 'diamond-plate': [turb('0.5', 3, 56) + lit(1.2, 36, 225), 'overlay', 0.45],
    'circuit-board': [turb('0.6', 2, 57) + lit(0.6, 36, 225), 'soft-light', 0.5], 'honeycomb': [turb('0.6', 2, 58) + lit(0.6, 36, 225), 'soft-light', 0.4],
    'tatami': [turb('0.03 0.5', 4, 59) + lit(1.6, 40, 225), 'multiply', 0.5], 'plaster': [turb('0.05', 5, 60) + lit(3.2, 50, 225), 'multiply', 0.65],
    'terracotta': [turb('0.08', 4, 61) + lit(2.4, 36, 225), 'overlay', 0.8], 'cobblestone': [turb('0.09', 4, 62) + lit(2.6, 40, 225), 'multiply', 0.5],
    'cracked-earth': [turb('0.04', 5, 63) + lit(2.4, 45, 225), 'multiply', 0.55], 'rope-weave': [turb('0.5', 3, 64) + lit(1.4, 36, 225), 'overlay', 0.5],
    'onyx': [veins('0.006 0.011', 71, 0.92, 0.74, 0.3, '0 0 0 0 0.3 1 0.3 0 0 0 0'), 'screen', 0.9], 'pearl': [turb('0.01', 3, 66) + lit(0.8, 50, 225), 'soft-light', 0.5],
    'neon-glass': [turb('0.7', 2, 67) + lit(0.4, 40, 225), 'soft-light', 0.4], 'corduroy': [turb('0.4', 3, 68) + lit(1.2, 36, 225), 'overlay', 0.45],
    'gunmetal': [turb('0.0015 0.9', 3, 69) + lit(1.4, 34, 200), 'overlay', 0.8], 'seigaiha': [turb('0.5', 3, 70) + lit(0.8, 36, 225), 'soft-light', 0.5],
    'argyle': [turb('0.6', 3, 72) + lit(1, 36, 225), 'soft-light', 0.5], 'burlap': [turb('0.45', 4, 73) + lit(2, 55, 225), 'multiply', 0.55],
    'tartan': [turb('0.55', 3, 74) + lit(1.2, 36, 225), 'overlay', 0.5], 'houndstooth': [turb('0.5', 3, 75) + lit(1, 40, 225), 'multiply', 0.3],
    'checker-tile': [turb('0.4', 3, 76) + lit(0.8, 50, 225), 'multiply', 0.3], 'rubber-mat': [turb('0.8', 2, 77) + lit(1.4, 36, 225), 'overlay', 0.5],
    'amethyst': [turb('0.02', 4, 78) + lit(1.8, 34, 225), 'soft-light', 0.9], 'sandstone': [turb('0.012 0.09', 5, 79) + lit(2.6, 40, 225), 'multiply', 0.55],
    'pinstripe': [turb('0.6', 3, 80) + lit(0.8, 40, 225), 'soft-light', 0.5], 'herringbone': [turb('0.01 0.2', 4, 81) + lit(2.2, 34, 200), 'overlay', 0.7],
    'lapis': [turb('0.015', 5, 82) + lit(1.6, 34, 225), 'soft-light', 0.9], 'rosewood': [turb('0.006 0.2', 5, 83) + lit(2.2, 31, 190), 'overlay', 0.8],
    'snakeskin': [turb('0.5', 3, 84) + lit(1.2, 32, 225), 'overlay', 0.5], 'galaxy': [turb('0.9', 2, 85) + lit(0.4, 40, 225), 'soft-light', 0.4]
  };
  const FILM = svgUri(turb('0.9', 2, 31) + '<feColorMatrix type="saturate" values="0"/>');
  const GLOSS = { amethyst: 0.5, lapis: 0.45, rosewood: 0.3, galaxy: 0.35, 'rubber-mat': 0.1, 'brushed-steel': 0.5, 'brass-plate': 0.5, marble: 0.42, 'frosted-glass': 0.36, 'carbon-fiber': 0.38, leather: 0.26, 'crt-terminal': 0.3, slate: 0.2, walnut: 0.2, oak: 0.14, 'green-felt': 0.04, 'cork-board': 0.05, concrete: 0.08, pearl: 0.55, onyx: 0.45, gunmetal: 0.4, 'neon-glass': 0.35, terracotta: 0.15, ice: 0.55, silk: 0.5, 'diamond-plate': 0.4, snow: 0.15, 'quilted-leather': 0.25, copper: 0.5, 'gold-leaf': 0.55, holographic: 0.55, titanium: 0.45, jade: 0.35, 'subway-tile': 0.35, 'croc-leather': 0.3, mahogany: 0.22, velvet: 0.08, 'rusted-iron': 0.1, granite: 0.25, terrazzo: 0.3, denim: 0.04, suede: 0.04, chalkboard: 0.1 };
  const PAPER = ['burlap', 'tatami', 'plaster', 'cardboard', 'canvas', 'linen', 'legal-pad', 'graph-paper', 'manila-folder', 'index-card', 'kraft-paper', 'newsprint', 'ledger-green', 'ticker-tape', 'sticky-note', 'parchment'];
  const LIGHT_ANGLE = { 'desk-lamp': 225, 'window-sun': 135, 'monitor-glow': 0, 'neon-sweep': 160, 'golden-hour': 45, spotlight: 180, candlelight: 180, moonlight: 200, 'stage-beams': 180, 'storm-flash': 180, 'aurora-ribbons': 180, 'god-rays': 215, fireplace: 0, 'led-strip': 180, 'fairy-lights': 180, 'lava-glow': 0, 'police-lights': 180, 'disco-ball': 180, 'laser-grid': 180, searchlights: 0, 'neon-flicker': 180, 'tv-glow': 0, caustics: 180, 'pulse-rings': 180, fireworks: 180, prism: 135, 'sunset-horizon': 0, fireflies: 180, 'snow-glow': 180, lanterns: 0, 'radar-sweep': 0, 'matrix-rain': 180, 'equalizer-glow': 0, 'lens-flare': 180, 'bokeh-drift': 180, beacon: 180 };
  for (const t of TEX) {
    const sel = '.pv-sec.tx-' + t[0] + '.tx-' + t[0] + ',.pd-sw.tx-' + t[0] + '.tx-' + t[0];
    const dark = ['#f', '#e', '#6', '#a'].indexOf(t[2].slice(0, 2)) >= 0 || t[2] === 'var(--acc)';
    t[5] = t[5].replace('BRICKIMG', BRICK).replace('SUBWAYIMG', SUBWAY).replace('CROCIMG', CROC).replace('KNITIMG', KNIT).replace('QUILTIMG', QUILT).replace('TREADIMG', TREAD).replace('PCBIMG', PCB).replace('HEXIMG', HEX).replace('COBBLEIMG', COBBLE).replace('ROPEIMG', ROPE).replace('WAVEIMG', WAVES).replace('ARGYLEIMG', ARGYLE).replace('CRACKIMG', CRACKS).replace('TARTANIMG', TARTAN).replace('HOUNDIMG', HOUND).replace('CHECKIMG', CHECK).replace('HERRINGIMG', HERRING).replace('SNAKEIMG', SNAKE);
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
    + '.dk-war-room .pv-sec:nth-child(3n+1){transform:rotate(-.8deg)}.dk-war-room .pv-sec:nth-child(3n+2){transform:rotate(.7deg)}.dk-sunrise-office .pv-sec:nth-child(2n){transform:rotate(.3deg)}'
    + '.dk-nyse-floor .pv-sec,.dk-steel-trader .pv-sec,.dk-night-skyline .pv-sec,.dk-amber-terminal .pv-sec{border-radius:6px}'
    + '.pv-sec.orb{padding:10px 10px 6px;overflow:visible}.pv-sec.orb{background:transparent;border-color:transparent;box-shadow:none}'
    + '@media(min-width:900px){.pv-sec.orb{grid-area:orb}}'
    /* realism: light from the lamp / sun / screen falls across every module (lit side, shaded side), a glare slides over glossy
       materials as the pointer moves, the page tilts a little toward the pointer over a desk that shifts the other way (depth),
       and a faint film grain sits over everything like a photograph */
    + '.pv-sec[class*=tx-]:after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(var(--la,150deg),rgba(255,255,255,.22),rgba(255,255,255,0) 42%,rgba(0,0,0,.24) 100%);mix-blend-mode:soft-light;z-index:1}'
    + '.pv-sec[class*=tx-]>*:not(.pd-d){position:relative;z-index:3}'
    + '.pv-sec[class*=tx-]{rotate:var(--rot,0deg)}.pd-glare{inset:0;border-radius:inherit;background:radial-gradient(circle at var(--gx,30%) var(--gy,0%),rgba(255,255,255,var(--gl,.2)),rgba(255,255,255,0) 55%);mix-blend-mode:soft-light;z-index:2}'
    + '.pd-film{position:fixed;left:-20%;top:-20%;width:140%;height:140%;pointer-events:none;z-index:6;opacity:.1;mix-blend-mode:overlay;animation:pdfilm .7s steps(6) infinite}'
    + '@keyframes pdfilm{0%{transform:translate(0,0)}20%{transform:translate(-3%,2%)}40%{transform:translate(2%,-3%)}60%{transform:translate(-2%,-1%)}80%{transform:translate(3%,3%)}100%{transform:translate(0,0)}}'
    + '.pd-desk{filter:blur(.7px) saturate(1.06) contrast(1.04)}.pv-root.pd-tilt{will-change:transform}'
    + '@media(prefers-reduced-motion:reduce){.pd-film{animation:none}}'
    /* modules that move with the music: each listens to one part of the sound (kick, bass, vocal, snare, hi-hats) */
    + '.pv-sec[data-rx]{will-change:scale,translate,rotate}.pd-rx{inset:-1px;border-radius:inherit;opacity:calc(var(--rx,0) * .9);box-shadow:0 0 calc(10px + var(--rx,0) * 26px) 2px var(--rxc,var(--acc,#00c47d)),inset 0 0 calc(var(--rx,0) * 18px) var(--rxc,var(--acc,#00c47d));z-index:3}'
    + '.pv-sec[data-rx=kick]{scale:calc(1 + var(--rx,0) * .034)}.pv-sec[data-rx=bass]{translate:0 calc(var(--rx,0) * -4px);scale:calc(1 + var(--rx,0) * .01)}.pv-sec[data-rx=vocal]{scale:calc(1 + var(--rx,0) * .014)}.pv-sec[data-rx=vocal] .pd-rx{--rxc:var(--acc2,#6c8cff)}'
    + '.pv-sec[data-rx=snare]{rotate:calc(var(--rot,0deg) + var(--rx,0) * .45deg);scale:calc(1 + var(--rx,0) * .016)}.pv-sec[data-rx=snare] .pd-rx{--rxc:#ffffff}.pv-sec[data-rx=hats]{translate:calc(var(--rx,0) * 2px) 0;scale:calc(1 + var(--rx,0) * .008)}.pv-sec[data-rx=hats] .pd-rx{--rxc:#ffe9a6}'
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

    } else if (id === 'night-skyline') {
      b += '<defs><linearGradient id="nsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#040815"/><stop offset=".62" stop-color="#14224c"/><stop offset="1" stop-color="#3b3a66"/></linearGradient><radialGradient id="moon" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="rgba(255,248,220,.9)"/><stop offset="1" stop-color="rgba(255,248,220,0)"/></radialGradient></defs>';
      b += '<rect width="1600" height="900" fill="url(#nsky)"/>';
      for (let i = 0; i < 90; i++) b += '<circle cx="' + ((i * 211) % 1600) + '" cy="' + ((i * 97) % 330) + '" r="' + (0.6 + (i % 3) * 0.5) + '" fill="rgba(255,255,255,' + (0.3 + (i % 4) * 0.15) + ')"/>';
      b += '<circle cx="1280" cy="150" r="130" fill="url(#moon)"/><circle cx="1280" cy="150" r="46" fill="#fff6dc"/><circle cx="1262" cy="140" r="9" fill="rgba(190,180,150,.35)"/><circle cx="1296" cy="164" r="6" fill="rgba(190,180,150,.3)"/>';
      for (let i = 0; i < 38; i++) {
        const x = i * 44 - 10, h = 130 + ((i * 53) % 260), w = 38 + (i % 3) * 6, top = 560 - h;
        b += '<rect x="' + x + '" y="' + top + '" width="' + w + '" height="' + (h + 40) + '" fill="' + (i % 2 ? '#0a1124' : '#0d1630') + '"/>';
        for (let r = 0; r < Math.floor(h / 22); r++) for (let c = 0; c < 3; c++) if (((i * 7 + r * 5 + c * 11) % 5) < 2) b += '<rect x="' + (x + 6 + c * 12) + '" y="' + (top + 8 + r * 22) + '" width="7" height="11" fill="' + ((i + r + c) % 4 ? 'rgba(255,214,120,.85)' : 'rgba(150,210,255,.8)') + '"/>';
      }
      b += '<rect y="540" width="1600" height="30" fill="rgba(60,80,140,.25)"/><rect y="560" width="1600" height="340" fill="#120d0a"/><rect y="560" width="1600" height="340" fill="url(#deskTop)"/><rect y="556" width="1600" height="5" fill="rgba(160,190,255,.35)"/>';
      for (let i = 0; i < 3; i++) b += monitor(250 + i * 380, 590, 320, 190, i * 9 + 4, i !== 1);
      b += keyboard(520, 800, 520) + cup(1330, 790) + lamp(130, 640, '#16543a') + '<ellipse cx="170" cy="760" rx="220" ry="120" fill="url(#warm)"/>';
    } else if (id === 'sunrise-office') {
      b += '<defs><linearGradient id="sun1" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ffb36b"/><stop offset=".45" stop-color="#ffd9a8"/><stop offset="1" stop-color="#9fd0f5"/></linearGradient><radialGradient id="sunG" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="rgba(255,240,190,.95)"/><stop offset="1" stop-color="rgba(255,200,120,0)"/></radialGradient></defs>';
      b += '<rect width="1600" height="900" fill="#e9dcc8"/><rect x="140" y="50" width="1320" height="450" fill="url(#sun1)"/><circle cx="520" cy="430" r="230" fill="url(#sunG)"/><circle cx="520" cy="440" r="64" fill="#fff1c4"/>';
      for (let i = 0; i < 26; i++) b += '<rect x="' + (140 + i * 52) + '" y="' + (400 - ((i * 37) % 120)) + '" width="44" height="' + (110 + ((i * 37) % 120)) + '" fill="rgba(90,70,110,' + (0.16 + (i % 3) * 0.05) + ')"/>';
      b += '<g fill="none" stroke="#f6f1e6" stroke-width="16"><rect x="140" y="50" width="1320" height="450"/><line x1="580" y1="50" x2="580" y2="500"/><line x1="1020" y1="50" x2="1020" y2="500"/><line x1="140" y1="270" x2="1460" y2="270"/></g><rect x="130" y="496" width="1340" height="22" fill="#dcd0ba" stroke="rgba(0,0,0,.15)"/>';
      b += grain('#cfa56f', 'rgba(110,70,30,.28)', 'rgba(255,255,255,.18)').replace('<rect width="1600" height="900"', '<rect y="520" width="1600" height="380"') + '<rect y="520" width="1600" height="380" fill="url(#deskTop)"/>';
      b += '<g transform="translate(1290 520)"><rect x="-8" y="0" width="120" height="120" rx="14" fill="rgba(0,0,0,.25)" filter="url(#blur6)"/><path d="M46 120 L36 40" stroke="#3c7a3a" stroke-width="7"/><path d="M52 118 q40 -50 -6 -96 q-50 30 6 96" fill="#4f9a48"/><path d="M40 90 q-40 -30 -20 -76 q40 20 20 76" fill="#3f8a3c"/><path d="M60 70 q50 -10 62 -50 q-52 -2 -62 50" fill="#5aa653"/><rect y="104" width="94" height="86" rx="8" fill="#c9814f" stroke="#8a5430"/></g>';
      b += '<g transform="translate(520 640)"><rect x="8" y="14" width="540" height="300" rx="10" fill="rgba(0,0,0,.35)" filter="url(#blur6)"/><path d="M40 0 h460 l30 250 h-520z" fill="#1c1f26" stroke="#3a4048"/><rect x="62" y="16" width="416" height="214" rx="3" fill="#07121e"/>';
      let pts = '', ppx = 76, ppy = 190; for (let i = 0; i < 24; i++) { ppy += (((i * 19 + 7) % 21) - 10) * 1.3; ppy = Math.max(40, Math.min(210, ppy)); pts += f1(ppx) + ',' + f1(ppy + 14) + ' '; ppx += 16; }
      b += '<polyline points="' + pts + '" fill="none" stroke="#35e6a0" stroke-width="3"/><rect x="62" y="16" width="416" height="214" rx="3" fill="rgba(120,220,255,.07)"/><path d="M-6 250 h552 l-14 40 q-4 12 -20 12 h-484 q-16 0 -20 -12z" fill="#2a2e36" stroke="#4a5058"/></g>';
      b += cup(1130, 760) + paper(160, 640, 250, 190, -5, 9, '#fffdf3') + pen(300, 840, -12, '#1a3a8a') + '<ellipse cx="700" cy="500" rx="520" ry="90" fill="url(#warm)"/>';
    } else if (id === 'amber-terminal') {
      b += '<rect width="1600" height="900" fill="#0a0603"/>';
      for (let t = 0; t < 6; t++) {
        const x = 70 + (t % 3) * 500, y = 60 + Math.floor(t / 3) * 330;
        b += '<rect x="' + (x - 10) + '" y="' + (y - 10) + '" width="440" height="290" rx="12" fill="#14100a" stroke="#2a2216"/><rect x="' + x + '" y="' + y + '" width="420" height="270" rx="6" fill="#0b0703"/><rect x="' + (x - 24) + '" y="' + (y - 24) + '" width="468" height="318" fill="rgba(255,150,30,.08)" filter="url(#blur24)"/>';
        b += '<rect x="' + x + '" y="' + y + '" width="420" height="26" fill="rgba(255,176,40,.85)"/><text x="' + (x + 10) + '" y="' + (y + 19) + '" font-family="monospace" font-size="15" font-weight="700" fill="#1a0f00">' + ['EQUITY', 'FUTURES', 'FX', 'RATES', 'OPTIONS', 'NEWS'][t] + ' &lt;GO&gt;</text>';
        for (let r = 0; r < 12; r++) { const wd = 120 + ((t * 53 + r * 37) % 250); b += '<rect x="' + (x + 12) + '" y="' + (y + 40 + r * 19) + '" width="' + wd + '" height="7" fill="rgba(255,176,40,' + (r % 4 === 0 ? 0.95 : 0.55) + ')"/><rect x="' + (x + 12 + wd + 10) + '" y="' + (y + 40 + r * 19) + '" width="' + (30 + ((r * 13 + t) % 40)) + '" height="7" fill="' + ((r + t) % 3 ? 'rgba(90,255,150,.8)' : 'rgba(255,100,90,.85)') + '"/>'; }
        b += '<rect x="' + x + '" y="' + y + '" width="420" height="270" rx="6" fill="none" stroke="rgba(255,176,40,.25)"><animate attributeName="stroke-opacity" values=".15;.5;.15" dur="' + (2 + t % 3) + 's" repeatCount="indefinite"/></rect>';
      }
      b += '<rect y="730" width="1600" height="170" fill="#100c08"/><rect y="730" width="1600" height="170" fill="url(#deskTop)"/><rect y="726" width="1600" height="4" fill="rgba(255,176,40,.3)"/>' + keyboard(480, 770, 560) + cup(1330, 770) + pen(1180, 840, -6, '#8a1a1a');
    } else if (id === 'library-study') {
      b += '<rect width="1600" height="900" fill="#1e130b"/>';
      const cols = ['#7a1f1f', '#1f3a5a', '#2f5a3a', '#6b4a1f', '#4a2a5a', '#8a6a2a', '#2a2a2a', '#5a1f3a', '#1f4a4a'];
      for (let sh = 0; sh < 4; sh++) {
        const y = 40 + sh * 150; let x = 50;
        for (let i = 0; x < 1550; i++) { const w = 22 + ((i * 17 + sh * 5) % 22), h = 96 + ((i * 29 + sh * 11) % 40); b += '<rect x="' + x + '" y="' + (y + 120 - h) + '" width="' + w + '" height="' + h + '" fill="' + cols[(i * 3 + sh) % cols.length] + '" stroke="rgba(0,0,0,.45)"/><rect x="' + (x + 3) + '" y="' + (y + 120 - h + 12) + '" width="' + (w - 6) + '" height="3" fill="rgba(226,184,105,.7)"/>'; x += w + 2; }
        b += '<rect x="30" y="' + (y + 120) + '" width="1540" height="18" fill="#3a2414" stroke="#1d0f07"/><rect x="30" y="' + (y + 120) + '" width="1540" height="3" fill="rgba(255,220,170,.3)"/>';
      }
      b += '<rect width="1600" height="900" fill="rgba(0,0,0,.28)"/><rect y="640" width="1600" height="260" fill="#3a2214"/><rect y="640" width="1600" height="260" fill="url(#deskTop)"/><rect y="636" width="1600" height="6" fill="rgba(255,220,170,.35)"/>';
      b += '<g transform="translate(1260 520)"><ellipse cx="60" cy="150" rx="70" ry="14" fill="rgba(0,0,0,.45)"/><circle cx="60" cy="60" r="62" fill="#1f4a6a" stroke="#c9a23a" stroke-width="4"/><path d="M20 30 q30 -20 50 10 q10 30 -20 40 q-30 -10 -30 -50z" fill="#4a8a4a"/><path d="M70 70 q30 -10 40 20 q-10 24 -34 12z" fill="#4a8a4a"/><ellipse cx="60" cy="60" rx="62" ry="14" fill="none" stroke="rgba(226,184,105,.7)"/><rect x="52" y="122" width="16" height="26" fill="#c9a23a"/></g>';
      b += '<g transform="translate(420 700) rotate(-3)"><rect x="6" y="10" width="520" height="150" rx="6" fill="rgba(0,0,0,.45)" filter="url(#blur6)"/><path d="M0 0 h250 q10 0 10 10 v130 h-250 q-10 0 -10 -10z" fill="#f4eed8" stroke="#bfb48f"/><path d="M270 10 q0 -10 10 -10 h250 v140 h-250 q-10 0 -10 -10z" fill="#f4eed8" stroke="#bfb48f"/>';
      for (let i = 0; i < 9; i++) b += '<line x1="22" y1="' + (24 + i * 13) + '" x2="' + (238 - ((i * 23) % 40)) + '" y2="' + (24 + i * 13) + '" stroke="rgba(40,30,20,.35)"/><line x1="290" y1="' + (24 + i * 13) + '" x2="' + (512 - ((i * 31) % 50)) + '" y2="' + (24 + i * 13) + '" stroke="rgba(40,30,20,.35)"/>';
      b += '</g>' + lamp(180, 520, '#1f6b4a') + '<ellipse cx="240" cy="700" rx="260" ry="140" fill="url(#warm)"/>' + pen(900, 850, 6, '#c9a23a');
    } else if (id === 'penthouse') {
      b += '<defs><linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1646"/><stop offset=".5" stop-color="#7a3f7a"/><stop offset=".8" stop-color="#ee8a5a"/><stop offset="1" stop-color="#ffcf8a"/></linearGradient><linearGradient id="gfloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1d26"/><stop offset="1" stop-color="#07080c"/></linearGradient></defs>';
      b += '<rect width="1600" height="640" fill="url(#dusk)"/>';
      for (let i = 0; i < 60; i++) b += '<circle cx="' + ((i * 257) % 1600) + '" cy="' + ((i * 83) % 260) + '" r="' + (0.7 + (i % 3) * 0.4) + '" fill="rgba(255,255,255,' + (0.25 + (i % 3) * 0.2) + ')"/>';
      for (let i = 0; i < 34; i++) { const x = i * 50 - 20, h = 90 + ((i * 61) % 300); b += '<rect x="' + x + '" y="' + (640 - h) + '" width="' + (44 + (i % 3) * 8) + '" height="' + h + '" fill="rgba(20,14,40,' + (0.55 + (i % 4) * 0.1) + ')"/>'; for (let r = 0; r < Math.floor(h / 26); r++) if ((i + r * 3) % 4 === 0) b += '<rect x="' + (x + 8 + (r % 3) * 12) + '" y="' + (640 - h + 10 + r * 26) + '" width="7" height="10" fill="rgba(255,225,150,.8)"/>'; }
      b += '<g fill="none" stroke="rgba(230,235,245,.5)" stroke-width="6"><line x1="400" y1="0" x2="400" y2="640"/><line x1="800" y1="0" x2="800" y2="640"/><line x1="1200" y1="0" x2="1200" y2="640"/></g>';
      b += '<rect y="640" width="1600" height="260" fill="url(#gfloor)"/><rect y="636" width="1600" height="6" fill="rgba(255,255,255,.18)"/>';
      for (let i = 0; i < 18; i++) b += '<rect x="' + (i * 90 + 20) + '" y="650" width="4" height="' + (30 + ((i * 17) % 60)) + '" fill="rgba(255,200,130,' + (0.18 + (i % 3) * 0.08) + ')"/>';
      b += '<g transform="translate(300 700)"><rect x="6" y="12" width="1000" height="22" rx="6" fill="rgba(0,0,0,.5)" filter="url(#blur6)"/><rect width="1000" height="20" rx="6" fill="rgba(200,225,255,.22)" stroke="rgba(255,255,255,.4)"/><rect y="20" width="1000" height="6" fill="rgba(160,200,240,.18)"/></g>';
      b += '<g transform="translate(1200 640)"><path d="M0 70 l8 -70 h6 l8 70z M3 70 h16 M11 70 v40 M0 110 h22" fill="rgba(255,255,255,.35)" stroke="rgba(255,255,255,.6)"/><ellipse cx="11" cy="0" rx="14" ry="6" fill="rgba(255,226,150,.5)"/></g>' + keyboard(560, 770, 420);
    } else if (id === 'war-room') {
      b += '<rect width="1600" height="900" fill="#4a4d52"/><rect x="100" y="50" width="1400" height="640" rx="8" fill="#e9ece9" stroke="#9aa0a6" stroke-width="14"/><rect x="100" y="50" width="1400" height="640" rx="8" fill="rgba(255,255,255,.2)"/>';
      b += '<path d="M130 290 L1470 290" stroke="rgba(20,40,120,.25)" stroke-width="2"/><path d="M130 480 L1470 480" stroke="rgba(20,40,120,.25)" stroke-width="2"/>';
      b += '<polyline points="170,520 290,470 360,500 470,400 560,430 680,300 760,340 880,220 980,260 1100,140" fill="none" stroke="#1d4fd8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><polyline points="170,600 300,570 420,590 540,520 660,540 780,480 900,500" fill="none" stroke="#c0392b" stroke-width="7" stroke-linecap="round" stroke-dasharray="14 10"/>';
      b += '<circle cx="1100" cy="140" r="38" fill="none" stroke="#c0392b" stroke-width="6"/><path d="M1180 110 l-34 22 m34 -22 l-4 24" stroke="#c0392b" stroke-width="6" fill="none" stroke-linecap="round"/><text x="1200" y="116" font-family="Comic Sans MS,cursive" font-size="40" font-weight="700" fill="#c0392b">TARGET</text><text x="190" y="120" font-family="Comic Sans MS,cursive" font-size="46" font-weight="700" fill="#1d4fd8">PLAN</text><text x="190" y="170" font-family="Comic Sans MS,cursive" font-size="30" fill="#16a34a">1. wait  2. confirm  3. size</text>';
      b += '<rect x="170" y="540" width="320" height="86" rx="4" fill="none" stroke="#16a34a" stroke-width="5"/><text x="190" y="596" font-family="Comic Sans MS,cursive" font-size="34" fill="#16a34a">RISK 1%</text>';
      const notes = [[1180, 380, 190, 150, 4, '#fff08a'], [1260, 540, 190, 130, -5, '#ffb3c1'], [1010, 470, 160, 150, -3, '#a8e6cf']];
      for (const n of notes) b += paper(n[0], n[1], n[2], n[3], n[4], 6, n[5]) + pin(n[0] + n[2] / 2, n[1] + 10, '#d62d2d');
      b += '<rect x="100" y="690" width="1400" height="26" fill="#8a8e93" stroke="#5e6267"/><rect x="180" y="680" width="130" height="18" rx="6" fill="#1d4fd8"/><rect x="340" y="680" width="130" height="18" rx="6" fill="#c0392b"/><rect x="500" y="680" width="130" height="18" rx="6" fill="#16a34a"/><rect y="716" width="1600" height="184" fill="#22262c"/><rect y="716" width="1600" height="184" fill="url(#deskTop)"/>' + cup(1300, 790) + paper(700, 760, 300, 120, -3, 6);
    } else if (id === 'drafting-table') {
      b += '<rect width="1600" height="900" fill="#0d3f78"/>';
      for (let i = 0; i <= 80; i++) b += '<line x1="' + (i * 20) + '" y1="0" x2="' + (i * 20) + '" y2="900" stroke="rgba(255,255,255,' + (i % 5 ? 0.07 : 0.2) + ')"/>';
      for (let i = 0; i <= 45; i++) b += '<line x1="0" y1="' + (i * 20) + '" x2="1600" y2="' + (i * 20) + '" stroke="rgba(255,255,255,' + (i % 5 ? 0.07 : 0.2) + ')"/>';
      b += '<g fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2"><circle cx="420" cy="360" r="180"/><circle cx="420" cy="360" r="120" stroke-dasharray="10 6"/><circle cx="420" cy="360" r="6"/><line x1="200" y1="360" x2="640" y2="360" stroke-dasharray="18 6 4 6"/><line x1="420" y1="140" x2="420" y2="580" stroke-dasharray="18 6 4 6"/><rect x="820" y="180" width="520" height="320"/><rect x="860" y="220" width="440" height="240" stroke-dasharray="8 6"/><path d="M820 500 L1340 180 M820 180 L1340 500"/><path d="M200 700 H700 M200 680 v40 M700 680 v40"/><path d="M230 700 l10 -8 m-10 8 l10 8 M670 700 l-10 -8 m10 8 l-10 8"/></g>';
      b += '<text x="880" y="560" font-family="monospace" font-size="26" fill="rgba(255,255,255,.75)">SCALE 1:50  ·  SHEET 04 / 12</text><text x="230" y="690" font-family="monospace" font-size="22" fill="rgba(255,255,255,.75)">24.00 m</text>';
      b += '<g transform="translate(120 760) rotate(-4)"><rect x="6" y="8" width="1300" height="46" fill="rgba(0,0,0,.4)" filter="url(#blur6)"/><rect width="1300" height="40" rx="3" fill="rgba(240,230,160,.85)" stroke="#a89a50"/>';
      for (let i = 0; i < 65; i++) b += '<line x1="' + (10 + i * 20) + '" y1="0" x2="' + (10 + i * 20) + '" y2="' + (i % 5 ? 12 : 22) + '" stroke="rgba(60,50,10,.8)"/>';
      b += '</g><g transform="translate(1280 600) rotate(20)"><path d="M0 0 l30 120 M60 0 l-30 120" stroke="#cfd5db" stroke-width="10" stroke-linecap="round"/><circle cx="30" cy="-6" r="14" fill="#9aa3ab" stroke="#6b7480"/><path d="M30 120 l-4 18 l8 0z" fill="#222"/></g>' + pen(1030, 820, -16, '#c9a23a') + pen(1070, 850, 4, '#222222');

    } else if (id === 'rooftop-terrace') {
      b += '<defs><linearGradient id="rsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1030"/><stop offset=".7" stop-color="#3a2f6a"/><stop offset="1" stop-color="#d9784a"/></linearGradient></defs><rect width="1600" height="900" fill="url(#rsky)"/>';
      for (let i = 0; i < 70; i++) b += '<circle cx="' + ((i * 233) % 1600) + '" cy="' + ((i * 71) % 300) + '" r="' + (0.6 + (i % 3) * 0.4) + '" fill="rgba(255,255,255,' + (0.3 + (i % 3) * 0.2) + ')"/>';
      for (let i = 0; i < 40; i++) { const x = i * 42 - 10, h = 100 + ((i * 59) % 260); b += '<rect x="' + x + '" y="' + (600 - h) + '" width="' + (36 + (i % 3) * 6) + '" height="' + h + '" fill="rgba(14,10,36,' + (0.7 + (i % 3) * 0.1) + ')"/>'; for (let r = 0; r < Math.floor(h / 24); r++) if ((i * 3 + r * 5) % 4 === 0) b += '<rect x="' + (x + 7 + (r % 3) * 11) + '" y="' + (600 - h + 9 + r * 24) + '" width="6" height="9" fill="rgba(255,214,130,.8)"/>'; }
      b += '<path d="M0 90 Q400 230 800 110 T1600 130" fill="none" stroke="#1a1410" stroke-width="3"/><path d="M0 160 Q500 300 900 190 T1600 210" fill="none" stroke="#1a1410" stroke-width="3"/>';
      for (let i = 0; i < 30; i++) { const u = i / 29, x = u * 1600, y = 90 + Math.sin(u * 3.2) * 70 + 60 * Math.sin(u * Math.PI * 2) * 0.1 + 40; b += '<circle cx="' + f1(x) + '" cy="' + f1(y) + '" r="30" fill="url(#warm)"/><circle cx="' + f1(x) + '" cy="' + f1(y) + '" r="5" fill="#fff0c0"/>'; }
      b += '<rect y="600" width="1600" height="300" fill="#3a2a1c"/>';
      for (let i = 0; i < 20; i++) b += '<rect x="0" y="' + (600 + i * 15 + i * i * 0.35) + '" width="1600" height="' + (13 + i * 0.35) + '" fill="' + (i % 2 ? '#4a3524' : '#3f2d1d') + '" stroke="rgba(0,0,0,.4)"/>';
      b += '<rect y="596" width="1600" height="8" fill="#241a12"/><g transform="translate(1320 470)"><ellipse cx="60" cy="150" rx="70" ry="12" fill="rgba(0,0,0,.4)"/><path d="M20 150 q-10 -60 40 -80 q50 20 40 80z" fill="#6a4a2a" stroke="#3a2614"/><path d="M60 70 q-50 -30 -40 -70 q36 10 40 70 M60 70 q50 -30 40 -70 q-36 10 -40 70 M60 70 q0 -60 0 -80" fill="#3c8a46" stroke="#1f5a2a"/></g>';
      b += '<g transform="translate(560 740)"><rect x="8" y="14" width="440" height="100" rx="8" fill="rgba(0,0,0,.4)" filter="url(#blur6)"/><rect width="440" height="92" rx="8" fill="#1b1d23" stroke="#3a4048"/><rect x="14" y="10" width="412" height="72" rx="4" fill="#07121e"/></g>' + cup(1180, 760) + '<ellipse cx="700" cy="640" rx="560" ry="100" fill="url(#warm)"/>';
    } else if (id === 'beach-office') {
      b += '<defs><linearGradient id="bsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fc4f0"/><stop offset="1" stop-color="#ffe2c0"/></linearGradient><linearGradient id="bsea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f9fbf"/><stop offset="1" stop-color="#7fe0e0"/></linearGradient></defs><rect width="1600" height="900" fill="url(#bsky)"/><circle cx="1180" cy="220" r="150" fill="url(#warm)"/><circle cx="1180" cy="220" r="52" fill="#fff6d0"/>';
      for (let i = 0; i < 4; i++) b += '<ellipse cx="' + (240 + i * 380) + '" cy="' + (140 + (i % 2) * 40) + '" rx="150" ry="26" fill="rgba(255,255,255,.7)"/><ellipse cx="' + (300 + i * 380) + '" cy="' + (120 + (i % 2) * 40) + '" rx="90" ry="24" fill="rgba(255,255,255,.7)"/>';
      b += '<rect y="430" width="1600" height="220" fill="url(#bsea)"/>';
      for (let i = 0; i < 18; i++) b += '<path d="M' + ((i * 97) % 1500) + ' ' + (450 + (i * 23) % 190) + ' q30 -14 60 0 t60 0" fill="none" stroke="rgba(255,255,255,' + (0.3 + (i % 3) * 0.15) + ')" stroke-width="3"/>';
      b += '<path d="M0 650 C300 610 700 670 1100 630 S1500 650 1600 640 V700 H0z" fill="#fff5dc"/><rect y="640" width="1600" height="260" fill="#e8d5a3"/>';
      for (let i = 0; i < 600; i++) b += '<circle cx="' + ((i * 197) % 1600) + '" cy="' + (650 + (i * 89) % 250) + '" r="' + (1 + (i % 3)) + '" fill="' + (i % 2 ? 'rgba(150,115,60,.3)' : 'rgba(255,255,255,.4)') + '"/>';
      b += '<g transform="translate(90 120)"><path d="M120 560 Q150 360 90 140" fill="none" stroke="#6a4a2a" stroke-width="22" stroke-linecap="round"/><path d="M90 140 q-80 -30 -110 20 M90 140 q-10 -80 -90 -80 M90 140 q60 -60 130 -30 M90 140 q80 0 120 70 M90 140 q-60 20 -90 90" fill="none" stroke="#2f8a3c" stroke-width="18" stroke-linecap="round"/></g>';
      b += '<g transform="translate(560 700)"><rect x="8" y="12" width="500" height="26" rx="6" fill="rgba(0,0,0,.35)" filter="url(#blur6)"/><rect width="500" height="24" rx="6" fill="#a8764a" stroke="#6b4a2a"/><rect x="40" y="24" width="14" height="90" fill="#8a5e38"/><rect x="446" y="24" width="14" height="90" fill="#8a5e38"/></g>' + cup(1100, 640);
    } else if (id === 'space-station') {
      b += '<rect width="1600" height="900" fill="#02040c"/>';
      for (let i = 0; i < 260; i++) b += '<circle cx="' + ((i * 311) % 1600) + '" cy="' + ((i * 127) % 640) + '" r="' + (0.5 + (i % 4) * 0.45) + '" fill="rgba(255,255,255,' + (0.25 + (i % 5) * 0.14) + ')"/>';
      b += '<defs><radialGradient id="planet" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#7fd0ff"/><stop offset=".5" stop-color="#2a6ab0"/><stop offset="1" stop-color="#06142e"/></radialGradient><radialGradient id="atmo" cx=".5" cy=".5" r=".5"><stop offset=".9" stop-color="rgba(120,200,255,.5)"/><stop offset="1" stop-color="rgba(120,200,255,0)"/></radialGradient></defs>';
      b += '<circle cx="380" cy="1100" r="640" fill="url(#atmo)"/><circle cx="380" cy="1100" r="600" fill="url(#planet)"/><path d="M-100 700 q200 -40 420 -10 q-150 -30 -250 20z M300 560 q160 -20 260 20 q-120 -10 -200 30z" fill="rgba(255,255,255,.5)"/>';
      b += '<circle cx="1300" cy="150" r="50" fill="#e8d9b0"/><circle cx="1288" cy="140" r="10" fill="rgba(0,0,0,.18)"/><circle cx="1316" cy="164" r="7" fill="rgba(0,0,0,.18)"/>';
      b += '<path d="M0 620 H1600 V900 H0z" fill="#2a303a"/><rect y="610" width="1600" height="16" fill="#4a5262"/><rect y="610" width="1600" height="3" fill="rgba(255,255,255,.3)"/>';
      for (let i = 0; i < 16; i++) b += '<circle cx="' + (40 + i * 104) + '" cy="632" r="4" fill="#6a7284"/>';
      b += '<g stroke="#4a5262" stroke-width="14" fill="none"><line x1="0" y1="0" x2="0" y2="620"/><line x1="1600" y1="0" x2="1600" y2="620"/><line x1="800" y1="0" x2="800" y2="620"/><line x1="0" y1="0" x2="1600" y2="0"/></g>';
      for (let r = 0; r < 3; r++) for (let c = 0; c < 22; c++) { const col = ['#35e6a0', '#ff6b7f', '#ffd166', '#5ab8ff'][(r * 7 + c * 3) % 4]; b += '<rect x="' + (60 + c * 68) + '" y="' + (700 + r * 54) + '" width="46" height="26" rx="5" fill="#161b24" stroke="#343c4a"/><rect x="' + (66 + c * 68) + '" y="' + (706 + r * 54) + '" width="34" height="14" rx="3" fill="' + col + '" opacity="' + (0.35 + ((c * 5 + r * 3) % 4) * 0.2) + '"><animate attributeName="opacity" values="' + (0.25 + (c % 3) * 0.1) + ';0.95;' + (0.25 + (c % 3) * 0.1) + '" dur="' + (2 + (c + r) % 4) + 's" repeatCount="indefinite"/></rect>'; }
    } else if (id === 'cafe-table') {
      b += '<rect width="1600" height="900" fill="#2a1a12"/>';
      const bk = ['rgba(255,190,100,.55)', 'rgba(255,140,80,.45)', 'rgba(255,230,160,.5)', 'rgba(255,170,120,.4)'];
      for (let i = 0; i < 46; i++) b += '<circle cx="' + ((i * 241) % 1600) + '" cy="' + ((i * 113) % 520) + '" r="' + (18 + (i % 5) * 14) + '" fill="' + bk[i % 4] + '" filter="url(#blur6)"/>';
      b += '<rect x="120" y="60" width="1360" height="520" fill="rgba(20,30,50,.35)"/><g stroke="rgba(255,255,255,.12)" stroke-width="2">';
      for (let i = 0; i < 90; i++) b += '<line x1="' + ((i * 53) % 1480 + 120) + '" y1="' + ((i * 37) % 480 + 60) + '" x2="' + ((i * 53) % 1480 + 112) + '" y2="' + ((i * 37) % 480 + 130) + '"/>';
      b += '</g><g fill="none" stroke="#1a110c" stroke-width="22"><rect x="120" y="60" width="1360" height="520"/><line x1="800" y1="60" x2="800" y2="580"/></g>';
      b += '<rect y="580" width="1600" height="320" fill="#3a2418"/><ellipse cx="800" cy="720" rx="640" ry="190" fill="rgba(0,0,0,.4)" filter="url(#blur24)"/><ellipse cx="800" cy="700" rx="620" ry="180" fill="#e9e7e2" stroke="#b9b6ae" stroke-width="4"/><ellipse cx="800" cy="694" rx="600" ry="170" fill="rgba(255,255,255,.5)"/>';
      b += '<path d="M300 700 q120 -60 260 -20 M900 760 q200 -50 380 -10 M520 640 q100 30 210 10" fill="none" stroke="rgba(90,100,115,.35)" stroke-width="3"/>' + cup(540, 650) + paper(980, 640, 240, 170, 8, 8, '#fffdf3') + pen(1010, 830, -8, '#1a3a8a');
      b += '<g transform="translate(300 740) rotate(-12)"><rect width="90" height="170" rx="14" fill="#15181d" stroke="#3a4048"/><rect x="6" y="10" width="78" height="140" rx="6" fill="#0a2038"/><rect x="14" y="20" width="62" height="10" rx="3" fill="rgba(255,255,255,.4)"/></g><ellipse cx="740" cy="760" rx="60" ry="26" fill="#e8b66a" stroke="#a87a30"/><path d="M700 760 q40 -34 80 0" fill="none" stroke="#a87a30" stroke-width="3"/>';
    } else if (id === 'vault-room') {
      b += '<rect width="1600" height="900" fill="#4a4f57"/>';
      for (let i = 0; i < 90; i++) b += '<line x1="0" y1="' + (i * 10) + '" x2="1600" y2="' + (i * 10 + (i % 3)) + '" stroke="' + (i % 2 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)') + '"/>';
      b += '<defs><radialGradient id="vdoor" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#cfd5dc"/><stop offset=".6" stop-color="#7a828c"/><stop offset="1" stop-color="#3a4048"/></radialGradient></defs>';
      b += '<circle cx="800" cy="400" r="330" fill="rgba(0,0,0,.5)" filter="url(#blur24)"/><circle cx="800" cy="400" r="320" fill="url(#vdoor)" stroke="#2a2f36" stroke-width="10"/><circle cx="800" cy="400" r="270" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="8"/><circle cx="800" cy="400" r="270" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2"/>';
      for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283; b += '<circle cx="' + f1(800 + Math.cos(a) * 296) + '" cy="' + f1(400 + Math.sin(a) * 296) + '" r="11" fill="#9aa3ad" stroke="#2a2f36" stroke-width="3"/>'; }
      b += '<circle cx="800" cy="400" r="86" fill="#2a2f36" stroke="#9aa3ad" stroke-width="8"/>';
      for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283 + 0.3; b += '<line x1="800" y1="400" x2="' + f1(800 + Math.cos(a) * 200) + '" y2="' + f1(400 + Math.sin(a) * 200) + '" stroke="#b8c0c9" stroke-width="18" stroke-linecap="round"/><circle cx="' + f1(800 + Math.cos(a) * 200) + '" cy="' + f1(400 + Math.sin(a) * 200) + '" r="22" fill="#d0d6dd" stroke="#2a2f36" stroke-width="3"/>'; }
      b += '<circle cx="800" cy="400" r="34" fill="#c9a23a" stroke="#7d5a14" stroke-width="4"/>';
      b += '<rect y="740" width="1600" height="160" fill="#2a2d33"/><rect y="740" width="1600" height="160" fill="url(#deskTop)"/>';
      const stack = (x, y, n) => { let t = ''; for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) t += '<polygon points="' + (x + j * 74 + i * 37) + ',' + (y - i * 26) + ' ' + (x + j * 74 + i * 37 + 66) + ',' + (y - i * 26) + ' ' + (x + j * 74 + i * 37 + 56) + ',' + (y - i * 26 - 22) + ' ' + (x + j * 74 + i * 37 + 10) + ',' + (y - i * 26 - 22) + '" fill="#d9aa30" stroke="#8a640c"/><polygon points="' + (x + j * 74 + i * 37 + 10) + ',' + (y - i * 26 - 22) + ' ' + (x + j * 74 + i * 37 + 56) + ',' + (y - i * 26 - 22) + ' ' + (x + j * 74 + i * 37 + 50) + ',' + (y - i * 26 - 26) + ' ' + (x + j * 74 + i * 37 + 16) + ',' + (y - i * 26 - 26) + '" fill="#f6dd7c"/>'; return t; };
      b += stack(70, 880, 4) + stack(1190, 880, 4) + '<ellipse cx="800" cy="520" rx="640" ry="160" fill="url(#warm)" opacity=".5"/>';
    } else if (id === 'music-studio') {
      b += '<rect width="1600" height="900" fill="#150f12"/>';
      for (let r = 0; r < 12; r++) for (let c = 0; c < 26; c++) { const x = c * 64, y = r * 52; b += '<polygon points="' + x + ',' + (y + 52) + ' ' + (x + 32) + ',' + y + ' ' + (x + 64) + ',' + (y + 52) + '" fill="' + ((r + c) % 2 ? '#241a1f' : '#1b1317') + '" stroke="rgba(0,0,0,.5)"/><polygon points="' + (x + 32) + ',' + y + ' ' + (x + 64) + ',' + (y + 52) + ' ' + (x + 32) + ',' + (y + 52) + '" fill="rgba(255,255,255,.04)"/>'; }
      b += '<rect x="620" y="40" width="360" height="90" rx="14" fill="#2a0a0a" stroke="#4a1010" stroke-width="4"/><rect x="632" y="52" width="336" height="66" rx="8" fill="#ff2a2a" opacity=".9"><animate attributeName="opacity" values=".55;1;.55" dur="2.4s" repeatCount="indefinite"/></rect><text x="800" y="102" text-anchor="middle" font-family="Impact,Arial Black,sans-serif" font-size="52" fill="#ffe8e8">ON AIR</text><circle cx="800" cy="85" r="190" fill="rgba(255,40,40,.18)" filter="url(#blur24)"/>';
      const spk = (x) => '<g transform="translate(' + x + ' 190)"><rect x="8" y="12" width="230" height="380" rx="14" fill="rgba(0,0,0,.45)" filter="url(#blur6)"/><rect width="230" height="380" rx="12" fill="#1b1d23" stroke="#3a4048"/><circle cx="115" cy="110" r="46" fill="#0d0f13" stroke="#444b56" stroke-width="5"/><circle cx="115" cy="110" r="20" fill="#2a2f38"/><circle cx="115" cy="270" r="86" fill="#0d0f13" stroke="#444b56" stroke-width="6"/><circle cx="115" cy="270" r="52" fill="#171a20" stroke="#2f343e" stroke-width="3"/><circle cx="115" cy="270" r="20" fill="#2a2f38"/></g>';
      b += spk(130) + spk(1240);
      b += '<rect y="640" width="1600" height="260" fill="#1a1316"/><g transform="translate(260 610)"><rect x="8" y="14" width="1080" height="250" rx="16" fill="rgba(0,0,0,.5)" filter="url(#blur6)"/><path d="M0 40 q0 -26 26 -26 h1028 q26 0 26 26 v200 h-1080z" fill="#262a32" stroke="#444b56"/>';
      for (let i = 0; i < 24; i++) { const x = 40 + i * 43, lv = 40 + ((i * 37) % 110); b += '<rect x="' + (x + 12) + '" y="60" width="6" height="150" rx="3" fill="#0d0f13"/><rect x="' + x + '" y="' + (60 + lv) + '" width="30" height="16" rx="3" fill="#d8dce2" stroke="#6a7280"><animate attributeName="y" values="' + (60 + lv) + ';' + (60 + ((lv + 40) % 120) + 10) + ';' + (60 + lv) + '" dur="' + (3 + i % 5) + 's" repeatCount="indefinite"/></rect><circle cx="' + (x + 15) + '" cy="42" r="8" fill="' + ['#ff6b7f', '#ffd166', '#35e6a0', '#5ab8ff'][i % 4] + '"/>'; }
      b += '</g>' + keyboard(560, 840, 480);

    } else if (id === 'mountain-cabin') {
      b += '<rect width="1600" height="900" fill="#4a3020"/>';
      for (let i = 0; i < 18; i++) b += '<rect y="' + (i * 38) + '" width="1600" height="36" fill="' + (i % 2 ? '#573824' : '#4e3220') + '" stroke="rgba(0,0,0,.4)"/><path d="M0 ' + (i * 38 + 18) + ' q400 -6 800 2 t800 -2" fill="none" stroke="rgba(0,0,0,.18)"/>';
      b += '<defs><linearGradient id="msky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fb8e0"/><stop offset="1" stop-color="#e6eef8"/></linearGradient></defs><rect x="420" y="70" width="760" height="470" fill="url(#msky)"/><polygon points="420,420 600,230 700,330 860,150 1040,360 1120,300 1180,420 1180,540 420,540" fill="#dfe8f2"/><polygon points="860,150 920,230 880,215 850,260 820,215 800,232" fill="#fff"/><polygon points="420,470 560,380 700,470 900,360 1100,480 1180,440 1180,540 420,540" fill="#b8c9dc"/>';
      for (let i = 0; i < 22; i++) { const x = 430 + i * 34, h = 60 + ((i * 29) % 70); b += '<polygon points="' + x + ',540 ' + (x + 16) + ',' + (540 - h) + ' ' + (x + 32) + ',540" fill="#1f4a32"/><polygon points="' + (x + 4) + ',' + (540 - h * 0.6) + ' ' + (x + 16) + ',' + (540 - h) + ' ' + (x + 28) + ',' + (540 - h * 0.6) + '" fill="rgba(255,255,255,.7)"/>'; }
      for (let i = 0; i < 120; i++) b += '<circle cx="' + (420 + (i * 83) % 760) + '" cy="' + (70 + (i * 41) % 470) + '" r="' + (1 + i % 3) + '" fill="rgba(255,255,255,.8)"/>';
      b += '<g fill="none" stroke="#2a1a10" stroke-width="22"><rect x="420" y="70" width="760" height="470"/><line x1="800" y1="70" x2="800" y2="540"/><line x1="420" y1="305" x2="1180" y2="305"/></g><rect x="396" y="540" width="808" height="26" fill="#3a2414" stroke="#1d0f07"/>';
      b += '<g transform="translate(1290 260)"><rect width="230" height="330" fill="#6a6258" stroke="#3a342c" stroke-width="4"/>';
      for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) b += '<rect x="' + (10 + c * 72 + (r % 2) * 20) + '" y="' + (10 + r * 52) + '" width="62" height="44" rx="6" fill="' + ((r + c) % 2 ? '#7d756a' : '#5d564d') + '" stroke="rgba(0,0,0,.35)"/>';
      b += '<path d="M40 330 v-120 q75 -70 150 0 v120z" fill="#120a06" stroke="#2a2018" stroke-width="5"/><path d="M80 330 q-20 -60 20 -90 q10 40 40 20 q30 30 10 70z" fill="#ff8a2a"/><path d="M100 330 q-6 -40 20 -60 q20 24 14 60z" fill="#ffd060"/><ellipse cx="115" cy="320" rx="150" ry="110" fill="url(#warm)"/></g>';
      b += '<rect y="620" width="1600" height="280" fill="#4a2c18"/><rect y="620" width="1600" height="280" fill="url(#deskTop)"/><rect y="616" width="1600" height="6" fill="rgba(255,220,170,.35)"/>' + cup(520, 700) + lamp(180, 480, '#8a5a1a') + paper(820, 700, 300, 150, -4, 9, '#efe9d6') + pen(1200, 830, -6, '#222222');
    } else if (id === 'neon-city') {
      b += '<defs><linearGradient id="csky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0518"/><stop offset=".7" stop-color="#1c0f3a"/><stop offset="1" stop-color="#3a1850"/></linearGradient></defs><rect width="1600" height="900" fill="url(#csky)"/>';
      const neon = ['#ff2d95', '#2de2ff', '#b44dff', '#ffd23d'];
      for (let i = 0; i < 16; i++) { const x = i * 106 - 20, h = 260 + ((i * 71) % 300), c = neon[i % 4]; b += '<rect x="' + x + '" y="' + (620 - h) + '" width="96" height="' + (h + 40) + '" fill="rgba(10,6,24,.92)" stroke="rgba(255,255,255,.05)"/>'; for (let r = 0; r < Math.floor(h / 30); r++) if ((i + r * 3) % 3 === 0) b += '<rect x="' + (x + 10 + (r % 3) * 28) + '" y="' + (620 - h + 12 + r * 30) + '" width="16" height="12" fill="' + ((i + r) % 2 ? 'rgba(255,214,120,.7)' : 'rgba(120,220,255,.7)') + '"/>'; b += '<rect x="' + (x + 70) + '" y="' + (620 - h + 40) + '" width="10" height="' + Math.min(160, h - 80) + '" fill="' + c + '" opacity=".95"><animate attributeName="opacity" values=".95;.5;.95" dur="' + (2 + i % 4) + 's" repeatCount="indefinite"/></rect><rect x="' + (x + 60) + '" y="' + (620 - h + 30) + '" width="30" height="' + Math.min(180, h - 60) + '" fill="' + c + '" opacity=".18" filter="url(#blur6)"/>'; }
      b += '<g font-family="Arial Black,Impact,sans-serif" font-weight="900"><text x="170" y="250" font-size="64" fill="#ff2d95">BAR</text><text x="170" y="250" font-size="64" fill="none" stroke="#ff9ad0" stroke-width="1">BAR</text><text x="1140" y="200" font-size="58" fill="#2de2ff">24H</text><text x="760" y="320" font-size="46" fill="#ffd23d">RAMEN</text></g><rect x="150" y="190" width="170" height="80" fill="#ff2d95" opacity=".16" filter="url(#blur24)"/><rect x="1120" y="150" width="150" height="70" fill="#2de2ff" opacity=".18" filter="url(#blur24)"/>';
      for (let i = 0; i < 140; i++) b += '<line x1="' + ((i * 47) % 1650) + '" y1="' + ((i * 61) % 620) + '" x2="' + ((i * 47) % 1650 - 18) + '" y2="' + ((i * 61) % 620 + 60) + '" stroke="rgba(180,220,255,.28)" stroke-width="1.4"/>';
      b += '<rect y="620" width="1600" height="280" fill="#0b0716"/><rect y="620" width="1600" height="280" fill="url(#deskTop)"/><rect y="616" width="1600" height="4" fill="#ff2d95" opacity=".8"/><rect y="622" width="1600" height="40" fill="#2de2ff" opacity=".1"/>';
      for (let i = 0; i < 3; i++) b += '<g transform="translate(' + (260 + i * 420) + ' 670)"><rect width="340" height="190" rx="8" fill="rgba(45,226,255,.1)" stroke="#2de2ff" stroke-opacity=".7"/><polyline points="14,150 60,110 100,126 150,70 200,96 250,44 326,60" fill="none" stroke="' + neon[i] + '" stroke-width="3"/></g>';
    } else if (id === 'greenhouse') {
      b += '<defs><linearGradient id="gsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfeaf5"/><stop offset="1" stop-color="#f0f8e8"/></linearGradient></defs><rect width="1600" height="900" fill="url(#gsky)"/>';
      for (let i = 0; i < 9; i++) b += '<line x1="' + (i * 200) + '" y1="0" x2="' + (i * 200) + '" y2="620" stroke="rgba(60,90,70,.55)" stroke-width="6"/>';
      for (let i = 0; i < 5; i++) b += '<line x1="0" y1="' + (i * 130) + '" x2="1600" y2="' + (i * 130) + '" stroke="rgba(60,90,70,.45)" stroke-width="5"/>';
      b += '<path d="M0 0 L800 0 L400 620 L0 620z" fill="rgba(255,255,255,.18)"/>';
      for (let i = 0; i < 40; i++) { const x = (i * 211) % 1600, y = 200 + ((i * 97) % 380), r = 26 + (i % 5) * 12; b += '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r * 0.55 + '" ry="' + r + '" fill="' + ['#3f8a46', '#2f7a3a', '#56a653', '#2a6a36'][i % 4] + '" transform="rotate(' + (((i * 37) % 120) - 60) + ' ' + x + ' ' + y + ')" opacity=".9"/>'; }
      for (let i = 0; i < 5; i++) { const x = 160 + i * 340; b += '<path d="M' + x + ' 0 V90" stroke="#5a4a3a" stroke-width="3"/><path d="M' + (x - 44) + ' 90 h88 l-12 52 h-64z" fill="#c4683c" stroke="#7a3a1a"/><path d="M' + (x - 36) + ' 100 q-60 80 -30 180 M' + x + ' 100 q10 100 -8 220 M' + (x + 36) + ' 100 q60 80 30 180" fill="none" stroke="#3f8a46" stroke-width="12" stroke-linecap="round"/>'; }
      b += '<rect y="620" width="1600" height="280" fill="#7a5a3a"/>';
      for (let i = 0; i < 16; i++) b += '<rect x="' + (i * 100) + '" y="620" width="98" height="280" fill="' + (i % 2 ? '#86633f' : '#7a5a3a') + '" stroke="rgba(0,0,0,.35)"/>';
      b += '<rect y="620" width="1600" height="280" fill="url(#deskTop)"/><rect y="616" width="1600" height="8" fill="#4a3320"/>';
      for (let i = 0; i < 6; i++) { const x = 140 + i * 250; b += '<path d="M' + (x - 40) + ' 700 h80 l-10 80 h-60z" fill="#c4683c" stroke="#7a3a1a"/><ellipse cx="' + x + '" cy="700" rx="40" ry="9" fill="#3a2a1a"/><path d="M' + x + ' 700 q-30 -60 -10 -100 q20 30 10 100 M' + x + ' 700 q40 -50 30 -96 q-24 34 -30 96" fill="#3f8a46" stroke="#256a30"/>'; }
      b += '<g transform="translate(1250 760)"><path d="M0 40 q0 -40 50 -40 h40 q10 0 10 10 v70 h-100z" fill="#4a8a8a" stroke="#2a5a5a"/><path d="M100 30 q50 -20 60 -50" fill="none" stroke="#4a8a8a" stroke-width="10"/></g>' + cup(760, 790);
    } else if (id === 'observatory') {
      b += '<rect width="1600" height="900" fill="#150f0c"/>';
      for (let i = -9; i <= 9; i++) b += '<line x1="800" y1="-60" x2="' + (800 + i * 190) + '" y2="900" stroke="rgba(120,80,40,.5)" stroke-width="6"/>';
      for (let i = 1; i < 7; i++) b += '<ellipse cx="800" cy="-60" rx="' + (i * 150) + '" ry="' + (i * 150) + '" fill="none" stroke="rgba(120,80,40,.35)" stroke-width="5"/>';
      b += '<defs><linearGradient id="oslit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050a28"/><stop offset="1" stop-color="#1a2a5a"/></linearGradient></defs><polygon points="660,0 940,0 1000,560 600,560" fill="url(#oslit)"/>';
      for (let i = 0; i < 90; i++) b += '<circle cx="' + (620 + (i * 97) % 360) + '" cy="' + ((i * 53) % 550) + '" r="' + (0.6 + (i % 3) * 0.5) + '" fill="rgba(255,255,255,' + (0.4 + (i % 4) * 0.15) + ')"/>';
      b += '<g transform="rotate(-38 330 640)"><rect x="60" y="610" width="620" height="64" rx="10" fill="#c9a23a" stroke="#7d5a14" stroke-width="3"/><rect x="60" y="610" width="620" height="16" fill="rgba(255,240,180,.5)"/><rect x="120" y="604" width="16" height="76" fill="#7d5a14"/><rect x="560" y="604" width="16" height="76" fill="#7d5a14"/><rect x="30" y="596" width="60" height="92" rx="8" fill="#2a2f38" stroke="#555"/></g>';
      b += '<path d="M330 700 L250 900 M330 700 L420 900 M330 700 L330 900" stroke="#3a2a1a" stroke-width="16" stroke-linecap="round"/>';
      b += '<rect y="660" width="1600" height="240" fill="#4a2a18"/><rect y="660" width="1600" height="240" fill="url(#deskTop)"/><rect y="656" width="1600" height="6" fill="rgba(255,220,170,.35)"/>';
      b += '<g transform="translate(1000 560)"><circle cx="90" cy="90" r="90" fill="none" stroke="#c9a23a" stroke-width="8"/><circle cx="90" cy="90" r="74" fill="#1a2a4a"/><path d="M90 90 L90 30 M90 90 L130 110" stroke="#ffe9a0" stroke-width="5" stroke-linecap="round"/><circle cx="90" cy="90" r="6" fill="#c9a23a"/><rect x="70" y="180" width="40" height="30" fill="#c9a23a"/></g>' + paper(1260, 700, 270, 150, 5, 9, '#e9efe9') + pen(1300, 860, -4, '#c9a23a') + lamp(680, 520, '#1f6b4a') + '<ellipse cx="760" cy="700" rx="260" ry="120" fill="url(#warm)"/>';
    } else if (id === 'submarine') {
      b += '<rect width="1600" height="900" fill="#1d3a44"/>';
      for (let r = 0; r < 9; r++) for (let c = 0; c < 20; c++) b += '<circle cx="' + (40 + c * 80) + '" cy="' + (30 + r * 100) + '" r="5" fill="#355a66" stroke="#0e2229"/>';
      for (let i = 0; i < 9; i++) b += '<line x1="0" y1="' + (i * 100) + '" x2="1600" y2="' + (i * 100) + '" stroke="rgba(0,0,0,.35)" stroke-width="3"/>';
      b += '<defs><radialGradient id="pwater" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#4ec8e8"/><stop offset=".6" stop-color="#16688a"/><stop offset="1" stop-color="#06202e"/></radialGradient></defs><circle cx="800" cy="330" r="270" fill="rgba(0,0,0,.5)" filter="url(#blur24)"/><circle cx="800" cy="330" r="260" fill="#6a7a80" stroke="#2a363b" stroke-width="10"/><circle cx="800" cy="330" r="226" fill="url(#pwater)"/>';
      for (let i = 0; i < 6; i++) b += '<polygon points="' + (640 + i * 55) + ',110 ' + (668 + i * 55) + ',110 ' + (760 + i * 38) + ',560 ' + (700 + i * 38) + ',560" fill="rgba(180,240,255,.12)"/>';
      for (let i = 0; i < 7; i++) { const x = 620 + ((i * 97) % 340), y = 210 + ((i * 53) % 260); b += '<g transform="translate(' + x + ' ' + y + ')"><ellipse rx="26" ry="11" fill="' + ['#ff9a3d', '#ffd23d', '#ff6b7f'][i % 3] + '"/><polygon points="-26,0 -44,-12 -44,12" fill="' + ['#ff9a3d', '#ffd23d', '#ff6b7f'][i % 3] + '"/><circle cx="14" cy="-3" r="2.5" fill="#102"/></g>'; }
      for (let i = 0; i < 18; i++) b += '<circle cx="' + (680 + (i * 61) % 240) + '" cy="' + (200 + (i * 83) % 260) + '" r="' + (3 + i % 5) + '" fill="none" stroke="rgba(255,255,255,.55)"/>';
      for (let i = 0; i < 14; i++) { const a = i / 14 * 6.283; b += '<circle cx="' + f1(800 + Math.cos(a) * 246) + '" cy="' + f1(330 + Math.sin(a) * 246) + '" r="8" fill="#9aa8ae" stroke="#2a363b" stroke-width="2"/>'; }
      b += '<path d="M60 900 V440 Q60 400 100 400 H300" fill="none" stroke="#7a8a90" stroke-width="30"/><path d="M1540 900 V380 Q1540 340 1500 340 H1320" fill="none" stroke="#7a8a90" stroke-width="30"/>';
      const gauge = (x, y, ph) => '<g transform="translate(' + x + ' ' + y + ')"><circle r="62" fill="#1a1f24" stroke="#9aa8ae" stroke-width="8"/><circle r="50" fill="#e8e4d4"/><g stroke="#333" stroke-width="2">' + [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => '<line x1="' + f1(Math.cos(2.4 + k * 0.58) * 40) + '" y1="' + f1(Math.sin(2.4 + k * 0.58) * 40) + '" x2="' + f1(Math.cos(2.4 + k * 0.58) * 48) + '" y2="' + f1(Math.sin(2.4 + k * 0.58) * 48) + '"/>').join('') + '</g><line x1="0" y1="0" x2="34" y2="0" stroke="#c0392b" stroke-width="4" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" values="' + (ph) + ';' + (ph + 80) + ';' + ph + '" dur="' + (5 + ph % 4) + 's" repeatCount="indefinite"/></line><circle r="5" fill="#333"/></g>';
      b += gauge(190, 200, 140) + gauge(340, 250, 190) + gauge(1260, 160, 120) + gauge(1420, 230, 200);
      b += '<rect y="740" width="1600" height="160" fill="#16252b"/><rect y="740" width="1600" height="160" fill="url(#deskTop)"/><rect y="736" width="1600" height="6" fill="#6a7a80"/>';
      for (let i = 0; i < 14; i++) b += '<circle cx="' + (120 + i * 100) + '" cy="780" r="12" fill="#0d1418" stroke="#5a6a70"/><circle cx="' + (120 + i * 100) + '" cy="780" r="6" fill="' + ['#35e6a0', '#ff6b7f', '#ffd166', '#5ab8ff'][i % 4] + '" opacity=".9"/>';
    } else if (id === 'zen-room') {
      b += '<rect width="1600" height="900" fill="#d8cfbd"/>';
      b += '<rect x="140" y="50" width="1320" height="560" fill="#f5f0e0"/><rect x="140" y="50" width="1320" height="560" fill="rgba(255,250,230,.5)"/>';
      for (let i = 0; i < 5; i++) b += '<g stroke="#4a3322" stroke-width="8" fill="none"><rect x="' + (140 + i * 264) + '" y="50" width="264" height="560"/><line x1="' + (140 + i * 264) + '" y1="190" x2="' + (404 + i * 264) + '" y2="190"/><line x1="' + (140 + i * 264) + '" y1="330" x2="' + (404 + i * 264) + '" y2="330"/><line x1="' + (140 + i * 264) + '" y1="470" x2="' + (404 + i * 264) + '" y2="470"/><line x1="' + (272 + i * 264) + '" y1="50" x2="' + (272 + i * 264) + '" y2="610"/></g>';
      b += '<g opacity=".38" filter="url(#blur6)" fill="#2f4a2a">';
      for (let i = 0; i < 4; i++) { const x = 300 + i * 300; b += '<rect x="' + x + '" y="50" width="16" height="560"/>'; for (let k = 0; k < 6; k++) b += '<ellipse cx="' + (x + 8 + (k % 2 ? 50 : -50)) + '" cy="' + (120 + k * 80) + '" rx="64" ry="12" transform="rotate(' + (k % 2 ? -20 : 20) + ' ' + (x + 8) + ' ' + (120 + k * 80) + ')"/>'; }
      b += '</g><rect y="610" width="1600" height="290" fill="#b9ae78"/>';
      for (let i = 0; i < 4; i++) b += '<rect x="' + (i * 410 - 20) + '" y="610" width="400" height="290" fill="' + (i % 2 ? '#c2b782' : '#b9ae78') + '" stroke="#2a3a22" stroke-width="10"/>';
      for (let i = 0; i < 160; i++) b += '<line x1="0" y1="' + (620 + i * 1.8) + '" x2="1600" y2="' + (620 + i * 1.8) + '" stroke="rgba(110,100,40,.12)"/>';
      b += '<rect y="606" width="1600" height="8" fill="#4a3322"/><g transform="translate(300 720)"><rect x="8" y="14" width="1000" height="40" rx="6" fill="rgba(0,0,0,.35)" filter="url(#blur6)"/><rect width="1000" height="36" rx="6" fill="#5a3c26" stroke="#2a1a10"/><rect x="40" y="36" width="24" height="70" fill="#4a3220"/><rect x="936" y="36" width="24" height="70" fill="#4a3220"/></g>';
      b += '<g transform="translate(1290 480)"><rect x="10" y="150" width="130" height="30" rx="6" fill="#8a4a2a" stroke="#4a2a14"/><path d="M75 150 q-10 -60 20 -90 M75 130 q-50 -30 -60 -70 M75 100 q40 -30 50 -60" fill="none" stroke="#4a2f1a" stroke-width="9" stroke-linecap="round"/><ellipse cx="25" cy="50" rx="34" ry="20" fill="#3f8a46"/><ellipse cx="125" cy="30" rx="34" ry="20" fill="#4f9a56"/><ellipse cx="100" cy="60" rx="30" ry="18" fill="#2f7a3a"/></g>' + cup(540, 700) + cup(640, 706) + '<path d="M470 720 h260" stroke="rgba(0,0,0,.2)" stroke-width="4"/>';

    } else if (id === 'jungle-treehouse') {
      b += '<defs><linearGradient id="jsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dff5b0"/><stop offset="1" stop-color="#4f9a56"/></linearGradient></defs><rect width="1600" height="900" fill="url(#jsky)"/>';
      for (let i = 0; i < 6; i++) b += '<polygon points="' + (180 + i * 230) + ',0 ' + (230 + i * 230) + ',0 ' + (60 + i * 230 + 360) + ',640 ' + (i * 230 + 260) + ',640" fill="rgba(255,250,200,.16)"/>';
      for (let i = 0; i < 60; i++) { const x = (i * 197) % 1600, y = 20 + ((i * 83) % 560), r = 40 + (i % 5) * 18; b += '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r * 0.45 + '" ry="' + r + '" fill="' + ['#2f7a3a', '#3f8a46', '#256a30', '#56a653', '#1f5a2a'][i % 5] + '" transform="rotate(' + (((i * 41) % 140) - 70) + ' ' + x + ' ' + y + ')" opacity="' + (0.55 + (i % 4) * 0.12) + '"/>'; }
      for (let i = 0; i < 9; i++) { const x = 90 + i * 190; b += '<path d="M' + x + ' 0 q' + (((i % 2) ? 30 : -30)) + ' 160 0 ' + (200 + (i * 37) % 160) + '" fill="none" stroke="#2a6a30" stroke-width="7"/>'; for (let k = 0; k < 5; k++) b += '<ellipse cx="' + (x + (k % 2 ? 10 : -10)) + '" cy="' + (50 + k * 50) + '" rx="12" ry="7" fill="#4f9a56"/>'; }
      b += '<g transform="translate(1260 330)"><path d="M0 120 q120 -20 280 10" stroke="#5a4a32" stroke-width="16" fill="none"/><ellipse cx="170" cy="70" rx="34" ry="52" fill="#d62d2d"/><ellipse cx="170" cy="40" rx="26" ry="26" fill="#e84a4a"/><path d="M190 36 q24 4 20 20 q-14 -2 -20 -8z" fill="#f6c24a"/><circle cx="180" cy="34" r="4" fill="#111"/><path d="M150 110 q-20 60 -4 110 q22 -50 24 -100z" fill="#2d6bd6"/><path d="M160 80 q40 20 20 70 q-30 -20 -20 -70z" fill="#2fa84a"/></g>';
      b += '<rect y="640" width="1600" height="260" fill="#6a4a2a"/>';
      for (let i = 0; i < 16; i++) b += '<rect x="' + (i * 100) + '" y="640" width="98" height="260" fill="' + (i % 2 ? '#775330' : '#6a4a2a') + '" stroke="rgba(0,0,0,.35)"/>';
      b += '<rect y="640" width="1600" height="260" fill="url(#deskTop)"/><rect y="636" width="1600" height="8" fill="#3a2814"/>' + lamp(200, 500, '#8a5a1a') + '<ellipse cx="260" cy="720" rx="260" ry="120" fill="url(#warm)"/>' + cup(760, 740) + paper(1100, 700, 320, 150, -4, 9, '#f4ecd0') + pen(1160, 850, 6, '#2f7a3a');
    } else if (id === 'ice-cave') {
      b += '<defs><linearGradient id="icv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1a3a"/><stop offset="1" stop-color="#1c4a7a"/></linearGradient></defs><rect width="1600" height="900" fill="url(#icv)"/>';
      for (let i = 0; i < 22; i++) { const x = i * 76 - 20, h = 90 + ((i * 53) % 230), w = 36 + (i % 4) * 14; b += '<polygon points="' + x + ',0 ' + (x + w) + ',0 ' + (x + w / 2) + ',' + h + '" fill="rgba(160,225,255,' + (0.28 + (i % 4) * 0.08) + ')" stroke="rgba(220,245,255,.5)"/><polygon points="' + x + ',0 ' + (x + w / 2) + ',0 ' + (x + w / 2) + ',' + h + '" fill="rgba(255,255,255,.14)"/>'; }
      for (let i = 0; i < 16; i++) { const x = i * 110 + 20, h = 80 + ((i * 71) % 200), w = 44 + (i % 3) * 18; b += '<polygon points="' + x + ',640 ' + (x + w) + ',640 ' + (x + w / 2) + ',' + (640 - h) + '" fill="rgba(140,210,250,' + (0.3 + (i % 3) * 0.1) + ')" stroke="rgba(220,245,255,.55)"/><polygon points="' + (x + w / 2) + ',' + (640 - h) + ' ' + (x + w) + ',640 ' + (x + w / 2) + ',640" fill="rgba(255,255,255,.16)"/>'; }
      b += '<circle cx="800" cy="360" r="320" fill="rgba(120,220,255,.12)" filter="url(#blur24)"/>';
      b += '<rect y="640" width="1600" height="260" fill="#0c2a4a"/><rect y="640" width="1600" height="260" fill="url(#deskTop)"/>';
      for (let i = 0; i < 40; i++) b += '<line x1="' + ((i * 83) % 1600) + '" y1="' + (650 + (i * 31) % 240) + '" x2="' + ((i * 83) % 1600 + 90 + (i % 5) * 20) + '" y2="' + (650 + (i * 31) % 240 + ((i % 3) - 1) * 20) + '" stroke="rgba(200,240,255,.28)"/>';
      b += '<rect y="636" width="1600" height="6" fill="rgba(200,240,255,.6)"/><g transform="translate(1180 700)"><path d="M0 60 L30 0 L60 60 L90 20 L120 60Z" fill="rgba(180,235,255,.5)" stroke="rgba(230,248,255,.8)"/></g>' + lamp(220, 520, '#2a6a9a') + '<ellipse cx="270" cy="700" rx="280" ry="120" fill="rgba(120,220,255,.35)"/>' + cup(760, 760);
    } else if (id === 'desert-canyon') {
      b += '<defs><linearGradient id="dsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a6a"/><stop offset=".45" stop-color="#e0607a"/><stop offset="1" stop-color="#ffb26a"/></linearGradient></defs><rect width="1600" height="900" fill="url(#dsky)"/><circle cx="1120" cy="420" r="140" fill="url(#warm)"/><circle cx="1120" cy="430" r="62" fill="#fff0b8"/>';
      for (let i = 0; i < 50; i++) b += '<circle cx="' + ((i * 241) % 1600) + '" cy="' + ((i * 67) % 260) + '" r="' + (0.6 + (i % 3) * 0.4) + '" fill="rgba(255,255,255,.55)"/>';
      b += '<polygon points="0,560 120,420 210,420 260,480 380,400 470,400 540,560" fill="#7a3a3a"/><polygon points="420,560 560,380 640,380 700,440 820,360 900,360 980,560" fill="#8a4040"/><polygon points="900,560 1020,440 1100,440 1150,500 1280,380 1380,380 1460,500 1600,430 1600,560" fill="#6a3036"/><polygon points="0,600 160,500 260,500 330,560 470,480 600,600" fill="#a85a44"/><polygon points="1000,600 1180,500 1300,500 1380,570 1500,500 1600,540 1600,600" fill="#a85a44"/>';
      b += '<rect y="580" width="1600" height="320" fill="#c07a4a"/>';
      for (let i = 0; i < 400; i++) b += '<circle cx="' + ((i * 211) % 1600) + '" cy="' + (590 + (i * 53) % 300) + '" r="' + (1 + (i % 3)) + '" fill="' + (i % 2 ? 'rgba(120,60,20,.3)' : 'rgba(255,220,170,.3)') + '"/>';
      b += '<g transform="translate(220 380)" fill="#2f5a2a" stroke="#1d3d1a" stroke-width="3"><rect x="70" y="0" width="38" height="220" rx="19"/><path d="M70 110 q-50 0 -50 -50 v-30 q0 -18 18 -18 t18 18 v26 q0 18 14 18z"/><path d="M108 140 q50 0 50 -50 v-30 q0 -18 -18 -18 t-18 18 v26 q0 18 -14 18z"/></g>';
      b += '<g transform="translate(560 740)"><rect x="8" y="12" width="620" height="26" rx="6" fill="rgba(0,0,0,.35)" filter="url(#blur6)"/><rect width="620" height="24" rx="6" fill="#8a5a32" stroke="#4a2c14"/><rect x="50" y="24" width="18" height="110" fill="#6a4426"/><rect x="552" y="24" width="18" height="110" fill="#6a4426"/></g>' + cup(780, 690) + paper(1100, 690, 260, 100, 5, 6, '#e9d9b0') + '<ellipse cx="800" cy="640" rx="560" ry="100" fill="url(#warm)" opacity=".5"/>';
    } else if (id === 'airship-deck') {
      b += '<defs><linearGradient id="asky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a90d9"/><stop offset="1" stop-color="#cfe8fa"/></linearGradient></defs><rect width="1600" height="900" fill="url(#asky)"/>';
      for (let i = 0; i < 14; i++) { const x = (i * 263) % 1700 - 60, y = 80 + ((i * 97) % 440), r = 60 + (i % 4) * 30; b += '<ellipse cx="' + x + '" cy="' + y + '" rx="' + r * 1.8 + '" ry="' + r * 0.5 + '" fill="rgba(255,255,255,.8)"/><ellipse cx="' + (x + r * 0.7) + '" cy="' + (y - r * 0.25) + '" rx="' + r + '" ry="' + r * 0.55 + '" fill="rgba(255,255,255,.85)"/>'; }
      b += '<g transform="translate(1180 120)"><ellipse cx="120" cy="90" rx="110" ry="130" fill="#c0392b" stroke="#7a1d12" stroke-width="4"/><path d="M120 -40 q-60 130 0 260 M120 -40 q60 130 0 260 M10 90 h220" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="3"/><path d="M70 214 L90 280 M170 214 L150 280" stroke="#4a2c14" stroke-width="4"/><rect x="84" y="278" width="72" height="40" rx="6" fill="#8a5a32" stroke="#4a2c14"/></g>';
      b += '<g transform="translate(120 160)"><circle cx="120" cy="120" r="46" fill="#9a7a2a" stroke="#5a4210" stroke-width="6"/><g stroke="#c9a23a" stroke-width="16" stroke-linecap="round"><line x1="120" y1="120" x2="120" y2="-20"><animateTransform attributeName="transform" type="rotate" from="0 120 120" to="360 120 120" dur="1.6s" repeatCount="indefinite"/></line><line x1="120" y1="120" x2="120" y2="260"><animateTransform attributeName="transform" type="rotate" from="0 120 120" to="360 120 120" dur="1.6s" repeatCount="indefinite"/></line></g></g>';
      b += '<rect y="640" width="1600" height="260" fill="#6a4426"/>';
      for (let i = 0; i < 18; i++) b += '<rect x="' + (i * 92 - 10) + '" y="640" width="90" height="260" fill="' + (i % 2 ? '#7a5030' : '#6a4426') + '" stroke="rgba(0,0,0,.35)"/>';
      b += '<rect y="640" width="1600" height="260" fill="url(#deskTop)"/><rect y="560" width="1600" height="14" rx="6" fill="#c9a23a" stroke="#7d5a14"/><rect y="574" width="1600" height="4" fill="rgba(0,0,0,.25)"/>';
      for (let i = 0; i < 22; i++) b += '<rect x="' + (i * 76 + 20) + '" y="574" width="12" height="70" fill="#b8902c" stroke="#7d5a14"/><circle cx="' + (i * 76 + 26) + '" cy="568" r="9" fill="#e0b84a" stroke="#7d5a14"/>';
      b += '<g transform="translate(1180 740)"><circle cx="70" cy="70" r="66" fill="#c9a23a" stroke="#7d5a14" stroke-width="6"/><circle cx="70" cy="70" r="54" fill="#f4ecd0"/><polygon points="70,22 80,70 70,118 60,70" fill="#c0392b"/><polygon points="70,118 60,70 80,70" fill="#2a3a5a"/></g>' + paper(520, 700, 420, 170, -3, 10, '#efe3c0') + cup(300, 760) + pen(540, 860, 4, '#7a1d12');
    } else if (id === 'pirate-cabin') {
      b += '<rect width="1600" height="900" fill="#3a2414"/>';
      for (let i = 0; i < 22; i++) b += '<rect y="' + (i * 42) + '" width="1600" height="40" fill="' + (i % 2 ? '#4a2e1a' : '#42281a') + '" stroke="rgba(0,0,0,.45)"/><path d="M0 ' + (i * 42 + 20) + ' q300 -6 600 2 t1000 0" fill="none" stroke="rgba(0,0,0,.2)"/>';
      b += '<defs><linearGradient id="psea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0f0"/><stop offset=".5" stop-color="#f6e8c0"/><stop offset=".52" stop-color="#2f8aa8"/><stop offset="1" stop-color="#14506a"/></linearGradient></defs><circle cx="800" cy="300" r="230" fill="rgba(0,0,0,.5)" filter="url(#blur24)"/><circle cx="800" cy="300" r="220" fill="#8a6a3a" stroke="#4a3216" stroke-width="12"/><circle cx="800" cy="300" r="190" fill="url(#psea)"/>';
      b += '<path d="M650 300 h60 l-30 -70z M820 310 h90 l-45 -110z" fill="#f4ecd0" stroke="#8a7a50"/><path d="M640 330 q80 -16 160 0 t140 0" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="3"/>';
      for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; b += '<circle cx="' + f1(800 + Math.cos(a) * 205) + '" cy="' + f1(300 + Math.sin(a) * 205) + '" r="7" fill="#c9a23a" stroke="#6b4a10"/>'; }
      b += '<g transform="translate(200 40)"><path d="M0 0 V110" stroke="#2a1a10" stroke-width="4"/><rect x="-26" y="110" width="52" height="70" rx="8" fill="#c9a23a" stroke="#6b4a10" stroke-width="4"/><rect x="-18" y="120" width="36" height="50" fill="#ffd979" opacity=".9"/><ellipse cx="0" cy="150" rx="190" ry="180" fill="url(#warm)"/></g>';
      b += '<g transform="translate(1340 520)"><ellipse cx="90" cy="250" rx="100" ry="16" fill="rgba(0,0,0,.4)"/><rect x="10" y="40" width="160" height="210" rx="30" fill="#6a4426" stroke="#2a1a0c" stroke-width="4"/><rect x="10" y="90" width="160" height="14" fill="#8a8a8a"/><rect x="10" y="190" width="160" height="14" fill="#8a8a8a"/></g>';
      b += '<rect y="660" width="1600" height="240" fill="#4a2c18"/><rect y="660" width="1600" height="240" fill="url(#deskTop)"/><rect y="656" width="1600" height="6" fill="rgba(255,220,170,.3)"/>';
      b += '<g transform="translate(360 700) rotate(-3)"><rect x="8" y="12" width="760" height="170" rx="6" fill="rgba(0,0,0,.4)" filter="url(#blur6)"/><rect width="760" height="170" fill="#e9d6a0" stroke="#8a6a30"/><path d="M60 120 q120 -90 240 -20 t200 -30 t180 10" fill="none" stroke="#a0302a" stroke-width="4" stroke-dasharray="12 8"/><path d="M630 40 l16 16 m0 -16 l-16 16" stroke="#a0302a" stroke-width="6"/><circle cx="160" cy="60" r="26" fill="none" stroke="rgba(60,40,10,.6)" stroke-width="3"/></g>' + cup(1250, 770) + pen(1100, 860, -10, '#222222');
    } else if (id === 'retro-arcade') {
      b += '<rect width="1600" height="900" fill="#0a0420"/>';
      b += '<defs><linearGradient id="agl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(255,45,149,0)"/><stop offset="1" stop-color="rgba(255,45,149,.35)"/></linearGradient></defs><rect y="520" width="1600" height="380" fill="url(#agl)"/>';
      for (let i = -14; i <= 14; i++) b += '<line x1="' + (800 + i * 40) + '" y1="520" x2="' + (800 + i * 190) + '" y2="900" stroke="rgba(45,226,255,.55)" stroke-width="2"/>';
      for (let i = 0; i < 10; i++) b += '<line x1="0" y1="' + (520 + i * i * 4.2 + i * 6) + '" x2="1600" y2="' + (520 + i * i * 4.2 + i * 6) + '" stroke="rgba(45,226,255,.5)" stroke-width="2"/>';
      const cab = (x, y, c) => '<g transform="translate(' + x + ' ' + y + ')"><rect x="8" y="14" width="210" height="400" rx="10" fill="rgba(0,0,0,.45)" filter="url(#blur6)"/><path d="M20 400 V60 q0 -40 40 -40 h100 q40 0 40 40 V400z" fill="#14102a" stroke="' + c + '" stroke-width="4"/><rect x="48" y="64" width="124" height="104" rx="6" fill="#02070d" stroke="#333"/><rect x="48" y="64" width="124" height="104" rx="6" fill="' + c + '" opacity=".28"/><path d="M60 140 h20 v-20 h20 v20 h20 M110 90 h40" stroke="' + c + '" stroke-width="5" fill="none"/><rect x="40" y="196" width="140" height="50" rx="6" fill="#221a40" stroke="' + c + '"/><circle cx="76" cy="222" r="9" fill="#ff2d2d"/><circle cx="110" cy="222" r="8" fill="#ffd23d"/><circle cx="140" cy="222" r="8" fill="#35e6a0"/><rect x="30" y="20" width="160" height="26" rx="6" fill="' + c + '" opacity=".85"/></g>';
      b += cab(80, 140, '#ff2d95') + cab(330, 190, '#2de2ff') + cab(1040, 160, '#ffd23d') + cab(1290, 210, '#b44dff');
      b += '<g font-family="Arial Black,Impact,sans-serif" font-weight="900" text-anchor="middle"><text x="800" y="160" font-size="96" fill="#ff2d95" opacity=".95">ARCADE</text><text x="800" y="160" font-size="96" fill="none" stroke="#ffd0e8" stroke-width="2">ARCADE</text></g><rect x="540" y="80" width="520" height="100" fill="#ff2d95" opacity=".18" filter="url(#blur24)"/>';
      for (let i = 0; i < 60; i++) b += '<circle cx="' + ((i * 241) % 1600) + '" cy="' + (560 + (i * 53) % 330) + '" r="2" fill="rgba(255,255,255,.3)"/>';

    } else if (id === 'wizard-tower') {
      b += '<defs><linearGradient id="wzs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0f3a"/><stop offset="1" stop-color="#3a2060"/></linearGradient></defs><rect width="1600" height="900" fill="#2a2038"/>';
      for (let r = 0; r < 8; r++) for (let c = 0; c < 17; c++) b += '<rect x="' + (c * 100 - (r % 2 ? 50 : 0)) + '" y="' + (r * 80) + '" width="98" height="78" fill="' + ['#3a3048', '#342a42', '#40364f'][(r + c) % 3] + '" stroke="rgba(0,0,0,.4)"/>';
      b += '<path d="M560 600 V240 q0 -150 240 -150 q240 0 240 150 V600z" fill="url(#wzs)" stroke="#6a5a80" stroke-width="14"/>';
      for (let i = 0; i < 70; i++) b += '<circle cx="' + (580 + (i * 97) % 440) + '" cy="' + (110 + (i * 61) % 470) + '" r="' + (1 + (i % 3)) + '" fill="rgba(255,250,220,' + (0.4 + (i % 5) * 0.12) + ')"/>';
      b += '<circle cx="900" cy="230" r="62" fill="#f4eecf"/><circle cx="926" cy="214" r="54" fill="#1f1440"/>';
      b += '<g stroke="#6a5a80" stroke-width="8"><line x1="800" y1="90" x2="800" y2="600"/><line x1="560" y1="330" x2="1040" y2="330"/></g>';
      for (let i = 0; i < 2; i++) { const x = 120 + i * 1230; b += '<rect x="' + x + '" y="120" width="250" height="480" fill="#3a2414" stroke="#1c1006" stroke-width="6"/>'; for (let k = 0; k < 4; k++) { b += '<rect x="' + x + '" y="' + (120 + k * 120) + '" width="250" height="8" fill="#5a3a20"/>'; for (let m = 0; m < 7; m++) b += '<rect x="' + (x + 12 + m * 33) + '" y="' + (128 + k * 120 + (m % 3) * 6) + '" width="26" height="' + (96 - (m % 3) * 6) + '" fill="' + ['#7a2a3a', '#2a5a7a', '#5a7a2a', '#7a5a2a', '#4a2a7a', '#2a7a6a', '#8a3a1a'][(m + k + i) % 7] + '" stroke="rgba(0,0,0,.45)"/>'; } }
      b += '<rect y="600" width="1600" height="300" fill="#3a2a4a"/><rect y="600" width="1600" height="300" fill="url(#deskTop)"/><rect y="596" width="1600" height="8" fill="#1c1228"/>';
      b += '<g transform="translate(1180 470)"><rect x="0" y="120" width="20" height="40" fill="#e8dcb8"/><ellipse cx="10" cy="120" rx="14" ry="5" fill="#fff6d8"/><path d="M10 112 q-9 -20 0 -38 q9 18 0 38z" fill="#ffb22e"/><ellipse cx="10" cy="86" rx="70" ry="60" fill="rgba(255,190,80,.22)" filter="url(#blur24)"/></g>';
      b += '<g transform="translate(300 480)"><circle cx="80" cy="60" r="62" fill="rgba(120,220,255,.35)" stroke="#a8e8ff" stroke-width="4"/><circle cx="62" cy="44" r="14" fill="rgba(255,255,255,.55)"/><path d="M40 122 h80 l-14 24 h-52z" fill="#6a5a80"/></g>' + cup(760, 740) + paper(1010, 690, 300, 150, -3, 8, '#efe3c0');
    } else if (id === 'coral-reef') {
      b += '<defs><linearGradient id="crs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ed0e8"/><stop offset="1" stop-color="#0a4a8a"/></linearGradient></defs><rect width="1600" height="900" fill="url(#crs)"/>';
      for (let i = 0; i < 7; i++) b += '<polygon points="' + (60 + i * 260) + ',0 ' + (130 + i * 260) + ',0 ' + (i * 260 + 330) + ',640 ' + (i * 260 + 120) + ',640" fill="rgba(255,255,255,.11)"/>';
      for (let i = 0; i < 40; i++) b += '<circle cx="' + ((i * 211) % 1600) + '" cy="' + (60 + (i * 97) % 560) + '" r="' + (3 + (i % 5) * 2) + '" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.6"/>';
      for (let i = 0; i < 14; i++) { const x = 40 + i * 120, c = ['#ff6a8a', '#ff9a3a', '#c94aff', '#ffd23d', '#ff5a5a'][i % 5], h = 90 + (i * 41) % 170; b += '<g fill="' + c + '" stroke="rgba(0,0,0,.25)"><path d="M' + x + ' 640 q-20 -' + (h * 0.6) + ' 0 -' + h + ' q12 -20 22 0 q8 ' + (h * 0.4) + ' 6 ' + h + 'z"/><path d="M' + (x + 30) + ' 640 q14 -' + (h * 0.5) + ' -6 -' + (h * 0.8) + ' q20 -10 26 8 q4 ' + (h * 0.3) + ' 0 ' + (h * 0.8) + 'z"/></g>'; }
      for (let i = 0; i < 6; i++) { const x = 150 + i * 240, y = 200 + (i * 83) % 300, d = i % 2 ? -1 : 1; b += '<g transform="translate(' + x + ' ' + y + ') scale(' + d + ' 1)"><ellipse cx="0" cy="0" rx="46" ry="22" fill="' + ['#ffb02e', '#ff5a7a', '#3ad0ff', '#ffd23d'][i % 4] + '"/><polygon points="-40,0 -74,-22 -74,22" fill="' + ['#ff7a1a', '#c92a5a', '#1a90c0', '#e0a020'][i % 4] + '"/><circle cx="26" cy="-5" r="5" fill="#fff"/><circle cx="27" cy="-5" r="2.4" fill="#111"/></g>'; }
      b += '<rect y="640" width="1600" height="260" fill="#d8c48a"/><rect y="640" width="1600" height="260" fill="url(#deskTop)"/><rect y="636" width="1600" height="8" fill="#a8905a"/>';
      for (let i = 0; i < 50; i++) b += '<ellipse cx="' + ((i * 173) % 1600) + '" cy="' + (660 + (i * 47) % 220) + '" rx="' + (8 + i % 4 * 4) + '" ry="3" fill="rgba(120,90,40,.25)"/>';
      b += '<g transform="translate(300 690)"><path d="M0 60 q60 -90 120 0 q-10 40 -60 40 q-50 0 -60 -40z" fill="#f4c6b8" stroke="#b86a5a" stroke-width="3"/><path d="M30 50 q30 -30 60 0" fill="none" stroke="#fff" stroke-width="5" opacity=".6"/></g>' + paper(900, 700, 320, 150, -3, 8, '#f4ecd0') + cup(1360, 735);
    } else if (id === 'volcano-lab') {
      b += '<defs><linearGradient id="vls" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0606"/><stop offset="1" stop-color="#7a2410"/></linearGradient></defs><rect width="1600" height="900" fill="url(#vls)"/>';
      b += '<polygon points="380,640 700,230 860,230 1220,640" fill="#2a1410"/><polygon points="700,230 790,200 860,230 800,250" fill="#ff7a1a"/>';
      b += '<path d="M760 250 q-30 120 -70 200 q40 -20 60 80 q20 -60 50 -40 q10 -110 -40 -240z" fill="#ff5a14" opacity=".9"/><path d="M800 250 q40 140 90 240 q-50 -10 -60 60 q-30 -80 -50 -30z" fill="#ffa22e" opacity=".85"/>';
      b += '<ellipse cx="800" cy="220" rx="260" ry="130" fill="rgba(255,120,30,.3)" filter="url(#blur24)"/>';
      for (let i = 0; i < 70; i++) b += '<circle cx="' + (640 + (i * 53) % 320) + '" cy="' + (60 + (i * 79) % 330) + '" r="' + (2 + i % 3) + '" fill="rgba(255,' + (140 + (i % 4) * 25) + ',40,' + (0.5 + (i % 4) * 0.12) + ')"/>';
      for (let i = 0; i < 18; i++) b += '<ellipse cx="' + (i * 95) + '" cy="' + (140 + (i * 61) % 180) + '" rx="' + (70 + (i % 3) * 20) + '" ry="22" fill="rgba(40,22,20,.55)" filter="url(#blur6)"/>';
      b += '<rect y="640" width="1600" height="260" fill="#241210"/><rect y="640" width="1600" height="260" fill="url(#deskTop)"/><rect y="636" width="1600" height="8" fill="#5a2a14"/>';
      for (let i = 0; i < 5; i++) { const x = 140 + i * 300; b += '<g transform="translate(' + x + ' 520)"><rect x="10" y="150" width="90" height="12" fill="rgba(0,0,0,.4)" filter="url(#blur6)"/><path d="M40 20 h30 v40 l30 80 q4 20 -16 20 h-58 q-20 0 -16 -20 l30 -80z" fill="rgba(' + ['255,90,30', '120,255,140', '90,200,255', '255,210,60', '230,90,255'][i] + ',.55)" stroke="#e8d6c0" stroke-width="3"/><rect x="36" y="10" width="38" height="12" fill="#6a4a3a"/></g>'; }
      b += lamp(1400, 480, '#8a2a10') + paper(1000, 700, 280, 140, -4, 7, '#ecd9b8');
    } else if (id === 'cloud-lounge') {
      b += '<defs><linearGradient id="cls" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fc4ff"/><stop offset="1" stop-color="#eaf6ff"/></linearGradient></defs><rect width="1600" height="900" fill="url(#cls)"/>';
      b += '<circle cx="1240" cy="190" r="110" fill="rgba(255,244,190,.9)"/><circle cx="1240" cy="190" r="190" fill="rgba(255,244,190,.28)" filter="url(#blur24)"/>';
      for (let i = 0; i < 14; i++) { const x = (i * 211) % 1700 - 60, y = 80 + (i * 97) % 480, w = 120 + (i % 4) * 50; b += '<g fill="rgba(255,255,255,' + (0.7 + (i % 3) * 0.1) + ')"><ellipse cx="' + x + '" cy="' + y + '" rx="' + w + '" ry="' + (w * 0.32) + '"/><ellipse cx="' + (x - w * 0.4) + '" cy="' + (y - w * 0.18) + '" rx="' + (w * 0.5) + '" ry="' + (w * 0.3) + '"/><ellipse cx="' + (x + w * 0.35) + '" cy="' + (y - w * 0.22) + '" rx="' + (w * 0.55) + '" ry="' + (w * 0.34) + '"/></g>'; }
      b += '<g transform="translate(160 330)" fill="#fff"><path d="M0 220 q-30 -120 100 -140 q40 -80 150 -30 q110 -20 140 90 q50 30 20 80z" opacity=".95"/></g>';
      b += '<rect y="640" width="1600" height="260" fill="#f4f8ff"/><rect y="640" width="1600" height="260" fill="url(#deskTop)"/><rect y="636" width="1600" height="8" fill="#c8d8ee"/>';
      for (let i = 0; i < 9; i++) b += '<ellipse cx="' + (i * 210) + '" cy="' + (700 + (i * 53) % 150) + '" rx="190" ry="40" fill="rgba(255,255,255,.7)" filter="url(#blur6)"/>';
      b += cup(300, 735) + paper(760, 690, 320, 150, -3, 8, '#ffffff') + lamp(1380, 480, '#7aa8d8');
    } else if (id === 'train-car') {
      b += '<rect width="1600" height="900" fill="#3a1e12"/>';
      for (let i = 0; i < 20; i++) b += '<rect x="' + (i * 82) + '" y="0" width="80" height="640" fill="' + (i % 2 ? '#4a2818' : '#42231a') + '" stroke="rgba(0,0,0,.35)"/>';
      for (let i = 0; i < 2; i++) { const x = 220 + i * 700; b += '<rect x="' + x + '" y="90" width="460" height="340" rx="14" fill="#1a2a4a" stroke="#c9a23a" stroke-width="12"/>'; b += '<rect x="' + (x + 8) + '" y="98" width="444" height="324" rx="8" fill="#0e1a36"/>'; for (let k = 0; k < 40; k++) b += '<circle cx="' + (x + 12 + (k * 53 + i * 31) % 436) + '" cy="' + (104 + (k * 37) % 150) + '" r="1.6" fill="rgba(255,250,220,.7)"/>'; b += '<polygon points="' + (x + 8) + ',330 ' + (x + 110) + ',260 ' + (x + 210) + ',320 ' + (x + 330) + ',240 ' + (x + 452) + ',310 ' + (x + 452) + ',422 ' + (x + 8) + ',422" fill="#08122a"/>'; for (let k = 0; k < 6; k++) b += '<rect x="' + (x + 30 + k * 70) + '" y="' + (370 + (k % 2) * 12) + '" width="10" height="10" fill="rgba(255,210,120,.8)"/>'; b += '<line x1="' + (x + 230) + '" y1="98" x2="' + (x + 230) + '" y2="422" stroke="#c9a23a" stroke-width="8"/>'; }
      b += '<rect x="80" y="450" width="1440" height="14" fill="#c9a23a"/><rect x="80" y="450" width="1440" height="5" fill="rgba(255,255,255,.4)"/>';
      for (let i = 0; i < 7; i++) b += '<g transform="translate(' + (150 + i * 200) + ' 410)"><rect x="0" y="0" width="120" height="44" rx="5" fill="' + ['#6a3a1a', '#2a4a3a', '#7a2a2a', '#3a3a5a'][i % 4] + '" stroke="#c9a23a"/><rect x="50" y="18" width="20" height="10" fill="#c9a23a"/></g>';
      b += '<rect y="640" width="1600" height="260" fill="#2a1408"/><rect y="640" width="1600" height="260" fill="url(#deskTop)"/><rect y="636" width="1600" height="8" fill="#c9a23a"/>';
      b += '<g transform="translate(220 560)"><rect x="0" y="90" width="150" height="10" rx="4" fill="rgba(0,0,0,.4)" filter="url(#blur6)"/><path d="M30 20 h90 l12 70 h-114z" fill="#ffe8a8" opacity=".9"/><rect x="40" y="0" width="70" height="24" rx="6" fill="#c9a23a"/><ellipse cx="75" cy="60" rx="90" ry="70" fill="rgba(255,200,90,.25)" filter="url(#blur24)"/></g>' + cup(760, 735) + paper(1040, 695, 320, 150, 3, 8, '#f1e4c2');
    } else if (id === 'lighthouse') {
      b += '<defs><linearGradient id="lhs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050a24"/><stop offset="1" stop-color="#1a3a6a"/></linearGradient></defs><rect width="1600" height="900" fill="url(#lhs)"/>';
      for (let i = 0; i < 90; i++) b += '<circle cx="' + ((i * 151) % 1600) + '" cy="' + (10 + (i * 67) % 320) + '" r="' + (1 + i % 3) + '" fill="rgba(255,255,240,' + (0.4 + (i % 5) * 0.12) + ')"/>';
      b += '<circle cx="1280" cy="140" r="60" fill="#f4eed0"/>';
      b += '<polygon points="1000,300 1600,240 1600,400" fill="rgba(255,240,170,.28)"/><polygon points="1000,300 400,230 400,380" fill="rgba(255,240,170,.22)"/>';
      b += '<g transform="translate(940 120)"><polygon points="20,520 120,520 100,80 40,80" fill="#f0f0f0"/><polygon points="34,440 106,440 102,360 38,360" fill="#d62d2d"/><polygon points="40,300 102,300 98,220 44,220" fill="#d62d2d"/><rect x="30" y="50" width="80" height="34" fill="#2a2a30"/><rect x="40" y="24" width="60" height="28" fill="#ffe27a"/><polygon points="26,24 114,24 70,-10" fill="#2a2a30"/><circle cx="70" cy="38" r="40" fill="rgba(255,226,122,.5)" filter="url(#blur24)"/></g>';
      b += '<rect y="560" width="1600" height="90" fill="#0f2a52"/>';
      for (let i = 0; i < 22; i++) b += '<path d="M' + (i * 80 - 20) + ' ' + (580 + (i % 3) * 22) + ' q20 -16 40 0 q20 16 40 0" fill="none" stroke="rgba(190,225,255,.5)" stroke-width="3"/>';
      b += '<rect y="640" width="1600" height="260" fill="#5a3a22"/>';
      for (let i = 0; i < 16; i++) b += '<rect x="' + (i * 100) + '" y="640" width="98" height="260" fill="' + (i % 2 ? '#664228' : '#5a3a22') + '" stroke="rgba(0,0,0,.35)"/>';
      b += '<rect y="640" width="1600" height="260" fill="url(#deskTop)"/><rect y="636" width="1600" height="8" fill="#2a1a0c"/>' + lamp(220, 500, '#c9a23a') + '<ellipse cx="280" cy="720" rx="260" ry="120" fill="url(#warm)"/>' + cup(780, 740) + paper(1060, 695, 320, 150, -3, 8, '#f1e4c2');
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">' + defs + b + '</svg>';
  };

  /* ---------- the running scene: lighting, orbs, gallery ---------- */
  const R = { raf: 0, view: null, light: null, root: null, deskEl: null, glares: [], ls: {}, scene: false, mx: 0, my: 0, px: 0, py: 0, cx: -1, cy: -1, onMove: null, moveOn: null, orbs: null, orbit: null, mode: 'off', modes: [], mods: [], ch: null, orbMode: 'off', pulse: null, acc: '#00c47d', acc2: '#6c8cff', motes: [], orbList: [], w: 0, h: 0, ang: 0, spin: 0.18, drag: null, resize: null, reduce: false };
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
    } else if (mode === 'sunset-horizon') {
      const a = 0.45 + p * 0.2, g = ctx.createLinearGradient(0, h, 0, h * 0.42); g.addColorStop(0, 'rgba(255,110,50,' + a + ')'); g.addColorStop(0.35, 'rgba(255,70,120,' + (a * 0.6) + ')'); g.addColorStop(0.7, 'rgba(140,60,200,' + (a * 0.28) + ')'); g.addColorStop(1, 'rgba(140,60,200,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const sx = w * (0.5 + Math.sin(t / 14000) * 0.25), sun = ctx.createRadialGradient(sx, h * 1.02, 4, sx, h * 1.02, big * 0.4); sun.addColorStop(0, 'rgba(255,230,160,.8)'); sun.addColorStop(0.3, 'rgba(255,150,70,.35)'); sun.addColorStop(1, 'rgba(255,100,60,0)'); ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 5; i++) { const y = h * (0.62 + i * 0.07) + Math.sin(t / 1800 + i) * 4; ctx.fillStyle = 'rgba(255,190,120,' + (0.07 - i * 0.01) + ')'; ctx.fillRect(0, y, w, 2 + i); }
    } else if (mode === 'fireflies') {
      const ff = R.ls.ff || (R.ls.ff = Array.from({ length: 44 }, () => ({ x: Math.random(), y: 0.2 + Math.random() * 0.8, vx: 0, vy: 0, ph: Math.random() * 6.28 })));
      for (const q of ff) { q.vx += (Math.random() - 0.5) * 0.00012; q.vy += (Math.random() - 0.5) * 0.0001; q.vx *= 0.98; q.vy *= 0.98; q.x += q.vx; q.y += q.vy; if (q.x < 0 || q.x > 1) q.vx *= -1; if (q.y < 0.1 || q.y > 1) q.vy *= -1; const b = Math.pow(Math.max(0, Math.sin(t / (500 + q.ph * 90) + q.ph)), 3) * (0.8 + p * 0.3); if (b < 0.03) continue; const x = q.x * w, y = q.y * h, g = ctx.createRadialGradient(x, y, 0, x, y, 20); g.addColorStop(0, 'rgba(210,255,140,' + b + ')'); g.addColorStop(0.25, 'rgba(170,255,90,' + (b * 0.4) + ')'); g.addColorStop(1, 'rgba(170,255,90,0)'); ctx.fillStyle = g; ctx.fillRect(x - 20, y - 20, 40, 40); }
    } else if (mode === 'snow-glow') {
      const sn = R.ls.snow || (R.ls.snow = Array.from({ length: 110 }, () => ({ x: Math.random(), y: Math.random(), v: 0.0003 + Math.random() * 0.0007, r: 1 + Math.random() * 3, d: Math.random() * 6.28 })));
      ctx.fillStyle = 'rgba(170,200,255,.05)'; ctx.fillRect(0, 0, w, h);
      for (const q of sn) { q.y += q.v * 16 * (1 + p); q.x += Math.sin(t / 1400 + q.d) * 0.0005; if (q.y > 1.02) { q.y = -0.02; q.x = Math.random(); } const x = q.x * w, y = q.y * h, g = ctx.createRadialGradient(x, y, 0, x, y, q.r * 4); g.addColorStop(0, 'rgba(255,255,255,.85)'); g.addColorStop(0.3, 'rgba(210,230,255,.3)'); g.addColorStop(1, 'rgba(210,230,255,0)'); ctx.fillStyle = g; ctx.fillRect(x - q.r * 4, y - q.r * 4, q.r * 8, q.r * 8); }
    } else if (mode === 'lanterns') {
      const ln = R.ls.lan || (R.ls.lan = Array.from({ length: 16 }, () => ({ x: Math.random(), y: Math.random() * 1.2, v: 0.00012 + Math.random() * 0.0002, s: 0.6 + Math.random() * 1.1, d: Math.random() * 6.28 })));
      for (const q of ln) { q.y -= q.v * 16; if (q.y < -0.1) { q.y = 1.1; q.x = Math.random(); } const x = (q.x + Math.sin(t / 3200 + q.d) * 0.02) * w, y = q.y * h, fl = 0.8 + 0.2 * Math.sin(t / 170 + q.d) + p * 0.2, r = 46 * q.s, g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,214,130,' + (0.7 * fl) + ')'); g.addColorStop(0.3, 'rgba(255,160,70,' + (0.28 * fl) + ')'); g.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.fillStyle = 'rgba(255,230,170,' + (0.5 * fl) + ')'; ctx.fillRect(x - 5 * q.s, y - 8 * q.s, 10 * q.s, 16 * q.s); }
    } else if (mode === 'radar-sweep') {
      const cx = w * 0.14, cy = h * 0.86, R0 = big * 0.95, ang = t / 1800;
      ctx.strokeStyle = 'rgba(60,255,130,.16)'; ctx.lineWidth = 1.5; for (let k = 1; k <= 4; k++) { ctx.beginPath(); ctx.arc(cx, cy, R0 * k / 4, 0, 6.283); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx - R0, cy); ctx.lineTo(cx + R0, cy); ctx.moveTo(cx, cy - R0); ctx.lineTo(cx, cy + R0); ctx.stroke();
      for (let j = 0; j < 30; j++) { ctx.fillStyle = 'rgba(60,255,130,' + (0.22 * (1 - j / 30) + p * 0.04) + ')'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R0, ang - (j + 1) * 0.03, ang - j * 0.03); ctx.closePath(); ctx.fill(); }
      ctx.strokeStyle = 'rgba(160,255,190,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * R0, cy + Math.sin(ang) * R0); ctx.stroke();
    } else if (mode === 'matrix-rain') {
      const cw = 26, n = Math.ceil(w / cw), mx = R.ls.mx && R.ls.mx.length === n ? R.ls.mx : (R.ls.mx = Array.from({ length: n }, () => ({ y: Math.random() * h, v: 3 + Math.random() * 6, len: 8 + Math.floor(Math.random() * 9) })));
      ctx.font = '15px monospace'; ctx.textAlign = 'center';
      for (let i = 0; i < n; i++) {
        const c = mx[i]; c.y += c.v * (1 + p * 1.6); if (c.y - c.len * 18 > h) { c.y = 0; c.v = 3 + Math.random() * 6; c.len = 8 + Math.floor(Math.random() * 9); }
        for (let k = 0; k < c.len; k++) { const y = c.y - k * 18; if (y < -18 || y > h + 18) continue; ctx.fillStyle = k === 0 ? 'rgba(220,255,230,.95)' : 'rgba(40,255,110,' + (0.7 * (1 - k / c.len)) + ')'; ctx.fillText(String.fromCharCode(0x30a0 + Math.floor(Math.random() * 90)), i * cw + cw / 2, y); }
      }
    } else if (mode === 'equalizer-glow') {
      const chs = ['kick', 'bass', 'vocal', 'snare', 'hats'], N = 36, bw = w / N;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1) * 4, i0 = Math.floor(u), i1 = Math.min(4, i0 + 1), f = u - i0;
        const v = R.ch ? (R.ch[chs[i0]] || 0) * (1 - f) + (R.ch[chs[i1]] || 0) * f : 0.25 + 0.2 * Math.sin(t / 420 + i * 0.7);
        const bh = Math.max(6, (0.1 + v * 0.9) * h * 0.3 * (0.75 + 0.25 * Math.sin(t / 130 + i * 1.3))), g = ctx.createLinearGradient(0, h, 0, h - bh);
        g.addColorStop(0, rgba(i % 2 ? acc2 : acc, 0.6)); g.addColorStop(1, rgba(i % 2 ? acc2 : acc, 0)); ctx.fillStyle = g; ctx.fillRect(i * bw + 3, h - bh, bw - 6, bh);
      }
    } else if (mode === 'lens-flare') {
      const lx = w * (0.15 + 0.7 * ((t / 16000) % 1)), ly = h * (0.26 + 0.05 * Math.sin(t / 4000)), a = 0.5 + p * 0.25;
      const streak = ctx.createLinearGradient(0, ly, w, ly); streak.addColorStop(0, 'rgba(80,190,255,0)'); streak.addColorStop(Math.max(0.01, Math.min(0.99, lx / w)), 'rgba(140,220,255,' + a + ')'); streak.addColorStop(1, 'rgba(80,190,255,0)'); ctx.fillStyle = streak; ctx.fillRect(0, ly - 3, w, 6);
      const core = ctx.createRadialGradient(lx, ly, 0, lx, ly, 120); core.addColorStop(0, 'rgba(255,255,255,' + a + ')'); core.addColorStop(0.2, 'rgba(160,220,255,' + (a * 0.5) + ')'); core.addColorStop(1, 'rgba(120,180,255,0)'); ctx.fillStyle = core; ctx.fillRect(lx - 120, ly - 120, 240, 240);
      [[0.35, 26, '255,200,120'], [0.6, 18, '160,255,200'], [0.85, 34, '255,140,200'], [1.2, 14, '140,180,255']].forEach(([f, r, c]) => { const gx = lx + (w * 0.5 - lx) * f * 1.4, gy = ly + (h * 0.5 - ly) * f * 1.4, g = ctx.createRadialGradient(gx, gy, r * 0.5, gx, gy, r); g.addColorStop(0, 'rgba(' + c + ',.0)'); g.addColorStop(0.8, 'rgba(' + c + ',.22)'); g.addColorStop(1, 'rgba(' + c + ',0)'); ctx.fillStyle = g; ctx.fillRect(gx - r, gy - r, r * 2, r * 2); });
    } else if (mode === 'bokeh-drift') {
      const bk = R.ls.bk || (R.ls.bk = Array.from({ length: 24 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: 30 + Math.random() * 70, vx: (Math.random() - 0.5) * 0.00006, vy: (Math.random() - 0.5) * 0.00005, c: ['255,190,110', '255,150,170', '170,200,255', '200,255,190'][i % 4] })));
      for (const q of bk) { q.x += q.vx * 16; q.y += q.vy * 16; if (q.x < -0.1) q.x = 1.1; if (q.x > 1.1) q.x = -0.1; if (q.y < -0.1) q.y = 1.1; if (q.y > 1.1) q.y = -0.1; const x = q.x * w, y = q.y * h, r = q.r * (1 + p * 0.15), g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(' + q.c + ',.04)'); g.addColorStop(0.8, 'rgba(' + q.c + ',.13)'); g.addColorStop(0.94, 'rgba(' + q.c + ',.24)'); g.addColorStop(1, 'rgba(' + q.c + ',0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
    } else if (mode === 'beacon') {
      const ox = w * 0.08, oy = h * 0.12, ang = t / 650, len = big * 1.3;
      for (let k = 0; k < 2; k++) { const a0 = ang + k * Math.PI, g = ctx.createRadialGradient(ox, oy, 4, ox, oy, len); g.addColorStop(0, 'rgba(255,150,30,' + (0.62 + p * 0.2) + ')'); g.addColorStop(1, 'rgba(255,150,30,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, len, a0 - 0.2, a0 + 0.2); ctx.closePath(); ctx.fill(); }
      const d = ctx.createRadialGradient(ox, oy, 2, ox, oy, 70); d.addColorStop(0, 'rgba(255,200,90,.85)'); d.addColorStop(1, 'rgba(255,150,30,0)'); ctx.fillStyle = d; ctx.fillRect(ox - 70, oy - 70, 140, 140);
    } else if (mode === 'police-lights') {
      const ph = Math.floor(t / 210) % 6, left = ph === 0 || ph === 2 ? 1 : 0, right = ph === 3 || ph === 5 ? 1 : 0, k = 0.5 + p * 0.5;
      if (left) { const g = ctx.createRadialGradient(w * 0.04, h * 0.08, 8, w * 0.04, h * 0.08, big * 0.75); g.addColorStop(0, 'rgba(255,40,50,' + (0.6 * k) + ')'); g.addColorStop(1, 'rgba(255,40,50,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
      if (right) { const g = ctx.createRadialGradient(w * 0.96, h * 0.08, 8, w * 0.96, h * 0.08, big * 0.75); g.addColorStop(0, 'rgba(50,110,255,' + (0.6 * k) + ')'); g.addColorStop(1, 'rgba(50,110,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    } else if (mode === 'disco-ball') {
      const hat = R.ch ? R.ch.hats || 0 : 0;
      for (let i = 0; i < 30; i++) {
        const a = i * 2.399 + t / (5200 + (i % 5) * 400), rr = 0.12 + ((i * 37) % 100) / 100 * 0.42, x = w * (0.5 + Math.cos(a) * rr * 1.5), y = h * (0.42 + Math.sin(a * 1.3) * rr * 0.9), r = 16 + (i % 4) * 9 + hat * 18;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'hsla(' + ((i * 47 + t / 30) % 360) + ',100%,70%,' + (0.5 + p * 0.3) + ')'); g.addColorStop(1, 'hsla(' + ((i * 47 + t / 30) % 360) + ',100%,70%,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      const b = ctx.createRadialGradient(w * 0.5, 0, 2, w * 0.5, 0, 90); b.addColorStop(0, 'rgba(255,255,255,.8)'); b.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = b; ctx.fillRect(w * 0.5 - 90, 0, 180, 90);
    } else if (mode === 'laser-grid') {
      const kick = R.ch ? R.ch.kick || 0 : 0;
      ctx.lineCap = 'round';
      for (let k = 0; k < 9; k++) {
        const ang = Math.sin(t / (1700 + k * 130) + k) * 0.7, ex = w * 0.5 + Math.tan(ang) * h * 0.9 + (k - 4) * w * 0.08;
        ctx.strokeStyle = 'rgba(60,255,130,' + (0.12 + kick * 0.1) + ')'; ctx.lineWidth = 9 + kick * 8; ctx.beginPath(); ctx.moveTo(w * 0.5, 0); ctx.lineTo(ex, h); ctx.stroke();
        ctx.strokeStyle = 'rgba(150,255,190,' + (0.6 + kick * 0.3) + ')'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(w * 0.5, 0); ctx.lineTo(ex, h); ctx.stroke();
      }
      const sy = ((t / 6) % (h + 80)) - 40; ctx.fillStyle = 'rgba(80,255,150,.1)'; ctx.fillRect(0, sy, w, 3);
    } else if (mode === 'searchlights') {
      for (let k = 0; k < 2; k++) {
        const ox = w * (k ? 0.86 : 0.14), ang = Math.sin(t / (3300 + k * 700) + k * 2) * 0.55 + (k ? -0.15 : 0.15), ex = ox + Math.tan(ang) * h, g = ctx.createLinearGradient(ox, h, ex, 0);
        g.addColorStop(0, 'rgba(235,245,255,' + (0.4 + p * 0.2) + ')'); g.addColorStop(1, 'rgba(235,245,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ox - 14, h); ctx.lineTo(ox + 14, h); ctx.lineTo(ex + h * 0.1, 0); ctx.lineTo(ex - h * 0.1, 0); ctx.closePath(); ctx.fill();
        const d = ctx.createRadialGradient(ox, h, 2, ox, h, 80); d.addColorStop(0, 'rgba(255,255,255,.7)'); d.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = d; ctx.fillRect(ox - 80, h - 80, 160, 80);
      }
    } else if (mode === 'neon-flicker') {
      const fl = (Math.sin(t / 37) + Math.sin(t / 91) > 1.65) ? 0.3 : 1, a = (0.5 + p * 0.3) * fl;
      const edge = (x0, x1, col) => { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, 'rgba(' + col + ',' + a + ')'); g.addColorStop(1, 'rgba(' + col + ',0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); };
      edge(0, w * 0.22, '255,50,170'); edge(w, w * 0.78, '40,220,255');
      const tl = ctx.createLinearGradient(0, 0, 0, h * 0.1); tl.addColorStop(0, 'rgba(180,90,255,' + (0.3 * fl) + ')'); tl.addColorStop(1, 'rgba(180,90,255,0)'); ctx.fillStyle = tl; ctx.fillRect(0, 0, w, h);
    } else if (mode === 'tv-glow') {
      const tv = R.ls.tv || (R.ls.tv = { next: 0, v: 0.1, hue: 215 });
      if (t > tv.next) { tv.next = t + 70 + Math.random() * 170; tv.v = 0.05 + Math.random() * 0.2; if (Math.random() < 0.2) tv.hue = Math.random() < 0.5 ? 205 : 30; }
      ctx.fillStyle = 'hsla(' + tv.hue + ',90%,70%,' + (tv.v * 0.6 + p * 0.06) + ')'; ctx.fillRect(0, 0, w, h);
      const g = ctx.createRadialGradient(w * 0.5, h * 1.05, 10, w * 0.5, h * 1.05, big * 0.8); g.addColorStop(0, 'hsla(' + tv.hue + ',90%,75%,' + (tv.v * 1.6) + ')'); g.addColorStop(1, 'hsla(' + tv.hue + ',90%,75%,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else if (mode === 'caustics') {
      ctx.fillStyle = 'rgba(20,120,170,.1)'; ctx.fillRect(0, 0, w, h); ctx.lineWidth = 12; ctx.lineCap = 'round';
      for (let set = 0; set < 2; set++) for (let k = 0; k < 10; k++) {
        ctx.strokeStyle = 'rgba(150,255,240,' + (0.09 + p * 0.05) + ')'; ctx.beginPath();
        for (let x = 0; x <= w; x += 20) { const y = h * (k / 10) + Math.sin(x / (90 + k * 8) + t / (1100 + set * 400) + k * (set ? -1 : 1)) * 38 + Math.sin(x / 47 + t / 700 + set * 3) * 12; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      }
    } else if (mode === 'pulse-rings') {
      const rg = R.ls.rings || (R.ls.rings = { list: [], last: -9999 }), kick = R.ch ? R.ch.kick || 0 : 0;
      if ((R.ch ? kick > 0.9 && t - rg.last > 260 : t - rg.last > 1100)) { rg.last = t; rg.list.push({ t0: t, col: rg.list.length % 2 ? acc2 : acc }); if (rg.list.length > 8) rg.list.shift(); }
      rg.list = rg.list.filter((q) => t - q.t0 < 2200);
      for (const q of rg.list) { const age = (t - q.t0) / 2200; ctx.strokeStyle = rgba(q.col, 0.7 * (1 - age)); ctx.lineWidth = 3 + (1 - age) * 8; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.5, Math.max(1, age * big * 0.75), 0, 6.283); ctx.stroke(); }
    } else if (mode === 'fireworks') {
      const fw = R.ls.fw || (R.ls.fw = { list: [], next: t + 600, last: -9999 }), snare = R.ch ? Math.max(R.ch.snare || 0, R.ch.kick || 0) : 0;
      if (t > fw.next || (R.ch && snare > 0.93 && t - fw.last > 600)) {
        fw.last = t; fw.next = t + 1500 + Math.random() * 2400;
        const hue = Math.random() * 360, parts = Array.from({ length: 34 }, (_, i) => ({ a: (i / 34) * 6.283 + Math.random() * 0.2, s: 0.07 + Math.random() * 0.1 }));
        fw.list.push({ x: 0.15 + Math.random() * 0.7, y: 0.12 + Math.random() * 0.4, t0: t, hue: hue, parts: parts }); if (fw.list.length > 5) fw.list.shift();
      }
      fw.list = fw.list.filter((q) => t - q.t0 < 1900);
      for (const q of fw.list) {
        const age = (t - q.t0) / 1900, a = Math.max(0, 1 - age * age);
        for (const c of q.parts) { const d = c.s * big * Math.min(1, age * 1.6) * 1.5, x = q.x * w + Math.cos(c.a) * d, y = q.y * h + Math.sin(c.a) * d + age * age * h * 0.12; ctx.fillStyle = 'hsla(' + Math.round(q.hue + c.a * 20) + ',100%,65%,' + (0.85 * a) + ')'; ctx.beginPath(); ctx.arc(x, y, 1.6 + (1 - age) * 1.8, 0, 6.283); ctx.fill(); }
        if (age < 0.12) { const g = ctx.createRadialGradient(q.x * w, q.y * h, 0, q.x * w, q.y * h, 120); g.addColorStop(0, 'hsla(' + Math.round(q.hue) + ',100%,80%,' + (0.5 * (1 - age / 0.12)) + ')'); g.addColorStop(1, 'hsla(' + Math.round(q.hue) + ',100%,80%,0)'); ctx.fillStyle = g; ctx.fillRect(q.x * w - 120, q.y * h - 120, 240, 240); }
      }
    } else if (mode === 'prism') {
      const u = -0.3 + ((t / 11000) % 1.6), x0 = w * u, g = ctx.createLinearGradient(x0, 0, x0 + w * 0.55, h * 0.6), al = 0.2 + p * 0.12;
      g.addColorStop(0, 'rgba(255,60,80,0)'); g.addColorStop(0.18, 'rgba(255,60,80,' + al + ')'); g.addColorStop(0.34, 'rgba(255,200,60,' + al + ')'); g.addColorStop(0.5, 'rgba(80,255,120,' + al + ')'); g.addColorStop(0.66, 'rgba(60,200,255,' + al + ')'); g.addColorStop(0.82, 'rgba(150,90,255,' + al + ')'); g.addColorStop(1, 'rgba(150,90,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else if (mode === 'candlelight') {
      for (let k = 0; k < 4; k++) {
        const fl = 0.75 + 0.25 * Math.sin(t / (130 + k * 47) + k * 2) + 0.1 * Math.sin(t / 53 + k), x = w * (0.12 + k * 0.26), y = h * (0.8 + 0.04 * Math.sin(k * 3));
        const g = ctx.createRadialGradient(x, y, 4, x, y, big * 0.36); g.addColorStop(0, 'rgba(255,190,100,' + (0.44 * fl + p * 0.12) + ')'); g.addColorStop(0.4, 'rgba(255,140,60,' + (0.13 * fl) + ')'); g.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
    } else if (mode === 'moonlight') {
      for (let i = 0; i < 3; i++) {
        const x0 = w * (0.52 + i * 0.15 + Math.sin(t / 9000 + i) * 0.02), g = ctx.createLinearGradient(x0, 0, x0 - w * 0.4, h); g.addColorStop(0, 'rgba(170,200,255,' + (0.17 + p * 0.08) + ')'); g.addColorStop(1, 'rgba(170,200,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + w * 0.07, 0); ctx.lineTo(x0 - w * 0.33, h); ctx.lineTo(x0 - w * 0.5, h); ctx.closePath(); ctx.fill();
      }
      const m = ctx.createRadialGradient(w * 0.86, 0, 6, w * 0.86, 0, big * 0.5); m.addColorStop(0, 'rgba(210,225,255,.42)'); m.addColorStop(1, 'rgba(210,225,255,0)'); ctx.fillStyle = m; ctx.fillRect(0, 0, w, h);
    } else if (mode === 'stage-beams') {
      const cols = [acc, acc2, '#ff3d7f', '#ffd23d', '#3dd6ff', '#9d5cff'], hat = R.ch ? R.ch.hats || 0 : 0;
      for (let k = 0; k < 6; k++) {
        const ox = w * (k + 0.5) / 6, ang = Math.sin(t / (1500 + k * 210) + k) * 0.55 + hat * 0.12, ex = ox + Math.tan(ang) * h;
        const g = ctx.createLinearGradient(ox, 0, ex, h); g.addColorStop(0, rgba(cols[k], 0.34 + p * 0.34)); g.addColorStop(1, rgba(cols[k], 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ox - 6, 0); ctx.lineTo(ox + 6, 0); ctx.lineTo(ex + h * 0.09, h); ctx.lineTo(ex - h * 0.09, h); ctx.closePath(); ctx.fill();
        const d = ctx.createRadialGradient(ox, 0, 2, ox, 0, 46); d.addColorStop(0, rgba(cols[k], 0.8)); d.addColorStop(1, rgba(cols[k], 0)); ctx.fillStyle = d; ctx.fillRect(ox - 46, 0, 92, 46);
      }
    } else if (mode === 'storm-flash') {
      const st = R.ls.storm || (R.ls.storm = { next: t + 1500, at: -99999, dur: 160, x: 0.5, bolt: [] }), kick = R.ch ? R.ch.kick || 0 : 0;
      if (t > st.next || (R.ch && kick > 0.93 && t - st.at > 700)) {
        st.at = t; st.dur = 110 + Math.random() * 220; st.next = t + 2800 + Math.random() * 6500; st.x = 0.1 + Math.random() * 0.8; st.bolt = [];
        let bx = st.x, by = 0; while (by < 0.75) { st.bolt.push([bx, by]); bx += (Math.random() - 0.5) * 0.07; by += 0.04 + Math.random() * 0.05; }
      }
      ctx.fillStyle = 'rgba(40,60,120,.08)'; ctx.fillRect(0, 0, w, h);
      const a = Math.max(0, 1 - (t - st.at) / st.dur);
      if (a > 0) {
        const f = a * (0.65 + 0.35 * Math.sin(t / 17));
        ctx.fillStyle = 'rgba(200,215,255,' + (0.3 * f) + ')'; ctx.fillRect(0, 0, w, h);
        const g = ctx.createRadialGradient(st.x * w, 0, 8, st.x * w, 0, big * 0.7); g.addColorStop(0, 'rgba(225,235,255,' + (0.6 * f) + ')'); g.addColorStop(1, 'rgba(225,235,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(235,242,255,' + (0.9 * f) + ')'; ctx.lineWidth = 2.6; ctx.beginPath(); st.bolt.forEach((q, i) => { if (i) ctx.lineTo(q[0] * w, q[1] * h); else ctx.moveTo(q[0] * w, q[1] * h); }); ctx.stroke();
      }
    } else if (mode === 'aurora-ribbons') {
      const rc = ['60,255,170', '120,140,255', '200,100,255'];
      for (let k = 0; k < 3; k++) {
        const base = h * (0.16 + k * 0.1), top = [], g = ctx.createLinearGradient(0, base - h * 0.08, 0, base + h * 0.36); g.addColorStop(0, 'rgba(' + rc[k] + ',0)'); g.addColorStop(0.3, 'rgba(' + rc[k] + ',' + (0.3 + p * 0.22) + ')'); g.addColorStop(1, 'rgba(' + rc[k] + ',0)');
        ctx.beginPath(); for (let x = 0; x <= w + 12; x += 12) { const y = base + Math.sin(x / (170 + k * 60) + t / (2200 + k * 500)) * h * 0.07 + Math.sin(x / 85 + t / 1500) * h * 0.02; top.push([x, y]); if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        for (let i = top.length - 1; i >= 0; i--) ctx.lineTo(top[i][0], top[i][1] + h * 0.3); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      }
    } else if (mode === 'god-rays') {
      const sx = w * 0.78, sy = h * 0.1;
      for (let i = 0; i < 14; i++) {
        const ang = 1.9 + i * 0.12 + Math.sin(t / 6000 + i) * 0.02, len = big * 1.6, g = ctx.createLinearGradient(sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len); g.addColorStop(0, 'rgba(255,228,165,' + (0.2 + p * 0.1) + ')'); g.addColorStop(1, 'rgba(255,228,165,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(ang - 0.03) * len, sy + Math.sin(ang - 0.03) * len); ctx.lineTo(sx + Math.cos(ang + 0.03) * len, sy + Math.sin(ang + 0.03) * len); ctx.closePath(); ctx.fill();
      }
      const s2 = ctx.createRadialGradient(sx, sy, 6, sx, sy, big * 0.35); s2.addColorStop(0, 'rgba(255,240,200,.65)'); s2.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = s2; ctx.fillRect(0, 0, w, h);
    } else if (mode === 'fireplace') {
      const fl = 0.8 + 0.2 * Math.sin(t / 110) + 0.1 * Math.sin(t / 37), g = ctx.createRadialGradient(w * 0.5, h * 1.06, 10, w * 0.5, h * 1.06, big * 0.85);
      g.addColorStop(0, 'rgba(255,150,50,' + (0.52 * fl + p * 0.2) + ')'); g.addColorStop(0.45, 'rgba(255,100,30,' + (0.16 * fl) + ')'); g.addColorStop(1, 'rgba(255,80,20,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const sp = R.ls.sparks || (R.ls.sparks = Array.from({ length: 46 }, () => ({ x: Math.random(), y: 1 + Math.random(), v: 0.0004 + Math.random() * 0.0009, d: Math.random() * 6.28 })));
      for (const q of sp) { q.y -= q.v * (1 + p * 3) * 16; q.x += Math.sin(t / 700 + q.d) * 0.0006; if (q.y < 0.1) { q.y = 1.02; q.x = 0.2 + Math.random() * 0.6; } ctx.fillStyle = 'rgba(255,' + Math.round(150 + q.y * 80) + ',70,' + Math.max(0, 0.3 + 0.5 * (1 - q.y)) + ')'; ctx.beginPath(); ctx.arc(q.x * w, q.y * h, Math.max(0.6, 1 + (1 - Math.min(1, q.y)) * 2), 0, 6.283); ctx.fill(); }
    } else if (mode === 'led-strip') {
      const hue = (t / 40 + (R.ch ? (R.ch.snare || 0) * 70 : 0)) % 360, a = 0.4 + p * 0.3;
      const edge = (x0, y0, x1, y1, hh, al) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'hsla(' + Math.round(hh) + ',100%,58%,' + al + ')'); g.addColorStop(1, 'hsla(' + Math.round(hh) + ',100%,58%,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); };
      edge(0, 0, 0, h * 0.24, hue, a); edge(0, h, 0, h * 0.76, (hue + 140) % 360, a); edge(0, 0, w * 0.1, 0, (hue + 70) % 360, a * 0.55); edge(w, 0, w * 0.9, 0, (hue + 210) % 360, a * 0.55);
    } else if (mode === 'fairy-lights') {
      for (let k = 0; k < 3; k++) {
        const y0 = h * (0.03 + k * 0.05), sag = h * (0.07 + k * 0.01);
        for (let i = 0; i < 16; i++) {
          const u = (i + 0.5) / 16, x = w * u, y = y0 + Math.sin(u * Math.PI) * sag + k * 6, tw = 0.55 + 0.45 * Math.sin(t / 420 + i * 1.7 + k * 2), col = ['255,214,140', '255,170,200', '190,225,255', '255,244,200'][(i + k) % 4];
          const g = ctx.createRadialGradient(x, y, 0, x, y, 34); g.addColorStop(0, 'rgba(' + col + ',' + (0.8 * tw + p * 0.15) + ')'); g.addColorStop(0.3, 'rgba(' + col + ',' + (0.22 * tw) + ')'); g.addColorStop(1, 'rgba(' + col + ',0)'); ctx.fillStyle = g; ctx.fillRect(x - 34, y - 34, 68, 68);
        }
      }
    } else if (mode === 'lava-glow') {
      const bl = R.ls.blobs || (R.ls.blobs = Array.from({ length: 7 }, (_, i) => ({ x: 0.1 + i * 0.13, y: Math.random(), v: 0.00005 + Math.random() * 0.00012, r: 0.08 + Math.random() * 0.09, c: ['255,120,40', '255,60,110', '255,170,60'][i % 3], d: Math.random() * 6.28 })));
      const base = ctx.createLinearGradient(0, h, 0, h * 0.55); base.addColorStop(0, 'rgba(255,90,30,' + (0.3 + p * 0.15) + ')'); base.addColorStop(1, 'rgba(255,90,30,0)'); ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
      for (const q of bl) { q.y -= q.v * 16 * (1 + p * 2); if (q.y < -0.2) q.y = 1.15; const x = (q.x + Math.sin(t / 3000 + q.d) * 0.05) * w, y = q.y * h, r = q.r * big * (1 + p * 0.25), g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(' + q.c + ',.55)'); g.addColorStop(1, 'rgba(' + q.c + ',0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
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
    if (R.scene && !R.reduce) {
      R.px += (R.mx - R.px) * 0.07; R.py += (R.my - R.py) * 0.07;
      if (R.root) R.root.style.transform = 'perspective(1500px) rotateX(' + f1(R.py * -1.1 * 1000) / 1000 + 'deg) rotateY(' + f1(R.px * 1.5 * 1000) / 1000 + 'deg)';
      if (R.deskEl) R.deskEl.style.transform = 'translate(' + f1(-R.px * 14) + 'px,' + f1(-R.py * 10) + 'px) scale(1.05)';
      if (R.cx >= 0) for (const g of R.glares) { const r = g.el.getBoundingClientRect(); if (r.width) { g.el.style.setProperty('--gx', f1((R.cx - r.left) / r.width * 100) + '%'); g.el.style.setProperty('--gy', f1((R.cy - r.top) / r.height * 100) + '%'); } }
    }
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
    R.light = R.orbs = R.orbit = null; R.view = null; R.mods = []; R.modes = []; R.ch = null; R.ls = {};
    if (R.onMove && R.moveOn) R.moveOn.removeEventListener('pointermove', R.onMove); R.onMove = null; R.moveOn = null; R.root = R.deskEl = null; R.glares = []; R.scene = false;
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
    if (desk !== 'none') { const d = document.createElement('div'); d.className = 'pd-desk'; d.innerHTML = deskSvg(desk); view.insertBefore(d, view.firstChild); R.deskEl = d; if (fx) fx.style.opacity = '.3'; view.style.background = '#05080e'; }
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
      if (id) {
        const gl = document.createElement('i'); gl.className = 'pd-d pd-glare'; gl.style.setProperty('--gl', String(GLOSS[id] || 0.1)); el.appendChild(gl); R.glares.push({ el: gl });
        if (PAPER.indexOf(id) >= 0) el.style.setProperty('--rot', f1((((k * 37) % 11) - 5) * 0.12) + 'deg');
      }
      const want = key ? (reacts[key] || DEF[key] || '') : '';
      if (M && want && want !== 'off') { el.setAttribute('data-rx', want); const g = document.createElement('i'); g.className = 'pd-d pd-rx'; el.appendChild(g); R.mods.push({ el: el, c: want }); }
    });
    /* the scene: light direction, depth, film grain */
    R.scene = desk !== 'none' || pool.length > 0 || lightList.length > 0 || Object.keys(byModule).length > 0;
    if (R.scene) {
      root.style.setProperty('--la', (lightList.length ? LIGHT_ANGLE[lightList[0]] : 150) + 'deg');
      root.classList.add('pd-tilt'); R.root = root;
      const film = document.createElement('div'); film.className = 'pd-film'; film.style.backgroundImage = FILM; view.appendChild(film);
      R.mx = R.my = R.px = R.py = 0; R.cx = -1;
      R.onMove = (e) => { R.mx = (e.clientX / Math.max(1, innerWidth) - 0.5) * 2; R.my = (e.clientY / Math.max(1, innerHeight) - 0.5) * 2; R.cx = e.clientX; R.cy = e.clientY; };
      R.moveOn = view; view.addEventListener('pointermove', R.onMove, { passive: true });
    }
    /* the 3D gallery */
    const box = root.querySelector('.pd-orbit');
    if (box) { R.orbit = box; wireOrbit(box); R.spin = 0.18; }
    if (R.light || R.orbs || R.orbit || R.mods.length || R.scene) {
      R.resize = () => size(); window.addEventListener('resize', R.resize); size();
      if (!R.reduce) R.raf = requestAnimationFrame(frame);
    }
  }

  window.smlProfileDesk = { apply, stop, orbitHtml, textures: TEX.map((t) => ({ id: t[0], label: t[1] })), desks: DESKS.map((d) => ({ id: d[0], label: d[1] })), lights: LIGHTS.map((d) => ({ id: d[0], label: d[1] })), orbs: ORB_LEVELS.map((d) => ({ id: d[0], label: d[1] })) };
})();
