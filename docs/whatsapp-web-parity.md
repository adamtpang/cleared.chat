# WhatsApp Web critical parity

Cleared targets the WhatsApp capabilities required to understand an inbox,
close open loops, and communicate without switching clients. It does not need
to clone every social, calling, channel, or administration surface.

## Daily critical path

| Capability | State | Cleared behavior |
| --- | --- | --- |
| Linked-device session | Complete | Pair once, restore the private session, and reconnect automatically. |
| Chat list | Complete | Show direct and group chats with contact names, photos, previews, and timestamps. |
| Unread queue | Complete | Mirror WhatsApp unread counts without marking messages read. |
| Archive boundary | Complete | Keep archived WhatsApp conversations out of the active daily queue. |
| Conversation history | Complete | Show incoming and outgoing messages with exact local timestamps. |
| Text messages | Complete | Read and send text after one human review confirmation. |
| Images | Complete for viewing | Cache images privately and open the full available image. |
| Voice notes | Cleared advantage | Transcribe received notes locally and export private Markdown. |
| Reactions | Complete | Choose an emoji and add it only after human confirmation. |
| Forwarding | Complete for one message | Search contacts and groups, select up to five chats, review, then forward natively. |
| Chat search | Complete | Search the synced chat list by contact or group name. |
| AI triage and drafts | Cleared advantage | Rank open loops, identify prerequisites, and prepare editable replies. |

## Next parity work

1. Quoted replies with the original message attached.
2. Send images and documents from the composer.
3. Render and download documents, video, stickers, and non-voice audio.
4. Search inside the open conversation.
5. Delivery and read receipts for sent messages.
6. Multi-select messages before forwarding.
7. Contact and group information, participants, and mute controls.
8. Edit and delete sent messages with explicit confirmation.

Calls, Status, Channels, Communities, broadcast creation, and group
administration are outside the inbox-zero critical path until user evidence
shows they block daily replacement of WhatsApp Web.

## Safety boundary

Sending, reacting, forwarding, editing, deleting, or changing WhatsApp state is
never an agent action. The authenticated human must review the exact target and
content and press the final confirmation control. Tests and background jobs do
not invoke communication endpoints.

## References

- https://faq.whatsapp.com/887468535575482/?cms_platform=web
- https://github.com/WhiskeySockets/Baileys/blob/master/README.md
