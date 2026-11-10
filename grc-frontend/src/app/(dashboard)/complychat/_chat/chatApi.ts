// The three requests the chat makes. Each turns a fetch into the plain inputs of askOutcome.ts (a status, a body, "stopped", "timed out") and never
// throws: the words and the Retry decision live in askOutcome.ts, where `node --test` pins them. The routes keep the name ComplyChat (the page and the
// API are called Comply Agent on screen only). Chat content is never logged here.
import { getTenantSlug } from '@/lib/api';
import { failureFor, resultFor, type AskResult, type Failure } from './askOutcome';
import { ASK_TIMEOUT_MS } from './chatModel';

const BASE = '/api/ai/complychat';

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = typeof window === 'undefined' ? '' : window.localStorage.getItem('token') || '';
  const tenant = getTenantSlug();
  return { Authorization: `Bearer ${token}`, ...(tenant ? { 'X-Tenant-Slug': tenant } : {}), ...extra };
}

/** One question in flight: Stop ends it, and so does the time limit; `finish` clears the timer. */
export interface AskControl {
  readonly signal: AbortSignal;
  readonly stopped: boolean;
  readonly timedOut: boolean;
  stop: () => void;
  finish: () => void;
}

export function createAskControl(timeoutMs: number = ASK_TIMEOUT_MS): AskControl {
  const controller = new AbortController();
  let stopped = false;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  return {
    signal: controller.signal,
    get stopped() { return stopped; },
    get timedOut() { return timedOut; },
    stop: () => { stopped = true; controller.abort(); },
    finish: () => clearTimeout(timer),
  };
}

async function send(url: string, init: RequestInit): Promise<{ status?: number; body?: unknown }> {
  try {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...init });
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }     // an HTML error page or an empty body: only the status counts
    return { status: response.status, body };
  } catch {
    return {};                                                              // no answer: the network, or Stop, or the time limit
  }
}

export interface AskInput {
  message: string;
  sessionId: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  offset: number;
  limit: number;
}

export async function askQuestion(input: AskInput, control: AskControl): Promise<AskResult> {
  const got = await send(`${BASE}/ask`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-cache, no-store, must-revalidate' }),
    body: JSON.stringify({ message: input.message, framework: null, include_sources: true, session_id: input.sessionId, history: input.history, limit: input.limit, offset: input.offset }),
    signal: control.signal,
  });
  control.finish();
  if (got.status === undefined) return { kind: 'failed', failure: failureFor('ask', { stopped: control.stopped, timedOut: control.timedOut }) };
  return resultFor(got);
}

export interface Uploaded { id: string; filename: string; size?: number; content_type?: string; uploaded_at?: string }

/** The files go to the chat's session; only what the page shows comes back (not the server's path, not the text read from the file). */
export async function uploadFiles(sessionId: string, files: File[]): Promise<{ files: Uploaded[] } | { failure: Failure }> {
  const form = new FormData();
  form.append('session_id', sessionId);
  files.forEach((file) => form.append('files', file));
  const got = await send(`${BASE}/upload`, { method: 'POST', headers: headers(), body: form });
  if (got.status === undefined || got.status < 200 || got.status >= 300) return { failure: failureFor('upload', got) };
  const items = got.body && typeof got.body === 'object' && Array.isArray((got.body as { uploaded_files?: unknown }).uploaded_files) ? ((got.body as { uploaded_files: Record<string, unknown>[] }).uploaded_files) : [];
  return { files: items.map((f) => ({ id: String(f.id ?? f.filename ?? ''), filename: String(f.filename ?? ''), size: typeof f.size === 'number' ? f.size : undefined, content_type: typeof f.content_type === 'string' ? f.content_type : undefined, uploaded_at: typeof f.uploaded_at === 'string' ? f.uploaded_at : undefined })).filter((f) => f.filename) };
}

/** Deletes the chat's memory and files on the server. `ok: false` carries why; a chat that never used the server answers ok at once. */
export async function clearHistory(sessionId: string): Promise<{ ok: true } | { ok: false; failure: Failure }> {
  const got = await send(`${BASE}/history/${encodeURIComponent(sessionId)}`, { method: 'DELETE', headers: headers() });
  return got.status !== undefined && got.status >= 200 && got.status < 300 ? { ok: true } : { ok: false, failure: failureFor('delete', got) };
}
