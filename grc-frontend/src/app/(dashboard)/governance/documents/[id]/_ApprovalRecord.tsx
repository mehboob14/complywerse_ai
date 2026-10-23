'use client';

/**
 * "Document control and approval record": the section at the end of every document (Markdown, Word, PDF, HTML) with everyone who prepared,
 * reviewed and approved it, stage by stage, with their drawn signatures and dates, the workflow that ran from draft to publication and the
 * approval history of earlier versions. The platform builds it from the document's own workflow and signatures (GET
 * /governance/documents/{id}/approval-record); nobody types it, and nothing on this screen edits it. It follows the version being read.
 * The auditor's full trail is the Change log; "Download approval record" is the same record as a PDF. Rules and words: lib/approvalRecord.ts.
 *
 * Colours are explicit values where the platform shell repaints slate classes; every state also says itself in words. A bare <p>/<td>
 * would get the dashboard's 11.5px, so each carries its own size and colour. It prints on a page of its own, without its buttons.
 */
import { Component, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, Download, History, Loader2, XCircle, type LucideIcon } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import {
  NONE, approvalRecordExport, decisionLabel, decisionTone, formatDateTime, formatDay, isMissingRoute, isWaiting, milestoneTone, noStagesLine, onBehalfLine,
  recordFileName, recordKey, roundLine, ruleLine, stageHeading, stageStatusLabel, stageSummary, stageTone, stateLabel, stateTone, statusLabel,
  typeLabel, type ApprovalRecord, type RecordDocument, type RecordHistoryRow, type RecordPerson, type RecordStage, type Tone,
} from '@/lib/approvalRecord';
import { problemOf, problemOfBlob, saveBlob } from '@/lib/studio/api';
import SignatureSeal, { SignatureImage } from '@/components/governance/SignatureSeal';
import { useToast } from '@/components/ui/ToastProvider';
import { retryUnlessRefused } from '../_view/docRoute';

const PILL: Record<Tone, string> = {
  good: 'border-[#99d5cc] bg-[#effaf8] text-[#0b4f46]',
  warn: 'border-amber-300 bg-amber-50 text-amber-900',
  bad: 'border-rose-300 bg-rose-50 text-[#7a1616]',
  neutral: 'border-[#c3ccd5] bg-[#eef1f4] text-[#3f4b58]',
};
const DOT: Record<Tone, string> = { good: 'bg-[#0f766e]', warn: 'bg-amber-500', bad: 'bg-[#b42318]', neutral: 'bg-[#7b8794]' };
const TONE_ICON: Record<Tone, LucideIcon | undefined> = { good: CheckCircle2, warn: Clock, bad: XCircle, neutral: undefined };

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const BTN = `inline-flex items-center gap-1.5 rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#26323d] hover:bg-[#f3f6f8] disabled:opacity-50 ${FOCUS}`;
const LINK = `inline-flex items-center gap-1 rounded text-xs font-semibold text-[#0b6b58] underline underline-offset-2 hover:text-[#0b4f46] ${FOCUS}`;
const H3 = 'text-xs font-semibold uppercase tracking-wide text-[#3f4b58]';
// (on paper the tables take the page's width and their words wrap, so no column is cut off)
const TH = 'whitespace-nowrap px-3 py-2 text-left print:whitespace-normal';
const NOWRAP = 'whitespace-nowrap print:whitespace-normal';
const TD = 'px-3 py-2 align-top text-xs text-[#26323d]';
const MUTED = 'text-[#586472]';
const TABLE_BOX = 'relative overflow-x-auto print:overflow-visible';

