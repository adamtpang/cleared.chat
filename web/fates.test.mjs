// Tests for the triage core. Zero deps, uses Node's built-in runner:
//   node --test web/
import test from 'node:test';
import assert from 'node:assert/strict';
import { FATE, deriveState, calibrate, assignFate, priorityOf, compareTriagePriority, relationshipWeight, radar, redact } from './fates.mjs';

const NOW = new Date('2026-07-25T12:00:00Z');
const ago = (days, hours = 0) => new Date(NOW - days * 86400000 - hours * 3600000).toISOString();
const them = (text, when) => ({ isSender: false, senderName: 'Them', text, timestamp: when });
const me = (text, when) => ({ isSender: true, senderName: 'Adam', text, timestamp: when });

const conv = (over = {}) => ({ id: 'c1', title: 'Test', network: 'WhatsApp', type: 'single', messages: [], ...over });

test('empty conversation is UNCLEAR, never a guess', () => {
  const r = assignFate(conv({ messages: [] }), FATE.QUICK, NOW);
  assert.equal(r.fate, FATE.UNCLEAR);
});

test('I spoke last -> WAITING, even if the model said QUICK', () => {
  const c = conv({ messages: [them('can you look at this?', ago(3)), me('yes, on it', ago(2))] });
  const r = assignFate(c, FATE.QUICK, NOW);
  assert.equal(r.fate, FATE.WAITING);
  assert.equal(r.overridden, true);
  assert.match(r.reason, /ball is in their court/i);
});

test('group burst without being addressed -> LET_GO', () => {
  const msgs = [me('see you all there', ago(2))];
  for (let i = 0; i < 8; i++) msgs.push(them(`msg ${i}`, ago(1, i)));
  const r = assignFate(conv({ type: 'group', messages: msgs }), FATE.QUICK, NOW);
  assert.equal(r.fate, FATE.LET_GO);
  assert.match(r.reason, /group burst/i);
});

test('group burst that names me stays actionable', () => {
  const msgs = [me('hey all', ago(2))];
  for (let i = 0; i < 8; i++) msgs.push(them(`msg ${i}`, ago(1, i)));
  msgs.push(them('Adam can you confirm the booking?', ago(0, 2)));
  const c = conv({ type: 'group', messages: msgs, me: { name: 'Adam Pangelinan', id: '@adam' } });
  const r = assignFate(c, FATE.QUICK, NOW);
  assert.equal(r.fate, FATE.QUICK, 'being named should beat the burst rule');
});

test('a shared group deadline stays actionable without naming me', () => {
  const msgs = [me('thanks', ago(2))];
  for (let i = 0; i < 7; i++) msgs.push(them(`chatter ${i}`, ago(1, i + 1)));
  msgs.push(them('Everyone please check out by 12pm today unless you have an arrangement.', ago(0, 1)));
  const r = assignFate(conv({ type: 'group', messages: msgs }), FATE.BLOCK, NOW);
  assert.equal(r.fate, FATE.BLOCK, 'a deadline applying to everyone should beat the burst rule');
  assert.match(r.state.sharedDeadlineText, /check out by 12pm today/i);
});

test('"ok cool" after a resolved thread is LET_GO, not a reply prompt', () => {
  const c = conv({ messages: [me('sent it over', ago(2)), them('ok cool', ago(1))] });
  const r = assignFate(c, FATE.QUICK, NOW);
  assert.equal(r.fate, FATE.LET_GO);
  assert.match(r.reason, /acknowledgment/i);
});

test('an ack that also asks something is still actionable', () => {
  const c = conv({ messages: [me('sent it', ago(2)), them('thanks! when can you do the next one?', ago(1))] });
  const r = assignFate(c, FATE.QUICK, NOW);
  assert.equal(r.fate, FATE.QUICK);
});

test('a promise I made with no follow-up becomes BLOCK', () => {
  const c = conv({ messages: [them('any update?', ago(9)), me("i'll send the invoice tomorrow", ago(8))] });
  const r = assignFate(c, FATE.WAITING, NOW);
  assert.equal(r.fate, FATE.BLOCK);
  assert.match(r.reason, /promised/i);
});

test('muted chat is LET_GO unless I am addressed', () => {
  const c = conv({ type: 'group', isMuted: true, messages: [me('hi', ago(3)), them('random chatter', ago(1))] });
  assert.equal(assignFate(c, FATE.QUICK, NOW).fate, FATE.LET_GO);
});

test('model fate is respected when no calibration rule fires', () => {
  const c = conv({ messages: [me('hey', ago(3)), them('can you review the doc by friday?', ago(1))] });
  const r = assignFate(c, FATE.BLOCK, NOW);
  assert.equal(r.fate, FATE.BLOCK);
  assert.equal(r.overridden, false);
});

test('deriveState reads whose turn it is', () => {
  const s = deriveState(conv({ messages: [me('yo', ago(2)), them('hey', ago(1))] }), NOW);
  assert.equal(s.ballInMyCourt, true);
  assert.equal(s.counts.total, 2);
  assert.equal(s.openIncomingText, 'hey');
});

