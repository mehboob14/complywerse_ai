'use client';

// One request in the supplier portal: what is asked and by when, the files and answer the
// supplier sends (a plan and a date for a finding to fix), and the conversation about it.
// Reached from the supplier's home or straight from the emailed link.

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, CheckCircle, Loader2, MessageSquare, Paperclip, Send, Trash2, Upload } from 'lucide-react';
import apiClient from '@/lib/api';
import {
  Conversation, LinkGone, Loading, REQUEST_KIND, REQUEST_STATUS, Shell, dateOnly, day, detailOf, fetchHome, problemOf,
  type PortalMessage, type PortalRequest,
} from '../../../_shared';

interface RequestFile {
  id: number; file_name: string; file_size: number | null; coverage_from: string | null; coverage_to: string | null;
  expiry_date: string | null; uploaded_at: string | null;
}

interface RequestDetail extends PortalRequest {
  files: RequestFile[]; response_text: string | null; plan_text: string | null; target_date: string | null;
  messages: PortalMessage[];
}

const field = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100';
const label = 'block text-sm font-medium text-gray-700';

function covers(f: RequestFile): string {
  return [
    f.coverage_from || f.coverage_to ? `Covers ${f.coverage_from ? dateOnly(f.coverage_from) : '…'} to ${f.coverage_to ? dateOnly(f.coverage_to) : '…'}` : '',
    f.expiry_date ? `expires ${dateOnly(f.expiry_date)}` : '',
  ].filter(Boolean).join(' · ');
}

