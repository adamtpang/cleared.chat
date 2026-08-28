// cleared.chat's own WhatsApp connection, direct multi-device pairing via
// Baileys, no Beeper Desktop in the loop. This is the "our own UI" path:
// we own the QR, we own the session, we own the ban-risk trade-off.
//
// Auth session lives in web/wa-auth/ (gitignored). Pair once, reconnects
// silently after that as long as the files are there.
//
// Run standalone:  node whatsapp.mjs   (prints the QR to the terminal)

import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  Browsers,
  fetchLatestWaWebVersion,
  downloadMediaMessage,
  normalizeMessageContent,
  ALL_WA_PATCH_NAMES,
} from 'baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import pino from 'pino';
import { transcribeVoiceBuffer, transcriptionStatus } from './voice-transcriber.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
// The Aug 10 session logged out (401) server-side; rather than delete that
// folder (blocked by the workspace's own delete-guard, correctly), pair
// fresh into a new one.
const DATA_DIR = () => process.env.WA_DATA_DIR || DIR;
const AUTH_POINTER_FILE = () => join(DATA_DIR(), 'wa-auth-current.json');

function hasUsableCredentials(creds) {
  return Boolean(
    creds?.registered
    || (creds?.me?.id && creds?.account && creds?.advSecretKey && creds?.routingInfo),
  );
}

function readCredentials(directory) {
  try { return JSON.parse(readFileSync(join(directory, 'creds.json'), 'utf8')); }
  catch { return null; }
}

function recoverUsableAuthDir() {
  try {
    return readdirSync(DATA_DIR(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^wa-auth(?:-[a-z0-9-]+)?$/i.test(entry.name))
      .map((entry) => ({
        directory: join(DATA_DIR(), entry.name),
        name: entry.name,
        modified: statSync(join(DATA_DIR(), entry.name)).mtimeMs,
      }))
      .sort((a, b) => b.modified - a.modified)
      .find((entry) => hasUsableCredentials(readCredentials(entry.directory))) || null;
  } catch { return null; }
}

const AUTH_DIR = () => {
  if (process.env.WA_AUTH_DIR) return join(DATA_DIR(), process.env.WA_AUTH_DIR);
  let pointed = null;
  try {
    const pointer = JSON.parse(readFileSync(AUTH_POINTER_FILE(), 'utf8'));
    if (/^wa-auth-[a-z0-9-]+$/i.test(pointer?.directory || '')) {
      pointed = join(DATA_DIR(), pointer.directory);
      if (hasUsableCredentials(readCredentials(pointed))) return pointed;
    }
  } catch { /* use the backwards-compatible directory below */ }
  const recovered = recoverUsableAuthDir();
  if (recovered) {
    mkdirSync(DATA_DIR(), { recursive: true });
    writeFileSync(AUTH_POINTER_FILE(), JSON.stringify({ directory: recovered.name }, null, 2));
    return recovered.directory;
  }
  if (pointed) return pointed;
  return join(DATA_DIR(), 'wa-auth');
};
const STORE_FILE = () => join(DATA_DIR(), 'wa-store.json');
const CONTACT_ALIASES_FILE = () => join(DATA_DIR(), 'contact-aliases.json');
const SOURCE_PREFIX = 'wa:';

function selectFreshAuthDir() {
  if (process.env.WA_AUTH_DIR) return AUTH_DIR();
  mkdirSync(DATA_DIR(), { recursive: true });
  const directory = `wa-auth-pair-${Date.now()}`;
  writeFileSync(AUTH_POINTER_FILE(), JSON.stringify({ directory }, null, 2));
  return join(DATA_DIR(), directory);
}

async function freshPairingAuthState({ force = false } = {}) {
  const current = await useMultiFileAuthState(AUTH_DIR());
  if (!force && hasUsableCredentials(current.state?.creds) && !sessionLoggedOut) {
    throw new Error('this session is already registered and does not need to be paired again');
  }
  return useMultiFileAuthState(selectFreshAuthDir());
}

export const toWhatsAppSourceId = (jid) => `${SOURCE_PREFIX}${jidNormalizedUser(jid || '')}`;
export const whatsappJid = (chatId) => String(chatId || '').startsWith(SOURCE_PREFIX)
  ? String(chatId).slice(SOURCE_PREFIX.length)
  : String(chatId || '');

export function isWhatsAppChatId(chatId) {
  const id = String(chatId || '');
  return id.startsWith(SOURCE_PREFIX) || id.endsWith('@s.whatsapp.net') || id.endsWith('@g.us');
}

let sock = null;
let authState = null; // Loaded once, reused across reconnects. Never re-read mid-session.
let reconnecting = false;
let reconnectTimer = null;
let latestQr = null;
let latestPairingCode = null;
let status = 'idle'; // idle | unpaired | connecting | qr | pairing | open | retrying | error
let statusDetail = 'WhatsApp has not been connected yet.';
let statusSince = new Date().toISOString();
let pairingAttempt = 0;
let pairingStartedAt = null;
let lastError = null;
let lastCloseCode = null;
let historyStatus = 'idle'; // idle | syncing | complete | paused
let historyProgress = null;
let lastHistorySyncAt = null;
let socketGeneration = 0;
let waWebVersion = null;
let registrationConfirmed = false;
let sessionLoggedOut = false;
let unreadSyncStatus = 'idle'; // idle | syncing | complete | error
let unreadSyncDetail = 'Unread state has not been refreshed yet.';
let lastUnreadSyncAt = null;
let unreadSyncPromise = null;

function cancelPendingReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnecting = false;
}

