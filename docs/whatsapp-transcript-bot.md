# Cleared WhatsApp transcript number

cleared.chat includes a disabled-by-default WhatsApp Business Platform webhook
that turns a dedicated Cleared number into a voice-note transcription service.
People forward or record a voice note to that number. Cleared acknowledges the
note immediately, transcribes it, and replies from the Cleared business identity
with the text transcript.

This is separate from the personal-inbox Baileys connection. It does not pair as
a linked device, does not read a user's personal inbox, and does not send as the
user.

## Runtime behavior

1. Meta posts an inbound audio webhook to Cleared.
2. Cleared validates `X-Hub-Signature-256` with the Meta app secret.
3. The webhook returns immediately so Meta does not retry a long transcription.
4. Cleared replies that the voice note was received.
5. Cleared retrieves the media from Meta, rejects empty or over-16 MB audio, and
   transcribes it with the bundled local Whisper model.
6. Cleared sends the transcript in WhatsApp-safe text chunks.
7. Temporary audio is removed after transcription. Transcript text is not logged.

Duplicate webhook message IDs are ignored during the process lifetime. No real
messages are sent by tests.

## Meta setup

Start with Meta's test number, then replace it with a dedicated Cleared business
number before launch.

1. Create a Meta business app and add the WhatsApp product.
2. Create or select a WhatsApp Business Account and phone number.
3. Configure the callback URL:
   `https://app.cleared.chat/api/meta/whatsapp/webhook`
4. Generate a random webhook verification token and enter the same value in Meta
   and `META_WA_VERIFY_TOKEN`.
5. Subscribe the app and WhatsApp Business Account to the `messages` webhook.
6. Create a permanent system-user access token with
   `whatsapp_business_messaging` permission.
7. Add the following variables to `/etc/cleared-chat/runtime.env`:

```dotenv
META_WA_VERIFY_TOKEN=
META_WA_APP_SECRET=
META_WA_ACCESS_TOKEN=
META_WA_PHONE_NUMBER_ID=
META_GRAPH_VERSION=v26.0
```

8. Restart the production container.
9. Confirm `https://app.cleared.chat/health` reports
   `"whatsappTranscriptBot":"ready"`.
10. Send a synthetic voice note to the Meta test number before opening the number
    to real users.

Keep all five values out of git. The access token and app secret provide control
of the business number and must be treated as production credentials.
