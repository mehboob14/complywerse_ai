'use client';

// The supplier portal's shared pieces: the home (the first page loaded records the
// visit), the frame of its pages, the screen for a link that no longer works, with
// the form that asks for a new one, and a conversation with us. No sign-in: the
// personal link is the key.

import { useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Lock, Mail, Send } from 'lucide-react';
import apiClient from '@/lib/api';
import { parseUtc } from '@/lib/serverTime';

export interface PortalQuestionnaire {
  id: number; title: string; status: string; due_date: string | null; sent_at: string | null;
  expires_at: string | null; submitted_at: string | null; progress: { answered: number; total: number };
  returned_questions: number; open: boolean;
}

export type RequestStatus = 'open' | 'submitted' | 'returned' | 'accepted' | 'cancelled';

export interface PortalRequest {
  id: number; kind: 'document' | 'finding' | 'information'; title: string; detail: string | null;
  evidence_label: string | null; due_date: string | null; overdue: boolean; status: RequestStatus;
  open: boolean;                                                  // the supplier can still work on it
  requested_at: string; responded_at: string | null; review_note: string | null;
  file_count?: number; unread?: number;                           // on the home
}

export interface PortalMessage { id: number; from_supplier: boolean; author: string | null; body: string; created_at: string }

export interface PortalHome {
  organisation: { name: string | null }; supplier: { name: string }; contact: { name: string; email: string | null };
  expires_at: string; questionnaires: PortalQuestionnaire[];
  requests: PortalRequest[];
  messages: { unread: number; latest: PortalMessage[] };         // the supplier's own thread with us
}

export const REQUEST_KIND: Record<PortalRequest['kind'], string> = {
  document: 'Document', information: 'Information', finding: 'Finding to fix',
};
export const REQUEST_STATUS: Record<RequestStatus, string> = {
  open: 'To answer', returned: 'Returned to you', submitted: 'Sent', accepted: 'Accepted', cancelled: 'Withdrawn',
};

export const WAITING = ['pending', 'in_progress', 'returned'];
const BUSY = 'Too many requests. Wait a few minutes and try again.';

// One recorded visit per page load: moving between the portal's pages afterwards only reads.
const opened = new Set<string>();

export async function fetchHome(token: string): Promise<PortalHome> {
  const path = `/vendor-risk/portal/${encodeURIComponent(token)}`;
  if (opened.has(token)) return (await apiClient.get(path)).data as PortalHome;
  opened.add(token);
  return (await apiClient.post(`${path}/open`)).data as PortalHome;
}

export function problemOf(e: unknown): { gone: boolean; message: string } {
  const res = (e as { response?: { status?: number; data?: { detail?: string } } })?.response;
  if (res?.status === 404 || res?.status === 410) {
    return { gone: true, message: res.data?.detail || 'This link is no longer valid. Ask your contact for a new one, or request one below.' };
  }
  return { gone: false, message: res?.status === 429 ? BUSY : 'The portal could not be reached. Try again in a moment.' };
}

export const day = (value: string | null | undefined) =>
  parseUtc(value)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) ?? '';

/** A date with no time ("2026-11-30") as the day it names, wherever the reader is. */
export const dateOnly = (value: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
};

export const detailOf = (e: unknown, fallback = 'That did not go through. Try again.') => {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

/** The supplier's conversation with us: its own thread, or one request's. */
export function Conversation({ token, requestId, initial }: { token: string; requestId?: number; initial: PortalMessage[] }) {
  const [messages, setMessages] = useState(initial);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/vendor-risk/portal/${encodeURIComponent(token)}/messages`;
  const thread = requestId ? { subject_type: 'request', subject_id: requestId } : { subject_type: 'vendor' };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(path, { ...thread, body });
      setMessages((await apiClient.get(path, { params: thread })).data.items as PortalMessage[]);
      setBody('');
    } catch (err) {
      setError(detailOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {messages.length === 0 ? (
        <p className="text-sm text-gray-600">No messages yet.</p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li key={m.id} className={`rounded-xl border px-3 py-2 ${m.from_supplier ? 'ml-6 border-primary-100 bg-primary-50' : 'mr-6 border-gray-200 bg-white'}`}>
              <p className="text-xs text-gray-600">
                <span className="font-medium text-gray-800">{m.author || (m.from_supplier ? 'You' : 'Us')}</span> · {day(m.created_at)}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-900">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send} className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Write to us
          <textarea rows={3} maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" />
        </label>
        <button type="submit" disabled={busy || !body.trim()}
          className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
        </button>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </form>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">{children}</div>
    </main>
  );
}

export function Loading() {
  return (
    <p className="mt-16 flex items-center justify-center gap-2 text-sm text-gray-600">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </p>
  );
}

export function RequestLinkForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSent((await apiClient.post('/vendor-risk/portal/request-link', { email })).data?.message);
    } catch (err) {
      setError((err as { response?: { status?: number } })?.response?.status === 429 ? BUSY : 'That did not go through. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{sent}</p>;
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        Your email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100" />
      </label>
      <button type="submit" disabled={busy}
        className="cw-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold disabled:opacity-60 sm:w-auto">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Get a new link
      </button>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </form>
  );
}

export function LinkGone({ message }: { message: string }) {
  return (
    <Shell>
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-2 text-gray-900">
          <Lock className="h-5 w-5 text-gray-500" />
          <h1 className="text-lg font-semibold">Link not valid</h1>
        </div>
        <p role="alert" className="mt-2 text-sm text-gray-700">{message}</p>
        <div className="mt-6"><RequestLinkForm /></div>
      </div>
    </Shell>
  );
}
