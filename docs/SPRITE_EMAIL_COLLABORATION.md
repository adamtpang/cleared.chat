# Shared inbox triage contract for Sprite

Status: smallest public, evidence-based contract between `cleared.chat` and
`sprite.email`. This is a local classification contract, not a transport or
data-sharing API. Each product keeps its own credentials, message bodies,
private profile data, snapshots, and source-specific actions.

## Ownership boundary

- Cleared owns WhatsApp normalization, conversation-state calibration,
  open-loop ranking, voice-note context, and editable unsent drafts.
- Sprite owns Gmail ingestion, account isolation, Gmail thread rendering, and
  every Gmail action surface.
- The shared seam begins with a normalized chronological thread and ends with
  advisory triage fields. It never sends, replies, reacts, archives, marks
  read, or mutates the source.
- No private store or personal record is part of this contract. Sharing the
  schema does not authorize sharing Adam's data between repositories.

## Stable input

The portable input is the conversation shape consumed by `deriveState` in
`web/fates.mjs`:

```ts
type TriageThread = {
  id: string
  title: string
  network: string
  type: 'single' | 'group'
  isMuted: boolean
  me?: { id?: string, name?: string }
  messages: Array<{
    isSender: boolean
    senderName?: string
    text: string
    timestamp: string | number | Date
    mentions?: string[]
  }> // oldest to newest
}
```

`isSender` means the inbox owner authored the message. Empty-text messages are
ignored by the current state derivation. For a Gmail thread, Sprite may use
`type: 'single'`, `isMuted: false`, and an empty `mentions` array when those chat
concepts do not apply. Source-specific IDs and URLs remain opaque values owned
by Sprite.

Scoring has three additional inputs:

```ts
type ScoreInput = {
  importance: number // integer 1..5: relationship and consequence
  urgency: number    // integer 1..5: time pressure
  daysWaiting: number
}
```

`daysWaiting` starts when the other party's last message puts the ball in the
owner's court. Importance must not be inferred from recency. Cleared's learned
`relationshipWeight` can inform chat importance, but its latency, frequency,
thread-depth, and reciprocity heuristic is chat-specific and is not required of
Sprite.

## Stable output

The minimum interoperable result is:

```ts
type TriageResult = {
  chatId: string
  importance: number
  urgency: number
  base: number
  ageBoost: number
  priority: number
  fate: 'F1_QUICK' | 'F2_BLOCK' | 'F3_WAITING' | 'F4_LET_GO' | 'UNCLEAR'
  reason: string
  calibrated: boolean
  replyOwed: boolean
  taskFirst: boolean
  task: string
  needsClarification: boolean
  clarifyingQuestion: string
  nextAction: string
  draft: string
}
```

Cleared's `/api/inbox` response currently exposes final `priority` under the
field name `score` and also returns `base` and `ageBoost`. A shared consumer
should keep the three concepts explicit and avoid treating `score` as the base
product.

Fate is the canonical cross-product classification:

| Fate | Meaning | Operator vocabulary |
| --- | --- | --- |
| `F1_QUICK` | The owner can answer in under two minutes. | REPLY |
| `F2_BLOCK` | Real work must happen before the complete answer. | TASK-FIRST, often REPLY + TASK |
| `F3_WAITING` | The owner spoke last; the ball is in the other party's court. | NO REPLY OWED |
| `F4_LET_GO` | No action is needed. | NOISE / NO REPLY OWED |
| `UNCLEAR` | Intent cannot be read safely. | UNCLEAR |

`LATER` in the Cleared operator skill is a workflow choice with a clear trigger
or date, not a value in the runtime `FATE` enum. Sprite should keep defer/snooze
state separate from the shared fate until both runtimes define and test the same
representation.

## Scoring invariants

1. Clamp importance and urgency independently to 1 through 5.
2. `base = importance * urgency`, producing 1 through 25.
3. `ageBoost = min(floor(max(0, daysWaiting) / 7), 8)`.
4. `priority = base + ageBoost`, producing 1 through 33.
5. Rank descending by priority. Age lifts a waiting thread but never replaces
   importance or urgency.

