'use client';

export const dynamic = 'force-dynamic';

/**
 * AI Studio home: start a document (from scratch with or without references, from an uploaded file, from a library
 * document, or by comparing two), pick up earlier work, and manage the organisation's templates.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, FilePlus2, FileText, GitCompare, Layers, Library, Loader2, Plus, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import apiClient from '@/lib/api';
import { PageLoader } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { DOC_TYPE_LABEL, problemOf, studioApi, type FrameworkItem, type LibraryDoc, type Session, type TemplateItem } from '@/lib/studio/api';
import { ago, plural } from '@/lib/studio/text';

const input = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';
const primary = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0f766e] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50';

function useDocs(q: string) {
  return useQuery({ queryKey: ['studio', 'documents', q], queryFn: () => studioApi.documents(q, 12), staleTime: 30_000 });
}

function DocList({ onPick, exclude, empty = 'No document found.' }: { onPick: (d: LibraryDoc) => void; exclude?: number[]; empty?: string }) {
  const [q, setQ] = useState('');
  const docs = useDocs(q);
  const rows = (docs.data?.items ?? []).filter((d) => !exclude?.includes(d.id) && (d.has_text || d.has_file));
  return (
    <div>
      <label className="relative block"><span className="sr-only">Search the library</span><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#7b8794]" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the document library" className={`${input} pl-8`} /></label>
      <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
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

function Card({ icon: Icon, title, hint, children }: { icon: typeof FilePlus2; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#d5dbe1] bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e3f1f1] text-[#0f4c5c]"><Icon className="h-5 w-5" /></span>
        <div><h2 className="text-sm font-semibold text-[#1f2933]">{title}</h2><p className="mt-0.5 text-xs text-[#586472]">{hint}</p></div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
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

function NewDocument({ onOpen, prefill }: { onOpen: (s: Session) => void; prefill: Prefill | null }) {
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
  return (
    <Card icon={FilePlus2} title="Write a new document" hint="Describe it in chat. Start from a standard structure or your own template, and optionally anchor it on references.">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
          <label className="block"><span className="text-xs font-semibold text-[#26323d]">Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Information Security Policy" className={`${input} mt-1`} /></label>
          <label className="block"><span className="text-xs font-semibold text-[#26323d]">Type</span>
            <select value={docType} onChange={(e) => { setDocType(e.target.value); setTemplateId('default'); }} className={`${input} mt-1`}>{Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">What should it cover? <span className="font-normal text-[#586472]">(optional)</span></span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Scope, audience, or anything it must focus on" className={`${input} mt-1`} /></label>
        <label className="block"><span className="text-xs font-semibold text-[#26323d]">Starting point</span>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`${input} mt-1`}>
            <option value="default">{docType === 'other' ? 'Blank document' : 'The default template for this type'}</option>
            {forType.map((t) => <option key={t.id} value={t.id}>{t.name}{t.builtin ? '' : ' (yours)'}</option>)}
          </select></label>

        <div className="rounded-lg border border-[#e1e5e9] bg-[#f8fafb] p-2.5">
          <p className="text-xs font-semibold text-[#26323d]">Anchor it on references <span className="font-normal text-[#586472]">(optional; you can add more later)</span></p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setPicking(picking === 'parent' ? null : 'parent')} className="inline-flex items-center gap-1 rounded-full border border-[#c5ccd3] bg-white px-2.5 py-1 text-xs font-semibold text-[#3f4b58] hover:bg-[#eef1f4]"><Layers className="h-3.5 w-3.5" /> Parent document</button>
            <button type="button" onClick={() => setPicking(picking === 'document' ? null : 'document')} className="inline-flex items-center gap-1 rounded-full border border-[#c5ccd3] bg-white px-2.5 py-1 text-xs font-semibold text-[#3f4b58] hover:bg-[#eef1f4]"><FileText className="h-3.5 w-3.5" /> Reference document</button>
            <button type="button" onClick={() => setPicking(picking === 'framework' ? null : 'framework')} className="inline-flex items-center gap-1 rounded-full border border-[#c5ccd3] bg-white px-2.5 py-1 text-xs font-semibold text-[#3f4b58] hover:bg-[#eef1f4]"><BookMarked className="h-3.5 w-3.5" /> Framework</button>
          </div>
          {(parent || refDocs.length > 0 || fws.length > 0) && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {parent && <li className="inline-flex items-center gap-1 rounded-full bg-[#e3f1f1] px-2 py-1 text-xs text-[#0f4c5c]"><Layers className="h-3 w-3" /> Parent: {parent.title}<button type="button" onClick={() => setParent(null)} aria-label="Remove the parent"><X className="h-3 w-3" /></button></li>}
              {refDocs.map((d) => <li key={d.id} className="inline-flex items-center gap-1 rounded-full bg-[#e3f1f1] px-2 py-1 text-xs text-[#0f4c5c]"><FileText className="h-3 w-3" /> {d.title}<button type="button" onClick={() => setRefDocs(refDocs.filter((x) => x.id !== d.id))} aria-label={`Remove ${d.title}`}><X className="h-3 w-3" /></button></li>)}
              {fws.map((f) => <li key={f.id} className="inline-flex items-center gap-1 rounded-full bg-[#e3f1f1] px-2 py-1 text-xs text-[#0f4c5c]"><BookMarked className="h-3 w-3" /> {f.name}<button type="button" onClick={() => setFws(fws.filter((x) => x.id !== f.id))} aria-label={`Remove ${f.name}`}><X className="h-3 w-3" /></button></li>)}
            </ul>
          )}
          {picking === 'parent' && <div className="mt-2"><DocList onPick={(d) => { setParent(d); setPicking(null); }} /></div>}
          {picking === 'document' && <div className="mt-2"><DocList exclude={refDocs.map((d) => d.id)} onPick={(d) => { setRefDocs([...refDocs, d]); setPicking(null); }} /></div>}
          {picking === 'framework' && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {frameworks.isLoading && <li className="p-2 text-xs text-[#586472]"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading…</li>}
              {frameworks.data?.items.filter((f) => !fws.some((x) => x.id === f.id)).map((f) => (
                <li key={f.id}><button type="button" onClick={() => { setFws([...fws, f]); setPicking(null); }} className="flex w-full items-center gap-2 rounded-lg border border-[#e1e5e9] bg-white px-2.5 py-1.5 text-left hover:border-[#0f766e] hover:bg-[#f3fbf9]">
                  <BookMarked className="h-4 w-4 shrink-0 text-[#586472]" /><span className="min-w-0 flex-1"><span className="block truncate text-sm text-[#1f2933]">{f.name}{f.version ? ` ${f.version}` : ''}</span><span className="block text-[11px] text-[#586472]">{[f.organisation, `${f.controls} controls`].filter(Boolean).join(' · ')}</span></span></button></li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" disabled={!title.trim() || start.isPending} onClick={() => start.mutate()} className={primary}>
          {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Start writing
        </button>
      </div>
    </Card>
  );
}

// ── upload ───────────────────────────────────────────────────────────────────
function UploadDocument({ onOpen, maxMb }: { onOpen: (s: Session) => void; maxMb: number }) {
  const { toast } = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('policy');
  const [over, setOver] = useState(false);
  const upload = useMutation({
    mutationFn: (f: File) => studioApi.uploadSession(f, docType),
    onSuccess: onOpen,
    onError: (e) => toast({ title: 'That file could not be opened', message: problemOf(e), type: 'error' }),
  });
  const take = (f?: File | null) => { if (f) upload.mutate(f); };
  return (
    <Card icon={Upload} title="Upload a document" hint="Any Word, PDF, text, Markdown or HTML file. Read it, refine it through chat, check it, and move it into the library.">
      <input ref={file} type="file" hidden accept=".docx,.pdf,.txt,.md,.markdown,.html,.htm" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
        className={`rounded-lg border-2 border-dashed p-5 text-center ${over ? 'border-[#0f766e] bg-[#f3fbf9]' : 'border-[#b8c4c8] bg-[#f8fafb]'}`}
      >
        {upload.isPending ? <p className="text-sm text-[#3f4b58]"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Reading the file…</p> : (
          <>
            <Upload className="mx-auto h-6 w-6 text-[#586472]" />
            <p className="mt-1 text-sm text-[#26323d]">Drop a file here, or <button type="button" onClick={() => file.current?.click()} className="font-semibold text-[#0b6b58] underline">choose one</button></p>
            <p className="mt-0.5 text-[11px] text-[#586472]">Up to {maxMb} MB. Word files keep their formatting when you save.</p>
          </>
        )}
      </div>
      <label className="mt-3 block"><span className="text-xs font-semibold text-[#26323d]">What kind of document is it?</span>
        <select value={docType} onChange={(e) => setDocType(e.target.value)} className={`${input} mt-1`}>{Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    </Card>
  );
}

// ── open a library document / compare ───────────────────────────────────────
function OpenLibrary({ onOpen }: { onOpen: (s: Session) => void }) {
  const { toast } = useToast();
  const open = useMutation({
    mutationFn: (d: LibraryDoc) => studioApi.createSession({ kind: 'library', document_id: d.id }),
    onSuccess: onOpen,
    onError: (e) => toast({ title: 'Could not open it', message: problemOf(e), type: 'error' }),
  });
  return (
    <Card icon={Library} title="Edit a document from the library" hint="Read it, change it by hand or through chat, see every change as a redline, and save it as the next version.">
      {open.isPending ? <p className="text-sm text-[#3f4b58]"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Opening…</p> : <DocList onPick={(d) => open.mutate(d)} />}
    </Card>
  );
}

function CompareDocuments({ onOpen }: { onOpen: (s: Session, compareWith: LibraryDoc) => void }) {
  const { toast } = useToast();
  const [a, setA] = useState<LibraryDoc | null>(null);
  const [b, setB] = useState<LibraryDoc | null>(null);
  const go = useMutation({
    mutationFn: async () => studioApi.createSession({ kind: 'library', document_id: a!.id }),
    onSuccess: (s) => onOpen(s, b!),
    onError: (e) => toast({ title: 'Could not compare them', message: problemOf(e), type: 'error' }),
  });
  return (
    <Card icon={GitCompare} title="Compare two documents" hint="See every difference as a redline, and ask the AI which differences matter.">
      <div className="space-y-2">
        {[{ label: 'First document', value: a, set: setA, other: b }, { label: 'Compare it with', value: b, set: setB, other: a }].map((slot) => (
          <div key={slot.label}>
            <p className="text-xs font-semibold text-[#26323d]">{slot.label}</p>
            {slot.value ? (
              <p className="mt-1 flex items-center gap-2 rounded-lg bg-[#f3fbf9] px-3 py-2 text-sm text-[#1f2933]"><span className="min-w-0 flex-1 truncate">{slot.value.title}</span><button type="button" onClick={() => slot.set(null)} className="text-xs font-semibold text-[#0b6b58] hover:underline">Change</button></p>
            ) : <div className="mt-1"><DocList exclude={slot.other ? [slot.other.id] : undefined} onPick={(d) => slot.set(d)} /></div>}
          </div>
        ))}
        <button type="button" disabled={!a || !b || go.isPending} onClick={() => go.mutate()} className={primary}>{go.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />} Compare</button>
      </div>
    </Card>
  );
}

// ── earlier work and templates ───────────────────────────────────────────────
function Recent({ sessions, onOpen, onDelete }: { sessions: Session[]; onOpen: (id: number) => void; onDelete: (s: Session) => void }) {
  if (!sessions.length) return <p className="rounded-lg border border-dashed border-[#c5ccd3] p-4 text-center text-sm text-[#586472]">Nothing yet. Your documents appear here so you can pick them up again.</p>;
  return (
    <ul className="divide-y divide-[#e6eaee] rounded-xl border border-[#d5dbe1] bg-white">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
          <button type="button" onClick={() => onOpen(s.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e3f1f1] text-[#0f4c5c]"><FileText className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[#1f2933]">{s.title}</span>
              <span className="block text-[11px] text-[#586472]">{DOC_TYPE_LABEL[s.doc_type] ?? s.doc_type} · {plural(s.words, 'word')} · version {s.revision} · {ago(s.updated_at)}{s.document_id ? ' · in the library' : s.source?.name ? ` · from ${s.source.name}` : ''}</span>
            </span>
          </button>
          <button type="button" onClick={() => onDelete(s)} aria-label={`Delete ${s.title}`} title="Delete this work (a library document is not affected)" className="rounded p-1.5 text-[#9b1c1c] hover:bg-[#fdf3f3]"><Trash2 className="h-4 w-4" /></button>
        </li>
      ))}
    </ul>
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
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((t) => (
        <li key={t.id} className="flex flex-col rounded-xl border border-[#d5dbe1] bg-white p-3">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-sm font-semibold text-[#1f2933]">{t.name}</p>
            {t.is_default && !t.builtin && <span className="rounded-full bg-[#d6f3ec] px-2 py-0.5 text-[10px] font-semibold text-[#0b6b58]">default</span>}
            {t.builtin && t.replaced_by_default && <span className="rounded-full bg-[#eef1f4] px-2 py-0.5 text-[10px] font-semibold text-[#586472]">replaced</span>}
          </div>
          <p className="mt-1 line-clamp-2 flex-1 text-xs text-[#586472]">{t.description || `${DOC_TYPE_LABEL[t.doc_type] ?? t.doc_type} template`}</p>
          <p className="mt-1 text-[11px] text-[#586472]">{t.structure?.sections.length ? `${plural(t.structure.sections.length, 'required section')}` : 'No structure enforced'}</p>
          <div className="mt-2 flex gap-1.5">
            <button type="button" onClick={() => onUse(t)} className="inline-flex items-center gap-1 rounded-md bg-[#e6f4f1] px-2.5 py-1 text-xs font-semibold text-[#0b6b58] hover:bg-[#cfe9e4]"><Plus className="h-3.5 w-3.5" /> {t.builtin ? 'Customise' : 'Edit'}</button>
            {!t.builtin && <button type="button" onClick={() => remove.mutate(t)} className="rounded-md px-2 py-1 text-xs font-semibold text-[#9b1c1c] hover:bg-[#fdf3f3]">Delete</button>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function StudioHomePage() {
  const router = useRouter();
  const search = useSearchParams();
  const prefill = readPrefill(search);
  const qc = useQueryClient();
  const { toast } = useToast();
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

  if (status.isLoading) return <PageLoader />;
  if (!status.data?.enabled) {
    return <p className="rounded-lg border border-[#d5dbe1] bg-white p-6 text-sm text-[#3f4b58]">The AI Studio is not enabled for your organisation. <Link href="/governance/documents" className="font-semibold text-[#0b6b58] underline">Back to the documents</Link></p>;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-[#1f2933]"><Sparkles className="h-5 w-5 text-[#0f766e]" /> AI Studio</h1>
        <p className="mt-1 max-w-3xl text-sm text-[#586472]">Draft, edit, check and compare documents with an AI assistant. You choose what it leans on, it cites what it used, and nothing it proposes is written into your document until you accept it.</p>
        {status.data.ai_configured === false && (
          <p className="mt-3 rounded-lg border border-[#f0cf7a] bg-[#fffbed] p-3 text-sm text-[#6b4e00]" role="status">The AI is not connected yet, so chat and the AI check are switched off. The editor, the other checks, comparing versions and export work now.</p>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <NewDocument onOpen={open} prefill={prefill} />
        <UploadDocument onOpen={open} maxMb={status.data.max_upload_mb ?? 30} />
        <OpenLibrary onOpen={open} />
        <CompareDocuments onOpen={(s, other) => router.push(`/governance/documents/studio/${s.id}?compare=${other.id}&title=${encodeURIComponent(other.title)}`)} />
      </div>

      <section aria-label="Your work">
        <h2 className="mb-2 text-sm font-semibold text-[#1f2933]">Your work</h2>
        {sessions.isLoading ? <p className="text-sm text-[#586472]"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p> : <Recent sessions={sessions.data?.items ?? []} onOpen={(id) => router.push(`/governance/documents/studio/${id}`)} onDelete={(s) => { if (window.confirm(`Delete “${s.title}” from the studio? A document already in the library is not affected.`)) del.mutate(s); }} />}
      </section>

      <section aria-label="Templates">
        <h2 className="text-sm font-semibold text-[#1f2933]">Templates</h2>
        <p className="mb-2 mt-0.5 text-xs text-[#586472]">Open one in the editor, change it, and save it with “Save as a template” to make it your organisation’s default for that type. Its sections are then checked on every document of that type.</p>
        <Templates onUse={(t) => useTemplate.mutate(t)} />
      </section>
    </div>
  );
}
