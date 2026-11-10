'use client';

// One request in the supplier portal: what is asked and by when, the files and answer the supplier sends (a plan and a date for a finding to fix), and the
// conversation about it. Reached from the supplier's home or straight from the emailed link, usually on a phone.
//
// A file goes first: the supplier picks it, a small sheet asks the optional dates, and only then does it travel. The words typed are kept as a draft on this device
// (see requestModel.ts: nothing about a draft can be kept on the server, sending changes the request's state) and the page asks before it is left with words unsent.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, CheckCircle, MessageSquare, Paperclip, Send, Trash2, Upload } from 'lucide-react';
import apiClient from '@/lib/api';
import { Button, IconButton, Notice, StatusPill, useConfirm } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { portalKind, portalLateness, portalRequest } from '@/lib/statuses/vendorPortal';
import { actionText } from '@/components/vendor-risk/supplier/portalProblem';
import AttachSheet from '@/components/vendor-risk/supplier/AttachSheet';
import {
  ACCEPT, EMPTY_ANSWER, answerOf, draftKey, fileProblem, isDirty, packDraft, readDraft, sendGate, sizeWords, type Answer, type FileDates,
} from '@/components/vendor-risk/supplier/requestModel';
import { BTN_MAIN, FIELD } from '@/components/vendor-risk/supplier/styles';
import {
  Conversation, LinkGone, Loading, PortalProblem, Shell, day, fetchHome, problemOf,
  type PortalFailure, type PortalMessage, type PortalRequest,
} from '../../../_shared';

interface RequestFile {
  id: number; file_name: string; file_size: number | null; coverage_from: string | null; coverage_to: string | null;
  expiry_date: string | null; uploaded_at: string | null;
}

interface RequestDetail extends PortalRequest {
  files: RequestFile[]; response_text: string | null; plan_text: string | null; target_date: string | null;
  messages: PortalMessage[];
}

const label = 'block text-sm font-medium text-ds-fg-body';

function covers(f: RequestFile): string {
  return [
    f.coverage_from || f.coverage_to ? `Covers ${f.coverage_from ? day(f.coverage_from) : '…'} to ${f.coverage_to ? day(f.coverage_to) : '…'}` : '',
    f.expiry_date ? `expires ${day(f.expiry_date)}` : '',
  ].filter(Boolean).join(' · ');
}

// sessionStorage can be missing or refuse (a private window, blocked site data): the page works without it
const held = {
  read: (key: string): string | null => { try { return window.sessionStorage.getItem(key); } catch { return null; } },
  write: (key: string, value: string) => { try { window.sessionStorage.setItem(key, value); } catch { /* no draft kept */ } },
  clear: (key: string) => { try { window.sessionStorage.removeItem(key); } catch { /* nothing kept */ } },
};

