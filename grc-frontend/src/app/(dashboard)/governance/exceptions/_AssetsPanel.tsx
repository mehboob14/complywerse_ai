'use client';

// The assets of an exception (D62): ONE list for the person who raised it and the people who implement it, each asset with its criticality and who put it there and
// at which stage ("Added by Olivia at the request" / "at the implementation"). Everyone who opens the exception reads it. The person the server lets (`can_add_assets`)
// adds assets from the organisation's own list, and takes off what the server says they may (`can_remove`: what they added, or anything for someone who may edit
// exceptions). The organisation's asset list is read only once "Add assets" is pressed. The list is the exception's `asset_links`; `linked_assets` stays the membership.
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { assetsApi, policyExceptionApi } from '@/lib/api';
import { Button, ErrorState, IconButton, MultiSelect, SkeletonLines, StatusPill, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { addedLine, levelPill } from './_riskText';
import { itemsOf } from './_logic';
import { LIST_KEYS, type AssetLink, type AssetOption, type ExceptionItem } from './_types';

export function AssetsPanel({ exception: e }: { exception: ExceptionItem }) {
  const headingId = useId();
  const links = e.asset_links ?? [];
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  // the same list the form's asset picker reads (one cache entry), asked for only when the person starts adding
  const pool = useQuery({
    queryKey: ['assets-for-exception-link'],
    queryFn: async () => itemsOf<AssetOption>((await assetsApi.getAll({ limit: 500 })).data),
    enabled: adding,
    retry: (n, err) => n < 2 && canRetry(err),
  });
  const onList = new Set(links.map((a) => a.asset_id));
  const options = (pool.data ?? []).filter((a) => !onList.has(a.id))
    .map((a) => ({ value: String(a.id), label: a.name, description: [a.asset_type, a.criticality].filter(Boolean).join(' · ') || undefined }));

  const add = useReportedMutation({
    mutationFn: (ids: number[]) => policyExceptionApi.addAssets(e.id, ids),
    success: (_data, ids) => (ids.length === 1 ? 'Asset added' : `${ids.length} assets added`),
    failure: 'Assets not added',
    invalidate: LIST_KEYS,
    onSuccess: () => { setChosen([]); setAdding(false); },
  });
  const remove = useReportedMutation({
    mutationFn: (a: AssetLink) => policyExceptionApi.removeAsset(e.id, a.asset_id),
    success: 'Asset removed',
    failure: 'Not removed',
    invalidate: LIST_KEYS,
  });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-[8px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="!text-ds-label !text-ds-fg-muted">Assets</h3>
        {e.can_add_assets && !adding && <Button size="sm" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add assets</Button>}
      </div>

      {links.length === 0 ? <span className="text-ds-body text-ds-fg-muted">No assets</span> : (
        <ul className="flex flex-col gap-[6px]">
          {links.map((a) => {
            const pill = levelPill(a.criticality);
            return (
              <li key={a.asset_id} className="flex flex-wrap items-center justify-between gap-x-[8px] gap-y-[2px] rounded-ds-card bg-ds-surface-subtle px-[10px] py-[6px]">
                <div className="min-w-0 flex-1 basis-[14rem]">
                  <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
                    <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{a.name}</span>
                    {pill && <StatusPill size="sm" {...pill} />}
                    {a.asset_type && <span className="text-ds-label text-ds-fg-muted">{a.asset_type}</span>}
                  </div>
                  <span className="text-ds-label text-ds-fg-muted">{addedLine(a)}</span>
                </div>
                {a.can_remove && (
                  <IconButton label={`Remove ${a.name}`} disabled={remove.isPending && remove.variables?.asset_id === a.asset_id} onClick={() => remove.mutate(a)}><X aria-hidden /></IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {e.can_add_assets && adding && (
        <div className="flex flex-col gap-[8px]">
          {pool.isLoading ? <SkeletonLines lines={1} label="Loading the assets" />
            : pool.isError ? <ErrorState compact title="Couldn't load the assets" message={errorMessage(pool.error)} onRetry={canRetry(pool.error) ? () => { void pool.refetch(); } : undefined} />
            : (
              <div className="flex flex-wrap items-center gap-[8px]">
                <MultiSelect label="Assets to add" options={options} value={chosen} onChange={setChosen} placeholder="Choose assets" display="count" className="min-w-0 flex-1 basis-[14rem]" />
                <Button variant="primary" loading={add.isPending} disabled={chosen.length === 0} onClick={() => add.mutate(chosen.map(Number))}>Add</Button>
                <Button onClick={() => { setAdding(false); setChosen([]); }}>Cancel</Button>
              </div>
            )}
        </div>
      )}
    </section>
  );
}
