'use client';

// The two sheets that add controls to the Catalog: "New internal control" (authored here, from the risk register's point of view) and "Add controls from the Library" (promote verified unified controls
// so they are worked here: comply once, covering their frameworks). Both ask before throwing away what was typed or picked, and both say what they did.
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, DebouncedSearch, EmptyState, ErrorState, FormField, Select, Sheet, SkeletonRows, StatusPill, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import apiClient from '@/lib/api';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { unifiedReview } from '@/lib/statuses/catalog';
import { REFRESH_KEYS, WB } from './catalogData';

const FREQUENCIES = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['annually', 'Yearly'], ['ad_hoc', 'When needed']] as const;
const PRIORITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']] as const;
const BLANK = { name: '', description: '', category: '', frequency: 'quarterly', priority: 'medium', is_key_control: false };

export function NewControlSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState(BLANK);
  useEffect(() => { if (!open) setF(BLANK); }, [open]);
  const dirty = f.name.trim() !== '' || f.description.trim() !== '' || f.category.trim() !== '';
  const create = useReportedMutation({
    mutationFn: () => apiClient.post(`${WB}/controls`, f),
    success: { title: 'Internal control created', message: 'Open it from the list to assign it and record tests.' },
    failure: "Couldn't create the control",
    retryable: false,
    invalidate: REFRESH_KEYS,
    onSuccess: onClose,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New internal control"
      subtitle="Authored here as an internal control, not taken from a framework"
      width="md"
      dirty={dirty}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" leftIcon={<Check aria-hidden />} loading={create.isPending} disabled={!f.name.trim()} onClick={() => create.mutate()}>Create control</Button>
        </>
      )}
    >
      <form className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) create.mutate(); }}>
        <FormField label="Name" required><TextInput value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></FormField>
        <FormField label="Description" optional><Textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} /></FormField>
        <FormField label="Category" optional><TextInput value={f.category} placeholder="For example Operations" onChange={(e) => set('category', e.target.value)} /></FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Tested"><Select value={f.frequency} onChange={(e) => set('frequency', e.target.value)}>{FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
          <FormField label="Priority"><Select value={f.priority} onChange={(e) => set('priority', e.target.value)}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
        </div>
        <Checkbox label="Key control" checked={f.is_key_control} onChange={(e) => set('is_key_control', e.target.checked)} />
      </form>
    </Sheet>
  );
}

interface Unified { id: number; code: string; name: string; domain?: string; review_status?: string; frameworks: string[] }

export function PromoteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  useEffect(() => { if (!open) { setSel([]); setQ(''); } }, [open]);
  const list = useQuery({
    queryKey: ['wb-normalized', q],
    enabled: open,
    queryFn: async () => (await apiClient.get(`${WB}/normalized?only_unpromoted=true&limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`)).data as { total: number; items: Unified[] },
  });
  const promote = useReportedMutation({
    mutationFn: async () => (await apiClient.post(`${WB}/promote`, { normalized_control_ids: sel })).data as { promoted: number },
    success: (r) => ({ title: 'Added to the Catalog', message: `${formatCount(r.promoted)} ${r.promoted === 1 ? 'control is' : 'controls are'} now worked from the Catalog.` }),
    failure: "Couldn't add the controls",
    invalidate: [...REFRESH_KEYS, ['wb-normalized']],
    onSuccess: onClose,
  });
  const items = list.data?.items ?? [];
  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add controls from the Library"
      subtitle="Verified unified controls are worked here once, and cover all their frameworks"
      width="md"
      dirty={sel.length > 0}
      footer={(
        <>
          <span className="mr-auto self-center text-ds-label text-ds-fg-muted">{`${formatCount(sel.length)} selected`}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" leftIcon={<Check aria-hidden />} loading={promote.isPending} disabled={sel.length === 0} onClick={() => promote.mutate()}>{sel.length ? `Add ${formatCount(sel.length)}` : 'Add'}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-[12px]">
        <DebouncedSearch label="Search the unified controls" placeholder="Search the unified controls" value={q} onSearch={setQ} loading={list.isFetching && !list.isPending} />
        {list.isError && !list.data ? (
          <ErrorState title="Couldn’t load the unified controls" message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />
        ) : list.isPending ? (
          <SkeletonRows rows={6} columns={2} label="Loading the unified controls" />
        ) : items.length === 0 ? (
          <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState kind={q ? 'noMatches' : 'firstUse'} bare title={q ? 'No unified control matches' : 'Nothing left to add'} description={q ? 'Search for other words.' : 'Every unified control is already in the Catalog.'} /></div>
        ) : (
          <>
            <ul className="m-0 list-none divide-y divide-ds-border overflow-clip rounded-ds-card border border-ds-border bg-ds-surface p-0">
              {items.map((it) => (
                <li key={it.id} className="px-[12px]">
                  <Checkbox
                    className="w-full"
                    checked={sel.includes(it.id)}
                    onChange={() => toggle(it.id)}
                    label={(
                      <span className="block min-w-0">
                        <span className="flex flex-wrap items-center gap-[8px]">
                          <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{it.name}</span>
                          {it.review_status && <StatusPill size="sm" {...statusPill(unifiedReview, it.review_status)} />}
                        </span>
                        <span className="block text-ds-label text-ds-fg-muted">{[it.code, it.domain, it.frameworks?.length ? `${formatCount(it.frameworks.length)} frameworks` : ''].filter(Boolean).join(' · ')}</span>
                      </span>
                    )}
                  />
                </li>
              ))}
            </ul>
            {(list.data?.total ?? 0) > items.length && <p className="m-0 text-ds-label text-ds-fg-muted">{`Showing ${formatCount(items.length)} of ${formatCount(list.data?.total)}. Search to narrow the list.`}</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