export default function SupplierRequestPage() {
  const { token, id } = useParams<{ token: string; id: string }>();
  const base = `/vendor-risk/portal/${encodeURIComponent(token)}/requests/${encodeURIComponent(id)}`;
  const key = useMemo(() => draftKey(base), [base]);
  const [r, setR] = useState<RequestDetail | null>(null);
  const [problem, setProblem] = useState<PortalFailure | null>(null);
  const [answer, setAnswer] = useState<Answer>(EMPTY_ANSWER);
  const sent = useRef<Answer>(EMPTY_ANSWER);                         // the answer the server holds
  const [restored, setRestored] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { confirm, confirmDialog } = useConfirm();

  const show = (detail: RequestDetail) => {
    setR(detail);
    sent.current = answerOf(detail);
    const draft = detail.open ? readDraft(held.read(key), sent.current) : null;
    setAnswer(draft ?? sent.current);
    setRestored(!!draft);
  };

  // The link is checked (and, on the first page loaded, the visit recorded) before the request opens.
  useEffect(() => {
    let live = true;
    fetchHome(token).then(() => apiClient.get(base))
      .then((res) => { if (live) show(res.data as RequestDetail); })
      .catch((e) => { if (live) setProblem(problemOf(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, base]);

  const edit = (next: Answer) => { setAnswer(next); setRestored(false); };
  const open = !!r?.open;
  const dirty = open && isDirty(answer, sent.current);

  // Words typed are kept for this tab until they are sent; a reload (a phone browser reloads a tab it put to sleep) puts them back.
  useEffect(() => {
    if (!open) return;
    if (dirty) held.write(key, packDraft(sent.current, answer)); else held.clear(key);
  }, [answer, dirty, open, key]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => { if (done) window.scrollTo({ top: 0 }); }, [done]);       // the thanks is at the top; the button that sent it is at the foot

  const refresh = async () => setR((await apiClient.get(base)).data as RequestDetail);

  const run = async (what: string, work: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(actionText(e, 'That did not go through. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const pick = (file: File | undefined) => {
    if (!file) return;
    const why = fileProblem(file.name, file.size);
    if (why) { setError(why); return; }
    setError(null);
    setAttachError(null);
    setPicked(file);
  };

  const attach = async (dates: FileDates) => {
    if (!picked) return;
    setBusy('upload');
    setAttachError(null);
    try {
      const form = new FormData();
      form.append('file', picked);
      Object.entries(dates).forEach(([k, v]) => { if (v) form.append(k, v); });
      await apiClient.post(`${base}/files`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
    } catch (e) {
      setAttachError(actionText(e, 'The file did not upload. Try again.'));
      setBusy(null);
      return;
    }
    setPicked(null);                                                       // it is in: the sheet has done its job whatever the list says next
    try { await refresh(); } catch { setError('The file was attached, but this page could not be refreshed. Reload it to see the file.'); }
    setBusy(null);
  };

  const remove = async (f: RequestFile) => {
    const yes = await confirm({
      title: 'Remove this file?', message: `${f.file_name} will be taken back. You can attach it again.`, confirmLabel: 'Remove file', tone: 'danger',
    });
    if (yes) await run(`delete-${f.id}`, () => apiClient.delete(`${base}/files/${f.id}`));
  };

  const gate = r ? sendGate(r.kind, r.files.length, answer) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (gate) return;
    setBusy('submit');
    setError(null);
    try {
      const res = (await apiClient.post(`${base}/submit`, {
        response_text: answer.response_text || null, plan_text: answer.plan_text || null, target_date: answer.target_date || null,
      })).data as RequestDetail;
      held.clear(key);
      show(res);
      setDone(true);
    } catch (err) {
      setError(actionText(err, 'That did not go through. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  if (problem?.gone) return <LinkGone message={problem.message} />;
  if (problem) return <PortalProblem problem={problem} />;
  if (!r) return <Shell><Loading /></Shell>;

  const finding = r.kind === 'finding';
  return (
    <Shell>
      <Link href={`/supplier/${token}`} className="inline-flex min-h-[44px] items-center gap-1.5 rounded text-sm font-medium text-[#0f766e] hover:underline">
        <ArrowLeft aria-hidden className="h-4 w-4" /> Your portal
      </Link>

      <header className="rounded-xl border border-ds-border bg-ds-surface p-4 shadow-sm sm:p-6">
        <p className="text-xs font-medium text-ds-fg-body">{portalKind.label(r.kind)}{r.evidence_label ? ` · ${r.evidence_label}` : ''}</p>
        <h1 className="mt-1 break-words text-xl font-semibold tracking-tight text-ds-fg">{r.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusPill {...statusPill(portalRequest, r.status)} />
          {r.overdue && r.open && <StatusPill {...statusPill(portalLateness, 'late')} />}
          {r.due_date && r.open && <span className="text-sm text-ds-fg-body">Due {day(r.due_date)}</span>}
          {r.responded_at && !r.open && <span className="text-sm text-ds-fg-body">Sent {day(r.responded_at)}</span>}
        </div>
        {r.detail && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ds-fg">{r.detail}</p>}
      </header>

      {r.status === 'returned' && r.review_note && (
        <Notice tone="warning" title="A note from us"><span className="whitespace-pre-wrap break-words">{r.review_note}</span></Notice>
      )}
      {done && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle aria-hidden className="h-4 w-4 shrink-0" /> Sent. Thank you.
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <section aria-labelledby="files" className="rounded-xl border border-ds-border bg-ds-surface p-4 shadow-sm sm:p-6">
        <h2 id="files" className="text-sm font-semibold text-ds-fg">Files</h2>
        {r.files.length === 0 ? (
          <p className="mt-2 text-sm text-ds-fg-body">{r.open ? 'None yet.' : 'No files.'}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {r.files.map((f) => (
              <li key={f.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-ds-border py-1 pl-3 pr-1">
                <Paperclip aria-hidden className="h-4 w-4 shrink-0 text-ds-fg-muted" />
                <span className="min-w-0 flex-1 py-1">
                  <span className="block truncate text-sm text-ds-fg">{f.file_name}</span>
                  {(covers(f) || f.file_size) && (
                    <span className="block text-xs text-ds-fg-body">{[sizeWords(f.file_size), covers(f)].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
                {r.open && (
                  <IconButton label={`Remove ${f.file_name}`} onClick={() => remove(f)} disabled={!!busy}><Trash2 aria-hidden /></IconButton>
                )}
              </li>
            ))}
          </ul>
        )}
        {r.open && (
          <div className="mt-4 border-t border-ds-border pt-4">
            <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label="Choose a file to attach"
              onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            <Button leftIcon={<Upload />} disabled={!!busy} onClick={() => input.current?.click()} fullWidth className="sm:w-auto">Attach a file</Button>
            <p className="mt-2 text-xs text-ds-fg-body">PDF, Word, Excel, PowerPoint, images, text or ZIP, up to 25 MB.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="answer" className="rounded-xl border border-ds-border bg-ds-surface p-4 shadow-sm sm:p-6">
        <h2 id="answer" className="text-sm font-semibold text-ds-fg">{finding ? 'Your plan' : 'Your answer'}</h2>
        {r.open ? (
          <form onSubmit={submit} className="mt-3 space-y-3">
            {finding && (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <label className={label}>How you will fix it
                  <textarea rows={4} maxLength={8000} required className={`mt-1 ${FIELD}`} value={answer.plan_text}
                    onChange={(e) => edit({ ...answer, plan_text: e.target.value })} />
                </label>
                <label className={label}>Fixed by
                  <input type="date" required className={`mt-1 ${FIELD}`} value={answer.target_date}
                    onChange={(e) => edit({ ...answer, target_date: e.target.value })} />
                </label>
              </div>
            )}
            <label className={label}>{finding ? 'Anything else' : 'Answer'}
              <textarea rows={finding ? 2 : 4} maxLength={8000} className={`mt-1 ${FIELD}`} value={answer.response_text}
                onChange={(e) => edit({ ...answer, response_text: e.target.value })} />
            </label>
            {dirty && (
              <p role="status" className="text-xs text-ds-fg-body">
                {restored ? 'Your earlier words are back. They stay on this device until you send.' : 'Not sent yet. Your words stay on this device until you send.'}
              </p>
            )}
            {gate && <p className="text-sm text-ds-fg-body">{gate}</p>}
            <button type="submit" disabled={!!busy || !!gate} className={`${BTN_MAIN} w-full sm:w-auto`}>
              <Send aria-hidden className="h-4 w-4" /> {busy === 'submit' ? 'Sending…' : 'Send'}
            </button>
          </form>
        ) : (
          <div className="mt-2 space-y-2 text-sm text-ds-fg">
            {r.plan_text && <p className="whitespace-pre-wrap break-words">{r.plan_text}</p>}
            {r.target_date && <p className="text-ds-fg-body">Fixed by {day(r.target_date)}</p>}
            {r.response_text && <p className="whitespace-pre-wrap break-words">{r.response_text}</p>}
            {!r.plan_text && !r.response_text && <p className="text-ds-fg-body">{r.status === 'cancelled' ? 'No longer needed.' : 'Files only.'}</p>}
          </div>
        )}
      </section>

      <section aria-labelledby="conversation">
        <h2 id="conversation" className="mb-3 flex items-center gap-2 text-sm font-semibold text-ds-fg">
          <MessageSquare aria-hidden className="h-4 w-4 text-[#0f766e]" /> Messages
        </h2>
        <div className="rounded-xl border border-ds-border bg-ds-surface p-4 shadow-sm">
          <Conversation key={r.id} token={token} requestId={r.id} initial={r.messages} />
        </div>
      </section>

      <AttachSheet file={picked} busy={busy === 'upload'} error={attachError}
        onCancel={() => { setPicked(null); setAttachError(null); }} onAttach={attach} />
      {confirmDialog}
    </Shell>
  );
}
