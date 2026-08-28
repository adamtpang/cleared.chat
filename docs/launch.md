# Launch content

Copy-ready launch material for cleared.chat. Nothing here is posted
automatically.

## Short post

my WhatsApp inbox became an unprioritized task list. important promises, money,
family, and people waiting on me were mixed in with everything else.

so i built cleared.chat. it syncs WhatsApp directly, figures out whose turn it
is, ranks every open loop by importance x urgency, transcribes voice notes, and
gives each reply-owed chat one next action and an editable draft.

it never sends. i review, copy, and send manually.

https://cleared.chat
https://github.com/adamtpang/cleared.chat

## Show HN

**Title:** Show HN: cleared.chat, a priority queue for your WhatsApp open loops

**Body:**

My WhatsApp inbox had become an unprioritized task list. Recency was deciding
what I answered, so important people and promises were easy to miss.

cleared.chat is a local-first app that connects directly to WhatsApp through a
linked-device session. It identifies whose turn it is, scores open loops by
importance x urgency, transcribes received voice notes, and classifies each
conversation as reply now, do a task first, handle later, or no reply owed.

When facts or intent are missing, it asks one question before drafting. When the
context is sufficient, it prepares an editable reply in the user's voice. The
agent never sends or changes messages. The human reviews, copies, and sends in
WhatsApp.

The app and message store run locally. Model-assisted ranking and drafting use
the configured model provider, so users should review that provider's privacy
terms before enabling it.

Repo: https://github.com/adamtpang/cleared.chat

Site: https://cleared.chat

I would value feedback on turn detection, direct-sync reliability, and which
signals should dominate importance.
