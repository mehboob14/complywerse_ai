'use client';

// The intake questions, answered in place and saved as you type. Shared by the request page and the lifecycle's intake stage (`layout="panel"`). The likely tier is the server's answer after
// each save, from the same rules tiering uses. Rebuilt on the kit (vendor-intake-findings, 2026-11-10) with the same exports and props: what the person types is saved after a short quiet
// (900 ms) and when they leave; a refused value waits to be fixed, a dropped connection is retried; the people to pick are the module's own list (never the administrators' list), and a
// person no longer on it reads "A former colleague", not a number.
import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, CheckCircle2, Loader2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Button, Checkbox, FormField, ProgressBar, SectionCard, SegmentedControl, Select, StatusPill, Textarea, TextInput } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { vendorTier } from '@/lib/statuses/vendor';
import { vendorOnboardingApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../tprmQuery';
import { intakeApi, type RequestFields, type Urgency } from '../intakeApi';
import { personName } from '../peopleModel';
import { Catalogue, FACTOR_LABELS, Factor, FactorKey, IntakePayload, IntakeVendor, Person, Preview, Question, errText } from './types';

const SUPPLIER = 'supplier';
const LEVELS = ['none', 'low', 'moderate', 'high', 'severe'] as const;
const LEVEL_WORD: Record<(typeof LEVELS)[number], string> = { none: 'None', low: 'Low', moderate: 'Moderate', high: 'High', severe: 'Severe' };
// the choices that read as a button group: a ring on the chosen one (the kit's brand colours), never a colour alone
const CHOICE = 'min-h-ds-control rounded-ds-control border px-[12px] py-[6px] text-left text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring disabled:cursor-default';
const CHOSEN = 'border-ds-primary bg-ds-primary-soft font-[600] text-ds-primary-text';
const UNCHOSEN = 'border-ds-border-strong bg-ds-surface text-ds-fg-body enabled:hover:bg-ds-surface-hover';

type Patch = {
  answers: Record<string, unknown>; justifications: Record<string, string>; vendor: Partial<IntakeVendor>;
  request: Partial<RequestFields>;
};
const empty = (): Patch => ({ answers: {}, justifications: {}, vendor: {}, request: {} });
const isEmpty = (p: Patch) => !Object.keys(p.answers).length && !Object.keys(p.justifications).length
  && !Object.keys(p.vendor).length && !Object.keys(p.request).length;

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
  const [request, setRequest] = useState<RequestFields | null>(null);
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
    setRequest(data.request ?? { department: null, urgency: 'normal', engagement: null });
  }, [data, vendorId]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const body = pending.current;
    if (isEmpty(body)) return;
    pending.current = empty();
    setSaveState('saving');
    try {
      const res = await intakeApi.save(vendorId, {
        answers: body.answers, justifications: body.justifications,
        vendor: Object.keys(body.vendor).length ? body.vendor : undefined,
        request: Object.keys(body.request).length ? body.request : undefined,
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
                            vendor: { ...body.vendor, ...p.vendor }, request: { ...body.request, ...p.request } };
      }
      setSaveState('error');
      setSaveError(errText(e, 'Could not save. Check your connection.'));
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
  const setAsked = <K extends keyof RequestFields>(key: K, value: RequestFields[K]) => {
    setRequest((r) => (r ? { ...r, [key]: value } : r));
    (pending.current.request as Record<string, unknown>)[key] = value;
    schedule();
  };

  const sectionOf = useMemo(() => {
    const map: Record<string, string> = { name: SUPPLIER, owner_id: SUPPLIER };
    catalogue?.sections.forEach((s) => s.questions.forEach((q) => { map[q.key] = s.key; }));
    return map;
  }, [catalogue]);

  if (isError || (!isLoading && !data)) return <p role="alert" className="text-ds-body text-ds-danger">Could not load this request.</p>;
  if (isLoading || !catalogue || !vendor || !request || !data) {
    return <div role="status" className="flex items-center gap-[8px] py-[32px] text-ds-body text-ds-fg-muted"><Loader2 aria-hidden className="h-[16px] w-[16px] animate-spin" /> Loading the request…</div>;
  }

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
    <nav className={clsx(layout === 'page' ? 'flex flex-col gap-[2px]' : 'flex flex-wrap gap-[6px]')} aria-label="Request sections">
      {tabs.map((t, i) => {
        const open = openIn(t.key);
        const active = section === t.key;
        return (
          <button
            key={t.key} type="button" onClick={() => setSection(t.key)} aria-current={active ? 'step' : undefined}
            className={clsx(
              'flex min-h-ds-control items-center gap-[8px] rounded-ds-control border px-[8px] py-[4px] text-left text-ds-body focus-visible:outline-none focus-visible:shadow-ds-ring',
              layout === 'page' ? 'w-full' : '',
              active ? 'border-ds-primary bg-ds-primary-soft font-[600] text-ds-primary-text' : 'border-transparent text-ds-fg-body hover:bg-ds-surface-hover',
            )}
          >
            <span aria-hidden className={clsx('grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full text-ds-label', open ? 'bg-ds-border text-ds-fg' : 'bg-ds-success-soft text-ds-success')}>
              {open ? i + 1 : <Check className="h-[12px] w-[12px]" />}
            </span>
            <span className="min-w-0 flex-1 break-words">{t.title}</span>
            {open > 0 && <span className="text-ds-label text-ds-fg-muted"><span className="sr-only">Still needed: </span>{open}</span>}
          </button>
        );
      })}
    </nav>
  );

  const saveBadge = (
    <p className={clsx('flex items-center gap-[6px] text-ds-label', saveState === 'error' ? 'text-ds-danger' : 'text-ds-fg-muted')} aria-live="polite">
      {saveState === 'saving' && <><Loader2 aria-hidden className="h-[12px] w-[12px] animate-spin" /> Saving…</>}
      {saveState === 'saved' && <><CheckCircle2 aria-hidden className="h-[12px] w-[12px] text-ds-success" /> Saved</>}
      {saveState === 'error' && <><AlertCircle aria-hidden className="h-[12px] w-[12px]" /> {saveError}</>}
      {saveState === 'idle' && editable && 'Changes save as you type'}
      {!editable && 'Read only: this request is with the review team'}
    </p>
  );

  const at = tabs.findIndex((t) => t.key === section);
  const body = (
    <div className="flex min-w-0 flex-col gap-[16px]">
      {section === SUPPLIER ? (
        <SupplierSection vendor={vendor} people={people} editable={editable} setField={setField} problems={problems}
          request={request} setAsked={setAsked} canReview={data.can_review} />
      ) : current ? (
        <div className="flex flex-col gap-[12px]">
          {current.can_answer === false && (
            <p className="rounded-ds-control bg-ds-surface-subtle px-[12px] py-[8px] text-ds-label text-ds-fg-muted">
              This section is answered by {current.answer?.length ? current.answer.join(' or ') : 'someone else'}; you can read it.
            </p>
          )}
          {current.questions.filter((q) => !q.show_if || answers[q.show_if] === 'yes').map((q) => (
            <QuestionRow key={q.key} q={q} value={answers[q.key]} reason={reasons[q.key] || ''}
              editable={editable && current.can_answer !== false}
              minReason={catalogue.min_reason} problem={problems.find((p) => p.key === q.key)?.message}
              onAnswer={(v) => setAnswer(q.key, v)} onReason={(v) => setReason(q.key, v)} />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-[8px] border-t border-ds-border pt-[12px]">
        {saveBadge}
        {at >= 0 && at < tabs.length - 1 && <Button onClick={() => setSection(tabs[at + 1].key)}>Next: {tabs[at + 1].title}</Button>}
      </div>
    </div>
  );

  const side = (
    <div className="flex flex-col gap-[12px]">
      <TierCard preview={data.preview} factors={catalogue.factors} />
      <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
        <h3 className="!text-ds-body !font-[600] !text-ds-fg">{problems.length ? `Still needed (${problems.length})` : 'Ready to submit'}</h3>
        {problems.length === 0 ? (
          <p className="mt-[4px] flex items-center gap-[6px] text-ds-body text-ds-success"><CheckCircle2 aria-hidden className="h-[14px] w-[14px]" /> Every question is answered.</p>
        ) : (
          <ul className="m-0 mt-[8px] flex list-none flex-col gap-[2px] p-0">
            {problems.slice(0, 8).map((p) => (
              <li key={p.key}>
                <Button variant="link" size="sm" className="!h-auto !min-h-ds-control-sm w-full !justify-start !whitespace-normal !text-left" onClick={() => goTo(p.key)}>{p.message}</Button>
              </li>
            ))}
            {problems.length > 8 && <li className="text-ds-label text-ds-fg-muted">and {problems.length - 8} more</li>}
          </ul>
        )}
      </div>
    </div>
  );

  if (layout === 'panel') {
    return <div className="flex flex-col gap-[12px]">{nav}{body}{side}</div>;
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-[16px] lg:grid-cols-[210px_minmax(0,1fr)_300px]">
      <aside className="lg:sticky lg:top-[16px] lg:self-start">{nav}</aside>
      <SectionCard id="request-questions" title={tabs[Math.max(0, at)].title}>{body}</SectionCard>
      <aside className="lg:sticky lg:top-[16px] lg:self-start">{side}</aside>
    </div>
  );
}

// ── one question ─────────────────────────────────────────────────────────────

export function QuestionRow({ q, value, reason, editable, minReason, problem, onAnswer, onReason }: {
  q: Question; value: unknown; reason: string; editable: boolean; minReason: number; problem?: string;
  onAnswer: (v: unknown) => void; onReason: (v: string) => void;
}) {
  const text = value === null || value === undefined ? '' : String(value);
  const wide = q.type === 'text' || q.type === 'choice' || q.type === 'multi_choice' || q.type === 'level';
  return (
    <div id={`q-${q.key}`} className={clsx('rounded-ds-card border p-[12px]', problem ? 'border-ds-border-strong bg-ds-warning-soft' : 'border-ds-border')}>
      {wide || q.type === 'yes_no' ? (
        <fieldset className="m-0 min-w-0 border-0 p-0" disabled={false}>
          <legend className="mb-[4px] p-0 text-ds-body font-[600] text-ds-fg">{q.label}{q.required && <span aria-hidden className="text-ds-danger"> *</span>}{q.required && <span className="sr-only"> (required)</span>}</legend>
          {q.help && <p className="mb-[8px] text-ds-label text-ds-fg-muted">{q.help}</p>}
          <Answer q={q} value={value} text={text} editable={editable} onAnswer={onAnswer} />
        </fieldset>
      ) : (
        <FormField label={q.label} required={q.required} hint={q.help}>
          <Answer q={q} value={value} text={text} editable={editable} onAnswer={onAnswer} />
        </FormField>
      )}
      {q.justify && text === 'yes' && (
        <FormField className="mt-[8px]" label="Why is this needed?" hint={reason.trim().length < minReason ? `At least ${minReason} characters.` : undefined}>
          <Textarea rows={2} value={reason} disabled={!editable} placeholder="One or two sentences for the reviewers" onChange={(e) => onReason(e.target.value)} />
        </FormField>
      )}
      {problem && <p className="mt-[8px] text-ds-label font-[500] text-ds-fg">{problem}</p>}
    </div>
  );
}

function Answer({ q, value, text, editable, onAnswer }: { q: Question; value: unknown; text: string; editable: boolean; onAnswer: (v: unknown) => void }) {
  if (q.type === 'yes_no') {
    return (
      <SegmentedControl label={q.label} name={`q-${q.key}`} value={text} disabled={!editable} onChange={onAnswer}
        options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
    );
  }
  if (q.type === 'level') {
    return (
      <div className="flex flex-wrap gap-[6px]" role="radiogroup" aria-label={q.label}>
        {LEVELS.map((lvl) => (
          <button key={lvl} type="button" role="radio" aria-checked={text === lvl} disabled={!editable} onClick={() => onAnswer(lvl)} className={clsx(CHOICE, text === lvl ? CHOSEN : UNCHOSEN)}>
            {LEVEL_WORD[lvl]}
          </button>
        ))}
      </div>
    );
  }
  if (q.type === 'choice') {
    return (
      <div className="grid gap-[6px] sm:grid-cols-2" role="radiogroup" aria-label={q.label}>
        {(q.options || []).filter((o) => !o.archived || o.value === text).map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={text === o.value} disabled={!editable} onClick={() => onAnswer(o.value)} className={clsx(CHOICE, text === o.value ? CHOSEN : UNCHOSEN)}>
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  if (q.type === 'multi_choice') {
    const picked = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="grid gap-[6px] sm:grid-cols-2" role="group" aria-label={q.label}>
        {(q.options || []).filter((o) => !o.archived || picked.includes(o.value)).map((o) => (
          <label key={o.value} className={clsx('flex min-h-ds-control cursor-pointer items-center gap-[8px] rounded-ds-control border px-[12px] py-[6px] text-ds-body', picked.includes(o.value) ? CHOSEN : UNCHOSEN, !editable && 'cursor-default')}>
            <Checkbox checked={picked.includes(o.value)} disabled={!editable}
              onChange={() => onAnswer(picked.includes(o.value) ? picked.filter((v) => v !== o.value) : [...picked, o.value])} />
            {o.label}
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'number') return <TextInput type="number" min={0} className="max-w-[220px]" value={text} disabled={!editable} onChange={(e) => onAnswer(e.target.value === '' ? null : Number(e.target.value))} />;
  if (q.type === 'date') return <TextInput type="date" className="max-w-[220px]" value={text} disabled={!editable} onChange={(e) => onAnswer(e.target.value || null)} />;
  return <Textarea rows={2} value={text} disabled={!editable} onChange={(e) => onAnswer(e.target.value)} />;
}

// ── the supplier and the people around it ────────────────────────────────────

function SupplierSection({ vendor, people, editable, setField, problems, request, setAsked, canReview }: {
  vendor: IntakeVendor; people: Person[]; editable: boolean; problems: Array<{ key: string; message: string }>;
  setField: <K extends keyof IntakeVendor>(key: K, value: IntakeVendor[K]) => void;
  request: RequestFields; setAsked: <K extends keyof RequestFields>(key: K, value: RequestFields[K]) => void;
  /** the review team may name the first engagement, which is made when the request is approved */
  canReview: boolean;
}) {
  const nameOf = (id: number) => personName(people, id);
  const msg = (key: string) => problems.find((p) => p.key === key)?.message;
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="grid gap-[12px] sm:grid-cols-2">
        <FormField id="q-name" label="Supplier name" required error={msg('name')}>
          <TextInput value={vendor.name || ''} disabled={!editable} onChange={(e) => setField('name', e.target.value)} />
        </FormField>
        <FormField label="Website">
          <TextInput value={vendor.website || ''} disabled={!editable} placeholder="supplier.com" onChange={(e) => setField('website', e.target.value || null)} />
        </FormField>
        <FormField id="q-owner_id" label="Business owner" required error={msg('owner_id')}>
          <Select value={vendor.owner_id ?? ''} disabled={!editable} placeholder="Choose a person" onChange={(e) => setField('owner_id', e.target.value ? Number(e.target.value) : null)}>
            {vendor.owner_id != null && !people.some((p) => p.id === vendor.owner_id) && <option value={vendor.owner_id}>{nameOf(vendor.owner_id)}</option>}
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Industry">
          <TextInput value={vendor.industry || ''} disabled={!editable} onChange={(e) => setField('industry', e.target.value || null)} />
        </FormField>
        <FormField label="Department">
          <TextInput maxLength={120} value={request.department || ''} disabled={!editable} placeholder="Who needs it" onChange={(e) => setAsked('department', e.target.value || null)} />
        </FormField>
        <FormField label="Urgency">
          <Select value={request.urgency} disabled={!editable} onChange={(e) => setAsked('urgency', e.target.value as Urgency)}>
            <option value="low">Low: no fixed date</option>
            <option value="normal">Normal</option>
            <option value="high">High: blocked without it</option>
          </Select>
        </FormField>
        {canReview && (
          <FormField label="First engagement" optional>
            <TextInput maxLength={255} value={request.engagement || ''} disabled={!editable} placeholder="What we use them for" onChange={(e) => setAsked('engagement', e.target.value || null)} />
          </FormField>
        )}
      </div>
      <div>
        <p className="mb-[4px] text-ds-label text-ds-fg">Also looking after it</p>
        <div className="flex flex-wrap items-center gap-[6px]">
          {vendor.stakeholder_ids.length === 0 && !editable && <span className="text-ds-body text-ds-fg-muted">Nobody else</span>}
          {vendor.stakeholder_ids.map((id) => (
            <span key={id} className="inline-flex min-h-ds-control-sm items-center gap-[4px] rounded-full border border-ds-border bg-ds-surface-subtle py-[2px] pl-[10px] pr-[4px] text-ds-label text-ds-fg-body">
              {nameOf(id)}
              {editable && (
                <button type="button" aria-label={`Remove ${nameOf(id)}`} className="grid h-[20px] w-[20px] place-items-center rounded-full hover:bg-ds-border focus-visible:outline-none focus-visible:shadow-ds-ring"
                  onClick={() => setField('stakeholder_ids', vendor.stakeholder_ids.filter((x) => x !== id))}>
                  <X aria-hidden className="h-[12px] w-[12px]" />
                </button>
              )}
            </span>
          ))}
          {editable && (
            <Select aria-label="Add a person who also looks after it" className="w-[200px]" value="" placeholder="+ Add a person"
              onChange={(e) => e.target.value && setField('stakeholder_ids', [...vendor.stakeholder_ids, Number(e.target.value)])}>
              {people.filter((p) => p.id !== vendor.owner_id && !vendor.stakeholder_ids.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </div>
      </div>
      <FormField label="Also tell (email addresses)">
        <TextInput value={vendor.notify_emails || ''} disabled={!editable} placeholder="procurement@company.com, legal@company.com" onChange={(e) => setField('notify_emails', e.target.value)} />
      </FormField>
      <div className="grid gap-[12px] sm:grid-cols-3">
        <FormField label="Their contact">
          <TextInput value={vendor.primary_contact_name || ''} disabled={!editable} onChange={(e) => setField('primary_contact_name', e.target.value || null)} />
        </FormField>
        <FormField label="Contact email">
          <TextInput type="email" value={vendor.primary_contact_email || ''} disabled={!editable} onChange={(e) => setField('primary_contact_email', e.target.value || null)} />
        </FormField>
        <FormField label="Contact phone">
          <TextInput value={vendor.primary_contact_phone || ''} disabled={!editable} onChange={(e) => setField('primary_contact_phone', e.target.value || null)} />
        </FormField>
      </div>
      <FormField label="Expected annual cost">
        <TextInput type="number" min={0} className="max-w-[220px]" value={vendor.contract_value ?? ''} disabled={!editable}
          onChange={(e) => setField('contract_value', e.target.value === '' ? null : Number(e.target.value))} />
      </FormField>
    </div>
  );
}

// ── the likely tier ──────────────────────────────────────────────────────────

export function TierCard({ preview, title = 'Likely tier', factors }: { preview: Preview; title?: string; factors?: Factor[] }) {
  const named: Record<string, string> = { ...FACTOR_LABELS, ...Object.fromEntries((factors || []).map((f) => [f.key, f.label])) };
  const keys = (factors?.length ? factors.map((f) => f.key) : Object.keys(FACTOR_LABELS))
    .filter((k) => k in (preview.factors || {}) || k in FACTOR_LABELS) as FactorKey[];
  return (
    <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
      <div className="flex items-center justify-between gap-[8px]">
        <h3 className="!text-ds-body !font-[600] !text-ds-fg">{title}</h3>
        <StatusPill {...statusPill(vendorTier, preview.tier)} />
      </div>
      <p className="mt-[2px] text-ds-label text-ds-fg-muted">Inherent risk {Math.round(preview.score)} / 100, from the answers so far.</p>
      <ul className="m-0 mt-[12px] flex list-none flex-col gap-[12px] p-0">
        {keys.map((k) => {
          const value = preview.factors?.[k] ?? 0;
          const why = preview.reasons?.[k] || [];
          return (
            <li key={k}>
              <p className="text-ds-label text-ds-fg-body">{named[k] || k}</p>
              <ProgressBar label={named[k] || k} valueText={`${value} / 4`} value={(value / 4) * 100} tone={value >= 4 ? 'danger' : value >= 3 ? 'warning' : value >= 2 ? 'primary' : 'success'} />
              {why.length > 0 && <p className="mt-[2px] text-ds-label text-ds-fg-muted">{why.join('; ')}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
