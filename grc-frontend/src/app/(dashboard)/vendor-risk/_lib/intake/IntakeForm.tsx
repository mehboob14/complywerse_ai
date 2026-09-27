'use client';

// The intake questions, answered in place and saved as you type. Shared by the
// request page and the lifecycle's intake stage. The likely tier is the server's
// answer after each save, from the same rules tiering uses.

import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, CheckCircle2, Loader2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { vendorOnboardingApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../tprmQuery';
import {
  Catalogue, FACTOR_LABELS, FactorKey, IntakePayload, IntakeVendor, Person, Preview, Question, TIER_CLS, errText,
} from './types';

const SUPPLIER = 'supplier';
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50 disabled:text-slate-500';
const LEVEL_TONE = ['bg-slate-600', 'bg-emerald-600', 'bg-amber-500', 'bg-orange-600', 'bg-red-600'];

type Patch = { answers: Record<string, unknown>; justifications: Record<string, string>; vendor: Partial<IntakeVendor> };
const empty = (): Patch => ({ answers: {}, justifications: {}, vendor: {} });
const isEmpty = (p: Patch) => !Object.keys(p.answers).length && !Object.keys(p.justifications).length && !Object.keys(p.vendor).length;

export function useIntake(vendorId: number) {
  return useQuery<IntakePayload>({
    queryKey: ['tprm-intake', vendorId],
    queryFn: async () => (await vendorOnboardingApi.intake(vendorId)).data,
    ...TPRM_QUERY_OPTS,
  });
}

export function useIntakeCatalogue() {
  return useQuery<Catalogue>({
    queryKey: ['tprm-intake-questions'],
    queryFn: async () => (await vendorOnboardingApi.questions()).data,
    staleTime: Infinity,
  });
}

export function usePeople() {
  return useQuery<Person[]>({
    queryKey: ['tprm-intake-people'],
    queryFn: async () => (await vendorOnboardingApi.people()).data,
    staleTime: 5 * 60_000,
  }).data || [];
}

export default function IntakeForm({
  vendorId, layout = 'page', flushRef, onSaved,
}: {
  vendorId: number;
  layout?: 'page' | 'panel';
  /** Lets the page save pending edits before it submits. */
  flushRef?: MutableRefObject<(() => Promise<void>) | null>;
  onSaved?: (payload: IntakePayload) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useIntake(vendorId);
  const { data: catalogue } = useIntakeCatalogue();
  const people = usePeople();

  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [vendor, setVendor] = useState<IntakeVendor | null>(null);
  const [section, setSection] = useState(SUPPLIER);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<Patch>(empty());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<number | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  // Load once per vendor: after that the person's typing is the truth, and saves
  // only bring back the server's verdict (missing answers, likely tier, status).
  useEffect(() => {
    if (!data || loadedFor.current === vendorId) return;
    loadedFor.current = vendorId;
    setAnswers(data.intake.answers || {});
    setReasons(data.intake.justifications || {});
    setVendor(data.vendor);
  }, [data, vendorId]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const body = pending.current;
    if (isEmpty(body)) return;
    pending.current = empty();
    setSaveState('saving');
    try {
      const res = await vendorOnboardingApi.saveIntake(vendorId, {
        answers: body.answers, justifications: body.justifications,
        vendor: Object.keys(body.vendor).length ? body.vendor : undefined,
      });
      qc.setQueryData(['tprm-intake', vendorId], res.data);
      setSaveState('saved');
      setSaveError(null);
      onSavedRef.current?.(res.data);
    } catch (e) {
      const code = (e as { response?: { status?: number } })?.response?.status;
      // A refused value waits for the person to fix it; a dropped connection is retried.
      if (!code || code >= 500) {
        const p = pending.current;
        pending.current = { answers: { ...body.answers, ...p.answers }, justifications: { ...body.justifications, ...p.justifications },
                            vendor: { ...body.vendor, ...p.vendor } };
      }
      setSaveState('error');
      setSaveError(errText(e, 'Could not save — check your connection'));
    }
  }, [vendorId, qc]);

  useEffect(() => { if (flushRef) flushRef.current = flush; }, [flush, flushRef]);
  useEffect(() => () => { void flush(); }, [flush]);   // leaving the page saves what is left

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 900);
  };
  const setAnswer = (key: string, value: unknown) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    pending.current.answers[key] = value;
    schedule();
  };
  const setReason = (key: string, value: string) => {
    setReasons((r) => ({ ...r, [key]: value }));
    pending.current.justifications[key] = value;
    schedule();
  };
  const setField = <K extends keyof IntakeVendor>(key: K, value: IntakeVendor[K]) => {
    setVendor((v) => (v ? { ...v, [key]: value } : v));
    (pending.current.vendor as Record<string, unknown>)[key] = value;
    schedule();
  };

  const sectionOf = useMemo(() => {
    const map: Record<string, string> = { name: SUPPLIER, owner_id: SUPPLIER };
    catalogue?.sections.forEach((s) => s.questions.forEach((q) => { map[q.key] = s.key; }));
    return map;
  }, [catalogue]);

  if (isLoading || !catalogue || !vendor) {
    return <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the request…</div>;
  }
  if (isError || !data) return <p className="text-sm text-rose-700">Could not load this request.</p>;

  const editable = data.can_edit;
  const problems = data.problems;
  const openIn = (key: string) => problems.filter((p) => sectionOf[p.key] === key).length;
  const tabs = [{ key: SUPPLIER, title: 'Supplier and people' }, ...catalogue.sections.map((s) => ({ key: s.key, title: s.title }))];
  const current = catalogue.sections.find((s) => s.key === section);
  const goTo = (key: string) => {
    setSection(sectionOf[key] || SUPPLIER);
    setTimeout(() => document.getElementById(`q-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  const nav = (
    <nav className={clsx(layout === 'page' ? 'space-y-1' : 'flex flex-wrap gap-1.5')} aria-label="Request sections">
      {tabs.map((t, i) => {
        const open = openIn(t.key);
        const active = section === t.key;
        return (
          <button key={t.key} type="button" onClick={() => setSection(t.key)} aria-current={active ? 'step' : undefined}
            className={clsx('flex items-center gap-2 rounded-lg text-left text-sm transition-colors',
              layout === 'page' ? 'w-full px-3 py-2' : 'border px-3 py-1.5',
              active ? 'bg-primary-50 font-medium text-primary-800 border-primary-200' : 'text-slate-600 hover:bg-slate-50 border-slate-200')}>
            <span className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
              open ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-700')}>
              {open ? i + 1 : <Check className="h-3 w-3" />}
            </span>
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            {open > 0 && <span className="text-[11px] text-slate-400">{open}</span>}
          </button>
        );
      })}
    </nav>
  );

  const saveBadge = (
    <p className={clsx('flex items-center gap-1.5 text-xs', saveState === 'error' ? 'text-rose-700' : 'text-slate-400')} aria-live="polite">
      {saveState === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>}
      {saveState === 'saved' && <><CheckCircle2 className="h-3 w-3 text-emerald-600" /> Saved</>}
      {saveState === 'error' && <><AlertCircle className="h-3 w-3" /> {saveError}</>}
      {saveState === 'idle' && editable && 'Changes save as you type'}
      {!editable && 'Read only — this request is with the review team'}
    </p>
  );

  const body = (
    <div className="min-w-0 space-y-5">
      {section === SUPPLIER ? (
        <SupplierSection vendor={vendor} people={people} editable={editable} setField={setField} problems={problems} />
      ) : current ? (
        <div className="space-y-4">
          {current.questions.filter((q) => !q.show_if || answers[q.show_if] === 'yes').map((q) => (
            <QuestionRow key={q.key} q={q} value={answers[q.key]} reason={reasons[q.key] || ''} editable={editable}
              minReason={catalogue.min_reason} problem={problems.find((p) => p.key === q.key)?.message}
              onAnswer={(v) => setAnswer(q.key, v)} onReason={(v) => setReason(q.key, v)} />
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
        {saveBadge}
        {(() => {
          const at = tabs.findIndex((t) => t.key === section);
          return at < tabs.length - 1 ? (
            <button type="button" onClick={() => setSection(tabs[at + 1].key)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Next: {tabs[at + 1].title}
            </button>
          ) : null;
        })()}
      </div>
    </div>
  );

  const side = (
    <div className="space-y-4">
      <TierCard preview={data.preview} />
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">{problems.length ? `Still needed (${problems.length})` : 'Ready to submit'}</h3>
        {problems.length === 0 ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Every question is answered.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {problems.slice(0, 8).map((p) => (
              <li key={p.key}>
                <button type="button" onClick={() => goTo(p.key)} className="text-left text-xs text-slate-600 hover:text-primary-700 hover:underline">
                  {p.message}
                </button>
              </li>
            ))}
            {problems.length > 8 && <li className="text-xs text-slate-400">and {problems.length - 8} more</li>}
          </ul>
        )}
      </div>
    </div>
  );

  if (layout === 'panel') {
    return <div className="space-y-4">{nav}{body}{side}</div>;
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)_300px]">
      <aside className="lg:sticky lg:top-4 lg:self-start">{nav}</aside>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-base font-semibold text-slate-900">{tabs.find((t) => t.key === section)?.title}</h2>
        {body}
      </section>
      <aside className="lg:sticky lg:top-4 lg:self-start">{side}</aside>
    </div>
  );
}

// ── one question ─────────────────────────────────────────────────────────────

function QuestionRow({ q, value, reason, editable, minReason, problem, onAnswer, onReason }: {
  q: Question; value: unknown; reason: string; editable: boolean; minReason: number; problem?: string;
  onAnswer: (v: unknown) => void; onReason: (v: string) => void;
}) {
  const text = value === null || value === undefined ? '' : String(value);
  return (
    <div id={`q-${q.key}`} className={clsx('rounded-lg border p-3', problem ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200')}>
      <p className="text-sm font-medium text-slate-800">
        {q.label}{q.required && <span className="text-rose-600"> *</span>}
      </p>
      <div className="mt-2">
        {q.type === 'yes_no' && (
          <Segmented value={text} disabled={!editable} onChange={onAnswer}
            options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
        )}
        {q.type === 'level' && (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={q.label}>
            {['none', 'low', 'moderate', 'high', 'severe'].map((lvl, i) => (
              <button key={lvl} type="button" role="radio" aria-checked={text === lvl} disabled={!editable}
                onClick={() => onAnswer(lvl)}
                className={clsx('rounded-md border px-3 py-1 text-xs font-medium capitalize transition-colors',
                  text === lvl ? `${LEVEL_TONE[i]} border-transparent text-white` : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                {lvl}
              </button>
            ))}
          </div>
        )}
        {q.type === 'choice' && (
          <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label={q.label}>
            {(q.options || []).map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={text === o.value} disabled={!editable}
                onClick={() => onAnswer(o.value)}
                className={clsx('rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  text === o.value ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        {q.type === 'number' && (
          <input type="number" min={0} className={clsx(input, 'max-w-[220px]')} value={text} disabled={!editable}
            onChange={(e) => onAnswer(e.target.value === '' ? null : Number(e.target.value))} />
        )}
        {q.type === 'date' && (
          <input type="date" className={clsx(input, 'max-w-[220px]')} value={text} disabled={!editable}
            onChange={(e) => onAnswer(e.target.value || null)} />
        )}
        {q.type === 'text' && (
          <textarea rows={2} className={input} value={text} disabled={!editable} onChange={(e) => onAnswer(e.target.value)} />
        )}
      </div>
      {q.justify && text === 'yes' && (
        <div className="mt-2">
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`why-${q.key}`}>Why is this needed?</label>
          <textarea id={`why-${q.key}`} rows={2} className={input} value={reason} disabled={!editable}
            placeholder="One or two sentences for the reviewers" onChange={(e) => onReason(e.target.value)} />
          {reason.trim().length < minReason && <p className="mt-0.5 text-[11px] text-slate-400">At least {minReason} characters.</p>}
        </div>
      )}
      {problem && <p className="mt-1.5 text-[11px] text-amber-800">{problem}</p>}
    </div>
  );
}

function Segmented({ value, options, disabled, onChange }: {
  value: string; options: Array<{ value: string; label: string }>; disabled?: boolean; onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={disabled}
          onClick={() => onChange(o.value)}
          className={clsx('rounded-md px-4 py-1 text-sm font-medium transition-colors',
            value === o.value ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── the supplier and the people around it ────────────────────────────────────

function SupplierSection({ vendor, people, editable, setField, problems }: {
  vendor: IntakeVendor; people: Person[]; editable: boolean; problems: Array<{ key: string; message: string }>;
  setField: <K extends keyof IntakeVendor>(key: K, value: IntakeVendor[K]) => void;
}) {
  const nameOf = (id: number) => people.find((p) => p.id === id)?.name || `User ${id}`;
  const flag = (key: string) => problems.some((p) => p.key === key);
  const field = (label: string, node: React.ReactNode, key?: string, required = false) => (
    <label className="block" id={key ? `q-${key}` : undefined}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}{required && <span className="text-rose-600"> *</span>}</span>
      {node}
      {key && flag(key) && <span className="mt-0.5 block text-[11px] text-amber-800">{problems.find((p) => p.key === key)?.message}</span>}
    </label>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {field('Supplier name', <input className={input} value={vendor.name || ''} disabled={!editable}
          onChange={(e) => setField('name', e.target.value)} />, 'name', true)}
        {field('Website', <input className={input} value={vendor.website || ''} disabled={!editable} placeholder="supplier.com"
          onChange={(e) => setField('website', e.target.value || null)} />)}
        {field('Business owner', (
          <select className={input} value={vendor.owner_id ?? ''} disabled={!editable}
            onChange={(e) => setField('owner_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Choose a person</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ), 'owner_id', true)}
        {field('Industry', <input className={input} value={vendor.industry || ''} disabled={!editable}
          onChange={(e) => setField('industry', e.target.value || null)} />)}
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-slate-600">Also looking after it</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {vendor.stakeholder_ids.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2.5 pr-1 text-xs text-slate-700">
              {nameOf(id)}
              {editable && (
                <button type="button" aria-label={`Remove ${nameOf(id)}`} className="rounded-full p-0.5 hover:bg-slate-200"
                  onClick={() => setField('stakeholder_ids', vendor.stakeholder_ids.filter((x) => x !== id))}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          {editable && (
            <select className="rounded-lg border border-dashed border-slate-300 bg-white px-2 py-1 text-xs text-slate-600" value=""
              onChange={(e) => e.target.value && setField('stakeholder_ids', [...vendor.stakeholder_ids, Number(e.target.value)])}>
              <option value="">+ Add a person</option>
              {people.filter((p) => p.id !== vendor.owner_id && !vendor.stakeholder_ids.includes(p.id))
                .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
      </div>
      {field('Also tell (email addresses)', <input className={input} value={vendor.notify_emails || ''} disabled={!editable}
        placeholder="procurement@company.com, legal@company.com" onChange={(e) => setField('notify_emails', e.target.value)} />)}
      <div className="grid gap-3 sm:grid-cols-3">
        {field('Their contact', <input className={input} value={vendor.primary_contact_name || ''} disabled={!editable}
          onChange={(e) => setField('primary_contact_name', e.target.value || null)} />)}
        {field('Contact email', <input type="email" className={input} value={vendor.primary_contact_email || ''} disabled={!editable}
          onChange={(e) => setField('primary_contact_email', e.target.value || null)} />)}
        {field('Contact phone', <input className={input} value={vendor.primary_contact_phone || ''} disabled={!editable}
          onChange={(e) => setField('primary_contact_phone', e.target.value || null)} />)}
      </div>
      {field('Expected annual cost', <input type="number" min={0} className={clsx(input, 'max-w-[220px]')}
        value={vendor.contract_value ?? ''} disabled={!editable}
        onChange={(e) => setField('contract_value', e.target.value === '' ? null : Number(e.target.value))} />)}
    </div>
  );
}

// ── the likely tier ──────────────────────────────────────────────────────────

export function TierCard({ preview, title = 'Likely tier' }: { preview: Preview; title?: string }) {
  const keys = Object.keys(FACTOR_LABELS) as FactorKey[];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className={clsx('rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize', TIER_CLS[preview.tier] || TIER_CLS.low)}>
          {preview.tier}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">Inherent risk {Math.round(preview.score)} / 100, from the answers so far.</p>
      <ul className="mt-3 space-y-2.5">
        {keys.map((k) => {
          const value = preview.factors?.[k] ?? 0;
          const why = preview.reasons?.[k] || [];
          return (
            <li key={k}>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-700">{FACTOR_LABELS[k]}</span>
                <span className="tabular-nums text-slate-500">{value} / 4</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className={clsx('h-full rounded-full', value >= 4 ? 'bg-red-500' : value >= 3 ? 'bg-orange-500' : value >= 2 ? 'bg-amber-400' : 'bg-emerald-500')}
                  style={{ width: `${(value / 4) * 100}%` }} />
              </div>
              {why.length > 0 && <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{why.join('; ')}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
