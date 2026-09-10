# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

September 10: AI connection recovery is restored in Settings and hosted Account.
Missing AI opens the appropriate setup surface, not a dead-end alert. Keep
provider controls out of the chat toolbar. Hosted workers cannot use local CLI
subscriptions. This supersedes the September 8 setup-hiding instruction below.

September 9 design revision: Light is the default, including old System
preferences. Explicit Dark is retained. The app uses white/near-black neutral
tokens, a bordered two-column grid and no accent picker. Keep real contact
photos in color. See the latest revision in docs/design-system.md.

Writing style lives in each worker's private snapshot directory as
`writing-style.json`, with editable preferences and a Markdown view/export at
Settings > Writing style. Learning is off until the user opts in and explicitly
updates from history. Only provenance-verified sent text is eligible; quoted,
forwarded, generated/assistant and legacy unverified records are excluded.
Inference persists aggregates, never source text. At least 12 eligible messages
are needed for inferred habits; explicit preferences always override them.
Reset deletes inferred data and disables learning, retaining user preferences.
Local Adam defaults do not apply to hosted accounts. Draft and triage prompts
consume these profiles with factual-preservation and untrusted-history rules.

September 8 UI revision: AI model/provider setup is temporarily commented out
in the inbox and feature-disabled on the hosted Account page. Existing provider
integration and credentials remain intact. Do not restore setup controls without
Adam's request. The app now uses neutral surfaces, no chat wallpaper, and an
initials fallback that stays visible until a photo successfully loads.

cleared.chat is a local-first messaging client with Electron, local browser,
and hosted browser modes. It connects directly to WhatsApp through Baileys,
restores a saved linked-device session on startup, ranks open loops by
importance x urgency, transcribes received voice notes, and prepares editable
drafts.

The runtime is `web/server.mjs`, the direct WhatsApp adapter is
`web/whatsapp.mjs`, the interface is `web/public/index.html`, and the desktop
shell is `desktop/main.js`. Gmail and Discord are optional adapters.

Hosted accounts enter through `cloud/gateway.mjs`. When Clerk keys are set, the
gateway verifies Google sessions and links a verified Google email to the
existing internal account ID. Local development keeps the password fallback
when Clerk is not configured. Each account is routed to an isolated
`web/server.mjs` worker with separate WhatsApp credentials, messages, snapshots,
and encrypted AI settings. `Dockerfile.cloud` is the persistent container
runtime. The volume must be mounted at `/data`.

The hosted app at `https://app.cleared.chat` is deployed from `main` as the
`cleared-chat` Docker container on the Hostinger VPS behind Caddy. The live
container mounts `/var/lib/cleared-chat` at `/data` and binds only to
`127.0.0.1:4323`. Build the replacement image while the current container is
live, preserve the previous container as a rollback target, and never run two
containers against the same `/data` volume. Deployment receipts are recorded
in `EVIDENCE.md` instead of duplicating a commit hash here.
The bare origin is the canonical inbox URL. Authenticated requests to `/` serve
the app, signed-out requests go to `/login`, and legacy `/app` links redirect
to `/`.
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

Every synced WhatsApp message exposes a quiet `Forward message` action. It opens
one review modal with the exact source preview, searchable synced contacts and
groups, and at most five selected destination chats. Only Adam's direct click on
the final `Forward` control may invoke `/api/wa/forward`. The adapter retains a
bounded private in-memory copy of recent WhatsApp message objects so Baileys can
preserve native forwarding metadata. Stored text can fall back safely after a
restart; unavailable media asks Adam to keep WhatsApp connected and retry.

When a conversation has unread messages, the chat pane collapses older read
history behind `Show earlier messages`, places an unread divider at WhatsApp's
count-derived boundary, and opens at the first unread message. After `Triage`,
one quiet line above the composer shows the next action, prerequisites, or
clarifying question, and loads the
editable unsent draft into the composer. Triage covers actionable unread chats
plus other reply-owed WhatsApp conversations and reads up to 30 recent messages
per chat; interactive drafting reads up to 40. Drafting studies Adam's sent
messages in that conversation and matches the relationship-specific casing,
length, directness, warmth, and vocabulary.

The active surface follows `SIMPLICITY-BLUEPRINT.md`: one Chats sidebar and one
conversation, with no navigation rail, Focus mode, or companion assistant pane.
Triage switches the same sidebar to its Priority filter without hiding it.
`Cleared` stores only the private conversation version, updates the remaining
count, and opens the next chat. On mobile, Back returns to the same list.

