'use client';

export const dynamic = 'force-dynamic';

/**
 * AI Studio home, on one screen: four ways to start (write, upload, edit from the library, compare), each opening its own
 * popup, and the work in progress next to the templates, each scrolling inside its own panel.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, FilePlus2, FileText, GitCompare, Info, Layers, Library, Loader2, Pencil, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import apiClient from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { useToast } from '@/components/ui/ToastProvider';
import { DOC_TYPE_LABEL, problemOf, studioApi, type FrameworkItem, type LibraryDoc, type Session, type TemplateItem } from '@/lib/studio/api';
import { ago, plural } from '@/lib/studio/text';
import { documentApi } from '@/lib/studio/documentApi';
import { FrameworkList } from './_components/ReferencesPanel';
import { DocumentDetailsFields, titleCase, useDocumentDetails } from '../_DetailsFields';
import { NO_SIGNOFF, ReviewerApproverFields, saveSignoffChoice, type SignoffChoice } from '../_SignoffControl';
import { detailsPayload } from '../_detailsRead';

const input = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0f766e] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50';
const secondary = 'rounded-lg border border-[#b8c4c8] bg-white px-3.5 py-2 text-sm font-semibold text-[#3f4b58] hover:bg-[#f1f3f5]';
const fieldLabel = 'text-xs font-semibold text-[#26323d]';
const chip = 'inline-flex items-center gap-1 rounded-full border border-[#c5ccd3] bg-white px-2.5 py-1 text-xs font-semibold text-[#3f4b58] hover:bg-[#eef1f4]';

function useDocs(q: string) {
  return useQuery({ queryKey: ['studio', 'documents', q], queryFn: () => studioApi.documents(q, 12), staleTime: 30_000 });
}

function DocList({ onPick, exclude, list = 'max-h-52', focus = false, empty = 'No document found.' }: { onPick: (d: LibraryDoc) => void; exclude?: number[]; list?: string; focus?: boolean; empty?: string }) {
  const [q, setQ] = useState('');
  const docs = useDocs(q);
  const rows = (docs.data?.items ?? []).filter((d) => !exclude?.includes(d.id) && (d.has_text || d.has_file));
  return (
    <div>
      <label className="relative block"><span className="sr-only">Search the library</span><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#7b8794]" /><input autoFocus={focus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the document library" className={`${input} pl-8`} /></label>
      <ul className={`mt-2 space-y-1 overflow-y-auto ${list}`}>
        {docs.isLoading && <li className="p-2 text-xs text-[#586472]"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading…</li>}
        {docs.data && rows.length === 0 && <li className="p-2 text-xs text-[#586472]">{empty}</li>}
        {rows.map((d) => (
          <li key={d.id}>
            <button type="button" onClick={() => onPick(d)} className="flex w-full items-center gap-2 rounded-lg border border-[#e1e5e9] bg-white px-2.5 py-1.5 text-left hover:border-[#0f766e] hover:bg-[#f3fbf9]">
              <FileText className="h-4 w-4 shrink-0 text-[#586472]" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm text-[#1f2933]">{d.title}</span><span className="block text-[11px] text-[#586472]">{[d.code, d.doc_type, `v${d.version}`, d.status].filter(Boolean).join(' · ')}</span></span>
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

function NewDocumentDialog({ onClose, onOpen, prefill }: { onClose: () => void; onOpen: (s: Session) => void; prefill: Prefill | null }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [docType, setDocType] = useState(prefill?.type ?? 'policy');
  const [description, setDescription] = useState(prefill?.description ?? '');
  const [templateId, setTemplateId] = useState('default');
  const [parent, setParent] = useState<LibraryDoc | null>(null);
  const [refDocs, setRefDocs] = useState<LibraryDoc[]>([]);
  const [fws, setFws] = useState<FrameworkItem[]>([]);
  const [picking, setPicking] = useState<'parent' | 'document' | 'framework' | null>(null);
  const templates = useQuery({ queryKey: ['studio', 'templates'], queryFn: studioApi.templates, staleTime: 60_000 });
  const frameworks = useQuery({ queryKey: ['studio', 'frameworks'], queryFn: studioApi.frameworks, staleTime: 120_000, enabled: picking === 'framework' || !!prefill?.frameworks.length });

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
      const attach = async (body: Parameters<typeof studioApi.addReference>[1], label: string) => { try { await studioApi.addReference(s.id, body); } catch (e) { failed.push(`${label}: ${problemOf(e)}`); } };
      if (parent) await attach({ kind: 'parent_document', source_id: parent.id }, parent.title);
      for (const d of refDocs) await attach({ kind: 'document', source_id: d.id }, d.title);
      for (const f of fws) await attach({ kind: 'framework', source_id: f.id, scope: { mode: 'all' } }, f.name);
      if (failed.length) toast({ title: 'Some references could not be added', message: failed.join('\n'), type: 'warning' });
      return s;
    },
    onSuccess: onOpen,
    onError: (e) => toast({ title: 'Could not start the document', message: problemOf(e), type: 'error' }),
  });
  const forType = (templates.data?.items ?? []).filter((t) => t.doc_type === docType || t.id === 'builtin:blank');
  const pickButton = (key: 'parent' | 'document' | 'framework', Icon: typeof Layers, text: string) => (
    <button type="button" aria-pressed={picking === key} onClick={() => setPicking(picking === key ? null : key)}
      className={`${chip} ${picking === key ? 'border-[#0f766e] bg-[#e6f4f1] text-[#0b6b58]' : ''}`}><Icon className="h-3.5 w-3.5" /> {text}</button>
  );
  return (
    <AnimatedModal isOpen onClose={onClose} title="Write a new document" size="lg"
      footer={<div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        <button type="button" disabled={!title.trim() || start.isPending} onClick={() => start.mutate()} className={primary}>
          {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Start writing</button></div>}>
      <div className="space-y-3 p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
          <label className="block"><span className={fieldLabel}>Title</span><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Information Security Policy" className={`${input} mt-1`} /></label>
          <label className="block"><span className={fieldLabel}>Type</span>
            <select value={docType} onChange={(e) => { setDocType(e.target.value); setTemplateId('default'); }} className={`${input} mt-1`}>{Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <label className="block"><span className={fieldLabel}>What should it cover? <span className="font-normal text-[#586472]">(optional)</span></span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Scope, audience, focus" className={`${input} mt-1`} /></label>
        <label className="block"><span className={fieldLabel}>Starting point</span>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`${input} mt-1`}>
            <option value="default">{docType === 'other' ? 'Blank document' : 'The default template for this type'}</option>
            {forType.map((t) => <option key={t.id} value={t.id}>{t.name}{t.builtin ? '' : ' (yours)'}</option>)}
          </select></label>
        <div>
          <span className={fieldLabel}>References <span className="font-normal text-[#586472]">(optional)</span></span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {pickButton('parent', Layers, 'Parent document')}
            {pickButton('document', FileText, 'Reference document')}
            {pickButton('framework', BookMarked, 'Framework')}
          </div>
          {(parent || refDocs.length > 0 || fws.length > 0) && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Chosen references">
              {parent && <li className="inline-flex items-center gap-1 rounded-full bg-[#e3f1f1] px-2 py-1 text-xs text-[#0f4c5c]"><Layers className="h-3 w-3" /> Parent: {parent.title}<button type="button" onClick={() => setParent(null)} aria-label="Remove the parent"><X className="h-3 w-3" /></button></li>}
              {refDocs.map((d) => <li key={d.id} className="inline-flex items-center gap-1 rounded-full bg-[#e3f1f1] px-2 py-1 text-xs text-[#0f4c5c]"><FileText className="h-3 w-3" /> {d.title}<button type="button" onClick={() => setRefDocs(refDocs.filter((x) => x.id !== d.id))} aria-label={`Remove ${d.title}`}><X className="h-3 w-3" /></button></li>)}
              {fws.map((f) => <li key={f.id} className="inline-flex items-center gap-1 rounded-full bg-[#e3f1f1] px-2 py-1 text-xs text-[#0f4c5c]"><BookMarked className="h-3 w-3" /> {f.name}<button type="button" onClick={() => setFws(fws.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.name}`}><X className="h-3 w-3" /></button></li>)}
            </ul>
          )}
          {picking === 'parent' && <div className="mt-2"><DocList focus onPick={(d) => { setParent(d); setPicking(null); }} /></div>}
          {picking === 'document' && <div className="mt-2"><DocList focus exclude={refDocs.map((d) => d.id)} onPick={(d) => { setRefDocs([...refDocs, d]); setPicking(null); }} /></div>}
          {picking === 'framework' && (
            <div className="mt-2">
              <FrameworkList frameworks={frameworks.data?.items} loading={frameworks.isLoading} exclude={fws.map((f) => f.id)} maxHeight="max-h-56"
                onPick={(f) => { setFws([...fws, f]); setPicking(null); }} />
            </div>
          )}
        </div>
      </div>
    </AnimatedModal>
  );
}

// ── upload ───────────────────────────────────────────────────────────────────
/** Choose a file → its details are read from it → the person confirms them → it opens (and is in the library as a draft). */
function UploadDialog({ onClose, onOpen, maxMb }: { onClose: () => void; onOpen: (s: Session) => void; maxMb: number }) {
  const { toast } = useToast();
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
          toast({ title: 'The reviewers and approvers were not saved', message: `${problemOf(e)} Choose them in Submit for review.`, type: 'error' });
        }
      }
      return s;
    },
    onSuccess: onOpen,
    onError: (e) => toast({ title: 'That file could not be opened', message: problemOf(e), type: 'error' }),
  });
  const take = (f?: File | null) => {
    if (!f) return;
    if (f.size > maxMb * 1024 * 1024) { toast({ title: 'That file is too large', message: `Up to ${maxMb} MB.`, type: 'error' }); return; }
    setChosen(f);
    details.read(f);
  };
  return (
    <AnimatedModal isOpen onClose={onClose} title="Upload a document" size={chosen ? 'lg' : 'md'}
      footer={chosen ? <div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        <button type="button" disabled={!details.form.title.trim() || details.reading || upload.isPending} onClick={() => upload.mutate()} className={primary}>
          {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Open</button></div> : undefined}>
      <div className="space-y-3 p-5">
        <input ref={file} type="file" hidden accept=".docx,.pdf,.txt,.md,.markdown,.html,.htm" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
        {chosen ? (
          <p className="flex items-center gap-2 rounded-lg bg-[#f3fbf9] px-3 py-2 text-sm text-[#1f2933]"><FileText className="h-4 w-4 shrink-0 text-[#586472]" /><span className="min-w-0 flex-1 truncate">{chosen.name}</span>
            <button type="button" onClick={() => file.current?.click()} className="text-xs font-semibold text-[#0b6b58] hover:underline">Change</button></p>
        ) : (
          <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
            className={`rounded-lg border-2 border-dashed p-6 text-center ${over ? 'border-[#0f766e] bg-[#f3fbf9]' : 'border-[#b8c4c8] bg-[#f8fafb]'}`}>
            <Upload className="mx-auto h-6 w-6 text-[#586472]" />
            <p className="mt-1 text-sm text-[#26323d]">Drop a file here, or <button type="button" onClick={() => file.current?.click()} className="font-semibold text-[#0b6b58] underline">choose one</button></p>
            <p className="mt-0.5 text-[11px] text-[#586472]">Word, PDF, text or HTML · up to {maxMb} MB</p>
          </div>
        )}
        {chosen && <DocumentDetailsFields d={details} />}
        {chosen && <ReviewerApproverFields value={signoff} onChange={setSignoff} />}
      </div>
    </AnimatedModal>
  );
}