function Pill({ tone, icon: Icon = TONE_ICON[tone], children }: { tone: Tone; icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PILL[tone]}`}>
      {Icon && <Icon className="h-3 w-3" aria-hidden />}{children}
    </span>
  );
}

function Info({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className={`text-[11px] ${MUTED}`}>{label}</dt>
      <dd className="mt-0.5 break-words text-xs font-semibold text-[#26323d]">{children}</dd>
    </div>
  );
}

/** (a) Document information. */
function DocumentInfo({ rec }: { rec: ApprovalRecord }) {
  const d = (rec.document ?? {}) as Partial<RecordDocument>;
  return (
    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 print:break-inside-avoid">
      <Info label="Title" wide>{d.title || NONE}</Info>
      <Info label="Document code">{d.code || NONE}</Info>
      <Info label="Type">{typeLabel(d.type)}</Info>
      <Info label="Version">{d.version || NONE}</Info>
      <Info label="Status">{statusLabel(d.status)}</Info>
      <Info label="Classification">{d.classification || NONE}</Info>
      <Info label="Department">{d.department || NONE}</Info>
      <Info label="Owner">{d.owner || NONE}</Info>
      <Info label="Author">{d.author || NONE}</Info>
      <Info label="Effective date">{formatDay(d.effective_date)}</Info>
      <Info label="Next review">{formatDay(d.next_review_date)}</Info>
      <Info label="Approved">{formatDateTime(d.approved_at)}</Info>
      <Info label="Published" wide>{d.published_at ? `${formatDateTime(d.published_at)}${d.published_by ? `, by ${d.published_by}` : ''}` : 'Not published'}</Info>
    </dl>
  );
}

/** The drawn signature, small, with its short code and Verify; nothing when the person has not signed. */
function SignatureCell({ person }: { person: RecordPerson }) {
  const s = person.signature;
  if (!s) return <span className={MUTED}><span aria-hidden>{NONE}</span><span className="sr-only">No signature</span></span>;
  return (
    // (Verify is drawn by SignatureSeal in the light teal of its other screens, 2.6:1 on white; here it is the dark one)
    <div className="space-y-0.5 [&_button]:text-[#0b6b58]">
      {s.drawn && <SignatureImage id={s.id} alt={`Drawn signature of ${person.name || 'the signer'}`} className="h-8 max-w-[9rem] object-contain" />}
      <SignatureSeal id={s.id} fingerprint={s.seal_short} thumb={false} codeTitle="Short code of this signature's seal. Verify checks the whole signed record." />
    </div>
  );
}

function PersonRow({ person, stageStatus }: { person: RecordPerson; stageStatus: string }) {
  const tone = decisionTone(person.decision, stageStatus);
  const waiting = isWaiting(person.decision, stageStatus);
  const behalf = onBehalfLine(person);
  return (
    <tr className={`border-t border-[#e6eaee] print:break-inside-avoid ${waiting ? 'bg-amber-50/50' : ''}`}>
      <td className={TD}>{person.meaning || NONE}</td>
      <td className={TD}>
        <span className="font-semibold text-[#1f2933]">{person.name || NONE}</span>
        {behalf && <span className={`block text-[11px] ${MUTED}`}>{behalf}</span>}
      </td>
      <td className={TD}>{person.designation || NONE}</td>
      <td className={TD}><Pill tone={tone}>{decisionLabel(person.decision, stageStatus)}</Pill></td>
      <td className={TD}><SignatureCell person={person} /></td>
      <td className={`${TD} ${NOWRAP}`}>{person.decision === 'pending' ? NONE : formatDateTime(person.signed_at)}</td>
      <td className={`${TD} max-w-[18rem] whitespace-pre-wrap break-words`}>{person.comment || NONE}</td>
    </tr>
  );
}

