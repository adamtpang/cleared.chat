// Direct Discord DM access via a self-bot (logging in as your real account,
// not an official bot). This is against Discord's ToS - ban risk is real,
// accepted explicitly by Adam before this file was written. Never uses a
// password: DISCORD_TOKEN only, read from .env, never logged or echoed.
//
// Run standalone:  node discord-source.mjs   (prints ready + DM channel count)

import { Client } from 'discord.js-selfbot-v13';
import { fileURLToPath } from 'node:url';

// Lazy, not a top-level const: server.mjs loads web/.env in its own body,
// which runs AFTER this module is evaluated. Capturing it here would always
// read undefined.
const TOKEN = () => process.env.DISCORD_TOKEN || '';

let client = null;
let ready = false;

export function discordConfigured() {
  return Boolean(TOKEN());
}

export function getDiscordStatus() {
  return { configured: discordConfigured(), ready };
}

let startPromise = null;
export function ensureDiscordStarted() {
  if (!discordConfigured()) return Promise.resolve(null);
  if (!startPromise) {
    client = new Client({ checkUpdate: false });
    startPromise = new Promise((resolve, reject) => {
      client.on('ready', () => {
        ready = true;
        console.log(`[discord] logged in as ${client.user?.tag}`);
        resolve(client);
      });
      client.on('error', (e) => console.error('[discord] error:', e.message || e));
      client.login(TOKEN()).catch((e) => {
        console.error('[discord] login failed:', e.message || e);
        startPromise = null;
        reject(e);
      });
    });
  }
  return startPromise;
}

// Returns chat-shaped items (matches cleared.chat's own chat objects, see
// fetchConversations in server.mjs) so it merges straight into the same
// ranking pipeline as Gmail + WhatsApp-direct.
export async function fetchDiscordDMs(limit = 40) {
  if (!discordConfigured()) return { items: [], error: 'DISCORD_TOKEN not set' };
  try {
    await ensureDiscordStarted();
  } catch (e) {
    return { items: [], error: String(e.message || e) };
  }
  const dms = [...client.channels.cache.values()]
    .filter((c) => c.type === 'DM' || c.type === 'GROUP_DM')
    .sort((a, b) => (b.lastMessageId || '0').localeCompare(a.lastMessageId || '0'))
    .slice(0, limit);

  const items = [];
  for (const ch of dms) {
    let msgs = [];
    try {
      const fetched = await ch.messages.fetch({ limit: 12 });
      msgs = [...fetched.values()].reverse().map((m) => ({
        isSender: m.author?.id === client.user?.id,
        senderName: m.author?.username || 'them',
        timestamp: m.createdAt.toISOString(),
        text: m.content || (m.attachments.size ? '[attachment]' : ''),
      }));
    } catch { /* channel may be inaccessible; skip messages, keep chat shell */ }
    if (!msgs.length) continue;
    const who = ch.type === 'DM' ? (ch.recipient?.username || ch.recipient?.tag || 'Unknown') : (ch.name || 'Group DM');
    items.push({
      id: `discord:${ch.id}`,
      title: who,
      network: 'Discord',
      type: ch.type === 'GROUP_DM' ? 'group' : 'single',
      isMuted: false,
      unread: (ch.lastMessageId || null) !== (ch.lastReadMessageId || null),
      messages: msgs,
      source: 'discord',
    });
  }
  return { items, error: null };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureDiscordStarted().then(async () => {
    const { items } = await fetchDiscordDMs(10);
    console.log(`${items.length} DM channels with recent activity`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
