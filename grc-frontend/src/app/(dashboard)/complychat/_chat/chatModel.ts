// The chat's data and the rules that act on it, as pure functions so `node --test` pins them (chatModel.test.ts): what a stored chat is read as (and
// repaired to), how chats are grouped and titled, what history goes to the server, how a "more results" page is appended, and how the address is
// read and cleaned. The page (ChatPage.tsx, useChat.ts) only carries these out. Relative imports with .ts: node runs this file as it is.
//
// Compatibility: the chats are kept in the browser under the keys of chatStore.ts, which the Cyber Assurance copy of this page (not ours) reads and
// writes too. Everything added here is an OPTIONAL field; nothing it reads is renamed or removed.

export type Outcome = 'answer' | 'no_data' | 'failed' | 'blocked';

/** What the server sends for a source; every field is kept as it arrived (the older page reads framework_code, control_code and the score). */
export interface ChatSource {
  rank?: number;
  entity_type?: string;
  entity_id?: string | null;
  framework_code?: string;
  control_code?: string | null;
  control_name?: string | null;
  relevance_score?: number;
  snippet?: string;
  kind?: string;
  label?: string | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  /** how an assistant message ended; absent in chats kept before it existed (read as an answer) */
  outcome?: Outcome;
  /** blocked: the guard's own sentence; failed: why, in words */
  reason?: string;
  sources?: ChatSource[];
  hasMore?: boolean;
  totalCount?: number;
  currentOffset?: number;
  /** the question an answer belongs to: Retry and "load more" ask it again */
  originalQuestion?: string;
  /** failed: false when asking again cannot help (signed out, no access); absent means it can */
  retryable?: boolean;
}

/** A file that is part of the chat. Only what the page shows is kept: not the server's path, not the text it read from the file. */
export interface AttachedFile { id: string; filename: string; size?: number; content_type?: string; uploaded_at?: string }

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt?: Date;
  attachments?: AttachedFile[];
}

export const NEW_CHAT_TITLE = 'New chat';
export const MAX_CHATS = 50;
export const MAX_MESSAGES = 200;
export const PAGE_SIZE = 10;
/** the page asks the server for at most this long (ms) before it says the answer is taking too long */
export const ASK_TIMEOUT_MS = 120_000;
/** question that stands in for an empty box when files are attached */
export const FILES_ONLY_QUESTION = 'Please analyze the uploaded files and summarize the key GRC-relevant information.';
const UPLOAD_PREFIX = /^Uploaded files: [^\n]*\n\n/;
/** what chats kept before this version showed for any failure (they get Retry now) */
const OLD_APOLOGY = 'Sorry for the inconvenience, Something went wrong on our end. Please try again Later.';
export const UNFINISHED = 'This answer did not finish.';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const date = (v: unknown, fallback: Date): Date => {
  const d = new Date(typeof v === 'string' || typeof v === 'number' ? v : NaN);
  return Number.isNaN(d.getTime()) ? fallback : d;
};

