import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalWhatsAppJid,
  isWhatsAppChatId,
  isVisibleStoredMessage,
  messageTextForDisplay,
  mergeUnreadUpdate,
  normalizeChatPatch,
  normalizeChatUpdate,
  normalizeContactPatch,
  registerLidMappings,
  toWhatsAppSourceId,
  validateOutboundText,
  validateVoiceRetryRequest,
  validateVoiceUpload,
  voiceProgressSnapshot,
  whatsappJid,
} from './whatsapp.mjs';

test('direct WhatsApp chat IDs are namespaced and reversible', () => {
  const jid = '60123456789@s.whatsapp.net';
  const id = toWhatsAppSourceId(jid);
  assert.equal(id, `wa:${jid}`);
  assert.equal(whatsappJid(id), jid);
});

test('direct WhatsApp source detection accepts people and groups', () => {
  assert.equal(isWhatsAppChatId('wa:60123456789@s.whatsapp.net'), true);
  assert.equal(isWhatsAppChatId('120363000000000000@g.us'), true);
  assert.equal(isWhatsAppChatId('gmail:thread-1'), false);
});

test('outbound text requires a confirmed WhatsApp conversation', () => {
  const outbound = validateOutboundText({
    chatId: 'wa:60123456789@s.whatsapp.net',
    text: 'yes, let us do it\u2014tomorrow',
    requestId: '12345678-1234-4234-9234-123456789abc',
  });
  assert.equal(outbound.jid, '60123456789@s.whatsapp.net');
  assert.equal(outbound.text, 'yes, let us do it,tomorrow');
});

test('outbound text rejects non-WhatsApp targets and missing confirmation IDs', () => {
  assert.throws(() => validateOutboundText({
    chatId: 'gmail:thread-1',
    text: 'hello',
    requestId: '12345678-1234-4234-9234-123456789abc',
  }), /WhatsApp conversation/);
  assert.throws(() => validateOutboundText({
    chatId: 'wa:60123456789@s.whatsapp.net',
    text: 'hello',
  }), /confirmation request/);
});

test('voice retry accepts only a synced WhatsApp message identity', () => {
  assert.deepEqual(validateVoiceRetryRequest({
    chatId: 'wa:60123456789@s.whatsapp.net',
    messageId: '3EB0123456789ABCDE',
  }), {
    jid: '60123456789@s.whatsapp.net',
    messageId: '3EB0123456789ABCDE',
  });
  assert.throws(() => validateVoiceRetryRequest({
    chatId: 'gmail:thread-1',
    messageId: '3EB0123456789ABCDE',
  }), /WhatsApp conversation/);
});

test('voice recovery status exposes diagnostics without transcript content', () => {
  const now = Date.parse('2026-08-28T12:01:00.000Z');
  const status = voiceProgressSnapshot({
    seconds: 826,
    transcript: 'private words must never appear here',
    transcriptionStatus: 'recovering',
    transcriptionStartedAt: '2026-08-28T12:00:00.000Z',
    transcriptionProgress: {
      stage: 'waiting-for-audio',
      startedAt: '2026-08-28T12:00:00.000Z',
      stageStartedAt: '2026-08-28T12:00:05.000Z',
      updatedAt: '2026-08-28T12:00:30.000Z',
      failureDeadlineAt: '2026-08-28T12:01:35.000Z',
      detail: 'Waiting for WhatsApp.',
      milestones: [{ stage: 'requesting-audio', at: '2026-08-28T12:00:04.000Z' }],
    },
  }, { now, sourceStatus: 'open' });
  assert.equal(status.durationSeconds, 826);
  assert.equal(status.elapsedSeconds, 60);
  assert.equal(status.stageElapsedSeconds, 55);
  assert.equal(status.updatedAgoSeconds, 30);
  assert.equal(status.secondsUntilFailure, 35);
  assert.equal(status.sourceConnected, true);
  assert.equal(JSON.stringify(status).includes('private words'), false);
});

