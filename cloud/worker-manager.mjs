import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(DIR, '..', 'web');

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForWorker(port, child) {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (child.exitCode !== null) throw new Error(`worker exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/license/status`);
      if (response.ok) return;
    } catch { /* keep waiting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('account worker did not start in time');
}

export function workerPaths(dataDir, userId) {
  const root = join(dataDir, 'users', userId);
  return {
    root,
    whatsapp: join(root, 'whatsapp'),
    snapshots: join(root, 'snapshots'),
  };
}

export function redactWorkerLog(chunk) {
  return String(chunk).replace(/<Buffer[^>]*>/g, '<Buffer redacted>');
}

export function workerEnvironment({ dataDir, userId, anthropicKey = '', baseEnv = process.env }) {
  const paths = workerPaths(dataDir, userId);
  const modelKey = anthropicKey || baseEnv.ANTHROPIC_API_KEY || '';
  return {
    ...baseEnv,
    PORT: '',
    DEMO: '0',
    WHATSAPP_DIRECT: '1',
    EMAIL_ENABLED: '0',
    BEEPER_ENABLED: '0',
    BEEPER_ACCESS_TOKEN: '',
    CLEARED_HOSTED: '1',
    LICENSE_SECRET: '',
    WA_DATA_DIR: paths.whatsapp,
    SNAPSHOT_DIR: paths.snapshots,
    LLM: modelKey ? 'api' : 'local',
    ANTHROPIC_API_KEY: modelKey,
    VOICE_TRANSCRIPTION: baseEnv.VOICE_TRANSCRIPTION || '1',
  };
}

export class WorkerManager {
  constructor({ dataDir, accountStore }) {
    this.dataDir = dataDir;
    this.accountStore = accountStore;
    this.workers = new Map();
    mkdirSync(join(dataDir, 'users'), { recursive: true, mode: 0o700 });
  }

  async get(userId) {
    const existing = this.workers.get(userId);
    if (existing?.child?.exitCode === null) return existing;
    if (existing?.starting) return existing.starting;
    const record = { starting: null };
    record.starting = this.start(userId);
    this.workers.set(userId, record);
    return record.starting;
  }

  async start(userId) {
    const port = await freePort();
    const paths = workerPaths(this.dataDir, userId);
    mkdirSync(paths.whatsapp, { recursive: true, mode: 0o700 });
    mkdirSync(paths.snapshots, { recursive: true, mode: 0o700 });
    const env = workerEnvironment({
      dataDir: this.dataDir,
      userId,
      anthropicKey: this.accountStore.getSecret(userId, 'anthropic_api_key'),
    });
    env.PORT = String(port);
    const child = spawn(process.execPath, [join(WEB_DIR, 'server.mjs')], {
      cwd: WEB_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const prefix = `[worker:${userId.slice(0, 8)}]`;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => process.stdout.write(`${prefix} ${redactWorkerLog(chunk)}`));
    child.stderr.on('data', (chunk) => process.stderr.write(`${prefix} ${redactWorkerLog(chunk)}`));
    child.on('exit', () => {
      const current = this.workers.get(userId);
      if (current?.child === child) this.workers.delete(userId);
    });
    try {
      await waitForWorker(port, child);
    } catch (error) {
      child.kill();
      this.workers.delete(userId);
      throw error;
    }
    const worker = { child, port, userId, startedAt: new Date().toISOString() };
    this.workers.set(userId, worker);
    return worker;
  }

  stop(userId) {
    const worker = this.workers.get(userId);
    if (worker?.child?.exitCode === null) worker.child.kill();
    this.workers.delete(userId);
  }

  restart(userId) {
    this.stop(userId);
    return this.get(userId);
  }

  stopAll() {
    for (const userId of this.workers.keys()) this.stop(userId);
  }
}
