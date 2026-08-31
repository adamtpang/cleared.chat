// cleared.chat local triage web app
//
// Run:  node server.mjs   then open  http://localhost:4317
//
// A thin local proxy: the browser never sees your keys. It reads direct local
// message sources, ranks them by importance x urgency, and runs a draft
// assistant. Ranking and drafting use your Claude subscription by default
// (LLM=cli, via the Claude Code CLI) so no Anthropic API credits are needed.
// Set LLM=api to use a pay-as-you-go ANTHROPIC_API_KEY instead.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import QRCode from 'qrcode';
import { FATE, assignFate, compareTriagePriority, deriveState, radar as buildRadar, relationshipWeight, redact } from './fates.mjs';
import { verifyKey } from './license.mjs';
import { fetchGmailInbox, fetchGmailArchive, gmailConfigured, gmailAuthMode } from './gmail-source.mjs';
import {
  ensureWhatsAppStarted,
  listChats as listWhatsAppChats,
  getMessages as getWhatsAppMessages,
  getMessageImage as getWhatsAppMessageImage,
  getStatus as whatsAppStatus,
  getProfilePhoto as getWhatsAppProfilePhoto,
  hydrateGroupNames as hydrateWhatsAppGroupNames,
  pairWithCode,
  pairWithQr,
  isWhatsAppChatId,
  applyUnreadReference as applyWhatsAppUnreadReference,
  resyncUnreadState as resyncWhatsAppUnreadState,
  setContactAlias as setWhatsAppContactAlias,
  sendWhatsAppText,
  sendWhatsAppReaction,
  retryVoiceTranscription as retryWhatsAppVoiceTranscription,
  transcribeUploadedVoice as transcribeUploadedWhatsAppVoice,
  getVoiceTranscriptionStatus as getWhatsAppVoiceTranscriptionStatus,
} from './whatsapp.mjs';
import { fetchDiscordDMs, discordConfigured } from './discord-source.mjs';
import { buildVoiceNotesMarkdown, voiceNoteStats } from './voice-export.mjs';
import { applyChatPlan, planForConversation, readChatPlans, saveChatPlan } from './chat-plans.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

