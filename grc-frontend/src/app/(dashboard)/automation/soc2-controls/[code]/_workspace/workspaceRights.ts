'use client';

// The rights of the control workspace as the server reads them (see workspaceRightsModel.ts).
import { useMemo } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import { rightsOf, whyNot, type WsRightKey, type WsRights } from './workspaceRightsModel';

export type { WsRightKey, WsRights };

export function useWorkspaceRights(): { loading: boolean; rights: WsRights; why: (key: WsRightKey) => string | undefined } {
  const { permissions, isAdmin, isLoading } = usePermissions();
  return useMemo(() => {
    const rights = rightsOf(isLoading ? [] : permissions, !isLoading && isAdmin);
    return { loading: isLoading, rights, why: (key: WsRightKey) => whyNot(rights, key) };
  }, [permissions, isAdmin, isLoading]);
}
