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
const AUDIO_DIR = (dataDir = DATA_DIR()) => join(dataDir, 'voice-note-cache');

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
    if (result.stage || result.progress !== undefined) {
      job.onProgress?.({
        stage: result.stage || 'transcribing',
        percent: Number(result.progress) || 0,
        processedSeconds: Number(result.processedSeconds) || 0,
        durationSeconds: Number(result.durationSeconds) || 0,
        audioBytes: Number(result.audioBytes) || 0,
      });
      return;
    }
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
  const audioDir = AUDIO_DIR(options.dataDir);
  mkdirSync(audioDir, { recursive: true });
  const safeId = String(options.id || `voice-${Date.now()}`).replace(/[^a-z0-9_-]+/gi, '-');
  const extension = extensionFor(options.mimetype);
  const path = join(audioDir, `${safeId}${extension}`);
  writeFileSync(path, buffer);

  try {
    const id = `${process.pid}-${Date.now()}-${++sequence}`;
    const result = await new Promise((resolve, reject) => {
      options.onProgress?.({ stage: 'loading-model', percent: 0, processedSeconds: 0, durationSeconds: 0 });
      const active = startWorker();
      let stallTimeout = null;
      const totalTimeout = setTimeout(() => {
        pending.delete(id);
        if (stallTimeout) clearTimeout(stallTimeout);
        reject(new Error('voice-note transcription timed out'));
      }, Number(process.env.WHISPER_TIMEOUT_MS || 10 * 60_000));
      const cleanup = () => {
        clearTimeout(totalTimeout);
        if (stallTimeout) clearTimeout(stallTimeout);
      };
      const resetStallTimeout = () => {
        if (stallTimeout) clearTimeout(stallTimeout);
        stallTimeout = setTimeout(() => {
          pending.delete(id);
          cleanup();
          reject(new Error('transcription worker stopped reporting progress for 90 seconds'));
        }, Number(process.env.WHISPER_STALL_TIMEOUT_MS || 90_000));
      };
      pending.set(id, {
        onProgress: (progress) => {
          resetStallTimeout();
          options.onProgress?.(progress);
        },
        resolve: (value) => { cleanup(); resolve(value); },
        reject: (error) => { cleanup(); reject(error); },
      });
      resetStallTimeout();
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