// --- tiny .env loader (no dependency) ---
(() => {
  const f = join(DIR, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const PORT = Number(process.env.PORT || 4317);
const DEMO = process.env.DEMO === '1';
const LICENSE_SECRET = process.env.LICENSE_SECRET || '';
const LICENSE_FILE = join(DIR, '.license.json');
const BEEPER_BASE = process.env.BEEPER_API_BASE || 'http://127.0.0.1:23373';
const BEEPER_TOKEN = process.env.BEEPER_ACCESS_TOKEN || '';
const BEEPER_ENABLED = process.env.BEEPER_ENABLED === '1' && Boolean(BEEPER_TOKEN);
const EMAIL_ENABLED = process.env.EMAIL_ENABLED === '1';
// Pull WhatsApp directly through the local Baileys linked-device session.
const WHATSAPP_DIRECT = process.env.WHATSAPP_DIRECT !== '0';
const LLM = (process.env.LLM || 'cli').toLowerCase();
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const API_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const CLI_MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
// grok_local = Grok Build CLI on this machine (same lane as Summon grok_local).
const GROK_BIN = process.env.GROK_BIN || (existsSync(join(process.env.USERPROFILE || '', '.grok', 'bin', 'grok.exe'))
  ? join(process.env.USERPROFILE || '', '.grok', 'bin', 'grok.exe')
  : 'grok');
const GROK_MODEL = process.env.GROK_MODEL || 'grok-4.5';
const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || join(DIR, 'snapshots');
const TRIAGE_CHUNK_SIZE = Math.max(4, Math.min(20, Number(process.env.TRIAGE_CHUNK_SIZE) || 12));
const isLocalLlm = () => ['local', 'heuristic', 'offline'].includes(LLM);
const isGrokLlm = () => ['grok', 'grok_local', 'grok-local'].includes(LLM);

// live progress for the UI's triage bar
const progress = { active: false, stage: 'idle', done: 0, total: 0 };

const VOICE = `Write in my voice and make every reply land. I am a sharp, warm, high-agency founder. My texts are casual, mostly lowercase, short (usually one or two lines). Take a clear position, push the thing forward, and close the loop so the ball lands back in their court. Confident, never arrogant. Warm, never needy. Specific, never generic. When it helps, ask the single sharpest question that unblocks the next step. Cut every filler word: no "just checking in", no "hope you're well", no over-explaining, no hedging, no over-thanking. HARD RULES: never use em dashes, use commas, periods, or line breaks instead. No emojis. Never sound like AI or a support bot.`;

const RUBRIC = `Score every chat with importance x urgency.
importance 1-5: 5 = inner circle / money / health / legal / a promise you made; 1 = newsletters, bots, promos, noise.
urgency 1-5: 5 = someone waiting now / deadline today / you are blocking others; 1 = pure FYI.
score = importance * urgency (1-25). classify each as REPLY (say something), TASK (do something first), or NOISE (archive candidate).`;

const SAMPLE = [
  { chatId: 'demo-client', who: 'Client', network: 'WhatsApp', importance: 5, urgency: 5, score: 25, type: 'REPLY+TASK', fate: FATE.BLOCK, replyOwed: true, taskFirst: true,
    summary: 'Needs the final contract review before today\'s deadline.',
    tasks: ['Review the two open clauses.', 'Confirm the final wording.'],
    task: 'Review the two open clauses.', nextStep: 'Review the clauses, then confirm.', nextAction: 'Review the two open clauses.',
    draft: 'reviewing the two open clauses now. i will confirm once that is done' },
  { chatId: 'demo-cofounder', who: 'Co-founder', network: 'WhatsApp', importance: 5, urgency: 4, score: 20, type: 'REPLY', fate: FATE.QUICK, replyOwed: true, taskFirst: false,
    summary: 'Needs a decision on tomorrow\'s launch scope.',
    nextStep: 'Choose the launch scope and reply.', nextAction: 'Choose the launch scope, then review the draft.',
    draft: 'lets keep tomorrow focused on the core flow. can you send the final cut tonight?' },
  { chatId: 'demo-friend', who: 'Friend', network: 'WhatsApp', importance: 4, urgency: 3, score: 12, type: 'REPLY', fate: FATE.QUICK, replyOwed: true, taskFirst: false,
    summary: 'Asked whether you are free for dinner this week.',
    nextStep: 'Choose a day.', nextAction: 'Choose a day, then review the draft.', draft: 'thursday works for me. what time are you thinking?' },
  { chatId: 'demo-spoil', who: 'Spoil Me Club', network: 'X', importance: 1, urgency: 1, score: 1, type: 'NOISE', fate: FATE.LET_GO,
    summary: 'Spam group invite.', nextStep: 'No action.', nextAction: 'No action.', draft: '' },
];

// --- Beeper local API ---
async function beeper(path, opts = {}) {
  const r = await fetch(`${BEEPER_BASE}${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${BEEPER_TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Beeper ${path} -> ${r.status} ${await r.text().catch(() => '')}`);
  return r.status === 204 ? null : r.json();
}

// Who I am, used to detect direct address in group chats. Filled on first use.
let ME = null;
async function whoAmI() {
  if (ME) return ME;
  try {
    const accts = await beeper('/v1/accounts');
    const self = (Array.isArray(accts) ? accts : accts.items || []).find((a) => a.user && a.user.isSelf);
    ME = self ? { id: self.user.id || '', name: self.user.fullName || self.user.displayText || '' } : { id: '', name: '' };
  } catch { ME = { id: '', name: '' }; }
  return ME;
}

// Normalize a Beeper message into the shape fates.mjs expects.
const normMsg = (x) => ({
  isSender: !!x.isSender,
  senderName: x.senderName || '',
  text: stripHtml(x.text || ''),
  timestamp: x.timestamp,
  mentions: x.mentions || [],
});

// Run async jobs with a bounded number in flight. Beeper's local API is fast
// but 900 sequential round-trips is not; 12 at a time keeps it civil.
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

// EVERY chat, across every inbox, archived included. `inbox=primary` (what
// fetchConversations uses for triage) is only 125 of ~900 - low-priority and
// archive are separate buckets the filtered call never returns.
async function fetchAllChats({ withPreviews = true, previewConcurrency = 12, includeArchived = false } = {}) {
  await whoAmI();
  progress.stage = 'fetching every chat';
  const found = new Map();
  let cursor = null;
  for (let page = 0; page < 40; page++) {
    let q = '?limit=200';
    if (cursor) q += `&cursor=${encodeURIComponent(cursor)}&direction=before`;
    const res = await beeper(`/v1/chats/search${q}`);
    const items = res.items || [];
    for (const c of items) found.set(c.id || c.chatID, c);
    progress.total = found.size;
    if (!res.hasMore || !res.oldestCursor || res.oldestCursor === cursor || !items.length) break;
    cursor = res.oldestCursor;
  }
  const all = [...found.values()];
  const archivedCount = all.filter((c) => c.isArchived).length;
  // Dropping archived here is what makes the load fast: ~770 fewer round trips
  // for a collapsed list nobody scrolls. The count still gets surfaced.
  const list = includeArchived ? all : all.filter((c) => !c.isArchived);
  progress.stage = 'reading previews'; progress.total = list.length; progress.done = 0;

  const shape = (c, messages) => ({
    id: c.id || c.chatID,
    title: c.title || c.name,
    network: c.network || c.accountID,
    type: c.type === 'group' ? 'group' : 'single',
    isMuted: !!c.isMuted,
    isArchived: !!c.isArchived,
    unread: c.unreadCount,
    lastActivity: c.lastActivity,
    me: ME,
    messages,
  });

  if (!withPreviews) { const q = list.map((c) => shape(c, [])); q.archivedCount = archivedCount; return q; }

  const out = await pool(list, previewConcurrency, async (c) => {
    let messages = [];
    try {
      const m = await beeper(`/v1/chats/${c.id || c.chatID}/messages?limit=1`);
      messages = (m.items || m || [])
        .filter((x) => x.type !== 'REACTION' && !x.isHidden)
        .map(normMsg)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } catch { /* preview is best-effort; the chat still belongs in the list */ }
    progress.done++;
    return shape(c, messages);
  });
  out.archivedCount = archivedCount;
  return out;
}

// Conversation-level ingest. type and isMuted are load-bearing: the group-burst
// and mute calibration rules depend on them.
async function fetchConversations({ inbox = 'primary', limit = 60, msgs = 15, stage = 'reading chats' } = {}) {
  await whoAmI();
  progress.stage = 'fetching chat list';
  // the API caps limit at 200 per page, so walk pages until we have enough
  const PAGE = 100;
  const found = new Map();
  let cursor = null;
  while (found.size < limit) {
    let q = `?limit=${Math.min(PAGE, limit)}` + (inbox ? `&inbox=${inbox}` : '');
    if (cursor) q += `&cursor=${encodeURIComponent(cursor)}&direction=before`;
    const page = await beeper(`/v1/chats/search${q}`);
    const items = page.items || [];
    for (const c of items) found.set(c.id || c.chatID, c);
    if (!page.hasMore || !page.oldestCursor || page.oldestCursor === cursor || !items.length) break;
    cursor = page.oldestCursor;
  }
  const list = [...found.values()].filter((c) => !c.isArchived).slice(0, limit);
  progress.stage = stage; progress.total = list.length; progress.done = 0;
  const out = [];
  for (const c of list) {
    let messages = [];
    try {
      const m = await beeper(`/v1/chats/${c.id || c.chatID}/messages?limit=${msgs}`);
      messages = (m.items || m || [])
        .filter((x) => x.type !== 'REACTION' && !x.isHidden)
        .map(normMsg)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } catch {}
    out.push({
      id: c.id || c.chatID,
      title: c.title || c.name,
      network: c.network || c.accountID,
      type: c.type === 'group' ? 'group' : 'single',
      isMuted: !!c.isMuted,
      unread: c.unreadCount,
      me: ME,
      messages,
    });
    progress.done++;
  }
  return out;
}
const fetchInbox = fetchConversations;

function avatarUrlFor(conversation) {
  const direct = conversation?.imgUrl || conversation?.imgURL || conversation?.avatarUrl || null;
  if (direct) return direct;
  if (conversation?.source === 'whatsapp-direct' || isWhatsAppChatId(conversation?.id)) {
    return `/api/wa/avatar?id=${encodeURIComponent(conversation.id)}`;
  }
  return null;
}

async function transcriptFor(chatId, limit = 40) {
  if (isWhatsAppChatId(chatId)) {
    return getWhatsAppMessages(chatId, limit)
      .map((x) => `${x.isSender ? 'Me' : (x.senderName || 'Them')}: ${x.text || '[media]'}`)
      .join('\n');
  }
  if (!BEEPER_ENABLED) throw new Error('This chat source is not connected.');
  const m = await beeper(`/v1/chats/${chatId}/messages?limit=${limit}`);
  const items = (m.items || m || []).slice().reverse();
  return items.map((x) => `${x.isSender ? 'Me' : (x.senderName || 'Them')}: ${x.text || '[media]'}`).join('\n');
}

// --- full thread history ---
// NOTE: Beeper's local API IGNORES ?limit and always returns 20 items per page.
// The only way to get real history is to walk `oldestCursor` with
// direction=before until hasMore is false. Do not "fix" this by raising limit.
const PAGE_CAP = 200;             // max pages to walk (~4000 messages)
const THREAD_TTL_MS = 5 * 60_000; // cache full transcripts briefly
const threadCache = new Map();    // chatId -> { at, data }

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|ol|div)>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, (m, href, txt) =>
      href.startsWith('https://matrix.to') ? txt : (txt && txt !== href ? `${txt} (${href})` : href))
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const utcStamp = (iso) => {
  const d = new Date(iso), p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

async function fullTranscript(chatId, { maxMessages = 4000 } = {}) {
  const hit = threadCache.get(chatId);
  if (hit && Date.now() - hit.at < THREAD_TTL_MS) return hit.data;

  if (isWhatsAppChatId(chatId)) {
    const all = getWhatsAppMessages(chatId, maxMessages);
    const first = all[0]?.timestamp || null;
    const last = all[all.length - 1]?.timestamp || null;
    const data = {
      transcript: all.map((m) => `[${utcStamp(m.timestamp)}] ${m.isSender ? 'Me' : (m.senderName || 'Them')}: ${String(m.text || '[media]').replace(/\n/g, '\n    ')}`).join('\n'),
      count: all.length,
      truncated: all.length >= maxMessages,
      first: first ? utcStamp(first) : null,
      last: last ? utcStamp(last) : null,
      range: first && last ? `${utcStamp(first)} to ${utcStamp(last)} UTC` : '',
    };
    threadCache.set(chatId, { at: Date.now(), data });
    return data;
  }

  if (!BEEPER_ENABLED) throw new Error('This chat source is not connected.');

  const byId = new Map();
  let cursor = null, pages = 0, truncated = false;
  while (pages < PAGE_CAP) {
    let path = `/v1/chats/${encodeURIComponent(chatId)}/messages?limit=100`;
    if (cursor) path += `&cursor=${encodeURIComponent(cursor)}&direction=before`;
    const j = await beeper(path);
    for (const m of j.items || []) byId.set(m.id, m);
    pages++;
    if (byId.size >= maxMessages) { truncated = true; break; }
    if (!j.hasMore || !j.oldestCursor || j.oldestCursor === cursor) break;
    cursor = j.oldestCursor;
  }

  const all = [...byId.values()].sort((a, b) => Number(a.sortKey) - Number(b.sortKey));
  const lines = [];
  let count = 0, first = null, last = null;
  for (const m of all) {
    if (m.type === 'REACTION' || m.isHidden) continue; // folded onto their target below
    const ts = m.timestamp;
    if (!first || ts < first) first = ts;
    if (!last || ts > last) last = ts;
    let body = m.isDeleted ? '[deleted message]' : stripHtml(m.text);
    const atts = m.attachments || [];
    if (atts.length) {
      const tags = atts.map((a) => `[${(a.type || m.type || 'file').toUpperCase()}${a.fileName ? ': ' + a.fileName : ''}]`).join(' ');
      body = body ? `${tags} ${body}` : tags;
    } else if (!body && m.type && m.type !== 'TEXT') body = `[${m.type}]`;
    if (!body) continue;
    if (m.reactions && m.reactions.length) {
      body += `  (reactions: ${m.reactions.map((r) => r.reactionKey || 'emoji').join(', ')})`;
    }
    lines.push(`[${utcStamp(ts)}] ${m.isSender ? 'Me' : (m.senderName || 'Them')}: ${body.replace(/\n/g, '\n    ')}`);
    count++;
  }
  const data = {
    transcript: lines.join('\n'),
    count,
    truncated,
    first: first ? utcStamp(first) : null,
    last: last ? utcStamp(last) : null,
    range: first && last ? `${utcStamp(first)} to ${utcStamp(last)} UTC` : '',
  };
  threadCache.set(chatId, { at: Date.now(), data });
  return data;
}

async function searchChats(q) {
  const r = await beeper(`/v1/chats/search?query=${encodeURIComponent(q)}&type=single&limit=6`);
  return (r.items || []).map((c) => ({ id: c.id || c.chatID, who: c.title || c.name, network: c.network || c.accountID }));
}

// --- LLM backends (cli = Claude subscription, grok_local = Grok Build CLI, api = Anthropic paygo) ---
function runClaudeCli(prompt) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // force subscription auth, not the API
    const child = spawn(CLAUDE_BIN, ['-p', '--output-format', 'json', '--model', CLI_MODEL], { env, cwd: tmpdir(), shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(new Error(`Could not run "${CLAUDE_BIN}". Is Claude Code installed and logged in? ${e.message}`)));
    child.on('close', (code) => {
      // Claude often puts the human-readable error in stdout JSON.result, not stderr.
      let fromJson = '';
      try { fromJson = JSON.parse(out).result || JSON.parse(out).error || ''; } catch { /* ignore */ }
      const detail = [fromJson, err, out].map((s) => String(s || '').trim()).find(Boolean) || '(no output)';
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${detail.slice(0, 400)}`));
      try { resolve(JSON.parse(out).result ?? ''); } catch { reject(new Error(`Unexpected claude output: ${out.slice(0, 300)}`)); }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function runGrokCli(prompt) {
  return new Promise((resolve, reject) => {
    // Long ranking prompts exceed Windows argv limits, so use --prompt-file.
    const promptPath = join(tmpdir(), `cleared-chat-grok-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(promptPath, prompt, 'utf8');
    const cleanup = () => { try { if (existsSync(promptPath)) unlinkSync(promptPath); } catch { /* ignore */ } };
    const args = [
      '--prompt-file', promptPath,
      '--output-format', 'plain',
      '--model', GROK_MODEL,
      '--disable-web-search',
      '--no-subagents',
      '--no-plan',
      '--permission-mode', 'bypassPermissions',
    ];
    const env = { ...process.env };
    const grokDir = dirname(GROK_BIN);
    if (grokDir && grokDir !== '.') {
      env.Path = `${grokDir};${env.Path || env.PATH || ''}`;
      env.PATH = env.Path;
    }
    const child = spawn(GROK_BIN, args, { env, cwd: tmpdir(), shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      cleanup();
      reject(new Error(`Could not run "${GROK_BIN}". Is Grok Build installed at ~/.grok/bin? ${e.message}`));
    });
    child.on('close', (code) => {
      cleanup();
      const detail = [err, out].map((s) => String(s || '').trim()).find(Boolean) || '(no output)';
      if (code !== 0) return reject(new Error(`grok exited ${code}: ${detail.slice(0, 400)}`));
      resolve(out.trim());
    });
  });
}

async function completeText(prompt, maxTokens = 2000) {
  if (isLocalLlm()) {
    // Drafts / chat box without a model: return a short note, never 500.
    return '(local mode: no model for free-form drafts. Set LLM=grok or wait for Claude at 4pm SGT.)';
  }
  if (isGrokLlm()) return runGrokCli(prompt);
  if (LLM === 'api') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: API_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) throw new Error(`Anthropic -> ${r.status} ${await r.text().catch(() => '')}`);
    const data = await r.json();
    return (data.content || []).map((b) => b.text || '').join('');
  }
  return runClaudeCli(prompt);
}

