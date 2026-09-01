import { spawn } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, extname, join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 3 * 60_000;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

export const LOCAL_AI_PROVIDERS = Object.freeze([
  { id: 'claude_local', label: 'Claude subscription' },
  { id: 'codex_local', label: 'ChatGPT subscription' },
  { id: 'local', label: 'Offline ranking' },
]);

export function normalizeAiProvider(value) {
  const id = String(value || '').trim().toLowerCase().replaceAll('-', '_');
  if (['cli', 'claude', 'claude_cli', 'claude_local'].includes(id)) return 'claude_local';
  if (['codex', 'codex_cli', 'codex_local'].includes(id)) return 'codex_local';
  if (['grok', 'grok_cli', 'grok_local'].includes(id)) return 'grok_local';
  if (['api', 'anthropic', 'anthropic_api'].includes(id)) return 'api';
  if (['local', 'heuristic', 'offline'].includes(id)) return 'local';
  return id || 'claude_local';
}

function pathCandidates(name, env) {
  const paths = String(env.Path || env.PATH || '').split(delimiter).filter(Boolean);
  const suffixes = process.platform === 'win32' ? ['.exe', '', '.cmd', '.bat'] : [''];
  const candidates = [];
  for (const suffix of suffixes) {
    for (const directory of paths) candidates.push(join(directory, `${name}${suffix}`));
  }
  if (process.platform === 'win32') {
    if (name === 'claude') candidates.unshift(join(env.USERPROFILE || '', '.local', 'bin', 'claude.exe'));
    if (name === 'codex') {
      const root = join(env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
      try {
        for (const version of readdirSync(root).reverse()) candidates.unshift(join(root, version, 'codex.exe'));
      } catch { /* optional native install */ }
      candidates.push(join(env.APPDATA || '', 'npm', 'codex.cmd'));
    }
  }
  return candidates;
}

export function resolveLocalAiExecutable(requested, provider, env = process.env) {
  const value = String(requested || '').trim();
  if (!value) return '';
  if (value.includes('/') || value.includes('\\') || extname(value)) {
    return existsSync(value) ? value : '';
  }
  const name = provider === 'codex_local' ? 'codex' : 'claude';
  return pathCandidates(value === name ? name : value, env).find((candidate) => existsSync(candidate)) || '';
}

function subscriptionEnv(provider, baseEnv = process.env) {
  const env = { ...baseEnv };
  if (provider === 'claude_local') {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_USE_BEDROCK;
    delete env.CLAUDE_CODE_USE_VERTEX;
    delete env.CLAUDE_CODE_USE_FOUNDRY;
  } else {
    delete env.OPENAI_API_KEY;
    delete env.AZURE_OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
  }
  return env;
}

function spawnOptions(executable, env, cwd) {
  return {
    env,
    cwd,
    windowsHide: true,
    shell: process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(executable).toLowerCase()),
    stdio: ['pipe', 'pipe', 'pipe'],
  };
}

