import test from 'node:test';
import assert from 'node:assert/strict';
import { accountPage } from './pages.mjs';

test('account offers an AI connection when no platform key is configured', () => {
  for (const hasUserKey of [true, false]) {
    const html = accountPage({user:{email:'test@example.invalid'}, hasUserKey, hasPlatformKey:false});
    assert.match(html, /name="apiKey"/);
    assert.match(html, /action="\/account\/ai-key/);
    assert.match(html, /Open inbox/);
  }
});

test('platform-provided AI does not ask the user for another key', () => {
  const html = accountPage({user:{email:'test@example.invalid'}, hasUserKey:false, hasPlatformKey:true});
  assert.match(html, /AI assistant ready/);
  assert.doesNotMatch(html, /name="apiKey"/);
});