// Local ranking when Claude CLI is rate-limited and API has no credits.
// Uses conversation physics only (turn-taking, acks, money, questions, relationship weight).
// No drafts in your voice, so leave draft empty or use a holding stub.
function localHeuristicRank(chats, now = new Date()) {
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || lo));
  return chats.map((c) => {
    const state = deriveState(c, now);
    const weight = relationshipWeight(c, now);
    const network = String(c.network || '');
    const isX = /twitter|\bx\b/i.test(network);
    let importance = 2;
    let urgency = 2;
    let proposed = FATE.LET_GO;
    let reason = '';
    let summary = (state.theirLastText || '').slice(0, 140) || '(no text)';
    let nextStep = 'none';
    let minutes = 0;
    let deliverable = '';
    let draft = '';
    const latestAsk = String(state.theirLastText || '');
    const openAsk = String(state.openIncomingText || latestAsk);
    const asksForFiles = /\b(send|share|forward)\b[^.!?]{0,90}\b(photo|picture|document|file|screenshot)s?\b/i.test(openAsk);
    const needsHousingDecision = /\b(somewhere else|place to stay|where (?:will|can|are) you stay|do you have .*bed)\b/i.test(openAsk);
    const deadlineAsk = String(state.sharedDeadlineText || latestAsk);
    const sharedDeadline = /\b(check[ -]?out|submit|fill (?:in|out)|book|order|pay)\b/i.test(deadlineAsk)
      && /\b(today|tonight|tomorrow|tmr|by \d|by noon|by 12|asap)\b/i.test(deadlineAsk);

    if (isX) {
      importance = 1; urgency = 1; proposed = FATE.LET_GO;
      reason = 'Twitter/X is noise per me.md.';
      nextStep = 'Archive.';
    } else if (state.empty) {
      proposed = FATE.UNCLEAR; reason = 'No readable messages.';
    } else if (!state.ballInMyCourt) {
      if (state.myOpenPromise) {
        proposed = FATE.BLOCK;
        importance = clamp(Math.round(3 + weight * 2), 3, 5);
        urgency = clamp(3 + Math.min(2, Math.floor((state.myOpenPromise.ageDays || 0) / 7)), 3, 5);
        reason = 'Open promise still on me.';
        nextStep = 'Do the thing you promised, then reply.';
        minutes = 20; deliverable = state.myOpenPromise.text.slice(0, 100);
      } else {
        proposed = FATE.WAITING;
        importance = clamp(Math.round(2 + weight * 3), 1, 5);
        urgency = 2;
        reason = 'You spoke last.';
        nextStep = 'Wait.';
      }
    } else if (state.isGroup && state.othersBurst >= 5 && !state.directlyAddressed) {
      proposed = FATE.LET_GO; importance = 2; urgency = 1;
      reason = `Group burst (${state.othersBurst}), not addressed to you.`;
    } else if (state.isAckOnly && !state.hasQuestion) {
      proposed = FATE.LET_GO; importance = 2; urgency = 1;
      reason = 'Ack-only last message.';
    } else if (asksForFiles) {
      proposed = FATE.BLOCK;
      importance = clamp(Math.round(3 + weight * 2), 3, 5);
      urgency = 4;
      reason = 'They need files or photos before they can continue.';
      nextStep = 'Create and send the requested files or photos.';
      minutes = 15; deliverable = 'Create and send the requested files or photos.';
    } else if (needsHousingDecision) {
      proposed = FATE.BLOCK;
      importance = 5; urgency = 5;
      reason = 'A housing decision is needed before replying.';
      nextStep = 'Confirm where you will stay, then reply.';
      minutes = 15; deliverable = 'Confirm where you will stay.';
    } else if (sharedDeadline) {
      proposed = FATE.BLOCK;
      importance = 5; urgency = 5;
      reason = 'A time-sensitive group obligation applies to you.';
      nextStep = 'Complete or confirm the requested action before the deadline.';
      minutes = 20; deliverable = 'Complete or confirm the group request before the deadline.';
    } else if (state.mentionsMoney) {
      proposed = FATE.BLOCK;
      importance = 5;
      urgency = clamp(3 + Math.min(2, Math.floor((state.daysSinceLast || 0) / 7)), 3, 5);
      reason = 'Money in play, ball in your court.';
      nextStep = /payment link/i.test(latestAsk)
        ? 'Verify the amount and pay the correct link.'
        : 'Settle or reply on payment.';
      minutes = 15; deliverable = nextStep;
    } else if (state.hasQuestion) {
      proposed = FATE.QUICK;
      importance = clamp(Math.round(2 + weight * 3), 2, 5);
      urgency = clamp(3 + Math.min(2, Math.floor((state.daysSinceLast || 0) / 7)), 3, 5);
      reason = 'Direct question waiting on you.';
      nextStep = 'Answer the question.';
      draft = ''; // no voice model available offline
    } else {
      // They spoke last, but a local rules engine cannot infer intent safely.
      // Keep it available for review without inflating the reply-owed queue.
      importance = clamp(Math.round(1 + weight * 4), 1, 5);
      urgency = clamp(2 + Math.min(3, Math.floor((state.daysSinceLast || 0) / 7)), 2, 5);
      proposed = FATE.UNCLEAR;
      reason = 'They spoke last, but no clear ask was detected without a model.';
      nextStep = 'Skim once and decide whether to reply or let go.';
    }

    const base = importance * urgency;
    return {
      chatId: c.id || c.chatID,
      who: c.title || c.name || 'unknown',
      network,
      importance,
      urgency,
      score: base,
      fate: proposed,
      reason,
      summary,
      nextStep,
      minutes,
      deliverable,
      draft,
      weight,
    };
  });
}

// --- ranking ---
// Everything sent to a model is redacted first. Personal messages are the most
// sensitive data a person owns.
function forModel(convs) {
  return convs.map((c) => ({
    chatId: c.id, who: c.title, network: c.network, type: c.type, muted: c.isMuted,
    unreadCount: Math.max(0, Number(c.unreadCount || c.unread) || 0),
    userPlan: c.userPlan ? {
      outcome: c.userPlan.outcome,
      explanation: redact(c.userPlan.explanation),
      task: redact(c.userPlan.task),
      stale: Boolean(c.userPlan.stale),
    } : undefined,
    messages: (c.messages || []).slice(-30).map((m) => ({
      from: m.isSender ? 'me' : (m.senderName || 'them'),
      at: m.timestamp,
      kind: m.kind || 'text',
      text: redact(m.text).slice(0, m.kind === 'voice' ? 1800 : 700),
    })),
  }));
}

function rankPrompt(chats) {
  return `${RUBRIC}

${VOICE}

You are triaging a messaging inbox, led by WhatsApp. Judge each CONVERSATION on its whole state, never on the last message alone.
Messages marked "me" are examples of Adam's real writing to this person. When drafting, study those examples and match his relationship-specific casing, length, directness, warmth, and vocabulary. Prefer the real examples over a generic assistant voice.

Assign every conversation exactly ONE fate:
- F1_QUICK: I can answer in under 2 minutes. Draft the reply in my register for that person.
- F2_BLOCK: real work must happen before the complete answer. Give the exact task, minutes, and deliverable. Also draft a short honest holding reply that acknowledges the request and moves the loop forward without inventing a deadline.
- F3_WAITING: the ball is already in their court. No reply is owed and draft must be empty.
- F4_LET_GO: no action needed. Group chatter, reactions, banter, social noise. MOST conversations are this.
- UNCLEAR: intent genuinely unreadable. Use this instead of guessing. Never invent context.

Before writing any draft, apply a clarity gate:
- If the reply depends on a choice or fact Adam has not supplied, do not draft yet.
- Missing choices or facts include yes/no decisions, availability, dates, amounts, links, attachments, commitments, promises, or the outcome Adam wants.
- Set needsClarification to true, ask one specific clarifyingQuestion that unlocks the reply, and leave draft empty.
- Do not use placeholders and do not hide uncertainty inside a generic holding reply.
- If the transcript and Adam's stated preferences are enough to write safely, set needsClarification to false and clarifyingQuestion to "".

Calibration, these matter:
- A group burst is usually zero tasks. Default groups to F4_LET_GO unless I am directly addressed or named.
- Recency is not importance. An old message from someone who matters outranks 40 messages from this morning.
- "ok cool" after a resolved thread is F4_LET_GO, not a reply prompt.
- If I sent the last message, it is F3_WAITING, not F1_QUICK.
- A non-stale userPlan is Adam's explicit explanation and desired outcome. Follow it. A stale plan is context only because a newer message arrived.

Return EXACTLY one object per input chat, no skips or merges:
chatId, who, network, importance (1-5), urgency (1-5), score (importance*urgency),
fate (F1_QUICK | F2_BLOCK | F3_WAITING | F4_LET_GO | UNCLEAR),
reason (ONE line saying why this fate),
summary (one line), nextStep (concrete next action),
minutes (integer estimate, only for F2_BLOCK, else 0),
tasks (an ordered JSON array of every concrete prerequisite before the complete reply for F2_BLOCK, else []),
task (a short summary of the first prerequisite for F2_BLOCK, else ""),
deliverable (one line, only for F2_BLOCK, else ""),
needsClarification (boolean),
clarifyingQuestion (one specific question for Adam when needsClarification is true, else ""),
draft (an unsent reply in my voice only when no clarification is needed, else "").
Respond with ONLY a JSON array, no prose.

CHATS:
${JSON.stringify(forModel(chats))}`;
}
function parseItems(text) {
  const raw = String(text || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`Model did not return a JSON array. Got: ${raw.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1));
}

function parseObject(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`Model did not return a JSON object. Got: ${raw.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1));
}

function needsModelTriage(conv, now) {
  const state = deriveState(conv, now);
  if (state.empty) return false;
  if (!state.ballInMyCourt && !state.myOpenPromise) return false;
  if (state.isGroup && state.othersBurst >= 5 && !state.directlyAddressed) return false;
  if (state.isAckOnly && !state.hasQuestion) return false;
  if (state.isMuted && !state.directlyAddressed) return false;
  return true;
}

const modelUnavailable = (message) => /weekly limit|rate.?limit|429|credit balance|too low|exited 1|Could not run/i.test(String(message || ''));

async function rankModelBatch(chats) {
  try {
    const parsed = parseItems(await completeText(rankPrompt(chats), 6000));
    const allowed = new Set(chats.map((c) => c.id));
    const found = new Map();
    for (const row of parsed) {
      if (row && allowed.has(row.chatId) && !found.has(row.chatId)) found.set(row.chatId, row);
    }
    const missing = chats.filter((c) => !found.has(c.id));
    if (!missing.length) return [...found.values()];
    if (missing.length === chats.length && chats.length > 1) {
      const mid = Math.ceil(chats.length / 2);
      return [...await rankModelBatch(chats.slice(0, mid)), ...await rankModelBatch(chats.slice(mid))];
    }
    if (missing.length === 1 && chats.length === 1) throw new Error(`Model omitted chat ${chats[0].id}`);
    return [...found.values(), ...await rankModelBatch(missing)];
  } catch (error) {
    if (modelUnavailable(error?.message || error) || chats.length === 1) throw error;
    const mid = Math.ceil(chats.length / 2);
    return [...await rankModelBatch(chats.slice(0, mid)), ...await rankModelBatch(chats.slice(mid))];
  }
}

async function rankCompleteInbox(chats, now) {
  const fallback = localHeuristicRank(chats, now);
  if (isLocalLlm()) {
    return { proposed: fallback, llmUsed: LLM, llmNote: 'Offline heuristics; drafts are unavailable until a model is connected.' };
  }

  const targets = chats.filter((c) => needsModelTriage(c, now));
  const ranked = new Map();
  const notes = [];
  let llmUsed = LLM;
  progress.total = targets.length;
  progress.done = 0;

  for (let i = 0; i < targets.length; i += TRIAGE_CHUNK_SIZE) {
    const chunk = targets.slice(i, i + TRIAGE_CHUNK_SIZE);
    const part = Math.floor(i / TRIAGE_CHUNK_SIZE) + 1;
    const parts = Math.ceil(targets.length / TRIAGE_CHUNK_SIZE);
    progress.stage = `${isGrokLlm() ? `ranking with grok (${GROK_MODEL})` : 'ranking with claude'} ${part}/${parts}`;
    try {
      for (const row of await rankModelBatch(chunk)) ranked.set(row.chatId, row);
    } catch (error) {
      const message = String(error?.message || error);
      notes.push(`Model could not rank ${chunk.length} chat(s): ${message.slice(0, 160)}`);
      llmUsed = 'partial-local-fallback';
      if (modelUnavailable(message)) {
        notes.push('The model is unavailable, so remaining chats use local classification and have no generated draft.');
        break;
      }
    }
    progress.done = Math.min(targets.length, i + chunk.length);
  }

  const fallbackById = new Map(fallback.map((row) => [row.chatId, row]));
  return {
    proposed: chats.map((c) => ranked.get(c.id) || fallbackById.get(c.id)),
    llmUsed,
    llmNote: notes.join(' '),
  };
}

