import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createWhatsAppTranscriptBot,
  extractInboundAudioMessages,
  splitWhatsAppText,
  verifyMetaSignature,
} from './whatsapp-transcript-bot.mjs';

const payload = {
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: 'phone-1' },
    messages: [
      { from: '6590000000', id: 'wamid.voice-1', type: 'audio', audio: { id: 'media-1', mime_type: 'audio/ogg' } },
      { from: '6590000000', id: 'wamid.text-1', type: 'text', text: { body: 'hello' } },
    ],
  } }] }],
};

test('extracts only inbound WhatsApp audio jobs', () => {
  assert.deepEqual(extractInboundAudioMessages(payload), [{
    from: '6590000000',
    messageId: 'wamid.voice-1',
    mediaId: 'media-1',
    mimeType: 'audio/ogg',
    phoneNumberId: 'phone-1',
  }]);
});

test('verifies Meta webhook signatures against the raw body', () => {
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}`;
  assert.equal(verifyMetaSignature(raw, signature, 'secret'), true);
  assert.equal(verifyMetaSignature(raw, 'sha256=bad', 'secret'), false);
});

test('acknowledges and transcribes forwarded audio without a real send', async () => {
  const sent = [];
  const fakeFetch = async (url, init = {}) => {
    if (String(url).endsWith('/media-1')) {
      return new Response(JSON.stringify({ url: 'https://media.test/audio', mime_type: 'audio/ogg', file_size: 5 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url) === 'https://media.test/audio') return new Response(Buffer.from('audio'), { status: 200 });
    if (String(url).endsWith('/phone-1/messages')) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ messages: [{ id: `sent-${sent.length}` }] }), { status: 200 });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const bot = createWhatsAppTranscriptBot({
    verifyToken: 'verify',
    appSecret: 'secret',
    accessToken: 'access',
    phoneNumberId: 'phone-1',
    fetchImpl: fakeFetch,
    transcribe: async (audio) => {
      assert.equal(audio.toString(), 'audio');
      return { text: 'the private transcript', language: 'en' };
    },
    onError: (error) => assert.fail(error.message),
  });
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = `sha256=${createHmac('sha256', 'secret').update(raw).digest('hex')}`;
  assert.deepEqual(bot.acceptWebhook(raw, signature), { accepted: 1 });
  assert.deepEqual(bot.acceptWebhook(raw, signature), { accepted: 0 });
  await bot.waitForIdle();
  assert.equal(sent.length, 2);
  assert.match(sent[0].text.body, /Voice note received/);
  assert.match(sent[1].text.body, /Transcript\n\nthe private transcript/);
  assert.equal(sent[0].to, '6590000000');
});

test('rejects an invalid webhook signature before processing', () => {
  const bot = createWhatsAppTranscriptBot({
    verifyToken: 'verify', appSecret: 'secret', accessToken: 'access', phoneNumberId: 'phone-1',
  });
  assert.throws(() => bot.acceptWebhook(Buffer.from('{}'), 'sha256=bad'), /Invalid Meta webhook signature/);
});

test('splits long transcripts within WhatsApp text limits', () => {
  const chunks = splitWhatsAppText('word '.repeat(2000), 1000);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000));
});
