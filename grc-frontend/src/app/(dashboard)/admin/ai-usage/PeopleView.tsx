'use client';

// AI usage > By person: how much AI each person has used (the same ledger as Tokens, grouped by who asked), and one person's use opened in a Sheet: their totals, the
// modules and features they used, and their latest calls. A link to a person (?view=people&person=12) opens that sheet, so the Tokens view's "Heaviest users" and the
// user list can point here. The model that answered is never shown: a person reads what was done, not which engine did it.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { adminApi, type AIUsageBreakdown, type AIUsageEvent, type AIUsageSummary } from '@/lib/api';
import { formatCount, formatDateTime, statusLabel } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { aiCall } from '@/lib/statuses/adminAuditAi';
import { Button, EmptyState, ErrorState, Fact, FactList, PersonChip, RegisterTable, Select, Sheet, SkeletonLines, StatusPill, useNotify, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { fmtTokens, money, PERSON_DAYS } from './usageModel';

interface PersonRow { user_id?: number | null; username: string; calls: number; total_tokens: number; estimated_cost: number }
interface PersonDetail { user: { id?: number; username: string; display_name?: string | null; email?: string | null }; summary: AIUsageSummary; modules: AIUsageBreakdown[]; recent: AIUsageEvent[] }

const since = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString(); };
const cost = (n: number) => (n > 0 ? money(n, { fine: true }) : '—');
const place = (module: string, feature: string) => `${statusLabel(module)} · ${statusLabel(feature)}`;