async function repairMissingDrafts(items, conversations) {
  const missing = items.filter((it) => it.replyOwed && !it.needsClarification && !String(it.draft || '').trim());
  if (!missing.length || isLocalLlm()) return '';
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const notes = [];

  for (let i = 0; i < missing.length; i += TRIAGE_CHUNK_SIZE) {
    const chunk = missing.slice(i, i + TRIAGE_CHUNK_SIZE);
    const context = chunk.map((it) => ({
      chatId: it.chatId,
      who: it.who,
      taskFirst: it.taskFirst,
      tasks: it.tasks,
      task: it.task,
      summary: it.summary,
      userPlan: it.userPlan ? {
        outcome: it.userPlan.outcome,
        explanation: it.userPlan.explanation,
        task: it.userPlan.task,
      } : undefined,
      messages: forModel([byId.get(it.chatId)]).at(0)?.messages || [],
    }));
    const prompt = `${VOICE}

Decide whether one short, unsent reply can be written safely for every conversation below.
- Study messages from "me" and match Adam's actual style with this person, including casing, length, directness, warmth, and vocabulary.
- Use only facts in the messages, summary, and task. Never invent a date, promise, attachment, or completed action.
- If taskFirst is true, acknowledge the request and state the honest next step without pretending the task is done.
- If a missing choice or fact changes what Adam should say, set needsClarification to true, ask one specific clarifyingQuestion, and leave draft empty.
- Return ONLY a JSON array with exactly one object per input: chatId, needsClarification, clarifyingQuestion, draft.

CONVERSATIONS:
${JSON.stringify(context)}`;
    try {
      const rows = parseItems(await completeText(prompt, 4000));
      const rowById = new Map(rows.filter((row) => row?.chatId).map((row) => [row.chatId, row]));
      for (const item of chunk) {
        const row = rowById.get(item.chatId);
        if (!row) continue;
        const needsClarification = row.needsClarification === true
          || String(row.needsClarification || '').toLowerCase() === 'true';
        item.needsClarification = needsClarification;
        item.clarifyingQuestion = needsClarification ? String(row.clarifyingQuestion || '').trim() : '';
        item.draft = needsClarification ? '' : String(row.draft || '');
      }
    } catch (error) {
      notes.push(`Could not generate ${chunk.length} missing draft(s): ${String(error?.message || error).slice(0, 140)}`);
      if (modelUnavailable(error?.message || error)) break;
    }
  }

  for (const item of items) {
    if (item.replyOwed && item.needsClarification) item.draftStatus = 'needs-clarification';
    else if (item.replyOwed && !String(item.draft || '').trim()) item.draftStatus = 'model-required';
  }
  return notes.join(' ');
}

const FATE_LABEL = {
  [FATE.QUICK]: 'Quick (under 2 min)',
  [FATE.BLOCK]: 'Blocked on real work',
  [FATE.WAITING]: 'Waiting on them',
  [FATE.LET_GO]: 'Let go',
  [FATE.UNCLEAR]: 'Unclear',
};

function snapshotMarkdown(items, now) {
  const of = (f) => items.filter((i) => i.fate === f);
  const n = (f) => of(f).length;
  let md = `# cleared.chat triage · ${now.toLocaleString()}\n\n`;
  md += `${items.length} conversations · ${n(FATE.QUICK)} quick · ${n(FATE.BLOCK)} blocked · `;
  md += `${n(FATE.WAITING)} waiting · ${n(FATE.LET_GO)} let go · ${n(FATE.UNCLEAR)} unclear\n\n`;

  for (const f of [FATE.BLOCK, FATE.QUICK, FATE.WAITING, FATE.UNCLEAR]) {
    const rows = of(f);
    if (!rows.length) continue;
    md += `## ${FATE_LABEL[f]} (${rows.length})\n\n`;
    rows.forEach((it, i) => {
      md += `${i + 1}. [${it.score}] ${it.who} (${it.network})`;
      if (it.daysWaiting) md += ` · ${it.daysWaiting}d waiting`;
      if (it.calibrated) md += ` · calibrated`;
      md += `\n`;
      if (it.reason) md += `   Why: ${it.reason}\n`;
      if (it.summary) md += `   ${it.summary}\n`;
      const tasks = Array.isArray(it.tasks) && it.tasks.length ? it.tasks : (it.task ? [it.task] : []);
      tasks.forEach((task, taskIndex) => { md += `   Task ${taskIndex + 1}: ${task}\n`; });
      if (f === FATE.BLOCK && it.deliverable) md += `   Deliverable: ${it.deliverable} (~${it.minutes || '?'} min)\n`;
      if (it.nextAction || it.nextStep) md += `   Next action: ${it.nextAction || it.nextStep}\n`;
      if (it.needsClarification && it.clarifyingQuestion) md += `   Before drafting: ${it.clarifyingQuestion}\n`;
      if (it.draft) md += `   Draft: ${it.draft}\n`;
      md += `\n`;
    });
  }
  const letGo = of(FATE.LET_GO);
  if (letGo.length) {
    md += `## Let go (${letGo.length}) - no reply owed\n`;
    letGo.forEach((it) => { md += `- ${it.who} (${it.network})${it.reason ? ` · ${it.reason}` : ''}\n`; });
  }
  return md;
}

function writeSnapshot(items) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const now = new Date();
  const md = snapshotMarkdown(items, now);
  const file = `triage-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`;
  writeFileSync(join(SNAPSHOT_DIR, file), md);
  writeFileSync(join(SNAPSHOT_DIR, 'triage-latest.md'), md);
  return { dir: SNAPSHOT_DIR, file, when: now.toLocaleString() };
}

function trySnapshot(items) {
  try { return writeSnapshot(items); } catch (e) { return { error: String(e.message || e) }; }
}

