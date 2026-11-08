'use client';

// The requests of the record page, each under ONE query key so the answer is asked once and the Library's panel shares it: the file (polled while its text is read or the AI works
// on it), what it is linked to, the controls, and the people (for names in the timeline). The AI review's own state is the shared hook (../../_review.tsx). Everything else waits for the
// tab or the sheet that needs it: the rating's detail and the clause suggestions (AI review tab), the extracted text (its dialog), and the lists a person picks from (the link sheet,
// one list when its kind is chosen). A request that fails is an error the page says, with Retry, never an empty answer; a 404 on the rating is an answer ("not rated yet").
import { useQuery } from '@tanstack/react-query';
import apiClient, { assetsApi, governanceApi } from '@/lib/api';
import { fetchAllLinks, fetchAssessment, fetchClauseMappings, fetchControls, fetchDetail, fetchOcr } from '../../_workspace/api';
import { isActiveReview } from '../../_workspace/evidenceModel';
import { RETRY_AFTER, retryRead } from '../../_library/libraryData';
import type { AiLinkStatus, AllLinks, ClauseMapping, ControlsResponse, EvidenceDetail, LatestAssessment } from './recordTypes';

export { RETRY_AFTER, retryRead };

export function useDetail(id: number) {
  return useQuery({
    queryKey: ['evidence-detail', id],
    queryFn: async () => (await fetchDetail(id)) as unknown as EvidenceDetail,
    enabled: Number.isFinite(id) && id > 0,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
    // while the file's text is read or the AI works on it, ask again: the rating and the status settle on their own
    refetchInterval: (query) => {
      const d = query.state.data as EvidenceDetail | undefined;
      return d?.ocr_status === 'pending' || d?.ocr_status === 'processing' || isActiveReview(d?.ai_review?.status) ? 3000 : false;
    },
  });
}

export function useLinks(id: number, enabled: boolean) {
  return useQuery({ queryKey: ['evidence-all-links', id], queryFn: async () => (await fetchAllLinks(id)) as unknown as AllLinks, enabled, retry: retryRead, retryDelay: RETRY_AFTER });
}

export function useControls(id: number, enabled: boolean) {
  return useQuery({ queryKey: ['evidence-controls', id], queryFn: async () => (await fetchControls(id)) as unknown as ControlsResponse, enabled, retry: retryRead, retryDelay: RETRY_AFTER });
}

/** The rating in full (summary, what is missing, how to raise it): the AI review tab. A file nobody has rated has no rating (null), which is an answer. */
export function useRating(id: number, enabled: boolean, running: boolean) {
  return useQuery({
    queryKey: ['evidence-assessment', id],
    queryFn: async () => (await fetchAssessment(id)) as unknown as LatestAssessment | null,
    enabled, retry: retryRead, retryDelay: RETRY_AFTER,
    refetchInterval: running ? 3000 : false,
  });
}

export function useClauses(id: number, enabled: boolean) {
  return useQuery({ queryKey: ['evidence-clause-mappings', id], queryFn: async () => (await fetchClauseMappings(id)) as unknown as ClauseMapping[], enabled, retry: retryRead, retryDelay: RETRY_AFTER });
}

/** Which clause suggestions are already linked (the AI review tab marks them "Linked"). */
export function useLinkStatus(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ['evidence-ai-link-status', id],
    queryFn: async () => (await apiClient.get(`/evidence-mgmt/links/${id}/ai-link-status`)).data as AiLinkStatus,
    enabled, retry: retryRead, retryDelay: RETRY_AFTER,
  });
}

/** The extracted text: asked for when its dialog opens (it is the heaviest thing a file has), and again while the reading runs. */
export function useOcrText(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ['evidence-ocr', id],
    queryFn: () => fetchOcr(id),
    enabled, retry: retryRead, retryDelay: RETRY_AFTER,
    refetchInterval: (query) => {
      const s = (query.state.data as { ocr_status?: string } | undefined)?.ocr_status;
      return s === 'pending' || s === 'processing' ? 3000 : false;
    },
  });
}

