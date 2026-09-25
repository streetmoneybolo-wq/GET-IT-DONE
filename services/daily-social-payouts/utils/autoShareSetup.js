import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { readSettings, writeSettingsOverride } from './storage.js';

/**
 * Boot-time share-workflow wiring for the guild named in SHARE_AUTOSETUP_GUILD.
 * The bot gets moved between servers and /share-setup then has to be re-run by
 * an admin before articles flow again; this closes that gap. /share-setup stays
 * the override: any deliberate admin config - wired to ANY guild, or explicitly
 * disabled - is respected as long as its channels still resolve; auto-setup only
 * acts when there is no admin-authored wiring left alive. Channels are matched
 * by name exact-first ACROSS all slots (so a generic word can never steal
 * another slot's exact match), only channels the bot can actually view and send
 * in count, and missing ones are created under a DAILY SOCIAL category when the
 * bot may. Legacy extra workflows are retired only after a per-entry
 * reachability check, on every boot, independent of the main wiring.
 */

const SPECS = [
	{ key: 'source', names: ['article-intake', 'articles-intake', 'links-to-post', 'article-feed', 'site-articles'], create: 'article-intake', priv: true, topic: 'New StockMarketLoop articles land here automatically and become share packages. Admins can also paste article links.' },
	{ key: 'sharing', names: ['share-articles', 'platform-sharing', 'share-to-earn', 'sharing'], create: 'share-articles', priv: false, topic: 'Pick a platform button to share the latest article and start earning.' },
	{ key: 'engagement', names: ['engagement-ideas', 'engagement-posts', 'comment-ideas', 'engagement'], create: 'engagement-ideas', priv: false, topic: 'Comment ideas and article discussion for the sharing crew.' },
	{ key: 'returnLinks', names: ['submit-your-posts', 'submit-posts', 'return-links', 'returned-links', 'post-links', 'submissions'], create: 'submit-your-posts', priv: false, topic: 'Paste the public link of your finished post here so it can be verified and paid.' },
	{ key: 'workReport', names: ['work-reports', 'work-report', 'audit-log'], create: 'work-reports', priv: true, topic: 'Automatic audit trail: shares, verified posts, and payout summaries.' },
];
const WORKFLOW_PROPS = { source: 'sourceChannelId', sharing: 'shareChannelId', engagement: 'engagementChannelId', returnLinks: 'returnLinksChannelId' };
const PERMANENT_FETCH_CODES = [10003, 10004, 50001]; // unknown channel / unknown guild / missing access

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function resolveAnywhere(client, channelId) {
	if (!channelId) return { channel: null, permanent: true };
	try {
		return { channel: await client.channels.fetch(channelId), permanent: false };
	} catch (error) {
		return { channel: null, permanent: PERMANENT_FETCH_CODES.includes(error?.code) };
	}
}

/** Retire extra legacy workflows whose server or channels the bot can no longer
 *  reach - per-entry, checked, idempotent; runs every boot regardless of the
 *  main wiring so the per-cycle articleFeed warnings actually stop. */
async function retireStaleExtras(client, settings) {
	const extras = Array.isArray(settings.linkWorkflows) ? settings.linkWorkflows : [];
	if (!extras.length) return;
	const kept = [];
	for (const workflow of extras) {
		if (!workflow?.enabled) { kept.push(workflow); continue; }
		let alive = false;
		if (workflow.guildId) {
			alive = Boolean(client.guilds.cache.get(workflow.guildId) || await client.guilds.fetch(workflow.guildId).catch(() => null));
		} else {
			for (const prop of Object.values(WORKFLOW_PROPS)) {
				const { channel, permanent } = await resolveAnywhere(client, workflow[prop]);
				if (channel || (workflow[prop] && ! permanent)) { alive = true; break; } // transient errors keep the entry
			}
		}
		if (alive) kept.push(workflow);
	}
	if (kept.length !== extras.length) {
		await writeSettingsOverride('linkWorkflows', kept);
		console.log(`Share auto-setup: retired ${extras.length - kept.length} legacy workflow(s) whose servers are no longer reachable (${kept.length} kept).`);
	}
}

