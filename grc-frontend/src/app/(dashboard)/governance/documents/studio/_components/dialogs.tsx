'use client';

/** The studio's dialogs: export, move to the library, save into the library document, save as a template, the document's details. */
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CircleAlert, Download, FileText, Info, Loader2 } from 'lucide-react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { useToast } from '@/components/ui/ToastProvider';
import { DOC_TYPE_LABEL, isConflict, problemOf, problemOfBlob, saveBlob, studioApi, type ExportNote, type ExportOptions, type MoveToLibrary, type Session } from '@/lib/studio/api';
import { ARCHIVED_NOTE, maySaveToLibrary, saveWarning, savedNote } from '@/lib/studio/text';
import AssetImage from './AssetImage';
import { DocumentDetailsFields, useDocumentDetails } from '../../_DetailsFields';
import { NO_SIGNOFF, ReviewerApproverFields, saveSignoffChoice, type SignoffChoice } from '../../_SignoffControl';
import { detailsPayload } from '../../_detailsRead';
import { governanceApi } from '@/lib/api';
import DetailsDialog from '../../[id]/_DetailsDialog';
import { titleCase, withCurrent } from '../../_DetailsFields';

const input = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';
const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50';
const secondary = 'rounded-lg border border-[#b8c4c8] bg-white px-3.5 py-2 text-sm font-semibold text-[#3f4b58] hover:bg-[#f1f3f5]';

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
  { value: 'docx', label: 'Word (.docx)', hint: 'Editable. Logo and entity name in the header, document code and page numbers in the footer, placeholders highlighted.' },
  { value: 'pdf', label: 'PDF', hint: 'For reading and sending. Same header and footer as Word.' },
  { value: 'md', label: 'Markdown (.md)', hint: 'The text and structure only.' },
  { value: 'html', label: 'Web page (.html)', hint: 'A single file you can open in a browser.' },
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
              <label key={f.value} className={`cursor-pointer rounded-lg border p-2.5 ${format === f.value ? 'border-[#0f766e] bg-[#f3fbf9] ring-1 ring-[#0f766e]' : 'border-[#c5ccd3] bg-white hover:bg-[#f8fafb]'}`}>
                <span className="flex items-center gap-2 text-sm font-semibold text-[#1f2933]"><input type="radio" name="export-format" checked={format === f.value} onChange={() => setFormat(f.value)} className="accent-[#0f766e]" /> {f.label}</span>
                <span className="mt-0.5 block pl-6 text-[11px] text-[#586472]">{f.value === 'docx' && session.source.in_place ? 'Your original file, with your changes written into it.' : f.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {format === 'docx' && session.source.in_place && (
          <p className="rounded-lg border border-[#d5dbe1] bg-[#f8fafb] p-3 text-sm text-[#3f4b58]">
            This is your original Word file with your changes written into it. Its own header, footer and styles stay as they are, so the logo and entity name from Instructions are not added
            {watermark ? <>; the watermark <strong>“{watermark}”</strong> is added across its pages.</> : '.'}
          </p>
        )}
        {(format === 'pdf' || format === 'html' || (format === 'docx' && !session.source.in_place)) && (
          <div className="rounded-lg border border-[#d5dbe1] bg-[#f8fafb] p-3 text-sm">
            <p className="text-xs font-semibold text-[#26323d]">On every page</p>
            <dl className="mt-1.5 space-y-1.5 text-xs">
              <div className="flex items-center gap-3">
                <dt className="w-20 shrink-0 text-[#586472]">Top</dt>
                <dd className="flex min-w-0 items-center gap-3">{!atFoot && logo}<span className="truncate font-semibold text-[#0f4c5c]">{session.instructions.entity_name || <span className="font-normal text-[#586472]">No entity name</span>}</span></dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="w-20 shrink-0 text-[#586472]">Foot</dt>
                <dd className="flex min-w-0 items-center gap-3"><span className="text-[#3f4b58]">Document code, version, page numbers</span>{atFoot && logo}</dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="w-20 shrink-0 text-[#586472]">Watermark</dt>
                <dd className="text-[#3f4b58]">{watermark ? <strong className="text-[#0f4c5c]">“{watermark}”</strong> : 'None'}</dd>
              </div>
            </dl>
            {!logoId && <p className="mt-1.5 text-xs text-[#586472]">No logo is chosen.</p>}
            {logoId && <label className="mt-2 flex items-center gap-2 text-xs text-[#26323d]"><input type="checkbox" checked={noLogo} onChange={(e) => setNoLogo(e.target.checked)} className="accent-[#0f766e]" /> Leave the logo out of this export</label>}
            <p className="mt-1 text-[11px] text-[#586472]">Change the logo, where it sits, the entity name or the watermark in Instructions.</p>
          </div>
        )}
        {(format === 'pdf' || (format === 'docx' && !session.source.in_place)) && (
          <label className="flex items-center gap-2 text-sm text-[#26323d]"><input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} className="accent-[#0f766e]" /> Highlight placeholders still to be filled in</label>
        )}
        {check.isLoading || !ready ? <p className="text-xs text-[#586472]"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Checking the document…</p> : check.data && <Notes notes={check.data.notes} />}
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
  const move = useMutation({
    mutationFn: async () => {
      await flush();
      const r = await studioApi.moveToLibrary(session.id, { ...(detailsPayload(details.form) as Partial<MoveToLibrary>), framework_ids: frameworks });
      try { await saveSignoffChoice(r.document_id, signoff); } catch (e) {
        toast({ title: 'The reviewers and approvers were not saved', message: `${problemOf(e)} Choose them in Submit for review.`, type: 'error' });
      }
      return r;
    },
    onSuccess: (r) => { toast({ title: 'Moved to the document library', message: `${r.title} is a draft, version ${r.version}.`, type: 'success' }); onDone(r.document_id); },
    onError: (e) => toast({ title: 'Could not move it', message: problemOf(e), type: 'error' }),
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Move to the document library" size="lg"
      subtitle={session.kind === 'upload' && session.source.name
        ? `It becomes a draft. Your uploaded file ${session.source.name} is kept as version 1.0, the original${session.revision > 1 ? '; what you changed here becomes version 1.1' : ''}. Statements are extracted from it as for any new document.`
        : 'It becomes a draft, version 1.0. Statements are extracted from it as for any new document.'}
      footer={<div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={!details.form.title.trim() || move.isPending} onClick={() => move.mutate()}>{move.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Move to the library</button></div>}>
      <div className="space-y-4 p-5">
        <DocumentDetailsFields d={details} />
        <ReviewerApproverFields value={signoff} onChange={setSignoff} />
        {fws.data && fws.data.items.length > 0 && (
          <fieldset>
            <legend className="text-xs font-semibold text-[#26323d]">Frameworks this document must comply with (optional)</legend>
            <div className="mt-1 grid max-h-32 gap-0.5 overflow-y-auto rounded border border-[#e1e5e9] p-2 sm:grid-cols-2">
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
export function SaveToDocumentDialog({ session, onClose, flush, onDone, onConflict }: { session: Session; onClose: () => void; flush: () => Promise<void>; onDone: () => void; onConflict?: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (force: boolean) => { await flush(); return studioApi.saveToDocument(session.id, { change_reason: reason || undefined, force }); },
    onSuccess: (r) => { toast({ ...savedNote(r, session.document_status), type: 'success' }); onDone(); },
    // a refusal may be the document archived while this was open: the session is read again, so no "Save anyway" is offered then
    onError: (e) => { if (isConflict(e)) { setConflict(problemOf(e)); onConflict?.(); } else toast({ title: 'Could not save', message: problemOf(e), type: 'error' }); },
  });
  // the version everyone else reads until this one is published (GET /studio/sessions/{id}: document_version_in_force)
  const warning = saveWarning(session.document_status, session.document_version_in_force);
  // archived since the studio was opened (the session is read again when this opens): nothing is saved, nor offered
  const archived = session.document_status === 'archived';
  return (
    <AnimatedModal isOpen onClose={onClose} title="Save to the library" subtitle={`${session.title} — saved as its next version`} size="md"
      footer={<div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        {!archived && <button type="button" className={primary} disabled={save.isPending} onClick={() => save.mutate(!!conflict)}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {conflict ? 'Save anyway' : 'Save as a new version'}</button>}</div>}>
      {archived ? <p className="p-5 text-sm text-[#26323d]" role="status">{ARCHIVED_NOTE}</p> : <div className="space-y-3 p-5">
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">What changed (optional)</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Updated the password rules to match the new standard" className={`${input} mt-1`} /></label>
        {warning && <p className="flex gap-1.5 rounded-lg bg-[#fffbed] px-2.5 py-2 text-xs text-[#6b4e00]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {warning}</p>}
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
        <p className="p-5 text-sm text-[#3f4b58]" role="status">
          {docQ.isError ? problemOf(docQ.error, 'The details could not be read.') : <><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Reading the details…</>}
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
      footer={<div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={!title.trim() || save.isPending || (title.trim() === session.title && docType === session.doc_type)}
          onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save</button></div>}>
      <div className="space-y-3 p-5">
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} mt-1`} /></label>
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">Type</span>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={`${input} mt-1`}>{types.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <p className="flex gap-2 rounded-lg bg-[#f1f5fb] px-2.5 py-2 text-xs text-[#33475e]"><Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Its owner, classification, review cycle, dates, description, reviewers and approvers are asked when you move it to the library (Move to the library).</span></p>
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
    <AnimatedModal isOpen onClose={onClose} title="Save as a template" subtitle="Your organisation’s own starting point, with its sections checked on every document." size="md"
      footer={<div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        <button type="button" className={primary} disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save template</button></div>}>
      <div className="space-y-3 p-5">
        {own && (
          <fieldset className="space-y-1">
            <label className="flex items-center gap-2 text-sm text-[#26323d]"><input type="radio" checked={mode === 'update'} onChange={() => setMode('update')} className="accent-[#0f766e]" /> Update the template this document started from</label>
            <label className="flex items-center gap-2 text-sm text-[#26323d]"><input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} className="accent-[#0f766e]" /> Save as a new template</label>
          </fieldset>
        )}
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">Name</span><input value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1`} /></label>
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">Document type</span>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={`${input} mt-1`}>{Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">Description (optional)</span><input value={description} onChange={(e) => setDescription(e.target.value)} className={`${input} mt-1`} /></label>
        <label className={`flex items-start gap-2 text-sm ${admin ? 'text-[#26323d]' : 'text-[#7b8794]'}`}>
          <input type="checkbox" checked={makeDefault} disabled={!admin} onChange={(e) => setMakeDefault(e.target.checked)} className="mt-1 accent-[#0f766e]" />
          <span>Use it for every new {DOC_TYPE_LABEL[docType]?.toLowerCase() ?? 'document'} instead of the standard structure{!admin && <span className="block text-[11px]">Only an administrator can make a template the organisation’s default.</span>}</span>
        </label>
      </div>
    </AnimatedModal>
  );
}
