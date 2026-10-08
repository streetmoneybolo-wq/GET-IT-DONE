import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function configuration() {
  const baseUrl = String(process.env.WP_BASE_URL || '').replace(/\/$/, '');
  const username = process.env.WP_USERNAME || '';
  const password = process.env.WP_APP_PASSWORD || '';
  if (!baseUrl || !username || !password) throw new Error('WordPress REST credentials are not configured.');
  return { baseUrl, username, password };
}

function sshConfiguration() {
  return {
    enabled: process.env.WP_SSH_FALLBACK !== 'false',
    ssh: process.env.WP_SSH_BIN || 'ssh',
    scp: process.env.WP_SCP_BIN || 'scp',
    key: process.env.WP_SSH_KEY || 'C:\\Users\\Memob\\.ssh\\id_ed25519_wpcom',
    target: process.env.WP_SSH_TARGET || 'stockmarketloop.wordpress.com@ssh.wp.com',
    root: process.env.WP_SSH_ROOT || '/srv/htdocs',
  };
}

function isChallenge403(error) {
  return Number(error?.status) === 403 && /Checking your browser|Javascript required|cloudflare/i.test(String(error?.bodyText || error?.message || ''));
}

function remoteQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function sshWp(command, { input = null, timeout = 60_000 } = {}) {
  const cfg = sshConfiguration();
  if (!cfg.enabled) throw new Error('WordPress REST is blocked and WP_SSH_FALLBACK is disabled.');
  const remote = `cd ${remoteQuote(cfg.root)} && ${command}`;
  const { stdout } = await execFileAsync(cfg.ssh, ['-i', cfg.key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', cfg.target, remote], {
    windowsHide: true,
    input,
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function withRemoteJson(payload, script, timeout = 60_000) {
  const cfg = sshConfiguration();
  const dir = await mkdtemp(path.join(tmpdir(), 'sml-wp-'));
  const jsonPath = path.join(dir, 'payload.json');
  const scriptPath = path.join(dir, 'script.php');
  const remoteBase = `/tmp/sml-wp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const remoteJson = `${remoteBase}.json`;
  const remoteScript = `${remoteBase}.php`;
  try {
    await writeFile(jsonPath, JSON.stringify(payload), 'utf8');
    await writeFile(scriptPath, script, 'utf8');
    await execFileAsync(cfg.scp, ['-i', cfg.key, '-o', 'BatchMode=yes', jsonPath, `${cfg.target}:${remoteJson}`], { timeout, windowsHide: true });
    await execFileAsync(cfg.scp, ['-i', cfg.key, '-o', 'BatchMode=yes', scriptPath, `${cfg.target}:${remoteScript}`], { timeout, windowsHide: true });
    const stdout = await sshWp(`wp eval-file ${remoteQuote(remoteScript)} ${remoteQuote(remoteJson)}; rm -f ${remoteQuote(remoteJson)} ${remoteQuote(remoteScript)}`, { timeout });
    return parseWpCliJson(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseWpCliJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const candidates = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('{') || line.startsWith('['));
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(candidates[i]);
      } catch {
        // Continue looking for the JSON line after noisy WordPress warnings.
      }
    }
    throw new Error(`WP-CLI did not return parseable JSON: ${text.slice(0, 180)}`);
  }
}

async function wpCliFindPostBySlug(slug) {
  const script = `<?php
$payload_path = $args[0] ?? ($argv[1] ?? null);
if ($payload_path === '--') { $payload_path = $args[1] ?? ($argv[2] ?? null); }
$payload = json_decode(file_get_contents($payload_path), true);
$post = get_page_by_path($payload['slug'], OBJECT, 'post');
if (!$post) { echo json_encode(null); return; }
echo json_encode(array(
  'id' => (int) $post->ID,
  'status' => get_post_status($post),
  'slug' => $post->post_name,
  'link' => get_permalink($post),
  'guid' => array('rendered' => get_the_guid($post)),
));
`;
  return withRemoteJson({ slug }, script);
}

async function wpCliUpsertPost(payload) {
  const script = `<?php
$payload_path = $args[0] ?? ($argv[1] ?? null);
if ($payload_path === '--') { $payload_path = $args[1] ?? ($argv[2] ?? null); }
$payload = json_decode(file_get_contents($payload_path), true);
$postarr = array(
  'post_type' => 'post',
  'post_title' => $payload['title'],
  'post_name' => $payload['slug'],
  'post_excerpt' => $payload['excerpt'],
  'post_content' => $payload['content'],
  'post_status' => $payload['status'],
  'comment_status' => 'open',
);
if (!empty($payload['featuredMediaId'])) {
  $postarr['featured_media'] = (int) $payload['featuredMediaId'];
}
if (!empty($payload['id'])) {
  $postarr['ID'] = (int) $payload['id'];
  $id = wp_update_post($postarr, true);
} else {
  $id = wp_insert_post($postarr, true);
}
if (is_wp_error($id)) {
  fwrite(STDERR, $id->get_error_message());
  exit(1);
}
if (!empty($payload['featuredMediaId'])) { set_post_thumbnail($id, (int) $payload['featuredMediaId']); }
echo json_encode(array(
  'id' => (int) $id,
  'status' => get_post_status($id),
  'slug' => get_post_field('post_name', $id),
  'link' => get_permalink($id),
  'guid' => array('rendered' => get_the_guid($id)),
));
`;
  return withRemoteJson(payload, script);
}

async function wpCliApplyOptimization(id, article, schema) {
  const script = `<?php
$payload_path = $args[0] ?? ($argv[1] ?? null);
if ($payload_path === '--') { $payload_path = $args[1] ?? ($argv[2] ?? null); }
$payload = json_decode(file_get_contents($payload_path), true);
$id = (int) $payload['id'];
if (!$id || get_post_type($id) !== 'post') {
  fwrite(STDERR, 'Invalid post ID for optimization.');
  exit(1);
}
if (!function_exists('sml_discord_article_apply_package')) {
  fwrite(STDERR, 'Article metadata bridge is not available.'); exit(1);
}
$acting_user = get_user_by('login', $payload['actingUser'] ?? '') ?: get_user_by('email', $payload['actingUser'] ?? '');
if (!$acting_user) { fwrite(STDERR, 'Configured editorial user was not found.'); exit(1); }
wp_set_current_user($acting_user->ID);
if (!current_user_can('edit_post', $id)) { fwrite(STDERR, 'Editorial user cannot edit this article.'); exit(1); }
$request = new WP_REST_Request('POST', '/sml-discord-articles/v1/apply/' . $id);
$request->set_url_params(array('id' => $id));
$request->set_header('content-type', 'application/json');
$request->set_body(wp_json_encode($payload));
$result = sml_discord_article_apply_package($request);
if (is_wp_error($result)) { fwrite(STDERR, $result->get_error_message()); exit(1); }
$data = $result instanceof WP_REST_Response ? $result->get_data() : $result;
$data['transport'] = 'wp-cli';
echo wp_json_encode($data);
`;
  return withRemoteJson({
    id,
    actingUser: configuration().username,
    seoTitle: article.seoTitle,
    metaDescription: article.metaDescription,
    focusKeyword: article.focusKeyword,
    secondaryKeywords: article.secondaryKeywords || [],
    categories: article.categories || [],
    tags: article.tags || [],
    imageAltText: article.imageAltText || '',
    imageTitle: article.imageTitle || '',
    imageCaption: article.imageCaption || '',
    imageDescription: article.imageDescription || '',
    socialPosts: article.socialPosts || {},
    pipelineVersion: article.pipelineVersion || '',
    writerResponseId: article.writerResponseId || '',
    formatterResponseId: article.formatterResponseId || '',
    schema,
  }, script);
}

async function wpCliUploadFeaturedImage({ bytes, filename, title, altText, caption = '', description = '' }) {
  const cfg = sshConfiguration();
  const dir = await mkdtemp(path.join(tmpdir(), 'sml-wp-media-'));
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  const localPath = path.join(dir, safeName);
  const remotePath = `/tmp/sml-wp-media-${Date.now()}-${safeName}`;
  try {
    await writeFile(localPath, bytes);
    await execFileAsync(cfg.scp, ['-i', cfg.key, '-o', 'BatchMode=yes', localPath, `${cfg.target}:${remotePath}`], { timeout: 60_000, windowsHide: true });
    const mediaId = Number((await sshWp(`wp media import ${remoteQuote(remotePath)} --porcelain; rm -f ${remoteQuote(remotePath)}`, { timeout: 120_000 })).trim().split(/\s+/).pop());
    if (!mediaId) throw new Error('WP-CLI media import did not return a media ID.');
    const meta = await withRemoteJson({ mediaId, title, altText, caption, description }, `<?php
$payload_path = $args[0] ?? ($argv[1] ?? null);
if ($payload_path === '--') { $payload_path = $args[1] ?? ($argv[2] ?? null); }
$payload = json_decode(file_get_contents($payload_path), true);
$id = (int) $payload['mediaId'];
wp_update_post(array(
  'ID' => $id,
  'post_title' => $payload['title'],
  'post_excerpt' => $payload['caption'],
  'post_content' => $payload['description'],
));
update_post_meta($id, '_wp_attachment_image_alt', $payload['altText']);
echo json_encode(array('id' => $id, 'source_url' => wp_get_attachment_url($id)));
`, 60_000);
    if (!meta?.id || !meta?.source_url) throw new Error('WP-CLI uploaded media without a usable URL.');
    return meta;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function wpRequest(pathname, options = {}) {
  const { baseUrl, username, password } = configuration();
  const { rawBody = false, ...requestOptions } = options;
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...requestOptions,
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      Accept: 'application/json',
      ...(options.body && !rawBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(25_000),
  });
  const contentType = response.headers.get('content-type') || '';
  const bodyText = await response.text();
  const body = /json/i.test(contentType) ? JSON.parse(bodyText || '{}') : {};
  if (!response.ok) {
    const error = new Error(`WordPress request failed (${response.status}): ${body.message || 'unknown error'}`);
    error.status = response.status;
    error.bodyText = bodyText;
    error.contentType = contentType;
    throw error;
  }
  return body;
}

export async function verifyWordPressAccess() {
  let user;
  try {
    user = await wpRequest('/wp-json/wp/v2/users/me?context=edit');
  } catch (error) {
    if (!isChallenge403(error)) throw error;
    const { username } = configuration();
    const login = String(username).trim().replace(/^["']|["']$/g, '');
    const roles = (await sshWp(`wp user get ${remoteQuote(login)} --field=roles`, { timeout: 30_000 })).trim();
    const canPublish = /\b(administrator|editor|author)\b/i.test(roles);
    return { id: 0, name: login, canEditPosts: canPublish, canPublishPosts: canPublish, transport: 'wp-cli' };
  }
  return {
    id: user.id,
    name: user.name,
    canEditPosts: Boolean(user.capabilities?.edit_posts),
    canPublishPosts: Boolean(user.capabilities?.publish_posts),
  };
}

export async function findPostBySlug(slug) {
  const params = new URLSearchParams({ context: 'edit', slug, per_page: '1' });
  for (const status of ['draft', 'pending', 'publish', 'future', 'private']) params.append('status[]', status);
  let rows;
  try {
    rows = await wpRequest(`/wp-json/wp/v2/posts?${params}`);
  } catch (error) {
    if (!isChallenge403(error)) throw error;
    return wpCliFindPostBySlug(slug);
  }
  return rows[0] || null;
}

export async function uploadFeaturedImage({ bytes, filename, mimeType, title, altText, caption = '', description = '', requireMetadata = false }) {
  let media;
  try {
    media = await wpRequest('/wp-json/wp/v2/media', {
      method: 'POST',
      rawBody: true,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename.replace(/["\\\r\n]/g, '_')}"`,
      },
      body: bytes,
    });
  } catch (error) {
    if (!isChallenge403(error)) throw error;
    return wpCliUploadFeaturedImage({ bytes, filename, title, altText, caption, description });
  }
  try {
    return await wpRequest(`/wp-json/wp/v2/media/${media.id}`, {
      method: 'POST',
      body: JSON.stringify({ title, alt_text: altText, caption, description }),
    });
  } catch (error) {
    if (requireMetadata) throw new Error(`WordPress media ${media.id} uploaded but required metadata could not be saved: ${error.message || error}`);
    return media;
  }
}

