'use client';

// Add or change one record of a project, in a drawer that asks "Discard changes?" before it throws typed input away (RightSlidePanel `dirty`). The old page had one
// modal for ten kinds of record with its own hand-made overlay; this is one drawer for them, its fields described as data (FIELDS) and drawn with the kit's
// FormField, TextInput, Textarea and Select. What a form starts with, what it needs and what it sends are _model.ts's (blankForm, recordErrors, recordPayload: the
// old save buttons' payloads, pinned by _model.test.ts). Three kinds have a part of their own: a team member is picked from the tenant's users, a risk can start from
// one of the register's, and a document can carry a file. The save itself is the page's (a reported mutation), so a refusal is said in the server's words and the drawer
// stays open with everything typed.
import { useId, useState, type ReactNode } from 'react';
import { RightSlidePanel } from '@/components/ui';
import { Button, FormField, Select, Textarea, TextInput } from '@/components/ui/ds';
import { statusLabel } from '@/lib/format';
import {
  BUDGET_CATEGORIES, BUDGET_STATUSES, COVERAGE_STATUSES, DEP_STATUSES, DEP_TYPES, DEP_DIRECTIONS, HEALTH_OPTIONS, IMPACTS, LESSON_CATEGORIES, MILESTONE_STATUSES, PRIORITIES,
  RISK_TYPES, SEVERITY_LEVELS, TEAM_ROLES, blankForm, formFromItem, matchRisks, matchUsers, recordErrors, sameForm,
  type RecordForm, type RecordKind, type TenantRiskOption, type TenantUserOption,
} from '../_model';

interface Spec {
  key: string;
  label: string;
  control: 'text' | 'textarea' | 'select' | 'date' | 'number' | 'url';
  options?: ReadonlyArray<string | { value: string; label: string }>;
  required?: boolean;
  rows?: number;
  placeholder?: string;
  hint?: string;
  unit?: string;
  max?: number;
  /** takes half the width (two of them share a line from 640px) */
  half?: boolean;
}

const words = (list: readonly string[]) => list.map((v) => ({ value: v, label: statusLabel(v) }));

