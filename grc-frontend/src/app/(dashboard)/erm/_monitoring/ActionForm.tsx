'use client';

// Add / edit a mitigation action, in the kit's side panel. A new action must name its risk (the page used to pick the newest risk for you, and a blank due date became today); an
// existing one keeps its risk. The status can be set to open, in progress or cancelled: completing goes through "Mark complete" (it stamps the date and takes the achieved
// reduction), and "overdue" is never set by hand. AI suggestions are offered for the chosen risk and fill the form only when one is picked.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { Button, Combobox, ErrorState, FormField, Notice, Select, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { ermApi } from '@/lib/api';
import { ACTION_PRIORITIES, ACTION_TYPES, SETTABLE_STATUSES, parseReduction } from '@/lib/erm/mitigation';
import { mitigationStatus, optionsOf, severity, treatmentType } from '@/lib/statuses/monitoring';
import { formatCount } from '@/lib/format';
import type { ActionRow } from './mitigationModel';
import { personOptions, riskOptions, useLeanRisks, useTenantUsers } from './lookups';

const ROW2 = 'grid gap-[12px] sm:grid-cols-2';
type Suggestion = { title: string; description: string; action_type: string; priority: string; expected_residual_reduction: number };

interface Draft { risk: string | null; title: string; description: string; type: string; priority: string; status: string; due: string; owner: string | null; reduction: string; notes: string }
const draftOf = (a: ActionRow | null, risk: number | null): Draft => ({
  risk: a ? String(a.risk_id) : risk ? String(risk) : null, title: a?.title ?? '', description: a?.description ?? '', type: a?.action_type ?? 'mitigate', priority: a?.priority ?? 'medium',
  status: a?.status ?? 'open', due: a?.due_date ? a.due_date.slice(0, 10) : '', owner: a?.owner_id ? String(a.owner_id) : null,
  reduction: a?.expected_residual_reduction != null ? String(a.expected_residual_reduction) : '', notes: a?.notes ?? '',
});

