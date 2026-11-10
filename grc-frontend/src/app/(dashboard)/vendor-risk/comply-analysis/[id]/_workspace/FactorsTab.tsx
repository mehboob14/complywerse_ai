'use client';

// Comply analysis > Factors: the scenario in words, the supplier's insurance cover, and every factor of the analysis as a range (the least, the likely, the most). Nothing is saved until Save and run;
// the results are the server's and follow the saved inputs. A row that is wrong says why next to its numbers (and the Save bar says what to fix); the starting values say where they came from.
import { Fragment } from 'react';
import { FormField, SectionCard, TextInput, Textarea } from '@/components/ui/ds';
import { fieldClasses } from '@/components/ui/ds/fieldStyles';
import { GROUPS, POSITIONS, problems, type FactorText, type FairAnalysis, type Meta } from '../../../_lib/fair/fairModel';

const NUM = `${fieldClasses(false)} h-ds-control px-[12px] text-right tabular-nums`;

export default function FactorsTab({ a, text, meta, canEdit, onText, onMeta }: {
  a: FairAnalysis; text: FactorText; meta: Meta; canEdit: boolean; onText: (next: FactorText) => void; onMeta: (next: Meta) => void;
}) {
  const wrong = new Map(problems(text, meta).map((p) => [p.path, p.message]));
  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard id="about" title="About this analysis">
        <div className="flex flex-col gap-[12px]">
          <FormField label="Name" required error={wrong.get('name')}>
            <TextInput value={meta.name} onChange={(e) => onMeta({ ...meta, name: e.target.value })} disabled={!canEdit} maxLength={255} />
          </FormField>
          <FormField label="The scenario">
            <Textarea rows={2} value={meta.scenario} onChange={(e) => onMeta({ ...meta, scenario: e.target.value })} disabled={!canEdit} placeholder="e.g. An attacker takes payroll records from the supplier's platform" />
          </FormField>
          <div className="grid gap-[12px] sm:grid-cols-2">
            <FormField label="What is at risk"><TextInput value={meta.asset} onChange={(e) => onMeta({ ...meta, asset: e.target.value })} disabled={!canEdit} /></FormField>
            <FormField label="Who would act"><TextInput value={meta.threat} onChange={(e) => onMeta({ ...meta, threat: e.target.value })} disabled={!canEdit} placeholder="e.g. Organised criminals" /></FormField>
          </div>
          <FormField label={`The supplier’s cyber insurance cover (${a.currency})`} hint="From their insurance certificate. The result says how often a year’s loss would exceed it." error={wrong.get('cover')}>
            <TextInput type="number" min={0} step="any" value={meta.cover} onChange={(e) => onMeta({ ...meta, cover: e.target.value })} disabled={!canEdit} placeholder="Leave empty if not known" className="max-w-[260px]" />
          </FormField>
        </div>
      </SectionCard>

      {GROUPS.map((g) => (
        <SectionCard key={g.title} id={`g-${g.title.toLowerCase().replace(/[^a-z]+/g, '-')}`} title={g.title}>
          <div className="hidden gap-[8px] pb-[4px] text-right text-ds-label font-[600] text-ds-fg-muted sm:grid sm:grid-cols-[minmax(0,1fr)_repeat(3,92px)]" aria-hidden>
            <span />{POSITIONS.map((p) => <span key={p} className="pr-[8px]">{p === 'most likely' ? 'Likely' : p.charAt(0).toUpperCase() + p.slice(1)}</span>)}
          </div>
          <div className="flex flex-col divide-y divide-ds-border">
            {g.rows.map((row) => (
              <Fragment key={row.path}>
                <div className="flex flex-col gap-[6px] py-[10px] sm:grid sm:grid-cols-[minmax(0,1fr)_repeat(3,92px)] sm:items-center sm:gap-[8px]">
                  <div className="min-w-0">
                    <p className="break-words text-ds-body text-ds-fg">{row.label}{row.unit === 'share' ? ' (%)' : row.unit === 'money' ? ` (${a.currency})` : ''}</p>
                    <p className="text-ds-label text-ds-fg-muted">{row.help}</p>
                    {wrong.get(row.path) && <p className="text-ds-label text-ds-danger" role="alert">{wrong.get(row.path)}</p>}
                  </div>
                  {[0, 1, 2].map((i) => (
                    <label key={i} className="block">
                      <span className="mb-[2px] block text-ds-label text-ds-fg-muted sm:sr-only">{POSITIONS[i]}</span>
                      <input type="number" min={0} step="any" max={row.unit === 'share' ? 100 : undefined} className={`${NUM} ${wrong.get(row.path) ? '!border-ds-danger' : ''}`} disabled={!canEdit}
                        aria-label={`${row.label}, ${POSITIONS[i]}`} aria-invalid={wrong.get(row.path) ? true : undefined} value={text[row.path][i]}
                        onChange={(e) => onText({ ...text, [row.path]: text[row.path].map((v, j) => (j === i ? e.target.value : v)) as [string, string, string] })} />
                    </label>
                  ))}
                </div>
              </Fragment>
            ))}
          </div>
        </SectionCard>
      ))}

      {!!a.notes?.length && (
        <SectionCard id="where-from" title="Where the starting values came from">
          <ul className="m-0 flex list-disc flex-col gap-[4px] pl-[20px] text-ds-body text-ds-fg-body">{a.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </SectionCard>
      )}
    </div>
  );
}
