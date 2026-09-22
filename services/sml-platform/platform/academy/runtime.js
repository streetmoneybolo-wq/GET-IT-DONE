'use strict';

/* Academy interactions remain available even when the unrelated dispute
 * evidence feature flag is off.  The fallback command handler intentionally
 * exposes no billing or dispute surface. */
const { createDiscordInteractions } = require('../discord-interactions');
const { createAcademyCommands } = require('./commands');
const { createAcademyVoice } = require('../academy-voice');
const { SEED_LESSONS } = require('./curriculum');
const { episodeFor, splitNarration } = require('./discipline-content');
const crypto = require('node:crypto');

function createAcademyInteractions({ config, pool, fetchImpl, now } = {}) {
  if (!config?.academyEnabled || !config?.academyGuildId ||
      !config?.academyPublicKey || !config?.academyAppId) return null;
  const academyVoice = createAcademyVoice({
    apiKey: config.elevenLabsApiKey,
    voiceId: config.academyVoiceId,
    modelId: config.academyVoiceModel,
    lessons: SEED_LESSONS,
    fetchImpl,
    now
  });
  async function remoteDisciplineAudio({ episodeId, userId, studentId }) {
    const episode = episodeFor(episodeId);
    if (!episode || !studentId) throw new TypeError('invalid discipline episode');
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query('DELETE FROM academy_discipline_player_tokens WHERE expires_at <= now()');
    await pool.query(`INSERT INTO academy_discipline_player_tokens (token_hash, student_id, expires_at)
      VALUES ($1,$2,now() + interval '30 minutes')`, [tokenHash, studentId]);
    const partCount = splitNarration(episode.script).length;
    const buffers = [];
    for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
      const url = `https://sml-platform-api.onrender.com/academy-discipline/speech?episode=${episode.id}&part=${partIndex}&token=${encodeURIComponent(token)}`;
      const response = await (fetchImpl || globalThis.fetch)(url, { headers: { accept: 'audio/mpeg' } });
      if (!response.ok) throw new Error(`Academy voice bridge returned ${response.status}`);
      buffers.push(Buffer.from(await response.arrayBuffer()));
    }
    return { audio: Buffer.concat(buffers), partCount, cached: false, userId };
  }
  const academy = createAcademyCommands({
    pool,
    guildId: config.academyGuildId,
    monarchRoleId: config.academyMonarchRoleId,
    enabled: true,
    now,
    disciplineAudio: ({ episodeId, userId, studentId }) => academyVoice.configured
      ? academyVoice.getDisciplineEpisodeAudio({ episodeId, userId })
      : remoteDisciplineAudio({ episodeId, userId, studentId })
  });
  return createDiscordInteractions({
    config: { discordConnectPublicKey: config.academyPublicKey, discordConnectAppId: config.academyAppId },
    pool,
    academy,
    commands: { handleCommand: async () => ({ response: { type: 4, data: { content: 'This command is not available.', flags: 64 } } }) },
    fetchImpl,
    now
  });
}

module.exports = { createAcademyInteractions };
