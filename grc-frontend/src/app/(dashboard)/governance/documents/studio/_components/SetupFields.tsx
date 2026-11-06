'use client';

/**
 * Setting up a document before Comply Agent writes it: the organisation, where it applies and its regulators, the laws and circulars,
 * the frameworks, the subject areas, the departments, the audience, the length, the classification and the review cycle — picked from
 * dropdowns that start with what the platform knows about the organisation, with "Fill in from your organisation" for the rest. Kept as
 * the document's instructions (saved as you choose), so the web research, Comply Agent's questions and the draft follow them. A library
 * document's own classification and review cycle come from the document and change only in its Details.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Sparkles } from 'lucide-react';
import { studioApi, type Instructions, type Session, type SetupOptions } from '@/lib/studio/api';
import { ComboBoxInput, type ComboBoxOption } from '@/components/ui/ComboBoxInput';
import { InfoTip } from '@/components/ui/InfoTip';
import { MultiSelectDropdown, type MultiSelectDropdownItem } from '@/components/ui/MultiSelectDropdown';
import { Button, ErrorState, Select, SkeletonLines, Textarea, TextInput, useNotify } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { queueFor } from './setupPatch';
import { countryOptions, frameworkItems, lawItems, regulatorItems, SEVERAL } from './setupCountry';

/** The lists as this server sends them; the newer fields are optional so an older server still works. */
type Options = SetupOptions & {
  entity_names?: string[];
  defaults?: { country: string; entity_type: string; regulators: string[] };
  document?: { classification: string; review_cycle: string; owner: string; department: string } | null;
  frameworks: { id: number; name?: string; label: string; attached: boolean; of_document?: boolean }[];
};

/** The document's instructions as the person edits them: saved a moment after typing, at once after a choice, one save at a time with
 * everything not saved yet in it, and never replaced by the server's copy while something is on its way. */
export function useInstructionsDraft(session: Session, onChanged: () => void | Promise<void>) {
  const notify = useNotify();
  const queue = useMemo(() => queueFor(session.id), [session.id]);
  const [draft, setDraft] = useState<Instructions>(() => queue.view(session.instructions));
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ onChanged, notify, id: session.id, server: session.instructions, queue });
  latest.current = { onChanged, notify, id: session.id, server: session.instructions, queue };
  // the server's copy (after a save or a reload), with what is not saved yet still on top
  useEffect(() => { setDraft(queue.view(session.instructions)); }, [session.instructions, queue]);

  const send = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const q = latest.current.queue;
    const body = q.take();
    if (!body) return;
    setSaved('saving');
    studioApi.patchSession(latest.current.id, { instructions: body as Instructions }).then(
      () => {
        q.done();
        if (q.pending) { send(); return; }
        setSaved('saved');
        // the copy fetched now has every save in it: from then on the server's copy is taken as it is
        void Promise.resolve(latest.current.onChanged()).finally(() => { q.settled(); setDraft(q.view(latest.current.server)); });
      },
      (e) => {
        q.failed();
        setSaved('idle');
        latest.current.notify.error(e, { title: 'Could not save the instructions' });
      });
  }, []);
  // leaving the tab mid-typing still saves it
  useEffect(() => () => send(), [send]);

  const change = (patch: Instructions, immediately = false) => {
    queue.add(patch);
    setDraft((cur) => ({ ...cur, ...patch }));
    if (timer.current) clearTimeout(timer.current);
    if (immediately) send();
    else timer.current = setTimeout(send, 800);
  };
  return { draft, change, saved };
}

export function SavedState({ saved }: { saved: 'idle' | 'saving' | 'saved' }) {
  return <span className="text-xs text-[#586472]" role="status">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? <span className="inline-flex items-center gap-1 text-[#0a5a38]"><Check className="h-3 w-3" /> Saved</span> : ''}</span>;
}

