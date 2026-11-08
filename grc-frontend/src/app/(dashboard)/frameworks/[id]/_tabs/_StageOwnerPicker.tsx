'use client';

/**
 * StageOwnerPicker - assign the owner of one journey stage to a person, a department or a role that exists in the tenant (saved on the journey with
 * PATCH /certifications/{id}/stage-owners/{n}). The flow's own owner is only a suggestion, shown beside the button. A dialog of the kit (focus kept,
 * Escape closes) instead of the hand-drawn pop-up that was cut off by the card it sat in; a failed save is said, with a Retry.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, UserRound, Users, ShieldCheck } from 'lucide-react';
import apiClient from '@/lib/api';
import { AnimatedModal } from '@/components/ui';
import { Button, ErrorState, SegmentedControl, SkeletonRows, TextInput, useReportedMutation } from '@/components/ui/ds';
import { apiErrorText, safeDetail } from '@/lib/apiError';

type OwnerType = 'user' | 'team' | 'role';
export interface StageOwner { type: OwnerType; ref_id?: number | null; label: string; }

const TYPES: ReadonlyArray<{ value: OwnerType; label: string; icon: typeof UserRound }> = [
  { value: 'user', label: 'People', icon: UserRound },
  { value: 'team', label: 'Departments', icon: Users },
  { value: 'role', label: 'Roles', icon: ShieldCheck },
];

export default function StageOwnerPicker({
  journeyId, stageN, stageName, suggested, current,
}: {
  journeyId: number;
  stageN: number;
  stageName?: string;
  suggested?: string;
  current?: StageOwner | null;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<OwnerType>('user');
  const [search, setSearch] = useState('');

  const usersQ = useQuery({ queryKey: ['stage-owner-users'], queryFn: async () => (await apiClient.get('/admin/users')).data as any[], enabled: open, staleTime: 300_000, retry: false });
  const teamsQ = useQuery({ queryKey: ['stage-owner-teams'], queryFn: async () => (await apiClient.get('/admin/teams')).data as any[], enabled: open, staleTime: 300_000, retry: false });
  const rolesQ = useQuery({ queryKey: ['stage-owner-roles'], queryFn: async () => (await apiClient.get('/admin/roles')).data as any[], enabled: open, staleTime: 300_000, retry: false });
  const active = type === 'user' ? usersQ : type === 'team' ? teamsQ : rolesQ;

  const setOwner = useReportedMutation({
    mutationFn: async (a: StageOwner | null) =>
      apiClient.patch(`/certifications/${journeyId}/stage-owners/${stageN}`, a ? { owner_type: a.type, ref_id: a.ref_id, label: a.label } : { owner_type: null }),
    success: (_d, a) => (a ? `Owner set to ${a.label}` : 'Owner cleared'),
    failure: "Couldn't save the owner",
    invalidate: [['certification', journeyId]],
    onSuccess: () => { setOpen(false); setSearch(''); },
  });

  const items: { id: number; label: string }[] =
    type === 'user'
      ? (usersQ.data || []).map((u) => ({ id: u.id, label: u.display_name || u.name || u.email || `User #${u.id}` }))
      : type === 'team'
      ? (teamsQ.data || []).map((t) => ({ id: t.id, label: t.name || `Department #${t.id}` }))
      : (rolesQ.data || []).map((r) => ({ id: r.id, label: r.name || `Role #${r.id}` }));
  const filtered = items.filter((it) => !search || it.label.toLowerCase().includes(search.toLowerCase()));
  const Icon = current ? (TYPES.find((t) => t.value === current.type)?.icon ?? UserRound) : UserRound;

  return (
    <span className="inline-flex flex-wrap items-center gap-[8px]">
      <Button size="sm" leftIcon={<Icon aria-hidden />} onClick={() => setOpen(true)} aria-label={`${current ? 'Change' : 'Assign'} the owner of stage ${stageN}${stageName ? `, ${stageName}` : ''}`}>
        {current ? current.label : 'Assign owner'}
      </Button>
      {suggested && !current && <span className="text-ds-label text-ds-fg-muted">Suggested: {suggested}</span>}

      <AnimatedModal isOpen={open} onClose={() => { setOpen(false); setSearch(''); }} title={`Owner of stage ${stageN}`} subtitle={stageName} size="md">
        <div className="space-y-[12px]">
          <SegmentedControl label="Kind of owner" name={`owner-kind-${stageN}`} options={TYPES.map((t) => ({ value: t.value, label: t.label }))} value={type} onChange={(v) => { setType(v); setSearch(''); }} />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${TYPES.find((t) => t.value === type)?.label.toLowerCase()}`} aria-label="Search owners" />
          <div className="max-h-[260px] overflow-y-auto rounded-ds-control border border-ds-border">
            {active.isLoading ? (
              <SkeletonRows rows={4} />
            ) : active.error ? (
              <ErrorState compact title="Couldn't load the list" message={safeDetail(apiErrorText(active.error, 'Please try again.'))} onRetry={() => { void active.refetch(); }} />
            ) : filtered.length === 0 ? (
              <p className="p-[12px] text-ds-body text-ds-fg-muted">Nothing found.</p>
            ) : (
              <ul>
                {filtered.map((it) => {
                  const chosen = current?.type === type && current?.ref_id === it.id;
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => setOwner.mutate({ type, ref_id: it.id, label: it.label })}
                        disabled={setOwner.isPending}
                        aria-pressed={chosen}
                        className="flex min-h-ds-control w-full items-center justify-between gap-[8px] px-[12px] py-[6px] text-left text-ds-body text-ds-fg-body enabled:hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] disabled:opacity-50"
                      >
                        <span className="min-w-0 truncate">{it.label}</span>
                        {chosen && <Check aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-primary-text" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {current && (
            <Button size="sm" onClick={() => setOwner.mutate(null)} disabled={setOwner.isPending}>Clear owner</Button>
          )}
        </div>
      </AnimatedModal>
    </span>
  );
}
