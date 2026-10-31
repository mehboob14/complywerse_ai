'use client';

// "Record measurement": one value for a manual KPI or KRI, with an optional period and commentary. It was a hand-rolled overlay (no Escape, no focus, no
// name); it is the kit's AnimatedModal now, which takes focus (on the value: it is the first field), wraps Tab, names itself and, because it is given
// `dirty`, asks "Discard changes?" before Escape, the X or a press outside throws what was typed away. It sends nothing itself: `onSubmit` gets the
// payload (metricModel.measurePayload: a manual measurement is recorded as approved at once, as it always was) and the page runs the request and closes
// this once the server has said yes.
import { useRef, useState } from 'react';
import { AnimatedModal } from '@/components/ui';
import { Button, FormField, Textarea, TextInput } from '@/components/ui/ds';
import { truncate } from '@/lib/format';
import { LIMITS, measureDirty, measurePayload, valueError, type MeasureInput, type Metric } from './metricModel';

export function MeasureDialog({ metric, saving, onSubmit, onClose }: {
  metric: Metric;
  saving: boolean;
  onSubmit: (payload: ReturnType<typeof measurePayload>) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState<MeasureInput>({ value: '', period: '', notes: '' });
  const [showErrors, setShowErrors] = useState(false);
  const valueField = useRef<HTMLInputElement>(null);
  const set = (key: keyof MeasureInput, value: string) => setInput((i) => ({ ...i, [key]: value }));
  const name = truncate(metric.name, 80);
  const submit = () => {
    if (valueError(input)) {
      setShowErrors(true);
      valueField.current?.focus();
      return;
    }
    onSubmit(measurePayload(input));
  };

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      dirty={measureDirty(input)}
      size="md"
      title="Record measurement"
      subtitle={<span title={name.truncated ? name.full : undefined}>{name.text}{metric.unit ? ` · ${truncate(metric.unit, 40).text}` : ''}</span>}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={submit}>Record</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px] px-[20px] py-[16px]">
        <FormField label="Value" required error={showErrors ? valueError(input) : undefined}>
          <TextInput ref={valueField} type="number" inputMode="decimal" step="any" value={input.value} onChange={(e) => set('value', e.target.value)} />
        </FormField>
        <FormField label="Period" optional>
          <TextInput value={input.period} maxLength={LIMITS.period} onChange={(e) => set('period', e.target.value)} placeholder="2026-Q1 / 2026-07" />
        </FormField>
        <FormField label="Commentary" optional>
          <Textarea rows={3} value={input.notes} onChange={(e) => set('notes', e.target.value)} />
        </FormField>
      </div>
    </AnimatedModal>
  );
}
