// Pulls unread Gmail threads for the command-center merge, reading linked
// accounts straight out of sprite.email's own Postgres (same DB it already
// uses for thread_fates). Read-only against Gmail: lists + gets threads,
// never modifies.
//
// Two auth modes:
//   FULL  - AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET set. Uses the OAuth2 client,
//           which auto-refreshes and writes the new token back to the DB.
//           Durable: keeps working indefinitely.
//   TOKEN - neither set. Falls back to the stored access_token as a raw
//           bearer. Works only until that token expires (~1h), and sprite.email
//           itself is what refreshes it. Enough to read today, not durable.

import { neon } from '@neondatabase/serverless';
import { gmail as gmailClient } from '@googleapis/gmail';
import { OAuth2Client } from 'google-auth-library';

// Read env lazily, NOT at module top: server.mjs loads web/.env in its own
// body, but ES imports are evaluated before that runs, so top-level consts
// here would capture undefined every time.
const DATABASE_URL = () => process.env.SPRITE_DATABASE_URL;
const GOOGLE_ID = () => process.env.AUTH_GOOGLE_ID;
const GOOGLE_SECRET = () => process.env.AUTH_GOOGLE_SECRET;
const PER_ACCOUNT = () => Number(process.env.GMAIL_PER_ACCOUNT || 20);

const canRefresh = () => Boolean(GOOGLE_ID() && GOOGLE_SECRET());

export function gmailConfigured() {
  return Boolean(DATABASE_URL());
}

export function gmailAuthMode() {
  if (!DATABASE_URL()) return 'off';
  return canRefresh() ? 'full' : 'token';
}

// TOKEN mode: raw REST calls with the stored bearer. Mirrors the shape the
// googleapis client returns so the caller does not care which mode ran.
function rawGmail(accessToken) {
  const call = async (path, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      // A raw Google 401 blob tells you nothing actionable. In TOKEN mode an
      // expired access_token is the normal, expected failure, so name it.
      if (r.status === 401) throw new Error("access token expired (sprite.email refreshes these hourly; set AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET to refresh automatically)");
      throw new Error(`gmail ${path} -> ${r.status} ${(await r.text()).slice(0, 120)}`);
    }
    return { data: await r.json() };
  };
  return {
    users: {
      labels: { get: ({ id }) => call(`labels/${id}`) },
      threads: {
        list: ({ q, maxResults, pageToken }) =>
          call('threads', pageToken ? { q, maxResults, pageToken } : { q, maxResults }),
        get: ({ id, format, metadataHeaders }) => {
          const p = new URLSearchParams({ format });
          for (const h of metadataHeaders || []) p.append('metadataHeaders', h);
          return fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${id}?${p}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          }).then(async (r) => {
            if (!r.ok) throw new Error(`gmail thread ${id} -> ${r.status}`);
            return { data: await r.json() };
          });
        },
      },
    },
  };
}

function decodeHeaderVal(headers, name) {
  const h = (headers || []).find((x) => (x.name || '').toLowerCase() === name);
  return h ? h.value : '';
}

async function fetchAccountUnread(sql, account, opts = {}) {
  if (!canRefresh()) {
    if (!account.access_token) throw new Error('no access_token stored and no Google client creds to refresh with');
    return fetchWithGmail(rawGmail(account.access_token), account, opts);
  }
  const client = new OAuth2Client(GOOGLE_ID(), GOOGLE_SECRET());
  client.setCredentials({
    refresh_token: account.refresh_token,
    access_token: account.access_token || undefined,
    expiry_date: account.expires_at ? new Date(account.expires_at).getTime() : undefined,
  });
  client.on('tokens', async (tokens) => {
    try {
      await sql`
        UPDATE gmail_accounts
        SET access_token = COALESCE(${tokens.access_token ?? null}, access_token),
            expires_at = COALESCE(${tokens.expiry_date ? new Date(tokens.expiry_date) : null}, expires_at),
            refresh_token = COALESCE(${tokens.refresh_token ?? null}, refresh_token)
        WHERE id = ${account.id}
      `;
    } catch { /* non-fatal */ }
  });
  return fetchWithGmail(gmailClient({ version: 'v1', auth: client }), account, opts);
}

