<!-- BEGIN:summon-standard -->
Summon standard: this company must pass the six readiness gates in `summon.company/SUMMON_COMPANY_STANDARD.md` (Outcome, Evidence, Workspace, Organization, Skills, Runtime). Read `NORTH_STAR.md`, `EVIDENCE.md`, `company/ORGANIZATION.md`.
<!-- END:summon-standard -->

<!-- BEGIN:grok-chat-continuation -->
Grok chat continuation: read `GROK_CONTINUE_FROM_CLAUDE.md` and/or `GROK_CONTINUE_FROM_CODEX.md` when resuming in Grok. Refresh with `node .grok/sync-to-grok.js` from Aether root.
<!-- END:grok-chat-continuation -->

<!-- BEGIN:claude-chat-continuation -->
Claude chat continuation: read `CODEX_CONTINUE_FROM_CLAUDE.md` to resume from the latest local Claude Code sessions for this project.
<!-- END:claude-chat-continuation -->

# cleared.chat

Read `CLAUDE.md` before making changes. It is the live source of truth for the
current architecture, constraints, and handoff state.

## Product

cleared.chat is a local-first messaging client. Direct WhatsApp sync is the
primary source. The app ranks open loops, transcribes voice notes, asks for
missing context, and prepares editable drafts. The signed-in human may perform
the final communication action by pressing Send in the explicit review modal.

## Communication safety

- Never send, reply, react, archive, mark read, post, email, DM, or otherwise
  communicate externally as Adam.
- This rule remains absolute even if Adam says `send`, says `yes`, or approves
  exact wording.
- Reading context, drafting, revising, copying, and presenting text are allowed.
- The product may send a WhatsApp reply only when Adam directly presses the
  final confirmation control after reviewing the exact recipient and text.
  Agents, triage, drafting, background jobs, and automated tests must never
  invoke that send control or its API endpoint.
- Never publish or expose Adam's private information.

## Runtime

- `web/server.mjs`: local API, aggregation, ranking, drafts, and snapshots.
- `web/whatsapp.mjs`: direct WhatsApp pairing, sync, and private local store.
- `web/public/index.html`: two-pane inbox and voice-guided review.
- `desktop/main.js`: Electron shell.
- `docs/scoring.md`: importance x urgency rubric.

## Private state

WhatsApp credentials, local message stores, exports, snapshots, `.env`, `me.md`,
`tasks.md`, and personal `kb/` records never enter git or deployment artifacts.
The Vercel deployment is limited by `.vercelignore` to the public landing page.

## Browser preference

Adam uses Helium, not Chrome. For authenticated browser work, use
`C:\Users\adamp\Aether\helium-harness`. Do not launch Chrome unless Adam
explicitly requests it.