function stopCurrentSocket(reason) {
  cancelPendingReconnect();
  socketGeneration++;
  try { sock?.end?.(new Error(reason)); } catch { /* already closed */ }
  sock = null;
  started = null;
}

async function refreshWaWebVersion() {
  try {
    const latest = await fetchLatestWaWebVersion({});
    if (Array.isArray(latest?.version)) waWebVersion = latest.version;
  } catch { /* Baileys can fall back to its bundled version */ }
  return waWebVersion;
}

function setConnectionStatus(next, detail, { error = null, closeCode = null } = {}) {
  status = next;
  statusDetail = detail;
  statusSince = new Date().toISOString();
  lastError = error;
  lastCloseCode = closeCode;
}

export function getStatus() {
  const chats = [...chatsById.values()];
  const messages = [...messagesById.values()].flat();
  const unreadChats = chats.filter((c) => c.lastActivity && !c.isArchived && Number(c.unreadCount) > 0);
  return {
    status,
    registered: registrationConfirmed || hasUsableCredentials(authState?.state?.creds),
    account: authState?.state?.creds?.me?.id || null,
    qr: latestQr,
    pairingCode: latestPairingCode,
    statusDetail,
    statusSince,
    elapsedMs: Math.max(0, Date.now() - new Date(statusSince).getTime()),
    pairingAttempt,
    pairingElapsedMs: pairingStartedAt ? Math.max(0, Date.now() - new Date(pairingStartedAt).getTime()) : null,
    lastError,
    lastCloseCode,
    waWebVersion: waWebVersion?.join('.') || null,
    historyStatus,
    historyProgress,
    lastHistorySyncAt,
    unreadSyncStatus,
    unreadSyncDetail,
    lastUnreadSyncAt,
    counts: {
      total: chats.filter((c) => c.lastActivity).length,
      active: chats.filter((c) => c.lastActivity && !c.isArchived).length,
      archived: chats.filter((c) => c.lastActivity && c.isArchived).length,
      unreadChats: unreadChats.length,
      unreadMessages: unreadChats.reduce((sum, chat) => sum + Math.max(0, Number(chat.unreadCount) || 0), 0),
      voiceNotes: messages.filter((m) => m.kind === 'voice').length,
      voiceTranscribed: messages.filter((m) => m.kind === 'voice' && m.transcriptionStatus === 'complete').length,
      voicePending: messages.filter((m) => m.kind === 'voice' && m.transcriptionStatus === 'transcribing').length,
    },
    transcription: transcriptionStatus(),
  };
}

// Pairing-code flow: type this code into WhatsApp > Linked Devices > Link
// with phone number. No scan, no expiry race against a chat round-trip.
//
// This deliberately builds its OWN socket rather than reusing whatever
// ensureWhatsAppStarted() left lying around. A socket that has been sitting
// on an unscanned QR gets closed by WhatsApp with a 401, and calling
// requestPairingCode on that corpse just returns "Connection Closed" - which
// is exactly the failure this replaces. Baileys also needs the websocket to
// actually be open before the request, so we wait for it.
export async function pairWithCode(phoneNumber) {
  const digits = String(phoneNumber).replace(/\D/g, '');
  if (!digits) throw new Error('phoneNumber must contain digits (country code + number, no +)');

  // Drop any existing socket so it cannot race this one.
  stopCurrentSocket('restarting for pairing');
  authState = await freshPairingAuthState({ force: true });
  sessionLoggedOut = false;
  registrationConfirmed = false;
  await refreshWaWebVersion();
  pairingAttempt++;
  pairingStartedAt = new Date().toISOString();
  setConnectionStatus('connecting', 'Opening a fresh encrypted connection to WhatsApp.');
  latestPairingCode = null;
  // QR off: asking for both a QR and a pairing code confuses the handshake.
  startSocket(authState, { printQrToTerminal: false });

  // Wait for the websocket to actually be open. Baileys rejects with
  // "Connection Closed" if asked too early.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for WhatsApp websocket to open')), 20000);
    const tick = setInterval(() => {
      if (sock?.ws?.isOpen ?? sock?.ws?.readyState === 1) { clearInterval(tick); clearTimeout(timer); resolve(); }
    }, 250);
  });

  const code = await sock.requestPairingCode(digits);
  latestPairingCode = code;
  // Current Baileys releases can return a locally generated code before
  // WhatsApp accepts the registration request. Give an immediate protocol
  // rejection time to arrive so the UI does not display a known-dead code.
  await new Promise((resolve) => setTimeout(resolve, 1800));
  if (status === 'error' || status === 'retrying') {
    throw new Error(statusDetail || 'WhatsApp rejected the pairing-code request');
  }
  setConnectionStatus('pairing', 'The pairing code is ready and waiting for approval on your phone.');
  return code;
}

// QR flow for an account that is already open on the primary phone. This does
// not require a functioning SIM or an SMS code.
export async function pairWithQr() {
  stopCurrentSocket('restarting for QR pairing');
  authState = await freshPairingAuthState({ force: true });
  sessionLoggedOut = false;
  registrationConfirmed = false;
  await refreshWaWebVersion();
  pairingAttempt++;
  pairingStartedAt = new Date().toISOString();
  setConnectionStatus('connecting', 'Opening a fresh encrypted connection to WhatsApp.');
  latestQr = null;
  latestPairingCode = null;
  startSocket(authState, { printQrToTerminal: false });
  return { status };
}

