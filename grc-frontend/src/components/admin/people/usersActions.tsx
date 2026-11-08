'use client';

// What can be done to a person from the Users page (the row menu and the sheet share it): Deactivate / Reactivate (the first thing offered) and Remove permanently
// (the last). Each asks in words where it matters (no native dialogs) and says what happened or why not; a refusal keeps the server's own words.
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useConfirm, useReportedMutation } from '@/components/ui/ds';
import { REMOVE_FAILED, deactivateText, nameOf, removeText, type UserRecord } from '@/lib/people/usersModel';
import { ROLES_KEY, USERS_KEY } from './peopleData';

export interface UserActions {
  askDeactivate: (user: UserRecord) => Promise<void>;
  reactivate: (user: UserRecord) => void;
  askRemove: (user: UserRecord) => Promise<void>;
  /** a status change or a removal is under way for this person */
  busyId: number | null;
  /** the confirmation dialog: render it once, near the page's end */
  ui: ReactNode;
}

export function useUserActions(onRemoved?: (user: UserRecord) => void): UserActions {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  // a person's status or roles move the roles' people counts too
  const refresh = () => { void qc.invalidateQueries({ queryKey: USERS_KEY }); void qc.invalidateQueries({ queryKey: ROLES_KEY }); };

  const setActive = useReportedMutation({
    mutationFn: ({ user, active }: { user: UserRecord; active: boolean }) => adminApi.updateUser(user.id, { is_active: active }),
    success: (_r, { user, active }) => (active ? `${nameOf(user)} can sign in again` : `${nameOf(user)} can no longer sign in`),
    failure: "The account wasn't changed",
    onSuccess: refresh,
  });
  const remove = useReportedMutation({
    mutationFn: (user: UserRecord) => adminApi.deleteUser(user.id),
    success: (_r, user) => `${nameOf(user)} was removed`,
    failure: "The account wasn't removed",
    fallback: REMOVE_FAILED,
    onSuccess: (_r, user) => { refresh(); onRemoved?.(user); },
  });

  return {
    askDeactivate: async (user) => {
      if (await confirm(deactivateText(nameOf(user)))) setActive.mutate({ user, active: false });
    },
    reactivate: (user) => setActive.mutate({ user, active: true }),
    askRemove: async (user) => {
      if (await confirm({ ...removeText(nameOf(user)), tone: 'danger' })) remove.mutate(user);
    },
    busyId: setActive.isPending ? setActive.variables?.user.id ?? null : remove.isPending ? remove.variables?.id ?? null : null,
    ui: confirmDialog,
  };
}