let seq = 0;
/** A new id; the counter keeps two made in one millisecond apart. */
export function newId(now: number = Date.now()): string {
  seq = (seq + 1) % 1_000_000;
  return `${now}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newConversation(now: Date = new Date(), id: string = newId(now.getTime())): Conversation {
  return { id, title: NEW_CHAT_TITLE, messages: [], createdAt: now, updatedAt: now, attachments: [] };
}

// ── the question of a message ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The question as the person typed it: the visible user message adds "Uploaded files: a, b" in front when files went with it. */
export function questionOf(content: string): string {
  return content.replace(UPLOAD_PREFIX, '').trim();
}

/** The title of a chat from its first question: one line, at most 50 characters. */
export function titleOf(question: string): string {
  const one = questionOf(question).replace(/\s+/g, ' ').trim();
  if (!one) return NEW_CHAT_TITLE;
  return one.length <= 50 ? one : `${one.slice(0, 49).replace(/[\uD800-\uDBFF]$/, '').trimEnd()}…`;
}

// ── reading what was kept ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function readFile(v: unknown): AttachedFile | null {
  if (!isRecord(v)) return null;
  const filename = text(v.filename);
  if (!filename) return null;
  return { id: text(v.id, filename), filename, size: count(v.size), content_type: text(v.content_type) || undefined, uploaded_at: text(v.uploaded_at) || undefined };
}

function readMessage(v: unknown, now: Date): ChatMessage | null {
  if (!isRecord(v)) return null;
  const role = v.role === 'assistant' ? 'assistant' : 'user';
  const outcome = v.outcome === 'no_data' || v.outcome === 'failed' || v.outcome === 'blocked' || v.outcome === 'answer' ? v.outcome : undefined;
  return {
    id: text(v.id) || newId(),
    role,
    content: text(v.content),
    timestamp: date(v.timestamp, now),
    isLoading: v.isLoading === true || undefined,
    outcome,
    reason: text(v.reason) || undefined,
    sources: Array.isArray(v.sources) ? (v.sources.filter(isRecord) as ChatSource[]) : undefined,
    hasMore: typeof v.hasMore === 'boolean' ? v.hasMore : undefined,
    totalCount: count(v.totalCount),
    currentOffset: count(v.currentOffset),
    originalQuestion: text(v.originalQuestion) || undefined,
    retryable: typeof v.retryable === 'boolean' ? v.retryable : undefined,
  };
}

/** A message the page left "loading" (the tab closed mid-answer) or an old apology becomes a failed answer with Retry. */
function repaired(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m, i) => {
    const unfinished = m.role === 'assistant' && m.isLoading;
    const apology = m.role === 'assistant' && !m.outcome && m.content === OLD_APOLOGY;
    if (!unfinished && !apology) return m.isLoading ? { ...m, isLoading: undefined } : m;
    const before = messages.slice(0, i).reverse().find((x) => x.role === 'user');
    return { ...m, isLoading: undefined, outcome: 'failed', content: UNFINISHED, reason: unfinished ? undefined : 'Comply Agent could not answer this.', originalQuestion: m.originalQuestion ?? (before ? questionOf(before.content) : undefined) };
  });
}

/** What was kept in the browser, as chats: anything that is not a chat is dropped, a chat with nothing in it is dropped, a message left loading is
 *  a failed one, newest activity first. Never throws. */
export function readChats(raw: string | null | undefined, now: Date = new Date()): Conversation[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const chats: Conversation[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const messages = repaired((Array.isArray(item.messages) ? item.messages : []).map((m) => readMessage(m, now)).filter((m): m is ChatMessage => !!m));
    const attachments = (Array.isArray(item.attachments) ? item.attachments : []).map(readFile).filter((f): f is AttachedFile => !!f);
    if (messages.length === 0 && attachments.length === 0) continue;
    let id = text(item.id) || newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    const createdAt = date(item.createdAt, now);
    chats.push({ id, title: text(item.title).trim() || titleOf(questionOf(messages.find((m) => m.role === 'user')?.content ?? '')), messages, createdAt, updatedAt: item.updatedAt === undefined ? undefined : date(item.updatedAt, createdAt), attachments });
  }
  return chats.sort((a, b) => lastActivity(b).getTime() - lastActivity(a).getTime());
}

/** What is kept: chats with something in them, a message still loading left out (it is a failed one when read back). */
export function chatsToKeep(chats: readonly Conversation[]): Conversation[] {
  return chats
    .filter((c) => c.messages.some((m) => !m.isLoading) || (c.attachments?.length ?? 0) > 0)
    .map((c) => ({ ...c, messages: c.messages.filter((m) => !m.isLoading) }));
}

export function lastActivity(c: Conversation): Date {
  const last = c.messages.length ? c.messages[c.messages.length - 1].timestamp : undefined;
  const at = [c.updatedAt, last, c.createdAt].filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
  return at.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b), c.createdAt);
}

export interface Trimmed { chats: Conversation[]; droppedChats: number; droppedMessages: number }

/** At most MAX_CHATS chats (the least recently used go first) and MAX_MESSAGES messages in each (the oldest go first). */
export function trimChats(chats: readonly Conversation[], maxChats = MAX_CHATS, maxMessages = MAX_MESSAGES): Trimmed {
  let droppedMessages = 0;
  const cut = chats.map((c) => {
    if (c.messages.length <= maxMessages) return c;
    droppedMessages += c.messages.length - maxMessages;
    return { ...c, messages: c.messages.slice(-maxMessages) };
  });
  const byUse = cut.slice().sort((a, b) => lastActivity(b).getTime() - lastActivity(a).getTime());
  const kept = new Set(byUse.slice(0, maxChats).map((c) => c.id));
  return { chats: cut.filter((c) => kept.has(c.id)), droppedChats: Math.max(0, cut.length - maxChats), droppedMessages };
}

// ── the list of chats ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ChatGroup { label: 'Today' | 'Yesterday' | 'Earlier'; items: Conversation[] }

const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Chats by the day of their last message, most recent first; a group with no chats is left out. */
export function groupChats(chats: readonly Conversation[], now: Date = new Date()): ChatGroup[] {
  const today = dayStart(now);
  const groups: ChatGroup[] = [{ label: 'Today', items: [] }, { label: 'Yesterday', items: [] }, { label: 'Earlier', items: [] }];
  for (const c of chats.slice().sort((a, b) => lastActivity(b).getTime() - lastActivity(a).getTime())) {
    const day = dayStart(lastActivity(c));
    groups[day >= today ? 0 : day >= today - 86_400_000 ? 1 : 2].items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
}

/** "3 messages", "1 message" */
export function messageCount(c: Conversation): string {
  const n = c.messages.filter((m) => !m.isLoading).length;
  return `${n} ${n === 1 ? 'message' : 'messages'}`;
}

/** "14:05", the 24-hour clock of the viewer (the platform's way of writing a time: lib/format.ts). */
export function clockTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── what goes to the server ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The last `limit` turns, as the server wants them. A turn that failed or was refused is left out together with its question: it holds no answer, and a
 *  refused question holds what the guard keeps out of the AI. Messages still loading are never sent. */
export function historyFor(messages: readonly ChatMessage[], limit = 10): { role: 'user' | 'assistant'; content: string }[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.isLoading) continue;
    if (m.role === 'assistant' && (m.outcome === 'failed' || m.outcome === 'blocked')) {
      if (out.length && out[out.length - 1].role === 'user') out.pop();
      continue;
    }
    out.push(m);
  }
  return out.slice(-limit).map((m) => ({ role: m.role, content: m.content }));
}

/** "Load more" appends the next page under a divider, so one answer does not run its pages together. */
export function mergeMore(content: string, more: string, from: number, to: number, total?: number): string {
  const range = total && total > 0 ? `Results ${from}-${to} of ${total}` : `Results ${from}-${to}`;
  return `${content.trimEnd()}\n\n---\n\n**${range}**\n\n${more.trim()}`;
}

/** How many results are on screen after a page: never more than there are. */
export function shownCount(offset: number, pageSize: number, total: number | undefined): number {
  const shown = offset + pageSize;
  return total && total > 0 ? Math.min(shown, total) : shown;
}

/** How many results an answer has shown so far (its next page starts there), never more than it has. */
export function shownSoFar(m: Pick<ChatMessage, 'currentOffset' | 'totalCount'>): number {
  const next = m.currentOffset ?? PAGE_SIZE;
  return m.totalCount && m.totalCount > 0 ? Math.min(next, m.totalCount) : next;
}

/** The offset the NEXT page starts at, from what the server said about this one. */
export function nextOffset(serverOffset: number | undefined, fallbackOffset: number, pageSize = PAGE_SIZE): number {
  return (typeof serverOffset === 'number' ? serverOffset : fallbackOffset) + pageSize;
}

// ── the address ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The longest question a link may carry; the top bar's box has no limit of its own, a crafted link must not send a book. */
export const MAX_QUESTION_LINK = 2000;

/** The question in `?q=`, trimmed and cut, or null. */
export function questionFromAddress(search: string): string | null {
  const q = new URLSearchParams(search).get('q');
  const one = (q ?? '').trim();
  return one ? one.slice(0, MAX_QUESTION_LINK) : null;
}

/** The address without `q` (and `c` too when `chat` is given a value or null to drop it): what `history.replaceState` is given once the question is taken. */
export function addressWith(pathname: string, search: string, changes: { q?: null; c?: string | null }): string {
  const params = new URLSearchParams(search);
  if ('q' in changes) params.delete('q');
  if ('c' in changes) { if (changes.c) params.set('c', changes.c); else params.delete('c'); }
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
