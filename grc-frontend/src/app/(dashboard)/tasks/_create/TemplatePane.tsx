'use client';

// New task > From a template. The templates the server offers (the four it ships and the organization's own) as a list to choose from, each saying what it gives: its category, priority,
// deadline and the checklist the task starts with. Choosing one asks only for what the template cannot know: the title (the template's name to start with), one owner, a reviewer and whether
// the task needs approval. The drawer holds the state and makes the task; this draws the list and the fields. The list is read when this part is opened, and a list that cannot be read says so
// with a Retry instead of being empty.
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Checkbox, Combobox, EmptyState, ErrorState, FormField, SkeletonRows, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { criticalTasksApi } from '@/lib/api';
import { retryRead, useTenantUsers } from '../_queries';
import { TITLE_MAX, userOptions } from '../tasksModel';
import { checklistOf, templateFacts, templateKey, templateProblem, type TemplateForm, type TemplateRow } from './templateModel';

/** GET critical-tasks/templates/list, read while the template part is open. */
export function useTemplates(enabled: boolean) {
  return useQuery<TemplateRow[]>({
    queryKey: ['task-templates'],
    queryFn: async () => ((await criticalTasksApi.listTemplates()).data as TemplateRow[]) ?? [],
    enabled,
    staleTime: 5 * 60_000,
    retry: retryRead,
  });
}

export interface TemplatePaneProps {
  templates: ReturnType<typeof useTemplates>;
  picked: string | null;
  onPick: (template: TemplateRow) => void;
  form: TemplateForm;
  onForm: (next: TemplateForm) => void;
  /** a create was tried: the title is checked now */
  tried: boolean;
}

export function TemplatePane({ templates, picked, onPick, form, onForm, tried }: TemplatePaneProps) {
  const users = useTenantUsers();
  const people = userOptions(users.data);
  if (templates.isPending) return <SkeletonRows rows={4} columns={1} label="Loading the templates" />;
  if (templates.isError && !templates.data) {
    return <ErrorState compact title="Couldn't load the templates" message={errorMessage(templates.error)} onRetry={canRetry(templates.error) ? () => { void templates.refetch(); } : undefined} />;
  }
  const list = templates.data ?? [];
  if (list.length === 0) return <EmptyState bare kind="firstUse" title="No templates yet" info="Templates start a task with a checklist, a priority and a deadline." />;
  const chosen = list.find((t) => templateKey(t) === picked) ?? null;
  const problem = tried || form.title.length > TITLE_MAX ? templateProblem(form) : null;

  return (
    <div className="flex flex-col gap-[16px]">
      <fieldset className="m-0 flex min-w-0 flex-col gap-[8px] border-0 p-0">
        <legend className="mb-[8px] p-0 text-ds-label text-ds-fg">Choose a template</legend>
        {list.map((t) => {
          const key = templateKey(t);
          const steps = checklistOf(t);
          const on = key === picked;
          return (
            <label key={key} className="relative block cursor-pointer">
              <input type="radio" name="task-template" value={key} checked={on} onChange={() => onPick(t)} className="peer sr-only" />
              <span className={clsx('block rounded-ds-card border p-[12px] peer-focus-visible:shadow-ds-ring', on ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border bg-ds-surface hover:bg-ds-surface-hover')}>
                <span className="block text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{t.name}</span>
                <span className="mt-[2px] block text-ds-label text-ds-fg-muted">{templateFacts(t)}</span>
                {t.description && <span className="mt-[4px] block text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{t.description}</span>}
                {on && steps.length > 0 && (
                  <ol className="m-0 mt-[8px] list-decimal pl-[20px] text-ds-body text-ds-fg">
                    {steps.map((s, i) => <li key={i} className="[overflow-wrap:anywhere]">{s}</li>)}
                  </ol>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>

      {chosen && (
        <div className="flex flex-col gap-[12px]">
          <FormField label="Title" required error={problem} hint={problem ? undefined : `${form.title.length} / ${TITLE_MAX}`}>
            <TextInput value={form.title} onChange={(e) => onForm({ ...form, title: e.target.value })} />
          </FormField>
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            <FormField label="Owner">
              {users.isError && !users.data
                ? <ErrorState compact title="Couldn't load the people" message={errorMessage(users.error)} onRetry={canRetry(users.error) ? () => { void users.refetch(); } : undefined} />
                : <Combobox label="Owner" clearable searchable options={people} value={form.owner || null} onChange={(v) => onForm({ ...form, owner: v ?? '' })} placeholder={users.isPending ? 'Loading…' : 'Unassigned'} searchPlaceholder="Search people" />}
            </FormField>
            <FormField label="Reviewer">
              {users.isError && !users.data
                ? <span className="text-ds-body text-ds-fg-muted">The people could not be loaded.</span>
                : <Combobox label="Reviewer" clearable searchable options={people} value={form.reviewer || null} onChange={(v) => onForm({ ...form, reviewer: v ?? '' })} placeholder={users.isPending ? 'Loading…' : 'Not set'} searchPlaceholder="Search people" />}
            </FormField>
          </div>
          <Checkbox label="Needs approval before it is completed" checked={form.approval} onChange={(e) => onForm({ ...form, approval: e.target.checked })} />
        </div>
      )}
    </div>
  );
}
