import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createGateway } from './gateway.mjs';

test('signup creates a browser session and opens the private app', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'cleared-gateway-'));
  const workers = {
    async get() { throw new Error('worker should not start in this test'); },
    async restart() {},
    stopAll() {},
  };
  const gateway = createGateway({ dataDir, production: false, workerManager: workers });
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  const base = `http://127.0.0.1:${gateway.server.address().port}`;
  t.after(async () => {
    gateway.server.close();
    await once(gateway.server, 'close');
    rmSync(dataDir, { recursive: true, force: true });
  });

  const login = await fetch(`${base}/login`);
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Welcome back/);

  const signup = await fetch(`${base}/signup`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'member@example.com', password: 'a-secure-test-password' }),
  });
  assert.equal(signup.status, 303);
  assert.equal(signup.headers.get('location'), '/app');
  const cookie = signup.headers.get('set-cookie').split(';')[0];

  const app = await fetch(`${base}/app`, { headers: { cookie } });
  assert.equal(app.status, 200);
  assert.match(await app.text(), /id="accountbtn"/);

  const account = await fetch(`${base}/api/account`, { headers: { cookie } });
  assert.deepEqual(await account.json(), { email: 'member@example.com', aiReady: false });

  const anonymous = await fetch(`${base}/api/account`);
  assert.equal(anonymous.status, 401);
});

test('an authenticated browser reaches its own live WhatsApp worker', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'cleared-worker-'));
  const gateway = createGateway({ dataDir, production: false });
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  const base = `http://127.0.0.1:${gateway.server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => gateway.server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  });

  const signup = await fetch(`${base}/signup`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'worker@example.com', password: 'a-secure-test-password' }),
  });
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${base}/api/wa/status`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.status, 'unpaired');
  assert.equal(status.registered, false);

  const unconfirmedSend = await fetch(`${base}/api/wa/send`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      chatId: 'wa:60123456789@s.whatsapp.net',
      text: 'test reply',
      requestId: '12345678-1234-4234-9234-123456789abc',
      confirmed: false,
    }),
  });
  assert.equal(unconfirmedSend.status, 400);
  assert.deepEqual(await unconfirmedSend.json(), { error: 'Final confirmation is required.' });
});

test('Clerk Google login reuses an existing account and protects anonymous requests', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'cleared-clerk-'));
  const publishableKey = `pk_test_${Buffer.from('clerk.test$').toString('base64')}`;
  const workers = {
    async get() { throw new Error('worker should not start in this test'); },
    async restart() {},
    stopAll() {},
  };
  const clerkClient = {
    async authenticateRequest(request) {
      if (request.headers.get('x-test-clerk-handshake')) {
        const headers = new Headers({ location: '/app' });
        headers.append('set-cookie', '__session=test-session; Path=/; HttpOnly');
        headers.append('set-cookie', '__refresh=test-refresh; Path=/; HttpOnly');
        return { isAuthenticated: false, status: 'handshake', headers };
      }
      const bearer = request.headers.get('authorization');
      const userId = request.headers.get('x-test-clerk-user')
        || (bearer === 'Bearer fresh-browser-token' ? 'user_google_owner' : '');
      if (!userId) return { isAuthenticated: false, status: 'signed-out', headers: new Headers() };
      return {
        isAuthenticated: true,
        status: 'signed-in',
        headers: new Headers(),
        toAuth: () => ({ userId, sessionId: 'session_google_owner' }),
      };
    },
    users: {
      async getUser() {
        return {
          primaryEmailAddressId: 'email_owner',
          emailAddresses: [{
            id: 'email_owner',
            emailAddress: 'owner@example.com',
            verification: { status: 'verified' },
          }],
        };
      },
    },
    sessions: { async revokeSession() {} },
  };
  const gateway = createGateway({
    dataDir,
    production: false,
    workerManager: workers,
    clerkClient,
    clerkPublishableKey: publishableKey,
    clerkFrontendApi: 'https://clerk.test',
    clerkAuthorizedParties: ['http://127.0.0.1'],
  });
  const original = await gateway.accounts.createUser('owner@example.com', 'a-secure-test-password');
  gateway.server.listen(0, '127.0.0.1');
  await once(gateway.server, 'listening');
  const base = `http://127.0.0.1:${gateway.server.address().port}`;
  t.after(async () => {
    gateway.server.close();
    await once(gateway.server, 'close');
    rmSync(dataDir, { recursive: true, force: true });
  });

  const login = await fetch(`${base}/login`);
  assert.equal(login.status, 200);
  const loginHtml = await login.text();
  assert.match(loginHtml, /Continue with Google/);
  assert.match(loginHtml, /clerk\.test\/npm\/@clerk\/clerk-js/);
  assert.match(loginHtml, /authenticateWithRedirect/);
  assert.doesNotMatch(loginHtml, /Email address/);
  assert.doesNotMatch(loginHtml, /Sign up/);

  const signup = await fetch(`${base}/signup`, { redirect: 'manual' });
  assert.equal(signup.status, 303);
  assert.equal(signup.headers.get('location'), '/login');

  const callback = await fetch(`${base}/sso-callback`);
  assert.equal(callback.status, 200);
  assert.match(await callback.text(), /handleRedirectCallback/);

  const anonymous = await fetch(`${base}/api/account`);
  assert.equal(anonymous.status, 401);

  const handshake = await fetch(`${base}/app`, {
    redirect: 'manual',
    headers: { 'x-test-clerk-handshake': '1' },
  });
  assert.equal(handshake.status, 307);
  assert.deepEqual(handshake.headers.getSetCookie(), [
    '__session=test-session; Path=/; HttpOnly',
    '__refresh=test-refresh; Path=/; HttpOnly',
  ]);

  const account = await fetch(`${base}/api/account`, {
    headers: { authorization: 'Bearer fresh-browser-token' },
  });
  assert.equal(account.status, 200);
  assert.deepEqual(await account.json(), { email: 'owner@example.com', aiReady: false });
  assert.equal(gateway.accounts.userForClerkId('user_google_owner').id, original.id);
  assert.equal(gateway.accounts.listUserIds().length, 1);

  const app = await fetch(`${base}/app`, {
    headers: { authorization: 'Bearer fresh-browser-token' },
  });
  assert.equal(app.status, 200);
  const appHtml = await app.text();
  assert.match(appHtml, /clerk\.test\/npm\/@clerk\/clerk-js/);
  assert.match(appHtml, /clerk\.session\.getToken/);
  assert.match(appHtml, /authorization', 'Bearer '/);
});
