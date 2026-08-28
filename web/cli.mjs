#!/usr/bin/env node
// cleared.chat terminal UI. Zero new deps: talks to the same local server
// (server.mjs) the web app uses, over plain fetch. Starts the server itself
// if it isn't already running.
//
// Run: node cli.mjs

import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.env.CLEARED_CHAT_PORT || 4317);
const BASE = `http://localhost:${PORT}`;

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', yellow: '\x1b[33m',
  green: '\x1b[32m', red: '\x1b[31m', gray: '\x1b[90m',
};
const paint = (code, s) => `${code}${s}${c.reset}`;

async function api(path, opts) {
  const r = await fetch(`${BASE}${path}`, opts);
  return r.json();
}

async function ensureServer() {
  try { await fetch(BASE); return; } catch {}
  process.stdout.write(paint(c.gray, '  starting cleared.chat server...\n'));
  spawn(process.execPath, [join(DIR, 'server.mjs')], {
    cwd: DIR,
    env: { ...process.env, PORT: String(PORT) },
    detached: true,
    stdio: 'ignore',
  }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { await fetch(BASE); return; } catch {}
  }
  throw new Error('server did not start in time');
}

const state = { items: [], ctx: null, msgs: [], lastDraft: '' };

const actionItems = () => state.items.filter((i) => i.fate === 'F1_QUICK' || i.fate === 'F2_BLOCK');

function banner() {
  console.log(paint(c.bold + c.cyan, '\n  cleared.chat') + paint(c.gray, '  daily triage, in your terminal'));
  console.log(paint(c.gray, '  drafts never send alone. type "help" for commands, "quit" to exit.\n'));
}

function help() {
  console.log(`
  ${paint(c.bold, 'commands')}
    list, ls           show the ranked action queue
    <n>                show item n (draft + reason)
    copy <n>           copy item n's draft to your clipboard
    to <name>          start drafting a message to someone
    <text>             (after "to") ask for a draft, in your voice
    copy               (after "to") copy the drafted message
    ask <question>     ask anything across every chat
    radar              relationship radar (who you've gone quiet on)
    triage, refresh    rescan and rerank your whole inbox (2-5 min)
    help               this
    quit, exit, q      leave
`);
}

function printList() {
  const items = actionItems();
  if (!items.length) {
    console.log(paint(c.gray, '  no cached triage yet. run "triage" to scan your inbox.\n'));
    return;
  }
  console.log(paint(c.bold, `\n  action queue (${items.length})\n`));
  items.forEach((it, i) => {
    const tag = it.fate === 'F2_BLOCK' ? paint(c.yellow, 'BLOCK') : paint(c.green, 'QUICK');
    console.log(`  ${paint(c.dim, String(i + 1).padStart(2))}  ${tag}  ${paint(c.bold, it.who)} ${paint(c.gray, `· ${it.network} · score ${it.score}`)}`);
    if (it.reason) console.log(`      ${paint(c.gray, it.reason)}`);
  });
  console.log(paint(c.gray, '\n  type a number to open one, or "copy <n>" to copy its draft.\n'));
}

function printItem(n) {
  const items = actionItems();
  const it = items[n - 1];
  if (!it) { console.log(paint(c.red, '  no such item. run "list".\n')); return; }
  console.log(`\n  ${paint(c.bold, it.who)} ${paint(c.gray, `· ${it.network}`)}`);
  if (it.reason) console.log(`  ${paint(c.gray, it.reason)}`);
  if (it.deliverable) console.log(`  ${paint(c.yellow, 'do: ' + it.deliverable)}`);
  console.log(`\n  ${paint(c.cyan, it.draft || '(no draft on this one)')}\n`);
  if (it.draft) console.log(paint(c.gray, `  copy ${n}   then send it manually in WhatsApp\n`));
}

async function loadCached() {
  const data = await api('/api/inbox/latest');
  if (data && !data.empty) state.items = data.items || [];
}

async function runTriage() {
  console.log(paint(c.gray, '  triaging… this can take 2-5 min while the model ranks everything\n'));
  const poll = setInterval(async () => {
    try {
      const p = await api('/api/progress');
      if (p.active) process.stdout.write(`\r  ${paint(c.gray, (p.stage || 'working…').padEnd(50))}`);
    } catch {}
  }, 1500);
  try {
    const data = await api('/api/inbox');
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
    if (data.error) { console.log(paint(c.red, `  ${data.error}\n`)); return; }
    state.items = data.items || [];
    console.log(paint(c.green, `  done - ${actionItems().length} action items\n`));
  } finally {
    clearInterval(poll);
  }
}

