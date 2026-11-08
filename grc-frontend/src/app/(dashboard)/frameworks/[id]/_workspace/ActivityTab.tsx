'use client';

// Activity: the permanent record of the journey (snapshots) and what happened lately. A snapshot keeps today's compliance as it stands and adds a
// point to the trend; two snapshots can be read side by side by the change shown on each row.
import { Camera } from 'lucide-react';
import { AccordionRow, Button, EmptyState, ErrorState, SectionCard, SkeletonRows } from '@/components/ui/ds';
import LabelledBar from './LabelledBar';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import { formatCount, formatDateTime } from '@/lib/format';
import type { ActivityItem } from '@/lib/journeyModel';
import RecentActivity from './RecentActivity';
import { useCaptureSnapshot } from './useJourneyActions';

interface Snapshot {
  id: number; year: number | null; label: string | null; captured_at: string | null; overall_pct: number; compliant_count: number; total_count: number;
  breakdown: { tiers?: Record<string, { total: number; compliant: number; avg: number }>; domains?: Array<{ domain: string; total: number; compliant: number; avg: number }> };
  notes: string | null;
}

interface Props {
  journeyId: number;
  snapshots: Snapshot[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  activity: ActivityItem[];
  scopeFailed: boolean;
  goTab: (tab: string) => void;
}

export default function ActivityTab({ journeyId, snapshots, loading, error, onRetry, activity, scopeFailed, goTab }: Props) {
  const capture = useCaptureSnapshot(journeyId);
  const list = snapshots || [];
  return (
    <div className="space-y-[16px]">
      <SectionCard
        id="snapshots"
        title="Snapshots"
        meta={loading || error ? undefined : `${formatCount(list.length)} kept`}
        info="A snapshot keeps today's compliance as a permanent record, for the yearly assessment, and adds a point to the trend."
        actions={<Button variant="primary" leftIcon={<Camera aria-hidden />} loading={capture.isPending} onClick={() => capture.mutate()}>Capture snapshot</Button>}
      >
        {loading ? (
          <SkeletonRows rows={3} />
        ) : error ? (
          <ErrorState compact title="Couldn't load the snapshots" message={safeDetail(apiErrorText(error, 'Please try again.'))} onRetry={onRetry} />
        ) : list.length === 0 ? (
          <EmptyState kind="firstUse" bare title="No snapshot yet" description="Capture one to keep this year's compliance as a permanent record." />
        ) : (
          <ul className="space-y-[8px]">
            {list.map((s, i) => {
              const older = list[i + 1];
              const change = older ? Math.round((s.overall_pct - older.overall_pct) * 10) / 10 : null;
              const tiers = s.breakdown?.tiers || {};
              const domains = s.breakdown?.domains || [];
              const scored = s.total_count > 0;
              return (
                <li key={s.id}>
                  <AccordionRow
                    level={3}
                    region={false}
                    title={s.label || (s.year ? String(s.year) : 'Snapshot')}
                    meta={`${formatDateTime(s.captured_at)}${change !== null && scored ? ` · ${change > 0 ? '+' : ''}${change} points since the one before` : ''}`}
                    trailing={scored ? <span className="tabular-nums text-ds-fg">{s.overall_pct}% · {s.compliant_count} of {s.total_count}</span> : <span className="text-ds-fg-muted">No score</span>}
                  >
                    {!scored ? (
                      <p className="text-ds-body text-ds-fg-muted">This framework has no tiered requirements, so there is no score to keep in a snapshot. The moment is on the trend.</p>
                    ) : (
                      <div className="space-y-[12px]">
                        <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-3">
                          {(['P1', 'P2', 'P3'] as const).map((pl, k) => {
                            const t = tiers[pl] || { total: 0, compliant: 0, avg: 0 };
                            return (
                              <div key={pl} className="rounded-ds-control border border-ds-border p-[8px]">
                                <LabelledBar label={`${pl} · Year ${k + 1}`} value={t.avg} valueText={`${t.avg}%`} />
                                <p className="mt-[4px] text-ds-label text-ds-fg-muted">{t.compliant} of {t.total} compliant</p>
                              </div>
                            );
                          })}
                        </div>
                        {domains.length > 0 && (
                          <ul className="space-y-[6px]">
                            {domains.map((d) => <li key={d.domain}><LabelledBar label={d.domain} value={d.avg} valueText={`${d.avg}% · ${d.compliant} of ${d.total}`} /></li>)}
                          </ul>
                        )}
                      </div>
                    )}
                  </AccordionRow>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
      <RecentActivity items={activity} scopeFailed={scopeFailed} goTab={goTab} />
    </div>
  );
}
