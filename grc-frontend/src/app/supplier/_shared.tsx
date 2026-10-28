'use client';

// The supplier portal's shared pieces: the home (the first page loaded records the
// visit), the frame of its pages, and the screen for a link that no longer works, with
// the form that asks for a new one. No sign-in: the personal link is the key.

import { useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Lock, Mail } from 'lucide-react';
import apiClient from '@/lib/api';
import { parseUtc } from '@/lib/serverTime';

export interface PortalQuestionnaire {
  id: number; title: string; status: string; due_date: string | null; sent_at: string | null;
  expires_at: string | null; submitted_at: string | null; progress: { answered: number; total: number };
  returned_questions: number; open: boolean;
}

export interface PortalHome {
  organisation: { name: string | null }; supplier: { name: string }; contact: { name: string; email: string | null };
  expires_at: string; questionnaires: PortalQuestionnaire[];
  requests: unknown[]; messages: { unread: number };            // filled by the next piece of work
}

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
