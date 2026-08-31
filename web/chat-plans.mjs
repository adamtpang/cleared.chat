import { dirname } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const CHAT_PLAN_OUTCOMES = new Set(['reply', 'task', 'waiting', 'no-reply']);

function clean(value, limit) {
  return String(value || '')
    .replace(/\u2014/g, ',')
    .replace(/\u2013/g, '-')
    .trim()
    .slice(0, limit);
}

export function readChatPlans(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function planForConversation(plans, chatId, conversationVersion) {
  const record = plans?.[String(chatId || '')];
  if (!record) return null;
  const stale = String(record.conversationVersion || '') !== String(conversationVersion || '');
  return { ...record, stale };
}

export function saveChatPlan(file, input, now = new Date()) {
  const chatId = clean(input?.chatId, 500);
  const conversationVersion = clean(input?.conversationVersion, 200);
  const outcome = clean(input?.outcome, 20);
  const explanation = clean(input?.explanation, 2000);
  const task = clean(input?.task, 1000);

  if (!chatId || !conversationVersion) throw new Error('missing chat version');
  if (!CHAT_PLAN_OUTCOMES.has(outcome)) throw new Error('choose what this chat needs');
  if (explanation.length < 3) throw new Error('explain why this chat is still open');
  if (outcome === 'task' && task.length < 3) throw new Error('state the task that must happen first');

  const plans = readChatPlans(file);
  const record = {
    chatId,
    conversationVersion,
    outcome,
    explanation,
    task: outcome === 'task' ? task : '',
    updatedAt: now.toISOString(),
  };
  plans[chatId] = record;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(plans, null, 2), { mode: 0o600 });
  return record;
}

export function applyChatPlan(item, plan) {
  if (!plan) return item;
  const next = { ...item, userPlan: plan };
  if (plan.stale) return next;

  next.reason = `Your explanation: ${plan.explanation}`;
  next.needsClarification = false;
  next.clarifyingQuestion = '';

  if (plan.outcome === 'reply') {
    next.fate = 'F1_QUICK';
    next.replyOwed = true;
    next.taskFirst = false;
    next.tasks = [];
    next.task = '';
    next.nextAction = 'Draft and review the reply.';
    return next;
  }
  if (plan.outcome === 'task') {
    next.fate = 'F2_BLOCK';
    next.replyOwed = true;
    next.taskFirst = true;
    next.tasks = [plan.task];
    next.task = plan.task;
    next.nextAction = plan.task;
    return next;
  }

  next.replyOwed = false;
  next.taskFirst = false;
  next.tasks = [];
  next.task = '';
  next.draft = '';
  if (plan.outcome === 'waiting') {
    next.fate = 'F3_WAITING';
    next.nextAction = 'Wait for them. Mark cleared after review.';
  } else {
    next.fate = 'F4_LET_GO';
    next.nextAction = 'No reply needed. Mark cleared after review.';
  }
  return next;
}
