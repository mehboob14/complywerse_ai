'use client';

/**
 * What the AI may lean on: the parent document, a general reference document from the library, a framework from the platform
 * (all of it, some domains, named controls, or a topic), a file you upload, or a template. Each is attached to this session
 * only, shown here, and the AI cites it by its number (R1, R2 …) so its quotes can be checked.
 *
 * On the design-system kit: the buttons, fields and choices are the kit's; the kind of reference is a named choice (not a tab strip with
 * no panels); a list that is loading, empty or could not be read says which.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BookMarked, Eye, EyeOff, FileText, Layers, Paperclip, Plus, Search, Trash2, Upload } from 'lucide-react';
import { DOC_TYPE_LABEL, studioApi, type FrameworkItem, type LibraryDoc, type Reference, type ReferenceScope, type Session } from '@/lib/studio/api';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Checkbox, ErrorState, IconButton, SegmentedControl, SkeletonLines, SkeletonRows, Textarea, TextInput, useNotify } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
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

const size = (chars: number): string => (chars < 1000 ? `${chars} chars` : `${Math.round(chars / 1000)}k chars`);

/** What each kind of reference is for: the (i) beside "Add reference" says it for the kind that is open. */
const HELP: Record<'parent' | 'document' | 'framework' | 'upload', string> = {
  parent: 'The document this one sits under (a standard under a policy, a procedure under a standard). Comply Agent keeps it consistent with its parent.',
  document: 'Any document from the library to use as a general reference (a related policy, a past version, a sample).',
  framework: 'A framework from the platform. Comply Agent cites its clause numbers; quotes are checked against the clause text.',
  upload: 'Any file to use as a reference: Word, PDF, Excel, PowerPoint, text or data, or a picture of text (read on the server). It is kept with this session only. You can also attach files in the chat.',
};

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export { matches };

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return <TextInput type="search" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} leftAdornment={<Search aria-hidden />} />;
}

/** The wait for a list: grey bars, "Loading" said once. */
const Waiting = ({ label = 'Loading' }: { label?: string }) => <li><SkeletonRows rows={3} columns={1} label={label} /></li>;

/** A row a person picks (a document, a framework, a template). */
export const PICK_ROW = 'flex min-h-ds-control w-full items-center gap-[8px] rounded-ds-control border border-ds-border bg-ds-surface px-[10px] py-[6px] text-left hover:border-ds-primary hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring disabled:cursor-not-allowed disabled:opacity-50';
/** A list with nothing to show: said in a dashed box. */
const NOTHING = 'rounded-ds-card border border-dashed border-ds-border-strong p-[12px] text-center text-ds-label text-ds-fg-muted';

/** The platform's frameworks with a search over name, version and publisher. Shared by the references panel and the start screen. A list that
 *  could not be read says so (with Retry when repeating can help): it is not "No frameworks". */
