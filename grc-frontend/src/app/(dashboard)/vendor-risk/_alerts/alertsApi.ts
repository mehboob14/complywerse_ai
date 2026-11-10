'use client';

// The requests of the Alerts register and its drawer, each under ONE query key: the register (every kind of signal, read whole), one signal opened in the drawer, the feeds that are on and the
// public-code finds. A failed read is an error the page says, never an empty list. The writes keep the endpoints they always had (alerts/{id}/move, tpra/signals/{id}); the page reports them.
import { useQuery } from '@tanstack/react-query';
import apiClient, { tpraApi, vendorLeaksApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import type { AlertRow, AlertsAnswer } from './alertModel';
import type { Stage } from '@/lib/statuses/vendorMonitoring';

export const ALERTS_KEY = 'tprm-alert-register';
export const ALERT_KEY = 'tprm-alert-case';
export const PROVIDERS_KEY = 'tprm-monitoring-providers';
export const LEAKS_KEY = 'tprm-own-leaks';

/** What a change to a signal refreshes: the register, the open signal, the Attention queue, the Overview and the vendor's own Signals panel. */
export const ALERT_REFRESH: ReadonlyArray<readonly unknown[]> = [[ALERTS_KEY], [ALERT_KEY], ['tprm-alerts'], ['tprm-alert'], ['tprm-attention'], ['tprm-dashboard'], ['tprm-signals']];

const retry = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

/** The most the register reads at once (the server's cap): past it the page says so. */
export const READ_LIMIT = 5000;

export function useAlerts(days: number) {
  return useQuery({
    queryKey: [ALERTS_KEY, days],
    queryFn: async () => (await apiClient.get('/vendor-risk/alerts', { params: { kinds: 'all', days, limit: READ_LIMIT } })).data as AlertsAnswer,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry,
  });
}

export interface Research {
  summary: string; about_this_supplier: 'yes' | 'no' | 'unclear'; what_happened: string; when: string | null;
  data_involved: string[]; affects_us: 'likely' | 'possible' | 'unlikely' | 'unknown'; why: string;
  suggested_status: string; actions: string[]; questions_for_supplier: string[]; sources_read: string[];
  at: string; by: string | null;
}

export interface AlertCase extends AlertRow {
  detail: string | null;
  source_list: Array<{ url?: string; title?: string; domain?: string; seendate?: string }>;
  verification: { verified?: boolean } | null;
  research: Research | null;
  supplier: { description: string | null; services: string[]; data_access_level: string | null; data_types: string[] };
  moves: string[];
  history: Array<{ action: string; from: string | null; to: string | null; note: string | null; by: string | null; at: string }>;
  triggered_assessment_id: number | null;
  stage: Stage;
}

/** One signal for the drawer: every kind (`any=1`); only an alert kind has moves and an AI reading. */
export function useAlertCase(id: number | null) {
  return useQuery({
    queryKey: [ALERT_KEY, id],
    queryFn: async () => (await apiClient.get(`/vendor-risk/alerts/${id}`, { params: { any: 1 } })).data as AlertCase,
    enabled: id != null,
    retry,
  });
}

export interface Provider { provider: string; label: string; kind: string; configured: boolean; reaches_internet: boolean }

/** Which feeds are on, so the page says what fills it rather than implying more. */
export function useProviders() {
  return useQuery({
    queryKey: [PROVIDERS_KEY],
    queryFn: async () => ((await tpraApi.monitoringProviders()).data?.providers ?? []) as Provider[],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry,
  });
}

export interface Leak {
  id: number; domain: string; repository: string; path: string; url: string; first_seen: string;
  status: 'new' | 'confirmed' | 'dismissed'; note: string | null; decided_by: string | null;
}

export function useOwnLeaks() {
  return useQuery({
    queryKey: [LEAKS_KEY],
    queryFn: async () => (await vendorLeaksApi.own()).data as { items: Leak[]; switched_on: boolean },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry,
  });
}

// ── the writes ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const acknowledgeSignal = async (id: number) => (await tpraApi.updateSignal(id, { acknowledged: true })).data;
export const dismissSignal = async (id: number) => (await apiClient.post(`/vendor-risk/tpra/signals/${id}/dismiss`)).data;
export const raiseSignalFinding = async (id: number) => (await tpraApi.raiseSignalFinding(id)).data as { finding_id: number };
export const moveAlert = async (v: { id: number; status: string; note?: string; raise_finding?: boolean }) =>
  (await apiClient.post(`/vendor-risk/alerts/${v.id}/move`, { status: v.status, note: v.note?.trim() || undefined, raise_finding: v.raise_finding || false })).data;
export const researchAlert = async (id: number) => (await apiClient.post(`/vendor-risk/alerts/${id}/research`, {}, { timeout: 180000 })).data;