// --- message store ---------------------------------------------------
// Baileys has no REST "list chats" call: on connect it fires one
// `messaging-history.set` dump, then live `chats.upsert/update` and
// `messages.upsert` events. We fold all of that into a small local store,
// shaped to match cleared.chat's own chat objects (see fetchConversations
// in server.mjs) so it can merge straight into the same ranking pipeline.
const chatsById = new Map();   // id -> { id, title, imgUrl, network:'WhatsApp', type, isMuted, unreadCount, lastActivity }
const messagesById = new Map(); // id -> [{ isSender, senderName, text, timestamp }] oldest -> newest
const lidToPhone = new Map();
const contactAliases = new Map();
let contactAliasesLoaded = false;

export function canonicalWhatsAppJid(raw) {
  const jid = jidNormalizedUser(raw || '');
  return lidToPhone.get(jid) || jid;
}

function mergeChatIdentity(from, to) {
  if (!from || !to || from === to) return;
  const oldChat = chatsById.get(from);
  if (oldChat) {
    const current = chatsById.get(to) || {};
    const oldAt = new Date(oldChat.lastActivity || 0).getTime();
    const currentAt = new Date(current.lastActivity || 0).getTime();
    const newest = oldAt >= currentAt ? oldChat : current;
    const older = newest === oldChat ? current : oldChat;
    const namedTitle = [current.title, oldChat.title]
      .map((value) => String(value || '').trim())
      .find((value) => /\p{L}/u.test(value) && !/^\+?[\d\s.()\-∙]+$/u.test(value));
    chatsById.set(to, {
      ...older,
      ...newest,
      ...(namedTitle ? { title: namedTitle } : {}),
      id: to,
    });
    chatsById.delete(from);
  }
  const oldMessages = messagesById.get(from) || [];
  if (oldMessages.length) {
    const combined = [...(messagesById.get(to) || []), ...oldMessages];
    const seen = new Set();
    const merged = combined
      .filter((message) => !message.key || !seen.has(message.key) && seen.add(message.key))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    messagesById.set(to, merged.slice(-200));
    messagesById.delete(from);
  }
}

export function registerLidMappings(mappings = []) {
  for (const mapping of mappings) {
    const lid = jidNormalizedUser(mapping?.lid || '');
    const phone = jidNormalizedUser(mapping?.pn || '');
    if (!lid || !phone) continue;
    lidToPhone.set(lid, phone);
    mergeChatIdentity(lid, phone);
  }
}

export async function hydrateStoredLidMappings() {
  if (!chatsById.size) loadStore();
  const keys = authState?.state?.keys;
  if (!keys) return { checked: 0, mapped: 0 };
  const lids = [...new Set([
    ...chatsById.keys(),
    ...messagesById.keys(),
  ].filter((jid) => String(jid).endsWith('@lid')))];
  const users = lids.map((jid) => jid.split('@')[0]);
  const reverseKeys = users.map((user) => `${user}_reverse`);
  const stored = await keys.get('lid-mapping', reverseKeys);
  const mappings = lids.flatMap((lid, index) => {
    const phone = stored?.[reverseKeys[index]];
    return phone ? [{ lid, pn: `${phone}@s.whatsapp.net` }] : [];
  });
  registerLidMappings(mappings);
  if (mappings.length) scheduleSave();
  return { checked: lids.length, mapped: mappings.length };
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      mkdirSync(DATA_DIR(), { recursive: true });
      writeFileSync(STORE_FILE(), JSON.stringify({
        meta: {
          historyStatus,
          historyProgress,
          lastHistorySyncAt,
          lastUnreadSyncAt,
          lidMappings: [...lidToPhone],
        },
        chats: [...chatsById.values()],
        messages: Object.fromEntries(messagesById),
      }));
    } catch { /* non-fatal */ }
  }, 1500);
}

function loadStore() {
  loadContactAliases();
  if (!existsSync(STORE_FILE())) return;
  try {
    const j = JSON.parse(readFileSync(STORE_FILE(), 'utf8'));
    for (const c of j.chats || []) chatsById.set(c.id, c);
    let removedControlMessages = false;
    for (const [id, msgs] of Object.entries(j.messages || {})) {
      const visible = (msgs || []).filter(isVisibleStoredMessage);
      if (visible.length !== (msgs || []).length) removedControlMessages = true;
      messagesById.set(id, visible);
    }
    historyStatus = j.meta?.historyStatus || historyStatus;
    historyProgress = j.meta?.historyProgress ?? historyProgress;
    lastHistorySyncAt = j.meta?.lastHistorySyncAt || lastHistorySyncAt;
    lastUnreadSyncAt = j.meta?.lastUnreadSyncAt || lastUnreadSyncAt;
    if (lastUnreadSyncAt) {
      unreadSyncStatus = 'complete';
      unreadSyncDetail = 'Unread state was restored from the last WhatsApp sync.';
    }
    registerLidMappings((j.meta?.lidMappings || []).map(([lid, pn]) => ({ lid, pn })));
    if (removedControlMessages) scheduleSave();
  } catch { /* non-fatal */ }
}

