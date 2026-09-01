'use strict';

const { fetchPublicBuffer } = require('./safe-fetch');

function basicAuth(username, appPassword) {
  return `Basic ${Buffer.from(`${username}:${appPassword}`, 'utf8').toString('base64')}`;
}

function extensionFor(contentType) {
  return ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp'
  })[contentType] || null;
}

function createWordPressPublisher(config, options = {}) {
  const siteUrl = String(config.wordpressUrl || '').replace(/\/$/, '');
  const auth = basicAuth(config.wordpressUsername, config.wordpressAppPassword);
  const fetchImpl = options.fetchImpl || fetch;
  const mediaFetcher = options.mediaFetcher || fetchPublicBuffer;
  let verifiedIdentity = null;
  let resolvedEditorialAuthors = null;

  async function requestUrl(url, init = {}) {
    const response = await fetchImpl(url, {
      ...init,
      headers: { accept: 'application/json', authorization: auth, ...(init.headers || {}) },
      signal: init.signal || AbortSignal.timeout(30_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`WordPress request failed with HTTP ${response.status}`);
      error.code = payload.code === 'sml_duplicate_article' ? 'wordpress_duplicate' : 'wordpress_request_failed';
      error.statusCode = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function request(path, init = {}) {
    return requestUrl(`${siteUrl}/wp-json/wp/v2${path}`, init);
  }

  async function verifyIdentity() {
    if (verifiedIdentity) return verifiedIdentity;
    const me = await request('/users/me?context=edit');
    const expectedSlug = String(config.wordpressAuthorSlug || 'stockmarketloop').toLowerCase();
    const expectedName = String(config.wordpressAuthorName || 'SML NEWS').toLowerCase();
    if (String(me.slug || '').toLowerCase() !== expectedSlug || String(me.name || '').trim().toLowerCase() !== expectedName) {
      const error = new Error('WordPress credentials do not belong to the required SML NEWS account');
      error.code = 'wordpress_author_mismatch';
      throw error;
    }
    verifiedIdentity = { id: me.id, slug: me.slug, name: me.name };
    return verifiedIdentity;
  }

  async function findExisting(slug) {
    const posts = await request(`/posts?context=edit&slug=${encodeURIComponent(slug)}&status=publish,draft,pending,private&per_page=1`);
    return Array.isArray(posts) && posts.length ? posts[0] : null;
  }

  async function authorFor(article) {
    const desk = String(article.editorial_desk || 'sml-news');
    if (desk === 'sml-news') return (await verifyIdentity()).id;
    if (!resolvedEditorialAuthors) {
      resolvedEditorialAuthors = config.wordpressEditorialAuthors || {};
      if (!Number(resolvedEditorialAuthors[desk])) {
        const response = await requestUrl(`${siteUrl}/wp-json/sml-newsroom/v1/authors`);
        resolvedEditorialAuthors = response && response.authors || {};
      }
    }
    const id = Number(resolvedEditorialAuthors[desk]);
    if (!Number.isInteger(id) || id < 1) {
      const error = new Error(`WordPress author is not configured for editorial desk ${desk}`);
      error.code = 'wordpress_author_not_configured';
      throw error;
    }
    return id;
  }

  async function uploadFeaturedImage(imageUrl, article) {
    if (!imageUrl) return null;
    const image = await mediaFetcher(imageUrl, {
      accept: 'image/jpeg,image/png,image/gif,image/webp',
      maxBytes: 15 * 1024 * 1024,
      timeoutMs: 20_000
    });
    const ext = extensionFor(image.contentType);
    if (!ext) {
      const error = new Error('source image type is not supported');
      error.code = 'unsupported_source_image';
      throw error;
    }
    const filename = `${article.slug}.${ext}`;
    const media = await request('/media', {
      method: 'POST',
      headers: {
        'content-type': image.contentType,
        'content-disposition': `attachment; filename="${filename}"`
      },
      body: image.body,
      signal: AbortSignal.timeout(45_000)
    });
    await request(`/media/${media.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: article.image_title,
        alt_text: article.image_alt,
        caption: article.image_caption,
        description: article.image_description
      })
    });
    return media;
  }

  async function publish({ article, sourceUrl, sourceUrlHash, mediaId = null }) {
    await verifyIdentity(); // The publishing service account itself must still be the approved account.
    const authorId = await authorFor(article);
    const existing = await findExisting(article.slug);
    if (existing) return { duplicate: true, post: existing };
    const meta = {
      _sml_pipeline_version: 'render-v1',
      _sml_source_url_hash: sourceUrlHash,
      _sml_source_url: sourceUrl,
      _sml_subtitle: article.subtitle,
      _sml_editorial_desk: article.editorial_desk || 'sml-news',
      _sml_content_kind: article.content_kind || 'article',
      _sml_topic_signature: article.topic_signature || '',
      rank_math_title: article.title,
      rank_math_description: article.meta_description,
      rank_math_focus_keyword: article.focus_keyword
    };
    const payload = {
      editorial_desk: article.editorial_desk || 'sml-news',
      content_kind: article.content_kind || 'article',
      topic_signature: article.topic_signature || '',
      title: article.title,
      excerpt: article.excerpt,
      slug: article.slug,
      content: article.body_html,
      featured_media: mediaId || 0,
      meta
    };
    const post = article.editorial_desk && article.editorial_desk !== 'sml-news'
      ? await requestUrl(`${siteUrl}/wp-json/sml-newsroom/v1/publish`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(45_000)
      })
      : await request('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'publish',
        author: authorId,
        title: article.title,
        excerpt: article.excerpt,
        slug: article.slug,
        content: article.body_html,
        featured_media: mediaId || 0,
        meta
      }),
      signal: AbortSignal.timeout(45_000)
    });
    return { duplicate: false, post };
  }

  return { authorFor, findExisting, publish, uploadFeaturedImage, verifyIdentity };
}

module.exports = { basicAuth, createWordPressPublisher, extensionFor };
