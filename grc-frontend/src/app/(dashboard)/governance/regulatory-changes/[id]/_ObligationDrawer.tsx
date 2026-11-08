'use client';

// One obligation, in a drawer over the list: what the circular requires and in its own words (a quote it does not contain word for word is flagged), whether we comply (one click), who owns it,
// how we comply, the tasks raised for it and the controls that meet it. Previous / Next walk the list as filtered. Each change saves by itself and says so only when it fails (the value on screen
// is the saved one); the owners are saved a moment after the last tick, the notes and the department when they are left.
import { useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, FormField, IconButton, PersonStack, SegmentedControl, Select, SidePanel, StatusPill, Textarea, TextInput } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { priority, statusPill } from '@/lib/status';
import { compliance, obligationType, optionsOf, taskStatus } from '@/lib/statuses/regulatory';
import { ownersOf, PRIORITIES } from '../_lib/regulatoryModel';
import { usePeople } from '../_lib/data';
import type { Obligation, RegLink, Task } from '../_lib/types';
import { PeopleMulti } from '../_parts/shared';
import ObligationControls from './_ObligationControls';

const COMPLIANCE_OPTIONS = optionsOf(compliance);
const PRIORITY_OPTIONS = PRIORITIES.map((p) => ({ value: p, label: priority.label(p) }));

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-[20px] border-t border-ds-border pt-[16px]">
      <div className="flex items-center justify-between gap-[8px]">
        <h3 className="!text-ds-body !font-[600] !text-ds-fg">{title}</h3>
        {action}
      </div>
      <div className="mt-[8px]">{children}</div>
    </section>
  );
}

export interface ObligationDrawerProps {
  o: Obligation | null;
  number: number;
  total: number;
  links: RegLink[];
  tasks: Task[];
  onOpenTask: (t: Task) => void;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onSave: (data: Record<string, unknown>, words?: string) => void;
  onLinksChanged: () => void;
  onRemove: () => void;
  onTask: () => void;
}

