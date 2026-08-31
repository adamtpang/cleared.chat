const esc = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const shell = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | cleared.chat</title>
<meta name="theme-color" content="#087D86">
<link rel="icon" href="/favicon.ico" sizes="any">
<style>
:root{--bg:#f4f9f9;--panel:#fff;--ink:#152124;--muted:#53696d;--line:#d3e1e2;--brand:#087d86;--danger:#b42318;--radius:8px}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:var(--brand);text-decoration:none}.page{min-height:100vh;display:grid;grid-template-rows:auto 1fr}.top{height:64px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:rgba(255,255,255,.9)}.top>a{min-width:44px;min-height:44px;display:flex;align-items:center;padding:0 8px}
.brand{font-weight:800;color:var(--ink);display:flex;align-items:center;gap:9px}.dot{width:9px;height:9px;border-radius:50%;background:var(--brand)}
.main{display:grid;place-items:center;padding:32px 20px}.panel{width:min(430px,100%);background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:28px;box-shadow:0 24px 60px -45px #152124}
h1{font-size:26px;line-height:1.15;letter-spacing:0;margin:0 0 8px}p{margin:0 0 22px;color:var(--muted)}
.tabs{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);border-radius:6px;padding:3px;margin-bottom:22px}.tabs button{border:0;background:transparent;padding:9px;border-radius:4px;font:inherit;font-weight:700;color:var(--muted);cursor:pointer}.tabs button.on{background:#e7f0f1;color:var(--ink)}
form{display:grid;gap:14px}.field{display:grid;gap:6px}label{font-size:12px;font-weight:700;color:var(--muted)}input{width:100%;border:1px solid var(--line);border-radius:6px;padding:11px 12px;font:inherit;color:var(--ink);outline:0}input:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(8,125,134,.1)}
button.primary{border:0;border-radius:6px;padding:12px 16px;background:var(--brand);color:#fff;font:inherit;font-weight:800;cursor:pointer}button.primary:hover{background:#075f66}.error{border:1px solid #f4c7c3;background:#fff5f4;color:var(--danger);padding:10px 12px;border-radius:6px;margin-bottom:16px}.fine{font-size:12px;color:var(--muted);margin-top:16px}
.account{display:grid;gap:18px}.row{border-top:1px solid var(--line);padding-top:18px}.status{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--brand);margin-bottom:10px}.status i{width:7px;height:7px;border-radius:50%;background:currentColor}.actions{display:flex;gap:10px;flex-wrap:wrap}.ghost{border:1px solid var(--line);background:#fff;border-radius:6px;padding:9px 12px;font:inherit;font-weight:700;cursor:pointer}.nav{display:flex;align-items:center;gap:14px;font-size:13px}.nav form{display:block}.nav button{border:0;background:none;color:var(--muted);font:inherit;cursor:pointer;padding:0}
.auth-shell{display:grid;gap:18px}.auth-mount{min-height:120px;display:grid;align-content:center;gap:12px}.loader{display:grid;justify-items:center;gap:12px;color:var(--muted);font-size:13px}.spinner{width:24px;height:24px;border:2px solid var(--line);border-top-color:var(--brand);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.google-button{width:100%;min-height:48px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);display:flex;align-items:center;justify-content:center;gap:10px;font:inherit;font-weight:800;cursor:pointer}.google-button:hover{background:#f7fafa}.google-button:disabled{opacity:.6;cursor:wait}.google-mark{width:22px;height:22px;border:1px solid var(--line);border-radius:50%;display:grid;place-items:center;color:#4285f4;font-weight:800}.auth-status{min-height:20px;text-align:center;color:var(--muted);font-size:12px}.auth-status.error{border:0;background:transparent;padding:0;color:var(--danger)}
</style>
</head><body><div class="page">${body}</div></body></html>`;

export function authPage({ mode = 'login', error = '' } = {}) {
  const signup = mode === 'signup';
  return shell(signup ? 'Create account' : 'Sign in', `
  <header class="top"><a class="brand" href="https://cleared.chat"><span class="dot"></span>cleared.chat</a><a href="https://cleared.chat">About</a></header>
  <main class="main"><section class="panel">
    <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
    <p>${signup ? 'Pair WhatsApp once, then work your priority inbox from any browser.' : 'Open your private messaging workspace.'}</p>
    <div class="tabs"><button class="${signup ? '' : 'on'}" onclick="location.href='/login'">Sign in</button><button class="${signup ? 'on' : ''}" onclick="location.href='/signup'">Create account</button></div>
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <form method="post" action="${signup ? '/signup' : '/login'}">
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="10" required></div>
      <button class="primary" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <div class="fine">Your WhatsApp credentials and messages are isolated from every other account. cleared.chat never sends messages.</div>
  </section></main>`);
}

export function clerkAuthPage({ publishableKey, frontendApi, error = '', callback = false } = {}) {
  return shell('Sign in', `
  <header class="top"><a class="brand" href="https://cleared.chat"><span class="dot"></span>cleared.chat</a><a href="https://cleared.chat">About</a></header>
  <main class="main"><section class="panel auth-shell">
    <div><h1>Clear your messaging inbox</h1><p>Continue with Google, pair WhatsApp once, then work every open loop in priority order.</p></div>
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <div class="auth-mount">
      ${callback ? '<div class="loader"><span class="spinner"></span><span>Finishing secure sign in</span></div>' : '<button id="google-signin" class="google-button" type="button" disabled><span class="google-mark">G</span><span>Continue with Google</span></button>'}
      <div id="clerk-status" class="auth-status">${callback ? '' : 'Preparing secure sign in'}</div>
    </div>
    <div class="fine">Your WhatsApp credentials and messages are isolated from every other account. cleared.chat never sends messages.</div>
  </section></main>
  <script defer crossorigin="anonymous" data-clerk-publishable-key="${esc(publishableKey)}" src="${esc(frontendApi)}/npm/@clerk/clerk-js@6/dist/clerk.browser.js"></script>
  <script>
    window.addEventListener('load', async function () {
      const status = document.getElementById('clerk-status');
      const button = document.getElementById('google-signin');
      try {
        await Clerk.load();
        if (Clerk.isSignedIn) {
          location.replace('/app');
          return;
        }
        if (${callback ? 'true' : 'false'}) {
          await Clerk.handleRedirectCallback({
            signInUrl: '/login',
            signUpUrl: '/login',
            signInFallbackRedirectUrl: '/app',
            signUpFallbackRedirectUrl: '/app'
          });
          return;
        }
        button.disabled = false;
        status.textContent = '';
        button.addEventListener('click', async function () {
          button.disabled = true;
          status.className = 'auth-status';
          status.textContent = 'Opening Google';
          try {
            await Clerk.client.signIn.authenticateWithRedirect({
              strategy: 'oauth_google',
              redirectUrl: '/sso-callback',
              redirectUrlComplete: '/app'
            });
          } catch (error) {
            button.disabled = false;
            status.className = 'auth-status error';
            status.textContent = 'Google sign in could not start. Refresh and try again.';
          }
        });
      } catch (error) {
        status.className = 'auth-status error';
        status.textContent = 'Google sign in could not load. Refresh and try again.';
      }
    });
  </script>`);
}

export function accountPage({ user, hasUserKey, hasPlatformKey, message = '', error = '' }) {
  const aiReady = hasUserKey || hasPlatformKey;
  return shell('Account', `
  <header class="top"><a class="brand" href="/app"><span class="dot"></span>cleared.chat</a><div class="nav"><a href="/app">Inbox</a><form method="post" action="/logout"><button type="submit">Sign out</button></form></div></header>
  <main class="main"><section class="panel account">
    <div><h1>Account</h1><p>${esc(user.email)}</p></div>
    ${message ? `<div class="status"><i></i>${esc(message)}</div>` : ''}
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <div class="row">
      <div class="status" style="color:${aiReady ? 'var(--brand)' : 'var(--muted)'}"><i></i>${aiReady ? 'AI assistant ready' : 'AI assistant needs a key'}</div>
      <p>${hasPlatformKey ? 'AI usage is provided by cleared.chat for this beta.' : 'Add your Anthropic API key for ranking and drafting. It is encrypted before storage.'}</p>
      ${hasPlatformKey ? '' : `<form method="post" action="/account/ai-key"><div class="field"><label for="apiKey">Anthropic API key</label><input id="apiKey" name="apiKey" type="password" autocomplete="off" placeholder="sk-ant-..."></div><button class="primary" type="submit">${hasUserKey ? 'Replace key' : 'Save key'}</button></form>`}
      ${hasUserKey ? `<form method="post" action="/account/ai-key/delete" style="margin-top:10px"><button class="ghost" type="submit">Remove saved key</button></form>` : ''}
    </div>
    <div class="row"><p>WhatsApp pairing and connection status are managed inside Inbox Settings.</p><div class="actions"><a class="primary" style="display:inline-block;padding:11px 16px;border-radius:6px;background:var(--brand);color:#fff;font-weight:800" href="/app">Open inbox</a></div></div>
  </section></main>`);
}