/** People, for the names in the timeline. Shared with the upload drawer's owner list; a failure just means no names. */
export function useTenantUsers() {
  return useQuery({ queryKey: ['tenant-users-evidence'], queryFn: async () => (await assetsApi.getTenantUsers()).data, staleTime: 5 * 60 * 1000 });
}

// ── the lists the link sheet picks from: one request when its kind is chosen ──────────────────────────────────────────────────

const rows = <T,>(data: unknown): T[] => (Array.isArray(data) ? data : (data as { items?: T[] } | null)?.items ?? []) as T[];

export interface PickRisk { id: number; title: string }
export interface PickAsset { id: number; name: string; asset_type?: string | null }
export interface PickIncident { id: number; title: string; severity?: string | null }
export interface PickControl { id: number; scf_id: string; code: string; name: string }
export interface PickAudit { id: number; code: string | null; title: string | null; subtitle: string | null; kind: string; record_id: number }
export interface PickDocument { id: number; title: string; document_code?: string | null; doc_type?: string | null }
export interface PickStatement { id: number; statement_code?: string | null; statement_summary?: string | null; statement_text?: string | null }

const pick = { staleTime: 60_000, retry: retryRead, retryDelay: RETRY_AFTER } as const;

export const useRisks = (on: boolean) => useQuery({ queryKey: ['risks-list'], queryFn: async () => rows<PickRisk>((await apiClient.get('/risks')).data), enabled: on, ...pick });
export const useAssets = (on: boolean) => useQuery({ queryKey: ['assets-list'], queryFn: async () => rows<PickAsset>((await apiClient.get('/assets')).data), enabled: on, ...pick });
export const useIncidents = (on: boolean) => useQuery({ queryKey: ['incidents-list'], queryFn: async () => rows<PickIncident>((await apiClient.get('/erm/incidents')).data), enabled: on, ...pick });
/** Every common (SCF) control: `available-controls` stops at 50. */
export const useCommonControls = (on: boolean) =>
  useQuery({ queryKey: ['common-control-options'], queryFn: async () => ((await apiClient.get('/evidence-mgmt/links/common-control-options')).data as { controls: PickControl[] }).controls, enabled: on, ...pick, staleTime: 5 * 60 * 1000 });
export const useAuditOptions = (id: number, on: boolean) =>
  useQuery({ queryKey: ['evidence-audit-options', id], queryFn: async () => ((await apiClient.get(`/evidence-mgmt/cross-links/${id}/audit-observation-options`)).data as { options: PickAudit[] }).options, enabled: on, ...pick });
/** Titles only (also for people without a governance right). The server answers a list or an envelope. */
export const useDocuments = (on: boolean) =>
  useQuery({
    queryKey: ['governance-documents-for-evidence-link'],
    queryFn: async () => {
      const data = (await governanceApi.getDocumentsBrief({ limit: 500 })).data as unknown;
      return (Array.isArray(data) ? data : (data as { items?: PickDocument[]; documents?: PickDocument[] } | null)?.items ?? (data as { documents?: PickDocument[] } | null)?.documents ?? []) as PickDocument[];
    },
    enabled: on, ...pick,
  });
/** The statements of one document. A document listed by title whose statements the person may not open answers `refused`: an empty list that says so, not asked again. */
export const useStatements = (documentId: number | null) =>
  useQuery({
    queryKey: ['policy-statements-by-doc', documentId],
    queryFn: async (): Promise<{ statements: PickStatement[]; refused: boolean }> => {
      try {
        const data = (await apiClient.get(`/governance/documents/${documentId}/policy-statements`)).data as { statements?: PickStatement[] };
        return { statements: data?.statements ?? [], refused: false };
      } catch (e) {
        if ((e as { response?: { status?: number } })?.response?.status === 403) return { statements: [], refused: true };
        throw e;
      }
    },
    enabled: documentId != null, staleTime: 60_000, retry: retryRead, retryDelay: RETRY_AFTER,
  });