export function ObligationDrawer({ o, number, total, links, tasks, onOpenTask, onPrev, onNext, onClose, onSave, onLinksChanged, onRemove, onTask }: ObligationDrawerProps) {
  const people = usePeople();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ summary: '', ref: '', obligation_type: 'requirement', priority: 'medium', deadline: '' });
  const startEdit = () => {
    if (!o) return;
    setDraft({ summary: o.summary, ref: o.ref || '', obligation_type: o.obligation_type, priority: o.priority, deadline: (o.deadline || '').slice(0, 10) });
    setEditing(true);
  };
  const valid = draft.summary.trim().length >= 3;

  // The first owner's department fills an empty Department.
  const pickOwners = (ids: number[]) => {
    const first = people.users.find((u) => u.id === ids[0]);
    onSave({ owner_ids: ids, ...(o && !o.department && first?.department ? { department: first.department } : {}) });
  };

  return (
    <SidePanel
      open={!!o}
      onClose={() => { setEditing(false); onClose(); }}
      title={o ? `Obligation ${number} of ${total}` : ''}
      subtitle={o ? [o.ref && `Clause ${o.ref}`, obligationType.label(o.obligation_type)].filter(Boolean).join(' · ') : undefined}
      dockFrom={Infinity}
      width="lg"
      dirty={editing}
      actions={o && (
        <>
          <IconButton label="Previous obligation" aria-disabled={!onPrev || undefined} onClick={() => onPrev?.()}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next obligation" aria-disabled={!onNext || undefined} onClick={() => onNext?.()}><ChevronDown aria-hidden /></IconButton>
        </>
      )}
      footer={o && (
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button variant="primary" leftIcon={<ClipboardList aria-hidden />} onClick={onTask}>Create task</Button>
          <Button variant="ghost" leftIcon={<Trash2 aria-hidden />} onClick={onRemove}>Remove</Button>
        </div>
      )}
    >
      {o && (
        <div key={o.id}>
          {editing ? (
            <form
              className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]"
              onSubmit={(e) => {
                e.preventDefault();
                if (!valid) return;
                onSave({ summary: draft.summary.trim(), ref: draft.ref.trim() || null, obligation_type: draft.obligation_type, priority: draft.priority, deadline: draft.deadline || null }, 'Obligation saved');
                setEditing(false);
              }}
            >
              <FormField label="What the circular requires" required error={!valid ? 'Say what it requires, in a few words.' : undefined}>
                <Textarea rows={3} value={draft.summary} maxLength={4000} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
              </FormField>
              <div className="grid gap-[12px] sm:grid-cols-3">
                <FormField label="Clause" optional><TextInput value={draft.ref} maxLength={120} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} /></FormField>
                <FormField label="Type">
                  <Select value={draft.obligation_type} onChange={(e) => setDraft({ ...draft, obligation_type: e.target.value })}>
                    {optionsOf(obligationType).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                </FormField>
                <FormField label="Deadline" optional><TextInput type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} /></FormField>
              </div>
              <FormField label="Priority"><SegmentedControl label="Priority" name="obligation-priority" options={PRIORITY_OPTIONS} value={draft.priority} onChange={(v) => setDraft({ ...draft, priority: v })} /></FormField>
              <div className="flex justify-end gap-[8px]">
                <Button onClick={() => setEditing(false)}>Cancel</Button>
                <Button variant="primary" disabled={!valid} onClick={() => { if (valid) { onSave({ summary: draft.summary.trim(), ref: draft.ref.trim() || null, obligation_type: draft.obligation_type, priority: draft.priority, deadline: draft.deadline || null }, 'Obligation saved'); setEditing(false); } }}>Save</Button>
              </div>
            </form>
          ) : (
            <div>
              <div className="flex items-start gap-[8px]">
                <p className="m-0 min-w-0 flex-1 text-[15px] font-[600] leading-snug text-ds-fg [overflow-wrap:anywhere]">{o.summary}</p>
                <IconButton label="Edit the obligation" onClick={startEdit}><Pencil aria-hidden /></IconButton>
              </div>
              <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
                <StatusPill size="sm" {...statusPill(priority, o.priority)} />
                {(o.deadline || o.deadline_text) && <span className="text-ds-label font-[600] text-ds-danger">{`Due ${o.deadline ? formatDate(o.deadline, { calendar: true }) : o.deadline_text}`}</span>}
                {o.applies_to.map((a) => <span key={a} className="rounded-full bg-ds-surface-hover px-[8px] text-ds-label text-ds-fg-body">{a}</span>)}
                {o.source === 'manual' && <span className="rounded-full bg-ds-surface-hover px-[8px] text-ds-label text-ds-fg-body">Added by hand</span>}
              </div>
            </div>
          )}

          {o.quote && (
            <figure className="m-0 mt-[16px] rounded-ds-control border-l-4 border-ds-border-strong bg-ds-surface-subtle px-[12px] py-[8px]">
              <blockquote className="m-0 whitespace-pre-line text-ds-body text-ds-fg-body">{o.quote}</blockquote>
              <figcaption className={`mt-[6px] flex items-center gap-[4px] text-ds-label ${o.verified ? 'text-ds-success' : 'text-ds-warning'}`}>
                {o.verified ? <><CheckCircle2 aria-hidden className="h-[14px] w-[14px]" /> The circular says this word for word</> : <><AlertTriangle aria-hidden className="h-[14px] w-[14px]" /> Not found word for word. Check it against the circular.</>}
              </figcaption>
            </figure>
          )}

          <Section title="Do we comply?">
            <SegmentedControl label="Compliance" name={`compliance-${o.id}`} options={COMPLIANCE_OPTIONS} value={o.compliance_status} onChange={(v) => onSave({ compliance_status: v })} />
          </Section>

          <Section title="Who carries it out">
            <div className="grid gap-[12px] sm:grid-cols-2">
              <FormField label="Owners"><PeopleMulti label="Owners of this obligation" value={ownersOf(o)} known={o.owners} onCommit={pickOwners} placeholder="No owner yet" /></FormField>
              <FormField label="Department" hint={!o.department ? 'Filled in from the first owner when you pick one.' : undefined}>
                <DepartmentField value={o.department} options={people.departments} onCommit={(v) => onSave({ department: v })} />
              </FormField>
            </div>
          </Section>

          <Section title="How we comply">
            <Textarea
              key={`${o.id}-${o.notes ?? ''}`} aria-label="How we comply" defaultValue={o.notes || ''} rows={3} maxLength={8000} placeholder="What we do today, what is outstanding, where the evidence is"
              onBlur={(e) => { if (e.target.value !== (o.notes || '')) onSave({ notes: e.target.value }, 'Notes saved'); }}
            />
          </Section>

          <Section title="Tasks for it" action={<Button variant="link" size="sm" leftIcon={<Plus aria-hidden />} onClick={onTask}>Create task</Button>}>
            {tasks.length === 0 ? (
              <p className="m-0 text-ds-body text-ds-fg-muted">None yet. A task raised here goes to its owners, and to Task Management.</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-ds-border p-0">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onOpenTask(t)} className="flex min-h-ds-control w-full flex-wrap items-center gap-x-[8px] gap-y-[2px] rounded-ds-control px-[4px] py-[4px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">
                      <span className={`min-w-0 flex-1 text-ds-body [overflow-wrap:anywhere] ${t.status === 'completed' ? 'text-ds-fg-muted line-through' : 'text-ds-fg'}`}>{t.title}</span>
                      <PersonStack people={(t.assignees || []).map((a) => a.display_name)} label="On this task" size={24} />
                      {t.due_date && <span className="text-ds-label text-ds-fg-muted">{formatDate(t.due_date, { calendar: true })}</span>}
                      <StatusPill size="sm" {...statusPill(taskStatus, t.status)} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Controls that meet it"><ObligationControls obligationId={o.id} links={links} onChanged={onLinksChanged} /></Section>
        </div>
      )}
    </SidePanel>
  );
}

/** The department: a word the person types or picks from the departments already in use; saved when the field is left. */
function DepartmentField({ value, options, onCommit }: { value: string | null; options: string[]; onCommit: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value || '');
  const id = useId();
  return (
    <>
      <TextInput value={draft} list={id} maxLength={255} placeholder="Who carries it out" onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft.trim() !== (value || '')) onCommit(draft.trim() || null); }} />
      <datalist id={id}>{options.map((d) => <option key={d} value={d} />)}</datalist>
    </>
  );
}
