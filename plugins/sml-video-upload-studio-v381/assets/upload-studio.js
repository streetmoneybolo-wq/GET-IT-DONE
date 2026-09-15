(function () {
  'use strict';

  function readConfigFromScripts() {
    var scripts = Array.prototype.slice.call(document.scripts || []);
    for (var i = 0; i < scripts.length; i += 1) {
      var text = String(scripts[i].textContent || '');
      if (text.indexOf('smlVideoUploadStudioConfig') === -1) {
        continue;
      }
      var match = text.match(/smlVideoUploadStudioConfig\s*=\s*(\{[\s\S]*?\});/);
      if (!match || !match[1]) {
        continue;
      }
      try {
        return JSON.parse(match[1]);
      } catch (error) {
        continue;
      }
    }
    return {};
  }

  var cfg = window.smlVideoUploadStudioConfig || readConfigFromScripts() || {};
  var root = null;
  var booted = false;

  function resolveRoot() {
    return document.getElementById('sml-upload-studio-app');
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[character];
    });
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'stockmarketloop-video';
  }

  function tokenList(value, keepHashes) {
    return String(value || '')
      .split(/[,\n\r\t ]+/)
      .map(function (item) { return item.trim(); })
      .filter(Boolean)
      .map(function (item) {
        if (keepHashes) {
          return item.charAt(0) === '#' ? item : ('#' + item.replace(/^#+/, ''));
        }
        return item.replace(/^#+/, '');
      });
  }

  function cashtag(value) {
    var cleaned = String(value || '').trim().replace(/^\$/, '').toUpperCase();
    return cleaned ? ('$' + cleaned) : '';
  }

  function stateKey() {
    return 'smlUploadStudioDraftV1';
  }

  function nextSchedule() {
    var now = new Date(Date.now() + 60 * 60 * 1000);
    now.setMinutes(0, 0, 0);
    return {
      date: now.toISOString().slice(0, 10),
      time: String(now.getHours()).padStart(2, '0') + ':00'
    };
  }

  function defaultDraft() {
    var schedule = nextSchedule();
    return {
      step: 0,
      title: '',
      description: '',
      ticker: '',
      category: 'Stock Market News',
      tags: '',
      hashtags: '#StockMarketLoop',
      audience: 'Not made for kids',
      visibility: 'public',
      embeddingAllowed: true,
      commentsAllowed: true,
      publishDate: schedule.date,
      publishTime: schedule.time,
      seoTitle: '',
      canonicalUrl: '',
      watchUrlPreview: '',
      file: null,
      filePreviewName: '',
      filePreviewSize: '',
      thumbFile: null,
      thumbUrl: cfg.defaultThumbnail || '',
      upload: null,
      publishedWatchUrl: ''
    };
  }

  function safeParse(raw) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  var draft = safeParse(localStorage.getItem(stateKey())) || defaultDraft();
  if (draft && typeof draft === 'object') {
    if (typeof Blob === 'undefined' || !(draft.file instanceof Blob)) {
      draft.file = null;
    }
    if (typeof Blob === 'undefined' || !(draft.thumbFile instanceof Blob)) {
      draft.thumbFile = null;
    }
  }
  var publishing = false;

  function normalizeDraft() {
    if (!draft || typeof draft !== 'object') {
      draft = defaultDraft();
    }
    if (!draft.visibility) {
      draft.visibility = 'public';
    }
    if (!draft.category) {
      draft.category = 'Stock Market News';
    }
    if (!draft.audience) {
      draft.audience = 'Not made for kids';
    }
    if (typeof draft.embeddingAllowed !== 'boolean') {
      draft.embeddingAllowed = true;
    }
    if (typeof draft.commentsAllowed !== 'boolean') {
      draft.commentsAllowed = true;
    }
    if (!draft.thumbUrl && cfg.defaultThumbnail) {
      draft.thumbUrl = cfg.defaultThumbnail;
    }
    if (!draft.publishDate || !draft.publishTime) {
      var schedule = nextSchedule();
      draft.publishDate = draft.publishDate || schedule.date;
      draft.publishTime = draft.publishTime || schedule.time;
    }
  }

  function saveDraft() {
    normalizeDraft();
    var copy = {};
    for (var key in draft) {
      if (Object.prototype.hasOwnProperty.call(draft, key) && key !== 'file' && key !== 'thumbFile') {
        copy[key] = draft[key];
      }
    }
    try {
      localStorage.setItem(stateKey(), JSON.stringify(copy));
    } catch (error) {
      /* storage unavailable - the draft still works in memory */
    }
  }

  function watchPreviewUrl() {
    if (draft.publishedWatchUrl) {
      return draft.publishedWatchUrl;
    }
    if (draft.watchUrlPreview) {
      return draft.watchUrlPreview;
    }
    var titleSlug = slugify(draft.title || draft.filePreviewName || draft.ticker || 'stockmarketloop-video');
    return String(cfg.watchBaseUrl || '/watch/') + titleSlug + '/';
  }

  function metadataOutputs() {
    var title = String(draft.title || '').trim() || 'StockMarketLoop video';
    var tickerTag = cashtag(draft.ticker);
    var watchUrl = watchPreviewUrl();
    var seoTitle = String(draft.seoTitle || '').trim() || (tickerTag ? (tickerTag + ' ' + title) : title);
    var thumb = draft.thumbUrl || cfg.defaultThumbnail || '';
    var description = String(draft.description || '').trim();
    var metaDescription = description.slice(0, 180);
    var hashtags = tokenList(draft.hashtags, true).slice(0, 5);
    var tags = tokenList(draft.tags, false).slice(0, 12);
    var searchPreview = seoTitle + '\n' + watchUrl + '\n' + metaDescription;
    var jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: seoTitle,
      description: metaDescription || 'Uploaded video on StockMarketLoop.',
      thumbnailUrl: thumb ? [thumb] : [],
      uploadDate: new Date().toISOString(),
      embedUrl: watchUrl + '?embed=1',
      contentUrl: watchUrl,
      genre: draft.category || 'Stock Market News',
      keywords: tags.concat(hashtags).join(', ')
    };
    return {
      title: title,
      seoTitle: seoTitle,
      tickerTag: tickerTag,
      watchUrl: watchUrl,
      hashtags: hashtags,
      tags: tags,
      metaDescription: metaDescription,
      searchPreview: searchPreview,
      videoJsonLd: JSON.stringify(jsonLd, null, 2),
      sitemapLine: '<loc>' + watchUrl + '</loc>',
      embedCode: '<iframe src="' + watchUrl + '?embed=1" width="960" height="540" allowfullscreen></iframe>'
    };
  }

  function errors() {
    var out = [];
    if (!draft.filePreviewName && !draft.upload) {
      out.push('Choose a video file first.');
    }
    if (!String(draft.title || '').trim()) {
      out.push('Add a title before publishing.');
    }
    if (String(draft.title || '').length > 100) {
      out.push('Titles must stay under 100 characters.');
    }
    if (!String(draft.description || '').trim()) {
      out.push('Add a description so the watch page and search previews are not empty.');
    }
    if (String(draft.description || '').length > 5000) {
      out.push('Descriptions must stay under 5,000 characters.');
    }
    if (!cashtag(draft.ticker)) {
      out.push('Add a primary ticker so recommendations and internal linking can classify the video.');
    }
    if (tokenList(draft.hashtags, true).length > 5) {
      out.push('Use five hashtags or fewer.');
    }
    if (draft.visibility === 'scheduled' && (!draft.publishDate || !draft.publishTime)) {
      out.push('Scheduled videos need a publish date and time.');
    }
    return out;
  }

  function statusMarkup(tone, text) {
    return '<div class="sml-upload-status" data-tone="' + esc(tone || '') + '">' + esc(text || '') + '</div>';
  }

  function fileSummaryMarkup() {
    if (!draft.filePreviewName && !draft.upload) {
      return '';
    }

    var mime = (draft.upload && draft.upload.mime) || '';
    var label = mime && mime.indexOf('video/') === 0 ? 'Video' : 'Upload';
    return ''
      + '<div class="sml-upload-file-summary">'
      + '  <div class="sml-upload-file-icon">' + esc(label) + '</div>'
      + '  <div>'
      + '    <strong>' + esc(draft.filePreviewName || (draft.upload && draft.upload.name) || 'Selected video') + '</strong>'
      + '    <span>' + esc(draft.filePreviewSize || 'Ready to upload') + '</span>'
      + '    <small>The publish step will create the Chart post, watch page, and recommendation-ready video record.</small>'
      + '  </div>'
      + '</div>';
  }

  function thumbPreviewMarkup() {
    var src = draft.thumbUrl || cfg.defaultThumbnail || '';
    return ''
      + '<div class="sml-upload-thumb-preview">'
      + (src ? '<img src="' + esc(src) + '" alt="Thumbnail preview">' : '<div class="sml-upload-empty">Upload a 16:9 image</div>')
      + '</div>';
  }

  function stepMarkup() {
    var data = metadataOutputs();
    switch (draft.step) {
      case 0:
        return ''
          + '<div class="sml-upload-grid">'
          + '  <section class="sml-upload-drop">'
          + '    <strong>Choose the video file first</strong>'
          + '    <p>This uploader keeps the flow similar to a creator platform: file first, then title, ticker, thumbnail, search metadata, visibility, and publish.</p>'
          + '    <button type="button" data-upload-pick>Choose video</button>'
          + '    <input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-m4v" data-upload-file>'
          + fileSummaryMarkup()
          + '  </section>'
          + '</div>';
      case 1:
        return ''
          + '<div class="sml-upload-grid">'
          + '  <div class="sml-upload-grid-2">'
          + '    <div class="sml-upload-field"><label>Title</label><input type="text" maxlength="100" data-field="title" value="' + esc(draft.title) + '"><small>Keep it sharp and market-specific.</small></div>'
          + '    <div class="sml-upload-field"><label>Ticker focus</label><input type="text" data-field="ticker" value="' + esc(draft.ticker) + '" placeholder="NVDA"><small>This becomes a cashtag on the watch page and helps recommendations.</small></div>'
          + '  </div>'
          + '  <div class="sml-upload-field"><label>Description</label><textarea data-field="description" maxlength="5000" placeholder="Explain the setup, catalyst, targets, risks, or market context.">' + esc(draft.description) + '</textarea><small>The first two lines do most of the work for SEO, previews, and recommendations.</small></div>'
          + '  <div class="sml-upload-grid-2">'
          + '    <div class="sml-upload-field"><label>Category</label><select data-field="category"><option' + (draft.category === 'Stock Market News' ? ' selected' : '') + '>Stock Market News</option><option' + (draft.category === 'Live Trading' ? ' selected' : '') + '>Live Trading</option><option' + (draft.category === 'Education' ? ' selected' : '') + '>Education</option><option' + (draft.category === 'Options' ? ' selected' : '') + '>Options</option><option' + (draft.category === 'Crypto' ? ' selected' : '') + '>Crypto</option><option' + (draft.category === 'AI Stocks' ? ' selected' : '') + '>AI Stocks</option></select></div>'
          + '    <div class="sml-upload-field"><label>Audience</label><select data-field="audience"><option' + (draft.audience === 'Not made for kids' ? ' selected' : '') + '>Not made for kids</option><option' + (draft.audience === 'Made for kids' ? ' selected' : '') + '>Made for kids</option></select></div>'
          + '  </div>'
          + '  <div class="sml-upload-thumb-row">'
          + thumbPreviewMarkup()
          + '    <div class="sml-upload-grid">'
          + '      <div class="sml-upload-field"><label>Thumbnail</label><button type="button" class="sml-upload-thumb-button" data-thumb-pick>Upload thumbnail</button><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-thumb-file hidden><small>Use a 16:9 image so the watch page, search cards, and shares stay clean.</small></div>'
          + '      <div class="sml-upload-field"><label>Tags</label><input type="text" data-field="tags" value="' + esc(draft.tags) + '" placeholder="nvidia stock, earnings, ai chip stocks"><small>Tags help with aliases, misspellings, and topic clustering.</small></div>'
          + '      <div class="sml-upload-field"><label>Hashtags</label><input type="text" data-field="hashtags" value="' + esc(draft.hashtags) + '" placeholder="#NVDA #StockMarketLoop"><small>Use 2 to 4 focused hashtags.</small></div>'
          + '    </div>'
          + '  </div>'
          + '</div>';
      case 2:
        return ''
          + '<div class="sml-upload-grid">'
          + '  <div class="sml-upload-field"><label>SEO title</label><input type="text" maxlength="110" data-field="seoTitle" value="' + esc(draft.seoTitle) + '" placeholder="' + esc(data.seoTitle) + '"><small>Leave blank to auto-generate from the title and ticker.</small></div>'
          + '  <div class="sml-upload-field"><label>Canonical URL</label><input type="text" data-field="canonicalUrl" value="' + esc(draft.canonicalUrl) + '" placeholder="' + esc(data.watchUrl) + '"><small>The final watch page URL is set on publish. This preview helps you shape the share copy now.</small></div>'
          + '  <div class="sml-upload-card">'
          + '    <div class="sml-upload-code-head"><strong>Search preview</strong></div>'
          + '    <div class="sml-upload-body"><div class="sml-upload-preview-snippet">' + esc(data.searchPreview) + '</div></div>'
          + '  </div>'
          + codeBlock('VideoObject JSON-LD', data.videoJsonLd)
          + codeBlock('Sitemap line', data.sitemapLine)
          + codeBlock('Embed code', data.embedCode)
          + '</div>';
      case 3:
      default:
        return ''
          + '<div class="sml-upload-grid">'
          + '  <div class="sml-upload-grid-2">'
          + '    <div class="sml-upload-field"><label>Visibility</label><select data-field="visibility"><option value="public"' + (draft.visibility === 'public' ? ' selected' : '') + '>Public</option><option value="unlisted"' + (draft.visibility === 'unlisted' ? ' selected' : '') + '>Unlisted</option><option value="private"' + (draft.visibility === 'private' ? ' selected' : '') + '>Private</option><option value="scheduled"' + (draft.visibility === 'scheduled' ? ' selected' : '') + '>Scheduled</option></select></div>'
          + '    <div class="sml-upload-field"><label>Watch page preview URL</label><input type="text" readonly value="' + esc(data.watchUrl) + '"><small>This becomes the real watch page after publish.</small></div>'
          + '  </div>'
          + (draft.visibility === 'scheduled'
            ? '<div class="sml-upload-grid-2"><div class="sml-upload-field"><label>Publish date</label><input type="date" data-field="publishDate" value="' + esc(draft.publishDate) + '"></div><div class="sml-upload-field"><label>Publish time</label><input type="time" data-field="publishTime" value="' + esc(draft.publishTime) + '"></div></div>'
            : '')
          + '  <div class="sml-upload-toggle-grid">'
          + '    <div class="sml-upload-toggle"><label><input type="checkbox" data-check="embeddingAllowed"' + (draft.embeddingAllowed ? ' checked' : '') + '> Allow embedding</label><p>Helps creators and sites reuse the watch page player cleanly.</p></div>'
          + '    <div class="sml-upload-toggle"><label><input type="checkbox" data-check="commentsAllowed"' + (draft.commentsAllowed ? ' checked' : '') + '> Allow comments</label><p>Comments help engagement and recommendation quality.</p></div>'
          + '  </div>'
          + '  <button type="button" class="sml-upload-review-publish" data-publish>Publish video</button>'
          + '</div>';
    }
  }

  function codeBlock(title, value) {
    return ''
      + '<div class="sml-upload-code">'
      + '  <div class="sml-upload-code-head"><strong>' + esc(title) + '</strong><button type="button" data-copy="' + esc(value) + '">Copy</button></div>'
      + '  <pre>' + esc(value) + '</pre>'
      + '</div>';
  }

  function previewMarkup() {
    var outputs = metadataOutputs();
    return ''
      + '<article class="sml-upload-preview-card">'
      + '  <div class="sml-upload-preview-media">' + ((draft.thumbUrl || cfg.defaultThumbnail) ? '<img src="' + esc(draft.thumbUrl || cfg.defaultThumbnail) + '" alt="Watch page preview">' : '') + '</div>'
      + '  <div class="sml-upload-preview-body">'
      + '    <strong>' + esc(outputs.seoTitle) + '</strong>'
      + '    <div class="sml-upload-preview-meta">' + esc(outputs.watchUrl) + '</div>'
      + '    <div class="sml-upload-preview-snippet">' + esc(outputs.metaDescription || 'Add a title and description to see how the preview will look.') + '</div>'
      + '    <div class="sml-upload-chip-row">'
      + (outputs.tickerTag ? '<span class="sml-upload-chip">' + esc(outputs.tickerTag) + '</span>' : '')
      + outputs.hashtags.map(function (tag) { return '<span class="sml-upload-chip">' + esc(tag) + '</span>'; }).join('')
      + '    </div>'
      + '  </div>'
      + '</article>';
  }

  function sideMarkup() {
    var outputs = metadataOutputs();
    return ''
      + '<div class="sml-upload-card">'
      + '  <h2>Watch page preview</h2>'
      + '  <p>This is the metadata package your watch page, shares, and recommendation engine will use after publish.</p>'
      + previewMarkup()
      + '</div>'
      + '<div class="sml-upload-card">'
      + '  <h3>Recommendation signals</h3>'
      + '  <p><strong>Ticker:</strong> ' + esc(outputs.tickerTag || 'Missing') + '</p>'
      + '  <p><strong>Category:</strong> ' + esc(draft.category || 'Missing') + '</p>'
      + '  <p><strong>Hashtags:</strong> ' + esc(outputs.hashtags.join(' ') || 'Missing') + '</p>'
      + '  <p><strong>Visibility:</strong> ' + esc((draft.visibility || 'public').replace(/^./, function (letter) { return letter.toUpperCase(); })) + '</p>'
      + '</div>'
      + '<div class="sml-upload-card">'
      + '  <h3>Why this page matters</h3>'
      + '  <p>The old route was dead. This upload studio now gathers the metadata the StockMarketLoop watch pages, search previews, and video recommendation service actually need.</p>'
      + '</div>';
  }

  function loggedOutMarkup() {
    return ''
      + '<div class="sml-upload-card sml-upload-login">'
      + '  <h2>Sign in to upload</h2>'
      + '  <p>Creators need to be signed in before they can upload a video, attach the right title and ticker metadata, and generate a watch page that can actually be crawled.</p>'
      + '  <a class="sml-upload-primary" href="' + esc(cfg.loginUrl || '/wp-login.php') + '">Sign in</a>'
      + '</div>';
  }

  function renderStatus() {
    if (publishing) {
      return statusMarkup('warn', 'Publishing video, creating the Chart post, and generating the watch page...');
    }
    var issues = errors();
    if (!issues.length) {
      return statusMarkup('good', 'Metadata looks healthy. This upload is ready to publish into the watch-page system.');
    }
    return statusMarkup('warn', issues[0]);
  }

  function render() {
    normalizeDraft();

    if (!cfg.loggedIn) {
      root.innerHTML = loggedOutMarkup();
      return;
    }

    var issues = errors();
    root.innerHTML = ''
      + '<div class="sml-upload-shell">'
      + '  <section class="sml-upload-main">'
      + '    <article class="sml-upload-card">'
      + '      <div class="sml-upload-stepper">'
      + stepButton(0, 'File', 'Choose and stage the video')
      + stepButton(1, 'Details', 'Title, ticker, description, thumbnail')
      + stepButton(2, 'SEO & indexing', 'Search preview, structured data, watch URL')
      + stepButton(3, 'Visibility', 'Public, unlisted, private, scheduled')
      + '      </div>'
      + '      <div class="sml-upload-body">'
      + stepMarkup()
      + (issues.length ? '<div class="sml-upload-errors">' + issues.map(function (issue) { return '<span>' + esc(issue) + '</span>'; }).join('') + '</div>' : '')
      + '      </div>'
      + '      <div class="sml-upload-footer">'
      +            renderStatus()
      + '        <div class="sml-upload-footer-actions">'
      + '          <button type="button" data-quiet="1" data-action="back">Back</button>'
      + '          <button type="button" data-quiet="1" data-action="save">Save draft</button>'
      + '          <button type="button" data-action="next">' + esc(draft.step < 3 ? 'Next' : 'Review') + '</button>'
      + '        </div>'
      + '      </div>'
      + '    </article>'
      + '  </section>'
      + '  <aside class="sml-upload-side">'
      + sideMarkup()
      + '  </aside>'
      + '</div>';
  }

  function stepButton(index, title, text) {
    return ''
      + '<button type="button" class="sml-upload-step" data-step="' + index + '" data-active="' + (draft.step === index ? '1' : '0') + '">'
      + '  <b>' + esc(title) + '</b>'
      + '  <span>' + esc(text) + '</span>'
      + '</button>';
  }

  function humanSize(bytes) {
    var size = Number(bytes || 0);
    if (!size) {
      return '';
    }
    if (size >= 1024 * 1024 * 1024) {
      return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }
    if (size >= 1024 * 1024) {
      return (size / (1024 * 1024)).toFixed(1) + ' MB';
    }
    return Math.round(size / 1024) + ' KB';
  }

  function uploadAsset(endpoint, kind, file) {
    var normalizedKind = kind === 'thumbnail' ? 'photo' : kind;
    var form = new FormData();
    form.append('kind', normalizedKind);
    form.append('media', file, file.name);
    function send(url) {
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
          'X-WP-Nonce': cfg.nonce || ''
        },
        body: form
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          if (!response.ok) {
            var error = new Error(payload.message || 'Upload failed.');
            error.code = payload.code || '';
            error.status = response.status;
            throw error;
          }
          return payload;
        });
      });
    }
    var primary = cfg.pluginUploadEndpoint || endpoint;
    var backup = primary === endpoint ? '' : endpoint;
    return send(primary).catch(function (error) {
      if (backup) {
        return send(backup);
      }
      throw error;
    });
  }

  function publishViaPlugin(uploaded) {
    var outputs = metadataOutputs();
    return fetch(cfg.pluginPublishEndpoint, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-WP-Nonce': cfg.nonce || ''
      },
      body: JSON.stringify({
        title: draft.title || uploaded.videoUpload.title || draft.filePreviewName || 'StockMarketLoop video',
        seo_title: outputs.seoTitle || draft.title || '',
        description: draft.description || '',
        ticker: String(draft.ticker || '').replace(/^\$/, ''),
        visibility: draft.visibility || 'public',
        video_url: uploaded.videoUpload.url,
        video_name: uploaded.videoUpload.name || draft.filePreviewName || '',
        video_mime: uploaded.videoUpload.mime || '',
        thumbnail_url: (uploaded.thumbUpload && uploaded.thumbUpload.url) || draft.thumbUrl || '',
        tags: outputs.tags || [],
        hashtags: outputs.hashtags || []
      })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          throw new Error(payload.message || 'Publish failed.');
        }
        return payload;
      });
    });
  }

  function publishPayload(videoUpload, thumbUpload) {
    var outputs = metadataOutputs();
    var tickerTag = outputs.tickerTag;
    var textParts = [];
    if (draft.title) {
      textParts.push(draft.title);
    }
    if (draft.description) {
      textParts.push(draft.description);
    }
    if (tickerTag) {
      textParts.push(tickerTag);
    }
    if (outputs.hashtags.length) {
      textParts.push(outputs.hashtags.join(' '));
    }

    var media = {
      url: videoUpload.url,
      type: 'video',
      name: draft.title || videoUpload.title || draft.filePreviewName,
      mime: videoUpload.mime,
      title: draft.title || videoUpload.title || draft.filePreviewName,
      description: draft.description || '',
      visibility: draft.visibility === 'scheduled' ? 'public' : draft.visibility,
      thumbnail_url: (thumbUpload && thumbUpload.url) || draft.thumbUrl || '',
      watch_url: draft.publishedWatchUrl || '',
      uploadWizardComplete: true
    };

    return {
      user_id: cfg.userId,
      text: textParts.filter(Boolean).join('\n\n'),
      media: media
    };
  }

  function publishVideo() {
    if (publishing) {
      return;
    }

    var issues = errors();
    var hasUsableFile = (typeof Blob !== 'undefined') && (draft.file instanceof Blob);
    if (!hasUsableFile) {
      issues.push('Re-select your video file, then press Publish video again. The file is cleared whenever the page reloads.');
    }

    if (issues.length) {
      render();
      window.alert(issues[0]);
      return;
    }

    publishing = true;
    render();

    Promise.resolve()
      .then(function () {
        return uploadAsset(cfg.chartMediaEndpoint, 'video', draft.file);
      })
      .then(function (videoUpload) {
        draft.upload = videoUpload;
        if (draft.thumbFile) {
          return uploadAsset(cfg.chartMediaEndpoint, 'thumbnail', draft.thumbFile).then(function (thumbUpload) {
            return { videoUpload: videoUpload, thumbUpload: thumbUpload };
          });
        }
        return { videoUpload: videoUpload, thumbUpload: null };
      })
      .then(function (uploaded) {
        function publishViaMembers() {
          return fetch(cfg.profileChartEndpoint, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'X-WP-Nonce': cfg.nonce || ''
            },
            body: JSON.stringify(publishPayload(uploaded.videoUpload, uploaded.thumbUpload))
          }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (payload) {
              if (!response.ok) {
                var error = new Error(payload.message || 'Publish failed.');
                error.code = payload.code || '';
                error.status = response.status;
                throw error;
              }
              return payload;
            });
          });
        }

        if (cfg.pluginPublishEndpoint) {
          return publishViaPlugin(uploaded).catch(function (error) {
            if (!cfg.profileChartEndpoint) {
              throw error;
            }
            return publishViaMembers();
          });
        }

        return publishViaMembers();
      })
      .then(function (payload) {
        var watchUrl = (payload && payload.watch_url)
          || (payload && payload.video && payload.video.watch_url)
          || (payload && payload.post && payload.post.media && payload.post.media.watch_url)
          || '';
        draft.publishedWatchUrl = watchUrl || '';
        saveDraft();
        if (watchUrl) {
          window.location.href = watchUrl;
          return;
        }
        publishing = false;
        render();
        window.alert('The video uploaded, but no watch page URL came back. Check Creator Studio for the new video.');
      })
      .catch(function (error) {
        publishing = false;
        window.alert(error && error.message ? error.message : 'The video could not be published.');
        render();
      });
  }

  function bind() {
    root.addEventListener('click', function (event) {
      var step = event.target.closest('[data-step]');
      if (step) {
        draft.step = Number(step.getAttribute('data-step') || 0);
        saveDraft();
        render();
        return;
      }

      var action = event.target.closest('[data-action]');
      if (action) {
        var kind = action.getAttribute('data-action');
        if (kind === 'back') {
          draft.step = Math.max(0, draft.step - 1);
        } else if (kind === 'next') {
          draft.step = Math.min(3, draft.step + 1);
        } else if (kind === 'save') {
          saveDraft();
        }
        saveDraft();
        render();
        return;
      }

      if (event.target.closest('[data-upload-pick]')) {
        var fileInput = root.querySelector('[data-upload-file]');
        if (fileInput) {
          fileInput.click();
        }
        return;
      }

      if (event.target.closest('[data-thumb-pick]')) {
        var thumbInput = root.querySelector('[data-thumb-file]');
        if (thumbInput) {
          thumbInput.click();
        }
        return;
      }

      var publish = event.target.closest('[data-publish]');
      if (publish) {
        publishVideo();
        return;
      }

      var copy = event.target.closest('[data-copy]');
      if (copy && navigator.clipboard) {
        navigator.clipboard.writeText(copy.getAttribute('data-copy') || '');
        copy.textContent = 'Copied';
        window.setTimeout(function () {
          copy.textContent = 'Copy';
        }, 1200);
      }
    });

    root.addEventListener('input', function (event) {
      var field = event.target.closest('[data-field]');
      if (field) {
        draft[field.getAttribute('data-field')] = field.value;
        saveDraft();
        return;
      }

      var check = event.target.closest('[data-check]');
      if (check) {
        draft[check.getAttribute('data-check')] = !!check.checked;
        saveDraft();
        return;
      }
    });

    root.addEventListener('change', function (event) {
      var fileInput = event.target.closest('[data-upload-file]');
      if (fileInput && fileInput.files && fileInput.files[0]) {
        var file = fileInput.files[0];
        draft.file = file;
        draft.filePreviewName = file.name;
        draft.filePreviewSize = humanSize(file.size);
        if (!draft.title) {
          draft.title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
        }
        saveDraft();
        render();
        return;
      }

      var thumbInput = event.target.closest('[data-thumb-file]');
      if (thumbInput && thumbInput.files && thumbInput.files[0]) {
        draft.thumbFile = thumbInput.files[0];
        var reader = new FileReader();
        reader.onload = function () {
          draft.thumbUrl = String(reader.result || '');
          saveDraft();
          render();
        };
        reader.readAsDataURL(draft.thumbFile);
        return;
      }

      var field = event.target.closest('[data-field]');
      if (field) {
        draft[field.getAttribute('data-field')] = field.value;
        saveDraft();
        render();
      }
    });
  }

  function boot() {
    if (booted) {
      return true;
    }
    root = resolveRoot();
    if (!root) {
      return false;
    }
    cfg = window.smlVideoUploadStudioConfig || readConfigFromScripts() || cfg || {};
    normalizeDraft();
    bind();
    render();
    booted = true;
    return true;
  }

  if (!boot()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    }
    var bootAttempts = 0;
    var bootTimer = window.setInterval(function () {
      bootAttempts += 1;
      if (boot() || bootAttempts > 20) {
        window.clearInterval(bootTimer);
      }
    }, 250);
  }
})();