test('a statement beginning with got is not treated as a question', () => {
  const c = conv({ messages: [them('Got your new number from Kams', ago(1))] });
  assert.equal(deriveState(c, NOW).hasQuestion, false);
});

test('old payment history does not turn a new unrelated message into a money loop', () => {
  const c = conv({ messages: [
    them('Here is the $50 payment link', ago(8)),
    me('paid, thank you', ago(7)),
    them('No lunch on Sunday.', ago(1)),
  ] });
  assert.equal(deriveState(c, NOW).mentionsMoney, false);
});

test('new payment after my last reply remains a money loop', () => {
  const c = conv({ messages: [
    them('old payment link', ago(8)),
    me('please amend it', ago(7)),
    them('Here is the corrected $50 payment link', ago(1)),
  ] });
  assert.equal(deriveState(c, NOW).mentionsMoney, true);
});

test('priority: age lifts but does not lead', () => {
  const urgent = priorityOf({ importance: 5, urgency: 5, daysWaiting: 0 });
  const stale = priorityOf({ importance: 3, urgency: 3, daysWaiting: 21 });
  assert.equal(urgent.priority, 25);
  assert.equal(stale.priority, 12);
  assert.ok(urgent.priority > stale.priority, 'a real emergency still outranks an old low-stakes thread');
  assert.equal(priorityOf({ importance: 3, urgency: 3, daysWaiting: 400 }).ageBoost, 8, 'age boost caps at 8');
});

test('triage queues unread chats before other replies owed', () => {
  const items = [
    { chatId: 'read-urgent', unreadCount: 0, score: 25, daysWaiting: 12 },
    { chatId: 'unread-low', unreadCount: 1, score: 6, daysWaiting: 0 },
    { chatId: 'unread-high', unreadCount: 3, score: 20, daysWaiting: 1 },
    { chatId: 'read-low', unreadCount: 0, score: 8, daysWaiting: 30 },
  ].sort(compareTriagePriority);
  assert.deepEqual(items.map((item) => item.chatId), [
    'unread-high',
    'unread-low',
    'read-urgent',
    'read-low',
  ]);
});

test('relationship weight is learned from behavior, not recency', () => {
  const close = conv({ messages: Array.from({ length: 60 }, (_, i) =>
    i % 2 ? me('yes', ago(30 - i * 0.4, 1)) : them('hey', ago(30 - i * 0.4, 2))) });
  const distant = conv({ messages: [them('hi', ago(200)), me('hey', ago(150))] });
  assert.ok(relationshipWeight(close, NOW) > relationshipWeight(distant, NOW));
});

test('radar surfaces someone I went quiet on, ranked by weight not recency', () => {
  const important = conv({ id: 'imp', title: 'Close Friend',
    messages: [...Array.from({ length: 40 }, (_, i) => i % 2 ? me('yeah', ago(60 - i, 1)) : them('yo', ago(60 - i, 2))),
      them('are we still on for next week?', ago(12))] });
  const shallow = conv({ id: 'shal', title: 'Acquaintance',
    messages: [them('hey nice to meet you', ago(30))] });

  const r = radar([important, shallow], NOW);
  assert.ok(r.goneQuietOn.length >= 2);
  assert.equal(r.goneQuietOn[0].id, 'imp', 'the person who matters outranks the more-recent shallow thread');
  assert.equal(r.unansweredAsks[0].id, 'imp');
});

test('radar finds money threads and missed commitments', () => {
  const money = conv({ id: 'm', title: 'Client', messages: [me('sounds good', ago(6)), them('sending the $500 invoice today', ago(4))] });
  const promise = conv({ id: 'p', title: 'Joe', messages: [them('any update?', ago(10)), me("i'll get you the deck tomorrow", ago(9))] });
  const r = radar([money, promise], NOW);
  assert.equal(r.moneyThreads[0].id, 'm');
  assert.equal(r.missedCommitments[0].id, 'p');
});

test('muted chats stay out of the radar', () => {
  const c = conv({ id: 'x', isMuted: true, messages: [me('hi', ago(20)), them('yo', ago(15))] });
  assert.equal(radar([c], NOW).goneQuietOn.length, 0);
});

test('redaction strips credentials and financial identifiers', () => {
  const out = redact('card 4111 1111 1111 1111, mail me at a@b.com, api_key sk_live_abc123, ssn 123-45-6789');
  assert.ok(!out.includes('4111'), 'card number must not survive');
  assert.ok(!out.includes('a@b.com'), 'email must not survive');
  assert.ok(!out.includes('sk_live_abc123'), 'api key must not survive');
  assert.ok(!out.includes('123-45-6789'), 'ssn must not survive');
});

test('redaction strips crypto addresses', () => {
  const out = redact('send to 0x52908400098527886E0F7030069857D2E4169EE7 or u1abcdefghijklmnopqrstuvwxyz012345');
  assert.ok(!out.includes('0x52908400098527886E0F7030069857D2E4169EE7'));
  assert.ok(!/u1abcdefghijklmnopqrstuvwxyz/.test(out));
});
