import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createClerkClient } from '@clerk/backend';
import { AccountStore } from './auth-store.mjs';
import { WorkerManager } from './worker-manager.mjs';
import { accountPage, authPage, clerkAuthPage } from './pages.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');
const WEB_APP = join(ROOT, 'web', 'public', 'index.html');
const ICON = join(ROOT, 'icon.svg');
const COOKIE = 'cleared_session';
const authAttempts = new Map();

function parseCookies(header) {
  return Object.fromEntries(String(header || '').split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function cookieHeader(token, maxAge, secure) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function clearCookie(secure) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, ...headers });
  res.end();
}

async function readBody(req, maxBytes = 65536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readForm(req) {
  return new URLSearchParams((await readBody(req)).toString('utf8'));
}

function requestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  return `${proto}://${req.headers.host}`;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === requestOrigin(req);
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function authRateLimited(req) {
  const key = createHash('sha256').update(clientIp(req)).digest('hex');
  const now = Date.now();
  const recent = (authAttempts.get(key) || []).filter((time) => now - time < 60000);
  recent.push(now);
  authAttempts.set(key, recent);
  return recent.length > 8;
}

function clerkFrontendApiFromPublishableKey(publishableKey) {
  const encoded = String(publishableKey || '').replace(/^pk_(?:test|live)_/, '');
  if (!encoded) throw new Error('CLERK_PUBLISHABLE_KEY is invalid.');
  const hostname = Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '');
  if (!/^[a-z0-9.-]+$/i.test(hostname) || !hostname.includes('.')) {
    throw new Error('CLERK_PUBLISHABLE_KEY does not contain a valid Frontend API hostname.');
  }
  return `https://${hostname}`;
}

function webRequest(req) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  return new Request(new URL(req.url, requestOrigin(req)), {
    method: req.method || 'GET',
    headers,
  });
}

function clerkEmail(clerkUser) {
  const addresses = Array.isArray(clerkUser?.emailAddresses) ? clerkUser.emailAddresses : [];
  const primary = addresses.find((address) => address.id === clerkUser.primaryEmailAddressId) || addresses[0];
  if (!primary?.emailAddress) throw new Error('Your Google account does not expose an email address.');
  if (primary.verification && primary.verification.status !== 'verified') {
    throw new Error('Verify your Google email address before signing in.');
  }
  return primary.emailAddress;
}

function clerkStateHeaders(headers) {
  const result = {};
  headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'set-cookie') result[name] = value;
  });
  const cookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean);
  if (cookies.length) result['Set-Cookie'] = cookies;
  return result;
}

function appHeaders(clerkFrontendApi = '') {
  const clerkScript = clerkFrontendApi ? ` ${new URL(clerkFrontendApi).origin}` : '';
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'self' data: https:; script-src 'self' 'unsafe-inline'${clerkScript} https://challenges.cloudflare.com https://*.protect.clerk.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; img-src 'self' data: https:; media-src 'self' data: https:; worker-src 'self' blob:; frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com; form-action 'self'; frame-ancestors 'none'`,
  };
}

