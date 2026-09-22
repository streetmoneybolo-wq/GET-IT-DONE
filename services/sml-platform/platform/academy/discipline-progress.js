'use strict';

const crypto = require('node:crypto');
const { EPISODES, episodeFor, splitNarration } = require('./discipline-content');

function createDisciplineProgress({ pool } = {}) {
  const configured = Boolean(pool && typeof pool.query === 'function');

  async function student(userId, guildId) {
    const result = await pool.query(`INSERT INTO academy_students (guild_id, discord_id) VALUES ($1,$2)
      ON CONFLICT (guild_id, discord_id) DO UPDATE SET discord_id=EXCLUDED.discord_id RETURNING id`, [guildId, userId]);
    return result.rows[0].id;
  }

  async function resolveToken(token) {
    if (!configured || !/^[A-Za-z0-9_-]{40,80}$/.test(String(token || ''))) return { ok: false, code: 'invalid_token' };
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const result = await pool.query(`SELECT s.discord_id, s.guild_id
      FROM academy_discipline_player_tokens t
      JOIN academy_students s ON s.id=t.student_id
      WHERE t.token_hash=$1 AND t.expires_at > now()`, [tokenHash]);
    if (!result.rowCount) return { ok: false, code: 'expired_token' };
    return { ok: true, userId: String(result.rows[0].discord_id), guildId: String(result.rows[0].guild_id) };
  }

  async function read(userId, guildId) {
    if (!configured) throw new Error('discipline progress is not configured');
    const studentId = await student(userId, guildId);
    await pool.query(`INSERT INTO academy_discipline_audio_progress (student_id)
      VALUES ($1) ON CONFLICT (student_id) DO NOTHING`, [studentId]);
    let result = await pool.query(`SELECT episode_index, part_index, playback_ms, unlocked_on, completed_at
      FROM academy_discipline_audio_progress WHERE student_id=$1`, [studentId]);
    let row = result.rows[0];
    const hasNext = Boolean(episodeFor(Number(row.episode_index) + 1));
    if (row.completed_at && hasNext) {
      result = await pool.query(`UPDATE academy_discipline_audio_progress
        SET episode_index=episode_index+1, part_index=0, playback_ms=0,
            unlocked_on=CURRENT_DATE, completed_at=NULL, updated_at=now()
        WHERE student_id=$1 AND completed_at IS NOT NULL AND unlocked_on < CURRENT_DATE
        RETURNING episode_index, part_index, playback_ms, unlocked_on, completed_at`, [studentId]);
      if (result.rowCount) row = result.rows[0];
    }
    const episode = episodeFor(row.episode_index) || EPISODES[EPISODES.length - 1];
    const parts = splitNarration(episode.script);
    return {
      episode: { id: episode.id, title: episode.title, summary: episode.summary, partCount: parts.length },
      partIndex: Math.min(Number(row.part_index || 0), Math.max(0, parts.length - 1)),
      playbackMs: Number(row.playback_ms || 0),
      completed: Boolean(row.completed_at),
      nextAvailable: Boolean(episodeFor(episode.id + 1)),
      totalEpisodes: EPISODES.length
    };
  }

  async function save(userId, guildId, input) {
    const state = await read(userId, guildId);
    const episodeId = Number(input.episodeId);
    const partIndex = Number(input.partIndex);
    const playbackMs = Number(input.playbackMs);
    if (episodeId !== state.episode.id || !Number.isInteger(partIndex) || partIndex < 0 || partIndex >= state.episode.partCount || !Number.isFinite(playbackMs) || playbackMs < 0 || playbackMs > 86_400_000) throw new TypeError('invalid discipline progress');
    const studentId = await student(userId, guildId);
    const completed = input.completed === true;
    await pool.query(`UPDATE academy_discipline_audio_progress
      SET part_index=$2, playback_ms=$3, completed_at=CASE WHEN $4 THEN COALESCE(completed_at,now()) ELSE completed_at END, updated_at=now()
      WHERE student_id=$1 AND episode_index=$5`, [studentId, partIndex, Math.round(playbackMs), completed, episodeId]);
    return read(userId, guildId);
  }

  return { configured, read, save, resolveToken };
}

module.exports = { createDisciplineProgress };
