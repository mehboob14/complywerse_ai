// node --test "src/app/(dashboard)/complychat/_chat/chatStore.test.ts"
// The store never throws and never grows without a bound: a browser with no storage, a full quota and a damaged value are all survivable, the oldest chats
// go first, and what was written is what is read back (including by the older page, which reads the same keys).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ACTIVE_CHAT_STORAGE_KEY, CONVERSATION_STORAGE_KEY, loadChats, saveChats, type StoreLike } from './chatStore.ts';
import type { ChatMessage, Conversation } from './chatModel.ts';

const NOW = new Date(2026, 10, 10, 15, 30);
const msg = (role: 'user' | 'assistant', content: string, hoursAgo = 0): ChatMessage => ({ id: `${role}${content}`.slice(0, 20), role, content, timestamp: new Date(NOW.getTime() - hoursAgo * 3_600_000) });
const chat = (id: string, hoursAgo: number, size = 20): Conversation => ({ id, title: id, createdAt: new Date(NOW.getTime() - hoursAgo * 3_600_000), messages: [msg('user', `q-${id}`, hoursAgo), msg('assistant', 'x'.repeat(size), hoursAgo)], attachments: [] });

function memory(limit = Infinity): StoreLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) {
      const used = Array.from(data.entries()).filter(([key]) => key !== k).reduce((n, [, val]) => n + val.length, 0);
      if (used + v.length > limit) throw new DOMException('quota', 'QuotaExceededError');
      data.set(k, v);
    },
  };
}

test('no storage at all is not an error: nothing is loaded, nothing is kept, and the result says so', () => {
  assert.deepEqual(loadChats(null), { chats: [], activeId: '', available: false });
  assert.deepEqual(saveChats(null, [chat('a', 1)], 'a'), { kept: false, droppedChats: 0, droppedMessages: 0 });
});

test('a storage that throws on read is the same as none', () => {
  const broken: StoreLike = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loadChats(broken).available, false);
  assert.equal(saveChats(broken, [chat('a', 1)], 'a').kept, false);
});

test('what is saved is read back, under the keys the older page uses', () => {
  const store = memory();
  const saved = saveChats(store, [chat('a', 1), chat('b', 2)], 'b');
  assert.deepEqual(saved, { kept: true, droppedChats: 0, droppedMessages: 0 });
  assert.equal(CONVERSATION_STORAGE_KEY, 'complychat.conversations.v2');
  assert.equal(ACTIVE_CHAT_STORAGE_KEY, 'complychat.activeConversation.v2');
  const back = loadChats(store, NOW);
  assert.deepEqual(back.chats.map((c) => c.id), ['a', 'b']);
  assert.equal(back.activeId, 'b');
  assert.equal(back.available, true);
  assert.ok(back.chats[0].messages[0].timestamp instanceof Date);
});

test('a damaged value reads as no chats, not a crash', () => {
  const store = memory();
  store.setItem(CONVERSATION_STORAGE_KEY, '{broken');
  assert.deepEqual(loadChats(store, NOW).chats, []);
});

test('a chat with nothing in it is not kept (no clutter from New chat)', () => {
  const store = memory();
  saveChats(store, [chat('a', 1), { id: 'empty', title: 'New chat', createdAt: NOW, messages: [], attachments: [] }], 'empty');
  assert.deepEqual(loadChats(store, NOW).chats.map((c) => c.id), ['a']);
});

test('when the quota is full the least recently used chats go first until it fits, and the count is reported', () => {
  const store = memory(2000);
  const chats = [chat('newest', 1, 400), chat('middle', 5, 400), chat('oldest', 9, 400), chat('ancient', 20, 400)];
  const saved = saveChats(store, chats, 'newest');
  assert.equal(saved.kept, true);
  assert.ok(saved.droppedChats >= 1);
  const ids = loadChats(store, NOW).chats.map((c) => c.id);
  assert.ok(ids.includes('newest') && !ids.includes('ancient'), ids.join());
});

test('when not even one chat fits, nothing is kept and nothing throws', () => {
  const store = memory(10);
  const saved = saveChats(store, [chat('a', 1, 400)], 'a');
  assert.equal(saved.kept, false);
  assert.equal(saved.droppedChats, 1);
});
