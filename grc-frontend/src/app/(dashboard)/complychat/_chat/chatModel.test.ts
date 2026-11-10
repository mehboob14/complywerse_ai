// node --test "src/app/(dashboard)/complychat/_chat/chatModel.test.ts"
// The rules of the chat that a screenshot cannot show: what a stored chat is read as and repaired to, the caps, the groups of the rail, what history goes to
// the server (a refused or failed turn stays out), how a "more results" page is appended, and how `?q=` is read and cleaned.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addressWith, chatsToKeep, clockTime, groupChats, historyFor, lastActivity, MAX_CHATS, MAX_MESSAGES, MAX_QUESTION_LINK, mergeMore, messageCount, newConversation,
  nextOffset, questionFromAddress, questionOf, readChats, shownCount, shownSoFar, titleOf, trimChats, UNFINISHED,
  type ChatMessage, type Conversation,
} from './chatModel.ts';

const NOW = new Date(2026, 10, 10, 15, 30);                       // 10 Nov 2026, 15:30 local
const at = (daysAgo: number, hour = 9) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, hour, 0);
const msg = (role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: `${role}-${content}`.slice(0, 40), role, content, timestamp: NOW, ...extra });
const chat = (id: string, messages: ChatMessage[], extra: Partial<Conversation> = {}): Conversation => ({ id, title: id, messages, createdAt: NOW, attachments: [], ...extra });

// ── what was kept in the browser ──

test('nothing readable is no chats, and reading never throws', () => {
  for (const raw of [null, undefined, '', 'not json', '{"a":1}', '42', '"x"', 'null']) assert.deepEqual(readChats(raw as string, NOW), []);
});

test('a chat kept by the older page is read, its dates become dates, an empty chat is dropped, and the server\'s path and file text are not kept', () => {
  const raw = JSON.stringify([
    { id: 'a', title: 'Open risks', createdAt: '2026-11-09T08:00:00.000Z', messages: [{ id: 'm1', role: 'user', content: 'list risks', timestamp: '2026-11-09T08:00:00.000Z' }, { id: 'm2', role: 'assistant', content: 'Here.', timestamp: '2026-11-09T08:00:05.000Z', sources: [{ entity_type: 'evidence_file', entity_id: '3', framework_code: 'Evidence File', relevance_score: 0.8 }], hasMore: true, totalCount: 55, currentOffset: 10 }],
      attachments: [{ id: 'f1', filename: 'policy.pdf', size: 1200, content_type: 'application/pdf', uploaded_at: '2026-11-09T08:00:00', path: 'C:\\srv\\uploads\\x.pdf', saved_name: 'x', excerpt: 'the whole text of the file' }] },
    { id: 'empty', title: 'New Conversation', createdAt: '2026-11-09T08:00:00.000Z', messages: [], attachments: [] },
  ]);
  const [only, ...rest] = readChats(raw, NOW);
  assert.equal(rest.length, 0, 'the empty chat is gone');
  assert.equal(only.title, 'Open risks');
  assert.ok(only.createdAt instanceof Date && only.messages[0].timestamp instanceof Date);
  assert.deepEqual(only.attachments, [{ id: 'f1', filename: 'policy.pdf', size: 1200, content_type: 'application/pdf', uploaded_at: '2026-11-09T08:00:00' }]);
  assert.equal(JSON.stringify(only).includes('excerpt'), false);
  assert.equal(JSON.stringify(only).includes('uploads'), false);
  assert.deepEqual(only.messages[1].sources?.[0].framework_code, 'Evidence File', 'a source keeps every field the server sent');
  assert.equal(only.messages[1].totalCount, 55);
});

test('a message left "loading" by a closed tab is a failed answer with Retry, and it remembers the question', () => {
  const raw = JSON.stringify([{ id: 'a', title: 'x', createdAt: NOW, messages: [
    { id: 'u', role: 'user', content: 'Uploaded files: a.pdf\n\nWhat is missing?', timestamp: NOW },
    { id: 'l', role: 'assistant', content: '', timestamp: NOW, isLoading: true }] }]);
  const [c] = readChats(raw, NOW);
  const failed = c.messages[1];
  assert.equal(failed.isLoading, undefined);
  assert.equal(failed.outcome, 'failed');
  assert.equal(failed.content, UNFINISHED);
  assert.equal(failed.originalQuestion, 'What is missing?');
});

