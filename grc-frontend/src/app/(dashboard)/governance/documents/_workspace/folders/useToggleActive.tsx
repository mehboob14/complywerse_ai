'use client';

// Switching a unit off and on: the one question and the two calls, for the toolbar, the menus and the Details tab. A unit is never deleted (documents and assignments point at
// it), so "Deactivate" asks first (the kit's confirm dialog, with the same words as Administration → Departments) and "Activate" just does it. Each says what happened, or
// why not in the server's words. The caller renders `dialog` once.
import type { ReactNode } from 'react';
import { DEACTIVATE_NOTE, activatedText, deactivatedText } from '@/lib/departments';
import { departmentsApi } from '@/lib/api';
import { useConfirm, useReportedMutation } from '@/components/ui/ds';
import { useRefreshDirectory } from './directoryData';

export function useToggleActive(): { toggle: (unit: { id: number; name: string; is_active: boolean }) => Promise<void>; busy: boolean; dialog: ReactNode } {
  const refresh = useRefreshDirectory();
  const { confirm, confirmDialog } = useConfirm();
  const off = useReportedMutation({
    mutationFn: (u: { id: number; name: string }) => departmentsApi.deactivate(u.id),
    success: (_r, u) => deactivatedText(u.name),
    failure: 'Not deactivated',
    onSuccess: refresh,
  });
  const on = useReportedMutation({
    mutationFn: (u: { id: number; name: string }) => departmentsApi.update(u.id, { is_active: true }),
    success: (_r, u) => activatedText(u.name),
    failure: 'Not activated',
    onSuccess: refresh,
  });
  const toggle = async (unit: { id: number; name: string; is_active: boolean }) => {
    if (!unit.is_active) { on.mutate(unit); return; }
    if (await confirm({ title: `Deactivate ${unit.name}?`, message: DEACTIVATE_NOTE, confirmLabel: 'Deactivate', tone: 'danger' })) off.mutate(unit);
  };
  return { toggle, busy: off.isPending || on.isPending, dialog: confirmDialog };
}
