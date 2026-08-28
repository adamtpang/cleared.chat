# RUNTIME: cleared.chat

Generated 2026-07-26 by Summon fleet standardizer.

## Local run

Run `npm run dev` from `web/`, then open `http://127.0.0.1:4317`.

## Deploy

The public landing page is hosted on Vercel at `https://cleared.chat` under the
`cleared-chat` project. `.vercelignore` limits the upload to public static files.

Deploy with `vercel --prod --yes` from the repository root.

## Agent execution adapters (Summon lanes)

| Lane | When to use | Notes |
| --- | --- | --- |
| Claude Code | Default deep work while quota remains | Resets weekly; hand off via sync |
| Codex | When Claude is exhausted | Keep `AGENTS.md` / `CODEX_CONTINUE_FROM_CLAUDE.md` current |
| Grok | When Claude and Codex are exhausted | `node .grok/sync-to-grok.js` then read `GROK_CONTINUE_FROM_*.md` |

Strong default model: whatever the active adapter's best coding model is.
Low-reasoning lane: short, bounded tasks (lint, rename, one-file edits) on a fast model when available.

## Health proof

After each ship, record in `EVIDENCE.md`: URL or command, status code / screenshot, date.