/** A section that folds away to one line of what it holds. */
export function Section({ title, summary, open, children }: { title: string; summary: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-ds-card border border-ds-border bg-ds-surface">
      <summary className="flex min-h-[var(--ds-control-h)] cursor-pointer list-none items-center gap-2 rounded-ds-card px-3 py-1 hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ds-fg-muted transition-transform group-open:rotate-90" aria-hidden />
        <span className="text-ds-body font-[600] text-ds-fg">{title}</span>
        <span className="min-w-0 flex-1 truncate text-right text-ds-label text-ds-fg-muted group-open:hidden" title={summary}>{summary || 'Not set'}</span>
      </summary>
      <div className="space-y-3 border-t border-ds-border px-3 pb-3 pt-2.5">{children}</div>
    </details>
  );
}

/** A label over its input; what a label cannot say is `hint`, as an (i) beside it. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 flex items-center gap-1 text-ds-label text-ds-fg">{label}{hint && <InfoTip label={`About ${label.toLowerCase()}`} text={hint} />}</p>
      {children}
    </div>
  );
}

/** Several of a list, from a dropdown with search, plus the person's own ("+ Add"). */
function Many({ label, items, value, onChange, create = true, disabled }: {
  label: string; items: MultiSelectDropdownItem[]; value: string[]; onChange: (next: string[]) => void; create?: boolean; disabled?: boolean;
}) {
  const known = new Set(items.map((i) => i.value));
  const all = [...items, ...value.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v, subLabel: 'Your own' }))];
  const take = onChange;
  const chosen = all.filter((i) => value.includes(i.value)).map((i) => i.label);
  return (
    <Field label={label}>
      {/* compact: the button already says "3 selected"; the round 11px count beside it said it twice, under the platform's 12px floor */}
      <MultiSelectDropdown title={label} items={all} selectedValues={value} onApply={take} triggerVariant="input" size="sm" showAvatars={false} compact
        forceSearch placeholder="Choose…" searchPlaceholder={create ? 'Search or type your own' : 'Search'} className="w-full" triggerClassName="w-full"
        onCreate={create ? (t) => onChange([...value, t]) : undefined} disabled={disabled} />
      {/* one choice is named on the button; several are counted there and named here */}
      {chosen.length > 1 && <p className="mt-1 truncate text-ds-label text-ds-fg-body" title={chosen.join('; ')}>{chosen.join(' · ')}</p>}
    </Field>
  );
}

/** One of a list, with search; the person may type their own. */
export function One({ label, value, options, onChange, hint, custom = true }: {
  label: string; value: string; options: ComboBoxOption[]; onChange: (v: string) => void; hint?: string; custom?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      <ComboBoxInput value={value} onChange={onChange} options={options} allowCustom={custom} ariaLabel={label} placeholder={custom ? 'Choose or type…' : 'Choose…'}
        displayLabelInsteadOfValue emptyText="No match: press Enter to use your words." />
    </Field>
  );
}

/** A short fixed list, nothing else. */
function Plain({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">Not set</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        {value && !options.includes(value) && <option value={value}>{value}</option>}
      </Select>
    </Field>
  );
}

const plain = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));
const count = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : '');
const joined = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' · ');

