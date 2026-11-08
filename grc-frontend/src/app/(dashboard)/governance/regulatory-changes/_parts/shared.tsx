'use client';

// The small parts every Regulatory screen shares: the strip that makes Overview, Changes and Feed one place, the people pickers (they read the people list any signed-in person may read, and say when
// it could not be loaded instead of offering nobody), a date field that saves when it is left (not on every keystroke), and the cells a change is drawn with.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { Button, Combobox, MultiSelect, PersonChip, ProgressBar, StatusPill, TabPanel, Tabs, TextInput, type ListOption, type TabItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { EMPTY, formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { changeStatus } from '@/lib/statuses/regulatory';
import { usePeople, useFeedCounts } from '../_lib/data';
import { dueWords, isFinished, regulatorCode, taskShare } from '../_lib/regulatoryModel';
import type { ChangeRow } from '../_lib/types';

export const LEAF = '/governance/regulatory-changes';
export const FEED = '/governance/regulatory-feeds';

// ── the strip ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type StripTab = 'overview' | 'changes' | 'feed';
const KEYS: StripTab[] = ['overview', 'changes', 'feed'];

/** Overview . Changes . Feed. Overview and Changes are one page (`onSwitch` changes the tab in place); Feed is its own address, so the strip goes there. The badge on Feed is the number to triage. */
export function RegulatoryShell({ value, onSwitch, children }: { value: StripTab; onSwitch?: (tab: 'overview' | 'changes') => void; children: ReactNode }) {
  const router = useRouter();
  const counts = useFeedCounts();
  const tabs: TabItem[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'changes', label: 'Changes' },
    { key: 'feed', label: 'Feed', count: counts.data && counts.data.new > 0 ? counts.data.new : undefined },
  ];
  const change = (key: StripTab) => {
    if (key === 'feed') router.push(FEED);
    else if (onSwitch) onSwitch(key);
    else router.push(key === 'overview' ? LEAF : `${LEAF}?tab=changes`);
  };
  return (
    <Tabs<StripTab> tabs={tabs} value={value} onChange={change} ariaLabel="Regulatory Changes sections" countFormat="exact" className="flex flex-col gap-[12px]">
      {KEYS.map((k) => <TabPanel key={k} tabKey={k}>{k === value ? children : null}</TabPanel>)}
    </Tabs>
  );
}

// ── people ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Said where the people would be when the list could not be loaded, with the way to ask again: an empty picker would read as "nobody works here". */
export function PeopleProblem({ q }: { q: { isError: boolean; error: unknown; refetch: () => unknown } }) {
  if (!q.isError) return null;
  return (
    <p role="alert" className="m-0 flex flex-wrap items-center gap-[8px] text-ds-label text-ds-danger">
      The list of people could not be loaded. {errorMessage(q.error)}
      {canRetry(q.error) && <Button size="sm" leftIcon={<RotateCw aria-hidden />} onClick={() => { void q.refetch(); }}>Retry</Button>}
    </p>
  );
}

type Known = ReadonlyArray<{ id: number; display_name: string }>;

/** The people to offer, plus anyone already on the record who is not in the list (no longer active), by the name the record carries. */
function optionsFor(users: ReadonlyArray<{ id: number; display_name: string; department?: string | null; email?: string | null }>, known: Known = [], chosen: readonly number[] = []): ListOption[] {
  const list: ListOption[] = users.map((u) => ({ value: String(u.id), label: u.display_name, description: u.department || u.email || undefined }));
  const extra = chosen.filter((id) => !list.some((o) => o.value === String(id))).map((id) => ({ value: String(id), label: known.find((k) => k.id === id)?.display_name || 'Someone no longer here' }));
  return extra.concat(list);
}

/** One person (an owner). The name is the label; the department (else the email) is the second line. */
export function PersonPicker({ label, value, onChange, placeholder = 'Choose a person', fallbackName, id }: {
  label: string; value: number | null | undefined; onChange: (id: number | null) => void; placeholder?: string; fallbackName?: string | null; id?: string;
}) {
  const people = usePeople();
  const options: ListOption[] = useMemo(() => {
    const list = people.users.map((u) => ({ value: String(u.id), label: u.display_name, description: u.department || u.email || undefined }));
    // the person on the record who is not in the list (no longer active): still shown as chosen
    return value && !list.some((o) => o.value === String(value)) ? [{ value: String(value), label: fallbackName || 'Someone no longer here' }, ...list] : list;
  }, [people.users, value, fallbackName]);
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <Combobox id={id} label={label} options={options} value={value ? String(value) : null} clearable placeholder={people.isPending ? 'Loading people…' : placeholder}
        disabled={people.isPending || (people.isError && !value)} onChange={(v) => onChange(v ? Number(v) : null)} />
      <PeopleProblem q={people} />
    </div>
  );
}

/** Several people (the owners of an obligation, the people on a task). The choice is kept here while it is being made and saved once, a moment after the last tick, so ticking three people is one
 *  request, not three. */
