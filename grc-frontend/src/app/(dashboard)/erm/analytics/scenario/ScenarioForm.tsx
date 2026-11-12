'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { Button, FormField, MultiSelect, Notice, Select, TextInput, Textarea } from '@/components/ui/ds';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import {
  CARD, frequencyInput, frequencyPayload, parseAmount, SCENARIOS, type FrequencyMode, type Scenario,
} from './scenarioModel';

const amount = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** Create or edit a scenario: its risks, the workshop's frequency and per-event loss range in one currency, the notes; Run saves
 *  and runs it on the FAIR engine. Changing the estimates of a run scenario takes it back to draft until it is run again. */
export default function ScenarioForm({ scenario, onSaved, onCancel }: {
  scenario?: Scenario;
  onSaved: (id: number) => void;
  onCancel: () => void;
}) {
  const startFrequency = frequencyInput(scenario?.frequency_per_year);
  const [title, setTitle] = useState(scenario?.title ?? '');
  const [description, setDescription] = useState(scenario?.description ?? '');
  const [riskIds, setRiskIds] = useState<string[]>((scenario?.risk_ids ?? []).map(String));
  const [currency, setCurrency] = useState(scenario?.currency ?? 'USD');
  const [mode, setMode] = useState<FrequencyMode>(startFrequency.mode);
  const [frequency, setFrequency] = useState(startFrequency.value);
  const [low, setLow] = useState(amount(scenario?.loss_low));
  const [typical, setTypical] = useState(amount(scenario?.loss_typical));
  const [severe, setSevere] = useState(amount(scenario?.loss_severe));
  const [notes, setNotes] = useState(scenario?.workshop_notes ?? '');

  const risks = useQuery({
    queryKey: ['erm-risks'],
    queryFn: async () => (await ermApi.risks.getAll()).data as Array<{ id: number; title: string; risk_category?: string }>,
  });
  const options = (risks.data ?? []).map((r) => ({ value: String(r.id), label: r.title, description: r.risk_category }));

  const typicalN = parseAmount(typical);
  const severeN = parseAmount(severe);
  const lowN = parseAmount(low);
  const orderError = typicalN !== null && severeN !== null && severeN < typicalN ? 'The severe loss must be at least the typical loss'
    : lowN !== null && typicalN !== null && lowN > typicalN ? 'The least loss must not be above the typical loss' : null;
  const currencyError = /^[A-Za-z]{3}$/.test(currency.trim()) ? null : 'A three-letter code, such as GBP or USD';

  const save = useReportedMutation({
    mutationFn: async (andRun: boolean) => {
      const frequencyUnchanged = scenario && mode === startFrequency.mode && frequency === startFrequency.value;
      const body = {
        title: title.trim(), description: description.trim() || null, risk_ids: riskIds.map(Number),
        currency: currency.trim().toUpperCase(), workshop_notes: notes.trim() || null,
        loss_low: lowN, loss_typical: typicalN, loss_severe: severeN,
        ...(frequencyUnchanged ? {} : frequencyPayload(mode, frequency)),
      };
      const saved = (scenario ? await ermApi.scenarios.update(scenario.id, body) : await ermApi.scenarios.create(body)).data as Scenario;
      if (andRun) await ermApi.scenarios.run(saved.id);
      return saved;
    },
    success: (_saved, andRun) => (andRun ? 'Scenario saved and run' : 'Scenario saved'),
    failure: "Couldn't save the scenario",
    retryable: false,
    invalidate: [SCENARIOS],
    onSuccess: (saved) => onSaved(saved.id),
  });
  const canSave = !!title.trim() && !orderError && !currencyError;
  const canRun = canSave && typicalN !== null && severeN !== null && !!parseAmount(frequency) && !!notes.trim();

  return (
    <div className={`${CARD} space-y-4`}>
      <h3 className="font-medium text-slate-900">{scenario ? 'Edit scenario' : 'New scenario'}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Title" required>
          <TextInput value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} placeholder="Card payments down for a full day" />
        </FormField>
        <FormField label="Linked risks" optional>
          <MultiSelect label="Linked risks" options={options} value={riskIds} onChange={setRiskIds} placeholder="Choose risks from the register" />
        </FormField>
      </div>
      <FormField label="Description" optional>
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>

      <div className="grid gap-3 sm:grid-cols-4">
        <FormField label="Currency" required error={currencyError}>
          <TextInput value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </FormField>
        <FormField label="Frequency given as">
          <Select value={mode} onChange={(e) => setMode(e.target.value as FrequencyMode)}>
            <option value="one_in">Once in N years</option>
            <option value="per_year">Events per year</option>
          </Select>
        </FormField>
        <FormField label={mode === 'one_in' ? 'N (years)' : 'Events per year'} info="How often a loss event of this kind happens">
          <TextInput inputMode="decimal" value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder={mode === 'one_in' ? '10' : '0.5'} />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={`Least loss per event (${currency || '—'})`} optional hint="Blank is 0">
          <TextInput inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
        </FormField>
        <FormField label={`Typical loss per event (${currency || '—'})`} error={orderError}>
          <TextInput inputMode="decimal" value={typical} onChange={(e) => setTypical(e.target.value)} placeholder="250,000" />
        </FormField>
        <FormField label={`Severe loss per event (${currency || '—'})`} info="Severe but plausible: the worst the workshop could defend">
          <TextInput inputMode="decimal" value={severe} onChange={(e) => setSevere(e.target.value)} placeholder="5,000,000" />
        </FormField>
      </div>
      <FormField label="Workshop notes" hint="Who took part, what the estimates rest on (loss events, peers, expert view). Needed to run.">
        <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>

      {scenario?.status === 'estimated' && (
        <Notice tone="info">Changing the risks, currency, frequency or losses takes the scenario back to draft until it is run again.</Notice>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={save.isPending}>Cancel</Button>
        <Button variant="secondary" loading={save.isPending && save.variables === false} disabled={!canSave} onClick={() => save.mutate(false)}>Save</Button>
        <Button variant="primary" leftIcon={<Play />} loading={save.isPending && save.variables === true} disabled={!canRun}
          title={canRun ? undefined : 'Enter the frequency, typical and severe loss and the workshop notes'} onClick={() => save.mutate(true)}>
          Save and run
        </Button>
      </div>
    </div>
  );
}
