import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalWhatsAppJid,
  isWhatsAppChatId,
  isVisibleStoredMessage,
  messageTextForDisplay,
  normalizeChatPatch,
  normalizeContactPatch,
  registerLidMappings,
  toWhatsAppSourceId,
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