export function SetupFields({ session, draft, change, onReferencesChanged, firstOpen = true, allOpen = false, compact = false }: {
  session: Session; draft: Instructions; change: (patch: Instructions, immediately?: boolean) => void; onReferencesChanged: () => void | Promise<void>;
  /** the first section opens (the Instructions tab); `allOpen` opens every section */
  firstOpen?: boolean; allOpen?: boolean;
  /** the chat's setup card: the four choices that shape a draft most, the rest behind "More options" */
  compact?: boolean;
}) {
  const notify = useNotify();
  const options = useQuery({ queryKey: ['studio', 'setup', session.id], queryFn: () => studioApi.setupOptions(session.id) as Promise<Options>, staleTime: 60_000, retry: false });
  const o = options.data;
  const list = (key: keyof Instructions) => (Array.isArray(draft[key]) ? (draft[key] as string[]) : []);
  const text = (key: keyof Instructions) => String(draft[key] ?? '');
  const country = text('country');
  const [fwBusy, setFwBusy] = useState(false);
  const [notes, setNotes] = useState(() => !!text('regulatory_notes'));
  const [more, setMore] = useState(false);
  const doc = o?.document ?? null;
  // what choosing the country offers: its regulators, laws and frameworks, then its bloc's and the international ones (a country typed by hand has none)
  const detail = useQuery({ queryKey: ['studio', 'country', country], queryFn: () => studioApi.setupCountry(country), enabled: !!country && country !== SEVERAL,
    staleTime: 10 * 60_000, retry: false });

  // a library document's classification and review cycle are its own: the instructions follow the document, never the other way
  // (a document moved to the library takes them from the setup when it is moved: MoveToLibraryDialog)
  const syncFromDoc = doc && ((doc.classification && doc.classification !== text('classification')) || (doc.review_cycle && doc.review_cycle !== text('review_cycle')));
  useEffect(() => {
    if (syncFromDoc && doc) change({ ...(doc.classification ? { classification: doc.classification } : {}), ...(doc.review_cycle ? { review_cycle: doc.review_cycle } : {}) }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFromDoc]);

  if (options.isLoading) return <SkeletonLines lines={3} label="Loading the choices" />;
  if (!o) return <ErrorState compact title="Couldn't load the choices" message={errorMessage(options.error)} onRetry={canRetry(options.error) ? () => { void options.refetch(); } : undefined} />;

  const regulatorList = regulatorItems({ followed: o.regulators_followed, country, detail: detail.data, legacy: o.regulators, international: o.international?.regulators });
  const lawList = lawItems({ detail: detail.data, register: o.regulations, international: o.international?.laws });
  const frameworks = frameworkItems(o.frameworks, country, detail.data);
  // each framework once, though it may be attached twice (another selection of it, or an older double click)
  const attachedIds = Array.from(new Set(session.references.filter((r) => r.kind === 'framework' && r.source_id != null).map((r) => String(r.source_id))));
  const applyFrameworks = async (next: string[]) => {
    setFwBusy(true);
    try {
      const want = new Set(next);
      for (const r of session.references) if (r.kind === 'framework' && r.source_id != null && !want.has(String(r.source_id))) await studioApi.removeReference(session.id, r.id);
      for (const id of next) if (!attachedIds.includes(id)) await studioApi.addReference(session.id, { kind: 'framework', source_id: Number(id), scope: { mode: 'all' } });
      await onReferencesChanged();
    } catch (e) { notify.error(e, { title: 'That framework could not be changed' }); }
    finally { setFwBusy(false); }
  };

  const d = o.defaults;
  const fill: Instructions = {};
  if (session.kind === 'new' && d) {
    if (!country && d.country) fill.country = d.country;
    if (!text('entity_type') && d.entity_type) fill.entity_type = d.entity_type;
    // the followed regulators are the default country's: only for a document set up for that country
    if (!list('regulators').length && d.regulators.length && (!country || country === d.country)) fill.regulators = d.regulators;
  }
  const lengthOn = session.kind === 'new' || !!draft.length;          // a length chosen earlier can still be seen and cleared
  // none chosen: a new document is written at full length (setup.length_factor), so that one shows as chosen
  const length = draft.length || (session.kind === 'new' ? 'comprehensive' : '');
  const open = (i: number) => allOpen || (firstOpen && i === 0);

  const fillButton = Object.keys(fill).length > 0 && (
    <Button fullWidth leftIcon={<Sparkles aria-hidden />} onClick={() => change(fill, true)}
      title={joined('Fill in from your organisation', fill.country as string, fill.entity_type as string, (fill.regulators as string[] | undefined)?.join(', '))}>
      Fill from organisation
    </Button>
  );
  const countryField = <One label="Country" value={country} options={countryOptions(o.country_list, o.countries)} onChange={(v) => change({ country: v }, true)} />;
  const regulatorsField = <Many label="Regulators" items={regulatorList} value={list('regulators')} onChange={(v) => change({ regulators: v }, true)} />;
  const frameworksField = o.frameworks.length ? (
    <Many label="Frameworks" create={false} disabled={fwBusy}
      items={frameworks.map((f) => ({ value: String(f.id), label: f.label, subLabel: f.note || undefined, disabled: fwBusy }))}
      value={attachedIds} onChange={(v) => void applyFrameworks(v)} />
  ) : <p className="text-xs text-[#586472]">No frameworks available</p>;
  const lengthField = lengthOn && (
    <Field label="Length">
      {/* pressing the chosen one takes the choice back on an existing document (a new one is always written at a length): buttons that are pressed, not a radio group */}
      <div className="grid grid-cols-3 gap-[2px] rounded-ds-control border border-ds-border-strong bg-ds-surface p-[2px]" role="group" aria-label="Length">
        {o.lengths.map((l) => {
          const on = length === l.value;
          return (
            <button key={l.value} type="button" aria-pressed={on} title={l.detail} onClick={() => change({ length: on && session.kind !== 'new' ? '' : l.value }, true)}
              className={`min-h-[var(--ds-control-h-sm)] min-w-0 truncate rounded-[4px] px-[6px] text-ds-label font-[600] focus-visible:outline-none focus-visible:shadow-ds-ring ${on ? 'bg-ds-primary text-ds-on-primary' : 'text-ds-fg-body hover:bg-ds-surface-hover'}`}>{l.label}</button>
          );
        })}
      </div>
    </Field>
  );

  if (compact && !more) {
    const others = joined(text('entity_type'), count(list('regulations').length, 'law'), count(list('domains').length, 'subject area'),
      count(list('departments').length, 'department'), text('audience'), text('classification'), text('review_cycle'));
    return (
      <div className="space-y-2.5">
        {fillButton}
        <div className="grid gap-2.5 sm:grid-cols-2">
          {countryField}
          {regulatorsField}
          {frameworksField}
          {lengthField && <div className="sm:col-span-2">{lengthField}</div>}
        </div>
        <button type="button" onClick={() => setMore(true)} className="flex min-h-[var(--ds-control-h-sm)] w-full items-center justify-between gap-2 rounded-ds-control px-1 text-left text-ds-label hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">
          <span className="font-[600] text-ds-primary-text">More options</span>
          <span className="min-w-0 truncate text-ds-fg-muted">{others || 'organisation, laws, subject areas, reader'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {doc && (
        <p className="rounded-ds-control bg-ds-surface-hover px-3 py-2 text-ds-label text-ds-fg-body">
          <span className="font-[600] text-ds-fg">Document </span>
          {joined(doc.classification, doc.review_cycle && `reviewed ${doc.review_cycle.toLowerCase()}`, doc.owner && `owner ${doc.owner}`, doc.department) || 'no details yet'}
          {session.document_id && <> · <Link href={`/governance/documents/${session.document_id}?details=1`} className="font-[600] text-ds-primary-text underline" title="Change them in the document’s Details" aria-label="Change in Details">Change</Link></>}
        </p>
      )}
      {fillButton}

      <Section title="Organisation" open={open(0)} summary={joined(text('entity_type'), country, count(list('other_countries').length, 'more country', 'more countries'))}>
        {/* the name is typed as the organisation writes it (a list pick would replace a shorter name with the first longer one) */}
        <Field label="Entity name" hint="Used exactly wherever the organisation is named, and checked for.">
          <TextInput value={text('entity_name')} onChange={(e) => change({ entity_name: e.target.value })} list={`entity-names-${session.id}`} aria-label="Entity name"
            placeholder="Legal name" />
          <datalist id={`entity-names-${session.id}`}>{(o.entity_names ?? []).map((n) => <option key={n} value={n} />)}</datalist>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <One label="Organisation type" value={text('entity_type')} options={plain(o.entity_types)} onChange={(v) => change({ entity_type: v }, true)} />
          {countryField}
        </div>
        <Many label="Other countries" items={o.country_list?.length ? o.country_list.filter((c) => c.name !== country).map((c) => ({ value: c.name, label: c.name, subLabel: c.region }))
          : plain(o.countries.filter((c) => c !== country && c !== SEVERAL))} value={list('other_countries')} onChange={(v) => change({ other_countries: v }, true)} />
      </Section>

      <Section title="Rules" open={open(1)} summary={joined(list('regulators').slice(0, 2).join(', ') + (list('regulators').length > 2 ? ` +${list('regulators').length - 2}` : ''),
        count(list('regulations').length, 'law'), count(attachedIds.length, 'framework'))}>
        {regulatorsField}
        <Many label="Laws and regulations" items={lawList} value={list('regulations')} onChange={(v) => change({ regulations: v }, true)} />
        {frameworksField}
        {notes ? (
          <Field label="Other requirements">
            <Textarea value={text('regulatory_notes')} onChange={(e) => change({ regulatory_notes: e.target.value })} rows={2} autoFocus={!text('regulatory_notes')}
              placeholder="Licence conditions, an inspection finding, a ruling…" aria-label="Other regulatory requirements" />
          </Field>
        ) : (
          <Button variant="link" size="sm" onClick={() => setNotes(true)} title="Add a requirement in your own words">+ Other requirement</Button>
        )}
      </Section>

      <Section title="Scope" open={open(2)} summary={joined(count(list('domains').length, 'subject area'), count(list('departments').length, 'department'),
        text('audience'), !doc && text('classification'), !doc && text('review_cycle'), lengthOn && o.lengths.find((l) => l.value === length)?.label)}>
        <Many label="Subject areas" items={plain(o.domains)} value={list('domains')} onChange={(v) => change({ domains: v }, true)} />
        <Many label="Departments" items={plain(o.departments)} value={list('departments')} onChange={(v) => change({ departments: v }, true)} />
        <One label="Audience" value={text('audience')} options={plain(o.audiences)} onChange={(v) => change({ audience: v }, true)} />
        {!doc && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Plain label="Classification" value={text('classification')} options={o.classifications} onChange={(v) => change({ classification: v }, true)} />
            <Plain label="Review cycle" value={text('review_cycle')} options={o.review_cycles} onChange={(v) => change({ review_cycle: v }, true)} />
          </div>
        )}
        {lengthField}
      </Section>
      {compact && <Button variant="link" size="sm" onClick={() => setMore(false)}>Fewer options</Button>}
    </div>
  );
}

/** The setup offered first in the chat of a new document, before anything is asked. */
export function SetupCard({ session, onChanged }: { session: Session; onChanged: () => void | Promise<void> }) {
  const { draft, change, saved } = useInstructionsDraft(session, () => void onChanged());
  // the same query as the fields: a server without the setup (an older one) shows no card rather than an error
  const options = useQuery({ queryKey: ['studio', 'setup', session.id], queryFn: () => studioApi.setupOptions(session.id), staleTime: 60_000, retry: false });
  const label = ['policy', 'standard', 'procedure', 'guideline', 'charter'].includes(session.doc_type) ? session.doc_type : 'document';
  if (options.isError) return null;
  return (
    <section className="rounded-ds-card border border-ds-border bg-ds-surface p-3 text-left" aria-label={`Set up this ${label}`}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-ds-body font-[600] text-ds-fg">
          Set up this {label}
          <InfoTip label="About the setup" text="Pick what you know, then tell Comply Agent below what to write. It asks about the rest." />
        </p>
        <SavedState saved={saved} />
      </div>
      <SetupFields session={session} draft={draft} change={change} onReferencesChanged={onChanged} compact firstOpen={false} />
    </section>
  );
}
