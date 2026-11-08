'use client';

// The requests the Assessments Overview, the register and the Types page share, each under ONE query key so the same answer is asked once. The keys are the ones the workspace's writes
// already refresh (`refreshWorkspaceCaches`: assessments-board-overview, redesign-sla-points, assessments-my-work, and refreshAssessmentLists: redesign-assessments, scoping-templates), and
// the board's key is the one the Performance Overview card reads, so a change anywhere shows everywhere. A failed request is an error the page says, with Retry, never an empty list or a 0.
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { scopingApi } from '@/components/compliance/scoping/scopingApi';
import type { Board, ListAnswer, ListRow, MyWork, Point, Policy, Template } from './types';

const BASE = '/compliance/assessments';

/** The most rows the register asks for in one request; the server answers the true `total`, and the page says when the list is cut. */
export const REGISTER_LIMIT = 1000;
/** The most rows per list the server sends of the person's own work (it clamps to 100; the counts are always whole). */
export const WORK_LIMIT = 100;

export const KEYS = {
  register: ['redesign-assessments', 'register'] as const,
  board: ['assessments-board-overview'] as const,
  myWork: ['assessments-my-work'] as const,
  points: ['redesign-sla-points'] as const,
  policy: ['assessments-sla-policy'] as const,
  templates: ['scoping-templates'] as const,
};

/** A read is tried twice more when trying again can help (the server is down, the network dropped); a refusal or a missing record is said at once. */
export const retryRead = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

export interface RegisterAnswer { rows: ListRow[]; total: number; truncated: boolean }

export const api = {
  register: async (): Promise<RegisterAnswer> => {
    const data = (await apiClient.get(BASE, { params: { limit: REGISTER_LIMIT, summary: 0, all_formats: 1 } })).data as ListAnswer;
    const rows = Array.isArray(data?.assessments) ? data.assessments : [];
    const total = typeof data?.total === 'number' ? data.total : rows.length;
    return { rows, total, truncated: total > rows.length };
  },
  /** How many assessments there are at all (one row asked for): tells a tenant with none from one whose scores have not come in. */
  count: async (): Promise<number> => {
    const data = (await apiClient.get(BASE, { params: { limit: 1, summary: 0, all_formats: 1 } })).data as ListAnswer;
    return typeof data?.total === 'number' ? data.total : Array.isArray(data?.assessments) ? data.assessments.length : 0;
  },
  board: async (): Promise<Board> => (await apiClient.get(`${BASE}/overview`)).data as Board,
  myWork: async (limit: number): Promise<MyWork> => (await apiClient.get(`${BASE}/my-work`, { params: { limit } })).data as MyWork,
  points: async (): Promise<Point[]> => ((await apiClient.get(`${BASE}/points`)).data?.points ?? []) as Point[],
  policy: async (): Promise<Policy> => (await apiClient.get(`${BASE}/sla-policy`)).data as Policy,
  /** Saves the SLA policy: ONE request with every field (the server takes them as query parameters and ignores a day count of 0 or less). */
  savePolicy: async (policy: Policy): Promise<unknown> => (await apiClient.put(`${BASE}/sla-policy`, null, { params: policy })).data,
  /** The assessments of one format (the forward from an old address): at most two, to tell none, one and several apart. */
  ofFormat: async (format: string): Promise<{ rows: ListRow[]; total: number }> => {
    const data = (await apiClient.get(BASE, { params: { assessment_format: format, limit: 2, summary: 0, all_formats: 1 } })).data as ListAnswer;
    return { rows: Array.isArray(data?.assessments) ? data.assessments : [], total: typeof data?.total === 'number' ? data.total : 0 };
  },
  /** The workbook of a type: one request, the type named so the server refuses another kind of workbook (it detects the kind itself). */
  upload: async (file: File, format: string | null): Promise<{ id: number | null }> => {
    const form = new FormData();
    form.append('file', file);
    form.append('name', file.name.replace(/\.[^.]+$/, ''));
    form.append('assessment_type', 'gap_assessment');
    if (format) form.append('expected_format', format);
    const data = (await apiClient.post(`${BASE}/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } })).data as Record<string, unknown>;
    const id = data?.id ?? (data?.assessment as Record<string, unknown> | undefined)?.id ?? null;
    return { id: typeof id === 'number' ? id : null };
  },
};

function read<T>(queryKey: readonly unknown[], queryFn: () => Promise<T>, options: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery<T>({ queryKey: [...queryKey], queryFn, retry: retryRead, retryDelay: 800, staleTime: 15_000, ...options });
}

export const useRegisterList = () => read(KEYS.register, api.register);
export const useAssessmentCount = () => read([...KEYS.register, 'count'], api.count);
export const useBoard = () => read(KEYS.board, api.board);
export const useMyWork = (limit: number = WORK_LIMIT) => read([...KEYS.myWork, limit], () => api.myWork(limit));
export const usePoints = (enabled = true) => read(KEYS.points, api.points, { enabled });
export const usePolicy = (enabled = true) => read(KEYS.policy, api.policy, { enabled });
export const useTemplates = () => read(KEYS.templates, (): Promise<Template[]> => scopingApi.templates() as Promise<Template[]>);

/** The signed-in person's id (null until known, or when it cannot be read: "Mine" is then empty and says so). Same key as Evidence's and Business Continuity's, so it is asked once. */
export function useMeId(): number | null {
  const q = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => ((await apiClient.get('/auth/me')).data?.user?.id ?? null) as number | null,
    staleTime: 5 * 60 * 1000,
  });
  return q.data ?? null;
}
