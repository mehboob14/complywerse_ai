'use client';

// The requests of the control workspace. Each tab asks only for what it draws (the old page asked for ten on open); a key is shared by everything that shows the same answer, so one request serves
// the tab, its count and the header. The prefixes are the ones other pages invalidate (ScopeDialog refreshes `automation-common-detail`, `control-assurance`, `automation-test-plan`, ...).
// A failed request is an error the section says with a Retry, never an empty list.
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { automationApi, scfApi, type ScfHistoryEntry } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import type { AssurancePayload, ControlDetail, TestPlanData, TestingRecord } from './types';

const retry = (failures: number, e: unknown) => failures < 2 && canRetry(e);

/** The control, in scope or not. A custom control that was created a moment ago may be read from its own record first (the register answers before the catalogue does). */
export function useControlDetail(code: string) {
  return useQuery({
    queryKey: ['automation-common-detail', code],
    enabled: !!code,
    queryFn: async () => (await automationApi.getCommonControl(code)).data as ControlDetail,
    retry,
  });
}

export function useCustomRecord(code: string, enabled: boolean) {
  return useQuery({
    queryKey: ['scf-custom-control', code],
    enabled: !!code && enabled,
    queryFn: async () => (await scfApi.getCustomControl(code)).data,
    retry: false,
  });
}

/** Where the control stands beyond its own page: the work item (effectiveness, schedule), the designation, the evidence it needs. `work_item.work_item_id` is null for a control nobody has acted on. */
export function useAssurance(code: string, enabled = true) {
  return useQuery({
    queryKey: ['control-assurance', code],
    enabled: !!code && enabled,
    queryFn: async () => (await automationApi.getControlAssurance(code)).data as AssurancePayload,
    retry,
  });
}

export function useTesting(code: string, enabled = true) {
  return useQuery({
    queryKey: ['control-assurance-testing', code],
    enabled: !!code && enabled,
    queryFn: async () => (await automationApi.getAssuranceTesting(code)).data as TestingRecord,
    retry,
  });
}

export function useTestPlan(code: string, enabled = true) {
  return useQuery({
    queryKey: ['automation-test-plan', code],
    enabled: !!code && enabled,
    queryFn: async () => (await automationApi.getControlTestPlan(code)).data as TestPlanData,
    retry,
  });
}

export interface Suggestions { suggestions: Record<string, Array<{ evidence_id: number; score: number; reasons: string[]; name: string; already_on_control: boolean }>> }

export function useSuggestions(code: string, enabled = true) {
  return useQuery({
    queryKey: ['control-assurance-suggestions', code],
    enabled: !!code && enabled,
    staleTime: 60_000,
    queryFn: async () => (await automationApi.getAssuranceSuggestions(code)).data as Suggestions,
    retry,
  });
}

/** The change log of the control: the server sends the latest 100. The scope id comes with the control, so no separate scope request is needed. */
export function useHistory(scopeId: number | null | undefined, code: string, enabled = true) {
  return useQuery({
    queryKey: ['scf-control-history', scopeId, code],
    enabled: !!scopeId && !!code && enabled,
    queryFn: async () => {
      const raw = (await scfApi.getControlHistory(scopeId as number, code)).data as ScfHistoryEntry[] | { items?: ScfHistoryEntry[]; events?: ScfHistoryEntry[] };
      return Array.isArray(raw) ? raw : (raw?.events || raw?.items || []);
    },
    retry,
  });
}

/** The tenant's AWS connection, the one kind of source the run button hands an id to (GET /soc2/connections lists AWS only). Read when someone runs a test, not when the page opens. */
export async function awsConnectionId(): Promise<number | null> {
  const list = ((await automationApi.listConnections()).data?.connections ?? []) as Array<{ id: number }>;
  return list.length ? list[0].id : null;
}

/** Everything a control's pages show that a write can change. One place, so a write cannot forget one of them. */
const CONTROL_KEYS = [
  'automation-common-detail', 'control-assurance', 'control-assurance-testing', 'automation-test-plan', 'control-assurance-suggestions', 'control-evidence', 'control-artifacts',
  'control-links', 'control-risks', 'control-assets', 'scf-control-history', 'control-fields',
] as const;
/** The lists and counters elsewhere that read a control (the explorer, the Overview, My Work, Reports). */
const ELSEWHERE_KEYS = ['automation-common', 'common-overview', 'scf-my-work'] as const;

/** By prefix: another control's cached answers are marked old too, which costs nothing (they are not on screen). */
export function refreshControl(qc: QueryClient, { elsewhere = true }: { elsewhere?: boolean } = {}): Promise<unknown> {
  const keys: readonly string[] = elsewhere ? [...CONTROL_KEYS, ...ELSEWHERE_KEYS] : CONTROL_KEYS;
  return Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useRefreshControl() {
  const qc = useQueryClient();
  return (opts?: { elsewhere?: boolean }) => refreshControl(qc, opts);
}

/** A control the organisation has just written, read from its own record while the catalogue's answer is not there yet: the page can open it at once. */
export function fromCustomRecord(code: string, c: { code: string; name?: string | null; statement?: string | null; domain?: string | null; control_sub_type?: string | null; conformity_cadence?: string | null; implements_scf_ids?: string[]; bound_check_ids?: string[]; profile?: unknown }): ControlDetail {
  return {
    control_id: c.code || code,
    title: c.name || c.code || code,
    description: c.statement || '',
    category: c.domain || 'Custom',
    sub_type: c.control_sub_type || null,
    checks: [],
    checks_count: 0,
    overall_status: 'manual',
    custom: true,
    conformity_cadence: c.conformity_cadence || null,
    implements_scf_ids: c.implements_scf_ids ?? [],
    bound_check_ids: c.bound_check_ids ?? [],
    requirement_groups: [],
    requirement_count: 0,
    framework_count: 0,
    release: '',
    scope_id: null,
    profile: (c.profile as ControlDetail['profile']) ?? null,
  };
}
