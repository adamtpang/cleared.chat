import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyChatPlan, planForConversation, readChatPlans, saveChatPlan } from './chat-plans.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'cleared-plans-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'chat-plans.json');
}

test('saves a private explanation and task for one conversation version', (t) => {
  const file = fixture(t);
  const record = saveChatPlan(file, {
    chatId: 'wa:person',
    conversationVersion: '2026-08-31T01:00:00.000Z',
    outcome: 'task',
    explanation: 'I need the furniture photos before I can answer.',
    task: 'Take and send the furniture photos.',
  }, new Date('2026-08-31T02:00:00.000Z'));

  assert.equal(record.outcome, 'task');
  assert.equal(readChatPlans(file)['wa:person'].explanation, record.explanation);
  assert.equal(planForConversation(readChatPlans(file), 'wa:person', record.conversationVersion).stale, false);
});

test('a newer message makes the saved action stale', (t) => {
  const file = fixture(t);
  saveChatPlan(file, {
    chatId: 'wa:person',
    conversationVersion: 'old',
    outcome: 'reply',
    explanation: 'I did not know my availability.',
  });
  const plan = planForConversation(readChatPlans(file), 'wa:person', 'new');
  const item = applyChatPlan({ fate: 'UNCLEAR', replyOwed: false }, plan);
  assert.equal(plan.stale, true);
  assert.equal(item.fate, 'UNCLEAR');
});

test('explicit outcomes override the heuristic without clearing the chat', () => {
  const base = { fate: 'UNCLEAR', replyOwed: false, taskFirst: false, draft: 'old guess' };
  const noReply = applyChatPlan(base, {
    outcome: 'no-reply',
    explanation: 'This was an expired group invitation.',
    stale: false,
  });
  assert.equal(noReply.fate, 'F4_LET_GO');
  assert.equal(noReply.replyOwed, false);
  assert.equal(noReply.draft, '');
  assert.equal(noReply.cleared, undefined);
});

test('an explanation is required before a plan can be saved', (t) => {
  const file = fixture(t);
  assert.throws(() => saveChatPlan(file, {
    chatId: 'wa:person',
    conversationVersion: 'v1',
    outcome: 'reply',
    explanation: '',
  }), /explain why/);
});
