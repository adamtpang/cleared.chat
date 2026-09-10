# Private writing style

Open Settings > Writing style. Edit casing, length, emojis and Markdown notes,
then Save preferences. Explicit preferences override inferred tendencies.
Enable learning and save, then select Update from history to create a profile.
Profile preview describes evidence and confidence for the open conversation,
falling back to aggregate tendencies when that conversation has sparse history.
Export .md downloads this view through the authenticated API.

Reset learning deletes inferred summaries and disables learning. Explicit
preferences are retained and can be edited independently. Opting out also
deletes inferred summaries. Nothing is sent or marked read by these controls.
Existing drafts are not silently rewritten: use Draft or rerun triage to apply
changed preferences. Human edits and final confirmation remain in place.

## Evidence and boundaries

- Current scope: WhatsApp text, latest 100 stored messages in each of up to 200
  active chats. Overall metrics use at most 500 eligible messages.
- Require native sent provenance, not a display name of "Me". Exclude incoming,
  forwarded, quoted, media/transcript, assistant and generated records.
- Legacy messages with no provenance are excluded until native sync enriches
  them. Missing history means low confidence, not invented personalization.
- Twelve eligible messages are required for habits, forty for moderate
  confidence. No claim of high confidence is made. Slang and greetings come
  from a fixed lexicon and require at least three examples. No individual emoji
  or arbitrary phrase is learned. Frequency is descriptive, never an obligation.
- We cannot identify AI text pasted manually into WhatsApp once it arrives as
  ordinary sent text without provenance. Users can inspect, correct or opt out.
- No raw examples are persisted by the style module. The private JSON contains
  preferences, counts and aggregate metrics; recipient keys are SHA-256 hashes.
  Markdown contains no recipient identifiers or source messages. User-entered
  notes remain private and should be reviewed before sharing an export.
- Hosted profiles use the authenticated worker's snapshot directory, not an ID
  supplied by a browser. Workers bind to loopback. Local mode is single-user.
- Factual meaning is protected by draft prompt rules and human review, not a
  semantic guarantee. Tests verify unchanged source text and prompt integration;
  a live-model quality evaluation remains outstanding.

Canonical storage: `writing-style.json` in the private snapshot directory.
Endpoints: `/api/style`, `/api/style/refresh`, `/api/style/export`.
No source examples, profiles, credentials or exports belong in git or images.