// The fields of each form, in the order the old modal had them. Lengths are the columns': a name is 255 characters, the server answers 500 above that.
const FIELDS: Record<RecordKind, Spec[]> = {
  milestone: [
    { key: 'name', label: 'Name', control: 'text', required: true, max: 255 },
    { key: 'description', label: 'Description', control: 'textarea' },
    { key: 'target_date', label: 'Target date', control: 'date', half: true },
    { key: 'status', label: 'Status', control: 'select', options: MILESTONE_STATUSES, half: true },
    { key: 'completion_percentage', label: 'Completion', control: 'number', unit: '%', half: true },
    { key: 'deliverables', label: 'Deliverables', control: 'textarea', placeholder: 'One deliverable per line' },
  ],
  task: [
    { key: 'title', label: 'Title', control: 'text', required: true, max: 255 },
    { key: 'description', label: 'Description', control: 'textarea' },
    { key: 'assignee_name', label: 'Assignee', control: 'text', max: 255 },
    { key: 'priority', label: 'Priority', control: 'select', options: PRIORITIES, half: true },
    { key: 'due_date', label: 'Due date', control: 'date', half: true },
    { key: 'progress', label: 'Progress', control: 'number', unit: '%', half: true },
    { key: 'dependencies', label: 'Dependencies', control: 'textarea', placeholder: 'One dependency per line (e.g., task names or IDs)' },
  ],
  team: [
    { key: 'role', label: 'Role', control: 'select', options: TEAM_ROLES },
    { key: 'responsibilities', label: 'Responsibilities', control: 'textarea' },
  ],
  risk: [
    { key: 'title', label: 'Title', control: 'text', required: true, max: 255 },
    { key: 'description', label: 'Description', control: 'textarea' },
    { key: 'type', label: 'Type', control: 'select', options: RISK_TYPES, half: true },
    { key: 'severity', label: 'Severity', control: 'select', options: SEVERITY_LEVELS, half: true },
    { key: 'mitigation', label: 'Mitigation', control: 'textarea' },
  ],
  update: [
    { key: 'health_status', label: 'Health assessment', control: 'select', options: HEALTH_OPTIONS },
    { key: 'what_was_done', label: 'What was done', control: 'textarea', rows: 3 },
    { key: 'whats_planned', label: "What's planned", control: 'textarea', rows: 3 },
    { key: 'blockers', label: 'Blockers', control: 'textarea' },
    { key: 'notes', label: 'Notes', control: 'textarea' },
  ],
  document: [
    { key: 'title', label: 'Title', control: 'text', required: true, max: 255 },
    { key: 'description', label: 'Description', control: 'textarea' },
    { key: 'document_type', label: 'Type', control: 'text', placeholder: 'e.g., Policy, Deliverable, Reference', max: 100 },
    { key: 'url', label: 'URL', control: 'url', placeholder: 'https://...', max: 1000 },
  ],
  budget: [
    { key: 'description', label: 'Description', control: 'textarea', required: true },
    { key: 'category', label: 'Category', control: 'select', options: BUDGET_CATEGORIES, half: true },
    { key: 'amount', label: 'Amount', control: 'number', half: true },
    { key: 'status', label: 'Status', control: 'select', options: BUDGET_STATUSES, half: true },
    { key: 'date', label: 'Date', control: 'date', half: true },
    { key: 'approved_by', label: 'Approved by', control: 'text', max: 255 },
    { key: 'notes', label: 'Notes', control: 'textarea' },
  ],
  compliance: [
    { key: 'framework_name', label: 'Framework', control: 'text', required: true, placeholder: 'e.g., ISO 27001, PCI DSS', max: 255 },
    { key: 'control_id', label: 'Control ID', control: 'text', hint: 'A whole number, if the control has one', half: true, max: 9 },
    { key: 'control_name', label: 'Control name', control: 'text', required: true, half: true, max: 255 },
    { key: 'requirement_description', label: 'Requirement description', control: 'textarea' },
    { key: 'deliverable', label: 'Deliverable', control: 'text' },
    { key: 'coverage_status', label: 'Coverage status', control: 'select', options: COVERAGE_STATUSES },
    { key: 'notes', label: 'Notes', control: 'textarea' },
  ],
  lesson: [
    { key: 'title', label: 'Title', control: 'text', required: true, max: 255 },
    { key: 'description', label: 'Description', control: 'textarea', rows: 3 },
    { key: 'category', label: 'Category', control: 'select', options: LESSON_CATEGORIES, half: true },
    { key: 'impact', label: 'Impact', control: 'select', options: IMPACTS, half: true },
  ],
  dependency: [
    { key: 'dependency_type', label: 'Type', control: 'select', options: words(DEP_TYPES), half: true },
    { key: 'direction', label: 'Direction', control: 'select', options: words(DEP_DIRECTIONS), half: true },
    { key: 'dependent_project_name', label: 'Dependent project name', control: 'text', placeholder: 'Name of the project this depends on', max: 255 },
    { key: 'external_dependency', label: 'External dependency', control: 'text', placeholder: 'External vendor, system, or process', max: 255 },
    { key: 'description', label: 'Description', control: 'textarea' },
    { key: 'status', label: 'Status', control: 'select', options: DEP_STATUSES, half: true },
    { key: 'expected_date', label: 'Expected date', control: 'date', half: true },
    { key: 'impact_if_delayed', label: 'Impact if delayed', control: 'select', options: IMPACTS, placeholder: 'Select…' },
  ],
};

