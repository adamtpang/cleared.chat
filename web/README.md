# cleared.chat local app

The local server merges connected message sources into one inbox, ranks open
loops, drafts replies, and serves the desktop interface.

```powershell
npm install
npm test
npm run dev
```

Open `http://127.0.0.1:4317`. Real mode is the default. Pair WhatsApp from
Settings, then select **Start voice triage**.

The local browser build reads the source files directly, so it does not need a
new Windows installer after each change. Refresh the browser after interface
changes. Restart `npm run dev` only after server-side changes.

For the recommended pairing flow, select **Show QR**, then open WhatsApp on the
phone and select **Linked Devices > Link a Device** to scan it. The phone needs
an active WhatsApp session but does not need a functioning SIM for the scan.
Phone-number pairing is available under **Phone number code, currently
unreliable**, but current WhatsApp protocol changes can cause Baileys to display
a code before WhatsApp has accepted it. Prefer QR pairing and do not repeatedly
retry a rejected phone-number code.

The browser never receives source credentials. Direct WhatsApp credentials and
message history stay local. Ranking and drafting use the Claude Code CLI by
default, with optional Anthropic API and Grok CLI backends.

Set `DEMO=1` for sample conversations. Copy `.env.example` only when you need to
change a backend or enable an optional source.

Email is opt-in with `EMAIL_ENABLED=1`. The default sweep contains active
messaging chats only and ignores WhatsApp Archive.

Received voice notes are transcribed locally and included in triage context.
Install the local engine once with `python -m pip install faster-whisper`.
Messaging sources remain read-only. Drafts are copied and sent manually.
