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
import { Check, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { problemOf, studioApi, type Instructions, type Session, type SetupOptions } from '@/lib/studio/api';
import { useToast } from '@/components/ui/ToastProvider';
import { ComboBoxInput } from '@/components/ui/ComboBoxInput';
import { MultiSelectDropdown, type MultiSelectDropdownItem } from '@/components/ui/MultiSelectDropdown';
import { queueFor } from './setupPatch';

export const setupInputClass = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';

/** The lists as this server sends them; the newer fields are optional so an older server still works. */
type Options = SetupOptions & {
  entity_names?: string[];
  defaults?: { country: string; entity_type: string; regulators: string[] };
  document?: { classification: string; review_cycle: string; owner: string; department: string } | null;
  frameworks: { id: number; label: string; attached: boolean; of_document?: boolean }[];
};

/** The document's instructions as the person edits them: saved a moment after typing, at once after a choice, one save at a time with
 * everything not saved yet in it, and never replaced by the server's copy while something is on its way. */
export function useInstructionsDraft(session: Session, onChanged: () => void | Promise<void>) {
  const { toast } = useToast();
  const queue = useMemo(() => queueFor(session.id), [session.id]);
  const [draft, setDraft] = useState<Instructions>(() => queue.view(session.instructions));
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ onChanged, toast, id: session.id, server: session.instructions, queue });
  latest.current = { onChanged, toast, id: session.id, server: session.instructions, queue };
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
        latest.current.toast({ title: 'Could not save the instructions', message: problemOf(e), type: 'error' });
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
  return <span className="text-[11px] text-[#586472]" role="status">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? <span className="inline-flex items-center gap-1 text-[#0a5a38]"><Check className="h-3 w-3" /> Saved</span> : ''}</span>;
}

