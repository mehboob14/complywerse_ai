'use client';

// The details of one requirement, in a right-hand panel (it opens from the row, from the keyboard too, and its address is `?open=<id>`): what the evidence is, how
// often to collect it, what it must show, how to collect it, why the AI suggested it (only where a model wrote it), and where it stands in review, with the
// steps the person may take. Optional values that are not recorded are not drawn (a retention period or an AI confidence that is null says nothing, as before).
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { Button, Notice, StatusPill } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { priority, statusPill } from '@/lib/status';
import { requirementStatus } from '@/lib/statuses/evidence';
import { confidenceOf, formatLabel, readable, type Requirement, type Step, type StepKey } from './requirementsModel';
import { ClampedText, Fact, ItemList, MUTED, Section } from './_parts';

export function RequirementDrawer({ req, control, steps, busy, onStep, onClose }: {
  req: Requirement;
  control: { reference: string; title: string };
  steps: Step[];
  busy: boolean;
  onStep: (key: StepKey) => void;
  onClose: () => void;
}) {
  const [reasoning, setReasoning] = useState(false);
  const confidence = confidenceOf(req.ai_confidence);
  const format = formatLabel(req.evidence_format);
  const dates: Array<[string, string | null]> = [['Created', req.created_at], ['Submitted', req.submitted_at], ['Review started', req.reviewed_at], ['Approved', req.approved_at]];
  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="Evidence requirement"
      subtitle={control.reference}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          {steps.map((s) => (
            <Button key={s.key} variant={s.key === 'reject' ? 'dangerOutline' : 'primary'} loading={busy} onClick={() => onStep(s.key)}>{s.label}</Button>
          ))}
          <Button onClick={onClose}>Close</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <div>
          <p className="break-words text-ds-section font-[600] text-ds-fg" dir="auto">{req.evidence_title}</p>
          <p className={`mt-[2px] break-words text-ds-body ${MUTED}`}>{control.title}</p>
          <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
            <StatusPill {...statusPill(requirementStatus, req.status)} />
            <StatusPill {...statusPill(priority, req.priority)} />
            {req.is_mandatory && <StatusPill tone="danger" label="Required" />}
          </div>
        </div>

        {req.rejection_reason && (
          <Notice tone="danger" title="Rejected">{req.rejection_reason}</Notice>
        )}

        <dl className="grid grid-cols-2 gap-x-[16px] gap-y-[12px]">
          <Fact label="Evidence type">{readable(req.evidence_type) || <span className={MUTED}>—</span>}</Fact>
          <Fact label="How often">{readable(req.collection_frequency) || <span className={MUTED}>Not specified</span>}</Fact>
          {req.retention_period != null && <Fact label="Retention period">{req.retention_period || <span className={MUTED}>Not specified</span>}</Fact>}
          {confidence && <Fact label="AI confidence">{`${confidence.pct}%`}</Fact>}
          <Fact label="Mandatory">{req.is_mandatory ? 'Yes' : 'No'}</Fact>
          {format && <Fact label="Format">{format}</Fact>}
        </dl>

        {req.evidence_description?.trim() && <Section title="Description"><ClampedText text={req.evidence_description} /></Section>}
        {!!req.exact_requirements?.length && <Section title={`What it must include (${req.exact_requirements.length})`}><ItemList items={req.exact_requirements} marker="check" /></Section>}
        {!!req.acceptance_criteria?.length && <Section title={`Acceptance criteria (${req.acceptance_criteria.length})`}><ItemList items={req.acceptance_criteria} marker="dot" /></Section>}
        {req.sample_evidence?.trim() && <Section title="Sample evidence"><ClampedText text={req.sample_evidence} /></Section>}
        {req.collection_guidance?.trim() && <Section title="How to collect it"><ClampedText text={req.collection_guidance} /></Section>}

        {req.ai_reasoning?.trim() && (
          <section>
            <Button variant="link" size="sm" aria-expanded={reasoning} rightIcon={<ChevronDown aria-hidden className={reasoning ? 'rotate-180' : ''} />} onClick={() => setReasoning(!reasoning)}>
              AI reasoning
            </Button>
            {reasoning && <div className="mt-[4px] rounded-ds-card bg-ds-surface-hover p-[12px]"><ClampedText text={req.ai_reasoning} /></div>}
          </section>
        )}

        <p className={`flex flex-wrap gap-x-[16px] gap-y-[2px] text-ds-label ${MUTED}`}>
          {dates.filter(([, at]) => at).map(([label, at]) => <span key={label}>{label} {formatDate(at)}</span>)}
        </p>
      </div>
    </RightSlidePanel>
  );
}
