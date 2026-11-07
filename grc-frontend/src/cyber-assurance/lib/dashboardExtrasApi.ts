/**
 * Data hooks for the Performance dashboard's extra lenses — PCI compliance and Help Desk
 * KPIs. Kept out of api.ts on purpose: nothing here touches the shared API surface.
 *
 * Every hook takes the page's `shared` query options (staleTime / refetchInterval / …) so the
 * lenses follow the dashboard's auto-refresh cadence, and returns a query-like object
 * ({ data, isLoading, isError, isFetching, dataUpdatedAt }) the page can drop straight into its
 * `mine` array — "Last updated", the Refresh spinner and the "N sources didn't respond" counter
 * then include these lenses with no special-casing.
 *
 *  - Help Desk: GET /helpdesk/dashboard-overview. It is permission-gated (helpdesk:tickets:view),
 *    so a 403 (and a 404 where the module isn't provisioned) is NOT an error here: the fetcher
 *    resolves to { access: 'forbidden' | 'missing' } and the lens renders a quiet state. Only
 *    genuine failures (network / 5xx / malformed payload) reject.
 *  - PCI: composed client-side from three EXISTING endpoints (see dashboardExtrasLogic.ts) —
 *    no new backend route, so shipping this needs no backend restart.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/cyber-assurance/lib/api';
import {
  EMPTY_PCI, PCI_VULN_CAP, derivePci,
  type CisAssetsOverview, type HdOverview, type HdResult, type PciAssetInput, type PciSummary, type VulnHeatmap,
} from './dashboardExtrasLogic';

// Pure types + helpers (derivePci, hdKpis, fmtHours, …) are re-exported so callers import from one place.
export * from './dashboardExtrasLogic';

/* ---------- shared shapes ---------- */

/** The page's `shared` options object (see dashboard/page.tsx) — spread into every useQuery. */
export type SharedQueryOptions = {
  refetchOnMount?: boolean | 'always';
  refetchOnWindowFocus?: boolean | 'always';
  staleTime?: number;
  refetchInterval?: number | false;
};
/** What a lens receives. Structurally identical to lenses.tsx `Qs<X>`, so a plain useQuery result also fits. */
export type LensQuery<X> = { data?: X | null; isLoading: boolean; isError: boolean; isFetching?: boolean };
/** What the hooks return: a LensQuery plus dataUpdatedAt, so it slots into the page's `mine` array. */
export type ExtrasQuery<X> = { data: X | null; isLoading: boolean; isError: boolean; isFetching: boolean; dataUpdatedAt: number };

/* ---------- query keys ---------- */

export const EXTRAS_KEYS = {
  helpdesk: ['exec-dashboard.helpdesk-overview'],
  pciAssets: ['exec-dashboard.pci-assets'],
  pciVulns: ['exec-dashboard.pci-vuln-heatmap'],
  /** SAME key + same endpoint as the page's own CIS query (KEYS.cis) → one shared request / cache entry. */
  cis: ['compliance-plugins.assets-overview'],
} as const;

/** Add to the page's ALL_KEYS so "Refresh now" refetches the extras too. (cis is already in ALL_KEYS.) */
export const EXTRAS_REFRESH_KEYS: string[][] = [
  [...EXTRAS_KEYS.helpdesk], [...EXTRAS_KEYS.pciAssets], [...EXTRAS_KEYS.pciVulns],
];

/* ---------- fetchers ---------- */

const httpStatus = (e: unknown): number | undefined => (e as { response?: { status?: number } } | null)?.response?.status;

/** Resolves (never rejects) for 403 / 404; rejects on anything that is a real failure. */
export async function fetchHelpDeskOverview(): Promise<HdResult> {
  try {
    const { data } = await apiClient.get<HdOverview>('/helpdesk/dashboard-overview');
    if (!data || typeof data !== 'object' || typeof (data as HdOverview).total !== 'number') {
      throw new Error('Unexpected Help Desk overview payload');
    }
    return { access: 'ok', overview: data };
  } catch (e) {
    const s = httpStatus(e);
    if (s === 403) return { access: 'forbidden', overview: null };
    if (s === 404) return { access: 'missing', overview: null };
    throw e;
  }
}

const fetchPciAssets = async (): Promise<PciAssetInput[]> => {
  // list_assets defaults to limit=100 and has no cde filter, so ask for the whole register
  // (the register / reports / connect pages do the same with 1000–5000).
  const { data } = await apiClient.get<PciAssetInput[]>('/assets', { params: { limit: 5000 } });
  return Array.isArray(data) ? data : [];
};
const fetchCisOverview = async (): Promise<CisAssetsOverview> =>
  (await apiClient.get<CisAssetsOverview>('/compliance-plugins/assets-overview')).data;
const fetchVulnHeatmap = async (): Promise<VulnHeatmap> =>
  (await apiClient.get<VulnHeatmap>('/vuln-management/dashboard/asset-risk-heatmap', { params: { limit: PCI_VULN_CAP } })).data;

/* ---------- hooks ---------- */

/** Help Desk KPIs lens source. Data is { access, overview } — see fetchHelpDeskOverview. */
export function useHelpDeskKpis(shared: SharedQueryOptions = {}) {
  return useQuery<HdResult>({ queryKey: EXTRAS_KEYS.helpdesk, queryFn: fetchHelpDeskOverview, retry: 1, ...shared });
}

/**
 * PCI compliance lens source. `skip: true` (the inventory already reports zero PCI-scope assets)
 * returns the empty summary without fetching the asset register or the vulnerability heatmap.
 *
 * Failure is all-or-nothing: with one of the three sources missing, "compliant" can't be
 * established, so `data` stays null until all three have loaded (and a refetch error keeps the
 * previous data on screen, like every other lens).
 */
export function usePciCompliance(shared: SharedQueryOptions = {}, opts: { skip?: boolean } = {}): ExtrasQuery<PciSummary> {
  const enabled = !opts.skip;
  const assets = useQuery<PciAssetInput[]>({ queryKey: EXTRAS_KEYS.pciAssets, queryFn: fetchPciAssets, retry: 1, enabled, ...shared });
  const cis = useQuery<CisAssetsOverview>({ queryKey: EXTRAS_KEYS.cis, queryFn: fetchCisOverview, retry: 1, enabled, ...shared });
  const heat = useQuery<VulnHeatmap>({ queryKey: EXTRAS_KEYS.pciVulns, queryFn: fetchVulnHeatmap, retry: 1, enabled, ...shared });

  const data = useMemo<PciSummary | null>(() => {
    if (!enabled) return EMPTY_PCI;
    return assets.data && cis.data && heat.data ? derivePci(assets.data, cis.data, heat.data) : null;
  }, [enabled, assets.data, cis.data, heat.data]);

  return {
    data,
    isLoading: enabled && (assets.isLoading || cis.isLoading || heat.isLoading),
    isError: enabled && (assets.isError || cis.isError || heat.isError),
    isFetching: enabled && (assets.isFetching || cis.isFetching || heat.isFetching),
    dataUpdatedAt: enabled ? Math.max(assets.dataUpdatedAt, cis.dataUpdatedAt, heat.dataUpdatedAt) : 0,
  };
}
