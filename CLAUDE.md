# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

cleared.chat is a local-first messaging client with Electron, local browser,
and hosted browser modes. It connects directly to WhatsApp through Baileys,
restores a saved linked-device session on startup, ranks open loops by
importance x urgency, transcribes received voice notes, and prepares editable
drafts.

The runtime is `web/server.mjs`, the direct WhatsApp adapter is
`web/whatsapp.mjs`, the interface is `web/public/index.html`, and the desktop
shell is `desktop/main.js`. Gmail and Discord are optional adapters. The Beeper
Desktop adapter is legacy, disabled by default, and not required.

Hosted accounts enter through `cloud/gateway.mjs`. When Clerk keys are set, the
gateway verifies Google sessions and links a verified Google email to the
existing internal account ID. Local development keeps the password fallback
when Clerk is not configured. Each account is routed to an isolated
`web/server.mjs` worker with separate WhatsApp credentials, messages, snapshots,
and encrypted AI settings. `Dockerfile.cloud` is the persistent container
runtime. The volume must be mounted at `/data`.

The hosted app at `https://app.cleared.chat` is deployed from commit `51d32ba`.
It loads Clerk in the inbox shell so browser API requests carry a fresh bearer
token after short-lived cookies rotate. An account with no hosted WhatsApp
credentials opens Inbox Settings automatically. Google sign-in does not copy a
local WhatsApp link to the server, so every hosted account must scan its hosted
QR once before chats can appear.

Hosted authentication uses a custom Clerk OAuth flow with Google as the only
visible sign-in option. Do not restore Clerk's prebuilt sign-in widget, email or
password fields, or a separate sign-up link.

The hosted WhatsApp status check continues every 10 seconds after history is
complete. If the active chat count changes, the browser reloads the complete
inbox automatically. Do not stop polling immediately at `historyStatus:
complete`; WhatsApp can deliver its final chat batch after that state first
appears.

The app opens to a WhatsApp-style `Unread` queue. `Sync unread` rebuilds the
queue from a fresh, read-only WhatsApp app-state snapshot, then live Baileys
updates keep it current. A production refresh on 2026-08-28 returned 31 active
unread chats. The header's primary ranking action is `Triage inbox`. There is
no voice-triage button in the header. Triage still checks every active,
unarchived WhatsApp conversation where the other person spoke last or Adam
still has an open promise because unread and reply-owed are different sets.

Actionable triage rows expose a `Solved` control. It writes only private
cleared.chat state in `solved-chats.json`; it never archives, marks read, sends,
or otherwise mutates WhatsApp. A solved conversation stays out of triage while
its latest-message version is unchanged and returns automatically when a newer
message arrives.

WhatsApp protocol, key-distribution, history-sync, and app-state events are
control traffic. `web/whatsapp.mjs` drops them at ingestion and removes old
placeholders while loading the local store. Never expose them as chat messages
or feed them into triage.

WhatsApp supplies usable names for most contacts, but some direct chats arrive
as numbers only because companion sync does not include the phone address book.
The UI offers `Name contact` for those chats. Aliases are private per-account
state in `contact-aliases.json` and must remain outside git and image builds.

Unread chat rows follow WhatsApp's visual hierarchy: bold contact and preview,
primary-color time, then a circular message-count badge. Received WhatsApp
voice notes are transcribed locally as they arrive. A conversation with stored
voice notes exposes `Voice transcripts .md`, which downloads a received-only
Markdown file with timestamps, durations, statuses, and transcript text. Sent
voice notes and unrelated message text are excluded from that export.

Baileys history snapshots use absolute unread counts, while live
`chats.update` events use `-1` for mark unread, `0` for read, and positive
deltas for newly received messages. Keep those merge paths separate. On-demand
app-state replay must use non-initial mode so read-state mutations are not held
behind Baileys' temporary history-range guards. An empty replay rolls back to
the previous local unread set.

## The one rule

Agents must **never** send, reply, react, archive, mark read, post, email, DM, or
otherwise communicate externally as Adam. This remains true even when Adam says
`send`, says `yes`, or approves exact wording. Agents may read context, draft,
revise, and present copy-ready text. Adam performs the final communication
action manually.

## How it works

1. The server restores the saved direct WhatsApp session during startup.
2. Live Baileys events update the private local chat store automatically.
3. Every open loop is scored by importance x urgency and classified as reply,
   task-first, later, or no reply owed.
4. Unclear intent or facts produce one clarifying question before any draft.
5. Drafts are editable, contain no em dashes or emojis, and are copied only
   after explicit UI confirmation.

## Private state

- WhatsApp credentials and messages live under the local app-data directory.
- `kb/*`, except templates, `me.md`, `tasks.md`, snapshots, exports, `.env`, and
  WhatsApp auth stores are private and gitignored.
- Never deploy private runtime state. Vercel receives only `index.html`,
  `icon.svg`, `robots.txt`, and `sitemap.xml` via `.vercelignore`.
- Hosted deployments start with an empty persistent volume. Never copy local
  WhatsApp credentials, messages, snapshots, or account data into an image.

## Development

```powershell
cd web
npm install
npm test
npm run dev
```

The local app runs at `http://127.0.0.1:4317`. A valid saved WhatsApp link
reconnects automatically. A revoked link returns `401` and must be paired once
again from Settings.

## Related

Sibling product `../sprite.email` applies the same importance and urgency model
to Gmail. Its historical bridge document remains at
`../sprite.email/SIBLING_BEEPER_CHAT.md`.
