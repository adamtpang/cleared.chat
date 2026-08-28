# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

cleared.chat is a local-first Electron messaging client with a browser-based
development mode. It connects directly to WhatsApp through Baileys, restores a
saved linked-device session on startup, ranks open loops by importance x
urgency, transcribes received voice notes, and prepares editable drafts.

The runtime is `web/server.mjs`, the direct WhatsApp adapter is
`web/whatsapp.mjs`, the interface is `web/public/index.html`, and the desktop
shell is `desktop/main.js`. Gmail and Discord are optional adapters. The Beeper
Desktop adapter is legacy, disabled by default, and not required.

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
