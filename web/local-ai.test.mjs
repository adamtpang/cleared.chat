import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { writeFileSync } from 'node:fs';
import {
  inspectLocalAiProviders,
  normalizeAiProvider,
  offlineModelNotice,
  runClaudeLocal,
  runCodexLocal,
} from './local-ai.mjs';

function fakeSpawn(handle) {
  return (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => child.emit('close', 143);
    let input = '';
    child.stdin = new Writable({
      write(chunk, encoding, callback) {
        input += chunk.toString();
        callback();
      },
      final(callback) {
        callback();
        queueMicrotask(() => handle({ executable, args, options, input, child }));
      },
    });
    return child;
  };
}

test('normalizes the local subscription provider names', () => {
  assert.equal(normalizeAiProvider('cli'), 'claude_local');
  assert.equal(normalizeAiProvider('claude-local'), 'claude_local');
  assert.equal(normalizeAiProvider('codex'), 'codex_local');
  assert.equal(normalizeAiProvider('offline'), 'local');
});

test('Claude Local forces subscription auth and disables tools and persistence', async () => {
  let invocation;
  const result = await runClaudeLocal('private prompt', {
    bin: process.execPath,
    model: 'sonnet',
    env: { ...process.env, ANTHROPIC_API_KEY: 'must-not-pass' },
    spawnImpl: fakeSpawn((call) => {
      invocation = call;
      call.child.stdout.end(JSON.stringify({ is_error: false, result: 'claude result' }));
      call.child.emit('close', 0);
    }),
  });
  assert.equal(result, 'claude result');
  assert.equal(invocation.options.env.ANTHROPIC_API_KEY, undefined);
  assert.ok(invocation.args.includes('--safe-mode'));
  assert.ok(invocation.args.includes('--no-session-persistence'));
  assert.deepEqual(invocation.args.slice(invocation.args.indexOf('--tools'), invocation.args.indexOf('--tools') + 2), ['--tools', '']);
  assert.equal(invocation.input, 'private prompt');
});

test('Codex Local forces ChatGPT auth and uses an ephemeral read-only run', async () => {
  let invocation;
  const result = await runCodexLocal('private prompt', {
    bin: process.execPath,
    env: { ...process.env, OPENAI_API_KEY: 'must-not-pass' },
    spawnImpl: fakeSpawn((call) => {
      invocation = call;
      const outputPath = call.args[call.args.indexOf('--output-last-message') + 1];
      writeFileSync(outputPath, 'codex result');
      call.child.emit('close', 0);
    }),
  });
  assert.equal(result, 'codex result');
  assert.equal(invocation.options.env.OPENAI_API_KEY, undefined);
  assert.ok(invocation.args.includes('--ephemeral'));
  assert.ok(invocation.args.includes('--ignore-user-config'));
  assert.deepEqual(invocation.args.slice(invocation.args.indexOf('--sandbox'), invocation.args.indexOf('--sandbox') + 2), ['--sandbox', 'read-only']);
  assert.match(invocation.input, /private cleared\.chat analysis engine/);
  assert.match(invocation.input, /private prompt/);
});

test('provider inspection reports authenticated local subscriptions without exposing paths', async () => {
  const providers = await inspectLocalAiProviders({
    claudeBin: process.execPath,
    codexBin: process.execPath,
    spawnImpl: fakeSpawn((call) => {
      if (call.args[0] === 'auth') call.child.stdout.end('{"loggedIn":true}');
      else call.child.stdout.end('Logged in using ChatGPT');
      call.child.emit('close', 0);
    }),
  });
  assert.deepEqual(providers.map((provider) => [provider.id, provider.authenticated]), [
    ['claude_local', true],
    ['codex_local', true],
    ['local', true],
  ]);
  assert.equal(providers[0].executable, providers[1].executable);
  assert.doesNotMatch(providers[0].executable, /[\\/]/);
});

test('offline notice points hosted accounts at Account and local apps at Settings', () => {
  const hosted = offlineModelNotice({ hosted: true });
  const local = offlineModelNotice({ hosted: false });
  assert.match(hosted, /Anthropic API key under Account/);
  assert.doesNotMatch(hosted, /subscription/i);
  assert.match(local, /Settings > Bring your own subscription/);
  assert.doesNotMatch(local, /Account/);
  for (const text of [hosted, local]) assert.doesNotMatch(text, /\u2014/);
});
