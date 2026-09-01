# cleared.chat hosted beta

The hosted app puts an authenticated account gateway in front of one isolated
WhatsApp worker per user. Each worker gets its own WhatsApp credentials,
message cache, and triage snapshots.

## Runtime

- `cloud/gateway.mjs` verifies Clerk sessions, maps Google identities to local
  account IDs, stores encrypted secrets, and routes private requests.
- `cloud/worker-manager.mjs` starts one `web/server.mjs` process per account.
- `/data` contains the account database and all per-user WhatsApp state.
- `Dockerfile.cloud` includes the Node app and local voice-note transcription.

## Identity setup

1. Create a Clerk application and enable Google under SSO connections.
2. Use Clerk's shared Google credentials for development. For production, add
   a production Google OAuth client to the Clerk production instance.
3. Set `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in the runtime.
4. Set `APP_ORIGIN` and `CLERK_AUTHORIZED_PARTIES` to
   `https://app.cleared.chat`.
5. Keep Clerk keys unset for local password-mode development.

When a verified Google email matches an existing password account, the gateway
links Clerk to that account's existing internal ID. Its WhatsApp pairing,
message cache, snapshots, and saved AI key stay attached to the same workspace.

## Railway setup

1. Create a Railway service from this GitHub repository.
2. Attach a persistent volume at `/data` before creating the first account.
3. Set `CREDENTIAL_ENCRYPTION_KEY` to 32 random bytes encoded as base64.
4. Set `MAX_ACCOUNTS` to the hosted beta capacity, such as `25`.
5. Optionally set `ANTHROPIC_API_KEY` to provide AI for every account. Without
   it, each user can save an encrypted Anthropic key on the Account page.
6. Generate the Railway domain and verify `/health` reports `"ok": true` and
   `"auth": "clerk"`.
7. Add `app.cleared.chat` as the service custom domain.

The volume is mandatory. A deploy without it loses account sessions and
WhatsApp linked-device credentials.

Claude Code and Codex CLI subscriptions are intentionally unavailable in hosted
workers. They depend on authentication stored on the user's own computer. Use
the local browser or desktop app for bring-your-own-subscription mode.

## Security boundary

- Clerk owns Google authentication and hosted session cookies.
- The gateway verifies Clerk session tokens and restricts authorized parties to
  the hosted app origin.
- Legacy local passwords remain scrypt protected and are disabled when Clerk is
  configured.
- User-provided AI keys are encrypted with AES-256-GCM.
- WhatsApp directories are separated by account ID.
- The app drafts and copies text. It has no send endpoint and never sends a
  message for the user.

## Beta limits

The WhatsApp worker currently uses Baileys multi-file auth state on a restricted
persistent volume. This is appropriate for a small hosted beta. Before larger
scale, move auth keys and message state into a transactional database and run
workers as separately supervised services.
