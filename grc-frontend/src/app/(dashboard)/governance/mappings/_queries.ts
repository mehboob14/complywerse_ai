'use client';

// The reads of the Mappings page: the same endpoints, query keys and payloads it always had (the keys are shared: the Statements view caches the raw statements
// under the same key, the document page invalidates these after its own writes). What is new is only how a failure is told: every read exposes isError, and a
// refusal (403) or a missing document is said at once instead of after react-query's three tries (about 7 seconds of a spinner).
import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ermApi, governanceApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import type { CoverageFramework, DocumentMappings, GapRecommendedFinding, InternalControl, StatementTextMap } from './_types';
import { gapFindingsToRecs } from './mappingsModel';

const retry = (tries: number, error: unknown): boolean => tries < 2 && canRetry(error);

/** The documents of the standalone page: up to 100 under the search and the type (the response also says how many there are in all: `total`). */
export function useDocumentList(typeFilter: string, searchTerm: string) {
  return useQuery({
    queryKey: ['governance-documents-list', typeFilter, searchTerm],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: 100 };
      if (typeFilter) params.doc_type = typeFilter;
      if (searchTerm) params.search = searchTerm;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await governanceApi.getDocuments(params as any);
      return response.data;
    },
    placeholderData: keepPreviousData,
    retry,
  });
}

/** What a document is mapped to: control links, the AI recommendations scoped to its frameworks, and the framework scope itself. */
export function useDocumentMappings(documentId: number | null) {
  return useQuery({
    queryKey: ['document-mappings', documentId],
    queryFn: async () => (await governanceApi.getDocumentMappings(documentId as number)).data as DocumentMappings,
    enabled: !!documentId,
    retry,
  });
}

/** Every internal (ERM) control: asked for only by someone who may read them (a 403 for everyone else). */
export function useInternalControls(enabled: boolean) {
  return useQuery({
    queryKey: ['internal-controls-for-governance-mapping'],
    queryFn: async () => (await ermApi.internalControls.getAll()).data as InternalControl[],
    enabled,
    retry,
  });
}

/** Full statement text for the open document: powers the full text in the mapping-detail drawer (the recommendations carry a 240-character snippet).
 *  This query key is SHARED with the document page's Statements view, which caches the raw `{ statements: [...] }` object, so both shapes are read. */
export function useStatementText(documentId: number | null) {
  const query = useQuery({
    queryKey: ['document-policy-statements', documentId],
    queryFn: async () => (await governanceApi.getDocumentPolicyStatements(documentId as number)).data, // raw: the shape the Statements view caches
    enabled: !!documentId,
    retry,
  });
  const statementText: StatementTextMap = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = query.data as any;
    const arr: Array<{ id: number; statement_code: string | null; statement_text: string }> = Array.isArray(data) ? data : (data?.statements ?? []);
    const m: StatementTextMap = new Map();
    arr.forEach((s) => m.set(s.id, { code: s.statement_code ?? null, text: s.statement_text ?? '' }));
    return m;
  }, [query.data]);
  return { statementText, failed: query.isError, refetch: query.refetch };
}

/** Per-framework coverage (mapped / missing clauses): the document's Mappings view only. */
export function useCoverage(documentId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['doc-coverage', documentId],
    queryFn: async () => (await governanceApi.getDocumentCoverage(documentId as number)).data as { frameworks: CoverageFramework[] },
    enabled: !!documentId && enabled,
    retry,
  });
}

/** Gap-analysis recommended controls, already in the shape of statement mappings: the document's Mappings view only (that is where gap runs live). */
export function useGapRecommended(documentId: number | null, enabled: boolean) {
  const query = useQuery({
    queryKey: ['gap-recommended-controls', documentId],
    queryFn: async () => (await governanceApi.getGapRecommendedControls(documentId as number)).data as { findings: GapRecommendedFinding[] },
    enabled: !!documentId && enabled,
    retry,
  });
  const recs = useMemo(() => gapFindingsToRecs(query.data?.findings ?? []), [query.data]);
  return { recs, isError: query.isError, error: query.error, refetch: query.refetch };
}
