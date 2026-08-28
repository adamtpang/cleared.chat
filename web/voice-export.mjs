function cleanTranscript(message = {}) {
  const direct = String(message.transcript || '').trim();
  if (direct) return direct;
  const text = String(message.text || '')
    .replace(/^\[Voice note transcript\]\s*/i, '')
    .trim();
  return /^\[voice note,/i.test(text) ? '' : text;
}

function durationLabel(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function timestampLabel(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}

export function voiceNoteStats(messages = []) {
  const notes = messages.filter((message) => message?.kind === 'voice');
  const received = notes.filter((message) => !message.isSender);
  const complete = received.filter((message) => message.transcriptionStatus === 'complete' && cleanTranscript(message));
  const pending = received.filter((message) => (
    ['pending', 'recovering', 'transcribing'].includes(message.transcriptionStatus)
  ));
  const failed = received.filter((message) => ['failed', 'empty'].includes(message.transcriptionStatus));
  return {
    total: notes.length,
    received: received.length,
    sent: notes.length - received.length,
    complete: complete.length,
    pending: pending.length,
    failed: failed.length,
    seconds: received.reduce((sum, message) => sum + (Number(message.seconds) || 0), 0),
  };
}

export function buildVoiceNotesMarkdown({ who = 'Contact', messages = [], exportedAt = new Date() } = {}) {
  const notes = messages
    .filter((message) => message?.kind === 'voice' && !message.isSender)
    .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  const stats = voiceNoteStats(messages);
  const lines = [
    `# Voice notes from ${String(who || 'Contact').trim() || 'Contact'}`,
    '',
    `- Exported: ${timestampLabel(exportedAt)}`,
    `- Received voice notes: ${stats.received}`,
    `- Transcribed: ${stats.complete}`,
    `- Total duration: ${durationLabel(stats.seconds)}`,
    '',
    '---',
    '',
  ];

  if (!notes.length) {
    lines.push('No received voice notes were found in the synced conversation history.', '');
    return lines.join('\n');
  }

  notes.forEach((message, index) => {
    const transcript = cleanTranscript(message);
    const status = message.transcriptionStatus || (transcript ? 'complete' : 'unavailable');
    lines.push(
      `## ${index + 1}. ${timestampLabel(message.timestamp)}`,
      '',
      `- Speaker: ${String(message.senderName || who || 'Contact').trim() || 'Contact'}`,
      `- Duration: ${durationLabel(message.seconds)}`,
      `- Status: ${status}`,
      '',
      transcript || (['pending', 'recovering', 'transcribing'].includes(status)
        ? '_Transcription is still in progress._'
        : '_Transcript unavailable._'),
      '',
    );
  });
  return lines.join('\n');
}

export const voiceExportInternals = { cleanTranscript, durationLabel, timestampLabel };
