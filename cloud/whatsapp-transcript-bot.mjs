import { createHmac, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { transcribeVoiceBuffer } from '../web/voice-transcriber.mjs';

const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const DEFAULT_GRAPH_VERSION = 'v26.0';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyMetaSignature(rawBody, signature, appSecret) {
  if (!Buffer.isBuffer(rawBody) || !appSecret || !String(signature || '').startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(expected, signature);
}

export function extractInboundAudioMessages(payload = {}) {
  const result = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = String(value.metadata?.phone_number_id || '');
      for (const message of value.messages || []) {
        if (message.type !== 'audio' || !message.audio?.id || !message.from || !message.id) continue;
        result.push({
          from: String(message.from),
          messageId: String(message.id),
          mediaId: String(message.audio.id),
          mimeType: String(message.audio.mime_type || 'audio/ogg'),
          phoneNumberId,
        });
      }
    }
  }
  return result;
}

export function splitWhatsAppText(text, limit = 3500) {
  const input = String(text || '').trim();
  if (!input) return [];
  const chunks = [];
  let remaining = input;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut < limit * 0.6) cut = remaining.lastIndexOf(' ', limit);
    if (cut < limit * 0.6) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function createWhatsAppTranscriptBot(options = {}) {
  const config = {
    verifyToken: options.verifyToken ?? process.env.META_WA_VERIFY_TOKEN ?? '',
    appSecret: options.appSecret ?? process.env.META_WA_APP_SECRET ?? '',
    accessToken: options.accessToken ?? process.env.META_WA_ACCESS_TOKEN ?? '',
    phoneNumberId: options.phoneNumberId ?? process.env.META_WA_PHONE_NUMBER_ID ?? '',
    graphVersion: options.graphVersion ?? process.env.META_GRAPH_VERSION ?? DEFAULT_GRAPH_VERSION,
    dataDir: options.dataDir ?? process.env.CLOUD_DATA_DIR ?? join(process.cwd(), '.cloud-data'),
  };
  const fetchImpl = options.fetchImpl || fetch;
  const transcribe = options.transcribe || transcribeVoiceBuffer;
  const onError = options.onError || ((error) => console.error('[whatsapp-transcript-bot]', error.message));
  const seen = new Set();
  const active = new Set();
  const configured = Boolean(config.verifyToken && config.appSecret && config.accessToken && config.phoneNumberId);

  const graph = (path) => `https://graph.facebook.com/${config.graphVersion}/${path}`;
  const authorization = { Authorization: `Bearer ${config.accessToken}` };

  async function graphJson(url, init = {}) {
    const response = await fetchImpl(url, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body?.error?.message || `Meta request failed with ${response.status}`;
      throw new Error(message);
    }
    return body;
  }

  async function sendText(to, text, contextMessageId = '') {
    return graphJson(graph(`${config.phoneNumberId}/messages`), {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });
  }

  async function downloadAudio(job) {
    const metadata = await graphJson(graph(job.mediaId), { headers: authorization });
    const declaredSize = Number(metadata.file_size) || 0;
    if (declaredSize > MAX_AUDIO_BYTES) throw new Error('Audio is larger than the 16 MB WhatsApp limit.');
    if (!metadata.url) throw new Error('Meta did not return an audio download URL.');
    const response = await fetchImpl(metadata.url, { headers: authorization });
    if (!response.ok) throw new Error(`Audio download failed with ${response.status}.`);
    const length = Number(response.headers?.get?.('content-length')) || 0;
    if (length > MAX_AUDIO_BYTES) throw new Error('Audio is larger than the 16 MB WhatsApp limit.');
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) throw new Error('The forwarded voice note was empty.');
    if (audio.length > MAX_AUDIO_BYTES) throw new Error('Audio is larger than the 16 MB WhatsApp limit.');
    return { audio, mimeType: metadata.mime_type || job.mimeType };
  }

  async function processAudio(job) {
    try {
      await sendText(
        job.from,
        'Voice note received. I am checking the audio now and will reply here with the transcript.',
        job.messageId,
      );
      const media = await downloadAudio(job);
      const result = await transcribe(media.audio, {
        id: job.messageId,
        mimetype: media.mimeType,
        dataDir: join(config.dataDir, 'whatsapp-transcript-bot'),
      });
      if (!result.text) {
        await sendText(job.from, 'I processed the voice note but could not detect speech. Try forwarding it again as an audio file.', job.messageId);
        return;
      }
      const chunks = splitWhatsAppText(result.text);
      for (let index = 0; index < chunks.length; index++) {
        const heading = chunks.length > 1 ? `Transcript ${index + 1} of ${chunks.length}\n\n` : 'Transcript\n\n';
        await sendText(job.from, `${heading}${chunks[index]}`, index === 0 ? job.messageId : '');
      }
    } catch (error) {
      onError(error);
      try {
        await sendText(
          job.from,
          'I could not transcribe that voice note. Please resend it as a new voice note or audio file and try again.',
          job.messageId,
        );
      } catch (sendError) {
        onError(sendError);
      }
    }
  }

  function verifySubscription(url) {
    if (!configured) return { ok: false, status: 503, body: 'WhatsApp transcript bot is not configured.' };
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') || '';
    if (mode === 'subscribe' && safeEqual(token, config.verifyToken)) {
      return { ok: true, status: 200, body: challenge };
    }
    return { ok: false, status: 403, body: 'Webhook verification failed.' };
  }

  function acceptWebhook(rawBody, signature) {
    if (!configured) {
      const error = new Error('WhatsApp transcript bot is not configured.');
      error.statusCode = 503;
      throw error;
    }
    if (!verifyMetaSignature(rawBody, signature, config.appSecret)) {
      const error = new Error('Invalid Meta webhook signature.');
      error.statusCode = 401;
      throw error;
    }
    let payload;
    try { payload = JSON.parse(rawBody.toString('utf8')); } catch {
      const error = new Error('Invalid Meta webhook payload.');
      error.statusCode = 400;
      throw error;
    }
    const jobs = extractInboundAudioMessages(payload).filter((job) => {
      if (job.phoneNumberId && job.phoneNumberId !== config.phoneNumberId) return false;
      if (seen.has(job.messageId)) return false;
      seen.add(job.messageId);
      return true;
    });
    for (const job of jobs) {
      const promise = processAudio(job).finally(() => active.delete(promise));
      active.add(promise);
    }
    return { accepted: jobs.length };
  }

  async function waitForIdle() {
    await Promise.all([...active]);
  }

  return { configured, verifySubscription, acceptWebhook, waitForIdle };
}
