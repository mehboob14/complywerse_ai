'use client';

// The rights of the Controls Automation pages as the server reads them (see controlsRightsModel.ts for why the platform's hasPermission is not asked).
import { usePermissions } from '@/hooks/usePermissions';
import { RIGHT, holds, type RightKey } from './controlsRightsModel';

export { NO_RIGHT, RIGHT, type RightKey } from './controlsRightsModel';

export function useRights(): { loading: boolean; can: (right: RightKey) => boolean } {
  const { permissions, isAdmin, isLoading } = usePermissions();
  return { loading: isLoading, can: (right) => !isLoading && holds(RIGHT[right], permissions, isAdmin) };
}
