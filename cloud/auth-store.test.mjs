import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
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

test('links a Google identity to the existing account without changing its workspace ID', async (t) => {
  const { directory, store } = fixture();
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const original = await store.createUser('owner@example.com', 'long-enough-password');
  store.setSecret(original.id, 'anthropic_api_key', 'private-test-key-123456789');

  const linked = store.findOrCreateClerkUser('user_google_owner', 'OWNER@example.com');
  assert.equal(linked.id, original.id);
  assert.equal(store.userForClerkId('user_google_owner').id, original.id);
  assert.equal(store.getSecret(linked.id, 'anthropic_api_key'), 'private-test-key-123456789');
  assert.equal(store.listUserIds().length, 1);
});

test('migrates the production password schema before linking Clerk users', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cleared-accounts-old-'));
  const databasePath = join(directory, 'accounts.sqlite');
  const old = new DatabaseSync(databasePath);
  old.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  old.prepare(`
    INSERT INTO users (id, email, password_hash, password_salt, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('existing-id', 'owner@example.com', 'hash', 'salt', '2026-08-28T00:00:00.000Z');
  old.close();

  const store = new AccountStore({
    databasePath,
    encryptionKey: randomBytes(32).toString('base64'),
    production: true,
  });
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  assert.equal(store.findOrCreateClerkUser('user_migrated', 'owner@example.com').id, 'existing-id');
  assert.equal(store.userForClerkId('user_migrated').id, 'existing-id');
});