test('voice upload accepts private audio within the WhatsApp media limit', () => {
  const audio = Buffer.from('audio');
  const result = validateVoiceUpload({
    chatId: 'wa:60123456789@s.whatsapp.net',
    messageId: '3EB0123456789ABCDE',
    audio,
    mimetype: 'audio/ogg',
  });
  assert.equal(result.audio, audio);
  assert.equal(result.mimetype, 'audio/ogg');
  assert.throws(() => validateVoiceUpload({
    chatId: 'wa:60123456789@s.whatsapp.net',
    messageId: '3EB0123456789ABCDE',
    audio: Buffer.alloc(16 * 1024 * 1024 + 1),
    mimetype: 'audio/ogg',
  }), /16 MB/);
  assert.throws(() => validateVoiceUpload({
    chatId: 'wa:60123456789@s.whatsapp.net',
    messageId: '3EB0123456789ABCDE',
    audio,
    mimetype: 'text/plain',
  }), /audio file/);
});

test('WhatsApp chat updates preserve archive and inbox state', () => {
  const patch = normalizeChatPatch({
    archived: true,
    unreadCount: 4,
    pinned: 1712345678,
    muteEndTime: Math.floor(Date.now() / 1000) + 3600,
    conversationTimestamp: 1712345678,
  });
  assert.equal(patch.isArchived, true);
  assert.equal(patch.unreadCount, 4);
  assert.equal(patch.isPinned, true);
  assert.equal(patch.isMuted, true);
  assert.equal(patch.lastActivity, '2024-04-05T19:34:38.000Z');
});

test('an explicit WhatsApp unarchive update is not lost', () => {
  assert.deepEqual(normalizeChatPatch({ archived: false }), { isArchived: false });
});

test('WhatsApp live updates preserve mark-unread app state', () => {
  assert.equal(mergeUnreadUpdate(0, -1), 1);
  assert.equal(mergeUnreadUpdate(4, -1), 4);
  assert.deepEqual(normalizeChatUpdate({ unreadCount: -1 }, 0), { unreadCount: 1 });
});

test('WhatsApp live unread deltas increment and read updates clear', () => {
  assert.equal(mergeUnreadUpdate(3, 2), 5);
  assert.equal(mergeUnreadUpdate(3, 0), 0);
  assert.equal(mergeUnreadUpdate(3, null), 3);
  assert.deepEqual(normalizeChatUpdate({ unreadCount: 2 }, 3), { unreadCount: 5 });
  assert.deepEqual(normalizeChatUpdate({ unreadCount: 0 }, 3), { unreadCount: 0 });
});

test('WhatsApp contacts preserve saved names and usable profile photos', () => {
  const patch = normalizeContactPatch({
    name: 'Saved Contact',
    notify: 'Saved Contact',
    imgUrl: 'https://pps.whatsapp.net/photo.jpg',
  });
  assert.equal(patch.title, 'Saved Contact');
  assert.equal(patch.imgUrl, 'https://pps.whatsapp.net/photo.jpg');
  assert.match(patch.profilePhotoCheckedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('WhatsApp contact photo changes invalidate the cached image', () => {
  const patch = normalizeContactPatch({ notify: 'Teammate', imgUrl: 'changed' });
  assert.equal(patch.title, 'Teammate');
  assert.equal(patch.imgUrl, '');
  assert.equal(patch.profilePhotoCheckedAt, null);
});

test('WhatsApp LID identities resolve to the phone-number thread', () => {
  registerLidMappings([{ lid: '123456789@lid', pn: '60123456789@s.whatsapp.net' }]);
  assert.equal(canonicalWhatsAppJid('123456789@lid'), '60123456789@s.whatsapp.net');
});

test('WhatsApp protocol traffic is never rendered as a chat message', () => {
  assert.equal(messageTextForDisplay({ message: { protocolMessage: { type: 0 } } }), '');
  assert.equal(messageTextForDisplay({ message: { senderKeyDistributionMessage: {} } }), '');
  assert.equal(isVisibleStoredMessage({ text: '[protocolMessage]' }), false);
  assert.equal(isVisibleStoredMessage({ text: '[senderKeyDistributionMessage]' }), false);
});

test('visible WhatsApp attachments keep useful placeholders', () => {
  assert.equal(messageTextForDisplay({ message: { imageMessage: {} } }), '[image]');
  assert.equal(messageTextForDisplay({ message: { documentMessage: { fileName: 'brief.pdf' } } }), 'brief.pdf');
  assert.equal(isVisibleStoredMessage({ text: '[voice note, transcribing locally]' }), true);
});
