import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(tmpdir(), 'spotlight-webhook-'));
process.env.DATA_DIR = directory;
const { writeSettingsOverride, paths, readJson } = await import('../utils/storage.js');
const { processAlertMessage } = await import('../utils/alertMonitor.js');

test('approved webhook enters the alert ledger, preserves identity and rejects other sources', async () => {
  try {
    await writeSettingsOverride('alertMonitor', {
      enabled: true,
      sources: [
        { guildId: 'guild', channelId: 'approved', webhookIds: ['1559212065112064105'] },
        { guildId: 'guild', channelId: 'other' },
      ],
    });
    await writeSettingsOverride('articleAutomation', { alertVisuals: { enabled: false } });
    const message = {
      id: 'alert', guildId: 'guild', channelId: 'approved',
      author: { id: '1559212065112064105', bot: true, username: 'GRANDMASTER-OBI' },
      webhookId: '1559212065112064105', content: '🔥 𝐖𝐎𝐑𝐗 𝐄𝐍𝐓𝐑𝐘 $𝟏.𝟓𝟖 | 𝐏𝐓 $𝟐.𝟎𝟕 (𝐃𝐀𝐘 𝐓𝐑𝐀𝐃𝐄) 🔥',
      createdAt: new Date('2026-10-19T14:11:13.670Z'),
    };
    await processAlertMessage({ ...message, id: 'wrong-channel', channelId: 'other' });
    await processAlertMessage({ ...message, id: 'wrong-guild', guildId: 'different' });
    await processAlertMessage({ ...message, id: 'wrong-webhook', webhookId: 'different' });
    assert.deepEqual(await readJson(paths.monitoredAlerts, []), []);
    await processAlertMessage(message, 'backfill');
    await processAlertMessage(message, 'backfill');
    let alerts = await readJson(paths.monitoredAlerts, []);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].authorId, message.author.id);
    assert.equal(alerts[0].authorName, 'GRANDMASTER-OBI');
    assert.equal(alerts[0].current.symbol, 'WORX');
    assert.equal(alerts[0].current.entryPrice, 1.58);
    assert.equal(alerts[0].needsReview, true);
    await processAlertMessage({ ...message, content: 'WORX ENTRY $1.59 PT $2.07' }, 'updated');
    alerts = await readJson(paths.monitoredAlerts, []);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].edited, true);
    assert.equal(alerts[0].needsReview, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
