// src/app/(dashboard)/compliance/access-reviews/api.ts
// React-Query data layer for Access Reviews. Endpoints map 1:1 to
// grc/routers/access_review_router.py (APIRouter prefix "/access-reviews";
// Next proxies it under /api). Uses the app-wide authedFetch helper.

import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { authedFetch } from '@/lib/auth-fetch';
import type {
  Campaign, CampaignDetail, ConnectorRun, ConnectorSource, ReviewItem, Report, DashboardSummary, RuleCatalogView,
  Decision, RuleSelection,
} from './types';

const API = '/api/access-reviews';

// authedFetch does NOT set a default Content-Type — JSON bodies must declare it
// or the FastAPI router fails to parse them. Use this for every JSON write.
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** The server's own words for a failed call: `400 Bad Request – {"detail": "…"}` → `…`. */
export function errorText(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  const msg = (e as Error)?.message || '';
  const body = msg.split(' – ').slice(1).join(' – ');
  try {
    const detail = JSON.parse(body).detail;
    if (typeof detail === 'string') return detail;
  } catch { /* not JSON */ }
  return body || msg || fallback;
}

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

/** Connected sources — what a review can be scoped to, and the status of each connector. */
export type ConnectorStatus = {
  sources: ConnectorSource[]; user_count: number;
  [connector: string]: unknown;
};
export function useConnectors() {
  return useQuery<ConnectorStatus>({
    queryKey: arKeys.connectors(),
    queryFn: () => authedFetch(`${API}/connectors`).then(json<ConnectorStatus>),
  });
}

export type Collector = { key: string; label: string; category: string; connected: boolean; reads: string };
export function useCollectors() {
  return useQuery<Collector[]>({
    queryKey: [...arKeys.connectors(), 'collectors'],
    queryFn: () => authedFetch(`${API}/connectors/collectors`).then(json<{ collectors: Collector[] }>).then((d) => d.collectors ?? []),
  });
}

export type ConnectorField = { name: string; label: string; secret?: boolean; ph?: string };
/** The credential fields of the IGA vendors and business apps, which the server defines. */
export function useConnectorFields() {
  return useQuery<Record<string, ConnectorField[]>>({
    queryKey: [...arKeys.connectors(), 'fields'],
    queryFn: async () => {
      const [iga, apps] = await Promise.all([
        authedFetch(`${API}/connectors/iga/vendors`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        authedFetch(`${API}/connectors/apps/catalog`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const out: Record<string, ConnectorField[]> = {};
      (iga?.vendors ?? []).forEach((v: { key: string; fields: ConnectorField[] }) => (out[v.key] = v.fields));
      (apps?.apps ?? []).forEach((a: { key: string; fields: ConnectorField[] }) => (out[a.key] = a.fields));
      return out;
    },
    staleTime: 5 * 60_000,
  });
}

export type SourcePerson = {
  id: number; email: string; display_name: string; designation?: string | null;
  account_enabled?: boolean | null; access: string[]; other_access: string[];
};
export type SourcePeople = {
  source: string; label: string; people: SourcePerson[]; total: number;
  estate?: {
    droplets?: { name: string; region?: string; status?: string; size?: string; ip?: string | null }[];
    volumes?: { name: string; size_gb?: number; region?: string; attached_to?: number[] }[];
    databases?: { name: string; engine?: string; version?: string; region?: string; nodes?: number }[];
    kubernetes?: { name: string; region?: string; version?: string }[];
    read?: Record<string, number>;
    skipped?: { resource: string; reason: string }[];
  };
};
/** Who a source put in the population, what each holds, and the estate behind them. */
export function useSourcePeople(source: string | null) {
  return useQuery<SourcePeople>({
    queryKey: [...arKeys.connectors(), 'people', source],
    queryFn: () => authedFetch(`${API}/connectors/${encodeURIComponent(source!)}/people`).then(json<SourcePeople>),
    enabled: !!source,
  });
}

/** Connect (or re-sync) a source: the endpoint depends on the kind of connector. */
export function useSyncSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { url: string; body?: unknown; form?: FormData }) => {
      const res = await authedFetch(`${API}${args.url}`, args.form
        ? { method: 'POST', body: args.form }
        : { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(args.body ?? {}) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The sync failed.');
      return data as Record<string, unknown>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: arKeys.connectors() });
      qc.invalidateQueries({ queryKey: arKeys.rules() });
      qc.invalidateQueries({ queryKey: arKeys.dashboard() });
    },
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
        .then(json<{ campaign: Campaign; items: ReviewItem[]; rule_results: CampaignDetail['rule_results']; connector_notes?: CampaignDetail['connector_notes'] }>)
        .then((d) => ({ ...d.campaign, items: d.items, rule_results: d.rule_results ?? [], connector_notes: d.connector_notes ?? [] })),
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

/** The rule library. A framework slug narrows it to the rules that evidence it (with its own clause
 *  codes); a source narrows it to what a review of that source can run. */
export function useRuleCatalog(framework?: string, source?: string) {
  return useQuery<RuleCatalogView>({
    queryKey: [...arKeys.rules(), framework ?? 'all', source ?? 'all'],
    queryFn: () => {
      const q = new URLSearchParams();
      if (framework) q.set('framework', framework);
      if (source) q.set('source', source);
      return authedFetch(`${API}/rules/catalog${q.toString() ? `?${q}` : ''}`).then(json<RuleCatalogView>);
    },
    placeholderData: (prev) => prev,
  });
}

/** Test a connected source against its own rules now (read-only; nothing is stored). */
export function useRunConnectorRules() {
  return useMutation({
    mutationFn: (source: string) =>
      authedFetch(`${API}/connectors/${encodeURIComponent(source)}/rules/run`, { method: 'POST' }).then(json<ConnectorRun>),
  });
}

// ---- mutations -----------------------------------------------------------
export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string; review_type: string; sampling_method: string; requested_sample_size: number;
      source?: string | null; description?: string;
    } & RuleSelection) => authedFetch(API, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }).then(json<Campaign>),
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

/** Change which rules a review runs. PUT /{id}/rules — after its checks, run them again to apply. */
export function useSetRules(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RuleSelection) =>
      authedFetch(`${API}/${id}/rules`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) }).then(json<Campaign>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: arKeys.campaign(id) });
      qc.invalidateQueries({ queryKey: arKeys.report(id) });
      qc.invalidateQueries({ queryKey: arKeys.list() });
    },
  });
}

/** Download the report (CSV / XLSX / PDF). A plain link can't carry the sign-in
 *  (it lives in local storage, not a cookie), so fetch it and save the file. */
export async function downloadReport(id: number, format: 'csv' | 'xlsx' | 'pdf') {
  const res = await authedFetch(`${API}/${id}/report/export?format=${format}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `access_review_${id}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
