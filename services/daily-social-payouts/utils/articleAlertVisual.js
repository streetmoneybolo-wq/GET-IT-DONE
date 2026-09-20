import { readFile } from 'node:fs/promises';
import { mutateJson, paths } from './storage.js';
import { uploadFeaturedImage } from './wordpressClient.js';

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));
}

function linkedCaption(value) {
  return html(value)
    .replace(/grandmaster(?:-|\s)+obi/gi, '<a href="https://stockmarketloop.com/go/twitter-obi-7oua/" rel="author noopener noreferrer">Grandmaster-OBI</a>')
    .replace(/making easy money discord/gi, '<a href="https://discord.gg/DBFuRWEYe7" rel="noopener noreferrer nofollow sponsored">Making Easy Money Discord</a>');
}

export async function ensureAlertVisualMedia({ job, settings }) {
  const options = settings.articleAutomation?.alertVisuals || {};
  if (options.enabled === false) return null;
  const visual = job.facts?.alertVisual;
  if (!visual?.path || !visual?.hash) {
    if (options.required !== false) throw new Error('Publication blocked: the Discord alert visual is missing.');
    return null;
  }
  const cacheKey = `${job.alertMessageId}:${visual.hash}`;
  return mutateJson(paths.alertVisualMedia, { uploads: {} }, async (cache) => {
    cache.uploads ||= {};
    if (cache.uploads[cacheKey]?.mediaId) return { ...visual, ...cache.uploads[cacheKey] };
    const media = await uploadFeaturedImage({
      bytes: await readFile(visual.path),
      filename: visual.filename,
      mimeType: 'image/png',
      title: visual.title,
      altText: visual.altText,
      caption: visual.caption,
      description: visual.description,
      requireMetadata: true,
    });
    const uploaded = {
      mediaId: Number(media.id),
      sourceUrl: media.source_url || '',
      uploadedAt: new Date().toISOString(),
    };
    if (!uploaded.mediaId || !uploaded.sourceUrl) throw new Error('WordPress uploaded the alert visual without a usable media ID or URL.');
    cache.uploads[cacheKey] = uploaded;
    return { ...visual, ...uploaded };
  });
}

export function embedAlertVisual(content, media) {
  if (!media?.sourceUrl) return String(content || '');
  const figure = `<figure class="sml-alert-evidence wp-block-image size-full"><a href="https://discord.gg/DBFuRWEYe7" target="_blank" rel="noopener noreferrer"><img src="${html(media.sourceUrl)}" title="${html(media.title || media.altText)}" alt="${html(media.altText)}" width="${Number(media.width) || 1200}" height="${Number(media.height) || 675}" loading="lazy" decoding="async"/></a><figcaption>${linkedCaption(media.caption)}</figcaption></figure>`;
  const source = String(content || '');
  const marker = '<h2 id="alert-record">';
  return source.includes(marker) ? source.replace(marker, `${figure}\n${marker}`) : `${source}\n${figure}`;
}
