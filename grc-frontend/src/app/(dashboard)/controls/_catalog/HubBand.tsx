'use client';

// The top of the By domain view and of a domain: the posture of the controls (how many are tested, how many of those are effective, a grade), what asks for attention, and the six figures.
// The numbers are catalogModel.ts (the formulas the page always had); this draws them. A figure is a word and a number, never a colour alone.
import { StatTile, StatusPill } from '@/components/ui/ds';
import { StatusBar } from '@/app/(dashboard)/automation/soc2-controls/_explorer/StatusBar';
import { formatCount } from '@/lib/format';
import { TONE } from '@/lib/status';
import { GRADE, deltaWords, kpisOf, postureOf, type AttentionKey, type BySource, type Trend, type WorkStats } from './catalogModel';

export function KpiTiles({ stats, trend }: { stats: WorkStats & { by_source?: BySource }; trend?: Trend | null }) {
  return (
    <div className="grid grid-cols-2 gap-[12px] md:grid-cols-3 xl:grid-cols-6">
      {kpisOf(stats, trend).map((k) => {
        const d = deltaWords(k.delta, k.goodUp);
        return (
          <StatTile
            key={k.key}
            label={k.label}
            value={k.value}
            tone={k.tone}
            note={(
              <>
                {k.hint}
                {d && <>{k.hint ? ' · ' : ''}<span className={d.good ? 'text-ds-success' : 'text-ds-danger'}>{`${d.text} since the last snapshot`}</span></>}
              </>
            )}
          />
        );
      })}
    </div>
  );
}

export function PostureBand({ stats, trend, onAttention }: { stats: WorkStats & { by_source?: BySource }; trend?: Trend | null; onAttention: (key: AttentionKey) => void }) {
  const p = postureOf(stats);
  const grade = GRADE[p.grade];
  const tested = deltaWords(trend?.tested, true);
  const legend = [
    { key: 'effective', label: 'Effective', value: p.effective, tone: 'success' as const },
    { key: 'partial', label: 'Partially effective', value: p.partial, tone: 'warning' as const },
    { key: 'ineffective', label: 'Ineffective', value: p.ineffective, tone: 'danger' as const },
    { key: 'not_tested', label: 'Not tested', value: p.notTested, tone: 'neutral' as const },
  ];
  return (
    <div className="grid grid-cols-1 gap-[12px] lg:grid-cols-[3fr_2fr]">
      <section aria-labelledby="posture-title" className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <h2 id="posture-title" className="m-0 !text-ds-section !text-ds-fg">Control assurance posture</h2>
          <StatusPill {...grade} />
          {tested && <span className={`text-ds-label ${tested.good ? 'text-ds-success' : 'text-ds-danger'}`}>{`tested ${tested.text} since the last snapshot`}</span>}
        </div>
        <p className="mb-0 mt-[8px] text-ds-body text-ds-fg-body">
          {p.tested === 0
            ? `None of your ${formatCount(p.total)} controls have been tested yet. Record tests to build assurance.`
            : `${formatCount(p.tested)} of ${formatCount(p.total)} controls tested · ${p.effPct}% of those effective${(stats.overdue ?? 0) > 0 ? ` · ${formatCount(stats.overdue)} overdue` : ''}.`}
        </p>
        <StatusBar className="mt-[12px]" label="Controls by effectiveness" total={Math.max(p.total, 1)} parts={legend.map((l) => ({ key: l.key, label: l.label, value: l.value, tone: l.tone }))} />
        <ul className="m-0 mt-[12px] flex list-none flex-wrap gap-x-[16px] gap-y-[4px] p-0">
          {legend.map((l) => (
            <li key={l.key} className="inline-flex items-center gap-[6px] text-ds-label text-ds-fg-body">
              <span aria-hidden className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: TONE[l.tone].dot }} />
              <b className="font-[600] tabular-nums text-ds-fg">{formatCount(l.value)}</b>
              {l.label}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="attention-title" className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
        <div className="flex items-center justify-between gap-[8px]">
          <h2 id="attention-title" className="m-0 !text-ds-section !text-ds-fg">Needs attention</h2>
          <span className="text-ds-label font-[600] tabular-nums text-ds-fg-body">{formatCount(p.attentionTotal)}</span>
        </div>
        <ul className="m-0 mt-[4px] list-none p-0">
          {p.attention.map((a) => (
            <li key={a.key} className="border-t border-ds-border first:border-t-0">
              <button
                type="button"
                disabled={a.n === 0}
                onClick={() => onAttention(a.key)}
                className="flex min-h-ds-control w-full items-center justify-between gap-[8px] rounded-ds-control px-[4px] text-left text-ds-body text-ds-fg-body focus-visible:outline-none focus-visible:shadow-ds-ring enabled:hover:bg-ds-surface-hover disabled:cursor-default"
              >
                <span className="inline-flex items-center gap-[8px]">
                  <span aria-hidden className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: a.n > 0 ? TONE[a.tone].dot : TONE.neutral.dot }} />
                  {a.label}
                </span>
                <span className={`tabular-nums ${a.n > 0 ? 'font-[600] text-ds-fg' : 'text-ds-fg-muted'}`}>{formatCount(a.n)}</span>
              </button>
            </li>
          ))}
        </ul>
        {p.attentionTotal === 0 && <p className="mb-0 mt-[8px] text-ds-label text-ds-success">Nothing needs attention right now.</p>}
      </section>
    </div>
  );
}