function copyToClipboard(text) {
  const command = process.platform === 'win32'
    ? ['clip.exe', []]
    : process.platform === 'darwin'
      ? ['pbcopy', []]
      : ['xclip', ['-selection', 'clipboard']];
  const result = spawnSync(command[0], command[1], { input: text, encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function copyItem(n) {
  const items = actionItems();
  const it = items[n - 1];
  if (!it) { console.log(paint(c.red, '  no such item.\n')); return; }
  if (!it.draft) { console.log(paint(c.red, '  no draft on this item.\n')); return; }
  const copied = copyToClipboard(it.draft);
  console.log(copied
    ? paint(c.green, `  copied the draft for ${it.who}. send it manually in WhatsApp.\n`)
    : paint(c.yellow, `  clipboard unavailable. copy the draft shown above manually.\n`));
}

async function setCtx(name) {
  const data = await api(`/api/search?q=${encodeURIComponent(name)}`);
  const items = data.items || [];
  if (!items.length) { console.log(paint(c.red, `  no chat found for "${name}"\n`)); return; }
  if (items.length > 1) {
    console.log(paint(c.gray, '  multiple matches, using the first - say a more specific name to change:'));
    items.forEach((it) => console.log(`    ${it.who} (${it.network})`));
  }
  state.ctx = { id: items[0].id, who: items[0].who, network: items[0].network };
  state.msgs = [];
  state.lastDraft = '';
  console.log(paint(c.green, `\n  drafting for ${state.ctx.who}. say what you want to tell them.\n`));
}

async function draftFor(text) {
  state.msgs.push({ role: 'user', content: text });
  const data = await api('/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: state.msgs, chat: state.ctx }),
  });
  if (data.error) { console.log(paint(c.red, `  ${data.error}\n`)); return; }
  state.msgs.push({ role: 'assistant', content: data.reply });
  state.lastDraft = data.reply;
  console.log(`\n  ${paint(c.cyan, data.reply)}\n`);
  console.log(paint(c.gray, `  copy   to copy this draft, or keep talking to refine it\n`));
}

function copyCtx() {
  if (!state.ctx || !state.lastDraft) { console.log(paint(c.red, '  nothing drafted yet.\n')); return; }
  const copied = copyToClipboard(state.lastDraft);
  console.log(copied
    ? paint(c.green, `  copied the draft for ${state.ctx.who}. send it manually in WhatsApp.\n`)
    : paint(c.yellow, '  clipboard unavailable. copy the draft shown above manually.\n'));
}

async function ask(q) {
  const data = await api('/api/ask', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: q }),
  });
  if (data.error) { console.log(paint(c.red, `  ${data.error}\n`)); return; }
  console.log(`\n  ${paint(c.cyan, data.answer || '(no answer)')}\n`);
}

async function radar() {
  const data = await api('/api/radar');
  if (data.error) { console.log(paint(c.red, `  ${data.error} (is cleared.chat running?)\n`)); return; }
  const groups = [
    ['goneQuietOn', 'people you have gone quiet on'],
    ['unansweredAsks', 'asks you never answered'],
    ['moneyThreads', 'money threads'],
    ['missedCommitments', 'promises with no follow-up'],
  ];
  for (const [key, label] of groups) {
    const list = data[key] || [];
    if (!list.length) continue;
    console.log(paint(c.bold, `\n  ${label} (${list.length})`));
    list.slice(0, 6).forEach((it) => console.log(`    ${it.title} ${paint(c.gray, `· ${it.network} · weight ${it.weight.toFixed(2)} · ${it.days}d`)}`));
  }
  console.log();
}

async function main() {
  await ensureServer();
  await loadCached();
  banner();
  if (state.items.length) printList();
  else console.log(paint(c.gray, '  no cached triage yet. run "triage" to scan your inbox.\n'));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: paint(c.cyan, 'cleared> ') });

  async function handle(input) {
    input = input.trim();
    try {
      if (!input) { /* noop */ }
      else if (/^(quit|exit|q)$/i.test(input)) { rl.close(); return; }
      else if (/^help$/i.test(input)) help();
      else if (/^(list|ls)$/i.test(input)) printList();
      else if (/^(triage|refresh)$/i.test(input)) await runTriage();
      else if (/^radar$/i.test(input)) await radar();
      else if (/^ask\s+/i.test(input)) await ask(input.replace(/^ask\s+/i, ''));
      else if (/^to\s+/i.test(input)) await setCtx(input.replace(/^to\s+/i, ''));
      else if (/^copy\s+(\d+)$/i.test(input)) copyItem(Number(input.match(/^copy\s+(\d+)$/i)[1]));
      else if (/^copy$/i.test(input)) copyCtx();
      else if (/^\d+$/.test(input)) printItem(Number(input));
      else if (state.ctx) await draftFor(input);
      else console.log(paint(c.gray, '  not sure what you mean. type "help".\n'));
    } catch (e) {
      console.log(paint(c.red, `  error: ${String(e.message || e)}\n`));
    }
  }

  const queue = [];
  let busy = false;
  async function drain() {
    if (busy) return;
    busy = true;
    while (queue.length) await handle(queue.shift());
    busy = false;
    if (!rl.closed) rl.prompt();
  }

  rl.on('line', (line) => { queue.push(line); drain(); });
  rl.on('close', async () => {
    // stdin can EOF (piped input, Ctrl+D) while a command is still
    // In flight. Never tear the process down mid-request.
    while (busy) await new Promise((r) => setTimeout(r, 50));
    console.log();
    process.exit(0);
  });
  rl.prompt();

  await new Promise((resolve) => rl.once('close', resolve));
}

main().catch((e) => { console.error(paint(c.red, String(e.message || e))); process.exit(1); });
