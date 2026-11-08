'use client';

// One automated test, written out as a procedure: what it signs in with, what it reads, the rule it applies, what a failure means, what it keeps, how it reaches the control and what it last
// found. The steps come from the server, generated from the check's own definition, so what is written here is what actually runs. The technical lines (the call, the fields) sit behind
// "Technical details": an auditor wants them, a control owner does not.
import { useState } from 'react';
import { Button, StatusPill } from '@/components/ui/ds';
import { formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { checkResult } from '@/lib/statuses/controls';
import type { ProviderTest, TestExplanation, TestReach } from './types';
import { Small } from './parts';

/** The word of a finding in the registry's vocabulary: the server writes pass / fail / error / not_run. */
export const resultWord = (status: string | undefined | null): string => (status === 'pass' || status === 'fail' || status === 'error' || status === 'not_run' ? status : 'not_run');

// The reassessment windows SCF ships; a result older than its window stops being evidence.
const WINDOW_DAYS: Record<string, number> = { Quarterly: 90, 'Semi-Annual': 180, Annual: 365 };

/** In a sentence, how this test reaches the control. A SOC 2 criterion is a broad match and says so. */
export function reachOf(t: TestReach, controlCriteria: string[] = []): string | null {
  if (t.binding === 'covers' && t.covers?.length) {
    const objectives = t.covers.filter((c) => c.includes('_A'));
    const whole = objectives.length < t.covers.length;
    return `Written for ${objectives.length ? `objective${objectives.length === 1 ? '' : 's'} ${objectives.join(', ')}${whole ? ' and ' : ''}` : ''}${whole ? 'this control as a whole' : ''}.`;
  }
  const criteria = (t.soc2 ?? []).filter((c) => !controlCriteria.length || controlCriteria.includes(c));
  return criteria.length ? `Through SOC 2 ${criteria.join(', ')}. That is a broad match, so it may test only part of this control.` : null;
}

export function WrittenTest({ explain: e, result: r, reach, cadence }: {
  explain: TestExplanation;
  /** what the test last found; only when its source is connected */
  result?: ProviderTest['result'];
  reach?: string | null;
  cadence?: string | null;
}) {
  const [tech, setTech] = useState(false);
  const steps = e.steps ?? [];
  const days = WINDOW_DAYS[cadence || ''] ?? 365;
  const extra: [string, string][] = [
    ...(reach ? [['Reaches this control', reach] as [string, string]] : []),
    ...(e.why ? [['Why it matters', e.why] as [string, string]] : []),
    ...(e.fix ? [['How to fix a failure', e.fix] as [string, string]] : []),
    ['Stays current', `${days} days, this control’s ${cadence || 'Annual'} reassessment window. Run it again at any time.`],
  ];
  const technical = steps.filter((s) => s.code);
  return (
    <div className="flex flex-col gap-[12px]">
      {steps.length ? (
        <ol className="flex flex-col gap-[6px]">
          {steps.map((s, i) => (
            <li key={`${s.label}-${i}`} className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-[8px] text-ds-body sm:grid-cols-[20px_128px_minmax(0,1fr)]">
              <span className="tabular-nums text-ds-fg-muted" aria-hidden="true">{i + 1}.</span>
              <span className="font-[600] text-ds-fg">{s.label}</span>
              <span className="col-start-2 min-w-0 text-ds-fg-body [overflow-wrap:anywhere] sm:col-start-3">
                {s.text}
                {tech && s.code && <code className="mt-[4px] block w-fit max-w-full break-all rounded-ds-control bg-ds-surface-hover px-[6px] py-[2px] font-mono text-ds-label text-ds-fg">{s.code}</code>}
              </span>
            </li>
          ))}
        </ol>
      ) : <p className="text-ds-body text-ds-fg-body">{e.checks}</p>}
      {technical.length > 0 && <div><Button variant="link" size="sm" className="-ml-[8px]" aria-expanded={tech} onClick={() => setTech(!tech)}>{tech ? 'Hide technical details' : 'Technical details'}</Button></div>}

      <dl className="grid gap-x-[12px] gap-y-[4px] border-t border-ds-border pt-[10px] text-ds-body sm:grid-cols-[152px_minmax(0,1fr)]">
        {extra.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-[600] text-ds-fg">{k}</dt>
            <dd className="min-w-0 text-ds-fg-body [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>

      {r && (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[8px]">
          <div className="flex flex-wrap items-center gap-[8px]">
            <span className="text-ds-label font-[600] text-ds-fg-muted">Last result</span>
            <StatusPill size="sm" {...statusPill(checkResult, resultWord(r.status))} />
            {r.checked_at && <Small>{formatDateTime(r.checked_at)}</Small>}
            {r.tested != null && r.population != null && <Small>{`${r.tested} of ${r.population} tested`}</Small>}
          </div>
          {r.failing_items.length > 0 && (
            <div className="mt-[6px] flex flex-wrap items-center gap-[4px]">
              <span className="text-ds-label font-[600] text-ds-fg">Failing now:</span>
              {r.failing_items.map((item) => <span key={item} className="rounded-ds-control bg-ds-danger-soft px-[6px] py-[1px] font-mono text-ds-label text-ds-danger [overflow-wrap:anywhere]">{item}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