const TITLES: Record<RecordKind, [string, string]> = {
  milestone: ['Add milestone', 'Edit milestone'], task: ['Add task', 'Edit task'], team: ['Add team member', 'Edit team member'], risk: ['Add risk or issue', 'Edit risk or issue'],
  update: ['Add status update', 'Edit status update'], document: ['Add document', 'Edit document'], budget: ['Add budget item', 'Edit budget item'],
  compliance: ['Add compliance mapping', 'Edit compliance mapping'], lesson: ['Add lesson learned', 'Edit lesson learned'], dependency: ['Add dependency', 'Edit dependency'],
};

const EDITABLE: RecordKind[] = ['budget', 'compliance', 'lesson', 'dependency'];

function Control({ spec, value, error, onChange }: { spec: Spec; value: string; error?: string; onChange: (v: string) => void }) {
  let control: ReactNode;
  if (spec.control === 'textarea') control = <Textarea rows={spec.rows ?? 2} value={value} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} />;
  else if (spec.control === 'select') {
    control = (
      <Select value={value} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)}>
        {(spec.options ?? []).map((o) => { const v = typeof o === 'string' ? o : o.value; return <option key={v} value={v}>{typeof o === 'string' ? o : o.label}</option>; })}
      </Select>
    );
  } else control = <TextInput type={spec.control} inputMode={spec.control === 'number' ? 'decimal' : undefined} min={spec.control === 'number' && spec.unit === '%' ? 0 : undefined} max={spec.control === 'number' && spec.unit === '%' ? 100 : undefined} unit={spec.unit} maxLength={spec.max} value={value} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} />;
  return (
    <FormField label={spec.label} required={spec.required} error={error} hint={spec.hint} className={spec.half ? undefined : 'sm:col-span-2'}>
      {control}
    </FormField>
  );
}

/** The picker of a team member: the tenant's users, narrowed by what is typed (name or email), chosen from a list. */
function TeamPicker({ users, form, error, set }: { users: TenantUserOption[]; form: RecordForm; error?: string; set: (p: RecordForm) => void }) {
  const [typed, setTyped] = useState('');
  const shown = matchUsers(users, typed);
  const pick = (value: string) => { const u = users.find((x) => x.id === Number(value)); set({ user_id: value, user_name: u?.displayName || '', email: u?.email || '' }); };
  return (
    <>
      <div className="flex flex-col gap-[8px] sm:col-span-2">
        <FormField label="User" required error={error} hint={shown.length === 0 ? 'No matching users found.' : undefined}>
          <Select value={form.user_id} placeholder="Select a tenant user" onChange={(e) => pick(e.target.value)}>
            {shown.map((u) => <option key={u.id} value={u.id}>{u.displayName}{u.email ? ` (${u.email})` : ''}</option>)}
          </Select>
        </FormField>
        <TextInput aria-label="Search users by name or email" inputMode="search" autoComplete="off" placeholder="Search users by name or email" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      <FormField label="Linked email" className="sm:col-span-2"><TextInput value={form.email} readOnly /></FormField>
    </>
  );
}

