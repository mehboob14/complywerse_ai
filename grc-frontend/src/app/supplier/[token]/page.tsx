'use client';

// A supplier's home in the supplier portal: what is waiting on the supplier, what we asked
// it for, its conversation with us, and what it answered lately. Opened by a contact's
// personal link; ?q=<id> goes straight to one questionnaire.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle, ChevronRight, ClipboardList, FileText, MessageSquare, Shield } from 'lucide-react';
import {
  Conversation, LinkGone, Loading, REQUEST_KIND, REQUEST_STATUS, Shell, WAITING, dateOnly, day, fetchHome, problemOf,
  type PortalHome, type PortalQuestionnaire, type PortalRequest,
} from '../_shared';

const STATUS: Record<string, string> = {
  pending: 'Not started', in_progress: 'In progress', returned: 'Questions for you',
  submitted: 'Submitted', under_review: 'In review', accepted: 'Accepted',
};

function Waiting({ token, q }: { token: string; q: PortalQuestionnaire }) {
  const pct = q.progress.total ? Math.round((q.progress.answered / q.progress.total) * 100) : 0;
  const label = q.status === 'returned' ? `${q.returned_questions} question${q.returned_questions === 1 ? '' : 's'} for you` : STATUS[q.status];
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-gray-900">{q.title}</p>
          <p className={`mt-0.5 text-xs ${q.status === 'returned' ? 'font-medium text-amber-800' : 'text-gray-600'}`}>
            {label}{q.due_date ? ` · Due ${day(q.due_date)}` : ''}
          </p>
          <Unread n={q.unread} />
        </div>
        {q.open ? (
          <Link href={`/supplier/${token}/questionnaires/${q.id}`}
            className="cw-btn-primary inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium">
            {q.status === 'pending' ? 'Start' : q.status === 'returned' ? 'Answer' : 'Continue'} <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">Closed</span>
        )}
      </div>
      {q.progress.total > 0 && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0}
            aria-valuemax={q.progress.total} aria-valuenow={q.progress.answered} aria-label={`${q.title}: questions answered`}>
            <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-gray-600">{q.progress.answered} of {q.progress.total} answered</p>
        </div>
      )}
    </li>
  );
}

function Unread({ n }: { n?: number }) {
  return n ? (
    <span className="mt-1 flex w-fit items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
      <MessageSquare className="h-3 w-3" aria-hidden /> {n} new comment{n === 1 ? '' : 's'}
    </span>
  ) : null;
}

function RequestItem({ token, r }: { token: string; r: PortalRequest }) {
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-gray-900">{r.title}</p>
          <p className={`mt-0.5 text-xs ${r.status === 'returned' || r.overdue ? 'font-medium text-amber-800' : 'text-gray-600'}`}>
            {REQUEST_KIND[r.kind]} · {REQUEST_STATUS[r.status]}
            {r.due_date && r.open ? ` · Due ${dateOnly(r.due_date)}${r.overdue ? ' (late)' : ''}` : ''}
          </p>
          {!!r.unread && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
              <MessageSquare className="h-3 w-3" aria-hidden /> {r.unread} new message{r.unread === 1 ? '' : 's'}
            </p>
          )}
        </div>
        <Link href={`/supplier/${token}/requests/${r.id}`}
          className={r.open ? 'cw-btn-primary inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium'
            : 'inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50'}>
          {r.open ? 'Answer' : 'Open'} <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </li>
  );
}

export default function SupplierHomePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [home, setHome] = useState<PortalHome | null>(null);
  const [problem, setProblem] = useState<{ gone: boolean; message: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetchHome(token).then((h) => {
      if (!live) return;
      const wanted = Number(new URLSearchParams(window.location.search).get('q'));
      // One to answer, or one already sent (to read the comments on it).
      if (wanted && h.questionnaires.some((q) => q.id === wanted && (q.open || !WAITING.includes(q.status)))) {
        router.replace(`/supplier/${token}/questionnaires/${wanted}`);
        return;
      }
      setHome(h);
    }).catch((e) => { if (live) setProblem(problemOf(e)); });
    return () => { live = false; };
  }, [token, router]);

  if (problem?.gone) return <LinkGone message={problem.message} />;
  if (problem) return <Shell><p role="alert" className="mt-16 text-center text-sm text-rose-700">{problem.message}</p></Shell>;
  if (!home) return <Shell><Loading /></Shell>;

  const waiting = home.questionnaires.filter((q) => WAITING.includes(q.status));
  const earlier = home.questionnaires.filter((q) => !WAITING.includes(q.status));
  return (
    <Shell>
      <header className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
          <Shield className="h-3.5 w-3.5" /> Supplier portal{home.organisation.name ? ` · ${home.organisation.name}` : ''}
        </span>
        <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight text-gray-900">{home.supplier.name}</h1>
        <p className="mt-1 break-words text-sm text-gray-600">
          {home.contact.name}{home.contact.email ? ` · ${home.contact.email}` : ''}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">Your link works until {day(home.expires_at)}.</p>
      </header>

      <section aria-labelledby="to-answer">
        <h2 id="to-answer" className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <ClipboardList className="h-4 w-4 text-primary-600" /> To answer ({waiting.length})
        </h2>
        {waiting.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-600">
            Nothing is waiting for you.
          </p>
        ) : (
          <ul className="space-y-3">{waiting.map((q) => <Waiting key={q.id} token={token} q={q} />)}</ul>
        )}
      </section>

      {home.requests.length > 0 && (
        <section aria-labelledby="requests">
          <h2 id="requests" className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
            <FileText className="h-4 w-4 text-primary-600" /> Requests ({home.requests.filter((r) => r.open).length})
          </h2>
          <ul className="space-y-3">{home.requests.map((r) => <RequestItem key={r.id} token={token} r={r} />)}</ul>
        </section>
      )}

      <section aria-labelledby="messages">
        <h2 id="messages" className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <MessageSquare className="h-4 w-4 text-primary-600" /> Messages
          {home.messages.unread > 0 && (
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">{home.messages.unread} new</span>
          )}
        </h2>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <Conversation token={token} initial={home.messages.latest} />
        </div>
      </section>

      {earlier.length > 0 && (
        <section aria-labelledby="earlier">
          <h2 id="earlier" className="mb-3 text-sm font-semibold text-gray-900">Earlier</h2>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {earlier.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="min-w-0">
                  <Link href={`/supplier/${token}/questionnaires/${q.id}`}
                    className="break-words text-sm font-medium text-primary-700 hover:underline">{q.title}</Link>
                  <Unread n={q.unread} />
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-600" /> {STATUS[q.status] || q.status}
                  {q.submitted_at ? ` ${day(q.submitted_at)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Shell>
  );
}
