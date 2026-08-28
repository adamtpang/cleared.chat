# cleared.chat desktop

The Electron app starts the local inbox server, opens maximized, stores private
state under the user's app-data directory, and exposes Windows speech recognition
to the renderer through a narrow preload bridge.

It does not launch or require another desktop bridge. Direct WhatsApp pairing is managed
inside cleared.chat Settings. Received voice notes are transcribed locally when
Python and Faster Whisper are installed.

Run locally:

```powershell
npm install
npm start
```

Build the Windows installer:

```powershell
npm run dist
```

The installer is written to the output directory configured in `package.json`.
It is currently unsigned, so Windows SmartScreen may require **More info**, then
**Run anyway** on first installation.
