import { createHash, randomInt } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { mutateJson, paths } from './storage.js';
import { uploadFeaturedImage } from './wordpressClient.js';

const MIME_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
]);

export function mediaTypeForFile(file) {
  return MIME_TYPES.get(path.extname(file).toLowerCase()) || '';
}

async function imageFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && mediaTypeForFile(entry.name))
    .map((entry) => path.resolve(directory, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function uploadFilename(file) {
  const extension = path.extname(file).toLowerCase();
  const stem = path.basename(file, path.extname(file))
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'sml-alert-featured-image';
  return `${stem}${extension}`;
}

function chooseCandidate(files, cache, avoidRecent) {
  const recent = new Set((cache.recent || []).slice(-avoidRecent));
  const healthy = files.filter((file) => !cache.failures?.[file]);
  const preferred = healthy.filter((file) => !recent.has(file));
  const pool = preferred.length ? preferred : healthy;
  return pool.length ? pool[randomInt(pool.length)] : null;
}

export async function ensureArticleFeaturedImage({ jobId, symbol, settings, altText = '' }) {
  const feature = settings.articleAutomation?.featuredImages || {};
  if (!feature.enabled) return null;
  const directory = path.resolve(String(feature.directory || ''));
  if (!directory) throw new Error('Article featured-image directory is not configured.');
  const files = await imageFiles(directory);
  if (!files.length) throw new Error(`No supported article featured images were found in ${directory}.`);
  const avoidRecent = Math.max(0, Math.min(files.length - 1, Number(feature.avoidRecent || 3)));

  return mutateJson(paths.articleFeaturedMedia, { selections: {}, uploads: {}, failures: {}, recent: [] }, async (cache) => {
    cache.selections ||= {};
    cache.uploads ||= {};
    cache.failures ||= {};
    cache.recent ||= [];
    let selected = cache.selections[jobId]?.path;
    const attempted = new Set();
    while (true) {
      if (!selected || !files.includes(selected) || cache.failures[selected] || attempted.has(selected)) {
        selected = chooseCandidate(files.filter((file) => !attempted.has(file)), cache, avoidRecent);
        if (!selected) throw new Error('Every configured article featured image has failed WordPress upload.');
        cache.selections[jobId] = { path: selected, selectedAt: new Date().toISOString() };
      }
      attempted.add(selected);
      // Image metadata belongs to this article, not every post using the same
      // source artwork. Older global uploads remain untouched for old posts.
      const uploadKey = `${jobId}:${selected}`;
      if (cache.uploads[uploadKey]?.mediaId) break;
      try {
        const suffix = createHash('sha256').update(jobId).digest('hex').slice(0, 12);
        const filename = uploadFilename(selected).replace(/(\.[^.]+)$/, `-${suffix}$1`);
        const media = await uploadFeaturedImage({
          bytes: await readFile(selected),
          filename,
          mimeType: mediaTypeForFile(selected),
          title: `Stock Market Loop alert article image — $${symbol}`,
          altText: altText || `Stock market news featured image for $${symbol}`,
        });
        cache.uploads[uploadKey] = {
          mediaId: Number(media.id),
          sourceUrl: media.source_url || '',
          uploadedAt: new Date().toISOString(),
        };
        break;
      } catch (error) {
        cache.failures[selected] = { error: String(error.message || error).slice(0, 300), failedAt: new Date().toISOString() };
        delete cache.selections[jobId];
        selected = null;
      }
    }

    const uploaded = cache.uploads[`${jobId}:${selected}`];
    cache.selections[jobId] = { ...cache.selections[jobId], mediaId: uploaded.mediaId, sourceUrl: uploaded.sourceUrl };
    cache.recent = [...cache.recent.filter((file) => file !== selected), selected].slice(-Math.max(10, avoidRecent + 1));
    return { path: selected, mediaId: uploaded.mediaId, sourceUrl: uploaded.sourceUrl };
  });
}