/** A section that folds away to one line of what it holds. */
export function Section({ title, summary, open, children }: { title: string; summary: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-xl border border-[#d5dbe1] bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 hover:bg-[#f3f8f7] [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#586472] transition-transform group-open:rotate-90" aria-hidden />
        <span className="text-xs font-semibold text-[#26323d]">{title}</span>
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-[#586472] group-open:hidden" title={summary}>{summary || 'Not set'}</span>
      </summary>
      <div className="space-y-3 border-t border-[#e6eaee] px-3 pb-3 pt-2.5">{children}</div>
    </details>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold text-[#26323d]" title={hint}>{label}{hint && <span className="ml-1 cursor-help font-normal text-[#7b8794]" aria-label={hint}>ⓘ</span>}</p>
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
  // the dropdown reports a choice while it renders: take it after, or React warns about updating another component
  return (
    <Field label={label}>
      <MultiSelectDropdown title={label} items={all} selectedValues={value} onApply={(v) => queueMicrotask(() => onChange(v))} triggerVariant="input" size="sm" showAvatars={false}
        forceSearch placeholder="Choose…" searchPlaceholder={create ? 'Search or type your own' : 'Search'} className="w-full" triggerClassName="w-full"
        onCreate={create ? (t) => onChange([...value, t]) : undefined} disabled={disabled} />
      {value.length > 0 && <p className="mt-1 truncate text-[11px] text-[#3f4b58]" title={all.filter((i) => value.includes(i.value)).map((i) => i.label).join('; ')}>
        {all.filter((i) => value.includes(i.value)).map((i) => i.label).join(' · ')}</p>}
    </Field>
  );
}

/** One of a list, with search; the person may type their own. */
export function One({ label, value, options, onChange, hint, custom = true }: {
  label: string; value: string; options: { value: string; label: string; hint?: string; group?: string }[]; onChange: (v: string) => void; hint?: string; custom?: boolean;
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
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={`${setupInputClass} py-1.5`}>
        <option value="">Not set</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        {value && !options.includes(value) && <option value={value}>{value}</option>}
      </select>
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
  const { toast } = useToast();
  const options = useQuery({ queryKey: ['studio', 'setup', session.id], queryFn: () => studioApi.setupOptions(session.id) as Promise<Options>, staleTime: 60_000, retry: false });
  const o = options.data;
  const list = (key: keyof Instructions) => (Array.isArray(draft[key]) ? (draft[key] as string[]) : []);
  const text = (key: keyof Instructions) => String(draft[key] ?? '');
  const country = text('country');
  const [fwBusy, setFwBusy] = useState(false);
  const [notes, setNotes] = useState(() => !!text('regulatory_notes'));
  const [more, setMore] = useState(false);
  const doc = o?.document ?? null;

  // a library document's classification and review cycle are its own: the instructions follow the document, never the other way
  // (a document moved to the library takes them from the setup when it is moved: MoveToLibraryDialog)
  const syncFromDoc = doc && ((doc.classification && doc.classification !== text('classification')) || (doc.review_cycle && doc.review_cycle !== text('review_cycle')));
  useEffect(() => {
    if (syncFromDoc && doc) change({ ...(doc.classification ? { classification: doc.classification } : {}), ...(doc.review_cycle ? { review_cycle: doc.review_cycle } : {}) }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFromDoc]);

  if (options.isLoading) return <p className="text-xs text-[#586472]"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading the choices…</p>;
  if (!o) return <p className="text-xs text-[#8a1c1c]">The choices could not be loaded. {problemOf(options.error)}</p>;

  const followed = o.regulators_followed.filter((r) => !country || !r.country || r.country === country);
  const regulatorItems: MultiSelectDropdownItem[] = [
    ...followed.map((r) => ({ value: r.label, label: r.label, subLabel: 'Followed in Regulatory Feeds' })),
    ...(country && o.regulators[country]
      ? o.regulators[country].map((r) => ({ value: r, label: r }))
      : Object.entries(o.regulators).flatMap(([c, names]) => names.map((r) => ({ value: r, label: r, subLabel: c })))),
  ].filter((item, i, all) => all.findIndex((x) => x.value === item.value) === i);
  const frameworks = [...o.frameworks].sort((a, b) => Number(!!b.of_document) - Number(!!a.of_document));
  const attachedIds = session.references.filter((r) => r.kind === 'framework' && r.source_id != null).map((r) => String(r.source_id));
  const applyFrameworks = async (next: string[]) => {
    setFwBusy(true);
    try {
      const want = new Set(next);
      for (const r of session.references) if (r.kind === 'framework' && r.source_id != null && !want.has(String(r.source_id))) await studioApi.removeReference(session.id, r.id);
      for (const id of next) if (!attachedIds.includes(id)) await studioApi.addReference(session.id, { kind: 'framework', source_id: Number(id), scope: { mode: 'all' } });
      await onReferencesChanged();
    } catch (e) { toast({ title: 'That framework could not be changed', message: problemOf(e), type: 'error' }); }
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
  const open = (i: number) => allOpen || (firstOpen && i === 0);

  const fillButton = Object.keys(fill).length > 0 && (
    <button type="button" onClick={() => change(fill, true)}
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#9fd9bd] bg-[#f3fbf6] px-3 py-1.5 text-xs font-semibold text-[#0b6b58] hover:bg-[#e6f6ee]"
      title={joined(fill.country as string, fill.entity_type as string, (fill.regulators as string[] | undefined)?.join(', '))}>
      <Sparkles className="h-3.5 w-3.5" aria-hidden /> Fill in from your organisation
    </button>
  );
  const countryField = <One label="Country" value={country} options={plain(o.countries)} onChange={(v) => change({ country: v }, true)} />;
  const regulatorsField = <Many label="Regulators it answers to" items={regulatorItems} value={list('regulators')} onChange={(v) => change({ regulators: v }, true)} />;
  const frameworksField = o.frameworks.length ? (
    <Many label="Frameworks and standards" create={false} disabled={fwBusy}
      items={frameworks.map((f) => ({ value: String(f.id), label: f.label, subLabel: f.of_document ? 'This document’s' : undefined, disabled: fwBusy }))}
      value={attachedIds} onChange={(v) => void applyFrameworks(v)} />
  ) : <p className="text-[11px] text-[#586472]">No framework is available in the platform yet.</p>;
  const lengthField = lengthOn && (
    <Field label="Length">
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-[#b8c4c8] bg-white p-0.5" role="radiogroup" aria-label="Length">
        {o.lengths.map((l) => {
          const on = draft.length === l.value;
          return (
            <button key={l.value} type="button" role="radio" aria-checked={on} title={l.detail} onClick={() => change({ length: on ? '' : l.value }, true)}
              className={`rounded-md px-2 py-1 text-xs font-semibold ${on ? 'bg-[#0f4c5c] text-white' : 'text-[#3f4b58] hover:bg-[#eef1f4]'}`}>{l.label}</button>
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
          {lengthField}
        </div>
        <button type="button" onClick={() => setMore(true)} className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-[11px] hover:bg-[#eef6f3]">
          <span className="font-semibold text-[#0b6b58]">More options</span>
          <span className="min-w-0 truncate text-[#586472]">{others || 'organisation, laws, subject areas, reader'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {doc && (
        <p className="rounded-lg bg-[#f3f6f8] px-3 py-2 text-[11px] text-[#3f4b58]">
          <span className="font-semibold text-[#26323d]">This document: </span>
          {joined(doc.classification, doc.review_cycle && `reviewed ${doc.review_cycle.toLowerCase()}`, doc.owner && `owner ${doc.owner}`, doc.department) || 'no details yet'}
          {session.document_id && <> · <Link href={`/governance/documents/${session.document_id}?details=1`} className="font-semibold text-[#0b6b58] underline">Change in Details</Link></>}
        </p>
      )}
      {fillButton}

      <Section title="Organisation" open={open(0)} summary={joined(text('entity_type'), country, count(list('other_countries').length, 'more country', 'more countries'))}>
        {/* the name is typed as the organisation writes it (a list pick would replace a shorter name with the first longer one) */}
        <Field label="Entity name" hint="Used exactly wherever the organisation is named, and checked for.">
          <input value={text('entity_name')} onChange={(e) => change({ entity_name: e.target.value })} list={`entity-names-${session.id}`} aria-label="Entity name"
            placeholder="The organisation's legal name" className={`${setupInputClass} py-1.5`} />
          <datalist id={`entity-names-${session.id}`}>{(o.entity_names ?? []).map((n) => <option key={n} value={n} />)}</datalist>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <One label="Type of organisation" value={text('entity_type')} options={plain(o.entity_types)} onChange={(v) => change({ entity_type: v }, true)} />
          {countryField}
        </div>
        <Many label="Also applies in" items={plain(o.countries.filter((c) => c !== country && c !== 'Several countries'))} value={list('other_countries')}
          onChange={(v) => change({ other_countries: v }, true)} />
      </Section>

      <Section title="Rules it follows" open={open(1)} summary={joined(list('regulators').slice(0, 2).join(', ') + (list('regulators').length > 2 ? ` +${list('regulators').length - 2}` : ''),
        count(list('regulations').length, 'law'), count(attachedIds.length, 'framework'))}>
        {regulatorsField}
        <Many label="Laws, regulations and circulars" items={o.regulations.map((r) => ({ value: r.label, label: r.label, subLabel: r.detail || undefined }))}
          value={list('regulations')} onChange={(v) => change({ regulations: v }, true)} />
        {frameworksField}
        {notes ? (
          <Field label="Other regulatory requirements">
            <textarea value={text('regulatory_notes')} onChange={(e) => change({ regulatory_notes: e.target.value })} rows={2} autoFocus={!text('regulatory_notes')}
              placeholder="Licence conditions, an inspection finding, a ruling…" aria-label="Other regulatory requirements" className={setupInputClass} />
          </Field>
        ) : (
          <button type="button" onClick={() => setNotes(true)} className="text-[11px] font-semibold text-[#0b6b58] hover:underline">+ Add a requirement in your own words</button>
        )}
      </Section>

      <Section title="Scope and reader" open={open(2)} summary={joined(count(list('domains').length, 'subject area'), count(list('departments').length, 'department'),
        text('audience'), !doc && text('classification'), !doc && text('review_cycle'), lengthOn && o.lengths.find((l) => l.value === draft.length)?.label)}>
        <Many label="Subject areas it must cover" items={plain(o.domains)} value={list('domains')} onChange={(v) => change({ domains: v }, true)} />
        <Many label="Departments and units it applies to" items={plain(o.departments)} value={list('departments')} onChange={(v) => change({ departments: v }, true)} />
        <One label="Audience" value={text('audience')} options={plain(o.audiences)} onChange={(v) => change({ audience: v }, true)} />
        {!doc && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Plain label="Classification" value={text('classification')} options={o.classifications} onChange={(v) => change({ classification: v }, true)} />
            <Plain label="Review cycle" value={text('review_cycle')} options={o.review_cycles} onChange={(v) => change({ review_cycle: v }, true)} />
          </div>
        )}
        {lengthField}
      </Section>
      {compact && <button type="button" onClick={() => setMore(false)} className="text-[11px] font-semibold text-[#0b6b58] hover:underline">Fewer options</button>}
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
    <section className="rounded-xl border border-[#d5dbe1] bg-white p-3 text-left shadow-sm" aria-label={`Set up this ${label}`}>
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#1f2933]">Set up this {label}</p>
          <p className="mt-0.5 text-[11px] text-[#586472]">Pick what you know, then tell Comply Agent below what to write. It asks about the rest.</p>
        </div>
        <SavedState saved={saved} />
      </div>
      <SetupFields session={session} draft={draft} change={change} onReferencesChanged={onChanged} compact firstOpen={false} />
    </section>
  );
}
