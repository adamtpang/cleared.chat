# Cleared parity target

## Selected peer

WhatsApp Desktop is the primary interaction reference for Cleared's messaging
surface. The current evidence is Adam's 2026-09-02 desktop screenshot, showing
the dark three-column shell, chat filters, contact-first rows, fixed thread
header, message canvas, unread divider, and fixed composer.

Cleared copies the learned interaction structure, not WhatsApp trademarks,
logos, wording, or proprietary visual assets. Its name, mark, green, pattern,
AI workflow, and private completion state remain original.

## Parity matrix

| Reference behavior | Cleared state | Notes |
| --- | --- | --- |
| Narrow desktop navigation rail | Complete | Chats, AI priorities, Focus, and Settings stay one click away. |
| Chats heading and list controls | Complete | Search, All, Unread, Priority, and Triage live above the list. |
| Contact-first chat rows | Complete | Photo, name, preview, time, and unread count follow the familiar hierarchy. |
| Fixed conversation header | Complete | Contact identity, Cleared state, and overflow actions remain visible. |
| Dense message canvas | Complete | Compact incoming and outgoing bubbles, timestamps, images, voice notes, and unread boundary. |
| Fixed reply composer | Complete | Editable text, AI Draft, and Review remain at the bottom. |
| Mobile list and thread navigation | Complete | The two panes become mutually exclusive below 820 px. |
| Conversation search | Next | Search inside the open thread without changing WhatsApp state. |
| Quoted replies | Next | Preserve the original message reference through review and send. |
| Attachment sending | Next | Images and documents require the same human review boundary. |
| Delivery and read receipts | Next | Render source state without mutating it. |

## Cleared advantages

- Importance and urgency ranking across every open loop.
- Focus mode with visible priority progress.
- A compact next-action brief inside the conversation.
- Editable relationship-aware drafts.
- Task-first plans and clarifying questions before drafting.
- Local voice-note transcription and Markdown export.
- Private versioned Cleared state that does not mark WhatsApp read.

## Safety boundary

AI and background work may read, rank, summarize, and draft. Only Adam's direct
click on a final review control may send, react, or forward. Tests and agents
never invoke those endpoints or controls.