async function getRankedInbox({ scope = 'all' } = {}) {
  progress.active = true; progress.stage = 'starting'; progress.done = 0; progress.total = 0;
  try {
    if (DEMO) return { demo: true, items: SAMPLE, snapshot: trySnapshot(SAMPLE) };
    if (LLM === 'api' && !ANTHROPIC_KEY) throw new Error('LLM=api needs ANTHROPIC_API_KEY (or use LLM=cli / LLM=grok / LLM=local).');
    progress.stage = 'fetching chat list';
    const [beeperChats, gmail] = await Promise.all([
      BEEPER_ENABLED ? fetchInbox().catch((e) => { console.error('[beeper]', e.message || e); return []; }) : Promise.resolve([]),
      EMAIL_ENABLED && gmailConfigured() ? fetchGmailInbox().catch((e) => ({ items: [], accounts: [], errors: [{ error: String(e.message || e) }] })) : Promise.resolve({ items: [], accounts: [], errors: [] }),
    ]);
    let waChats = [];
    if (WHATSAPP_DIRECT) {
      try {
        await ensureWhatsAppStarted();
        await hydrateWhatsAppGroupNames();
        waChats = listWhatsAppChats({ includeArchived: false });
      } catch (e) {
        console.error('[whatsapp-direct]', typeof e?.message === 'string' ? e.message : 'WhatsApp source unavailable');
      }
    }
    let discordChats = [];
    let discordError = null;
    if (discordConfigured()) {
      const d = await fetchDiscordDMs(40);
      discordChats = d.items;
      discordError = d.error;
    }
    let chats = [...beeperChats, ...gmail.items, ...waChats, ...discordChats];
    if (scope === 'whatsapp-triage') {
      const now = new Date();
      chats = chats.filter((chat) => {
        if (chat.source !== 'whatsapp-direct' || chat.isArchived) return false;
        const state = deriveState(chat, now);
        const unread = Number(chat.unreadCount ?? chat.unread) > 0;
        return !state.empty && (unread || state.ballInMyCourt || state.myOpenPromise);
      });
    } else if (scope === 'whatsapp-open') {
      const now = new Date();
      chats = chats.filter((chat) => {
        if (chat.source !== 'whatsapp-direct' || chat.isArchived) return false;
        const state = deriveState(chat, now);
        return !state.empty && (state.ballInMyCourt || state.myOpenPromise);
      });
    } else if (scope === 'whatsapp-unread') {
      chats = chats.filter((chat) => (
        chat.source === 'whatsapp-direct'
        && Number(chat.unreadCount ?? chat.unread) > 0
        && !chat.isArchived
      ));
    } else if (scope === 'unread') {
      chats = chats.filter((chat) => Number(chat.unreadCount ?? chat.unread) > 0 && !chat.isArchived);
    }
    if (!chats.length) {
      if (scope !== 'all') {
        throw new Error(scope === 'whatsapp-open' || scope === 'whatsapp-triage'
          ? 'No active WhatsApp conversations currently look like your turn.'
          : 'No unread chats were found in the current local snapshot.');
      }
      const wa = whatsAppStatus().status;
      throw new Error(WHATSAPP_DIRECT && wa !== 'open'
        ? 'Connect WhatsApp in Settings, then run triage again.'
        : 'No messaging source is connected. Open Settings to connect one.');
    }
    const now = new Date();
    const chatPlans = readChatPlans(CHAT_PLANS_FILE());
    chats = chats.map((chat) => {
      const latest = (chat.messages || []).at(-1);
      const version = String(latest?.timestamp || chat.lastActivity || latest?.key || '');
      const userPlan = planForConversation(chatPlans, chat.id, version);
      return userPlan ? { ...chat, userPlan } : chat;
    });
    const rankedResult = await rankCompleteInbox(chats, now);
    const { proposed, llmUsed } = rankedResult;
    let llmNote = rankedResult.llmNote || '';

    // The model (or heuristic) proposes, the calibration rules dispose.
    progress.stage = 'calibrating fates';
    const byId = new Map(chats.map((c) => [c.id, c]));
    let items = proposed.map((it) => {
      const conv = byId.get(it.chatId);
      if (!conv) return { ...it, fate: it.fate || FATE.UNCLEAR };
      const latest = (conv.messages || []).at(-1);
      const conversationVersion = String(latest?.timestamp || conv.lastActivity || latest?.key || '');
      const { fate, reason, overridden, state } = assignFate(conv, it.fate, now);
      const days = state.daysSinceLast || 0;
      const ageBoost = Math.min(Math.floor(days / 7), 8);
      const base = (Number(it.importance) || 3) * (Number(it.urgency) || 3);
      const replyOwed = state.ballInMyCourt && (fate === FATE.QUICK || fate === FATE.BLOCK);
      const proposedTasks = Array.isArray(it.tasks) ? it.tasks : [];
      const tasks = fate === FATE.BLOCK
        ? [...new Set([
            ...proposedTasks,
            it.task || it.deliverable || it.nextStep || '',
          ].map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 8)
        : [];
      const task = tasks[0] || '';
      const needsClarification = replyOwed && (
        it.needsClarification === true
        || String(it.needsClarification || '').toLowerCase() === 'true'
      );
      const clarifyingQuestion = needsClarification
        ? String(it.clarifyingQuestion || 'What outcome do you want from this reply?').trim()
        : '';
      const nextAction = needsClarification
        ? `Answer before drafting: ${clarifyingQuestion}`
        : replyOwed
        ? (fate === FATE.BLOCK
          ? (task || it.deliverable || it.nextStep || 'Identify and complete the prerequisite, then review the draft.')
          : (it.nextStep || 'Review the unsent draft, then reply manually in WhatsApp.'))
        : (it.nextStep || (state.ballInMyCourt ? 'Review this conversation and decide whether a reply is needed.' : 'No action.'));
      return applyChatPlan({
        ...it, fate,
        reason: overridden ? reason : (it.reason || reason || ''),
        calibrated: overridden,
        score: base + ageBoost, base, ageBoost,
        daysWaiting: Math.round(days),
        weight: relationshipWeight(conv, now),
        unreadCount: Math.max(0, Number(conv.unreadCount ?? conv.unread) || 0),
        replyOwed,
        taskFirst: fate === FATE.BLOCK,
        tasks,
        task,
        needsClarification,
        clarifyingQuestion,
        nextAction,
        avatarUrl: avatarUrlFor(conv),
        conversationVersion,
        // Only a conversation where they spoke last may carry a send-ready draft.
        draft: replyOwed && !needsClarification ? (it.draft || '') : '',
      }, conv.userPlan);
    });
    const solvedChats = readSolvedChats();
    items = items.filter((item) => !solvedMatches(item, solvedChats));
    const draftNote = await repairMissingDrafts(items, chats);
    if (draftNote) llmNote = [llmNote, draftNote].filter(Boolean).join(' ');
    items.sort(compareTriagePriority);
    // Never ship em dashes into the UI or drafts (Adam voice rule).
    const stripEm = (s) => String(s || '').replace(/\u2014/g, ',').replace(/\u2013/g, '-');
    for (const it of items) {
      if (it.draft) it.draft = stripEm(it.draft);
      if (it.summary) it.summary = stripEm(it.summary);
      if (it.reason) it.reason = stripEm(it.reason);
      if (it.nextStep) it.nextStep = stripEm(it.nextStep);
      if (it.nextAction) it.nextAction = stripEm(it.nextAction);
      if (it.deliverable) it.deliverable = stripEm(it.deliverable);
      if (it.task) it.task = stripEm(it.task);
      if (Array.isArray(it.tasks)) it.tasks = it.tasks.map(stripEm).filter(Boolean);
      if (it.clarifyingQuestion) it.clarifyingQuestion = stripEm(it.clarifyingQuestion);
    }
    const eightyTwenty = buildEightyTwenty(items);
    progress.stage = 'saving snapshot';
    const result = {
      demo: false, scope, llm: llmUsed, note: llmNote || undefined, items, eightyTwenty,
      beeper: { configured: BEEPER_ENABLED, count: beeperChats.length },
      whatsappDirect: { enabled: WHATSAPP_DIRECT, count: waChats.length, ...(await whatsAppStatusForUi()) },
      gmail: { enabled: EMAIL_ENABLED, configured: EMAIL_ENABLED && gmailConfigured(), accounts: gmail.accounts, errors: gmail.errors },
      discord: { configured: discordConfigured(), count: discordChats.length, error: discordError },
      snapshot: trySnapshot(items),
    };
    try { writeFileSync(INBOX_CACHE_FILE(), JSON.stringify({ ...result, cachedAt: now.toISOString() })); } catch {}
    return result;
  } finally {
    progress.active = false; progress.stage = 'idle';
  }
}

// Markdown export of a whole conversation: front matter with real counts and
// a date range, then every message. Gmail threads only have metadata locally,
// so they export what we actually have rather than pretending otherwise.
async function exportChatMarkdown(chatId, who) {
  const now = new Date();
  if (String(chatId).startsWith('gmail:')) {
    return [
      `# ${who}`,
      '',
      `Exported ${now.toISOString().slice(0, 10)} from cleared.chat.`,
      '',
      'Only subject and snippet are stored locally for email, so the full body',
      'is not available here. Open the thread in Gmail for the complete text.',
      '',
    ].join('\n');
  }
  const t = await fullTranscript(chatId);
  const lines = String(t.transcript || '').split('\n');
  return [
    `# ${who}`,
    '',
    `- Exported: ${now.toISOString().slice(0, 19).replace('T', ' ')}`,
    `- Messages: ${t.count}${t.truncated ? ' (truncated at the page cap)' : ''}`,
    t.range ? `- Range: ${t.range}` : '',
    `- Chat id: \`${chatId}\``,
    '',
    '---',
    '',
    ...lines,
    '',
  ].filter((x) => x !== '').join('\n');
}

function voiceNotesMarkdown(chatId, who) {
  if (!isWhatsAppChatId(chatId)) throw new Error('Voice-note export is available for WhatsApp chats.');
  return buildVoiceNotesMarkdown({
    who,
    messages: getWhatsAppMessages(chatId, 4000),
  });
}

const INBOX_CACHE_FILE = () => join(SNAPSHOT_DIR, 'inbox-latest.json');
const SOLVED_CHATS_FILE = () => join(SNAPSHOT_DIR, 'solved-chats.json');
const CHAT_PLANS_FILE = () => join(SNAPSHOT_DIR, 'chat-plans.json');

function readSolvedChats() {
  try { return JSON.parse(readFileSync(SOLVED_CHATS_FILE(), 'utf8')); }
  catch { return {}; }
}

function solvedMatches(item, solved = readSolvedChats()) {
  const chatId = item?.chatId || item?.id;
  const conversationVersion = item?.conversationVersion || item?.lastAt;
  const record = solved?.[chatId];
  return Boolean(record && String(record.conversationVersion || '') === String(conversationVersion || ''));
}

function buildEightyTwenty(items) {
  const action = items.filter((item) => item.fate === FATE.BLOCK || item.fate === FATE.QUICK);
  const topN = action.length ? Math.max(1, Math.ceil(action.length * 0.2)) : 0;
  return {
    actionCount: action.length,
    topCount: Math.min(topN, action.length),
    topIds: action.slice(0, topN).map((item) => item.chatId),
    topNames: action.slice(0, topN).map((item) => item.who),
  };
}

function markChatSolved(chatId, conversationVersion) {
  const id = String(chatId || '').trim();
  const version = String(conversationVersion || '').trim();
  if (!id || !version) throw new Error('missing chat version');
  const solved = readSolvedChats();
  solved[id] = { conversationVersion: version, solvedAt: new Date().toISOString() };
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  writeFileSync(SOLVED_CHATS_FILE(), JSON.stringify(solved, null, 2));

  try {
    const file = INBOX_CACHE_FILE();
    const cached = JSON.parse(readFileSync(file, 'utf8'));
    cached.items = (cached.items || []).filter((item) => !solvedMatches(item, solved));
    cached.eightyTwenty = buildEightyTwenty(cached.items);
    writeFileSync(file, JSON.stringify(cached));
  } catch { /* the next triage run will apply solved state */ }

  return { ok: true, chatId: id, conversationVersion: version };
}

function saveConversationPlan(body) {
  const record = saveChatPlan(CHAT_PLANS_FILE(), body);
  try {
    const file = INBOX_CACHE_FILE();
    const cached = JSON.parse(readFileSync(file, 'utf8'));
    cached.items = (cached.items || []).map((item) => (
      item.chatId === record.chatId && item.conversationVersion === record.conversationVersion
        ? applyChatPlan(item, { ...record, stale: false })
        : item
    ));
    cached.items.sort(compareTriagePriority);
    cached.eightyTwenty = buildEightyTwenty(cached.items);
    writeFileSync(file, JSON.stringify(cached));
  } catch { /* a fresh triage run will apply the saved plan */ }
  return { ok: true, plan: { ...record, stale: false } };
}

// The complete list, BEFORE any judgement: every chat and every email thread
// from every connected source, newest first, with zero LLM in the path. This
// is the "show me everything" view - triage (getRankedInbox) is a separate,
// slower pass you run after. Fast because nothing here calls a model.
// Concurrent callers share one run. Two overlapping loads used to both
// increment the same global progress counter, so it sailed past total
// (done 1177 of 897) and the bar overshot 100%.
let everythingInFlight = null;
function getEverything() {
  if (everythingInFlight) return everythingInFlight;
  everythingInFlight = runEverything().finally(() => { everythingInFlight = null; });
  return everythingInFlight;
}

async function runEverything() {
  progress.active = true; progress.stage = 'collecting all sources'; progress.done = 0; progress.total = 0;
  try {
    if (DEMO) {
      const items = SAMPLE.map((c, index) => ({
        id: c.chatId,
        who: c.who,
        network: c.network,
        kind: 'message',
        type: 'single',
        unread: index < 3 ? 1 : 0,
        isMuted: false,
        isArchived: false,
        lastAt: new Date(Date.now() - index * 3600_000).toISOString(),
        preview: c.summary,
        fromMe: false,
      }));
      return {
        items,
        counts: { total: items.length, messages: items.length, emails: 0, unread: 3, archived: 0 },
        sources: { demo: true, whatsappDirect: { count: 3, status: 'demo' } },
        errors: [],
        at: new Date().toISOString(),
      };
    }
    const sources = {};
    const errors = [];

    const wantArchive = EMAIL_ENABLED && process.env.SPRITE_ARCHIVE !== '0';
    const [beeperRes, gmailRes, gmailArchRes] = await Promise.allSettled([
      BEEPER_ENABLED ? fetchAllChats() : Promise.resolve([]),
      EMAIL_ENABLED && gmailConfigured() ? fetchGmailInbox({ all: true }) : Promise.resolve({ items: [], accounts: [], errors: [] }),
      EMAIL_ENABLED && gmailConfigured() && wantArchive ? fetchGmailArchive() : Promise.resolve({ items: [], accounts: [], errors: [] }),
    ]);

    let chats = [];
    if (beeperRes.status === 'fulfilled') {
      chats = beeperRes.value;
      sources.beeper = {
        count: chats.length,
        active: chats.filter((c) => !c.isArchived).length,
        archived: chats.archivedCount ?? 0,
        archivedSkipped: true,
      };
    } else {
      sources.beeper = { count: 0, error: String(beeperRes.reason?.message || beeperRes.reason) };
      errors.push({ source: 'beeper', error: sources.beeper.error });
    }

    let emails = [];
    if (gmailRes.status === 'fulfilled') {
      emails = gmailRes.value.items;
      sources.gmail = {
        enabled: EMAIL_ENABLED,
        count: emails.length,
        authMode: gmailAuthMode(),
        accounts: gmailRes.value.accounts,
        errors: gmailRes.value.errors,
      };
      for (const e of gmailRes.value.errors || []) errors.push({ source: `gmail:${e.email || '?'}`, error: e.error });
    // Archived mail rides in the same list, flagged, so the UI can file it
    // under a Sprite archive section without a second request.
    if (gmailArchRes.status === 'fulfilled') {
      emails = emails.concat(gmailArchRes.value.items);
      sources.gmailArchive = {
        count: gmailArchRes.value.items.length,
        errors: gmailArchRes.value.errors,
      };
    } else {
      sources.gmailArchive = { count: 0, error: String(gmailArchRes.reason?.message || gmailArchRes.reason) };
    }

    } else {
      sources.gmail = { count: 0, error: String(gmailRes.reason?.message || gmailRes.reason) };
      errors.push({ source: 'gmail', error: sources.gmail.error });
    }

    let waChats = [];
    if (WHATSAPP_DIRECT) {
      try {
        await ensureWhatsAppStarted();
        await hydrateWhatsAppGroupNames();
        waChats = listWhatsAppChats({ includeArchived: false });
        sources.whatsappDirect = { count: waChats.length, ...(await whatsAppStatusForUi()) };
      } catch (e) {
        sources.whatsappDirect = { count: 0, error: String(e.message || e) };
        errors.push({ source: 'whatsapp-direct', error: sources.whatsappDirect.error });
      }
    }

    let discordChats = [];
    if (discordConfigured()) {
      const d = await fetchDiscordDMs(100);
      discordChats = d.items;
      sources.discord = { count: discordChats.length, error: d.error || undefined };
      if (d.error) errors.push({ source: 'discord', error: d.error });
    }

    const lastAt = (c) => {
      const m = (c.messages || [])[(c.messages || []).length - 1];
      return m?.timestamp ? new Date(m.timestamp).getTime() : 0;
    };
    const solvedChats = readSolvedChats();
    const items = [...chats, ...emails, ...waChats, ...discordChats]
      .map((c) => {
        const msgs = c.messages || [];
        const last = msgs[msgs.length - 1];
        return {
          id: c.id,
          who: c.title,
          network: c.network,
          kind: String(c.network || '').startsWith('Gmail') ? 'email' : 'message',
          type: c.type || 'single',
          unread: Number(c.unreadCount ?? c.unread) || 0,
          isMuted: !!c.isMuted,
          isArchived: !!c.isArchived,
          lastAt: last?.timestamp || c.lastActivity || null,
          preview: redact(String(last?.text || '')).slice(0, 160),
          fromMe: !!last?.isSender,
          avatarUrl: avatarUrlFor(c),
        };
      })
      .map((item) => ({ ...item, cleared: solvedMatches(item, solvedChats) }))
      .sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));

    const counts = {
      total: items.length,
      messages: items.filter((i) => i.kind === 'message').length,
      emails: items.filter((i) => i.kind === 'email').length,
      unread: items.filter((i) => i.unread > 0 && !i.cleared).length,
      archived: items.filter((i) => i.isArchived).length,
    };
    return { items, counts, sources, errors, at: new Date().toISOString() };
  } finally {
    progress.active = false; progress.stage = 'idle';
  }
}