export function PeopleMulti({ label, value, onCommit, placeholder = 'Choose people', id, known }: {
  label: string; value: number[]; onCommit: (ids: number[]) => void; placeholder?: string; id?: string; known?: Known;
}) {
  const people = usePeople();
  const [draft, setDraft] = useState<string[]>(() => value.map(String));
  const seen = useRef(value.join(','));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const pending = useRef<string[] | null>(null);
  // the record changed under us (saved, or edited elsewhere): follow it, unless a choice is waiting to be saved
  useEffect(() => {
    const now = value.join(',');
    if (now !== seen.current && !pending.current) setDraft(value.map(String));
    seen.current = now;
  }, [value]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) commit.current(pending.current.map(Number));
  }, []);
  const options: ListOption[] = useMemo(() => optionsFor(people.users, known, value), [people.users, known, value]);
  const change = (next: string[]) => {
    setDraft(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { const go = pending.current; pending.current = null; if (go) commit.current(go.map(Number)); }, 700);
  };
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <MultiSelect id={id} label={label} options={options} value={draft} onChange={change} display="chips" placeholder={people.isPending ? 'Loading people…' : placeholder} disabled={people.isPending && draft.length === 0} />
      <PeopleProblem q={people} />
    </div>
  );
}

/** Several people in a form: the choice is the form's, saved with it (a Save button), not on every tick. */
export function PeopleField({ label, value, onChange, placeholder = 'Choose people', id, known }: {
  label: string; value: number[]; onChange: (ids: number[]) => void; placeholder?: string; id?: string; known?: Known;
}) {
  const people = usePeople();
  const options = useMemo(() => optionsFor(people.users, known, value), [people.users, known, value]);
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <MultiSelect id={id} label={label} options={options} value={value.map(String)} onChange={(v) => onChange(v.map(Number))} display="chips" placeholder={people.isPending ? 'Loading people…' : placeholder} disabled={people.isPending && value.length === 0} />
      <PeopleProblem q={people} />
    </div>
  );
}

// ── a date that saves when it is left ────────────────────────────────────────────────────────────────────────────────────

export function DateField({ label, value, onCommit, id, disabled }: { label: string; value: string | null | undefined; onCommit: (day: string | null) => void; id?: string; disabled?: boolean }) {
  const shown = (value || '').slice(0, 10);
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);
  return (
    <TextInput
      id={id} type="date" aria-label={label} value={draft} disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== shown) onCommit(draft || null); }}
    />
  );
}

// ── the cells of a change ────────────────────────────────────────────────────────────────────────────────────────────────

export const StatusCell = ({ status }: { status: string }) => <StatusPill size="sm" {...statusPill(changeStatus, status)} />;

/** "20 Nov 2026" with how far away it is under it ("in 12 days", "In force"); nothing when there is no date. */
export function EffectiveCell({ change, today }: { change: Pick<ChangeRow, 'effective_date' | 'status'>; today: Date }) {
  if (!change.effective_date) return <span className="text-ds-body text-ds-fg-muted" title="No effective date recorded">{EMPTY}<span className="sr-only">No effective date</span></span>;
  const due = dueWords(change.effective_date, today);
  return (
    <span className="block whitespace-nowrap">
      <span className="block text-ds-body text-ds-fg">{formatDate(change.effective_date, { calendar: true })}</span>
      {due && !isFinished(change.status) && <span className={`block text-ds-label ${due.late ? 'text-ds-danger' : 'text-ds-fg-muted'}`}>{due.late ? 'In force' : due.text}</span>}
    </span>
  );
}

/** The owner: the avatar and the name, or the avatar alone (the name stays for a screen reader) where the list is tight. */
export function OwnerCell({ change, withName = true }: { change: Pick<ChangeRow, 'assignee_name'>; withName?: boolean }) {
  if (!change.assignee_name) return <span className="text-ds-body text-ds-fg-muted" title="Nobody owns this change">{EMPTY}<span className="sr-only">Unassigned</span></span>;
  return withName ? <PersonChip name={change.assignee_name} /> : (
    <span className="inline-flex" title={`Owner: ${change.assignee_name}`}><PersonChip name={change.assignee_name} className="[&>span:last-child]:sr-only" /></span>
  );
}

export function TasksCell({ change }: { change: Pick<ChangeRow, 'task_count' | 'completed_task_count' | 'late_task_count'> }) {
  const share = taskShare(change);
  if (share.total === 0) return <span className="text-ds-body text-ds-fg-muted">No tasks</span>;
  const late = change.late_task_count ?? 0;
  return (
    <span className="block min-w-[88px]">
      <ProgressBar value={share.pct} label="Tasks done" showValue={false} tone={late > 0 ? 'danger' : 'success'} />
      <span className="block text-ds-label text-ds-fg-muted">{share.done} of {share.total} done{late > 0 && <span className="font-[600] text-ds-danger">{` · ${late} late`}</span>}</span>
    </span>
  );
}

export const RegulatorCell = ({ source }: { source: string }) => <span className="text-ds-body text-ds-fg-body">{regulatorCode(source)}</span>;
