import { DatabaseSync } from 'node:sqlite';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 30;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function sessionHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function parseEncryptionKey(value, production) {
  const raw = String(value || '').trim();
  let key = null;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else if (raw) {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) key = decoded;
  }
  if (!key && production) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex value');
  }
  return key || createHash('sha256').update('cleared-chat-development-only').digest();
}

export class AccountStore {
  constructor({ databasePath, encryptionKey, production = false }) {
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(databasePath);
    this.key = parseEncryptionKey(encryptionKey, production);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS secrets (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, kind)
      );
    `);
  }

  async createUser(email, password) {
    const normalized = normalizeEmail(email);
    if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error('Enter a valid email address.');
    if (String(password || '').length < 10) throw new Error('Use at least 10 characters for your password.');
    const salt = randomBytes(16);
    const hash = await scrypt(String(password), salt, 64, SCRYPT_OPTIONS);
    const user = { id: randomUUID(), email: normalized, createdAt: new Date().toISOString() };
    try {
      this.db.prepare(`
        INSERT INTO users (id, email, password_hash, password_salt, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(user.id, user.email, Buffer.from(hash).toString('base64'), salt.toString('base64'), user.createdAt);
    } catch (error) {
      if (String(error?.message || error).includes('UNIQUE')) throw new Error('An account already exists for that email.');
      throw error;
    }
    return user;
  }

  async authenticate(email, password) {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
    if (!row) return null;
    const actual = await scrypt(
      String(password || ''),
      Buffer.from(row.password_salt, 'base64'),
      64,
      SCRYPT_OPTIONS,
    );
    const expected = Buffer.from(row.password_hash, 'base64');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return { id: row.id, email: row.email, createdAt: row.created_at };
  }

  createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400000);
    this.db.prepare(`
      INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionHash(token), userId, expiresAt.toISOString(), now.toISOString());
    return { token, maxAge: SESSION_DAYS * 86400 };
  }

  userForSession(token) {
    if (!token) return null;
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      SELECT users.id, users.email, users.created_at
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(sessionHash(token), now);
    return row ? { id: row.id, email: row.email, createdAt: row.created_at } : null;
  }

  deleteSession(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sessionHash(token));
  }

  pruneSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  }

  listUserIds() {
    return this.db.prepare('SELECT id FROM users ORDER BY created_at').all().map((row) => row.id);
  }

  setSecret(userId, kind, value) {
    const plaintext = String(value || '').trim();
    if (!plaintext) return this.deleteSecret(userId, kind);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    this.db.prepare(`
      INSERT INTO secrets (user_id, kind, ciphertext, iv, tag, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, kind) DO UPDATE SET
        ciphertext = excluded.ciphertext,
        iv = excluded.iv,
        tag = excluded.tag,
        updated_at = excluded.updated_at
    `).run(
      userId,
      kind,
      ciphertext.toString('base64'),
      iv.toString('base64'),
      tag.toString('base64'),
      new Date().toISOString(),
    );
  }

  getSecret(userId, kind) {
    const row = this.db.prepare('SELECT ciphertext, iv, tag FROM secrets WHERE user_id = ? AND kind = ?').get(userId, kind);
    if (!row) return '';
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(row.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  hasSecret(userId, kind) {
    return Boolean(this.db.prepare('SELECT 1 FROM secrets WHERE user_id = ? AND kind = ?').get(userId, kind));
  }

  deleteSecret(userId, kind) {
    this.db.prepare('DELETE FROM secrets WHERE user_id = ? AND kind = ?').run(userId, kind);
  }

  close() {
    this.db.close();
  }
}

export const accountInternals = { normalizeEmail, sessionHash, parseEncryptionKey };
