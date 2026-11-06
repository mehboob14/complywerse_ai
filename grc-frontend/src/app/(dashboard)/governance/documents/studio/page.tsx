'use client';

export const dynamic = 'force-dynamic';

/**
 * Comply AI Studio home, on one screen: four ways to start (write, upload, edit from the library, compare) as small tiles, each
 * opening its own popup, and the work in progress next to the templates, each scrolling inside its own panel. Labels, not
 * sentences: what a tile or a panel used to explain is its tooltip or an (i).
 *
 * On the design-system kit: the page head, the buttons, the fields and the states (a list that is loading, empty or could not be
 * read says so: a failed request is never "Nothing yet"); the popups ask "Discard changes?" before typed input is thrown away; a
 * question before something is deleted is the kit's confirm; every message is the kit's, with the server's own words.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BookMarked, FilePlus2, FileText, GitCompare, Layers, Library, Search, Sparkles, Trash2, Upload, X, type LucideIcon } from 'lucide-react';
import apiClient from '@/lib/api';
import { truncate } from '@/lib/format';
import { PageHeader, PageLoader } from '@/components/ui';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, EmptyState, ErrorState, FormField, IconButton, Select, SkeletonRows, TabPanel, Tabs, Textarea, TextInput, useConfirm, useNotify, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { DOC_TYPE_LABEL, studioApi, type FrameworkItem, type LibraryDoc, type Session, type TemplateItem } from '@/lib/studio/api';
import { ago, plural } from '@/lib/studio/text';
import { documentApi } from '@/lib/studio/documentApi';
import { FrameworkList, PICK_ROW } from './_components/ReferencesPanel';
import { StudioBar } from './_components/StudioBar';
import SuggestedDocs from './_components/SuggestedDocs';
import { DocumentDetailsFields, titleCase, useDocumentDetails } from '../_DetailsFields';
import { NO_SIGNOFF, ReviewerApproverFields, SIGNOFF_STATUS, saveSignoffChoice, type SignoffChoice } from '../_SignoffControl';
import { detailsPayload } from '../_detailsRead';
import { docLine, pickable, templateMeta, templateName, workAction, workCount } from './_components/homeLists';

/** The dialogs' own padding (the dialog body has none): arbitrary values, so they are the same in a portal as on the page. */
const BODY = 'px-[20px] py-[16px]';
/** A button that reads as a link inside a sentence ("choose one", "compare it"): a link in running text is not a 24px target, the line is. */
const INLINE_LINK = 'rounded-[2px] font-[600] text-ds-primary-text underline underline-offset-2 hover:text-ds-primary-hover focus-visible:outline-none focus-visible:shadow-ds-ring';
/** A chip of the references chosen for a new document. */
const CHOSEN = 'inline-flex max-w-full items-center gap-[4px] rounded-full bg-ds-primary-soft py-[2px] pl-[10px] pr-[2px] text-ds-label text-ds-primary-text';

function useDocs(q: string, editable: boolean) {
  return useQuery({ queryKey: ['studio', 'documents', q, 12, editable], queryFn: () => studioApi.documents(q, 12, editable), staleTime: 30_000 });
}