// --- draft assistant ---
function chatPrompt(messages, ctx) {
  const convo = messages.map((m) => `${m.role === 'user' ? 'Me' : 'You'}: ${m.content}`).join('\n');
  const context = ctx
    ? `\nYou are helping me reply to my chat with ${ctx.who}${ctx.network ? ` (${ctx.network})` : ''}.\n${ctx.userPlan ? `My saved explanation: ${ctx.userPlan.explanation}\nMy chosen outcome: ${ctx.userPlan.outcome}${ctx.userPlan.task ? `\nTask before replying: ${ctx.userPlan.task}` : ''}\n` : ''}Recent messages, newest last:\n${ctx.transcript || '(none loaded)'}\n`
    : '';
  return `You are cleared.chat's draft assistant. You help me reply to people on my messaging apps.
${VOICE}
Before drafting, check whether the transcript and my instructions contain enough information to know what I actually want to say.
- If the reply depends on a missing choice or fact, ask one specific question first. This includes yes/no decisions, availability, dates, amounts, links, attachments, commitments, promises, or the outcome I want.
- Do not write a draft until I answer the question. Do not use placeholders or invent a safe-sounding holding reply.
- If the context is clear, write the complete short message in my voice.
- If I am asking about the conversation rather than requesting a draft, answer briefly from the supplied context.

Return ONLY JSON with keys kind and text.
- kind is "clarify" when you need information from me before drafting.
- kind is "draft" when text is the complete copy-ready message.
- kind is "answer" for a normal answer that is not message copy.
- text contains only the question, draft, or answer, with no label or preamble.
${context}
Conversation:
${convo}
JSON:`;
}

// Thread analyst: same chat box, but grounded in the WHOLE transcript.
function analyzePrompt(messages, ctx) {
  const convo = messages.map((m) => `${m.role === 'user' ? 'Me' : 'You'}: ${m.content}`).join('\n');
  return `You are cleared.chat's thread analyst. You are looking at my conversation with ${ctx.who}${ctx.network ? ` (${ctx.network})` : ''}.

FULL TRANSCRIPT - ${ctx.count} messages${ctx.truncated ? ' (capped to the most recent)' : ' (complete, back to the first message)'}${ctx.range ? `, ${ctx.range}` : ''}. Oldest first:
---
${ctx.transcript || '(none loaded)'}
---

Answer my questions about this conversation. Ground every claim in the transcript and cite the date when you reference something specific. NEVER invent facts, quotes, dates, numbers, or commitments that are not above. If something is not in the transcript, say so plainly.
${VOICE}
Apply those voice rules ONLY when I explicitly ask you to draft or write a message. Otherwise just answer, concise and specific.

Conversation:
${convo}
You:`;
}

async function handleChat(body) {
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const analyze = body.mode === 'analyze';
  let ctx = null;
  if (body.chat && body.chat.who) {
    ctx = { who: body.chat.who, network: body.chat.network || '', transcript: '' };
    if (body.chat.id && !DEMO) {
      try {
        if (analyze) Object.assign(ctx, await fullTranscript(body.chat.id));
        else ctx.transcript = await transcriptFor(body.chat.id);
      } catch (e) { ctx.transcript = ''; }
      const plan = planForConversation(
        readChatPlans(CHAT_PLANS_FILE()),
        body.chat.id,
        body.chat.conversationVersion || '',
      );
      if (plan && !plan.stale) ctx.userPlan = plan;
    }
  }
  const prompt = analyze && ctx ? analyzePrompt(messages, ctx) : chatPrompt(messages, ctx);
  const raw = (await completeText(prompt, analyze ? 4000 : 1500)).trim();
  if (analyze) return { reply: raw, kind: 'answer', draft: '', question: '' };
  const noEm = (s) => String(s || '').replace(/\u2014/g, ',').replace(/\u2013/g, '-').trim();
  try {
    const out = parseObject(raw);
    const kind = ['clarify', 'draft', 'answer'].includes(out.kind) ? out.kind : 'answer';
    const reply = noEm(out.text);
    return {
      reply,
      kind,
      draft: kind === 'draft' ? reply : '',
      question: kind === 'clarify' ? reply : '',
    };
  } catch {
    return { reply: noEm(raw), kind: 'answer', draft: '', question: '' };
  }
}

const VOICE_TASK_FILE = () => join(SNAPSHOT_DIR, 'voice-tasks.json');

function voiceTurnPrompt(body, transcript) {
  const chat = body.chat || {};
  return `You are the voice controller for cleared.chat. Adam is reviewing one priority conversation at a time.

Person: ${chat.who || 'unknown'}
Network: ${chat.network || ''}
Triage summary: ${chat.summary || ''}
Current draft: ${body.currentDraft || '(none)'}
Pending clarification question: ${chat.clarifyingQuestion || '(none)'}
Recent conversation, oldest first:
${transcript || '(none loaded)'}

Adam said: ${body.utterance || ''}

Interpret his intent as exactly one kind:
- clarify: the information needed to draft is still missing. Ask one specific question and do not draft.
- draft: he supplied facts, tone, or an instruction for the reply. Write the complete revised message.
- task: real work must happen before the loop can close. State one concrete task. Also write a short holding reply only if it would responsibly get the ball out of Adam's court now.
- later: he wants to defer or move to the next person. Do not write a draft.
- question: he asked about the conversation. Answer only from the supplied transcript.

Return ONLY JSON with keys kind, assistant, draft, task.
assistant is one short sentence suitable for speaking aloud. draft and task are empty strings when not applicable.
${VOICE}
Never claim a message was sent. Never instruct the app to send. Never invent facts.`;
}

function saveVoiceTask(task) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const file = VOICE_TASK_FILE();
  let rows = [];
  try { rows = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []; } catch { rows = []; }
  const duplicate = rows.some((x) => x.chatId === task.chatId && x.task === task.task && !x.completedAt);
  if (!duplicate) rows.push(task);
  writeFileSync(file, JSON.stringify(rows, null, 2));
  return file;
}