test('the old page\'s one apology becomes a failed answer too, so it can be retried; an ordinary answer is untouched', () => {
  const raw = JSON.stringify([{ id: 'a', title: 'x', createdAt: NOW, messages: [
    { id: 'u', role: 'user', content: 'list risks', timestamp: NOW },
    { id: 'e', role: 'assistant', content: 'Sorry for the inconvenience, Something went wrong on our end. Please try again Later.', timestamp: NOW },
    { id: 'u2', role: 'user', content: 'again', timestamp: NOW },
    { id: 'ok', role: 'assistant', content: 'A fine answer.', timestamp: NOW }] }]);
  const [c] = readChats(raw, NOW);
  assert.equal(c.messages[1].outcome, 'failed');
  assert.equal(c.messages[1].originalQuestion, 'list risks');
  assert.equal(c.messages[3].outcome, undefined);
  assert.equal(c.messages[3].content, 'A fine answer.');
});

test('two chats with one id keep both, junk messages are dropped, an invalid date becomes now, chats come newest first', () => {
  const raw = JSON.stringify([
    { id: 'same', createdAt: '2026-11-01T00:00:00Z', messages: [{ id: 'm', role: 'user', content: 'old', timestamp: '2026-11-01T00:00:00Z' }] },
    { id: 'same', createdAt: 'garbage', messages: [{ role: 'user', content: 'new', timestamp: 'garbage' }, 7, null, 'x'] },
  ]);
  const chats = readChats(raw, NOW);
  assert.equal(chats.length, 2);
  assert.notEqual(chats[0].id, chats[1].id);
  assert.equal(chats[0].messages.length, 1);
  assert.equal(chats[0].messages[0].timestamp.getTime(), NOW.getTime());
});

test('what is kept leaves out an empty chat and a message that is still loading', () => {
  const kept = chatsToKeep([chat('a', [msg('user', 'q'), msg('assistant', '', { isLoading: true })]), chat('b', []), chat('c', [], { attachments: [{ id: '1', filename: 'f.txt' }] })]);
  assert.deepEqual(kept.map((c) => [c.id, c.messages.length]), [['a', 1], ['c', 0]]);
});

// ── caps ──

test('the store is capped: at most MAX_CHATS chats (the least recently used go), MAX_MESSAGES in a chat (the oldest go), and the counts are told', () => {
  const many = Array.from({ length: MAX_CHATS + 3 }, (_, i) => chat(`c${i}`, [msg('user', `q${i}`, { timestamp: at(i) })], { createdAt: at(i) }));
  const t = trimChats(many);
  assert.equal(t.chats.length, MAX_CHATS);
  assert.equal(t.droppedChats, 3);
  assert.equal(t.chats.some((c) => c.id === `c${MAX_CHATS + 2}`), false, 'the oldest is dropped');
  assert.equal(t.chats.some((c) => c.id === 'c0'), true);
  const long = chat('long', Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => msg('user', `m${i}`)));
  const cut = trimChats([long]);
  assert.equal(cut.chats[0].messages.length, MAX_MESSAGES);
  assert.equal(cut.chats[0].messages[0].content, 'm5');
  assert.equal(cut.droppedMessages, 5);
});

// ── the rail ──

test('chats are grouped by the day of their last message, newest first, and an empty group is left out', () => {
  const chats = [
    chat('old', [msg('user', 'a', { timestamp: at(5) })], { createdAt: at(5) }),
    chat('today-early', [msg('user', 'a', { timestamp: at(0, 8) })], { createdAt: at(0, 8) }),
    chat('yesterday', [msg('user', 'a', { timestamp: at(1, 23) })], { createdAt: at(1, 23) }),
    chat('today-late', [msg('user', 'a', { timestamp: at(0, 14) })], { createdAt: at(0, 14) }),
  ];
  const groups = groupChats(chats, NOW);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((c) => c.id)]), [['Today', ['today-late', 'today-early']], ['Yesterday', ['yesterday']], ['Earlier', ['old']]]);
  assert.deepEqual(groupChats([chats[0]], NOW).map((g) => g.label), ['Earlier']);
  assert.deepEqual(groupChats([], NOW), []);
});

test('the last activity is the newest of the chat\'s own date and its last message', () => {
  const c = chat('a', [msg('user', 'q', { timestamp: at(0, 12) })], { createdAt: at(3), updatedAt: at(1) });
  assert.equal(lastActivity(c).getTime(), at(0, 12).getTime());
});

