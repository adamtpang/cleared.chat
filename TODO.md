# TODO

Parked work, with enough context to pick up cold.

## 1. Gmail durable auth (Google Cloud Console)

**Status:** parked 2026-08-22, blocked on Adam only.

**Problem.** cleared.chat reads Gmail through sprite.email's Postgres
(`gmail_accounts`). It currently runs in TOKEN mode: it borrows whatever
`access_token` sprite.email last wrote. Those expire about hourly, so an
account silently drops out of the merged list mid-session. Seen live on
2026-08-22: `adam@anchormarianas.com` 401'd two minutes after its token
expired, and that load returned 702 emails instead of 816.

Re-linking the account inside sprite.email does NOT fix it. cleared.chat
cannot exchange a refresh token without the OAuth client credentials, so it
can only ride sprite.email's refreshes.

**The fix.** Get the OAuth **client ID** and **client secret** for
sprite.email's Google client from
https://console.cloud.google.com/apis/credentials and put them in
`web/.env`:

    AUTH_GOOGLE_ID=...
    AUTH_GOOGLE_SECRET=...

`gmail-source.mjs` already has the FULL auth path written and tested: with
those two present it uses the OAuth2 client, auto-refreshes, and writes the
new token back to the DB. `gmailAuthMode()` flips from `token` to `full`,
and the Settings sheet stops showing the expiry warning. No other change
needed.

## 2. WhatsApp direct pairing (Baileys)

**Status:** parked 2026-08-22 at Adam's call, resumable any time.

**Where it got to.** The pairing path itself is fixed and working: it builds
its own socket, waits for the websocket to open, and returns a real code
(confirmed: `6KRMBY6Q`, `F2PTAB48`, `Y424RZVD`, `RYPF66LC` all issued
successfully). `web/wa-auth-3/creds.json` shows `me.id` set to
`60197981734@s.whatsapp.net`, so WhatsApp accepted the request, but
`registered: false`, so no code was ever entered in time.

**The real constraint.** The socket that issues a code must stay alive until
the code is typed into the phone. Restarting the server kills it. Several
attempts died exactly this way while the desktop app was being rebuilt.

**To resume:** leave the server untouched, then

    curl -s -X POST http://127.0.0.1:4317/api/wa/pair \
      -H "content-type: application/json" \
      -d '{"phone":"60197981734"}'

and enter the code under WhatsApp > Linked Devices > Link with phone number.
Do not restart the server until `/api/wa/status` reports `open`.

**Why bother:** WhatsApp is the only network where going direct is both
low-risk and useful, and it removes the extra desktop-bridge dependency.

## 3. Discord direct (needs a token)

**Status:** scaffolded, never run.

`web/discord-source.mjs` is written and wired into the merge, but
`DISCORD_TOKEN` is not set, so `discordConfigured()` is false and it no-ops.
Adam accepted the ban risk explicitly on 2026-08-22 (self-bot use is against
Discord's ToS; a flagged account is normally permanently lost). Only a token
is used, never a password.

## 4. Telegram direct (needs API credentials)

**Status:** dependency installed (`teleproto`), no connector written.

Needs an API ID and API hash from https://my.telegram.org. This is the one
other network where going direct is officially sanctioned rather than
tolerated, so it is the safest one to add after WhatsApp.
