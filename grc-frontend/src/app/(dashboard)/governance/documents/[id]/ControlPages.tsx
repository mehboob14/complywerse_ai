'use client';

/**
 * The document control pages, INSIDE the document: "Document Description", the review and approval pages (a bordered cell with a
 * signature line for each person, stage by stage, as a bank's policy has them) and "Revision History" with "Approval History". The
 * platform builds them from the document's own workflow and signatures (GET /governance/documents/{id}/controlled-content); nobody
 * types them and nothing here edits them. A platform document shows them where its own sections are (ControlledMarkdown: the document
 * is cut there and the sections are filled); a Word or PDF file comes with them inserted after the cover (DocumentViewer asks for it),
 * so this file draws only the Markdown case. Words, dates and fallbacks: lib/controlPages.ts.
 *
 * They are pages of the document, in its manner: serif, black, thin lines, no card, no colour, printable (each starts a page on paper).
 * The dashboard's own rules paint bare cells, header rows and paragraphs (grey, 11.5px, padded), so a cell says its own size, colour,
 * weight and padding with "!". Only the Verify link is for the screen.
 */
import { Component, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, History, Loader2 } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { NONE, approvalRecordExport, formatDateTime, noStagesLine, recordFileName, roundLine, type ApprovalRecord, type RecordPerson, type RecordStage } from '@/lib/approvalRecord';
import {
  SECTION_TITLE, approvalRows, controlledContentKey, descriptionRows, personCell, referenceLine, revisionRows, stageNote, stageTitle, stagesOf, usableSegments,
} from '@/lib/controlPages';
import { problemOfBlob, saveBlob } from '@/lib/studio/api';
import SignatureSeal, { SignatureImage } from '@/components/governance/SignatureSeal';
import { GovernanceDocumentMarkdown } from '@/components/governance/GovernanceDocumentMarkdown';
import { useToast } from '@/components/ui/ToastProvider';
import { retryUnlessRefused } from '../_view/docRoute';

const DOC_FONT: CSSProperties = { fontFamily: '"Times New Roman", Tinos, "Liberation Serif", serif' };
const CELL = '!border !border-solid !border-[#000] !px-2 !py-1 align-top !text-[13px] !leading-snug !text-[#000]';
const TH = `${CELL} !bg-transparent !text-left !font-bold`;
const TD = `${CELL} font-normal break-words`;
// (the dashboard stripes every other row of a table grey; a page of a document is plain)
const ROW = '!bg-transparent print:break-inside-avoid';
// the title over Approval History is the title of the section it belongs to: the page's own (when it brings one) or the look of the document's own headings
const OWN_TITLE = 'mb-3 mt-6 text-[17px] font-bold text-[#000] print:break-after-avoid';
const DOC_TITLE = 'mb-2 mt-5 font-sans text-xl font-semibold text-gray-900 print:break-after-avoid';
const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

const UNAVAILABLE = 'The document control pages are not available right now.';

/** A plain line where a page has nothing to show (nobody asked yet, nothing recorded). */
function Plain({ children }: { children: ReactNode }) {
  return <p className="my-2 text-[13px] italic text-[#333]">{children}</p>;
}

/** The pages are a supplement to the document: pages that cannot be drawn (a payload that is not what was asked) say so in a line, and the document stays. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <p role="status" style={DOC_FONT} className="my-4 text-[13px] italic text-[#333]">These document control pages could not be shown. The Change log has the full trail.</p>;
  }
}

/** One page: its own title only when the document has no section of its own for it. */
function Page({ slot, heading, className = '', children }: { slot: keyof typeof SECTION_TITLE; heading?: boolean; className?: string; children: ReactNode }) {
  return (
    <section aria-label={SECTION_TITLE[slot]} style={DOC_FONT} className={`my-6 text-[14px] leading-snug text-[#000] ${className}`}>
      {heading && <h2 className="mb-3 text-[17px] font-bold text-[#000]">{SECTION_TITLE[slot]}</h2>}
      {children}
    </section>
  );
}

type SectionProps = { record: ApprovalRecord | null | undefined; heading?: boolean };
const keyOf = (record: ApprovalRecord | null | undefined) => record?.reference ?? 'none';

