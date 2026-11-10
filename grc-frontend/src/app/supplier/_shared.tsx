'use client';

// The supplier portal's shared pieces: the home (the first page loaded records the
// visit), the frame of its pages, the screen for a link that no longer works, with
// the form that asks for a new one, and a conversation with us. No sign-in: the
// personal link is the key.

import { useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, Lock, Mail, Send } from 'lucide-react';
import apiClient from '@/lib/api';
import { formatDate } from '@/lib/format';
import { PortalFrame } from '@/components/vendor-risk/supplier/PortalFrame';
import { actionText, kindOf, problemText, UNREACHABLE, type ProblemKind } from '@/components/vendor-risk/supplier/portalProblem';
import type { PortalHome, PortalMessage } from '@/components/vendor-risk/supplier/portalHomeModel';
import { BTN_MAIN, FIELD } from '@/components/vendor-risk/supplier/styles';
import { Button, Notice } from '@/components/ui/ds';

export type { PortalHome, PortalMessage, PortalQuestionnaire, PortalRequest, RequestStatus } from '@/components/vendor-risk/supplier/portalHomeModel';
export { WAITING } from '@/components/vendor-risk/supplier/portalHomeModel';

// One recorded visit per page load: moving between the portal's pages afterwards only reads.
const opened = new Set<string>();

export async function fetchHome(token: string): Promise<PortalHome> {
  const path = `/vendor-risk/portal/${encodeURIComponent(token)}`;
  if (opened.has(token)) return (await apiClient.get(path)).data as PortalHome;
  opened.add(token);
  return (await apiClient.post(`${path}/open`)).data as PortalHome;
}

export interface PortalFailure { gone: boolean; kind: ProblemKind; message: string }

export function problemOf(e: unknown): PortalFailure {
  const kind = kindOf(e);
  return { gone: kind === 'gone', kind, message: problemText(e, UNREACHABLE) };
}

/** A page that could not open for a reason that is not a dead link: the address has no organisation in it, the server is busy, or the portal could not be reached. */
export function PortalProblem({ problem }: { problem: PortalFailure }) {
  const title = problem.kind === 'address' ? 'This address does not open the portal'
    : problem.kind === 'busy' ? 'Please wait a moment' : 'The portal did not open';
  return (
    <Shell>
      <Notice tone="warning" title={title}
        action={problem.kind === 'address' ? undefined : <Button onClick={() => window.location.reload()}>Try again</Button>}>
        {problem.message}
      </Notice>
    </Shell>
  );
}

/** "12 Nov 2026": a day as written, a moment as the viewer's own day; nothing at all when there is no date. */
export const day = (value: string | null | undefined) => formatDate(value, { empty: '' });

export const detailOf = (e: unknown, fallback = 'That did not go through. Try again.') => actionText(e, fallback);

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
        <p className="text-sm text-ds-fg-body">No messages yet.</p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li key={m.id} className={`rounded-xl border px-3 py-2 ${m.from_supplier ? 'ml-6 border-[#b9ddd8] bg-[#e6f4f1]' : 'mr-6 border-ds-border bg-ds-surface'}`}>
              <p className="text-xs text-ds-fg-body">
                <span className="font-medium text-ds-fg">{m.author || (m.from_supplier ? 'You' : 'Us')}</span> · {day(m.created_at)}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ds-fg">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send} className="space-y-2">
        <label className="block text-sm font-medium text-ds-fg-body">
          Write to us
          <textarea rows={3} maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)} className={`mt-1 ${FIELD}`} />
        </label>
        <button type="submit" disabled={busy || !body.trim()} className={BTN_MAIN}>
          {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Send aria-hidden className="h-4 w-4" />} Send
        </button>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </form>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return <PortalFrame><div className="space-y-5">{children}</div></PortalFrame>;
}

export function Loading() {
  return (
    <p role="status" className="mt-16 flex items-center justify-center gap-2 text-sm text-ds-fg-body">
      <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading…
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
      setError(actionText(err, 'That did not go through. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{sent}</p>;
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-medium text-ds-fg-body">
        Your email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={`mt-1 ${FIELD}`} />
      </label>
      <button type="submit" disabled={busy} className={`${BTN_MAIN} w-full sm:w-auto`}>
        {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Mail aria-hidden className="h-4 w-4" />} Get a new link
      </button>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </form>
  );
}

export function LinkGone({ message }: { message: string }) {
  return (
    <Shell>
      <div className="rounded-2xl border border-ds-border bg-ds-surface p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-2 text-ds-fg">
          <Lock aria-hidden className="h-5 w-5 text-ds-fg-muted" />
          <h1 className="text-lg font-semibold">Link not valid</h1>
        </div>
        <p role="alert" className="mt-2 text-sm text-ds-fg-body">{message}</p>
        <div className="mt-6"><RequestLinkForm /></div>
      </div>
    </Shell>
  );
}
