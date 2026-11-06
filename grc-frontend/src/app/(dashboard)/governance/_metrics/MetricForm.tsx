'use client';

// The create / edit drawer of a KPI or KRI (it was a hand-rolled overlay with no Escape, no focus and no name). On the kit: RightSlidePanel, which takes
// focus, wraps Tab, names itself and, because it is given `dirty`, asks "Discard changes?" before Escape, the X or a press outside throws typed input away;
// FormField with TextInput / Textarea / Select; Button. The words of what each field means are the (i) beside its label.
// It sends nothing itself: `onSubmit` gets the payload (metricModel.toPayload, what the report has always sent) and the page runs the request, reports its
// outcome and closes the drawer once the server has said yes. The rules (what a template or a platform metric fills in, what is dirty) are in metricModel.ts.
import { useMemo, useRef, useState } from 'react';
import { RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, FormField, SegmentedControl, Select, Textarea, TextInput } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { truncate } from '@/lib/format';
import {
  FREQUENCIES, KIND_META, LIMITS, applyTemplate, blankForm, formDirty, formFromMetric, nameError, pickMetric, sourceOf, toPayload,
  type Kind, type Metric, type MetricFormState, type MetricOption, type Source, type Template,
} from './metricModel';

/** One of the two lists the drawer picks from: where it stands, and how to ask again. */
export interface Feed<T> { items: T[]; state: 'loading' | 'error' | 'ready'; error?: unknown; retry: () => void }

const ROW2 = 'grid gap-[12px] sm:grid-cols-2';
const ROW3 = 'grid gap-[12px] sm:grid-cols-3';
const SOURCES = [{ value: 'manual', label: 'Manual entry' }, { value: 'live', label: 'Live from platform' }] as const;

function groupBy<T>(items: T[], by: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = by(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  });
  return Array.from(groups.entries());
}

/** What "Green" and "Amber" mean for the direction chosen: the server's rule (kris.py calculate_kri_status), said once. */
function thresholdNotes(direction: string): { green: string; amber: string } {
  return direction === 'lower_is_better'
    ? { green: 'On track when the value is at or below this.', amber: 'Watch when the value is above Green but at or below this; anything higher is Off target. Both thresholds are needed to rate a value.' }
    : { green: 'On track when the value is at or above this.', amber: 'Watch when the value is below Green but at or above this; anything lower is Off target. Both thresholds are needed to rate a value.' };
}