test('a chat says how many messages it holds and what its title is', () => {
  assert.equal(messageCount(chat('a', [msg('user', 'q')])), '1 message');
  assert.equal(messageCount(chat('a', [msg('user', 'q'), msg('assistant', 'a'), msg('assistant', '', { isLoading: true })])), '2 messages');
  assert.equal(titleOf('  list   the\nopen risks  '), 'list the open risks');
  assert.equal(titleOf('Uploaded files: a.pdf\n\nWhat is missing?'), 'What is missing?');
  assert.equal(titleOf(''), 'New chat');
  assert.equal(titleOf('x'.repeat(80)).length, 50);
  assert.equal(titleOf('x'.repeat(80)).endsWith('…'), true);
  assert.equal(newConversation(NOW).title, 'New chat');
  assert.equal(clockTime(new Date(2026, 0, 2, 4, 5)), '04:05');
});

// ── what goes to the server ──

test('history is the last ten turns; a failed or refused turn goes with its question; nothing still loading is sent', () => {
  const turns: ChatMessage[] = [];
  for (let i = 0; i < 8; i += 1) turns.push(msg('user', `q${i}`), msg('assistant', `a${i}`));
  assert.equal(historyFor(turns).length, 10);
  assert.deepEqual(historyFor(turns).slice(-2), [{ role: 'user', content: 'q7' }, { role: 'assistant', content: 'a7' }]);

  const mixed = [
    msg('user', 'fine'), msg('assistant', 'fine answer'),
    msg('user', 'my password is hunter2'), msg('assistant', 'This question includes information that is not sent to the AI.', { outcome: 'blocked' }),
    msg('user', 'again'), msg('assistant', 'Comply Agent could not answer this right now.', { outcome: 'failed' }),
    msg('user', 'list risks'), msg('assistant', '', { isLoading: true }),
  ];
  assert.deepEqual(historyFor(mixed), [{ role: 'user', content: 'fine' }, { role: 'assistant', content: 'fine answer' }, { role: 'user', content: 'list risks' }]);
  assert.equal(JSON.stringify(historyFor(mixed)).includes('hunter2'), false, 'a refused question is never sent again');
  assert.deepEqual(historyFor([msg('assistant', 'x', { outcome: 'blocked' })]), []);
});

test('the question of a message is what the person typed, without the files line', () => {
  assert.equal(questionOf('Uploaded files: a.pdf, b.docx\n\nWhat is missing?'), 'What is missing?');
  assert.equal(questionOf('plain'), 'plain');
});

// ── more results ──

test('the next page is appended under a divider with its range, and the count never passes the total', () => {
  const merged = mergeMore('## First page\n\nrows', '## Second page\n\nmore rows', 11, 20, 55);
  assert.equal(merged, '## First page\n\nrows\n\n---\n\n**Results 11-20 of 55**\n\n## Second page\n\nmore rows');
  assert.match(mergeMore('a', 'b', 1, 5), /\*\*Results 1-5\*\*/);
  assert.equal(shownCount(0, 10, 55), 10);
  assert.equal(shownCount(50, 10, 55), 55);
  assert.equal(shownCount(0, 10, undefined), 10);
  assert.equal(shownSoFar({ currentOffset: 10, totalCount: 55 }), 10);
  assert.equal(shownSoFar({ currentOffset: 60, totalCount: 55 }), 55);
  assert.equal(shownSoFar({}), 10);
  assert.equal(nextOffset(10, 10), 20);
  assert.equal(nextOffset(0, 0), 10);
  assert.equal(nextOffset(undefined, 20), 30);
});

// ── the address ──

test('the question in the address is read trimmed and cut, and an empty one is none', () => {
  assert.equal(questionFromAddress('?q=list%20the%20open%20risks'), 'list the open risks');
  assert.equal(questionFromAddress('?q=%20%20'), null);
  assert.equal(questionFromAddress(''), null);
  assert.equal(questionFromAddress('?c=abc'), null);
  assert.equal(questionFromAddress(`?q=${'x'.repeat(MAX_QUESTION_LINK + 500)}`)?.length, MAX_QUESTION_LINK);
  assert.equal(questionFromAddress('?q=a%26b%3Dc'), 'a&b=c');
});

test('the address loses q once the question is taken, keeps every other parameter, and can name or drop the chat', () => {
  assert.equal(addressWith('/complychat', '?q=hello', { q: null }), '/complychat');
  assert.equal(addressWith('/complychat', '?q=hello&c=abc', { q: null }), '/complychat?c=abc');
  assert.equal(addressWith('/complychat', '?x=1', { c: 'new1' }), '/complychat?x=1&c=new1');
  assert.equal(addressWith('/complychat', '?c=old', { c: null }), '/complychat');
  assert.equal(addressWith('/complychat', '', { q: null }), '/complychat');
});