async function handleVoiceTurn(body) {
  const utterance = String(body.utterance || '').trim();
  if (!utterance) return { error: 'Say what you want to do with this conversation.' };
  const chat = body.chat || {};
  let transcript = '';
  if (chat.id && !DEMO) {
    try { transcript = await transcriptFor(chat.id, 24); } catch { transcript = ''; }
  }
  let out;
  try {
    out = parseObject(await completeText(voiceTurnPrompt(body, transcript), 1200));
  } catch (e) {
    return { error: String(e.message || e) };
  }
  const noEm = (s) => String(s || '').replace(/\u2014/g, ',').replace(/\u2013/g, '-').trim();
  const result = {
    kind: ['clarify', 'draft', 'task', 'later', 'question'].includes(out.kind) ? out.kind : 'question',
    assistant: noEm(out.assistant),
    draft: noEm(out.draft),
    task: noEm(out.task),
  };
  if (result.kind === 'task' && result.task) {
    result.taskFile = saveVoiceTask({
      chatId: chat.id || '',
      who: chat.who || 'unknown',
      network: chat.network || '',
      task: result.task,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
  }
  return result;
}

// --- F2_BLOCK becomes time ---
// The app cannot hold Google OAuth on its own, so a scheduled block is written
// to a queue the Claude Code session drains through the Calendar MCP, and the
// same payload also yields a prefilled Google Calendar URL that works with no
// auth at all. Nothing is created without an explicit tap.
const QUEUE_FILE = () => join(SNAPSHOT_DIR, 'calendar-queue.json');

function calendarUrlFor(ev) {
  const fmt = (d) => new Date(d).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.summary,
    dates: `${fmt(ev.startTime)}/${fmt(ev.endTime)}`,
    details: ev.description || '',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

function scheduleBlock(body) {
  const { chatId, who = 'someone', deliverable = '', minutes = 30, startTime, network = '' } = body || {};
  if (!chatId) return { error: 'missing chatId' };
  const start = startTime ? new Date(startTime) : new Date(Date.now() + 3600_000);
  const end = new Date(start.getTime() + Math.max(15, Number(minutes) || 30) * 60_000);
  const ev = {
    chatId,
    summary: deliverable ? `${deliverable} (${who})` : `Work owed to ${who}`,
    description: `Blocked on: ${deliverable || 'work owed'}\nPerson: ${who}${network ? ` (${network})` : ''}\nChat: ${chatId}`,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    minutes: Math.max(15, Number(minutes) || 30),
    queuedAt: new Date().toISOString(),
  };
  try {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const f = QUEUE_FILE();
    const q = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : [];
    q.push(ev);
    writeFileSync(f, JSON.stringify(q, null, 2));
  } catch (e) { return { error: `could not queue: ${e.message}` }; }
  return { ok: true, event: ev, calendarUrl: calendarUrlFor(ev), queue: QUEUE_FILE() };
}

// --- relationship radar: the thing email cannot do ---
// Comprehensive sweep across every non-archived conversation, not just the
// primary inbox. Cached, because this reads a lot of history.
let radarCache = { at: 0, data: null };
const RADAR_TTL = 10 * 60_000;

async function getRadar({ force = false, limit = 400 } = {}) {
  if (!force && radarCache.data && Date.now() - radarCache.at < RADAR_TTL) {
    return { ...radarCache.data, cached: true };
  }
  if (DEMO || !BEEPER_ENABLED) return { goneQuietOn: [], unansweredAsks: [], moneyThreads: [], missedCommitments: [], demo: true };

  progress.active = true;
  try {
    // no inbox filter = every conversation across every network
    const convs = await fetchConversations({ inbox: '', limit, msgs: 25, stage: 'scanning relationships' });
    progress.stage = 'building radar';
    const data = buildRadar(convs, new Date(), { quietAfterDays: 5 });
    const out = {
      ...data,
      scanned: convs.length,
      builtAt: new Date().toISOString(),
    };
    radarCache = { at: Date.now(), data: out };
    return out;
  } finally {
    progress.active = false; progress.stage = 'idle';
  }
}

// --- global ask: one question, searched across every chat on every network ---
// Beeper's local API exposes a message search endpoint. We turn the question
// into search terms, pull matching messages from ALL chats, and let the model
// answer strictly from them, with citations.
const STOPWORDS = new Set(['what','whats','when','where','who','whos','why','how','is','are','was','were','the','a','an','do','does','did','my','me','i','in','on','at','to','for','of','and','or','it','this','that','check','chat','from','with','about','tell','know','get','can','you','they','we','us','again','said','say','says','back']);
function keywordsFrom(q) {
  return [...new Set(
    q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  )].slice(0, 8);
}
function chatTitleMap(r) {
  const m = new Map();
  const cs = r.chats;
  if (Array.isArray(cs)) for (const c of cs) m.set(c.id || c.chatID, c.title || c.name || '');
  else if (cs && typeof cs === 'object') for (const [k, v] of Object.entries(cs)) m.set(k, (v && (v.title || v.name)) || '');
  return m;
}
async function searchMessages(term, limit = 20) {
  const r = await beeper(`/v1/messages/search?query=${encodeURIComponent(term)}&limit=${limit}`);
  const titles = chatTitleMap(r);
  return (r.items || []).map((m) => ({
    id: m.id, chatId: m.chatID,
    chat: titles.get(m.chatID) || '(unknown chat)',
    who: m.isSender ? 'Me' : (m.senderName || 'Them'),
    when: m.timestamp || '',
    text: stripHtml(m.text || ''),
  })).filter((m) => m.text);
}

function searchDirectWhatsAppMessages(term, limit = 20) {
  if (!WHATSAPP_DIRECT) return [];
  const needle = String(term || '').trim().toLowerCase();
  if (!needle) return [];
  const hits = [];
  for (const chat of listWhatsAppChats({ includeArchived: true })) {
    for (const message of chat.messages || []) {
      const text = String(message.text || '');
      const haystack = `${chat.title || ''}\n${message.senderName || ''}\n${text}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
      hits.push({
        id: `whatsapp-direct:${chat.id}:${message.key || message.timestamp || hits.length}`,
        chatId: chat.id,
        chat: chat.title || 'WhatsApp chat',
        who: message.isSender ? 'Me' : (message.senderName || 'Them'),
        when: message.timestamp || '',
        text,
      });
    }
  }
  return hits
    .sort((a, b) => new Date(b.when) - new Date(a.when))
    .slice(0, Math.max(1, Math.min(20, limit)));
}

function askPrompt(question, hits) {
  const ctx = hits.map((h) => `[${(h.when || '').slice(0, 16)}] (${h.chat}) ${h.who}: ${h.text}`).join('\n');
  return `You are cleared.chat's assistant. You can see my whole message history across every network.

My question: "${question}"

The most relevant messages found across all my chats:
---
${ctx}
---

Answer directly and concisely using ONLY the messages above. Cite inline like (chat name, sender, date). If messages conflict, trust the most recent and say so. If the answer is not there, say plainly that you could not find it and name what to search instead. Never invent times, names, numbers, or facts. No em dashes, no emojis.`;
}

async function handleAsk(body) {
  const question = String(body.question || '').trim();
  if (!question) return { error: 'Ask a question first.' };
  if (DEMO || (!BEEPER_ENABLED && !WHATSAPP_DIRECT)) {
    return { answer: 'Connect at least one read-only message source first.', sources: [] };
  }

  const keywords = keywordsFrom(question);
  const terms = [question, ...keywords].slice(0, 9);
  const seen = new Map();
  for (const t of terms) {
    if (BEEPER_ENABLED) {
      try { for (const m of await searchMessages(t, 20)) if (!seen.has(m.id)) seen.set(m.id, m); } catch {}
    }
    for (const m of searchDirectWhatsAppMessages(t, 20)) {
      if (!seen.has(m.id)) seen.set(m.id, m);
    }
  }
  const relevance = (hit) => {
    const text = `${hit.chat || ''}\n${hit.who || ''}\n${hit.text || ''}`.toLowerCase();
    return keywords.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0);
  };
  const hits = [...seen.values()]
    .sort((a, b) => relevance(b) - relevance(a) || new Date(b.when) - new Date(a.when))
    .slice(0, 60);
  if (!hits.length) {
    return { answer: 'Nothing in your messages matched that. Try naming the person, group, or a distinctive word from the conversation.', sources: [], searched: terms };
  }
  const answer = (await completeText(askPrompt(question, hits), 1200)).trim();
  return {
    answer,
    searched: terms,
    scanned: hits.length,
    sources: hits.slice(0, 12).map((h) => ({ chat: h.chat, who: h.who, when: h.when, text: h.text.slice(0, 160) })),
  };
}

// Communication sources are read-only. Drafts leave the app through Copy only.
async function act() {
  return { ok: false, error: 'Communication actions are disabled. Make this change manually in the source app.' };
}

// --- HTTP ---
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
}
async function readRawBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  return JSON.parse((await readRawBody(req)).toString('utf8') || '{}');
}

async function whatsAppStatusForUi() {
  const { qr, ...status } = whatsAppStatus();
  return {
    ...status,
    qrDataUrl: qr ? await QRCode.toDataURL(qr, { width: 280, margin: 2 }) : null,
  };
}

// --- license gate ---
// No license secret configured = no gate at all (matches the free/open-source
// repo as cloned; the gate only turns on once you actually set one up).
function licenseRequired() {
  return Boolean(LICENSE_SECRET);
}
function isActivated() {
  if (!licenseRequired()) return true;
  if (!existsSync(LICENSE_FILE)) return false;
  try {
    const { email, key } = JSON.parse(readFileSync(LICENSE_FILE, 'utf8'));
    return verifyKey(email, key, LICENSE_SECRET);
  } catch {
    return false;
  }
}
function activateLicense(email, key) {
  if (!verifyKey(email, key, LICENSE_SECRET)) return { ok: false, error: 'invalid email or license key' };
  writeFileSync(LICENSE_FILE, JSON.stringify({ email: String(email).trim().toLowerCase(), key: String(key).trim().toUpperCase() }));
  return { ok: true };
}
function licenseGatePage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>cleared.chat | activate</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0f12;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#1a1a1f;border:1px solid #2a2a30;border-radius:16px;padding:36px;max-width:380px;width:90%}
h1{font-size:20px;margin:0 0 8px}
p{color:#9a9aa5;font-size:13.5px;line-height:1.5;margin:0 0 22px}
input{width:100%;box-sizing:border-box;background:#0f0f12;border:1px solid #2a2a30;border-radius:8px;padding:11px 12px;color:#eee;font-size:14px;margin-bottom:10px}
button{width:100%;background:#6A4BE5;color:#fff;border:0;border-radius:8px;padding:12px;font-size:14px;font-weight:700;cursor:pointer}
button:hover{background:#7d5ff0}
.err{color:#ff8a8a;font-size:13px;margin-top:10px;display:none}
a{color:#9E7EF8}
</style></head><body>
<div class="card">
  <h1>Activate cleared.chat</h1>
  <p>Enter the email and license key from your purchase.</p>
  <input id="email" placeholder="email" autocomplete="email">
  <input id="key" placeholder="BEEP-XXXX-XXXX-XXXX-XXXX" autocomplete="off" style="text-transform:uppercase">
  <button onclick="activate()">Activate</button>
  <div class="err" id="err"></div>
  <p style="margin-top:18px">No license yet? <a href="https://buy.stripe.com/3cI28r2EGbsV13W1q9aMU1L" target="_blank">Get one →</a></p>
</div>
<script>
async function activate(){
  const email = document.getElementById('email').value.trim();
  const key = document.getElementById('key').value.trim();
  const err = document.getElementById('err');
  err.style.display = 'none';
  try {
    const r = await fetch('/api/license/activate', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({email, key})});
    const data = await r.json();
    if (data.ok) { location.reload(); }
    else { err.textContent = data.error || 'activation failed'; err.style.display = 'block'; }
  } catch(e) { err.textContent = String(e.message||e); err.style.display = 'block'; }
}
</script>
</body></html>`;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      const file = join(DIR, 'public', 'favicon.ico');
      if (!existsSync(file)) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, readFileSync(file), 'image/x-icon');
    }

    // license gate: everything below this line requires activation once
    // LICENSE_SECRET is set. Activation route itself must stay reachable.
    if (req.method === 'POST' && url.pathname === '/api/license/activate') {
      const b = await readBody(req);
      return send(res, 200, activateLicense(b.email, b.key));
    }
    if (req.method === 'GET' && url.pathname === '/api/license/status') {
      return send(res, 200, { required: licenseRequired(), activated: isActivated() });
    }
    if (!isActivated()) {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        return send(res, 200, licenseGatePage(), 'text/html');
      }
      return send(res, 401, { error: 'license required' });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, await readFile(join(DIR, 'public', 'index.html'), 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && url.pathname === '/api/inbox') {
      const requestedScope = url.searchParams.get('scope') || 'all';
      const scope = ['all', 'unread', 'whatsapp-unread', 'whatsapp-open', 'whatsapp-triage'].includes(requestedScope) ? requestedScope : 'all';
      return send(res, 200, await getRankedInbox({ scope }));
    }
    if (req.method === 'GET' && url.pathname === '/api/all') return send(res, 200, await getEverything());
    if (req.method === 'POST' && url.pathname === '/api/wa/unread-reference') {
      const body = await readBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      return send(res, 200, applyWhatsAppUnreadReference(items));
    }
    if (req.method === 'POST' && url.pathname === '/api/wa/unread-sync') {
      if (!WHATSAPP_DIRECT) return send(res, 400, { error: 'Direct WhatsApp is disabled.' });
      return send(res, 200, await resyncWhatsAppUnreadState());
    }
    if (req.method === 'POST' && url.pathname === '/api/wa/contact-name') {
      const body = await readBody(req);
      if (!body.id) return send(res, 400, { error: 'missing id' });
      return send(res, 200, setWhatsAppContactAlias(body.id, body.name));
    }
    if (req.method === 'POST' && url.pathname === '/api/solved') {
      const body = await readBody(req);
      if (!body.chatId || !body.conversationVersion) return send(res, 400, { error: 'missing chat version' });
      return send(res, 200, markChatSolved(body.chatId, body.conversationVersion));
    }
    if (req.method === 'GET' && url.pathname === '/api/plan') {
      const chatId = url.searchParams.get('chatId') || '';
      const version = url.searchParams.get('conversationVersion') || '';
      if (!chatId) return send(res, 400, { error: 'missing chat id' });
      return send(res, 200, {
        plan: planForConversation(readChatPlans(CHAT_PLANS_FILE()), chatId, version),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/plan') {
      return send(res, 200, saveConversationPlan(await readBody(req)));
    }
    if (req.method === 'GET' && url.pathname === '/api/inbox/latest') {
      const f = INBOX_CACHE_FILE();
      if (!existsSync(f)) return send(res, 200, { items: [], empty: true });
      try { return send(res, 200, JSON.parse(readFileSync(f, 'utf8'))); }
      catch (e) { return send(res, 200, { items: [], empty: true, error: String(e.message || e) }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/progress') return send(res, 200, progress);
    if (req.method === 'GET' && url.pathname === '/api/snapshot') {
      const f = join(SNAPSHOT_DIR, 'triage-latest.md');
      if (!existsSync(f)) return send(res, 404, { error: 'no snapshot yet' });
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      return res.end(readFileSync(f, 'utf8'));
    }
    if (req.method === 'GET' && url.pathname === '/api/search') {
      if (DEMO || !BEEPER_ENABLED) return send(res, 200, { items: [] });
      return send(res, 200, { items: await searchChats(url.searchParams.get('q') || '') });
    }
    if (req.method === 'GET' && url.pathname === '/api/thread') {
      const id = url.searchParams.get('id') || '';
      if (!id) return send(res, 400, { error: 'missing id' });
      if (DEMO) return send(res, 200, { transcript: '', count: 0, range: '', demo: true });
      return send(res, 200, await fullTranscript(id));
    }
    if (req.method === 'POST' && url.pathname === '/api/schedule') return send(res, 200, scheduleBlock(await readBody(req)));
    if (req.method === 'GET' && url.pathname === '/api/radar') {
      return send(res, 200, await getRadar({ force: url.searchParams.get('force') === '1' }));
    }
    if (req.method === 'POST' && url.pathname === '/api/ask') return send(res, 200, await handleAsk(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/api/chat') return send(res, 200, await handleChat(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/api/voice/turn') return send(res, 200, await handleVoiceTurn(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/api/act') { const b = await readBody(req); return send(res, 200, await act(b.action, b.chatId)); }
    // Structured messages for the chat pane. /api/thread returns one flat
    // text blob (built for the model); the UI needs real message objects to
    // render bubbles with a sender and a timestamp.
    // Any chat, whole history, as a markdown file. Same pagination as the
    // model-facing transcript so nothing is silently truncated.
    if (req.method === 'GET' && url.pathname === '/api/export') {
      const id = url.searchParams.get('id');
      if (!id) return send(res, 400, { error: 'missing id' });
      const who = url.searchParams.get('who') || id;
      const save = url.searchParams.get('save') === '1';
      const md = await exportChatMarkdown(id, who);
      if (save) {
        const dir = join(SNAPSHOT_DIR, 'exports');
        mkdirSync(dir, { recursive: true });
        const safe = String(who).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'chat';
        const file = join(dir, `${safe}-${new Date().toISOString().slice(0, 10)}.md`);
        writeFileSync(file, md);
        return send(res, 200, { ok: true, file, bytes: md.length });
      }
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${String(who).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md"`,
      });
      return res.end(md);
    }

    if (req.method === 'GET' && url.pathname === '/api/export/voice-notes') {
      const id = url.searchParams.get('id');
      if (!id) return send(res, 400, { error: 'missing id' });
      const who = url.searchParams.get('who') || 'contact';
      if (!isWhatsAppChatId(id)) return send(res, 400, { error: 'Voice-note export is available for WhatsApp chats.' });
      const md = voiceNotesMarkdown(id, who);
      const safe = String(who).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'contact';
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safe}-voice-notes.md"`,
      });
      return res.end(md);
    }

    if (req.method === 'GET' && url.pathname === '/api/messages') {
      const id = url.searchParams.get('id');
      if (!id) return send(res, 400, { error: 'missing id' });
      if (DEMO) {
        const item = SAMPLE.find((x) => x.chatId === id);
        return send(res, 200, { messages: item ? [{
          isSender: false,
          senderName: item.who,
          text: item.summary,
          timestamp: new Date().toISOString(),
        }] : [], kind: 'chat', demo: true });
      }
      if (id.startsWith('gmail:')) {
        return send(res, 200, { messages: [], kind: 'email',
          note: 'Email bodies are not fetched yet. Open it in Gmail for the full thread.' });
      }
      const limit = Math.min(200, Number(url.searchParams.get('limit') || 60));
      if (isWhatsAppChatId(id)) {
        const messages = getWhatsAppMessages(id, limit);
        const allStoredMessages = limit >= 200 ? messages : getWhatsAppMessages(id, 4000);
        const chat = listWhatsAppChats({ includeArchived: true }).find((item) => item.id === id);
        return send(res, 200, {
          messages,
          unreadCount: Math.max(0, Number(chat?.unreadCount) || 0),
          voiceNotes: voiceNoteStats(allStoredMessages),
          kind: 'chat',
          source: 'whatsapp-direct',
        });
      }
      if (!BEEPER_ENABLED) return send(res, 404, { error: 'This source is not connected.' });
      const m = await beeper(`/v1/chats/${encodeURIComponent(id)}/messages?limit=${limit}`);
      const messages = (m.items || m || [])
        .filter((x) => x.type !== 'REACTION' && !x.isHidden)
        .map(normMsg)
        .filter((x) => x.text)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      return send(res, 200, { messages, kind: 'chat' });
    }
    if (req.method === 'GET' && url.pathname === '/api/wa/media') {
      const chatId = url.searchParams.get('chatId') || '';
      const messageId = url.searchParams.get('messageId') || '';
      const media = await getWhatsAppMessageImage({ chatId, messageId });
      if (!media) return send(res, 404, { error: 'Image unavailable.' });
      res.writeHead(200, {
        'Content-Type': media.mimetype,
        'Content-Length': media.buffer.length,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'X-Cleared-Media-Quality': media.quality,
      });
      return res.end(media.buffer);
    }
    if (req.method === 'POST' && url.pathname === '/api/wa/send') {
      const body = await readBody(req);
      if (body.confirmed !== true) return send(res, 400, { error: 'Final confirmation is required.' });
      return send(res, 200, await sendWhatsAppText({
        chatId: body.chatId,
        text: body.text,
        requestId: body.requestId,
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/wa/react') {
      const body = await readBody(req);
      if (body.confirmed !== true) return send(res, 400, { error: 'Final confirmation is required.' });
      return send(res, 200, await sendWhatsAppReaction({
        chatId: body.chatId,
        messageId: body.messageId,
        emoji: body.emoji,
        requestId: body.requestId,
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/wa/voice/retry') {
      const body = await readBody(req);
      return send(res, 200, await retryWhatsAppVoiceTranscription({
        chatId: body.chatId,
        messageId: body.messageId,
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/wa/voice/upload') {
      const audio = await readRawBody(req, 16 * 1024 * 1024);
      return send(res, 200, transcribeUploadedWhatsAppVoice({
        chatId: req.headers['x-cleared-chat-id'],
        messageId: req.headers['x-cleared-message-id'],
        audio,
        mimetype: req.headers['content-type'],
      }));
    }
    if (req.method === 'GET' && url.pathname === '/api/wa/voice/status') {
      return send(res, 200, getWhatsAppVoiceTranscriptionStatus({
        chatId: url.searchParams.get('id'),
        messageId: url.searchParams.get('messageId'),
      }));
    }
    if (req.method === 'GET' && url.pathname === '/api/wa/status') {
      if (WHATSAPP_DIRECT) await ensureWhatsAppStarted();
      return send(res, 200, await whatsAppStatusForUi());
    }
    if (req.method === 'GET' && url.pathname === '/api/wa/avatar') {
      const id = url.searchParams.get('id') || '';
      if (!id || !isWhatsAppChatId(id)) return send(res, 404, { error: 'profile photo not found' });
      const imageUrl = await getWhatsAppProfilePhoto(id);
      if (!imageUrl) return send(res, 404, { error: 'profile photo not found' });
      res.writeHead(302, {
        Location: imageUrl,
        'Cache-Control': 'private, max-age=3600',
      });
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/api/wa/pair') {
      const b = await readBody(req);
      if (!b.phone) return send(res, 400, { error: 'missing phone' });
      const code = await pairWithCode(b.phone);
      return send(res, 200, { code });
    }
    if (req.method === 'POST' && url.pathname === '/api/wa/qr') {
      await pairWithQr();
      return send(res, 200, { ok: true, status: 'connecting' });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`cleared.chat: port ${PORT} is already serving. Using the existing server.`);
    return; // do not rethrow: an uncaught 'error' here kills the whole app
  }
  throw err;
});

server.listen(PORT, () => {
  let mode = 'DEMO data';
  if (!DEMO) {
    const sources = BEEPER_ENABLED ? 'direct WhatsApp + legacy adapter' : 'direct WhatsApp';
    if (isLocalLlm()) mode = `LIVE: ${sources} + local ranking`;
    else if (isGrokLlm()) mode = `LIVE: ${sources} + Grok CLI (${GROK_MODEL} / grok_local)`;
    else if (LLM === 'api') mode = `LIVE: ${sources} + Claude API key`;
    else mode = `LIVE: ${sources} + Claude CLI subscription`;
  }
  console.log(`cleared.chat web  ->  http://localhost:${PORT}   [${mode}]`);

  // Restore a previously linked WhatsApp session as soon as the app starts.
  // Unpaired users stay idle, so this never creates a QR in the background.
  if (WHATSAPP_DIRECT) {
    void ensureWhatsAppStarted();
    const syncHealthCheck = setInterval(() => {
      void ensureWhatsAppStarted();
    }, 30000);
    syncHealthCheck.unref?.();
  }
});
