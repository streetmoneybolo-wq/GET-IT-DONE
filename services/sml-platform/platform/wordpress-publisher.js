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

  async function request(path, init = {}) {
    const response = await fetchImpl(`${siteUrl}/wp-json/wp/v2${path}`, {
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
    const identity = await verifyIdentity();
    const existing = await findExisting(article.slug);
    if (existing) return { duplicate: true, post: existing };
    const meta = {
      _sml_pipeline_version: 'render-v1',
      _sml_source_url_hash: sourceUrlHash,
      _sml_source_url: sourceUrl,
      _sml_subtitle: article.subtitle,
      rank_math_title: article.title,
      rank_math_description: article.meta_description,
      rank_math_focus_keyword: article.focus_keyword
    };
    const post = await request('/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'publish',
        author: identity.id,
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

  return { findExisting, publish, uploadFeaturedImage, verifyIdentity };
}

module.exports = { basicAuth, createWordPressPublisher, extensionFor };
