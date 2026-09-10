import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];

test('first paint is light unless dark was explicitly chosen', () => {
  const bootstrap = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1];
  for (const saved of [null, 'system', 'invalid', 'light', 'dark']) {
    let theme = 'light';
    vm.runInNewContext(bootstrap, {
      localStorage: { getItem: () => saved },
      document: { documentElement: { setAttribute: (key,value) => { if(key === 'data-theme') theme=value; } } },
    });
    assert.equal(theme, saved === 'dark' ? 'dark' : 'light');
  }
  assert.match(html, /<html lang="en" data-theme="light">/);
  assert.doesNotMatch(html, /id="accentrow"|data-t="system"/);
});

test('AI connection recovery is available in settings and failed avatars preserve initials', () => {
  const active = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(active, /id="localairow"/);
  assert.match(active, /id="localaiprovider"/);
  assert.match(script, /window.location.assign\('\/account'\)/);
  assert.match(html, /if\(!row\)\{ AI_AVAILABLE = Boolean\(data.ready\)/);
  assert.match(html, /image.style.opacity = '0'/);
  assert.match(html, /onload="this.style.opacity=1"/);
});

// Exercise the shipped inline controller with no browser, account, or network.
function controller() {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) {
      const classes = new Set();
      elements.set(selector, {
        value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
        style: { setProperty() {} }, dataset: {}, scrollHeight: 60,
        classList: {
          add: (...names) => names.forEach(n => classes.add(n)),
          remove: (...names) => names.forEach(n => classes.delete(n)),
          contains: name => classes.has(name),
          toggle(name, on) { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
        },
        querySelector: child => element(`${selector} ${child}`),
        querySelectorAll: () => [],
        setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
        focus() {}, addEventListener() {},
      });
    }
    return elements.get(selector);
  }
  const context = vm.createContext({
    console, URL, AbortController,
    document: { querySelector: element, querySelectorAll: () => [],
      documentElement: element('html'), body: element('body'), addEventListener() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {} }) },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: async () => { throw new Error('Network access is prohibited in UI tests'); },
  });
  const run = code => vm.runInContext(code, context);
  run(script);
  run(`ALL = ['a','b'].map(id => ({id:'wa:'+id, who:id, kind:'message', network:'WhatsApp', lastAt:'2026-09-05T00:00:00Z', unread:1}));
    LATEST_TRIAGE_ITEMS = ALL.map((it, i) => ({chatId:it.id, who:it.who, draft:'draft '+it.who,
      conversationVersion:it.lastAt, fate:'F1_QUICK', unreadCount:1, score:10-i}));
    openId='wa:a'; AI_AVAILABLE=true; restoreComposer(openId);`);
  return { run, context, element };
}

test('exhausted avatars wait for reconnect rather than losing their image element', () => {
  const { run, context } = controller();
  const image = {style:{},dataset:{avatarAttempt:'4'},remove(){throw new Error('Do not remove retryable avatar');}};
  context.image = image;
  run('retryAvatar(image)');
  assert.equal(image.dataset.avatarWaiting, 'true');
  context.document.querySelectorAll = () => [image];
  run('resumeAvatarsAfterReconnect()');
  assert.equal(image.dataset.avatarWaiting, undefined);
  assert.equal(image.dataset.avatarAttempt, '1');
});

test('desktop shell has one list, one conversation and no automatic Focus surface', () => {
  assert.doesNotMatch(html, /id="(?:navrail|focusbar|triagenotice|aipanel)"|FOCUS_MODE|body\.sidebar-collapsed/);
  assert.doesNotMatch(html, /\u2014|Drafts need a fresh triage/);
  assert.match(html, /class="sidebar"/);
  assert.match(html, /class="chatpane"/);
  assert.match(html, /@media\s*\(max-width:820px\)/);
});

test('edited drafts and intentionally empty drafts survive switching chats', () => {
  const { run, element } = controller();
  element('#composer').value = 'my actual reply';
  run('editComposer($("#composer")); openId="wa:b"; restoreComposer(openId);');
  assert.equal(element('#composer').value, 'draft b');
  run('openId="wa:a"; restoreComposer(openId);');
  assert.equal(element('#composer').value, 'my actual reply');
  element('#composer').value = '';
  run('editComposer($("#composer")); LATEST_TRIAGE_ITEMS[0].draft="new AI draft"; restoreComposer(openId);');
  assert.equal(element('#composer').value, '');
});

