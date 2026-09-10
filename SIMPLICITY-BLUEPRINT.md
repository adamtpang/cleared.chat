# Simplicity blueprint - the radically simple version of cleared.chat

One sentence: if cleared.chat did exactly one thing perfectly, Adam could open
one familiar WhatsApp-style inbox, see the chats he owes in priority order, and
clear them one by one with an editable draft and one intentional send
confirmation.

## The one user

Adam, with a linked personal WhatsApp account and an overloaded unread inbox he
wants to clear today without learning a second messaging interface.

## The core loop

1. Open cleared.chat to the complete Unread sidebar.
2. Press Triage once and keep the same sidebar, now ordered by priority.
3. Open the first chat and read only its unread messages plus one quiet next action.
4. Edit the suggested reply in the normal composer and confirm the exact send.
5. Press Cleared and continue to the next chat while the visible count falls.

Done when: from a real linked account, Adam clears five chats in priority order
without the sidebar disappearing, opening a dashboard, or seeing a stale-state
warning.

## The minimum effective feature set

Every line here survived the deletion test: remove it and the core loop breaks.

- Complete WhatsApp-style Unread sidebar with names, photos, previews, times, and counts - without it, Adam cannot trust that the sweep covers his real inbox.
- Triage in the existing sidebar - without it, Adam must choose who matters first or enter a separate workflow.
- Plain selected-chat transcript with unread boundary, media, and voice transcripts - without it, Adam cannot understand what he is answering.
- One quiet next action and one editable draft in the normal composer - without them, Cleared does not reduce the work of deciding and writing.
- One exact-recipient confirmation before sending - without it, Adam cannot safely close the loop inside Cleared.
- Cleared and automatic next-chat progression with a remaining count - without them, the inbox-zero loop has no visible finish line.

## What this deliberately is NOT (the cut list)

- Focus mode that hides the sidebar - NEVER (it removes the inbox context Adam explicitly wants to keep).
- Separate AI Priority destination and navigation rail - NEVER (triage belongs in the existing chat list).
- Persistent stale-triage or missing-draft banners - NEVER (an empty draft can offer Draft without adding warning chrome).
- Next-action cards, Decide/Do/Draft panels, and expanded plan editors in the message stream - NEVER (one action line is enough).
- Standalone draft-assistant panel beside the real chat - NEVER (AI belongs in the composer, not a competing conversation).
- Persistent buttons for reactions, forwarding, exports, and transcript tools - NEVER (keep these contextual in message or overflow menus).
- Voice-guided triage - NOT YET (restore only after five complete daily text sweeps prove that voice makes the loop faster).
- Email, Discord, and legacy Beeper sources - NOT YET (restore only after WhatsApp reaches reliable daily zero for two weeks).
- Calendar scheduling and manual fate controls - NOT YET (restore only when a measured share of blocked replies needs structured scheduling).
- Additional dashboard counts, summary folders, and 80/20 panels - NEVER (the ordered sidebar and remaining count already answer what is next).

## The "if it worked" bar

Adam opens `app.cleared.chat`, presses Triage, and clears five real WhatsApp
conversations without the sidebar ever disappearing or any interface competing
with the selected chat.

## Blueprint notes (2026-09-03)

This RE-CUT uses the shipped `web/public/index.html`, current runtime contract,
Adam's direct production feedback, and the earlier 2026-08-17 blueprint. Scope
crept back through Focus mode, a separate AI rail destination, stale-output
banners, planning cards, voice controls, and a second assistant conversation.
This pass cuts those surfaces from the daily loop and returns Cleared to one
familiar inbox with AI embedded only where it changes the next action or draft.
The one user remains Adam, which matches the prior blueprint and the current
first-person workflow.

## Implementation notes (2026-09-05)

Implemented in the current `cleared.chat` checkout, preserving newer sticker,
accent, and pairing improvements. Desktop keeps the sidebar through triage.
Mobile has one list or one chat with Back navigation. Draft edits remain tied
to their contact, and clarification answers cannot enter reply review.
Validation: 82 automated tests; synthetic desktop and mobile browser checks.
The five-real-chat completion bar still requires Adam's manual daily sweep.
