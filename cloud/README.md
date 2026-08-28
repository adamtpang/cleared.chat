# cleared.chat hosted beta

The hosted app puts an authenticated account gateway in front of one isolated
WhatsApp worker per user. Each worker gets its own WhatsApp credentials,
message cache, and triage snapshots.

## Runtime

- `cloud/gateway.mjs` owns signup, login, sessions, encrypted secrets, and
  routing.
- `cloud/worker-manager.mjs` starts one `web/server.mjs` process per account.
- `/data` contains the account database and all per-user WhatsApp state.
- `Dockerfile.cloud` includes the Node app and local voice-note transcription.

## Railway setup

1. Create a Railway service from this GitHub repository.
2. Attach a persistent volume at `/data` before creating the first account.
3. Set `CREDENTIAL_ENCRYPTION_KEY` to 32 random bytes encoded as base64.
4. Set `MAX_ACCOUNTS` to the hosted beta capacity, such as `25`.
5. Optionally set `ANTHROPIC_API_KEY` to provide AI for every account. Without
   it, each user can save an encrypted Anthropic key on the Account page.
6. Generate the Railway domain and verify `/health` returns `{ "ok": true }`.
7. Add `app.cleared.chat` as the service custom domain.

The volume is mandatory. A deploy without it loses account sessions and
WhatsApp linked-device credentials.

## Security boundary

- Passwords use scrypt with a unique salt.
- Session cookies are HTTP-only, secure in production, and expire after 30
  days.
- User-provided AI keys are encrypted with AES-256-GCM.
- WhatsApp directories are separated by account ID.
- The app drafts and copies text. It has no send endpoint and never sends a
  message for the user.

## Beta limits

The WhatsApp worker currently uses Baileys multi-file auth state on an encrypted
persistent volume. This is appropriate for a small hosted beta. Before larger
scale, move auth keys and message state into a transactional database and run
workers as separately supervised services.