export async function runAutoShareSetup(client) {
	const guildId = (process.env.SHARE_AUTOSETUP_GUILD || '').trim();
	if (!guildId) return;
	const settings = await readSettings();
	await retireStaleExtras(client, settings).catch((error) => console.warn(`Share auto-setup: legacy workflow retirement failed safely: ${error.message || error}`));

	const current = settings.linkWorkflow || {};
	if (current.guildId && false === current.enabled) {
		console.log('Share auto-setup: the workflow is explicitly disabled; leaving it alone.');
		return;
	}

	const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
	if (!guild) {
		console.warn(`Share auto-setup: the bot is not in guild ${guildId}; invite it there first.`);
		return;
	}
	const channels = await guild.channels.fetch().catch(() => null);
	if (!channels) {
		console.warn(`Share auto-setup: could not list channels of ${guild.name}; check the bot's permissions.`);
		return;
	}
	const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
	const usable = (channel) => {
		const perms = me && channel?.permissionsFor?.(me);
		return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages));
	};
	const canCreate = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageChannels));

	/* Respect any admin-authored wiring that is still alive - in THIS guild
	   (checked for real usability) or in any other guild the admin chose. */
	const survivors = {};
	if (current.enabled && current.guildId) {
		let resolved = 0;
		for (const [key, prop] of Object.entries(WORKFLOW_PROPS)) {
			const id = current[prop];
			if (!id) continue;
			if (current.guildId === guildId) {
				const channel = channels.get(id);
				if (channel && usable(channel)) { survivors[key] = channel; resolved++; }
			} else {
				const { channel, permanent } = await resolveAnywhere(client, id);
				if (channel || ! permanent) resolved++; // a transient error never justifies a re-wire
			}
		}
		if (resolved >= 4) {
			if (current.guildId === guildId && current.returnLinksPendingDedicated && canCreate) {
				await healPendingReturns(client, guild, channels, current);
			}
			console.log(`Share auto-setup: workflow already wired${current.guildId === guildId ? ` to ${guild.name}` : ` to guild ${current.guildId} by /share-setup`}; respecting it.`);
			return;
		}
		console.warn(`Share auto-setup: replacing the workflow previously wired to guild ${current.guildId} - only ${resolved}/4 of its channels still resolve (old ids: ${Object.values(WORKFLOW_PROPS).map((prop) => current[prop] || '-').join(', ')}).`);
	}

	const texts = [...channels.values()].filter((channel) => channel && channel.type === ChannelType.GuildText && usable(channel));
	const claimed = new Set();
	const picked = {};
	/* seed the slots that still work so a single broken channel never snaps the
	   admin's other deliberate picks back to name-matching */
	for (const [key, channel] of Object.entries(survivors)) {
		picked[key] = channel;
		claimed.add(channel.id);
	}
	const findExact = (names) => {
		for (const name of names) {
			const hit = texts.find((channel) => !claimed.has(channel.id) && norm(channel.name) === norm(name));
			if (hit) return hit;
		}
		return null;
	};
	const findLoose = (names) => {
		for (const name of names) {
			const hit = texts.find((channel) => !claimed.has(channel.id) && norm(channel.name).includes(norm(name)));
			if (hit) return hit;
		}
		return null;
	};
	/* exact names claim across ALL slots first, so a generic contains-match for
	   one slot can never steal another slot's exact-named channel */
	for (const spec of SPECS) {
		if (picked[spec.key]) continue;
		const hit = findExact(spec.names);
		if (hit) { picked[spec.key] = hit; claimed.add(hit.id); }
	}
	for (const spec of SPECS) {
		if (picked[spec.key]) continue;
		const hit = findLoose(spec.names);
		if (hit) { picked[spec.key] = hit; claimed.add(hit.id); }
	}
	let category = [...channels.values()].find((channel) => channel?.type === ChannelType.GuildCategory && norm(channel.name).includes('dailysocial')) || null;
	const created = [];
	for (const spec of SPECS) {
		if (picked[spec.key] || !canCreate) continue;
		if (!category) {
			category = await guild.channels.create({ name: 'DAILY SOCIAL', type: ChannelType.GuildCategory }).catch((error) => {
				console.warn(`Share auto-setup: could not create the DAILY SOCIAL category: ${error.message || error}`);
				return null;
			});
		}
		const channel = await guild.channels.create({
			name: spec.create,
			type: ChannelType.GuildText,
			parent: category?.id,
			topic: spec.topic,
			permissionOverwrites: spec.priv ? [
				{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
				{ id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
			] : undefined,
		}).catch((error) => {
			console.warn(`Share auto-setup: could not create #${spec.create}: ${error.message || error}`);
			return null;
		});
		if (channel) {
			created.push(channel.name);
			claimed.add(channel.id);
			picked[spec.key] = channel;
		}
	}

	if (!picked.source || !picked.sharing || !picked.engagement) {
		console.warn(`Share auto-setup: could not resolve the required channels in ${guild.name} (source=${picked.source?.name || 'missing'}, sharing=${picked.sharing?.name || 'missing'}, engagement=${picked.engagement?.name || 'missing'}). Give the bot Manage Channels or run /share-setup manually.`);
		return;
	}
	const returnLinks = picked.returnLinks || picked.engagement;

	await writeSettingsOverride('linkWorkflow', {
		enabled: true,
		guildId,
		sourceChannelId: picked.source.id,
		shareChannelId: picked.sharing.id,
		engagementChannelId: picked.engagement.id,
		returnLinksChannelId: returnLinks.id,
		duplicateWindowHours: settings.linkWorkflow?.duplicateWindowHours || 24,
		/* fell back because #submit-your-posts could not be made: a later boot
		   with better luck or permissions upgrades this to a dedicated channel */
		...( picked.returnLinks ? {} : { returnLinksPendingDedicated: true } ),
	});
	if (picked.workReport) {
		await wireWorkReport(client, settings, guild, picked.workReport);
	}
	console.log(`Share auto-setup: wired ${guild.name} - intake #${picked.source.name}, sharing #${picked.sharing.name}, engagement #${picked.engagement.name}, returns #${returnLinks.name}${picked.workReport ? `, reports #${picked.workReport.name}` : ''}${created.length ? ` (created: ${created.join(', ')})` : ''}. Run /share-setup any time to remap.`);
}

/** A previous boot could not make the dedicated returns channel and fell back
 *  to the engagement channel; give it another try and upgrade the overlay. */
async function healPendingReturns(client, guild, channels, current) {
	const spec = SPECS.find((entry) => 'returnLinks' === entry.key);
	let channel = [...channels.values()].find((entry) => entry?.type === ChannelType.GuildText && spec.names.some((name) => norm(entry.name) === norm(name))) || null;
	if (!channel) {
		channel = await guild.channels.create({ name: spec.create, type: ChannelType.GuildText, topic: spec.topic }).catch(() => null);
	}
	if (!channel) return;
	const upgraded = { ...current, returnLinksChannelId: channel.id };
	delete upgraded.returnLinksPendingDedicated;
	await writeSettingsOverride('linkWorkflow', upgraded);
	console.log(`Share auto-setup: dedicated returns channel now available - returns moved to #${channel.name}.`);
}

/** Append the work-report channel, pruning only entries that are PERMANENTLY
 *  gone (deleted channel / lost access) - a boot-time API hiccup must never
 *  silently drop a live audit channel. Writes only when something changed. */
async function wireWorkReport(client, settings, guild, channel) {
	const existing = settings.workReport?.channels?.length
		? settings.workReport.channels
		: settings.workReport?.channelId ? [{ channelId: settings.workReport.channelId }] : [];
	const next = [];
	for (const entry of existing) {
		if (!entry?.channelId || entry.channelId === channel.id) continue;
		const { channel: found, permanent } = await resolveAnywhere(client, entry.channelId);
		if (found || ! permanent) {
			next.push(entry);
			if (!found) console.warn(`Share auto-setup: could not verify work-report channel ${entry.channelId} right now; keeping it.`);
		}
	}
	next.push({ guildId: guild.id, channelId: channel.id, label: guild.name });
	const before = JSON.stringify(( settings.workReport?.channels || [] ).map((entry) => entry.channelId).sort());
	const after  = JSON.stringify(next.map((entry) => entry.channelId).sort());
	if (before !== after || !settings.workReport?.enabled) {
		await writeSettingsOverride('workReport', { ...(settings.workReport || {}), enabled: true, channels: next });
	}
}
