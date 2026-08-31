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

The hosted app at `https://app.cleared.chat` is deployed from commit `bba5c2e`.
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
still has an open promise because unread and reply-owed are different sets. Its
action queue has two hard lanes: actionable unread chats first, then other read
conversations where Adam still owes a reply or promised work. Importance x
urgency and age rank conversations only within their lane.

Actionable triage rows expose a `Solved` control. It writes only private
cleared.chat state in `solved-chats.json`; it never archives, marks read, sends,
or otherwise mutates WhatsApp. A solved conversation stays out of triage while
its latest-message version is unchanged and returns automatically when a newer
message arrives.

Unread rows and the open conversation header expose a `Cleared` control backed
by the same versioned private state. It removes the current conversation version
from Unread and Priorities, decrements the visible queue, and advances to the
next unread chat. The conversation remains under All and returns to the work
queues after a newer message. It never changes WhatsApp read state.

Reply drafts use one editable review modal. For a synced WhatsApp conversation,
Adam's direct click on `Send reply` sends the exact recipient and text shown in
that modal. The endpoint rejects unconfirmed, invalid, or unknown recipients and
deduplicates repeated request IDs. Pressing Enter in the composer opens this
review modal; Shift+Enter inserts a line break. Non-WhatsApp drafts remain
copy-only.

Received WhatsApp messages expose a compact emoji picker. Selecting an emoji
opens a separate review modal that names the conversation and shows the exact
reaction. Only Adam's direct click on `Add reaction` may invoke `/api/wa/react`.
Agents, triage, drafting, background jobs, and automated tests never invoke that
endpoint or its confirmation control.

When a conversation has unread messages, the chat pane collapses older read
history behind `Show earlier messages`, places an unread divider at WhatsApp's
count-derived boundary, and starts at the first unread message instead of the
bottom. After `Triage inbox`, the same pane shows the AI context summary, next
action, every task-first prerequisite or clarifying question, and loads the
editable unsent draft into the composer. Triage covers actionable unread chats
plus other reply-owed WhatsApp conversations and reads up to 30 recent messages
per chat; interactive drafting reads up to 40. Drafting studies Adam's sent
messages in that conversation and matches the relationship-specific casing,
length, directness, warmth, and vocabulary.

After triage, the app enters Focus mode by default. Focus mode hides the inbox
and presents one ranked actionable conversation at a time with a `Priority X of
Y` counter, ordered prerequisite tasks, context summary, and editable suggested
reply. Previous and Next move within the ranked queue without changing WhatsApp.
`Cleared` stores only the private conversation version and advances to the next
priority. `Show inbox` returns to the complete ranked list. The preference is
restored with the latest saved triage after reload.

A visible AI-output banner distinguishes a current model-backed triage from an
old offline snapshot. It reports the number of unsent drafts and task chats,
links directly into Focus, and offers `Run fresh triage` when a restored run has
tasks but no AI drafts. Pressing that action hides the old banner immediately
and replaces it with a global progress band that remains visible in Inbox and
Focus. The band names each stage, explains what is happening, reports completed
conversation counts, elapsed time, and percentage, and keeps failures visible.

The primary top bar contains only Settings, Focus when a queue exists, and
`Triage inbox`. Manual data controls, account management, density, theme, and
text sizing live in Settings. A conversation header shows only `Cleared`,
`Draft a reply`, and one overflow menu for naming, transcript export, full
export, and thread questions. Keep secondary controls out of the primary daily
flow.

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

Every rendered message bubble shows an exact local hour and minute. Messages
from yesterday include `Yesterday`; older messages include their date. The full
local date and time remains available in the timestamp tooltip.

Received and sent WhatsApp images are cached under the account's private
WhatsApp data directory and served only through the authenticated app API.
Conversation bubbles show the responsive image, preserve an optional caption,
and open the cached image at full size when Adam clicks it. The browser receives
media through authenticated fetches and short-lived object URLs, never a public
WhatsApp CDN URL. A small message thumbnail is used only when the full image is
no longer available from WhatsApp.

Focus mode is the daily inbox-clearing surface. It includes every active unread
chat plus older conversations that still look actionable. Each conversation has
a private, versioned plan with Adam's explanation for why it is still open, an
explicit outcome (`reply`, `task`, `waiting`, or `no-reply`), and an optional
task that must happen first. The saved explanation is model context for later
ranking and drafting. A newer message makes the action choice stale and requires
review. Saving a plan never sends, marks read, archives, reacts, or clears the
conversation; Adam still presses Cleared or confirms a reviewed reply himself.

The production image includes the Faster Whisper `tiny` model under
`/opt/cleared-whisper`, so first-use model downloads cannot interrupt voice-note
jobs. Expired WhatsApp media gets an explicit reupload retry. A failed voice
note exposes `Retry transcript`, which requests that exact message from the
linked phone and transcribes the recovered audio locally. Never inspect or log
private audio or transcript text while testing this path.

Voice-note recovery returns immediately and continues in the background. The
retry control polls a metadata-only status endpoint and shows a four-step
diagnostic timeline: WhatsApp connection and media request, audio download,
Whisper preparation, then transcription. It includes elapsed time, source state,
file size, worker heartbeat, percentage, live ETA, and the exact fail-fast
countdown. WhatsApp media recovery retries once after 30 seconds and fails with
specific advice after 90 seconds. A Whisper worker that stops reporting progress
also fails after 90 seconds. The failure reason stays visible inside the retry
control. The status endpoint never returns audio or transcript text.

When WhatsApp cannot return expired media, the failed note offers two paths:
`Retry from WhatsApp` and `Upload audio file`. Direct upload accepts OGG, Opus,
M4A, MP3, WAV, and other audio MIME types up to WhatsApp's 16 MB media limit. It
routes the file into that account's private transcription worker and replaces
the unavailable transcript on the original message. The hosted gateway raises
its request-body limit only for this upload route. Agents and tests must never
select, inspect, or upload a user's private media.

The cloud gateway also contains a credential-gated WhatsApp Business Platform
transcript bot at `/api/meta/whatsapp/webhook`. This is a separate Cleared
business identity, not Adam's personal WhatsApp connection. It validates Meta
signatures, accepts inbound audio, acknowledges the user, downloads the media,
transcribes it locally, and replies from the service number with transcript
chunks. It is disabled until all `META_WA_*` credentials are installed. Tests
must use injected fake HTTP and transcription functions and never contact a real
recipient. Setup is documented in `docs/whatsapp-transcript-bot.md`.

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
action manually. In cleared.chat, Adam's own authenticated click on the final
review modal is that manual action. Agents, triage, drafting, background jobs,
and automated tests must never invoke `/api/wa/send`, `/api/wa/react`, or either
modal's final confirmation control.

## How it works

1. The server restores the saved direct WhatsApp session during startup.
2. Live Baileys events update the private local chat store automatically.
3. Every open loop is scored by importance x urgency and classified as reply,
   task-first, later, or no reply owed.
4. Unclear intent or facts produce one clarifying question before any draft.
5. Drafts are editable, contain no em dashes or emojis, and a synced WhatsApp
   reply sends only after Adam presses the one final confirmation control.
6. Message reactions use common emojis and require their own final confirmation.

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
