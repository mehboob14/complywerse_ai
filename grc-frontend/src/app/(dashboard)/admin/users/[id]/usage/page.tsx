'use client';

// Administration > Users > one person's AI usage: how much AI the person used in the last 7, 30 or 90 days, by area, and the last hundred uses. Reads
// GET /admin/ai-usage/users/{id} (admin:users:view). The page says "AI", never the model that answered, and uses the areas' own names, not their internal keys. The export is
// the same CSV as before (it carries the technical columns for whoever audits it; the screen does not).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { adminApi, type AIUsageBreakdown, type AIUsageEvent, type AIUsageSummary } from '@/lib/api';
import { formatCount, formatDateTime } from '@/lib/format';
import { Button, EmptyState, ErrorState, NoAccessState, RegisterTable, Select, StatTile, useNotify, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';

type Labelled<T> = T & { module_label?: string; feature_label?: string };
interface Usage { user: { id: number; username: string; display_name: string | null; email: string }; summary: AIUsageSummary; modules: Labelled<AIUsageBreakdown>[]; recent: Labelled<AIUsageEvent>[] }

const RANGES = [{ days: 7, label: 'Last 7 days' }, { days: 30, label: 'Last 30 days' }, { days: 90, label: 'Last 90 days' }];
const area = (r: { module_label?: string; module_key: string }) => r.module_label || r.module_key;
const feature = (r: { feature_label?: string; feature_key: string }) => r.feature_label || r.feature_key;
const num = (n: number) => <span className="tabular-nums">{formatCount(n)}</span>;

const sinceOf = (days: number): string => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString(); };

export default function UserAIUsagePage({ params }: { params: { id: string } }) {
  const userId = Number(params.id);
  const notify = useNotify();
  const [days, setDays] = useState(30);
  const [exporting, setExporting] = useState(false);
  const q = useQuery({
    queryKey: ['admin-user-ai-usage', userId, days],
    queryFn: async () => (await adminApi.getAIUsageForUser(userId, { date_from: sinceOf(days) })).data as unknown as Usage,
  });
  const data = q.data;
  const name = data ? (data.user.display_name || data.user.username) : 'AI usage';

  const exportCsv = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const response = await adminApi.exportAIUsage({ date_from: sinceOf(days), username: data.user.username });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${data.user.username}-ai-usage.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify.error(e, { title: "The export didn't download", fallback: 'Try again in a moment.' });
    } finally {
      setExporting(false);
    }
  };

  const byArea: RegisterColumn<Labelled<AIUsageBreakdown>>[] = [
    { key: 'area', header: 'Area', isRowHeader: true, cell: (r) => <span className="block min-w-0"><span className="font-[600] text-ds-fg">{area(r)}</span><span className="block text-ds-label text-ds-fg-muted">{feature(r)}</span></span> },
    { key: 'calls', header: 'Uses', align: 'right', width: 'w-[90px]', card: 'meta', cell: (r) => num(r.calls) },
    { key: 'in', header: 'Input', align: 'right', priority: 2, width: 'w-[110px]', card: 'meta', cell: (r) => num(r.prompt_tokens) },
    { key: 'out', header: 'Output', align: 'right', priority: 2, width: 'w-[110px]', card: 'meta', cell: (r) => num(r.completion_tokens) },
    { key: 'total', header: 'Total', align: 'right', width: 'w-[110px]', card: 'meta', cell: (r) => num(r.total_tokens) },
  ];
  const recent: RegisterColumn<Labelled<AIUsageEvent>>[] = [
    { key: 'when', header: 'When', isRowHeader: true, width: 'w-[180px]', cell: (e) => <span className="text-ds-body text-ds-fg">{formatDateTime(e.occurred_at)}</span> },
    { key: 'what', header: 'Used for', card: 'meta', cell: (e) => <span>{area(e)} · {feature(e)}</span> },
    { key: 'tokens', header: 'Tokens', align: 'right', width: 'w-[110px]', card: 'meta', cell: (e) => num(e.total_tokens) },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-[16px] pb-[24px]">
      <PageHeader
        variant="page"
        title={name}
        back={{ href: '/admin/users', label: 'Back to users' }}
        meta="AI usage"
        actions={(
          <>
            <Select aria-label="Period" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-[160px]">
              {RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
            </Select>
            <Button leftIcon={<Download aria-hidden />} loading={exporting} disabled={!data} onClick={() => { void exportCsv(); }}>Export</Button>
          </>
        )}
      />

      {q.isError && !data ? (
        statusOf(q.error) === 403
          ? <NoAccessState title="You can't see this person's AI usage" reason="That needs the users right." />
          : <ErrorState title="Couldn't load the AI usage" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-[12px] md:grid-cols-4">
            <StatTile label="Total tokens" value={data ? formatCount(data.summary.total_tokens) : null} loading={q.isLoading} info="Everything the AI read and wrote for this person in the period." />
            <StatTile label="Input tokens" value={data ? formatCount(data.summary.prompt_tokens) : null} loading={q.isLoading} />
            <StatTile label="Output tokens" value={data ? formatCount(data.summary.completion_tokens) : null} loading={q.isLoading} />
            <StatTile label="AI uses" value={data ? formatCount(data.summary.calls) : null} loading={q.isLoading} />
          </div>

          <section aria-labelledby="usage-by-area" className="flex flex-col gap-[8px]">
            <h2 id="usage-by-area" className="!text-ds-section !text-ds-fg">By area</h2>
            <RegisterTable
              caption="AI usage by area" columns={byArea} rows={data?.modules ?? []} getRowId={(r) => `${r.module_key}.${r.feature_key}`} loading={q.isLoading} loadingRows={3}
              empty={<EmptyState bare kind="firstUse" title="No AI use in this period" description="Pick a longer period to look further back." />}
              cardTitle={(r) => <span className="block min-w-0"><span className="block break-words">{area(r)}</span><span className="block text-ds-label font-normal text-ds-fg-muted">{feature(r)}</span></span>}
            />
          </section>

          <section aria-labelledby="usage-recent" className="flex flex-col gap-[8px]">
            <h2 id="usage-recent" className="!text-ds-section !text-ds-fg">Recent AI activity</h2>
            <RegisterTable
              caption="Recent AI activity" columns={recent} rows={data?.recent ?? []} getRowId={(e) => e.id} loading={q.isLoading} loadingRows={4}
              empty={<EmptyState bare kind="firstUse" title="Nothing yet" description="The last hundred uses show here." />}
              cardTitle={(e) => <span className="block">{formatDateTime(e.occurred_at)}</span>}
              footer={data && data.recent.length >= 100 ? <p className="text-ds-label text-ds-fg-muted">The last 100 uses are shown. Export for the rest.</p> : undefined}
            />
          </section>
        </>
      )}
    </div>
  );
}
