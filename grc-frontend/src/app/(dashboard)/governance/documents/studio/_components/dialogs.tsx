'use client';

/** The studio's dialogs: export, move to the library, save into the library document, save as a template, the document's details.
 *  A dialog says what it does in its title; what a title cannot say is an (i) at the right of the header or beside a label, and
 *  only what prevents a mistake (a version that changes approvals, a file that keeps its own header) stays as a line. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CircleAlert, Download, FileText, Info, Loader2, Send } from 'lucide-react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { BTN, BTN_PRIMARY } from '@/components/governance/docUi';
import { DOC_TYPE_LABEL, isConflict, problemOf, problemOfBlob, saveBlob, studioApi, type ExportNote, type ExportOptions, type MoveToLibrary, type Session } from '@/lib/studio/api';
import { ARCHIVED_NOTE, maySaveToLibrary, nextVersion, saveWarning, savedNote } from '@/lib/studio/text';
import AssetImage from './AssetImage';
import { DocumentDetailsFields, useDocumentDetails } from '../../_DetailsFields';
import { NO_SIGNOFF, ReviewerApproverFields, saveSignoffChoice, type SignoffChoice } from '../../_SignoffControl';
import { detailsPayload } from '../../_detailsRead';
import { governanceApi } from '@/lib/api';
import DetailsDialog from '../../[id]/_DetailsDialog';
import { ProposeNote, useProposalRole, useProposedAnswer } from '../../[id]/_ProposalsView';
import { sendLabel } from '@/lib/proposals';
import { titleCase, withCurrent } from '../../_DetailsFields';

const input = 'w-full rounded-lg border border-[#b8c4c8] bg-[#fff] px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';
// the Documents area's own buttons (components/governance/docUi)
const primary = BTN_PRIMARY;
const secondary = BTN;

type Change = 'major' | 'minor';
const CHANGES: { key: Change; label: string; hint: string }[] = [
  { key: 'minor', label: 'Minor change', hint: 'Meaning stays: wording, clarity, formatting' },
  { key: 'major', label: 'Major change', hint: 'Requirements change: rules, scope, roles, approvals' },
];

/** Minor or major: the person decides when the work goes into the library (the user, 2026-10-21: "let user decide it"), each option
 *  with the version it makes from `current`; nothing is chosen for them. `note`: what it does, as the (i). */
