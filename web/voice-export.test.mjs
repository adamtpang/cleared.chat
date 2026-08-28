import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVoiceNotesMarkdown, voiceNoteStats } from './voice-export.mjs';

const messages = [
  { kind: 'voice', isSender: false, senderName: 'Olena', timestamp: '2026-08-28T10:00:00Z', seconds: 65,
    transcriptionStatus: 'complete', transcript: 'Can we move the call to Friday?' },
  { kind: 'voice', isSender: false, senderName: 'Olena', timestamp: '2026-08-28T11:00:00Z', seconds: 15,
    transcriptionStatus: 'transcribing', text: '[voice note, transcribing locally]' },
  { kind: 'voice', isSender: true, timestamp: '2026-08-28T12:00:00Z', seconds: 8,
    transcriptionStatus: 'complete', transcript: 'Friday works.' },
  { kind: 'text', isSender: false, text: 'Thanks' },
];

test('voice-note stats separate received, sent, complete, and pending notes', () => {
  assert.deepEqual(voiceNoteStats(messages), {
    total: 3,
    received: 2,
    sent: 1,
    complete: 1,
    pending: 1,
    failed: 0,
    seconds: 80,
  });
});

test('voice-note markdown exports received transcripts without sent notes', () => {
  const markdown = buildVoiceNotesMarkdown({
    who: 'Olena',
    messages,
    exportedAt: new Date('2026-08-28T13:00:00Z'),
  });
  assert.match(markdown, /^# Voice notes from Olena/m);
  assert.match(markdown, /Received voice notes: 2/);
  assert.match(markdown, /Total duration: 1:20/);
  assert.match(markdown, /Can we move the call to Friday\?/);
  assert.match(markdown, /Transcription is still in progress/);
  assert.doesNotMatch(markdown, /Friday works\./);
});