// ── open a library document / compare ───────────────────────────────────────
function LibraryDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const open = useMutation({
    mutationFn: (d: LibraryDoc) => documentApi.draft(d.id),          // the person's one draft of the document, reused
    onSuccess: (r) => router.push(`/governance/documents/studio/${r.session_id}`),
    onError: (e) => toast({ title: 'Could not open it', message: problemOf(e), type: 'error' }),
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Edit a document from the library" size="lg">
      <div className="p-5">{open.isPending ? <p className="text-sm text-[#3f4b58]"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Opening…</p> : <DocList focus list="max-h-[50vh]" onPick={(d) => open.mutate(d)} />}</div>
    </AnimatedModal>
  );
}

function CompareDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (sessionId: number, compareWith: LibraryDoc) => void }) {
  const { toast } = useToast();
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
    onError: (e) => toast({ title: 'Could not compare them', type: 'error', message: problemOf(e) }),
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Compare two documents" size="xl"
      footer={<div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Cancel</button>
        <button type="button" disabled={!a || !b || go.isPending} onClick={() => go.mutate()} className={primary}>{go.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />} Compare</button></div>}>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        {[{ label: 'First document', value: a, set: setA, other: b }, { label: 'Compare it with', value: b, set: setB, other: a }].map((slot) => (
          <div key={slot.label}>
            <span className={fieldLabel}>{slot.label}</span>
            {slot.value ? (
              <div className="mt-1 flex items-center gap-2 rounded-lg bg-[#f3fbf9] px-3 py-2 text-sm text-[#1f2933]"><span className="min-w-0 flex-1 truncate">{slot.value.title}</span><button type="button" onClick={() => slot.set(null)} className="text-xs font-semibold text-[#0b6b58] hover:underline">Change</button></div>
            ) : <div className="mt-1"><DocList focus={slot.label === 'First document'} list="max-h-[40vh]" exclude={slot.other ? [slot.other.id] : undefined} onPick={(d) => slot.set(d)} /></div>}
          </div>
        ))}
      </div>
    </AnimatedModal>
  );
}