function VersionChoice({ current, value, onChange, note }: { current: string | null | undefined; value: Change | null; onChange: (c: Change) => void; note: string }) {
  return (
    <fieldset>
      <legend className="sr-only">Type of change</legend>
      <div className="flex items-center gap-1 text-xs font-semibold text-[#26323d]"><span aria-hidden>Type of change</span><InfoTip label="About the type of change" text={note} /></div>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
        {CHANGES.map((c) => (
          <label key={c.key} className={`cursor-pointer rounded-lg border p-2.5 ${value === c.key ? 'border-[#0f766e] bg-[#f3fbf9] ring-1 ring-[#0f766e]' : 'border-[#c5ccd3] bg-[#fff] hover:bg-[#f8fafb]'}`}>
            <span className="flex items-center gap-2 text-sm font-semibold text-[#1f2933]">
              <input type="radio" name="version-change" checked={value === c.key} onChange={() => onChange(c.key)} className="accent-[#0f766e]" />
              {c.label} → v{nextVersion(current, c.key)}
            </span>
            <span className="mt-0.5 block pl-6 text-xs text-[#586472]">{c.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Notes({ notes }: { notes: ExportNote[] }) {
  if (!notes.length) return null;
  return (
    <ul className="space-y-1.5" aria-label="Before you export">
      {notes.map((n, i) => (
        <li key={i} className={`flex gap-2 rounded-lg px-2.5 py-2 text-xs ${n.level === 'error' ? 'bg-[#fdf3f3] text-[#8a1c1c]' : n.level === 'warning' ? 'bg-[#fffbed] text-[#6b4e00]' : 'bg-[#f1f5fb] text-[#33475e]'}`}>
          {n.level === 'error' ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : n.level === 'warning' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{n.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ── export ───────────────────────────────────────────────────────────────────
const FORMATS: { value: ExportOptions['format']; label: string; hint: string }[] = [
  { value: 'docx', label: 'Word (.docx)', hint: 'Editable' },
  { value: 'pdf', label: 'PDF', hint: 'For reading and sending' },
  { value: 'md', label: 'Markdown (.md)', hint: 'Text and structure only' },
  { value: 'html', label: 'Web page (.html)', hint: 'One file for a browser' },
];

export function ExportDialog({ session, onClose, flush }: { session: Session; onClose: () => void; flush: () => Promise<void> }) {
  const { toast } = useToast();
  const [format, setFormat] = useState<ExportOptions['format']>('docx');
  const [noLogo, setNoLogo] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => { flush().finally(() => setReady(true)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const options: ExportOptions = { format, no_logo: noLogo, highlight_placeholders: highlight };
  const check = useQuery({ queryKey: ['studio', 'export-check', session.id, session.revision, format, noLogo, session.instructions.logo_asset_id ?? 0, session.instructions.entity_name ?? ''], queryFn: () => studioApi.exportCheck(session.id, options), enabled: ready, staleTime: 0 });
  const download = useMutation({
    mutationFn: async () => { await flush(); return studioApi.exportFile(session.id, options); },
    onSuccess: ({ blob, filename }) => { saveBlob(blob, filename); toast({ title: 'Exported', message: filename, type: 'success' }); onClose(); },
    onError: async (e) => toast({ title: 'Could not export', message: await problemOfBlob(e), type: 'error' }),
  });
  const logoId = session.instructions.logo_asset_id;
  const atFoot = String(session.instructions.logo_position ?? '').startsWith('footer');
  const watermark = session.instructions.watermark ? (String(session.instructions.watermark_text ?? '').trim() || 'DRAFT') : '';
  const logo = logoId && !noLogo ? <AssetImage id={logoId} alt="Logo" className="h-8 max-w-[7rem] object-contain" /> : null;
  return (
    <AnimatedModal isOpen onClose={onClose} title="Export" subtitle={session.title} size="lg"
      footer={<div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={!ready || download.isPending || check.data?.can_export === false} onClick={() => download.mutate()}>
          {download.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download</button></div>}>
      <div className="space-y-4 p-5">
        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-[#26323d]">Format</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FORMATS.map((f) => (
              <label key={f.value} className={`cursor-pointer rounded-lg border p-2.5 ${format === f.value ? 'border-[#0f766e] bg-[#f3fbf9] ring-1 ring-[#0f766e]' : 'border-[#c5ccd3] bg-[#fff] hover:bg-[#f8fafb]'}`}>
                <span className="flex items-center gap-2 text-sm font-semibold text-[#1f2933]"><input type="radio" name="export-format" checked={format === f.value} onChange={() => setFormat(f.value)} className="accent-[#0f766e]" /> {f.label}</span>
                <span className="mt-0.5 block pl-6 text-xs text-[#586472]">{f.value === 'docx' && session.source.in_place ? 'Your original file with your changes' : f.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {format === 'docx' && session.source.in_place && (
          // what a person would not expect: the file keeps its own header and footer, so no logo or entity name is added
          <p className="rounded-lg border border-[#d5dbe1] bg-[#f8fafb] p-3 text-[13px] text-[#3f4b58]">
            Your file keeps its own header, footer and styles, so the logo and entity name are not added
            {watermark ? <>; the watermark <strong>“{watermark}”</strong> is added across its pages.</> : '.'}
          </p>
        )}
        {(format === 'pdf' || format === 'html' || (format === 'docx' && !session.source.in_place)) && (
          <div className="rounded-lg border border-[#d5dbe1] bg-[#f8fafb] p-3 text-sm">
            <p className="flex items-center gap-1 text-xs font-semibold text-[#26323d]">On every page <InfoTip label="About the page header and footer" text="Change the logo, where it sits, the entity name or the watermark in Instructions." /></p>
            <dl className="mt-1.5 space-y-1.5 text-xs">
              <div className="flex items-center gap-3">
                <dt className="w-20 shrink-0 text-[#586472]">Top</dt>
                <dd className="flex min-w-0 items-center gap-3">{!atFoot && logo}<span className="truncate font-semibold text-[#0f766e]">{session.instructions.entity_name || <span className="font-normal text-[#586472]">No entity name</span>}</span></dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="w-20 shrink-0 text-[#586472]">Foot</dt>
                <dd className="flex min-w-0 items-center gap-3"><span className="text-[#3f4b58]">Code, version, page numbers</span>{atFoot && logo}</dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="w-20 shrink-0 text-[#586472]">Watermark</dt>
                <dd className="text-[#3f4b58]">{watermark ? <strong className="text-[#0f766e]">“{watermark}”</strong> : 'None'}</dd>
              </div>
            </dl>
            {!logoId && <p className="mt-1.5 text-xs text-[#586472]">No logo</p>}
            {logoId && <label className="mt-2 flex items-center gap-2 text-xs text-[#26323d]"><input type="checkbox" checked={noLogo} onChange={(e) => setNoLogo(e.target.checked)} className="accent-[#0f766e]" /> Leave out the logo</label>}
          </div>
        )}
        {(format === 'pdf' || (format === 'docx' && !session.source.in_place)) && (
          <label className="flex items-center gap-2 text-sm text-[#26323d]"><input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} className="accent-[#0f766e]" /> Highlight placeholders</label>
        )}
        {check.isLoading || !ready ? <p role="status" className="relative text-[#586472]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /><span className="sr-only">Checking the document</span></p> : check.data && <Notes notes={check.data.notes} />}
      </div>
    </AnimatedModal>
  );
}

// ── move to the library ──────────────────────────────────────────────────────
const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];
const REVIEW_MONTHS: Record<string, number> = { 'Every 6 months': 6, 'Every year': 12, 'Every two years': 24, 'Every three years': 36 };   // setup.REVIEW_CYCLES

export function MoveToLibraryDialog({ session, onClose, flush, onDone }: { session: Session; onClose: () => void; flush: () => Promise<void>; onDone: (docId: number) => void }) {
  const { toast } = useToast();
  // what the setup chose, so the library document starts as the person set it up (the parent chosen when it was started, too);
  // the owner starts as the person
  const chosen = String(session.instructions.classification ?? '').toLowerCase();
  const details = useDocumentDetails({
    title: session.title,
    doc_type: session.doc_type === 'other' ? 'policy' : session.doc_type,
    classification: (CLASSIFICATIONS as readonly string[]).includes(chosen) ? chosen : 'internal',
    review_cycle_months: REVIEW_MONTHS[String(session.instructions.review_cycle ?? '')] ?? 12,
    parent_document_id: session.references.find((r) => r.kind === 'parent_document')?.source_id ?? null,
  });
  // the frameworks it was written against (its framework references) start ticked
  const [frameworks, setFrameworks] = useState<number[]>(() => Array.from(new Set(session.references.flatMap((r) => (r.kind === 'framework' && r.source_id != null ? [r.source_id] : [])))));
  const fws = useQuery({ queryKey: ['studio', 'frameworks'], queryFn: studioApi.frameworks, staleTime: 120_000 });
  const [signoff, setSignoff] = useState<SignoffChoice>(NO_SIGNOFF);
  // an uploaded file changed here moves as two versions: the file as it states, then the person's minor or major one
  const original = session.original_version ?? null;
  const [change, setChange] = useState<Change | null>(null);
  const move = useMutation({
    mutationFn: async () => {
      await flush();
      const r = await studioApi.moveToLibrary(session.id, { ...(detailsPayload(details.form) as Partial<MoveToLibrary>), framework_ids: frameworks,
                                                            ...(original && change ? { change_type: change } : {}) });
      try { await saveSignoffChoice(r.document_id, signoff); } catch (e) {
        toast({ title: 'The reviewers and approvers were not saved', message: `${problemOf(e)} Choose them in Submit for review.`, type: 'error' });
      }
      return r;
    },
    onSuccess: (r) => { toast({ title: 'Moved to the library', message: `${r.title} is a draft, v${r.version}.`, type: 'success' }); onDone(r.document_id); },
    onError: (e) => toast({ title: 'Could not move it', message: problemOf(e), type: 'error' }),
  });
  // what it becomes, in a few words; how, as the (i)
  const becomes = original ? `Draft; your file stays as v${original}` : session.kind === 'upload' && session.source.name ? 'Draft, at the version your file states' : 'Draft, v1.0';
  const becomesNote = original ? `It becomes a draft. Your uploaded file ${session.source.name ?? ''} is kept as version ${original}, the original.`
    : session.kind === 'upload' && session.source.name
    ? `It becomes a draft: your uploaded file ${session.source.name}, at the version it states. Statements are extracted from it as for any new document.`
    : 'It becomes a draft, version 1.0. Statements are extracted from it as for any new document.';
  return (
    <AnimatedModal isOpen onClose={onClose} title="Move to library" size="lg" subtitle={becomes}
      headerAccessory={<InfoTip align="end" label="About moving to the library" text={becomesNote} />}
      footer={<div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={!details.form.title.trim() || move.isPending || (!!original && !change)} onClick={() => move.mutate()}
          title={original && !change ? 'Choose a minor or a major change first' : undefined}>{move.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Move to library</button></div>}>
      <div className="space-y-4 p-5">
        {original && <VersionChoice current={original} value={change} onChange={setChange}
          note={`What you changed here becomes the next version after ${original}.`} />}
        <DocumentDetailsFields d={details} />
        <ReviewerApproverFields value={signoff} onChange={setSignoff} />
        {fws.data && fws.data.items.length > 0 && (
          <fieldset>
            <legend className="sr-only">Frameworks (optional)</legend>
            <div className="flex items-center gap-1 text-xs font-semibold text-[#26323d]"><span aria-hidden>Frameworks (optional)</span><InfoTip label="About the frameworks" text="The frameworks this document must comply with." /></div>
            <div className="mt-1 grid max-h-32 gap-0.5 overflow-y-auto rounded border border-[#e1e6eb] p-2 sm:grid-cols-2">
              {fws.data.items.map((f) => (
                <label key={f.id} className="flex items-start gap-2 text-sm text-[#26323d]"><input type="checkbox" checked={frameworks.includes(f.id)} onChange={(e) => setFrameworks(e.target.checked ? [...frameworks, f.id] : frameworks.filter((x) => x !== f.id))} className="mt-1 accent-[#0f766e]" /> {f.name}{f.version ? ` ${f.version}` : ''}</label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </AnimatedModal>
  );
}

// ── save into the library document ───────────────────────────────────────────
/** Save to the library. Someone who may edit the document but is not its owner or author sends the changes to the owner instead
 *  (D35): "Send your changes to <owner>", a message they read (required), the same minor or major choice; the library does not change
 *  until the owner accepts. */
export function SaveToDocumentDialog({ session, onClose, flush, onDone, onConflict }: { session: Session; onClose: () => void; flush: () => Promise<void>; onDone: () => void; onConflict?: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  // minor or major: the person's own choice, nothing chosen for them; the versions before stay in the library as they are
  const [change, setChange] = useState<Change | null>(null);
  const current = session.document_version;
  const { proposes, decider } = useProposalRole(session.document_id);
  const handledAsProposal = useProposedAnswer();
  const save = useMutation({
    mutationFn: async (force: boolean) => {
      await flush();
      return studioApi.saveToDocument(session.id, { change_reason: reason || undefined, message: reason.trim() || undefined, force, ...(change ? { change_type: change } : {}) });
    },
    onSuccess: (r) => {
      // sent to the owner: the library is as it was until they accept (the server's sentence says so)
      if (!handledAsProposal(r, decider)) toast({ ...savedNote(r, session.document_status), type: 'success' });
      onDone();
    },
    // a refusal may be the document archived while this was open: the session is read again, so no "Save anyway" is offered then
    onError: (e) => {
      if (isConflict(e)) { setConflict(problemOf(e)); onConflict?.(); }
      // nothing new since the library version (saved already, in another window): not a failure
      else if (/^Nothing has changed/.test(problemOf(e))) { toast({ title: 'Already saved in the library', message: problemOf(e), type: 'info' }); onDone(); }
      else toast({ title: 'Could not save', message: problemOf(e), type: 'error' });
    },
  });
  // the version everyone else reads until this one is published (GET /studio/sessions/{id}: document_version_in_force)
  const warning = saveWarning(session.document_status, session.document_version_in_force);
  // archived since the studio was opened (the session is read again when this opens): nothing is saved, nor offered
  const archived = session.document_status === 'archived';
  const blocked = !change ? 'Choose a minor or a major change first' : proposes && !reason.trim() ? `Write what changed and why for ${decider} first` : undefined;
  return (
    <AnimatedModal isOpen onClose={onClose} title={proposes ? sendLabel(decider) : 'Save to library'} subtitle={session.title} size="md"
      footer={<div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        {!archived && <button type="button" className={primary} disabled={save.isPending || !!blocked} onClick={() => save.mutate(!!conflict)}
          title={blocked}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : proposes ? <Send className="h-4 w-4" aria-hidden /> : null} {proposes ? (conflict ? 'Send anyway' : sendLabel(decider)) : conflict ? 'Save anyway' : change ? `Save as v${nextVersion(current, change)}` : 'Save'}</button>}</div>}>
      {archived ? <p className="p-5 text-sm text-[#26323d]" role="status">{ARCHIVED_NOTE}</p> : <div className="space-y-3 p-5">
        <VersionChoice current={current} value={change} onChange={setChange}
          note={proposes ? `Accepted, it becomes the next version after ${current ? `v${current}` : 'the one in the library'}.`
            : `It becomes the next version after ${current ? `v${current}` : 'the one in the library'}, and every version before stays.`} />
        {proposes ? (
          <ProposeNote id={`studio-send-${session.id}`} decider={decider} value={reason} onChange={setReason} placeholder="e.g. Updated the password rules" />
        ) : (
          <label className="block"><span className="text-xs font-semibold text-[#26323d]">What changed (optional)</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Updated the password rules" className={`${input} mt-1`} /></label>
        )}
        {warning && !proposes && <p className="flex gap-1.5 rounded-lg bg-[#fffbed] px-2.5 py-2 text-xs text-[#6b4e00]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {warning}</p>}
        {conflict && <p className="rounded-lg border border-[#f0cf7a] bg-[#fffbed] p-3 text-sm text-[#6b4e00]" role="alert">{conflict}</p>}
      </div>}
    </AnimatedModal>
  );
}

// ── save as a template ───────────────────────────────────────────────────────
// ── the document's details ──────────────────────────────────────────────────
/** Edit details: a library document's whole Details (the document page's own dialog, its reviewers and approvers too); a document
 * not in the library yet has its title and type here, the rest is asked when it moves to the library. */
export function StudioDetailsDialog({ session, onClose, onChanged }: { session: Session; onClose: () => void; onChanged: (patch: Partial<Session>) => void }) {
  return session.document_id ? <LibraryDetails session={session} onClose={onClose} onChanged={onChanged} />
    : <DraftDetails session={session} onClose={onClose} onChanged={onChanged} />;
}

function LibraryDetails({ session, onClose, onChanged }: { session: Session; onClose: () => void; onChanged: (patch: Partial<Session>) => void }) {
  const id = session.document_id as number;
  const docQ = useQuery({ queryKey: ['governance-document', id], queryFn: async () => (await governanceApi.getDocument(id)).data as any });
  // the studio's own title and type follow the library's
  const follow = async (patch: Record<string, unknown>) => {
    const sync = { ...(typeof patch.title === 'string' ? { title: patch.title } : {}), ...(typeof patch.doc_type === 'string' ? { doc_type: patch.doc_type } : {}) };
    if (!Object.keys(sync).length) return;
    try {
      const s = await studioApi.patchSession(session.id, sync);
      onChanged({ title: s.title, doc_type: s.doc_type });
    } catch { /* the library has them; the studio shows its own until it is opened again */ }
  };
  if (!docQ.data) {
    return (
      <AnimatedModal isOpen onClose={onClose} title="Details" size="md">
        <p className="relative p-5 text-sm text-[#3f4b58]" role="status">
          {docQ.isError ? problemOf(docQ.error, 'Could not read the details') : <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /><span className="sr-only">Reading the details</span></>}
        </p>
      </AnimatedModal>
    );
  }
  return <DetailsDialog doc={docQ.data} open onClose={onClose} canEdit={maySaveToLibrary(session)} onSaved={(p) => void follow(p)} />;
}

function DraftDetails({ session, onClose, onChanged }: { session: Session; onClose: () => void; onChanged: (patch: Partial<Session>) => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(session.title);
  const [docType, setDocType] = useState(session.doc_type);
  const save = useMutation({
    mutationFn: () => studioApi.patchSession(session.id, { title: title.trim(), doc_type: docType }),
    onSuccess: (s) => { onChanged({ title: s.title, doc_type: s.doc_type }); toast({ title: 'Details saved', type: 'success' }); onClose(); },
    onError: (e) => toast({ title: 'Not saved', message: problemOf(e), type: 'error' }),
  });
  const types = withCurrent(Object.entries(DOC_TYPE_LABEL), docType, titleCase);
  return (
    <AnimatedModal isOpen onClose={onClose} title="Details" subtitle={session.title} size="md"
      headerAccessory={<InfoTip align="end" label="About the other details" text="Its owner, classification, review cycle, dates, description, reviewers and approvers are asked when you move it to the library." />}
      footer={<div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={!title.trim() || save.isPending || (title.trim() === session.title && docType === session.doc_type)}
          onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save</button></div>}>
      <div className="space-y-3 p-5">
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} mt-1`} /></label>
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">Type</span>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={`${input} mt-1`}>{types.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
    </AnimatedModal>
  );
}

export function SaveTemplateDialog({ session, onClose, getContent }: { session: Session; onClose: () => void; getContent: () => string }) {
  const { toast } = useToast();
  const own = session.template_id?.startsWith('tenant:') ? Number(session.template_id.split(':')[1]) : null;
  const [name, setName] = useState(own ? session.title : `${session.title} template`);
  const [docType, setDocType] = useState(session.doc_type);
  const [description, setDescription] = useState('');
  const status = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 60_000 });
  const admin = !!status.data?.is_admin;
  const [wantDefault, setMakeDefault] = useState(true);
  const makeDefault = admin && wantDefault;                                           // only an administrator sets the organisation's default
  const [mode, setMode] = useState<'new' | 'update'>(own ? 'update' : 'new');
  const save = useMutation({
    mutationFn: () => (mode === 'update' && own
      ? studioApi.updateTemplate(own, { name, doc_type: docType, description: description || undefined, content: getContent(), make_default: makeDefault })
      : studioApi.saveTemplate({ session_id: session.id, name, doc_type: docType, description: description || undefined, content: getContent(), make_default: makeDefault })),
    onSuccess: (t) => { toast({ title: 'Template saved', message: t.is_default ? `New ${DOC_TYPE_LABEL[t.doc_type] ?? t.doc_type} documents start from it.` : undefined, type: 'success' }); onClose(); },
    onError: (e) => toast({ title: 'Could not save the template', message: problemOf(e), type: 'error' }),
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Save as a template" subtitle={session.title} size="md"
      headerAccessory={<InfoTip align="end" label="About templates" text="Your organisation’s own starting point, with its sections checked on every document." />}
      footer={<div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save template</button></div>}>
      <div className="space-y-3 p-5">
        {own && (
          <fieldset className="space-y-1">
            <label className="flex items-center gap-2 text-sm text-[#26323d]"><input type="radio" checked={mode === 'update'} onChange={() => setMode('update')} className="accent-[#0f766e]" /> Update the original template</label>
            <label className="flex items-center gap-2 text-sm text-[#26323d]"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} className="accent-[#0f766e]" /> Save as a new template</label>
          </fieldset>
        )}
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">Name</span><input value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1`} /></label>
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">Type</span>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={`${input} mt-1`}>{Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">Description (optional)</span><input value={description} onChange={(e) => setDescription(e.target.value)} className={`${input} mt-1`} /></label>
        <div className="flex items-start gap-1">
          <label className={`flex min-w-0 flex-1 items-start gap-2 text-sm ${admin ? 'text-[#26323d]' : 'text-[#7b8794]'}`}>
            <input type="checkbox" checked={makeDefault} disabled={!admin} onChange={(e) => setMakeDefault(e.target.checked)} className="mt-1 accent-[#0f766e]" />
            <span>Default for every new {DOC_TYPE_LABEL[docType]?.toLowerCase() ?? 'document'}{!admin && <span className="block text-xs">Administrators only</span>}</span>
          </label>
          <InfoTip className="mt-0.5" label="About the default" text="Every new document of this type starts from this template instead of the standard structure. Only an administrator can make a template the organisation’s default." />
        </div>
      </div>
    </AnimatedModal>
  );
}
