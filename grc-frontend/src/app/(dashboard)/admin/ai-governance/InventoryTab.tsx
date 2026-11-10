'use client';

// AI governance > Features: everything in the product that can call AI, what it uses AI for and how its data is handled, by module. A search and three quick views. The
// facts on each row are chips with words (never colour alone): when the feature fires, how much data may leave, and what is limited, reused or not yet checked.
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { statusPill } from '@/lib/status';
import { protectionLevel } from '@/lib/statuses/adminAuditAi';
import { Button, EmptyState, FilterChips, SectionCard, StatusPill, TextInput, type FilterChip } from '@/components/ui/ds';
import { fmtNumber, fmtWhen } from './format';
import type { Inventory, UseCaseRow } from './types';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'own', label: 'Fire on their own' },
  { key: 'used', label: 'Used in this period' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

function Chip({ children, tone = 'neutral', title }: { children: React.ReactNode; tone?: 'neutral' | 'warning' | 'danger' | 'progress'; title?: string }) {
  const cls = { neutral: 'border-ds-border-strong text-ds-fg-body', warning: 'border-ds-warning text-ds-warning', danger: 'border-ds-danger-border text-ds-danger', progress: 'border-ds-primary text-ds-primary-text' }[tone];
  return <span title={title} className={`inline-flex items-center rounded-full border px-[8px] py-[1px] text-ds-label ${cls}`}>{children}</span>;
}

function Row({ u, onOpen }: { u: UseCaseRow; onOpen: (id: string) => void }) {
  return (
    <li className="px-[16px] py-[12px]">
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <div className="min-w-0 max-w-2xl">
          <div className="text-ds-body font-[600] text-ds-fg">{u.label}</div>
          <p className="m-0 mt-[2px] text-ds-body text-ds-fg-body">{u.value}</p>
          <p className="m-0 mt-[2px] text-ds-label text-ds-fg-muted">{u.surface}</p>
          <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
            <Chip tone={u.trigger === 'click' ? 'neutral' : 'warning'} title="When this feature calls AI">{u.trigger_label}</Chip>
            <span title={u.level_meaning}><StatusPill size="sm" {...statusPill(protectionLevel, u.level)} label={`${u.level} · ${u.level_meaning}`} /></span>
            {u.field_policy && <Chip tone="progress" title="Only the fields this feature needs are read from the record">Fields limited</Chip>}
            {u.cache_hours > 0 && <Chip tone="progress" title="Asked again exactly as before, the answer is reused instead of calling the AI again">Repeats reused for {u.cache_hours >= 48 ? `${Math.round(u.cache_hours / 24)} days` : `${u.cache_hours} h`}</Chip>}
            {u.tier !== 'standard' && <Chip title={u.tier === 'light' ? 'Short, structured work: runs on the lighter AI when one is set' : 'Long documents judged where a wrong answer costs most: runs on the stronger AI when one is set'}>{u.tier === 'light' ? 'Light AI' : 'Deep AI'}</Chip>}
            {!u.guarded && <Chip tone="danger" title="This path is not covered by the request check yet">Not yet checked</Chip>}
            {u.modality === 'vision' && <Chip tone="danger" title="Pictures are refused">Pictures refused</Chip>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-ds-body tabular-nums text-ds-fg">{fmtNumber(u.calls)} {u.calls === 1 ? 'call' : 'calls'}</div>
          <div className="text-ds-label text-ds-fg-muted">
            {u.blocked ? `${fmtNumber(u.blocked)} blocked · ` : ''}{u.failed ? `${fmtNumber(u.failed)} failed · ` : ''}last used {u.last_used ? fmtWhen(u.last_used) : 'never'}
          </div>
          {u.calls > 0 && <Button size="sm" variant="link" onClick={() => onOpen(u.id)} aria-label={`View the calls of ${u.label}`}>View calls</Button>}
        </div>
      </div>
    </li>
  );
}

export default function InventoryTab({ data, days, onOpenUseCase }: { data: Inventory; days: number; onOpenUseCase: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.modules
      .map((g) => ({
        ...g,
        use_cases: g.use_cases.filter((u) => {
          if (filter === 'own' && u.trigger === 'click') return false;
          if (filter === 'used' && u.calls === 0) return false;
          return !q || `${u.label} ${u.value} ${u.surface} ${g.label}`.toLowerCase().includes(q);
        }),
      }))
      .filter((g) => g.use_cases.length > 0);
  }, [data, query, filter]);

  const shown = groups.reduce((n, g) => n + g.use_cases.length, 0);
  const chips: FilterChip[] = FILTERS.map((f) => ({ key: f.key, label: f.label, active: filter === f.key }));
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[12px]">
        <TextInput aria-label="Search features" placeholder="Search features" className="w-[260px]" leftAdornment={<Search aria-hidden size={14} />} value={query} onChange={(e) => setQuery(e.target.value)} />
        <FilterChips label="Show" chips={chips} onToggle={(key) => setFilter(key as FilterKey)} />
        <span className="text-ds-body text-ds-fg-muted">{shown} of {data.total} features · calls for the last {days} days</span>
      </div>

      {groups.length === 0 && <EmptyState kind="noMatches" title="No feature matches" onClearFilters={() => { setQuery(''); setFilter('all'); }} />}
      {groups.map((g) => (
        <SectionCard key={g.module} id={`module-${g.module}`} title={g.label} meta={`${g.use_cases.length}`}>
          <ul className="-mx-[16px] -mb-[16px] mt-0 list-none divide-y divide-ds-border border-t border-ds-border p-0">
            {g.use_cases.map((u) => <Row key={u.id} u={u} onOpen={onOpenUseCase} />)}
          </ul>
        </SectionCard>
      ))}
      {data.unclassified > 0 && <p className="m-0 text-ds-label text-ds-fg-muted">{fmtNumber(data.unclassified)} older calls in this period could not be matched to a feature.</p>}
    </div>
  );
}