function PersonSheet({ id, days, onClose }: { id: number | null; days: number; onClose: () => void }) {
  const notify = useNotify();
  const [exporting, setExporting] = useState(false);
  const detail = useQuery({
    queryKey: ['admin-ai-usage-person', id, days],
    enabled: id != null,
    queryFn: async () => (await adminApi.getAIUsageForUser(id as number, { date_from: since(days) })).data as PersonDetail,
  });
  const d = detail.data;
  const exportCsv = async () => {
    if (!d) return;
    setExporting(true);
    try {
      const res = await adminApi.exportAIUsage({ date_from: since(days), username: d.user.username });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${d.user.username}-ai-usage.csv`; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify.success('The usage was saved as a spreadsheet');
    } catch (e) {
      notify.error(e, { title: 'The export did not finish', fallback: 'Nothing was saved. Try again.', retry: canRetry(e) ? () => { void exportCsv(); } : undefined });
    } finally {
      setExporting(false);
    }
  };
  const modules: RegisterColumn<AIUsageBreakdown>[] = [
    { key: 'where', header: 'Where', isRowHeader: true, cell: (m) => place(m.module_key, m.feature_key) },
    { key: 'calls', header: 'AI calls', align: 'right', card: 'meta', cell: (m) => formatCount(m.calls) },
    { key: 'in', header: 'Sent', align: 'right', priority: 2, card: 'meta', cell: (m) => fmtTokens(m.prompt_tokens) },
    { key: 'out', header: 'Returned', align: 'right', priority: 2, card: 'meta', cell: (m) => fmtTokens(m.completion_tokens) },
    { key: 'total', header: 'Tokens', align: 'right', card: 'meta', cell: (m) => fmtTokens(m.total_tokens) },
  ];
  const recent: RegisterColumn<AIUsageEvent>[] = [
    { key: 'when', header: 'When', card: 'meta', cell: (e) => <span className="whitespace-nowrap">{formatDateTime(e.occurred_at)}</span> },
    { key: 'where', header: 'Where', isRowHeader: true, cell: (e) => place(e.module_key, e.feature_key) },
    { key: 'result', header: 'Result', card: 'meta', cell: (e) => <StatusPill size="sm" {...statusPill(aiCall, e.status)} /> },
    { key: 'tokens', header: 'Tokens', align: 'right', card: 'meta', cell: (e) => fmtTokens(e.total_tokens) },
  ];
  return (
    <Sheet
      open={id != null}
      onClose={onClose}
      width="lg"
      title={d ? (d.user.display_name || d.user.username) : 'AI use'}
      subtitle={d ? `Last ${days} days` : undefined}
      actions={d ? <Button size="sm" leftIcon={<Download aria-hidden />} loading={exporting} onClick={() => { void exportCsv(); }}>Export</Button> : undefined}
    >
      {detail.isError ? (
        <ErrorState title="Couldn't open this person's use" message={errorMessage(detail.error)} onRetry={canRetry(detail.error) ? () => { void detail.refetch(); } : undefined} />
      ) : !d ? (
        <SkeletonLines lines={6} label="Loading this person's AI use" />
      ) : (
        <div className="flex flex-col gap-[16px]">
          <FactList variant="boxed">
            <Fact label="AI calls">{formatCount(d.summary.calls)}</Fact>
            <Fact label="Tokens used">{formatCount(d.summary.total_tokens)}</Fact>
            <Fact label="Sent">{formatCount(d.summary.prompt_tokens)}</Fact>
            <Fact label="Returned">{formatCount(d.summary.completion_tokens)}</Fact>
          </FactList>
          <section aria-labelledby="person-modules-h">
            <h3 id="person-modules-h" className="m-0 mb-[8px] !text-ds-section !text-ds-fg">Where it was used</h3>
            <RegisterTable caption="AI use by module and feature" columns={modules} rows={d.modules} getRowId={(m) => `${m.module_key}.${m.feature_key}`} cardTitle={(m) => place(m.module_key, m.feature_key)}
              empty={<EmptyState bare kind="firstUse" title="No AI use in this period" />} />
          </section>
          <section aria-labelledby="person-recent-h">
            <h3 id="person-recent-h" className="m-0 mb-[8px] !text-ds-section !text-ds-fg">Latest calls</h3>
            <RegisterTable caption="Latest AI calls" columns={recent} rows={d.recent} getRowId={(e) => e.id} cardTitle={(e) => place(e.module_key, e.feature_key)}
              empty={<EmptyState bare kind="firstUse" title="No calls in this period" />}
              footer={d.recent.length >= 100 ? <span className="text-ds-label text-ds-fg-muted">The latest 100 calls are listed. Export for all of them.</span> : undefined} />
          </section>
        </div>
      )}
    </Sheet>
  );
}

export function PeopleView({ person, onPerson }: { person: string; onPerson: (id: string) => void }) {
  const [days, setDays] = useState<number>(30);
  const list = useQuery({
    queryKey: ['admin-ai-usage-by-person', days],
    queryFn: async () => (await adminApi.getAIUsageByUser({ date_from: since(days) })).data as PersonRow[],
  });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const openId = Number(person);
  if (statusOf(list.error) === 403) return <EmptyState kind="firstUse" title="You can't see AI use by person" description="Ask an administrator for the users view right." />;
  const columns: RegisterColumn<PersonRow>[] = [
    { key: 'person', header: 'Person', isRowHeader: true, cell: (r) => <PersonChip name={r.username} emptyLabel="System" /> },
    { key: 'calls', header: 'AI calls', align: 'right', card: 'meta', cell: (r) => formatCount(r.calls) },
    { key: 'tokens', header: 'Tokens', align: 'right', card: 'meta', cell: (r) => fmtTokens(r.total_tokens) },
    { key: 'cost', header: 'Estimated cost', align: 'right', priority: 2, card: 'meta', cell: (r) => cost(r.estimated_cost) },
  ];
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <Select aria-label="Period" className="w-[160px]" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          {PERSON_DAYS.map((n) => <option key={n} value={n}>Last {n} days</option>)}
        </Select>
        {list.data && <span className="text-ds-body text-ds-fg-muted">{formatCount(rows.length)} {rows.length === 1 ? 'person' : 'people'}</span>}
      </div>
      <RegisterTable
        caption="AI use by person"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.user_id ?? `name-${r.username}`}
        selectedId={Number.isInteger(openId) && openId > 0 ? openId : null}
        onRowActivate={(r) => { if (r.user_id) onPerson(String(r.user_id)); }}
        cardTitle={(r) => <PersonChip name={r.username} emptyLabel="System" />}
        loading={list.isLoading}
        error={list.isError ? { message: errorMessage(list.error, 'The list could not be loaded.'), onRetry: canRetry(list.error) ? () => { void list.refetch(); } : undefined } : null}
        empty={<EmptyState bare kind="firstUse" title="No one has used AI in this period" description="Pick a longer period." />}
      />
      <PersonSheet id={Number.isInteger(openId) && openId > 0 ? openId : null} days={days} onClose={() => onPerson('')} />
    </div>
  );
}
