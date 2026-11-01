'use client';

// The drill drawer, in its three uses: Schedule Drill / log an invocation (the Drills page: the plan is chosen), Schedule drill (a plan's page: the plan is fixed) and Edit drill
// (a drill's page). They were three modals with a hand-made look; the create one had no `onError` at all, so a refusal showed only as a raw line and the edit one not even that.
// On the kit: RightSlidePanel with `dirty` (asks "Discard changes?" before typing is thrown away), FormField, native Select for the fixed choices, the Combobox pickers of _bcm-ui.
// Each sends exactly what its modal sent (bcmModel.drillCreatePayload / drillSchedulePayload / drillUpdatePayload), says what is missing before it sends, and shows what the
// server said when it refuses, at the top of the form, with what was typed kept. The failure is shown in the drawer, so the toast only confirms.
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bcmApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { drillType, optionsOf, sourceType } from '@/lib/statuses/bcm';
import { RightSlidePanel } from '@/components/ui';
import { Button, Combobox, FormField, Select, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { EntityCombobox, FormProblem } from '../_bcm-ui';
import {
  NAME_MAX, asPage, blankDrillForm, drillCreatePayload, drillDirty, drillErrors, drillFormFrom, drillSchedulePayload, drillUpdatePayload, retryRead,
  type Drill, type DrillForm as Form, type Plan,
} from '../bcmModel';

export type DrillFormMode =
  | { kind: 'create' }
  | { kind: 'schedule'; planId: number; planTitle: string }
  | { kind: 'edit'; drill: Drill };

const ROW2 = 'grid gap-[12px] sm:grid-cols-2';

/** The plan list of the create form: the same request and key as always (['bcm-plans-min']), up to the 200 plans the server sends. */
function usePlanOptions(enabled: boolean) {
  return useQuery({
    queryKey: ['bcm-plans-min'],
    queryFn: async () => {
      const answer = asPage<Plan>((await bcmApi.plans.list()).data);
      if (!answer) throw new Error('The server answered in a form this page cannot read.');
      return answer;
    },
    enabled,
    retry: retryRead,
  });
}

export function DrillForm({ mode, onClose }: { mode: DrillFormMode; onClose: () => void }) {
  const edit = mode.kind === 'edit' ? mode.drill : null;
  const [opened] = useState<Form>(() => (edit ? drillFormFrom(edit) : blankDrillForm()));
  const [form, setForm] = useState<Form>(opened);
  const [showErrors, setShowErrors] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const isIncident = form.source_type === 'incident_triggered';
  const errors = drillErrors(form, { needsPlan: mode.kind === 'create' });
  const dirty = drillDirty(opened, form);
  const plans = usePlanOptions(mode.kind === 'create');

  const common = { toast: 'success' as const, onSuccess: () => onClose(), onError: (error: unknown) => setProblem(errorMessage(error)) };
  const create = useReportedMutation({
    mutationFn: async (payload: ReturnType<typeof drillCreatePayload>) => (await bcmApi.drills.create(payload)).data,
    success: 'Drill created', failure: "Couldn't create the drill", retryable: false, invalidate: [['bcm-drills']], ...common,
  });
  const schedule = useReportedMutation({
    mutationFn: async (payload: ReturnType<typeof drillSchedulePayload>) => (await bcmApi.drills.create(payload)).data,
    success: 'Drill scheduled', failure: "Couldn't schedule the drill", retryable: false, invalidate: [['bcm-plan', mode.kind === 'schedule' ? mode.planId : 0]], ...common,
  });
  const update = useReportedMutation({
    mutationFn: async (payload: ReturnType<typeof drillUpdatePayload>) => (await bcmApi.drills.update(edit?.id ?? 0, payload)).data,
    success: 'Drill updated', failure: "Couldn't save the drill", invalidate: [['bcm-drill', edit?.id ?? 0]], ...common,
  });
  const saving = create.isPending || schedule.isPending || update.isPending;

  const submit = () => {
    setProblem(null);
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      if (errors.title) titleField.current?.focus();
      return;
    }
    if (mode.kind === 'create') create.mutate(drillCreatePayload(form));
    else if (mode.kind === 'schedule') schedule.mutate(drillSchedulePayload(mode.planId, form));
    else update.mutate(drillUpdatePayload(form, edit?.source_type === 'incident_triggered'));
  };

  const planChoices = (plans.data?.items ?? []).map((p) => ({ value: String(p.id), label: p.title, description: p.business_unit || undefined }));
  const planCut = plans.data && plans.data.total > plans.data.items.length;
  const title = mode.kind === 'edit' ? 'Edit drill' : mode.kind === 'schedule' ? 'Schedule drill' : 'Schedule drill / log invocation';
  const subtitle = mode.kind === 'edit' ? sourceType.label(mode.drill.source_type) : mode.kind === 'schedule' ? truncate(mode.planTitle, 80).text : undefined;
  const typeField = (
    <FormField label="Type" info="Tabletop and call tree rehearse the plan on paper or by phone; simulation and full failover run it for real.">
      <Select value={form.drill_type} onChange={(e) => set('drill_type', e.target.value)}>
        {optionsOf(drillType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </FormField>
  );

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={dirty}
      title={title}
      subtitle={subtitle}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{mode.kind === 'edit' ? 'Save changes' : mode.kind === 'schedule' ? 'Schedule' : 'Create'}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormProblem message={problem} />

        {mode.kind === 'create' && (
          <FormField label="Plan" required error={showErrors ? errors.plan_id : undefined}>
            <Combobox
              label="Plan" options={planChoices} value={form.plan_id || null} onChange={(v) => set('plan_id', v ?? '')} placeholder="Select a plan…" searchable searchPlaceholder="Search plans"
              emptyText={plans.isLoading ? 'Loading…' : 'No plans found'} invalid={showErrors && !!errors.plan_id}
            />
            {plans.isError && !plans.data && (
              <p role="alert" className="flex flex-wrap items-center gap-x-[8px] break-words text-ds-label font-normal text-ds-danger">
                <span className="min-w-0">{`Couldn't load the plans. ${errorMessage(plans.error)}`}</span>
                {canRetry(plans.error) && <Button size="sm" variant="link" onClick={() => { void plans.refetch(); }}>Retry</Button>}
              </p>
            )}
            {planCut && plans.data && <p className="break-words text-ds-label font-normal text-ds-fg-muted">{`Only the ${plans.data.items.length} most recently updated plans are listed here.`}</p>}
          </FormField>
        )}

        <FormField label="Title" required error={showErrors ? errors.title : undefined}>
          <TextInput ref={titleField} value={form.title} maxLength={NAME_MAX} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Q3 failover tabletop" />
        </FormField>

        {mode.kind === 'create' ? (
          <div className={ROW2}>
            {typeField}
            <FormField label="Source" info="A scheduled test rehearses the plan; an incident-triggered record logs a real activation of it.">
              <Select value={form.source_type} onChange={(e) => set('source_type', e.target.value)}>
                {optionsOf(sourceType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </FormField>
          </div>
        ) : typeField}

        {isIncident && (
          <FormField label="Linked incident" required hint="Links a real incident so its invocation reports alongside rehearsed drills." error={showErrors ? errors.incident_id : undefined}>
            <EntityCombobox
              kind="incidents" label="Linked incident" placeholder="Select an incident…" value={form.incident_id} onChange={(id) => set('incident_id', id)} invalid={showErrors && !!errors.incident_id}
              extra={opened.incident_id ? [{ value: opened.incident_id, label: opened.incident_title || `Incident #${opened.incident_id}` }] : undefined}
            />
          </FormField>
        )}

        <div className={ROW2}>
          <FormField label="Scheduled date" optional info="The day the drill is planned for. Once the day has begun and the drill is still scheduled, it reads Overdue.">
            <TextInput type="date" value={form.scheduled_date} onChange={(e) => set('scheduled_date', e.target.value)} />
          </FormField>
          {mode.kind === 'edit' && (
            <FormField label="Owner" optional>
              <EntityCombobox
                kind="users" label="Owner" placeholder="Assign owner…" clearable value={form.owner_id} onChange={(id) => set('owner_id', id)}
                extra={opened.owner_id ? [{ value: opened.owner_id, label: opened.owner_name || `User #${opened.owner_id}` }] : undefined}
              />
            </FormField>
          )}
        </div>

        <FormField label="Scenario" optional>
          <Textarea rows={3} value={form.scenario} onChange={(e) => set('scenario', e.target.value)} />
        </FormField>
      </div>
    </RightSlidePanel>
  );
}
