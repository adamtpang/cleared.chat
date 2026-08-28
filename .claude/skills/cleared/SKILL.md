+---
name: cleared
description: Clear my messaging inbox to zero using cleared.chat. Read the local direct-WhatsApp inbox, rank open loops by importance x urgency, identify tasks that must happen before a reply, ask one clarifying question when intent is unclear, and prepare copy-ready drafts. Never send or mutate messages.
---

# cleared.chat inbox zero

Work through the local cleared.chat inbox from the most important open loop to
the least important. Every reply-owed conversation must end with one explicit
next action and, when context is sufficient, one editable unsent draft.

## Rule 0

Never send, reply, react, archive, mark read, post, email, DM, or otherwise
communicate externally as Adam. This remains true even if Adam says send, yes,
or approves exact wording. Adam performs the final action manually.

Do not call write endpoints. Do not automate clicks in WhatsApp. Reading,
scoring, drafting, revising, and presenting copy-ready text are allowed.

## Source

cleared.chat runs locally at `http://127.0.0.1:4317`.

1. Check `GET /api/wa/status`.
2. If the server is unavailable, start `npm run dev` from `web/`.
3. Read `GET /api/all` for the complete local conversation list.
4. Run `GET /api/inbox?scope=all` for ranked triage.
5. Read `GET /api/messages?id=<chat-id>` for thread context.

A valid saved WhatsApp link reconnects and syncs automatically. If WhatsApp
returns 401, tell Adam to pair once in Settings. Do not create or approve the
phone-side link on his behalf.

## Triage model

Score each open loop:

- Importance 5: family, legal, health, money, major commitments, key partners.
- Importance 4: close relationships, active clients, collaborators, promises.
- Importance 3: useful professional or social relationship.
- Importance 2: loose contact or optional coordination.
- Importance 1: promo, bot, broadcast, spam, or pure noise.
- Urgency 5: blocking someone now, deadline today, safety, expiring opportunity.
- Urgency 4: should move today or has waited too long.
- Urgency 3: should move this week.
- Urgency 2: no immediate consequence.
- Urgency 1: informational only.

Priority is importance x urgency, with a modest age boost. Relationship and
consequence outrank message recency.

Classify every conversation:

- REPLY: Adam can reply now.
- TASK-FIRST: a concrete action or decision is required before the final reply.
- LATER: intentionally defer with a clear trigger or date.
- NO REPLY OWED: Adam spoke last, the loop is resolved, or the message is noise.
- UNCLEAR: ask Adam one sharp question before drafting.

## Draft rules

- No em dashes.
- No emojis.
- Short, specific, warm, confident, and never needy.
- Do not invent facts, dates, promises, attachments, or decisions.
- Ask for missing intent before drafting.
- Keep every draft unsent and editable.

## Output

Start with:

`N open loops, N replies, N task-first, N unclear.`

Then present the highest-priority conversation:

- Who and network
- Importance x urgency score
- Why it matters now
- Whose turn it is
- Next action
- Task first, if any
- Clarifying question, if needed
- Unsent draft, only when context is sufficient
- Remaining count

After Adam reports what he manually sent or completed, update local notes and
continue to the next conversation.