function loadContactAliases() {
  if (contactAliasesLoaded) return;
  contactAliasesLoaded = true;
  try {
    const aliases = JSON.parse(readFileSync(CONTACT_ALIASES_FILE(), 'utf8'));
    for (const [id, name] of Object.entries(aliases || {})) {
      const jid = canonicalWhatsAppJid(id);
      const clean = String(name || '').trim();
      if (jid && clean) contactAliases.set(jid, clean);
    }
  } catch { /* an empty alias store is expected */ }
}

function saveContactAliases() {
  mkdirSync(DATA_DIR(), { recursive: true });
  writeFileSync(CONTACT_ALIASES_FILE(), JSON.stringify(Object.fromEntries(contactAliases), null, 2));
}

function contentOf(m) {
  return normalizeMessageContent(m?.message) || m?.message || {};
}

export function messageTextForDisplay(m) {
  const c = contentOf(m);
  if (c.conversation) return c.conversation;
  if (c.extendedTextMessage?.text) return c.extendedTextMessage.text;
  if (c.imageMessage) return c.imageMessage.caption || '[image]';
  if (c.videoMessage) return c.videoMessage.caption || '[video]';
  if (c.audioMessage) return '[voice note, waiting for transcript]';
  if (c.documentMessage) return c.documentMessage.fileName || '[document]';
  if (c.stickerMessage) return '[sticker]';
  if (c.contactMessage) return c.contactMessage.displayName
    ? `[contact: ${c.contactMessage.displayName}]`
    : '[contact]';
  if (c.contactsArrayMessage) return '[contacts]';
  if (c.locationMessage) return '[location]';
  if (c.liveLocationMessage) return '[live location]';
  if (c.pollCreationMessage?.name) return `[poll: ${c.pollCreationMessage.name}]`;
  if (c.pollCreationMessageV3?.name) return `[poll: ${c.pollCreationMessageV3.name}]`;
  if (c.eventMessage?.name) return `[event: ${c.eventMessage.name}]`;
  if (c.buttonsMessage?.contentText) return c.buttonsMessage.contentText;
  if (c.listMessage?.description) return c.listMessage.description;
  // Reactions, protocol events, key distribution, history sync, revokes, and
  // app-state updates are WhatsApp control traffic. They are not chat rows.
  return '';
}

const CONTROL_PLACEHOLDER = /^\[(?:protocolMessage|senderKeyDistributionMessage|messageContextInfo|deviceSentMessage|historySyncNotification|appStateSyncKey(?:Share|Request|Fingerprint)|syncAction|reactionMessage|pollUpdateMessage|keepInChatMessage|pinInChatMessage|requestPhoneNumberMessage)\]$/i;

export function isVisibleStoredMessage(message = {}) {
  const text = String(message.text || '').trim();
  return Boolean(text) && !CONTROL_PLACEHOLDER.test(text);
}

function voiceInfo(m) {
  const audio = contentOf(m).audioMessage;
  if (!audio) return null;
  return {
    mimetype: audio.mimetype || 'audio/ogg; codecs=opus',
    seconds: numeric(audio.seconds),
    ptt: Boolean(audio.ptt),
  };
}

function numeric(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value?.toNumber === 'function') return value.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function timestampIso(value) {
  const n = numeric(value);
  if (!n) return null;
  const ms = n > 10_000_000_000 ? n : n * 1000;
  return new Date(ms).toISOString();
}

export function normalizeChatPatch(chat = {}) {
  const patch = {};
  if (chat.name || chat.notify) patch.title = chat.name || chat.notify;
  if (chat.unreadCount !== undefined && chat.unreadCount !== null) {
    patch.unreadCount = Math.max(0, numeric(chat.unreadCount) || 0);
  }
  if (chat.archived !== undefined && chat.archived !== null) patch.isArchived = Boolean(chat.archived);
  if (chat.archive !== undefined && chat.archive !== null) patch.isArchived = Boolean(chat.archive);
  if (chat.muteEndTime !== undefined) {
    const until = numeric(chat.muteEndTime);
    patch.isMuted = Boolean(until && until > Date.now() / 1000);
  }
  if (chat.pinned !== undefined) patch.isPinned = Boolean(numeric(chat.pinned));
  const activity = timestampIso(chat.conversationTimestamp ?? chat.lastMessageRecvTimestamp ?? chat.timestamp);
  if (activity) patch.lastActivity = activity;
  return patch;
}

// Baileys chat snapshots contain an absolute unread count. Live
// `chats.update` events use different semantics: -1 means mark unread, 0
// means read, and a positive number is a delta from newly received messages.
export function mergeUnreadUpdate(currentUnread = 0, incomingUnread) {
  const current = Math.max(0, numeric(currentUnread) || 0);
  if (incomingUnread === undefined || incomingUnread === null) return current;
  const incoming = numeric(incomingUnread);
  if (incoming === null) return current;
  if (incoming < 0) return Math.max(1, current);
  if (incoming === 0) return 0;
  return current + incoming;
}

export function normalizeChatUpdate(chat = {}, currentUnread = 0) {
  const patch = normalizeChatPatch(chat);
  delete patch.unreadCount;
  if (Object.prototype.hasOwnProperty.call(chat, 'unreadCount')) {
    patch.unreadCount = mergeUnreadUpdate(currentUnread, chat.unreadCount);
  }
  return patch;
}