export function MetricForm({ kind, metric, options, templates, saving, onSubmit, onClose }: {
  kind: Kind;
  /** the metric being edited; null: a new one */
  metric: Metric | null;
  options: Feed<MetricOption>;
  templates: Feed<Template>;
  saving: boolean;
  onSubmit: (payload: ReturnType<typeof toPayload>) => void;
  onClose: () => void;
}) {
  const noun = KIND_META[kind].noun;
  const [opened] = useState(() => ({ form: metric ? formFromMetric(metric, kind) : blankForm(kind), source: sourceOf(metric) }));
  const [form, setForm] = useState<MetricFormState>(opened.form);
  const [source, setSource] = useState<Source>(opened.source);
  const [template, setTemplate] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const set = (key: keyof MetricFormState, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const dirty = formDirty(opened, { form, source });

  const groupedOptions = useMemo(() => groupBy(options.items, (o) => o.module_label), [options.items]);
  const groupedTemplates = useMemo(() => groupBy(templates.items, (t) => t.category), [templates.items]);
  const notes = thresholdNotes(form.threshold_direction);

  const choose = (key: string) => {
    setTemplate(key);
    const t = templates.items.find((x) => x.key === key);
    if (!t) return;
    setSource('manual');
    setForm((f) => applyTemplate(f, t));
  };
  const submit = () => {
    if (nameError(form)) {
      setShowErrors(true);
      nameField.current?.focus();
      return;
    }
    onSubmit(toPayload(form, source, kind));
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={dirty}
      title={metric ? `Edit ${noun}` : `New ${noun}`}
      subtitle={metric ? truncate(metric.name, 80).text : undefined}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{metric ? 'Save changes' : 'Create'}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        {!metric && templates.state === 'error' && (
          <ErrorState compact title="Couldn't load the templates" message={errorMessage(templates.error)} onRetry={templates.retry} />
        )}
        {!metric && templates.items.length > 0 && (
          <FormField label="Start from a template" optional info="Fills the form with a ready-made definition. You can change anything before you create it.">
            <Select value={template} onChange={(e) => choose(e.target.value)} placeholder="Build from scratch">
              {groupedTemplates.map(([category, list]) => (
                <optgroup key={category} label={category}>{list.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</optgroup>
              ))}
            </Select>
          </FormField>
        )}

        <FormField label="Name" required error={showErrors ? nameError(form) : undefined}>
          <TextInput ref={nameField} value={form.name} maxLength={LIMITS.name} onChange={(e) => set('name', e.target.value)}
            placeholder={kind === 'kpi' ? 'e.g. % vulns remediated within SLA' : 'e.g. Open KEV vulnerabilities'} />
        </FormField>
        <FormField label="Definition / methodology" optional>
          <Textarea rows={3} value={form.formula} onChange={(e) => set('formula', e.target.value)} placeholder="numerator ÷ denominator" />
        </FormField>
        <div className={ROW2}>
          <FormField label="Category" optional info={`Groups this ${noun} in the By category summary.`}>
            <TextInput value={form.category} maxLength={LIMITS.category} onChange={(e) => set('category', e.target.value)} placeholder="Cyber Security" />
          </FormField>
          <FormField label="Unit" optional info="What the value is counted in: %, count, days. A value in % or days shows with it (88%, 21d).">
            <TextInput value={form.unit} maxLength={LIMITS.unit} onChange={(e) => set('unit', e.target.value)} placeholder="%, count, days" />
          </FormField>
        </div>

        <div className="flex flex-col gap-[4px]">
          <div className="flex items-center gap-[4px]">
            <span className="text-ds-label text-ds-fg">Value source</span>
            <InfoTip text="Manual: someone records the value each period. Live: the platform feeds the value from its own data and it updates by itself." label="About value source" />
          </div>
          <SegmentedControl label="Value source" name="metric-source" options={SOURCES} value={source} onChange={(v: Source) => setSource(v)} className="self-start" />
        </div>
        {source === 'live' && (
          options.state === 'error' ? (
            <ErrorState compact title="Couldn't load the platform metrics" message={errorMessage(options.error)} onRetry={options.retry} />
          ) : (
            <FormField label="Platform metric" hint={form.metric_key ? undefined : 'Pick one, or this saves as a manual metric.'}>
              <Select value={form.metric_key} disabled={options.state === 'loading'} onChange={(e) => setForm((f) => pickMetric(f, e.target.value, options.items.find((o) => o.key === e.target.value)))}
                placeholder={options.state === 'loading' ? 'Loading platform metrics…' : 'Pick a metric to auto-feed'}>
                {groupedOptions.map(([module, list]) => (
                  <optgroup key={module} label={module}>{list.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</optgroup>
                ))}
              </Select>
            </FormField>
          )
        )}

        <div className={ROW3}>
          <FormField label="Target" optional info="The value you aim for. It shows beside the current value; the rating comes from Green and Amber.">
            <TextInput type="number" inputMode="decimal" step="any" value={form.target} onChange={(e) => set('target', e.target.value)} />
          </FormField>
          <FormField label="Green" optional info={notes.green}>
            <TextInput type="number" inputMode="decimal" step="any" value={form.green_threshold} onChange={(e) => set('green_threshold', e.target.value)} />
          </FormField>
          <FormField label="Amber" optional info={notes.amber}>
            <TextInput type="number" inputMode="decimal" step="any" value={form.amber_threshold} onChange={(e) => set('amber_threshold', e.target.value)} />
          </FormField>
        </div>
        <div className={ROW3}>
          <FormField label="Direction" info="Which way is better. It decides how Green and Amber are read.">
            <Select value={form.threshold_direction} onChange={(e) => set('threshold_direction', e.target.value)}>
              <option value="higher_is_better">Higher is better</option>
              <option value="lower_is_better">Lower is better</option>
            </Select>
          </FormField>
          <FormField label="Frequency" info="How often a measurement is expected.">
            <Select value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>
              {FREQUENCIES.map((f) => <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>)}
            </Select>
          </FormField>
          <FormField label="Next due" optional info="The day the next measurement is due. A manual metric shows Due from that day.">
            <TextInput type="date" value={form.next_due_date} onChange={(e) => set('next_due_date', e.target.value)} />
          </FormField>
        </div>
      </div>
    </RightSlidePanel>
  );
}
