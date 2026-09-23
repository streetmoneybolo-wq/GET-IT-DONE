#!/usr/bin/env node
'use strict';

/* Renders one narration script to an mp3 using the Academy's cloned
 * ElevenLabs voice. Intentionally a single-purpose CLI, not wired into any
 * automatic publish flow yet - narration review and the actual
 * academy_content insert stay manual review steps for now.
 *
 * Usage:
 *   node scripts/generate-academy-narration.js <input.txt> <output.mp3>            (dry run: validates only)
 *   node scripts/generate-academy-narration.js <input.txt> <output.mp3> --apply    (calls ElevenLabs, writes the file)
 */

const fs = require('node:fs');
const path = require('node:path');
const { synthesizeNarration, chunkNarrationText, ELEVENLABS_MAX_CHARS } = require('../platform/academy/narration');

/* Deliberately reads process.env directly rather than platform/config's
 * getConfig(), which validates the entire running service (DATABASE_URL
 * included) and is the wrong fit for a narration-only CLI with no DB use. */
function narrationEnv() {
  return {
    apiKey: String(process.env.ELEVENLABS_API_KEY || '').trim(),
    voiceId: String(process.env.SML_ACADEMY_ELEVENLABS_VOICE_ID || '').trim(),
    model: String(process.env.SML_ACADEMY_ELEVENLABS_MODEL || 'eleven_multilingual_v2').trim()
  };
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  const apply = process.argv.includes('--apply');
  if (!inputPath || !outputPath) {
    console.error('Usage: node scripts/generate-academy-narration.js <input.txt> <output.mp3> [--apply]');
    process.exit(1);
  }

  const text = fs.readFileSync(path.resolve(inputPath), 'utf8').trim();
  const chunks = chunkNarrationText(text);
  const env = narrationEnv();

  if (!apply) {
    console.log(JSON.stringify({
      dryRun: true,
      inputPath,
      outputPath,
      characters: text.length,
      chunkCount: chunks.length,
      chunkSizes: chunks.map((chunk) => chunk.length),
      perRequestLimit: ELEVENLABS_MAX_CHARS,
      voiceConfigured: Boolean(env.apiKey && env.voiceId),
      note: chunks.length > 1
        ? `This script will be synthesized as ${chunks.length} separate ElevenLabs calls and concatenated. Verify the output does not have an audible seam at each chunk boundary.`
        : 'Fits in a single ElevenLabs request.'
    }, null, 2));
    return;
  }

  const buffers = [];
  for (const [index, chunk] of chunks.entries()) {
    process.stderr.write(`Synthesizing chunk ${index + 1}/${chunks.length} (${chunk.length} chars)...\n`);
    const { audio } = await synthesizeNarration({
      text: chunk,
      apiKey: env.apiKey,
      voiceId: env.voiceId,
      model: env.model
    });
    buffers.push(audio);
  }

  fs.writeFileSync(path.resolve(outputPath), Buffer.concat(buffers));
  console.log(JSON.stringify({ written: outputPath, bytes: Buffer.concat(buffers).length, chunkCount: chunks.length }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
