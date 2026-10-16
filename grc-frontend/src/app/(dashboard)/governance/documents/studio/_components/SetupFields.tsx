'use client';

/**
 * Setting up a document before Comply Agent writes it: the organisation, where it applies and its regulators, the laws and circulars,
 * the frameworks, the subject areas, the departments, the audience, the length, the classification and the review cycle — picked from
 * lists that start with what the platform knows about the organisation. Kept as the document's instructions (saved as you choose),
 * so the web research, Comply Agent's questions and the draft follow them; it asks only about what is left open.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Loader2, Plus, Settings2 } from 'lucide-react';
import { problemOf, studioApi, type Instructions, type Session, type SetupOptions } from '@/lib/studio/api';
import { useToast } from '@/components/ui/ToastProvider';

export const setupInputClass = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:outline-none focus:ring-2 focus:ring-[#1ed4b0]';

/** The document's instructions as the person edits them: saved a moment after typing, at once after a choice. */
export function useInstructionsDraft(session: Session, onChanged: () => void) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Instructions>(session.instructions);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const dirty = useRef(false);
  // the session changed elsewhere (a reload): take it, unless the person is mid-edit
  useEffect(() => { if (!dirty.current) setDraft(session.instructions); }, [session.instructions]);
  const save = useMutation({
    mutationFn: (body: Instructions) => studioApi.patchSession(session.id, { instructions: body }),
    onMutate: () => setSaved('saving'),
    onSuccess: () => { setSaved('saved'); dirty.current = false; onChanged(); },
    onError: (e) => { setSaved('idle'); toast({ title: 'Could not save the instructions', message: problemOf(e), type: 'error' }); },
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (patch: Instructions, immediately = false) => {
    setDraft((cur) => ({ ...cur, ...patch }));
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    if (immediately) save.mutate(patch);
    else timer.current = setTimeout(() => save.mutate(patch), 800);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { draft, change, saved };
}

export function SavedState({ saved }: { saved: 'idle' | 'saving' | 'saved' }) {
  return <span className="text-[11px] text-[#586472]" role="status">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? <span className="inline-flex items-center gap-1 text-[#0a5a38]"><Check className="h-3 w-3" /> Saved</span> : ''}</span>;
}

function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-[#26323d]">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[#586472]">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** Several choices from a list, as chips, plus the person's own ("Add"). */
function Chips({ label, options, value, onChange, details, addLabel = 'Add another' }: {
  label: string; options: string[]; value: string[]; onChange: (next: string[]) => void; details?: Record<string, string>; addLabel?: string;
}) {
  const [adding, setAdding] = useState('');
  const shown = [...options, ...value.filter((v) => !options.includes(v))];
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o]);
  const add = () => { const t = adding.trim(); if (t && !value.includes(t)) onChange([...value, t]); setAdding(''); };
  return (
    <div role="group" aria-label={label}>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((o) => {
          const on = value.includes(o);
          return (
            <button key={o} type="button" aria-pressed={on} title={details?.[o] || undefined} onClick={() => toggle(o)}
              className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-left text-[11px] font-medium ${on ? 'border-[#0f766e] bg-[#e6f4f1] text-[#0b4f46]' : 'border-[#c5ccd3] bg-white text-[#3f4b58] hover:border-[#0f766e]'}`}>
              {on && <Check className="h-3 w-3 shrink-0" aria-hidden />}<span className="truncate">{o}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={`${addLabel}…`} aria-label={`${label}: ${addLabel.toLowerCase()}`} className={`${setupInputClass} py-1.5 text-xs`} />
        <button type="button" onClick={add} disabled={!adding.trim()} aria-label={`Add to ${label}`}
          className="inline-flex shrink-0 items-center rounded-lg border border-[#b8c4c8] bg-white px-2 text-[#0b6b58] hover:bg-[#f3fbf6] disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

/** One of a list, with "Other…" kept as typed. */
function Pick({ label, value, options, onPick }: { label: string; value: string; options: string[]; onPick: (v: string, now: boolean) => void }) {
  const [other, setOther] = useState(() => value !== '' && !options.includes(value));
  return (
    <label className="block">
      <span className="text-xs font-semibold text-[#26323d]">{label}</span>
      <select value={other ? '__other' : value} aria-label={label} className={`${setupInputClass} mt-1`}
        onChange={(e) => { if (e.target.value === '__other') { setOther(true); return; } setOther(false); onPick(e.target.value, true); }}>
        <option value="">Not set</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value="__other">Other…</option>
      </select>
      {other && <input value={options.includes(value) ? '' : value} onChange={(e) => onPick(e.target.value, false)} placeholder={`${label}, in your own words`} aria-label={`${label}, in your own words`} className={`${setupInputClass} mt-1.5`} />}
    </label>
  );
}

export function SetupFields({ session, draft, change, onReferencesChanged }: {
  session: Session; draft: Instructions; change: (patch: Instructions, immediately?: boolean) => void; onReferencesChanged: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const options = useQuery({ queryKey: ['studio', 'setup', session.id], queryFn: () => studioApi.setupOptions(session.id), staleTime: 60_000, retry: false });
  const o: SetupOptions | undefined = options.data;
  const list = (key: keyof Instructions) => (Array.isArray(draft[key]) ? (draft[key] as string[]) : []);
  const country = String(draft.country ?? '');
  const [busyFramework, setBusyFramework] = useState<number | null>(null);

  if (options.isLoading) return <p className="text-xs text-[#586472]"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading the choices…</p>;
  if (!o) return <p className="text-xs text-[#8a1c1c]">The choices could not be loaded. {problemOf(options.error)}</p>;

  const followed = o.regulators_followed.filter((r) => !country || !r.country || r.country === country).map((r) => r.label);
  const regulatorOptions = [...followed, ...(o.regulators[country] ?? []).filter((r) => !followed.includes(r))];
  const attached = (id: number) => session.references.some((r) => r.kind === 'framework' && r.source_id === id);
  const toggleFramework = async (id: number) => {
    setBusyFramework(id);
    try {
      const ref = session.references.find((r) => r.kind === 'framework' && r.source_id === id);
      if (ref) await studioApi.removeReference(session.id, ref.id);
      else await studioApi.addReference(session.id, { kind: 'framework', source_id: id, scope: { mode: 'all' } });
      await onReferencesChanged();
    } catch (e) { toast({ title: 'That framework could not be changed', message: problemOf(e), type: 'error' }); }
    finally { setBusyFramework(null); }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-[#26323d]">Entity name</span>
          <input value={draft.entity_name ?? ''} onChange={(e) => change({ entity_name: e.target.value })} placeholder="e.g. Capital Financial Services Bank" className={`${setupInputClass} mt-1`} />
        </label>
        <Pick label="Type of organisation" value={String(draft.entity_type ?? '')} options={o.entity_types} onPick={(v, now) => change({ entity_type: v }, now)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Pick key={country || 'none'} label="Country" value={country} options={o.countries} onPick={(v, now) => change({ country: v }, now)} />
          {!country && o.country_from_profile && (
            <button type="button" onClick={() => change({ country: o.country_from_profile }, true)} className="mt-1 text-[11px] font-semibold text-[#0b6b58] underline">
              Use {o.country_from_profile}, from your organisation’s profile
            </button>
          )}
        </div>
        <Pick label="Classification" value={String(draft.classification ?? '')} options={o.classifications} onPick={(v, now) => change({ classification: v }, now)} />
      </div>

      <Group label="Also applies in" hint="Other countries whose rules it must meet.">
        <Chips label="Also applies in" options={o.countries.filter((c) => c !== country && c !== 'Several countries')} value={list('other_countries')} onChange={(v) => change({ other_countries: v }, true)} />
      </Group>

      <Group label="Regulators it answers to" hint={followed.length ? 'The ones your organisation follows in Regulatory Feeds come first.' : country ? undefined : 'Choose a country to see its regulators, or add your own.'}>
        <Chips label="Regulators" options={regulatorOptions} value={list('regulators')} onChange={(v) => change({ regulators: v }, true)} />
      </Group>

      <Group label="Laws, regulations and circulars" hint={o.regulations.length ? 'From your register of regulatory changes, or add any other.' : 'Add the ones it must follow; Comply Agent also looks them up on the internet.'}>
        <Chips label="Laws, regulations and circulars" options={o.regulations.map((r) => r.label)} details={Object.fromEntries(o.regulations.map((r) => [r.label, r.detail]))}
          value={list('regulations')} onChange={(v) => change({ regulations: v }, true)} addLabel="Add a law, regulation or circular" />
        <textarea value={draft.regulatory_notes ?? ''} onChange={(e) => change({ regulatory_notes: e.target.value })} rows={2}
          placeholder="Other regulatory requirements: licence conditions, an inspection finding, a ruling…" aria-label="Other regulatory requirements" className={`${setupInputClass} mt-2`} />
      </Group>

      <Group label="Frameworks and standards" hint="In the platform: a framework you choose is attached as a reference.">
        {o.frameworks.length ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Frameworks">
            {o.frameworks.map((f) => {
              const on = attached(f.id);
              return (
                <button key={f.id} type="button" aria-pressed={on} disabled={busyFramework !== null} onClick={() => void toggleFramework(f.id)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60 ${on ? 'border-[#0f766e] bg-[#e6f4f1] text-[#0b4f46]' : 'border-[#c5ccd3] bg-white text-[#3f4b58] hover:border-[#0f766e]'}`}>
                  {busyFramework === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : on ? <Check className="h-3 w-3" aria-hidden /> : null}{f.label}
                </button>
              );
            })}
          </div>
        ) : <p className="text-[11px] text-[#586472]">No framework is available in the platform yet.</p>}
      </Group>

      <Group label="Subject areas it must cover">
        <Chips label="Subject areas" options={o.domains} value={list('domains')} onChange={(v) => change({ domains: v }, true)} addLabel="Add a subject area" />
      </Group>

      <Group label="Departments and units it applies to" hint={o.departments.length ? 'Your organisation’s departments and business units.' : undefined}>
        <Chips label="Departments" options={o.departments} value={list('departments')} onChange={(v) => change({ departments: v }, true)} addLabel="Add a department" />
      </Group>

      <div className="grid gap-3 sm:grid-cols-2">
        <Pick label="Audience" value={String(draft.audience ?? '')} options={o.audiences} onPick={(v, now) => change({ audience: v }, now)} />
        <Pick label="Review cycle" value={String(draft.review_cycle ?? '')} options={o.review_cycles} onPick={(v, now) => change({ review_cycle: v }, now)} />
      </div>

      <div>
        <p className="text-xs font-semibold text-[#26323d]" id={`length-${session.id}`}>Length</p>
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3" role="radiogroup" aria-labelledby={`length-${session.id}`}>
          {o.lengths.map((l) => {
            const on = draft.length === l.value;
            return (
              <button key={l.value} type="button" role="radio" aria-checked={on} onClick={() => change({ length: on ? '' : l.value }, true)}
                className={`rounded-lg border px-2.5 py-1.5 text-left ${on ? 'border-[#0f766e] bg-[#e6f4f1]' : 'border-[#c5ccd3] bg-white hover:border-[#0f766e]'}`}>
                <span className={`block text-xs font-semibold ${on ? 'text-[#0b4f46]' : 'text-[#26323d]'}`}>{l.label}</span>
                <span className="block text-[11px] text-[#586472]">{l.detail}</span>
              </button>
            );
          })}
        </div>
      </div>
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
    <section className="rounded-xl border border-[#9fd9bd] bg-white p-3 text-left" aria-label={`Set up this ${label}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#d6f3ec] text-[#0b6b58]" aria-hidden><Settings2 className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1f2933]">First, set up this {label}</p>
          <p className="mt-0.5 text-xs text-[#586472]">Choose what you already know. Comply Agent follows it, looks up on the internet what applies, and asks you only about what is left open before it writes anything.</p>
        </div>
        <SavedState saved={saved} />
      </div>
      <div className="mt-3"><SetupFields session={session} draft={draft} change={change} onReferencesChanged={onChanged} /></div>
      <p className="mt-3 text-xs text-[#586472]">When you are ready, tell Comply Agent below what to write.</p>
    </section>
  );
}
