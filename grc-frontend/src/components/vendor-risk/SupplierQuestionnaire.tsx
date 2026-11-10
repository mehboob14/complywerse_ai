'use client';

// The questionnaire a supplier answers, wherever it is opened from: a contact's personal link in the supplier portal, or a
// questionnaire's own link (sent before personal links). Both APIs have the same shape under their own base path, so the path
// is all that differs.
//
// Each answer saves as it is given (see supplier/QuestionCard). The bar at the foot says what is left and sends once nothing
// is; the attestation is its last step. Sending needs no answers in the request: what is saved is what is checked.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CheckCircle, ChevronDown, Download, FileSpreadsheet, Loader2, Shield, Upload } from 'lucide-react';
import { useConfirm } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { portalQuestionnaire } from '@/lib/statuses/vendorPortal';
import {
  keepApplicable, nextOpen, readiness, sectionRows, sectionsOf, type EvidenceFile, type PortalQuestion,
} from './supplier/answerLogic';
import { createSaver } from './supplier/answerSaver';
import { canRetry, messageOf, portalCalls, type Attestation, type QuestionMessage, type QuestionnaireData } from './supplier/portalCalls';
import { downloadName } from './supplier/portalHomeModel';
import { kindOf, problemText, type ProblemKind } from './supplier/portalProblem';
import AttestDialog from './supplier/AttestDialog';
import { PortalFrame } from './supplier/PortalFrame';
import QuestionCard, { type QuestionProblem } from './supplier/QuestionCard';
import ReadyBar from './supplier/ReadyBar';
import SectionsSheet from './supplier/SectionsSheet';
import { BTN, FOCUS } from './supplier/styles';

// The rules the signed-in side reads too (the assessment review page asks whether an answer owes a document).
export { evidenceRule, isNotApplicable, noteNeeded, owesEvidence } from './supplier/answerLogic';
export type { QuestionOption, RuleQuestion } from './supplier/answerLogic';

const WAITING = ['pending', 'in_progress', 'returned'];

