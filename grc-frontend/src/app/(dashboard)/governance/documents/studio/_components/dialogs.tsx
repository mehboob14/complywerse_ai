'use client';

/** The studio's dialogs: export, move to the library, save into the library document, save as a template, the document's details.
 *  A dialog says what it does in its title; what a title cannot say is an (i) at the right of the header or beside a label, and
 *  only what prevents a mistake (a version that changes approvals, a file that keeps its own header) stays as a line.
 *
 *  On the design-system kit: fields are FormFields, buttons are Buttons, every dialog that holds typed input or a choice asks
 *  "Discard changes?" before Escape, X or a press outside throws it away (`dirty`), and every message says what the server said
 *  (cleaned), with a Retry where doing it again can help. A list or a check that could not load says so; it is not left blank. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CircleAlert, Download, FileText, Info, Send } from 'lucide-react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Checkbox, ErrorState, FormField, Select, SkeletonLines, TextInput, Textarea, useNotify, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { DOC_TYPE_LABEL, isConflict, problemOf, problemOfBlob, saveBlob, studioApi, type ExportNote, type ExportOptions, type MoveToLibrary, type Session } from '@/lib/studio/api';
import { ARCHIVED_NOTE, maySaveToLibrary, nextVersion, saveWarning, savedNote } from '@/lib/studio/text';
import AssetImage from './AssetImage';
import { RadioCards } from './RadioCards';
import { detailsOfSession } from './suggestModel';
import { StudioBar } from './StudioBar';
import { DocumentDetailsFields, useDocumentDetails } from '../../_DetailsFields';
import { NO_SIGNOFF, ReviewerApproverFields, saveSignoffChoice, type SignoffChoice } from '../../_SignoffControl';
import { detailsPayload } from '../../_detailsRead';
import { governanceApi } from '@/lib/api';
import DetailsDialog from '../../[id]/_DetailsDialog';
import { ProposeNote, useProposalRole, useProposedAnswer } from '../../[id]/_ProposalsView';
import { sendLabel } from '@/lib/proposals';
import { titleCase, withCurrent } from '../../_DetailsFields';

/** The dialog body's own padding (AnimatedModal gives none): arbitrary values, so it is the same in a portal as on a page. */
const BODY = 'px-[20px] py-[16px]';
const FOOTER = 'flex flex-wrap items-center justify-end gap-2';

type Change = 'major' | 'minor';
const CHANGES: { key: Change; label: string; hint: string }[] = [
  { key: 'minor', label: 'Minor change', hint: 'Meaning stays: wording, clarity, formatting' },
  { key: 'major', label: 'Major change', hint: 'Requirements change: rules, scope, roles, approvals' },
];

/** Minor or major: the person decides when the work goes into the library (the user, 2026-10-21: "let user decide it"), each option
 *  with the version it makes from `current`; nothing is chosen for them. `note`: what it does, as the (i). */
function VersionChoice({ current, value, onChange, note }: { current: string | null | undefined; value: Change | null; onChange: (c: Change) => void; note: string }) {
  return (
    <RadioCards
      legend="Type of change"
      info={note}
      value={value}
      onChange={onChange}
      options={CHANGES.map((c) => ({ value: c.key, label: `${c.label} → v${nextVersion(current, c.key)}`, hint: c.hint }))}
    />
  );
}

/** A failed download carries its sentence inside the blob: read it, and hand it on in the shape the kit's helpers clean (the status stays, for the retry rule). */
async function readableError(e: unknown): Promise<Error> {
  const message = await problemOfBlob(e);
  return Object.assign(new Error(message), { isAxiosError: true, response: { status: (e as { response?: { status?: number } })?.response?.status, data: { detail: message } } });
}

const NOTE_ICON = { error: CircleAlert, warning: AlertTriangle, info: Info } as const;
const NOTE_COLOUR = { error: 'text-ds-danger', warning: 'text-ds-warning', info: 'text-ds-info' } as const;
const NOTE_FILL = { error: 'bg-ds-danger-soft', warning: 'bg-ds-warning-soft', info: 'bg-ds-info-soft' } as const;