export function FrameworkList({ frameworks, loading, error, onRetry, exclude = [], onPick, maxHeight = 'max-h-64' }: {
  frameworks?: FrameworkItem[]; loading: boolean; error?: unknown; onRetry?: () => void; exclude?: number[]; onPick: (fw: FrameworkItem) => void; maxHeight?: string;
}) {
  const [q, setQ] = useState('');
  const all = (frameworks ?? []).filter((f) => !exclude.includes(f.id));
  const shown = all.filter((f) => matches(q, f.name, f.version, f.organisation));
  const failed = error != null && !frameworks;
  return (
    <div>
      <SearchBox value={q} onChange={setQ} placeholder="Search frameworks" label="Search the frameworks" />
      {!loading && all.length > 0 && <p className="mt-[4px] text-ds-label text-ds-fg-muted" role="status">{q.trim() ? `${shown.length} of ${plural(all.length, 'framework')}` : plural(all.length, 'framework')}</p>}
      <ul className={`mt-[6px] space-y-[4px] overflow-y-auto ${maxHeight}`}>
        {loading && <Waiting label="Loading the frameworks" />}
        {failed && !loading && <li><ErrorState compact title="Couldn't load the frameworks" message={errorMessage(error)} onRetry={onRetry && canRetry(error) ? onRetry : undefined} /></li>}
        {!loading && !failed && shown.length === 0 && <li className={NOTHING}>{q.trim() ? 'No match' : 'No frameworks'}</li>}
        {shown.map((f) => (
          <li key={f.id}>
            <button type="button" onClick={() => onPick(f)} className={PICK_ROW}>
              <BookMarked aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ds-body text-ds-fg" title={`${f.name}${f.version ? ` ${f.version}` : ''}`}>{f.name}{f.version ? ` ${f.version}` : ''}</span>
                <span className="block text-ds-label text-ds-fg-muted">{[f.organisation, `${f.controls} controls`].filter(Boolean).join(' · ')}</span>
              </span>
              <Plus aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-primary-text" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Attached({ session, reference, onChanged, open, onToggleOpen }: { session: Session; reference: Reference; onChanged: () => void; open: boolean; onToggleOpen: () => void }) {
  const notify = useNotify();
  const Icon = KIND_ICON[reference.kind];
  const toggle = useMutation({
    mutationFn: () => studioApi.toggleReference(session.id, reference.id, !reference.include),
    onSuccess: onChanged,
    onError: (e) => notify.error(e, { title: 'Could not change the reference', retry: canRetry(e) ? () => toggle.mutate() : undefined }),
  });
  const remove = useMutation({
    mutationFn: () => studioApi.removeReference(session.id, reference.id),
    onSuccess: onChanged,
    onError: (e) => notify.error(e, { title: 'Could not remove the reference', retry: canRetry(e) ? () => remove.mutate() : undefined }),
  });
  const text = useQuery({ queryKey: ['studio', 'reference-text', session.id, reference.id], queryFn: () => studioApi.readReference(session.id, reference.id), enabled: open, staleTime: 60_000 });
  return (
    <li id={`ref-${reference.key}`} className={`rounded-ds-card border bg-ds-surface p-[10px] ${reference.include ? 'border-ds-border' : 'border-ds-border opacity-60'}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded bg-ds-primary-soft px-1.5 py-0.5 text-ds-label font-[700] text-ds-primary-text">{reference.key}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-ds-body font-medium text-ds-fg" title={reference.title}>{reference.title}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-ds-label text-ds-fg-muted">
            <Icon aria-hidden className="h-3 w-3" /> {KIND_LABEL[reference.kind]}
            {reference.label ? <span>· {reference.label}</span> : null}
            <span>· {size(reference.chars)}</span>
            {reference.scope?.mode && reference.scope.mode !== 'all' ? <span>· {reference.scope.mode === 'domains' ? plural(reference.scope.domains?.length ?? 0, 'domain')
              : reference.scope.mode === 'query' ? (reference.scope.query ? `about “${reference.scope.query}”` : 'about a topic') : reference.scope.mode}</span> : null}
          </p>
          {reference.truncated && (
            <p className="mt-0.5 text-ds-label text-ds-warning">
              Too long: only the start is used
              <InfoTip className="ml-1" label="About the length" text="Only the start was given to Comply Agent. Narrow it to the parts that matter." />
            </p>
          )}
          {reference.notes.map((n, i) => <p key={i} className="mt-0.5 text-ds-label text-ds-warning">{n}</p>)}
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton label={`Read ${reference.key}`} title="Read the text Comply Agent is given" aria-expanded={open} onClick={onToggleOpen}><Eye aria-hidden /></IconButton>
          <IconButton label={reference.include ? `Pause ${reference.key}` : `Use ${reference.key}`} title={reference.include ? 'Do not use for now' : 'Use again'} disabled={toggle.isPending} onClick={() => toggle.mutate()}>
            {reference.include ? <EyeOff aria-hidden /> : <Plus aria-hidden />}
          </IconButton>
          <IconButton label={`Remove ${reference.key}`} title="Remove" disabled={remove.isPending} onClick={() => remove.mutate()} className="!text-ds-danger"><Trash2 aria-hidden /></IconButton>
        </div>
      </div>
      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-ds-control border border-ds-border bg-ds-surface-subtle p-2">
          {text.isLoading ? <SkeletonLines lines={3} label="Loading the text" />
            : text.isError ? <ErrorState compact title="Couldn't load the text" message={errorMessage(text.error)} onRetry={canRetry(text.error) ? () => { void text.refetch(); } : undefined} />
            : <pre className="whitespace-pre-wrap font-sans text-ds-label leading-relaxed text-ds-fg-body">{text.data?.text ?? ''}</pre>}
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
      <SearchBox value={q} onChange={setQ} placeholder="Search documents" label="Search the library" />
      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
        {docs.isLoading && <Waiting label="Loading the library" />}
        {docs.isError && !docs.data && <li><ErrorState compact title="Couldn't load the library" message={errorMessage(docs.error)} onRetry={canRetry(docs.error) ? () => { void docs.refetch(); } : undefined} /></li>}
        {docs.data?.items.length === 0 && <li className="p-2 text-ds-label text-ds-fg-muted">{empty}</li>}
        {docs.data?.items.map((d) => (
          <li key={d.id}>
            <button type="button" disabled={busy || (!d.has_text && !d.has_file)} onClick={() => onPick(d)} className={PICK_ROW}>
              <FileText aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ds-body text-ds-fg" title={d.title}>{d.title}</span>
                <span className="block text-ds-label text-ds-fg-muted">{docLine(d, DOC_TYPE_LABEL, SIGNOFF_STATUS)}{!d.has_text && !d.has_file ? ' · no text' : ''}</span>
              </span>
              <Plus aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-primary-text" strokeWidth={1.75} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SCOPES = [['all', 'controls'], ['domains', 'Some domains'], ['controls', 'Named controls'], ['query', 'Controls about a topic']] as const;

function FrameworkPicker({ onPick, busy }: { onPick: (fw: FrameworkItem, scope: ReferenceScope) => void; busy: boolean }) {
  const fws = useQuery({ queryKey: ['studio', 'frameworks'], queryFn: studioApi.frameworks, staleTime: 120_000 });
  const [selected, setSelected] = useState<FrameworkItem | null>(null);
  const [mode, setMode] = useState<NonNullable<ReferenceScope['mode']>>('all');
  const [domains, setDomains] = useState<string[]>([]);
  const [controls, setControls] = useState('');
  const [query, setQuery] = useState('');
  const [domainQ, setDomainQ] = useState('');
  if (!selected) {
    return <FrameworkList frameworks={fws.data?.items} loading={fws.isLoading} error={fws.isError ? fws.error : null} onRetry={() => { void fws.refetch(); }}
      onPick={(f) => { setSelected(f); setMode('all'); setDomains([]); setDomainQ(''); }} />;
  }
  const shownDomains = selected.domains.filter((d) => matches(domainQ, d));
  const scope: ReferenceScope = mode === 'domains' ? { mode, domains } : mode === 'controls' ? { mode, control_refs: controls.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) } : mode === 'query' ? { mode, query } : { mode: 'all' };
  const ready = mode === 'all' || (mode === 'domains' && domains.length > 0) || (mode === 'controls' && (scope.control_refs?.length ?? 0) > 0) || (mode === 'query' && query.trim().length > 3);
  return (
    <div className="space-y-2.5 rounded-ds-card border border-ds-border bg-ds-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 break-words text-ds-body font-[600] text-ds-fg">{selected.name}{selected.version ? ` ${selected.version}` : ''}</p>
        <Button variant="link" size="sm" onClick={() => setSelected(null)}>Choose another</Button>
      </div>
      <fieldset>
        <legend className="mb-1 text-ds-label text-ds-fg" title="Which part should Comply Agent use?">Part to use</legend>
        {SCOPES.map(([value, label]) => (
          <label key={value} className="flex min-h-[var(--ds-control-h-sm)] cursor-pointer items-center gap-2 text-ds-body text-ds-fg-body">
            <input type="radio" name="fw-scope" checked={mode === value} onChange={() => setMode(value)} className="h-[16px] w-[16px] shrink-0 accent-ds-primary focus-visible:outline-none focus-visible:shadow-ds-ring" /> {value === 'all' ? `All ${selected.controls} controls` : label}
          </label>
        ))}
      </fieldset>
      {mode === 'domains' && (
        <div className="space-y-1.5">
          {selected.domains.length > 6 && <SearchBox value={domainQ} onChange={setDomainQ} placeholder="Search the domains" label="Search the domains of this framework" />}
          <div className="max-h-48 overflow-y-auto rounded-ds-control border border-ds-border px-2">
            {shownDomains.length === 0 && <p className="py-2 text-ds-label text-ds-fg-muted">No match</p>}
            {shownDomains.map((d) => (
              <Checkbox key={d} label={d} checked={domains.includes(d)} onChange={(e) => setDomains(e.target.checked ? [...domains, d] : domains.filter((x) => x !== d))} />
            ))}
          </div>
          {domains.length > 0 && <p className="text-ds-label text-ds-fg-muted">{domains.length} chosen</p>}
        </div>
      )}
      {mode === 'controls' && <Textarea value={controls} onChange={(e) => setControls(e.target.value)} rows={3} placeholder="Control numbers: A.5.1, A.8.2" title="Separate them with commas or lines" aria-label="Control numbers" />}
      {mode === 'query' && <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Topic, e.g. access control" aria-label="Topic" />}
      <Button variant="primary" leftIcon={<Plus aria-hidden />} loading={busy} disabled={!ready} onClick={() => onPick(selected, scope)}>Use framework</Button>
    </div>
  );
}

export interface ReferencesPanelProps {
  session: Session;
  onChanged: () => void;
  focusKey?: string | null;
}

const KINDS: { value: AddTab; label: string }[] = [
  { value: 'parent', label: 'Parent' },
  { value: 'document', label: 'Document' },
  { value: 'framework', label: 'Framework' },
  { value: 'upload', label: 'Upload' },
  { value: 'template', label: 'Template' },
];

export default function ReferencesPanel({ session, onChanged, focusKey }: ReferencesPanelProps) {
  const notify = useNotify();
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
    onSuccess: (r) => { onChanged(); notify.success(r.title, { title: `${r.key} added` }); },
    onError: (e) => notify.error(e, { title: 'Could not add the reference' }),
  });
  const upload = useMutation({
    mutationFn: (f: File) => studioApi.uploadReference(session.id, f),
    onSuccess: (r) => { onChanged(); notify.success(r.title, { title: `${r.key} added` }); },
    onError: (e) => notify.error(e, { title: 'Could not add the file' }),
  });
  const total = useMemo(() => session.references.filter((r) => r.include).reduce((n, r) => n + r.chars, 0), [session.references]);
  const templateRows = (templates.data?.items ?? []).filter((t) => t.id !== 'builtin:blank' && matches(templateQ, t.name, t.doc_type));

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="flex items-center gap-1">
        <h3 className="text-[15px] font-semibold text-[#1f2933]">References</h3>
        <InfoTip label="About the references" text="Comply Agent uses these, cites them by number, and its quotes are checked against them." />
        {total > 0 && <span className="ml-auto text-ds-label text-ds-fg-muted" title="The text Comply Agent is given from these">{size(total)} in use</span>}
      </div>

      <ul className="mt-3 space-y-2" aria-label="Attached references">
        {session.references.length === 0 && (
          <li className="flex flex-col items-center gap-2 rounded-ds-card border border-dashed border-ds-border-strong px-3 py-6 text-center">
            <BookMarked className="h-8 w-8 text-ds-fg-muted" strokeWidth={1.5} aria-hidden />
            <p className="text-[15px] font-semibold text-[#1f2933]">
              No references
              <InfoTip className="ml-1" label="About writing without references" text="Comply Agent will write from general knowledge and your instructions." />
            </p>
          </li>
        )}
        {session.references.map((r) => <Attached key={r.id} session={session} reference={r} onChanged={onChanged} open={opened === r.key} onToggleOpen={() => setOpened(opened === r.key ? null : r.key)} />)}
      </ul>

      <div className="mt-4 rounded-ds-card border border-ds-border bg-ds-surface p-2.5">
        <div className="mb-2 flex items-center gap-1">
          <p className="text-ds-body font-[600] text-ds-fg">Add reference</p>
          {tab !== 'template' && <InfoTip label="About this kind of reference" text={HELP[tab]} />}
        </div>
        {/* a choice of one kind, each opening its own form below: named radio buttons (the arrow keys move between them), not tabs without panels */}
        <SegmentedControl<AddTab> label="Kind of reference" name="add-reference-kind" options={KINDS} value={tab} onChange={setTab} className="mb-2.5" />
        {tab === 'parent' && (
          <div className="space-y-2">
            {session.document_id && (
              <Button loading={add.isPending} onClick={() => add.mutate({ kind: 'parent_document' })} title="Use this document’s parent">Use its parent</Button>
            )}
            <DocumentPicker busy={add.isPending} empty="No documents" exclude={session.document_id} onPick={(d) => add.mutate({ kind: 'parent_document', source_id: d.id })} />
          </div>
        )}
        {tab === 'document' && (
          <div className="space-y-2">
            <DocumentPicker busy={add.isPending} empty="No documents" exclude={session.document_id} onPick={(d) => add.mutate({ kind: 'document', source_id: d.id })} />
          </div>
        )}
        {tab === 'framework' && (
          <div className="space-y-2">
            <FrameworkPicker busy={add.isPending} onPick={(fw, scope) => add.mutate({ kind: 'framework', source_id: fw.id, scope })} />
          </div>
        )}
        {tab === 'upload' && (
          <div className="space-y-2">
            <input ref={file} type="file" hidden aria-label="Choose a file" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
            <Button leftIcon={<Upload aria-hidden />} loading={upload.isPending} onClick={() => file.current?.click()}>Choose file</Button>
          </div>
        )}
        {tab === 'template' && (
          <div className="space-y-2">
            <SearchBox value={templateQ} onChange={setTemplateQ} placeholder="Search templates" label="Search the templates" />
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {templates.isLoading && <Waiting label="Loading the templates" />}
              {templates.isError && !templates.data && <li><ErrorState compact title="Couldn't load the templates" message={errorMessage(templates.error)} onRetry={canRetry(templates.error) ? () => { void templates.refetch(); } : undefined} /></li>}
              {templates.data && templateRows.length === 0 && <li className={NOTHING}>{templateQ.trim() ? 'No match' : 'No templates'}</li>}
              {templateRows.map((t) => (
                <li key={t.id}>
                  <button type="button" disabled={add.isPending} onClick={() => add.mutate({ kind: 'template', template_id: t.id })} className={PICK_ROW}>
                    <FileText aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-ds-body text-ds-fg" title={t.name}>{t.name}</span><span className="block text-ds-label text-ds-fg-muted">{t.builtin ? 'Standard structure' : 'Your template'}{t.is_default && !t.builtin ? ' · default' : ''}</span></span>
                    <Plus aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-primary-text" strokeWidth={1.75} />
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
