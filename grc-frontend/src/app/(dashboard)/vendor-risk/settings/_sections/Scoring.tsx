'use client';

// Settings > Questionnaire scoring: what a Partial answer is worth. Yes counts in full and No counts nothing. It is fixed into a questionnaire when it is sent, so a change here never rescores answers
// already given.
import { SectionCard, TextInput } from '@/components/ui/ds';
import { Help, Row } from '../_ui';
import { DefaultsButton, NEEDS_RIGHT, type SettingsCtx } from './shared';

export default function ScoringSection({ ctx }: { ctx: SettingsCtx }) {
  const { draft, canEdit, set } = ctx;
  const pct = Math.round(draft.scoring_policy.partial_credit * 100);
  return (
    <SectionCard id="scoring" title="Questionnaire scoring" meta={`A Partial answer is worth ${pct}% of a Yes`} actions={<DefaultsButton ctx={ctx} keys={['scoring_policy']} />}>
      <Help>Yes counts in full and No counts nothing; this sets what a Partial answer is worth. It is fixed into a questionnaire when it is sent, so a change here never rescores answers already given.</Help>
      <Row label="A Partial answer is worth" htmlFor="s-partial">
        <TextInput id="s-partial" type="number" min={0} max={100} unit="% of a Yes" className="!w-[170px]" disabled={!canEdit} value={pct}
          onChange={(e) => set('scoring_policy', { partial_credit: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })} />
      </Row>
      {!canEdit && <p className="mt-[8px] text-ds-label text-ds-fg-muted">{NEEDS_RIGHT}</p>}
    </SectionCard>
  );
}
