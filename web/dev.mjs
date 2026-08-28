import { join } from 'node:path';

// Local browser development uses the same private WhatsApp data as the
// installed app, so a successful link survives when the desktop shell returns.
process.env.PORT ||= '4317';
const appData = process.env.APPDATA || process.cwd();
const clearedData = join(appData, 'cleared-chat-desktop', 'whatsapp');
process.env.WA_DATA_DIR ||= clearedData;

await import('./server.mjs');