The written rubric says equal priorities are oldest-first. The current server
sorts only on final score, so FIFO is policy intent but not yet an executable
cross-product parity guarantee. Preserve `daysWaiting` in the output; do not
claim identical tie ordering until Cleared adds an explicit secondary sort and
test.

## State and calibration invariants

The model or source heuristic may propose a fate, but deterministic conversation
state has final authority in this order:

1. No readable messages becomes `UNCLEAR`.
2. If the owner spoke last, use `F3_WAITING`, except an unfulfilled dated promise
   by the owner becomes `F2_BLOCK`.
3. An unaddressed group burst of at least five messages becomes `F4_LET_GO`.
4. A bare acknowledgment with no question becomes `F4_LET_GO`.
5. A muted thread not addressed to the owner becomes `F4_LET_GO`.
6. If the proposed fate is missing or `UNCLEAR`, an open question becomes
   `F1_QUICK`; otherwise remain `UNCLEAR`.

After calibration:

- `replyOwed` is true only when the other party spoke last and fate is
  `F1_QUICK` or `F2_BLOCK`.
- `taskFirst` is true only for `F2_BLOCK`.
- A model proposal may not override turn-taking, acknowledgment, mute, or group
  noise calibration.
- Judge the whole ordered thread, never only its newest message.

## Drafting, privacy, and action safety

- Results are advisory. The human performs every final communication action.
- Do not expose a send, reply, react, archive, mark-read, or other mailbox
  mutation through this contract. Cleared's `/api/act` deliberately returns a
  disabled-action error.
- Redact sensitive identifiers before any model call. Cleared currently redacts
  payment cards, email addresses, supported crypto addresses, credential-like
  secrets, and US Social Security numbers. This is a minimum filter, not a
  general guarantee that all personal data has been removed.
- If a missing choice or fact could change the reply, set
  `needsClarification: true`, ask exactly one specific `clarifyingQuestion`, and
  leave `draft` empty.
- A draft is allowed only when `replyOwed` is true and clarification is not
  needed. Never invent facts, dates, amounts, links, attachments, decisions,
  completed work, commitments, or promises.
- Drafts remain editable and unsent. Cleared also strips em dashes and requires
  no emojis as product voice rules; Sprite may retain stricter source-specific
  voice rules without changing triage semantics.

## Public evidence

| Path | Evidence supplied |
| --- | --- |
| `docs/scoring.md` | Importance and urgency definitions, product formula, weekly age boost, cap, intended FIFO tie-break, and REPLY/TASK/NOISE examples. |
| `web/fates.mjs` | Pure `FATE`, `deriveState`, `calibrate`, `assignFate`, `priorityOf`, `relationshipWeight`, `radar`, and `redact` implementations. |
| `web/server.mjs` | Normalized message/thread shape, redaction before model calls, clarity gate, calibrated ranked-item fields, draft suppression, descending score sort, read endpoints, and disabled communication actions. |
| `.claude/skills/cleared/SKILL.md` | Operational 1-to-5 rubric, operator vocabulary, one-question clarity rule, unsent draft rules, and the prohibition on write endpoints. |
| `web/fates.test.mjs` | Executable examples for turn-taking, group bursts, acknowledgments, open promises, muted threads, age boost, relationship weighting, radar, and redaction. |
| `CLAUDE.md` and `AGENTS.md` | Repository-level product boundary, private-state rules, ownership split, and absolute human-send invariant. |
| `package.json` | Repository test command: `npm test`. |

## Smallest next step for the Sprite owner

Add one pure fixture test in `sprite.email` that maps an oldest-to-newest Gmail
thread into `TriageThread`, then asserts the score tuple and safety fields for a
single reply-owed example: importance 5, urgency 2, 21 days waiting yields
`base: 10`, `ageBoost: 3`, `priority: 13`; if a required fact is absent, the
result has one clarification question and an empty draft. Keep the fixture
synthetic and make no Gmail mutation.