function contactName(contact = {}) {
  return [contact.name, contact.notify, contact.verifiedName, contact.username]
    .map((value) => String(value || '').trim())
    .find(Boolean) || '';
}

export function normalizeContactPatch(contact = {}) {
  const patch = {};
  const title = contactName(contact);
  if (title) patch.title = title;
  if (Object.prototype.hasOwnProperty.call(contact, 'imgUrl')) {
    if (/^https?:\/\//i.test(String(contact.imgUrl || ''))) {
      patch.imgUrl = String(contact.imgUrl);
      patch.profilePhotoCheckedAt = new Date().toISOString();
    } else if (contact.imgUrl === null || contact.imgUrl === 'removed') {
      patch.imgUrl = null;
      patch.profilePhotoCheckedAt = new Date().toISOString();
    } else if (contact.imgUrl === 'changed') {
      patch.imgUrl = '';
      patch.profilePhotoCheckedAt = null;
    }
  }
  return patch;
}

function upsertChat(id, patch) {
  id = canonicalWhatsAppJid(id);
  const prev = chatsById.get(id) || {
    id,
    title: id.split('@')[0],
    network: 'WhatsApp',
    type: id.endsWith('@g.us') ? 'group' : 'single',
    isMuted: false,
    isArchived: false,
    isPinned: false,
    unreadCount: 0,
    lastActivity: null,
  };
  chatsById.set(id, { ...prev, ...patch });
}

function applyChatUpdate(chat = {}) {
  const raw = jidNormalizedUser(chat.id || '');
  if (!raw) return;
  const jid = canonicalWhatsAppJid(raw);
  const currentUnread = chatsById.get(jid)?.unreadCount || 0;
  upsertChat(jid, normalizeChatUpdate(chat, currentUnread));
}

function applyContact(contact = {}) {
  const raw = jidNormalizedUser(contact.id || contact.phoneNumber || contact.lid || '');
  if (!raw) return;
  upsertChat(raw, normalizeContactPatch(contact));
}

function appendMessage(id, msg) {
  id = canonicalWhatsAppJid(id);
  const list = messagesById.get(id) || [];
  const existing = list.find((m) => m.key === msg.key);
  if (!existing) {
    list.push(msg);
    list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (list.length > 200) list.splice(0, list.length - 200); // keep last 200/chat
    messagesById.set(id, list);
    return msg;
  }
  return existing;
}

const voiceJobs = new Map();
const mediaLogger = pino({ level: 'silent' });

function queueVoiceTranscription(jid, proto, stored) {
  const id = String(proto.key?.id || stored.key || 'voice');
  const jobKey = `${jid}:${id}`;
  if (voiceJobs.has(jobKey) || stored.transcriptionStatus === 'complete') return;

  stored.kind = 'voice';
  stored.transcriptionStatus = 'transcribing';
  stored.text = '[voice note, transcribing locally]';
  const job = (async () => {
    try {
      const audio = await downloadMediaMessage(proto, 'buffer', {}, {
        logger: mediaLogger,
        reuploadRequest: sock?.updateMediaMessage,
      });
      const result = await transcribeVoiceBuffer(audio, {
        id,
        mimetype: stored.mimetype,
      });
      stored.transcript = result.text;
      stored.language = result.language;
      stored.transcriptionStatus = result.text ? 'complete' : 'empty';
      stored.text = result.text
        ? `[Voice note transcript] ${result.text}`
        : '[voice note, no speech detected]';
    } catch (error) {
      stored.transcriptionStatus = 'failed';
      stored.transcriptionError = String(error?.message || error).slice(0, 240);
      stored.text = '[voice note, transcript unavailable]';
    } finally {
      voiceJobs.delete(jobKey);
      scheduleSave();
    }
  })();
  voiceJobs.set(jobKey, job);
}

function ingestProtoMessages(msgs) {
  for (const m of msgs || []) {
    const jid = canonicalWhatsAppJid(m.key?.remoteJid || m.key?.remoteJidAlt || '');
    if (!jid || jid === 'status@broadcast') continue;
    const text = messageTextForDisplay(m);
    const voice = voiceInfo(m);
    if (!text && !voice) continue;
    const ts = m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000).toISOString() : new Date().toISOString();
    const stored = appendMessage(jid, {
      key: m.key?.id,
      isSender: !!m.key?.fromMe,
      senderName: m.pushName || jid.split('@')[0],
      text,
      timestamp: ts,
      ...(voice ? {
        kind: 'voice',
        mimetype: voice.mimetype,
        seconds: voice.seconds,
        ptt: voice.ptt,
        transcriptionStatus: 'pending',
      } : {}),
    });
    if (voice && stored.transcriptionStatus !== 'complete') queueVoiceTranscription(jid, m, stored);
    const liveName = !m.key?.fromMe && !jid.endsWith('@g.us')
      ? String(m.pushName || '').trim()
      : '';
    upsertChat(jid, {
      lastActivity: ts,
      ...(liveName && /\p{L}/u.test(liveName) ? { title: liveName } : {}),
    });
  }
}