function collectChild(child, { input = '', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const append = (current, chunk) => {
      const next = current + String(chunk);
      if (Buffer.byteLength(next) > MAX_CAPTURE_BYTES) {
        child.kill();
        finish(reject, new Error('Local AI returned too much output.'));
      }
      return next;
    };
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => finish(resolve, { code, stdout, stderr }));
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`Local AI timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    timer.unref?.();
    child.stdin?.end(input);
  });
}

function commandError(provider, code, stdout, stderr) {
  const detail = [stderr, stdout].map((value) => String(value || '').trim()).find(Boolean) || '(no output)';
  return new Error(`${provider} exited ${code}: ${detail.slice(0, 500)}`);
}

export async function runClaudeLocal(prompt, options = {}) {
  const env = subscriptionEnv('claude_local', options.env);
  const executable = resolveLocalAiExecutable(options.bin || 'claude', 'claude_local', env);
  if (!executable) throw new Error('Claude Code is not installed. Install it, run claude auth login, then check again.');
  const args = [
    '-p',
    '--safe-mode',
    '--no-session-persistence',
    '--tools', '',
    '--output-format', 'json',
    '--model', options.model || 'sonnet',
    '--system-prompt', 'You are the private cleared.chat analysis engine. Use only the supplied prompt. Do not use tools, read files, or communicate externally. Return only the requested text or JSON.',
  ];
  const child = (options.spawnImpl || spawn)(executable, args, spawnOptions(executable, env, options.cwd || tmpdir()));
  let result;
  try {
    result = await collectChild(child, { input: String(prompt || ''), timeoutMs: options.timeoutMs });
  } catch (error) {
    throw new Error(`Could not run Claude Local. ${error.message}`);
  }
  if (result.code !== 0) throw commandError('Claude Local', result.code, result.stdout, result.stderr);
  try {
    const parsed = JSON.parse(result.stdout);
    if (parsed.is_error) throw new Error(parsed.result || parsed.error || 'Claude returned an error.');
    return String(parsed.result || '');
  } catch (error) {
    if (error.message && !error.message.startsWith('Unexpected')) throw error;
    throw new Error(`Unexpected Claude Local output: ${result.stdout.slice(0, 300)}`);
  }
}

export async function runCodexLocal(prompt, options = {}) {
  const env = subscriptionEnv('codex_local', options.env);
  const executable = resolveLocalAiExecutable(options.bin || 'codex', 'codex_local', env);
  if (!executable) throw new Error('Codex CLI is not installed. Install it, run codex login, then check again.');
  const outputPath = join(tmpdir(), `cleared-codex-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'read-only',
    '--color', 'never',
    '--output-last-message', outputPath,
  ];
  if (options.model) args.push('--model', options.model);
  args.push('-');
  const child = (options.spawnImpl || spawn)(executable, args, spawnOptions(executable, env, options.cwd || tmpdir()));
  try {
    const result = await collectChild(child, {
      input: `You are the private cleared.chat analysis engine. Do not use tools, read files, or communicate externally. Return only the requested text or JSON.\n\n${String(prompt || '')}`,
      timeoutMs: options.timeoutMs,
    });
    if (result.code !== 0) throw commandError('Codex Local', result.code, result.stdout, result.stderr);
    if (!existsSync(outputPath)) throw new Error(`Codex Local did not produce a final response. ${result.stderr.slice(0, 300)}`);
    return readFileSync(outputPath, 'utf8').trim();
  } catch (error) {
    throw new Error(`Could not run Codex Local. ${error.message}`);
  } finally {
    try { if (existsSync(outputPath)) unlinkSync(outputPath); } catch { /* best effort */ }
  }
}

async function probe({ provider, bin, env = process.env, spawnImpl = spawn, timeoutMs = 10_000 }) {
  const cleanEnv = subscriptionEnv(provider, env);
  const executable = resolveLocalAiExecutable(bin, provider, cleanEnv);
  const label = LOCAL_AI_PROVIDERS.find((item) => item.id === provider)?.label || provider;
  if (!executable) return { id: provider, label, available: false, authenticated: false, detail: 'Not installed' };
  const args = provider === 'claude_local' ? ['auth', 'status'] : ['login', 'status'];
  try {
    const child = spawnImpl(executable, args, spawnOptions(executable, cleanEnv, tmpdir()));
    const result = await collectChild(child, { timeoutMs });
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    const authenticated = provider === 'claude_local'
      ? result.code === 0 && /"loggedIn"\s*:\s*true/.test(combined)
      : result.code === 0 && /logged in using chatgpt/i.test(combined);
    return {
      id: provider,
      label,
      available: true,
      authenticated,
      detail: authenticated ? 'Subscription connected' : 'Sign in required',
      executable: basename(executable),
    };
  } catch (error) {
    return { id: provider, label, available: true, authenticated: false, detail: error.message };
  }
}

export async function inspectLocalAiProviders(options = {}) {
  const [claude, codex] = await Promise.all([
    probe({ provider: 'claude_local', bin: options.claudeBin || 'claude', ...options }),
    probe({ provider: 'codex_local', bin: options.codexBin || 'codex', ...options }),
  ]);
  return [claude, codex, {
    id: 'local',
    label: 'Offline ranking',
    available: true,
    authenticated: true,
    detail: 'No AI drafts',
  }];
}