const day = (value: string | null | undefined) => formatDate(value, { empty: '' });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function SupplierQuestionnaire({ apiBase, backHref }: {
  /** e.g. /vendor-risk/questionnaires/external/<token> or /vendor-risk/portal/<token>/questionnaires/<id> */
  apiBase: string;
  /** the supplier portal's home, when opened from there */
  backHref?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ kind: ProblemKind; text: string } | null>(null);
  const [data, setData] = useState<QuestionnaireData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, EvidenceFile[]>>({});
  const [threads, setThreads] = useState<Record<string, QuestionMessage[]>>({});
  const [saves, setSaves] = useState<Record<string, 'saving' | QuestionProblem>>({});      // saves under way, and those that failed
  const [waiting, setWaiting] = useState<string[]>([]);                                       // picks waiting for their words
  const [problems, setProblems] = useState<Record<string, QuestionProblem>>({});            // uploads and replies that failed
  const [uploading, setUploading] = useState<string[]>([]);                                  // questions with a document on its way
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [attesting, setAttesting] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const [sending, setSending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [who, setWho] = useState<Attestation>({ name: '', title: '', email: '' });
  const latest = useRef<{ answers: Record<string, string>; comments: Record<string, string> }>({ answers: {}, comments: {} });
  const jumped = useRef<string | null>(null);
  const thanks = useRef<HTMLHeadingElement>(null);
  const justSent = useRef(false);

  const apply = (payload: QuestionnaireData) => {
    const given: Record<string, string> = {};
    for (const q of payload.questions || []) {
      const value = payload.existing_responses?.[q.id];
      given[q.id] = value == null ? '' : String(value);
    }
    latest.current = { answers: given, comments: payload.comments || {} };
    setData(payload);
    setAnswers(given);
    setComments(payload.comments || {});
    setFiles(payload.evidence || {});
    setThreads(payload.messages || {});
    setWho((prev) => ({
      name: payload.attestation?.name || prev.name || payload.respondent_name || '',
      title: payload.attestation?.title || prev.title || '',
      email: payload.attestation?.email || prev.email || payload.respondent_email || '',
    }));
  };

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      apply((await portalCalls.load(apiBase)).data);
    } catch (e) {
      const kind = kindOf(e);
      setLoadError({ kind, text: kind === 'gone' ? 'This questionnaire link is no longer valid. Ask your contact to send a new one.' : problemText(e) });
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (apiBase) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  // Every answer is saved on its own; what failed stays on screen until it is tried again.
  const saver = useMemo(() => createSaver(
    (id, change) => portalCalls.saveAnswer(apiBase, id, change).then(() => undefined),
    (id, phase, e) => setSaves((prev) => {
      const next = { ...prev };
      if (phase === 'saving') next[id] = 'saving';
      else if (phase === 'saved') delete next[id];
      else next[id] = { text: messageOf(e, 'That did not save.'), retry: canRetry(e) };
      return next;
    })), [apiBase]);

  const setProblem = (id: string, problem: QuestionProblem | null) => setProblems((prev) => {
    const next = { ...prev };
    if (problem) next[id] = problem; else delete next[id];
    return next;
  });

  const commit = (id: string, value: string, comment: string) => {
    const nextAnswers = keepApplicable(data?.questions ?? [], { ...latest.current.answers, [id]: value });   // as the server forgets the ones that stop applying
    const nextComments = { ...latest.current.comments, [id]: comment };
    latest.current = { answers: nextAnswers, comments: nextComments };
    setAnswers(nextAnswers);
    setComments(nextComments);
    setProblem(id, null);
    setSendError(null);
    saver.save(id, { value, comment });
  };
  const hold = (id: string, on: boolean) => setWaiting((prev) => (prev.includes(id) === on ? prev : on ? [...prev, id] : prev.filter((x) => x !== id)));
  const retry = (id: string) => saver.save(id, { value: latest.current.answers[id] || '', comment: latest.current.comments[id] || '' });

  const refreshFiles = async () => {
    try { setFiles((await portalCalls.evidence(apiBase)).data || {}); } catch { /* the list stays as it was */ }
  };

  // The file goes into the requester's evidence library against this question, with the expiry the supplier gives. A
  // replacement takes the place of the document it names once it is in.
  const working = (id: string, on: boolean) => setUploading((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
  const upload = async (id: string, file: File, expiresOn: string, replace: number[]) => {
    working(id, true);
    setProblem(id, null);
    try {
      await portalCalls.upload(apiBase, id, file, expiresOn);
      for (const fileId of replace) await portalCalls.removeFile(apiBase, fileId);
    } catch (e) {
      setProblem(id, { text: messageOf(e, 'That did not upload.'), retry: false });
    }
    await refreshFiles();
    working(id, false);
  };

  const remove = async (id: string, fileId: number) => {
    const name = files[id]?.find((f) => f.id === fileId)?.file_name ?? 'This document';
    if (!(await confirm({ title: 'Remove this document?', message: `${name} will be taken back. You can attach it again.`, confirmLabel: 'Remove document', tone: 'danger' }))) return;
    working(id, true);
    setProblem(id, null);
    try {
      await portalCalls.removeFile(apiBase, fileId);
    } catch (e) {
      setProblem(id, { text: messageOf(e, 'That document was not removed.'), retry: false });
    }
    await refreshFiles();
    working(id, false);
  };

  // A reply on one question, to the comments a reviewer shared there (portal only; always shared).
  const reply = async (id: string, body: string) => {
    setProblem(id, null);
    try {
      const sent = (await portalCalls.reply(apiBase, id, body)).data;
      setThreads((prev) => ({ ...prev, [id]: [...(prev[id] || []), sent] }));
      return true;
    } catch (e) {
      setProblem(id, { text: messageOf(e, 'Your reply was not sent.'), retry: false });
      return false;
    }
  };

  // Offline: download the questionnaire as a workbook or a fillable PDF, answer it, upload it back.
  const download = async (as: 'xlsx' | 'pdf') => {
    setError(null);
    try {
      const res = await portalCalls.download(apiBase, as);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName(data?.title, as);
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(as === 'pdf' ? 'The PDF could not be downloaded.' : 'The workbook could not be downloaded.');
    }
  };
  const importWorkbook = async (file: File) => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await portalCalls.importFile(apiBase, file);
      await load(true);
      const person = res.data?.attestation as { name?: string; title?: string; email?: string } | undefined;
      if (person?.name) setWho({ name: person.name || '', title: person.title || '', email: person.email || '' });
      setNotice(`${plural(res.data?.imported ?? 0, 'answer', 'answers')} imported. Check them, then send.`);
    } catch (e) {
      setError(messageOf(e, 'The workbook could not be imported.'));
    } finally {
      setImporting(false);
    }
  };

  const returned = data?.status === 'returned';
  const done = !!data && !WAITING.includes(data.status);       // sent: there to read, and to reply on
  const asked = data?.clarifications ?? {};
  const canEdit = (q: PortalQuestion) => !done && !q.locked && (!returned || q.id in asked);

  const view = readiness(data?.questions ?? [], answers, comments, files, canEdit);
  const sections = sectionsOf(view.shown);
  const numbers = new Map(view.shown.map((q, i) => [q.id, i + 1]));
  const notSaved = [...Object.keys(saves).filter((id) => saves[id] !== 'saving'), ...waiting.filter((id) => !(id in saves))];     // failed, or waiting for words
  const saving = Object.values(saves).includes('saving');
  const todo = view.shown.map((q) => q.id).filter((id) => view.open.includes(id) || notSaved.includes(id));
  const rows = sectionRows(sections, answers, files);

  const goNext = () => {
    const id = nextOpen(todo, view.shown.map((q) => q.id), jumped.current);
    if (!id) return;
    jumped.current = id;
    const el = document.getElementById(`question-${id}`);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
    el?.querySelector<HTMLElement>('input:not([type=file]), textarea, button')?.focus({ preventScroll: true });
  };

  // After the sheet has closed (its scroll lock is gone then): scroll to the section and put focus on its heading.
  const goSection = (i: number) => {
    setSectionsOpen(false);
    window.setTimeout(() => {
      const heading = document.getElementById(`section-${i}`);
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      (heading?.closest('section') ?? heading)?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
      heading?.focus({ preventScroll: true });
    }, 280);
  };

  const send = async (person: Attestation) => {
    setSending(true);
    setSendError(null);
    try {
      const res = await portalCalls.send(apiBase, person);
      setWho(person);
      justSent.current = true;
      setData((prev) => (prev ? { ...prev, status: res.data?.status || 'submitted', submitted_at: res.data?.submitted_at ?? new Date().toISOString() } : prev));
      setAttesting(false);
    } catch (e) {
      setAttesting(false);
      setSendError(messageOf(e, 'We could not send your answers. Try again.'));
      await load(true);                                           // what is saved may not be what this page shows
    } finally {
      setSending(false);
    }
  };

  // Once sent, the page opens on the thanks; a page left with answers that did not save asks before it goes.
  useEffect(() => {
    if (done && justSent.current) {
      justSent.current = false;
      window.scrollTo({ top: 0 });
      thanks.current?.focus();
    }
  }, [done]);
  const unsaved = Object.keys(saves).length > 0;
  useEffect(() => {
    if (!unsaved) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const back = backHref ? (
    <Link href={backHref} className={`mb-2 inline-flex min-h-[44px] items-center gap-1.5 rounded text-sm font-medium text-[#0f766e] hover:underline ${FOCUS}`}>
      <ArrowLeft aria-hidden className="h-4 w-4" /> Your portal
    </Link>
  ) : null;

  if (loading) {
    return (
      <PortalFrame>
        <p role="status" className="mt-16 flex items-center justify-center gap-2 text-sm text-ds-fg-body">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading…
        </p>
      </PortalFrame>
    );
  }

  if (!data) {
    return (
      <PortalFrame>
        {back}
        <div role="alert" className="rounded-xl border border-ds-border bg-ds-surface p-6 text-center shadow-sm sm:p-8">
          <AlertCircle aria-hidden className="mx-auto h-8 w-8 text-amber-700" />
          <h1 className="mt-3 text-xl font-semibold text-ds-fg">We could not open this questionnaire</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ds-fg-body">{loadError?.text}</p>
          {loadError && loadError.kind !== 'gone' && loadError.kind !== 'address' && (
            <button type="button" onClick={() => void load()} className={`mt-4 ${BTN}`}>Try again</button>
          )}
        </div>
      </PortalFrame>
    );
  }

  const org = data.organisation;
  const vendor = data.vendor_name || 'your company';
  const total = view.shown.length;
  const pct = total ? Math.round((view.answered / total) * 100) : 0;
  const problemOf = (id: string): QuestionProblem | null => {
    const save = saves[id];
    return save && save !== 'saving' ? save : problems[id] ?? null;
  };

  return (
    <PortalFrame>
      {back}

      {done ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-sm sm:p-8">
          <CheckCircle aria-hidden className="mx-auto h-8 w-8 text-emerald-700" />
          <h1 ref={thanks} tabIndex={-1} className="mt-3 text-xl font-semibold text-emerald-900 outline-none">Thank you, your answers are in</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ds-fg-body">
            {org || 'We'} received {plural(view.answered, 'answer', 'answers')}{data.submitted_at ? ` on ${day(data.submitted_at)}` : ''}. You can close this page.
          </p>
          <p className="mt-3 inline-block rounded-full bg-ds-surface px-3 py-1 text-xs font-medium text-ds-fg-body">{portalQuestionnaire.label(data.status)}</p>
        </section>
      ) : (
        <section className="rounded-xl border border-ds-border bg-ds-surface p-5 shadow-sm sm:p-6">
          <span className="inline-flex max-w-full items-start gap-1.5 rounded-lg border border-[#b9ddd8] bg-[#e6f4f1] px-3 py-1 text-xs font-medium text-[#0b4f4a]">
            <Shield aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span title={data.title || undefined} className="line-clamp-2 min-w-0 break-words">{data.title || 'Questionnaire'}</span>
          </span>
          <h1 className="mt-3 break-words text-xl font-semibold tracking-tight text-ds-fg sm:text-2xl">
            {org ? `${org} has some questions about ${vendor}` : `Some questions about ${vendor}`}
          </h1>
          <p className="mt-2 text-sm text-ds-fg-body">
            {plural(total, 'question', 'questions')} · Answers save as you go{data.due_date ? ` · Due by ${day(data.due_date)}` : ''}
          </p>
          {data.expires_at && <p className="mt-0.5 text-xs text-ds-fg-muted">Open until {day(data.expires_at)}.</p>}
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-ds-fg-body">{view.answered} of {total} answered</span>
              <span className="text-xs tabular-nums text-ds-fg-muted">{pct}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ds-border" role="progressbar" aria-valuemin={0} aria-valuemax={total}
              aria-valuenow={view.answered} aria-label="Questions answered">
              <div className="h-full rounded-full bg-[#0f766e] transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </section>
      )}

      {data.certificate && !done && (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Some questions were answered from <span className="font-medium">{data.certificate.name}</span>
          {data.certificate.expires ? `, valid until ${day(data.certificate.expires)}` : ''}.
          {data.certificate.mode === 'skip' ? ' Those answers are fixed.' : ' Check them and change any that are wrong.'}
        </p>
      )}

      {returned && !done && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Your contact has a question about {Object.keys(asked).length} of your answers.</p>
          <p className="mt-1">Only those questions can be changed now. Answer them, then send again.</p>
        </div>
      )}

      {notice && (
        <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <CheckCircle aria-hidden className="h-4 w-4 shrink-0" /> {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          <AlertCircle aria-hidden className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {!done && (
        <details className="group mt-4 rounded-xl border border-ds-border bg-ds-surface px-4 py-1 text-sm shadow-sm">
          <summary className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded font-medium text-ds-fg ${FOCUS}`}>
            <FileSpreadsheet aria-hidden className="h-4 w-4 text-[#0f766e]" /> Prefer a spreadsheet?
            <ChevronDown aria-hidden className="ml-auto h-4 w-4 text-ds-fg-muted transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-2 text-xs leading-5 text-ds-fg-body">
            Download the questionnaire as a workbook or a fillable PDF, answer it offline, and upload it here. Your answers are
            saved to check before you send.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => download('xlsx')} className={BTN}><Download aria-hidden className="h-4 w-4" /> Download workbook</button>
            <button type="button" onClick={() => download('pdf')} className={BTN}><Download aria-hidden className="h-4 w-4" /> Download fillable PDF</button>
            <label className={`${BTN} cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#0f766e]`}>
              {importing ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Upload aria-hidden className="h-4 w-4" />} Upload completed workbook or PDF
              <input type="file" accept=".xlsx,.pdf" className="sr-only" disabled={importing}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importWorkbook(f); e.target.value = ''; }} />
            </label>
          </div>
        </details>
      )}

      <div className="mt-5 space-y-5">
        {sections.map((section, i) => (
          <section key={`${section.label}-${i}`} aria-labelledby={`section-${i}`} className="scroll-mt-4 rounded-xl border border-ds-border bg-ds-surface px-4 py-4 shadow-sm sm:px-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={`section-${i}`} tabIndex={-1} className="text-base font-semibold text-ds-fg outline-none">{section.label}</h2>
              <span className="text-xs tabular-nums text-ds-fg-body">{rows[i]?.answered}/{rows[i]?.total}<span className="sr-only"> answered</span></span>
            </div>
            <ol className="mt-1 divide-y divide-ds-border">
              {section.questions.map((q) => (
                <QuestionCard key={q.id} q={q} number={numbers.get(q.id) ?? 0} value={answers[q.id] || ''} comment={comments[q.id] || ''}
                  files={files[q.id] || []} thread={threads[q.id] || []} editable={canEdit(q)}
                  asked={q.id in asked ? asked[q.id] : undefined} problem={problemOf(q.id)} uploading={uploading.includes(q.id)}
                  onCommit={(value, comment) => commit(q.id, value, comment)} onRetry={() => retry(q.id)}
                  onUpload={(file, expiresOn, replace) => upload(q.id, file, expiresOn, replace)}
                  onRemove={(fileId) => remove(q.id, fileId)} onReply={(body) => reply(q.id, body)} onWaiting={(on) => hold(q.id, on)} />
              ))}
            </ol>
          </section>
        ))}
      </div>

      {!done && (
        <>
          <ReadyBar answered={view.answered} total={total} left={view.left.length} missing={view.missing.length} notSaved={notSaved.length} saving={saving}
            error={sendError} canNext={todo.length > 0} sending={sending} onSections={sections.length > 1 ? () => setSectionsOpen(true) : undefined}
            onNext={goNext} onSend={() => setAttesting(true)} />
          <SectionsSheet open={sectionsOpen} rows={rows} answered={view.answered} total={total} onClose={() => setSectionsOpen(false)} onPick={goSection} />
          <AttestDialog open={attesting} initial={who} busy={sending} onCancel={() => setAttesting(false)} onConfirm={send} />
        </>
      )}
      {confirmDialog}
    </PortalFrame>
  );
}