Triage progress stays inside the sidebar, includes stage, elapsed time and
percentage, and disappears after success. Actual failures stay visible.
There is no persistent stale-triage or missing-draft warning. A snapshot for an
older conversation version cannot seed a new draft. Missing AI configuration
is handled by the composer action and Settings, not a banner over the chat.

`Triage` lives in the Chats header.
Manual data controls, account management, density, theme, and text sizing live
in Settings. A conversation header shows only `Cleared` and one overflow menu
for naming, transcript export, full export, and thread questions. The composer
owns AI drafting and review. Keep secondary controls out of the primary daily
flow.

The interface follows the Clearspace system in `docs/design-system.md` and the
active parity contract in `FEATURE-PARITY.md`: neutral messaging surfaces,
green reserved for progress and confirmed actions, dense contact-first rows,
one visible navigation layer, and a responsive split view that becomes
one surface on narrow screens. The layout may use learned WhatsApp interaction
patterns, but never WhatsApp trademarks or proprietary assets. Do not restore
the old purple or cyan-tinted product palettes.

Daily rows expose only recognition-critical information. Unread shows contact,
preview, time, and count. Priority shows contact, next action, and rank. The
conversation contains messages, not planning cards. Do not restore per-row completion buttons,
scores, source labels, duplicate draft actions, or successful-run banners.

WhatsApp protocol, key-distribution, history-sync, and app-state events are
control traffic. `web/whatsapp.mjs` drops them at ingestion and removes old
placeholders while loading the local store. Never expose them as chat messages
or feed them into triage.

WhatsApp supplies usable names for most contacts, but some direct chats arrive
as numbers only because companion sync does not include the phone address book.
The UI offers `Name contact` for those chats. Aliases are private per-account
state in `contact-aliases.json` and must remain outside git and image builds.

WhatsApp profile photos use the authenticated `/api/wa/avatar` path. The hosted
gateway resolves its WhatsApp CDN redirect before streaming the image. Visible
avatars retry while the saved session finishes connecting, and recent unread
chats are hydrated in the background after the socket opens. Missing and
expired lookups are retried after six hours. Initials remain the fallback when
WhatsApp privacy settings expose no photo.

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

Private versioned plans remain available as model context, but their editors
are not part of the daily chat surface. Task prerequisites appear in the one
next-action line above the reply composer.

Edited drafts survive switching chats and rerunning triage within the page.
Late AI responses belong to the requesting chat and cannot replace newer human
edits. Clarifying questions use the same composer in a visibly separate
`Use answer` mode. Enter in that mode supplies private model context, never a
reply review. Normal reply mode still opens the one human-only review modal.
Successive answers remain in the chat's in-memory drafting context. This state
is not written to shared browser storage and does not survive closing the page.
Hosted AI drafting requires either the platform AI key or the encrypted
Anthropic key saved under Account; offline ranking must say clearly that drafts
are unavailable instead of returning a fake draft. Thread questions, composer
questions, and cross-chat asks without a connected model return an explicit
error, never a notice dressed as an answer. The hosted notice points at
Account; the local notice points at Settings > Bring your own subscription.

The local browser and desktop app expose `claude_local` and `codex_local` under
Settings > Bring your own subscription. They use the logged-in Claude Code or
Codex CLI account, strip API-key environment variables, disable tools, run from
the OS temporary directory, and do not persist model sessions. The provider
choice is private local state under the snapshot directory and takes effect
without a restart. Hosted workers set `CLEARED_HOSTED=1` and must reject local
subscription selection because they cannot access authentication on the user's
computer.

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
and automated tests must never invoke `/api/wa/send`, `/api/wa/react`,
`/api/wa/forward`, or any final confirmation control.

## How it works

1. The server restores the saved direct WhatsApp session during startup.
2. Live Baileys events update the private local chat store automatically.
3. Every open loop is scored by importance x urgency and classified as reply,
   task-first, later, or no reply owed.
4. Unclear intent or facts produce one clarifying question before any draft.
5. Drafts are editable, contain no em dashes or emojis, and a synced WhatsApp
   reply sends only after Adam presses the one final confirmation control.
6. Message reactions use common emojis and require their own final confirmation.
7. Message forwarding supports up to five synced chats and requires its own
   final confirmation.

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
`../sprite.email/SIBLING_CLEARED_CHAT.md`.
