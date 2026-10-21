'use client';

/**
 * What the AI may lean on: the parent document, a general reference document from the library, a framework from the platform
 * (all of it, some domains, named controls, or a topic), a file you upload, or a template. Each is attached to this session
 * only, shown here, and the AI cites it by its number (R1, R2 …) so its quotes can be checked.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BookMarked, Eye, EyeOff, FileText, Layers, Loader2, Paperclip, Plus, Search, Trash2, Upload } from 'lucide-react';
import { DOC_TYPE_LABEL, problemOf, studioApi, type FrameworkItem, type LibraryDoc, type Reference, type ReferenceScope, type Session } from '@/lib/studio/api';
import { useToast } from '@/components/ui/ToastProvider';
import { matches, plural } from '@/lib/studio/text';
import { SIGNOFF_STATUS } from '../../_SignoffControl';
import { docLine } from './homeLists';

type AddTab = 'parent' | 'document' | 'framework' | 'upload' | 'template';

const KIND_LABEL: Record<Reference['kind'], string> = {
  parent_document: 'Parent document',
  document: 'Reference document',
  framework: 'Framework',
  upload: 'Uploaded file',
  template: 'Template',
};

const KIND_ICON: Record<Reference['kind'], typeof FileText> = {
  parent_document: Layers,
  document: FileText,
  framework: BookMarked,
  upload: Paperclip,
  template: FileText,
};

const size = (chars: number): string => (chars < 1000 ? `${chars} characters` : `${Math.round(chars / 1000)}k characters`);

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export { matches };

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#7b8794]" aria-hidden />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-[#b8c4c8] bg-white py-2 pl-8 pr-3 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]" />
    </label>
  );
}

/** The platform's frameworks with a search over name, version and publisher. Shared by the references panel and the start screen. */
export function FrameworkList({ frameworks, loading, exclude = [], onPick, maxHeight = 'max-h-64' }: {
  frameworks?: FrameworkItem[]; loading: boolean; exclude?: number[]; onPick: (fw: FrameworkItem) => void; maxHeight?: string;
}) {
  const [q, setQ] = useState('');
  const all = (frameworks ?? []).filter((f) => !exclude.includes(f.id));
  const shown = all.filter((f) => matches(q, f.name, f.version, f.organisation));
  return (
    <div>
      <SearchBox value={q} onChange={setQ} placeholder="Search frameworks: name, version or publisher" label="Search the frameworks" />
      {!loading && all.length > 0 && <p className="mt-1 text-[11px] text-[#586472]" role="status">{q.trim() ? `${shown.length} of ${plural(all.length, 'framework')}` : plural(all.length, 'framework')}</p>}
      <ul className={`mt-1.5 space-y-1 overflow-y-auto ${maxHeight}`}>
        {loading && <li className="p-2 text-xs text-[#586472]"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading…</li>}
        {!loading && shown.length === 0 && <li className="rounded-lg border border-dashed border-[#c5ccd3] p-3 text-center text-xs text-[#586472]">{q.trim() ? `No framework matches “${q.trim()}”.` : 'No framework with parsed controls is available.'}</li>}
        {shown.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => onPick(f)} className="flex w-full items-center gap-2 rounded-lg border border-[#e1e5e9] bg-white px-2.5 py-1.5 text-left hover:border-[#0f766e] hover:bg-[#f3fbf9]">
              <BookMarked className="h-4 w-4 shrink-0 text-[#586472]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[#1f2933]">{f.name}{f.version ? ` ${f.version}` : ''}</span>
                <span className="block text-[11px] text-[#586472]">{[f.organisation, `${f.controls} controls`].filter(Boolean).join(' · ')}</span>
              </span>
              <Plus className="h-4 w-4 shrink-0 text-[#0f766e]" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Attached({ session, reference, onChanged, open, onToggleOpen }: { session: Session; reference: Reference; onChanged: () => void; open: boolean; onToggleOpen: () => void }) {
  const { toast } = useToast();
  const Icon = KIND_ICON[reference.kind];
  const toggle = useMutation({ mutationFn: () => studioApi.toggleReference(session.id, reference.id, !reference.include), onSuccess: onChanged, onError: (e) => toast({ title: 'Could not change the reference', message: problemOf(e), type: 'error' }) });
  const remove = useMutation({ mutationFn: () => studioApi.removeReference(session.id, reference.id), onSuccess: onChanged, onError: (e) => toast({ title: 'Could not remove the reference', message: problemOf(e), type: 'error' }) });
  const text = useQuery({ queryKey: ['studio', 'reference-text', session.id, reference.id], queryFn: () => studioApi.readReference(session.id, reference.id), enabled: open, staleTime: 60_000 });
  return (
    <li id={`ref-${reference.key}`} className={`rounded-lg border bg-white p-2.5 ${reference.include ? 'border-[#c5ccd3]' : 'border-[#e1e5e9] opacity-60'}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded bg-[#e3f1f1] px-1.5 py-0.5 text-[11px] font-bold text-[#0f4c5c]">{reference.key}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[#1f2933]" title={reference.title}>{reference.title}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-[#586472]">
            <Icon className="h-3 w-3" /> {KIND_LABEL[reference.kind]}
            {reference.label ? <span>· {reference.label}</span> : null}
            <span>· {size(reference.chars)}</span>
            {reference.scope?.mode && reference.scope.mode !== 'all' ? <span>· {reference.scope.mode === 'domains' ? plural(reference.scope.domains?.length ?? 0, 'domain')
              : reference.scope.mode === 'query' ? (reference.scope.query ? `about “${reference.scope.query}”` : 'about a topic') : reference.scope.mode}</span> : null}
          </p>
          {reference.truncated && <p className="mt-0.5 text-[11px] text-[#8a6100]">Too long: only the start was given to Comply Agent. Narrow it to the parts that matter.</p>}
          {reference.notes.map((n, i) => <p key={i} className="mt-0.5 text-[11px] text-[#8a6100]">{n}</p>)}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={onToggleOpen} title="Read the text Comply Agent is given" className="rounded p-1.5 text-[#3f4b58] hover:bg-[#eef1f4]" aria-label={`Read ${reference.key}`} aria-expanded={open}><Eye className="h-4 w-4" /></button>
          <button type="button" onClick={() => toggle.mutate()} disabled={toggle.isPending} title={reference.include ? 'Do not use for now' : 'Use again'} className="rounded p-1.5 text-[#3f4b58] hover:bg-[#eef1f4]" aria-label={reference.include ? `Pause ${reference.key}` : `Use ${reference.key}`}>
            {reference.include ? <EyeOff className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} title="Remove" className="rounded p-1.5 text-[#9b1c1c] hover:bg-[#fdf3f3]" aria-label={`Remove ${reference.key}`}><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded border border-[#e1e5e9] bg-[#f8fafb] p-2">
          {text.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-[#0f766e]" /> : <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-[#26323d]">{text.data?.text ?? 'The text could not be loaded.'}</pre>}
        </div>
      )}
    </li>
  );
}

function DocumentPicker({ onPick, busy, empty, exclude }: { onPick: (doc: LibraryDoc) => void; busy: boolean; empty: string; exclude?: number | null }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const docs = useQuery({ queryKey: ['studio', 'documents', dq], queryFn: () => studioApi.documents(dq, 30), staleTime: 30_000, select: (r) => ({ items: r.items.filter((d) => d.id !== exclude) }) });
  return (
    <div>
      <SearchBox value={q} onChange={setQ} placeholder="Search the document library: title, code or type" label="Search the library" />
      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
        {docs.isLoading && <li className="p-2 text-xs text-[#586472]"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading…</li>}
        {docs.data?.items.length === 0 && <li className="p-2 text-xs text-[#586472]">{empty}</li>}
        {docs.data?.items.map((d) => (
          <li key={d.id}>
            <button type="button" disabled={busy || (!d.has_text && !d.has_file)} onClick={() => onPick(d)} className="flex w-full items-center gap-2 rounded-lg border border-[#e1e5e9] bg-white px-2.5 py-1.5 text-left hover:border-[#0f766e] hover:bg-[#f3fbf9] disabled:opacity-50">
              <FileText className="h-4 w-4 shrink-0 text-[#586472]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[#1f2933]">{d.title}</span>
                <span className="block text-[11px] text-[#586472]">{docLine(d, DOC_TYPE_LABEL, SIGNOFF_STATUS)}{!d.has_text && !d.has_file ? ' · no text' : ''}</span>
              </span>
              <Plus className="h-4 w-4 text-[#0f766e]" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FrameworkPicker({ onPick, busy }: { onPick: (fw: FrameworkItem, scope: ReferenceScope) => void; busy: boolean }) {
  const fws = useQuery({ queryKey: ['studio', 'frameworks'], queryFn: studioApi.frameworks, staleTime: 120_000 });
  const [selected, setSelected] = useState<FrameworkItem | null>(null);
  const [mode, setMode] = useState<NonNullable<ReferenceScope['mode']>>('all');
  const [domains, setDomains] = useState<string[]>([]);
  const [controls, setControls] = useState('');
  const [query, setQuery] = useState('');
  const [domainQ, setDomainQ] = useState('');
  if (!selected) {
    return <FrameworkList frameworks={fws.data?.items} loading={fws.isLoading} onPick={(f) => { setSelected(f); setMode('all'); setDomains([]); setDomainQ(''); }} />;
  }
  const shownDomains = selected.domains.filter((d) => matches(domainQ, d));
  const scope: ReferenceScope = mode === 'domains' ? { mode, domains } : mode === 'controls' ? { mode, control_refs: controls.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) } : mode === 'query' ? { mode, query } : { mode: 'all' };
  const ready = mode === 'all' || (mode === 'domains' && domains.length > 0) || (mode === 'controls' && (scope.control_refs?.length ?? 0) > 0) || (mode === 'query' && query.trim().length > 3);
  return (
    <div className="space-y-2.5 rounded-lg border border-[#c5ccd3] bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#1f2933]">{selected.name}{selected.version ? ` ${selected.version}` : ''}</p>
        <button type="button" onClick={() => setSelected(null)} className="text-xs font-medium text-[#0b6b58] hover:underline">Choose another</button>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-semibold text-[#3f4b58]">Which part should Comply Agent use?</legend>
        {([
          ['all', `All ${selected.controls} controls`],
          ['domains', 'Some domains (sections)'],
          ['controls', 'Named controls'],
          ['query', 'Controls about a topic'],
        ] as const).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 py-0.5 text-sm text-[#26323d]">
            <input type="radio" name="fw-scope" checked={mode === value} onChange={() => setMode(value)} className="accent-[#0f766e]" /> {label}
          </label>
        ))}
      </fieldset>
      {mode === 'domains' && (
        <div className="space-y-1.5">
          {selected.domains.length > 6 && <SearchBox value={domainQ} onChange={setDomainQ} placeholder="Search the domains" label="Search the domains of this framework" />}
          <div className="max-h-48 space-y-0.5 overflow-y-auto rounded border border-[#e1e5e9] p-2">
            {shownDomains.length === 0 && <p className="text-xs text-[#586472]">No domain matches “{domainQ.trim()}”.</p>}
            {shownDomains.map((d) => (
              <label key={d} className="flex items-start gap-2 text-sm text-[#26323d]">
                <input type="checkbox" checked={domains.includes(d)} onChange={(e) => setDomains(e.target.checked ? [...domains, d] : domains.filter((x) => x !== d))} className="mt-1 accent-[#0f766e]" /> {d}
              </label>
            ))}
          </div>
          {domains.length > 0 && <p className="text-[11px] text-[#586472]">{plural(domains.length, 'domain')} chosen</p>}
        </div>
      )}
      {mode === 'controls' && <textarea value={controls} onChange={(e) => setControls(e.target.value)} rows={3} placeholder="Control numbers, separated by commas or lines (A.5.1, A.8.2)" aria-label="Control numbers" className="w-full rounded border border-[#b8c4c8] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]" />}
      {mode === 'query' && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A topic, e.g. access control" aria-label="Topic" className="w-full rounded border border-[#b8c4c8] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]" />}
      <button type="button" disabled={!ready || busy} onClick={() => onPick(selected, scope)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Use this framework
      </button>
    </div>
  );
}

export interface ReferencesPanelProps {
  session: Session;
  onChanged: () => void;
  focusKey?: string | null;
}

export default function ReferencesPanel({ session, onChanged, focusKey }: ReferencesPanelProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<AddTab>('document');
  const [opened, setOpened] = useState<string | null>(null);
  const [templateQ, setTemplateQ] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const templates = useQuery({ queryKey: ['studio', 'templates'], queryFn: studioApi.templates, staleTime: 60_000, enabled: tab === 'template' });

  useEffect(() => {
    if (!focusKey) return;
    setOpened(focusKey);
    document.getElementById(`ref-${focusKey}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusKey]);

  const add = useMutation({
    mutationFn: (body: Parameters<typeof studioApi.addReference>[1]) => studioApi.addReference(session.id, body),
    onSuccess: (r) => { onChanged(); toast({ title: `${r.key} added`, message: r.title, type: 'success' }); },
    onError: (e) => toast({ title: 'Could not add the reference', message: problemOf(e), type: 'error' }),
  });
  const upload = useMutation({
    mutationFn: (f: File) => studioApi.uploadReference(session.id, f),
    onSuccess: (r) => { onChanged(); toast({ title: `${r.key} added`, message: r.title, type: 'success' }); },
    onError: (e) => toast({ title: 'Could not add the file', message: problemOf(e), type: 'error' }),
  });
  const total = useMemo(() => session.references.filter((r) => r.include).reduce((n, r) => n + r.chars, 0), [session.references]);

  const tabs: { key: AddTab; label: string }[] = [
    { key: 'parent', label: 'Parent' },
    { key: 'document', label: 'Document' },
    { key: 'framework', label: 'Framework' },
    { key: 'upload', label: 'Upload' },
    { key: 'template', label: 'Template' },
  ];
  return (
    <div className="h-full overflow-y-auto p-3">
      <h3 className="text-sm font-semibold text-[#1f2933]">References</h3>
      <p className="mt-0.5 text-xs text-[#586472]">Comply Agent uses these, cites them by number, and its quotes are checked against them. {total > 0 && <span>{size(total)} in use.</span>}</p>

      <ul className="mt-3 space-y-2" aria-label="Attached references">
        {session.references.length === 0 && <li className="rounded-lg border border-dashed border-[#c5ccd3] p-3 text-center text-xs text-[#586472]">Nothing attached yet. Comply Agent will write from general knowledge and your instructions.</li>}
        {session.references.map((r) => <Attached key={r.id} session={session} reference={r} onChanged={onChanged} open={opened === r.key} onToggleOpen={() => setOpened(opened === r.key ? null : r.key)} />)}
      </ul>

      <div className="mt-4 rounded-xl border border-[#d5dbe1] bg-[#f8fafb] p-2.5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#586472]">Add a reference</p>
        <div className="mb-2.5 flex flex-wrap gap-1" role="tablist" aria-label="Kind of reference">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === t.key ? 'bg-[#0f4c5c] text-white' : 'bg-white text-[#3f4b58] ring-1 ring-[#c5ccd3] hover:bg-[#eef1f4]'}`}>{t.label}</button>
          ))}
        </div>
        {tab === 'parent' && (
          <div className="space-y-2">
            <p className="text-xs text-[#586472]">The document this one sits under (a standard under a policy, a procedure under a standard). Comply Agent keeps it consistent with its parent.</p>
            {session.document_id && (
              <button type="button" disabled={add.isPending} onClick={() => add.mutate({ kind: 'parent_document' })} className="rounded-lg border border-[#0f766e] bg-white px-3 py-1.5 text-xs font-semibold text-[#0b6b58] hover:bg-[#e6f4f1] disabled:opacity-50">Use this document’s parent</button>
            )}
            <DocumentPicker busy={add.isPending} empty="No document found." exclude={session.document_id} onPick={(d) => add.mutate({ kind: 'parent_document', source_id: d.id })} />
          </div>
        )}
        {tab === 'document' && (
          <div className="space-y-2">
            <p className="text-xs text-[#586472]">Any document from the library to use as a general reference (a related policy, a past version, a sample).</p>
            <DocumentPicker busy={add.isPending} empty="No document found." exclude={session.document_id} onPick={(d) => add.mutate({ kind: 'document', source_id: d.id })} />
          </div>
        )}
        {tab === 'framework' && (
          <div className="space-y-2">
            <p className="text-xs text-[#586472]">A framework from the platform. Comply Agent cites its clause numbers; quotes are checked against the clause text.</p>
            <FrameworkPicker busy={add.isPending} onPick={(fw, scope) => add.mutate({ kind: 'framework', source_id: fw.id, scope })} />
          </div>
        )}
        {tab === 'upload' && (
          <div className="space-y-2">
            <p className="text-xs text-[#586472]">Any file to use as a reference: Word, PDF, Excel, PowerPoint, text or data, or a picture of text (read on the server). It is kept with this session only. You can also attach files in the chat.</p>
            <input ref={file} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
            <button type="button" disabled={upload.isPending} onClick={() => file.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#7b8794] bg-white px-3 py-3 text-sm font-medium text-[#26323d] hover:border-[#0f766e] hover:bg-[#f3fbf9] disabled:opacity-50">
              {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Choose a file
            </button>
          </div>
        )}
        {tab === 'template' && (
          <div className="space-y-2">
          <SearchBox value={templateQ} onChange={setTemplateQ} placeholder="Search the templates" label="Search the templates" />
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {templates.isLoading && <li className="p-2 text-xs text-[#586472]"><Loader2 className="inline h-3.5 w-3.5 animate-spin" /> Loading…</li>}
            {templates.data && templateQ.trim() && !templates.data.items.some((t) => t.id !== 'builtin:blank' && matches(templateQ, t.name, t.doc_type)) && (
              <li className="rounded-lg border border-dashed border-[#c5ccd3] p-3 text-center text-xs text-[#586472]">No template matches “{templateQ.trim()}”.</li>
            )}
            {templates.data?.items.filter((t) => t.id !== 'builtin:blank' && matches(templateQ, t.name, t.doc_type)).map((t) => (
              <li key={t.id}>
                <button type="button" disabled={add.isPending} onClick={() => add.mutate({ kind: 'template', template_id: t.id })} className="flex w-full items-center gap-2 rounded-lg border border-[#e1e5e9] bg-white px-2.5 py-1.5 text-left hover:border-[#0f766e] hover:bg-[#f3fbf9]">
                  <FileText className="h-4 w-4 shrink-0 text-[#586472]" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm text-[#1f2933]">{t.name}</span><span className="block text-[11px] text-[#586472]">{t.builtin ? 'Standard structure' : 'Your template'}{t.is_default && !t.builtin ? ' · default' : ''}</span></span>
                  <Plus className="h-4 w-4 text-[#0f766e]" />
                </button>
              </li>
            ))}
          </ul>
          </div>
        )}
      </div>
    </div>
  );
}
