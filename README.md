# cleared.chat

A standalone, voice-driven inbox that ranks every open messaging loop and helps
you close them one person at a time.

## Daily loop

1. Open cleared.chat. The complete inbox loads automatically.
2. Select **Start voice triage**.
3. Hear how many replies remain and why the next person matters.
4. Speak the facts, intent, task, or tone for that conversation.
5. Review and copy the editable draft, then send it manually in WhatsApp.
6. Move to the next person and hear the remaining count fall.

Each conversation becomes one of four outcomes: a reply, work to do first, later,
or no reply owed. Tasks are saved locally. Voice never sends a message.

## Connections

WhatsApp connects directly through Baileys and does not require another desktop
bridge.
Pair once from **Settings > Show QR**, then scan it from **WhatsApp > Linked
Devices > Link a Device** on a phone where WhatsApp is already open. A working
SIM is not required for the scan. Phone-number pairing remains available as a
fallback. Credentials and the local message store live in the app's user-data
directory, not the install folder, so they survive upgrades.

Email is disabled by default so it cannot enter the messaging sweep. Gmail can
be restored later with `EMAIL_ENABLED=1`. Discord remains an optional direct
adapter. A legacy local-API adapter is disabled unless `BEEPER_ENABLED=1` is
set explicitly.

The WhatsApp inbox is uncapped, excludes WhatsApp Archive, tracks archive and
unarchive updates, and merges phone-number and LID identities into one thread.
Received voice notes are transcribed locally with Faster Whisper and their text
is included when cleared.chat creates the next action and draft.
Triage first removes conversations where no reply is owed, then ranks every
remaining loop in validated chunks. Task-first conversations receive a concrete
prerequisite and an editable holding draft. Every reply-owed conversation has a
visible next action.

## Hosted accounts

The hosted beta uses Clerk for Google sign-in. After continuing with Google,
each account gets an isolated WhatsApp worker, credential directory, message
cache, triage history, and encrypted AI settings. Pair from the inbox Settings
panel once, then the server keeps that linked-device session connected and
syncing even when the browser is closed. Existing password accounts link to a
verified Google account with the same email, preserving the paired workspace.

The public landing page stays on Vercel. The private app runs as a persistent
container behind `app.cleared.chat`, because WhatsApp linking needs a durable
process and durable storage. See [`cloud/README.md`](cloud/README.md) for the
deployment boundary and required volume.

The hosted assistant can use a platform Anthropic key or a key saved by the
account owner. User keys are encrypted before storage and never enter the
browser again. Local Claude and ChatGPT subscriptions cannot run in the hosted
container. Without an AI key, deterministic offline triage remains available.

## Bring your own subscription

The local browser and desktop app can use either installed subscription CLI:

- `claude_local` uses the account shown by `claude auth status`.
- `codex_local` uses the ChatGPT account shown by `codex login status`.

Open **Settings > Bring your own subscription** to select either provider. The
choice is saved in private local app state and takes effect immediately. Cleared
deletes API-key environment variables before each invocation, disables tools,
runs from the OS temporary directory, and does not persist model sessions.
Prompts still leave the machine for the selected model provider, so review that
provider's privacy terms before enabling it.

## Parity boundary

The daily workflow now covers direct pairing, active conversation sync, received
voice-note transcription, search, thread reading, turn detection, priority
ranking, task planning, drafts, voice review, and local progress. Media
composition, reactions, calls, presence, and additional messaging networks are
not yet at parity and are not labeled complete.

Baileys is an unofficial WhatsApp Web client. It reduces the extra bridge layer,
but it does not remove WhatsApp's account-policy risk. Do not use cleared.chat for
bulk or unsolicited messaging.

## Voice

The Windows desktop app uses local Windows speech recognition for dictation and
local system voices for spoken progress, so voice adds no API bill. Ranking and
drafting use the selected logged-in Claude Code or Codex CLI subscription.

ChatGPT subscriptions and OpenAI API billing are separate, and ChatGPT Voice
does not currently call custom apps. OpenAI Realtime can be added later as an
optional higher-quality voice transport without changing the inbox workflow.

## Voice-note setup

Voice-note transcription is local and does not use an API key. Install Python
and Faster Whisper once:

```powershell
python -m pip install faster-whisper
```

The default `small` model downloads on the first transcription. Set
`WHISPER_MODEL=tiny` for faster processing or `WHISPER_MODEL=medium` for higher
accuracy. Temporary audio is deleted after transcription.

## Safety

Messaging sources are read-only. The app drafts and copies text, but its send,
reply, reaction, archive, and mark-read paths are disabled. Adam performs every
communication action manually in the source app.

## Development

```powershell
cd web
npm install
npm test
node server.mjs
```

Build the Windows installer:

```powershell
cd desktop
npm install
npm run dist
```

Important paths:

| Path | Purpose |
| --- | --- |
| `web/server.mjs` | Source aggregation, ranking, drafting, tasks, and copy-only boundary |
| `web/whatsapp.mjs` | Direct WhatsApp pairing, history, storage, and voice-note intake |
| `web/voice-transcriber.mjs` | Private local voice-note transcription worker |
| `web/public/index.html` | Two-pane inbox and guided voice review |
| `desktop/main.js` | Electron shell and native Windows dictation bridge |
| `cloud/gateway.mjs` | Hosted accounts, secure sessions, and per-user routing |
| `cloud/worker-manager.mjs` | Isolated persistent worker lifecycle |
| `web/fates.mjs` | Deterministic open-loop calibration |
| `web/snapshots/` | Ranked inbox snapshots and voice-created tasks |
