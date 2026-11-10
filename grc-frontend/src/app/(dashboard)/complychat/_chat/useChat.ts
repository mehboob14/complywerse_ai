'use client';

// The chats and what happens to them: kept in this browser (chatStore.ts), asked one question at a time (a second send while an answer is coming is
// refused, Stop ends the one in flight), every request ending as a message the person can read (askOutcome.ts), Retry asking the same question again in
// place. State is held in a ref as well as in React so that a question asked the moment the page opens (`?q=`) or a suggestion pressed sees the chats as
// they are now, not as they were at the last render. The rules are pure and tested (chatModel.ts, askOutcome.ts, chatStore.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConfirmOptions } from '@/components/ui/ds/useConfirm';
import type { Notify } from '@/components/ui/ds/useNotify';
import { askQuestion, clearHistory, createAskControl, uploadFiles, type AskControl } from './chatApi';
import { browserStorage, loadChats, saveChats, type StoreLike } from './chatStore';
import {
  FILES_ONLY_QUESTION, historyFor, lastActivity, mergeMore, nextOffset, newConversation, newId, PAGE_SIZE, questionOf, shownCount, titleOf,
  type ChatMessage, type Conversation,
} from './chatModel';
import type { Failure } from './askOutcome';

export interface Submitted { accepted: true }
export interface NotSubmitted { accepted: false; message: string }

export interface StoreNote {
  /** the browser cannot keep chats at all (a private window, blocked site data) */
  unavailable: boolean;
  /** it kept fewer than there are (the quota): how many chats were left out */
  droppedChats: number;
  droppedMessages: number;
}

type Target = { kind: 'new'; userContent: string } | { kind: 'replace'; messageId: string } | { kind: 'more'; messageId: string };

const failedMessage = (failure: Failure): Partial<ChatMessage> => ({ outcome: 'failed', content: failure.message, retryable: failure.retry });

