// cleared.chat desktop Electron shell.
// Runs the web/ proxy server IN this process (Electron's own Node) via dynamic
// import, then opens a window to it. Works both in dev (npm start) and when
// packaged by electron-builder.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = process.env.PORT || 4317;
process.env.PORT = String(PORT);
app.setPath('userData', path.join(app.getPath('appData'), 'cleared-chat-desktop'));

// Packaged app: load keys from the user's app-data .env if present, so live mode
// can be configured without touching the install dir. (Dev reads web/.env.)
if (app.isPackaged) {
  const currentData = app.getPath('userData');
  process.env.SNAPSHOT_DIR = path.join(currentData, 'snapshots');
  process.env.WA_DATA_DIR = path.join(currentData, 'whatsapp');
  const cfg = path.join(currentData, '.env');
  if (fs.existsSync(cfg)) {
    for (const line of fs.readFileSync(cfg, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function serverPath() {
  // Dev: ../web/server.mjs. Packaged: resources/web/server.mjs (extraResources).
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  return path.join(base, 'web', 'server.mjs');
}

async function startServer() {
  // server.mjs starts an HTTP server on import (it calls listen() at top level).
  await import(pathToFileURL(serverPath()).href);
}

function waitForServer(cb, tries = 0) {
  http
    .get(`http://localhost:${PORT}/`, (r) => { r.destroy(); cb(); })
    .on('error', () => {
      if (tries > 80) return cb();
      setTimeout(() => waitForServer(cb, tries + 1), 200);
    });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 880,
    height: 920,
    title: 'cleared.chat',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#F8F8F8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.maximize();
  win.show();
  win.loadURL(`http://localhost:${PORT}/`);
}

function voiceScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'voice-listen.ps1')
    : path.join(__dirname, 'voice-listen.ps1');
}

ipcMain.handle('voice:listen', () => new Promise((resolve, reject) => {
  const child = spawn('powershell.exe', [
    '-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass',
    '-File', voiceScriptPath(), '-TimeoutSeconds', '22',
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', reject);
  child.on('close', (code) => {
    const transcript = out.trim();
    if (code === 0 && transcript) resolve({ transcript });
    else if (code === 2) resolve({ transcript: '', timeout: true });
    else reject(new Error(err.trim() || 'Speech recognition did not return text.'));
  });
}));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another copy is already running. Hand focus to it and exit quietly.
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

app.whenReady().then(async () => {
  if (!gotLock) return;
  try {
    await startServer();
  } catch (e) {
    if (e && e.code === "EADDRINUSE") {
      // Something already owns the port. The UI still works against it.
      console.error(`port ${PORT} already in use; attaching to the existing server`);
    } else {
      console.error("server start error:", e);
    }
  }
  waitForServer(createWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
