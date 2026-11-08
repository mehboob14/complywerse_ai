'use client';

// The organization's own fields on a task (Settings > custom fields). They were written when a task was made and shown nowhere; here they are listed in words (a person by name, yes or no, a date
// as the platform writes it) and, for the people who may edit, changed in a sheet with the shared form the New task drawer uses. Only what changed is sent (valuesToSave). The card is drawn only
// when the organization has fields, or a removed field still holds a value. The people are read only when a person field holds a value.
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button, Fact, FactList, FormError, SectionCard, Sheet } from '@/components/ui/ds';
import { CustomFieldInputs, hasCustomFields, liveFields, useModuleSettings, valuesToSave, type CustomValues } from '@/components/settings/CustomFields';
import { useTenantUsers } from '../../_queries';
import { customFacts, type TaskPageData } from './taskPageModel';
import { useUpdateTask } from './useTaskActions';

export function CustomFieldsCard({ task, canEdit }: { task: TaskPageData; canEdit: boolean }) {
  const { data: settings } = useModuleSettings('tasks');
  const values = (task.custom_values ?? {}) as CustomValues;
  const needsPeople = !!settings?.fields.some((f) => f.type === 'user' && values[f.key] != null && values[f.key] !== '');
  const users = useTenantUsers(needsPeople);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CustomValues>({});
  const [error, setError] = useState<unknown>(null);
  const close = () => { setOpen(false); setError(null); };
  const save = useUpdateTask(task.id, { inline: true, onDone: close, onFail: (e) => setError(e) });

  if (!settings || !hasCustomFields(settings, values)) return null;
  const nameOf = (id: number) => { const u = users.data?.find((x) => x.id === id); return u ? u.display_name || u.username || u.email : null; };
  const facts = customFacts(settings.fields, values, nameOf);
  const editable = liveFields(settings).length > 0;
  const submit = () => {
    const next = valuesToSave(settings, draft, values);
    if (!next) { close(); return; }
    setError(null);
    save.mutate({ patch: { custom_values: next }, said: 'Custom fields saved' });
  };

  return (
    <SectionCard
      id="task-custom"
      title="Custom fields"
      actions={canEdit && editable ? <Button size="sm" leftIcon={<Pencil aria-hidden />} onClick={() => { setDraft({ ...values }); setError(null); setOpen(true); }}>Edit</Button> : undefined}
    >
      <FactList min={200}>
        {facts.map((f) => <Fact key={f.key} label={f.removed ? `${f.label} (removed)` : f.label}>{f.text}</Fact>)}
      </FactList>
      <Sheet
        open={open}
        onClose={close}
        title="Custom fields"
        width="md"
        dirty={open && valuesToSave(settings, draft, values) !== undefined}
        footer={(
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button variant="primary" loading={save.isPending} onClick={submit}>Save</Button>
            <Button disabled={save.isPending} onClick={close}>Cancel</Button>
          </div>
        )}
      >
        <div className="flex flex-col gap-[16px]">
          <FormError title="Couldn't save the custom fields" error={error} onRetry={() => submit()} />
          <CustomFieldInputs moduleKey="tasks" fields={liveFields(settings)} values={draft} onChange={setDraft} />
        </div>
      </Sheet>
    </SectionCard>
  );
}
