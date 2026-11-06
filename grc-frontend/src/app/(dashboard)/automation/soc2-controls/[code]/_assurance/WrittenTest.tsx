'use client';

// One automated test, written out as a procedure: what it signs in with, what it reads, the rule it applies,
// what a failure means, what it keeps, how it reaches the control and what it last found. The steps come from
// the server, generated from the check's own definition, so what is written here is what actually runs.

import { ControlStatusPill } from '@/components/soc2/ui';

export interface WrittenStep { label: string; text: string; code?: string | null }

export interface TestExplanation {
  checks: string;
  rule: string | null;
  reads: string;
  call: string | null;
  fields: string[];
  fails_when: string | null;
  excludes: string | null;
  when_empty: string | null;
  /** The test in the order it happens. */
  steps?: WrittenStep[];
  /** Why the test matters and how to fix a failure (the built-in AWS checks carry both). */
  why?: string | null;
  fix?: string | null;
}

export interface TestResult {
  status: string;
  detail: string | null;
  population: number | null;
  tested: number | null;
  failing_items: string[];
  checked_at: string | null;
}

/** How a test reaches a control: the objectives it covers, or the SOC 2 criteria it goes through. */
export interface TestReach { binding?: string | null; covers?: string[]; soc2?: string[] }

// A finding's word → the status vocabulary the pills use.
export const RESULT_STATUS: Record<string, string> = {
  pass: 'passed', fail: 'failed', error: 'collection_failed', not_run: 'not_run', not_applicable: 'not_run',
};

// The reassessment windows SCF ships; a result older than its window stops being evidence.
const WINDOW_DAYS: Record<string, number> = { Quarterly: 90, 'Semi-Annual': 180, Annual: 365 };

export const when = (iso?: string | null) =>
  (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);

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
  /** What the test last found; only when its source is connected. */
  result?: TestResult | null;
  /** How it reaches the control, as `reachOf` words it. */
  reach?: string | null;
  /** The control's reassessment cadence. */
  cadence?: string | null;
}) {
  const steps = e.steps ?? [];
  const days = WINDOW_DAYS[cadence || ''] ?? 365;
  const extra: [string, string][] = [
    ...(reach ? [['Reaches this control', reach] as [string, string]] : []),
    ...(e.why ? [['Why it matters', e.why] as [string, string]] : []),
    ...(e.fix ? [['How to fix a failure', e.fix] as [string, string]] : []),
    ['Stays current', `${days} days, this control’s ${cadence || 'Annual'} reassessment window. Run it again at any time.`],
  ];
  return (
    <div className="space-y-3">
      {steps.length ? (
        <ol className="space-y-1.5">
          {steps.map((s, i) => (
            <li key={`${s.label}-${i}`} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 text-[12px] leading-relaxed sm:grid-cols-[1.25rem_8rem_minmax(0,1fr)]">
              <span className="tabular-nums text-slate-500" aria-hidden="true">{i + 1}.</span>
              <span className="font-semibold text-slate-700">{s.label}</span>
              <span className="col-start-2 min-w-0 text-slate-700 sm:col-start-3">
                {s.text}
                {s.code && <code className="mt-1 block w-fit max-w-full break-all rounded bg-[#eef1f4] px-1.5 py-0.5 font-mono text-[11px] text-slate-800">{s.code}</code>}
              </span>
            </li>
          ))}
        </ol>
      ) : <p className="text-[12px] leading-relaxed text-slate-700">{e.checks}</p>}

      <dl className="grid gap-x-3 gap-y-1 border-t border-slate-100 pt-2.5 text-[12px] leading-relaxed sm:grid-cols-[9.5rem_minmax(0,1fr)]">
        {extra.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold text-slate-700">{k}</dt>
            <dd className="min-w-0 text-slate-700">{v}</dd>
          </div>
        ))}
      </dl>

      {r && (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Last result</span>
            <ControlStatusPill status={RESULT_STATUS[r.status] || 'not_run'} />
            {when(r.checked_at) && <span className="text-[11.5px] text-slate-600">{when(r.checked_at)}</span>}
            {r.tested != null && r.population != null && <span className="text-[11.5px] text-slate-600">{r.tested} of {r.population} tested</span>}
          </div>
          {r.failing_items.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="text-[11.5px] font-medium text-slate-700">Failing now:</span>
              {r.failing_items.map((item) => <span key={item} className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[11px] text-rose-700">{item}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
