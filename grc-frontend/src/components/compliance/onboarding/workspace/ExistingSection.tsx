'use client';

/**
 * "What exists": what the organisation already has for this framework, listed one item at a time (a certificate, a report, an assessment, a Statement of
 * Applicability), each with the kind that THIS framework has, optional dates, who issued it, whether it covers the scope being set up, and its documents.
 * Only the kind is needed; everything else can be skipped and added later. An item is a claim: it says how far anyone has checked it (declared, document
 * attached, reviewed, verified) and never marks anything compliant. Items save at once on their own (they are not part of the autosaved answers).
 */
import { useId, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, Disclosure, SegmentedControl, Select, StatusPill, TextInput, Textarea } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { onboardingApi, problemOf, type ExistingRecord, type ExistingView, type OnboardingView } from '@/lib/frameworkOnboarding';
import FilesInput from '../inputs/FilesInput';
import { emptyForm, formChanged, formOf, formProblem, payloadOf, recordFacts, reviewsOf, VERIFICATION_TONE, type ExistingForm } from './existingModel';

const LABEL = 'block text-ds-label text-ds-fg';
const ROW = 'rounded-ds-card border border-ds-border bg-ds-surface p-[12px]';
const REVIEW_WORD = { reviewed: 'Mark reviewed', verified: 'Mark verified' } as const;

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-[4px]">
      <label htmlFor={id} className={LABEL}>{label}</label>
      {children(id)}
    </div>
  );
}

