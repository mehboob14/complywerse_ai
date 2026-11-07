'use client';

// How the register workspace reads and who may change it. The register routes need the RCSA edit right for every write (and the view right for every read): that is the right the page
// follows, not the Worklist's "risk team" (which also counts the create right, so a person with only that would be offered buttons the server refuses).
import { rcsaApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import type { RegisterRow } from '@/lib/rcsa/registerModel';
import { KEYS } from '../../../_parts/rcsaData';

const PAGE = 2000;       // the server's own limit for one read
const MAX_PAGES = 10;    // 20,000 items: far past any register, and a stop for a server that ignores the offset

/** Every item of a register: pages of 2,000 until one comes back short, so the screen counts what the register really holds. */
export async function fetchItems(templateId: number): Promise<RegisterRow[]> {
  const out: RegisterRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data } = await rcsaApi.customTemplates.listRows(templateId, { limit: PAGE, offset: page * PAGE });
    if (!Array.isArray(data)) throw new Error('The server sent something other than a list.');
    out.push(...(data as RegisterRow[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export function useRegisterRights(): { edit: boolean; loading: boolean } {
  const { isAdmin, hasPermission, isLoading } = usePermissions();
  return { edit: isAdmin || hasPermission('erm:rcsa:edit'), loading: isLoading };
}

/** What a change to an item makes stale: the items, the register's own counts, and the lists that show them (the library's counts, "Assigned to me"). */
export const itemsChanged = (templateId: number): ReadonlyArray<readonly unknown[]> => [KEYS.rows(templateId), KEYS.register(templateId), KEYS.registers];