function Notes({ notes }: { notes: ExportNote[] }) {
  if (!notes.length) return null;
  return (
    <ul className="space-y-[6px]" aria-label="Before you export">
      {notes.map((n, i) => {
        const Icon = NOTE_ICON[n.level] ?? Info;
        return (
          <li key={i} className={`flex gap-[8px] rounded-ds-control px-[10px] py-[8px] text-ds-body text-ds-fg-body ${NOTE_FILL[n.level] ?? NOTE_FILL.info}`}>
            <Icon aria-hidden className={`mt-[2px] h-[16px] w-[16px] shrink-0 ${NOTE_COLOUR[n.level] ?? NOTE_COLOUR.info}`} strokeWidth={1.75} />
            <span className="min-w-0 break-words">{n.text}</span>
          </li>
        );
      })}
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
  const [format, setFormat] = useState<ExportOptions['format']>('docx');
  const [noLogo, setNoLogo] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => { flush().finally(() => setReady(true)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const options: ExportOptions = { format, no_logo: noLogo, highlight_placeholders: highlight };
  const check = useQuery({ queryKey: ['studio', 'export-check', session.id, session.revision, format, noLogo, session.instructions.logo_asset_id ?? 0, session.instructions.entity_name ?? ''], queryFn: () => studioApi.exportCheck(session.id, options), enabled: ready, staleTime: 0 });
  const download = useReportedMutation({
    mutationFn: async () => {
      await flush();
      try { return await studioApi.exportFile(session.id, options); } catch (e) { throw await readableError(e); }
    },
    success: (r) => ({ title: 'Exported', message: r.filename }),
    failure: 'Could not export',
    onSuccess: ({ blob, filename }) => { saveBlob(blob, filename); onClose(); },
  });
  const logoId = session.instructions.logo_asset_id;
  const atFoot = String(session.instructions.logo_position ?? '').startsWith('footer');
  const watermark = session.instructions.watermark ? (String(session.instructions.watermark_text ?? '').trim() || 'DRAFT') : '';
  const logo = logoId && !noLogo ? <AssetImage id={logoId} alt="Logo" className="h-8 max-w-[7rem] object-contain" /> : null;
  return (
    <AnimatedModal isOpen onClose={onClose} title="Export" subtitle={session.title} size="lg"
      footer={<div className={FOOTER}><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" leftIcon={<Download aria-hidden />} loading={download.isPending} disabled={!ready || check.data?.can_export === false} onClick={() => download.mutate()}>Download</Button></div>}>
      <div className={`space-y-[16px] ${BODY}`}>
        <RadioCards legend="Format" value={format} onChange={setFormat}
          options={FORMATS.map((f) => ({ value: f.value, label: f.label, hint: f.value === 'docx' && session.source.in_place ? 'Your original file with your changes' : f.hint }))} />
        {format === 'docx' && session.source.in_place && (
          // what a person would not expect: the file keeps its own header and footer, so no logo or entity name is added
          <StudioBar note>
            Your file keeps its own header, footer and styles, so the logo and entity name are not added
            {watermark ? <>; the watermark <strong className="font-[600]">“{watermark}”</strong> is added across its pages.</> : '.'}
          </StudioBar>
        )}
        {(format === 'pdf' || format === 'html' || (format === 'docx' && !session.source.in_place)) && (
          <div className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px] text-ds-body">
            <p className="flex items-center gap-[4px] text-ds-label text-ds-fg">On every page <InfoTip label="About the page header and footer" text="Change the logo, where it sits, the entity name or the watermark in Instructions." /></p>
            <dl className="mt-[6px] space-y-[6px] text-ds-body">
              <div className="flex items-center gap-[12px]">
                <dt className="w-[5rem] shrink-0 text-ds-fg-muted">Top</dt>
                <dd className="flex min-w-0 items-center gap-[12px]">{!atFoot && logo}<span className="truncate font-[600] text-ds-primary-text">{session.instructions.entity_name || <span className="font-normal text-ds-fg-muted">No entity name</span>}</span></dd>
              </div>
              <div className="flex items-center gap-[12px]">
                <dt className="w-[5rem] shrink-0 text-ds-fg-muted">Foot</dt>
                <dd className="flex min-w-0 items-center gap-[12px]"><span className="text-ds-fg-body">Code, version, page numbers</span>{atFoot && logo}</dd>
              </div>
              <div className="flex items-center gap-[12px]">
                <dt className="w-[5rem] shrink-0 text-ds-fg-muted">Watermark</dt>
                <dd className="text-ds-fg-body">{watermark ? <strong className="font-[600] text-ds-primary-text">“{watermark}”</strong> : 'None'}</dd>
              </div>
            </dl>
            {!logoId && <p className="mt-[6px] text-ds-label text-ds-fg-muted">No logo</p>}
            {logoId && <Checkbox className="mt-[4px]" label="Leave out the logo" checked={noLogo} onChange={(e) => setNoLogo(e.target.checked)} />}
          </div>
        )}
        {(format === 'pdf' || (format === 'docx' && !session.source.in_place)) && (
          <Checkbox label="Highlight placeholders" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
        )}
        {check.isLoading || !ready ? <SkeletonLines lines={2} label="Checking the document" />
          : check.isError && !check.data ? <ErrorState compact title="Couldn't check the document" message={errorMessage(check.error)} onRetry={canRetry(check.error) ? () => { void check.refetch(); } : undefined} />
          : check.data && <Notes notes={check.data.notes} />}
      </div>
    </AnimatedModal>
  );
}

// ── move to the library ──────────────────────────────────────────────────────
const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];
const REVIEW_MONTHS: Record<string, number> = { 'Every 6 months': 6, 'Every year': 12, 'Every two years': 24, 'Every three years': 36 };   // setup.REVIEW_CYCLES

export function MoveToLibraryDialog({ session, onClose, flush, onDone }: { session: Session; onClose: () => void; flush: () => Promise<void>; onDone: (docId: number) => void }) {
  const notify = useNotify();
  // what the setup chose, so the library document starts as the person set it up (the parent chosen when it was started, too);
  // the owner starts as the person
  const chosen = String(session.instructions.classification ?? '').toLowerCase();
  // a document made from a suggested one (New document → From a framework) carries the owner, department, dates and description typed then
  const typed = detailsOfSession(session.instructions);
  const details = useDocumentDetails({
    title: session.title,
    doc_type: session.doc_type === 'other' ? 'policy' : session.doc_type,
    classification: (CLASSIFICATIONS as readonly string[]).includes(chosen) ? chosen : 'internal',
    review_cycle_months: REVIEW_MONTHS[String(session.instructions.review_cycle ?? '')] ?? 12,
    parent_document_id: session.references.find((r) => r.kind === 'parent_document')?.source_id ?? null,
    ...(typed.owner_id != null ? { owner_id: typed.owner_id } : {}),
    ...(typed.department_id != null ? { department_id: typed.department_id } : {}),
    ...(typed.effective_date ? { effective_date: typed.effective_date } : {}),
    ...(typed.next_review_date ? { next_review_date: typed.next_review_date } : {}),
    ...(typed.description ? { description: typed.description } : {}),
  });
  // a field the person changed (the owner the form fills in by itself, and what a file's details fill in, do not count)
  const [touched, setTouched] = useState(false);
  const tracked: typeof details = { ...details, set: (patch) => { setTouched(true); details.set(patch); } };
  // the frameworks it was written against (its framework references) start ticked
  const initialFrameworks = Array.from(new Set(session.references.flatMap((r) => (r.kind === 'framework' && r.source_id != null ? [r.source_id] : []))));
  const [frameworks, setFrameworks] = useState<number[]>(() => initialFrameworks);
  const fws = useQuery({ queryKey: ['studio', 'frameworks'], queryFn: studioApi.frameworks, staleTime: 120_000 });
  // the reviewers and approvers chosen when the document was made from a suggested one start chosen (the baseline for "changed" too)
  const [startSignoff] = useState<SignoffChoice>(() => {
    const kept = (session.instructions.signoff ?? {}) as Partial<SignoffChoice>;
    return kept.reviewers?.length || kept.approvers?.length ? { reviewers: kept.reviewers ?? [], approvers: kept.approvers ?? [] } : NO_SIGNOFF;
  });
  const [signoff, setSignoff] = useState<SignoffChoice>(startSignoff);
  // an uploaded file changed here moves as two versions: the file as it states, then the person's minor or major one
  const original = session.original_version ?? null;
  const [change, setChange] = useState<Change | null>(null);
  const same = (a: number[], b: number[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const move = useReportedMutation({
    mutationFn: async () => {
      await flush();
      const r = await studioApi.moveToLibrary(session.id, { ...(detailsPayload(details.form) as Partial<MoveToLibrary>), framework_ids: frameworks,
                                                            ...(original && change ? { change_type: change } : {}) });
      try { await saveSignoffChoice(r.document_id, signoff); } catch (e) {
        notify.error(`${errorMessage(e)} Choose them in Submit for review.`, { title: 'The reviewers and approvers were not saved' });
      }
      return r;
    },
    success: (r) => ({ title: 'Moved to the library', message: `${r.title} is a draft, v${r.version}.` }),
    failure: 'Could not move it',
    retryable: false,                                                  // a second try could make a second library document
    onSuccess: (r) => onDone(r.document_id),
  });
  // what it becomes, in a few words; how, as the (i)
  const becomes = original ? `Draft; your file stays as v${original}` : session.kind === 'upload' && session.source.name ? 'Draft, at the version your file states' : 'Draft, v1.0';
  const becomesNote = original ? `It becomes a draft. Your uploaded file ${session.source.name ?? ''} is kept as version ${original}, the original.`
    : session.kind === 'upload' && session.source.name
    ? `It becomes a draft: your uploaded file ${session.source.name}, at the version it states. Statements are extracted from it as for any new document.`
    : 'It becomes a draft, version 1.0. Statements are extracted from it as for any new document.';
  const blocked = original && !change ? 'Choose a minor or a major change first' : undefined;
  return (
    <AnimatedModal isOpen onClose={onClose} title="Move to library" size="lg" subtitle={becomes}
      dirty={touched || !!change || signoff !== startSignoff || !same(frameworks, initialFrameworks)}
      headerAccessory={<InfoTip align="end" label="About moving to the library" text={becomesNote} />}
      footer={<div className={FOOTER}><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" leftIcon={<FileText aria-hidden />} loading={move.isPending} disabled={!details.form.title.trim() || !!blocked} title={blocked} onClick={() => move.mutate()}>Move to library</Button></div>}>
      <div className={`space-y-[16px] ${BODY}`}>
        {original && <VersionChoice current={original} value={change} onChange={setChange}
          note={`What you changed here becomes the next version after ${original}.`} />}
        <DocumentDetailsFields d={tracked} />
        <ReviewerApproverFields value={signoff} onChange={setSignoff} />
        {fws.isLoading && <SkeletonLines lines={2} label="Loading the frameworks" />}
        {fws.isError && !fws.data && <ErrorState compact title="Couldn't load the frameworks" message={errorMessage(fws.error)} onRetry={canRetry(fws.error) ? () => { void fws.refetch(); } : undefined} />}
        {fws.data && fws.data.items.length > 0 && (
          <fieldset>
            <legend className="sr-only">Frameworks (optional)</legend>
            <div className="flex items-center gap-[4px] text-ds-label text-ds-fg"><span aria-hidden>Frameworks (optional)</span><InfoTip label="About the frameworks" text="The frameworks this document must comply with." /></div>
            <div className="mt-[4px] grid max-h-[10rem] gap-x-[12px] overflow-y-auto rounded-ds-control border border-ds-border px-[8px] sm:grid-cols-2">
              {fws.data.items.map((f) => (
                <Checkbox key={f.id} label={<>{f.name}{f.version ? ` ${f.version}` : ''}</>} checked={frameworks.includes(f.id)}
                  onChange={(e) => setFrameworks(e.target.checked ? [...frameworks, f.id] : frameworks.filter((x) => x !== f.id))} />
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
  const notify = useNotify();
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
      if (!handledAsProposal(r, decider)) {
        const note = savedNote(r, session.document_status);
        if (note.message) notify.success(note.message, { title: note.title, duration: 8000 });      // a consequence to read (it is in review again): it stays longer than a bare "saved"
        else notify.success(note.title);
      }
      onDone();
    },
    // a refusal may be the document archived while this was open: the session is read again, so no "Save anyway" is offered then
    onError: (e, force) => {
      if (isConflict(e)) { setConflict(errorMessage(e)); onConflict?.(); }
      // nothing new since the library version (saved already, in another window): not a failure
      else if (/^Nothing has changed/.test(problemOf(e))) { notify.info(errorMessage(e), { title: 'Already saved in the library' }); onDone(); }
      else notify.error(e, { title: 'Could not save', retry: canRetry(e) ? () => save.mutate(force) : undefined });
    },
  });
  // the version everyone else reads until this one is published (GET /studio/sessions/{id}: document_version_in_force)
  const warning = saveWarning(session.document_status, session.document_version_in_force);
  // archived since the studio was opened (the session is read again when this opens): nothing is saved, nor offered
  const archived = session.document_status === 'archived';
  const blocked = !change ? 'Choose a minor or a major change first' : proposes && !reason.trim() ? `Write what changed and why for ${decider} first` : undefined;
  const label = proposes ? (conflict ? 'Send anyway' : sendLabel(decider)) : conflict ? 'Save anyway' : change ? `Save as v${nextVersion(current, change)}` : 'Save';
  return (
    <AnimatedModal isOpen onClose={onClose} title={proposes ? sendLabel(decider) : 'Save to library'} subtitle={session.title} size="md" dirty={!!change || reason.trim() !== ''}
      footer={<div className={FOOTER}><Button onClick={onClose}>Cancel</Button>
        {!archived && <Button variant="primary" leftIcon={proposes ? <Send aria-hidden /> : undefined} loading={save.isPending} disabled={!!blocked} title={blocked} onClick={() => save.mutate(!!conflict)}>{label}</Button>}</div>}>
      {archived ? <p className={`${BODY} text-ds-body text-ds-fg-body`} role="status">{ARCHIVED_NOTE}</p> : <div className={`space-y-[12px] ${BODY}`}>
        <VersionChoice current={current} value={change} onChange={setChange}
          note={proposes ? `Accepted, it becomes the next version after ${current ? `v${current}` : 'the one in the library'}.`
            : `It becomes the next version after ${current ? `v${current}` : 'the one in the library'}, and every version before stays.`} />
        {proposes ? (
          <ProposeNote id={`studio-send-${session.id}`} decider={decider} value={reason} onChange={setReason} placeholder="e.g. Updated the password rules" />
        ) : (
          <FormField label="What changed" optional><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Updated the password rules" /></FormField>
        )}
        {warning && !proposes && <StudioBar note tone="warning" icon={<AlertTriangle />}>{warning}</StudioBar>}
        {conflict && <StudioBar note tone="warning" role="alert">{conflict}</StudioBar>}
      </div>}
    </AnimatedModal>
  );
}

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
        <div className={BODY}>
          {docQ.isError
            ? <ErrorState compact title="Couldn't read the details" message={errorMessage(docQ.error)} onRetry={canRetry(docQ.error) ? () => { void docQ.refetch(); } : undefined} />
            : <SkeletonLines lines={4} label="Reading the details" />}
        </div>
      </AnimatedModal>
    );
  }
  return <DetailsDialog doc={docQ.data} open onClose={onClose} canEdit={maySaveToLibrary(session)} onSaved={(p) => void follow(p)} />;
}

function DraftDetails({ session, onClose, onChanged }: { session: Session; onClose: () => void; onChanged: (patch: Partial<Session>) => void }) {
  const [title, setTitle] = useState(session.title);
  const [docType, setDocType] = useState(session.doc_type);
  const unchanged = title.trim() === session.title && docType === session.doc_type;
  const save = useReportedMutation({
    mutationFn: () => studioApi.patchSession(session.id, { title: title.trim(), doc_type: docType }),
    success: 'Details saved',
    failure: 'Not saved',
    onSuccess: (s) => { onChanged({ title: s.title, doc_type: s.doc_type }); onClose(); },
  });
  const types = withCurrent(Object.entries(DOC_TYPE_LABEL), docType, titleCase);
  return (
    <AnimatedModal isOpen onClose={onClose} title="Details" subtitle={session.title} size="md" dirty={!unchanged}
      headerAccessory={<InfoTip align="end" label="About the other details" text="Its owner, classification, review cycle, dates, description, reviewers and approvers are asked when you move it to the library." />}
      footer={<div className={FOOTER}><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!title.trim() || unchanged} onClick={() => save.mutate()}>Save</Button></div>}>
      <div className={`space-y-[12px] ${BODY}`}>
        <FormField label="Title" required><TextInput value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
        <FormField label="Type">
          <Select value={docType} onChange={(e) => setDocType(e.target.value)}>{types.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </FormField>
      </div>
    </AnimatedModal>
  );
}

// ── save as a template ───────────────────────────────────────────────────────
export function SaveTemplateDialog({ session, onClose, getContent }: { session: Session; onClose: () => void; getContent: () => string }) {
  const own = session.template_id?.startsWith('tenant:') ? Number(session.template_id.split(':')[1]) : null;
  const startName = own ? session.title : `${session.title} template`;
  const [name, setName] = useState(startName);
  const [docType, setDocType] = useState(session.doc_type);
  const [description, setDescription] = useState('');
  const status = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 60_000 });
  const admin = !!status.data?.is_admin;
  const [wantDefault, setMakeDefault] = useState(true);
  const makeDefault = admin && wantDefault;                                           // only an administrator sets the organisation's default
  const [mode, setMode] = useState<'new' | 'update'>(own ? 'update' : 'new');
  const save = useReportedMutation({
    mutationFn: () => (mode === 'update' && own
      ? studioApi.updateTemplate(own, { name, doc_type: docType, description: description || undefined, content: getContent(), make_default: makeDefault })
      : studioApi.saveTemplate({ session_id: session.id, name, doc_type: docType, description: description || undefined, content: getContent(), make_default: makeDefault })),
    success: (t) => ({ title: 'Template saved', message: t.is_default ? `New ${DOC_TYPE_LABEL[t.doc_type] ?? t.doc_type} documents start from it.` : undefined }),
    failure: 'Could not save the template',
    retryable: false,                                                                  // a second try could make a second template
    onSuccess: () => onClose(),
  });
  const dirty = name !== startName || docType !== session.doc_type || description !== '' || mode !== (own ? 'update' : 'new') || wantDefault !== true;
  return (
    <AnimatedModal isOpen onClose={onClose} title="Save as a template" subtitle={session.title} size="md" dirty={dirty}
      headerAccessory={<InfoTip align="end" label="About templates" text="Your organisation’s own starting point, with its sections checked on every document." />}
      footer={<div className={FOOTER}><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Save template</Button></div>}>
      <div className={`space-y-[12px] ${BODY}`}>
        {own && (
          <RadioCards legend="Save" value={mode} onChange={setMode}
            options={[{ value: 'update', label: 'Update the original template' }, { value: 'new', label: 'Save as a new template' }]} />
        )}
        <FormField label="Name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Type">
          <Select value={docType} onChange={(e) => setDocType(e.target.value)}>{Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </FormField>
        <FormField label="Description" optional><TextInput value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
        <div className="flex items-start gap-[4px]">
          <Checkbox className="min-w-0 flex-1" checked={makeDefault} disabled={!admin} onChange={(e) => setMakeDefault(e.target.checked)}
            label={<>Default for every new {DOC_TYPE_LABEL[docType]?.toLowerCase() ?? 'document'}{!admin && <span className="block text-ds-label text-ds-fg-muted">Administrators only</span>}</>} />
          <InfoTip className="mt-[6px]" label="About the default" text="Every new document of this type starts from this template instead of the standard structure. Only an administrator can make a template the organisation’s default." />
        </div>
      </div>
    </AnimatedModal>
  );
}
