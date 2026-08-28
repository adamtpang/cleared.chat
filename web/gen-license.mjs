#!/usr/bin/env node
// Mint a license key for an email. Run:  node gen-license.mjs someone@example.com
//
// Requires LICENSE_SECRET in web/.env - generate one once with:
//   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
// and keep it private (web/.env is gitignored). Anyone with the secret can
// mint keys, so it's the one thing in this whole scheme that must never leak.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateKey } from './license.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

(() => {
  const f = join(DIR, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const email = process.argv[2];
if (!email) {
  console.error('usage: node gen-license.mjs <email>');
  process.exit(1);
}

const secret = process.env.LICENSE_SECRET;
if (!secret) {
  console.error('LICENSE_SECRET is not set in web/.env - generate one first:');
  console.error(`  node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`);
  console.error('then add LICENSE_SECRET=<that value> to web/.env');
  process.exit(1);
}

console.log(generateKey(email, secret));
