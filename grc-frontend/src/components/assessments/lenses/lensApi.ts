/**
 * The calls the type lenses make beyond the workspace's own (`../workspace/workspaceApi.ts`): one answer of a control (a JSON body, never the query string), the applications an
 * uploaded ASVS / OWASP / MASVS workbook covers, and the target level of an application. Every lens reads the assessment from the workspace's cached read.
 */
import type { QueryClient } from '@tanstack/react-query';
import apiClient, { assetsApi } from '@/lib/api';
import { KEYS } from '../workspace/workspaceApi';
import type { AssessmentDetail } from '../workspace/types';
import type { LensRaw } from './lensData';

const BASE = '/compliance/assessments';

/** The assessment read as a lens needs it: the workspace's detail plus the applications of an uploaded workbook. */
export type LensDetail = Omit<AssessmentDetail, 'items'> & { items: LensRaw[]; linked_asset_ids?: number[]; asset_levels?: Record<string, number> };

/** What one answer changes (the server accepts only these fields in the body; an unknown one is refused). `maturity_score: null` clears the score back to Not answered. */
export interface AnswerBody { compliance_status?: string; asset_id?: number; maturity_score?: number | null }

export interface Application { id: number; name: string; asset_type?: string | null }

export const lensApi = {
  setAnswer: async (itemId: number, body: AnswerBody): Promise<Record<string, unknown>> => (await apiClient.put(`${BASE}/items/${itemId}`, body)).data,
  setApplications: async (id: number, assetIds: number[]): Promise<unknown> => (await apiClient.put(`${BASE}/${id}/assets`, { asset_ids: assetIds })).data,
  setTargetLevel: async (id: number, assetId: number, level: number): Promise<unknown> => (await apiClient.put(`${BASE}/${id}/asset-level`, { asset_id: assetId, level })).data,
  applications: async (): Promise<Application[]> => ((await assetsApi.getAll({ limit: 500 })).data ?? []) as Application[],
};

export const LENS_KEYS = { applications: ['assessment-lens-applications'] as const };

/** The saved fields of a control, put into the workspace's cached read so the table shows them at once (the heading's counts read again through `onChanged`). */
export function mergeItem(qc: QueryClient, assessmentId: number, itemId: number, fields: Record<string, unknown>): void {
  const { assessment: _totals, ...saved } = fields;
  void _totals;
  qc.setQueryData<LensDetail>(KEYS.detail(assessmentId), (d) => (d ? { ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, ...saved } : i)) } : d));
}