export function listChats(options = {}) {
  // The local archive is useful even when WhatsApp needs to be paired again.
  // Loading it here keeps read-only search available without opening a socket.
  if (!chatsById.size) loadStore();
  const legacyLimit = typeof options === 'number' ? options : null;
  const limit = legacyLimit ?? options.limit ?? Number.POSITIVE_INFINITY;
  const includeArchived = legacyLimit === null && options.includeArchived === true;
  const rows = [...chatsById.values()]
    .filter((c) => c.lastActivity && (includeArchived || !c.isArchived))
    .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
    .map((c) => ({
      ...c,
      title: contactAliases.get(c.id) || c.title,
      id: toWhatsAppSourceId(c.id),
      source: 'whatsapp-direct',
      messages: (messagesById.get(c.id) || []).filter(isVisibleStoredMessage),
    }));
  return Number.isFinite(limit) ? rows.slice(0, Math.max(0, limit)) : rows;
}

export function setContactAlias(chatId, name) {
  if (!chatsById.size) loadStore();
  loadContactAliases();
  const jid = canonicalWhatsAppJid(whatsappJid(chatId));
  if (!jid || !chatsById.has(jid)) throw new Error('WhatsApp chat not found');
  const clean = String(name || '').trim().slice(0, 80);
  if (clean) contactAliases.set(jid, clean);
  else contactAliases.delete(jid);
  saveContactAliases();
  return {
    id: toWhatsAppSourceId(jid),
    title: clean || chatsById.get(jid)?.title || jid.split('@')[0],
  };
}

// Import a read-only unread snapshot from another local WhatsApp client.
// This changes only cleared.chat's local store. It never marks anything read
// or writes any state back to WhatsApp.
export function applyUnreadReference(rows = []) {
  if (!chatsById.size) loadStore();

  for (const chat of chatsById.values()) {
    if (chat.lastActivity && !chat.isArchived) chat.unreadCount = 0;
  }

  let matched = 0;
  const missing = [];
  for (const row of rows) {
    const raw = jidNormalizedUser(row?.jid || '');
    if (!raw) continue;
    const jid = canonicalWhatsAppJid(raw);
    const existing = chatsById.get(jid);
    if (!existing) {
      missing.push(raw);
      continue;
    }
    chatsById.set(jid, {
      ...existing,
      unreadCount: Math.max(0, Number(row?.unread) || 0),
    });
    matched++;
  }

  scheduleSave();
  return { imported: rows.length, matched, missing };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOpenSocket(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (sock && status === 'open') return sock;
    if (status === 'error' || sessionLoggedOut) {
      throw new Error(statusDetail || 'The saved WhatsApp link is not authorized.');
    }
    await wait(250);
  }
  throw new Error('WhatsApp did not finish reconnecting in time.');
}

// Rebuild unread state from WhatsApp's encrypted app-state snapshot. Clearing
// the local app-state versions asks WhatsApp for a fresh snapshot, but does not
// call chatModify or write read state back to the account.
export function resyncUnreadState() {
  if (unreadSyncPromise) return unreadSyncPromise;
  unreadSyncPromise = runUnreadResync().finally(() => { unreadSyncPromise = null; });
  return unreadSyncPromise;
}

async function runUnreadResync() {
  if (!chatsById.size) loadStore();
  unreadSyncStatus = 'syncing';
  unreadSyncDetail = 'Requesting a fresh read-only unread snapshot from WhatsApp.';

  try {
    await ensureWhatsAppStarted();
    const activeSocket = await waitForOpenSocket();
    const keys = activeSocket.authState?.keys || authState?.state?.keys;
    if (!keys) throw new Error('WhatsApp encryption state is unavailable.');

    const names = [...ALL_WA_PATCH_NAMES];
    const previousVersions = await keys.get('app-state-sync-version', names);
    const previousUnread = new Map(
      [...chatsById].map(([id, chat]) => [id, Math.max(0, Number(chat.unreadCount) || 0)]),
    );

    for (const chat of chatsById.values()) {
      if (chat.lastActivity && !chat.isArchived) chat.unreadCount = 0;
    }

    try {
      await keys.set({
        'app-state-sync-version': Object.fromEntries(names.map((name) => [name, null])),
      });
      await activeSocket.resyncAppState(names, true);
      // Baileys flushes the consolidated chat updates just after the resync
      // promise resolves.
      await wait(350);
    } catch (error) {
      await keys.set({
        'app-state-sync-version': Object.fromEntries(
          names.map((name) => [name, previousVersions?.[name] || null]),
        ),
      });
      for (const [id, before] of previousUnread) {
        const chat = chatsById.get(id);
        if (chat) chat.unreadCount = Math.max(before, Number(chat.unreadCount) || 0);
      }
      throw error;
    }

    const activeUnread = [...chatsById.values()]
      .filter((chat) => chat.lastActivity && !chat.isArchived && Number(chat.unreadCount) > 0);
    lastUnreadSyncAt = new Date().toISOString();
    unreadSyncStatus = 'complete';
    unreadSyncDetail = `Matched ${activeUnread.length} unread WhatsApp chats.`;
    scheduleSave();
    return {
      ok: true,
      unreadChats: activeUnread.length,
      unreadMessages: activeUnread.reduce(
        (sum, chat) => sum + Math.max(0, Number(chat.unreadCount) || 0),
        0,
      ),
      at: lastUnreadSyncAt,
    };
  } catch (error) {
    unreadSyncStatus = 'error';
    unreadSyncDetail = String(error?.message || error);
    scheduleSave();
    throw error;
  }
}

export function getMessages(chatId, limit = 20) {
  if (!chatsById.size) loadStore();
  const list = messagesById.get(canonicalWhatsAppJid(whatsappJid(chatId))) || [];
  return list.filter(isVisibleStoredMessage).slice(-limit);
}

