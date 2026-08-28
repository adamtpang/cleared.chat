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
});
