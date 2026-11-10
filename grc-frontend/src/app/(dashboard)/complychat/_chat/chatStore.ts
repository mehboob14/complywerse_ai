// Where the chats are kept: this browser's localStorage, under the keys the Cyber Assurance copy of the page uses too. Every access is guarded
// (a private window, blocked site data or a full quota throws), the store never grows without a bound (chatModel.trimChats), and when it does not
// fit the least recently used chats are dropped until it does: the page is told how many, and says so. `storage` is injected so `node --test` can fail it.
import { chatsToKeep, readChats, trimChats, type Conversation } from './chatModel.ts';

export const CONVERSATION_STORAGE_KEY = 'complychat.conversations.v2';
export const ACTIVE_CHAT_STORAGE_KEY = 'complychat.activeConversation.v2';

export type StoreLike = Pick<Storage, 'getItem' | 'setItem'>;

/** The browser's storage, or null when it cannot be used at all. */
export function browserStorage(): StoreLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = '__complychat_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface Loaded { chats: Conversation[]; activeId: string; available: boolean }

export function loadChats(storage: StoreLike | null, now: Date = new Date()): Loaded {
  if (!storage) return { chats: [], activeId: '', available: false };
  try {
    return { chats: readChats(storage.getItem(CONVERSATION_STORAGE_KEY), now), activeId: storage.getItem(ACTIVE_CHAT_STORAGE_KEY) ?? '', available: true };
  } catch {
    return { chats: [], activeId: '', available: false };
  }
}

export interface Saved {
  /** false when nothing could be kept (no storage, or not even one chat fits) */
  kept: boolean;
  droppedChats: number;
  droppedMessages: number;
}

const lastTime = (c: Conversation): number => (c.messages.length ? c.messages[c.messages.length - 1].timestamp.getTime() : c.createdAt.getTime());

/** Keeps the chats; drops the oldest chats while the browser refuses (at most `tries` times). Never throws. */
export function saveChats(storage: StoreLike | null, chats: readonly Conversation[], activeId: string, tries = 6): Saved {
  if (!storage) return { kept: false, droppedChats: 0, droppedMessages: 0 };
  const trimmed = trimChats(chatsToKeep(chats));
  let list = trimmed.chats;
  let droppedChats = trimmed.droppedChats;
  for (let attempt = 0; attempt <= tries; attempt += 1) {
    try {
      storage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(list));
      if (activeId) storage.setItem(ACTIVE_CHAT_STORAGE_KEY, activeId);
      return { kept: list.length > 0 || trimmed.chats.length === 0, droppedChats, droppedMessages: trimmed.droppedMessages };   // an empty list after dropping every chat kept nothing
    } catch {
      if (list.length === 0) break;
      const oldest = list.slice().sort((a, b) => lastTime(a) - lastTime(b))[0];
      list = list.filter((c) => c.id !== oldest.id);          // the least recently used goes first
      droppedChats += 1;
    }
  }
  return { kept: false, droppedChats, droppedMessages: trimmed.droppedMessages };
}