// ── the home screen ──────────────────────────────────────────────────────────
type Start = 'new' | 'upload' | 'library' | 'compare';

const STARTS: { key: Start; icon: typeof FilePlus2; title: string; hint: string }[] = [
  { key: 'new', icon: FilePlus2, title: 'Write a new document', hint: 'Template and references' },
  { key: 'upload', icon: Upload, title: 'Upload a document', hint: 'Word, PDF, text or HTML' },
  { key: 'library', icon: Library, title: 'Edit from the library', hint: 'Edit, save a version' },
  { key: 'compare', icon: GitCompare, title: 'Compare two documents', hint: 'Redline and what matters' },
];

/** A panel of the home screen: a title bar and a body that scrolls on its own. */
function Panel({ title, count, info, tools, children }: { title: string; count?: number; info?: string; tools?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex max-h-[28rem] min-h-0 flex-col rounded-xl border border-[#d5dbe1] bg-white shadow-card lg:max-h-none">
      <div className="flex items-center gap-2 border-b border-[#e6eaee] px-3 py-2">
        <h2 className="text-sm font-semibold text-[#1f2933]">{title}</h2>
        {count !== undefined && <span className="rounded-full bg-[#eef1f4] px-1.5 py-0.5 text-[10px] font-semibold text-[#586472]">{count}</span>}
        {info && <span title={info} aria-label={info} className="text-[#7b8794]"><Info className="h-3.5 w-3.5" /></span>}
        <div className="ml-auto">{tools}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

function YourWork({ sessions, loading, onOpen, onDelete }: { sessions: Session[]; loading: boolean; onOpen: (id: number) => void; onDelete: (s: Session) => void }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => sessions.filter((s) => !q.trim() || s.title.toLowerCase().includes(q.trim().toLowerCase())), [sessions, q]);
  const search = sessions.length > 5 && (
    <label className="relative block"><span className="sr-only">Search your work</span><Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-[#7b8794]" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-40 rounded-md border border-[#c5ccd3] bg-white py-1 pl-7 pr-2 text-xs text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]" /></label>
  );
  return (
    <Panel title="Your work" count={sessions.length} tools={search}>
      {loading ? <p className="p-4 text-sm text-[#586472]"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p>
        : !sessions.length ? <p className="p-6 text-center text-sm text-[#586472]">Your documents will appear here.</p>
        : !rows.length ? <p className="p-4 text-sm text-[#586472]">Nothing matches “{q}”.</p> : (
          <ul className="divide-y divide-[#eef1f4]">
            {rows.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-2 hover:bg-[#f6faf9]">
                <button type="button" onClick={() => onOpen(s.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#e3f1f1] text-[#0f4c5c]"><FileText className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5"><span className="truncate text-[13px] font-semibold text-[#1f2933]">{s.title}</span>
                      {s.document_id ? <span title="In the library" aria-label="In the library" className="shrink-0 text-[#0f766e]"><Library className="h-3.5 w-3.5" /></span> : null}</span>
                    <span className="block truncate text-[11px] text-[#586472]">{DOC_TYPE_LABEL[s.doc_type] ?? titleCase(s.doc_type)} · {plural(s.words, 'word')} · rev {s.revision}{!s.document_id && s.source?.name ? ` · ${s.source.name}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-[#586472]">{ago(s.updated_at)}</span>
                </button>
                <button type="button" onClick={() => onDelete(s)} aria-label={`Delete ${s.title}`} title="Delete this work (a library document is not affected)" className="rounded p-1 text-[#7b8794] hover:bg-[#fdf3f3] hover:text-[#9b1c1c]"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
    </Panel>
  );
}

function Templates({ onUse }: { onUse: (t: TemplateItem) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['studio', 'templates'], queryFn: studioApi.templates, staleTime: 60_000 });
  const remove = useMutation({
    mutationFn: (t: TemplateItem) => studioApi.deleteTemplate(Number(t.id.split(':')[1])),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'templates'] }),
    onError: (e) => toast({ title: 'Could not delete it', message: problemOf(e), type: 'error' }),
  });
  const rows = (templates.data?.items ?? []).filter((t) => t.id !== 'builtin:blank');
  return (
    <Panel title="Templates" count={rows.length} info="Open a template, change it, then use Save as a template: it becomes your organisation's default for that type, and its sections are checked on every document of that type.">
      {templates.isLoading ? <p className="p-4 text-sm text-[#586472]"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p> : (
        <ul className="divide-y divide-[#eef1f4]">
          {rows.map((t) => (
            <li key={t.id} title={t.description || undefined} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5"><span className="truncate text-[13px] font-semibold text-[#1f2933]">{t.name}</span>
                  {t.is_default && !t.builtin && <span className="shrink-0 rounded-full bg-[#d6f3ec] px-1.5 py-0.5 text-[10px] font-semibold text-[#0b6b58]">default</span>}
                  {t.builtin && t.replaced_by_default && <span className="shrink-0 rounded-full bg-[#eef1f4] px-1.5 py-0.5 text-[10px] font-semibold text-[#586472]">replaced</span>}</span>
                <span className="block truncate text-[11px] text-[#586472]">{DOC_TYPE_LABEL[t.doc_type] ?? t.doc_type} · {t.structure?.sections.length ? plural(t.structure.sections.length, 'section') : 'free structure'}</span>
              </span>
              <button type="button" onClick={() => onUse(t)} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[#e6f4f1] px-2 py-1 text-xs font-semibold text-[#0b6b58] hover:bg-[#cfe9e4]"><Pencil className="h-3 w-3" /> {t.builtin ? 'Customise' : 'Edit'}</button>
              {!t.builtin && <button type="button" onClick={() => remove.mutate(t)} aria-label={`Delete ${t.name}`} title="Delete this template" className="shrink-0 rounded p-1 text-[#7b8794] hover:bg-[#fdf3f3] hover:text-[#9b1c1c]"><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function StudioHomePage() {
  const router = useRouter();
  const search = useSearchParams();
  const prefill = readPrefill(search);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<Start | null>(prefill ? 'new' : null);      // the library's “+ Draft” lands in the new-document popup
  const status = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 60_000 });
  const sessions = useQuery({ queryKey: ['studio', 'sessions'], queryFn: studioApi.sessions, enabled: !!status.data?.enabled });
  const del = useMutation({
    mutationFn: (s: Session) => studioApi.deleteSession(s.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio', 'sessions'] }),
    onError: (e) => toast({ title: 'Could not delete it', message: problemOf(e), type: 'error' }),
  });
  const useTemplate = useMutation({
    mutationFn: (t: TemplateItem) => studioApi.createSession({ kind: 'new', title: t.name.replace(/ \(standard structure\)$/, ''), doc_type: t.doc_type, template_id: t.id }),
    onSuccess: (s) => router.push(`/governance/documents/studio/${s.id}`),
    onError: (e) => toast({ title: 'Could not open the template', message: problemOf(e), type: 'error' }),
  });
  const open = (s: Session) => router.push(`/governance/documents/studio/${s.id}`);
  const close = () => setDialog(null);

  if (status.isLoading) return <PageLoader />;
  if (!status.data?.enabled) {
    return <p className="rounded-lg border border-[#d5dbe1] bg-white p-6 text-sm text-[#3f4b58]">The AI Studio is not enabled for your organisation. <Link href="/governance/documents" className="font-semibold text-[#0b6b58] underline">Back to the documents</Link></p>;
  }
  return (
    // one screen: the ways to start, then the two panels filling the rest (each scrolls inside itself) — stacked below lg
    <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:h-[calc(100vh-5rem)]">
      {status.data.ai_configured === false && (
        <p className="rounded-lg border border-[#f0cf7a] bg-[#fffbed] px-3 py-2 text-xs text-[#6b4e00]" role="status">Comply Agent is not connected yet: chat is off; the editor, checks, compare and export work.</p>
      )}
      <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
        {STARTS.map((s) => (
          <button key={s.key} type="button" onClick={() => setDialog(s.key)}
            className="group flex items-center gap-3 rounded-xl border border-[#d5dbe1] bg-white p-3 text-left shadow-card transition-colors hover:border-[#0f766e] hover:bg-[#f6faf9]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e3f1f1] text-[#0f4c5c] transition-colors group-hover:bg-[#0f766e] group-hover:text-white"><s.icon className="h-[18px] w-[18px]" /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[#1f2933]">{s.title}</span>
              <span className="block truncate text-xs text-[#586472]">{s.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <YourWork sessions={sessions.data?.items ?? []} loading={sessions.isLoading} onOpen={(id) => router.push(`/governance/documents/studio/${id}`)}
          onDelete={(s) => { if (window.confirm(`Delete “${s.title}” from the studio? A document already in the library is not affected.`)) del.mutate(s); }} />
        <Templates onUse={(t) => useTemplate.mutate(t)} />
      </div>

      {dialog === 'new' && <NewDocumentDialog onClose={close} onOpen={open} prefill={prefill} />}
      {dialog === 'upload' && <UploadDialog onClose={close} onOpen={open} maxMb={status.data.max_upload_mb ?? 30} />}
      {dialog === 'library' && <LibraryDialog onClose={close} />}
      {dialog === 'compare' && <CompareDialog onClose={close} onOpen={(sid, other) => router.push(`/governance/documents/studio/${sid}?compare=${other.id}&title=${encodeURIComponent(other.title)}`)} />}
    </div>
  );
}