async function proxyToWorker(req, res, worker) {
  const method = req.method || 'GET';
  const body = ['GET', 'HEAD'].includes(method) ? undefined : await readBody(req, 2 * 1024 * 1024);
  const headers = {};
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  const upstream = await fetch(`http://127.0.0.1:${worker.port}${req.url}`, {
    method,
    headers,
    body,
    redirect: 'follow',
  });
  const responseHeaders = {
    'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    'Cache-Control': upstream.headers.get('cache-control') || 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) responseHeaders['Content-Disposition'] = disposition;
  res.writeHead(upstream.status, responseHeaders);
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

export function createGateway(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const dataDir = options.dataDir || process.env.CLOUD_DATA_DIR || join(ROOT, '.cloud-data');
  const databasePath = options.databasePath || join(dataDir, 'accounts.sqlite');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const accounts = options.accountStore || new AccountStore({
    databasePath,
    encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY,
    production,
  });
  const workers = options.workerManager || new WorkerManager({ dataDir, accountStore: accounts });
  const secureCookies = production || process.env.COOKIE_SECURE === '1';
  const platformAi = Boolean(process.env.ANTHROPIC_API_KEY);
  const maxAccounts = Math.max(1, Number(process.env.MAX_ACCOUNTS || 25));
  const clerkPublishableKey = options.clerkPublishableKey ?? process.env.CLERK_PUBLISHABLE_KEY ?? '';
  const clerkSecretKey = options.clerkSecretKey ?? process.env.CLERK_SECRET_KEY ?? '';
  const clerkConfigured = Boolean(clerkPublishableKey || clerkSecretKey || options.clerkClient);
  if (clerkConfigured && (!clerkPublishableKey || (!clerkSecretKey && !options.clerkClient))) {
    throw new Error('Clerk requires both CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY.');
  }
  const clerk = clerkConfigured
    ? options.clerkClient || createClerkClient({ secretKey: clerkSecretKey, publishableKey: clerkPublishableKey })
    : null;
  const clerkFrontendApi = clerkConfigured
    ? options.clerkFrontendApi || process.env.CLERK_FRONTEND_API_URL || clerkFrontendApiFromPublishableKey(clerkPublishableKey)
    : '';
  const clerkAuthorizedParties = options.clerkAuthorizedParties || String(
    process.env.CLERK_AUTHORIZED_PARTIES || process.env.APP_ORIGIN || (production ? 'https://app.cleared.chat' : 'http://127.0.0.1'),
  ).split(',').map((value) => value.trim()).filter(Boolean);
  const clerkAuthDebug = options.clerkAuthDebug ?? process.env.CLERK_AUTH_DEBUG === '1';

  const authenticateClerk = async (req) => {
    const state = await clerk.authenticateRequest(webRequest(req), {
      authorizedParties: clerkAuthorizedParties,
    });
    if (!state.isAuthenticated) {
      if (clerkAuthDebug) {
        console.warn('[clerk-auth]', JSON.stringify({ status: state.status, reason: state.reason, message: state.message }));
      }
      return { state, auth: null, user: null };
    }

    const auth = state.toAuth();
    let user = accounts.userForClerkId(auth.userId);
    if (!user) {
      const remoteUser = await clerk.users.getUser(auth.userId);
      const email = clerkEmail(remoteUser);
      const existing = accounts.userForEmail(email);
      if (!existing && accounts.listUserIds().length >= maxAccounts) {
        const error = new Error('The hosted beta is currently full.');
        error.statusCode = 403;
        throw error;
      }
      user = accounts.findOrCreateClerkUser(auth.userId, email);
    }
    return { state, auth, user };
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, requestOrigin(req));

      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, JSON.stringify({ ok: true, auth: clerkConfigured ? 'clerk' : 'local' }), 'application/json; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/icon.svg' && existsSync(ICON)) {
        return send(res, 200, readFileSync(ICON), 'image/svg+xml', { 'Cache-Control': 'public, max-age=86400' });
      }

      const sessionToken = parseCookies(req.headers.cookie)[COOKIE] || '';
      const clerkIdentity = clerkConfigured ? await authenticateClerk(req) : null;
      if (clerkIdentity?.state.status === 'handshake') {
        const headers = clerkStateHeaders(clerkIdentity.state.headers);
        if (clerkAuthDebug) {
          const cookies = Array.isArray(headers['Set-Cookie']) ? headers['Set-Cookie'] : [];
          console.warn('[clerk-handshake]', JSON.stringify({
            callback: url.searchParams.has('__clerk_handshake'),
            locationHost: (() => {
              try { return new URL(headers.location, requestOrigin(req)).host; } catch { return ''; }
            })(),
            cookieCount: cookies.length,
            cookieNames: cookies.map((cookie) => cookie.slice(0, cookie.indexOf('='))).filter(Boolean),
          }));
        }
        res.writeHead(307, headers);
        return res.end();
      }
      const user = clerkConfigured ? clerkIdentity.user : accounts.userForSession(sessionToken);

      if (req.method === 'GET' && url.pathname === '/') {
        return user ? redirect(res, '/app') : redirect(res, '/login');
      }
      if (req.method === 'GET' && ['/login', '/signup'].includes(url.pathname)) {
        if (user) return redirect(res, '/app');
        const error = url.searchParams.get('error') || '';
        const page = clerkConfigured
          ? clerkAuthPage({ publishableKey: clerkPublishableKey, frontendApi: clerkFrontendApi, error })
          : authPage({ mode: url.pathname.slice(1), error });
        return send(res, 200, page, 'text/html; charset=utf-8', appHeaders(clerkFrontendApi));
      }
      if (req.method === 'POST' && ['/login', '/signup'].includes(url.pathname)) {
        if (clerkConfigured) return send(res, 405, 'Use Google to continue.', 'text/plain; charset=utf-8', { Allow: 'GET' });
        if (!sameOrigin(req)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
        if (authRateLimited(req)) return send(res, 429, authPage({ mode: url.pathname.slice(1), error: 'Too many attempts. Wait one minute.' }), 'text/html; charset=utf-8', appHeaders());
        const form = await readForm(req);
        let nextUser = null;
        try {
          if (url.pathname === '/signup') {
            if (accounts.listUserIds().length >= maxAccounts) throw new Error('The hosted beta is currently full.');
            nextUser = await accounts.createUser(form.get('email'), form.get('password'));
          } else {
            nextUser = await accounts.authenticate(form.get('email'), form.get('password'));
            if (!nextUser) throw new Error('Email or password is incorrect.');
          }
        } catch (error) {
          return send(res, 400, authPage({ mode: url.pathname.slice(1), error: error.message }), 'text/html; charset=utf-8', appHeaders());
        }
        const session = accounts.createSession(nextUser.id);
        return redirect(res, '/app', { 'Set-Cookie': cookieHeader(session.token, session.maxAge, secureCookies) });
      }
      if (req.method === 'POST' && url.pathname === '/logout') {
        if (!sameOrigin(req)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
        if (clerkConfigured) {
          if (clerkIdentity.auth?.sessionId) await clerk.sessions.revokeSession(clerkIdentity.auth.sessionId);
          return redirect(res, '/login', { 'Set-Cookie': clearCookie(secureCookies) });
        }
        accounts.deleteSession(sessionToken);
        return redirect(res, '/login', { 'Set-Cookie': clearCookie(secureCookies) });
      }

      if (!user) {
        if (url.pathname.startsWith('/api/')) return send(res, 401, JSON.stringify({ error: 'authentication required' }), 'application/json; charset=utf-8');
        return redirect(res, `/login?error=${encodeURIComponent('Sign in to open your inbox.')}`);
      }

      if (req.method === 'GET' && url.pathname === '/account') {
        return send(res, 200, accountPage({
          user,
          hasUserKey: accounts.hasSecret(user.id, 'anthropic_api_key'),
          hasPlatformKey: platformAi,
          message: url.searchParams.get('message') || '',
          error: url.searchParams.get('error') || '',
        }), 'text/html; charset=utf-8', appHeaders(clerkFrontendApi));
      }
      if (req.method === 'POST' && url.pathname === '/account/ai-key') {
        if (!sameOrigin(req)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
        const key = (await readForm(req)).get('apiKey') || '';
        if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return redirect(res, '/account?error=Enter+a+valid+Anthropic+API+key.');
        accounts.setSecret(user.id, 'anthropic_api_key', key);
        await workers.restart(user.id);
        return redirect(res, '/account?message=AI+key+saved+and+worker+restarted.');
      }
      if (req.method === 'POST' && url.pathname === '/account/ai-key/delete') {
        if (!sameOrigin(req)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
        accounts.deleteSecret(user.id, 'anthropic_api_key');
        await workers.restart(user.id);
        return redirect(res, '/account?message=Saved+AI+key+removed.');
      }
      if (req.method === 'GET' && url.pathname === '/api/account') {
        return send(res, 200, JSON.stringify({ email: user.email, aiReady: platformAi || accounts.hasSecret(user.id, 'anthropic_api_key') }), 'application/json; charset=utf-8');
      }
      if (req.method === 'GET' && ['/app', '/app/'].includes(url.pathname)) {
        return send(res, 200, readFileSync(WEB_APP, 'utf8'), 'text/html; charset=utf-8', appHeaders(clerkFrontendApi));
      }
      if (url.pathname.startsWith('/api/')) {
        const worker = await workers.get(user.id);
        return proxyToWorker(req, res, worker);
      }
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    } catch (error) {
      console.error('[gateway]', error);
      if (!res.headersSent) send(res, error.statusCode || 500, JSON.stringify({ error: error.statusCode ? error.message : 'Internal server error.' }), 'application/json; charset=utf-8');
      else res.end();
    }
  });

  const close = () => {
    workers.stopAll();
    accounts.close();
  };
  server.on('close', close);
  const restore = async () => {
    accounts.pruneSessions();
    for (const userId of accounts.listUserIds().slice(0, maxAccounts)) {
      workers.get(userId).catch((error) => console.error(`[worker:${userId.slice(0, 8)}] restore failed`, error.message));
    }
  };
  return { server, accounts, workers, restore, dataDir };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  const gateway = createGateway();
  gateway.server.listen(port, '0.0.0.0', () => {
    console.log(`cleared.chat cloud -> http://0.0.0.0:${port}`);
    void gateway.restore();
  });
  const shutdown = () => gateway.server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
