'use client';

// "Link a record": a sheet that searches the platform's records of one type ON THE SERVER (a register with tens of thousands of rows is never shipped to the browser and filtered there; the old
// pickers read the first 100 risks or assets and said "none available" for the rest) and links the one the person picks. The caller says what linking does and what is already linked.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Button, EmptyState, ErrorState, FormField, Select, Sheet, SkeletonRows, TextInput } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { automationApi, type ControlRecordLink } from '@/lib/api';
import { statusLabel } from '@/lib/format';
import { Small } from './parts';

export interface LinkType { key: string; label: string }

export function LinkSheet({ open, onClose, title, types, linkedIds, onPick, pendingId, hint }: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** one type: no chooser; several: a chooser */
  types: readonly LinkType[];
  /** `type:id` of what is already linked, so it is shown as linked */
  linkedIds: ReadonlySet<string>;
  /** link the record; the sheet shows `pendingId` (`type:id`) as busy */
  onPick: (row: ControlRecordLink) => void;
  pendingId: string | null;
  hint?: string;
}) {
  const [type, setType] = useState(types[0]?.key ?? '');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { if (open) { setTerm(''); setDebounced(''); setType(types[0]?.key ?? ''); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const id = setTimeout(() => setDebounced(term.trim()), 250); return () => clearTimeout(id); }, [term]);
  const noun = (types.find((t) => t.key === type)?.label ?? 'record').toLowerCase();

  const q = useQuery({ queryKey: ['link-targets', type, debounced], enabled: open && !!type, staleTime: 30_000, queryFn: async () => (await automationApi.searchLinkTargets(type, debounced, 30)).data.items });

  return (
    <Sheet open={open} onClose={onClose} title={title} subtitle={hint} width="md" initialFocus="input[type=search], input[type=text]">
      <div className="flex flex-col gap-[12px]">
        {types.length > 1 && (
          <FormField label="Kind of record"><Select value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select></FormField>
        )}
        <TextInput type="search" aria-label={`Search ${noun}`} placeholder={`Search ${noun}`} value={term} onChange={(e) => setTerm(e.target.value)} leftAdornment={<Search aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />} />
        {q.isError ? <ErrorState compact title="Couldn’t search" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
          : q.isPending ? <SkeletonRows rows={4} columns={2} label="Searching" />
            : (q.data ?? []).length === 0 ? <EmptyState kind="noMatches" bare title={debounced ? `No ${noun} match` : `No ${noun} yet`} description={debounced ? 'Try other words.' : undefined} />
              : (
                <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface" aria-label="Results">
                  {(q.data ?? []).map((row) => {
                    const key = `${row.type}:${row.id}`;
                    const linked = linkedIds.has(key);
                    return (
                      <li key={key} className="flex items-center gap-[8px] px-[12px] py-[8px]">
                        <div className="min-w-0 flex-1">
                          <p className="text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{row.code ? <span className="mr-[6px] font-mono text-ds-label text-ds-fg-muted">{row.code}</span> : null}{row.label}</p>
                          {(row.subtitle || row.status) && <Small>{Array.from(new Set([...(row.subtitle ? row.subtitle.split(' · ') : []), row.status ? statusLabel(row.status) : null].filter(Boolean))).join(' · ')}</Small>}
                        </div>
                        <Button size="sm" variant={linked ? 'secondary' : 'primary'} disabled={linked || pendingId !== null} loading={pendingId === key} onClick={() => onPick(row)}>{linked ? 'Linked' : 'Link'}</Button>
                      </li>
                    );
                  })}
                </ul>
              )}
      </div>
    </Sheet>
  );
}