test('old snapshot drafts are not seeded against newer messages', () => {
  const { run, element } = controller();
  run('ALL[0].lastAt="2026-09-05T01:00:00Z"; restoreComposer(openId);');
  assert.equal(element('#composer').value, '');
  assert.equal(element('#nextaction').hidden, true);
});

test('late AI output stays attached to its original chat', async () => {
  const { run, context, element } = controller();
  let finish;
  context.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = run('aiDraft()');
  run('openId="wa:b"; restoreComposer(openId);');
  finish({ ok: true, json: async () => ({ draft: 'finished a' }) });
  await pending;
  assert.equal(element('#composer').value, 'draft b');
  run('openId="wa:a"; restoreComposer(openId);');
  assert.equal(element('#composer').value, 'finished a');
});

test('typing while AI runs wins over the late generated reply', async () => {
  const { run, context, element } = controller();
  let finish;
  context.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = run('aiDraft()');
  element('#composer').value = 'keep these edits';
  run('editComposer($("#composer"))');
  finish({ ok: true, json: async () => ({ draft: 'old generation' }) });
  await pending;
  assert.equal(element('#composer').value, 'keep these edits');
  run('restoreComposer(openId)');
  assert.equal(element('#composer').value, 'keep these edits');
});

test('clarification without a triage row gets an answer mode, never reply review', async () => {
  const { run, context, element } = controller();
  run('LATEST_TRIAGE_ITEMS=[]; COMPOSERS.clear(); restoreComposer(openId);');
  context.fetch = async url => {
    assert.equal(url, '/api/chat');
    return { ok: true, json: async () => ({question:'Which day works for you?'}) };
  };
  await run('aiDraft()');
  assert.equal(element('#nextcopy').textContent, 'Which day works for you?');
  assert.equal(element('#copycomposer').textContent, 'Use answer');
  assert.equal(element('#aidraftbtn').hidden, true);
  run('reviewReply=()=>{throw new Error("Private context must not enter reply review")}; aiDraft=()=>{window.answered=true};');
  element('#composer').value = 'Friday';
  run('editComposer($("#composer")); composerKeydown({key:"Enter",preventDefault(){}})');
  assert.equal(run('window.answered'), true);
});

test('successive clarification answers stay in the model context', async () => {
  const { run, context, element } = controller();
  let count = 0;
  const requests = [];
  context.fetch = async (url, options) => {
    assert.equal(url, '/api/chat');
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ++count === 1
      ? { question: 'Which day?' } : count === 2 ? { question: 'What time?' } : { draft: 'friday at 2 works' } };
  };
  await run('aiDraft()');
  element('#composer').value = 'Friday';
  run('editComposer($("#composer"))');
  await run('aiDraft()');
  element('#composer').value = '2pm';
  run('editComposer($("#composer"))');
  await run('aiDraft()');
  assert.match(JSON.stringify(requests[2].messages), /Friday/);
  assert.match(JSON.stringify(requests[2].messages), /2pm/);
  assert.equal(element('#composer').value, 'friday at 2 works');
  assert.equal(element('#copycomposer').textContent, 'Review');
});

test('normal Enter opens review, while Shift+Enter and IME do not', () => {
  const { run } = controller();
  run('window.reviews=0; reviewReply=()=>{window.reviews++}');
  run('composerKeydown({key:"Enter",shiftKey:true}); composerKeydown({key:"Enter",isComposing:true});');
  assert.equal(run('window.reviews'), 0);
  run('composerKeydown({key:"Enter",preventDefault(){}})');
  assert.equal(run('window.reviews'), 1);
});

test('Cleared advances the priority queue and does not mutate WhatsApp', async () => {
  const { run, context, element } = controller();
  context.fetch = async (url, options) => {
    assert.equal(url, '/api/solved');
    assert.equal(JSON.parse(options.body).chatId, 'wa:a');
    return { ok:true, json: async () => ({ok:true}) };
  };
  run('TAB="priorities"; openPriority=async id=>{openId=id; restoreComposer(id)};');
  await run('clearUnreadChat("wa:a")');
  assert.equal(run('openId'), 'wa:b');
  assert.equal(element('#cntUnread').textContent, 1);
  assert.equal(element('#cntPriority').textContent, 1);
});

test('all task prerequisites remain readable in the single next-action line', () => {
  const { run, element } = controller();
  run('LATEST_TRIAGE_ITEMS[0].tasks=["Check the invoice","Confirm the amount"]; renderNextAction(openId);');
  assert.match(element('#nextcopy').textContent, /Check the invoice.*Confirm the amount/);
});
