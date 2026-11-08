'use client';

// Task Management > Settings. The organization's own settings are the shared ModuleSettingsPanel, used as it is (statuses are no longer offered here: no task page reads them; the SLA days, the
// lists, the labels and the custom fields are). Above it, what the settings can NOT change, said once: how a task's deadline is judged is fixed by the server (taskRecord.ts says the same:
// Overdue is the server's Breached). UI follows the server: saving these settings needs the right to create tasks, so a person without it reads them and the panel's fields and Save buttons
// are switched off (a disabled fieldset, nothing of the shared panel changes) with one quiet note, instead of buttons that can only be refused.
import ModuleSettingsPanel from '@/components/settings/ModuleSettingsPanel';
import { Notice, SectionCard } from '@/components/ui/ds';

/** The server's words for a task's deadline (services/task_lean.sla_word), one line each. */
export const DEADLINE_RULES: ReadonlyArray<readonly [string, string]> = [
  ['On track', 'More than three days until it is due.'],
  ['At risk', 'Three days or less until it is due.'],
  ['Breached', 'The due moment has passed and the task is not finished. A due date with no time counts from the start of that day.'],
  ['Completed', 'A finished task is never late.'],
];

export function SettingsTab({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="flex flex-col gap-[12px]">
      <SectionCard id="deadline-rules" title="How a deadline is judged" info="These rules are the same for every organization and cannot be changed. The SLA days below set the deadline window a new task starts with.">
        <dl className="m-0 grid gap-x-[16px] gap-y-[8px] sm:grid-cols-[120px_minmax(0,1fr)]">
          {DEADLINE_RULES.map(([word, rule]) => (
            <div key={word} className="contents">
              <dt className="text-ds-body font-[600] text-ds-fg">{word}</dt>
              <dd className="m-0 text-ds-body text-ds-fg-muted">{rule}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>
      {!canEdit && <Notice tone="info" title="You can read these settings">Changing them needs the right to create tasks.</Notice>}
      <fieldset disabled={!canEdit} className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">Task Management settings</legend>
        <ModuleSettingsPanel moduleKey="tasks" />
      </fieldset>
    </div>
  );
}