export function ActionForm({ action, risk, saving, onSubmit, onClose }: {
  action: ActionRow | null;
  /** a risk to start from (opened from a risk's own page); the person still sees and can change it */
  risk?: number | null;
  saving: boolean;
  onSubmit: (riskId: number, payload: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const isNew = action === null;
  const [opened] = useState(() => draftOf(action, risk ?? null));
  const [d, setD] = useState<Draft>(opened);
  const [tried, setTried] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((x) => ({ ...x, [key]: value }));
  const risks = useLeanRisks(isNew);
  const people = useTenantUsers();

  const suggest = useReportedMutation({
    mutationFn: async () => (await ermApi.mitigationActions.aiSuggest({ risk_id: d.risk ? Number(d.risk) : undefined, title: d.title || undefined })).data,
    success: 'Suggestions ready', failure: "Couldn't get suggestions", toast: 'none',
    onSuccess: (r) => setSuggestions(r.suggestions ?? []),
  });
  const dirty = (Object.keys(opened) as Array<keyof Draft>).some((k) => opened[k] !== d[k]);
  const reduction = parseReduction(d.reduction);
  const errors = {
    risk: tried && isNew && !d.risk ? 'Choose the risk this action treats.' : undefined,
    title: tried && !d.title.trim() ? 'Enter a title.' : undefined,
    reduction: reduction === undefined ? 'Enter a number from 0 to 100.' : undefined,
  };
  const submit = () => {
    setTried(true);
    if ((isNew && !d.risk) || !d.title.trim() || reduction === undefined) return;
    onSubmit(Number(d.risk), {
      title: d.title.trim(), description: d.description || null, action_type: d.type, priority: d.priority,
      due_date: d.due ? new Date(d.due).toISOString() : null, owner_id: d.owner ? Number(d.owner) : null,
      expected_residual_reduction: reduction, notes: d.notes || null,
      ...(isNew ? {} : { status: d.status }),
    });
  };
  const statusOptions = optionsOf(mitigationStatus, SETTABLE_STATUSES);

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={dirty}
      title={isNew ? 'Add a mitigation action' : 'Edit mitigation action'}
      subtitle={isNew ? undefined : action!.title}
      footer={<div className="flex justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={saving} onClick={submit}>{isNew ? 'Add action' : 'Save changes'}</Button></div>}
    >
      <div className="flex flex-col gap-[16px]">
        {isNew ? (
          <FormField label="Risk" required error={errors.risk}>
            <Combobox label="Risk" options={riskOptions(risks.data?.items)} value={d.risk} onChange={(v) => set('risk', v)} placeholder={risks.isError ? 'The risks could not be loaded' : risks.isLoading ? 'Loading the risks…' : 'Choose a risk'} disabled={risks.isError} />
          </FormField>
        ) : (
          <div><p className="text-ds-label text-ds-fg-muted">Risk</p><p className="text-ds-body text-ds-fg [overflow-wrap:anywhere]">{action!.risk_title || `Risk ${action!.risk_id}`}</p></div>
        )}
        {isNew && (
          <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <p className="min-w-0 flex-1 text-ds-body text-ds-fg-body">Let the AI suggest actions for this risk.</p>
              <Button leftIcon={<Sparkles aria-hidden />} loading={suggest.isPending} disabled={!d.risk && !d.title.trim()} onClick={() => suggest.mutate()}>AI suggest</Button>
            </div>
            {suggest.isError && <ErrorState compact title="The AI could not suggest actions right now" message="Try again in a moment, or write the action yourself." />}
            {suggestions && suggestions.length === 0 && <Notice tone="info">The AI had no suggestion for this risk.</Notice>}
            {suggestions && suggestions.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-[6px] p-0" aria-label="Suggested actions">
                {suggestions.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => { setD((x) => ({ ...x, title: s.title, description: s.description, type: s.action_type, priority: s.priority, reduction: String(s.expected_residual_reduction) })); setSuggestions(null); }}
                      className="w-full rounded-ds-control border border-ds-border bg-ds-surface px-[10px] py-[8px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
                    >
                      <span className="block text-ds-body font-[600] text-ds-fg">{s.title}</span>
                      <span className="block text-ds-label text-ds-fg-muted">{`${treatmentType.label(s.action_type)} · ${severity.label(s.priority)} priority · about ${formatCount(s.expected_residual_reduction)}% less residual risk`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <FormField label="Title" required error={errors.title}><TextInput value={d.title} maxLength={255} onChange={(e) => set('title', e.target.value)} /></FormField>
        <FormField label="Description" optional><Textarea rows={3} value={d.description} onChange={(e) => set('description', e.target.value)} /></FormField>
        <div className={ROW2}>
          <FormField label="Treatment">
            <Select value={d.type} onChange={(e) => set('type', e.target.value)}>{optionsOf(treatmentType, ACTION_TYPES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </FormField>
          <FormField label="Priority">
            <Select value={d.priority} onChange={(e) => set('priority', e.target.value)}>{optionsOf(severity, ACTION_PRIORITIES).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </FormField>
        </div>
        {!isNew && (
          <FormField label="Status" hint={action!.status === 'completed' ? 'Completed. Use Mark complete on a new action instead of reopening this one.' : undefined}>
            <Select value={d.status} disabled={action!.status === 'completed'} onChange={(e) => set('status', e.target.value)}>
              {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              {!(SETTABLE_STATUSES as readonly string[]).includes(d.status) && <option value={d.status}>{mitigationStatus.label(d.status)}</option>}
            </Select>
          </FormField>
        )}
        <div className={ROW2}>
          <FormField label="Due date" optional><TextInput type="date" value={d.due} onChange={(e) => set('due', e.target.value)} /></FormField>
          <FormField label="Owner" optional>
            <Combobox label="Owner" options={personOptions(people.data)} value={d.owner} onChange={(v) => set('owner', v)} clearable placeholder={people.isError ? 'The people could not be loaded' : 'Unassigned'} disabled={people.isError} />
          </FormField>
        </div>
        <FormField label="Expected reduction" optional error={errors.reduction} info="How much of the residual risk this action should remove, as a percentage.">
          <TextInput type="number" inputMode="decimal" min={0} max={100} step="any" unit="%" value={d.reduction} onChange={(e) => set('reduction', e.target.value)} />
        </FormField>
        <FormField label="Notes" optional><Textarea rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} /></FormField>
      </div>
    </RightSlidePanel>
  );
}