export default function SupplierRequestPage() {
  const { token, id } = useParams<{ token: string; id: string }>();
  const base = `/vendor-risk/portal/${encodeURIComponent(token)}/requests/${encodeURIComponent(id)}`;
  const [r, setR] = useState<RequestDetail | null>(null);
  const [problem, setProblem] = useState<{ gone: boolean; message: string } | null>(null);
  const [answer, setAnswer] = useState({ response_text: '', plan_text: '', target_date: '' });
  const [dates, setDates] = useState({ coverage_from: '', coverage_to: '', expires_on: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const show = (detail: RequestDetail) => {
    setR(detail);
    setAnswer({ response_text: detail.response_text || '', plan_text: detail.plan_text || '', target_date: detail.target_date || '' });
  };

  // The link is checked (and, on the first page loaded, the visit recorded) before the request opens.
  useEffect(() => {
    let live = true;
    fetchHome(token).then(() => apiClient.get(base))
      .then((res) => { if (live) show(res.data as RequestDetail); })
      .catch((e) => { if (live) setProblem(problemOf(e)); });
    return () => { live = false; };
  }, [token, base]);

  const run = async (what: string, work: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await work();
      setR((await apiClient.get(base)).data as RequestDetail);
    } catch (e) {
      setError(detailOf(e));
    } finally {
      setBusy(null);
    }
  };

  const upload = (file: File) => run('upload', () => {
    const form = new FormData();
    form.append('file', file);
    Object.entries(dates).forEach(([k, v]) => { if (v) form.append(k, v); });
    return apiClient.post(`${base}/files`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('submit');
    setError(null);
    try {
      show((await apiClient.post(`${base}/submit`, {
        response_text: answer.response_text || null, plan_text: answer.plan_text || null, target_date: answer.target_date || null,
      })).data as RequestDetail);
      setDone(true);
    } catch (err) {
      setError(detailOf(err));
    } finally {
      setBusy(null);
    }
  };

  if (problem?.gone) return <LinkGone message={problem.message} />;
  if (problem) return <Shell><p role="alert" className="mt-16 text-center text-sm text-rose-700">{problem.message}</p></Shell>;
  if (!r) return <Shell><Loading /></Shell>;

  const finding = r.kind === 'finding';
  return (
    <Shell>
      <Link href={`/supplier/${token}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Your portal
      </Link>

      <header className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <span className="inline-flex rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
          {REQUEST_KIND[r.kind]}{r.evidence_label ? ` · ${r.evidence_label}` : ''}
        </span>
        <h1 className="mt-3 break-words text-xl font-semibold tracking-tight text-gray-900">{r.title}</h1>
        <p className={`mt-1 text-sm ${r.overdue ? 'font-medium text-amber-800' : 'text-gray-600'}`}>
          {REQUEST_STATUS[r.status]}{r.due_date && r.open ? ` · Due ${dateOnly(r.due_date)}${r.overdue ? ' (late)' : ''}` : ''}
          {r.responded_at && !r.open ? ` · Sent ${day(r.responded_at)}` : ''}
        </p>
        {r.detail && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-800">{r.detail}</p>}
      </header>

      {r.status === 'returned' && r.review_note && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Returned to you</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{r.review_note}</p>
        </div>
      )}
      {done && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle className="h-4 w-4" /> Sent. Thank you.
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <section aria-labelledby="files" className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 id="files" className="text-sm font-semibold text-gray-900">Files</h2>
        {r.files.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">{r.open ? 'None yet.' : 'No files.'}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {r.files.map((f) => (
              <li key={f.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                <Paperclip className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-900">{f.file_name}</span>
                  {covers(f) && <span className="block text-xs text-gray-600">{covers(f)}</span>}
                </span>
                {r.open && (
                  <button type="button" onClick={() => run(`delete-${f.id}`, () => apiClient.delete(`${base}/files/${f.id}`))}
                    disabled={!!busy} aria-label={`Remove ${f.file_name}`} className="rounded p-1.5 text-gray-500 hover:text-rose-600 disabled:opacity-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {r.open && (
          <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={label}>Covers from
                <input type="date" className={field} value={dates.coverage_from} onChange={(e) => setDates({ ...dates, coverage_from: e.target.value })} />
              </label>
              <label className={label}>Covers to
                <input type="date" className={field} value={dates.coverage_to} onChange={(e) => setDates({ ...dates, coverage_to: e.target.value })} />
              </label>
              <label className={label}>Expires on
                <input type="date" className={field} value={dates.expires_on} onChange={(e) => setDates({ ...dates, expires_on: e.target.value })} />
              </label>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Attach a file
              <input type="file" className="sr-only" disabled={!!busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            </label>
            <p className="text-xs text-gray-600">PDF, Word, Excel, PowerPoint, images, text or ZIP, up to 25 MB. Set the dates first: they go with the file.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="answer" className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 id="answer" className="text-sm font-semibold text-gray-900">{finding ? 'Your plan' : 'Your answer'}</h2>
        {r.open ? (
          <form onSubmit={submit} className="mt-3 space-y-3">
            {finding && (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <label className={label}>How you will fix it
                  <textarea rows={4} maxLength={8000} required className={field} value={answer.plan_text}
                    onChange={(e) => setAnswer({ ...answer, plan_text: e.target.value })} />
                </label>
                <label className={label}>Fixed by
                  <input type="date" required className={field} value={answer.target_date}
                    onChange={(e) => setAnswer({ ...answer, target_date: e.target.value })} />
                </label>
              </div>
            )}
            <label className={label}>{finding ? 'Anything else' : 'Answer'}
              <textarea rows={finding ? 2 : 4} maxLength={8000} className={field} value={answer.response_text}
                onChange={(e) => setAnswer({ ...answer, response_text: e.target.value })} />
            </label>
            <button type="submit" disabled={!!busy}
              className="cw-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold disabled:opacity-60 sm:w-auto">
              {busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
            </button>
          </form>
        ) : (
          <div className="mt-2 space-y-2 text-sm text-gray-800">
            {r.plan_text && <p className="whitespace-pre-wrap break-words">{r.plan_text}</p>}
            {r.target_date && <p className="text-gray-600">Fixed by {dateOnly(r.target_date)}</p>}
            {r.response_text && <p className="whitespace-pre-wrap break-words">{r.response_text}</p>}
            {!r.plan_text && !r.response_text && <p className="text-gray-600">{r.status === 'cancelled' ? 'No longer needed.' : 'Files only.'}</p>}
          </div>
        )}
      </section>

      <section aria-labelledby="conversation">
        <h2 id="conversation" className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <MessageSquare className="h-4 w-4 text-primary-600" /> Messages
        </h2>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <Conversation key={r.id} token={token} requestId={r.id} initial={r.messages} />
        </div>
      </section>
    </Shell>
  );
}