// ── Document Description ────────────────────────────────────────────────────────────────────────────────────
function Description({ record, heading }: SectionProps) {
  const rows = record ? descriptionRows(record) : [];
  return (
    <Page slot="description" heading={heading}>
      {!record ? <Plain>{UNAVAILABLE}</Plain> : (
        <div className="relative overflow-x-auto print:overflow-visible">
          <table aria-label="Document description" className="w-full border-collapse">
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className={ROW}>
                  <th scope="row" className={`${TH} w-[34%]`}>{r.label}</th>
                  <td className={TD}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

export function DescriptionSection(props: SectionProps) {
  return <Boundary key={keyOf(props.record)}><Description {...props} /></Boundary>;
}

// ── Review and approval ─────────────────────────────────────────────────────────────────────────────────────
/** The bar over a block of cells: its title, and what is to be said about it. */
function Bar({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border border-[#000] bg-[#f0f0f0] px-3 py-1.5 print:break-after-avoid">
      <span className="text-[13px] font-bold tracking-wide">{title}</span>
      {note && <span className="text-[12px]">{note}</span>}
    </div>
  );
}

/** Someone's place in the grid: the drawn signature over a line, then who they are and what they did (a line left empty where nobody has signed). */
function SignatureCell({ person, stage }: { person: RecordPerson; stage: RecordStage }) {
  const c = personCell(person, stage);
  const s = person.signature;
  const sealed = !!s && typeof s.id === 'number';
  return (
    <div className="flex h-full flex-col items-center px-3 pb-2.5 pt-2 text-center">
      <div className="flex h-12 w-full items-end justify-center">
        {sealed && s.drawn ? (
          <SignatureImage id={s.id} alt={`Drawn signature of ${c.name}`} className="h-11 max-w-[12rem] object-contain !border-0" />
        ) : c.caption ? (
          <span className="pb-1 text-[11px] italic text-[#555]">{c.caption}</span>
        ) : null}
      </div>
      <div className="w-4/5 border-t border-[#000]" aria-hidden />
      <div className="mt-1 max-w-full break-words text-[13px] font-bold">{c.name}</div>
      {c.designation && <div className="max-w-full break-words text-[13px]">{c.designation}</div>}
      {c.behalf && <div className="max-w-full break-words text-[12px] italic">{c.behalf}</div>}
      <div className="mt-0.5 max-w-full break-words text-[12px]">{c.status}</div>
      {c.comment && <div title={c.fullComment} className="mt-1 max-w-full break-words text-[12px] italic">&ldquo;{c.comment}&rdquo;</div>}
      {sealed && (
        // (Verify is drawn by SignatureSeal in the light teal of its other screens; here it is the dark one, and it is for the screen)
        <div className="mt-1 flex justify-center text-left [&_button]:text-[#0b6b58] print:[&_button]:hidden">
          <SignatureSeal id={s.id} fingerprint={s.seal_short || ''} thumb={false} codeTitle="Short code of this signature's seal. Verify checks the whole signed record." />
        </div>
      )}
    </div>
  );
}

/** A bar and the two-column grid of cells under it; with an odd number the last cell takes the whole width. */
function Grid({ title, note, people, stage }: { title: string; note?: string; people: RecordPerson[]; stage: RecordStage }) {
  const odd = people.length % 2 === 1;
  return (
    <div className="mt-4">
      <Bar title={title} note={note} />
      {people.length === 0 ? (
        <div className="border-x border-b border-[#000] px-3 py-1"><Plain>Nobody was asked at this stage.</Plain></div>
      ) : (
        <ul aria-label={title} className="grid grid-cols-1 border-x border-[#000] sm:grid-cols-2">
          {people.map((p, i) => {
            const alone = odd && i === people.length - 1;
            return (
              <li key={`${p.name}-${i}`} className={`min-w-0 border-b border-[#000] print:break-inside-avoid ${alone ? 'sm:col-span-2' : i % 2 === 0 ? 'sm:border-r' : ''}`}>
                <SignatureCell person={p} stage={stage} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PreparedBy({ prepared }: { prepared: ApprovalRecord['prepared_by'] }) {
  return (
    <div className="mt-4 print:break-inside-avoid">
      <Bar title="PREPARED BY" />
      <div className="border-x border-b border-[#000] px-3 py-2 text-center">
        <div className="text-[13px] font-bold">{prepared?.name?.trim() || 'Not recorded'}</div>
        {prepared?.designation && <div className="text-[13px]">{prepared.designation}</div>}
        {prepared?.at && <div className="text-[12px]">{formatDateTime(prepared.at)}</div>}
      </div>
    </div>
  );
}

function Signoff({ record, heading }: SectionProps) {
  if (!record) return <Page slot="signoff" heading={heading} className="print:break-before-page"><Plain>{UNAVAILABLE}</Plain></Page>;
  const stages = stagesOf(record);
  const round = roundLine(record.round);
  const notes = Array.isArray(record.notes) ? record.notes.filter((n) => !!n) : [];
  const reference = referenceLine(record);
  return (
    <Page slot="signoff" heading={heading} className="print:break-before-page">
      {round && <div className="mb-1 text-[12px] italic">{round}</div>}
      <PreparedBy prepared={record.prepared_by} />
      {stages.length === 0 ? (
        <Plain>{noStagesLine(record.state)}</Plain>
      ) : (
        stages.map((s, i) => <Grid key={`${s.position}-${i}`} title={stageTitle(s)} note={stageNote(s)} people={s.people} stage={s} />)
      )}
      {notes.length > 0 && <ul className="mt-3 list-disc space-y-0.5 pl-5 text-[12px] italic">{notes.map((n, i) => <li key={i}>{String(n)}</li>)}</ul>}
      {reference && <div className="mt-3 break-all text-[11px] text-[#333]">{reference}</div>}
    </Page>
  );
}

export function SignoffSection(props: SectionProps) {
  return <Boundary key={keyOf(props.record)}><Signoff {...props} /></Boundary>;
}

// ── Revision History and Approval History ───────────────────────────────────────────────────────────────────
/** A table that scrolls inside its own block on a phone and takes the page's width on paper. */
function Table({ label, head, children }: { label: string; head: string[]; children: ReactNode }) {
  return (
    <div className="relative overflow-x-auto print:overflow-visible">
      <table aria-label={label} className="w-full min-w-[34rem] border-collapse print:min-w-0">
        <thead>
          <tr>{head.map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Lines({ lines }: { lines: string[] }) {
  return lines.length ? <>{lines.map((l, i) => <div key={`${l}-${i}`}>{l}</div>)}</> : <>{NONE}</>;
}

function Revision({ record, heading }: SectionProps) {
  if (!record) return <Page slot="revision" heading={heading} className="print:break-before-page"><Plain>{UNAVAILABLE}</Plain></Page>;
  const revisions = revisionRows(record.revision_history);
  const approvals = approvalRows(record.approval_history);
  return (
    <Page slot="revision" heading={heading} className="print:break-before-page">
      {revisions.length === 0 ? (
        <Plain>No revisions are recorded yet.</Plain>
      ) : (
        <Table label="Revision history" head={['Version', 'Date', 'Change type', 'Summary of change', 'Updated by']}>
          {revisions.map((r, i) => (
            <tr key={`${r.version}-${i}`} className={ROW}>
              <td className={`${TD} whitespace-nowrap print:whitespace-normal`}>
                {r.version}
                {r.mark && <span className="block text-[11px] italic">{r.mark}</span>}
              </td>
              <td className={`${TD} whitespace-nowrap print:whitespace-normal`}>{r.date}</td>
              <td className={TD}>{r.changeType}</td>
              <td className={`${TD} whitespace-pre-wrap`}>{r.summary}</td>
              <td className={TD}>{r.updatedBy}</td>
            </tr>
          ))}
        </Table>
      )}
      <h2 className={heading ? OWN_TITLE : DOC_TITLE}>Approval History</h2>
      <Table label="Approval history" head={['Version', 'Reviewed by', 'Approved by', 'Approval date']}>
        {approvals.length === 0 ? (
          <tr className={ROW}><td colSpan={4} className={TD}>No version has been approved yet.</td></tr>
        ) : approvals.map((a, i) => (
          <tr key={`${a.version}-${i}`} className={ROW}>
            <td className={`${TD} whitespace-nowrap print:whitespace-normal`}>{a.version}</td>
            <td className={TD}><Lines lines={a.reviewers} /></td>
            <td className={TD}><Lines lines={a.approvers} /></td>
            <td className={`${TD} whitespace-nowrap print:whitespace-normal`}>{a.date}</td>
          </tr>
        ))}
      </Table>
    </Page>
  );
}

export function RevisionSection(props: SectionProps) {
  return <Boundary key={keyOf(props.record)}><Revision {...props} /></Boundary>;
}

// ── a platform document with its pages in its own sections ──────────────────────────────────────────────────
function Slot({ slot, heading, record }: { slot: string; heading: boolean; record: ApprovalRecord | null }) {
  if (slot === 'description') return <DescriptionSection record={record} heading={heading} />;
  if (slot === 'signoff') return <SignoffSection record={record} heading={heading} />;
  if (slot === 'revision') return <RevisionSection record={record} heading={heading} />;
  return null;
}

/**
 * A platform (Markdown) document with the pages the platform keeps where the document has its own sections for them. The document is cut
 * there by the server (`controlled-content`) and drawn in order, in the same card; until that is here, or when it cannot be (loading, a
 * server without it, a file, a payload that is not what was asked) the document is drawn as it is: never a blank. The text goes through
 * the one Markdown renderer every document uses, so references and "+ Draft" work in every part.
 */
export function ControlledMarkdown({ documentId, version, stamp, content, ...markdown }: {
  documentId: number;
  /** the version being read when it is not the current one ("1.1") */
  version?: string | null;
  /** the document's current version, when it is the current text that is shown: a text that changed is not shown from the one kept before it */
  stamp?: string | null;
  content: string;
} & Omit<ComponentProps<typeof GovernanceDocumentMarkdown>, 'content'>) {
  // staleTime 0: a signature given a moment ago is on the pages the next time the document is looked at, and every refresh of the document
  // (a signature, a submit, a publish: their key starts with 'governance-document') refreshes them too
  const q = useQuery({
    queryKey: controlledContentKey(documentId, version, stamp),
    queryFn: async () => (await governanceApi.controlledContent(documentId, version)).data,
    enabled: Number.isInteger(documentId) && documentId > 0,
    staleTime: 0,
    retry: retryUnlessRefused,
  });
  const segments = usableSegments(q.data);
  if (!segments) return <GovernanceDocumentMarkdown content={content} {...markdown} />;
  const record = q.data?.record ?? null;
  return (
    <>
      {segments.map((s, i) => s.type === 'markdown'
        ? (s.text.trim() ? <GovernanceDocumentMarkdown key={i} content={s.text} {...markdown} /> : null)
        : <Slot key={i} slot={s.slot} heading={s.heading === true} record={record} />)}
    </>
  );
}

// ── under the document ──────────────────────────────────────────────────────────────────────────────────────
const BTN = `inline-flex items-center gap-1.5 rounded-md border border-[#b8c4c8] bg-white px-2.5 py-1 text-xs font-semibold text-[#26323d] hover:bg-[#f3f6f8] disabled:opacity-50 ${FOCUS}`;
const LINK = `inline-flex items-center gap-1 rounded text-xs font-semibold text-[#0b6b58] underline underline-offset-2 hover:text-[#0b4f46] ${FOCUS}`;

/**
 * A line under the document for the screen (never printed): where the pages come from, the pages alone as a PDF, and the way to the Change
 * log. `inside` false: the file could not carry the pages (a type the platform does not rewrite), so they are not in it.
 */
export function ControlActions({ documentId, title, version, currentVersion, inside = null, onOpenChangeLog }: {
  documentId: number;
  title?: string | null;
  /** the version being read when it is not the current one ("1.1"): the pages follow it (none: the current version's) */
  version?: string | null;
  /** the current version, for the name of the file when `version` is none */
  currentVersion?: string | null;
  inside?: boolean | null;
  /** opens this document's Change log; without it there is no link */
  onOpenChangeLog?: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await approvalRecordExport(documentId, { version, fallbackName: recordFileName(title, version || currentVersion) });
      saveBlob(blob, filename);
    } catch (e) {
      toast({ type: 'error', title: 'Not downloaded', message: await problemOfBlob(e) });
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 print:hidden">
      <p className="min-w-0 flex-1 text-xs text-[#586472]">
        Document control pages are generated by the platform from this document&rsquo;s workflow.
        {inside === false ? ' They could not be placed inside this file: use Approval record (PDF) for them.' : ''}
      </p>
      <button type="button" onClick={download} disabled={busy} className={BTN}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />} Approval record (PDF)
      </button>
      {onOpenChangeLog && (
        <button type="button" onClick={onOpenChangeLog} className={LINK}><History className="h-3.5 w-3.5" aria-hidden /> Open the Change log</button>
      )}
    </div>
  );
}
