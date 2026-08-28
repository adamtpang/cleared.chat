import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ENABLED = process.env.VOICE_TRANSCRIPTION !== '0';
const PYTHON = process.env.WHISPER_PYTHON || 'python';
const MODEL = process.env.WHISPER_MODEL || 'small';
const DATA_DIR = () => process.env.WA_DATA_DIR || DIR;
const AUDIO_DIR = () => join(DATA_DIR(), 'voice-note-cache');

let worker = null;
let workerError = '';
let sequence = 0;
const pending = new Map();

function extensionFor(mimetype = '') {
  const type = String(mimetype).toLowerCase();
  if (type.includes('ogg') || type.includes('opus')) return '.ogg';
  if (type.includes('mpeg')) return '.mp3';
  if (type.includes('mp4') || type.includes('m4a')) return '.m4a';
  if (type.includes('wav')) return '.wav';
  return '.bin';
}

function rejectPending(error) {
  for (const job of pending.values()) job.reject(error);
  pending.clear();
}

function startWorker() {
  if (!ENABLED) throw new Error('local voice-note transcription is disabled');
  if (worker && !worker.killed) return worker;

  workerError = '';
  worker = spawn(PYTHON, ['-u', join(DIR, 'transcribe_worker.py')], {
    cwd: DIR,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  worker.stdout.setEncoding('utf8');
  worker.stderr.setEncoding('utf8');

  const lines = createInterface({ input: worker.stdout });
  lines.on('line', (line) => {
    let result;
    try { result = JSON.parse(line); } catch { return; }
    const job = pending.get(result.id);
    if (!job) return;
    pending.delete(result.id);
    if (result.error) job.reject(new Error(result.error));
    else job.resolve(result);
  });

  worker.stderr.on('data', (chunk) => {
    workerError = String(chunk || '').trim().slice(-500);
  });
  worker.on('error', (error) => {
    workerError = error.message || String(error);
    rejectPending(error);
    worker = null;
  });
  worker.on('close', (code) => {
    const detail = workerError ? `: ${workerError}` : '';
    rejectPending(new Error(`voice transcription worker exited ${code}${detail}`));
    worker = null;
  });
  return worker;
}

export function transcriptionStatus() {
  return {
    enabled: ENABLED,
    model: MODEL,
    running: Boolean(worker && !worker.killed),
    pending: pending.size,
    error: workerError || null,
  };
}

export async function transcribeVoiceBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('voice note audio is empty');
  mkdirSync(AUDIO_DIR(), { recursive: true });
  const safeId = String(options.id || `voice-${Date.now()}`).replace(/[^a-z0-9_-]+/gi, '-');
  const extension = extensionFor(options.mimetype);
  const path = join(AUDIO_DIR(), `${safeId}${extension}`);
  writeFileSync(path, buffer);

  try {
    const id = `${process.pid}-${Date.now()}-${++sequence}`;
    const result = await new Promise((resolve, reject) => {
      const active = startWorker();
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('voice-note transcription timed out'));
      }, Number(process.env.WHISPER_TIMEOUT_MS || 10 * 60_000));
      pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      active.stdin.write(`${JSON.stringify({ id, path, model: MODEL })}\n`);
    });
    return {
      text: String(result.text || '').trim(),
      language: result.language || null,
      languageProbability: Number(result.languageProbability) || null,
    };
  } finally {
    if (existsSync(path)) {
      try { unlinkSync(path); } catch { /* cleaned on the next successful pass */ }
    }
  }
}