const profilePhotoRequests = new Map();
const profilePhotoQueue = [];
let activeProfilePhotoRequests = 0;

function limitedProfilePhotoRequest(run) {
  return new Promise((resolve, reject) => {
    profilePhotoQueue.push({ run, resolve, reject });
    const drain = () => {
      while (activeProfilePhotoRequests < 3 && profilePhotoQueue.length) {
        const job = profilePhotoQueue.shift();
        activeProfilePhotoRequests++;
        Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
          activeProfilePhotoRequests--;
          drain();
        });
      }
    };
    drain();
  });
}

export async function getProfilePhoto(chatId) {
  if (!chatsById.size) loadStore();
  const jid = canonicalWhatsAppJid(whatsappJid(chatId));
  if (!jid) return null;
  const cached = chatsById.get(jid);
  if (/^https?:\/\//i.test(String(cached?.imgUrl || ''))) return cached.imgUrl;
  if (cached && cached.imgUrl === null) return null;
  if (profilePhotoRequests.has(jid)) return profilePhotoRequests.get(jid);

  const request = limitedProfilePhotoRequest(async () => {
    await ensureWhatsAppStarted();
    if (!sock || status !== 'open') return null;
    try {
      const imgUrl = await sock.profilePictureUrl(jid, 'preview', 7000);
      upsertChat(jid, {
        imgUrl: /^https?:\/\//i.test(String(imgUrl || '')) ? imgUrl : null,
        profilePhotoCheckedAt: new Date().toISOString(),
      });
      scheduleSave();
      return imgUrl || null;
    } catch {
      upsertChat(jid, { imgUrl: null, profilePhotoCheckedAt: new Date().toISOString() });
      scheduleSave();
      return null;
    }
  }).finally(() => profilePhotoRequests.delete(jid));
  profilePhotoRequests.set(jid, request);
  return request;
}

export async function hydrateGroupNames({ limit = 30 } = {}) {
  if (!chatsById.size) loadStore();
  await ensureWhatsAppStarted();
  if (!sock || status !== 'open') return { checked: 0, updated: 0 };
  const missing = [...chatsById.values()]
    .filter((chat) => chat.type === 'group' && chat.lastActivity && !chat.isArchived)
    .filter((chat) => !/\p{L}/u.test(String(chat.title || '')))
    .slice(0, Math.max(0, limit));
  let updated = 0;
  for (let i = 0; i < missing.length; i += 3) {
    await Promise.all(missing.slice(i, i + 3).map(async (chat) => {
      try {
        const metadata = await sock.groupMetadata(chat.id);
        const title = String(metadata?.subject || '').trim();
        if (title) {
          upsertChat(chat.id, { title });
          updated++;
        }
      } catch { /* a stale or inaccessible group keeps its existing fallback */ }
    }));
  }
  if (updated) scheduleSave();
  return { checked: missing.length, updated };
}

function startSocket({ state, saveCreds }, opts) {
  const { onQr, onOpen, onClose, printQrToTerminal = true } = opts;
  const logger = pino({ level: 'silent' });
  const generation = ++socketGeneration;

  sock = makeWASocket({
    auth: state,
    logger,
    ...(waWebVersion ? { version: waWebVersion } : {}),
    printQRInTerminal: false, // deprecated in newer baileys; we render it ourselves
    browser: Browsers.windows('Desktop'),
    syncFullHistory: true,
  });

  sock.ev.on('creds.update', async (update) => {
    if (update?.registered || hasUsableCredentials(state.creds)) registrationConfirmed = true;
    await saveCreds();
  });

  // Initial sync: WhatsApp dumps recent chats + contacts + messages once,
  // shortly after connecting.
  sock.ev.on('messaging-history.set', ({ chats, contacts, messages, lidPnMappings, isLatest, progress }) => {
    if (historyStatus !== 'complete') historyStatus = 'syncing';
    historyProgress = numeric(progress);
    registerLidMappings(lidPnMappings || []);
    registerLidMappings((contacts || []).filter((c) => c.lid && c.phoneNumber)
      .map((c) => ({ lid: c.lid, pn: c.phoneNumber })));
    const nameById = new Map();
    for (const contact of contacts || []) {
      const raw = jidNormalizedUser(contact.id || contact.phoneNumber || contact.lid || '');
      const canonical = canonicalWhatsAppJid(raw);
      const name = contactName(contact);
      if (raw && name) nameById.set(raw, name);
      if (canonical && name) nameById.set(canonical, name);
      applyContact(contact);
    }
    for (const c of chats || []) {
      const jid = jidNormalizedUser(c.id || '');
      if (!jid) continue;
      const canonical = canonicalWhatsAppJid(jid);
      upsertChat(jid, {
        ...normalizeChatPatch(c),
        title: c.name || nameById.get(jid) || nameById.get(canonical)
          || chatsById.get(canonical)?.title || jid.split('@')[0],
      });
    }
    ingestProtoMessages(messages);
    void hydrateStoredLidMappings().catch(() => {});
    if (isLatest || historyProgress === 100) {
      historyStatus = 'complete';
      lastHistorySyncAt = new Date().toISOString();
    }
    scheduleSave();
  });

  sock.ev.on('messaging-history.status', ({ status: syncStatus }) => {
    historyStatus = syncStatus;
    if (syncStatus === 'complete') {
      historyProgress = 100;
      lastHistorySyncAt = new Date().toISOString();
    }
    scheduleSave();
  });

  sock.ev.on('chats.upsert', (chats) => {
    for (const c of chats || []) {
      const jid = jidNormalizedUser(c.id || '');
      if (jid) upsertChat(jid, {
        ...normalizeChatPatch(c),
        ...(c.name ? { title: c.name } : {}),
      });
    }
    scheduleSave();
  });

  sock.ev.on('chats.update', (chats) => {
    for (const c of chats || []) applyChatUpdate(c);
    scheduleSave();
  });

  sock.ev.on('chats.delete', (ids) => {
    for (const raw of ids || []) {
      const jid = jidNormalizedUser(raw || '');
      chatsById.delete(jid);
      messagesById.delete(jid);
    }
    scheduleSave();
  });

  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts || []) applyContact(c);
    scheduleSave();
  });

  sock.ev.on('contacts.update', (contacts) => {
    for (const c of contacts || []) applyContact(c);
    scheduleSave();
  });

  sock.ev.on('lid-mapping.update', (mapping) => {
    registerLidMappings([mapping]);
    scheduleSave();
  });

  sock.ev.on('messages.upsert', ({ messages }) => {
    ingestProtoMessages(messages);
    scheduleSave();
  });

  sock.ev.on('connection.update', (update) => {
    if (generation !== socketGeneration) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr && !registrationConfirmed && !hasUsableCredentials(state.creds) && connection !== 'open') {
      setConnectionStatus('qr', 'WhatsApp returned a linking challenge. The QR is ready to scan.');
      latestQr = qr;
      if (printQrToTerminal) {
        console.log('\nScan this with WhatsApp > Linked devices > Link a device:\n');
        qrcode.generate(qr, { small: true });
      }
      onQr?.(qr);
    }

    if (connection === 'open') {
      sessionLoggedOut = false;
      registrationConfirmed = true;
      setConnectionStatus('open', 'Linked successfully. WhatsApp is now syncing your message history.');
      latestQr = null;
      console.log('\n[whatsapp] paired and connected.\n');
      onOpen?.();
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      const error = String(lastDisconnect?.error?.message || lastDisconnect?.error || 'WhatsApp closed the connection');
      latestQr = null;
      latestPairingCode = null;
      setConnectionStatus(
        loggedOut ? 'error' : 'retrying',
        loggedOut
          ? 'WhatsApp rejected or expired this pairing session. Start a new QR attempt.'
          : 'The connection dropped. cleared.chat will retry automatically in 3 seconds.',
        { error, closeCode: code || null },
      );
      console.log(`\n[whatsapp] connection closed (${code || 'unknown'})${loggedOut ? ' - start a fresh pairing session' : ', reconnecting in 3s...'}\n`);
      onClose?.({ loggedOut, code });
      // One reconnect attempt in flight at a time, with a delay. An instant
      // recursive reconnect races WhatsApp's own server-side session
      // cleanup and just replaces itself in a tight 440 loop.
      if (!loggedOut && !reconnecting) {
        reconnecting = true;
        const closedGeneration = generation;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (closedGeneration !== socketGeneration) {
            reconnecting = false;
            return;
          }
          reconnecting = false;
          setConnectionStatus('connecting', 'Retrying the encrypted WhatsApp connection.');
          startSocket({ state, saveCreds }, opts);
        }, 3000);
      } else if (loggedOut) {
        sessionLoggedOut = true;
        registrationConfirmed = false;
        started = null;
      }
    }
  });

  return sock;
}

