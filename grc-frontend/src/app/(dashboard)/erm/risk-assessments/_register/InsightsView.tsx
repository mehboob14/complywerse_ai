'use client';

/**
 * The home's Insights view: the old Risk Assessments dashboard (ten charts for a handful of numbers, two URLs for one page) folded in as the figures that matter, over the rows the person is
 * looking at (the filters narrow it). Every figure is `insightsOf` (tested); nothing is a picture of a number: a stage, an owner or a framework is a button that shows its assessments in the
 * list. The charts keep a text table for a screen reader (ChartFrame).
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame, SectionCard, StatTile } from '@/components/ui/ds';
import { formatCount, formatPercent } from '@/lib/format';
import { TONE } from '@/lib/status';
import { assessmentStatus } from '@/lib/statuses/assessments';
import { BarRow } from './BarRow';
import { STAGES, STAGE_LABEL, insightsOf, type AssessmentRow, type Filters } from './assessmentModel';

const INK = '#586472';
const GRID = '#e1e6eb';
const HOVER = '#f3f6f8';
const TIP = { fontSize: 12, border: '1px solid #e1e6eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)', color: '#1f2933' };
const AXIS = { fontSize: 12, fill: INK };

export interface InsightsProps {
  rows: readonly AssessmentRow[];
  /** show the assessments behind a figure in the list: the filter to add */
  onDrill: (patch: Partial<Filters>) => void;
  /** the owners, to turn a name into the id the filter holds */
  ownerIdOf: (name: string) => string | null;
}

export function InsightsView({ rows, onDrill, ownerIdOf }: InsightsProps) {
  const ins = insightsOf(rows);
  const total = ins.total;
  const empty = (words: string) => <p className="m-0 text-ds-body text-ds-fg-muted">{words}</p>;
  const answeredPct = ins.questions > 0 ? Math.round((ins.questionsDone / ins.questions) * 100) : null;
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Assessments" value={formatCount(total)} note={`${formatCount(ins.manual)} manual · ${formatCount(ins.framework)} framework`} />
        <StatTile label="Risks assessed" value={ins.manual ? formatCount(ins.risksAssessed) : null} info="No manual assessment in this view." note={ins.manual ? `${ins.risksPerAssessment} per assessment on average` : undefined} />
        <StatTile label="Questions answered" value={ins.framework ? formatCount(ins.questionsDone) : null} info="No framework assessment in this view." unit={ins.framework ? `of ${formatCount(ins.questions)}` : undefined} progress={answeredPct} note={ins.framework ? `${ins.questionsPerAssessment} questions per assessment on average` : undefined} />
        <StatTile label="Blocked questions" value={ins.framework ? formatCount(ins.blocked) : null} info="No framework assessment in this view." tone={ins.blocked > 0 ? 'danger' : 'default'} note={ins.framework ? `${formatPercent(ins.questions ? (ins.blocked / ins.questions) * 100 : 0)} of the questions` : undefined} />
      </div>

      <div className="grid gap-[16px] lg:grid-cols-2">
        <SectionCard id="stages" title="By stage" info="Manual assessments in their own five stages; a framework assessment that is completed counts as approved, an archived one as closed. Press a stage to see its assessments." meta={`${formatCount(total)} assessments`}>
          <div className="flex flex-col">
            {STAGES.map((s) => (
              <BarRow key={s} label={STAGE_LABEL[s]} value={ins.byStage[s]} total={total} color={TONE[assessmentStatus.tone(s)].dot} hint={`Show the ${STAGE_LABEL[s].toLowerCase()} assessments`} onPress={ins.byStage[s] > 0 ? () => onDrill({ status: [s] }) : undefined} />
            ))}
          </div>
        </SectionCard>

        <SectionCard id="created" title="Created each month" info="Assessments created in each of the last twelve months, of the kind and stage shown.">
          <ChartFrame title="Assessments created each month" height={200} data={{ columns: ['Month', 'Assessments'], rows: ins.trend.map((t) => [t.month, t.count]) }}>
            {(focusOff) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ins.trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} {...focusOff}>
                  <CartesianGrid stroke={GRID} strokeDasharray="2 2" vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} interval={1} tickFormatter={(m: string) => m.slice(0, 3)} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} width={28} tick={AXIS} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: HOVER }} contentStyle={TIP} />
                  <Bar dataKey="count" name="Created" fill={TONE.progress.dot} isAnimationActive={false} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </SectionCard>

        <SectionCard id="owners" title="Who leads them" info="A manual assessment's lead assessor, a framework assessment's creator. Press a name to see their assessments." meta={`${ins.byOwner.length} ${ins.byOwner.length === 1 ? 'person' : 'people'}`}>
          {ins.byOwner.length === 0 ? empty('Nothing in this view.') : (
            <div className="flex flex-col">
              {ins.byOwner.map((o) => {
                const id = o.label === 'Unassigned' ? 'none' : ownerIdOf(o.label);
                return <BarRow key={o.label} label={o.label} value={o.count} total={total} color={TONE.progress.dot} hint={`Show ${o.label}'s assessments`} onPress={id ? () => onDrill({ owner: [id] }) : undefined} />;
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard id="frameworks" title="Frameworks" info="The framework each framework assessment is built on. Press one to see its assessments." meta={`${ins.byFramework.length} ${ins.byFramework.length === 1 ? 'framework' : 'frameworks'}`}>
          {ins.byFramework.length === 0 ? empty('No framework assessment in this view.') : (
            <div className="flex flex-col">
              {ins.byFramework.map((f) => <BarRow key={f.label} label={f.label} value={f.count} total={ins.framework} color={TONE.pending.dot} hint={`Show the ${f.label} assessments`} onPress={f.label === 'Not set' ? undefined : () => onDrill({ framework: [f.label] })} />)}
            </div>
          )}
        </SectionCard>

        <SectionCard id="types" title="Manual assessments by type" info="How often each is run." meta={`${formatCount(ins.manual)} manual`}>
          {ins.byType.length === 0 ? empty('No manual assessment in this view.') : (
            <div className="flex flex-col">{ins.byType.map((t) => <BarRow key={t.label} label={t.label.replace(/^./, (c) => c.toUpperCase())} value={t.count} total={ins.manual} color={TONE.neutral.dot} />)}</div>
          )}
        </SectionCard>

        <SectionCard id="methods" title="Manual assessments by method" info="Qualitative, quantitative or semi-quantitative." meta={`${formatCount(ins.manual)} manual`}>
          {ins.byMethodology.length === 0 ? empty('No manual assessment in this view.') : (
            <div className="flex flex-col">{ins.byMethodology.map((t) => <BarRow key={t.label} label={t.label.replace(/^./, (c) => c.toUpperCase())} value={t.count} total={ins.manual} color={TONE.neutral.dot} />)}</div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
