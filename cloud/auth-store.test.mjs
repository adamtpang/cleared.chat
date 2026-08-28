import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { AccountStore } from './auth-store.mjs';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'cleared-accounts-'));
  const databasePath = join(directory, 'accounts.sqlite');
  const store = new AccountStore({
    databasePath,
    encryptionKey: randomBytes(32).toString('base64'),
    production: true,
  });
  return { directory, databasePath, store };
}

test('creates, authenticates, and isolates an account session', async (t) => {
  const { directory, store } = fixture();
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const user = await store.createUser('Adam@Example.com', 'long-enough-password');
  assert.equal(user.email, 'adam@example.com');
  assert.equal((await store.authenticate('adam@example.com', 'wrong-password')), null);
  assert.equal((await store.authenticate('ADAM@example.com', 'long-enough-password')).id, user.id);

  const session = store.createSession(user.id);
  assert.equal(store.userForSession(session.token).id, user.id);
  store.deleteSession(session.token);
  assert.equal(store.userForSession(session.token), null);
});

test('rejects duplicate accounts and encrypts saved AI keys', async (t) => {
  const { directory, databasePath, store } = fixture();
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const user = await store.createUser('owner@example.com', 'long-enough-password');
  await assert.rejects(
    store.createUser('OWNER@example.com', 'another-long-password'),
    /already exists/,
  );

  const secret = 'private-test-key-123456789';
  store.setSecret(user.id, 'anthropic_api_key', secret);
  assert.equal(store.getSecret(user.id, 'anthropic_api_key'), secret);
  assert.equal(readFileSync(databasePath).includes(Buffer.from(secret)), false);
  store.deleteSecret(user.id, 'anthropic_api_key');
  assert.equal(store.getSecret(user.id, 'anthropic_api_key'), '');
});
