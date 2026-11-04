'use client';

/**
 * The "From a framework" tab of the New document popup: the documents an organisation needs for a framework, listed by Comply Agent from the
 * framework's controls and without the ones it already has or is writing (the same suggestions the AI Draft form used to give). Choosing one fills
 * its title, type and description from the suggestion; the person adds only what Comply Agent cannot know (the owner, the department, who reviews
 * and approves, the review cycle) and Create writes the whole document, about 4 to 8 pages, in the studio as a draft that Move to library takes
 * those details into. The lists and the body of the request are in suggestModel.ts (tested).
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Search, Sparkles, Wand2 } from 'lucide-react';
import { studioApi, type FrameworkItem, type Session, type SuggestedDoc } from '@/lib/studio/api';
import { InfoTip } from '@/components/ui/InfoTip';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { Button, EmptyState, ErrorState, Notice, SegmentedControl, SkeletonLines, StatusPill, TextInput, useNotify } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { DocumentDetailsFields, useDocumentDetails } from '../../_DetailsFields';
import { NO_SIGNOFF, ReviewerApproverFields, type SignoffChoice } from '../../_SignoffControl';
import { countByType, createBody, leftOut, LENGTH_NOTE, PRIORITY_LABEL, shown, sortSuggestions, SUGGEST_TYPES, WRITABLE_TYPES } from './suggestModel';

const ROW = 'flex w-full items-start gap-[10px] rounded-ds-card border border-ds-border bg-ds-surface p-[10px] text-left hover:border-ds-primary hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring';
const PRIORITY_TONE = { high: 'danger', medium: 'warning', low: 'neutral' } as const;
const typeWord = (t: string) => SUGGEST_TYPES.find((x) => x.value === t)?.label ?? t.charAt(0).toUpperCase() + t.slice(1);
const fwName = (f: FrameworkItem) => `${f.name}${f.version ? ` ${f.version}` : ''}`;

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-[4px] flex items-center gap-[4px] text-ds-label text-ds-fg">{label}{hint && <InfoTip label={`About ${label.toLowerCase()}`} text={hint} />}</p>
      {children}
    </div>
  );
}

export default function SuggestedDocs({ onOpen, onDirty, onCancel }: { onOpen: (s: Session) => void; onDirty: (dirty: boolean) => void; onCancel: () => void }) {
  const notify = useNotify();
  const status = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 60_000 });
  const frameworks = useQuery({ queryKey: ['studio', 'frameworks'], queryFn: studioApi.frameworks, staleTime: 120_000 });
  const [step, setStep] = useState<'ask' | 'list' | 'form'>('ask');
  const [fwIds, setFwIds] = useState<number[]>([]);
  const [type, setType] = useState('');
  const [asked, setAsked] = useState<{ ids: number[]; type: string }>({ ids: [], type: '' });
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState('');
  const [chosen, setChosen] = useState<SuggestedDoc | null>(null);

  const suggest = useMutation({
    mutationFn: () => studioApi.suggestDocuments(fwIds, type || undefined),
    onSuccess: () => { setAsked({ ids: fwIds, type }); setQuery(''); setOnly(''); setStep('list'); },
    onError: (e) => notify.error(e, { title: 'Could not suggest documents', retry: canRetry(e) ? () => suggest.mutate() : undefined }),
  });
  const list = useMemo(() => sortSuggestions(suggest.data?.suggestions ?? []), [suggest.data]);
  const rows = useMemo(() => shown(list, only, query), [list, only, query]);
  const counts = useMemo(() => countByType(list), [list]);
  const covered = useMemo(() => leftOut(suggest.data), [suggest.data]);
  const fwItems = (frameworks.data?.items ?? []).map((f) => ({ value: String(f.id), label: fwName(f), subLabel: `${f.controls} controls` }));
  const names = (frameworks.data?.items ?? []).filter((f) => asked.ids.includes(f.id)).map(fwName);

  if (step === 'form' && chosen) {
    return <CreateForm suggestion={chosen} frameworkIds={asked.ids} frameworkNames={names} aiReady={status.data?.ai_configured !== false}
      onBack={() => { onDirty(false); setStep('list'); }} onOpen={onOpen} onDirty={onDirty} />;
  }

  if (step === 'list') {
    return (
      <div className="space-y-[10px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <p className="flex items-center gap-[4px] text-ds-body font-[600] text-ds-fg">
            {list.length} to write
            <InfoTip label="About the suggestions" text={`Comply Agent read the controls of ${names.join(', ') || 'the framework'} and lists the documents you would need, most important first. Documents you already have, or are writing, are left out.`} />
          </p>
          <div className="ml-auto flex items-center gap-[8px]">
            <TextInput type="search" aria-label="Search the suggestions" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" leftAdornment={<Search aria-hidden />} className="w-[12rem]" />
            <Button size="sm" onClick={() => setStep('ask')}>Change</Button>
          </div>
        </div>
        {!asked.type && list.length > 0 && (
          <SegmentedControl label="Show only" name="suggest-only" value={only} onChange={setOnly}
            options={SUGGEST_TYPES.filter((t) => !t.value || counts[t.value]).map((t) => ({ value: t.value, label: `${t.label} ${counts[t.value] ?? 0}` }))} />
        )}
        {asked.type && <p className="text-ds-label text-ds-fg-muted">Showing {typeWord(asked.type).toLowerCase()} documents only.</p>}
        {rows.length === 0 ? (
          <EmptyState kind="noMatches" title={list.length ? 'Nothing matches' : 'Nothing to suggest'} description={list.length ? 'Change the search or the type.' : 'The organisation already has what these frameworks call for, or Comply Agent found nothing more. Try another framework or type.'}
            onClearFilters={list.length && (query || only) ? () => { setQuery(''); setOnly(''); } : undefined} />
        ) : (
          <ul className="max-h-[22rem] space-y-[6px] overflow-y-auto pr-[2px]" aria-label="Suggested documents">
            {rows.map((s) => (
              <li key={`${s.doc_type}-${s.title}`}>
                <button type="button" className={ROW} onClick={() => { setChosen(s); setStep('form'); }} aria-label={`Create ${s.title}`}>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-[6px]">
                      <span className="text-ds-body font-[600] text-ds-fg">{s.title}</span>
                      <StatusPill tone="neutral" size="sm" label={typeWord(s.doc_type)} />
                      <StatusPill tone={PRIORITY_TONE[s.priority] ?? 'neutral'} size="sm" label={`${PRIORITY_LABEL[s.priority] ?? s.priority} priority`} />
                    </span>
                    {s.description && <span className="mt-[2px] block text-ds-body text-ds-fg-body">{s.description}</span>}
                    {s.relevant_controls?.length > 0 && <span className="mt-[4px] block text-ds-label text-ds-fg-muted">Covers {s.relevant_controls.slice(0, 5).join(', ')}{s.relevant_controls.length > 5 ? ` +${s.relevant_controls.length - 5}` : ''}</span>}
                  </span>
                  <ChevronRight aria-hidden className="mt-[4px] h-[16px] w-[16px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {covered.length > 0 && (
          <details className="rounded-ds-card border border-ds-border bg-ds-surface">
            <summary className="flex min-h-[var(--ds-control-h)] cursor-pointer list-none items-center gap-[6px] px-[10px] text-ds-body font-[600] text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden className="h-[14px] w-[14px] text-ds-fg-muted" strokeWidth={1.75} />
              Left out: you have them <span className="font-normal text-ds-fg-muted">({covered.length})</span>
              <InfoTip label="About the left-out documents" text="A suggestion is left out when the library has a document of the same title, a similar one or one on the same subject, or when you are writing it in the studio. The document that matched is named." />
            </summary>
            <ul className="max-h-[11rem] space-y-[4px] overflow-y-auto border-t border-ds-border px-[10px] py-[8px]">
              {covered.map((c) => (
                <li key={c.key} className="text-ds-body text-ds-fg-body">
                  {c.suggested && <span className="text-ds-fg-muted line-through">{c.suggested}</span>}{c.suggested && <span className="px-[4px] text-ds-fg-muted" aria-hidden>→</span>}
                  {c.href ? <Link href={c.href} className="font-[600] text-ds-primary-text underline underline-offset-2">{c.title}</Link> : <span className="font-[600] text-ds-fg">{c.title}</span>}
                  <span className="text-ds-label text-ds-fg-muted"> · {[c.status, c.how].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-[12px]">
      <Labeled label="Framework" hint="Comply Agent reads the controls of the frameworks you choose and lists the documents the organisation needs for them: policies, standards, procedures, guidelines and charters. Documents you already have, or are writing, are left out.">
        {frameworks.isError && !frameworks.data ? (
          <ErrorState compact title="Couldn't load the frameworks" message={errorMessage(frameworks.error)} onRetry={canRetry(frameworks.error) ? () => { void frameworks.refetch(); } : undefined} />
        ) : (
          <MultiSelectDropdown title="Framework" items={fwItems} selectedValues={fwIds.map(String)} onApply={(v) => setFwIds(v.map(Number))} triggerVariant="input" size="sm" showAvatars={false} compact forceSearch
            placeholder={frameworks.isLoading ? 'Loading…' : fwItems.length ? 'Choose one or more' : 'No frameworks yet'} searchPlaceholder="Search the frameworks" className="w-full" triggerClassName="w-full" disabled={suggest.isPending || !fwItems.length} />
        )}
      </Labeled>
      <Labeled label="Type">
        <SegmentedControl label="Type of document" name="suggest-type" options={SUGGEST_TYPES} value={type} onChange={setType} disabled={suggest.isPending} />
      </Labeled>
      {suggest.isPending ? (
        <div role="status" className="space-y-[8px]">
          <p className="flex items-center gap-[6px] text-ds-body text-ds-fg-body"><Wand2 aria-hidden className="h-[14px] w-[14px] animate-pulse text-ds-primary-text" />Comply Agent is reading the framework&apos;s controls; this takes up to a minute.</p>
          <SkeletonLines lines={4} label="Reading the framework" />
        </div>
      ) : (
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" leftIcon={<Wand2 aria-hidden />} disabled={!fwIds.length} onClick={() => suggest.mutate()}>Suggest documents</Button>
        </div>
      )}
    </div>
  );
}

/** The suggestion, filled in, with what only the person can say; Create writes it. */
function CreateForm({ suggestion, frameworkIds, frameworkNames, aiReady, onBack, onOpen, onDirty }: {
  suggestion: SuggestedDoc; frameworkIds: number[]; frameworkNames: string[]; aiReady: boolean; onBack: () => void; onOpen: (s: Session) => void; onDirty: (dirty: boolean) => void;
}) {
  const notify = useNotify();
  const details = useDocumentDetails({ title: suggestion.title, doc_type: suggestion.doc_type, description: suggestion.description, classification: 'internal', review_cycle_months: 12 });
  const [signoff, setSignoff] = useState<SignoffChoice>(NO_SIGNOFF);
  const tracked: typeof details = { ...details, set: (patch) => { onDirty(true); details.set(patch); } };
  const create = useMutation({
    mutationFn: () => studioApi.createFromSuggestion(createBody(details.form, suggestion, frameworkIds, signoff.reviewers.length || signoff.approvers.length ? signoff : undefined)),
    onSuccess: (r) => {
      if (r.warnings.length) notify.warning(r.warnings.join('\n'), { title: 'Some references could not be added' });
      onDirty(false);
      onOpen(r.session);
    },
    onError: (e) => notify.error(e, { title: 'Could not create the document' }),               // not offered again: a second try could make a second document
  });
  return (
    <div className="space-y-[12px]">
      <Button variant="link" size="sm" leftIcon={<ArrowLeft aria-hidden />} onClick={onBack} disabled={create.isPending}>Back to the suggestions</Button>
      <div className="flex flex-wrap items-center gap-[6px] text-ds-label text-ds-fg-muted">
        <StatusPill tone={PRIORITY_TONE[suggestion.priority] ?? 'neutral'} size="sm" label={`${PRIORITY_LABEL[suggestion.priority] ?? suggestion.priority} priority`} />
        {frameworkNames.length > 0 && <span>For {frameworkNames.join(', ')}</span>}
        {suggestion.relevant_controls?.length > 0 && <span>· Covers {suggestion.relevant_controls.join(', ')}</span>}
      </div>
      <DocumentDetailsFields d={tracked} types={WRITABLE_TYPES} />
      <ReviewerApproverFields value={signoff} onChange={(v) => { onDirty(true); setSignoff(v); }} />
      {!aiReady && <Notice tone="warning" title="Comply Agent is not connected">The document cannot be written until an administrator connects it. The suggestions still work.</Notice>}
      <p className="text-ds-label text-ds-fg-muted">{LENGTH_NOTE}</p>
      <div className="flex justify-end gap-[8px]">
        <Button onClick={onBack} disabled={create.isPending}>Back</Button>
        <Button variant="primary" leftIcon={<Sparkles aria-hidden />} loading={create.isPending} disabled={!details.form.title.trim() || !aiReady} onClick={() => create.mutate()}>Create and write</Button>
      </div>
    </div>
  );
}