/** (c) One table per stage, however many there are. */
function StageTable({ stage }: { stage: RecordStage }) {
  const rule = ruleLine(stage);
  const heading = stageHeading(stage);
  return (
    <div className="overflow-hidden rounded-lg border border-[#d5dbe1] print:overflow-visible print:break-inside-avoid">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-[#e6eaee] bg-[#f8fafc] px-3 py-2">
        <h3 className="text-[13px] font-semibold text-[#1f2933]"><span className={`font-normal ${MUTED}`}>Stage {stage.position}</span> · {heading}</h3>
        <Pill tone={stageTone(stage.status)}>{stageStatusLabel(stage.status)}</Pill>
        <span className={`text-xs ${MUTED}`}>{stageSummary(stage)}{rule ? ` · ${rule}` : ''}</span>
      </div>
      <div className={TABLE_BOX}>
        <table className="w-full min-w-[860px] border-collapse text-left text-xs print:min-w-0">
          <caption className="sr-only">Stage {stage.position}, {heading}: who was asked, what each decided, their signatures and when.</caption>
          <thead>
            <tr>
              <th scope="col" className={TH}>Meaning</th>
              <th scope="col" className={TH}>Name</th>
              <th scope="col" className={TH}>Designation</th>
              <th scope="col" className={TH}>Decision</th>
              <th scope="col" className={TH}>Signature</th>
              <th scope="col" className={TH}>Date and time</th>
              <th scope="col" className={TH}>Comment</th>
            </tr>
          </thead>
          <tbody>
            {(stage.people ?? []).map((p, i) => <PersonRow key={`${p.name}-${i}`} person={p} stageStatus={stage.status} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** (d) The workflow as a compact vertical timeline. */
function Workflow({ rec }: { rec: ApprovalRecord }) {
  const steps = rec.milestones ?? [];
  const round = roundLine(rec.round);
  return (
    <>
      <h3 className={`${H3} mt-6`}>Workflow</h3>
      {round && <p className={`mt-1 text-xs ${MUTED}`}>{round}</p>}
      {steps.length === 0 ? (
        <p className={`mt-2 text-xs ${MUTED}`}>No workflow steps are recorded yet.</p>
      ) : (
        <ol className="mt-3 ml-1.5 border-l border-[#c3ccd5]">
          {steps.map((m, i) => (
            <li key={`${m.event}-${i}`} className="relative pb-3 pl-5 last:pb-0 print:break-inside-avoid">
              <span className={`absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${DOT[milestoneTone(m.event)]}`} aria-hidden />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                <span className="font-semibold text-[#1f2933]">{m.event}</span>
                {m.actor && <span className="text-[#26323d]">{m.actor}</span>}
                <span className={MUTED}>{formatDateTime(m.at)}</span>
              </div>
              {m.detail && <p className={`mt-0.5 break-words text-xs ${MUTED}`}>{m.detail}</p>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function ApproverLines({ row }: { row: RecordHistoryRow }) {
  if (!row.approvers?.length) return <span className={MUTED}>{NONE}</span>;
  return (
    <>
      {row.approvers.map((a, i) => (
        <div key={`${a.name}-${i}`} className={i ? 'mt-1' : ''}>
          <span className="font-semibold text-[#1f2933]">{a.name}</span>{a.designation ? `, ${a.designation}` : ''}
          <span className={`block text-[11px] ${MUTED}`}>{[a.meaning, a.signed_at ? formatDateTime(a.signed_at) : ''].filter(Boolean).join(' · ')}</span>
        </div>
      ))}
    </>
  );
}

/** (e) Approval history by version. */
function HistoryTable({ rows }: { rows: RecordHistoryRow[] }) {
  return (
    <>
      <h3 className={`${H3} mt-6`}>Approval history</h3>
      {rows.length === 0 ? (
        <p className={`mt-2 text-xs ${MUTED}`}>No earlier version has been approved.</p>
      ) : (
        <div className={`${TABLE_BOX} mt-2 rounded-lg border border-[#d5dbe1]`}>
          <table className="w-full min-w-[820px] border-collapse text-left text-xs print:min-w-0">
            <caption className="sr-only">Approval history by version: when each was approved and published, who prepared it and who approved it.</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>Version</th>
                <th scope="col" className={TH}>Approved</th>
                <th scope="col" className={TH}>Published</th>
                <th scope="col" className={TH}>Summary</th>
                <th scope="col" className={TH}>Prepared by</th>
                <th scope="col" className={TH}>Approved by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h, i) => (
                <tr key={`${h.version}-${i}`} className="border-t border-[#e6eaee] print:break-inside-avoid">
                  <td className={`${TD} whitespace-nowrap font-mono font-semibold text-[#1f2933]`}>v{h.version}</td>
                  <td className={`${TD} ${NOWRAP}`}>{formatDateTime(h.approved_at)}</td>
                  <td className={`${TD} ${NOWRAP}`}>{h.published_at ? formatDateTime(h.published_at) : 'Not published'}</td>
                  <td className={`${TD} max-w-[18rem] whitespace-pre-wrap break-words`}>{h.summary || NONE}</td>
                  <td className={TD}>{h.prepared_by || NONE}</td>
                  <td className={TD}><ApproverLines row={h} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type Props = {
  documentId: number;
  /** the version being read when it is not the current one ("1.1"): the record follows it */
  version?: string | null;
  /** opens this document's Change log (the footer's link); without it there is no link */
  onOpenChangeLog?: () => void;
};

/** The record is a supplement to the document: a record that cannot be drawn says so here, and the document page stays. */
class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section role="alert" aria-label="Document control and approval record" className="rounded-xl border border-rose-200 bg-rose-50 p-4">
        <p className="text-xs text-[#7a1616]">The approval record could not be shown. The Change log has the full trail.</p>
      </section>
    );
  }
}

export default function ApprovalRecordSection(props: Props) {
  return <Guard key={`${props.documentId}-${props.version ?? ''}`}><Section {...props} /></Guard>;
}

function Section({ documentId, version, onOpenChangeLog }: Props) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  // staleTime 0: a signature given a moment ago in another window is on the record the next time it is looked at
  const q = useQuery({
    queryKey: recordKey(documentId, version),
    queryFn: async () => (await governanceApi.approvalRecord(documentId, version)).data,
    enabled: Number.isInteger(documentId) && documentId > 0,
    staleTime: 0,
    retry: retryUnlessRefused,
  });
  // a backend from before the record answers the router's plain 404: the document shows as it did, with no section and no error
  if (q.isError && isMissingRoute(q.error)) return null;
  const rec = q.data;

  const download = async () => {
    if (!rec) return;
    setDownloading(true);
    try {
      const { blob, filename } = await approvalRecordExport(documentId, { version, fallbackName: recordFileName(rec.document?.title, rec.document?.version) });
      saveBlob(blob, filename);
    } catch (e) {
      toast({ type: 'error', title: 'Not downloaded', message: await problemOfBlob(e) });
    } finally { setDownloading(false); }
  };

  const prepared = rec?.prepared_by;
  const stages = rec?.stages ?? [];
  // a record already on screen stays when a later refresh fails; the error line is for a record that never came
  const loading = !rec && !q.isError;
  return (
    <section id="approval-record" aria-labelledby="approval-record-title" aria-busy={loading}
      className="rounded-xl border border-[#d5dbe1] bg-white p-4 sm:p-6 print:break-before-page print:rounded-none print:border-0 print:p-0 print:[&_button]:hidden">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 id="approval-record-title" className="text-[15px] font-semibold text-[#1f2933]">Document control and approval record</h2>
          <p className={`mt-0.5 text-xs ${MUTED}`}>Generated by the platform from this document&rsquo;s workflow and signatures. It cannot be edited.</p>
        </div>
        {rec && <Pill tone={stateTone(rec.state)}>{stateLabel(rec.state)}</Pill>}
      </header>

      {loading ? (
        <p role="status" className={`mt-4 flex items-center gap-2 text-xs ${MUTED}`}><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the approval record…</p>
      ) : !rec ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-[#7a1616]">The approval record could not be loaded. {problemOf(q.error, '')}</p>
          <button type="button" onClick={() => q.refetch()} disabled={q.isFetching} className={BTN}>
            {q.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null} Try again
          </button>
        </div>
      ) : (
        <>
          <h3 className={`${H3} mt-5`}>Document information</h3>
          <DocumentInfo rec={rec} />

          <p className="mt-4 flex flex-wrap items-baseline gap-x-2 rounded-lg border border-[#e6eaee] bg-[#f8fafc] px-3 py-2 text-xs text-[#26323d] print:break-inside-avoid">
            <span className="font-semibold text-[#1f2933]">Prepared by</span>
            <span>{prepared?.name || 'Not recorded'}{prepared?.designation ? `, ${prepared.designation}` : ''}</span>
            {prepared?.at && <span className={MUTED}>· {formatDateTime(prepared.at)}</span>}
          </p>

          <h3 className={`${H3} mt-6`}>Review and approval</h3>
          {stages.length === 0 ? (
            <p className={`mt-2 rounded-lg border border-dashed border-[#c3ccd5] px-3 py-3 text-xs ${MUTED}`}>{noStagesLine(rec.state)}</p>
          ) : (
            <div className="mt-2 space-y-3">
              {stages.map((s) => <StageTable key={s.position} stage={s} />)}
            </div>
          )}

          <Workflow rec={rec} />
          <HistoryTable rows={rec.history ?? []} />

          {(rec.notes?.length ?? 0) > 0 && (
            <ul className={`mt-5 list-disc space-y-0.5 pl-5 text-xs ${MUTED}`}>
              {rec.notes.map((n, i) => <li key={i}>{String(n)}</li>)}
            </ul>
          )}

          <footer className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#e6eaee] pt-3">
            <p className={`min-w-0 flex-1 text-[11px] ${MUTED}`}>
              Reference <span className="break-all font-mono text-[#26323d]">{rec.reference}</span> · Generated {formatDateTime(rec.generated_at)}
            </p>
            <div className="flex flex-wrap items-center gap-3 print:hidden">
              {onOpenChangeLog && (
                <button type="button" onClick={onOpenChangeLog} className={LINK}><History className="h-3.5 w-3.5" aria-hidden /> Open the Change log for the full trail</button>
              )}
              <button type="button" onClick={download} disabled={downloading} className={BTN}>
                {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />} Download approval record (PDF)
              </button>
            </div>
          </footer>
        </>
      )}
    </section>
  );
}