/** A risk may start from one of the register's: pick it and its title, description, severity, mitigation and owner fill the form (what the old modal did). */
function RiskPicker({ risks, users, selected, set }: { risks: TenantRiskOption[]; users: TenantUserOption[]; selected: string; set: (p: RecordForm) => void }) {
  const [typed, setTyped] = useState('');
  const id = useId();
  const shown = matchRisks(risks, typed);
  const choose = (r: TenantRiskOption) => {
    const ownerMatch = users.find((u) => { const owner = r.ownerName.toLowerCase(); return !!owner && (u.displayName.toLowerCase() === owner || u.email.toLowerCase() === owner); });
    set({ linked_risk_id: String(r.id), title: r.title, description: r.description || '', type: 'Risk', severity: r.severity || 'Medium', mitigation: r.mitigation || '', owner_user_id: ownerMatch ? String(ownerMatch.id) : '', owner_name: ownerMatch?.displayName || r.ownerName || '' });
  };
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-[8px] sm:col-span-2">
      <span id={id} className="text-ds-label text-ds-fg">Choose an existing risk <span className="text-ds-fg-muted">(optional)</span></span>
      <TextInput aria-label="Search existing risks" inputMode="search" autoComplete="off" placeholder="Search existing risks" value={typed} onChange={(e) => setTyped(e.target.value)} />
      <ul className="max-h-[144px] overflow-y-auto rounded-ds-card border border-ds-border">
        {shown.map((r) => (
          <li key={r.id} className="border-b border-ds-border last:border-b-0">
            <button
              type="button"
              aria-pressed={selected === String(r.id)}
              onClick={() => choose(r)}
              className={`block min-h-ds-control w-full px-[12px] py-[6px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring ${selected === String(r.id) ? 'bg-ds-primary-soft' : ''}`}
            >
              <span className="block text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{r.title}</span>
              <span className="block text-ds-label text-ds-fg-muted">{r.severity}{r.ownerName ? ` · Owner: ${r.ownerName}` : ''}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-[12px] py-[8px] text-ds-label text-ds-fg-muted">No matching risks found.</li>}
      </ul>
    </div>
  );
}

export interface RecordDrawerProps {
  kind: RecordKind;
  /** the line being changed (a budget item, mapping, lesson or dependency); null adds a new one */
  editing: Record<string, unknown> | null;
  /** the project's own health: a status update starts at it */
  health: string;
  users: TenantUserOption[];
  risks: TenantRiskOption[];
  saving: boolean;
  onSubmit: (form: RecordForm, file: File | null) => void;
  onClose: () => void;
}

export function RecordDrawer({ kind, editing, health, users, risks, saving, onSubmit, onClose }: RecordDrawerProps) {
  const isEdit = editing !== null && EDITABLE.indexOf(kind) >= 0;
  const [initial] = useState<RecordForm>(() => (isEdit ? formFromItem(kind as 'budget' | 'compliance' | 'lesson' | 'dependency', editing as Record<string, unknown>) : blankForm(kind, health)));
  const [form, setForm] = useState<RecordForm>(initial);
  const [file, setFile] = useState<File | null>(null);
  const [tried, setTried] = useState(false);                         // errors are shown once a save was tried, not while the person is still typing
  const errors = tried ? recordErrors(kind, form) : {};
  const set = (patch: RecordForm) => setForm((f) => ({ ...f, ...patch }));
  const submit = () => {
    setTried(true);
    if (Object.keys(recordErrors(kind, form)).length > 0) return;
    onSubmit(form, file);
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title={TITLES[kind][isEdit ? 1 : 0]}
      widthClassName="w-[560px] max-w-full"
      dirty={!sameForm(form, initial) || file !== null}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{isEdit ? 'Save changes' : 'Save'}</Button>
        </div>
      )}
    >
      <div className="grid grid-cols-1 gap-x-[12px] gap-y-[16px] sm:grid-cols-2">
        {kind === 'team' && <TeamPicker users={users} form={form} error={errors.user_id} set={set} />}
        {kind === 'risk' && <RiskPicker risks={risks} users={users} selected={form.linked_risk_id} set={set} />}
        {FIELDS[kind].map((spec) => <Control key={spec.key} spec={spec} value={form[spec.key] ?? ''} error={errors[spec.key]} onChange={(v) => set({ [spec.key]: v })} />)}
        {kind === 'risk' && (
          <FormField label="Owner" className="sm:col-span-2">
            <Select value={form.owner_user_id} placeholder="Select owner" onChange={(e) => set({ owner_user_id: e.target.value, owner_name: users.find((u) => u.id === Number(e.target.value))?.displayName || '' })}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}{u.email ? ` (${u.email})` : ''}</option>)}
            </Select>
          </FormField>
        )}
        {kind === 'document' && (
          <FormField label="Browse file" optional hint="If a file is selected, it will be uploaded and stored with this project document." className="sm:col-span-2">
            <TextInput type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </FormField>
        )}
      </div>
    </RightSlidePanel>
  );
}