/** The form of one item: new or being edited. */
function ItemForm({ onboardingId, existing, record, onView, onClose }: { onboardingId: number; existing: ExistingView; record: ExistingRecord | null; onView: (v: OnboardingView) => void; onClose: () => void }) {
  const start = record ? formOf(record) : emptyForm();
  const filesId = useId();
  const coverageName = useId();
  const [form, setForm] = useState<ExistingForm>(start);
  const [shown, setShown] = useState<string | null>(null);
  const set = (patch: Partial<ExistingForm>) => { setForm((f) => ({ ...f, ...patch })); setShown(null); };
  const save = useMutation({
    mutationFn: () => (record ? onboardingApi.existingUpdate(onboardingId, record.id, payloadOf(form)) : onboardingApi.existingAdd(onboardingId, payloadOf(form))),
    onSuccess: (next) => { onView(next); onClose(); },
    onError: (e) => { const p = problemOf(e); setShown([p.message, ...p.errors.map((x) => x.message)].filter((x, i, all) => all.indexOf(x) === i).join(' ')); },
  });
  const problem = formProblem(form, existing.types);
  const more = Boolean(form.version || form.from || form.to || form.coverage || form.note);

  return (
    <form
      className={`${ROW} space-y-[12px]`} aria-label={record ? 'Edit what exists' : 'Add what exists'}
      onSubmit={(e) => { e.preventDefault(); if (problem) { setShown(problem); return; } save.mutate(); }}
    >
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
        <Field label="What exists">
          {(id) => (
            <Select id={id} placeholder="Choose" value={form.type} aria-required onChange={(e) => set({ type: e.target.value })}>
              {existing.types.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Issued or done by">{(id) => <TextInput id={id} value={form.issuer} maxLength={200} autoComplete="off" onChange={(e) => set({ issuer: e.target.value })} />}</Field>
        <Field label="Assessment date">{(id) => <TextInput id={id} type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />}</Field>
        <Field label="Valid until">{(id) => <TextInput id={id} type="date" value={form.validUntil} onChange={(e) => set({ validUntil: e.target.value })} />}</Field>
      </div>
      <div className="space-y-[4px]">
        <span className={LABEL}>Documents</span>
        <FilesInput id={filesId} label="Documents" value={form.files} max={existing.limits.files} onChange={(v) => set({ files: Array.isArray(v) ? (v as ExistingForm['files']) : [] })} />
        <p className="text-ds-label text-ds-fg-muted">Optional. You can also add them later from the Evidence library.</p>
      </div>
      <Disclosure label="More details" defaultOpen={more} level={4} region={false}>
        <div className="grid grid-cols-1 gap-[12px] pt-[8px] sm:grid-cols-2">
          <Field label="Version assessed">{(id) => <TextInput id={id} value={form.version} maxLength={60} autoComplete="off" onChange={(e) => set({ version: e.target.value })} />}</Field>
          <span className="hidden sm:block" aria-hidden />
          <Field label="Period covered, from">{(id) => <TextInput id={id} type="date" value={form.from} onChange={(e) => set({ from: e.target.value })} />}</Field>
          <Field label="Period covered, to">{(id) => <TextInput id={id} type="date" value={form.to} onChange={(e) => set({ to: e.target.value })} />}</Field>
          <div className="min-w-0 space-y-[4px] sm:col-span-2">
            <span className={LABEL}>Does it cover the scope you are setting up?</span>
            <SegmentedControl
              label="Does it cover the scope you are setting up?" name={coverageName} options={existing.coverage.map((c) => ({ value: c, label: c }))} value={form.coverage}
              onChange={(v) => set({ coverage: v })}
            />
          </div>
          <div className="min-w-0 space-y-[4px] sm:col-span-2">
            <Field label="Note">{(id) => <Textarea id={id} rows={2} value={form.note} maxLength={2000} onChange={(e) => set({ note: e.target.value })} />}</Field>
          </div>
        </div>
      </Disclosure>
      {shown && <p role="alert" className="break-words text-ds-label font-normal text-ds-danger">{shown}</p>}
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!form.type || (record !== null && !formChanged(form, start))}>{record ? 'Save changes' : 'Add'}</Button>
        <Button type="button" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function Item({ onboardingId, existing, record, readOnly, onView, onEdit }: { onboardingId: number; existing: ExistingView; record: ExistingRecord; readOnly: boolean; onView: (v: OnboardingView) => void; onEdit: () => void }) {
  const [asked, setAsked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fail = (e: unknown) => setProblem(problemOf(e).message);
  const remove = useMutation({ mutationFn: () => onboardingApi.existingRemove(onboardingId, record.id), onSuccess: onView, onError: fail });
  const review = useMutation({
    mutationFn: (s: 'reviewed' | 'verified') => onboardingApi.existingVerify(onboardingId, record.id, s), onSuccess: onView,
    onError: (e) => setProblem(problemOf(e).status === 403 ? 'Only someone who may approve onboarding can review an item.' : problemOf(e).message),
  });
  const facts = recordFacts(record, (iso) => formatDate(iso, { calendar: true }));

  return (
    <div className={ROW}>
      <div className="flex flex-wrap items-start justify-between gap-x-[12px] gap-y-[6px]">
        <div className="min-w-0">
          <p className="break-words text-ds-body font-[600] text-ds-fg">{record.assessment_type}</p>
          {facts && <p className="break-words text-ds-label text-ds-fg-muted">{facts}</p>}
          {record.scope_coverage && <p className="text-ds-label text-ds-fg-muted">Same scope: {record.scope_coverage.toLowerCase()}</p>}
        </div>
        <StatusPill tone={VERIFICATION_TONE[record.verification_status]} label={existing.verification[record.verification_status] ?? record.verification_status} size="sm" />
      </div>
      {record.files.length > 0 && (
        <ul className="mt-[8px] flex flex-wrap gap-[8px]">
          {record.files.map((f) => (
            <li key={f.id}>
              <Button size="sm" leftIcon={<Download aria-hidden />} onClick={() => { setProblem(null); onboardingApi.downloadFile(f).catch(fail); }}>{f.name}</Button>
            </li>
          ))}
        </ul>
      )}
      {record.verified_by && <p className="mt-[4px] text-ds-label text-ds-fg-muted">{existing.verification[record.verification_status]} by {record.verified_by}</p>}
      {!readOnly && (
        <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
          <Button size="sm" leftIcon={<Pencil aria-hidden />} onClick={onEdit}>Edit</Button>
          {reviewsOf(record).map((s) => <Button key={s} size="sm" loading={review.isPending && review.variables === s} onClick={() => { setProblem(null); review.mutate(s); }}>{REVIEW_WORD[s]}</Button>)}
          {asked
            ? <><Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Confirm remove</Button><Button size="sm" onClick={() => setAsked(false)}>Keep</Button></>
            : <Button size="sm" variant="ghost" leftIcon={<Trash2 aria-hidden />} onClick={() => setAsked(true)}>Remove</Button>}
        </div>
      )}
      {problem && <p role="alert" className="mt-[6px] break-words text-ds-label font-normal text-ds-danger">{problem}</p>}
    </div>
  );
}

export default function ExistingSection({ onboardingId, existing, readOnly, onView }: { onboardingId: number; existing: ExistingView; readOnly: boolean; onView: (v: OnboardingView) => void }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const full = existing.records.length >= existing.limits.records;
  return (
    <div className="space-y-[8px]">
      {existing.records.length > 0 && (
        <ul aria-label="What exists" className="space-y-[8px]">
          {existing.records.map((r) => (
            <li key={r.id}>
              {editing === r.id
                ? <ItemForm onboardingId={onboardingId} existing={existing} record={r} onView={onView} onClose={() => setEditing(null)} />
                : <Item onboardingId={onboardingId} existing={existing} record={r} readOnly={readOnly} onView={onView} onEdit={() => setEditing(r.id)} />}
            </li>
          ))}
        </ul>
      )}
      {existing.records.length === 0 && readOnly && <span className="block text-ds-body text-ds-fg-muted">Nothing listed</span>}
      {editing === 'new' && <ItemForm onboardingId={onboardingId} existing={existing} record={null} onView={onView} onClose={() => setEditing(null)} />}
      {!readOnly && editing !== 'new' && !full && <Button leftIcon={<Plus aria-hidden />} onClick={() => setEditing('new')}>{existing.records.length === 0 ? 'Add what exists' : 'Add another'}</Button>}
    </div>
  );
}
