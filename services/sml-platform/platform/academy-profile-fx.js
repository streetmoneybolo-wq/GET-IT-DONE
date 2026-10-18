/* Academy profile page: REACTIVE SCREEN EFFECTS (window.smlProfileFx). About 120 effects: weather, money and markets, nature, space,
   tech, party, abstract and colour palettes. Objects fly in perspective (near ones are bigger, faster and sharper), tumble in 3D
   (coins flip edge-on, petals flutter) and every effect listens to one part of the song: the kick, bass, vocals, snare or hi-hats
   make it swell, speed up, burst and flash. The page owns the canvases and the animation loop; this file owns the drawing.
   Plain script, inlined into the Academy page (no backtick or dollar-brace anywhere; emoji are written as the characters themselves). */
(() => {
  'use strict';
  if (window.smlProfileFx) return;
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif';

  /* ---------- the catalogue: [id, label, group, motion, shape, options] ---------- */
  const GOLD = ['#ffd24a', '#ffe58a', '#f4b400'];
  const NEON = ['#ff2d95', '#2de2ff', '#b44dff', '#ffd23d', '#3dff8a'];
  const RAINBOW = ['#ff5a5a', '#ff9a3a', '#ffd23d', '#3dff8a', '#3ac8ff', '#b44dff'];
  const CAT = [
    /* lighting: real light that moves to the song (beams with haze, sweeping fixtures, flares, flicker) */
    ['volumetric-rays', 'Volumetric rays', 'Lighting', 'shafts', null, { ox: 0.12, n: 9, c: ['#fff0c0'], ch: 'vocal', layer: 'front' }],
    ['moonbeam', 'Moonbeam', 'Lighting', 'shafts', null, { ox: 0.88, n: 6, spread: 0.8, c: ['#b8ccff'], ch: 'vocal', also: ['lunar-glow'], layer: 'front' }],
    ['searchlights', 'Searchlights', 'Lighting', 'searchlights', null, { c: ['#fff4d0'], ch: 'bass', layer: 'front' }],
    ['stage-wash', 'Stage wash', 'Lighting', 'stagewash', null, { c: ['#ff2d95', '#2de2ff', '#ffd23d', '#b44dff'], ch: 'kick', layer: 'front' }],
    ['disco-ball', 'Disco ball', 'Lighting', 'discoball', null, { c: ['#ff2d95', '#2de2ff', '#ffd23d', '#b44dff', '#ffffff'], ch: 'kick', layer: 'front' }],
    ['laser-show', 'Laser show', 'Lighting', 'lasers', null, { c: ['#3dff8a', '#ff2d95', '#2de2ff'], ch: 'hats', layer: 'front' }],
    ['strobe', 'Strobe', 'Lighting', 'strobe', null, { c: ['#ffffff'], ch: 'kick', layer: 'front' }],
    ['lens-flare', 'Lens flare', 'Lighting', 'lensflare', null, { c: ['#ffd890'], ch: 'vocal', layer: 'front' }],
    ['fireplace-glow', 'Fireplace glow', 'Lighting', 'firelight', null, { c: ['#ff8a2a'], ch: 'bass', layer: 'front' }],
    ['candle-flicker', 'Candle flicker', 'Lighting', 'firelight', null, { c: ['#ffb050'], small: 1, ch: 'vocal', layer: 'front' }],
    ['neon-flicker', 'Neon flicker', 'Lighting', 'neonflicker', null, { c: ['#ff2d95', '#2de2ff'], ch: 'snare', layer: 'front' }],
    ['police-lights', 'Police lights', 'Lighting', 'police', null, { c: ['#ff2a2a', '#2a5aff'], ch: 'kick', layer: 'front' }],
    ['water-caustics', 'Water caustics', 'Lighting', 'caustics', null, { c: ['#bfefff'], ch: 'bass', layer: 'front' }],
    ['light-leak', 'Film light leak', 'Lighting', 'lightleak', null, { c: ['#ff7a3a', '#ff4a8a', '#ffc04a'], ch: 'bass', layer: 'front' }],
    ['headlights', 'Headlights', 'Lighting', 'headlights', null, { c: ['#fff6d0'], ch: 'bass', layer: 'front' }],
    ['sunset-glow', 'Sunset glow', 'Lighting', 'sunset', null, { c: ['#ff7a3a', '#ffb050'], ch: 'vocal', layer: 'front' }],
    /* weather */
    ['rain', 'Rain', 'Weather', 'rain', null, { n: 150, c: ['#a9d4ff'], ch: 'hats', layer: 'front' }],
    ['heavy-rain', 'Heavy rain', 'Weather', 'rain', null, { n: 280, c: ['#8fc0f0'], ch: 'bass', v: 1.7, layer: 'front' }],
    ['snow', 'Snow', 'Weather', 'fall', 'flake', { n: 110, s: 7, c: ['#ffffff'], v: 0.8, ch: 'vocal', layer: 'front' }],
    ['soft-snow', 'Soft snow', 'Weather', 'fall', 'soft', { n: 90, s: 5, c: ['#ffffff'], v: 0.45, ch: 'vocal', layer: 'front' }],
    ['blizzard', 'Blizzard', 'Weather', 'fall', 'flake', { n: 300, s: 6, c: ['#ffffff'], v: 2.6, sway: 90, wind: 160, ch: 'bass', layer: 'front' }],
    ['fog', 'Fog', 'Weather', 'blobs', null, { n: 9, c: ['#ffffff'], a: 0.07, big: 1.1, ch: 'bass', layer: 'back' }],
    ['smoke', 'Smoke', 'Weather', 'smoke', null, { n: 14, c: ['#b8bcc8'], a: 0.12, ch: 'bass', layer: 'front' }],
    ['dust', 'Dust', 'Weather', 'drift', 'soft', { n: 80, s: 3, c: ['#ffe8b0'], ch: 'hats', layer: 'front' }],
    ['lightning', 'Lightning', 'Weather', 'bolt', null, { c: ['#cfe6ff'], ch: 'snare', layer: 'front' }],
    ['thunder-bugs', 'Thunder bugs', 'Weather', 'drift', 'soft', { n: 60, s: 4, c: ['#2a2a30', '#556'], ch: 'snare', also: ['lightning'], layer: 'front' }],
    ['sunbeams', 'Sunbeams', 'Weather', 'beams', null, { c: ['#fff0b0'], ch: 'vocal', layer: 'back' }],
    ['dust-motes', 'Dust motes', 'Weather', 'drift', 'soft', { n: 70, s: 3.5, c: ['#fff4d0'], v: 0.5, ch: 'hats', also: ['sunbeams'], layer: 'front' }],
    ['rainbow-drops', 'Rainbow drops', 'Weather', 'fall', 'drop', { n: 60, s: 11, c: RAINBOW, v: 1.1, ch: 'vocal', layer: 'front' }],
    ['ocean-waves', 'Ocean waves', 'Weather', 'waves', null, { layers: 5, c: ['#1c7ed6', '#2ec4e8', '#0a4a8a'], ch: 'bass', layer: 'back' }],
    ['waves', 'Waves', 'Weather', 'waves', null, { layers: 4, c: ['acc', 'acc2'], ch: 'bass', layer: 'back' }],
    ['frost-wave', 'Frost wave', 'Palettes', 'waves', null, { layers: 4, c: ['#bfe8ff', '#7fc8f0', '#e8f8ff'], ch: 'bass', also: ['soft-snow'], layer: 'back' }],
    ['amber-tide', 'Amber tide', 'Palettes', 'waves', null, { layers: 4, c: ['#ffb02e', '#ff7a1a', '#ffd479'], ch: 'bass', layer: 'back' }],
    ['quantum', 'Quantum', 'Weather', 'orbit', 'spark', { n: 70, s: 5, c: ['acc', 'acc2', '#ffffff'], ch: 'vocal', path: true, layer: 'front' }],
    ['energy', 'Energy', 'Weather', 'rise', 'spark', { n: 90, s: 5, c: ['acc', 'acc2', '#ffffff'], v: 2.2, ch: 'kick', also: ['neon-rings'], layer: 'front' }],
    ['glitch', 'Glitch', 'Weather', 'glitch', null, { c: ['#2de2ff', '#ff2d95'], ch: 'snare', layer: 'front' }],
    /* money and markets */
    ['money-rain', 'Money rain', 'Money', 'fall', 'bill', { n: 48, s: 22, v: 1, ch: 'bass', spin: 1, layer: 'front' }],
    ['coin-shower', 'Coin shower', 'Money', 'fall', 'coin', { n: 64, s: 17, sym: '$', ch: 'bass', spin: 1, layer: 'front' }],
    ['euro-rain', 'Euro rain', 'Money', 'fall', 'coin', { n: 56, s: 17, sym: '€', ch: 'bass', spin: 1, layer: 'front' }],
    ['bitcoin-rain', 'Bitcoin rain', 'Money', 'fall', 'coin', { n: 56, s: 17, sym: '₿', col: '#f7931a', ch: 'bass', spin: 1, layer: 'front' }],
    ['pound-yen', 'Pound & yen', 'Money', 'fall', 'coin', { n: 60, s: 17, syms: ['£', '¥'], ch: 'bass', spin: 1, layer: 'front' }],
    ['percent-shower', 'Percent shower', 'Money', 'fall', 'text', { n: 50, s: 20, txts: ['%', '+%', '%'], c: ['#16c784'], ch: 'vocal', layer: 'front' }],
    ['hundred-club', 'Hundred club', 'Money', 'fall', 'text', { n: 34, s: 22, txts: ['100', '100%', '$100'], c: GOLD, ch: 'bass', bold: 1, layer: 'front' }],
    ['green-candles', 'Green candles', 'Money', 'fall', 'candleG', { n: 46, s: 18, ch: 'kick', layer: 'front' }],
    ['red-candles', 'Red candles', 'Money', 'fall', 'candleR', { n: 46, s: 18, ch: 'kick', layer: 'front' }],
    ['candle-storm', 'Candle storm', 'Money', 'fall', 'candle', { n: 70, s: 18, v: 1.4, ch: 'kick', layer: 'front' }],
    ['chart-rally', 'Chart rally', 'Money', 'rise', 'candleG', { n: 40, s: 16, v: 1.2, ch: 'kick', layer: 'front' }],
    ['arrow-storm', 'Arrow storm', 'Money', 'fall', 'arrow', { n: 56, s: 17, v: 1.3, ch: 'snare', layer: 'front' }],
    ['ticker-tape', 'Ticker tape', 'Money', 'cross', 'chip', { n: 11, s: 14, v: 1.6, dir: -1, txts: ['NVDA +2.3%', 'SPY +0.8%', 'TSLA -1.2%', 'AAPL +0.4%', 'QQQ +1.1%', 'BTC +3.7%', 'AMD +4.2%', 'META -0.6%'], ch: 'hats', layer: 'front' }],
    ['money-bags', 'Money bags', 'Money', 'fall', '💰', { n: 18, s: 26, ch: 'bass', layer: 'front' }],
    ['diamond-hands', 'Diamond hands', 'Money', 'fall', ['💎', '🙌'], { n: 20, s: 26, ch: 'kick', layer: 'front' }],
    ['to-the-moon', 'To the moon', 'Money', 'rise', ['🚀', '🌕', '✨'], { n: 16, s: 28, v: 1.5, ch: 'kick', layer: 'front' }],
    ['rockets', 'Rockets', 'Money', 'rise', '🚀', { n: 12, s: 30, v: 1.7, ch: 'kick', layer: 'front' }],
    ['bull-run', 'Bull run', 'Money', 'cross', '🐂', { n: 5, s: 40, v: 1.3, dir: 1, flip: 1, ch: 'kick', layer: 'front' }],
    ['bull-stampede', 'Bull stampede', 'Money', 'cross', '🐂', { n: 16, s: 38, v: 1.8, dir: 1, flip: 1, ch: 'kick', layer: 'front' }],
    ['bear-drop', 'Bear drop', 'Money', 'fall', '🐻', { n: 10, s: 34, v: 1.1, ch: 'bass', layer: 'front' }],
    ['bear-market', 'Bear market', 'Money', 'cross', '🐻', { n: 12, s: 34, v: 1.2, dir: -1, ch: 'bass', layer: 'front' }],
    ['coin-flip', 'Coin flip', 'Money', 'fall', 'coin', { n: 12, s: 30, sym: '$', v: 1.4, ch: 'snare', spin: 3, layer: 'front' }],
    ['orbiting-coins', 'Orbiting coins', 'Money', 'orbit', 'coin', { n: 18, s: 22, sym: '$', ch: 'bass', spin: 1.5, layer: 'front' }],
    ['fire', 'Fire', 'Money', 'rise', '🔥', { n: 34, s: 28, v: 1.3, ch: 'bass', layer: 'front' }],
    ['dollar-matrix', 'Dollar matrix', 'Money', 'matrix', null, { chars: '$€£¥₿%0123456789', c: ['#2ea44f', '#7dffa0'], ch: 'hats', layer: 'back' }],
    /* nature */
    ['embers', 'Embers', 'Nature', 'rise', 'ember', { n: 100, s: 5, c: ['#ff9f43', '#ffd479', '#ff6a1a'], ch: 'bass', layer: 'front' }],
    ['fireflies', 'Fireflies', 'Nature', 'drift', 'spark', { n: 44, s: 7, c: ['#e8ff7a', '#fff9a0'], pulse: 1, ch: 'vocal', layer: 'front' }],
    ['bubbles', 'Bubbles', 'Nature', 'rise', 'bubble', { n: 54, s: 17, v: 0.8, ch: 'vocal', layer: 'front' }],
    ['cherry-blossom', 'Cherry blossom', 'Nature', 'fall', 'petal', { n: 80, s: 11, c: ['#ffc4d8', '#ffadc8', '#fff0f4'], v: 0.7, spin: 1, ch: 'vocal', layer: 'front' }],
    ['petals', 'Petals', 'Nature', 'fall', 'petal', { n: 70, s: 12, c: ['#ff9cba', '#ffd23d', '#c94aff', '#ffffff'], v: 0.7, spin: 1, ch: 'vocal', layer: 'front' }],
    ['autumn-leaves', 'Autumn leaves', 'Nature', 'fall', 'leaf', { n: 54, s: 16, c: ['#e8641a', '#c9301a', '#f0a020', '#8a4a14'], v: 0.9, spin: 1, ch: 'bass', layer: 'front' }],
    ['leaves-drift', 'Leaves drift', 'Nature', 'fall', 'leaf', { n: 46, s: 15, c: ['#3a9a3a', '#5ab84a', '#2a7a30'], v: 0.55, spin: 1, ch: 'vocal', layer: 'front' }],
    ['clover-luck', 'Clover luck', 'Nature', 'fall', '🍀', { n: 34, s: 22, v: 0.8, spin: 1, ch: 'vocal', layer: 'front' }],
    ['jade-spark', 'Jade spark', 'Palettes', 'rise', 'spark', { n: 80, s: 6, c: ['#3dffb0', '#00c47d', '#b8ffe0'], ch: 'hats', layer: 'front' }],
    /* space */
    ['meteors', 'Meteors', 'Space', 'meteor', null, { n: 9, c: ['#ffffff', '#cfe6ff'], ch: 'snare', layer: 'front' }],
    ['comet-tails', 'Comet tails', 'Space', 'meteor', null, { n: 5, c: ['#7fe0ff', '#ffb02e', '#ff5ad0'], long: 1, ch: 'kick', layer: 'front' }],
    ['starfield', 'Starfield', 'Space', 'twinkle', null, { n: 170, c: ['#ffffff', '#cfe6ff', '#fff0c0'], ch: 'hats', layer: 'back' }],
    ['stars', 'Stars', 'Space', 'twinkle', null, { n: 140, c: ['acc', 'acc2', '#ffffff'], ch: 'hats', layer: 'back' }],
    ['stars-falling', 'Stars falling', 'Space', 'fall', 'star', { n: 50, s: 13, c: GOLD, v: 1.1, spin: 1, ch: 'hats', layer: 'front' }],
    ['warp-speed', 'Warp speed', 'Space', 'warp', 'streak', { n: 160, c: ['#ffffff', '#bfe0ff'], ch: 'kick', layer: 'front' }],
    ['hyperspace', 'Hyperspace', 'Space', 'warp', 'streak', { n: 220, c: ['#7fe0ff', '#b44dff', '#ffffff'], v: 1.8, ch: 'kick', also: ['neon-rings'], layer: 'front' }],
    ['spiral-galaxy', 'Spiral galaxy', 'Space', 'galaxy', null, { n: 420, c: ['#ffe8c0', '#b8a8ff', '#7fe0ff', '#ffb0e0'], ch: 'bass', layer: 'back' }],
    ['vortex', 'Vortex', 'Space', 'vortex', 'spark', { n: 190, s: 5, c: ['acc', 'acc2', '#ffffff'], ch: 'bass', layer: 'front' }],
    ['orbit-rings', 'Orbit rings', 'Space', 'orbitrings', null, { c: ['acc', 'acc2', '#ffffff'], ch: 'bass', layer: 'front' }],
    ['planets', 'Planets', 'Space', 'orbit', ['🪐', '🌍', '🌕', '🔴', '🟠'], { n: 7, s: 34, ch: 'bass', layer: 'front' }],
    ['ufo-sighting', 'UFO sighting', 'Space', 'cross', '🛸', { n: 4, s: 40, v: 1.2, dir: 0, wave: 1, ch: 'vocal', layer: 'front' }],
    ['aliens', 'Aliens', 'Space', 'drift', '👽', { n: 12, s: 32, v: 0.7, ch: 'vocal', layer: 'front' }],
    ['satellites', 'Satellites', 'Space', 'cross', '🛰️', { n: 5, s: 30, v: 0.8, dir: 1, ch: 'hats', layer: 'front' }],
    ['nova-dust', 'Nova Dust', 'Palettes', 'drift', 'spark', { n: 110, s: 4, c: ['#ffffff', '#a8c8ff', '#ffd0f0'], ch: 'hats', layer: 'front' }],
    ['lunar-glow', 'Lunar Glow', 'Palettes', 'blobs', null, { n: 6, c: ['#f4eec0', '#cfd8ff'], a: 0.12, big: 0.8, ch: 'vocal', moon: 1, layer: 'back' }],
    /* tech */
    ['matrix-code', 'Matrix code', 'Tech', 'matrix', null, { chars: 'アイウエオカキクケコサシスセソ0123456789', c: ['#00ff66', '#b8ffcc'], ch: 'hats', layer: 'back' }],
    ['binary-rain', 'Binary rain', 'Tech', 'matrix', null, { chars: '01', c: ['#2de2ff', '#bff6ff'], ch: 'hats', layer: 'back' }],
    ['pixel-rain', 'Pixel rain', 'Tech', 'matrix', null, { chars: '█▓▒', c: ['acc', 'acc2'], ch: 'hats', size: 14, layer: 'back' }],
    ['cyber-grid', 'Cyber grid', 'Tech', 'floorgrid', null, { c: ['#ff2d95', '#2de2ff'], ch: 'bass', layer: 'back' }],
    ['grid', 'Grid', 'Tech', 'flatgrid', null, { c: ['acc'], ch: 'bass', layer: 'back' }],
    ['robots', 'Robots', 'Tech', 'cross', '🤖', { n: 8, s: 34, v: 1, dir: 0, ch: 'snare', layer: 'front' }],
    ['hex-swarm', 'Hex swarm', 'Tech', 'drift', 'hex', { n: 46, s: 18, c: ['acc', 'acc2', '#ffffff'], ch: 'hats', spin: 1, layer: 'front' }],
    ['glitch-squares', 'Glitch squares', 'Tech', 'glitch', null, { blocks: 1, c: ['acc', '#ff2d95', '#2de2ff'], ch: 'snare', layer: 'front' }],
    ['sine-field', 'Sine field', 'Tech', 'sinefield', null, { c: ['acc', 'acc2'], ch: 'vocal', layer: 'back' }],
    ['dna-strand', 'DNA strand', 'Tech', 'dna', null, { c: ['acc', 'acc2'], ch: 'vocal', layer: 'front' }],
    ['particles', 'Particles', 'Tech', 'drift', 'spark', { n: 80, s: 3.5, c: ['acc', 'acc2'], ch: 'hats', layer: 'front' }],
    /* party */
    ['confetti', 'Confetti', 'Party', 'fall', 'conf', { n: 130, s: 9, c: RAINBOW, v: 1.1, spin: 2, ch: 'snare', layer: 'front' }],
    ['gold-confetti', 'Gold confetti', 'Party', 'fall', 'conf', { n: 130, s: 9, c: GOLD, v: 1.1, spin: 2, ch: 'snare', layer: 'front' }],
    ['neon-confetti', 'Neon confetti', 'Party', 'fall', 'conf', { n: 130, s: 9, c: NEON, v: 1.1, spin: 2, ch: 'snare', layer: 'front' }],
    ['party-poppers', 'Party poppers', 'Party', 'poppers', 'conf', { s: 9, c: RAINBOW, ch: 'kick', layer: 'front' }],
    ['fireworks', 'Fireworks', 'Party', 'firework', null, { c: RAINBOW.concat(GOLD), ch: 'kick', layer: 'front' }],
    ['sparklers', 'Sparklers', 'Party', 'sparkler', null, { c: ['#ffe08a', '#fff4c0', '#ffffff'], ch: 'hats', layer: 'front' }],
    ['fountain', 'Fountain', 'Party', 'fountain', 'drop', { s: 9, c: ['#7fd4ff', '#bfe8ff', '#ffffff'], ch: 'bass', layer: 'front' }],
    ['champagne', 'Champagne', 'Party', 'fountain', 'bubble', { s: 9, c: ['#ffe08a'], also: ['bubbles'], ch: 'bass', layer: 'front' }],
    ['balloons', 'Balloons', 'Party', 'rise', '🎈', { n: 18, s: 34, v: 0.8, ch: 'bass', layer: 'front' }],
    ['lanterns', 'Lanterns', 'Party', 'rise', '🏮', { n: 20, s: 30, v: 0.6, ch: 'vocal', layer: 'front' }],
    ['cake-day', 'Cake day', 'Party', 'fall', '🎂', { n: 12, s: 30, v: 0.9, also: ['confetti'], ch: 'kick', layer: 'front' }],
    ['music-storm', 'Music storm', 'Party', 'rise', 'note', { n: 90, s: 18, c: NEON, v: 1.4, ch: 'vocal', layer: 'front' }],
    ['notes', 'Notes', 'Party', 'rise', 'note', { n: 38, s: 17, c: ['acc', 'acc2', '#ffffff'], ch: 'vocal', layer: 'front' }],
    ['vinyl-spin', 'Vinyl spin', 'Party', 'vinyl', null, { c: ['acc', 'acc2'], ch: 'bass', layer: 'front' }],
    ['clap-track', 'Clap track', 'Party', 'rise', '👏', { n: 18, s: 28, v: 1.1, ch: 'snare', layer: 'front' }],
    ['thumbs-up', 'Thumbs up', 'Party', 'rise', '👍', { n: 18, s: 28, ch: 'kick', layer: 'front' }],
    /* hearts and fun */
    ['hearts', 'Hearts', 'Fun', 'rise', 'heart', { n: 40, s: 15, c: ['#ff4a6a', '#ff7a9a', '#ffb0c4'], v: 0.9, ch: 'vocal', layer: 'front' }],
    ['purple-hearts', 'Purple hearts', 'Fun', 'fall', '💜', { n: 28, s: 24, v: 0.9, ch: 'vocal', layer: 'front' }],
    ['heartbeat', 'Heartbeat', 'Fun', 'heartbeat', null, { c: ['#ff3a5a'], ch: 'kick', layer: 'front' }],
    ['ghosts', 'Ghosts', 'Fun', 'drift', '👻', { n: 12, s: 34, v: 0.6, ch: 'vocal', layer: 'front' }],
    ['skull-drift', 'Skull drift', 'Fun', 'drift', '💀', { n: 12, s: 30, v: 0.6, ch: 'bass', layer: 'front' }],
    ['dice-roll', 'Dice roll', 'Fun', 'fall', '🎲', { n: 16, s: 28, spin: 2, ch: 'snare', layer: 'front' }],
    ['card-shower', 'Card shower', 'Fun', 'fall', ['🃏', '♠️', '♥️', '♦️', '♣️'], { n: 26, s: 26, spin: 2, ch: 'snare', layer: 'front' }],
    ['chess-rain', 'Chess rain', 'Fun', 'fall', ['♟️', '♞', '♜', '♛', '♚'], { n: 24, s: 28, spin: 1, ch: 'kick', layer: 'front' }],
    ['eyes-on-you', 'Eyes on you', 'Fun', 'eyes', null, { ch: 'vocal', layer: 'front' }],
    /* abstract */
    ['aurora', 'Aurora', 'Abstract', 'ribbons', null, { c: ['acc', 'acc2', '#7fffd4'], ch: 'vocal', layer: 'back' }],
    ['aurora-ribbons', 'Aurora ribbons', 'Abstract', 'ribbons', null, { c: ['#3dffb0', '#7a5cff', '#2de2ff'], ch: 'vocal', layer: 'back' }],
    ['bokeh', 'Bokeh', 'Abstract', 'bokeh', null, { n: 26, ch: 'bass', layer: 'back' }],
    ['plasma-orbs', 'Plasma orbs', 'Abstract', 'blobs', null, { n: 7, c: ['acc', 'acc2', '#ff2d95'], a: 0.3, big: 0.5, hue: 1, ch: 'bass', layer: 'back' }],
    ['velvet-drift', 'Velvet Drift', 'Palettes', 'blobs', null, { n: 8, c: ['#7a1a6a', '#b0306a', '#3a1a6a'], a: 0.22, big: 0.9, ch: 'bass', layer: 'back' }],
    ['sea-anemone', 'Sea anemone', 'Abstract', 'anemone', null, { c: ['acc', 'acc2', '#ff6ad0'], ch: 'vocal', layer: 'front' }],
    ['sonar', 'Sonar', 'Abstract', 'rings', null, { c: ['#3dff8a'], sweep: 1, ch: 'kick', layer: 'front' }],
    ['neon-rings', 'Neon rings', 'Abstract', 'rings', null, { c: ['#ff2d95', '#2de2ff', '#b44dff'], ch: 'kick', layer: 'front' }],
    ['grid-pulse', 'Grid pulse', 'Abstract', 'rings', null, { c: ['acc', 'acc2'], square: 1, ch: 'kick', layer: 'front' }]
  ];
  const ENTRIES = CAT.map((e) => ({ id: e[0], label: e[1], group: e[2], motion: e[3], shape: e[4], o: e[5] || {} }));
  const BY = {}; ENTRIES.forEach((e) => { BY[e.id] = e; });

  /* ---------- sprites: emoji and soft glows are painted once and stamped ---------- */
  const sprites = {};
  function emoji(g) {
    let c = sprites[g]; if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 96;
    const x = c.getContext('2d'); x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '64px ' + FONT; x.fillText(g, 48, 52);
    sprites[g] = c; return c;
  }
  function glow(col) {
    const k = 'g' + col; let c = sprites[k]; if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, col); g.addColorStop(0.5, col + '66'); g.addColorStop(1, col + '00');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); sprites[k] = c; return c;
  }
  const hex6 = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff');

  /* ---------- vector shapes (centred on 0,0, r = radius in px) ---------- */
  function poly(x, pts) { x.beginPath(); pts.forEach((p, i) => { if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); }); x.closePath(); }
  function shape(x, kind, r, col, P, F) {
    if (kind === 'coin') {
      const cs = Math.cos(P.sp), edge = Math.abs(cs) < 0.2;
      const base = P.cc || '#e8b520';
      if (edge) { x.fillStyle = '#b8870a'; x.fillRect(-r * 0.1, -r, r * 0.2, r * 2); return; }
      x.save(); x.scale(cs, 1);
      const g = x.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
      g.addColorStop(0, '#fff2b0'); g.addColorStop(0.45, base); g.addColorStop(1, '#8a5c00');
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, TAU); x.fill();
      x.lineWidth = Math.max(1, r * 0.12); x.strokeStyle = 'rgba(120,80,0,.9)'; x.stroke();
      x.lineWidth = Math.max(1, r * 0.06); x.strokeStyle = 'rgba(255,240,170,.8)'; x.beginPath(); x.arc(0, 0, r * 0.74, 0, TAU); x.stroke();
      x.fillStyle = 'rgba(110,70,0,.85)'; x.font = '900 ' + Math.round(r * 1.05) + 'px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(P.txt || '$', 0, r * 0.06);
      x.restore(); return;
    }
    if (kind === 'bill') {
      x.save(); x.scale(Math.cos(P.sp) * 0.9 + (Math.cos(P.sp) < 0 ? -0.1 : 0.1), 1);
      x.fillStyle = '#2f9a52'; x.fillRect(-r * 1.15, -r * 0.6, r * 2.3, r * 1.2);
      x.strokeStyle = '#d4f5dc'; x.lineWidth = Math.max(1, r * 0.08); x.strokeRect(-r * 1.0, -r * 0.46, r * 2.0, r * 0.92);
      x.fillStyle = 'rgba(255,255,255,.2)'; x.beginPath(); x.ellipse(0, 0, r * 0.42, r * 0.3, 0, 0, TAU); x.fill();
      x.fillStyle = '#d4f5dc'; x.font = '900 ' + Math.round(r * 0.8) + 'px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 0, r * 0.04);
      x.restore(); return;
    }
    if (kind === 'candle' || kind === 'candleG' || kind === 'candleR') {
      const green = kind === 'candleG' || (kind === 'candle' && P.up), c = green ? '#16c784' : '#ea3943';
      x.strokeStyle = c; x.lineWidth = Math.max(1.5, r * 0.1); x.beginPath(); x.moveTo(0, -r * 1.1); x.lineTo(0, r * 1.1); x.stroke();
      x.fillStyle = c; x.fillRect(-r * 0.36, -r * 0.62, r * 0.72, r * 1.24);
      x.fillStyle = 'rgba(255,255,255,.28)'; x.fillRect(-r * 0.36, -r * 0.62, r * 0.18, r * 1.24); return;
    }
    if (kind === 'arrow') {
      const c = P.up ? '#16c784' : '#ea3943', d = P.up ? -1 : 1;
      x.fillStyle = c; poly(x, [[0, d * r], [r * 0.7, -d * r * 0.1], [r * 0.26, -d * r * 0.1], [r * 0.26, -d * r], [-r * 0.26, -d * r], [-r * 0.26, -d * r * 0.1], [-r * 0.7, -d * r * 0.1]]); x.fill(); return;
    }
    if (kind === 'flake') {
      x.strokeStyle = col; x.lineWidth = Math.max(1, r * 0.14); x.lineCap = 'round';
      for (let i = 0; i < 6; i++) { x.save(); x.rotate(i * TAU / 6); x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -r); x.moveTo(0, -r * 0.55); x.lineTo(r * 0.28, -r * 0.8); x.moveTo(0, -r * 0.55); x.lineTo(-r * 0.28, -r * 0.8); x.stroke(); x.restore(); }
      return;
    }
    if (kind === 'soft' || kind === 'spark' || kind === 'ember') {
      const g = glow(hex6(col)), s = r * (kind === 'ember' ? 3.2 : 4); x.drawImage(g, -s / 2, -s / 2, s, s); return;
    }
    if (kind === 'bubble') {
      x.strokeStyle = 'rgba(255,255,255,.65)'; x.lineWidth = Math.max(1, r * 0.1);
      const g = x.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, 0, 0, r);
      g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(0.6, 'rgba(180,220,255,.12)'); g.addColorStop(1, 'rgba(180,220,255,.3)');
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, TAU); x.fill(); x.stroke();
      x.fillStyle = 'rgba(255,255,255,.8)'; x.beginPath(); x.ellipse(-r * 0.35, -r * 0.4, r * 0.22, r * 0.12, -0.7, 0, TAU); x.fill(); return;
    }
    if (kind === 'drop') {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, -r * 1.4); x.bezierCurveTo(r * 1.1, -r * 0.1, r * 0.9, r, 0, r); x.bezierCurveTo(-r * 0.9, r, -r * 1.1, -r * 0.1, 0, -r * 1.4); x.fill();
      x.fillStyle = 'rgba(255,255,255,.5)'; x.beginPath(); x.ellipse(-r * 0.35, 0, r * 0.14, r * 0.35, 0.2, 0, TAU); x.fill(); return;
    }
    if (kind === 'heart') {
      const g = x.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.3);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, col); g.addColorStop(1, col);
      x.fillStyle = g; x.beginPath(); x.moveTo(0, r * 0.9); x.bezierCurveTo(-r * 1.5, -r * 0.1, -r * 0.6, -r * 1.2, 0, -r * 0.45); x.bezierCurveTo(r * 0.6, -r * 1.2, r * 1.5, -r * 0.1, 0, r * 0.9); x.fill(); return;
    }
    if (kind === 'star') {
      const g = x.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, '#fffbe0'); g.addColorStop(1, col);
      x.fillStyle = g; x.beginPath();
      for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; if (i) x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else x.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      x.closePath(); x.fill(); return;
    }
    if (kind === 'note') {
      x.fillStyle = col; x.shadowColor = col; x.shadowBlur = r * 0.8; x.font = '900 ' + Math.round(r * 2) + 'px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(P.txt || '♪', 0, 0); x.shadowBlur = 0; return;
    }
    if (kind === 'text') {
      x.fillStyle = col; x.shadowColor = col; x.shadowBlur = r * 0.5; x.font = '900 ' + Math.round(r * 1.5) + 'px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(P.txt || '%', 0, 0); x.shadowBlur = 0; return;
    }
    if (kind === 'chip') {
      const up = P.txt.indexOf('-') < 0; x.font = '800 ' + Math.round(r) + 'px ui-monospace,monospace'; const w = x.measureText(P.txt).width + r * 1.2;
      x.fillStyle = up ? 'rgba(22,199,132,.9)' : 'rgba(234,57,67,.9)'; x.beginPath(); if (x.roundRect) x.roundRect(-w / 2, -r * 0.9, w, r * 1.8, r * 0.5); else x.rect(-w / 2, -r * 0.9, w, r * 1.8); x.fill();
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(P.txt, 0, 1); return;
    }
    if (kind === 'conf') { x.fillStyle = col; x.fillRect(-r * 0.5, -r, r, r * 2); x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(-r * 0.5, -r, r * 0.3, r * 2); return; }
    if (kind === 'petal') {
      const g = x.createRadialGradient(0, -r * 0.2, r * 0.1, 0, 0, r * 1.1); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, col); g.addColorStop(1, col);
      x.fillStyle = g; x.beginPath(); x.moveTo(0, -r); x.bezierCurveTo(r * 1.1, -r * 0.5, r * 0.7, r, 0, r); x.bezierCurveTo(-r * 0.7, r, -r * 1.1, -r * 0.5, 0, -r); x.fill(); return;
    }
    if (kind === 'leaf') {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, -r * 1.2); x.bezierCurveTo(r * 1.1, -r * 0.4, r * 0.8, r * 0.9, 0, r * 1.2); x.bezierCurveTo(-r * 0.8, r * 0.9, -r * 1.1, -r * 0.4, 0, -r * 1.2); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = Math.max(1, r * 0.08); x.beginPath(); x.moveTo(0, -r * 1.1); x.lineTo(0, r * 1.3); x.stroke(); return;
    }
    if (kind === 'hex') {
      x.strokeStyle = col; x.lineWidth = 2; x.globalAlpha *= 0.7; x.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6; if (i) x.lineTo(Math.cos(a) * r, Math.sin(a) * r); else x.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      x.closePath(); x.stroke(); return;
    }
  }

  /* ---------- the engine ---------- */
  function resolve(list, env) { return (list || ['#ffffff']).map((c) => (c === 'acc' ? hex6(env.acc) : c === 'acc2' ? hex6(env.acc2) : c)); }
  function depth() { return 0.5 + Math.random() * 0.75; }

  function mkParticle(inst, F, initial) {
    const o = inst.e.o, w = F.w, h = F.h, z = depth(), P = { z: z, a: rnd(0, TAU), aw: rnd(0.6, 1.8), sp: rnd(0, TAU), sv: rnd(0.8, 2.6) * (o.spin || 0) * (Math.random() < 0.5 ? -1 : 1), rot: 0, rv: 0, size: (o.s || 12) * rnd(0.7, 1.25), col: pick(inst.c), x: rnd(0, w), y: rnd(0, h), vx: 0, vy: 0, up: Math.random() < 0.5, g: null, txt: '' };
    const m = inst.e.motion;
    if (inst.glyphs) P.g = pick(inst.glyphs);
    if (o.txts) P.txt = pick(o.txts);
    if (o.syms) P.txt = pick(o.syms); else if (o.sym) P.txt = o.sym;
    if (o.col) { P.col = o.col; P.cc = o.col; }
    if (inst.e.shape === 'note') P.txt = pick(['♪', '♫', '♩', '♬']);
    if (inst.e.shape === 'candleG') P.up = true; if (inst.e.shape === 'candleR') P.up = false;
    if (inst.e.shape === 'arrow' && inst.e.id === 'arrow-storm') P.up = Math.random() < 0.5;
    if (o.spin) P.rot = rnd(0, TAU), P.rv = rnd(-1.2, 1.2) * (o.spin > 1 ? 2 : 0.6);
    const v = (o.v || 1) * (0.55 + z * 0.6);
    if (m === 'fall') { P.vy = rnd(70, 150) * v; P.sway = o.sway || rnd(14, 40); P.wind = o.wind || 0; if (!initial) P.y = -P.size * 2 - rnd(0, h * 0.25); }
    else if (m === 'rise') { P.vy = -rnd(60, 140) * v; P.sway = rnd(12, 34); if (!initial) P.y = h + P.size * 2 + rnd(0, h * 0.25); }
    else if (m === 'drift') { P.vx = rnd(-26, 26) * v; P.vy = rnd(-22, 22) * v; }
    else if (m === 'cross') {
      const dir = o.dir === 0 || o.dir === undefined ? (Math.random() < 0.5 ? -1 : 1) : o.dir; P.dir = dir; P.vx = rnd(70, 150) * v * dir; P.by = rnd(h * 0.12, h * 0.9); P.amp = o.wave ? rnd(20, 70) : rnd(0, 14);
      P.x = initial ? rnd(0, w) : (dir > 0 ? -P.size * 3 - rnd(0, w * 0.4) : w + P.size * 3 + rnd(0, w * 0.4));
    }
    else if (m === 'orbit') { P.ang = rnd(0, TAU); P.w = rnd(0.25, 0.7) * (Math.random() < 0.75 ? 1 : -1) * (o.path ? 1.6 : 1); P.rx = rnd(0.18, 0.5) * w; P.ry = rnd(0.12, 0.34) * h; P.tilt = rnd(-0.7, 0.7); }
    else if (m === 'warp') { P.ang = rnd(0, TAU); P.d = initial ? Math.random() : 0; P.spd = rnd(0.25, 0.7) * (o.v || 1); }
    else if (m === 'vortex') { P.ang = rnd(0, TAU); P.d = rnd(0.05, 1); P.spd = rnd(0.05, 0.16); }
    else if (m === 'meteor') { P.life = initial ? rnd(0, 1) : 0; P.x0 = rnd(w * 0.2, w * 1.1); P.y0 = rnd(-h * 0.2, h * 0.5); P.spd = rnd(0.5, 1) * (o.long ? 0.6 : 1); P.len = o.long ? rnd(180, 320) : rnd(90, 190); P.wait = rnd(0, 4); }
    else if (m === 'rain') { P.vy = rnd(520, 900) * (o.v || 1) * (0.5 + z * 0.7); P.len = rnd(10, 22) * (0.5 + z * 0.7); P.x = rnd(-40, w + 40); }
    return P;
  }

  function blit(ctx, inst, P, F, sx, sy, extra) {
    const o = inst.e.o, v = F.v, k = P.z * (1 + v * (o.react === undefined ? 0.35 : o.react)), r = P.size * k;
    ctx.save(); ctx.translate(sx === undefined ? P.x : sx, sy === undefined ? P.y : sy);
    ctx.globalAlpha = clamp((o.alpha || 0.92) * (0.5 + P.z * 0.5) * (extra === undefined ? 1 : extra), 0, 1);
    if (inst.e.motion === 'cross' && o.flip && P.dir > 0) ctx.scale(-1, 1);
    if (inst.e.motion === 'cross' && o.wave) ctx.rotate(Math.sin(P.a) * 0.12);
    if (P.rot) ctx.rotate(P.rot);
    const kind = inst.kind;
    if (kind === 'emoji') {
      const s = r * 2.2; let sc = 1; if (o.spin) sc = Math.cos(P.sp) * 0.85 + (Math.cos(P.sp) < 0 ? -0.15 : 0.15);
      ctx.scale(sc, 1); ctx.drawImage(emoji(P.g), -s / 2, -s / 2, s, s);
    } else {
      if ((kind === 'petal' || kind === 'leaf' || kind === 'flake' || kind === 'conf' || kind === 'star' || kind === 'heart') && o.spin) ctx.scale(Math.cos(P.sp) * 0.9 + (Math.cos(P.sp) < 0 ? -0.1 : 0.1), 1);
      const lit = kind === 'spark' || kind === 'soft' || kind === 'ember';
      if (lit && o.pulse) ctx.globalAlpha *= 0.35 + 0.65 * Math.abs(Math.sin(F.t * 1.6 + P.a * 3));
      if (lit) ctx.globalCompositeOperation = 'lighter';
      shape(ctx, kind, r, P.col, P, F);
    }
    ctx.restore();
  }

  const MOTIONS = {
    fall(inst, ctx, F) {
      const dt = F.dt, o = inst.e.o;
      for (const P of inst.ps) {
        P.y += P.vy * (1 + F.v * 1.5) * dt; P.a += P.aw * dt; P.x += (Math.sin(P.a) * P.sway + (P.wind || 0)) * dt; P.sp += P.sv * dt; P.rot += P.rv * dt;
        if (P.y > F.h + P.size * 3 || P.x > F.w + 80) { Object.assign(P, mkParticle(inst, F, false)); }
        blit(ctx, inst, P, F);
      }
    },
    rise(inst, ctx, F) {
      const dt = F.dt, ember = inst.e.shape === 'ember';
      for (const P of inst.ps) {
        P.y += P.vy * (1 + F.v * 1.8) * dt; P.a += P.aw * dt; P.x += Math.sin(P.a) * P.sway * dt; P.sp += P.sv * dt; P.rot += P.rv * dt;
        if (P.y < -P.size * 3) Object.assign(P, mkParticle(inst, F, false));
        blit(ctx, inst, P, F, undefined, undefined, ember ? clamp(P.y / F.h + 0.15, 0, 1) : 1);
      }
    },
    drift(inst, ctx, F) {
      const dt = F.dt;
      for (const P of inst.ps) {
        P.a += P.aw * dt; P.x += (P.vx + Math.cos(P.a) * 8) * dt * (1 + F.v * 1.5); P.y += (P.vy + Math.sin(P.a) * 8) * dt * (1 + F.v * 1.5); P.sp += P.sv * dt; P.rot += P.rv * dt;
        if (P.x < -50) P.x = F.w + 50; if (P.x > F.w + 50) P.x = -50; if (P.y < -50) P.y = F.h + 50; if (P.y > F.h + 50) P.y = -50;
        blit(ctx, inst, P, F);
      }
    },
    cross(inst, ctx, F) {
      const dt = F.dt;
      for (const P of inst.ps) {
        P.x += P.vx * (1 + F.v * 1.3) * dt; P.a += P.aw * dt; const y = P.by + Math.sin(P.a) * P.amp + (inst.e.id === 'bull-stampede' || inst.e.id === 'bull-run' ? Math.abs(Math.sin(P.a * 3)) * -10 : 0);
        if ((P.dir > 0 && P.x > F.w + 120) || (P.dir < 0 && P.x < -120)) { Object.assign(P, mkParticle(inst, F, false)); }
        blit(ctx, inst, P, F, P.x, y);
      }
    },
    orbit(inst, ctx, F) {
      const cx = F.w / 2, cy = F.h / 2, o = inst.e.o, dt = F.dt;
      for (const P of inst.ps) { P.ang += P.w * dt * (1 + F.v * 1.6); P.sp += P.sv * dt; const ex = Math.cos(P.ang) * P.rx, ey = Math.sin(P.ang) * P.ry; P.px = ex * Math.cos(P.tilt) - ey * Math.sin(P.tilt); P.py = ex * Math.sin(P.tilt) + ey * Math.cos(P.tilt); P.zz = 0.7 + 0.5 * Math.sin(P.ang); }
      inst.ps.sort((a, b) => a.zz - b.zz);
      if (o.path) { ctx.save(); ctx.strokeStyle = inst.c[0]; ctx.globalAlpha = 0.07 + F.v * 0.1; ctx.lineWidth = 1; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(cx, cy, F.w * (0.2 + i * 0.1), F.h * (0.12 + i * 0.07), i * 0.7 - 0.8, 0, TAU); ctx.stroke(); } ctx.restore(); }
      for (const P of inst.ps) { const sv = P.z; P.z = P.zz; blit(ctx, inst, P, F, cx + P.px, cy + P.py); P.z = sv; }
    },
    warp(inst, ctx, F) {
      const cx = F.w / 2, cy = F.h / 2, R = Math.hypot(F.w, F.h) * 0.62, dt = F.dt;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (const P of inst.ps) {
        const d0 = P.d; P.d += P.spd * dt * (0.35 + F.v * 2.4 + F.p * 0.8); if (P.d > 1) { P.d = 0; P.ang = rnd(0, TAU); }
        const c = Math.cos(P.ang), s = Math.sin(P.ang), r1 = Math.pow(P.d, 1.7) * R, r0 = Math.pow(Math.max(0, P.d - P.spd * dt * (1 + F.v * 4) * 2.2), 1.7) * R;
        ctx.strokeStyle = P.col; ctx.globalAlpha = clamp(P.d * 1.2, 0, 0.95); ctx.lineWidth = 0.6 + P.d * 2.6;
        ctx.beginPath(); ctx.moveTo(cx + c * r0, cy + s * r0); ctx.lineTo(cx + c * r1, cy + s * r1); ctx.stroke();
      }
      ctx.restore();
    },
    galaxy(inst, ctx, F) {
      const cx = F.w * 0.5, cy = F.h * 0.55, R = Math.min(F.w, F.h) * 0.52, rot = F.t * (0.06 + F.v * 0.12);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const P of inst.ps) {
        const t = P.gt, arm = P.arm, ang = arm * (TAU / 3) + t * 5.2 + rot + P.off, r = t * R; const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r * 0.5;
        ctx.globalAlpha = (0.25 + (1 - t) * 0.6) * (0.7 + F.v * 0.5); const s = (1.2 + (1 - t) * 3 + F.v * 2) * 3; ctx.drawImage(glow(hex6(P.col)), x - s / 2, y - s / 2, s, s);
      }
      ctx.restore();
    },
    vortex(inst, ctx, F) {
      const cx = F.w / 2, cy = F.h / 2, R = Math.min(F.w, F.h) * 0.62, dt = F.dt;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const P of inst.ps) {
        P.d -= P.spd * dt * (0.5 + F.v * 2.5); if (P.d < 0.02) { P.d = 1; P.ang = rnd(0, TAU); }
        P.ang += dt * (0.4 + (1 - P.d) * 3.4) * (1 + F.v); const r = P.d * R, x = cx + Math.cos(P.ang) * r, y = cy + Math.sin(P.ang) * r * 0.62, s = (4 + P.d * 7) * (1 + F.v * 0.6);
        ctx.globalAlpha = clamp(0.2 + (1 - P.d) * 0.8, 0, 1); ctx.drawImage(glow(hex6(P.col)), x - s, y - s, s * 2, s * 2);
      }
      ctx.restore();
    },
    meteor(inst, ctx, F) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (const P of inst.ps) {
        if (P.wait > 0) { P.wait -= F.dt; continue; }
        P.life += F.dt * P.spd * (0.5 + F.v * 1.6); if (P.life > 1) { P.life = 0; P.x0 = rnd(F.w * 0.25, F.w * 1.15); P.y0 = rnd(-F.h * 0.25, F.h * 0.4); P.wait = rnd(0.2, 3); P.col = pick(inst.c); continue; }
        const dx = -0.78, dy = 0.62, dist = F.h * 1.1 * P.life, x = P.x0 + dx * dist, y = P.y0 + dy * dist, g = ctx.createLinearGradient(x, y, x - dx * P.len, y - dy * P.len);
        g.addColorStop(0, P.col); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.globalAlpha = clamp(Math.sin(P.life * Math.PI) * 1.3, 0, 1) * 0.95; ctx.lineWidth = inst.e.o.long ? 5 : 2.4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - dx * P.len, y - dy * P.len); ctx.stroke();
        const s = inst.e.o.long ? 26 : 14; ctx.drawImage(glow(hex6(P.col)), x - s / 2, y - s / 2, s, s);
      }
      ctx.restore();
    },
    twinkle(inst, ctx, F) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const P of inst.ps) { const a = 0.25 + 0.75 * Math.abs(Math.sin(F.t * P.aw + P.a)), s = (2.5 + P.z * 3) * (1 + F.v * 1.8); ctx.globalAlpha = clamp(a * (0.6 + F.v * 0.6), 0, 1); ctx.drawImage(glow(hex6(P.col)), P.x - s, P.y - s, s * 2, s * 2); }
      ctx.restore();
    },
    rain(inst, ctx, F) {
      const dt = F.dt, wind = 40 + F.v * 60; ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = inst.c[0];
      for (const P of inst.ps) {
        P.y += P.vy * dt * (1 + F.v * 0.7); P.x += wind * dt * P.z;
        if (P.y > F.h + 30) { if (Math.random() < 0.15 && inst.splash.length < 40) inst.splash.push({ x: P.x, y: F.h - rnd(2, 40), r: 1, a: 0.5 }); P.y = -P.len - rnd(0, F.h * 0.2); P.x = rnd(-40, F.w + 40); }
        ctx.globalAlpha = 0.18 + P.z * 0.32; ctx.lineWidth = 0.7 + P.z * 1.1; ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(P.x - wind * 0.045 * P.z, P.y - P.len * (1 + F.v * 0.8)); ctx.stroke();
      }
      ctx.lineWidth = 1;
      for (let i = inst.splash.length - 1; i >= 0; i--) { const s = inst.splash[i]; s.r += 40 * dt; s.a -= 1.3 * dt; if (s.a <= 0) { inst.splash.splice(i, 1); continue; } ctx.globalAlpha = s.a * 0.6; ctx.beginPath(); ctx.ellipse(s.x, s.y, s.r, s.r * 0.35, 0, 0, TAU); ctx.stroke(); }
      ctx.restore();
    },
    matrix(inst, ctx, F) {
      const fs = inst.e.o.size || 16, chars = inst.e.o.chars || '01', cols = Math.ceil(F.w / fs); const trail = F.mobile ? 8 : 12;
      if (!inst.cols || inst.cols.length !== cols) { inst.cols = []; for (let i = 0; i < cols; i++) inst.cols.push({ y: rnd(-F.h, 0) / fs, sp: rnd(6, 18) }); }
      ctx.save(); ctx.font = fs + 'px ui-monospace,monospace'; ctx.textAlign = 'center'; const seedT = Math.floor(F.t * 6);
      for (let i = 0; i < cols; i++) {
        const c = inst.cols[i]; c.y += c.sp * F.dt * (0.7 + F.v * 2); if (c.y * fs > F.h + trail * fs) { c.y = rnd(-20, 0); c.sp = rnd(6, 18); }
        for (let k = 0; k < trail; k++) {
          const yy = (c.y - k) * fs; if (yy < 0 || yy > F.h) continue; const ch = chars.charAt(((i * 7 + k * 13 + seedT * (k === 0 ? 3 : 1)) >>> 0) % chars.length);
          ctx.globalAlpha = k === 0 ? 0.95 : clamp(0.55 - k * 0.045, 0.04, 0.55) * (0.7 + F.v * 0.6); ctx.fillStyle = k === 0 ? inst.c[1] || '#fff' : inst.c[0]; ctx.fillText(ch, i * fs + fs / 2, yy);
        }
      }
      ctx.restore();
    },
    rings(inst, ctx, F) {
      const o = inst.e.o, cx = F.w / 2, cy = o.sweep ? F.h * 0.8 : F.h / 2, maxR = Math.min(F.w, F.h) * (o.sweep ? 0.95 : 0.7);
      inst.timer = (inst.timer || 0) + F.dt; if (F.beat || inst.timer > 1.6) { inst.timer = 0; inst.rs.push({ r: 0, col: pick(inst.c), a: 1 }); if (inst.rs.length > 8) inst.rs.shift(); }
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 2.5;
      for (let i = inst.rs.length - 1; i >= 0; i--) {
        const q = inst.rs[i]; q.r += (maxR * 0.55 + F.v * 220) * F.dt; q.a = 1 - q.r / maxR; if (q.a <= 0) { inst.rs.splice(i, 1); continue; }
        ctx.strokeStyle = q.col; ctx.globalAlpha = q.a * 0.75; ctx.beginPath();
        if (o.square) ctx.rect(cx - q.r, cy - q.r * 0.6, q.r * 2, q.r * 1.2); else ctx.ellipse(cx, cy, q.r, o.sweep ? q.r : q.r * 0.7, 0, o.sweep ? Math.PI : 0, o.sweep ? TAU : TAU); ctx.stroke();
      }
      if (o.sweep) { const ang = Math.PI + ((F.t * 0.9) % Math.PI); ctx.globalAlpha = 0.55; const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR); g.addColorStop(0, inst.c[0]); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR); ctx.stroke(); }
      ctx.restore();
    },
    waves(inst, ctx, F) {
      const L = inst.e.o.layers || 4; ctx.save();
      for (let k = 0; k < L; k++) {
        const base = F.h * (0.62 + k * 0.075), amp = (14 + k * 7) * (1 + F.v * 1.7), f = 0.006 - k * 0.0006, sp = 0.8 + k * 0.3, col = inst.c[k % inst.c.length];
        ctx.beginPath(); ctx.moveTo(0, F.h);
        for (let x = 0; x <= F.w; x += 10) ctx.lineTo(x, base + Math.sin(x * f + F.t * sp + k) * amp + Math.sin(x * f * 2.3 - F.t * sp * 0.7) * amp * 0.4);
        ctx.lineTo(F.w, F.h); ctx.closePath(); const g = ctx.createLinearGradient(0, base - amp, 0, F.h); g.addColorStop(0, col + '88'); g.addColorStop(1, col + '14');
        ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.restore();
    },
    blobs(inst, ctx, F) {
      const o = inst.e.o; ctx.save(); ctx.globalCompositeOperation = o.hue || o.moon ? 'lighter' : 'source-over';
      for (const P of inst.ps) {
        P.a += F.dt * 0.15; P.x += Math.cos(P.a) * 14 * F.dt; P.y += Math.sin(P.a * 0.8) * 9 * F.dt;
        const r = P.size * (1 + F.v * 0.35), col = o.hue ? 'hsl(' + ((F.t * 30 + P.a * 60) % 360) + ',90%,60%)' : P.col, a = (o.a || 0.12) * (0.75 + F.v * 0.9);
        const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, r); const c0 = o.hue ? col.replace('hsl', 'hsla').replace(')', ',' + a + ')') : col; if (o.hue) { g.addColorStop(0, c0); g.addColorStop(1, col.replace('hsl', 'hsla').replace(')', ',0)')); } else { g.addColorStop(0, col); g.addColorStop(1, col + '00'); }
        ctx.globalAlpha = o.hue ? 1 : a * 3.2; ctx.fillStyle = g; ctx.fillRect(P.x - r, P.y - r, r * 2, r * 2);
      }
      if (o.moon) { const mx = F.w * 0.82, my = F.h * 0.18, r = Math.min(F.w, F.h) * 0.07 * (1 + F.v * 0.12); ctx.globalAlpha = 0.9; const g = ctx.createRadialGradient(mx - r * 0.3, my - r * 0.3, r * 0.1, mx, my, r); g.addColorStop(0, '#fffde8'); g.addColorStop(1, '#d8d6b0'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mx, my, r, 0, TAU); ctx.fill(); ctx.drawImage(glow('#f4eec0'), mx - r * 3, my - r * 3, r * 6, r * 6); }
      ctx.restore();
    },
    smoke(inst, ctx, F) {
      ctx.save();
      for (const P of inst.ps) {
        P.y -= (20 + P.z * 26) * F.dt * (1 + F.v * 2); P.x += Math.sin(P.a += F.dt * 0.4) * 16 * F.dt; P.size += 14 * F.dt; if (P.y < -P.size) { P.y = F.h + P.size * 0.5; P.size = rnd(60, 130); P.x = rnd(0, F.w); }
        const r = P.size, a = clamp((P.y / F.h) * 0.9, 0, 1) * (inst.e.o.a || 0.12) * (1 + F.v * 1.2), g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, r); g.addColorStop(0, P.col); g.addColorStop(1, P.col + '00');
        ctx.globalAlpha = clamp(a * 3.4, 0, 0.6); ctx.fillStyle = g; ctx.fillRect(P.x - r, P.y - r, r * 2, r * 2);
      }
      ctx.restore();
    },
    bokeh(inst, ctx, F) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const P of inst.ps) {
        P.a += F.dt * 0.3; P.x += Math.cos(P.a) * 10 * F.dt; P.y += Math.sin(P.a * 0.7) * 8 * F.dt; const r = P.size * (1 + F.v * 0.4), a = 0.1 + 0.12 * Math.abs(Math.sin(F.t * 0.6 + P.aw * 3)) + F.v * 0.1;
        const col = 'hsla(' + ((P.aw * 80 + F.t * 8) % 360) + ',90%,66%,'; const g = ctx.createRadialGradient(P.x, P.y, r * 0.6, P.x, P.y, r); g.addColorStop(0, col + a * 0.5 + ')'); g.addColorStop(0.9, col + a + ')'); g.addColorStop(1, col + '0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(P.x, P.y, r, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },
    ribbons(inst, ctx, F) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const col = inst.c[k % inst.c.length], ph = k * 2.1, base = F.h * (0.22 + k * 0.13), amp = F.h * (0.08 + F.v * 0.08), bh = F.h * 0.22 * (1 + F.v * 0.5);
        ctx.beginPath(); for (let x = 0; x <= F.w; x += 14) { const y = base + Math.sin(x * 0.004 + F.t * 0.5 + ph) * amp + Math.sin(x * 0.011 - F.t * 0.8 + ph) * amp * 0.35; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        for (let x = F.w; x >= 0; x -= 14) { const y = base + bh + Math.sin(x * 0.004 + F.t * 0.5 + ph + 0.7) * amp * 1.1; ctx.lineTo(x, y); }
        ctx.closePath(); const g = ctx.createLinearGradient(0, base - amp, 0, base + bh + amp); g.addColorStop(0, col + '00'); g.addColorStop(0.45, col + '55'); g.addColorStop(1, col + '00'); ctx.fillStyle = g; ctx.globalAlpha = 0.65 + F.v * 0.35; ctx.fill();
      }
      ctx.restore();
    },
    shafts(inst, ctx, F) {
      const o = inst.e.o, left = (o.ox === undefined ? 0.15 : o.ox) < 0.5, ox = F.w * (o.ox === undefined ? 0.15 : o.ox), oy = -F.h * 0.1, n = o.n || 8, col = hex6(inst.c[0]), len = Math.hypot(F.w, F.h) * 1.35, base = left ? 1.0 : Math.PI - 1.0;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.1 * (o.spread || 1) * (left ? 1 : -1) + Math.sin(F.t * 0.18 + i * 1.3) * 0.035, wd = 0.026 + (i % 3) * 0.02, g = ctx.createLinearGradient(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len);
        g.addColorStop(0, col + 'dd'); g.addColorStop(0.55, col + '44'); g.addColorStop(1, col + '00'); ctx.fillStyle = g; ctx.globalAlpha = (0.06 + (i % 2) * 0.03) * (1 + F.v * 1.3) * (0.8 + 0.2 * Math.sin(F.t * 0.7 + i));
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(a - wd) * len, oy + Math.sin(a - wd) * len); ctx.lineTo(ox + Math.cos(a + wd) * len, oy + Math.sin(a + wd) * len); ctx.closePath(); ctx.fill();
      }
      const R = Math.min(F.w, F.h) * (0.5 + F.v * 0.15); ctx.globalAlpha = 0.5; ctx.drawImage(glow(col), ox - R, oy - R, R * 2, R * 2); ctx.restore();
    },
    searchlights(inst, ctx, F) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; const col = hex6(inst.c[0]), len = F.h * 1.5;
      for (let i = 0; i < 3; i++) {
        const bx = F.w * (0.2 + i * 0.3), a = -Math.PI / 2 + Math.sin(F.t * (0.45 + i * 0.12) * (1 + F.v * 0.8) + i * 2.1) * 0.62, wd = 0.045 + F.v * 0.03, g = ctx.createLinearGradient(bx, F.h, bx + Math.cos(a) * len, F.h + Math.sin(a) * len);
        g.addColorStop(0, col + 'ee'); g.addColorStop(0.6, col + '30'); g.addColorStop(1, col + '00'); ctx.fillStyle = g; ctx.globalAlpha = 0.2 + F.v * 0.25;
        ctx.beginPath(); ctx.moveTo(bx, F.h); ctx.lineTo(bx + Math.cos(a - wd) * len, F.h + Math.sin(a - wd) * len); ctx.lineTo(bx + Math.cos(a + wd) * len, F.h + Math.sin(a + wd) * len); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.55; ctx.drawImage(glow(col), bx - 60, F.h - 40, 120, 80);
      }
      ctx.restore();
    },
    stagewash(inst, ctx, F) {
      inst.bc = (inst.bc || 0) + (F.beat ? 1 : 0); ctx.save(); ctx.globalCompositeOperation = 'lighter'; const len = F.h * 1.25;
      for (let i = 0; i < 4; i++) {
        const ox = F.w * (0.14 + i * 0.24), a = Math.PI / 2 + Math.sin(F.t * 0.7 + i * 1.4) * 0.55 * (1 + F.v * 0.5), col = hex6(inst.c[(i + inst.bc) % inst.c.length]), wd = 0.1, g = ctx.createLinearGradient(ox, 0, ox + Math.cos(a) * len, Math.sin(a) * len);
        g.addColorStop(0, col + 'dd'); g.addColorStop(0.7, col + '38'); g.addColorStop(1, col + '00'); ctx.fillStyle = g; ctx.globalAlpha = 0.24 + F.v * 0.3;
        ctx.beginPath(); ctx.moveTo(ox, -6); ctx.lineTo(ox + Math.cos(a - wd) * len, Math.sin(a - wd) * len); ctx.lineTo(ox + Math.cos(a + wd) * len, Math.sin(a + wd) * len); ctx.closePath(); ctx.fill();
        const fx = ox + Math.cos(a) * (F.h / Math.sin(a)); ctx.globalAlpha = 0.5 + F.v * 0.3; ctx.drawImage(glow(col), fx - F.w * 0.12, F.h - F.h * 0.06, F.w * 0.24, F.h * 0.12); ctx.globalAlpha = 0.9; ctx.drawImage(glow('#ffffff'), ox - 14, -10, 28, 28);
      }
      ctx.restore();
    },
    discoball(inst, ctx, F) {
      const r = Math.min(F.w, F.h) * 0.085 * (1 + F.v * 0.07), cx = F.w / 2, cy = F.h * 0.11; ctx.save();
      ctx.strokeStyle = 'rgba(200,200,210,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, cy - r); ctx.stroke();
      const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r); g.addColorStop(0, '#f4f4fa'); g.addColorStop(0.5, '#8a8a96'); g.addColorStop(1, '#2a2a34'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      for (let k = 0; k < 70; k++) { const lat = Math.asin(((k * 0.6180339) % 1) * 2 - 1), lon = k * 2.399963 + F.t * 0.8, nz = Math.cos(lat) * Math.cos(lon); if (nz < 0.05) continue; const x = cx + Math.cos(lat) * Math.sin(lon) * r, y = cy + Math.sin(lat) * r, b = 0.35 + 0.65 * Math.abs(Math.sin(F.t * 2 + k)); ctx.globalAlpha = b * nz; ctx.fillStyle = '#ffffff'; ctx.fillRect(x - r * 0.05, y - r * 0.05, r * 0.1, r * 0.1); }
      ctx.globalCompositeOperation = 'lighter'; const n = F.mobile ? 22 : 38;
      for (let i = 0; i < n; i++) { const lon = i * 0.37 + F.t * 0.35, lat = (i % 6) / 6, x = F.w / 2 + Math.sin(lon) * F.w * 0.56, y = F.h * 0.16 + lat * F.h * 0.78 + Math.sin(F.t * 0.6 + i) * 10, s = (16 + (i % 4) * 5) * (1 + F.v * 1.1); ctx.globalAlpha = (0.35 + 0.4 * Math.abs(Math.cos(lon))) * (0.7 + F.v * 0.5); ctx.drawImage(glow(hex6(inst.c[i % inst.c.length])), x - s, y - s, s * 2, s * 2); }
      ctx.restore();
    },
    lasers(inst, ctx, F) {
      inst.bc = (inst.bc || 0) + (F.beat ? 1 : 0); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; const len = Math.hypot(F.w, F.h) * 1.2;
      for (const side of [0.18, 0.82]) for (let i = 0; i < 7; i++) {
        const a = Math.PI / 2 + (i - 3) * 0.2 + Math.sin(F.t * (0.7 + i * 0.08) + inst.bc * 0.4) * 0.35, col = inst.c[(i + inst.bc) % inst.c.length], ox = F.w * side;
        ctx.strokeStyle = col; ctx.globalAlpha = 0.16 + F.v * 0.2; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox + Math.cos(a) * len, Math.sin(a) * len); ctx.stroke();
        ctx.globalAlpha = 0.6 + F.v * 0.4; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox + Math.cos(a) * len, Math.sin(a) * len); ctx.stroke();
      }
      ctx.restore();
    },
    strobe(inst, ctx, F) {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      inst.cool = (inst.cool || 0) - F.dt; if (F.beat && inst.cool <= 0) { inst.fl = 0.22; inst.cool = 0.4; }
      if ((inst.fl || 0) > 0.01) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = inst.fl; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, F.w, F.h); ctx.restore(); inst.fl *= Math.pow(0.0008, F.dt); }
    },
    lensflare(inst, ctx, F) {
      const sx = F.w * (0.8 + 0.07 * Math.sin(F.t * 0.12)), sy = F.h * (0.12 + 0.03 * Math.sin(F.t * 0.17)), R = Math.min(F.w, F.h) * (0.32 + F.v * 0.1), col = hex6(inst.c[0]); ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85; ctx.drawImage(glow(col), sx - R, sy - R, R * 2, R * 2); ctx.globalAlpha = 1; ctx.drawImage(glow('#ffffff'), sx - R * 0.25, sy - R * 0.25, R * 0.5, R * 0.5);
      const sg = ctx.createLinearGradient(sx - F.w * 0.5, sy, sx + F.w * 0.5, sy); sg.addColorStop(0, col + '00'); sg.addColorStop(0.5, col + 'bb'); sg.addColorStop(1, col + '00'); ctx.fillStyle = sg; ctx.globalAlpha = 0.45 + F.v * 0.3; ctx.fillRect(sx - F.w * 0.5, sy - 2.5, F.w, 5);
      const cx = F.w / 2, cy = F.h / 2, hues = ['#ff9a5a', '#5aff9a', '#5a9aff', '#ff5ad0', '#ffe05a'];
      for (let k = 0; k < 5; k++) { const t = 0.35 + k * 0.28, x = sx + (cx - sx) * t * 1.6, y = sy + (cy - sy) * t * 1.6, rr = (18 + k * 14) * (1 + F.v * 0.3); ctx.globalAlpha = 0.2; ctx.strokeStyle = hues[k]; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke(); ctx.globalAlpha = 0.07; ctx.fillStyle = hues[k]; ctx.fill(); }
      ctx.restore();
    },
    firelight(inst, ctx, F) {
      const small = inst.e.o.small, fl = 0.72 + 0.28 * (Math.sin(F.t * 13) * 0.5 + Math.sin(F.t * 7.3 + 1) * 0.3 + Math.sin(F.t * 23.1) * 0.2) + F.v * 0.45, cx = F.w * (small ? 0.1 : 0.5) + Math.sin(F.t * 3.1) * F.w * 0.012, cy = F.h * 1.04, R = F.h * (small ? 0.55 : 0.95) * (0.9 + F.v * 0.15), col = hex6(inst.c[0]);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, col + 'aa'); g.addColorStop(0.45, col + '33'); g.addColorStop(1, col + '00'); ctx.globalAlpha = clamp(0.5 * fl, 0, 0.85); ctx.fillStyle = g; ctx.fillRect(0, 0, F.w, F.h);
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.4); g.addColorStop(0, '#ffe8a0cc'); g.addColorStop(1, '#ffe8a000'); ctx.globalAlpha = clamp(0.4 * fl, 0, 0.7); ctx.fillStyle = g; ctx.fillRect(0, 0, F.w, F.h); ctx.restore();
    },
    neonflicker(inst, ctx, F) {
      inst.ft = (inst.ft || 0) - F.dt; if (inst.ft <= 0 && Math.random() < 0.02) inst.ft = rnd(0.08, 0.25); const dim = inst.ft > 0 ? (Math.random() < 0.5 ? 0.25 : 0.7) : 1;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; const hh = F.h * 0.3;
      let g = ctx.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, hex6(inst.c[0]) + 'aa'); g.addColorStop(1, hex6(inst.c[0]) + '00'); ctx.fillStyle = g; ctx.globalAlpha = clamp((0.32 + F.v * 0.4) * dim, 0, 0.8); ctx.fillRect(0, 0, F.w, hh);
      g = ctx.createLinearGradient(0, F.h, 0, F.h - hh); g.addColorStop(0, hex6(inst.c[1] || inst.c[0]) + 'aa'); g.addColorStop(1, hex6(inst.c[1] || inst.c[0]) + '00'); ctx.fillStyle = g; ctx.globalAlpha = clamp((0.32 + F.v * 0.4) * dim, 0, 0.8); ctx.fillRect(0, F.h - hh, F.w, hh);
      ctx.restore();
    },
    police(inst, ctx, F) {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const ph = Math.sin(F.t * 7 * (1 + F.v * 0.2)), ctxA = ctx; ctxA.save(); ctxA.globalCompositeOperation = 'lighter';
      for (const side of [0, 1]) { const on = side ? clamp(-ph, 0, 1) : clamp(ph, 0, 1), col = hex6(inst.c[side]), x0 = side ? F.w : 0, g = ctxA.createLinearGradient(x0, 0, side ? F.w * 0.45 : F.w * 0.55, 0); g.addColorStop(0, col + 'cc'); g.addColorStop(1, col + '00'); ctxA.fillStyle = g; ctxA.globalAlpha = on * (0.3 + F.v * 0.25); ctxA.fillRect(0, 0, F.w, F.h); }
      ctxA.restore();
    },
    caustics(inst, ctx, F) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = hex6(inst.c[0]); ctx.lineWidth = 3; const n = F.mobile ? 16 : 26, amp = 1 + F.v * 1.4;
      for (let i = 0; i < n; i++) { ctx.globalAlpha = 0.05 + F.v * 0.04; ctx.beginPath(); for (let x = 0; x <= F.w; x += 16) { const y = F.h * (i / n) * 1.1 + Math.sin(x * 0.012 + F.t * 0.9 + i) * 18 * amp + Math.sin(x * 0.027 - F.t * 1.2 + i * 2) * 10 * amp; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); }
      for (let j = 0; j < n * 0.8; j++) { ctx.globalAlpha = 0.045 + F.v * 0.04; ctx.beginPath(); for (let y = 0; y <= F.h; y += 16) { const x = F.w * (j / (n * 0.8)) * 1.1 + Math.sin(y * 0.013 - F.t * 0.8 + j) * 20 * amp + Math.sin(y * 0.03 + F.t * 1.1 + j * 2) * 9 * amp; if (y) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); }
      ctx.restore();
    },
    lightleak(inst, ctx, F) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; const R = F.h * 0.75 * (1 + F.v * 0.25), spots = [[0.05, 0.25 + Math.sin(F.t * 0.2) * 0.1], [0.95, 0.8 + Math.sin(F.t * 0.17) * 0.08], [0.5 + Math.sin(F.t * 0.13) * 0.15, -0.1]];
      for (let i = 0; i < 3; i++) { const x = F.w * spots[i][0], y = F.h * spots[i][1], c = hex6(inst.c[i % inst.c.length]), g = ctx.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, c + 'cc'); g.addColorStop(0.5, c + '44'); g.addColorStop(1, c + '00'); ctx.globalAlpha = 0.28 + F.v * 0.25; ctx.fillStyle = g; ctx.fillRect(x - R, y - R, R * 2, R * 2); }
      ctx.restore();
    },
    headlights(inst, ctx, F) {
      inst.wait = (inst.wait === undefined ? 1 : inst.wait) - F.dt; if (inst.wait <= 0 && !inst.car) { inst.car = { x: F.w + 120, y: F.h * rnd(0.74, 0.88), sp: rnd(280, 430) }; inst.wait = rnd(5, 11); }
      const car = inst.car; if (!car) return; car.x -= car.sp * F.dt * (1 + F.v * 0.8); if (car.x < -F.w * 0.7) { inst.car = null; return; }
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; const len = F.w * 0.7;
      for (const dy of [-16, 16]) { const g = ctx.createLinearGradient(car.x, car.y + dy, car.x - len, car.y + dy * 2.2); g.addColorStop(0, '#fff6d0cc'); g.addColorStop(1, '#fff6d000'); ctx.fillStyle = g; ctx.globalAlpha = 0.34 + F.v * 0.2; ctx.beginPath(); ctx.moveTo(car.x, car.y + dy); ctx.lineTo(car.x - len, car.y + dy * 2.2 - 90); ctx.lineTo(car.x - len, car.y + dy * 2.2 + 90); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 0.9; ctx.drawImage(glow('#fff6d0'), car.x - 38, car.y + dy - 38, 76, 76); }
      ctx.restore();
    },
    sunset(inst, ctx, F) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; const c0 = hex6(inst.c[0]), c1 = hex6(inst.c[1] || inst.c[0]);
      let g = ctx.createLinearGradient(0, F.h, 0, F.h * 0.4); g.addColorStop(0, c0 + 'bb'); g.addColorStop(0.5, c1 + '44'); g.addColorStop(1, c1 + '00'); ctx.globalAlpha = 0.55 + F.v * 0.25; ctx.fillStyle = g; ctx.fillRect(0, F.h * 0.4, F.w, F.h * 0.6);
      const r = F.h * 0.16 * (1 + F.v * 0.08), cx = F.w * 0.5, cy = F.h * 1.0; ctx.globalAlpha = 0.9; ctx.drawImage(glow(c1), cx - r * 3, cy - r * 3, r * 6, r * 6); ctx.fillStyle = '#fff0c0'; ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, TAU); ctx.fill();
      ctx.globalAlpha = 0.12; ctx.fillStyle = c1; for (let k = 0; k < 5; k++) ctx.fillRect(0, F.h * (0.62 + k * 0.07) + Math.sin(F.t * 0.4 + k) * 4, F.w, 2 + k);
      ctx.restore();
    },
    beams(inst, ctx, F) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; const ox = F.w * 0.14, oy = -F.h * 0.08;
      for (let i = 0; i < 7; i++) {
        const a = 0.55 + i * 0.13 + Math.sin(F.t * 0.25 + i) * 0.04, len = Math.hypot(F.w, F.h) * 1.3, w2 = 0.05 + (i % 3) * 0.025, g = ctx.createLinearGradient(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len);
        g.addColorStop(0, inst.c[0] + 'cc'); g.addColorStop(1, inst.c[0] + '00'); ctx.fillStyle = g; ctx.globalAlpha = 0.1 + F.v * 0.12;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(a - w2) * len, oy + Math.sin(a - w2) * len); ctx.lineTo(ox + Math.cos(a + w2) * len, oy + Math.sin(a + w2) * len); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    },
    bolt(inst, ctx, F) {
      inst.timer = (inst.timer || 0) - F.dt;
      if (F.beat || inst.timer <= 0) {
        if (F.beat || Math.random() < 0.5) { inst.timer = rnd(1.8, 5); const pts = []; let x = rnd(F.w * 0.1, F.w * 0.9), y = 0; pts.push([x, y]); while (y < F.h * rnd(0.55, 0.95)) { y += rnd(24, 60); x += rnd(-48, 48); pts.push([x, y]); } inst.bolts.push({ pts: pts, a: 1, br: Math.random() < 0.6 ? pts.slice(Math.floor(pts.length / 2)).map((p, i) => [p[0] + i * rnd(10, 26), p[1] + i * rnd(8, 18)]) : null }); inst.flash = 0.35; }
        else inst.timer = rnd(0.5, 2);
      }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (inst.flash > 0.01) { ctx.globalAlpha = inst.flash; ctx.fillStyle = '#cfe0ff'; ctx.fillRect(0, 0, F.w, F.h); inst.flash *= Math.pow(0.002, F.dt); }
      for (let i = inst.bolts.length - 1; i >= 0; i--) {
        const b = inst.bolts[i]; b.a -= F.dt * 3.2; if (b.a <= 0) { inst.bolts.splice(i, 1); continue; }
        for (const path of [b.pts, b.br]) { if (!path) continue; ctx.strokeStyle = '#eaf4ff'; ctx.shadowColor = '#7fb8ff'; ctx.shadowBlur = 22; ctx.lineWidth = path === b.pts ? 3 : 1.6; ctx.globalAlpha = b.a; ctx.beginPath(); path.forEach((p, k) => { if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.stroke(); }
      }
      ctx.restore();
    },
    glitch(inst, ctx, F) {
      inst.timer = (inst.timer || 0) - F.dt; if (F.beat || inst.timer <= 0) { inst.on = rnd(0.08, 0.22); inst.timer = rnd(0.5, 2.5); inst.seed = Math.random(); }
      if ((inst.on || 0) > 0) {
        inst.on -= F.dt; ctx.save(); const o = inst.e.o, n = 7 + Math.floor(F.v * 8);
        for (let i = 0; i < n; i++) {
          const y = rnd(0, F.h), h = rnd(3, o.blocks ? 46 : 22), x = o.blocks ? rnd(0, F.w) : 0, w = o.blocks ? rnd(30, 200) : F.w; ctx.globalAlpha = rnd(0.15, 0.4); ctx.fillStyle = pick(inst.c); ctx.fillRect(x + rnd(-10, 10), y, w, h);
          if (!o.blocks) { ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffffff'; ctx.fillRect(rnd(-30, 30), y + h, w, 1.5); }
        }
        ctx.restore();
      }
    },
    floorgrid(inst, ctx, F) {
      const hz = F.h * 0.62, cx = F.w / 2; ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1.4;
      const g = ctx.createLinearGradient(0, hz, 0, F.h); g.addColorStop(0, inst.c[0] + '00'); g.addColorStop(1, inst.c[0] + '55'); ctx.fillStyle = g; ctx.fillRect(0, hz, F.w, F.h - hz);
      ctx.strokeStyle = inst.c[1] || inst.c[0]; ctx.globalAlpha = 0.5 + F.v * 0.4;
      for (let i = -14; i <= 14; i++) { ctx.beginPath(); ctx.moveTo(cx + i * 14, hz); ctx.lineTo(cx + i * F.w * 0.14, F.h); ctx.stroke(); }
      inst.off = ((inst.off || 0) + F.dt * (0.35 + F.v * 1.6)) % 1;
      for (let i = 0; i < 12; i++) { const t = (i + inst.off) / 12, y = hz + Math.pow(t, 2.2) * (F.h - hz); ctx.globalAlpha = (0.15 + t * 0.6) * (0.7 + F.v * 0.5); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(F.w, y); ctx.stroke(); }
      ctx.restore();
    },
    flatgrid(inst, ctx, F) {
      const step = 52 + F.v * 8, off = (F.t * 22) % step; ctx.save(); ctx.strokeStyle = inst.c[0]; ctx.globalAlpha = 0.1 + F.v * 0.35; ctx.lineWidth = 1;
      for (let x = -step; x < F.w + step; x += step) { ctx.beginPath(); ctx.moveTo(x + off, 0); ctx.lineTo(x + off, F.h); ctx.stroke(); }
      for (let y = -step; y < F.h + step; y += step) { ctx.beginPath(); ctx.moveTo(0, y + off); ctx.lineTo(F.w, y + off); ctx.stroke(); }
      ctx.restore();
    },
    sinefield(inst, ctx, F) {
      ctx.save(); ctx.lineWidth = 1.6; for (let k = 0; k < 14; k++) {
        ctx.strokeStyle = inst.c[k % inst.c.length]; ctx.globalAlpha = 0.14 + k * 0.012 + F.v * 0.2; ctx.beginPath(); const by = F.h * (0.18 + k * 0.055);
        for (let x = 0; x <= F.w; x += 12) { const y = by + Math.sin(x * 0.01 + F.t * (0.8 + k * 0.06) + k * 0.5) * (14 + F.v * 40) * (0.4 + k * 0.08); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.restore();
    },
    dna(inst, ctx, F) {
      const cx = F.w * 0.93, n = 34, top = F.h * 0.08, sp = (F.h * 0.84) / n, amp = 34 + F.v * 20; ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const a = i * 0.42 + F.t * 1.4, y = top + i * sp, x1 = cx + Math.sin(a) * amp, x2 = cx - Math.sin(a) * amp, z1 = 0.7 + 0.5 * Math.cos(a), z2 = 0.7 - 0.5 * Math.cos(a);
        ctx.globalAlpha = 0.35; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
        ctx.globalAlpha = 0.95; let s = 12 * z1; ctx.drawImage(glow(hex6(inst.c[0])), x1 - s, y - s, s * 2, s * 2); s = 12 * z2; ctx.drawImage(glow(hex6(inst.c[1] || inst.c[0])), x2 - s, y - s, s * 2, s * 2);
      }
      ctx.restore();
    },
    anemone(inst, ctx, F) {
      ctx.save(); ctx.lineCap = 'round'; const n = 18;
      for (let i = 0; i < n; i++) {
        const bx = (i + 0.5) * F.w / n, len = F.h * (0.14 + 0.1 * Math.sin(i * 1.9) ** 2) * (1 + F.v * 0.5), sw = Math.sin(F.t * 1.2 + i * 0.7) * (30 + F.v * 40), col = inst.c[i % inst.c.length];
        ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(bx, F.h); ctx.quadraticCurveTo(bx + sw * 0.4, F.h - len * 0.6, bx + sw, F.h - len); ctx.stroke();
        ctx.globalAlpha = 0.9; ctx.globalCompositeOperation = 'lighter'; const s = 18; ctx.drawImage(glow(hex6(col)), bx + sw - s / 2, F.h - len - s / 2, s, s); ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    },
    vinyl(inst, ctx, F) {
      const r = Math.min(F.w, F.h) * 0.17 * (1 + F.v * 0.06), cx = F.w * 0.88, cy = F.h * 0.82; inst.rot = (inst.rot || 0) + F.dt * (1.6 + F.v * 3); ctx.save(); ctx.translate(cx, cy); ctx.rotate(inst.rot); ctx.globalAlpha = 0.6;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, '#222'); g.addColorStop(1, '#050505'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1; for (let k = 1; k < 9; k++) { ctx.beginPath(); ctx.arc(0, 0, r * (0.3 + k * 0.08), 0, TAU); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, -0.3, 0.3); ctx.closePath(); ctx.fill(); ctx.fillStyle = inst.c[0]; ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, TAU); ctx.fill(); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, r * 0.04, 0, TAU); ctx.fill();
      ctx.restore();
    },
    eyes(inst, ctx, F) {
      inst.timer = (inst.timer || 0) - F.dt; if (inst.timer <= 0 && inst.es.length < 7) { inst.timer = rnd(0.6, 1.6) / (1 + F.v); inst.es.push({ x: rnd(F.w * 0.06, F.w * 0.94), y: rnd(F.h * 0.1, F.h * 0.9), age: 0, life: rnd(2.2, 3.8), s: rnd(26, 50) }); }
      ctx.save();
      for (let i = inst.es.length - 1; i >= 0; i--) { const e = inst.es[i]; e.age += F.dt; if (e.age > e.life) { inst.es.splice(i, 1); continue; } const k = e.age / e.life, a = Math.sin(k * Math.PI), blink = Math.abs(Math.sin(e.age * 3.1)) > 0.97 ? 0.2 : 1, s = e.s * (1 + F.v * 0.25); ctx.globalAlpha = a * 0.95; ctx.save(); ctx.translate(e.x, e.y); ctx.scale(1, blink); ctx.drawImage(emoji('👀'), -s, -s, s * 2, s * 2); ctx.restore(); }
      ctx.restore();
    },
    heartbeat(inst, ctx, F) {
      inst.k = (inst.k || 1) + ((1 + F.v * 0.55) - (inst.k || 1)) * Math.min(1, F.dt * 14); const r = Math.min(F.w, F.h) * 0.2 * inst.k, cx = F.w / 2, cy = F.h * 0.46;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.2 + F.v * 0.3; ctx.translate(cx, cy); shape(ctx, 'heart', r, '#ff3a5a', { sp: 0 }, F); ctx.globalAlpha = 0.5; ctx.drawImage(glow('#ff3a5a'), -r * 2, -r * 2, r * 4, r * 4); ctx.restore();
    },
    orbitrings(inst, ctx, F) {
      const cx = F.w / 2, cy = F.h / 2; ctx.save(); ctx.lineWidth = 1.4;
      for (let i = 0; i < 5; i++) {
        const rx = F.w * (0.14 + i * 0.075) * (1 + F.v * 0.06), ry = rx * (0.28 + i * 0.05), tilt = F.t * (0.05 + i * 0.015) * (i % 2 ? -1 : 1) + i * 0.6, col = inst.c[i % inst.c.length];
        ctx.strokeStyle = col; ctx.globalAlpha = 0.28 + F.v * 0.3; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, tilt, 0, TAU); ctx.stroke();
        const a = F.t * (0.9 - i * 0.12) + i * 1.7, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry, px = cx + ex * Math.cos(tilt) - ey * Math.sin(tilt), py = cy + ex * Math.sin(tilt) + ey * Math.cos(tilt), z = 0.8 + 0.4 * Math.sin(a), s = (14 + i * 3) * z * (1 + F.v * 0.4);
        ctx.globalAlpha = 0.95; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(glow(hex6(col)), px - s, py - s, s * 2, s * 2); ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    },
    firework(inst, ctx, F) {
      inst.timer = (inst.timer || 0) - F.dt; if (F.beat || inst.timer <= 0) { inst.timer = rnd(0.9, 2) / (1 + F.v); if (inst.rk.length < 5) inst.rk.push({ x: rnd(F.w * 0.12, F.w * 0.88), y: F.h + 10, vy: -rnd(420, 640), top: rnd(F.h * 0.14, F.h * 0.48), col: pick(inst.c) }); }
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (let i = inst.rk.length - 1; i >= 0; i--) {
        const r = inst.rk[i]; r.y += r.vy * F.dt; ctx.globalAlpha = 0.9; const s = 10; ctx.drawImage(glow('#ffe8a0'), r.x - s, r.y - s, s * 2, s * 2);
        if (r.y <= r.top) { const n = F.mobile ? 34 : 56, sz = rnd(120, 260) * (1 + F.v * 0.5); for (let k = 0; k < n; k++) { const a = (k / n) * TAU + rnd(-0.05, 0.05), sp = sz * rnd(0.55, 1); inst.sp.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, col: r.col }); } inst.rk.splice(i, 1); }
      }
      for (let i = inst.sp.length - 1; i >= 0; i--) {
        const s = inst.sp[i]; s.life -= F.dt * 0.8; if (s.life <= 0) { inst.sp.splice(i, 1); continue; } const px = s.x, py = s.y; s.vx *= 1 - F.dt * 1.1; s.vy = s.vy * (1 - F.dt * 1.1) + 150 * F.dt; s.x += s.vx * F.dt; s.y += s.vy * F.dt;
        ctx.strokeStyle = s.col; ctx.globalAlpha = s.life; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(s.x, s.y); ctx.stroke(); const g = 8 * s.life; ctx.drawImage(glow(hex6(s.col)), s.x - g, s.y - g, g * 2, g * 2);
      }
      ctx.restore();
    },
    sparkler(inst, ctx, F) {
      const px = F.w * (0.5 + Math.sin(F.t * 0.6) * 0.38), py = F.h * (0.55 + Math.sin(F.t * 0.9 + 1) * 0.25), n = 3 + Math.floor(F.v * 14);
      for (let i = 0; i < n; i++) { const a = rnd(0, TAU), s = rnd(40, 200); inst.sp.push({ x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 1, col: pick(inst.c) }); }
      if (inst.sp.length > 360) inst.sp.splice(0, inst.sp.length - 360);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = inst.sp.length - 1; i >= 0; i--) { const s = inst.sp[i]; s.life -= F.dt * 1.7; if (s.life <= 0) { inst.sp.splice(i, 1); continue; } s.vy += 320 * F.dt; s.x += s.vx * F.dt; s.y += s.vy * F.dt; ctx.globalAlpha = s.life; const g = 7 * s.life + 2; ctx.drawImage(glow(hex6(s.col)), s.x - g, s.y - g, g * 2, g * 2); }
      ctx.globalAlpha = 1; ctx.drawImage(glow('#ffffff'), px - 16, py - 16, 32, 32); ctx.restore();
    },
    fountain(inst, ctx, F) {
      const rate = 2 + F.v * 9, sources = [F.w * 0.5]; if (inst.e.id === 'champagne') sources.push(F.w * 0.25, F.w * 0.75);
      for (const sx of sources) for (let i = 0; i < rate; i++) { if (inst.sp.length > 260) break; const a = -Math.PI / 2 + rnd(-0.3, 0.3); const s = rnd(380, 720) * (0.8 + F.v * 0.6); inst.sp.push({ x: sx + rnd(-8, 8), y: F.h + 10, vx: Math.cos(a) * s * 0.5, vy: Math.sin(a) * s, col: pick(inst.c), r: rnd(4, 10), z: depth(), rot: 0, sp: 0 }); }
      ctx.save();
      for (let i = inst.sp.length - 1; i >= 0; i--) {
        const s = inst.sp[i]; s.vy += 560 * F.dt; s.x += s.vx * F.dt; s.y += s.vy * F.dt; if (s.y > F.h + 30 && s.vy > 0) { inst.sp.splice(i, 1); continue; }
        ctx.save(); ctx.translate(s.x, s.y); ctx.globalAlpha = 0.85; shape(ctx, inst.kind, s.r * s.z * 1.3, s.col, s, F); ctx.restore();
      }
      ctx.restore();
    },
    poppers(inst, ctx, F) {
      if (F.beat) for (const side of [0, 1]) for (let i = 0; i < 26; i++) { const a = side ? -Math.PI + rnd(0.55, 1.2) : -rnd(0.55, 1.2) - 0.0, sp = rnd(420, 900); inst.sp.push({ x: side ? F.w + 6 : -6, y: F.h * 0.85, vx: Math.cos(side ? -Math.PI / 2 - rnd(0.2, 1.1) : -Math.PI / 2 + rnd(0.2, 1.1)) * sp * 0.9, vy: -Math.abs(Math.sin(a)) * sp, col: pick(inst.c), sp: rnd(0, TAU), sv: rnd(4, 11), r: rnd(5, 10), z: 1 }); }
      if (inst.sp.length > 420) inst.sp.splice(0, inst.sp.length - 420);
      ctx.save();
      for (let i = inst.sp.length - 1; i >= 0; i--) {
        const s = inst.sp[i]; s.vx *= 1 - F.dt * 1.1; s.vy = s.vy * (1 - F.dt * 1.1) + 420 * F.dt; s.x += s.vx * F.dt; s.y += s.vy * F.dt; s.sp += s.sv * F.dt; if (s.y > F.h + 30) { inst.sp.splice(i, 1); continue; }
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.sp * 0.4); ctx.scale(Math.cos(s.sp), 1); ctx.globalAlpha = 0.95; shape(ctx, 'conf', s.r, s.col, s, F); ctx.restore();
      }
      ctx.restore();
    }
  };

  /* ---------- building an effect instance ---------- */
  function build(e, env, w, h) {
    const o = e.o, inst = { e: e, c: resolve(o.c, env), ps: [], rs: [], sp: [], rk: [], bolts: [], es: [], splash: [], flash: 0, v: 0, prev: 0, kind: null, glyphs: null };
    const sh = e.shape;
    if (Array.isArray(sh)) { inst.kind = 'emoji'; inst.glyphs = sh; }
    else if (typeof sh === 'string' && sh.charCodeAt(0) > 127) { inst.kind = 'emoji'; inst.glyphs = [sh]; }
    else inst.kind = sh;
    const F0 = { w: w, h: h };
    const scale = env.mobile ? 0.6 : 1, n = Math.max(1, Math.round((o.n || 0) * scale));
    const m = e.motion;
    if (['fall', 'rise', 'drift', 'cross', 'orbit', 'warp', 'vortex', 'meteor', 'rain'].indexOf(m) >= 0) for (let i = 0; i < n; i++) inst.ps.push(mkParticle(inst, F0, true));
    else if (m === 'galaxy') for (let i = 0; i < n; i++) inst.ps.push({ gt: Math.pow(Math.random(), 0.8), arm: i % 3, off: rnd(-0.35, 0.35), col: pick(inst.c) });
    else if (m === 'twinkle') for (let i = 0; i < n; i++) inst.ps.push({ x: rnd(0, w), y: rnd(0, h), z: Math.random(), a: rnd(0, TAU), aw: rnd(0.6, 2.4), col: pick(inst.c) });
    else if (m === 'blobs') for (let i = 0; i < n; i++) inst.ps.push({ x: rnd(0, w), y: rnd(0, h), a: rnd(0, TAU), size: rnd(0.25, 0.55) * Math.max(w, h) * (o.big || 1) * 0.6, col: pick(inst.c) });
    else if (m === 'smoke') for (let i = 0; i < n; i++) inst.ps.push({ x: rnd(0, w), y: rnd(0, h), a: rnd(0, TAU), z: Math.random(), size: rnd(60, 130), col: pick(inst.c) });
    else if (m === 'bokeh') for (let i = 0; i < n; i++) inst.ps.push({ x: rnd(0, w), y: rnd(0, h), a: rnd(0, TAU), aw: Math.random(), size: rnd(14, 64) });
    return inst;
  }

  /* make(ids, env): env = { acc, acc2, w, h, mobile }. draw(back, front, w, h, st): st = { p, ch, arr, t, dt } */
  function make(ids, env) {
    const insts = []; const w = env.w || innerWidth, h = env.h || innerHeight;
    const seen = {};
    (function add(list, depthLevel) { for (const id of list) { const e = BY[id]; if (!e || seen[id] || insts.length > 9 || depthLevel > 2) continue; seen[id] = 1; insts.push(build(e, env, w, h)); if (e.o.also) add(e.o.also, depthLevel + 1); } })(ids || [], 0);
    return {
      count: insts.length,
      resize(nw, nh) { for (const i of insts) { if (i.cols) i.cols = null; for (const P of i.ps) { if (P.x > nw) P.x = Math.random() * nw; if (P.y > nh && i.e.motion !== 'rain') P.y = Math.random() * nh; } } },
      draw(back, front, W, H, st) {
        const dt = clamp(st.dt || 0.016, 0.001, 0.05), mobile = env.mobile;
        for (const inst of insts) {
          const chn = inst.e.o.ch || 'bass', raw = st.ch ? (st.ch[chn] || 0) : clamp(st.p * (0.45 + 0.4 * Math.sin(st.t * 1.7 + chn.length)), 0, 1);
          inst.v += (raw - inst.v) * Math.min(1, dt * 16); const beat = raw > 0.58 && inst.prev < 0.4; inst.prev = raw;
          const F = { w: W, h: H, dt: dt, t: st.t, v: inst.v, p: st.p || 0, beat: beat, mobile: mobile };
          const ctx = inst.e.o.layer === 'back' ? back : front;
          try { MOTIONS[inst.e.motion](inst, ctx, F); } catch (err) { window.smlProfileFx.errors.push(inst.e.id + ': ' + (err && err.message)); inst.e = { id: inst.e.id, motion: 'none', o: inst.e.o }; }
        }
      }
    };
  }
  MOTIONS.none = () => {};

  window.smlProfileFx = { errors: [], make, list: ENTRIES.map((e) => ({ id: e.id, label: e.label, group: e.group })) };
})();
