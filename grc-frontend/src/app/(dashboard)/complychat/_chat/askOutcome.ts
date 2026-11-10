// What a request to Comply Agent came back as, in the words a person reads: the answer the server sent (plain, a refusal by the data-protection guard, a
// failure the server already described), or why no answer came (stopped, too slow, the network, signed out, not available) and whether trying again can
// help. Pure, so `node --test` pins every status (askOutcome.test.ts); chatApi.ts only turns a fetch into these inputs.
import { safeDetail } from '../../../../lib/apiError.ts';
import type { ChatSource, Outcome } from './chatModel.ts';

export type FailureCode = 'stopped' | 'timeout' | 'network' | 'signin' | 'forbidden' | 'unavailable' | 'busy' | 'server' | 'refusedInput' | 'empty';

export interface Failure { code: FailureCode; message: string; retry: boolean }

export interface AnswerData {
  answer: string;
  outcome: Outcome;
  /** blocked: the guard's own sentence */
  reason?: string;
  sources: ChatSource[];
  hasMore: boolean;
  totalCount?: number;
  currentOffset?: number;
}

export type AskResult = { kind: 'answer'; data: AnswerData } | { kind: 'failed'; failure: Failure };

/** The headline of a refusal the page has to write itself (a 403 from the guard's handler carries only the reason). */
export const REFUSED_HEADLINE = 'This question includes information that is not sent to the AI.';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const detailOf = (body: unknown): string => (isRecord(body) && typeof body.detail === 'string' ? safeDetail(body.detail) : '');

/** The server's answer to /ask as the page keeps it; null when it is not usable (no answer text). */
export function readAnswer(body: unknown): AnswerData | null {
  if (!isRecord(body) || typeof body.answer !== 'string' || !body.answer.trim()) return null;
  const outcome: Outcome = body.outcome === 'no_data' || body.outcome === 'failed' || body.outcome === 'blocked' ? body.outcome : 'answer';
  const blocked = isRecord(body.blocked) && typeof body.blocked.reason === 'string' ? safeDetail(body.blocked.reason) : '';
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  return {
    answer: body.answer,
    outcome,
    reason: outcome === 'blocked' ? blocked || undefined : undefined,
    sources: Array.isArray(body.sources) ? (body.sources.filter(isRecord) as ChatSource[]) : [],
    hasMore: body.has_more === true,
    totalCount: count(body.total_count),
    currentOffset: count(body.current_offset),
  };
}

export interface HttpInput {
  /** the HTTP status; undefined when no answer came at all */
  status?: number;
  body?: unknown;
  /** the person pressed Stop */
  stopped?: boolean;
  /** the page gave up waiting */
  timedOut?: boolean;
}

export type Kind = 'ask' | 'upload' | 'delete';

const WORDS: Record<FailureCode, string> = {
  stopped: 'You stopped this answer.',
  timeout: 'Comply Agent took too long to answer.',
  network: "Couldn't reach Comply Agent. Check your connection and try again.",
  signin: 'Your session has ended. Sign in again, then try again.',
  forbidden: "You don't have access to Comply Agent.",
  unavailable: 'Comply Agent is not available right now. Try again in a moment.',
  busy: 'Comply Agent is busy. Wait a moment and try again.',
  server: 'Something went wrong on our side. Your question was not answered.',
  refusedInput: 'Comply Agent could not take that.',
  empty: 'Comply Agent sent back nothing. Try again.',
};
const BY_KIND: Partial<Record<Kind, Partial<Record<FailureCode, string>>>> = {
  upload: { network: "Couldn't upload the files. Check your connection and try again.", server: "The files couldn't be uploaded. Try again.", unavailable: "The files couldn't be uploaded right now. Try again in a moment." },
  delete: { network: "Couldn't delete this chat. Check your connection and try again.", server: "Couldn't delete this chat. Try again.", unavailable: "Couldn't delete this chat's files yet. Nothing was deleted: try again in a moment." },
};

const failure = (kind: Kind, code: FailureCode, retry: boolean, said = ''): Failure => ({ code, retry, message: said || BY_KIND[kind]?.[code] || WORDS[code] });

/** Why no answer came (or what the server refused) as one failure; a refusal by the guard is an answer (see `resultFor`), not a failure. */
export function failureFor(kind: Kind, { status, body, stopped, timedOut }: HttpInput): Failure {
  if (stopped) return failure(kind, 'stopped', true);
  if (timedOut) return failure(kind, 'timeout', true);
  if (status === undefined) return failure(kind, 'network', true);
  if (status === 401) return failure(kind, 'signin', false);
  if (status === 403) return failure(kind, 'forbidden', false);
  if (status === 429) return failure(kind, 'busy', true);
  if (status === 503) return failure(kind, 'unavailable', true, kind === 'delete' ? detailOf(body) : '');
  if (status >= 500) return failure(kind, 'server', true);
  return failure(kind, 'refusedInput', false, kind === 'upload' || kind === 'delete' ? detailOf(body) : '');
}

/** The result of /ask from what came back. A 200 carries the answer (or the server's own failure or refusal); a 403 from the guard's handler is a refusal. */
export function resultFor(input: HttpInput): AskResult {
  const { status, body } = input;
  if (status !== undefined && status >= 200 && status < 300) {
    const data = readAnswer(body);
    return data ? { kind: 'answer', data } : { kind: 'failed', failure: failure('ask', 'empty', true) };
  }
  if (status === 403 && isRecord(body) && body.code === 'ai_blocked') {
    return { kind: 'answer', data: { answer: REFUSED_HEADLINE, outcome: 'blocked', reason: detailOf(body) || undefined, sources: [], hasMore: false } };
  }
  return { kind: 'failed', failure: failureFor('ask', input) };
}
