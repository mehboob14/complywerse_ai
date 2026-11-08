'use client';

// New task > Link a record: the record the task is about (a risk, an internal control, a vulnerability, a regulatory change, a committee, a framework and one of its requirements) and AI
// Generate, which drafts the title and description from what was linked (or from the title alone). The seven lists are read only when this part is opened (they used to load for every viewer
// every time the form opened), a list that cannot be read says so with a Retry, and a list the server cuts at 100 says that. The risk, internal control, vulnerability and framework links are saved
// with the task; the regulatory change and the committee only help the AI write the description and are not saved (said once, in the (i)).
import { Sparkles } from 'lucide-react';
import { Button, Combobox, ErrorState, FormField, useNotify, useReportedMutation } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { criticalTasksApi } from '@/lib/api';
import { useFrameworkOptions, useRecordOptions, useRequirementOptions } from '../_queries';
import { aiContextOf, aiContextRequest, aiDescriptionText, applyAiContext, fallbackFill, type AiContextItem, type NewTaskForm, type PickerOption } from '../tasksModel';

interface Source { data?: PickerOption[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }

/** the server's lists of risks and internal controls hold their first 100 */
const SERVER_CUT = 100;

function LinkField({ label, plural, value, onChange, source, disabledText, capped = false }: { label: string; plural: string; value: string; onChange: (value: string) => void; source: Source; disabledText?: string; capped?: boolean }) {
  if (source.isError && !source.data) {
    return <ErrorState compact title={`Couldn't load the ${label.toLowerCase()} list`} message={errorMessage(source.error)} onRetry={canRetry(source.error) ? () => { void source.refetch(); } : undefined} />;
  }
  const cut = capped && (source.data?.length ?? 0) >= SERVER_CUT;
  return (
    <FormField label={label} hint={cut ? `Only the first ${SERVER_CUT} ${plural} are listed.` : undefined}>
      <Combobox
        label={label}
        clearable
        searchable
        searchPlaceholder={`Search ${plural}`}
        options={(source.data ?? []).map((o) => ({ value: String(o.id), label: o.label }))}
        value={value || null}
        onChange={(next) => onChange(next ?? '')}
        placeholder={disabledText ?? (source.isLoading ? 'Loading…' : 'None')}
        disabled={!!disabledText}
      />
    </FormField>
  );
}

export function LinkRecords({ form, set, setForm }: { form: NewTaskForm; set: (patch: Partial<NewTaskForm>) => void; setForm: (update: (f: NewTaskForm) => NewTaskForm) => void }) {
  const notify = useNotify();
  const risks = useRecordOptions('risk', true);
  const controls = useRecordOptions('control', true);
  const vulnerabilities = useRecordOptions('vulnerability', true);
  const changes = useRecordOptions('regulatory', true);
  const committees = useRecordOptions('committee', true);
  const frameworks = useFrameworkOptions(true);
  const requirements = useRequirementOptions(form.linked_framework_id);

  // AI Generate: from the linked records when there are some, else from the title alone (the old form's own two paths); it fills only what is empty
  const generate = useReportedMutation({
    mutationFn: async (v: { ctx: AiContextItem[]; form: NewTaskForm }) => {
      if (v.ctx.length === 0) {
        const res = await criticalTasksApi.aiGenerateDescription({ title: v.form.title, category: v.form.category, source: v.form.source, priority: v.form.priority });
        return { ...v, request: null, desc: res.data?.description };
      }
      const request = aiContextRequest(v.ctx, v.form.priority);
      const res = await criticalTasksApi.aiGenerateDescription(request);
      return { ...v, request, desc: res.data?.description };
    },
    success: (r) => (r.ctx.length === 0 ? 'Description drafted' : 'Drafted from the linked records'),
    failure: "AI couldn't draft the task",
    onSuccess: (r) => {
      if (r.request) setForm((f) => applyAiContext(f, r.ctx, r.request, r.desc));
      else if (aiDescriptionText(r.desc)) setForm((f) => ({ ...f, description: aiDescriptionText(r.desc) }));
    },
    onError: (_error, v) => {
      if (v.ctx.length > 0) {                                           // the form is still filled from what was linked, and it says so
        setForm((f) => fallbackFill(f, v.ctx));
        notify.info('The title and description were filled from the linked records instead.');
      }
    },
  });
  const runAi = () => {
    const ctx = aiContextOf(form, { risk: risks.data ?? [], control: controls.data ?? [], vulnerability: vulnerabilities.data ?? [], regulatory: changes.data ?? [], committee: committees.data ?? [] });
    if (ctx.length === 0 && !form.title.trim()) { notify.info('Link a record or type a title first, then AI Generate can draft the rest.'); return; }
    generate.mutate({ ctx, form });
  };

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <span className="flex items-center gap-[4px] text-ds-label text-ds-fg-muted">
          The record this task is about
          <InfoTip text="The risk, internal control, vulnerability and framework links are saved with the task. The regulatory change and the committee are used only to help AI Generate write the description: they are not saved." label="About linking a record" />
        </span>
        <Button leftIcon={<Sparkles aria-hidden />} loading={generate.isPending} onClick={runAi}>AI Generate</Button>
      </div>
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
        <LinkField label="Risk" plural="risks" capped value={form.linked_risk_id} onChange={(v) => set({ linked_risk_id: v })} source={risks} />
        <LinkField label="Internal control" plural="internal controls" capped value={form.linked_control_id} onChange={(v) => set({ linked_control_id: v })} source={controls} />
        <LinkField label="Vulnerability" plural="vulnerabilities" value={form.linked_vulnerability_id} onChange={(v) => set({ linked_vulnerability_id: v })} source={vulnerabilities} />
        <LinkField label="Regulatory change" plural="regulatory changes" value={form.linked_regulatory_change_id} onChange={(v) => set({ linked_regulatory_change_id: v })} source={changes} />
        <LinkField label="Committee" plural="committees" value={form.linked_committee_id} onChange={(v) => set({ linked_committee_id: v })} source={committees} />
        <LinkField label="Compliance framework" plural="frameworks" value={form.linked_framework_id} onChange={(v) => set({ linked_framework_id: v, linked_requirement_id: '' })} source={frameworks} />
        <LinkField
          label="Framework requirement"
          plural="requirements"
          value={form.linked_requirement_id}
          onChange={(v) => set({ linked_requirement_id: v })}
          source={requirements}
          disabledText={!form.linked_framework_id ? 'Select a framework first' : requirements.isLoading ? 'Loading requirements…' : undefined}
        />
      </div>
    </div>
  );
}
