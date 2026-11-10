'use client';

import { usePermissions } from '@/hooks/usePermissions';

/** The rights the server checks for questionnaires (routers/questionnaires.py), each with its `erm:risks:edit` fallback. The page offers a button only to a person the server would let through. */
export function useRights() {
  const { hasPermission } = usePermissions();
  const erm = hasPermission('erm:risks:edit');
  return {
    create: hasPermission('vendor_risk:templates:create') || erm,
    edit: hasPermission('vendor_risk:templates:edit') || erm,
    remove: hasPermission('vendor_risk:templates:delete') || erm,
    send: hasPermission('vendor_risk:assessments:create') || erm,
    config: hasPermission('vendor_risk:config:edit') || erm,
    resend: hasPermission('vendor_risk:assessments:edit') || erm,       // a new link, publishing and importing in the exchange
    vendors: hasPermission('vendor_risk:vendors:edit') || erm,           // a personal link is issued on the supplier
  };
}

export type Rights = ReturnType<typeof useRights>;
