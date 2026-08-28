// Offline license keys. No network call, no database, no Stripe API at
// runtime - the secret you hold is the whole trust chain. A key is just
// HMAC-SHA256(email, LICENSE_SECRET), formatted for humans to type.
//
// Mint one: node gen-license.mjs someone@example.com
// (including yourself - you own the secret, you don't need to buy your
// own product to get a real, valid key for it.)

import { createHmac, timingSafeEqual } from 'node:crypto';

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function rawDigest(email, secret) {
  return createHmac('sha256', secret).update(normEmail(email)).digest('hex');
}

// BEEP-XXXX-XXXX-XXXX-XXXX, uppercase, easy to read and type.
export function generateKey(email, secret) {
  if (!secret) throw new Error('LICENSE_SECRET is not set');
  const hex = rawDigest(email, secret).toUpperCase();
  const groups = [hex.slice(0, 4), hex.slice(4, 8), hex.slice(8, 12), hex.slice(12, 16)];
  return `BEEP-${groups.join('-')}`;
}

export function verifyKey(email, key, secret) {
  if (!secret || !email || !key) return false;
  let expected;
  try {
    expected = generateKey(email, secret);
  } catch {
    return false;
  }
  const a = Buffer.from(String(key).trim().toUpperCase());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