function normalizePostStatus(status) {
  return status === 'publish' ? 'publish' : 'draft';
}

// Rank Math interprets dollar-prefixed text as template variables in its
// snippet analyzer. Keep cashtags and dollar amounts in the article itself,
// but send plain text to the Rank Math-only metadata fields so its score is
// based on the actual terms readers search for.
function rankMathSafeText(value) {
  return String(value || '')
    .replace(/\$([A-Za-z0-9])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function createOrUpdateArticle({ title, slug, excerpt, content, featuredMediaId = 0, status = 'draft', preservePublished = false }) {
  const targetStatus = normalizePostStatus(status);
  const existing = await findPostBySlug(slug);
  if (existing) {
    const updateStatus = preservePublished && existing.status === 'publish' ? 'publish' : targetStatus;
    let post;
    try {
      post = await wpRequest(`/wp-json/wp/v2/posts/${existing.id}`, {
        method: 'POST',
        body: JSON.stringify({
          title, slug, excerpt, content, status: updateStatus, comment_status: 'open',
          ...(featuredMediaId > 0 ? { featured_media: Number(featuredMediaId) } : {}),
        }),
      });
    } catch (error) {
      if (!isChallenge403(error)) throw error;
      post = await wpCliUpsertPost({ id: existing.id, title, slug, excerpt, content, status: updateStatus, featuredMediaId });
    }
    return { created: false, post, editUrl: `${configuration().baseUrl}/wp-admin/post.php?post=${existing.id}&action=edit` };
  }
  let post;
  try {
    post = await wpRequest('/wp-json/wp/v2/posts', {
      method: 'POST',
      body: JSON.stringify({
        title, slug, excerpt, content, status: targetStatus, comment_status: 'open',
        ...(featuredMediaId > 0 ? { featured_media: Number(featuredMediaId) } : {}),
      }),
    });
  } catch (error) {
    if (!isChallenge403(error)) throw error;
    post = await wpCliUpsertPost({ title, slug, excerpt, content, status: targetStatus, featuredMediaId });
  }
  return { created: true, post, editUrl: `${configuration().baseUrl}/wp-admin/post.php?post=${post.id}&action=edit` };
}

export async function updateArticleById(id, { title, slug, excerpt, content, featuredMediaId = 0, status = 'draft' }) {
  if (!(Number(id) > 0)) throw new Error('A valid WordPress post ID is required.');
  try {
    return await wpRequest(`/wp-json/wp/v2/posts/${Number(id)}`, {
      method: 'POST',
      body: JSON.stringify({
        title, slug, excerpt, content, status: normalizePostStatus(status), comment_status: 'open',
        ...(featuredMediaId > 0 ? { featured_media: Number(featuredMediaId) } : {}),
      }),
    });
  } catch (error) {
    if (!isChallenge403(error)) throw error;
    return wpCliUpsertPost({ id: Number(id), title, slug, excerpt, content, status: normalizePostStatus(status), featuredMediaId });
  }
}

export function canonicalArticleUrl(slug) {
  return `${configuration().baseUrl}/${String(slug || '').replace(/^\/+|\/+$/g, '')}/`;
}

export async function applyArticleOptimization(id, article, schema) {
  if (!(Number(id) > 0)) throw new Error('A valid WordPress post ID is required for SEO optimization.');
  const rankMathArticle = {
    ...article,
    seoTitle: rankMathSafeText(article.seoTitle),
    metaDescription: rankMathSafeText(article.metaDescription),
    focusKeyword: rankMathSafeText(article.focusKeyword),
    secondaryKeywords: (article.secondaryKeywords || []).map(rankMathSafeText).filter(Boolean),
    imageAltText: rankMathSafeText(article.imageAltText),
    imageTitle: rankMathSafeText(article.imageTitle),
    imageCaption: rankMathSafeText(article.imageCaption),
    imageDescription: rankMathSafeText(article.imageDescription),
  };
  try {
    return await wpRequest(`/wp-json/sml-discord-articles/v1/apply/${Number(id)}`, {
      method: 'POST',
      body: JSON.stringify({
        seoTitle: rankMathArticle.seoTitle,
        metaDescription: rankMathArticle.metaDescription,
        focusKeyword: rankMathArticle.focusKeyword,
        secondaryKeywords: rankMathArticle.secondaryKeywords,
        categories: article.categories || [],
        tags: article.tags || [],
        imageAltText: rankMathArticle.imageAltText,
        imageTitle: rankMathArticle.imageTitle,
        imageCaption: rankMathArticle.imageCaption,
        imageDescription: rankMathArticle.imageDescription,
        socialPosts: article.socialPosts || {},
        pipelineVersion: article.pipelineVersion || '',
        writerResponseId: article.writerResponseId || '',
        formatterResponseId: article.formatterResponseId || '',
        schema,
      }),
    });
  } catch (error) {
    if (!isChallenge403(error)) throw error;
    return wpCliApplyOptimization(Number(id), rankMathArticle, schema);
  }
}

// Backward-compatible wrapper for older scripts and tests.
export async function createOrFindDraft(article) {
  return createOrUpdateArticle({ ...article, status: 'draft' });
}
