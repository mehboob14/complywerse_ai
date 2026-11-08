'use client';

// Start, close and delete a campaign, asked and reported the same way from the register's menu and from the campaign's page. The questions say what really happens (the old ones said
// "This will notify all assigned assessors" — nothing is sent — and deleted every answer behind a bare "Are you sure?"). The server's rules are not widened: a campaign starts from
// draft only, closes from draft or active, and an active one cannot be deleted; the menu says so beside the item instead of letting the person find out. All three are the risk team's.
import { Play, Square, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { rcsaApi } from '@/lib/api';
import { useConfirm, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { truncate } from '@/lib/format';
import { ACTIVATE_ASK, CLOSE_ASK, DELETE_ASK, type CampaignRow } from '@/lib/rcsa/campaignsModel';
import { KEYS } from '../../_parts/rcsaData';

/** every open campaign page (the key of KEYS.campaign(id) without the id) */
const CAMPAIGN_PAGES = ['rcsa', 'campaign'] as const;

type Target = Pick<CampaignRow, 'id' | 'name' | 'status' | 'assessment_count'>;

export function useCampaignActions(manage: boolean, afterDelete?: () => void): { items: (c: Target) => MenuItem[]; dialog: ReactNode; busy: boolean; ask: { activate: (c: Target) => void; close: (c: Target) => void; remove: (c: Target) => void } } {
  const { confirm, confirmDialog } = useConfirm();
  const activate = useReportedMutation({
    mutationFn: (c: Target) => rcsaApi.activateCampaign(c.id),
    success: (_, c) => ({ title: `${truncate(c.name, 60).text} has started`, message: 'Its units now appear on their assessors\' worklists.' }),
    failure: "The campaign didn't start",
    retryable: false,
    invalidate: [KEYS.campaigns, CAMPAIGN_PAGES, KEYS.work, KEYS.summary],
  });
  const close = useReportedMutation({
    mutationFn: (c: Target) => rcsaApi.closeCampaign(c.id),
    success: (_, c) => `${truncate(c.name, 60).text} is closed`,
    failure: "The campaign wasn't closed",
    retryable: false,
    invalidate: [KEYS.campaigns, CAMPAIGN_PAGES, KEYS.work, KEYS.summary],
  });
  const remove = useReportedMutation({
    mutationFn: (c: Target) => rcsaApi.deleteCampaign(c.id),
    success: (_, c) => `Deleted ${truncate(c.name, 60).text}`,
    failure: "The campaign wasn't deleted",
    retryable: false,
    invalidate: [KEYS.campaigns, CAMPAIGN_PAGES, KEYS.work, KEYS.summary, KEYS.findings],
    onSuccess: () => { afterDelete?.(); },
  });

  const ask = {
    activate: async (c: Target) => { const a = ACTIVATE_ASK(c.assessment_count); if (await confirm({ title: a.title, message: a.message, confirmLabel: a.confirmLabel })) activate.mutate(c); },
    close: async (c: Target) => { if (await confirm({ ...CLOSE_ASK, tone: 'danger' })) close.mutate(c); },
    remove: async (c: Target) => { const a = DELETE_ASK(truncate(c.name, 60).text, c.assessment_count); if (await confirm({ ...a, tone: 'danger' })) remove.mutate(c); },
  };
  const items = (c: Target): MenuItem[] => [
    { key: 'start', label: 'Start', icon: Play, hidden: !manage, disabled: c.status !== 'draft', reason: c.status !== 'draft' ? 'Only a draft campaign can be started.' : undefined, onSelect: () => { void ask.activate(c); } },
    { key: 'close', label: 'Close', icon: Square, hidden: !manage, disabled: c.status === 'closed', reason: c.status === 'closed' ? 'It is already closed.' : undefined, onSelect: () => { void ask.close(c); } },
    { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !manage, disabled: c.status === 'active', reason: c.status === 'active' ? 'Close the campaign first: a running campaign cannot be deleted.' : undefined, onSelect: () => { void ask.remove(c); } },
  ];
  return { items, dialog: confirmDialog, busy: activate.isPending || close.isPending || remove.isPending, ask: { activate: (c) => { void ask.activate(c); }, close: (c) => { void ask.close(c); }, remove: (c) => { void ask.remove(c); } } };
}
