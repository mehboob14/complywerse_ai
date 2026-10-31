'use client';

// The Overview tab of a project: its summary, justification, linked GRC entities and progress; its key details, budget and quick stats; and the AI assistant.
// The numbers are the old page's (the budget share, the open-risk count); a budget with no estimate says "Not set" instead of "$0" and "0%", and an owner
// nobody named is "Unassigned" (not a dash). Cards are the kit's SectionCard, so each is a named region.
import { PersonChip, SectionCard } from '@/components/ui/ds';
import { NOT_SET, formatCount, formatDate, formatPercent } from '@/lib/format';
import { TONE } from '@/lib/status';
import { budgetShare, burnTone, clampPercent, estimateText, money } from '../_model';
import { TILE, TILE_LABEL, TILE_NUMBER } from '../_ui';
import { AiButton, CHIP, Fact, type Handlers } from './_parts';
import type { ProjectDetail } from './_types';

const orNotSet = (v: string | null | undefined) => (v && v.trim() ? v : NOT_SET);

function Chips({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="mb-[4px] text-ds-label font-[600] text-ds-fg-muted">{label}</p>
      <ul className="flex flex-wrap gap-[6px]">{items.map((x, i) => <li key={`${x}-${i}`} className={CHIP}><span className="truncate" title={x}>{x}</span></li>)}</ul>
    </div>
  );
}

export function OverviewTab({ project, h }: { project: ProjectDetail; h: Handlers }) {
  const util = budgetShare(project.budget_estimated, project.budget_actual);
  const estimated = project.budget_estimated > 0;
  const done = clampPercent(project.completion_percentage);
  const openRisks = (project.risks_issues ?? []).filter((r) => r.status === 'Open').length;
  const linked: Array<[string, string[]]> = [['Linked risks', project.linked_risks ?? []], ['Linked controls', project.linked_controls ?? []], ['Linked frameworks', project.linked_frameworks ?? []]];
  const anyLinked = linked.some(([, items]) => items.length > 0);
  const stats: Array<[string, number, boolean]> = [
    ['Milestones', project.milestones?.length || 0, false], ['Tasks', project.tasks?.length || 0, false], ['Team', project.team_members?.length || 0, false], ['Open risks', openRisks, openRisks > 0],
  ];

  return (
    <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-[16px] lg:col-span-2">
        <SectionCard id="summary" title="Project summary">
          <p className="whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{project.description || <span className="text-ds-fg-muted">No description provided</span>}</p>
        </SectionCard>
        {project.business_justification && (
          <SectionCard id="justification" title="Business justification">
            <p className="whitespace-pre-wrap text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{project.business_justification}</p>
          </SectionCard>
        )}
        {anyLinked && (
          <SectionCard id="linked" title="Linked GRC entities">
            <div className="flex flex-col gap-[12px]">{linked.filter(([, items]) => items.length > 0).map(([label, items]) => <Chips key={label} label={label} items={items} />)}</div>
          </SectionCard>
        )}
        <SectionCard id="progress" title="Progress">
          <div className="flex items-center gap-[16px]">
            <div role="progressbar" aria-label="Project progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done)} className="h-[12px] flex-1 overflow-hidden rounded-full bg-ds-border">
              <div className="h-full rounded-full bg-ds-primary" style={{ width: `${done}%` }} />
            </div>
            <span className="text-[24px] font-[600] leading-[32px] tabular-nums text-ds-fg">{formatPercent(project.completion_percentage)}</span>
          </div>
        </SectionCard>
      </div>

      <div className="flex min-w-0 flex-col gap-[16px]">
        <SectionCard id="details" title="Key details">
          <dl className="flex flex-col gap-[8px]">
            <Fact label="Owner"><PersonChip name={project.project_owner_name} className="justify-end" /></Fact>
            <Fact label="Sponsor">{orNotSet(project.sponsor)}</Fact>
            <Fact label="Department">{orNotSet(project.department)}</Fact>
            <Fact label="Start date">{formatDate(project.start_date, { calendar: true, empty: NOT_SET })}</Fact>
            <Fact label="Target end">{formatDate(project.target_end_date, { calendar: true, empty: NOT_SET })}</Fact>
          </dl>
        </SectionCard>

        <SectionCard id="budget-summary" title="Budget">
          <dl className="flex flex-col gap-[8px]">
            <Fact label="Estimated">{estimateText(project.budget_estimated)}</Fact>
            <Fact label="Actual">{money(project.budget_actual ?? 0)}</Fact>
            <Fact label="Utilization">{estimated ? <span style={{ color: util > 100 ? TONE.danger.text : undefined }}>{util}%{util > 100 ? ' (over budget)' : ''}</span> : '—'}</Fact>
          </dl>
          {estimated && (
            <div role="progressbar" aria-label="Budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(util, 100)} className="mt-[12px] h-[8px] overflow-hidden rounded-full bg-ds-border">
              <div className="h-full rounded-full" style={{ width: `${clampPercent(util)}%`, background: TONE[burnTone(util)].dot }} />
            </div>
          )}
        </SectionCard>

        <SectionCard id="stats" title="Quick stats">
          <div className="grid grid-cols-2 gap-[8px]">
            {stats.map(([label, n, warn]) => (
              <div key={label} className={`${TILE} !p-[12px] text-center`}>
                <p className={`${TILE_NUMBER} !text-[20px] !leading-[24px]`} style={warn ? { color: TONE.warning.text } : undefined}>{formatCount(n)}</p>
                <p className={`${TILE_LABEL} justify-center`}>{label}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard id="assistant" title="AI assistant" info="The AI makes suggestions. Nothing is added to the project until you apply them.">
          <div className="flex flex-col gap-[8px]">
            <AiButton h={h} ai="generate-plan" fullWidth>Generate plan</AiButton>
            <AiButton h={h} ai="assess-risks" fullWidth>Assess risks</AiButton>
            <AiButton h={h} ai="draft-status-report" fullWidth>Draft status report</AiButton>
            <AiButton h={h} ai="suggest-team" fullWidth>Suggest team</AiButton>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
