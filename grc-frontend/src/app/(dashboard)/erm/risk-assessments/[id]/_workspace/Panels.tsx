'use client';

/**
 * The tabs of an assessment that are not the table: Insights (the old Analytics page, now over the SAME rows and the same rating function as the tiles and the table, so the numbers cannot
 * differ), Details (what the assessment is, who leads it, when) and History (the approval record: who created, approved and closed it, and when; the server keeps no log of every step).
 */
import { Pencil } from 'lucide-react';
import { Button, Fact, FactList, PersonChip, SectionCard } from '@/components/ui/ds';
import { EMPTY, formatDate, formatDateTime, formatCount } from '@/lib/format';
import { TONE } from '@/lib/status';
import { riskLevel } from '@/lib/statuses/risk';
import { BarRow } from '../../_register/BarRow';
import { BANDS, summarise, type AssessedRisk, type Band } from '../../_register/assessmentModel';
import type { AssessmentDetail } from './workspaceData';

const BAND_TONE: Record<Band, 'danger' | 'warning' | 'progress' | 'success' | 'neutral'> = { critical: 'danger', high: 'warning', medium: 'progress', low: 'success', none: 'neutral' };
const words = (s?: string | null): string => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');
const TREATMENT_LABEL: Record<string, string> = { accept: 'Accept', mitigate: 'Mitigate', transfer: 'Transfer', avoid: 'Avoid', undecided: 'Not decided' };
const EFFECT_LABEL: Record<string, string> = { effective: 'Effective', partially_effective: 'Partly effective', ineffective: 'Ineffective', unrated: 'Not rated' };

export function InsightsPanel({ rows, onLevel }: { rows: readonly AssessedRisk[]; onLevel: (band: Band) => void }) {
  const s = summarise(rows);
  const total = rows.length;
  if (total === 0) return <p className="m-0 rounded-ds-card border border-dashed border-ds-border-strong px-[12px] py-[16px] text-ds-body text-ds-fg-muted">Nothing to show until risks are added and scored.</p>;
  return (
    <div className="grid gap-[16px] lg:grid-cols-2">
      <SectionCard id="levels" title="Level" info="By the residual score, else the inherent score: critical 20 and over, high 12, medium 6, low below. A risk with no score is counted apart. Press a level to see its risks." meta={`${formatCount(total)} ${total === 1 ? 'risk' : 'risks'}`}>
        <div className="flex flex-col">
          {BANDS.map((b) => <BarRow key={b} label={riskLevel.label(b)} value={s.byBand[b]} total={total} color={TONE[BAND_TONE[b]].dot} hint={`Show the ${riskLevel.label(b).toLowerCase()} risks`} onPress={s.byBand[b] > 0 ? () => onLevel(b) : undefined} />)}
        </div>
        <p className="mb-0 mt-[12px] text-ds-body text-ds-fg-body">
          {s.avgInherent == null ? 'No inherent scores yet.' : <>Average inherent score <strong className="font-[600] text-ds-fg">{s.avgInherent}</strong></>}
          {s.avgResidual != null && <>, average residual score <strong className="font-[600] text-ds-fg">{s.avgResidual}</strong></>}
          {s.reduction != null && <>: {s.reduction >= 0 ? `down ${s.reduction}` : `up ${Math.abs(s.reduction)}`}</>}.
        </p>
      </SectionCard>

      <SectionCard id="treatment" title="Treatment" info="What was decided for each risk." meta={`${formatCount(s.scored)} scored`}>
        <div className="flex flex-col">
          {Object.keys(TREATMENT_LABEL).map((k) => <BarRow key={k} label={TREATMENT_LABEL[k]} value={s.byTreatment[k] ?? 0} total={total} color={k === 'undecided' ? TONE.neutral.dot : TONE.progress.dot} />)}
        </div>
      </SectionCard>

      <SectionCard id="controls" title="Control effectiveness" info="How well the controls on each risk work.">
        <div className="flex flex-col">
          {Object.keys(EFFECT_LABEL).map((k) => <BarRow key={k} label={EFFECT_LABEL[k]} value={s.byEffectiveness[k] ?? 0} total={total} color={k === 'effective' ? TONE.success.dot : k === 'ineffective' ? TONE.danger.dot : k === 'partially_effective' ? TONE.warning.dot : TONE.neutral.dot} />)}
        </div>
      </SectionCard>
    </div>
  );
}

export function DetailsPanel({ a, editable, onEdit }: { a: AssessmentDetail; editable: boolean; onEdit: () => void }) {
  return (
    <SectionCard id="details" title="About this assessment" actions={editable ? <Button leftIcon={<Pencil aria-hidden />} onClick={onEdit}>Edit details</Button> : undefined}>
      <FactList min={200}>
        <Fact label="Lead assessor" empty="Unassigned">{a.lead_assessor_name ? <PersonChip name={a.lead_assessor_name} /> : null}</Fact>
        <Fact label="Type">{words(a.assessment_type)}</Fact>
        <Fact label="Method">{words(a.methodology)}</Fact>
        <Fact label="Period">{a.assessment_period_start || a.assessment_period_end ? `${formatDate(a.assessment_period_start, { calendar: true })} to ${formatDate(a.assessment_period_end, { calendar: true })}` : null}</Fact>
        <Fact label="Business unit">{a.business_unit_name}</Fact>
        <Fact label="Framework">{a.framework_name}</Fact>
      </FactList>
      {a.description && <div className="mt-[16px]"><p className="m-0 text-ds-label font-[600] text-ds-fg-muted">Description</p><p className="m-0 whitespace-pre-wrap break-words text-ds-body text-ds-fg-body">{a.description}</p></div>}
      {a.scope && <div className="mt-[12px]"><p className="m-0 text-ds-label font-[600] text-ds-fg-muted">Scope</p><p className="m-0 whitespace-pre-wrap break-words text-ds-body text-ds-fg-body">{a.scope}</p></div>}
      {a.notes && <div className="mt-[12px]"><p className="m-0 text-ds-label font-[600] text-ds-fg-muted">Notes</p><p className="m-0 whitespace-pre-wrap break-words text-ds-body text-ds-fg-body">{a.notes}</p></div>}
    </SectionCard>
  );
}

export function HistoryPanel({ a }: { a: AssessmentDetail }) {
  const events: Array<{ key: string; when?: string | null; what: string }> = [
    { key: 'created', when: a.created_at, what: 'Created' },
    { key: 'approved', when: a.approved_at, what: a.approver_name ? `Approved by ${a.approver_name}` : 'Approved' },
    { key: 'closed', when: a.completed_at, what: 'Closed' },
  ].filter((e) => e.key === 'created' || !!e.when);
  return (
    <SectionCard id="history" title="Approval record" info="Who approved the assessment and when. The platform does not keep a log of every step between the stages.">
      <ol className="m-0 list-none p-0">
        {events.map((e) => (
          <li key={e.key} className="flex flex-wrap items-baseline gap-x-[12px] border-b border-ds-border py-[8px] last:border-b-0">
            <span className="w-[160px] shrink-0 text-ds-body tabular-nums text-ds-fg-muted">{e.when ? formatDateTime(e.when) : EMPTY}</span>
            <span className="text-ds-body text-ds-fg">{e.what}</span>
          </li>
        ))}
        <li className="flex flex-wrap items-baseline gap-x-[12px] py-[8px]">
          <span className="w-[160px] shrink-0 text-ds-body tabular-nums text-ds-fg-muted">{formatDateTime(a.updated_at)}</span>
          <span className="text-ds-body text-ds-fg-muted">Last changed</span>
        </li>
      </ol>
    </SectionCard>
  );
}
