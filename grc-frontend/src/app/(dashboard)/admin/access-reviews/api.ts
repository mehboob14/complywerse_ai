// src/app/(dashboard)/admin/access-reviews/api.ts
// React-Query data layer for Access Reviews. Endpoints map 1:1 to
// grc/routers/access_review_router.py (APIRouter prefix "/access-reviews";
// Next proxies it under /api). Uses the app-wide authedFetch helper.

import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { authedFetch } from '@/lib/auth-fetch';
import type {
  Campaign, CampaignDetail, ReviewItem, Report, DashboardSummary, RuleCatalogView, Decision,
} from './types';

const API = '/api/access-reviews';

// authedFetch does NOT set a default Content-Type — JSON bodies must declare it
// or the FastAPI router fails to parse them. Use this for every JSON write.
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${body ? ` – ${body}` : ''}`);
  }
  return res.json() as Promise<T>;
}

// ---- query keys (stable, for invalidation) -------------------------------
export const arKeys = {
  all: ['access-reviews'] as const,
  list: () => [...arKeys.all, 'list'] as const,
  dashboard: () => [...arKeys.all, 'dashboard'] as const,
  campaign: (id: number) => [...arKeys.all, 'campaign', id] as const,
  report: (id: number) => [...arKeys.all, 'report', id] as const,
  rules: () => [...arKeys.all, 'rules'] as const,
  connectors: () => [...arKeys.all, 'connectors'] as const,
};

// ---- queries -------------------------------------------------------------
export function useCampaigns(opts?: Partial<UseQueryOptions<Campaign[]>>) {
  return useQuery<Campaign[]>({
    queryKey: arKeys.list(),
    // Backend wraps the list as { campaigns: [...] }; unwrap to a plain array.
    queryFn: () => authedFetch(API).then(json<{ campaigns: Campaign[] }>).then((d) => d.campaigns ?? []),
    ...opts,
  });
}

export function useDashboard() {
  return useQuery<DashboardSummary>({
    queryKey: arKeys.dashboard(),
    queryFn: () => authedFetch(`${API}/dashboard`).then(json<DashboardSummary>),
  });
}

export function useCampaign(id: number, enabled = true) {
  return useQuery<CampaignDetail>({
    queryKey: arKeys.campaign(id),
    // Backend returns a NESTED shape { campaign, items }; flatten to CampaignDetail.
    queryFn: () =>
      authedFetch(`${API}/${id}`)
        .then(json<{ campaign: Campaign; items: ReviewItem[] }>)
        .then((d) => ({ ...d.campaign, items: d.items })),
    enabled: enabled && Number.isFinite(id),
  });
}

export function useReport(id: number, enabled = true) {
  return useQuery<Report>({
    queryKey: arKeys.report(id),
    queryFn: () => authedFetch(`${API}/${id}/report`).then(json<Report>),
    enabled: enabled && Number.isFinite(id),
  });
}

export function useRuleCatalog() {
  return useQuery<RuleCatalogView>({
    queryKey: arKeys.rules(),
    queryFn: () => authedFetch(`${API}/rules/catalog`).then(json<RuleCatalogView>),
  });
}

// ---- mutations -----------------------------------------------------------
export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string; review_type: string; sampling_method: string; requested_sample_size: number;
      description?: string;
    }) => authedFetch(API, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }).then(json<Campaign>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: arKeys.list() });
      qc.invalidateQueries({ queryKey: arKeys.dashboard() });
    },
  });
}

/** Generic gated stage advance. step maps to the backend pipeline endpoints. */
function useStageMutation(step: 'sync-population' | 'sample' | 'run-checks' | 'close') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      authedFetch(`${API}/${id}/${step}`, { method: 'POST' }).then(json<Campaign>),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: arKeys.campaign(id) });
      qc.invalidateQueries({ queryKey: arKeys.report(id) });
      qc.invalidateQueries({ queryKey: arKeys.list() });
      qc.invalidateQueries({ queryKey: arKeys.dashboard() });
    },
  });
}
export const useSyncPopulation = () => useStageMutation('sync-population');
export const useDrawSample = () => useStageMutation('sample');
export const useRunChecks = () => useStageMutation('run-checks');
export const useCloseCampaign = () => useStageMutation('close');

/** Per-user certification decision. Maps to POST /items/{itemId}/decision. */
export function useSetDecision(campaignId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, decision, note }: { itemId: number; decision: Decision; note?: string }) =>
      // Backend DecisionIn expects `comment`, not `note`.
      authedFetch(`${API}/items/${itemId}/decision`, {
        method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ decision, comment: note }),
      }).then(json<{ ok: true }>),
    // optimistic update so the reviewer table feels instant
    onMutate: async ({ itemId, decision }) => {
      await qc.cancelQueries({ queryKey: arKeys.campaign(campaignId) });
      const prev = qc.getQueryData<CampaignDetail>(arKeys.campaign(campaignId));
      if (prev) {
        qc.setQueryData<CampaignDetail>(arKeys.campaign(campaignId), {
          ...prev,
          items: prev.items.map((it) => (it.id === itemId ? { ...it, decision } : it)),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(arKeys.campaign(campaignId), ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: arKeys.campaign(campaignId) });
      qc.invalidateQueries({ queryKey: arKeys.report(campaignId) });
      qc.invalidateQueries({ queryKey: arKeys.dashboard() });
    },
  });
}

/** Enable/disable or re-severity a catalog rule. PATCH /rules/{ruleId}. */
export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, enabled, severity }: { ruleId: string; enabled?: boolean; severity?: string }) =>
      authedFetch(`${API}/rules/${ruleId}`, {
        method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ enabled, severity }),
      }).then(json<{ ok: true }>),
    onSuccess: () => qc.invalidateQueries({ queryKey: arKeys.rules() }),
  });
}

/** Attach evidence to a decision. POST /items/{itemId}/evidence (multipart). */
export function useUploadEvidence(campaignId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, file }: { itemId: number; file: File }) => {
      const fd = new FormData();
      fd.append('file', file);
      return authedFetch(`${API}/items/${itemId}/evidence`, { method: 'POST', body: fd })
        .then(json<{ evidence_id: number }>);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: arKeys.campaign(campaignId) }),
  });
}

export function useAiRecommendations(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authedFetch(`${API}/${id}/ai-recommendations`, { method: 'POST' }).then(json),
    onSuccess: () => qc.invalidateQueries({ queryKey: arKeys.campaign(id) }),
  });
}

export function useAiSummary(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authedFetch(`${API}/${id}/ai-summary`, { method: 'POST' }).then(json),
    onSuccess: () => qc.invalidateQueries({ queryKey: arKeys.report(id) }),
  });
}

/** Build a report-export URL (CSV / XLSX / PDF). GET /{id}/report/export?format= */
export const reportExportUrl = (id: number, format: 'csv' | 'xlsx' | 'pdf') =>
  `${API}/${id}/report/export?format=${format}`;
