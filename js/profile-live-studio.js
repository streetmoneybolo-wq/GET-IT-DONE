/** Durable settings bridge plus owner-only, in-profile live studio. */
( function () {
	'use strict';
	var cfg = window.SML_PROFILE_UNIFIED || {};
	var im = cfg.immersive && typeof cfg.immersive === 'object' ? cfg.immersive : {};
	var SHAPES = [ 'dot', 'ring', 'vinyl', 'diamond', 'plus', 'cross', 'tri', 'square', 'pill', 'hex', 'star', 'sparkle', 'note', 'notes', 'dollar', 'percent', 'up', 'down', 'candle', 'spark', 'bars', 'heart', 'bolt', 'moon', 'wave', 'arc' ];
	var EFFECTS = [ 'Rain', 'Waves', 'Quantum', 'Fog', 'Snow', 'Dust', 'Embers', 'Lightning', 'Glitch', 'Energy' ];
	var COMPONENTS = [ 'background', 'banner', 'avatar', 'cards', 'orbital_photos', 'orbital_videos' ];
	var pairs = {
		'sml_profile_pulse_level': im.pulse, 'sml-pulse-shapes': im.shapes,
		'sml-screen-fx-list': im.effects, 'sml-card-texture': im.texture,
		'sml-section-order': im.section_order, 'sml-orbital-item-scales': im.item_scales,
		'sml-orbital-photo-size': im.photo_size, 'sml-orbital-video-size': im.video_size,
		'sml-contact-optin': im.contact_opt_in === false ? '0' : '1', 'sml-beat-sens': im.beat_sensitivity
	};
	try { Object.keys( pairs ).forEach( function ( key ) { var value = pairs[key]; if ( value !== undefined && value !== null ) { localStorage.setItem( key, typeof value === 'object' ? JSON.stringify( value ) : String( value ) ); } } ); } catch ( e ) {}

	function request( url, options ) {
		options = options || {};
		if ( typeof window.fetch !== 'function' ) {
			return new Promise( function ( resolve, reject ) {
				var xhr = new XMLHttpRequest(); xhr.open( options.method || 'GET', url, true ); xhr.withCredentials = true; xhr.setRequestHeader( 'Content-Type', 'application/json' ); xhr.setRequestHeader( 'X-WP-Nonce', cfg.nonce || '' );
				xhr.onload = function () { var json = {}; try { json = xhr.responseText ? JSON.parse( xhr.responseText ) : {}; } catch ( e ) { reject( new Error( 'The profile returned an unreadable response.' ) ); return; } if ( xhr.status < 200 || xhr.status >= 300 ) { reject( new Error( json.message || 'The profile could not be saved.' ) ); return; } resolve( json ); };
				xhr.onerror = function () { reject( new Error( 'The profile request could not reach the server.' ) ); };
				xhr.send( options.body ? JSON.stringify( options.body ) : null );
			} );
		}
		return window.fetch( url, { method: options.method || 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce || '' }, body: options.body ? JSON.stringify( options.body ) : undefined } ).then( function ( response ) {
			return response.text().then( function ( text ) { var json = text ? JSON.parse( text ) : {}; if ( ! response.ok ) { throw new Error( json.message || 'The profile could not be saved.' ); } return json; } );
		} );
	}
	function ytId( url ) {
		try { var parsed = new URL( String( url || '' ).trim() ); if ( /youtu\.be$/i.test( parsed.hostname ) ) { return parsed.pathname.split( '/' )[1] || ''; } if ( /youtube(?:-nocookie)?\.com$/i.test( parsed.hostname.replace( /^www\./, '' ) ) ) { if ( parsed.searchParams.get( 'v' ) ) { return parsed.searchParams.get( 'v' ); } var match = parsed.pathname.match( /^\/(?:embed|shorts|live)\/([^/?]+)/ ); return match ? match[1] : ''; } } catch ( e ) {} return '';
	}
	function node( tag, cls, text ) { var el = document.createElement( tag ); if ( cls ) { el.className = cls; } if ( text !== undefined ) { el.textContent = text; } return el; }
	function dispatch( el ) { if ( el ) { el.dispatchEvent( new Event( 'input', { bubbles: true } ) ); } }
	function applyImmersive( next ) {
		var root = document.querySelector( '.sip-root' ); if ( ! root ) { return; }
		var components = Array.isArray( next.components ) ? next.components : COMPONENTS.slice();
		COMPONENTS.forEach( function ( key ) { root.setAttribute( 'data-sml-imm-' + key.replace( /_/g, '-' ), components.indexOf( key ) >= 0 ? '1' : '0' ); } );
		try { localStorage.setItem( 'sml-immersive-components', JSON.stringify( components ) ); } catch ( e ) {}
		try { window.dispatchEvent( new CustomEvent( 'sml-immersive-components', { detail: components } ) ); } catch ( e ) {}
		var level = String( next.pulse || 'immersive' ); level = level.charAt( 0 ).toUpperCase() + level.slice( 1 );
		var pulse = root.querySelector( '[data-level="' + level + '"]' ); if ( pulse && ! pulse.classList.contains( 'on' ) ) { pulse.click(); }
		var texture = root.querySelector( '[data-tex="' + ( next.texture || 'Glass' ) + '"]' ); if ( texture && ! texture.classList.contains( 'on' ) ) { texture.click(); }
		root.querySelectorAll( '[data-shape]' ).forEach( function ( button ) { var wanted = ( next.shapes || [] ).indexOf( button.dataset.shape ) >= 0; if ( wanted !== button.classList.contains( 'on' ) ) { button.click(); } } );
		root.querySelectorAll( '[data-fx]' ).forEach( function ( button ) { var wanted = ( next.effects || [] ).indexOf( button.dataset.fx ) >= 0; if ( wanted !== button.classList.contains( 'on' ) ) { button.click(); } } );
		[ [ '.sip-bsens', next.beat_sensitivity ], [ '.sip-psize', next.photo_size ], [ '.sip-vsize', next.video_size ] ].forEach( function ( spec ) { var input = root.querySelector( spec[0] ); if ( input && spec[1] !== undefined && Number( input.value ) !== Number( spec[1] ) ) { input.value = spec[1]; dispatch( input ); } } );
		var contact = root.querySelector( '.sip-optin' );
		if ( contact ) {
			var currentlyShown = ! /^Show\b/i.test( contact.textContent || '' );
			if ( currentlyShown !== ( next.contact_opt_in !== false ) ) { contact.click(); }
		} else {
			try { localStorage.setItem( 'sml-contact-optin', next.contact_opt_in === false ? '0' : '1' ); } catch ( e ) {}
		}
		if ( window.SMLImmersiveColors ) { window.SMLImmersiveColors.apply( { accent: next.accent_color || '', text: next.text_color || '', cardBg: next.card_bg_color || '' } ); }
	}
	function previewMusic( url, title ) {
		var id = ytId( url ); if ( ! id ) { throw new Error( 'Paste a valid YouTube video URL first.' ); }
		var frame = document.getElementById( 'sml-profile-music-player' ); if ( ! frame ) { throw new Error( 'The profile music player is not available.' ); }
		frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent( id ) + '?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&controls=0&loop=1&playlist=' + encodeURIComponent( id );
		var track = document.querySelector( '.sip-track-t' ); if ( track ) { track.textContent = title || 'Live music preview'; }
		frame.addEventListener( 'load', function () { var send = function ( payload ) { try { frame.contentWindow.postMessage( JSON.stringify( payload ), '*' ); } catch ( e ) {} }; send( { event: 'listening', id: 8, channel: 'widget' } ); setTimeout( function () { send( { event: 'command', func: 'playVideo', args: [] } ); send( { event: 'command', func: 'unMute', args: [] } ); send( { event: 'command', func: 'setVolume', args: [ 60 ] } ); var overlay = document.querySelector( '.sip-overlay' ); if ( overlay ) { overlay.style.display = 'none'; } }, 600 ); }, { once: true } );
	}
	function uploadFile( file, purpose, onProgress ) {
		if ( purpose === 'background' && file.size > 8388608 ) { return uploadChunkedBackground( file, purpose, onProgress ); }
		return new Promise( function ( resolve, reject ) {
			var xhr = new XMLHttpRequest(), form = new FormData(); form.append( 'file', file ); form.append( 'purpose', purpose );
			xhr.open( 'POST', cfg.uploadRest, true ); xhr.withCredentials = true; xhr.setRequestHeader( 'X-WP-Nonce', cfg.nonce || '' );
			xhr.onload = function () { var json = {}; try { json = xhr.responseText ? JSON.parse( xhr.responseText ) : {}; } catch ( e ) { reject( new Error( 'The upload returned an unreadable response.' ) ); return; } if ( xhr.status < 200 || xhr.status >= 300 ) { reject( new Error( json.message || 'The media upload failed.' ) ); return; } resolve( json ); };
			if ( xhr.upload && onProgress ) { xhr.upload.onprogress = function ( event ) { if ( event.lengthComputable ) { onProgress( Math.round( event.loaded * 100 / event.total ) ); } }; }
			xhr.onerror = function () { reject( new Error( 'The media upload could not reach the server.' ) ); }; xhr.send( form );
		} );
	}
	function uploadChunkedBackground( file, purpose, onProgress ) {
		var chunkSize = 8 * 1024 * 1024, count = Math.ceil( file.size / chunkSize ), index = 0, uploadId = '';
		var bytes = new Uint8Array( 16 ); window.crypto.getRandomValues( bytes ); bytes.forEach( function ( value ) { uploadId += value.toString( 16 ).padStart( 2, '0' ); } );
		function sendNext() {
			return new Promise( function ( resolve, reject ) {
				var start = index * chunkSize, end = Math.min( file.size, start + chunkSize ), blob = file.slice( start, end ), xhr = new XMLHttpRequest(), form = new FormData();
				form.append( 'file', blob, file.name + '.part' ); form.append( 'purpose', purpose ); form.append( 'upload_id', uploadId ); form.append( 'chunk_index', String( index ) ); form.append( 'chunk_count', String( count ) ); form.append( 'total_size', String( file.size ) ); form.append( 'original_name', file.name );
				xhr.open( 'POST', cfg.uploadRest.replace( /\/$/, '' ) + '/chunk', true ); xhr.withCredentials = true; xhr.setRequestHeader( 'X-WP-Nonce', cfg.nonce || '' );
				xhr.onload = function () { var json = {}; try { json = xhr.responseText ? JSON.parse( xhr.responseText ) : {}; } catch ( e ) { reject( new Error( 'The background upload returned an unreadable response.' ) ); return; } if ( xhr.status < 200 || xhr.status >= 300 ) { reject( new Error( json.message || 'The background upload failed.' ) ); return; } if ( index + 1 < count ) { index++; sendNext().then( resolve, reject ); return; } resolve( json ); };
				if ( xhr.upload && onProgress ) { xhr.upload.onprogress = function ( event ) { if ( event.lengthComputable ) { onProgress( Math.min( 99, Math.round( ( start + event.loaded ) * 100 / file.size ) ) ); } }; }
				xhr.onerror = function () { reject( new Error( 'The background upload could not reach the server.' ) ); }; xhr.send( form );
			} );
		}
		return sendNext().then( function ( result ) { if ( onProgress ) { onProgress( 100 ); } return result; } );
	}

	function mountOwnerStudio() {
		if ( ! cfg.isOwner || ! cfg.membersRest || ! cfg.customRest || document.querySelector( '.sml-live-profile-edit' ) ) { return; }
		var root = document.querySelector( '.sip-root' ); if ( ! root ) { return; }
		var heroEdit = root.querySelector( '.sip-btn[href*="customize-profile"], .sip-btn[href*="my-profile"]' );
		var open = node( 'button', 'sml-live-profile-edit', 'Edit Profile' ); open.type = 'button'; if ( heroEdit ) { heroEdit.replaceWith( open ); } else { root.appendChild( open ); }
		var style = node( 'style' ); style.textContent = '.sml-live-profile-edit{position:fixed;right:18px;top:18px;z-index:2147483646;border:1px solid #38f58a;background:#08140f;color:#dfffea;border-radius:999px;padding:11px 17px;font:700 13px system-ui;cursor:pointer;box-shadow:0 8px 30px #000a}.sml-lpe-backdrop{position:fixed;inset:0;z-index:2147483644;background:#0008;backdrop-filter:blur(2px)}.sml-lpe{position:fixed;z-index:2147483645;right:0;top:0;width:min(440px,100vw);height:100dvh;overflow:auto;background:#071019;color:#e6edf5;border-left:1px solid #234030;box-shadow:-16px 0 50px #000c;padding:20px;font:14px/1.45 system-ui}.sml-lpe[hidden],.sml-lpe-backdrop[hidden]{display:none}.sml-lpe h2{margin:0;font-size:23px}.sml-lpe h3{color:#8dffc2;margin:24px 0 10px}.sml-lpe p{color:#9db0aa}.sml-lpe-row{display:grid;gap:6px;margin:11px 0}.sml-lpe-row>span{font-weight:700}.sml-lpe input[type=url],.sml-lpe select{width:100%;box-sizing:border-box;background:#0b1821;color:#fff;border:1px solid #29463a;border-radius:9px;padding:10px}.sml-lpe-track{display:grid;grid-template-columns:1fr auto;gap:7px}.sml-lpe button{border:1px solid #315647;background:#10251b;color:#eafff2;border-radius:8px;padding:9px 12px;cursor:pointer}.sml-lpe .primary{background:#38f58a;color:#031009;font-weight:800}.sml-lpe-actions{position:sticky;bottom:-20px;background:#071019ef;border-top:1px solid #29463a;padding:14px 0 5px;display:flex;gap:8px}.sml-lpe-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.sml-lpe-checks label{background:#0b1821;border-radius:7px;padding:7px}.sml-lpe-output,.sml-lpe-live,.sml-lpe-status{color:#8dffc2;font-weight:700}.sml-lpe-status{min-height:20px}.sml-lpe-close{float:right}.sml-lpe input[type=range]{width:100%}@media(max-width:600px){.sml-live-profile-edit{top:auto;bottom:14px;right:14px}.sml-lpe{width:100%;padding-bottom:80px}}'; document.head.appendChild( style );
		var shade = node( 'div', 'sml-lpe-backdrop' ); shade.hidden = true; var panel = node( 'aside', 'sml-lpe' ); panel.hidden = true; panel.setAttribute( 'aria-label', 'Live profile customization' );
		var close = node( 'button', 'sml-lpe-close', 'Close' ); close.type = 'button'; panel.appendChild( close ); panel.appendChild( node( 'h2', '', 'Live Profile Studio' ) ); panel.appendChild( node( 'p', 'sml-lpe-live', '● Changes preview on this profile before you save.' ) ); var content = node( 'div' ); panel.appendChild( content ); document.body.appendChild( shade ); document.body.appendChild( panel );
		var identity, initialIm, draft, originalFrameSrc = '', status, topStatus, saveButton, pendingMedia = { background: null, banner: null }, mediaObjects = [];
		var appearance = Object.assign( {}, ( cfg.settings && cfg.settings._appearance ) || {} );
		var originalMedia = null, previewFrame = 0;
		/* Fonts + colors. Fonts are registry KEYS (the same 1,959-family library
		   the editor's Typography panel uses, fetched once per open); colors are
		   the overlay's three runtime colors. Both preview instantly through the
		   overlay's own apply hooks and only reach the server on Save. */
		var FONT_ROLES = [ [ 'heading', 'Headings' ], [ 'body', 'Body text' ], [ 'accent', 'Numbers & tickers' ] ];
		var fontCatalog = null, fontRoles = null, fontsDirty = false, loadedFamilies = {}, colors = { accent_color: '', text_color: '', card_bg_color: '' };
		function loadFontCatalog() {
			if ( fontCatalog ) { return Promise.resolve( fontCatalog ); }
			var base = String( cfg.customRest || '' ).replace( /\/profile\/customization\/?$/, '' );
			if ( ! base ) { return Promise.reject( new Error( 'the font library is unavailable' ) ); }
			return request( base + '/fonts' ).then( function ( json ) { fontCatalog = json && Array.isArray( json.fonts ) ? json : { fonts: [], presets: {} }; return fontCatalog; } );
		}
		function fontByKey( key ) { var list = ( fontCatalog && fontCatalog.fonts ) || []; for ( var i = 0; i < list.length; i++ ) { if ( list[i].key === key ) { return list[i]; } } return null; }
		function ensureWebfont( font ) {
			if ( ! font || font.source !== 'google' || ! font.family || loadedFamilies[ font.family ] ) { return; }
			loadedFamilies[ font.family ] = true;
			var link = node( 'link' ); link.rel = 'stylesheet'; link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent( font.family ).replace( /%20/g, '+' ) + ':wght@400;500;600;700;800&display=swap'; document.head.appendChild( link );
		}
		var MAIN_FONT_VARS = { heading: '--sml-pfe-font-heading', body: '--sml-pfe-font-body', accent: '--sml-pfe-font-accent' };
		function applyFonts( roles ) {
			var stacks = {}, main = document.querySelector( 'main.sml-profile' );
			FONT_ROLES.forEach( function ( r ) { var f = fontByKey( roles[ r[0] ] ); if ( f ) { ensureWebfont( f ); stacks[ r[0] ] = f.stack; if ( main ) { main.style.setProperty( MAIN_FONT_VARS[ r[0] ], f.stack ); } } } );
			if ( window.SMLImmersiveFonts && window.SMLImmersiveFonts.apply ) { window.SMLImmersiveFonts.apply( stacks ); }
		}
		function restoreFonts() {
			var main = document.querySelector( 'main.sml-profile' ), overlay = document.querySelector( '.sip-root' );
			if ( main ) { FONT_ROLES.forEach( function ( r ) { main.style.removeProperty( MAIN_FONT_VARS[ r[0] ] ); } ); }
			if ( overlay ) { [ '--sip-fh', '--sip-fb', '--sip-fa' ].forEach( function ( v ) { overlay.style.removeProperty( v ); } ); }
			if ( window.SMLImmersiveFonts && window.SMLImmersiveFonts.apply ) { window.SMLImmersiveFonts.apply(); }
		}
		function currentFontRoles() {
			var app = appearance || {}, presets = ( fontCatalog && fontCatalog.presets ) || {};
			if ( app.font_preset === 'custom' ) { return { heading: app.font_heading || 'system', body: app.font_body || 'system', accent: app.font_accent || 'system' }; }
			if ( presets[ app.font_preset ] ) { return Object.assign( {}, presets[ app.font_preset ] ); }
			var main = document.querySelector( 'main.sml-profile' ), cs = main ? getComputedStyle( main ) : null, out = {};
			FONT_ROLES.forEach( function ( r ) { var stack = cs ? cs.getPropertyValue( MAIN_FONT_VARS[ r[0] ] ).trim() : ''; var hit = ( fontCatalog.fonts || [] ).filter( function ( f ) { return f.stack === stack; } )[0]; out[ r[0] ] = hit ? hit.key : 'system'; } );
			return out;
		}
		function applyColors() { if ( window.SMLImmersiveColors ) { window.SMLImmersiveColors.apply( { accent: colors.accent_color, text: colors.text_color, cardBg: colors.card_bg_color } ); } }
		/* Preview changes are local, at most once per animation frame. No polling or
		   database writes are needed while dragging a slider. */
		function queuePreview() {
			if ( previewFrame ) { return; }
			previewFrame = requestAnimationFrame( function () { previewFrame = 0; if ( ! panel.hidden ) { applyImmersive( currentDraft() ); } } );
		}
		function stopPreview() { if ( previewFrame ) { cancelAnimationFrame( previewFrame ); previewFrame = 0; } }
		var layoutStyle = node( 'style' );
		layoutStyle.textContent = '.sml-lpe-backdrop{display:none!important}.sml-lpe{box-sizing:border-box;width:380px;max-width:100vw;top:var(--sml-lpe-top,0px);height:calc(100dvh - var(--sml-lpe-top,0px));padding:16px;overscroll-behavior:contain}.sml-lpe-open #sml-immersive-profile-root{right:380px!important}.sml-lpe-open .sip-exit{right:392px}.sml-lpe-open .sip-worldnav.next{right:392px}.sml-lpe-open .sip-editbadge{max-width:calc(100% - 24px)}.sml-lpe-actions{bottom:-16px;z-index:2;flex-wrap:wrap}.sml-lpe-open .sip-studio-open,.sml-lpe-open .sip-live-open{visibility:hidden}.sml-lpe-fontsearch{width:100%;box-sizing:border-box;background:#0b1821;color:#fff;border:1px solid #29463a;border-radius:9px;padding:8px 10px;margin-bottom:6px;font:inherit}.sml-lpe-colorrow{display:flex;align-items:center;gap:10px}.sml-lpe input[type=color]{width:72px;height:42px;padding:3px;border:1px solid #29463a;border-radius:9px;background:#0b1821;cursor:pointer}@media(max-width:900px){.sml-lpe{top:auto;bottom:0;width:100%;height:48dvh;padding:12px 14px max(16px,env(safe-area-inset-bottom))}.sml-lpe-open #sml-immersive-profile-root{right:0!important;bottom:48dvh!important}.sml-lpe-open .sip-exit{right:12px}.sml-lpe-open .sip-content{padding-bottom:24px}.sml-lpe-open .sip-dock{display:none}.sml-lpe-actions{bottom:0}}';
		document.head.appendChild( layoutStyle );
		function syncPanelTop() {
			var top = 0;
			[ 'wpadminbar', 'sml-global-header' ].forEach( function ( id ) { var el = document.getElementById( id ); if ( el ) { top = Math.max( top, el.getBoundingClientRect().bottom ); } } );
			panel.style.setProperty( '--sml-lpe-top', Math.ceil( top ) + 'px' );
		}
		window.addEventListener( 'resize', syncPanelTop, { passive: true } );
		function choicesFromProfile( selector, attribute, fallback ) {
			var values = Array.from( root.querySelectorAll( selector ) ).map( function ( el ) { return el.getAttribute( attribute ); } ).filter( Boolean );
			return values.length ? Array.from( new Set( values ) ) : fallback;
		}
		function field( label, control ) { var row = node( 'label', 'sml-lpe-row' ); row.appendChild( node( 'span', '', label ) ); row.appendChild( control ); return row; }
		function currentDraft() { var result = Object.assign( {}, draft ); result.pulse = content.querySelector( '[name=pulse]' ).value; result.texture = content.querySelector( '[name=texture]' ).value; result.beat_sensitivity = parseFloat( content.querySelector( '[name=sensitivity]' ).value ); result.photo_size = parseInt( content.querySelector( '[name=photo]' ).value, 10 ); result.video_size = parseInt( content.querySelector( '[name=video]' ).value, 10 ); result.contact_opt_in = content.querySelector( '[name=contact]' ).checked; result.shapes = Array.from( content.querySelectorAll( '[name=shape]:checked' ) ).map( function ( x ) { return x.value; } ); result.effects = Array.from( content.querySelectorAll( '[name=effect]:checked' ) ).map( function ( x ) { return x.value; } ); result.components = Array.from( content.querySelectorAll( '[name=component]:checked' ) ).map( function ( x ) { return x.value; } ); result.accent_color = colors.accent_color; result.text_color = colors.text_color; result.card_bg_color = colors.card_bg_color; return result; }
		function addSelect( name, values, value ) { var select = node( 'select' ); select.name = name; values.forEach( function ( x ) { var option = node( 'option', '', x ); option.value = x; select.appendChild( option ); } ); select.value = value; return select; }
		function addRange( name, min, max, step, value ) { var wrap = node( 'div' ), range = node( 'input' ), out = node( 'span', 'sml-lpe-output', String( value ) ); range.type = 'range'; range.name = name; range.min = min; range.max = max; range.step = step; range.value = value; range.addEventListener( 'input', function () { out.textContent = range.value; queuePreview(); } ); wrap.appendChild( range ); wrap.appendChild( out ); return wrap; }
		function checks( name, choices, active ) { var box = node( 'div', 'sml-lpe-checks' ); choices.forEach( function ( choice ) { var label = node( 'label' ), check = node( 'input' ); check.type = 'checkbox'; check.name = name; check.value = choice; check.checked = active.indexOf( choice ) >= 0; check.addEventListener( 'change', function () { queuePreview(); } ); label.appendChild( check ); label.appendChild( document.createTextNode( ' ' + choice ) ); box.appendChild( label ); } ); return box; }
		function previewMedia( kind, file ) {
			var url = URL.createObjectURL( file ); mediaObjects.push( url ); var isVideo = /^video\//.test( file.type );
			if ( kind === 'banner' ) {
				var banner = root.querySelector( '.sip-banner' ); if ( ! banner ) { return; } banner.querySelectorAll( '.sml-lpe-media-preview' ).forEach( function ( x ) { x.remove(); } );
				var media = node( isVideo ? 'video' : 'img', 'sml-lpe-media-preview' ); media.src = url; if ( isVideo ) { media.autoplay = media.loop = media.muted = media.playsInline = true; } media.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:' + ( content.querySelector( '[name=banner_fit]' ).value || 'cover' ) + ';opacity:' + content.querySelector( '[name=banner_opacity]' ).value + ';z-index:0'; banner.appendChild( media ); banner.style.backgroundImage = 'none';
			} else {
				root.querySelectorAll( '.sml-lpe-bg-preview' ).forEach( function ( x ) { x.remove(); } ); root.style.backgroundImage = '';
				var bg = node( isVideo ? 'video' : 'img', 'sml-lpe-bg-preview' ); bg.src = url; if ( isVideo ) { bg.autoplay = bg.loop = bg.muted = bg.playsInline = true; } bg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:' + ( content.querySelector( '[name=background_fit]' ).value || 'cover' ) + ';opacity:' + content.querySelector( '[name=background_opacity]' ).value + ';pointer-events:none'; root.insertBefore( bg, root.firstChild );
			}
		}
		function mediaPicker( kind, labelText ) {
			var box = node( 'div' ), input = node( 'input' ); input.type = 'file'; input.name = kind + '_file'; input.accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm';
			input.addEventListener( 'change', function () { var file = input.files && input.files[0]; if ( ! file ) { return; } if ( kind === 'background' && file.type === 'image/gif' && file.size > 104857600 ) { input.value = ''; pendingMedia[kind] = null; setStatus( 'Background GIFs can be up to 100 MB.' ); return; } pendingMedia[kind] = file; previewMedia( kind, file ); var mb = ( file.size / 1048576 ).toFixed( 1 ); setStatus( labelText + ' is previewing live (' + mb + ' MB). Save to upload and publish it.' ); } ); box.appendChild( input ); return field( labelText, box );
		}
		function setStatus( message ) { if ( status ) { status.textContent = message; } if ( topStatus ) { topStatus.textContent = message; } }
		function build() {
			root = document.querySelector( '.sip-root' ); content.textContent = ''; topStatus = node( 'p', 'sml-lpe-status', '' ); content.appendChild( topStatus ); content.appendChild( node( 'h3', '', 'Live background + banner' ) ); content.appendChild( node( 'p', '', 'Choose an image, GIF, or video and see it on this profile before saving.' ) );
			content.appendChild( mediaPicker( 'background', 'Profile background' ) ); var bgFit = addSelect( 'background_fit', [ 'cover', 'contain' ], appearance.background_size || 'cover' ); content.appendChild( field( 'Background fit', bgFit ) ); content.appendChild( field( 'Background opacity', addRange( 'background_opacity', .15, 1, .05, appearance.background_opacity == null ? 1 : appearance.background_opacity ) ) );
			content.appendChild( mediaPicker( 'banner', 'Profile banner' ) ); var bnFit = addSelect( 'banner_fit', [ 'cover', 'contain' ], appearance.banner_fit || 'cover' ); content.appendChild( field( 'Banner fit', bnFit ) ); content.appendChild( field( 'Banner opacity', addRange( 'banner_opacity', .15, 1, .05, appearance.banner_opacity == null ? 1 : appearance.banner_opacity ) ) );
			function refreshMediaStyle() { var bg = root.querySelector( '.sml-lpe-bg-preview' ), banner = root.querySelector( '.sml-lpe-media-preview' ); if ( bg ) { bg.style.objectFit = bgFit.value; bg.style.opacity = content.querySelector( '[name=background_opacity]' ).value; } if ( banner ) { banner.style.objectFit = bnFit.value; banner.style.opacity = content.querySelector( '[name=banner_opacity]' ).value; } }
			[ bgFit, bnFit ].forEach( function ( control ) { control.addEventListener( 'change', refreshMediaStyle ); } ); content.querySelectorAll( '[name=background_opacity],[name=banner_opacity]' ).forEach( function ( control ) { control.addEventListener( 'input', refreshMediaStyle ); } );
			content.appendChild( node( 'h3', '', 'Music + live reaction' ) ); content.appendChild( node( 'p', '', 'Paste up to five YouTube links. Preview any track and watch the newest pulse, particles, background and orbitals react immediately.' ) );
			var tracks = Array.isArray( identity.music_playlist ) ? identity.music_playlist : [];
			for ( var i = 0; i < 5; i++ ) { ( function ( index ) { var line = node( 'div', 'sml-lpe-track' ), input = node( 'input' ), preview = node( 'button', '', 'Preview' ); input.type = 'url'; input.name = 'track_' + index; input.placeholder = 'YouTube URL'; input.value = ( tracks[index] && ( tracks[index].url || tracks[index] ) ) || ''; preview.type = 'button'; preview.addEventListener( 'click', function () { try { previewMusic( input.value, 'Track ' + ( index + 1 ) + ' preview' ); status.textContent = 'Playing Track ' + ( index + 1 ) + ' as a live preview.'; } catch ( error ) { status.textContent = error.message; } } ); line.appendChild( input ); line.appendChild( preview ); content.appendChild( field( 'Track ' + ( index + 1 ) + ' URL', line ) ); }( i ) ); }
			var autoplay = node( 'input' ); autoplay.type = 'checkbox'; autoplay.name = 'autoplay'; autoplay.checked = !! identity.music_autoplay; content.appendChild( field( 'Autoplay when the browser permits it', autoplay ) );
			content.appendChild( node( 'h3', '', 'Fonts + colors' ) ); content.appendChild( node( 'p', '', 'Pick any font from the library and choose your colors with the color wheel — the profile changes as you go. Nothing is saved until you press Save.' ) );
			var fontsBox = node( 'div' ); content.appendChild( fontsBox ); fontsBox.appendChild( node( 'p', 'sml-lpe-status', 'Loading the font library…' ) );
			function fontPicker( role, label, cat ) {
				var wrap = node( 'div' ), search = node( 'input' ), select = node( 'select' );
				search.type = 'search'; search.className = 'sml-lpe-fontsearch'; search.placeholder = 'Search ' + cat.fonts.length + ' fonts'; select.name = 'font_' + role;
				function fill( q ) {
					select.textContent = ''; q = String( q || '' ).toLowerCase(); var cur = fontRoles[ role ], groups = {}, order = [ 'modern', 'editorial', 'technical', 'display', 'luxury' ];
					cat.fonts.forEach( function ( f ) { if ( role === 'body' && f.body_safe === false ) { return; } if ( q && f.key !== cur && f.label.toLowerCase().indexOf( q ) === -1 ) { return; } ( groups[ f.category ] = groups[ f.category ] || [] ).push( f ); } );
					order.concat( Object.keys( groups ) ).filter( function ( g, i, a ) { return groups[ g ] && a.indexOf( g ) === i; } ).forEach( function ( g ) { var og = node( 'optgroup' ); og.label = g.charAt( 0 ).toUpperCase() + g.slice( 1 ); groups[ g ].forEach( function ( f ) { var o = node( 'option', '', f.label ); o.value = f.key; og.appendChild( o ); } ); select.appendChild( og ); } );
					select.value = cur;
				}
				fill( '' );
				search.addEventListener( 'input', function () { fill( search.value ); } );
				select.addEventListener( 'change', function () { fontRoles[ role ] = select.value; fontsDirty = true; applyFonts( fontRoles ); setStatus( label + ' font is previewing live. Save to publish it.' ); } );
				wrap.appendChild( search ); wrap.appendChild( select ); return field( label + ' font', wrap );
			}
			loadFontCatalog().then( function ( cat ) { fontsBox.textContent = ''; fontRoles = currentFontRoles(); FONT_ROLES.forEach( function ( r ) { fontsBox.appendChild( fontPicker( r[0], r[1], cat ) ); } ); } ).catch( function ( error ) { fontsBox.textContent = ''; fontsBox.appendChild( node( 'p', 'sml-lpe-status', 'Fonts could not load: ' + error.message ) ); } );
			function colorPicker( name, label, def ) {
				var wrap = node( 'div', 'sml-lpe-colorrow' ), input = node( 'input' ), reset = node( 'button', '', 'Default' ); input.type = 'color'; input.name = name; input.value = colors[ name ] || def; reset.type = 'button';
				input.addEventListener( 'input', function () { colors[ name ] = input.value; applyColors(); } );
				reset.addEventListener( 'click', function () { colors[ name ] = ''; input.value = def; applyColors(); } );
				wrap.appendChild( input ); wrap.appendChild( reset ); return field( label, wrap );
			}
			colors = { accent_color: draft.accent_color || '', text_color: draft.text_color || '', card_bg_color: draft.card_bg_color || '' };
			content.appendChild( colorPicker( 'text_color', 'Font color', '#E6EDF5' ) ); content.appendChild( colorPicker( 'accent_color', 'Accent + pulse color', '#38F58A' ) ); content.appendChild( colorPicker( 'card_bg_color', 'Module background color', '#111823' ) );
			content.appendChild( node( 'h3', '', 'Immersive reaction' ) ); var pulse = addSelect( 'pulse', [ 'off', 'subtle', 'balanced', 'immersive' ], draft.pulse || 'immersive' ); pulse.addEventListener( 'change', function () { queuePreview(); } ); content.appendChild( field( 'Pulse strength', pulse ) ); var texture = addSelect( 'texture', choicesFromProfile( '[data-tex]', 'data-tex', [ 'Glass', 'Carbon', 'Brushed', 'Holo' ] ), draft.texture || 'Glass' ); texture.addEventListener( 'change', function () { queuePreview(); } ); content.appendChild( field( 'Card texture', texture ) );
			content.appendChild( node( 'p', '', 'Choose exactly which parts react to the music.' ) ); content.appendChild( checks( 'component', COMPONENTS, Array.isArray( draft.components ) ? draft.components : COMPONENTS.slice() ) );
			content.appendChild( field( 'Beat sensitivity', addRange( 'sensitivity', .5, 2, .05, draft.beat_sensitivity || 1 ) ) ); content.appendChild( field( 'Photo orbital height', addRange( 'photo', 180, 560, 10, draft.photo_size || 300 ) ) ); content.appendChild( field( 'Video orbital height', addRange( 'video', 180, 560, 10, draft.video_size || 300 ) ) ); var contact = node( 'input' ); contact.type = 'checkbox'; contact.name = 'contact'; contact.checked = draft.contact_opt_in !== false; contact.addEventListener( 'change', queuePreview ); content.appendChild( field( 'Show contact information', contact ) );
			content.appendChild( node( 'h3', '', 'Music-reactive objects' ) ); content.appendChild( checks( 'shape', choicesFromProfile( '[data-shape]', 'data-shape', SHAPES ), draft.shapes || [] ) ); content.appendChild( node( 'h3', '', 'Screen effects' ) ); content.appendChild( checks( 'effect', choicesFromProfile( '[data-fx]', 'data-fx', EFFECTS ), draft.effects || [] ) );
			var arrange = node( 'button', '', 'Arrange profile sections and orbitals' ); arrange.type = 'button'; arrange.addEventListener( 'click', function () { cancelEdit(); var button = root.querySelector( '.sip-edit-toggle' ); if ( button && ! root.querySelector( '.sip-sec.edit' ) ) { button.click(); } } ); content.appendChild( arrange ); status = node( 'p', 'sml-lpe-status', '' ); content.appendChild( status ); var actions = node( 'div', 'sml-lpe-actions' ), cancel = node( 'button', '', 'Cancel changes' ); saveButton = node( 'button', 'primary', 'Save profile' ); cancel.type = saveButton.type = 'button'; actions.appendChild( cancel ); actions.appendChild( saveButton ); content.appendChild( actions ); cancel.addEventListener( 'click', cancelEdit ); saveButton.addEventListener( 'click', saveEdit );
		}
		function closePanel() { stopPreview(); panel.hidden = true; shade.hidden = true; document.documentElement.classList.remove( 'sml-lpe-open' ); var entry = document.querySelector( '.sip-live-open' ); if ( entry ) { entry.focus( { preventScroll: true } ); } }
		function cancelEdit() { if ( saveButton && saveButton.disabled ) { return; } stopPreview(); applyImmersive( initialIm ); if ( fontsDirty ) { restoreFonts(); fontsDirty = false; } var frame = document.getElementById( 'sml-profile-music-player' ); if ( frame && originalFrameSrc ) { frame.src = originalFrameSrc; } if ( originalMedia ) { root.style.cssText = originalMedia.rootStyle; var banner = root.querySelector( '.sip-banner' ); if ( banner ) { banner.style.cssText = originalMedia.bannerStyle; } } root.querySelectorAll( '.sml-lpe-media-preview,.sml-lpe-bg-preview' ).forEach( function ( x ) { x.remove(); } ); mediaObjects.forEach( function ( x ) { URL.revokeObjectURL( x ); } ); mediaObjects = []; pendingMedia = { background: null, banner: null }; draft = JSON.parse( JSON.stringify( initialIm ) ); closePanel(); }
		function saveEdit() {
			if ( saveButton.disabled ) { return; } stopPreview(); saveButton.disabled = true; saveButton.textContent = 'Uploading and saving…'; draft = currentDraft(); applyImmersive( draft ); setStatus( 'Preparing your profile changes…' ); var tracks = [];
			for ( var i = 0; i < 5; i++ ) { var url = content.querySelector( '[name=track_' + i + ']' ).value.trim(); if ( url ) { if ( ! ytId( url ) ) { setStatus( 'Track ' + ( i + 1 ) + ' is not a valid YouTube URL.' ); saveButton.disabled = false; saveButton.textContent = 'Save profile'; return; } tracks.push( { title: ( identity.music_playlist && identity.music_playlist[i] && identity.music_playlist[i].title ) || ( 'Track ' + ( i + 1 ) ), url: url } ); } }
			var memberPayload = Object.assign( {}, identity, { music_playlist: tracks, music_url: tracks[0] ? tracks[0].url : '', music_autoplay: content.querySelector( '[name=autoplay]' ).checked } ); delete memberPayload.handle; delete memberPayload.public_handle; var settings = Object.assign( {}, cfg.settings || {} ); settings.immersive_profile = draft; var app = settings._appearance = Object.assign( {}, appearance ); app.background_size = content.querySelector( '[name=background_fit]' ).value; app.background_opacity = parseFloat( content.querySelector( '[name=background_opacity]' ).value ); app.banner_fit = content.querySelector( '[name=banner_fit]' ).value; app.banner_opacity = parseFloat( content.querySelector( '[name=banner_opacity]' ).value );
			// Explicit picks only take effect under the "custom" preset; an untouched profile keeps whatever preset it had.
			if ( fontsDirty && fontRoles ) { app.font_preset = 'custom'; app.font_heading = fontRoles.heading; app.font_body = fontRoles.body; app.font_accent = fontRoles.accent; }
			function uploadKind( kind ) { var file = pendingMedia[kind]; if ( ! file ) { return Promise.resolve( null ); } var video = /^video\//.test( file.type ), label = kind === 'background' ? 'background' : 'banner'; setStatus( 'Uploading ' + label + '… 0%' ); return uploadFile( file, kind === 'background' ? ( video ? 'background_video' : 'background' ) : ( video ? 'banner_video' : 'banner' ), function ( percent ) { setStatus( 'Uploading ' + label + '… ' + percent + '%' ); } ); }
			uploadKind( 'background' ).then( function ( backgroundUpload ) { return uploadKind( 'banner' ).then( function ( bannerUpload ) { return [ backgroundUpload, bannerUpload ]; } ); } ).then( function ( uploaded ) { setStatus( 'Applying your new profile…' ); var customPayload = { settings: settings }; if ( uploaded[0] ) { customPayload.background_id = uploaded[0].id; app.background_mode = /^video\//.test( pendingMedia.background.type ) ? 'video' : ( /gif$/i.test( pendingMedia.background.type ) ? 'gif' : 'image' ); } if ( uploaded[1] ) { customPayload.banner_id = uploaded[1].id; app.banner_mode = /^video\//.test( pendingMedia.banner.type ) ? 'video' : ( /gif$/i.test( pendingMedia.banner.type ) ? 'gif' : 'image' ); } return Promise.all( [ request( cfg.membersRest, { method: 'POST', body: memberPayload } ), request( cfg.customRest, { method: 'POST', body: customPayload } ) ] ); } ).then( function ( values ) { identity = values[0] || memberPayload; initialIm = JSON.parse( JSON.stringify( draft ) ); cfg.settings = settings; cfg.immersive = im = JSON.parse( JSON.stringify( draft ) ); appearance = Object.assign( {}, settings._appearance ); pendingMedia = { background: null, banner: null }; if ( window.SMLImmersiveColors ) { window.SMLImmersiveColors.apply( { accent: colors.accent_color, text: colors.text_color, cardBg: colors.card_bg_color }, { store: true } ); } fontsDirty = false; setStatus( 'Saved. This is now your public profile.' ); saveButton.textContent = 'Saved'; setTimeout( function () { closePanel(); if ( window.SML_PROFILE_STUDIO ) { var refreshed = window.SML_PROFILE_STUDIO.refresh(); if ( refreshed && refreshed.then ) { refreshed.then( function () { if ( fontRoles ) { applyFonts( fontRoles ); } applyColors(); } ); } } }, 900 ); } ).catch( function ( error ) { setStatus( 'Could not save: ' + error.message ); saveButton.disabled = false; saveButton.textContent = 'Try Save again'; } );
		}
		function launch() { window.dispatchEvent( new Event( 'sml-live-preview-start' ) ); open.disabled = true; request( cfg.membersRest ).then( function ( profile ) { identity = profile || {}; root = document.querySelector( '.sip-root' ); im = cfg.immersive || im; appearance = Object.assign( {}, ( cfg.settings && cfg.settings._appearance ) || {} ); initialIm = JSON.parse( JSON.stringify( im ) ); draft = JSON.parse( JSON.stringify( im ) ); var frame = document.getElementById( 'sml-profile-music-player' ), banner = root.querySelector( '.sip-banner' ); originalFrameSrc = frame ? frame.src : ''; originalMedia = { rootStyle: root.style.cssText, bannerStyle: banner ? banner.style.cssText : '' }; build(); syncPanelTop(); panel.hidden = false; shade.hidden = true; document.documentElement.classList.add( 'sml-lpe-open' ); close.focus( { preventScroll: true } ); } ).catch( function ( error ) { alert( error.message ); } ).finally( function () { open.disabled = false; } ); }
		document.addEventListener( 'keydown', function ( event ) { if ( event.key === 'Escape' && ! panel.hidden ) { cancelEdit(); } } );
		open.addEventListener( 'click', launch ); close.addEventListener( 'click', cancelEdit ); shade.addEventListener( 'click', cancelEdit );
	}
	function ready() {
		if ( ! document.querySelector( '.sip-root' ) ) { return false; }
		// Immersive Profile is the one public profile view. The old overlay exit
		// exposed the hidden classic renderer and made the page look like it had
		// two competing profile products.
		document.querySelectorAll( '.sip-exit' ).forEach( function ( button ) { button.remove(); } );
		document.querySelectorAll( '.sip-edit-toggle' ).forEach( function ( button ) { button.style.setProperty( 'display', 'none', 'important' ); button.setAttribute( 'aria-hidden', 'true' ); button.tabIndex = -1; } );
		if ( ! document.getElementById( 'sml-immersive-component-css' ) ) {
			var componentStyle = node( 'style' ); componentStyle.id = 'sml-immersive-component-css'; componentStyle.textContent = '.sip-root [data-sml-imm-off]{--kick:0!important;--bass:0!important;--mid:0!important;--high:0!important;--bkick:0!important;animation:none!important;filter:none!important}.sip-root[data-sml-imm-banner="0"] .sip-banner,.sip-root[data-sml-imm-avatar="0"] .sip-avatar,.sip-root[data-sml-imm-cards="0"] .sip-card,.sip-root[data-sml-imm-orbital-photos="0"] .sip-pstage,.sip-root[data-sml-imm-orbital-videos="0"] .sip-vstage{--kick:0!important;--bass:0!important;--mid:0!important;--high:0!important;--bkick:0!important;animation:none!important;filter:none!important}.sip-root[data-sml-imm-background="0"]>.sip-fx{opacity:0!important}'; document.head.appendChild( componentStyle );
		}
		applyImmersive( im );
		mountOwnerStudio();
		return true;
	}
	if ( document.readyState === 'loading' ) { document.addEventListener( 'DOMContentLoaded', ready ); } else { ready(); }
	if ( ! ready() ) { var observer = new MutationObserver( function () { if ( ready() ) { observer.disconnect(); } } ); observer.observe( document.documentElement, { childList: true, subtree: true } ); }
}() );