// Shared by both auth modes - `gmail` is either the googleapis client or the
// raw-bearer shim above; both expose the same three calls we use.
async function fetchWithGmail(gmail, account, { all = false, query = 'is:unread in:inbox', archived = false, cap: capOverride } = {}) {
  const cap = capOverride || (all ? Number(process.env.GMAIL_MAX || 2000) : PER_ACCOUNT());
  const labelInfo = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' }).catch(() => null);
  const totalUnread = labelInfo?.data?.threadsUnread ?? null;

  // Walk pageTokens until the account is exhausted (or we hit the cap).
  // Gmail returns at most 100 thread ids per page.
  const ids = [];
  let pageToken;
  do {
    const list = await gmail.users.threads.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(100, cap - ids.length),
      pageToken,
    });
    for (const t of list.data.threads || []) if (t.id) ids.push(t.id);
    pageToken = all ? list.data.nextPageToken : undefined;
  } while (pageToken && ids.length < cap);

  if (ids.length === 0) return { email: account.email, totalUnread, items: [] };

  // Bounded concurrency: 800+ parallel thread GETs would trip Gmail's rate limit.
  const threads = [];
  const CONC = 15;
  for (let i = 0; i < ids.length; i += CONC) {
    const batch = await Promise.all(
      ids.slice(i, i + CONC).map((id) =>
        gmail.users.threads
          .get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] })
          .then((r) => r.data)
          .catch(() => null),
      ),
    );
    threads.push(...batch);
  }

  const items = [];
  for (const t of threads) {
    const msgs = t?.messages || [];
    if (!t?.id || !msgs.length) continue;
    const last = msgs[msgs.length - 1];
    const h = last.payload?.headers || [];
    const from = decodeHeaderVal(h, 'from');
    const subject = decodeHeaderVal(h, 'subject') || '(no subject)';
    const ms = last.internalDate ? parseInt(last.internalDate, 10) : NaN;
    const lastActivity = Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
    const nameMatch = from.match(/^"?([^"<]+)"?\s*<?/);
    const who = (nameMatch ? nameMatch[1].trim() : from) || from;
    // Shaped to match cleared.chat's own chat objects (see fetchConversations
    // in server.mjs) so it drops straight into the same forModel()/rankPrompt
    // pipeline - one merged ranking pass across chats AND email.
    items.push({
      id: `gmail:${account.id}:${t.id}`,
      isArchived: archived,
      title: subject,
      network: `Gmail (${account.email})`,
      type: 'single',
      isMuted: false,
      unread: true,
      messages: [
        {
          isSender: false,
          senderName: who,
          timestamp: lastActivity,
          text: `${subject}\n${last.snippet || ''}`,
        },
      ],
      source: 'gmail',
      threadId: t.id,
      accountEmail: account.email,
    });
  }
  return { email: account.email, totalUnread, items };
}

// Returns { items, accounts, errors } - items are chat-shaped so they can
// merge straight into cleared.chat's existing ranking pipeline.
// Archived mail: everything filed away, which is the bulk of an account.
// Capped separately from the inbox because it can run to thousands.
export async function fetchGmailArchive(opts = {}) {
  return fetchGmailInbox({
    ...opts,
    query: '-in:inbox -in:spam -in:trash',
    archived: true,
    all: true,
    cap: Number(process.env.GMAIL_ARCHIVE_MAX || 400),
  });
}

export async function fetchGmailInbox(opts = {}) {
  if (!gmailConfigured()) {
    return { items: [], accounts: [], errors: [{ error: 'Gmail not configured (missing SPRITE_DATABASE_URL)' }] };
  }
  const sql = neon(DATABASE_URL());
  const rows = await sql`
    SELECT id, user_id, email, refresh_token, access_token, expires_at::text AS expires_at
    FROM gmail_accounts
    WHERE COALESCE(muted, FALSE) = FALSE
  `;
  const results = await Promise.allSettled(rows.map((a) => fetchAccountUnread(sql, a, opts)));
  const items = [];
  const accounts = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      items.push(...r.value.items);
      accounts.push({ email: r.value.email, totalUnread: r.value.totalUnread, sampled: r.value.items.length });
    } else {
      errors.push({ email: rows[i]?.email, error: String(r.reason?.message || r.reason) });
    }
  });
  return { items, accounts, errors };
}
