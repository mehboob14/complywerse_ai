'use client';

// AI governance > Activity: every AI call, newest first, narrowed by module, outcome, person or a word (feature or page), 50 to a page; a row opens the call in a Sheet.
// The filters are the server's (/admin/ai-governance/activity); a late answer for an older filter never replaces a newer one (the query is keyed by the filter). The model that
// answered is not shown: a person reads what was done and what was protected, not which engine did it.
import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { aiCall } from '@/lib/statuses/adminAuditAi';
import { Button, DebouncedSearch, EmptyState, Pager, RegisterTable, Select, StatusPill, TextInput, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { fmtDuration, fmtNumber, fmtTokens, fmtUsd, fmtWhen } from './format';
import type { CallRow } from './types';

const PAGE = 50;
const OUTCOMES = [
  { value: '', label: 'Any outcome' },
  { value: 'success', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'blocked', label: 'Blocked' },
];
const NOUN = { one: 'call', other: 'calls' } as const;

export default function ActivityTab({
  days, useCase, onUseCaseChange, modules, onOpen,
}: {
  days: number;
  useCase: string;
  onUseCaseChange: (id: string) => void;
  modules: Array<{ module: string; label: string }>;
  onOpen: (id: number) => void;
}) {
  const [module, setModule] = useState('');
  const [status, setStatus] = useState('');
  const [username, setUsername] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [days, module, status, username, q, useCase]);

  const params: Record<string, string | number> = { days, skip: (page - 1) * PAGE, limit: PAGE };
  if (module) params.module = module;
  if (status) params.status = status;
  if (username.trim()) params.username = username.trim();
  if (q.trim()) params.q = q.trim();
  if (useCase) params.use_case = useCase;
  const calls = useQuery({
    queryKey: ['ai-governance-calls', JSON.stringify(params)],
    queryFn: async ({ signal }) => (await apiClient.get<{ total: number; items: CallRow[] }>('/admin/ai-governance/activity', { params, signal })).data,
    placeholderData: keepPreviousData,
  });
  const rows = calls.data?.items ?? [];
  const total = calls.data?.total ?? 0;
  const narrowed = !!(module || status || username.trim() || q.trim() || useCase);
  const clear = () => { setModule(''); setStatus(''); setUsername(''); setQ(''); onUseCaseChange(''); };

  const columns: RegisterColumn<CallRow>[] = [
    { key: 'when', header: 'When', card: 'meta', cell: (r) => <span className="whitespace-nowrap">{fmtWhen(r.at)}</span> },
    {
      key: 'feature', header: 'Feature', isRowHeader: true,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block font-[600] text-ds-fg">{r.use_case_label}</span>
          <span className="block text-ds-label text-ds-fg-muted">{r.module_label}{r.attempt > 1 ? ` · attempt ${r.attempt}` : ''}</span>
        </span>
      ),
    },
    { key: 'user', header: 'User', priority: 2, card: 'meta', cell: (r) => r.user },
    { key: 'outcome', header: 'Outcome', card: 'meta', cell: (r) => <StatusPill size="sm" {...statusPill(aiCall, r.status)} /> },
    { key: 'tokens', header: 'Tokens', align: 'right', priority: 2, card: 'meta', cell: (r) => <span className="tabular-nums">{fmtTokens(r.total_tokens)}</span> },
    { key: 'cost', header: 'Cost', align: 'right', priority: 3, cell: (r) => <span className="tabular-nums">{r.cost_usd == null ? '–' : fmtUsd(r.cost_usd)}</span> },
    {
      key: 'protected', header: 'Protected', align: 'right', priority: 3,
      cell: (r) => (r.entities ? <span className="inline-flex items-center gap-[4px] tabular-nums"><ShieldCheck size={13} aria-hidden className="text-ds-primary-text" />{fmtNumber(r.entities)}</span> : '–'),
    },
    { key: 'time', header: 'Took', align: 'right', priority: 3, cell: (r) => <span className="tabular-nums">{fmtDuration(r.duration_ms)}</span> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]" role="group" aria-label="Filter the calls">
        <Select aria-label="Module" className="w-[200px]" value={module} onChange={(e) => setModule(e.target.value)}>
          <option value="">All modules</option>
          {modules.map((m) => <option key={m.module} value={m.module}>{m.label}</option>)}
        </Select>
        <Select aria-label="Outcome" className="w-[170px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          {OUTCOMES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
        <TextInput aria-label="User" placeholder="Person" className="w-[160px]" value={username} onChange={(e) => setUsername(e.target.value)} />
        <DebouncedSearch label="Search the calls" placeholder="Feature or page" value={q} onSearch={setQ} loading={calls.isFetching} />
        {useCase && <Button size="sm" onClick={() => onUseCaseChange('')} aria-label="Stop narrowing to this feature">Feature: {useCase} ✕</Button>}
        {narrowed && <Button variant="link" onClick={clear}>Clear filters</Button>}
      </div>

      <RegisterTable
        caption="AI calls"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        onRowActivate={(r) => onOpen(r.id)}
        cardTitle={(r) => <span className="font-[600] text-ds-fg">{r.use_case_label}</span>}
        loading={calls.isLoading}
        error={calls.isError ? { message: errorMessage(calls.error, 'The calls could not be loaded.'), onRetry: canRetry(calls.error) ? () => { void calls.refetch(); } : undefined } : null}
        empty={<EmptyState bare kind={narrowed ? 'noMatches' : 'firstUse'} title={narrowed ? 'No call matches' : 'No AI calls in this period'} onClearFilters={narrowed ? clear : undefined} />}
        footer={calls.data && total > 0 ? <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} noun={NOUN} /> : undefined}
      />
    </div>
  );
}