export async function connectWhatsApp(opts = {}) {
  loadStore();
  if (!authState) authState = await useMultiFileAuthState(AUTH_DIR());
  if (hasUsableCredentials(authState.state?.creds)) registrationConfirmed = true;
  await hydrateStoredLidMappings();
  await refreshWaWebVersion();
  return startSocket(authState, opts);
}

let started = null;
// Idempotent: safe to call from server.mjs on every request, only connects once.
//
// Deliberately does NOT connect when the session has never been paired. An
// unregistered socket just sits on a QR nobody is looking at until WhatsApp
// closes it with a 401, which then poisons a later pairing attempt. Pair
// first (pairWithCode), and this starts working on its own afterwards.
export async function ensureWhatsAppStarted() {
  if (sock && ['connecting', 'pairing', 'qr', 'open', 'retrying'].includes(status)) return sock;
  if (started) return started;
  if (sessionLoggedOut) {
    setConnectionStatus('error', 'This saved WhatsApp link is no longer authorized. Pair once in Settings to resume automatic sync.');
    return null;
  }
  const probe = await useMultiFileAuthState(AUTH_DIR());
  if (!hasUsableCredentials(probe.state?.creds)) {
    if (status !== 'error') {
      setConnectionStatus('unpaired', 'No linked WhatsApp session is available yet.');
    }
    return null;
  }
  authState = probe;
  registrationConfirmed = true;
  setConnectionStatus('connecting', 'Restoring the saved WhatsApp connection.');
  started = connectWhatsApp({ printQrToTerminal: false }).catch((e) => {
    console.error('[whatsapp] failed to start:', e.message || e);
    started = null;
  });
  return started;
}

export function getSocket() {
  return sock;
}

// standalone run: `node whatsapp.mjs`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setConnectionStatus('connecting', 'Opening WhatsApp from the command line.');
  connectWhatsApp();
}
