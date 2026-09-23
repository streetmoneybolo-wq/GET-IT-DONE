'use strict';

/* Owner-voice narration via ElevenLabs. Kept deliberately small: it takes
 * text and returns an audio buffer. Where that buffer is stored (WordPress
 * media, disk, etc.) and which lesson/discipline row it belongs to are the
 * caller's concern, not this module's. */

const ELEVENLABS_MAX_CHARS = 5000; // ElevenLabs' own per-request text limit.

function requireConfig({ apiKey, voiceId, model }) {
  const missing = [];
  if (!apiKey) missing.push('ELEVENLABS_API_KEY');
  if (!voiceId) missing.push('SML_ACADEMY_ELEVENLABS_VOICE_ID');
  if (!model) missing.push('SML_ACADEMY_ELEVENLABS_MODEL');
  if (missing.length) throw new Error(`elevenlabs_not_configured:${missing.join(',')}`);
}

/**
 * Synthesize narration audio for a single piece of text.
 * @param {object} options
 * @param {string} options.text - Plain narration script, already free of
 *   markdown/HTML and any "AI generated"/"Claude"/"playing Obi's voice"
 *   framing per the Academy's public-facing content rules.
 * @param {string} options.apiKey - ELEVENLABS_API_KEY
 * @param {string} options.voiceId - SML_ACADEMY_ELEVENLABS_VOICE_ID (the
 *   cloned voice's id from the ElevenLabs dashboard)
 * @param {string} options.model - SML_ACADEMY_ELEVENLABS_MODEL
 * @param {object} [options.voiceSettings] - optional stability/similarity
 *   overrides; ElevenLabs defaults are reasonable for narration.
 * @param {Function} [options.fetchImpl] - injectable for tests.
 * @returns {Promise<{audio: Buffer, contentType: string}>}
 */
async function synthesizeNarration({ text, apiKey, voiceId, model, voiceSettings, fetchImpl = fetch } = {}) {
  requireConfig({ apiKey, voiceId, model });
  const script = String(text || '').trim();
  if (!script) throw new Error('narration_text_required');
  if (script.length > ELEVENLABS_MAX_CHARS) {
    throw new Error(`narration_text_too_long:${script.length}>${ELEVENLABS_MAX_CHARS}`);
  }

  const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      text: script,
      model_id: model,
      voice_settings: {
        stability: voiceSettings?.stability ?? 0.5,
        similarity_boost: voiceSettings?.similarityBoost ?? 0.85
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`elevenlabs_synthesis_failed:${response.status}:${detail.slice(0, 300)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return { audio: Buffer.from(arrayBuffer), contentType: response.headers.get('content-type') || 'audio/mpeg' };
}

/**
 * Split a long script into ElevenLabs-sized chunks on paragraph boundaries
 * where possible, so a multi-stage script (like the daily discipline series)
 * doesn't need to be manually pre-split by hand before synthesis.
 */
function chunkNarrationText(text, maxChars = ELEVENLABS_MAX_CHARS) {
  const paragraphs = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

module.exports = { synthesizeNarration, chunkNarrationText, ELEVENLABS_MAX_CHARS };