export function useChat({ confirm, notify }: { confirm: (o: ConfirmOptions) => Promise<boolean>; notify: Notify }) {
  const [chats, setChats] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [ready, setReady] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [flight, setFlight] = useState<{ conversationId: string; messageId: string } | null>(null);
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [note, setNote] = useState<StoreNote>({ unavailable: false, droppedChats: 0, droppedMessages: 0 });

  const chatsRef = useRef<Conversation[]>([]);
  const activeRef = useRef('');
  const busyRef = useRef(false);
  const controlRef = useRef<AskControl | null>(null);
  const storeRef = useRef<StoreLike | null>(null);
  const loadMoreRef = useRef<(conversationId: string, messageId: string) => void>(() => undefined);

  const commit = useCallback((update: (prev: Conversation[]) => Conversation[]) => {
    chatsRef.current = update(chatsRef.current);
    setChats(chatsRef.current);
  }, []);
  const select = useCallback((id: string) => { activeRef.current = id; setActiveId(id); }, []);
  const patchChat = useCallback((id: string, change: (c: Conversation) => Conversation) => {
    commit((prev) => prev.map((c) => (c.id === id ? { ...change(c), updatedAt: new Date() } : c)));
  }, [commit]);
  const patchMessage = useCallback((conversationId: string, messageId: string, change: (m: ChatMessage) => ChatMessage) => {
    patchChat(conversationId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId ? change(m) : m)) }));
  }, [patchChat]);

  // ── the chats kept in this browser (read once, on the client: the server cannot know them) ──
  useEffect(() => {
    const store = browserStorage();
    storeRef.current = store;
    const loaded = loadChats(store);
    const fresh = newConversation();
    const keep = loaded.chats.some((c) => c.id === loaded.activeId) ? loaded.activeId : '';
    chatsRef.current = keep ? loaded.chats : [fresh, ...loaded.chats];
    setChats(chatsRef.current);
    select(keep || fresh.id);
    setNote((n) => ({ ...n, unavailable: !loaded.available }));
    setReady(true);
  }, [select]);

  useEffect(() => {
    if (!ready) return;
    const saved = saveChats(storeRef.current, chats, activeId);
    const unavailable = !storeRef.current || !saved.kept;
    setNote((n) => (n.unavailable === unavailable && n.droppedChats === saved.droppedChats && n.droppedMessages === saved.droppedMessages ? n : { unavailable, droppedChats: saved.droppedChats, droppedMessages: saved.droppedMessages }));
  }, [ready, chats, activeId]);

  const active = useMemo(() => chats.find((c) => c.id === activeId) ?? chats[0], [chats, activeId]);

  // ── chats ──
  const startNew = useCallback((): string => {
    const empty = chatsRef.current.find((c) => c.messages.length === 0 && (c.attachments?.length ?? 0) === 0);
    if (empty) { select(empty.id); return empty.id; }
    const fresh = newConversation();
    commit((prev) => [fresh, ...prev]);
    select(fresh.id);
    return fresh.id;
  }, [commit, select]);

  const rename = useCallback((id: string, title: string) => {
    const clean = title.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (clean) patchChat(id, (c) => ({ ...c, title: clean }));
  }, [patchChat]);

  const dropChat = useCallback((id: string) => {
    commit((prev) => prev.filter((c) => c.id !== id));
    if (activeRef.current === id) {
      const next = chatsRef.current.slice().sort((a, b) => lastActivity(b).getTime() - lastActivity(a).getTime())[0];
      if (next) select(next.id); else startNew();
    }
  }, [commit, select, startNew]);

  /** true when the chat is gone */
  const removeNow = useCallback(async (id: string): Promise<boolean> => {
    const chat = chatsRef.current.find((c) => c.id === id);
    if (!chat) return false;
    if (flight?.conversationId === id) controlRef.current?.stop();
    const hadFiles = (chat.attachments?.length ?? 0) > 0;
    const result = await clearHistory(id);
    if (!result.ok && hadFiles) {                  // the files are still on the server: the chat stays so the delete can be tried again
      notify.error(result.failure.message, { title: "Couldn't delete this chat", retry: result.failure.retry ? () => void removeNow(id) : undefined });
      return false;
    }
    dropChat(id);
    return true;
  }, [flight, notify, dropChat]);

  /** asks first when the chat holds anything; true when the chat is gone (false: kept, cancelled or the delete failed) */
  const remove = useCallback(async (id: string): Promise<boolean> => {
    const chat = chatsRef.current.find((c) => c.id === id);
    if (!chat) return false;
    const hasContent = chat.messages.length > 0 || (chat.attachments?.length ?? 0) > 0;
    if (hasContent) {
      const files = (chat.attachments?.length ?? 0) > 0;
      const ok = await confirm({
        title: 'Delete this chat?',
        message: files ? 'Its messages are removed from this browser and the files you attached are deleted from Comply Agent.' : 'Its messages are removed from this browser.',
        confirmLabel: 'Delete chat',
        tone: 'danger',
      });
      if (!ok) return false;
    }
    return removeNow(id);
  }, [confirm, removeNow]);

  // ── one request, whatever started it ──
  const perform = useCallback(async (conversationId: string, question: string, history: { role: 'user' | 'assistant'; content: string }[], offset: number, target: Target) => {
    const control = createAskControl();
    controlRef.current = control;
    busyRef.current = true;
    let messageId: string;
    if (target.kind === 'new') {
      const user: ChatMessage = { id: newId(), role: 'user', content: target.userContent, timestamp: new Date() };
      const loading: ChatMessage = { id: newId(), role: 'assistant', content: '', timestamp: new Date(), isLoading: true, originalQuestion: question };
      messageId = loading.id;
      patchChat(conversationId, (c) => ({ ...c, title: c.messages.length === 0 ? titleOf(question) : c.title, messages: [...c.messages, user, loading] }));
    } else if (target.kind === 'replace') {
      messageId = target.messageId;
      patchMessage(conversationId, messageId, (m) => ({ ...m, isLoading: true, content: '', outcome: undefined, reason: undefined, sources: undefined, hasMore: undefined, retryable: undefined, timestamp: new Date() }));
    } else {
      messageId = target.messageId;
      setMoreFor(messageId);
    }
    setFlight({ conversationId, messageId });

    const result = await askQuestion({ message: question, sessionId: conversationId, history, offset, limit: PAGE_SIZE }, control);
    busyRef.current = false;
    controlRef.current = null;
    setFlight(null);
    setMoreFor(null);

    if (target.kind === 'more') {
      if (result.kind === 'answer' && (result.data.outcome === 'answer' || result.data.outcome === 'no_data')) {
        const data = result.data;
        patchMessage(conversationId, messageId, (m) => {
          const total = data.totalCount ?? m.totalCount;
          return { ...m, content: mergeMore(m.content, data.answer, offset + 1, shownCount(offset, PAGE_SIZE, total), total), hasMore: data.hasMore, totalCount: total, currentOffset: nextOffset(data.currentOffset, offset) };
        });
      } else {
        const why = result.kind === 'failed' ? result.failure.message : result.data.answer;
        notify.error(why, { title: "Couldn't load more results", retry: result.kind === 'failed' && result.failure.retry ? () => loadMoreRef.current(conversationId, messageId) : undefined });
      }
      return;
    }
    patchMessage(conversationId, messageId, (m) => {
      const base = { ...m, isLoading: undefined, timestamp: new Date(), originalQuestion: question, hasMore: undefined, totalCount: undefined, currentOffset: undefined, sources: undefined, reason: undefined, retryable: undefined };
      if (result.kind === 'failed') return { ...base, ...failedMessage(result.failure) };
      const d = result.data;
      return {
        ...base,
        content: d.answer,
        outcome: d.outcome,
        reason: d.reason,
        retryable: d.outcome === 'failed' ? true : undefined,
        sources: d.sources,
        hasMore: d.hasMore || undefined,
        totalCount: d.totalCount,
        currentOffset: nextOffset(d.currentOffset, offset),
      };
    });
  }, [patchChat, patchMessage, notify]);

  const turnsBefore = (conversationId: string, messageId: string) => {
    const chat = chatsRef.current.find((c) => c.id === conversationId);
    const index = chat ? chat.messages.findIndex((m) => m.id === messageId) : -1;
    return { chat, index, message: index >= 0 && chat ? chat.messages[index] : undefined };
  };

  const retry = useCallback((conversationId: string, messageId: string) => {
    if (busyRef.current) return;
    const { chat, index, message } = turnsBefore(conversationId, messageId);
    if (!chat || !message) return;
    const question = message.originalQuestion ?? (index > 0 ? questionOf(chat.messages[index - 1].content) : '');
    if (!question) return;
    void perform(conversationId, question, historyFor(chat.messages.slice(0, Math.max(0, index - 1))), 0, { kind: 'replace', messageId });
  }, [perform]);

  const loadMore = useCallback((conversationId: string, messageId: string) => {
    if (busyRef.current) return;
    const { chat, index, message } = turnsBefore(conversationId, messageId);
    if (!chat || !message || !message.originalQuestion) return;
    void perform(conversationId, message.originalQuestion, historyFor(chat.messages.slice(0, Math.max(0, index - 1))), message.currentOffset ?? PAGE_SIZE, { kind: 'more', messageId });
  }, [perform]);
  loadMoreRef.current = loadMore;

  /** Asks `text` (with `files`) in a chat. Resolves once the question is taken (files uploaded, the question on screen); the answer follows by itself. */
  const submit = useCallback(async (conversationId: string, text: string, files: File[] = []): Promise<Submitted | NotSubmitted> => {
    if (busyRef.current) return { accepted: false, message: 'Wait for the answer to finish, or press Stop.' };
    let question = text.trim();
    if (!question && files.length === 0) return { accepted: false, message: 'Type a question first.' };
    busyRef.current = true;                                  // reserved while the files go up
    let uploaded: { filename: string }[] = [];
    if (files.length > 0) {
      setUploading(true);
      const sent = await uploadFiles(conversationId, files);
      setUploading(false);
      if ('failure' in sent) { busyRef.current = false; return { accepted: false, message: sent.failure.message }; }
      uploaded = sent.files;
      patchChat(conversationId, (c) => ({ ...c, attachments: [...(c.attachments ?? []), ...sent.files] }));
      if (!question) question = FILES_ONLY_QUESTION;
    }
    const chat = chatsRef.current.find((c) => c.id === conversationId);
    const history = historyFor(chat?.messages ?? []);
    const userContent = uploaded.length > 0 ? `Uploaded files: ${uploaded.map((f) => f.filename).join(', ')}\n\n${question}` : question;
    void perform(conversationId, question, history, 0, { kind: 'new', userContent });
    return { accepted: true };
  }, [patchChat, perform]);

  const stop = useCallback(() => controlRef.current?.stop(), []);

  return { ready, chats, active, activeId, select, startNew, rename, remove, submit, retry, loadMore, stop, uploading, flight, moreFor, note, busy: flight !== null || uploading };
}
