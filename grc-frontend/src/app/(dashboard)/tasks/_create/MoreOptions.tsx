'use client';

// New task > More options: what a task does not need to be made but often has (a description, a reviewer, category, source, severity, an SLA level, a repeat, approval, notes). The same
// fields as the old form, in the organization's own labels and lists (Settings) with a field it removed from its forms left out, and with the same values sent (createPayload). The SLA level
// fills the deadline days from the organization's own numbers (slaModel.ts), not from a store in this browser. Nothing here is needed to make a task: the drawer opens with these shut.
import { Checkbox, Combobox, ErrorState, FormField, Select, Textarea, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { builtinLabel, listOptions, showBuiltin, type ModuleSettings } from '@/components/settings/CustomFields';
import { REPEATS } from '../[id]/_workspace/taskPageModel';
import { useTenantUsers } from '../_queries';
import { TASK_SLA_LABELS, TASK_SLA_ORDER, getTaskSLAConfig, type TaskSLALevel } from '../slaConfig';
import { CATEGORIES, SEVERITIES, SOURCES, userOptions, type NewTaskForm } from '../tasksModel';
import { slaDaysFor } from './slaModel';

export function MoreOptions({ form, set, settings }: { form: NewTaskForm; set: (patch: Partial<NewTaskForm>) => void; settings: ModuleSettings | undefined }) {
  const users = useTenantUsers();
  const asOptions = (key: string, current: string, fallback: string[]) => listOptions(settings, key, current, fallback.map((v) => ({ value: v, label: v })));
  const daysFor = (level: TaskSLALevel): number => slaDaysFor(settings?.sla, level, getTaskSLAConfig());

  return (
    <div className="flex flex-col gap-[16px]">
      {showBuiltin(settings, 'description') && (
        <FormField label={builtinLabel(settings, 'description', 'Description')}>
          <Textarea rows={3} value={form.description} placeholder="Task description" onChange={(e) => set({ description: e.target.value })} />
        </FormField>
      )}
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
        {showBuiltin(settings, 'reviewer') && (
          <FormField label={builtinLabel(settings, 'reviewer', 'Reviewer')}>
            {users.isError && !users.data
              ? <ErrorState compact title="Couldn't load the people" message={errorMessage(users.error)} onRetry={canRetry(users.error) ? () => { void users.refetch(); } : undefined} />
              : <Combobox label="Reviewer" clearable searchable options={userOptions(users.data)} value={form.reviewer_id || null} placeholder={users.isPending ? 'Loading…' : 'Not set'} searchPlaceholder="Search people" onChange={(v) => set({ reviewer_id: v ?? '' })} />}
          </FormField>
        )}
        {showBuiltin(settings, 'category') && (
          <FormField label={builtinLabel(settings, 'category', 'Category')}>
            <Select value={form.category} onChange={(e) => set({ category: e.target.value })}>{asOptions('category', form.category, CATEGORIES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </FormField>
        )}
        {showBuiltin(settings, 'source') && (
          <FormField label={builtinLabel(settings, 'source', 'Source')}>
            <Select value={form.source} onChange={(e) => set({ source: e.target.value })}>{asOptions('source', form.source, SOURCES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </FormField>
        )}
        {showBuiltin(settings, 'severity') && (
          <FormField label={builtinLabel(settings, 'severity', 'Severity')}>
            <Select placeholder="Not set" value={form.severity} onChange={(e) => set({ severity: e.target.value })}>{asOptions('severity', form.severity, SEVERITIES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </FormField>
        )}
        <FormField label="SLA level" hint={form.sla_days ? `Gives it a ${form.sla_days}-day deadline window.` : undefined}>
          <Select
            placeholder="Not set"
            value={form.sla_level}
            onChange={(e) => {
              const level = e.target.value as TaskSLALevel | '';
              set(level ? { sla_level: level, sla_days: String(daysFor(level)) } : { sla_level: '', sla_days: '' });
            }}
          >
            {TASK_SLA_ORDER.map((level) => <option key={level} value={level}>{`${TASK_SLA_LABELS[level]} (${daysFor(level)} days)`}</option>)}
          </Select>
        </FormField>
      </div>
      <div className="grid grid-cols-1 items-end gap-[12px] sm:grid-cols-3">
        <FormField label="Repeats">
          <Select placeholder="Does not repeat" value={form.recurrence_pattern} onChange={(e) => set({ recurrence_pattern: e.target.value })}>
            {REPEATS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </FormField>
        {form.recurrence_pattern && (
          <FormField label="Every" hint="Number of periods">
            <TextInput type="number" min={1} value={form.recurrence_interval} onChange={(e) => set({ recurrence_interval: e.target.value })} />
          </FormField>
        )}
        <Checkbox label="Needs approval" checked={form.approval_required} onChange={(e) => set({ approval_required: e.target.checked })} />
      </div>
      {showBuiltin(settings, 'notes') && (
        <FormField label={builtinLabel(settings, 'notes', 'Notes')}>
          <Textarea rows={2} value={form.evidence_notes} placeholder="Supporting evidence or notes" onChange={(e) => set({ evidence_notes: e.target.value })} />
        </FormField>
      )}
    </div>
  );
}
