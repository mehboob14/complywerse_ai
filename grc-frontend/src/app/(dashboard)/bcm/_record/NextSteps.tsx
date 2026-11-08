'use client';

// "What needs doing" on the Overview tab of a plan or a drill: the lines recordModel.planNextSteps / drillNextSteps derive from the record's own figures, each with the one button that
// goes to the work (a tab, or the Edit form). With nothing to do it says so. The words are the model's: nothing here decides what is missing.
import { AlertTriangle, CheckCircle2, CircleDot } from 'lucide-react';
import { Button, SectionCard } from '@/components/ui/ds';
import type { NextStep } from './recordModel';

const TONE: Record<NextStep['tone'], string> = { danger: 'text-ds-danger', warning: 'text-ds-warning', neutral: 'text-ds-fg-muted' };

export function NextSteps({ steps, allClear, goLabel, onGo }: { steps: NextStep[]; allClear: string; goLabel: (go: NonNullable<NextStep['go']>) => string; onGo: (go: NonNullable<NextStep['go']>) => void }) {
  return (
    <SectionCard id="next" title="What needs doing" info="Worked out from this record's own figures. It is a prompt, not a rule: the server checks what a status or a closing needs.">
      {steps.length === 0 ? (
        <p className="m-0 flex items-center gap-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          {allClear}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {steps.map((n) => {
            const Icon = n.tone === 'neutral' ? CircleDot : AlertTriangle;
            return (
              <li key={n.key} className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] border-t border-ds-border py-[8px] first:border-t-0 first:pt-0 last:pb-0">
                <Icon aria-hidden className={`h-[16px] w-[16px] shrink-0 ${TONE[n.tone]}`} strokeWidth={1.75} />
                <span className="min-w-0 flex-1 basis-[16rem] break-words text-ds-body text-ds-fg">{n.text}</span>
                {n.go && <Button size="sm" onClick={() => onGo(n.go as NonNullable<NextStep['go']>)}>{goLabel(n.go)}</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
