import test from 'node:test';
import assert from 'node:assert/strict';
import { workerEnvironment, workerPaths } from './worker-manager.mjs';

test('gives every account isolated WhatsApp and snapshot paths', () => {
  const first = workerPaths('/data', 'first-user');
  const second = workerPaths('/data', 'second-user');
  assert.notEqual(first.whatsapp, second.whatsapp);
  assert.notEqual(first.snapshots, second.snapshots);
  assert.match(first.whatsapp, /first-user[\\/]whatsapp$/);
});

test('hosted workers use direct WhatsApp and disable unrelated sources', () => {
  const env = workerEnvironment({
    dataDir: '/data',
    userId: 'account-id',
    anthropicKey: 'sk-ant-test',
    baseEnv: { VOICE_TRANSCRIPTION: '1' },
  });
  assert.equal(env.WHATSAPP_DIRECT, '1');
  assert.equal(env.BEEPER_ENABLED, '0');
  assert.equal(env.EMAIL_ENABLED, '0');
  assert.equal(env.LLM, 'api');
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-test');
  assert.match(env.WA_DATA_DIR, /account-id[\\/]whatsapp$/);
});

test('hosted workers fall back to local ranking without an AI key', () => {
  const env = workerEnvironment({
    dataDir: '/data',
    userId: 'account-id',
    baseEnv: {},
  });
  assert.equal(env.LLM, 'local');
  assert.equal(env.ANTHROPIC_API_KEY, '');
});