function DocList({ onPick, exclude, list = 'max-h-52', focus = false, empty = 'No document found.', editable = false }: { onPick: (d: LibraryDoc) => void; exclude?: number[]; list?: string; focus?: boolean; empty?: string; editable?: boolean }) {
  const [q, setQ] = useState('');
  const docs = useDocs(q, editable);         // to edit: the server lists only those the person may change
  const rows = pickable(docs.data?.items ?? [], { exclude, editable });
  return (
    <div>
      <TextInput type="search" aria-label="Search the library" autoFocus={focus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the document library" leftAdornment={<Search aria-hidden />} />
      <ul className={`mt-[8px] space-y-[4px] overflow-y-auto ${list}`}>
        {docs.isLoading && <li><SkeletonRows rows={3} columns={1} label="Loading the library" /></li>}
        {docs.isError && !docs.data && <li><ErrorState compact title="Couldn't load the library" message={errorMessage(docs.error)} onRetry={canRetry(docs.error) ? () => { void docs.refetch(); } : undefined} /></li>}
        {docs.data && rows.length === 0 && <li className="p-[8px] text-ds-body text-ds-fg-muted">{empty}</li>}
        {rows.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => onPick(d)} className={PICK_ROW}>
              <FileText aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
              <span className="min-w-0 flex-1"><span className="block truncate text-ds-body text-ds-fg" title={d.title}>{d.title}</span><span className="block text-ds-label text-ds-fg-muted">{docLine(d, DOC_TYPE_LABEL, SIGNOFF_STATUS)}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── write a new document ─────────────────────────────────────────────────────
/** What the library's “+ Draft” buttons and the recommended documents hand over (as query parameters). */
interface Prefill { title: string; type: string; description: string; parent: number | null; frameworks: number[] }

function readPrefill(search: URLSearchParams | null): Prefill | null {
  const title = search?.get('title');
  if (!title) return null;
  const ids = (v: string | null) => (v ? v.split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number) : []);
  const type = search?.get('type') ?? 'policy';
  return { title, type: type in DOC_TYPE_LABEL ? type : 'policy', description: search?.get('description') ?? '', parent: ids(search?.get('parent') ?? null)[0] ?? null, frameworks: ids(search?.get('frameworks') ?? null) };
}

/** A reference chosen for the new document: a pill with its own "remove". */
function ChosenRef({ icon: Icon, text, remove, removeLabel }: { icon: LucideIcon; text: string; remove: () => void; removeLabel: string }) {
  return (
    <li className={CHOSEN}>
      <Icon aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 truncate">{text}</span>
      <button type="button" onClick={remove} aria-label={removeLabel} className="grid h-[var(--ds-control-h-sm)] w-[var(--ds-control-h-sm)] shrink-0 place-items-center rounded-full hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">
        <X aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />
      </button>
    </li>
  );
}

function NewDocumentDialog({ onClose, onOpen, prefill }: { onClose: () => void; onOpen: (s: Session) => void; prefill: Prefill | null }) {
  const notify = useNotify();
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [docType, setDocType] = useState(prefill?.type ?? 'policy');
  const [description, setDescription] = useState(prefill?.description ?? '');
  const [templateId, setTemplateId] = useState('default');
  const [parent, setParent] = useState<LibraryDoc | null>(null);
  const [refDocs, setRefDocs] = useState<LibraryDoc[]>([]);
  const [fws, setFws] = useState<FrameworkItem[]>([]);
  const [picking, setPicking] = useState<'parent' | 'document' | 'framework' | null>(null);
  const [touched, setTouched] = useState(false);                         // the person changed something (what the page handed over does not count)
  const [tab, setTab] = useState<'write' | 'suggested'>('write');
  const [suggestedDirty, setSuggestedDirty] = useState(false);            // a suggested document's details are being filled in
  const edit = <T,>(set: (v: T) => void) => (v: T) => { setTouched(true); set(v); };
  const templates = useQuery({ queryKey: ['studio', 'templates'], queryFn: studioApi.templates, staleTime: 60_000 });
  const frameworks = useQuery({ queryKey: ['studio', 'frameworks'], queryFn: studioApi.frameworks, staleTime: 120_000, enabled: picking === 'framework' || !!prefill?.frameworks.length });
  const group = useId();

  // references handed over by the page that sent us here
  useEffect(() => {
    if (!prefill?.parent) return;
    apiClient.get(`/governance/documents/${prefill.parent}`).then((r) => setParent({ id: r.data.id, title: r.data.title, code: r.data.document_code ?? null, doc_type: r.data.doc_type, status: r.data.status, version: r.data.current_version, has_file: !!r.data.file_name, has_text: !!r.data.content })).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!prefill?.frameworks.length || !frameworks.data) return;
    setFws((cur) => (cur.length ? cur : frameworks.data.items.filter((f) => prefill.frameworks.includes(f.id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameworks.data]);

  const start = useMutation({
    mutationFn: async () => {
      const s = await studioApi.createSession({ kind: 'new', title, doc_type: docType, template_id: templateId === 'default' ? null : templateId, instructions: description.trim() ? { focus_areas: description.trim() } : undefined });
      const failed: string[] = [];
      const attach = async (body: Parameters<typeof studioApi.addReference>[1], label: string) => { try { await studioApi.addReference(s.id, body); } catch (e) { failed.push(`${label}: ${errorMessage(e)}`); } };
      if (parent) await attach({ kind: 'parent_document', source_id: parent.id }, parent.title);
      for (const d of refDocs) await attach({ kind: 'document', source_id: d.id }, d.title);
      for (const f of fws) await attach({ kind: 'framework', source_id: f.id, scope: { mode: 'all' } }, f.name);
      if (failed.length) notify.warning(failed.join('\n'), { title: 'Some references could not be added' });
      return s;
    },
    onSuccess: onOpen,
    onError: (e) => notify.error(e, { title: 'Could not start the document' }),         // not offered again: a second try could make a second document
  });
  const forType = (templates.data?.items ?? []).filter((t) => t.doc_type === docType || t.id === 'builtin:blank');
  const pickButton = (key: 'parent' | 'document' | 'framework', Icon: LucideIcon, text: string) => (
    <Button size="sm" aria-pressed={picking === key} leftIcon={<Icon aria-hidden />} onClick={() => setPicking(picking === key ? null : key)}
      className={picking === key ? '!border-ds-primary !bg-ds-primary-soft !text-ds-primary-text' : ''}>{text}</Button>
  );
  return (
    <AnimatedModal isOpen onClose={onClose} title="New document" size={tab === 'suggested' ? 'xl' : 'lg'} dirty={touched || suggestedDirty}
      footer={tab === 'write' ? <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" leftIcon={<Sparkles aria-hidden />} loading={start.isPending} disabled={!title.trim()} onClick={() => start.mutate()}>Start writing</Button></div> : undefined}>
      <Tabs tabs={[{ key: 'write', label: 'Write' }, { key: 'suggested', label: 'From a framework' }]} value={tab} onChange={setTab} ariaLabel="How to start the document" className="px-[20px] pt-[4px]">
      <TabPanel tabKey="write">
      <div className="space-y-[12px] py-[16px]">
        <div className="grid gap-[12px] sm:grid-cols-[1fr_11rem]">
          <FormField label="Title" required><TextInput autoFocus value={title} onChange={(e) => edit(setTitle)(e.target.value)} placeholder="e.g. Information Security Policy" /></FormField>
          <FormField label="Type">
            <Select value={docType} onChange={(e) => { setTouched(true); setDocType(e.target.value); setTemplateId('default'); }}>{Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </FormField>
        </div>
        <FormField label="What should it cover?" optional><Textarea value={description} onChange={(e) => edit(setDescription)(e.target.value)} rows={2} placeholder="Scope, audience, focus" /></FormField>
        <FormField label="Starting point">
          <Select value={templateId} onChange={(e) => edit(setTemplateId)(e.target.value)}>
            <option value="default">{docType === 'other' ? 'Blank document' : 'The default template for this type'}</option>
            {forType.map((t) => <option key={t.id} value={t.id}>{t.name}{t.builtin ? '' : ' (yours)'}</option>)}
          </Select>
        </FormField>
        <div role="group" aria-labelledby={group}>
          <p id={group} className="text-ds-label text-ds-fg">References <span className="font-normal text-ds-fg-muted">(optional)</span></p>
          <div className="mt-[6px] flex flex-wrap gap-[6px]">
            {pickButton('parent', Layers, 'Parent document')}
            {pickButton('document', FileText, 'Reference document')}
            {pickButton('framework', BookMarked, 'Framework')}
          </div>
          {(parent || refDocs.length > 0 || fws.length > 0) && (
            <ul className="mt-[8px] flex flex-wrap gap-[6px]" aria-label="Chosen references">
              {parent && <ChosenRef icon={Layers} text={`Parent: ${parent.title}`} removeLabel="Remove the parent" remove={() => edit(setParent)(null)} />}
              {refDocs.map((d) => <ChosenRef key={d.id} icon={FileText} text={d.title} removeLabel={`Remove ${d.title}`} remove={() => edit(setRefDocs)(refDocs.filter((x) => x.id !== d.id))} />)}
              {fws.map((f) => <ChosenRef key={f.id} icon={BookMarked} text={f.name} removeLabel={`Remove ${f.name}`} remove={() => edit(setFws)(fws.filter((x) => x.id !== f.id))} />)}
            </ul>
          )}
          {picking === 'parent' && <div className="mt-[8px]"><DocList focus onPick={(d) => { setTouched(true); setParent(d); setPicking(null); }} /></div>}
          {picking === 'document' && <div className="mt-[8px]"><DocList focus exclude={refDocs.map((d) => d.id)} onPick={(d) => { setTouched(true); setRefDocs([...refDocs, d]); setPicking(null); }} /></div>}
          {picking === 'framework' && (
            <div className="mt-[8px]">
              <FrameworkList frameworks={frameworks.data?.items} loading={frameworks.isLoading} error={frameworks.isError ? frameworks.error : null} onRetry={() => { void frameworks.refetch(); }}
                exclude={fws.map((f) => f.id)} maxHeight="max-h-56" onPick={(f) => { setTouched(true); setFws([...fws, f]); setPicking(null); }} />
            </div>
          )}
        </div>
      </div>
      </TabPanel>
      <TabPanel tabKey="suggested" lazy>
        <div className="py-[16px]"><SuggestedDocs onOpen={onOpen} onDirty={setSuggestedDirty} onCancel={onClose} /></div>
      </TabPanel>
      </Tabs>
    </AnimatedModal>
  );
}

// ── upload ───────────────────────────────────────────────────────────────────
/** Choose a file → its details are read from it → the person confirms them → it opens (and is in the library as a draft). */
function UploadDialog({ onClose, onOpen, maxMb }: { onClose: () => void; onOpen: (s: Session) => void; maxMb: number }) {
  const notify = useNotify();
  const file = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const details = useDocumentDetails();
  const [signoff, setSignoff] = useState<SignoffChoice>(NO_SIGNOFF);
  const upload = useMutation({
    mutationFn: async () => {
      const s = await studioApi.uploadSession(chosen!, details.form.doc_type, details.form.title, detailsPayload(details.form));
      if (s.document_id) {
        try { await saveSignoffChoice(s.document_id, signoff); } catch (e) {
          notify.error(`${errorMessage(e)} Choose them in Submit for review.`, { title: 'The reviewers and approvers were not saved' });
        }
      }
      return s;
    },
    onSuccess: onOpen,
    onError: (e) => notify.error(e, { title: 'That file could not be opened' }),                // not offered again: the file would be added to the library twice
  });
  const take = (f?: File | null) => {
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) { notify.error(`Up to ${maxMb} MB.`, { title: 'That file is too large' }); return; }
    setChosen(f);
    details.read(f);
  };
  return (
    <AnimatedModal isOpen onClose={onClose} title="Upload a document" size={chosen ? 'lg' : 'md'} dirty={!!chosen}
      footer={chosen ? <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" leftIcon={<Upload aria-hidden />} loading={upload.isPending} disabled={!details.form.title.trim() || details.reading} onClick={() => upload.mutate()}>Open</Button></div> : undefined}>
      <div className={`space-y-[12px] ${BODY}`}>
        <input ref={file} type="file" hidden aria-label="Choose a file" accept=".docx,.pdf,.txt,.md,.markdown,.html,.htm" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
        {chosen ? (
          <div className="flex items-center gap-[8px] rounded-ds-card bg-ds-primary-soft px-[12px] py-[6px] text-ds-body text-ds-fg"><FileText aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} /><span className="min-w-0 flex-1 truncate" title={chosen.name}>{chosen.name}</span>
            <Button variant="link" size="sm" onClick={() => file.current?.click()}>Change</Button></div>
        ) : (
          <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
            className={`rounded-ds-card border-2 border-dashed p-[24px] text-center ${over ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border-strong bg-ds-surface-subtle'}`}>
            <Upload aria-hidden className="mx-auto h-[24px] w-[24px] text-ds-fg-muted" strokeWidth={1.75} />
            <p className="mt-[4px] text-ds-body text-ds-fg-body">Drop a file here, or <button type="button" onClick={() => file.current?.click()} className={INLINE_LINK}>choose one</button></p>
            <p className="mt-[2px] text-ds-label text-ds-fg-muted">Word, PDF, text or HTML · up to {maxMb} MB</p>
          </div>
        )}
        {chosen && <DocumentDetailsFields d={details} />}
        {chosen && <ReviewerApproverFields value={signoff} onChange={setSignoff} />}
      </div>
    </AnimatedModal>
  );
}

// ── open a library document / compare ───────────────────────────────────────
function LibraryDialog({ onClose, onCompare }: { onClose: () => void; onCompare: () => void }) {
  const notify = useNotify();
  const router = useRouter();
  const open = useMutation({
    mutationFn: (d: LibraryDoc) => documentApi.draft(d.id),          // the person's one draft of the document, reused
    onSuccess: (r) => router.push(`/governance/documents/studio/${r.session_id}`),
    onError: (e) => notify.error(e, { title: 'Could not open it' }),
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Edit a document from the library" size="lg">
      <div className={BODY}>
        <p className="mb-[8px] text-ds-body text-ds-fg-body">Documents you may edit. To read any other, <button type="button" onClick={onCompare} className={INLINE_LINK}>compare it</button>.</p>
        {open.isPending ? <SkeletonRows rows={2} columns={1} label="Opening the document" />
          : <DocList focus editable list="max-h-[50vh]" empty="No document you may edit was found." onPick={(d) => open.mutate(d)} />}
      </div>
    </AnimatedModal>
  );
}

function CompareDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (sessionId: number, compareWith: LibraryDoc) => void }) {
  const notify = useNotify();
  const [a, setA] = useState<LibraryDoc | null>(null);
  const [b, setB] = useState<LibraryDoc | null>(null);
  const go = useMutation({
    // in the person's own draft of the first document when they may change it; otherwise a session to read and compare in (the
    // server refuses to save it back to the library)
    mutationFn: async () => {
      try { return (await documentApi.draft(a!.id)).session_id; } catch (e: any) {
        if (e?.response?.status !== 403) throw e;
        return (await studioApi.createSession({ kind: 'library', document_id: a!.id })).id;
      }
    },
    onSuccess: (sid) => onOpen(sid, b!),
    onError: (e) => notify.error(e, { title: 'Could not compare them' }),
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Compare two documents" size="xl"
      footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" leftIcon={<GitCompare aria-hidden />} loading={go.isPending} disabled={!a || !b} onClick={() => go.mutate()}>Compare</Button></div>}>
      <div className={`grid gap-[16px] sm:grid-cols-2 ${BODY}`}>
        {[{ label: 'First document', value: a, set: setA, other: b }, { label: 'Compare it with', value: b, set: setB, other: a }].map((slot) => (
          <div key={slot.label} role="group" aria-label={slot.label}>
            <span className="text-ds-label text-ds-fg">{slot.label}</span>
            {slot.value ? (
              <div className="mt-[4px] flex items-center gap-[8px] rounded-ds-card bg-ds-primary-soft px-[12px] py-[6px] text-ds-body text-ds-fg"><span className="min-w-0 flex-1 truncate" title={slot.value.title}>{slot.value.title}</span><Button variant="link" size="sm" onClick={() => slot.set(null)}>Change</Button></div>
            ) : <div className="mt-[4px]"><DocList focus={slot.label === 'First document'} list="max-h-[40vh]" exclude={slot.other ? [slot.other.id] : undefined} onPick={(d) => slot.set(d)} /></div>}
          </div>
        ))}
      </div>
    </AnimatedModal>
  );
}

// ── the home screen ──────────────────────────────────────────────────────────
type Start = 'new' | 'upload' | 'library' | 'compare';

// the tile says one or two words; what it used to say underneath is its tooltip (and what a screen reader hears after the name)
const STARTS: { key: Start; icon: LucideIcon; title: string; tip: string }[] = [
  { key: 'new', icon: FilePlus2, title: 'Write', tip: 'Write a new document: template and references' },
  { key: 'upload', icon: Upload, title: 'Upload', tip: 'Upload a document: Word, PDF, text or HTML' },
  { key: 'library', icon: Library, title: 'Edit', tip: 'Edit a document from the library: edit, save a version' },
  { key: 'compare', icon: GitCompare, title: 'Compare', tip: 'Compare two documents: redline and what matters' },
];

/** A panel of the home screen: a title bar and a body that scrolls on its own. `min-w-0`: a long title shortens in its row instead of widening the panel. */
function Panel({ title, count, info, tools, children }: { title: string; count?: string; info?: string; tools?: React.ReactNode; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex max-h-[28rem] min-h-0 min-w-0 flex-col rounded-ds-card border border-ds-border bg-ds-surface lg:max-h-none">
      <div className="flex flex-wrap items-center gap-[8px] border-b border-ds-border px-[14px] py-[8px]">
        <h2 id={id} className="min-w-0 !text-ds-section !text-ds-fg">{title}</h2>
        {count !== undefined && <span className="rounded-full bg-ds-surface-hover px-[8px] text-ds-label tabular-nums text-ds-fg-muted">{count}</span>}
        {/* the (i) is at the right end, its note opens leftwards: the Templates panel is the right-hand one, a note opening rightwards would leave the screen */}
        <div className="ml-auto flex items-center gap-[8px]">{tools}{info && <InfoTip align="end" text={info} label={`About ${title.toLowerCase()}`} />}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

/** A list that loads: grey bars, "Loading" said once. */
const Loading = ({ label }: { label: string }) => <div className="px-[14px] py-[4px]"><SkeletonRows rows={3} columns={2} label={label} /></div>;

function YourWork({ sessions, loading, error, onRetry, onOpen, onDiscard, onRemove }: { sessions: Session[]; loading: boolean; error: unknown; onRetry: () => void; onOpen: (id: number) => void; onDiscard: (s: Session) => void; onRemove: (s: Session) => void }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => sessions.filter((s) => !q.trim() || s.title.toLowerCase().includes(q.trim().toLowerCase())), [sessions, q]);
  const failed = error != null && sessions.length === 0;                  // a list that could not be read is not an empty one
  const search = sessions.length > 5 && (
    <TextInput type="search" aria-label="Search your work" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" leftAdornment={<Search aria-hidden />} className="w-[10rem]" />
  );
  return (
    <Panel title="Your work" count={failed || loading ? undefined : workCount(sessions.length)} tools={search}>
      {loading ? <Loading label="Loading your work" />
        : failed ? <ErrorState compact title="Couldn't load your work" message={errorMessage(error)} onRetry={canRetry(error) ? onRetry : undefined} />
        : !sessions.length ? <EmptyState bare kind="firstUse" icon={FileText} title="Nothing yet" />
        : !rows.length ? <EmptyState bare kind="noMatches" title="No match" action={<Button onClick={() => setQ('')}>Clear search</Button>} /> : (
          <ul className="divide-y divide-ds-border">
            {rows.map((s) => (
              <li key={s.id} className="flex items-center gap-[4px] pl-[14px] pr-[8px] hover:bg-ds-surface-hover">
                <button type="button" onClick={() => onOpen(s.id)} className="flex min-w-0 flex-1 items-center gap-[10px] rounded-ds-control py-[8px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring">
                  <span className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-ds-control bg-ds-primary-soft text-ds-primary-text"><FileText aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-[6px]"><span className="truncate text-ds-body font-[600] text-ds-fg" title={s.title}>{s.title}</span>
                      {s.document_id ? <span title="In the library" aria-label="In the library" className="shrink-0 text-ds-primary-text"><Library aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} /></span> : null}</span>
                    <span className="block truncate text-ds-label text-ds-fg-muted">{DOC_TYPE_LABEL[s.doc_type] ?? titleCase(s.doc_type)} · {plural(s.words, 'word')} · rev {s.revision}{!s.document_id && s.source?.name ? ` · ${s.source.name}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-ds-label text-ds-fg-muted">{ago(s.updated_at)}</span>
                </button>
                {/* a library document the person may change (an upload is one) is archived in the library, never removed here; a draft
                    can be discarded, and a document they may only read (a comparison) removed from their work */}
                {workAction(s) === 'discard' ? <IconButton label={`Discard draft ${s.title}`} title="Discard this draft (it was never in the library)" onClick={() => onDiscard(s)}><Trash2 aria-hidden /></IconButton>
                  : workAction(s) === 'remove' ? <IconButton label={`Remove ${s.title} from my work`} title="Remove from my work (the document stays in the library)" onClick={() => onRemove(s)}><X aria-hidden /></IconButton>
                  : <span aria-hidden className="w-[var(--ds-control-h)] shrink-0" />}
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
}

function Templates({ onUse }: { onUse: (t: TemplateItem) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const templates = useQuery({ queryKey: ['studio', 'templates'], queryFn: studioApi.templates, staleTime: 60_000 });
  const remove = useReportedMutation({
    mutationFn: (t: TemplateItem) => studioApi.deleteTemplate(Number(t.id.split(':')[1])),
    success: (_r, t) => ({ title: 'Template deleted', message: templateName(t.name) }),
    failure: "Couldn't delete the template",
    invalidate: [['studio', 'templates']],
  });
  const ask = async (t: TemplateItem) => {
    if (await confirm({ title: `Delete the template “${truncate(templateName(t.name), 80).text}”?`, message: 'Documents already written from it are not changed.', confirmLabel: 'Delete template', tone: 'danger' })) remove.mutate(t);
  };
  const failed = templates.isError && !templates.data;
  const rows = (templates.data?.items ?? []).filter((t) => t.id !== 'builtin:blank');
  return (
    <Panel title="Templates" count={templates.data ? String(rows.length) : undefined} info="Open a template, change it, then use Save as a template: it becomes your organisation's default for that type, and its sections are checked on every document of that type.">
      {templates.isLoading ? <Loading label="Loading the templates" />
        : failed ? <ErrorState compact title="Couldn't load the templates" message={errorMessage(templates.error)} onRetry={canRetry(templates.error) ? () => { void templates.refetch(); } : undefined} />
        : rows.length === 0 ? <EmptyState bare kind="firstUse" icon={FileText} title="No templates" /> : (
          <ul className="divide-y divide-ds-border">
            {rows.map((t) => (
              <li key={t.id} title={t.description || undefined} className="flex items-center gap-[8px] py-[2px] pl-[14px] pr-[8px] hover:bg-ds-surface-hover">
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-[8px]">
                  <span className="truncate text-ds-body font-[600] text-ds-fg" title={templateName(t.name)}>{templateName(t.name)}</span>
                  {t.is_default && !t.builtin && <span className="shrink-0 rounded-full bg-ds-primary-soft px-[6px] text-ds-label text-ds-primary-text">default</span>}
                  {t.builtin && t.replaced_by_default && <span className="shrink-0 rounded-full bg-ds-surface-hover px-[6px] text-ds-label text-ds-fg-muted">replaced</span>}
                  <span className="shrink-0 whitespace-nowrap text-ds-label text-ds-fg-muted">{templateMeta({ name: t.name, doc_type: t.doc_type, sections: t.structure?.sections.length ?? 0 }, DOC_TYPE_LABEL)}</span>
                </span>
                <Button variant="link" size="sm" onClick={() => onUse(t)}>{t.builtin ? 'Customise' : 'Edit'}</Button>
                {!t.builtin && <IconButton label={`Delete ${t.name}`} title="Delete this template" disabled={remove.isPending} onClick={() => void ask(t)}><Trash2 aria-hidden /></IconButton>}
              </li>
            ))}
          </ul>
        )}
      {confirmDialog}
    </Panel>
  );
}

export default function StudioHomePage() {
  const router = useRouter();
  const search = useSearchParams();
  const prefill = readPrefill(search);
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  // the library's “+ Draft” (a prefill) and AI Draft (?new=1) land in the new-document popup
  const [dialog, setDialog] = useState<Start | null>(prefill || search?.get('new') === '1' ? 'new' : null);
  const status = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 60_000 });
  const sessions = useQuery({ queryKey: ['studio', 'sessions'], queryFn: studioApi.sessions, enabled: !!status.data?.enabled });
  // Discard draft / Remove: asked first; the work leaves the list once the server has said so
  const discard = useReportedMutation({
    mutationFn: (s: Session) => studioApi.deleteSession(s.id),
    success: (_r, s) => ({ title: 'Draft discarded', message: truncate(s.title, 80).text }),
    failure: "Couldn't discard the draft",
    invalidate: [['studio', 'sessions']],
  });
  const remove = useReportedMutation({
    mutationFn: (s: Session) => studioApi.deleteSession(s.id),
    success: (_r, s) => ({ title: 'Removed from your work', message: truncate(s.title, 80).text }),
    failure: "Couldn't remove it from your work",
    invalidate: [['studio', 'sessions']],
  });
  const ask = async (s: Session) => {
    const inLibrary = !!s.document_id;
    const name = truncate(s.title, 100).text;
    const yes = await confirm({
      title: inLibrary ? `Remove “${name}” from your work?` : `Discard the draft “${name}”?`,
      message: inLibrary ? 'The document stays in the library; your notes and chat on it here are removed.' : 'It was never in the library, so it cannot be brought back.',
      confirmLabel: inLibrary ? 'Remove' : 'Discard',
      tone: 'danger',
    });
    if (yes) (inLibrary ? remove : discard).mutate(s);
  };
  const useTemplate = useMutation({
    mutationFn: (t: TemplateItem) => studioApi.createSession({ kind: 'new', title: templateName(t.name), doc_type: t.doc_type, template_id: t.id }),
    onSuccess: (s) => router.push(`/governance/documents/studio/${s.id}`),
    onError: (e) => notify.error(e, { title: 'Could not open the template' }),
  });
  const open = (s: Session) => router.push(`/governance/documents/studio/${s.id}`);
  const close = () => setDialog(null);

  if (status.isLoading) return <PageLoader />;
  if (status.isError && !status.data) {
    return <div className="mx-auto max-w-md"><ErrorState title="Couldn't open the Comply AI Studio" message={errorMessage(status.error)} onRetry={canRetry(status.error) ? () => { void status.refetch(); } : undefined} /></div>;
  }
  if (!status.data?.enabled) {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState kind="firstUse" icon={Sparkles} title="Comply AI Studio is not enabled" action={<Button href="/governance/documents" variant="primary">Back to documents</Button>} />
      </div>
    );
  }
  return (
    // one screen: the ways to start, then the two panels filling the rest (each scrolls inside itself) — stacked below lg
    <div className="mx-auto flex max-w-6xl flex-col gap-[16px] lg:h-[calc(100dvh-5rem)]">
      <div className="shrink-0"><PageHeader variant="page" title="Comply AI Studio" /></div>
      {status.data.ai_configured === false && (
        <StudioBar note tone="warning" role="status" className="shrink-0">
          Comply Agent is not connected: chat is off.
          <InfoTip className="ml-[4px]" text="The editor, checks, compare and export still work." label="What still works" />
        </StudioBar>
      )}
      <div className="grid shrink-0 grid-cols-2 gap-[12px] sm:grid-cols-4">
        {STARTS.map((s) => (
          // the tip is the button's title: shown on hover, and read out after the name as its description
          <button key={s.key} type="button" onClick={() => setDialog(s.key)} title={s.tip}
            className="group flex min-h-[44px] items-center gap-[10px] rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[8px] text-left transition-colors hover:border-ds-primary hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring">
            <span className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-ds-control bg-ds-primary-soft text-ds-primary-text transition-colors group-hover:bg-ds-primary group-hover:text-ds-on-primary"><s.icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} /></span>
            <span className="min-w-0 truncate text-ds-body font-[600] text-ds-fg">{s.title}</span>
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 gap-[16px] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <YourWork sessions={sessions.data?.items ?? []} loading={sessions.isLoading} error={sessions.isError ? sessions.error : null} onRetry={() => { void sessions.refetch(); }}
          onOpen={(id) => router.push(`/governance/documents/studio/${id}`)} onDiscard={(s) => void ask(s)} onRemove={(s) => void ask(s)} />
        <Templates onUse={(t) => useTemplate.mutate(t)} />
      </div>

      {confirmDialog}
      {dialog === 'new' && <NewDocumentDialog onClose={close} onOpen={open} prefill={prefill} />}
      {dialog === 'upload' && <UploadDialog onClose={close} onOpen={open} maxMb={status.data.max_upload_mb ?? 30} />}
      {dialog === 'library' && <LibraryDialog onClose={close} onCompare={() => setDialog('compare')} />}
      {dialog === 'compare' && <CompareDialog onClose={close} onOpen={(sid, other) => router.push(`/governance/documents/studio/${sid}?compare=${other.id}&title=${encodeURIComponent(other.title)}`)} />}
    </div>
  );
}
